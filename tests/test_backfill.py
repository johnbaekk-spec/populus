"""kadoa backfill: id grammar, classification, import, crosswalk, and the
full fail-closed §9.6 audit gate (RUN 4; R5–R7, R16, R19–R22).

Scorer tests each violate exactly one check and assert the fail-closed
outcome — no threshold claim, no binomial bound — plus the clean pass path.
Cache-gated tests derive expectations from the committed seed file itself.
"""

from __future__ import annotations

import hashlib
import json
from pathlib import Path

import pytest
from click.testing import CliRunner

from populus import backfill
from populus.backfill import (
    CRITICAL_FIELDS,
    EQUITY_CLASS_MAP,
    FOLLOWUP_N,
    MIN_PER_STRATUM,
    SNAPSHOT_FIELDS,
    SRS_N,
    apply_crosswalk,
    build_audit_worksheet,
    build_draw_record,
    classify_row,
    equity_class,
    ids_digest,
    kadoa_parsed_row,
    parse_kadoa_id,
    population_digest,
    population_snapshot,
    row_stratum,
    run_audit_draw,
    run_backfill_ingest,
    score_audit,
    select_sample,
    year_band,
)
from populus.cli import main as cli_main

REPO_ROOT = Path(__file__).resolve().parent.parent
TRADES = REPO_ROOT / "data-cache" / "kadoa" / "trades.json"

NOW = lambda: "2026-07-23T00:00:00Z"  # noqa: E731


# --- record factory -----------------------------------------------------------


def _record(i, *, chamber="house", **overrides):
    if chamber == "house":
        key = str(20000000 + i)
        record_id = f"house_{key}_g0"
        doc_url = (
            "https://disclosures-clerk.house.gov/public_disc/ptr-pdfs/2026/"
            f"{key}.pdf"
        )
        source_id = "house_clerk"
    else:
        key = f"00000000-0000-4000-8000-{i:012d}"
        record_id = f"senate_{key}_t0"
        doc_url = f"https://efdsearch.senate.gov/search/view/ptr/{key}/"
        source_id = "senate_efd"
    record = {
        "id": record_id,
        "source_id": source_id,
        "branch": "congress",
        "chamber": chamber,
        "transaction_date": "2026-06-01",
        "filing_date": "2026-06-10",
        "owner": "SP",
        "ticker": "AAPL",
        "asset_name": f"Asset {i}",
        "asset_type": "ST" if chamber == "house" else "Stock",
        "transaction_type": "Purchase",
        "amount_range_low": 1001,
        "amount_range_high": 15000,
        "amount_range_label": "$1,001 - $15,000",
        "days_to_file": 9,
        "is_late": 0,
        "comment": None,
        "filer_name": "Doe, Jane",
        "state": "CA",
        "office": "U.S. Representative · CA-12",
        "doc_url": doc_url,
    }
    record.update(overrides)
    return record


def _oge_record(i=0):
    return {
        "id": f"oge_Some-Person-{i}_pdf_g0",
        "source_id": "oge_executive",
        "branch": "executive",
        "chamber": None,
        "filing_date": "2026-06-10",
        "transaction_date": "2026-06-01",
        "filer_name": "Some Person",
        "doc_url": "https://extapps2.oge.gov/whatever.pdf",
        "transaction_type": "Purchase",
        "amount_range_label": "$1,001 - $15,000",
    }


def _import(conn, records, tmp_path, run_id="bf-test"):
    trades = tmp_path / "trades.json"
    trades.write_text(json.dumps(records), encoding="utf-8")
    return run_backfill_ingest(
        conn, trades_path=trades, run_id=run_id, now=NOW, host="test"
    )


# --- id grammar (R5) ----------------------------------------------------------


@pytest.mark.parametrize(
    "raw,chamber,key,generation",
    [
        ("house_20035047_t2", "house", "20035047", "t"),
        ("house_9106099_g0", "house", "9106099", "g"),
        (
            "senate_392ac3e5-07f6-4f8c-840f-84e9066ffb29_t0",
            "senate",
            "392ac3e5-07f6-4f8c-840f-84e9066ffb29",
            "t",
        ),
        (
            "senate_392ac3e5-07f6-4f8c-840f-84e9066ffb29_g3",
            "senate",
            "392ac3e5-07f6-4f8c-840f-84e9066ffb29",
            "g",
        ),
    ],
)
def test_parse_kadoa_id_accepts_both_generation_letters(raw, chamber, key, generation):
    parsed = parse_kadoa_id(raw)
    assert (parsed.chamber, parsed.document_key, parsed.generation) == (
        chamber,
        key,
        generation,
    )


@pytest.mark.parametrize(
    "raw",
    [
        "oge_Some-Person_pdf_g0",  # not a congressional chamber
        "house_notdigits_g0",  # house key must be numeric
        "senate_20035047_t0",  # senate key must be a uuid
        "house_20035047_x0",  # unknown generation letter
        "house_20035047",  # missing generation suffix
        "",
        None,
        42,
    ],
)
def test_parse_kadoa_id_rejects_malformed(raw):
    assert parse_kadoa_id(raw) is None


# --- classification (R5) ------------------------------------------------------


def test_classify_row_outcomes():
    assert classify_row(_record(1)) == "congress"
    assert classify_row(_record(2, chamber="senate")) == "congress"
    assert classify_row(_oge_record()) == "oge"
    # branch=executive dominates even with congressional-looking fields.
    assert classify_row(dict(_record(3), branch="executive")) == "oge"
    assert classify_row(dict(_record(4), source_id="oge_executive")) == "oge"
    # Mixed signals and structural defects are invalid, never imported.
    assert classify_row(dict(_record(5), source_id="senate_efd")) == "invalid"
    assert classify_row(dict(_record(6), chamber="governor")) == "invalid"
    assert classify_row(dict(_record(7), id="house_bad")) == "invalid"
    assert (
        classify_row(dict(_record(8), id="senate_00000000-0000-4000-8000-000000000001_t0"))
        == "invalid"
    )  # id chamber != record chamber
    assert classify_row(dict(_record(9), filing_date=None)) == "invalid"
    assert classify_row(dict(_record(10), doc_url="")) == "invalid"
    assert classify_row(dict(_record(11), filer_name=None)) == "invalid"
    assert classify_row("not a mapping") == "invalid"
    assert classify_row(dict(_record(12), branch=None)) == "invalid"


# --- import (R5) --------------------------------------------------------------


