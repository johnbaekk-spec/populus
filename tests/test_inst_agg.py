"""Cross-filer 13F aggregate identity + reproducibility (RUN M2-3; R1/R5/R10a).

Every aggregate contract has a fail-if-removed test: security_id-first QoQ across
a CUSIP change, exact reported-CUSIP reconciliation across a registry gap, issuer
aggregation before ranking (entity → cusip6 → name), the put_call / ssh_prnamt_type
grain with unit-guarded Δshares, and the NULL/zero-safe concentration. The inst
logical digest is reproducible across two independent builds (R5), and the real
Berkshire 2025-Q4 → 2026-Q1 transition is validated against an independent
recompute from ``v_default_holdings`` (R10a).
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from populus.amendments import ensure_views
from populus.db import connect, init_db
from populus.ingest.inst13f import run_inst13f_ingest
from populus.inst_agg import build_inst_agg
from populus.load import (
    InstFilingRow,
    InstParsedRow,
    upsert_inst_filer,
    upsert_inst_filing,
)
from populus.publish.digests import LOGICAL_PROJECTIONS, logical_digest

AT = "2026-07-24T12:00:00Z"
REAL_DIR = Path(__file__).parent / "fixtures" / "inst" / "real"
REAL_CIK = "0001067983"


# --- seeding helpers (direct load, no network) --------------------------------


def _db(tmp_path):
    path = tmp_path / "populus.db"
    init_db(str(path))
    return connect(str(path))


def _filer(conn, cik, name="Test Filer"):
    upsert_inst_filer(
        conn, cik=cik, name_raw=name, form13f_file_number="028-00001",
        file_number_norm="028-00001", entity_id=None, raw=None, flags=[],
        source_url="u", retrieved_at=None, response_hash=None, raw_path=None,
        parser_version="p", normalization_version="n", ingested_at=AT,
    )


def _entity(conn, cik):
    eid = f"cik:{cik}"
    conn.execute(
        "INSERT INTO entities (entity_id, cik, raw) VALUES (?, ?, NULL)"
        " ON CONFLICT (entity_id) DO NOTHING",
        (eid, cik),
    )
    return eid


def _security(conn, security_id, *, entity_id=None, link="unresolved"):
    conn.execute(
        "INSERT INTO securities (security_id, id_state, class, entity_id,"
        " entity_link_state, review_state) VALUES (?, 'provisional', NULL, ?, ?,"
        " 'auto') ON CONFLICT (security_id) DO NOTHING",
        (security_id, entity_id, link),
    )
    return security_id


def _hold(*, ordinal, issuer, cusip, value, shares=100, unit="SH", put_call=None,
          security_id=None):
    return InstParsedRow(
        raw_row={"nameOfIssuer": issuer, "cusip": cusip, "value": str(value),
                 "ord": ordinal},
        row_ordinal=ordinal, issuer_name_raw=issuer, title_of_class="COM",
        cusip_raw=cusip, cusip=cusip, value_raw=value, unit_basis="whole",
        value_usd=value, ssh_prnamt=shares, ssh_prnamt_type=unit,
        put_call=put_call, investment_discretion="SOLE", other_manager=None,
        other_manager_seqs=[], voting_sole=shares, voting_shared=0,
        voting_none=0, security_id=security_id, flags=[],
    )


_UNSET = object()


def _load(conn, *, fid, cik, period, filed, holds, total=_UNSET,
          submission_type="13F-HR", parse_status="parsed", failure_kind=None,
          flags=None):
    """Load one inst filing + its holdings. ``total`` defaults to Σ holding
    values; pass ``total=None`` for an UNKNOWN cover total (cover-failed / notice)."""
    if total is _UNSET:
        total = sum(h.value_usd for h in holds if h.value_usd is not None)
    filing = InstFilingRow(
        filing_id=fid, cik=cik, accession=fid.split(":", 1)[1],
        submission_type=submission_type, period_of_report=period, filed_date=filed,
        form_version=None, unit_basis="whole", is_amendment=0, amendment_type=None,
        amendment_no=None, amends=None, is_confidential_omitted=None,
        conf_denied_expired=None, filing_manager_raw="Test Filer",
        form13f_file_number="028-00001", file_number_norm="028-00001",
        report_type="13F HOLDINGS REPORT", other_managers=[], table_entry_total=len(holds),
        table_value_total=total, table_value_total_usd=total, row_count=len(holds),
        sum_value_usd=total, value_total_delta=0, resolved_rows=len(holds),
        resolved_value_usd=total, parse_status=parse_status, failure_kind=failure_kind,
        flags=flags or [],
        doc_url="d", table_url="t", table_filename="f.xml", table_raw_path="rp",
        source_url="s", retrieved_at=None, raw_path="r", index_response_hash=None,
        response_hash=None, table_response_hash=None, parser_version="p",
        normalization_version="n", ingested_at=AT,
    )
    upsert_inst_filing(conn, filing=filing, holdings=holds)


def _agg(conn, tmp_path, name="inst_agg.db"):
    ensure_views(conn)
    out = tmp_path / name
    build_inst_agg(conn, out, ingested_at=AT)
    return connect(str(out))


def _rows(conn, sql, params=()):
    cur = conn.execute(sql, params)
    cols = [c[0] for c in cur.description]
    return [dict(zip(cols, r)) for r in cur.fetchall()]


# --- R1a/F5 filer registry ----------------------------------------------------


def test_filer_registry_counts_null_and_unkeyed_positions(tmp_path):
    conn = _db(tmp_path)
    _filer(conn, "0000000001", "Alpha")
    _security(conn, "sec:x")
    _load(
        conn, fid="inst:A-1", cik="0000000001", period="2026-03-31",
        filed="2026-04-15",
        holds=[
            _hold(ordinal=1, issuer="APPLE INC", cusip="037833100", value=1000,
                  security_id="sec:x"),
            _hold(ordinal=2, issuer="NULLCO", cusip="222222222", value=None),  # NULL value
            _hold(ordinal=3, issuer="MYSTERY CO", cusip=None, value=500),      # unkeyable
        ],
    )
    agg = _agg(conn, tmp_path)
    (r,) = _rows(agg, "SELECT * FROM agg_filer_registry")
    assert r["cik"] == "0000000001" and r["filer_name"] == "Alpha"
    assert r["latest_period"] == "2026-03-31"
    assert r["position_count"] == 3           # every holding retained (G3)
    assert r["total_value_usd"] == 1500       # non-NULL only (1000 + 500)
    assert r["null_value_positions"] == 1     # the NULL-value holding
    assert r["unkeyed_positions"] == 1        # the no-security/no-cusip holding
    agg.close()
    conn.close()


def test_notice_only_filer_still_gets_a_registry_row(tmp_path):
    conn = _db(tmp_path)
    _filer(conn, "0000000009", "Quiet Co")
    # A 13F-NT-shaped filing with zero holdings — a default filer with 0 positions.
    _load(conn, fid="inst:Q-1", cik="0000000009", period="2026-03-31",
          filed="2026-04-15", holds=[], total=0)
    agg = _agg(conn, tmp_path)
    (r,) = _rows(agg, "SELECT * FROM agg_filer_registry")
    assert r["position_count"] == 0 and r["total_value_usd"] == 0
    agg.close()
    conn.close()


# --- R1b/F2 QoQ identity ------------------------------------------------------


def test_qoq_cusip_change_same_security_is_add_not_exit_new(tmp_path):
    """A CUSIP change (both CUSIPs resolve to ONE security_id) is one continuous
    position — classified add/trim, never a fabricated exit+new."""
    conn = _db(tmp_path)
    _filer(conn, "0000000001")
    _security(conn, "sec:merged")
    _load(conn, fid="inst:A-1", cik="0000000001", period="2025-12-31",
          filed="2026-01-15",
          holds=[_hold(ordinal=1, issuer="OLDNAME CORP", cusip="111111111",
                       value=1000, shares=100, security_id="sec:merged")])
    _load(conn, fid="inst:A-2", cik="0000000001", period="2026-03-31",
          filed="2026-04-15",
          holds=[_hold(ordinal=1, issuer="NEWNAME CORP", cusip="999999999",
                       value=1500, shares=150, security_id="sec:merged")])
    agg = _agg(conn, tmp_path)
    rows = _rows(agg, "SELECT * FROM agg_qoq_deltas")
    assert len(rows) == 1
    (row,) = rows
    assert row["position_key"] == "sid:sec:merged"
    assert row["change_kind"] == "add"           # not exit + new
    assert row["delta_value_usd"] == 500
    assert row["delta_shares"] == 50
    assert "identity_reconciled_by_cusip" not in json.loads(row["flags"])
    agg.close()
    conn.close()


def test_qoq_reported_cusip_reconciles_registry_gap(tmp_path):
    """A resolved→unresolved boundary bridged by an EXACT reported CUSIP is one
    reconciled position (flagged), not exit+new."""
    conn = _db(tmp_path)
    _filer(conn, "0000000001")
    _security(conn, "sec:y")
    # Q1: reported CUSIP 444444444 resolved to sec:y.
    _load(conn, fid="inst:A-1", cik="0000000001", period="2025-12-31",
          filed="2026-01-15",
          holds=[_hold(ordinal=1, issuer="GAP CO", cusip="444444444",
                       value=2000, shares=200, security_id="sec:y")])
    # Q2: SAME reported CUSIP but the registry no longer resolves it (gap).
    _load(conn, fid="inst:A-2", cik="0000000001", period="2026-03-31",
          filed="2026-04-15",
          holds=[_hold(ordinal=1, issuer="GAP CO", cusip="444444444",
                       value=2200, shares=220, security_id=None)])
    agg = _agg(conn, tmp_path)
    rows = _rows(agg, "SELECT * FROM agg_qoq_deltas")
    assert len(rows) == 1, rows      # reconciled, not exit + new
    (row,) = rows
    assert row["change_kind"] == "add"
    assert row["delta_value_usd"] == 200
    assert "identity_reconciled_by_cusip" in json.loads(row["flags"])
    agg.close()
    conn.close()


def test_qoq_genuine_new_and_exit(tmp_path):
    conn = _db(tmp_path)
    _filer(conn, "0000000001")
    _security(conn, "sec:a")
    _security(conn, "sec:b")
    _load(conn, fid="inst:A-1", cik="0000000001", period="2025-12-31",
          filed="2026-01-15",
          holds=[_hold(ordinal=1, issuer="A CO", cusip="111111111", value=1000,
                       security_id="sec:a")])
    _load(conn, fid="inst:A-2", cik="0000000001", period="2026-03-31",
          filed="2026-04-15",
          holds=[_hold(ordinal=1, issuer="B CO", cusip="222222222", value=800,
                       security_id="sec:b")])
    agg = _agg(conn, tmp_path)
    kinds = {
        r["position_key"]: r["change_kind"]
        for r in _rows(agg, "SELECT position_key, change_kind FROM agg_qoq_deltas")
    }
    assert kinds == {"sid:sec:a": "exit", "sid:sec:b": "new"}
    agg.close()
    conn.close()


# --- R1b/F4 grain (put_call + ssh_prnamt_type) --------------------------------


def test_put_and_long_of_one_security_are_distinct_positions(tmp_path):
    conn = _db(tmp_path)
    _filer(conn, "0000000001")
    _security(conn, "sec:x")
    _load(conn, fid="inst:A-1", cik="0000000001", period="2026-03-31",
          filed="2026-04-15",
          holds=[
              _hold(ordinal=1, issuer="X CO", cusip="111111111", value=1000,
                    security_id="sec:x", put_call=None),
              _hold(ordinal=2, issuer="X CO", cusip="111111111", value=300,
                    security_id="sec:x", put_call="PUT"),
          ])
    agg = _agg(conn, tmp_path)
    conc = _rows(agg, "SELECT * FROM agg_filer_concentration")[0]
    assert conc["position_count"] == 2
    # Two distinct concentration positions of UNEQUAL weight (1000 long + 300
    # put = 1300 total). Assert the EXACT HHI rather than mere non-NULL (QA-F15).
    # The implementation uses integer math — deterministic, so the digest is
    # reproducible: sum(v²) * 10_000 // total².
    total = 1000 + 300
    expected_hhi = (1000 * 1000 + 300 * 300) * 10_000 // (total * total)
    assert expected_hhi == 6449
    assert conc["hhi"] == expected_hhi, (conc["hhi"], expected_hhi)
    # And the two subpositions are genuinely distinct in the QoQ grain.
    assert conc["position_count"] == 2
    agg.close()
    conn.close()


def test_qoq_ssh_prnamt_unit_change_nulls_delta_shares(tmp_path):
    """SH → PRN across quarters: Δvalue always, Δshares NULL + shares_unit_mismatch
    (never a fabricated share delta across incompatible units)."""
    conn = _db(tmp_path)
    _filer(conn, "0000000001")
    _security(conn, "sec:x")
    _load(conn, fid="inst:A-1", cik="0000000001", period="2025-12-31",
          filed="2026-01-15",
          holds=[_hold(ordinal=1, issuer="X CO", cusip="111111111", value=1000,
                       shares=100, unit="SH", security_id="sec:x")])
    _load(conn, fid="inst:A-2", cik="0000000001", period="2026-03-31",
          filed="2026-04-15",
          holds=[_hold(ordinal=1, issuer="X CO", cusip="111111111", value=1200,
                       shares=50, unit="PRN", security_id="sec:x")])
    agg = _agg(conn, tmp_path)
    (row,) = _rows(agg, "SELECT * FROM agg_qoq_deltas")
    assert row["delta_value_usd"] == 200         # Δvalue always computed
    assert row["delta_shares"] is None           # NULL, not 0 or 50-100
    flags = json.loads(row["flags"])
    assert "shares_unit_mismatch" in flags and "classified_by_value" in flags
    agg.close()
    conn.close()


# --- R1c/F3 issuer aggregation ------------------------------------------------


def test_issuer_aggregates_share_classes_before_ranking(tmp_path):
    """A filer's two securities of one issuer are summed by entity_id BEFORE the
    filer is ranked — share classes never split a holder."""
    conn = _db(tmp_path)
    _filer(conn, "0000000001", "Big Holder")
    _filer(conn, "0000000002", "Small Holder")
    eid = _entity(conn, "0000099999")
    _security(conn, "sec:cls_a", entity_id=eid, link="resolved")
    _security(conn, "sec:cls_b", entity_id=eid, link="resolved")
    # Big Holder: two share classes of the same issuer → summed to 900.
    _load(conn, fid="inst:A-1", cik="0000000001", period="2026-03-31",
          filed="2026-04-15",
          holds=[
              _hold(ordinal=1, issuer="ISSUER A", cusip="111111111", value=500,
                    security_id="sec:cls_a"),
              _hold(ordinal=2, issuer="ISSUER B", cusip="222222222", value=400,
                    security_id="sec:cls_b"),
          ])
    # Small Holder: one class, 600.
    _load(conn, fid="inst:B-1", cik="0000000002", period="2026-03-31",
          filed="2026-04-15",
          holds=[_hold(ordinal=1, issuer="ISSUER A", cusip="111111111", value=600,
                       security_id="sec:cls_a")])
    agg = _agg(conn, tmp_path)
    rows = _rows(
        agg,
        "SELECT rank, cik, value_usd, security_count, issuer_key_source, flags"
        " FROM agg_issuer_top_holders WHERE issuer_key = ? ORDER BY rank",
        (f"entity:{eid}",),
    )
    assert [(r["rank"], r["cik"], r["value_usd"]) for r in rows] == [
        (1, "0000000001", 900),   # summed across classes, outranks 600
        (2, "0000000002", 600),
    ]
    assert rows[0]["security_count"] == 2
    assert rows[0]["issuer_key_source"] == "entity"
    assert json.loads(rows[0]["flags"]) == []
    agg.close()
    conn.close()


def test_issuer_key_falls_back_cusip6_then_name(tmp_path):
    conn = _db(tmp_path)
    _filer(conn, "0000000001")
    _security(conn, "sec:nolink")   # exists but entity unresolved → cusip6 fallback
    _load(conn, fid="inst:A-1", cik="0000000001", period="2026-03-31",
          filed="2026-04-15",
          holds=[
              _hold(ordinal=1, issuer="BLOCKCO", cusip="459200101", value=700,
                    security_id="sec:nolink"),
              _hold(ordinal=2, issuer="No Cusip Co", cusip=None, value=300),  # name
          ])
    agg = _agg(conn, tmp_path)
    by_key = {
        r["issuer_key"]: r
        for r in _rows(
            agg, "SELECT issuer_key, issuer_key_source, flags FROM agg_issuer_top_holders"
        )
    }
    assert "cusip6:459200" in by_key
    assert by_key["cusip6:459200"]["issuer_key_source"] == "cusip6"
    assert "issuer_from_cusip6" in json.loads(by_key["cusip6:459200"]["flags"])
    assert "name:NO CUSIP CO" in by_key
    assert "issuer_from_name" in json.loads(by_key["name:NO CUSIP CO"]["flags"])
    agg.close()
    conn.close()


# --- R1d/F5 concentration -----------------------------------------------------


def test_concentration_zero_total_is_null_not_fake_zero(tmp_path):
    """Every value NULL → total 0 → concentration_unavailable, share/HHI NULL —
    the digest keeps that NULL distinct from a real 0; no divide-by-zero."""
    conn = _db(tmp_path)
    _filer(conn, "0000000001")
    _security(conn, "sec:x")
    _load(conn, fid="inst:A-1", cik="0000000001", period="2026-03-31",
          filed="2026-04-15",
          holds=[_hold(ordinal=1, issuer="X CO", cusip="111111111", value=None,
                       security_id="sec:x")],
          total=0)
    agg = _agg(conn, tmp_path)
    (r,) = _rows(agg, "SELECT * FROM agg_filer_concentration")
    assert r["total_value_usd"] == 0
    assert r["null_value_positions"] == 1
    assert r["topn_share_bps"] is None       # NULL, not 0
    assert r["hhi"] is None                   # NULL, not 0
    assert "concentration_unavailable" in json.loads(r["flags"])
    agg.close()
    conn.close()


def test_concentration_hhi_and_topn_are_integers(tmp_path):
    conn = _db(tmp_path)
    _filer(conn, "0000000001")
    for i in range(4):
        _security(conn, f"sec:{i}")
    # Four equal positions of 250 each → total 1000, HHI = 10000/4 = 2500 bps.
    _load(conn, fid="inst:A-1", cik="0000000001", period="2026-03-31",
          filed="2026-04-15",
          holds=[_hold(ordinal=i + 1, issuer=f"CO{i}", cusip=f"11111111{i}",
                       value=250, security_id=f"sec:{i}") for i in range(4)])
    agg = _agg(conn, tmp_path)
    (r,) = _rows(agg, "SELECT * FROM agg_filer_concentration")
    assert r["total_value_usd"] == 1000
    assert isinstance(r["hhi"], int) and r["hhi"] == 2500
    assert isinstance(r["topn_share_bps"], int) and r["topn_share_bps"] == 10000
    assert isinstance(r["topn_value_usd"], int) and r["topn_value_usd"] == 1000
    agg.close()
    conn.close()


# --- R5 two-build reproducibility ---------------------------------------------


def test_two_independent_builds_share_one_logical_digest(tmp_path):
    conn = _db(tmp_path)
    _filer(conn, "0000000001")
    _security(conn, "sec:x")
    _load(conn, fid="inst:A-1", cik="0000000001", period="2025-12-31",
          filed="2026-01-15",
          holds=[_hold(ordinal=1, issuer="X CO", cusip="111111111", value=1000,
                       security_id="sec:x")])
    _load(conn, fid="inst:A-2", cik="0000000001", period="2026-03-31",
          filed="2026-04-15",
          holds=[_hold(ordinal=1, issuer="X CO", cusip="111111111", value=1500,
                       security_id="sec:x")])
    ensure_views(conn)
    out1, out2 = tmp_path / "a.db", tmp_path / "b.db"
    build_inst_agg(conn, out1, ingested_at="2026-01-01T00:00:00Z")
    build_inst_agg(conn, out2, ingested_at="2099-09-09T09:09:09Z")  # different clock
    a, b = connect(str(out1)), connect(str(out2))
    assert logical_digest(a, LOGICAL_PROJECTIONS["inst"]) == logical_digest(
        b, LOGICAL_PROJECTIONS["inst"]
    )
    a.close()
    b.close()
    conn.close()


# --- R10a real Berkshire QoQ (100% row match vs an independent recompute) ------


@pytest.fixture(scope="module")
def real_agg(tmp_path_factory):
    d = tmp_path_factory.mktemp("real_agg")
    path = d / "inst.db"
    init_db(str(path))
    conn = connect(str(path))
    run_inst13f_ingest(
        conn, run_id="r", now=lambda: AT, host="h", ingested_at=AT,
        ciks=[REAL_CIK], cache_dir=str(REAL_DIR),
    )
    ensure_views(conn)
    out = d / "inst_agg.db"
    build_inst_agg(conn, out, ingested_at=AT)
    agg = connect(str(out))
    yield conn, agg
    agg.close()
    conn.close()


def test_real_berkshire_qoq_matches_independent_recompute(real_agg):
    """R10a / QA-F3+F4 (round 3): a FULLY INDEPENDENT oracle for the real
    2025-12-31 → 2026-03-31 transition. It reconstructs the expected row map —
    including which pairs reconcile — from the SOURCE holdings alone, never from
    the aggregate's own flags or delta columns, and asserts exact keys, count,
    classification, values AND shares.
    """
    conn, agg = real_agg
    curr, prev = "2026-03-31", "2025-12-31"

    def positions(period):
        """Source-of-truth positions at the aggregate's grain, with shares."""
        out: dict[tuple[str, str, str], dict] = {}
        for pk, put_call, unit, value, shares in conn.execute(
            "SELECT CASE WHEN security_id IS NOT NULL THEN 'sid:'||security_id"
            "            WHEN cusip IS NOT NULL THEN 'cusip:'||cusip END,"
            "       COALESCE(put_call, 'LONG'),"
            "       CASE WHEN ssh_prnamt_type IN ('SH','PRN') THEN ssh_prnamt_type"
            "            ELSE 'UNKNOWN' END,"
            "       COALESCE(SUM(value_usd), 0),"
            "       CASE WHEN COUNT(*) = COUNT(ssh_prnamt) THEN SUM(ssh_prnamt) END"
            " FROM v_default_holdings"
            " WHERE cik = ? AND period_of_report = ?"
            "   AND (security_id IS NOT NULL OR cusip IS NOT NULL)"
            " GROUP BY 1, 2, 3",
            (REAL_CIK, period),
        ):
            out[(pk, put_call, unit)] = {"value": value, "shares": shares}
        return out

    prev_pos, curr_pos = positions(prev), positions(curr)
    assert prev_pos and curr_pos, "the real corpus should carry both quarters"

    # --- rebuild the expected pairing INDEPENDENTLY (mirrors the documented
    # three-pass contract; consults no aggregate output whatsoever) ------------
    expected: dict[tuple, dict] = {}
    unmatched_prev = dict(prev_pos)
    unmatched_curr = dict(curr_pos)

    for key in set(prev_pos) & set(curr_pos):            # pass 1: exact grain
        expected[key] = {"prev": prev_pos[key], "curr": curr_pos[key],
                         "prev_key": key}
        unmatched_prev.pop(key); unmatched_curr.pop(key)

    def _index(d, keyfn):                                 # unique 1:1 buckets
        out = {}
        for k in d:
            out.setdefault(keyfn(k), []).append(k)
        return out

    prev_ident = _index(unmatched_prev, lambda k: (k[0], k[1]))   # pass 2
    curr_ident = _index(unmatched_curr, lambda k: (k[0], k[1]))
    for ident in set(prev_ident) & set(curr_ident):
        if len(prev_ident[ident]) == 1 and len(curr_ident[ident]) == 1:
            pk_prev, pk_curr = prev_ident[ident][0], curr_ident[ident][0]
            expected[pk_curr] = {"prev": unmatched_prev[pk_prev],
                                 "curr": unmatched_curr[pk_curr],
                                 "prev_key": pk_prev}
            unmatched_prev.pop(pk_prev); unmatched_curr.pop(pk_curr)

    for key in unmatched_curr:                            # genuine new
        expected[key] = {"prev": None, "curr": unmatched_curr[key], "prev_key": None}
    for key in unmatched_prev:                            # genuine exit
        expected[key] = {"prev": unmatched_prev[key], "curr": None, "prev_key": key}
    # Pass 3 (reported-CUSIP reconciliation) requires a RESOLVED↔UNRESOLVED
    # bridge. On this corpus every position carries the same resolution state,
    # so no bridge is possible and passes 1+2 fully determine the expected map.
    # Assert that precondition explicitly, so the oracle can never silently drift
    # into under-counting if the fixture's identity coverage changes.
    resolution_states = {
        k[0].startswith("sid:") for k in set(prev_pos) | set(curr_pos)
    }
    assert len(resolution_states) == 1, (
        "fixture now mixes resolved and unresolved positions — pass 3 can fire,"
        " so this oracle must model CUSIP reconciliation too"
    )

    agg_rows = {
        (r["position_key"], r["put_call"], r["ssh_prnamt_type"]): r
        for r in _rows(
            agg,
            "SELECT * FROM agg_qoq_deltas WHERE cik = ? AND curr_period = ?",
            (REAL_CIK, curr),
        )
    }

    # EXACT key set and count.
    assert set(agg_rows) == set(expected)
    assert len(agg_rows) == len(expected)

    for key, want in expected.items():
        row = agg_rows[key]
        p, c = want["prev"], want["curr"]
        pv = p["value"] if p else 0
        cv = c["value"] if c else 0
        ps = p["shares"] if p else None
        cs = c["shares"] if c else None
        # values
        assert row["prev_value_usd"] == pv, key
        assert row["curr_value_usd"] == cv, key
        assert row["delta_value_usd"] == cv - pv, key
        # Δshares — derived ONLY from source positions and their units. The
        # units come from the grain keys the oracle itself paired, so nothing
        # here reads an aggregate column (QA-F1, round 4).
        prev_key = want["prev_key"]
        if p is None:
            expected_delta_shares = cs
        elif c is None:
            expected_delta_shares = -ps if ps is not None else None
        else:
            units_compatible = (
                prev_key is not None
                and prev_key[2] == key[2]          # same reported unit
                and prev_key[2] != "UNKNOWN"
                and ps is not None
                and cs is not None
            )
            expected_delta_shares = cs - ps if units_compatible else None
        assert row["delta_shares"] == expected_delta_shares, (
            key, row["delta_shares"], expected_delta_shares
        )
        # classification, from the INDEPENDENT numbers only
        if p is None:
            kind = "new"
        elif c is None:
            kind = "exit"
        elif expected_delta_shares is not None and expected_delta_shares != 0:
            kind = "add" if expected_delta_shares > 0 else "trim"
        else:
            kind = "add" if cv - pv >= 0 else "trim"
        assert row["change_kind"] == kind, (key, row["change_kind"], kind)


