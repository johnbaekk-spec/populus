# QA Report — B1 / KI-4: institutional coverage never publishes a ratio above 1

> **Provenance.** Synthesized source-read-only by the review-bridge operator
> after the orchestrate run FATALed at DEV. The orchestrated QA phase never ran;
> this is a post-hoc synthesis over the approved plan, the working diff, and gate
> evidence the operator executed against a frozen tree. It is **not** an
> independent second implementation pass, and it does not substitute for the
> external code review it is being submitted to.

## Detected Stack

Python 3.12+ (uv/Hatch, `uv sync --frozen`, stdlib `sqlite3`, `click`, pytest)
under `src/populus/`; Astro 7 / TypeScript 6 dashboard under `dashboard/`
(untouched). Gates: root `Makefile` — `test`, `security`, `accept-m2-5`,
`accept-m2-6`.

## Summary

The change makes reported institutional coverage a ratio only for a **measurable**
population and `None` otherwise, where measurable = `certifiable` AND
`numerator <= denominator`. The gate path is deliberately left intact:
`certifiable` and `meets_threshold` are computed from the raw ratio *before* the
reported field is derived, so publishability is unchanged by construction rather
than by test alone. A shared `render_coverage_ratio` replaces eight inline format
strings and also validates values loaded from disk, closing the pre-fix
`.staging/` record hole that no in-process guard could reach.

Gates are green on a provably frozen tree. **When this report was first written,
the plan's evidence requirements (R7) were unmet** — no red-first record, no
mutation table — so "green" carried less weight than it normally would here.
**Both now exist** (`docs/build/RUN-B1-evidence/`): 24 tests red on pre-fix
source, and the approved mutation inventory executed at 36 mutants — 34 killed,
2 proved equivalent. See the post-review update under Verdict.

## Requirement Coverage

R1–R6 and R8–R12 are implemented and observable in the diff (see Dev Notes for
the per-requirement map). **R7 was NOT met when this was written; it is met
now** — the evidence is under `docs/build/RUN-B1-evidence/`. Specifically:

- The reported-ratio rule appears once per function, in both `compute_coverage`
  and `compute_period_coverage`, using the same three disqualifiers.
- R4 is structurally protected: `raw` is introduced as a new local, `certifiable`
  now reads `raw is not None` where it read `coverage is not None`, and
  `meets_threshold` reads `raw >= COVERAGE_THRESHOLD` where it read
  `coverage >= COVERAGE_THRESHOLD`. Since `raw` holds exactly the pre-fix value
  of `coverage`, both flags are value-identical for every input. Short-circuit
  order is preserved (`certifiable and raw >= …`), so a `None` raw is never
  compared.
- R5's "eight surfaces" claim depends on the assertion that `mcp_server/` and
  `dashboard/` render no coverage ratio. The diff does not modify either tree,
  which is consistent with the claim but does not prove it.

## Gate Evidence

Executed by the operator; source tree hashed before and after, both
`5729b7056824194e6af8258175d9a0c89463c415` (frozen — the results describe exactly
the code under review). Plus **red-first**: 24 tests fail on pre-fix source; and
the **mutation table**: 36 mutants (the plan's approved M1–M18 with M12a–M12h
expanded to all eight surfaces and M14 split into its type and finite halves,
plus R1–R9), 34 killed, 2 proved equivalent (M14b and R7), 0 unexplained survivors.

| Gate | Result |
|---|---|
| `make test` | **1713 passed, 0 skipped** (baseline `main` @ `89f6a18`: 1645) |
| `make security` | 0 errors |
| `make accept-m2-6` | exit 0 — `rank: 6 filers ranked (rank_failed 0)`, survivor values match the `v_default` oracle |
| `make accept-m2-5` | **exit 0 — ACCEPTANCE PASSED** on the real Berkshire corpus (0.9996, both rollout orders) |

## Issues Found

**F1 [MAJOR — NOW CLOSED] — R7's evidence requirements were unmet.**
*Closed after two external review rounds: red-first evidence and the mutation
table now exist under `docs/build/RUN-B1-evidence/`. The original text is kept
below because the concern was correct — and the mutation run vindicated it: the
first honest execution killed only 15 of 21 mutants.*
- Requirement: plan R7 (red-first record + the T6 18-mutant table).
- Claim: no evidence exists that the 21 new tests fail on unmodified code, and no
  mutant was executed. The plan names five expected-RED assertions with their
  pre-fix values (e.g. "RED — currently 1.5"); none was recorded.
- Why it matters here specifically: this repo has shipped eleven non-load-bearing
  tests before (M2-4), two of which passed their own mutation checks because the
  test was circular. M15 exists precisely to pin R4 gate-invariance and was never
  run. Recommend running M7 (over-tightened predicate) and M15 (gate invariance)
  at minimum before merge.

**F2 [NIT — CLOSED, AND ITS FIX CAUSED A BLOCKER] — the dataclass guard admitted NaN.**
*Tightening this guard to the full domain introduced external review F7: a
reachable signed-negative holding, which `HEAD` answered with a record, began
raising `ValueError`. Fixed by bounding measurability from below. The lesson is
recorded rather than smoothed over — a NIT fix produced the run's most serious
regression.*
- `__post_init__` rejects `coverage > 1`, but `float("nan") > 1` is `False`, so a
  NaN survives construction on both `InstCoverage` and `PeriodCoverage`.
- Impact is bounded: `render_coverage_ratio` checks `math.isfinite` and renders
  `unmeasurable`, so no surface prints a NaN. This is a defence-in-depth gap in
  the structural guard, not a reachable output defect. No path is known to
  produce a NaN (`numerator`/`denominator` are integers, and `denominator > 0`
  is required for a non-None raw).

