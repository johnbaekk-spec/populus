# RUN M2-11 T0 full-corpus serving-performance completion delta (plan-v1)

**Artifact:** plan-v1 delta · **Transport:** interactive-disk · **Status:** IN REVIEW;
round-2 approved the runtime design; a development-discovered vacuous governance
filter is corrected below and awaits final round-3 convergence review; further
implementation and T0 remain paused until approval ·
**Owner authorization:** 2026-08-10, exact instruction authorizing a new
owner-reviewed serving-performance delta and the append-only T0-v10 binding run,
followed by implementation → T0-v10 → QA/fixes (maximum three rounds) → docs
review → PR → supervised deployment · **Branch/base:**
`codex/m2-11-t0-finalize` at `7391d947f72cf408a173f1e7938102608b2269d4`,
which is an ancestor of fetched `origin/main`
`21340330a0fad7e9e39c1a9cec67656643621b05`, plus the preserved cumulative
unstaged M2-11/T0 implementation and append-only findings · **Scope class:**
L/high-risk full-corpus SQLite derivation and supervised publication.

T0-v9 proved that the prepared compact aggregate fixed the named aggregate
timeout, but its subsequent serving phase hit the unchanged 180-second execution
guard. The retained failure is exact and immutable: T0-v9 SHA-256
`0e17959ef5552eb03655948c4111da2f030008f9890b22e1c707dc4f8d2dfec8`,
exit 4, with `STOP: SQLite execution bound (180s) interrupted phase serving`.
It will never be retried or overwritten.

Two disposable, append-only planning probes then separated the failure modes.
V1 proved the compact QoQ iterator is exact and faster on the 500-filer pilot,
but the full projection timed out earlier, in the third repeated holdings scan.
It also showed the unchanged materialization phase can fluctuate above its former
0.985-second headroom. V2 combined all holding-derived serving work into one
ordered pass and deferred only the already-existing concentration staging into
the aggregate phase. It exited zero with exact pilot projection identity and
full times of 146.595 seconds materialization, 140.057 seconds aggregate, and
77.702 seconds serving. These are design premises, not binding acceptance;
T0-v10 remains the sole certifying run.

## Goal and Success Criteria

Finish M2-11 without widening any semantic, safety, resource, or timeout contract.
The delta must eliminate repeated full-corpus holding scans in serving, preserve
the public schema-1.1 aggregate view, and restore stable phase headroom by moving
one existing preparation substage to the phase that consumes it.

Success requires all of the following:

1. The serving projection performs one high-cardinality reported-holdings pass
   for filer rows, issuer-holder membership, default-only issuer totals, and
   activity display fields; no second scan of either holdings view remains.
2. Schema-1.1 activity rows stream from the producer-owned compact backing with
   exact public decoding and deterministic historical ordering; legacy/public
   aggregates retain a tested fallback, and a selected period with no QoQ rows
   remains a legitimate empty activity stream.
3. Every projected row, list order, SQLite value type, NULL, integer, key,
   canonical flag array, filing reference, aggregate digest, serving digest, and
   public schema remains unchanged.
4. Concentration staging is created exactly once inside aggregate execution,
   remains progress-handler-cancellable, and is cleaned on success and every
   failure path.
5. All focused, complete-tree, dashboard, compatibility, acceptance, and
   immutability gates pass after the final source edit.
6. One append-only T0-v10 exits zero and reports materialization, aggregate, and
   serving each below 180.000 seconds, aggregate bytes at or below exactly
   1,610,612,736, complete D1 equality, R12, tail geometry, and file headroom.
7. Fresh workflow evidence receives independent QA approval within at most three
   rounds and read-only docs approval before release.
8. The exact cumulative inventory is committed, pushed, reviewed, squash-merged,
   and deployed from `main`; functional institutional publication, artifact
   signatures, source/code bindings, a real shard, and a real filer page pass
   before scheduled validation is armed.

## Requirements

- **R1 — One holding pass.** `build_serving_projection` must combine the current
  filer-row, reported issuer-holder, default-only issuer-total, and activity-display
  derivations in one ordered query over `v_filer_reported_holdings`, joined once
  to `securities` and `v_default_inst_filings`. The query remains restricted to
  the exact explicit two publication periods and ordered by
  `(cik, period_of_report, holding_id)`.
- **R2 — Exact combined semantics.** The combined pass must preserve complete
  filer rows, issuer buckets, security counts, filing-key sets, affiliation-group
  keys, undisclosed-value behavior, default-only deduplicated totals, canonical
  issuer/display selection, position keys, put/call buckets, unit keys, flags,
  row order, and NULL/integer types.
- **R3 — Producer-owned compact iterator.** Compact code/flag decoding stays in
  `inst_agg.py`, beside the encoder maps. For each selected current-period ID it
  scans the existing WITHOUT-ROWID backing in primary-key order, buffers at most
  the schema-bounded nine put/call×unit rows per `(filer_id, position_key)`, sorts
  that tiny group by decoded text order, and `heapq.merge`s period streams by the
  unchanged activity order `(cik, curr_period, position_key, put_call,
  ssh_prnamt_type)`. A selected period absent from `_agg_qoq_periods` contributes
  an empty stream when no backing row references it; in particular, a valid
  one-period/version-2 aggregate may have empty QoQ dictionaries and backing.