def test_real_berkshire_registry_totals_reconcile(real_agg):
    conn, agg = real_agg
    (expected,) = conn.execute(
        "SELECT COALESCE(SUM(value_usd), 0) FROM v_default_holdings"
        " WHERE cik = ? AND period_of_report ="
        " (SELECT MAX(period_of_report) FROM v_default_holdings WHERE cik = ?)",
        (REAL_CIK, REAL_CIK),
    ).fetchone()
    (positions,) = conn.execute(
        "SELECT COUNT(*) FROM v_default_holdings WHERE cik = ?", (REAL_CIK,)
    ).fetchone()
    (row,) = _rows(agg, "SELECT * FROM agg_filer_registry WHERE cik = ?", (REAL_CIK,))
    assert row["position_count"] == positions          # every holding retained
    assert row["latest_period"] == "2026-03-31"


# --- CLI surface (R8/R9; QA-F13 — these would have caught QA-F1) --------------


def _cli(args):
    from click.testing import CliRunner

    from populus.cli import main

    return CliRunner().invoke(main, args)


def test_cli_inst_agg_builds_an_aggregate(tmp_path):
    """The happy path: `populus inst-agg` writes a real aggregate database."""
    conn = _db(tmp_path)
    conn.close()
    db_path = tmp_path / "populus.db"
    out = tmp_path / "inst_agg.db"
    result = _cli(["inst-agg", "--db", str(db_path), "--out", str(out)])
    assert result.exit_code == 0, result.output
    assert out.exists()
    assert "inst-agg:" in result.output


