#!/usr/bin/env python3
"""B1 / KI-4 mutation table — the APPROVED plan inventory, executed.

Run from anywhere:  python3 docs/build/RUN-B1-evidence/mutation_table.py

IDs M1..M18 (with M12a-M12h expanded to eight separate surface mutations) are the
plan's own inventory, verbatim from PLAN.md's mutation table — same IDs, same
meanings. A first version of this runner invented its own numbering and silently
omitted approved rows; external review caught that (F3), so the approved IDs are
now authoritative and review-added mutants live in a separate `R*` namespace.

A mutant is KILLED if its named test selection FAILS with the mutation applied.
A SURVIVOR means the tests asserted an end state rather than the property.
"""
import subprocess, pathlib, sys

ROOT = pathlib.Path(__file__).resolve().parents[3]
INST = ROOT / "src/populus/ingest/inst13f.py"
BULK = ROOT / "src/populus/inst_bulk.py"
CLI = ROOT / "src/populus/cli.py"
A5 = ROOT / "scripts/accept_m2_5.py"
A6 = ROOT / "scripts/accept_m2_6.py"

RULE = "coverage = raw if (certifiable and 0 <= numerator <= denominator) else None"
PERIOD_LOWER = "            and 0 <= numerator <= denominator  # signed holdings are reachable (F7)\n"

# (id, file, old, new, pytest -k selection, property pinned)
MUTANTS = [
    # ---- the plan's approved inventory -------------------------------------
    ("M1", INST, RULE, "coverage = raw",
     "cover_failed_overrun or cover_failed_population_below_one", "corpus rule exists at all"),
    ("M2", INST, RULE, "coverage = min(raw, 1.0) if raw is not None else None",
     "cover_failed_overrun or conflict_left_inside", "no clamping — None, not min(raw,1)"),
    ("M3", INST, RULE, "coverage = 99.0 if (certifiable and 0 <= numerator <= denominator) else None",
     "cover_tolerance", "reported value is the real ratio (the KI-4 named miss: 99.0)"),
    ("M4", INST, "        and inflated == 0\n", "\n",
     "conflict_left_inside or inflated_period", "inflated feeds certifiable"),
    ("M5", INST, "        cover_failed == 0\n", "        True\n",
     "cover_failed_overrun or cover_failed_population_below_one", "cover_failed feeds certifiable"),
    ("M6", INST, RULE, "coverage = raw if certifiable else None",
     "numerator_exceeds", "the independent numerator<=denominator term"),
    ("M7", INST, RULE, "coverage = raw if (certifiable and 0 <= numerator < denominator) else None",
     "cover_tolerance", "<= not < (an exact-100% corpus stays measurable)"),
    ("M8", INST, "        coverage = numerator / denominator if measurable else None",
     "        coverage = numerator / denominator if denominator > 0 else None",
     "period_coverage_is_none_for_overrun or inflated_period or overrun_period_with_no_other",
     "per-period rule exists at all (unconditional ratio)"),
    ("M9a", INST, "            and period not in cover_failed_periods\n", "\n",
     "period_coverage_is_none_for_overrun", "per-period cover-failed set"),
    ("M9b", INST, "            and period not in inflated_periods\n", "\n",
     "period_coverage_is_none_for_an_inflated_period", "per-period inflated set"),
    ("M10", INST, "        denominator=denominator,\n        numerator=numerator,\n        cover_failed_count=cover_failed,",
     "        denominator=(denominator if coverage is not None else 0),\n        numerator=(numerator if coverage is not None else 0),\n        cover_failed_count=cover_failed,",
     "cover_failed_overrun or numerator_exceeds or cover_failed_population_below_one",
     "R3: raw sums RETAINED when reporting None"),
    ("M11", INST, "        _reject_non_proportion(self.coverage)\n\n    @property",
     "        pass\n\n    @property",
     "refuse_a_ratio_above_one or reject_nan_and_negative", "the InstCoverage __post_init__ guard"),
    # M12a-M12h — eight separate per-surface renders of a None coverage
    ("M12a", INST, "        pct = render_coverage_ratio(coverage.coverage)",
     '        pct = "0.00%" if coverage.coverage is None else render_coverage_ratio(coverage.coverage)',
     "ingest_summary_renders_unmeasurable", "S1 ingest summary"),
    ("M12b", BULK, "        pct = render_coverage_ratio(coverage.coverage)",
     '        pct = "0.00%" if coverage.coverage is None else render_coverage_ratio(coverage.coverage)',
     "bulk_summary_renders_unmeasurable", "S2 bulk summary"),
    ("M12c", CLI, '        cov = render_coverage_ratio(w["coverage"])',
     '        cov = "N/A" if w["coverage"] is None else render_coverage_ratio(w["coverage"])',
     "cli_build_withheld_notice_renders_unmeasurable", "S3 CLI build withheld notice"),
    ("M12d", CLI, '        ratio = render_coverage_ratio(period["coverage"])',
     '        ratio = "100.00%" if period["coverage"] is None else render_coverage_ratio(period["coverage"])',
     "cli_build_period_lines_render_both_arms", "S4 CLI build per-period lines"),
    ("M12e", CLI, "        cov = render_record_coverage(record)",
     '        cov = "0.00%" if record.get("coverage") is None else render_record_coverage(record)',
     "publish_absence_notice_renders_unmeasurable", "S5 CLI publish gate record"),
    ("M12f", A5, '        f" = {render_coverage_ratio(coverage.coverage, percent=False, digits=4)}"',
     '        f" = {render_coverage_ratio(coverage.coverage, percent=False, digits=4) if coverage.coverage is not None else chr(78)+chr(47)+chr(65)}"',
     "report_path_renders_unmeasurable", "S6 M2-5 acceptance corpus line"),
    ("M12g", A5, "        ratio = render_coverage_ratio(period.coverage, percent=False, digits=4)",
     '        ratio = "N/A" if period.coverage is None else render_coverage_ratio(period.coverage, percent=False, digits=4)',
     "report_path_renders_unmeasurable", "S7 M2-5 acceptance period line"),
    ("M12h", A6, "    pct = render_coverage_ratio(coverage.coverage, percent=False, digits=4)",
     '    pct = "N/A" if coverage.coverage is None else render_coverage_ratio(coverage.coverage, percent=False, digits=4)',
     "acceptance_renders_unmeasurable", "S8 M2-6 acceptance"),
    ("M13", INST, "    if not math.isfinite(value) or not 0 <= value <= 1:",
     "    if not math.isfinite(value):", "render_coverage_ratio_domain", "range check in the renderer"),
    ("M14", INST, '    if isinstance(value, bool) or not isinstance(value, (int, float)):\n        return "unmeasurable"\n',
     "", "render_coverage_ratio_domain", "finite/type check: bool/str rejection"),
    ("M14b", INST, "    if not math.isfinite(value) or not 0 <= value <= 1:",
     "    if not 0 <= value <= 1:", "render_coverage_ratio_domain",
     "finite/type check: NaN/inf rejection (the finite half of approved M14)"),
    ("M15", INST, "meets_threshold=bool(certifiable and raw >= COVERAGE_THRESHOLD),",
     "meets_threshold=bool(certifiable and coverage is not None and coverage >= COVERAGE_THRESHOLD),",
     "cover_tolerance or numerator_exceeds", "R4: the gate reads RAW, not the reported field"),
    ("M16", INST, 'return f"{value * 100:.{digits}f}%"', 'return f"{value:.{digits}f}"',
     "render_coverage_ratio_domain", "percent scaling honoured"),
    ("M17", INST, 'return f"{value:.{digits}f}"', 'return f"{value:.2f}"',
     "render_coverage_ratio_domain", "digits honoured"),
    ("M18", CLI, '            cov = f"{cov} (raw {numerator}/{denominator})"', "            pass",
     "publish_absence_notice", "S5 raw numerator/denominator append"),
    # ---- review-added mutants (separate namespace; NOT plan IDs) -----------
    ("R1", INST, '    if record.get("reason") in _NOT_MEASURABLE_REASONS:\n        return "unmeasurable"\n',
     "", "legacy_cover_failed or legacy_masked or reason_alone", "F1: record reason disqualifier"),
    ("R2", INST, '    if record.get("certifiable") is False:\n        return "unmeasurable"\n',
     "", "legacy_masked or certifiable_false_alone", "F1: record certifiable disqualifier"),
    ("R3", INST, '        and numerator > denominator\n    ):\n        return "unmeasurable"',
     '        and False\n    ):\n        return "unmeasurable"',
     "legacy_record_numerator_exceeding", "F1: mapping-side over-run disqualifier"),
    ("R4", INST, '    if isinstance(value, int):\n        return _format_coverage_ratio(value, digits, percent) if 0 <= value <= 1 else "unmeasurable"\n',
     "", "oversized_json_integer", "F2: integers range-checked without float coercion"),
    ("R5", INST, RULE, "coverage = raw if (certifiable and numerator <= denominator) else None",
     "signed_negative", "F7: corpus numerator bounded from BELOW"),
    ("R6", INST, PERIOD_LOWER, "            and numerator <= denominator\n",
     "signed_negative", "F7: per-period numerator bounded from BELOW"),
    ("R7", INST, '    if isinstance(value, float) and not math.isfinite(value):\n        raise ValueError(f"coverage must be finite: {value!r}")\n',
     "", "reject_nan_and_negative", "F5: NaN rejected at construction"),
    ("R8", INST, '    if not 0 <= value <= 1:\n        raise ValueError(f"coverage outside [0, 1] is not a proportion: {value!r}")',
     '    if value > 1:\n        raise ValueError(f"coverage outside [0, 1] is not a proportion: {value!r}")',
     "reject_nan_and_negative", "F5: negatives rejected at construction"),
    ("R9", INST, "        _reject_non_proportion(self.coverage)\n\n\ndef _has_list_intervals",
     "        pass\n\n\ndef _has_list_intervals",
     "reject_nan_and_negative", "the PeriodCoverage __post_init__ guard"),
]

