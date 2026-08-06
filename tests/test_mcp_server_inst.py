"""RUN M2-4 — institutional (13F) MCP tool tests.

An always-run suite exercises every ``inst_*`` tool over a deterministic,
committed-fixture ``inst_agg.db`` (snapshot plane) and a live SEC EDGAR fetch
served through an injected fake transport (federated plane) — no test opens a
socket (the autouse guard in ``conftest.py`` proves it). It asserts the M2
envelope honesty (the non-removable ``INST_DATA_NOTE``, both dates on
filing-level records, ``unit_basis`` labels, the ``sec-edgar`` notice, the
``live_source`` xor ``build_id`` stamp, the G9 separation from the congressional
statutory notice), the ticker→issuer resolution, the unit-guarded QoQ Δshares,
and honest degradation when the inst module is absent from the snapshot. A
separate corpus-backed golden suite (gated on the local ``data-cache/inst``)
runs the same questions against the real Berkshire corpus.
"""

from __future__ import annotations

import json
import sys
from datetime import datetime, timezone
from pathlib import Path

import pytest

# Reuse the vetted M2-2/M2-3 seeding + fake-transport helpers (no fork).
from test_inst_agg import _entity, _filer, _hold, _load, _security
from test_inst_ingest import _FakeSecTransport

from populus.amendments import ensure_views
from populus.db import connect, init_db
from populus.ingest import TransportResponse
from populus.inst_agg import build_inst_agg
from populus.mcp_server import envelope as env
from populus.mcp_server import inst_queries as iq
from populus.mcp_server.server import build_server
from populus.net.sec_client import SecCircuitOpenError, SecClient
from populus.normalize_inst import INST_DATA_NOTE
from populus.parse.inst13f import discover_info_table_name

AT = "2026-07-24T12:00:00Z"
FIXED_NOW = datetime(2026, 7, 25, tzinfo=timezone.utc)
FIXTURES = Path(__file__).parent / "fixtures" / "inst"
REAL_DIR = FIXTURES / "real"
REAL_CIK = "0001067983"
#: The real Berkshire 2026-Q1 (period 2026-03-31) 13F-HR in the committed corpus.
REAL_2026Q1_NODASH = "000119312526226661"
MCP_TICKERS = FIXTURES / "mcp" / "company_tickers.json"

BRK = "0001067983"
OTHER = "0009000099"
BOND_FILER = "0009000077"
# Resolved issuer entities, so the aggregate keys them `entity:cik:<cik>` and a
# present-day ticker resolves to the same key.
AAPL_CIK, MSFT_CIK, NVDA_CIK = "0000320193", "0000789019", "0001045810"


def _now() -> datetime:
    return FIXED_NOW


# --- deterministic snapshot corpus -------------------------------------------


def _seed_source(conn) -> None:
    """A small, fully-resolved 13F corpus with a QoQ timeline and an SH→PRN unit
    transition — every inst tool has a deterministic answer against it."""
    for cik, sid in ((AAPL_CIK, "sec:aapl"), (MSFT_CIK, "sec:msft"), (NVDA_CIK, "sec:nvda")):
        _security(conn, sid, entity_id=_entity(conn, cik), link="resolved")
    _security(conn, "sec:bond")  # unresolved bond (keyed by sid, name-issuer)

    _filer(conn, BRK, "BERKSHIRE HATHAWAY INC")
    _load(conn, fid="inst:BRK-2025Q4", cik=BRK, period="2025-12-31", filed="2026-02-14",
          holds=[_hold(ordinal=1, issuer="APPLE INC", cusip="037833100", value=1000,
                       shares=100, security_id="sec:aapl"),
                 _hold(ordinal=2, issuer="MICROSOFT CORP", cusip="594918104", value=500,
                       shares=50, security_id="sec:msft")])
    _load(conn, fid="inst:BRK-2026Q1", cik=BRK, period="2026-03-31", filed="2026-05-15",
          holds=[_hold(ordinal=1, issuer="APPLE INC", cusip="037833100", value=2000,
                       shares=150, security_id="sec:aapl"),
                 _hold(ordinal=2, issuer="NVIDIA CORP", cusip="67066G104", value=300,
                       shares=30, security_id="sec:nvda")])
    _filer(conn, OTHER, "OTHER CAPITAL LLC")
    _load(conn, fid="inst:OTH-2026Q1", cik=OTHER, period="2026-03-31", filed="2026-05-14",
          holds=[_hold(ordinal=1, issuer="APPLE INC", cusip="037833100", value=800,
                       shares=40, security_id="sec:aapl")])
    # A bond reported SH one quarter and PRN the next — one continuous position
    # whose Δshares must be NULL + shares_unit_mismatch (never a fabricated 0).
    _filer(conn, BOND_FILER, "BOND FUND LP")
    _load(conn, fid="inst:BND-2025Q4", cik=BOND_FILER, period="2025-12-31", filed="2026-02-10",
          holds=[_hold(ordinal=1, issuer="SOME BOND", cusip="123456789", value=100,
                       shares=10, unit="SH", security_id="sec:bond")])
    _load(conn, fid="inst:BND-2026Q1", cik=BOND_FILER, period="2026-03-31", filed="2026-05-10",
          holds=[_hold(ordinal=1, issuer="SOME BOND", cusip="123456789", value=200,
                       shares=20, unit="PRN", security_id="sec:bond")])


@pytest.fixture(scope="module")
def agg_path(tmp_path_factory) -> str:
    """Build the deterministic ``inst_agg.db`` once for the module."""
    root = tmp_path_factory.mktemp("inst_mcp")
    src = root / "populus.db"
    init_db(str(src))
    conn = connect(str(src))
    _seed_source(conn)
    ensure_views(conn)
    out = root / "inst_agg.db"
    build_inst_agg(conn, out, ingested_at=AT)
    conn.close()
    return str(out)


# --- injected transports (no network) ----------------------------------------


def _clock_client(transport) -> SecClient:
    counter = iter(range(1, 1_000_000))
    return SecClient(
        transport, contact="test@example.com",
        sleep=lambda _s: None, monotonic=lambda: next(counter),
    )


def _detail_url_map(root: Path, cik10: str, nodash: str) -> dict[str, bytes]:
    """submissions + the one accession's index/cover/table (table name discovered
    from the index, never hardcoded)."""
    src = root / f"CIK{cik10}" / nodash
    table = discover_info_table_name((src / "index.json").read_bytes())
    base = f"https://www.sec.gov/Archives/edgar/data/{int(cik10)}/{nodash}"
    return {
        f"https://data.sec.gov/submissions/CIK{cik10}.json":
            (root / f"CIK{cik10}" / "submissions.json").read_bytes(),
        f"{base}/index.json": (src / "index.json").read_bytes(),
        f"{base}/primary_doc.xml": (src / "primary_doc.xml").read_bytes(),
        f"{base}/{table}": (src / table).read_bytes(),
    }


def _full_files() -> dict[str, bytes]:
    """The committed ticker source plus the real Berkshire 2026-Q1 detail bytes."""
    files = {iq.COMPANY_TICKERS_URL: MCP_TICKERS.read_bytes()}
    files.update(_detail_url_map(REAL_DIR, REAL_CIK, REAL_2026Q1_NODASH))
    return files


@pytest.fixture()
def server(agg_path):
    """A server with the inst module present + a federated client that can serve
    ticker resolution and the real Berkshire detail fetch."""
    return build_server(
        db_path=":memory:", build_id="cong-1",
        inst_db_path=agg_path, inst_build_id="inst-1",
        inst_watermarks={"latest_period_of_report": "2026-03-31",
                         "latest_filed_date": "2026-05-15"},
        sec_client=_clock_client(_FakeSecTransport(_full_files())),
        now=_now,
    )


@pytest.fixture()
def absent_server():
    """A server with NO inst module (withheld from the snapshot); the federated
    client still works so ``mode='detail'`` remains available."""
    return build_server(
        db_path=":memory:", build_id="cong-1",
        inst_db_path=None,
        sec_client=_clock_client(_FakeSecTransport(_full_files())),
        now=_now,
    )


def _call(server, name, **kwargs):
    return server._tool_manager.get_tool(name).fn(**kwargs)


def _assert_inst_envelope(e):
    """The M2 envelope contract, present on every inst response."""
    assert {"as_of", "data_note", "license_notices", "results"} <= set(e)
    # live_source xor build_id (§11.3).
    assert ("live_source" in e) ^ ("build_id" in e)
    # The reused, non-removable quarter-end caveat (G10).
    assert "quarter-end snapshot" in e["data_note"]
    # The sec-edgar attribution rides every inst response (R9).
    lids = {n["license_id"] for n in e["license_notices"]}
    assert "sec-edgar" in lids
    assert isinstance(e["license_notices"], list) and e["license_notices"]


# --- R1: inst_filer_lookup ---------------------------------------------------


def test_inst_filer_lookup_by_name_and_cik(server):
    by_name = _call(server, "inst_filer_lookup", query="Berkshire")
    _assert_inst_envelope(by_name)
    assert by_name["build_id"] == "inst-1"
    match = by_name["results"]["matches"][0]
    assert match["cik"] == BRK and match["filer_name"] == "BERKSHIRE HATHAWAY INC"
    assert "ingested_at" not in match  # volatile provenance not surfaced
    # A bare numeric query resolves the (zero-padded) CIK exactly.
    by_cik = _call(server, "inst_filer_lookup", query="1067983")
    assert by_cik["results"]["matches"][0]["cik"] == BRK


def test_inst_filer_lookup_empty_query_hint(server):
    e = _call(server, "inst_filer_lookup", query="   ")
    assert "error" in e["results"]
    miss = _call(server, "inst_filer_lookup", query="Nobody Capital")
    assert miss["results"]["matches"] == [] and "hint" in miss["results"]


def test_inst_filer_lookup_absent_module(absent_server):
    e = _call(absent_server, "inst_filer_lookup", query="Berkshire")
    _assert_inst_envelope(e)
    assert "unavailable" in e["results"]
    assert "not present in the current published snapshot" in e["results"]["unavailable"]


# --- R2: inst_filer_holdings mode='snapshot' ---------------------------------


def test_inst_holdings_snapshot_profile(server):
    e = _call(server, "inst_filer_holdings", cik="1067983")
    _assert_inst_envelope(e)
    r = e["results"]
    assert r["mode"] == "snapshot" and r["cik"] == BRK
    assert r["period_of_report"] == "2026-03-31"  # latest by default
    assert r["filer"]["filer_name"] == "BERKSHIRE HATHAWAY INC"
    # The concentration for the period, with NULL-safe share/HHI.
    assert r["concentration"]["period_of_report"] == "2026-03-31"
    assert r["concentration"]["total_value_usd"] == 2300


def test_inst_holdings_snapshot_bad_cik(server):
    e = _call(server, "inst_filer_holdings", cik="not-a-cik")
    assert "error" in e["results"] and "cik" in e["results"]["error"]
    bad_period = _call(server, "inst_filer_holdings", cik="1067983", period="last quarter")
    assert "error" in bad_period["results"] and "period" in bad_period["results"]["error"]


def test_inst_holdings_snapshot_period_is_canonicalized(server):
    # A lenient-but-valid period (single-digit month) must normalize to the
    # canonical stored form and still match the quarter's concentration row —
    # never silently return no data.
    e = _call(server, "inst_filer_holdings", cik="1067983", period="2026-3-31")
    r = e["results"]
    assert r["period_of_report"] == "2026-03-31"
    assert r["concentration"] is not None and r["concentration"]["total_value_usd"] == 2300


def test_inst_holdings_snapshot_absent_hints_detail(absent_server):
    e = _call(absent_server, "inst_filer_holdings", cik="1067983", mode="snapshot")
    _assert_inst_envelope(e)
    assert "unavailable" in e["results"]
    assert "mode='detail'" in e["results"]["unavailable"]  # offers the live path


# --- R3: inst_filer_holdings mode='qoq' --------------------------------------


def test_inst_holdings_qoq_deltas_shape(server):
    e = _call(server, "inst_filer_holdings", cik=BRK, mode="qoq")
    _assert_inst_envelope(e)
    r = e["results"]
    assert r["mode"] == "qoq"
    assert r["curr_period"] == "2026-03-31" and r["prev_period"] == "2025-12-31"
    kinds = {c["change_kind"]: c for c in r["changes"]}
    assert kinds["add"]["position_key"] == "sid:sec:aapl"
    assert kinds["add"]["delta_value_usd"] == 1000
    assert kinds["exit"]["position_key"] == "sid:sec:msft"
    assert kinds["new"]["position_key"] == "sid:sec:nvda"
    # Both periods on every filing-level change record.
    for c in r["changes"]:
        assert c["curr_period"] and c["prev_period"]


