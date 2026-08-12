# RUN M2-11 T0 coverage-materialization delta

**Artifact:** plan-v1 delta · **Status: READY FOR INDEPENDENT PLAN RE-REVIEW; no
implementation authorized by this artifact until review approval** · **Date:**
2026-08-09 · **Parent:** `docs/build/RUN-M2-11-plan.md` revision 6 · **Base:**
`feat/run-m2-11-inst-publish` at
`7391d947f72cf408a173f1e7938102608b2269d4` · **Scope class:** M.

This delta exists because the approved T0 ladder found a derive-side query-plan
pathology before Phase D. It narrows the remedy to a connection-local materialized
filing set, semantic-parity proof, and a bounded rerun of the real T0 path. It does
not authorize a snapshot v2, a source index, a coverage-rule change, or Phase D.

The worktree was already dirty at planning time in `.github/workflows/publish.yml`,
`ARCHITECTURE.md`, `Makefile`, `docs/runbooks/self-hosted-runner.md`,
`tests/test_publish.py`, `tests/test_workflow_governance.py`, and the untracked
`scripts/accept_m2_11.py` plus T0 findings. Those changes belong to the in-flight
M2-11 work and must be preserved. The implementation files named below were clean
at plan time. Do not create or remove a worktree.

## Problem and measured evidence

`compute_period_coverage` groups the same coverage numerator used by
`compute_coverage`. On the persistent view, that `GROUP BY` changes SQLite's join
order from filings-outer to holdings-outer. The amendment-reconciliation cascade in
`v_default_inst_filings` then executes once per holding rather than once per filing:
549,650 evaluations instead of 239 on the 50-filer control. The ungrouped numerator
finished in 0.25 s; the grouped numerator did not finish within 240 s.

Materializing `v_default_inst_filings` with a `filing_id` index reduced the grouped
numerator to 0.48 s on the control, with exact `compute_coverage` parity. Source
indexes, an `ORDER BY` index through the view, `ANALYZE`, and a Python streaming
rewrite were separately measured and rejected in
`docs/build/RUN-M2-11-T0-findings.md`.

One design premise required correction during this delta's planning. A persistent
SQLite view does not rebind its internal references to a same-named TEMP table. A
TEMP `v_default_inst_filings` table alone therefore does **not** accelerate the
persistent `v_default_holdings`. The real derive namespace needs both the TEMP table
and a TEMP shadow of the dependent holdings view. On the recovered 500-filer pilot,
that pair materialized in 4.0 s; the grouped numerator plan used the materialized
filing index with zero amendment-cascade subqueries; full per-period coverage
finished in 15.5 s for six periods. The intentional per-filing holdings sum in the
denominator remains index-served and is not the eliminated cascade.

## Goal and success criteria

The institutional publish derivation evaluates the reviewed default-filing predicate
once per source connection, reuses that frozen result through coverage, per-period
coverage, aggregate construction, watermarks, and serving projection, and leaves the
accepted snapshot byte-identical. All coverage and F8 non-inflation outputs, both
derived artifact logical digests, and the serving projection remain exactly equal to
the persistent-view implementation on parity corpora. The rerun then reaches
`build_inst_agg`, records the R12 size decision, and either completes T0 or stops
cleanly on a named SQLite-execution, immutability, tail-geometry, or R12 gate.

Success requires all of the following:

1. No write reaches `main`; the v1 snapshot hash and persistent schema are unchanged.
2. The TEMP materialization is created once per derive and cleaned up on success,
   withholding, and exception paths.
3. The real grouped numerator resolves through the TEMP holdings shadow and contains
   no amendment-reconciliation cascade in its materialized EXPLAIN plan.
4. Full `InstCoverage` object equality and full `PeriodCoverage` tuple equality hold
   between persistent-view and materialized executions, including non-empty rounding,
   conflict, cover-failed, open-period, and list-coverage cases.
5. The F8 stale-view backstop still reports an included inflated filing and refuses
   certification; materialization never turns a conflict into a passing gate.
6. Aggregate and serving outputs are logically identical with and without the TEMP
   pair on the same multi-period corpus.
7. R16 remains one explicit read transaction spanning all source reads; TEMP work
   neither splits it nor moves the commit ahead of the serving projection.
