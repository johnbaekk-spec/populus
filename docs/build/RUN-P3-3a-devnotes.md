# Dev Notes — RUN P3-3a: make the attestation chain real (produce AND verify)

Implements `PLAN.md` revision 4 (durable copy `docs/build/RUN-P3-3a-plan.md`),
after four plan revisions and three external review rounds (9 → 7 → 5 blockers).

## Detected Stack

Python 3.12+ under `src/populus/` (uv/Hatch, `uv sync --frozen`, committed
`uv.lock`, stdlib `sqlite3`, `click`, pytest with an autouse no-network guard at
`tests/conftest.py:14-30`); Astro 7 / TypeScript 6 dashboard under `dashboard/`
(untouched); GitHub Actions. Five canonical gates: `make test`, `security`,
`accept-m1-b`, `accept-m2-5`, `accept-m2-6`.

New runtime dependency: `sigstore>=3.6.1` (+18 transitive). It clears G1 —
`scripts/dep_guard.py` denylists only vendor data providers — and
`ARCHITECTURE.md:350` already named `sigstore-python` as the intended verifier,
so this implements a specification rather than inventing one.

## Requirement and Task Completion

| Req | Substance | State |
|---|---|---|
| R1 | `publish.yml` attests; failed attestation blocks the pointer commit | Done — attest step between `Publish` and `Verify`; Verify runs `--attestation=sigstore`; ordering pinned by a mutant |
| R2 | Workflow unarmed; today's publishes are manual | Done — stated in the runbook and STATUS, not hidden |
| R3 | Repository facts | Done — `populus` public, `populus-data` private until §15.3 |
| R4 | Attesting in P1 is a **recorded** reversal | Done — decision record in `docs/runbooks/attestation.md`; ARCHITECTURE `:347`, `:356`, `:829` annotated |
| R5 | Lookups target `populus` | Done — `ATTESTATION_REPO` |
| R6 | Both identity constants name `populus` | Done — both derived from `ATTESTATION_REPO` |
| R7 | Identity per subject kind; unknown → refuse | Done — `resolve_identity`, no default |
| R8 | Real provider with all five pins | Done — `SigstoreAttestation` |
| R9 | `rejected` vs `unavailable` | Done — `outcome`; `unavailable` never cached; Verify authenticated |
| R10 | Injectable fetcher + trust config | Done — offline fixtures under the socket guard |
| R11 | Cache keyed by digest **and** pins | Done |
| R12 | Structural guard is the mechanism | Done — `tests/test_attestation_structure.py` |
| R13 | Production omissions fixed | Done — **11**, guard green |
| R14 | Explicit selection at five entry points | Done — CLI, MCP argparse, monitor CLI, workflow, acceptance scripts |
| R15 | Failing `attest()` stops the publish | Done — `_require_attested` at all three sites |
| R16 | Broken callers updated | Done — see Changed Files |
| R17 | `preflight-attestation` | Done |
| R18 | Docs corrected everywhere | Done — acceptance grep clean |
| R19 | Drift test | Done |

## Changed Files

Read from `git status` / `git diff --shortstat`, not from intent.

**19 modified, 7 added.** `+968/−99` across the tracked modifications.

**Source (6):** `publish/attestation.py` (the provider, identity map, outcomes,
trust-config protocol, selector), `publish/build.py` (`_require_attested` at three
sites), `client/snapshot.py` (`GitHubBundleFetcher` — see Plan Deviations),
`mcp_server/server.py` (two client constructions + argparse), `cli.py` (option,
resolver, `preflight-attestation`), `scripts/monitor.py` (main() + argparse).

**Scripts (3):** the three acceptance scripts — explicit `StagingNoop`.

**Workflow (1):** `publish.yml` — job-scoped permissions, SHA-pinned attest step,
`GH_TOKEN` on Verify, `--attestation` on all three invocations.

**Tests (5 modified, 2 added):** `test_attestation.py` (new, 16 fixtures),
`test_attestation_structure.py` (new, the guard), `test_publish.py`,
`test_mcp_server_inst.py`, `test_schema.py`.

**Docs (5):** `ARCHITECTURE.md` (7 sites), `REVIEW-RESPONSE.md`, `STATUS.md`,
`docs/runbooks/rollback.md`, `docs/runbooks/attestation.md` (new).

**Untracked, must be `git add`ed:** `docs/build/RUN-P3-3a-plan.md`,
`RUN-P3-3b-plan-draft.md`, `RUN-P3-3a-evidence/`, `docs/runbooks/attestation.md`,
`tests/test_attestation*.py`, `REVIEW.md`.

## Reuse / Duplication Check

- `AttestationProvider`, `AttestationResult`, `StagingNoop` — **reused
  unchanged** in shape; `AttestationResult` gained an additive `outcome` field
  with a default, so every pre-existing two-argument construction still works.
- `client/snapshot.py` — reused as the home for HTTP fetching (see Plan
  Deviations) and its `Fetcher` **pattern** for the injectable bundle fetcher.
- `publish.yml`'s existing `Verify`-before-`Commit` order — **reused as the
  enforcement point.** No new gate was invented; the change makes the existing
  one meaningful.
- The AST/signature walk written to *compute* this run's scope was promoted into
  a committed test rather than thrown away.
- `src/populus/net/` SEC client — deliberately not reused (SEC-specific host
  allowlist and UA).

## Simplicity Audit

The design shrank by measuring. Revision 3 proposed making `attestation` a
required argument everywhere: ~190 edits. Computing the distribution showed only
**11 production call sites** mattered; the other ~180 are hermetic tests that
legitimately want the no-op. So the enforcement is one structural test plus 11
edits — same property, 5% of the churn, and it catches the *omission* shape that
a required argument cannot express when 180 legitimate callers exist.

