"""kadoa backfill import, crosswalk, and the §9.6 blocking audit gate.

Import: congressional rows only from the kadoa seed (``branch='congress'``),
one filing per kadoa row under the settled identity ``kadoa:<full id>``,
``source='kadoa'``, ``license_id='mit-kadoa-seed'``; OGE/executive rows are
never imported, only counted. Every source row reconciles to exactly one
outcome — imported / excluded-OGE / excluded-invalid — summing to the file
total (G3). Crosswalk: when a parsed/partial primary filing exists for the
same source document, every kadoa filing of that document is retired with
``primary_filing_id`` lineage (tombstones, never deleted).

Audit gate (§9.6, blocking, fail-closed): a single deterministic
``select_sample`` produces the draw for all three instrument modes and is
reused by the scorer to independently reconstruct the expected sample from
the digest-bound population and the sealed draw record — worksheet-declared
draw metadata is never trusted. Sizes are pinned module constants read from
the mode. The scorer evaluates completeness and integrity before any
threshold, defaults to ``incomplete``/``invalid``, and reports the exact
binomial bound only on a clean pass.

Library code never reads the wall clock or ambient randomness: ``now``/
``run_id``/``host``/``seed`` are injected by the CLI.
"""

from __future__ import annotations

import hashlib
import json
import random
import re
import sqlite3
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from pathlib import Path

import rfc8785

from populus.canonical import canonical_json, nfc
from populus.load import ParsedRow, upsert_filing
from populus.normalize import (
    NORMALIZATION_VERSION,
    date_stats,
    normalize_amount,
    normalize_asset,
    normalize_comment,
    normalize_owner,
    normalize_side,
    normalize_ticker,
)

BACKFILL_VERSION = "kadoa-backfill-1.0.0"
KADOA_LICENSE_ID = "mit-kadoa-seed"

# --- id grammar ----------------------------------------------------------

# <chamber>_<document-key>_<g|t><N>; both generation-suffix letters are valid
# (verified in the cache: house 910 `_g` + 3 `_t`, senate 191 `_t`).
_KADOA_ID = re.compile(r"^(house|senate)_(.+)_([gt])(\d+)$")
_HOUSE_KEY = re.compile(r"^\d{1,10}$")
_SENATE_KEY = re.compile(
    r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$"
)


@dataclass(frozen=True)
class KadoaId:
    chamber: str
    document_key: str  # house: numeric DocID; senate: eFD uuid
    generation: str  # 'g' | 't'
    sequence: int


def parse_kadoa_id(raw: object) -> KadoaId | None:
    """Parse and validate a kadoa record id; ``None`` when malformed."""
    if not isinstance(raw, str):
        return None
    match = _KADOA_ID.match(raw)
    if match is None:
        return None
    chamber, key, generation, sequence = match.groups()
    key_pattern = _HOUSE_KEY if chamber == "house" else _SENATE_KEY
    if key_pattern.match(key) is None:
        return None
    return KadoaId(
        chamber=chamber,
        document_key=key,
        generation=generation,
        sequence=int(sequence),
    )


# --- classification ------------------------------------------------------

_SOURCE_FOR_CHAMBER = {"house": "house_clerk", "senate": "senate_efd"}


def classify_row(record: object) -> str:
    """``'congress'`` | ``'oge'`` | ``'invalid'`` — every row lands in one."""
    if not isinstance(record, Mapping):
        return "invalid"
    branch = record.get("branch")
    source_id = record.get("source_id")
    chamber = record.get("chamber")
    if branch == "executive" or source_id == "oge_executive":
        return "oge"
    if branch != "congress":
        return "invalid"
    if chamber not in ("house", "senate"):
        return "invalid"
    if source_id != _SOURCE_FOR_CHAMBER[chamber]:
        return "invalid"
    kadoa_id = parse_kadoa_id(record.get("id"))
    if kadoa_id is None or kadoa_id.chamber != chamber:
        return "invalid"
    if not record.get("filing_date") or not record.get("doc_url"):
        return "invalid"
    if not record.get("filer_name"):
        return "invalid"
    return "congress"


# --- row mapping ---------------------------------------------------------


def _printed(value: object) -> str | None:
    """kadoa printed field → identity-grade cell: NFC string or JSON null."""
    if value is None:
        return None
    text = nfc(str(value))
    return text if text != "" else None


def kadoa_parsed_row(record: Mapping) -> ParsedRow:
    """Map one kadoa record into the closed seven-key ``raw_row`` shape and
    the normalized columns (documented mapping):

    ``owner`` ← ``owner`` · ``asset_name`` ← ``asset_name`` · ``ticker`` ←
    ``ticker`` · ``side`` ← ``transaction_type`` · ``transaction_date`` ←
    ``transaction_date`` (ISO) · ``amount_label`` ← ``amount_range_label`` ·
    ``comment`` ← ``comment``. ``asset_type`` comes from the record's own
    ``asset_type`` field (never re-derived from the name); amount bounds come
    from :func:`normalize_amount` over the printed label, falling back to
    kadoa's numeric bounds + ``amount_unparsed`` only for unrecognized
    labels; ``days_to_file``/``is_late`` are recomputed via
    :func:`populus.normalize.date_stats`, never trusted from the seed.
    """
    raw_row = {
        "owner": _printed(record.get("owner")),
        "asset_name": _printed(record.get("asset_name")),
        "ticker": _printed(record.get("ticker")),
        "side": _printed(record.get("transaction_type")),
        "transaction_date": _printed(record.get("transaction_date")),
        "amount_label": _printed(record.get("amount_range_label")),
        "comment": _printed(record.get("comment")),
    }
    filed_date = record["filing_date"]

    owner, owner_flags = normalize_owner(raw_row["owner"])
    ticker, ticker_flags = normalize_ticker(raw_row["ticker"])
    asset_name, _tag_type, asset_flags = normalize_asset(raw_row["asset_name"])
    asset_type_raw = record.get("asset_type")
    asset_type = (
        " ".join(str(asset_type_raw).split())
        if asset_type_raw is not None and str(asset_type_raw).strip()
        else None
    )
    side, side_flags = normalize_side(raw_row["side"])
    transaction_date, days_to_file, is_late, date_flags = date_stats(
        raw_row["transaction_date"], filed_date
    )
    amount_label = raw_row["amount_label"]
    amount_low, amount_high, amount_flags = normalize_amount(amount_label)
    if "amount_unparsed" in amount_flags:
        low = record.get("amount_range_low")
        high = record.get("amount_range_high")
        amount_low = low if isinstance(low, int) else None
        amount_high = high if isinstance(high, int) else None

    flags = sorted(
        owner_flags
        | ticker_flags
        | asset_flags
        | side_flags
        | date_flags
        | amount_flags
    )
    return ParsedRow(
        raw_row=raw_row,
        row_ordinal=1,
        source_row_no=None,
        asset_name=asset_name,
        asset_type=asset_type,
        side=side,
        owner=owner,
        ticker=ticker,
        transaction_date=transaction_date,
        days_to_file=days_to_file,
        is_late=is_late,
        amount_low=amount_low,
        amount_high=amount_high,
        amount_label=amount_label,
        cap_gains_over_200=None,
        comment=normalize_comment(raw_row["comment"]),
        flags=flags,
        kadoa_id=record["id"],
    )


