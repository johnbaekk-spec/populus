# RUN M2-11 — Release-Hygiene Finalization Repair Plan

## Goal and Success Criteria

Remove exactly 13 two-space Markdown line endings that made the mandatory
post-stage `git diff --cached --check` refuse the otherwise QA/docs-approved
round-7 tree. Extend only the existing release-specific evidence runner and
focused tests enough to bind that exact failure, execute one create-once logical
QA round 8, and make the private approved-tree construction exercise the same
staged whitespace check before downstream evidence is created.

Success means the exact 13 old `0x20 0x20 0x0a` suffixes become `0x0a`; no other
byte in those eight artifacts changes; every non-governance/product byte remains
identical to round 7; the exact 72-path round-8 candidate passes focused checks
and all 15 standing gates; fresh independent QA and docs attempt 3 approve; the
post-stage validator passes without configuration overrides; and the existing
fixed-base PR/merge and supervised functional deployment complete. Any extra
whitespace edit, product/T0 drift, gate/review rejection, round 9 request, docs
attempt 4 request, or validation/configuration relaxation stops.

## Requirements

- **R1 — Exact owner boundary.** Implement only the quoted release-hygiene
  authority under one literal sorted exception scope, run ID
  `RUN-M2-11-QA-finalization-release-hygiene-exception`, logical round 8, cap 8
  with explicit owner override, strict `owner-decision-v2`, and no round 9.
- **R2 — Exact 13-line byte delta.** Across the eight named governance files,
  replace only the 13 listed two-space line endings with newline. Preserve every
  other byte and reject missing, additional, relocated, or tab-based edits.
- **R3 — Pre-evidence staged hygiene gate.** Reuse `build_approved_tree`'s private
  index and add `git diff --cached --check` after exact-path staging and before
  `write-tree`. Decompose computation from record persistence so the private
  check runs before the create-once bundle/docs output directory exists. It must
  fail without consuming output or changing the real index and must be covered
  by success/removal-fails tests.
- **R4 — Exact approved release predecessor.** Accept only the sealed round-7
  docs-attempt-2 APPROVED review at its exact path and pins. Validate its input
  manifest, review manifest, QA seal, token, fingerprint, tree OID, final-message
  digest, and 70 paths before accepting the exact release-gate resolution.
- **R5 — One round-8 bundle.** Add one digest-scoped cycle branch for round 8,
  exact 72-path QA/release equality, docs attempt 3, TD-QA-ORIGIN-9, and the same
  15 direct gates. T0/full-corpus commands remain absent.
- **R6 — Exact docs-attempt-3 transition.** Because attempts 1 and 2 are sealed,
  the repaired candidate uses `final-docs-commit.finalization-r8-a3.md`. Permit
  `seal-docs --attempt 3` to consume the exact prior APPROVED docs review only
  for this release-hygiene cycle and its exact resolution. Attempt 4 refuses.
- **R7 — Same-candidate release and deployment.** Only sealed round-8 QA plus
  sealed docs-attempt-3 approval may authorize pre/post-stage validation,
  exact-tree release, fixed-base PR/merge, and the already-approved supervised
  functional deployment. Every sequential block runs fail-fast with pipeline
  propagation. Pre-commit failure restores and revalidates the empty index;
  pre-merge failure closes and reads back the exact PR; deployment rollback must
  successfully list variables before proving absence. No whitespace
  configuration override is allowed.
- **R8 — Factual append-only reporting.** Dev Notes and QA report record the
  round-7/docs approvals, post-stage refusal, index rollback, exact repair,
  focused results, pending outcomes, and TD9 without rewriting prior evidence.

## Scope

Authorized repository writes are exactly these 14 paths:

1. `docs/build/RUN-M2-11-QA-finalization-release-hygiene-decision.md`
2. `docs/build/RUN-M2-11-QA-finalization-release-hygiene-plan.md`
3. `docs/build/RUN-M2-11-QA-finalization-F3-decision.md`
4. `docs/build/RUN-M2-11-QA-finalization-F3-plan.md`
5. `docs/build/RUN-M2-11-QA-finalization-F4-F5-decision.md`
6. `docs/build/RUN-M2-11-QA-finalization-decision.md`
7. `docs/build/RUN-M2-11-QA-finalization-exception-decision.md`
8. `docs/build/RUN-M2-11-QA-finalization-repair-decision.md`
9. `docs/build/RUN-M2-11-QA-finalization-repair-plan.md`
10. `docs/build/RUN-M2-11-QA-origin-decision.md`
11. `docs/build/RUN-M2-11-devnotes.md`
12. `docs/build/RUN-M2-11-qa-report.md`
13. `scripts/build_m2_11_qa_bundle.py`
14. `tests/test_m2_11_qa_bundle.py`

Authorized append-only external outputs are one exact release-gate resolution,
one round-8/attempt-3 final-message artifact, one
`qa-v9-finalization-round-8/` bundle and its independent review/seal, and one
`docs-v9-finalization-r8-a3/` bundle and its independent review/seal.

No product, dashboard, database, serving, aggregate, payload, build, workflow,
runbook, acceptance, dependency, T0, snapshot, prior evidence, or generic
orchestrator file is writable.

## Non-goals

- No product correctness, behavior, performance, schema, payload, route, UI,
  resource, signature, security, publication, or deployment-policy change.
- No T0-v11 or full-corpus rerun and no snapshot write.
- No edit, seal, rewrite, relabel, or deletion of rounds 1–7 or docs attempts 1–2.
- No generic whitespace framework, formatter, lint policy, dependency, second
  evidence runner, or orchestrate-tool change. The local `owner-decision-v2`
  route is limited to the round-8 authority artifact.
- No Git configuration override, `.gitattributes` exception, path exclusion, or
  weakened `git diff --cached --check` invocation.
- No round 9, docs attempt 4, or self-approval.

## Constraints