Rejected: a provider registry (two providers, forever); an abstract verification
pipeline (one predicate type); caching beyond a keyed dict; `attestation_phase`
(deferred to P3-3c).

Accepted and declared: AST walking in a test is unusual for this repo. Justified
because three rounds of human enumeration produced three wrong answers.

## Tech Debt Introduced

1. **A deliberate `--attestation=staging-noop` on a real build is still
   accepted.** Refusing it needs an artifact phase marker — deferred to **P3-3c**
   because neither the manifest nor the pointer has a schema version that can
   carry it, both validators reject unknown keys, and live builds plus the
   deployed monitor would break. Owner: project owner.
2. **`POPULUS_PUBLISH_ARMED` is unprovisioned**, so R1's enforcement has never
   run in anger; manual publishes are gated only by the operator's flag. Owner
   action.
3. **Third-party verification** waits on the §15.3 counsel gate.
4. **`attest()` is a seam, not a signer** for the Sigstore provider.
5. **Test call sites keep the defaulted parameter** — exempt by design.
6. **Deployment-generation attestation** unexercised until P3-3b; R19 mitigates.

## Memory Touch-Points

- **`measure-the-mechanism`** — decisive. Three hand-enumerations, three wrong
  answers; ~30 lines of AST gave the right one and shrank the design.
- **`reversing-a-reviewed-decision`** — R4: §5.5's "P1 is unattested" is
  overturned because its premise was false, with the record written and the
  property kept. The same discipline applied to sharpening (not loosening) the
  `GH_TOKEN` step-scoping test.
- **`mutation-tests-pin-properties`** — the mutant list includes the structural
  guard itself.
- **`verify-against-a-frozen-tree`** — tree hashed around the gate run.
- **`specify-before-rewriting`**, **`review-scope-decides-the-verdict`**,
  **`orchestrate-worktree-isolation`**, **`plan-v1-literal-rid-tokens`**.

## Failure-Mode Sweep

- **F0 verify-don't-assume** — ✓ scope computed, not asserted. Every count in
  this document is read from git or from a run.
- **F1 gate-list completeness** — ✓ all five; R13 exists because three of them
  were about to break.
- **F2 full-tree gate scope** — ✓ Makefile entrypoints; the guard walks the tree.
- **F3 verify end-to-end** — ✓ owner-side reachable; the arming prerequisite and
  the counsel gate are both named, not assumed away.
- **F4 honest handoff** — ✓ six declared debts, two of which limit this run's own
  enforcement.
- **F5 no self-signing** — ✓ green gates are reported as green gates, not as
  correctness. This run has had no code review yet.
- **N/A** data-migration — the schema change was cut.

## Tests Run

**Mutation table — 14/14 killed** (`docs/build/RUN-P3-3a-evidence/`).

The first run killed only **9/14**, and the survivors mattered:

| Survivor | Why | Fix |
|---|---|---|
| M9 cache key | the test compared **two provider instances**, and the cache is per-instance — so a fresh one was empty and the key never mattered | a same-instance test: two subjects, same bytes, different required identities |
| M10 failing `attest()` | **nothing in the suite exercised the new raise** | direct `_require_attested` test, both arms |
| M-WF-ORDER | my mutant renamed the step to `zzz-Attest`, which still matches the substring — the mutant was bad, not the test | delete the step entirely |
| M7 / M8 | anchor strings had stray indentation | corrected |

Two of those (M9, M10) were **real test gaps** — assertions that would have
survived the property being removed. That is exactly what
`mutation-tests-pin-properties` exists to catch, and it caught them here.

## Plan Deviations

1. **`GitHubBundleFetcher` lives in `client/snapshot.py`, not
   `publish/attestation.py`.** The plan put it in the attestation module. The
   repo's own `test_dep_guard.py` forbids `httpx` outside four allowlisted
   modules, and `publish/attestation.py` is not one. Rather than widen a security
   allowlist to fit my code, the adapter moved to the module that already
   concentrates HTTP fetching. Better outcome than planned: `attestation.py` is
   now pure protocol and verification with no I/O.
2. **Two docstrings were reworded** because the same lint matches the words
   "socket" and "requests" in prose.
3. **`test_publish.py`'s `GH_TOKEN` step-scoping assertion was changed** — the
   only security test edited in this run, so it is called out rather than buried.
   Its property is *"the long-lived PAT is step-scoped to build and publish"*, but
   it expressed that by counting **any** step carrying `GH_TOKEN`. The Verify step
   now carries `github.token` — the job's ephemeral token, not a secret — so the
   count broke while the property held. The assertion was **sharpened**: it now
   pins the PAT specifically to exactly two steps **and** forbids any other secret
   from appearing as `GH_TOKEN` anywhere in the job. Strictly stronger than what
   it replaced; a reviewer should nonetheless check that judgement.
4. **`actions/attest-build-provenance` is SHA-pinned** to
   `96b4a1ef7235a096b17240c259729fdd70c83d45`. The first draft used `@v2` and the
   repo's own §14 test caught it.
5. **`tests/test_publish.py` and `test_schema.py` were in the blast radius**
   beyond the plan's named list — both drive the MCP argparse or the CLI. Found by
   running the suite, which is what R16 is for.

## Model Provenance

Implemented by Claude Opus 5 in the owner's live session, against `PLAN.md`
revision 4. Plan reviewed across three rounds by an adversarial Claude reviewer
standing in for Codex (quota exhausted); rounds 1–3 returned 9, 7 and 5 blockers
respectively, all addressed across revisions 2–4. **No code review has been run
on this implementation yet.**
