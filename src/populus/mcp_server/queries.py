"""Read-only SQL for the MCP tools (§9.9).

All transaction reads go through ``v_default_transactions`` (§9.5 — excludes
superseded originals and only the later filing of an unresolved amendment
pair), joined to ``filings`` for ``doc_url`` and ``members`` for identity.
Parameterized throughout; the server is read-only.
"""

from __future__ import annotations

import sqlite3
from typing import Any

# Canonical projection joined for every transaction-returning tool.
_BASE = """
FROM v_default_transactions t
JOIN filings f ON t.filing_id = f.filing_id
LEFT JOIN members m ON t.bioguide_id = m.bioguide_id
"""

_SELECT = (
    "SELECT t.txn_id, t.bioguide_id, t.chamber, t.owner, t.ticker, t.asset_name,"
    " t.asset_type, t.side, t.transaction_date, t.filed_date, t.days_to_file,"
    " t.is_late, t.amount_low, t.amount_high, t.amount_label,"
    " t.cap_gains_over_200, t.comment, t.flags, t.source, f.doc_url,"
    " m.full_name, m.party, m.state "
    + _BASE
)


def connect(db_path: str) -> sqlite3.Connection:
    conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


def _rows(cur: sqlite3.Cursor) -> list[dict[str, Any]]:
    return [dict(r) for r in cur.fetchall()]


# Amounts are ranges; ORDER BY uses the upper bound (amount_high) explicitly and
# labels it as such at the call site (G5) — never a synthesized point value.
# Plain `amount_high >= X` / `ORDER BY amount_high` mishandle NULL upper bounds,
# so both are routed through the predicates below.
#
# amount_high=NULL is THREE distinct states in normalize.py:
#   (1) genuine open-ended top range ("Over $50,000,000"; spouse ">$1,000,000"
#       cap, App. B) — amount_low SET, an unbounded [amount_low, ∞) range;
#   (2) missing amount — amount_low ALSO NULL (no information);
#   (3) unparseable label — amount_low NULL + amount_unparsed flag.
# Only (1) is "unbounded / biggest"; (2)/(3) are "unknown". `amount_low IS NOT
# NULL` is the distinguishing signal — conflating them would rank an
# unknown-amount row above a real $50M trade and admit it to min_amount filters.
_OPEN_ENDED = "(t.amount_high IS NULL AND t.amount_low IS NOT NULL)"
# Reaches at least X: bounded upper ≥ X, OR genuinely open-ended. An unknown
# amount (both bounds NULL) is NOT known to reach X, so it does not match.
_MIN_AMOUNT = f"(t.amount_high >= ? OR {_OPEN_ENDED})"
# Rank "biggest": genuine open-ended first, then finite upper-bound desc, then
# unknown-amount rows (both NULL) last.
_BIGGEST_ORDER = f"{_OPEN_ENDED} DESC, t.amount_high DESC"


def recent_trades(
    conn: sqlite3.Connection,
    *,
    since: str,
    chamber: str | None,
    party: str | None,
    state: str | None,
    side: str | None,
    ticker: str | None,
    bioguide_id: str | None,
    min_amount: int | None,
    limit: int,
    offset: int,
) -> tuple[list[dict[str, Any]], bool]:
    where = ["t.filed_date >= ?"]
    args: list[Any] = [since]
    if chamber:
        where.append("t.chamber = ?"); args.append(chamber)
    if party:
        where.append("m.party = ?"); args.append(party)
    if state:
        where.append("t.chamber = t.chamber AND m.state = ?"); args.append(state)
    if side:
        where.append("t.side = ?"); args.append(side)
    if ticker:
        where.append("t.ticker = ?"); args.append(ticker.upper())
    if bioguide_id:
        where.append("t.bioguide_id = ?"); args.append(bioguide_id)
    if min_amount is not None:
        # "amount range reaches at least X" = the range's upper bound ≥ X.
        where.append(_MIN_AMOUNT); args.append(min_amount)
    sql = (
        _SELECT
        + " WHERE " + " AND ".join(where)
        + " ORDER BY t.filed_date DESC, t.transaction_date DESC, t.txn_id ASC"
        + " LIMIT ? OFFSET ?"
    )
    # Fetch one extra to know whether another page exists.
    cur = conn.execute(sql, (*args, limit + 1, offset))
    rows = _rows(cur)
    has_more = len(rows) > limit
    return rows[:limit], has_more


def member_lookup(
    conn: sqlite3.Connection, *, query: str, limit: int
) -> list[dict[str, Any]]:
    like = f"%{query.strip()}%"
    cur = conn.execute(
        "SELECT bioguide_id, full_name, chamber, party, state, district"
        " FROM members WHERE full_name LIKE ? COLLATE NOCASE"
        " ORDER BY full_name ASC LIMIT ?",
        (like, limit),
    )
    return _rows(cur)


def member_exists(conn: sqlite3.Connection, bioguide_id: str) -> dict[str, Any] | None:
    cur = conn.execute(
        "SELECT bioguide_id, full_name, chamber, party, state, district"
        " FROM members WHERE bioguide_id = ?",
        (bioguide_id,),
    )
    row = cur.fetchone()
    return dict(row) if row else None


def member_activity(
    conn: sqlite3.Connection, *, bioguide_id: str, since: str | None, until: str | None
) -> list[dict[str, Any]]:
    where = ["t.bioguide_id = ?"]
    args: list[Any] = [bioguide_id]
    if since:
        where.append("t.filed_date >= ?"); args.append(since)
    if until:
        where.append("t.filed_date <= ?"); args.append(until)
    sql = (
        _SELECT + " WHERE " + " AND ".join(where)
        + " ORDER BY t.filed_date DESC, t.txn_id ASC"
    )
    return _rows(conn.execute(sql, tuple(args)))


