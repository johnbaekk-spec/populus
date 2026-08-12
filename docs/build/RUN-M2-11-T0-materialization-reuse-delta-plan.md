# RUN M2-11 T0 repeated-materialization reuse delta (plan-v1)

**Artifact:** plan-v1 delta · **Transport:** interactive-disk · **Status:** OWNER
AUTHORIZED; READY FOR INDEPENDENT REVIEW; no implementation authorized until
review approval · **Date:** 2026-08-10 · **Parent:** approved full-aggregate
performance delta at
`docs/build/RUN-M2-11-T0-aggregate-performance-delta-plan.md`, SHA-256
`2465e7bff8a4f8070c0bd0b60e5bfc15a0f422bf61907bd896b81ca14099f8a3` ·
**Base:** `feat/run-m2-11-inst-publish` at
`7391d947f72cf408a173f1e7938102608b2269d4` plus the preserved cumulative M2-11
implementation and binding T0-v6 finding · **Scope class:** L/high-risk
certification harness and high-cardinality SQLite lifecycle.

Round-1 independent review approved the reuse architecture but found one timeout-
sequencing ambiguity. This revision locks the exact nested lifetime: the
materialization guard enters first; an independently owned `ExitStack` enters the
full materializer; creation duration is captured; materialized EXPLAIN runs under
that same guard; the guard exits; and only the materializer remains active across
pilot/full. A forced materialized-EXPLAIN timeout now proves exit 4, later-rung
suppression, single cleanup, and D1 execution. No implementation has begun.

T0-v6 proved that the aggregate-performance implementation is functionally green:
focused and targeted tests, `make check`, and all five acceptance targets passed;
the 500-filer aggregate completed in 61.130 seconds with 2,165,686,272-byte peak
RSS. It also exposed a distinct harness lifecycle defect. Rung (iv) successfully
constructed the full-snapshot materialized namespace, captured its materialized
plans, cleaned it up, and reported that combined bounded scope as 139.142 seconds.
After the independently bounded pilot, rung (vi) opened the same immutable
snapshot again and rebuilt the same namespace; that redundant build alone exceeded
the unchanged 180-second phase bound and correctly stopped with exit 4.

The live fixture reproduces the topology exactly: one `--full` ladder enters
`materialized_inst_derivation_views` three times, with main database names
`inst-source-v1.db`, `pilot.db`, `inst-source-v1.db`. The first and third entries
read the same snapshot and build the same full TEMP objects. The minimum coherent
remedy is to retain the first full namespace and its source transaction through
the pilot, then use it directly for the certifying derivation. The post-change
entry sequence is exactly `inst-source-v1.db`, `pilot.db`: one snapshot
materialization shared by rungs (iv) and (vi), plus one independent pilot
materialization.

No materialization SQL, filing population, aggregate algorithm, artifact schema,
serving projection, timeout, resource threshold, R12 threshold, tail rule,
snapshot, or production build path changes. The worktree remains intentionally
dirty and unstaged. No commit, push, PR, worktree operation, snapshot mutation,
Phase D action, or deployment is authorized.

## Goal and Success Criteria

Remove the certifying ladder's redundant full-snapshot materialization while
preserving its exact ordered evidence, per-phase bounds, immutable-source
transaction, bounded pilot, and fail-closed behavior.

Success means:

1. Rung (iv) and rung (vi) use the same full snapshot connection, the same active
   read transaction, and the same complete materialized TEMP namespace.
2. A `--full` fixture run enters materialization exactly twice total: once for the
   full snapshot and once for `pilot.db`; the full snapshot is never rebuilt.
3. The full record reports the actual rung-(iv) materialization duration, and an
   explicit log line states that rung (vi) reused it. Zero, an estimate, and pilot
   time are forbidden substitutions.
4. Baseline EXPLAIN remains before materialization; materialized EXPLAIN remains
   inside both the retained namespace and the original materialization deadline;
   the deadline ends before pilot work. The pilot remains rung (v); full
   certification remains rung (vi). No evidence rung is skipped or reordered.
5. Pilot/full aggregate and serving outputs remain identical to current fixture
   expectations. D1, resource aborts, SQLite phase timeouts, cleanup, R12, tail
   vacuity, and exit precedence remain exact.
6. Focused tests, the targeted adjunct, `git diff --check`, all six canonical
   commands, and binding T0-v7 pass. Only exit-zero T0-v7 may enter QA.
7. A separate read-only QA reviewer approves the fresh bundle within at most
   three QA rounds; the implementing agent never self-signs.

## Requirements

- **R1 — One full namespace.** In `_run_ladder`, the source connection opened for
  rungs (i)-(iv) remains the source for rung (vi). After baseline plans are
  captured, it begins exactly one read transaction, enters
  `materialized_inst_derivation_views` exactly once, captures materialized plans,
  and retains the context until rung (vi) succeeds, stops, or is suppressed. No
  second full `_ro_connect(snapshot)` or second full materializer entry occurs.
- **R2 — Exact transaction boundary.** The retained source transaction begins
  before the first owned TEMP data object and spans every materialized EXPLAIN,
  full coverage read, full aggregate source read, and final full serving source
  read. It commits only at the existing successful derivation boundary. Any
  exception before commit unwinds the owned TEMP context, rolls back the active
  transaction, detaches any derived aggregate database after rollback, and closes
  the source connection without masking the primary error.
