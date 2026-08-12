# RUN M2-11 — Exceptional QA/Docs Finalization Retry Plan (plan-v1)

**Status:** IN REVIEW · **Owner authorization:** 2026-08-11, “Authorize one
exceptional owner-reviewed finalization retry beyond the three-round cap.” ·
**Transport:** interactive-disk with independent read-only plan review ·
**Candidate:** dedicated worktree `codex/m2-11-t0-finalize`, fixed HEAD
`7391d947f72cf408a173f1e7938102608b2269d4`, fetched `origin/main`
`21340330a0fad7e9e39c1a9cec67656643621b05`.

## Goal and Success Criteria

Use the owner's narrow exception to perform exactly one fourth logical QA/docs
finalization retry without changing institutional product behavior or rerunning
T0-v11. Success means:

1. the exception is recorded in a distinct decision and independently approved
   plan rather than silently widening the closed three-round contract;
2. the exact 64-path candidate creates one append-only
   `qa-v9-finalization-round-4` bundle that binds the failed round-3 gate evidence
   and exact resolution notes;
3. all 15 standing gates exit zero against the same fingerprint and an independent
   QA reviewer approves that exact bundle;
4. with no subsequent repository edit, independent docs review approves the typed
   64-path handoff and final commit message before staging, PR, or deployment;
5. a failed gate, QA `CHANGES_REQUESTED`, or repository repair after round 4 stops
   without a fifth QA attempt; and
6. T0-v11 and the accepted snapshot remain byte-identical and are never rerun.

## Requirements

- **R1 — Exact exceptional authority.** Add a distinct owner-decision and plan for
  exactly logical QA round 4. Preserve the original product-QA, recovery, and
  finalization authorities and their bundles byte-for-byte. The exception changes
  only the finalization QA cap from three to four for the new digest-identified
  cycle; it authorizes neither round 5 nor another product-QA/T0 attempt.
- **R2 — Exact 64-path candidate and immutable premises.** The new plan and
  decision extend the approved 62-path candidate to the exact sorted 64-path
  inventory under Architecture. Fixed branch/HEAD/base, clean Git index, pinned
  parent plans/decisions/findings, T0-v11, snapshot, and failed round-3 evidence
  must validate before any new output is created.
- **R3 — Round-3 predecessor and refusal-atomic round 4.** The exception command
  accepts only `--cycle finalization-exception --round 4`, the exact failed
  `qa-v9-finalization-round-3` bundle, exact gate-resolution notes, the exact
  `final-docs-commit.finalization-r4-a1.md`, and absent exact round-4 output. It
  validates all inputs before creating the output. Old cycles still reject round
  4; the exception cycle rejects every round except 4; every cycle rejects round 5.
  Every focused test that exercises an inner run/output uses a monkeypatched
  temporary evidence root or child-only resource and remains valid when the real
  outer `qa-v9-finalization-round-4` already exists. Tests may read retained rounds
  2/3 as immutable fixtures but never assert on or create the live round-4 path.
- **R4 — Complete fresh QA and independent verdict.** Round 4 emits the existing
  typed origin/candidate/token/manifest graph with the exception plan, decision,
  scope, `automated_caps.qa_rounds=4`, and
  `explicit_overrides.qa_rounds=true`; binds the complete round-3 failed-gate
  graph; emits a cycle-aware generated `qa-report.md` that names the exception
  plan/decision, logical round 4, exact 64-path scope, and
  `TD-QA-ORIGIN-1` through `TD-QA-ORIGIN-5` without pre-claiming approval; and runs
  the unchanged 15 literal gates once. A separate read-only
  `qa-review` agent reviews it. Gate failure or QA `CHANGES_REQUESTED` is a hard
  stop, not permission for a fifth bundle or self-approval.
- **R5 — Same-candidate docs and release handoff.** Only an independently approved
  round-4 QA review may enter `docs-v9-finalization-r4-a1`. Existing global docs
  attempts remain capped at three append-only attempts. Attempts 2/3 may correct
  external-only commit/review evidence with exact prior docs review/resolution
  binding; any repository byte change invalidates QA and stops because no fifth QA
  round is authorized. Pre/post-stage validation and the reviewed `git commit -F`
  mapping use the exact 64-path tree.
