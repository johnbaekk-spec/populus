"""``populus-mcp`` — the stdio FastMCP server (§9.9, §11).

Read-only over a published snapshot. Six analyst-question tools plus
``populus_health``; every response uses the honesty envelope (§11.3).
"""

from __future__ import annotations

import argparse
import os
import statistics
from collections import Counter
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Callable

from mcp.server.fastmcp import FastMCP

from populus.mcp_server import envelope as env
from populus.mcp_server import queries as q

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


def build_server(
    *, db_path: str, build_id: str | None, now: Callable[[], datetime] = _utc_now
) -> FastMCP:
    """Construct the FastMCP app bound to one read-only snapshot DB."""
    mcp = FastMCP("populus")
    conn = q.connect(db_path)

    def as_of() -> str:
        return now().isoformat()

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

    @mcp.tool()
    def populus_health() -> dict[str, Any]:
        """Platform-level health: which data modules are loaded, the snapshot build, and freshness."""
        return env.envelope(
            build_id=build_id, as_of=as_of(),
            results={"modules": ["congress"], "snapshot_build": build_id,
                     "transport": "stdio", "read_only": True},
        )

    return mcp


def _resolve_snapshot() -> tuple[str, str | None]:
    """CLI/env → (db_path, build_id). ``--db`` is the dev bypass; otherwise the
    RUN-5 snapshot client resolves the current published build."""
    p = argparse.ArgumentParser(prog="populus-mcp")
    p.add_argument("--db", help="Read-only path to an ingested populus DB (dev bypass).")
    p.add_argument("--data-repo", default=os.environ.get("POPULUS_DATA_REPO", "../populus-data"),
                   help="Local populus-data working tree to resolve the snapshot from.")
    p.add_argument("--cache", default=os.environ.get("POPULUS_CACHE", str(Path.home() / ".cache" / "populus")))
    args = p.parse_args()
    if args.db:
        return args.db, None
    # Resolve via the published snapshot (staging: local data-repo).
    from populus.client.snapshot import LocalRepoFetcher, SnapshotClient
    client = SnapshotClient(args.cache, LocalRepoFetcher(args.data_repo), now=_utc_now)
    client.refresh()
    db = client.db_path()
    if db is None:
        raise SystemExit(
            "no current snapshot; run `populus build && populus publish` or pass --db"
        )
    return str(db), client.current_build()


def main() -> None:
    db_path, build_id = _resolve_snapshot()
    build_server(db_path=db_path, build_id=build_id).run()


if __name__ == "__main__":
    main()
