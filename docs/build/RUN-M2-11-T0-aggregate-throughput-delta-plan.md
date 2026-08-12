# RUN M2-11 T0 full-corpus aggregate-throughput delta (plan-v1)

**Artifact:** plan-v1 delta · **Transport:** interactive-disk · **Status:** OWNER
AUTHORIZED; READY FOR INDEPENDENT REVIEW; implementation remains prohibited until
review approval · **Date:** 2026-08-10 · **Parent:** approved repeated-materialization
reuse delta at
`docs/build/RUN-M2-11-T0-materialization-reuse-delta-plan.md`, SHA-256
`232bdb66d5ef3e21054b252a8d26e3ddf06edfffad044d0c68216090f4dbbcf1` ·
**Base:** `feat/run-m2-11-inst-publish` at
`7391d947f72cf408a173f1e7938102608b2269d4` plus the preserved cumulative M2-11
implementation and append-only T0-v7 finding · **Scope class:** L/high-risk exact
high-cardinality SQLite derivation.

T0-v7 proved the materialization-reuse delta and every non-binding gate, then
stopped honestly when the full aggregate exceeded its unchanged 180-second phase
deadline. The full materialized namespace was built once in 44.422 seconds, the
500-filer pilot aggregate completed in 47.568 seconds, and the certifying full
aggregate was interrupted at 180 seconds. No full aggregate artifact, R12 result,
serving result, or tail result was produced. Snapshot immutability passed.

This delta changes only the already-selected exact bulk aggregate path. It does not
move work into materialization, extend a deadline, weaken durability, alter a
filing/holding population, change the aggregate schema, compress an artifact, or
change any logical output. The existing Python implementation remains the semantic
oracle and compatibility fallback. The binding attempt will be the new append-only
`T0-v8.log`; a nonzero result stops before QA and requires another owner-reviewed
delta.

No stage, commit, push, PR, deployment, snapshot mutation, Phase D action, or
worktree operation is authorized.

Round-1 independent review found no architecture or semantic-parity blocker. It
found two executable-evidence defects, both resolved in this revision. First, the
binding command now carries the freshly reverified `--measured-files 8106` and
explicit `--pilot-filers 500`, and the preceding fresh dashboard build must report
that exact measured count before the one-shot command is permitted. Second, the
Memory Touch-Points section now records the exact canonical selector invocation
and only its five returned files, including explicit fallback-alert and
pre-existing-bulk-regating dispositions.

## Goal and Success Criteria

Make the full-corpus aggregate phase complete inside the existing inclusive
180-second SQLite execution bound while retaining exact row-for-row parity,
transactionality, cleanup, and immutable-source behavior.

Success means:

1. The full aggregate phase in binding T0-v8 completes in less than 180.000
   seconds without changing `SQLITE_PHASE_TIMEOUT_SECONDS` or progress-handler
   behavior.
2. The materialized bulk artifact has exactly the same five tables, columns,
   constraints, row populations, values, NULLs, integer types, ranks, flags,
   logical digest, and serving projection as the persistent-view Python oracle.
3. Signed value/share input and an out-of-int64 share group still select the
   Python oracle before destination mutation and retain arbitrary-precision
   cancellation behavior.
4. Source TEMP cache state, registered SQLite functions, transaction state, TEMP
   namespace, destination cleanup, and primary-error precedence are preserved on
   success, fallback, timeout, SQLite failure, commit failure, and re-entry.
5. Destination page size is exactly 32 KiB; its connection-local cache hint is
   256 MiB; journal mode and synchronous durability remain the fresh SQLite
   defaults observed before tuning. All large destination streams arrive in their
   declared primary-key order.
6. Focused tests, the complete targeted adjunct, `git diff --check`, all six
   canonical commands, and one new binding T0-v8 pass. The fresh `make check`
   dashboard build must measure exactly 8,106 files/pages, and the binding command
   must carry `--measured-files 8106 --pilot-filers 500`. Only an exit-zero T0-v8
   proceeds to fresh Dev Notes and independent QA review.
7. The exact final plan digest receives independent approval within at most three
   plan-review rounds, and a separate reviewer handles at most three QA rounds;
   the implementing agent fixes findings but never self-signs.

## Requirements

- **R1 — Existing bound, measured success.** The aggregate timeout remains
  `180` seconds with `10_000` progress opcodes. The same guard remains registered
  on both source and destination through destination commit. T0 success requires
  a reported full `aggregate_s < 180.000`; a diagnostic or pilot cannot satisfy
  this requirement.
- **R2 — Narrow bulk-path scope.** Only the complete owned materialized namespace
  may select this path. The sign preflight and seven-limb share eligibility stage
  stay before destination deletion. Partial/lookalike namespaces, any negative
  `value_usd`/`ssh_prnamt`, or an out-of-int64 position share total select the
  unchanged Python oracle. The persistent-view path is not tuned or rewritten.
- **R3 — Reversible cache geometry.** During an eligible bulk attempt, capture
  the exact integer returned by `PRAGMA temp.cache_size`, set the source TEMP cache
  suggestion to `-262144` KiB, and restore the captured value in `finally` before
  returning or invoking fallback. Do not change `temp_store`, main cache,
  `mmap_size`, spill policy, or any persistent source state. For the fresh
  destination only, issue `PRAGMA page_size=32768` before the first DDL statement
  and `PRAGMA cache_size=-262144`; assert both read back exactly. These statements
  must not set or relax `journal_mode`, `synchronous`, locking, or foreign-key
  behavior. Cache sizes are suggestions, not new user configuration.
