# RUN M2-11 — F4/F5 Finalization Repair Plan

## Goal and Success Criteria

Resolve only the two open blockers in the canonical round-6 QA review: bind every
adoption and phase record to its exact authoritative path (F4), implement the
complete locked mutation/refusal matrix and correct the overstated QA coverage
claim (F5), then run one create-once logical QA round 7. Product bytes, T0-v11,
the source snapshot, performance limits, publication behavior, and deployment
controls remain unchanged.

Success means the new owner decision and this plan are independently approved;
the exact 70-path candidate passes the focused mutation suite and all 15 standing
gates once; the round-7 bundle validates with exact path provenance; and only a
fresh independent QA approval may enter docs review. Any plan rejection, gate
failure, QA rejection, repository change after binding, or request for round 8
stops.

## Requirements

- **R1 — Exact owner boundary.** Implement only F4/F5 under the literal new
  decision, exact sorted exception scope, exact run ID, logical round 7, cap 7
  with owner override true, and no round 8.
- **R2 — Exact current-artifact paths.** Every one of the 23 adoption records
  must have `path == (bundle_dir / record-name).resolve()` and exact name,
  schema, digest, required flag, regular-file status, and no symlink. Same-content
  copies outside that exact path must refuse.
- **R3 — Exact phase graph paths.** Each current phase base input and output must
  equal its corresponding adoption record. Every predecessor phase record must
  equal the exact normalized record derived from `adoption.prior_round`; schema-
  only or digest-only acceptance is forbidden. Recovery renamed records,
  finalization round-4 `prior-gate-*` records, round-5/6 review records, and the
  new round-7 unsealed-review predecessor must all remain exact.
- **R4 — Honest round-6 rejection predecessor.** Preserve round 6 unchanged and
  unsealed. Accept it only through a private exact-pin path requiring its bundle
  namespace, token, token-file/adoption/decision digests, strict public bundle
  validation, canonical external review digest, `review-output-v1`, final
  `CHANGES_REQUESTED`, open IDs exactly `("F4", "F5")`, token/fingerprint
  markers, and exact F4/F5 resolution. Bind the exact round-6 adoption manifest
  instead of fabricating a sealed review manifest.
- **R5 — Complete fail-if-removed matrix.** Parameterize every adoption and
  phase input/output record across cross-path, label, and stale-content/digest
  mutations; every immutable historical policy pin; every expected-defect set;
  every predecessor shape; and round-6 open-ID/verdict mutations. Each mutation
  must exercise the named property and fail if the guard is removed.
- **R6 — One fresh round-7 bundle.** Run the unchanged 15 direct gates once on
  the exact 70-path tree, with one fingerprint and generated round-7/70-path/
  `TD-QA-ORIGIN-1` through `TD-QA-ORIGIN-8` evidence. Do not rerun T0.
- **R7 — Same-candidate release boundary.** Only sealed independent round-7 QA
  approval and then sealed docs approval may authorize exact-tree staging,
  fixed-base PR/merge, and supervised functional deployment.
- **R8 — Factual append-only records.** Dev Notes and repository QA report must
  record the round-6 F4/F5 rejection, implemented controls, exact focused results,
  pending round-7 outcomes, and TD8 without rewriting prior evidence or making
  advance approval/deployment claims.

## Scope

Authorized repository writes are exactly:

1. `docs/build/RUN-M2-11-QA-finalization-F4-F5-decision.md`
2. `docs/build/RUN-M2-11-QA-finalization-F4-F5-plan.md`
3. `docs/build/RUN-M2-11-devnotes.md`
4. `docs/build/RUN-M2-11-qa-report.md`
5. `scripts/build_m2_11_qa_bundle.py`
6. `tests/test_m2_11_qa_bundle.py`

Authorized append-only external outputs are one exact F4/F5 resolution note,
one round-7 final-message artifact, one `qa-v9-finalization-round-7/` bundle, its
independent QA review/seal, and—only after QA approval—global docs attempts A1
through A3 as needed.

No product, dashboard, database, aggregate, serving, payload, shard, build,
workflow, runbook, acceptance, dependency, T0, snapshot, or generic orchestrator
file is writable.