# --- import --------------------------------------------------------------


@dataclass(frozen=True)
class BackfillReport:
    run_id: str
    total: int
    imported: int
    excluded_oge: int
    excluded_invalid: int
    invalid_samples: tuple[str, ...]
    crosswalk_retired: int

    @property
    def reconciled(self) -> bool:
        """G3: every source row in exactly one bucket, summing to the total."""
        return self.imported + self.excluded_oge + self.excluded_invalid == self.total

    @property
    def ok(self) -> bool:
        return self.reconciled and self.excluded_invalid == 0


def run_backfill_ingest(
    conn: sqlite3.Connection,
    *,
    trades_path: Path | str,
    run_id: str,
    now,
    host: str,
) -> BackfillReport:
    """Import the kadoa seed under one complete ``ingest_runs`` row.

    Row-count agnostic: every count derives from the file, never hardcoded.
    Idempotent — re-running upserts the same filings. Ends by applying the
    crosswalk so freshly imported filings retire against already-parsed
    primaries in the same invocation.
    """
    records = json.loads(Path(trades_path).read_text(encoding="utf-8"))
    if not isinstance(records, list):
        raise ValueError(f"{trades_path}: expected a JSON array of trade records")

    conn.execute(
        "INSERT INTO ingest_runs (run_id, job, started_at, status, host)"
        " VALUES (?, 'congress-backfill', ?, 'running', ?)",
        (run_id, now(), host),
    )
    imported = 0
    excluded_oge = 0
    invalid_count = 0
    invalid_samples: list[str] = []
    try:
        for record in records:
            outcome = classify_row(record)
            if outcome == "oge":
                excluded_oge += 1
                continue
            if outcome == "invalid":
                invalid_count += 1
                if len(invalid_samples) < 10:
                    invalid_samples.append(
                        repr(record.get("id") if isinstance(record, Mapping) else record)
                    )
                continue
            row = kadoa_parsed_row(record)
            upsert_filing(
                conn,
                filing_id=f"kadoa:{record['id']}",
                chamber=record["chamber"],
                filer_name_raw=record["filer_name"],
                filing_kind="ptr",
                filed_date=record["filing_date"],
                doc_url=record["doc_url"],
                source="kadoa",
                license_id=KADOA_LICENSE_ID,
                ingested_at=now(),
                rows=[row],
                parse_status="parsed",
                parser_version=BACKFILL_VERSION,
                normalization_version=NORMALIZATION_VERSION,
            )
            imported += 1
        retired = apply_crosswalk(conn)
    except BaseException:
        conn.execute(
            "UPDATE ingest_runs SET finished_at = ?, status = 'failed',"
            " new_filings = ?, rows_loaded = ?, parse_failures = ?"
            " WHERE run_id = ?",
            (now(), imported, imported, invalid_count, run_id),
        )
        raise

    excluded_invalid = invalid_count
    conn.execute(
        "UPDATE ingest_runs SET finished_at = ?, status = ?, new_filings = ?,"
        " rows_loaded = ?, parse_failures = ? WHERE run_id = ?",
        (
            now(),
            "ok" if excluded_invalid == 0 else "partial",
            imported,
            imported,
            excluded_invalid,
            run_id,
        ),
    )
    return BackfillReport(
        run_id=run_id,
        total=len(records),
        imported=imported,
        excluded_oge=excluded_oge,
        excluded_invalid=excluded_invalid,
        invalid_samples=tuple(invalid_samples),
        crosswalk_retired=retired,
    )


def format_backfill_summary(report: BackfillReport) -> str:
    lines = [
        "backfill kadoa"
        f" | total {report.total}"
        f" | imported {report.imported}"
        f" | excluded_oge {report.excluded_oge}"
        f" | excluded_invalid {report.excluded_invalid}"
        f" | crosswalk_retired {report.crosswalk_retired}"
    ]
    for sample in report.invalid_samples:
        lines.append(f"  invalid: {sample}")
    lines.append(
        f"run {report.run_id}: reconciled={'yes' if report.reconciled else 'NO'}"
    )
    return "\n".join(lines)


# --- crosswalk -----------------------------------------------------------


# The primary filing_id derived from a kadoa filing_id in pure SQL:
# 'kadoa:house_20035047_t2' → strip the 'kadoa:' prefix, rtrim the trailing
# generation digits, drop the trailing '_<g|t>', then turn the chamber
# separator '_' into ':' → 'house:20035047'. The document key contains no
# '_' (numeric DocID or hyphenated uuid), so the single remaining underscore
# is the chamber separator. This lets the crosswalk join kadoa→primary in
# one set-based statement (no per-row Python derivation).
_DERIVED_PRIMARY_ID = (
    "replace("
    " substr("
    "  rtrim(substr(k.filing_id, 7), '0123456789'),"
    "  1,"
    "  length(rtrim(substr(k.filing_id, 7), '0123456789')) - 2"
    " ), '_', ':')"
)


