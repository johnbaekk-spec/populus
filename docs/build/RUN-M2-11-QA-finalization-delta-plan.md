# RUN M2-11 — QA/Docs Finalization Delta Plan (plan-v1)

**Status:** IN REVIEW · **Owner authorization:** 2026-08-11, “You have
authorization for EVERYTHING within this repo … get it completed” ·
**Transport:** interactive-disk with independent read-only review ·
**Candidate:** dedicated worktree `codex/m2-11-t0-finalize`, fixed HEAD
`7391d947f72cf408a173f1e7938102608b2269d4`, fetched `origin/main`
`21340330a0fad7e9e39c1a9cec67656643621b05`.

## Goal and Success Criteria

Close the three blockers from the first independent docs review without changing
institutional product behavior or rerunning T0-v11. Success means:

1. the exact final 62-path repository tree receives fresh complete gate evidence
   and independent QA approval in a new owner-authorized finalization cycle;
2. the docs-review manifest directly carries that same tree's typed Dev Notes,
   PASS QA report, changed-file list, complete redacted diff, approved QA review,
   and final commit evidence;
3. a distinct final commit artifact supplies a Conventional Commits subject and
   concise rationale through a deterministic `git commit -F` mapping;
4. independent docs review approves before staging, commit, PR, or deployment;
5. the successful T0-v11 log and immutable snapshot remain byte-identical and are
   never rerun or repaired.

## Requirements

- **R1 — Explicit finalization authority and bounded cycle.** Add a dedicated
  finalization owner-decision record and treat the completed
  three-round product QA chain as historical and immutable. The owner's complete
  repository authorization permits one new evidence-only finalization cycle,
  independently reviewed for at most three rounds under new append-only directory
  names. This is not a fourth round of the closed product-QA cycle and waives no
  gate, freshness, security, or review check. Recovery and finalization bundles
  retain separate owner-decision records and exception scopes; historical recovery
  validation continues to use its original constants.
- **R2 — Exact current candidate.** Finalization uses exactly the 62 paths listed
  under Architecture, fixed branch/HEAD/base, unchanged Git index, pinned approved
  tail/recovery/finalization plans, findings, T0-v11, snapshot, and the canonical
  first docs-review verdict. Any missing, extra, symlinked, stale, secret-looking,
  or changed input refuses before evidence creation.
- **R3 — Current QA bundle and complete gates.** Transition the existing one-off
  bundle builder from the completed 57-path origin cycle to the 62-path
  finalization cycle. It copies this plan as `plan.md`, emits current Dev Notes,
  changed-files, complete redacted diff, PASS QA report, candidate/tree/token and
  all existing v9 manifests, then runs the unchanged 15 literal gates. A source or
  docs change invalidates the bundle and requires the next finalization round;
  T0-v11 remains verification-only.
- **R4 — Same-candidate QA and docs handoff.** A separate read-only `qa-review`
  agent reviews the fresh finalization bundle. After approval, no repository byte
  may change. `seal-docs` must live-validate that exact approved bundle, require its
  sealed QA review/manifest, and create a docs manifest whose typed Dev Notes,
  PASS QA report, changed list, diff, and final tree all describe that same 62-path
  fingerprint. Round N>1 derives every open blocker ID from the validated prior
  review and requires an exact matching resolution set; no finding ID is hard-coded.
- **R5 — Final commit authority.** Before each docs attempt, create a new
  append-only external `final-docs-commit.finalization-rN-aM.md` with two rationale
  paragraphs followed by exactly one
  final `COMMIT_MESSAGE:` line. Validate it as `docs-commit-v1`, bind its distinct
  digest in docs review, and render the reviewed subject/body into a mode-0600
  temporary file before `git commit -F`. Never pass the metadata artifact itself
  to Git and never use a heredoc. Docs attempts are capped at three overall and
  use create-once `docs-v9-finalization-rN-aM/` directories. Attempt M>1 binds the
  exact prior docs review and primary-authored resolution notes; any repo edit
  invalidates QA and moves to the next QA round.
- **R6 — Docs-review remediation and provenance.** Preserve both first docs-review
  files; pin the canonical verdict SHA-256
  `6827a2cacf1a53e582db143a9baa71438ecfab51526eff8f58fb08d40086e5ee`.
  Dev Notes and the repository QA report state F1-F3, this bounded remedy, the
  unchanged product/T0 boundary, and the fresh finalization evidence once generated
  only through external artifacts. Independent docs review rechecks all three
  findings; the primary alone makes fixes. Every returned docs review is sealed
  into its attempt directory with an exact input/output manifest. Immediately
  before staging, `validate-release --mode pre-stage` rechecks the approved verdict,
  docs manifest graph, final-message digest, live fingerprint, and approved tree.
  After staging, `--mode post-stage` permits only the expected index transition and
  requires exact cached paths/tree, no unstaged/untracked byte, the same sealed
  approval/message/base, and refusal of any unrelated staged path.
