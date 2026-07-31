#!/usr/bin/env python3
"""RUN M2-5 acceptance — the mandatory synchronous DEV gate (R5/R9/R10).

Run via ``make accept-m2-5``. This is the EVIDENCE for R9 (not prose): it prints
the exact per-period numerator, denominator and ratio measured on the REAL
Berkshire corpus with the definitional 13(f) lists seeded, and exits nonzero if
any list-covered period falls below the 0.95 gate.

It ERRORS (nonzero) — never skips — when any required input is absent:
  * the FULL 2026Q2 text AND PDF and the 2025Q1-2026Q1 PDFs under
    ``data-cache/13flist/`` (cache-only, gitignored), and
  * the TRACKED real Berkshire corpus at ``tests/fixtures/inst/real/CIK…``.

It runs BOTH rollout orders:
  * FRESH: seed the lists, then ingest the corpus, then measure.
  * POPULATED (pre-M2-5): ingest FIRST into a clean database (no lists), then
    seed the lists, then RE-INGEST (the locked recovery step that re-stamps
    security_id), then measure — proving the rollout recovers a populated db.

Reused populus code only; no second parser/resolver/ingest path.
"""

from __future__ import annotations

import sys
import tempfile
import uuid
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT / "src"))

DATA_CACHE = REPO_ROOT / "data-cache" / "13flist"
REAL_CORPUS = REPO_ROOT / "tests" / "fixtures" / "inst" / "real"
REAL_CIK = "0001067983"
#: The lists covering the real Berkshire corpus periods (2025Q1-2026Q1).
CORPUS_QUARTERS = ["2025q1", "2025q2", "2025q3", "2025q4", "2026q1"]
COVERAGE_GATE = 0.95
#: The SEC-published nonblank row count of the full 2026Q2 text variant, pinned
#: independently of the parser so a parse that silently dropped/added rows is
#: caught even if BOTH parsers agree with each other (F13).
EXPECTED_2026Q2_ROWS = 25333


def required_inputs(quarters: list[str]) -> list[Path]:
    inputs = [
        DATA_CACHE / "13flist2026q2-txt.txt",  # the R5 text side (full)
        DATA_CACHE / "13flist2026q2.pdf",       # the R5 pdf side (full)
    ]
    inputs += [DATA_CACHE / f"13flist{quarter}.pdf" for quarter in quarters]
    inputs.append(REAL_CORPUS / f"CIK{REAL_CIK}")
    return inputs


def check_inputs(quarters: list[str]) -> list[str]:
    return [str(path) for path in required_inputs(quarters) if not path.exists()]


def run_r5_full_file(out) -> int:
    """The FULL-FILE R5 cross-format gate over the complete 2026Q2 files."""
    from populus.parse.list13f import (
        assert_cross_format_identity,
        parse_list13f_pdf,
        parse_list13f_text,
    )

    text = parse_list13f_text(
        (DATA_CACHE / "13flist2026q2-txt.txt").read_text(encoding="utf-8"),
        quarter="2026q2",
    )
    pdf = parse_list13f_pdf((DATA_CACHE / "13flist2026q2.pdf").read_bytes(), quarter="2026q2")
    assert_cross_format_identity(text, pdf)
    # F13: pin the row count against the SEC-published total, independent of the
    # parsers — two parsers that agreed with each other on a wrong count would
    # still pass assert_cross_format_identity, but not this.
    if len(text.raw_rows) != EXPECTED_2026Q2_ROWS:
        raise SystemExit(
            f"R5: expected {EXPECTED_2026Q2_ROWS} rows in 13flist2026q2, parsed"
            f" {len(text.raw_rows)} — the parse dropped or gained rows"
        )
    out(
        f"R5 FULL-FILE cross-format identity PASSED: {len(text.raw_rows)} rows"
        " (text == pdf, count/order/multiplicity/tuples)"
    )
    return len(text.raw_rows)