**F3 [NIT — CLOSED] — negative ratios were unguarded at construction.**
*Closed: `_reject_non_proportion` now enforces the full domain, pinned by mutant
R8 and `test_coverage_dataclasses_reject_nan_and_negative_ratios`. Note the fix
had to be paired with bounding measurability from below — tightening the guard
alone caused external review F7.*
- The dataclass guard bounds only the upper end. `numerator` is a `COALESCE(SUM(…))`
  over non-negative values, so no live path reaches it; `render_coverage_ratio`
  bounds both ends (`0 <= value <= 1`). Symmetry would be cheap.

**Checked and found NOT defective** (recorded so the reviewer need not re-derive):
- `CoverDisposition` gained a required `period_of_report` field with no default.
  The only constructor is the one comprehension in `cover_dispositions`, which
  was updated with the SQL. `cover_dispositions_from_mapping` — the reader of
  persisted gate records — calls `format_cover_dispositions` with `.get()`
  defaults and **never constructs a `CoverDisposition`**, so legacy records on
  disk cannot break on the new field.
- The corpus inflated set (line ~1502) and the per-period inflated set
  (line ~1599) both call `cover_dispositions(conn, view="v_default_inst_filings")`
  — the same view, so the two figures cannot disagree about which periods are
  inflated.
- `_COVER_FAILED_PREDICATE` is genuinely shared between the corpus count and the
  per-period set (one string constant, two f-string interpolations), so the
  drift the plan worried about is structurally prevented.

## New vs Pre-existing

- **New:** all findings above (F1 is a process gap in this run; F2/F3 are new
  guards introduced by this diff).
- **Pre-existing, unchanged by this diff:** `mark_cover_dispositions` iterates
  `cover_dispositions(conn)` on the default view while the corpus inflated set
  uses `v_default_inst_filings` explicitly. That asymmetry predates the change
  and is out of scope here.
- **Pre-existing, deliberately preserved:** the unflagged NULL-total shape can
  still clear the ≥0.95 gate (plan R4 forbids changing publishability). Recorded
  as declared debt, not fixed.

## Test Coverage Gaps

- ~~No red-first proof~~ — **closed**: 24 tests fail on pre-fix source.
- ~~No mutation coverage~~ — **closed**: 36 mutants, 34 killed, 2 proved
  equivalent, covering the plan's approved inventory (M12a–M12h expanded to all
  eight render surfaces) plus nine review-added mutants.
- ~~`make accept-m2-5` unrun~~ — **closed**: it runs and passes end-to-end on
  the real Berkshire corpus, and mutants M12f/M12g pin both of its surfaces.
- ~~No test asserts NaN behaviour at the dataclass boundary~~ — **closed**: `test_coverage_dataclasses_reject_nan_and_negative_ratios` covers NaN, both infinities, negatives and bools on both dataclasses; mutants R7/R9 pin the guards (R7 proved equivalent).

## Security

`make security` (`scripts/dep_guard.py`, G1) exits 0 — no paid/vendor deps added.
`_PER_FILING_COVER_SQL` retains its closed-set `view` interpolation and
`# nosec B608`; the added `period_of_report` column is a static identifier and
the new per-period cover-failed query takes no caller input. No new I/O, network
call, or credential surface. Published-artifact schemas are unchanged.

## Tech Debt Introduced

1. Gate semantics for the unflagged NULL-total shape — publishes while reporting
   `unmeasurable`; fixing it is an owner decision on `certifiable`, out of scope
   per R4.
2. Pre-fix `.staging/` records with out-of-range values — handled by the R12
   render guard rather than migrated (`.staging/` is cleared after a publish).

## Memory Touch-Points

- `verify-against-a-frozen-tree` — applied; the before/after hashes match, so the
  gate results are attributable to this exact code.
- `mutation-tests-pin-properties` — **cited and violated**; F1 is exactly the
  failure this memory records.
- `review-scope-decides-the-verdict` — this report scopes to code + gates and
  puts harness provenance out of scope, per the recorded lesson.

## Failure-Mode Sweep

- **F0 verify-don't-assume** — applied: every "not defective" item above was
  checked by reading the code, not inferred from the plan's assertions.
- **F1 gate-list completeness** — **all four gates run and exit 0** (`make test`,
  `make security`, `make accept-m2-6`, `make accept-m2-5`).
- **F2 full-tree gate scope** — Makefile entrypoints cover the whole tree.
- **F3 verify end-to-end** — `make accept-m2-6` covers ingest→gate→publish.
- **F4 honest handoff** — the R7 gap is stated as a finding, not a footnote.
- **F5 no self-signing** — the verdict below is explicitly not an approval.

## Verdict

No correctness defect was found in the implementation on this read, and R4 looks
structurally sound. But this report is a post-hoc synthesis by the same session
that ran the gates, and the repo's recorded history is that green gates plus a
single reading have repeatedly missed blockers in exactly this subsystem.

**That caution was justified.** Three external rounds have since run and found
what this read did not: two reachable code defects (F1 — a persisted record
rendering an unmeasurable population as `0.00%`/`100.00%`; F2 — an oversized JSON
integer raising `OverflowError` on a successful publish), a false documentation
claim (F3 — "all 27 mutations killed" when none had run; the first honest run
killed 15 of 21; the corrected, plan-conforming table is 36 mutants), an unrun
acceptance gate (F4), and a regression introduced by
the remediation itself (F7 — tightening a NIT guard turned a reachable
signed-negative holding from a record into a crash, an R4 violation). All are
fixed, gate-verified on a frozen tree, and pinned by mutants.

This verdict stays INCOMPLETE deliberately: this document is not the thing that
should certify the change — the external verdict is.

INCOMPLETE
