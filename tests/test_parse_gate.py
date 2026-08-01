"""The per-era parse gate and member-join coverage (RUN M1-B; R4, R5, R15).

Two censuses, one threshold. The row census carries the 0.97 gate; the filing
census carries none — it decides whether the row denominator is knowable at
all. The rule these tests exist to pin: **any** e-file filing whose expected row
count is unknown makes the era ``unmeasurable``, non-passing, and surfaced.
There is no tolerance band, because one unmeasured document can hold
disproportionately many transactions, so a percentage of *filings* can never
bound *row* coverage.
"""

from __future__ import annotations

import json

import pytest

from populus.amendments import ensure_views
from populus.parse_gate import (
    GATE_THRESHOLD,
    ParseGateConsistencyError,
    _assert_census_consistency,
    compute_join_coverage,
    compute_parse_gate,
    format_gate_decision,
    format_gate_report,
)


@pytest.fixture
def gate_db(initialized_db):
    ensure_views(initialized_db)
    return initialized_db


def _seed(
    conn,
    make_filing,
    make_row,
    *,
    filing_id,
    chamber="house",
    filed_date="2015-05-01",
    parse_status="parsed",
    clean_rows=0,
    defective_rows=0,
    source="house-clerk",
    row_count="derive",
    bioguide_id=None,
    filer_name_raw="Doe, Jane",
):
    """A filing plus its rows, with ``row_count`` settable independently.

    ``row_count`` is what the loader persists; overriding it to None or 0
    reproduces the two non-``failed`` shapes that also leave the era's expected
    row count unknown.
    """
    from populus.load import load_filing

    make_filing(
        conn,
        filing_id=filing_id,
        chamber=chamber,
        filed_date=filed_date,
        parse_status=parse_status,
        source=source,
        bioguide_id=bioguide_id,
        filer_name_raw=filer_name_raw,
        doc_url=f"https://example.invalid/{filing_id}",
    )
    rows = [
        make_row(asset_name=f"Clean{n}", row_ordinal=n + 1)
        for n in range(clean_rows)
    ] + [
        make_row(
            asset_name=f"Defect{n}",
            row_ordinal=clean_rows + n + 1,
            flags=("amount_unparsed",),
        )
        for n in range(defective_rows)
    ]
    load_filing(
        conn,
        filing_id,
        rows,
        parse_status=parse_status,
        parser_version="t",
        normalization_version="t",
    )
    if row_count != "derive":
        conn.execute(
            "UPDATE filings SET row_count = ? WHERE filing_id = ?",
            (row_count, filing_id),
        )


def _era(report, chamber, year):
    return next(e for e in report.eras if (e.chamber, e.year) == (chamber, year))


# --- the row census and its threshold (R4) -----------------------------------


@pytest.mark.parametrize(
    ("clean", "defective", "expected"),
    [
        (100, 0, "pass"),      # 100%
        (97, 3, "pass"),       # exactly 0.97 — at the threshold, not below it
        (96, 4, "miss"),       # 96%
    ],
)
def test_row_rate_is_judged_at_the_threshold_on_a_fully_measurable_era(
    gate_db, make_filing, make_row, clean, defective, expected
):
    _seed(
        gate_db, make_filing, make_row,
        filing_id="house:1", clean_rows=clean, defective_rows=defective,
    )
    era = _era(compute_parse_gate(gate_db), "house", "2015")
    assert era.status == expected
    assert era.meets_gate is (expected == "pass")
    assert era.row_denominator_known is True
    assert era.efile_parse_rate == pytest.approx(clean / (clean + defective))
    assert era.unmeasurable_efile_filings == 0


def test_the_threshold_constant_is_the_2026_baseline_ruler(gate_db):
    assert GATE_THRESHOLD == 0.97
    assert compute_parse_gate(gate_db).threshold == 0.97


# --- the filing census: an unknown denominator is never a pass (LD10) --------


