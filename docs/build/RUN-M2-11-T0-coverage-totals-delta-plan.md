# RUN M2-11 T0 full-coverage totals delta (plan-v1)

**Artifact:** plan-v1 delta · **Transport:** interactive-disk · **Status:** READY
FOR INDEPENDENT PLAN RE-REVIEW; no implementation authorized until review approval ·
**Date:** 2026-08-10 · **Parent:** approved reported-serving materialization
delta at `docs/build/RUN-M2-11-T0-serving-materialization-delta-plan.md`,
SHA-256 `04b385929058efd485f73bfdef19fad02edba00d343d647267b37045b7959979` ·
**Base:** `feat/run-m2-11-inst-publish` at
`7391d947f72cf408a173f1e7938102608b2269d4` plus the preserved live M2-11
implementation and T0-v4 finding · **Scope class:** M/high-risk financial logic.

T0-v4 proved the serving-materialization delta: the 500-filer pilot completed
all phases, and the full exact-query plans no longer execute the persistent
reported-filing chain. The binding full run then exposed the next independent
bottleneck: `compute_coverage` exceeded its unchanged 180-second SQLite bound.
Statement-level read-only diagnostics identify the exact cause and a bounded
remedy. The coverage code repeatedly re-sums the same 16,922,879 holdings and
its reconciled-disposition read still expands the persistent restatement and
affiliation cascade.

This delta reuses the materializer's existing survivor/affiliation staging to
freeze `v_inst_reconciled_filings`, then computes one connection-local table of
resolved value by `filing_id`. Coverage, period coverage, and disposition reads
reuse those totals. It changes no filing population, tolerance, arithmetic,
threshold, NULL rule, gate meaning, artifact schema, aggregate/serving consumer,
accepted snapshot, timeout, R12 threshold, tail geometry, or publication flow.

The worktree is intentionally dirty with the cumulative M2-11 implementation.
All existing work remains unstaged and must be preserved. No commit, push, PR,
worktree operation, snapshot mutation, Phase D action, or deployment is
authorized.

## Goal and Success Criteria

Make full-corpus coverage and period coverage reuse one frozen per-filing
resolved-value relation, while retaining exact baseline behavior for every
standalone caller and preserving snapshot v1 byte-for-byte.

Success means:

1. The verified, canonical reconciled filing population is frozen exactly once
   from the already-staged restatement survivors and affiliation edge index.
2. Eligible institutional holdings are aggregated exactly once per materializer
   entry into `(filing_id, resolved_usd)` using integer SQLite `SUM` and
   `security_id IS NOT NULL`.
3. Materialized `compute_coverage`, `compute_period_coverage`, and both
   disposition scopes return complete object/tuple equality with the persistent
   path across all semantic fixtures and the immutable-source pilot.
4. Standalone calls outside the materializer continue using the existing SQL
   statements and behavior.
5. Exact-query EXPLAIN covers every high-cardinality coverage statement and
   proves the materialized path reads the totals index without a holdings
   correlated subquery or persistent survivor/affiliation cascade.
6. All targeted checks, the six canonical gates, and binding T0-v5 pass. T0-v5
   must emit complete D1, R12, tail, size, timing, and RSS evidence and exit 0
   before QA begins.
7. A separate Codex QA reviewer approves the fresh complete bundle within at
   most three QA rounds; the implementing agent never self-signs.

## Requirements

- **R1 — Verified source first.** Collision-only TEMP metadata may precede
  `verify_views`; no main data read or owned data object may. Drift still fails
  closed before materialization.
- **R2 — Canonical reconciled freeze.** Create TEMP
  `v_inst_reconciled_filings` by joining `main.inst_filings` to the existing
  restatement-survivor staging IDs and applying the existing indexed
  affiliation anti-join. Preserve all `inst_filings` columns and complete row
  equality with `main.v_inst_reconciled_filings` on semantic fixtures.
- **R3 — One resolved-value aggregation.** Create exactly one TEMP
  `_populus_inst_coverage_totals` table from `main.inst_holdings`, filtered by
  `security_id IS NOT NULL`, grouped by `filing_id`, with columns
  `filing_id` and integer `resolved_usd`. Create exactly one unique
  `_populus_inst_coverage_totals_by_filing` index. A missing totals row means
  resolved value zero through `COALESCE`, matching the current scalar subquery.
- **R4 — Exact corpus arithmetic.** In the owned TEMP scope only, denominator
  remains `SUM(CASE NULL total THEN 0 ELSE MAX(declared, resolved) END)` and
  numerator remains the sum of resolved values for exactly the frozen default
  filing set. The 0.95 threshold, `certifiable`, `meets_threshold`, cover-failed
  handling, and unresolved-conflict backstop are unchanged.
