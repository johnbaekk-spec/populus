"""Coverage re-measurement with the definitional 13(f) list (RUN M2-5, R9/R11).

Always-run, hermetic: a crafted institutional corpus whose holdings resolve
through seeded list intervals clears the ≥0.95 gate, and its per-period figures
report honestly. An uncovered quarter (valid FTD, no list) keeps EXACTLY today's
FTD-only arithmetic — never forced to zero — and is flagged not-covered-by-list.
The full-corpus measurement evidence is the mandatory `make accept-m2-5` output.
"""

from __future__ import annotations

from pathlib import Path

from populus.amendments import ensure_views
from populus.db import connect, init_db
from populus.identity.bootstrap import FtdObservation, Mutations, bootstrap_ftd
from populus.identity.list13f_seed import bootstrap_13f_list
from populus.identity.registry import ensure_registry, parse_identity_registry, resolve_cusip
from populus.ingest.inst13f import compute_coverage, compute_period_coverage
from populus.load import ensure_inst_schema
from populus.parse.list13f import parse_list13f_text

from test_inst_agg import _filer, _hold, _load  # established cross-fixture reuse

APPLE = "037833100"
MSFT = "594918104"
EMPTY = parse_identity_registry("classes: []\ncontinuities: []\n")


def _line(cusip, name, cls):
    row = cusip.ljust(9)[:9] + " " + name.ljust(30)[:30] + cls.ljust(27)[:27] + "   " + " " * 9 + "E"
    assert len(row) == 80
    return row


def _fresh(tmp_path):
    path = tmp_path / "cov.db"
    init_db(str(path))
    conn = connect(str(path))
    ensure_registry(conn)
    ensure_inst_schema(conn)
    ensure_views(conn)
    return conn


def _seed_list(conn, quarter, cusips, *, sha="s1"):
    parsed = parse_list13f_text(
        "\n".join(_line(c, "ISSUER", "COM") for c in cusips) + "\n", quarter=quarter
    )
    conn.execute("BEGIN IMMEDIATE")
    bootstrap_13f_list(
        conn, parsed, quarter=quarter, registry=EMPTY,
        source_meta={"source_url": "u", "sha256": sha, "retrieved_at": "t", "raw_path": "p"},
        mutations=Mutations(),
    )
    conn.execute("COMMIT")


def _seed_ftd(conn, value, dates):
    obs = [FtdObservation(settlement_date=d, id_type="cusip", value=value, symbol=None,
                          issuer_name="X") for d in dates]
    conn.execute("BEGIN IMMEDIATE")
    bootstrap_ftd(conn, obs, registry=EMPTY, mutations=Mutations())
    conn.execute("COMMIT")


def test_list_seeded_corpus_clears_the_coverage_gate(tmp_path):
    conn = _fresh(tmp_path)
    _seed_list(conn, "2026q1", [APPLE, MSFT])
    _filer(conn, "0000000001")
    # security_id is stamped by the SAME resolver the ingest uses (resolve_cusip),
    # now reading the definitional list interval.
    holds = [
        _hold(ordinal=1, issuer="APPLE", cusip=APPLE, value=1000,
              security_id=resolve_cusip(conn, APPLE, "2026-03-31")),
        _hold(ordinal=2, issuer="MSFT", cusip=MSFT, value=1000,
              security_id=resolve_cusip(conn, MSFT, "2026-03-31")),
    ]
    _load(conn, fid="inst:A-1", cik="0000000001", period="2026-03-31",
          filed="2026-04-15", holds=holds)

    coverage = compute_coverage(conn)
    assert coverage.coverage == 1.0
    assert coverage.meets_threshold is True

    periods = compute_period_coverage(conn)
    assert len(periods) == 1
    period = periods[0]
    assert period.period_of_report == "2026-03-31"
    assert period.numerator == 2000 and period.denominator == 2000
    assert period.coverage == 1.0
    assert period.covered_by_list is True
    conn.close()