- **R7 — Fail-closed release continuation.** Only after docs approval may the exact
  62-path allowlist be staged and compared byte-for-byte to the reviewed tree,
  committed, pushed, opened as a fixed-base PR, and squash-merged. The approved
  supervised runner/deployment sequence remains unchanged; absent admin runner
  provisioning is a stop, not permission to weaken isolation.

## Scope

Authorized repository writes for this delta are exactly:

```text
docs/build/RUN-M2-11-QA-finalization-delta-plan.md
docs/build/RUN-M2-11-QA-finalization-decision.md
docs/build/RUN-M2-11-devnotes.md
docs/build/RUN-M2-11-qa-report.md
scripts/build_m2_11_qa_bundle.py
tests/test_m2_11_qa_bundle.py
```

Authorized append-only external outputs are new
`qa-v9-finalization-round-N/`, `docs-v9-finalization-rN-aM/`, the canonical
first docs review already retained under `docs-v9-final/`, and
`final-docs-commit.finalization-rN-aM.md` under the existing M2-11 evidence
directory. QA rounds and docs attempts are each capped at three.

## Non-goals

- no change to aggregation, serving, SQLite schemas, publication payloads,
  frontend routes, budgets, workflow behavior, runner controller, or deployment
  variables;
- no T0-v11 or full-corpus derivation rerun, snapshot mutation, evidence deletion,
  history rewriting, or threshold relaxation;
- no modification of `orchestrate-tool`, user config, GitHub, or production before
  both independent reviews approve;
- no fourth review in the closed three-round product-QA sequence;
- no unsafe current-user self-hosted runner or bypass of the reviewed controller.

## Constraints

- The current 60-path fingerprint before adding this plan is
  `699c803a79df0d271c702d2d878c623a5ee0e866389bd7a18de752190c7b0468`.
  Plan review pins the resulting 61-path candidate digest and this plan's SHA;
  implementation records the approved exact plan SHA in `PINNED_DIGESTS`.
- Tail plan SHA is
  `068e7fc04edf61e0e3d25e40ff504b003faa0d0ab6d26fa65982a4899e119fad`;
  recovery plan SHA is
  `2df62fa4dd2a54bfac932238e0b8fcd16a6386d3b6c75dabe038eacf714297ba`;
  findings SHA is
  `cf1739a8571f312231e2a842bd0fbe7521e6b2f4a5f522c2089bbd78957579fd`.
- T0-v11 remains 63,400 bytes/171 lines at SHA
  `7078a42934484c9c5ba7f975654476e0788c385dbaf8108c0d429a58ba91a453`.
  Snapshot remains 23,058,628,608 bytes, mode `0444`, sidecar-free, SHA
  `977a4d249d92590a4de2961a3e9c7ff8cfa2e4846f0097ec7aa6c07f28124121`.
- Canonical docs-review round 1 is a valid `review-output-v1` at
  `/Users/johnbaek/projects/Populus-ops/snapshots/evidence/m2-11/docs-v9-final/docs-review.round-1.canonical.md`
  with the R6 digest. The earlier raw formatting copy remains append-only evidence.
- The complete redacted patch remains disk-only with the existing 2,097,152-byte
  exceptional cap; every other artifact retains the 1,048,576-byte cap.
- Every output directory is create-once, regular, nonsymlink, mode 0700; contained
  evidence is mode 0600. No failed directory is deleted or reused.
- The round-1/attempt-1 final commit artifact is created before finalization bundle
  capture and never overwritten. Later attempt-specific artifacts are permitted
  only after a sealed `CHANGES_REQUESTED` docs review with matching resolution
  notes. Secrets, tokens, private-key material, and credentials never enter
  evidence, Git, commands, or chat.

## Current State

- Product implementation and the single T0-v11 binding run are complete. T0
  passed materialization (158.950 s), aggregate (156.725 s), serving (123.690 s),
  v2 reassembly, byte ceilings, file budget, and snapshot immutability.
- Product QA used three rounds. Round 3 approved token
  `sha256:7747af94f5100803543d822c06fd989033c7525a43f2da1e459e3f285ebcb8cb`.
- First docs review returned `CHANGES_REQUESTED`: F1 current source was not covered
  by those retained gates/QA; F2 typed docs/diff inputs still named the historical
  57-path bundle; F3 final commit evidence was provisional and one-line.
- The current candidate has 61 paths only because this plan is now present. No file
  is staged, committed, pushed, or deployed. Public Institutional remains withheld.
- GitHub has no registered self-hosted runner and this Mac lacks the dedicated
  `populusrunner` account/controller. That affects deployment only, after merge.

## Detected Stack

- **Languages:** Python 3.12.13; TypeScript/Astro under `dashboard/`.
- **Runners:** repository `.venv`, frozen `uv.lock`; npm 11 / Node 24 and lockfile.
- **Tests:** pytest, Node native tests, Astro/TypeScript, Make-owned complete gates.
- **Storage/publication:** immutable SQLite/JSON1 snapshot; signed static Pages site.
- **Delta surface:** Python stdlib evidence runner plus Markdown; no dependency.

