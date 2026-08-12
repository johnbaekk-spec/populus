# RUN M2-11 T0 reported-serving materialization delta (plan-v1)

**Artifact:** plan-v1 delta · **Transport:** interactive-disk · **Status:** READY
FOR INDEPENDENT PLAN REVIEW; no implementation authorized until review approval ·
**Date:** 2026-08-09 · **Parent:** approved affiliation-index delta at
docs/build/RUN-M2-11-T0-affiliation-index-delta-plan.md, SHA-256
e248513997e4abd50a03f958b4c140cf94679a826e8f1e38bb14ef233330ee92 ·
**Base:** feat/run-m2-11-inst-publish at
7391d947f72cf408a173f1e7938102608b2269d4 plus the live unstaged implementation
and T0-v3 finding described below · **Scope class:** M.

T0-v3 proved that the approved affiliation-index materialization fixed the first
full-snapshot bottleneck: the complete materialization fell from a 180-second stop
to 3.701 seconds. The same run then exposed a separate serving bottleneck. The first
holdings-level query over v_filer_reported_holdings consumed the complete
180-second serving bound on the 500-filer pilot because its join repeatedly
re-evaluated the persistent v_filer_reported_filings restatement/cover chain.

This delta extends the existing connection-local materializer to freeze the already
verified per-filer reported filing set once, index it by filing_id, and shadow the
dependent reported-holdings view. It does not change filing semantics, cover
arithmetic, affiliation behavior, aggregate or serving code, persistent views, the
accepted snapshot, derived schemas, publishing contracts, the T0 timeout, R12, tail
geometry, or Phase D authorization.

The worktree is intentionally dirty with the in-flight M2-11 implementation. All
existing changes remain unstaged and must be preserved. No commit, push, PR,
worktree creation/removal, snapshot mutation, or Phase D action is authorized by
this plan.

## Immutable baseline and provenance

Implementation and every review round must re-check:

- branch: feat/run-m2-11-inst-publish
- HEAD: 7391d947f72cf408a173f1e7938102608b2269d4
- approved parent plan SHA-256:
  e248513997e4abd50a03f958b4c140cf94679a826e8f1e38bb14ef233330ee92
- stopped binding log:
  /Users/johnbaek/projects/Populus-ops/snapshots/evidence/m2-11/T0-v3.log
- T0-v3 log SHA-256:
  4639c143b8838b87bbd524e3435ee665cd253c1cdd573d5ffdecdc98934a2650
- accepted snapshot:
  /Users/johnbaek/projects/Populus-ops/snapshots/inst-source-v1.db, opened only
  with mode=ro&immutable=1
- accepted snapshot SHA-256:
  977a4d249d92590a4de2961a3e9c7ff8cfa2e4846f0097ec7aa6c07f28124121
- accepted snapshot state: 23,058,628,608 bytes, 0444, identical ordered
  51-row main.sqlite_schema before/after T0-v3, and no journal/WAL/SHM sidecars

Content-sensitive hashes before this delta:

| Path | SHA-256 |
|---|---|
| src/populus/amendments.py | 5257b60f607bdf0d1e3b946d330dadebfde1430114fdb61d81fe21bd84b394a7 |
| tests/test_cover_tolerance.py | 7668cc8c6f57f45e5d06305dd25f2a4996784263f45c655df4dbb03332713305 |
| tests/test_inst_external_store.py | 799ae03be0a98c31c9ff4413150c56e594be3f4c73b0570eb36ec8389496b5a3 |
| tests/test_inst_snapshot_script.py | d63e47bd78c2076e897479d09e7ff62a96c27ec3a39270284510a0a47f170445 |
| docs/build/RUN-M2-11-T0-findings.md | 7883f3aadb2c890182880ee6f32ecd58a6260901e277cb35d718e8b55d21e8f4 |

Any mismatch is a rebaseline event. Inspect the intervening diff and revise this
plan before implementation; never silently apply a stale review.

## Problem and measured evidence

The exact binding T0-v3 stop was:

