# RUN M2-11 T0 prepared/compact aggregate completion delta (plan-v1)

**Artifact:** plan-v1 delta · **Transport:** interactive-disk · **Status:** OWNER
AUTHORIZED; READY FOR INDEPENDENT REVIEW; source implementation remains prohibited
until review approval · **Date:** 2026-08-10 · **Parent:**
`docs/build/RUN-M2-11-plan.md`, SHA-256
`69683421f58872ec3f0a43b1a56cf5c6367b6f50057659cfcbf1ff73185d5663` ·
**Immediate predecessor:** approved aggregate-throughput delta,
`docs/build/RUN-M2-11-T0-aggregate-throughput-delta-plan.md`, SHA-256
`2b06c4be04b928ab455698ea2356b0e35728135f5841951a014bfac482268b8c` ·
**Branch/base:** `codex/m2-11-t0-finalize` at
`7391d947f72cf408a173f1e7938102608b2269d4`, whose commit is already merged in
remote `main` at merge commit `21340330a0fad7e9e39c1a9cec67656643621b05`, plus
the preserved cumulative unstaged M2-11/T0 implementation and append-only findings ·
**Scope class:** L/high-risk exact high-cardinality SQLite layout, derivation
lifecycle, publication, and production rollout.

T0-v8 proved every standing code/acceptance gate and improved the 500-filer pilot
aggregate from 47.568 to 43.744 seconds, but the full aggregate again reached the
unchanged 180-second phase deadline. Its retained log therefore contains no full
artifact size, R12 decision, serving projection, or tail result. A subsequent
owner-authorized, bounded full-corpus planning profile completed the same
aggregate without a deadline: **197.133 seconds**, **2,470,182,912 bytes**,
and the exact production report of 9,451 filers, 9,482,028 QoQ rows, 865,055 issuer
rows, and 45,138 concentration rows. Its retained script/log and exact compact DDL
are pinned in Current State; earlier import-only/v2/v3 outputs remain append-only
but are not acceptance evidence. The completed size independently proves that
the parent R12 no-compression branch cannot lock: the inclusive limit is exactly
`1.5 * 2^30 = 1,610,612,736` bytes.

This delta fixes both newly measured blockers before deployment. It moves only
the already-owned expensive position/issuer/concentration TEMP preparation into
the existing materialization phase, under that phase's unchanged 180-second guard,
then reuses the prepared state during aggregate. It also replaces only the physical
storage of the dominant QoQ relation with compact integer dictionaries/codes and a
`WITHOUT ROWID` backing table. The public `agg_qoq_deltas` name becomes a read-only
view with the exact existing fifteen-column SELECT contract, values, types, NULLs, flags,
logical primary-key order, and logical-digest envelope. Every application consumer
continues to issue its existing public SQL; only schema/digest discovery is taught
that this one projected relation is a view with an explicit logical key. Because
relation kind, writability, and PRAGMA-visible physical PK metadata are observable
SQLite behavior, the owner explicitly authorizes `modules.inst.schema_version`
`1.0` → `1.1`; compatibility remains `>=0.0.1,<1` only after the exact previously
released base client proves it installs and reads the new artifact.

The binding attempt is the new append-only `T0-v9.log`. A nonzero T0-v9, D1
mismatch, artifact above the exact R12 limit, tail failure, QA rejection after the
third round, or failed deployment verification stops honestly. On exit-zero T0,
independent QA and docs review, this plan authorizes the complete git/PR/supervised
deployment path requested by the owner. It never authorizes mutation of snapshot v1
or bypass of a safety, attestation, default-branch, or production-verification gate.

## Goal and Success Criteria

Complete and deploy RUN M2-11 without extending either SQLite phase deadline,
weakening durability, changing a public aggregate value, or shipping an aggregate
above the parent R12 size limit.

Success means:

1. Binding T0-v9 reports both full `materialization_s < 180.000` and full
   `aggregate_s < 180.000` under the existing progress-handler contract.
2. The full `inst_agg.db` is at most exactly 1,610,612,736 bytes and the findings
   lock the compact-layout branch with the observed byte count.
3. The public aggregate has the same four projected relation names, column order,
   SQLite value types, rows, NULLs, integer arithmetic, canonical flags, logical
   primary-key order, and logical digest as the unchanged Python semantic oracle.
4. Prepared-state ownership, source transaction identity, timeout cancellation,
   TEMP/cache/thread restoration, destination rollback, and snapshot immutability
   pass on success, fallback, partial setup, SQL failure, commit failure, timeout,
   re-entry, and cleanup retry.
5. All complete-tree tests and six canonical gates pass after the final source
   edit; binding T0-v9 then reaches D1, R12, serving projection, and tail geometry
   with exit zero.
6. Fresh Dev Notes and QA report receive independent `qa-review` approval within
   three rounds. Fresh release documentation and the conventional commit evidence
   receive read-only docs review before staging.
7. The exact staged cumulative M2-11 scope is committed, pushed, reviewed in a PR,
   bound to the exact clean locally gated head/current base, merged to `main`, and a
   supervised default-branch `data-publish` dispatch passes
   build, deployment, signing, assertion, source-hash, bounded-surface, and served-
   function checks. Only then is scheduled self-hosting validation armed.

## Requirements

- **R1 — Unchanged dual phase bounds.** `SQLITE_PHASE_TIMEOUT_SECONDS` stays 180
  and progress opcodes stay 10,000. The base materializer plus prepared aggregate
  stages are all measured under the materialization guard. Match construction,
  compact destination population, ranking/reduction, metadata, and destination
  commit remain under the aggregate guard. A diagnostic composition is not a pass.
- **R2 — Scoped SQLite workers.** Capture the exact `PRAGMA threads` integer only
  after the base materializer has completed, set it to exactly 8 for prepared
  aggregate state and its consumers, assert readback, and restore it in the outer
  preparation context's `finally`. Do not expand workers into the base materializer:
  retained v4 proves the source-safe threads=0 base then exact threads=8 readback.
  No global setting, environment variable, process pool, or new dependency exists.
- **R3 — Prepared aggregate ownership.** Add one private context/token in
  `populus.inst_agg`. It runs the existing sign/share eligibility before any
  destination mutation, creates the existing exact position, issuer-holder/name,
  and concentration-position stages once, and keeps them through aggregate and
  serving. The token is connection-bound, non-reentrant, invalid after exit, and
  accepted only by the private `_prepared` builder parameter. Partial/lookalike
  TEMP namespaces never select reuse.
- **R4 — Phase attribution and orchestration.** In both the production publish
  path and T0 ladder, enter base `materialized_inst_derivation_views` first and
  enter the prepared context inside the same materialization timing/guard. Pass
  its token into `build_inst_agg`. The exact external-snapshot sequence is `BEGIN`
  → base materialization → preparation → coverage/period coverage → aggregate →
  serving reads → `COMMIT` (the transaction ends) → `DETACH` → prepared TEMP/cache/
  thread cleanup and setting restoration. The prepared context, not the transaction,
  spans COMMIT and DETACH. The below-threshold/no-data branches never ATTACH: they
  end the read transaction, then run prepared cleanup/restoration. Standalone
  `build_inst_agg` without a token retains its current self-owned path.
- **R5 — Exact fallback.** Negative `value_usd`/`ssh_prnamt`, population guard
  refusal, or any out-of-int64 position share group records a prepared fallback
  token without issuer/concentration native SUM work. The subsequent build invokes
  the unchanged Python arbitrary-precision oracle before destination mutation.
  Fallback is observable in tests and never silently re-enters bulk.
- **R6 — Prepared cleanup and errors.** The outer context owns every prepared and
  aggregate-created TEMP object, source cache suggestion, and worker setting.
  Cleanup is dependent-first, completes the full sweep, retries once, and preserves
  the primary error. On any pre-COMMIT/COMMIT failure it attempts `ROLLBACK` while
  a transaction is active; it DETACHes only after the transaction has ended; it
  closes/removes a failed destination; then it sweeps prepared objects and restores
  cache/threads. If rollback itself leaves a transaction active, DETACH is skipped
  and connection close is final containment. The first operational failure is
  re-raised; absent one, the first rollback/detach/cleanup failure is raised after
  the remaining sweep, with later cleanup failures attached as notes. Prepared
  builds never delete caller-owned objects. Success leaves no TEMP/cache/thread
  residue after serving and DETACH.
