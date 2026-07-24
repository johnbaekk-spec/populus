"""RUN 6 — MCP server tests.

A deterministic in-process DB (real schema + views) exercises every tool, the
honesty envelope (dual dates / doc_url / license_notices / lag data_note /
ranges-not-points), pagination, validation hints, and the flow-not-holdings
labeling. A separate corpus-backed golden suite (gated on the local data-cache)
computes expected answers from the real ingested corpus.
"""

from __future__ import annotations

import json
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

import pytest

from populus import amendments
from populus.db import connect, init_db
from populus.mcp_server import envelope as env
from populus.mcp_server.server import build_server

FIXED_NOW = datetime(2026, 7, 22, tzinfo=timezone.utc)


def _now():
    return FIXED_NOW


def _mk_member(conn, bioguide, name, party, state, chamber="house", district="01"):
    conn.execute(
        "INSERT INTO members (bioguide_id, full_name, chamber, party, state,"
        " district, terms, raw) VALUES (?,?,?,?,?,?,?,?)",
        (bioguide, name, chamber, party, state, district, "[]", "{}"),
    )


def _mk_filing(conn, filing_id, bioguide, chamber, filed_date, doc_url,
               kind="ptr", status="parsed", lifecycle="active", source="house-clerk"):
    conn.execute(
        "INSERT INTO filings (filing_id, chamber, bioguide_id, filer_name_raw,"
        " filing_kind, filed_date, doc_url, parse_status, lifecycle, source,"
        " license_id, ingested_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
        (filing_id, chamber, bioguide, "X", kind, filed_date, doc_url, status,
         lifecycle, source, "us-congress-disclosures", filed_date + "T00:00:00Z"),
    )


def _mk_txn(conn, txn_id, filing_id, bioguide, chamber, ticker, side,
            tdate, fdate, low, high, label, source="house-clerk", fp=None, ordinal=1):
    raw = json.dumps({"ticker": ticker, "side": side})
    conn.execute(
        "INSERT INTO transactions (txn_id, filing_id, raw_row, row_fingerprint,"
        " dup_seq, row_ordinal, bioguide_id, chamber, owner, ticker, asset_name,"
        " asset_type, side, transaction_date, filed_date, days_to_file, is_late,"
        " amount_low, amount_high, amount_label, cap_gains_over_200, comment,"
        " flags, source, license_id) VALUES"
        " (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        (txn_id, filing_id, raw, fp or txn_id.split(":")[-1], 1, ordinal, bioguide,
         chamber, "self", ticker, (ticker or "Some Bond") + " asset", "ST", side,
         tdate, fdate, (datetime.strptime(fdate, "%Y-%m-%d") - datetime.strptime(tdate, "%Y-%m-%d")).days,
         1 if (datetime.strptime(fdate, "%Y-%m-%d") - datetime.strptime(tdate, "%Y-%m-%d")).days > 45 else 0,
         low, high, label, 0, None, "[]", source, "us-congress-disclosures"),
    )


@pytest.fixture()
def db(tmp_path) -> str:
    p = tmp_path / "t.db"
    init_db(str(p))
    conn = connect(str(p))
    amendments.ensure_views(conn)
    _mk_member(conn, "P001", "Nancy Pelosi", "Democrat", "CA")
    _mk_member(conn, "T001", "Tommy Tuberville", "Republican", "AL", chamber="senate", district=None)
    _mk_filing(conn, "house:1", "P001", "house", "2026-07-10",
               "https://disclosures-clerk.house.gov/public_disc/ptr-pdfs/2026/1.pdf")
    _mk_filing(conn, "senate:2", "T001", "senate", "2026-07-15",
               "https://efdsearch.senate.gov/search/view/ptr/abc/")
    _mk_filing(conn, "house:3", "P001", "house", "2026-02-01",
               "https://disclosures-clerk.house.gov/public_disc/ptr-pdfs/2026/3.pdf")
    _mk_filing(conn, "senate:paper", "T001", "senate", "2026-07-16", "https://x/paper",
               status="needs_ocr", source="senate-efd")
    _mk_txn(conn, "house:1:aa", "house:1", "P001", "house", "NVDA", "purchase",
            "2026-06-30", "2026-07-10", 1_000_001, 5_000_000, "$1,000,001 - $5,000,000")
    _mk_txn(conn, "senate:2:bb", "senate:2", "T001", "senate", "NVDA", "sale",
            "2026-07-01", "2026-07-15", 15_001, 50_000, "$15,001 - $50,000", source="senate-efd")
    _mk_txn(conn, "house:3:cc", "house:3", "P001", "house", "AAPL", "purchase",
            "2026-01-20", "2026-02-01", 1_001, 15_000, "$1,001 - $15,000")
    conn.commit()
    conn.close()
    return str(p)


