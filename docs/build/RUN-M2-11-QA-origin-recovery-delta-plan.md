# RUN M2-11 — QA Origin-Recovery Delta Plan (plan-v1)

**Status:** IN REVIEW — round-1 findings batched, awaiting independent re-review · **Owner authorization:** 2026-08-11, “authorization for
EVERYTHING within this repo … get it completed” · **Transport:** interactive-disk,
independent read-only review · **Candidate:** dedicated worktree
`codex/m2-11-t0-finalize` at `7391d947f72cf408a173f1e7938102608b2269d4`
with the approved cumulative unstaged M2-11 implementation and successful
append-only T0-v11.

## Goal and Success Criteria

Recover an honest, digest-bound QA origin for the already-built M2-11 candidate
without changing the external `orchestrate-tool`, rerunning DEV, reconstructing a
fictional pre-build state, or weakening product/release gates. Success means:

1. One repo-owned runner adopts the exact current candidate as a new explicit
   owner-authorized origin and records that it is not pre-build provenance.
2. It reruns every required repository gate from that frozen origin, verifies the
   immutable T0-v11 evidence without rerunning T0, and emits the complete v9 QA
   artifact family with content/digest/freshness bindings.
3. An independent read-only QA reviewer can verify the live tree plus the bundle
   under the explicit exception; no more than three QA rounds are used.
4. No product semantic, performance, payload, snapshot, release, or deployment
   contract changes.

## Requirements

- **R1 — Explicit owner exception, no invented history.** Record that the original
  pre-build origin bundle is unavailable because the installed QA-only harness
  predates the v9 review contract. The owner authorizes current-tree adoption.
  Never label adoption evidence as pre-build preservation.
- **R2 — Repo-local deterministic runner and validator.** Add one M2-11-specific
  runner under `scripts/` that owns both emission and validation of the exact
  `m2-11-adoption-qa/v1` schemas defined under Architecture. It refuses a
  non-dedicated worktree, wrong branch/HEAD/base, unapproved changed path,
  changed T0-v11/findings/plans/snapshot identity, existing/symlink output
  directory, snapshot sidecar, real-index change, or candidate change during gates.
- **R3 — Complete origin evidence.** Before gates, emit the exact adopted-source,
  isolated-feature, external-state/change/diff, changed-files, complete redacted
  baseline diff, candidate-pre-state, and task/base/plan/augmented-Dev-Notes/T0
  artifacts specified below. Every file is create-once, mode 0600, regular,
  nonsymlink, canonically serialized where JSON, and digest-bound.
- **R4 — Fresh canonical gates.** Run every literal command in the exact order
  listed under Testing Strategy. Retain an append-only `m2-11-gate-ledger/v1`
  row with direct exit/full redacted log/duration/pre-post fingerprint for each.
  Map the ledger deterministically into exactly one `test`, `lint`, `typecheck`,
  and `security` row in canonical `gate-results-v1`. Any nonzero required entry
  stops before QA synthesis.
- **R5 — Post-gate bindings.** Require the tracked/untracked candidate fingerprint
  to equal its pre-gate value; compute an approved-tree OID through a temporary
  Git index without staging the real index; emit candidate-state and a combined
  candidate token binding project, adopted source, external empty state, gates,
  and approved tree.
- **R6 — Complete v9 QA bundle and explicit exception transport.** Emit canonical
  `docs-commit-v1`, byte-identical augmented `dev-notes-v1`, `qa-report-v1`,
  `changed-files/v1`, redacted diff, `gate-results-v1`, every custom v1 artifact,
  their canonical core manifests, and one top-level adoption manifest binding all
  inputs. The owner exception explicitly supersedes only three generic qa-review
  preflights for this run: historical pre-build origin, earlier-run docs origin,
  and repository-local ownership of the generic validator. The repo-local runner
  is authoritative for custom schemas; the pinned external validator remains
  authoritative only for its existing Markdown/file-list/diff/gate/manifest schemas.
- **R7 — Independent QA and repair discipline.** A separate read-only agent uses
  `qa-review` plus the exact exception handoff below. The exception changes no
  substantive review check. Round N>1 requires the complete raw prior review and
  matching primary-authored resolution notes as required, digest-bound inputs.
  The primary batches fixes; a product/source repair invalidates all artifacts
  and cannot rerun T0-v11 under the old filename. Maximum three QA rounds.
- **R8 — Scope/release propagation.** Add this plan, runner, runner tests, and the
  final QA report/decision records to the exact cumulative release allowlist and
  later factual docs. External bundle/log files remain outside Git.

## Scope

Authorized repository writes for this recovery delta are exactly:

```text
docs/build/RUN-M2-11-QA-origin-recovery-delta-plan.md
docs/build/RUN-M2-11-QA-origin-decision.md
docs/build/RUN-M2-11-devnotes.md
docs/build/RUN-M2-11-qa-report.md
scripts/build_m2_11_qa_bundle.py
tests/test_m2_11_qa_bundle.py
```