- Worktree is `/Users/johnbaek/projects/Populus-m28/.claude/worktrees/m2-11`,
  branch `codex/m2-11-t0-finalize`, HEAD
  `7391d947f72cf408a173f1e7938102608b2269d4`, and fixed base
  `21340330a0fad7e9e39c1a9cec67656643621b05`; the real index is empty.
- Pre-plan repair state is the exact 70-path round-7 candidate at fingerprint
  `68235db92732e15d96acfae48691bee5d418d7cbd618f70552628bf14203883a`.
- Round-7 bundle token is
  `sha256:4254a0ef9a7093ee4168fdd210c9128e2c08193f8885ad461270e114bb4c2100`;
  adoption SHA-256 is
  `39f81b7f1fe9c192c10a97ae4082301663820c18d774ad66b364168dab99b537`;
  combined-token-file SHA-256 is
  `52af42e7d3a0975204a8cb34be40f922b4ab23efed1a05e99168761be8e159b8`;
  sealed QA-review SHA-256 is
  `5ede9cdb8b05b4577375e9029eaed8100e6b4b8070762e071b776eb6dcef6b91`;
  and QA-review-manifest SHA-256 is
  `6d5a7aab482a99c397435eb179174e4af35fb60c2930925a93d731e61817a458`.
- Docs-attempt-2 input-manifest SHA-256 is
  `bbf9dc93eab30a672f0148059982f82e7d4b5d2a87c86099ae092f81b6b33e65`;
  sealed APPROVED review SHA-256 is
  `f227fd8b0c82bbea5d48ac0f3b149474efe7a564c326a4dd021cf24b45028566`;
  docs-review-manifest SHA-256 is
  `d001e73c0d5eb145d02b874e180509e50b31823c4eba134f29847d0fb66882b2`;
  approved-tree SHA-256 is
  `35ee7dc7eecfa13129f677065a18c44739f3a7c8a3259a87d51aa580e2e391fe`;
  and tree OID is `de5068f0da644bd543fc7433d14b1f46ba3f9d3f`.
- Round-7 baseline diff is 1,618,959 bytes at SHA-256
  `5df700017061011eb60f6548250189fedd63f12b602d2a8efa0947569e231437`.
  It remains review provenance but is redacted and is not a byte-parity source.
- The approved round-7 tree OID
  `de5068f0da644bd543fc7433d14b1f46ba3f9d3f` remains readable as a Git tree,
  contains 559 entries, and `git archive --format=tar
  --mtime=1970-01-01T00:00:00Z` produces a deterministic archive at SHA-256
  `b10b85d710dbbc6716b0b9dde0dc6425703816db7c2c841a1112be6985433273`.
  It is the sole exact pre-repair byte source.
- Final docs-attempt-2 message SHA-256 is
  `ea63c59cf09b2ebdec7c0392236e26ae778c49667591c46c504fd9be31b31ebf`.
- T0-v11 remains 63,400 bytes / 171 lines at SHA-256
  `7078a42934484c9c5ba7f975654476e0788c385dbaf8108c0d429a58ba91a453`.
- Snapshot remains 23,058,628,608 bytes, mode `0444`, sidecar-free, at SHA-256
  `977a4d249d92590a4de2961a3e9c7ff8cfa2e4846f0097ec7aa6c07f28124121`.
- Evidence is create-once, mode 0600/0700, append-only, and never overwritten.
- Any repository byte change invalidates round-7 release authority and requires
  the complete round-8 gate/review chain. A failure after round 8 stops.

## Current State

- Round 7 completed all 15 gates and independent QA APPROVED F4/F5 resolution.
- Docs attempt 1 rejected only a one-paragraph message; attempt 2 resolved that
  finding and independent docs review APPROVED the same exact repository tree.
- Pre-stage release validation passed. The then-current 70-path staged tree
  exactly matched the reviewed tree OID, but
  `git diff --cached --check` returned 13 trailing-whitespace errors. The release
  validator stopped before a commit; the primary restored the real index to its
  prior empty state and revalidated the 70-path fingerprint.
- Direct inspection of the failed staged check and the readable approved Git
  tree identifies exactly 13 two-space endings across eight governance files.
  The redacted baseline diff is provenance only; no product path is implicated.

## Detected Stack

- **Languages:** Python 3.12.13 and TypeScript/Astro on Node 24.16.0.
- **Python runner:** repository `.venv` with pytest; Make owns complete gates.
- **Node runner:** npm 11.13.0 and Node-native/Astro test/build commands.
- **Storage/publication:** SQLite/JSON1, signed static data, GitHub Actions.
- **Canonical gates:** the unchanged 15 commands in Testing Strategy.
- **Stack cache:** absent; manifests, lockfiles, Makefile, and package scripts
  were inspected directly.

## Reuse Map

| Need | Existing implementation | Locked reuse |
|---|---|---|
| private staged tree | `build_approved_tree` and its temporary index/object store | split its computation from record persistence, add one staged check, and reuse the returned record after gates prove no fingerprint drift |
| exact path inventory | `EXPECTED_QA_PATHS == EXPECTED_RELEASE_PATHS` | add two governance paths; retain one shared 72-path tuple |
| fixed candidate state | `validate_fixed_state` and worktree fingerprint | reuse without a second state/fingerprint implementation |
| sealed QA/docs graphs | `validate_sealed_qa_review`, `validate_sealed_docs_review` | compose one exact round-7 release predecessor validator |
| retry transport | digest-derived cycle branches, `prior_round`, phase manifests | add one round-8 branch and one attempt-3 special case only |
| resolution artifact | `resolution-notes-v1` | exact `gate-release-diff-check` heading; no new schema family |
| baseline comparison | readable approved round-7 Git tree OID | archive the exact tree into a temporary directory and compare bytes; never use the redacted patch as source |
| release | existing `validate-release`, message renderer, fixed-base PR/deploy steps | no release bypass or parallel command path |
| clean decision grammar | local `owner-decision-v1` grammar and artifact dispatcher | add exact v2 date-line grammar for round 8; retain v1 for immutable rounds 1–7 |

