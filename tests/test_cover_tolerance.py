"""Cover reconciliation: tolerance and conflict exclusion (M2-7).

Normative spec: ``docs/architecture/data-contracts/cover-tolerance.md``. One test per
invariant, named in the spec. Owner decision 2026-07-31 ("Tolerance + flag"):
a declared cover total the info table misses by rounding must never de-certify
the module, and a declared cover total the info table contradicts must never be
served — excluded-and-flagged, never silently wrong.

Hermetic and always-run: crafted corpora, no network, no fixture rewrite.
"""

from __future__ import annotations

import json
import sqlite3
from pathlib import Path

import pytest

from populus.amendments import (
    ViewVerificationError,
    ensure_views,
    materialized_inst_derivation_views,
)
from populus.db import connect, init_db
from populus.identity.registry import ensure_registry
from populus.ingest.inst13f import (
    COVER_CONFLICT,
    COVER_EXACT,
    COVER_ROUNDING,
    _COVERAGE_DENOMINATOR_SQL,
    _PER_FILING_COVER_SQL,
    _production_coverage_queries,
    classify_cover,
    compute_coverage,
    compute_period_coverage,
    cover_dispositions,
    cover_tolerance_usd,
    mark_cover_dispositions,
    within_cover_tolerance,
)
from populus.load import ensure_inst_schema

from test_inst_agg import _filer, _hold, _load  # established cross-fixture reuse

APPLE = "037833100"
MSFT = "594918104"


def _fresh(tmp_path, name="cover.db"):
    path = tmp_path / name
    init_db(str(path))
    conn = connect(str(path))
    ensure_registry(conn)
    ensure_inst_schema(conn)
    ensure_views(conn)
    return conn


def _security(conn, security_id):
    conn.execute(
        "INSERT INTO securities (security_id, id_state, class, entity_id,"
        " entity_link_state, review_state) VALUES (?, 'provisional', NULL, NULL,"
        " 'unresolved', 'auto') ON CONFLICT (security_id) DO NOTHING",
        (security_id,),
    )
    return security_id


def _file(conn, *, fid, cik, declared, resolved, period="2026-03-31", cusip=APPLE):
    """One filing declaring cover total *declared* whose single RESOLVED holding
    is worth *resolved*."""
    _filer(conn, cik)
    sid = _security(conn, f"sec:{cusip}")
    _load(
        conn, fid=fid, cik=cik, period=period, filed="2026-04-15", total=declared,
        holds=[_hold(ordinal=1, issuer="ISSUER", cusip=cusip, value=resolved,
                     security_id=sid)],
    )


def _in_default_view(conn, fid):
    return conn.execute(
        "SELECT 1 FROM v_default_inst_filings WHERE filing_id = ?", (fid,)
    ).fetchone() is not None


# --- I1: the tolerance is exact integer arithmetic, closed on the tolerant side


def test_cover_tolerance_boundary_is_exact_integer_arithmetic_and_closed():
    # tol(T) = max($1,000, 0.001*T). Below the $1,000 floor the fraction is
    # irrelevant; above it the fraction governs. Equality is ROUNDING.
    # Mutation guard: `<=` -> `<` flips the two exact-boundary rows; dropping the
    # floor flips the small-T rows; dropping the fraction flips the large-T rows.
    assert within_cover_tolerance(0, 1_000) is True            # floor, exactly
    assert within_cover_tolerance(0, 1_001) is False           # one past the floor
    assert within_cover_tolerance(500_000, 501_000) is True    # floor still governs
    assert within_cover_tolerance(500_000, 501_001) is False
    assert within_cover_tolerance(10_000_000, 10_010_000) is True   # 0.1%, exactly
    assert within_cover_tolerance(10_000_000, 10_010_001) is False  # one past
    # $10^12 scale: the boundary is exact, which floating point would not be.
    assert within_cover_tolerance(1_000_000_000_000, 1_001_000_000_000) is True
    assert within_cover_tolerance(1_000_000_000_000, 1_001_000_000_001) is False
    # Under-cover is never inflation.
    assert classify_cover(10_000_000, 9_999_999) == COVER_EXACT
    assert classify_cover(10_000_000, 10_000_000) == COVER_EXACT
    assert classify_cover(10_000_000, 10_010_000) == COVER_ROUNDING
    assert classify_cover(10_000_000, 10_010_001) == COVER_CONFLICT


def test_view_predicate_and_python_classifier_agree_on_the_boundary(tmp_path):
    # The tolerance is written twice — SQL in views.sql, Python in inst13f — and
    # the two must never drift. Sweep the boundary in both directions at three
    # scales and require the view's membership to equal the classifier's verdict.
    # Mutation guard: any edit to either predicate alone fails this.
    conn = _fresh(tmp_path)
    cases = [
        (0, 1_000), (0, 1_001),
        (500_000, 501_000), (500_000, 501_001),
        (10_000_000, 10_010_000), (10_000_000, 10_010_001),
        (2_000_000_000, 2_002_000_000), (2_000_000_000, 2_002_000_001),
    ]
    for index, (declared, resolved) in enumerate(cases):
        fid = f"inst:B-{index}"
        _file(conn, fid=fid, cik=f"000000{index:04d}", declared=declared,
              resolved=resolved, period=f"2026-03-{index + 1:02d}")
        expected_kept = classify_cover(declared, resolved) != COVER_CONFLICT
        assert _in_default_view(conn, fid) is expected_kept, (declared, resolved)
    conn.close()


# --- I2: rounding never de-certifies and never leaves the corpus --------------


def test_one_dollar_rounding_stays_in_the_corpus_and_certifies(tmp_path):
    # The measured reality this change exists for: a $1 delta on a $1.6B cover.
    # Mutation guard: restoring zero tolerance makes certifiable False and drops
    # the filing from the view.
    conn = _fresh(tmp_path)
    _file(conn, fid="inst:A-1", cik="0000000001",
          declared=1_677_629_299, resolved=1_677_629_300)

    coverage = compute_coverage(conn)
    assert _in_default_view(conn, "inst:A-1") is True
    assert coverage.cover_rounding_count == 1
    assert coverage.cover_rounding_max_delta_usd == 1
    assert coverage.cover_conflict_filing_ids == ()
    assert coverage.inflated_filing_count == 0
    assert coverage.certifiable is True
    assert coverage.meets_threshold is True
    conn.close()


def test_exact_boundary_delta_certifies(tmp_path):
    # Exactly max($1,000, 0.001*T) is rounding, not conflict (§I1 closed side).
    conn = _fresh(tmp_path)
    _file(conn, fid="inst:A-1", cik="0000000001",
          declared=10_000_000, resolved=10_010_000)

    coverage = compute_coverage(conn)
    assert coverage.cover_rounding_count == 1
    assert coverage.cover_rounding_max_delta_usd == 10_000
    assert coverage.certifiable is True
    assert coverage.meets_threshold is True
    conn.close()


# --- I3: coverage is never overstated ----------------------------------------


def test_rounding_denominator_banks_the_larger_number_never_over_100pct(tmp_path):
    # The filing declares 10,000,000 and resolves 10,010,000. Numerator = S. If
    # the denominator trusted the DECLARED total, coverage would read 1.001 —
    # over 100%, past the gate, on a filing whose own cover is smaller.
    # Mutation guard: MAX(declared, resolved) -> declared makes coverage > 1.0.
    conn = _fresh(tmp_path)
    _file(conn, fid="inst:A-1", cik="0000000001",
          declared=10_000_000, resolved=10_010_000)

    coverage = compute_coverage(conn)
    assert coverage.numerator == 10_010_000
    assert coverage.denominator == 10_010_000     # max(S, T), not T
    assert coverage.coverage == 1.0
    assert coverage.coverage <= 1.0
    conn.close()


def test_under_cover_filing_keeps_the_declared_total_as_denominator(tmp_path):
    # §I9: for S <= T — the overwhelming majority — the denominator is byte
    # identical to M2-6's `SUM(table_value_total_usd)`.
    conn = _fresh(tmp_path)
    _file(conn, fid="inst:A-1", cik="0000000001",
          declared=1_000_000, resolved=900_000)

    coverage = compute_coverage(conn)
    assert coverage.denominator == 1_000_000
    assert coverage.numerator == 900_000
    assert coverage.coverage == 0.9
    assert coverage.certifiable is True            # measurable, just below 0.95
    assert coverage.meets_threshold is False
    conn.close()