After QA approval, the already-authorized parent/architecture/status/docs paths
may be finalized under the tail plan. Bundle output is append-only outside the
repository at
`/Users/johnbaek/projects/Populus-ops/snapshots/evidence/m2-11/qa-v9-round-N/`.

## Non-goals

- no change to payloads, SQLite, aggregation, serving, frontend behavior, tests
  outside the runner test, workflow deployment logic, bounds, or T0 implementation;
- no modification of `/Users/johnbaek/projects/orchestrate-tool` or user config;
- no claim that current-tree adoption recreates pre-build provenance;
- no second T0-v11 run and no mutation/deletion of prior evidence;
- no commit, PR, merge, variable mutation, or deployment before QA/docs approval.

## Constraints

- The recovery mechanism must live entirely in this Populus repository.
- Literal inputs are branch `codex/m2-11-t0-finalize`; HEAD
  `7391d947f72cf408a173f1e7938102608b2269d4`; fetched base
  `21340330a0fad7e9e39c1a9cec67656643621b05`; tail-plan SHA
  `068e7fc04edf61e0e3d25e40ff504b003faa0d0ab6d26fa65982a4899e119fad`;
  findings SHA
  `cf1739a8571f312231e2a842bd0fbe7521e6b2f4a5f522c2089bbd78957579fd`;
  T0-v11 SHA
  `7078a42934484c9c5ba7f975654476e0788c385dbaf8108c0d429a58ba91a453`,
  63,400 bytes/171 lines; snapshot SHA
  `977a4d249d92590a4de2961a3e9c7ff8cfa2e4846f0097ec7aa6c07f28124121`,
  23,058,628,608 bytes/mode 0444; and the exact inventories below.
- The runner may write only its new external round directory, temporary files,
  and Git object storage through a temporary index; it never stages the real index.
- Secrets are rejected/redacted; external-state forms are empty because this
  delta touches no user skills/config or external application state.
- The complete redacted patch is disk-only, never embedded in a prompt, and is
  validated with `WORKFLOW_MAX_ARTIFACT_BYTES=2097152` only for that one file.
  Default 1,048,576-byte validation remains for every other artifact. A patch over
  2,097,152 bytes, a truncation marker, or digest mismatch refuses.
- The installed external files are pinned read-only:
  `orchestrate.sh` SHA
  `22d85ebd01679bd44aa7a238e89bd15cc176bb5012b050c18a25e529f3ce2086`
  and `lib/workflow-artifacts.sh` SHA
  `afaa608b17b938abe8c2321d3405316a7ecf5e7d6fa2160cb5448f0d05856f97`.

## Current State

- Tail plan validates and remains at SHA-256
  `068e7fc04edf61e0e3d25e40ff504b003faa0d0ab6d26fa65982a4899e119fad`.
- Dev Notes validate at SHA-256
  `7c17058a6db4308daafa2e6b125eb6c4cadb28882f56df2140290c11544b0c3c`.
- T0-v11 is immutable at SHA-256
  `7078a42934484c9c5ba7f975654476e0788c385dbaf8108c0d429a58ba91a453`,
  63,400 bytes / 171 lines, direct exit 0; snapshot immutability passed.
- The installed v9 `qa-review` requires origin/provenance artifacts that
  `orchestrate-tool` QA-only does not emit. No prior `.orchestrate` origin bundle
  exists for this interactively built worktree. Independent read-only preflight
  confirmed that manually pretending otherwise is invalid.
- The current pre-recovery dirty inventory is exactly 54 paths (listed under
  Architecture). The final release inventory is exactly 60 paths: the tail
  plan's 56 plus this recovery plan, decision, runner, and runner test.

## Detected Stack

- **Languages:** Python 3.12.13; TypeScript/Astro under `dashboard/`.
- **Runners:** repository `.venv`, frozen `uv.lock`; npm 11 / Node 24 with lockfile.
- **Tests:** pytest, Node native tests, Astro check/build; Make owns canonical gates.
- **Storage:** immutable SQLite/JSON1 snapshot; static signed publication.
- **New recovery surface:** Python stdlib only (`argparse`, `hashlib`, `json`,
  `pathlib`, `subprocess`, `tempfile`); no dependency change.

## Reuse Map