- **R7 — Compact physical QoQ schema.** `inst_agg.sql` replaces the physical
  `agg_qoq_deltas` table with private filer/period dictionaries, one coded
  `WITHOUT ROWID` backing table, and a public `agg_qoq_deltas` view. The backing
  primary key uses integer filer/period and enum codes plus the unchanged text
  `position_key`; it stores no repeated `ingested_at` or JSON flag string. Fixed
  integer codes cover exactly LONG/PUT/CALL, SH/PRN/UNKNOWN, the five change kinds,
  and the five canonical flags. Unknown code/mask input is impossible through
  CHECK constraints and rejected by decoding tests.
- **R8 — Public QoQ parity.** The public view exposes, in the current DDL order,
  `cik`, `position_key`, `put_call`, `curr_period`, `prev_period`, `change_kind`,
  the six value/share columns, `ssh_prnamt_type`, `flags`, and `ingested_at`.
  Codes decode to the exact existing TEXT spellings; bitmask flags reconstruct the
  exact lexical JSON array. `ingested_at` comes from one excluded build-metadata
  value. `SELECT *` rows and `typeof()` values match the old table and Python
  oracle exactly.
- **R9 — One compact writer shared by both paths.** Define one private compact-row
  encoder and one private parameterized insert used by the Python oracle and bulk
  path. Bulk SQL may emit fixed numeric enum/flag codes directly, but CIK/period
  dictionary lookup and the final tuple shape have one implementation. Dictionary
  identifiers are assigned deterministically from ascending text values. No normal
  full-size QoQ table, migration copy, post-build compaction pass, or per-row SQL
  lookup is created.
- **R10 — Digest envelope unchanged.** Extend the digest projection metadata with
  the explicit logical primary key for `agg_qoq_deltas`. `_table_columns` accepts
  this one projected view only when its declared public columns exactly match and
  orders its rows by the existing text logical key. `LOGICAL_PROJECTION_VERSIONS
  ["inst"]` remains `"1"` because the canonical logical byte envelope is identical.
  The independent digest oracle must produce the same digest for old-table and
  compact-view fixtures containing every code, flag, NULL, and integer boundary.
- **R11 — Versioned consumer propagation.** Every repository consumer of
  `agg_qoq_deltas` is enumerated. Dashboard, MCP query, serving, publish, acceptance,
  and tests retain their public SELECTs. Only `inst_serving._qoq_deltas_table` and
  any schema-presence probe that currently insists on `type='table'` may accept
  `type IN ('table','view')`. Writers target only the private compact insert.
  `agg_build_meta.aggregate_version` becomes `2` and records the single QoQ
  `ingested_at`; `INST_SCHEMA_VERSION` becomes `1.1`, `INST_CLIENT_COMPAT` remains
  `>=0.0.1,<1`, architecture/manifest tests are reconciled, and no artifact filename
  changes. A baseline-client subprocess extracted from exact base commit
  `7391d947f72cf408a173f1e7938102608b2269d4` must install an authenticated `inst`
  `1.1` fixture and read all four public relations, including the QoQ view, or the
  compatibility range must refuse it and the plan returns to review.
- **R12 — Fail-if-removed semantic coverage.** Complete oracle-versus-prepared
  artifact comparisons cover every QoQ classification/flag combination, all enum
  values, multiple CIKs/periods, NULL/zero/INT64 values, signed cancellation,
  overflow fallback, issuer/name/CUSIP/entity cases, affiliation splits, and exact
  HHI. Tests compare complete public rows, types, reports, and logical digests.
- **R13 — Fail-if-removed lifecycle/physical coverage.** Tests prove workers start
  only after base materialization, exact readback/restore from zero and nondefault
  values, single creation/reuse of each prepared stage, token connection/activity
  rejection, fallback before destination creation, prepared state visible through
  serving, cleanup on every injected failure, private backing `WITHOUT ROWID`,
  absence of a full-size parallel QoQ table, deterministic dictionaries, CHECK
  rejection, view read-only behavior, and no schema/digest consumer drift.
- **R14 — Complete verification.** After the final source edit, run the focused
  aggregate/digest/serving/snapshot tests, the exact expanded targeted adjunct,
  `git diff --check`, then separately `make check`, `make accept-m1-b`,
  `make accept-m2-5`, `make accept-m2-6`, `make accept-m2-8`, and
  `make accept-m2-11`. Any source repair invalidates all later evidence.
- **R15 — One append-only binding run.** Verify `T0-v9.log` absent immediately
  before one exact unbuffered full ladder using immutable snapshot v1,
  `--measured-files 8106 --pilot-filers 500 --full`, and no build date or pipeline.
  Retain direct exit status, complete log, SHA-256, timings, counts, peak RSS,
  aggregate bytes, D1 states, R12, serving, and tail results. Append the decision
  to findings and never overwrite/retry v9.
- **R16 — Reviews and freshness.** The exact plan digest must receive independent
  approval. Three standard rounds were allowed; the owner's explicit 2026-08-10
  “all authorized—get us to deploy” directive authorizes one exceptional fourth
  convergence round solely for this final exact-scope propagation correction. No
  fifth round is authorized. Only exit-zero T0-v9 allows fresh Dev Notes,
  QA report, redacted diff, and `qa-review`, at most three rounds. A source fix
  requires complete re-gating and a newly owner-authorized binding log name. Docs
  review is read-only and occurs after QA approval, before the release commit.
- **R17 — Authorized release and supervised deploy.** After QA/docs approval,
  stage exactly the reconciled cumulative M2-11 inventory, verify the cached diff,
  create a Conventional Commit, push `codex/m2-11-t0-finalize`, open a PR against
  current `main`, disclose/assert that this repository has zero PR status checks,
  then squash-merge only when the PR head equals the locally gated commit, its base
  equals freshly fetched `origin/main`, it is non-draft/mergeable, and the worktree
  is clean. The owner's “all authorized—get us to deploy” instruction authorizes
  this no-remote-check path; it does not authorize claiming nonexistent CI. Verify
  the self-hosted runner/controller and variables without exposing credentials;
  set `POPULUS_INST_DB` to the accepted snapshot; dispatch `data-publish` on
  `main`; watch it to completion; exercise the deployed institutional pages and
  published artifact verification. Set `POPULUS_SELFHOSTED_VALIDATED=true` only
  after that supervised success. A skipped, preserved, failed, unsigned,
  unverified, wrong-source, or functionally broken run is not deployment success.
  The required provisioning first updates the committed runbook from Actions Runner
  `v2.321.0` to exact current `v2.336.0` macOS arm64 with literal SHA-256
  `8e8839c49b7060b6b2154f4931f815df330c27f167d53ef2239ee3dfce28b079`.
  Immediately before provisioning, the official `actions/runner` latest-release API
  must still return that tag, asset name, and digest; any drift returns to review.
  The installed/restored `bin/Runner.Listener --version` must read `2.336.0` before
  registration/dispatch. GitHub's documented 30-day/critical-update policy is a
  hard freshness gate, not post-deployment debt.
- **R18 — Snapshot and evidence immutability.** Snapshot v1 stays 23,058,628,608
  bytes, 0444, SHA-256
  `977a4d249d92590a4de2961a3e9c7ff8cfa2e4846f0097ec7aa6c07f28124121`,
  sidecar-free. T0-v8 stays exact SHA-256
  `2771908b0d7168bbaf18722bc3d2d441748791f64c6a6e3b0e83319fee36282c`.
  No existing evidence log is edited or deleted.

## Scope

In scope before exit-zero T0-v9:

- prepared aggregate context/reuse in `src/populus/inst_agg.py`;
- compact QoQ DDL in `src/populus/inst_agg.sql`;
- production orchestration in `src/populus/publish/build.py`;
- T0 orchestration/evidence in `scripts/measure_inst_derive.py`;
- logical-view key support in `src/populus/publish/digests.py`;
- view discovery in `src/populus/inst_serving.py`;
- focused regression changes in the corresponding test modules;
- this plan and an append-only T0-v9 findings section/log.

