# RUN M2-11 — Consolidated Finalization Closeout / QA Round 10 Plan (plan-v1)

## Goal and Success Criteria

Close RUN M2-11 with one final, consolidated logical QA round 10. Bind the exact
round-9 gate-2 failure, correct only its stale command assertion and factual
evidence, preserve every product and T0 byte, rerun the unchanged 15 gates once,
obtain independent QA and docs review, then create the fixed-base PR and perform
the already approved supervised deployment.

Success is one exact 76-path candidate, a green complete focused test file, all 15 round-10 gates
at exit zero with one fingerprint, independent QA approval, docs-attempt-3
approval, exact staging/PR/merge, and functional Institutional data on
publicfilings.org. No round 11 exists. This plan permits release only after
normal round-10 QA approval. Any failure ends this plan and the bundle loop; an
owner-waived simplified release would require a separate explicit addendum that
does not claim compliance with the approval-only QA/docs transport.

## Requirements

- **R1 — Exact final authority.** Use the literal run ID
  `RUN-M2-11-QA-finalization-closeout-exception`, the literal sorted exception
  scope in Architecture A, logical round/cap 10, strict `owner-decision-v2`, and
  refuse every round other than 10.
- **R2 — Exact failed round-9 predecessor.** Require the create-once
  `qa-v9-finalization-round-9` namespace, its exact two-entry ledger, one passing
  `diff-check`, one failing `recovery-tests`, shared fingerprint, exact log
  digests, F1 plan/decision, 74-path inputs, and a one-finding resolution. Reject
  missing, extra, reordered, relabeled, path-substituted, digest-mutated, or
  wrong-exit evidence.
- **R3 — Minimal frozen implementation.** Change only the existing M2-11
  evidence runner, focused test, Dev Notes, QA report, and this plan/decision.
  Add the two governance files to the exact sorted QA/release inventory (76
  paths). Product and T0 bytes remain equal to round 8.
- **R4 — One consolidated round 10.** Add one digest-scoped cycle branch, exact
  failed-gate resolution, TD-QA-ORIGIN-11, the unchanged 15 direct gates, exact
  manifests/token/tree, attempt 3, and universal round-11 refusal. No T0 or
  full-corpus command may run. Update all four multi-digit docs consumers:
  `finalization_docs_attempts`, `validate_sealed_docs_review`, `seal-docs-review`,
  and `validate-release`; accept historical rounds 1–9 plus exact round 10 while
  refusing round 11 and malformed namespaces.
- **R5 — Independent decision and bounded stop.** Submit the complete round-10
  bundle to the existing independent reviewer. Only `VERDICT: APPROVED` proceeds.
  Any gate/review rejection is preserved and ends this plan without round 11.
- **R6 — Direct docs and release.** On exact QA approval,
  produce docs attempt 3, obtain independent docs review, validate the same
  76-path tree, stage exactly that tree, create/merge the fixed-base PR, run the
  supervised publish workflow, verify signed Institutional index/shard/page
  function, and arm schedules only after functional success.
- **R7 — Final stop discipline.** Preserve all prior evidence append-only. No
  round 11, docs attempt 4, product repair, T0 rerun, relaxed limit, hidden debt,
  or liveness-only deployment proof is authorized.

## Scope

Authorized repository writes are exactly:

1. `docs/build/RUN-M2-11-QA-finalization-closeout-decision.md`
2. `docs/build/RUN-M2-11-QA-finalization-closeout-plan.md`
3. `docs/build/RUN-M2-11-devnotes.md`
4. `docs/build/RUN-M2-11-qa-report.md`
5. `scripts/build_m2_11_qa_bundle.py`
6. `tests/test_m2_11_qa_bundle.py`

Authorized external outputs are one exact round-9 gate-2 resolution, one
round-10 final-message artifact, one `qa-v9-finalization-round-10/` bundle and
review/seal, one `docs-v9-finalization-r10-a3/` bundle and review/seal, and the
create-once `deploy-run.finalization-r10.json` dispatch identity. No prior
artifact may be overwritten.

## Non-goals

- No product, dashboard, aggregate, serving, payload, route, schema, publication,
  workflow, runbook, acceptance, dependency, security, or resource change.
- No edit or rerun of T0-v11 or the immutable source snapshot.
- No rewrite/reseal of rounds 1–9 or docs attempts 1–2.
- No generic orchestration framework, second runner, new dependency, round 11,
  docs attempt 4, self-review, or automatic waiver.

## Constraints

- Worktree: `/Users/johnbaek/projects/Populus-m28/.claude/worktrees/m2-11`;
  branch `codex/m2-11-t0-finalize`; HEAD
  `7391d947f72cf408a173f1e7938102608b2269d4`; fixed base
  `21340330a0fad7e9e39c1a9cec67656643621b05`; real index empty.