- **R4 — Strict format selection and fallback.** `inst_serving.py` may select the
  compact iterator only after enumerating `PRAGMA database_list` with quoted
  schema names and proving exactly one reachable aggregate schema, exact
  version-2 build metadata, the public compatibility view, and the complete
  private table/column/key contract. Before yielding any row, one guarded,
  set-based LEFT-JOIN anti-join over `_agg_qoq_deltas` must prove every `filer_id`,
  `curr_period_id`, and `prev_period_id` resolves in its producer-owned dictionary;
  any orphan fails closed. A single genuine legacy physical/public
  `agg_qoq_deltas` relation with no version-2 metadata/private sentinels uses the
  existing public SELECT. No reachable aggregate remains a legitimate empty
  activity grain. Multiple reachable aggregate schemas, a public/private object
  split across schemas, partial or contradictory version-2 state, an orphaned
  dictionary reference, or decoder-domain corruption fails before activity output
  rather than silently falling back or dropping rows. The integrity preflight and
  compact scans stay inside the existing serving guard and may not materialize a
  second high-cardinality copy.
- **R5 — Phase rebalance.** Remove only `_create_concentration_stage` from
  `prepared_materialized_inst_aggregate`; `_write_bulk_concentration` creates it
  once inside `build_inst_agg` under the existing aggregate guard. Positions,
  issuer stages, token ownership, threads/cache settings, and all other phase
  boundaries remain unchanged.
- **R6 — Lifecycle and cancellation.** The combined query and compact cursors
  stay inside the existing source read transaction and serving guard. Aggregate
  failure, serving timeout, iterator/decode failure, commit failure, DETACH
  failure, and cleanup retry preserve the primary error, remove owned TEMP and
  partial destination state, restore settings, and leave snapshot v1 byte-exact.
- **R7 — Public contracts unchanged.** Do not change `inst_agg.sql`, public
  aggregate/serving schemas, inst schema version 1.1, logical projection version,
  `client_compat`, publication width, watermarks, R12, tail/file budgets, or the
  180-second phase bounds. No persistent performance index or parallel table is
  added.
- **R8 — Complete verification.** After the final source edit, run the named
  focused/targeted tests, exact previous-client test, dashboard fixture test,
  runner-governance test, `git diff --check`, `make check`, `make accept-m1-b`,
  `make accept-m2-5`, `make accept-m2-6`, `make accept-m2-8`, and
  `make accept-m2-11` separately. Any source repair invalidates all later gates.
- **R9 — One append-only binding run.** Verify `T0-v10.log` absent immediately
  before one exact unbuffered full ladder with immutable snapshot v1,
  `--measured-files 8106 --pilot-filers 500 --full`, and no build date. Capture
  direct exit status; never retry, rename, truncate, or overwrite the log.
- **R10 — Independent review discipline.** This exact plan must receive read-only
  independent approval before implementation. Use at most three plan-review
  rounds. Only exit-zero T0-v10 permits fresh Dev Notes/QA report and at most
  three independent QA-review rounds. Batch every round's findings; never
  self-sign. A source repair invalidates gates, T0, QA, docs, and PR evidence and
  requires new owner authority for another binding name.
- **R11 — Exact cumulative release.** After QA and docs approval, stage exactly
  the enumerated cumulative M2-11 inventory, prove cached-name equality, create
  one Conventional Commit, prove the post-commit tree clean, fetch and capture the
  exact release base, push the existing feature branch, and open a non-draft PR
  with an inline reviewed body. Bind the exact head/base/mergeability, explicitly
  prove/disclose the repository's approved zero-status-check state, fetch again
  and refuse a moved base, squash-merge with head-match protection, then prove the
  PR is merged and fetched `origin/main` equals its nonempty merge SHA.
- **R12 — Supervised functional deployment.** Recheck official runner 2.336.0 and
  arm64 digest, provision/validate runbook sections 1–6 if the repository runner
  or controller is absent, set the snapshot variable only after that preflight,
  capture/watch the exact dispatched `main` run with failure-sensitive exit, then
  verify signatures, manifests, source/code SHAs, institutional index semantics,
  a nonempty shard, a real filer payload/page, and live schema/source/code binding.
  Set `POPULUS_SELFHOSTED_VALIDATED` only after every functional check succeeds.
- **R13 — Immutable evidence and secrets.** Snapshot v1 must remain 23,058,628,608
  bytes, mode 0444, SHA-256
  `977a4d249d92590a4de2961a3e9c7ff8cfa2e4846f0097ec7aa6c07f28124121`,
  with no journal/WAL/SHM before or after. No token, credential, registration
  secret, private key, or environment value enters logs, review artifacts, chat,
  or commits.

## Scope

Authorized pre-T0 runtime/test edits are exactly:

- `docs/build/RUN-M2-11-T0-serving-performance-delta-plan.md`;
- `src/populus/inst_agg.py`;
- `src/populus/inst_serving.py`;
- `tests/test_inst_agg.py`;
- `tests/test_inst_serving.py`;
- `tests/test_inst_external_store.py` only for transaction/read-count propagation;
- `tests/test_inst_snapshot_script.py` only for T0 phase/order/plan propagation;
- append-only `docs/build/RUN-M2-11-T0-findings.md` after the binding run;
- new append-only external evidence
  `/Users/johnbaek/projects/Populus-ops/snapshots/evidence/m2-11/T0-v10.log`.

Only after exit-zero T0-v10 and successful QA may the following factual workflow
records be written or reconciled:

- `docs/build/RUN-M2-11-devnotes.md`;
- `docs/build/RUN-M2-11-qa-report.md`;
- `STATUS.md`.

