"""``populus-mcp`` — the stdio FastMCP server (§9.9, §11).

Read-only over a published snapshot. Congress analyst tools plus the M2
institutional (13F) tools, plus ``populus_health``; every response uses the
honesty envelope (§11.3). The congress tools read the published ``congress.db``;
the inst snapshot tools read the published ``inst_agg.db`` (and degrade honestly
when the inst module is absent), while ``inst_filer_holdings(mode='detail')`` and
``inst_ticker_holders`` federate to SEC EDGAR live at question time (§11.4).
"""

from __future__ import annotations

import argparse

from populus.publish.attestation import PROVIDER_CHOICES
import os
import statistics
import sys
from collections import Counter
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Callable

from mcp.server.fastmcp import FastMCP

from populus.identity.registry import normalize_cik, normalize_ticker
from populus.mcp_server import envelope as env
from populus.mcp_server import inst_queries as iq
from populus.mcp_server import queries as q
from populus.net.sec_client import SecCircuitOpenError, SecClient, SecUrlError
from populus.normalize_inst import INST_DATA_NOTE

_ISO = "%Y-%m-%d"


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _window_start(now: datetime, window_days: int) -> str:
    return (now - timedelta(days=window_days)).strftime(_ISO)


def _valid_date(s: str) -> bool:
    try:
        datetime.strptime(s, _ISO)
        return True
    except ValueError:
        return False


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


def _habit_summary(rows: list[dict[str, Any]]) -> dict[str, Any]:
    if not rows:
        return {
            "trade_count": 0, "top_tickers": [], "side_mix": {},
            "median_days_to_file": None, "late_count": 0,
        }
    tickers = Counter(r["ticker"] for r in rows if r.get("ticker"))
    sides = Counter(r["side"] for r in rows)
    dtf = [r["days_to_file"] for r in rows if r.get("days_to_file") is not None]
    return {
        "trade_count": len(rows),
        "top_tickers": [{"ticker": t, "count": n} for t, n in tickers.most_common(10)],
        "side_mix": dict(sides),
        "median_days_to_file": (statistics.median(dtf) if dtf else None),
        "late_count": sum(1 for r in rows if r.get("is_late")),
    }


#: What `new`/`exit` actually mean. They are trading verbs applied to a SET
#: DIFFERENCE, and `inst_biggest_moves(side='exit')` is exactly the query an
#: analyst will ask (QA-VERIFY5-B3).
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


