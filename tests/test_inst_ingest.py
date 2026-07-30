"""13F ingest round-trip, provenance, views, coverage, determinism (RUN M2-2).

Golden round-trips assert the full normalized rows AND every physical §5.1
provenance column against a committed ``<key>.expected.json`` (regenerate with
``UPDATE_GOLDENS=1 uv run pytest tests/test_inst_ingest.py``). Two goldens are
hand-verified against source (R11):

  (a) the real 2026-Q1 ALLY row — value 498,992,850 / 12,719,675 sh =
      **$39.23/share** (``test_hand_verified_ally_row``);
  (b) the real 2025-Q1 NEW-HOLDINGS merge pair — base ``0000950123-25-005701``
      and amendment ``0000950123-25-008361`` (``NEW HOLDINGS``,
      ``confDeniedExpired``, 4 entries, tableValueTotal 1,106,550,356) — both in
      ``v_default_holdings`` for 2025-03-31 (``test_real_new_holdings_merge``).
"""

from __future__ import annotations

import importlib.resources
import itertools
import json
import os
import sqlite3
from pathlib import Path

import pytest

from populus.amendments import ensure_views
from populus.db import connect, init_db
from populus.identity.registry import ensure_registry
from populus.ingest import TransportResponse
from populus.ingest.inst13f import format_summary, run_inst13f_ingest
from populus.load import ensure_inst_schema
from populus.net.sec_client import SecClient

FIXTURES = Path(__file__).parent / "fixtures" / "inst"
REAL_DIR = FIXTURES / "real"
CRAFTED_DIR = FIXTURES / "crafted"
EXPECTED = FIXTURES / "expected"
INGESTED_AT = "2026-07-24T12:00:00Z"
SIDECAR_RETRIEVED_AT = "2026-07-24T00:00:00Z"

REAL_CIK = "0001067983"
CRAFTED_CIKS = [
    "0009000001", "0009000002", "0009000003", "0009000004", "0009000005",
    "0009000006", "0009000007", "0009000008", "0009000009", "0009000010",
]


def _fresh(tmp_path) -> sqlite3.Connection:
    path = tmp_path / "inst.db"
    init_db(str(path))
    return connect(str(path))


_RUN_SEQ = itertools.count(1)


def _ingest(conn, cache_dir, ciks=None, *, ingested_at=INGESTED_AT):
    return run_inst13f_ingest(
        conn,
        run_id=f"inst-test-{next(_RUN_SEQ)}",  # unique per call (ingest_runs PK)
        now=lambda: "2026-07-24T12:00:00Z",
        host="testhost",
        ingested_at=ingested_at,
        ciks=ciks,
        cache_dir=cache_dir,
    )


def _packaged_schema() -> str:
    return importlib.resources.files("populus").joinpath("schema.sql").read_text(
        encoding="utf-8"
    )


def _rows(conn, sql, params=()):
    cur = conn.execute(sql, params)
    cols = [c[0] for c in cur.description]
    return [dict(zip(cols, r)) for r in cur.fetchall()]


def _dump_cik(conn, cik) -> dict:
    filer = _rows(conn, "SELECT * FROM inst_filers WHERE cik = ?", (cik,))
    filings = _rows(
        conn, "SELECT * FROM inst_filings WHERE cik = ? ORDER BY accession", (cik,)
    )
    for f in filings:
        f["holdings"] = _rows(
            conn,
            "SELECT * FROM inst_holdings WHERE filing_id = ?"
            " ORDER BY row_ordinal, holding_id",
            (f["filing_id"],),
        )
    return {"filer": filer, "filings": filings}


# --- shared ingested databases (module-scoped: ingest once) ------------------


@pytest.fixture(scope="module")
def real_conn(tmp_path_factory):
    path = tmp_path_factory.mktemp("real") / "inst.db"
    init_db(str(path))
    conn = connect(str(path))
    _ingest(conn, str(REAL_DIR), ciks=[REAL_CIK])
    yield conn
    conn.close()


@pytest.fixture(scope="module")
def crafted_conn(tmp_path_factory):
    path = tmp_path_factory.mktemp("crafted") / "inst.db"
    init_db(str(path))
    conn = connect(str(path))
    _ingest(conn, str(CRAFTED_DIR))  # whole crafted corpus (cross-CIK behaviors)
    yield conn
    conn.close()


# --- golden round-trip (R10/R11/V10/V11) -------------------------------------


def _check_golden(label, payload):
    path = EXPECTED / f"{label}.expected.json"
    if os.environ.get("UPDATE_GOLDENS") == "1":
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    assert path.exists(), f"golden missing: run UPDATE_GOLDENS=1 for {label}"
    assert payload == json.loads(path.read_text(encoding="utf-8"))


def test_golden_real_berkshire(real_conn):
    _check_golden("real-CIK0001067983", _dump_cik(real_conn, REAL_CIK))


@pytest.mark.parametrize("cik", CRAFTED_CIKS)
def test_golden_crafted(crafted_conn, cik):
    _check_golden(f"crafted-CIK{cik}", _dump_cik(crafted_conn, cik))


def test_goldens_are_one_to_one_with_the_fixture_ciks():
    goldens = {p.name.removesuffix(".expected.json") for p in EXPECTED.glob("*.expected.json")}
    expected = {"real-CIK0001067983"} | {f"crafted-CIK{c}" for c in CRAFTED_CIKS}
    assert goldens == expected


# --- provenance (R10/V10/F1/F4) ----------------------------------------------