| Need | Existing source reused | Decision |
|---|---|---|
| generic fingerprint | external `worktree_fingerprint` / `capture_worktree_fingerprint` | verify pinned external script SHA, source it with `ORCH_LIB_ONLY=1`, and reuse its exact content-sensitive HEAD/status/tracked-diff/untracked-byte token; no Python reimplementation |
| complete redacted diff | external `collect_diff` + `scrub_secret_values` | reuse under the same pinned script; custom runner adds only disk cap/digest checks |
| generic Markdown/file-list/gate/manifest schemas | pinned external `workflow-artifacts.sh` | invoke read-only for existing schemas; no copy or patch |
| preservation/delta helpers | `capture_preserved_source_state` / `capture_isolated_feature_delta` | do **not** call: they assert a historical separate source checkout/bridge-hunk model that the owner exception explicitly says does not exist here; custom adoption schemas state that difference |
| expected tree helper | `capture_expected_tree` | do **not** call: it depends on harness globals/leases and returns only an OID; use the same private-object/private-index Git design in the repo runner so inputs and real-index equality are independently inspectable |
| safe-file inventory | external `list_safe_files`, Git status | do **not** reuse the harness task-risk crawler; this run has literal 54-current/57-QA/60-release inventories and uses NUL-safe Git path enumeration plus exact equality |
| gates | approved tail plan/Makefile/package scripts | execute the exact commands below; no replacement gate |
| T0 evidence | append-only T0-v11 log and findings | verify exact identities; never rerun or summarize from memory |

Reuse-first scans include Markdown and the full workflow/evidence vocabulary. No
Populus bundle builder or origin-adoption schema exists. The two intentional
custom/parallel boundaries (adoption schemas and expected-tree wrapper) are
declared in Tech Debt with removal conditions.

## Architecture

### Exact runner surface

`scripts/build_m2_11_qa_bundle.py` contains only these module-level functions:

1. `sha256_file(path) -> str`
2. `canonical_json_bytes(value) -> bytes` (`sort_keys=True`, separators `(',',
   ':')`, UTF-8, `ensure_ascii=False`, exactly one trailing LF)
3. `run_checked(argv, cwd, env=None, accepted=(0,)) -> CompletedProcess`
4. `validate_fixed_state(repo, round_no) -> FixedState`
5. `changed_paths(repo) -> list[str]` (NUL-safe Git union, bytewise C sort)
6. `external_worktree_fingerprint(repo) -> str` (pinned helper wrapper)
7. `write_complete_redacted_diff(repo, output) -> str` (pinned helper wrapper)
8. `write_origin_artifacts(state, output_dir) -> dict[str, Path]`
9. `run_gate(entry, state, output_dir) -> GateRecord`
10. `write_gate_artifacts(records, state, output_dir) -> dict[str, Path]`
11. `build_approved_tree(state, output_dir) -> str`
12. `write_candidate_and_token(state, artifacts, output_dir) -> dict[str, Path]`
13. `write_markdown_artifacts(state, artifacts, output_dir) -> dict[str, Path]`
14. `write_phase_and_adoption_manifests(state, artifacts, output_dir) -> dict[str, Path]`
15. `validate_bundle(bundle_dir, live_repo=True) -> None`
16. `main(argv=None) -> int`

No class, plugin, daemon, generalized workflow API, or production import is added.

### Linear transaction

The runner has one linear transaction:

1. fail-closed preflight and candidate fingerprint;
2. create a new external round directory atomically;
3. emit honest adoption/external-empty/pre-state records;
4. execute exact gates serially, capturing direct exits and full logs;
5. refuse candidate-fingerprint or real-index drift;
6. build a temporary index/tree and post-gate candidate state;
7. emit the canonical augmented Dev Notes copy, exact provisional docs-commit,
   deterministic QA report, and existing-schema core artifacts;
8. compute the combined token now that every token part exists;
9. emit custom qa-gates, qa-synthesis, and qa-review-input manifests, each
   directly binding every v9 extra and the token;
10. emit the top-level adoption manifest last, validate every schema/digest, and
    print the exact bundle path/token.

No daemon, service, database, cache, or reusable generic workflow layer is added.

### Exact current and final inventories

The pre-implementation runner preflight accepts exactly these 54 current dirty
paths (add/delete status is separately compared to live Git; no symlink allowed):

```text
.github/workflows/publish.yml
ARCHITECTURE.md
Makefile
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
docs/runbooks/self-hosted-runner.md
scripts/accept_m2_11.py
scripts/accept_m2_8.py
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
tests/test_pointer_state.py
tests/test_publish.py
tests/test_workflow_governance.py
```

After T1-T5 the recovery runner accepts the exact 57-path QA candidate: the 54
above plus decision, runner, and runner test. `docs/build/RUN-M2-11-qa-report.md`
is the 58th release path only after independent QA approval.

### Exact custom schemas

All JSON objects reject unknown/missing keys. Integers are JSON integers (never
bool), digests are lowercase `sha256:<64 hex>`, paths are absolute for external
artifacts and repo-relative POSIX for inventories, arrays are bytewise-C sorted
where stated.

- `adopted-source-state/v1`: exactly `schema_version`, `origin_mode` equal
  `owner-authorized-current-tree-adoption`, `claim` equal
  `not-pre-build-provenance`, `owner_decision_digest`, `repo_root`, `worktree`,
  `branch`, `head`, `fetched_base`, `head_is_ancestor` true,
  `origin_worktree_fingerprint`, `real_index_sha256`, `adopted_at_utc`.