def apply_crosswalk(conn: sqlite3.Connection) -> int:
    """Retire kadoa filings whose primary filing parsed (§9.6 lineage).

    ONE set-based ``UPDATE … FROM`` (no per-row execution, row-count
    agnostic): every active kadoa filing is joined to a primary whose
    filing_id equals the SQL-derived document identity
    (``<chamber>:<key>``) and whose ``doc_url`` equals the kadoa filing's —
    the doc_url cross-check — and whose ``parse_status IN
    ('parsed','partial')``. Matched filings get ``lifecycle='retired'`` +
    ``primary_filing_id`` in one statement inside one transaction;
    tombstones retained; idempotent (already-retired filings are excluded by
    ``k.lifecycle = 'active'``).
    """
    conn.execute("BEGIN IMMEDIATE")
    try:
        cursor = conn.execute(
            f"""
            UPDATE filings
            SET lifecycle = 'retired', primary_filing_id = m.primary_id
            FROM (
                SELECT k.filing_id AS kadoa_id, p.filing_id AS primary_id
                FROM filings k
                JOIN filings p
                  ON p.filing_id = {_DERIVED_PRIMARY_ID}
                 AND p.doc_url = k.doc_url
                 AND p.parse_status IN ('parsed', 'partial')
                WHERE k.source = 'kadoa' AND k.lifecycle = 'active'
            ) AS m
            WHERE filings.filing_id = m.kadoa_id
            """  # nosec B608 — no interpolation: _DERIVED_PRIMARY_ID is a
            # fixed module constant of SQL string functions, not caller input.
        )
        retired = cursor.rowcount
        conn.execute("COMMIT")
    except BaseException:
        conn.execute("ROLLBACK")
        raise
    return retired


# --- strata ----------------------------------------------------------

# Version-controlled equity classifier over the printed asset_type
# vocabulary — never `ticker IS NOT NULL` (ticker presence cuts across asset
# classes in the cache: tickered bonds, untickered stock). `unknown` covers
# unmapped codes and absent asset_type and is audited as its own stratum.
EQUITY_CLASS_MAP: dict[str, str] = {
    # House PTR asset-type codes.
    "ST": "equity",  # stocks (incl. ADRs)
    "PS": "equity",  # stock, not publicly traded
    "GS": "non_equity",  # government securities
    "CS": "non_equity",  # corporate securities (bonds/notes)
    "OP": "non_equity",  # options
    "HN": "unknown",
    "OL": "unknown",
    "OI": "unknown",
    "OT": "unknown",  # "other" — class unverifiable from the code alone
    # Senate eFD printed Asset Type labels.
    "Stock": "equity",
    "Municipal Security": "non_equity",
    "Corporate Bond": "non_equity",
}


def equity_class(asset_type: str | None) -> str:
    """``equity`` / ``non_equity`` / ``unknown`` from the printed type."""
    if asset_type is None:
        return "unknown"
    return EQUITY_CLASS_MAP.get(asset_type, "unknown")


# §9.6 year bands over filed_date. A year outside the banded range is a
# loud error, never a silent mis-stratification.
_YEAR_BANDS = (
    (2012, 2015, "2012-15"),
    (2016, 2019, "2016-19"),
    (2020, 2023, "2020-23"),
    (2024, 2026, "2024-26"),
)


def year_band(filed_date: str) -> str:
    year = int(filed_date[:4])
    for low, high, label in _YEAR_BANDS:
        if low <= year <= high:
            return label
    raise ValueError(f"filed_date {filed_date!r} is outside the §9.6 year bands")


def row_stratum(chamber: str, filed_date: str, asset_type: str | None) -> str:
    """The shared stratum key: ``chamber|year-band|equity-class``."""
    return f"{chamber}|{year_band(filed_date)}|{equity_class(asset_type)}"


def _stratum_grid() -> list[str]:
    return [
        f"{chamber}|{band}|{cls}"
        for chamber in ("house", "senate")
        for _, _, band in _YEAR_BANDS
        for cls in ("equity", "non_equity", "unknown")
    ]


# --- population binding -------------------------------------------------

SNAPSHOT_FIELDS = (
    "txn_id",
    "kadoa_id",
    "ticker",
    "side",
    "amount_low",
    "amount_high",
    "transaction_date",
    "filed_date",
    "filer_name_raw",
    "chamber",
    "asset_type",
    "doc_url",
)


def population_snapshot(conn: sqlite3.Connection) -> list[dict]:
    """The ordered immutable population: every imported kadoa transaction,
    sorted by ``txn_id``, projected onto the twelve pinned fields —
    including ``asset_type`` (the equity-class input) and ``doc_url`` (the
    human auditor's verification target)."""
    rows = conn.execute(
        """
        SELECT t.txn_id, t.kadoa_id, t.ticker, t.side, t.amount_low,
               t.amount_high, t.transaction_date, t.filed_date,
               f.filer_name_raw, t.chamber, t.asset_type, f.doc_url
        FROM transactions t JOIN filings f ON f.filing_id = t.filing_id
        WHERE t.source = 'kadoa'
        ORDER BY t.txn_id
        """
    ).fetchall()
    return [dict(zip(SNAPSHOT_FIELDS, row, strict=True)) for row in rows]


def population_digest(conn: sqlite3.Connection) -> str:
    """SHA-256 over the RFC 8785 (JCS) serialization of the snapshot."""
    snapshot = population_snapshot(conn)
    return hashlib.sha256(canonical_json({"rows": snapshot})).hexdigest()


def ids_digest(txn_ids) -> str:
    """SHA-256 over the RFC 8785 (JCS) serialization of the sorted ``txn_id``
    **list**.

    The digest is over the sorted list itself — not an object wrapping it —
    so an independent implementation of the sealed-record protocol that
    hashes ``JCS(sorted(ids))`` computes the identical value. The JCS
    serialization of a JSON array of strings is exactly ``["a","b",…]`` with
    no whitespace, fully specified by RFC 8785.
    """
    return hashlib.sha256(rfc8785.dumps(sorted(txn_ids))).hexdigest()