@pytest.mark.parametrize("spelling", ["identical", "relative", "symlink"])
def test_cli_inst_agg_refuses_to_clobber_its_source(tmp_path, spelling):
    """QA-F1: `--out` aliasing the SOURCE database must be refused BEFORE the
    unlink — otherwise a plausible invocation destroys the ingested store. The
    check resolves paths, so relative spellings and symlinks are caught too."""
    conn = _db(tmp_path)
    conn.close()
    db_path = tmp_path / "populus.db"
    before = db_path.read_bytes()

    if spelling == "identical":
        out = str(db_path)
    elif spelling == "relative":
        out = str(tmp_path / "sub" / ".." / "populus.db")
        (tmp_path / "sub").mkdir()
    else:
        link = tmp_path / "alias.db"
        link.symlink_to(db_path)
        out = str(link)

    result = _cli(["inst-agg", "--db", str(db_path), "--out", out])
    assert result.exit_code != 0, result.output
    assert "refusing" in result.output.lower(), result.output
    # The source database is untouched, byte for byte.
    assert db_path.read_bytes() == before


def test_cli_inst_agg_reports_a_missing_database(tmp_path):
    result = _cli(
        ["inst-agg", "--db", str(tmp_path / "nope.db"), "--out", str(tmp_path / "o.db")]
    )
    assert result.exit_code != 0
    assert "does not exist" in result.output