- **R6 — Factual propagation and declared debt.** Update Dev Notes, the repository
  QA report, and the generated bundle QA report before round 4 to record the
  owner's exception, the two
  consumed failed bundles, the 53-test repair proof, the authoritative round-4
  command, and new `TD-QA-ORIGIN-5`. Do not pre-claim round-4 gates, QA, docs, PR,
  merge, or deployment. After evidence exists, authority remains in append-only
  external artifacts; repository docs may state only facts already true before
  the fresh QA fingerprint is captured.
- **R7 — Fail-closed release and supervised deployment.** After independent QA and
  docs approval, stage only the exact reviewed 64 paths, verify cached names/tree,
  commit, push, fixed-base PR, and merge. Deployment retains every secure
  self-hosted-runner/controller prerequisite and functional v2/v1 checks from the
  approved finalization plan. Missing administrator provisioning stops after merge;
  it never authorizes a current-user runner or weaker check.

## Scope

Authorized repository writes for this exception delta are exactly:

```text
docs/build/RUN-M2-11-QA-finalization-exception-decision.md
docs/build/RUN-M2-11-QA-finalization-exception-plan.md
docs/build/RUN-M2-11-devnotes.md
docs/build/RUN-M2-11-qa-report.md
scripts/build_m2_11_qa_bundle.py
tests/test_m2_11_qa_bundle.py
```

Authorized append-only external outputs are exactly new
`resolution-notes.finalization-r3-gates.md`,
`final-docs-commit.finalization-r4-a1.md`,
`qa-v9-finalization-round-4/`, its independent QA review/seal, and—only after QA
approval—`docs-v9-finalization-r4-a1` through `-a3` plus their exact review and
resolution artifacts. Existing evidence is read-only. No external path is deleted,
renamed, overwritten, or reused.

## Non-goals

- no product, schema, payload, route, build-resource, budget, workflow, runner,
  deployment-variable, dependency, or site-content change;
- no T0-v11, full-corpus derivation, snapshot mutation, evidence repair/deletion,
  history rewrite, threshold relaxation, or retrospective relabeling;
- no fifth QA round, no reset of the three-docs-attempt cap, and no repository fix
  after round-4 QA without fresh owner authorization;
- no change to the existing finalization plan/decision or their pinned digests;
- no staging, commit, PR, merge, GitHub mutation, or deployment before both new
  independent reviews approve.

## Constraints

- Before adding this plan, the exact 63-path candidate fingerprint is
  `bb4a14718914d9a5b1167f44b0b3420801507d1463a42490d9a6c9daf74c9eca`.
  Independent plan review pins this plan's final SHA and the resulting 64-path
  candidate state before implementation.
- Exception decision SHA-256 is
  `8222a145ddba5a9101c4f851c4aa3f7eca1fe68e7eb9dffd116f51123b7747c0`.
  Approved finalization plan/decision remain
  `82509b7c41e890dab69920abe8b26daac0104fad0c657a5e22aca4864161f742`
  and `dcd5221c04789f7ad6bc79cd96c989227fa59dc9129d46b0697ec958116e1de7`.
- Tail plan SHA is
  `068e7fc04edf61e0e3d25e40ff504b003faa0d0ab6d26fa65982a4899e119fad`;
  findings SHA is
  `cf1739a8571f312231e2a842bd0fbe7521e6b2f4a5f522c2089bbd78957579fd`.
- T0-v11 remains 63,400 bytes/171 lines at SHA
  `7078a42934484c9c5ba7f975654476e0788c385dbaf8108c0d429a58ba91a453`.
  Snapshot remains 23,058,628,608 bytes, mode `0444`, sidecar-free, SHA
  `977a4d249d92590a4de2961a3e9c7ff8cfa2e4846f0097ec7aa6c07f28124121`.