# --- I4: one exclusion predicate, in the default view ------------------------


def test_cover_conflict_leaves_the_default_view_holdings_and_aggregates(tmp_path):
    # One past the boundary: excluded from the filing view, from the holdings
    # view (hence from every aggregate built on it), and from BOTH sides of the
    # coverage ratio. Mutation guard: dropping the view's stage-3 predicate puts
    # the filing back and drives coverage over 1.0.
    conn = _fresh(tmp_path)
    _file(conn, fid="inst:GOOD", cik="0000000001",
          declared=1_000_000, resolved=1_000_000)
    _file(conn, fid="inst:BAD", cik="0000000002", period="2026-03-30",
          declared=10_000_000, resolved=10_010_001, cusip=MSFT)

    assert _in_default_view(conn, "inst:GOOD") is True
    assert _in_default_view(conn, "inst:BAD") is False
    holdings = conn.execute(
        "SELECT DISTINCT filing_id FROM v_default_holdings"
    ).fetchall()
    assert holdings == [("inst:GOOD",)]
    # Still in the database, and still in the reconciled population — excluded,
    # never deleted (§Rule 4).
    assert conn.execute(
        "SELECT COUNT(*) FROM inst_filings WHERE filing_id = 'inst:BAD'"
    ).fetchone()[0] == 1
    assert conn.execute(
        "SELECT COUNT(*) FROM v_inst_reconciled_filings WHERE filing_id = 'inst:BAD'"
    ).fetchone()[0] == 1

    coverage = compute_coverage(conn)
    assert coverage.numerator == 1_000_000        # BAD in neither side
    assert coverage.denominator == 1_000_000
    assert coverage.coverage == 1.0
    conn.close()


def test_one_past_the_boundary_excludes_and_the_remainder_certifies(tmp_path):
    # The corpus-level consequence the owner decided: the conflict is excluded,
    # and everything else publishes. Zero tolerance made this corpus permanently
    # non-certifiable.
    conn = _fresh(tmp_path)
    _file(conn, fid="inst:GOOD", cik="0000000001",
          declared=1_000_000, resolved=1_000_000)
    _file(conn, fid="inst:ROUND", cik="0000000002", period="2026-03-30",
          declared=1_000_000, resolved=1_000_999, cusip=MSFT)
    _file(conn, fid="inst:BAD", cik="0000000003", period="2026-03-29",
          declared=10_000_000, resolved=10_010_001)

    coverage = compute_coverage(conn)
    assert coverage.cover_conflict_filing_ids == ("inst:BAD",)
    assert coverage.cover_conflict_count == 1
    assert coverage.cover_rounding_count == 1
    assert coverage.cover_rounding_max_delta_usd == 999
    assert coverage.inflated_filing_count == 0     # excluded, so not unresolved
    assert coverage.certifiable is True
    assert coverage.meets_threshold is True
    conn.close()


def test_the_real_1_531x_case_is_excluded_and_the_corpus_certifies(tmp_path):
    # Reproduction of the real outlier that blocked the first 1,000-filer corpus:
    # inst:0000036966-26-000144 — cover 1,696,669,754 vs summed 2,598,297,542
    # (1.531x). Beside it, the four real rounding filings ($1, $1, $5, $12).
    conn = _fresh(tmp_path)
    real = [
        ("inst:0000036966-26-000144", 1_696_669_754, 2_598_297_542),   # conflict
        ("inst:0001821268-26-000097", 813_936_938, 813_936_950),       # +$12
        ("inst:0001006407-26-000007", 1_256_448_428, 1_256_448_433),   # +$5
        ("inst:0000947871-26-000717", 1_677_629_299, 1_677_629_300),   # +$1
        ("inst:0001193125-26-315040", 2_420_360_458, 2_420_360_459),   # +$1
    ]
    for index, (fid, declared, resolved) in enumerate(real):
        _file(conn, fid=fid, cik=f"000000{index:04d}", declared=declared,
              resolved=resolved, period=f"2026-03-{index + 1:02d}")

    coverage = compute_coverage(conn)
    assert coverage.cover_conflict_filing_ids == ("inst:0000036966-26-000144",)
    assert coverage.cover_rounding_count == 4
    assert coverage.cover_rounding_max_delta_usd == 12
    assert coverage.certifiable is True
    assert coverage.meets_threshold is True
    assert coverage.coverage is not None and coverage.coverage <= 1.0
    # The 53% outlier is in neither side of the ratio.
    assert coverage.denominator == sum(
        max(d, r) for fid, d, r in real if fid != "inst:0000036966-26-000144"
    )
    conn.close()


# --- I5: excluded is never silent --------------------------------------------


def test_conflict_and_rounding_are_named_in_stats_and_withheld_surfaces(tmp_path):
    # Every coverage-reporting surface carries the rounding count + max delta and
    # the conflict filing_ids. Mutation guard: dropping either from InstCoverage,
    # from the ingest summary, or from build's payloads fails here.
    from populus.ingest.inst13f import InstIngestReport, format_summary

    conn = _fresh(tmp_path)
    _file(conn, fid="inst:GOOD", cik="0000000001",
          declared=1_000_000, resolved=999_000)
    _file(conn, fid="inst:ROUND", cik="0000000002", period="2026-03-30",
          declared=1_000_000, resolved=1_000_999, cusip=MSFT)
    _file(conn, fid="inst:BAD", cik="0000000003", period="2026-03-29",
          declared=10_000_000, resolved=10_010_001)
    coverage = compute_coverage(conn)

    text = format_summary(InstIngestReport(run_id="r", coverage=coverage))
    assert "cover_rounding 1 (max delta 999)" in text
    assert "cover_conflict EXCLUDED 1: inst:BAD" in text
    conn.close()


# --- I6: fail closed on any conflict still inside the view -------------------


def test_a_conflict_left_inside_the_view_still_fails_closed(tmp_path):
    # A database whose v_default_inst_filings predates M2-7 (the CREATE VIEW IF
    # NOT EXISTS trap) still contains the conflict. `certifiable` must refuse it
    # rather than publish a >100% ratio. Mutation guard: dropping
    # `inflated == 0` from certifiable lets this publish at 1.001.
    conn = _fresh(tmp_path)
    _file(conn, fid="inst:BAD", cik="0000000001",
          declared=10_000_000, resolved=10_010_001)
    conn.execute("DROP VIEW v_default_holdings")
    conn.execute("DROP VIEW v_default_inst_filings")
    conn.execute(  # the M2-2/M2-6 definition, verbatim in shape: no cover stage
        "CREATE VIEW v_default_inst_filings AS"
        " SELECT r.* FROM v_inst_reconciled_filings r"
    )
    conn.execute(
        "CREATE VIEW v_default_holdings AS SELECT h.* FROM inst_holdings h"
        " JOIN v_default_inst_filings f ON f.filing_id = h.filing_id"
    )

    coverage = compute_coverage(conn)
    assert coverage.inflated_filing_count == 1
    assert coverage.certifiable is False
    assert coverage.meets_threshold is False
    conn.close()


def test_ensure_views_replaces_a_stale_view_definition(tmp_path):
    # ...and the trap itself is closed: ensure_views makes an existing database
    # match the packaged definition. Mutation guard: restoring
    # `CREATE VIEW IF NOT EXISTS` leaves the stale predicate in place.
    conn = _fresh(tmp_path)
    _file(conn, fid="inst:GOOD", cik="0000000001",
          declared=1_000_000, resolved=1_000_000)
    _file(conn, fid="inst:BAD", cik="0000000002", period="2026-03-30",
          declared=10_000_000, resolved=10_010_001, cusip=MSFT)
    conn.execute("DROP VIEW v_default_inst_filings")
    conn.execute(
        "CREATE VIEW v_default_inst_filings AS"
        " SELECT r.* FROM v_inst_reconciled_filings r"
    )
    assert _in_default_view(conn, "inst:BAD") is True
    assert compute_coverage(conn).certifiable is False   # the stale view refuses

    ensure_views(conn)

    assert _in_default_view(conn, "inst:BAD") is False
    assert compute_coverage(conn).certifiable is True
    conn.close()


