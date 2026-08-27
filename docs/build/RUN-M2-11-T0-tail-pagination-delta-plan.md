# RUN M2-11 T0 tail-payload fragmentation and shard-geometry completion delta (plan-v1)

**Artifact:** plan-v1 delta · **Transport:** interactive-disk · **Status:** IN REVIEW;
implementation and T0-v11 are paused until an independent plan-review approves
the exact artifact; maximum three plan-review rounds, with the primary agent
applying every correction · **Owner authorization:** 2026-08-10, exact instruction
authorizing a new owner-reviewed tail-payload/shard-geometry delta and the
append-only T0-v11 binding run · **Branch/base:** `codex/m2-11-t0-finalize` at
`7391d947f72cf408a173f1e7938102608b2269d4`, an ancestor of fetched
`origin/main` `21340330a0fad7e9e39c1a9cec67656643621b05`, plus the preserved
cumulative unstaged M2-11 implementation and append-only findings · **Scope
class:** L/high-risk versioned browser transport, full-corpus static publication,
resource governance, and supervised deployment.

T0-v10 resolved the three runtime blockers without widening a guard:
materialization 126.365 seconds, aggregate 116.824 seconds, serving 83.005
seconds, aggregate 1,040,547,840 bytes, complete full JSON, and snapshot
immutability PASS. It nevertheless exited 3 because the version-1 transport
requires one complete logical `FilerPayloadV1` to fit in one response. The
measured 7,951-filer tail contains 439 payloads over 1,048,576 bytes, reaches a
10,462,106-byte maximum, and needs 1,866 shards even while excluding those 439
oversized objects; the fixed reservation is only 256. The retained binding log
is immutable SHA-256
`a86e24a6e4babc2ae70b010f38d3851f83ac1a60906141a1c536617470198cd7`.
It will never be retried or overwritten.

A disposable planning probe then exercised the separately reviewed
intra-filer option that the parent architecture reserved for this exact STOP.
The first probe was interrupted after its exact-but-quadratic candidate sizing
was observed; its immutable script/log hashes are
`7dece5373b813f937859689ee5b5f6afb95064d98e74f0adae1c560e614d69a5`
and `eccf7986ab64fa8c5f366b1ab3912ec0f45b646f4735cc26e1651933047d3b5c`.
The append-only linear correction, hashes
`d718a80d28f56633f13a961ea0eeff636514ccc57ad140818ca7328e0ea4e87f`
and `7f975672832b9e6f02ca892d72d0a711d0c90ff4ebecbbf3bf3f14fa2db7287d`,
exited zero. On the exact full corpus it reconstructed every logical payload
byte-for-byte under the deliberately conservative five-digit sizing sentinel,
produced 54,944 fragments packed into 2,714 shards, measured a
209,223-byte routing index, a 1,048,574-byte largest shard, no over-ceiling
fragment, and 3,448 files of probe-reported global headroom before the transition
tombstone identified in review. Accounting for that one bounded file makes the
reconciled actual projection/headroom 14,553/3,447. The proposed hard reservation
of 4,096 plus that tombstone would still leave 2,065 files below the unchanged
18,000 cap. These are conservative pinned design premises, not acceptance;
T0-v11 is the sole new binding run and remains absent.

## Goal and Success Criteria

Complete the tail delivery without raising the reader's 1 MiB response ceiling,
truncating a filer, changing logical institutional data, or weakening any
runtime, artifact, snapshot, coverage, signature, or global-file guard.

Success requires all of the following:

1. A version-2 routing index maps every tail CIK to a bounded contiguous shard
   range and exact fragment count; every fragment response stays at or below
   1,048,576 serialized bytes.
2. One logical `FilerPayloadV1` is deterministically divided by record boundaries
   and reconstructed byte-for-byte before the unchanged strict payload parser and
   renderer run. No row, filing, period, delta, order, NULL, integer, flag, total,
   embed cap, or honest-absence state changes.
3. Missing, duplicate, reordered, cross-CIK, contradictory, unknown, oversized,
   or excessive fragments fail closed before render. Index-controlled request
   fan-out is capped at 64 fragments per filer.
4. The existing generalized byte paginator remains the only shard filler. The
   measured 2,714-shard premise plus one v1 transition tombstone fits a hard
   4,096 reservation and the unchanged 18,000-file global cap with explicit
   headroom.
5. Every mandatory full-corpus Astro build has one reusable resource contract:
   at least 32 GiB physical RAM and a build-subprocess-only 24 GiB Node heap,
   with no workflow/job/global/test-process environment expansion.
6. All focused, cross-runtime, browser, post-build, workflow, complete-tree,
   acceptance, compatibility, and immutability gates pass after the final source
   edit.
7. One append-only T0-v11 exits zero with all three derivation phases below
   180.000 seconds, aggregate bytes at or below 1,610,612,736, complete logical
   reassembly parity, index and shard response bounds, fragment/fan-out bounds,
   derived shard count, global file headroom, and D1 equality.
8. Fresh workflow evidence receives independent QA approval within at most three
   rounds and read-only docs approval before the exact cumulative inventory is
   committed, reviewed, merged, and functionally deployed from `main`.

## Requirements

- **R1 — Logical payload invariance.** `assembleFilerPayload` and
  `FilerPayloadV1` remain the single logical producer/contract. Fragmentation
  happens only after assembly; reassembly must reproduce the identical
  `JSON.stringify(payload)` bytes and then call the unchanged strict
  `parseFilerPayload` before any render. Selection, current/prior periods,
  display order, referenced-only filings, embed caps, totals, concentrations,
  deltas, window, and absent states remain exact.
- **R2 — Exact fragment contract.** Add one version-2 transport fragment with
  exactly `{v,kind,cik,part,parts,section,period,start,data}`. `v` is 2, `kind`
  is `filer-fragment`, `part` is the zero-based global part, and every part
  repeats the exact total. Section order is metadata, filings, each
  `rowsByPeriod` key in logical insertion order, then each `deltasByPeriod` key
  in logical insertion order. Metadata carries every unfragmented logical field
  plus ordered `filingKeys`, `rowPeriods`, and `deltaPeriods`; filings carry
  ordered `[key,value]` pairs; row/delta fragments carry one period and a
  contiguous `start` offset. Empty maps/arrays are represented by metadata, not
  dropped.
- **R3 — Deterministic bounded cutting.** Add one source-of-truth fragment target
  of exactly 786,432 bytes and one fan-out maximum of exactly 64 in
  `inst_budget.py`, mirrored by TypeScript and pinned cross-runtime. Candidate
  sizing is linear and exact: fixed envelope plus each canonical record's UTF-8
  JSON bytes and separators, using the exact conservative decimal sentinel
  `part=99999,parts=99999` in both runtimes. The sentinel intentionally exceeds
  the allowed 0..63/1..64 values so a later bound increase cannot silently alter
  cutting or invalidate the pinned probe. A first record may exceed the target
  only if its complete keyed item inside a worst-case one-entry shard body still
  fits the 1,048,576-byte response ceiling; a record/metadata item over that
  final-body ceiling or a filer over 64 actual parts is a named build/T0 STOP.
- **R4 — One shard filler and measured reservation.** Feed fragment entries in
  `(cik,part)` order to the existing `paginateByBytes`/`fillShardsByBytes` path
  with fail/no-truncate/no-oversized-item policy and the worst version-2 shard
  envelope. Keep the response ceiling at 1,048,576, change the hard shard
  reservation/mirror from 256 to exactly 4,096, add exactly one separately named
  `FILER_V1_TRANSITION_FILES = 1` term, assert each final body by actual bytes,
  and retain every prior global-file term. `worst_case_file_count`, its unit
  proofs, and both acceptance scripts import/sum/print the new term explicitly.
  The reservation projects 15,935 of 18,000 files from the measured 8,106-file
  tree; actual T0 geometry must also be reported.