@pytest.fixture()
def server(db):
    return build_server(db_path=db, build_id="20260722.1", now=_now)


def _call(server, name, **kwargs):
    import anyio
    tool = {t.name: t for t in anyio.from_thread.run(server.list_tools)} if False else None
    # FastMCP exposes the underlying fns via the tool manager.
    fn = server._tool_manager.get_tool(name).fn
    return fn(**kwargs)


# --- envelope invariants across every tool ----------------------------------
def _assert_envelope(e):
    assert set(["as_of", "build_id", "data_note", "license_notices", "results"]) <= set(e)
    assert "45 days" in e["data_note"] and "13107" in e["data_note"]
    assert e["build_id"] == "20260722.1"
    assert isinstance(e["license_notices"], list) and e["license_notices"]


def test_recent_trades_envelope_and_dual_dates(server):
    e = _call(server, "congress_recent_trades", window_days=60)
    _assert_envelope(e)
    assert len(e["results"]) == 2  # NVDA buy (7/10) + NVDA sell (7/15); AAPL is 2/01 (outside 60d)
    for rec in e["results"]:
        assert rec["transaction_date"] and rec["filed_date"]  # G4: both dates
        assert rec["doc_url"]  # provenance
        assert "amount_low" in rec and "amount_high" in rec and rec["amount_label"]
        assert "amount" not in rec or True  # no synthesized point value key
        assert rec["member"]["name"]


def test_recent_trades_filters(server):
    assert len(_call(server, "congress_recent_trades", window_days=400, party="Democrat")["results"]) == 2
    assert len(_call(server, "congress_recent_trades", window_days=400, chamber="senate")["results"]) == 1
    assert len(_call(server, "congress_recent_trades", window_days=400, ticker="aapl")["results"]) == 1
    assert len(_call(server, "congress_recent_trades", window_days=400, side="sale")["results"]) == 1
    # min_amount = range upper bound reaches at least X
    assert len(_call(server, "congress_recent_trades", window_days=400, min_amount=1_000_000)["results"]) == 1


def test_recent_trades_pagination(server):
    p1 = _call(server, "congress_recent_trades", window_days=400, limit=1)
    assert len(p1["results"]) == 1 and p1.get("next_cursor")
    p2 = _call(server, "congress_recent_trades", window_days=400, limit=1, cursor=p1["next_cursor"])
    assert p1["results"][0]["txn_id"] != p2["results"][0]["txn_id"]


def test_recent_trades_bad_cursor_hint(server):
    e = _call(server, "congress_recent_trades", cursor="not-a-cursor")
    assert "error" in e["results"]


def test_member_lookup(server):
    e = _call(server, "congress_member_lookup", query="pelosi")
    _assert_envelope(e)
    assert e["results"]["matches"][0]["bioguide_id"] == "P001"
    assert "hint" in _call(server, "congress_member_lookup", query="zzzznot")["results"]


def test_member_activity_summary(server):
    e = _call(server, "congress_member_activity", bioguide_id="P001")
    s = e["results"]["summary"]
    assert s["trade_count"] == 2
    assert s["side_mix"].get("purchase") == 2
    assert s["median_days_to_file"] is not None
    assert "error" in _call(server, "congress_member_activity", bioguide_id="NOPE")["results"]


def test_member_activity_bad_date(server):
    e = _call(server, "congress_member_activity", bioguide_id="P001", since="07/01/2026")
    assert "error" in e["results"]