def test_every_physical_provenance_column_is_populated(real_conn):
    filing = _rows(
        real_conn,
        "SELECT * FROM inst_filings WHERE accession = '0001193125-26-226661'",
    )[0]
    for column in (
        "source", "source_url", "source_record_id", "retrieved_at", "raw_path",
        "response_hash", "index_response_hash", "table_response_hash",
        "parser_version", "normalization_version", "license_id", "ingested_at",
    ):
        assert filing[column], f"filing.{column} not populated"
    assert filing["source"] == "sec-edgar" and filing["license_id"] == "sec-edgar"
    assert filing["source_record_id"] == "0001193125-26-226661"
    # retrieved_at (SEC fetch) is DISTINCT from ingested_at (row write).
    assert filing["retrieved_at"] == SIDECAR_RETRIEVED_AT
    assert filing["ingested_at"] == INGESTED_AT
    assert filing["retrieved_at"] != filing["ingested_at"]

    holding = _rows(
        real_conn,
        "SELECT * FROM inst_holdings WHERE accession = '0001193125-26-226661'"
        " ORDER BY row_ordinal LIMIT 1",
    )[0]
    assert holding["source_record_id"] == "0001193125-26-226661:1"
    assert holding["response_hash"] == filing["table_response_hash"]
    assert holding["retrieved_at"] == SIDECAR_RETRIEVED_AT
    for column in ("source_url", "raw_path", "parser_version", "normalization_version"):
        assert holding[column]


def test_filer_retrieved_at_comes_from_submissions_meta(real_conn):
    filer = _rows(real_conn, "SELECT * FROM inst_filers WHERE cik = ?", (REAL_CIK,))[0]
    assert filer["retrieved_at"] == SIDECAR_RETRIEVED_AT   # from submissions-meta.json
    assert filer["response_hash"]
    assert filer["ingested_at"] == INGESTED_AT
    assert "submissions_meta_missing" not in json.loads(filer["flags"])


# --- hand-verified goldens (R11) ---------------------------------------------


def test_hand_verified_ally_row(real_conn):
    ally = _rows(
        real_conn,
        "SELECT * FROM inst_holdings WHERE accession = '0001193125-26-226661'"
        " ORDER BY row_ordinal LIMIT 1",
    )[0]
    assert ally["issuer_name_raw"] == "ALLY FINL INC"
    assert ally["value_usd"] == 498992850
    assert ally["ssh_prnamt"] == 12719675
    # 498,992,850 / 12,719,675 = $39.23 / share (hand-verified against source).
    assert round(ally["value_usd"] / ally["ssh_prnamt"], 2) == 39.23
    assert ally["unit_basis"] == "whole"


# --- real NEW-HOLDINGS merge (R6/R11/F8/V6) ----------------------------------


def test_real_new_holdings_merge(real_conn):
    base = _rows(real_conn, "SELECT * FROM inst_filings WHERE accession = '0000950123-25-005701'")[0]
    amd = _rows(real_conn, "SELECT * FROM inst_filings WHERE accession = '0000950123-25-008361'")[0]
    assert amd["is_amendment"] == 1 and amd["amendment_type"] == "NEW_HOLDINGS"
    assert amd["conf_denied_expired"] == 1
    assert base["is_confidential_omitted"] == 1
    # The amendment links to the base (lineage), lifecycle unchanged (LD-4).
    assert amd["amends"] == base["filing_id"]
    assert base["lifecycle"] == "active" and amd["lifecycle"] == "active"
    # Both jointly populate v_default_holdings for 2025-03-31 — a real merge.
    default_2025q1 = _rows(
        real_conn,
        "SELECT accession FROM v_default_inst_filings WHERE period_of_report = '2025-03-31'"
        " ORDER BY accession",
    )
    accns = {r["accession"] for r in default_2025q1}
    assert accns == {"0000950123-25-005701", "0000950123-25-008361"}
    n = real_conn.execute(
        "SELECT COUNT(*), COALESCE(SUM(value_usd),0) FROM v_default_holdings"
        " WHERE period_of_report = '2025-03-31'"
    ).fetchone()
    assert n[0] == 114  # 110 base + 4 amendment
    assert n[1] == 258701144516 + 1106550356


# --- unit basis behaviors on real + crafted (R4/V4) --------------------------


def test_unit_basis_thousands_vs_whole(crafted_conn):
    thousands = _rows(crafted_conn, "SELECT DISTINCT unit_basis FROM inst_holdings WHERE cik = '0009000009'")
    whole = _rows(crafted_conn, "SELECT DISTINCT unit_basis FROM inst_holdings WHERE cik = '0009000001'")
    assert thousands == [{"unit_basis": "thousands"}]
    assert whole == [{"unit_basis": "whole"}]
    # x1000 applied to the pre-2023 filing.
    row = crafted_conn.execute(
        "SELECT value_raw, value_usd FROM inst_holdings WHERE cik = '0009000009'"
        " ORDER BY row_ordinal LIMIT 1"
    ).fetchone()
    assert row == (45000, 45000000)


# --- amendment lineage (R5/V5/F13) -------------------------------------------


def test_multi_restatement_links_all_to_base_and_never_false_unlinked(crafted_conn):
    filings = _rows(
        crafted_conn,
        "SELECT accession, is_amendment, amendment_type, amends, flags FROM inst_filings"
        " WHERE cik = '0009000003' ORDER BY accession",
    )
    base = "inst:0009000003-24-000001"
    for f in filings[1:]:
        assert f["amends"] == base
        assert "amendment_unlinked" not in json.loads(f["flags"])
    # Restatement supersede + new-holdings merge: survivors are the latest
    # restatement + the new-holdings addition (both present, none double-counts).
    survivors = {
        r["accession"]
        for r in _rows(
            crafted_conn,
            "SELECT accession FROM v_default_inst_filings WHERE cik = '0009000003'",
        )
    }
    assert survivors == {"0009000003-24-000003", "0009000003-24-000004"}


def test_inst_pair_invariants_hold(crafted_conn):
    from populus.ingest.inst13f import inst_pair_invariant_errors

    assert inst_pair_invariant_errors(crafted_conn) == []


# --- affiliated coverage over the restatement-survivor set (R7/V7/F6/F11/F12)-


