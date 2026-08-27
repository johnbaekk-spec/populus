# RUN M2-11 — Exceptional F3 Finalization Repair / QA Round 6 Plan

**Status:** in review — owner-authorized F3-only exception; implementation prohibited
until independent plan approval
**Date:** 2026-08-11
**Owner authorization:** “Authorize one exceptional owner-reviewed F3-only finalization
repair and QA round 6, with no product changes or T0 rerun.”
**Decision SHA-256:**
`148a522d1e4d153744469004c88fd109e4469a30826c344f0fa63ebdf26e72fa`

## Goal and Success Criteria

Repair only the open F3 provenance defect from the sealed round-5 QA review, then execute
exactly one owner-authorized logical finalization QA round 6. Success means:

1. the new owner decision genuinely validates as the exact `owner-decision-v1` schema
   asserted by round-6 manifests;
2. normal top-level validation rejects the immutable round-5 bundle for its known false
   owner-decision schema assertion rather than printing `VALID`;
3. one narrowly pinned failed-QA-predecessor path proves the exact four-defect F3 set in
   round 5—one invalid owner-decision body plus three false custom-manifest labels—and
   binds its exact token, adoption manifest, decision, sealed review, review manifest,
   and open finding;
4. round-6 creation validates its current authority before output creation, validates
   every declared current artifact under its real schema before success, runs the same 15
   gates once, and emits an exact 68-path bundle;
5. independent QA approves that exact round-6 bundle, independent docs review approves
   the unchanged candidate, and the fixed-base release/deployment path completes; and
6. any failure stops without round 7, product changes, T0 rerun, or snapshot mutation.

## Requirements

- **R1 — Exact authority.** Bind the exact owner quote, schema-valid new decision, this
  independently approved plan, exact F3-only scope, round 6, and no-round-7 boundary.
- **R2 — Honest current-artifact schemas.** Use one fixed 23-record name/schema map for
  every current artifact declared by the adoption manifest and exact schema rules for
  every phase-manifest input/output record. Validate each artifact
  using the installed repository validator where supported and the existing local strict
  dispatcher for run-specific schemas. Creation must preflight plan/decision/Dev Notes/
  final message before output creation and top-level validation must execute every
  declared current-artifact schema before returning success.
- **R3 — Exact failed round-5 predecessor.** Preserve round 5 unchanged. Normal
  `validate` must fail with the deterministic exact four-defect F3 set. A separate internal
  failed-QA-predecessor validator may accept only the exact pinned round-5 namespace,
  token, adoption manifest, decision, sealed `CHANGES_REQUESTED` review, sealed review
  manifest, and exact F3 resolution note; it must require exactly the owner-decision
  controlling-plan failure plus false `workflow-artifacts/v1` labels on the three custom
  phase manifests while validating all other bundle and review relationships.
- **R4 — Exact round-6 transport.** Add a digest-scoped
  `finalization-f3-exception` cycle accepted only with `--round 6`, the exact failed
  round-5 QA predecessor, exact F3 resolution, exact
  `final-docs-commit.finalization-r6-a1.md`, absent create-once output, cap 6 with owner
  override true, exact 68 paths, and no round 7. Public strict validation must reject all
  five pinned historical bundles that contain false current-schema assertions. Separate
  private digest-scoped historical validators may return only their exact
  `known-invalid-legacy-*` markers after capturing each locked defect set and validating
  every remaining relationship. Round 5 remains reviewable only as the separately pinned
  `known-invalid-round5-f3` predecessor evidence.
- **R5 — Complete verification.** Run focused fail-if-removed tests, then one unchanged
  15-gate round-6 bundle. Generated report/manifests must state logical round 6, exact 68
  paths, `TD-QA-ORIGIN-1` through `TD-QA-ORIGIN-7`, pending independent QA, and the exact
  predecessor failure/resolution graph.
- **R6 — Same-candidate handoff.** Only a sealed round-6 `APPROVED` QA review with the
  unchanged fingerprint/tree may enter docs A1. Only sealed docs approval may enter
  exact-tree staging, fixed-base PR/merge, and supervised deployment. Deployment must
  verify real v2 institutional index/shard/filer/page behavior, signature/source/code
  bindings, and v1 upgrade tombstone behavior before arming publication.
- **R7 — Immutability and factual records.** Product paths, T0-v11, the source snapshot,
  prior bundles/reviews, limits, gates, and deployment security controls do not change.
  Dev Notes and repository QA report record F3, round-5 rejection, round-6 authority,
  exact 68 paths, focused results, pending outcomes, and TD7 without advance claims.