def test_import_congress_rows_and_exclusions(initialized_db, tmp_path):
    records = [
        _record(1),
        _record(2, id="house_20000002_t1"),  # `_t` suffix accepted
        _record(3, chamber="senate"),
        _oge_record(),
        dict(_record(4), id="house_bad"),  # invalid
    ]
    report = _import(initialized_db, records, tmp_path)
    assert (report.total, report.imported, report.excluded_oge, report.excluded_invalid) == (
        5,
        3,
        1,
        1,
    )
    assert report.reconciled
    assert not report.ok  # an invalid row makes the run not-ok
    assert report.invalid_samples == ("'house_bad'",)

    # Identity is the settled full-id contract; the OGE row is provably absent.
    filings = {
        f for (f,) in initialized_db.execute("SELECT filing_id FROM filings")
    }
    assert filings == {
        "kadoa:house_20000001_g0",
        "kadoa:house_20000002_t1",
        "kadoa:senate_00000000-0000-4000-8000-000000000003_t0",
    }
    assert initialized_db.execute(
        "SELECT COUNT(*) FROM filings WHERE filer_name_raw = 'Some Person'"
    ).fetchone() == (0,)

    # Run audit row in the standard shape.
    row = initialized_db.execute(
        "SELECT job, status, new_filings, rows_loaded, parse_failures"
        " FROM ingest_runs WHERE run_id = 'bf-test'"
    ).fetchone()
    assert row == ("congress-backfill", "partial", 3, 3, 1)


def test_import_stamping_and_seven_key_raw_row(initialized_db, tmp_path):
    _import(initialized_db, [_record(1, comment="hello  world")], tmp_path)
    filing = initialized_db.execute(
        "SELECT chamber, filer_name_raw, filing_kind, filed_date, source,"
        " license_id, parse_status, lifecycle FROM filings"
    ).fetchone()
    assert filing == (
        "house",
        "Doe, Jane",
        "ptr",
        "2026-06-10",
        "kadoa",
        "mit-kadoa-seed",
        "parsed",
        "active",
    )
    raw_row, source, license_id, kadoa_id, chamber, filed = initialized_db.execute(
        "SELECT raw_row, source, license_id, kadoa_id, chamber, filed_date"
        " FROM transactions"
    ).fetchone()
    assert set(json.loads(raw_row)) == {
        "owner",
        "asset_name",
        "ticker",
        "side",
        "transaction_date",
        "amount_label",
        "comment",
    }
    assert (source, license_id, kadoa_id, chamber, filed) == (
        "kadoa",
        "mit-kadoa-seed",
        "house_20000001_g0",
        "house",
        "2026-06-10",
    )


def test_import_is_idempotent(initialized_db, tmp_path):
    records = [_record(i) for i in range(1, 6)]
    first = _import(initialized_db, records, tmp_path, run_id="bf-1")
    before = initialized_db.execute(
        "SELECT txn_id FROM transactions ORDER BY txn_id"
    ).fetchall()
    second = _import(initialized_db, records, tmp_path, run_id="bf-2")
    after = initialized_db.execute(
        "SELECT txn_id FROM transactions ORDER BY txn_id"
    ).fetchall()
    assert first.imported == second.imported == 5
    assert before == after
    assert initialized_db.execute("SELECT COUNT(*) FROM filings").fetchone() == (5,)


def test_kadoa_row_normalization_recomputes_date_stats():
    # The seed's own days_to_file/is_late are never trusted (LD17): this
    # record lies about both; the mapping recomputes from the two dates.
    record = _record(
        1,
        transaction_date="2026-01-01",
        filing_date="2026-04-01",
        days_to_file=1,
        is_late=0,
        transaction_type="Sale (Full)",
        owner="Joint",
        ticker=None,
    )
    row = kadoa_parsed_row(record)
    assert row.days_to_file == 90
    assert row.is_late == 1
    assert row.side == "sale"
    assert row.owner == "joint"
    assert row.ticker is None
    assert "missing_ticker" in row.flags
    assert row.amount_low == 1_001 and row.amount_high == 15_000


def test_kadoa_row_unrecognized_label_falls_back_to_seed_bounds():
    record = _record(
        1,
        amount_range_label="$1,000 - $14,999 (weird)",
        amount_range_low=1_000,
        amount_range_high=14_999,
    )
    row = kadoa_parsed_row(record)
    assert "amount_unparsed" in row.flags
    assert (row.amount_low, row.amount_high) == (1_000, 14_999)


@pytest.mark.skipif(not TRADES.exists(), reason="data-cache not present")
def test_whole_cache_amount_labels_match_seed_bounds():
    from populus.normalize import normalize_amount

    for record in json.loads(TRADES.read_text()):
        if classify_row(record) != "congress":
            continue
        low, high, flags = normalize_amount(record["amount_range_label"])
        assert "amount_unparsed" not in flags, record["amount_range_label"]
        assert low == record["amount_range_low"]
        assert high == record["amount_range_high"]


# --- crosswalk (R6) -----------------------------------------------------------


def _primary(conn, make_filing, doc_id="20000001", parse_status="parsed"):
    return make_filing(
        conn,
        filing_id=f"house:{doc_id}",
        filer_name_raw="Doe, Jane",
        doc_url=(
            "https://disclosures-clerk.house.gov/public_disc/ptr-pdfs/2026/"
            f"{doc_id}.pdf"
        ),
        parse_status=parse_status,
    )


def test_crosswalk_retires_against_parsed_primary(initialized_db, tmp_path, make_filing):
    # Two kadoa generations of ONE document — both retire together.
    _import(
        initialized_db,
        [_record(1), dict(_record(1), id="house_20000001_t1", ticker="MSFT")],
        tmp_path,
    )
    assert initialized_db.execute(
        "SELECT COUNT(*) FROM filings WHERE lifecycle = 'retired'"
    ).fetchone() == (0,)
    _primary(initialized_db, make_filing)
    retired = apply_crosswalk(initialized_db)
    assert retired == 2
    rows = initialized_db.execute(
        "SELECT filing_id, lifecycle, primary_filing_id FROM filings"
        " WHERE source = 'kadoa' ORDER BY filing_id"
    ).fetchall()
    assert rows == [
        ("kadoa:house_20000001_g0", "retired", "house:20000001"),
        ("kadoa:house_20000001_t1", "retired", "house:20000001"),
    ]
    # Tombstones: retired filings and their rows are retained, never deleted.
    assert initialized_db.execute(
        "SELECT COUNT(*) FROM transactions WHERE source = 'kadoa'"
    ).fetchone() == (2,)
    # Idempotent re-application: a true no-op — already-retired filings are
    # excluded, so re-running retires nothing more and leaves the state
    # unchanged (tombstones untouched).
    assert apply_crosswalk(initialized_db) == 0
    assert initialized_db.execute(
        "SELECT filing_id, lifecycle, primary_filing_id FROM filings"
        " WHERE source = 'kadoa' ORDER BY filing_id"
    ).fetchall() == rows