## Reuse Map

| Need | Reused source | Decision |
| --- | --- | --- |
| fingerprint/redacted diff | existing external `worktree_fingerprint`, `collect_diff`, `scrub_secret_values` through pinned orchestrate script | reuse unchanged |
| custom bundle schemas | `scripts/build_m2_11_qa_bundle.py` | extend the existing run-specific bridge; no second builder |
| exact inventory/tree | `changed_paths`, `validate_fixed_state`, `build_approved_tree` | change one literal inventory to 62 and reuse private-index proof |
| typed QA/docs inputs | existing `write_origin_artifacts`, `write_markdown_artifacts`, phase manifests | fresh bundle makes them current; do not add an implicit tree-only substitute |
| QA and docs review | existing separate `plan_reviewer` agent with `qa-review` then `docs-review` | independent, read-only; primary fixes |
| commit transport | `docs-commit-v1`, `git commit -F` discipline | distinct artifact plus deterministic subject/body rendering |
| product verification | existing 15 gate commands and immutable T0 log | rerun all gates; verify rather than rerun T0 |

Repository-wide reuse scan found no second active M2-11 bundle builder or commit
renderer. Extending the existing explicitly temporary recovery bridge is smaller
and more auditable than creating another module.

## Architecture

### Exact 62-path candidate and release inventory

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
docs/build/RUN-M2-11-QA-finalization-delta-plan.md
docs/build/RUN-M2-11-QA-finalization-decision.md
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

### Bundle transition

The existing runner becomes cycle-aware while emitting only new finalization
bundles from this point forward:

- add `FINALIZATION_PLAN`, `FINALIZATION_DECISION`, and the canonical first
  docs-review path/digest to fixed inputs;
- preserve `RECOVERY_EXCEPTION_SCOPE` and add a separate
  `FINALIZATION_EXCEPTION_SCOPE` containing only current-tree adoption,
  repo-local schema validation, and the explicitly authorized finalization cycle;
  infer the expected cycle from the bound plan/decision digests when validating
  old or new bundles, so historical bundles remain valid and immutable;
- make `EXPECTED_QA_PATHS` and `EXPECTED_RELEASE_PATHS` the identical sorted
  62-path tuple above;
- `run --cycle finalization` copies `FINALIZATION_PLAN` as `plan.md` and
  `FINALIZATION_DECISION` as `owner-decision.md`, uses the plan digest for
  task/manifests, validates the attempt-specific final commit artifact, and labels
  the run `RUN-M2-11-QA-finalization`;
- keep all schemas/token formulas and the 15 gates unchanged;
- restore `seal-docs` live bundle validation because no repo byte changes after
  finalization QA approval;
- replace hard-coded F1/F2/F3 retry checks with a parser that takes the exact set of
  open `#### F<number> [BLOCKER]` records from a validator-approved prior review and
  requires resolution notes to contain exactly one `<ID>: resolved` for every and
  only that set;
- add attempt-aware `seal-docs`, `seal-docs-review`, and two-mode `validate-release`
  commands. The first binds prior docs review/resolution for attempts M>1; the
  second seals either review verdict with the exact docs-input manifest; the third
  accepts only a sealed APPROVED verdict. Pre-stage mode rechecks the approved live
  fingerprint; post-stage mode instead rechecks exact cached paths/tree plus zero
  unstaged/untracked files while retaining every sealed approval/message/base check;
- tests prove exact count/equality, cycle/plan/decision/task selection, historical
  scope validation, arbitrary finding-set convergence, live validation, typed
  current input digests, append-only attempts/caps, sealed approval, cross-round
  refusal, output preflights, and final-message binding.

Fresh outputs are `/qa-v9-finalization-round-N`; old `qa-v9-round-N` bundles
remain valid historical evidence but are never mutated or used for final approval.

### Final commit artifact and renderer

The round-1/attempt-1 append-only artifact is exactly:

```text
M2-11 publishes the accepted immutable institutional snapshot through bounded v2 tail shards while preserving honest absence and rollback behavior.

It also carries the reviewed resource, provenance, compatibility, and supervised-release controls required for public deployment.

COMMIT_MESSAGE: feat(inst): publish bounded institutional data
```

After docs approval only, validate and render it without a heredoc. This block is
renderer-only and does not commit:

```bash
docs_bundle=/Users/johnbaek/projects/Populus-ops/snapshots/evidence/m2-11/docs-v9-finalization-r1-a1
PYTHONDONTWRITEBYTECODE=1 .venv/bin/python scripts/build_m2_11_qa_bundle.py validate-release \
  --docs-bundle "$docs_bundle" --mode pre-stage
final_artifact=/Users/johnbaek/projects/Populus-ops/snapshots/evidence/m2-11/final-docs-commit.finalization-r1-a1.md
commit_message=$(mktemp)
chmod 600 "$commit_message"
{
  sed -n 's/^COMMIT_MESSAGE:[[:space:]]*//p' "$final_artifact"
  printf '\n'
  sed '/^COMMIT_MESSAGE:/d' "$final_artifact"
} > "$commit_message"
test "$(sed -n 's/^COMMIT_MESSAGE:[[:space:]]*//p' "$final_artifact" | wc -l | tr -d ' ')" = 1
test "$(shasum -a 256 "$final_artifact" | awk '{print $1}')" = \
  "$(jq -r '.inputs[] | select(.name=="final-docs-commit") | .digest' \
    "$docs_bundle/docs-review-input.manifest.json" | sed 's/^sha256://')"
```

The final artifact is schema-valid because its sole `COMMIT_MESSAGE:` is the raw
last line. The temporary Git message contains the subject first, a blank line,
then the two reviewed rationale paragraphs.

## Locked Decisions

1. This new cycle has its own decision record, exception scope, and maximum three
   QA rounds; the closed
   product-QA rounds and their verdicts are not renamed or reused.
2. All repo docs are finalized before fresh bundle capture. After QA approval,
   no repository edit occurs before docs review/commit.
3. The same 62 paths are both QA and release scope; there is no 57→60 transition
   inside finalization.
4. T0-v11 and snapshot are immutable verification inputs, never executable steps.
5. Each final commit artifact is attempt-specific, multiline, append-only, and rendered;
   the `COMMIT_MESSAGE:` metadata prefix never enters Git history.
6. Any gate/QA/docs blocker is batched by the primary; repo edits consume the next
   named QA round, while external-message-only remediation consumes the next docs
   attempt. The docs attempt counter is global across QA rounds and advances only
   when `seal-docs` creates an attempt: after a QA-only rejection it stays at A1,
   while a repo fix after docs attempt A1 uses the next QA round and A2. Both caps
   are three and no agent self-signs.
7. Deployment security/isolation is unchanged. Missing administrator provisioning
   stops deployment rather than authorizing a current-user runner.

## Alternatives Considered

- **Keep the first docs tree and waive freshness:** rejected; docs-review v9
  requires the same current candidate approved by QA.
- **Revert only the post-QA fix:** rejected; the original seal cannot represent the
  required finalized docs state and still transports stale typed inputs.
- **Treat this as product QA round 4:** rejected; the original three-round cap is
  preserved. This is a new explicit finalization delta/cycle.
- **Create a second bundle tool:** rejected; the existing run-specific tool already
  owns the exact schemas, gates, trees, and sealing behavior.
- **Reuse the recovery decision/scope unchanged:** rejected; it names a closed
  cycle and a provisional-docs waiver that finalization removes.
- **Hard-code the previous three finding IDs:** rejected; every retry must derive
  the complete open-blocker set from the immediately prior validated review.
- **Use the one-line artifact directly with `git commit -F`:** rejected; it would
  commit metadata and omit rationale.
- **Deploy locally or with the owner account:** rejected; it violates reviewed
  runner isolation and signed workflow provenance.

## Planned Files

| File | Planned change | Requirements |
| --- | --- | --- |
| `docs/build/RUN-M2-11-QA-finalization-delta-plan.md` | exact authority, evidence, scope, cycle, and rollout contract | R1-R7 |
| `docs/build/RUN-M2-11-QA-finalization-decision.md` | exact owner quote, separate cycle/caps, no provisional-docs waiver | R1,R2,R6 |
| `scripts/build_m2_11_qa_bundle.py` | cycle-aware recovery/finalization validation, 62 paths, dynamic findings, current typed bundle, append-only QA/docs seals, release validation | R1-R6 |
| `tests/test_m2_11_qa_bundle.py` | exact inventory, plan/task, live seal, typed-current, commit binding regressions | R2-R5 |
| `docs/build/RUN-M2-11-devnotes.md` | declare docs findings, fresh-cycle remedy, unchanged product/T0, tests/evidence | R1,R3,R6 |
| `docs/build/RUN-M2-11-qa-report.md` | distinguish approved product QA from new finalization evidence and pending docs review | R1,R4,R6 |

No other repository file may change in this delta.

## Implementation Tasks

- **T1 [R1,R2]:** Create/validate the finalization decision, pin this approved plan
  and canonical docs-review, and update the exact equal 62-path QA/release inventory.
- **T2 [R1,R2,R3,R4,R6]:** Implement cycle-aware plan/decision/exception validation,
  finalization run/task identity, exact open-finding resolution, same-live-candidate
  docs sealing, append-only docs attempts/review sealing, and release validation.
- **T3 [R1,R2,R3,R4,R5,R6]:** Add behavioral tests that fail if historical-cycle
  validation, inventory/plan/decision selection, arbitrary finding convergence,
  current typed manifests, live validation, attempt/cap/collision rules, sealed
  approval, pre/post-stage validation, unrelated staged-path refusal, preflight
  ordering, or final-message binding is removed.