- **R3 — Independent bounded pilot.** Rung (v) still creates the same first-500-
  filer `pilot.db` through `build_pilot_subset` and calls the public
  `derive_once` path, which owns its own connection, transaction,
  materialization, aggregate destination, cleanup, record, and non-certifying
  tail behavior. It never consumes the full TEMP namespace or changes its filer
  bound. The pilot remains after completed rung-(iv) evidence and before rung
  (vi); a rung-(iv) timeout still suppresses all pilot work.
- **R4 — Narrow immutable overlap.** While the full TEMP namespace is retained,
  `build_pilot_subset` briefly opens its existing second immutable read handle to
  copy the bounded pilot. This is the sole superseding exception to the parent
  plan's no-second-snapshot-handle wording: it is T0-harness-only, both snapshot
  handles use `mode=ro&immutable=1`, neither is writable or changes PRAGMAs, no
  writable database is attached to the retained full connection, and the pilot
  handle closes before pilot derivation/full certification. Production stage
  build remains one source handle and one source transaction. Complete D1
  pre/post equality and sidecar absence remain binding.
- **R5 — Honest timing and ordered evidence.** The monotonic duration captured
  immediately after the rung-(iv) materializer enters is the only full
  `materialization_s`. It is printed to three decimals at rung (iv), passed as the
  full record's `materialization_s`, and named by one exact rung-(vi) reuse line.
  It excludes baseline/materialized EXPLAIN, pilot time, later phase time, and TEMP
  cleanup. The pilot record keeps its independently measured materialization.
  Full JSON keys, R12 output, tail output, and serialization mode otherwise stay
  unchanged.
- **R6 — Shared derivation core, not duplicate logic.** Extract the existing
  post-materialization phase body into one private
  `_derive_from_materialized` helper. It requires an active caller-owned source
  transaction and active materialized namespace. Before any coverage read or
  destination mutation, it rejects unless `conn.in_transaction` is true and the
  existing production aggregate selector returns exactly the two materialized
  query names `agg_input_sign_preflight` and `agg_materialized_positions`; no
  namespace list is copied into the harness. It then runs the unchanged coverage,
  period-coverage, aggregate, serving, commit/detach, RSS, and tail sequence.
  `derive_once` remains the standalone/pilot entry and materializes locally before
  calling this helper. `_run_ladder` calls the same helper for full certification
  with the retained namespace. No second phase implementation is permitted.
- **R7 — One connection owner.** Extract the existing connection/rollback/detach/
  close lifecycle into one private `_owned_derivation_connection` context manager
  used by both `derive_once` and `_run_ladder`. It preserves `_ro_connect` for the
  full snapshot and a normal writable connection only for disposable `pilot.db`.
  Cleanup retains the current rollback retry for a pending SQLite interrupt,
  primary-error precedence, aggregate ATTACH detachment, and connection close.
  It never accepts a caller connection or becomes public configuration.
- **R8 — Bounds and stops unchanged.** `SQLITE_PHASE_TIMEOUT_SECONDS` remains 180,
  `SQLITE_PROGRESS_OPCODES` remains 10,000, and every phase still owns a fresh
  monotonic guard. The retained materialization is bounded once at rung (iv) with
  this exact event order: materialization guard enter; independently owned
  `ExitStack` enters the full materializer; creation-duration capture;
  materialized `explain_plans`; guard checkpoint/exit; pilot/full while only the
  materializer remains active; materializer exit. Rung (vi) does not start a
  fake/empty materialization guard, and the rung-(iv) guard cannot leak into pilot
  or full. A materialized-EXPLAIN timeout is still phase `materialization`, exit 4,
  and suppresses pilot/full after one context cleanup. Coverage, period coverage,
  aggregate across source and destination, and serving retain their existing
  bounds. D1 failure remains exit 5 and takes precedence. Resource aborts remain
  30 GiB disk and 8 GiB RAM and are evaluated immediately before full derivation
  while the retained namespace exists, so the check measures the actual retained-
  resource state.
- **R9 — Exact cleanup and failure ordering.** Tests cover materialization failure,
  pilot-copy failure, pilot materialization/aggregate failure, resource abort,
  full coverage/aggregate/serving timeout, destination attachment, successful
  commit, and repeated entry. In every case the full materializer exits exactly
  once, no owned TEMP object survives its connection, no partial aggregate file
  is treated as complete, no later rung is printed after STOP, and D1 still runs.
- **R10 — Semantic freeze.** No edit is allowed in `src/populus/amendments.py`,
  `src/populus/inst_agg.py`, `src/populus/ingest/inst13f.py`,
  `src/populus/inst_serving.py`, any SQL/schema file, publish/build, dashboard,
  dependency, configuration, workflow, snapshot, or acceptance script. Exact
  production queries and current aggregate/serving behavior are reused unchanged.
- **R11 — Complete verification.** A fail-if-removed lifecycle spy proves the
  current three-entry sequence becomes exactly two entries and the snapshot entry
  encloses the pilot entry. It proves the full aggregate call sees the same
  connection identity, active transaction, and `_populus_inst_agg_input` that
  produced materialized EXPLAIN. End-to-end fixture output proves the full
  `materialization_s` equals rung (iv), not pilot/zero/rebuild time. Existing
  timeout, D1, R12, tail, production-query, and aggregate parity tests remain
  green.
