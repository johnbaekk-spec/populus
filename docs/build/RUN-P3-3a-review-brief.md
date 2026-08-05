# Review Brief: RUN P3-3a — Make the attestation chain real (produce AND verify)

**Plan:** `PLAN.md` (byte-identical durable copy at `docs/build/RUN-P3-3a-plan.md`), validates as `plan-v1`
**Branch:** `plan/p3-3-deploy`, based on `main` @ `cb8bfc5`, worktree `/Users/johnbaek/projects/Populus-p3-3`
**Review round:** CODE review, round 1 — the plan phase closed at revision 4 after three rounds (9 → 7 → 5 blockers)
**Transport:** `interactive-disk`. Schema `review-brief-v1`.
**Reviewer:** Claude (external Codex quota exhausted). Same bar.

**This is a CODE review.** Implementation is complete: see `DEV-NOTES.md` and
the working diff. All five Makefile gates pass on a frozen tree, and the
mutation table is 14/14. There is no QA report — no orchestrated QA phase ran.

**Three things to look at first, all called out by the implementer rather than
found by a reviewer:**

1. **A security test was edited.** `test_publish.py`'s `GH_TOKEN` step-scoping
   assertion counted *any* step carrying a token and required each to equal the
   PAT. The Verify step now carries `github.token` (the job's ephemeral token,
   not a secret), which broke the count while the property held. It was
   **sharpened** — pins the PAT to exactly two steps AND forbids any other
   secret as `GH_TOKEN` anywhere — but editing a security assertion so one's own
   change passes deserves scrutiny. Judge it.
2. **`attest()` is a seam, not a signer.** The Actions step signs; the provider
   cannot mint a bundle. Enforcement is the workflow step order
   (attest → verify → commit). Check that this is genuinely enforcing, and that
   the three `PublishError` raises are not dead code dressed as a control.
3. **The `httpx` adapter moved** from `publish/attestation.py` to
   `client/snapshot.py` because `test_dep_guard.py` forbids `httpx` outside four
   allowlisted modules. Confirm this was the right call versus widening the
   allowlist.

**Focus areas, round 3:** whether round 2's seven blockers are closed; whether
the blast radius is now complete (round 2 found three of five standing gates and
the shipped MCP server outside scope); and whether R1's step ordering is genuine
enforcement rather than another unwired half.

## Summary of Changes

Round 2 confirmed revision 2 fixed the measurement problem — five fallbacks,
three discarded `attest()` results and nine protocol-typed parameters all
re-grepped exactly as stated. What it found instead was that **the widening was
drawn one step short again, in the same direction**: making `attestation`
required breaks **three of the five standing gates**, and
`mcp_server/server.py:1025/:1079` — the **shipped MCP server** — constructs
`SnapshotClient` with no provider and silently inherits the no-op. Revision 2's
own acceptance grep would have passed while that stayed broken, because the file
simply *omits* the argument rather than containing the searched string.

**Owner decision this revision: `attestation_phase` is CUT** to a named follow-on
(P3-3c). Round 2 established it had no schema vehicle — `tests/schemas/` holds
only `stats.schema.json`, both validators are code and closed-world, and
`pointer_version` is the replay counter, not a schema version — while live
published builds and a separately-deployed monitor would reject the new field.
It defended against *implicit* paths to a fake verdict, and R10/R11 remove those
entirely.

Revision 3 therefore: **produces** attestations with real enforcement (the attest
step lands between the existing `Publish` and `Verify` steps, and Verify runs
`--attestation=sigstore`, so a missing or failed attestation blocks the pointer
commit); **verifies** them; and **closes every omission path** across six sites
and four entry points, with the full caller blast radius — three acceptance
scripts and four test modules — in scope.

## Detected Stack

