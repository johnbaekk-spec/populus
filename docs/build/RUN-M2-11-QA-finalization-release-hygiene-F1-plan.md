# RUN M2-11 — Release-Hygiene F1 Verification Repair / QA Round 9 Plan (plan-v1)

## Goal and Success Criteria

Resolve only F1 from the sealed round-8 QA rejection by implementing the
release-hygiene refusal and transition tests already required by the approved
round-8 plan. Preserve every product and T0 byte, retain round 8 as immutable
failed-QA evidence, run one append-only logical QA round 9 with the unchanged 15
gates, and resume docs attempt 3 only after independent QA approval.

Success means an independent literal test oracle executes all 145 locked F1
cases (136 refusals and 9 happy paths); the existing focused suite passes; the
exact 74-path candidate has no product drift from round 8; a create-once round-9
bundle passes all 15 gates; independent QA approves; docs attempt 3 and
independent docs review approve the same tree; and the previously approved
fixed-base release and supervised deployment complete. Any product/T0 change,
missing locked test ID, evidence overwrite, round-10 request, attempt-4 request,
gate/review rejection, or relaxed validation stops.

## Requirements

- **R1 — Exact owner boundary.** Use the exact owner quote, literal run ID
  `RUN-M2-11-QA-finalization-release-hygiene-F1-exception`, literal sorted
  exception scope, logical round 9, cap 9 with explicit owner override, strict
  `owner-decision-v2`, and no round 10.
- **R2 — Independent complete F1 oracle.** Define test-local literal target,
  mutation, predecessor-pin, docs-transition, and rollout sets independently of
  production maps. Execute exactly 136 refusal IDs plus 9 happy IDs and prove
  exact executed-ID equality after parametrization.
- **R3 — Byte/schema refusal coverage.** Exercise every one of the 13 repaired
  lines against missing-edit, extra-byte, tab-suffix, and lossy-body mutations;
  exercise strict owner-decision-v2 malformations and both v1/v2 relabelings;
  retain exact historical v1 and current v2 happy paths.
- **R4 — Exact predecessor refusal coverage.** Exercise every path, digest,
  record, identity, and verdict boundary of the sealed round-7 docs predecessor;
  add and exercise an exact sealed round-8 F1-only QA predecessor for round 9.
- **R5 — Exact attempt-3 and release guards.** Execute one hermetic successful
  round-9 `seal-review` to `seal-docs --attempt 3` transition and refusal cases
  for generic/foreign predecessors, unsealed QA, wrong resolution, attempt 4,
  occupied output, and wrong round. Exercise private-index/output ordering,
  empty-index restoration, PR close/readback, variable readback, and the
  pipefail-safe `jq first(...)` selector markers.
- **R6 — Fresh append-only round 9.** Add only one digest-scoped cycle branch,
  exact 74-path QA/release equality, TD-QA-ORIGIN-10, the same 15 direct gates,
  exact round-8 rejection/resolution provenance, and current manifest/token
  validation. T0/full-corpus commands remain absent.
- **R7 — Factual propagation and release.** Dev Notes and QA report must replace
  the unsupported round-8 completeness claim with the sealed F1 rejection,
  exact repair/test results, TD10, and pending outcomes. Only sealed round-9 QA
  plus sealed docs-attempt-3 approval may authorize the unchanged fixed-base
  PR/merge and supervised functional deployment.

## Scope

Authorized repository writes are exactly these six paths:

1. `docs/build/RUN-M2-11-QA-finalization-release-hygiene-F1-decision.md`
2. `docs/build/RUN-M2-11-QA-finalization-release-hygiene-F1-plan.md`
3. `docs/build/RUN-M2-11-devnotes.md`
4. `docs/build/RUN-M2-11-qa-report.md`
5. `scripts/build_m2_11_qa_bundle.py`
6. `tests/test_m2_11_qa_bundle.py`

Authorized append-only external outputs are the already sealed round-8
canonical rejection/manifest; one exact F1 resolution; one round-9/attempt-3
final-message artifact; one `qa-v9-finalization-round-9/` bundle and independent
review/seal; and one `docs-v9-finalization-r9-a3/` bundle and independent
review/seal.

No product, dashboard, database, serving, aggregate, payload, build, workflow,
runbook, acceptance, dependency, T0, snapshot, prior evidence, round-8 evidence,
or generic orchestrator file is writable.

## Non-goals

- No product correctness, behavior, performance, schema, payload, route, UI,
  publication, resource, signature, security, or deployment-policy change.