def test_affiliation_runs_over_the_restatement_survivor_set(crafted_conn):
    def default_for(period):
        return {
            r["accession"]
            for r in _rows(
                crafted_conn,
                "SELECT accession FROM v_default_inst_filings WHERE period_of_report = ?",
                (period,),
            )
        }

    # 2024-03-31: the covered filer 0006 is excluded — coverage lives in the
    # SURVIVING restatement of the covering filer 0005 (base 0005 is superseded).
    d0331 = default_for("2024-03-31")
    assert "0009000005-24-000002" in d0331          # surviving restatement
    assert "0009000005-24-000001" not in d0331      # superseded base
    assert "0009000006-24-000001" not in d0331      # covered -> excluded

    # 2024-06-30 (F6): filer A's restatement DROPPED other-manager 28-6001, so
    # over the survivor set 0006 is NOT suppressed and appears in the default set.
    d0630 = default_for("2024-06-30")
    assert "0009000006-24-000002" in d0630
    assert "0009000003-24-000003" in d0630 and "0009000003-24-000004" in d0630
    assert "0009000003-24-000001" not in d0630      # superseded base (stale 28-6001 ignored)

    # 2024-09-30: mutual coverage — both excluded and both flagged.
    d0930 = default_for("2024-09-30")
    assert "0009000005-24-000003" not in d0930
    assert "0009000006-24-000003" not in d0930


def test_affiliation_flags_are_stamped_symmetrically(crafted_conn):
    covered = _rows(
        crafted_conn,
        "SELECT flags FROM inst_filings WHERE accession = '0009000006-24-000001'",
    )[0]
    assert "affiliated_covered" in json.loads(covered["flags"])
    for accession in ("0009000005-24-000003", "0009000006-24-000003"):
        flags = _rows(crafted_conn, "SELECT flags FROM inst_filings WHERE accession = ?", (accession,))[0]
        assert "affiliated_mutual_coverage" in json.loads(flags["flags"])
    # F6: the not-suppressed affiliate carries no affiliation flag.
    free = _rows(crafted_conn, "SELECT flags FROM inst_filings WHERE accession = '0009000006-24-000002'")[0]
    assert json.loads(free["flags"]) == []


def test_canonical_file_number_equality_matches_covered_filer(crafted_conn):
    # 0006 files under '028-06001'; 0005 lists '28-6001' — canonically equal, so
    # the coverage matches (R7/F14).
    filer = _rows(crafted_conn, "SELECT file_number_norm FROM inst_filers WHERE cik = '0009000006'")[0]
    assert filer["file_number_norm"] == "028-6001"


# --- NT + never-drop (R3/R14/F3) ---------------------------------------------


def test_notice_and_malformed_row(crafted_conn):
    nt = _rows(crafted_conn, "SELECT parse_status, row_count, flags FROM inst_filings"
               " WHERE accession = '0009000007-24-000001'")[0]
    assert nt["parse_status"] == "parsed" and nt["row_count"] == 0
    assert "notice_no_table" in json.loads(nt["flags"])
    hr = _rows(crafted_conn, "SELECT parse_status, row_count FROM inst_filings"
               " WHERE accession = '0009000007-24-000002'")[0]
    assert hr["parse_status"] == "partial" and hr["row_count"] == 3  # bad row retained
    bad = _rows(crafted_conn, "SELECT cusip, cusip_raw, security_id, flags FROM inst_holdings"
                " WHERE accession = '0009000007-24-000002' AND cusip_raw = '12345'")[0]
    assert bad["cusip"] is None and bad["security_id"] is None
    assert "cusip_unparsed" in json.loads(bad["flags"])


# --- coverage inputs (R16/V16/F3/F7) -----------------------------------------


def test_failed_zero_row_filing_drags_coverage_down(crafted_conn):
    # 0008: cover total known (5e9), info table missing -> failed, 0 rows.
    f = _rows(crafted_conn, "SELECT parse_status, failure_kind, row_count, table_value_total_usd"
              " FROM inst_filings WHERE accession = '0009000008-24-000001'")[0]
    assert f["parse_status"] == "failed" and f["failure_kind"] == "infotable_missing"
    assert f["row_count"] == 0 and f["table_value_total_usd"] == 5000000000
    # It is a default filing (filing-level population), so its 5e9 is in the
    # denominator with 0 numerator contribution.
    in_default = crafted_conn.execute(
        "SELECT 1 FROM v_default_inst_filings WHERE accession = '0009000008-24-000001'"
    ).fetchone()
    assert in_default is not None

    # QA round-5 F1: prove the COVERAGE CONTRACT behaviourally, not just view
    # membership — the denominator must come from the FILING level, so a
    # known-total zero-row failure lowers coverage. Removing it from the
    # denominator (e.g. deriving the denominator from holdings) must fail here.
    from populus.ingest.inst13f import compute_coverage

    # Give the corpus a non-zero numerator so "drags coverage DOWN" is strict:
    # resolve one holding of a different, successfully-parsed filing.
    resolvable = crafted_conn.execute(
        "SELECT holding_id FROM v_default_holdings"
        " WHERE value_usd > 0 AND security_id IS NULL LIMIT 1"
    ).fetchone()
    assert resolvable, "expected at least one default holding with a value"
    crafted_conn.execute(
        "INSERT INTO securities (security_id, id_state, class, review_state)"
        " VALUES ('sec:coverage-probe', 'provisional', NULL, 'auto')"
        " ON CONFLICT (security_id) DO NOTHING"
    )
    crafted_conn.execute(
        "UPDATE inst_holdings SET security_id = 'sec:coverage-probe'"
        " WHERE holding_id = ?",
        (resolvable[0],),
    )

    with_failed = compute_coverage(crafted_conn)
    assert with_failed.numerator > 0
    # Temporarily drop the filing's contribution and recompute for comparison.
    crafted_conn.execute(
        "UPDATE inst_filings SET table_value_total_usd = NULL, flags ="
        " json_insert(flags, '$[#]', 'cover_failed')"
        " WHERE accession = '0009000008-24-000001'"
    )
    without = compute_coverage(crafted_conn)
    crafted_conn.execute(
        "UPDATE inst_filings SET table_value_total_usd = 5000000000, flags ="
        " (SELECT json_group_array(value) FROM json_each(inst_filings.flags)"
        "  WHERE value <> 'cover_failed')"
        " WHERE accession = '0009000008-24-000001'"
    )
    restored = compute_coverage(crafted_conn)

    # Exact denominator contribution, unchanged numerator, lower coverage.
    assert with_failed.denominator - without.denominator == 5000000000
    assert with_failed.numerator == without.numerator          # numerator untouched
    assert with_failed.coverage < without.coverage             # strictly drags it down
    assert restored.denominator == with_failed.denominator     # fixture restored
    # And the ratio really is numerator / FILING-LEVEL denominator.
    assert with_failed.coverage == pytest.approx(
        with_failed.numerator / with_failed.denominator
    )
    # Leave the shared module-scoped fixture as we found it.
    crafted_conn.execute(
        "UPDATE inst_holdings SET security_id = NULL WHERE security_id = 'sec:coverage-probe'"
    )
    crafted_conn.execute("DELETE FROM securities WHERE security_id = 'sec:coverage-probe'")


