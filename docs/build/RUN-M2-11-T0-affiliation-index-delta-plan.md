# RUN M2-11 T0 affiliation-index materialization delta

**Artifact:** plan-v1 delta · **Status: READY FOR INDEPENDENT PLAN RE-REVIEW; no
implementation authorized by this artifact until review approval** · **Date:**
2026-08-09 · **Parent:** `docs/build/RUN-M2-11-T0-coverage-delta-plan.md`, approved
SHA-256 `699efa0ddd439ad630df15c20b91e7ded14b544f620b7a3b59f62afa27ba5c5a`
· **Base:** `feat/run-m2-11-inst-publish` at
`7391d947f72cf408a173f1e7938102608b2269d4` plus the live, unstaged parent-delta
implementation described below · **Scope class:** M.

This second delta exists because the binding T0-v2 run proved that the first
approved TEMP materialization still evaluates the affiliation subquery too many
times on the complete snapshot. It replaces the internals of the already-added
`materialized_inst_derivation_views` helper with a staged, indexed affiliation lookup
and relocates the existing restatement-survivor SQL from `ingest/inst13f.py` to
`amendments.py` so both database consumers share it. That relocation removes the
ingestion query's unused `cik` projection but does not change its filing population or
flags. The delta does not change coverage arithmetic, amendment semantics, persistent
views, the accepted snapshot, derived schemas, publication outputs, T0 limits, R12,
tail geometry, or Phase D authorization.

The worktree is intentionally dirty with the in-flight M2-11 implementation. All
existing changes remain unstaged and must be preserved. No commit, push, PR,
worktree creation/removal, snapshot mutation, or Phase D action is authorized by
this plan.

## Immutable baseline and provenance

The implementation checkpoint for this delta is the live worktree, not clean HEAD.
Before implementation or review, verify all of the following:

- branch: `feat/run-m2-11-inst-publish`
- HEAD: `7391d947f72cf408a173f1e7938102608b2269d4`
- approved parent-delta plan SHA-256:
  `699efa0ddd439ad630df15c20b91e7ded14b544f620b7a3b59f62afa27ba5c5a`
- failed binding log:
  `/Users/johnbaek/projects/Populus-ops/snapshots/evidence/m2-11/T0-v2.log`
- failed binding log SHA-256:
  `c8361bc50243538f2e014140c5e39c2079a56fdbb0e12043674c12abf77a0334`
- accepted snapshot:
  `/Users/johnbaek/projects/Populus-ops/snapshots/inst-source-v1.db`, opened only
  with `mode=ro&immutable=1`
- accepted snapshot SHA-256 from T0-v2 D1:
  `977a4d249d92590a4de2961a3e9c7ff8cfa2e4846f0097ec7aa6c07f28124121`
- T0-v2 D1 state: identical pre/post ordered 51-row `main.sqlite_schema`; no
  `-journal`, `-wal`, or `-shm`

Content-sensitive pre-delta hashes for files this delta may edit:

| path | SHA-256 before this delta |
|---|---|
| `src/populus/amendments.py` | `0230b9b60c376e4e979a002096022793a3e5efa8caac3397a09eebe907574e2b` |
| `src/populus/ingest/inst13f.py` | `086fe0fa19c2852b5264cf080db45680ec0262085853995994955dfa25b414a3` |
| `tests/test_cover_tolerance.py` | `2adc2b853e0c2a8003982efaf3fb094cbdd2fa57d463cdf5bde04cd7801b5cfc` |
| `tests/test_inst_external_store.py` | `84cc8d52b528b66fd8bffae7b1fa195b0f6be55c49dcfa5afc59b0704314f6db` |
| `docs/build/RUN-M2-11-T0-findings.md` | `69f6a194dd0c3f945d240e8c3ab3eab23772c39c41a9a1e87f716915e5c98b3f` |

Any mismatch is a rebaseline event. Inspect the intervening diff and revise this
plan before implementation; do not silently accept a stale review bundle.

## Problem and measured evidence

T0-v2 passed its view gate, resource preflight, exact production EXPLAIN rung, and
D1 immutability proof, then stopped exactly as designed:

```text
STOP: SQLite execution bound (180s) interrupted phase materialization; later phases suppressed
```

The failing statement was the parent delta's exact CTAS:

```sql
CREATE TEMP TABLE v_default_inst_filings AS
SELECT * FROM main.v_default_inst_filings;
```

`v_default_inst_filings` reads `v_inst_reconciled_filings`. Its restatement stage is
fast; its affiliation stage is not. For almost every surviving filing, SQLite scans
the other surviving filings in the same period and expands their `other_managers`
JSON again. Full-snapshot read-only probes isolated the stages:

| probe | measured result |
|---|---:|
| input filings | 46,081 |
| restatement survivors | 45,493 |
| restatement-only count | 0.035 s |
| current affiliation stage | did not finish inside a separate 12 s bound |
| exact parent CTAS | interrupted at 180 s by binding T0-v2 |
| normalized affiliation edges | 12,789 |
| final default filings under the staged equivalent | 43,207 |

There are six periods with 3,679–8,823 restatement survivors each. The current
correlated shape can visit approximately 363,808,783 candidate filings and
105,445,447 normalized manager edges. Rows that are retained alone force a lower
bound of approximately 346,700,810 candidate visits and 100,377,332 manager-edge
visits because their `NOT EXISTS` search cannot stop early.