def test_complete_failure_era_is_unmeasurable_not_n_a(gate_db, make_filing, make_row):
    """Every e-file filing failed and zero rows exist. Naively that is a 0/0
    row census, which must never read as 'no data, therefore fine'."""
    for n in (1, 2):
        _seed(
            gate_db, make_filing, make_row,
            filing_id=f"house:{n}", parse_status="failed",
        )
    era = _era(compute_parse_gate(gate_db), "house", "2015")
    assert era.status == "unmeasurable"
    assert era.meets_gate is False
    assert era.efile_filings == 2
    assert era.unmeasurable_efile_filings == 2
    assert era.efile_parse_rate is None
    assert era.row_denominator_known is False


def test_mixed_failure_era_is_unmeasurable_even_at_100_percent_surviving_rows(
    gate_db, make_filing, make_row
):
    """The exact trap: the surviving rows read 100% clean, so a row-rate-only
    gate would certify an era whose true coverage is unknown."""
    _seed(gate_db, make_filing, make_row, filing_id="house:1", clean_rows=50)
    _seed(
        gate_db, make_filing, make_row, filing_id="house:2", parse_status="failed"
    )
    era = _era(compute_parse_gate(gate_db), "house", "2015")
    assert era.efile_parse_rate == 1.0     # the floor is perfect …
    assert era.status == "unmeasurable"    # … and the era still does not pass
    assert era.meets_gate is False
    assert era.row_denominator_known is False


def test_a_single_unknown_filing_in_two_hundred_still_blocks_the_era(
    gate_db, make_filing, make_row
):
    """No tolerance band. 199/200 measurable is 99.5% of filings — far above any
    plausible band — and the era is still unmeasurable, because that one
    document may hold more rows than the other 199 combined."""
    for n in range(199):
        _seed(
            gate_db, make_filing, make_row,
            filing_id=f"house:{n}", clean_rows=1,
        )
    _seed(
        gate_db, make_filing, make_row,
        filing_id="house:unknown", parse_status="failed",
    )
    era = _era(compute_parse_gate(gate_db), "house", "2015")
    assert era.efile_filings == 200
    assert era.measurable_efile_filings == 199
    assert era.efile_filing_measurable_rate == pytest.approx(0.995)
    assert era.efile_parse_rate == 1.0
    assert era.status == "unmeasurable"
    assert era.meets_gate is False


@pytest.mark.parametrize("row_count", [None, 0])
def test_null_or_zero_row_count_counts_as_an_unknown_denominator(
    gate_db, make_filing, make_row, row_count
):
    """A filing that is not ``failed`` but produced no countable rows leaves the
    same hole as one that did fail."""
    _seed(gate_db, make_filing, make_row, filing_id="house:1", clean_rows=50)
    _seed(
        gate_db, make_filing, make_row,
        filing_id="house:2", parse_status="parsed", row_count=row_count,
    )
    era = _era(compute_parse_gate(gate_db), "house", "2015")
    assert era.unmeasurable_efile_filings == 1
    assert era.status == "unmeasurable"
    assert era.meets_gate is False


def test_rows_of_a_failed_filing_never_enter_the_floor(
    gate_db, make_filing, make_row
):
    """The floor is computed over EXACTLY the measurable population (F2).

    A failed filing can still have persisted transactions — a partial load, a
    reparse that stored rows before failing. Counting them would put rows in the
    printed floor that the filing census has already declared unmeasurable, and
    they would drag the floor to 0.2 here while the real measurable coverage is
    1.0. The status is ``unmeasurable`` either way; the *evidence* is not.
    """
    _seed(gate_db, make_filing, make_row, filing_id="house:ok", clean_rows=10)
    _seed(
        gate_db, make_filing, make_row,
        filing_id="house:bad", parse_status="failed", defective_rows=40,
    )
    era = _era(compute_parse_gate(gate_db), "house", "2015")
    assert era.efile_rows == 10          # not 50
    assert era.clean_efile_rows == 10
    assert era.efile_parse_rate == 1.0   # the floor over the measurable subset
    assert era.status == "unmeasurable"  # and the era still does not pass
    assert era.row_denominator_known is False