8. T0 reports baseline and materialized plans for the exact production SQL, separately
   times materialization/coverage/period/aggregate/serving phases, and interrupts a
   SQLite phase after 180 s rather than stalling indefinitely.
9. The binding full T0 run uses the widest valid `FilingWindow` serialization
   deliberately, records `aggregate_bytes`, and emits the R12 branch: at or below
   1.5 GiB locks no compression; above it stops for another delta plan.
10. The full standing gate set passes before the full T0 rerun. Phase D remains
    blocked until the findings record contains the successful T0 and R12 evidence.

## Requirements

- **D1 — Main-schema immutability.** Materialization may write only SQLite's TEMP
  schema. No `DROP`, `CREATE`, `ANALYZE`, index, pragma mutation, or data write may
  target the accepted snapshot. The source file's pre/post SHA-256 and main-schema
  object inventory must match. The T0 runner captures both states itself: once before
  any derivation and again from an outer `finally` after every connection and temporary
  output has closed. Each state contains `sha256_file(snapshot)`, the ordered rows from
  `SELECT type, name, tbl_name, COALESCE(sql, '') FROM main.sqlite_schema ORDER BY
  type, name, tbl_name, sql`, and the existence of `-journal`, `-wal`, and `-shm`
  siblings. It emits both states. A mismatch or any sidecar exits 5 and takes precedence
  over the otherwise-preserved T0 exit status.
- **D2 — Verified source first.** External snapshots pass `verify_views` before TEMP
  population; the congress snapshot passes the existing `ensure_views` before the
  common derive. Materialization must never freeze a stale definition and then let
  `build_inst_agg` repair only the persistent view underneath it.
- **D3 — One filing materialization.** Create TEMP table
  `v_default_inst_filings` with `CREATE TEMP TABLE ... AS SELECT * FROM
  main.v_default_inst_filings`, then a TEMP index
  `v_default_inst_filings_by_filing` on `filing_id`. Do not copy holdings.
- **D4 — Dependent TEMP shadow.** Create TEMP view `v_default_holdings` from the
  packaged `views.sql` definition by changing only its `CREATE VIEW` prefix to
  `CREATE TEMP VIEW`. Its unqualified filing reference must resolve the TEMP table.
  Do not hand-copy or independently rewrite the holdings predicate.
- **D5 — Collision and lifecycle safety.** The context manager refuses pre-existing
  TEMP objects with any owned name rather than dropping caller state. It drops only
  objects it created, in dependent-first order, from `finally`. Partial setup failure
  also cleans only its own objects.
- **D6 — Common derive scope.** The context wraps `_derive_inst_module` once, before
  `build_inst_agg`, and remains active through coverage, period coverage, watermarks,
  aggregate reads, and `build_serving_projection`. Standalone builders keep their
  current behavior; no parallel aggregation implementation is introduced.
- **D7 — Gate and reporting semantics unchanged.** `COVERAGE_THRESHOLD` remains
  0.95; `meets_threshold`, `certifiable`, F8, the denominator term, conflict
  exclusion, NULL behavior, and per-period report-only status are unchanged.
- **D8 — Exact SQL reuse.** Extract the four existing corpus/per-period denominator
  and numerator statements into private constants in `inst13f.py`. The compute
  functions and T0 EXPLAIN rung consume those same constants, preventing another
  representative-query false pass. This is a source move, not a query rewrite.
- **D9 — Parity proof.** Tests compare the complete dataclasses/tuples, not a selected
  field subset, and compare both artifact logical digests plus serving projection
  content. Tests include a non-empty F8 conflict case and fail if the TEMP holdings
  shadow is removed.
- **D10 — Bounded T0 SQLite work.** Each materialization, coverage, period, aggregate,
  and serving SQLite phase installs a 180-second progress handler, clears it in
  `finally`, and reports a named STOP with nonzero exit on interruption. The limit is
  T0-only; it is not a production publish timeout.
- **D11 — R12 and serialization decision.** The full rung reports the aggregate file
  size and compares it to exactly `1.5 * 2^30` bytes. The binding invocation omits
  `--build-date` on purpose so `WIDEST_FILING_WINDOW` remains the conservative size
  input. The output must state that choice rather than silently defaulting it.
