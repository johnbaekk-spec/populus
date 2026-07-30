"""Seeding the identity registries, and the honest accounting for it.

Two sources, both offline and injectable — nothing here reaches the network:

- ``company_tickers.json`` (``sec-edgar``) seeds ``entities`` + dated
  ``entity_names`` + dated ``entity_tickers``.
- SEC fails-to-deliver archives (``sec-ftd``) seed ``securities`` +
  ``security_identifiers`` and link securities to entities through an
  **as-of** symbol lookup performed independently per observation.

Accounting is three structurally separate families (DC5/G3), each field
carrying a unit, an observation phase, and a first-run -> replay rule:

``Disposition``   PARSE phase. Mutually exclusive source-row buckets that sum
                  to ``rows_read``. Identical on replay.
``Mutations``     WRITE phase. Rows and objects this run actually inserted,
                  updated, cut or deleted. **Zero** on an identical replay.
``RegistryState`` POST-WRITE phase. Every field is a function of (resulting
                  registry, this run's input) — never of what existed before —
                  so "identical on replay" holds by construction.

Mixing them is how a reconciliation summary starts lying: "10,000 entities"
means nothing without saying whether that counts source rows, rows written, or
rows present. Each number here says which.

Transaction discipline: SQLite transactions do not nest, so the seeders and the
registry migration are all transaction-AGNOSTIC (they assert an open
transaction) and exactly one caller — :func:`run_identity_bootstrap` — owns the
single ``BEGIN IMMEDIATE``. That is what makes a bootstrap all-or-nothing while
the ``ingest_runs`` audit row, opened in autocommit beforehand, still survives a
rollback to record the failure.
"""

from __future__ import annotations

import json
import sqlite3
import zipfile
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass, fields
from datetime import date
from pathlib import Path

from populus.canonical import nfc
from populus.identity.registry import (
    IdentityRegistry,
    anchor,
    applicable_value,
    apply_entity_candidates,
    authority_state,
    confidence_for,
    ensure_security,
    entity_id_for,
    normalize_cik,
    normalize_cusip,
    normalize_entity_name,
    normalize_ticker,
    reconcile_identity_registry,
    reuse_review_decisions,
    rewrite_identifier_intervals,
    target_for,
)

#: Provenance and record-level license (§5.1) per source. Both register entries
#: exist before this module runs (G11 — see src/populus/licenses.json).
TICKER_PROVENANCE = "company_tickers"
TICKER_LICENSE_ID = "sec-edgar"
FTD_PROVENANCE = "sec-ftd"
FTD_LICENSE_ID = "sec-ftd"

#: The SEC fails-to-deliver header is matched BY COLUMN NAME, never by
#: position: the archive is pipe-delimited with a real header row, and a
#: positional parser would silently mis-assign if SEC ever reorders it. The
#: real header is pinned by tests/fixtures/inst/ftd/cnsfails-real-excerpt.txt.
FTD_COLUMNS = {
    "SETTLEMENT DATE": "settlement_date",
    "CUSIP": "cusip",
    "SYMBOL": "symbol",
    "DESCRIPTION": "description",
}


# --- accounting: three families, every field with a unit ----------------------


@dataclass(frozen=True)
class Disposition:
    """PARSE phase. Mutually exclusive buckets that sum to ``rows_read``.

    Every source row lands in exactly one bucket, so nothing is silently
    dropped (G3) and no row is counted twice. The sum is asserted at
    construction: an accounting bug fails loudly at the parse boundary rather
    than becoming a wrong number in a summary.
    """

    rows_read: int = 0
    accepted: int = 0
    rejected_blank: int = 0
    rejected_malformed: int = 0
    rejected_duplicate: int = 0
    rejected_title_conflict: int = 0

    BUCKETS = (
        "accepted",
        "rejected_blank",
        "rejected_malformed",
        "rejected_duplicate",
        "rejected_title_conflict",
    )

    def __post_init__(self) -> None:
        total = sum(getattr(self, bucket) for bucket in self.BUCKETS)
        if total != self.rows_read:
            raise ValueError(
                f"disposition buckets sum to {total} but {self.rows_read} rows"
                " were read — the buckets must partition the source rows"
            )


DISPOSITION_UNITS: dict[str, str] = {
    "rows_read": "source rows",
    "accepted": "source rows",
    "rejected_blank": "source rows",
    "rejected_malformed": "source rows",
    "rejected_duplicate": "source rows",
    "rejected_title_conflict": "source rows",
}


