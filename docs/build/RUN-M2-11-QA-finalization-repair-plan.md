# RUN M2-11 — Exceptional Finalization Repair / QA Round 5 Plan (plan-v1)

**Status:** IN REVIEW
**Owner authorization:** 2026-08-11, “Authorize one exceptional owner-reviewed
finalization repair and QA round 5, strictly limited to QA findings F1 and F2, with no
T0 rerun or product changes.”
**Transport:** interactive-disk with independent read-only plan review
**Candidate:** dedicated worktree `codex/m2-11-t0-finalize`, fixed HEAD
`7391d947f72cf408a173f1e7938102608b2269d4`, fetched `origin/main`
`21340330a0fad7e9e39c1a9cec67656643621b05`.

## Goal and Success Criteria

Resolve only the two blockers in the sealed finalization-round-4 QA review, then run
exactly one owner-authorized finalization QA round 5 without touching product code,
T0-v11, or the accepted snapshot. Success means:

1. the new owner decision and this independently approved plan make the fifth-round
   exception explicit and digest-scoped rather than silently widening an earlier cycle;
2. the failed-gate predecessor validator enforces the exact immutable round-3
   ledger/log/fingerprint/two-gate identity and validates all 13 predecessor artifacts
   plus its resolution note before any output directory is created;
3. hermetic focused tests carry an exceptional round-4 candidate through candidate-bound
   QA sealing and docs A1, proving manifest/tree equality plus substitution and collision
   refusals;
4. an exact 66-path candidate creates one append-only
   `qa-v9-finalization-round-5` bundle from the sealed round-4
   `CHANGES_REQUESTED` review and exact F1/F2 resolution note;
5. all 15 unchanged standing gates exit zero with one unchanged fingerprint and an
   independent QA reviewer approves the exact round-5 bundle;
6. without a repository edit, independent docs review approves the round-5 A1 handoff
   and final commit message before staging, PR, or deployment; and
7. any round-5 failure stops without round 6, while T0-v11 and the snapshot remain
   byte-identical and are never rerun.

## Requirements

- **R1 — Exact new authority and scope.** Record the exact owner quote in a distinct
  decision and plan. The new digest-identified cycle authorizes only one repair of QA
  F1/F2 and one logical finalization round 5. It authorizes neither round 6 nor another
  product-QA/T0 cycle.
- **R2 — F1 exact predecessor validation.** Harden `validate_failed_gate_bundle()` so
  the round-3 failed bundle must match ledger SHA
  `355596d5e3c7b393bb2b167e8e2da906803b268a95860c875002c62e103d2c69`,
  recovery-test log SHA
  `16c798306bb4f172f8640d9392a06f7309c99c93062646689b784257df0e213a`,
  fingerprint `ebb810f846ec1aed0b7e645833759e2de93541828f2787e16b5af37beb057614`,
  and exactly two contiguous entries: `diff-check` PASS/0 and `recovery-tests` FAIL/1
  with their exact kinds, scopes, paths, and digests. Validate every one of the 13
  declared predecessor artifacts against its schema before returning records. Validate
  `owner-decision.md` through an explicit repository-local `owner-decision-v1` Markdown
  grammar as well as its exact pinned digest; the installed validator does not own that
  schema. Validate
  the paired resolution note against the repository-local `resolution-notes-v1`
  grammar before matching its exact failed-gate ID. All failures occur before output.
- **R3 — F2 executable round-4 handoff proof.** Add a hermetic fixture using
  `FINALIZATION_RETRY_EXCEPTION_SCOPE`, logical round 4, a temporary evidence root, and
  no live evidence writes. It must invoke real `seal-review` then real `seal-docs --attempt
  1`, prove the sealed QA manifest is candidate-bound, prove the docs manifest binds the
  same adoption/review/final message and an equal approved tree, and fail if the feature
  is removed. Separate cases must reject substituted review/manifest inputs and review
  output/manifest collisions refusal-atomically.
