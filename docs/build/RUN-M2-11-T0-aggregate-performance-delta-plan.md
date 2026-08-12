# RUN M2-11 T0 full-aggregate performance delta (plan-v1)

**Artifact:** plan-v1 delta · **Transport:** interactive-disk · **Status:** OWNER
AUTHORIZED ONE EXCEPTION ROUND-4 PLAN REVIEW; ROUND-3 FIX APPLIED; READY FOR
INDEPENDENT REVIEW; no implementation authorized until review approval ·
**Date:** 2026-08-10 · **Parent:** approved full-coverage totals delta at
`docs/build/RUN-M2-11-T0-coverage-totals-delta-plan.md`, SHA-256
`2fbded25f34ef40744d7aeb000d2afc5b02851ef35d91b133665b84b8fc80071` ·
**Base:** `feat/run-m2-11-inst-publish` at
`7391d947f72cf408a173f1e7938102608b2269d4` plus the preserved live M2-11
implementation and binding T0-v5 finding · **Scope class:** L/high-risk financial
logic and high-cardinality SQLite processing.

T0-v5 proved the coverage-totals delta: all intended materialized coverage and
disposition statements use the dedicated per-filing totals index, the 500-filer
pilot coverage read completed in 0.010 seconds, and the binding full run advanced
through coverage and period coverage. The next independent bottleneck is now
measured: `build_inst_agg` exceeded the unchanged 180-second SQLite phase bound.

The current builder iterates the holdings population twice in Python and retains
full-corpus dictionaries/lists (`src/populus/inst_agg.py:425-666`) before writing
the artifact (`src/populus/inst_agg.py:668-721`). The pilot already reached
3,915,038,720 bytes peak RSS for 500 filers. The full materialized population is
16,302,461 per-filer reported holdings, 12,932,216 default holdings, 10,461,572
default position groups, and 9,482,028 exact QoQ output rows. Scaling the current
object graph is neither time-safe nor memory-safe.

This delta adds one narrow, connection-local aggregate input cache to the existing
verified materialization and a bulk/streaming aggregate path that consumes it.
The persistent standalone path remains the semantic oracle and compatibility
fallback. No filing population, identity rule, QoQ classification, numeric/NULL
contract, artifact schema, digest projection, timeout, R12 threshold, serving
consumer, accepted snapshot, or publication decision changes.

The worktree is intentionally dirty with the cumulative M2-11 implementation.
All existing work remains unstaged and must be preserved. No commit, push, PR,
worktree operation, snapshot mutation, Phase D action, or deployment is authorized.

Round-1 review rejected three unexecutable details in the initial draft: a Python
aggregate would receive one callback per grouped position, SQLite callback removal
would leave function-name tombstones, and the source-only progress handler would
not bound separate-destination work. This revision removes both source-connection
callbacks, uses exact native integer limbs, and carries one monotonic T0 deadline
across both SQLite connections including commit.

Round-2 review approved those replacements but proved that native `SUM` can
overflow on a mixed-sign sequence before cancellation even when the oracle's final
group total fits. The normalized snapshot has zero negative `value_usd` or
`ssh_prnamt` rows. This revision therefore makes both summed source fields an
optimized-path eligibility check, not a new numeric contract: any negative value
or share selects the unchanged Python compatibility oracle before bulk stages or
destination mutation. Signed cancellation semantics remain supported exactly;
only the measured nonnegative 13F corpus is accelerated.

Round-3 review found the same signed-cancellation risk in `ssh_prnamt` and a
distinct nonnegative share-total edge: shares can exceed int64 inside a position
that the oracle never projects. This revision extends sign eligibility to both
summed source fields and makes the first reusable position stage accumulate shares
as seven safe base-1000 limbs. An out-of-int64 position share total selects the
oracle before destination mutation; it never reaches native `SUM`. Snapshot v1's
full holdings superset has zero negative shares, and the measured position CTAS
completed without grouped-share overflow. No fourth review has been run.
The owner explicitly authorized one exceptional fourth independent plan-review
round after this correction; no additional review round is authorized.

## Goal and Success Criteria

Make the full aggregate build use bounded SQLite-native staging and batched output
instead of retaining millions of Python objects, while proving complete semantic
identity with the existing builder and preserving snapshot v1 byte-for-byte.

Success means:

1. One narrow TEMP input cache represents every filer-reported holding exactly
   once, carries exact default-membership and issuer inputs, and is created only
   after persistent-view verification inside the existing R16 read transaction.
2. The materialized aggregate path retains no full-corpus Python dictionary or
   list; it groups and matches in TEMP SQL and transfers fixed-size batches to a
   separately committed derived destination database.
3. Registry, QoQ, issuer-holder, concentration, report counts, logical digest,
   and complete serving projection are identical to the persistent oracle across
   semantic fixtures and the immutable-source pilot.
4. Every QoQ identity pass and classification rule, issuer fallback, exact integer
   concentration calculation, NULL distinction, notice-only row, ordering/tie
   rule, and canonical flag string remains unchanged.
5. Materialized aggregate EXPLAIN/trace evidence uses the exact production SQL,
   names the narrow cache and required TEMP indexes, and proves the old ordered
   wide-view scans are not selected.
6. Focused tests, the targeted adjunct, `git diff --check`, all six canonical
   commands, and binding T0-v6 pass. T0-v6 must emit complete D1, R12, tail,
   timing, size, row-count, and RSS evidence and exit 0 before QA begins.
7. A separate Codex QA reviewer approves the fresh complete bundle within at
   most three QA rounds; the implementing agent never self-signs.

## Requirements

- **R1 — Verified source first.** Collision-only TEMP metadata may precede
  `verify_views`; no main data read or owned data object may. Drift still fails
  closed before any aggregate cache or derived destination exists.
- **R2 — Exact narrow input cache.** The materializer creates exactly one TEMP
  `_populus_inst_agg_input` row for every row of the frozen
  `v_filer_reported_holdings` population. Its fixed columns are `cik`,
  `period_of_report`, `security_id`, `cusip`, `issuer_name_raw`, `value_usd`,
  `ssh_prnamt`, `ssh_prnamt_type`, `put_call`, `entity_id`,
  `entity_link_state`, `unkeyed_token`, and integer `is_default`.
  `unkeyed_token` is `holding_id` only when both position identifiers are NULL;
  `is_default` is exact membership in frozen `v_default_inst_filings`. The table
  is narrow staging, never a public/persistent schema or artifact.