- No edit to the completed 13-line whitespace repair and no generic formatter.
- No T0-v11/full-corpus rerun and no snapshot write.
- No rewrite, deletion, relabeling, or reseal of rounds 1–8 or docs attempts 1–2.
- No second runner, new implementation module, dependency, generic validator,
  alternate release path, round 10, docs attempt 4, or self-approval.

## Constraints

- Worktree is `/Users/johnbaek/projects/Populus-m28/.claude/worktrees/m2-11`,
  branch `codex/m2-11-t0-finalize`, HEAD
  `7391d947f72cf408a173f1e7938102608b2269d4`, and fixed base
  `21340330a0fad7e9e39c1a9cec67656643621b05`; the real index is empty.
- Round-8 token is
  `sha256:55fa7f2c5e939060805992004ce9b157939af348fda11383ad246d695e2473a2`;
  adoption SHA-256 is
  `9e4ad77fe14da593094a4964703468280fc1b4a95231cb1a5789505198ea77c7`;
  token-file SHA-256 is
  `12e112e31e25a999055ff7498e9fc743df51438ee4f0e86547a7de6864e11796`;
  fingerprint is
  `327f0b589f75afd2fcf197d1835eaad22a23da4e1a60109e769a8d396ebceee5`.
- Round-8 approved-tree SHA-256 is
  `ef363a46ca4ed0ea05e9494bad9f254ae8526f25f5fe11ae30708604e2b10744`;
  tree OID is `d697803185c8da0b97658a627fc634fd8d2e536c`; and the tree has exactly 72
  changed paths.
- The sealed round-8 QA review SHA-256 is
  `622fd3c483958765001b2576946e6f112bd3f4c3a22ff17441dc1374ee54ebce`;
  its manifest SHA-256 is
  `d4da3465b133d361fae90afa6c02f3c2e96885b1f72a4d19147d6cd70f625dbf`;
  its final line is `VERDICT: CHANGES_REQUESTED`; and its only open blocker is
  F1.
- Round-7 sealed QA/docs/tree pins remain exactly those in the approved
  release-hygiene plan SHA-256
  `338c81697acf31c26ecf76b797febdadc7e293e1f3dbef315cf27c7e450e3289`.
- T0-v11 remains 63,400 bytes / 171 lines at SHA-256
  `7078a42934484c9c5ba7f975654476e0788c385dbaf8108c0d429a58ba91a453`.
- Snapshot remains 23,058,628,608 bytes, mode `0444`, sidecar-free, at SHA-256
  `977a4d249d92590a4de2961a3e9c7ff8cfa2e4846f0097ec7aa6c07f28124121`.
- Evidence is create-once, mode 0600/0700, append-only, never overwritten, and
  content-sensitive. Any repository source/test/doc repair invalidates round-8
  gate authority and requires the complete round-9 bundle.

## Current State

- Round 8 ran all 15 direct gates successfully and its bundle validates at the
  exact token above. No product or T0 drift was found.
- Independent round-8 QA sealed `CHANGES_REQUESTED` for one F1: the approved
  plan required a complete release-hygiene refusal/attempt-3 matrix, while the
  focused delta added only nine tests and did not execute those boundaries.
- The round-8 rejection is sealed at
  `/Users/johnbaek/projects/Populus-ops/snapshots/evidence/m2-11/qa-v9-finalization-round-8/qa-review.round-8.md`.
- Docs attempt 3 has not been created. The repository index remains empty; no
  PR, release variable, deployment, T0, or snapshot state changed.

## Detected Stack

- **Languages:** Python 3.12.13 and TypeScript/Astro on Node 24.16.0.
- **Python runner:** repository `.venv` with pytest; Make owns complete gates.
- **Node runner:** npm 11.13.0 and Node-native/Astro test/build commands.
- **Storage/publication:** SQLite/JSON1, signed static data, GitHub Actions.
- **Canonical gates:** the unchanged 15 commands listed under Testing Strategy.
- **Stack cache:** absent; manifests, lockfiles, Makefile, package scripts, and
  live tool versions were inspected directly.

## Reuse Map