A throwaway, connection-local experiment opened the accepted snapshot with
`mode=ro&immutable=1` and performed the proposed set decomposition:

| staged operation | measured wall time |
|---|---:|
| project the four required fields from restatement survivors | 0.294 s |
| expand normalized manager edges once | 0.013 s |
| create the covering affiliation index | 0.004 s |
| build the final table from `main.v_filer_reported_filings` minus indexed edges | 12.236 s |

The final planned set and a separately expressed direct equivalent both contained
43,207 filing IDs; `EXCEPT` in both directions returned zero rows. The final query
plan used the covering TEMP affiliation index. These timings are diagnostics from
one machine and are not acceptance thresholds. The binding gate remains the
existing 180-second T0 SQLite execution bound and complete downstream T0 success.

No repository file or snapshot object was changed by the probes. Connections were
immutable/read-only, and no SQLite sidecar was created.

## Goal and success criteria

Build the frozen default filing set without repeatedly expanding affiliation JSON,
while preserving the exact reviewed filing population on every verified source.
The existing derive then reuses that frozen set through coverage, period coverage,
aggregate construction, watermarks, serving projection, and tail measurement.

Success requires all of the following:

1. Persistent view verification occurs inside the public materialization helper
   before its first `main` data read; stale or missing packaged views fail closed.
2. Restatement survivors are evaluated once for affiliation-edge extraction into a
   narrow TEMP staging table. The reused reported view independently evaluates its
   inexpensive survivor/cover chain once for final candidates; the eliminated
   pathology is repeated period-wide affiliation JSON expansion, not every repeated
   survivor predicate evaluation.
3. Normalized affiliation edges are expanded once and served through a covering
   index, not through a correlated period-wide JSON scan per filing.
4. On current verified views, the final TEMP `v_default_inst_filings` rows and
   columns exactly equal `main.v_default_inst_filings` across complete semantic
   fixtures.
5. Coverage objects, period-coverage tuples, F8 safety, aggregate logical digest,
   serving logical digest, and complete serving projection remain unchanged.
6. Only the three established consumer-facing TEMP objects remain while the context
   body runs; all private staging objects are dropped before `yield` and on every
   partial-failure path.
7. The accepted snapshot remains byte- and schema-identical, sidecar-free, and 0444.
8. Targeted tests and all six standing gates pass after the final source edit.
9. Binding T0-v3 gets past materialization, completes every later rung, emits D1,
   R12, tail, aggregate-size, peak-RSS, and phase timing evidence, and exits 0.
10. Phase D remains blocked unless T0-v3 completes and R12 locks the no-compression
    branch. Any new timeout/pathology is another mandatory stop, not permission to
    improvise.

## Requirements

- **A1 — Verified source before data.** `materialized_inst_derivation_views` calls
  `verify_views(conn)` after its TEMP-name collision check but before querying any
  `main` data table or view. The collision check may read only `sqlite_temp_schema`.
  A stale/missing packaged definition raises the existing `ViewVerificationError`;
  no TEMP staging object is created.
- **A2 — Narrow survivor source.** Create TEMP table
  `_populus_inst_affiliation_sources` with exactly four columns:
  `filing_id`, `period_of_report`, `file_number_norm`, and `other_managers`.
  Populate it with a shared `_INST_RESTATEMENT_SURVIVORS_SQL` moved from the existing
  ingestion pass in `src/populus/ingest/inst13f.py:885`. The helper and
  `mark_affiliated_coverage` consume that one SQL string; the latter drops its unused
  `cik` projection/unpack. Its table references are explicitly `main.inst_filings`,
  so caller TEMP state cannot redirect either consumer. The ordering remains the
  packaged-view rule: later
  `filed_date`, then higher `COALESCE(amendment_no, 0)`, then larger accession.
  `NEW_HOLDINGS` remains additive; inactive and superseded-by-later-restatement
  sources cannot contribute affiliation edges.
- **A3 — One normalized edge expansion.** Create TEMP table
  `_populus_inst_affiliation_edges` from the survivor source and `json_each`, with
  `period_of_report`, normalized `manager_file_number`, and `source_filing_id`.
  Rows whose normalized manager file number is NULL may be omitted because SQL NULL
  cannot equal a candidate's non-NULL normalized file number. Do not add `DISTINCT`,
  Python row loops, a JSON cache, or a persistent table.
- **A4 — Covering lookup.** Create TEMP index
  `_populus_inst_affiliation_edges_lookup` on
  `(period_of_report, manager_file_number, source_filing_id)`. The final anti-join's
  edge source uses `INDEXED BY _populus_inst_affiliation_edges_lookup`, so removal of
  the index fails instead of silently regressing to a scan. Its full-snapshot EXPLAIN
  must use the covering index and must not contain the prior correlated period-wide
  `json_each` scan.
- **A5 — Reuse the canonical cover-passing population.** Populate TEMP table
  `v_default_inst_filings` from `main.v_filer_reported_filings`, excluding a row only
  when the indexed edge set contains another survivor in the same period whose
  manager file number equals that row's `file_number_norm`. Keep the exact
  `source_filing_id <> filing_id` self-reference exclusion. Do not copy or rewrite
  the cover-tolerance expression in production code.