- **R12 — Binding T0-v7 and stop discipline.** After final source edit, run the
  exact focused/targeted/diff/six-gate sequence and binding T0-v7 once. Do not
  overwrite or reinterpret T0-v6. Any nonzero T0-v7—including a later aggregate
  timeout, R12 size stop, tail stop, resource abort, or D1 failure—is appended
  honestly to findings and stops before QA. No retry, timeout increase,
  compression, semantic change, snapshot/index change, or in-run remedy is
  authorized by this plan.
- **R13 — Independent review limits.** This plan receives at most three
  independent plan-review rounds; the main agent fixes grounded findings. Only an
  exact approved digest authorizes implementation. After exit-zero T0-v7, a
  separate QA agent may review at most three rounds; the main agent batches fixes,
  invalidates stale evidence, and reruns every required gate/T0 before resubmission.

## Scope

This delta changes only the T0 measurement harness lifecycle, its executable
tests, the new plan/review notes, append-only findings, and post-success workflow
evidence. The cumulative QA candidate still includes all preserved parent M2-11
changes against HEAD; those changes retain their original approved authority.

The sole non-worktree write authorized during execution is a new append-only log:
`/Users/johnbaek/projects/Populus-ops/snapshots/evidence/m2-11/T0-v7.log`.
Snapshot v1 remains read-only and immutable.

## Non-goals

- no materialization SQL/object/column/index/ownership change
- no aggregate, coverage, serving, QoQ, issuer, concentration, identity, NULL,
  numeric, rank, flag, artifact, digest, or publication semantics change
- no persistent cache, cache file, copied full namespace, backup/restore, snapshot
  v2, source index, `ANALYZE`, PRAGMA tuning, timeout increase, or phase waiver
- no pilot bound, rung order, resource threshold, R12 threshold, tail ceiling,
  file headroom, D1 state, serialization, CLI option, or exit-code change
- no writable ATTACH to the retained snapshot connection; no production source-
  handle exception
- no new module, public API, dataclass, config, dependency, schema, route, manifest
  field, workflow, acceptance target, or generic cache/connection framework
- no Phase D, commit, staging, push, PR, deployment, or worktree operation

## Constraints

- Work only in
  `/Users/johnbaek/projects/Populus-m28/.claude/worktrees/m2-11` on branch
  `feat/run-m2-11-inst-publish`; preserve HEAD and every dirty/untracked file.
- Use `apply_patch` for repository edits. Never reset, checkout over, stage, or
  delete user-owned changes.
- Before implementation and every review round, re-check branch, HEAD, parent plan,
  T0-v6, findings, source/test, and plan hashes plus snapshot size/mode/hash/
  sidecars. Any unexplained drift requires line re-pinning and re-review.
- The SQLite build is 3.50.4 with `PRAGMA temp_store=0` and compile option
  `TEMP_STORE=1`; the retained namespace is file-backed by default. No plan task
  changes that setting. Free resources remain measured, not inferred.
- Full materialization remains the existing context manager and exact SQL. The
  lifecycle spy may wrap it only in tests; production code never receives a
  monkeypatch hook or counter.
- Every source repair invalidates targeted tests, canonical gates, T0, findings,
  Dev Notes, QA report, diff, freshness tokens, and any prior QA verdict.

## Current State

Immutable/pinned provenance at plan authoring:

- branch: `feat/run-m2-11-inst-publish`
- HEAD: `7391d947f72cf408a173f1e7938102608b2269d4`
- parent approved plan SHA-256:
  `2465e7bff8a4f8070c0bd0b60e5bfc15a0f422bf61907bd896b81ca14099f8a3`
- T0-v6 path:
  `/Users/johnbaek/projects/Populus-ops/snapshots/evidence/m2-11/T0-v6.log`
- T0-v6 SHA-256:
  `f0893c15529e273d7edbcb0ef62e1f3babdabe1bdc651a83d11365e26bb15274`
- T0 findings SHA-256:
  `697fb5ecbcd20caf0eba68b57e75a8de66753a9842ac7c05861a391d025c925b`
- current file SHA-256 values:
  - `scripts/measure_inst_derive.py`:
    `3a672aa35d6a81f61a44395c39b47588e17e18028c21b8b2df3e60807e905bc1`
  - `src/populus/amendments.py`:
    `6aa29a5dffe7063ebf1d0e209464dfe8d12b2967c4826188d362018b0b5f098d`
  - `src/populus/inst_agg.py`:
    `041ab76a07a8d60c637f628ba03f07b1906826bace98bbb455f78957bfa05fea`
  - `tests/test_inst_snapshot_script.py`:
    `11b78b007bf2f84e7713d79a6cb6196e0028454b18f2626936f648989d2686b6`
  - `tests/test_inst_agg.py`:
    `84817a8228d7a58169ff96374a33754226561613cb2c04db0c0aa17ac99d6bdc`
  - `tests/test_cover_tolerance.py`:
    `50e8d2cf27ab7c2d7adc352e7314ff9e7f0a069f4119abb6d009a9c22f40f36e`
- snapshot v1: 23,058,628,608 bytes, mode 0444, sidecar-free, SHA-256
  `977a4d249d92590a4de2961a3e9c7ff8cfa2e4846f0097ec7aa6c07f28124121`