@pytest.mark.parametrize("status", ["needs_ocr", "failed"])
def test_crosswalk_ignores_unparsed_primaries(initialized_db, tmp_path, make_filing, status):
    _import(initialized_db, [_record(1)], tmp_path)
    _primary(initialized_db, make_filing, parse_status=status)
    assert apply_crosswalk(initialized_db) == 0
    assert initialized_db.execute(
        "SELECT lifecycle, primary_filing_id FROM filings WHERE source = 'kadoa'"
    ).fetchone() == ("active", None)


def test_crosswalk_requires_doc_url_agreement(initialized_db, tmp_path, make_filing):
    _import(initialized_db, [_record(1)], tmp_path)
    # A primary under the right filing_id whose doc_url references a
    # DIFFERENT document key fails the cross-check.
    make_filing(
        initialized_db,
        filing_id="house:20000001",
        doc_url="https://disclosures-clerk.house.gov/public_disc/ptr-pdfs/2026/99999999.pdf",
    )
    assert apply_crosswalk(initialized_db) == 0


def test_import_applies_crosswalk_at_its_tail(initialized_db, tmp_path, make_filing):
    _primary(initialized_db, make_filing)
    report = _import(initialized_db, [_record(1)], tmp_path)
    assert report.crosswalk_retired == 1
    assert initialized_db.execute(
        "SELECT lifecycle FROM filings WHERE source = 'kadoa'"
    ).fetchone() == ("retired",)


def test_crosswalk_derived_key_matches_senate_uuid(initialized_db, tmp_path, make_filing):
    # The SQL key derivation must handle the senate uuid form too.
    uuid = "392ac3e5-07f6-4f8c-840f-84e9066ffb29"
    _import(initialized_db, [_record(1, chamber="senate")], tmp_path)
    kadoa_uuid = initialized_db.execute(
        "SELECT filing_id FROM filings WHERE source = 'kadoa'"
    ).fetchone()[0].split(":", 1)[1].split("_")[1]
    make_filing(
        initialized_db,
        filing_id=f"senate:{kadoa_uuid}",
        chamber="senate",
        source="senate-efd",
        doc_url=f"https://efdsearch.senate.gov/search/view/ptr/{kadoa_uuid}/",
    )
    assert apply_crosswalk(initialized_db) == 1
    assert initialized_db.execute(
        "SELECT primary_filing_id FROM filings WHERE source = 'kadoa'"
    ).fetchone() == (f"senate:{kadoa_uuid}",)


@pytest.mark.parametrize("n", [3, 40])
def test_crosswalk_is_one_set_based_statement(initialized_db, tmp_path, make_filing, n):
    # F4: retirement is ONE set-based UPDATE regardless of N — a trace proves
    # the retiring statement executes exactly once, never once per mapping.
    _import(initialized_db, [_record(i) for i in range(1, n + 1)], tmp_path)
    for i in range(1, n + 1):
        _primary(initialized_db, make_filing, doc_id=str(20000000 + i))

    executed: list[str] = []
    initialized_db.set_trace_callback(executed.append)
    try:
        retired = apply_crosswalk(initialized_db)
    finally:
        initialized_db.set_trace_callback(None)
    assert retired == n
    retiring = [
        sql for sql in executed if "UPDATE filings" in sql and "'retired'" in sql
    ]
    assert len(retiring) == 1, f"expected 1 set-based UPDATE, saw {len(retiring)}"


# --- equity class and strata (R7/R22) -----------------------------------------


@pytest.mark.parametrize(
    "asset_type,expected",
    [
        ("ST", "equity"),
        ("PS", "equity"),
        ("Stock", "equity"),
        ("GS", "non_equity"),
        ("CS", "non_equity"),
        ("OP", "non_equity"),
        ("Municipal Security", "non_equity"),
        ("Corporate Bond", "non_equity"),
        ("OT", "unknown"),
        ("HN", "unknown"),
        (None, "unknown"),  # 250 of 913 house congressional rows carry none
        ("ZZ", "unknown"),  # unmapped code, never a crash
    ],
)
def test_equity_class_matrix(asset_type, expected):
    assert equity_class(asset_type) == expected


def test_equity_class_ignores_ticker_presence():
    # The rejected `ticker IS NOT NULL` heuristic would misclassify both of
    # these (the cache holds tickered bonds and untickered stock).
    tickered_bond = kadoa_parsed_row(_record(1, asset_type="GS", ticker="912828XX"))
    untickered_stock = kadoa_parsed_row(_record(2, asset_type="ST", ticker=None))
    assert equity_class(tickered_bond.asset_type) == "non_equity"
    assert equity_class(untickered_stock.asset_type) == "equity"


@pytest.mark.skipif(not TRADES.exists(), reason="data-cache not present")
def test_equity_map_domain_matches_cache_vocabulary_exactly():
    # Coverage guard: a NEW asset-type code arriving in a refreshed cache
    # must fail this test loudly rather than silently landing in `unknown`.
    observed = {
        record["asset_type"]
        for record in json.loads(TRADES.read_text())
        if classify_row(record) == "congress" and record.get("asset_type") is not None
    }
    assert observed == set(EQUITY_CLASS_MAP)


@pytest.mark.parametrize(
    "filed,band",
    [
        ("2012-01-01", "2012-15"),
        ("2015-12-31", "2012-15"),
        ("2016-01-01", "2016-19"),
        ("2019-06-15", "2016-19"),
        ("2020-01-01", "2020-23"),
        ("2023-12-31", "2020-23"),
        ("2024-01-01", "2024-26"),
        ("2026-07-23", "2024-26"),
    ],
)
def test_year_band(filed, band):
    assert year_band(filed) == band


@pytest.mark.parametrize("filed", ["2011-12-31", "2027-01-01"])
def test_year_band_out_of_range_is_loud(filed):
    with pytest.raises(ValueError):
        year_band(filed)


def test_row_stratum_key():
    assert row_stratum("house", "2026-06-10", "ST") == "house|2024-26|equity"
    assert row_stratum("senate", "2013-02-01", None) == "senate|2012-15|unknown"


# --- population binding (R20) -------------------------------------------------


# The audit population must be big enough for the PINNED sizes (no
# census clamp, F2): >= SRS_N total, one stratum >= FOLLOWUP_N for the
# follow-up, and every non-empty stratum >= MIN_PER_STRATUM even after a
# redraw excludes 150. Five deterministic, well-separated strata.
_AUDIT_STRATA = (
    (250, "house", "2026-06-10", "ST"),  # house|2024-26|equity (big — follow-up)
    (40, "house", "2021-06-10", "GS"),  # house|2020-23|non_equity
    (40, "house", "2013-06-10", None),  # house|2012-15|unknown
    (40, "senate", "2026-06-10", "Stock"),  # senate|2024-26|equity
    (40, "senate", "2018-06-10", "Municipal Security"),  # senate|2016-19|non_equity
)