- Failed round-3 gate ledger is immutable at SHA
  `355596d5e3c7b393bb2b167e8e2da906803b268a95860c875002c62e103d2c69`.
  It contains contiguous gate 1 PASS and gate 2 `recovery-tests` FAIL with
  unchanged fingerprint
  `ebb810f846ec1aed0b7e645833759e2de93541828f2787e16b5af37beb057614`;
  the failure log SHA is
  `16c798306bb4f172f8640d9392a06f7309c99c93062646689b784257df0e213a`.
- The current fixed repair passes
  `PYTHONDONTWRITEBYTECODE=1 .venv/bin/python -m pytest -q
  tests/test_m2_11_qa_bundle.py` at 53 tests and `git diff --check`; this focused
  proof is planning evidence only and never substitutes for the fresh 15 gates.
- The full redacted patch stays disk-only under the existing 2,097,152-byte cap;
  every other artifact retains the 1,048,576-byte cap. Outputs are create-once
  0700 directories containing 0600 regular nonsymlink files.
- Secret/token/private-key values never enter evidence, Git, commands, or chat.

## Current State

- Product implementation, the only T0-v11 binding run, and the three-round product
  QA cycle are complete; product QA round 3 approved the 57-path product candidate.
- Finalization round 1 ran all 15 gates and independent QA returned six tooling-only
  blockers. Those fixes are present and the current focused suite passes 53 tests.
- Finalization rounds 2 and 3 each stopped at gate 2 because a self-observation test
  treated its active outer bundle directory as an invalid inner output. Both
  create-once bundles remain immutable. The faulty assertions are removed; round 2
  and round 3 failed bundles independently validate with one failed gate and 13
  exact predecessor artifacts apiece.
- No round-4 bundle, round-4 resolution note, round-4 final message, QA approval,
  docs bundle, staged file, commit, PR, merge, runner, or deployment exists.
- GitHub currently has zero registered self-hosted runners; the dedicated
  `populusrunner` account/controller is absent. That is a later supervised deploy
  stop, not a reason to weaken finalization.

## Detected Stack

- **Languages:** Python 3.12.13 at repository root; TypeScript/Astro under
  `dashboard/`; shell commands are embedded only in the existing run-specific
  Python evidence runner and reviewed plans.
- **Runners:** frozen `uv.lock` with repository `.venv`; npm 11 / Node 24 with
  `dashboard/package-lock.json`; Make owns the complete repository gates.
- **Tests:** pytest, Node native tests, Astro/TypeScript build/post-build tests.
- **Storage/publication:** immutable SQLite/JSON1 snapshot and signed static Pages
  publication.
- **Exception delta:** Python stdlib plus Markdown only; no new dependency.

## Reuse Map

| Need | Existing implementation reused | Locked decision |
| --- | --- | --- |
| exceptional bundle | `scripts/build_m2_11_qa_bundle.py` cycle selection, fixed-state validation, writers, gate ledger, token and manifests | extend the single run-specific bridge; no new runner/module |
| failed-gate predecessor | `validate_failed_gate_bundle` and `validate_gate_resolution_notes` | bind exact round 3 and one `gate-recovery-tests` resolution; no reconstructed history |
| immutable evidence | `load_canonical_file`, `sha256_file`, create-once/preflight patterns | use unchanged canonical/digest checks and refuse before output |
| candidate/release tree | `EXPECTED_QA_PATHS`, `EXPECTED_RELEASE_PATHS`, `changed_paths`, `validate_fixed_state`, `build_approved_tree` | add exactly two governance paths; QA and release lists stay identical |
| retry policy | existing digest-derived recovery/finalization branches and argparse cycle switch | add one digest-derived exception branch; old cap semantics remain unchanged |
| gates/reviews | existing 15-entry `GATES`, phase manifests, `qa-review`, `docs-review` | no gate or schema substitution; separate reviewer, primary fixes only |
| generated QA narrative | existing `write_markdown_artifacts()` report renderer | make its existing branch cycle-aware; do not add a second report writer |
| commit/release/deploy | approved finalization plan's docs seal, `validate-release`, `git commit -F`, fixed-base PR, supervised runbook | reuse unchanged except exact 64-path tree and round-4 identity |