- **T4 [R1,R3,R5,R6]:** Reconcile Dev Notes/repository QA report and create/validate
  `final-docs-commit.finalization-r1-a1.md` before bundle capture; validate both
  Markdown content schemas, commit schema, exact body/subject, and complete diff.
- **T5 [R3,R4,R6]:** Run finalization round 1 with all 15 gates, validate/seal the
  fresh independent QA review; if rejected, batch fixes and use round 2/3.
- **T6 [R4,R5,R6]:** Verify the unchanged attempt-specific final artifact, seal a
  docs attempt from the approved live QA candidate, independently review and seal
  its verdict; on rejection, bind prior review/resolution into the next permitted
  attempt or return to T5 after any repo edit.
- **T7 [R5,R7]:** Run `validate-release`, stage exactly 62 paths, compare the cached
  tree to the approved tree, render/commit the digest-verified message, fixed-
  base PR/squash-merge, then execute the unchanged supervised deployment or stop on
  absent secure runner prerequisites.

## Testing Strategy

The finalization runner executes these exact 15 commands, in order, with direct
exit code, complete redacted log, duration, and pre/post fingerprint:

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

Pre-bundle focused proof also validates plan-v1, the finalization decision, Dev
Notes, repository QA report, canonical first docs-review, `docs-commit-v1`, exact
62-path equality, recovery-versus-finalization exception selection, arbitrary
one/four-finding resolution sets, missing/extra/relabelled/approved-prior refusals,
docs attempt collision/skipped/cap/cross-round refusals, sealed-review substitution,
pre-stage success, post-stage exact-index success, unrelated staged-path refusal,
snapshot/T0 identity, and `git diff --check`. No command invokes T0 or full-corpus
derivation.

## Verification Matrix

| Requirement | Executable proof |
| --- | --- |
| R1 | finalization plan/decision and cycle-aware validator identify separate max-three cycle; historical recovery bundle still validates offline with old scope |
| R2 | fixed-state refusal tests plus exact 62-path equality, pins, index hash, snapshot/T0 checks |
| R3 | fresh bundle validates; ledger has exactly 15 unique required zero exits and unchanged fingerprint |
| R4 | sealed QA fingerprint equals live/docs manifest fingerprint; typed current inputs/final tree digests match; dynamic prior blockers equal resolution IDs |
| R5 | attempt-specific artifact validates; docs seal/review seal bind its digest; renderer exact/mode 0600; collision/skip/cap tests pass |
| R6 | canonical plan/docs findings are pinned/resolved; sealed APPROVED docs review validates in pre-stage and post-stage modes without weakening message/base checks |
| R7 | pre-stage fingerprint passes; post-stage names/tree equal 62 allowlist/approved tree and unrelated staging refuses; fetched base equals sealed base before PR and merge |

## Rollout / Rollback

After independent plan approval, implement T1-T4 and create the finalization
decision and round-1/attempt-1 final message. The first QA bundle command is:

```bash
qa_bundle=/Users/johnbaek/projects/Populus-ops/snapshots/evidence/m2-11/qa-v9-finalization-round-1
final_message=/Users/johnbaek/projects/Populus-ops/snapshots/evidence/m2-11/final-docs-commit.finalization-r1-a1.md
PYTHONDONTWRITEBYTECODE=1 .venv/bin/python scripts/build_m2_11_qa_bundle.py run \
  --cycle finalization --round 1 --final-docs-commit "$final_message" \
  --output "$qa_bundle"
PYTHONDONTWRITEBYTECODE=1 .venv/bin/python scripts/build_m2_11_qa_bundle.py validate \
  --bundle "$qa_bundle"
```

Hand `adoption-manifest.json` plus the validated bundle to the separate
`qa-review` agent. Preserve its raw canonical output outside Git, then seal it:

```bash
qa_review=/absolute/create-once/path/qa-review.finalization-r1.md
PYTHONDONTWRITEBYTECODE=1 .venv/bin/python scripts/build_m2_11_qa_bundle.py seal-review \
  --bundle "$qa_bundle" --review "$qa_review"
```

If it returns `CHANGES_REQUESTED`, create exact primary-authored resolution notes
and a new round-qualified message before running the next QA round; the runner
derives and compares all open finding IDs. This example is a QA-round-1 rejection
before any docs attempt, so the global docs-attempt counter remains A1:

```bash
next_bundle=/Users/johnbaek/projects/Populus-ops/snapshots/evidence/m2-11/qa-v9-finalization-round-2
next_final_message=/Users/johnbaek/projects/Populus-ops/snapshots/evidence/m2-11/final-docs-commit.finalization-r2-a1.md
PYTHONDONTWRITEBYTECODE=1 .venv/bin/python scripts/build_m2_11_qa_bundle.py run \
  --cycle finalization --round 2 --final-docs-commit "$next_final_message" \
  --prior-review "$qa_bundle/qa-review.round-1.md" \
  --resolution-notes /absolute/create-once/path/resolution-notes.finalization-r1.md \
  --output "$next_bundle"
```

