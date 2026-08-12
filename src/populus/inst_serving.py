"""RUN M2-8 T7 (plan R5/R6/R7) — the inst SERVING projection.

`inst_holdings` is the canonical AUDIT store: ~950 B/row payload, mostly per-row
§5.1 provenance plus a `raw_row` duplicate. That is correct for an audit trail and
wrong for a serving format, so this module derives three **directional** projections
from it. Nothing here is a second source of truth — every holding value is read in
one pass from `v_filer_reported_holdings`, default membership is joined from
`v_default_inst_filings`, and activity classification comes from the producer-owned
aggregate (`agg_qoq_deltas`).

Three grains, kept separate (plan §B; external review r2 F8/F9, r3 F6/F7):

  filer          bucketed by cik           one row per REPORTED HOLDING
  issuer-holder  bucketed by issuer_key    one row per (issuer, period, FILER)
  activity       paginated by period       one row per QoQ POSITION CHANGE

Why the separation is load-bearing: a position can be composed from several
reported rows (a base 13F-HR plus NEW-HOLDINGS amendments). Attaching change fields
to holding rows would either duplicate one delta across those rows or force a
grouping that silently absorbs them. `position_key` is therefore an explicit
REFERENCE from a holding row to its `agg_qoq_deltas` record
`(cik, position_key, put_call, ssh_prnamt_type, curr_period)` — never a copy of it.

Provenance is COMPRESSED, never dropped (r2 F7): each shard carries a `filings`
dictionary keyed by `filing_key`, and every row carries that key. One entry per
filing replaces the duplicated per-row strings while preserving the every-record
provenance contract and amendment-aware filed dates.

All arithmetic is exact integer; a legitimately unavailable value is None and is
never rendered as 0 (NULL-honest). Nothing is dropped (G3).
"""

from __future__ import annotations

import sqlite3
from collections import defaultdict
from dataclasses import dataclass, field

from populus.inst_agg import (
    InstAggError,
    _QOQ_SCHEMA_SENTINELS,
    _issuer_key,
    _position_key,
    _put_call_bucket,
    _quote_sqlite_identifier,
    _unit_key,
    compact_qoq_rows,
    refuse_if_dest_aliases_source,
)

__all__ = [
    "FilingRef",
    "KNOWN_AMENDMENT_TYPES",
    "ServingProjection",
    "affiliate_groups",
    "authoritative_full_periods",
    "build_filing_dictionary",
    "build_serving_projection",
    "publication_periods",
    "write_serving_db",
    "SERVING_SCHEMA",
]

#: How many report periods the serving artifact publishes (OD-5: current + prior).
#: A projection that silently widened to the whole corpus would blow the shard
#: budget without anyone noticing, so the width is a named constant, not a
#: default argument buried in a call site.
PUBLISHED_PERIODS = 2


# --- filing dictionary (R5) ---------------------------------------------------


@dataclass(frozen=True)
class FilingRef:
    """One entry of a shard's filing dictionary. ONE per filing, not per row."""

    filing_key: int
    filing_id: str
    accession: str
    submission_type: str
    period_of_report: str
    filed_date: str
    doc_url: str | None
    source: str
    #: The filer this filing belongs to. Carried here rather than re-queried per
    #: filing inside the composition loop: `v_filer_reported_filings` already
    #: exposes it, and the per-filing `SELECT` it replaces returned `""` for an
    #: unknown filing_id — inventing a bogus `("", period)` composition bucket
    #: instead of failing. NOT part of `as_dict()`: the shard dictionary's shape
    #: is a published contract and the filer is implied by the shard.
    cik: str

    def as_dict(self) -> dict:
        return {
            "accession": self.accession,
            "submission_type": self.submission_type,
            "period_of_report": self.period_of_report,
            "filed_date": self.filed_date,
            "doc_url": self.doc_url,
            "source": self.source,
        }


def build_filing_dictionary(conn: sqlite3.Connection) -> dict[str, FilingRef]:
    """`filing_id -> FilingRef`, keyed by a compact integer for the shard.

    Ordered by filing_id so the assigned keys are deterministic: two builds of one
    corpus must produce byte-identical shards, and a dictionary keyed by insertion
    order would not.
    """
    refs: dict[str, FilingRef] = {}
    for i, (fid, accession, subtype, period, filed, doc_url, source, cik) in enumerate(
        conn.execute(
            "SELECT filing_id, accession, submission_type, period_of_report,"
            "       filed_date, doc_url, source, cik"
            " FROM v_filer_reported_filings ORDER BY filing_id"
        )
    ):
        refs[fid] = FilingRef(
            filing_key=i,
            filing_id=fid,
            accession=accession,
            submission_type=subtype,
            period_of_report=period,
            filed_date=filed,
            doc_url=doc_url,
            source=source,
            cik=cik,
        )
    return refs