Reuse-first scans cover `finalization`, `qa-v9-finalization`, `qa_rounds`,
`EXPECTED_QA_PATHS`, `EXPECTED_RELEASE_PATHS`, `seal-docs`, `validate-release`,
and the two finalization docs. They find one active M2-11 bridge and one focused
test module, so another script or validator would be parallel governance debt.

## Architecture

### Exact 64-path candidate and release inventory

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
docs/build/RUN-M2-11-QA-finalization-decision.md
docs/build/RUN-M2-11-QA-finalization-delta-plan.md
docs/build/RUN-M2-11-QA-finalization-exception-decision.md
docs/build/RUN-M2-11-QA-finalization-exception-plan.md
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

### Exception policy and transport

The existing runner gains no new public module or schema. It receives:

- `FINALIZATION_EXCEPTION_PLAN`, `FINALIZATION_EXCEPTION_DECISION`, their approved
  pins, and a distinct sorted exception scope containing
  `current-tree-adoption-instead-of-historical-pre-build-origin`,
  `owner-authorized-qa-docs-finalization-cycle`,
  `owner-authorized-fourth-finalization-retry`, and
  `repo-local-custom-schema-validator`;
- two added inventory paths, making QA and release tuples identical at 64;
- `finalization-exception` as a CLI cycle accepted only with round 4, exact
  round-3 failed-gate predecessor/resolution, and the exact round-4 filenames;
- a cycle-specific `allowed_rounds=(4,)` passed into the existing fixed-state
  validator while recovery/finalization retain `(1, 2, 3)`; no broad `<=4` default;
- digest-derived validation policy for the new plan/decision/scope, expected round
  4, QA cap 4, and explicit override true. Historical digest branches and legacy
  round-1 exception remain byte-compatible;
- round-4 recognition in final-message, sealed-QA, docs-bundle, and release paths,
  while the global docs attempt number remains 1..3; and
- cycle-aware text in the existing generated `qa-report.md`: exception authority,
  logical round 4, exact 64-path scope, and TD1..TD5, with schema validation and no
  advance QA/docs/release claim; and
- direct binding of all 13 exact round-3 failed-bundle records plus the resolution
  note into round 4's manifest/token graph before any gate runs.

`automated_caps.qa_rounds=4` describes the logical finalization history, while
`explicit_overrides.qa_rounds=true` proves the extra attempt is owner-authorized.
It is not a reusable “unlimited retries” knob. The exception branch is identified
by exact plan/decision digests and rejects any other round.

### Transition and stop state

The only valid transition is:

```text
immutable failed round 3 + exact resolution + approved exception plan/decision
  -> one create-once round-4 bundle
  -> all 15 gates PASS
  -> independent QA APPROVED
  -> same bytes sealed for docs attempt A1 (A2/A3 external-only if needed)
  -> independent docs APPROVED
  -> exact-tree release
```

Any failed arrow preserves its output and stops. In particular, a gate failure or
QA finding consumes the one exception; code/docs repair cannot create round 5.

## Locked Decisions

1. The owner authorization means one logical round 4, not a fresh three-round QA
   cycle and not a reset of product QA.
2. The existing `qa-v9-finalization-round-4` namespace is used so predecessor and
   docs round identity remain linear; authority is distinguished by plan/decision
   digest and exception scope.
3. Round 4 must bind the failed round-3 gate graph, not merely cite its path.
4. All 15 gates rerun. The 53 focused passes are only preflight evidence.
5. A round-4 failure or QA change request stops; the primary does not repair then
   self-approve or synthesize round 5.
6. Docs A2/A3 are permitted only for external-only artifacts. Any repository byte
   change after QA approval stops and requires new owner authority.
7. Existing recovery/finalization authorities, validation, and append-only outputs
   stay accepted offline under their original caps and digests.
8. The exact two new governance files increase both QA and release inventories to
   64; there is no conditional staging path.
9. T0-v11 and the snapshot are identity checks only.
10. Secure runner absence remains an explicit post-merge deployment stop.