The repository scan found one M2-11 evidence runner, one focused test module,
one release validator, and one private approved-tree builder. No alternative
whitespace gate, retry runner, docs renderer, or deployment guide is needed.

## Architecture

### A. Exact 13-line byte contract

The literal old suffix on each listed line is two ASCII spaces followed by LF;
the literal new suffix is LF. The line body and every other byte are invariant:

| Path | Lines |
|---|---|
| `docs/build/RUN-M2-11-QA-origin-decision.md` | 3, 4 |
| `docs/build/RUN-M2-11-QA-finalization-decision.md` | 3 |
| `docs/build/RUN-M2-11-QA-finalization-exception-decision.md` | 3 |
| `docs/build/RUN-M2-11-QA-finalization-repair-decision.md` | 3 |
| `docs/build/RUN-M2-11-QA-finalization-repair-plan.md` | 3, 6, 7 |
| `docs/build/RUN-M2-11-QA-finalization-F3-decision.md` | 3 |
| `docs/build/RUN-M2-11-QA-finalization-F3-plan.md` | 4, 5, 7 |
| `docs/build/RUN-M2-11-QA-finalization-F4-F5-decision.md` | 3 |

Implementation and tests materialize the exact round-7 candidate with
`git archive --format=tar --mtime=1970-01-01T00:00:00Z
de5068f0da644bd543fc7433d14b1f46ba3f9d3f` into a temporary directory after
verifying `git cat-file -t` returns `tree` and the archive digest is the pinned
value. They assert:

1. within the eight named artifacts, the old tree has exactly the table above
   and no other `[ \t]+$` line (unmodified fixture whitespace is out of scope);
2. each repaired file equals its old bytes after the listed 13 replacements;
3. all non-authorized product/runtime paths equal round 7 byte-for-byte;
4. the two new governance files were absent in round 7; and
5. runner/test/Dev Notes/QA-report changes are confined to round-8 transport and
   factual propagation.

### B. Non-trailing owner authority grammar

The legacy `owner-decision-v1` grammar requires its date metadata to end in two
spaces, which is incompatible with the release whitespace gate. Preserve v1
unchanged for immutable rounds 1–7. Add `owner-decision-v2` with the same strict
single-H1, exact date count/value, nonempty quoted authorization, one controlling
plan path, LF/final-newline, and no-verdict rules, except its date line must match
exactly `**Date:** YYYY-MM-DD` with no trailing byte. Only the exact round-8
bundle's current-artifact schema map may label `owner-decision.md` v2. Every
earlier bundle retains v1, and cross-version relabeling tests refuse.

### C. Private-index whitespace enforcement

`build_approved_tree` already constructs an isolated index, stages the complete
candidate, verifies exact path equality, writes the approved tree, and proves
the real index hash is unchanged. Decompose it into one private computation that
returns the complete record and one create-once record writer; do not duplicate
the Git logic. Insert this exact check after path equality and before
`write-tree`:

```text
git diff --cached --check
```

It runs with the same private `GIT_INDEX_FILE`, object directory, alternates,
and repository root before `output.mkdir`. A failure therefore leaves the exact
round-8 bundle or docs-attempt-3 directory absent. On success, the returned
record is retained in memory; every gate proves the fingerprint unchanged before
the create-once writer persists `approved-tree.json`, token, and manifests.
Success and failure tests compare the real index hash before and after. No Git
config, whitespace override, path exclusion, or output filtering is permitted.

### D. Exact release-hygiene predecessor

Add `validate_release_hygiene_predecessor(review_path)` beside the existing
round-specific validators. It accepts only:

1. exact namespace `docs-v9-finalization-r7-a2` under the evidence root;
2. exact input/review manifest and approved-review paths and digests;
3. successful `validate_sealed_docs_review(..., 2)`;
4. review final line `VERDICT: APPROVED` and no open blockers;
5. exact round-7 adoption, QA seal/manifest, candidate token/fingerprint,
   70-path tree, final-message digest, approved-tree digest/OID; and
6. exact external resolution path
   `resolution-notes.finalization-r7-release.md`, schema-valid with only
   `## gate-release-diff-check: resolved`, and factual 13-line markers.

The new adoption `prior_round` retains the existing semantic names
`prior-docs-review`, `prior-review-manifest`, and `resolution-notes`. Its phase
records contain exact absolute paths and current digests. The special release
branch alone permits an APPROVED predecessor; every generic QA/docs repair path
continues to require `CHANGES_REQUESTED`.

### E. One round-8 cycle

Add cycle `finalization-release-hygiene-exception` with:

- exact round 8 and output `qa-v9-finalization-round-8`;
- run ID `RUN-M2-11-QA-finalization-release-hygiene-exception`;
- cap 8, explicit owner override true, and no round 9;
- exact decision/plan digests, `owner-decision-v2`, and sorted exception scope;
- exact 72-path QA/release equality;
- docs attempt 3 and final message
  `final-docs-commit.finalization-r8-a3.md`;
- only `--prior-docs-review` pointing to the sealed attempt-2 review and only
  the exact release-gate resolution; and
- the unchanged 15 direct gates.

Generated QA report markers must state logical round 8, 72 paths,
release-hygiene-only scope, TD1–TD9, no product/T0 change, cap 8 override, and
no round 9. Bundle validation recomputes the complete special predecessor graph;
it never treats round 7 as failed QA/docs evidence.

### F. Docs attempt 3 and release

`seal-docs --attempt 3` normally requires a prior docs
`CHANGES_REQUESTED`. For a bundle controlled by the exact new plan digest only,
permit the exact attempt-2 APPROVED predecessor already bound in its adoption,
and call `validate_release_hygiene_resolution` instead of generic finding-ID
matching. All candidate/tree/message checks remain unchanged. Attempt 4 remains
outside the parser's allowed range and refuses.