# --- deterministic sampler ---------------------------------------

# Pinned instrument sizes (§9.6). The scorer reads THESE, never worksheet
# metadata; the draw command exposes no size flag.
SRS_N = 150
MIN_PER_STRATUM = 5
FOLLOWUP_N = 60

AUDIT_MODES = ("initial", "redraw", "stratum-followup")
ALGORITHM_VERSION = "backfill-audit-1.0.0"
WORKSHEET_VERSION = "backfill-audit-worksheet-1"
RECORD_VERSION = "backfill-audit-record-1"

CRITICAL_FIELDS = (
    "member_identity",
    "ticker",
    "side",
    "amount",
    "transaction_date",
    "filed_date",
)


@dataclass(frozen=True)
class DrawnSample:
    mode: str
    seed: int
    stratum: str | None
    exclude: frozenset[str]
    srs: tuple[str, ...]  # sorted; empty in stratum-followup mode
    quota: Mapping[str, tuple[str, ...]]  # stratum → sorted ids; {} in follow-up
    followup: tuple[str, ...]  # sorted; empty in initial/redraw
    empty_strata: tuple[str, ...]

    def all_ids(self) -> frozenset[str]:
        ids: set[str] = set(self.srs) | set(self.followup)
        for quota_ids in self.quota.values():
            ids.update(quota_ids)
        return frozenset(ids)


def select_sample(
    conn: sqlite3.Connection,
    *,
    mode: str,
    seed: int,
    exclude: frozenset[str] = frozenset(),
    stratum: str | None = None,
) -> DrawnSample:
    """The single deterministic sampler, reused by draw AND score.

    ``initial``/``redraw``: uniform SRS of exactly ``SRS_N`` plus independent
    per-stratum quotas of exactly ``MIN_PER_STRATUM`` over the non-empty
    strata; ``redraw`` draws from the population minus the excluded failed
    SRS. ``stratum-followup``: exactly ``FOLLOWUP_N`` uniform within one
    named stratum. **Sizes are pinned, never census-clamped**: when the
    eligible pool cannot supply the pinned size — the whole population for
    the SRS, the named stratum for a follow-up, or a non-empty stratum for
    its quota — the draw raises rather than silently shrinking, so an
    undersized instrument can never be produced or reconstructed.
    """
    if not isinstance(seed, int) or isinstance(seed, bool) or seed < 0:
        raise ValueError(f"seed must be a non-negative integer, got {seed!r}")
    if mode not in AUDIT_MODES:
        raise ValueError(f"unknown audit mode {mode!r}")
    exclude = frozenset(exclude)
    if mode == "initial" and exclude:
        raise ValueError("initial mode takes no exclusion set")
    if mode == "redraw" and not exclude:
        raise ValueError("redraw mode requires the prior failed SRS as exclude")
    if mode == "stratum-followup":
        if stratum is None:
            raise ValueError("stratum-followup mode requires a stratum")
        if exclude:
            raise ValueError("stratum-followup mode takes no exclusion set")
    elif stratum is not None:
        raise ValueError(f"{mode} mode takes no stratum")

    snapshot = population_snapshot(conn)
    if not snapshot:
        raise ValueError("empty audit population: no imported kadoa rows")
    strata: dict[str, list[str]] = {}
    for row in snapshot:  # snapshot is txn_id-ordered → pools are deterministic
        key = row_stratum(row["chamber"], row["filed_date"], row["asset_type"])
        strata.setdefault(key, []).append(row["txn_id"])
    empty_strata = tuple(s for s in _stratum_grid() if s not in strata)

    rng = random.Random(seed)
    if mode == "stratum-followup":
        pool = [t for t in strata.get(stratum, []) if t not in exclude]
        if len(pool) < FOLLOWUP_N:
            raise ValueError(
                f"stratum {stratum!r} has {len(pool)} eligible rows,"
                f" fewer than the pinned follow-up size {FOLLOWUP_N}"
            )
        drawn = tuple(sorted(rng.sample(pool, FOLLOWUP_N)))
        return DrawnSample(
            mode=mode,
            seed=seed,
            stratum=stratum,
            exclude=exclude,
            srs=(),
            quota={},
            followup=drawn,
            empty_strata=empty_strata,
        )

    pool = [row["txn_id"] for row in snapshot if row["txn_id"] not in exclude]
    if len(pool) < SRS_N:
        raise ValueError(
            f"population has {len(pool)} eligible rows, fewer than the pinned"
            f" SRS size {SRS_N} — the audit cannot be drawn"
        )
    srs = tuple(sorted(rng.sample(pool, SRS_N)))
    quota: dict[str, tuple[str, ...]] = {}
    for stratum_key in sorted(strata):
        stratum_pool = [t for t in strata[stratum_key] if t not in exclude]
        if not stratum_pool:
            continue  # empty after exclusion → reported as empty, not sampled
        if len(stratum_pool) < MIN_PER_STRATUM:
            raise ValueError(
                f"stratum {stratum_key!r} has {len(stratum_pool)} eligible"
                f" rows, fewer than the pinned quota {MIN_PER_STRATUM}"
            )
        quota[stratum_key] = tuple(sorted(rng.sample(stratum_pool, MIN_PER_STRATUM)))
    return DrawnSample(
        mode=mode,
        seed=seed,
        stratum=None,
        exclude=exclude,
        srs=srs,
        quota=quota,
        followup=(),
        empty_strata=empty_strata,
    )


# --- worksheet ---------------------------------------------------


def _blank_verification() -> dict:
    cells = {name: "" for name in CRITICAL_FIELDS}
    cells.update({"cosmetic": "", "note": "", "verified_by": "", "verified_at": ""})
    return cells


def _worksheet_row(db_row: Mapping, amount_label: str | None) -> dict:
    row = {name: db_row[name] for name in SNAPSHOT_FIELDS}
    row["filing_id"] = db_row["txn_id"].rsplit(":", 1)[0]
    row["amount_label"] = amount_label
    row["stratum"] = row_stratum(
        db_row["chamber"], db_row["filed_date"], db_row["asset_type"]
    )
    row["verification"] = _blank_verification()
    return row