## Alternatives Considered

- **Reuse round 3 after fixing the test — rejected:** violates create-once evidence
  and would overwrite a real failed ledger/log.
- **Treat the focused 53-test pass as round 3 completion — rejected:** it omits 13
  standing gates and cannot retroactively change the recorded nonzero exit.
- **Reset finalization to a new three-round cycle — rejected:** broader than the
  owner's singular “one retry” authorization.
- **Raise every cycle's cap to four — rejected:** would silently alter historical
  authority and permit an unreviewed recovery/product retry.
- **Run round 4 without predecessor binding — rejected:** loses the exact reason the
  exception exists and permits skipped/stale repair evidence.
- **Create a second exception runner — rejected:** duplicates token, manifest,
  redaction, tree, and release policy already present in the run-specific bridge.
- **Bypass secure runner to deploy overnight — rejected:** publication credentials
  and the 23-GiB source require the approved isolated supervised host path.

## Planned Files

| Path | Planned change |
| --- | --- |
| `docs/build/RUN-M2-11-QA-finalization-exception-decision.md` | exact singular owner authority and stop boundary |
| `docs/build/RUN-M2-11-QA-finalization-exception-plan.md` | this independently reviewed controlling plan |
| `scripts/build_m2_11_qa_bundle.py` | digest-scoped round-4 exception, cycle-aware generated QA report, 64 paths, exact predecessor/cap/manifest/docs/release handling |
| `tests/test_m2_11_qa_bundle.py` | hermetic behavioral success/refusal/generated-report/historical-compatibility coverage for every new branch |
| `docs/build/RUN-M2-11-devnotes.md` | factual exception, command, inventory, tests, debt, and stop propagation |
| `docs/build/RUN-M2-11-qa-report.md` | factual finalization state and `TD-QA-ORIGIN-5` without advance verdict claims |

Append-only external outputs are evidence, not repository files. No other path may
change during implementation. The cumulative release remains the exact 64-path
Architecture inventory.

## Implementation Tasks

- **T1 [R1, R2]:** validate and pin the approved exception plan/decision, fixed
  branch/HEAD/base, exact 64 paths, immutable T0/snapshot, and failed round-3
  ledger/log. Refuse a staged index or any missing/extra/symlinked input.
- **T2 [R2, R3, R4]:** extend the existing runner constants, exact inventories,
  CLI cycle selection, fixed-state round policy, digest-derived bundle validation,
  cap/override records, round-4 filenames, prior-gate manifest/token binding, and
  the existing `write_markdown_artifacts()` cycle branch so the generated report
  carries exception authority/round/scope/TD1..TD5. Preserve all historical bundle
  validation and historical report wording.
- **T3 [R3, R4, R5]:** extend existing QA seal, global docs-attempt discovery,
  docs seal/review, and release validation to exact round 4/64 paths. Keep A1..A3,
  preflight-before-output, same-candidate, and no-repo-edit rules unchanged.
- **T4 [R2, R3, R4, R5]:** add fail-if-removed tests for exception success,
  old-cycle round-4 refusal, exception non-4 refusal, universal round-5 refusal,
  exact round-3 predecessor/resolution, absent output on refusal, cap/override
  manifests, historical bundle compatibility, 64-path equality, round-4 QA seal,
  round-4 docs A1, docs attempt cap, generated report schema/exact exception and
  TD1..TD5 text, and release tree equality. Every inner-output test must monkeypatch
  the evidence root to a temporary directory or use only child resources. Add a
  regression that pre-creates a synthetic outer round-4 directory while inner
  transition/refusal cases still pass without reading, asserting on, or writing
  that outer path; retained rounds 2/3 may be read-only fixtures.
- **T5 [R1, R6]:** update Dev Notes and QA report to list the new plan/decision,
  exact 64 paths, `TD-QA-ORIGIN-5`, 53-test planning proof, two consumed failed
  bundles, and one authoritative round-4 command. Remove “no fourth authorized”
  claims without pre-claiming the new verdict.