- **R4 — One filer-period raw-statistics pass.** Replace the two full-input
  GROUP BY scans currently embedded in registry and concentration with one owned
  TEMP `_populus_inst_agg_raw_periods` stage keyed uniquely by
  `(cik, period_of_report)`. It stores exact `COUNT(*)`, non-NULL integer value
  sum with zero fallback, NULL-value count, and unkeyed count over every
  filer-reported input. Registry rolls those period rows up by CIK; concentration
  joins the same period rows. Notice-only periods still originate from the full
  filer-reported filing universe and receive zero rows through LEFT JOIN.
- **R5 — SQL-native, primary-key-ordered QoQ rows.** Preserve the current period
  pairs, position stage, and exact three matching passes unchanged. Replace the
  per-output-row `_FinalPosition`/`_qoq_row` Python transformation with a fixed SQL
  projection that reproduces all fifteen destination fields. It must preserve:
  absence as real zero; present-undisclosed as NULL; unit-compatible shares only;
  new/exit handling; shares-before-value classification; zero value delta as
  `add`; `unclassified` when neither metric can classify; and compact flags in
  exact lexical order. The query binds `ingested_at` as a value and ends with
  `ORDER BY cik, position_key, put_call, ssh_prnamt_type, curr_period`, the exact
  `agg_qoq_deltas` primary key. `_qoq_row` remains the oracle; no SQLite UDF or
  aggregate callback is registered.
- **R6 — Direct issuer-holder staging.** Replace the security/raw-name
  `_issuer_parts` stage plus second holder regroup with one owned
  `_populus_inst_agg_issuer_holders` stage at final
  `(cik, period, issuer_key, issuer_key_source)` holder grain. Entity and CUSIP-6
  inputs group directly with exact nonnegative integer value SUM,
  `COUNT(DISTINCT security_token)`, and `MIN(issuer_name_raw)`. Only the weak name
  fallback keeps the existing bounded Python `_norm_issuer_name` bridge; its
  normalized rows are grouped once into the same holder stage. Ranking remains
  value descending then CIK ascending, is cut at the same `topn`, and streams in
  `(issuer_key, period_of_report, rank)` primary-key order with unchanged names,
  counts, source labels, and flags.
- **R7 — One concentration reduction.** Keep the filer-reported concentration
  grain and exact nonnegative position CTAS. Build the existing row-number rank
  once, then compute top-N value, maximum value, and all thirteen square
  coefficients in the same `(cik, period)` reduction. Join R4 raw statistics and
  the complete period universe once. Python still reconstructs one arbitrary-
  precision square sum per filer-period and performs exact integer floor
  divisions. The coefficient population guard, zero-total NULLs,
  `concentration_unavailable`, and primary-key output order remain exact.
- **R8 — Ordered destination streams without schema change.** Registry,
  QoQ, issuer, concentration, and already-sorted build metadata must be inserted
  in their declared primary-key order. Keep `_BULK_BATCH_SIZE = 10_000` and the
  same parameterized `executemany` bridge. `src/populus/inst_agg.sql`, all table
  declarations, rowid organization, checks, primary keys, aggregate version,
  digest projection, serving schema, and publication format remain unchanged.
- **R9 — Exact numeric and population parity.** Registry and concentration use
  every filer-reported input; QoQ and issuer use only `is_default=1`. No
  affiliation, restatement, notice-only, NEW-HOLDINGS, cover tolerance, identity,
  unit, issuer fallback, concentration grain, rank, flag, or NULL behavior may
  drift. Native SUM is used only after the nonnegative gate; an overflow means a
  final projected integer cannot fit the unchanged SQLite destination. Signed
  cancellation remains exclusively in the Python oracle.
- **R10 — Ownership, timeout, and cleanup.** Extend the exact collision-checked
  owned TEMP registry for raw-period and issuer-holder stages; remove the replaced
  issuer-parts name. Every created table/index is dropped on success and all
  failure paths, with the existing retry sweep and primary-error precedence.
  Destination failure deletes the partial file. The deadline remains checkpointed
  before/after every source batch and destination write and registered on both
  connections. Source transaction ownership and the materializer's namespace are
  unchanged.
- **R11 — Fail-if-removed semantic tests.** Complete oracle-versus-bulk artifact
  comparisons must cover all QoQ classification/flag combinations, affiliation
  suppression versus filer-reported statistics, issuer share-class/name fallback
  merging, NULL/zero/unkeyed/notice periods, exact huge HHI, signed cancellation,
  and huge shares. Tests inspect values and types, not only counts or digests.
- **R12 — Fail-if-removed performance-contract tests.** Tests prove the exact
  destination page/cache statements precede DDL, journal/synchronous values are
  not changed, source TEMP cache is restored from both zero and a nondefault
  value, all four data SELECTs contain the exact PK order, QoQ transfer has no
  transform callback, raw input statistics are grouped once, issuer holders are
  not regrouped from a parallel parts stage, and concentration has one coefficient
  reduction. Success, fallback, injected source SELECT failure, destination batch
  failure, commit failure, timeout, cleanup retry, and repeated entry are covered.
- **R13 — Complete local verification.** After the final source edit run focused
  `tests/test_inst_agg.py`, the exact eight-module targeted adjunct, artifact-free
  `git diff --check`, then `make check`, `make accept-m1-b`,
  `make accept-m2-5`, `make accept-m2-6`, `make accept-m2-8`, and
  `make accept-m2-11` separately. Any failure is fixed and invalidates later
  evidence.
