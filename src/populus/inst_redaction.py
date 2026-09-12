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
from collections.abc import Collection, Iterable
from dataclasses import dataclass
from pathlib import Path

from populus.ticker_mapping_13f import TickerMapping, load_ticker_mapping, mapping_key

__all__ = [
    "WITHHELD_ISSUER_PREFIX",
    "WITHHELD_POSITION_PREFIX",
    "RedactionPlan",
    "WithheldClosure",
    "apply_cusip_redaction",
    "close_withheld_cusips",
    "plan_cusip_redaction",
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

    def summary(self) -> dict[str, int]:
        return {
            "mapped_cusips": len(self.mapped_cusips),
            "withheld_cusips": len(self.cusips),
            "withheld_security_ids": len(self.security_ids),
            "withheld_cusip6_blocks": len(self.blocks),
            "opaque_position_keys": len(self.position_keys),
            "opaque_issuer_keys": len(self.issuer_keys),
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
    """

    mapped: frozenset[str]
    cusips: frozenset[str]
    security_ids: frozenset[str]
    blocks: frozenset[str]
    tickers: dict[str, frozenset[str]]


def close_withheld_cusips(
    rows: Iterable[tuple[str | None, str | None, str, str | None]],
    mapping: TickerMapping | None = None,
) -> WithheldClosure:
    """Close the withheld set over ``(issuer_name, class, cusip, security_id)`` rows.

    Two edges, applied to a fixpoint: a CUSIP-6 block (a sibling's full CUSIP
    carries the block, and the block joins to the ticker through the shared
    issuer key or the issuer name) and a shared ``security_id`` (a CUSIP change
    inside one registry class). The seed for both is a row whose (issuer name,
    class) is in the reviewed mapping.
    """
    by_key = (mapping or load_ticker_mapping()).by_key()
    cusip_sids: dict[str, set[str]] = defaultdict(set)
    sid_cusips: dict[str, set[str]] = defaultdict(set)
    block_cusips: dict[str, set[str]] = defaultdict(set)
    mapped: set[str] = set()
    labels: dict[str, set[str]] = defaultdict(set)
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

    withheld: set[str] = set()
    frontier = set(mapped)
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

    return WithheldClosure(
        mapped=frozenset(mapped),
        cusips=frozenset(withheld),
        security_ids=frozenset(sid for c in withheld for sid in cusip_sids.get(c, ())),
        blocks=frozenset(c[:6] for c in withheld),
        tickers={c: frozenset(labels.get(c, ())) for c in withheld},
    )


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
        ),
        mapping,
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
    conn: sqlite3.Connection, table: str, column: str, cusips: frozenset[str]
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
            lambda m: WITHHELD_TEXT if m.group(0) in cusips else m.group(0), value
        )
        replaced = _ISIN_RE.sub(
            lambda m: WITHHELD_TEXT if m.group(2) in cusips else m.group(0), replaced
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
    blocks |= {c[:6] for c in filed_cusips}
    withheld = sorted({value for value, _s, _n, _c in fresh if value[:6] in blocks})
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
    if inst_source is not None:
        inst_conn = sqlite3.connect(
            f"file:{inst_source}?mode=ro&immutable=1", uri=True
        )
        try:
            filed |= plan_cusip_redaction(inst_conn).cusips
        finally:
            inst_conn.close()
    counts["filed_withheld_cusips"] = len(filed)
    conn = sqlite3.connect(str(db_path), isolation_level=None)
    try:
        if not conn.execute(
            "SELECT 1 FROM sqlite_master WHERE type='table'"
            " AND name='security_list_intervals'"
        ).fetchone():
            return {"security_list_intervals.absent": 0}
        conn.execute("PRAGMA secure_delete = ON")
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
        replayed = conn.execute(
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
        values, sids = plan_registry_redaction(conn, filed_cusips=filed)
        counts["withheld_cusips"] = len(values)
        counts["withheld_security_ids"] = len(sids)
        if not values:
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