- `git diff --check`: exit 0 after the T0-v6 findings append

Binding T0-v6 evidence:

- diagnostic rung-(iv) materialization/plan/cleanup scope: 139.142 s (inside
  180 s; the current label combines all three operations)
- pilot: materialization 90.560 s; aggregate 61.130 s; serving 33.855 s;
  coverage 0.9983215071852559; 459,923,456 aggregate bytes; 2,165,686,272-byte
  peak RSS; 6,162 projected files of headroom
- certifying full: `STOP: SQLite execution bound (180s) interrupted phase
  materialization; later phases suppressed`
- D1: pre/post SHA/schema/sidecars equal; `snapshot_immutability: PASS`; exit 4
- log anchors: diagnostic time line 123, pilot record line 163, STOP line 165,
  D1 states lines 166-167, immutability PASS line 168
- R12, full artifact size/RSS, serving, and tail decisions remain unmeasured

Live code anchors:

- `_run_ladder` opens the first snapshot connection and destroys the rung-(iv)
  namespace at `scripts/measure_inst_derive.py:1171-1221`.
- The pilot is built/derived at `scripts/measure_inst_derive.py:1223-1238`.
- Full calls `derive_once(snapshot, ...)` at
  `scripts/measure_inst_derive.py:1240-1259`, opening and materializing the
  snapshot again.
- `derive_once` owns connection/transaction/materialization and the complete
  phase body at `scripts/measure_inst_derive.py:417-501`.
- The exact materializer and cleanup are already correct and remain untouched at
  `src/populus/amendments.py:274-392`.
- End-to-end/timeout/D1/R12 fixture coverage already lives in
  `tests/test_inst_snapshot_script.py:222-258,756-931`.

The bounded live fixture probe exited 0 and observed three materializer entries:
`inst-source-v1.db`, `pilot.db`, `inst-source-v1.db`. This probe wrote only
disposable temporary artifacts and is diagnostic evidence, not acceptance.

## Detected Stack

- **Languages:** Python ≥3.12 at repository root; TypeScript/Astro under
  `dashboard/`; SQLite/JSON1 data processing.
- **Python runner:** `uv run …` / `.venv/bin/python`; `uv.lock` is present.
- **Node runner:** npm via `dashboard/package-lock.json`; Node ≥24.
- **Tests:** pytest; Node built-in test runner; Astro check/build/post-build.
- **Canonical commands:** `make check`, `make accept-m1-b`, `make accept-m2-5`,
  `make accept-m2-6`, `make accept-m2-8`, `make accept-m2-11`.
- **SQLite runtime:** Python sqlite3 3.50.4; `TEMP_STORE=1`; no network.
- **Stack cache:** no `CLAUDE.md` stack cache exists, so detection was refreshed
  from current manifests and runners.

## Reuse Map

The required full-tree scan included Markdown and excluded only generated/vendor
trees. It found the complete lifecycle surface in the measurement script,
materializer, aggregate/coverage/serving producers, publish consumer, acceptance
script, and existing aggregate/external-store/snapshot tests.

| Need | Reuse decision | Evidence/rationale |
|---|---|---|
| full frozen namespace | reuse unchanged | `materialized_inst_derivation_views` already owns verification, exact objects, and cleanup (`amendments.py:274-392`). |
| post-materialization phases | extract once, call twice | Existing exact body is `measure_inst_derive.py:438-483`; extraction prevents pilot/full drift. |
| connection cleanup | extract existing owner | Existing rollback/detach/close is `measure_inst_derive.py:484-501`; one private owner serves both callers. |
| pilot copy/derivation | reuse unchanged | `build_pilot_subset` and `derive_once` already enforce the 500-filer independent path (`measure_inst_derive.py:360-501`). |
| timeout guard | reuse unchanged | Shared source/destination monotonic guard is `measure_inst_derive.py:154-253`. |
| exact queries/semantics | reuse unchanged | Production coverage/aggregate selectors and serving projection remain current imports; no copied SQL. |
| D1/R12/tail/resource gates | reuse unchanged | Main/finally and `_run_ladder` already own exact exit/evidence logic (`measure_inst_derive.py:1128-1304`). |
| lifecycle proof | extend existing test module | End-to-end, timeout, D1, R12, and tail tests are co-located in `test_inst_snapshot_script.py`. |

No cache database, alternate materializer, second derivation implementation,
schema, artifact, persistent state, new fixture, or test module is introduced.

## Architecture

### A. Retained full scope

`_run_ladder` owns one `_owned_derivation_connection(snapshot, label="full")`.
Rungs (i)-(iii) and baseline EXPLAIN execute as today. Immediately before full
TEMP creation, the connection begins one read transaction. The existing
materialization guard enters first. An independently owned `ExitStack` then enters
the existing materializer; its creation duration is captured immediately after
entry, and materialized EXPLAIN runs while that same guard is still active. The
guard checkpoints/exits only after EXPLAIN succeeds. Instead of leaving the
materializer context, the function retains only that context through the pilot
and full derivation. Thus EXPLAIN keeps its existing 180-second protection, but a
stale rung-(iv) deadline cannot fire during later rungs.

### B. Independent pilot inside the retained lifetime

