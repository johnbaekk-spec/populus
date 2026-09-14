"""Withhold CUSIPs of reviewed-ticker securities from the published inst artifacts.

Refinement 20260910 C1 (owner decision 2026-09-11: HIDE CUSIP where a verified
ticker exists). The concern is a CUSIP->ticker pairing becoming DERIVABLE from
what Public Filings publishes, so hiding one cell is not enough: every published
key that is the CUSIP, or is computed from it, is withheld for those securities.

What counts as CUSIP-derived here:

* ``cusip`` itself and ``cusip:<cusip>`` position keys;
* ``cusip6:<block>`` issuer keys — the block is the CUSIP's first six characters;
* ``sid:sec:prov:<hex>`` — a provisional security id is
  ``sha256({"id_type": "cusip", "value": <cusip>})[:32]``
  (``identity.registry.provisional_security_id``), unsalted and therefore
  recomputable by anyone holding a CUSIP list. Every ``security_id`` of a
  withheld CUSIP is withheld too, provisional or not.

The withheld set is closed, not per-row: a reviewed (issuer name, class) row
puts its CUSIP in the set; the set then grows to every CUSIP in the same CUSIP-6
block (a sibling's full CUSIP carries the block, and the block is joinable to the
ticker through the shared issuer key or the issuer name) and every CUSIP that
shares a ``security_id`` with a member (a CUSIP change inside one registry
class), until it stops growing.

The pipeline keeps using CUSIPs internally; only the two published databases are
rewritten, AFTER both are built (the serving projection joins the aggregate on
the original keys) and BEFORE their logical digests are taken. Every withheld
key is replaced by an opaque ordinal (``pos:<n>`` / ``iss:<n>``) through one
map shared by both files, so every join between them (``position_key``,
``issuer_key``) still holds. The ordinal carries nothing computable from the
CUSIP. Both files are rewritten with ``secure_delete`` and VACUUMed so no freed
page still holds a withheld value.
"""

from __future__ import annotations

import re
import sqlite3
from collections import defaultdict
from collections.abc import Collection, Iterable, Mapping
from dataclasses import dataclass
from pathlib import Path

from populus.ticker_mapping_13f import (
    TickerMapping,
    load_ticker_mapping,
    mapping_key,
    normalize_issuer_name,
)

__all__ = [
    "WITHHELD_ISSUER_PREFIX",
    "WITHHELD_POSITION_PREFIX",
    "RedactionPlan",
    "WithheldClosure",
    "DISCLOSURE_WITHHELD_TEXT",
    "apply_cusip_redaction",
    "close_withheld_cusips",
    "load_list_issuers",
    "plan_cusip_redaction",
    "scrub_disclosure_text",
]

WITHHELD_POSITION_PREFIX = "pos:"
WITHHELD_ISSUER_PREFIX = "iss:"

#: What replaces a withheld CUSIP that a FILER typed into a text field. Measured,
#: not hypothetical: one manager files its issuer names as CUSIPs
#: ("438516106", class "Stock"), and those rows share a position key with the
#: properly-named rows that carry the ticker — so the pair was still joinable
#: after the key columns were withheld. The marker keeps the row and says why
#: the cell is empty, rather than deleting a filer's reported row.
WITHHELD_TEXT = "(CUSIP withheld)"

#: What replaces a withheld CUSIP that a MEMBER OF CONGRESS typed into the text
#: of a periodic transaction report. Square brackets, not the parentheses of
#: :data:`WITHHELD_TEXT`: `transactions.comment` and `transactions.raw_row` are
#: a VERBATIM quotation of the filer's own document, and square brackets are the
#: editorial convention for an alteration the publisher made. The requirement
#: the marker exists to satisfy (owner decision 2026-09-13) is that the edit be
#: VISIBLE — a silent deletion would leave a fluent sentence that still reads as
#: the member's own words, and a reader could not tell the published text
#: differs from the filing. The receipt link on the row is untouched, so the
#: unaltered source document stays one click away.
DISCLOSURE_WITHHELD_TEXT = "[CUSIP withheld]"

#: Congressional disclosure columns swept for an embedded withheld CUSIP.
#: `comment` is the member's sentence; `raw_row` is the verbatim JSON the row
#: fingerprint was computed over, which carries that same sentence a second
#: time. Both are published in `congress.db`, so both are swept — a marker in
#: one and the CUSIP still in the other would withhold nothing.
_DISCLOSURE_TEXT_COLUMNS = (("transactions", "comment"), ("transactions", "raw_row"))

#: A CUSIP sitting inside a longer filer-written string. Managers describe
#: corporate actions in the issuer-name field — "EXXON MOBIL CORP COM EXCHANGED
#: FOR CUSIP 30233Q108", "HONEYWELL INTL INC R/S EFF 06/29/26 1 NEW CU 438516205
#: …" — and those rows share an opaque position key with the properly-named rows
#: that carry the ticker, so an embedded CUSIP is as joinable as the column was.
#: Token-bounded, matching the probe.
_CUSIP_IN_TEXT_RE = re.compile(r"(?<![0-9A-Za-z])[0-9A-Z]{9}(?![0-9A-Za-z])")
#: An ISIN carries the CUSIP as its middle nine characters ("ISIN#BMG2004J1036").
_ISIN_RE = re.compile(r"(?<![0-9A-Za-z])([A-Z]{2})([0-9A-Z]{9})([0-9])(?![0-9A-Za-z])")

#: Column names rewritten wherever they appear in a published table.
_POSITION_COLUMN = "position_key"
_ISSUER_COLUMN = "issuer_key"
_CUSIP_COLUMN = "cusip"
_SECURITY_COLUMN = "security_id"