After round-8 QA and docs approval, pre-stage validation must pass, the literal
72 paths are staged, staged-name and tree equality are proved, the unmodified
`git diff --cached --check` and post-stage validator pass, and the reviewed
message is rendered through the existing mode-0600 `git commit -F` path. Fixed
base, PR-head, merge, and supervised functional deployment checks remain exactly
as previously approved. The whole sequence executes in one supervised zsh with
`set -euo pipefail`; a nonzero guard therefore stops before the next mutation.
The literal rollback blocks below are run immediately after a stopped pre-commit,
pre-merge, or deployment phase and require successful state readback.

### G. Exact 72-path candidate/release inventory

The exact inventory is the prior 70 paths plus the two new governance artifacts:

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
docs/build/RUN-M2-11-QA-finalization-release-hygiene-decision.md
docs/build/RUN-M2-11-QA-finalization-release-hygiene-plan.md
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

1. The substantive repair is exactly 13 two-space deletions, not a formatter run.
2. The private approved-tree check uses the same unmodified staged whitespace
   command as release and cannot hide Markdown paths.
3. `owner-decision-v2` forbids trailing metadata; immutable earlier authorities
   keep exact v1 routing and are never reinterpreted as v2.
4. Round-7 QA/docs approvals remain valid historical evidence but cannot approve
   changed repository bytes.
5. Round 8 consumes the exact APPROVED docs attempt 2 only through the new
   release-hygiene predecessor route.
6. The global docs attempt is exactly 3; no attempt 4 or QA round 9 exists.
7. All 15 gates rerun because repository/evidence-runner bytes change.
8. Product/T0/snapshot/runtime/deployment controls are read-only.
9. The real Git index starts and remains empty until both new reviews approve.
10. Release uses no whitespace configuration override or validation bypass.

## Alternatives Considered

- **Ignore Markdown hard breaks:** rejected because release validation returned
  nonzero and the approved contract requires an unmodified staged check.
- **Set `core.whitespace`, add `.gitattributes`, or exclude paths:** rejected as
  a validation relaxation outside owner scope.
- **Replace spaces with `<br>`:** rejected because the owner authorized removing
  the 13 errors, and the affected governance metadata does not require HTML.
- **Reuse round-7 gates/reviews:** rejected because any repository repair
  invalidates content-sensitive evidence.
- **Run a formatter:** rejected because it could alter bytes beyond the exact 13.
- **Create a generic retry framework:** rejected; one digest-scoped branch in the
  existing runner is smaller and explicitly removable debt.

## Planned Files

- The 14 exact repository paths in Scope and no others.
- External create-once inputs/outputs named in Scope.
- No product/T0/snapshot/deployment file changes.

## Implementation Tasks

- **T1 [R1,R4]:** Add the owner decision/plan constants, pinned digests, strict
  round-8-only `owner-decision-v2` route, literal exception scope/run ID, exact
  round-7 QA/docs/tree/token pins, and one
  `finalization-release-hygiene-exception` branch for logical round 8 only.
- **T2 [R2]:** Preflight the exact readable round-7 tree/deterministic-archive
  pins, remove
  exactly the 13 table-listed two-space suffixes with a mechanical patch, and
  run a byte-level old/new comparison plus exact eight-artifact full-set scan.
- **T3 [R2,R3]:** Add the temporary round-7 approved-tree archive comparator;
  decompose the existing approved-tree computation/writer without duplicating
  Git logic; run its private `git diff --cached --check` before output creation;
  and preserve real-index identity on success and refusal.
- **T4 [R4,R5]:** Implement the exact sealed attempt-2 APPROVED predecessor,
  release-gate resolution validator, 72-path inventory, adoption/phase graph,
  round-8 QA-report/cap/debt markers, and public bundle validation.
- **T5 [R6]:** Extend only the exact release-hygiene `seal-docs --attempt 3`
  transition to accept the prior APPROVED docs review plus exact resolution;
  preserve all generic rejection and attempt-cap behavior.
- **T6 [R2,R3,R4,R5,R6]:** Add focused success/removal-fails tests for exact
  tree/archive identity, 13-line equality, lossy-patch non-use,
  extra/missing/tab mutation, private-index pass/fail, output-absence and real
  index preservation, unchanged-fingerprint record persistence, v1/v2 schema
  routing and relabeling, all predecessor
  pin/path/verdict mutations, round8/no9, 72-path equality, attempt3/no4,
  generated reports, staged check propagation, fail-fast rollout markers, exact
  empty-index restoration, PR-close/readback, non-negated variable readback,
  and the single-process `jq first(...)` multi-fragment selector under
  `set -euo pipefail` (no `head`/SIGPIPE pipeline).
- **T7 [R8]:** Update Dev Notes and QA report factually with the round-7/docs
  approvals, post-stage refusal, empty-index rollback, exact repair, focused
  results, pending round-8 outcomes, and TD9.
- **T8 [R5]:** Create the exact release-gate resolution and attempt-3 final
  message, preflight all pins/absence/index/scope, then invoke round 8 once and
  validate its token/manifests. Do not invoke T0.
- **T9 [R5,R6,R7]:** Obtain and seal independent QA; only approval enters docs
  attempt 3 and independent docs review. Only both approvals enter pre/post-stage
  validation, exact fail-fast release, fixed-base PR/merge, and supervised
  deployment; execute the phase-specific literal rollback on any stop.

## Testing Strategy

Focused preflight:

```bash
PYTHONDONTWRITEBYTECODE=1 .venv/bin/python -m pytest -q tests/test_m2_11_qa_bundle.py
git diff --check
```

The create-once round-8 runner then executes exactly these 15 commands:

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

The runner's private-index staged whitespace check is a mandatory pre-token
control in addition to those unchanged direct ledger rows. No command invokes
T0 or full-corpus derivation.

## Verification Matrix