- **R3 — Exact owned lifecycle.** `_populus_inst_agg_input` joins the existing
  twelve-name materializer registry, so all thirteen names collide fail-closed.
  The three affiliation-only objects still disappear before yield; exactly ten
  objects remain in the body. Every setup/body/cleanup exception removes only
  objects created by that entry, completes peer cleanup after one failed DROP,
  retries once, and never masks the primary failure with a stale cache.
- **R4 — Materialized-path selection and fallback.** `build_inst_agg` selects the
  bulk path only inside the exact owned TEMP namespace, including the frozen
  filing tables, holdings views, totals table/index, and aggregate input cache.
  It then runs one exact production sign preflight over the cache:
  `EXISTS(value_usd < 0 OR ssh_prnamt < 0)`. Missing/partial ownership or any
  negative summed source field selects the existing persistent Python path before
  bulk-stage creation or destination deletion; no standalone caller creates or
  trusts a lookalike cache. This explicit fallback preserves mixed-sign arbitrary-
  precision cancellation for both values and shares, including same-group
  `INT64_MAX,+1,-1`. Snapshot v1 is sign-eligible because the full
  `inst_holdings` superset contains zero negative values and zero negative shares.
  Destination-alias refusal and `ensure_views` ordering remain unchanged.
- **R5 — Bounded QoQ staging.** The bulk path creates fixed internal TEMP position,
  period-pair, and match objects with collision preflight and unconditional
  dependent-first cleanup. Position rows reproduce `_Position` and `_finalize`
  exactly: security-id-first key, exact CUSIP fallback, LONG/PUT/CALL bucket,
  SH/PRN/UNKNOWN grain, disclosed-value state distinct from zero, unit/null-share
  state, and single-CUSIP state. Only `is_default=1` keyable inputs participate.
  The first reusable position stage never calls native `SUM(ssh_prnamt)`: it
  decomposes each eligible nonnegative share into seven base-1000 limbs, sums each
  digit, normalizes carries, and compares the canonical high-to-low digits against
  int64 maximum `[9,223,372,036,854,775,807]`. A fixed default-row guard of
  `9_223_372_036_854_775` (`INT64_MAX // 1000`) keeps every digit-plus-carry
  accumulation in int64. If any position share total exceeds int64, the stage is
  cleaned and the unchanged oracle is selected before destination deletion; the
  successful stage is reused by QoQ rather than regrouped. This preserves an
  oracle-successful unprojected huge-share group. Eligible value sums are
  nonnegative; their overflow implies a final registry/issuer integer outside the
  unchanged destination capacity, so no oracle artifact could complete.
- **R6 — Exact three-pass matching.** Bulk QoQ matching performs, in order:
  exact `(position_key, put_call, unit)`; unique same-identity unit transition;
  then unique exact reported-CUSIP reconciliation only across the
  resolved/unresolved boundary. Filing-period adjacency still comes from the
  complete filer-reported filing universe, so notice-only gaps produce exits and
  news and never bridge. Ambiguous candidates remain unmatched.
- **R7 — Exact QoQ values and flags.** The final bulk query reproduces `_qoq_row`
  byte-for-byte: absence is real zero; present-undisclosed is NULL;
  `delta_shares` requires compatible disclosed units; shares classify before
  value; zero delta value classifies `add`; unclassifiable rows remain
  `unclassified`; and canonical flags retain sorted compact JSON. Its share
  inputs are the eligibility-stage's proven int64 totals, so compatible-unit
  subtraction remains within signed int64. Final rows are streamed to the
  unchanged destination table in fixed-size batches, never held as one list.
- **R8 — Exact registry and issuer rows.** Registry counts/sums use every
  filer-reported input, retain notice-only filers, NULL-value counts, unkeyed
  counts, latest period, and exact names. Issuer rows use only default inputs,
  retain entity→CUSIP-6→Python-normalized-name fallback, sum all share classes
  before ranking, rank by value descending then CIK ascending, cut exactly
  `topn`, retain `security_count`, representative minimum raw name, and canonical
  fallback flags. Entity and CUSIP-6 tiers stay native SQL. Only SQL-preaggregated
  name-fallback records cross fixed-size Python batches through the existing
  `_norm_issuer_name`; batches enter a private TEMP normalization stage and SQL
  performs the final merge/rank. No SQLite UDF is registered on either connection.
- **R9 — Exact integer concentration.** Concentration uses every filer-reported
  input and the existing `(position_key|put_call)`/unkeyed-row grain. It retains
  raw position/null counts, integer total/top-N value, exact Python-big-int
  `SUM(value_i**2) * 10000 // total**2`, maximum-position bps, zero-total NULLs,
  and `concentration_unavailable`. SQLite floating-point arithmetic is forbidden.
  Each eligible nonnegative 64-bit grouped position value is decomposed natively
  into seven base-1000 limbs with integer division/remainder;
  SQL sums the thirteen exact square-convolution coefficients per filer-period.
  Before coefficient SUM, a fixed guard rejects a position population above
  `1_320_263_783_997` (`INT64_MAX // (7 * 999 * 999)`), so no coefficient can
  overflow even if every position belongs to one period. Python reconstructs one
  arbitrary-precision square sum per filer-period from those thirteen integers
  and performs the final integer divisions. Signed corpora never enter this SQL;
  they retain exact oracle behavior under R4. There is no Python SQLite aggregate,
  per-position callback, decimal/REAL coercion, or approximation.
- **R10 — Destination and transaction contract.** The destination remains a
  separate fresh SQLite connection using unchanged `inst_agg.sql`; it commits
  before logical digest/serving reads. No writable database is attached to the
  immutable source, no second snapshot handle is opened, and the one source read
  transaction still spans verification through the last serving-projection read.
  Partial destination files are removed/refused under the existing failure rule.
  During T0 only, `_sqlite_execution_bound` yields one private monotonic deadline
  guard. The harness registers the source; the bulk builder registers the
  destination immediately after opening it. The guard installs progress handlers
  on both, arms one timer that calls `interrupt()` on every registered connection
  at the deadline, and checkpoints before/after every fetch batch, destination
  batch, and final commit. Its `finally` cancels the timer and clears only its own
  handlers. Expiry during or immediately after commit still raises the existing
  phase timeout, removes the derived file, returns T0 exit 4, and suppresses later
  phases. Non-T0 callers pass no guard and gain no timeout/configuration surface.