def test_inst_holdings_qoq_unit_guarded_delta_shares(server):
    # SH→PRN across quarters: the position matches (one continuous holding) but
    # Δshares is NULL + shares_unit_mismatch — never a fabricated 0 (F4/G5).
    e = _call(server, "inst_filer_holdings", cik=BOND_FILER, mode="qoq")
    changes = e["results"]["changes"]
    assert len(changes) == 1
    change = changes[0]
    assert change["position_key"] == "sid:sec:bond"
    assert change["delta_shares"] is None
    assert "shares_unit_mismatch" in change["flags"]
    assert change["delta_value_usd"] == 100  # value delta still computed


# --- R4: inst_filer_holdings mode='detail' (federated, no network) -----------


def test_inst_holdings_detail_federated_live_source(server):
    e = _call(server, "inst_filer_holdings", cik="1067983", period="2026-03-31", mode="detail")
    _assert_inst_envelope(e)
    # live_source stamped, build_id absent (xor).
    assert "live_source" in e and "build_id" not in e
    assert e["live_source"]["source"] == "sec-edgar-live"
    assert e["live_source"]["accession"] == "0001193125-26-226661"
    assert e["live_source"]["doc_url"]
    r = e["results"]
    assert r["mode"] == "detail" and r["filer_name"] == "BERKSHIRE HATHAWAY INC"
    assert len(r["holdings"]) > 0
    assert "unresolved" in r["identity_note"]
    assert "not current positions" in e["data_note"]


def test_inst_holdings_detail_both_dates_and_unit_basis(server):
    e = _call(server, "inst_filer_holdings", cik="1067983", period="2026-03-31", mode="detail")
    holdings = e["results"]["holdings"]
    # The real first row: ALLY FINL INC, $498,992,850, whole-dollar era (G4/G5).
    ally = next(h for h in holdings if h["issuer_name"] == "ALLY FINL INC")
    assert ally["value_usd"] == 498992850
    assert ally["unit_basis"] == "whole"
    assert "quarter-end market value" in ally["value_label"]
    assert ally["cusip"] == "02005N100"
    for h in holdings:  # every filing-level record carries BOTH dates + doc_url
        assert h["period_of_report"] == "2026-03-31" and h["filed_date"] == "2026-05-15"
        assert h["doc_url"]
    # Identity is left unresolved on the federated path (G14/LD5).
    assert ally["security_id"] is None and "missing_security" in ally["flags"]


def test_inst_holdings_detail_circuit_open_honest_error(agg_path):
    class _Always403:
        def get(self, url, *, headers):
            return TransportResponse(status_code=403, headers={}, content=b"")

    client = _clock_client(_Always403())
    # Latch the breaker: three consecutive 403s (only the third raises).
    for i in (1, 2, 3):
        try:
            client.get(f"https://data.sec.gov/submissions/CIK{i}.json")
        except SecCircuitOpenError:
            pass
    srv = build_server(
        db_path=":memory:", build_id="c", inst_db_path=agg_path,
        inst_build_id="i", sec_client=client, now=_now,
    )
    e = _call(srv, "inst_filer_holdings", cik="1067983", mode="detail")
    _assert_inst_envelope(e)
    assert "error" in e["results"] and "circuit" in e["results"]["error"].lower()


def test_inst_holdings_detail_404_honest_error(agg_path):
    srv = build_server(
        db_path=":memory:", build_id="c", inst_db_path=agg_path, inst_build_id="i",
        sec_client=_clock_client(_FakeSecTransport({})), now=_now,
    )
    e = _call(srv, "inst_filer_holdings", cik="1067983", mode="detail")
    assert "error" in e["results"] and "404" in e["results"]["error"]


def test_inst_holdings_detail_works_when_module_absent(absent_server):
    e = _call(absent_server, "inst_filer_holdings", cik="1067983", period="2026-03-31", mode="detail")
    _assert_inst_envelope(e)
    assert "live_source" in e
    assert len(e["results"]["holdings"]) > 0  # federated detail survives module absence


# --- R5: inst_ticker_holders -------------------------------------------------


def test_inst_ticker_holders_resolves_and_ranks(server):
    e = _call(server, "inst_ticker_holders", ticker="AAPL", period="2026-03-31")
    _assert_inst_envelope(e)
    issuer = e["results"]["issuer"]
    assert issuer["cik"] == AAPL_CIK
    assert issuer["issuer_key"] == "entity:cik:0000320193"
    holders = e["results"]["holders"]
    assert [h["cik"] for h in holders] == [BRK, OTHER]  # ranked by value desc
    assert holders[0]["value_usd"] == 2000 and holders[1]["value_usd"] == 800
    assert holders[0]["rank"] == 1


def test_inst_ticker_holders_present_day_mapping_note(server):
    e = _call(server, "inst_ticker_holders", ticker="AAPL")
    assert "PRESENT-DAY" in e["data_note"]  # G14: labeled, never silent
    assert e["results"]["issuer"]["mapping_basis"] == "sec-company-tickers (present-day)"


def test_inst_ticker_holders_unresolved_hint(server):
    # A well-formed ticker that is not in company_tickers.json → honest hint.
    e = _call(server, "inst_ticker_holders", ticker="ZZZZ")
    assert e["results"]["holders"] == [] and "hint" in e["results"]


def test_inst_ticker_holders_bad_ticker_hint(server):
    e = _call(server, "inst_ticker_holders", ticker="!!!")
    assert "error" in e["results"]


def test_inst_ticker_holders_absent_module(absent_server):
    e = _call(absent_server, "inst_ticker_holders", ticker="AAPL")
    assert "unavailable" in e["results"]


# --- R6: inst_biggest_moves --------------------------------------------------


def test_inst_biggest_moves_by_side_ranked(server):
    new = _call(server, "inst_biggest_moves", period="2026-03-31", side="new")
    _assert_inst_envelope(new)
    assert new["results"]["side"] == "new"
    keys = {m["position_key"] for m in new["results"]["moves"]}
    assert "sid:sec:nvda" in keys  # Berkshire's new NVDA position
    # Ranked by absolute dollar change, descending.
    deltas = [abs(m["delta_value_usd"]) for m in new["results"]["moves"]]
    assert deltas == sorted(deltas, reverse=True)
    # A cross-filer move carries the filer_name (registry join).
    assert all("filer_name" in m for m in new["results"]["moves"])
    add = _call(server, "inst_biggest_moves", side="add")  # default period = latest
    assert any(m["position_key"] == "sid:sec:aapl" for m in add["results"]["moves"])


def test_inst_biggest_moves_bad_side_hint(server):
    e = _call(server, "inst_biggest_moves", side="bogus")
    assert "error" in e["results"] and "side" in e["results"]["error"]


def test_inst_biggest_moves_absent_module(absent_server):
    e = _call(absent_server, "inst_biggest_moves", side="new")
    assert "unavailable" in e["results"]


# --- R7: inst_health ---------------------------------------------------------


def test_inst_health_present_freshness_both_dates(server):
    e = _call(server, "inst_health")
    _assert_inst_envelope(e)
    r = e["results"]
    assert r["present"] is True and r["snapshot_build"] == "inst-1"
    # Both dates (G4): period from the aggregate/watermark, filed from watermark.
    assert r["freshness"]["latest_period_of_report"] == "2026-03-31"
    assert r["freshness"]["latest_filed_date"] == "2026-05-15"
    assert r["counts"]["filers"] == 3
    assert r["issuer_keying"].get("entity", 0) >= 1


def test_inst_health_absent_present_false(absent_server):
    e = _call(absent_server, "inst_health")
    _assert_inst_envelope(e)
    assert e["results"]["present"] is False
    assert "not present in the current published snapshot" in e["results"]["reason"]


def test_inst_health_no_fabricated_coverage_or_unit_mix(server):
    e = _call(server, "inst_health")
    r = e["results"]
    # No fabricated exact coverage %, no per-filing unit-regime mix (LD4).
    assert "coverage_pct" not in r and "unit_regime_mix" not in r


def test_inst_health_claims_the_gate_only_for_published_data(agg_path):
    """QA-F6: the ≥95% coverage assurance is a fact about data that came through
    the M2-3 publish gate. A `--inst-db` bypass points at an arbitrary local file
    that never passed it, so claiming coverage there would FABRICATE an
    assurance about unpublished data. Both provenance modes are asserted."""
    published = build_server(
        db_path=":memory:", build_id="cong-1",
        inst_db_path=agg_path, inst_build_id="inst-1",
        inst_from_published_manifest=True, now=_now,
    )
    joined = " ".join(_call(published, "inst_health")["results"]["caveats"])
    assert "publish gate" in joined and "pipeline-side" in joined
    assert "UNVERIFIED" not in joined
    assert _call(published, "inst_health")["results"]["provenance"] == (
        "published-snapshot"
    )

    bypassed = build_server(
        db_path=":memory:", build_id="cong-1",
        inst_db_path=agg_path, inst_build_id=None,
        inst_from_published_manifest=False, now=_now,
    )
    r = _call(bypassed, "inst_health")["results"]
    joined = " ".join(r["caveats"])
    assert "UNVERIFIED SOURCE" in joined
    assert "no coverage guarantee applies" in joined.lower()
    # It must NOT assert the gate held for data that never went through it.
    assert "guaranteed by the M2-3 publish gate" not in joined
    assert r["provenance"] == "unverified-local-db"


def test_inst_health_filed_date_null_without_watermark(agg_path):
    # --inst-db dev bypass: no manifest → latest_filed_date honestly null, while
    # latest_period_of_report still resolves from the aggregate itself.
    srv = build_server(
        db_path=":memory:", build_id="c", inst_db_path=agg_path,
        inst_build_id=None, inst_watermarks=None, now=_now,
    )
    r = _call(srv, "inst_health")["results"]
    assert r["freshness"]["latest_period_of_report"] == "2026-03-31"
    assert r["freshness"]["latest_filed_date"] is None


# --- R8: envelope backward-compat + shape_holding ----------------------------


def test_envelope_live_source_xor_build_id():
    snap = env.envelope(build_id="b", as_of="t", results=[])
    assert "build_id" in snap and "live_source" not in snap
    live = env.envelope(as_of="t", results=[], live_source={"source": "x"})
    assert "live_source" in live and "build_id" not in live


def test_shape_holding_fields():
    row = {"issuer_name_raw": "APPLE INC", "cusip": "037833100", "value_usd": 2000,
           "unit_basis": "whole", "ssh_prnamt": 150, "ssh_prnamt_type": "SH",
           "put_call": None, "security_id": None, "flags": ["missing_security"]}
    shaped = env.shape_holding(row, period_of_report="2026-03-31",
                               filed_date="2026-05-15", doc_url="https://x/doc",
                               accession="0001193125-26-226661")
    assert shaped["period_of_report"] == "2026-03-31"  # both dates (G4)
    assert shaped["filed_date"] == "2026-05-15"
    assert shaped["value_usd"] == 2000 and shaped["unit_basis"] == "whole"  # G5
    assert "quarter-end market value" in shaped["value_label"]
    assert shaped["source"] == "sec-edgar" and shaped["doc_url"] == "https://x/doc"
    assert shaped["flags"] == ["missing_security"]
    # §5.1 `source_record_id`: the identity of the filing that disclosed THIS row.
    assert shaped["accession"] == "0001193125-26-226661"


def test_shape_holding_requires_an_accession_rather_than_defaulting_to_null():
    """QA M2-8 R2 N4: `accession` had a `= None` default, so a caller that simply
    forgot it shipped `accession: null` on every row — and one of the two callers
    did. `null` is indistinguishable from "this filing has no accession", which
    is never true of a 13F.

    Both planes have the value in hand, so the parameter is REQUIRED and the
    omission is a TypeError at the call site instead of a silent null in the
    payload. Mutation guard: restoring the default flips this to no error.
    """
    with pytest.raises(TypeError):
        env.shape_holding(                       # type: ignore[call-arg]
            {"issuer_name_raw": "APPLE INC"},
            period_of_report="2026-03-31",
            filed_date="2026-05-15",
            doc_url="https://x/doc",
        )