- **A6 — Set identity.** Let `R` be restatement survivors, `A(R)` the rows affiliated
  according to manager edges from all of `R`, and `C` the per-filing cover predicate.
  The packaged default set is `(R ∖ A(R)) ∩ C`; the reported view is `R ∩ C`;
  the staged result is `(R ∩ C) ∖ A(R)`. Because `C` is a row-local predicate,
  these sets are identical. Tests must prove the identity where a cover-conflicted
  survivor supplies the affiliation edge, not only where every source passes cover.
- **A7 — Existing consumer namespace.** After the final filing CTAS, create the
  established `v_default_inst_filings_by_filing` index and the TEMP
  `v_default_holdings` shadow from `_packaged_views()` by changing only the CREATE
  prefix. No consumer, coverage query, aggregate query, serving query, or persistent
  view definition changes.
- **A8 — Exact owned names and lifecycle.** The helper owns exactly six TEMP names:
  `_populus_inst_affiliation_sources`, `_populus_inst_affiliation_edges`,
  `_populus_inst_affiliation_edges_lookup`, `v_default_inst_filings`,
  `v_default_inst_filings_by_filing`, and `v_default_holdings`. It refuses a caller
  collision with any of them. It drops the three staging names before `yield`, so the
  context body sees only the three established consumer objects. A tracked
  dependent-first cleanup removes every object created by the helper on normal exit,
  body exception, or failure at any creation/drop step without removing caller state.
- **A9 — Fail-closed stale-view behavior.** Preserve the direct F8 test proving that
  a deliberately stale default view reports an included inflated filing and remains
  uncertifiable. Inside materialization, that same stale packaged definition now
  fails earlier with `ViewVerificationError`; it must never be silently replaced by
  a seemingly certifiable staged result. This is an explicit strengthening of the
  parent delta's helper-local stale-view expectation, not a coverage-rule change.
- **A10 — Transaction and orchestration invariants.** Keep one materialization per
  `_derive_inst_module`, inside the existing explicit read transaction and spanning
  aggregate-first coverage, withholding, watermarks, serving projection, commit, and
  detach ordering. `src/populus/publish/build.py` and all downstream builders remain
  unchanged unless a test proves the current parent implementation violates this
  requirement; such a finding requires plan revision before editing.
- **A11 — T0 and D1 unchanged except evidence generation.** Keep the existing exact
  production-SQL EXPLAIN rung, named 180-second SQLite phase bounds, widest valid
  `FilingWindow`, D1 outer-finally comparison and exit-5 precedence, inclusive R12
  limit `3 * (1 << 29)`, and tail geometry. The new binding log is `T0-v3.log`; never
  overwrite or delete T0-v2.
- **A12 — Honest mandatory stop.** If materialization or any later named phase times
  out, D1 changes, aggregate size exceeds R12, tail geometry fails, or a new
  full-corpus pathology appears, append the evidence to findings and stop for another
  owner-reviewed delta. Do not raise the timeout, change semantics, add a snapshot
  index, create snapshot v2, or proceed to Phase D inside this delta.

## Detected Stack

- **Languages:** Python 3.12 at repository root; TypeScript/Astro in `dashboard/`.
- **Storage/runtime:** SQLite 3.50.4 in the worktree interpreter, JSON1, persistent
  packaged views, and connection-local TEMP objects; macOS Apple Silicon for T0.
- **Python runner:** uv with committed `uv.lock`; direct adjunct checks may use the
  worktree `.venv/bin/python` exactly as listed below.
- **Node runner:** npm with `dashboard/package-lock.json`; Astro 7 and Node 24+.
- **Tests:** pytest, Node's built-in test runner, Astro check/build, and post-build
  tests through repository-owned Make targets.
- **Canonical gates:** `make check` plus the five acceptance targets listed in the
  Testing Strategy. `make check` owns frozen installs, the full Python suite,
  dashboard gates, and the dependency guard.
- **Stack cache:** no repository `AGENTS.md` or `CLAUDE.md` stack cache was found;
  detection was refreshed from the live manifests and Makefile.

## Reuse Map

The reuse-first scan covered tracked and untracked Markdown/code while excluding only
generated, vendor, dependency, and build trees. It found the parent delta's lifecycle
owner at `src/populus/amendments.py:155`, the existing ingestion SQL survivor source
at `src/populus/ingest/inst13f.py:885`, the two packaged-view CTEs at
`src/populus/views.sql:78` and `src/populus/views.sql:147`, and the bulk-ranking
Python implementation at `src/populus/inst_bulk.py:284-313`. It found no separate
affiliation-edge materializer or normalized manager table. Production consumers of
the default and reported view families remain the same set previously enumerated in
`inst13f.py`, `inst_agg.py`, `inst_serving.py`, `publish/build.py`,
`measure_inst_derive.py`, and `ingest/list13f.py`.