- T0-v11 remains SHA-256
  `7078a42934484c9c5ba7f975654476e0788c385dbaf8108c0d429a58ba91a453`;
  snapshot remains SHA-256
  `977a4d249d92590a4de2961a3e9c7ff8cfa2e4846f0097ec7aa6c07f28124121`,
  23,058,628,608 bytes, mode 0444, sidecar-free.
- Round-9 ledger SHA-256 is
  `d8c6de8607ca3d0fb57f4e7e1896dd7528bf9265ce92b3b8c58beb20642db6e3`;
  its fingerprint is
  `d1e54262f690a499f9e04b2babaf9ac4a374869b99b6b31e46f582f983f4faeb`.
  `diff-check` exited 0 with empty-log SHA-256
  `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`;
  `recovery-tests` exited 1 with log SHA-256
  `ad269d27d885ef78a76d0acbaa12d89417a5747fd487838e34b33491cf9df924`.
- Before the two closeout governance files were added, the focused file passed
  870 tests. On the current preimplementation 76-path tree it intentionally
  fails the retained 74-path private-tree assertion with 869 passed. The failed
  round-9 log itself contains exactly one pytest failure: the stale
  `test_devnotes_publish_only_authoritative_release_hygiene_round_eight_command`;
  869 tests passed. Implementation must update the exact inventory/private-tree
  proof and obtain a green full focused preflight before consuming round 10.
- The F1 plan/decision remain pinned at
  `da6f13b9968468c4c49506bcff4ca70e75d87c17b2d39d71fa490373f7c52213`
  and `fa564bcafa0b1f9991ee9468fecd6ae57b982ad64e6ec2fee629c8587a246fe6`.

## Current State

- Product QA round 3 approved the product candidate; T0-v11 passed once.
- Round 7 QA and docs attempt 2 approved the same 70-path tree.
- Round 8 ran all 15 gates; independent QA rejected only missing hermetic
  evidence coverage. The F1 repair now passes all 145 locked cases.
- Round 9 passed gate 1 and stopped at gate 2 on one stale documentation-command
  assertion. That assertion is fixed; adding this plan/decision exposes the
  expected retained 74-vs-76 private-tree assertion until T1 updates it.
- No product, T0, security, publication, or deployment finding is open.

## Detected Stack

- **Languages:** Python 3.12.13 and TypeScript/Astro on Node 24.16.0.
- **Runners:** repository `.venv`/pytest, npm 11.13.0, Make-owned gates.
- **Storage/publication:** SQLite/JSON1, signed static artifacts, GitHub Actions.
- **Tests:** pytest, Node native test runner, Astro check/build.
- **Stack cache:** absent; manifests and live runners were inspected directly.

## Reuse Map

| Need | Existing authority reused |
|---|---|
| failed-gate transport | `validate_failed_gate_predecessor`, round-2/3 failed-ledger branches |
| exact current state | `validate_fixed_state`, `worktree_fingerprint`, exact path tuples |
| bundle/run | existing `run`, ledger, tree, token, adoption, and phase-manifest writers |
| QA/docs sealing | existing `seal-review`, `seal-docs`, `seal-docs-review` |
| release/deploy | approved F1-plan fixed-base staging, PR, runner, functional verifier, rollback |

Repository scan found no alternate M2-11 runner or release path. Extending the
single runner is smaller and safer than creating another harness.

## Architecture

### A. Literal authority

Run ID: `RUN-M2-11-QA-finalization-closeout-exception`.

Sorted exception scope:

1. `approval-only-round10-qa-docs-release`
2. `exact-failed-round9-gate2-predecessor`
3. `frozen-product-and-t0`
4. `no-docs-attempt4`
5. `owner-authorized-consolidated-round10`
6. `same-15-gates`
7. `single-round10`
8. `stale-devnotes-command-assertion-only`

### B. Exact round-9 predecessor

Add `validate_finalization_closeout_predecessor` using the existing failed-gate
helper surfaces. It validates the literal bundle path; exact plan, decision,
Dev Notes, QA report, changed-files, baseline diff, preservation, isolated-
feature and external-state artifacts; the exact two ledger records and logs;
shared fingerprint; fixed base; failure count/name; and absence of later gate,
candidate, token, adoption, or review artifacts. The exact resolution contains
only `## gate-recovery-tests: resolved` and the stale-assertion/frozen-product
facts. Mutation tests cover every pin, path, record, exit/status, fingerprint,
log digest, failure name/count, extra entry, and forbidden later artifact.

### C. Round 10 and approval-only stop

Cycle `finalization-closeout-exception` accepts only round 10, the exact
predecessor, and exact resolution. It generates 76-path evidence, cap 10 with
owner override, TD1–TD11, the unchanged gate list, and universal round-11
refusal. Normal approval is sealed conventionally.