- **R4 — Exact 66-path round-5 transport.** Add a distinct
  `finalization-repair-exception` cycle accepted only with `--round 5`, the exact sealed
  round-4 QA review/manifest, exact F1/F2 resolution note, exact
  `final-docs-commit.finalization-r5-a1.md`, and absent exact round-5 output. It uses
  `automated_caps.qa_rounds=5`, `explicit_overrides.qa_rounds=true`, a distinct sorted
  exception scope, and the new plan/decision digests. Historical cycles retain their
  original caps and offline validation; every cycle rejects round 6.
- **R5 — Complete fresh QA and independent verdict.** Round 5 must bind the round-4
  sealed review, its candidate-bound manifest, and exact resolution note into all typed
  phase/adoption manifests; emit a schema-valid cycle-aware QA report naming logical
  round 5, exact 66 paths, exception authority, and `TD-QA-ORIGIN-1` through
  `TD-QA-ORIGIN-6`; run the unchanged 15 literal gates once; and receive a separate
  read-only QA review. Any gate failure or QA `CHANGES_REQUESTED` is a hard stop.
- **R6 — Same-candidate docs/release/deployment.** Only an approved sealed round-5 QA
  review may enter `docs-v9-finalization-r5-a1`. Existing global docs attempts remain
  A1..A3; A2/A3 may repair external-only evidence. Any repository edit invalidates QA.
  After docs approval, pre/post-stage validation, literal 66-path staging, fixed-base
  PR/merge, and the already-approved supervised deployment/runbook checks remain
  mandatory.
- **R7 — Factual propagation, debt, and immutability.** Update only the two factual
  repository reports to record round-4 `CHANGES_REQUESTED`, F1/F2, the new authority,
  exact 66 paths, focused test results, authoritative round-5 command, and
  `TD-QA-ORIGIN-6`, without pre-claiming round-5 QA/docs/release/deploy success. Product
  paths, T0-v11, snapshot, prior evidence, thresholds, and deployment controls are
  immutable.

## Scope

Authorized repository writes are exactly:

```text
docs/build/RUN-M2-11-QA-finalization-repair-decision.md
docs/build/RUN-M2-11-QA-finalization-repair-plan.md
docs/build/RUN-M2-11-devnotes.md
docs/build/RUN-M2-11-qa-report.md
scripts/build_m2_11_qa_bundle.py
tests/test_m2_11_qa_bundle.py
```

Authorized append-only external artifacts are exactly the already sealed round-4 QA
review/manifest, a new `resolution-notes.finalization-r4-qa.md`, a new
`final-docs-commit.finalization-r5-a1.md`, one `qa-v9-finalization-round-5/` bundle and
its independent QA review/seal, and—only after QA approval—
`docs-v9-finalization-r5-a1` through `-a3` with their exact review/resolution artifacts.
Existing evidence files are read-only; no path is deleted, overwritten, renamed, or
reused.

## Non-goals

- no product, schema, payload, route, dashboard, build-resource, budget, workflow,
  dependency, runner, deployment-variable, or site-content change;
- no T0-v11/full-corpus derivation, snapshot mutation, evidence rewrite/deletion,
  history rewrite, threshold relaxation, or retrospective relabeling;
- no repair outside QA F1/F2, no round 6, and no repository fix after round-5 QA;
- no change to prior plans/decisions or their pinned digests;
- no staging, commit, PR, merge, GitHub mutation, or deployment before independent QA
  and docs approval.

## Constraints

- Before this decision/plan, the exact 64-path fingerprint is
  `6b448d5c434be33415e41a5086451b6d28cb1fce70ac2f1d94cf0bfbacc82103`.
  The two new governance files make the reviewed planning candidate exactly 66 paths.
- Decision SHA-256 is
  `ba8c1653144d683e70c497ad1d7e899bf9c21cba9b3b870897f891fa0c5fe4f8`.
  Prior exception plan/decision remain
  `71ca0c1f4eaadb165d49655de4dd838cbbb3ed9b681df815bd170d03f018faf3`
  and `8222a145ddba5a9101c4f851c4aa3f7eca1fe68e7eb9dffd116f51123b7747c0`.