| Requirement | Executable proof |
|---|---|
| R1 | exact quote/decision/plan pins, strict v2/v1 routing, tuple/run ID/round8/cap8/no9 equality |
| R2 | pinned approved tree/archive supplies exact old bytes and 13 errors; repaired tree is only those deletions; lossy patch/extra/missing/tab mutations refuse |
| R3 | pre-output private-index staged check pass/fail; bundle/docs target absent on fail; unchanged-fingerprint record persists on pass; real index unchanged |
| R4 | exact round7 QA/docs/token/tree/message/fingerprint pins pass; path/digest/verdict mutations refuse |
| R5 | 15 zero exits/one fingerprint; round8/72/TD1..9/cap8/token/manifests validate; T0 unchanged |
| R6 | exact attempt2 APPROVED + release resolution permits a3 only; generic APPROVED predecessor and a4 refuse |
| R7 | fail-fast same-tree sequence passes docs review, staged whitespace/tree, fixed-base PR/merge, and functional deploy; a many-route fixture proves the single-process `jq first(...)` selector exits zero under `set -euo pipefail`; injected stops restore index, close/read back PR, or disarm with successful list readback |
| R8 | 14-file repair scope only; reports factual; prior evidence append-only |

## Rollout / Rollback

After plan approval and implementation, open one supervised zsh, run `set -euo
pipefail`, and execute every following rollout fence consecutively in that same
shell. No fence may run after a prior nonzero exit. Create the exact release
resolution and attempt-3 message, then invoke once while every new target is
absent. The independent reviewer writes the canonical review paths; the primary
may only validate and seal those bytes:

```bash
set -euo pipefail
root=/Users/johnbaek/projects/Populus-ops/snapshots/evidence/m2-11
qa_bundle="$root/qa-v9-finalization-round-8"
qa_review="$root/qa-review.finalization-r8.canonical.md"
docs_bundle="$root/docs-v9-finalization-r8-a3"
docs_review="$root/docs-review.finalization-r8-a3.canonical.md"
final_message="$root/final-docs-commit.finalization-r8-a3.md"
PYTHONDONTWRITEBYTECODE=1 .venv/bin/python scripts/build_m2_11_qa_bundle.py run \
  --cycle finalization-release-hygiene-exception --round 8 \
  --final-docs-commit "$final_message" \
  --prior-docs-review "$root/docs-v9-finalization-r7-a2/docs-review.attempt-2.md" \
  --resolution-notes "$root/resolution-notes.finalization-r7-release.md" \
  --output "$qa_bundle"
PYTHONDONTWRITEBYTECODE=1 .venv/bin/python scripts/build_m2_11_qa_bundle.py validate \
  --bundle "$qa_bundle"
```

On any gate or QA failure, preserve evidence and stop: no round 9 exists. Only an
independent canonical round-8 `APPROVED` review may run this exact seal and docs
attempt-3 sequence:

```bash
set -euo pipefail
PYTHONDONTWRITEBYTECODE=1 .venv/bin/python scripts/build_m2_11_qa_bundle.py seal-review \
  --bundle "$qa_bundle" --review "$qa_review"
sealed_qa="$qa_bundle/qa-review.round-8.md"
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

Only that sealed docs approval permits the release. Pre-stage validation runs
before the real index changes. Staging is derived from, and then compared back
to, the reviewed exact 72-path `approved-tree/v1` record; it does not reuse the
obsolete 62- or 70-path shell arrays:

```bash
set -euo pipefail
PYTHONDONTWRITEBYTECODE=1 .venv/bin/python scripts/build_m2_11_qa_bundle.py validate-release \
  --docs-bundle "$docs_bundle" --mode pre-stage
docs_manifest="$docs_bundle/docs-review-input.manifest.json"
approved_tree=$(jq -er '.inputs[]|select(.name=="final-docs-tree")|.path' \
  "$docs_manifest")
jq -e '.schema_version=="approved-tree/v1" and
       (.expected_paths|type=="array" and length==72)' "$approved_tree"
expected_names=$(mktemp)
actual_names=$(mktemp)
cached_names=$(mktemp)
jq -r '.expected_paths[]' "$approved_tree" | LC_ALL=C sort -u > "$expected_names"
test "$(wc -l < "$expected_names" | tr -d ' ')" = 72
{ git diff --name-only HEAD; git ls-files --others --exclude-standard; } |
  LC_ALL=C sort -u > "$actual_names"
diff -u "$expected_names" "$actual_names"
while IFS= read -r release_path; do
  git add -- "$release_path"
done < "$expected_names"
git diff --cached --name-only | LC_ALL=C sort -u > "$cached_names"
diff -u "$expected_names" "$cached_names"
test -z "$(git diff --name-only)"
test -z "$(git ls-files --others --exclude-standard)"
git diff --cached --check
test "$(git write-tree)" = "$(jq -er .tree_oid "$approved_tree")"
PYTHONDONTWRITEBYTECODE=1 .venv/bin/python scripts/build_m2_11_qa_bundle.py validate-release \
  --docs-bundle "$docs_bundle" --mode post-stage
```

If any command fails after the first `git add` and before `git commit` succeeds,
the stopped shell must not be resumed. Run this standalone fail-fast restoration
and require the reviewed pre-stage state again before any retry:

```bash
set -euo pipefail
root=/Users/johnbaek/projects/Populus-ops/snapshots/evidence/m2-11
docs_bundle="$root/docs-v9-finalization-r8-a3"
docs_manifest="$docs_bundle/docs-review-input.manifest.json"
approved_tree=$(jq -er '.inputs[]|select(.name=="final-docs-tree")|.path' \
  "$docs_manifest")
expected_names=$(mktemp)
jq -r '.expected_paths[]' "$approved_tree" | LC_ALL=C sort -u > "$expected_names"
test "$(wc -l < "$expected_names" | tr -d ' ')" = 72
while IFS= read -r release_path; do
  git restore --staged -- "$release_path"
done < "$expected_names"
test -z "$(git diff --cached --name-only)"
PYTHONDONTWRITEBYTECODE=1 .venv/bin/python scripts/build_m2_11_qa_bundle.py validate-release \
  --docs-bundle "$docs_bundle" --mode pre-stage