- **R11 — Exact evidence and semantic parity.** Tests compare every projected
  table row, `InstAggReport`, aggregate logical digest, serving logical digest,
  and complete `ServingProjection` between persistent and materialized paths.
  They cover exact/ambiguous matches, unit changes, resolved↔unresolved CUSIP,
  undisclosed/zero/NULL values and shares, affiliation, restatement, notice-only,
  unkeyed, name fallback/whitespace, rank ties, top-N, zero concentration, and
  integers beyond SQLite square range. Same-group `INT64_MAX,+1,-1` fixtures for
  `value_usd` and clean-unit `ssh_prnamt` must each select the oracle and complete
  with final `INT64_MAX`. A one-period nonnegative position with shares
  `INT64_MAX,+1` must also select the oracle and complete because that share total
  is never projected. In-range zero/positive versions select bulk and remain
  byte-identical to the standalone oracle.
- **R12 — Exact diagnostics.** T0 obtains aggregation statements from production,
  not a hand-copied query dictionary. Baseline plans retain the oracle statements;
  materialized plans must name `_populus_inst_agg_input` plus the exact position/
  match indexes where applicable, include the exact two-field sign and share-limb
  eligibility statements, and must not select either old wide
  `ORDER BY h.cik, h.period_of_report, h.holding_id` scan. Trace proof asserts one
  cache CTAS and no per-holding destination INSERT loop.
- **R13 — Gates and honest stop.** After the final source edit run the focused and
  targeted adjuncts, `git diff --check`, all six canonical commands, and binding
  T0-v6 exactly. The 180-second per-phase bound, D1 exit-5 precedence, inclusive
  1.5 GiB R12 threshold, widest-window serialization, and tail limits remain
  fixed. Any nonzero T0-v6 or new pathology stops for another owner-reviewed
  delta; no threshold, timeout, compression, schema, or in-run remedy is allowed.
  A forced slow destination statement and a forced commit-boundary expiry must
  each prove the same aggregate STOP/exit-4/later-phase-suppression behavior as a
  slow source statement.
- **R14 — Independent QA.** Only exit-zero T0-v6 permits fresh Dev Notes and the
  canonical complete QA bundle. A separate read-only QA reviewer may return PASS
  or grounded changes. The main agent batches fixes, invalidates and rebuilds all
  evidence, and resubmits for at most three QA rounds.

## Scope

The delta is limited to the existing institutional materializer, aggregate
builder, exact-query measurement harness, executable proofs, retained T0 findings,
and workflow evidence. The cumulative QA candidate also contains the preserved
parent M2-11 changes already present against HEAD; their authority comes from the
parent plan and approved predecessor deltas, not from this delta.

The sole non-worktree write is a new append-only log:
`/Users/johnbaek/projects/Populus-ops/snapshots/evidence/m2-11/T0-v6.log`.
Snapshot v1 is read only with `mode=ro&immutable=1`.

## Non-goals

- no persistent view, schema, index, `ANALYZE`, migration, snapshot v2, or source
  repair
- no change to affiliation, restatement, NEW_HOLDINGS, cover tolerance, filing
  population, QoQ identity/classification, issuer identity, concentration, NULL,
  flag, rank, digest, or artifact meaning
- no change to `inst_agg.sql`, `inst_serving.py`, publication topology, route,
  field, dependency, config, CLI option, timeout, R12, compression, or tail limit
- no writable ATTACH, second snapshot connection, source COMMIT/re-BEGIN, or
  relaxation of the single R16 transaction
- no full-corpus Python holdings dictionary/list, generic SQL builder, persistent
  cache, reusable cache service, or speculative parallel artifact
- no Phase D, commit, staging, push, PR, deployment, or worktree operation

## Constraints

- Work only in
  `/Users/johnbaek/projects/Populus-m28/.claude/worktrees/m2-11` on branch
  `feat/run-m2-11-inst-publish`; preserve HEAD and all dirty state.
- Use `apply_patch` for repository edits. Never reset, checkout over, stage, or
  delete user-owned changes.
- Before implementation and every review round, re-check branch, HEAD, plan and
  parent digests, T0-v5 digest, findings digest, snapshot identity, and pinned
  source/test hashes. Any unexplained drift requires rebaseline and re-review.
- All TEMP identifiers, SQL fragments, batch sizes, and table lists are fixed
  internal constants. Values stay parameterized; dynamic closed-set identifiers
  retain the repository's `# nosec B608` convention.
- No SQLite function or aggregate is registered. Exact name normalization occurs
  in fixed Python batches between SQL stages; exact big-integer square recovery
  occurs once per filer-period from native integer limbs. Tests prove the source
  and destination `pragma_function_list` are identical before/after success,
  failure, and repeated entry, including preservation of caller UDFs.
- Every source repair invalidates targeted results, canonical gates, T0,
  findings, Dev Notes, QA report, diff, manifests, and prior QA verdict.
- Plan review is read-only and may run at most three rounds. QA review is
  read-only and may run at most three rounds. The main agent alone applies fixes.

## Current State

Immutable provenance at plan authoring:

- branch: `feat/run-m2-11-inst-publish`
- HEAD: `7391d947f72cf408a173f1e7938102608b2269d4`
- parent approved plan SHA-256:
  `2fbded25f34ef40744d7aeb000d2afc5b02851ef35d91b133665b84b8fc80071`
- T0-v5 path:
  `/Users/johnbaek/projects/Populus-ops/snapshots/evidence/m2-11/T0-v5.log`
- T0-v5 SHA-256:
  `b3900103b66ca2b7aa694722050f355f171e3aebc1c56a4be87dbd48e2c18b39`
- current findings SHA-256:
  `76a867310c5ccb2cc754ddc6a366bbdb2a81e2b57896eab067fb59376bcba9d6`
- snapshot v1: 23,058,628,608 bytes, mode 0444, SHA-256
  `977a4d249d92590a4de2961a3e9c7ff8cfa2e4846f0097ec7aa6c07f28124121`,
  no journal/WAL/SHM sidecars