- **R5 — Exact period arithmetic.** Materialized period denominator and
  numerator use the same R4 terms grouped by `period_of_report`. List interval
  lookup, ordering, `covered_by_list`, and report-only status are unchanged.
- **R6 — Exact disposition behavior.** Both reconciled and default disposition
  reads reuse the totals table but still call the one Python classifier, retain
  integer tolerance boundaries, order by `filing_id`, name excluded conflicts,
  and prove the stale-view F8 backstop remains fail-closed.
- **R7 — Standalone compatibility.** Outside the exact owned TEMP namespace,
  `cover_dispositions`, `compute_coverage`, and `compute_period_coverage` use
  their existing persistent SQL. No direct caller silently creates TEMP state.
- **R8 — Exact owned lifecycle.** The materializer owns twelve TEMP names: the
  three existing affiliation staging objects; `v_inst_reconciled_filings`;
  `_populus_inst_coverage_totals` and its index; and the six existing
  reported/default consumer objects. The three affiliation objects disappear
  before yield; exactly nine objects remain in the body. All twelve collide
  fail-closed and every partial setup/drop path removes only objects created by
  this entry.
- **R9 — Frozen transaction scope.** Reconciled rows, totals, reported/default
  tables, and dependent views are created inside the existing single R16 read
  transaction. Withholding, COMMIT, DETACH, and last-projection-read ordering do
  not move. Main schema, bytes, mode, and sidecars never change.
- **R10 — Exact plan evidence.** The T0 EXPLAIN rung must use the actual SQL
  selected by production for corpus denominator/numerator, period
  denominator/numerator, reconciled/default dispositions, and the cover-failed
  check. Materialized plans must name the totals index where applicable and
  reject holdings correlations and persistent restatement/affiliation cascades.
  Affiliation-manager `json_each(other_managers)` is forbidden in those
  optimized plans; the exact cover-failed check must retain and explicitly show
  its intentional `json_each(flags)` virtual-table scan.
- **R11 — Semantic and downstream parity.** Complete `InstCoverage`, complete
  `PeriodCoverage` tuples, reported/default/reconciled rows, both artifact
  logical digests, and complete `ServingProjection` remain identical. Tests
  cover exact, under-cover, rounding, conflict, cover-failed, zero holdings,
  NULL/list/open-period, affiliation, restatement, and integer-boundary cases.
- **R12 — Gates and binding run.** After the final source edit, the targeted
  adjunct, `git diff --check`, all six canonical commands, and binding T0-v5
  run exactly as specified below. Targeted diagnostics never substitute for a
  canonical gate.
- **R13 — Honest stop.** The 180-second SQLite bounds, D1 exit 5 precedence,
  inclusive 1.5 GiB R12 threshold, widest-window serialization, and tail limits
  remain fixed. Any nonzero T0-v5 or new pathology stops for another
  owner-reviewed delta; no in-run remedy is authorized.
- **R14 — Independent QA.** Only an exit-zero T0-v5 permits fresh Dev Notes and
  the canonical complete QA bundle. A separate read-only QA reviewer may return
  PASS or grounded changes. The implementing agent batches fixes, rebuilds all
  freshness-sensitive evidence, and resubmits for at most three rounds.

## Scope

The delta is limited to the existing institutional materializer, its coverage
query selection, exact-query diagnostics, executable proof, the retained T0
findings, and workflow evidence. The cumulative QA candidate also contains the
preserved parent M2-11 changes already present against HEAD; their authority
comes from the parent plan and two approved predecessor deltas, not from this
delta.

The sole non-worktree write is a new append-only log:
`/Users/johnbaek/projects/Populus-ops/snapshots/evidence/m2-11/T0-v5.log`.
Snapshot v1 is read only with `mode=ro&immutable=1`.

## Non-goals

- no persistent view, schema, index, `ANALYZE`, migration, or snapshot v2
- no copy or materialization of the 16.9M wide holdings rows
- no change to cover predicate, affiliation, restatement, NEW_HOLDINGS,
  threshold, NULL honesty, F8, or period/reporting semantics
- no aggregate, serving, publish, ingest orchestration, artifact schema, route,
  field, dependency, config, CLI option, timeout, R12, or tail-limit change
- no generic cache, cross-connection cache, disk cache, Python per-row holdings
  loop, or parallel coverage implementation
- no Phase D, commit, staging, push, PR, deployment, or worktree operation

## Constraints

- Work only in
  `/Users/johnbaek/projects/Populus-m28/.claude/worktrees/m2-11` on branch
  `feat/run-m2-11-inst-publish`; preserve HEAD and all dirty state.
- Use `apply_patch` for repository edits. Never reset, checkout over, stage, or
  delete user-owned changes.