The existing pilot-copy function briefly opens the immutable snapshot a second
time while the retained connection remains open, writes only `pilot.db` under the
temporary scratch directory, and closes. `derive_once(pilot.db, label="pilot")`
then uses its own connection/materialization and the shared phase core. The full
TEMP namespace is never queried by pilot code. The resource check occurs after
pilot completion while the full namespace remains allocated.

### C. Shared phase core

`_derive_from_materialized` receives the active connection, scratch path, label,
window, and already measured materialization duration. It first enforces the
active transaction and exact existing production-selected materialized query
names, then runs the existing phase sequence without new SQL. `derive_once`
measures/enters a local
materializer then calls it; `_run_ladder` passes the retained full scope. The
helper commits/detaches at the same successful boundary and returns the unchanged
record shape. The full record receives the exact saved rung-(iv) duration.

### D. Owner and cleanup

`_owned_derivation_connection` creates the appropriate new connection, yields it,
and centralizes the existing finalizer: pending-interrupt-aware rollback, derived
aggregate detachment, and close. The nested materializer exits before this owner,
so dependent TEMP cleanup retains its established ordering. Full success commits
inside the phase core; pilot-only, resource-abort, and error paths roll back.

## Locked Decisions

1. **Retain and reuse, never rebuild.** The exact rung-(iv) namespace becomes the
   rung-(vi) namespace. No copy/serialize/restore/persistent cache is allowed.
2. **Preserve rung order.** Baseline/materialized EXPLAIN, pilot, then full. The
   optimization is lifetime only.
3. **Accept one harness-only immutable-handle overlap.** This is smaller and safer
   than writable ATTACH, pre-running the pilot out of order, or copying 2.25 GB of
   TEMP state. Production remains single-handle.
4. **Share the phase body.** One private `_derive_from_materialized` implementation
   serves standalone/pilot and retained-full callers.
5. **Share connection ownership.** One private context manager preserves current
   rollback/detach/close behavior; no caller-supplied connection API is added.
6. **Report real time.** The full record reuses the actual rung-(iv) duration and
   prints an explicit reuse statement; it never records zero.
7. **No resource assumption.** The existing disk/RAM check runs with retained TEMP
   state active. Failure is an honest exit 2, not a cleanup/tuning trigger.
8. **T0-v7 is binding.** Any nonzero result stops for a newly authorized delta;
   this plan cannot remedy aggregate/R12/tail failures discovered later.
9. **Review limits are three plan rounds and three QA rounds.** Separate agents
   review; the main agent alone edits.

## Alternatives Considered

- **Run T0-v6 again:** rejected; append-only binding evidence cannot be retried or
  reinterpreted after exit 4.
- **Raise the 180-second bound:** rejected; it hides redundant work and changes a
  locked safety gate.
- **Leave rung (iv) early and rebuild:** rejected; that is the measured failure.
- **Persist/restore the TEMP namespace:** rejected; adds a 2.25+ GB cache format,
  copy cost, identity validation, cleanup, and a parallel lifecycle.
- **Skip materialized EXPLAIN:** rejected; removes required exact production-path
  evidence.
- **Move the pilot before rung (iv):** rejected; reorders the certified ladder and
  performs later work before an earlier STOP boundary.
- **Use the retained full namespace as the pilot:** rejected; the pilot would no
  longer be bounded or independent and its timings/tail-vacuity contract would be
  false.
- **Writable ATTACH for pilot construction:** rejected; violates the immutable
  source connection boundary and prior reviewed design.
- **Stream pilot rows through Python from the retained handle:** rejected; adds a
  second high-cardinality copy implementation merely to avoid a safe immutable
  read overlap.
- **Change TEMP PRAGMAs or materialization SQL:** rejected; the first exact
  namespace construction completed inside a 139.142-second bounded scope that
  also included materialized EXPLAIN and cleanup, and this delta addresses reuse
  only.
- **Optimize aggregate/R12 in advance:** rejected; their full-corpus outcomes are
  still unmeasured and require separate evidence/authority if they fail.

## Planned Files

- `docs/build/RUN-M2-11-T0-materialization-reuse-delta-plan.md` — this plan and
  review resolution notes only.
- `scripts/measure_inst_derive.py` — private connection owner, shared
  post-materialization phase helper, retained rung-(iv) scope, honest reuse line;
  no query/threshold/CLI/semantic edit.
- `tests/test_inst_snapshot_script.py` — lifecycle entry/order/connection/
  transaction/timing proof plus failure-cleanup propagation.
- `docs/build/RUN-M2-11-T0-findings.md` — append-only T0-v7 evidence and decision.
- `docs/build/RUN-M2-11-devnotes.md` — fresh dev-notes-v1 only after exit-zero T0.

No other source, test, SQL, schema, acceptance, workflow, dashboard, dependency,
configuration, snapshot, or evidence-log file may be modified by this delta.

## Implementation Tasks

### Phase 0 — approval and fresh baseline

- **T1 [R10, R12, R13]:** Validate this plan as plan-v1 and obtain independent
  approval within three rounds. Immediately pin the approved digest, branch/HEAD,
  parent/findings/T0/source/test hashes, snapshot identity, and dirty tree.
- **T2 [R1, R3, R11]:** Re-run the bounded fixture lifecycle spy and exact anchor
  scan only; no new performance experiment may widen the approved architecture.

### Phase 1 — shared lifecycle