Only a sealed round-10 `VERDICT: APPROVED` enters docs attempt 3. A failed gate or
rejected review is preserved and stops this plan. The owner's no-round-11 waiver
is intentionally not implemented inside the approval-only bridge; if needed, it
must be an honest separate simplified-release addendum.

### D. Release

After QA approval, use the literal same-tree docs seal and release commands below,
pre/post-stage validation, fixed-base PR, merged-main assertions, runner
provisioning, deterministic workflow watch, signature checks, v2 index/shard and
real filer-page payload verification, rollback, and delayed schedule arming.

### E. Complete round-bearing consumer map

The implementation changes every current single-digit namespace consumer and no
others: `finalization_docs_attempts` discovery, `validate_sealed_docs_review`,
`seal-docs-review`, and `validate-release`. Tests execute a real round-10 attempt-3
success through QA seal, docs seal, docs-review seal, pre-stage validation, and
post-stage validation; historical rounds remain accepted and round 11 plus
zero-padded/malformed names refuse.

## Locked Decisions

1. Exactly one round-10 attempt; no round 11.
2. Product and T0 remain byte-frozen.
3. The round-9 failure is preserved and transported, not erased or rerun.
4. Only sealed round-10 QA approval can enter docs review under this plan.
5. Functional Institutional verification—not liveness—controls deployment.
6. Docs attempt remains 3; no attempt 4.

## Alternatives Considered

- Rerun/overwrite round 9: rejected by append-only evidence semantics.
- Start an open-ended new QA loop: rejected by explicit owner cap.
- Deploy immediately without one clean attempt: rejected because the stale test
  changed after failed evidence and current gates deserve one consolidated run.
- Embed a rejected-QA waiver in this runner: rejected because QA/docs transport
  is approval-only; any future simplified-release addendum must be explicit.

## Planned Files

| Path | Planned change |
|---|---|
| `docs/build/RUN-M2-11-QA-finalization-closeout-decision.md` | exact owner authority and approval-only stop boundary |
| `docs/build/RUN-M2-11-QA-finalization-closeout-plan.md` | executable final closeout contract |
| `docs/build/RUN-M2-11-devnotes.md` | factual round-9/10, debt, QA/docs/release state |
| `docs/build/RUN-M2-11-qa-report.md` | factual coverage, gates, findings, debt, outcome |
| `scripts/build_m2_11_qa_bundle.py` | predecessor, 76 paths, round10/no11, seals |
| `tests/test_m2_11_qa_bundle.py` | non-vacuous predecessor/cycle/docs/release tests |

## Implementation Tasks

- **T1 [R1,R3]:** Add the exact decision/plan pins, 76-path sorted inventory,
  literal run ID/scope, strict owner-v2 route, TD11, and no-round-11 boundary.
- **T2 [R2]:** Implement the exact round-9 failed-gate predecessor and resolution;
  test every pin/record/ledger/log/failure/absence boundary and a real happy path.
- **T3 [R4,R7]:** Add only the round-10 cycle/manifest/report branch; test exact
  predecessor entry, cap/override, round10/no11, create-once failure atomicity,
  absence of T0/full-corpus commands, and every four-item multi-digit consumer.
- **T4 [R5]:** Extend QA/docs sealing only for normal round-10 approval; prove
  failed/rejected, round-11, and malformed namespaces refuse before output.
- **T5 [R3,R6]:** Update Dev Notes and QA report, rerun focused verification,
  create external resolution/message, preflight immutability/index/absence, and
  execute round 10 once.
- **T6 [R5,R6]:** Obtain independent QA; only on approval, seal docs
  attempt 3, obtain independent docs review, and refuse stale/different trees.
- **T7 [R6,R7]:** Validate release pre/post-stage, commit exact inventory, create
  and merge fixed-base PR, deploy supervised, verify functional Institutional
  data/signatures, then arm schedules. Add hermetic deploy-record tests proving
  a pre-existing target stops before variable mutation/dispatch, a publication
  collision never overwrites, partial/malformed records refuse, and successful
  readback binds the watched run ID, URL, conclusion, and merge SHA.

## Testing Strategy

Preflight:

```bash
git diff --check
PYTHONDONTWRITEBYTECODE=1 .venv/bin/python -m pytest -q tests/test_m2_11_qa_bundle.py
```

The focused file includes named hermetic deploy-record lifecycle cases: a
pre-existing target refuses before variable mutation or dispatch; a publication
collision does not overwrite; failed/partial temporary creation leaves no final
record; malformed, extra-key, wrong-type, wrong-run, wrong-URL, and wrong-merge
records refuse; and one exact watched run/URL/conclusion/merge readback succeeds.

Round 10 executes the unchanged 15 commands:

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

## Verification Matrix