#: Handled by their own rules above; every OTHER column is checked for a
#: withheld CUSIP sitting in it as plain text.
_KEY_COLUMNS = frozenset({"cusip", "security_id", "position_key", "issuer_key"})


@dataclass(frozen=True)
class RedactionPlan:
    """The withheld set and the opaque replacement keys (shared by both files)."""

    mapped_cusips: frozenset[str]
    cusips: frozenset[str]
    security_ids: frozenset[str]
    blocks: frozenset[str]
    position_keys: dict[str, str]
    issuer_keys: dict[str, str]
    #: Seeds the SEC-list issuer check refused to propagate. They ARE withheld
    #: (they are in ``cusips``); they must simply never be expanded to a block.
    unverified: frozenset[str] = frozenset()
    #: ``(cusip, filed issuer name, class)`` for each of the above, so the build
    #: record can name the mis-filed row instead of dropping it silently.
    rejected_seeds: tuple[tuple[str, str, str | None], ...] = ()
    #: Seeds the SEC 13(f) list does not carry at all. Unlike the above these
    #: are NOT in ``cusips`` (unless the walk reached them anyway): a CUSIP that
    #: is not a 13(f) security cannot be the matched issuer's.
    absent_seeds: tuple[tuple[str, str, str | None], ...] = ()

    def summary(self) -> dict[str, int]:
        return {
            "mapped_cusips": len(self.mapped_cusips),
            "withheld_cusips": len(self.cusips),
            "withheld_security_ids": len(self.security_ids),
            "withheld_cusip6_blocks": len(self.blocks),
            "opaque_position_keys": len(self.position_keys),
            "opaque_issuer_keys": len(self.issuer_keys),
            "unverified_seeds": len(self.unverified),
            "list_absent_seeds": len(self.absent_seeds),
        }


@dataclass(frozen=True)
class WithheldClosure:
    """The closed withheld set, plus the ticker each member is joinable to.

    ONE implementation of the closure, because there were two and they did not
    agree. `scripts/cusip_join_probe.py` re-derived "what to look for" with a
    single hop — a mapped CUSIP and its CUSIP-6 siblings — while the producer
    closes over the shared-``security_id`` edge as well. A CUSIP reachable only
    through a security-id edge (and the further block that CUSIP then carries)
    was therefore outside the probe's truth set: the producer withheld it, but
    had it LEAKED the probe would have reported zero pairs and the release's
    "0 published pairs" measurement would have been vacuous for that population.
    A verifier that cannot see part of what it verifies is not a verifier, so
    both callers now close over the same edges here.

    ``tickers`` labels every member with the ticker(s) it is joinable to, found
    by walking the same edges out from the mapped rows; a member reached only
    through a security-id edge inherits the label of the row that reached it.

    ``unverified`` are the seeds the SEC-list issuer check refused to propagate
    because the list names a DIFFERENT issuer; they are still members of
    ``cusips``. ``rejected_seeds`` records each one as ``(cusip, filed issuer
    name, class)`` so a caller can name the filing rather than filter it
    silently.

    ``absent_seeds`` are the seeds the list does not carry AT ALL, recorded the
    same way. They are NOT members of ``cusips`` unless the walk independently
    reached them — see :func:`close_withheld_cusips`.
    """

    mapped: frozenset[str]
    cusips: frozenset[str]
    security_ids: frozenset[str]
    blocks: frozenset[str]
    tickers: dict[str, frozenset[str]]
    unverified: frozenset[str] = frozenset()
    rejected_seeds: tuple[tuple[str, str, str | None], ...] = ()
    absent_seeds: tuple[tuple[str, str, str | None], ...] = ()


#: An issuer-name token short enough to be noise ("CO", "SA", "NV", a stray
#: initial) is not evidence either way, so agreement is decided on tokens of at
#: least this length.
_ISSUER_TOKEN_MIN = 3
#: A token may also agree as a PREFIX of the other ("ELEC"/"ELECTRIC",
#: "BUS"/"BUSINESS"), which is how the SEC list abbreviates. Four characters,
#: so "CORP"/"CORPORATION" agrees while a two-letter coincidence cannot.
_ISSUER_PREFIX_MIN = 4


def _issuer_tokens(name: str) -> list[str]:
    return [t for t in normalize_issuer_name(name).split() if len(t) >= _ISSUER_TOKEN_MIN]


def _issuer_names_agree(filed: str, listed: str) -> bool:
    """Do a FILED issuer name and the SEC list's own name describe one issuer?

    NOT string equality, and measuring is why. On the 20260817.1 corpus, exact
    equality after :func:`normalize_issuer_name` separated 493 seed CUSIPs from
    their list rows, and the overwhelming majority were the same issuer spelled
    differently — "Abbott Laboratories - US" against "ABBOTT LABORATORIES",
    "AMERICAN ELECTRIC POWER" against "AMERICAN ELEC PWR". Treating those as
    disagreements would have stopped withholding hundreds of securities that
    genuinely resolve to a reviewed ticker, which is the property inverted.

    So agreement is ONE shared significant token, exact or as a prefix. That is
    deliberately generous: a false AGREEMENT only preserves today's behaviour,
    while a false disagreement costs withholding. It still separates the case
    this exists for — "NORTHERN OIL & GAS INC" against "UNITED STATES TREAS
    NTS" shares nothing — and on the same corpus it cut the 493 to 156, of
    which every one inspected was a filer writing another issuer's CUSIP.
    """
    filed_tokens, listed_tokens = _issuer_tokens(filed), _issuer_tokens(listed)
    if not filed_tokens or not listed_tokens:
        # No significant token on one side is an absence of evidence, not
        # evidence of conflict; fail toward withholding.
        return True
    return any(
        a == b
        or (len(a) >= _ISSUER_PREFIX_MIN and b.startswith(a))
        or (len(b) >= _ISSUER_PREFIX_MIN and a.startswith(b))
        for a in filed_tokens
        for b in listed_tokens
    )