def publication_periods(
    conn: sqlite3.Connection, *, width: int = PUBLISHED_PERIODS
) -> tuple[str, ...]:
    """The `width` most recent report periods, OLDEST FIRST, or `()` for none.

    OD-5 publishes the current and prior period. Oldest-first ordering is what
    the activity grain needs: `agg_qoq_deltas` rows for the CURRENT period cite a
    `prev_period`, and the exit fallback resolves display fields out of that
    prior period — so both must be in scope.

    An empty corpus yields `()` rather than a fabricated period; the projection
    treats that as "nothing to publish", not as an error.
    """
    rows = conn.execute(
        "SELECT DISTINCT period_of_report FROM v_filer_reported_filings"
        " ORDER BY period_of_report DESC LIMIT ?",
        (max(width, 0),),
    ).fetchall()
    return tuple(sorted(row[0] for row in rows if row[0] is not None))


# --- affiliate grouping (R6; external review r5 F3, r6 F3) --------------------


def affiliate_groups(conn: sqlite3.Connection, period: str) -> dict[str, str]:
    """`cik -> affiliate_group_key` for one period.

    Nodes are **CIKs, not filings** (review r6 F3). An earlier design built the
    graph over filings, which left a CIK with several surviving filings — a base
    plus NEW-HOLDINGS amendments — belonging to no single group. Projecting every
    restatement survivor onto its CIK first makes group membership total by
    construction: exactly one group per CIK per period.

    An edge joins two CIKs when EITHER one's `file_number_norm` appears in the
    other's `other_managers` — the relationship is symmetric for grouping purposes
    even though the disclosure is directional. Connected components are then
    canonicalised to the component's lexicographically smallest CIK, so the key is
    stable regardless of which member is encountered first.

    Recomputed per period: affiliations change, and a group asserted from another
    quarter would be a G4 violation.
    """
    own: dict[str, set[str]] = defaultdict(set)   # cik -> its own file numbers
    named: dict[str, set[str]] = defaultdict(set)  # cik -> file numbers it names
    ciks: set[str] = set()

    for cik, file_number_norm, other_managers in conn.execute(
        "SELECT cik, file_number_norm, other_managers FROM v_filer_reported_filings"
        " WHERE period_of_report = ? ORDER BY cik, filing_id",
        (period,),
    ):
        ciks.add(cik)
        if file_number_norm:
            own[cik].add(file_number_norm)
        for fn in _other_manager_file_numbers(other_managers):
            named[cik].add(fn)

    # file_number -> the CIKs that own it (normally one)
    owner: dict[str, set[str]] = defaultdict(set)
    for cik, numbers in own.items():
        for n in numbers:
            owner[n].add(cik)

    adjacency: dict[str, set[str]] = {c: set() for c in ciks}
    for cik, numbers in named.items():
        for n in numbers:
            for other in owner.get(n, ()):  # noqa: B007 - explicit empty default
                if other != cik:
                    adjacency[cik].add(other)
                    adjacency[other].add(cik)  # symmetric for grouping

    groups: dict[str, str] = {}
    for start in sorted(ciks):
        if start in groups:
            continue
        # breadth-first over the component; sorted() keeps traversal deterministic
        component: set[str] = set()
        frontier = [start]
        while frontier:
            node = frontier.pop()
            if node in component:
                continue
            component.add(node)
            frontier.extend(sorted(adjacency.get(node, ()) - component))
        key = min(component)
        for node in component:
            groups[node] = key
    return groups


def _other_manager_file_numbers(raw: str | None) -> list[str]:
    """Normalized file numbers named as other managers, or []. Never raises: a
    malformed cell yields no edges rather than failing the whole build (G3)."""
    if not raw:
        return []
    import json

    try:
        parsed = json.loads(raw)
    except (TypeError, ValueError):
        return []
    if not isinstance(parsed, list):
        return []
    out: list[str] = []
    for entry in parsed:
        if isinstance(entry, dict):
            value = entry.get("file_number_norm")
            if isinstance(value, str) and value:
                out.append(value)
    return out


# --- authoritative-full composition (R13 exits; review r5 F5, r6 F4) ---------