| Requirement | Executable proof |
|---|---|
| R1 | exact quote/date/plan/run/scope/cap; round10 happy and all other rounds refuse |
| R2 | independent literal predecessor mutation IDs plus real round-9 happy validation |
| R3 | exact 76 paths and six-path current delta; product/T0 byte-equality proof |
| R4 | 15 fresh ledger records, one fingerprint, valid token/manifests, no T0 command |
| R5 | approved path succeeds; failed/rejected/round11 paths refuse without output |
| R6 | real seal-review/docs attempt 3, same tree, PR/run/deploy readbacks; deploy-record pre-existing/collision/partial/malformed refusals and exact successful readback |
| R7 | round11/attempt4 refusal, append-only evidence, deploy-record collision/no-overwrite and partial-output refusal, failure-mode sweep |

## Rollout / Rollback

Create-once round 10:

```bash
set -euo pipefail
root=/Users/johnbaek/projects/Populus-ops/snapshots/evidence/m2-11
qa_bundle="$root/qa-v9-finalization-round-10"
final_message="$root/final-docs-commit.finalization-r10-a3.md"
test ! -e "$qa_bundle"
PYTHONDONTWRITEBYTECODE=1 .venv/bin/python scripts/build_m2_11_qa_bundle.py run \
  --cycle finalization-closeout-exception --round 10 \
  --final-docs-commit "$final_message" \
  --prior-gate-bundle "$root/qa-v9-finalization-round-9" \
  --resolution-notes "$root/resolution-notes.finalization-r9-gate2.md" \
  --output "$qa_bundle"
PYTHONDONTWRITEBYTECODE=1 .venv/bin/python scripts/build_m2_11_qa_bundle.py validate \
  --bundle "$qa_bundle"
```

Any gate failure preserves the bundle. No rerun and no round 11. Only the exact
independent approval path below continues:

```bash
set -euo pipefail
root=/Users/johnbaek/projects/Populus-ops/snapshots/evidence/m2-11
qa_bundle="$root/qa-v9-finalization-round-10"
qa_review="$root/qa-review.finalization-r10.canonical.md"
docs_bundle="$root/docs-v9-finalization-r10-a3"
docs_review="$root/docs-review.finalization-r10-a3.canonical.md"
final_message="$root/final-docs-commit.finalization-r10-a3.md"
PYTHONDONTWRITEBYTECODE=1 .venv/bin/python scripts/build_m2_11_qa_bundle.py seal-review \
  --bundle "$qa_bundle" --review "$qa_review"
sealed_qa="$qa_bundle/qa-review.round-10.md"
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

Only that docs approval permits the exact 76-path staging operation:

```bash
set -euo pipefail
root=/Users/johnbaek/projects/Populus-ops/snapshots/evidence/m2-11
docs_bundle="$root/docs-v9-finalization-r10-a3"
PYTHONDONTWRITEBYTECODE=1 .venv/bin/python scripts/build_m2_11_qa_bundle.py validate-release \
  --docs-bundle "$docs_bundle" --mode pre-stage
docs_manifest="$docs_bundle/docs-review-input.manifest.json"
approved_tree=$(jq -er '.inputs[]|select(.name=="final-docs-tree")|.path' "$docs_manifest")
expected_names=$(mktemp)
actual_names=$(mktemp)
cached_names=$(mktemp)
trap 'rm -f "$expected_names" "$actual_names" "$cached_names"' EXIT
jq -e '.schema_version=="approved-tree/v1" and (.expected_paths|length==76)' "$approved_tree"
jq -r '.expected_paths[]' "$approved_tree" | LC_ALL=C sort -u > "$expected_names"
test "$(wc -l < "$expected_names" | tr -d ' ')" = 76
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

If any pre-commit command fails, a fresh shell reconstructs state and restores
the empty index:

```bash
set -euo pipefail
root=/Users/johnbaek/projects/Populus-ops/snapshots/evidence/m2-11
docs_bundle="$root/docs-v9-finalization-r10-a3"
docs_manifest="$docs_bundle/docs-review-input.manifest.json"
approved_tree=$(jq -er '.inputs[]|select(.name=="final-docs-tree")|.path' "$docs_manifest")
expected_names=$(mktemp)
trap 'rm -f "$expected_names"' EXIT
jq -r '.expected_paths[]' "$approved_tree" | LC_ALL=C sort -u > "$expected_names"
test "$(wc -l < "$expected_names" | tr -d ' ')" = 76
while IFS= read -r release_path; do git restore --staged -- "$release_path"; done < "$expected_names"
test -z "$(git diff --cached --name-only)"
PYTHONDONTWRITEBYTECODE=1 .venv/bin/python scripts/build_m2_11_qa_bundle.py validate-release \
  --docs-bundle "$docs_bundle" --mode pre-stage
```

The reviewed message and zero-remote-check fixed-base PR are literal:

```bash
set -euo pipefail
release_repo=johnbaekk-spec/populus
root=/Users/johnbaek/projects/Populus-ops/snapshots/evidence/m2-11
docs_bundle="$root/docs-v9-finalization-r10-a3"
docs_manifest="$docs_bundle/docs-review-input.manifest.json"
final_artifact=$(jq -er '.inputs[]|select(.name=="final-docs-commit")|.path' "$docs_manifest")
test "$(shasum -a 256 "$final_artifact" | awk '{print "sha256:"$1}')" = \
  "$(jq -er '.inputs[]|select(.name=="final-docs-commit")|.digest' "$docs_manifest")"
commit_message=$(mktemp)
chmod 600 "$commit_message"
{ sed -n 's/^COMMIT_MESSAGE:[[:space:]]*//p' "$final_artifact"; printf '\n'; sed '/^COMMIT_MESSAGE:/d' "$final_artifact"; } > "$commit_message"
git commit -F "$commit_message"
release_commit=$(git rev-parse HEAD)
test -z "$(git status --porcelain=v1)"
release_base=$(jq -er .base_ref "$docs_manifest")
test "$release_base" = 21340330a0fad7e9e39c1a9cec67656643621b05
git fetch origin main
test "$(git rev-parse origin/main)" = "$release_base"
git push --set-upstream origin codex/m2-11-t0-finalize
pr_title=$(sed -n '1p' "$commit_message")
pr_url=$(gh pr create --repo "$release_repo" --base main --head codex/m2-11-t0-finalize \
  --title "$pr_title" --body 'Owner-authorized M2-11 completion. Independent plan, QA, and docs reviews approved the exact 76-path cumulative tree; complete local gates and supervised deployment are required.')
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

Before merge, failure closes and reads back the exact open PR:

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

After merge, the supervised deployment first executes this secure preflight. If
runner provisioning is absent, execute the merged runbook §§1–6 with an
interactive administrator and rerun this whole block before variable mutation:

```bash
set -euo pipefail
root=/Users/johnbaek/projects/Populus-ops/snapshots/evidence/m2-11
release_repo=johnbaekk-spec/populus
snapshot=/Users/johnbaek/projects/Populus-ops/snapshots/inst-source-v1.db
t0_log="$root/T0-v11.log"
test "$(gh api repos/actions/runner/releases/latest --jq .tag_name)" = v2.336.0
test "$(gh api "repos/$release_repo/actions/runners" --jq '[.runners[]|select(.status=="online")|select(([.labels[].name]|contains(["self-hosted","macOS","populus-ops"])))]|length')" = 1
dscl . -read /Users/populusrunner UniqueID >/dev/null
sudo test -x /usr/local/populus-runner/controller/runner-controller.sh
sudo test -r /usr/local/populus-runner/controller/runner-image.tar.gz
sudo test -r /usr/local/populus-runner/controller/toolchain.manifest
sudo test "$(stat -f '%Su:%Sg:%Lp' /usr/local/populus-runner/controller)" = root:wheel:700
test "$(sudo /usr/local/populus-runner/roots/active/bin/Runner.Listener --version)" = 2.336.0
sudo launchctl print system/com.populus.runner-controller >/dev/null
test "$(sysctl -n hw.memsize)" -ge 34359738368
pmset -g | grep -Eq ' sleep +0'
pmset -g | grep -Eq ' autorestart +1'
test "$(gh variable get POPULUS_PUBLISH_ARMED --repo "$release_repo" --json value --jq .value)" = true
test "$(gh variable get POPULUS_RECORD_SIGN_ARMED --repo "$release_repo" --json value --jq .value)" = true
test "$(stat -f %z "$snapshot")" = 23058628608
test "$(stat -f %Lp "$snapshot")" = 444
test "$(shasum -a 256 "$snapshot" | awk '{print $1}')" = 977a4d249d92590a4de2961a3e9c7ff8cfa2e4846f0097ec7aa6c07f28124121
test ! -e "$snapshot-wal" && test ! -e "$snapshot-shm" && test ! -e "$snapshot-journal"
test "$(stat -f %z "$t0_log")" = 63400
test "$(wc -l < "$t0_log" | tr -d ' ')" = 171
test "$(shasum -a 256 "$t0_log" | awk '{print $1}')" = 7078a42934484c9c5ba7f975654476e0788c385dbaf8108c0d429a58ba91a453
```

Dispatch is bound to merged main and watched by exact run ID:

```bash
set -euo pipefail
root=/Users/johnbaek/projects/Populus-ops/snapshots/evidence/m2-11
release_repo=johnbaekk-spec/populus
snapshot=/Users/johnbaek/projects/Populus-ops/snapshots/inst-source-v1.db
git fetch origin main
merge_sha=$(git rev-parse origin/main)
run_record="$root/deploy-run.finalization-r10.json"
if test -e "$run_record" || test -L "$run_record"; then
  echo 'deployment run record already exists; STOP before mutation' >&2
  exit 1