## Non-goals

- No product correctness, performance, schema, route, payload, UI, or build change.
- No T0-v11/full-corpus rerun and no snapshot write.
- No edit, seal, rewrite, or relabel of rounds 1–6 or their reviews.
- No generic schema framework, second runner, or orchestrate-tool change.
- No relaxed path, digest, schema, gate, limit, threshold, security, or deploy rule.
- No round 8, second repository repair after round 7, or self-approval.

## Constraints

- Worktree is `/Users/johnbaek/projects/Populus-m28/.claude/worktrees/m2-11`,
  branch `codex/m2-11-t0-finalize`, HEAD
  `7391d947f72cf408a173f1e7938102608b2269d4`, fixed base
  `21340330a0fad7e9e39c1a9cec67656643621b05`, with an empty index.
- Round-6 token is
  `sha256:0a1a13d0e8a73f6981c03d4478b6e768b2dbf971809aa9572cbd3d95caf7b0b1`;
  token-file SHA-256 is
  `30d26ca00b7c129a8cbf0329a24efa7757fd210217ce00a920dda15a324d382d`,
  adoption SHA-256 is
  `2185a6052e46e2d585e981945f4e13dc16413fe52bf0d86648c16e3ccbec554f`,
  decision SHA-256 is
  `148a522d1e4d153744469004c88fd109e4469a30826c344f0fa63ebdf26e72fa`,
  canonical review SHA-256 is
  `05e24c59d9dd95bb3a7becf04c33f291d2286363f73b838cffb8cb20a2c34cd3`,
  and bundle fingerprint is
  `1225aba74d91d4ab8f7854311233d1d577f26d868787d184ad76d0632a9781b8`.
- Round 6 has no sealed review or review manifest by explicit QA order. Its
  canonical review has F3 resolved, exactly F4/F5 open, and final verdict
  `CHANGES_REQUESTED`.
- T0-v11 remains 63,400 bytes at SHA-256
  `7078a42934484c9c5ba7f975654476e0788c385dbaf8108c0d429a58ba91a453`.
- Snapshot remains 23,058,628,608 bytes, mode `0444`, sidecar-free, at SHA-256
  `977a4d249d92590a4de2961a3e9c7ff8cfa2e4846f0097ec7aa6c07f28124121`.
- Evidence is create-once, mode 0600/0700, append-only, and never overwritten.
- Any source repair invalidates round-6 gates for approval. Round 6 remains only
  the exact rejected predecessor and must continue to validate offline.

## Current State

- Round 6 completed all 15 direct gates with one fingerprint and a valid strict
  23-artifact bundle; the original round-5 F3 is resolved.
- Independent QA found F4 because adoption and extra phase paths were checked by
  existence/digest but not exact authoritative location.
- Independent QA found F5 because the plan-required per-record mutation matrix
  was incomplete and the repository QA report overstated coverage.
- The canonical rejection is preserved outside the bundle and intentionally
  unsealed. No docs attempt, staging, PR, merge, variable mutation, or deployment
  followed.
- Product bytes are unchanged from the previously approved candidate.

## Detected Stack

- **Languages:** Python 3.12.13 plus TypeScript/Astro on Node 24.
- **Python runner:** repository `.venv`/uv lock with pytest; Make owns full gates.
- **Node runner:** npm 11 with `dashboard/package-lock.json`; Node native tests.
- **Storage/publication:** SQLite/JSON1, signed static artifacts, GitHub Actions.
- **Canonical gates:** the unchanged 15 commands in Testing Strategy.
- **Stack cache:** absent/stale; manifests and Make/package scripts were detected.

## Reuse Map