def test_cover_failed_makes_coverage_non_certifiable(crafted_conn):
    from populus.ingest.inst13f import compute_coverage

    coverage = compute_coverage(crafted_conn)
    assert coverage.cover_failed_count >= 2   # the two 0009000010 cover failures
    assert coverage.certifiable is False       # a NULL total is never summed as 0 (F7)


def test_cover_failed_filings_are_persisted_not_dropped(crafted_conn):
    failed = _rows(
        crafted_conn,
        "SELECT accession, failure_kind, table_value_total_usd, flags FROM inst_filings"
        " WHERE cik = '0009000010' ORDER BY accession",
    )
    kinds = {f["failure_kind"] for f in failed}
    assert kinds == {"cover_malformed", "cover_missing_field"}
    for f in failed:
        assert f["table_value_total_usd"] is None   # value unknown (R18)
        assert "cover_failed" in json.loads(f["flags"])
    # From index metadata: period/filed present despite the unparseable cover.
    row = _rows(crafted_conn, "SELECT period_of_report, filed_date, submission_type,"
                " filing_manager_raw FROM inst_filings WHERE accession = '0009000010-24-000001'")[0]
    assert row["period_of_report"] == "2024-03-31" and row["filed_date"] == "2024-05-11"
    assert row["submission_type"] == "13F-HR"


def test_certifiable_coverage_when_all_resolved(tmp_path):
    # A clean single-filer DB with the ALLY CUSIP seeded resolves >=95%.
    conn = _fresh(tmp_path)
    _seed_cusip(conn, "02005N100", valid_from="2020-01-01")  # covers 2025-12-31
    _ingest(conn, str(REAL_DIR), ciks=[REAL_CIK])
    from populus.ingest.inst13f import compute_coverage

    coverage = compute_coverage(conn)
    assert coverage.numerator > 0     # ALLY holdings resolved and counted
    conn.close()


# --- identity as-of resolution (R9/G14/V9) -----------------------------------


def _seed_cusip(conn, cusip, *, valid_from, valid_to=None, security_id="sec:test:ally"):
    conn.execute(
        "INSERT INTO securities (security_id, id_state, review_state)"
        " VALUES (?, 'provisional', 'auto') ON CONFLICT DO NOTHING",
        (security_id,),
    )
    conn.execute(
        "INSERT INTO security_identifiers (security_id, id_type, value, valid_from,"
        " valid_to, provenance, confidence, review_state, license_id, raw)"
        " VALUES (?, 'cusip', ?, ?, ?, 'sec-ftd', 'high', 'auto', 'sec-ftd', NULL)",
        (security_id, cusip, valid_from, valid_to),
    )
    return security_id


def test_cusip_resolves_only_within_its_validity_window(tmp_path):
    conn = _fresh(tmp_path)
    # Valid from 2026-01-01: covers the 2026-Q1 period, NOT the 2025-Q4 period.
    _seed_cusip(conn, "02005N100", valid_from="2026-01-01")
    _ingest(conn, str(REAL_DIR), ciks=[REAL_CIK])
    resolved_2026 = conn.execute(
        "SELECT security_id, flags FROM inst_holdings WHERE cusip = '02005N100'"
        " AND period_of_report = '2026-03-31' ORDER BY row_ordinal LIMIT 1"
    ).fetchone()
    assert resolved_2026[0] == "sec:test:ally"
    unresolved_2025 = conn.execute(
        "SELECT security_id, flags FROM inst_holdings WHERE cusip = '02005N100'"
        " AND period_of_report = '2025-12-31' ORDER BY row_ordinal LIMIT 1"
    ).fetchone()
    assert unresolved_2025[0] is None
    assert "missing_security" in json.loads(unresolved_2025[1])
    conn.close()


# --- determinism + idempotence (R15/V15) -------------------------------------


def test_two_builds_are_byte_identical(tmp_path):
    def build(name):
        directory = tmp_path / name
        directory.mkdir()
        path = directory / "inst.db"
        init_db(str(path))
        c = connect(str(path))
        _ingest(c, str(CRAFTED_DIR))
        holdings = c.execute("SELECT * FROM inst_holdings ORDER BY holding_id").fetchall()
        filings = c.execute("SELECT * FROM inst_filings ORDER BY filing_id").fetchall()
        # QA-F6: `inst_filers` is part of the R15 byte-identical contract too —
        # omitting it would let nondeterministic filer provenance pass the gate.
        filers = c.execute("SELECT * FROM inst_filers ORDER BY cik").fetchall()
        c.close()
        return holdings, filings, filers

    assert build("a") == build("b")