#: The amendment types the composition rules know how to reason about. A NULL
#: `amendment_type` is deliberately NOT a member: `parse/inst13f.py` leaves it
#: NULL whenever `<amendmentType>` is absent or unrecognised, and
#: `normalize_inst.py` has a flag for exactly that state
#: (`amendment_type_unknown`). An amendment whose type we could not classify may
#: be a RESTATEMENT — i.e. it may replace the base wholesale — so a period
#: containing one cannot support a claim of absence.
KNOWN_AMENDMENT_TYPES = frozenset({"RESTATEMENT", "NEW_HOLDINGS"})


def _is_amendment_filing(submission_type: str | None, is_amendment: object) -> bool:
    """Whether one filing is an AMENDMENT rather than a base 13F-HR.

    Two independent signals, ORed, because either alone fails open:

      * `is_amendment` — the normalized flag; and
      * a `submission_type` ending `/A` — the SEC's own form suffix.

    Reading `amendment_type IS NULL` as "this is a base" (the previous rule) is
    what produced the false exits: a `13F-HR/A` whose `<amendmentType>` the
    parser could not classify carries a NULL type, so it was counted as the
    period's one surviving base AND passed the known-type guard. Both guards
    failed open on the same record and the period was published as
    authoritative-full — every position absent from that single amendment
    rendered as `change_kind='exit'`, asserting a sale the documents cannot
    support. That is the plan's forbidden exit case (c).
    """
    if is_amendment:
        return True
    return isinstance(submission_type, str) and submission_type.upper().endswith("/A")


def _is_full_holdings_report(
    submission_type: str | None, is_amendment: object, amendment_type: str | None
) -> bool:
    """Whether one SURVIVING filing is a complete holdings report for its period.

    Absence can only be asserted against a document that would have listed the
    position, so this is what the "exactly one surviving base" condition counts.
    Two forms qualify:

      * a base `13F-HR`; and
      * a surviving `RESTATEMENT` amendment, which REPLACES the report it amends
        — restatement resolution suppresses the original, so after it the
        restatement *is* the period's full report. This is what makes the plan's
        exit case (b) (`base + RESTATEMENT + a later NEW-HOLDINGS`) a legitimate
        exit: counting only non-amendments would leave that period with zero
        bases and refuse an exit the documents fully support.

    A `NEW_HOLDINGS` amendment is ADDITIVE — it lists what was omitted, not what
    is held — so it is never a full report. An amendment of unknown type is not
    one either; it is separately disqualifying, since it might be a restatement.
    """
    if not _is_amendment_filing(submission_type, is_amendment):
        return True
    return amendment_type == "RESTATEMENT"


def authoritative_full_periods(conn: sqlite3.Connection) -> set[tuple[str, str]]:
    """The `(cik, period)` pairs whose composition can assert ABSENCE.

    An exit says "this position is gone". That is only assertable from a filing set
    that would have contained the position had it still been held. Every condition
    below must hold; any failure leaves the row `unclassified` + `exit_not_assertable`
    rather than claiming an exit that the documents do not support.

      * exactly ONE surviving FULL HOLDINGS REPORT after restatement resolution
        (a base 13F-HR, or the RESTATEMENT that replaced one) — two or more means
        the composition is ambiguous, and ZERO (an additive-amendment-only
        period) means there is no full report for a position to be absent FROM;
      * every filing in the composition `parse_status = 'parsed'` — a failed or
        cover-failed member could have carried the security;
      * every amendment in the period carries a KNOWN `amendment_type` — an
        unclassifiable amendment could be a restatement;
      * every additive NEW-HOLDINGS amendment parsed, for the same reason.

    `partial_lineage` is an *ingest* disposition and is not represented in the
    filings table, so it cannot be evaluated here; the caller supplies it. That
    limitation is declared rather than silently ignored (see the dev notes).
    """
    per_period: dict[tuple[str, str], list[tuple]] = defaultdict(list)
    for cik, period, subtype, is_amendment, amendment_type, parse_status in conn.execute(
        "SELECT cik, period_of_report, submission_type, is_amendment, amendment_type,"
        "       parse_status"
        " FROM v_filer_reported_filings ORDER BY cik, period_of_report, accession"
    ):
        per_period[(cik, period)].append(
            (
                _is_amendment_filing(subtype, is_amendment),
                _is_full_holdings_report(subtype, is_amendment, amendment_type),
                amendment_type,
                parse_status,
            )
        )

    ok: set[tuple[str, str]] = set()
    for key, rows in per_period.items():
        if sum(1 for _amend, is_full, _type, _status in rows if is_full) != 1:
            continue
        if any(status != "parsed" for _amend, _full, _type, status in rows):
            continue
        if any(
            is_amendment and amendment_type not in KNOWN_AMENDMENT_TYPES
            for is_amendment, _full, amendment_type, _status in rows
        ):
            continue
        ok.add(key)
    return ok