def test_congress_envelope_unchanged():
    # The default (no M2 params) path must reproduce the congress contract byte
    # for byte: build_id stamp, the §9.8 congressional data_note, and the global
    # license notices — so the 1298 existing tests are unaffected (R14).
    e = env.envelope(build_id="20260722.1", as_of="2026-07-25", results={"x": 1})
    assert e["build_id"] == "20260722.1"
    assert "45 days" in e["data_note"] and "13107" in e["data_note"]
    assert e["license_notices"] == env.license_notices()


# --- R9: license surfacing + G9 separation -----------------------------------


def test_inst_response_carries_sec_edgar_notice(server):
    e = _call(server, "inst_filer_lookup", query="Berkshire")
    notice = next(n for n in e["license_notices"] if n["license_id"] == "sec-edgar")
    assert "Securities and Exchange Commission" in notice["notice"]


def test_inst_response_omits_congress_statutory_notice(server):
    # G9: an inst response must not carry the congressional statutory restriction
    # (5 U.S.C. § 13107) that rides congress responses via the congress DATA_NOTE.
    for name, kwargs in (("inst_filer_lookup", {"query": "Berkshire"}),
                         ("inst_health", {})):
        e = _call(server, name, **kwargs)
        assert "13107" not in e["data_note"]
        blob = json.dumps(e["license_notices"])
        assert "13107" not in blob


# --- R10: populus_health -----------------------------------------------------


def test_populus_health_lists_inst_when_present(server):
    e = _call(server, "populus_health")
    assert e["results"]["modules"] == ["congress", "inst"]
    detail = e["results"]["module_detail"]
    assert detail["inst"]["present"] is True
    assert detail["inst"]["latest_period_of_report"] == "2026-03-31"


def test_populus_health_modules_congress_only_when_absent(absent_server):
    e = _call(absent_server, "populus_health")
    assert e["results"]["modules"] == ["congress"]  # M1 assertion holds
    assert e["results"]["module_detail"]["inst"]["present"] is False


# --- R11: server wiring ------------------------------------------------------


def test_build_server_threads_inst_and_secclient(server):
    # Both planes reachable from one server: the snapshot tool reads the inst DB,
    # the federated tool reaches SEC through the injected client.
    assert _call(server, "inst_filer_lookup", query="Berkshire")["results"]["matches"]
    assert _call(server, "inst_filer_holdings", cik="1067983", period="2026-03-31",
                 mode="detail")["results"]["holdings"]


def test_tool_budget_within_25(server):
    import asyncio

    names = {t.name for t in asyncio.run(server.list_tools())}
    assert len(names) <= 25  # §11.2 global budget
    assert {"inst_filer_lookup", "inst_filer_holdings", "inst_ticker_holders",
            "inst_biggest_moves", "inst_health"} <= names


def test_inst_db_dev_bypass_resolution(monkeypatch):
    # `--db` / `--inst-db` are the per-module dev bypasses; `--db` alone leaves
    # inst absent (snapshot tools degrade, detail still federates).
    from populus.mcp_server import server as srv_mod

    monkeypatch.setattr(sys, "argv", ["populus-mcp", "--db", "c.db", "--inst-db", "i.db"])
    both = srv_mod._resolve_snapshot()
    assert both["db_path"] == "c.db" and both["inst_db_path"] == "i.db"
    assert both["build_id"] is None and both["inst_build_id"] is None

    monkeypatch.setattr(sys, "argv", ["populus-mcp", "--db", "c.db"])
    congress_only = srv_mod._resolve_snapshot()
    assert congress_only["db_path"] == "c.db"
    assert congress_only["inst_db_path"] is None  # inst degrades honestly


def test_no_sec_client_detail_degrades(agg_path):
    # A server without a federated client: snapshot tools still work; the live
    # detail path degrades honestly rather than crashing.
    srv = build_server(db_path=":memory:", build_id="c", inst_db_path=agg_path,
                       inst_build_id="i", sec_client=None, now=_now)
    ok = _call(srv, "inst_filer_lookup", query="Berkshire")
    assert ok["results"]["matches"]
    degraded = _call(srv, "inst_filer_holdings", cik="1067983", mode="detail")
    # QA-r5-F2: a federated CONFIGURATION failure is still a federated outcome —
    # stamping it with the snapshot build_id misattributes the data plane.
    assert "build_id" not in degraded
    assert degraded["live_source"]["outcome"] == "failed"
    ticker = _call(srv, "inst_ticker_holders", ticker="AAPL")
    assert "build_id" not in ticker
    assert ticker["live_source"]["outcome"] == "failed"
    assert "error" in degraded["results"]


# --- corpus-backed golden suite (gated on the local data-cache) --------------

_CACHE = Path(__file__).resolve().parents[1] / "data-cache" / "inst"
_corpus = pytest.mark.skipif(
    not (_CACHE / f"CIK{REAL_CIK}").exists(),
    reason="data-cache/inst not present (local-only real corpus)",
)


@_corpus
def test_inst_golden_questions_against_real_corpus(tmp_path):
    """Analyst questions answered from the real Berkshire corpus, hermetically
    (federated fetches served from the local cache — no network)."""
    from populus.ingest.inst13f import run_inst13f_ingest

    src = tmp_path / "populus.db"
    init_db(str(src))
    conn = connect(str(src))
    run_inst13f_ingest(
        conn, run_id="golden", now=lambda: AT, host="h", ingested_at=AT,
        ciks=[REAL_CIK], cache_dir=str(_CACHE),
    )
    ensure_views(conn)
    agg = tmp_path / "inst_agg.db"
    build_inst_agg(conn, agg, ingested_at=AT)
    conn.close()

    # Serve ticker resolution + the real 2026-Q1 detail from the local cache.
    files = {iq.COMPANY_TICKERS_URL: (_CACHE / "registry" / "company_tickers.json").read_bytes()}
    files.update(_detail_url_map(_CACHE, REAL_CIK, REAL_2026Q1_NODASH))
    srv = build_server(
        db_path=":memory:", build_id="cong", inst_db_path=str(agg), inst_build_id="inst",
        inst_watermarks={"latest_period_of_report": "2026-03-31",
                         "latest_filed_date": "2026-05-15"},
        sec_client=_clock_client(_FakeSecTransport(files)), now=_now,
    )

    # Q1: "Who is Berkshire?" resolves to the real CIK.
    assert _call(srv, "inst_filer_lookup", query="Berkshire")["results"]["matches"][0]["cik"] == REAL_CIK
    # Q2: "What did Berkshire hold at 2026-Q1?" — live detail, real ALLY row.
    detail = _call(srv, "inst_filer_holdings", cik=REAL_CIK, period="2026-03-31", mode="detail")
    _assert_inst_envelope(detail)
    assert "live_source" in detail
    ally = next(h for h in detail["results"]["holdings"] if h["issuer_name"] == "ALLY FINL INC")
    assert ally["value_usd"] == 498992850 and ally["unit_basis"] == "whole"
    # Q3: "Biggest new positions last quarter?" is a well-formed, ranked answer.
    moves = _call(srv, "inst_biggest_moves", side="new")
    _assert_inst_envelope(moves)
    deltas = [abs(m["delta_value_usd"]) for m in moves["results"]["moves"]]
    assert deltas == sorted(deltas, reverse=True)
    # Q4: "Who holds AAPL?" resolves the ticker to Apple's CIK (well-formed).
    holders = _call(srv, "inst_ticker_holders", ticker="AAPL")
    _assert_inst_envelope(holders)
    assert holders["results"]["issuer"]["cik"] == AAPL_CIK
    assert "holders" in holders["results"]
    # Q5: "Is this current?" — the quarter-end / not-current caveat surfaces.
    snap = _call(srv, "inst_filer_holdings", cik=REAL_CIK, mode="snapshot")
    assert "quarter-end snapshot" in snap["data_note"] and "not a full portfolio" in snap["data_note"]
    assert "not current positions" in detail["data_note"]
    # Q6: health reports freshness (both dates) without fabricating coverage.
    health = _call(srv, "inst_health")["results"]
    assert health["present"] is True
    assert health["freshness"]["latest_period_of_report"] == "2026-03-31"
    assert "coverage_pct" not in health


@pytest.mark.parametrize("tool", ["inst_filer_holdings", "inst_ticker_holders"])
def test_a_transport_failure_returns_an_envelope_not_a_crash(agg_path, tool):
    """QA-F3: a timeout / connection reset / malformed SEC payload must become an
    HONEST error envelope — never an exception raised out of an MCP call."""

    class Exploding:
        def get(self, url, **kwargs):
            raise TimeoutError("connection timed out")

    server = build_server(
        db_path=":memory:", build_id="cong-1",
        inst_db_path=agg_path, inst_build_id="inst-1",
        sec_client=_clock_client(Exploding()), now=_now,
    )
    if tool == "inst_filer_holdings":
        e = _call(server, tool, cik="0001067983", mode="detail")
    else:
        e = _call(server, tool, ticker="AAPL")
    assert "error" in e["results"], e["results"]
    assert "failed" in e["results"]["error"].lower()
    # The envelope is still well-formed and honest.
    assert e["data_note"] and e["license_notices"]
    # QA-r4-F5: a FAILED federated read is still a federated outcome. Returning
    # it through the snapshot-default envelope stamped it with the institutional
    # build_id, misattributing a live failure to published snapshot data.
    assert "build_id" not in e, "a federated failure was stamped as snapshot data"
    assert e["live_source"]["source"] == "sec-edgar-live"
    assert e["live_source"]["outcome"] == "failed"
    assert e["live_source"]["accession"] is None


def test_ticker_holders_records_carry_period_unit_and_provenance(server):
    """QA-F4: a holder record lifted out of the response must still say WHICH
    quarter-end and in what unit; the response must disclose the filing-level
    date (the build watermark) and where the numbers came from."""
    e = _call(server, "inst_ticker_holders", ticker="AAPL")
    r = e["results"]
    assert r["period_of_report"] == "2026-03-31"
    assert r["filed_through"] == "2026-05-15"     # from the manifest watermark
    assert "SEC EDGAR" in r["provenance"]
    for h in r["holders"]:
        assert h["period_of_report"] == "2026-03-31"
        assert h["value_unit"] == "USD"
        assert "quarter-end market value" in h["value_label"]


def test_populus_health_inst_detail_carries_caveats_in_both_states(server, absent_server):
    """QA-F7: the platform-level health answer must not report inst freshness
    stripped of its caveats, and must explain that ABSENT means withheld-by-gate
    rather than broken."""
    present = _call(server, "populus_health")["results"]["module_detail"]["inst"]
    assert present["present"] is True
    assert present["snapshot_build"] == "inst-1"
    assert present["latest_period_of_report"] == "2026-03-31"
    assert present["latest_filed_date"] == "2026-05-15"
    assert any("quarter-end" in c for c in present["caveats"])
    assert present["data_note"] == INST_DATA_NOTE
    # The fixture server is a DIRECT --inst-db, so it must be labeled unverified
    # here exactly as inst_health labels it — the two answers cannot disagree.
    assert present["provenance"] == "unverified-local-db"
    assert any("UNVERIFIED SOURCE" in c for c in present["caveats"])
    assert _call(server, "inst_health")["results"]["caveats"] == present["caveats"]

    # Absent with NO observed gate decision: it must claim nothing about why.
    absent = _call(absent_server, "populus_health")["results"]["module_detail"]["inst"]
    assert absent["present"] is False
    joined = " ".join(absent["caveats"])
    assert "NO coverage-gate decision was observed" in joined
    assert "WITHHELD" not in joined and "95%" not in joined

    # Absent BECAUSE the verified manifest omitted it: only now may it say so.
    withheld = build_server(
        db_path=":memory:", build_id="cong-1", inst_db_path=None,
        inst_absent_reason="the current published snapshot's verified manifest"
        " does not include the institutional module.",
        inst_absent_gate_withheld=True, now=_now,
    )
    w = _call(withheld, "populus_health")["results"]["module_detail"]["inst"]
    joined = " ".join(w["caveats"])
    assert "WITHHELD" in joined and "95%" in joined
    assert w["reason"].startswith("the current published snapshot's verified")


def _tickers_bytes(entries) -> dict[str, bytes]:
    return {iq.COMPANY_TICKERS_URL: json.dumps(
        {str(i): e for i, e in enumerate(entries)}).encode()}