| Need | Existing implementation | Locked reuse |
|---|---|---|
| mutation non-vacuity | test-local F4/F5 `EXPECTED_*_IDS` plus executed-ID equality | use the same independent-literal-oracle pattern with new F1-only constants; never derive expected IDs from production maps |
| byte comparator | `validate_release_hygiene_delta` and approved round-7 archive | add hermetic fixtures/tests around the existing validator; do not add a second comparator |
| schema routing | `validate_owner_decision`, `current_artifact_schemas` | extend only the new plan digest to v2 and exercise both relabel directions |
| round-7 predecessor | `validate_release_hygiene_predecessor` | test every existing path/digest/record/value/verdict branch; do not replace it |
| failed-QA retry | `validate_rejected_review_identity`, `validate_sealed_qa_review`, prior-round manifests | compose one exact round-8 F1 predecessor beside existing round-specific validators |
| docs attempt 3 | existing `seal-docs` release-hygiene special case | extend its exact plan-digest branch to round 9 and test the real transition |
| private staged tree | `compute_approved_tree` / `write_approved_tree` | retain implementation and test failure-before-output, success persistence, and real-index identity |
| release/deploy | approved release-hygiene rollout blocks | substitute only 74 paths, round-9 bundle/review/message names, and the new approved tree; preserve all fail-fast controls |

The reuse-first scan found one M2-11 evidence runner, one focused test module,
one private approved-tree implementation, one round-7 release predecessor, and
one release/deployment path. No parallel module or framework is justified.

## Architecture

### A. Independent locked F1 oracle

The test module defines literal, immutable tuples with no imports or derivation
from production dictionaries. `EXPECTED_RELEASE_F1_REFUSAL_IDS` contains exactly
136 IDs and `EXPECTED_RELEASE_F1_HAPPY_IDS` exactly 9 disjoint IDs:

| Family | Independent literal shape | Refusals | Happy |
|---|---|---:|---:|
| byte | 13 literal `(path,line)` targets × `missing-edit`, `extra-byte`, `tab-suffix`, `lossy-body` | 52 | 1 |
| owner-v2 | ten literal grammar malformations plus `v1-as-v2` and `v2-as-v1` | 12 | 2 |
| round7-docs | eight pinned files × path/digest, final message path/digest, five manifest records × path/digest, eight identity/verdict fields | 36 | 1 |
| round8-qa | six pinned files × path/digest, five identity fields, three verdict/finding fields, manifest output path/digest, plan/decision digest | 24 | 1 |
| docs-a3 | wrong round, unsealed QA, foreign approved predecessor, wrong prior-docs path, wrong resolution, generic-cycle bypass, attempt 4, occupied output | 8 | 1 |
| private-release | whitespace refusal, real-index mismatch, output-before-preflight, fingerprint drift | 4 | 2 |
| rollout | both standalone rollback fences execute in fresh hermetic zsh processes | 0 | 1 |
| **Total** |  | **136** | **9** |

One parametrized test records every executed ID in
`EXECUTED_RELEASE_F1_IDS`; a terminal test requires exact equality with the
145-ID union. Counts, target tuples, mutation names, pinned-record names, and
expected error classes are test-local literals. A missing production row cannot
shrink the oracle.

### B. Hermetic byte/schema fixtures

A temporary Git repository creates the eight old Markdown files with the exact
13 literal target positions, records the old tree, derives its deterministic
archive, then materializes the repaired candidate. Tests monkeypatch only the
external tree/digest/path constants and call the production
`validate_release_hygiene_delta`; they never mutate retained evidence or the
real repository. Every target executes the four mutations independently and
must fail. The happy case proves the exact repaired fixture.

Owner v2 tests call the real content validator/dispatcher through positional
paths. The literal malformations are spaced v1 date, missing/duplicate/wrong
date, empty authorization, missing/foreign controlling plan, verdict line,
CRLF, and missing final newline. Both cross-version relabels refuse; exact v1
historical and v2 current forms pass.

### C. Exact predecessor graphs

The round-7 docs predecessor tests use a hermetic copy/record fixture and the
real `validate_release_hygiene_predecessor`. The 36-ID table mutates every
declared pin, path, input-record path/digest, identity, and final verdict one at
a time; output evidence is never touched.

Add `validate_release_hygiene_f1_predecessor` for the exact sealed round-8 QA
rejection. It requires the exact bundle namespace, token/adoption/candidate/tree,
all 15 successful gate records, plan/decision, sealed review/manifest, round 8,
72 paths, fingerprint/tree OID, `CHANGES_REQUESTED`, and only open F1. It returns
the sealed review and manifest paths for the new adoption graph. The exact
resolution path is
`resolution-notes.finalization-r8-F1.md`, schema-valid with only
`## F1: resolved` plus factual markers for all six matrix families and 145 IDs.