```

The reviewed commit artifact is digest-checked and rendered through the existing
mode-0600 path. The metadata prefix never enters Git history:

```bash
set -euo pipefail
final_artifact=$(jq -er '.inputs[]|select(.name=="final-docs-commit")|.path' \
  "$docs_manifest")
test "$(shasum -a 256 "$final_artifact" | awk '{print "sha256:"$1}')" = \
  "$(jq -er '.inputs[]|select(.name=="final-docs-commit")|.digest' "$docs_manifest")"
test "$(grep -c '^COMMIT_MESSAGE:' "$final_artifact")" = 1
commit_message=$(mktemp)
chmod 600 "$commit_message"
{
  sed -n 's/^COMMIT_MESSAGE:[[:space:]]*//p' "$final_artifact"
  printf '\n'
  sed '/^COMMIT_MESSAGE:/d' "$final_artifact"
} > "$commit_message"
git commit -F "$commit_message"
release_commit=$(git rev-parse HEAD)
test -z "$(git status --porcelain=v1)"
```

The PR path is the previously owner-approved zero-remote-check contract. It
requires exact fixed-base freshness before push and again immediately before the
matched-head squash merge; absence is proved, never described as green checks:

```bash
set -euo pipefail
release_repo=johnbaekk-spec/populus
release_base=$(jq -er .base_ref "$docs_manifest")
test "$release_base" = 21340330a0fad7e9e39c1a9cec67656643621b05
git fetch origin main
test "$(git rev-parse origin/main)" = "$release_base"
git push --set-upstream origin codex/m2-11-t0-finalize
pr_title=$(sed -n '1p' "$commit_message")
pr_url=$(gh pr create --repo "$release_repo" --base main \
  --head codex/m2-11-t0-finalize --title "$pr_title" \
  --body 'Owner-authorized M2-11 completion. Independent plan, QA, and docs reviews approved the exact 72-path cumulative tree; complete local gates and supervised deployment are required.')
test -n "$pr_url"
test "$(gh pr view "$pr_url" --json headRefOid --jq .headRefOid)" = "$release_commit"
test "$(gh pr view "$pr_url" --json baseRefOid --jq .baseRefOid)" = "$release_base"
test "$(gh api "repos/$release_repo/commits/$release_commit/check-runs" --jq .total_count)" -eq 0
test "$(gh api "repos/$release_repo/commits/$release_commit/status" --jq '.statuses|length')" -eq 0
test "$(gh pr view "$pr_url" --json statusCheckRollup --jq '.statusCheckRollup|length')" -eq 0
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

If any command fails after PR creation but before a successful merge, do not
resume the stopped shell. This standalone fail-fast block permits at most one
open PR for the exact head, closes it, reads back `CLOSED`, and proves none
remain. A merged PR is not rewritten:

```bash
set -euo pipefail
release_repo=johnbaekk-spec/populus
open_count=$(gh pr list --repo "$release_repo" --state open \
  --head codex/m2-11-t0-finalize --json url --jq length)
case "$open_count" in
  0) ;;
  1)
    rollback_pr=$(gh pr list --repo "$release_repo" --state open \
      --head codex/m2-11-t0-finalize --json url --jq '.[0].url')
    test -n "$rollback_pr"
    gh pr close "$rollback_pr" --repo "$release_repo"
    test "$(gh pr view "$rollback_pr" --repo "$release_repo" --json state --jq .state)" = CLOSED
    ;;
  *) echo 'multiple open release PRs; STOP' >&2; exit 1 ;;
esac
test "$(gh pr list --repo "$release_repo" --state open \
  --head codex/m2-11-t0-finalize --json url --jq length)" = 0
```

Deployment first reruns the exact secure preflight. If any line fails, execute
the merged repository's `docs/runbooks/self-hosted-runner.md` §§1–6 exactly with
an interactive administrator, then rerun this whole block; failure after that is
a hard stop before repository-variable mutation:

```bash
set -euo pipefail
snapshot=/Users/johnbaek/projects/Populus-ops/snapshots/inst-source-v1.db
t0_log="$root/T0-v11.log"
test "$(gh api repos/actions/runner/releases/latest --jq .tag_name)" = v2.336.0
test "$(gh api "repos/$release_repo/actions/runners" --jq \
  '[.runners[]|select(.status=="online")|
    select(([.labels[].name]|contains(["self-hosted","macOS","populus-ops"])))]|length')" = 1
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
test "$(shasum -a 256 "$snapshot" | awk '{print $1}')" = \
  977a4d249d92590a4de2961a3e9c7ff8cfa2e4846f0097ec7aa6c07f28124121
test ! -e "$snapshot-wal" && test ! -e "$snapshot-shm" && test ! -e "$snapshot-journal"
test "$(stat -f %z "$t0_log")" = 63400
test "$(wc -l < "$t0_log" | tr -d ' ')" = 171
test "$(shasum -a 256 "$t0_log" | awk '{print $1}')" = \
  7078a42934484c9c5ba7f975654476e0788c385dbaf8108c0d429a58ba91a453
```

After the preflight passes, set only the snapshot path, dispatch merged `main`,
capture one exact new run ID/URL for the merge SHA, and require every watched job
to succeed:

```bash
set -euo pipefail
gh variable set POPULUS_INST_DB --repo "$release_repo" --body "$snapshot"
test "$(gh variable get POPULUS_INST_DB --repo "$release_repo" --json value --jq .value)" = "$snapshot"
dispatch_after=$(date -u +%Y-%m-%dT%H:%M:%SZ)
gh workflow run publish.yml --repo "$release_repo" --ref main
run_id=
for _ in 1 2 3 4 5 6; do
  run_id=$(gh run list --repo "$release_repo" --workflow publish.yml \
    --event workflow_dispatch --branch main --limit 10 \
    --json databaseId,headSha,createdAt \
    --jq "[.[]|select(.headSha==\"$merge_sha\" and .createdAt>=\"$dispatch_after\")]|if length==1 then .[0].databaseId else empty end")
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
gh run view "$run_id" --repo "$release_repo" --exit-status \
  --json status,conclusion,headSha,event,url,jobs | \
  jq -e '.status=="completed" and .conclusion=="success" and
         (.jobs|length>0) and all(.jobs[];.conclusion=="success")'
```