def close_withheld_cusips(
    rows: Iterable[tuple[str | None, str | None, str, str | None]],
    mapping: TickerMapping | None = None,
    list_issuers: Mapping[str, Collection[str]] | None = None,
) -> WithheldClosure:
    """Close the withheld set over ``(issuer_name, class, cusip, security_id)`` rows.

    Two edges, applied to a fixpoint: a CUSIP-6 block (a sibling's full CUSIP
    carries the block, and the block joins to the ticker through the shared
    issuer key or the issuer name) and a shared ``security_id`` (a CUSIP change
    inside one registry class). The seed for both is a row whose (issuer name,
    class) is in the reviewed mapping.

    A SEED MUST AGREE WITH THE SEC LIST BEFORE IT MAY SPREAD. ``list_issuers``
    maps a CUSIP to the issuer name(s) the SEC Official 13F List gives it
    (:func:`load_list_issuers`). Filers mistype CUSIPs, and a mistyped one that
    happens to match a reviewed (issuer name, class) used to seed the closure
    like any other — so a single row reporting a Treasury CUSIP under a company
    name pulled that Treasury's ENTIRE CUSIP-6 block into the withheld set, and
    labelled 637 government bonds with an equity ticker they have nothing to do
    with. Two measured rows did exactly that: ``NORTHERN OIL & GAS INC``
    (91282CGE5) and ``KIMBERLY CLARK CORP`` (91282CHH7).

    TWO REFUSALS, WITH DIFFERENT REACH, because the evidence differs.

    (1) THE LIST NAMES A DIFFERENT ISSUER. Propagation only is gated, not
    membership, and the distinction is the whole point. A seed whose CUSIP the
    list assigns to a plainly different issuer is still withheld ITSELF — it costs one opaque ordinal and cannot
    weaken anything — but it contributes no block and no security-id edge, so
    it cannot drag in securities that are not its own. Gating membership
    instead would un-withhold real securities whenever the list and the filer
    disagree for an innocent reason: on the 20260817.1 corpus two of the
    refused seeds are the TransForce/TFI International rename, filed 286 times,
    whose CUSIP genuinely does resolve to a reviewed ticker.

    (2) THE LIST DOES NOT CARRY THE CUSIP AT ALL. Here membership is narrowed
    too. The SEC Official 13(f) List names every 13(f) security, so a CUSIP with
    no row on it cannot BE the matched issuer's 13(f) security — the match is
    the filer's error, with no innocent reading available. Such a seed
    propagates nothing and is not withheld itself.

    Measured on the published ``data-20260914.1``: no CUSIP in the ``91282C``
    Treasury block has a list row (Treasuries are not 13(f) securities), yet one
    row filing 91282CHH7 under ``KIMBERLY CLARK CORP`` put the whole block in
    the withheld set, where `scripts/cusip_join_probe.py` then counted 18 of
    them as ``KMB`` pairs recovered from congressional disclosures naming
    Treasury bonds. The pairs are false — a Treasury has no ticker, and the
    ``KMB`` association exists only inside this bookkeeping. The real cost is
    the mirror image: a Treasury CUSIP written into a disclosure ``comment``
    would be replaced with ``[CUSIP withheld]``, degrading a verbatim public
    record to protect nothing.

    The rule is ABSENCE FROM THE LIST, not Treasuries and not the ``91282C``
    prefix; nothing here knows what a Treasury is. It cannot cost a real
    withholding, because a security that genuinely resolves to a reviewed
    ticker is a 13(f) security and so is on the list by construction.

    ``list_issuers`` is optional only because a caller may have no list to read.
    Passing ``None`` — or an EMPTY mapping, which is what
    :func:`load_list_issuers` returns for a database with no
    ``security_list_intervals`` table — restores the un-gated seeding this
    exists to fix, so every in-tree caller passes a real one.
    """
    by_key = (mapping or load_ticker_mapping()).by_key()
    cusip_sids: dict[str, set[str]] = defaultdict(set)
    sid_cusips: dict[str, set[str]] = defaultdict(set)
    block_cusips: dict[str, set[str]] = defaultdict(set)
    mapped: set[str] = set()
    verified: set[str] = set()
    rejected: dict[str, tuple[str, str | None]] = {}
    absent: dict[str, tuple[str, str | None]] = {}
    labels: dict[str, set[str]] = defaultdict(set)
    # AN EMPTY MAPPING IS "NO LIST TO CONSULT", NEVER "EVERY CUSIP IS ABSENT".
    # `load_list_issuers` returns {} for a database with no
    # `security_list_intervals` table — an ordinary state of a fixture or a
    # partially seeded corpus — and reading that as universal absence would
    # refuse EVERY seed and withhold nothing at all: the property inverted
    # wholesale, and silently, because an empty withheld set looks like a clean
    # run. Both no-list forms therefore fall back to the un-gated seeding.
    consultable = bool(list_issuers)
    for name, klass, cusip, security_id in rows:
        if cusip is None:
            continue
        block_cusips[cusip[:6]].add(cusip)
        if security_id is not None:
            cusip_sids[cusip].add(security_id)
            sid_cusips[security_id].add(cusip)
        if name is not None and mapping_key(name, klass) in by_key:
            mapped.add(cusip)
            labels[cusip].add(by_key[mapping_key(name, klass)].ticker)
            listed = list_issuers.get(cusip) if consultable else None
            if consultable and not listed:
                # NO ROW ON THE SEC OFFICIAL 13(F) LIST. The list names every
                # 13(f) security, so this CUSIP is not the matched issuer's —
                # it propagates nothing AND is not withheld on its own account.
                absent[cusip] = (name, klass)
            elif listed and not any(_issuer_names_agree(name, l) for l in listed):
                # On the list, under a plainly different issuer. Refused
                # propagation, still withheld itself.
                rejected[cusip] = (name, klass)
            else:
                verified.add(cusip)

    # Only the VERIFIED seeds start the walk.
    withheld: set[str] = set()
    frontier = set(verified)
    while frontier:
        withheld |= frontier
        grown: set[str] = set()
        for cusip in frontier:
            reached = set(block_cusips.get(cusip[:6], ()))
            for sid in cusip_sids.get(cusip, ()):
                reached |= sid_cusips.get(sid, set())
            # The label travels the edge it was reached by, so a member with no
            # mapping row of its own still names the ticker it is joinable to.
            for other in reached:
                labels[other] |= labels[cusip]
            grown |= reached
        frontier = grown - withheld
    # The BLOCKS are the walk's, taken before the refused seeds join the set: a
    # block becomes an opaque issuer key for every row in it, so letting a
    # mis-filed CUSIP contribute its block would re-drag the 637 Treasuries
    # through `issuer_key` instead of through `cusip` — the same defect, one
    # column over.
    walked = frozenset(withheld)
    # A DISAGREEING seed is withheld, but only AFTER the walk, so it never acts
    # as a starting point. Adding it before would also have kept anything the
    # walk legitimately reached from re-entering the frontier.
    #
    # An ABSENT seed is not added at all — the one place membership, and not
    # just propagation, is narrowed. It is still withheld if the walk genuinely
    # REACHED it, which is the honest case: a verified sibling in its own block
    # puts it there on the block's evidence rather than on a typo's.
    withheld |= mapped - absent.keys()

    return WithheldClosure(
        mapped=frozenset(mapped),
        cusips=frozenset(withheld),
        security_ids=frozenset(sid for c in withheld for sid in cusip_sids.get(c, ())),
        blocks=frozenset(c[:6] for c in walked),
        tickers={c: frozenset(labels.get(c, ())) for c in withheld},
        unverified=frozenset(rejected),
        rejected_seeds=tuple(
            (cusip, name, klass) for cusip, (name, klass) in sorted(rejected.items())
        ),
        absent_seeds=tuple(
            (cusip, name, klass) for cusip, (name, klass) in sorted(absent.items())
        ),
    )