@dataclass
class Mutations:
    """WRITE phase. What this run actually changed. Zero on identical replay.

    Defined here, with the other counter families, and imported lazily by
    ``registry.reconcile_identity_registry`` (the ``canonical``/``load``
    precedent) so the migration can report its writes in the same currency as
    the seeders without a module cycle.
    """

    # company_tickers
    entities_inserted: int = 0
    names_opened: int = 0
    names_closed: int = 0
    tickers_opened: int = 0
    tickers_closed_reassigned: int = 0
    # securities / identifiers (seeding + registry-revision migration)
    securities_created: int = 0
    securities_promoted: int = 0
    securities_merged: int = 0
    securities_split: int = 0
    securities_metadata_updated: int = 0
    supersessions_recorded: int = 0
    supersessions_collapsed: int = 0
    intervals_cut: int = 0
    intervals_moved: int = 0
    intervals_inserted: int = 0
    intervals_extended: int = 0
    intervals_removed: int = 0
    identifiers_metadata_updated: int = 0
    links_stamped: int = 0
    links_conflicted: int = 0
    links_cleared: int = 0
    links_reset_on_split: int = 0
    securities_flagged_disputed: int = 0
    securities_cleared_by_continuity: int = 0


MUTATION_UNITS: dict[str, str] = {
    "entities_inserted": "entities rows",
    "names_opened": "entity_names rows",
    "names_closed": "entity_names rows",
    "tickers_opened": "entity_tickers rows",
    "tickers_closed_reassigned": "entity_tickers rows",
    "securities_created": "securities rows",
    "securities_promoted": "predecessor securities",
    "securities_merged": "predecessor securities",
    "securities_split": "predecessor securities",
    "securities_metadata_updated": "securities rows",
    "supersessions_recorded": "security_supersessions rows",
    "supersessions_collapsed": "security_supersessions rows",
    "intervals_cut": "predecessor security_identifiers rows",
    "intervals_moved": "security_identifiers rows",
    "intervals_inserted": "security_identifiers rows",
    "intervals_extended": "security_identifiers rows",
    "intervals_removed": "security_identifiers rows",
    "identifiers_metadata_updated": "security_identifiers rows",
    "links_stamped": "securities",
    "links_conflicted": "securities",
    "links_cleared": "securities",
    "links_reset_on_split": "securities",
    "securities_flagged_disputed": "securities",
    "securities_cleared_by_continuity": "securities",
}


@dataclass
class RegistryState:
    """POST-WRITE phase. The registry AFTER the run, relative to this run's input.

    No field describes what existed beforehand, which is exactly why every one
    of them is identical on replay: they are functions of (resulting registry,
    this run's input), and both sides are unchanged by a repeat run. "How much
    was new" is a write fact and lives in :class:`Mutations`.
    """

    # company_tickers
    entities_in_registry: int = 0
    names_current: int = 0
    names_ahead_of_snapshot: int = 0
    tickers_current: int = 0
    tickers_ahead_of_snapshot: int = 0
    entities_absent_from_snapshot: int = 0
    tickers_absent_from_snapshot: int = 0
    # fails-to-deliver
    anchors_in_registry: int = 0
    securities_in_registry: int = 0
    securities_declared: int = 0
    securities_provisional: int = 0
    links_resolved: int = 0
    links_conflicted: int = 0
    links_unresolved: int = 0
    observations_covered: int = 0
    observations_disputed: int = 0
    symbols_resolved: int = 0
    symbols_unresolved: int = 0
    symbols_blank: int = 0
    identity_reuse_candidates: int = 0
    classes_in_force: int = 0
    continuities_in_force: int = 0


REGISTRY_STATE_UNITS: dict[str, str] = {
    "entities_in_registry": "entities",
    "names_current": "CIKs",
    "names_ahead_of_snapshot": "CIKs",
    "tickers_current": "accepted rows",
    "tickers_ahead_of_snapshot": "accepted rows",
    "entities_absent_from_snapshot": "entities",
    "tickers_absent_from_snapshot": "open ticker rows",
    "anchors_in_registry": "anchors",
    "securities_in_registry": "securities",
    "securities_declared": "securities",
    "securities_provisional": "securities",
    "links_resolved": "securities",
    "links_conflicted": "securities",
    "links_unresolved": "securities",
    "observations_covered": "(value, date) pairs",
    "observations_disputed": "(value, date) pairs",
    "symbols_resolved": "link attempts",
    "symbols_unresolved": "link attempts",
    "symbols_blank": "link attempts",
    "identity_reuse_candidates": "anchors",
    "classes_in_force": "authority classes",
    "continuities_in_force": "authority continuities",
}

#: Which fields each source reports, so a summary never prints a counter the
#: source cannot have produced. `Mutations` is one type because the registry
#: migration and the FTD seeder both write securities in the same currency;
#: these lists keep each printed family honest about which writes it covers.
TICKER_MUTATION_FIELDS = (
    "entities_inserted",
    "names_opened",
    "names_closed",
    "tickers_opened",
    "tickers_closed_reassigned",
)
FTD_MUTATION_FIELDS = tuple(
    name for name in MUTATION_UNITS if name not in TICKER_MUTATION_FIELDS
)
TICKER_STATE_FIELDS = (
    "entities_in_registry",
    "names_current",
    "names_ahead_of_snapshot",
    "tickers_current",
    "tickers_ahead_of_snapshot",
    "entities_absent_from_snapshot",
    "tickers_absent_from_snapshot",
)
FTD_STATE_FIELDS = (
    "anchors_in_registry",
    "securities_in_registry",
    "securities_declared",
    "securities_provisional",
    "links_resolved",
    "links_conflicted",
    "links_unresolved",
    "observations_covered",
    "observations_disputed",
    "symbols_resolved",
    "symbols_unresolved",
    "symbols_blank",
    "identity_reuse_candidates",
    "classes_in_force",
    "continuities_in_force",
)