def _audit_population():
    records = []
    i = 0
    for count, chamber, filed, asset_type in _AUDIT_STRATA:
        for _ in range(count):
            i += 1
            records.append(
                _record(
                    i,
                    chamber=chamber,
                    asset_type=asset_type,
                    filing_date=filed,
                    transaction_date=filed,
                )
            )
    return records  # 410 rows over five strata


@pytest.fixture
def population_db(initialized_db, tmp_path):
    _import(initialized_db, _audit_population(), tmp_path)
    return initialized_db


def test_population_snapshot_fields_and_scope(population_db, make_filing, make_row):
    from populus.load import load_filing

    # A primary-source transaction is NOT part of the audit population.
    make_filing(population_db, filing_id="house:999", filer_name_raw="Primary, Row")
    load_filing(
        population_db,
        "house:999",
        [make_row()],
        parse_status="parsed",
        parser_version="t",
        normalization_version="t",
    )
    snapshot = population_snapshot(population_db)
    assert len(snapshot) == 410
    assert all(set(row) == set(SNAPSHOT_FIELDS) for row in snapshot)
    assert [row["txn_id"] for row in snapshot] == sorted(
        row["txn_id"] for row in snapshot
    )
    assert {"asset_type", "doc_url"} <= set(SNAPSHOT_FIELDS)


def test_population_digest_stable_and_binding(population_db):
    first = population_digest(population_db)
    assert first == population_digest(population_db)  # stable on unchanged DB
    population_db.execute(
        "UPDATE transactions SET ticker = 'HACK' WHERE txn_id ="
        " (SELECT MIN(txn_id) FROM transactions)"
    )
    assert population_digest(population_db) != first


# --- deterministic sampler (R7/R19/R21) ---------------------------------------


@pytest.mark.parametrize("seed", ["x", -1, 1.5, True, None])
def test_select_sample_rejects_bad_seeds(population_db, seed):
    with pytest.raises(ValueError):
        select_sample(population_db, mode="initial", seed=seed)


def test_select_sample_rejects_bad_mode_combinations(population_db):
    with pytest.raises(ValueError):
        select_sample(population_db, mode="census", seed=0)
    with pytest.raises(ValueError):
        select_sample(population_db, mode="initial", seed=0, exclude=frozenset({"x"}))
    with pytest.raises(ValueError):
        select_sample(population_db, mode="redraw", seed=0)
    with pytest.raises(ValueError):
        select_sample(population_db, mode="stratum-followup", seed=0)
    with pytest.raises(ValueError):
        select_sample(population_db, mode="initial", seed=0, stratum="house|2024-26|equity")


def test_select_sample_sizes_are_pinned_not_clamped(population_db):
    # F2/R19: sizes are EXACTLY the pinned constants, never the population
    # size. The 410-row population draws exactly 150.
    sample = select_sample(population_db, mode="initial", seed=3)
    assert len(sample.srs) == SRS_N == 150
    assert len(set(sample.srs)) == SRS_N
    strata_sizes: dict[str, int] = {}
    for row in population_snapshot(population_db):
        key = row_stratum(row["chamber"], row["filed_date"], row["asset_type"])
        strata_sizes[key] = strata_sizes.get(key, 0) + 1
    assert set(sample.quota) == set(strata_sizes)
    for stratum_key, ids in sample.quota.items():
        assert len(ids) == MIN_PER_STRATUM  # exactly 5, never clamped
        for txn_id in ids:
            row = next(
                r for r in population_snapshot(population_db) if r["txn_id"] == txn_id
            )
            assert (
                row_stratum(row["chamber"], row["filed_date"], row["asset_type"])
                == stratum_key
            )
    # Deterministic reconstruction from (mode, seed) alone (R21).
    assert select_sample(population_db, mode="initial", seed=3) == sample
    # A different seed draws a different SRS.
    assert select_sample(population_db, mode="initial", seed=4).srs != sample.srs
    # Empty strata are reported (grid minus observed).
    assert set(sample.empty_strata) == {
        s
        for s in (
            f"{c}|{b}|{k}"
            for c in ("house", "senate")
            for b in ("2012-15", "2016-19", "2020-23", "2024-26")
            for k in ("equity", "non_equity", "unknown")
        )
        if s not in strata_sizes
    }


def test_select_sample_fails_closed_on_small_population(initialized_db, tmp_path):
    # F2: a population that cannot supply the pinned SRS is not census-drawn
    # — the sampler refuses (never a silent shrink to a full census).
    _import(initialized_db, _audit_population()[:100], tmp_path)  # 100 < 150
    with pytest.raises(ValueError, match="fewer than the pinned"):
        select_sample(initialized_db, mode="initial", seed=0)


def test_select_sample_fails_closed_on_small_stratum(population_db):
    # A stratum smaller than the pinned follow-up size cannot be drawn.
    with pytest.raises(ValueError, match="fewer than the pinned follow-up"):
        select_sample(
            population_db,
            mode="stratum-followup",
            seed=0,
            stratum="senate|2016-19|non_equity",  # 40 rows < 60
        )


def test_select_sample_redraw_draws_full_pinned_srs(population_db):
    initial = select_sample(population_db, mode="initial", seed=1)
    redraw = select_sample(
        population_db, mode="redraw", seed=2, exclude=frozenset(initial.srs)
    )
    assert not (set(redraw.all_ids()) & set(initial.srs))
    # 410 - 150 = 260 eligible >= 150, so the redraw is a full pinned SRS.
    assert len(redraw.srs) == SRS_N == 150


def test_select_sample_followup_confined_to_stratum(population_db):
    strata_sizes: dict[str, int] = {}
    for row in population_snapshot(population_db):
        key = row_stratum(row["chamber"], row["filed_date"], row["asset_type"])
        strata_sizes[key] = strata_sizes.get(key, 0) + 1
    stratum = max(strata_sizes, key=strata_sizes.get)  # the 250-row stratum
    assert strata_sizes[stratum] >= FOLLOWUP_N
    sample = select_sample(
        population_db, mode="stratum-followup", seed=5, stratum=stratum
    )
    assert len(sample.followup) == FOLLOWUP_N  # exactly 60, never clamped
    snapshot = {row["txn_id"]: row for row in population_snapshot(population_db)}
    for txn_id in sample.followup:
        row = snapshot[txn_id]
        assert row_stratum(row["chamber"], row["filed_date"], row["asset_type"]) == stratum
    with pytest.raises(ValueError):
        select_sample(
            population_db, mode="stratum-followup", seed=5, stratum="no|such|stratum"
        )