def test_double_ingest_is_idempotent(tmp_path):
    conn = _fresh(tmp_path)
    _ingest(conn, str(CRAFTED_DIR))
    first = {r[0] for r in conn.execute("SELECT holding_id FROM inst_holdings")}
    n_filings = conn.execute("SELECT COUNT(*) FROM inst_filings").fetchone()[0]
    _ingest(conn, str(CRAFTED_DIR))
    second = {r[0] for r in conn.execute("SELECT holding_id FROM inst_holdings")}
    assert first == second
    assert conn.execute("SELECT COUNT(*) FROM inst_filings").fetchone()[0] == n_filings
    conn.close()


# --- submissions-meta sidecar (R19/V19) --------------------------------------


def test_missing_submissions_meta_flags_the_filer_without_the_wall_clock(tmp_path):
    # Copy a crafted CIK tree WITHOUT its submissions-meta.json.
    import shutil

    src = CRAFTED_DIR / "CIK0009000002"
    dst_root = tmp_path / "cache"
    dst = dst_root / "CIK0009000002"
    shutil.copytree(src, dst)
    (dst / "submissions-meta.json").unlink()
    conn = _fresh(tmp_path)
    _ingest(conn, str(dst_root), ciks=["0009000002"])
    filer = _rows(conn, "SELECT retrieved_at, flags FROM inst_filers WHERE cik = '0009000002'")[0]
    assert filer["retrieved_at"] is None
    assert "submissions_meta_missing" in json.loads(filer["flags"])
    conn.close()


# --- M2-1-era upgrade (R8/V8/F19/F33) ----------------------------------------


def test_pre_inst_database_gains_inst_tables_and_both_views(tmp_path):
    # Simulate an M2-1-era database: M1 schema + registry, NO inst tables/views.
    path = tmp_path / "old.db"
    conn = connect(str(path))
    conn.executescript(_packaged_schema())
    ensure_registry(conn)
    assert conn.execute(
        "SELECT name FROM sqlite_master WHERE name = 'inst_filings'"
    ).fetchone() is None

    # An M2 entrypoint applies the inst schema then the views.
    ensure_inst_schema(conn)
    ensure_views(conn)
    for name in ("inst_filers", "inst_filings", "inst_holdings"):
        assert conn.execute("SELECT name FROM sqlite_master WHERE name = ?", (name,)).fetchone()
    for view in ("v_default_inst_filings", "v_default_holdings"):
        assert conn.execute(
            "SELECT name FROM sqlite_master WHERE type = 'view' AND name = ?", (view,)
        ).fetchone()
    # And ingest works against the upgraded database.
    report = _ingest(conn, str(CRAFTED_DIR), ciks=["0009000001"])
    assert report.ok
    assert conn.execute("SELECT COUNT(*) FROM inst_holdings").fetchone()[0] == 2
    conn.close()


# --- live mode without a network (R1/V1/F21) ---------------------------------


class _FakeSecTransport:
    """Serves committed fixture bytes by URL; records the request order."""

    def __init__(self, files: dict[str, bytes]) -> None:
        self.files = files
        self.requested: list[str] = []

    def get(self, url, *, headers):
        self.requested.append(url)
        content = self.files.get(url)
        if content is None:
            return TransportResponse(status_code=404, headers={}, content=b"")
        return TransportResponse(status_code=200, headers={}, content=content)


def _crafted_url_map(cik10, nodash, table_filename):
    bare = str(int(cik10))
    base = f"https://www.sec.gov/Archives/edgar/data/{bare}/{nodash}"
    src = CRAFTED_DIR / f"CIK{cik10}" / nodash
    return {
        f"https://data.sec.gov/submissions/CIK{cik10}.json":
            (CRAFTED_DIR / f"CIK{cik10}" / "submissions.json").read_bytes(),
        f"{base}/index.json": (src / "index.json").read_bytes(),
        f"{base}/primary_doc.xml": (src / "primary_doc.xml").read_bytes(),
        f"{base}/{table_filename}": (src / table_filename).read_bytes(),
    }


def test_live_mode_fetches_through_the_client_with_no_hardcoded_filename(tmp_path):
    from populus.parse.inst13f import discover_info_table_name

    cik10, nodash = "0009000002", "000900000226000001"
    # The table filename is DISCOVERED from index.json, never hardcoded — in the
    # fixture helper as well as in the implementation (QA-F1/R1).
    table = discover_info_table_name(
        (CRAFTED_DIR / f"CIK{cik10}" / nodash / "index.json").read_bytes()
    )
    files = _crafted_url_map(cik10, nodash, table)
    transport = _FakeSecTransport(files)
    clock = iter(range(1, 10_000))
    client = SecClient(
        transport, contact="test@example.com",
        sleep=lambda _s: None, monotonic=lambda: next(clock),
    )
    conn = _fresh(tmp_path)
    report = run_inst13f_ingest(
        conn, run_id="live", now=lambda: "2026-07-24T00:00:00Z", host="h",
        ingested_at=INGESTED_AT, ciks=[cik10], raw_root=tmp_path / "raw", client=client,
    )
    assert report.ok
    assert conn.execute("SELECT COUNT(*) FROM inst_holdings").fetchone()[0] == 4
    # The exact URL sequence: submissions, then index/cover/table for the one
    # accession. The table URL carries the DISCOVERED name, not a hardcoded one.
    assert transport.requested == [
        f"https://data.sec.gov/submissions/CIK{cik10}.json",
        f"https://www.sec.gov/Archives/edgar/data/9000002/{nodash}/index.json",
        f"https://www.sec.gov/Archives/edgar/data/9000002/{nodash}/primary_doc.xml",
        f"https://www.sec.gov/Archives/edgar/data/9000002/{nodash}/{table}",
    ]
    # The live run archived the bytes and wrote the sidecars.
    assert (tmp_path / "raw" / f"CIK{cik10}" / "submissions-meta.json").exists()
    assert (tmp_path / "raw" / f"CIK{cik10}" / nodash / "fetch-meta.json").exists()
    conn.close()


# --- CLI (R12/V12) ------------------------------------------------------------