## Scope

Authorized repository writes are exactly:

1. `docs/build/RUN-M2-11-QA-finalization-F3-decision.md`
2. `docs/build/RUN-M2-11-QA-finalization-F3-plan.md`
3. `docs/build/RUN-M2-11-devnotes.md`
4. `docs/build/RUN-M2-11-qa-report.md`
5. `scripts/build_m2_11_qa_bundle.py`
6. `tests/test_m2_11_qa_bundle.py`

Authorized append-only external outputs are exactly one F3 resolution note, one round-6
final-message artifact, one `qa-v9-finalization-round-6/` bundle, its independent QA
review/seal, and—only after QA approval—global docs attempts A1 through A3 as needed.

No product, dashboard, database, aggregation, serving, payload, shard, build, workflow,
runbook, acceptance, T0, snapshot, dependency, or generic orchestrator file is writable.

## Non-goals

- No product correctness, performance, payload, schema, routing, UI, or build change.
- No T0-v11/full-corpus derivation rerun and no snapshot write.
- No repair or relabeling of round-5 bytes, manifests, token, review, or decision.
- No generic schema framework or orchestrate-tool change.
- No gate, limit, threshold, test, runner, signature, or deployment-control relaxation.
- No round 7, second repository repair after round 6, or self-approval.

## Constraints

- Worktree remains `/Users/johnbaek/projects/Populus-m28/.claude/worktrees/m2-11`,
  branch `codex/m2-11-t0-finalize`, HEAD
  `7391d947f72cf408a173f1e7938102608b2269d4`, base
  `21340330a0fad7e9e39c1a9cec67656643621b05`, with an empty real index.
- Round-5 token is
  `sha256:574c6df63bb7c348a3fd38579d238781c0be9d465e40da0787f3375d52b77682`;
  its token-file SHA is
  `9ad09ec5b138d9173c36a67786a4ea727a49cef4c3ee3ea97b32eca69bf70008`,
  adoption SHA is
  `33f374a52ce64633f1e6c6d80f847bd4d9155ea38d62b5b699ae1a57114fea40`,
  decision SHA is
  `ba8c1653144d683e70c497ad1d7e899bf9c21cba9b3b870897f891fa0c5fe4f8`,
  review SHA is
  `12b381023e0757d8869f0fd2ac953e00e751a43a74998a1caf9a668733e1d23a`,
  and review-manifest SHA is
  `fcd2013e91df5a95c9fd96568794d3f41d4e11bc18652f13bccdbd1287f67e0c`.
- The round-5 review has exactly F1/F2 resolved and F3 open; its final verdict is
  `CHANGES_REQUESTED`.
- T0-v11 remains 63,400 bytes at SHA-256
  `7078a42934484c9c5ba7f975654476e0788c385dbaf8108c0d429a58ba91a453`.
- Snapshot remains 23,058,628,608 bytes, mode `0444`, sidecar-free, at SHA-256
  `977a4d249d92590a4de2961a3e9c7ff8cfa2e4846f0097ec7aa6c07f28124121`.
- Evidence is create-once, mode 0600/0700, append-only, and never deleted or overwritten.
- Source repair invalidates all downstream round-5 gate/report/review evidence for
  approval; round 5 remains only the exact rejected predecessor.

## Current State

- Round 5 completed all 15 direct gates with one fingerprint
  `ceeb9795581a59ad18d91db804d76bd4b711b997e58d552938e159ed16ac0edc`.
- Independent QA resolved prior F1/F2 and found F3: `owner-decision.md` is declared
  `owner-decision-v1` but fails the required controlling-plan clause, while the top-level
  validator still prints `VALID`.
- The rejection is sealed. No docs attempt, staging, PR, merge, variable mutation, or
  deployment followed round 5.
- Product bytes are identical to the previously approved candidate.
- The new decision is intentionally written to pass the exact existing owner-decision
  grammar and points to this plan.

## Detected Stack

- **Languages:** Python 3.12.13 and TypeScript/Astro/Node 24.
- **Python runner:** repository `.venv`/uv lock with pytest; Make owns full gates.
- **Node runner:** npm 11 with `dashboard/package-lock.json`; Node native tests and Astro.
- **Storage/publication:** SQLite/JSON1, static signed artifacts, GitHub Actions.
- **Canonical commands:** the unchanged 15 commands listed in Testing Strategy.
- **Stack cache:** no fresh repository stack-cache block; detection used manifests.

## Reuse Map