- **R5 — Versioned routing and routes.** Replace only the tail transport URLs
  with `/institutional/data/filers/index.v2.json` and
  `/institutional/data/filers/<shard>.v2.json`; remove the version-1 shard route,
  but retain the version-1 index path as a tiny strict transition tombstone with
  the exact body `{v:2,kind:"filer-index-upgrade-required"}`. A cached v1 client
  therefore reaches its existing version-mismatch S4 path rather than treating a
  rollout 404 as honest S2; the tombstone contains no payload/routes and no v1
  shard family exists. The exact active index is
  `{v:2,kind:"filer-index",absent:null|"module-absent",routes}` where each
  present route is `[firstShard,lastShard,parts]`, all nonnegative integers,
  `firstShard <= lastShard`, range length at most `parts`, and `parts` in 1..64.
  CIKs/fragments are contiguous, so this compact range is complete without a
  locator per fragment. Index bytes are also capped at 1,048,576.
- **R6 — Strict browser reconstruction.** The driver strict-checks exact version-2
  index/shard/fragment keys and types, bounds the route before issuing requests,
  fetches the inclusive shard range concurrently under the existing watchdog,
  rejects any missing/non-2xx/network response, and selects only entries whose
  exact key and embedded CIK/part agree. It then requires one metadata part at
  zero, parts exactly `0..N-1`, identical totals, legal section order, contiguous
  starts, exact metadata map keys, no duplicates/unknown keys, and logical CIK/
  period agreement. Only the reconstructed value enters `parseFilerPayload`.
  Any defect uses the existing S4 taxonomy; index absence alone retains S2.
- **R7 — Browser/build resource bound.** Preserve the current eager family/cache
  design for this delta, but make its full-corpus resource requirement executable
  everywhere it is mandatory. Add one `dashboard/package.json` `build:bounded`
  script that first checks Node `os.totalmem()` is at least 34,359,738,368 bytes,
  then gives only its `astro build` subprocess
  `NODE_OPTIONS=--max-old-space-size=24576`. The package `gates` chain and publish
  workflow site-build step both call that script. The forced-cut post-build test
  performs the same physical-memory refusal and passes the same exact option only
  to its `npx astro build` child. Tests require those exact scopes/values and
  prove the repository defines no `NODE_OPTIONS` for ordinary Node tests/checks.
  No secret,
  workflow/job/global environment, hosted deploy/sign job, or ordinary test
  process gains the setting.
- **R8 — T0/production parity and stops.** Update the T0 ladder to implement the
  same fragment shapes, ordering, exact byte target, route range, shard envelope,
  and 4,096/64 bounds in linear time. For every full-tail filer it must reconstruct
  and byte-compare the logical payload. It reports logical distribution,
  fragment count, parts median/p90/max, index bytes, reassembly mismatches,
  over-ceiling fragments, shard count/max bytes, and measured global headroom.
  Zero tail, mismatch, index/shard/fragment/fan-out breach, negative headroom,
  phase timeout, aggregate-size failure, or D1 mismatch remains nonzero.
- **R9 — Complete verification.** After the final source edit run the named
  focused Python and dashboard tests, shared fixture parity, post-build family
  checks, workflow governance, previous client/schema gate, `git diff --check`,
  `make check`, and all five standing acceptance commands separately. Tests must
  fail if fragmentation, a completeness guard, version-2 routing, the 1 MiB
  check, the 4,096/64 bounds, the v1 transition tombstone, or any required
  full-build resource scope is removed.
- **R10 — One append-only binding.** Verify `T0-v11.log` absent adjacent to one
  exact unbuffered full ladder over snapshot v1 with `--measured-files 8106
  --pilot-filers 500 --full` and no build date. Capture direct exit. Never retry,
  rename, truncate, or overwrite it; append its exact identity/outcome to
  findings.
- **R11 — QA discipline.** Only exit-zero T0-v11 permits fresh Dev Notes/QA
  artifacts and at most three independent QA-review rounds. The reviewer remains
  read-only; the primary agent batches and fixes findings. Any source repair
  invalidates every later gate/evidence token and requires a newly authorized
  binding filename rather than reuse of T0-v11.
- **R12 — Documentation and release scope.** After QA approval, update the parent
  delivery decision, architecture, status, Dev Notes, QA report, and exact
  commit evidence factually; obtain independent docs approval. Stage only the
  exact cumulative allowlist with equality/refusal checks, preserve the approved
  zero-remote-check PR path, assert fixed base/head/merged-main identities, and
  never commit external evidence logs.
- **R13 — Supervised functional deployment.** Revalidate/provision the current
  self-hosted runner/controller, immutable snapshot identity, and bounded-build
  resource contract before mutation. Dispatch the merged-main workflow, capture
  its exact run ID/URL, watch with `--exit-status`, and verify signatures,
  manifest/source/code bindings, the exact v1 transition tombstone, version-2
  index, every named fragment shard in one real route range, successful real
  filer reassembly/page render, response sizes, and file count before arming
  scheduled validation.
- **R14 — Immutability and stop discipline.** Snapshot v1 stays 0444, whole-file
  SHA exact, sidecar-free, and unchanged. No payload ceiling, fragment target,
  fan-out, shard reservation, global cap, phase timeout, coverage, artifact-size,
  schema, compatibility, signature, or semantic relaxation is allowed after a
  miss. Preserve every append-only log and primary failure; no deployment or
  destructive cleanup follows an unsatisfied gate.

## Scope

Authorized runtime/test write scope for this delta is exactly:

```text
.github/workflows/publish.yml
dashboard/src/lib/data.ts
dashboard/src/lib/filer-payload.ts
dashboard/src/lib/holdings.ts
dashboard/src/lib/shards.ts
dashboard/package.json
dashboard/src/pages/institutional/data/filers/[shard].v1.json.ts
dashboard/src/pages/institutional/data/filers/[shard].v2.json.ts
dashboard/src/pages/institutional/data/filers/index.v1.json.ts
dashboard/src/pages/institutional/data/filers/index.v2.json.ts
dashboard/src/scripts/entity-client.ts
dashboard/test/filer-payload.test.ts
dashboard/test/post/entity-orchestration.test.ts
dashboard/test/post/file-budget.test.ts
scripts/measure_inst_derive.py
scripts/accept_m2_8.py
scripts/accept_m2_11.py
src/populus/inst_budget.py
tests/fixtures/filer_payload_parity.v1.json
tests/test_inst_shard_budget.py
tests/test_inst_snapshot_script.py
tests/test_workflow_governance.py
```

Plan/review edits are limited to this plan before approval. After the binding
run, `docs/build/RUN-M2-11-T0-findings.md` is append-only. Only after exit-zero
T0-v11 and QA approval may the factual docs/release paths named under Planned
Files change. The v1 shard route is deleted; the v1 index route becomes only the
strict transition tombstone; the two v2 route sources are the active family.
External planning/binding/deploy logs remain outside Git.

## Non-goals

- No change to `FilerPayloadV1`, institutional aggregate/serving SQLite schemas,
  schema 1.1, logical digests, selection of the top 1,500, payload contents,
  current/prior semantics, embed caps, UI layout, client compatibility, snapshot,
  coverage, aggregate artifact decision, or three 180-second guards.
- No ceiling increase, provider-tier change, compression, binary transport,
  record truncation, pagination of the visible holdings UI, service worker,
  external object store, database index, new derived artifact, or extra binding
  run.
- No v1 payload/shard compatibility alias. The sole tiny v1 index tombstone has
  no data or routes and exists only to make cached v1 clients report transport
  version mismatch honestly; retaining the v1 shard family would double output
  and preserve the known impossible contract.
- No generalized transport framework or second shard algorithm. Activity keeps
  its current behavior; only the filer item shape changes before the shared
  filler.
- No commit, push, PR, variable mutation, deployment, schedule arming, runner
  teardown, snapshot mutation, or worktree teardown before its named gate.

## Constraints