@pytest.mark.parametrize("row_count", [None, 0])
def test_rows_of_a_null_or_zero_row_count_filing_never_enter_the_floor(
    gate_db, make_filing, make_row, row_count
):
    """The same exclusion for the other two unmeasurable shapes: a filing whose
    persisted ``row_count`` is NULL or 0 has an unknown expected row count, so
    whatever transactions sit under it are outside the declared denominator."""
    _seed(gate_db, make_filing, make_row, filing_id="house:ok", clean_rows=10)
    _seed(
        gate_db, make_filing, make_row,
        filing_id="house:unknown", clean_rows=5, defective_rows=5,
        row_count=row_count,
    )
    era = _era(compute_parse_gate(gate_db), "house", "2015")
    assert era.efile_rows == 10
    assert era.clean_efile_rows == 10
    assert era.efile_parse_rate == 1.0
    assert era.status == "unmeasurable"


def test_an_era_with_no_measurable_filing_reports_no_floor_rows_at_all(
    gate_db, make_filing, make_row
):
    """The degenerate case the consistency invariant names: every e-file filing
    is unmeasurable, so there is no floor to print — not a rate derived from
    rows nobody is allowed to count."""
    _seed(
        gate_db, make_filing, make_row,
        filing_id="house:bad", parse_status="failed", clean_rows=30,
    )
    era = _era(compute_parse_gate(gate_db), "house", "2015")
    assert era.efile_filings == 1
    assert era.measurable_efile_filings == 0
    assert era.efile_rows == 0
    assert era.clean_efile_rows == 0
    assert era.efile_parse_rate is None   # not 1.0 over rows outside the census
    assert era.status == "unmeasurable"


def test_the_census_consistency_invariant_is_asserted_not_assumed():
    """The guard itself, driven directly — a future edit that re-derives the row
    population in SQL must hard-stop rather than silently reintroduce F2."""
    with pytest.raises(ParseGateConsistencyError) as excinfo:
        _assert_census_consistency(
            {("house", "2015"): {"measurable": 0, "rows": 7, "clean": 7}}
        )
    assert "no measurable" in str(excinfo.value)

    with pytest.raises(ParseGateConsistencyError):
        _assert_census_consistency(
            {("house", "2015"): {"measurable": 3, "rows": 5, "clean": 6}}
        )

    # A consistent era passes silently.
    _assert_census_consistency(
        {("house", "2015"): {"measurable": 3, "rows": 5, "clean": 5}}
    )


def test_a_mixed_corpus_keeps_the_two_censuses_consistent(
    gate_db, make_filing, make_row
):
    """End-to-end: a corpus mixing every filing shape still satisfies the
    invariant, and each era's floor rows stay bounded by its measurable set."""
    _seed(gate_db, make_filing, make_row, filing_id="house:ok", clean_rows=10)
    _seed(
        gate_db, make_filing, make_row,
        filing_id="house:failed", parse_status="failed", clean_rows=4,
    )
    _seed(
        gate_db, make_filing, make_row,
        filing_id="house:zero", clean_rows=4, row_count=0,
    )
    _seed(
        gate_db, make_filing, make_row,
        filing_id="house:paper", parse_status="needs_ocr", clean_rows=4,
    )
    _seed(
        gate_db, make_filing, make_row,
        filing_id="kadoa:1", source="kadoa", clean_rows=4,
    )
    report = compute_parse_gate(gate_db)
    for era in report.eras:
        assert era.clean_efile_rows <= era.efile_rows
        if era.measurable_efile_filings == 0:
            assert era.efile_rows == 0
    assert _era(report, "house", "2015").efile_rows == 10


def test_no_efile_filings_is_the_only_n_a_status_and_needs_a_zero_census(
    gate_db, make_filing, make_row
):
    _seed(
        gate_db, make_filing, make_row,
        filing_id="house:paper", parse_status="needs_ocr",
    )
    era = _era(compute_parse_gate(gate_db), "house", "2015")
    assert era.efile_filings == 0
    assert era.needs_ocr_filings == 1
    assert era.status == "no_efile_filings"
    assert era.meets_gate is True
    assert era.efile_filing_measurable_rate is None


# --- exclusions (R7) ---------------------------------------------------------