| Need | Existing implementation | Locked reuse |
|---|---|---|
| owner-decision grammar | `validate_failed_gate_artifact(..., "owner-decision-v1")` | reuse verbatim for new decision and current-bundle validation |
| bundle graph | `validate_bundle` | extend its fixed schema pass; no second top-level validator |
| rejected QA predecessor | `validate_sealed_qa_review`, `validate_failed_gate_bundle` | add one exact failed-QA sibling patterned on both, not a generic retry system |
| schema dispatch | installed `validate_content` plus existing local dispatcher | extend the existing dispatcher only for currently declared local JSON schemas |
| resolution IDs | `open_blocker_ids`, `validate_resolution_notes` | require exact `F3` |
| round/cap switch | existing digest-derived cycle branches | add one digest-scoped round-6 branch |
| sealing/docs/release | existing `seal-review`, `seal-docs`, `seal-docs-review`, `validate-release` | extend round regexes and inventories only |
| test fixture | existing bundle/docs fixtures | parameterize and add exact invalid-predecessor/current-schema cases |

Repository scan found one active QA bundle runner and one focused test module. There is no
other owner-decision validator or round transport to reuse.

## Architecture

### A. One honest current-artifact validation path

Define one frozen exact map for all 23 adoption-artifact filenames:

| Filenames | Exact schema / route |
|---|---|
| `plan.md`, `dev-notes.md`, `docs-commit.md`, `qa-report.md` | their existing `*-v1` schemas through installed `validate_content` |
| `owner-decision.md` | `owner-decision-v1` through the existing strict local grammar |
| both redacted diffs, changed/external/source/isolated evidence, gate ledger | their existing exact local/installed schema routes |
| `gate-results.json`, `approved-tree.json`, `candidate-state.json`, `combined-candidate-token.json` | exact local `gate-results/v1`, `approved-tree/v1`, `candidate-state/v1`, `combined-candidate-token/v1` cases |
| `docs-commit.manifest.json`, `qa-gates.core.manifest.json`, `qa-synthesis.core.manifest.json` | `workflow-artifacts/v1` through installed `validate_manifest` using exact base/fingerprint |
| `qa-gates.manifest.json`, `qa-synthesis.manifest.json`, `qa-review-input.manifest.json` | strict local `m2-11-phase-manifest/v1` validation |

The exact map has 23 unique keys and must equal the adoption artifact-name set. No
fallback schema is permitted. Round-6 adoption records must label the three custom phase
manifests `m2-11-phase-manifest/v1`, replacing the current generic fallback label.

The strict custom phase-manifest validator requires exact top-level keys, canonical JSON,
phase/round/base/fingerprint/output identity, unique sorted input names, regular absolute
paths, matching digests, and exact schema labels. Every current raw-artifact input/output
record must match the 23-record map by referenced basename. The only additional permitted
phase inputs are the exact predecessor names with fixed schemas:
`prior-qa-review -> review-output-v1`, `prior-review-manifest ->
m2-11-phase-manifest/v1`, and `resolution-notes -> resolution-notes-v1`. Missing, extra,
duplicate, relabeled, cross-path, or stale records refuse.

`validate_bundle` must compare every adoption record's schema to the frozen expected map,
invoke the exact route above, validate every phase input/output record, and then run
existing digest, token, manifest, cap, predecessor, and freshness checks. A schema mismatch
or structurally invalid artifact fails even when its digest matches.

This public/current path is always strict. Immutable historical compatibility is not a
fallback inside it: only the exact private policies in Architecture B may consume the five
named historical namespaces, and only the round-6 predecessor branch may consume round 5.

Before `main run` creates the output directory, validate the selected plan and decision,
the live Dev Notes, and the final commit-message artifact. This specifically prevents a
new invalid authority from consuming round 6. Generated artifacts are validated by the
top-level pass before the runner prints `BUNDLE`/`TOKEN`.

### B. Exact immutable historical-evidence policy

Public `validate` must reject each historical namespace below with its exact sorted defect
set. One private historical dispatcher may select only by exact namespace plus adoption,
token-file, token-value, and decision digests. It validates the three custom manifests
under their actual strict `m2-11-phase-manifest/v1` schema, captures exactly the locked
legacy defects, runs every remaining artifact/phase/token/manifest/cap/relationship check,
and returns the listed marker, never `valid`.