def test_publish_notice_survives_a_missing_gate_record(tmp_path):
    """QA-F1: publish must not raise when there is NO build-time gate record —
    a staging-less reconcile or an explicit re-publish. The notice is advisory;
    a successful publication must never become a traceback."""
    from populus.cli import _inst_absence_notice, _read_inst_gate_record

    # No staging directory at all.
    assert _read_inst_gate_record(str(tmp_path), "20260725.1") is None
    notice = _inst_absence_notice(str(tmp_path), "20260725.1", None)
    assert "inst module" in notice
    assert "20260725.1" in notice  # names the path it looked for, no NameError

    # And with a record present it reports the withheld reason.
    gate = tmp_path / ".staging" / "20260725.1"
    gate.mkdir(parents=True)
    (gate / "inst-gate.json").write_text(
        json.dumps(
            {"state": "withheld", "reason": "below_threshold",
             "coverage": 0.0, "cover_failed_count": 0}
        ),
        encoding="utf-8",
    )
    record = _read_inst_gate_record(str(tmp_path), "20260725.1")
    assert "WITHHELD" in _inst_absence_notice(str(tmp_path), "20260725.1", record)


def test_the_coverage_threshold_is_locked_at_95_percent():
    """QA-F10: the owner locked the M2 gate at exactly 0.95 and accepted
    fail-closed. Lowering the constant must fail the suite, not pass silently."""
    from populus.ingest.inst13f import COVERAGE_THRESHOLD

    assert COVERAGE_THRESHOLD == 0.95