def test_ticker_resolution_honors_the_identity_dispositions(agg_path):
    """QA-F9: the federated resolver must apply the SAME malformed/duplicate/DC1
    title-conflict dispositions as the identity pipeline. A ticker the pipeline
    REJECTS must not resolve here — otherwise the federated plane would key an
    issuer the published aggregate keys differently (or not at all)."""
    # One CIK carrying two distinct titles in one snapshot = DC1 title conflict:
    # load_company_tickers rejects ALL of its rows, so this must not resolve.
    conflicted = [
        {"cik_str": 320193, "ticker": "AAPL", "title": "Apple Inc."},
        {"cik_str": 320193, "ticker": "AAPL2", "title": "Apple Computer Inc"},
    ]
    server = build_server(
        db_path=":memory:", build_id="cong-1",
        inst_db_path=agg_path, inst_build_id="inst-1",
        sec_client=_clock_client(_FakeSecTransport(_tickers_bytes(conflicted))),
        now=_now,
    )
    e = _call(server, "inst_ticker_holders", ticker="AAPL")
    assert "error" in e["results"]
    assert "title conflict" in e["results"]["error"]
    # And it must NOT have silently returned Berkshire's real AAPL holders.
    assert "holders" not in e["results"]

    # One symbol claimed by two CIKs is genuine ambiguity — never a silent pick.
    ambiguous = [
        {"cik_str": 320193, "ticker": "ZZZ", "title": "Alpha Inc"},
        {"cik_str": 789019, "ticker": "ZZZ", "title": "Beta Inc"},
    ]
    server2 = build_server(
        db_path=":memory:", build_id="cong-1",
        inst_db_path=agg_path, inst_build_id="inst-1",
        sec_client=_clock_client(_FakeSecTransport(_tickers_bytes(ambiguous))),
        now=_now,
    )
    err = _call(server2, "inst_ticker_holders", ticker="ZZZ")["results"]["error"]
    assert "more than one CIK" in err and "refusing" in err


def test_a_clean_resolution_reports_its_source_dispositions(server):
    """The accepted mapping carries what the snapshot cost to accept, so a
    consumer can see it came from a file with (or without) rejections."""
    issuer = _call(server, "inst_ticker_holders", ticker="AAPL")["results"]["issuer"]
    d = issuer["source_dispositions"]
    assert d["rows_read"] == d["accepted"] + d["rejected_malformed"] \
        + d["rejected_duplicate"] + d["rejected_title_conflict"]
    assert d["accepted"] >= 1


#: The real committed merge pair for period 2025-03-31: the base 13F-HR and its
#: 13F-HR/A amendmentType NEW HOLDINGS (a confidential-treatment release).
MERGE_BASE_NODASH = "000095012325005701"
MERGE_AMENDMENT_NODASH = "000095012325008361"


def test_federated_detail_composes_the_real_base_and_new_holdings_amendment():
    """QA-F2: a NEW HOLDINGS amendment ADDS to its base filing. Serving the
    newest filing alone returned Berkshire's 4-row amendment as its COMPLETE
    2025-Q1 position list — an incomplete portfolio presented as whole. The
    federated plane must apply the same composition the pipeline does (M2-2
    R5/R6), against the committed real pair."""
    files = {iq.COMPANY_TICKERS_URL: MCP_TICKERS.read_bytes()}
    files.update(_detail_url_map(REAL_DIR, REAL_CIK, MERGE_BASE_NODASH))
    files.update(_detail_url_map(REAL_DIR, REAL_CIK, MERGE_AMENDMENT_NODASH))
    server = build_server(
        db_path=":memory:", build_id="cong-1", inst_db_path=None,
        sec_client=_clock_client(_FakeSecTransport(files)), now=_now,
    )
    r = _call(server, "inst_filer_holdings", cik=REAL_CIK,
              period="2025-03-31", mode="detail")["results"]

    trail = r["composition"]
    assert [c["submission_type"] for c in trail] == ["13F-HR", "13F-HR/A"]
    assert [c["filed_date"] for c in trail] == ["2025-05-15", "2025-08-14"]
    assert trail[0]["applied"] == "base"
    assert trail[1]["amendment_type"] == "NEW_HOLDINGS"
    assert "added to the base" in trail[1]["applied"]

    base_rows, amendment_rows = trail[0]["rows"], trail[1]["rows"]
    assert base_rows == 110 and amendment_rows == 4      # the real corpus
    # The composed answer is the SUM, not the amendment alone.
    assert len(r["holdings"]) == base_rows + amendment_rows == 114
    # Every row keeps its OWN filed date — the 110 base rows were disclosed on
    # 2025-05-15 and must not be restamped with the amendment's 2025-08-14 (G4).
    filed = [h["filed_date"] for h in r["holdings"]]
    assert filed.count("2025-05-15") == 110
    assert filed.count("2025-08-14") == 4
    assert all(h["period_of_report"] == "2025-03-31" for h in r["holdings"])


def test_every_live_plane_row_carries_its_OWN_accession():
    """QA M2-8 R2 N4 — the half of the §5.1 contract the published plane already
    keeps (`test_every_published_row_carries_its_own_accession`).

    `server.py:605` states the contract: *"Rows are shaped exactly like the
    federated ones so a client parses both planes identically."* The remediation
    added `accession` to `shape_holding`, passed it on the published plane, and
    left the live call site untouched — so `mode='snapshot'` returned a real
    accession and `mode='detail'` returned `null` for the same holding, defended
    by a docstring claiming the live path has no accession to give. It does:
    `inst_queries._holding_to_dict` puts `source_accession` in the very dict this
    call site iterates, beside the `source_filed_date` and `source_doc_url` it
    already reads.

    A composed period mixes a base with its amendments, so the accessions must
    DIFFER across rows and match the composition trail — one restamped value
    would be worse than none.

    Mutation guard: dropping `accession=` from the live shaper call is a
    TypeError; passing `detail["accession"]` alone collapses the two groups.
    """
    files = {iq.COMPANY_TICKERS_URL: MCP_TICKERS.read_bytes()}
    files.update(_detail_url_map(REAL_DIR, REAL_CIK, MERGE_BASE_NODASH))
    files.update(_detail_url_map(REAL_DIR, REAL_CIK, MERGE_AMENDMENT_NODASH))
    server = build_server(
        db_path=":memory:", build_id="cong-1", inst_db_path=None,
        sec_client=_clock_client(_FakeSecTransport(files)), now=_now,
    )
    r = _call(server, "inst_filer_holdings", cik=REAL_CIK,
              period="2025-03-31", mode="detail")["results"]

    holdings = r["holdings"]
    assert holdings, "the composed live answer carried no holdings"
    for h in holdings:
        assert h.get("accession"), f"a live-plane row carries no accession: {h}"
    # Per-row, not per-answer: the 110 base rows and the amendment's 4 carry
    # their own filing's identity, in the same split as `filed_date` (G4).
    by_accession = {}
    for h in holdings:
        by_accession.setdefault(h["accession"], []).append(h)
    trail = {c["accession"]: c["rows"] for c in r["composition"]}
    assert {a: len(v) for a, v in by_accession.items()} == trail == {
        "0000950123-25-005701": 110, "0000950123-25-008361": 4}
    # And the identity is the FILING's, never the envelope's top-level stamp.
    assert set(by_accession) == set(trail)


def test_an_amendment_without_its_base_is_labeled_incomplete():
    """An amendment-only period composes to an INCOMPLETE position list — the F2
    failure one level down. It must be labeled, not read as a full portfolio."""
    files = {iq.COMPANY_TICKERS_URL: MCP_TICKERS.read_bytes()}
    # Serve ONLY the amendment's documents; the base's fetch would 404.
    files.update(_detail_url_map(REAL_DIR, REAL_CIK, MERGE_AMENDMENT_NODASH))
    subs = json.loads(files[
        f"https://data.sec.gov/submissions/CIK{REAL_CIK}.json"].decode())
    recent = subs["filings"]["recent"]
    keep = [i for i, a in enumerate(recent["accessionNumber"])
            if a != "0000950123-25-005701"]          # drop the base filing
    for key, values in list(recent.items()):
        if isinstance(values, list) and len(values) == len(recent["form"]):
            recent[key] = [values[i] for i in keep]
    files[f"https://data.sec.gov/submissions/CIK{REAL_CIK}.json"] = json.dumps(
        subs).encode()

    server = build_server(
        db_path=":memory:", build_id="cong-1", inst_db_path=None,
        sec_client=_clock_client(_FakeSecTransport(files)), now=_now,
    )
    r = _call(server, "inst_filer_holdings", cik=REAL_CIK,
              period="2025-03-31", mode="detail")["results"]
    assert len(r["holdings"]) == 4                    # the amendment alone
    assert r["composition_complete"] is False
    assert "may NOT be the filer's complete quarter-end book" in \
        r["composition_warning"]


# --- composition matrix (QA-r2-F6) ------------------------------------------
# Synthetic periods assembled from the REAL corpus bytes, with only the cover's
# amendment fields rewritten. This exercises the true parse chain (no stubbed
# holdings) across the amendment semantics the pipeline defines.

#: The genuine cover totals of each committed filing, so a synthetic cover is
#: always CONSISTENT with the info table it is paired with. Pairing an
#: amendment's cover (4 entries) with the base's table (110) produced an
#: entry-total mismatch — i.e. a `partial` parse — which silently weakened the
#: composition tests until QA-r3-F3 made completeness strict.
_COVER_TOTALS = {
    MERGE_BASE_NODASH: ("110", "258701144516"),
    MERGE_AMENDMENT_NODASH: ("4", "1106550356"),
}


def _cover_as(amendment_type: str | None, table_src: str,
              amendment_no: int | None = None) -> bytes:
    """A real, schema-valid cover for the table in *table_src*: the genuine BASE
    cover when no amendment type is wanted, otherwise the genuine AMENDMENT
    cover with its ``amendmentType`` VALUE swapped — and in both cases the entry
    and value totals set to those of the table actually being served.
    Re-ordering elements by hand produced a cover the parser read as
    `amendment_type: null`, so nothing is restructured."""
    src = MERGE_BASE_NODASH if amendment_type is None else MERGE_AMENDMENT_NODASH
    xml = (REAL_DIR / f"CIK{REAL_CIK}" / src / "primary_doc.xml").read_text()
    if amendment_type is not None:
        xml = xml.replace("<amendmentType>NEW HOLDINGS</amendmentType>",
                          f"<amendmentType>{amendment_type}</amendmentType>")
        assert f"<amendmentType>{amendment_type}</amendmentType>" in xml
    if amendment_no == "OMIT":
        # `<amendmentNo>` is OPTIONAL on the cover. Its absence is the G-B1
        # trigger, so the fixture must be able to reproduce it.
        import re as _re
        xml = _re.sub(r"<amendmentNo>.*?</amendmentNo>\s*", "", xml, flags=_re.S)
        assert "<amendmentNo>" not in xml
    elif amendment_no is not None:
        # amendmentNo is the pipeline's tiebreak for same-day amendments; the
        # fixture must be able to vary it independently of the accession, or a
        # test claiming they diverge creates no divergence at all.
        xml = xml.replace("<amendmentNo>1</amendmentNo>",
                          f"<amendmentNo>{amendment_no}</amendmentNo>")
        assert f"<amendmentNo>{amendment_no}</amendmentNo>" in xml
    have_entries, have_value = _COVER_TOTALS[src]
    want_entries, want_value = _COVER_TOTALS[table_src]
    xml = xml.replace(f"<tableEntryTotal>{have_entries}</tableEntryTotal>",
                      f"<tableEntryTotal>{want_entries}</tableEntryTotal>")
    xml = xml.replace(f"<tableValueTotal>{have_value}</tableValueTotal>",
                      f"<tableValueTotal>{want_value}</tableValueTotal>")
    return xml.encode()