# --- reports ------------------------------------------------------------------


@dataclass(frozen=True)
class TickerBootstrapReport:
    snapshot_date: str
    disposition: Disposition
    mutations: Mutations
    state: RegistryState


@dataclass(frozen=True)
class FtdBootstrapReport:
    disposition: Disposition
    mutations: Mutations
    state: RegistryState
    #: (id_type, value, issuer name) for every identifier awaiting review —
    #: counted AND listed, never dropped (G3).
    disputed: tuple[tuple[str, str, str], ...] = ()


@dataclass(frozen=True)
class BootstrapReport:
    run_id: str
    status: str
    tickers: TickerBootstrapReport
    ftd: FtdBootstrapReport

    @property
    def ok(self) -> bool:
        return self.status == "ok"


# --- company_tickers.json (R3, DC1) -------------------------------------------


@dataclass(frozen=True)
class TickerRow:
    cik: str
    entity_id: str
    ticker: str
    name: str
    raw: dict

    @property
    def sort_key(self) -> tuple[str, str]:
        return (self.cik, self.ticker)


def _entry_order(key: str) -> tuple[int, int, str]:
    """SEC keys the object by stringified rank; order numerically when we can."""
    return (0, int(key), "") if key.isdigit() else (1, 0, key)


def load_company_tickers(path: Path | str) -> tuple[tuple[TickerRow, ...], Disposition]:
    """Parse ``company_tickers.json`` into accepted rows plus its disposition.

    DC1 is decided here, in memory, before any write: a CIK carrying two
    distinct normalized titles in one snapshot has **all** of its rows routed
    to ``rejected_title_conflict``, so the buckets stay mutually exclusive and
    no ambiguous name is ever written. Several tickers for one CIK sharing one
    title are ordinary one-to-many data and are accepted.
    """
    try:
        return parse_company_tickers(
            json.loads(Path(path).read_text(encoding="utf-8"))
        )
    except ValueError as exc:
        raise ValueError(f"{path}: {exc}") from exc


def parse_company_tickers(
    data: object,
) -> tuple[tuple[TickerRow, ...], Disposition]:
    """The decision core of :func:`load_company_tickers`, over already-decoded
    JSON — so a federated consumer that fetched the bytes itself (the MCP
    ticker resolver) gets the SAME malformed/duplicate/DC1 title-conflict
    dispositions instead of reimplementing a laxer subset of them (QA-F9).
    """
    if isinstance(data, Mapping):
        entries = [data[key] for key in sorted(data, key=_entry_order)]
    elif isinstance(data, list):
        entries = list(data)
    else:
        raise ValueError("company_tickers must be an object or a list")

    malformed = 0
    valid: list[tuple[str, str, str, Mapping]] = []
    for entry in entries:
        if not isinstance(entry, Mapping):
            malformed += 1
            continue
        cik = normalize_cik(entry.get("cik_str"))
        ticker = normalize_ticker(entry.get("ticker"))
        name = normalize_entity_name(entry.get("title"))
        if cik is None or ticker is None or name is None:
            malformed += 1
            continue
        valid.append((cik, ticker, name, entry))

    # DC1: a CIK carrying two distinct normalized titles in this snapshot is a
    # title conflict — ALL of its rows are rejected. This is decided across EVERY
    # valid row BEFORE duplicate bucketing: a (cik, ticker) duplicate whose row
    # carries the second, differing title must trigger the conflict, not be
    # silently dropped as a duplicate (which would retain the first title). The
    # buckets stay mutually exclusive and sum to rows_read.
    titles: dict[str, set[str]] = {}
    for cik, _ticker, name, _entry in valid:
        titles.setdefault(cik, set()).add(name)
    conflicted = {cik for cik, names in titles.items() if len(names) > 1}

    duplicate = 0
    title_conflict = 0
    seen: set[tuple[str, str]] = set()
    provisional: list[TickerRow] = []
    for cik, ticker, name, entry in valid:
        if cik in conflicted:
            title_conflict += 1
            continue
        key = (cik, ticker)
        if key in seen:
            duplicate += 1
            continue
        seen.add(key)
        provisional.append(
            TickerRow(
                cik=cik,
                entity_id=entity_id_for(cik),
                ticker=ticker,
                name=name,
                raw={
                    "cik_str": entry.get("cik_str"),
                    "ticker": entry.get("ticker"),
                    "title": entry.get("title"),
                },
            )
        )

    accepted = tuple(sorted(provisional, key=lambda row: row.sort_key))
    return accepted, Disposition(
        rows_read=len(entries),
        accepted=len(accepted),
        rejected_malformed=malformed,
        rejected_duplicate=duplicate,
        rejected_title_conflict=title_conflict,
    )