Authorized runtime/test write scope is exactly:

- `docs/build/RUN-M2-11-T0-prepared-compact-aggregate-delta-plan.md`;
- `src/populus/inst_agg.py`;
- `src/populus/inst_agg.sql`;
- `src/populus/inst_serving.py`;
- `src/populus/publish/build.py`;
- `src/populus/publish/digests.py`;
- `src/populus/publish/manifest.py`;
- `ARCHITECTURE.md`;
- `STATUS.md` only after exit-zero T0/QA, with factual M2-11 state;
- `docs/runbooks/self-hosted-runner.md` for runner 2.336.0 bootstrap/freshness;
- `scripts/measure_inst_derive.py`;
- `tests/test_inst_agg.py`;
- `tests/test_digests.py`;
- `tests/test_inst_serving.py`;
- `tests/test_pointer_state.py` only for the version/client-compat fixture;
- `tests/test_workflow_governance.py` for runner version/checksum governance;
- `dashboard/test/post/fixture-preview.test.ts` for the producer-version assertion;
- `tests/test_inst_external_store.py`;
- `tests/test_inst_snapshot_script.py`;
- `tests/test_publish.py` only if the production orchestration seam requires it;
- append-only `docs/build/RUN-M2-11-T0-findings.md` after T0-v9;
- new append-only external evidence
  `/Users/johnbaek/projects/Populus-ops/snapshots/evidence/m2-11/T0-v9.log`.
- fresh successful-workflow records
  `docs/build/RUN-M2-11-devnotes.md` and
  `docs/build/RUN-M2-11-qa-report.md` only after exit-zero T0-v9.

Review verdicts stay in the independent review transport rather than creating
unbounded repository filenames. Deployment evidence is append-only external
`/Users/johnbaek/projects/Populus-ops/snapshots/evidence/m2-11/T0-v9-deployment.log`
plus the immutable GitHub run; it is not staged before it exists. Existing
cumulative dirty files remain preserved and enter the exact final QA/docs/staging
inventory; this delta does not silently narrow them away.

## Non-goals

- changing either 180-second bound, progress opcodes, resource threshold, R12
  byte limit, tail ceiling, measured file count, or exit precedence;
- changing a filing/holding/default/reported population, identity match, period
  adjacency, issuer key, rank, concentration, unit, NULL, value, or flag meaning;
- mutating snapshot v1, adding a persistent source index, cutting snapshot v2,
  opening the canonical store, or using a second source identity;
- changing public artifact names, manifest field set, client compatibility range,
  dashboard/MCP public query fields, logical digest envelope/version, or serving
  schema; the owner-authorized inst schema value `1.1` is the one exception;
- retaining both old and compact QoQ implementations, adding a compression library,
  archive wrapper, migration mode, config switch, process pool, or network path;
- weakening journal/synchronous durability, using WAL/MEMORY/OFF journal mode,
  setting TEMP to memory, increasing timeout, or skipping a gate/review;
- deploying from the feature branch, bypassing default-branch guards, arming an
  unattended schedule before supervised success, or declaring liveness as function.

## Constraints

- Work remains in `/Users/johnbaek/projects/Populus-m28/.claude/worktrees/m2-11`.
- Branch is `codex/m2-11-t0-finalize`; HEAD/base is
  `7391d947f72cf408a173f1e7938102608b2269d4`, already an ancestor of remote
  `main` merge `21340330a0fad7e9e39c1a9cec67656643621b05`.
- Current pinned hashes:

| Artifact | SHA-256 |
|---|---|
| `src/populus/inst_agg.py` | `5870618866ca3682f88dd62e61f8599db47f96c77cff748e3c775e334c323a34` |
| `src/populus/inst_agg.sql` | `7d4f0c2d1d39c2b7ceaf23ca325abfbec1138c1ac7286095e102cc522fa250f2` |
| `src/populus/inst_serving.py` | `44af95c827c62e295245c3b7186f7eba84313b251cc0c984e40b75667cb6b82c` |
| `src/populus/publish/build.py` | `a46f9b2251d627b559e11a7c8547a028edd01f33bc113d5b7558859edbf1e3bb` |
| `src/populus/publish/digests.py` | `f22b876dafe74d56c741dc12920bea1cecda8d88edc7106ef66a799c19fc6159` |
| `scripts/measure_inst_derive.py` | `d6f653de73f08f21d075a050d45b35ce979660b2408a36b53b0e9879dbb060d5` |
| `tests/test_inst_agg.py` | `109250a4846be3ba828e14c76a41d49bc4bd878bf121ca4a8bc4dd50cb24a0ce` |
| `tests/test_digests.py` | `539430ae77d4a3a0b3e2e1e95281bbdfd981af73485e5c4005b19e22088a93d1` |
| `tests/test_inst_serving.py` | `e27823d1ba2c183b777acaee4c197589e6c61881b18cb298aceb04dfbe23edf6` |
| `tests/test_inst_external_store.py` | `1aa2fa1ce65cb5fdce5e8706d05b4bb749f9e01fb8e3945fb06658e59c6e6fa0` |
| `tests/test_inst_snapshot_script.py` | `2f0941e86de9202eb558aa30a2766d6ca74e52fdf9e32ec2310716b509100482` |
| findings before v9 | `a19d4c511502b5e1f7db66a11576c9acde1459c335073b1014a156c76790db76` |
| T0-v8 log | `2771908b0d7168bbaf18722bc3d2d441748791f64c6a6e3b0e83319fee36282c` |

- `T0-v9.log` is absent at plan time. Diagnostics used disposable temporary
  directories and never that filename.
- GitHub authentication is available without printing its credential. Current
  remote variables show publish/sign armed; `POPULUS_INST_DB` and
  `POPULUS_SELFHOSTED_VALIDATED` are absent and remain so until R17 order permits.
- Current preflight also finds zero registered repository runners, no
  `/usr/local/populus-runner` controller tree, and no loaded
  `com.populus.runner-controller` launchd service. This is a known release
  prerequisite, not permission to dispatch into an empty queue: R17 must provision
  and validate committed runbook §§1–6 or stop before variable mutation.
- GitHub currently reports no `pull_request` workflow, no branch protection, no
  rulesets, and zero PR status checks; `gh pr checks` therefore exits 1 with
  `no checks reported`. Release uses the explicitly owner-authorized local-gates +
  exact PR head/base freshness contract in R17, never a fictional green check.
- Official GitHub release state checked 2026-08-10 reports Actions Runner
  `v2.336.0` (published 2026-07-20) and macOS arm64 asset digest
  `sha256:8e8839c49b7060b6b2154f4931f815df330c27f167d53ef2239ee3dfce28b079`.
  GitHub documents that a manually managed runner more than 30 days behind (or
  missing a critical security update) stops receiving jobs:
  `https://docs.github.com/en/actions/reference/runners/self-hosted-runners`.

## Current State

The authoritative planning probe is retained outside the repository so it cannot
be confused with T0-v9 acceptance evidence:

| Artifact | Identity |
|---|---|
| script | `/Users/johnbaek/projects/Populus-ops/snapshots/evidence/m2-11/T0-v9-planning-probe.py`; 418 lines / 15,031 bytes; SHA-256 `835c6e201c6ab5a9db3b1dc532c00dc199686895f90e66a4a49cc5afa0d84c71` |
| successful log | `/Users/johnbaek/projects/Populus-ops/snapshots/evidence/m2-11/T0-v9-planning-probe-v4.log`; 19 lines / 3,068 bytes; SHA-256 `c2c5a7d4235e23827538a03b092252e1cf6b378fd77604c10e28f8c95b9dbe6f` |
| source | immutable snapshot v1, 23,058,628,608 bytes, mode 0444, SHA-256 `977a4d249d92590a4de2961a3e9c7ff8cfa2e4846f0097ec7aa6c07f28124121`, no journal/WAL/SHM before or after |
| runtime | SQLite 3.50.4; `THREADSAFE=1`, `TEMP_STORE=1`, `MAX_WORKER_THREADS=8`; threads 0 for base, exact readback 8 afterward |