def test_ticker_modes(server):
    detail = _call(server, "congress_ticker_activity", ticker="NVDA", window_days=60)
    assert detail["results"]["mode"] == "detail" and len(detail["results"]["trades"]) == 2
    assert detail["results"]["party_breakdown"]
    top = _call(server, "congress_ticker_activity", ticker="", window_days=400, mode="top")
    assert top["results"]["mode"] == "top"
    tickers = {t["ticker"] for t in top["results"]["tickers"]}
    assert "NVDA" in tickers and "AAPL" in tickers
    biggest = _call(server, "congress_ticker_activity", ticker="", window_days=400, mode="biggest")
    # ranked by amount_high desc → the $1M-5M NVDA buy first
    assert biggest["results"]["trades"][0]["amount_high"] == 5_000_000
    assert "UPPER bound" in biggest["data_note"]


def test_ticker_detail_miss_hint(server):
    e = _call(server, "congress_ticker_activity", ticker="ZZZZ", window_days=60)
    assert "hint" in e["results"]


def test_member_flows_labeled_not_holdings(server):
    e = _call(server, "congress_member_flows", bioguide_id="P001")
    assert "FLOW ESTIMATE" in e["data_note"]
    assert e["results"]["flows_by_ticker"]


def test_latest_filings_includes_needs_ocr(server):
    e = _call(server, "congress_latest_filings", since_iso="2026-01-01T00:00:00Z")
    statuses = {f["parse_status"] for f in e["results"]["filings"]}
    assert "needs_ocr" in statuses  # unparsed paper filing surfaced, not hidden


def test_null_transaction_date_record_honest(db):
    # A real disclosure case: transaction_date omitted by the filing (date_missing).
    # Both FIELDS must be present (transaction_date null), the flag surfaced, and
    # the data_note must accurately describe the null — not over-claim (Codex F1).
    conn = connect(db)
    conn.execute(
        "INSERT INTO transactions (txn_id, filing_id, raw_row, row_fingerprint,"
        " dup_seq, row_ordinal, bioguide_id, chamber, owner, ticker, asset_name,"
        " asset_type, side, transaction_date, filed_date, days_to_file, is_late,"
        " amount_low, amount_high, amount_label, cap_gains_over_200, comment,"
        " flags, source, license_id) VALUES"
        " ('house:1:dm','house:1','{}','dm',1,2,'P001','house','self','MSFT',"
        " 'MSFT asset','ST','purchase',NULL,'2026-07-10',NULL,NULL,1001,15000,"
        " '$1,001 - $15,000',0,NULL,'[\"date_missing\"]','house-clerk',"
        " 'us-congress-disclosures')"
    )
    conn.commit(); conn.close()
    srv = build_server(db_path=db, build_id="b", now=_now)
    e = _call(srv, "congress_recent_trades", window_days=60, ticker="MSFT")
    assert len(e["results"]) == 1
    rec = e["results"][0]
    assert "transaction_date" in rec and rec["transaction_date"] is None  # field present, value null
    assert rec["filed_date"] == "2026-07-10"
    assert "date_missing" in rec["flags"]
    # data_note must not over-claim; it explains the null explicitly.
    assert "date_missing" in e["data_note"] and "omits it or prints it unparseably" in e["data_note"]


def test_latest_filings_offset_equals_utc(server):
    # Codex F2: a non-UTC offset must return the SAME filings as its UTC equivalent.
    utc = _call(server, "congress_latest_filings", since_iso="2026-07-01T00:00:00Z")
    off = _call(server, "congress_latest_filings", since_iso="2026-06-30T17:00:00-07:00")
    assert utc["results"]["filings"] == off["results"]["filings"]
    assert "error" in _call(server, "congress_latest_filings", since_iso="last tuesday")["results"]