def _require_transaction(conn: sqlite3.Connection, what: str) -> None:
    if not conn.in_transaction:
        raise sqlite3.ProgrammingError(
            f"{what} requires an open transaction: the registry migration and"
            " both seeding passes must commit or roll back together"
        )


def bootstrap_tickers(
    conn: sqlite3.Connection,
    rows: Sequence[TickerRow],
    *,
    snapshot_date: str,
    license_id: str = TICKER_LICENSE_ID,
    provenance: str = TICKER_PROVENANCE,
    disposition: Disposition | None = None,
) -> TickerBootstrapReport:
    """Apply one ``company_tickers`` snapshot to the entity registries.

    Snapshot semantics: an unchanged open row is left alone; a changed title or
    a reassigned ticker closes the open row at *snapshot_date* and opens a new
    one; a snapshot OLDER than the recorded ``valid_from`` is refused outright,
    because history is never rewritten (the refusal is visible afterwards as
    ``names_ahead_of_snapshot`` / ``tickers_ahead_of_snapshot``). Plain absence
    from the snapshot leaves an open row open — a company that stopped being
    listed did not stop existing.
    """
    _require_transaction(conn, "bootstrap_tickers")
    if disposition is None:
        disposition = Disposition(rows_read=len(rows), accepted=len(rows))
    mutations = Mutations()

    by_cik: dict[str, TickerRow] = {}
    for row in rows:
        by_cik.setdefault(row.cik, row)

    # 1 — entities (bulk; ~10k rows in the real corpus).
    existing_entities = {
        entity_id for (entity_id,) in conn.execute("SELECT entity_id FROM entities")
    }
    new_entities = [
        (
            row.entity_id,
            row.cik,
            json.dumps(row.raw, ensure_ascii=False, sort_keys=True),
        )
        for _cik, row in sorted(by_cik.items())
        if row.entity_id not in existing_entities
    ]
    if new_entities:
        conn.executemany(
            "INSERT INTO entities (entity_id, cik, raw) VALUES (?, ?, ?)"
            " ON CONFLICT (entity_id) DO NOTHING",
            new_entities,
        )
    mutations.entities_inserted = len(new_entities)

    # 2 — names: exactly one open interval per entity.
    open_names = {
        entity_id: (name, valid_from)
        for entity_id, name, valid_from in conn.execute(
            "SELECT entity_id, name, valid_from FROM entity_names"
            " WHERE valid_to IS NULL"
        )
    }
    name_closes: list[tuple[str, str, str]] = []
    name_opens: list[tuple] = []
    for _cik, row in sorted(by_cik.items()):
        current = open_names.get(row.entity_id)
        if current is None:
            name_opens.append(row)
        elif current[0] == row.name:
            continue
        elif snapshot_date > current[1]:
            name_closes.append((snapshot_date, row.entity_id, current[1]))
            name_opens.append(row)
        # else: the open interval starts after this snapshot — refuse, never
        # rewrite history. Surfaced post-write as names_ahead_of_snapshot.
    if name_closes:
        conn.executemany(
            "UPDATE entity_names SET valid_to = ? WHERE entity_id = ?"
            " AND valid_from = ?",
            name_closes,
        )
    if name_opens:
        conn.executemany(
            "INSERT INTO entity_names (entity_id, name, valid_from, valid_to,"
            " source, license_id, raw) VALUES (?, ?, ?, NULL, ?, ?, ?)",
            [
                (
                    row.entity_id,
                    row.name,
                    snapshot_date,
                    provenance,
                    license_id,
                    json.dumps(row.raw, ensure_ascii=False, sort_keys=True),
                )
                for row in name_opens
            ],
        )
    mutations.names_closed = len(name_closes)
    mutations.names_opened = len(name_opens)

    # 3 — tickers: a symbol belongs to at most one entity at a time.
    open_tickers = {
        ticker: (entity_id, valid_from)
        for ticker, entity_id, valid_from in conn.execute(
            "SELECT ticker, entity_id, valid_from FROM entity_tickers"
            " WHERE valid_to IS NULL"
        )
    }
    ticker_closes: list[tuple[str, str, str]] = []
    ticker_opens: list[TickerRow] = []
    for row in sorted(rows, key=lambda item: item.sort_key):
        current = open_tickers.get(row.ticker)
        if current is None:
            ticker_opens.append(row)
        elif current[0] == row.entity_id:
            continue
        elif snapshot_date > current[1]:
            ticker_closes.append((snapshot_date, row.ticker, current[1]))
            ticker_opens.append(row)
        # else: refuse — see the name branch.
    if ticker_closes:
        conn.executemany(
            "UPDATE entity_tickers SET valid_to = ? WHERE ticker = ?"
            " AND valid_from = ?",
            ticker_closes,
        )
    if ticker_opens:
        conn.executemany(
            "INSERT INTO entity_tickers (entity_id, ticker, valid_from, valid_to,"
            " provenance, confidence, review_state, license_id, raw)"
            " VALUES (?, ?, ?, NULL, ?, 'high', 'auto', ?, ?)",
            [
                (
                    row.entity_id,
                    row.ticker,
                    snapshot_date,
                    provenance,
                    license_id,
                    json.dumps(row.raw, ensure_ascii=False, sort_keys=True),
                )
                for row in ticker_opens
            ],
        )
    mutations.tickers_closed_reassigned = len(ticker_closes)
    mutations.tickers_opened = len(ticker_opens)

    state = _ticker_registry_state(conn, rows, by_cik, snapshot_date)
    return TickerBootstrapReport(
        snapshot_date=snapshot_date,
        disposition=disposition,
        mutations=mutations,
        state=state,
    )