- **R14 — One append-only binding run.** Verify `T0-v8.log` is absent immediately
  before running the unchanged full ladder once with the immutable snapshot,
  freshly measured `--measured-files 8106`, explicit `--pilot-filers 500`, and no
  `tail` pipe. The immediately preceding final `make check` must independently
  report exactly 8,106 generated dashboard files/pages; any different fresh count
  replaces the stale premise only through a newly reviewed plan revision before
  T0, never by silently changing the command. Retain the complete unbuffered log,
  exit code, SHA-256, full
  aggregate time/bytes/RSS if reached, D1 state, snapshot hash/mode/sidecars, R12,
  serving, and tail results. Append—not replace—the T0-v8 decision to findings.
  Any nonzero exit, including a later R12/serving/tail stop, ends this delta before
  QA.
- **R15 — Fresh independent reviews.** Implementation starts only after exact-plan
  `VERDICT: APPROVED` within the owner-authorized maximum three independent plan
  rounds. Only exit-zero T0-v8 permits validated fresh Dev Notes, QA report,
  changed-file/diff/gate evidence, and a separate `qa-review` loop of at most three
  rounds. Any source repair invalidates all downstream evidence and review verdicts.

## Scope

In scope:

- optimize the existing materialized bulk path in `src/populus/inst_agg.py`;
- reuse the existing aggregate SQL schema unchanged;
- add exact parity, physical-setting, ordering, lifecycle, and failure tests in
  `tests/test_inst_agg.py`;
- run the standing targeted/canonical gates and one new binding T0-v8;
- append the measured decision to the existing findings file;
- create fresh workflow evidence only if T0-v8 exits zero.

Authorized write scope before exit-zero T0-v8 is exactly:

- `docs/build/RUN-M2-11-T0-aggregate-throughput-delta-plan.md`;
- `src/populus/inst_agg.py` after plan approval;
- `tests/test_inst_agg.py` after plan approval;
- append-only `docs/build/RUN-M2-11-T0-findings.md` after T0-v8;
- new append-only external evidence
  `/Users/johnbaek/projects/Populus-ops/snapshots/evidence/m2-11/T0-v8.log`.

Only after exit-zero T0-v8, fresh workflow artifacts may be added under
`docs/build/` for this delta's Dev Notes and QA report. No existing evidence log is
edited.

## Non-goals

- changing the 180-second bound, progress opcodes, resource thresholds, R12 limit,
  tail ceiling, exit mapping, or stop precedence;
- optimizing or changing the materializer, coverage, period coverage, serving,
  dashboard, publish, acceptance, snapshot, or production filing logic;
- adding source indexes, moving aggregate work into the materialization rung,
  using another snapshot connection, writable ATTACH, threads/processes, or
  committing the source transaction early;
- changing `inst_agg.sql`, using `WITHOUT ROWID`, removing/deferring primary keys,
  compressing or sharding the aggregate, changing page data logically, or claiming
  R12 success from a pilot;
- disabling journals, reducing `synchronous`, using WAL/MEMORY/OFF journal mode,
  exclusive locking, unsafe pragmas, floats, SQLite data callbacks, or unbounded
  Python lists;
- changing matching, identity, affiliation, issuer, concentration, digest, or
  serving semantics;
- committing, staging, pushing, opening a PR, deploying, or mutating/removing the
  shared worktree.

## Constraints

- Work in the existing dirty worktree and preserve every cumulative M2-11 change.
- HEAD stays `7391d947f72cf408a173f1e7938102608b2269d4`; any drift in a pinned
  source, test, plan, findings, log, or snapshot hash forces re-baselining and
  another plan review.
- Snapshot v1 remains 23,058,628,608 bytes, mode 0444, SHA-256
  `977a4d249d92590a4de2961a3e9c7ff8cfa2e4846f0097ec7aa6c07f28124121`,
  with no journal/WAL/SHM sidecar.
- T0-v7 remains immutable at SHA-256
  `4fcc42ac20934b2d4e72d6642e1f1e7ab0ed683942563734420ce3c08969f014`.
- T0-v8 is absent at plan time and may be created exactly once only after final
  gates and fresh verification of the 8,106 measured tree count. Diagnostics
  never reuse that filename.
- The optimized path operates inside the existing single source read transaction
  and separate destination transaction. The full materialized namespace remains
  retained from rung (iv), exactly as approved by the parent plan.
- Network access is unnecessary. No credential-bearing command/output is allowed.

## Current State

Pinned live files before this plan:

| Artifact | SHA-256 |
|---|---|
| `src/populus/inst_agg.py` | `041ab76a07a8d60c637f628ba03f07b1906826bace98bbb455f78957bfa05fea` |
| `src/populus/inst_agg.sql` | `7d4f0c2d1d39c2b7ceaf23ca325abfbec1138c1ac7286095e102cc522fa250f2` |
| `scripts/measure_inst_derive.py` | `d6f653de73f08f21d075a050d45b35ce979660b2408a36b53b0e9879dbb060d5` |
| `tests/test_inst_agg.py` | `84817a8228d7a58169ff96374a33754226561613cb2c04db0c0aa17ac99d6bdc` |
| `tests/test_inst_external_store.py` | `1aa2fa1ce65cb5fdce5e8706d05b4bb749f9e01fb8e3945fb06658e59c6e6fa0` |
| `tests/test_inst_snapshot_script.py` | `2f0941e86de9202eb558aa30a2766d6ca74e52fdf9e32ec2310716b509100482` |
| parent plan | `232bdb66d5ef3e21054b252a8d26e3ddf06edfffad044d0c68216090f4dbbcf1` |
| findings | `835bfd8a3ccb35d0050374ecc970079b485c29f695916ec74764d75eae0200c6` |

T0-v7 binding facts:

- materialization exactly once: 44.422 s;
- pilot: materialization 18.277 s, aggregate 47.568 s, serving 20.484 s,
  459,923,456 aggregate bytes, 742,412 filer rows, 2,175,156,224-byte peak RSS;
- full aggregate: interrupted at the unchanged 180-second bound;
- later full R12, serving, and tail phases: suppressed;
- D1 and snapshot immutability: PASS; process exit: 4.

The live bulk path at `src/populus/inst_agg.py:413-432,622-812,1237-1579`
currently:

1. groups 12,932,216 default inputs into 10,461,572 positions and creates two
   exact matching indexes;
2. runs the reviewed three-pass match stage and emits 9,482,028 QoQ rows;
3. transforms every QoQ output through Python and inserts it without PK order;
4. groups all 16,302,461 filer-reported rows once for registry and again for
   concentration raw statistics;
5. materializes issuer parts below final holder grain, then regroups them;
6. reduces concentration position statistics and square coefficients separately;
7. creates the destination at SQLite's 4 KiB page/default cache geometry.

Bounded read-only/disposable planning diagnostics against the same snapshot:

| Probe | Observed result |
|---|---:|
| direct full default position GROUP BY | 10,461,572 groups in 70.908 s |
| position CTAS + indexes + all three match passes | 9,482,028 matches/unmatched outputs; 121.551 s cumulative |
| Python `_qoq_from_bulk_row` CPU only | 1,000,000 calls in 1.736 s; about 16.5 s at full output count |
| current 500-filer stage profile | materialization 58.746 s; aggregate 74.664 s |
| current pilot aggregate components | positions 19.075; matches 3.433; registry 1.019; QoQ 19.100; issuer 15.582; concentration 14.064 s |
| runtime-only 32 KiB/256 MiB destination + PK-ordered QoQ | aggregate 52.814 s; QoQ 9.111 s; identical report counts |
| tuned pilot versus current pilot | 29.3% aggregate reduction; QoQ transfer 52.3% reduction |
| `WITHOUT ROWID` adjunct with the same tuning | aggregate 58.382 s; slower than 52.814 s, although bytes fell to 330,760,192 |
| live PRAGMA baseline | SQLite 3.50.4; source `temp.cache_size=0`, `temp_store=0`, compile `TEMP_STORE=1` |
| disposable fresh destination | before `(page=4096, cache=-2000, journal=delete, sync=2)`; tuned `(32768,-262144,delete,2)`; reopen `(32768,-2000,delete,2)` |

The diagnostics prove bounded component behavior and reject one alternative; they
do not prove full success and never substitute for T0-v8.

## Detected Stack

- **Languages:** Python ≥3.12 at repository root; TypeScript/Astro under
  `dashboard/`; SQLite/JSON1 derivation.
- **Python runner:** `uv run …` / repository `.venv`; `uv.lock` is present.
- **Node runner:** npm from `dashboard/package-lock.json`; Node ≥24.
- **Tests:** pytest, Node built-in test runner, Astro check/build/post-build.
- **Canonical commands:** `make check`, `make accept-m1-b`, `make accept-m2-5`,
  `make accept-m2-6`, `make accept-m2-8`, `make accept-m2-11`.
- **SQLite runtime:** 3.50.4, JSON1, `TEMP_STORE=1`; TEMP is file-backed under
  current `temp_store=0`.
- **Data boundary:** immutable SQLite source; connection-local TEMP stages;
  separate fresh derived aggregate database.
- **Stack cache:** repository `CLAUDE.md` is absent, so detection was refreshed
  from live manifests and runners.

## Reuse Map

The full-tree scan included Markdown and excluded only generated/vendor trees. It
covered aggregate producers, schema/digest/publish/serving/MCP/dashboard consumers,
acceptance scripts, and all aggregate/external-store/snapshot tests.

| Need | Reuse decision | Evidence/rationale |
|---|---|---|
| exact semantic oracle | preserve `_Position`, `_match_periods`, `_qoq_row`, `_issuer_rows`, `_concentration_rows` | `inst_agg.py:126-371,1128-1215`; every optimized fixture compares to this path |
| materialized input | reuse unchanged | `_populus_inst_agg_input` and selector at `inst_agg.py:434-470`; no second cache |
| match topology | reuse unchanged | `_create_match_stages` at `inst_agg.py:648-741`; not a measured dominant pilot stage |
| fixed batching/deadline | reuse `_stream_insert` and guard helpers | `inst_agg.py:473-487,793-812`; no new transfer framework |
| destination schema | reuse `inst_agg.sql` unchanged | existing columns/checks/PKs remain authoritative |
| issuer normalization | reuse `_norm_issuer_name` | `inst_agg.py:67-69`; no SQL or callback fork |
| exact HHI limbs | reuse `_square_coefficient_sql` and reconstruction | `inst_agg.py:1380-1440`; only merge two SQL reductions |
| parity proof | extend `_agg` complete artifact comparator | `tests/test_inst_agg.py:118-155`; compares both code paths table-by-table |
| timeout/D1/T0 | reuse unchanged ladder and guard | `measure_inst_derive.py:284-558,1200-1368`; no harness edit |
| logical/serving proof | reuse targeted external-store and serving tests | complete digest/projection consumers already exist |

No second aggregate builder, semantic helper, schema, callback, destination
format, cache service, test fixture module, or configuration surface is added.

## Architecture

### A. Eligibility and temporary cache scope

The existing namespace/sign/share gates run in the same order. After sign
eligibility, one private context captures `temp.cache_size`, sets the fixed 256
MiB suggestion, and owns the complete bulk attempt. A share-ineligible result
unwinds its position stage and cache scope before calling the Python oracle. The
context restores exactly the captured integer even if destination creation,
source SELECT, batch insert, commit, deadline, or cleanup fails.