### D. One round-9 cycle and docs attempt 3

Add cycle `finalization-release-hygiene-f1-exception` with:

- run ID `RUN-M2-11-QA-finalization-release-hygiene-F1-exception`;
- logical round/cap 9, explicit QA override true, and no round 10;
- strict owner-decision-v2 for only the new plan digest;
- exact sorted exception scope:
  `current-tree-adoption-instead-of-historical-pre-build-origin`,
  `owner-authorized-fifth-finalization-repair`,
  `owner-authorized-fourth-finalization-retry`,
  `owner-authorized-ninth-finalization-release-hygiene-f1-verification`,
  `owner-authorized-qa-docs-finalization-cycle`,
  `owner-authorized-release-hygiene-eighth-finalization`,
  `owner-authorized-seventh-finalization-f4-f5-repair`,
  `owner-authorized-sixth-finalization-f3-repair`, and
  `repo-local-custom-schema-validator`;
- exact 74-path QA/release equality and TD-QA-ORIGIN-10;
- exact sealed round-8 rejection and F1 resolution as `prior_round`;
- the unchanged 15 gates and no T0/full-corpus command.

After an independently APPROVED round-9 QA review is sealed, the exact new plan
digest permits docs attempt 3 to consume the existing sealed round-7 docs
attempt-2 APPROVED review and exact release-gate resolution. The final message
path is `final-docs-commit.finalization-r9-a3.md`, and output is
`docs-v9-finalization-r9-a3`. Attempt 4 and every generic APPROVED-predecessor
path refuse before output creation. A hermetic test executes the actual
round-9 seal-review → attempt-3 success path, not just argument parsing.

### E. Exact authority and report propagation

`EXPECTED_QA_PATHS == EXPECTED_RELEASE_PATHS` gains only the two new governance
artifacts and remains sorted/unique at 74. The generated bundle QA report and
repository Dev Notes/QA report must state round 8 rejected only F1, round 9 is
F1-verification-only, all locked case counts, no product/T0 change, TD1–TD10,
and pending outcomes. They may not claim round-9 QA/docs approval before it
exists.

## Locked Decisions

1. Round 8 is immutable rejected-QA provenance; it is never rerun or edited.
2. Expected mutation IDs are independent literals, not production-map products.
3. All 145 IDs execute; count-only or sampling evidence is insufficient.
4. The implementation remains in the existing runner and focused test file.
5. Round 9 reruns the complete unchanged 15-gate set; T0 is never invoked.
6. Docs attempt 3 remains globally next; attempt 4 and round 10 refuse.
7. Release/deployment controls stay byte-for-byte semantically unchanged except
   the new evidence paths and 74-path count.

## Alternatives Considered

- **Accept 723 passing tests:** rejected because they do not execute the plan's
  promised failure boundaries.
- **Add prose evidence only:** rejected because F1 requires executable,
  fail-if-removed coverage.
- **Derive expected IDs from production maps:** rejected as common-mode/vacuous.
- **Rerun round 8 or replace its evidence:** rejected by append-only semantics.
- **Run only focused tests:** rejected because source/test changes invalidate the
  complete QA bundle and require all 15 gates.
- **Change product code or T0:** rejected as unnecessary and unauthorized.

## Planned Files

| Path | Change |
|---|---|
| `docs/build/RUN-M2-11-QA-finalization-release-hygiene-F1-decision.md` | exact owner authority and prohibitions |
| `docs/build/RUN-M2-11-QA-finalization-release-hygiene-F1-plan.md` | this controlling plan |
| `scripts/build_m2_11_qa_bundle.py` | round-8 predecessor, round-9 cycle, resolution, docs-attempt-3 binding, 74 paths, TD10 |
| `tests/test_m2_11_qa_bundle.py` | independent 145-ID hermetic matrix and exact transition tests |
| `docs/build/RUN-M2-11-devnotes.md` | factual F1 rejection/repair/gate provenance |
| `docs/build/RUN-M2-11-qa-report.md` | factual coverage/debt/verdict propagation |

No other repository file is planned or writable.

## Implementation Tasks

- **T1 [R1,R4]:** Add the new plan/decision constants and approved digests,
  literal scope/run ID, exact round-8 evidence pins, strict v2 route, and one
  round-9-only cycle branch.
- **T2 [R2,R3]:** Add the independent 145-ID literal oracle and hermetic
  byte/schema fixtures; implement all 52 byte and 12 owner-schema refusals plus
  three happy paths.