# --- the projection -----------------------------------------------------------


@dataclass
class ServingProjection:
    """Three grains plus the shared dictionaries. Deliberately NOT one table."""

    filings: dict[str, FilingRef] = field(default_factory=dict)
    filer_rows: list[dict] = field(default_factory=list)
    issuer_holder_rows: list[dict] = field(default_factory=list)
    activity_rows: list[dict] = field(default_factory=list)
    filer_names: dict[str, str] = field(default_factory=dict)


def build_serving_projection(
    conn: sqlite3.Connection, *, periods: tuple[str, ...]
) -> ServingProjection:
    """Derive the filer and issuer-holder projections for `periods`.

    `periods` is explicit rather than "everything": OD-5 publishes the current and
    prior period only, and a projection that silently widened to the whole corpus
    would blow the shard budget without anyone noticing.
    """
    out = ServingProjection(filings=build_filing_dictionary(conn))
    for cik, name in conn.execute("SELECT cik, name_raw FROM inst_filers ORDER BY cik"):
        out.filer_names[cik] = name

    if not periods:
        return out

    placeholders = ",".join("?" for _ in periods)

    # One canonical reported-holdings pass supplies all holding-derived serving
    # structures. A filer covered by an affiliate keeps its own book; the join to
    # v_default_inst_filings marks only rows that contribute to the deduplicated
    # issuer total, without scanning v_default_holdings again.
    groups_by_period = {p: affiliate_groups(conn, p) for p in periods}
    reported: dict[tuple, dict] = {}
    dedup_total: dict[tuple[str, str], int] = defaultdict(int)
    dedup_undisclosed: set[tuple[str, str]] = set()
    display: dict[tuple[str, str, str], tuple[str, str]] = {}
    for (
        cik,
        period,
        filing_id,
        security_id,
        cusip,
        issuer_name,
        title_of_class,
        value_usd,
        ssh_prnamt,
        ssh_prnamt_type,
        put_call,
        flags,
        entity_id,
        entity_link_state,
        is_default,
    ) in conn.execute(
        "SELECT h.cik,h.period_of_report,h.filing_id,h.security_id,h.cusip,"
        " h.issuer_name_raw,h.title_of_class,h.value_usd,h.ssh_prnamt,"
        " h.ssh_prnamt_type,h.put_call,h.flags,s.entity_id,s.entity_link_state,"
        " CASE WHEN d.filing_id IS NULL THEN 0 ELSE 1 END"
        " FROM v_filer_reported_holdings h"
        " LEFT JOIN securities s ON s.security_id=h.security_id"
        " LEFT JOIN v_default_inst_filings d ON d.filing_id=h.filing_id"
        f" WHERE h.period_of_report IN ({placeholders})"  # nosec B608
        " ORDER BY h.cik,h.period_of_report,h.holding_id",
        periods,
    ):
        ref = out.filings.get(filing_id)
        position_key = _position_key(security_id, cusip)
        out.filer_rows.append(
            {
                "cik": cik,
                "period": period,
                "filing_key": ref.filing_key if ref else None,
                "security_id": security_id,
                "cusip": cusip,
                "issuer_name": issuer_name,
                "title_of_class": title_of_class,
                "value_usd": value_usd,          # None stays None (NULL-honest)
                "shares": ssh_prnamt,
                "ssh_type": ssh_prnamt_type,
                "put_call": put_call,
                # the REFERENCE to agg_qoq_deltas, not a copy of its fields
                "position_key": position_key,
                "put_call_bucket": _put_call_bucket(put_call),
                "unit_key": _unit_key(ssh_prnamt_type),
                "flags": flags,
            }
        )

        issuer_key, source = _issuer_key(entity_id, entity_link_state, cusip, issuer_name)
        key = (issuer_key, period, cik)
        bucket = reported.setdefault(
            key,
            {
                "issuer_key": issuer_key,
                "issuer_key_source": source,
                "period": period,
                "cik": cik,
                "issuer_name": issuer_name,
                "value_usd": 0,
                "value_undisclosed_component": False,
                "security_count": set(),
                "filing_keys": set(),
            },
        )
        if value_usd is None:
            # A partial sum presented as a total would overstate nothing but
            # understate the holding — so the row's value becomes NULL + a flag
            # rather than a number that looks complete (r4 F4).
            bucket["value_undisclosed_component"] = True
        else:
            bucket["value_usd"] += value_usd
        if security_id is not None or cusip is not None:
            bucket["security_count"].add(security_id or f"cusip:{cusip}")
        if ref is not None:
            bucket["filing_keys"].add(ref.filing_key)
        # `<` on a NULL would raise TypeError and fail the WHOLE build rather
        # than degrade one bucket. `issuer_name_raw` is NOT NULL in `inst.sql`
        # today, so this is latent — but a build that dies on one malformed cell
        # is the opposite of G3, and the guard costs nothing.
        if issuer_name is not None and (
            bucket["issuer_name"] is None or issuer_name < bucket["issuer_name"]
        ):
            bucket["issuer_name"] = issuer_name

        total_key = (issuer_key, period)
        if is_default:
            if value_usd is None:
                dedup_undisclosed.add(total_key)
            else:
                dedup_total[total_key] += value_usd

        if position_key is not None:
            display_key = (cik, period, position_key)
            previous = display.get(display_key)
            if previous is None or (
                issuer_name is not None
                and (previous[1] is None or issuer_name < previous[1])
            ):
                display[display_key] = (issuer_key, issuer_name)

    _build_activity_rows(conn, out, periods, display)

    for key in sorted(reported):
        bucket = reported[key]
        issuer_key, period, cik = key
        undisclosed = bucket["value_undisclosed_component"]
        total_key = (issuer_key, period)
        out.issuer_holder_rows.append(
            {
                "issuer_key": issuer_key,
                "issuer_key_source": bucket["issuer_key_source"],
                "issuer_name": bucket["issuer_name"],
                "period": period,
                # MANDATORY: an issuer bucket holds many filers, so a row without
                # this cannot say who holds what (review r2 F8).
                "filer_key": cik,
                "filer_name": out.filer_names.get(cik, cik),
                "affiliate_group_key": groups_by_period.get(period, {}).get(cik, cik),
                "value_usd": None if undisclosed else bucket["value_usd"],
                "value_undisclosed_component": undisclosed,
                "security_count": len(bucket["security_count"]),
                "filing_keys": sorted(bucket["filing_keys"]),
                # DISTINCT field — the deduplicated issuer total. Never summed with
                # value_usd above; the two answer different questions.
                "issuer_dedup_total_usd": (
                    None
                    if total_key in dedup_undisclosed
                    else dedup_total.get(total_key, 0)
                ),
            }
        )
    return out