| Exact namespace | Adoption SHA-256 | Token-file SHA-256 / token | Decision SHA-256 | Exact locked defect set / marker |
|---|---|---|---|---|
| `qa-v9-round-1` | `170ed11a15018ceadedb9046711e724848db6ed1cd355d34939b4d892eed5f2a` | `9f4a52445ba5fd69b90fabbc66cb9365acf644f05af932b480bd0b83d120ba77` / `sha256:98ce893843bc0579c02f8368fe343cfaceda4c6d3979ba5bca39f81763b3f57d` | `9392d3cfeec2badf8caf01f595f25342f7569e30f53396ab9c3fe73b7cee3a07` | the three false custom-manifest labels plus `owner-decision-v1 heading/metadata contract mismatch`; `known-invalid-legacy-recovery-r1` |
| `qa-v9-round-2` | `1596c46f59d9aa05dcb2c6479f93c28e4b6d7d77e1946fdd30137efc3b532a1d` | `3b0c893cf1e81ab7603d550241dfac81ad6c3fdad99bfc947cf7b8b38ef3323c` / `sha256:b6bdf6cb0e031291a719776139eac92fc6685f86860d7b51fe3fa75e9825cc9a` | `9392d3cfeec2badf8caf01f595f25342f7569e30f53396ab9c3fe73b7cee3a07` | the same four defects; `known-invalid-legacy-recovery-r2` |
| `qa-v9-round-3` | `8f2901145401ee66d2551c5167e3fb74a4e25c5476af67806df9168f39104545` | `b0acd0ab2d8c2af2676a8e38f0d05db728d6b92286c9c962d4182e89f93cbb5a` / `sha256:7747af94f5100803543d822c06fd989033c7525a43f2da1e459e3f285ebcb8cb` | `9392d3cfeec2badf8caf01f595f25342f7569e30f53396ab9c3fe73b7cee3a07` | the same four defects; `known-invalid-legacy-recovery-r3` |
| `qa-v9-finalization-round-1` | `5ff5d604fcdb146d090f34a3fc6dd8e61820aad057d968a0aabf8fef3d42d881` | `d2dfb786e635e4437ae8b526a31b7f37f655c52726c3f2adb153f34802b7de9d` / `sha256:28acfdd8d09cdedc6fa955a8ecedb73a452697a49c9a297190c7cd46c2d52dff` | `dcd5221c04789f7ad6bc79cd96c989227fa59dc9129d46b0697ec958116e1de7` | the three false custom-manifest labels only; `known-invalid-legacy-finalization-r1` |
| `qa-v9-finalization-round-4` | `b54196d5618fbc5dbe8a60ba90703b5ddb95747af631c8b5e0c2da4d2dd40dcc` | `babb802ca547066c86dd1df1bc9d027675f5408654b8a841f64d90d721ad4a1a` / `sha256:a1f39ef2a6c5bba9c3b63ee7f516896a923808ed9499b24af51c2e5684c25eaa` | `8222a145ddba5a9101c4f851c4aa3f7eca1fe68e7eb9dffd116f51123b7747c0` | the three false custom-manifest labels only; `known-invalid-legacy-finalization-r4` |

For recovery rounds 2 and 3, the only extra phase inputs are exact
`prior-qa-review -> review-output-v1` and `resolution-notes -> resolution-notes-v1`
records. Finalization round 4 additionally has the same exact 13 `prior-gate-*` records in
each custom phase manifest:

```text
prior-gate-baseline-diff.redacted.patch -> redacted-diff-v1
prior-gate-changed-files.json -> changed-files/v1
prior-gate-dev-notes.md -> dev-notes-v1
prior-gate-external-changes.json -> external-changes/v1
prior-gate-external-diff.redacted.patch -> redacted-diff-v1
prior-gate-external-state.json -> external-state/v1
prior-gate-gate-diff-check.log -> gate-log/v1
prior-gate-gate-ledger.json -> m2-11-gate-ledger/v1
prior-gate-gate-recovery-tests.log -> gate-log/v1
prior-gate-isolated-feature.json -> isolated-feature-adoption/v1
prior-gate-owner-decision.md -> owner-decision-v1
prior-gate-plan.md -> plan-v1
prior-gate-source-preservation.json -> adopted-source-state/v1
```

The validator requires exact set equality for these predecessor shapes and validates each
referenced file with its stated actual schema. Any namespace, pin, defect, input-name,
schema, path, digest, phase, or relationship mutation refuses. No historical policy is
available to round 6 or any unlisted bundle.

### C. Round 5 is explicitly known-invalid evidence

Normal `validate_bundle` and CLI `validate` must now reject round 5 with a deterministic
sorted exact four-defect set. They may never suppress or relabel F3. The immutable defects
are:

1. `owner-decision.md` fails `owner-decision-v1` with
   `owner-decision-v1 controlling-plan contract mismatch`;