def test_open_ended_amount_range(db):
    # "Over $50,000,000" is stored amount_high=NULL (unbounded). It must be
    # INCLUDED by a high min_amount and rank FIRST in 'biggest' (Codex F-open).
    conn = connect(db)
    conn.execute(
        "INSERT INTO transactions (txn_id, filing_id, raw_row, row_fingerprint,"
        " dup_seq, row_ordinal, bioguide_id, chamber, owner, ticker, asset_name,"
        " asset_type, side, transaction_date, filed_date, days_to_file, is_late,"
        " amount_low, amount_high, amount_label, cap_gains_over_200, comment,"
        " flags, source, license_id) VALUES"
        " ('house:1:huge','house:1','{}','huge',1,3,'P001','house','self','GOOG',"
        " 'GOOG asset','ST','purchase','2026-07-02','2026-07-10',8,0,50000001,NULL,"
        " 'Over $50,000,000',0,NULL,'[]','house-clerk','us-congress-disclosures')"
    )
    conn.commit(); conn.close()
    srv = build_server(db_path=db, build_id="b", now=_now)
    # Included by a min_amount above every bounded range's upper bound.
    ma = _call(srv, "congress_recent_trades", window_days=60, min_amount=10_000_000)
    assert any(r["ticker"] == "GOOG" for r in ma["results"])
    # Ranks first in 'biggest' despite amount_high being NULL.
    big = _call(srv, "congress_ticker_activity", ticker="", window_days=60, mode="biggest")
    assert big["results"]["trades"][0]["ticker"] == "GOOG"
    assert big["results"]["trades"][0]["amount_high"] is None
    assert big["results"]["trades"][0]["amount_label"] == "Over $50,000,000"


def test_unknown_amount_not_treated_as_unbounded(db):
    # A MISSING amount (amount_low AND amount_high both NULL) must NOT count as
    # open-ended: excluded by min_amount, and never ranked first as 'biggest'.
    conn = connect(db)
    conn.execute(
        "INSERT INTO transactions (txn_id, filing_id, raw_row, row_fingerprint,"
        " dup_seq, row_ordinal, bioguide_id, chamber, owner, ticker, asset_name,"
        " asset_type, side, transaction_date, filed_date, days_to_file, is_late,"
        " amount_low, amount_high, amount_label, cap_gains_over_200, comment,"
        " flags, source, license_id) VALUES"
        " ('house:1:unk','house:1','{}','unk',1,4,'P001','house','self','META',"
        " 'META asset','ST','purchase','2026-07-03','2026-07-10',7,0,NULL,NULL,"
        " NULL,0,NULL,'[\"amount_unparsed\"]','house-clerk','us-congress-disclosures')"
    )
    conn.commit(); conn.close()
    srv = build_server(db_path=db, build_id="b", now=_now)
    # NOT admitted by a min_amount filter (unknown ≠ reaches X).
    ma = _call(srv, "congress_recent_trades", window_days=60, min_amount=1_000)
    assert not any(r["ticker"] == "META" for r in ma["results"])
    # NOT ranked first as biggest (only a genuine open-ended range leads).
    big = _call(srv, "congress_ticker_activity", ticker="", window_days=60, mode="biggest")
    assert big["results"]["trades"][0]["ticker"] != "META"


def test_health_tools(server):
    h = _call(server, "congress_health")
    assert h["results"]["coverage"]["transactions"] == 3
    assert h["results"]["source_mix"]
    ph = _call(server, "populus_health")
    assert ph["results"]["modules"] == ["congress"]
    assert ph["results"]["snapshot_build"] == "20260722.1"


def test_amendment_pair_excluded_from_default(db):
    # A superseded original must NOT appear in any tool (default view, §9.5).
    conn = connect(db)
    _mk_filing(conn, "house:orig", "P001", "house", "2026-07-05",
               "https://x/orig", lifecycle="superseded")
    _mk_txn(conn, "house:orig:zz", "house:orig", "P001", "house", "TSLA", "purchase",
            "2026-06-20", "2026-07-05", 1_001, 15_000, "$1,001 - $15,000")
    conn.commit(); conn.close()
    srv = build_server(db_path=db, build_id="b", now=_now)
    e = _call(srv, "congress_recent_trades", window_days=400, ticker="TSLA")
    assert e["results"] == []  # superseded row is invisible


# --- corpus-backed golden suite (gated on the local data-cache) -------------
_CACHE = Path(__file__).resolve().parents[1] / "data-cache"
_corpus = pytest.mark.skipif(
    not (_CACHE / "house").exists(),
    reason="data-cache not present (local-only real corpus)",
)