def load_list_issuers(conn: sqlite3.Connection) -> dict[str, frozenset[str]]:
    """``cusip -> the SEC Official 13F List's own issuer name(s)`` for that CUSIP.

    Read from ``security_list_intervals``, which the same database already
    carries — this adds no new source. A CUSIP can hold several rows (one per
    quarter interval) and the printed name drifts, so every distinct spelling is
    kept and :func:`close_withheld_cusips` accepts a seed that agrees with ANY
    of them.

    Rows ALREADY withheld by a previous release are skipped: their ``value`` is
    ``withheld:<n>`` rather than a CUSIP, so they answer for no CUSIP at all,
    and their first six characters ("withhe") are not an issuer block. Returns
    an empty mapping when the table is absent, which is an ordinary state of a
    fixture or a partially seeded corpus.
    """
    try:
        rows = conn.execute(
            "SELECT value, issuer_name FROM security_list_intervals"
            " WHERE id_type = 'cusip' AND issuer_name IS NOT NULL"
        ).fetchall()
    except sqlite3.Error:
        return {}
    names: dict[str, set[str]] = defaultdict(set)
    for value, issuer_name in rows:
        if isinstance(value, str) and not value.startswith(WITHHELD_LIST_VALUE_PREFIX):
            names[value].add(issuer_name)
    return {cusip: frozenset(v) for cusip, v in names.items()}


def plan_cusip_redaction(
    source: sqlite3.Connection, mapping: TickerMapping | None = None
) -> RedactionPlan:
    """Compute the closed withheld set from the SOURCE holdings.

    Reads ``main.inst_holdings`` (every period — the aggregate's deltas reach
    further back than the serving projection). One grouped pass; the mapping is
    applied in Python because its key normalization lives there.
    """
    closure = close_withheld_cusips(
        source.execute(
            "SELECT issuer_name_raw, title_of_class, cusip, security_id"
            " FROM main.inst_holdings WHERE cusip IS NOT NULL"
            " GROUP BY issuer_name_raw, title_of_class, cusip, security_id"
        ).fetchall(),
        mapping,
        # The SEC list lives in this same database, so the seeding gate reads it
        # inside the caller's single read transaction like every other source
        # read. `.fetchall()` above because the cursor cannot stay open across
        # the second query on the same connection.
        load_list_issuers(source),
    )
    mapped, withheld = closure.mapped, closure.cusips
    sids, blocks = closure.security_ids, closure.blocks
    # Deterministic ordinals over the ORIGINAL key text. The ordinal reveals no
    # CUSIP: recovering one would need the withheld keys, which are not published.
    originals = sorted({f"sid:{s}" for s in sids} | {f"cusip:{c}" for c in withheld})
    position_keys = {
        key: f"{WITHHELD_POSITION_PREFIX}{n}" for n, key in enumerate(originals, start=1)
    }
    issuer_keys = {
        f"cusip6:{b}": f"{WITHHELD_ISSUER_PREFIX}{n}"
        for n, b in enumerate(sorted(blocks), start=1)
    }
    return RedactionPlan(
        mapped_cusips=frozenset(mapped),
        cusips=frozenset(withheld),
        security_ids=frozenset(sids),
        blocks=frozenset(blocks),
        position_keys=position_keys,
        issuer_keys=issuer_keys,
        unverified=closure.unverified,
        rejected_seeds=closure.rejected_seeds,
        absent_seeds=closure.absent_seeds,
    )


