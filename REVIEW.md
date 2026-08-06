# Review Brief: RUN P3-3b — Deploy the dashboard, and sign what went live

**Plan:** `PLAN.md` (byte-identical durable copy at `docs/build/RUN-P3-3b-plan.md`), validates as `plan-v1`
**Branch:** `plan/p3-3-deploy` @ `41b037d`, worktree `/Users/johnbaek/projects/Populus-p3-3`
**Review round:** 3 of 3 — **revision 3**. Round 2 returned 7 blockers + 9 nits; every one is answered below. Requirements grew from 23 to 26.
**Transport:** `interactive-disk`. Schema `review-brief-v1`.
**Reviewer:** Claude (external Codex quota exhausted). Same bar.

**This is a PLAN review. No implementation exists** — `src/populus/deploy/` is
absent. "Diff Context" describes proposed interfaces only.

**Focus areas for round 3, in priority order:**

1. **Is the first-run design finally sound — and is it sound for the right
   reason?** Three mechanisms have now been rejected (a `bootstrap` input, a
   code-level exemption, activation polling). Revision 3 does not replace the third
   with a fourth: it moves domain activation **out of the deploy path entirely**
   into owner prerequisite 4, and **declares the residual risk as TD-4 instead of
   engineering it away.** Attack both halves — is the prerequisite genuinely
   one-time and checkable, and is TD-4 an honest declaration or a way of writing
   off a problem that still needs solving?
2. **Round 2 found provider facts wrong, not just design gaps.** Revision 2 polled
   a field the pinned endpoint does not return and specified a delete the provider
   refuses. Every Cloudflare claim in revision 3 is now cited. **Re-check them
   against current documentation** — this is the class of error that has survived
   two rounds.
3. **Scope, for the fourth time.** Planned Files grew by 13. Round 2 derived every
   one of those independently. Do the same again: the failure mode here is not a
   wrong list, it is a list assembled from the previous reviewer's findings rather
   than from the tree.

## Summary of Changes

The dashboard is built and gate-passing; nothing deploys it. This run implements
§12.1's publisher-side protocol — site build, frozen snapshot, isolated deploy
job with preview→verify→production→verify→rollback, and the `record-sign.yml`
body that writes an attested deployment generation.

**What revision 3 changed.**