- Work only in `/Users/johnbaek/projects/Populus-m28/.claude/worktrees/m2-11`;
  owner alone removes the worktree.
- Preserve unrelated/cumulative dirty changes; use `apply_patch` for edits and
  explicit file allowlists for staging.
- Plan reviewer, QA reviewer, and docs reviewer are independent and read-only;
  the primary agent implements/fixes.
- Maximum three plan-review rounds and maximum three QA-review rounds. Batch
  findings each round; no self-approval.
- `T0-v11.log` is one-shot/append-only. Its absence check and command are adjacent
  and no pipeline masks the process status.
- Full-corpus resource work is allowed only against the pinned immutable snapshot;
  disposable outputs use temp directories and are cleaned without touching the
  snapshot.
- Every dynamic request count is validated before fetch; every JSON envelope is
  strict, versioned, and fail-closed; no browser request reaches SEC.
- External logs may contain paths and corpus identifiers but never credentials,
  secrets, `.env` values, runner registration tokens, or signing material.

## Current State

- `dashboard/src/lib/shards.ts:20-23` owns the unchanged 1 MiB response ceiling;
  `fillShardsByBytes` at lines 95-156 is the existing fail/truncate policy engine
  and `paginateByBytes` at lines 196-219 is the filer-facing wrapper.
- `dashboard/src/lib/filer-payload.ts:33-64` owns logical version 1 and the v1
  paths; `assembleFilerPayload` at lines 128-195 builds the exact logical object,
  and `parseFilerPayload` remains its strict browser validator.
- `dashboard/src/lib/data.ts:705-711` mirrors the incorrect 256 reservation; its
  current `filerTailShards` assembles one logical payload per filer and maps each
  CIK to one shard, so an oversized filer cannot be represented.
- `dashboard/src/scripts/entity-client.ts:514-559` fetches/validates the v1 index
  and later fetches exactly one v1 shard. The error taxonomy, retry seam, watchdog,
  and final logical parser are reusable. Its v1 index 404 branch is S2 while a
  response with another version is correctly S4/version-mismatch; the transition
  tombstone must preserve that distinction for already-loaded clients.
- `dashboard/src/lib/holdings.ts:1573-1575` says both logical periods live in one
  shard file. That transport wording becomes stale even though one reconstructed
  logical payload still contains both periods.
- `dashboard/package.json:14-18` owns the local `gates` chain and currently calls
  an unbounded `astro build`; the forced-cut post-build test separately spawns a
  second unbounded real Astro build.
- `src/populus/inst_budget.py:158-164` explicitly says the 256 value is a
  reservation pending T0 measurement and must be restated if T0 disagrees. The
  1 MiB ceiling is distinct and remains unchanged.
- `scripts/accept_m2_8.py:422-445` and `scripts/accept_m2_11.py:631-647` each
  import, manually sum, assert, and print the complete global-budget term set;
  both must gain the separately named transition file or the mandatory commands
  correctly fail.
- `scripts/measure_inst_derive.py:1036-1170` mirrors the one-object-per-filer
  layout and therefore reports rather than solves the 439 oversized objects.
- `dashboard/test/post/file-budget.test.ts:145-199` enforces the real built-tree
  v1 family and must move atomically to the active v2 index/range topology plus
  the one exact transition tombstone.
- `tests/test_inst_snapshot_script.py:540-676` already provides one shared
  cross-runtime payload fixture, including a multi-megabyte cap case. Extending
  that fixture is the minimum exact parity seam.
- T0-v10 findings are appended at
  `docs/build/RUN-M2-11-T0-findings.md:933`; current findings SHA-256 is
  `2193477f5e248112a305be4132e327d1ae9b880cf1e7e79f56bc9e3701efac81`.
- Snapshot v1 is 23,058,628,608 bytes, mode 0444, SHA-256
  `977a4d249d92590a4de2961a3e9c7ff8cfa2e4846f0097ec7aa6c07f28124121`,
  with no journal/WAL/SHM sidecar. T0-v11 and its deployment log are absent.
- The linear planning result is exact for the conservative five-digit sentinel:
  7,951 tail filers; 2,520,035,802 logical
  bytes; 54,944 fragments; part median/p90/max 7/9/18; 209,223-byte index;
  2,714 shards; maximum 1,048,574 bytes; no mismatch/oversize; probe projection
  14,552 and headroom 3,448 before the one-file transition tombstone, reconciled
  projection 14,553 and headroom 3,447; D1 PASS.

Pinned implementation inputs before this plan are:

| Input | Identity |
|---|---|
| branch HEAD | `7391d947f72cf408a173f1e7938102608b2269d4` |
| fetched `origin/main` | `21340330a0fad7e9e39c1a9cec67656643621b05` |
| findings before v11 | `2193477f5e248112a305be4132e327d1ae9b880cf1e7e79f56bc9e3701efac81` |
| T0-v10 log | `a86e24a6e4babc2ae70b010f38d3851f83ac1a60906141a1c536617470198cd7` |
| measurement script | `7156509eec43bff14692eb8d53c4703926fb02c5ac08cbc4754147c8706fbfbf` |
| aggregate source | `eadbf78144546a5a737638a8225286cdc23fef4276308f64561c868b0ddc88ad` |
| serving source | `5bff56bbd130b911de24a34566f6c9eac39c916a149326492178d911742beb8c` |
| T0-v11 | absent |

## Detected Stack

- **Languages:** Python 3.12 package/scripts/tests; TypeScript/Astro 7 dashboard;
  SQLite/JSON1 data; YAML/shell GitHub Actions and release operations.
- **Python runner:** `uv run ...` from `uv.lock`; the existing `.venv/bin/python`
  is used only where the approved T0 command already pins it.
- **Node runner:** npm from `dashboard/package-lock.json`; Node >=24 from
  `dashboard/package.json` and `.node-version`.
- **Tests/type checks:** pytest; Node's built-in test runner; Astro check/TypeScript;
  post-build tests over real `dist` bytes.
- **HTTP/data style:** same-origin build JSON in the browser; Node `fetch` seam;
  SQLite readers and Python standard-library JSON.
- **Dedicated linter:** not detected; `make security` runs the repository dependency
  guard and `git diff --check` is mandatory.
- **Canonical commands:** `make check`, `make accept-m1-b`, `make accept-m2-5`,
  `make accept-m2-6`, `make accept-m2-8`, `make accept-m2-11`.

## Reuse Map

The required reuse-first scan included source, tests, Markdown, workflow, routes,
and all shard/payload/index/client-response terms, excluding only generated/vendor
trees. The complete relevant consumer set is the producer, route pair, browser
driver, T0 mirror, Python budget, unit/post-build tests, workflow resource step,
parent architecture, acceptance gates, and supervised deploy verifier.

| Need | Existing owner | Decision |
|---|---|---|
| logical filer semantics | `assembleFilerPayload` + `parseFilerPayload` | reuse unchanged before/after transport |
| byte shard packing | `fillShardsByBytes` + `paginateByBytes` | reuse unchanged; fragments become items |
| reader ceiling | `FILER_SHARD_BYTE_CEILING` mirror | reuse unchanged at 1 MiB |
| global file arithmetic | `worst_case_file_count` plus both acceptance exact-term reports | reuse every existing term; restate tail max and add the separately named one-file transition term in all three consumers |
| client load/error/watchdog | `runEntityDriver` filer branch | extend in place for a bounded range |
| parity corpus | `filer_payload_parity.v1.json` | extend with fragment summaries; no second fixture |
| post-build enforcement | `file-budget.test.ts` | replace v1 topology assertions with v2 |
| T0 full corpus | existing ladder and logical assembler | replace only tail packaging mirror; same phases/D1 |
| full-build resource scope | package `gates`, workflow site step, forced-cut child | add one package-owned bounded build command and mirror only its exact child env in the forced-cut seam |
| release/deploy | approved cumulative runbook/zero-check path | reuse, updating functional v2 probes only |