- **T3 [R6, R7, R9]:** Extract `_owned_derivation_connection` from the current
  connection selection and finally block. Preserve full/pilot open modes,
  rollback retry/primary-error behavior, aggregate detachment, and close.
- **T4 [R5, R6, R8]:** Extract `_derive_from_materialized` from the current exact
  phase body. Pass the measured materialization duration explicitly; preserve all
  phase guards, destination deadline registration, commit/detach, RSS, tail, and
  record behavior. Enforce active-transaction and exact production-selected
  materialized-query preconditions before any phase read/mutation, with negative
  tests for no transaction and partial namespace. Make `derive_once` enter its
  local materializer and call the helper without changing its caller interface.
- **T5 [R1, R2, R3, R4, R5]:** Restructure `_run_ladder` so its first snapshot
  connection begins one transaction. Enter the materialization guard, enter the
  materializer through an independent `ExitStack`, capture creation duration,
  run materialized EXPLAIN, and exit the guard in that exact order; retain only
  the materializer through rung (v), then call the shared helper for rung (vi).
  Print the exact reuse line and pass the saved duration. Preserve all early
  returns and resource checks.

### Phase 2 — executable proofs

- **T6 [R1, R2, R3, R11]:** Add a context spy to the end-to-end fixture proving
  exactly two entries named `inst-source-v1.db`, `pilot.db`, with nested event
  order `full-enter, pilot-enter, pilot-exit, full-exit`. At the full aggregate
  call, assert the same connection identity is in transaction and owns the exact
  materialized input object used by materialized EXPLAIN.
- **T7 [R5, R8, R11]:** Parse rung-(iv), pilot, and full records. Assert full
  `materialization_s` exactly equals the printed rung-(iv) value; pilot retains an
  independent value; the explicit reuse line exists; full output/R12/tail remain
  successful on the fixture.
- **T8 [R8, R9, R11]:** Add a guard/materializer/explain/pilot/full event spy that
  proves the exact R8 nesting and that the rung-(iv) guard exits before pilot.
  Force materialized EXPLAIN (after successful materializer entry) to exceed its
  guard and prove phase `materialization`, exit 4, pilot/full suppression, one
  full cleanup, and D1 execution. Extend forced failures for materializer entry,
  pilot failure while full is retained, resource abort, and full aggregate/
  destination timeout. Assert correct exit/suppression, one full exit, connection
  usability/close as applicable, no owned TEMP residue, D1 PASS, and no
  overwritten evidence.

### Phase 3 — gates and binding evidence

- **T9 [R10, R11, R12]:** Run focused
  `PYTHONDONTWRITEBYTECODE=1 .venv/bin/python -m pytest -q tests/test_inst_snapshot_script.py`,
  then the exact cumulative targeted eight-module adjunct.
- **T10 [R12]:** After the final source edit run `git diff --check`, `make check`,
  `make accept-m1-b`, `make accept-m2-5`, `make accept-m2-6`,
  `make accept-m2-8`, and `make accept-m2-11`, each separately with its exit
  retained.
- **T11 [R5, R8, R11, R12]:** Verify `T0-v7.log` does not exist, then run binding
  T0-v7 exactly once. Retain its unbuffered complete log, hash it, reverify snapshot
  size/mode/hash/sidecars, and append exact gates, lifecycle line, timings,
  artifact bytes/RSS, R12/tail decision, D1, log identity, and exit to findings.

### Phase 4 — independent QA loop

- **T12 [R12, R13]:** Only after exit-zero T0-v7, write/validate fresh Dev Notes
  and the canonical current QA-only bundle: approved plan, changed files, redacted
  baseline diff, gates, QA report, provenance, and freshness tokens.
- **T13 [R11, R12, R13]:** Submit to a separate `qa-review` agent. If it returns
  changes, batch all grounded fixes, rerun affected focused tests plus the full
  targeted/six-gate/T0 sequence, rebuild all freshness evidence, use a new T0 log
  suffix without overwrite, and resubmit. Stop after PASS or three QA rounds.

## Testing Strategy

### Focused lifecycle tests

- exact current-to-target materializer count: three becomes two
- exact entry identities and nesting order
- exact guard→materializer→duration→materialized-EXPLAIN→guard-exit→pilot/full
  event order; no rung-(iv) guard survives into later rungs
- same full connection/transaction/TEMP input for materialized EXPLAIN and full
  aggregate/serving
- full timing equals rung-(iv) captured time; pilot timing remains independent
- full namespace retained through pilot but never queried by pilot
- pilot limit and tail-vacuity behavior unchanged
- materializer-entry and materialized-EXPLAIN timeouts each suppress pilot/full,
  exit 4, clean the full context once, and still execute D1
- pilot failure unwinds retained full scope and suppresses full
- full resource abort unwinds retained scope and returns 2
- source/destination/commit timeout returns 4 and D1 still runs
- D1 mismatch remains exit 5 over any other status
- success and repeated entry leave no owned TEMP/attachment/file residue

### Existing semantic regression

The exact cumulative eight-module adjunct remains mandatory because this lifecycle
holds the materialized namespace across every previously proven coverage,
aggregate, and serving consumer. All oracle/bulk row/report/digest/projection,
signed/limb, cleanup, external-store, publish, and amendment tests remain green.

### Binding commands