def _period_files(filings, *, break_table_for=()):
    """A URL map for one filer whose period is composed of *filings*:
    (accession_dashed, form, filed_date, source_nodash, amendment_type|None)."""
    cik, files = REAL_CIK, {}
    recent = {"form": [], "accessionNumber": [], "reportDate": [], "filingDate": [],
              "primaryDocument": [], "items": [], "size": [], "isXBRL": []}
    for spec in filings:
        acc, form, filed, src_nodash, amd = spec[:5]
        amd_no = spec[5] if len(spec) > 5 else None
        nodash = acc.replace("-", "")
        base = f"https://www.sec.gov/Archives/edgar/data/{int(cik)}/{nodash}"
        src = REAL_DIR / f"CIK{cik}" / src_nodash
        table = discover_info_table_name((src / "index.json").read_bytes())
        files[f"{base}/index.json"] = (src / "index.json").read_bytes()
        files[f"{base}/primary_doc.xml"] = _cover_as(amd, src_nodash, amd_no)
        files[f"{base}/{table}"] = (
            b"<not-xml" if acc in break_table_for else (src / table).read_bytes()
        )
        recent["form"].append(form); recent["accessionNumber"].append(acc)
        recent["reportDate"].append("2025-03-31"); recent["filingDate"].append(filed)
        for k in ("primaryDocument", "items", "size", "isXBRL"):
            recent[k].append("")
    files[f"https://data.sec.gov/submissions/CIK{cik}.json"] = json.dumps(
        {"cik": cik, "name": "BERKSHIRE HATHAWAY INC",
         "filings": {"recent": recent, "files": []}}).encode()
    return files


def _detail(files, **kw):
    server = build_server(
        db_path=":memory:", build_id="cong-1", inst_db_path=None,
        sec_client=_clock_client(_FakeSecTransport(files)), now=_now, **kw)
    return _call(server, "inst_filer_holdings", cik=REAL_CIK,
                 period="2025-03-31", mode="detail")["results"]


BASE = ("0000950123-25-005701", "13F-HR", "2025-05-15", MERGE_BASE_NODASH, None)
AMEND = ("0000950123-25-008361", "13F-HR/A", "2025-08-14",
         MERGE_AMENDMENT_NODASH, "NEW HOLDINGS")


def test_a_standalone_restatement_is_complete_not_flagged_incomplete():
    """QA-r2-F4: a RESTATEMENT supersedes in full, so it is authoritative BY
    ITSELF. Deriving completeness from an 'applied == base' label wrongly warned
    that a full restatement was an incomplete portfolio."""
    r = _detail(_period_files([
        ("0000950123-25-009999", "13F-HR/A", "2025-09-01",
         MERGE_BASE_NODASH, "RESTATEMENT")]))
    assert r["composition_complete"] is True
    assert "composition_warning" not in r
    assert len(r["holdings"]) == 110
    assert "restatement" in r["composition"][0]["applied"]


def test_a_restatement_replaces_the_base_rather_than_adding_to_it():
    """RESTATEMENT semantics: replacement, never accumulation."""
    r = _detail(_period_files([
        BASE,
        ("0000950123-25-009999", "13F-HR/A", "2025-09-01",
         MERGE_AMENDMENT_NODASH, "RESTATEMENT")]))
    assert len(r["holdings"]) == 4          # the restatement ALONE, not 114
    assert r["composition_complete"] is True


def test_a_failed_base_does_not_make_an_amendment_look_complete():
    """QA-r2-F4: an unparseable base contributes no rows, so a clean NEW
    HOLDINGS amendment on top of it is still an INCOMPLETE portfolio — and the
    composed parse_status must not report the last filing's clean 'parsed'."""
    r = _detail(_period_files([BASE, AMEND], break_table_for={BASE[0]}))
    assert r["composition_complete"] is False
    assert "may NOT be the filer's complete quarter-end book" in \
        r["composition_warning"]
    # QA-r2-F5: the clean amendment must not mask the failed base.
    assert r["parse_status"] != "parsed"
    assert [c["parse_status"] for c in r["composition"]][0] == "failed"
    assert r["last_filing_parse_status"] == "parsed"


def test_an_unknown_amendment_type_cannot_establish_completeness():
    """An amendment whose merge semantic is UNSTATED is taken as authoritative
    but must not be claimed complete — we do not know what it replaced."""
    r = _detail(_period_files([
        BASE,
        ("0000950123-25-009998", "13F-HR/A", "2025-09-02",
         MERGE_AMENDMENT_NODASH, "SOMETHING ELSE")]))
    assert r["composition_complete"] is False
    assert "unstated type" in r["composition"][-1]["applied"]


def test_composition_applies_in_filed_order_not_discovery_order():
    """Discovery order must not decide semantics: the base filed FIRST is
    applied first even when SEC lists the amendment ahead of it."""
    r = _detail(_period_files([AMEND, BASE]))        # amendment listed first
    assert [c["filed_date"] for c in r["composition"]] == \
        ["2025-05-15", "2025-08-14"]
    assert len(r["holdings"]) == 114


def test_main_forwards_every_resolved_value_to_the_server(monkeypatch, tmp_path):
    """QA-r2-F2, hardened after it RECURRED (QA-VERIFY-BLOCKER-2).

    `main()` once dropped `inst_from_published_manifest`, so a fix that worked in
    tests was inert in production. This guard was written to catch that class —
    and then failed to, because it iterated a HARD-CODED literal `resolved` dict:
    a newly-added key (`inst_stale_withdrawal_pending`) was absent from the
    literal, so the guard could not notice it was being dropped, and the same bug
    shipped again.

    The key set now comes from the REAL `_resolve_snapshot()` output, so any key
    the resolver learns to produce must be forwarded or this fails.
    """
    import inspect
    import sys

    from populus.mcp_server import server as srv_mod

    # A real resolver run over a real published snapshot — not a literal.
    db = seed_db_for_resolver(tmp_path)
    monkeypatch.setattr(sys, "argv", ["populus-mcp", "--db", str(db)])
    real_resolved = srv_mod._resolve_snapshot()
    assert real_resolved, "the resolver produced nothing to check"
    # Capture the REAL signature before build_server is monkeypatched away.
    real_params = set(inspect.signature(srv_mod.build_server).parameters)

    seen = {}

    class _Srv:
        def run(self):
            pass

    monkeypatch.setattr(srv_mod, "_resolve_snapshot", lambda: dict(real_resolved))
    monkeypatch.setattr(srv_mod, "_build_sec_client", lambda: None)
    monkeypatch.setattr(srv_mod, "build_server",
                        lambda **kw: (seen.update(kw), _Srv())[1])
    srv_mod.main()

    for key, value in real_resolved.items():
        assert key in seen, f"main() dropped {key!r} — it never reaches the server"
        assert seen[key] == value, f"main() altered {key!r}"

    # And every one of those keys must be a parameter build_server accepts, so a
    # resolver key cannot be forwarded into a silently-ignored **kwargs.
    for key in real_resolved:
        assert key in real_params, f"build_server does not accept {key!r}"


def seed_db_for_resolver(tmp_path) -> Path:
    """A minimal congress DB so `--db` resolution succeeds without a snapshot."""
    from populus.db import init_db

    path = tmp_path / "congress.db"
    init_db(str(path))
    return path


def test_published_resolution_marks_provenance_and_absence_honestly(monkeypatch):
    """The two resolver states that drive every coverage claim: a verified
    manifest that INCLUDES inst is published-provenance; one that OMITS it is
    the only state allowed to say the gate withheld it (QA-r2-F2/F3)."""
    from populus.mcp_server import server as srv_mod

    class _Client:
        def __init__(self, *a, module=None, **kw):
            self.module = module
        def refresh(self):
            # Mirror the REAL client: a verified manifest that omits the module
            # reports it on the result, and `current_manifest()` is then None.
            from populus.client.snapshot import RefreshResult

            if self.module == "inst" and MODULES is not None and "inst" not in MODULES:
                return RefreshResult("withdrawn", None, None, "withheld",
                                     verified_omission=True)
            return RefreshResult("installed", "b", 1, "ok")
        def current_build(self):
            return "inst-7" if self.module == "inst" else "cong-7"
        def current_manifest(self):
            # None once withdrawn — exactly as the real client behaves.
            if self.module == "inst" and (MODULES is None or "inst" not in MODULES):
                return None
            return None if MODULES is None else {"modules": dict(MODULES)}
        def db_path(self):
            if self.module is None:
                return Path("c.db")
            return Path("i.db") if MODULES and "inst" in MODULES else None
        def serving_db_path(self):
            # QA M2-8: this used to `return None` unconditionally, so the
            # assertion below ("the serving projection did NOT resolve") held no
            # matter what the production logic did — inverting `snapshot.py`
            # left it green. It now applies the REAL rule: the MANIFEST is the
            # authority, and the artifact resolves only when the module
            # enumerates it by name.
            manifest = self.current_manifest()
            if manifest is None:
                return None
            entries = manifest.get("modules", {}).get(self.module, {}).get("artifacts")
            if not isinstance(entries, list):
                return None
            if not any(
                isinstance(e, dict) and e.get("name") == "inst_serving.db"
                for e in entries
            ):
                return None
            return Path("i_serving.db")

    monkeypatch.setattr(sys, "argv", ["populus-mcp"])
    monkeypatch.setattr("populus.client.snapshot.SnapshotClient", _Client)
    monkeypatch.setattr("populus.client.snapshot.LocalRepoFetcher",
                        lambda *a, **k: None)

    MODULES = {"congress": {}, "inst": {"watermarks": {}}}
    present = srv_mod._resolve_snapshot()
    assert present["inst_from_published_manifest"] is True
    assert present["inst_absent_reason"] is None
    # The aggregate resolved; the serving projection did NOT. The two artifacts
    # are resolved independently, so this state must be reported as itself — the
    # aggregate's path must never be handed over as the serving one (R10).
    assert present["inst_serving_db_path"] is None
    assert "inst_serving.db" in present["inst_serving_absent_reason"]
    assert "NOT used in its place" in present["inst_serving_absent_reason"]

    # The OTHER direction, which no test exercised: a manifest that DOES
    # enumerate the serving artifact must resolve it, and must not report an
    # absence reason. Without this case the assertions above are satisfied by a
    # resolver that can only ever answer None.
    MODULES = {
        "congress": {},
        "inst": {
            "watermarks": {},
            "artifacts": [
                {"name": "inst_agg.db"},
                {"name": "inst_serving.db"},
            ],
        },
    }
    published = srv_mod._resolve_snapshot()
    assert published["inst_serving_db_path"] is not None, (
        "a manifest enumerating the serving artifact must resolve it")
    assert published["inst_serving_absent_reason"] is None
    assert published["inst_serving_db_path"] != published["inst_db_path"], (
        "the aggregate's path was handed over as the serving one (R10)")

    MODULES = {"congress": {}}                      # gate withheld inst
    absent = srv_mod._resolve_snapshot()
    assert absent["inst_from_published_manifest"] is False
    assert absent["inst_absent_gate_withheld"] is True
    assert "withheld it" in absent["inst_absent_reason"]

    # No verified manifest at all (fetch/verification failed): the module is
    # absent, but NO gate decision was observed — claiming one would report a
    # decision that never happened.
    MODULES = None
    failed = srv_mod._resolve_snapshot()
    assert failed["inst_from_published_manifest"] is False
    assert failed["inst_absent_gate_withheld"] is False
    assert "resolution failure" in failed["inst_absent_reason"]
    assert "withheld" not in failed["inst_absent_reason"]


def _table_with_entry_total_mismatch(nodash: str) -> bytes:
    """The real info table with one holding removed, so the cover's declared
    entry total no longer matches — the canonical `partial` trigger."""
    src = REAL_DIR / f"CIK{REAL_CIK}" / nodash
    table = discover_info_table_name((src / "index.json").read_bytes())
    xml = (src / table).read_text()
    start = xml.index("<infoTable>")
    end = xml.index("</infoTable>", start) + len("</infoTable>")
    return (xml[:start] + xml[end:]).encode()


def test_a_partial_base_cannot_vouch_for_a_complete_portfolio():
    """QA-r3-F3: `partial` means parse defects or an entry-total mismatch — the
    filing may be MISSING positions. Accepting anything that merely is not
    `failed` let a defective base suppress the incomplete-composition warning."""
    files = _period_files([BASE])
    base_url = (f"https://www.sec.gov/Archives/edgar/data/{int(REAL_CIK)}"
                f"/{BASE[0].replace('-', '')}/form13fInfoTable.xml")
    files[base_url] = _table_with_entry_total_mismatch(MERGE_BASE_NODASH)
    r = _detail(files)

    assert r["parse_status"] == "partial"
    assert r["composition_complete"] is False, (
        "a partial base was accepted as a complete portfolio"
    )
    assert "may NOT be the filer's complete quarter-end book" in \
        r["composition_warning"]
    # Its rows are still returned — degraded, but not discarded (G3).
    assert len(r["holdings"]) == 109