- Round 4 validated token is
  `sha256:a1f39ef2a6c5bba9c3b63ee7f516896a923808ed9499b24af51c2e5684c25eaa`;
  adoption SHA is
  `b54196d5618fbc5dbe8a60ba90703b5ddb95747af631c8b5e0c2da4d2dd40dcc`.
- The sealed round-4 QA review is `CHANGES_REQUESTED` at SHA
  `37fa8805ea04e5df674d6cb5539c4a85e33c76735cc5f80f5bc88419004615df`;
  its candidate-bound manifest SHA is
  `745571baaf94cab87e2b22f7e4fdd8355e9a1666f6b5092c67aef932a5ef7a62`.
  Its open IDs are exactly F1 and F2.
- Failed round-3 ledger/fingerprint/failure-log identities are the exact R2 values.
  Its gate-1 empty log SHA remains
  `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`.
- Tail plan SHA remains
  `068e7fc04edf61e0e3d25e40ff504b003faa0d0ab6d26fa65982a4899e119fad`;
  findings SHA remains
  `cf1739a8571f312231e2a842bd0fbe7521e6b2f4a5f522c2089bbd78957579fd`.
- T0-v11 remains 63,400 bytes/171 lines at SHA
  `7078a42934484c9c5ba7f975654476e0788c385dbaf8108c0d429a58ba91a453`.
  Snapshot remains 23,058,628,608 bytes, mode `0444`, sidecar-free, SHA
  `977a4d249d92590a4de2961a3e9c7ff8cfa2e4846f0097ec7aa6c07f28124121`.
- The full redacted patch remains disk-only under 2,097,152 bytes; every other
  artifact retains the 1,048,576-byte cap. New directories are create-once 0700 and
  files are 0600 regular nonsymlinks.
- Secrets, tokens, private keys, `.env` contents, and credentials never enter evidence,
  Git, command output, or chat.

## Current State

- Product implementation, the only T0-v11 run, and product QA are complete and are not
  reopened by this plan.
- Finalization round 4 ran all 15 gates successfully against one fingerprint and bundle
  token. Independent QA then returned exactly F1/F2 and was sealed as
  `CHANGES_REQUESTED`; no docs bundle was created.
- The repository still has the exact approved product candidate plus the run-specific
  evidence bridge. No staged files, commit, PR, merge, registered dedicated runner, or
  deployment exists.
- `qa-v9-finalization-round-5`, round-5 resolution/final-message artifacts, and all
  finalization docs attempt directories are absent.

## Detected Stack

- **Languages:** Python 3.12.13 at repository root; TypeScript/Astro under
  `dashboard/`; Markdown governance artifacts.
- **Runners:** frozen `uv.lock` with repository `.venv`; npm 11 / Node 24 with
  `dashboard/package-lock.json`; Make owns complete gates.
- **Tests:** pytest, Node native tests, Astro/TypeScript build and post-build tests.
- **Publication:** immutable SQLite/JSON1 snapshot and signed static Pages publication.
- **Repair delta:** Python stdlib and Markdown only; no dependency or product import.

## Reuse Map

| Need | Existing implementation reused | Locked decision |
| --- | --- | --- |
| F1 validation | `validate_failed_gate_bundle`, `load_canonical_file`, `validate_content`, digest/path checks | extend one validator with exact identities and a small repository-local schema dispatcher; no second validator module |
| F2 handoff proof | `seal_docs_fixture`, `seal-review`, `seal-docs`, approved-tree and manifest checks | parameterize the existing fixture and exercise real commands under a temp evidence root |
| round-5 transition | existing digest-derived cycle switch, sealed-QA predecessor path, resolution matching | add one exact cycle/round branch; no generic cap override |
| candidate evidence | `EXPECTED_QA_PATHS`, `validate_fixed_state`, origin writers, gate ledger, approved tree, token, manifests | add exactly two governance paths; QA/release inventories remain identical |
| reports | existing `write_markdown_artifacts`, Dev Notes, QA report | extend existing cycle-aware wording; no second renderer |
| reviews/release | existing QA/docs seals and `validate-release` | extend exact round regexes to 5 while docs attempt cap remains 3 |
| deployment | approved finalization runbook/functional probes | reuse unchanged after both reviews approve |

