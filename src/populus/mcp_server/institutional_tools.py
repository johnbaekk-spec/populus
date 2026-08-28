"""The five institutional (13F) MCP tools (``inst_*``) and their boundary.

Registered onto the shared FastMCP app by ``build_server`` in ``server.py``
(the composition root). Aggregate/federated query logic lives in
``inst_queries.py`` and the honesty envelope in ``envelope.py``; this module
owns the tool functions, the published serving projection's consumer half, the
M2-CONTRACT §3.1 federated boundary, and the standing inst caveats
(``inst_health_caveats``, also reused by ``populus_health`` in ``server.py``).

**The retained federated boundary (M2-CONTRACT §3.1).** Per-filer holdings detail used to be Pattern F for *any* period —
the module published aggregates only, so every position list was a live EDGAR
fetch. M2-8 publishes the per-filer projection as ``inst_serving.db``, and the
live path narrows to exactly two cases:

1. **filings newer than the published build** — a period after the build's
   published coverage; and
2. **filers/periods outside the published universe** — a filer discovered after
   the build ran, or a period not yet ingested.

Everything the build DID publish is answered from ``inst_serving.db`` and
touches no network, whichever mode was asked for. When the serving artifact is
absent the boundary cannot be evaluated at all; the live path stays open (it is
the only answer left) but every such response says so on its face — the one
thing that is never done is answering a per-filer detail question out of the
cross-filer aggregate.
"""

from __future__ import annotations

import sqlite3
from datetime import datetime
from typing import Any, Callable

from mcp.server.fastmcp import FastMCP

from populus.identity.registry import normalize_cik, normalize_ticker
from populus.mcp_server import envelope as env
from populus.mcp_server import inst_queries as iq
from populus.mcp_server import queries as q
from populus.net.sec_client import SecCircuitOpenError, SecClient, SecUrlError
from populus.normalize_inst import INST_DATA_NOTE

_ISO = "%Y-%m-%d"


def _canon_date(s: str) -> str | None:
    """A valid ISO date re-rendered in canonical zero-padded form, else ``None``.

    ``strptime`` is lenient (it accepts ``2026-3-31``), but the aggregate stores
    canonical ``YYYY-MM-DD`` periods, so a lenient period must be normalized or
    it would silently match nothing. ``None`` signals an unparseable input for a
    corrective hint at the call site."""
    try:
        return datetime.strptime(s, _ISO).strftime(_ISO)
    except ValueError:
        return None



#: What `new`/`exit` actually mean. They are trading verbs applied to a SET
#: DIFFERENCE, and `inst_biggest_moves(side='exit')` is exactly the query an
#: analyst will ask.
_FLOW_CAVEAT = (
    "`new` and `exit` mean a position was PRESENT or ABSENT between two"
    " filings — NOT that it was bought or sold. A position also disappears when"
    " the security stops being a 13(f) security, on an acquisition, when it"
    " moves under confidential treatment, when it migrates to an affiliated"
    " filer, or when re-keying leaves the matcher unable to reconcile it (which"
    " manufactures a PAIRED phantom exit and phantom new). Positions with no"
    " usable identity key are excluded from the delta set entirely, and a change"
    " whose direction could not be determined is `side='unclassified'` and"
    " appears under NO other side (G3/G10)."
)

#: The qoq tool additionally reports the denominator; the cross-filer tool has no
#: single filer to scope it to, so the caveat must not point at a key that tool
#: never emits (F-N7 — the same dangling-pointer defect fixed one round earlier).
_FLOW_CAVEAT_QOQ = _FLOW_CAVEAT + " Compare `delta_universe` for this filer's"
_FLOW_CAVEAT_QOQ += " full position count."


# --- the published serving projection: the CONSUMER half of the contract -----
#
# `inst_serving.db` is a Release asset built by `publish/` from
# `populus.inst_serving.build_serving_projection` (plan §C, task T8). The
# producer owns the writer; this is the only place that reads it, and the names
# below are the whole coupling surface — the two table names the producer
# declares in `publish/digests.py` `ARTIFACT_PROJECTIONS`, plus the row keys the
# projection already emits (`ServingProjection.filer_rows`, `FilingRef.as_dict`).
# The third projected table, `serving_issuer_holder_rows`, is the dashboard's
# grain and is deliberately NOT required here: the boundary must not depend on a
# table it never reads.
#
# The filing dictionary is a SEPARATE table, not columns repeated on every row:
# that is the serving projection's provenance compression (one entry per filing instead of ~600k
# duplicated strings), and every holding row carries its `filing_key` so the
# per-record provenance contract still holds.
_SERVING_HOLDINGS = "serving_filer_rows"
_SERVING_FILINGS = "serving_filings"
_SERVING_REQUIRED_TABLES = (_SERVING_HOLDINGS, _SERVING_FILINGS)

#: A published book can be very large (the measured worst case is a
#: 37,140-position filer), so the published-detail list is bounded and discloses
#: its own truncation — the `inst_filer_lookup` idiom, not a second pagination
#: rule. The live path is one filing and stays unbounded, as it already was.
_DETAIL_LIMIT_DEFAULT = 500
_DETAIL_LIMIT_MAX = 5000

#: What is said when no serving artifact was resolved at all. Named once so the
#: resolver, the boundary and health cannot drift into three different stories.
_SERVING_ABSENT_DEFAULT = (
    "this server resolved no published per-filer serving projection"
    " (inst_serving.db), so no per-filer holdings detail is published to serve"
)