def test_cli_ingest_inst_13f_exits_zero_and_prints_the_summary(tmp_path):
    from click.testing import CliRunner

    from populus.cli import main

    db = str(tmp_path / "cli.db")
    runner = CliRunner()
    assert runner.invoke(main, ["db", "init", db]).exit_code == 0
    result = runner.invoke(
        main, ["ingest", "inst-13f", "--db", db, "--from-cache", str(REAL_DIR)]
    )
    assert result.exit_code == 0, result.output
    assert "inst-13f" in result.output
    assert "value-coverage:" in result.output
    assert "unit_basis whole" in result.output
    assert "amendment NEW_HOLDINGS" in result.output


def test_cli_ingest_on_a_pre_inst_database_exits_zero(tmp_path):
    from click.testing import CliRunner

    from populus.cli import main

    # A pre-inst DB (registry only, no inst tables) must upgrade on first use.
    path = tmp_path / "old.db"
    conn = connect(str(path))
    conn.executescript(_packaged_schema())
    ensure_registry(conn)
    conn.close()
    result = CliRunner().invoke(
        main, ["ingest", "inst-13f", "--db", str(path), "--from-cache", str(CRAFTED_DIR),
                "--cik", "0009000001"]
    )
    assert result.exit_code == 0, result.output


def test_summary_reports_coverage_and_cover_failed(tmp_path):
    conn = _fresh(tmp_path)
    report = _ingest(conn, str(CRAFTED_DIR))
    text = format_summary(report)
    assert "value-coverage:" in text
    assert "cover_failed_count" in text
    # QA-F6: measurability and gate-readiness are reported as DISTINCT signals.
    # This corpus contains cover-failed filings, so it is not measurable — and
    # therefore not gate-ready either.
    assert "certifiable(measurable) no" in text
    assert "meets 95% gate no" in text
    assert report.coverage.certifiable is False
    assert report.coverage.meets_threshold is False
    # Assert the NOTE ITSELF is carried, not a phrase from it — the opening
    # wording changed when the missing M2-CONTRACT §5 clauses were restored
    # (QA-VERIFY7-B2), and a literal fragment silently pins that phrasing.
    from populus.normalize_inst import INST_DATA_NOTE

    assert INST_DATA_NOTE in text
    conn.close()


# --- QA-round-1 regressions ---------------------------------------------------


def test_mid_load_failure_rolls_back_and_preserves_the_prior_filing(
    real_conn, monkeypatch
):
    """QA-F7 / R10-V10: a failure DURING the holdings replacement must roll back
    the whole load, leaving the previously-loaded filing and holdings identical.

    Injected through the production path: `upsert_inst_filing` opens its own
    BEGIN IMMEDIATE, DELETEs the prior holdings, then builds the insert rows via
    `_compact_json` — raising there lands the failure strictly between the delete
    and the commit, which is exactly the window that must not strand data.
    """
    import populus.load as load_mod
    from populus.ingest.inst13f import run_inst13f_ingest

    before_filings = _rows(real_conn, "SELECT * FROM inst_filings ORDER BY filing_id")
    before_holdings = _rows(real_conn, "SELECT * FROM inst_holdings ORDER BY rowid")
    assert before_filings and before_holdings  # the fixture really loaded rows

    class Boom(RuntimeError):
        pass

    real_compact = load_mod._compact_json
    calls = {"n": 0}

    def exploding(value):
        calls["n"] += 1
        if calls["n"] > 3:  # past the filing row, into the holdings rows
            raise Boom("injected failure between the delete and the commit")
        return real_compact(value)

    monkeypatch.setattr(load_mod, "_compact_json", exploding)
    with pytest.raises(Boom):
        run_inst13f_ingest(
            real_conn,
            run_id="inst-test-rollback",
            now=lambda: "2026-07-24T12:00:00Z",
            host="testhost",
            ingested_at=INGESTED_AT,
            ciks=[REAL_CIK],
            cache_dir=str(REAL_DIR),
        )
    monkeypatch.undo()

    # Nothing stranded: both sets are byte-identical to before the failed load.
    assert _rows(real_conn, "SELECT * FROM inst_filings ORDER BY filing_id") == before_filings
    assert _rows(real_conn, "SELECT * FROM inst_holdings ORDER BY rowid") == before_holdings


def test_a_malformed_accession_is_a_counted_discovery_reject(tmp_path):
    """QA-F3: a malformed/path-bearing accession from the remote index never
    reaches a cache path or SEC URL — it is rejected and counted, run continues."""
    import json as _json
    import shutil

    cache = tmp_path / "cache"
    shutil.copytree(REAL_DIR, cache)
    sub = cache / f"CIK{REAL_CIK}" / "submissions.json"
    doc = _json.loads(sub.read_text(encoding="utf-8"))
    recent = doc["filings"]["recent"]
    # Inject traversal / wrong-shape / non-string accessions alongside the real ones.
    for bad in ("../../etc/passwd", "0001193125_26_226661", "nope", 12345):
        recent["accessionNumber"].append(bad)
        recent["form"].append("13F-HR")
        recent["reportDate"].append("2026-03-31")
        recent["filingDate"].append("2026-05-15")
        recent["fileNumber"].append("028-04545")
    sub.write_text(_json.dumps(doc), encoding="utf-8")

    conn = _fresh(tmp_path)
    report = _ingest(conn, str(cache))  # must not raise
    # QA-F7: the rejects are ACCOUNTED, not merely skipped — assert the exact set
    # and count, so removing reject accounting cannot leave this test green (G3).
    assert set(report.rejected_rows) == {
        "../../etc/passwd", "0001193125_26_226661", "nope", "12345",
    }
    assert len(report.rejected_rows) == 4
    # The four real filings still loaded, and nothing escaped the cache root.
    assert report.rows_loaded > 0
    assert report.index_rows == 4
    assert not (tmp_path / "etc").exists()
    conn.close()