| Existing symbol/path | Decision | Reason |
|---|---|---|
| `materialized_inst_derivation_views` (`src/populus/amendments.py:155`) | Modify internals; keep public contract/name | It already owns collision, lifecycle, TEMP shadow, publish, and T0 integration. |
| `verify_views` (`src/populus/amendments.py:56`) | Reuse inside the helper | Makes the public helper fail closed before staged reads; no second validator. |
| `_RESTATEMENT_SURVIVORS` (`src/populus/ingest/inst13f.py:885`) | Move/rename to `_INST_RESTATEMENT_SURVIVORS_SQL` in `amendments.py`; reuse from helper and ingestion | Avoids adding another independent SQL implementation; removes the currently unused `cik` column. |
| packaged survivor CTEs (`src/populus/views.sql:78`, `:147`) | Keep immutable; parity-guard against the shared SQL | Snapshot v1 stores these definitions, so moving them would require a new accepted snapshot. |
| `_out_orders` / `_restatement_survivors` (`src/populus/inst_bulk.py:284-313`) | Reuse unchanged; retain existing view-agreement gate | It operates on pre-ingest mappings, so it cannot consume database SQL; `tests/test_inst_bulk.py:291-400` proves agreement against the real view. |
| `main.v_filer_reported_filings` (`src/populus/views.sql:147`) | Reuse as final cover-passing candidate set | It is the packaged `R ∩ C` population; avoids a second cover implementation. |
| `_packaged_views()` (`src/populus/amendments.py:207`) | Reuse unchanged | Keeps TEMP holdings SQL tied to the packaged definition. |
| existing final filing table/index and holdings TEMP names | Reuse unchanged | Downstream production SQL and EXPLAIN tests already rely on them. |
| `compute_coverage` / `compute_period_coverage` (`src/populus/ingest/inst13f.py:1346`, `:1449`) | Reuse unchanged | Arithmetic, threshold, F8, NULL, and reporting behavior are outside this delta. |
| `_derive_inst_module` (`src/populus/publish/build.py:1174`) | Reuse unchanged | The existing namespace wrapper already spans aggregate, coverage, serving, commit, and detach. |
| existing semantic fixtures (`tests/test_cover_tolerance.py:660`) | Extend | They already own restatement, affiliation, cover, F8, cleanup, and parity contracts. |
| existing ingestion survivor agreement (`tests/test_inst_ingest.py:289`) | Reuse and rerun | It pins affiliation flags to the real default population. |
| existing view-chain anti-drift (`tests/test_filer_reported_views.py:177-263`) | Reuse and rerun | It pins the two packaged survivor/cover chains to their exact set relationship. |
| existing external-store parity (`tests/test_inst_external_store.py:438`) | Extend only where staging visibility changes | It already proves bytes/schema, aggregate digest, serving digest/projection, and transaction scope. |
| existing T0 exact-SQL/timeout tests (`tests/test_inst_snapshot_script.py:650`) | Reuse and rerun unchanged | The runner already owns D1, R12, widest serialization, phase bounds, and plan output. |
| T0 entry/materialization (`scripts/measure_inst_derive.py:1000`, `:1152`) | Reuse unchanged | Binding T0 already measures and bounds the production helper. |
| T0-v2 log and findings | Preserve and append | The failed run is provenance; T0-v3 is a new evidence artifact. |

## Architecture

```text
verified main snapshot (unchanged; mode=ro&immutable=1)
                 |
                 +--> TEMP affiliation_sources
                 |      four columns; restatement survivors only
                 |                |
                 |                v
                 |      TEMP affiliation_edges + covering index
                 |                |
                 +--> main.v_filer_reported_filings (R ∩ C)
                                  |
                                  | indexed anti-join A(R)
                                  v
                    TEMP v_default_inst_filings
                                  |
                         filing_id index + packaged
                         TEMP v_default_holdings
                                  |
                  coverage / aggregate / serving / tail
```

The two staging tables and edge index exist only while the final filing table is
being built. Once the final population is frozen, the helper removes the staging
objects before yielding to consumers. This reduces collision exposure and prevents a
downstream query from accidentally depending on implementation-only tables.

The restatement predicate runs once to produce affiliation sources and once inside the
verified reported view to produce cover-passing final candidates. That inexpensive
second evaluation is intentional reuse of the canonical `R ∩ C` view. The performance
change is that `other_managers` JSON is expanded once into 12,789 indexed edges rather
than re-expanded through a period-wide correlated search for roughly 45,000 filings.

## Locked Decisions

- **LD-A1:** preserve the existing public helper and downstream integration; no new
  public symbol, module, CLI flag, database, schema, or artifact.
- **LD-A2:** the six owned TEMP names are exactly those in A8. No generated names,
  random suffixes, caller prefixes, or persistent objects.
- **LD-A3:** affiliation sources contain only the four columns in A2; do not copy all
  filing columns or any holdings into staging.
- **LD-A4:** manager edges are computed from every restatement survivor before cover
  filtering. Using only reported/cover-passing sources is semantically wrong.
- **LD-A5:** final candidates come from verified `main.v_filer_reported_filings`; no
  production copy of the cover expression is permitted.
- **LD-A6:** stale packaged views cause `ViewVerificationError` inside the helper.
  There is no slow fallback to the stale persistent default view.
- **LD-A7:** do not add a new independent survivor SQL copy. Move the existing
  ingestion `_RESTATEMENT_SURVIVORS` query to
  `amendments._INST_RESTATEMENT_SURVIVORS_SQL`, project only the four columns both
  consumers need, and import it back into `inst13f.py`. The complete pre-existing
  semantic family remains two immutable packaged-view CTEs, one shared database SQL
  constant, and the pre-ingest Python bulk rule. A future ordering change must update
  the applicable members and keep all four agreement gates green in one reviewed
  change.
- **LD-A8:** full-snapshot wall times and row counts are diagnostic. The 180-second
  per-phase interruption, coverage/F8, D1, R12, and tail rules remain the gates.
- **LD-A9:** the binding rerun writes a new `T0-v3.log`; T0-v2 is immutable evidence.
- **LD-A10:** Phase D remains blocked until T0-v3 exits 0 and all required evidence is
  appended. No compression or tail decision is inferred from the research probes.