- pinned implementation hashes:
  - `src/populus/amendments.py`:
    `abf8b75702fda0f8149f78be80c164517101d8ced8bdd62eec551659576d2889`
  - `src/populus/inst_agg.py`:
    `b5de6dbfcc720f53ff8355316f11fdd43a7eab77b7962669b40bd3292639cf44`
  - `scripts/measure_inst_derive.py`:
    `91061972788c50be34b02671ae26c720ae821cf9c013df8e52652a28b517b7c4`
  - `tests/test_inst_agg.py`:
    `10939bd8d15515dfbc122d9acf73b4f23f409c7c8da83815c802f82d8da6cb62`
  - `tests/test_inst_external_store.py`:
    `60c3da3cdd0e7a7d7a91808e83a89892824890b2a40fa27687120da98085e3af`
  - `tests/test_inst_snapshot_script.py`:
    `3e69a7bee5140787fef184bdcaa52a4aaf59eb9a81f5f1f9b4ef1b483ac85d77`

Binding T0-v5 evidence:

- all focused/targeted tests and six canonical gates passed
- diagnostic materialization: 50.767 s
- pilot aggregate: 53.058 s, 456,146,944 bytes, 3,915,038,720-byte peak RSS
- full run: `STOP: SQLite execution bound (180s) interrupted phase aggregate`
- D1: complete pre/post states equal; snapshot immutability PASS; exit 4
- R12, full artifact size/RSS, serving, and tail decisions remain unmeasured

Bounded read-only planning diagnostics, all against the same immutable snapshot:

| probe | observed result |
|---|---:|
| materialized default holdings count | 12,932,216 rows in 8.091 s |
| direct default position GROUP BY | 10,461,572 groups in 70.908 s |
| position CTAS + grain/CUSIP indexes | 74.367 + 6.030 + 5.084 = 85.481 s |
| all three QoQ match passes + counts | 9,482,028 rows; 121.551 s cumulative from position CTAS |
| narrow input CTAS | 16,302,461 rows, 12,932,216 default, 57.923 s |
| narrow input TEMP footprint | 548,706 × 4,096-byte pages = 2,247,499,776 bytes |
| raw value sign sweep | minimum 0; 0 negative rows in 39.726 s |
| raw share sign sweep | minimum 0; 0 negative rows in 40.778 s |
| position CTAS from narrow cache | 42.305 s; grouped share SUM completed; indexes 11.807 s |
| registry GROUP BY from narrow cache | 9,450 groups in 6.778 s |
| synthetic destination insert adjunct | 1,000,000 fifteen-column rows in 3.025 s |

These diagnostics prove topology and bounded components, not T0 success. They
made no repository/snapshot write and do not replace the binding run. A writable
ATTACH was empirically possible but rejected because it cannot satisfy R10's
single source transaction plus committed destination visibility.

## Detected Stack

- **Languages:** Python ≥3.12 at repository root; TypeScript/Astro under
  `dashboard/`; SQLite/JSON1 data processing.
- **Python runner:** `uv run …` / `.venv/bin/python`; `uv.lock` is present.
- **Node runner:** npm via `dashboard/package-lock.json` and package scripts.
- **Tests:** pytest; Node's built-in test runner; Astro check/build/post-build.
- **Canonical commands:** `make check`, `make accept-m1-b`, `make accept-m2-5`,
  `make accept-m2-6`, `make accept-m2-8`, `make accept-m2-11`.
- **Data boundary:** immutable SQLite snapshot opened once with
  `mode=ro&immutable=1`; derived aggregate/serving databases are separate files.
- **Network:** none in diagnostics, aggregate build, tests, or T0.

## Reuse Map

The required full-tree scan included Markdown and excluded only generated/vendor
trees. It found the complete consumer set across `inst_agg.py`, `inst_agg.sql`,
`inst_serving.py`, publish/build, CLI, MCP, dashboard adapters, acceptance scripts,
and aggregate/external-store/snapshot tests.

| Need | Reuse decision | Evidence/rationale |
|---|---|---|
| verified frozen populations | extend `materialized_inst_derivation_views` | Existing owner of verified TEMP lifecycle at `amendments.py:243-357`. |
| aggregate schema/destination | reuse unchanged | `inst_agg.sql`; existing DDL/commit path at `inst_agg.py:668-713`. |
| semantic oracle | preserve current builder | `_Position`, `_match_periods`, `_qoq_row`, `_issuer_rows`, `_concentration_rows` already encode reviewed meaning. |
| position/issuer identity | reuse helpers | `_position_key`, `_issuer_key`, `_norm_issuer_name` at `inst_agg.py:61-124`; serving imports the same helpers. |
| coverage/frozen totals | reuse, no edits | Approved totals path remains authoritative and supplies namespace membership. |
| destination batching | extend existing `executemany` pattern | Same destination tables/placeholders; fixed `fetchmany` batches replace full lists. |
| digest/parity proof | extend existing tests | `test_inst_external_store.py:511` already compares both artifact digests and complete serving projection. |
| exact T0 planner | extend production-selected query mechanism | `measure_inst_derive.py:292-301` already merges production coverage statements into EXPLAIN. |
| timeout/D1/R12/tail | reuse unchanged | `measure_inst_derive.py:171-222,361-430` owns bounds and immutable evidence. |

No second aggregate module, schema, artifact, cache service, destination format,
classifier, identity helper, or test fixture is introduced.

## Architecture

### A. Verified narrow cache

After the current frozen reconciled/reported/default/totals objects exist, the
materializer performs one main-holdings scan joined to frozen reported/default
filing IDs and `main.securities`. The resulting `_populus_inst_agg_input` contains
only the thirteen R2 columns. It is connection-local TEMP and remains available
through coverage, aggregate, and serving, then is dropped with its owner scope.

### B. Exact path gate

`build_inst_agg` uses the existing Python oracle unless the complete exact owned
namespace is present and the owned cache has no negative `value_usd` or
`ssh_prnamt`. The optimized path never accepts cache-name presence alone. The sign
preflight is an exact production statement and runs before destination deletion/
staging. Partial/lookalike/signed corpora use the oracle. For a sign-eligible
corpus, the first position eligibility stage uses share limbs, not native share
SUM; any normalized position total above int64 cleans that stage and selects the
oracle before destination deletion. A successful stage becomes the bulk position
stage, avoiding duplicate grouping. This preserves arbitrary-precision signed
cancellation and unprojected huge-share behavior without exposing either to native
SQLite SUM.

