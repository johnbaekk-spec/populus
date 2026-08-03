# Dev Notes — B1 / KI-4: institutional coverage never publishes a ratio above 1

> **PROVENANCE — READ FIRST.** These notes were **not written by the implementing
> agent.** The orchestrate run (`.orchestrate/run-20260731-163005`) FATALed at the
> DEV phase: the dev agent backgrounded its gate chain and ended its turn without
> assembling an artifact. Its entire result file is one sentence ("…I'll assemble
> the final dev-notes artifact when it completes"). No dev-notes-v1 exists,
> malformed or otherwise, and the run never reached QA synthesis or QA review.
>
> This document is a **reconstruction from the working diff** by the review-bridge
> operator, written to carry the code into external review with correct
> provenance. Every claim below is derived from the diff or from gate runs the
> operator executed and can point at. It has since been through **two rounds of
> external code review** (4 blockers + 2 nits, then a re-verification that
> confirmed five fixed and found one regression introduced by the remediation).
> All evidence the plan required now exists under
> `docs/build/RUN-B1-evidence/` — see "Plan Deviations".

## Detected Stack

- **Python 3.12+** under `src/populus/` — uv/Hatch, `uv sync --frozen`, committed
  `uv.lock`; stdlib `sqlite3` with SQL views in `src/populus/views.sql`; `click`
  CLI (tests drive it via `CliRunner().invoke(cli_main, [...])`).
- **pytest** under `tests/`, with cross-fixture reuse from `tests/test_inst_agg.py`.
- **Astro 7 / TypeScript 6** dashboard under `dashboard/` (npm, `node:test`,
  `node:sqlite`) — **untouched by this diff**.
- Canonical gate entrypoints: root `Makefile` — `test` (= `test-python` +
  `dashboard-gates`), `security` (= `scripts/dep_guard.py`), `accept-m2-5`,
  `accept-m2-6`.
- No stack cache existed in `CLAUDE.md`; detected fresh via manifest (S0.1) and
  Makefile targets (S0.2).

## Requirement and Task Completion

Requirements are the approved plan's R1–R12 (`PLAN.md`).

| Req | Substance | State in the diff |
|---|---|---|
| R1 | Reported coverage is a ratio only for a measurable population, else `None` | Implemented — `compute_coverage`, `src/populus/ingest/inst13f.py` |
| R2 | Measurability is not about the ratio's size (a cover-failed 0.8 is also `None`) | Implemented; pinned by a below-one test |
| R3 | Raw `numerator`/`denominator` always retained and printed beside the token | Implemented across the render sites |
| R4 | **Gate outcomes byte-identical** — `certifiable`/`meets_threshold` unmoved | Implemented as a *separate* return-value rule; gate flags computed from `raw` exactly as before |
| R5 | All render surfaces route through one renderer | Implemented — `render_coverage_ratio`, 8 sites |
| R6 | Per-period rule mirrors the corpus rule | Implemented — `compute_period_coverage` |
| R7 | Red-first evidence + mutation table in Dev Notes | **MET** — 24 tests red on pre-fix source; the plan's full approved inventory M1–M18 (M12a–M12h expanded to S1–S8) plus 9 review-added mutants = **36 run, 34 killed, 2 proved equivalent**. Artifacts: `docs/build/RUN-B1-evidence/` |
| R8 | `make test` exits 0 on a hash-stable tree | Met — **1713 passed, 0 skipped** on frozen tree `5729b705…` |
| R9 | `make security` exits 0 | Met — 0 errors |
| R10 | `make accept-m2-6` + `accept-m2-5` exit 0 | Met — both exit 0 |
| R11 | Docs updated (BACKLOG, KNOWN-ISSUES, STATUS) | Implemented — 3 doc files changed |
| R12 | Mapping-side guard for persisted out-of-range records | Implemented — publish-boundary render path |

**The core rule as implemented** (`src/populus/ingest/inst13f.py`):

```python
coverage = raw if (certifiable and 0 <= numerator <= denominator) else None
```

`raw = numerator / denominator if denominator > 0 else None` is unchanged, and
`certifiable`/`meets_threshold` are still derived from `raw` — so the gate reads
the same value it always did. `0 <= numerator <= denominator` is an **integer**
comparison, deliberately not `raw <= 1.0`: correctly-rounded division can return
exactly 1.0 for a quotient marginally above 1 at 10^12 scale, which would let a
masked over-run pass. The lower bound is not redundant: `_to_int` accepts a
signed holding value, so a negative numerator is reachable, and without the
bound the construction guard crashes a computation HEAD answered with a record
(external review F7). The per-period path applies the same disqualifiers.

## Changed Files

Reconciled against `git diff --stat HEAD` and `git status --short` **after the
final remediation** (14 tracked files, **+1088/−50**, plus one new untracked
directory). This repo has a recorded history of dev notes overstating the
changed-file list, so these numbers are read from git, not from intent.

**Source (5):**
- `src/populus/ingest/inst13f.py` (+214/−…) — the reported-ratio rule in both
  `compute_coverage` and `compute_period_coverage`; per-period cover-failed and
  inflated sets; `CoverDisposition.period_of_report`; `_reject_non_proportion`
  and the two `__post_init__` guards; `render_coverage_ratio` +
  `_format_coverage_ratio`; `render_record_coverage` and
  `_NOT_MEASURABLE_REASONS`.
- `src/populus/cli.py` (+29/−…) — build/publish render sites; the publish
  boundary now calls `render_record_coverage`.
- `src/populus/inst_bulk.py` (+7/−…) — bulk summary render site.
- `scripts/accept_m2_5.py` (+18/−…) — explicit `UNMEASURABLE` marker.
- `scripts/accept_m2_6.py` (+6/−…) — render site.

**Tests (6), +779 total, 32 new test functions:** `test_cover_tolerance.py`
(+464), `test_publish.py` (+144), `test_accept_m2_6.py` (+57),
`test_accept_m2_5.py` (+56), `test_inst_bulk.py` (+41),
`test_inst_ingest.py` (+13).

**Docs (3):** `BACKLOG.md` (+23), `STATUS.md` (+12),
`docs/build/M2-KNOWN-ISSUES.md` (+39).

**New, UNTRACKED — must be `git add`ed before commit:**
`docs/build/RUN-B1-evidence/` — `red-first-run.txt`, `mutation_table.py`
(re-runnable), `mutation-outcomes.txt`. These are the R7 evidence; committing the
change without them re-opens external review F3.

**Not touched, deliberately:** `src/populus/publish/build.py` (pure pass-through;
its `reason` derivation reads `cover_failed_count`/`certifiable`, not the ratio),
`src/populus/mcp_server/` (renders no coverage ratio), and the `dashboard/` tree
(renders no inst coverage ratio — `inst_agg` carries aggregates, not the gate
figure). Confirmed by `git status`: none of the three trees appears in the
changed set.

## Reuse / Duplication Check

- `render_coverage_ratio` is a **de-duplication**, not a new primitive: it
  replaces what the plan's earlier revision had as eight inline format strings.
  Its `percent`/`digits` parameters are load-bearing, not decoration — the repo
  genuinely has two output contracts (2-decimal percent at the CLI/report
  surfaces, 4-decimal fraction at the acceptance-script surfaces).
- The per-period cover-failed set **reuses the existing cover-failed predicate
  verbatim**, re-grouped by `period_of_report`, so the corpus-level and
  period-level notions cannot drift — the predicate text is shared, not copied.
- `_PER_FILING_COVER_SQL` is extended with a static column rather than forked.
- No new dependency; `scripts/dep_guard.py` (G1) stays clean.

## Simplicity Audit

- The rule is one expression on one line, appended to an unchanged computation —
  the gate path is untouched rather than re-plumbed, which is what keeps R4
  cheap to verify.
- The renderer is a net reduction in surface-specific formatting logic.
- Counter-consideration, recorded honestly: the change adds a **second notion of
  "bad"** (unmeasurable) alongside the existing `certifiable`/`meets_threshold`
  pair. Three coexisting predicates over one population is the kind of accretion
  that memory `specify-before-rewriting` warns about. It is defensible here
  because the new notion is strictly about *reporting* and provably does not feed
  the gate — but a reviewer should check that the three cannot disagree in a way
  a reader would misread.

## Tech Debt Introduced

1. **Gate semantics for the unflagged NULL-total shape.** A filing with a NULL
   `table_value_total_usd` that is *not* flagged `cover_failed` and still carries
   resolved holdings contributes 0 to the denominator
   (`src/populus/ingest/inst13f.py`, the `CASE WHEN … NULL THEN 0` term) while
   staying in the default view (`src/populus/views.sql:109`) and having its
   holdings counted fully in the numerator. It can therefore **clear the ≥0.95
   gate on an unmeasurable population**. Before this change it published a >1
   number; after it, it publishes reporting `unmeasurable`. **The gate outcome is
   unchanged in both directions — deliberately**, because plan R4 forbids
   changing publishability. Removal condition: an owner decision on whether
   `numerator > denominator` should also de-certify (a one-line change to
   `certifiable` plus a re-run of the gate-outcome tests). No known live trigger
   (a `13F-NT` notice reports no holdings), so this is an edge/hand-built shape.
2. **Pre-fix `.staging/` gate records on disk** still contain out-of-range values.
   Handled rather than migrated: R12 renders them as unmeasurable with raw sums.
   No migration is performed because `.staging/` is operational state cleared
   after a publish.

## Memory Touch-Points

Selected via `memory-select.sh` (6 hits); how each shaped the work:

- `verify-against-a-frozen-tree` — **applied and load-bearing.** The gate chain
  was run with the source tree hashed before and after; both reads are
  `5729b7056824194e6af8258175d9a0c89463c415`, so the 1713-test result provably
  describes exactly the code under review and not a mid-edit tree.
- `mutation-tests-pin-properties` — **cited but NOT satisfied.** The plan's T6
  mutation table was not executed by the implementing agent. It has since been
  executed in full — 36 mutants, 34 killed, 2 proved equivalent. This memory exists
  because 4/20 mutants survived on M1-B — i.e. green tests are not evidence that
  the tests pin the property. See Plan Deviations.
- `review-scope-decides-the-verdict` — applied to the review handoff: scope is
  the code diff and gate evidence; harness/bundle provenance is explicitly out of
  scope, and any remediation round must carry per-finding VERIFIED/NOT-FIXED.
- `orchestrate-devnotes-fluke` — the trap recurred on CLI 2.1.220, in a new form:
  not a malformed artifact but an agent that backgrounded its gates and returned
  early. Worth re-recording.
- `specify-before-rewriting` — consulted, not triggered: this is the first fix
  round on this mechanism.
- `populus-project` — background only.

## Failure-Mode Sweep

- **F0 verify-don't-assume** — applied. Changed-file list reconciled against
  `git diff --stat HEAD` rather than from the plan's intent; test names extracted
  from the diff; gate results taken from executed runs, not claimed.
  **Now verified** (it was not when these notes were first written): each new
  test was run against the pre-fix source and 24 fail —
  `docs/build/RUN-B1-evidence/red-first-run.txt`.
- **F1 gate-list completeness** — `make test`, `make security`, `make
  accept-m2-6`, `make accept-m2-5` — all four run, all exit 0.
- **F2 full-tree gate scope** — Makefile entrypoints cover the whole tree.
- **F2 SQL parameterization** — `_PER_FILING_COVER_SQL` keeps its closed-set
  `view` interpolation and `# nosec B608`; the added column is a static
  identifier and the per-period query takes no caller input.
- **F3 verify end-to-end** — `make accept-m2-6` exercises ingest→gate→publish;
  the `CliRunner` build/publish tests cover the render path, not units alone.
- **F4 honest handoff** — this section, and Plan Deviations, exist because the
  evidence is incomplete; nothing is asserted that was not run.
- **F5 no self-signing** — no verdict is claimed here. Gates green is reported as
  gates green, not as correctness.

## Tests Run

Executed by the operator against the frozen tree (hash above), full log at
`b1-gates.log`:

| Gate | Result |
|---|---|
| `make test` | **1713 passed, 0 skipped** in 419s (baseline on `main` @ `89f6a18`: 1645) |
| `make security` | **0 errors** |
| `make accept-m2-6` | **exit 0** (`rank: 6 filers ranked (rank_failed 0) \| survivor values match v_default oracle: yes`) |
| `make accept-m2-5` | **exit 0 — ACCEPTANCE PASSED** on the real Berkshire corpus (0.9996 corpus-wide, both rollout orders). It had reported seven missing `data-cache/13flist/` inputs; `data-cache/` is gitignored, so the worktree simply had none. |

**32 new test functions**, both-arms per surface (measurable renders exactly;
unmeasurable renders the honest token with raw sums):

`test_corpus_coverage_is_none_for_a_cover_failed_overrun`,
`test_corpus_coverage_is_none_when_the_numerator_exceeds_a_certifiable_denominator`,
`test_corpus_coverage_is_none_for_a_cover_failed_population_below_one`,
`test_period_coverage_is_none_for_overrun_and_cover_failed_periods_only`,
`test_period_coverage_is_none_for_an_inflated_period`,
`test_coverage_dataclasses_refuse_a_ratio_above_one`,
`test_render_coverage_ratio_domain_units_and_precision`,
`test_ingest_summary_renders_{unmeasurable_coverage_with_raw_sums,a_measurable_ratio_exactly}`,
`test_bulk_summary_renders_{unmeasurable_coverage_with_raw_sums,a_measurable_ratio_exactly}`,
`test_cli_build_{withheld_notice_renders_unmeasurable_coverage,period_lines_render_both_arms_exactly,withheld_notice_renders_a_measurable_ratio_exactly}`,
`test_publish_absence_notice_{renders_unmeasurable_with_raw_sums,renders_a_measurable_ratio_exactly,refuses_a_legacy_out_of_range_record}`,
`test_report_path_renders_{unmeasurable_coverage_with_raw_sums,a_measurable_ratio_exactly}`,
`test_acceptance_renders_{unmeasurable_coverage_and_fails_the_gate,a_measurable_ratio_exactly}`.

## Plan Deviations

None outstanding. Two plan requirements were unmet when these notes were first
written, both consequences of the DEV FATAL; **external code review made both
blockers (F3/F4) and both are now closed**:

1. **R7 / T1 — red-first evidence.** Now produced: the five changed source files
   were restored to `HEAD` with the new tests kept, and **24 tests fail**,
   including all 7 external-review regressions. Log:
   `docs/build/RUN-B1-evidence/red-first-run.txt`.
2. **R7 / T6 — the mutation table.** Now produced and **re-runnable**:
   `docs/build/RUN-B1-evidence/mutation_table.py`, outcomes in
   `mutation-outcomes.txt`. **36 mutants, 34 killed, 2 proved equivalent** — the
   plan's approved M1–M18 inventory (M12a–M12h expanded to the eight named render
   surfaces) plus R1–R9 for the review findings.
   An earlier, non-conforming runner used invented IDs and omitted approved rows
   (external review F3); it is replaced by the inventory above. Its first run
   killed only 15/21 — four survivors were genuine test gaps where
   every case carried more than one disqualifier, so deleting any single one left
   another to catch it. Each now has an isolating test. The two surviving
   mutant (R7) is proved EQUIVALENT: deleting the `math.isfinite` raise leaves
   the `0 <= value <= 1` range check to reject NaN and both infinities, so the
   mutant changes the exception message and nothing else. Demonstrated, not
   asserted; the proof is in `mutation-outcomes.txt`.