Exact replay from the pinned worktree is:

```bash
PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1 .venv/bin/python \
  /Users/johnbaek/projects/Populus-ops/snapshots/evidence/m2-11/T0-v9-planning-probe.py \
  > NEW-APPEND-ONLY-PLANNING-LOG 2>&1
```

The script embeds the exact compact DDL and INSERT, uses only `TemporaryDirectory`
destinations, exercises the production immutable-source helper, captures SQLite
compile/runtime state, and compares every decoded value and every SQLite `typeof()`
across all 9,482,028 QoQ rows. Its v4 result is:

| Measured item | Result |
|---|---:|
| base materialization, threads 0 | 31.229 s |
| position preparation | 46.801 s |
| issuer preparation | 16.172 s |
| concentration preparation | 13.734 s |
| match / raw stages | 22.112 / 2.771 s |
| normal QoQ stream/write | 35.212 s |
| full normal aggregate | **197.133 s** |
| normal full artifact | 2,470,182,912 bytes |
| normal QoQ physical object | 2,299,068,416 bytes |
| compact QoQ artifact | 869,498,880 bytes |
| compact dictionary / insert | 4.389 / 11.610 s |
| projected full compact artifact | **1,040,613,376 bytes** |
| exact R12 headroom | **569,999,360 bytes** |
| report rows | 9,451 filers / 9,482,028 QoQ / 865,055 issuer / 45,138 concentration |

The exact logical digest of both old and decoded relations is
`50a3d9e3601cb3e2e95fee4923bb2e916f6869b7b6b46ad32c46dfc6d45cb570`;
the exact SQL-type digest of both is
`3686eb3b4eebc8786bf4551f3a7014d7f281bd5773e4f38b73e21a7df86571fa`.
The equality sweep took 440.038 seconds and is planning provenance, not charged to
either production phase. Moving the three measured preparation stages yields a
107.936-second materialization composition and removes 76.707 seconds from the
197.133-second current aggregate before compact-write savings; these are design
premises only. T0-v9 remains the sole binding proof of both 180-second phases.

The import-only first log, successful pre-digest v2 log, and failed v3 digest-helper
log remain append-only historical probes. They are neither cited for selection nor
eligible as T0-v9 acceptance evidence.

## Detected Stack

- **Languages:** Python ≥3.12 at root; TypeScript/Astro dashboard; SQLite/JSON1.
- **Python runner:** repository `.venv` for exact standing commands; `uv.lock`
  present and workflow uses `uv run`.
- **Node runner:** npm from `dashboard/package-lock.json`; Node ≥24.
- **Tests:** pytest, Node built-in runner, Astro check/build/post-build.
- **Canonical gates:** `make check`, `make accept-m1-b`, `make accept-m2-5`,
  `make accept-m2-6`, `make accept-m2-8`, `make accept-m2-11`.
- **SQLite:** 3.50.4, JSON1, `TEMP_STORE=1`, thread-safe, maximum eight workers.
- **Deployment:** GitHub Actions `data-publish`; self-hosted macOS publish job;
  hosted deploy/sign/assert jobs; Cloudflare Pages production verification.
- **Stack cache:** repository `CLAUDE.md` absent; detection refreshed from live
  manifests, Makefile, workflow, and runtime.

## Reuse Map

The full-tree scan included Markdown and excluded only generated/vendor trees. It
enumerated aggregate producers/schema/digest, serving, publish/manifest, MCP,
dashboard, acceptance, workflow/runbook, and every aggregate/snapshot test.

| Need | Reuse decision | Evidence/rationale |
|---|---|---|
| semantic oracle | preserve `_Position`, `_match_periods`, `_qoq_row`, `_issuer_rows`, `_concentration_rows` | only physical prepared/compact path changes |
| heavy stages | move/reuse `_create_position_stage`, `_create_issuer_stages`, `_create_concentration_stage` | no parallel SQL or alternate formulas |
| matching | reuse `_create_match_stages` unchanged | exact reviewed three-pass identity topology |
| cleanup/cache/deadline | extend `_BULK_TEMP_OBJECTS`, `_bulk_temp_cache`, existing guard adapters | one owner and existing primary-error rules |
| QoQ public contract | retain name/columns/SELECT consumers | view decodes private representation |
| row encoding | one compact encoder used by Python/bulk | prevents oracle/bulk physical forks |
| digest | extend existing projection metadata | no second digest implementation/version |
| production lifecycle | extend `_derive_inst_module` and exact T0 mirror | no alternate publisher |
| release | reuse existing PR and `data-publish` default-branch workflow | no direct Cloudflare/API deploy path |
| deployment checks | reuse committed runbook/controller/workflow assertions | execute reviewed controls rather than prose reinvention |

No new module, dependency, compression library, process manager, schema-version
mechanism, public query, artifact, deployment path, or duplicate aggregate exists;
the existing inst schema-version value advances from `1.0` to `1.1`.

## Architecture

### A. Outer prepared context

After the base materializer has frozen its exact namespace, the caller enters
`prepared_materialized_inst_aggregate`. The context captures threads/cache, enables
the reviewed settings, runs sign/share eligibility, and creates the current
position/issuer/concentration stages. It yields an opaque connection-bound token.
Its lifetime spans coverage, aggregate, serving, source COMMIT, and DETACH; its
finally runs after DETACH and owns all aggregate TEMP cleanup and exact setting
restoration. On no-ATTACH branches it runs immediately after transaction end.

### B. Prepared aggregate consumer

`build_inst_agg(..., _prepared=token)` validates active connection identity. On an
eligible token it creates only match/raw stages, writes compact outputs, reduces the
prepared issuer/concentration tables, records metadata, and commits the separate
destination connection. On a fallback token it invokes the Python oracle before a
destination exists. Without a token it performs the current self-owned flow.

### C. Compact relation

Private filer/period dictionaries are assigned in ascending text order. The private
QoQ backing table stores integer IDs/codes, numeric measures, and a flags bitmask in
the same logical primary key, `WITHOUT ROWID`. The public view joins dictionaries,
decodes fixed CASE expressions, reconstructs canonical flags, and reads one metadata
timestamp. It is read-only by design. All existing consumers read the view.

### D. Digest compatibility

The projection continues to name `agg_qoq_deltas`. Digest metadata supplies its
logical text key because a view has no physical PK declaration. Column and key
validation fail closed. Canonical rows are byte-identical, so version 1 remains.

### E. Release

The observable table→view/physical-PK/writability change is a same-MAJOR additive
contract evolution signaled by inst schema `1.1`. `INST_CLIENT_COMPAT` stays
`>=0.0.1,<1` because the exact baseline at the last released source SHA must install
and query it; this is executable proof, not an assumption from SELECT parity.
Exit-zero binding evidence unlocks QA. QA/docs approval unlocks staging and PR.
Only merged `main` unlocks the supervised workflow dispatch. The workflow—not a
new script—builds, deploys, signs, asserts, and verifies. Schedule validation is
armed only after the supervised run succeeds.

## Locked Decisions

1. Use exactly eight SQLite auxiliary workers only after base materialization.
2. Prepare exactly position, issuer, and concentration heavy stages; leave matching,
   raw rollup, final ranking/reduction, and compact writes in aggregate.
3. Keep standalone builder behavior and Python oracle; prepared reuse is private.
4. Compact only QoQ, the measured dominant 2.299 GB relation; other public tables
   stay physical tables.
5. Use filer/period dictionaries, integer enums/flags, and `WITHOUT ROWID`; do not
   add a position dictionary because the selected shape already has 570 MB R12
   projected headroom and avoids a new high-cardinality dictionary/index.
6. Publish a read-only compatibility view; do not change application query SQL.
7. Bump inst schema `1.0`→`1.1`, retain client compatibility only after the exact
   base client passes, and keep logical projection version 1 because decoded
   canonical bytes do not change.
8. Keep 32 KiB destination pages, 256 MiB cache hints, and durability settings.
9. T0-v9 is the sole binding run; no retry or renamed post-failure run without a
   newly reviewed/authorized delta.
10. Use three standard plan-review rounds plus the single owner-authorized
    exceptional scope-convergence round in R16; use at most three QA-review rounds.