- `isolated-feature-adoption/v1`: exactly `schema_version`, `baseline_commit`
  (HEAD), `fetched_base`, `worktree`, `changed_files_digest`,
  `baseline_diff_digest`, `origin_worktree_fingerprint`, `expected_paths` (the
  exact 57 sorted paths), `historical_source_checkout` null,
  `overlapping_user_hunks` null, and `claim` equal
  `current-tree-adoption-no-historical-overlap-claim`.
- `external-state/v1`: exactly `schema_version`, `scope`=`none`, `paths`=[], and
  `token` equal `sha256(SHA256("populus-m2-11-external-state-v1\0[]\n"))`.
- `external-changes/v1`: exactly `schema_version`, `before_token`, `after_token`
  (both the external token), and `changes`=[]; the redacted external diff is the
  exact UTF-8 line `# No external state in scope; no external changes.\n`.
- `changed-files/v1`: installed schema, exact 57 bytewise-C-sorted paths.
- `m2-11-gate-ledger/v1`: exactly `schema_version`, `round`,
  `origin_worktree_fingerprint`, `entries`; each entry exactly `ordinal`, `id`,
  `kind`, `command`, `scope`, `started_at`, `completed_at`, `duration_seconds`,
  `exit_code`, `status`, `log_path`, `log_digest`, `pre_fingerprint`,
  `post_fingerprint`. Ordinals are contiguous from 1; every fingerprint equals
  origin; success requires every required exit 0.
- `approved-tree/v1`: exactly `schema_version`, `baseline_commit`, `tree_oid`
  (40 lowercase hex), `expected_paths`, `real_index_before_sha256`,
  `real_index_after_sha256` equal, `private_object_dir_removed` true.
- `candidate-state/v1`: exactly `schema_version`, `round`, `repo_root`, `branch`,
  `head`, `fetched_base`, `head_is_ancestor`, `worktree_fingerprint`,
  `real_index_sha256`, `changed_files_digest`, `baseline_diff_digest`,
  `gate_ledger_digest`, `gate_results_digest`, `approved_tree_oid`,
  `tail_plan_digest`, `recovery_plan_digest`, `dev_notes_digest`,
  `findings_digest`, `t0_log_digest`, `t0_log_bytes`, `t0_log_lines`,
  `snapshot_digest`, `snapshot_bytes`, `snapshot_mode`, `snapshot_sidecars`.
- `combined-candidate-token/v1`: exactly `schema_version`, `algorithm`, `parts`,
  `token`. `parts` has exactly the sorted names `approved-tree`,
  `baseline-diff`, `candidate-state`, `changed-files`, `dev-notes`,
  `docs-commit`, `external-changes`, `external-diff`, `external-state`,
  `gate-ledger`, `gate-results`, `isolated-feature`, `owner-decision`, `plan`,
  `qa-report`, `source-preservation`; each value is that file's digest.
- `adoption-qa-manifest/v1`: exactly `schema_version`, `round`,
  `owner_exception` true, `exception_scope` (the exact three-item sorted array
  named by R6), `base_ref`, `worktree_digest`, `combined_candidate_token`,
  `core_manifest_digests`, `artifacts`, `prior_round`; every artifact record has
  exactly `name`, `path`, `digest`, `schema`, `required` true. Round 1 has
  `prior_round` null. Round N>1 contains exact prior-review and resolution-notes
  artifact records and rejects a missing/extra pair.
- `m2-11-phase-manifest/v1`: exactly `schema_version`, `phase`, `round`,
  `base_ref`, `worktree_digest`, `output`, `inputs`; `phase` is one of
  `qa-gates`, `qa-synthesis`, `qa-review-input`, `qa-review`, `docs-review`.
  `output` and each `inputs` item use the exact artifact-record shape above;
  input names are unique and bytewise-C sorted. Every phase requires exactly one
  each of `owner-exception`, `docs-commit`, `source-preservation`,
  `isolated-feature`, `external-state`, `external-changes`, `external-diff`,
  `approved-tree`, `candidate-state`, and `combined-candidate-token`, in
  addition to its normal plan/Dev Notes/changed-files/diff/gates/report/review/
  docs inputs. No phase-manifest digest is a combined-token part.

Canonical serialization for every custom JSON file is
`json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)`
encoded UTF-8 plus one LF. `validate_bundle` reparses, rejects duplicate JSON
keys using `object_pairs_hook`, reserializes byte-for-byte, checks schema/key/type/
ordering semantics, then rehashes every input.

### Fingerprint, diff, tree, and token algorithms

- Fingerprint is exactly the pinned external `worktree_fingerprint`: SHA-256 over
  its framed HEAD, NUL porcelain, binary tracked diff, and C-sorted untracked
  path/type/content digest records, excluding only `.orchestrate`.
- Changed paths are the NUL-safe union of `git diff --name-only -z HEAD --` and
  `git ls-files --others --exclude-standard -z --`, decoded with filesystem
  surrogate escaping, rejected if absolute/`..`/symlink/nonregular, de-duplicated,
  and sorted by `os.fsencode` under C semantics.