- **Python 3.12+** under `src/populus/` — uv/Hatch, `uv sync --frozen`, committed
  `uv.lock`; stdlib `sqlite3`; `click` CLI (`CliRunner`); pytest with an
  **autouse no-network guard** (`tests/conftest.py:14-23`, "network access is
  forbidden").
- Runtime deps (`pyproject.toml`): `httpx`, `lxml`, `packaging`, `pdfplumber`,
  `pypdf`, `pyyaml`, `click`, `rfc8785`, **`mcp>=1.28.1`** — round 1 (F12) caught
  that revision 1's brief omitted `mcp`.
- **Astro 7 / TypeScript 6** under `dashboard/` — **untouched**.
- **GitHub Actions** — `publish.yml`, `record-sign.yml`, both in `populus`.
- Gates: **five** — `test`, `security`, `accept-m2-5`, `accept-m2-6`, `accept-m1-b`.

## Reuse / Duplication Check

Carried from PLAN.md's Reuse Map; re-verified against `main` @ `cb8bfc5`.

| Existing | Decision | Verified |
|---|---|---|
| `AttestationProvider` protocol (`attestation.py:46`) | **Reuse unchanged** | **nine protocol-typed parameters** (`build.py:1127/1300/1482/2059/2157/2334`, `pointer.py:202`, `client/snapshot.py:269`, `scripts/monitor.py:91`) **plus three CLI supply sites** (`cli.py:749/844/1033`) — round-2 F21's correction to revision 2's undifferentiated "twelve" |
| `AttestationResult` (`:39`) | **Reuse unchanged** | `ok`/`detail` carries the failed-check name |
| `StagingNoop` (`:59`) | **Keep, never a default** | §5.5 mandates an unattested P1 path; existing publish/pointer suites pass it deliberately |
| `P2_OIDC_ISSUER` (`:35`) | **Reuse** | already correct |
| `Fetcher` protocol pattern (`client/snapshot.py`) | **Reuse** | makes R8's offline fixtures constructible under the socket guard |
| `publish.yml`'s existing `Verify`-before-`Commit` order | **Reuse as the enforcement point — new in rev 3** | no new gate needed; R1 makes the existing one meaningful |
| artifact-vs-manifest size + hash check (`snapshot.py:586`, `:920`) | **Reuse** | §5.5 element 8 is already implemented; the plan does not rebuild it |
| `cli.py` `@main.command()` + `CliRunner` | **Extend** | established shape |
| `src/populus/net/` SEC client | **Do NOT reuse** | SEC-specific host allowlist and UA |

## Simplicity Audit

Carried from PLAN.md. Minimum coherent design is one provider class, one
subject→identity mapping, four explicit entry points, and **deletions**.

**Cutting `attestation_phase` removed the only new data structure, the only
schema change, and the only live-consumer risk** — revision 3 is smaller than
revision 2 despite covering more files, because the added files are callers being
made explicit rather than new mechanism.

**Rejected as over-abstraction:** a provider registry; an abstract verification
pipeline; caching beyond a digest-keyed dict; the phase field (deferred to P3-3c,
not abandoned); a default value on any selection surface.

**Accepted and declared:** four entry points each need an explicit choice, which
is more surface than one central default. That is the point — a central default
is exactly what six sites silently inherited.

## Tech Debt Introduced

Carried from PLAN.md. Four declared items:

1. **No P2-marked-artifact refusal until P3-3c.** With R10/R11 there is no
   *implicit* path to a no-op verdict, but a **deliberate**
   `--attestation=staging-noop` on a P2 build is still accepted. Owner: project
   owner. Removal condition: a compatibility mechanism for the closed-world
   validators plus a monitor upgrade ordering.
2. **Third-party verification blocked** by the §15.3 counsel gate on `populus-data`.
3. **`attest()` is a seam, not a signer** for the Sigstore provider — the Actions
   step signs. Stated plainly rather than implied; enforcement is R1's ordering.
   This is the honest restatement round-2 F17 asked for.
4. **Deployment-generation attestation unexercised until P3-3b**; R16's drift test
   is the mitigation.

**No hidden debt:** no diff exists. Re-run that check at code review.

## Memory Touch-Points

- **`specify-before-rewriting`** — both the split and this widening are responses
  to repeated blockers in one mechanism.
- **`verify-against-a-frozen-tree`** — hash the tree around gate runs.
- **`reversing-a-reviewed-decision`** — **new and decisive in rev 3.** §5.5's
  "P1 is unattested by necessity" was a reviewed decision; R3 overturns it because
  its premise (the attesting workflow lives in a private repo) is false — the
  workflow is in public `populus`. Property kept, mechanism replaced, record written.
- **`mutation-tests-pin-properties`** — the mutant list now covers the workflow
  step ordering and each of the four entry points, not just provider internals.
- **`review-scope-decides-the-verdict`** — review scoped to plan and spec.
- **`orchestrate-worktree-isolation`** — the main checkout's root slots belong to
  the live RUN M2-8.
- **`plan-v1-literal-rid-tokens`** — the DoD enumerates R1–R16 literally.

## Repo Structure Conformance

| Planned addition | Conventional location | Actual location | Conforms? | Notes |
|---|---|---|---|---|
| `SigstoreAttestation` + identity mapping | beside the seam | `src/populus/publish/attestation.py` | yes | same module as the protocol and `StagingNoop` |
| MCP-server provider selection | the server's own `argparse` surface | `src/populus/mcp_server/server.py` | yes | symmetric with the click flag; round-2 F14 |
| acceptance-script provider args | `scripts/accept_*.py` | the three existing scripts | yes | hermetic, so `StagingNoop` **explicitly** |
| `--attestation` flag, `preflight-attestation` | `src/populus/cli.py` | `src/populus/cli.py` | yes | extends the existing command block |
| attest step + permissions | the publishing workflow | `.github/workflows/publish.yml` | yes | modifies an existing workflow; adds none |
| tests | flat `tests/test_<area>.py` | `test_attestation.py`, plus edits to `test_publish.py`, `test_pointer_state.py` | yes | matches convention |
| schemas | `tests/schemas/` | `manifest.schema.json`, `pointer.schema.json` | yes | sibling of the existing `stats.schema.json` |
| offline bundle + trusted-root fixtures | `tests/fixtures/<area>/` | `tests/fixtures/attestation/` | yes | matches `tests/fixtures/inst/…` convention |
| runbook | `docs/runbooks/` | `docs/runbooks/attestation.md` | yes | siblings: `disaster-recovery.md`, `rollback.md` |

**No new modules, packages, or top-level directories.**

## Failure-Mode Sweep

- **F0 verify-don't-assume** — ✓ **and this is exactly where revision 1 failed.**
  It claimed five protocol dependents (twelve), one fallback (five), zero dropped
  `attest()` results (three), and a private `populus` (public). Every Current
  State line in revision 2 was re-measured. The reviewer should re-measure again.
- **F1 gate-list completeness** — ✓ five gates.
- **F2 full-tree gate scope** — ✓ Makefile entrypoints.
- **F3 verify end-to-end** — ✓ owner-side verification is reachable in this run
  and is Rollout step 3; third-party is explicitly out of scope behind a named
  external gate.
- **F4 honest handoff** — ✓ Non-goals and Tech Debt name both external gates
  (§15.3 counsel flip; P3-3b).
- **F5 no self-signing** — ✓ this review precedes merge.
- **N/A:** data-migration — `attestation_phase` is additive with a compatibility
  test (R12), not a migration.

## Diff Context

**No diff exists.** Proposed shape only.

### `.github/workflows/publish.yml` — the producing half (new in rev 2)
**What's changing:** add `id-token: write` + `attestations: write` to the publish
job; add an attest step over `manifest.json`, each `latest.json` generation, and
every Release asset.
**Key decision:** this is what round 1 found missing entirely. Without it the
verifier has nothing to verify and P3-3b stays blocked.

### `src/populus/publish/attestation.py`
**Proposed:** `SigstoreAttestation(repo, identities, issuer, *, fetcher, trusted_root)`.
**Key decisions:**
- `identities` is a **subject→identity mapping** (round-1 F7: a single identity
  per instance cannot express the per-subject-kind requirement it was traced to).
  Unknown subject name → `ok=False`, never a default identity.
- `fetcher` and `trusted_root` are injectable (round-1 F8: both the bundle fetch
  and Sigstore's TUF root refresh are network operations, and every test runs
  under an autouse socket guard).
- `verify()` returns `ok=False` naming the failed check; never raises past the seam.

### `build.py`, `client/snapshot.py`, `scripts/monitor.py` — the deletions
**What's changing:** remove all five `or StagingNoop()` defaults (`attestation`
becomes required); make the three `attest()` sites raise `PublishError` on
`ok=False`.
**Key decision:** the class is not the hazard — the implicit defaults are.