def test_ids_digest_matches_a_fixed_known_vector():
    # F1: independent, implementation-free known vector — the digest is the
    # SHA-256 of the JCS array of the SORTED ids, computed here from the
    # canonical bytes directly (not by calling any draw/score code).
    import hashlib as _hashlib

    expected = _hashlib.sha256(b'["a","b","c"]').hexdigest()
    assert ids_digest(["c", "a", "b"]) == expected
    assert ids_digest({"b", "a", "c"}) == expected  # order/type independent
    # And a second vector with characters that JCS must not alter.
    expected2 = _hashlib.sha256(
        b'["kadoa:house_1_g0","kadoa:senate_x_t0"]'
    ).hexdigest()
    assert (
        ids_digest(["kadoa:senate_x_t0", "kadoa:house_1_g0"]) == expected2
    )


def test_worksheet_deterministic_and_complete(population_db):
    first = build_audit_worksheet(population_db, mode="initial", seed=9)
    second = build_audit_worksheet(population_db, mode="initial", seed=9)
    assert json.dumps(first, sort_keys=True) == json.dumps(second, sort_keys=True)
    assert first["pinned_sizes"] == {
        "srs_n": SRS_N,
        "min_per_stratum": MIN_PER_STRATUM,
        "followup_n": FOLLOWUP_N,
    }
    for row in first["instruments"]["srs"]["rows"]:
        assert {"asset_type", "doc_url", "stratum", "kadoa_id"} <= set(row)
        blanks = row["verification"]
        assert set(blanks) == {
            *CRITICAL_FIELDS,
            "cosmetic",
            "note",
            "verified_by",
            "verified_at",
        }
        assert all(value == "" for value in blanks.values())


# --- draw command plumbing (R7/R13) -------------------------------------------


@pytest.fixture
def audit_env(population_db, tmp_path):
    draw = run_audit_draw(
        population_db,
        out_dir=tmp_path / "audit",
        mode="initial",
        seed=1,
        run_id="draw-1",
        now=NOW,
        host="test",
    )
    return population_db, draw, tmp_path


def _fill_clean(worksheet):
    for name, payload in worksheet["instruments"].items():
        entries = payload.values() if name == "quota" else [payload]
        for entry in entries:
            for row in entry["rows"]:
                row["verification"].update({f: "ok" for f in CRITICAL_FIELDS})
                row["verification"].update(
                    cosmetic="none", verified_by="qa", verified_at="2026-07-23"
                )
    return worksheet


def _all_rows(worksheet):
    rows = []
    for name, payload in worksheet["instruments"].items():
        entries = payload.values() if name == "quota" else [payload]
        for entry in entries:
            rows.extend(entry["rows"])
    return rows


def test_draw_seals_and_anchors_the_record(audit_env):
    conn, draw, _tmp = audit_env
    record_bytes = draw.record_path.read_bytes()
    assert hashlib.sha256(record_bytes).hexdigest() == draw.record_sha256
    (log_ref,) = conn.execute(
        "SELECT log_ref FROM ingest_runs WHERE run_id = 'draw-1'"
        " AND job = 'backfill-audit-draw'"
    ).fetchone()
    assert log_ref == f"draw-record:sha256:{draw.record_sha256}"
    record = json.loads(record_bytes)
    assert record["mode"] == "initial"
    assert record["seed"] == 1
    assert record["population_digest"] == draw.worksheet["population_digest"]
    assert draw.worksheet_md_path.read_text().startswith("# kadoa backfill audit")


# --- scorer: fail-closed battery (R16/R19/R20/R21/R22) ------------------------


def _score(env, worksheet, prior=None):
    conn, draw, _tmp = env
    return score_audit(
        worksheet,
        conn,
        draw_record_bytes=draw.record_path.read_bytes(),
        prior_failed_worksheet=prior,
    )


def _no_claim(disposition):
    assert disposition.binomial_upper_bound is None
    assert not disposition.critical_errors_by_instrument
    assert not disposition.critical_errors_by_stratum


def test_scorer_pass_path(audit_env):
    worksheet = _fill_clean(json.loads(json.dumps(audit_env[1].worksheet)))
    disposition = _score(audit_env, worksheet)
    assert disposition.status == "pass"
    assert disposition.required_actions == frozenset()
    assert disposition.cosmetic_rate == 0.0
    assert disposition.binomial_upper_bound == pytest.approx(
        1.0 - 0.05 ** (1.0 / 150), abs=1e-9
    )


def test_scorer_untouched_worksheet_incomplete(audit_env):
    worksheet = json.loads(json.dumps(audit_env[1].worksheet))
    disposition = _score(audit_env, worksheet)
    assert disposition.status == "incomplete"
    assert any(s.startswith("unverified_row") for s in disposition.completeness)
    _no_claim(disposition)


def test_scorer_partially_filled_incomplete(audit_env):
    worksheet = _fill_clean(json.loads(json.dumps(audit_env[1].worksheet)))
    row = worksheet["instruments"]["srs"]["rows"][3]
    row["verification"]["ticker"] = ""  # one blank cell
    disposition = _score(audit_env, worksheet)
    assert disposition.status == "incomplete"
    _no_claim(disposition)


def test_scorer_na_and_cosmetic_error_require_notes(audit_env):
    worksheet = _fill_clean(json.loads(json.dumps(audit_env[1].worksheet)))
    worksheet["instruments"]["srs"]["rows"][0]["verification"].update(
        member_identity="na", note=""
    )
    assert _score(audit_env, worksheet).status == "incomplete"
    worksheet = _fill_clean(json.loads(json.dumps(audit_env[1].worksheet)))
    worksheet["instruments"]["srs"]["rows"][0]["verification"].update(
        cosmetic="error", note=""
    )
    assert _score(audit_env, worksheet).status == "incomplete"


def test_scorer_undersized_srs_incomplete_even_with_lowered_metadata(audit_env):
    worksheet = _fill_clean(json.loads(json.dumps(audit_env[1].worksheet)))
    del worksheet["instruments"]["srs"]["rows"][10:]
    # Worksheet-declared sizes never lower the pinned requirement (R19).
    worksheet["pinned_sizes"] = {"srs_n": 10, "min_per_stratum": 1, "followup_n": 1}
    disposition = _score(audit_env, worksheet)
    assert disposition.status == "incomplete"
    assert any(s.startswith("srs_undersized:10<150") for s in disposition.completeness)
    _no_claim(disposition)


def test_scorer_undersized_quota_incomplete(audit_env):
    worksheet = _fill_clean(json.loads(json.dumps(audit_env[1].worksheet)))
    stratum = sorted(worksheet["instruments"]["quota"])[0]
    worksheet["instruments"]["quota"][stratum]["rows"] = worksheet["instruments"][
        "quota"
    ][stratum]["rows"][:1]
    disposition = _score(audit_env, worksheet)
    assert disposition.status == "incomplete"
    assert any("quota_undersized" in s for s in disposition.completeness)