- **D12 — Evidence before Phase D.** Raw unbuffered T0 output is retained at the locked
  external evidence path in D-T11; measured counts, timings, peak RSS, bytes, plans,
  tail geometry, timeout status, both D1 snapshot states, and the R12 branch are
  summarized in the findings document before any Phase D action.

## Detected Stack

- **Languages:** Python 3.12 at repository root; TypeScript/Astro under `dashboard/`.
- **Storage/runtime:** SQLite with JSON1 and persistent views; macOS Apple Silicon for
  T0; GitHub Actions for publish orchestration.
- **Python runner:** repository canonical commands use `uv run` (`uv.lock`); this
  handover's direct probes use the worktree `.venv/bin/python`.
- **Node runner:** npm (`dashboard/package-lock.json`), Astro 7, Node 24+.
- **Tests:** pytest for Python; `node --test`, `astro check`, Astro build, and the
  post-build suite through `npm run gates`.
- **Canonical repository gates:** Makefile targets; `make check` owns frozen installs,
  full Python tests, dashboard gates, and the dependency guard.
- **Stack cache:** no `CLAUDE.md` stack-cache block exists in this worktree; stack was
  detected from the live manifests and gate definitions.

## Reuse Map

The reuse-first scan covered Markdown and code, excluded only generated/vendor/build
trees, and found no existing TEMP-view materialization helper. The complete production
consumers of the two default view names were enumerated in `inst13f.py`, `inst_agg.py`,
`inst_serving.py`, `publish/build.py`, `measure_inst_derive.py`, and
`ingest/list13f.py`. The `select_backfill_quarters` read in `list13f.py` is an
ingestion-time selection query outside `_derive_inst_module`; it remains on the
persistent view and is unaffected by the connection-local derive context.

| Existing symbol/path | Decision | Reason |
|---|---|---|
| `amendments._packaged_views` | Reuse | One source for the persistent and TEMP holdings-view SQL. |
| `amendments.verify_views` / `ensure_views` | Reuse unchanged | Establish D2 before any frozen TEMP population. |
| `compute_coverage` / `compute_period_coverage` | Reuse arithmetic unchanged; extract their exact SQL strings | Gate logic is already reviewed; T0 must EXPLAIN the same statements. |
| `_derive_inst_module` | Extend with one context | It already owns the complete coverage→aggregate→serving read span for both input shapes. |
| `build_inst_agg` | Reuse unchanged | Unqualified view reads inherit the TEMP shadows on the same connection. |
| `build_serving_projection` | Reuse unchanged | Its default-holdings reads inherit the TEMP shadow; reported-view reads stay as-is. |
| `select_backfill_quarters` | Reuse unchanged; explicitly out of derive scope | Its persistent-view read selects ingestion backfill quarters before publication derivation and cannot observe another connection's TEMP objects. |
| `publish.digests.sha256_file` | Reuse in T0 evidence | Existing streaming whole-file SHA-256 implementation; do not add another file-digest loop. |
| `logical_digest` and serving projection dataclass | Reuse as parity oracles | Compare both artifact meanings and the in-memory projection, not incidental SQLite page layout. |
| `tests/test_cover_tolerance.py` crafted corpora | Extend | Existing exact/rounding/conflict/F8 fixtures are the authoritative semantic cases. |
| `tests/test_inst_external_store.py` snapshot fixture | Extend | Already proves read-only mode, view verification, interleaving, and one transaction. |
| `tests/test_inst_snapshot_script.py` T0 tests | Extend | Already owns ladder output, refusals, tail gate, and fixture end-to-end behavior. |

## Architecture

```text
verified main snapshot (unchanged, mode=ro&immutable=1)
                 |
                 | one explicit read transaction
                 v
TEMP v_default_inst_filings table  <-- one CTAS from main view
                 |
                 +-- TEMP filing_id index
                 |
                 v
TEMP v_default_holdings view       <-- packaged DDL, TEMP prefix only
                 |
      +----------+-----------+----------------+------------------+
      |                      |                |                  |
 compute_coverage   period coverage   build_inst_agg   serving projection
      |                      |                |                  |
      +----------------------+----------------+------------------+
                                 one frozen filing population
```