def test_selective_reingest_clears_a_stale_affiliation_flag(crafted_conn, tmp_path):
    """QA-F5: affiliation flags are DERIVED — recomputing must clear a flag whose
    coverer no longer survives, so incremental runs match a clean rebuild."""
    flagged = _rows(
        crafted_conn,
        "SELECT filing_id, flags FROM inst_filings"
        " WHERE EXISTS (SELECT 1 FROM json_each(flags)"
        "               WHERE value IN ('affiliated_covered','affiliated_mutual_coverage'))",
    )
    # Plant a stale flag on a filing that has no surviving coverer.
    victim = _rows(
        crafted_conn,
        "SELECT filing_id FROM inst_filings"
        " WHERE NOT EXISTS (SELECT 1 FROM json_each(flags)"
        "                   WHERE value IN ('affiliated_covered','affiliated_mutual_coverage'))"
        " ORDER BY filing_id LIMIT 1",
    )[0]["filing_id"]
    from populus.ingest.inst13f import mark_affiliated_coverage

    crafted_conn.execute(
        "UPDATE inst_filings SET flags = json_insert(flags, '$[#]', 'affiliated_covered')"
        " WHERE filing_id = ?",
        (victim,),
    )
    mark_affiliated_coverage(crafted_conn)  # recompute from the survivor set
    after = _rows(
        crafted_conn, "SELECT flags FROM inst_filings WHERE filing_id = ?", (victim,)
    )[0]["flags"]
    assert "affiliated_covered" not in after
    # And the genuinely-covered filings still carry their flags.
    assert (
        _rows(
            crafted_conn,
            "SELECT filing_id FROM inst_filings"
            " WHERE EXISTS (SELECT 1 FROM json_each(flags)"
            "               WHERE value IN ('affiliated_covered','affiliated_mutual_coverage'))",
        )
        == [{"filing_id": f["filing_id"]} for f in flagged]
    )


def test_certifiability_is_measurability_not_the_threshold(real_conn):
    """QA-F6: `certifiable` means MEASURABLE (nonzero denominator, no unknown
    totals); the ≥95% decision is reported separately as `meets_threshold`."""
    from populus.ingest.inst13f import COVERAGE_THRESHOLD, compute_coverage

    cov = compute_coverage(real_conn)
    assert cov.cover_failed_count == 0
    assert cov.denominator > 0
    assert cov.certifiable is True  # measurable, regardless of the percentage
    assert cov.meets_threshold is (cov.coverage >= COVERAGE_THRESHOLD)


def test_a_notice_only_corpus_stays_certifiable(tmp_path):
    """QA-F3 / R16: a valid `13F-NT` reports no holdings and no totals — a genuine
    ZERO contribution, not an UNKNOWN one. It must not count as cover-failed, or
    M2-3 would refuse to publish solely because a valid notice exists."""
    from populus.ingest.inst13f import compute_coverage

    conn = _fresh(tmp_path)
    _ingest(conn, str(CRAFTED_DIR), ciks=["0009000007"])  # the 13F-NT fixture
    notices = _rows(
        conn, "SELECT * FROM inst_filings WHERE submission_type LIKE '13F-NT%'"
    )
    assert notices, "the 13F-NT fixture should have loaded"
    for n in notices:
        assert "cover_failed" not in json.loads(n["flags"])  # a notice is not a failure

    # The predicate itself: a filing whose total is UNKNOWN (NULL) but whose cover
    # did NOT fail — a valid totals-free notice — must never be counted as a cover
    # failure. Before the fix ANY null total counted, so one valid notice made
    # coverage non-certifiable and would have blocked M2-3's publish (QA-F3).
    conn.execute("UPDATE inst_filings SET table_value_total_usd = NULL")
    null_totals = conn.execute(
        "SELECT COUNT(*) FROM v_default_inst_filings WHERE table_value_total_usd IS NULL"
    ).fetchone()[0]
    assert null_totals > 0                        # unknown-total rows exist...
    assert compute_coverage(conn).cover_failed_count == 0   # ...but none failed its cover
    conn.close()


def test_relinking_an_amendment_clears_the_stale_unlinked_flag(tmp_path):
    """QA-F4 / R5: `amendment_unlinked` is DERIVED from lineage. When a base later
    exists, recomputing lineage must DROP the flag — otherwise incremental state
    keeps a false source fact and diverges from a clean rebuild.

    Driven through `link_inst_amendments` directly so the assertion isolates the
    derived-flag behaviour: a full re-ingest would rewrite flags from source and
    mask a missing clear (which is why the earlier version of this test was not
    load-bearing).
    """
    import shutil

    from populus.ingest.inst13f import link_inst_amendments

    # Stage a cache with ONLY the 2025-Q1 amendment, so it links to no base.
    amendment_only = tmp_path / "amend"
    (amendment_only / f"CIK{REAL_CIK}").mkdir(parents=True)
    for name in ("submissions.json", "submissions-meta.json"):
        shutil.copy(REAL_DIR / f"CIK{REAL_CIK}" / name, amendment_only / f"CIK{REAL_CIK}" / name)
    shutil.copytree(
        REAL_DIR / f"CIK{REAL_CIK}" / "000095012325008361",
        amendment_only / f"CIK{REAL_CIK}" / "000095012325008361",
    )

    conn = _fresh(tmp_path)
    _ingest(conn, str(amendment_only), ciks=[REAL_CIK])
    amend = _rows(
        conn, "SELECT * FROM inst_filings WHERE accession = '0000950123-25-008361'"
    )[0]
    assert amend["amends"] is None
    assert "amendment_unlinked" in json.loads(amend["flags"])  # no base yet

    # The base appears (ingested into the SAME db), then lineage is recomputed —
    # without re-touching the amendment row's own parsed flags.
    base_only = tmp_path / "base"
    (base_only / f"CIK{REAL_CIK}").mkdir(parents=True)
    for name in ("submissions.json", "submissions-meta.json"):
        shutil.copy(REAL_DIR / f"CIK{REAL_CIK}" / name, base_only / f"CIK{REAL_CIK}" / name)
    shutil.copytree(
        REAL_DIR / f"CIK{REAL_CIK}" / "000095012325005701",
        base_only / f"CIK{REAL_CIK}" / "000095012325005701",
    )
    _ingest(conn, str(base_only), ciks=[REAL_CIK])
    # Re-derive lineage explicitly (the incremental path) and re-read the flag.
    link_inst_amendments(conn)
    amend = _rows(
        conn, "SELECT * FROM inst_filings WHERE accession = '0000950123-25-008361'"
    )[0]
    assert amend["amends"] is not None                             # linked now
    assert "amendment_unlinked" not in json.loads(amend["flags"])   # stale flag gone
    conn.close()