- Before implementation and every review round, re-check branch, HEAD, plan
  digest, parent digest, T0-v4 digest, snapshot identity, and content-sensitive
  source/test hashes. Any unexplained drift is a rebaseline and re-review.
- The fixed TEMP names are internal constants. No caller text is interpolated;
  closed-set view interpolation retains `# nosec B608`.
- Every source repair invalidates targeted results, canonical gates, T0,
  findings, Dev Notes, QA report, diff, manifests, and prior QA verdict.
- Plan review is read-only and may run at most three rounds. QA review is
  read-only and may run at most three rounds. The main agent alone applies fixes.

## Current State

Immutable provenance at plan authoring:

- branch: `feat/run-m2-11-inst-publish`
- HEAD: `7391d947f72cf408a173f1e7938102608b2269d4`
- parent approved plan SHA-256:
  `04b385929058efd485f73bfdef19fad02edba00d343d647267b37045b7959979`
- T0-v4 path:
  `/Users/johnbaek/projects/Populus-ops/snapshots/evidence/m2-11/T0-v4.log`
- T0-v4 SHA-256:
  `d84afcc9c156c50432d6435b8d4aefd1aef5e5d4294037ab3a5dab84df8a5d60`
- T0-v4 status: exit 4 at full `coverage`; D1 PASS
- accepted snapshot SHA-256:
  `977a4d249d92590a4de2961a3e9c7ff8cfa2e4846f0097ec7aa6c07f28124121`
- accepted snapshot state: 23,058,628,608 bytes, mode 0444, 51 ordered
  `main.sqlite_schema` rows, and no journal/WAL/SHM sidecars

Content-sensitive hashes before this delta:

| Path | SHA-256 |
|---|---|
| `scripts/measure_inst_derive.py` | `1159b91e65b12eda84f7a9165088dfa7a144aa4b72cccf271ea9ce65cfa93827` |
| `src/populus/amendments.py` | `ab33ecda9a7807b38ff2916785e8b92f8cfc59769f1ea4fc7ac70acc70bc0d57` |
| `src/populus/ingest/inst13f.py` | `e8795e2faec383e5372ff5166a9b745b83d59f602caefe027652051b4f9edc4e` |
| `tests/test_cover_tolerance.py` | `7cfe34c2d025e228ca57a809a3550126e914dbb9bdc622c6efcd9e85da9943fa` |
| `tests/test_inst_external_store.py` | `57834ab744030f1054797fd1952e7eae5d53eadd0636d35e7f9b6a34a447303f` |
| `tests/test_inst_snapshot_script.py` | `6dad7ce8eee68dacd99aac3c93da80e78da8b37883b15277f7f5c460ae67934d` |
| `docs/build/RUN-M2-11-T0-findings.md` | `2c8d149f83f217f22d35220cdd19c1be3a738b9b50d7b6b965633d1fdcd83630` |

Measured evidence, all against snapshot v1 read-only and outside repository
source files:

- T0-v4 pilot passed: materialization 8.577s, coverage 14.357s, period
  coverage 8.217s, aggregate 42.171s, serving 17.273s, and threshold true.
- Full statement split under the current materializer: denominator 35.819s;
  numerator 51.809s; cover-failed 0.009s; reconciled dispositions interrupted
  at 180.001s; default dispositions 51.067s.
- The reconciled plan contains nested restatement, affiliation, `json_each`, and
  holdings correlations. A diagnostic reconciled TEMP shadow created 43,432
  rows in 0.697s and removed the first three, but both complete coverage and
  complete period coverage still independently hit 180s. Reconciled-only is
  therefore explicitly rejected as insufficient.
- The proposed bulk totals probe created 45,577 `(filing_id, resolved_usd)`
  rows in 71.442s using `inst_holdings_by_filing`. Afterward, all six core
  coverage reads completed in 0.545s total: denominator 0.083s, numerator
  0.013s, reconciled dispositions 0.233s, default dispositions 0.076s,
  period denominator 0.091s, and period numerator 0.047s.
- The diagnostic full values were denominator 185,139,728,394,551 and numerator
  181,409,680,613,469, with 371 rounding filings, 225 named conflicts, zero
  unresolved default conflicts, and six periods. These are diagnostic facts,
  not cached acceptance values.
- On a fresh 500-filer pilot, proposed-vs-current parity was true for exact
  denominator, numerator, rounding count, ordered conflict IDs, unresolved
  count, and all six `(period, denominator, numerator)` tuples. The proposed
  totals build took 0.906s.

Timing probes are diagnostics, not new thresholds. Only binding T0-v5 can pass
R12/R13. No diagnostic changed a repository file or the accepted snapshot.

## Detected Stack

- **Languages:** Python 3.12 at repository root; TypeScript/Astro under
  `dashboard/`.