# --- T8: emit the Release artifact -------------------------------------------
#
# `publish/manifest.py` declares `inst_serving.db` and threads it through upload,
# resume and verification; `publish/digests.py` declares its projection; the MCP
# snapshot path reads it. None of that produces the file — this does.
#
# The table and column names here ARE the contract. `digests.ARTIFACT_PROJECTIONS`
# names the tables and the MCP consumer names the columns, so a rename in one
# place without the others leaves the boundary silently unevaluated in production.
# `tests/test_inst_serving_artifact.py` and the consumer's seam test pin both ends.

SERVING_SCHEMA = """
CREATE TABLE IF NOT EXISTS serving_filings (
  filing_key       INTEGER PRIMARY KEY,
  accession        TEXT NOT NULL,
  submission_type  TEXT NOT NULL,
  period_of_report TEXT NOT NULL,
  filed_date       TEXT NOT NULL,
  doc_url          TEXT,
  source           TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS serving_filer_rows (
  -- `logical_digest` requires a primary key to order rows stably (digests.py).
  -- Sequential and deterministic: rows are inserted in the projection's already
  -- sorted order, so two builds of one corpus assign identical ids.
  row_id          INTEGER PRIMARY KEY,
  cik             TEXT NOT NULL,
  period          TEXT NOT NULL,
  filing_key      INTEGER REFERENCES serving_filings(filing_key),
  security_id     TEXT,
  cusip           TEXT,
  issuer_name     TEXT NOT NULL,
  title_of_class  TEXT,
  value_usd       INTEGER,           -- NULL = undisclosed, never a fabricated 0
  shares          INTEGER,
  ssh_type        TEXT,
  put_call        TEXT,
  position_key    TEXT,              -- REFERENCE into agg_qoq_deltas, not a copy
  put_call_bucket TEXT NOT NULL,
  unit_key        TEXT NOT NULL,
  flags           TEXT NOT NULL
);
-- The boundary resolves (cik, period) on every request; at full-universe scale
-- that is ~7M rows without this index.
CREATE INDEX IF NOT EXISTS serving_filer_rows_by_filer
  ON serving_filer_rows (cik, period);
CREATE TABLE IF NOT EXISTS serving_issuer_holder_rows (
  row_id                      INTEGER PRIMARY KEY,
  issuer_key                  TEXT NOT NULL,
  issuer_key_source           TEXT NOT NULL,
  issuer_name                 TEXT NOT NULL,
  period                      TEXT NOT NULL,
  filer_key                   TEXT NOT NULL,   -- MANDATORY (review r2 F8)
  filer_name                  TEXT NOT NULL,
  affiliate_group_key         TEXT NOT NULL,
  value_usd                   INTEGER,         -- NULL when a component is undisclosed
  value_undisclosed_component INTEGER NOT NULL,
  security_count              INTEGER NOT NULL,
  filing_keys                 TEXT NOT NULL,   -- canonical sorted JSON array
  issuer_dedup_total_usd      INTEGER          -- DISTINCT; never summed with value_usd
);
CREATE INDEX IF NOT EXISTS serving_issuer_holder_rows_by_issuer
  ON serving_issuer_holder_rows (issuer_key, period);
-- The ACTIVITY grain: one row per QoQ position change. Column names are the
-- contract the dashboard loader (dashboard/src/lib/activity.ts) queries.
CREATE TABLE IF NOT EXISTS serving_activity (
  row_id              INTEGER PRIMARY KEY,
  cik                 TEXT NOT NULL,
  filer_name          TEXT,
  issuer_key          TEXT,
  issuer_name         TEXT,
  position_key        TEXT NOT NULL,
  put_call            TEXT NOT NULL,
  ssh_prnamt_type     TEXT NOT NULL,
  change_kind         TEXT NOT NULL,
  curr_period         TEXT NOT NULL,
  prev_period         TEXT,
  prev_value_usd      INTEGER,
  curr_value_usd      INTEGER,
  delta_value_usd     INTEGER,        -- NULL = undisclosed on a side; never 0
  prev_shares         INTEGER,
  curr_shares         INTEGER,
  delta_shares        INTEGER,
  filing_keys         TEXT NOT NULL,  -- ordered JSON array, never a scalar
  prior_filing_keys   TEXT NOT NULL,  -- exits only
  current_filing_keys TEXT NOT NULL,  -- exits only
  flags               TEXT NOT NULL
);
"""