11. Release via one reviewed cumulative PR and the existing default-branch workflow.
12. Set scheduled-validation variable only after supervised deployment success.
13. Because this repository has no remote PR checks/protection, use the owner-approved
    zero-check path with explicit disclosure, full fresh local gates/T0/QA/docs, exact
    head/base SHAs, clean state, and mergeability; do not add an unreviewed CI workflow.

## Alternatives Considered

- **Workers during base materialization:** rejected as an unnecessary expansion of
  the retained, source-safe threads=0 base scope; the successful v4 evidence enables
  and verifies workers only after base completion.
- **Workers alone:** rejected; retained v4 still measures the current aggregate at
  197.133 seconds and the artifact at 2.47 GB.
- **Old table plus post-build compact copy:** rejected; doubles write work/disk and
  cannot meet aggregate bound.
- **Preserve the public physical table:** rejected with owner authorization because
  its measured 2,299,068,416-byte object makes the complete artifact exceed R12;
  the observable change is instead signaled as schema `1.1` and compatibility-gated.
- **Archive compression (`zstd`/gzip):** rejected; every SQLite consumer would need
  decompression lifecycle and the runtime artifact would still exceed R12.
- **Position dictionary:** rejected; the measured selected layout already has
  569,999,360 bytes of R12 headroom and one fewer high-cardinality map/index.
- **Change/omit rows or fields:** rejected; changes public semantics/digest.
- **Writable ATTACH on the source connection:** rejected; couples destination commit
  to the source transaction and violates R16 lifecycle.
- **Parallel processes/threads with a copied TEMP database:** rejected; additional
  cache identity, cancellation, disk, process cleanup, and merge debt is unnecessary.
- **TEMP in memory or unsafe journal pragmas:** rejected as unbounded/unsafe.
- **Longer phase bound or relabeling preparation after T0:** rejected; evidence must
  remain honest and phase attribution executable.
- **Invent or add PR CI inside this delta:** rejected; live state has no such check,
  and a new workflow would be a distinct release-control change. Owner instead
  authorizes the explicit zero-check path backed by the complete local/independent
  evidence and exact GitHub SHA freshness contract.

## Planned Files

| File | Action | Requirements |
|---|---|---|
| new plan | add/revise only for review | R16 |
| `src/populus/inst_agg.py` | prepared context/token, compact writer, reuse/cleanup | R1-R9, R11-R13 |
| `src/populus/inst_agg.sql` | private compact tables + public view | R7-R9, R11 |
| `src/populus/publish/build.py` | enter/pass prepared context | R4, R17 |
| `scripts/measure_inst_derive.py` | exact phase entry/pass and v9 evidence | R1, R4, R15 |
| `src/populus/publish/digests.py` | logical key metadata/view validation | R10 |
| `src/populus/publish/manifest.py`, `ARCHITECTURE.md` | inst schema 1.1 classification and compatibility policy | R11 |
| `STATUS.md` | parent-required M2-11 run entry with factual T0/QA/release state | R16,R17 |
| `docs/runbooks/self-hosted-runner.md` | current runner 2.336.0 URL/checksum/freshness/readback | R17 |
| `src/populus/inst_serving.py` | table-or-view discovery | R11 |
| `dashboard/test/post/fixture-preview.test.ts` | preview manifest expects inst schema 1.1 | R11,R14 |
| focused test files | semantic/lifecycle/consumer/release regression | R12-R14 |
| findings + T0-v9 log | append-only binding record | R15, R18 |
| `docs/build/RUN-M2-11-devnotes.md`, `docs/build/RUN-M2-11-qa-report.md` | fresh workflow bundle after T0 success | R16-R17 |

The exact cumulative release allowlist is the following fixed set. The two fresh
workflow records are mandatory after successful T0, not vague conditional files:

```text
.github/workflows/publish.yml
ARCHITECTURE.md
Makefile
STATUS.md
docs/build/RUN-M2-11-T0-affiliation-index-delta-plan.md
docs/build/RUN-M2-11-T0-aggregate-performance-delta-plan.md
docs/build/RUN-M2-11-T0-aggregate-throughput-delta-plan.md
docs/build/RUN-M2-11-T0-coverage-delta-plan.md
docs/build/RUN-M2-11-T0-coverage-totals-delta-plan.md
docs/build/RUN-M2-11-T0-findings.md
docs/build/RUN-M2-11-T0-materialization-reuse-delta-plan.md
docs/build/RUN-M2-11-T0-prepared-compact-aggregate-delta-plan.md
docs/build/RUN-M2-11-T0-serving-materialization-delta-plan.md
docs/build/RUN-M2-11-devnotes.md
docs/build/RUN-M2-11-qa-report.md
docs/runbooks/self-hosted-runner.md
dashboard/test/post/fixture-preview.test.ts
scripts/accept_m2_11.py
scripts/measure_inst_derive.py
src/populus/amendments.py
src/populus/ingest/inst13f.py
src/populus/inst_agg.py
src/populus/inst_agg.sql
src/populus/inst_serving.py
src/populus/publish/build.py
src/populus/publish/digests.py
src/populus/publish/manifest.py
tests/test_cover_tolerance.py
tests/test_digests.py
tests/test_inst_agg.py
tests/test_inst_external_store.py
tests/test_inst_serving.py
tests/test_inst_snapshot_script.py
tests/test_pointer_state.py
tests/test_publish.py
tests/test_workflow_governance.py
```

Every listed path must be present in the final changed inventory. Any missing or
additional path stops release and returns the inventory to docs review. The exact
cached-name equality/refusal commands are in Rollout / Rollback.

## Implementation Tasks

- **T1 [R2,R3,R5,R6]:** Implement the opaque prepared token/context, worker/cache scope,
  exact eligibility, heavy-stage creation/reuse, and outer ownership cleanup.
- **T2 [R1,R4]:** Wire production and T0 materialization scopes to enter preparation
  under the existing guard and pass the token without changing transaction order.
- **T3 [R7,R8,R9]:** Replace QoQ physical DDL, implement deterministic dictionaries,
  codes/checks/mask, shared compact encoder/insert, public decode view, and metadata.
- **T4 [R10-R11]:** Extend digest logical-key validation and serving discovery;
  bump inst schema to 1.1, add the base-SHA client compatibility gate, sweep every
  consumer including the fixture-preview manifest assertion, and keep public
  reads/client range unchanged.
- **T5 [R12]:** Add exhaustive public-row/type/digest parity including codes, flags,
  NULLs, boundaries, fallback, issuer/concentration, and oracle/prepared artifacts.
- **T6 [R13]:** Add preparation timing-order spies, setting restoration, token misuse,
  failure cleanup, single-stage creation, physical-schema, no-parallel-table, and
  read-only-view tests.
- **T7 [R14]:** Run focused and expanded targeted tests after the final source edit;
  fix and repeat until green.
- **T8 [R14]:** Run diff and six canonical commands separately; record exact results
  and fresh 8,106 dashboard file count.
- **T9 [R15,R18]:** Recheck all hashes/state and v9 absence; run exact binding once;
  hash/reconcile the log and snapshot; append complete findings.
- **T10 [R16]:** On exit zero, write fresh Dev Notes/QA report/bundle and run up to
  three independent QA rounds, batching fixes and invalidating evidence correctly.
- **T11 [R16,R17]:** Reconcile release docs/evidence and the parent-required
  `STATUS.md` M2-11 entry, then obtain read-only docs review.
- **T12 [R17]:** Verify staged inventory, commit, push, open PR, assert/disclose zero
  status checks, bind exact PR head and freshly fetched base SHAs, require clean
  non-draft mergeability, and squash-merge with head-match protection.
- **T13 [R17,R18]:** Update the runbook and its governance proof to runner 2.336.0
  with literal checksum; recheck the official latest-release tag/asset/digest and
  installed listener version; then run the controller preflight. If absent, execute
  and validate owner-only self-hosted-runner runbook §§1–6 before any repository-variable
  mutation; otherwise stop. Set the snapshot variable, capture the exact dispatch
  URL/ID, watch that ID with failure-sensitive exit, verify artifact/pages/source,
  then arm scheduled validation and record deployment evidence.