- **Storage/runtime:** SQLite 3.50.4 with JSON1, immutable external snapshots,
  and connection-local TEMP tables/views/indexes on macOS Apple Silicon.
- **Python runner:** uv with committed `uv.lock`; targeted adjuncts use the
  worktree `.venv` with `PYTHONDONTWRITEBYTECODE=1`.
- **Node runner:** npm with `dashboard/package-lock.json`; Node 24 and Astro 7.
- **Tests:** pytest, Node built-in test runner, Astro check/build, and post-build
  tests.
- **Canonical commands:** `make check`, `make accept-m1-b`,
  `make accept-m2-5`, `make accept-m2-6`, `make accept-m2-8`, and
  `make accept-m2-11`.
- **Stack cache:** no `CLAUDE.md` stack-cache block exists; detection was
  refreshed from `pyproject.toml`, `uv.lock`, `Makefile`, and dashboard
  manifests.

## Reuse Map

The reuse-first scan included Markdown and excluded only generated/vendor/
dependency/build trees. It enumerated all coverage SQL, disposition callers,
institutional view consumers, materializer lifecycle tests, exact-query tests,
and parent plans. No existing per-filing resolved-value cache or second
materializer exists.

| Existing target | Decision | Evidence |
|---|---|---|
| `materialized_inst_derivation_views` (`amendments.py:214`) | Extend internals; keep public name | It already owns verification, fixed TEMP namespace, lifecycle, and transaction integration. |
| `_INST_RESTATEMENT_SURVIVORS_SQL` (`amendments.py:53`) | Reuse unchanged | It is shared with ingest affiliation stamping and exposes the exact survivor IDs needed by R2. |
| affiliation edge table/index (`amendments.py:71`, `249-284`) | Reuse before cleanup | It already encodes affiliation over survivors and produced the 0.697s reconciled probe. |
| `v_inst_reconciled_filings` packaged definition (`views.sql:78`) | Preserve semantics; materialize from staged primitives | Direct persistent CTAS re-expands the measured cascade. |
| `_DENOMINATOR_TERM` and four coverage constants (`inst13f.py:1217-1248`) | Keep persistent path; add materialized equivalents sharing the same terms | Standalone behavior remains exact while the opted-in path reads totals. |
| `classify_cover` / `cover_dispositions` (`inst13f.py:1111`, `1154`) | Reuse one classifier and result construction | No second tolerance implementation is allowed. |
| `compute_coverage` / `compute_period_coverage` (`inst13f.py:1323`, `1426`) | Route SQL only; preserve result logic | Their dataclass semantics and call sites remain unchanged. |
| `explain_plans` (`measure_inst_derive.py:305`) | Extend to selected exact statements | T0-v4 omitted the slow disposition statement; the false-negative surface must be closed. |
| semantic materializer fixture (`test_cover_tolerance.py:780`) | Extend | It already covers restatement, affiliation, conflict, NULL, lifecycle, and integer edges. |
| external-store parity (`test_inst_external_store.py:460`) | Extend namespace/trace assertions | It already compares both digests, complete projection, read-only source, and transaction order. |
| T0 plan test (`test_inst_snapshot_script.py:650`) | Extend | It already binds production SQL to EXPLAIN and owns timeout/D1/R12 coverage. |
| parent six-gate set | Reuse exactly | No new substitute gate is invented. |

No new source module, public API, class, dependency, persistent object, or
parallel semantic implementation is introduced.

## Architecture

```text
verified main snapshot (unchanged; one explicit read transaction)
        |
        +--> staged restatement survivors + indexed affiliation edges
        |          |
        |          +--> temp.v_inst_reconciled_filings (all canonical rows)
        |          +--> existing temp default/reported filing families
        |
        +--> main.inst_holdings -- one GROUP BY filing_id, security_id non-NULL
                         |
                         v
             temp._populus_inst_coverage_totals
                     + unique filing_id index
                         |
               +---------+----------+
               |                    |
        compute_coverage    compute_period_coverage
               |
        both disposition scopes
```

The totals table stores only two values per filing, not holdings. For a filing
with no eligible holdings, absence from the table maps to zero with `COALESCE`,
exactly like the current scalar subquery. Default membership still comes from
the frozen canonical default table; reconciled conflict reporting still comes
from the frozen canonical pre-cover table. The Python classifier remains the
only tolerance implementation.

## Locked Decisions

- **LD1:** `_MATERIALIZED_INST_OBJECTS` expands from nine to exactly twelve
  fixed names; no dynamic namespace or caller-supplied identifier.
- **LD2:** add one fixed reconciled CTAS selecting `main.inst_filings.*` through
  staged survivor IDs and the existing `INDEXED BY` affiliation anti-join. Do
  not select from `main.v_inst_reconciled_filings` and do not duplicate the
  restatement predicate.