Reuse-first scans for `validate_failed_gate_bundle`, `seal_docs_fixture`,
`finalization-exception`, `qa_rounds`, `qa-v9-finalization`, `seal-review`, `seal-docs`,
and `validate-release` find one active runner and one focused test module. Another script,
schema family, or runner would be parallel governance debt.

## Architecture

### Exact 66-path candidate and release inventory

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

### F1 validation contract

`validate_failed_gate_bundle()` remains the single entry point. Before returning its
records it must:

1. require the exact round-3 namespace, exact ledger SHA, exact fingerprint, exact two
   entry objects, exact gate log paths/digests, and exact plan/decision pins;
2. route standard `plan-v1`, `dev-notes-v1`, and `redacted-diff-v1` artifacts through
   the installed validator (with the existing 2-MiB diff cap);
3. validate `owner-decision-v1` locally as a regular nonsymlink file of 1..1,048,576
   bytes, strict UTF-8 with LF-only lines and exactly one final newline, no NUL or
   `VERDICT:` line, exactly one H1 matching
   `# RUN M2-11 — <nonempty text> Owner Decision`, exactly one `**Date:** YYYY-MM-DD`
   field, exactly one nonempty smart-quoted `**Owner authorization:**` field (which may
   wrap across adjacent lines), and exactly one `The controlling plan is` clause naming
   one backticked `docs/build/RUN-M2-11-...plan.md` path. No second H1 or duplicate
   metadata field is allowed. The round-3 decision must additionally match its existing
   exact SHA pin, so a different schema-valid owner decision still refuses;
4. validate custom JSON by canonical decoding, exact key sets/schema versions/types,
   lowercase SHA/path identities, sorted unique changed paths, cross-digests, fixed
   branch/HEAD/base/worktree, no-external-state invariants, source-preservation claims,
   and isolated-feature relationships;
5. validate gate logs as regular bounded UTF-8/LF files and enforce their exact pinned
   digests; and
6. validate resolution notes as regular bounded UTF-8/LF Markdown ending in one newline,
   with unique exact `## <ID>: resolved` headings and no verdict line, before matching
   the exact failed IDs.

The helper is repository-local because the installed workflow validator does not own the
run-specific schemas. It is named and tested rather than silently relabeling artifacts.
Mutation tests cover ledger digest, fingerprint, entry count/order/ID/kind/scope/status/
exit/path/log digest, every custom schema/key/cross-digest relation, standard validator
invocation, valid round-3 owner-decision parsing, malformed owner-decision size/UTF-8/
newline/H1/date/authorization/controlling-plan/duplicate/verdict cases, a substituted
schema-valid owner decision rejected by the SHA pin, malformed log, and malformed/
duplicate resolution headings. Every refusal leaves the requested output absent.

### F2 round-4 handoff contract

The existing docs fixture gains explicit `round_no` and `exception_scope` inputs. A new
round-4 handoff test builds one synthetic candidate graph under a temporary evidence root,
invokes actual `seal-review`, validates its exact manifest, then invokes actual
`seal-docs --attempt 1`. It asserts:

- review output and manifest are create-once and bind round 4, base, fingerprint,
  adoption manifest, and all QA-review inputs;
- docs input binds that sealed review/manifest, the final message, adoption manifest, and
  an approved tree whose OID/evidence equals the candidate tree;
- review or manifest substitution is rejected before docs output;
- pre-existing review output or manifest collision leaves the other target absent; and
- the live evidence root is never read or written.

### Round-5 authority and stop contract