### C. Bulk QoQ pipeline

The optimized path reuses the share-safe grouped eligibility/position table, adds
two explicit indexes,
creates filer period pairs with `LAG`, and records the three match passes in one
match table whose previous/current row IDs are unique in their respective roles.
The final SQL emits matched, new, and exit rows with the current PK grain. Fixed
batch transfer writes the existing destination schema. All internal stage names
are collision-checked and dropped even when SELECT, batch INSERT, destination
commit, or caller cancellation fails.

### D. Bulk registry, issuer, concentration

Registry rows and entity/CUSIP-6 issuer tiers are grouped/windowed in SQL over the
same narrow cache. SQL preaggregates only the weaker name-fallback records; a
fixed-size `fetchmany`/`executemany` bridge applies the existing
`_norm_issuer_name` to each bounded batch and loads a private TEMP stage. SQL then
merges share classes, ranks, and emits the final issuer rows. No SQLite callback
is created and no full fallback corpus is retained in Python.

Concentration first groups exact nonnegative position values and uses window
ranking for top-N/max. Native integer division and remainder produce seven
base-1000 limbs; SQL convolution produces thirteen coefficient sums. The fixed
population guard keeps every coefficient below INT64_MAX, and Python reconstructs
the arbitrary-precision square sum only once per filer-period before exact floor
division. No holding/position crosses a Python aggregate. Mixed-sign sources have
already selected the unchanged oracle at the path gate.

### E. Artifact and consumer boundary

The derived destination remains a normal separately committed `inst_agg.db`.
Logical digest, serving projection, watermarks, R12 size, and tail serialization
run exactly where they do today. The source connection is never committed,
reopened, attached writable, or queried outside its existing transaction.

## Locked Decisions

1. **Use one narrow TEMP input cache, not a wide holdings copy or persistent
   cache.** It empirically occupies 2,247,499,776 TEMP bytes and is deleted on
   scope exit.
2. **Keep the persistent Python path as compatibility oracle.** Only the complete
   owned materialized namespace with no negative value/share and no out-of-int64
   position share total selects bulk SQL. Partial, lookalike, signed, or huge-share
   inputs select the oracle before destination mutation; both signed-cancellation
   fixtures and the unprojected huge-share fixture are hard tests/gates.
3. **Destination stays separate and committed.** No writable ATTACH or source
   transaction split is permitted.
4. **QoQ matching order is immutable.** Exact grain, unique unit transition,
   unique resolved↔unresolved CUSIP; no alternative identity inference.
5. **No SQLite float for concentration.** Arbitrary-precision square sums and
   integer floor division remain exact through the fixed seven-limb/thirteen-
   coefficient representation and its explicit overflow guard.
6. **Use fixed-size streaming batches.** No full-corpus source/destination list;
   batch size is internal, fixed, and test-covered, not configuration.
7. **T0-v6 is binding.** Diagnostics and pilots never authorize QA. Any nonzero
   result, including a likely R12 size stop, requires another owner-reviewed delta.
8. **Maximum review rounds remain three each.** Separate agents review; the main
   agent fixes.
9. **Register no SQLite scalar/aggregate data callbacks.** Name fallback uses a
   bounded Python bridge; concentration uses native integer limbs. The private T0
   progress handler is an execution-control callback, not a SQL data function.
   Caller function registries stay byte-for-byte observable-equivalent across
   success, failure, and re-entry.
10. **One T0 deadline owns both connections.** A monotonic guard combines progress
    handlers, an interrupt timer, and explicit checkpoints through destination
    commit; the timeout value and exit mapping do not change.

## Alternatives Considered

- **Remove only the two `ORDER BY` clauses:** rejected; 16.3M rows still cross
  Python twice and the 500-filer object graph already reaches 3.9 GB RSS.
- **Writable ATTACH and `INSERT … SELECT`:** rejected; committed aggregate bytes
  would not be visible to digest/serving without ending the single R16 source
  transaction.
- **Second immutable snapshot connection:** rejected; violates the open-once and
  one-transaction contract.
- **COMMIT/re-BEGIN around aggregate:** rejected; immutable bytes do not waive the
  literal reviewed transaction invariant.
- **Persist indexes/cache or cut snapshot v2:** rejected; expands the approved
  source artifact and migration scope.
- **SQLite REAL HHI:** rejected; can cross integer floors and change digest bytes.
- **Python `sqlite3` square-sum aggregate:** rejected after round-1 review proved
  `step()` is invoked once per position (about 10.46 million callbacks), not once
  per filer-period.
- **Temporary source normalization/square UDFs:** rejected; Python sqlite3 cannot
  restore an arbitrary caller callback and unregistering leaves observable
  callable-name tombstones in `pragma_function_list`.
- **Source-only progress handler:** rejected; it cannot interrupt the separate
  destination batches or reliably enforce the commit boundary.
- **Reject or reinterpret negative values:** rejected; the parser and Python
  oracle accept signed integers. The explicit pre-bulk compatibility fallback
  preserves that contract rather than forcing native overflowing `SUM`.
- **Exact signed-limb SUM at every grouping tier:** rejected for the measured
  nonnegative snapshot because it would duplicate carry/reconstruction machinery
  across position, registry, issuer, and concentration sums. The oracle is the
  smaller exact compatibility path for the unmeasured signed case.
- **Native nonnegative share SUM after sign gating:** rejected after round-3
  review; a position total can exceed int64 yet remain unprojected, allowing the
  oracle artifact to complete. The reusable share-limb eligibility/position stage
  detects that case without overflow and routes it to the oracle.
- **Full SQL replacement for all callers:** rejected for this bounded delta; the
  persistent oracle protects standalone compatibility and makes parity measurable.
- **Raise 180 seconds or pre-decide R12 from estimates:** rejected; both hide the
  empirical gate this work exists to reach.

## Planned Files

- `docs/build/RUN-M2-11-T0-aggregate-performance-delta-plan.md` — this plan and
  review resolution notes only.
- `src/populus/amendments.py` — narrow aggregate input constant/CTAS, 13-name
  ownership, creation ordering, cleanup, and docstring.