def test_needs_ocr_and_kadoa_are_excluded_from_both_censuses(
    gate_db, make_filing, make_row
):
    _seed(gate_db, make_filing, make_row, filing_id="house:1", clean_rows=10)
    # Paper: retained, counted in dispositions, in neither e-file census.
    _seed(
        gate_db, make_filing, make_row,
        filing_id="house:paper", parse_status="needs_ocr",
    )
    # kadoa: a secondary source, never part of the primary parse gate.
    _seed(
        gate_db, make_filing, make_row,
        filing_id="kadoa:1", source="kadoa", clean_rows=5, defective_rows=5,
    )
    era = _era(compute_parse_gate(gate_db), "house", "2015")
    assert era.efile_filings == 1              # not 3
    assert era.needs_ocr_filings == 1          # visible, not silent
    assert era.efile_rows == 10                # the kadoa rows are not counted
    assert era.status == "pass"


# --- surfacing and severity ranking (R5) -------------------------------------


def test_surfacing_names_the_era_the_options_and_labels_a_floor(
    gate_db, make_filing, make_row
):
    _seed(gate_db, make_filing, make_row, filing_id="house:1", clean_rows=50)
    _seed(
        gate_db, make_filing, make_row, filing_id="house:2", parse_status="failed"
    )
    report = compute_parse_gate(gate_db)
    assert report.owner_decision_required is True
    decision = format_gate_decision(report)

    assert "OWNER DECISION REQUIRED" in decision
    assert "house 2015" in decision
    assert "[unmeasurable]" in decision
    assert "FLOOR over a partial denominator" in decision
    assert "unmeasurable e-file filings 1/2" in decision
    # All three options, verbatim from the brief.
    assert "(a) era-scoped gates" in decision
    assert "(b) a parser extension" in decision
    assert "(c) accepting a higher needs_ocr share" in decision
    # And the standing promise not to decide on the owner's behalf.
    assert "never proceeds past it" in decision


def test_a_passing_corpus_surfaces_no_decision(gate_db, make_filing, make_row):
    _seed(gate_db, make_filing, make_row, filing_id="house:1", clean_rows=100)
    report = compute_parse_gate(gate_db)
    assert report.owner_decision_required is False
    assert format_gate_decision(report) == ""
    assert report.surfaced == ()


def test_severity_ranks_the_worst_era_first_and_suppresses_none(
    gate_db, make_filing, make_row
):
    # 2015: an era-wide blackout (100% unmeasurable).
    for n in (1, 2, 3):
        _seed(
            gate_db, make_filing, make_row,
            filing_id=f"house:blackout{n}", filed_date="2015-05-01",
            parse_status="failed",
        )
    # 2016: one unknown filing among many (a small share).
    for n in range(9):
        _seed(
            gate_db, make_filing, make_row,
            filing_id=f"house:ok{n}", filed_date="2016-05-01", clean_rows=1,
        )
    _seed(
        gate_db, make_filing, make_row,
        filing_id="house:one-unknown", filed_date="2016-05-01",
        parse_status="failed",
    )
    # 2017: fully measurable but below the gate.
    _seed(
        gate_db, make_filing, make_row,
        filing_id="house:below", filed_date="2017-05-01",
        clean_rows=90, defective_rows=10,
    )
    report = compute_parse_gate(gate_db)
    surfaced = report.surfaced

    # Every non-passing era is present — ranking never drops one.
    assert {(e.chamber, e.year) for e in surfaced} == {
        ("house", "2015"), ("house", "2016"), ("house", "2017"),
    }
    # Worst first: unmeasurable share dominates, then row-rate shortfall.
    assert [e.year for e in surfaced] == ["2015", "2016", "2017"]
    assert surfaced[0].unmeasurable_share == 1.0
    assert surfaced[1].unmeasurable_share == pytest.approx(0.1)
    assert surfaced[2].status == "miss"

    decision = format_gate_decision(report)
    for year in ("2015", "2016", "2017"):
        assert f"house {year}" in decision


def test_every_era_line_prints_its_unmeasurable_count_whatever_its_status(
    gate_db, make_filing, make_row
):
    _seed(gate_db, make_filing, make_row, filing_id="house:1", clean_rows=100)
    report = compute_parse_gate(gate_db)
    text = format_gate_report(report)
    assert "unmeasurable 0" in text
    assert "status pass" in text
    assert "vs gate 97%" in text
    assert "OWNER DECISION REQUIRED" not in text


# --- per-era member join (R15) -----------------------------------------------