def _ticker_registry_state(
    conn: sqlite3.Connection,
    rows: Sequence[TickerRow],
    by_cik: Mapping[str, TickerRow],
    snapshot_date: str,
) -> RegistryState:
    """Read the registry AFTER the write and measure it against this input."""
    state = RegistryState()
    all_entities = {
        entity_id for (entity_id,) in conn.execute("SELECT entity_id FROM entities")
    }
    post_names = {
        entity_id: valid_from
        for entity_id, valid_from in conn.execute(
            "SELECT entity_id, valid_from FROM entity_names WHERE valid_to IS NULL"
        )
    }
    post_tickers = {
        (entity_id, ticker): valid_from
        for entity_id, ticker, valid_from in conn.execute(
            "SELECT entity_id, ticker, valid_from FROM entity_tickers"
            " WHERE valid_to IS NULL"
        )
    }

    accepted_entity_ids = {row.entity_id for row in rows}
    state.entities_in_registry = len(accepted_entity_ids & all_entities)
    for row in by_cik.values():
        opened = post_names.get(row.entity_id)
        if opened is not None and opened <= snapshot_date:
            state.names_current += 1
        else:
            state.names_ahead_of_snapshot += 1
    for row in rows:
        opened = post_tickers.get((row.entity_id, row.ticker))
        if opened is not None and opened <= snapshot_date:
            state.tickers_current += 1
        else:
            state.tickers_ahead_of_snapshot += 1
    state.entities_absent_from_snapshot = len(all_entities - accepted_entity_ids)
    accepted_pairs = {(row.entity_id, row.ticker) for row in rows}
    state.tickers_absent_from_snapshot = len(set(post_tickers) - accepted_pairs)
    return state


# --- SEC fails-to-deliver (R4, DC2, DC3, DC4, R18) ----------------------------


class FtdFormatError(ValueError):
    """The archive's header is not the SEC fails-to-deliver format."""


@dataclass(frozen=True)
class FtdObservation:
    """One point-in-time settlement-date row. NOT an interval (DC2/G14)."""

    settlement_date: str  # ISO
    id_type: str
    value: str
    symbol: str | None
    issuer_name: str | None

    @property
    def sort_key(self) -> tuple[str, str, str, str]:
        return (self.id_type, self.value, self.settlement_date, self.symbol or "")


def _ftd_streams(path: Path) -> Iterable[tuple[str, list[str]]]:
    if path.suffix.lower() == ".zip":
        with zipfile.ZipFile(path) as archive:
            for name in sorted(archive.namelist()):
                if name.endswith("/"):
                    continue
                text = archive.read(name).decode("utf-8", errors="replace")
                yield (f"{path}::{name}", text.splitlines())
    else:
        text = path.read_text(encoding="utf-8", errors="replace")
        yield (str(path), text.splitlines())


def _header_index(header: str, label: str) -> dict[str, int]:
    cells = [" ".join(cell.split()).upper() for cell in header.split("|")]
    index: dict[str, int] = {}
    for position, cell in enumerate(cells):
        key = FTD_COLUMNS.get(cell)
        if key is not None and key not in index:
            index[key] = position
    missing = sorted(name for name, key in FTD_COLUMNS.items() if key not in index)
    if missing:
        raise FtdFormatError(
            f"{label}: not a SEC fails-to-deliver archive — missing column(s)"
            f" {missing}; columns found: {cells}"
        )
    return index


def _ftd_date(raw: str) -> str | None:
    text = raw.strip()
    if len(text) != 8 or not text.isdigit():
        return None
    try:
        return date(int(text[:4]), int(text[4:6]), int(text[6:])).isoformat()
    except ValueError:
        return None