- `src/populus/inst_agg.py` — exact namespace predicate, bounded TEMP stages,
  bulk/streamed aggregate path, fixed name-normalization bridge, exact integer-
  limb concentration, optional private deadline registration, fallback selection.
- `scripts/measure_inst_derive.py` — production-selected aggregate statement
  EXPLAIN/trace names and shared source/destination deadline guard; no timeout,
  threshold, or phase-order change.
- `tests/test_cover_tolerance.py` — thirteen-name collision/setup/body/cleanup and
  exact cache row/default-membership parity.
- `tests/test_inst_agg.py` — complete oracle/bulk table/report/digest parity and
  QoQ/issuer/concentration edge/failure tests.
- `tests/test_inst_external_store.py` — immutable transaction, cache trace, full
  aggregate/serving digest/projection parity, cleanup.
- `tests/test_inst_snapshot_script.py` — exact production aggregate plans, forced
  timeout/stop, T0-v6 ladder and unchanged thresholds.
- `docs/build/RUN-M2-11-T0-findings.md` — append-only T0-v6 evidence and decision.
- `docs/build/RUN-M2-11-devnotes.md` — fresh dev-notes-v1 only after exit-zero T0.

No `inst_agg.sql`, `inst_serving.py`, publish/build, manifest, dashboard, dependency,
configuration, workflow, or snapshot file is planned for modification.

## Implementation Tasks

### Phase 0 — approval and fresh baseline

- **T1 [R1, R13, R14]:** Validate this plan as plan-v1, obtain independent
  plan-review approval within three rounds, pin the approved digest, branch/HEAD,
  parent/finding/T0/source hashes, snapshot mode/size/hash/sidecars, and dirty tree.
- **T2 [R1, R2, R10, R13]:** Re-run only bounded read-only anchor checks needed
  for implementation; no new architecture experiment may widen the approved plan.

### Phase 1 — verified aggregate input

- **T3 [R1, R2, R3]:** Extend the materializer registry and create the exact
  thirteen-column input CTAS after verification/frozen filing tables, record it in
  `created_objects`, preserve three-object early drop, and update body/cleanup docs.
- **T4 [R2, R3, R4, R11]:** Add cache row/default-membership/column/type parity,
  thirteen collisions, every setup prefix, body visibility, freeze, and transient
  cleanup-failure tests.

### Phase 2 — bounded aggregate path

- **T5 [R4, R5, R6, R7]:** Add the exact namespace plus two-field cache-sign
  predicate, the guarded seven-limb share eligibility/position stage, and
  collision-safe period/match staging with all three matching passes and
  unconditional cleanup. Retain the current path verbatim as fallback oracle;
  prove signed detection occurs before any stage/destination mutation, huge-share
  detection cleans only its stage before destination mutation, and a successful
  eligibility stage is reused rather than regrouped.
- **T6 [R7, R10]:** Implement final QoQ SQL and fixed-batch transfer to the
  unchanged destination, including canonical flags and report counts; register
  the destination with an optional private deadline guard immediately after open;
  prove no full list and no writable source attachment.
- **T7 [R8, R9, R10]:** Implement registry, issuer ranking, and exact integer
  concentration over the narrow cache; add the SQL-preaggregated fixed-batch
  normalization stage and seven-limb/thirteen-coefficient square-sum queries,
  overflow guard, reconstruction, and unconditional stage cleanup without
  registering a SQLite callback.
- **T8 [R5, R6, R7, R8, R9, R11]:** Add complete row/report/digest parity and all
  named semantic boundary/mutation tests, including values beyond 64-bit square
  range, all nonnegative limb boundaries, exact coefficient-population refusal,
  separate value/share `INT64_MAX,+1,-1` oracle routing/parity, the one-period
  nonnegative `INT64_MAX,+1` unprojected-share success, unchanged caller UDF
  registries, repeated entry, and every failure/cleanup path.

### Phase 3 — exact diagnostics and gates

- **T9 [R4, R10, R12, R13]:** Make EXPLAIN consume the exact production aggregate statements;
  extend trace assertions for one input CTAS, cache/index selection, match order,
  the two-field sign/share-limb eligibility statements, stage reuse, batched
  destination writes, integer-limb SQL, and absence of old wide ordered scans.
  Replace the source-only phase helper
  with the shared monotonic guard and
  prove source, slow destination statement, and commit-boundary expiry all map to
  the same aggregate STOP, exit 4, cleanup, and later-phase suppression.
- **T10 [R11, R12, R13]:** Run focused pytest, then the exact targeted adjunct:
  `PYTHONDONTWRITEBYTECODE=1 .venv/bin/python -m pytest -q tests/test_inst_agg.py tests/test_cover_tolerance.py tests/test_inst_external_store.py tests/test_inst_snapshot_script.py tests/test_inst_serving.py tests/test_inst_serving_artifact.py tests/test_publish.py tests/test_amendments.py`.
- **T11 [R13]:** After the final source edit run `git diff --check`, `make check`,
  `make accept-m1-b`, `make accept-m2-5`, `make accept-m2-6`, `make accept-m2-8`,
  and `make accept-m2-11`, each as a separate command with its exit retained.
- **T12 [R10, R11, R12, R13]:** Run binding T0-v6 exactly, retain the complete
  unbuffered log, verify D1 and snapshot sidecars/hash, and append gates, counts,
  plans, timings, artifact bytes, RSS, R12/tail decision, log identity, and exit.

### Phase 4 — independent QA loop

- **T13 [R13, R14]:** Only after exit-zero T0-v6, write/validate fresh
  dev-notes-v1 and build the canonical current QA-only bundle with plan, changed
  files, redacted baseline diff, gates, QA report, provenance, and preservation
  tokens.
- **T14 [R11, R13, R14]:** Submit to a separate qa-review agent. If it returns
  changes, the main agent batches all grounded fixes, reruns affected focused
  tests plus the full targeted/six-gate/T0 sequence, rebuilds every freshness
  token, appends a new T0 log suffix without overwriting evidence, and resubmits.
  Stop after PASS or three total QA rounds.

## Testing Strategy

### Focused development tests

- Namespace: all thirteen materializer names; exact ten body objects; collision at
  every name; setup failure after every creation; one transient cleanup failure
  still removes peers; persistent and caller TEMP objects are never dropped.
- Cache: complete row equality with frozen reported holdings plus security join;
  exact `is_default`; unkeyed token present only for identifier-less rows; NULLs,
  integers, and text preserved.