fi
gh variable set POPULUS_INST_DB --repo "$release_repo" --body "$snapshot"
test "$(gh variable get POPULUS_INST_DB --repo "$release_repo" --json value --jq .value)" = "$snapshot"
dispatch_after=$(date -u +%Y-%m-%dT%H:%M:%SZ)
gh workflow run publish.yml --repo "$release_repo" --ref main
run_id=
for _ in 1 2 3 4 5 6; do
  run_id=$(gh run list --repo "$release_repo" --workflow publish.yml --event workflow_dispatch --branch main --limit 10 --json databaseId,headSha,createdAt --jq "[.[]|select(.headSha==\"$merge_sha\" and .createdAt>=\"$dispatch_after\")]|if length==1 then .[0].databaseId else empty end")
  test -n "$run_id" && break
  sleep 5
done
test -n "$run_id"
run_url=$(gh run view "$run_id" --repo "$release_repo" --json url --jq .url)
test "$run_url" = "https://github.com/$release_repo/actions/runs/$run_id"
test "$(gh run view "$run_id" --repo "$release_repo" --json headSha --jq .headSha)" = "$merge_sha"
test "$(gh run view "$run_id" --repo "$release_repo" --json event --jq .event)" = workflow_dispatch
test "$(gh run view "$run_id" --repo "$release_repo" --json workflowName --jq .workflowName)" = data-publish
gh run watch "$run_id" --repo "$release_repo" --exit-status
gh run view "$run_id" --repo "$release_repo" --exit-status --json status,conclusion,headSha,event,url,jobs | jq -e '.status=="completed" and .conclusion=="success" and (.jobs|length>0) and all(.jobs[];.conclusion=="success")'
run_status=$(gh run view "$run_id" --repo "$release_repo" --json status --jq .status)
run_conclusion=$(gh run view "$run_id" --repo "$release_repo" --json conclusion --jq .conclusion)
test "$run_status" = completed
test "$run_conclusion" = success
umask 077
run_tmp=$(mktemp "$root/.deploy-run.finalization-r10.XXXXXX")
trap 'rm -f "$run_tmp"' EXIT
jq -n --argjson run_id "$run_id" --arg run_url "$run_url" --arg merge_sha "$merge_sha" --arg status "$run_status" --arg conclusion "$run_conclusion" '{conclusion:$conclusion,merge_sha:$merge_sha,run_id:$run_id,run_url:$run_url,status:$status}' > "$run_tmp"
ln "$run_tmp" "$run_record"
rm -f "$run_tmp"
trap - EXIT
```

The exact functional verifier runs before schedule arming:

```bash
set -euo pipefail
root=/Users/johnbaek/projects/Populus-ops/snapshots/evidence/m2-11
release_repo=johnbaekk-spec/populus
git fetch origin main
merge_sha=$(git rev-parse origin/main)
run_record="$root/deploy-run.finalization-r10.json"
test -f "$run_record" && test ! -L "$run_record"
jq -e 'keys==["conclusion","merge_sha","run_id","run_url","status"] and (.run_id|type=="number" and .>0 and floor==.) and (.run_url|type=="string") and (.merge_sha|type=="string" and test("^[0-9a-f]{40}$")) and .status=="completed" and .conclusion=="success"' "$run_record"
run_id=$(jq -er .run_id "$run_record")
test "$(jq -er .merge_sha "$run_record")" = "$merge_sha"
test "$(jq -er .run_url "$run_record")" = "https://github.com/$release_repo/actions/runs/$run_id"
test "$(gh run view "$run_id" --repo "$release_repo" --json url --jq .url)" = "$(jq -er .run_url "$run_record")"
test "$(gh run view "$run_id" --repo "$release_repo" --json status --jq .status)" = completed
test "$(gh run view "$run_id" --repo "$release_repo" --json conclusion --jq .conclusion)" = success
test "$(gh run view "$run_id" --repo "$release_repo" --json headSha --jq .headSha)" = "$merge_sha"
test "$(gh run view "$run_id" --repo "$release_repo" --json event --jq .event)" = workflow_dispatch
test "$(gh run view "$run_id" --repo "$release_repo" --json workflowName --jq .workflowName)" = data-publish
verify_root=$(mktemp -d)
gh repo clone johnbaekk-spec/populus-data "$verify_root/populus-data" -- --depth 1
GH_TOKEN="$(gh auth token)" GH_REPO=johnbaekk-spec/populus-data uv run populus verify --data-repo "$verify_root/populus-data" --attestation=sigstore
GH_TOKEN="$(gh auth token)" uv run python -m populus.deploy.record gate --data-repo "$verify_root/populus-data" --domain publicfilings.org
build_id=$(jq -er .build_id "$verify_root/populus-data/latest.json")
manifest="$verify_root/populus-data/builds/$build_id/manifest.json"
source_doc="$verify_root/populus-data/builds/$build_id/inst_source.json"
stats="$verify_root/populus-data/builds/$build_id/congress/stats.json"
jq -e '.modules.inst.schema_version=="1.1" and .modules.inst.client_compat==">=0.0.1,<1" and ([.modules.inst.artifacts[].name]|contains(["inst_agg.db","inst_serving.db","inst_source.json"])) and ([.modules.inst.artifacts[]|select(.name=="inst_agg.db" or .name=="inst_serving.db")|.logical_digest|test("^[0-9a-f]{64}$")]|all)' "$manifest"
jq -e '.schema=="inst_source/v1" and .snapshot_sha256=="977a4d249d92590a4de2961a3e9c7ff8cfa2e4846f0097ec7aa6c07f28124121"' "$source_doc"
jq -e '.site_file_count|type=="number" and .>0 and .<=18000' "$stats"
base=https://publicfilings.org
curl -fsS "$base/?m2-11=$run_id" -o "$verify_root/root.html"
curl -fsS "$base/institutional/?m2-11=$run_id" -o "$verify_root/institutional.html"
curl -fsS "$base/stats.json?m2-11=$run_id" -o "$verify_root/live-stats.json"
cmp "$stats" "$verify_root/live-stats.json"
grep -Fq "populus:code_sha\" content=\"$merge_sha\"" "$verify_root/root.html"
grep -Fq 'Institutional' "$verify_root/institutional.html"
! grep -Fq 'module withheld' "$verify_root/institutional.html"
curl -fsS "$base/institutional/data/filers/index.v1.json?m2-11=$run_id" | jq -e '.=={"v":2,"kind":"filer-index-upgrade-required"}'
test "$(curl -sS -o /dev/null -w '%{http_code}' "$base/institutional/data/filers/0.v1.json?m2-11=$run_id")" = 404
v2_index="$verify_root/filers-v2.json"
curl -fsS "$base/institutional/data/filers/index.v2.json?m2-11=$run_id" -o "$v2_index"
test "$(wc -c < "$v2_index" | tr -d ' ')" -le 1048576
jq -e 'keys==["absent","kind","routes","v"] and .v==2 and .kind=="filer-index" and .absent==null and (.routes|type=="object" and length>0)' "$v2_index"
multi_cik=$(jq -er 'first(.routes|to_entries[]|select(.value[2]>1)|.key)' "$v2_index")
test -n "$multi_cik"
BASE="$base" RUN_ID="$run_id" INDEX="$v2_index" CIK="$multi_cik" OUT="$verify_root/filer-payload.json" PYTHONDONTWRITEBYTECODE=1 .venv/bin/python - <<'PY'
import json, os, urllib.request
from pathlib import Path
from scripts.measure_inst_derive import reassemble_filer_fragments
base, run_id, cik = os.environ["BASE"], os.environ["RUN_ID"], os.environ["CIK"]
index = json.loads(Path(os.environ["INDEX"]).read_text())
first, last, parts = index["routes"][cik]
assert all(type(v) is int for v in (first, last, parts))
assert 0 <= first <= last < 4096 and 1 < parts <= 64
fragments, shard_count = [], None
for shard in range(first, last + 1):
    url = f"{base}/institutional/data/filers/{shard}.v2.json?m2-11={run_id}"
    with urllib.request.urlopen(url, timeout=30) as response:
        raw = response.read(1048577)
    assert 0 < len(raw) <= 1048576
    body = json.loads(raw)
    assert set(body) == {"v", "kind", "shard", "shard_count", "entries"}
    assert body["v"] == 2 and body["kind"] == "filer-fragment-shard"
    assert body["shard"] == shard and isinstance(body["entries"], dict) and body["entries"]
    shard_count = body["shard_count"] if shard_count is None else shard_count
    assert body["shard_count"] == shard_count and last < shard_count <= 4096
    for key, fragment in body["entries"].items():
        if fragment.get("cik") == cik:
            assert key == f"{cik}:{fragment['part']}"
            assert fragment["v"] == 2 and fragment["kind"] == "filer-fragment"
            assert fragment["parts"] == parts
            fragments.append(fragment)
