"""The RUN M2-5 acceptance command (T13): it ERRORS on missing inputs (never
skips), and — when the full 13(f)-list cache and the tracked Berkshire corpus
are present — clears the 0.95 gate. The full 5-quarter measurement is the DEV
evidence run via ``make accept-m2-5``; this pytest variant is the cache-gated
convenience duplicate (a single quarter, to stay fast)."""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parent.parent
DATA_CACHE = REPO_ROOT / "data-cache" / "13flist"


def _load_accept():
    spec = importlib.util.spec_from_file_location(
        "accept_m2_5", REPO_ROOT / "scripts" / "accept_m2_5.py"
    )
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def test_acceptance_errors_when_inputs_are_missing(tmp_path, monkeypatch):
    # Never skips: a missing required input is a NONZERO exit that names the file,
    # so the acceptance can never be silently green (review F5). Mutation guard:
    # pointing DATA_CACHE at an empty dir makes every input missing.
    accept = _load_accept()
    monkeypatch.setattr(accept, "DATA_CACHE", tmp_path / "empty")
    monkeypatch.setattr(accept, "REAL_CORPUS", tmp_path / "no-corpus")
    lines: list[str] = []
    rc = accept.run_acceptance(quarters=["2026q1"], out=lines.append)
    assert rc == 2
    output = "\n".join(lines)
    assert "MISSING" in output
    assert "13flist2026q1.pdf" in output
    assert "13flist2026q2-txt.txt" in output  # the R5 text side is required too
    assert f"CIK{accept.REAL_CIK}" in output


def test_report_path_gates_on_meets_threshold_certifiable_manifest_and_uncovered():
    # F7: a passing per-period RATIO is no longer enough. _report_path must return
    # False whenever corpus coverage is non-certifiable or below the gate, when the
    # inst module was NOT admitted to the published manifest, or when a corpus
    # period is uncovered — the exact holes the earlier ratio-only gate left open.
    # Hermetic: no cache needed, the gate logic is exercised on synthetic objects.
    accept = _load_accept()
    from populus.ingest.inst13f import InstCoverage, PeriodCoverage

    covered = PeriodCoverage(period_of_report="2026-03-31", denominator=100,
                             numerator=100, coverage=1.0, covered_by_list=True)
    good = InstCoverage(denominator=100, numerator=100, cover_failed_count=0,
                        inflated_filing_count=0, coverage=1.0, certifiable=True,
                        meets_threshold=True)
    sink = lambda _line: None  # noqa: E731

    assert accept._report_path("ok", good, [covered], True, sink) is True
    # Non-certifiable (e.g. an inflated filing) at a 100% ratio must FAIL.
    inflated = InstCoverage(denominator=100, numerator=120, cover_failed_count=0,
                            inflated_filing_count=1, coverage=1.2, certifiable=False,
                            meets_threshold=False)
    assert accept._report_path("inflated", inflated, [covered], True, sink) is False
    # inst absent from the published manifest must FAIL despite perfect coverage.
    assert accept._report_path("no-inst", good, [covered], False, sink) is False
    # An uncovered corpus period must FAIL.
    uncovered = PeriodCoverage(period_of_report="2026-06-30", denominator=100,
                               numerator=50, coverage=0.5, covered_by_list=False)
    assert accept._report_path("uncov", good, [covered, uncovered], True, sink) is False


def test_check_inputs_passes_when_everything_is_present():
    accept = _load_accept()
    if not DATA_CACHE.exists():
        pytest.skip("data-cache/13flist not present (full files are gitignored)")
    # The tracked corpus is always present; the cache files are the gated ones.
    missing = accept.check_inputs(["2026q1"])
    assert missing == [], f"unexpected missing inputs: {missing}"


@pytest.mark.skipif(
    not (DATA_CACHE / "13flist2026q2.pdf").exists(),
    reason="full 13(f)-list cache absent (gitignored); run `make accept-m2-5` locally",
)
def test_acceptance_clears_the_gate_on_the_real_corpus():
    # Cache-gated convenience duplicate of the DEV evidence. It seeds EVERY corpus
    # quarter (not just 2026q1) so no corpus period is left uncovered — the earlier
    # single-quarter form (F7) silently ignored the 2025 periods. Both rollout
    # paths must clear the real publication gate (meets_threshold + certifiable +
    # inst admitted to the published manifest). The full-file R5 parse is skipped
    # here (covered by the excerpt cross-format test and by `make accept-m2-5`).
    accept = _load_accept()
    rc = accept.run_acceptance(
        quarters=accept.CORPUS_QUARTERS, out=lambda _line: None, run_r5=False
    )
    assert rc == 0


def test_accept_m2_5_report_path_names_the_excluded_conflicts(tmp_path):
    """M2-7 §I5 / external review round 2 F3, surface 6 of 6: the acceptance
    report states the tolerated rounding and NAMES the excluded conflicts beside
    its coverage number. Non-empty by construction — the round-1 tests asserted
    only that the keys existed on an empty disposition set, which is precisely
    the weakness the reviewer called out.

    Driven off a real `compute_coverage` over a crafted corpus, never a
    hand-built value object, so the surface is fed exactly what production feeds
    it. Mutation guard: deleting the `disposition_line` line from `_report_path`
    fails the last two assertions.
    """
    import sys as _sys

    _sys.path.insert(0, str(REPO_ROOT / "tests"))
    from test_cover_tolerance import _conflict_corpus  # crafted, hermetic

    from populus.ingest.inst13f import compute_coverage, compute_period_coverage

    accept = _load_accept()
    conn = _conflict_corpus(tmp_path, "accept-m2-5-surface.db")
    try:
        coverage = compute_coverage(conn)
        periods = compute_period_coverage(conn)
    finally:
        conn.close()
    assert coverage.cover_conflict_filing_ids == ("inst:BAD",)   # non-empty

    lines: list[str] = []
    accept._report_path("surface", coverage, periods, True, lines.append)
    output = "\n".join(lines)

    assert "corpus-wide value coverage:" in output               # the number…
    assert "cover_conflict EXCLUDED 1: inst:BAD" in output       # …and its cost
    assert "cover_rounding 1 (max delta 999)" in output