- Path gate: complete namespace plus nonnegative value/share and in-range grouped
  shares chooses bulk; every one-object deletion, lookalike schema/caller cache,
  any negative value/share, or out-of-int64 position share chooses the oracle at
  the specified pre-destination boundary. Both signed cancellation fixtures and
  the unprojected huge-share fixture complete exactly.
- QoQ: exact, unit transition, CUSIP bridge, resolved/resolved non-bridge,
  ambiguity, notice gap, LONG/PUT/CALL, SH/PRN/UNKNOWN, NULL/zero value, NULL shares,
  share-limb boundaries/carries/overflow, zero delta classification, flag
  combinations and PK uniqueness.
- Issuer: entity/CUSIP-6/name tiers, Unicode/multiple whitespace normalization,
  fixed-batch name stage, share-class sum before rank, ties by CIK, exact top-N,
  token counts and flags; no function-list change or caller UDF replacement.
- Concentration: raw counts, deduped position grain, NULL values, real zero,
  notice-only, exact top-N/max/HHI, every nonnegative base-1000 limb/carry boundary,
  population-overflow refusal, huge integer square, one reconstruction per filer-
  period, signed-oracle routing, and no float or Python aggregate callback.
- Failures: stage collision, SELECT interrupt, batch INSERT failure, destination
  commit failure, deadline before/during/after destination commit, normalization-
  bridge failure, DROP retry, repeated entry, and fallback safety.

### Parity tests

For each semantic corpus, build once outside materialization and once inside it.
Compare `InstAggReport`, every row/column in all five destination tables ordered by
PK, aggregate logical digest, serving logical digest, and complete projection.
The existing real Berkshire oracle remains independent and must pass unchanged.

### Binding commands

Run after the final source edit, never substitute partial helpers:

```bash
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

Binding T0-v6, with no build date and no `tail` pipe:

```bash
mkdir -p /Users/johnbaek/projects/Populus-ops/snapshots/evidence/m2-11
set -o pipefail
PYTHONDONTWRITEBYTECODE=1 .venv/bin/python -u scripts/measure_inst_derive.py \
  --snapshot /Users/johnbaek/projects/Populus-ops/snapshots/inst-source-v1.db \
  --measured-files 8106 \
  --pilot-filers 500 \
  --full 2>&1 | tee \
  /Users/johnbaek/projects/Populus-ops/snapshots/evidence/m2-11/T0-v6.log