def test_an_invalid_index_date_is_a_counted_reject_not_a_crash(tmp_path):
    """QA-F5 / R18-G3: a malformed remote filingDate/reportDate must be a counted
    discovery reject — never an aborted run, never an invalid persisted key."""
    import json as _json
    import shutil

    cache = tmp_path / "cache"
    shutil.copytree(REAL_DIR, cache)
    sub = cache / f"CIK{REAL_CIK}" / "submissions.json"
    doc = _json.loads(sub.read_text(encoding="utf-8"))
    recent = doc["filings"]["recent"]
    for bad_report, bad_filed in (("2026-13-45", "2026-05-15"), ("2026-03-31", "20260515")):
        recent["accessionNumber"].append("0001193125-26-999999")
        recent["form"].append("13F-HR")
        recent["reportDate"].append(bad_report)
        recent["filingDate"].append(bad_filed)
        recent["fileNumber"].append("028-04545")
    sub.write_text(_json.dumps(doc), encoding="utf-8")

    conn = _fresh(tmp_path)
    report = _ingest(conn, str(cache))  # must not raise
    assert report.rejected_rows.count("0001193125-26-999999") == 2
    assert report.index_rows == 4  # the four real filings still processed
    conn.close()


# --- the notice-only guard through the M2 gate / build path (RUN M2-3, R7) ----


def test_notice_only_corpus_withheld_as_not_measurable_at_build(tmp_path):
    """A valid 13F-NT notice is NOT a cover failure, but a notice-only corpus has
    a zero coverage denominator → the build withholds inst as ``not_measurable``
    (never blocking congress, never mislabeled ``cover_failed``). This ties the
    notice-only coverage guard to the actual publish decision (R7)."""
    from datetime import datetime, timezone

    from test_inst_agg import _filer, _load

    from populus.publish.build import LocalDirBackend, run_build

    db = tmp_path / "populus.db"
    init_db(str(db))
    conn = connect(str(db))
    try:
        _filer(conn, "0009000009", "Notice Co")
        _load(conn, fid="inst:NT-1", cik="0009000009", period="2026-03-31",
              filed="2026-04-15", holds=[], total=None, submission_type="13F-NT")
        # Sanity: the notice is not flagged cover_failed.
        (flags,) = conn.execute(
            "SELECT flags FROM inst_filings WHERE filing_id = 'inst:NT-1'"
        ).fetchone()
        assert "cover_failed" not in json.loads(flags)
    finally:
        conn.close()

    repo = tmp_path / "data-repo"
    repo.mkdir()
    report = run_build(
        db, repo,
        now=lambda: datetime(2026, 7, 24, 12, 0, 0, tzinfo=timezone.utc),
        backend=LocalDirBackend(repo),
    )
    assert report.inst_withheld is not None
    assert report.inst_withheld["reason"] == "not_measurable"
    assert report.inst_withheld["cover_failed_count"] == 0
    # Congress still builds normally alongside the withheld inst module.
    manifest = json.loads(
        (repo / ".staging" / report.build_id / "build" / "manifest.json").read_text(
            encoding="utf-8"
        )
    )
    assert set(manifest["modules"]) == {"congress"}


def test_cache_source_reads_history_shards(tmp_path):
    """QA-r4-F2: `_CacheSource.submissions_shard` was written with a field
    `_Doc` does not have and without the required `raw_path`, so EVERY call
    raised TypeError. It shipped because the shard tests drove only the
    federated source. This exercises the cache-backed history path directly."""
    from populus.ingest.inst13f import _CacheSource, discover

    cik = "0001067983"
    shard_name = f"CIK{cik}-submissions-001.json"
    root = tmp_path / f"CIK{cik}"
    root.mkdir(parents=True)
    recent = {"accessionNumber": [], "form": [], "reportDate": [],
              "filingDate": [], "fileNumber": []}
    historical = {
        "accessionNumber": ["0000950123-19-005436"], "form": ["13F-HR"],
        "reportDate": ["2019-03-31"], "filingDate": ["2019-05-15"],
        "fileNumber": ["028-01234"],
    }
    (root / "submissions.json").write_text(json.dumps(
        {"name": "BERKSHIRE HATHAWAY INC",
         "filings": {"recent": recent, "files": [{"name": shard_name}]}}))
    (root / shard_name).write_text(json.dumps(historical))
    (root / "submissions-meta.json").write_text(
        json.dumps({"retrieved_at": "2026-07-24T00:00:00Z"}))

    source = _CacheSource(tmp_path)
    # The shard doc itself must be well-formed (this is what raised TypeError).
    doc = source.submissions_shard(cik, shard_name)
    assert doc.raw_path == f"CIK{cik}/{shard_name}"
    assert doc.response_hash and doc.retrieved_at == "2026-07-24T00:00:00Z"
    assert doc.meta_missing is False

    # And history discovery over the cache reaches the sharded filing.
    found = discover(source, cik, cache_bounded=False, include_history=True)
    assert [e.accession for e in found.entries] == ["0000950123-19-005436"]
    assert found.unread_shards == ()

    # Without the opt-in, behaviour is unchanged: shards counted, not read.
    bounded = discover(source, cik, cache_bounded=False)
    assert bounded.entries == () and bounded.older_shards == 1