~~~text
STOP: SQLite execution bound (180s) interrupted phase serving; later phases suppressed
~~~

T0-v3 retained D1 evidence and exited 4. Snapshot immutability passed. R12, peak
RSS, aggregate bytes, full-corpus serving, and tail geometry remained unmeasured.

A separate immutable-source diagnostic mirrored the 500-filer pilot and traced the
exact production serving function. It created only a temporary pilot and aggregate.
The first filing dictionary query completed in 0.788 seconds and the filer-name
query in 0.001 seconds. The active statement at the exact 180-second interruption
was:

~~~sql
SELECT h.cik, h.period_of_report, h.filing_id, h.security_id, h.cusip,
       h.issuer_name_raw, h.title_of_class, h.value_usd, h.ssh_prnamt,
       h.ssh_prnamt_type, h.put_call, h.flags
FROM v_filer_reported_holdings h
WHERE h.period_of_report IN ('2026-03-31','2026-06-30')
ORDER BY h.cik, h.period_of_report, h.holding_id
~~~

It was active for 179.211 seconds and was the first holdings query in
build_serving_projection. The pilot aggregate preceding it completed in 49.465
seconds and was 456,146,944 bytes.

A second temporary probe tested the minimum proposed namespace:

1. create TEMP table v_filer_reported_filings from the verified persistent view;
2. create covering TEMP index v_filer_reported_filings_by_filing on filing_id;
3. create TEMP view v_filer_reported_holdings from the packaged view definition.

Observed results:

| Probe | Result |
|---|---:|
| pilot filers | 500 |
| materialized reported filings | 2,494 |
| reported CTAS + index + view | 0.788 s |
| problem-query plan | SCAN h + SEARCH f USING COVERING INDEX v_filer_reported_filings_by_filing + TEMP ORDER BY |
| aggregate | 43.000 s; 456,146,944 bytes |
| complete serving projection | 18.041 s |
| filer rows | 742,412 |
| issuer-holder rows | 312,039 |
| activity rows | 415,058 |

The timings are diagnostics, not acceptance thresholds. The canonical proof is
binding T0-v4 under the unchanged 180-second named phase bounds. Neither probe
changed a repository file or the accepted snapshot; all temporary files were
removed automatically.

## Goal and success criteria

Freeze the canonical per-filer reported filing population once per institutional
derive so every aggregate and serving consumer reads an indexed relation instead of
re-evaluating the persistent survivor/cover view for each holding.

Success requires:

1. **B1:** packaged-view verification still occurs before the helper's first main
   data read.
2. **B2:** TEMP v_filer_reported_filings has complete ordered row/column equality
   with main.v_filer_reported_filings on verified sources.
3. **B3:** the reported filing table is evaluated exactly once per materializer
   entry and indexed by filing_id before any dependent view is created.
4. **B4:** TEMP v_default_inst_filings is built from the frozen reported table and
   preserves complete equality with main.v_default_inst_filings.
5. **B5:** TEMP v_filer_reported_holdings and v_default_holdings are created from
   their packaged definitions and bind to the corresponding TEMP filing tables.
6. **B6:** the exact failing serving query uses the covering reported-filing index
   and contains no persistent survivor/cover correlated subquery or json_each scan.
7. **B7:** coverage, period coverage, aggregate logical digest, serving logical
   digest, and complete ServingProjection remain identical to the persistent-view
   baseline.
8. **B8:** the body sees exactly six consumer objects; all three private affiliation
   staging objects are absent before yield.
9. **B9:** collisions and failure cleanup cover all nine owned TEMP names without
   deleting caller state or changing main schema/bytes/sidecars.
10. **B10:** transaction, withholding, commit, detach, and snapshot-read ordering
    remain unchanged.
11. **B11:** targeted tests and all six standing gates pass after the final source
    edit.
12. **B12:** binding T0-v4 completes pilot and full rungs, emits D1/R12/tail/size/RSS
    evidence, and exits 0 before QA begins.

## Requirements and locked decisions