def build_audit_worksheet(
    conn: sqlite3.Connection,
    *,
    mode: str,
    seed: int = 0,
    exclude: Sequence[str] = (),
    stratum: str | None = None,
    run_id: str | None = None,
) -> dict:
    """Draw via :func:`select_sample` and render the reviewable worksheet.

    The worksheet embeds the population digest and the drawn ``txn_id`` set
    per instrument — both cross-checked by the scorer against its own
    reconstruction; nothing here is trusted on its own. The sealed draw
    record, not this file, is the authenticated draw specification.
    """
    sample = select_sample(
        conn, mode=mode, seed=seed, exclude=frozenset(exclude), stratum=stratum
    )
    digest = population_digest(conn)
    rows_by_id = {row["txn_id"]: row for row in population_snapshot(conn)}
    labels = dict(
        conn.execute(
            "SELECT txn_id, amount_label FROM transactions WHERE source = 'kadoa'"
        ).fetchall()
    )

    def rows_for(txn_ids: Sequence[str]) -> list[dict]:
        return [_worksheet_row(rows_by_id[t], labels.get(t)) for t in txn_ids]

    if mode == "stratum-followup":
        instruments: dict = {
            "followup": {"stratum": sample.stratum, "rows": rows_for(sample.followup)}
        }
    else:
        instruments = {
            "srs": {"rows": rows_for(sample.srs)},
            "quota": {
                stratum_key: {"rows": rows_for(ids)}
                for stratum_key, ids in sample.quota.items()
            },
        }
    return {
        "worksheet_version": WORKSHEET_VERSION,
        "algorithm_version": ALGORITHM_VERSION,
        "mode": sample.mode,
        "seed": sample.seed,
        "stratum": sample.stratum,
        "exclude_txn_ids": sorted(sample.exclude),
        "draw_run_id": run_id,
        "population_digest": digest,
        "pinned_sizes": {
            "srs_n": SRS_N,
            "min_per_stratum": MIN_PER_STRATUM,
            "followup_n": FOLLOWUP_N,
        },
        "empty_strata": list(sample.empty_strata),
        "instruments": instruments,
    }


def build_draw_record(worksheet: Mapping) -> dict:
    """The sealed draw specification for a freshly built worksheet.

    Written beside the worksheet and hash-anchored into ``ingest_runs`` at
    draw time; the scorer authenticates it and reconstructs the draw from
    it, never from the editable worksheet.
    """
    drawn: set[str] = set()
    instruments = worksheet["instruments"]
    for name, payload in instruments.items():
        if name == "quota":
            for entry in payload.values():
                drawn.update(row["txn_id"] for row in entry["rows"])
        else:
            drawn.update(row["txn_id"] for row in payload["rows"])
    exclusion = worksheet.get("exclude_txn_ids") or []
    return {
        "record_version": RECORD_VERSION,
        "algorithm_version": ALGORITHM_VERSION,
        "run_id": worksheet.get("draw_run_id"),
        "mode": worksheet["mode"],
        "seed": worksheet["seed"],
        "stratum": worksheet.get("stratum"),
        "pinned_sizes": {
            "srs_n": SRS_N,
            "min_per_stratum": MIN_PER_STRATUM,
            "followup_n": FOLLOWUP_N,
        },
        "exclusion_ids_digest": ids_digest(exclusion) if exclusion else None,
        "population_digest": worksheet["population_digest"],
        "drawn_ids_digest": ids_digest(drawn),
    }


_MD_COLUMNS = (
    "txn_id",
    "kadoa_id",
    "filer_name_raw",
    "chamber",
    "transaction_date",
    "filed_date",
    "ticker",
    "side",
    "amount_label",
    "asset_type",
    "stratum",
    "doc_url",
)
_MD_VERIFY = (*CRITICAL_FIELDS, "cosmetic", "note", "verified_by", "verified_at")


def render_worksheet_md(worksheet: Mapping) -> str:
    """Human-reviewable Markdown twin of the worksheet JSON.

    The JSON file is what the scorer consumes; this rendering is for the
    reviewer's eyes (doc links, blank verification columns).
    """

    def table(rows: Sequence[Mapping]) -> list[str]:
        header = (
            "| " + " | ".join(_MD_COLUMNS) + " | " + " | ".join(_MD_VERIFY) + " |"
        )
        rule = "|" + "---|" * (len(_MD_COLUMNS) + len(_MD_VERIFY))
        lines = [header, rule]
        for row in rows:
            display = [str(row.get(c, "")) if row.get(c) is not None else "" for c in _MD_COLUMNS]
            lines.append("| " + " | ".join(display) + " |" + " |" * len(_MD_VERIFY))
        return lines

    lines = [
        f"# kadoa backfill audit worksheet — mode `{worksheet['mode']}`",
        "",
        f"- population_digest: `{worksheet['population_digest']}`",
        f"- draw_run_id: `{worksheet.get('draw_run_id')}`",
        f"- seed: {worksheet['seed']}",
        "- verdict vocabulary: critical cells `ok`/`error`/`na` (`na` needs a"
        " note); cosmetic `none`/`error` (`error` needs a note); fill"
        " `verified_by`/`verified_at` on every row.",
        "",
    ]
    instruments = worksheet["instruments"]
    if "srs" in instruments:
        lines += [f"## SRS (n={len(instruments['srs']['rows'])})", ""]
        lines += table(instruments["srs"]["rows"])
        for stratum_key in sorted(instruments.get("quota", {})):
            rows = instruments["quota"][stratum_key]["rows"]
            lines += ["", f"## Quota `{stratum_key}` (n={len(rows)})", ""]
            lines += table(rows)
        empty = worksheet.get("empty_strata") or []
        lines += ["", f"## Empty strata ({len(empty)})", ""]
        lines += [f"- `{s}`" for s in empty]
    else:
        payload = instruments["followup"]
        lines += [
            f"## Stratum follow-up `{payload['stratum']}`"
            f" (n={len(payload['rows'])})",
            "",
        ]
        lines += table(payload["rows"])
    return "\n".join(lines) + "\n"