| Need | Existing implementation | Locked reuse |
|---|---|---|
| current record validation | `validate_bundle`, `CURRENT_ARTIFACT_SCHEMAS` | add exact path equality before existing schema/digest routes |
| phase graph | `validate_phase_manifest`, `PHASE_BASE_INPUTS` | replace schema-only predecessor input with exact expected records |
| predecessor identities | adoption `prior_round`, sealed-review and failed-bundle validators | normalize from existing prior records; add one exact unsealed round-6 rejection sibling |
| review findings | `open_blocker_ids`, `validate_resolution_notes` | require exactly F4/F5 and exact resolution headings |
| immutable policies | `HISTORICAL_POLICIES`, round-5 expected-failure path | keep one policy table and shared exact-defect core |
| mutation fixtures | existing synthetic docs/bundle fixtures and real immutable bundles | add small record factories and parameterized mutations in the same test module |
| round/cap transport | digest-derived cycle branches | add one exact round-7 branch only |
| docs/release | existing seal and release commands | extend round regex/inventory without new release code |

Repository scanning found one active M2-11 QA runner and one focused test module.
No alternative path-binding validator, mutation framework, or retry runner exists.

## Architecture

### A. Exact current adoption path contract

For each of the exact 23 records, validate before schema interpretation:

```text
record keys == {name,path,digest,schema,required}
name is one exact CURRENT_ARTIFACT_SCHEMAS key
Path(path) == (bundle_dir / name).resolve()
Path(path) is absolute, regular, non-symlink, and directly parented by bundle_dir
schema == CURRENT_ARTIFACT_SCHEMAS[name]
digest == sha256(exact path)
required is true
```

Set equality, not subset, is mandatory. A same-content file elsewhere, `..`,
symlink, alternate basename, swapped record, stale digest, or correct digest at a
foreign path refuses. Existing actual-schema execution then runs unchanged.

### B. Exact phase/predecessor record contract

`validate_phase_manifest` receives exact expected predecessor records, not a
name/schema map. Its current 17 base inputs and output must equal normalized full
records derived from the current adoption map. Extra inputs must equal the full
expected records below, including path and digest:

- recovery rounds 2/3: normalize adoption `prior-review` to phase name
  `prior-qa-review`, plus the exact adoption resolution record;
- finalization round 4: exact equality with all 13 adoption `artifacts` records
  and the adoption resolution record;
- rounds 5/6: exact equality with the three adoption `prior_round` records;
- round 7: exact `prior-qa-review`, `prior-bundle-adoption`, and
  `resolution-notes` records in both adoption and each custom phase manifest.

Every record list is unique and byte-sorted. Missing, extra, duplicated, renamed,
relabeled, cross-path, stale, or substituted inputs/outputs refuse. Historical
private validators still require their exact pins/defect sets before applying
these relationships; no compatibility fallback reaches round 7.

### C. Exact unsealed round-6 QA predecessor

The QA reviewer explicitly ordered round 6 not to be sealed. The round-7 bridge
therefore must not invent a review manifest. A new private validator requires:

1. exact `qa-v9-finalization-round-6` namespace and strict offline public bundle
   validation under the repaired exact-path code;
2. the locked token value, token-file/adoption/decision digests and fingerprint;
3. exact external path
   `qa-review.finalization-r6.canonical.md`, digest
   `05e24c59d9dd95bb3a7becf04c33f291d2286363f73b838cffb8cb20a2c34cd3`,
   valid `review-output-v1`, final `CHANGES_REQUESTED`, open IDs exactly F4/F5,
   and literal token/fingerprint markers;
4. exact round-6 adoption manifest as `prior-bundle-adoption` with schema
   `adoption-qa-manifest/v1`; and
5. exact F4/F5 resolution note, with no other heading.

It returns `rejected-round6-f4-f5`, never `approved` or `valid`. The public
round-6 bundle remains strictly valid; only its external QA verdict is rejected.

### D. Exact mutation/refusal matrix

Add named record factories that create canonical in-memory/temp-path records;
do not rewrite Python source in the mutation loop. The test module, independently
of production maps, freezes these literal oracles:

- `EXPECTED_ADOPTION_NAMES`: the 23 filenames printed by Architecture A;
- `EXPECTED_PHASE_NAMES`: the three literal custom phase-manifest filenames;
- `EXPECTED_PHASE_RECORDS`: for each phase, the 17 literal base semantic names,
  its one literal output semantic name, and the three literal round-7 extras;
- `EXPECTED_HISTORICAL_NAMES`: `qa-v9-round-1`, `qa-v9-round-2`,
  `qa-v9-round-3`, `qa-v9-finalization-round-1`, and
  `qa-v9-finalization-round-4`;