2. `qa-gates.manifest.json` is labeled `workflow-artifacts/v1` instead of
   `m2-11-phase-manifest/v1`;
3. `qa-synthesis.manifest.json` has the same false label; and
4. `qa-review-input.manifest.json` has the same false label.

Add one private failed-QA-predecessor path for exact round 5. It passes an explicit
expected-failure identity into the shared internal bundle validation core, which must:

1. require the exact round-5 decision digest;
2. capture exactly the sorted four-defect set above, with no fifth defect;
3. validate each mislabeled custom manifest under its actual strict
   `m2-11-phase-manifest/v1` shape and validate every other artifact, phase record,
   manifest, token, cap, gate, and relationship;
4. require the exact token/adoption/review/review-manifest pins above;
5. validate the sealed review as `review-output-v1`, final verdict
   `CHANGES_REQUESTED`, and open blocker IDs exactly `("F3",)`; and
6. return a predecessor record marked `known-invalid-round5-f3`, never `valid`.

The public validator always uses strict mode. Only the digest-scoped round-6 branch can
call the failed predecessor path. If any expected defect disappears or changes, any extra
defect appears, or any pin/relationship changes, the predecessor refuses.

### D. Exact round-6 authority and state machine

The locked sorted authority tuple is:

```text
FINALIZATION_F3_EXCEPTION_SCOPE = (
  "current-tree-adoption-instead-of-historical-pre-build-origin",
  "owner-authorized-fifth-finalization-repair",
  "owner-authorized-fourth-finalization-retry",
  "owner-authorized-qa-docs-finalization-cycle",
  "owner-authorized-sixth-finalization-f3-repair",
  "repo-local-custom-schema-validator",
)
```

The exact run identifier is
`RUN-M2-11-QA-finalization-f3-exception`. The cycle literal is
`finalization-f3-exception`; cap is 6, owner override is true, and allowed rounds are
exactly `(6,)`. Manifests, reports, branch selection, and tests assert exact equality.

```text
sealed exact round-5 QA rejection (known four-defect F3 set only)
  + exact F3 resolution note
  + approved schema-valid round-6 decision/plan
  -> pre-output current authority validation
  -> one create-once round-6 bundle
  -> 15 unchanged gates PASS
  -> every current artifact schema PASS
  -> independent QA APPROVED
  -> unchanged candidate docs A1 / independent docs APPROVED
  -> exact-tree release / supervised functional deployment
```

Any failed arrow stops. No round 7 exists.

### E. Exact 68-path candidate/release inventory

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

1. New decision conforms to existing `owner-decision-v1`; no new decision schema.
2. Normal round-5 validation becomes honestly failing; historical evidence is not edited.
3. Only a private, exact-pin failed-QA-predecessor path can consume round 5.
4. The current-artifact map covers exactly all 23 adoption records; the three core
   manifests are `workflow-artifacts/v1`, the three custom phase manifests are
   `m2-11-phase-manifest/v1`, and no fallback label exists.
5. The authority tuple and run ID are exactly the literals in Architecture D; no
   implementation-time choice is permitted.
6. All 15 gates rerun once because source repair invalidates round-5 approval evidence.
7. Round 6 consumes only the sealed round-5 QA rejection and exact F3 resolution.
8. Product paths, T0-v11, snapshot, limits, and deployment controls are read-only.
9. A round-6 failure or QA rejection stops; no round 7 or post-QA repo repair.
10. Docs attempts remain external-only and cannot hide a repository change.

## Alternatives Considered

- **Edit round-5 decision/evidence:** rejected; violates append-only provenance.
- **Keep top-level round-5 `VALID` for compatibility:** rejected; repeats F3.
- **Label round-6 decision with a new schema:** rejected; existing grammar is sufficient.
- **Catch any predecessor validation error:** rejected; would turn the exception into a
  validation bypass. Exact digest, exact error, and exact sealed rejection are required.
- **Validate only owner-decision:** rejected; all declared current-artifact types must be
  trustworthy once the manifest claims typed inputs.
- **Skip full gates because product is unchanged:** rejected; source repair invalidates
  downstream QA evidence.
- **General retry support:** rejected; round 6 is digest-scoped and cannot authorize 7.

## Planned Files