def parse_ftd(
    paths: Iterable[Path | str],
) -> tuple[tuple[FtdObservation, ...], Disposition]:
    """Parse one or more ``.txt`` / ``.zip`` fails-to-deliver archives.

    Header-driven and matched by column name, so a provider reordering cannot
    silently mis-assign fields; CRLF-safe; decoded with ``errors="replace"``
    then NFC-normalized once, at extraction. ``rows_read`` counts input lines
    after each stream's header, and every one lands in exactly one bucket:
    trailer and blank lines (which carry no ``|``) are ``rejected_blank``, a
    row whose settlement date or CUSIP will not normalize is
    ``rejected_malformed``, and a repeated (CUSIP, date, symbol) is
    ``rejected_duplicate``.
    """
    rows_read = 0
    blank = 0
    malformed = 0
    duplicate = 0
    seen: set[tuple[str, str, str]] = set()
    accepted: list[FtdObservation] = []
    for raw_path in paths:
        for label, lines in _ftd_streams(Path(raw_path)):
            if not lines:
                raise FtdFormatError(f"{label}: empty file, no header row")
            index = _header_index(lines[0], label)
            width = max(index.values())
            for line in lines[1:]:
                rows_read += 1
                text = nfc(line).strip()
                if not text or "|" not in text:
                    blank += 1
                    continue
                cells = text.split("|")
                if len(cells) <= width:
                    malformed += 1
                    continue
                settlement = _ftd_date(cells[index["settlement_date"]])
                value = normalize_cusip(cells[index["cusip"]])
                if settlement is None or value is None:
                    malformed += 1
                    continue
                symbol = normalize_ticker(cells[index["symbol"]])
                key = (value, settlement, symbol or "")
                if key in seen:
                    duplicate += 1
                    continue
                seen.add(key)
                accepted.append(
                    FtdObservation(
                        settlement_date=settlement,
                        id_type="cusip",
                        value=value,
                        symbol=symbol,
                        issuer_name=normalize_entity_name(
                            cells[index["description"]]
                        ),
                    )
                )
    ordered = tuple(sorted(accepted, key=lambda item: item.sort_key))
    return ordered, Disposition(
        rows_read=rows_read,
        accepted=len(ordered),
        rejected_blank=blank,
        rejected_malformed=malformed,
        rejected_duplicate=duplicate,
    )


def _stamp_review(
    conn: sqlite3.Connection, id_type: str, value: str, review_state: str
) -> int:
    """Set one identifier's review verdict; returns SECURITIES updated."""
    conn.execute(
        "UPDATE security_identifiers SET review_state = ?, confidence = ?"
        " WHERE id_type = ? AND value = ? AND review_state != ?",
        (review_state, confidence_for(review_state), id_type, value, review_state),
    )
    cursor = conn.execute(
        "UPDATE securities SET review_state = ? WHERE review_state != ?"
        " AND security_id IN (SELECT security_id FROM security_identifiers"
        " WHERE id_type = ? AND value = ?)",
        (review_state, review_state, id_type, value),
    )
    return max(cursor.rowcount, 0)


def bootstrap_ftd(
    conn: sqlite3.Connection,
    observations: Sequence[FtdObservation],
    *,
    registry: IdentityRegistry,
    license_id: str = FTD_LICENSE_ID,
    provenance: str = FTD_PROVENANCE,
    disposition: Disposition | None = None,
    mutations: Mutations | None = None,
) -> FtdBootstrapReport:
    """Seed securities and dated CUSIP bindings from settlement observations.

    Output is a pure function of (observation set, authority): observations are
    applied in a canonical order, identity comes from the authority rather than
    from arrival order, validity intervals are an adjacency-only union scoped to
    one ownership window, and entity candidates accumulate as a set. Any
    partition, ordering or incremental backfill of the same observations
    therefore produces identical rows and identical ``security_id`` values.
    """
    _require_transaction(conn, "bootstrap_ftd")
    if disposition is None:
        disposition = Disposition(
            rows_read=len(observations), accepted=len(observations)
        )
    if mutations is None:
        mutations = Mutations()

    by_anchor: dict[tuple[str, str], list[FtdObservation]] = {}
    for observation in sorted(observations, key=lambda item: item.sort_key):
        by_anchor.setdefault((observation.id_type, observation.value), []).append(
            observation
        )

    # One batched read of the ticker registry: the as-of rule itself stays in
    # registry.applicable_value, so this bulk path cannot drift from the SQL one.
    ticker_index: dict[str, list[tuple[str, str | None, str, str]]] = {}
    for ticker, valid_from, valid_to, entity_id, review_state in conn.execute(
        "SELECT ticker, valid_from, valid_to, entity_id, review_state"
        " FROM entity_tickers"
    ):
        ticker_index.setdefault(ticker, []).append(
            (valid_from, valid_to, entity_id, review_state)
        )

    symbols_resolved = symbols_unresolved = symbols_blank = 0
    candidates: dict[str, set[str]] = {}
    for (id_type, value), group in sorted(by_anchor.items()):
        dates_by_owner: dict[str, set[str]] = {}
        for observation in group:
            security_id, _state, _class = target_for(
                registry, id_type, value, observation.settlement_date
            )
            dates_by_owner.setdefault(security_id, set()).add(
                observation.settlement_date
            )
            # DC4: every (symbol, settlement_date) resolves INDEPENDENTLY.
            if observation.symbol is None:
                symbols_blank += 1
                continue
            entity_id = applicable_value(
                ticker_index.get(observation.symbol, ()), observation.settlement_date
            )
            if entity_id is None:
                symbols_unresolved += 1
            else:
                symbols_resolved += 1
                candidates.setdefault(security_id, set()).add(entity_id)
        for security_id, dates in sorted(dates_by_owner.items()):
            if ensure_security(conn, security_id, registry):
                mutations.securities_created += 1
            _state, _class, review_state = authority_state(registry, security_id)
            rewrite_identifier_intervals(
                conn,
                security_id=security_id,
                id_type=id_type,
                value=value,
                observed_dates=sorted(dates),
                provenance=provenance,
                license_id=license_id,
                review_state=review_state,
                mutations=mutations,
            )

    for security_id in sorted(candidates):
        outcome = apply_entity_candidates(conn, security_id, candidates[security_id])
        if outcome == "stamped":
            mutations.links_stamped += 1
        elif outcome == "conflicted":
            mutations.links_conflicted += 1
        elif outcome == "cleared":
            mutations.links_cleared += 1

    # R18 — reuse review. The horizon is a REVIEW trigger only: it reads the
    # persisted intervals and never widens one.
    reuse_candidates = 0
    disputed: list[tuple[str, str, str]] = []
    for id_type, value in sorted(by_anchor):
        decision = reuse_review_decisions(conn, anchor(id_type, value), registry)
        if decision.flagged:
            reuse_candidates += 1
        if decision.disputed:
            mutations.securities_flagged_disputed += _stamp_review(
                conn, id_type, value, "disputed"
            )
            issuer = next(
                (
                    observation.issuer_name
                    for observation in reversed(by_anchor[(id_type, value)])
                    if observation.issuer_name
                ),
                "",
            )
            disputed.append((id_type, value, issuer))
        elif decision.cleared:
            mutations.securities_cleared_by_continuity += _stamp_review(
                conn, id_type, value, "reviewed"
            )

    state = _ftd_registry_state(
        conn,
        by_anchor,
        registry,
        symbols_resolved=symbols_resolved,
        symbols_unresolved=symbols_unresolved,
        symbols_blank=symbols_blank,
        reuse_candidates=reuse_candidates,
    )
    return FtdBootstrapReport(
        disposition=disposition,
        mutations=mutations,
        state=state,
        disputed=tuple(sorted(disputed)),
    )