def test_a_historical_period_only_in_an_older_shard_is_reachable():
    """QA-r3-F4: SEC keeps only a recent window inline and pushes older filings
    into `filings.files[]` shards. Discovery counted those shards but never read
    them, so an explicitly-requested historical period returned a FALSE 'no
    13F-HR at that period'. R4 promises arbitrary per-filer detail."""
    shard_name = f"CIK{REAL_CIK}-submissions-001.json"
    files = _period_files([BASE])
    subs_url = f"https://data.sec.gov/submissions/CIK{REAL_CIK}.json"
    subs = json.loads(files[subs_url].decode())
    # Move the only filing OUT of `recent` and into an older shard.
    shard = {"filings": {"recent": subs["filings"]["recent"]}}
    empty = {k: [] for k in subs["filings"]["recent"]}
    subs["filings"] = {"recent": empty, "files": [{"name": shard_name}]}
    files[subs_url] = json.dumps(subs).encode()
    files[f"https://data.sec.gov/submissions/{shard_name}"] = json.dumps(
        shard["filings"]["recent"]).encode()

    r = _detail(files)
    assert len(r["holdings"]) == 110, "the historical filing was not reachable"
    assert r["period_of_report"] == "2025-03-31"


def test_an_unreadable_shard_makes_the_not_found_error_say_so():
    """A shard that cannot be read means the history was searched INCOMPLETELY;
    claiming the filing does not exist would be an unearned assertion (G3)."""
    files = _period_files([BASE])
    subs_url = f"https://data.sec.gov/submissions/CIK{REAL_CIK}.json"
    subs = json.loads(files[subs_url].decode())
    subs["filings"]["files"] = [{"name": f"CIK{REAL_CIK}-submissions-001.json"}]
    files[subs_url] = json.dumps(subs).encode()   # the shard itself 404s

    server = build_server(
        db_path=":memory:", build_id="c", inst_db_path=None,
        sec_client=_clock_client(_FakeSecTransport(files)), now=_now)
    e = _call(server, "inst_filer_holdings", cik=REAL_CIK,
              period="2019-06-30", mode="detail")
    err = e["results"]["error"]
    assert "searched INCOMPLETELY" in err
    assert "could not be read" in err


def test_no_filings_plus_unread_history_does_not_assert_none_exist():
    """QA-r4-F3: an empty `recent` set with unreadable shards means we did not
    look everywhere. Saying 'no 13F-HR filings found' would assert a fact the
    search never established (G3)."""
    files = _period_files([BASE])
    subs_url = f"https://data.sec.gov/submissions/CIK{REAL_CIK}.json"
    subs = json.loads(files[subs_url].decode())
    subs["filings"] = {
        "recent": {k: [] for k in subs["filings"]["recent"]},
        "files": [{"name": f"CIK{REAL_CIK}-submissions-001.json"}],  # 404s
    }
    files[subs_url] = json.dumps(subs).encode()

    server = build_server(
        db_path=":memory:", build_id="c", inst_db_path=None,
        sec_client=_clock_client(_FakeSecTransport(files)), now=_now)
    err = _call(server, "inst_filer_holdings", cik=REAL_CIK,
                mode="detail")["results"]["error"]
    assert "searched INCOMPLETELY" in err
    assert "may still have 13F filings that were not searched" in err


def test_a_found_period_with_unread_history_is_not_called_complete():
    """QA-r4-F3: an unread shard could hold an amendment for THIS period, so a
    successfully-composed base is still not an exhaustive answer."""
    files = _period_files([BASE])
    subs_url = f"https://data.sec.gov/submissions/CIK{REAL_CIK}.json"
    subs = json.loads(files[subs_url].decode())
    subs["filings"]["files"] = [{"name": f"CIK{REAL_CIK}-submissions-001.json"}]
    files[subs_url] = json.dumps(subs).encode()   # the shard 404s

    r = _detail(files)
    assert len(r["holdings"]) == 110               # the base still answers
    assert r["history_complete"] is False
    assert r["composition_complete"] is False, (
        "an incompletely-searched history was presented as exhaustive"
    )
    assert "amendment for this period may have been missed" in \
        r["composition_warning"]
    assert r["unread_shards"] == [f"CIK{REAL_CIK}-submissions-001.json"]


def test_snapshot_profile_separates_all_period_totals_from_the_quarter(server):
    """QA-r5-F4: `agg_filer_registry` accumulates over EVERY retained period, so
    presenting `position_count` beside a requested `period_of_report` invited
    reading lifetime totals as that quarter's. The registry figures are now
    prefixed and labeled, and the quarter's own figures are returned separately."""
    r = _call(server, "inst_filer_holdings", cik=BRK,
              period="2025-12-31")["results"]
    filer = r["filer"]
    assert "position_count" not in filer, "an all-period total is unlabeled"
    assert filer["all_periods_position_count"] == 4     # 2 quarters x 2 rows
    assert "NOT a single quarter" in filer["counts_basis"]

    # The requested quarter's own figures stand on their own.
    assert r["period"]["period_of_report"] == "2025-12-31"
    assert r["period"]["position_count"] == 2
    assert r["period"]["total_value_usd"] == 1500        # 1000 + 500
    assert "quarter-end market value" in r["period"]["value_label"]

    # A different quarter gives different quarter figures, same registry totals.
    q1 = _call(server, "inst_filer_holdings", cik=BRK,
               period="2026-03-31")["results"]
    assert q1["period"]["total_value_usd"] == 2300       # 2000 + 300
    assert q1["filer"]["all_periods_position_count"] == 4


def test_a_period_with_no_data_is_not_a_valid_empty_profile(server):
    """QA-r5-F4: a nonexistent quarter returned a successful profile with a null
    concentration and no hint — indistinguishable from a real empty quarter."""
    r = _call(server, "inst_filer_holdings", cik=BRK,
              period="2019-06-30")["results"]
    assert r["period"] is None and r["concentration"] is None
    assert "no institutional data" in r["hint"]
    assert "2026-03-31" in r["hint"] and "2025-12-31" in r["hint"]


def test_a_rejected_amendment_makes_the_answer_incomplete():
    """QA-r5-F3: a filing rejected at discovery (malformed accession, non-ISO
    dates) is as invisible to this answer as an unread shard — it could be the
    very amendment that restates the period. Only unread SHARDS counted before."""
    files = _period_files([BASE])
    subs_url = f"https://data.sec.gov/submissions/CIK{REAL_CIK}.json"
    subs = json.loads(files[subs_url].decode())
    recent = subs["filings"]["recent"]
    # A same-period amendment whose accession is malformed → discovery rejects it.
    recent["form"].append("13F-HR/A")
    recent["accessionNumber"].append("not-an-accession")
    recent["reportDate"].append("2025-03-31")
    recent["filingDate"].append("2025-09-01")
    for k in ("primaryDocument", "items", "size", "isXBRL"):
        recent[k].append("")
    files[subs_url] = json.dumps(subs).encode()

    r = _detail(files)
    assert len(r["holdings"]) == 110                # the base still answers
    assert r["rejected_filings"] == ["not-an-accession"]
    assert r["history_complete"] is False
    assert r["composition_complete"] is False, (
        "a rejected same-period amendment was ignored when claiming completeness"
    )
    assert "rejected at discovery" in r["composition_warning"]


def test_both_health_tools_agree_in_the_absent_state(absent_server):
    """QA-VERIFY-N-h: `inst_health` returned no caveats when the module was
    absent while `populus_health`'s detail block did — the two tools disagreed
    about the same state."""
    inst = _call(absent_server, "inst_health")["results"]
    platform = _call(absent_server, "populus_health")["results"]
    detail = platform["module_detail"]["inst"]
    assert inst["present"] is False and detail["present"] is False
    assert inst["caveats"], "inst_health reported absence with no caveats"
    assert inst["caveats"] == detail["caveats"], "the health tools disagree"


@pytest.mark.parametrize("call", [
    lambda s: _call(s, "inst_filer_holdings", cik=BRK, period="2026-03-31"),
    lambda s: _call(s, "inst_filer_holdings", cik=BRK, mode="qoq"),
    lambda s: _call(s, "inst_biggest_moves", side="new"),
    lambda s: _call(s, "inst_ticker_holders", ticker="AAPL"),
    lambda s: _call(s, "inst_filer_lookup", query="Berkshire"),
])
def test_every_aggregate_response_carries_a_filing_level_date(server, call):
    """G4 / QA-VERIFY-N-i: the failure-mode sweep claims 'both dates on every
    record', but only `inst_ticker_holders` disclosed a filing-level date; the
    snapshot, qoq and biggest-moves paths carried only the period. The aggregate
    has no per-row filed date, so the honest disclosure is the build watermark —
    the same one ticker_holders already used."""
    results = call(server)["results"]
    assert "filed_through" in results, "no filing-level date on an aggregate response"
    assert results["filed_through"] == "2026-05-15"


def _cover_without_amendment_flag(amendment_type: str | None = "NEW HOLDINGS") -> bytes:
    """The real amendment cover with `<isAmendment>` REMOVED — absence is the
    normal case (real base covers carry no such element)."""
    import re

    xml = (REAL_DIR / f"CIK{REAL_CIK}" / MERGE_AMENDMENT_NODASH
           / "primary_doc.xml").read_text()
    xml = re.sub(r"<isAmendment>.*?</isAmendment>\s*", "", xml, flags=re.S)
    if amendment_type is None:
        xml = re.sub(r"<amendmentType>.*?</amendmentType>\s*", "", xml, flags=re.S)
    assert "<isAmendment>" not in xml
    return xml.encode()


def test_the_edgar_form_decides_amendment_ness_not_the_self_declared_cover():
    """QA-VERIFY3-B1: composition keyed off the cover's self-declared
    `<isAmendment>`. A `13F-HR/A` whose cover omits that element was composed as
    a BASE — which REPLACES the composed list — so Berkshire's 4-row NEW HOLDINGS
    amendment came back as its COMPLETE 2025-Q1 portfolio, and the response
    affirmatively claimed `composition_complete: True`. That is QA-F2 through a
    second door, and worse: the original bug never asserted completeness.

    The EDGAR submission type is authoritative and was in hand the whole time —
    discovery filters on it.
    """
    files = _period_files([BASE, AMEND])
    amd_url = (f"https://www.sec.gov/Archives/edgar/data/{int(REAL_CIK)}"
               f"/{AMEND[0].replace('-', '')}/primary_doc.xml")
    files[amd_url] = _cover_without_amendment_flag()

    r = _detail(files)
    assert len(r["holdings"]) == 114, (
        f"the amendment replaced the base: {len(r['holdings'])} rows"
    )
    trail = r["composition"]
    assert trail[0]["applied"] == "base"
    assert "added to the base" in trail[1]["applied"]
    assert trail[1]["is_amendment_applied"] is True


def test_a_form_declared_amendment_with_no_type_cannot_claim_completeness():
    """The same cover with BOTH the flag and the type removed: the form says
    amendment, the cover says nothing. Merge semantics are unknown, so it is
    taken as authoritative and labelled — never claimed complete."""
    files = _period_files([BASE, AMEND])
    amd_url = (f"https://www.sec.gov/Archives/edgar/data/{int(REAL_CIK)}"
               f"/{AMEND[0].replace('-', '')}/primary_doc.xml")
    files[amd_url] = _cover_without_amendment_flag(amendment_type=None)

    r = _detail(files)
    assert r["composition_complete"] is False
    assert "unstated type" in r["composition"][-1]["applied"]


def test_two_non_amendment_filings_for_one_period_are_not_called_complete():
    """QA-VERIFY3-B1 sub-case: the later one silently REPLACED the earlier and
    the answer still claimed completeness. Supersession is not stated by the
    filings, so it must not be guessed."""
    second = ("0000950123-25-005702", "13F-HR", "2025-06-01",
              MERGE_AMENDMENT_NODASH, None)
    r = _detail(_period_files([BASE, second]))
    assert r["composition_complete"] is False
    assert "supersession is unstated" in r["composition"][-1]["applied"]