No parallel logical payload, renderer, shard filler, selection rule, index family,
or deployment path is introduced. The Python/TypeScript fragmentation mirror is
unavoidable because T0 and production are different runtimes; one shared fixture
and exact full-corpus reassembly bind them.

## Architecture

The logical payload remains version 1. Only the delivery envelope becomes
version 2:

```text
assembleFilerPayload -> FilerPayloadV1
  -> fragmentFilerPayload (meta, filings, rows, deltas; <=768 KiB target)
  -> existing paginateByBytes (<=1 MiB final shard, <=4,096 files)
  -> index.v2: CIK -> [first shard, last shard, exact parts]

/e/?k=f:<CIK>
  -> strict index.v2
  -> bounded concurrent fetch of inclusive shard range (<=64 parts)
  -> exact fragment selection/order/offset validation
  -> reassemble FilerPayloadV1 bytes
  -> unchanged parseFilerPayload
  -> unchanged filerBody + holdings surface
```

The exact transport shapes are:

```json
{"v":2,"kind":"filer-index","absent":null,"routes":{"0000000001":[12,14,5]}}
{"v":2,"kind":"filer-fragment-shard","shard":12,"shard_count":2714,"entries":{"0000000001:0":{"v":2,"kind":"filer-fragment","cik":"0000000001","part":0,"parts":5,"section":"meta","period":null,"start":0,"data":{}}}}
```

Metadata `data` carries logical `v`, `kind`, `cik`, `filerName`, `latestPeriod`,
`periods`, `current`, `prior`, ordered `filingKeys`, ordered `rowPeriods`, ordered
`deltaPeriods`, `totalsByPeriod`, `concByPeriod`, `latestFiled`, `topn`, and
`window`. It deliberately excludes only the three fragmented maps. Reassembly
creates the original top-level fields in their canonical order, initializes
empty map keys from metadata, appends exact contiguous slices, checks the complete
filing-key order, and then byte-compares in tests/T0 before strict logical parse.

CIKs and their parts are emitted contiguously. The index therefore needs only the
first/last shard and exact part count; it does not repeat 54,944 locators. A shard
at either boundary may also contain a neighboring CIK, but the client accepts
only entries whose key and embedded CIK/part match its route. The exact range is
validated before `Promise.all`, preventing hostile/unbounded fan-out.

The 768 KiB target is a packing target, not a relaxed ceiling. The shared filler
still reserves the worst 4,096-shard envelope and enforces the actual 1 MiB body.
A single large record can occupy one fragment between the target and ceiling;
it is allowed only when the complete keyed item in a worst-case one-entry shard
body fits. Anything larger stops. Both runtimes size with the literal conservative
`99999` part/parts sentinel even though actual values remain bounded to 64. The
planning measurement's maximum final body was two bytes under the ceiling and
its 2,714 actual shards leave 1,382 shards of family reserve and, after the one
transition tombstone, 3,447 global files; the full 4,096 reservation plus the
tombstone still leaves 2,065.

The active client uses only v2. The retained v1 index path serves exactly
`{"v":2,"kind":"filer-index-upgrade-required"}` and no routes. An old v1
client sees HTTP 200 plus version 2 and reaches its existing non-retryable S4
version-mismatch message; it cannot interpret rollout skew as an honest absent
filer. No v1 shard route or payload bytes remain.

The current eager family is retained to avoid a second streaming/shard algorithm.
Because its full logical corpus is 2.52 GB and the planning Python peak was
13,991,952,384 bytes, the package-owned bounded build refuses hosts below 32 GiB
and gives only Astro a 24 GiB V8 heap. Local `make check` and the workflow reuse
that command; the forced-cut test applies the same bound to only its child Astro
process. The actual runner has 64 GiB; T0-v11 and the supervised site build remain
the binding proofs.

The exact package script value is locked (JSON escaping aside) to this one shell
chain; `build` stays the ordinary developer command, while `gates` replaces only
its build token with `npm run build:bounded`:

```bash
node -e 'const {totalmem}=require("node:os"); if(totalmem()<34359738368){console.error("full build requires at least 32 GiB physical RAM"); process.exit(1)}' && NODE_OPTIONS=--max-old-space-size=24576 astro build
```

The forced-cut test first asserts `totalmem() >= 34359738368`, then its existing
`execFileSync("npx", ["astro","build",...])` copies the test environment and
overrides only that child with
`NODE_OPTIONS: "--max-old-space-size=24576"`. The parent Node test process and
all non-build package/workflow steps receive no repository-defined `NODE_OPTIONS`;
governance tests prove configuration scope without constraining a caller's
pre-existing environment.

## Locked Decisions

1. Keep logical `FilerPayloadV1` byte semantics unchanged; version only transport.
2. Use record-boundary fragments, not base64/raw-byte slicing or semantic caps.
3. Exact fragment target 786,432 bytes; exact per-filer maximum 64; exact sizing
   sentinel `99999` for both part fields in both runtimes.
4. Exact response ceiling remains 1,048,576 bytes for index and every shard.
5. Exact tail reservation becomes 4,096; global cap remains 18,000.
6. Compact range route `[first,last,parts]`; fragments and CIKs stay contiguous.
7. Replace the v1 payload family with v2, delete the v1 shard route, and retain
   only the exact tiny v1 version-mismatch tombstone; no v1 data alias/duplicate.
8. Concurrent bounded fetch under the existing single watchdog; full strict
   reconstruction precedes logical parse/render.
9. Reuse the eager family with one package-owned build-subprocess-only 24 GiB
   Node heap and >=32 GiB host preflight, including the forced-cut child; no
   streaming spool in this delta.
10. Preserve every T0 runtime/artifact/snapshot/coverage guard and use T0-v11 once.
11. Maximum three independent plan-review and QA-review rounds; primary fixes.
12. Preserve the approved exact-inventory, zero-remote-check, merged-main,
    supervised-deploy, and owner-only worktree-teardown procedures.

## Alternatives Considered

- **Raise the 1 MiB ceiling:** rejected; it violates the reader invariant and the
  largest measured filer is 10.46 MB, not a narrow miss.
- **Raise only the 256 reservation:** rejected; 439 indivisible v1 payloads remain
  impossible and the reported 1,866 count excludes them.
- **Base64/raw-byte chunks:** rejected; simple but adds roughly 33% to 2.52 GB and
  hides record-boundary validation.
- **Cap/truncate rows or deltas:** rejected; changes public semantics and makes a
  published filer incomplete.
- **One file per filer/fragment:** rejected; 7,951/54,944 files breach budgets.
- **Per-fragment locators in the index:** rejected; contiguous packing makes a
  compact range exact and keeps the index at the measured 209,223 bytes.
- **Lazy UI field/page transport:** rejected for this delta; it changes rendering
  state and visible interaction semantics beyond the packaging STOP.
- **New streaming/disk-spooled shard engine:** rejected for now; it duplicates or
  refactors the proven filler. The explicit heap contract is the smaller coherent
  remedy on the 64 GiB self-hosted runner.
- **Keep the complete v1 routes beside v2:** rejected; duplicates 2.52 GB and
  preserves a known unbuildable contract. The selected one-file v1 tombstone is
  not a compatibility data alias: it contains no routes/payload and exists only
  so cached v1 code reaches its already shipped version-mismatch failure.
- **Delete every v1 route:** rejected after review; an already-loaded v1 client
  treats an index 404 as honest S2, which would misclassify deployment skew.
- **Use only the actual two allowed part digits for cutting:** rejected for this
  binding because the retained probe deliberately used `99999`. Keeping that
  conservative sentinel in both runtimes makes the empirical geometry exactly
  reproducible and leaves future fan-out increases unable to change old cuts
  silently.

## Planned Files

New-delta runtime/test actions:

| Path | Planned action | Requirements |
|---|---|---|
| `docs/build/RUN-M2-11-T0-tail-pagination-delta-plan.md` | add/revise through independent review only | R11, R12 |
| `src/populus/inst_budget.py` | restate 4,096 reservation; add 768 KiB/64 constants and comments | R3, R4, R14 |
| `scripts/measure_inst_derive.py` | exact linear fragmentation, reassembly, route/index/shard measurement/stops | R1-R4, R8, R10, R14 |
| `dashboard/src/lib/filer-payload.ts` | version-2 paths, fragment/reassembly types and pure functions | R1-R3, R5, R6 |
| `dashboard/src/lib/data.ts` | fragment items, range index, 4,096/64 mirrors, v2 bodies/completeness | R2-R5, R14 |
| `dashboard/src/lib/holdings.ts` | reconcile the stale one-shard-file comment while preserving one logical two-period payload | R1, R9 |
| `dashboard/src/lib/shards.ts` | reconcile stale single-payload comments; shared filler stays one implementation | R3, R4 |
| `dashboard/package.json` | add the one bounded Astro build script and route local gates through it | R7, R9 |
| `dashboard/src/scripts/entity-client.ts` | strict bounded range fetch/reassembly before existing parser/render | R5, R6 |
| `dashboard/src/pages/institutional/data/filers/index.v1.json.ts` | replace the data index with the exact tiny version-mismatch transition tombstone | R1, R5, R6 |
| `dashboard/src/pages/institutional/data/filers/[shard].v1.json.ts` | delete known-unbuildable version-1 shard route | R5 |
| `dashboard/src/pages/institutional/data/filers/index.v2.json.ts` | add exact version-2 range-index route | R5, R13 |
| `dashboard/src/pages/institutional/data/filers/[shard].v2.json.ts` | add exact version-2 fragment-shard route | R5, R13 |
| `tests/fixtures/filer_payload_parity.v1.json` | add exact v2 fragment summary to existing shared corpus | R1-R3, R8, R9 |
| `tests/test_inst_snapshot_script.py` | cross-runtime fragment parity, linear/stop/vacuity/global gates | R1-R4, R8-R10, R14 |
| `tests/test_inst_shard_budget.py` | exact constants and every retained file term | R3, R4, R9 |
| `scripts/accept_m2_8.py` | import/sum/assert/print the transition file in the existing exact budget report | R4, R9 |
| `scripts/accept_m2_11.py` | import/sum/assert/print the transition file in the existing exact budget report | R4, R9 |
| `dashboard/test/filer-payload.test.ts` | fragment/reassembly byte equality, strict mutation and mirror tests | R1-R6, R9 |
| `dashboard/test/post/entity-orchestration.test.ts` | multi-shard success and every index/shard/fragment defect/fan-out path | R5, R6, R9 |
| `dashboard/test/post/file-budget.test.ts` | real v2 index/range/completeness/response/file gates | R4-R6, R9, R13 |
| `.github/workflows/publish.yml` | invoke the package-owned bounded site build without broader env | R7, R13 |
| `tests/test_workflow_governance.py` | exact resource scope/value and no governance expansion | R7, R9 |
| `docs/build/RUN-M2-11-T0-findings.md` | append exact T0-v11 outcome | R10, R14 |
| `docs/build/RUN-M2-11-plan.md` | factual parent decision amendment after QA | R12 |
| `ARCHITECTURE.md` | version-2 transport/resource amendment after QA | R12, R13 |
| `STATUS.md` | factual T0/QA/deploy status after evidence | R12, R13 |
| Dev Notes and QA report | fresh complete artifacts after exit-zero T0 | R11, R12 |

The exact cumulative release allowlist is fixed below. Every path, including
the staged v1 shard deletion, v1 index tombstone replacement, and v2 additions,
must be present and no other path may be staged:

```text
.github/workflows/publish.yml
ARCHITECTURE.md
Makefile
STATUS.md
dashboard/src/lib/data.ts
dashboard/src/lib/filer-payload.ts
dashboard/src/lib/holdings.ts
dashboard/src/lib/shards.ts
dashboard/package.json
dashboard/src/pages/institutional/data/filers/[shard].v1.json.ts
dashboard/src/pages/institutional/data/filers/[shard].v2.json.ts
dashboard/src/pages/institutional/data/filers/index.v1.json.ts
dashboard/src/pages/institutional/data/filers/index.v2.json.ts
dashboard/src/scripts/entity-client.ts
dashboard/test/filer-payload.test.ts
dashboard/test/post/entity-orchestration.test.ts
dashboard/test/post/file-budget.test.ts
dashboard/test/post/fixture-preview.test.ts
docs/build/RUN-M2-11-T0-affiliation-index-delta-plan.md
docs/build/RUN-M2-11-T0-aggregate-performance-delta-plan.md
docs/build/RUN-M2-11-T0-aggregate-throughput-delta-plan.md
docs/build/RUN-M2-11-T0-coverage-delta-plan.md
docs/build/RUN-M2-11-T0-coverage-totals-delta-plan.md
docs/build/RUN-M2-11-T0-findings.md
docs/build/RUN-M2-11-T0-materialization-reuse-delta-plan.md
docs/build/RUN-M2-11-T0-prepared-compact-aggregate-delta-plan.md
docs/build/RUN-M2-11-T0-serving-materialization-delta-plan.md
docs/build/RUN-M2-11-T0-serving-performance-delta-plan.md
docs/build/RUN-M2-11-T0-tail-pagination-delta-plan.md
docs/build/RUN-M2-11-devnotes.md
docs/build/RUN-M2-11-plan.md
docs/build/RUN-M2-11-qa-report.md
docs/runbooks/self-hosted-runner.md
scripts/accept_m2_11.py
scripts/accept_m2_8.py
scripts/measure_inst_derive.py
src/populus/amendments.py
src/populus/ingest/inst13f.py
src/populus/inst_agg.py
src/populus/inst_agg.sql
src/populus/inst_budget.py
src/populus/inst_serving.py
src/populus/publish/build.py
src/populus/publish/digests.py
src/populus/publish/manifest.py
tests/fixtures/filer_payload_parity.v1.json
tests/test_cover_tolerance.py
tests/test_digests.py
tests/test_inst_agg.py
tests/test_inst_external_store.py
tests/test_inst_serving.py
tests/test_inst_shard_budget.py
tests/test_inst_snapshot_script.py
tests/test_pointer_state.py
tests/test_publish.py
tests/test_workflow_governance.py
```

## Implementation Tasks

- **T1 [R1,R2,R3]:** Extend the existing shared parity fixture; implement pure
  TypeScript/Python fragment and reassembly functions with exact order, offsets,
  linear five-digit-sentinel sizing, 768 KiB target, 64-actual-part stop, exact
  one-entry shard-body admission, and logical byte equality.
- **T2 [R3,R4,R5,R14]:** Restate budget/mirrors to 4,096, feed fragment entries to
  the one existing filler, generate compact range routes and exact v2 bodies,
  add the separately counted `FILER_V1_TRANSITION_FILES = 1` term/tombstone,
  propagate it through both acceptance scripts' imports/exact sums/printed
  breakdowns, delete the v1 shard route/add v2 routes, enforce actual index/shard
  bytes and complete CIK/part coverage, and sweep stale comments including
  `holdings.ts`.
- **T3 [R5,R6]:** Update the browser driver to strict-validate v2 index ranges,
  bound request fan-out, concurrently fetch the inclusive range, reject every
  transport contradiction, reassemble, then call unchanged logical parse/render.
- **T4 [R7,R9]:** Add package-owned `build:bounded`: a literal Node
  `os.totalmem() >= 34359738368` refusal followed by inline
  `NODE_OPTIONS=--max-old-space-size=24576 astro build`. Route package `gates`
  and the workflow site step through it. Give the forced-cut test the same
  `os.totalmem()` refusal and exact option only in its `execFileSync` child env.
  Add tests proving exact scope/value and no other env/runner authority change.