- `EXPECTED_PREDECESSORS`: literal record names for recovery rounds 2/3
  (2 each), finalization round 4 (the 13 named `prior-gate-*` records plus
  `resolution-notes`), rounds 5/6 (3 each), and round 7 (3), for 27 record
  occurrences across six shapes; and
- `EXPECTED_DEFECT_SETS`: the five literal historical defect tuples plus the
  literal round-5 four-defect tuple, copied from the approved immutable evidence,
  never imported from the production policy table.

The suite first asserts exact equality between every production key/name set and
the corresponding literal test oracle. Parameterization and expected IDs are
then generated only from those test-local literals; production-map shrinkage
therefore fails before any mutation. The locked ID grammar and counts are:

| Family | ID grammar | Exact count |
|---|---|---:|
| adoption | `adoption::<filename>::<mutation>`; 23 filenames × `cross-path-same-content`, `wrong-schema`, `content-stale-digest`, `digest-only` | 92 |
| phase | `phase::<manifest>::<input-or-output>:<semantic-name>::<mutation>`; 3 × 21 records × the same four mutations | 252 |
| historical pin | `history::<namespace>::<pin>`; 5 × `namespace`, `adoption-sha`, `token-file-sha`, `token-value`, `decision-sha` | 25 |
| defect set | `defects::<namespace>::<missing-or-extra>`; five historical plus round 5 × two directions | 12 |
| predecessor record | `predecessor::<shape>::<record>::<mutation>`; 27 records × `missing`, `duplicate`, `relabel`, `cross-path-same-content`, `content-stale-digest`, `digest-only` | 162 |
| predecessor shape | `predecessor::<shape>::extra-record`; one per six shapes | 6 |
| round-6 review | `review::round6::<mutation>`; `missing-f4`, `missing-f5`, `extra-f6`, `relabel-heading`, `approved-verdict`, `wrong-review-digest`, `wrong-token`, `wrong-fingerprint`, `cross-path-same-content` | 9 |

Thus `EXPECTED_REFUSAL_IDS` contains exactly 558 literal-derived IDs. A separate
23-ID happy-path oracle contains current round-6 adoption (1), three phase
manifests (3), five historical policies (5), six exact defect sets (6), six
predecessor shapes (6), the pinned unsealed round-6 review (1), and a synthetic
round-7 bundle (1). `EXPECTED_ALL_IDS` is their disjoint union of exactly 581,
and the collected executed IDs must equal it byte-for-byte.

Per-record mutations execute against the smallest relevant validator helper;
only the six `extra-record` cases are once per predecessor shape. A
`content-stale-digest` mutant changes file bytes while retaining the old record
digest; a `digest-only` mutant changes only the record digest while retaining
the file bytes. Cross-path copies retain identical bytes. Each case asserts its
guard-specific error, so deleting or weakening the named guard makes that mutant
survive and fails the suite. No source-mutating harness or bytecode cache is used.

### E. Exact round-7 state machine

The exact sorted exception scope is:

```text
FINALIZATION_F4_F5_EXCEPTION_SCOPE = (
  "current-tree-adoption-instead-of-historical-pre-build-origin",
  "owner-authorized-fifth-finalization-repair",
  "owner-authorized-fourth-finalization-retry",
  "owner-authorized-qa-docs-finalization-cycle",
  "owner-authorized-seventh-finalization-f4-f5-repair",
  "owner-authorized-sixth-finalization-f3-repair",
  "repo-local-custom-schema-validator",
)
```

The exact run ID is
`RUN-M2-11-QA-finalization-f4-f5-exception`; the cycle is
`finalization-f4-f5-exception`; cap is 7, owner override is true, and allowed
rounds are exactly `(7,)`.

```text
exact rejected round-6 F4/F5 evidence + exact resolution + approved authority
  -> all preflights before output creation
  -> one create-once round-7 bundle
  -> 15 unchanged gates PASS
  -> strict exact-path bundle validation PASS
  -> independent QA APPROVED
  -> docs review APPROVED
  -> exact-tree PR/merge and supervised functional deployment
```