- Complete diff is exactly pinned `collect_diff | scrub_secret_values`: binary
  tracked diff plus every sorted untracked file's `/dev/null` patch. It must be
  nonempty, contain no truncation sentinel, validate as `redacted-diff-v1` with the
  one-file 2,097,152-byte cap, and hash-match the manifest.
- Approved tree uses a 0700 `TemporaryDirectory` outside the repo, private
  `GIT_INDEX_FILE` and `GIT_OBJECT_DIRECTORY`, read-only absolute real objects as
  `GIT_ALTERNATE_OBJECT_DIRECTORIES`, then sanitized `git read-tree HEAD`,
  `git add -A -- .`, exact cached-name equality to the 57 paths, and
  `git write-tree`. The real index SHA is identical before/after; the private
  object directory is removed after recording the OID.
- Combined token is
  `sha256:` plus SHA-256 of byte tag
  `populus-m2-11-adoption-candidate-v1\0` followed by canonical JSON bytes of
  the exact `parts` object above. Reviewer recomputation is
  `python scripts/build_m2_11_qa_bundle.py validate --bundle <absolute-dir>`;
  success prints only `VALID <token>` and exits 0.

### Manifest graph and exception handoff

The manifest construction graph is acyclic and locked:

1. create every raw/core artifact, including docs-commit and QA report;
2. create candidate-state;
3. compute the token from raw artifact digests (never a manifest digest);
4. create installed-validator manifests for the existing schemas;
5. create custom `qa-gates`, `qa-synthesis`, and `qa-review-input` phase
   manifests, each directly binding every v9 extra and the token;
6. create the top-level adoption manifest last, binding those phase-manifest
   digests plus every raw/core artifact.

The installed-validator QA-report manifest still binds the standard plan/Dev
Notes/changed-files/baseline-diff/gate-results inputs. The custom phase manifests
supply the required direct v9 bindings without claiming the old validator knows
the custom schemas. No manifest is a token part, so no cycle exists. The reviewer
is handed the adoption manifest plus `qa-review-input.manifest.json`, validates
both through the repo runner, and is instructed:

```text
Owner exception for RUN M2-11 only: accept the validated adopted current tree as
the origin; accept same-run provisional docs origin; use the repo-local validator
for custom schemas. Do not waive freshness, completeness, security, substantive
QA, or final docs review. Read the complete baseline diff from its on-disk path.
```

The provisional docs artifact is exactly one line:
`COMMIT_MESSAGE: feat(inst): publish bounded institutional data`. It is not the
final commit authority; post-QA factual docs and docs-review produce/review the
message actually passed to `git commit -F`.

The repository Dev Notes are augmented **after** runner implementation/tests and
**before** bundle capture with this recovery plan/review, exact changed paths,
tests, exception/debt, and model provenance. The external Dev Notes are a
byte-identical copy; the stale pre-recovery digest `7c1705…` is evidence of the
starting file only and is not used by QA.

After a reviewer returns, `seal-review` validates the exact seven-section result,
copies it byte-for-byte into the create-once round directory, and emits
`qa-review.manifest.json` with the same complete required input set plus the
adoption-manifest digest. It does not change the combined token. After QA and
factual docs finalization, `seal-docs` captures the final-docs fingerprint/tree
and emits `docs-review.manifest.json`, binding every original v9 extra and token
directly plus the approved QA review/adoption manifest and final docs/tree
artifacts. The original QA provenance and later docs freshness are both explicit;
neither token includes a manifest that binds it.

## Locked Decisions

1. Current-tree adoption time is the recovery origin; it is not backdated.
2. Adoption exception covers only historical-origin absence caused by the
   harness/skill version skew; all current evidence remains mandatory.
3. The runner is M2-11-specific and literal, minimizing generalized governance risk.
4. Round directories are create-once; fixes use the next round number.
5. Product/source fixes require all gates again and a new bundle; T0-v11 remains
   immutable and cannot be rerun.
6. Final docs mutation/review stays after QA, matching the user and approved tail plan.
7. GitHub/production actions remain gated on independent QA and docs approval.

## Alternatives Considered

- **Patch `orchestrate-tool`: rejected.** The owner authorized this repo, not the
  separate tool repository; it would still lack a genuine historical bundle.
- **Run current QA-only anyway: rejected.** It deterministically omits mandatory
  artifacts and would waste a QA round.
- **Reconstruct a pre-build origin: rejected.** That would be false provenance.
- **Rebuild through the normal runner: rejected.** It reruns DEV, changes the
  approved sequence, and risks diverging from the one-shot T0-bound candidate.
- **Skip independent QA: rejected.** Owner urgency does not waive substantive QA.

## Planned Files