| Path | Planned change |
|---|---|
| `docs/build/RUN-M2-11-QA-finalization-F3-decision.md` | exact quote, schema-valid authority, F3/round6/no-round7 boundary |
| `docs/build/RUN-M2-11-QA-finalization-F3-plan.md` | this independently reviewed controlling plan |
| `scripts/build_m2_11_qa_bundle.py` | exact schema map, strict current validation, known-invalid round5 predecessor, round6 transport |
| `tests/test_m2_11_qa_bundle.py` | real-schema, top-level refusal, pin mutation, transition, cap/history tests |
| `docs/build/RUN-M2-11-devnotes.md` | factual round5 rejection/F3/round6 command/tests/TD7 |
| `docs/build/RUN-M2-11-qa-report.md` | factual F3 remediation and pending round6 authority |

## Implementation Tasks

- **T1 [R1, R4, R7]:** pin the new decision/approved plan, add exact 68-path inventory,
  exact `FINALIZATION_F3_EXCEPTION_SCOPE` tuple, exact
  `RUN-M2-11-QA-finalization-f3-exception` run ID, cap 6/override true, and
  round-6/no-round-7 branch.
- **T2 [R2]:** define the exact 23-record current artifact map, correct the three custom
  round-6 manifest labels, add strict `m2-11-phase-manifest/v1` and four generated-JSON
  routes, validate adoption-map equality plus every phase input/output schema/content in
  `validate_bundle`, and preflight plan/decision/Dev Notes/final message before output.
- **T3 [R3]:** refactor the validation core to support the exact sorted four-defect
  round-5 set while public validation remains strict; validate mislabeled custom
  manifests under their actual schema; add exact failed-QA pins, sealed-review/open-F3
  checks, and the `known-invalid-round5-f3` predecessor marker.
- **T3a [R2, R4]:** add the exact five-row immutable historical policy table and private
  dispatcher; require the literal namespace/adoption/token-file/token-value/decision pins,
  exact per-bundle defect sets, exact recovery/prior-gate phase-input shapes, strict actual
  custom-manifest validation, exact remaining relationships, and distinct
  `known-invalid-legacy-*` markers while public validation rejects all five bundles.
- **T4 [R4, R5, R6]:** propagate round 6 through CLI, reports, manifests, docs/review
  namespaces, candidate token, release validation, and only-QA-predecessor enforcement.
- **T5 [R1, R2, R3, R4, R5]:** add fail-if-removed tests for exact tuple/run ID, valid
  round-6 decision, all 23 adoption schemas, all phase input/output labels, each label/
  content mutation, normal round-5 exact-four refusal, exact known-invalid predecessor
  success, every pin/expected-defect/extra-defect/open-ID mutation, pre-output authority
  refusal, exact 68 paths, generated TD1..7 report/cap, wrong predecessor/round/output,
  public rejection plus exact private validation for recovery rounds 1–3 and finalization
  rounds 1/4, every historical pin/defect/input-shape mutation, and no round 7.
- **T6 [R7]:** update Dev Notes and repository QA report with facts true before round 6;
  validate schemas and complete propagation without claiming future approval/deploy.
- **T7 [R4, R5, R7]:** after focused preflight, create append-only exact F3 resolution
  and round-6 final message, run the single binding command once, validate, and stop on
  any gate failure.
- **T8 [R5, R6]:** obtain independent QA, seal exact verdict, stop on rejection; only an
  approval enters docs A1 and independent docs review.
- **T9 [R6, R7]:** after both approvals, exact-tree pre/post-stage validation, literal
  68-path staging, commit, push, fixed-base PR/merge, and supervised deployment.

## Testing Strategy

Preflight before binding:

1. validate plan-v1, the new decision under the real local owner schema, Dev Notes,
   repository QA report, F3 resolution, and final docs-commit;
2. prove exact 68-path equality, empty index, fixed branch/HEAD/base, new pins, exact
   round-5 token/adoption/review/manifest/decision pins, absent round6/docs outputs,
   T0/snapshot identity, and `git diff --check`;
3. run `PYTHONDONTWRITEBYTECODE=1 .venv/bin/python -m pytest -q
   tests/test_m2_11_qa_bundle.py`; and
4. assert public validation rejects the five exact historical bundles with their locked
   per-bundle defect sets, validate each through its exact private historical policy,
   assert normal round-5 validation fails with the exact sorted four-defect F3 set, and
   validate round 5 through the exact failed-QA-predecessor path.

The single round-6 bundle runs the unchanged 15 gates:

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

No command invokes T0/full-corpus derivation, stages Git, mutates GitHub, or touches
production before both independent reviews approve.

## Verification Matrix