def _columns(conn: sqlite3.Connection, table: str) -> set[str]:
    return {row[1] for row in conn.execute(f'PRAGMA main.table_info("{table}")')}  # nosec B608


def _text_columns(conn: sqlite3.Connection, table: str) -> set[str]:
    """Columns that can hold a CUSIP as text.

    TYPE, not just name: sweeping every non-key column tried to write the marker
    into `_agg_qoq_deltas.change_kind_code` and hit its CHECK constraint. A
    numeric column cannot carry a CUSIP, so it is not swept.
    """
    return {
        row[1]
        for row in conn.execute(f'PRAGMA main.table_info("{table}")')  # nosec B608
        if not row[2] or row[2].upper().startswith(("TEXT", "CHAR", "CLOB", "VARCHAR"))
    }


def _scrub_embedded(
    conn: sqlite3.Connection,
    table: str,
    column: str,
    cusips: frozenset[str],
    marker: str = WITHHELD_TEXT,
) -> int:
    """Replace withheld CUSIPs that sit INSIDE a longer value, keeping the rest
    of the filer's text. Returns the number of rows changed.

    Keyed on the VALUE, over DISTINCT values, not on rowid: `_agg_qoq_deltas` is
    WITHOUT ROWID (there is no rowid to select), and one issuer name repeats
    across millions of rows, so the distinct set is a few thousand strings. The
    same old value always maps to the same replacement, so this is idempotent.
    """
    values = [
        row[0]
        for row in conn.execute(
            f'SELECT DISTINCT "{column}" FROM "{table}"'  # nosec B608
            f' WHERE "{column}" IS NOT NULL AND length("{column}") >= 9'
        )
        if isinstance(row[0], str)
    ]
    updates: list[tuple[str, str]] = []
    for value in values:
        replaced = _CUSIP_IN_TEXT_RE.sub(
            lambda m: marker if m.group(0) in cusips else m.group(0), value
        )
        replaced = _ISIN_RE.sub(
            lambda m: marker if m.group(2) in cusips else m.group(0), replaced
        )
        if replaced != value:
            updates.append((replaced, value))
    changed = 0
    for replaced, value in updates:
        changed += conn.execute(
            f'UPDATE "{table}" SET "{column}" = ? WHERE "{column}" = ?',  # nosec B608
            (replaced, value),
        ).rowcount
    return changed


def apply_cusip_redaction(plan: RedactionPlan, db_path: Path | str) -> dict[str, int]:
    """Rewrite one published database in place. Returns rows changed per
    ``table.column``. Every table carrying one of the four columns is covered,
    so a table added later cannot silently republish a withheld key."""
    counts: dict[str, int] = {}
    conn = sqlite3.connect(str(db_path), isolation_level=None)
    try:
        conn.execute("PRAGMA secure_delete = ON")
        conn.execute("CREATE TEMP TABLE _w_pk (old TEXT PRIMARY KEY, new TEXT NOT NULL)")
        conn.execute("CREATE TEMP TABLE _w_ik (old TEXT PRIMARY KEY, new TEXT NOT NULL)")
        conn.execute("CREATE TEMP TABLE _w_cusip (v TEXT PRIMARY KEY)")
        conn.execute("CREATE TEMP TABLE _w_sid (v TEXT PRIMARY KEY)")
        conn.executemany("INSERT INTO _w_pk VALUES (?, ?)", plan.position_keys.items())
        conn.executemany("INSERT INTO _w_ik VALUES (?, ?)", plan.issuer_keys.items())
        conn.executemany("INSERT INTO _w_cusip VALUES (?)", ((c,) for c in plan.cusips))
        conn.executemany("INSERT INTO _w_sid VALUES (?)", ((s,) for s in plan.security_ids))
        tables = [
            r[0]
            for r in conn.execute(
                "SELECT name FROM sqlite_master WHERE type = 'table'"
                " AND name NOT LIKE 'sqlite_%' ORDER BY name"
            )
        ]
        conn.execute("BEGIN")
        for table in tables:
            cols = _columns(conn, table)
            q = f'"{table}"'
            # Identifiers come from sqlite_master of the file being rewritten,
            # never from caller input; SQLite cannot bind identifiers.
            if _CUSIP_COLUMN in cols:
                counts[f"{table}.cusip"] = conn.execute(
                    f"UPDATE {q} SET cusip = NULL"  # nosec B608
                    " WHERE cusip IN (SELECT v FROM _w_cusip)"
                ).rowcount
            if _SECURITY_COLUMN in cols:
                counts[f"{table}.security_id"] = conn.execute(
                    f"UPDATE {q} SET security_id = NULL"  # nosec B608
                    " WHERE security_id IN (SELECT v FROM _w_sid)"
                ).rowcount
            if _POSITION_COLUMN in cols:
                counts[f"{table}.position_key"] = conn.execute(
                    f"UPDATE {q} SET position_key ="  # nosec B608
                    " (SELECT new FROM _w_pk WHERE old = position_key)"
                    " WHERE position_key IN (SELECT old FROM _w_pk)"
                ).rowcount
            if _ISSUER_COLUMN in cols:
                counts[f"{table}.issuer_key"] = conn.execute(
                    f"UPDATE {q} SET issuer_key ="  # nosec B608
                    " (SELECT new FROM _w_ik WHERE old = issuer_key)"
                    " WHERE issuer_key IN (SELECT old FROM _w_ik)"
                ).rowcount
            # A withheld CUSIP must not survive in ANY published column, not just
            # the ones that are supposed to hold identifiers. A filer that typed
            # a CUSIP into `issuer_name` or `title_of_class` republished it in
            # plain text, joinable to the ticker through the shared position key.
            for column in sorted(_text_columns(conn, table) - _KEY_COLUMNS):
                changed = conn.execute(
                    f'UPDATE {q} SET "{column}" = ?'  # nosec B608
                    f' WHERE "{column}" IN (SELECT v FROM _w_cusip)',
                    (WITHHELD_TEXT,),
                ).rowcount
                if changed:
                    counts[f"{table}.{column}.cusip_text"] = changed
                embedded = _scrub_embedded(conn, table, column, plan.cusips)
                if embedded:
                    counts[f"{table}.{column}.cusip_in_text"] = embedded
        conn.execute("COMMIT")
        for name in ("_w_pk", "_w_ik", "_w_cusip", "_w_sid"):
            conn.execute(f"DROP TABLE temp.{name}")  # nosec B608
        conn.execute("VACUUM")
    finally:
        conn.close()
    return counts