Any failed arrow stops. No round 8 exists.

### F. Exact 70-path candidate/release inventory

```text
.github/workflows/publish.yml
ARCHITECTURE.md
Makefile
STATUS.md
dashboard/package.json
dashboard/src/lib/data.ts
dashboard/src/lib/filer-payload.ts
dashboard/src/lib/holdings.ts
dashboard/src/lib/shards.ts
dashboard/src/pages/institutional/data/filers/[shard].v1.json.ts
dashboard/src/pages/institutional/data/filers/[shard].v2.json.ts
dashboard/src/pages/institutional/data/filers/index.v1.json.ts
dashboard/src/pages/institutional/data/filers/index.v2.json.ts
dashboard/src/scripts/entity-client.ts
dashboard/test/filer-payload.test.ts
dashboard/test/post/entity-orchestration.test.ts
dashboard/test/post/file-budget.test.ts
dashboard/test/post/fixture-preview.test.ts
docs/build/RUN-M2-11-QA-finalization-F3-decision.md
docs/build/RUN-M2-11-QA-finalization-F3-plan.md
docs/build/RUN-M2-11-QA-finalization-F4-F5-decision.md
docs/build/RUN-M2-11-QA-finalization-F4-F5-plan.md
docs/build/RUN-M2-11-QA-finalization-decision.md
docs/build/RUN-M2-11-QA-finalization-delta-plan.md
docs/build/RUN-M2-11-QA-finalization-exception-decision.md
docs/build/RUN-M2-11-QA-finalization-exception-plan.md
docs/build/RUN-M2-11-QA-finalization-repair-decision.md
docs/build/RUN-M2-11-QA-finalization-repair-plan.md
docs/build/RUN-M2-11-QA-origin-decision.md
docs/build/RUN-M2-11-QA-origin-recovery-delta-plan.md
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
scripts/build_m2_11_qa_bundle.py
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
tests/test_m2_11_qa_bundle.py
tests/test_pointer_state.py
tests/test_publish.py
tests/test_workflow_governance.py
```

## Locked Decisions

1. Round-6 review remains unsealed; exact adoption binding replaces a fabricated seal.
2. Every adoption path is exact bundle-local identity, never digest-only identity.
3. Phase extras equal full authoritative prior records, never only name/schema pairs.
4. Mutation tests enumerate every locked record/pin/defect/predecessor class.
5. The exact scope tuple, run ID, round 7, cap 7, and no round 8 are literal.
6. All 15 gates rerun once because source repair invalidates approval evidence.
7. Product paths, T0-v11, snapshot, limits, and deployment controls are read-only.
8. A round-7 gate/QA rejection or repository change stops with no further repair.
9. Docs attempts remain external-only and cannot hide a source change.

## Alternatives Considered

- **Seal round 6 retroactively:** rejected; contradicts the independent QA order.
- **Accept same-content foreign paths:** rejected; provenance includes location identity.
- **Check only round-7 paths:** rejected; shared validation must cover every supported path.
- **A few representative mutations:** rejected; F5 explicitly requires the full set.
- **Rewrite Python source in a mutation harness:** rejected; direct record mutation is
  faster, hermetic, and avoids pycache/mtime ambiguity.
- **Skip full gates because product is unchanged:** rejected; source repair invalidates QA.
- **General retry support:** rejected; round 7 is digest-scoped and cannot authorize 8.

## Planned Files

| Path | Planned change |
|---|---|
| `docs/build/RUN-M2-11-QA-finalization-F4-F5-decision.md` | exact authority quote and no-round-8 boundary |
| `docs/build/RUN-M2-11-QA-finalization-F4-F5-plan.md` | this independently reviewed controlling plan |
| `scripts/build_m2_11_qa_bundle.py` | exact adoption/phase paths, round-6 rejection predecessor, round-7 transport |
| `tests/test_m2_11_qa_bundle.py` | complete parameterized F4/F5 mutation/refusal matrix |
| `docs/build/RUN-M2-11-devnotes.md` | factual rejection, implementation, tests, command, TD8 |
| `docs/build/RUN-M2-11-qa-report.md` | factual F4/F5 remediation and pending round-7 result |