def test_a_failed_first_base_does_not_let_a_second_base_claim_completeness():
    """QA-VERIFY4-B1: the duplicate-base guard was gated on the composed list
    being non-empty, so a first `13F-HR` that parsed to ZERO rows skipped it
    entirely — and the second base then returned 4 of ~110 positions with
    `composition_complete: True` and NO warning. Worse than the original QA-F2,
    which never asserted completeness.

    The shipped guard test only covered a cleanly-parsing first base, so it
    passed with and without the fix."""
    second = ("0000950123-25-005702", "13F-HR", "2025-06-01",
              MERGE_AMENDMENT_NODASH, None)
    r = _detail(_period_files([BASE, second], break_table_for={BASE[0]}))

    assert r["composition_complete"] is False, (
        f"{len(r['holdings'])} rows claimed as a complete portfolio"
    )
    assert "supersession is unstated" in r["composition"][-1]["applied"]
    assert "may NOT be the filer's complete quarter-end book" in \
        r["composition_warning"]
    assert [c["applied"] for c in r["composition"]] != ["base", "base"]


def test_ticker_holders_only_claims_truncation_when_it_truncated(server):
    """QA-VERIFY4-B2 + F-N8. The published aggregate keeps only a top-N slice per
    issuer per quarter (default 25) and records N in `agg_build_meta` "so the
    cut is legible" — nothing read it, so the flagship "biggest holders" answer
    was a silent slice. But the first fix then declared EVERY response
    "TRUNCATED at 25" even when 2 rows came back below the cut — a caveat
    contradicting its own payload, the very class it was written to fix."""
    # Fixture has 2 AAPL holders: below both cuts, so nothing is truncated.
    full = _call(server, "inst_ticker_holders", ticker="AAPL", limit=200)["results"]
    assert full["published_topn"] == 25
    assert full["requested_limit"] == 200
    assert full["returned"] == 2
    assert full["truncated"] is False
    assert full["holders_are_top_n"] is False
    assert "All 2 holders" in full["truncation_note"]
    assert "TRUNCATED" not in full["truncation_note"]

    # limit=1 genuinely cuts, and the LIMIT is what governed — not the top-N.
    cut = _call(server, "inst_ticker_holders", ticker="AAPL", limit=1)["results"]
    assert cut["truncated"] is True
    assert cut["effective_cut"] == 1
    assert cut["cut_governed_by"] == "the `limit` you passed"
    assert "TRUNCATED at 1" in cut["truncation_note"]
    assert "regardless" not in cut["truncation_note"]


def test_the_concentration_block_states_which_n_its_top_n_fields_cover(server):
    """The same gap on the snapshot profile: `topn_value_usd`/`topn_share_bps`
    were returned with N stated nowhere, so a top-10 share and a top-25 share
    were indistinguishable."""
    r = _call(server, "inst_filer_holdings", cik=BRK, period="2026-03-31")["results"]
    conc = r["concentration"]
    # The published cut is 25, but this filer holds 2 positions that quarter —
    # so the topn_* fields cover 2, and saying "largest 25" would overstate
    # what they summarize (G-N4). Both numbers are reported.
    assert conc["published_topn"] == 25
    assert conc["topn"] == r["period"]["position_count"] == 2
    assert "largest 2 position(s)" in conc["topn_label"]
    assert "published cut is 25" in conc["topn_label"]
    # G-N5: the HHI scale is stated; 8200 is unreadable as 0-1 / 0-100 / 0-10000.
    assert "0–10000" in conc["hhi_scale"]


def test_a_live_federated_response_is_never_stamped_stale(agg_path):
    """QA-VERIFY4-N1: the STALE prefix was applied to EVERY inst response,
    including `mode='detail'`, which is freshly fetched and carries a
    `live_source`. That put two contradictory provenance claims in one
    data_note — it errs safe, but it mislabels the one plane that IS fresh."""
    files = {iq.COMPANY_TICKERS_URL: MCP_TICKERS.read_bytes()}
    files.update(_detail_url_map(REAL_DIR, REAL_CIK, REAL_2026Q1_NODASH))
    srv = build_server(
        db_path=":memory:", build_id="cong-1",
        inst_db_path=agg_path, inst_build_id="inst-1",
        inst_from_published_manifest=True,
        inst_stale_withdrawal_pending=True,
        sec_client=_clock_client(_FakeSecTransport(files)), now=_now,
    )
    live = _call(srv, "inst_filer_holdings", cik=REAL_CIK, mode="detail")
    assert "live_source" in live and "build_id" not in live
    assert "STALE" not in live["data_note"], "a live fetch was labelled stale"
    # The snapshot plane still carries it.
    snap = _call(srv, "inst_health")
    assert "STALE" in snap["data_note"]


def test_the_unverified_bypass_caveat_reaches_the_data_plane(agg_path):
    """QA-VERIFY4-N3: with `--inst-db`, health said "UNVERIFIED SOURCE … NO
    coverage guarantee applies" while data responses carried an unmodified note.
    The non-removable note exists so a response lifted out of context keeps its
    caveats."""
    srv = build_server(
        db_path=":memory:", build_id="cong-1",
        inst_db_path=agg_path, inst_build_id=None,
        inst_from_published_manifest=False, now=_now,
    )
    e = _call(srv, "inst_filer_lookup", query="Berkshire")
    assert "UNVERIFIED SOURCE" in e["data_note"]
    assert "NO coverage guarantee" in e["data_note"]


def test_a_same_day_amendment_is_additive_regardless_of_accession_order():
    """QA-VERIFY5-B1: `filing_date` is date-only, so a base and its amendment
    filed the SAME DAY were ordered by accession — a filing agent's prefix, not
    a clock. When the amendment sorted first, the fold applied it and then the
    base's assignment DISCARDED its rows, returning 110 of 114 positions while
    the trail still said "added to the base filing" and
    `composition_complete: True`. The 4 discarded rows are the
    confidential-treatment releases that are the entire reason NEW HOLDINGS
    exists.

    Composition is now order-independent: NEW HOLDINGS is additive whenever it
    is applied, and same-day ties break base-before-amendment."""
    same_day_amendment = ("0000000123-25-000001", "13F-HR/A", "2025-05-15",
                          MERGE_AMENDMENT_NODASH, "NEW HOLDINGS")
    r = _detail(_period_files([BASE, same_day_amendment]))

    assert len(r["holdings"]) == 114, (
        f"the amendment's rows were discarded: {len(r['holdings'])}"
    )
    assert r["composition_complete"] is True
    # The base is applied first despite sorting later by accession.
    assert [c["applied"] for c in r["composition"]][0] == "base"
    assert "added to the base filing" in r["composition"][1]["applied"]


def test_a_later_restatement_supersedes_an_earlier_new_holdings_amendment():
    """A RESTATEMENT replaces everything filed before it — including an earlier
    additive amendment. Order-independent classification must not blindly add
    every NEW HOLDINGS row."""
    early_amendment = ("0000950123-25-006000", "13F-HR/A", "2025-06-01",
                       MERGE_AMENDMENT_NODASH, "NEW HOLDINGS")
    later_restatement = ("0000950123-25-007000", "13F-HR/A", "2025-07-01",
                         MERGE_BASE_NODASH, "RESTATEMENT")
    r = _detail(_period_files([BASE, early_amendment, later_restatement]))

    assert len(r["holdings"]) == 110, "the superseded amendment was still added"
    assert r["composition_complete"] is True
    trail = {c["accession"]: c["applied"] for c in r["composition"]}
    assert "superseded by a later restatement" in trail["0000950123-25-006000"]
    assert "replaced everything filed before it" in trail["0000950123-25-007000"]


def test_a_new_holdings_amendment_after_a_restatement_still_adds():
    """The mirror case: an additive amendment filed AFTER the restatement is not
    superseded and must still be added."""
    restatement = ("0000950123-25-006000", "13F-HR/A", "2025-06-01",
                   MERGE_BASE_NODASH, "RESTATEMENT")
    later_amendment = ("0000950123-25-007000", "13F-HR/A", "2025-07-01",
                       MERGE_AMENDMENT_NODASH, "NEW HOLDINGS")
    r = _detail(_period_files([BASE, restatement, later_amendment]))

    assert len(r["holdings"]) == 114
    assert r["composition_complete"] is True


def test_filer_lookup_discloses_truncation_and_its_ranking_basis(server):
    """QA-VERIFY5-B4: the documented entry point for every other inst tool
    truncated at `limit` with no total, no flag and no note — against the real
    ~5,000-filer registry, "Capital" matches hundreds and filer #26 was
    indistinguishable from not existing. The ranking is also by value summed
    across ALL retained periods, which was never stated."""
    r = _call(server, "inst_filer_lookup", query="A", limit=1)["results"]
    assert r["returned"] == 1
    assert r["total_matches"] >= 2
    assert r["truncated"] is True
    assert "filers match" in r["truncation_note"]
    assert "ALL" in r["ranking_basis"] and "retained periods" in r["ranking_basis"]

    full = _call(server, "inst_filer_lookup", query="A", limit=100)["results"]
    assert full["truncated"] is False
    assert "truncation_note" not in full


def test_the_qoq_response_states_the_delta_universe(server):
    """QA-VERIFY5-B3: positions with no usable identity key never enter
    `agg_qoq_deltas`, so `changes` can be a tiny fraction of the book — with no
    denominator, no count and no note, a 99.99%-unkeyed filer read as making one
    change all quarter."""
    r = _call(server, "inst_filer_holdings", cik=BRK, mode="qoq")["results"]
    universe = r["delta_universe"]
    assert universe["changes_returned"] == len(r["changes"])
    assert universe["period_position_count"] is not None
    assert "far smaller than the book" in universe["note"]


def test_flow_tools_say_new_and_exit_are_not_trades(server):
    """QA-VERIFY5-B3: `new`/`exit` are trading verbs applied to a set
    difference. A position also vanishes on an acquisition, a 13(f)-list change,
    confidential treatment, an affiliated-filer migration, or a re-keying that
    manufactures a PAIRED phantom exit and new."""
    for call in (
        lambda: _call(server, "inst_filer_holdings", cik=BRK, mode="qoq"),
        lambda: _call(server, "inst_biggest_moves", side="exit"),
    ):
        note = call()["data_note"]
        assert "NOT that it was bought or sold" in note
        assert "phantom exit" in note


def test_the_counts_basis_caveat_has_no_dangling_pointer(server):
    """A caveat that points at a key the response does not contain invites a
    client to invent one (QA-VERIFY5-B4)."""
    r = _call(server, "inst_filer_lookup", query="Berkshire")["results"]
    basis = r["matches"][0]["counts_basis"]
    assert "period" in basis
    assert "mode='snapshot'" in basis, "the pointer must name where `period` lives"
    assert "period" not in r, "the caveat referenced a key this response lacks"


# =============================================================================
# Composition truth table (QA-VERIFY6).
#
# Six review rounds found composition defects one door at a time: a misread
# cover flag, an empty first base, a same-day accession tie, an unreadable
# additive, a reassignment that discarded rows, an ordering key that disagreed
# with the pipeline. Every one of them is a ROW in this table. The table is the
# specification: (bases, restatements, additives, unknowns) x parse status x
# filed-date ties -> holdings, composition_complete, and the reason set.
# =============================================================================

def _f(acc, form, filed, src, amd, *, broken=False):
    return (acc, form, filed, src, amd, broken)


def _compose(filings):
    """Drive the real federated composition over a synthetic filing set."""
    plain = [(x[0], x[1], x[2], x[3], x[4],
              *( [x[6]] if len(x) > 6 else [] )) for x in filings]
    broken = {x[0] for x in filings if x[5]}
    return _detail(_period_files(plain, break_table_for=broken))


BASE_ROWS, AMD_ROWS = 110, 4
B = MERGE_BASE_NODASH
A = MERGE_AMENDMENT_NODASH