The cumulative release retains every pre-existing M2-11/T0 changed path listed
under Planned Files. External planning probes/logs remain evidence outside Git and
are not staged. Review verdicts remain in independent transport. Deployment
evidence is append-only external
`/Users/johnbaek/projects/Populus-ops/snapshots/evidence/m2-11/T0-v10-deployment.log`.

## Non-goals

- no snapshot v2, source mutation, persistent source index, ANALYZE, VACUUM, or
  copied audit database;
- no timeout, coverage, R12, tail, page, shard, or file-budget increase;
- no public schema, schema-version, logical-digest, client-range, or dashboard
  payload change;
- no change to affiliation, amendment, cover tolerance, aggregate arithmetic,
  QoQ classification, issuer identity, concentration formulas, or publication
  periods;
- no new runtime module, cache service, multiprocessing layer, native extension,
  per-row database lookup, or destination-side compaction copy;
- no QA, release, variable mutation, workflow dispatch, or deployment before
  exit-zero T0-v10 and the required independent approvals;
- no deletion or cleanup of the owner-controlled worktree.

## Constraints

1. T0-v10 is the sole authorized binding filename. Its absence check is adjacent
   to shell redirection; the direct Python exit cannot be masked by a pipeline.
2. Each named SQLite phase remains independently hard-limited to 180 seconds.
3. The source read transaction spans verification, materialization, preparation,
   coverage, aggregate, and every serving read; COMMIT then ends it, DETACH follows,
   and prepared/materialized cleanup runs afterward.
4. Compact iteration is read-only and may use only the existing schema-1.1 private
   tables; it does not add an index or copy rows.
5. The exact public row/list ordering is data, because serving surrogate `row_id`
   and logical digests depend on it.
6. The fallback is compatibility, not error recovery: contradictory version-2
   state raises rather than choosing a slower path that might hide corruption.
7. Plan review is read-only and capped at three rounds. QA review is read-only and
   capped at three rounds. Main fixes findings in batches.
8. Any code/test change after gate completion invalidates every later artifact.
   Documentation-only factual reconciliation after QA follows the docs-review
   freshness contract and never changes runtime behavior.
9. Git staging, commit, push, PR, merge, repository variables, runner provisioning,
   workflow dispatch, and production activation occur only in the locked order.
10. Secrets remain in credential stores and command stdin/API transport; only
    redacted status, IDs, hashes, and public URLs may be retained.

## Current State

Pinned repository and evidence state on 2026-08-10:

| Item | Observed identity/state |
|---|---|
| branch | `codex/m2-11-t0-finalize` |
| HEAD | `7391d947f72cf408a173f1e7938102608b2269d4` |
| fetched `origin/main` | `21340330a0fad7e9e39c1a9cec67656643621b05`; HEAD is its ancestor |
| dirty inventory before this plan | 32 modified/untracked paths, all preserved |
| approved parent delta | `RUN-M2-11-T0-prepared-compact-aggregate-delta-plan.md`; SHA-256 `676f04217483f88586f17db961c6399a0456d8ee72ffdacaf76930831d467d84` |
| findings before v10 | SHA-256 `28e58fe3047e0faa9105c30e281d58ae4d928e3b1a719f82e9d9464f2fdc2583` |
| T0-v9 | 61,636 bytes / 169 lines; SHA-256 `0e17959ef5552eb03655948c4111da2f030008f9890b22e1c707dc4f8d2dfec8`; exit 4 serving STOP; D1 PASS |
| `src/populus/inst_agg.py` | SHA-256 `4a771c99e524dfcb47cec372cdc0522e8a0f6d67275224a228224fa2066cc88a` |
| `src/populus/inst_serving.py` | SHA-256 `dba5894414ddd26c08b14a80f43a1286a3164dc9fd2ff07158c3bfd910410a50` |
| `tests/test_inst_agg.py` | SHA-256 `ad73b5f3f66e0a5213221db57385dac4e52a452a7ee393c97d6016977d6fffc0` |
| `tests/test_inst_serving.py` | SHA-256 `e27823d1ba2c183b777acaee4c197589e6c61881b18cb298aceb04dfbe23edf6` |
| `tests/test_inst_external_store.py` | SHA-256 `1aa2fa1ce65cb5fdce5e8706d05b4bb749f9e01fb8e3945fb06658e59c6e6fa0` |
| `tests/test_inst_snapshot_script.py` | SHA-256 `86fce636229760efce08ddc76f1c68b220f2c3431c72ded2f2cd02fbd1eef197` |
| T0-v10 | absent before planning and remains absent |

Planning V1 is retained at
`/Users/johnbaek/projects/Populus-ops/snapshots/evidence/m2-11/T0-v10-planning-probe.py`
(420 lines / 15,461 bytes; SHA-256
`68c8cfcd4cfb6ec7f250b964ab7e0abe702bc77724fec91e5c6e6c9d8a8a809c`)
and its 37-line / 3,554-byte log has SHA-256
`bc630268f0b0b1df733c6badde17eb2f65d29714f11f996bc7611cfe12dd1697`.
The shell wrapper had a non-binding zsh reserved-variable mistake after Python;
the Python traceback itself is decisive: full materialization 189.112 seconds,
aggregate 121.911 seconds / 1,040,547,840 bytes / 9,482,028 QoQ rows, then the
180-second serving guard interrupted line 499 in the default-holdings loop before
activity. Pilot public and compact projections had identical SHA-256
`ae84dda58207870724a6b7e07488f00d88cab2d3ea315adeeeb74a312f545c01`;
compact time was 16.242 seconds versus 50.460 seconds.