def _serving_schema_error(conn: sqlite3.Connection) -> str | None:
    """Why *conn* cannot be used as a serving projection, or ``None``.

    A file that is a valid SQLite database but not THIS schema must be refused
    by name rather than blowing up inside a tool call — and must never be
    quietly replaced by the aggregate, which is a different grain answering a
    different question.
    """
    try:
        present = {
            row[0]
            for row in conn.execute(
                "SELECT name FROM sqlite_master WHERE type IN ('table','view')"
            )
        }
    except sqlite3.Error as exc:
        return f"the serving projection could not be read ({exc})"
    missing = [name for name in _SERVING_REQUIRED_TABLES if name not in present]
    if missing:
        return (
            "the file supplied as the serving projection does not carry the"
            f" published per-filer schema (missing {', '.join(missing)}), so no"
            " published detail is served from it"
        )
    return None


def _serving_periods_for(conn: sqlite3.Connection, cik: str) -> list[str]:
    """Every period this build PUBLISHED for *cik*, newest first (possibly [])."""
    return [
        row[0]
        for row in conn.execute(
            f"SELECT DISTINCT period FROM {_SERVING_HOLDINGS}"
            " WHERE cik = ? ORDER BY period DESC",
            (cik,),
        )
    ]


def _serving_latest_period(conn: sqlite3.Connection) -> str | None:
    """The newest period ANY filer was published for — the build's coverage edge.

    This is what separates boundary case (a) from case (b): a request past this
    date is a filing newer than the published build, not a filer the build
    declined to cover.
    """
    row = conn.execute(f"SELECT MAX(period) FROM {_SERVING_HOLDINGS}").fetchone()
    return row[0] if row is not None else None


#: The published-detail row projection, joined to its filing dictionary entry.
#: Columns are named explicitly (never ``h.*``) so a producer-side column
#: addition cannot silently reorder or shadow a field this reads.
_SERVING_DETAIL_SQL = (
    "SELECT h.security_id, h.cusip, h.issuer_name, h.title_of_class,"
    "       h.value_usd, h.shares, h.ssh_type, h.put_call, h.position_key,"
    "       h.flags, h.filing_key,"
    "       f.accession, f.submission_type, f.period_of_report, f.filed_date,"
    "       f.doc_url, f.source"
    f" FROM {_SERVING_HOLDINGS} h"
    f" LEFT JOIN {_SERVING_FILINGS} f ON f.filing_key = h.filing_key"
    " WHERE h.cik = ? AND h.period = ?"
    " ORDER BY h.rowid"
    " LIMIT ? OFFSET ?"
)

#: The published position count for one (cik, period) — the true total behind a
#: paged answer. Counted in SQL rather than by materialising the rows: the named
#: outlier holds 37,140 positions and the previous implementation built a dict
#: for every one of them before slicing to at most 5,000.
_SERVING_DETAIL_COUNT_SQL = (
    f"SELECT COUNT(*) FROM {_SERVING_HOLDINGS} WHERE cik = ? AND period = ?"
)


def _serving_detail_rows(
    conn: sqlite3.Connection,
    cik: str,
    period: str,
    *,
    limit: int,
    offset: int = 0,
) -> list[dict[str, Any]]:
    """One page of published detail rows, bounded in SQL."""
    return [
        dict(row)
        for row in conn.execute(_SERVING_DETAIL_SQL, (cik, period, limit, offset))
    ]


def _serving_detail_count(conn: sqlite3.Connection, cik: str, period: str) -> int:
    return int(conn.execute(_SERVING_DETAIL_COUNT_SQL, (cik, period)).fetchone()[0])


def inst_health_caveats(
    from_published_manifest: bool,
    *,
    absent: bool = False,
    gate_withheld: bool = False,
    stale_withdrawal_pending: bool = False,
) -> list[str]:
    """Standing inst caveats — the coverage claim is made ONLY for data that
    actually came through the published-manifest path.

    A `--inst-db` bypass points at an arbitrary local file that never passed the
    M2-3 publish gate, so asserting ">=95% coverage is guaranteed" there would
    FABRICATE an assurance about unpublished data.
    """
    caveats = [
        "Holdings are quarter-end snapshots of long 13(f) positions, not"
        " current or full portfolios (G10).",
    ]
    if stale_withdrawal_pending:
        # A verified manifest OMITTED this module, but the withdrawal could not
        # be committed, so these bytes are still being served. They did pass the
        # gate when published — but they are NOT what the current build
        # publishes, and saying nothing would present them as clean current data (a staleness
        # signal computed but never surfaced to the server is as good as none).
        caveats.insert(
            0,
            "STALE: the current published snapshot's verified manifest no longer"
            " includes this module, but the withdrawal could not be committed to"
            " the local cache, so a PREVIOUS build is still being served. Treat"
            " these holdings as out of date until a later refresh succeeds.",
        )
    if absent:
        # Absence is a reasoned state — but WHICH reason is a matter of fact,
        # not assumption. Only a verified manifest that omits the module proves
        # the gate withheld it.
        caveats.insert(
            0,
            "The module is WITHHELD, not broken: the M2-3 publish gate refuses to"
            " publish institutional data whose identity coverage is below 95% by"
            " value, so nothing is served rather than serving under-covered data."
            if gate_withheld
            else "No institutional database is loaded. NO coverage-gate decision"
            " was observed for this server, so nothing is claimed about why the"
            " data is unavailable — see `reason` for what actually happened.",
        )
        caveats.insert(
            1,
            "Live federated reads (inst_filer_holdings mode='detail') remain"
            " available and are stamped with their SEC source instead of a build.",
        )
        return caveats
    if from_published_manifest:
        # Inserted BELOW a STALE warning so staleness is read first — an
        # assurance above it reads as if the assurance still applies.
        caveats.insert(
            1 if stale_withdrawal_pending else 0,
            "Coverage of at least 95% by value is guaranteed by the M2-3 publish"
            " gate; the exact coverage figure and the per-filing unit-regime mix"
            " are pipeline-side and are not carried in the published aggregate"
            " (available on federated mode='detail').",
        )
    else:
        caveats.insert(
            0,
            "UNVERIFIED SOURCE: this institutional database was supplied directly"
            " (--inst-db) and did NOT come from a verified published manifest, so"
            " NO coverage guarantee applies — the M2 >=95%-by-value publish gate"
            " has not been shown to hold for it.",
        )
    return caveats