## Implementation Tasks

- **T1 [R1, R4, R6, R8]:** pin the new authority and exact round-6 bundle/review
  identities; add exact 70-path inventory, scope tuple, run ID, round-7-only branch,
  cap 7 override, no round 8, and extend docs/release namespaces to 7.
- **T2 [R2]:** require exact `bundle_dir / record-name` equality for all 23
  adoption records before existing digest/schema validation.
- **T3 [R3]:** change phase validation to exact predecessor records derived from
  adoption `prior_round`; cover recovery renames, 13 prior-gate records, rounds
  5/6, and new round 7.
- **T4 [R4]:** add the exact unsealed round-6 F4/F5 review validator, strict
  round-6 bundle pins, exact external review path/digest/content/open IDs, adoption
  binding, F4/F5 resolution, and `rejected-round6-f4-f5` marker.
- **T5 [R5]:** implement every parameterized mutation family in Architecture D,
  freeze the independent literal name/record/defect oracles, assert them against
  production sets, require exact 558-refusal/23-happy/581-total ID equality, and
  use guard-specific assertions; no source-rewrite harness.
- **T6 [R6]:** generate round-7/70-path/TD1..8 report, adoption, phase, token,
  cap, predecessor, sealing, docs, and release evidence with honest schemas.
- **T7 [R8]:** update Dev Notes and repository QA report with only facts true
  before binding and validate both schemas.
- **T8 [R4, R5, R6, R8]:** after focused preflight, create exact append-only
  resolution/final message, run the binding command once, validate, and stop on
  any gate failure.
- **T9 [R6, R7]:** obtain independent QA and seal only approval; only then run
  docs review and exact-tree release/deployment.

## Testing Strategy

Preflight before binding:

1. validate plan-v1, real owner-decision-v1, Dev Notes, repository QA report,
   exact F4/F5 resolution, and final docs-commit;
2. prove exact 70-path equality, empty index, fixed branch/HEAD/base, round-6 pins,
   absent round7/docs outputs, and immutable T0/snapshot;
3. run `PYTHONDONTWRITEBYTECODE=1 .venv/bin/python -m pytest -q
   tests/test_m2_11_qa_bundle.py` and require every Architecture-D case; and
4. validate current round 6 strictly, all historical private/public policies,
   round 5 known-invalid evidence, and the exact rejected round-6 review path.

The one round-7 bundle runs unchanged:

1. `git diff --check`
2. `PYTHONDONTWRITEBYTECODE=1 .venv/bin/python -m pytest -q tests/test_m2_11_qa_bundle.py`
3. `PYTHONDONTWRITEBYTECODE=1 .venv/bin/python -m pytest -q tests/test_inst_shard_budget.py tests/test_inst_snapshot_script.py`
4. `(cd dashboard && node --test test/filer-payload.test.ts test/post/entity-orchestration.test.ts)`
5. `PYTHONDONTWRITEBYTECODE=1 .venv/bin/python -m pytest -q tests/test_inst_agg.py tests/test_cover_tolerance.py tests/test_inst_external_store.py tests/test_inst_snapshot_script.py tests/test_inst_serving.py tests/test_inst_serving_artifact.py tests/test_inst_shard_budget.py tests/test_digests.py tests/test_publish.py tests/test_amendments.py tests/test_mcp_server_inst.py tests/test_inst_federated_boundary.py tests/test_pointer_state.py tests/test_workflow_governance.py`
6. `POPULUS_PREVIOUS_CLIENT_SHA=7391d947f72cf408a173f1e7938102608b2269d4 PYTHONDONTWRITEBYTECODE=1 .venv/bin/python -m pytest -q tests/test_pointer_state.py -k inst_schema_1_1_previous_client`
7. `(cd dashboard && node --test --test-concurrency=1 test/post/fixture-preview.test.ts)`
8. `PYTHONDONTWRITEBYTECODE=1 .venv/bin/python -m pytest -q tests/test_workflow_governance.py`
9. `make check`
10. `make security`
11. `make accept-m1-b`
12. `make accept-m2-5`
13. `make accept-m2-6`
14. `make accept-m2-8`
15. `make accept-m2-11`