- **LD3:** add one fixed totals CTAS:
  `SELECT filing_id, COALESCE(SUM(value_usd), 0) AS resolved_usd FROM
  main.inst_holdings WHERE security_id IS NOT NULL GROUP BY filing_id`, followed
  by one unique TEMP index on `filing_id`.
- **LD4:** create the reconciled table while affiliation staging exists; create
  totals before dropping the staging objects; then drop only the three staging
  objects and yield the nine consumer/coverage objects.
- **LD5:** production coverage selects the optimized statements only when the
  exact owned totals table is present in `sqlite_temp_schema`. Outside that
  namespace it selects the unchanged persistent statements. This is a private
  SQL-selection seam, not a new public mode or option.
- **LD6:** optimized denominator, numerator, period, and disposition statements
  join the fixed totals table by `filing_id`. They do not read
  `inst_holdings`, reclassify cover in SQL, or cache result objects.
- **LD7:** `cover_dispositions` retains its closed two-view allowlist and the
  same Python result/classification loop. Only the row-producing SQL changes
  inside the owned namespace.
- **LD8:** T0 EXPLAIN asks production for the currently selected SQL inside and
  outside the materializer, and adds both disposition scopes plus cover-failed.
- **LD9:** do not edit `views.sql`, `publish/build.py`, `inst_agg.py`,
  `inst_serving.py`, aggregate/serving tests unrelated to namespace parity, or
  any snapshot cutter.
- **LD10:** no timeout headroom, diagnostic timing, or cached full value becomes
  an acceptance gate. T0-v5 uses the unchanged bounds and widest serialization.
- **LD11:** QA starts only after T0-v5 exit 0. The complete cumulative M2-11
  candidate and approved plan chain travel in the QA bundle; parent dirty paths
  are not misclassified as this delta's edits.
- **LD12:** maximum three plan-review rounds and three QA-review rounds. A third
  QA changes-requested verdict or any T0 mandatory stop returns to the owner.

## Alternatives Considered

- **Reconciled shadow only:** measured and rejected; both coverage phases still
  hit 180 seconds because holdings were re-summed repeatedly.
- **Raise/split the 180-second bound:** rejected; it would hide the pathology and
  weaken the binding safety rule.
- **Materialize all holdings:** rejected; copying 16.9M wide rows adds avoidable
  I/O, RAM/disk pressure, and lifecycle debt.
- **Rewrite coverage into one large new Python algorithm:** rejected; it widens
  semantic risk and duplicates the existing dataclass/classifier path.
- **Persistent totals table/index or snapshot v2:** rejected; it mutates the
  accepted source and creates invalidation/versioning work outside this delta.
- **Reuse reported/default rows to infer reconciled conflicts:** rejected;
  conflicts are intentionally absent from both cover-passing families and must
  remain nameable.
- **Change the stored packaged views to expose totals:** rejected; snapshot v1
  stores and verifies their exact SQL.
- **Precompute only default totals:** rejected; the reconciled disposition report
  requires excluded conflicts, and one complete grouped table is simpler and
  measured.

## Planned Files

| Path | Planned change |
|---|---|
| `src/populus/amendments.py` | Add the reconciled and coverage-totals CTAS/index; expand exact ownership, order, docstring, and cleanup. |
| `src/populus/ingest/inst13f.py` | Add fixed materialized coverage/disposition SQL selection while preserving persistent statements and result logic. |
| `scripts/measure_inst_derive.py` | EXPLAIN every exact selected high-cardinality coverage statement; do not change gates or bounds. |
| `tests/test_cover_tolerance.py` | Add reconciled/totals parity, exact nine-object body, twelve collisions, every-stage cleanup, freeze, fallback, and removal-fails coverage. |
| `tests/test_inst_external_store.py` | Extend immutable-source namespace, one-totals-build trace, digest/projection parity, and transaction assertions. |
| `tests/test_inst_snapshot_script.py` | Require exact materialized totals plans and reject holdings/cascade regressions for both disposition and coverage paths. |
| `docs/build/RUN-M2-11-T0-findings.md` | Append T0-v5 gates, log identity, complete timings/D1/R12/tail evidence, and decision. |
| `docs/build/RUN-M2-11-T0-coverage-totals-delta-plan.md` | This plan and review resolution notes only. |
| `docs/build/RUN-M2-11-devnotes.md` | After successful T0 only, create canonical dev-notes-v1 for cumulative QA; no source behavior. |

No other production, test, documentation, workflow, snapshot, or artifact path
is authorized by this delta. `.orchestrate/run-*` may be produced by the
canonical QA-only runner and remains harness-owned/untracked.

## Implementation Tasks

### Phase 0 — approval and baseline