def test_sh_and_prn_subpositions_stay_distinct_across_quarters(tmp_path):
    """QA-F5 / R1: the same security reported as SH and as PRN in adjacent
    quarters must produce DISTINCT QoQ rows with their own deltas — merging them
    yields a meaningless share count (the original defect)."""
    conn = _db(tmp_path)
    _filer(conn, "0000000001")
    _security(conn, "sec:x")
    for fid, period, filed, sh_val, prn_val in (
        ("inst:f1", "2025-12-31", "2026-02-14", 1000, 500),
        ("inst:f2", "2026-03-31", "2026-05-15", 1400, 200),
    ):
        _load(conn, fid=fid, cik="0000000001", period=period, filed=filed, holds=[
            _hold(ordinal=1, issuer="X CO", cusip="111111111", value=sh_val,
                  shares=10, unit="SH", security_id="sec:x"),
            _hold(ordinal=2, issuer="X CO", cusip="111111111", value=prn_val,
                  shares=20, unit="PRN", security_id="sec:x"),
        ])
    agg = _agg(conn, tmp_path)
    rows = {
        (r["position_key"], r["put_call"], r["ssh_prnamt_type"]): r
        for r in _rows(agg, "SELECT * FROM agg_qoq_deltas WHERE curr_period = ?",
                       ("2026-03-31",))
    }
    # Two distinct subpositions, each with its OWN delta — never merged.
    assert set(rows) == {("sid:sec:x", "LONG", "SH"), ("sid:sec:x", "LONG", "PRN")}
    assert rows[("sid:sec:x", "LONG", "SH")]["delta_value_usd"] == 1400 - 1000
    assert rows[("sid:sec:x", "LONG", "PRN")]["delta_value_usd"] == 200 - 500
    assert rows[("sid:sec:x", "LONG", "SH")]["change_kind"] == "add"
    assert rows[("sid:sec:x", "LONG", "PRN")]["change_kind"] == "trim"
    agg.close()
    conn.close()


