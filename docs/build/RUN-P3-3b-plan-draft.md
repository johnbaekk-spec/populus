> ## ⚠ HANDOFF NOTE — this draft predates RUN P3-3a and must be RE-PLANNED
>
> This is the deploy-job plan as it stood after three review rounds (16 → 7 → 7
> blockers). It is preserved for its findings, **not** as a plan to implement.
>
> **What P3-3a changed underneath it:**
>
> - The attestation chain is now real. `publish.yml` attests the manifest, each
>   pointer generation and every Release asset; `populus verify --attestation=sigstore`
>   runs before the pointer commit. So R17's "real attestation is an executable
>   arming precondition" is **satisfiable now**, and `populus preflight-attestation`
>   is the positive gate it asked for.
> - **Both** certificate-identity constants and the attestation **lookup repository**
>   now name `populus`, not `populus-data`. Round-3 F20 — "correcting the identity
>   without correcting the lookup repo leaves R9's input unobtainable" — is closed.
> - Every entry point requires an explicit `--attestation`. Any new deploy-side
>   entry point must do the same, and `tests/test_attestation_structure.py` will
>   fail the build if a production call site omits the argument.
> - `AttestationResult` now distinguishes `rejected` from `unavailable`. The
>   record signer must not treat a rate-limited lookup as tampering.
>
> **What this unblocks in the bootstrap (round-3 F19's hardest finding):** the
> old R14 was unexecutable because a human cannot mint a workflow-identity
> attestation and `record-sign.yml` is `workflow_call`-only. With a working chain,
> the clean shape is a `workflow_dispatch` of the real publish→deploy→sign
> pipeline pointed at the empty project — no special bootstrap path at all.
>
> **Still open and unchanged:** `attestation_phase` (deferred to P3-3c), so a
> deliberate `--attestation=staging-noop` is still accepted; third-party
> verification waits on the §15.3 counsel gate; and `POPULUS_PUBLISH_ARMED` is
> still unprovisioned, so the workflow path has never actually run.

# RUN P3-3 — Cloudflare Pages deploy job + record-signer body

> **Revision 3** — addresses plan-review round 2 (7 blockers + 1 nit) on top of
> round 1's 16. Round 2 confirmed 9 of 16 fixed. The two most important round-2
> findings: revision 2's bootstrap **deadlocked** against its own pre-publish gate
> (F3), and its claim that Cloudflare cannot introspect token scope was **factually
> wrong** (F11) — verified against the live API docs, the token-list endpoint does
> return policies, so the runtime assertion is restored rather than weakened.
>
> **Revision 2** — addressed external plan-review round 1 (16 blockers). Two
> findings were **owner decisions**, both now settled (see Locked Decisions 5
> and 6), and both *simplified* the plan rather than adding to it. Two findings
> (F5, F2) identified defects in **ARCHITECTURE §12.1 itself**, not just in this
> plan; those are handled as spec amendments, not worked around.
>
> **Transport:** `interactive-disk` in the worktree `/Users/johnbaek/projects/Populus-p3-3`.
> The canonical root slots in the main checkout are occupied by the live RUN M2-8
> plan and must not be overwritten.

## Goal and Success Criteria

Make `https://publicfilings.org` serve the built dashboard through the complete
§12.1 publisher-side deployment protocol, with every trust boundary actually
executing.

Success = one nightly run that builds the site from the staged verified data
build, publishes the data, deploys to a **preview** and verifies it, deploys the
**same bytes** to production and verifies the live custom domain, and produces an
**attested deployment generation** written by a signer that trusted no output of
the deploy job. Any verification failure leaves production serving the prior
build, or restores it by compensating rollback.

**A one-time operator bootstrap (R14) runs before any of this** and is what makes
the success criterion satisfiable on a project that today has zero deployments.

## Requirements

- **R1** — The site builds in the **same workflow run** as the data build, from
  the staged verified build, **before** publication. The `dist/` file count is
  enumerated and written into `stats.json` in **both** the canonical staged
  artifact and `dist/stats.json`, asserted **byte-equal**, hard CI failure at the
  15,000-file cap. **This requires a finalize seam inside `run_build`**: today
  `compute_stats`/`render_stats` writes `congress/stats.json` at
  `src/populus/publish/build.py:1598`, then the manifest is rendered at `:1889`
  and the recovery journal is built at `:1892` — all before the workflow regains
  control. A post-build count edit would desynchronize manifest and journal, so
  the count must be accepted *before* manifest assembly (plan-review F4).
  **The seam is locked as a two-phase interface, not left to the implementer:**
  `run_build(...)` is split into `stage_build(...) -> StagedBuild` — which writes
  the data artifacts under `.staging/<build_id>/` and stops **before** stats
  finalization, manifest assembly, and journal creation — and
  `finalize_build(staged, *, site_file_count) -> BuildReport`, which writes
  `stats.json` **once** with the count, then assembles the manifest and journal
  from it. `run_build` is retained as a thin wrapper (`finalize_build(stage_build(...),
  site_file_count=0)`) so every existing caller and test keeps working.
  **Recovery semantics:** a `StagedBuild` abandoned between the two phases leaves
  no manifest and no journal, which the existing recovery path already treats as an
  incomplete staging directory — the same state as a crash mid-`run_build` today.
  The stats **schema and version** change with the new field, so
  `tests/schemas/stats.schema.json` and `tests/test_stats.py` are in scope, with a
  compatibility test proving an old-version document is still readable.
- **R2** — `dist_digest` is recomputed and asserted at every boundary (artifact
  creation, after each independent download, immediately before the preview
  upload, immediately before the production upload, independently in the signer)
  **over a frozen snapshot** — see R19.
- **R3** — The artifact contains `site/**` plus a **sibling `inventory.json`
  outside `site/`**, RFC 8785 canonical JSON, derived from **the same frozen
  snapshot** as the digest (R19), so entries and tree digest cannot come from
  different tree states.
- **R4** — The deploy job holds **no GitHub write scopes** and receives the
  Cloudflare token as **step-scoped env on deploy steps only**.
- **R5** — Before any upload, the deploy job asserts the workflow-locked branch
  equals the project's configured `production_branch`. Mismatch aborts **before**
  uploading.
- **R6** — Preview upload first, live-verified. Failure aborts with production
  **untouched**.
- **R7** — Production upload is a second upload of provably the same bytes;
  `dist_digest` recomputed immediately before and must equal the preview-verified
  value.
- **R8** — Production is live-verified on the **custom domain**. Failure triggers
  automatic rollback to the **captured prior production deployment ID**,
  re-verified. Green is live production proof, never `wrangler`'s exit status.
  **An anchor always exists** because R14 guarantees at least one prior
  deployment.
- **R9** — The signer trusts **no deploy-job output**: `build_id` from the
  attested manifest/pointer, `code_sha`/`dist_digest`/inventory from the artifact
  it downloads itself, production deployment id from the Cloudflare API,
  cross-checked against the deploy job's claim.
- **R10** — The signer fetches **every inventory path** with **redirects
  disabled**, verifying content-decoded body hash and length. Any 3xx on an
  inventoried path is a failure.
- **R11** — The three closure-narrowing provider checks run, **pinned to named
  Cloudflare endpoints and response paths** (below), with a **named header
  normalization algorithm**. `verification_scope` is recorded as `expected_paths`
  with `files_verified`/`files_total`.
  **Pinned contracts (plan-review F17):**
  *Project* — `GET /accounts/{account_id}/pages/projects/{project_name}` →
  `result.production_branch` (R5), `result.domains[]` (custom-domain check).
  *Deployments* — `GET /accounts/{account_id}/pages/projects/{project_name}/deployments`
  → `result[].id`, `.environment` (`"production"` selects the live one), `.url`.
  *Rollback* — `POST .../deployments/{deployment_id}/rollback`.
  A **missing or wrong-typed** field is a hard failure, never a default.
  *The no-Functions signal must not be invented*: implementation **records a real
  deployment response from the live `publicfilings` project, commits it as a
  fixture, and pins the assertion to the actual field in that response**. Writing
  a plausible field name into a fake transport is exactly the failure F17 names.
  *Header allowlist* — compare after: lowercase field names, strip leading and
  trailing OWS from values, reject duplicate occurrences of any allowlisted field,
  and evaluate a **deterministic sample**: the site root, one HTML page, one JS
  asset, one CSS asset, one JSON data file — chosen by sorted-path index, not at
  random. `Content-Encoding` cases are exercised explicitly (R10 hashes the
  decoded body).
- **R21** — **The signer proves its own token is read-only at runtime.** Revision
  2 claimed Cloudflare exposes no such API; that was **wrong** (plan-review F11) —
  `GET /accounts/{account_id}/tokens` returns each token's
  `policies[].permission_groups`. The signer's token is provisioned with
  `Pages Read` **plus `Account API Tokens Read`**, obtains its own token id, reads
  back its policies, and **fails closed unless the permission/resource set exactly
  matches the approved read-only contract**. Positive (Read-only) and negative
  (`Pages Write`-capable) fixtures both restored. ARCHITECTURE keeps its original
  claim rather than being weakened.
- **R12** — The record is an **append-only generation** at
  `builds/<build_id>/deployments/<gen>.json`. If no verified record can be
  produced, the signer fails closed **and an independent pre-publish gate stops
  the next publication** — see R18.
- **R13** — Implementable and testable with **no `Pages:Edit` token in
  existence**; workflows inert until armed, in the corrected order (R18).
- **R14** — **One-time operator bootstrap that produces a REAL attested
  generation.** Revision 2 made the bootstrap an unverified placeholder, which
  created a deadlock (plan-review F3): R18's pre-publish gate requires the live
  build to carry a valid pinned-identity generation, so the first armed run would
  abort before it could deploy — and the signer, which runs only after a deploy,
  could never create the generation that would unblock it. It also left the first
  rollback with no verifiable target (plan-review F2).
  The bootstrap is therefore **three operator steps, not one**:
  **(a)** build a minimal real site artifact — `site/**` plus a sibling
  `inventory.json`, produced by the same R1/R3 path, not a hand-written HTML file;
  **(b)** deploy it once with `wrangler`, which activates `publicfilings.org`;
  **(c)** run the **ordinary signer** against that deployment, unchanged, which
  performs the full inventory-wide sweep and writes an attested generation.
  Outcome: the live deployment is **verified and attested by the same code path
  every later deploy uses**, so the pre-publish gate is satisfied, the first
  compensating rollback has a target whose `build_id`, inventory and digest can be
  re-verified, and **the deploy path still contains no exemption branch**. The
  only thing "special" is that a human runs the three steps in sequence instead of
  a workflow. Recorded in the runbook with its deployment ID and generation number.
- **R15** — The signer identity is **`populus`**. `P2_RECORD_SIGN_IDENTITY` in
  `src/populus/publish/attestation.py:31` currently pins
  `johnbaekk-spec/populus-data/.github/workflows/record-sign.yml@refs/heads/main`
  while the workflow lives in `populus`; the constant is corrected. Safe because
  **zero deployments exist, so no generation has ever been signed** and no
  verifier depends on the old value (plan-review F10, owner decision).
- **R16** — The signer runs in the `populus` workflow context but must append the
  generation to **`populus-data`**. A reusable workflow called via `workflow_call`
  runs with the **caller's** `GITHUB_TOKEN`, which is repo-scoped and **cannot**
  write to `populus-data`. The scoped data-repo PAT is therefore passed as an
  explicit **reusable-workflow secret**, and §14's inventory records that exposure
  (plan-review F9).
- **R17** — **Real attestation is an executable arming precondition, proved
  POSITIVELY before arming — not merely refused afterwards.** A refusal that fires
  after dispatch still lets a run publish and deploy before discovering there is
  no authentic manifest to trust (plan-review F8). A `populus preflight-attestation`
  command verifies a **real** pointer and manifest attestation against the pinned
  identities and exits non-zero otherwise; rollout step 2 runs it as a gate.
  `src/populus/cli.py:761` passes `StagingNoop()`, so no manifest or pointer is
  attested today and R9's "derive `build_id` from an attested manifest" is
  unsatisfiable. Either the P2 attestation chain is completed first, or the signer
  refuses to run — it must never fall back to trusting an unauthenticated source
  Additionally: **`P2_PUBLISH_IDENTITY` is wrong too.** Both it and
  `P2_RECORD_SIGN_IDENTITY` (`attestation.py:27` and `:31`) pin `populus-data`,
  but **both workflows live in `populus`**. Revision 2 corrected only the signer.
  Both are corrected, with positive and negative tests for each.
- **R18** — **Corrected arming order and an independent pre-publish gate.** The
  signer is armed **before** the publisher is dispatched (the previous order
  skipped the first signer invocation entirely). A pre-publish check verifies the
  current live build has a valid pinned-identity generation **before** ingest,
  publication, or upload (plan-review F3).
- **R19** — **Frozen upload snapshot, specified as an algorithm.** Revision 2
  named a snapshot but not how to build one, so a copy-based implementation could
  satisfy the wording while moving the race into snapshot creation (plan-review
  F5). The algorithm is locked:
  **(1)** enumerate the source tree and record `(path, size, mtime_ns, inode)`;
  **(2)** create a fresh private destination directory (`mkdtemp`, mode `0700`) on
  the same filesystem;
  **(3)** **one-pass copy-and-hash** — each source file is read exactly once, the
  bytes are written to the destination and hashed *as written*, so the hash always
  describes the bytes that landed;
  **(4)** re-enumerate the source and require the identity tuple set to be
  **unchanged**; any difference aborts (this is what detects mutation *during*
  copying);
  **(5)** **seal** the destination — files `0400`, directories `0500`;
  **(6)** compute `dist_digest` and `build_inventory` **from the destination
  only**, never the source;
  **(7)** the uploader receives **only the sealed path**, wrapped so it cannot be
  handed the source tree by mistake.
  Sealing is advisory against a hostile local root and is *not* claimed as more
  than it is; what it does guarantee is that no ordinary build step, editor, or
  concurrent job mutates the tree between hashing and upload. **The same gap
  exists in §12.1 and is amended there** (T11a).
- **R20** — **Wrangler is pinned in the committed lockfile.** It appears in
  neither `dashboard/package.json` nor `dashboard/package-lock.json` today (zero
  matches), so the workflow would have no executable or an unpinned one
  (plan-review F12).

## Scope

`publish.yml`; the `record-sign.yml` body; the `run_build` finalize seam; a new
`src/populus/deploy/` package; the attestation identity constant; the Wrangler
pin; CLI surface; the achievable §17 fixtures; the two ARCHITECTURE amendments.

## Non-goals

Explicitly deferred — each named, none quietly narrowed:

- **§17's "≥3 consecutive nightly deploys"** — inherently time-based.
- **The §13.2 external monitor and divergence alarm.** R12/R18's pre-publish gate
  is in scope; the independent monitor is not.
- **The §17 dashboard-inclusive rollback drill** — requires an attested generation
  and a live site, so it follows the first successful run. Owner: project owner
  (plan-review F13).
- **The §17 "second post"** — a launch-communications deliverable, not engineering
  (plan-review F13).
- **Lighthouse ≥90 and the 25-row `doc_url` spot-audit.**
- **OQ-14 / analytics.** No analytics script ships in this run.
- **The M1 House/Senate UA switch** to `https://publicfilings.org` — correct only
  after the domain serves. The SEC UA must never change.
- **TD-8 and TD-10** remain declared, not fixed.

**P3 does not close with this run.**

## Constraints

- **The separation invariant:** no workflow holds both `Pages Write` and GitHub
  write/attestation authority.
- **Cloudflare Direct Upload has no promote operation**; rollback is an explicit
  API call the job performs and verifies.
- Free tier: 20,000 files, 25 MiB/file, 500 deploys/month (two uploads per nightly).
- **The SEC UA must not change** — `tests/test_sec_client.py` asserts `PopulusBot`
  never appears in SEC headers.
- **Standing gate set is FIVE, not four:** `make test`, `make security`,
  `make accept-m2-5`, `make accept-m2-6`, **and `make accept-m1-b`**
  (`Makefile:96` → `scripts/accept_m1_b.py`), which the previous revision omitted
  (plan-review F14).

## Current State

- `publish.yml`: **one job**, **zero** `wrangler` references. No deploy job.
- `record-sign.yml`: self-declared **no-op shell**, gated off.
- **No code references `production_branch`.**
- `attestation.py:31` pins the signer identity to **`populus-data`** — but the
  workflow is in **`populus`**. Contradiction (R15).
- `cli.py:761` passes **`StagingNoop()`** — attestation is not live (R17).
- `build.py`: `stats.json` written at `:1598`, manifest at `:1889`, journal at
  `:1892` — all inside `run_build` (R1).
- **Wrangler: zero matches** in the dashboard manifest and lockfile (R20).
- `Makefile:96` defines `accept-m1-b`.
- ARCHITECTURE contains **two round-11 residues**: `:300` shows
  `"verification_scope": "full"` and `:895` says "full served-tree" — both
  contradict the correction that renamed the scope to `expected_paths`
  (plan-review F16).
- Live infra: account `d7b5e4995e76a76c9899695b54c61226`; project `publicfilings`,
  **zero deployments**; `production_branch: "main"`; custom domain attached,
  status `Initializing`. `CLOUDFLARE_PAGES_READ_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`
  and `CLOUDFLARE_PAGES_PROJECT` are **provisioned and verified**; `Pages:Edit`
  and `DATA_REPO_PAT` are **not yet set**.

## Detected Stack

Python 3.12+ (uv/Hatch, `uv sync --frozen`, stdlib `sqlite3`, `click`, pytest);
Astro 7 / TypeScript 6 (`dashboard/`, npm, `node:test`, `.node-version` 24.16.0);
GitHub Actions. Gates: `make test`, `security`, `accept-m2-5`, `accept-m2-6`,
`accept-m1-b`.

## Reuse Map

| Existing | Decision | Why |
|---|---|---|
| `src/populus/publish/digests.py` — `dist_digest()`, `DIST_DIGEST_VERSION` | **Reuse, called against a frozen snapshot** | Framing is correct; R19 supplies the stable input it assumes |
| `src/populus/publish/inventory.py` — `build_inventory`, `render_inventory`, `inventory_digest`, `write_inventory` | **Reuse, same snapshot** | RFC 8785 envelope already correct |
| `src/populus/publish/attestation.py` | **Extend + correct** | Holds the signer-identity constant (R15); previously omitted from Planned Files |
| `src/populus/publish/build.py` `run_build` | **Extend** | The finalize seam (R1); previously omitted |
| `tests/test_digests.py` | **Extend** | Add snapshot/mutation cases |
| `cli.py` `@main.command()` + `CliRunner` | **Extend** | No new CLI framework |
| fake-transport pattern in `tests/test_house_ingest.py` | **Reuse** | Fixture substrate |
| `src/populus/net/` SEC client | **Do NOT reuse** | SEC-specific host allowlist and UA |

## Architecture

1. **`src/populus/deploy/snapshot.py`** — the frozen upload snapshot (R19); digest
   and inventory both read it; Wrangler uploads from it.
2. **`src/populus/deploy/verify.py`** — `verify_markers`, `verify_inventory`,
   `provider_checks`, all with an injected transport.
3. **`src/populus/deploy/cloudflare.py`** — Pages API client pinned to named
   endpoints and response fields (R11).
4. **`src/populus/deploy/orchestrator.py`** — **the whole preview → verify →
   production → verify → rollback sequence as one injected, testable function**
   (plan-review F6). The workflow calls it; ordering guarantees become unit-
   testable, and removing the rollback step or reordering the branch assertion
   fails a test instead of leaving every helper green.
5. **`src/populus/cli.py`** — thin commands over the above.

## Locked Decisions

1. Deploy job and signer stay in separate workflows.
2. Reuse `dist_digest`/`inventory` as-is, over a frozen snapshot.
3. A separate Cloudflare client, not an extension of the SEC client.
4. Verification in Python with injected transports, not shell in YAML.
5. **Signer identity is `populus`** — correct the constant, don't move the file
   (**owner decision**; safe because nothing has ever been signed).
6. **Bootstrap by a one-time throwaway deployment**, not a code-level first-run
   exception (**owner decision**). R14 becomes an operator procedure; the deploy
   path keeps no exemption branch.
7. **Token scope is not introspectable.** Cloudflare exposes no API that proves a
   token lacks `Pages Write`. The §17 "credential fixture" therefore cannot assert
   runtime rejection of a Write-capable token. It is re-specified as a
   **provisioning-time control**: the token is created `Pages Read`-only, recorded
   in §14 (done, 2026-08-01), and the fixture asserts the signer **fails closed on
   a missing or unauthorized token** — the part that *is* verifiable. ARCHITECTURE
   is amended to stop claiming more (plan-review F11).

## Alternatives Considered

- **Inline the protocol in workflow shell** — rejected: the §17 fixtures become
  untestable (this is plan-review F6).
- **One workflow, two jobs** — rejected: attestations identify workflows.
- **Marker-only verification everywhere** — rejected: round-10 C1.
- **A code-level first-deploy exemption** (revision 1's R14) — **rejected by the
  owner** on the reviewer's reasoning: nothing enforced its single use.
- **Move `record-sign.yml` to `populus-data`** — rejected: a called reusable
  workflow runs with the caller's token, so it would still need a cross-repo
  credential; it changes the pinned identity for no gain.

## Planned Files

- `.github/workflows/publish.yml`
- `.github/workflows/record-sign.yml`
- `src/populus/deploy/__init__.py`
- `src/populus/deploy/snapshot.py`
- `src/populus/deploy/verify.py`
- `src/populus/deploy/cloudflare.py`
- `src/populus/deploy/orchestrator.py`
- `src/populus/cli.py`
- `src/populus/publish/build.py`
- `src/populus/publish/attestation.py`
- `src/populus/stats.py`
- `tests/schemas/stats.schema.json`
- `tests/test_stats.py`
- `tests/fixtures/deploy/cf_deployment_response.json`
- `dashboard/package.json`
- `dashboard/package-lock.json`
- `tests/test_deploy_snapshot.py`
- `tests/test_deploy_verify.py`
- `tests/test_deploy_cloudflare.py`
- `tests/test_deploy_orchestrator.py`
- `tests/test_deploy_cli.py`
- `tests/test_digests.py`
- `tests/test_publish.py`
- `docs/runbooks/deploy.md`
- `ARCHITECTURE.md`
- `STATUS.md`

## Implementation Tasks

- **T1** — `deploy/` package + `snapshot.py`; digest and inventory read one frozen
  snapshot. (R2, R3, R19)
- **T2** — `cloudflare.py` pinned to the named endpoints and response paths in
  R11; project read, deployment capture, rollback; **plus token self-inspection
  via `GET /accounts/{account_id}/tokens` (R21)**. Records a real deployment
  response from the live project as a committed fixture and pins the no-Functions
  assertion to its actual field. (R5, R8, R11, R21)
- **T3** — `verify.py`: markers, inventory sweep, provider checks. (R6, R8, R10, R11)
- **T4** — `orchestrator.py`: the full ordered sequence as one testable unit. (R6, R7, R8)
- **T5** — CLI commands. (R3, R6, R8, R10, R12)
- **T6** — `run_build` finalize seam: accept the site file count **before**
  manifest and journal assembly; update the stats schema/version. (R1)
- **T7** — `publish.yml`: site build, artifact (`site/**` + sibling inventory),
  isolated deploy job, permission boundary, orchestrator invocation. (R1, R3, R4)
- **T8** — `record-sign.yml` body; pass the data-repo PAT as a reusable-workflow
  secret; correct `P2_RECORD_SIGN_IDENTITY`; refuse to run without real
  attestation. (R9, R10, R11, R12, R15, R16, R17)
- **T9** — Pre-publish generation gate + corrected arming order. (R12, R18)
- **T9b** — **Workflow inertness (R13):** assert in tests that with both arming
  variables unset, `publish.yml` and `record-sign.yml` perform no ingest, no
  publication, no upload and no API call — and that every new module is importable
  and unit-testable with **no `Pages:Edit` token present**. (R13)
- **T10** — Pin Wrangler in `dashboard/package.json` + regenerate the lockfile;
  assert the frozen install resolves that exact version. (R20)
- **T11** — Docs: `docs/runbooks/deploy.md` (bootstrap procedure with its
  deployment ID, arming sequence, rollback); ARCHITECTURE amendments —
  **(a)** the R19 snapshot gap in §12.1, **(b)** the §12.1/success-criterion
  first-provisioning reality, **(c)** **restore** the token-scope claim (revision 2 wrongly weakened it — the
  Cloudflare token-list API does expose policies, R21),
  **(d)** delete the two `"full"` scope residues at `:300` and `:895` and add a
  documentation regression check rejecting the obsolete wording. (R11, R14, R19)

## Testing Strategy

Every §17 fixture achievable without a live token, as a unit test with an injected
transport. **Fixtures are one-mutation-at-a-time** — the previous revision mutated
HTML and JS together, so an implementation that never checked JS still passed on
the HTML failure (plan-review F7).

| Fixture | Test |
|---|---|
| production-branch mismatch aborts **before** upload | `test_deploy_cloudflare.py` |
| preview failure leaves production untouched | `test_deploy_orchestrator.py` |
| production verify failure → rollback to captured id, re-verified | `test_deploy_orchestrator.py` |
| **ordering**: rollback removed / production before preview / branch assertion moved after upload each fail | `test_deploy_orchestrator.py` |
| file mutated between preview and production uploads aborts | `test_deploy_orchestrator.py` |
| **snapshot**: mutation during enumeration, between sizing and hashing, and after the final check but before upload each fail | `test_deploy_snapshot.py` |
| signer rejects falsified `dist_digest` | `test_deploy_verify.py` |
| signer rejects a deployment id serving the wrong build | `test_deploy_verify.py` |
| **marker-preserving tamper, one file at a time** across representative asset classes (HTML, JS, CSS, JSON), asserting the **exact requested-path set and count** | `test_deploy_verify.py` |
| injected `_redirects` hijacking an inventoried path fails | `test_deploy_verify.py` |
| Functions-reporting deployment fails the no-Functions assertion | `test_deploy_verify.py` |
| **each control path poisoned separately**, so omitting any single probe fails | `test_deploy_verify.py` |
| signer fails closed on missing/unauthorized token (Locked Decision 7) | `test_deploy_cloudflare.py` |
| signer refuses to run without real attestation | `test_deploy_verify.py` |
| cross-repo generation write: checkout, append-only conflict refusal, commit, push | `test_deploy_cli.py` |
| pre-publish gate: signer failure → next publish aborts **before mutation** | `test_publish.py` |
| identity: current-identity positive, publish-workflow and wrong-repo negatives | `test_deploy_verify.py` |
| **TD-10 documented non-detection** asserted as *not detected* | `test_deploy_verify.py` |

Each ordering and disqualifier assertion carries a mutant proving it is
load-bearing.

## Verification Matrix

| Req | Verified by |
|---|---|
| R1 | T6; byte-equality + 15,000-cap tests; manifest/journal consistency test |
| R2 | T1; per-boundary tests |
| R3 | T1/T7; artifact layout test |
| R4 | T7; workflow permission assertion |
| R5 | T2; mismatch-aborts fixture |
| R6 | T3/T4; preview-failure fixture |
| R7 | T4; mutate-between-uploads fixture |
| R8 | T2/T4; rollback fixture, re-verified |
| R9 | T8; falsified-output fixtures |
| R10 | T3/T8; one-file-at-a-time tamper fixtures |
| R11 | T2/T3; pinned-field tests; separate control-path poisoning |
| R12 | T8/T9; append-only + fail-closed + pre-publish gate |
| R13 | **T9b**; inertness tests with both vars unset and no Edit token present |
| R14 | T11; bootstrap produces a **real attested generation** via the ordinary signer — verified by the same fixtures as any deploy; runbook records deployment ID + generation number |
| R15 | T8; identity positive/negative tests |
| R16 | T8; cross-repo write tests |
| R17 | T8; signer-refuses-without-attestation test |
| R18 | T9; arming order + pre-publish gate test |
| R19 | T1; three snapshot mutation-window tests |
| R20 | T10; frozen-install resolves the exact pinned version |
| R21 | T2; positive Read-only and negative `Pages Write` token-policy fixtures |

## Rollout / Rollback

**Phase 0 — bootstrap (operator, once, before anything is armed).** Deploy a
placeholder to `publicfilings`; confirm `publicfilings.org` leaves `Initializing`
and serves; record the deployment ID in `docs/runbooks/deploy.md` as the first
rollback anchor.

**Then, in this exact order (R18):**

1. Merge with both gates unset — workflows inert.
2. Set `DATA_REPO_PAT`; confirm the P2 attestation chain is live (R17) — the
   signer refuses to run otherwise.
3. Create `Pages:Edit`; set the deploy secret.
4. **Arm the signer first:** `POPULUS_RECORD_SIGN_ARMED=true`.
5. Then `POPULUS_PUBLISH_ARMED=true`; run once via `workflow_dispatch` and watch.
6. Confirm an attested generation appears and the pre-publish gate sees it.

Rollback: unset the armed vars (instant); revert the merge; use §13.5 with the
last attested generation, or the Phase-0 anchor.

## Simplicity Audit

Minimum coherent design is five small modules plus wiring. The orchestrator is
**added complexity that buys testability** — without it the ordering guarantees
live in YAML and cannot be tested at all (plan-review F6).

**Rejected:** a general deployment-provider interface; a retry framework; a shared
verification base class; and — newly — **a code-level first-deploy exemption**,
which the owner replaced with an operator bootstrap that leaves the deploy path
with no exemption branch at all.

Accepted, declared: the same bytes are verified twice by two actors with
different trust assumptions. That is the security argument, not duplication.

## Tech Debt Introduced

1. **One unverified placeholder deployment** will have existed (R14), replaced by
   the first protocol run. Owner: project owner. Removal condition: none needed —
   it is superseded, and its ID is recorded as the bootstrap anchor. **This is
   strictly less debt than revision 1's code-level relaxation**, which would have
   been a permanent branch in the deploy path.
2. **TD-8 and TD-10** remain declared, unchanged.
3. **Token scope cannot be introspected** (Locked Decision 7) — the control is
   provisioning-time, not runtime. ARCHITECTURE is amended to stop overclaiming.

## Memory Touch-Points

- **`specify-before-rewriting`** — decisive this round. Plan-review F5 and F2
  found defects in §12.1 *itself*. Per this memory they are fixed in the
  specification (T11), not worked around in the plan.
- **`verify-against-a-frozen-tree`** — twice: hash the tree around gate runs, and
  R19's frozen upload snapshot is the same principle applied to deployment.
- **`mutation-tests-pin-properties`** — plan-review F7 is exactly this memory:
  a fixture asserting an end state that a path-skipping mutation survives. Fixtures
  are now one-mutation-at-a-time with exact path-set assertions.
- **`review-scope-decides-the-verdict`** — review scoped to plan and spec.
- **`orchestrate-worktree-isolation`** — why this runs in a worktree.
- **`plan-v1-literal-rid-tokens`** — the DoD now enumerates every requirement ID
  literally; the previous revision's `R1–R14` range left R2–R13 without literal
  tokens (plan-review F15).

## Failure-Mode Sweep

- **F0 verify-don't-assume** — ✓ Current State re-derived from the tree; the
  previous revision's misses (attestation identity, `StagingNoop`, missing
  Wrangler, `accept-m1-b`, the build.py seam) all came from planning against the
  spec instead of the code.
- **F1 gate-list completeness** — ✓ **five** gates, including `accept-m1-b`.
- **F2 full-tree gate scope** — ✓ Makefile entrypoints.
- **F3 verify end-to-end** — ✓ orchestrator + CLI fixtures; final proof is one
  armed run.
- **F4 honest handoff** — ✓ Non-goals now include the rollback drill and second
  post.
- **F5 no self-signing** — ✓ external review before arming.
- **Not applicable:** data-migration modes — no schema changes beyond the stats
  version bump in T6, which is covered by R1's tests.

## Definition of Done

Every requirement enumerated literally (no ranges):

- **R1** done: `stage_build`/`finalize_build` seam lands the site count before manifest and journal; both `stats.json` copies byte-equal; 15,000-cap fails; stats schema version bumped with a compatibility test.
- **R2** done: digest asserted at all five boundaries over the frozen snapshot.
- **R3** done: `inventory.json` sibling to `site/`, from the same snapshot.
- **R4** done: deploy job has no GitHub write scopes; token step-scoped.
- **R5** done: mismatch aborts before upload.
- **R6** done: preview verified; failure leaves production untouched.
- **R7** done: mutation between uploads aborts.
- **R8** done: rollback to the captured anchor, re-verified.
- **R9** done: every falsified-output fixture rejected.
- **R10** done: one-file-at-a-time tamper fixtures pass with exact path-set assertions.
- **R11** done: provider checks pinned to the named endpoints/response paths; the no-Functions assertion is pinned to a committed real-response fixture; header normalization and the deterministic sample set are implemented; control paths poisoned separately.
- **R12** done: append-only generation; fail-closed; pre-publish gate.
- **R13** done: workflows inert while unarmed, proven by T9b's tests with no Edit token present.
- **R14** done: bootstrap executed; domain Active; the bootstrap deployment carries a **valid attested generation** produced by the ordinary signer, so the pre-publish gate passes and rollback has a re-verifiable target; ID + generation recorded.
- **R15** done: identity corrected; positive and negative identity tests pass.
- **R16** done: cross-repo write tested; PAT exposure recorded in §14.
- **R17** done: signer refuses to run without real attestation.
- **R18** done: signer armed before publisher; pre-publish gate test passes.
- **R19** done: the seven-step snapshot algorithm is implemented; mutation during copy is detected by the pre/post identity re-enumeration; three mutation-window tests exercise the **real filesystem**; §12.1 amended.
- **R20** done: frozen install resolves the exact pinned Wrangler version.
- **R21** done: signer reads back its own token policies and fails closed on anything but the approved read-only set; both fixtures pass.

Plus: all **five** Makefile gates exit 0 on a hash-stable tree; every §17 fixture
in Testing Strategy passes including the TD-10 non-detection; `docs/runbooks/deploy.md`
exists; ARCHITECTURE's two `"full"` residues are gone and a regression check rejects
the wording; §17 P3 status states what this run does and does not close.