def _new_db():
    from populus.amendments import ensure_views
    from populus.db import connect, init_db
    from populus.identity.registry import ensure_registry
    from populus.load import ensure_inst_schema

    tmp = Path(tempfile.mkdtemp(prefix="accept-m2-5-"))
    path = tmp / "acceptance.db"
    init_db(str(path))
    conn = connect(str(path))
    ensure_registry(conn)
    ensure_inst_schema(conn)
    ensure_views(conn)
    # A minimal (empty) company_tickers snapshot: coverage needs security_id
    # stamped from the lists, not entity linkage.
    tickers = tmp / "company_tickers.json"
    tickers.write_text("{}", encoding="utf-8")
    return conn, tickers, path


def _build_and_publish(db_path: Path) -> dict:
    """Actually BUILD and PUBLISH from the measured database and return the
    published manifest (R10/F7). Proves the ≥95% gate that just passed admits the
    `inst` module to a real manifest — the acceptance no longer stops at coverage."""
    import json
    from datetime import datetime, timezone

    from populus.publish.build import LocalDirBackend, run_build, run_publish

    repo = Path(tempfile.mkdtemp(prefix="accept-m2-5-repo-"))
    moment = datetime(2026, 7, 30, tzinfo=timezone.utc)
    backend = LocalDirBackend(repo)
    run_build(db_path, repo, now=lambda: moment, backend=backend)
    run_publish(repo, now=lambda: moment, backend=backend)
    latest = json.loads((repo / "latest.json").read_text(encoding="utf-8"))
    manifest = json.loads(
        (repo / "builds" / latest["build_id"] / "manifest.json").read_text(encoding="utf-8")
    )
    return manifest


def _seed_lists(conn, tickers, quarters):
    from populus.identity.bootstrap import run_identity_bootstrap
    from populus.identity.registry import load_identity_registry
    from populus.ingest.list13f import _CacheSource

    run_identity_bootstrap(
        conn,
        tickers_path=tickers,
        ftd_paths=(),
        registry=load_identity_registry(),
        snapshot_date="2024-01-01",
        run_id=f"accept-seed-{uuid.uuid4()}",
        now=lambda: "2026-07-30T00:00:00Z",
        host="accept",
        list13f_source=_CacheSource(DATA_CACHE),
        list13f_quarters=quarters,
    )


def _ingest_corpus(conn):
    from populus.ingest.inst13f import run_inst13f_ingest

    run_inst13f_ingest(
        conn,
        run_id=f"accept-ingest-{uuid.uuid4()}",
        now=lambda: "2026-07-30T00:00:00Z",
        host="accept",
        ingested_at="2026-07-30T00:00:00Z",
        ciks=[REAL_CIK],
        cache_dir=REAL_CORPUS,
    )


def measure(quarters: list[str], *, populated: bool):
    """Return (InstCoverage, tuple[PeriodCoverage], inst_in_manifest) for one
    rollout order — measured, then BUILT and PUBLISHED (R10/F7)."""
    from populus.ingest.inst13f import compute_coverage, compute_period_coverage

    conn, tickers, db_path = _new_db()
    try:
        if populated:
            # Pre-M2-5 state: the corpus is already ingested (FTD-only coverage).
            _ingest_corpus(conn)
            _seed_lists(conn, tickers, quarters)
            _ingest_corpus(conn)  # the locked recovery re-ingest re-stamps security_id
        else:
            _seed_lists(conn, tickers, quarters)
            _ingest_corpus(conn)
        coverage = compute_coverage(conn)
        periods = compute_period_coverage(conn)
    finally:
        conn.close()
    manifest = _build_and_publish(db_path)
    inst_in_manifest = "inst" in manifest.get("modules", {})
    return coverage, periods, inst_in_manifest