def _ftd_registry_state(
    conn: sqlite3.Connection,
    by_anchor: Mapping[tuple[str, str], list[FtdObservation]],
    registry: IdentityRegistry,
    *,
    symbols_resolved: int,
    symbols_unresolved: int,
    symbols_blank: int,
    reuse_candidates: int,
) -> RegistryState:
    state = RegistryState()
    state.classes_in_force = len(registry.classes)
    state.continuities_in_force = len(registry.continuities)
    state.anchors_in_registry = len(by_anchor)
    state.symbols_resolved = symbols_resolved
    state.symbols_unresolved = symbols_unresolved
    state.symbols_blank = symbols_blank
    state.identity_reuse_candidates = reuse_candidates

    intervals: dict[tuple[str, str], list[tuple[str, str | None, str, str]]] = {}
    for id_type, value, valid_from, valid_to, security_id, review_state in conn.execute(
        "SELECT id_type, value, valid_from, valid_to, security_id, review_state"
        " FROM security_identifiers"
    ):
        intervals.setdefault((id_type, value), []).append(
            (valid_from, valid_to, security_id, review_state)
        )
    security_rows = {
        security_id: (id_state, link_state)
        for security_id, id_state, link_state in conn.execute(
            "SELECT security_id, id_state, entity_link_state FROM securities"
        )
    }

    security_ids: set[str] = set()
    for key in by_anchor:
        for row in intervals.get(key, ()):
            security_ids.add(row[2])
    state.securities_in_registry = len(security_ids)
    for security_id in security_ids:
        id_state, link_state = security_rows[security_id]
        if id_state == "declared":
            state.securities_declared += 1
        else:
            state.securities_provisional += 1
        if link_state == "resolved":
            state.links_resolved += 1
        elif link_state == "conflict":
            state.links_conflicted += 1
        else:
            state.links_unresolved += 1

    for key, group in by_anchor.items():
        rows = intervals.get(key, ())
        for observed in {observation.settlement_date for observation in group}:
            if applicable_value(rows, observed) is None:
                state.observations_disputed += 1
            else:
                state.observations_covered += 1
    return state


# --- the run: one audit row, one data transaction (R7) ------------------------


def _finalize_run_ok(
    conn: sqlite3.Connection,
    *,
    run_id: str,
    finished_at: str,
    rows_loaded: int,
    parse_failures: int,
) -> None:
    """Complete the audit row INSIDE the data transaction.

    Registry data and the ``ok`` status therefore commit atomically: there is no
    window in which the data is durable while the run still reads ``running``.
    A failure here rolls the data back with it and the outer handler records
    ``failed`` in autocommit.
    """
    conn.execute(
        "UPDATE ingest_runs SET finished_at = ?, status = 'ok', new_filings = 0,"
        " rows_loaded = ?, parse_failures = ? WHERE run_id = ?",
        (finished_at, rows_loaded, parse_failures, run_id),
    )