| Path | Change | Requirements |
|---|---|---|
| `docs/build/RUN-M2-11-QA-origin-recovery-delta-plan.md` | reviewed exception plan | R1-R8 |
| `docs/build/RUN-M2-11-QA-origin-decision.md` | exact owner decision, review verdict, adopted identities | R1, R7, R8 |
| `scripts/build_m2_11_qa_bundle.py` | literal repo-local origin/gate/bundle runner | R2-R6 |
| `tests/test_m2_11_qa_bundle.py` | fail-if-removed preflight, redaction, drift, exit, token, manifest tests | R2-R6 |
| `docs/build/RUN-M2-11-devnotes.md` | add recovery decision/results without rewriting implementation evidence | R6-R8 |
| `docs/build/RUN-M2-11-qa-report.md` | copy independently approved final QA report after verdict | R7, R8 |

## Implementation Tasks

- **T1 [R1,R8]:** Validate/review this plan, then add the owner decision record
  with exact exception boundary and no approval claim until review passes.
- **T2 [R2,R3,R5]:** Implement literal preflight, fingerprint, complete diff,
  adopted-source/external-empty records, temporary-index approved tree, and
  combined token with refusal cleanup.
- **T3 [R4]:** Implement the exact serial gate list, direct exit/full log capture,
  per-gate candidate-drift check, and T0/snapshot verification-only record.
- **T4 [R6]:** Emit canonical docs-commit, QA report, all artifact objects, and a
  digest-valid manifest binding every required v9 input; validate before success.
- **T5 [R2-R6]:** Add unit/integration tests that remove or corrupt each required
  guard/artifact and prove refusal without running full gates.
- **T6 [R4-R7]:** Run focused runner tests and all exact gates through the runner;
  submit the frozen bundle to a separate QA reviewer and batch any fixes, maximum
  three rounds.
- **T7 [R8]:** After approval, copy the exact review/QA report into the cumulative
  release inventory and continue factual docs review/PR/deployment.

## Testing Strategy

Focused recovery tests:

```bash
PYTHONDONTWRITEBYTECODE=1 .venv/bin/python -m pytest -q tests/test_m2_11_qa_bundle.py
```

Tests cover wrong root/branch/HEAD, unexpected path, symlink/output collision,
real-index drift, candidate drift, redaction, secret-looking inputs, failed gate,
missing/truncated T0, snapshot sidecar/hash/mode, incomplete external empty forms,
temporary-index isolation, approved-tree/token determinism, missing manifest input,
digest tamper, invalid content schema, and success over a tiny synthetic Git repo.

The binding recovery run then executes all R4 commands itself. It never executes
T0; it verifies the exact retained T0 evidence.

Exact append-only gate-ledger execution order (no command is combined with
another and each direct exit is captured):

```text
1  git diff --check
2  PYTHONDONTWRITEBYTECODE=1 .venv/bin/python -m pytest -q tests/test_m2_11_qa_bundle.py
3  PYTHONDONTWRITEBYTECODE=1 .venv/bin/python -m pytest -q tests/test_inst_shard_budget.py tests/test_inst_snapshot_script.py
4  (cd dashboard && node --test test/filer-payload.test.ts test/post/entity-orchestration.test.ts)
5  PYTHONDONTWRITEBYTECODE=1 .venv/bin/python -m pytest -q tests/test_inst_agg.py tests/test_cover_tolerance.py tests/test_inst_external_store.py tests/test_inst_snapshot_script.py tests/test_inst_serving.py tests/test_inst_serving_artifact.py tests/test_inst_shard_budget.py tests/test_digests.py tests/test_publish.py tests/test_amendments.py tests/test_mcp_server_inst.py tests/test_inst_federated_boundary.py tests/test_pointer_state.py tests/test_workflow_governance.py
6  POPULUS_PREVIOUS_CLIENT_SHA=7391d947f72cf408a173f1e7938102608b2269d4 PYTHONDONTWRITEBYTECODE=1 .venv/bin/python -m pytest -q tests/test_pointer_state.py -k inst_schema_1_1_previous_client
7  (cd dashboard && node --test --test-concurrency=1 test/post/fixture-preview.test.ts)
8  PYTHONDONTWRITEBYTECODE=1 .venv/bin/python -m pytest -q tests/test_workflow_governance.py
9  make check
10 make security
11 make accept-m1-b
12 make accept-m2-5
13 make accept-m2-6
14 make accept-m2-8
15 make accept-m2-11
```

The canonical four surfaces map exactly as follows:

- `lint`: ledger entry 1, command/scope/log/exit copied verbatim.
- `typecheck`: ledger entry 9, command `make check (Astro check subgate)`, same
  full `make check` log/exit, source `Makefile:check`, scope `dashboard full tree`.
- `security`: ledger entry 10 verbatim.
- `test`: one aggregate record whose command is
  `M2-11 gate ledger entries 2-9,11-15`; output is a deterministic concatenation
  of those entry headers and full logs; exit 0 only if every named entry exits 0;
  source `owner-approved recovery ledger`; scope `complete candidate, focused,
  expanded, compatibility, build, post-build, and five acceptances`.