def test_long_and_put_of_one_security_are_distinct_qoq_rows(tmp_path):
    """QA-F5 / R1: put/call is part of the grain too — a long and a put of the
    same security are different positions across quarters."""
    conn = _db(tmp_path)
    _filer(conn, "0000000001")
    _security(conn, "sec:x")
    for fid, period, filed, long_val, put_val in (
        ("inst:f1", "2025-12-31", "2026-02-14", 1000, 300),
        ("inst:f2", "2026-03-31", "2026-05-15", 1200, 100),
    ):
        _load(conn, fid=fid, cik="0000000001", period=period, filed=filed, holds=[
            _hold(ordinal=1, issuer="X CO", cusip="111111111", value=long_val,
                  security_id="sec:x"),
            _hold(ordinal=2, issuer="X CO", cusip="111111111", value=put_val,
                  security_id="sec:x", put_call="PUT"),
        ])
    agg = _agg(conn, tmp_path)
    rows = {
        (r["position_key"], r["put_call"]): r
        for r in _rows(agg, "SELECT * FROM agg_qoq_deltas WHERE curr_period = ?",
                       ("2026-03-31",))
    }
    assert set(rows) == {("sid:sec:x", "LONG"), ("sid:sec:x", "PUT")}
    assert rows[("sid:sec:x", "LONG")]["delta_value_usd"] == 200
    assert rows[("sid:sec:x", "PUT")]["delta_value_usd"] == -200
    agg.close()
    conn.close()