### B. Shared filer-period statistics

One small final-grain TEMP table groups the filer-reported cache once. Registry
rolls it up by CIK; concentration joins it by CIK/period. The full filing universe
still owns zero-position rows, so the optimization cannot erase notice periods.
Its unique index is both a parity guard and the join path.

### C. SQL-native ordered QoQ transfer

The existing `pairs` union and position joins become a layered SQL projection:
first derive exact prior/current values and unit compatibility, then derive deltas,
then classification and five flag predicates, finally produce the fifteen
destination columns. Fixed flag fragments are concatenated in lexical order and
the trailing delimiter is removed; no JSON aggregation or Python object is needed.
The last operation sorts by the destination PK. `_stream_insert` receives the
cursor with `transform=None` and retains 10,000-row parameterized batches.

### D. Final-grain issuer holder stage

Entity/CUSIP-6 rows go directly from aggregate input to holder grain. Name-only
rows are preaggregated by raw name/security token, normalized through the existing
bounded bridge, then grouped once into that same holder table. The final ranking
window reads holder grain and outputs PK order. The removed parts table had no
consumer except the immediately following holder regroup.

### E. Single concentration reduction

The existing exact position CTAS and coefficient guard remain. One ranked CTE
feeds one group that calculates top-N/max and all thirteen coefficients together.
The final query LEFT JOINs filing periods, shared raw stats, and combined position
stats, orders by its PK, and lets the existing one-row Python reconstruction do
arbitrary-precision math.

### F. Fresh destination geometry

The separately committed destination is still a normal rowid SQLite database.
Before DDL, it receives a 32 KiB persistent page size and a 256 MiB connection-
local cache suggestion. Journal mode/synchronous are never written. All large
streams match their PK order, so primary-key B-trees grow sequentially. Commit,
close, attach-for-serving, digest, R12, and publication remain unchanged.

## Locked Decisions

1. **Use exactly the five optimizations in Architecture A-F.** No implementation
   option remains open in the task list.
2. **Keep match construction unchanged.** Pilot matching was 3.433 seconds and
   its semantics are heavily reviewed; speculative GROUP BY candidate tables are
   excluded.
3. **Keep the schema and rowid tables.** `WITHOUT ROWID` was empirically slower in
   the bounded tuned pilot and would conflate a size-layout delta with this target.
4. **Keep 10,000-row batches.** The existing bound is tested and the 50,000-row
   diagnostic did not demonstrate an aggregate improvement.
5. **Use 32 KiB pages and two separate 256 MiB cache suggestions.** The values are
   fixed internal constants, not configuration. They fit the existing 8 GiB free-
   RAM preflight with measured pilot RSS and preserve durability.
6. **Perform QoQ classification in fixed SQL, but retain `_qoq_row`.** The oracle
   is the parity anchor and fallback; no duplicate public classifier is created.
7. **Share only filer-period raw stats.** QoQ/issuer and concentration have
   intentionally different default-versus-reported populations and cannot share
   a position stage.
8. **No work moves to materialization.** Aggregate success must be real inside its
   own 180-second bound.
9. **T0-v8 is the sole binding performance result.** Any nonzero exit stops, even
   when aggregate performance succeeds but R12 or a later phase fails.
10. **Review limits remain three plan rounds and three QA rounds.** The owner did
    not authorize an exceptional extra round for this delta.

## Alternatives Considered

- **`WITHOUT ROWID` for PK tables:** rejected; the comparable tuned pilot slowed
  from 52.814 to 58.382 seconds. Its size benefit belongs to a separately owned
  R12/layout delta if ever needed.
- **Remove/defer PKs or build unique indexes later:** rejected; changes declared
  schema/constraint behavior and could hide duplicates.
- **Writable ATTACH and `INSERT … SELECT`:** rejected; destination commit would
  end the retained source transaction before serving and violate the approved
  single-snapshot lifecycle.
- **Second source connection or worker process:** rejected; TEMP materialization
  is connection-local and a second view of the source breaks transaction identity.
- **Source persistent/temporary covering indexes in materialization:** rejected;
  shifts aggregate work into another timed rung and greatly expands the 2.25 GiB
  TEMP lifecycle.
- **Change matching windows to GROUP BY/HAVING:** rejected; unmeasured complexity
  in a 3.433-second pilot component with high semantic risk.
- **Python-stream all concentration positions:** rejected; it would send roughly
  ten million additional rows through Python.
- **SQLite UDF/aggregate callbacks:** rejected; prior review proved per-row
  callbacks and registry tombstones are not an exact low-overhead lifecycle.
- **WAL, MEMORY/OFF journal, `synchronous=OFF/NORMAL`, exclusive locking, mmap,
  or in-memory TEMP:** rejected; unsafe/unbounded or unnecessary changes to
  durability/resource behavior.
- **Longer timeout or phase split:** rejected; the owner explicitly requires the
  existing 180-second aggregate bound.

## Planned Files

| File | Action | Purpose |
|---|---|---|
| `docs/build/RUN-M2-11-T0-aggregate-throughput-delta-plan.md` | add now | reviewed owner-authorized plan-v1 |
| `src/populus/inst_agg.py` | modify after approval | exact cache/order/QoQ/raw-stats/issuer/concentration throughput changes |
| `tests/test_inst_agg.py` | modify after approval | fail-if-removed parity, physical contract, lifecycle, and failure tests |
| `docs/build/RUN-M2-11-T0-findings.md` | append after T0-v8 | immutable log identity, result, decision, and stop discipline |
| `/Users/johnbaek/projects/Populus-ops/snapshots/evidence/m2-11/T0-v8.log` | add once after gates | complete binding evidence |
| `docs/build/RUN-M2-11-T0-aggregate-throughput-devnotes.md` | add only after exit-zero T0-v8 | validated dev-notes-v1 evidence |
| `docs/build/RUN-M2-11-T0-aggregate-throughput-qa-report.md` | add only after exit-zero T0-v8 | validated qa-report-v1 evidence |