def test_scorer_missing_stratum_instrument_incomplete(audit_env):
    worksheet = _fill_clean(json.loads(json.dumps(audit_env[1].worksheet)))
    stratum = sorted(worksheet["instruments"]["quota"])[0]
    del worksheet["instruments"]["quota"][stratum]
    disposition = _score(audit_env, worksheet)
    assert disposition.status == "incomplete"
    assert any("stratum_set_mismatch" in s for s in disposition.completeness)
    _no_claim(disposition)


def test_scorer_population_drift_invalid(audit_env):
    conn, draw, _tmp = audit_env
    worksheet = _fill_clean(json.loads(json.dumps(draw.worksheet)))
    conn.execute(
        "UPDATE transactions SET amount_low = 999999 WHERE txn_id ="
        " (SELECT MIN(txn_id) FROM transactions)"
    )
    disposition = _score(audit_env, worksheet)
    assert disposition.status == "invalid"
    assert disposition.required_actions == frozenset({"redraw_clean"})
    assert "population_digest_mismatch" in disposition.integrity
    _no_claim(disposition)


def test_scorer_asset_type_drift_invalid(audit_env):
    # R22: a post-draw asset-type change could move a row between
    # equity-class strata; the digest binds it.
    conn, draw, _tmp = audit_env
    worksheet = _fill_clean(json.loads(json.dumps(draw.worksheet)))
    sampled_row = worksheet["instruments"]["srs"]["rows"][0]
    # Pick a type guaranteed to move the row's equity class.
    drift = "GS" if equity_class(sampled_row["asset_type"]) != "non_equity" else "ST"
    conn.execute(
        "UPDATE transactions SET asset_type = ? WHERE txn_id = ?",
        (drift, sampled_row["txn_id"]),
    )
    disposition = _score(audit_env, worksheet)
    assert disposition.status == "invalid"
    assert "population_digest_mismatch" in disposition.integrity


def test_scorer_doc_url_drift_invalid(audit_env):
    # R22: the document the human opens is bound too.
    conn, draw, _tmp = audit_env
    worksheet = _fill_clean(json.loads(json.dumps(draw.worksheet)))
    sampled = worksheet["instruments"]["srs"]["rows"][0]["txn_id"]
    conn.execute(
        "UPDATE filings SET doc_url = 'https://evil.example/other.pdf'"
        " WHERE filing_id = ?",
        (sampled.rsplit(":", 1)[0],),
    )
    disposition = _score(audit_env, worksheet)
    assert disposition.status == "invalid"
    assert "population_digest_mismatch" in disposition.integrity


def test_scorer_edited_display_value_invalid(audit_env):
    worksheet = _fill_clean(json.loads(json.dumps(audit_env[1].worksheet)))
    worksheet["instruments"]["srs"]["rows"][0]["ticker"] = "EDITED"
    disposition = _score(audit_env, worksheet)
    assert disposition.status == "invalid"
    assert any(s.startswith("row_value_edited") for s in disposition.integrity)


def test_scorer_mismatched_declared_stratum_invalid(audit_env):
    worksheet = _fill_clean(json.loads(json.dumps(audit_env[1].worksheet)))
    worksheet["instruments"]["srs"]["rows"][0]["stratum"] = "house|2024-26|non_equity"
    disposition = _score(audit_env, worksheet)
    # Either the declared stratum differs from the DB re-derivation, or (if
    # it coincided) the row-value comparison — both are step-4 integrity.
    assert disposition.status == "invalid"
    assert any(
        s.startswith(("stratum_mismatch", "row_value_edited"))
        for s in disposition.integrity
    )


def test_scorer_tampered_record_invalid(audit_env):
    conn, draw, _tmp = audit_env
    worksheet = _fill_clean(json.loads(json.dumps(draw.worksheet)))
    record = json.loads(draw.record_path.read_bytes())
    record["seed"] = 999
    disposition = score_audit(
        worksheet,
        conn,
        draw_record_bytes=json.dumps(record).encode("utf-8"),
    )
    assert disposition.status == "invalid"
    assert "draw_record_mismatch" in disposition.integrity
    _no_claim(disposition)


def test_scorer_rejects_coherent_seed_substitution(audit_env):
    # R21's dedicated negative test: a FULLY internally-consistent
    # substitute package — a different valid seed, its true seed-derived
    # rows, and a matching regenerated record — still fails, because the
    # scorer authenticates the record against the hash anchored in
    # ingest_runs at draw time, which the worksheet operator cannot rewrite.
    conn, draw, _tmp = audit_env
    substitute = build_audit_worksheet(
        conn, mode="initial", seed=2, run_id="draw-1"  # reuses the real run id
    )
    _fill_clean(substitute)
    substitute_record = build_draw_record(substitute)
    disposition = score_audit(
        substitute,
        conn,
        draw_record_bytes=(
            json.dumps(substitute_record, sort_keys=True, indent=2) + "\n"
        ).encode("utf-8"),
    )
    assert disposition.status == "invalid"
    assert "draw_record_mismatch" in disposition.integrity
    _no_claim(disposition)

    # The same package under a fresh run id has no anchor at all.
    substitute2 = build_audit_worksheet(
        conn, mode="initial", seed=2, run_id="draw-unanchored"
    )
    _fill_clean(substitute2)
    disposition = score_audit(
        substitute2,
        conn,
        draw_record_bytes=json.dumps(build_draw_record(substitute2)).encode("utf-8"),
    )
    assert disposition.status == "invalid"
    assert "draw_record_mismatch" in disposition.integrity