def _parse_failures(disposition: Disposition) -> int:
    return sum(
        getattr(disposition, bucket)
        for bucket in Disposition.BUCKETS
        if bucket != "accepted"
    )


def run_identity_bootstrap(
    conn: sqlite3.Connection,
    *,
    tickers_path: Path | str,
    ftd_paths: Sequence[Path | str] = (),
    registry: IdentityRegistry,
    snapshot_date: str,
    run_id: str,
    now,
    host: str,
) -> BootstrapReport:
    """Reconcile the authority and seed both registries — all or nothing.

    The audit row is opened in autocommit BEFORE the data transaction, so it
    survives the rollback that a failure triggers; the migration, both seeders
    and the success finalization then run inside ONE ``BEGIN IMMEDIATE``. Every
    attempted run therefore ends ``ok`` (everything committed) or ``failed``
    (everything rolled back) — never ``running``, and never a half-migrated
    registry under a failed run.
    """
    conn.execute(
        "INSERT INTO ingest_runs (run_id, job, started_at, status, host)"
        " VALUES (?, 'identity', ?, 'running', ?)",
        (run_id, now(), host),
    )
    try:
        ticker_rows, ticker_disposition = load_company_tickers(tickers_path)
        observations, ftd_disposition = parse_ftd(ftd_paths)
        conn.execute("BEGIN IMMEDIATE")
        try:
            migration = reconcile_identity_registry(conn, registry)
            tickers = bootstrap_tickers(
                conn,
                ticker_rows,
                snapshot_date=snapshot_date,
                disposition=ticker_disposition,
            )
            ftd = bootstrap_ftd(
                conn,
                observations,
                registry=registry,
                disposition=ftd_disposition,
                mutations=migration,
            )
            _finalize_run_ok(
                conn,
                run_id=run_id,
                finished_at=now(),
                rows_loaded=ticker_disposition.accepted + ftd_disposition.accepted,
                parse_failures=_parse_failures(ticker_disposition)
                + _parse_failures(ftd_disposition),
            )
            conn.execute("COMMIT")
        except BaseException:
            conn.execute("ROLLBACK")
            raise
    except BaseException:
        conn.execute(
            "UPDATE ingest_runs SET finished_at = ?, status = 'failed'"
            " WHERE run_id = ?",
            (now(), run_id),
        )
        raise
    return BootstrapReport(run_id=run_id, status="ok", tickers=tickers, ftd=ftd)


# --- printed summary ----------------------------------------------------------


def _counter_lines(
    obj, units: Mapping[str, str], only: Sequence[str] | None = None
) -> list[str]:
    names = only if only is not None else [f.name for f in fields(obj)]
    return [
        f"    {name}: {getattr(obj, name)} {units[name]}"
        for name in names
        if units.get(name)
    ]


def format_bootstrap_summary(report: BootstrapReport) -> str:
    """Print all three counter families per source, every counter with its unit."""
    lines = [f"identity bootstrap {report.run_id}: {report.status}"]

    lines.append(f"company_tickers (snapshot {report.tickers.snapshot_date})")
    lines.append("  disposition [parse phase; buckets sum to rows_read]")
    lines.extend(_counter_lines(report.tickers.disposition, DISPOSITION_UNITS))
    lines.append("  mutations [write phase; zero on an identical replay]")
    lines.extend(
        _counter_lines(
            report.tickers.mutations, MUTATION_UNITS, TICKER_MUTATION_FIELDS
        )
    )
    lines.append("  registry state [post-write; identical on an identical replay]")
    lines.extend(
        _counter_lines(report.tickers.state, REGISTRY_STATE_UNITS, TICKER_STATE_FIELDS)
    )

    lines.append("sec-ftd")
    lines.append("  disposition [parse phase; buckets sum to rows_read]")
    lines.extend(_counter_lines(report.ftd.disposition, DISPOSITION_UNITS))
    lines.append(
        "  mutations [write phase, incl. the registry migration;"
        " zero on an identical replay]"
    )
    lines.extend(
        _counter_lines(report.ftd.mutations, MUTATION_UNITS, FTD_MUTATION_FIELDS)
    )
    lines.append("  registry state [post-write; identical on an identical replay]")
    lines.extend(
        _counter_lines(report.ftd.state, REGISTRY_STATE_UNITS, FTD_STATE_FIELDS)
    )
    if report.ftd.disputed:
        lines.append(
            f"  disputed identifiers awaiting review ({len(report.ftd.disputed)}) —"
            " these resolve to nothing until a reviewed declaration exists:"
        )
        for id_type, value, issuer in report.ftd.disputed[:20]:
            lines.append(f"    {id_type} {value} — {issuer or '<no issuer name>'}")
        if len(report.ftd.disputed) > 20:
            lines.append(f"    … and {len(report.ftd.disputed) - 20} more")
    return "\n".join(lines)