The T0/snapshot verification is not mislabeled as a rerun gate: it is a distinct
immutable-evidence record in candidate-state and must pass before entry 1.

### Round 2/3 convergence

Round 1 command:

```bash
PYTHONDONTWRITEBYTECODE=1 .venv/bin/python scripts/build_m2_11_qa_bundle.py run \
  --round 1 \
  --output /Users/johnbaek/projects/Populus-ops/snapshots/evidence/m2-11/qa-v9-round-1
```

If review requests changes, the raw exact seven-section result is preserved as
`qa-review.round-N.md`. The primary writes `resolution-notes.round-N.md` with one
record per F-id (`finding`, `change`, `guard`, `status`) and no approval claim.
After one batched fix and all freshness invalidation, the next command is:

```bash
PYTHONDONTWRITEBYTECODE=1 .venv/bin/python scripts/build_m2_11_qa_bundle.py run \
  --round 2 \
  --prior-review /absolute/path/qa-v9-round-1/qa-review.round-1.md \
  --resolution-notes /absolute/path/qa-v9-round-1/resolution-notes.round-1.md \
  --output /Users/johnbaek/projects/Populus-ops/snapshots/evidence/m2-11/qa-v9-round-2
```

Round 3 is identical with `--round 3` and round-2 paths. The runner rejects N>1
without the exact N-1 pair, wrong final review verdict schema, unresolved/missing
F-id, digest change, reused output, skipped round, or N>3. A product/source fix
also triggers the tail plan's T0 invalidation and needs newly authorized binding
evidence; an evidence-only recovery-script/test/doc fix reruns all 15 commands and
uses the next QA directory without touching T0-v11.

Reviewer invocation each round is the existing separate `plan_reviewer` agent
reassigned to strict `qa-review`, with the absolute adoption-manifest path,
`validate` command, exception handoff block, and prior pair when N>1. The reviewer
is read-only; the primary alone changes files.

Immediately after each returned review, preserve and bind it without changing
the candidate or token:

```bash
PYTHONDONTWRITEBYTECODE=1 .venv/bin/python scripts/build_m2_11_qa_bundle.py seal-review \
  --bundle /absolute/path/qa-v9-round-N \
  --review /absolute/path/to/reviewer-output.md
```

After QA approval and final factual docs, the docs-review bundle is sealed with:

```bash
PYTHONDONTWRITEBYTECODE=1 .venv/bin/python scripts/build_m2_11_qa_bundle.py seal-docs \
  --bundle /absolute/path/approved-qa-round \
  --qa-review /absolute/path/approved-qa-review.md \
  --output /Users/johnbaek/projects/Populus-ops/snapshots/evidence/m2-11/docs-v9-final
```

## Verification Matrix

| Requirement | Proof |
|---|---|
| R1 | decision record says adoption/not pre-build; reviewer verifies owner message and no false claim |
| R2 | focused negative tests plus wrong-state live preflight |
| R3 | bundle contains every named artifact and complete on-disk redacted diff |
| R4 | 15 ledger direct exits/log hashes; deterministic four-surface map; all zero; fingerprint unchanged |
| R5 | real index pre/post hash, private tree OID, exact candidate state and tagged token recomputation |
| R6 | pinned generic validators plus repo custom validator, core graph and adoption-manifest completeness |
| R7 | prior review/resolution pair on N>1; independent seven-section verdict; at most three directories |
| R8 | exact 60-path release allowlist/equality/staging proof; external evidence absent from Git |

## Rollout / Rollback

Rollout is evidence-only until QA approves. A preflight/gate/bundle failure leaves
the create-once external directory for audit, makes no Git/production mutation,
and stops. Code/test defects are fixed in one batch and use the next QA round.
Rollback before commit is simply no release action; recovery artifacts remain
auditable. After merge, normal M2-11 signed-pointer rollback applies. Never delete
or overwrite T0 or QA evidence.

After QA and docs approval, this plan supersedes the tail plan's staging array
with the exact 60-path cumulative release inventory:

```bash
release_allowlist=(
  .github/workflows/publish.yml
  ARCHITECTURE.md
  Makefile
  STATUS.md
  dashboard/src/lib/data.ts
  dashboard/src/lib/filer-payload.ts
  dashboard/src/lib/holdings.ts
  dashboard/src/lib/shards.ts
  dashboard/package.json
  'dashboard/src/pages/institutional/data/filers/[shard].v1.json.ts'
  'dashboard/src/pages/institutional/data/filers/[shard].v2.json.ts'
  dashboard/src/pages/institutional/data/filers/index.v1.json.ts
  dashboard/src/pages/institutional/data/filers/index.v2.json.ts
  dashboard/src/scripts/entity-client.ts
  dashboard/test/filer-payload.test.ts
  dashboard/test/post/entity-orchestration.test.ts
  dashboard/test/post/file-budget.test.ts
  dashboard/test/post/fixture-preview.test.ts
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
test "$(wc -l < "$expected_names" | tr -d ' ')" = 60
{
  git diff --name-only -z HEAD
  git ls-files --others --exclude-standard -z
} | tr '\0' '\n' | sed '/^$/d' | LC_ALL=C sort -u > "$actual_names"
diff -u "$expected_names" "$actual_names"
git add -- "${release_allowlist[@]}"
git diff --cached --name-only | LC_ALL=C sort -u > "$cached_names"
diff -u "$expected_names" "$cached_names"
```