Planning V2 is retained at
`/Users/johnbaek/projects/Populus-ops/snapshots/evidence/m2-11/T0-v10-planning-probe-v2.py`
(386 lines / 15,679 bytes; SHA-256
`c776969849f05a37316a399df469f505dc8faf92ad283cc7d6772e6728cf5636`)
and its 12-line / 2,653-byte exit-zero log has SHA-256
`a2364dd45a08fa122760a19e0468ddfc7421c444eb33aae09e8d3b2915d25021`.
Pilot baseline/combined identities match exactly across 2,494 filings, 500 names,
742,412 filer rows, 312,039 issuer-holder rows, and 415,058 activity rows. The
full combined projection completed under the real guard with 45,256 filings,
9,458 names, 4,242,299 filer rows, 2,622,978 issuer-holder rows, and 3,198,982
activity rows. V2's pre/post snapshot states compare equal and report the approved
SHA, 51 schema rows, and no sidecars.

The official GitHub Actions runner release API currently reports `v2.336.0`,
published 2026-07-20, with macOS arm64 asset
`actions-runner-osx-arm64-2.336.0.tar.gz` and digest
`sha256:8e8839c49b7060b6b2154f4931f815df330c27f167d53ef2239ee3dfce28b079`.
Release execution must recheck this time-sensitive fact.

## Detected Stack

- **Languages:** Python ≥3.12 at repository root; TypeScript/Astro under
  `dashboard/`; SQLite/JSON1 data plane; shell/Make/GitHub Actions operations.
- **Python runner:** repository `.venv/bin/python`; `uv.lock` is present, while
  the standing Make targets deliberately invoke the repository environment.
- **Node runner:** npm (`dashboard/package-lock.json`); Astro check and Node's
  native test runner through package scripts/Make.
- **Tests:** pytest from `pyproject.toml`; Node `--test`; complete orchestration in
  `Makefile`.
- **Lint/security:** repository `make check` plus dependency/security gates;
  no standalone Ruff executable is installed in this worktree environment.
- **Database:** Python stdlib `sqlite3`, SQLite 3.50.4 in the planning evidence,
  JSON1, connection-local TEMP objects, immutable URI source on macOS arm64.
- **Canonical commands:** focused `.venv/bin/python -m pytest`, `make check`, and
  the five standing acceptance targets enumerated in R8.

## Reuse Map

The mandatory reuse-first scan covered Python, tests, Markdown, dashboard
consumers, runbooks, and workflow files while excluding only generated/vendor
trees.

| Existing symbol/path | Decision | Why |
|---|---|---|
| `build_serving_projection` in `src/populus/inst_serving.py` | refactor in place | It already owns all three serving grains and deterministic list order; a second builder would create semantic drift. |
| `_build_activity_rows` and `_qoq_deltas_table` | extend in place | They own aggregate discovery, absence behavior, activity provenance, exit guards, and row construction. |
| `_QOQ_*_CODES`, `_QOQ_FLAG_MASKS`, compact dictionaries/backing in `src/populus/inst_agg.py` | add decoding iterator beside encoder | One producer-owned map prevents a parallel code/flag contract in serving. |
| `prepared_materialized_inst_aggregate` | rebalance one call | It already owns TEMP lifecycle, cache/thread restoration, cancellation, and cleanup. |
| `_write_bulk_concentration(..., stage_prepared=...)` | reuse existing switch | Setting the established seam to create its stage inside aggregate is smaller than a new phase API. |
| `v_filer_reported_holdings`, `v_default_inst_filings`, `securities` | one joined query | These are the same canonical populations used today; no alternative data source is introduced. |
| `publication_periods`, `affiliate_groups`, `authoritative_full_periods` | reuse unchanged | They pin width, temporal affiliation, and exit honesty. |
| existing M2-8 serving semantic tests | extend | They already cover provenance, grains, NULL honesty, issuer keys, and exits. |
| existing T0 ladder and execution guard | reuse unchanged | It is the accepted phase/immutability/R12/tail harness; only the append-only name advances. |
| prior release/runbook plan | reuse exact sequence | Runner freshness, zero-check PR handling, deterministic dispatch, and functional verification are already reconciled. |

## Architecture

Current serving performs four high-cardinality reads: filer rows, reported issuer
membership, default issuer totals, then activity display fields. V1 proved the
full guard fires in the third read. The target flow is:

```text
verified immutable source + active read transaction
          |
          +--> materialized filing/default views
          +--> prepared positions + issuer stages
          |       (concentration stage deliberately deferred)
          |
          +--> aggregate guard
          |       +--> create concentration stage once
          |       +--> write schema-1.1 compact aggregate
          |
          +--> serving guard
                  +--> filing dictionary / names / affiliation groups
                  +--> ONE ordered reported-holdings query
                  |       +--> filer_rows
                  |       +--> reported issuer buckets
                  |       +--> is_default issuer totals
                  |       +--> activity display map
                  +--> unique aggregate-schema + relational-integrity preflight
                  +--> producer compact iterator per current period
                  |       +--> absent dictionary period = empty stream
                  |       +--> bounded group decode/sort
                  |       +--> deterministic heap merge
                  +--> activity rows + issuer-holder rows
          |
          COMMIT -> DETACH -> prepared cleanup -> materialized cleanup
```