- **T3 [R2,R4]:** Add hermetic mutation cases for all 36 round-7 predecessor and
  24 round-8 predecessor boundaries; compose the exact sealed round-8 F1
  validator and resolution without duplicating existing parsers.
- **T4 [R2,R5]:** Add the eight docs-attempt refusals, real attempt-3 happy path,
  four private/release refusals, two private happy paths, and one fresh-process
  rollout case that executes both standalone rollback fences with hermetic Git/
  GitHub stubs, all with output-absence/index-preservation assertions.
- **T5 [R6]:** Extend exact path equality to 74, phase/adoption manifests to
  round 9/cap 9, generated QA markers to TD1–TD10, and public validation to the
  exact new cycle; refuse round 10.
- **T6 [R7]:** Update Dev Notes and repository QA report factually, declare TD10,
  remove the unsupported no-gap claim, and record actual focused/gate results
  only after they run.
- **T7 [R6,R7]:** Create the exact F1 resolution and round-9 final-message
  artifacts, preflight pins/absence/index/scope, invoke round 9 once, validate
  its token/manifests, and never invoke T0.
- **T8 [R5,R7]:** Obtain/seal independent QA; only approval enters docs attempt
  3 and docs review; only both approvals enter exact staging, fixed-base PR/
  merge, and supervised deployment.

## Testing Strategy

Focused preflight:

```bash
PYTHONDONTWRITEBYTECODE=1 .venv/bin/python -m pytest -q tests/test_m2_11_qa_bundle.py
git diff --check
```

The create-once round-9 runner executes exactly these unchanged 15 commands:

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

Every direct gate has its own log/exit record and identical pre/post worktree
fingerprint. No command includes T0, snapshot mutation, or full-corpus work.
The focused rollout case extracts the two standalone rollback fences from this
plan and runs each through a fresh `zsh -c 'set -euo pipefail; …'` process with
an empty inherited-variable allowlist, a temporary Git repository, a synthetic
approved-tree/docs manifest, and PATH-local `gh`/validator stubs. It asserts the
staged path is restored, pre-stage validation is reached, both release variables
are deleted, the non-negated variable list is read, and an omitted local
declaration makes the harness fail.

## Verification Matrix

| Requirement | Executable proof |
|---|---|
| R1 | exact authority/scope/run-ID/schema/digest test; round9/no10 refusal |
| R2 | independent 136+9 ID counts, disjointness, parametrized execution, final equality |
| R3 | 52 byte mutations, 12 owner/schema refusals, 3 happy paths |
| R4 | 36 round-7 and 24 round-8 predecessor refusals plus two real happy validations |
| R5 | eight attempt-3 refusals, actual attempt-3 success, private-index/output/index guards, both rollback fences executed in fresh hermetic zsh processes |
| R6 | exact 74 paths; manifest cap/override; generated TD1–TD10 report; 15 fresh gate records; no T0 |
| R7 | Dev Notes/QA report schema and factual assertions; sealed QA/docs; exact-tree release and functional deployment |

## Rollout / Rollback

After plan approval and implementation, one supervised `zsh` runs every block
with `set -euo pipefail`; no stopped shell is resumed. New targets must be
absent before their create-once commands:

```bash
set -euo pipefail
root=/Users/johnbaek/projects/Populus-ops/snapshots/evidence/m2-11
qa_bundle="$root/qa-v9-finalization-round-9"
qa_review="$root/qa-review.finalization-r9.canonical.md"
docs_bundle="$root/docs-v9-finalization-r9-a3"
docs_review="$root/docs-review.finalization-r9-a3.canonical.md"
final_message="$root/final-docs-commit.finalization-r9-a3.md"
PYTHONDONTWRITEBYTECODE=1 .venv/bin/python scripts/build_m2_11_qa_bundle.py run \
  --cycle finalization-release-hygiene-f1-exception --round 9 \
  --final-docs-commit "$final_message" \
  --prior-review "$root/qa-v9-finalization-round-8/qa-review.round-8.md" \
  --resolution-notes "$root/resolution-notes.finalization-r8-F1.md" \
  --output "$qa_bundle"
PYTHONDONTWRITEBYTECODE=1 .venv/bin/python scripts/build_m2_11_qa_bundle.py validate \
  --bundle "$qa_bundle"
```

On a gate or QA rejection, preserve evidence and stop; no round 10 exists. Only
an independent exact `APPROVED` review may continue:

```bash
set -euo pipefail
PYTHONDONTWRITEBYTECODE=1 .venv/bin/python scripts/build_m2_11_qa_bundle.py seal-review \
  --bundle "$qa_bundle" --review "$qa_review"
sealed_qa="$qa_bundle/qa-review.round-9.md"
test "$(tail -n 1 "$sealed_qa")" = 'VERDICT: APPROVED'
PYTHONDONTWRITEBYTECODE=1 .venv/bin/python scripts/build_m2_11_qa_bundle.py seal-docs \
  --bundle "$qa_bundle" --qa-review "$sealed_qa" \
  --final-docs-commit "$final_message" --attempt 3 \
  --prior-docs-review "$root/docs-v9-finalization-r7-a2/docs-review.attempt-2.md" \
  --resolution-notes "$root/resolution-notes.finalization-r7-release.md" \
  --output "$docs_bundle"
PYTHONDONTWRITEBYTECODE=1 .venv/bin/python scripts/build_m2_11_qa_bundle.py seal-docs-review \
  --docs-bundle "$docs_bundle" --review "$docs_review"
test "$(tail -n 1 "$docs_bundle/docs-review.attempt-3.md")" = 'VERDICT: APPROVED'
```

Only that docs approval permits exact staging. The approved tree supplies the
74 path names; the real index is checked and restorable:

```bash
set -euo pipefail
PYTHONDONTWRITEBYTECODE=1 .venv/bin/python scripts/build_m2_11_qa_bundle.py validate-release \
  --docs-bundle "$docs_bundle" --mode pre-stage
docs_manifest="$docs_bundle/docs-review-input.manifest.json"
approved_tree=$(jq -er '.inputs[]|select(.name=="final-docs-tree")|.path' "$docs_manifest")
expected_names=$(mktemp)
actual_names=$(mktemp)
cached_names=$(mktemp)
jq -e '.schema_version=="approved-tree/v1" and (.expected_paths|length==74)' "$approved_tree"
jq -r '.expected_paths[]' "$approved_tree" | LC_ALL=C sort -u > "$expected_names"
test "$(wc -l < "$expected_names" | tr -d ' ')" = 74
{ git diff --name-only HEAD; git ls-files --others --exclude-standard; } | LC_ALL=C sort -u > "$actual_names"
diff -u "$expected_names" "$actual_names"
while IFS= read -r release_path; do git add -- "$release_path"; done < "$expected_names"
git diff --cached --name-only | LC_ALL=C sort -u > "$cached_names"
diff -u "$expected_names" "$cached_names"
test -z "$(git diff --name-only)"
test -z "$(git ls-files --others --exclude-standard)"
git diff --cached --check
test "$(git write-tree)" = "$(jq -er .tree_oid "$approved_tree")"
PYTHONDONTWRITEBYTECODE=1 .venv/bin/python scripts/build_m2_11_qa_bundle.py validate-release \
  --docs-bundle "$docs_bundle" --mode post-stage
```

If any pre-commit command fails after staging, a fresh fail-fast shell runs:

```bash
set -euo pipefail
root=/Users/johnbaek/projects/Populus-ops/snapshots/evidence/m2-11
docs_bundle="$root/docs-v9-finalization-r9-a3"
docs_manifest="$docs_bundle/docs-review-input.manifest.json"
approved_tree=$(jq -er '.inputs[]|select(.name=="final-docs-tree")|.path' "$docs_manifest")
expected_names=$(mktemp)
trap 'rm -f "$expected_names"' EXIT
jq -r '.expected_paths[]' "$approved_tree" | LC_ALL=C sort -u > "$expected_names"
test "$(wc -l < "$expected_names" | tr -d ' ')" = 74
while IFS= read -r release_path; do git restore --staged -- "$release_path"; done < "$expected_names"
test -z "$(git diff --cached --name-only)"
PYTHONDONTWRITEBYTECODE=1 .venv/bin/python scripts/build_m2_11_qa_bundle.py validate-release \
  --docs-bundle "$docs_bundle" --mode pre-stage
```

The reviewed message and fixed-base PR use the already approved zero-remote-check
contract:

```bash
set -euo pipefail
final_artifact=$(jq -er '.inputs[]|select(.name=="final-docs-commit")|.path' "$docs_manifest")
test "$(shasum -a 256 "$final_artifact" | awk '{print "sha256:"$1}')" = \
  "$(jq -er '.inputs[]|select(.name=="final-docs-commit")|.digest' "$docs_manifest")"
commit_message=$(mktemp)
chmod 600 "$commit_message"
{ sed -n 's/^COMMIT_MESSAGE:[[:space:]]*//p' "$final_artifact"; printf '\n'; sed '/^COMMIT_MESSAGE:/d' "$final_artifact"; } > "$commit_message"
git commit -F "$commit_message"
release_commit=$(git rev-parse HEAD)
test -z "$(git status --porcelain=v1)"
release_repo=johnbaekk-spec/populus
release_base=$(jq -er .base_ref "$docs_manifest")
test "$release_base" = 21340330a0fad7e9e39c1a9cec67656643621b05
git fetch origin main
test "$(git rev-parse origin/main)" = "$release_base"
git push --set-upstream origin codex/m2-11-t0-finalize
pr_title=$(sed -n '1p' "$commit_message")
pr_url=$(gh pr create --repo "$release_repo" --base main --head codex/m2-11-t0-finalize \
  --title "$pr_title" --body 'Owner-authorized M2-11 completion. Independent plan, QA, and docs reviews approved the exact 74-path cumulative tree; complete local gates and supervised deployment are required.')
test "$(gh pr view "$pr_url" --json headRefOid --jq .headRefOid)" = "$release_commit"
test "$(gh pr view "$pr_url" --json baseRefOid --jq .baseRefOid)" = "$release_base"
test "$(gh api "repos/$release_repo/commits/$release_commit/check-runs" --jq .total_count)" -eq 0
test "$(gh api "repos/$release_repo/commits/$release_commit/status" --jq '.statuses|length')" -eq 0
test "$(gh pr view "$pr_url" --json statusCheckRollup --jq '.statusCheckRollup|length')" -eq 0
git fetch origin main
test "$(git rev-parse origin/main)" = "$release_base"
gh pr merge "$pr_url" --squash --match-head-commit "$release_commit"
test "$(gh pr view "$pr_url" --json state --jq .state)" = MERGED
merge_sha=$(gh pr view "$pr_url" --json mergeCommit --jq .mergeCommit.oid)
git fetch origin main
test "$(git rev-parse origin/main)" = "$merge_sha"
```

Before merge, failure closes and reads back the exact open PR; after merge the
approved release-hygiene plan's secure-runner preflight, exact v2 index/shard/
filer functional verification, `jq -er 'first(...)'` selector, signature/source/
schema bindings, and variable readbacks execute unchanged. The executable PR
rollback remains:

```bash
set -euo pipefail
release_repo=johnbaekk-spec/populus
open_count=$(gh pr list --repo "$release_repo" --state open --head codex/m2-11-t0-finalize --json url --jq length)
case "$open_count" in
  0) ;;
  1) rollback_pr=$(gh pr list --repo "$release_repo" --state open --head codex/m2-11-t0-finalize --json url --jq '.[0].url'); gh pr close "$rollback_pr" --repo "$release_repo"; test "$(gh pr view "$rollback_pr" --repo "$release_repo" --json state --jq .state)" = CLOSED ;;
  *) echo 'multiple open release PRs; STOP' >&2; exit 1 ;;
esac
test "$(gh pr list --repo "$release_repo" --state open --head codex/m2-11-t0-finalize --json url --jq length)" = 0
```

On deployment mutation/verification failure, preserve the run and disarm with a
non-negated readback before the approved signed-pointer/runbook rollback:

```bash
set -euo pipefail
release_repo=johnbaekk-spec/populus
gh variable delete POPULUS_SELFHOSTED_VALIDATED --repo "$release_repo" 2>/dev/null || :
gh variable delete POPULUS_INST_DB --repo "$release_repo" 2>/dev/null || :
remaining_release_vars=$(gh variable list --repo "$release_repo" --json name --jq '[.[].name|select(.=="POPULUS_INST_DB" or .=="POPULUS_SELFHOSTED_VALIDATED")]|sort|join(",")')
test -z "$remaining_release_vars"
```

## Simplicity Audit

Two governance files establish the new authority. Existing runner changes are
limited to constants/pins, one exact predecessor composition, one resolution,
one digest-scoped round-9 branch, one docs-attempt-3 extension, 74 paths, and
TD10/report markers. Tests stay in the one focused module and reuse its literal
oracle/fixture helpers. No product file, implementation module, dependency,
generic schema, route, command framework, or alternate release path is added.

## Tech Debt Introduced