The CLI gains `finalization-repair-exception`, accepted only at round 5 with
`prior-review` and not gate/docs predecessors. The plan/decision digests select exact
scope, cap 5/override true, allowed rounds `(5,)`, round-5 namespace/report, and
sealed-round-4 QA predecessor. Existing branches remain round 1..3 and exact round 4.
All cycles reject round 6. Docs/review regexes recognize round 5 while global docs attempt
numbers remain A1..A3.

The only transition is:

```text
sealed round-4 QA CHANGES_REQUESTED + exact F1/F2 resolution + approved repair plan
  -> one create-once round-5 bundle
  -> 15 gates PASS
  -> independent QA APPROVED
  -> same bytes in docs A1
  -> independent docs APPROVED
  -> exact-tree release/deploy
```

Any failed arrow preserves append-only evidence and stops. There is no round 6.

## Locked Decisions

1. F1/F2 are the entire repair scope; no product path may change.
2. The current installed validator is reused for standard schemas; exact local schemas
   remain in the existing run-specific bridge and are declared TD2/TD6. The local
   `owner-decision-v1` grammar is explicit and independently unit-tested; its schema check
   and the exact historical digest check are separate controls.
3. Exact identity is checked in addition to structural/schema validity for the pinned
   round-3 ledger/log/fingerprint/two-entry contract.
4. The F2 test uses the real seal commands under a temporary evidence root, not a live
   path assertion or a mocked success flag.
5. Round 5 consumes the sealed round-4 QA rejection, not the older gate failure.
6. All 15 gates rerun; focused tests are planning/preflight evidence only.
7. A round-5 failure or QA change request stops; no round 6 is synthesized.
8. Docs A2/A3 remain external-only. Any repository byte change invalidates QA.
9. T0-v11 and snapshot are identity checks only.
10. Secure runner absence remains a post-merge stop; controls are not weakened.

## Alternatives Considered

- **Trust round-3 internal consistency:** rejected by F1; exact owner-reviewed identities
  must be executable refusals.
- **Pin every round-3 artifact byte instead of schema-validating noncritical origins:**
  rejected as unnecessary duplication; the finding explicitly requires exact critical
  identities plus schema validation of every declared artifact.
- **Add schemas to orchestrate-tool:** rejected as outside repo/scope and unnecessary for
  a release-specific bridge.
- **Mock the F2 seal success:** rejected; it would not fail if the real transition broke.
- **Reuse or rewrite round 4:** rejected; its successful gates and QA rejection are
  immutable evidence.
- **Generalize to arbitrary retries:** rejected; exact digest/round policy is smaller and
  cannot authorize round 6.
- **Skip complete gates because product bytes did not change:** rejected; source repair
  invalidates all downstream evidence.

## Planned Files

| Path | Planned change |
| --- | --- |
| `docs/build/RUN-M2-11-QA-finalization-repair-decision.md` | exact owner quote, F1/F2-only repair, round-5/no-round-6 boundary |
| `docs/build/RUN-M2-11-QA-finalization-repair-plan.md` | this controlling independently reviewed plan |
| `scripts/build_m2_11_qa_bundle.py` | F1 exact/schema validation, digest-scoped round-5 branch, 66 paths, report/docs/release propagation |
| `tests/test_m2_11_qa_bundle.py` | F1 mutation refusals, real hermetic F2 handoff, round-5/historical/no-round-6 coverage |
| `docs/build/RUN-M2-11-devnotes.md` | factual round-4 rejection, repair authority, command, counts, TD6, no advance claims |
| `docs/build/RUN-M2-11-qa-report.md` | factual F1/F2 remediation state, evidence/tests, TD6, pending round-5 authority |

No other repository path may change during implementation. Append-only external outputs
are evidence, not repository files. The cumulative release tree is the exact 66-path
Architecture inventory.

## Implementation Tasks

- **T1 [R1, R4, R7]:** validate/pin the decision and approved plan, add their exact
  constants/digests, extend both exact inventories to 66, and add the distinct sorted
  round-5 exception scope/cap/run identity. Preserve every historical digest branch.