The compact iterator returns the exact 14 activity-source fields formerly read
from the public view. It does not expose private storage to dashboard/MCP/client
consumers and does not change the public compatibility view. The legacy path
still SELECTs the public relation when version-2 private storage is genuinely not
present. Selection is fail-closed and side-effect-free: enumerate all reachable
aggregate sentinels first; zero schemas means absent, one unversioned legacy
relation means public fallback, one exact version-2 schema means compact only
after its table/key/domain and dictionary-reference preflight passes, and any
other cardinality or split/partial shape raises before a row is yielded. Once
the preflight proves no backing row has an orphaned current-period ID, absence of
a requested period from the dictionary is exactly an empty stream, not corruption.

## Locked Decisions

1. Keep every phase limit at 180 seconds.
2. Keep snapshot v1 immutable and sidecar-free.
3. Keep inst schema 1.1, logical projection version, public relations, and client
   range unchanged.
4. Combine high-cardinality serving work in one canonical query rather than
   materializing a second TEMP holding table.
5. Keep compact decode in the aggregate producer; serving consumes decoded tuples.
6. Add no persistent or TEMP high-cardinality performance index.
7. Preserve exact row/list order and therefore serving logical digest.
8. Move only concentration-stage creation from preparation into aggregate; do not
   move positions or issuer stages.
9. Fail closed on partial version-2 private state; use the public fallback only
   for a genuine legacy aggregate. A selected period absent from a referentially
   valid compact dictionary is empty; orphaned IDs, split/multiple reachable
   schemas, and partial/contradictory state are corruption.
10. Use `T0-v10.log` once, with the exact existing ladder and no build date.
11. Use at most three independent plan-review rounds and at most three independent
    QA-review rounds.
12. Release the exact cumulative inventory through one PR and deploy only from the
    merged `main` SHA under the supervised runbook.

## Alternatives Considered

- **Add a `curr_period_id` secondary index:** rejected. It duplicates hundreds of
  megabytes of high-cardinality position keys, consumes R12 headroom, lengthens
  aggregate creation, and does not remove the earlier repeated holdings scans.
- **Reorder the compact primary key:** rejected. It risks the now-passing aggregate
  insertion order and public digest sort without addressing serving's first three
  scans.
- **Materialize another TEMP serving-holdings table:** rejected. The existing query
  already yields every required field; one Python pass is smaller and avoids
  another full-corpus write/index lifecycle.
- **Expand `_populus_inst_agg_input` with serving columns:** rejected. It widens a
  16.9-million-row TEMP table and materialization phase when the canonical holding
  view can supply one combined ordered read.
- **Optimize only the public QoQ view:** rejected by V1 full evidence; the timeout
  occurs before activity.
- **Drop ORDER BY or change activity row order:** rejected because deterministic
  surrogate row IDs and logical digests make order observable.
- **Increase timeout or omit pilot/full evidence:** rejected by owner contract and
  mandatory-stop discipline.
- **Parallel/multiprocess serving:** rejected due memory amplification, ordering
  complexity, cancellation ownership, and unnecessary architecture.

## Planned Files

New-delta edits:

| Path | Planned action | Requirements |
|---|---|---|
| `docs/build/RUN-M2-11-T0-serving-performance-delta-plan.md` | add/revise only through independent review | R10 |
| `src/populus/inst_agg.py` | producer-owned compact iterator and concentration-stage rebalance | R3, R4, R5, R6, R7 |
| `src/populus/inst_serving.py` | one-pass holding accumulation, strict format selection, compact/public activity source | R1, R2, R3, R4, R6, R7 |
| `tests/test_inst_agg.py` | iterator/decode/order/corruption and deferred-stage lifecycle tests | R3, R4, R5, R6, R7 |
| `tests/test_inst_serving.py` | complete combined-vs-independent parity, single-pass, fallback, absence, fail-closed tests | R1, R2, R3, R4, R6, R7 |
| `tests/test_inst_external_store.py` | transaction span, one holdings read, no post-COMMIT read, cleanup propagation | R1, R6, R13 |
| `tests/test_inst_snapshot_script.py` | phase rebalance and exact T0-v10 stop/evidence propagation | R5, R8, R9, R13 |
| `docs/build/RUN-M2-11-T0-findings.md` | append exact T0-v10 outcome only | R9, R13 |
| `docs/build/RUN-M2-11-devnotes.md` | fresh complete workflow record only after T0 success | R10, R11 |
| `docs/build/RUN-M2-11-qa-report.md` | fresh QA record only after T0 success | R10, R11 |
| `STATUS.md` | parent-required factual M2-11/T0/QA/deploy entry after evidence exists | R11, R12 |

The exact cumulative release allowlist is fixed below. Every path must be present
in the final changed inventory and no other path may be staged:

```text
.github/workflows/publish.yml
ARCHITECTURE.md
Makefile
STATUS.md
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
docs/build/RUN-M2-11-devnotes.md
docs/build/RUN-M2-11-qa-report.md
docs/runbooks/self-hosted-runner.md
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

## Implementation Tasks

- **T1 [R1,R2,R3,R4,R5,R6,R7]:** Refactor serving accumulation in place; add
  producer-owned compact iteration, unique reachable-schema selection, and one
  guarded set-based dictionary-reference preflight before iteration; treat an
  unreferenced selected period as empty, fail closed on orphan/split/multiple/
  partial state, defer concentration creation to the existing aggregate writer,
  and preserve every lifecycle, schema, order, and fallback contract.
- **T2 [R1,R2,R3,R4,R5,R6,R7,R13]:** Add complete fail-if-removed tests for the
  one holdings pass, independent semantic parity, all enum/flag/NULL shapes,
  decoded ordering, a valid one-period/zero-QoQ version-2 aggregate, a selected
  period absent with no backing reference, genuine legacy and aggregate-absent
  handling, orphan filer/current/previous IDs, split/partial private state,
  multiple reachable aggregate schemas, deferred stage creation, timeout/failure
  cleanup, transaction span, and immutable source.
- **T3 [R8]:** After the final source edit, run every focused/targeted/compatibility/
  dashboard/governance test, diff check, complete-tree check, and five acceptance
  commands separately; repair and restart this task if any fail.
- **T4 [R9,R13]:** Recheck approved plan/source/evidence hashes, immutable snapshot
  identity/resources, and exact T0-v10 absence; run the exact binding command once,
  capture direct exit, hash the log/snapshot, reconcile every phase/R12/tail field,
  and append findings without overwriting history.
- **T5 [R10]:** Only after exit-zero T0-v10, write fresh Dev Notes, QA report,
  redacted diff, changed-file and gate bundles; run independent QA up to three
  rounds, batch all findings, and rebuild freshness after any source repair.
- **T6 [R11]:** After QA approval, reconcile `STATUS.md` and all release evidence,
  obtain independent docs review, prove the exact cumulative staged inventory,
  commit and prove clean, capture the fetched base, push, open/bind the PR with
  an inline reviewed body, assert the approved zero-check state, re-fetch/refuse
  base drift, squash-merge the exact head, and prove fetched main equals the
  resulting merge SHA.
- **T7 [R12,R13]:** Recheck official/installed runner identity and controller,
  provision only through the reviewed runbook if missing, set the snapshot
  variable, dispatch/watch the exact merged-main run, perform all functional and
  signature/source/code checks, then arm scheduled validation and retain redacted
  deployment evidence.

## Testing Strategy

Focused runtime tests after the final source edit:

```bash
PYTHONDONTWRITEBYTECODE=1 .venv/bin/python -m pytest -q \
  tests/test_inst_agg.py tests/test_inst_serving.py \
  tests/test_inst_external_store.py tests/test_inst_snapshot_script.py
```

The new tests must include:

- a trace/progress fixture proving exactly one high-cardinality
  `v_filer_reported_holdings` query and zero `v_default_holdings` scans inside
  the projection;
- a dense two-period fixture with affiliations, multiple share classes,
  duplicate position rows, PUT/CALL/LONG, SH/PRN/UNKNOWN, all 32 flag masks,
  exits, unassertable exits, undisclosed values/shares, NULL issuer fallback,
  several filings, and default-suppressed filers; its combined output is compared
  completely against independent legacy queries including order and Python types;
- exact compact/public tuple equality and ordering for genuine schema 1.1;
- a valid one-period/version-2 aggregate with empty QoQ dictionaries/backing and
  a selected period absent from a nonempty, referentially valid dictionary; both
  must return the same empty stream as the public view;
- genuine legacy physical-table fallback and wholly absent aggregate;
- fail-closed orphan `filer_id`, `curr_period_id`, and `prev_period_id` fixtures,
  public/private split state, partial private state, multiple reachable aggregate
  schemas, wrong aggregate version, invalid enum/mask, and schema-name quoting;
- a mutation guard that fails if the compact path re-enters the public view;
- a mutation guard that fails if any activity row is yielded before the guarded
  set-based relational preflight completes;
- prepared-stage spies proving concentration absent at yield, created once under
  aggregate, progress-handler cancellation, partial destination removal, and
  settings/TEMP cleanup;
- production/T0 transaction traces proving all reads precede COMMIT and only
  DETACH/cleanup follows it.

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

Previously released client/schema compatibility:

```bash
POPULUS_PREVIOUS_CLIENT_SHA=7391d947f72cf408a173f1e7938102608b2269d4 \
  PYTHONDONTWRITEBYTECODE=1 .venv/bin/python -m pytest -q \
  tests/test_pointer_state.py -k inst_schema_1_1_previous_client
```

Dashboard and runner propagation:

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

Binding T0-v10, with an adjacent absence check and no pipeline:

```bash
t0_log=/Users/johnbaek/projects/Populus-ops/snapshots/evidence/m2-11/T0-v10.log
test ! -e "$t0_log" || exit 97
t0_exit=0
PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1 .venv/bin/python \
  scripts/measure_inst_derive.py \
  --snapshot /Users/johnbaek/projects/Populus-ops/snapshots/inst-source-v1.db \
  --measured-files 8106 \
  --pilot-filers 500 \
  --full > "$t0_log" 2>&1 || t0_exit=$?