- **B1 — Fail closed before data.** Retain collision-only sqlite_temp_schema access
  before verify_views. No staging or consumer object exists if verification fails.
- **B2 — Canonical reported population.** Add one fixed private SQL statement:
  CREATE TEMP TABLE v_filer_reported_filings AS SELECT * FROM
  main.v_filer_reported_filings. Do not restate the cover predicate or survivor CTE.
- **B3 — One indexed evaluation.** Create
  v_filer_reported_filings_by_filing on filing_id immediately after the CTAS.
  Every downstream unqualified reported-filings query resolves to this TEMP table.
- **B4 — Default derives from reported TEMP.** Change the existing final
  reported-minus-affiliation anti-join to read temp.v_filer_reported_filings.
  Preserve the covering affiliation index, period match, non-NULL check, and
  source_filing_id inequality exactly.
- **B5 — Packaged dependent views.** Reuse _packaged_views for both holdings DDL
  statements, changing only CREATE VIEW to CREATE TEMP VIEW. The TEMP schema makes
  each unqualified filing relation bind to its TEMP table. No hand-copied holdings
  SELECT is allowed in production.
- **B6 — Exact owned namespace.** The helper owns exactly nine TEMP names:
  _populus_inst_affiliation_sources,
  _populus_inst_affiliation_edges,
  _populus_inst_affiliation_edges_lookup,
  v_filer_reported_filings,
  v_filer_reported_filings_by_filing,
  v_filer_reported_holdings,
  v_default_inst_filings,
  v_default_inst_filings_by_filing, and
  v_default_holdings.
- **B7 — Lifecycle.** Creation order is collision check → verification → affiliation
  sources → edges → edge index → reported filing table → reported filing index →
  default filing table → default filing index → drop three private staging objects →
  reported holdings TEMP view → default holdings TEMP view → yield. Cleanup is
  dependent-first and removes only successfully created owned objects.
- **B8 — Consumer code unchanged.** Do not edit inst_agg.py, inst_serving.py,
  publish/build.py, views.sql, ingest/inst13f.py, or measure_inst_derive.py. Their
  existing unqualified reads inherit the complete TEMP namespace.
- **B9 — Semantics unchanged.** Restatement ordering, NEW_HOLDINGS composition,
  cover tolerance, cover-failed handling, affiliation suppression, self exclusion,
  NULL honesty, published periods, activity exits, and aggregate/serving schemas are
  unchanged.
- **B10 — Query-plan proof.** A test must run EXPLAIN QUERY PLAN on the exact failing
  SELECT inside the materialized scope and require the named covering reported index.
  It must reject any persistent restatement/cover subquery or json_each step.
- **B11 — Snapshot and orchestration unchanged.** No persistent schema/index,
  ANALYZE, snapshot v2, timeout increase, per-row Python materialization, consumer
  rewrite, or additional read transaction.
- **B12 — Honest stop.** A timeout, D1 change, R12 stop, tail failure, new full-corpus
  pathology, or nonzero T0-v4 is another owner-reviewed stop. Do not tune a bound or
  enter QA to manufacture approval.

## Scope and non-goals

### Planned repository edits

| Path | Planned change |
|---|---|
| src/populus/amendments.py | Expand the existing materializer from six to nine owned names; add the reported CTAS/index and packaged reported-holdings TEMP view; make default CTAS read the frozen reported table; preserve cleanup. |
| tests/test_cover_tolerance.py | Extend complete reported/default parity, six-object body visibility, nine-name collision, and every-stage cleanup/removal-fails coverage. |
| tests/test_inst_external_store.py | Extend immutable snapshot namespace assertions and aggregate/serving parity to the reported TEMP pair. |
| tests/test_inst_snapshot_script.py | Extend the materialized EXPLAIN test with the exact failing serving SELECT and named-index/no-cascade assertions. |
| docs/build/RUN-M2-11-T0-findings.md | Append T0-v4 command, log identity, gates, timings, D1, R12, tail, and decision after the run. |
| docs/build/RUN-M2-11-T0-serving-materialization-delta-plan.md | This reviewed plan and resolution notes only. |