def write_serving_db(
    projection: ServingProjection,
    dest: str,
    *,
    source_conn: sqlite3.Connection,
) -> None:
    """Materialise `projection` into a fresh `inst_serving.db` at `dest`.

    Deterministic: rows are inserted in the projection's already-sorted order and
    `filing_keys` is a canonical sorted JSON array, so two builds of one corpus
    produce identical bytes for the logical digest.

    FRESH means fresh, exactly as `inst_agg.build_inst_agg` means it: the
    destination is refused if it aliases the source and then REPLACED. Without
    the replace, a re-run against a reused staging directory either crashed on
    `serving_filings`' unique key or — for the three grain tables, whose only
    key is a surrogate — silently doubled every row (measured 1 → 2 → 3 across
    three writes). That path is live: the house staging directory is per-build-id
    and `reconcile_inflight` re-enters `_complete_build` on the same build_id.

    `source_conn` is REQUIRED rather than optional because the refusal is the
    only thing standing between "replace the destination" and "delete the
    ingested corpus": a caller that could omit it would get the unlink without
    the guard.
    """
    import json as _json
    import sqlite3 as _sqlite3
    from pathlib import Path as _Path

    dest_path = _Path(dest)
    refuse_if_dest_aliases_source(source_conn, dest_path)
    if dest_path.exists():
        dest_path.unlink()

    conn = _sqlite3.connect(dest)
    try:
        conn.executescript(SERVING_SCHEMA)
        conn.executemany(
            "INSERT INTO serving_filings (filing_key, accession, submission_type,"
            " period_of_report, filed_date, doc_url, source)"
            " VALUES (?, ?, ?, ?, ?, ?, ?)",
            [
                (
                    ref.filing_key, ref.accession, ref.submission_type,
                    ref.period_of_report, ref.filed_date, ref.doc_url, ref.source,
                )
                for ref in sorted(projection.filings.values(),
                                  key=lambda r: r.filing_key)
            ],
        )
        conn.executemany(
            "INSERT INTO serving_filer_rows (row_id, cik, period, filing_key, security_id,"
            " cusip, issuer_name, title_of_class, value_usd, shares, ssh_type,"
            " put_call, position_key, put_call_bucket, unit_key, flags)"
            " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            [
                (
                    i, r["cik"], r["period"], r["filing_key"], r["security_id"],
                    r["cusip"], r["issuer_name"], r["title_of_class"],
                    r["value_usd"], r["shares"], r["ssh_type"], r["put_call"],
                    r["position_key"], r["put_call_bucket"], r["unit_key"],
                    r["flags"],
                )
                for i, r in enumerate(projection.filer_rows)
            ],
        )
        conn.executemany(
            "INSERT INTO serving_issuer_holder_rows (row_id, issuer_key, issuer_key_source,"
            " issuer_name, period, filer_key, filer_name, affiliate_group_key,"
            " value_usd, value_undisclosed_component, security_count, filing_keys,"
            " issuer_dedup_total_usd) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            [
                (
                    i, r["issuer_key"], r["issuer_key_source"], r["issuer_name"],
                    r["period"], r["filer_key"], r["filer_name"],
                    r["affiliate_group_key"], r["value_usd"],
                    1 if r["value_undisclosed_component"] else 0,
                    r["security_count"], _json.dumps(sorted(r["filing_keys"]),
                                                     separators=(",", ":")),
                    r["issuer_dedup_total_usd"],
                )
                for i, r in enumerate(projection.issuer_holder_rows)
            ],
        )
        conn.executemany(
            "INSERT INTO serving_activity (row_id, cik, filer_name, issuer_key, issuer_name,"
            " position_key, put_call, ssh_prnamt_type, change_kind, curr_period,"
            " prev_period, prev_value_usd, curr_value_usd, delta_value_usd,"
            " prev_shares, curr_shares, delta_shares, filing_keys,"
            " prior_filing_keys, current_filing_keys, flags)"
            " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            [
                (
                    i, r["cik"], r["filer_name"], r["issuer_key"], r["issuer_name"],
                    r["position_key"], r["put_call"], r["ssh_prnamt_type"],
                    r["change_kind"], r["curr_period"], r["prev_period"],
                    r["prev_value_usd"], r["curr_value_usd"], r["delta_value_usd"],
                    r["prev_shares"], r["curr_shares"], r["delta_shares"],
                    _json.dumps(r["filing_keys"], separators=(",", ":")),
                    _json.dumps(r["prior_filing_keys"], separators=(",", ":")),
                    _json.dumps(r["current_filing_keys"], separators=(",", ":")),
                    _json.dumps(sorted(r["flags"]), separators=(",", ":")),
                )
                for i, r in enumerate(projection.activity_rows)
            ],
        )
        conn.commit()
    finally:
        conn.close()