def test_a_notice_only_quarter_breaks_qoq_adjacency(tmp_path):
    """QA-F6 / R1: keyable → notice-only → keyable must NOT compare the two
    keyable quarters across the gap (that fabricates continuity). The middle
    period is real: Q1 exits, Q3 is new."""
    conn = _db(tmp_path)
    _filer(conn, "0000000001")
    _security(conn, "sec:x")
    _load(conn, fid="inst:f1", cik="0000000001", period="2025-09-30", filed="2025-11-14",
          holds=[_hold(ordinal=1, issuer="X CO", cusip="111111111", value=1000,
                       security_id="sec:x")])
    # A 13F-NT notice quarter: a REAL default filing with no holdings at all.
    _load(conn, fid="inst:f2", cik="0000000001", period="2025-12-31", filed="2026-02-14",
          holds=[], submission_type="13F-NT", total=None)
    _load(conn, fid="inst:f3", cik="0000000001", period="2026-03-31", filed="2026-05-15",
          holds=[_hold(ordinal=1, issuer="X CO", cusip="111111111", value=1500,
                       security_id="sec:x")])
    agg = _agg(conn, tmp_path)
    rows = {
        (r["prev_period"], r["curr_period"], r["change_kind"])
        for r in _rows(agg, "SELECT * FROM agg_qoq_deltas")
    }
    # The ONLY comparisons are between consecutive filing periods.
    assert ("2025-09-30", "2025-12-31", "exit") in rows
    assert ("2025-12-31", "2026-03-31", "new") in rows
    # And never a bridge across the notice quarter.
    assert not any(prev == "2025-09-30" and curr == "2026-03-31"
                   for prev, curr, _ in rows)
    agg.close()
    conn.close()


def test_a_zero_position_period_still_gets_a_concentration_row(tmp_path):
    """QA-F7 / R1: every default filer-period gets a concentration row, including
    a notice-only one — total 0, NULL share/HHI, `concentration_unavailable`."""
    conn = _db(tmp_path)
    _filer(conn, "0000000001")
    _load(conn, fid="inst:f1", cik="0000000001", period="2025-12-31", filed="2026-02-14",
          holds=[], submission_type="13F-NT", total=None)
    agg = _agg(conn, tmp_path)
    (row,) = _rows(agg, "SELECT * FROM agg_filer_concentration")
    assert row["period_of_report"] == "2025-12-31"
    assert row["total_value_usd"] == 0
    assert row["topn_share_bps"] is None and row["hhi"] is None
    assert "concentration_unavailable" in json.loads(row["flags"])
    agg.close()
    conn.close()


def test_two_resolved_securities_sharing_a_cusip_are_not_collapsed(tmp_path):
    """QA-F1 (round 3): CUSIP reconciliation bridges a RESOLVED↔UNRESOLVED
    registry gap only. Two DIFFERENT resolved securities that report the same
    CUSIP must stay a genuine exit + new — collapsing them would fabricate
    continuity and suppress a real entry/exit."""
    conn = _db(tmp_path)
    _filer(conn, "0000000001")
    _security(conn, "sec:old")
    _security(conn, "sec:new")
    _load(conn, fid="inst:f1", cik="0000000001", period="2025-12-31",
          filed="2026-02-14", holds=[
              _hold(ordinal=1, issuer="X CO", cusip="111111111", value=1000,
                    security_id="sec:old")])
    _load(conn, fid="inst:f2", cik="0000000001", period="2026-03-31",
          filed="2026-05-15", holds=[
              _hold(ordinal=1, issuer="X CO", cusip="111111111", value=1200,
                    security_id="sec:new")])
    agg = _agg(conn, tmp_path)
    rows = _rows(agg, "SELECT * FROM agg_qoq_deltas WHERE curr_period = ?",
                 ("2026-03-31",))
    kinds = {(r["position_key"], r["change_kind"]) for r in rows}
    assert kinds == {("sid:sec:old", "exit"), ("sid:sec:new", "new")}
    # And nothing was labelled a CUSIP reconciliation.
    assert not any(
        "identity_reconciled_by_cusip" in json.loads(r["flags"]) for r in rows
    )
    agg.close()
    conn.close()


@pytest.mark.parametrize("cusip_changes", [False, True])
def test_a_unit_transition_on_one_security_stays_one_position(tmp_path, cusip_changes):
    """QA-F2 (round 3): the same security reported SH one quarter and PRN the
    next is ONE continuous position, matched on security_id — not a spurious
    exit+new, and NOT mislabelled `identity_reconciled_by_cusip`. Holds whether
    or not the reported CUSIP also changed."""
    conn = _db(tmp_path)
    _filer(conn, "0000000001")
    _security(conn, "sec:x")
    _load(conn, fid="inst:f1", cik="0000000001", period="2025-12-31",
          filed="2026-02-14", holds=[
              _hold(ordinal=1, issuer="X CO", cusip="111111111", value=1000,
                    shares=10, unit="SH", security_id="sec:x")])
    _load(conn, fid="inst:f2", cik="0000000001", period="2026-03-31",
          filed="2026-05-15", holds=[
              _hold(ordinal=1, issuer="X CO",
                    cusip="222222222" if cusip_changes else "111111111",
                    value=1300, shares=20, unit="PRN", security_id="sec:x")])
    agg = _agg(conn, tmp_path)
    rows = _rows(agg, "SELECT * FROM agg_qoq_deltas WHERE curr_period = ?",
                 ("2026-03-31",))
    assert len(rows) == 1, rows           # one continuous position, not exit+new
    (row,) = rows
    assert row["position_key"] == "sid:sec:x"
    assert row["delta_value_usd"] == 300
    # Matched on the stable security id — NOT a CUSIP reconciliation.
    flags = json.loads(row["flags"])
    assert "identity_reconciled_by_cusip" not in flags
    # Units differ across the quarters, so Δshares is withheld, never fabricated.
    assert row["delta_shares"] is None
    assert "shares_unit_mismatch" in flags
    agg.close()
    conn.close()