# --- I7: derived classification, annotation flags ----------------------------


def test_dispositions_are_identical_with_and_without_the_flag_pass(tmp_path):
    # The flags are annotation: an already-ingested corpus that has never run
    # mark_cover_dispositions classifies, excludes and reports identically.
    # Mutation guard: keying the view or compute_coverage on the flag fails here.
    conn = _fresh(tmp_path)
    _file(conn, fid="inst:ROUND", cik="0000000001",
          declared=1_000_000, resolved=1_000_999)
    _file(conn, fid="inst:BAD", cik="0000000002", period="2026-03-30",
          declared=10_000_000, resolved=10_010_001, cusip=MSFT)

    before = compute_coverage(conn)
    assert conn.execute(
        "SELECT flags FROM inst_filings WHERE filing_id = 'inst:BAD'"
    ).fetchone()[0] == "[]"

    assert mark_cover_dispositions(conn) == (1, 1)
    after = compute_coverage(conn)
    assert after == before

    flags = dict(conn.execute("SELECT filing_id, flags FROM inst_filings"))
    assert COVER_CONFLICT in flags["inst:BAD"]
    assert COVER_ROUNDING in flags["inst:ROUND"]
    conn.close()


def test_the_flag_pass_clears_a_disposition_whose_cause_has_gone(tmp_path):
    # Derived flags are recomputed, never accumulated (the affiliation-flag
    # precedent): a filing whose table is corrected must not keep the flag.
    conn = _fresh(tmp_path)
    _file(conn, fid="inst:BAD", cik="0000000001",
          declared=10_000_000, resolved=10_010_001)
    mark_cover_dispositions(conn)
    assert COVER_CONFLICT in conn.execute(
        "SELECT flags FROM inst_filings WHERE filing_id = 'inst:BAD'"
    ).fetchone()[0]

    conn.execute(
        "UPDATE inst_holdings SET value_usd = 9000000"  # no _ separator: SQLite < 3.46 rejects it
        " WHERE filing_id = 'inst:BAD'"
    )
    assert mark_cover_dispositions(conn) == (0, 0)

    assert conn.execute(
        "SELECT flags FROM inst_filings WHERE filing_id = 'inst:BAD'"
    ).fetchone()[0] == "[]"
    assert _in_default_view(conn, "inst:BAD") is True
    conn.close()


# --- I8: replay determinism ---------------------------------------------------


def test_replay_determinism_same_db_same_classification(tmp_path):
    # Same database, repeated calls and a reopened connection: identical
    # dispositions, counts and ORDER. The filings are INSERTED in descending
    # filing_id order, so insertion (rowid) order is not sorted order — mutation
    # guard: dropping the ORDER BY returns them newest-row-first and the reported
    # exclusion list stops being stable across rebuilds of the same corpus.
    conn = _fresh(tmp_path)
    corpus = [
        ("inst:F-9", 10_000_000, 10_010_001),   # conflict, one past the boundary
        ("inst:F-5", 5_000_000, 5_002_000),     # rounding (tol $5,000)
        ("inst:F-2", 2_000_000, 2_500_000),     # conflict, 25%
        ("inst:F-1", 1_000_000, 1_000_100),     # rounding (tol $1,000 floor)
    ]
    for index, (fid, declared, resolved) in enumerate(corpus):
        _file(conn, fid=fid, cik=f"000000{index:04d}",
              declared=declared, resolved=resolved,
              period=f"2026-03-{index + 1:02d}")

    first = compute_coverage(conn)
    second = compute_coverage(conn)
    assert first == second
    assert first.cover_conflict_filing_ids == ("inst:F-2", "inst:F-9")
    dispositions = cover_dispositions(conn)
    assert [d.filing_id for d in dispositions] == sorted(
        d.filing_id for d in dispositions
    )
    path = conn.execute("PRAGMA database_list").fetchall()[0][2]
    conn.close()

    reopened = connect(path)
    assert compute_coverage(reopened) == first
    reopened.close()


# --- I9: nothing else moves ---------------------------------------------------


def test_exact_cover_corpus_is_byte_identical_to_the_m2_6_behaviour(tmp_path):
    # An exact-cover corpus: every M2-6 number, flag and view membership stands.
    # The M2-6 denominator expression is recomputed independently and compared.
    conn = _fresh(tmp_path)
    for index in range(3):
        _file(conn, fid=f"inst:E-{index}", cik=f"000000{index:04d}",
              declared=1_000_000, resolved=1_000_000,
              period=f"2026-03-{index + 1:02d}")
    mark_cover_dispositions(conn)

    coverage = compute_coverage(conn)
    m2_6_denominator = conn.execute(
        "SELECT COALESCE(SUM(table_value_total_usd), 0) FROM v_default_inst_filings"
    ).fetchone()[0]
    assert coverage.denominator == m2_6_denominator == 3_000_000
    assert coverage.numerator == 3_000_000
    assert coverage.coverage == 1.0
    assert coverage.certifiable is True and coverage.meets_threshold is True
    assert coverage.cover_rounding_count == 0
    assert coverage.cover_conflict_filing_ids == ()
    assert [r[0] for r in conn.execute("SELECT flags FROM inst_filings")] == ["[]"] * 3
    conn.close()


def test_a_null_cover_total_is_still_cover_failed_not_a_conflict(tmp_path):
    # §Rule 1: unknown is not disagreement. A NULL total keeps M2-2's fail-closed
    # `cover_failed` behaviour and is never classified by this rule.
    conn = _fresh(tmp_path)
    _filer(conn, "0000000001")
    sid = _security(conn, "sec:X")
    _load(conn, fid="inst:NULLTOT", cik="0000000001", period="2026-03-31",
          filed="2026-04-15", total=None, parse_status="failed",
          failure_kind="cover_malformed", flags=["cover_failed"],
          holds=[_hold(ordinal=1, issuer="I", cusip=APPLE, value=500,
                       security_id=sid)])

    coverage = compute_coverage(conn)
    assert coverage.cover_failed_count == 1
    assert coverage.certifiable is False
    assert coverage.cover_conflict_filing_ids == ()
    assert coverage.cover_rounding_count == 0
    assert cover_dispositions(conn) == ()
    assert _in_default_view(conn, "inst:NULLTOT") is True   # still counted, at 0
    conn.close()


# =============================================================================
# External review round 2 (.codex-review-m27/m27code-2.codex.last.txt).
# Five blockers, each with the regression test that fails if the fix is undone.
# =============================================================================


# --- F1: §I3 binds EVERY coverage figure, including the per-period ones -------


def test_period_coverage_banks_the_larger_number_and_never_reads_over_100pct(tmp_path):
    """F1: `compute_period_coverage` summed the DECLARED total while the corpus
    banked max(S, T), so a tolerated rounding filing printed a 100.1% period
    figure beside a 100.0% corpus figure — an impossible number, published.

    Mutation guard: reverting the per-period denominator to
    ``SUM(table_value_total_usd)`` makes 2026-03-31 read 1.001 and fails the
    ``<= 1.0`` sweep, the max(S,T) equality, and the corpus-sum reconciliation.
    """
    conn = _fresh(tmp_path)
    # Q1 — a tolerated rounding filing, ALONE in its period so nothing masks it.
    # Declared 10,000,000; resolved 10,010,000; δ = tol(T) exactly.
    _file(conn, fid="inst:ROUND", cik="0000000001", period="2026-03-31",
          declared=10_000_000, resolved=10_010_000)
    # Q2 — an exact filing, so the untouched majority path is measured beside it.
    _file(conn, fid="inst:EXACT", cik="0000000002", period="2026-06-30",
          declared=4_000_000, resolved=3_600_000, cusip=MSFT)
    # Q3 — a conflict: excluded from the view, so its period must not appear at
    # all rather than appear with an inflated ratio.
    _file(conn, fid="inst:BAD", cik="0000000003", period="2026-09-30",
          declared=10_000_000, resolved=10_010_001)

    periods = {p.period_of_report: p for p in compute_period_coverage(conn)}

    assert set(periods) == {"2026-03-31", "2026-06-30"}      # never 2026-09-30
    assert periods["2026-03-31"].denominator == 10_010_000   # max(S, T), not T
    assert periods["2026-03-31"].numerator == 10_010_000
    assert periods["2026-03-31"].coverage == 1.0             # never 1.001
    assert periods["2026-06-30"].denominator == 4_000_000    # S <= T: unchanged
    assert periods["2026-06-30"].coverage == 0.9
    for period in periods.values():
        assert period.coverage is not None and period.coverage <= 1.0

    # The two figures are now the SAME arithmetic, so they reconcile exactly.
    corpus = compute_coverage(conn)
    assert sum(p.denominator for p in periods.values()) == corpus.denominator
    assert sum(p.numerator for p in periods.values()) == corpus.numerator
    conn.close()