assert [fragment["part"] for fragment in fragments] == list(range(parts))
payload = reassemble_filer_fragments(fragments)
assert payload["v"] == 1 and payload["kind"] == "filer" and payload["cik"] == cik
assert isinstance(payload["filerName"], str) and payload["filerName"]
assert payload["rowsByPeriod"] and sum(map(len, payload["rowsByPeriod"].values())) > 0
Path(os.environ["OUT"]).write_text(json.dumps(payload, sort_keys=True) + "\n")
PY
filer_unpadded=$(.venv/bin/python -c 'import sys; print(int(sys.argv[1]))' "$multi_cik")
curl -fsS "$base/e/?k=f:$filer_unpadded&m2-11=$run_id" -o "$verify_root/filer-page.html"
grep -Fq 'id="entity-root"' "$verify_root/filer-page.html"
grep -Fq "populus:code_sha\" content=\"$merge_sha\"" "$verify_root/filer-page.html"
gh variable set POPULUS_SELFHOSTED_VALIDATED --repo "$release_repo" --body true
test "$(gh variable get POPULUS_SELFHOSTED_VALIDATED --repo "$release_repo" --json value --jq .value)" = true
```

On any deployment mutation/verification failure, preserve the run and disarm:

```bash
set -euo pipefail
release_repo=johnbaekk-spec/populus
gh variable delete POPULUS_SELFHOSTED_VALIDATED --repo "$release_repo" 2>/dev/null || :
gh variable delete POPULUS_INST_DB --repo "$release_repo" 2>/dev/null || :
remaining_release_vars=$(gh variable list --repo "$release_repo" --json name --jq '[.[].name|select(.=="POPULUS_INST_DB" or .=="POPULUS_SELFHOSTED_VALIDATED")]|sort|join(",")')
test -z "$remaining_release_vars"
```

## Simplicity Audit

This is one final branch in the existing runner, one exact failed-gate validator,
one resolution, two governance files, and focused tests. It adds no product
abstraction, dependency, generic framework, second release path, or round loop.

## Tech Debt Introduced

**TD-QA-ORIGIN-11 — final closeout round.** The custom M2-11 runner gains one
round-9 failed-gate policy and one round-10 branch because the prior attempt
stopped in evidence machinery after product/T0 approval. Impact is limited to
this release. Controls are exact pins, frozen product/T0, full direct gates,
normal independent QA/docs approval, functional deployment proof, no round 11,
and append-only evidence. Remove TD1–TD11 when the generic orchestrator owns
typed failed-gate/docs/release transport; do not copy this round into another run.

No TODO, stub, skipped test, disabled gate, timeout/limit relaxation, dependency,
product debt, or hidden release bypass is authorized.

## Memory Touch-Points

The deterministic selector used `finalization release closeout failed-gate
append-only waiver deployment qa` and returned seven records:

- `feedback_qa_fail_batch_remediation.md` and
  `feedback_qa_remediation_discipline.md`: one coherent repair, full gates,
  normal independent approval, and no self-waiver.
- `feedback_orchestrate_workflow.md`: retain the isolated feature branch and
  never use a silent auto-approval override.
- `feedback_supervised_deployment_dry_run_inspection.md`: functional inspection
  before arming publication.
- `feedback_gate_list_completeness.md`: list and rerun all 15 standing gates.
- `feedback_load_dotenv_import_footgun_blocks_reuse.md`: checked relevance; no
  credential-loading or dependency change exists in this evidence-only delta.
- `feedback_postdeployment_debt_worse_pattern.md`: finish factual docs/debt before
  deployment instead of follow-up cleanup.

The shared failure-mode catalog was loaded and applied.

## Failure-Mode Sweep

| Failure mode | Prevention/proof |
|---|---|
| stale docs/test propagation | full-tree grep plus focused test after final docs edit |
| overwritten/forged predecessor | exact path/digest/ledger/log/failure mutations; append-only |
| source repair with stale gates | one fresh round-10 bundle against content fingerprint |
| false approval/waiver | only sealed `VERDICT: APPROVED` enters docs; failures stop |
| hidden product drift | exact six-path delta and product/T0 byte equality |
| incomplete gates | literal unchanged 15-command ledger |
| liveness-only deploy | signed index/shard, real filer payload/page, binding verification |
| secret exposure | existing redaction/security gates; no credential output |
| failed release residue | empty-index restoration and variable disarm/readback |
| stale/partial deploy-run identity | pre-mutation absence, atomic no-replace publication, collision/no-overwrite, malformed refusal, exact run/URL/merge readback tests |
| endless retry | universal round-11 and attempt-4 refusal |

## Definition of Done

- **R1:** exact authority validates; only round 10 is executable.
- **R2:** exact failed round-9 predecessor/resolution and all mutation tests pass.
- **R3:** inventory is exactly 76 and product/T0 bytes are unchanged.
- **R4:** round 10 runs once; all 15 gates pass with one fingerprint and valid
  evidence, or failure is preserved without round 11.
- **R5:** independent QA approves; any failed/rejected result stops without output
  or round 11.
- **R6:** docs attempt 3 and independent docs review approve; deploy-record
  pre-existing/collision/partial/malformed and exact-readback tests pass; exact
  fixed-base PR merges; supervised deployment functionally exposes Institutional data.
- **R7:** no prior evidence overwrite, round 11, attempt 4, product change, T0
  rerun, relaxed boundary, hidden debt, or unverified schedule arming occurs.