# --- the published congress.db's SEC 13F list --------------------------------
#
# C1 addendum (coordinator instruction 2026-09-11). `security_list_intervals` is
# the SEC Official 13F List as published inside `congress.db` (DB_ARTIFACT). The
# list gives CUSIP + issuer name + class; Public Filings separately publishes a
# reviewed (issuer name, class) -> ticker mapping, so the PAIRING is derivable
# even though publishing CUSIPs alone is pre-existing and accepted.
#
# Measured on the 20260817.1 artifact: the pairing needs OUR mapping —
# `securities.entity_id` is NULL for all 22,521 rows, so the congress.db-alone
# join through `entity_tickers` yields zero pairs.
#
# Option (a) — "publish the list only in the path that seeds the next build" —
# is NOT available: the release artifact IS that path. `populus seed-corpus`
# restores the next run's corpus from the previous release's `congress.db`
# (publish/seed.py, and .github/workflows/publish.yml "Seed the corpus from the
# previous release (R42)"), so a table withheld from the artifact is a table the
# next build starts without. Option (b) is therefore what runs here: the rows
# stay, with the CUSIP and every CUSIP-derived value withheld.
#
# `value` is NOT NULL and half of PRIMARY KEY (value, valid_from) (registry.sql),
# so a withheld CUSIP cannot be nulled — it is replaced by ONE opaque token per
# distinct CUSIP, which keeps the key unique. `raw` and `source_row` are
# nullable and echo the CUSIP verbatim, so they are cleared. `security_id` is
# the unsalted `sec:prov:` hash of the CUSIP, so it is replaced everywhere it
# appears, `securities` included, keeping the FK intact.

WITHHELD_LIST_VALUE_PREFIX = "withheld:"
WITHHELD_SECURITY_ID_PREFIX = "sec:withheld:"

#: Tables whose `security_id` must follow the replacement, so the published
#: copy stays referentially consistent.
_SECURITY_ID_TABLES = (
    "securities",
    "security_list_intervals",
    "security_identifiers",
    "security_supersessions",
)


def scrub_disclosure_text(
    conn: sqlite3.Connection, cusips: Collection[str]
) -> dict[str, int]:
    """Replace withheld CUSIPs that a FILER wrote into congressional disclosure
    text, keeping every other word. Returns rows changed per ``table.column``.

    Owner decision 2026-09-13, closing the one residual the C1 join probe named
    at release: three CUSIPs in five rows of `transactions.comment` and its
    verbatim `raw_row` copy, where the member wrote BOTH identifiers in one
    sentence — "…cusip 26875P101, ticker EOG, at a price of $125.6342/share."
    That pairing is the filer's own, not a key Public Filings derived, which is
    why it survived the key-column pass: nothing about it is a CUSIP column.

    Three properties this deliberately has:

    * It runs at PUBLISH time, on the staged copy, in the same pass as the SEC
      13F list withholding. The build's own store — and therefore the internal
      corpus and every re-derivation from it — keeps the member's original
      words. Doing this in ingest would destroy the filing's text permanently.
    * The edit is VISIBLE. The marker is
      :data:`DISCLOSURE_WITHHELD_TEXT`, not a deletion, so the published
      sentence cannot be mistaken for the member's unaltered wording.
    * Matching is by exact membership in `cusips`, never by CUSIP-6 prefix.
      The caller decides the population (`apply_registry_redaction` passes the
      block-closed set, which is what the SEC list pass withholds); this
      function replaces a token only when the whole nine characters are in that
      set, which is precisely what `scripts/cusip_join_probe.py` looks for.
      Matching on a six-character prefix here would also hit nine-character
      words in free prose, and disclosure text is prose.

    The row's `row_fingerprint`/`txn_id` still describe the ORIGINAL `raw_row`,
    so the published `raw_row` no longer recomputes to them. That is intended
    and is the visible edit's cost: identity stays stable across publishes
    (recomputing it would renumber every affected transaction), and the
    unaltered document remains reachable through the row's receipt link.
    """
    withheld = frozenset(cusips)
    counts: dict[str, int] = {}
    if not withheld:
        return counts
    existing = {
        r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")
    }
    for table, column in _DISCLOSURE_TEXT_COLUMNS:
        if table not in existing or column not in _columns(conn, table):
            continue
        counts[f"{table}.{column}"] = _scrub_embedded(
            conn, table, column, withheld, marker=DISCLOSURE_WITHHELD_TEXT
        )
    return counts