def ticker_detail(
    conn: sqlite3.Connection, *, ticker: str, since: str, limit: int
) -> list[dict[str, Any]]:
    sql = (
        _SELECT + " WHERE t.ticker = ? AND t.filed_date >= ?"
        " ORDER BY t.filed_date DESC, t.txn_id ASC LIMIT ?"
    )
    return _rows(conn.execute(sql, (ticker.upper(), since, limit)))


def top_tickers(
    conn: sqlite3.Connection, *, since: str, side: str | None, limit: int
) -> list[dict[str, Any]]:
    where = ["t.filed_date >= ?", "t.ticker IS NOT NULL"]
    args: list[Any] = [since]
    if side:
        where.append("t.side = ?"); args.append(side)
    sql = (
        "SELECT t.ticker, COUNT(*) AS trade_count,"
        " COUNT(DISTINCT t.bioguide_id) AS member_count,"
        " SUM(CASE WHEN t.side='purchase' THEN 1 ELSE 0 END) AS purchases,"
        " SUM(CASE WHEN t.side LIKE 'sale%' THEN 1 ELSE 0 END) AS sales,"
        " MIN(t.amount_low) AS min_amount_low, MAX(t.amount_high) AS max_amount_high,"
        " MAX(t.amount_high IS NULL AND t.amount_low IS NOT NULL) AS has_open_ended_range"
        " FROM v_default_transactions t WHERE " + " AND ".join(where)
        + " GROUP BY t.ticker ORDER BY trade_count DESC, t.ticker ASC LIMIT ?"
    )
    return _rows(conn.execute(sql, (*args, limit)))


def biggest_trades(
    conn: sqlite3.Connection, *, since: str, side: str | None, limit: int
) -> list[dict[str, Any]]:
    where = ["t.filed_date >= ?"]
    args: list[Any] = [since]
    if side:
        where.append("t.side = ?"); args.append(side)
    # "Biggest" ranked by the disclosed range's upper bound (stated as such).
    sql = (
        _SELECT + " WHERE " + " AND ".join(where)
        + f" ORDER BY {_BIGGEST_ORDER}, t.filed_date DESC, t.txn_id ASC LIMIT ?"
    )
    return _rows(conn.execute(sql, (*args, limit)))


def ticker_party_breakdown(
    conn: sqlite3.Connection, *, ticker: str, since: str
) -> list[dict[str, Any]]:
    sql = (
        "SELECT m.party, t.side, COUNT(*) AS n"
        " FROM v_default_transactions t"
        " LEFT JOIN members m ON t.bioguide_id = m.bioguide_id"
        " WHERE t.ticker = ? AND t.filed_date >= ?"
        " GROUP BY m.party, t.side ORDER BY n DESC"
    )
    return _rows(conn.execute(sql, (ticker.upper(), since)))


def normalize_utc_instant(since_iso: str) -> str:
    """Parse an ISO-8601 timestamp (any offset) and re-render it as a canonical
    UTC isoformat string. ``ingested_at`` is stored as `datetime.now(utc)
    .isoformat()` (`…+00:00`), so a UTC-normalized isoformat compares correctly
    lexicographically; a raw client offset like `-07:00` does NOT (it sorts
    against the digits, not the instant). Raises ValueError on unparseable input.
    """
    from datetime import datetime, timezone

    text = since_iso.strip()
    if text.endswith("Z") or text.endswith("z"):
        text = text[:-1] + "+00:00"
    dt = datetime.fromisoformat(text)  # raises ValueError if malformed
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc).isoformat()


def latest_filings(
    conn: sqlite3.Connection, *, since_iso: str, limit: int
) -> list[dict[str, Any]]:
    # Filing-level awareness incl. needs_ocr + amendment-flagged filings (§9.9).
    # since_iso is normalized to a canonical UTC instant so offset spellings
    # (e.g. -07:00) compare correctly against the stored UTC timestamps.
    since_utc = normalize_utc_instant(since_iso)
    sql = (
        "SELECT f.filing_id, f.chamber, f.filer_name_raw, f.filing_kind,"
        " f.filed_date, f.doc_url, f.parse_status, f.lifecycle, f.source,"
        " m.full_name, m.party, m.state"
        " FROM filings f LEFT JOIN members m ON f.bioguide_id = m.bioguide_id"
        " WHERE f.ingested_at >= ? ORDER BY f.filed_date DESC, f.filing_id ASC"
        " LIMIT ?"
    )
    return _rows(conn.execute(sql, (since_utc, limit)))


def member_flow_summary(
    conn: sqlite3.Connection, *, bioguide_id: str
) -> list[dict[str, Any]]:
    # Net disclosed flow by ticker — labeled a flow estimate, NOT holdings (G10).
    sql = (
        "SELECT t.ticker, COUNT(*) AS trades,"
        " SUM(CASE WHEN t.side='purchase' THEN 1 ELSE 0 END) AS purchases,"
        " SUM(CASE WHEN t.side LIKE 'sale%' THEN 1 ELSE 0 END) AS sales,"
        " MIN(t.amount_low) AS min_amount_low, MAX(t.amount_high) AS max_amount_high,"
        " MAX(t.amount_high IS NULL AND t.amount_low IS NOT NULL) AS has_open_ended_range"
        " FROM v_default_transactions t"
        " WHERE t.bioguide_id = ? AND t.ticker IS NOT NULL"
        " GROUP BY t.ticker ORDER BY trades DESC, t.ticker ASC"
    )
    return _rows(conn.execute(sql, (bioguide_id,)))
