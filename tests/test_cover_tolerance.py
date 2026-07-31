"""Cover reconciliation: tolerance and conflict exclusion (M2-7).

Normative spec: ``docs/build/M2-7-cover-tolerance-spec.md``. One test per
invariant, named in the spec. Owner decision 2026-07-31 ("Tolerance + flag"):
a declared cover total the info table misses by rounding must never de-certify
the module, and a declared cover total the info table contradicts must never be
served — excluded-and-flagged, never silently wrong.

Hermetic and always-run: crafted corpora, no network, no fixture rewrite.
"""

from __future__ import annotations

from populus.amendments import ensure_views
from populus.db import connect, init_db
from populus.identity.registry import ensure_registry
from populus.ingest.inst13f import (
    COVER_CONFLICT,
    COVER_EXACT,
    COVER_ROUNDING,
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
        "UPDATE inst_holdings SET value_usd = 9_000_000"
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