```

## Verification Matrix

| Requirement | Objective proof |
|---|---|
| R1 | stale/missing view fails before cache/data read/destination; trace ordering |
| R2 | exact cache columns/count/rows/default membership/unkeyed token |
| R3 | thirteen collisions, ten body objects, all setup/drop failures clean |
| R4 | complete sign/share-range-eligible namespace selects bulk; all other cases oracle |
| R5 | exact share-limb eligibility/position reuse, indexes, memory, cleanup/fallback |
| R6 | exact three-pass match rows/order and gap/ambiguity negative tests |
| R7 | every QoQ row/flag/value equals oracle; fixed batches; no full list |
| R8 | registry/issuer rows, ranks, names, counts and flags equal oracle; no callback residue |
| R9 | bulk nonnegative limb parity/guard/huge squares/zero/NULL; signed oracle parity |
| R10 | separate commit; one source handle/transaction; shared deadline; no writable ATTACH |
| R11 | reports, all tables, both digests, and projection complete equality |
| R12 | production-selected EXPLAIN/trace and no old wide ordered scan/per-row INSERT |
| R13 | focused/targeted/diff/six gates/T0-v6; source/dest/commit timeout stops; honest exit |
| R14 | fresh canonical bundle and separate QA PASS within three rounds |

## Rollout / Rollback

- **Rollout:** there is no deployment in this delta. The only candidate behavior
  change is internal selection inside the verified materialized namespace.
- **Failure before/at destination commit:** interrupt/close/remove the partial or
  just-committed derived file, clear deadline handlers/timer and internal stages,
  let the materializer clear its cache, and retain the original exception. The
  immutable source and both connections' function registries remain untouched.
- **Fallback:** standalone and partial namespace calls continue through the current
  path. This is compatibility, not an automatic T0 timeout fallback; a materialized
  bulk-path failure must fail loudly.
- **Rollback:** revert only this delta's source/test/doc edits. The prior approved
  coverage-totals state and T0-v5 evidence remain valid; derived artifacts are
  disposable and regenerate from the immutable snapshot.
- **T0 failure:** append evidence, use zero QA rounds, and stop. Do not raise bounds,
  tune SQLite unsafely, compress, alter schema/semantics, or overwrite T0-v6.

## Simplicity Audit

Minimum coherent change: one new TEMP cache in the existing materializer; one
private optimized branch in the existing aggregate builder; extensions to the
existing measurement and test modules; no source file/module/schema/artifact.

Planned new private symbols are limited to fixed cache/stage/query constants, one
exact namespace predicate, one fixed-batch transfer helper, one bulk aggregate
driver, one fixed-batch name-normalization bridge, fixed share-sum and concentration
integer-limb SQL/recovery, and one private shared deadline guard used by T0.
Existing identity/classifier/oracle helpers remain.
No new public function, class, dataclass, CLI, config, dependency, table, manifest
field, route, or consumer is introduced.

Rejected abstractions are a generic query builder, cache manager, plugin, artifact
writer framework, second aggregate module, parallel schema, and configurable batch
or timeout. Private helpers may be split only when directly required for cleanup
or tests; any unplanned public symbol is scope drift and requires re-review.

## Tech Debt Introduced

1. **TD-A1 — dual persistent/bulk implementations.** Impact: QoQ/issuer/
   concentration semantics now have an optimized SQL representation beside the
   established Python oracle; its name bridge and limb convolution are additional
   private representations of the same rules. Mitigation: complete table/report/
   digest/projection equality on every semantic fixture and immutable pilot;
   limb/overflow/callback-registry mutation tests; exact production SQL evidence;
   no public selection knob. The explicitly data-dependent signed-value/share and
   out-of-range-position-share fallback retains the memory-heavy oracle for
   anomalous corpora but preserves the existing parser/numeric contract; snapshot
   v1 has zero signed rows and the measured position grouping completed in range.
   Removal: retire the
   oracle only after a separately reviewed artifact-version cycle supplies exact,
   bounded signed accumulation at every SQL grouping tier for all callers.
2. **TD-A2 — 2.25 GB TEMP working cache.** Impact: materialization consumes bounded
   local scratch space proportional to reported holdings. Mitigation: existing
   30 GiB free-disk/8 GiB free-RAM T0 gates, narrow fixed columns, connection-local
   cleanup, no persistence, measured 2,247,499,776 bytes on snapshot v1, and one
   linear two-field sign scan before reusable share-limb position work. Removal:
   a future reviewed streaming/attached-destination design that preserves the one
   source transaction and committed destination visibility.

Pre-existing debt, not introduced here: the full artifact may exceed R12's 1.5 GiB
inclusive threshold; T0-v6 must measure and stop honestly. Existing npm audit
advisories, top-N cut, and persistent packaged-view cost remain outside scope.
No SQLite callback tombstone, per-position Python aggregate, source-only deadline,
TODO, stub, disabled test, ignored exception, timeout waiver, float approximation,
or hidden fallback is authorized.

## Memory Touch-Points

The deterministic selector used keywords `aggregate`, `sqlite`, `performance`,
`materialization`, `institutional`, `coverage`, `plan`, and `gate`, and returned:

- `feedback_gate_list_completeness.md` — exact full gate list in T11/testing.
- `feedback_plan_development_vs_execution.md` — execute only after review; do not
  reopen already locked parent decisions.
- `feedback_dependency_gate_landed_code.md` — anchors use current live materializer,
  aggregate builder, tests, and T0-v5, not predecessor prose alone.
- `feedback_full_tree_gate_scope.md` — `make check` and every standing acceptance
  target remain canonical.
- `feedback_gate_first_before_read_not_dependency.md` — R1 places verification
  before the first main-data read, not merely before cache construction completes.
- `feedback_gate_function_exit_codes.md` — T0 exit remains binding/nonzero on STOP.
- `feedback_honest_gate_miss_reporting.md` — R12 or later misses are reported,
  never tuned away.
- `feedback_phase_gate_discipline.md` — a new phase failure becomes a distinct
  owner-reviewed delta.
- `feedback_plan_decision_lock.md` — all implementation choices are locked here.
- `feedback_executable_plan_wiring.md` — every rule is carried through tasks,
  verification, and DoD.

The mandatory failure-mode catalog was also loaded. It shaped full consumer
enumeration, fixed identifiers, high-cardinality bulk SQL, failure cleanup,
freshness invalidation, complete gate scope, and separate review.

## Failure-Mode Sweep

| Catalog item | Prevention and executable proof |
|---|---|
| F0 full-set sweep | Reuse scan covers aggregate schema, CLI, publish, serving, MCP, dashboard, scripts, tests, and docs; only producer/materializer/test seams change. |
| F0 secrets | No network, credential, environment dump, or secret-bearing output. |
| F0 verify, do not assume | Real snapshot counts/timings/cache bytes/match totals measured; binding T0 still required. |
| F1 all consumers/gates | Planned files and six commands are exact and complete. |
| F1 units/NULL | R5-R9 define integer, NULL, zero, absent, unit, value, rank, and flag semantics. |
| F1 locked decisions | Ten decisions select one exact path/fallback contract; no owner question remains. |
| F2 bulk high cardinality | SQL grouping/matching plus fixed batches; fail-if-feature-removed trace/performance tests. |
| F2 boundary tests | Cache, both signed fields, unprojected huge shares, limb/overflow, name bridge, match, batch, deadline, cleanup, and destination failures are enumerated. |
| F2 stale comments | Module/query comments and measurement labels must describe conditional oracle/bulk paths. |
| F3 end-to-end function | Full T0 proves immutable snapshot → aggregate → serving → R12/tail, not liveness. |
| F3 doc-number reconciliation | Findings append uses exact logs, hashes, counts, timings, exits, and current source. |
| F4 propagation | Any review fix is grep-swept across requirements, tasks, matrix, DoD, tests, and evidence. |
| F4 QA batching | All grounded QA findings are fixed in one batch before re-gating/re-review. |
| F5 artifact freshness | Any source edit invalidates every gate, T0, findings, Dev Notes, QA report, diff, manifest, and verdict. |

## Definition of Done

- [ ] **R1** verification precedes every cache/main-data read and destination write.
- [ ] **R2** exact narrow cache content/columns/default membership are proven.
- [ ] **R3** thirteen-name ownership, ten-object body, and complete cleanup pass.
- [ ] **R4** exact namespace/two-field-sign/share-range gating selects bulk only
  for eligible inputs; all fallback cases preserve the oracle before destination
  mutation and before any stage except the cleaned share-range eligibility stage.
- [ ] **R5** guarded share-limb eligibility becomes the reused bounded position
  stage, and signed/huge-share oracle fixtures reproduce exact state and cleanup.
- [ ] **R6** all three match passes and adjacency/ambiguity behavior are exact.
- [ ] **R7** complete QoQ values/classes/flags equal oracle with fixed batching.
- [ ] **R8** registry/issuer parity and fixed name batches pass with no callback residue.
- [ ] **R9** exact nonnegative limb reconstruction/guard and integer/NULL parity
  pass, signed cancellation routes through the oracle, and huge squares use no
  per-position Python callback.
- [ ] **R10** destination commits separately under the same monotonic T0 deadline;
  source remains one handle/transaction and all timer/handler cleanup passes.
- [ ] **R11** report, all tables, both digests, and complete projection are identical.
- [ ] **R12** production-selected EXPLAIN/trace proves cache/index path and no old scan.
- [ ] **R13** focused/targeted/diff/six gates pass; forced source/destination/commit
  expiries stop identically; T0-v6 exits 0 with complete D1, timings, sizes, RSS,
  R12, and tail evidence, or findings record STOP.
- [ ] **R14** only after T0 exit 0, fresh artifacts receive separate QA PASS within
  three rounds; all fixes are applied only by the main agent.
- [ ] Snapshot v1 remains 23,058,628,608 bytes, mode 0444, exact SHA-256, and
  sidecar-free; no commit/stage/push/PR/deploy/worktree action occurred.

Implementation begins only after independent `plan-review` returns
`VERDICT: APPROVED` for the exact final digest.