3. **R10 / `make accept-m2-5`** — was unrun; now runs and **passes** (the
   worktree simply had no `data-cache/`, which is gitignored).

**One regression was introduced by the remediation itself and is recorded here
rather than smoothed over:** the F5 nit fix (a full-domain construction guard)
turned a *reachable* input — a signed negative holding value, which `_to_int`
accepts — from a coverage record HEAD returned into a `ValueError` crash. That
is an R4 violation caused by a nit. External review F7 caught it with an
end-to-end reproduction. Fixed by bounding measurability from below
(`0 <= numerator <= denominator`) in both computations, so the value never
reaches the guard and the gate flags stay exactly as HEAD had them; pinned by
mutants M24/M25 and an end-to-end test.

## Model Provenance

- **Plan:** authored by `claude-fable-5` (orchestrate phase 01), reviewed by
  Codex `gpt-5.6-sol` xhigh over **3 rounds with 2 revisions → VERDICT: APPROVED**.
- **Implementation:** `claude-fable-5` effort xhigh, orchestrate phase 03,
  session `1ee36f76-31e0-445d-bc53-0ec31d9fb71e`, cost $19.57, 0 tool denials.
  **Its self-verification did not complete** — it returned before its own gate
  chain finished.
- **These notes + the gate runs:** the review-bridge operator (Claude Opus 5) in
  the owner's live session, post-FATAL.
- **QA synthesis and QA review: never ran.** No qa-report-v1 exists.