SQLite resolves unqualified top-level names in TEMP before main. The TEMP table
therefore shadows direct `v_default_inst_filings` reads. The dependent persistent
view cannot see that shadow, so a TEMP `v_default_holdings` is required as the second
half of the namespace. Its join is still the packaged query; only schema placement
changes. Persistent view verification continues to query `sqlite_master` explicitly
and is therefore not fooled by the TEMP shadows.

The TEMP filing set is frozen inside the same R16 transaction as the source reads. It
does not include holdings, so the denominator's per-filing resolved sum and every
builder still read live transaction-consistent `main.inst_holdings`. The index changes
the cost of joining a holding to an already-decided filing; it does not change which
filings or holdings qualify.

## Locked Decisions

- **LD-D1:** one public context manager,
  `materialized_inst_derivation_views`, lives in `populus.amendments`; no new module.
- **LD-D2:** owned TEMP names are exactly `v_default_inst_filings`,
  `v_default_inst_filings_by_filing`, and `v_default_holdings`.
- **LD-D3:** the TEMP holdings view is generated from packaged DDL, not duplicated SQL.
- **LD-D4:** `v_filer_reported_filings` and `v_filer_reported_holdings` are not
  materialized without new T0 evidence. If either later breaches the SQLite execution
  bound, T0 stops for a separate delta rather than widening this change.
- **LD-D5:** direct public coverage calls keep their current semantics and do not
  secretly create TEMP state. The publish orchestrator and T0 runner opt into the
  one-per-derive context explicitly.
- **LD-D6:** 180 s is a T0 SQL-phase safety bound, not a production SLA or timeout.
- **LD-D7:** the binding size run deliberately uses the widest valid serialization;
  no `--build-date` is supplied.
- **LD-D8:** snapshot v1 remains the accepted source. No v2, `ANALYZE`, or source
  index is part of this delta.

## Alternatives considered and rejected

- **TEMP filing table alone:** rejected by the SQLite name-resolution control; the
  persistent holdings view remains bound to the persistent filing view.
- **Copy all 16.9M holdings into TEMP:** rejected; unnecessary space/time and a new
  large write. The small filing set plus indexed join removes the cascade.
- **Rewrite only the grouped numerator:** rejected; duplicates coverage semantics and
  does not reuse the predicate across aggregate, watermarks, and serving reads.
- **Force join order with a representative/base-table query:** rejected; the earlier
  index test passed while the real view plan stayed byte-identical.
- **Snapshot v2 with indexes or `ANALYZE`:** rejected by measured no-op evidence and
  R23 immutability; no source-side remedy helped.
- **Materialize the per-filer reported chain preemptively:** rejected; no measured
  pathology yet. T0, not speculation, decides any follow-on scope.
- **Put the helper in `publish/build.py`:** rejected; T0 would have to import a private
  publication orchestrator for a view-lifecycle primitive already owned by
  `amendments.py`.
- **Hand-copy the TEMP holdings SQL:** rejected; it creates a second predicate that can
  drift from `views.sql`.
- **Import `inst_snapshot._assert_no_sidecars`:** rejected; it is a private
  cutter-specific assertion, omits `-journal`, raises the cutter's exception type, and
  does not return the complete JSON evidence state D1 must compare. T0 reuses the public
  `publish.digests.sha256_file` and keeps the three trivial existence probes inside its
  one private `_snapshot_state` helper.

## Planned files

- `src/populus/amendments.py` — add the connection-local materialization context,
  packaged-DDL TEMP view conversion, owned-name collision refusal, and cleanup.
- `src/populus/ingest/inst13f.py` — extract the four existing coverage statements into
  private constants consumed unchanged by the two compute functions and T0 EXPLAIN.
- `src/populus/publish/build.py` — wrap the common institutional derive once, without
  moving gate logic or the R16 transaction boundary.
- `scripts/measure_inst_derive.py` — use the same context; report baseline and
  materialized exact-query plans; add separate timings, 180 s SQLite progress bounds,
  explicit widest-window output, the R12 branch, and the always-run D1 pre/post
  snapshot-state comparison using `publish.digests.sha256_file`.
- `tests/test_cover_tolerance.py` — complete coverage/per-period/F8 parity and a
  fail-if-shadow-removed namespace test.