### `manifest.py`, `pointer.py` — the P2 discriminator
**What's changing:** add `attestation_phase`; refuse a `StagingNoop` verdict on a
P2-marked artifact in `run_publish` and `evaluate_pointer`.
**Key decision:** data-derived, not environment-derived.

### `ARCHITECTURE.md`
**What's changing:** `:350`'s lookup endpoint **and** its certificate identity
(both wrong, both on one line); `:778` and `:349`, which tie attestation
availability to the wrong repository's visibility; a correction note against
`REVIEW-RESPONSE.md:88/:126`.

## Review Checklist

- [ ] Per-finding disposition for round 2's F13–F21.
- [ ] **Is the blast radius complete NOW?** Round 2 found seven files outside
      scope, three of them standing gates. Re-grep every caller of `run_build`,
      `run_publish`, `run_verify`, `SnapshotClient(`, and `evaluate_pointer(`
      across `src/`, `scripts/` and `tests/`. Is anything still missing?
- [ ] **Is R1's ordering genuine enforcement?** The attest step sits between
      `Publish` and `Verify`, and Verify runs `--attestation=sigstore`, so a
      missing attestation should fail Verify and block the pointer commit. Trace
      it: does `populus verify` actually fail when no bundle exists, or does it
      pass because `verify()` returns `ok=False` somewhere that is not checked?