- **T6 [R3, R4, R6]:** after focused preflight, create exact append-only round-3
  gate resolution and round-4 final message, execute the round-4 command once, and
  validate its complete bundle. If any gate fails, preserve evidence and stop.
- **T7 [R4, R5, R6]:** hand the validated bundle to the independent QA reviewer,
  seal only its exact result, and stop on `CHANGES_REQUESTED`. On approval and no
  repo drift, seal docs A1, obtain independent docs review, and use only external
  A2/A3 remediation when allowed.
- **T8 [R5, R7]:** after docs approval, run pre-stage validation, stage/compare the
  literal 64 paths, run post-stage validation, render the reviewed message, commit,
  push, fixed-base PR/merge, and execute the supervised deployment sequence; stop
  at any unmet secure-runner prerequisite.

## Testing Strategy

Preflight before the one binding retry:

1. canonical `plan-v1`, decision, Dev Notes, QA report, and `docs-commit-v1`
   validation;
2. exact 64-path changed-tree equality, empty index, fixed branch/HEAD/base, plan
   pins, T0/snapshot identity, and `git diff --check`;
3. `PYTHONDONTWRITEBYTECODE=1 .venv/bin/python -m pytest -q
   tests/test_m2_11_qa_bundle.py` with new behavioral exception cases, exact
   generated-report assertions, and a synthetic already-created outer round-4
   directory proving all inner outputs are isolated under a monkeypatched temporary
   evidence root; and
4. offline validation of historical recovery/finalization approved bundles plus
   exact failed finalization rounds 2 and 3.

The one round-4 bundle then runs these exact 15 gates, each with a direct exit and
unchanged pre/post fingerprint:

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

No test or command invokes T0, full-corpus derivation, Git staging, GitHub mutation,
or production before both reviews approve.

## Verification Matrix

| Requirement | Executable proof |
| --- | --- |
| R1 | exception decision/plan pins; exception manifest says cap 4/override true; old cycle manifests remain cap 3/override false; round 5 refuses |
| R2 | exact 64-path/fixed-state tests plus direct HEAD/base/index/T0/snapshot/round-3 ledger hash checks |
| R3 | exact `finalization-exception` round-4 success preflight; old-cycle round-4, exception non-4, bad predecessor/resolution, collision, and round-5 refusals leave isolated outputs absent; synthetic live outer round 4 cannot affect inner tests |
| R4 | fresh ledger has exactly the 15 named zero exits and one fingerprint; manifests/token bind all prior-gate records; schema-valid generated report names exception/round 4/64/TD1..TD5; independent QA seal validates and is APPROVED |
| R5 | round-4 QA/docs manifests share fingerprint/tree/typed 64-path inputs; A1..A3 and no-repo-edit rules pass; pre/post-stage trees match |
| R6 | schema-valid Dev Notes, repository QA report, and generated bundle report grep cleanly for exception facts, TD5, 64, authoritative round-4 command where applicable, and no advance approval/deploy claim |
| R7 | exact cached allowlist/tree, fixed-base PR assertions, secure-runner preflights, and real v1 tombstone/v2 index-shard-filer functional checks |

## Rollout / Rollback

After independent plan approval, implement T1-T5, create the two exact append-only
inputs, and run focused preflight. The authoritative one-time retry command is:

```bash
root=/Users/johnbaek/projects/Populus-ops/snapshots/evidence/m2-11
qa_bundle="$root/qa-v9-finalization-round-4"
final_message="$root/final-docs-commit.finalization-r4-a1.md"
PYTHONDONTWRITEBYTECODE=1 .venv/bin/python scripts/build_m2_11_qa_bundle.py run \
  --cycle finalization-exception --round 4 \
  --final-docs-commit "$final_message" \
  --prior-gate-bundle "$root/qa-v9-finalization-round-3" \
  --resolution-notes "$root/resolution-notes.finalization-r3-gates.md" \
  --output "$qa_bundle"
PYTHONDONTWRITEBYTECODE=1 .venv/bin/python scripts/build_m2_11_qa_bundle.py validate \
  --bundle "$qa_bundle"
```