def test_resolved_over_declared_total_never_reads_over_100pct(tmp_path):
    # F8, as amended by M2-7 (owner decision 2026-07-31, "Tolerance + flag"):
    # a filing whose resolved holdings exceed its declared total must NEVER yield
    # coverage > 1.0 and a passing gate. M2-3 enforced that by de-certifying the
    # corpus; M2-7 enforces it per filing — within tol(T) the denominator banks
    # max(S,T) (here 12,000,000, so the ratio is 1.0, not 1.2), and beyond
    # tolerance the filing is EXCLUDED from both sides and named. Neither route
    # can produce a >100% ratio. Mutation guard: a denominator of `declared`
    # restores coverage=1.2; dropping the view's cover stage readmits the
    # out-of-tolerance filing at 1.2.
    conn = _fresh(tmp_path)
    _seed_list(conn, "2026q1", [APPLE, MSFT])
    _filer(conn, "0000000001")
    # Declared cover total 10,000,000, but the single resolved holding is worth
    # 12,000,000 — 20% over, far beyond tol(T) = $10,000.
    _load(conn, fid="inst:A-1", cik="0000000001", period="2026-03-31", filed="2026-04-15",
          total=10_000_000,
          holds=[_hold(ordinal=1, issuer="APPLE", cusip=APPLE, value=12_000_000,
                       security_id=resolve_cusip(conn, APPLE, "2026-03-31"))])
    # ... beside a filing that reconciles exactly, so the corpus is measurable.
    _filer(conn, "0000000002")
    _load(conn, fid="inst:B-1", cik="0000000002", period="2026-03-31", filed="2026-04-15",
          total=1_000_000,
          holds=[_hold(ordinal=1, issuer="MSFT", cusip=MSFT, value=1_000_000,
                       security_id=resolve_cusip(conn, MSFT, "2026-03-31"))])

    coverage = compute_coverage(conn)
    assert coverage.cover_conflict_filing_ids == ("inst:A-1",)   # excluded, named
    assert coverage.inflated_filing_count == 0                   # none left inside
    assert coverage.numerator == 1_000_000 and coverage.denominator == 1_000_000
    assert coverage.coverage == 1.0                              # never 1.2
    assert coverage.certifiable is True
    conn.close()


def test_uncovered_quarter_keeps_ftd_only_arithmetic_and_is_flagged(tmp_path):
    # R11 (brief-amended): a quarter with valid FTD mappings but NO list keeps
    # bit-for-bit today's FTD-only coverage figure — NOT forced to zero — and its
    # period is flagged covered_by_list=False (the source of the uncovered-quarter
    # naming). Mutation guard: forcing uncovered periods to zero would change the
    # 0.5 below to 0.0; flagging them covered would flip covered_by_list.
    conn = _fresh(tmp_path)
    _seed_ftd(conn, APPLE, ["2026-06-30"])  # FTD covers the quarter-end date
    _filer(conn, "0000000001")
    holds = [
        _hold(ordinal=1, issuer="APPLE", cusip=APPLE, value=1000,
              security_id=resolve_cusip(conn, APPLE, "2026-06-30")),  # FTD-resolved
        _hold(ordinal=2, issuer="MSFT", cusip=MSFT, value=1000,
              security_id=resolve_cusip(conn, MSFT, "2026-06-30")),   # unresolved
    ]
    _load(conn, fid="inst:B-1", cik="0000000001", period="2026-06-30",
          filed="2026-07-15", holds=holds)

    coverage = compute_coverage(conn)
    assert coverage.coverage == 0.5          # FTD-only, unchanged arithmetic
    assert coverage.meets_threshold is False  # fails closed via the SAME threshold

    periods = compute_period_coverage(conn)
    period = periods[0]
    assert period.covered_by_list is False
    assert period.coverage == 0.5             # not forced to zero
    conn.close()


def test_covered_and_uncovered_periods_are_reported_side_by_side(tmp_path):
    conn = _fresh(tmp_path)
    _seed_list(conn, "2026q1", [APPLE, MSFT])          # 2026q1 covered by a list
    _seed_ftd(conn, APPLE, ["2026-06-30"])             # 2026q2 FTD only, no list
    _filer(conn, "0000000001")
    _load(conn, fid="inst:A-1", cik="0000000001", period="2026-03-31", filed="2026-04-15",
          holds=[
              _hold(ordinal=1, issuer="APPLE", cusip=APPLE, value=1000,
                    security_id=resolve_cusip(conn, APPLE, "2026-03-31")),
              _hold(ordinal=2, issuer="MSFT", cusip=MSFT, value=1000,
                    security_id=resolve_cusip(conn, MSFT, "2026-03-31")),
          ])
    _load(conn, fid="inst:B-1", cik="0000000001", period="2026-06-30", filed="2026-07-15",
          holds=[
              _hold(ordinal=1, issuer="APPLE", cusip=APPLE, value=1000,
                    security_id=resolve_cusip(conn, APPLE, "2026-06-30")),
              _hold(ordinal=2, issuer="MSFT", cusip=MSFT, value=1000,
                    security_id=resolve_cusip(conn, MSFT, "2026-06-30")),
          ])
    by_period = {p.period_of_report: p for p in compute_period_coverage(conn)}
    assert by_period["2026-03-31"].covered_by_list is True
    assert by_period["2026-03-31"].coverage == 1.0
    assert by_period["2026-06-30"].covered_by_list is False
    uncovered = [p.period_of_report for p in compute_period_coverage(conn)
                 if not p.covered_by_list]
    assert uncovered == ["2026-06-30"]
    conn.close()