TESTS = ["tests/test_cover_tolerance.py", "tests/test_publish.py",
         "tests/test_inst_ingest.py", "tests/test_inst_bulk.py",
         "tests/test_accept_m2_5.py", "tests/test_accept_m2_6.py"]


def run(sel):
    return subprocess.run(["uv", "run", "pytest", "-q", "-x", "--no-header", "-k", sel, *TESTS],
                          cwd=ROOT, capture_output=True, text=True).returncode


results = []
for mid, path, old, new, sel, prop in MUTANTS:
    original = path.read_text()
    if original.count(old) != 1:
        results.append((mid, "ANCHOR-MISS", prop))
        print(f"{mid}: ANCHOR-MISS (count={original.count(old)}) — {prop}", flush=True)
        continue
    path.write_text(original.replace(old, new, 1))
    try:
        rc = run(sel)
    finally:
        path.write_text(original)
    verdict = "KILLED" if rc != 0 else "SURVIVED"
    results.append((mid, verdict, prop))
    print(f"{mid}: {verdict} — {prop}", flush=True)

killed = sum(1 for r in results if r[1] == "KILLED")
print(f"\n=== {killed}/{len(results)} killed ===")
for mid, v, prop in results:
    if v != "KILLED":
        print(f"  !! {mid}: {v} — {prop}")
sys.exit(0 if killed == len(results) else 1)