The exact-run verifier below is mandatory before scheduling is armed. It uses the
repository's authenticated artifact/signature verifier and deployment-record
gate, proves manifest/source/artifact/logical-digest/file-count bindings, then
fetches the v1 transition and every shard of one real multi-fragment v2 filer,
reassembles its complete payload with the retained T0 mirror, and loads the real
institutional and filer pages:

```bash
set -euo pipefail
verify_root=$(mktemp -d)
gh repo clone johnbaekk-spec/populus-data "$verify_root/populus-data" -- --depth 1
GH_TOKEN="$(gh auth token)" GH_REPO=johnbaekk-spec/populus-data \
  uv run populus verify --data-repo "$verify_root/populus-data" --attestation=sigstore
GH_TOKEN="$(gh auth token)" uv run python -m populus.deploy.record gate \
  --data-repo "$verify_root/populus-data" --domain publicfilings.org
build_id=$(jq -er .build_id "$verify_root/populus-data/latest.json")
manifest="$verify_root/populus-data/builds/$build_id/manifest.json"
source_doc="$verify_root/populus-data/builds/$build_id/inst_source.json"
stats="$verify_root/populus-data/builds/$build_id/congress/stats.json"
jq -e '.modules.inst.schema_version=="1.1" and
       .modules.inst.client_compat==">=0.0.1,<1" and
       ([.modules.inst.artifacts[].name]|
        contains(["inst_agg.db","inst_serving.db","inst_source.json"])) and
       ([.modules.inst.artifacts[]|
         select(.name=="inst_agg.db" or .name=="inst_serving.db")|
         .logical_digest|test("^[0-9a-f]{64}$")] | all)' "$manifest"
jq -e '.schema=="inst_source/v1" and .snapshot_sha256==
       "977a4d249d92590a4de2961a3e9c7ff8cfa2e4846f0097ec7aa6c07f28124121"' \
  "$source_doc"
jq -e '.site_file_count|type=="number" and .>0 and .<=18000' "$stats"
base=https://publicfilings.org
curl -fsS "$base/?m2-11=$run_id" -o "$verify_root/root.html"
curl -fsS "$base/institutional/?m2-11=$run_id" -o "$verify_root/institutional.html"
curl -fsS "$base/stats.json?m2-11=$run_id" -o "$verify_root/live-stats.json"
cmp "$stats" "$verify_root/live-stats.json"
grep -Fq "populus:code_sha\" content=\"$merge_sha\"" "$verify_root/root.html"
grep -Fq 'Institutional' "$verify_root/institutional.html"
! grep -Fq 'module withheld' "$verify_root/institutional.html"
curl -fsS "$base/institutional/data/filers/index.v1.json?m2-11=$run_id" |
  jq -e '.=={"v":2,"kind":"filer-index-upgrade-required"}'
test "$(curl -sS -o /dev/null -w '%{http_code}' \
  "$base/institutional/data/filers/0.v1.json?m2-11=$run_id")" = 404
v2_index="$verify_root/filers-v2.json"
curl -fsS "$base/institutional/data/filers/index.v2.json?m2-11=$run_id" -o "$v2_index"
test "$(wc -c < "$v2_index" | tr -d ' ')" -le 1048576
jq -e 'keys==["absent","kind","routes","v"] and .v==2 and
       .kind=="filer-index" and .absent==null and
       (.routes|type=="object" and length>0)' "$v2_index"
multi_cik=$(jq -er 'first(.routes|to_entries[]|select(.value[2]>1)|.key)' "$v2_index")
test -n "$multi_cik"
BASE="$base" RUN_ID="$run_id" INDEX="$v2_index" CIK="$multi_cik" \
OUT="$verify_root/filer-payload.json" PYTHONDONTWRITEBYTECODE=1 \
  .venv/bin/python - <<'PY'
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
test "$(gh variable get POPULUS_SELFHOSTED_VALIDATED --repo "$release_repo" \
  --json value --jq .value)" = true
```

Before commit, rollback is an empty index and no production change; preserve all
append-only evidence. After commit but before merge, close the PR without merging.
If secure provisioning is absent after merge, preserve merged `main` and stop
before variables. On any mutation/dispatch/verification failure, preserve the run
and execute this disarm before the signed-pointer/runbook rollback:

```bash
set -euo pipefail
release_repo=johnbaekk-spec/populus
gh variable delete POPULUS_SELFHOSTED_VALIDATED --repo "$release_repo" 2>/dev/null || :
gh variable delete POPULUS_INST_DB --repo "$release_repo" 2>/dev/null || :
remaining_release_vars=$(gh variable list --repo "$release_repo" --json name \
  --jq '[.[].name|select(.=="POPULUS_INST_DB" or .=="POPULUS_SELFHOSTED_VALIDATED")]|sort|join(",")')
test -z "$remaining_release_vars"
```

Never weaken the staged whitespace check, mutate/reuse T0-v11, repair the
snapshot, delete evidence, self-approve, or dispatch an unbound SHA.

## Simplicity Audit

Two governance files establish new owner authority. Eight existing Markdown
files receive only 13 byte deletions. Runtime changes remain in the single
release-specific evidence runner; tests remain in its one focused module; Dev
Notes/QA report are factual propagation. New code concepts are limited to one
strict owner-decision-v2 route, one round-7 release predecessor validator, one
exact release resolution validator, one private-index check, one round-8 branch,
and one attempt-3 exception. No
product component, dependency, database object, route, parser, sharder, build
command, generic schema, second runner, or deployment path is added.

## Tech Debt Introduced