Round 3 is identical with round-2 inputs. Round 4, skipped rounds, mismatched
findings, reused output, or any repo drift refuse. T0 is never invoked.

With an approved QA bundle and byte-identical repo, seal docs attempt 1, hand its
manifest to the separate docs reviewer, then seal that exact returned verdict:

```bash
docs_bundle=/Users/johnbaek/projects/Populus-ops/snapshots/evidence/m2-11/docs-v9-finalization-r1-a1
sealed_qa_review="$qa_bundle/qa-review.round-1.md"
PYTHONDONTWRITEBYTECODE=1 .venv/bin/python scripts/build_m2_11_qa_bundle.py seal-docs \
  --bundle "$qa_bundle" --qa-review "$sealed_qa_review" \
  --final-docs-commit "$final_message" --attempt 1 --output "$docs_bundle"
docs_review=/absolute/create-once/path/docs-review.finalization-r1-a1.md
PYTHONDONTWRITEBYTECODE=1 .venv/bin/python scripts/build_m2_11_qa_bundle.py seal-docs-review \
  --docs-bundle "$docs_bundle" --review "$docs_review"
```

For a docs-only rejection, create attempt-2 message/resolution artifacts and run
`seal-docs --attempt 2 --prior-docs-review
"$docs_bundle/docs-review.attempt-1.md" --resolution-notes <path>` into
`docs-v9-finalization-r1-a2`, then seal its review. Any repository edit instead
requires the next QA round. Docs attempt 4, skipped attempt, missing/extra finding
resolution, collision, or cross-round input refuses.

Before staging, validate the immutable handoff and stage the literal 62 paths:

```bash
PYTHONDONTWRITEBYTECODE=1 .venv/bin/python scripts/build_m2_11_qa_bundle.py validate-release \
  --docs-bundle "$docs_bundle" --mode pre-stage
release_allowlist=(
  .github/workflows/publish.yml
  ARCHITECTURE.md
  Makefile
  STATUS.md
  dashboard/package.json
  dashboard/src/lib/data.ts
  dashboard/src/lib/filer-payload.ts
  dashboard/src/lib/holdings.ts
  dashboard/src/lib/shards.ts
  'dashboard/src/pages/institutional/data/filers/[shard].v1.json.ts'
  'dashboard/src/pages/institutional/data/filers/[shard].v2.json.ts'
  dashboard/src/pages/institutional/data/filers/index.v1.json.ts
  dashboard/src/pages/institutional/data/filers/index.v2.json.ts
  dashboard/src/scripts/entity-client.ts
  dashboard/test/filer-payload.test.ts
  dashboard/test/post/entity-orchestration.test.ts
  dashboard/test/post/file-budget.test.ts
  dashboard/test/post/fixture-preview.test.ts
  docs/build/RUN-M2-11-QA-finalization-decision.md
  docs/build/RUN-M2-11-QA-finalization-delta-plan.md
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
)
expected_names=$(mktemp)
actual_names=$(mktemp)
cached_names=$(mktemp)
printf '%s\n' "${release_allowlist[@]}" | LC_ALL=C sort -u > "$expected_names"
test "$(wc -l < "$expected_names" | tr -d ' ')" = 62
{ git diff --name-only -z HEAD; git ls-files --others --exclude-standard -z; } |
  tr '\0' '\n' | sed '/^$/d' | LC_ALL=C sort -u > "$actual_names"
diff -u "$expected_names" "$actual_names"
git add -- "${release_allowlist[@]}"
git diff --cached --name-only | LC_ALL=C sort -u > "$cached_names"
diff -u "$expected_names" "$cached_names"
git diff --cached --check
reviewed_tree=$(jq -r '.output.path' "$docs_bundle/docs-review-input.manifest.json" |
  xargs jq -r .tree_oid)
test "$(git write-tree)" = "$reviewed_tree"
PYTHONDONTWRITEBYTECODE=1 .venv/bin/python scripts/build_m2_11_qa_bundle.py validate-release \
  --docs-bundle "$docs_bundle" --mode post-stage
```

Render the already digest-verified message using the R5 command, then commit and
bind the fixed-base PR/merge:

```bash
final_artifact=$(jq -r '.inputs[] | select(.name=="final-docs-commit") | .path' \
  "$docs_bundle/docs-review-input.manifest.json")
commit_message=$(mktemp)
chmod 600 "$commit_message"
{
  sed -n 's/^COMMIT_MESSAGE:[[:space:]]*//p' "$final_artifact"
  printf '\n'
  sed '/^COMMIT_MESSAGE:/d' "$final_artifact"
} > "$commit_message"
test "$(shasum -a 256 "$final_artifact" | awk '{print "sha256:"$1}')" = \
  "$(jq -r '.inputs[] | select(.name=="final-docs-commit") | .digest' \
    "$docs_bundle/docs-review-input.manifest.json")"
git commit -F "$commit_message"
release_commit=$(git rev-parse HEAD)
test -z "$(git status --porcelain=v1)"
git fetch origin main
release_base=$(jq -r .base_ref "$docs_bundle/docs-review-input.manifest.json")
test "$release_base" = 21340330a0fad7e9e39c1a9cec67656643621b05
test "$(git rev-parse origin/main)" = "$release_base"
git push --set-upstream origin codex/m2-11-t0-finalize
pr_url=$(gh pr create --repo johnbaekk-spec/populus --base main \
  --head codex/m2-11-t0-finalize --title 'feat(inst): publish bounded institutional data' \
  --body 'Owner-authorized M2-11 completion. Independent plan, QA, and docs reviews approved the exact cumulative tree; complete local gates and supervised deployment are required.')
test "$(gh pr view "$pr_url" --json headRefOid --jq .headRefOid)" = "$release_commit"
test "$(gh pr view "$pr_url" --json baseRefOid --jq .baseRefOid)" = "$release_base"
test "$(gh api "repos/{owner}/{repo}/commits/$release_commit/check-runs" --jq .total_count)" -eq 0
test "$(gh api "repos/{owner}/{repo}/commits/$release_commit/status" --jq '.statuses|length')" -eq 0
test "$(gh pr view "$pr_url" --json statusCheckRollup --jq '.statusCheckRollup|length')" -eq 0
test "$(gh pr view "$pr_url" --json mergeable --jq .mergeable)" = MERGEABLE
git fetch origin main
test "$(git rev-parse origin/main)" = "$release_base"
gh pr merge "$pr_url" --squash --match-head-commit "$release_commit"
merge_sha=$(gh pr view "$pr_url" --json mergeCommit --jq .mergeCommit.oid)
git fetch origin main
test "$(git rev-parse origin/main)" = "$merge_sha"
```

Deployment first executes the current runbook §§1-6 when any secure prerequisite
is absent; because those owner-only commands require an interactive administrator,
absence is a hard supervised stop:

```bash
test "$(gh api repos/johnbaekk-spec/populus/actions/runners --jq .total_count)" -eq 1
dscl . -read /Users/populusrunner UniqueID
test -d /usr/local/populus-runner/controller
launchctl list | grep -q com.populus.runner-controller
test "$(sysctl -n hw.memsize)" -ge 34359738368
test "$(shasum -a 256 /Users/johnbaek/projects/Populus-ops/snapshots/inst-source-v1.db | awk '{print $1}')" = \
  977a4d249d92590a4de2961a3e9c7ff8cfa2e4846f0097ec7aa6c07f28124121
```

Once those pass, set only the snapshot variable, dispatch merged `main`, capture
the unique exact run ID, watch it, and perform functional transport checks before
arming schedules:

```bash
gh variable set POPULUS_INST_DB --repo johnbaekk-spec/populus \
  --body /Users/johnbaek/projects/Populus-ops/snapshots/inst-source-v1.db
dispatch_after=$(date -u +%Y-%m-%dT%H:%M:%SZ)
gh workflow run publish.yml --repo johnbaekk-spec/populus --ref main
run_id=
for _ in 1 2 3 4 5 6; do
  run_id=$(gh run list --repo johnbaekk-spec/populus --workflow publish.yml \
    --event workflow_dispatch --branch main --limit 10 \
    --json databaseId,headSha,createdAt \
    --jq "[.[]|select(.headSha==\"$merge_sha\" and .createdAt>=\"$dispatch_after\")]|if length==1 then .[0].databaseId else empty end")
  test -n "$run_id" && break
  sleep 5
done
test -n "$run_id"
gh run watch "$run_id" --repo johnbaekk-spec/populus --exit-status
base=https://publicfilings.org
curl -fsS "$base/institutional/data/filers/index.v1.json" |
  jq -e '. == {"v":2,"kind":"filer-index-upgrade-required"}'
test "$(curl -sS -o /dev/null -w '%{http_code}' \
  "$base/institutional/data/filers/0.v1.json")" = 404
v2_index=$(mktemp)
curl -fsS "$base/institutional/data/filers/index.v2.json" -o "$v2_index"
test "$(wc -c < "$v2_index" | tr -d ' ')" -le 1048576
jq -e '.v==2 and .kind=="filer-index" and .absent==null and (.routes|length)>0' "$v2_index"
multi_cik=$(jq -r '.routes|to_entries[]|select(.value[2]>1)|.key' "$v2_index" | head -1)
test -n "$multi_cik"
test "$(curl -sS -o /dev/null -w '%{http_code}' "$base/e/?k=f:$multi_cik")" = 200
curl -fsS "$base/institutional/" | grep -qv 'module withheld'
```

The retained tail-plan deploy verifier additionally fetches every integer shard in
the selected route, enforces each v2 body/1-MiB ceiling/nonempty entries, exact part
completeness and reassembly, manifest schema 1.1, merged code SHA, snapshot/artifact/
logical digests, signatures, and 18,000-file ceiling before the final variable set.