## Testing Strategy

Focused:

```bash
PYTHONDONTWRITEBYTECODE=1 .venv/bin/python -m pytest -q \
  tests/test_inst_agg.py tests/test_digests.py tests/test_inst_serving.py \
  tests/test_inst_snapshot_script.py
```

Expanded targeted adjunct:

```bash
PYTHONDONTWRITEBYTECODE=1 .venv/bin/python -m pytest -q \
  tests/test_inst_agg.py tests/test_cover_tolerance.py \
  tests/test_inst_external_store.py tests/test_inst_snapshot_script.py \
  tests/test_inst_serving.py tests/test_inst_serving_artifact.py \
  tests/test_digests.py tests/test_publish.py tests/test_amendments.py \
  tests/test_mcp_server_inst.py tests/test_inst_federated_boundary.py \
  tests/test_pointer_state.py
```

Previously released client/schema compatibility (the named test extracts the
client package from the exact base SHA into a temporary directory, runs it in a
subprocess against an authenticated local `inst` 1.1 build, and asserts installation,
`db_path()`, all four public SELECTs, and the read-only QoQ view):

```bash
POPULUS_PREVIOUS_CLIENT_SHA=7391d947f72cf408a173f1e7938102608b2269d4 \
  PYTHONDONTWRITEBYTECODE=1 .venv/bin/python -m pytest -q \
  tests/test_pointer_state.py -k inst_schema_1_1_previous_client
```

Focused dashboard producer/consumer schema propagation:

```bash
cd dashboard && node --test --test-concurrency=1 test/post/fixture-preview.test.ts
```

Focused runner-bootstrap governance after the runbook update:

```bash
PYTHONDONTWRITEBYTECODE=1 .venv/bin/python -m pytest -q \
  tests/test_workflow_governance.py -k 'runner and (version or checksum or toolchain)'
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

Binding T0-v9:

```bash
PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1 .venv/bin/python \
  scripts/measure_inst_derive.py \
  --snapshot /Users/johnbaek/projects/Populus-ops/snapshots/inst-source-v1.db \
  --measured-files 8106 \
  --pilot-filers 500 \
  --full \
  > /Users/johnbaek/projects/Populus-ops/snapshots/evidence/m2-11/T0-v9.log 2>&1
```

The exact path-absence check occurs immediately before shell redirection. The
process exit is captured directly. No `tail`/`tee`/pipeline masks it. A final fresh
`make check` must independently report 8,106; drift forces plan review rather than
an ad-hoc argument change.

Runner/controller preflight is literal and precedes every variable mutation. It
must return exactly one online runner with all three labels and a live root-owned
controller; otherwise no variable or workflow is touched and the owner executes
committed self-hosted-runner runbook §§1–6 in order, including its account/ACL,
credential, runner-image, checksummed-toolchain, launchd, and power validations,
then reruns this block:

```bash
release_repo=johnbaekk-spec/populus
runner_tag=$(gh api repos/actions/runner/releases/latest --jq .tag_name)
runner_asset=actions-runner-osx-arm64-2.336.0.tar.gz
runner_digest=$(gh api repos/actions/runner/releases/latest --jq \
  ".assets[] | select(.name == \"$runner_asset\") | .digest")
test "$runner_tag" = v2.336.0
test "$runner_digest" = \
  sha256:8e8839c49b7060b6b2154f4931f815df330c27f167d53ef2239ee3dfce28b079
test "$(gh repo view "$release_repo" --json defaultBranchRef \
  --jq .defaultBranchRef.name)" = main
test "$(gh api "repos/$release_repo/actions/runners" --jq \
  '[.runners[] | select(.status == "online") |
    select(([.labels[].name] | contains(["self-hosted","macOS","populus-ops"])))] |
    length')" = 1
sudo test -x /usr/local/populus-runner/controller/runner-controller.sh
sudo test -r /usr/local/populus-runner/controller/runner-image.tar.gz
sudo test -r /usr/local/populus-runner/controller/toolchain.manifest
sudo test "$(stat -f '%Su:%Sg:%Lp' /usr/local/populus-runner/controller)" = root:wheel:700
test "$(sudo /usr/local/populus-runner/roots/active/bin/Runner.Listener --version)" = 2.336.0
sudo launchctl print system/com.populus.runner-controller >/dev/null
pmset -g | grep -Eq ' sleep +0'
pmset -g | grep -Eq ' autorestart +1'
test "$(gh variable get POPULUS_PUBLISH_ARMED --repo "$release_repo" --json value --jq .value)" = true
test "$(gh variable get POPULUS_RECORD_SIGN_ARMED --repo "$release_repo" --json value --jq .value)" = true
```

If any line fails, stop before repository-variable mutation. Provisioning is not
optional; credential contents are accepted only through the runbook's hidden stdin
step and are never printed, placed in argv, or written under the runner account.

After merged-main and a repeated green preflight, dispatch and bind the exact run:

```bash
release_repo=johnbaekk-spec/populus
snapshot=/Users/johnbaek/projects/Populus-ops/snapshots/inst-source-v1.db
merged_sha=$(gh api "repos/$release_repo/commits/main" --jq .sha)
test "$merged_sha" = "$(git rev-parse origin/main)"
gh variable set POPULUS_INST_DB --repo "$release_repo" --body "$snapshot"
test "$(gh variable get POPULUS_INST_DB --repo "$release_repo" --json value --jq .value)" = "$snapshot"
run_url=$(gh workflow run publish.yml --repo "$release_repo" --ref main)
case "$run_url" in
  https://github.com/johnbaekk-spec/populus/actions/runs/*) ;;
  *) echo "dispatch returned no exact run URL; STOP" >&2; exit 1 ;;