- **T5 [R1-R6,R8,R9,R14]:** Update T0 mirror and every focused/cross-runtime/
  browser/post-build/budget test, including fail-if-removed, empty, boundary,
  oversized-record, 65-part, bad-range, missing/duplicate/reordered/cross-CIK,
  version, old-v1-tombstone, unknown-key, 404/network/timeout, index-ceiling,
  shard-ceiling, forced-cut resource, and global-file fixtures. The unit budget
  proof and both acceptance exact-sum assertions must fail if the transition
  term/import/addend/printed label is removed.
- **T6 [R9,R10,R14]:** After the final source edit, run every named gate, recheck
  pinned source/snapshot/T0-v10/findings identities and T0-v11 absence, execute
  T0-v11 once, capture direct exit/log identity, verify D1/no sidecars, and append
  exact findings without overwriting history.
- **T7 [R11]:** Only after exit-zero T0-v11, create fresh Dev Notes/QA report and
  complete at most three independent QA-review rounds; batch/fix all findings and
  rebuild every invalidated artifact after a source repair.
- **T8 [R12]:** After QA approval, update factual parent/architecture/status and
  commit evidence, run independent docs review, then enforce the exact cumulative
  inventory/staging equality and approved zero-check/fixed-base PR sequence.
- **T9 [R13,R14]:** Revalidate/provision runner/controller/snapshot/resource state,
  dispatch and bind the exact merged-main workflow run, verify v2 function and
  signatures end-to-end, append redacted deployment evidence, then arm scheduled
  validation; stop/rollback on any mismatch.

## Testing Strategy

Focused Python transport/budget/T0 tests after the final source edit:

```bash
PYTHONDONTWRITEBYTECODE=1 .venv/bin/python -m pytest -q \
  tests/test_inst_shard_budget.py tests/test_inst_snapshot_script.py
```

Focused dashboard transport/client tests:

```bash
(cd dashboard && node --test \
  test/filer-payload.test.ts test/post/entity-orchestration.test.ts)
```

They must cover exact logical-byte reconstruction for all shared cases including
the multi-megabyte cap case; Unicode/separators; empty maps; multiple chunks per
section; a single record between target and ceiling; a record over ceiling;
the literal five-digit sizing sentinel; exact 64/65 actual parts; route range
boundaries; two CIKs sharing a boundary shard; the exact v1 transition tombstone
driving the already-shipped version-mismatch branch rather than S2;
missing, duplicate, reordered, cross-CIK, wrong-offset, wrong-period, wrong-total,
unknown-section/key/version fragments; absent module; missing CIK S2; network,
404/5xx/watchdog; exact package/workflow/forced-cut child resource scoping; and
removal mutations for fragmenting/reassembly/strict parse.

Expanded targeted Python suite:

```bash
PYTHONDONTWRITEBYTECODE=1 .venv/bin/python -m pytest -q \
  tests/test_inst_agg.py tests/test_cover_tolerance.py \
  tests/test_inst_external_store.py tests/test_inst_snapshot_script.py \
  tests/test_inst_serving.py tests/test_inst_serving_artifact.py \
  tests/test_inst_shard_budget.py tests/test_digests.py tests/test_publish.py \
  tests/test_amendments.py tests/test_mcp_server_inst.py \
  tests/test_inst_federated_boundary.py tests/test_pointer_state.py \
  tests/test_workflow_governance.py
```

Previously released client/schema compatibility:

```bash
POPULUS_PREVIOUS_CLIENT_SHA=7391d947f72cf408a173f1e7938102608b2269d4 \
  PYTHONDONTWRITEBYTECODE=1 .venv/bin/python -m pytest -q \
  tests/test_pointer_state.py -k inst_schema_1_1_previous_client
```

Dashboard fixture/post-build and workflow propagation are exercised by the
repository-native full chain; the focused governance proof also runs separately:

```bash
(cd dashboard && node --test --test-concurrency=1 test/post/fixture-preview.test.ts)
PYTHONDONTWRITEBYTECODE=1 .venv/bin/python -m pytest -q \
  tests/test_workflow_governance.py
```

Standing gates, each captured separately:

```bash
git diff --check
make check
make accept-m1-b
make accept-m2-5
make accept-m2-6
make accept-m2-8
make accept-m2-11
```

`make accept-m2-8` and `make accept-m2-11` must each print the named
`filer_v1_transition_files=1` term and assert its complete exact sum equals
`worst_case_file_count`; `tests/test_inst_shard_budget.py` pins the constant,
function parameter/addend, 15,935 projection, and removal-fails difference.

Binding T0-v11, with adjacent absence check and no pipeline:

```bash
t0_log=/Users/johnbaek/projects/Populus-ops/snapshots/evidence/m2-11/T0-v11.log
test ! -e "$t0_log" || exit 97
t0_exit=0
PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1 .venv/bin/python \
  scripts/measure_inst_derive.py \
  --snapshot /Users/johnbaek/projects/Populus-ops/snapshots/inst-source-v1.db \
  --measured-files 8106 \
  --pilot-filers 500 \
  --full > "$t0_log" 2>&1 || t0_exit=$?
printf 'T0-v11 direct exit: %s\n' "$t0_exit"
test "$t0_exit" -eq 0
```

No `--build-date` is allowed; the widest valid FilingWindow is measured. Any
nonzero exit, absent/partial full JSON, phase at or above 180.000, logical
reassembly mismatch, index/shard over 1 MiB, fragment over target without the
documented single-record exception, part maximum over 64, shard count over
4,096, negative measured headroom, aggregate over 1,610,612,736 bytes, coverage
miss, or D1 mismatch stops before QA.

## Verification Matrix

| Requirement | Executable proof |
|---|---|
| R1 | shared fixture and full T0 logical JSON/hash equality before/after fragments; unchanged parser/render tests |
| R2 | exact fragment-shape/order/empty/map/offset tests in both runtimes; unknown/missing field rejection |
| R3 | exact 786,432/64 mirrors and `99999` sentinel; one-entry-body/boundary/oversized/65-part tests; linear sizing removal guard |
| R4 | shared filler spy; 4,096 mirror plus `FILER_V1_TRANSITION_FILES=1`; unit formula/removal proof and both acceptance import/sum/print checks; actual body/T0 count/headroom |
| R5 | exact v2 paths; v1 shard absence; exact route-less v1 tombstone; range cardinality/contiguity/byte/bijection gates |
| R6 | multi-shard browser success plus missing/duplicate/reordered/cross-CIK/range/network/version/watchdog and old-v1 transition proofs |
| R7 | package/workflow governance and forced-cut test assert >=32 GiB refusal and Astro-child-only 24 GiB heap; supervised readback/build |
| R8 | full T0 fields, mismatch/empty/index/shard/fan-out/global/phase/artifact/D1 refusal fixtures |
| R9 | named focused, expanded, dashboard, governance, diff, complete-tree, compatibility, five acceptance exits zero; both budget acceptance reports include the transition term |
| R10 | absent-then-created one-shot T0-v11, direct exit zero, retained hash/size/lines and appended findings |
| R11 | fresh validated Dev Notes/QA bundle; independent approval within three rounds; freshness tokens agree |
| R12 | factual docs, docs approval, exact inventory equality, zero-check API proof, fixed head/base/merged-main SHA |
| R13 | exact run ID watched; signatures/bindings; v1 tombstone plus v2 index/range/shards/real filer/page/file count functionally pass |
| R14 | pre/post snapshot hash/schema/sidecars equal; no relaxed constants; stop/rollback and append-only evidence |

## Rollout / Rollback

Rollout order is locked:

1. Approve this exact plan within three read-only review rounds.
2. Implement T1-T5 without touching docs/release state.
3. Run all post-final-edit gates and one T0-v11; append findings.
4. On exit zero only, complete independent QA within three rounds.
5. Reconcile docs/commit evidence and obtain docs approval.
6. Stage the exact inventory, commit, push, PR, verify, and squash-merge.
7. Validate/provision runner/controller/resource state, dispatch exact merged main,
   watch exact run, functionally verify, then arm scheduling.