`src/populus/inst_agg.sql`, `scripts/measure_inst_derive.py`, materialization,
serving, publish, workflow, dashboard, acceptance, dependency, and snapshot files
are explicit negative allowlist entries: any edit is plan drift and forces review.

## Implementation Tasks

- **T1 [R1, R2, R3, R10]:** Add fixed private page/cache constants and a private
  source-TEMP-cache context. Restructure bulk eligibility so cache restoration
  precedes any Python fallback and all return/error paths preserve existing
  cleanup/primary-error rules.
- **T2 [R3, R8, R10]:** Configure/assert the fresh destination page/cache before
  DDL without writing durability pragmas; keep connection registration, commit,
  close, and partial-file deletion unchanged.
- **T3 [R4, R9, R10]:** Add the collision-checked shared raw-period stage and
  unique index; rewrite registry and concentration raw-stat consumers to reuse it
  and emit PK order.
- **T4 [R5, R8, R9]:** Replace bulk QoQ row transformation with the layered exact
  SQL projection, bound provenance, lexical flags, PK order, and transform-free
  streaming. Retain `_qoq_row` and delete only now-unused bulk adapter code/imports.
- **T5 [R6, R8, R9, R10]:** Replace issuer parts with the direct final holder
  stage, retain bounded name normalization, rank/stream in PK order, and update the
  owned TEMP registry/cleanup.
- **T6 [R7, R8, R9]:** Merge concentration position statistics and coefficient
  sums into one reduction, reuse raw periods, preserve exact reconstruction/guard,
  and order final rows by PK.
- **T7 [R11]:** Expand semantic fixtures for every QoQ classification/flag branch,
  reported/default affiliation split, direct issuer merging, raw period reuse,
  notice/NULL/unkeyed/zero, huge square, signed cancellation, and huge shares;
  compare complete bulk and oracle artifacts and reports.
- **T8 [R3, R8, R10, R12]:** Add fail-if-removed physical/lifecycle tests for
  PRAGMA order/readback/non-durability, source cache restoration, exact SQL orders,
  transform-free QoQ, one raw grouping, no issuer-parts regroup, one concentration
  reduction, injected failures/timeouts, cleanup retry, and re-entry.
- **T9 [R13]:** Run focused and targeted pytest. Fix failures, rerun affected
  focused tests, then rerun the complete focused/targeted commands after the final
  source edit.
- **T10 [R13]:** Run `git diff --check` and all six canonical commands separately;
  preserve exact exits. Record the final `make check` dashboard build's generated
  file/page count and require it to equal 8,106 before T11. Any repair or count
  drift restarts T9-T10 evidence and re-review rather than changing T0 arguments
  ad hoc.
- **T11 [R14]:** Recheck pinned plan/source/test/finding/snapshot hashes and
  `T0-v8.log` absence, confirm the fresh T10 measured count is exactly 8,106, run
  the exact binding command once with `--measured-files 8106 --pilot-filers 500`,
  retain/hash the full log, recheck D1/snapshot/sidecars, and append an honest
  T0-v8 findings section.
- **T12 [R14, R15]:** If and only if T0-v8 exits zero, write/validate fresh Dev
  Notes and QA report, assemble the full current bundle, and dispatch a separate
  read-only QA reviewer. Batch all grounded fixes and fully re-gate/re-run a new
  owner-authorized binding log if any source repair occurs; never overwrite v8.
- **T13 [R15]:** During plan review, the independent reviewer returns the exact
  seven-section verdict. The main agent fixes all grounded findings and sends the
  revised exact digest for the next round, stopping at three rounds.

## Testing Strategy

Focused:

```bash
PYTHONDONTWRITEBYTECODE=1 .venv/bin/python -m pytest -q tests/test_inst_agg.py
```

Targeted adjunct:

```bash
PYTHONDONTWRITEBYTECODE=1 .venv/bin/python -m pytest -q \
  tests/test_inst_agg.py tests/test_cover_tolerance.py \
  tests/test_inst_external_store.py tests/test_inst_snapshot_script.py \
  tests/test_inst_serving.py tests/test_inst_serving_artifact.py \
  tests/test_publish.py tests/test_amendments.py
```

Standing verification, each separately:

```bash
git diff --check
make check
make accept-m1-b
make accept-m2-5
make accept-m2-6
make accept-m2-8
make accept-m2-11
```

Binding T0-v8, with no build date and no `tail` pipe:

```bash
PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1 .venv/bin/python \
  scripts/measure_inst_derive.py \
  --snapshot /Users/johnbaek/projects/Populus-ops/snapshots/inst-source-v1.db \
  --measured-files 8106 \
  --pilot-filers 500 \
  --full \
  > /Users/johnbaek/projects/Populus-ops/snapshots/evidence/m2-11/T0-v8.log 2>&1
```

The fresh final `make check` output must first confirm the 8,106 measured count.
The log-existence preflight is a separate required check immediately before this
command. Shell redirection must not be invoked if the path exists. The process
exit is captured directly; no pipeline may mask it.

Semantic tests compare full rows/table order and explicit edge values. Structural
tests supplement semantic tests only where removal would otherwise keep row output
identical: destination physical settings, source-cache restoration, SQL ordering,
and single-stage topology. No wall-clock unit-test threshold is added; T0-v8 is the
only full performance gate.