def test_scorer_substituted_and_extra_rows_invalid(audit_env):
    conn, draw, _tmp = audit_env
    snapshot = population_snapshot(conn)
    drawn = {row["txn_id"] for row in _all_rows(draw.worksheet)}
    spare = next(r for r in snapshot if r["txn_id"] not in drawn)

    def replacement_row(db_row):
        template = json.loads(json.dumps(draw.worksheet["instruments"]["srs"]["rows"][0]))
        template.update({f: db_row[f] for f in SNAPSHOT_FIELDS})
        template["filing_id"] = db_row["txn_id"].rsplit(":", 1)[0]
        template["stratum"] = row_stratum(
            db_row["chamber"], db_row["filed_date"], db_row["asset_type"]
        )
        label = conn.execute(
            "SELECT amount_label FROM transactions WHERE txn_id = ?",
            (db_row["txn_id"],),
        ).fetchone()[0]
        template["amount_label"] = label
        return template

    # Substitution: swap one drawn row for a faithful copy of a NON-drawn
    # row (row integrity alone would accept it — reconstruction rejects it).
    worksheet = _fill_clean(json.loads(json.dumps(draw.worksheet)))
    worksheet["instruments"]["srs"]["rows"][0] = replacement_row(spare)
    _fill_clean(worksheet)
    disposition = _score(audit_env, worksheet)
    assert disposition.status == "invalid"
    assert any("reconstruction_mismatch" in s for s in disposition.integrity)

    # Extra row appended.
    worksheet = _fill_clean(json.loads(json.dumps(draw.worksheet)))
    worksheet["instruments"]["srs"]["rows"].append(replacement_row(spare))
    _fill_clean(worksheet)
    disposition = _score(audit_env, worksheet)
    assert disposition.status == "invalid"

    # Duplicate row (same count, duplicated id).
    worksheet = _fill_clean(json.loads(json.dumps(draw.worksheet)))
    worksheet["instruments"]["srs"]["rows"][1] = json.loads(
        json.dumps(worksheet["instruments"]["srs"]["rows"][0])
    )
    disposition = _score(audit_env, worksheet)
    assert disposition.status == "invalid"
    assert any("duplicate_rows" in s for s in disposition.integrity)

    # A missing row is caught by the pinned-size step first — fail-closed
    # either way, never a pass, never a bound.
    worksheet = _fill_clean(json.loads(json.dumps(draw.worksheet)))
    del worksheet["instruments"]["srs"]["rows"][0]
    disposition = _score(audit_env, worksheet)
    assert disposition.status == "incomplete"
    _no_claim(disposition)


def test_scorer_metadata_plus_row_co_substitution_invalid(audit_env):
    # F14: replacing the drawn-set metadata AND the rows together with a
    # chosen subset cannot pass — the rows fail the seed-forced
    # reconstruction, which never trusts worksheet metadata.
    conn, draw, _tmp = audit_env
    snapshot = population_snapshot(conn)
    labels = dict(
        conn.execute("SELECT txn_id, amount_label FROM transactions").fetchall()
    )
    chosen = snapshot[:150]  # attacker-chosen, not seed-derived
    worksheet = json.loads(json.dumps(draw.worksheet))
    rows = []
    for db_row in chosen:
        row = {f: db_row[f] for f in SNAPSHOT_FIELDS}
        row["filing_id"] = db_row["txn_id"].rsplit(":", 1)[0]
        row["amount_label"] = labels[db_row["txn_id"]]
        row["stratum"] = row_stratum(
            db_row["chamber"], db_row["filed_date"], db_row["asset_type"]
        )
        row["verification"] = {
            **{f: "ok" for f in CRITICAL_FIELDS},
            "cosmetic": "none",
            "note": "",
            "verified_by": "qa",
            "verified_at": "2026-07-23",
        }
        rows.append(row)
    worksheet["instruments"]["srs"]["rows"] = rows
    _fill_clean(worksheet)
    disposition = _score(audit_env, worksheet)
    assert disposition.status == "invalid"
    assert any("reconstruction_mismatch:srs" in s for s in disposition.integrity)
    _no_claim(disposition)


def test_scorer_composite_failure_actions(audit_env):
    # One localized critical error requires BOTH the fresh disjoint n=150
    # redraw AND the n=60 follow-up for that stratum — cumulative (§9.6).
    worksheet = _fill_clean(json.loads(json.dumps(audit_env[1].worksheet)))
    row = worksheet["instruments"]["srs"]["rows"][0]
    row["verification"]["side"] = "error"
    row["verification"]["note"] = "side flipped vs the source document"
    disposition = _score(audit_env, worksheet)
    assert disposition.status == "fail"
    assert disposition.required_actions == frozenset(
        {"investigate_and_fix", "redraw_srs", f"stratum_followup:{row['stratum']}"}
    )
    assert disposition.critical_errors_by_instrument == {"srs": 1}
    assert disposition.critical_errors_by_stratum == {row["stratum"]: 1}
    assert disposition.binomial_upper_bound is None


def test_scorer_multi_stratum_failure_one_followup_each(audit_env):
    worksheet = _fill_clean(json.loads(json.dumps(audit_env[1].worksheet)))
    rows = worksheet["instruments"]["srs"]["rows"]
    first = rows[0]
    other = next(r for r in rows if r["stratum"] != first["stratum"])
    for row in (first, other):
        row["verification"]["amount"] = "error"
        row["verification"]["note"] = "wrong bucket"
    disposition = _score(audit_env, worksheet)
    assert disposition.status == "fail"
    assert disposition.required_actions == frozenset(
        {
            "investigate_and_fix",
            "redraw_srs",
            f"stratum_followup:{first['stratum']}",
            f"stratum_followup:{other['stratum']}",
        }
    )


def test_scorer_cosmetic_threshold(audit_env):
    worksheet = _fill_clean(json.loads(json.dumps(audit_env[1].worksheet)))
    rows = _all_rows(worksheet)
    over_five_percent = int(len(rows) * 0.05) + 1
    for row in rows[:over_five_percent]:
        row["verification"].update(cosmetic="error", note="name formatting")
    disposition = _score(audit_env, worksheet)
    assert disposition.status == "fail"
    assert disposition.required_actions == frozenset({"remediate_cosmetic"})
    assert disposition.cosmetic_rate > 0.05
    assert disposition.critical_errors_by_instrument == {}
    assert disposition.binomial_upper_bound is None


# --- redraw and follow-up flows (R19/R21) -------------------------------------


def _draw(conn, tmp_path, *, mode, seed, run_id, exclude=(), stratum=None):
    return run_audit_draw(
        conn,
        out_dir=tmp_path / "audit",
        mode=mode,
        seed=seed,
        exclude=exclude,
        stratum=stratum,
        run_id=run_id,
        now=NOW,
        host="test",
    )