- **T2 [R2]:** harden the existing failed-gate validator with exact pinned critical
  identities, explicit run-specific schema validation for all 13 artifacts (including
  the bounded local `owner-decision-v1` grammar plus separate exact digest), resolution
  schema validation, and pre-output failure order.
- **T3 [R3]:** parameterize the existing synthetic docs fixture and add real round-4
  seal-review→seal-docs A1 success, equality, substitution, and collision tests under a
  temporary evidence root.
- **T4 [R4, R5, R6]:** add exact round-5 CLI/bundle/report/manifest/docs/release handling,
  sealed round-4 QA predecessor enforcement, cap 5/override true, historical cap
  preservation, and round-6 refusal.
- **T5 [R2, R3, R4, R5]:** add mutation/fail-if-removed tests for every new validation
  boundary, exact 66-path equality, generated round-5 QA text/TD6, all cycle caps,
  historical bundle validation, and refusal-atomic output behavior.
- **T6 [R7]:** update Dev Notes and repository QA report with only facts true before the
  new candidate fingerprint, including round-4 token/rejection, F1/F2, new authority,
  exact 66 paths, focused results, authoritative command, and TD6.
- **T7 [R4, R5, R7]:** after focused preflight, create exact F1/F2 resolution notes and
  round-5 final message, execute the one round-5 command once, validate, and stop on any
  gate failure.
- **T8 [R5, R6]:** obtain independent QA, seal its exact verdict, stop on rejection, then
  seal docs A1 and obtain independent docs review without repository edits.
- **T9 [R6, R7]:** only after both approvals, pre-stage validate, stage/compare literal 66
  paths, post-stage validate, commit, push, fixed-base PR/merge, and run the supervised
  deployment sequence; stop at unmet secure-runner prerequisites.

## Testing Strategy

Preflight before the one round-5 binding run:

1. validate `plan-v1`, decision, Dev Notes, QA report, resolution notes, and final
   `docs-commit-v1`;
2. prove exact 66-path equality, empty index, fixed branch/HEAD/base, all pins,
   round-4 sealed review/manifest, round-3 critical identities, T0/snapshot identity,
   output absence, and `git diff --check`;
3. run `PYTHONDONTWRITEBYTECODE=1 .venv/bin/python -m pytest -q
   tests/test_m2_11_qa_bundle.py`, including all F1 mutations and the real hermetic F2
   transition; F1 includes direct valid/malformed/substituted `owner-decision-v1`
   cases so the local grammar cannot be bypassed by the digest check; and
4. validate retained historical approved/failed bundles offline under their original
   digest-scoped policies.

The single round-5 bundle runs these unchanged 15 gates:

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

No test or command invokes T0/full-corpus derivation, stages Git, mutates GitHub, or
touches production before both reviews approve.

## Verification Matrix

| Requirement | Executable proof |
| --- | --- |
| R1 | exact decision/plan digests, exact new scope/cycle, cap 5/override true, round 6 refused |
| R2 | exact round-3 ledger/log/fingerprint/two-entry checks; every artifact schema case and mutation refuses before output; local owner-decision grammar and separate substitution SHA refusal; resolution schema/IDs exact |
| R3 | real hermetic round-4 seal-review→seal-docs A1 success with manifest/tree equality; substitution and both collision directions refuse atomically |
| R4 | exact 66 paths; only repair-exception round 5 succeeds; prior cycles/caps validate unchanged; wrong predecessor/round/collision refuses absent output |
| R5 | round-5 ledger has exactly 15 direct zero exits and one fingerprint; token/manifests bind sealed round-4 review/manifest/resolution; generated report names round5/66/TD1..6; independent QA seal APPROVED |
| R6 | unchanged fingerprint/tree passes round-5 docs A1 and docs review; pre/post-stage exact trees; functional supervised deployment checks retained |
| R7 | product-path diff against round4 is empty; T0/snapshot hashes unchanged; Dev Notes/QA/generated report agree on facts, counts, TD6, and pending outcomes |

## Rollout / Rollback