## Alternatives considered and rejected

- **Raise or remove the 180-second limit:** rejected; it hides the measured
  algorithmic multiplication and violates the parent stop contract.
- **Materialize the same persistent default view again:** rejected by T0-v2; its
  affiliation stage is the timeout.
- **Use only `v_filer_reported_filings` as affiliation sources:** rejected; a
  restatement survivor that fails cover can still suppress an affiliate under the
  reviewed affiliation-before-cover semantics.
- **Compute edges from every active filing:** rejected; a superseded original's stale
  `other_managers` must neither suppress an affiliate nor be suppressed.
- **Copy the cover predicate into the new CTAS:** rejected; the verified reported view
  already supplies the canonical cover-passing population and avoids another formula.
- **Add `MATERIALIZED` to the existing CTE:** rejected; it still leaves a period-wide
  affiliation scan per candidate and supplies no indexed manager lookup.
- **Add a persistent normalized affiliation table or snapshot v2:** rejected; it
  expands ingestion/schema scope and mutates the accepted-source contract when a
  derive-local 12,789-row lookup was measured sufficient.
- **Parse or rewrite stored view SQL at runtime:** rejected as brittle SQL-text
  metaprogramming with worse drift and error behavior than a narrow, tested predicate.
- **Python loops/dictionaries:** rejected; the set is naturally expressed as three
  bulk SQLite operations, and per-row Python creates a second execution engine.
- **Keep staging objects alive for consumers/tests:** rejected; final consumers need
  only the established filing table/index and holdings view.
- **Change `views.sql`:** rejected; external snapshot view verification would then
  require a new accepted snapshot and widen this derive-side delta.

## Planned files

- `src/populus/amendments.py` — replace the old single-view CTAS inside the existing
  helper at current line 155 with verified survivor-source, manager-edge,
  covering-index, and final anti-join stages; move/rename the existing ingestion
  survivor SQL here as the shared four-column source; expand collision and cleanup
  ownership; update its docstring.
- `src/populus/ingest/inst13f.py` — remove the current private survivor SQL at line
  885, import the shared constant from `amendments.py`, and adjust
  `mark_affiliated_coverage` to unpack the four columns it actually uses. Coverage SQL
  and arithmetic at current lines 1257-1470 remain unchanged.
- `tests/test_cover_tolerance.py` — exact filing-row and complete coverage parity;
  restatement/NEW_HOLDINGS/tie, superseded-source, cover-conflicted-source,
  self-reference, NULL, and cross-period affiliation cases; stale-view refusal;
  six-name collision and every-stage cleanup mutants.
- `tests/test_inst_external_store.py` — assert staging objects are gone before the
  context body, consumer TEMP objects persist only inside it, source bytes/main
  schema/sidecars remain unchanged, and existing aggregate/serving parity still holds.
- `docs/build/RUN-M2-11-T0-findings.md` — append the read-only diagnosis, plan-review
  resolution, final gates, T0-v3 log digest, complete T0/R12 evidence, and decision.
- `docs/build/RUN-M2-11-T0-affiliation-index-delta-plan.md` — this plan and only
  review-driven plan revisions before implementation approval.

No new source/test module is planned. `src/populus/views.sql`,
`src/populus/publish/build.py`, `scripts/measure_inst_derive.py`,
`tests/test_inst_snapshot_script.py`, snapshot v1, and all derived schemas are out of
scope unless independent plan review identifies a concrete requirement that first
gets resolved in this document.

The sole new operational output is
`/Users/johnbaek/projects/Populus-ops/snapshots/evidence/m2-11/T0-v3.log`. It is
outside the worktree, remains unstaged, and is retained through Phase D review.

## Implementation tasks

### Phase 0 — independent plan checkpoint

- **A-T0:** Run `plan-review` against this exact plan, the live dirty worktree,
  T0-v2 log, findings, current implementation, and baseline hashes. Resolve every
  finding in the plan and obtain APPROVED before editing implementation or test files.

### Phase 1 — staged materialization

- **A-T1:** Rebaseline HEAD, dirty inventory, prior plan/log digests, and the five
  content hashes. Re-run the reuse/consumer scan. Stop on unexplained drift.
- **A-T2:** Move the existing `_RESTATEMENT_SURVIVORS` SQL from `inst13f.py` to
  `amendments._INST_RESTATEMENT_SURVIVORS_SQL`, remove its unused `cik` projection,
  and import it back for `mark_affiliated_coverage`. Add only two new private fixed
  SQL statements for normalized edge expansion and the final reported-minus-edge
  CTAS. Expand the owned-name tuple to the exact six A8 names. Keep all values fixed
  or parameterized; no caller text enters SQL.
- **A-T3:** Change the existing context lifecycle to collision-check → verify packaged
  views → create survivor source → create edges → create covering edge index → create
  final default table → create final filing index → remove the three staging objects →
  create packaged TEMP holdings view → yield → remove consumer objects. Track every
  successful creation so exceptions at every intermediate statement clean only owned
  state.

### Phase 2 — semantic and failure proof

- **A-T4:** Extend filing-level parity fixtures so complete ordered rows from
  `temp.v_default_inst_filings` equal `main.v_default_inst_filings`. Include later-date,
  amendment-number, and accession restatement ties; active/inactive lifecycle;
  NEW_HOLDINGS; a superseded original with stale managers; a cover-conflicted survivor
  that supplies an affiliation edge; self-only and other-source references; duplicate
  manager entries; NULL file numbers; and cross-period non-matches.