- `tests/test_inst_external_store.py` — read-only main hash/schema proof, TEMP lifecycle,
  aggregate/serving parity, and one-transaction ordering.
- `tests/test_inst_snapshot_script.py` — exact-query EXPLAIN coverage, materialization
  timing fields, D1 state/mismatch/exit-precedence cases, timeout branch, widest-window
  statement, and both R12 outcomes.
- `docs/build/RUN-M2-11-T0-findings.md` — retain the namespace correction and append the
  completed T0/R12 evidence after the canonical rerun.
- `docs/build/RUN-M2-11-T0-coverage-delta-plan.md` — this delta and any review-driven
  revisions.

No new source or test file is planned. Any new public symbol beyond the one context
manager is a review finding.

The sole operational evidence output is
`/Users/johnbaek/projects/Populus-ops/snapshots/evidence/m2-11/T0-v2.log`. It is outside
this worktree under the already-untracked snapshot operations tree, is never staged or
published, and is retained through Phase D review. D-T12 records its SHA-256 in the
tracked findings document. No `scratchpad/` path is created in this worktree.

## Implementation tasks

### Phase 0 — independent plan checkpoint

- **D-T0:** Run `plan-review` against this delta and the live tree. Resolve all findings
  in the document and obtain APPROVED before touching any implementation file.

### Phase 1 — materialization and integration

- **D-T1:** Add `materialized_inst_derivation_views(conn)` in `amendments.py`. Refuse
  TEMP collisions, create table→index→dependent view, yield, then clean up
  view→table in `finally`. Reuse `_packaged_views`; caller text never enters SQL.
- **D-T2:** Extract the four existing coverage SQL statements to private constants and
  route both compute functions through them without textual arithmetic changes.
- **D-T3:** Enter the context once in `_derive_inst_module`. Confirm both callers have
  already established current persistent views. Preserve the existing aggregate-first
  order, withholding return, ATTACH/COMMIT/DETACH sequence, and output schema.

### Phase 2 — proof and T0 hardening

- **D-T4:** Add complete semantic parity tests. Compare full `InstCoverage` objects and
  `PeriodCoverage` tuples before/inside materialization across two periods with exact,
  under-cover, tolerated rounding, excluded conflict, cover-failed, and list/no-list
  cases. Re-run the stale-view F8 corpus inside the context and require
  `inflated_filing_count == 1`, `certifiable is False`, and `meets_threshold is False`.
- **D-T5:** Add the removal-fails namespace test: freeze the TEMP filing set, mutate a
  writable fixture's main filing population afterward, and prove both unqualified
  filing and holdings reads stay on the frozen set. Omitting the TEMP holdings view
  must make the test fail. Assert owned TEMP objects exist only inside the context and
  main schema/hash do not change.
- **D-T6:** Build baseline and materialized aggregate/serving results from the same
  multi-period fixture and compare both artifact logical digests plus complete serving
  projections. Extend the transaction recorder to require TEMP setup after `BEGIN`,
  the last projection read before `COMMIT`, and exactly one begin/commit pair.
- **D-T7:** Update the measurement ladder to EXPLAIN both baseline and materialized
  forms of the exact four shared statements. The materialized grouped numerator must
  have no amendment-cascade subqueries and must show a lookup against the TEMP filing
  index on the pilot. Record `materialization_s`, `coverage_s`, `period_coverage_s`,
  `aggregate_s`, `aggregate_bytes`, `serving_projection_s`, and peak RSS. Add one
  private `_snapshot_state` helper that reuses `publish.digests.sha256_file`, opens a
  fresh `mode=ro&immutable=1` connection for the ordered `main.sqlite_schema` rows,
  closes it before returning, and reports the three SQLite sidecar paths. Capture the
  pre-state before the view gate and the post-state in an outer `finally` after all T0
  connections and the temporary output directory are closed. Emit both complete JSON
  states plus `snapshot_immutability: PASS`; on state mismatch or any sidecar emit a
  named STOP and return 5, otherwise preserve the ladder's existing exit code. Tests
  cover identical states, a forced hash difference, a forced schema-row difference,
  a forced sidecar, the precedence of exit 5 over another STOP, and the successful
  preservation of another nonzero exit when the states match.