def test_a_rebuild_never_downgrades_a_withheld_gate_record(tmp_path):
    """QA-F2 (round 4): re-running `build` for an already-staged build carries no
    gate metadata, so a naive write would overwrite a real `withheld` verdict
    with `absent` — and the next publish would falsely claim no institutional
    data was ingested, concealing the fail-closed decision."""
    from types import SimpleNamespace

    from populus.cli import _read_inst_gate_record, _write_inst_gate_record

    repo = tmp_path / "repo"
    (repo / ".staging" / "20260725.1").mkdir(parents=True)

    withheld = SimpleNamespace(
        build_id="20260725.1",
        inst_withheld={"reason": "below_threshold", "coverage": 0.0,
                       "numerator": 0, "denominator": 100, "cover_failed_count": 0},
        inst_logical_digest=None,
    )
    _write_inst_gate_record(str(repo), withheld)
    assert _read_inst_gate_record(str(repo), "20260725.1")["state"] == "withheld"

    # A rebuild that reconstructs nothing must NOT clobber the verdict.
    bare = SimpleNamespace(build_id="20260725.1", inst_withheld=None,
                           inst_logical_digest=None)
    _write_inst_gate_record(str(repo), bare)
    assert _read_inst_gate_record(str(repo), "20260725.1")["state"] == "withheld"

    # A genuine positive verdict may still overwrite it.
    included = SimpleNamespace(build_id="20260725.1", inst_withheld=None,
                               inst_logical_digest="abc123")
    _write_inst_gate_record(str(repo), included)
    assert _read_inst_gate_record(str(repo), "20260725.1")["state"] == "included"


def test_gate_record_selection_orders_build_ids_numerically(tmp_path):
    """QA-F3 (round 4): build ids are `YYYYMMDD.N` — lexicographic ordering puts
    `.9` after `.10` and would attach the WRONG withholding reason to a publish.
    Invalid staging entries are ignored."""
    from populus.cli import _read_inst_gate_record

    repo = tmp_path / "repo"
    for build_id, state in (("20260725.9", "withheld"), ("20260725.10", "included")):
        d = repo / ".staging" / build_id
        d.mkdir(parents=True)
        # Both are publishable (journal present), so ORDERING alone decides.
        (d / "journal.json").write_text("{}", encoding="utf-8")
        (d / "inst-gate.json").write_text(json.dumps({"state": state}), encoding="utf-8")
    # Noise that must never be selected.
    (repo / ".staging" / "not-a-build").mkdir()
    (repo / ".staging" / "20260725.x").mkdir()

    # .10 is the NEWEST build, not ".9" (which sorts last lexicographically).
    assert _read_inst_gate_record(str(repo), None)["state"] == "included"


def test_gate_record_selection_ignores_a_build_without_a_journal(tmp_path):
    """QA-F1 (round 5): only a JOURNAL-BEARING staging directory is publishable,
    so an unrelated/partial numeric directory must never supply the verdict
    printed for a different publication — even when it sorts newer."""
    from populus.cli import _read_inst_gate_record

    repo = tmp_path / "repo"
    # .9 is publishable (has a journal); .10 is newer but partial (no journal).
    publishable = repo / ".staging" / "20260725.9"
    publishable.mkdir(parents=True)
    (publishable / "journal.json").write_text("{}", encoding="utf-8")
    (publishable / "inst-gate.json").write_text(
        json.dumps({"state": "withheld", "reason": "below_threshold",
                    "coverage": 0.0, "cover_failed_count": 0}), encoding="utf-8"
    )
    partial = repo / ".staging" / "20260725.10"
    partial.mkdir(parents=True)
    (partial / "inst-gate.json").write_text(
        json.dumps({"state": "included"}), encoding="utf-8"
    )

    record = _read_inst_gate_record(str(repo), None)
    assert record["state"] == "withheld", "took the unpublishable .10 record"


def test_an_undisclosed_prior_value_does_not_fabricate_a_move(tmp_path):
    """QA-VERIFY5-B2: `_Position.value_usd` starts at 0 and only accumulates
    non-NULL values, so a holding whose PRIOR filing had an unparseable <value>
    differenced against a fabricated zero. The identical 100 shares held in both
    quarters surfaced as `change_kind: "add"`, `delta_value_usd: +$5B` — ranked
    first by `inst_biggest_moves`. Nothing was added.

    `inst_agg.sql` states "a legitimately unavailable value is stored NULL …
    never a fabricated zero"; the delta plane violated its own contract while
    the snapshot plane handled the same row honestly."""
    src = tmp_path / "populus.db"
    init_db(str(src))
    conn = connect(str(src))
    sid = "sec:aapl"
    _security(conn, sid, entity_id=_entity(conn, "0000320193"), link="resolved")
    _filer(conn, "0009000001", "NULLVALUE PARTNERS LP")
    # Prior quarter: value UNPARSEABLE (NULL). Current quarter: $5B.
    _load(conn, fid="inst:NV-2025Q4", cik="0009000001", period="2025-12-31",
          filed="2026-02-14",
          holds=[_hold(ordinal=1, issuer="APPLE INC", cusip="037833100",
                       value=None, shares=100, security_id=sid)])
    _load(conn, fid="inst:NV-2026Q1", cik="0009000001", period="2026-03-31",
          filed="2026-05-15",
          holds=[_hold(ordinal=1, issuer="APPLE INC", cusip="037833100",
                       value=5_000_000_000, shares=100, security_id=sid)])
    ensure_views(conn)
    out = tmp_path / "inst_agg.db"
    build_inst_agg(conn, out, ingested_at="2026-07-25T00:00:00Z")
    conn.close()

    agg = connect(str(out))
    rows = _rows(agg, "SELECT * FROM agg_qoq_deltas WHERE cik = '0009000001'")
    agg.close()
    assert len(rows) == 1
    row = rows[0]

    assert row["prev_value_usd"] is None, "an undisclosed value became a zero"
    assert row["delta_value_usd"] is None, "a $5B move was fabricated"
    assert "value_undisclosed_one_side" in row["flags"]
    # Shares are unchanged, so the direction is not inventable from value.
    # Deterministic: neither shares (unchanged) nor value (unknown) can
    # classify a direction. The earlier `in (...)` disjunction accepted "add" —
    # the exact wrong answer this fix exists to prevent — and survived mutation.
    assert row["change_kind"] == "unclassified"
    assert "change_kind_undeterminable" in row["flags"]