def _build_activity_rows(
    conn: sqlite3.Connection,
    out: ServingProjection,
    periods: tuple[str, ...],
    display: dict[tuple[str, str, str], tuple[str, str]],
) -> None:
    """The ACTIVITY grain (plan §B, R13): one row per QoQ position change.

    Read from `agg_qoq_deltas` — the producer-owned classification — and joined to
    display fields and provenance the aggregate does not carry. This is a separate
    grain, not a widening of the holding rows: attaching change fields to holdings
    would duplicate a delta across the rows a composed position draws on (r2 F9).

    `filing_keys` is an ORDERED SET, never a scalar (r3 F7): a composed position
    draws on a base plus NEW-HOLDINGS amendments. Exits additionally carry
    `prior_filing_keys` (the composition that established the position) and
    `current_filing_keys` (the composition it is ABSENT from) — absence is only
    assertable from an authoritative-full composition (r6 F4).
    """
    import json as _json

    qoq_schema = _qoq_deltas_schema(conn)
    if qoq_schema is None:
        return  # no aggregate reachable here — the grain is legitimately absent

    placeholders = ",".join("?" for _ in periods)

    # (cik, period) -> ordered filing keys of that period's composition
    composition: dict[tuple[str, str], list[int]] = defaultdict(list)
    for ref in sorted(out.filings.values(), key=lambda r: (r.filed_date, r.accession)):
        composition[(ref.cik, ref.period_of_report)].append(ref.filing_key)

    authoritative = authoritative_full_periods(conn)

    compact_rows = compact_qoq_rows(conn, schema=qoq_schema, periods=periods)
    if compact_rows is None:
        qoq_table = _qoq_deltas_table(conn, schema=qoq_schema)
        if qoq_table is None:  # unreachable after the unique-schema preflight
            raise InstAggError("aggregate schema disappeared during projection")
        activity_rows = conn.execute(
            "SELECT cik, position_key, put_call, curr_period, prev_period, change_kind,"
            "       prev_value_usd, curr_value_usd, delta_value_usd, prev_shares,"
            "       curr_shares, delta_shares, ssh_prnamt_type, flags"
            f" FROM {qoq_table} WHERE curr_period IN ({placeholders})"  # nosec B608
            " ORDER BY cik, curr_period, position_key, put_call, ssh_prnamt_type",
            periods,
        )
    else:
        activity_rows = compact_rows

    for (
        cik, position_key, put_call, curr_period, prev_period, change_kind,
        prev_value, curr_value, delta_value, prev_shares, curr_shares,
        delta_shares, ssh_prnamt_type, flags,
    ) in activity_rows:
        # An EXIT has no current-period holding row by definition, so the current
        # lookup always misses for exactly the rows that most need a name. Falling
        # back to the prior period is what lets the feed say WHAT was exited; the
        # prior period's rows are already in scope because `periods` carries it.
        issuer_key, issuer_name = display.get(
            (cik, curr_period, position_key),
            display.get((cik, prev_period, position_key), (None, None))
            if prev_period
            else (None, None),
        )
        current_keys = composition.get((cik, curr_period), [])
        prior_keys = composition.get((cik, prev_period), []) if prev_period else []
        row_flags = list(_json.loads(flags)) if flags else []

        if change_kind == "exit" and (cik, curr_period) not in authoritative:
            # Absence is not assertable from this composition (r6 F4).
            change_kind = "unclassified"
            row_flags = sorted({*row_flags, "exit_not_assertable"})

        out.activity_rows.append(
            {
                "cik": cik,
                "filer_name": out.filer_names.get(cik),
                "issuer_key": issuer_key,
                "issuer_name": issuer_name,
                "position_key": position_key,
                "put_call": put_call,
                "ssh_prnamt_type": ssh_prnamt_type,
                "change_kind": change_kind,
                "curr_period": curr_period,
                "prev_period": prev_period,
                "prev_value_usd": prev_value,
                "curr_value_usd": curr_value,
                "delta_value_usd": delta_value,   # None = undisclosed, never 0
                "prev_shares": prev_shares,
                "curr_shares": curr_shares,
                "delta_shares": delta_shares,
                "filing_keys": current_keys,
                "prior_filing_keys": prior_keys if change_kind == "exit" else [],
                "current_filing_keys": current_keys if change_kind == "exit" else [],
                "flags": row_flags,
            }
        )