```bash
gh variable set POPULUS_SELFHOSTED_VALIDATED --repo johnbaekk-spec/populus --body true
```

Before commit, rollback is simply no release action; all external evidence remains.
If finalization QA/docs fails, preserve its directory and use the next valid round
or attempt with prior review/resolution bindings. After
merge, use the approved normal PR/pointer rollback. Missing admin provisioning stops
at step 7 with merge preserved; never weaken the runner or mutate T0/snapshot.

## Simplicity Audit

This is the minimum coherent repair: one new plan, one new decision, four existing
files updated, one append-only external message per docs attempt, and the existing
bundle/reviewer pipeline reused.
There is no product abstraction, schema, route, dependency, service, workflow, or
deployment fork. Equal QA/release inventories eliminate the prior phase mismatch;
fresh typed artifacts eliminate tree-only inference; a short deterministic renderer
eliminates commit metadata leakage.

## Tech Debt Introduced

- **TD-QA-ORIGIN-4 — finalization cycle overlap.** The run-specific recovery tool
  gains a second named evidence cycle because the original three product-QA rounds
  closed before the docs handoff defect appeared. Impact: one more temporary plan,
  output namespace, and test surface. Control: same schemas/gates, exact 62 paths,
  maximum three QA rounds and three docs attempts, no product import. Removal: together with
  TD-QA-ORIGIN-1 through -3 when orchestrate-tool natively supports current v9
  QA-only adoption and typed post-QA docs sealing.

No product, performance, security, snapshot, deployment, or dependency debt is
introduced. Existing eager-build and npm-audit debt remains declared unchanged.

## Memory Touch-Points

- `feedback_gate_list_completeness.md` and `feedback_full_tree_gate_scope.md` lock
  the exact complete 15-command set rather than focused-only evidence.
- `feedback_qa_fail_batch_remediation.md` requires batched F1-F6 plan repair and
  batched F1-F3 docs repair with
  independent re-review without self-signing.
- `feedback_git_commit_f_not_heredoc.md` requires the reviewed mode-0600
  `git commit -F` transport.
- `feedback_gate_function_exit_codes.md`, `feedback_gate_first_before_read_not_dependency.md`,
  and `feedback_gate_evaluates_threshold_directly.md` keep gates behavioral,
  direct-exit, and non-vacuous.
- `feedback_phase_gate_discipline.md` and `feedback_honest_gate_miss_reporting.md`
  preserve the separate finalization boundary and truthful stop semantics.
- `feedback_manifest_columns_by_name_not_index.md` reinforces named typed manifest
  records instead of implicit positional/tree substitution.
- `feedback_honest_gate_miss_reporting.md` also prevents relabeling stale evidence
  as an acceptable docs-only shortcut.

## Failure-Mode Sweep

| Catalog risk | Prevention/proof |
| --- | --- |
| full-set/parallel consumer miss | exact 62 paths; repo scans cover all docs/runner/test/manifest consumers |
| secrets surface | unchanged redaction, secret-looking path refusal, disk-only diff, 0600 evidence |
| verify function not liveness | unchanged full product gates and post-merge real v2 reassembly/filer probe |
| source repair invalidates evidence | new source/docs tree gets all 15 gates and independent QA; no old approval reused |
| stale typed artifact | direct current Dev Notes/QA report/changed-list/diff digests plus same fingerprint/tree |
| output consumed on refusal | every preflight before create-once directory; refusal tests assert absence |
| approval→commit drift | live bundle validation, exact tree/cached inventory, no edits after QA/docs approval |
| malformed commit transport | schema validation, distinct digest, exact renderer, mode 0600, `git commit -F` |
| append-only retry collision | round/attempt namespaces, exact prior pairs, caps; failed outputs preserved and never reused |
| deployment shortcut | secure runner/controller preflight is mandatory; absence is an explicit stop |

## Definition of Done

- [ ] **R1:** exact approved plan records separate owner-authorized max-three
  finalization cycle without renaming/reusing closed QA rounds.
- [ ] **R2:** exact 62-path fixed state, all pins, index, T0, snapshot, and first
  docs-review identity validate with no drift.
- [ ] **R3:** all 15 finalization gates exit zero once per fresh round; bundle/token/
  tree validate and independent QA approves.
- [ ] **R4:** repo remains byte-identical after QA; docs manifest directly binds
  current typed inputs, QA review, and final 62-path tree; all retry finding IDs match.
- [ ] **R5:** attempt-specific multiline final artifact, sealed docs review, and
  rendered `git commit -F` bytes are independently reviewed and digest-equal.
- [ ] **R6:** plan F1-F6 and docs F1-F3 are resolved; sealed APPROVED docs review,
  manifests, docs, and debt agree immediately before staging.
- [ ] **R7:** only reviewed 62 paths are committed/PR-merged; supervised deployment
  either passes exact functional/signature checks and arms scheduling, or stops
  explicitly at an unmet secure-runner prerequisite without weakening controls.