The two `diff -u` equality checks and the literal count are the gates. Before
commit, re-run `git diff --cached --name-only` equality, `git diff --cached
--check`, and verify no external QA/T0 path is cached. The reviewed commit message
is written to a temporary file with mode 0600 and executed as `git commit -F
<file>`; no heredoc. Fixed-base PR/merge/deploy then follows the tail plan exactly.

## Simplicity Audit

One M2-11-specific Python script and one test file are the minimum honest bridge.
The script uses Git and the installed validator rather than vendoring workflow
libraries. It generalizes nothing, opens no API, and is removable after the
release only through a later reviewed cleanup. The decision record makes the
one-time exception visible instead of embedding a silent bypass. The exact 16
functions and every custom schema are enumerated under Architecture. The script
wraps the mature external fingerprint/diff/validator functions; it intentionally
does not reuse preservation/delta/expected-tree helpers whose historical-source
premises do not match this owner-authorized adoption.

## Tech Debt Introduced

Three declared, bounded debt items:

- **TD-QA-ORIGIN-1:** a run-specific recovery script/test remains because the
  external harness lacks v9 QA-only origin adoption. It has no production import.
- **TD-QA-ORIGIN-2:** Populus temporarily owns custom adoption/candidate/external/
  token schemas not recognized by the generic validator. Control: exact schemas,
  custom validator, negative tests, and owner-exception handoff; no silent generic
  compatibility claim.
- **TD-QA-ORIGIN-3:** private-index expected-tree and adoption evidence overlap
  mature harness concepts. Control: fingerprint/diff/schema logic is reused where
  premises match; the two reimplemented boundaries are small and fully tested.

All three share one removal condition: after `orchestrate-tool` natively emits
and the unchanged qa-review accepts the complete v9 QA-only adoption bundle, a
separate reviewed cleanup proves no active recovery use. No production debt,
security waiver, or product bound change is introduced.

## Memory Touch-Points

Exact deterministic selection:

```bash
/Users/johnbaek/projects/orchestrate-tool/lib/memory-select.sh \
  /Users/johnbaek/.claude/projects/-Users-johnbaek/memory/MEMORY.md \
  qa origin recovery provenance docs commit candidate token approved tree external state
```

It returned and the primary/reviewer read:
`feedback_git_commit_f_not_heredoc.md` (use `git commit -F`),
`feedback_qa_fail_batch_remediation.md` and
`feedback_qa_remediation_discipline.md` (batch/no self-sign/current artifacts),
`feedback_state_guarded_update_idempotency.md` (create-once round directories),
`project_trading_routines_final_state.md` (checked; no relevant routine mutation),
`feedback_doc_drift_multisource.md` (reconcile identities across code/log/tests),
`feedback_full_tree_gate_scope.md` (literal full gates),
`feedback_merged_reverted_master_idempotent.md` (tree identity at merge),
`feedback_orchestrate_workflow.md` (dedicated branch/worktree), and
`feedback_plan_write_denied.md` (checked; plan is truthfully persisted, so no
permission-denied fallback). The full shared failure-mode catalog was loaded.

## Failure-Mode Sweep

- **F0:** complete path inventory, secret redaction/rejection, functional—not
  liveness—deployment remains mandatory.
- **F1:** stable R1-R8 trace to tasks/matrix/DoD; exception boundary is locked.
- **F2:** full gates in the dedicated worktree; every new guard has a removal-fails
  test; no shared validator is copied.
- **F3:** candidate/doc numbers reconcile to code, tests, T0, and snapshot.
- **F4:** any finding is batched/retested/re-reviewed; final docs remain after QA.
- **F5:** every transport artifact is schema/digest/freshness bound; a source edit
  invalidates the bundle; adoption is explicit rather than inferred.

## Definition of Done

- [ ] **R1** owner decision and independent plan approval explicitly authorize
  current-tree adoption without claiming pre-build provenance.
- [ ] **R2** runner refuses every wrong state/path/collision/drift case.
- [ ] **R3** complete adoption/external/candidate/diff evidence exists once outside Git.
- [ ] **R4** every exact gate exits zero with full retained log and stable fingerprint.
- [ ] **R5** approved tree, real-index equality, candidate state, and combined token recompute.
- [ ] **R6** docs-commit/Dev Notes/QA report/manifest validate and bind every v9 input.
- [ ] **R7** independent QA approves within three rounds with no open blocker/debt.
- [ ] **R8** final inventory/docs include recovery paths while external logs remain unstaged.