- **R1/R12/R13/R14:** Run independent `plan-review` against this exact artifact,
  live tree, parent plan, T0-v4 log, findings, code, tests, memory, and hashes.
  Main agent resolves grounded blockers and resubmits, maximum three rounds.
- **R1/R8/R9:** Immediately before implementation, re-check branch, HEAD,
  status, every pinned hash, snapshot mode/sidecars, and reuse scan. Stop and
  revise/re-review on unexplained drift.

### Phase 1 — materializer and coverage reuse

- **R2/R3/R8/R9:** Expand the fixed ownership registry and implement the locked
  reconciled CTAS, totals CTAS, unique totals index, creation order, staging
  removal, and dependent-first tracked cleanup.
- **R4/R5/R6/R7:** Add one private namespace check and materialized SQL
  statements sharing the existing denominator/classifier semantics. Route the
  three existing functions without changing public signatures or return logic.
- **R10:** Extend T0 exact-query enumeration to request the statements production
  actually selects in each namespace, including cover-failed and both
  dispositions.

### Phase 2 — executable proof

- **R2/R3/R4/R5/R6/R11:** Extend the semantic fixture with complete
  main/TEMP reconciled equality, exact totals equality, complete coverage/period
  equality, conflict ordering, zero/missing totals, NULL, F8, and int64 edges.
- **R7/R8/R9:** Prove persistent fallback outside the context; exact nine-object
  body visibility; twelve collisions; every create/drop failure; normal,
  withholding, body-exception cleanup; caller state; main bytes/schema; and a
  freeze test that fails if reconciled/totals are not frozen.
- **R10/R11:** Prove the materialized exact plans use the totals index and contain
  no holdings correlation, restatement cascade, affiliation `json_each`, or
  persistent view chain. Separately assert that the exact cover-failed plan
  retains its intentional flags `json_each`. Preserve both digests and complete
  projection equality.
- **R3/R9/R11:** Trace exactly one totals CTAS/index inside the existing one read
  transaction, after BEGIN and before the final projection/COMMIT/DETACH.

### Phase 3 — final gates and binding measurement

- **R12:** After the final source edit run the exact targeted adjunct,
  `git diff --check`, and all six canonical gates in Testing Strategy.
- **R12/R13:** Run binding T0-v5 exactly as specified, retain the full unbuffered
  log, and do not continue after any STOP.
- **R9/R12/R13:** Append the final source hashes, commands/exits, log path/hash/
  size, counts/plans/timings, peak RSS, complete D1 states, R12 decision, tail
  geometry, and honest outcome to findings.

### Phase 4 — independent QA loop

- **R14:** Only after T0-v5 exit 0, create and schema-validate
  `RUN-M2-11-devnotes.md`, including exact task traceability, all cumulative
  changed files with parent/delta provenance, gates, deviations, simplicity,
  debt, memory, failure sweep, and model provenance.
- **R14:** Run the canonical QA-only artifact runner against the approved plan
  and Dev Notes to produce changed-files, redacted baseline diff, gate results,
  QA report, preservation/external-state/candidate evidence, manifests, and an
  independent read-only Codex verdict. The runner artifacts are evidence, not
  repository source.
- **R12/R13/R14:** If QA requests changes, main agent batches all grounded
  findings, changes only authorized paths, reruns the targeted adjunct, all six
  gates, and T0-v5 under a new append-only evidence suffix if source/evidence
  behavior changed, rebuilds the entire bundle, and resubmits. Stop on QA PASS,
  a third-round failure, or a mandatory performance gate.

## Testing Strategy

After the final source edit, run this targeted adjunct:

```bash
PYTHONDONTWRITEBYTECODE=1 .venv/bin/python -m pytest -q \
  tests/test_cover_tolerance.py \
  tests/test_inst_ingest.py \
  tests/test_filer_reported_views.py \
  tests/test_inst_bulk.py \
  tests/test_inst_external_store.py \
  tests/test_inst_snapshot_script.py \
  tests/test_inst_serving.py \
  tests/test_publish.py
git diff --check
```

Then run every canonical gate, separately and in order:

```bash
make check
make accept-m1-b
make accept-m2-5
make accept-m2-6
make accept-m2-8
make accept-m2-11
```

Run binding T0-v5 exactly, with no build date and no `tail` pipe:

```bash
t0_evidence_dir=/Users/johnbaek/projects/Populus-ops/snapshots/evidence/m2-11
mkdir -p "$t0_evidence_dir"
set -o pipefail
PYTHONDONTWRITEBYTECODE=1 .venv/bin/python -u scripts/measure_inst_derive.py \
  --snapshot /Users/johnbaek/projects/Populus-ops/snapshots/inst-source-v1.db \
  --measured-files 8106 \
  --pilot-filers 500 \
  --full 2>&1 | tee "$t0_evidence_dir/T0-v5.log"
```