The command is invoked exactly once and only while the output is absent. On a
nonzero gate, preserve the partial bundle and stop. On success, the independent QA
reviewer receives the validated adoption manifest and full bundle; the primary
seals the exact returned review:

```bash
qa_review="$root/qa-review.finalization-r4.canonical.md"
PYTHONDONTWRITEBYTECODE=1 .venv/bin/python scripts/build_m2_11_qa_bundle.py seal-review \
  --bundle "$qa_bundle" --review "$qa_review"
```

If and only if that sealed review ends `VERDICT: APPROVED` and the repository is
byte-identical, seal docs attempt A1:

```bash
docs_bundle="$root/docs-v9-finalization-r4-a1"
PYTHONDONTWRITEBYTECODE=1 .venv/bin/python scripts/build_m2_11_qa_bundle.py seal-docs \
  --bundle "$qa_bundle" \
  --qa-review "$qa_bundle/qa-review.round-4.md" \
  --final-docs-commit "$final_message" --attempt 1 \
  --output "$docs_bundle"
```

The separate docs reviewer receives `docs-review-input.manifest.json`; the primary
seals its exact verdict with `seal-docs-review`. A docs-only rejection may use A2
or A3 with exact prior review/resolution and a new external final-message artifact.
Any repository edit or exhausted docs attempt stops.

After sealed docs approval, reuse the approved finalization plan's pre-stage,
literal allowlist, post-stage, commit-message renderer, fixed-base PR/merge, and
supervised deploy commands with these only substitutions:

- expected count `64`;
- add
  `docs/build/RUN-M2-11-QA-finalization-exception-decision.md` and
  `docs/build/RUN-M2-11-QA-finalization-exception-plan.md` to the exact array; and
- use the round-4 approved docs bundle/final-message paths.

The exact array is the Architecture inventory; generate expected/cached name files
from that literal array, require `diff -u` equality before and after `git add --`,
require `git write-tree` equal the reviewed tree, and run `validate-release` in
both modes. No `git add -A` or wildcard is allowed.

Rollback before commit is no release action; evidence remains append-only. A failed
round 4 has no automated rollback/retry. After merge, use the approved normal
pointer/PR rollback. If secure runner/controller provisioning is absent, stop after
merge with publication still withheld; never mutate the source or bypass isolation.

## Simplicity Audit

This is the minimum coherent exception: two governance files, four existing files
updated, two small append-only inputs, and one existing runner path reused. It adds
no module, public API, schema family, dependency, product branch, workflow, service,
or deployment fork. No new function is planned: existing fixed-state, bundle
validation, `write_markdown_artifacts`, docs-attempt, seal, and CLI functions
receive explicit cycle policy.
The only new names are two path constants, one exception-scope tuple, and test cases.
Digest-scoped exact-round policy is deliberately less general than a reusable
“override cap” framework and cannot authorize future retries accidentally.

## Tech Debt Introduced

- **TD-QA-ORIGIN-5 — exceptional fourth finalization retry.** The run-specific
  bridge records one more digest-scoped cycle/round branch because append-only
  rounds 2 and 3 were consumed by self-observing focused tests after product QA and
  T0 had already closed. Impact: two governance files, one additional policy
  branch, and focused tests remain until release. Control: exact round 4 only,
  all 15 gates, independent QA/docs, no round 5, no product import. Removal:
  together with TD-QA-ORIGIN-1 through -4 when `orchestrate-tool` natively supports
  current v9 QA-only adoption, failed-gate continuation, and typed post-QA docs
  sealing.

No product, performance, security, dependency, snapshot, deployment, or hidden test
debt is introduced. Existing eager-build/npm-audit and TD-QA-ORIGIN-1..4 records
remain unchanged except for factual cross-reference to TD5.

## Memory Touch-Points

- `feedback_gate_list_completeness.md`, `feedback_full_tree_gate_scope.md`, and
  `feedback_gate_scope_completeness.md` require the exact full 15-command round-4
  battery; the focused 53-test proof cannot substitute.