- **D-T8:** Add a T0-only SQLite-execution helper using `set_progress_handler`. Clear it
  in `finally`; map `SQLITE_INTERRUPT`/`OperationalError: interrupted` to a named STOP
  and exit 4. Add tests that force an over-time callback and prove later phases do not
  run. Output calls the bound a SQLite execution bound; total phase wall time remains
  diagnostic and is not represented as a general Python watchdog.
- **D-T9:** Emit the explicit serialization mode and R12 decision. Unit tests drive
  `aggregate_bytes` on each side of the inclusive 1.5 GiB boundary; the high branch
  exits nonzero and says another delta is required.

### Phase 3 — gates and measured rerun

- **D-T10:** Run targeted tests with the worktree interpreter, then the unchanged full
  standing gate set. Record exact commands and exit statuses; do not self-sign.
- **D-T11:** Run the canonical T0 command unbuffered, with no `--build-date`, no `tail`
  pipe, and the locked external evidence log:

  ```bash
  t0_evidence_dir=/Users/johnbaek/projects/Populus-ops/snapshots/evidence/m2-11
  mkdir -p "$t0_evidence_dir"
  set -o pipefail
  PYTHONDONTWRITEBYTECODE=1 .venv/bin/python -u scripts/measure_inst_derive.py \
    --snapshot /Users/johnbaek/projects/Populus-ops/snapshots/inst-source-v1.db \
    --measured-files 8106 \
    --pilot-filers 500 \
    --full 2>&1 | tee "$t0_evidence_dir/T0-v2.log"
  ```

  The omitted `--build-date` is intentional and binding: widest valid serialization.
  If SQLite execution in a named phase times out, D1 exits 5, R12 exceeds 1.5 GiB, tail
  geometry stops, or a new real-path pathology appears, update findings and stop for
  another delta. Do not improvise a remedy during the run.
- **D-T12:** Append the SHA-256 of the exact external log, both complete D1 snapshot
  states and their PASS comparison, and all required T0/R12 figures to the findings
  record. Retain the raw log at its locked path through Phase D review. Only then may
  the parent plan's Phase D resume.

## Testing strategy

Targeted development checks:

```text
PYTHONDONTWRITEBYTECODE=1 .venv/bin/python -m pytest -q \
  tests/test_cover_tolerance.py \
  tests/test_inst_external_store.py \
  tests/test_inst_snapshot_script.py
```

Exact full standing gates, unchanged from the approved parent plan:

```text
make check
make accept-m1-b
make accept-m2-5
make accept-m2-6
make accept-m2-8
make accept-m2-11
```

The targeted invocation is an adjunct diagnostic. Only the full standing list is the
repository acceptance gate. Tests must be removal-fails tests: selected-field equality,
TEMP-object existence alone, or an EXPLAIN against a base-table substitute is
insufficient.

## Verification matrix

| Requirement | Proof |
|---|---|
| D1 | T0 emits equal pre/post whole-file SHA and ordered main-schema rows, no sidecars, and PASS; forced hash/schema/sidecar mismatches exit 5 from the outer `finally`; existing read-only write mutant remains red. |
| D2 | Existing drift/missing-view refusals; ordering assertion before TEMP CTAS. |
| D3 | TEMP schema type/index assertions; materialization timing; filing-row equality. |
| D4 | Frozen-population removal-fails test; packaged-DDL comparison; materialized real-query EXPLAIN. |
| D5 | Collision, normal cleanup, withholding cleanup, partial-setup exception cleanup tests. |
| D6 | Both artifact logical digests, serving-projection parity, and common-derive call-count assertion equals one. |
| D7 | Full coverage dataclass/period tuple parity; existing threshold and NULL tests unchanged. |
| D8 | Compute functions and EXPLAIN import the same private SQL constants. |
| D9 | Exact object/digest/projection comparisons plus non-empty F8 case. |
| D10 | Forced SQLite interruption exits 4, names phase, clears handler, skips later phases, and does not claim a Python wall-clock watchdog. |
| D11 | Widest-mode output; inclusive boundary tests at 1.5 GiB; full T0 record. |
| D12 | External `snapshots/evidence/m2-11/T0-v2.log` digest + both D1 states + findings update; Phase D checklist remains blocked before it. |

## Rollout and rollback