```bash
PYTHONDONTWRITEBYTECODE=1 .venv/bin/python -m pytest -q \
  tests/test_inst_snapshot_script.py
PYTHONDONTWRITEBYTECODE=1 .venv/bin/python -m pytest -q \
  tests/test_inst_agg.py tests/test_cover_tolerance.py \
  tests/test_inst_external_store.py tests/test_inst_snapshot_script.py \
  tests/test_inst_serving.py tests/test_inst_serving_artifact.py \
  tests/test_publish.py tests/test_amendments.py
git diff --check
make check
make accept-m1-b
make accept-m2-5
make accept-m2-6
make accept-m2-8
make accept-m2-11
```

Binding T0-v7, with no build date and no `tail` pipe:

```bash
mkdir -p /Users/johnbaek/projects/Populus-ops/snapshots/evidence/m2-11
set -o pipefail
PYTHONDONTWRITEBYTECODE=1 .venv/bin/python -u scripts/measure_inst_derive.py \
  --snapshot /Users/johnbaek/projects/Populus-ops/snapshots/inst-source-v1.db \
  --measured-files 8106 \
  --pilot-filers 500 \
  --full 2>&1 | tee \
  /Users/johnbaek/projects/Populus-ops/snapshots/evidence/m2-11/T0-v7.log
```

## Verification Matrix

| Requirement | Objective proof |
|---|---|
| R1 | exactly one snapshot materializer entry shared by materialized EXPLAIN/full |
| R2 | active transaction/connection identity across full source reads; commit/rollback trace |
| R3 | unchanged independent pilot database, bound, record, and entry |
| R4 | only immutable concurrent read handles; no writable attach/sidecar; D1 equal |
| R5 | exact rung-(iv)/full time equality and explicit reuse line |
| R6 | one shared phase helper; pilot/full output regression |
| R7 | one connection owner; rollback/detach/close success/failure tests |
| R8 | exact guard/context/explain/pilot/full event spy; forced EXPLAIN timeout; fixed constants/exits |
| R9 | failure matrix proves exact context exit and no residue/masking |
| R10 | diff/allowlist proves only planned harness/test/docs changed |
| R11 | lifecycle spy plus all existing semantic/timeout/D1/R12/tail tests |
| R12 | focused/targeted/diff/six gates and one append-only binding T0-v7 |
| R13 | exact approved plan digest and separate QA PASS within three rounds |

## Rollout / Rollback

- **Rollout:** none; this is an offline certification-harness lifecycle change.
- **Success:** retained TEMP state is dropped after the full result, connection is
  closed, temporary directory is removed, and only the append-only evidence log
  remains outside the worktree.
- **Failure:** nested contexts unwind full TEMP state first; the connection owner
  rolls back, detaches, and closes; D1 runs; later phases are suppressed.
- **Rollback:** revert only this delta's measurement-script/test/doc edits. The
  approved aggregate implementation and T0-v6 evidence remain intact.
- **T0 failure:** append exact evidence, use zero QA rounds, and stop. No retry,
  threshold/bound change, compression, semantic repair, or evidence overwrite.

## Simplicity Audit

Minimum coherent change: retain one existing context longer, extract its existing
phase body once, extract its existing connection owner once, and extend one
existing test module. No query or producer changes.

Exactly two new private symbols are planned:

1. `_owned_derivation_connection` — context manager for the existing open/
   rollback/detach/close lifecycle.
2. `_derive_from_materialized` — the existing coverage→aggregate→serving phase
   body operating inside a caller-owned active materialization.

No new file/module beyond the plan, public function/class/dataclass, CLI, config,
schema, artifact, cache, generic framework, or alternate implementation is
introduced. Any additional helper or any edit outside the planned allowlist is
scope drift and requires plan re-review.

## Tech Debt Introduced

1. **TD-M1 — retained TEMP lifetime and immutable-handle overlap.** The existing
   approximately 2.25 GB full TEMP cache remains allocated while the bounded pilot
   copy/derivation runs, and the pilot copy briefly overlaps a second immutable
   snapshot read handle with the retained full handle. Impact: longer scratch-disk
   lifetime and potentially lower free-resource readings before full. Mitigation:
   file-backed TEMP default, 148.9 GiB pre-T0 disk and 22.6 GiB RAM observations,
   unchanged 30/8 GiB live resource abort, exact two-entry/nesting tests, both
   handles `mode=ro&immutable=1`, pilot handle closes promptly, and binding D1.
   Removal condition: a separately reviewed ladder that no longer requires both a
   full materialized EXPLAIN and an independent pilot before certification.

Pre-existing debt, not introduced here: dual oracle/bulk aggregate
representations, the 2.25 GB TEMP cache itself, and the possibility that full
aggregate size exceeds R12. This delta does not hide, repay, or worsen their
semantic surface. No TODO, stub, disabled test, ignored exception, timeout waiver,
persistent cache, or hidden retry is authorized.

## Memory Touch-Points

The deterministic selector used `materialization`, `timeout`, `performance`,
`cache`, `sqlite`, `plan`, and `repeatability` and returned ten memories:

- `feedback_plan_development_vs_execution.md` — the failed approved delta is not
  rewritten; this newly authorized delta proceeds to a new executable plan.
- `feedback_plan_decision_lock.md` — all lifecycle, overlap, timing, and stop
  choices are locked before implementation.