- `feedback_gate_function_exit_codes.md` keeps the recorded gate-2 failure honest
  and requires direct zero exits before QA.
- `feedback_phase_gate_discipline.md` preserves the failed round-3 evidence and
  records an explicit owner exception instead of rewriting the gate or result.
- `feedback_qa_fail_batch_remediation.md` keeps fixes with the primary and requires
  independent re-review without self-signing.
- `feedback_preexisting_gate_fix_pattern.md` reinforces that no unrelated failure
  may be folded into this exceptional retry.
- `feedback_gate_first_before_read_not_dependency.md` and
  `feedback_gate_evaluates_threshold_directly.md` reinforce non-vacuous boundary
  tests and direct policy checks rather than inferred success flags.
- `feedback_gh_api_flaky_auth_retry.md` applies only after docs approval: bounded
  GitHub retries must still verify the exact returned PR/run identity.
- The shared `failure-modes.md` catalog locks full-set propagation, secrets,
  function-not-liveness, source-repair invalidation, and append-only transport.

## Failure-Mode Sweep

| Catalog/recurrent risk | Prevention and fail-if-removed proof |
| --- | --- |
| full-set/parallel consumer miss | exact 64 paths; grep all round/cap/path/manifest/docs consumers; QA/release tuples equal |
| secret or unsafe path | unchanged redaction/path refusal, 0600 files, positional validator arguments, disk-only complete diff |
| stale/rewritten predecessor | canonical exact round-3 ledger/log/artifact graph and resolution digest bound before output |
| cap silently widened | digest-scoped exception accepts only round 4; old round 4, exception non-4, and every round 5 refuse |
| output consumed on invalid input | plan/pins/predecessor/message/state/collision preflight before create-once output; absence asserted |
| active outer bundle poisons focused test | all inner outputs use monkeypatched temporary roots/child resources; synthetic pre-existing outer round 4 is ignored and remains unchanged |
| focused proof mistaken for QA | unchanged 15-entry ledger required; direct exit/fingerprint equality enforced |
| generated report hides TD5 | cycle-aware renderer and exact schema/text assertions align plan, repository docs, generated QA report, and manifests |
| source repair reuses evidence | any repository edit changes token and invalidates round 4; no fifth round is authorized |
| reviewer self-sign/substitution | separate read-only reviewer; exact sealed manifest/output/candidate checks |
| docs retry hides repo edit | A2/A3 bind prior docs evidence and require identical repository fingerprint; repo edit stops |
| deployment liveness-only | existing v1 tombstone plus v2 index/shard/reassembly/filer page functional verifier retained |
| insecure overnight shortcut | absent dedicated runner/controller is a hard supervised post-merge stop |

## Definition of Done

- [ ] **R1:** exception plan/decision are independently approved and pin exactly
  one logical round 4 with no round 5 or T0/product-QA expansion.
- [ ] **R2:** exact 64 paths, fixed Git state, plans/decisions/findings, round-3
  ledger/log, T0, and snapshot all validate before evidence creation.
- [ ] **R3:** only the exact exception round-4 command succeeds; all wrong
  cycle/round/predecessor/resolution/collision cases refuse without output, and
  hermetic inner tests pass while a synthetic outer round-4 directory exists.
- [ ] **R4:** round-4 manifest/token graph binds cap 4/explicit override and exact
  predecessor; generated QA report is schema-valid and names exception/round
  4/64/TD1..TD5; all 15 gates exit zero once; independent QA seals APPROVED.
- [ ] **R5:** unchanged bytes enter typed round-4 docs review; any allowed A2/A3
  is external-only; sealed docs APPROVED and pre/post-stage 64-path trees agree.
- [ ] **R6:** Dev Notes and QA report truthfully declare exception state, TD5,
  commands, counts, and outcomes; the generated QA report agrees, with no hidden
  debt or advance claims.
- [ ] **R7:** only the reviewed 64 paths reach commit/PR/merge; supervised deploy
  either proves real institutional v2 data and arms scheduling or stops at the
  unmet secure-runner prerequisite without weakening controls.