No command invokes T0/full-corpus derivation, stages Git, changes GitHub, or
touches production before both reviews approve.

## Verification Matrix

| Requirement | Executable proof |
|---|---|
| R1 | exact quote/decision/plan pins, tuple/run ID/round7/cap7/no round8 equality |
| R2 | all 23 exact bundle paths pass; each cross-path/label/content mutation refuses |
| R3 | every phase base/output/predecessor record equals its authority; every shape mutation refuses |
| R4 | exact round6 bundle/review/adoption/token/fingerprint/open F4/F5 pass; any mutation refuses |
| R5 | independent literal oracles equal production sets; 558 refusal + 23 happy = 581 executed IDs exactly; every guard-specific mutant refuses |
| R6 | 15 zero exits/one fingerprint; round7/70/TD1..8/cap7/token/manifests validate |
| R7 | unchanged tree across QA/docs; exact stage tree; functional supervised deployment |
| R8 | six-file repair delta only; docs factual; product/T0/snapshot unchanged |

## Rollout / Rollback

After approval and focused preflight, create the exact resolution and final
message, then invoke once while output is absent:

```bash
root=/Users/johnbaek/projects/Populus-ops/snapshots/evidence/m2-11
qa_bundle="$root/qa-v9-finalization-round-7"
final_message="$root/final-docs-commit.finalization-r7-a1.md"
PYTHONDONTWRITEBYTECODE=1 .venv/bin/python scripts/build_m2_11_qa_bundle.py run \
  --cycle finalization-f4-f5-exception --round 7 \
  --final-docs-commit "$final_message" \
  --prior-review "$root/qa-review.finalization-r6.canonical.md" \
  --resolution-notes "$root/resolution-notes.finalization-r6-qa.md" \
  --output "$qa_bundle"
PYTHONDONTWRITEBYTECODE=1 .venv/bin/python scripts/build_m2_11_qa_bundle.py validate \
  --bundle "$qa_bundle"
```

On gate failure preserve evidence and stop. On success, obtain independent QA
and seal only an exact approval. Only approval enters docs A1, independent docs
review, pre/post-stage exact-tree validation, commit via the reviewed message,
fixed-base PR/merge, and supervised deployment. Deployment reuses the approved
runbook and verifies real v2 index/shard/filer/page behavior, signature/source/
code bindings, and v1 tombstone upgrade behavior before arming publication.

Rollback before merge is no production change. After merge, use only the existing
signed-pointer/runbook rollback. No failed QA evidence can reach release.

## Simplicity Audit

Two governance files are required for new owner authority. Runtime changes remain
in the single release-specific runner; tests remain in its one focused module.
The only new code concepts are an exact current-record path helper, exact
predecessor-record normalization, one pinned rejected-round-6 validator, and one
digest-scoped round-7 branch. Mutation coverage uses parameterized record data,
not a new framework or source-rewrite loop. No product file, module, dependency,
generic retry system, or parallel validator is introduced.

## Tech Debt Introduced

**TD-QA-ORIGIN-8 — exact path-provenance repair, exhaustive mutation matrix, and
seventh finalization round.** Impact: the release-specific bridge gains one
unsealed-review predecessor shape, record-normalization helper, full mutation
matrix, and digest-scoped round-7 authority. Controls: exact paths/digests/
schemas/pins, public strict validation, guard-specific mutation kills, all 15
gates, independent QA/docs, no product import, and no round 8. Removal: delete
TD1–TD8 and the release-specific runner/tests after the generic harness natively
emits typed exact-path evidence and failed-QA predecessors.

Existing TD1–TD7, eager-build debt, reservation disclosure, and npm advisories
remain visible. No hidden production, security, dependency, timeout, threshold,
snapshot, or deployment debt is introduced.

## Memory Touch-Points

The exact canonical invocation was
`/Users/johnbaek/projects/orchestrate-tool/lib/memory-select.sh
/Users/johnbaek/.claude/projects/-Users-johnbaek/memory/MEMORY.md path provenance
manifest validator mutation QA remediation review`. Its deterministic top ten,
in returned order, were read in full:

- `feedback_qa_fail_batch_remediation.md`: repair F4/F5 in one batch, rerun all
  gates, and await independent QA without self-signing.
- `feedback_qa_remediation_discipline.md`: keep authority, plan, implementation,
  reproducible tests, and factual reports synchronized in the same repair.
- `feedback_api_path_scope_includes_components.md`: require a complete shared-
  consumer sweep; here every supported current/historical phase caller is named.
- `feedback_manifest_columns_by_name_not_index.md`: normalize and compare records
  by semantic name, never position.
- `feedback_model_validator_config_constraints.md`: enforce cross-record
  relationships at the validator boundary, not in prose.
- `feedback_shared_validator_rejection_required.md`: negative-test every supported
  current and historical caller of the shared record validators.
- `feedback_stale_review_snapshot_detection.md`: recheck the cited live lines,
  plan hash, exact inventory, and fingerprint on every review round so a stale
  review snapshot cannot authorize implementation.
- `feedback_comprehensive_decision_path_test_coverage.md`: enumerate every rare
  mutation outcome with a distinct observable test ID.
- `feedback_convergent_review.md`: batch findings, re-review the new pinned plan,
  and retain independent approval as the stop condition.
- `feedback_orchestrate_workflow.md`: retain the isolated feature worktree and do
  not use an auto-approval shortcut.

The complete shared failure-mode catalog was also read and shaped full-set
coverage, behavioral removal-fails tests, batch remediation, source-repair
invalidation, schema validation, append-only evidence, and function-not-liveness
deployment proof.

## Failure-Mode Sweep

| Failure mode | Prevention / proof |
|---|---|
| same bytes at foreign path pass | exact `bundle_dir / name` equality before digest/schema |
| phase record borrows foreign predecessor | full-record equality to adoption `prior_round` |
| output/input swapped | semantic-name-to-adoption-record equality and path mutation test |
| historical exception becomes fallback | namespace/pin/defect-set exact policies and public rejection |
| missing/extra defect hidden | exact sorted defect-set comparison with both mutation directions |
| unsealed review is fabricated as sealed | bind exact external review plus exact round6 adoption; no manifest claim |
| review IDs or verdict drift | exact F4/F5/open/verdict/token/fingerprint path tests |
| mutation suite is vacuous | test-local literal oracles first equal production sets; exact 558/23/581 ID cardinalities plus guard-specific error per mutant |
| pycache attributes wrong mutant | no source rewrite; in-memory/temp artifact mutations only |
| output consumed on bad authority | all pins/schemas/predecessors/state before mkdir |
| source repair reuses gates | one new 15-gate bundle and independent QA |
| product/T0 drift | six-file delta plus product comparison and immutable pins |
| hidden debt/overstated coverage | TD1..8 and factual gap/results text in all reports |
| cap generalized | exact round7 branch and round8 refusal |
| deployment liveness only | real index/shard/reassembly/filer/page/signature/binding verification |

## Definition of Done

- [ ] **R1:** decision/plan independently approve only F4/F5, exact tuple/run
  ID/round7/cap7, and no round8.
- [ ] **R2:** every 23-record current path/label/content guard and mutation passes.
- [ ] **R3:** every phase input/output/predecessor exact-record guard and mutation passes.
- [ ] **R4:** exact unsealed round6 rejection/adoption/resolution path validates;
  every identity/open-ID/verdict mutation refuses.
- [ ] **R5:** independent literal oracles and exact 558-refusal/23-happy/581-total
  executed-ID equality prove the complete locked mutation matrix.
- [ ] **R6:** focused tests and all 15 gates pass once with one fingerprint;
  bundle binds round7/70/TD1..8/cap7 and independent QA approves.
- [ ] **R7:** unchanged candidate passes docs review, exact-tree release, PR/merge,
  and supervised functional deployment.
- [ ] **R8:** product/T0/snapshot/rounds1–6 unchanged; reports are factual and
  all evidence is append-only.
- [ ] No file outside the exact six repository write paths changed in this repair.
- [ ] No T0/full-corpus command, round8, validation relaxation, self-approval, or
  insecure deployment action occurred.