**TD-QA-ORIGIN-9 — release-hygiene predecessor and eighth finalization round.**
Impact: the release-specific bridge gains one approved-docs predecessor case,
one exact 13-line comparator, one v2 authority grammar, one private-index
whitespace precheck, and one digest-scoped round-8/attempt-3 authority. Controls:
exact paths/bytes/pins,
unmodified Git whitespace semantics, complete 15 gates, independent QA/docs,
no product import, no round 9/attempt 4. Removal: delete TD1–TD9 and the
release-specific runner/tests after the generic harness natively validates its
private staged tree and transports post-review release-gate failures.

Existing TD1–TD8, eager-build debt, reservation disclosure, and npm advisories
remain visible. No hidden product, dependency, security, threshold, timeout,
snapshot, T0, or deployment debt is introduced.

## Memory Touch-Points

The exact canonical selector invocation was
`/Users/johnbaek/projects/orchestrate-tool/lib/memory-select.sh
/Users/johnbaek/.claude/projects/-Users-johnbaek/memory/MEMORY.md release hygiene
whitespace staging post-stage QA review`. Its deterministic top ten, in returned
order, were read in full:

- `feedback_qa_fail_batch_remediation.md`: batch the one release finding,
  rerun complete gates, and await independent review.
- `feedback_plan_hygiene.md`: require exact canonical sections, commands, scope,
  debt, and failure sweep.
- `feedback_qa_remediation_discipline.md`: do not self-waive a failed release
  control; keep factual reports and source-repair evidence synchronized.
- `feedback_stale_review_snapshot_detection.md`: pin the live candidate,
  previous approvals, and new plan hash on every review round.
- `feedback_convergent_review.md`: use bounded independent convergence and stop
  if only unsupported polish remains.
- `feedback_orchestrate_workflow.md`: preserve the isolated feature worktree and
  explicit checkpoint; never auto-approve.
- `feedback_plan_review_discipline.md`: weave every finding through architecture,
  tests, verification, rollout, and DoD.
- `feedback_python_test_bytecode_artifact_hygiene.md`: keep
  `PYTHONDONTWRITEBYTECODE=1` and verify no artifact pollution.
- `feedback_cloud_routine_verification_boundaries.md`: checked relevance; the
  deployment proof is fully readable through GitHub/runbook artifacts, so no
  unverifiable output claim is accepted.
- `feedback_deterministic_key_dedup.md`: checked relevance; append-only evidence
  uses deterministic paths and create-once refusal rather than silent deletion.

The complete shared failure-mode catalog was also read and shaped full-set
coverage, source-repair invalidation, exact gates, append-only evidence, and
function-not-liveness deployment proof.

## Failure-Mode Sweep

| Failure mode | Prevention / proof |
|---|---|
| one or more of 13 remains | exact line table, byte comparator, private staged check |
| extra whitespace edited | exact approved-tree byte comparison and full-set mutation tests |
| redacted patch used as byte source | tree/archive pins are mandatory; tests prove patch differs and is never selected |
| Markdown excluded/ignored | unmodified `git diff --cached --check` on all 72 private-staged paths |
| new owner decision recreates error | v2 exact clean date grammar; historical v1 routed by bundle |
| real index polluted by precheck | before/after real-index digest equality on pass and fail |
| prior APPROVED docs review generalized | exact new plan digest/path/pins and special branch only |
| stale/substituted predecessor | exact manifest/review/QA/token/tree/message digests and paths |
| resolution fabricated | one exact external path, schema, heading, count/body markers, digest |
| source repair reuses round7 gates | new round8 15-gate bundle and independent QA |
| product/T0 drift | round7 approved-tree comparison plus immutable T0/snapshot pins |
| hidden debt/status overclaim | TD1–TD9 and factual pending outcomes in both reports |
| output consumed on refusal | private computation/check precedes output mkdir; pass record persists only after unchanged gates; create-once tests |
| round/attempt cap generalized | exact round8/a3 branch; round9/a4 refusals |
| approval-to-release drift | same live fingerprint/tree before and after exact staging |
| failed guard followed by mutation | one supervised `set -euo pipefail` zsh; every rollout fence repeats the contract |
| failed pre-commit leaves staged index | exact 72 reviewed paths restored with `git restore --staged`; empty index and pre-stage validator re-prove state |
| failed pre-merge leaves live PR | exact-head open-count bound, close, `CLOSED` readback, and zero-open recheck |
| failed variable-list mistaken for absence | capture successful `gh variable list` first, then require the selected-name string empty; no negated pipeline |
| functional selector SIGPIPE under pipefail | one-process `jq first(...)` selector; many-route literal-command test must exit zero and return exactly one CIK |
| deployment liveness only | existing real index/shard/reassembly/filer/page/signature checks |

## Definition of Done

- [ ] **R1:** exact decision/plan independently approve only release hygiene,
  strict v2/v1 routing, literal scope/run ID/round8/cap8, and no round9.
- [ ] **R2:** exact 13 old suffixes are gone; no other byte in the eight files or
  any product/runtime path differs from the pinned approved round-7 tree.
- [ ] **R3:** private-index staged whitespace check passes before output creation,
  fails if any suffix returns with bundle/docs target absent, persists only after
  unchanged-fingerprint gates, and never changes the real index.
- [ ] **R4:** exact sealed round7 QA/docs/token/tree/message predecessor and
  release resolution validate; every mutation refuses.
- [ ] **R5:** focused tests and all 15 gates pass once with one fingerprint;
  bundle binds round8/72/TD1..9/cap8 and independent QA approves.
- [ ] **R6:** exact docs attempt3 binds prior APPROVED attempt2 and release
  resolution, receives independent approval, and attempt4 refuses.
- [ ] **R7:** pre/post-stage validators, exact 72 paths/tree, reviewed message,
  fixed-base PR/merge, and supervised functional deployment pass under fail-fast
  execution; injected stops prove index restore, PR close/readback, and successful
  variable-list absence readback.
- [ ] **R8:** exact 14-file write scope, factual reports, immutable prior
  evidence/T0/snapshot, and append-only new evidence are proved.
- [ ] No product/T0/full-corpus command, validation/config relaxation, self-
  approval, round9, docs attempt4, or insecure deployment action occurred.