## Verification Matrix

| Requirement | Executable check | Pass condition |
|---|---|---|
| R1 | binding T0-v8 aggregate record | full `aggregate_s < 180.000`, no aggregate timeout |
| R2 | fallback/materialized-selector fixtures | only exact eligible namespace uses bulk; fallback precedes dest mutation |
| R3 | PRAGMA trace/readback/reopen and source restoration tests | page 32768; cache -262144 in connection; durability unchanged; source exact restore |
| R4 | raw-period fixture + trace/plan assertion | one full raw GROUP BY; exact registry/concentration rows incl. notice zero |
| R5 | exhaustive QoQ oracle parity and SQL-order assertion | all fifteen fields/types/flags exact; no Python transform; PK order |
| R6 | issuer entity/CUSIP/name/share-class fixtures | rows/ranks/names/counts/flags exact; one final holder grain; PK order |
| R7 | huge-square/zero/NULL/top-N fixtures and query assertion | exact integer results; one combined coefficient reduction; PK order |
| R8 | schema hash/DDL negative allowlist + all stream traces | DDL unchanged; rowid/PK/checks intact; batch 10,000; all PK ordered |
| R9 | affiliation/signed/huge-share/complete artifact tests | reported/default populations and arbitrary-precision fallback exact |
| R10 | injected failure/timeout/commit/cleanup/re-entry tests | no TEMP/cache/function/partial-file residue; primary error retained |
| R11 | focused and targeted pytest | all named semantic branches fail if optimization changes meaning |
| R12 | physical/topology/failure tests | every performance contract fails when its optimization/restoration is removed |
| R13 | focused, targeted, diff, six canonical commands | every command exits 0 after final source edit |
| R14 | fresh `make check` count + exact absent-then-created T0-v8 command/log + findings append | count 8,106; explicit measured/pilot flags; one immutable complete log; D1 PASS; honest exit/result; no overwrite |
| R15 | plan-review and conditional qa-review outputs | exact digest approved; QA only after exit-zero v8; max three rounds each |

## Rollout / Rollback

Rollout is local and fail-closed:

1. approve the exact plan digest;
2. implement only the allowlisted source/test delta;
3. run focused/targeted/diff/canonical gates;
4. create one binding T0-v8 log only after confirming absence;
5. append the result to findings;
6. proceed to fresh QA evidence/review only on exit zero.

There is no deployment or persistent source write. If tests or gates fail, edit
only allowlisted code/tests and restart evidence. If T0-v8 exits nonzero, preserve
the log and append the result; do not reinterpret or overwrite it and do not enter
QA. If the optimized path fails before commit, existing cleanup removes the partial
destination and restores source cache/TEMP state. Code rollback, if the owner later
requests it, is a normal targeted revert of this delta's `inst_agg.py` and test
changes; no snapshot/data rollback exists or is needed. This plan does not authorize
that git action.

## Simplicity Audit

Minimum coherent design:

- two fixed integer constants for page/cache geometry;
- one small private context manager for exact source cache restoration;
- one raw-period stage replacing two scans;
- one final issuer-holder stage replacing parts plus regroup;
- one layered SQL QoQ projection replacing one per-row Python adapter;
- one merged concentration reduction replacing two reductions;
- no new module, schema, public API, configuration, callback, worker, or artifact.

New/changed implementation symbols are limited to the cache constants/context,
raw-period creator, QoQ SQL builder/constant, issuer-holder creator, and the existing
writers they simplify. `_qoq_row`, matching, batching, DDL loading, HHI limbs,
builder entry point, timeout integration, and Python fallback remain. Conditional
Dev Notes/QA report are workflow evidence, not runtime components.

## Tech Debt Introduced

### TD-A1 — Fixed internal SQLite cache/page geometry

- **Debt:** 32 KiB pages and 256 MiB source/destination cache suggestions are
  fixed internal performance constants rather than adaptive tuning.
- **Impact:** a materially different future corpus or host may prefer other
  geometry; the source cache hint can increase peak process memory by up to its
  suggestion while bulk runs.
- **Mitigation:** values are bounded, tested, source state is restored, destination
  cache is connection-local, durability is unchanged, and the existing 8 GiB
  free-RAM preflight remains binding.
- **Removal condition:** replace only under a separately owner-reviewed benchmark
  delta with full-corpus evidence and the same semantics/resource gates.

No hidden TODO, stub, disabled test, retry, timeout waiver, semantic fork,
persistent cache, schema debt, or ignored failure is introduced. Pre-existing
aggregate size/R12 uncertainty and the approximately 2.25 GiB retained TEMP cache
remain declared parent-plan debt; this delta neither hides nor resolves them.

## Memory Touch-Points

The memory index was loaded. The exact canonical invocation was:

```bash
/Users/johnbaek/projects/orchestrate-tool/lib/memory-select.sh \
  /Users/johnbaek/.claude/projects/-Users-johnbaek/memory/MEMORY.md \
  aggregate sqlite performance bulk high-cardinality timeout materializ \
  benchmark cache "order by" executemany "temp table"
```

It deterministically returned exactly five files, all read completely:

- `feedback_bulk_sql_for_backfills.md` — drives SQL-native QoQ projection,
  final-grain stages, fixed batches, and rejection of per-row high-cardinality
  Python work.
- `feedback_identity_scoped_cache.md` — its browser/auth identity example is not
  directly applicable, but its non-leakage principle reinforces exact
  connection-scoped source-cache restoration and a regression test across
  re-entry.