This delta rolls out only to the derivation process. No snapshot or published schema
changes. On any parity, timeout, or R12 failure, stop before Phase D and revert the
delta's code changes; snapshot v1 remains untouched and usable by the pre-delta path.
TEMP objects disappear on context exit or connection close, so there is no persistent
data rollback. The parent plan's deployment and rollback procedure is unchanged.

## Simplicity Audit

| Item | Disposition | Forced by | Simpler alternative rejected |
|---|---|---|---|
| `materialized_inst_derivation_views` | Create one public context manager in existing module | Shared lifecycle for publish + T0; cleanup/collision safety | Inline CTAS twice would drift and leak TEMP state. |
| Four private coverage SQL constants | Extract existing strings verbatim | T0 must EXPLAIN production SQL | Duplicating “representative” SQL already produced a false diagnosis. |
| TEMP filing table | Runtime object, no file/module | Evaluate amendment predicate once | Re-evaluating the persistent view is the blocker. |
| TEMP filing index | Runtime object | Fast holdings→filing membership lookup | Source index and unrelated ORDER BY index were measured no-ops. |
| TEMP holdings view | Runtime shadow from packaged DDL | Persistent view cannot see TEMP table | Table alone is empirically insufficient. |
| `_snapshot_state` | One private T0 helper reusing `publish.digests.sha256_file` | D1 needs comparable pre/post hash, ordered main-schema rows, and sidecar state on every exit | Shell-only probes would sit outside the runner's `finally`; the cutter's private assertion omits required state and has the wrong error contract. |
| T0 SQLite-execution helper | Private script helper | Interrupt a pathological SQLite statement after 180 s | macOS has no `timeout(1)`; unbounded queries already failed operationally. |
| Existing derive orchestrator | Extend by one context | One materialization reused by every consumer | Per-function materialization repeats work and creates inconsistent populations. |
| Existing three test modules | Extend | Their fixtures already own the contracts | New duplicate fixture/test module adds no isolation. |

**Public-symbol enumeration:** only
`populus.amendments.materialized_inst_derivation_views` is new. All query constants,
TEMP names, `_snapshot_state`, and T0 timeout helpers remain private. No dataclass,
schema, CLI option, dependency, route, or published artifact is added.

## Tech Debt Introduced

None planned: no TODO, stub, disabled test, duplicated predicate, source mutation,
snapshot version, or permanent schema object is introduced.

Two pre-existing risks remain explicit rather than hidden:

- Direct full-corpus calls to `compute_period_coverage` outside the opted-in derive
  context still use the persistent view and can be slow. Current production publish and
  T0 callers are put inside the context; fixture-scale acceptance calls remain valid.
  A new large-corpus caller must use the context or justify a broader API change.
- The per-filer reported view chain is not materialized because no pathology has been
  measured there. T0's 180-second SQLite execution bound is the decision point; a
  failure creates a separate delta instead of silent scope growth.

## Memory Touch-Points

The mandated memory index was ranked by hits for materialization, coverage, SQLite,
query plans, TEMP state, read-only derivation, gates, parity, snapshots, and planning.
The top ten files were loaded in full:

- `feedback_gate_list_completeness.md` — retained the complete six-command standing
  gate list, not only the three targeted tests.
- `feedback_stale_review_snapshot_detection.md` — pinned the live HEAD and dirty-tree
  inventory; review must read this worktree, not a cached parent-plan snapshot.
- `feedback_plan_development_vs_execution.md` — this turn stops at a reviewable delta;
  implementation follows approval instead of being mixed into plan authoring.
- `feedback_diagnostic_gated_separation.md` — EXPLAIN/timings are diagnostic; coverage,
  R12, tail geometry, and exit codes remain the only gates.
- `feedback_gate_first_before_read_not_dependency.md` — translated here as view
  verification before the first CTAS, not merely before connection acquisition.
- `feedback_plan_rebaseline.md` — requires a status/diff recheck before implementation
  because the parent branch already carries in-flight changes.
- `feedback_canonical_gate_vs_adjunct_helpers.md` — labels targeted pytest as adjunct
  and the unchanged Make/acceptance chain as canonical.
- `feedback_convergent_review.md` — requires independent plan review and forbids
  self-signing this gate-sensitive delta.