T0-v5 must use the same 180-second named SQLite phase bounds. The omitted
`--build-date` deliberately selects the widest valid `FilingWindow`. Never
overwrite v2-v4 or reuse a diagnostic as binding evidence.

For QA, use the repository-under-review plus the canonical QA-only workflow
with the approved plan and schema-valid Dev Notes. Set the explicit QA cap to
one per invocation and invoke at most three times; main applies fixes between
invocations. The six gates above remain the acceptance record even if the
runner additionally detects or repeats ecosystem checks.

## Verification Matrix

| Requirement | Executable proof |
|---|---|
| R1 | stale/missing packaged-view tests; trace proves no main data read/object before verification |
| R2 | complete columns/ordered-row parity for main vs TEMP reconciled across all survivor/affiliation cases |
| R3 | exact totals rows vs direct eligible-holdings GROUP BY; one CTAS/index trace; missing filing maps to zero |
| R4 | complete `InstCoverage` equality, exact formula-plan assertions, threshold/F8/NULL cases |
| R5 | complete ordered `PeriodCoverage` equality for six semantic categories and list/open-period states |
| R6 | ordered dispositions/classifications parity; non-empty conflict and stale-view backstop remain fail-closed |
| R7 | removal of owned totals namespace selects persistent SQL and retains standalone behavior |
| R8 | exact nine body objects; twelve collisions; every-stage failure and dependent-first cleanup |
| R9 | immutable source hash/schema/sidecars; transaction trace; withholding/body exception/commit/detach tests |
| R10 | exact selected SQL identity; applicable materialized plans name the totals index and reject holdings correlations plus affiliation-manager cascades/`json_each`; the cover-failed plan explicitly retains flags `json_each` |
| R11 | semantic fixture, both logical digests, and complete ServingProjection parity |
| R12 | targeted adjunct, diff check, six gates, and retained exit-zero T0-v5 |
| R13 | forced timeout/D1/R12/tail tests plus binding stop behavior and unchanged constants |
| R14 | schema-valid fresh bundle and separate `qa-review` PASS within three rounds |

## Rollout / Rollback

There is no persistent data rollout. TEMP state exists only for one connection
and one read transaction. Exceptions remove successfully-created owned objects
in reverse dependency order. Snapshot v1 is never repaired or modified.

Code rollback is the explicit reversal of this delta's authorized hunks and new
plan/Dev Notes/findings additions while preserving every pre-delta parent change.
Never use `git reset --hard` or `git checkout --` on the shared dirty worktree.
No production publish, Phase D transition, commit, or push is part of rollback.

If T0-v5 fails, retain the append-only log, append findings, leave QA unstarted,
and request a new owner-reviewed delta. If QA fails, retain its bundle and
resolution notes, batch fixes, and rebuild all evidence. A third QA failure
returns to the owner without self-signing.

## Simplicity Audit

Minimum coherent implementation:

- add two fixed CTAS statements and one fixed index to the existing materializer;
- add one private namespace predicate and materialized variants of the existing
  fixed coverage SQL in the owning `inst13f.py` module;
- extend one existing EXPLAIN enumerator;
- extend three existing test modules, findings, and canonical Dev Notes.

No new source file, public function, class, dataclass, dependency, schema,
configuration, consumer branch, cache service, or query builder is introduced.
The two-column totals table is the smallest relation that eliminates all four
repeated holdings sums while retaining the existing result/classifier code.

## Tech Debt Introduced

Two bounded couplings are declared:

1. `inst13f.py` now has persistent and materialized SQL forms selected by the
   owned TEMP totals namespace. Impact: formula changes must update both fixed
   forms. Mitigation: shared terms, exact-plan identity tests, complete parity,
   and a removal-fails fallback test. Removal condition: a future accepted
   snapshot may expose a reviewed indexed coverage-input relation.
2. The materializer owns twelve fixed names and leaves one private totals table
   plus index visible during the derive body. Impact: lifecycle and collision
   tests must evolve with the namespace. Mitigation: the single ownership tuple,
   exact nine-object assertion, twelve collisions, and every-stage cleanup.
   Removal condition: the same future persistent relation or an explicit
   relation-parameter refactor in a separately reviewed change.

Pre-existing debt remains: standalone full-corpus coverage outside
`materialized_inst_derivation_views` retains the slow persistent path, and
snapshot-v1 immutability keeps canonical SQL split between packaged views and
runtime materialization. This delta adds no TODO, stub, disabled test, ignored
error, timeout waiver, persistent cache, duplicate classifier, or hidden debt.

## Memory Touch-Points