- `feedback_executable_plan_wiring.md` — reuse/timing/cleanup rules appear in
  tasks, tests, matrix, rollout, and DoD.
- `feedback_explicit_plan_contracts.md` — the retained namespace producer,
  connection/transaction ownership, consumer, timing, and failure boundaries are
  explicit.
- `feedback_identity_scoped_cache.md` — consulted; its auth/tenant cache rule is
  not applicable to a connection-local offline TEMP namespace.
- `feedback_mypy_cache_stale_rebase.md` — consulted; no mypy/rebase/cache-clearing
  action applies to this unchanged HEAD.
- `feedback_plan_anchor_verification.md` — every lifecycle/test/log citation was
  re-grepped against the live dirty tree.
- `feedback_plan_rebaseline.md` — branch/HEAD and all relevant content hashes are
  pinned; any drift forces re-citation/re-review.
- `feedback_plan_rule_never_cached_disposition.md` — the plan specifies the
  runtime reuse rule and assertions, never a cached future outcome.
- `feedback_plan_write_denied.md` — consulted; write access is available and this
  review artifact is truthfully persisted on disk.

The mandatory failure-mode catalog was loaded and shaped the full lifecycle scan,
exact gate list, fail-if-removed spy, cleanup matrix, freshness invalidation, and
separate review boundary.

## Failure-Mode Sweep

| Catalog item | Prevention and executable proof |
|---|---|
| F0 full-set sweep | Script, materializer, aggregate/coverage/serving, publish, acceptance, tests, and docs were scanned; only harness/test/docs change. |
| F0 secrets | No network, credential, environment dump, token, or secret-bearing output. |
| F0 verify, do not assume | T0-v6 log and a live fixture spy prove the duplicate lifecycle; T0-v7 remains binding. |
| F1 all consumers/gates | Planned files and all six standing commands are exact. |
| F1 units/NULL | No served/numeric field changes; seconds/bytes/GiB and unavailable full results are named honestly. |
| F1 locked decisions | Nine decisions select one retained-context design; no owner question remains. |
| F2 full-tree gate scope | Focused adjunct supplements, never replaces, targeted and canonical gates. |
| F2 boundary validity | Removal of reuse makes the materializer-count/nesting/timing test fail. |
| F2 bulk SQL | Existing bulk SQL is reused; no Python high-cardinality copy is added. |
| F2 stale comments | Module/rung comments and log wording must describe retained reuse and pilot independence. |
| F3 end-to-end function | Fixture and binding T0 exercise snapshot→materialize→pilot→full→R12/tail, not liveness. |
| F3 doc reconciliation | Findings use exact log hash/lines/times/exits and snapshot identity. |
| F4 propagation | Any review fix is grep-swept across requirements, tasks, matrix, tests, debt, and DoD. |
| F4 QA batching | All grounded QA findings are fixed together before complete re-gating. |
| F5 freshness | Any source repair invalidates all tests/gates/T0/findings/Dev Notes/QA/diff/verdict evidence. |

## Definition of Done

- [ ] **R1** one full snapshot materializer entry produces both rung-(iv) plans
  and rung-(vi) source state; fixture entry count is exactly two including pilot.
- [ ] **R2** the same full connection and one transaction span materialization
  through the final serving source read; commit/rollback ordering is proven.
- [ ] **R3** pilot remains independently copied, bounded, derived, timed, and
  non-certifying without `--full`.
- [ ] **R4** immutable overlap is limited to pilot copy, no writable source attach
  occurs, production remains single-handle, and D1 stays exact.
- [ ] **R5** full `materialization_s` equals rung (iv) and the explicit reuse line
  is present; no zero/estimate/pilot substitution.
- [ ] **R6** both pilot/standalone and retained full use one shared exact phase
  helper with unchanged output behavior.
- [ ] **R7** one private connection owner preserves rollback retry, primary error,
  detach, close, and repeated-entry cleanup.
- [ ] **R8** timeout/opcode/resource/R12/tail/D1 constants, exits, and suppression
  behavior are unchanged; the guard encloses materializer entry plus materialized
  EXPLAIN, exits before pilot/full, and a forced EXPLAIN timeout proves exit 4,
  single cleanup, later-rung suppression, and D1.
- [ ] **R9** every named failure unwinds exactly once with no TEMP/attachment/
  partial-file residue or masked primary error.
- [ ] **R10** allowlist/diff proves no production query, producer, schema,
  dashboard, workflow, dependency, snapshot, or acceptance edit.
- [ ] **R11** lifecycle spy, end-to-end fixture, and all existing semantic/
  timeout/D1/R12/tail tests pass.
- [ ] **R12** focused/targeted/diff/six canonical gates pass; binding T0-v7 exits
  0 with complete lifecycle, D1, timing, size, RSS, R12, and tail evidence, or a
  nonzero result is appended and stops before QA.
- [ ] **R13** exact final plan digest receives independent approval; only an
  exit-zero fresh bundle receives separate QA PASS within three rounds.
- [ ] Snapshot v1 remains 23,058,628,608 bytes, mode 0444, exact SHA-256, and
  sidecar-free; no commit/stage/push/PR/deploy/worktree action occurred.

Implementation begins only after independent `plan-review` returns
`VERDICT: APPROVED` for the exact final digest.