printf 'T0-v10 direct exit: %s\n' "$t0_exit"
test "$t0_exit" -eq 0
```

No `--build-date` is allowed. The widest valid FilingWindow is measured. A
nonzero exit, missing full JSON, phase at/above 180.000, D1 mismatch, R12 failure,
tail/file-headroom failure, or artifact over 1,610,612,736 bytes stops before QA.

## Verification Matrix

| Requirement | Proof |
|---|---|
| R1 | SQL trace: one reported-holdings query, no default-holdings scan; full row-count assertions |
| R2 | complete independent legacy-vs-combined lists, order, types, NULLs, keys, flags, totals, filing references |
| R3 | all enum/mask/order fixtures; compact/public tuple equality; valid one-period/zero-QoQ and absent-selected-period empty parity; bounded group and heap-merge proof |
| R4 | unique reachable-schema and exact version/private-key acceptance; guarded set-based dictionary anti-join before yield; genuine legacy and wholly absent paths; orphan filer/current/previous, split, multiple, partial, wrong-version, and decoder-domain rejection |
| R5 | stage-order spy; concentration absent before aggregate and created exactly once within it |
| R6 | timeout/SQL/commit/detach/cleanup injections; primary-error precedence; settings/TEMP/destination cleanup |
| R7 | schema/digest/client compatibility, public relation kind/columns, no new table/index, width/bounds constants |
| R8 | named focused, targeted, dashboard, governance, diff, complete-tree, and five acceptance exits zero |
| R9 | absent-then-created one-shot T0-v10; direct exit zero; all three phases, D1, R12, tail/headroom complete |
| R10 | exact plan approval; fresh QA bundle; at most three rounds; no self-sign; freshness tokens match |
| R11 | docs approval; exact staged-name equality; conventional commit and clean tree; inline reviewed PR body; bound head/base/mergeability; zero checks disclosed; pre-merge base freshness; merged state and fetched-main-equals-merge-SHA |
| R12 | current runner proof; exact run ID watch; signature/manifest/index/shard/filer/page/source/code functional verification |
| R13 | pre/post snapshot hash/size/mode/schema/sidecars; redacted artifacts and credential-safe command output |

## Rollout / Rollback

Rollout order is strict:

1. Validate this exact plan and obtain independent approval within three rounds.
2. Implement only the authorized source/tests.
3. Run every R8 gate after the final source edit.
4. Run T0-v10 once and append exact findings.
5. On exit zero only, complete independent QA within three rounds.
6. Reconcile factual docs/commit evidence and obtain docs review.
7. Stage the exact cumulative inventory, commit, push, PR, verify, and squash-merge.
8. Validate/provision the runner/controller, set the snapshot variable, dispatch
   the exact merged-main run, verify function/signatures, then arm scheduling.

After docs approval, staging is literal and fail-closed:

```bash
release_allowlist=(
  .github/workflows/publish.yml
  ARCHITECTURE.md
  Makefile
  STATUS.md
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
  docs/build/RUN-M2-11-devnotes.md
  docs/build/RUN-M2-11-qa-report.md
  docs/runbooks/self-hosted-runner.md
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

Release binds the exact PR and never treats absent checks as green. The already
owner-approved zero-check path explicitly verifies both check-runs and commit
statuses are empty, records that fact in the PR, and relies on the complete local
evidence plus exact head/base/mergeability:

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

Deployment follows the reviewed runner runbook and captures the exact dispatched
run ID/URL before `gh run watch <id> --exit-status`. Before any variable mutation,
recheck the official latest release/digest, installed `Runner.Listener --version`,
repository runner online/busy/labels state, controller plist/config ownership and
permissions, and snapshot identity. If missing, execute and validate runbook
sections 1–6; any mismatch stops. Functional verification must assert:

- institutional index JSON has `v == 1`, `kind == "filer-index"`, no `absent`
  state, and nonempty `shards`;
- one named shard has the expected version/kind and nonempty entries;
- one real CIK payload and HTML page resolve and contain institutional data;
- manifest modules/artifacts report schema 1.1, the expected merged code SHA,
  exact snapshot source SHA, logical/byte digests, and valid signatures;
- deployment evidence is append-only/redacted before
  `POPULUS_SELFHOSTED_VALIDATED` is set.

Rollback before merge is ordinary source/test reversion while preserving all
append-only logs/findings. After merge but before variable mutation, revert the
PR normally. After variable mutation or dispatch, unset scheduled validation,
restore the prior snapshot variable if it changed, keep the failed run/evidence,
and use the publish workflow's existing pointer/artifact rollback; never mutate
or repair snapshot v1. Worktree teardown remains owner-only.

## Simplicity Audit

Minimum coherent runtime change:

- refactor one existing serving function to accumulate four outputs during its
  first canonical holding query;
- add one producer-owned compact activity iterator with one small per-period
  generator and reuse the existing encoder maps;
- pass the already-built display dictionary into the existing activity builder;
- flip one existing `stage_prepared` seam so concentration is created where it is
  consumed.

No new runtime file, class, database object, schema version, cache, index, worker,
service, CLI, or configuration knob is introduced. The only new repository file
is this required plan. Every proposed helper is enumerated above; all remaining
work extends existing tests/docs. This is smaller than the rejected TEMP-table,
index, materialized-input, or parallel-execution designs.

## Tech Debt Introduced

One explicit internal coupling remains: schema-1.1 serving can recognize the
producer's version-2 private compact tables. Ownership is entirely in
`src/populus/inst_agg.py`; `inst_serving.py` receives decoded public tuples and
keeps a strict legacy fallback. Impact is confined to the institutional build
process, not public clients. Removal condition: retire schema 1.1/version-2
aggregate compatibility or replace both producer and consumer in a reviewed
schema migration. No hidden debt, TODO, duplicate implementation, or deferred
correctness work is authorized.

The two external planning probe scripts/logs are retained historical evidence,
not installed runtime code and not staged. They may be archived by the owner
after release; the repository does not depend on them.

## Memory Touch-Points

The canonical deterministic selector was run exactly as follows, and every
selected file was read fully:

```bash
/Users/johnbaek/projects/orchestrate-tool/lib/memory-select.sh \
  /Users/johnbaek/.claude/projects/-Users-johnbaek/memory/MEMORY.md \
  serving sqlite performance timeout aggregate QA workflow deployment
```

- `feedback_orchestrate_workflow.md` — retain the existing feature branch through
  development and review; do not auto-approve checkpoints.
- `feedback_qa_fail_batch_remediation.md` — one coherent QA remediation followed
  by complete re-gating and independent re-review.
- `feedback_qa_remediation_discipline.md` — batch all findings, provide
  reproducible artifacts, keep sign-off evidence pure, and never self-waive or
  self-sign.
- `project_workflow_calibration.md` — re-derive live state, fail closed on exact
  manifests, and leave worktree teardown to the owner.
- `feedback_supervised_deployment_dry_run_inspection.md` — inspect real
  institutional payloads before arming scheduled operation.
- `feedback_auto_fallback_alert_pattern.md` — make the compact-versus-legacy
  selector explicit and observable in tests; never silently downgrade corrupt
  version-2 state to the slower public path.
- `feedback_bulk_sql_for_backfills.md` — use one set-based relational-integrity
  preflight and bulk ordered scans, never per-row database lookups.
- `feedback_explicit_plan_contracts.md` — define the producer, storage location,
  selection rules, empty-state meaning, decoded tuple shape, and failure behavior
  before implementation.
- `feedback_gate_list_completeness.md` — keep the full standing Populus gate set
  enumerated in addition to the new focused corruption/empty-state tests.
- `feedback_postdeployment_debt_worse_pattern.md` — reconcile comments/docs and
  declared coupling before shipping, not in a cleanup PR.

The shared deterministic failure-mode catalog was also loaded in full and is
applied below.

## Failure-Mode Sweep

- **F0 full-set/verify/secrets:** complete aggregate/serving/dashboard/MCP/client/
  workflow consumers were scanned; tests compare function and data, not object
  presence; valid empty QoQ state is separated from orphan/split/multiple-schema
  corruption; secret values are excluded from every artifact.
- **F1 plan-time:** all high-cardinality queries, aggregate formats, lifecycle
  owners, tests, standing gates, release paths, and deployment consumers are
  enumerated. Live hashes/HEAD/evidence/runner facts are pinned and must be
  refreshed before use.
- **F2 dev-time:** no per-row SQL, new persistent table/index, or parallel
  implementation. Compact rows stream in bulk; every boundary has a
  fail-if-removed test; comments referring to the old four-pass or fully-prepared
  concentration lifecycle must be swept.
- **F3 QA-time:** T0 exercises immutable full data; deployment fetches/parses a real
  index, shard, filer payload/page, manifest, signature, and binding rather than
  checking only HTTP/process liveness. Every timing/count/hash is reconciled from
  retained evidence.
- **F4 handoff:** any review fix propagates through requirements, tasks, tests,
  matrix, DoD, allowlists, docs, and commands; QA findings are batched and returned
  to the independent reviewer.
- **F5 transport/freshness:** plan, Dev Notes, QA report, diffs, gates, T0, docs,
  PR, and deploy evidence are content-hashed. Any source/base change invalidates
  downstream evidence; missing required artifacts stop rather than truncate.

## Definition of Done

- [ ] **R1** exactly one high-cardinality reported-holdings query supplies every
  holding-derived serving structure and no default-holdings scan remains.
- [ ] **R2** complete combined output matches independent legacy semantics in
  rows, order, types, NULLs, arithmetic, keys, flags, totals, and provenance.
- [ ] **R3** producer compact iteration decodes all codes/masks and preserves exact
  activity ordering with bounded group memory and deterministic period merge;
  valid one-period/zero-QoQ and absent-selected-period states equal the empty
  public result.
- [ ] **R4** unique schema-1.1 selection, genuine legacy fallback, aggregate
  absence, pre-yield dictionary integrity, and orphan/split/multiple/corrupt/
  partial version-2 refusal all pass non-vacuous tests.
- [ ] **R5** concentration staging is absent before aggregate, created once under
  its guard, and every other preparation boundary remains unchanged.
- [ ] **R6** transaction, timeout, SQL, commit, detach, cleanup, settings, TEMP,
  and partial-destination failure tests pass with primary-error precedence.
- [ ] **R7** public schema/version/digests/client range/period width/bounds and
  database object inventory are unchanged.
- [ ] **R8** every named focused, targeted, compatibility, dashboard, governance,
  diff, complete-tree, and acceptance command exits zero after the final source edit.
- [ ] **R9** T0-v10 exists once, exits zero, reports all three phases below 180,
  aggregate within R12, complete tail/headroom, D1 PASS, and append-only findings.
- [ ] **R10** exact plan and fresh QA artifacts receive independent approval within
  their three-round caps with no self-sign or stale evidence.
- [ ] **R11** docs review approves the factual cumulative inventory/commit evidence;
  exact files are committed/pushed from a clean tree, zero checks disclosed,
  exact PR head/base and mergeability proven, a second fetch proves the base has
  not moved, the bound head is squash-merged, and fetched `origin/main` equals the
  PR's nonempty merge SHA.
- [ ] **R12** current runner/controller and exact dispatched merged-main run pass;
  signatures, manifest, source/code SHAs, index, shard, real filer payload/page,
  and live binding pass before scheduled validation is armed.
- [ ] **R13** snapshot v1 pre/post size/mode/hash/schema/sidecars are exact and no
  secret or credential value appears in any retained or communicated evidence.