### Explicit non-goals

- no edit to persistent views or accepted snapshot
- no persistent index, ANALYZE, migration, dependency, or cache
- no change to aggregate, serving, publish, coverage, ingest, or T0 algorithms
- no timeout/threshold/file-budget/R12 change
- no new public API, schema, artifact, field, route, CLI option, or configuration
- no direct optimization of standalone callers outside the opted-in materializer
- no Phase D, commit, staging, push, PR, or deployment

## Detected Stack

- **Languages:** Python 3.12 at repository root; TypeScript/Astro in dashboard/.
- **Storage/runtime:** SQLite 3.50.4, JSON1, immutable external snapshots, and
  connection-local TEMP tables/views/indexes on macOS Apple Silicon.
- **Python runner:** uv with committed uv.lock; approved adjunct uses the worktree
  .venv interpreter to suppress bytecode against the dirty tree.
- **Node runner:** npm with dashboard/package-lock.json; Node 24 and Astro 7.
- **Tests:** pytest, Node built-in test runner, Astro check/build, post-build tests.
- **Canonical commands:** make check, make accept-m1-b, make accept-m2-5,
  make accept-m2-6, make accept-m2-8, make accept-m2-11.
- **Stack cache:** CLAUDE.md contains no stack-cache block; detection was refreshed
  from pyproject.toml, uv.lock, Makefile, dashboard/package.json, and
  dashboard/package-lock.json.

## Reuse Map

The reuse-first scan included Markdown and excluded only generated/vendor/dependency/
build trees. It enumerated every reported/default consumer in amendments.py,
inst_agg.py, inst_serving.py, publish/build.py, measure_inst_derive.py, the dashboard
fixture producer, and the existing semantic/acceptance tests. No second materializer
or persistent reported relation exists.

| Existing target | Decision | Evidence/reason |
|---|---|---|
| materialized_inst_derivation_views (amendments.py:205) | Extend internals; keep public name | It already owns verification, collisions, TEMP lifecycle, and production integration. |
| _MATERIALIZED_INST_OBJECTS (amendments.py:38) | Expand to exact nine names | One collision/cleanup registry remains the source of truth. |
| main.v_filer_reported_filings (views.sql:147-173) | Materialize once without rewriting | It is the reviewed R ∩ C population. |
| packaged v_filer_reported_holdings (views.sql:179-182) | Reuse as TEMP DDL | Avoids a parallel holdings join definition. |
| existing staged affiliation tables/index | Reuse unchanged | They solved T0-v2 and remain needed for default suppression. |
| existing default TEMP table/index/view | Reuse unchanged | Coverage and cross-entity aggregate consumers already depend on them. |
| build_inst_agg (inst_agg.py:428-721) | Reuse unchanged | Its reported/default reads should inherit TEMP shadows. |
| build_serving_projection (inst_serving.py:368-545) | Reuse unchanged | The trace identified its first existing query; no consumer rewrite is needed. |
| _derive_inst_module (publish/build.py:1174-1334) | Reuse unchanged | One materializer already spans aggregate, coverage, serving, commit, and detach. |
| complete semantic fixture (test_cover_tolerance.py:777-892) | Extend | It already covers restatement ties, NEW_HOLDINGS, cover conflict, affiliation, NULL, lifecycle, and periods. |
| artifact parity test (test_inst_external_store.py:478-530) | Extend | It already compares both logical digests and complete ServingProjection. |
| T0 EXPLAIN owner (test_inst_snapshot_script.py:650-676) | Extend | Keeps exact-query plan protection in the existing module. |
| six Make targets | Reuse exactly | They are the standing repository gates; no substitute command certifies acceptance. |

No new source module, public function, class, dependency, persistent object, or
parallel semantic implementation is introduced.

## Architecture and data flow

~~~text
verified main.v_filer_reported_filings
                 |
                 v  evaluated once