@dataclass(frozen=True)
class DrawResult:
    worksheet: dict
    record: dict
    worksheet_json_path: Path
    worksheet_md_path: Path
    record_path: Path
    record_sha256: str


def run_audit_draw(
    conn: sqlite3.Connection,
    *,
    out_dir: Path | str,
    mode: str,
    seed: int,
    exclude: Sequence[str] = (),
    stratum: str | None = None,
    run_id: str,
    now,
    host: str,
) -> DrawResult:
    """Draw, write worksheet JSON+MD plus the sealed record, and anchor the
    record's file hash into ``ingest_runs``."""
    worksheet = build_audit_worksheet(
        conn, mode=mode, seed=seed, exclude=exclude, stratum=stratum, run_id=run_id
    )
    record = build_draw_record(worksheet)
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    worksheet_json_path = out_dir / f"worksheet.{run_id}.json"
    worksheet_md_path = out_dir / f"worksheet.{run_id}.md"
    record_path = out_dir / f"draw-record.{run_id}.json"
    worksheet_json_path.write_text(
        json.dumps(worksheet, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    worksheet_md_path.write_text(render_worksheet_md(worksheet), encoding="utf-8")
    record_bytes = (
        json.dumps(record, ensure_ascii=False, indent=2, sort_keys=True) + "\n"
    ).encode("utf-8")
    record_path.write_bytes(record_bytes)
    record_sha256 = hashlib.sha256(record_bytes).hexdigest()
    timestamp = now()
    conn.execute(
        "INSERT INTO ingest_runs (run_id, job, started_at, finished_at, status,"
        " host, log_ref) VALUES (?, 'backfill-audit-draw', ?, ?, 'ok', ?, ?)",
        (run_id, timestamp, timestamp, host, f"draw-record:sha256:{record_sha256}"),
    )
    return DrawResult(
        worksheet=worksheet,
        record=record,
        worksheet_json_path=worksheet_json_path,
        worksheet_md_path=worksheet_md_path,
        record_path=record_path,
        record_sha256=record_sha256,
    )


# --- scorer ---------------------------------------------


@dataclass(frozen=True)
class AuditDisposition:
    status: str  # 'pass' | 'fail' | 'incomplete' | 'invalid'
    required_actions: frozenset[str]
    mode: str | None
    critical_errors_by_instrument: Mapping[str, int] = field(default_factory=dict)
    critical_errors_by_stratum: Mapping[str, int] = field(default_factory=dict)
    cosmetic_rate: float | None = None
    integrity: tuple[str, ...] = ()
    completeness: tuple[str, ...] = ()
    binomial_upper_bound: float | None = None


def _invalid(mode: str | None, reasons: Sequence[str]) -> AuditDisposition:
    return AuditDisposition(
        status="invalid",
        required_actions=frozenset({"redraw_clean"}),
        mode=mode,
        integrity=tuple(reasons),
    )


def _incomplete(mode: str | None, shortfalls: Sequence[str]) -> AuditDisposition:
    return AuditDisposition(
        status="incomplete",
        required_actions=frozenset(),
        mode=mode,
        completeness=tuple(shortfalls),
    )


def _instrument_rows(worksheet: Mapping) -> dict[str, list[Mapping]]:
    """``instrument name → rows`` over whatever instruments are present."""
    instruments = worksheet.get("instruments") or {}
    rows: dict[str, list[Mapping]] = {}
    if "srs" in instruments:
        rows["srs"] = list((instruments["srs"] or {}).get("rows") or [])
    for stratum_key, payload in ((instruments.get("quota") or {})).items():
        rows[f"quota:{stratum_key}"] = list((payload or {}).get("rows") or [])
    if "followup" in instruments:
        rows["followup"] = list((instruments["followup"] or {}).get("rows") or [])
    return rows


def score_audit(
    filled_worksheet: Mapping,
    conn: sqlite3.Connection,
    *,
    draw_record_bytes: bytes,
    prior_failed_worksheet: Mapping | None = None,
) -> AuditDisposition:
    """The §9.6 gate scorer: ordered, fail-closed evaluation.

    (1) mode + pinned sizes → (2) population digest → (3) sealed-record
    authentication + independent draw reconstruction (+ redraw exclusion/
    disjointness) → (4) per-row source-value and stratum re-read → (5) cell
    completeness → (6) required-stratum-set equality → (7) thresholds →
    (8) pass. Steps 1–6 yield ``incomplete`` or ``invalid`` with the
    shortfall enumerated and NO threshold claim and NO binomial bound.
    """
    # -- step 1: mode + pinned-size enforcement -------------------------
    mode = filled_worksheet.get("mode")
    if mode not in AUDIT_MODES:
        return _invalid(None, (f"unknown_mode:{mode!r}",))
    snapshot = population_snapshot(conn)
    population = len(snapshot)
    strata_ids: dict[str, set[str]] = {}
    for row in snapshot:
        key = row_stratum(row["chamber"], row["filed_date"], row["asset_type"])
        strata_ids.setdefault(key, set()).add(row["txn_id"])
    strata_sizes = {key: len(ids) for key, ids in strata_ids.items()}
    declared_exclusion = frozenset(filled_worksheet.get("exclude_txn_ids") or [])

    instrument_rows = _instrument_rows(filled_worksheet)
    shortfalls: list[str] = []
    if mode in ("initial", "redraw"):
        # Required sizes are the PINNED CONSTANTS, read directly — never
        # census-clamped to the population and never taken from worksheet
        # metadata. If the eligible pool cannot even supply the pinned
        # size, the audit cannot be satisfied — that is itself a shortfall,
        # so a too-small population fails closed here rather than passing an
        # undersized instrument. For a redraw the pool excludes the declared
        # failed SRS; the declared exclusion is authenticated in step 3.
        exclusion = declared_exclusion if mode == "redraw" else frozenset()
        available = population - len(exclusion)
        if available < SRS_N:
            shortfalls.append(f"population_too_small:{available}<{SRS_N}")
        got_srs = len(instrument_rows.get("srs", []))
        if got_srs < SRS_N:
            shortfalls.append(f"srs_undersized:{got_srs}<{SRS_N}")
        for name, rows in instrument_rows.items():
            if not name.startswith("quota:"):
                continue
            stratum_key = name.split(":", 1)[1]
            if len(rows) < MIN_PER_STRATUM:
                shortfalls.append(
                    f"quota_undersized:{stratum_key}:{len(rows)}<{MIN_PER_STRATUM}"
                )
    else:
        declared_stratum = filled_worksheet.get("stratum")
        if declared_stratum is None:
            return _incomplete(mode, ("missing_stratum_declaration",))
        if declared_stratum not in strata_sizes:
            return _invalid(mode, (f"unknown_stratum:{declared_stratum!r}",))
        if strata_sizes[declared_stratum] < FOLLOWUP_N:
            shortfalls.append(
                f"stratum_too_small:{declared_stratum}:"
                f"{strata_sizes[declared_stratum]}<{FOLLOWUP_N}"
            )
        got = len(instrument_rows.get("followup", []))
        if got < FOLLOWUP_N:
            shortfalls.append(f"followup_undersized:{got}<{FOLLOWUP_N}")
    if shortfalls:
        return _incomplete(mode, shortfalls)

    # -- step 2: population-digest recompute ----------------------------
    recomputed_digest = hashlib.sha256(
        canonical_json({"rows": snapshot})
    ).hexdigest()
    if filled_worksheet.get("population_digest") != recomputed_digest:
        return _invalid(mode, ("population_digest_mismatch",))

    # -- step 3: sealed-record authentication + reconstruction ----------
    try:
        record = json.loads(draw_record_bytes)
    except ValueError:
        return _invalid(mode, ("draw_record_unreadable",))
    if not isinstance(record, dict):
        return _invalid(mode, ("draw_record_unreadable",))
    anchored = conn.execute(
        "SELECT log_ref FROM ingest_runs"
        " WHERE run_id = ? AND job = 'backfill-audit-draw'",
        (record.get("run_id"),),
    ).fetchone()
    actual_sha = hashlib.sha256(draw_record_bytes).hexdigest()
    if anchored is None or anchored[0] != f"draw-record:sha256:{actual_sha}":
        return _invalid(mode, ("draw_record_mismatch",))
    if record.get("population_digest") != recomputed_digest:
        return _invalid(mode, ("draw_record_population_mismatch",))
    if record.get("mode") != mode:
        return _invalid(mode, ("draw_record_mode_mismatch",))
    record_stratum = record.get("stratum")
    if mode == "stratum-followup" and record_stratum != filled_worksheet.get("stratum"):
        return _invalid(mode, ("draw_record_stratum_mismatch",))

    exclusion: frozenset[str] = frozenset()
    if mode == "redraw":
        if prior_failed_worksheet is None:
            return _invalid(mode, ("missing_prior_failed_worksheet",))
        prior_mode = prior_failed_worksheet.get("mode")
        prior_seed = prior_failed_worksheet.get("seed")
        prior_exclude = frozenset(prior_failed_worksheet.get("exclude_txn_ids") or [])
        if prior_mode not in ("initial", "redraw"):
            return _invalid(mode, (f"prior_worksheet_mode:{prior_mode!r}",))
        try:
            prior_sample = select_sample(
                conn, mode=prior_mode, seed=prior_seed, exclude=prior_exclude
            )
        except (ValueError, TypeError) as exc:
            return _invalid(mode, (f"prior_reconstruction_failed:{exc}",))
        failed_srs = frozenset(prior_sample.srs)
        if record.get("exclusion_ids_digest") != ids_digest(failed_srs):
            return _invalid(mode, ("exclusion_lineage_mismatch",))
        if declared_exclusion != failed_srs:
            return _invalid(mode, ("exclusion_set_mismatch",))
        exclusion = failed_srs

    try:
        expected = select_sample(
            conn,
            mode=mode,
            seed=record.get("seed"),
            exclude=exclusion,
            stratum=record_stratum,
        )
    except (ValueError, TypeError) as exc:
        return _invalid(mode, (f"reconstruction_failed:{exc}",))
    if record.get("drawn_ids_digest") != ids_digest(expected.all_ids()):
        return _invalid(mode, ("draw_record_drawn_ids_mismatch",))

    # The filled rows contribute answers only, joined by txn_id: each present
    # instrument's id set must equal the reconstruction exactly — duplicates,
    # substitutions, missing rows, and extra rows all fail.
    reconstruction_errors: list[str] = []

    def check_ids(name: str, rows: Sequence[Mapping], expected_ids: Sequence[str]):
        ids = [row.get("txn_id") for row in rows]
        if len(ids) != len(set(ids)):
            reconstruction_errors.append(f"duplicate_rows:{name}")
        if set(ids) != set(expected_ids):
            reconstruction_errors.append(f"reconstruction_mismatch:{name}")

    if mode == "stratum-followup":
        check_ids("followup", instrument_rows.get("followup", []), expected.followup)
    else:
        check_ids("srs", instrument_rows.get("srs", []), expected.srs)
        for name, rows in instrument_rows.items():
            if not name.startswith("quota:"):
                continue
            stratum_key = name.split(":", 1)[1]
            if stratum_key in expected.quota:
                check_ids(name, rows, expected.quota[stratum_key])
            else:
                reconstruction_errors.append(f"unexpected_stratum:{stratum_key}")
        if mode == "redraw" and exclusion & {
            row.get("txn_id") for rows in instrument_rows.values() for row in rows
        }:
            reconstruction_errors.append("redraw_overlaps_failed_sample")
    if reconstruction_errors:
        return _invalid(mode, tuple(reconstruction_errors))

    # -- step 4: per-row source-value and stratum re-read -----------
    db_rows = {row["txn_id"]: row for row in snapshot}
    labels = dict(
        conn.execute(
            "SELECT txn_id, amount_label FROM transactions WHERE source = 'kadoa'"
        ).fetchall()
    )
    integrity_errors: list[str] = []
    for name, rows in instrument_rows.items():
        for row in rows:
            txn_id = row.get("txn_id")
            db_row = db_rows.get(txn_id)
            if db_row is None:
                integrity_errors.append(f"unknown_txn_id:{txn_id}")
                continue
            for field_name in SNAPSHOT_FIELDS:
                if row.get(field_name) != db_row[field_name]:
                    integrity_errors.append(
                        f"row_value_edited:{txn_id}:{field_name}"
                    )
            if row.get("amount_label") != labels.get(txn_id):
                integrity_errors.append(f"row_value_edited:{txn_id}:amount_label")
            derived = row_stratum(
                db_row["chamber"], db_row["filed_date"], db_row["asset_type"]
            )
            if row.get("stratum") != derived:
                integrity_errors.append(f"stratum_mismatch:{txn_id}")
    if integrity_errors:
        return _invalid(mode, tuple(integrity_errors))

    # -- step 5: cell parsing and per-row completeness ------------------
    unverified: list[str] = []
    for name, rows in instrument_rows.items():
        for row in rows:
            cells = row.get("verification") or {}
            note = (cells.get("note") or "").strip()
            problems = []
            for field_name in CRITICAL_FIELDS:
                verdict = cells.get(field_name)
                if verdict not in ("ok", "error", "na"):
                    problems.append(field_name)
                elif verdict == "na" and not note:
                    problems.append(f"{field_name}:na_without_note")
            cosmetic = cells.get("cosmetic")
            if cosmetic not in ("none", "error"):
                problems.append("cosmetic")
            elif cosmetic == "error" and not note:
                problems.append("cosmetic:error_without_note")
            if not (cells.get("verified_by") or "").strip():
                problems.append("verified_by")
            if not (cells.get("verified_at") or "").strip():
                problems.append("verified_at")
            if problems:
                unverified.append(f"{row.get('txn_id')}:{'+'.join(problems)}")
    if unverified:
        return _incomplete(mode, tuple(f"unverified_row:{u}" for u in unverified))

    # -- step 6: required-stratum-set exact equality --------------------
    if mode in ("initial", "redraw"):
        expected_strata = set(expected.quota)
        got_strata = {
            name.split(":", 1)[1]
            for name in instrument_rows
            if name.startswith("quota:")
        }
        if got_strata != expected_strata:
            missing = sorted(expected_strata - got_strata)
            extra = sorted(got_strata - expected_strata)
            return _incomplete(
                mode,
                (f"stratum_set_mismatch:missing={missing}:extra={extra}",),
            )
        if tuple(filled_worksheet.get("empty_strata") or ()) != expected.empty_strata:
            return _incomplete(mode, ("empty_strata_mismatch",))

    # -- step 7: thresholds ---------------------------------------------
    critical_by_instrument: dict[str, int] = {}
    critical_by_stratum: dict[str, int] = {}
    cosmetic_errors = 0
    total_rows = 0
    for name, rows in instrument_rows.items():
        instrument = "quota" if name.startswith("quota:") else name
        for row in rows:
            total_rows += 1
            cells = row["verification"]
            row_criticals = sum(
                1 for field_name in CRITICAL_FIELDS if cells[field_name] == "error"
            )
            if row_criticals:
                critical_by_instrument[instrument] = (
                    critical_by_instrument.get(instrument, 0) + row_criticals
                )
                db_row = db_rows[row["txn_id"]]
                stratum_key = row_stratum(
                    db_row["chamber"], db_row["filed_date"], db_row["asset_type"]
                )
                critical_by_stratum[stratum_key] = (
                    critical_by_stratum.get(stratum_key, 0) + row_criticals
                )
            if cells["cosmetic"] == "error":
                cosmetic_errors += 1
    cosmetic_rate = cosmetic_errors / total_rows if total_rows else 0.0

    actions: set[str] = set()
    if critical_by_instrument:
        # Cumulative, never alternatives (§9.6:558): every critical error
        # requires investigation AND a fresh disjoint SRS redraw; each
        # stratum containing an error additionally requires its n=60
        # follow-up.
        actions.add("investigate_and_fix")
        actions.add("redraw_srs")
        for stratum_key in critical_by_stratum:
            actions.add(f"stratum_followup:{stratum_key}")
    if cosmetic_rate > 0.05:
        actions.add("remediate_cosmetic")
    if actions:
        return AuditDisposition(
            status="fail",
            required_actions=frozenset(actions),
            mode=mode,
            critical_errors_by_instrument=dict(critical_by_instrument),
            critical_errors_by_stratum=dict(critical_by_stratum),
            cosmetic_rate=cosmetic_rate,
        )

    # -- step 8: pass ---------------------------------------------------------
    bound = None
    if mode in ("initial", "redraw"):
        bound = 1.0 - 0.05 ** (1.0 / len(expected.srs))
    return AuditDisposition(
        status="pass",
        required_actions=frozenset(),
        mode=mode,
        critical_errors_by_instrument={},
        critical_errors_by_stratum={},
        cosmetic_rate=cosmetic_rate,
        binomial_upper_bound=bound,
    )


def format_disposition(disposition: AuditDisposition) -> str:
    lines = [
        f"backfill-audit score: {disposition.status.upper()}"
        f" (mode {disposition.mode})"
    ]
    if disposition.required_actions:
        lines.append(
            "required actions: " + ", ".join(sorted(disposition.required_actions))
        )
    if disposition.integrity:
        lines.append("integrity: " + "; ".join(disposition.integrity[:10]))
    if disposition.completeness:
        lines.append("completeness: " + "; ".join(disposition.completeness[:10]))
    if disposition.critical_errors_by_stratum:
        lines.append(
            "critical errors by stratum: "
            + ", ".join(
                f"{k}={v}"
                for k, v in sorted(disposition.critical_errors_by_stratum.items())
            )
        )
    if disposition.cosmetic_rate is not None:
        lines.append(f"cosmetic rate: {disposition.cosmetic_rate:.4f}")
    if disposition.binomial_upper_bound is not None:
        lines.append(
            "one-sided 95% upper bound on the population critical-error"
            f" rate: {disposition.binomial_upper_bound:.4f}"
        )
    return "\n".join(lines)