def _next_withheld_ordinal(
    prior: Collection[tuple[str, str | None, str | None, str | None]],
) -> int:
    """One past the highest ordinal already withheld in this table.

    An unparseable suffix contributes nothing rather than raising: the ordinal
    only has to be FREE, and a value this function did not write is not an
    ordinal it must respect. Returns 1 when nothing was withheld before, so a
    first-ever pass numbers from 1 exactly as it always did.
    """
    highest = 0
    for value, *_rest in prior:
        suffix = value[len(WITHHELD_LIST_VALUE_PREFIX) :]
        if suffix.isdigit():
            highest = max(highest, int(suffix))
    return highest + 1


def plan_registry_redaction(
    conn: sqlite3.Connection,
    mapping: TickerMapping | None = None,
    *,
    filed_cusips: Collection[str] = (),
    unverified_cusips: Collection[str] = (),
) -> tuple[dict[str, str], dict[str, str]]:
    """``(cusip -> opaque value, security_id -> opaque id)`` for the published
    list. Same closure as the inst plan: a reviewed issuer contributes its
    CUSIP, and the whole CUSIP-6 block follows it, because a sibling row's full
    CUSIP carries the block.

    `filed_cusips` is the authoritative set, from the FILINGS. The list's own
    naming is not sufficient on its own and measuring said so: the reviewed
    mapping is keyed on the name a manager FILED, while this table carries the
    SEC list's own spelling, so 69 issuer blocks — "BANK OF AMER CORP" here
    against the filed "BANK OF AMERICA CORP" — matched nothing and 506 CUSIPs
    stayed published. The list rule is kept as well: the two are unioned, so
    neither spelling alone decides what is withheld."""
    by_key = (mapping or load_ticker_mapping()).by_key()
    rows = conn.execute(
        "SELECT value, security_id, issuer_name, security_class"
        " FROM security_list_intervals WHERE id_type = 'cusip'"
    ).fetchall()
    # IDEMPOTENCE IS A CORRECTNESS REQUIREMENT, not a nicety. The published
    # `congress.db` is what seeds the NEXT build (`populus seed-corpus`,
    # publish/seed.py, and publish.yml "Seed the corpus from the previous
    # release (R42)"), so on every run after the first this table already
    # carries rows this function withheld last time: `value` is
    # `withheld:<n>`, `id_type` is still 'cusip', and `issuer_name` still
    # matches the reviewed mapping.
    #
    # Left in the population, such a row is corrupting twice over. Its first
    # six characters are "withhe", which is not an issuer block but WOULD be
    # admitted as one, dragging every previously withheld row back into the
    # renumbered set. And the renumbering collides: `sorted()` is
    # lexicographic, so `withheld:10` precedes `withheld:2` and is handed
    # ordinal 2 — a value the table already holds — so the in-place UPDATE
    # violates PRIMARY KEY (value, valid_from) in registry.sql. Eleven
    # withheld values is enough to reach it; the measured artifact has 9,690.
    #
    # So an already-withheld row is EXCLUDED from the plan: its identity is
    # preserved untouched, and a newly withheld CUSIP is allocated above the
    # highest ordinal already in use rather than from 1. Ordinals are stable
    # across releases as a result, which is also what makes them joinable.
    prior = [r for r in rows if r[0].startswith(WITHHELD_LIST_VALUE_PREFIX)]
    fresh = [r for r in rows if not r[0].startswith(WITHHELD_LIST_VALUE_PREFIX)]
    blocks = {
        value[:6]
        for value, _sid, name, klass in fresh
        if name is not None and mapping_key(name, klass) in by_key
    }
    # A filed CUSIP carries its BLOCK into the withheld set — unless the seeding
    # gate refused it (`close_withheld_cusips`). A filer who writes another
    # issuer's CUSIP under a reviewed name must not withhold that issuer's whole
    # block here either: the measured case dragged 637 Treasuries in behind two
    # rows. The refused CUSIPs are still withheld, just as themselves.
    unverified = frozenset(unverified_cusips)
    blocks |= {c[:6] for c in filed_cusips if c not in unverified}
    withheld = sorted(
        {
            value
            for value, _s, _n, _c in fresh
            if value[:6] in blocks or value in unverified
        }
    )
    start = _next_withheld_ordinal(prior)
    values = {
        value: f"{WITHHELD_LIST_VALUE_PREFIX}{n}"
        for n, value in enumerate(withheld, start=start)
    }
    sids = {
        sid: f"{WITHHELD_SECURITY_ID_PREFIX}{values[value][len(WITHHELD_LIST_VALUE_PREFIX):]}"
        for value, sid, _n, _c in fresh
        if value in values and sid is not None
    }
    return values, sids