def _qoq_deltas_schema(conn: sqlite3.Connection) -> str | None:
    """Return the unique reachable aggregate schema, or None when wholly absent.

    A public/private split or two reachable aggregate schemas is corruption, not
    a reason to choose whichever database happens to appear first.
    """
    placeholders = ",".join("?" for _ in _QOQ_SCHEMA_SENTINELS)
    candidates: list[tuple[str, set[str]]] = []
    for _seq, schema, _file in conn.execute("PRAGMA database_list").fetchall():
        quoted_schema = _quote_sqlite_identifier(str(schema))
        names = {
            str(row[0])
            for row in conn.execute(
                f"SELECT name FROM {quoted_schema}.sqlite_master"
                f" WHERE name IN ({placeholders})",
                _QOQ_SCHEMA_SENTINELS,
            )
        }
        if names:
            candidates.append((str(schema), names))
    if not candidates:
        return None
    if len(candidates) != 1:
        raise InstAggError("multiple reachable aggregate schemas are ambiguous")
    schema, names = candidates[0]
    if "agg_qoq_deltas" not in names:
        raise InstAggError("aggregate private state is reachable without its public relation")
    return schema


def _qoq_deltas_table(
    conn: sqlite3.Connection, *, schema: str | None = None
) -> str | None:
    """Compatibility seam returning the uniquely qualified public relation."""
    if schema is None:
        schema = _qoq_deltas_schema(conn)
    if schema is None:
        return None
    return f"{_quote_sqlite_identifier(schema)}.agg_qoq_deltas"