temp.v_filer_reported_filings
      + filing_id covering index
         |                         |
         |                         +--> temp.v_filer_reported_holdings
         |                                  |
         |                                  +--> aggregate per-filer pass
         |                                  +--> serving projection reads
         |
         +--> indexed affiliation anti-join
                  |
                  v
         temp.v_default_inst_filings
              + filing_id index
                  |
                  +--> temp.v_default_holdings
                           |
                           +--> coverage and cross-entity aggregate reads
~~~

All nine objects are connection-local. The three private affiliation objects are
dropped before yield. The six consumer objects remain for the existing transaction
scope and are removed on exit. Main remains immutable.

## Simplicity Audit

Minimum coherent implementation:

- expand one existing fixed-name tuple;
- add one private fixed CTAS constant for the reported set;
- reuse the existing packaged-view loader twice;
- change one existing final CTAS source from main reported to TEMP reported;
- add one TEMP index;
- extend three existing test modules and one findings document.

There is no new function, class, module, configuration, abstraction, query builder,
schema, or consumer branch. Materializing holdings themselves was rejected because
it would copy millions of wide rows and add disk/RAM pressure. Rewriting each
aggregate/serving query was rejected because it duplicates semantics and widens the
consumer surface. A persistent index cannot index the survivor/cover view result and
would mutate the accepted source. Raising 180 seconds was rejected because it hides
the measured pathology.

## Tech Debt Introduced

One declared runtime coupling is introduced: the private materializer now shadows
both the reported and default view families, so its nine-name lifecycle must evolve
with either packaged family. The impact is bounded to the opted-in derive context;
collision, parity, visibility, and every-stage failure tests make the coupling
executable. Removal condition: a future accepted snapshot revision may provide a
reviewed performant canonical relation, or consumers may migrate to explicit
relation parameters in one separately reviewed change.

Pre-existing debt remains:

- direct full-corpus standalone calls to build_inst_agg or
  build_serving_projection outside materialized_inst_derivation_views can still
  evaluate the persistent reported chain repeatedly;
- the survivor/cover SQL is represented in persistent packaged views and the shared
  derivation logic because snapshot-v1 immutability prevents refactoring stored SQL.

This delta adds no TODO, stub, disabled test, fallback, duplicate cover predicate,
persistent cache, timeout waiver, or undeclared source repair.

## Memory Touch-Points

The memory index was ranked for serving, SQLite, materialization, performance, plan,
review, and gates. Ten files were loaded:

- feedback_gate_list_completeness.md — retains targeted tests plus all six standing
  commands.
- feedback_plan_development_vs_execution.md — the owner requested a new plan and
  review before implementation, so this artifact is reviewed first.
- feedback_explicit_plan_contracts.md — names the exact TEMP relations, producer,
  consumers, shape, and lifecycle.
- feedback_dependency_gate_landed_code.md — grounds the delta in live code and the
  retained T0-v3 log, not only parent-plan prose.
- feedback_full_tree_gate_scope.md — make check remains full scope.
- feedback_gate_first_before_read_not_dependency.md — preserves verification before
  main data, while allowing collision-only TEMP metadata access.
- feedback_gate_function_exit_codes.md — preserves exit 4/5 and later-phase
  suppression.
- feedback_honest_gate_miss_reporting.md — records T0-v3 as a real failure and keeps
  the 180-second bound.
- feedback_phase_gate_discipline.md — makes exit-zero T0-v4 the next phase gate.
- feedback_plan_anchor_verification.md — every cited function, query, and test owner
  was re-read from the live dirty tree.

## Failure-Mode Sweep

- **F0 full-set:** all reported/default consumers and both packaged view families
  were enumerated. The plan changes the single namespace owner, not each consumer.
  No secrets or credentials are read. Measured facts are separated from the
  inference that the same remedy will pass the full corpus.
- **F1 plan-time:** exact baseline hashes, nine owned names, six body-visible names,
  full gates, exact T0 command, units, NULL behavior, and non-goals are explicit.
  Every requirement B1 through B12 maps to tasks, verification, and DoD.