def test_join_coverage_is_measured_per_era_so_modern_rows_cannot_mask_it(
    gate_db, make_filing, make_row, make_member
):
    make_member(gate_db, "D000001", first="Jane", last="Doe")
    # A large, fully joined modern era.
    _seed(
        gate_db, make_filing, make_row,
        filing_id="house:modern", filed_date="2026-05-01",
        clean_rows=100, bioguide_id="D000001",
    )
    # A small, entirely unjoined historical era.
    _seed(
        gate_db, make_filing, make_row,
        filing_id="house:hist", filed_date="2015-05-01",
        clean_rows=4, bioguide_id=None, filer_name_raw="Oldmember, Sam",
    )
    coverage = {(c.chamber, c.year): c for c in compute_join_coverage(gate_db)}

    modern = coverage[("house", "2026")]
    assert (modern.filings_joined, modern.filings) == (1, 1)
    assert modern.join_rate == 1.0

    historical = coverage[("house", "2015")]
    assert (historical.filings_joined, historical.filings) == (0, 1)
    assert historical.filings_unjoined == 1
    assert (historical.rows_joined, historical.rows) == (0, 4)
    assert historical.join_rate == 0.0
    # Unjoined filers stay visible and named, never silently dropped.
    assert historical.unresolved_filers == ("Oldmember, Sam",)


def test_join_coverage_excludes_kadoa_and_reports_in_the_gate_report(
    gate_db, make_filing, make_row
):
    _seed(
        gate_db, make_filing, make_row,
        filing_id="kadoa:1", source="kadoa", clean_rows=5,
        filed_date="2015-05-01",
    )
    _seed(
        gate_db, make_filing, make_row,
        filing_id="house:1", clean_rows=2, filed_date="2015-05-01",
    )
    coverage = {(c.chamber, c.year): c for c in compute_join_coverage(gate_db)}
    assert coverage[("house", "2015")].filings == 1
    assert coverage[("house", "2015")].rows == 2

    text = format_gate_report(compute_parse_gate(gate_db))
    assert "member join (primary sources, per chamber-year):" in text
    assert "filings joined 0/1" in text


def test_join_row_counts_read_the_default_view_not_raw_transactions(
    gate_db, make_filing, make_row, make_member, make_amendment_pair
):
    """§9.5: the original side of an unresolved amendment pair is excluded from
    every default aggregate, so the era's join denominator must exclude it too —
    otherwise the era figures would not reconcile with stats.json."""
    make_amendment_pair(gate_db)
    per_era = {(c.chamber, c.year): c for c in compute_join_coverage(gate_db)}
    total_rows = sum(c.rows for c in per_era.values())
    (view_rows,) = gate_db.execute(
        "SELECT COUNT(*) FROM v_default_transactions WHERE source != 'kadoa'"
    ).fetchone()
    (raw_rows,) = gate_db.execute("SELECT COUNT(*) FROM transactions").fetchone()
    assert total_rows == view_rows
    assert view_rows < raw_rows


# --- the gate metric reuses the one flag taxonomy (A2) ------------------------


def test_clean_is_decided_by_has_parse_defect_not_a_second_sql_flag_list(
    gate_db, make_filing, make_row
):
    """A *source fact* flag (a faithfully parsed property) is not a defect, so a
    row carrying only source facts stays clean. Reimplementing the taxonomy in
    SQL is exactly what this forbids."""
    _seed(gate_db, make_filing, make_row, filing_id="house:1", clean_rows=1)
    gate_db.execute(
        "UPDATE transactions SET flags = ? WHERE filing_id = 'house:1'",
        (json.dumps(["missing_ticker", "date_anomaly", "amendment_unresolved"]),),
    )
    era = _era(compute_parse_gate(gate_db), "house", "2015")
    assert (era.clean_efile_rows, era.efile_rows) == (1, 1)
    assert era.status == "pass"

    gate_db.execute(
        "UPDATE transactions SET flags = ? WHERE filing_id = 'house:1'",
        (json.dumps(["missing_ticker", "text_fallback"]),),
    )
    era = _era(compute_parse_gate(gate_db), "house", "2015")
    assert (era.clean_efile_rows, era.efile_rows) == (0, 1)
    assert era.status == "miss"