The memory index was ranked for coverage, performance, SQLite, materialization,
plan, review, gate, timeout, and QA. The top ten files were loaded:

- `feedback_gate_list_completeness.md` — retains targeted adjunct plus the exact
  six standing commands.
- `feedback_plan_development_vs_execution.md` — after owner approval, the plan
  becomes an execution contract rather than a document-polish loop.
- `feedback_plan_rebaseline.md` — content hashes and live-tree checks make every
  review/source repair freshness-sensitive.
- `feedback_qa_fail_batch_remediation.md` — QA fixes are batched, fully regated,
  and never self-signed.
- `feedback_canonical_gate_vs_adjunct_helpers.md` — diagnostic timings are not
  acceptance evidence; binding T0 and canonical gates remain exact.
- `feedback_convergent_review.md` — review is bounded at three and grounded
  findings are rechecked against live evidence.
- `feedback_dependency_gate_landed_code.md` — this plan reads the actual prior
  materializer and T0-v4 log, not only predecessor prose.
- `feedback_diagnostic_gated_separation.md` — full/pilot probes inform design but
  never change exit logic or thresholds.
- `feedback_explicit_plan_contracts.md` — locks totals producer, two-column
  shape, consumer selection, zero-row semantics, and lifecycle.
- `feedback_feature_branch_plan_tracking.md` — the plan stays in the existing
  feature worktree; the handoff's no-commit rule is an explicit exception to the
  general tracking recommendation.

## Failure-Mode Sweep

- **F0 universal:** complete coverage/disposition/materializer consumer and
  sibling scans were run, including Markdown. Snapshot, repo, and diagnostics
  expose no credentials. Measured facts are separated from acceptance claims.
- **F1 plan-time:** exact names, relation shape, integer/NULL behavior, units,
  gates, file scope, hashes, transaction boundary, QA cap, and stop conditions
  are locked. R1-R14 map to tasks, tests, and DoD.
- **F2 dev-time:** the high-cardinality operation is one bulk SQL GROUP BY, never
  a Python row loop. Fixed identifiers remain closed. Removal-fails tests cover
  totals use, fallback, freeze, indexes, and every lifecycle boundary.
- **F3 QA-time:** complete objects, rows, period tuples, both digests, projection,
  binding 23 GB T0, D1, R12, and tail geometry prove function end-to-end.
- **F4 handoff:** every source fix invalidates and rebuilds all downstream
  evidence. Parent dirty paths and delta paths retain explicit provenance; T0
  history is appended, never rewritten.
- **F5 transport:** plan review is interactive-disk and read-only. QA requires a
  fresh canonical runner bundle, manifests/tokens/preservation evidence, and
  separate read-only verdict; missing/stale artifacts are blockers, not inferred.

## Definition of Done

- [ ] **R1** verification precedes all main data and stale sources create no owned data.
- [ ] **R2** frozen reconciled columns/rows equal the canonical packaged view on complete fixtures.
- [ ] **R3** one indexed totals aggregation has exact rows and zero-row semantics.
- [ ] **R4** complete corpus coverage and gate fields equal the persistent path.
- [ ] **R5** every complete ordered period tuple equals the persistent path.
- [ ] **R6** disposition counts/IDs/tolerance and F8 fail-closed behavior are exact.
- [ ] **R7** standalone callers retain the existing persistent SQL and behavior.
- [ ] **R8** twelve collisions and every lifecycle failure preserve caller/main state; nine objects are body-visible.
- [ ] **R9** one transaction/order is preserved and snapshot D1 remains identical.
- [ ] **R10** every applicable exact materialized plan uses totals and rejects the measured affiliation/repeated-sum cascade, while cover-failed retains its intentional flags `json_each`.
- [ ] **R11** reconciled/default/reported rows, both digests, and complete projection are identical.
- [ ] **R12** targeted adjunct, diff check, six gates, and T0-v5 exit 0 from final source.
- [ ] **R13** bounds/thresholds/stops remain unchanged and complete D1/R12/tail evidence is retained.
- [ ] **R14** fresh complete bundle receives independent QA PASS within three rounds.
- [ ] Independent plan-review returns APPROVED before any implementation edit.
- [ ] No unapproved file, persistent object, snapshot, contract, dependency,
  timeout, commit, stage, push, PR, worktree, Phase D, or deployment action occurred.

Independent review resolution: round 1 returned `CHANGES_REQUESTED` on one
R10 wording contradiction. The Verification Matrix had rejected `json_each`
categorically even though the exact cover-failed statement intentionally scans
`json_each(flags)`. R10, its implementation task, matrix row, and DoD now reject
only affiliation-manager `json_each(other_managers)` in the optimized coverage/
disposition plans and explicitly require the cover-failed flags scan. No design,
file scope, production logic, gate, timeout, or QA contract changed.