- **A-T5:** Re-run complete `InstCoverage` and `PeriodCoverage` equality, the non-empty
  direct F8 stale-view backstop, and aggregate/serving logical parity. Change the
  materialized stale-view case to require `ViewVerificationError` before TEMP data
  creation. Every test must fail if the edge index/anti-join, survivor restriction,
  cover-conflicted source, or self-reference exclusion is removed.
- **A-T5a:** Run the complete survivor-family drift chain: helper final rows against
  the real default view; ingestion affiliation flags against the real default set in
  `test_inst_ingest.py`; packaged reported/default set identity in
  `test_filer_reported_views.py`; and pre-ingest Python ranking against the real view
  in `test_inst_bulk.py`. This is the executable update obligation for the two view
  CTEs, shared SQL constant, and Python bulk rule.
- **A-T6:** Parameterize collisions over all six names and injected setup failures at
  every stage. Prove caller-owned state survives, private staging is absent before
  `yield`, only the three consumer objects exist during the body, every owned object
  is gone after normal/exception/withholding exit, and main bytes/schema/sidecars are
  unchanged.
- **A-T7:** Preserve the existing T0 exact-query EXPLAIN test showing downstream
  grouped coverage uses `v_default_inst_filings_by_filing` with no amendment cascade.
  If a test-only staged-plan assertion is necessary, keep it inside an existing test
  module and do not add a production API. Do not assert machine wall-clock in pytest.

### Phase 3 — gates and binding rerun

- **A-T8:** Run the targeted adjunct, `git diff --check`, and every canonical gate
  after the final source edit. Record commands and exit statuses. A pre-existing gate
  failure is reported and isolated; it is never repaired inside this delta.
- **A-T9:** Run binding T0-v3 unbuffered against the immutable snapshot, deliberately
  without `--build-date`, retaining the new log:

  ```bash
  t0_evidence_dir=/Users/johnbaek/projects/Populus-ops/snapshots/evidence/m2-11
  mkdir -p "$t0_evidence_dir"
  set -o pipefail
  PYTHONDONTWRITEBYTECODE=1 .venv/bin/python -u scripts/measure_inst_derive.py \
    --snapshot /Users/johnbaek/projects/Populus-ops/snapshots/inst-source-v1.db \
    --measured-files 8106 \
    --pilot-filers 500 \
    --full 2>&1 | tee "$t0_evidence_dir/T0-v3.log"
  ```

  Do not use `tail`, overwrite T0-v2, supply a guessed build date, raise a timeout, or
  continue after a STOP.
- **A-T10:** Append to findings the exact T0-v3 log path, SHA-256, byte/line count,
  exit status, both complete D1 states, materialization/coverage/period/aggregate/
  serving timings, peak RSS, aggregate bytes, R12 branch, tail geometry, row counts,
  and any pathology. Only a complete exit-0 record unlocks Phase D.

## Testing strategy

Targeted adjunct after implementation:

```text
PYTHONDONTWRITEBYTECODE=1 .venv/bin/python -m pytest -q \
  tests/test_cover_tolerance.py \
  tests/test_inst_ingest.py \
  tests/test_filer_reported_views.py \
  tests/test_inst_bulk.py \
  tests/test_inst_external_store.py \
  tests/test_inst_snapshot_script.py
git diff --check
```

Exact canonical standing gates, unchanged:

```text
make check
make accept-m1-b
make accept-m2-5
make accept-m2-6
make accept-m2-8
make accept-m2-11
```

The targeted command and diagnostic SQL probes are adjuncts. Only the exact canonical
commands plus binding T0-v3 establish acceptance.

## Verification matrix

| Requirement | Proof |
|---|---|
| A1 | Stale/missing-view tests poison all packaged definitions and require `ViewVerificationError` before a main-data trace or TEMP creation. |
| A2 | TEMP schema/column assertions and complete stage-source fixture equality across every restatement ordering/lifecycle case. |
| A3 | Edge rows equal expected period/manager/source triples; NULL, duplicate, stale-source, and cross-period mutants are removal-fails. |
| A4 | Full-snapshot diagnostic EXPLAIN uses the covering edge index; binding materialization completes under the unchanged T0 bound. |
| A5–A6 | Complete ordered filing-row equality plus the cover-conflicted affiliation-source case and two-way fixture `EXCEPT`. |
| A7 | Existing downstream EXPLAIN uses the final filing index; TEMP holdings definition remains packaged-DDL-derived. |
| A8 | Six-name collision matrix, every-stage injected failure, staging absent at yield, normal/body/withholding cleanup. |
| A9 | Direct stale F8 remains non-empty/uncertifiable; materialized stale source refuses before returning a result. |
| A10 | Existing transaction recorder: one materialization after BEGIN, aggregate-first order, last source read before the single COMMIT, DETACH after. |
| A11 | Existing timeout/D1/widest/R12 tests unchanged; T0-v3 raw log carries complete successful evidence. |
| A12 | Forced STOP tests preserve exit 4/5 precedence and later-phase suppression; findings/Phase D checklist remains blocked. |

## Rollout and rollback