After independent plan approval, implement T1–T6 and run focused preflight. Create the
append-only F1/F2 resolution note and round-5 final-message artifact. The authoritative
single binding command is:

```bash
root=/Users/johnbaek/projects/Populus-ops/snapshots/evidence/m2-11
qa_bundle="$root/qa-v9-finalization-round-5"
final_message="$root/final-docs-commit.finalization-r5-a1.md"
PYTHONDONTWRITEBYTECODE=1 .venv/bin/python scripts/build_m2_11_qa_bundle.py run \
  --cycle finalization-repair-exception --round 5 \
  --final-docs-commit "$final_message" \
  --prior-review "$root/qa-v9-finalization-round-4/qa-review.round-4.md" \
  --resolution-notes "$root/resolution-notes.finalization-r4-qa.md" \
  --output "$qa_bundle"
PYTHONDONTWRITEBYTECODE=1 .venv/bin/python scripts/build_m2_11_qa_bundle.py validate \
  --bundle "$qa_bundle"
```

Invoke it exactly once while the output is absent. On any failure, preserve the output and
stop. On success, independent QA reviews the exact bundle. Seal only its exact verdict:

```bash
qa_review="$root/qa-review.finalization-r5.canonical.md"
PYTHONDONTWRITEBYTECODE=1 .venv/bin/python scripts/build_m2_11_qa_bundle.py seal-review \
  --bundle "$qa_bundle" --review "$qa_review"
```

Only an approved sealed review and unchanged repository may enter docs A1:

```bash
docs_bundle="$root/docs-v9-finalization-r5-a1"
PYTHONDONTWRITEBYTECODE=1 .venv/bin/python scripts/build_m2_11_qa_bundle.py seal-docs \
  --bundle "$qa_bundle" \
  --qa-review "$qa_bundle/qa-review.round-5.md" \
  --final-docs-commit "$final_message" --attempt 1 \
  --output "$docs_bundle"
```

The independent docs reviewer receives `docs-review-input.manifest.json`; the primary
seals its exact verdict. A docs-only rejection may use A2/A3 with exact prior evidence;
any repository edit or exhausted attempt stops.

After docs approval, reuse the approved finalization release/deploy commands with exactly
these substitutions: expected count 66; add the two repair governance paths to the literal
array; use round-5 approved bundle/message paths. Require literal expected/cached-name
equality before/after `git add --`, reviewed tree equality, pre/post-stage
`validate-release`, fixed-base PR/merge, secure runner/controller preflights, and real v1
tombstone/v2 index-shard-filer functional checks.

Rollback before commit is no release action; evidence remains append-only. A failed round
5 has no automated retry. After merge use the approved pointer/PR rollback. Missing secure
runner provisioning stops after merge with publication withheld; never bypass isolation.

## Simplicity Audit

This is the minimum coherent repair: two new governance files and four existing files
updated. No product file, module, dependency, public API, schema family, workflow, service,
or deployment fork is added. One small repository-local artifact-schema helper is added to
the existing runner because the installed shared validator does not own these release-
specific schemas; `validate_failed_gate_bundle()` remains the only predecessor entry
point. The existing seal fixture is parameterized rather than duplicated. One exact
digest/round branch is added instead of a reusable override framework.

## Tech Debt Introduced

- **TD-QA-ORIGIN-6 — exceptional F1/F2 repair and fifth finalization round.** Impact:
  two governance files, one exact cycle branch, one local predecessor-schema helper, and
  focused tests remain in the release-specific bridge. Control: exact F1/F2 scope, exact
  round 5, all 15 gates, independent QA/docs, no round 6, and zero product imports.
  Removal: with TD-QA-ORIGIN-1 through -5 after release when the shared orchestrator
  natively owns current-tree adoption, failed-gate continuation, custom typed evidence,
  and post-QA docs sealing.

No product, performance, security, dependency, snapshot, deployment, TODO/stub, disabled
test, timeout waiver, threshold relaxation, or hidden debt is introduced. Existing eager-
build/npm-audit and TD1..TD5 records remain factual historical debt.

## Memory Touch-Points