| Requirement | Executable proof |
|---|---|
| R1 | exact quote/decision/plan pins; decision passes owner schema; exact tuple/run ID/round6/no round7 |
| R2 | exact 23-record map equality; exact core/custom manifest labels; every phase record exact; each schema/label mutation fails; invalid authority leaves output absent |
| R3 | public round5 validate fails exact four-defect F3 set; exact failed predecessor succeeds; any pin/missing-or-extra defect/open-ID change refuses |
| R4 | exact five-bundle historical public refusals/private markers and pin/input-shape mutation refusals; exact 68 paths; only F3 exception round6; QA predecessor only; cap6 override; all cycles reject round7 |
| R5 | 15 direct zero exits/one fingerprint; manifests/token bind F3 resolution/predecessor; report names round6/68/TD1..7; independent QA seal |
| R6 | unchanged fingerprint/tree across QA/docs; exact stage tree; functional supervised institutional verification |
| R7 | product diff versus round5 empty; T0/snapshot unchanged; docs agree on facts/counts/debt/pending outcomes |

## Rollout / Rollback

After plan approval and implementation preflight, create exact F3 resolution notes and
the round-6 final message. Invoke once while the output is absent:

```bash
root=/Users/johnbaek/projects/Populus-ops/snapshots/evidence/m2-11
qa_bundle="$root/qa-v9-finalization-round-6"
final_message="$root/final-docs-commit.finalization-r6-a1.md"
PYTHONDONTWRITEBYTECODE=1 .venv/bin/python scripts/build_m2_11_qa_bundle.py run \
  --cycle finalization-f3-exception --round 6 \
  --final-docs-commit "$final_message" \
  --prior-review "$root/qa-v9-finalization-round-5/qa-review.round-5.md" \
  --resolution-notes "$root/resolution-notes.finalization-r5-qa.md" \
  --output "$qa_bundle"
PYTHONDONTWRITEBYTECODE=1 .venv/bin/python scripts/build_m2_11_qa_bundle.py validate \
  --bundle "$qa_bundle"
```

On failure, preserve output and stop. On success, independent QA reviews the exact bundle
and the primary seals only its exact verdict. Only approval permits:

```bash
qa_review="$root/qa-review.finalization-r6.canonical.md"
PYTHONDONTWRITEBYTECODE=1 .venv/bin/python scripts/build_m2_11_qa_bundle.py seal-review \
  --bundle "$qa_bundle" --review "$qa_review"
docs_bundle="$root/docs-v9-finalization-r6-a1"
PYTHONDONTWRITEBYTECODE=1 .venv/bin/python scripts/build_m2_11_qa_bundle.py seal-docs \
  --bundle "$qa_bundle" \
  --qa-review "$qa_bundle/qa-review.round-6.md" \
  --final-docs-commit "$final_message" --attempt 1 \
  --output "$docs_bundle"
```

Docs rejection may use external-only A2/A3 without repository changes. Repository change,
round-6 QA rejection, or exhausted docs attempts stops. Rollback before merge is no
production change; after merge use the existing signed pointer/runbook rollback only.

Release reuses the previously reviewed literal fixed-base sequence with count 68, the two
new governance paths added to the explicit stage array, round-6 approved bundle paths,
`git diff --cached --name-only` exact equality, commit via reviewed `git commit -F`, fixed
base assertion, PR-head/main assertions, and no-check owner-approved PR path. Deployment
reuses the reviewed supervised runbook and stops if the secure self-hosted runner/controller
is absent or stale.

## Simplicity Audit

One new decision and one plan are unavoidable authority records. Runtime changes remain
inside the existing release-specific runner. The only new code abstractions are one fixed
23-record current-artifact schema map, bounded local cases for four generated JSON
schemas plus the existing custom phase-manifest shape, one fixed five-row legacy policy,
and one shared exact expected-failure core used by the historical dispatcher and failed-
QA-predecessor function. The existing test
module, seal commands, report writer, manifests, token, and release path are extended.
There is no new package, module, dependency, schema family, product path, generic retry
framework, or parallel validator.

## Tech Debt Introduced

**TD-QA-ORIGIN-7 — exact immutable schema exceptions and sixth finalization round.**
Impact: the release-specific bridge gains one more digest-scoped authority branch, five
private exact historical validators, and the round-5 failed-predecessor path because six
immutable bundles contain locked false schema assertions. Controls: exact namespace and
content pins, exact per-bundle defect/input-shape identities, distinct known-invalid
markers, strict public rejection, strict validation under the custom manifests' actual
schema, exact 23-record/phase-record validation for round 6, exact F3 resolution, all 15
gates, independent QA/docs, no product import, and no round 7.
Removal: delete TD1–TD7 and the release-specific runner/tests after the generic harness
natively validates typed current artifacts and transports failed QA predecessors.