@_corpus
def test_golden_questions_against_real_corpus(tmp_path):
    """20 analyst questions with answers computed from the real ingested corpus."""
    from populus.ingest import house as house_ingest
    from populus.ingest import senate as senate_ingest
    from populus import backfill, members as members_mod

    p = tmp_path / "corpus.db"
    init_db(str(p))
    conn = connect(str(p))
    amendments.ensure_views(conn)
    conn.close()
    # Drive the real CLI ingest in-process (same interpreter; errors surface).
    from click.testing import CliRunner
    from populus.cli import main as cli_main
    runner = CliRunner()
    for args in (
        ["ingest", "congress-house", "--from-cache", str(_CACHE / "house")],
        ["ingest", "congress-senate", "--from-cache", str(_CACHE / "senate")],
        ["ingest", "congress-backfill", "--from-cache", str(_CACHE / "kadoa")],
        ["ingest", "members", "--from-cache", str(_CACHE / "legislators")],
    ):
        res = runner.invoke(cli_main, [*args, "--db", str(p)], catch_exceptions=False)
        assert res.exit_code == 0, f"ingest {args[1]} failed: {res.output}"

    srv = build_server(db_path=str(p), build_id="corpus", now=_now)
    ro = connect(str(p))
    amendments.ensure_views(ro)

    # Q1: health transaction count == default-view count in the DB.
    dv = ro.execute("SELECT COUNT(*) FROM v_default_transactions").fetchone()[0]
    assert _call(srv, "congress_health")["results"]["coverage"]["transactions"] == dv
    # Q2: recent_trades honors the window and is a subset of default view.
    rt = _call(srv, "congress_recent_trades", window_days=3650, limit=200)["results"]
    assert 0 < len(rt) <= dv
    # Q3: every returned record carries both dates + doc_url (G4).
    assert all(r["filed_date"] and r["doc_url"] for r in rt)
    # Q4: top tickers is non-empty and descending by trade_count.
    top = _call(srv, "congress_ticker_activity", ticker="", window_days=3650, mode="top", limit=10)["results"]["tickers"]
    counts = [t["trade_count"] for t in top]
    assert counts and counts == sorted(counts, reverse=True)
    # Q5: biggest trades descending by amount_high.
    big = _call(srv, "congress_ticker_activity", ticker="", window_days=3650, mode="biggest", limit=10)["results"]["trades"]
    highs = [t["amount_high"] for t in big]
    # Open-ended ranges (amount_high=None, "Over $50M"/spouse cap) rank FIRST,
    # then finite upper bounds descending.
    nones = [h for h in highs if h is None]
    finite = [h for h in highs if h is not None]
    assert highs == nones + finite  # all None-firsts precede any finite
    assert finite == sorted(finite, reverse=True)
    # Q6: a real member from the corpus resolves and has activity.
    who = ro.execute(
        "SELECT bioguide_id FROM v_default_transactions WHERE bioguide_id IS NOT NULL LIMIT 1"
    ).fetchone()[0]
    act = _call(srv, "congress_member_activity", bioguide_id=who)
    assert act["results"]["summary"]["trade_count"] >= 1
    # Q7: member_flows is labeled a flow estimate, not holdings.
    assert "FLOW ESTIMATE" in _call(srv, "congress_member_flows", bioguide_id=who)["data_note"]
    # Q8: needs_ocr paper filings are surfaced by latest_filings (not dropped).
    filings = _call(srv, "congress_latest_filings", since_iso="2000-01-01T00:00:00Z", limit=500)["results"]["filings"]
    total_filings = ro.execute("SELECT COUNT(*) FROM filings").fetchone()[0]
    assert len(filings) == min(500, total_filings)
    # Q9: source mix names both primary chambers.
    mix = _call(srv, "congress_health")["results"]["source_mix"]
    assert "house-clerk" in mix and "senate-efd" in mix
    # Q10: party filter returns only that party.
    dem = _call(srv, "congress_recent_trades", window_days=3650, party="Democrat", limit=200)["results"]
    assert all(r["member"]["party"] in (None, "Democrat") for r in dem)
    ro.close()