- `feedback_mypy_cache_stale_rebase.md` — consulted; no rebase or mypy invocation
  occurs at the pinned HEAD, so destructive cache clearing is not applicable.
- `feedback_auto_fallback_alert_pattern.md` — explicitly dispositioned: the
  preserved Python fallback is a correctness compatibility path, not a new
  auto-calibrated default, and it returns identical data rather than degraded
  estimates. It remains behaviorally observable in tests through the existing
  oracle call spy and operationally through the unchanged bounded aggregate
  phase/STOP result. Adding a new logger/metric/API is outside this delta and the
  absence of one is pre-existing, not introduced debt.
- `feedback_preexisting_debt_regating.md` — requires the complete full-tree
  `make check` plus all standing acceptance gates after changing pre-existing bulk
  SQL. Any new dynamic fixed-identifier SQL follows the existing parameterization
  and `# nosec B608` discipline; focused tests do not replace full regating.

The mandatory failure-mode catalog was loaded and shaped full consumer/gate scans,
fail-if-removed tests, exact scope, bulk SQL, freshness invalidation, and separate
review boundaries.

## Failure-Mode Sweep

| Catalog item | Prevention and executable proof |
|---|---|
| F0 full-set sweep | Aggregate schema, producer, digest, serving, publish, MCP, dashboard, acceptance, docs, and tests were scanned; negative allowlist is explicit. |
| F0 secrets | No network, credentials, environment dump, tokens, or secret-bearing log command. |
| F0 verify, do not assume | T0-v7, stage probes, PRAGMA readbacks, and T0-v8 separate measured fact from inference. |
| F1 all tables/consumers | All five aggregate tables and default-versus-reported populations are mapped. |
| F1 exact gates | Focused, targeted, diff, six standing commands, and T0-v8 are literal. |
| F1 units/NULL | seconds, bytes, KiB, page bytes, integer/NULL/flag behavior, and inclusive timeout are explicit. |
| F1 locked choice | Ten decisions and rejected alternatives leave one implementation. |
| F2 full-tree scope | Canonical commands supplement, never get replaced by, focused performance tests. |
| F2 valid boundary tests | Removal of order/cache/shared-stage/SQL classification/restoration makes named tests fail. |
| F2 bulk SQL | 9.48M QoQ rows stay batched and transform-free; no new per-row Python high-cardinality path. |
| F2 stale comments | Builder/stage comments must describe final-grain/shared/ordered behavior after edits. |
| F3 end-to-end function | Binding snapshot→aggregate→serving→R12/tail proves function, not liveness. |
| F3 doc reconciliation | Findings bind exact log hash, exit, timings, sizes, D1, snapshot state, and fresh 8,106 measured tree premise. |
| F4 propagation | Every review fix is swept through requirements, tasks, files, matrix, tests, debt, and DoD. |
| F4 QA batching | Grounded QA findings are fixed together before full re-gating; no self-sign. |
| F5 freshness | Any source repair invalidates tests/gates/T0/findings/Dev Notes/QA/diff/verdict evidence. |

## Definition of Done

- [ ] **R1** binding full aggregate completes below 180.000 seconds with the
  unchanged guard/opcodes and both connections covered through commit.
- [ ] **R2** only exact eligible materialized input uses bulk; every fallback
  precedes destination mutation and matches the Python oracle.
- [ ] **R3** source TEMP cache restores exactly on every path; destination is 32
  KiB/256 MiB in-connection; journal/synchronous remain unchanged.
- [ ] **R4** one exact filer-period raw-stat stage supplies both registry and
  concentration, including notice-only zero periods.
- [ ] **R5** SQL-native QoQ reproduces all fifteen fields/branches/types/flags,
  binds provenance, streams transform-free, and orders by exact PK.
- [ ] **R6** one final issuer-holder stage preserves entity/CUSIP/name fallback,
  values/names/security counts/ranks/flags, bounded normalization, and PK order.
- [ ] **R7** one combined concentration reduction preserves exact limbs, big-int
  reconstruction, guard, top-N/max/HHI/NULL flags, and PK order.
- [ ] **R8** all streams are PK ordered with 10,000-row batches; schema/rowid/PK/
  checks/version/digest/serving stay unchanged.
- [ ] **R9** affiliation/default-versus-reported populations, signed fallback,
  huge shares, integers, NULLs, flags, and complete artifact parity pass.
- [ ] **R10** collision, source/destination failure, timeout, commit, cleanup retry,
  partial-file deletion, cache restore, primary error, and re-entry pass.
- [ ] **R11** exhaustive semantic fail-if-removed fixtures and full oracle-versus-
  bulk artifact comparisons pass.
- [ ] **R12** physical/topology fail-if-removed tests prove every performance and
  lifecycle contract without a brittle unit-test clock threshold.
- [ ] **R13** focused, targeted, `git diff --check`, and all six canonical commands
  exit zero after the final source edit; final `make check` freshly reports exactly
  8,106 generated dashboard files/pages.
- [ ] **R14** T0-v8 was absent, created exactly once with explicit
  `--measured-files 8106 --pilot-filers 500`, retained/hashed/appended, and either
  exits zero with complete D1/R12/serving/tail evidence or stops honestly before
  QA. Any fresh measured-count drift forced plan revision before the one-shot run.
- [ ] **R15** exact final plan digest receives independent approval within three
  rounds; only exit-zero fresh evidence receives separate QA approval within three
  rounds.
- [ ] Snapshot v1 remains exact size/mode/SHA and sidecar-free; T0-v7 is unchanged;
  no stage/commit/push/PR/deploy/worktree action occurred.

Implementation begins only after independent `plan-review` returns
`VERDICT: APPROVED` for this file's exact final SHA-256.