This delta affects only connection-local derivation. It has no deployment migration,
snapshot cut, persistent schema update, or data rollback. On any semantic, cleanup,
gate, T0, R12, or tail failure, stop before Phase D and revert exactly this delta's
`src/populus/amendments.py`, `src/populus/ingest/inst13f.py`, the two edited test
files, findings, and plan hunks while preserving every parent-delta and other
pre-existing dirty hunk. The parent delta's safe timeout and immutable snapshot path
remain available. Closing the source connection removes any residual TEMP state even
after an unexpected process failure.

## Simplicity Audit

| Item | Disposition | Forced by | Simpler alternative rejected |
|---|---|---|---|
| existing `materialized_inst_derivation_views` | Modify one public function; no new public API | One lifecycle already serves publish and T0 | A second helper would split contracts and cleanup. |
| `_INST_RESTATEMENT_SURVIVORS_SQL` | Move/rename the existing ingestion SQL and share it with the helper | Narrow pre-cover restatement source is not exposed by snapshot v1 | A new helper-local copy would expand drift; importing `inst13f.py` into `amendments.py` reverses ownership and loads the ingest stack. |
| `_INST_AFFILIATION_EDGES_SQL` | One new private fixed SQL constant | Expand JSON once in bulk | Python loops or inline duplicate SQL obscure the stage. |
| `_MATERIALIZED_DEFAULT_INST_FILINGS_SQL` | One new private fixed SQL constant | Reuse reported candidates and indexed anti-join | Copying cover arithmetic creates more drift. |
| two private TEMP tables | Runtime-only, dropped before yield | Separate survivor and normalized-edge sets enable the index | One nested correlated query recreates the scan. |
| one private covering TEMP index | Runtime-only, dropped before yield | Converts period/file-number search to indexed lookup | A source-table index cannot index JSON array members. |
| existing final TEMP table/index/view | Reuse unchanged | Stable consumer namespace and downstream plans | Consumer rewrites would widen every query. |
| two edited test modules plus four unchanged sibling/T0 suites | Extend semantic/lifecycle owners; rerun existing cross-implementation guards | Existing fixtures already own the contracts | A new test module would duplicate setup. |
| T0-v3 evidence log | New external artifact, not source | Preserve failed v2 and successful retry separately | Overwriting v2 destroys provenance. |

**Public-symbol enumeration:** no new public symbol. The moved survivor constant, two
new SQL constants, and three new staging object names are private implementation
details. No new file beyond this
plan, dependency, dataclass, CLI option, schema object, route, payload field, or
published artifact is introduced.

## Tech Debt Introduced

No new independent restatement-survivor implementation is introduced. This delta
moves the existing ingestion SQL to the amendment/view-semantics owner and makes both
ingestion and TEMP derivation consume it. It adds no TODO, stub, disabled test,
fallback, persistent cache/table, source mutation, timeout relaxation, dependency, or
duplicate cover predicate.

The complete **pre-existing** survivor-rule duplication surface is now explicit:

1. `v_inst_reconciled_filings` CTE in `src/populus/views.sql:78-94`;
2. `v_filer_reported_filings` CTE in `src/populus/views.sql:147-164`;
3. the shared database SQL currently at `src/populus/ingest/inst13f.py:885-901`, moved
   by this delta to `amendments._INST_RESTATEMENT_SURVIVORS_SQL`;
4. pre-ingest mapping logic in `src/populus/inst_bulk.py:284-313`.

Snapshot-v1 immutability prevents refactoring the two stored view definitions, and the
pre-ingest ranker cannot execute database SQL. Drift is bounded by four executable
guards: `tests/test_filer_reported_views.py:177-263` between the view chains,
`tests/test_inst_ingest.py:289-331` between ingestion flags/shared SQL and the real
default set, `tests/test_inst_bulk.py:291-400` between Python ranking and the real
view, and this delta's complete TEMP/main filing-row equality in
`tests/test_cover_tolerance.py`. A future ordering change must update every applicable
representation and keep all four guards green in one reviewed change. A reusable
persistent survivor relation may repay this debt only with a future accepted snapshot
revision.

Two pre-existing risks remain visible:

- Direct full-corpus `compute_period_coverage` calls outside the opted-in derive
  context still use the persistent default view and may be slow.
- `v_filer_reported_filings` remains a persistent view and may expose a later
  full-corpus pathology. If a later T0 phase crosses its existing bound, that is a new
  measured stop, not scope for this delta.

## Memory Touch-Points

The memory index was ranked for affiliation, materialization, SQLite, TEMP, JSON,
index, high-cardinality, query plan, parity, read-only, planning, gates, failure, and
evidence. The top ten files were loaded in full:

- `feedback_gate_list_completeness.md` — retained all six standing commands in
  addition to the targeted pytest adjunct.
- `feedback_plan_development_vs_execution.md` — this user request is plan authoring;
  the turn stops before implementation and awaits independent approval.
- `feedback_preexisting_gate_fix_pattern.md` — forbids folding any unrelated gate
  repair into this already-dirty feature branch.
- `feedback_canonical_gate_vs_adjunct_helpers.md` — classifies the read-only probes and
  targeted pytest as adjuncts; the exact Make chain and T0-v3 are canonical.
- `feedback_dependency_gate_landed_code.md` — the delta is based on the live parent
  implementation and retained v2 log, not only the approved parent prose.
- `feedback_diagnostic_gated_separation.md` — stage timings and counts remain
  diagnostic; D1, timeout exits, coverage/F8, R12, tail, and T0 completion gate.