After docs approval, staging is literal and fail-closed using the complete
allowlist under Planned Files:

```bash
release_allowlist=(
  .github/workflows/publish.yml
  ARCHITECTURE.md
  Makefile
  STATUS.md
  dashboard/src/lib/data.ts
  dashboard/src/lib/filer-payload.ts
  dashboard/src/lib/holdings.ts
  dashboard/src/lib/shards.ts
  dashboard/package.json
  'dashboard/src/pages/institutional/data/filers/[shard].v1.json.ts'
  'dashboard/src/pages/institutional/data/filers/[shard].v2.json.ts'
  dashboard/src/pages/institutional/data/filers/index.v1.json.ts
  dashboard/src/pages/institutional/data/filers/index.v2.json.ts
  dashboard/src/scripts/entity-client.ts
  dashboard/test/filer-payload.test.ts
  dashboard/test/post/entity-orchestration.test.ts
  dashboard/test/post/file-budget.test.ts
  dashboard/test/post/fixture-preview.test.ts
  docs/build/RUN-M2-11-T0-affiliation-index-delta-plan.md
  docs/build/RUN-M2-11-T0-aggregate-performance-delta-plan.md
  docs/build/RUN-M2-11-T0-aggregate-throughput-delta-plan.md
  docs/build/RUN-M2-11-T0-coverage-delta-plan.md
  docs/build/RUN-M2-11-T0-coverage-totals-delta-plan.md
  docs/build/RUN-M2-11-T0-findings.md
  docs/build/RUN-M2-11-T0-materialization-reuse-delta-plan.md
  docs/build/RUN-M2-11-T0-prepared-compact-aggregate-delta-plan.md
  docs/build/RUN-M2-11-T0-serving-materialization-delta-plan.md
  docs/build/RUN-M2-11-T0-serving-performance-delta-plan.md
  docs/build/RUN-M2-11-T0-tail-pagination-delta-plan.md
  docs/build/RUN-M2-11-devnotes.md
  docs/build/RUN-M2-11-plan.md
  docs/build/RUN-M2-11-qa-report.md
  docs/runbooks/self-hosted-runner.md
  scripts/accept_m2_11.py
  scripts/accept_m2_8.py
  scripts/measure_inst_derive.py
  src/populus/amendments.py
  src/populus/ingest/inst13f.py
  src/populus/inst_agg.py
  src/populus/inst_agg.sql
  src/populus/inst_budget.py
  src/populus/inst_serving.py
  src/populus/publish/build.py
  src/populus/publish/digests.py
  src/populus/publish/manifest.py
  tests/fixtures/filer_payload_parity.v1.json
  tests/test_cover_tolerance.py
  tests/test_digests.py
  tests/test_inst_agg.py
  tests/test_inst_external_store.py
  tests/test_inst_serving.py
  tests/test_inst_shard_budget.py
  tests/test_inst_snapshot_script.py
  tests/test_pointer_state.py
  tests/test_publish.py
  tests/test_workflow_governance.py
)
expected_names=$(mktemp)
actual_names=$(mktemp)
cached_names=$(mktemp)
printf '%s\n' "${release_allowlist[@]}" | LC_ALL=C sort -u > "$expected_names"
{ git diff --name-only HEAD; git ls-files --others --exclude-standard; } |
  LC_ALL=C sort -u > "$actual_names"
cmp "$expected_names" "$actual_names" || { echo 'release inventory drift; STOP' >&2; exit 1; }
git add -- "${release_allowlist[@]}"
git diff --cached --name-only | LC_ALL=C sort -u > "$cached_names"
cmp "$expected_names" "$cached_names" || { echo 'cached inventory drift; STOP' >&2; exit 1; }
test -z "$(git diff --name-only)"
test -z "$(git ls-files --others --exclude-standard)"
git diff --cached --check
```

No glob, `git add -A`, or inferred path is allowed. Release binds the exact PR
and never treats absent checks as green. The owner-approved zero-check path
asserts both check-run and commit-status absence, plus exact head/base,
mergeability, fixed-base freshness, matched-head merge, and merged-main identity:

```bash
git commit -m 'feat(inst): complete M2-11 publication'
release_commit=$(git rev-parse HEAD)
test -z "$(git status --porcelain=v1)"
git fetch origin main
release_base=$(git rev-parse origin/main)
git push --set-upstream origin codex/m2-11-t0-finalize
pr_url=$(gh pr create --repo johnbaekk-spec/populus --base main \
  --head codex/m2-11-t0-finalize --title 'feat(inst): complete M2-11 publication' \
  --body 'Owner-authorized M2-11 completion. Independent plan, QA, and docs reviews approved the exact cumulative inventory; the repository has an owner-approved zero-remote-check path, with complete local gates and supervised deployment required.')
test -n "$pr_url"
test "$(gh pr view "$pr_url" --json headRefOid --jq .headRefOid)" = "$release_commit"
test "$(gh pr view "$pr_url" --json baseRefOid --jq .baseRefOid)" = "$release_base"
test "$(gh api "repos/{owner}/{repo}/commits/$release_commit/check-runs" --jq .total_count)" -eq 0
test "$(gh api "repos/{owner}/{repo}/commits/$release_commit/status" --jq '.statuses|length')" -eq 0
test "$(gh pr view "$pr_url" --json statusCheckRollup --jq '.statusCheckRollup | length')" = 0
test "$(gh pr view "$pr_url" --json isDraft --jq .isDraft)" = false
test "$(gh pr view "$pr_url" --json state --jq .state)" = OPEN
test "$(gh pr view "$pr_url" --json mergeable --jq .mergeable)" = MERGEABLE
git fetch origin main
test "$(git rev-parse origin/main)" = "$release_base"
gh pr merge "$pr_url" --squash --match-head-commit "$release_commit"
test "$(gh pr view "$pr_url" --json state --jq .state)" = MERGED
merge_sha=$(gh pr view "$pr_url" --json mergeCommit --jq .mergeCommit.oid)
test -n "$merge_sha"
git fetch origin main
test "$(git rev-parse origin/main)" = "$merge_sha"
```

Deployment reuses the reviewed runner runbook and captures the exact dispatch
run ID/URL before `gh run watch <id> --exit-status`. Before any variable mutation,
recheck official/installed runner identity, controller ownership/permissions,
snapshot identity, physical RAM, and T0-v11 log/source hashes. Functional checks
must first assert the v1 index returns HTTP 200 and exactly
`{"v":2,"kind":"filer-index-upgrade-required"}` with no routes/data, and that a
v1 shard URL is 404. Then assert the active index `v==2`,
`kind=="filer-index"`, `absent==null`, nonempty routes, and index bytes <=1 MiB;
choose a real multi-shard CIK, fetch every integer shard in its declared range,
assert each `v==2`/fragment-shard body <=1 MiB and entries nonempty, verify exact
part completeness/reassembly, then load its `/e/` route and institutional HTML/
data. Manifest schema 1.1, merged code SHA, exact snapshot SHA, artifact/logical
digests, complete file inventory, deployment signatures, and global file count
must agree before `POPULUS_SELFHOSTED_VALIDATED` is armed.

Rollback before merge is ordinary source/test reversion while preserving all
append-only logs/findings. After merge but before variable mutation, revert the
PR normally. After variable mutation or dispatch, unset scheduled validation,
restore the prior snapshot variable if changed, preserve the failed run/evidence,
and use the existing signed pointer/artifact rollback. Never mutate/repair
snapshot v1, reuse T0-v11, delete external evidence, or remove the worktree.

## Simplicity Audit

Minimum coherent design: keep one logical payload and parser, add one pure
record-fragment transform/reassembler in the existing payload module, feed its
items to the existing shard filler, replace the active route pair while retaining
one strict tombstone, and extend the
existing client/T0/budget/test seams. No new application module, database,
renderer, selection rule, UI state, service, dependency, build artifact type, or
workflow job is needed.