**TD-QA-ORIGIN-10 — F1 verification matrix and ninth finalization round.**
Impact: the release-specific bridge gains one exact sealed round-8 F1
predecessor, one independent 145-case test oracle, one round-9 authority branch,
and one attempt-3 transition proof. Controls: exact paths/digests/IDs, all 15
gates, independent QA/docs, no product import, no round 10/attempt 4. Removal:
delete TD1–TD10 and the run-specific runner/tests when the generic harness owns
typed retry provenance and mandatory negative-test matrices.

Existing TD1–TD9, eager-build debt, reservation disclosure, and npm advisories
remain visible. No hidden product, dependency, security, timeout, snapshot, T0,
or deployment debt is introduced.

## Memory Touch-Points

The exact selector was
`/Users/johnbaek/projects/orchestrate-tool/lib/memory-select.sh
/Users/johnbaek/.claude/projects/-Users-johnbaek/memory/MEMORY.md release hygiene
verification mutation predecessor attempt docs QA`. Its deterministic top ten,
in returned order, were read in full:

- `feedback_qa_remediation_discipline.md`: repair the executable artifact, rerun
  complete gates, and await independent review.
- `feedback_qa_fail_batch_remediation.md`: batch the single finding and never
  self-sign.
- `feedback_ascii_verification_byte_scan.md`: make byte-level validation
  deterministic rather than relying on text grep.
- `feedback_cloud_routine_verification_boundaries.md`: distinguish execution
  evidence from functional output evidence.
- `feedback_deploy_verification.md`: retain exact runtime functional probes and
  explicit rollback/readback.
- `feedback_doc_drift_multisource.md`: reconcile counts and claims across code,
  tests, Dev Notes, and QA report.
- `feedback_live_system_self_heal_verification.md`: avoid unnecessary mutation
  when retained evidence/state is already stable.
- `feedback_orchestrate_workflow.md`: keep the repair isolated on the existing
  feature branch and never bypass review checkpoints.
- `feedback_plan_anchor_verification.md`: recheck every cited runner/test/evidence
  anchor against the live tree.
- `feedback_plan_hygiene.md`: provide exact scope, commands, debt, traceability,
  and failure sweep.

The complete shared failure-mode catalog was also read and applied.

## Failure-Mode Sweep

| Failure mode | Prevention / executable proof |
|---|---|
| common-mode shrink/vacuous parametrization | independent literal 145-ID oracle, fixed counts, final executed-set equality |
| missing/extra/tab/lossy byte edit | every literal target × four mutations through production comparator |
| owner schema drift/relabel | ten malformed forms, both relabel directions, two schema happy paths |
| stale/substituted predecessor | every round-7 and round-8 path/digest/record/value/verdict branch mutates independently |
| source repair with stale gates | create-once round 9 reruns all 15 gates against one fingerprint |
| output consumed on refusal | preflight-before-mkdir assertions for run, seal-review, seal-docs, and private tree |
| real index corruption | before/after digest equality on private success/refusal and explicit restoration block |
| attempt/round overrun | exact round9/no10 and attempt3/no4 cases |
| shell pipeline false success | `set -euo pipefail`, single-process `jq first(...)`, no `head` pipeline |
| PR/release rollback omission | exact empty-index, PR close/readback, and non-negated variable-list fences execute in fresh hermetic zsh processes with no inherited variables |
| secret leakage | unchanged scrubbers/security gate; no credentials in artifacts or commands |
| liveness-only deployment | unchanged real v2 index/shard/reassembly/filer-page/signature functional checks |

## Definition of Done

- **R1:** exact decision/plan digests, scope, run ID, v2 route, round/cap 9, and
  no-round-10 refusal validate.
- **R2:** 136 refusal and 9 happy IDs are disjoint, execute individually, and
  equal the final executed set exactly.
- **R3:** all 52 byte and 12 schema refusals plus exact v1/v2 happy forms pass.
- **R4:** all 36 round-7 and 24 round-8 predecessor refusals plus real immutable
  happy validations pass; only sealed round-8 F1 enters round 9.
- **R5:** actual attempt-3 success and all eight refusals pass before output;
  private index, rollback, PR, variable, and selector guards are executable.
- **R6:** exact 74-path candidate, current manifests/token, TD1–TD10 report, and
  all 15 fresh gate logs validate; T0/snapshot hashes remain unchanged.
- **R7:** Dev Notes/QA report are factual; independent QA and docs review both
  approve and are sealed before exact-tree release; fixed-base PR merges and
  supervised functional deployment succeeds or stops at the explicit secure
  operational boundary without claiming deployment.