# --- F5: integer arithmetic at every value the column can hold ----------------

#: `table_value_total_usd` is a signed 64-bit column. `1000 * δ` leaves int64 —
#: and SQLite silently promotes it to REAL — from here upward. The superseded
#: multiply form of the predicate therefore stopped being integer-only well
#: inside its own declared domain; the shipped divide form cannot overflow.
INT64_MAX = 9_223_372_036_854_775_807
PROMOTION_DELTA = INT64_MAX // 1000 + 1          # 9_223_372_036_854_776


def _sql_predicate(conn, declared: int, resolved: int) -> tuple[bool, str, str]:
    """The tolerance predicate exactly as ``views.sql`` writes it, plus the
    SQLite storage class of each side — so a REAL promotion is a test failure,
    not a rounding surprise."""
    kept, delta_type, tol_type = conn.execute(
        "SELECT (? - ?) <= MAX(1000, ? / 1000),"
        "       typeof(? - ?), typeof(MAX(1000, ? / 1000))",
        (resolved, declared, declared, resolved, declared, declared),
    ).fetchone()
    return bool(kept), delta_type, tol_type


def test_tolerance_predicate_is_integer_typed_past_the_int64_promotion_point(tmp_path):
    """F5: the invariant is *integer arithmetic*, not *integer-looking source*.

    Note what CANNOT be tested here, because it is the reason this defect shipped
    past a behavioural agreement sweep: inside the column's domain the two forms
    never disagree on a verdict. For `1000·δ` to leave int64 you need
    δ > 9.22e15, and for such a δ to be *within* tolerance you would need
    T ≥ 1000·δ > 9.2e18 — larger than the column can hold. So every promoted
    comparison is a conflict either way, and no fixture can catch the promotion
    by its answer. It is catchable only by its TYPE and by the shape of the
    shipped predicate, which is what this test asserts.

    Three assertions, in order: the defect is real (the superseded form promotes
    at a value this column holds); the SHIPPED view predicate — read back from
    `sqlite_master`, not retyped here — multiplies nothing; and the tolerance
    arithmetic stays integer-typed at int64 magnitudes.

    Mutation guard: restoring `1000 * (S - T) <= MAX(1000000, T)` in views.sql
    fails the no-multiplication assertion on the delta side.
    """
    conn = _fresh(tmp_path)
    # 1. The superseded form, evaluated verbatim: external review F5's own
    #    evidence, kept executable so the reason for the §I1 amendment cannot rot.
    assert conn.execute(
        "SELECT typeof(1000 * ?)", (PROMOTION_DELTA,)
    ).fetchone()[0] == "real"

    # 2. The SHIPPED predicate, read from the database SQLite actually created.
    stored = conn.execute(
        "SELECT sql FROM sqlite_master"
        " WHERE type = 'view' AND name = 'v_default_inst_filings'"
    ).fetchone()[0]
    body = stored[stored.index(" OR ("):]           # past `SELECT r.*`
    delta_side, _, tolerance_side = body.rpartition("<=")
    assert "*" not in delta_side, delta_side        # δ is never multiplied…
    assert "*" not in tolerance_side, tolerance_side
    assert "/ 1000" in tolerance_side, tolerance_side   # …the tolerance divides

    # 3. Both operands stay integer-typed at int64 magnitudes.
    for declared, resolved in [
        (0, PROMOTION_DELTA),
        (INT64_MAX // 2, INT64_MAX // 2 + PROMOTION_DELTA),
        (INT64_MAX, INT64_MAX),
    ]:
        _kept, delta_type, tol_type = _sql_predicate(conn, declared, resolved)
        assert delta_type == "integer", (declared, resolved)
        assert tol_type == "integer", (declared, resolved)
    # The Python side is integer division too: `//`, never `/`. A float tolerance
    # would reintroduce, in Python, exactly what the SQL form was fixed to avoid.
    assert isinstance(cover_tolerance_usd(INT64_MAX), int)
    assert cover_tolerance_usd(INT64_MAX) == INT64_MAX // 1000
    conn.close()


def test_sql_and_python_agree_beyond_the_integer_promotion_boundary(tmp_path):
    """F5: SQL and Python must classify identically over the WHOLE domain, and
    the round-1 agreement sweep stopped at $2e9 — six orders of magnitude short
    of the region that triggered the promotion.

    The third comparison is the amendment's own proof obligation: the shipped
    integer-DIVISION predicate must admit exactly the integers the superseded
    exact-rational `1000·δ ≤ max(1_000_000, T)` admitted, so amending §I1
    changed the arithmetic and no disposition. Python integers are unbounded, so
    the reference form is evaluated exactly here even where SQLite could not.

    Mutation guard: `//` -> `/` in `cover_tolerance_usd`, or a floor/ceil slip in
    either engine, splits the three verdicts at a boundary case.
    """
    conn = _fresh(tmp_path)
    scales = [
        0, 1, 999, 1_000, 1_000_000, 10_000_000, 2_000_000_000,
        1_000_000_000_000,
        PROMOTION_DELTA - 1, PROMOTION_DELTA, PROMOTION_DELTA + 1,
        PROMOTION_DELTA * 1_000,                     # δ alone overflows the old form
        INT64_MAX // 2, INT64_MAX - 1, INT64_MAX,
    ]
    for declared in scales:
        tol = cover_tolerance_usd(declared)
        for delta in (0, 1, tol - 1, tol, tol + 1):
            if delta < 0 or declared > INT64_MAX - delta:
                continue                              # unrepresentable, not a case
            resolved = declared + delta
            python_kept = classify_cover(declared, resolved) != COVER_CONFLICT
            sql_kept, delta_type, tol_type = _sql_predicate(conn, declared, resolved)
            # The superseded form, in EXACT unbounded Python integers.
            reference_kept = 1000 * (resolved - declared) <= max(1_000_000, declared)
            assert sql_kept == python_kept == reference_kept, (declared, resolved)
            assert delta_type == tol_type == "integer", (declared, resolved)
    conn.close()


# --- RUN M2-11 T0 delta: connection-local materialization --------------------


_MATERIALIZED_TEMP_NAMES = (
    "_populus_inst_affiliation_sources",
    "_populus_inst_affiliation_edges",
    "_populus_inst_affiliation_edges_lookup",
    "v_inst_reconciled_filings",
    "_populus_inst_coverage_totals",
    "_populus_inst_coverage_totals_by_filing",
    "v_filer_reported_filings",
    "v_filer_reported_filings_by_filing",
    "v_filer_reported_holdings",
    "v_default_inst_filings",
    "v_default_inst_filings_by_filing",
    "v_default_holdings",
    "_populus_inst_agg_input",
)


def _temp_objects(conn):
    placeholders = ", ".join("?" for _ in _MATERIALIZED_TEMP_NAMES)
    return conn.execute(
        "SELECT type, name FROM sqlite_temp_schema"
        f" WHERE name IN ({placeholders}) ORDER BY name",  # nosec B608
        _MATERIALIZED_TEMP_NAMES,
    ).fetchall()


def _set_filing_semantics(
    conn,
    fid,
    *,
    filed=None,
    amendment_type=None,
    amendment_no=None,
    file_number_norm="028-00001",
    other_managers=(),
    lifecycle="active",
):
    """Shape one `_file` row for amendment/affiliation materialization tests."""
    conn.execute(
        "UPDATE inst_filings SET"
        " filed_date = COALESCE(?, filed_date),"
        " submission_type = ?, is_amendment = ?, amendment_type = ?,"
        " amendment_no = ?, file_number_norm = ?, other_managers = ?,"
        " lifecycle = ? WHERE filing_id = ?",
        (
            filed,
            "13F-HR/A" if amendment_type is not None else "13F-HR",
            amendment_type is not None,
            amendment_type,
            amendment_no,
            file_number_norm,
            json.dumps(list(other_managers), separators=(",", ":")),
            lifecycle,
            fid,
        ),
    )


def _manager(file_number_norm):
    return {"file_number_norm": file_number_norm}


def test_materialized_coverage_and_periods_have_complete_semantic_parity(tmp_path):
    """D4/D7/D9: complete dataclasses stay equal across every semantic case."""
    conn = _fresh(tmp_path)
    _file(conn, fid="inst:EXACT", cik="0000000001", period="2026-03-31",
          declared=1_000_000, resolved=1_000_000)
    _file(conn, fid="inst:UNDER", cik="0000000002", period="2026-03-31",
          declared=1_000_000, resolved=900_000, cusip=MSFT)
    _file(conn, fid="inst:ROUND", cik="0000000003", period="2026-06-30",
          declared=1_000_000, resolved=1_000_999)
    _file(conn, fid="inst:CONFLICT", cik="0000000004", period="2026-06-30",
          declared=10_000_000, resolved=10_010_001, cusip=MSFT)
    _filer(conn, "0000000005")
    sid = _security(conn, "sec:failed")
    _load(
        conn,
        fid="inst:FAILED",
        cik="0000000005",
        period="2026-06-30",
        filed="2026-07-15",
        total=None,
        parse_status="failed",
        failure_kind="cover_malformed",
        flags=["cover_failed"],
        holds=[_hold(ordinal=1, issuer="FAILED", cusip=APPLE, value=500,
                     security_id=sid)],
    )
    _file(conn, fid="inst:ZERO", cik="0000000006", period="2026-06-30",
          declared=10_000, resolved=0)
    conn.execute("DELETE FROM inst_holdings WHERE filing_id = 'inst:ZERO'")
    conn.execute(
        "INSERT INTO security_list_intervals"
        " (security_id, id_type, value, valid_from, valid_to, quarter,"
        "  is_option, status_flag, provenance, confidence, review_state,"
        "  license_id, source_url, list_sha256, parser_version,"
        "  normalization_version)"
        " VALUES (?, 'cusip', ?, '2026-01-01', '2026-04-01', '2026q1',"
        " 0, '', 'sec-13f-list', 'high', 'auto', 'sec-13f-list', 'u',"
        " 'sha', 'p', 'n')",
        (sid, APPLE),
    )

    expected_coverage = compute_coverage(conn)
    expected_periods = compute_period_coverage(conn)
    assert [p.covered_by_list for p in expected_periods] == [True, False]
    assert expected_coverage.cover_failed_count == 1
    assert expected_coverage.cover_conflict_filing_ids == ("inst:CONFLICT",)
    assert expected_coverage.cover_rounding_count == 1

    with materialized_inst_derivation_views(conn):
        assert conn.execute(
            "SELECT 1 FROM _populus_inst_coverage_totals"
            " WHERE filing_id = 'inst:ZERO'"
        ).fetchone() is None
        assert compute_coverage(conn) == expected_coverage
        assert compute_period_coverage(conn) == expected_periods
    conn.close()


def test_coverage_sql_uses_owned_totals_only_inside_materializer(tmp_path):
    """R3/R7 removal-fails: TEMP entry switches every expensive read once."""
    conn = _fresh(tmp_path)
    _file(conn, fid="inst:ONE", cik="0000000001",
          declared=1_000, resolved=1_000)

    baseline = _production_coverage_queries(conn)
    assert baseline["coverage_denominator"] == _COVERAGE_DENOMINATOR_SQL
    assert baseline["cover_dispositions_reconciled"] == (
        _PER_FILING_COVER_SQL.format(view="v_inst_reconciled_filings")
    )
    with materialized_inst_derivation_views(conn):
        selected = _production_coverage_queries(conn)
        for name in (
            "coverage_denominator",
            "coverage_numerator",
            "period_coverage_denominator",
            "period_coverage_numerator",
            "cover_dispositions_reconciled",
            "cover_dispositions_default",
        ):
            assert "_populus_inst_coverage_totals" in selected[name]
            assert "inst_holdings" not in selected[name]
        assert "json_each(v_default_inst_filings.flags)" in selected[
            "coverage_cover_failed"
        ]
    assert _production_coverage_queries(conn) == baseline
    conn.close()


def test_materialized_filing_rows_match_every_survivor_and_affiliation_edge_case(
    tmp_path,
):
    """A2–A6: complete TEMP/main rows agree across the rule's decision tree."""
    conn = _fresh(tmp_path)

    # All three ordering tie-breakers plus additive NEW_HOLDINGS.  Only TIE-D
    # (largest accession at the winning date/number) and later additive TIE-E
    # survive the RESTATEMENT stage.
    for fid in ("inst:TIE-A", "inst:TIE-B", "inst:TIE-C", "inst:TIE-D", "inst:TIE-E"):
        _file(conn, fid=fid, cik="0000000001", declared=1_000, resolved=1_000)
    _set_filing_semantics(conn, "inst:TIE-A", filed="2026-04-10")
    _set_filing_semantics(
        conn, "inst:TIE-B", filed="2026-04-11",
        amendment_type="RESTATEMENT", amendment_no=1,
    )
    _set_filing_semantics(
        conn, "inst:TIE-C", filed="2026-04-11",
        amendment_type="RESTATEMENT", amendment_no=2,
    )
    _set_filing_semantics(
        conn, "inst:TIE-D", filed="2026-04-11",
        amendment_type="RESTATEMENT", amendment_no=2,
    )
    _set_filing_semantics(
        conn, "inst:TIE-E", filed="2026-04-12",
        amendment_type="NEW_HOLDINGS", amendment_no=3,
    )

    # The covering source fails cover reconciliation, but affiliation is defined
    # over PRE-cover survivors, so COVERED must still be suppressed. Duplicate
    # manager entries are semantically harmless.
    _file(
        conn, fid="inst:COVERER", cik="0000000002",
        declared=1_000, resolved=1_000_000,
    )
    _set_filing_semantics(
        conn, "inst:COVERER", file_number_norm="028-COVERER",
        other_managers=(_manager("028-COVERED"), _manager("028-COVERED")),
    )
    _file(conn, fid="inst:COVERED", cik="0000000003", declared=2_000, resolved=2_000)
    _set_filing_semantics(conn, "inst:COVERED", file_number_norm="028-COVERED")

    # A superseded original's stale manager list cannot suppress VICTIM; the
    # surviving restatement intentionally drops that list.
    _file(conn, fid="inst:STALE-ORIG", cik="0000000004", declared=3_000, resolved=3_000)
    _set_filing_semantics(
        conn, "inst:STALE-ORIG", filed="2026-04-10",
        file_number_norm="028-STALE", other_managers=(_manager("028-VICTIM"),),
    )
    _file(conn, fid="inst:STALE-REST", cik="0000000004", declared=4_000, resolved=4_000)
    _set_filing_semantics(
        conn, "inst:STALE-REST", filed="2026-04-11",
        amendment_type="RESTATEMENT", amendment_no=1,
        file_number_norm="028-STALE",
    )
    _file(conn, fid="inst:VICTIM", cik="0000000005", declared=5_000, resolved=5_000)
    _set_filing_semantics(conn, "inst:VICTIM", file_number_norm="028-VICTIM")

    # A filing cannot suppress itself; affiliation is period-local; NULL never
    # matches; and an inactive source contributes no manager edge.
    _file(conn, fid="inst:SELF", cik="0000000006", declared=6_000, resolved=6_000)
    _set_filing_semantics(
        conn, "inst:SELF", file_number_norm="028-SELF",
        other_managers=(_manager("028-SELF"),),
    )
    _file(conn, fid="inst:CROSS-SOURCE", cik="0000000007", declared=7_000, resolved=7_000)
    _set_filing_semantics(
        conn, "inst:CROSS-SOURCE", file_number_norm="028-SOURCE",
        other_managers=(_manager("028-CROSS"),),
    )
    _file(
        conn, fid="inst:CROSS-TARGET", cik="0000000008", period="2026-06-30",
        declared=8_000, resolved=8_000,
    )
    _set_filing_semantics(conn, "inst:CROSS-TARGET", file_number_norm="028-CROSS")
    _file(conn, fid="inst:NULL", cik="0000000009", declared=9_000, resolved=9_000)
    _set_filing_semantics(conn, "inst:NULL", file_number_norm=None)
    _file(conn, fid="inst:INACTIVE", cik="0000000010", declared=10_000, resolved=10_000)
    _set_filing_semantics(
        conn, "inst:INACTIVE", lifecycle="retired",
        file_number_norm="028-INACTIVE",
        other_managers=(_manager("028-INACTIVE-VICTIM"),),
    )
    _file(
        conn, fid="inst:INACTIVE-VICTIM", cik="0000000011",
        declared=11_000, resolved=11_000,
    )
    _set_filing_semantics(
        conn, "inst:INACTIVE-VICTIM", file_number_norm="028-INACTIVE-VICTIM"
    )

    main_reconciled_cursor = conn.execute(
        "SELECT * FROM main.v_inst_reconciled_filings ORDER BY filing_id"
    )
    main_reconciled_columns = tuple(
        column[0] for column in main_reconciled_cursor.description
    )
    main_reconciled_rows = main_reconciled_cursor.fetchall()
    assert {row[0] for row in main_reconciled_rows} == {
        "inst:COVERER",
        "inst:CROSS-SOURCE",
        "inst:CROSS-TARGET",
        "inst:INACTIVE-VICTIM",
        "inst:NULL",
        "inst:SELF",
        "inst:STALE-REST",
        "inst:TIE-D",
        "inst:TIE-E",
        "inst:VICTIM",
    }

    main_reported_cursor = conn.execute(
        "SELECT * FROM main.v_filer_reported_filings ORDER BY filing_id"
    )
    main_reported_columns = tuple(
        column[0] for column in main_reported_cursor.description
    )
    main_reported_rows = main_reported_cursor.fetchall()
    assert {row[0] for row in main_reported_rows} == {
        "inst:COVERED",
        "inst:CROSS-SOURCE",
        "inst:CROSS-TARGET",
        "inst:INACTIVE-VICTIM",
        "inst:NULL",
        "inst:SELF",
        "inst:STALE-REST",
        "inst:TIE-D",
        "inst:TIE-E",
        "inst:VICTIM",
    }
    main_reported_holdings = conn.execute(
        "SELECT * FROM main.v_filer_reported_holdings ORDER BY holding_id"
    ).fetchall()

    main_default_cursor = conn.execute(
        "SELECT * FROM main.v_default_inst_filings ORDER BY filing_id"
    )
    main_default_columns = tuple(
        column[0] for column in main_default_cursor.description
    )
    main_default_rows = main_default_cursor.fetchall()
    assert {row[0] for row in main_default_rows} == {
        "inst:CROSS-SOURCE",
        "inst:CROSS-TARGET",
        "inst:INACTIVE-VICTIM",
        "inst:NULL",
        "inst:SELF",
        "inst:STALE-REST",
        "inst:TIE-D",
        "inst:TIE-E",
        "inst:VICTIM",
    }
    main_default_holdings = conn.execute(
        "SELECT * FROM main.v_default_holdings ORDER BY holding_id"
    ).fetchall()
    expected_totals = conn.execute(
        "SELECT filing_id, COALESCE(SUM(value_usd), 0) AS resolved_usd"
        " FROM main.inst_holdings WHERE security_id IS NOT NULL"
        " GROUP BY filing_id ORDER BY filing_id"
    ).fetchall()

    with materialized_inst_derivation_views(conn):
        temp_reconciled_cursor = conn.execute(
            "SELECT * FROM temp.v_inst_reconciled_filings ORDER BY filing_id"
        )
        assert tuple(
            column[0] for column in temp_reconciled_cursor.description
        ) == main_reconciled_columns
        assert temp_reconciled_cursor.fetchall() == main_reconciled_rows
        assert conn.execute(
            "SELECT filing_id, resolved_usd"
            " FROM temp._populus_inst_coverage_totals ORDER BY filing_id"
        ).fetchall() == expected_totals
        temp_reported_cursor = conn.execute(
            "SELECT * FROM temp.v_filer_reported_filings ORDER BY filing_id"
        )
        assert tuple(
            column[0] for column in temp_reported_cursor.description
        ) == main_reported_columns
        assert temp_reported_cursor.fetchall() == main_reported_rows
        assert conn.execute(
            "SELECT * FROM temp.v_filer_reported_holdings ORDER BY holding_id"
        ).fetchall() == main_reported_holdings
        aggregate_input = conn.execute(
            "SELECT cik, period_of_report, security_id, cusip, issuer_name_raw,"
            " value_usd, ssh_prnamt, ssh_prnamt_type, put_call, entity_id,"
            " entity_link_state, unkeyed_token, is_default"
            " FROM temp._populus_inst_agg_input"
            " ORDER BY cik, period_of_report, unkeyed_token, cusip, security_id"
        ).fetchall()
        expected_aggregate_input = conn.execute(
            "SELECT h.cik, h.period_of_report, h.security_id, h.cusip,"
            " h.issuer_name_raw, h.value_usd, h.ssh_prnamt, h.ssh_prnamt_type,"
            " h.put_call, s.entity_id, s.entity_link_state,"
            " CASE WHEN h.security_id IS NULL AND h.cusip IS NULL"
            "      THEN h.holding_id ELSE NULL END,"
            " CASE WHEN d.filing_id IS NULL THEN 0 ELSE 1 END"
            " FROM main.inst_holdings h"
            " JOIN temp.v_filer_reported_filings r ON r.filing_id = h.filing_id"
            " LEFT JOIN main.securities s ON s.security_id = h.security_id"
            " LEFT JOIN temp.v_default_inst_filings d ON d.filing_id = h.filing_id"
            " ORDER BY h.cik, h.period_of_report,"
            " CASE WHEN h.security_id IS NULL AND h.cusip IS NULL"
            "      THEN h.holding_id ELSE NULL END, h.cusip, h.security_id"
        ).fetchall()
        assert aggregate_input == expected_aggregate_input

        temp_default_cursor = conn.execute(
            "SELECT * FROM temp.v_default_inst_filings ORDER BY filing_id"
        )
        assert tuple(
            column[0] for column in temp_default_cursor.description
        ) == main_default_columns
        assert temp_default_cursor.fetchall() == main_default_rows
        assert conn.execute(
            "SELECT * FROM temp.v_default_holdings ORDER BY holding_id"
        ).fetchall() == main_default_holdings
    conn.close()


def test_materialized_stale_view_refuses_before_temp_data_creation(tmp_path):
    """A9: direct F8 stays fail-closed; materialization rejects drift earlier."""
    conn = _fresh(tmp_path)
    _file(conn, fid="inst:BAD", cik="0000000001",
          declared=10_000_000, resolved=10_010_001)
    conn.execute("DROP VIEW v_default_holdings")
    conn.execute("DROP VIEW v_default_inst_filings")
    conn.execute(
        "CREATE VIEW v_default_inst_filings AS"
        " SELECT r.* FROM v_inst_reconciled_filings r"
    )
    conn.execute(
        "CREATE VIEW v_default_holdings AS SELECT h.* FROM inst_holdings h"
        " JOIN v_default_inst_filings f ON f.filing_id = h.filing_id"
    )
    expected = compute_coverage(conn)
    assert expected.inflated_filing_count == 1
    assert expected.certifiable is False
    assert expected.meets_threshold is False
    with pytest.raises(ViewVerificationError, match="v_default_inst_filings"):
        with materialized_inst_derivation_views(conn):
            pass
    assert _temp_objects(conn) == []
    conn.close()


def test_temp_holdings_shadow_freezes_the_complete_namespace(tmp_path):
    """Removal-fails: without the TEMP holdings view, NEW leaks into holdings."""
    conn = _fresh(tmp_path)
    _file(conn, fid="inst:OLD", cik="0000000001",
          declared=1_000_000, resolved=1_000_000)
    expected_coverage = compute_coverage(conn)
    with materialized_inst_derivation_views(conn):
        assert _temp_objects(conn) == [
            ("table", "_populus_inst_agg_input"),
            ("table", "_populus_inst_coverage_totals"),
            ("index", "_populus_inst_coverage_totals_by_filing"),
            ("view", "v_default_holdings"),
            ("table", "v_default_inst_filings"),
            ("index", "v_default_inst_filings_by_filing"),
            ("table", "v_filer_reported_filings"),
            ("index", "v_filer_reported_filings_by_filing"),
            ("view", "v_filer_reported_holdings"),
            ("table", "v_inst_reconciled_filings"),
        ]
        _file(conn, fid="inst:NEW", cik="0000000002", period="2026-06-30",
              declared=2_000_000, resolved=2_000_000, cusip=MSFT)
        assert conn.execute(
            "SELECT filing_id FROM v_default_inst_filings ORDER BY filing_id"
        ).fetchall() == [("inst:OLD",)]
        assert conn.execute(
            "SELECT DISTINCT filing_id FROM v_default_holdings ORDER BY filing_id"
        ).fetchall() == [("inst:OLD",)]
        assert conn.execute(
            "SELECT filing_id FROM v_filer_reported_filings ORDER BY filing_id"
        ).fetchall() == [("inst:OLD",)]
        assert conn.execute(
            "SELECT filing_id FROM v_inst_reconciled_filings ORDER BY filing_id"
        ).fetchall() == [("inst:OLD",)]
        assert conn.execute(
            "SELECT filing_id FROM _populus_inst_coverage_totals"
            " ORDER BY filing_id"
        ).fetchall() == [("inst:OLD",)]
        assert conn.execute(
            "SELECT DISTINCT filing_id FROM v_filer_reported_holdings"
            " ORDER BY filing_id"
        ).fetchall() == [("inst:OLD",)]
        assert conn.execute(
            "SELECT DISTINCT filing_id FROM main.v_default_holdings"
            " ORDER BY filing_id"
        ).fetchall() == [("inst:NEW",), ("inst:OLD",)]
        assert conn.execute(
            "SELECT DISTINCT filing_id FROM main.v_filer_reported_holdings"
            " ORDER BY filing_id"
        ).fetchall() == [("inst:NEW",), ("inst:OLD",)]
        assert compute_coverage(conn) == expected_coverage
    assert _temp_objects(conn) == []
    conn.close()


@pytest.mark.parametrize("collision", [
    "_populus_inst_affiliation_sources",
    "_populus_inst_affiliation_edges",
    "_populus_inst_affiliation_edges_lookup",
    "v_inst_reconciled_filings",
    "_populus_inst_coverage_totals",
    "_populus_inst_coverage_totals_by_filing",
    "_populus_inst_agg_input",
    "v_filer_reported_filings",
    "v_filer_reported_filings_by_filing",
    "v_filer_reported_holdings",
    "v_default_inst_filings",
    "v_default_inst_filings_by_filing",
    "v_default_holdings",
])
def test_materialization_refuses_every_owned_temp_name(tmp_path, collision):
    conn = _fresh(tmp_path)
    if collision in {
        "_populus_inst_affiliation_edges_lookup",
        "_populus_inst_coverage_totals_by_filing",
        "v_filer_reported_filings_by_filing",
        "v_default_inst_filings_by_filing",
    }:
        conn.execute(
            "CREATE TEMP TABLE caller_state"
            " (filing_id TEXT, period_of_report TEXT, manager_file_number TEXT)"
        )
        conn.execute(
            f"CREATE INDEX temp.{collision}"  # nosec B608 — fixed parameter cases
            " ON caller_state(filing_id)"
        )
    elif collision in {"v_filer_reported_holdings", "v_default_holdings"}:
        conn.execute(
            f"CREATE TEMP VIEW {collision} AS SELECT 1 AS x"  # nosec B608
        )
    else:
        conn.execute(
            f"CREATE TEMP TABLE {collision} (filing_id TEXT)"  # nosec B608
        )
    with pytest.raises(RuntimeError, match=collision):
        with materialized_inst_derivation_views(conn):
            pass
    assert conn.execute(
        "SELECT 1 FROM sqlite_temp_schema WHERE name = ?", (collision,)
    ).fetchone() == (1,)
    conn.close()


def test_materialization_cleans_normal_and_body_exception(tmp_path):
    conn = _fresh(tmp_path)
    main_schema = conn.execute(
        "SELECT type, name, tbl_name, COALESCE(sql, '') FROM main.sqlite_schema"
        " ORDER BY type, name, tbl_name, sql"
    ).fetchall()
    db_path = Path(conn.execute("PRAGMA database_list").fetchone()[2])
    before = db_path.read_bytes()
    with materialized_inst_derivation_views(conn):
        assert len(_temp_objects(conn)) == 10
    assert _temp_objects(conn) == []
    with pytest.raises(ValueError, match="body failed"):
        with materialized_inst_derivation_views(conn):
            raise ValueError("body failed")
    assert _temp_objects(conn) == []

    assert conn.execute(
        "SELECT type, name, tbl_name, COALESCE(sql, '') FROM main.sqlite_schema"
        " ORDER BY type, name, tbl_name, sql"
    ).fetchall() == main_schema
    assert db_path.read_bytes() == before
    conn.close()


@pytest.mark.parametrize("failure_prefix", [
    "CREATE TEMP TABLE _populus_inst_affiliation_sources",
    "CREATE TEMP TABLE _populus_inst_affiliation_edges",
    "CREATE INDEX temp._populus_inst_affiliation_edges_lookup",
    "CREATE TEMP TABLE v_inst_reconciled_filings",
    "CREATE TEMP TABLE v_filer_reported_filings",
    "CREATE INDEX temp.v_filer_reported_filings_by_filing",
    "CREATE TEMP TABLE v_default_inst_filings",
    "CREATE INDEX temp.v_default_inst_filings_by_filing",
    "CREATE TEMP TABLE _populus_inst_coverage_totals",
    "CREATE UNIQUE INDEX temp._populus_inst_coverage_totals_by_filing",
    "CREATE TEMP TABLE _populus_inst_agg_input",
    "DROP INDEX temp._populus_inst_affiliation_edges_lookup",
    "DROP TABLE temp._populus_inst_affiliation_edges",
    "DROP TABLE temp._populus_inst_affiliation_sources",
    "CREATE TEMP VIEW v_filer_reported_holdings",
    "CREATE TEMP VIEW v_default_holdings",
])
def test_materialization_cleans_every_partial_setup_path(tmp_path, failure_prefix):
    conn = _fresh(tmp_path)
    main_schema = conn.execute(
        "SELECT type, name, tbl_name, COALESCE(sql, '') FROM main.sqlite_schema"
        " ORDER BY type, name, tbl_name, sql"
    ).fetchall()
    db_path = Path(conn.execute("PRAGMA database_list").fetchone()[2])
    before = db_path.read_bytes()

    class _FailOnceConnection:
        failed = False

        def execute(self, sql, *args):
            if (
                not self.failed
                and isinstance(sql, str)
                and sql.lstrip().startswith(failure_prefix)
            ):
                self.failed = True
                raise sqlite3.OperationalError("forced partial setup")
            return conn.execute(sql, *args)

    with pytest.raises(sqlite3.OperationalError, match="partial setup"):
        with materialized_inst_derivation_views(_FailOnceConnection()):
            pass
    assert _temp_objects(conn) == []
    assert conn.execute(
        "SELECT type, name, tbl_name, COALESCE(sql, '') FROM main.sqlite_schema"
        " ORDER BY type, name, tbl_name, sql"
    ).fetchall() == main_schema
    assert db_path.read_bytes() == before
    conn.close()


@pytest.mark.parametrize("drop_prefix", [
    "DROP VIEW IF EXISTS temp.v_default_holdings",
    "DROP VIEW IF EXISTS temp.v_filer_reported_holdings",
    "DROP TABLE IF EXISTS temp._populus_inst_agg_input",
    "DROP INDEX IF EXISTS temp.v_default_inst_filings_by_filing",
    "DROP TABLE IF EXISTS temp.v_default_inst_filings",
    "DROP INDEX IF EXISTS temp.v_filer_reported_filings_by_filing",
    "DROP TABLE IF EXISTS temp.v_filer_reported_filings",
    "DROP INDEX IF EXISTS temp._populus_inst_coverage_totals_by_filing",
    "DROP TABLE IF EXISTS temp._populus_inst_coverage_totals",
    "DROP TABLE IF EXISTS temp.v_inst_reconciled_filings",
])
def test_materialization_retries_every_consumer_cleanup_drop(tmp_path, drop_prefix):
    """R8: one transient cleanup error cannot strand owned TEMP peers."""
    conn = _fresh(tmp_path)
    _file(conn, fid="inst:ONE", cik="0000000001", declared=1_000, resolved=1_000)

    class _FailDropOnceConnection:
        failed = False

        def execute(self, sql, *args):
            if (
                not self.failed
                and isinstance(sql, str)
                and sql.startswith(drop_prefix)
            ):
                self.failed = True
                raise sqlite3.OperationalError("forced cleanup drop")
            return conn.execute(sql, *args)

    with materialized_inst_derivation_views(_FailDropOnceConnection()):
        pass
    assert _temp_objects(conn) == []
    conn.close()


def test_materialization_final_query_requires_the_affiliation_index(tmp_path):
    """A4 removal-fails: `INDEXED BY` forbids a silent edge-table scan."""
    conn = _fresh(tmp_path)
    _file(conn, fid="inst:ONE", cik="0000000001", declared=1_000, resolved=1_000)

    class _MissingEdgeIndexConnection:
        def execute(self, sql, *args):
            if isinstance(sql, str) and sql.startswith(
                "CREATE INDEX temp._populus_inst_affiliation_edges_lookup"
            ):
                return conn.execute("SELECT 1")
            return conn.execute(sql, *args)

    with pytest.raises(sqlite3.OperationalError, match="no such index"):
        with materialized_inst_derivation_views(_MissingEdgeIndexConnection()):
            pass
    assert _temp_objects(conn) == []
    conn.close()


def test_materialized_coverage_requires_the_owned_totals_index(tmp_path):
    """R3 removal-fails: optimized reads cannot degrade to a totals scan."""
    conn = _fresh(tmp_path)
    _file(conn, fid="inst:ONE", cik="0000000001", declared=1_000, resolved=1_000)

    class _MissingTotalsIndexConnection:
        def execute(self, sql, *args):
            if isinstance(sql, str) and sql.startswith(
                "CREATE UNIQUE INDEX temp._populus_inst_coverage_totals_by_filing"
            ):
                return conn.execute("SELECT 1")
            return conn.execute(sql, *args)

    with materialized_inst_derivation_views(_MissingTotalsIndexConnection()):
        with pytest.raises(sqlite3.OperationalError, match="no such index"):
            compute_coverage(conn)
    assert _temp_objects(conn) == []
    conn.close()


def test_materialization_reads_the_persistent_reported_view_once(tmp_path):
    """B3 removal-fails: one canonical CTAS feeds both TEMP view families."""
    conn = _fresh(tmp_path)
    _file(conn, fid="inst:ONE", cik="0000000001", declared=1_000, resolved=1_000)
    statements = []

    class _RecordingConnection:
        def execute(self, sql, *args):
            statements.append(sql)
            return conn.execute(sql, *args)

    with materialized_inst_derivation_views(_RecordingConnection()):
        pass
    reported_ctas = [
        sql
        for sql in statements
        if isinstance(sql, str)
        and sql.lstrip().startswith("CREATE TEMP TABLE v_filer_reported_filings")
        and "main.v_filer_reported_filings" in sql
    ]
    assert len(reported_ctas) == 1
    totals_ctas = [
        sql
        for sql in statements
        if isinstance(sql, str)
        and sql.lstrip().startswith(
            "CREATE TEMP TABLE _populus_inst_coverage_totals"
        )
        and "FROM main.inst_holdings" in sql
    ]
    assert len(totals_ctas) == 1
    aggregate_ctas = [
        sql
        for sql in statements
        if isinstance(sql, str)
        and sql.lstrip().startswith("CREATE TEMP TABLE _populus_inst_agg_input")
        and "FROM main.inst_holdings" in sql
    ]
    assert len(aggregate_ctas) == 1
    assert _temp_objects(conn) == []
    conn.close()


def test_the_default_view_agrees_with_the_classifier_at_int64_scale(tmp_path):
    """F5, through the real view rather than a bare expression: two filings at
    ~9.2e15 straddling their own tolerance boundary — one kept, one excluded —
    at high scale — a classifier/view agreement check; the storage-class test above exercises the actual REAL-promotion region.
    """
    conn = _fresh(tmp_path)
    declared = INT64_MAX // 1000            # 9_223_372_036_854_775
    tol = cover_tolerance_usd(declared)     # 9_223_372_036_854
    _file(conn, fid="inst:HUGE-KEPT", cik="0000000001", period="2026-03-31",
          declared=declared, resolved=declared + tol)
    _file(conn, fid="inst:HUGE-OUT", cik="0000000002", period="2026-06-30",
          declared=declared, resolved=declared + tol + 1, cusip=MSFT)

    assert classify_cover(declared, declared + tol) == COVER_ROUNDING
    assert classify_cover(declared, declared + tol + 1) == COVER_CONFLICT
    assert _in_default_view(conn, "inst:HUGE-KEPT") is True
    assert _in_default_view(conn, "inst:HUGE-OUT") is False

    coverage = compute_coverage(conn)
    assert coverage.cover_conflict_filing_ids == ("inst:HUGE-OUT",)
    assert coverage.cover_rounding_count == 1
    assert coverage.cover_rounding_max_delta_usd == tol
    assert coverage.denominator == declared + tol     # max(S, T) at this scale
    assert coverage.coverage == 1.0
    conn.close()


# --- F3: EVERY coverage-reporting surface names a NON-EMPTY conflict set ------


def _conflict_corpus(tmp_path, name="surfaces.db"):
    """A corpus with one exact filing, one tolerated rounding filing and one
    excluded conflict — so every surface assertion below is non-empty."""
    conn = _fresh(tmp_path, name)
    _file(conn, fid="inst:GOOD", cik="0000000001", period="2026-03-31",
          declared=1_000_000, resolved=1_000_000)
    _file(conn, fid="inst:ROUND", cik="0000000002", period="2026-03-30",
          declared=1_000_000, resolved=1_000_999, cusip=MSFT)
    _file(conn, fid="inst:BAD", cik="0000000003", period="2026-03-29",
          declared=10_000_000, resolved=10_010_001)
    return conn


def test_bulk_summary_names_the_excluded_conflicts(tmp_path):
    """F3, surface 2 of 6: `format_bulk_summary` printed a coverage number with
    zero `cover_conflict` references. An operator reading a bulk run could not
    tell that a filing had been dropped from both sides of the ratio.

    Non-empty by construction — a key-presence assertion on an empty list is
    what let this ship (external review F3, verbatim).

    Mutation guard: deleting the `disposition_line` append from
    `format_bulk_summary` fails both assertions.
    """
    from populus.inst_bulk import BulkReport, format_bulk_summary

    conn = _conflict_corpus(tmp_path)
    coverage = compute_coverage(conn)
    conn.close()
    assert coverage.cover_conflict_filing_ids == ("inst:BAD",)   # non-empty

    text = format_bulk_summary(
        BulkReport(run_id="r", filing_quarter="2026q1", report_period="2026-03-31",
                   universe_size=0, coverage=coverage)
    )
    assert "value-coverage:" in text                       # the number is stated…
    assert "cover_conflict EXCLUDED 1: inst:BAD" in text   # …and so is the cost
    assert "cover_rounding 1 (max delta 999)" in text