def apply_registry_redaction(
    db_path: Path | str,
    *,
    filed_cusips: Collection[str] = (),
    unverified_cusips: Collection[str] = (),
    inst_source: Path | str | None = None,
) -> dict[str, int]:
    """Withhold reviewed-ticker CUSIPs from ONE published congress.db copy.

    Operates on the staged artifact only: the build's own store keeps every
    CUSIP, so internal joins and the identity registry are untouched.

    `filed_cusips` is the withheld set computed from the FILED names by
    :func:`plan_cusip_redaction` during the inst derive. It is PASSED IN rather
    than recomputed here: the derive reads the accepted snapshot inside ONE
    explicit read transaction, and re-opening that snapshot afterwards would put
    a read outside it — the identity contract
    `test_inst_external_store.test_c_exactly_one_read_transaction_spans_the_derivation`
    exists precisely to catch that, and did.

    `inst_source` is the standalone equivalent for ad-hoc use (a probe, a
    one-off re-cut of a published artifact), where no derive is in flight.
    """
    counts: dict[str, int] = {}
    filed: frozenset[str] = frozenset(filed_cusips)
    unverified: frozenset[str] = frozenset(unverified_cusips)
    if inst_source is not None:
        inst_conn = sqlite3.connect(
            f"file:{inst_source}?mode=ro&immutable=1", uri=True
        )
        try:
            standalone = plan_cusip_redaction(inst_conn)
            filed |= standalone.cusips
            unverified |= standalone.unverified
        finally:
            inst_conn.close()
    counts["filed_withheld_cusips"] = len(filed)
    conn = sqlite3.connect(str(db_path), isolation_level=None)
    try:
        conn.execute("PRAGMA secure_delete = ON")
        has_list = bool(
            conn.execute(
                "SELECT 1 FROM sqlite_master WHERE type='table'"
                " AND name='security_list_intervals'"
            ).fetchone()
        )
        # FAIL CLOSED ON A REPLAY WITH NO CUSIP-BEARING SOURCE. A previous pass
        # replaced the CUSIPs of the reviewed blocks with opaque ordinals, so
        # the artifact can no longer say WHICH blocks were withheld — that is
        # the point of withholding them. The block set therefore has to come
        # from a source that still holds real CUSIPs: `filed_cusips` (what the
        # inst derive computed from the FILINGS, which is what publish passes)
        # or `inst_source`. Without one, this pass would withhold only the rows
        # the list's OWN naming still matches, and a newly listed sibling class
        # in an already-withheld block would be published with its CUSIP while
        # its issuer name still pairs it to the reviewed ticker. Refusing is the
        # only safe answer: a silent under-withholding looks exactly like a
        # clean run.
        replayed = has_list and conn.execute(
            "SELECT 1 FROM security_list_intervals"
            " WHERE id_type = 'cusip' AND value LIKE ? || '%' LIMIT 1",
            (WITHHELD_LIST_VALUE_PREFIX,),
        ).fetchone()
        if replayed and not filed:
            raise ValueError(
                "this congress.db already carries withheld list values, so it is a"
                " seeded artifact: pass filed_cusips (or inst_source) so the"
                " withheld CUSIP-6 blocks can be recomputed from a source that"
                " still holds the CUSIPs. Re-running without one would publish a"
                " newly listed class in an already-withheld block."
            )
        values: dict[str, str] = {}
        sids: dict[str, str] = {}
        if has_list:
            values, sids = plan_registry_redaction(
                conn, filed_cusips=filed, unverified_cusips=unverified
            )
            counts["withheld_cusips"] = len(values)
            counts["withheld_security_ids"] = len(sids)
        else:
            counts["security_list_intervals.absent"] = 0

        # Disclosure TEXT, over the SAME set the list pass withholds — `filed`
        # UNIONED with the CUSIPs the plan decided on. Exact membership in
        # `filed` alone is NOT enough and a fixture caught it: the closure the
        # publisher passes covers what the 13F FILINGS hold, while the plan adds
        # the rest of each reviewed CUSIP-6 block from the SEC list itself. A
        # sibling class listed there but held by nobody would have had its
        # identifier withheld from the list and published verbatim inside a
        # member's sentence — the same pair, one table over.
        #
        # This runs OUTSIDE both early exits below, and before them. An artifact
        # with no list table, and a replay whose list is already fully withheld
        # (`values` empty), are both ordinary states of the seeded artifact that
        # publish re-publishes — neither is a reason to leave the text alone.
        counts.update(scrub_disclosure_text(conn, filed | frozenset(values)))
        text_rows = sum(
            n for key, n in counts.items() if key.startswith("transactions.")
        )
        if not values:
            if text_rows:
                # The probe reads RAW BYTES, so a value left behind in a freed
                # page still pairs. VACUUM under secure_delete is what drops it.
                conn.execute("VACUUM")
            return counts
        conn.execute("CREATE TEMP TABLE _w_val (old TEXT PRIMARY KEY, new TEXT NOT NULL)")
        conn.execute("CREATE TEMP TABLE _w_sid (old TEXT PRIMARY KEY, new TEXT NOT NULL)")
        conn.executemany("INSERT INTO _w_val VALUES (?, ?)", values.items())
        conn.executemany("INSERT INTO _w_sid VALUES (?, ?)", sids.items())
        existing = {
            r[0]
            for r in conn.execute(
                "SELECT name FROM sqlite_master WHERE type = 'table'"
            )
        }
        conn.execute("BEGIN")
        # The security_id first, while the list rows still carry their CUSIP.
        for table in _SECURITY_ID_TABLES:
            if table not in existing:
                continue
            cols = {r[1] for r in conn.execute(f'PRAGMA main.table_info("{table}")')}  # nosec B608
            for column in ("security_id", "old_security_id"):
                if column not in cols:
                    continue
                counts[f"{table}.{column}"] = conn.execute(
                    f'UPDATE "{table}" SET {column} ='  # nosec B608
                    " (SELECT new FROM _w_sid WHERE old = {c})".format(c=column)
                    + f" WHERE {column} IN (SELECT old FROM _w_sid)"
                ).rowcount
        counts["security_list_intervals.value"] = conn.execute(
            "UPDATE security_list_intervals"
            " SET value = (SELECT new FROM _w_val WHERE old = value),"
            "     raw = NULL, source_row = NULL"
            " WHERE value IN (SELECT old FROM _w_val)"
        ).rowcount
        conn.execute("COMMIT")
        conn.execute("DROP TABLE temp._w_val")
        conn.execute("DROP TABLE temp._w_sid")
        conn.execute("VACUUM")
    finally:
        conn.close()
    return counts