- `feedback_dependency_gate_landed_code.md` — the design was derived from current
  implementations and real consumer scans, not only the approved parent prose.
- `feedback_explicit_plan_contracts.md` — forced exact TEMP names, producer, lifecycle,
  SQL source, transaction placement, and failure behavior.

## Failure-Mode Sweep

- **F0 full-set:** all production consumers of both default view names were enumerated.
  The plan covers coverage, per-period reporting, F8, aggregate, serving, watermarks,
  and T0; it explicitly classifies the unaffected `list13f` ingestion-time consumer.
  No secret or credential is read or logged. The real query path, not a surrogate, is
  the performance oracle.
- **F1 plan-time:** exact full gates are listed; snapshot/main writes are explicitly
  zero; TEMP object names and every affected file/helper are enumerated; the live tree
  must be re-baselined before development.
- **F2 dev-time:** dynamic SQL is limited to packaged fixed DDL and carries appropriate
  nosec annotation if formatted. Removal-fails tests cover the TEMP dependent view,
  F8, timeout, collision, and cleanup. Comments naming old execution order are updated.
- **F3 QA-time:** T0 exercises complete coverage→aggregate→serving function, records
  artifact bytes and tail payloads, and bounds SQLite execution in every named phase.
  A green base-table plan cannot stand in for the persistent/TEMP view path.
- **F4 handoff:** findings, delta, source docstrings, and T0 output are swept together.
  Any source repair invalidates prior gate/T0 evidence and requires a full rerun.
- **F5 transport:** plan review consumes this exact file and HEAD. T0 raw output is
  unbuffered at the locked external evidence path and retained with a digest; a
  zero-byte or partial log is not evidence. The runner's outer `finally` emits and
  compares D1 state on success and all STOP exits.

## Prior Review Resolution

- **F1 resolved:** D1 and D-T7 now give the T0 runner an always-run, fully specified
  pre/post snapshot-state comparison, sidecar refusal, output contract, tests, and
  exit-code precedence. D-T12 carries the two states into the findings record.
- **F2 resolved:** D-T11 writes only to the declared external operations path; Planned
  Files and Definition of Done distinguish that retained evidence artifact from
  worktree changes. No `scratchpad/` path is created.
- **F3 resolved:** the Reuse Map and F0 sweep include and classify the unaffected
  `select_backfill_quarters` consumer in `ingest/list13f.py`.
- **F4 resolved:** D-T8, the matrix, Simplicity Audit, failure-mode sweep, and Definition
  of Done consistently describe a SQLite execution bound, not a general Python
  wall-clock watchdog.
- **F5 resolved:** the Simplicity Audit now enumerates `_snapshot_state`; the Reuse Map
  and rejected-alternatives record why it reuses the public file digest but does not
  import the cutter's incomplete private sidecar assertion.

## Definition of Done

1. Independent plan review approves this delta before implementation begins.
2. D1–D12 pass with evidence from the exact tests and paths in the matrix.
3. No worktree file outside Planned Files changes because of this delta; all
   pre-existing dirty work remains preserved and unstaged. The sole non-worktree output
   is the retained D-T11 log at the declared operations path.
4. Targeted tests and all six standing gates exit 0 after the final source change.
5. The runner emits equal snapshot v1 pre/post SHA and complete ordered main-schema
   inventories from its outer `finally`; no `-journal`, `-wal`, `-shm`, or v2 exists.
6. Full coverage, period coverage, both artifact logical digests, and serving
   projection parity are exact, including a non-empty F8 conflict refusal.
7. The materialized grouped numerator plan has no amendment cascade; SQLite execution
   exceeding 180 seconds in any named phase is interrupted with exit 4. Total phase wall
   time is diagnostic, not a claimed Python watchdog.
8. `docs/build/RUN-M2-11-T0-findings.md` records the external log path and SHA, both D1
   states and PASS result, all phase timings, peak RSS, aggregate bytes, R12 decision,
   exact tail geometry, and any newly discovered pathology.
9. Phase D stays blocked unless T0 completes and R12 locks the no-compression branch.

## Open decisions

None. A phase timeout, aggregate size above 1.5 GiB, or irreconcilable tail geometry is
not an open implementation choice; it is a mandatory stop for a new owner-reviewed
delta.