- `feedback_gate_list_completeness.md` and `feedback_full_tree_gate_scope.md` require all
  15 exact gates after source repair; focused tests cannot substitute.
- `feedback_gate_function_exit_codes.md`, `feedback_honest_gate_miss_reporting.md`, and
  `feedback_phase_gate_discipline.md` preserve the round-4 rejection and forbid a
  manufactured approval.
- `feedback_digest_nullness_binding.md` reinforces that exact digests must bind identity,
  not merely structurally plausible content.
- `feedback_gate_evaluates_threshold_directly.md` requires the validator to compare exact
  pinned facts rather than trust self-consistency.
- `feedback_gate_first_before_read_not_dependency.md` requires mutation tests at the real
  pre-output boundary.
- `feedback_schema_audit_prevents_repair.md` keeps the repair diagnostic-first and
  nondestructive.
- `feedback_gh_api_flaky_auth_retry.md` applies only after docs approval and never weakens
  fixed returned-ID verification.
- The complete shared failure-mode catalog enforces full propagation, secret safety,
  function-not-liveness, source-repair invalidation, and append-only provenance.

## Failure-Mode Sweep

| Risk | Prevention and fail-if-removed proof |
| --- | --- |
| critical predecessor substituted | exact ledger/log/fingerprint/two-entry identities and namespace pins |
| structurally invalid origin relabeled | every artifact validated by standard or explicit local schema before records are returned; owner decision has an exact grammar plus independent SHA identity |
| malformed resolution authorizes repair | local UTF-8/LF/heading grammar plus exact F1/F2 or gate-ID equality |
| validator mutation creates output | all pins/schemas/predecessor/message/state/collisions preflight before `mkdir` |
| F2 test passes without real seal path | actual `seal-review` and `seal-docs` invoked under temp evidence root; removal breaks assertions |
| substituted/colliding seal accepted | manifest/review equality and both collision directions refuse with absent counterpart/output |
| cap silently generalized | digest-scoped repair cycle accepts round 5 only; all cycles reject round 6 |
| historical evidence regresses | offline historical recovery/finalization/round4 validation tests retain original caps/digests |
| focused proof mistaken for QA | unchanged 15-entry ledger with direct exits/fingerprint required |
| report hides new debt | exact Dev Notes/repo QA/generated QA TD1..6 assertions and schema validation |
| product or T0 reopened | exact six-file write scope, product diff equality, immutable T0/snapshot hashes |
| reviewer self-sign/substitution | separate read-only agent and candidate-bound create-once review manifests |
| docs repair hides source edit | same fingerprint/tree required; source edit stops with no round 6 |
| deployment liveness-only/insecure | retained functional v1/v2/filer checks and dedicated supervised runner prerequisites |

## Definition of Done

- [ ] **R1:** decision/plan are independently approved and authorize exactly F1/F2 plus
  round 5, with no round 6 or product/T0 expansion.
- [ ] **R2:** exact round-3 critical identities and every predecessor/resolution schema
  validate, including direct owner-decision grammar and substituted-decision SHA tests;
  all mutations refuse before output.
- [ ] **R3:** real hermetic round-4 QA seal→docs A1 test proves candidate/manifest/tree
  equality and substitution/collision refusal.
- [ ] **R4:** exact 66 paths and digest-scoped round-5 transport validate; all historical
  cycles remain accepted under original caps; round 6 refuses.
- [ ] **R5:** all 15 round-5 gates exit zero once with one fingerprint; manifests/token
  bind the exact round-4 rejection/resolution; generated report agrees on round5/66/TD6;
  independent QA seals APPROVED.
- [ ] **R6:** unchanged bytes enter docs A1; independent docs seals APPROVED; exact staged
  tree, fixed-base PR/merge, and supervised functional deployment checks pass or stop at
  an unmet secure-runner prerequisite.
- [ ] **R7:** only the six authorized repair paths differ from round4; T0/snapshot and all
  prior evidence are immutable; factual reports contain no hidden debt or advance claim.