def _inst_health_caveats(
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
    FABRICATE an assurance about unpublished data (QA-F6, LD4).
    """
    caveats = [
        "Holdings are quarter-end snapshots of long 13(f) positions, not"
        " current or full portfolios (G10).",
    ]
    if stale_withdrawal_pending:
        # A verified manifest OMITTED this module, but the withdrawal could not
        # be committed, so these bytes are still being served. They did pass the
        # gate when published — but they are NOT what the current build
        # publishes, and saying nothing would present them as clean current data
        # (QA-NIT-3; the signal was computed but never reached the server, which
        # is QA-VERIFY-BLOCKER-2).
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
        # the gate withheld it (QA-r2-F3).
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


def build_server(
    *,
    db_path: str,
    build_id: str | None,
    now: Callable[[], datetime] = _utc_now,
    inst_db_path: str | None = None,
    inst_build_id: str | None = None,
    inst_watermarks: dict[str, Any] | None = None,
    inst_from_published_manifest: bool = False,
    inst_absent_reason: str | None = None,
    inst_absent_gate_withheld: bool = False,
    inst_stale_withdrawal_pending: bool = False,
    sec_client: SecClient | None = None,
) -> FastMCP:
    """Construct the FastMCP app bound to the read-only snapshot(s).

    ``db_path`` is the required congress snapshot. ``inst_db_path`` is the
    optional institutional aggregate (``inst_agg.db``); when it is ``None`` the
    inst module is legitimately absent from the published snapshot and every inst
    snapshot tool degrades honestly (never crashes, never fabricates a
    withholding reason). ``sec_client`` is the injectable federated client used
    by ``inst_filer_holdings(mode='detail')`` and ``inst_ticker_holders``; a test
    injects a fake transport so no live network is ever reached.

    ``inst_from_published_manifest`` records whether the institutional DB was
    resolved through a VERIFIED published manifest. A ``--inst-db`` bypass points
    at an arbitrary local file that never passed the M2-3 publish gate, so no
    coverage guarantee may be asserted for it (QA-F6).
    """
    mcp = FastMCP("populus")
    conn = q.connect(db_path)
    inst_conn = q.connect(inst_db_path) if inst_db_path else None

    def as_of() -> str:
        return now().isoformat()

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
        # "these figures come from a PREVIOUS build" would be false
        # (QA-VERIFY4-N1), and it never passed through the --inst-db path either.
        if live_source is None:
            prefix = None
            if inst_stale_withdrawal_pending:
                prefix = (
                    "STALE: the current published snapshot no longer includes"
                    " this module, but the withdrawal could not be committed"
                    " locally, so these figures come from a PREVIOUS build."
                )
            elif inst_db_path is not None and not inst_from_published_manifest:
                # QA-VERIFY4-N3: health said "UNVERIFIED SOURCE … NO coverage
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
    # a failed refresh would report a decision that never happened (QA-r2-F3).
    def _qoq_absence_hint(
        cik: str, requested: str | None, result: dict[str, Any]
    ) -> dict[str, Any]:
        """Distinguish "no data" from "no change" (QA-VERIFY5-N6).

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
        """The denominator the delta set was computed against (QA-VERIFY5-B3)."""
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
        """The filing-level date for AGGREGATE responses (G4 / QA-VERIFY-N-i).

        The aggregate rolls up many filings and carries no per-row filed date,
        so the honest disclosure is the build's watermark — the latest filed
        date any row can reflect. `inst_ticker_holders` already did this; the
        snapshot/qoq/biggest-moves paths asserted "both dates on every record"
        in the failure-mode sweep while carrying only the period.
        """
        return {"filed_through": (inst_watermarks or {}).get("latest_filed_date")}

    def _live_failure(url_hint: str) -> dict[str, Any]:
        """The provenance stamp for a FAILED federated read (QA-r4-F5).

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

    @mcp.tool()
    def congress_recent_trades(
        window_days: int = 30,
        chamber: str | None = None,
        party: str | None = None,
        state: str | None = None,
        side: str | None = None,
        ticker: str | None = None,
        bioguide_id: str | None = None,
        min_amount: int | None = None,
        limit: int = 50,
        cursor: str | None = None,
    ) -> dict[str, Any]:
        """What has Congress traded recently? Filter by chamber, party, state, side, ticker, member, or minimum disclosed amount."""
        limit = max(1, min(limit, 200))
        try:
            offset = env.decode_cursor(cursor)
        except ValueError:
            return env.envelope(
                build_id=build_id, as_of=as_of(),
                results={"error": "invalid cursor; omit it to start from the newest trades"},
            )
        since = _window_start(now(), max(1, window_days))
        rows, has_more = q.recent_trades(
            conn, since=since, chamber=chamber, party=party, state=state,
            side=side, ticker=ticker, bioguide_id=bioguide_id,
            min_amount=min_amount, limit=limit, offset=offset,
        )
        results = [env.shape_transaction(r) for r in rows]
        nxt = env.encode_cursor(offset + limit) if has_more else None
        return env.envelope(
            build_id=build_id, as_of=as_of(), results=results, next_cursor=nxt,
            extra_note=f"Window: trades filed in the last {window_days} days.",
        )

    @mcp.tool()
    def congress_member_lookup(query: str, limit: int = 25) -> dict[str, Any]:
        """Who is this member? Resolve a name (or fragment) to canonical members with bioguide IDs for use in other tools."""
        limit = max(1, min(limit, 100))
        if not query or not query.strip():
            return env.envelope(
                build_id=build_id, as_of=as_of(),
                results={"error": "provide a name or fragment, e.g. 'Pelosi'"},
            )
        rows = q.member_lookup(conn, query=query, limit=limit)
        if not rows:
            return env.envelope(
                build_id=build_id, as_of=as_of(),
                results={"matches": [], "hint": f"no member matches {query!r}; try a surname"},
            )
        return env.envelope(build_id=build_id, as_of=as_of(), results={"matches": rows})

    @mcp.tool()
    def congress_member_activity(
        bioguide_id: str, since: str | None = None, until: str | None = None
    ) -> dict[str, Any]:
        """Show a member's trading history and habits (top tickers, buy/sell mix, median days-to-file, late-filing count). Use congress_member_lookup to get the bioguide_id."""
        if not q.member_exists(conn, bioguide_id):
            return env.envelope(
                build_id=build_id, as_of=as_of(),
                results={"error": f"unknown bioguide_id {bioguide_id!r}; use congress_member_lookup first"},
            )
        for label, val in (("since", since), ("until", until)):
            if val and not _valid_date(val):
                return env.envelope(
                    build_id=build_id, as_of=as_of(),
                    results={"error": f"{label} must be ISO date YYYY-MM-DD"},
                )
        rows = q.member_activity(conn, bioguide_id=bioguide_id, since=since, until=until)
        member = q.member_exists(conn, bioguide_id)
        return env.envelope(
            build_id=build_id, as_of=as_of(),
            results={
                "member": member,
                "summary": _habit_summary(rows),
                "trades": [env.shape_transaction(r) for r in rows],
            },
        )

    @mcp.tool()
    def congress_ticker_activity(
        ticker: str, window_days: int = 90, mode: str = "detail", limit: int = 50
    ) -> dict[str, Any]:
        """Who in Congress is trading a ticker (mode='detail'), the most-traded tickers (mode='top'), or the biggest disclosed trades (mode='biggest')? Amounts are statutory ranges; 'biggest' ranks by the range's upper bound."""
        limit = max(1, min(limit, 200))
        since = _window_start(now(), max(1, window_days))
        if mode == "top":
            rows = q.top_tickers(conn, since=since, side=None, limit=limit)
            return env.envelope(
                build_id=build_id, as_of=as_of(),
                results={"mode": "top", "tickers": rows},
                extra_note="Ranked by trade count in the window.",
            )
        if mode == "biggest":
            rows = q.biggest_trades(conn, since=since, side=None, limit=limit)
            return env.envelope(
                build_id=build_id, as_of=as_of(),
                results={"mode": "biggest", "trades": [env.shape_transaction(r) for r in rows]},
                extra_note="Ranked by the disclosed amount range's UPPER bound (amount_high), not an exact value.",
            )
        if not ticker or not ticker.strip():
            return env.envelope(
                build_id=build_id, as_of=as_of(),
                results={"error": "detail mode needs a ticker, e.g. 'NVDA'"},
            )
        rows = q.ticker_detail(conn, ticker=ticker, since=since, limit=limit)
        breakdown = q.ticker_party_breakdown(conn, ticker=ticker, since=since)
        if not rows:
            return env.envelope(
                build_id=build_id, as_of=as_of(),
                results={"mode": "detail", "ticker": ticker.upper(), "trades": [],
                         "hint": f"no congressional trades of {ticker.upper()} in the last {window_days} days; try mode='top'"},
            )
        return env.envelope(
            build_id=build_id, as_of=as_of(),
            results={
                "mode": "detail", "ticker": ticker.upper(),
                "party_breakdown": breakdown,
                "trades": [env.shape_transaction(r) for r in rows],
            },
        )

    @mcp.tool()
    def congress_member_flows(bioguide_id: str) -> dict[str, Any]:
        """A member's net disclosed FLOW by ticker (purchases vs sales). These are flow estimates from disclosed transactions, NOT holdings — true holdings require annual FD reports (not yet ingested)."""
        if not q.member_exists(conn, bioguide_id):
            return env.envelope(
                build_id=build_id, as_of=as_of(),
                results={"error": f"unknown bioguide_id {bioguide_id!r}; use congress_member_lookup first"},
            )
        flows = q.member_flow_summary(conn, bioguide_id=bioguide_id)
        return env.envelope(
            build_id=build_id, as_of=as_of(),
            results={"member": q.member_exists(conn, bioguide_id), "flows_by_ticker": flows},
            extra_note="FLOW ESTIMATE from disclosed transactions, not a holdings/portfolio statement (G10).",
        )

    @mcp.tool()
    def congress_latest_filings(since_iso: str, limit: int = 100) -> dict[str, Any]:
        """What filings are new since a timestamp (ISO-8601, any offset)? Filing-level awareness for polling, including paper filings pending OCR and amendment-flagged filings."""
        limit = max(1, min(limit, 500))
        try:
            rows = q.latest_filings(conn, since_iso=since_iso, limit=limit)
        except ValueError:
            return env.envelope(
                build_id=build_id, as_of=as_of(),
                results={"error": f"since_iso must be an ISO-8601 timestamp"
                         f" (e.g. 2026-07-01T00:00:00Z); got {since_iso!r}"},
            )
        return env.envelope(build_id=build_id, as_of=as_of(), results={"filings": rows})

    @mcp.tool()
    def congress_health() -> dict[str, Any]:
        """How fresh and complete is the congressional data? Coverage, freshness, source mix, and the standing caveats."""
        row = dict(conn.execute(
            "SELECT (SELECT COUNT(*) FROM v_default_transactions) AS transactions,"
            " (SELECT COUNT(*) FROM filings) AS filings,"
            " (SELECT COUNT(*) FROM filings WHERE parse_status='needs_ocr') AS needs_ocr,"
            " (SELECT COUNT(*) FROM members) AS members,"
            " (SELECT MAX(filed_date) FROM v_default_transactions) AS latest_filed,"
            " (SELECT COUNT(*) FROM v_default_transactions WHERE bioguide_id IS NULL) AS unresolved_members"
        ).fetchone())
        src = {r["source"]: r["n"] for r in conn.execute(
            "SELECT source, COUNT(*) AS n FROM v_default_transactions GROUP BY source"
        )}
        return env.envelope(
            build_id=build_id, as_of=as_of(),
            results={"coverage": row, "source_mix": src, "module": "congress"},
        )

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
                # from not existing (QA-VERIFY5-B4).
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
        cik: str, period: str | None = None, mode: str = "snapshot"
    ) -> dict[str, Any]:
        """A 13F filer's holdings. mode='snapshot': the published aggregate profile (position count, total value, concentration) for a quarter-end period or the latest. mode='qoq': the filer's quarter-over-quarter position changes. mode='detail': the position list fetched LIVE from SEC EDGAR — quarter-end holdings with both dates and each position's value + unit_basis; check composition_complete, because an unparseable filing or an unread history shard can make it partial. Use inst_filer_lookup to get the CIK; period is a quarter-end date like 2026-03-31."""
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
        if mode == "detail":
            # Federated live fetch — available even when the inst module is
            # absent from the published snapshot.
            if sec_client is None:
                return _inst_env(
                    results={"error": "live detail is unavailable: this server"
                             " was started without a SEC federated client"},
                    # A federated CONFIGURATION failure is still a federated
                    # outcome; the snapshot-default envelope would stamp it with
                    # inst_build_id (QA-r5-F2).
                    live_source=_live_failure("(no federated client configured)"),
                )
            try:
                detail = iq.fetch_filer_detail(
                    sec_client, norm, period, ingested_at=as_of()
                )
            except iq.InstDetailUnavailable as exc:
                return _inst_env(results={"error": str(exc)},
                                 live_source=_live_failure("data.sec.gov/submissions"))
            except SecCircuitOpenError as exc:
                return _inst_env(
                    results={"error": f"SEC circuit breaker is open: {exc}"},
                    live_source=_live_failure("data.sec.gov/submissions"),
                )
            except SecUrlError as exc:
                return _inst_env(
                    results={"error": f"refusing SEC fetch: {exc}"},
                    live_source=_live_failure("data.sec.gov/submissions"),
                )
            except Exception as exc:  # noqa: BLE001 — tool boundary
                # A timeout, connection reset, decode error or malformed SEC
                # payload must become an HONEST envelope, never a raised
                # exception out of an MCP call (QA-F3). The message is
                # sanitized to the exception type + text, which carries no
                # credentials (the client sends none).
                return _inst_env(
                    results={
                        "error": "live SEC fetch failed"
                        f" ({type(exc).__name__}: {exc}); the published snapshot"
                        " modes (mode='snapshot'/'qoq') are unaffected"
                    },
                    live_source=_live_failure("data.sec.gov/submissions"),
                )
            # Each row is stamped with ITS OWN filing's date and document —
            # a composed period mixes a base and its amendment, and restamping
            # the base rows with the amendment's filed date would misreport when
            # those positions were disclosed (G4/QA-F2).
            holdings = [
                env.shape_holding(
                    h,
                    period_of_report=detail["period_of_report"],
                    filed_date=h.get("source_filed_date") or detail["filed_date"],
                    doc_url=h.get("source_doc_url") or detail["doc_url"],
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
                    # every amendment applied to it, in filed order (QA-F2).
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
        return _inst_env(
            results={"mode": "snapshot", "cik": norm, **_filed_through(), **profile}
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
        except Exception as exc:  # noqa: BLE001 — tool boundary (QA-F3)
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
        # publisher-chosen truncation look like the complete holder list
        # (QA-VERIFY4-B2).
        topn = iq.published_topn(inst_conn)
        holders = iq.issuer_top_holders(
            inst_conn, issuer_key=issuer["issuer_key"], period=period, limit=limit
        )
        # State the cut that ACTUALLY governed. "TRUNCATED regardless of
        # `limit`" is FALSE whenever limit < topn, and a caveat that contradicts
        # its own payload is worse than none (QA-VERIFY5-B5).
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
                    # about the same state (QA-VERIFY-N-h).
                    "caveats": _inst_health_caveats(
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
                "caveats": _inst_health_caveats(
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

    @mcp.tool()
    def populus_health() -> dict[str, Any]:
        """Platform-level health: which data modules are loaded, the snapshot build, and freshness."""
        # `modules` lists only the modules actually present, so the M1 contract
        # (congress-only ⇒ ["congress"]) holds; an additive per-module detail
        # block reports each module's build + freshness without changing the
        # existing keys (R10/LD6).
        modules = ["congress"]
        module_detail: dict[str, Any] = {
            "congress": {"present": True, "snapshot_build": build_id}
        }
        if inst_conn is not None:
            modules.append("inst")
            watermarks = inst_watermarks or {}
            # The inst detail carries the SAME caveats + provenance inst_health
            # reports (QA-F7): a caller that only asks the platform-level health
            # question must not receive a freshness claim stripped of the
            # quarter-end/lag caveat, nor a coverage assurance it has not earned.
            # Freshness falls back to the aggregate's own latest period when no
            # manifest watermark exists, so a --inst-db run is not silently null.
            module_detail["inst"] = {
                "present": True,
                "snapshot_build": inst_build_id,
                "latest_period_of_report": watermarks.get("latest_period_of_report")
                or iq.filer_registry_stats(inst_conn)["latest_period"],
                "latest_filed_date": watermarks.get("latest_filed_date"),
                "caveats": _inst_health_caveats(
                    inst_from_published_manifest,
                    stale_withdrawal_pending=inst_stale_withdrawal_pending,
                ),
                "provenance": (
                    "published-snapshot"
                    if inst_from_published_manifest
                    else "unverified-local-db"
                ),
                "stale_withdrawal_pending": inst_stale_withdrawal_pending,
                "data_note": INST_DATA_NOTE,
            }
        else:
            module_detail["inst"] = {
                "present": False,
                "reason": _INST_ABSENT,
                # Only the verified-omission state may be described as a gate
                # withholding; every other absence gets a neutral caveat that
                # asserts no gate decision (QA-r2-F3).
                "caveats": _inst_health_caveats(
                    False, absent=True, gate_withheld=inst_absent_gate_withheld
                ),
            }
        return env.envelope(
            build_id=build_id, as_of=as_of(),
            results={"modules": modules, "snapshot_build": build_id,
                     "transport": "stdio", "read_only": True,
                     "module_detail": module_detail},
        )

    return mcp


def _inst_watermarks(manifest: dict | None) -> dict[str, Any] | None:
    """The inst module's manifest watermarks (latest period + filed date), or
    ``None`` when the manifest is absent/shapeless."""
    if not isinstance(manifest, dict):
        return None
    module = manifest.get("modules", {}).get("inst")
    if not isinstance(module, dict):
        return None
    watermarks = module.get("watermarks")
    return watermarks if isinstance(watermarks, dict) else None


def _attestation_provider(args):
    """Build the provider the operator selected. Never guesses."""
    from populus.publish.attestation import build_provider

    return build_provider(args.attestation)


def _resolve_snapshot() -> dict[str, Any]:
    """CLI/env → the snapshot inputs for ``build_server``.

    ``--db`` / ``--inst-db`` are the per-module dev bypasses; otherwise the RUN-5
    snapshot client resolves the current published build for congress (required)
    and inst (optional — the inst module may legitimately be absent, in which
    case ``inst_db_path`` is ``None`` and the inst snapshot tools degrade
    honestly).
    """
    p = argparse.ArgumentParser(prog="populus-mcp")
    p.add_argument("--db", help="Read-only path to an ingested populus DB (dev bypass).")
    p.add_argument("--inst-db", help="Read-only path to an inst_agg.db (dev bypass,"
                   " mirrors --db for the institutional module).")
    p.add_argument("--data-repo", default=os.environ.get("POPULUS_DATA_REPO", "../populus-data"),
                   help="Local populus-data working tree to resolve the snapshot from.")
    p.add_argument("--cache", default=os.environ.get("POPULUS_CACHE", str(Path.home() / ".cache" / "populus")))
    # No default: an entry point that forgets to choose must fail loudly rather
    # than inherit a no-op verifier that answers "verified" to everything
    # (RUN P3-3a R14). The --db dev-bypass path never builds a SnapshotClient,
    # so it is exempt and documented as such.
    p.add_argument(
        "--attestation",
        choices=PROVIDER_CHOICES,
        help="Which attestation provider verifies the snapshot. Required unless "
             "--db is given (that path reads a local DB and verifies nothing).",
    )
    args = p.parse_args()
    if args.db is None and args.attestation is None:
        p.error("--attestation is required when resolving a published snapshot")
    resolved: dict[str, Any] = {
        "inst_db_path": args.inst_db,
        "inst_build_id": None,
        "inst_watermarks": None,
        "inst_from_published_manifest": False,
        # Why inst is absent, DECIDED HERE where the facts are (QA-r2-F3).
        # `populus_health` may only report what actually happened; it must not
        # assume the coverage gate withheld the module.
        "inst_absent_reason": None,
        "inst_absent_gate_withheld": False,
        "inst_stale_withdrawal_pending": False,
    }
    if args.inst_db is not None:
        resolved["inst_absent_reason"] = None  # present, but unverified
    if args.db:
        # Dev bypass: use only the explicitly-provided per-module paths; do not
        # touch the published snapshot (so `--db` alone leaves inst degrading
        # honestly while `mode='detail'` still federates).
        resolved["db_path"] = args.db
        resolved["build_id"] = None
        if args.inst_db is None:
            resolved["inst_absent_reason"] = (
                "this server was started with --db (a development bypass of the"
                " published snapshot) and no --inst-db, so no institutional"
                " database was loaded. NO coverage-gate decision was consulted."
            )
        return resolved
    # Resolve via the published snapshot (staging: local data-repo).
    from populus.client.snapshot import LocalRepoFetcher, SnapshotClient
    client = SnapshotClient(
        args.cache,
        LocalRepoFetcher(args.data_repo),
        now=_utc_now,
        attestation=_attestation_provider(args),
    )
    congress_outcome = client.refresh()
    db = client.db_path()
    if db is None:
        # Name the REAL cause. A disabled cache (e.g. no flock support) is not a
        # missing snapshot, and the generic advice would send an operator
        # chasing a publish problem they do not have.
        disabled = getattr(client, "_disabled_reason", None)
        if disabled:
            raise SystemExit(f"cannot use the snapshot cache: {disabled}")
        # Carry the client's own message: a corrupt congress anchor otherwise
        # exited with generic publish advice while the actionable remediation
        # was thrown away — the same gap QA-VERIFY-N-f closed for inst.
        detail = getattr(congress_outcome, "message", "") or ""
        raise SystemExit(
            "no current snapshot; run `populus build && populus publish` or"
            f" pass --db.{(' ' + detail) if detail else ''}"
        )
    resolved["db_path"] = str(db)
    resolved["build_id"] = client.current_build()
    if args.inst_db is None:
        # A module-level failure must NEVER take down the server (lifecycle
        # spec §7): any unexpected error resolving the OPTIONAL inst module
        # becomes an honest absence, not a traceback that kills congress and the
        # federated tools with it (QA-BLOCKER-2).
        try:
            _resolve_inst_module(args, resolved)
        except Exception as exc:  # noqa: BLE001 — module boundary
            resolved.update(
                inst_db_path=None,
                inst_build_id=None,
                inst_watermarks=None,
                inst_from_published_manifest=False,
                inst_absent_gate_withheld=False,
                inst_absent_reason=(
                    "the institutional module could not be resolved:"
                    f" {type(exc).__name__}: {exc}. This is a resolution"
                    " failure, NOT a statement about the coverage gate — no"
                    " gate decision was observed."
                ),
            )
    return resolved


def _resolve_inst_module(args, resolved: dict) -> None:
    """Resolve the optional inst module into *resolved*.

    Raises on failure; the caller turns that into an honest absence.
    """
    from populus.client.snapshot import LocalRepoFetcher, SnapshotClient

    # It may be absent (withheld this build); `refresh` then returns 'withdrawn'
    # with `verified_omission=True` and `db_path()` is None — a legitimate
    # absent-module signal, not an error (QA-r4-F6).
    inst_client = SnapshotClient(
        args.cache,
        LocalRepoFetcher(args.data_repo),
        now=_utc_now,
        module="inst",
        attestation=_attestation_provider(args),
    )
    outcome = inst_client.refresh()
    # `db_path()` alone decides serving — it routes through `serving_build()`,
    # the sole oracle. An earlier version also consulted `verified_omission`
    # here; that was a tombstone-era patch, is redundant now that a committed
    # withdrawal always leaves either a null record or an anchor/record
    # mismatch (both absent), and was itself the second-inference pattern this
    # rewrite deleted (lifecycle spec §4/§6, QA-NIT-1).
    inst_db = inst_client.db_path()
    if inst_db is None:
        # WHY it is absent still comes from the refresh result: only a VERIFIED
        # manifest omission may claim the coverage gate withheld it (QA-r3-F2).
        verified_omission = bool(getattr(outcome, "verified_omission", False))
        observed = verified_omission or bool(
            getattr(outcome, "observed_omission", False)
        )
        resolved["inst_absent_gate_withheld"] = verified_omission
        if verified_omission:
            resolved["inst_absent_reason"] = (
                "the current published snapshot's verified manifest does not"
                " include the institutional module: the M2-3 publish gate"
                " withheld it rather than publish data whose identity coverage"
                " is below 95% by value."
            )
        elif observed:
            # A verified manifest omission WAS read; it just could not be
            # committed. Saying "no gate decision was observed" here would be
            # the inverse of QA-r2-F3 — denying a decision we actually saw
            # (QA-VERIFY-N-g).
            resolved["inst_absent_reason"] = (
                "the current published snapshot's verified manifest does not"
                " include the institutional module, but the withdrawal could"
                " not be committed to the local cache. Nothing is served for it"
                f" regardless. {getattr(outcome, 'message', '')}"
            ).strip()
        else:
            resolved["inst_absent_reason"] = (
                "the institutional module could not be resolved from the"
                f" published snapshot (refresh outcome:"
                f" {getattr(outcome, 'status', outcome)!r}). This is a"
                " resolution failure, NOT a statement about the coverage gate —"
                " no gate decision was observed."
                # The client's own message carries actionable remediation (e.g.
                # "Clear <module dir> ..."); discarding it left an operator with
                # nothing to act on (QA-VERIFY-N-f).
                + (f" {outcome.message}" if getattr(outcome, "message", "") else "")
            )
        return
    resolved["inst_db_path"] = str(inst_db)
    resolved["inst_build_id"] = inst_client.current_build()
    resolved["inst_watermarks"] = _inst_watermarks(inst_client.current_manifest())
    # Resolved through the verified pointer→manifest chain, so the M2-3 publish
    # gate demonstrably held for these bytes (QA-F6).
    resolved["inst_from_published_manifest"] = True
    if getattr(outcome, "observed_omission", False):
        # A verified manifest OMITTED the module but the withdrawal could not be
        # committed, so these bytes — though genuinely published once — are no
        # longer what the current build publishes. Serving them conforms to §4
        # (nothing committed, prior state stands), but reporting them as clean
        # published data with no signal would hide it (QA-NIT-3).
        resolved["inst_stale_withdrawal_pending"] = True


def _build_sec_client() -> SecClient:
    """The live federated SEC client (real transport, wall clock)."""
    import time

    from populus.net.sec_client import HttpxSecTransport, sec_contact

    contact, _warning = sec_contact(warn=lambda msg: print(msg, file=sys.stderr))
    return SecClient(
        HttpxSecTransport(),
        contact=contact,
        sleep=time.sleep,
        monotonic=time.monotonic,
    )


def main() -> None:
    resolved = _resolve_snapshot()
    build_server(
        db_path=resolved["db_path"],
        build_id=resolved["build_id"],
        inst_db_path=resolved["inst_db_path"],
        inst_build_id=resolved["inst_build_id"],
        inst_watermarks=resolved["inst_watermarks"],
        # The round-1 F6 fix is INERT unless production forwards this; it was
        # dropped here, so every published snapshot was mislabeled
        # `unverified-local-db` while only direct test construction worked
        # (QA-r2-F2).
        inst_from_published_manifest=resolved["inst_from_published_manifest"],
        inst_absent_reason=resolved["inst_absent_reason"],
        inst_absent_gate_withheld=resolved["inst_absent_gate_withheld"],
        inst_stale_withdrawal_pending=resolved["inst_stale_withdrawal_pending"],
        sec_client=_build_sec_client(),
    ).run()


if __name__ == "__main__":
    main()