New abstractions are completely enumerated:

- TypeScript `FilerFragmentV2`/route tuple types plus pure
  `fragmentFilerPayload` and `reassembleFilerFragments` in the existing
  `filer-payload.ts`;
- Python mirror helpers in the existing measurement script;
- three numeric budget terms: 768 KiB target, 64 parts, 4,096 shards;
- one conservative sizing sentinel and one transition-file count;
- two active v2 route files, the v1 shard deletion, and the tiny v1 index
  tombstone replacement;
- no new fixture file: the current interchange fixture gains summary fields;
- one package-owned bounded build command reused by local gates/workflow, with
  the same exact child-only environment at the forced-cut seam; no new runner/job.

The fragmenter is linear over serialized records. It never serializes a growing
candidate array repeatedly. Packing remains the shared greedy filler. The compact
range avoids a locator per part. Eager memory is explicit debt below rather than
hidden behind a second spool/pagination implementation.

## Tech Debt Introduced

- **TD-1 — Eager full tail family in Node memory (declared/accepted for this
  delta).** The inherited producer caches the whole family; version-2 makes it
  buildable but does not stream it. The 24 GiB build-child heap and >=32 GiB host
  preflight make the current 2.52 GB corpus executable on the 64 GiB runner.
  Impact: full builds require the self-hosted resource class and tail growth may
  eventually consume the cushion. Removal trigger: supervised build peak/heap
  failure, T0 part/file growth approaching a hard bound, or a new runner below
  the preflight; removal requires a separately reviewed disk-spooled/streaming
  adapter that still reuses the one filler and proves byte parity.
- **TD-2 — Cross-runtime transport mirror (declared and required).** Python T0 and
  TypeScript production implement the same small pure transform. Impact: drift
  risk. Removal condition: a shared executable implementation becomes available
  without adding a metered/runtime dependency. Until then the shared fixture,
  exact summaries, full reassembly equality, and T0-v11 bind it.
- **TD-3 — One-file v1 transition tombstone (declared/accepted).** The shipped v1
  client maps an index 404 to honest S2, so one route remains solely to return an
  exact version-2 marker and trigger its existing S4/version-mismatch path. Cost:
  one small static file and one permanent version-boundary test/file-count term;
  no v1 payload or shard is retained. Removal requires separately reviewed proof
  that no cached/loaded v1 client can survive a deployment boundary or a future
  transport mechanism that preserves fail-closed skew handling.
- No TODO, stub, disabled/skipped test, silent fallback, compatibility alias,
  duplicate route, ceiling waiver, temporary production flag, or post-deploy fix
  is introduced. Existing cumulative M2-11 debt remains declared in parent docs.

## Memory Touch-Points

The deterministic selector command was:

```bash
/Users/johnbaek/projects/orchestrate-tool/lib/memory-select.sh \
  /Users/johnbaek/.claude/projects/-Users-johnbaek/memory/MEMORY.md \
  payload shard pagination headroom ceiling routing tail
```

It selected exactly three indexed memories:

- `feedback_explicit_plan_contracts.md` — forced the exact index, shard,
  fragment, producer, route, reassembly, failure, and consumer shapes above.
- `feedback_stale_comment_sweep.md` — made the v1/single-shard wording sweep an
  implementation task rather than deferred documentation cleanup.
- `feedback_captured_pid_explicit_check.md` — applies to the reused deployment
  sequence: exact run/runner identity, bounded functional probes, and both log
  lanes remain required; it did not change the data design.

The always-loaded failure-mode catalog shaped the full consumer sweep, strict
anti-vacuity gates, fail-if-removed mutations, exact standing gates, source-repair
freshness invalidation, functional deployment, and secret-safe evidence rules.

## Failure-Mode Sweep

- **F0 complete set/secrets/function:** every producer, route, client, T0 mirror,
  unit budget, both acceptance-budget reports, workflow, test, doc, release, and
  deploy consumer is listed; no secret output; real multi-shard reassembly proves
  function rather than file presence.
- **F1 plan-time:** exact units/NULL/empty states and every transport field are
  specified; complete standing gates and full write scope are enumerated; live
  T0-v10/probe/HEAD/snapshot evidence is pinned; all decisions are closed.
- **F2 development:** shared paginator/payload/parser are reused; growing-array
  quadratic sizing is forbidden/tested; every new boundary has removal-fails and
  corruption tests; the transition file must survive formula/unit/both acceptance
  exact-sum mutations; stale comments and full-tree gates are explicit; build
  stays in the dedicated worktree.
- **F3 QA:** full-tail and post-build bytes/counts are measured, not inferred;
  index/shards/real filer page are exercised end-to-end; docs numbers reconcile
  code, tests, immutable logs, and built tree before sign-off.
- **F4 handoff:** any correction triggers a whole-plan/doc grep and exact inventory
  reconciliation; QA failures are batched and returned to the same independent
  reviewer; no self-signing.
- **F5 transport:** plan/review/Dev Notes/QA schemas validate before use; any
  source edit invalidates gates/diff/review; append-only T0 identity and reviewer
  provenance stay complete.
- **Fragment-specific:** empty tail cannot certify; empty maps survive; one giant
  record fails; 65 parts fail before fetch; route integers/range are bounded;
  missing/duplicate/reordered/cross-CIK fragments fail; metadata and offsets
  cannot contradict; index/shard bytes are actual; neighboring entries cannot be
  smuggled; no v1 payload/shard family coexists with v2; the exact v1 tombstone
  cannot become S2/data; no truncation/fallback.
- **Resource/release:** Node heap is build-child-only and host-preflighted for
  package gates, workflow, and forced cut; actual full build remains supervised;
  no pipe masks exit; exact run ID is watched; absent remote checks are explicitly
  proven; variable/schedule mutation is last.

## Definition of Done

- [ ] **R1** every logical `FilerPayloadV1` field/order/value reconstructs byte-for-byte and unchanged strict parse/render passes.
- [ ] **R2** exact version-2 fragment fields, section/map order, offsets, and empty states are implemented and strict-tested.
- [ ] **R3** exact 786,432-byte target, `99999` sizing sentinel, and 64-part bound mirror across runtimes; one-entry-body/boundary/oversize/linear tests pass.
- [ ] **R4** shared filler emits actual bodies <=1 MiB and count <=4,096; `FILER_V1_TRANSITION_FILES=1` is imported/summed/printed by both acceptance scripts and full projection is 15,935 with headroom 2,065.
- [ ] **R5** active version-2 routes and only the exact route-less v1 tombstone remain; index/range/shard/part completeness and byte bounds pass.
- [ ] **R6** browser bounded multi-fetch/reassembly succeeds, old v1 skew is S4 not S2, and every corruption/network/version/fan-out fixture fails honestly.
- [ ] **R7** exact >=32 GiB refusal and Astro-child-only 24 GiB heap cover package gates/workflow/forced cut and are observed in supervised build.
- [ ] **R8** T0 mirror reports complete fragment/index/shard/reassembly/headroom fields and every stop branch is tested.
- [ ] **R9** all named focused, expanded, dashboard, compatibility, diff, complete-tree, and five acceptance gates exit zero after final edit; both acceptance reports prove the transition term non-vacuously.
- [ ] **R10** T0-v11 exists once, direct-exits zero, retains exact hash/size/lines, D1 PASS, and findings append exact outcome.
- [ ] **R11** fresh Dev Notes/QA artifacts validate and independent QA approves within at most three rounds with no open finding/debt.
- [ ] **R12** parent/architecture/status/commit evidence are factual, docs review approves, and exact inventory/PR/main SHA proofs pass.
- [ ] **R13** exact merged-main run succeeds; signatures/bindings/index/multi-shard reassembly/real filer/page/file count pass before arming.
- [ ] **R14** snapshot remains exact/sidecar-free, no guard is relaxed, failed paths preserve evidence/primary error and stop safely.