@pytest.mark.parametrize("label,filings,rows,complete,reason_fragment", [
    # --- the ordinary shapes -------------------------------------------------
    ("base only",
     [_f("0000950123-25-005701", "13F-HR", "2025-05-15", B, None)],
     BASE_ROWS, True, None),
    ("base + NEW HOLDINGS",
     [_f("0000950123-25-005701", "13F-HR", "2025-05-15", B, None),
      _f("0000950123-25-008361", "13F-HR/A", "2025-08-14", A, "NEW HOLDINGS")],
     BASE_ROWS + AMD_ROWS, True, None),
    ("base + later RESTATEMENT (the commonest amendment shape)",
     [_f("0000950123-25-005701", "13F-HR", "2025-05-15", B, None),
      _f("0000950123-25-009999", "13F-HR/A", "2025-09-01", A, "RESTATEMENT")],
     AMD_ROWS, True, None),
    ("standalone RESTATEMENT",
     [_f("0000950123-25-009999", "13F-HR/A", "2025-09-01", B, "RESTATEMENT")],
     BASE_ROWS, True, None),

    # --- ordering must not decide semantics (E-B1, F-B3) ---------------------
    ("same-day base + NEW HOLDINGS, amendment sorts first by accession",
     [_f("0000950123-25-005701", "13F-HR", "2025-05-15", B, None),
      _f("0000000123-25-000001", "13F-HR/A", "2025-05-15", A, "NEW HOLDINGS")],
     BASE_ROWS + AMD_ROWS, True, None),
    ("NEW HOLDINGS filed before a later RESTATEMENT is superseded",
     [_f("0000950123-25-005701", "13F-HR", "2025-05-15", B, None),
      _f("0000950123-25-006000", "13F-HR/A", "2025-06-01", A, "NEW HOLDINGS"),
      _f("0000950123-25-007000", "13F-HR/A", "2025-07-01", B, "RESTATEMENT")],
     BASE_ROWS, True, None),
    ("NEW HOLDINGS filed after a RESTATEMENT still adds",
     [_f("0000950123-25-005701", "13F-HR", "2025-05-15", B, None),
      _f("0000950123-25-006000", "13F-HR/A", "2025-06-01", B, "RESTATEMENT"),
      _f("0000950123-25-007000", "13F-HR/A", "2025-07-01", A, "NEW HOLDINGS")],
     BASE_ROWS + AMD_ROWS, True, None),

    # --- parse failures anywhere block the completeness claim (F-B1) ---------
    ("failed base",
     [_f("0000950123-25-005701", "13F-HR", "2025-05-15", B, None, broken=True)],
     0, False, "parsed as"),
    ("clean base + UNREADABLE NEW HOLDINGS",
     [_f("0000950123-25-005701", "13F-HR", "2025-05-15", B, None),
      _f("0000950123-25-008361", "13F-HR/A", "2025-08-14", A, "NEW HOLDINGS",
         broken=True)],
     BASE_ROWS, False, "could not be read"),
    ("failed base + clean NEW HOLDINGS",
     [_f("0000950123-25-005701", "13F-HR", "2025-05-15", B, None, broken=True),
      _f("0000950123-25-008361", "13F-HR/A", "2025-08-14", A, "NEW HOLDINGS")],
     AMD_ROWS, False, "parsed as"),

    # --- unstated semantics are never guessed --------------------------------
    ("two non-amendment bases",
     [_f("0000950123-25-005701", "13F-HR", "2025-05-15", B, None),
      _f("0000950123-25-005702", "13F-HR", "2025-06-01", A, None)],
     AMD_ROWS, False, "supersedes which is not stated"),
    ("failed first base + second base",
     [_f("0000950123-25-005701", "13F-HR", "2025-05-15", B, None, broken=True),
      _f("0000950123-25-005702", "13F-HR", "2025-06-01", A, None)],
     AMD_ROWS, False, "supersedes which is not stated"),
    ("base + unknown-type amendment",
     [_f("0000950123-25-005701", "13F-HR", "2025-05-15", B, None),
      _f("0000950123-25-009998", "13F-HR/A", "2025-09-02", A, "SOMETHING ELSE")],
     BASE_ROWS, False, "no recognized amendment type"),
    ("NEW HOLDINGS + unknown-type, NO full filing (F-B2 reassignment)",
     [_f("0000950123-25-008361", "13F-HR/A", "2025-08-14", A, "NEW HOLDINGS"),
      _f("0000950123-25-009999", "13F-HR/A", "2025-09-01", B, "SOMETHING ELSE")],
     BASE_ROWS + AMD_ROWS, False, "no recognized amendment type"),
    ("same-day base + RESTATEMENT, amendmentNo PRESENT — restatement wins",
     [("0000950123-25-005701", "13F-HR", "2025-05-15", B, None, False, None),
      ("0000999999-25-000001", "13F-HR/A", "2025-05-15", A, "RESTATEMENT",
       False, 1)],
     AMD_ROWS, True, None),
    ("same-day base + RESTATEMENT, amendmentNo ABSENT — unresolvable (G-B1)",
     [("0000950123-25-005701", "13F-HR", "2025-05-15", B, None, False, None),
      # Cover omits <amendmentNo>, so it collapses to 0 — the same value the
      # base gets — and only the accession separated them. The base sorted
      # later and 110 rows came back as a "complete" book.
      ("0000111111-25-000001", "13F-HR/A", "2025-05-15", A, "RESTATEMENT",
       False, "OMIT")],
     None, False, "UNRESOLVABLE"),
    ("same-day RESTATEMENT and NEW HOLDINGS (unresolvable tie, F-B4)",
     [_f("0000950123-25-005701", "13F-HR", "2025-05-15", B, None),
      _f("0000950123-25-008000", "13F-HR/A", "2025-08-14", B, "RESTATEMENT"),
      _f("0000950123-25-008361", "13F-HR/A", "2025-08-14", A, "NEW HOLDINGS")],
     None, False, "share a filed date"),
])
def test_composition_truth_table(label, filings, rows, complete, reason_fragment):
    r = _compose(filings)
    if rows is not None:
        assert len(r["holdings"]) == rows, f"{label}: rows"
    assert r["composition_complete"] is complete, (
        f"{label}: complete={r['composition_complete']}"
        f" warning={r.get('composition_warning')}"
    )
    if complete:
        assert "composition_warning" not in r, f"{label}: unexpected warning"
    else:
        assert reason_fragment in r["composition_warning"], (
            f"{label}: warning did not name the reason —"
            f" {r['composition_warning']}"
        )
    # The trail must never claim a filing was APPLIED whose rows were dropped.
    # (The prior assertion was `applied_rows >= 0` — true by construction for
    # every input, so it guarded nothing: G-N1, the eleventh non-load-bearing
    # test in this run, and the guard for the F-B2 defect class.)
    applied_rows = sum(
        c["rows"] for c in r["composition"] if c["rows_applied"]
    )
    if rows is not None:
        assert applied_rows == rows, (
            f"{label}: trail says {applied_rows} rows applied but"
            f" {rows} were returned — a filing is mislabelled"
        )


@pytest.mark.parametrize("label,filings", [
    ("base + NEW HOLDINGS",
     [_f("0000950123-25-005701", "13F-HR", "2025-05-15", B, None),
      _f("0000950123-25-008361", "13F-HR/A", "2025-08-14", A, "NEW HOLDINGS")]),
    ("base + later RESTATEMENT",
     [_f("0000950123-25-005701", "13F-HR", "2025-05-15", B, None),
      _f("0000950123-25-009999", "13F-HR/A", "2025-09-01", A, "RESTATEMENT")]),
    ("NEW HOLDINGS superseded by a later RESTATEMENT",
     [_f("0000950123-25-005701", "13F-HR", "2025-05-15", B, None),
      _f("0000950123-25-006000", "13F-HR/A", "2025-06-01", A, "NEW HOLDINGS"),
      _f("0000950123-25-007000", "13F-HR/A", "2025-07-01", B, "RESTATEMENT")]),
    ("two same-day RESTATEMENTs whose amendment_no order reverses accession",
     [("0000950123-25-005701", "13F-HR", "2025-05-15", B, None, False, None),
      # LARGER accession, LOWER amendment_no — accession-ranking picks this one,
      # the pipeline picks the other.
      ("0000999999-25-000001", "13F-HR/A", "2025-08-14", A, "RESTATEMENT",
       False, 1),
      ("0000111111-25-000002", "13F-HR/A", "2025-08-14", B, "RESTATEMENT",
       False, 2)]),
])
def test_the_federated_plane_agrees_with_the_pipeline_on_survivors(label, filings):
    """QA-VERIFY6: the federated composition and `v_default_inst_filings` must
    pick the SAME surviving filings for the same inputs. Nothing checked this in
    either direction, and round F demonstrated two disagreements — an
    amendment-vs-amendment tie broken by accession where the pipeline uses
    `amendment_no`, and a same-day RESTATEMENT that supersedes in SQL but not
    federated.

    The pipeline's key is (filed_date, COALESCE(amendment_no,0), accession),
    strictly-greater, per `views.sql restatement_survivors`."""
    r = _compose(filings)
    trail = {c["accession"]: c for c in r["composition"]}

    # Reproduce the pipeline's survivor predicate from the filings' OWN
    # metadata — filed_date, amendment_no, accession — NOT from the order the
    # federated trail reports. Deriving it from the trail would compare the
    # federated result against itself and prove nothing.
    def key(c):
        return (c["filed_date"], c["amendment_no"] or 0, c["accession"])

    rows = list(r["composition"])
    restatements = [x for x in rows if x["amendment_type"] == "RESTATEMENT"]

    def superseded(x):
        return any(
            rr["accession"] != x["accession"] and key(rr) > key(x)
            for rr in restatements
        )

    sql_survivors = {x["accession"] for x in rows if not superseded(x)}
    federated_applied = {
        acc for acc, c in trail.items()
        if "superseded" not in c["applied"]
    }
    assert federated_applied == sql_survivors, (
        f"{label}: federated applied {sorted(federated_applied)},"
        f" pipeline survivors {sorted(sql_survivors)}"
    )


@pytest.mark.parametrize("clause", [
    # Every substantive clause of M2-CONTRACT §5, bound to the note that cites
    # it. The ">=$100M" filer threshold — the single largest completeness
    # boundary of 13F, and the reason inst_ticker_holders is not a census of
    # institutional ownership — was ABSENT from the entire source tree for
    # seven review rounds while the devnotes claimed the note carried the "full
    # §5 caveat text" (QA-VERIFY7-B2).
    "Section 13(f) securities",
    "exchange-traded equities plus reportable options, warrants, certain"
    " convertibles",
    "$100M",
    "NOT a census of institutional ownership",
    "No short positions, no cash, no non-13(f) assets",
    "FILED UP TO 45 DAYS LATE",
    "not current holdings",
    "ERA-DEPENDENT units",
    "2023-01-03",
    "otherManager",
    "confidential treatment",
    "not\n    investment advice".replace("\n    ", " "),
])
def test_the_data_note_carries_every_m2_contract_section_5_clause(clause):
    """The note is non-removable precisely so a response lifted out of context
    keeps its caveats — but nothing had ever tested it against its own cited
    source, and it had silently drifted."""
    assert clause in INST_DATA_NOTE, f"§5 clause missing: {clause!r}"


def test_the_federated_survivor_rule_matches_the_real_view_not_a_copy(tmp_path):
    """QA-VERIFY7-N6: the agreement test above compares the federated plane
    against a HAND-COPY of `restatement_survivors` in Python, so a change to
    `views.sql` would not be caught. This one writes real filings through the
    real writer and queries `v_default_inst_filings` itself.

    The shape is the G-B1 trigger: a base and a same-day RESTATEMENT whose cover
    omitted `<amendmentNo>`, so both collapse to 0 and only the accession — a
    filing agent's prefix — separates them. The view keeps BOTH, i.e. it does
    not resolve the tie either; the federated plane must therefore report it as
    unresolvable rather than silently picking one."""
    from populus.amendments import ensure_views
    from populus.db import connect, init_db

    src = tmp_path / "populus.db"
    init_db(str(src))
    conn = connect(str(src))
    _filer(conn, REAL_CIK, "BERKSHIRE HATHAWAY INC")
    # Real rows through the real writer, then set ONLY the amendment fields this
    # tie depends on — `amendment_no` stays NULL, the G-B1 trigger.
    _load(conn, fid="inst:0000950123-25-005701", cik=REAL_CIK,
          period="2025-03-31", filed="2025-05-15", holds=[])
    _load(conn, fid="inst:0000111111-25-000001", cik=REAL_CIK,
          period="2025-03-31", filed="2025-05-15", holds=[],
          submission_type="13F-HR/A")
    conn.execute(
        "UPDATE inst_filings SET is_amendment = 1, amendment_type = 'RESTATEMENT',"
        " amendment_no = NULL WHERE accession = '0000111111-25-000001'"
    )
    conn.commit()
    ensure_views(conn)
    survivors = {
        r[0] for r in conn.execute(
            "SELECT accession FROM v_default_inst_filings"
            f" WHERE cik = '{REAL_CIK}' AND period_of_report = '2025-03-31'"
        ).fetchall()
    }
    conn.close()

    assert len(survivors) == 2, (
        f"the view resolved a tie the filings do not resolve: {survivors}"
    )