- [ ] **R10's acceptance is a test, not a grep** — revision 2's grep would have
      passed while `mcp_server/server.py` stayed broken. Does the stated test
      actually catch *omission* at every one of the six sites?
- [ ] **R3's decision record.** Overturning §5.5's "P1 is unattested" is a
      reviewed-decision reversal. Is the premise-falsification argument correct —
      does attestation availability genuinely depend on `populus`'s visibility and
      not `populus-data`'s?
- [ ] **R15's targeted grep.** Does it return nothing after the amendments while
      leaving `:724`/`:778`'s correct `populus-data` mentions intact?
- [ ] **Is cutting `attestation_phase` safe?** With R10/R11, is there genuinely no
      *implicit* path to a no-op verdict left — or does cutting it reopen something?
- [ ] Is the mutant list sufficient, especially for the workflow ordering and the
      four entry points?
- [ ] Anything in Non-goals **narrowed** rather than explicitly deferred?

## Open Questions

Round 2's three were answered and adopted (see Previous Review Feedback). What
remains uncertain:

1. **Is `attest()`-as-a-seam honest enough?** For the Sigstore provider it cannot
   fail, because the Actions step does the signing. R12 still requires the three
   call sites to raise on `ok=False`. Is that dead code that should be deleted, or
   correctly-preserved seam behaviour for a future provider that can fail?
2. **Should the acceptance scripts pass `StagingNoop` or a fixture-backed real
   provider?** They are hermetic and offline, so the no-op is the honest choice —
   but it means three of five gates never exercise the real path.
3. **Is four entry points the right number**, or should selection be centralised
   in one factory that each entry point calls, so a fifth entry point added later
   cannot forget?

## Constraints & Context

- **`populus` is PUBLIC** (verified `gh repo view … --json isPrivate` → `false`),
  so attestation creation and unauthenticated lookup both work today. Round 1's
  F1 flagged revision 1 for saying otherwise — that measurement was true when
  written and the repo was flipped between writing and review.