def register_institutional_tools(
    mcp: FastMCP,
    *,
    as_of: Callable[[], str],
    inst_conn: sqlite3.Connection | None,
    inst_db_path: str | None,
    inst_build_id: str | None,
    inst_watermarks: dict[str, Any] | None,
    inst_from_published_manifest: bool,
    inst_absent_reason: str | None,
    inst_absent_gate_withheld: bool,
    inst_stale_withdrawal_pending: bool,
    inst_serving_db_path: str | None,
    inst_serving_absent_reason: str | None,
    sec_client: SecClient | None,
) -> None:
    """Register the five ``inst_*`` tools on *mcp*.

    Parameters carry the same meaning as on ``build_server`` (see its
    docstring); ``inst_conn`` is the already-opened aggregate connection (or
    ``None`` when the module is honestly absent), while the per-filer serving
    projection is opened and schema-checked HERE from
    ``inst_serving_db_path`` — it is this domain's artifact.
    """
    # The serving projection is opened and schema-checked ONCE, here, so a tool
    # call can never discover mid-answer that the artifact is unusable and have
    # to invent a story about it. Every failure resolves to the same shape: no
    # connection, plus a stated reason.
    serving_conn: sqlite3.Connection | None = None
    serving_absent: str | None = inst_serving_absent_reason
    if inst_serving_db_path:
        try:
            candidate = q.connect(inst_serving_db_path)
        except sqlite3.Error as exc:
            serving_absent = (
                f"the published serving projection at {inst_serving_db_path}"
                f" could not be opened ({type(exc).__name__}: {exc})"
            )
        else:
            schema_error = _serving_schema_error(candidate)
            if schema_error is None:
                serving_conn = candidate
                serving_absent = None
            else:
                candidate.close()
                serving_absent = schema_error
    elif serving_absent is None:
        serving_absent = _SERVING_ABSENT_DEFAULT

    def _inst_env(
        results: Any,
        *,
        extra_note: str | None = None,
        live_source: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        """An M2 envelope: the reused non-removable INST_DATA_NOTE, a scoped
        ``sec-edgar`` license notice, and either the inst ``build_id`` or (for a
        federated fetch) a ``live_source`` stamp."""
        # Provenance caveats must travel on the DATA plane, not only health: the
        # data_note is non-removable precisely so a response lifted out of
        # context carries its caveats. They apply ONLY to snapshot-plane answers
        # — a federated `live_source` response is freshly fetched, so stamping it
        # "these figures come from a PREVIOUS build" would be false,
        # and it never passed through the --inst-db path either.
        if live_source is None:
            prefix = None
            if inst_stale_withdrawal_pending:
                prefix = (
                    "STALE: the current published snapshot no longer includes"
                    " this module, but the withdrawal could not be committed"
                    " locally, so these figures come from a PREVIOUS build."
                )
            elif inst_db_path is not None and not inst_from_published_manifest:
                # Health alone once said "UNVERIFIED SOURCE … NO coverage
                # guarantee applies"; the data plane said nothing.
                prefix = (
                    "UNVERIFIED SOURCE: this institutional database was supplied"
                    " directly (--inst-db) and did not come from a verified"
                    " published manifest, so NO coverage guarantee applies."
                )
            if prefix is not None:
                extra_note = f"{prefix} {extra_note}" if extra_note else prefix
        return env.envelope(
            build_id=inst_build_id,
            as_of=as_of(),
            results=results,
            extra_note=extra_note,
            live_source=live_source,
            data_note=INST_DATA_NOTE,
            license_notices_list=env.license_notices_for(["sec-edgar"]),
        )

    # The absent-module message states only what the RESOLVER actually
    # observed. Claiming a coverage-gate withholding for a `--db` dev bypass or
    # a failed refresh would report a decision that never happened.
    def _qoq_absence_hint(
        cik: str, requested: str | None, result: dict[str, Any]
    ) -> dict[str, Any]:
        """Distinguish "no data" from "no change".

        "no quarter-over-quarter changes on record" reads as "the portfolio did
        not change" — and was returned identically for a nonexistent quarter, a
        filer's FIRST quarter (nothing to compare against), and a CIK that is
        not a filer at all. The snapshot branch was fixed for exactly this.
        """
        if inst_conn is None:
            return {}
        available = iq.filer_periods(inst_conn, cik=cik)
        if not available:
            return {"absence_reason": f"CIK {cik} is not a filer in the"
                    " published aggregate — no periods on record."}
        if requested is not None and requested not in available:
            return {"absence_reason": f"no institutional data for CIK {cik} at"
                    f" period {requested}. Available periods:"
                    f" {', '.join(available)}.",
                    "available_periods": available}
        if result.get("prev_period") is None:
            return {"absence_reason": "this is the earliest period on record for"
                    " this filer, so there is no prior quarter to compare"
                    " against — NOT evidence that the portfolio was unchanged.",
                    "available_periods": available}
        return {}

    def _qoq_universe(cik: str, result: dict[str, Any]) -> dict[str, Any]:
        """The denominator the delta set was computed against."""
        period = result.get("curr_period")
        if inst_conn is None or period is None:
            return {}
        stats = iq.qoq_universe(inst_conn, cik=cik, period=period)
        return {
            "delta_universe": {
                **stats,
                "changes_returned": len(result.get("changes", [])),
                "note": "positions with no usable identity key never enter the"
                " delta set, so `changes` can be far smaller than the book;"
                " compare `changes_returned` against `period_position_count`",
            }
        }

    def _filed_through() -> dict[str, Any]:
        """The filing-level date for AGGREGATE responses (G4).

        The aggregate rolls up many filings and carries no per-row filed date,
        so the honest disclosure is the build's watermark — the latest filed
        date any row can reflect. `inst_ticker_holders` already did this; the
        snapshot/qoq/biggest-moves paths asserted "both dates on every record"
        in the failure-mode sweep while carrying only the period.
        """
        return {"filed_through": (inst_watermarks or {}).get("latest_filed_date")}

    def _live_failure(url_hint: str) -> dict[str, Any]:
        """The provenance stamp for a FAILED federated read.

        A live SEC failure is still a federated outcome; returning it through
        the snapshot-default envelope stamped it with the institutional
        `build_id`, misattributing it to published snapshot data and breaking
        the §11.3 live_source-xor-build_id data-plane rule.
        """
        return {
            "source": "sec-edgar-live",
            "accession": None,
            "doc_url": url_hint,
            "retrieved_at": as_of(),
            "outcome": "failed",
        }

    _INST_ABSENT = inst_absent_reason or (
        "the institutional (13F) module is not present in the current published"
        " snapshot"
    )

    # --- the retained federated boundary (M2-CONTRACT §3.1) ---------

    def _boundary(cik: str, period: str | None) -> dict[str, Any]:
        """Where a per-filer detail request must be answered.

        ONE routing decision, made in ONE place, for both `mode='snapshot'` and
        `mode='detail'` — the boundary is a property of the (cik, period), not
        of the word the caller happened to use. Two federated cases exist and no
        others:

          post_snapshot   the period is newer than the build's coverage edge
          off_universe    the filer/period is not in the published universe

        Anything the build published routes to `published` with no network I/O.
        A missing serving artifact yields `universe_unavailable`: the boundary
        was NOT evaluated, so the response must not claim the request was found
        to be off-universe — and must not be answered from the aggregate either.
        """
        if serving_conn is None:
            return {
                "route": "federated",
                "reason": "universe_unavailable",
                "boundary_evaluated": False,
                "period": period,
                "detail": serving_absent or _SERVING_ABSENT_DEFAULT,
            }
        published_periods = _serving_periods_for(serving_conn, cik)
        # An omitted period means "the newest you have" — which, inside the
        # published universe, is the build's newest for THIS filer. It is not a
        # licence to go live: "latest" is case (a) only when the caller names a
        # period the build does not reach.
        target = period or (published_periods[0] if published_periods else None)
        if target is not None and target in published_periods:
            return {
                "route": "published",
                "reason": "in_published_universe",
                "boundary_evaluated": True,
                "period": target,
                "published_periods": published_periods,
            }
        latest = _serving_latest_period(serving_conn)
        # ISO YYYY-MM-DD sorts lexicographically, and `period` was canonicalized
        # by the caller, so this comparison is the date comparison.
        post = period is not None and latest is not None and period > latest
        return {
            "route": "federated",
            "reason": "post_snapshot" if post else "off_universe",
            "boundary_evaluated": True,
            "period": period,
            "published_periods": published_periods,
            "published_latest_period": latest,
        }

    def _boundary_block(decision: dict[str, Any]) -> dict[str, Any]:
        """The routing decision, on the face of the response that it produced."""
        explanation = {
            "in_published_universe": "this filer and period are in the published"
            " universe, so the answer comes from the published serving"
            " projection and NO live SEC request was made (M2-CONTRACT §3.1).",
            "post_snapshot": "the requested period is newer than the published"
            " build's coverage, so it was answered live from SEC EDGAR"
            " (M2-CONTRACT §3.1 case 1).",
            "off_universe": "this filer/period is not in the published universe"
            " — a filer discovered after the build ran, or a period not yet"
            " ingested — so it was answered live from SEC EDGAR"
            " (M2-CONTRACT §3.1 case 2).",
            "universe_unavailable": "the published serving projection is not"
            " available, so the federated boundary could NOT be evaluated: this"
            " answer was fetched live, and that is not a finding that the filer"
            " is outside the published universe.",
        }[decision["reason"]]
        block = {
            "federated_boundary": {
                "route": decision["route"],
                "reason": decision["reason"],
                "boundary_evaluated": decision["boundary_evaluated"],
                "explanation": explanation,
            }
        }
        for key in ("published_periods", "published_latest_period", "detail"):
            if key in decision:
                block["federated_boundary"][key] = decision[key]
        return block

    def _published_positions(
        cik: str, period: str, limit: int, offset: int = 0
    ) -> dict[str, Any]:
        """One PAGE of the published position list for an in-universe (cik, period).

        Rows are shaped exactly like the federated ones so a client parses both
        planes identically; each carries its OWN filing's filed date and
        document, because a composed period mixes a base filing with its
        amendments and restamping them all with one date would misreport when
        those positions were disclosed (G4).

        `limit` is capped at 5,000 and there was no cursor, so
        32,140 of the named 37,140-position filer's rows were permanently
        unreachable through this boundary — while the truncation note advised
        "Raise `limit` (max 5000)", advice already at its ceiling. The promised
        "complete position list" was not reachable. The truncation was always
        signalled honestly; what was missing was the recovery path, and the
        house idiom for it (`env.encode_cursor`) already existed on
        `congress_recent_trades`.
        """
        total = _serving_detail_count(serving_conn, cik, period)
        rows = _serving_detail_rows(
            serving_conn, cik, period, limit=limit, offset=offset
        )
        shaped = [
            env.shape_holding(
                {
                    "issuer_name": row["issuer_name"],
                    "cusip": row["cusip"],
                    "title_of_class": row["title_of_class"],
                    "value_usd": row["value_usd"],
                    "ssh_prnamt": row["shares"],
                    "ssh_prnamt_type": row["ssh_type"],
                    "put_call": row["put_call"],
                    "security_id": row["security_id"],
                    "flags": row["flags"],
                },
                period_of_report=period,
                filed_date=row["filed_date"],
                doc_url=row["doc_url"],
                # Already selected by `_SERVING_DETAIL_SQL` and previously
                # discarded one line later — a §5.1 provenance field in hand.
                accession=row["accession"],
            )
            for row in rows
        ]
        block: dict[str, Any] = {
            "period_of_report": period,
            "served_from": "published-serving-projection",
            "holdings": shaped,
            "position_count_published": total,
            "returned": len(shaped),
            "offset": offset,
            "truncated": offset + len(shaped) < total,
            # `unit_basis` is a FILING-level attribute of the raw disclosure. The
            # published projection stores values already normalized to whole
            # USD, so the per-filing regime is not carried and `unit_basis` on
            # these rows is null — declared here rather than left to look like
            # an unparseable value (G3/G5).
            "unit_basis_note": "values in the published projection are"
            " normalized to whole USD, so the per-filing unit regime"
            " (`unit_basis`) is not carried on these rows; it is available on"
            " the live federated path.",
        }
        if block["truncated"]:
            block["next_cursor"] = env.encode_cursor(offset + len(shaped))
            block["truncation_note"] = (
                f"{total} published positions; rows {offset + 1}–"
                f"{offset + len(shaped)} in published order are returned. Pass"
                " `cursor=next_cursor` to continue — the complete list is"
                f" reachable in pages of at most {_DETAIL_LIMIT_MAX}."
            )
        else:
            block["next_cursor"] = None
        return block

    def _snapshot_positions(cik: str, period: str | None, limit: int) -> dict[str, Any]:
        """The aggregate profile's companion position list, or a stated absence.

        Routed on the profile's ALREADY-RESOLVED period, never on the caller's
        possibly-omitted one: the profile and the position list must describe
        the same quarter, and the aggregate (all retained periods) and the
        serving projection (the two browsable periods, OD-5) do not have the
        same idea of "latest".

        When the build published no detail for this (cik, period) the block says
        so and names the reason. It never degrades to an empty `holdings` list —
        "no positions published" and "this filer held nothing" are different
        facts and only one of them is true (G3).
        """
        if period is None:
            return {
                "published_detail_unavailable": {
                    "reason": "no period could be resolved for this filer, so"
                    " there is no quarter to serve a published position list for"
                }
            }
        decision = _boundary(cik, period)
        if decision["route"] == "published":
            return {
                "published_detail": _published_positions(cik, period, limit),
                **_boundary_block(decision),
            }
        return {
            "published_detail_unavailable": {
                "reason": decision.get("detail")
                or "this filer and period are not in the published per-filer"
                " universe, so no published position list exists for them",
                "retry": "mode='detail' fetches this period live from SEC EDGAR",
            },
            **_boundary_block(decision),
        }
    # --- institutional 13F tools (M2) ---------------------------------------
    @mcp.tool()
    def inst_filer_lookup(query: str, limit: int = 25) -> dict[str, Any]:
        """Who is this 13F filer? Resolve an institutional manager name fragment or a CIK to canonical filers (with CIKs) from the published aggregate, for use in the other inst tools."""
        limit = max(1, min(limit, 100))
        if not query or not query.strip():
            return _inst_env(
                results={"error": "provide a filer name fragment or a CIK,"
                         " e.g. 'Berkshire' or '1067983'"}
            )
        if inst_conn is None:
            return _inst_env(results={"unavailable": _INST_ABSENT})
        rows = iq.filer_lookup(inst_conn, query=query, limit=limit)
        if not rows:
            return _inst_env(
                results={**_filed_through(), "matches": [],
                         "hint": f"no 13F filer matches {query!r};"
                         " try a manager surname or a numeric CIK"}
            )
        total = iq.filer_lookup_total(inst_conn, query=query)
        return _inst_env(
            results={
                **_filed_through(),
                "matches": rows,
                "total_matches": total,
                "returned": len(rows),
                "truncated": total > len(rows),
                # This is the documented entry point for every other inst tool;
                # against the real ~5,000-filer registry a fragment like
                # "Capital" matches hundreds, and filer #26 was indistinguishable
                # from not existing.
                "ranking_basis": "ordered by total value summed across ALL"
                " retained periods, so a filer with more retained quarters can"
                " outrank a larger filer with fewer",
                **({"truncation_note":
                    f"{total} filers match; the {len(rows)} highest-ranked are"
                    " returned. Raise `limit` (max 100) or query a CIK directly."}
                   if total > len(rows) else {}),
            }
        )

    @mcp.tool()
    def inst_filer_holdings(
        cik: str,
        period: str | None = None,
        mode: str = "snapshot",
        limit: int = _DETAIL_LIMIT_DEFAULT,
        cursor: str | None = None,
    ) -> dict[str, Any]:
        """A 13F filer's holdings. mode='snapshot': the published aggregate profile (position count, total value, concentration) plus, when this filer+period is in the published universe, the full published position list. mode='qoq': the filer's quarter-over-quarter position changes. mode='detail': the position list — served from the published snapshot when the build published it (no network), and fetched LIVE from SEC EDGAR only for a period newer than the build or a filer/period outside the published universe; on the live path check composition_complete, because an unparseable filing or an unread history shard can make it partial. Every response carries `federated_boundary` saying which path answered it and why. Use inst_filer_lookup to get the CIK; period is a quarter-end date like 2026-03-31; limit bounds one page of the published position list, and `cursor` (from a previous response's `next_cursor`) continues it — a filer with more positions than `limit` is paged, never truncated beyond reach."""
        if mode not in ("snapshot", "qoq", "detail"):
            return _inst_env(
                results={"error": "mode must be 'snapshot', 'qoq', or 'detail';"
                         f" got {mode!r}"}
            )
        norm = normalize_cik(cik)
        if norm is None:
            return _inst_env(
                results={"error": "cik must be a numeric CIK of up to 10 digits;"
                         f" got {cik!r}"}
            )
        if period is not None:
            period = _canon_date(period)
            if period is None:
                return _inst_env(
                    results={"error": "period must be an ISO quarter-end date"
                             " YYYY-MM-DD, e.g. 2026-03-31"}
                )
        limit = max(1, min(int(limit), _DETAIL_LIMIT_MAX))
        try:
            offset = env.decode_cursor(cursor)
        except ValueError:
            return _inst_env(
                results={"error": "cursor is not a cursor this server issued;"
                         " pass the `next_cursor` value from a previous response"
                         " verbatim, or omit it to start from the first page"}
            )
        if mode == "detail":
            # M2-CONTRACT §3.1: the live path is not the default for detail any
            # more. Route FIRST — a request the build published is answered from
            # the published projection, and the SEC client is never reached.
            decision = _boundary(norm, period)
            if decision["route"] == "published":
                return _inst_env(
                    results={
                        "mode": "detail",
                        "cik": norm,
                        **_published_positions(
                            norm, decision["period"], limit, offset
                        ),
                        **_boundary_block(decision),
                    },
                    extra_note="Served from the published per-filer projection,"
                    " not a live SEC fetch: this filer and period are inside the"
                    " published universe. The holdings are the quarter-end"
                    " snapshot, not current positions (G10).",
                )
            # Federated live fetch — available even when the inst module is
            # absent from the published snapshot.
            if sec_client is None:
                return _inst_env(
                    results={"error": "live detail is unavailable: this server"
                             " was started without a SEC federated client",
                             **_boundary_block(decision)},
                    # A federated CONFIGURATION failure is still a federated
                    # outcome; the snapshot-default envelope would stamp it with
                    # inst_build_id.
                    live_source=_live_failure("(no federated client configured)"),
                )
            try:
                detail = iq.fetch_filer_detail(
                    sec_client, norm, period, ingested_at=as_of()
                )
            except iq.InstDetailUnavailable as exc:
                return _inst_env(results={"error": str(exc),
                                          **_boundary_block(decision)},
                                 live_source=_live_failure("data.sec.gov/submissions"))
            except SecCircuitOpenError as exc:
                return _inst_env(
                    results={"error": f"SEC circuit breaker is open: {exc}",
                             **_boundary_block(decision)},
                    live_source=_live_failure("data.sec.gov/submissions"),
                )
            except SecUrlError as exc:
                return _inst_env(
                    results={"error": f"refusing SEC fetch: {exc}",
                             **_boundary_block(decision)},
                    live_source=_live_failure("data.sec.gov/submissions"),
                )
            except Exception as exc:  # noqa: BLE001 — tool boundary
                # A timeout, connection reset, decode error or malformed SEC
                # payload must become an HONEST envelope, never a raised
                # exception out of an MCP call. The message is
                # sanitized to the exception type + text, which carries no
                # credentials (the client sends none).
                return _inst_env(
                    results={
                        "error": "live SEC fetch failed"
                        f" ({type(exc).__name__}: {exc}); the published snapshot"
                        " modes (mode='snapshot'/'qoq') are unaffected",
                        **_boundary_block(decision),
                    },
                    live_source=_live_failure("data.sec.gov/submissions"),
                )
            # Each row is stamped with ITS OWN filing's date, document and
            # ACCESSION — a composed period mixes a base and its amendment, and
            # restamping the base rows with the amendment's provenance would
            # misreport which document disclosed those positions (G4).
            # `source_accession` is the third sibling of the two below and was
            # dropped here while the published plane passed it, so the same
            # client parsing both planes saw a real accession from one and
            # `null` from the other.
            holdings = [
                env.shape_holding(
                    h,
                    period_of_report=detail["period_of_report"],
                    filed_date=h.get("source_filed_date") or detail["filed_date"],
                    doc_url=h.get("source_doc_url") or detail["doc_url"],
                    accession=h.get("source_accession") or detail["accession"],
                )
                for h in detail["holdings"]
            ]
            return _inst_env(
                results={
                    "mode": "detail",
                    "cik": norm,
                    "filer_name": detail["filer_name"],
                    "accession": detail["accession"],
                    "submission_type": detail["submission_type"],
                    "period_of_report": detail["period_of_report"],
                    "filed_date": detail["filed_date"],
                    "parse_status": detail["parse_status"],
                    "last_filing_parse_status": detail["last_filing_parse_status"],
                    # How this period's answer was assembled: the base filing and
                    # every amendment applied to it, in filed order.
                    "composition": detail["composition"],
                    "composition_complete": detail["composition_complete"],
                    "history_complete": detail["history_complete"],
                    "unread_shards": detail["unread_shards"],
                    "rejected_filings": detail["rejected_filings"],
                    **({"composition_warning": detail["composition_warning"]}
                       if "composition_warning" in detail else {}),
                    "holdings": holdings,
                    "identity_note": "security identity is left unresolved on the"
                    " live federated path (no as-of registry at question time);"
                    " each holding carries its raw CUSIP + issuer name (G14).",
                    **_boundary_block(decision),
                },
                live_source=detail["live_source"],
                extra_note="Live per-filer detail fetched from SEC EDGAR at"
                " question time; the holdings are the quarter-end snapshot, not"
                " current positions (G10).",
            )
        # snapshot / qoq require the published inst module.
        if inst_conn is None:
            return _inst_env(
                results={"unavailable": _INST_ABSENT + "; retry with mode='detail'"
                         " to fetch this filer's holdings live from SEC EDGAR"}
            )
        if mode == "qoq":
            result = iq.filer_qoq(inst_conn, cik=norm, period=period)
            if not result["changes"]:
                return _inst_env(
                    results={"mode": "qoq", "cik": norm, **_filed_through(),
                             **_qoq_universe(norm, result), **result,
                             **_qoq_absence_hint(norm, period, result),
                             "hint": f"no quarter-over-quarter changes on record"
                             f" for CIK {norm}"}
                )
            return _inst_env(
                results={"mode": "qoq", "cik": norm, **_filed_through(),
                         **_qoq_universe(norm, result), **result},
                extra_note="Quarter-over-quarter position FLOW (changes between"
                " two quarter-end snapshots), not a holdings statement (G10)."
                " " + _FLOW_CAVEAT_QOQ,
            )
        profile = iq.filer_snapshot(inst_conn, cik=norm, period=period)
        if profile is None:
            return _inst_env(
                results={"mode": "snapshot", "cik": norm, "hint": f"CIK {norm} is"
                         " not a filer in the published aggregate; use"
                         " inst_filer_lookup, or retry with mode='detail' for a"
                         " live fetch"}
            )
        # `mode='snapshot'` now serves the published per-filer DETAIL, not
        # only the aggregate profile — that is the half of the reversal that
        # makes the narrowed federated boundary honest. Without it, narrowing
        # `detail` would just remove an answer.
        return _inst_env(
            results={
                "mode": "snapshot", "cik": norm, **_filed_through(), **profile,
                **_snapshot_positions(norm, profile.get("period_of_report"), limit),
            }
        )

    @mcp.tool()
    def inst_ticker_holders(
        ticker: str, period: str | None = None, limit: int = 50
    ) -> dict[str, Any]:
        """Who are the biggest institutional (13F) holders of a stock? Resolves the ticker to its issuer CIK via SEC's company_tickers.json (a PRESENT-DAY mapping, explicitly labeled), then ranks 13F filers by the value they reported holding of that issuer at a quarter-end. The published aggregate keeps only a top-N slice of holders per issuer per quarter (see published_topn/effective_cut in the response), so this list is always TRUNCATED. period is a quarter-end date like 2026-03-31; omit it for the latest."""
        limit = max(1, min(limit, 200))
        norm_ticker = normalize_ticker(ticker)
        if norm_ticker is None:
            return _inst_env(
                results={"error": "ticker must be a symbol like 'AAPL';"
                         f" got {ticker!r}"}
            )
        if period is not None:
            period = _canon_date(period)
            if period is None:
                return _inst_env(
                    results={"error": "period must be an ISO quarter-end date"
                             " YYYY-MM-DD, e.g. 2026-03-31"}
                )
        if inst_conn is None:
            return _inst_env(results={"unavailable": _INST_ABSENT})
        if sec_client is None:
            return _inst_env(
                results={"error": "ticker resolution is unavailable: this server"
                         " was started without a SEC federated client"},
                live_source=_live_failure("(no federated client configured)"),
            )
        try:
            issuer = iq.resolve_ticker_to_issuer_key(sec_client, norm_ticker)
        except iq.InstDetailUnavailable as exc:
            return _inst_env(results={"error": str(exc)},
                             live_source=_live_failure(iq.COMPANY_TICKERS_URL))
        except SecCircuitOpenError as exc:
            return _inst_env(
                results={"error": f"SEC circuit breaker is open: {exc}"},
                live_source=_live_failure(iq.COMPANY_TICKERS_URL),
            )
        except SecUrlError as exc:
            return _inst_env(results={"error": f"refusing SEC fetch: {exc}"},
                             live_source=_live_failure(iq.COMPANY_TICKERS_URL))
        except Exception as exc:  # noqa: BLE001 — tool boundary
            return _inst_env(
                results={
                    "error": "live SEC ticker resolution failed"
                    f" ({type(exc).__name__}: {exc})"
                },
                live_source=_live_failure(iq.COMPANY_TICKERS_URL),
            )
        if issuer is None:
            return _inst_env(
                results={"ticker": norm_ticker, "holders": [], "hint": f"{norm_ticker}"
                         " did not resolve to an issuer CIK in SEC's"
                         " company_tickers.json"}
            )
        # The published aggregate stores only a top-N slice per issuer/period.
        # Returning it against a `limit` of up to 200 with no disclosure made a
        # publisher-chosen truncation look like the complete holder list.
        topn = iq.published_topn(inst_conn)
        holders = iq.issuer_top_holders(
            inst_conn, issuer_key=issuer["issuer_key"], period=period, limit=limit
        )
        # State the cut that ACTUALLY governed. "TRUNCATED regardless of
        # `limit`" is FALSE whenever limit < topn, and a caveat that contradicts
        # its own payload is worse than none.
        effective = limit if topn is None else min(limit, topn)
        governed_by = (
            "the `limit` you passed" if topn is None or limit < topn
            else "the publisher's top-N cut"
        )
        was_cut = len(holders) >= effective
        truncation = {
            "published_topn": topn,
            "requested_limit": limit,
            "effective_cut": effective,
            "returned": len(holders),
            # Only claim truncation when the payload actually hit the cut — a
            # 2-row answer declared "TRUNCATED at 25" contradicted itself, the
            # same class as the note this replaced (F-N8).
            "truncated": was_cut,
            "cut_governed_by": governed_by if was_cut else None,
            "holders_are_top_n": was_cut,
            "truncation_note": (
                f"This list is TRUNCATED at {effective} holders, governed by"
                f" {governed_by}. The published aggregate keeps only the top"
                f" {topn} holders per issuer per quarter"
                if topn is not None
                else f"This list is TRUNCATED at {effective} holders, governed"
                " by the `limit` you passed. The published aggregate also keeps"
                " only a top-N slice per issuer per quarter whose N is not"
                " recorded in this build"
            ) + "; other institutions may hold this issuer without appearing here."
            if was_cut
            else f"All {len(holders)} holders on record for this issuer and"
            f" period are returned (below the {effective}-row cut), though the"
            " published aggregate keeps only a top-N slice per issuer per"
            " quarter, so a holder outside that slice would not appear.",
        }
        if not holders:
            return _inst_env(
                results={"ticker": norm_ticker, "issuer": issuer, "holders": [],
                         **truncation,
                         "hint": f"no institutional holders of issuer CIK"
                         f" {issuer['cik']} in the aggregate for that period; it"
                         " may not be a 13(f) security, or may be keyed"
                         " differently"},
                extra_note="Ticker→issuer resolved via SEC's PRESENT-DAY"
                " company_tickers.json (G14).",
            )
        wm = inst_watermarks or {}
        return _inst_env(
            results={
                "ticker": norm_ticker,
                "issuer": issuer,
                "period_of_report": holders[0]["period_of_report"],
                **truncation,
                # The aggregate rolls up many filings, so there is no single
                # per-row filed date; the honest filing-level date is the build's
                # watermark — the latest filed date any row can reflect (G4).
                "filed_through": wm.get("latest_filed_date"),
                "provenance": "published-snapshot aggregate (agg_issuer_top_holders)"
                " built from SEC EDGAR 13F filings; ranks and values are the"
                " managers' own stated quarter-end values, normalized to USD"
                " across the 2023-01-03 unit-basis change",
                "holders": holders,
            },
            extra_note="Ticker→issuer is resolved with SEC's PRESENT-DAY"
            " company_tickers.json; issuer identity is by permanent CIK, so a"
            " ticker CHANGE still resolves, but a rare ticker REASSIGNMENT to a"
            " different issuer is the labeled caveat (G14).",
        )

    @mcp.tool()
    def inst_biggest_moves(
        period: str | None = None, side: str = "new", limit: int = 50
    ) -> dict[str, Any]:
        """The largest cross-filer 13F position changes in a quarter. side ∈ {new, add, trim, exit, unclassified}, ranked by the absolute dollar change, truncated at limit. 'unclassified' is a real change whose direction could not be determined because a value was undisclosed on one side; those rows appear under no other side. 'new'/'exit' mean a position was present or absent between two filings — not bought or sold. Positions with no usable identity key are excluded from the ranking entirely. Reads the published aggregate; period is a quarter-end date like 2026-03-31 (omit for the latest)."""
        limit = max(1, min(limit, 200))
        if side not in ("new", "add", "trim", "exit", "unclassified"):
            return _inst_env(
                results={"error": "side must be one of 'new', 'add', 'trim',"
                         f" 'exit', 'unclassified'; got {side!r}"}
            )
        if period is not None:
            period = _canon_date(period)
            if period is None:
                return _inst_env(
                    results={"error": "period must be an ISO quarter-end date"
                             " YYYY-MM-DD, e.g. 2026-03-31"}
                )
        if inst_conn is None:
            return _inst_env(results={"unavailable": _INST_ABSENT})
        result = iq.biggest_moves(inst_conn, period=period, side=side, limit=limit)
        return _inst_env(
            results={**_filed_through(), **result},
            extra_note="Ranked by absolute quarter-over-quarter dollar change"
            " (delta_value_usd) — a FLOW between two quarter-end snapshots, not a"
            " holdings statement (G10). " + _FLOW_CAVEAT,
        )

    @mcp.tool()
    def inst_health() -> dict[str, Any]:
        """How fresh and complete is the institutional (13F) data? Module presence, snapshot build, freshness (latest report period + latest filed date), filer/position counts, issuer-keying mix, and the standing caveats."""
        if inst_conn is None:
            return _inst_env(
                results={
                    "module": "inst",
                    "present": False,
                    "reason": _INST_ABSENT,
                    # The ABSENT state carried no caveats here while
                    # populus_health's did, so the two health tools disagreed
                    # about the same state.
                    "caveats": inst_health_caveats(
                        False, absent=True,
                        gate_withheld=inst_absent_gate_withheld,
                    ),
                }
            )
        stats = iq.filer_registry_stats(inst_conn)
        watermarks = inst_watermarks or {}
        return _inst_env(
            results={
                "module": "inst",
                "present": True,
                "snapshot_build": inst_build_id,
                # Both dates (G4): latest report period (from the aggregate, with
                # the manifest watermark preferred) and the latest filed date
                # (manifest watermark only — the aggregate carries no per-row
                # filed_date, so this is null when no manifest is available).
                "freshness": {
                    "latest_period_of_report": watermarks.get(
                        "latest_period_of_report"
                    )
                    or stats["latest_period"],
                    "latest_filed_date": watermarks.get("latest_filed_date"),
                },
                # NIT-7: these are ALL-PERIOD totals sitting directly beneath a
                # single-quarter freshness stamp — `positions` is every retained
                # position, not that quarter's, and `filers` is all-time filers.
                # `shape_filer` was renamed to `all_periods_*` for exactly this
                # misreading; the sibling surface kept the bare names.
                "counts": stats["counts"],
                "counts_basis": "ALL retained periods in this build, NOT the"
                " single quarter named in `freshness` — an all-time filer and"
                " position census, not a quarterly one",
                "issuer_keying": stats["issuer_keying"],
                # Which side of the M2-CONTRACT §3.1 boundary this server can
                # actually serve. Two DIFFERENT artifacts back this module, and
                # the aggregate being present says nothing about whether the
                # per-filer projection is — an operator debugging "why is
                # everything going live?" needs that fact stated, not inferred.
                "per_filer_detail": {
                    "published": serving_conn is not None,
                    "artifact": "inst_serving.db",
                    **({} if serving_conn is not None
                       else {"reason": serving_absent or _SERVING_ABSENT_DEFAULT}),
                    "boundary": "M2-CONTRACT §3.1 — published (cik, period) pairs"
                    " are served from this artifact; only periods newer than the"
                    " build and filers/periods outside the published universe go"
                    " live to SEC EDGAR",
                },
                "caveats": inst_health_caveats(
                    inst_from_published_manifest,
                    stale_withdrawal_pending=inst_stale_withdrawal_pending,
                ),
                "provenance": (
                    "published-snapshot"
                    if inst_from_published_manifest
                    else "unverified-local-db"
                ),
                "stale_withdrawal_pending": inst_stale_withdrawal_pending,
            }
        )