esac
run_id=${run_url##*/}
test "$(gh run view "$run_id" --repo "$release_repo" --json headSha --jq .headSha)" = "$merged_sha"
test "$(gh run view "$run_id" --repo "$release_repo" --json event --jq .event)" = workflow_dispatch
test "$(gh run view "$run_id" --repo "$release_repo" --json workflowName --jq .workflowName)" = data-publish
gh run watch "$run_id" --repo "$release_repo" --exit-status
gh run view "$run_id" --repo "$release_repo" --exit-status \
  --json status,conclusion,headSha,event,url,jobs > /tmp/populus-m2-11-run.json
.venv/bin/python - <<'PY'
import json
from pathlib import Path
run = json.loads(Path('/tmp/populus-m2-11-run.json').read_text())
assert run['status'] == 'completed' and run['conclusion'] == 'success', run
assert run['jobs'] and all(j['conclusion'] == 'success' for j in run['jobs']), run['jobs']
PY
```

The exact-run functional/source verification and final schedule arm are:

```bash
verify_root=$(mktemp -d)
gh repo clone johnbaekk-spec/populus-data "$verify_root/populus-data" -- --depth 1
GH_TOKEN="$(gh auth token)" GH_REPO=johnbaekk-spec/populus-data \
  uv run populus verify --data-repo "$verify_root/populus-data" --attestation=sigstore
build_id=$(jq -er .build_id "$verify_root/populus-data/latest.json")
manifest="$verify_root/populus-data/builds/$build_id/manifest.json"
source_doc="$verify_root/populus-data/builds/$build_id/inst_source.json"
jq -e '.modules.inst.schema_version == "1.1" and
       .modules.inst.client_compat == ">=0.0.1,<1"' "$manifest"
jq -e '.snapshot_sha256 ==
  "977a4d249d92590a4de2961a3e9c7ff8cfa2e4846f0097ec7aa6c07f28124121"' \
  "$source_doc"
curl -fsS "https://publicfilings.org/?m2-11=$run_id" -o "$verify_root/root.html"
curl -fsS "https://publicfilings.org/institutional/?m2-11=$run_id" \
  -o "$verify_root/institutional.html"
curl -fsS "https://publicfilings.org/institutional/data/filers/index.v1.json?m2-11=$run_id" \
  -o "$verify_root/filers.json"
grep -Fq "populus:code_sha\" content=\"$merged_sha\"" "$verify_root/root.html"
grep -Fq 'Institutional' "$verify_root/institutional.html"
jq -e '.v == 1 and .kind == "filer-index" and .absent == null and
       (.shards | type == "object" and length > 0)' "$verify_root/filers.json"
filer_cik=$(jq -er '.shards | keys[0]' "$verify_root/filers.json")
filer_shard=$(jq -er --arg cik "$filer_cik" '.shards[$cik]' "$verify_root/filers.json")
curl -fsS "https://publicfilings.org/institutional/data/filers/${filer_shard}.v1.json?m2-11=$run_id" \
  -o "$verify_root/filer-shard.json"
jq -e --arg cik "$filer_cik" \
  '.v == 1 and .kind == "filer-shard" and
   (.entries | type == "object" and length > 0) and
   (.entries[$cik].v == 1) and (.entries[$cik].kind == "filer") and
   (.entries[$cik].cik == $cik) and
   (.entries[$cik].filerName | type == "string" and length > 0)' \
  "$verify_root/filer-shard.json"
filer_unpadded=$(.venv/bin/python -c 'import sys; print(int(sys.argv[1]))' "$filer_cik")
curl -fsS "https://publicfilings.org/e/?k=f:${filer_unpadded}&m2-11=$run_id" \
  -o "$verify_root/filer-page.html"
grep -Fq 'id="entity-root"' "$verify_root/filer-page.html"
grep -Fq "populus:code_sha\" content=\"$merged_sha\"" "$verify_root/filer-page.html"
test "$(shasum -a 256 "$snapshot" | awk '{print $1}')" = \
  977a4d249d92590a4de2961a3e9c7ff8cfa2e4846f0097ec7aa6c07f28124121
gh variable set POPULUS_SELFHOSTED_VALIDATED --repo "$release_repo" --body true
test "$(gh variable get POPULUS_SELFHOSTED_VALIDATED --repo "$release_repo" \
  --json value --jq .value)" = true
```

Before the final variable set, the fresh clone's authenticated manifest and
`inst_source.json` must name schema `1.1`, the same build/run code SHA, and snapshot
SHA above; the deployment log records those exact values. Any dispatch/watch/job,
attestation, source, page, JSON, or marker failure runs these rollback commands and
verifies both variables are absent before stopping:

```bash
gh variable delete POPULUS_SELFHOSTED_VALIDATED --repo "$release_repo" 2>/dev/null || :
gh variable delete POPULUS_INST_DB --repo "$release_repo"
! gh variable list --repo "$release_repo" --json name --jq '.[].name' |
  grep -Eq '^(POPULUS_INST_DB|POPULUS_SELFHOSTED_VALIDATED)$'
```

## Verification Matrix

| Req | Executable proof |
|---|---|
| R1 | v9 full phase timings both <180 with unchanged constants |
| R2 | trace/readback/restore tests + T0 ordering |
| R3 | token identity/activity/namespace tests; one stage count |
| R4 | production/T0 spies prove BEGIN→base→prepare→coverage→aggregate→serving→COMMIT→DETACH→cleanup plus no-ATTACH branches |
| R5 | signed/overflow fixtures invoke Python before destination |
| R6 | injected setup/select/write/commit/timeout/cleanup failures leave no residue |
| R7 | sqlite schema/SQL tests prove private coded `WITHOUT ROWID` backing + checks |
| R8 | complete public rows/typeof/flags/ingested parity |
| R9 | oracle and bulk share encoder; trace proves no normal QoQ table/copy/per-row lookup |
| R10 | old-table/compact-view independent digest equality and invalid-schema refusals |
| R11 | full consumer grep + schema 1.1 manifest/fixture-preview + exact-base-client install/query gate |
| R12 | exhaustive semantic fixture/artifact/report comparisons |
| R13 | physical/lifecycle fail-if-removed suite |
| R14 | focused, targeted, diff, six canonical exits zero |
| R15 | absent-then-created one-shot log; D1/R12/serving/tail complete |
| R16 | exact plan approval; fresh QA approval; docs approval; max counts |
| R17 | STATUS + runner proof + exact staged diff + disclosed zero-check PR head/base/mergeability + supervised functional run |
| R18 | pre/post snapshot/log hashes/mode/sidecars exact |

## Rollout / Rollback

1. Independent plan approval.
2. Allowlisted implementation and tests.
3. Complete local gates.
4. One binding T0-v9 and append-only evidence.
5. Exit-zero-only QA/docs reviews.
6. Exact cumulative stage/commit/push/PR/check/squash merge.
7. Read-only runner/controller preflight; set snapshot variable.
8. Supervised `main` dispatch; verify deployment/signature/function.
9. Set scheduled-validation variable only after success.

After docs approval, release staging is literal and fail-closed. The array repeats
the Planned Files allowlist deliberately so the command does not infer scope from a
dirty worktree:

```bash
release_allowlist=(
  .github/workflows/publish.yml
  ARCHITECTURE.md
  Makefile
  STATUS.md
  docs/build/RUN-M2-11-T0-affiliation-index-delta-plan.md
  docs/build/RUN-M2-11-T0-aggregate-performance-delta-plan.md
  docs/build/RUN-M2-11-T0-aggregate-throughput-delta-plan.md
  docs/build/RUN-M2-11-T0-coverage-delta-plan.md
  docs/build/RUN-M2-11-T0-coverage-totals-delta-plan.md
  docs/build/RUN-M2-11-T0-findings.md
  docs/build/RUN-M2-11-T0-materialization-reuse-delta-plan.md
  docs/build/RUN-M2-11-T0-prepared-compact-aggregate-delta-plan.md
  docs/build/RUN-M2-11-T0-serving-materialization-delta-plan.md
  docs/build/RUN-M2-11-devnotes.md
  docs/build/RUN-M2-11-qa-report.md
  docs/runbooks/self-hosted-runner.md
  dashboard/test/post/fixture-preview.test.ts
  scripts/accept_m2_11.py
  scripts/measure_inst_derive.py
  src/populus/amendments.py
  src/populus/ingest/inst13f.py
  src/populus/inst_agg.py
  src/populus/inst_agg.sql
  src/populus/inst_serving.py
  src/populus/publish/build.py
  src/populus/publish/digests.py
  src/populus/publish/manifest.py
  tests/test_cover_tolerance.py
  tests/test_digests.py
  tests/test_inst_agg.py
  tests/test_inst_external_store.py
  tests/test_inst_serving.py
  tests/test_inst_snapshot_script.py
  tests/test_pointer_state.py
  tests/test_publish.py
  tests/test_workflow_governance.py
)
expected=$(mktemp)
actual=$(mktemp)
cached=$(mktemp)
printf '%s\n' "${release_allowlist[@]}" | LC_ALL=C sort -u > "$expected"
{ git diff --name-only HEAD; git ls-files --others --exclude-standard; } |
  LC_ALL=C sort -u > "$actual"
cmp "$expected" "$actual" || { echo 'release inventory drift; STOP' >&2; exit 1; }
git add -- "${release_allowlist[@]}"
git diff --cached --name-only | LC_ALL=C sort -u > "$cached"
cmp "$expected" "$cached" || { echo 'cached inventory drift; STOP' >&2; exit 1; }
test -z "$(git diff --name-only)"
test -z "$(git ls-files --others --exclude-standard)"
git diff --cached --check
```

Commit/PR/merge is likewise bound to the staged set and exact PR:

```bash
git commit -m 'feat(inst): complete M2-11 publication'
release_commit=$(git rev-parse HEAD)
test -z "$(git status --porcelain=v1)"
git fetch origin main
release_base=$(git rev-parse origin/main)
git push --set-upstream origin codex/m2-11-t0-finalize
pr_url=$(gh pr create --repo johnbaekk-spec/populus --base main \
  --head codex/m2-11-t0-finalize --title 'feat(inst): complete M2-11 publication' \
  --body 'Owner-authorized M2-11 aggregate completion; see reviewed plan, Dev Notes, and QA report.')
test -n "$pr_url"
test "$(gh pr view "$pr_url" --json headRefOid --jq .headRefOid)" = "$release_commit"
test "$(gh pr view "$pr_url" --json baseRefOid --jq .baseRefOid)" = "$release_base"
test "$(gh pr view "$pr_url" --json statusCheckRollup --jq '.statusCheckRollup | length')" = 0
test "$(gh pr view "$pr_url" --json isDraft --jq .isDraft)" = false
test "$(gh pr view "$pr_url" --json state --jq .state)" = OPEN
test "$(gh pr view "$pr_url" --json mergeable --jq .mergeable)" = MERGEABLE
git fetch origin main
test "$(git rev-parse origin/main)" = "$release_base"
gh pr merge "$pr_url" --squash --match-head-commit "$release_commit"
test "$(gh pr view "$pr_url" --json state --jq .state)" = MERGED
merge_sha=$(gh pr view "$pr_url" --json mergeCommit --jq .mergeCommit.oid)
git fetch origin main
test "$(git rev-parse origin/main)" = "$merge_sha"
```

Before merge, rollback is normal targeted source/test edits followed by fresh gates.
After merge but before dispatch, unset `POPULUS_INST_DB` and do not dispatch. During
or after deployment, the existing workflow/runbook rollback applies: unset
`POPULUS_SELFHOSTED_VALIDATED` first, unset `POPULUS_INST_DB` to restore the
congress-only build path, and use the existing verified published-build rollback—
never mutate or restore snapshot v1. No automatic action bypasses a failed signer,
attestation, or served-tree verification.

## Simplicity Audit

Minimum coherent runtime change:

- one private prepared-token dataclass/context;
- one fixed worker count and existing cache/deadline helpers;
- reuse of three existing stage creators;
- three small private physical QoQ tables and one public compatibility view;
- one compact row encoder/insert;
- one logical-key metadata map in the existing digest module;
- two existing orchestrators extended to enter/pass the context;
- one discovery predicate widened from table to table-or-view.

No new module, dependency, CLI flag, config, artifact, public function, worker pool,
alternate digest, deployment script, or application query is introduced. The one
existing schema value changes to 1.1 without adding a migration mode. Every changed
symbol and both fresh workflow records are enumerated above.

## Tech Debt Introduced

### TD-C1 — Fixed eight-worker preparation scope

- **Debt:** the worker count is fixed to the current SQLite maximum rather than
  adaptive host tuning.
- **Impact:** another SQLite build/host may expose fewer workers or regress.
- **Mitigation:** exact readback fails closed; setting is connection-local/restored;
  existing resource preflight and binding corpus prove this host.
- **Removal:** separately reviewed cross-host evidence or a lower portable value.

### TD-C2 — Private coded QoQ physical schema behind a public view

- **Debt:** maintainers must update fixed code/flag decode tables when the public
  vocabulary changes; schema 1.1 consumers can also observe that QoQ is read-only
  and has no PRAGMA-declared physical PK.
- **Impact:** an unpropagated new enum/flag is rejected instead of publishing, and
  an arbitrary SQLite consumer that wrote the old aggregate table must adapt.
- **Mitigation:** CHECK constraints, exhaustive code tests, independent digest parity,
  aggregate version 2, explicit inst schema 1.1, exact-base-client gate, unchanged
  compatibility range only on success, and explicit consumer sweep.
- **Removal:** only when R12 no longer applies or a future aggregate version replaces
  the public contract through a separately reviewed migration.

No hidden TODO, stub, disabled test, duplicate full-size table, decompression step,
timeout waiver, unsafe PRAGMA, retry, semantic fork, or ignored failure is introduced.
Pre-existing top-N truncation, snapshot-retention obligation, self-hosted trust limits,
and time-based consecutive-nightly deployment evidence remain declared parent debt.

## Memory Touch-Points

The memory index and mandatory failure catalog were loaded. The exact selector was:

```bash
/Users/johnbaek/projects/orchestrate-tool/lib/memory-select.sh \
  /Users/johnbaek/.claude/projects/-Users-johnbaek/memory/MEMORY.md \
  aggregate sqlite performance timeout materialization worker-threads \
  compact-storage compression without-rowid logical-digest view bulk \
  high-cardinality deployment
```

It returned exactly five files, all read completely:

- `feedback_bulk_sql_for_backfills.md` — fixed bulk cursor/executemany and one
  compact encoder; no per-row SQL dictionary lookup or post-copy compaction.
- `feedback_supervised_deployment_dry_run_inspection.md` — requires real
  supervised dispatch and functional institutional output inspection before arming.
- `feedback_auto_fallback_alert_pattern.md` — prepared fallback stays explicit in
  token/test/evidence rather than silently degrading to the oracle.
- `feedback_postdeployment_debt_worse_pattern.md` — comments/docs/consumer sweeps
  and hidden debt are reconciled before merge/deploy; only factual operational
  results are recorded afterward.
- `feedback_preexisting_debt_regating.md` — the entire current bulk/digest tree is
  re-gated under `make check` and all standing acceptance targets.

## Failure-Mode Sweep

| Catalog | Prevention/proof |
|---|---|
| F0 full-set sweep | all producers, four projected relations, digest, serving, MCP, dashboard, publish, workflow, docs, acceptance, and tests enumerated |
| F0 secrets | no token/variable values logged; credentials remain workflow/CLI scoped |
| F0 verify | full real-corpus timings/bytes and later binding evidence, not pilot inference |
| F1 all consumers | exact public view consumer scan and negative allowlist |
| F1 exact gates | focused, expanded targeted, diff, six canonical, T0, QA/docs, PR/deploy checks literal |
| F1 units/NULL | seconds, bytes, GiB, codes, SQL types, NULL, flag ordering explicit |
| F1 locked choice | thirteen decisions and rejected alternatives leave one path |
| F2 full-tree scope | new schema/digest code receives full `make check`, not adjunct-only proof |
| F2 deploy bridge | existing executable workflow/runbook is invoked and watched |
| F2 behavioral validity | removal of preparation/compact view/key metadata/restore causes named failures |
| F2 bulk SQL | no per-row SQL or normal-table compaction copy |
| F2 stale comments | schema/module/digest/orchestrator comments reconciled before QA |
| F3 end-to-end | immutable snapshot→aggregate→serving→site→deploy/sign/verify→live page |
| F3 doc numbers | hashes/counts/timings/bytes/SHAs reconciled from actual outputs |
| F4 propagation | every review fix swept through requirements/tasks/tests/matrix/DoD |
| F4 QA batching | all findings fixed together, full freshness rebuilt, never self-signed |
| F5 transport/freshness | any source/base repair invalidates gates/T0/QA/docs/PR evidence |

## Definition of Done

- [ ] R1, R2, R3, R4, R5, and R6 prepared lifecycle, bounds, fallback, cleanup,
  and transaction proofs pass.
- [ ] R7, R8, R9, R10, and R11 compact physical schema decodes exact public rows,
  schema version/client compatibility, dashboard preview, and digest across all
  consumers.
- [ ] R12 and R13 semantic and fail-if-removed lifecycle/physical tests pass.
- [ ] R14 focused/targeted/diff and all six canonical commands exit zero after final source edit.
- [ ] R15 T0-v9 exists once, exits zero, reports both phases <180, D1 PASS,
  aggregate ≤1,610,612,736 bytes, complete serving/tail PASS, and exact findings.
- [ ] R16 independent plan, QA, and docs verdicts approve current artifacts within caps.
- [ ] R17 parent-required `STATUS.md` entry and exact cumulative diff are
  committed/pushed, zero remote checks are explicitly asserted, exact clean PR
  head/base/mergeability is proven, and the PR is squash-merged; official/installed
  runner 2.336.0 freshness and checksum pass; supervised main dispatch builds,
  deploys, signs, asserts, and passes real functional probes; scheduled validation
  is armed only afterward.
- [ ] R18 snapshot v1 and T0-v8 remain exact and sidecar-free; no evidence overwritten.
- [ ] All introduced and inherited debt is visible; no hidden TODO/stub/disabled test.
- [ ] Deployment evidence records merged SHA, workflow run/build IDs, artifact hashes/
  bytes, source hash corroboration, served URLs/function, and rollback readiness.

Implementation begins only after independent `plan-review` returns
`VERDICT: APPROVED` for this file's exact final SHA-256.