- `feedback_full_tree_gate_scope.md` — `make check` remains full-scope rather than a
  changed-file substitute.
- `feedback_gate_first_before_read_not_dependency.md` — translated to packaged-view
  verification before the helper's first main-data query, not before connection use.
- `feedback_gate_function_exit_codes.md` — preserves nonzero timeout/D1/R12/tail
  behavior and later-phase suppression.
- `feedback_honest_gate_miss_reporting.md` — T0-v2 remains a declared failure; v3 may
  not change bounds or semantics to manufacture a pass.

## Failure-Mode Sweep

- **F0 full-set:** the complete default/reported consumer set and survivor-rule family
  were rescanned. Production edits are the existing lifecycle helper plus relocation
  of the existing ingestion SQL constant; all consumers inherit the same final
  namespace. Both packaged CTEs, shared database SQL, and pre-ingest Python rule are
  named with executable agreement guards. The plan distinguishes measured facts from
  the inference that the indexed decomposition will unblock later phases. No secret
  or credential is read.
- **F1 plan-time:** exact dirty baseline hashes, all six owned names, all planned
  files, full gates, exact T0 command, units, exit behavior, and no-main-write scope
  are enumerated. The cover-conflicted edge source closes the non-commuting-filter
  trap; the architecture explicitly permits the reported view's second cheap survivor
  evaluation while requiring exactly one affiliation JSON expansion. Every
  implementation choice is locked.
- **F2 dev-time:** all high-cardinality work is bulk SQL. Fixed SQL carries no caller
  input. Removal-fails tests cover survivor selection, indexed anti-join, self
  exclusion, stale-source exclusion, stale-view refusal, six-name collisions, and
  every partial setup path. Stale docstrings/order comments are updated.
- **F3 QA-time:** exact row/object/digest/projection parity exercises the complete
  function, not TEMP-object liveness. Binding T0-v3 uses the real immutable 21 GiB
  source and exact production queries; D1 checks bytes/schema/sidecars on every exit.
- **F4 handoff:** propagate the new v3 path/status through findings and any Phase D
  checklist without rewriting v2 history. Any source repair after gates invalidates
  all gates, T0-v3, QA artifacts, and review bundle.
- **F5 transport:** independent review consumes this exact plan, live worktree,
  parent plan digest, current file hashes, v2 log digest, and findings. A missing or
  partial v3 log is a hard preflight failure, not evidence. Model/reviewer provenance
  and review-output schema remain the review bridge's responsibility.

## Independent Review Resolution

- **Round 1 F1 resolved:** the Reuse Map now enumerates both packaged view CTEs, the
  existing ingestion SQL, and the bulk-ranking Python rule. The plan moves and shares
  the ingestion SQL instead of adding another helper copy, expands Planned Files to
  `inst13f.py`, declares the complete pre-existing duplication surface, and binds all
  four executable agreement guards plus their future update obligation.
- **Round 1 F2 resolved:** Success criterion 2 and the Architecture now state the
  precise performance contract: one survivor evaluation for affiliation-source
  staging and exactly one JSON edge expansion. The verified reported view separately
  performs its inexpensive survivor/cover evaluation for final candidates; literal
  one-time evaluation of every survivor predicate is not claimed.
- **Round 1 F3 resolved:** current path:line anchors now identify the persistent view
  CTEs, ingestion SQL, bulk Python rule, helper, validator, packaged-view reader,
  coverage functions, derive wrapper, semantic guards, and T0 entry/materialization
  points. Planned-file anchors are explicitly pre-implementation locations and are
  re-pinned on any baseline drift.
- **Round 2 F4 resolved:** the opening scope now names the behavior-preserving
  `inst13f.py` SQL relocation as well as the helper rewrite. Rollback now enumerates
  both production files, both edited test files, findings, and plan hunks, and
  explicitly preserves parent-delta and all other pre-existing dirty hunks.

## Definition of Done

1. Independent plan review approves this exact delta before implementation starts.
2. The live baseline matches the pinned HEAD, parent/log digests, and file hashes or
   is explicitly rebaselined and re-reviewed.
3. A1–A12 pass through the verification matrix with no undeclared plan deviation.
4. Only Planned Files change because of this delta; all pre-existing dirty work is
   preserved and remains unstaged.
5. Targeted pytest, `git diff --check`, and all six canonical commands exit 0 after
   the final source change.
6. Verified-view fixtures produce complete row, coverage, period, aggregate, and
   serving equality; stale definitions fail closed before staged reads.
7. Private staging objects are never visible to consumers and no owned TEMP object
   leaks across normal, exception, withholding, collision, or partial setup paths.
8. Binding T0-v3 exits 0 and records every required phase, D1, aggregate-byte, R12,
   peak-RSS, and tail value at the locked external path with a retained SHA-256.
9. Snapshot v1 retains its exact SHA, ordered main schema, 0444 mode, and absent
   `-journal`/`-wal`/`-shm`; no snapshot v2 exists.
10. Findings preserves T0-v2 and appends the full v3 result. Phase D stays blocked
    unless v3 completes and R12 explicitly locks the no-compression branch.

## Open decisions

None. An independent reviewer may request a plan correction, but implementation has
no discretionary choices. A timeout, parity failure, D1 mismatch, R12 breach, tail
failure, or new real-path pathology is a mandatory stop for another owner-reviewed
delta.