- **F2 dev-time:** high-cardinality work is one bulk CTAS plus indexes, never Python
  row loops. Fixed identifiers remain private constants. Tests fail if the reported
  table/view/index, TEMP binding, cleanup, or semantic parity is removed.
- **F3 QA-time:** complete rows, both logical digests, and complete projection prove
  behavior, not object liveness. Binding T0-v4 exercises the immutable 23 GB source
  end to end and preserves D1 on every exit.
- **F4 handoff:** any source repair after gates invalidates targeted results, six
  gates, T0-v4, QA report, diff, and review bundle. T0-v2/v3 history is appended,
  never rewritten.
- **F5 transport:** plan review uses this exact interactive-disk artifact and live
  worktree. QA requires the canonical runner-emitted bundle and validator; missing
  artifacts or stale tokens are blockers, never reconstructed evidence.

## Implementation tasks

### Phase 0 — independent plan approval

- **B-T0:** Run plan-review against this exact plan, live dirty tree, approved parent
  plan, T0-v3 log, findings, code, tests, and hashes. Resolve every blocker in this
  document and obtain APPROVED before source edits. Maximum three plan-review rounds.

### Phase 1 — complete TEMP namespace

- **B-T1:** Rebaseline branch, HEAD, status, five file hashes, parent-plan hash,
  T0-v3 log hash, and snapshot mode/sidecars. Stop on unexplained drift.
- **B-T2:** Expand _MATERIALIZED_INST_OBJECTS to the exact nine B6 names. Add the
  fixed reported CTAS and create its filing_id index.
- **B-T3:** Change final default CTAS to temp.v_filer_reported_filings. Retain every
  affiliation predicate and INDEXED BY clause.
- **B-T4:** After private staging cleanup, create both packaged holdings definitions
  as TEMP views. Preserve dependent-first tracked cleanup on every exit.

### Phase 2 — executable proof

- **B-T5:** Extend the complete semantic fixture to compare ordered columns and rows
  for both reported and default filing tables, plus reported/default holdings. Keep
  every restatement, cover, affiliation, lifecycle, NULL, and period edge.
- **B-T6:** Require exactly six body-visible consumer objects and zero private
  staging objects. Parameterize collisions over all nine names and failure injection
  over every create/drop step. Prove caller state and main bytes/schema survive.
- **B-T7:** Extend immutable external-store proof and aggregate/serving parity.
  Compare both logical digests and the complete ServingProjection.
- **B-T8:** Extend the T0 EXPLAIN test with the exact failing SELECT. Require
  v_filer_reported_filings_by_filing and reject restatement/cover correlated
  subqueries and json_each in the materialized plan.

### Phase 3 — gates and binding run

- **B-T9:** After the final source edit run:

~~~bash
PYTHONDONTWRITEBYTECODE=1 .venv/bin/python -m pytest -q \
  tests/test_cover_tolerance.py \
  tests/test_inst_ingest.py \
  tests/test_filer_reported_views.py \
  tests/test_inst_bulk.py \
  tests/test_inst_external_store.py \
  tests/test_inst_snapshot_script.py \
  tests/test_inst_serving.py
git diff --check
make check
make accept-m1-b
make accept-m2-5
make accept-m2-6
make accept-m2-8
make accept-m2-11
~~~

- **B-T10:** Run binding T0-v4 exactly, without build date:

~~~bash
t0_evidence_dir=/Users/johnbaek/projects/Populus-ops/snapshots/evidence/m2-11
mkdir -p "$t0_evidence_dir"
set -o pipefail
PYTHONDONTWRITEBYTECODE=1 .venv/bin/python -u scripts/measure_inst_derive.py \
  --snapshot /Users/johnbaek/projects/Populus-ops/snapshots/inst-source-v1.db \
  --measured-files 8106 \
  --pilot-filers 500 \
  --full 2>&1 | tee "$t0_evidence_dir/T0-v4.log"