def test_redraw_flow_pass_and_exclusion_verification(audit_env):
    conn, prior_draw, tmp_path = audit_env
    prior_worksheet = json.loads(json.dumps(prior_draw.worksheet))
    prior_srs = [row["txn_id"] for row in prior_worksheet["instruments"]["srs"]["rows"]]

    redraw = _draw(
        conn, tmp_path, mode="redraw", seed=2, run_id="draw-2", exclude=prior_srs
    )
    filled = _fill_clean(json.loads(json.dumps(redraw.worksheet)))

    def score_redraw(worksheet, *, prior, record_bytes=None):
        return score_audit(
            worksheet,
            conn,
            draw_record_bytes=record_bytes or redraw.record_path.read_bytes(),
            prior_failed_worksheet=prior,
        )

    disposition = score_redraw(filled, prior=prior_worksheet)
    assert disposition.status == "pass"
    assert not (
        {row["txn_id"] for row in _all_rows(filled)} & set(prior_srs)
    )

    # Missing prior worksheet.
    disposition = score_redraw(filled, prior=None)
    assert disposition.status == "invalid"
    assert "missing_prior_failed_worksheet" in disposition.integrity

    # A DIFFERENT prior worksheet: its reconstructed SRS does not match the
    # sealed record's exclusion lineage.
    wrong_prior = build_audit_worksheet(conn, mode="initial", seed=77)
    disposition = score_redraw(filled, prior=wrong_prior)
    assert disposition.status == "invalid"
    assert "exclusion_lineage_mismatch" in disposition.integrity

    # A tampered declared-exclusion set: one excluded id swapped for a
    # different population id. The declared exclusion no longer equals the
    # reconstructed failed SRS → exclusion verification rejects it.
    tampered = json.loads(json.dumps(filled))
    replacement = next(
        r["txn_id"] for r in population_snapshot(conn) if r["txn_id"] not in prior_srs
    )
    tampered["exclude_txn_ids"] = sorted(
        (set(tampered["exclude_txn_ids"]) - {tampered["exclude_txn_ids"][0]})
        | {replacement}
    )
    disposition = score_redraw(tampered, prior=prior_worksheet)
    assert disposition.status == "invalid"
    assert "exclusion_set_mismatch" in disposition.integrity
    assert disposition.binomial_upper_bound is None

    # A partial (dropped-id) exclusion also fails closed: the declared
    # exclusion (149 ids) no longer equals the reconstructed failed SRS
    # (150) — invalid with no bound, never a pass.
    dropped = json.loads(json.dumps(filled))
    dropped["exclude_txn_ids"] = dropped["exclude_txn_ids"][1:]
    disposition = score_redraw(dropped, prior=prior_worksheet)
    assert disposition.status == "invalid"
    assert "exclusion_set_mismatch" in disposition.integrity
    assert disposition.binomial_upper_bound is None


def test_followup_flow_pass_and_failure(audit_env):
    conn, _prior, tmp_path = audit_env
    strata_sizes: dict[str, int] = {}
    for row in population_snapshot(conn):
        key = row_stratum(row["chamber"], row["filed_date"], row["asset_type"])
        strata_sizes[key] = strata_sizes.get(key, 0) + 1
    stratum = max(strata_sizes, key=strata_sizes.get)

    draw = _draw(
        conn, tmp_path, mode="stratum-followup", seed=3, run_id="draw-f", stratum=stratum
    )
    filled = _fill_clean(json.loads(json.dumps(draw.worksheet)))
    disposition = score_audit(
        filled, conn, draw_record_bytes=draw.record_path.read_bytes()
    )
    # A clean follow-up passes and clears exactly its named stratum; the
    # binomial bound belongs to the SRS instruments only.
    assert disposition.status == "pass"
    assert disposition.mode == "stratum-followup"
    assert disposition.binomial_upper_bound is None

    # Undersized follow-up ⇒ incomplete.
    truncated = json.loads(json.dumps(filled))
    del truncated["instruments"]["followup"]["rows"][0]
    disposition = score_audit(
        truncated, conn, draw_record_bytes=draw.record_path.read_bytes()
    )
    assert disposition.status == "incomplete"

    # A critical error in the follow-up fails with the cumulative actions.
    errored = json.loads(json.dumps(filled))
    row = errored["instruments"]["followup"]["rows"][0]
    row["verification"]["member_identity"] = "error"
    row["verification"]["note"] = "wrong member"
    disposition = score_audit(
        errored, conn, draw_record_bytes=draw.record_path.read_bytes()
    )
    assert disposition.status == "fail"
    assert disposition.required_actions == frozenset(
        {"investigate_and_fix", "redraw_srs", f"stratum_followup:{stratum}"}
    )


# --- CLI (R13) ----------------------------------------------------------------


def test_cli_backfill_ingest_and_audit_round_trip(tmp_path):
    trades_dir = tmp_path / "kadoa"
    trades_dir.mkdir()
    population = _audit_population()  # 410 rows — enough for the pinned SRS
    (trades_dir / "trades.json").write_text(json.dumps(population + [_oge_record()]))
    db_path = tmp_path / "cli.db"
    runner = CliRunner()

    result = runner.invoke(
        cli_main,
        ["ingest", "congress-backfill", "--db", str(db_path), "--from-cache", str(trades_dir)],
    )
    assert result.exit_code == 0, result.output
    assert f"imported {len(population)}" in result.output
    assert "excluded_oge 1" in result.output

    out_dir = tmp_path / "audit"
    result = runner.invoke(
        cli_main,
        [
            "backfill-audit",
            "draw",
            "--db",
            str(db_path),
            "--out",
            str(out_dir),
            "--mode",
            "initial",
            "--seed",
            "4",
        ],
    )
    assert result.exit_code == 0, result.output
    worksheet_path = next(out_dir.glob("worksheet.*.json"))

    # Scoring the untouched worksheet exits non-zero (incomplete).
    result = runner.invoke(
        cli_main,
        ["backfill-audit", "score", str(worksheet_path), "--db", str(db_path)],
    )
    assert result.exit_code == 1
    assert "INCOMPLETE" in result.output

    # A clean fill passes and exits zero.
    worksheet = json.loads(worksheet_path.read_text())
    _fill_clean(worksheet)
    filled_path = out_dir / worksheet_path.name.replace("worksheet", "filled")
    filled_path.write_text(json.dumps(worksheet))
    result = runner.invoke(
        cli_main,
        ["backfill-audit", "score", str(filled_path), "--db", str(db_path)],
    )
    assert result.exit_code == 0, result.output
    assert "PASS" in result.output


def test_cli_draw_mode_flag_validation(tmp_path):
    runner = CliRunner()
    db = tmp_path / "x.db"
    db.write_text("")
    cases = [
        (["--mode", "redraw"], "--exclude"),
        (["--mode", "stratum-followup"], "--stratum"),
        (["--mode", "initial", "--stratum", "s"], "--stratum applies only"),
    ]
    for extra, fragment in cases:
        result = runner.invoke(
            cli_main,
            ["backfill-audit", "draw", "--db", str(db), "--out", str(tmp_path), *extra],
        )
        assert result.exit_code == 2
        assert fragment in result.output

    # There is deliberately NO size flag on the draw command (R19).
    result = runner.invoke(cli_main, ["backfill-audit", "draw", "--help"])
    assert "--n " not in result.output
    assert "--size" not in result.output
    assert "--count" not in result.output


def test_cli_score_requires_prior_failed_for_redraw(tmp_path):
    runner = CliRunner()
    worksheet = tmp_path / "filled.json"
    worksheet.write_text(json.dumps({"mode": "redraw", "draw_run_id": "x"}))
    db = tmp_path / "y.db"
    db.write_text("")
    result = runner.invoke(
        cli_main,
        ["backfill-audit", "score", str(worksheet), "--db", str(db)],
    )
    assert result.exit_code == 2
    assert "--prior-failed" in result.output