def _report_path(label: str, coverage, periods, inst_in_manifest: bool, out) -> bool:
    """Print one path's figures and gate decision; return True iff it clears the
    REAL publication gate — corpus-wide meets_threshold AND certifiable AND `inst`
    admitted to the published manifest AND every corpus period list-covered and
    ≥0.95 (F7). Coverage alone is no longer enough."""
    out(f"\n=== {label} ===")
    out(
        f"corpus-wide value coverage: {coverage.numerator}/{coverage.denominator}"
        f" = {coverage.coverage:.4f}"
        if coverage.coverage is not None
        else f"corpus-wide value coverage: N/A ({coverage.numerator}/{coverage.denominator})"
    )
    out(
        f"  certifiable(measurable): {'yes' if coverage.certifiable else 'no'}"
        f" | inflated filings: {coverage.inflated_filing_count}"
        f" | meets_threshold(gate): {'yes' if coverage.meets_threshold else 'no'}"
        f" | inst in published manifest: {'yes' if inst_in_manifest else 'no'}"
    )
    ok = True
    if not coverage.certifiable:
        out("  <-- NON-CERTIFIABLE: cover-failed or inflated filings — not measurable")
        ok = False
    if not coverage.meets_threshold:
        out("  <-- corpus-wide coverage does NOT meet the 0.95 gate")
        ok = False
    if not inst_in_manifest:
        out("  <-- inst was NOT admitted to the published manifest")
        ok = False
    for period in periods:
        ratio = f"{period.coverage:.4f}" if period.coverage is not None else "N/A"
        flag = "LIST" if period.covered_by_list else "no-list"
        marker = ""
        if not period.covered_by_list:
            # F7: every corpus period must be list-covered; an uncovered one means
            # the seeded lists do not cover the corpus and is an acceptance failure.
            marker = "  <-- UNCOVERED (no list) — unexpected for the acceptance corpus"
            ok = False
        elif period.coverage is None or period.coverage < COVERAGE_GATE:
            marker = "  <-- BELOW 0.95 GATE"
            ok = False
        out(
            f"  {period.period_of_report} [{flag}]: {period.numerator}"
            f"/{period.denominator} = {ratio}{marker}"
        )
    return ok


def run_acceptance(quarters: list[str] | None = None, out=print, *, run_r5: bool = True) -> int:
    quarters = quarters or CORPUS_QUARTERS
    missing = check_inputs(quarters)
    if missing:
        out("ACCEPTANCE FAILED — required inputs are absent (this command never skips):")
        for path in missing:
            out(f"  MISSING: {path}")
        out(
            "Populate data-cache/13flist/ with the full SEC files and ensure the"
            " tracked real Berkshire corpus is present, then re-run."
        )
        return 2
    out("RUN M2-5 acceptance — real Berkshire corpus, lists " + ", ".join(quarters))
    # run_r5=False lets the cache-gated pytest convenience duplicate skip the full
    # 748-page parse (the excerpt cross-format test and this command cover R5); the
    # `make accept-m2-5` evidence always runs it.
    if run_r5:
        run_r5_full_file(out)

    fresh_cov, fresh_periods, fresh_inst = measure(quarters, populated=False)
    populated_cov, populated_periods, populated_inst = measure(quarters, populated=True)

    fresh_ok = _report_path(
        "FRESH (seed → ingest → measure → build → publish)",
        fresh_cov, fresh_periods, fresh_inst, out,
    )
    populated_ok = _report_path(
        "POPULATED (ingest → seed → re-ingest → measure → build → publish)",
        populated_cov, populated_periods, populated_inst, out,
    )

    out("")
    if fresh_ok and populated_ok:
        out(
            "ACCEPTANCE PASSED: corpus-wide meets_threshold, certifiable, every"
            " period list-covered and ≥0.95, and inst admitted to the published"
            " manifest — on BOTH rollout orders."
        )
        return 0
    out("ACCEPTANCE FAILED: the real publication gate did not pass on both paths.")
    return 1


def main() -> int:
    return run_acceptance()


if __name__ == "__main__":
    sys.exit(main())