~~~

  Never overwrite v2/v3, use tail, guess a build date, raise a timeout, or continue
  after a STOP.
- **B-T11:** Append the exact v4 path, SHA-256, byte/line count, exit, complete D1
  states, materialization/coverage/period/aggregate/serving timings, row counts,
  aggregate bytes, peak RSS, R12 decision, and tail geometry to findings.

### Phase 4 — QA loop

- **B-T12:** Only after T0-v4 exits 0, generate and validate the canonical QA bundle:
  approved plan, Dev Notes, changed-files artifact, redacted baseline diff, gate
  results, QA report, source-preservation/feature-scope/external-state/tree/candidate
  tokens, and docs-commit evidence.
- **B-T13:** Send the validated bundle to a separate qa-review agent. Main agent
  applies any source fix, reruns B-T9/B-T10/B-T11, regenerates the complete bundle,
  and resubmits. Maximum three QA review rounds. QA PASS ends the loop; a third-round
  FAIL or any mandatory T0 stop returns to the owner.

## Verification matrix

| Requirement | Executable proof |
|---|---|
| B1 | stale/missing packaged-view tests; no TEMP objects created |
| B2 | complete temp/main reported filing column and ordered-row equality |
| B3 | body query plan names reported covering index; SQL trace/count test permits one main reported CTAS |
| B4 | complete temp/main default filing equality and affiliation removal-fails cases |
| B5 | reported/default holdings row equality and post-entry freeze test |
| B6 | exact failing SELECT EXPLAIN names reported covering index and rejects cascade/json_each |
| B7 | coverage objects, period tuples, aggregate digest, serving digest, complete projection equality |
| B8 | exact six-object body list; private names absent |
| B9 | nine-name collisions; every-stage failure; caller state and immutable source preserved |
| B10 | existing transaction recorder, withholding cleanup, commit/detach ordering |
| B11 | targeted adjunct, diff check, and exact six canonical commands exit 0 |
| B12 | retained T0-v4 exits 0 with D1, R12, tail, size, RSS, timings, and row counts |

## Rollback and stop behavior

No persistent rollback is needed because implementation objects are TEMP and source
files remain unstaged. A code rollback is the explicit reversal of this delta's
amendments.py/test/findings changes while preserving every pre-delta dirty file.
Never use reset --hard or checkout over the shared dirty tree.

At runtime, exceptions remove only tracked owned TEMP objects in dependent-first
order. The immutable snapshot is never repaired. Any nonzero T0-v4, D1 change, R12
stop, tail failure, or third QA rejection stops and returns evidence to the owner.

## Definition of Done

- [ ] **B1** verification precedes every main data read and stale sources create no TEMP data.
- [ ] **B2** reported filing columns and ordered rows match main exactly.
- [ ] **B3** the reported set is evaluated once and indexed before dependent reads.
- [ ] **B4** default filing columns and ordered rows remain exact.
- [ ] **B5** both packaged holdings views bind to the corresponding TEMP filing tables.
- [ ] **B6** the exact failing SELECT uses the covering reported index with no cascade/json_each.
- [ ] **B7** coverage, period coverage, both digests, and complete projection are identical.
- [ ] **B8** exactly six consumer objects and zero private staging objects exist during yield.
- [ ] **B9** all nine collisions/failure paths clean safely and D1 remains unchanged.
- [ ] **B10** transaction, withholding, commit, and detach ordering remains exact.
- [ ] **B11** targeted adjunct, diff check, and all six standing gates exit 0.
- [ ] **B12** T0-v4 exits 0 and records complete D1/R12/tail/size/RSS/timing evidence.
- [ ] Independent plan-review verdict is APPROVED before implementation.
- [ ] Canonical QA bundle validates after T0-v4.
- [ ] Separate qa-review returns QA PASS within three rounds.
- [ ] No unapproved file, persistent source, snapshot, timeout, schema, contract,
  dependency, commit, staging, push, PR, or deployment change occurred.

## Independent review resolution

No review round has run against this revision yet.