Existing TD-QA-ORIGIN-1 through -6, eager-build debt, reservation disclosure, and npm
advisories remain visible and unchanged. No hidden production, security, dependency,
timeout, threshold, test-suppression, snapshot, or deployment debt is introduced.

## Memory Touch-Points

The deterministic selector used `qa finalization owner decision schema manifest validation
predecessor round` and consulted:

- `feedback_decision_branching_procedures.md` — made strict public validation and the
  exact known-invalid predecessor path separate explicit branches.
- `feedback_comprehensive_decision_path_test_coverage.md` — required tests for valid,
  known-invalid, mutated, extra-failure, wrong-predecessor, and cap outcomes.
- `feedback_llm_structured_output_probe_real_schema.md` — required exercising the real
  owner schema, not digest-only or simplified stand-ins.
- `feedback_manifest_columns_by_name_not_index.md` — shaped exact named schema-map checks.
- `feedback_orchestrate_workflow.md` — preserved the dedicated feature worktree/branch.
- `feedback_plan_decision_lock.md` — locked the schema and failed-predecessor design.
- `feedback_qa_fail_batch_remediation.md` and `feedback_qa_remediation_discipline.md` —
  keep F3 one batch, full gates, independent re-review, and no self-sign.
- `feedback_schema_audit_prevents_repair.md` — validate all typed artifacts before repair.
- `feedback_empty_parse_silent_failure.md` — treat missing schema execution as failure,
  never equivalent to schema success.

The complete shared failure-mode catalog was also applied.

## Failure-Mode Sweep

| Failure mode | Prevention / proof |
|---|---|
| digest matches but schema is false | exact 23-record map, phase-record equality, and actual schema invocation |
| custom manifest gets generic fallback | no fallback; exact three core vs three custom labels |
| historical false label passes as valid | public strict rejection; exact pinned private marker only |
| legacy policy hides a new defect | exact bundle-specific defect and predecessor-input sets; missing/extra refuses |
| finalization-r4 prior-gate record is generalized | exact 13-name/schema set equality and real content validation |
| round5 is silently relabeled valid | normal CLI must fail exact four-defect F3 set |
| expected-failure path hides other defects | exact four defects plus all remaining checks; missing/extra defects refuse |
| predecessor substitution | exact token/adoption/decision/review/manifest pins |
| resolution relabel | exact open `F3` and exact `## F3: resolved` |
| new decision repeats F3 | validate real owner schema before output creation |
| output consumed on bad preflight | all authority/pin/predecessor checks before mkdir |
| authority tuple drifts | exact sorted tuple and run ID equality in branch/manifests/tests |
| cap generalized | digest-scoped round6 only; explicit round7 refusal |
| historical behavior regresses | rounds1–4 offline validation; round5 exact known-invalid test |
| product/T0 drift | exact six-file repair delta plus product diff and pins |
| hidden debt | Dev Notes/repo QA/generated report assert TD1–TD7 |
| secrets | existing path rejection/redaction/mode controls and security gate |
| liveness mistaken for function | real schema failure/success and real deployment payload/page checks |
| source repair reuses approval | all 15 gates and independent QA rerun |

## Definition of Done

- [ ] **R1:** decision and plan are independently approved, exactly pinned, and authorize
  only F3 plus the exact tuple/run ID/round 6 with no round 7.
- [ ] **R2:** all 23 adoption records and every phase input/output name/schema/content
  validate with exact core/custom manifest labels; the new decision passes the real owner
  schema before output creation.
- [ ] **R3:** public round5 validation fails the exact sorted four-defect F3 set; the
  private exact-pin failed-QA path validates exactly that set and sealed rejection/
  resolution, refusing any missing or extra defect.
- [ ] **R4:** exact 68 paths, digest-scoped round6, QA predecessor only, cap6 override,
  five exact historical public refusals/private known-invalid markers and mutation
  refusals, and round7 refusal all pass.
- [ ] **R5:** focused tests and all 15 round6 gates pass once with one fingerprint; token/
  manifests/report bind round6/68/F3/TD1–TD7; independent QA approves and is sealed.
- [ ] **R6:** unchanged tree passes docs A1 and independent docs review, exact-tree
  release, fixed-base PR/merge, and functional supervised deployment.
- [ ] **R7:** product/T0/snapshot/prior evidence are unchanged; factual reports contain no
  advance claim and all authorized outputs are append-only.
- [ ] No file outside the exact six repository write paths changed in the F3 delta.
- [ ] No T0/full-corpus command, round7, validation relaxation, self-approval, or insecure
  deployment action occurred.