- **`populus-data` is private until the §15.3 counsel gate** — DR-5 says it
  *"starts private (staging) and flips public only after"* it. Revision 1 misread
  this as "stays private" (round-1 F4), which made its own goal unreachable.
- **The protocol shape cannot change** — twelve dependents.
- **`tests/conftest.py` forbids network in every test** — drives R7.
- **`sigstore-python` clears G1**: `dep_guard.py` denylists only
  `{polygon, massive, quiverquant, unusual-whales, unusualwhales}`, and
  `ARCHITECTURE.md:350` already names `sigstore-python` as the intended verifier.
- **Unauthenticated attestation lookups are rate-limited to 60/hour** — the
  runbook must say so, or an operator will read a 403 as a verification failure.
- **Closed by architecture rounds 9–11; do not reopen as "simplification":** the
  deploy job and record signer stay separate workflows; they never share one
  Cloudflare token; the signer verifies the full inventory, not marker files. None
  are in P3-3a's scope, but a reviewer may reach for them by reflex.

## Previous Review Feedback

### Round 2 — 7 blockers, 2 nits; all addressed

- **F13 (blast radius: 3 of 5 gates + 6 files outside scope)** → **R13**; all
  seven files in Planned Files. DoD R13 is now "all five Makefile gates exit 0",
  the direct check that the radius is complete.
- **F14 (shipped MCP server silently unverified)** → **R10** extended to six sites
  including `server.py:1025/:1079`; R11 gives the server its own explicit argparse
  surface; **DoD R10 is a test, not a grep** — revision 2's grep would have passed
  while this stayed broken.
- **F15 (no schema vehicle; closed-world validators; live consumers)** → the
  field is **CUT** to P3-3c by owner decision.
- **F16 (R11 guarded 2 of 5 verdict sites; phase provenance unspecified)** →
  dissolved by the cut. R10/R11 remove every implicit path instead.
- **F17 (produce and verify unwired; `attest()` unspecified)** → **R1** puts the
  attest step between the existing `Publish` and `Verify` steps and runs Verify
  with `--attestation=sigstore`, so a failed attestation blocks the pointer
  commit. `attest()` is honestly restated as a seam, not a signer (Tech Debt 3).
- **F18 (R1 reverses §5.5's P1 decision without a record; DoD grep unsatisfiable)**
  → **R3** is an explicit decision record naming the falsified premise; **R15**
  widened from four sites to seven; the DoD grep is now targeted so `:724`/`:778`'s
  correct mentions survive.
- **F19 (defaultless flag breaks the nightly)** → **R11** covers all four entry
  points including `publish.yml`'s three invocations; T10 adds them; a workflow
  lint test pins it.
- **F20 (nit: bare trusted root would still trigger TUF)** → **R8** names a
  committed **trust configuration**.
- **F21 (nit: "twelve dependents" mixed two categories)** → Constraints now say
  nine protocol-typed parameters plus three CLI supply sites.

**Round-2 answers adopted:** cut the phase field rather than split producing from
the deletions (the reviewer's answer to Open Question 3); keep `--attestation`
defaultless everywhere including read-only commands, because "read-only
ergonomics" is exactly the argument that produced the six omission sites — the
worst of which is inside `verify`.

### Round 1 — 9 blockers, 3 nits; all addressed

F1 stale repo measurement (timing artifact; repo flipped between writing and
review) → R2. F2 Success Criteria contradicted the DoD → fixture-based success,
live chain a post-merge milestone. F3 nothing attested → the widening, now R1.
F4 DR-5 misread as "stays private" → owner-side vs third-party split. F5 five
fallbacks + three dropped results → R10/R12. F6 discriminator undefined →
superseded by the cut. F7 single-identity constructor → R6 mapping. F8 fixtures
unconstructible under the socket guard → R8 seams. F9 ARCHITECTURE
under-corrected → R15. F10 monitor "unchanged" → in scope. F11 orphan clause →
handoff note. F12 dep list / rate limit → corrected.