Round 2 falsified revision 2's central mechanism on three independent counts, each
verified against Cloudflare's own documentation: `GET /pages/projects/{project}`
returns `domains` as an **array of strings** with no status (per-domain `status`
lives only on the `…/{project}/domains` subresource); nothing documents a
deployment causing activation (the documented causes of a stuck domain are
**DNS/ACME validation failure and Let's Encrypt rate-limiting**); and deletion
**"will not delete the active production deployment if one exists"**, so revision
2's compensation was not an available operation.

Revision 3 therefore stops trying to solve the first run in code. **Domain
activation becomes owner prerequisite 4**, confirmed via the domains subresource
before arming — the same kind of one-time provisioning as the token prerequisites
beside it, and the reason it survives objections that killed three in-workflow
designs is that it never touches the per-deploy path. The first run's genuine
residual risk — no rollback target, and no permitted delete — is **restored as
TD-4**, which revision 1 had declared honestly and revision 2 deleted on the
strength of a mechanism that does not exist.

Round 2 also found four defects nothing had caught: **nothing in the tree emits
`dist/stats.json`** (R24) though ARCHITECTURE `:684` requires byte-equality with
the canonical copy; the provisional manifest would **self-list** through
`build.py:1849`'s rglob (R2); `methodology/index.astro:193` renders the **full**
manifest digest in a reader-facing verify command — a larger instance of the
defect R19 was fixing on the footer; and the existing verifier would **refuse** a
deployment generation outright, because `actions/attest-build-provenance` names
subjects by basename while `resolve_identity` (`attestation.py:92`) requires the
`deployments/` prefix (R25).

**Owner input received mid-revision, folded in.** `CLOUDFLARE_PAGES_READ_TOKEN`
was verified account-owned against `GET /accounts/{id}/tokens` — closing R22's open
question — with a **single-element** `["Pages Read"]` permission array, which lets
the signer assert "read is all I have" rather than merely "I have read". The same
enumeration surfaced a pre-existing **user-owned**, non-expiring token with broad
zone-level Read that the account endpoint cannot see. That does not breach §14's
separation invariant, but it **falsifies the completeness claim the audit story
rests on** — recorded as **R26** and **TD-5**.

## Round-2 Finding Ledger

Treat "resolved" as a claim to falsify.

| # | Round-2 finding | Resolution in revision 3 | Verify at |
|---|---|---|---|
| **B1** | R11 polls `domains[]`, a string array with no status | Pinned the `/domains` subresource; the project endpoint is explicitly never read for status | R11; Architecture; Testing |
| **B2** | The activation premise is undocumented; failure unbounded | Premise removed from the deploy path entirely → owner prerequisite 4; documented real causes recorded | R11, R14; Rollout 4; Current State |
| **B3** | Deleting the sole deployment is refused by Cloudflare | **No DELETE endpoint in the design.** TD-4 restored with a removal condition | R11; TD-4; Architecture |
| **B4** | `dist/stats.json` has no emitter | New **R24** + `dashboard/src/pages/stats.json.ts`; ordering stated | R24, T7 |
| **B5** | Provisional manifest self-lists via `:1849` rglob; journal invariant | `finalize_build` deletes it before re-assembly; self-listing + journal-recovery fixtures | R2, T5 |
| **B6** | `methodology/index.astro:193` renders the full digest | Added to Planned Files and T7; `--manifest` argument dropped | R19, T7 |
| **B7** | Verifier refuses a generation — basename vs `deployments/` prefix | New **R25**: explicit `subject-name`, round-trip fixture | R25, T10 |
| **N1** | "~180 callers" is 49, only 4 production | Corrected with the four named | R2 |
| **N2** | R21's breakage citation wrong (`:241` is a docstring) | Corrected to `:245`'s `assert invocations`, and its real trigger | R21 |
| **N3** | Gate step named "verify" trips `_step_index` → 3 tests | Step renamed; `_step_index` hardened under T12 | R18, T11, T12 |
| **N4** | Doc-regression check would delete the revision-history record | Scoped to exclude the revision-history table | R16 |
| **N5** | §17(h) credential fixtures silently narrowed | Added to Testing Strategy | Testing; T10 |
| **N6** | R7's justification false in the respect that matters | Rewritten: the real reason is no `id-token: write`; artifact channel named | R7, R5 |
| **N7** | `stage_build` `**kwargs` forwarding fails the guard | Explicit-keyword requirement stated | T5 |
| **N8** | CSP `_headers` foreclosed and undeclared | Added to Non-goals | Non-goals |
| **N9** | `monitor.py` correctly not a hazard | Recorded as such | Current State |

**Round-2 findings NOT carried:** none.

## Detected Stack

Python 3.12+ (uv/Hatch, `uv sync --frozen`, `click`, pytest with an autouse
no-network guard); Astro 7 / TypeScript 6 (`dashboard/.node-version` 24.16.0,
`npm ci`); GitHub Actions; five Makefile gates — and note `make test` runs
`npm run gates` (`Makefile:52-53`), so `dashboard/test/*.test.ts` is inside it.

## Reuse / Duplication Check

Carried from PLAN.md. Two rows changed since round 2: the dashboard row now names
`pages/methodology/index.astro`, and a new row covers the three
`dashboard/test/*.test.ts` fixture files that `make test` executes.

## Simplicity Audit

Revision 3 moves the first-run problem **out of the codebase**: no bootstrap
input, no polling loop, no timeout, no exemption, no compensating special case —
a precondition assertion and a rollback, both of which the steady-state path needs
anyway. The residual risk is declared rather than engineered around.

The file list grew because round 2 re-derived the blast radius. The orchestrator
remains deliberate complexity so that ordering guarantees are failing tests rather
than opinions.

## Tech Debt Introduced

1. **TD-8 / TD-10** — unchanged.
2. **§17's P3 gate does not close** — the ≥3-nightly requirement is time-based.
3. **Third-party verification** waits on the §15.3 counsel gate.
4. **TD-4 — the first production deploy has no automated compensation.** Bounded
   by R9 (the same bytes already passed the full inventory sweep on preview).
   Removal condition: the first successful deploy.
5. **TD-5 — the credential audit surface is incomplete by construction.**
   User-owned tokens are invisible to `GET /accounts/{id}/tokens`. Owner decision;
   R26 records the fact.

## Memory Touch-Points

- **`measure-the-mechanism`** — rounds 1 and 2 each found scope derived from the
  draft rather than the tree. Revision 3's additions all cite file:line.
- **`reversing-a-reviewed-decision`** — TD-4's restoration is the clearest case:
  revision 1 was right, revision 2 removed it on a false premise, revision 3 puts
  it back **and records why**, rather than quietly reinstating it.
- **`specify-before-rewriting`** — three rejected first-run mechanisms in one
  problem is the signal; revision 3 stops iterating on the mechanism and changes
  what kind of thing it is.
- **`mutation-tests-pin-properties`**, **`verify-against-a-frozen-tree`**,
  **`review-scope-decides-the-verdict`**, **`orchestrate-worktree-isolation`**.

## Repo Structure Conformance

`src/populus/deploy/` mirrors `src/populus/publish/`. Tests one-per-module under
`tests/`; fixtures under `tests/fixtures/deploy/`. `dashboard/src/pages/stats.json.ts`
follows Astro's endpoint-route convention. No new top-level directory.

## Failure-Mode Sweep

- **F0 verify-don't-assume** — round 2 proved revision 2 failed this **for the
  provider**. Every Cloudflare claim is now cited to documentation; every code
  claim to file:line.
- **F1 gate-list completeness** — five gates; R3 exists because *three* files
  validate the schema, and revision 2 leaned on the one that is normally skipped.
- **F2 full-tree gate scope** — Makefile entrypoints, now traced into
  `npm run gates`.
- **F3 verify end-to-end** — Rollout step 8 is the real proof; four owner
  prerequisites.
- **F4 honest handoff** — Non-goals covers every §17 item not closed, plus the CSP
  foreclosure; §17(h) is in scope rather than dropped.
- **F5 no self-signing** — 4 code-review blockers plus 15 across two plan rounds.
  Expecting a third.

## Diff Context

**No diff exists.** Proposed shape only.

### `src/populus/deploy/` (new)
`snapshot.py` (R4's seven steps); `cloudflare.py` — project GET for
`production_branch`, **`/domains` subresource for per-domain status**, deployments
list, rollback, and **no delete**; `verify.py` (marker parsing by `<meta>` name,
inventory sweep, provider checks); `orchestrator.py` (the ordered sequence).

### `.github/workflows/publish.yml`
Site build (absent today), immutable artifact, isolated deploy job, the verifying
pre-publish gate, and the caller-side job that turns a skipped signer into a
failed run. Deploy job holds the Cloudflare token and **no GitHub write scopes**.

### `.github/workflows/record-sign.yml`
Replaces the `echo` no-op; adds the `secrets:` block it lacks today; attests the
generation under the explicit subject name `deployments/<gen>.json` (R25).

### `src/populus/publish/build.py`
`stage_build()` / `finalize_build(staged, *, site_file_count)` with the provisional
manifest deleted before re-assembly; `run_build` retained for its 4 production
callers; `attestation=` forwarded by explicit keyword.

### `dashboard/`
Markers, `SITE_CODE_SHA`, digest removal from **both** pages, the
`dist/stats.json` emitter, and the three test-fixture files `make test` runs.

## Review Checklist

- [ ] **Is prerequisite 4 genuinely checkable and one-time?** It asserts
      `status: active` on the domains subresource before arming. Can the domain
      revert to a non-active state later — and if so, does R11's per-run
      precondition assertion catch it, or does it only abort *after* the preview
      deploy has already happened?
- [ ] **Is TD-4 an honest declaration or a write-off?** The claim is that a
      production-only failure after a green preview indicates routing or cache
      rather than bad bytes. Is that reasoning sound, and is "owner remediates via
      runbook" acceptable for a one-time window, or does it need a mechanism?
- [ ] **Re-verify every Cloudflare claim.** The `domains` string-array shape, the
      domains-subresource status values, the active-production-deployment delete
      refusal, and the documented causes of a stuck `Initializing`. Two rounds of
      provider facts have been wrong.
- [ ] **R25 — is the subject-name fix correct?** It asserts
      `actions/attest-build-provenance` accepts `subject-name` + `subject-digest`
      in place of `subject-path`, and that `deployments/<gen>.json` satisfies both
      `resolve_identity`'s prefix arm (`attestation.py:92`) and
      `_subject_name_matches` (`:396-401`). Check the action's actual input contract.
- [ ] **R24 — is an Astro endpoint route the right emitter,** and does the stated
      ordering (canonical patched before `:1849`'s rglob, `dist/` after
      enumeration) actually hold? It rests on "patching an existing file adds no
      files to the walk."
- [ ] **R2/B5 — does deleting the provisional manifest before re-assembly fully
      restore today's behaviour?** Consider `build_journal`'s text inlining
      (`:686-690`) and `materialize_from_journal` (`:853-875`) recovery.
- [ ] **Scope, independently.** Re-derive rather than checking the list.
- [ ] **R20 — is a caller-side `if: always()` assertion job the right mechanism,**
      and does the workflow-semantics fixture actually prove it detects the skip?
- [ ] **R26 — does recording the blind spot suffice,** or does §14's invariant need
      restating given a credential exists that no account-level audit can see?
- [ ] Is anything in Non-goals narrowed rather than deferred?
- [ ] Is the mutant list sufficient for ordering, the marker contract, R25's
      subject binding, and R18's verification step?

## Open Questions

1. **Is prerequisite 4 acceptable, or does moving a precondition to the owner
   count as the same evasion three in-workflow designs were rejected for?** The
   argument for it: it is provisioning, like the three token prerequisites, and it
   is verified by an API call whose result is recorded. The argument against: the
   run still cannot prove it end-to-end without a human first.
2. **Should TD-4 block the run?** It is a genuine one-time window where an
   unverified deployment can serve. The alternative — deleting the Pages project
   as compensation — requires removing the CNAME first and returns the domain to
   the state prerequisite 4 exists to clear.
3. **Does R26 belong in this run at all?** It records a pre-existing credential
   fact discovered while provisioning. Arguably it is a §14 documentation task, not
   a deploy-run requirement.

## Constraints & Context

- **§14 separation invariant**, as amended by R7: no **job** holds both
  `Pages Write` and GitHub write/attestation authority — and per R7's corrected
  reasoning, the operative fact is that a Pages-Write job without `id-token: write`
  cannot mint an attestation, *not* the permission block alone.
- **Cloudflare Direct Upload has no promote operation**; production is a second
  upload, rollback an explicit API call, and **deletion of an active production
  deployment is refused**.
- **The deploy token is account-scoped.** No security property may rest on
  Cloudflare-side state being unrestorable.
- **Free tier:** 20,000 files, 25 MiB/file, 500 deploys/month.
- **`tests/conftest.py` forbids network** → injected transports.
- **`publish.yml` runs on `schedule`** — revision 3 adds no input.
- **Live infrastructure:** account `d7b5e4995e76a76c9899695b54c61226`; project
  `publicfilings`, zero deployments, `production_branch: main`; domain attached and
  `Initializing` (prerequisite 4 must clear this).
  `CLOUDFLARE_PAGES_READ_TOKEN` **account-owned, verified**, `["Pages Read"]` only,
  expires 2027-08-03. `DATA_REPO_PAT` and `Pages:Edit` not set; both `*_ARMED`
  unprovisioned — **the publish workflow has never run.**
- **Closed by architecture rounds 9–11 — do not reopen as "simplification":**
  merging the deploy job and record signer; sharing one Cloudflare token;
  verifying marker files instead of the full inventory.

## Previous Review Feedback

**Round 2: 7 blockers + 9 nits — all addressed**, ledger above.
**Round 1: 8 blockers + 4 nits — all addressed** in revision 2; three of those
resolutions were themselves corrected by round 2 (F1 incomplete, F3's justification
measurably wrong, F7 a misdiagnosis).
**Predecessor draft** (`docs/build/RUN-P3-3b-plan-draft.md`): three rounds,
16 → 7 → 7 blockers.

**The pattern across all five rounds, stated plainly:** every rejected finding has
been *a claim that looked verified but was not* — a grep that could not see an
omission, a green test exercising only a fake, a precondition its own plan could
reset, a marker check that passed on a replaced page, and now an API field that
does not exist and an operation the provider declines. **The highest-value move is
to pick the claim in this document that is least checkable and check it.**
