# RUN P3-3a — Make the attestation chain real (produce AND verify)

> **Revision 4 — final plan revision.** Rounds 1–3 returned 9, 7 and 5 blockers.
> The recurring failure was always the same: **the scope was enumerated by
> grepping for a string (`or StagingNoop()`) when the defect is an *omission*, and
> a missing argument has no string to find.** Three hand-enumerations gave three
> different wrong answers.
>
> **Revision 4 stops enumerating and computes.** An AST + `inspect.signature` walk
> over `src/`, `scripts/` and `tests/` produced the definitive set: **six**
> omission-capable `attestation` parameters and **~190** call sites that omit the
> argument. Two of the six (`run_build:1475`, `reconcile_inflight:1295`) were
> named by no previous round, including the reviewer's.
>
> That measurement changed the design. Of ~190 omitting call sites, **only nine
> are production code**; the rest are hermetic tests that legitimately want the
> no-op and carry no trust posture. So **the structural check becomes the
> mechanism** rather than a required-argument refactor: nine production edits plus
> one permanent automated guard, instead of ~190 mechanical edits enforcing the
> same property. The guard also catches the *omission* shape that defeated three
> rounds of grepping.
>
> **Transport:** `interactive-disk` in `/Users/johnbaek/projects/Populus-p3-3`.

## Goal and Success Criteria

Make Populus actually sign what it publishes, actually check those signatures, and
make it mechanically impossible for production code to reach a fake verdict.

- **Owner-side verification — deliverable by this run.** The publish workflow
  attests; the publisher, the monitor and the MCP client verify against pinned
  identities.
- **Third-party verification — NOT deliverable.** Subject bytes live in
  `populus-data`, private until the §15.3 counsel gate.

**Success** = all five Makefile gates green; the structural guard passes with zero
production omissions; `populus preflight-attestation` exits 0 on a good fixture
chain and non-zero **naming the failed check** otherwise; and a verification
failure is distinguishable from a lookup failure.

## Requirements

### Producing signatures

- **R1** — **`publish.yml` attests, and a failed attestation blocks the pointer
  commit — on the workflow path.** Add `id-token: write` + `attestations: write`
  and an attest step over `manifest.json`, each `latest.json` generation, and every
  Release asset, inserted **between the existing `Publish` and `Verify` steps**,
  with Verify running `--attestation=sigstore`. `cli.py:1046-1052` exits non-zero
  on `not report.ok`, and the `Commit manifest and pointer` step (`:76`) has no
  `if: always()`, so a failed Verify genuinely prevents the commit. **Scope stated
  honestly (round-3 F25): this gates the *workflow* path only.**
- **R2** — **The workflow is not armed, and today's publishes are manual.**
  `publish.yml:1-3` says so in its own header and `:31-33` guards on
  `vars.POPULUS_PUBLISH_ARMED == 'true'`, which is unprovisioned; `STATUS.md:79`
  documents the live sequence as run by hand. Revision 3 asserted "no
  prerequisite" — false. Provisioning that variable is a **named owner
  prerequisite** for Rollout steps 2–3. On the manual path the operator's
  `--attestation` choice is the only gate; that is stated, not hidden.
- **R3** — **Repository facts.** `populus` is PUBLIC, so attestation creation and
  lookup work today. `populus-data` stays private until §15.3.
- **R4** — **Attesting during P1 is a deliberate, recorded reversal.**
  ARCHITECTURE says P1 is "unattested by necessity" (`:347`), "**No attestation
  steps**" (`:356`), unavailable on the private staging repo (`:829`). That premise
  assumed the attesting workflow lived in `populus-data`; it lives in **public
  `populus`**, so the premise is false. Keep the property, replace the mechanism,
  write the record (`reversing-a-reviewed-decision`).

### Verifying signatures

- **R5** — **Attestations are looked up in `populus`** — GitHub associates an
  attestation with the repository whose workflow created it.
- **R6** — **Both certificate-identity constants name `populus`**
  (`attestation.py:27`, `:31`). Safe: nothing has ever been attested.
- **R7** — **Identity resolves per subject kind**: `manifest.json`, `latest.json`
  and asset names → `P2_PUBLISH_IDENTITY`; deployment generations →
  `P2_RECORD_SIGN_IDENTITY`; **unknown subject → `ok=False`**, never a default.
- **R8** — **A real provider implements the existing protocol**, pinning the trust
  configuration, OIDC issuer, per-subject identity, SLSA provenance predicate, and
  subject-digest match; `ok=False` with a `detail` naming the failed check.
- **R9** — **`AttestationResult` distinguishes "failed verification" from "could
  not verify."** The Verify step performs *unauthenticated* lookups capped at
  60/hour shared per runner IP, so a quota or transport error is otherwise
  indistinguishable from tampering — in the gate that blocks the pointer commit
  (round-3 F26). Two remedies, both required: the Verify step gets
  `attestations: read` and `GH_TOKEN: ${{ github.token }}`; and the result carries
  a distinct transport/quota outcome with its own fixture and killing mutant.
  **A green pointer commit must mean "checked", never "couldn't ask".**
- **R10** — **Injectable fetcher and committed trust configuration** — not a bare
  trusted root, which would still trigger a TUF refresh under the autouse socket
  guard (`tests/conftest.py:14-30`).
- **R11** — **Verified results cached by subject digest**, never across differing
  identity or issuer pins.

### Closing the omission holes — mechanically

- **R12** — **A structural guard is the mechanism.** A test walks
  `inspect.signature` over every `attestation`-taking public function and asserts
  **no call site under `src/` or `scripts/` omits the argument** (AST walk, which
  sees omission — the shape a grep cannot). It also asserts every
  `SnapshotClient(...)` construction in production code passes it. This is what
  converts a recurring miss into a permanent mechanical check. **Test call sites
  are deliberately exempt**: they are hermetic, they legitimately want
  `StagingNoop`, and they carry no trust posture.
- **R13** — **The nine production omissions are fixed**, computed not enumerated:
  `mcp_server/server.py:1025`, `:1079`; `scripts/monitor.py:295`;
  `scripts/accept_m1_b.py:745/748/751`; `accept_m2_5.py:120/121`;
  `accept_m2_6.py:108/109` (`:125` constructs a `SnapshotClient` too). The
  acceptance scripts pass `StagingNoop` **explicitly** — hermetic, offline, and
  the explicitness is the point.
- **R14** — **Provider selection is explicit at five entry points, not four**:
  the click CLI, the MCP server's argparse (`server.py:994`), `publish.yml`'s
  three invocations, the three acceptance scripts, and **`scripts/monitor.py`'s
  own `main()` (`:273`)** — a deployed launchd command documented at
  `docs/runbooks/rollback.md:121` (round-3 F24).
- **R15** — **A failing `attest()` stops the publish.** `build.py:1254`, `:1283`,
  `:2144` each raise `PublishError` on `ok=False`. For the Sigstore provider
  `attest()` is honestly a **seam, not a signer**; R1's ordering is the
  enforcement. The raises keep the seam usable by a provider that can fail.

### Blast radius, gates, docs

- **R16** — **Every caller broken by the entry-point changes is updated**,
  including `tests/test_mcp_server_inst.py` (`:592`, `:597`, `:1063`, `:1130`
  drive the real argparse with fixed `sys.argv`, so a required option makes them
  `SystemExit(2)` — round-3 F23) and the `SnapshotClient` construction embedded in
  a **subprocess source string** at `tests/test_pointer_state.py:857-863`, which no
  type checker or import will surface (round-3 F29).
- **R17** — **`populus preflight-attestation`** exits 0 on a good chain, non-zero
  naming the failed check otherwise.
- **R18** — **Docs corrected everywhere.** `ARCHITECTURE.md:350` (lookup endpoint
  **and** certificate identity — both on one line), `:347`, `:356`, `:773`,
  `:778`, `:829`, plus `:234-236`'s CLI surface which becomes invalid once
  `--attestation` is required; `REVIEW-RESPONSE.md:88/:126`;
  `docs/runbooks/rollback.md:121`'s monitor invocation; `STATUS.md:79`.
  Acceptance is the **targeted** grep in the DoD — `:724` and `:778` contain
  correct `populus-data` mentions that must survive.
- **R19** — **A structural drift test** ties both identity constants and the
  lookup URL to one source, asserted against the repository the workflows live in.

## Scope

The attestation module; `publish.yml`'s permissions, attest step, token and
explicit flags; the nine production omissions; three `attest()` sites; five entry
points; the structural guard; the callers those changes break; docs.

## Non-goals

- **`attestation_phase` / P2-marked-artifact refusal → P3-3c.** Owner: project
  owner. Cut because neither document has a schema vehicle (`tests/schemas/` holds
  only `stats.schema.json`; both validators are closed-world at `pointer.py:88-90`
  and `manifest.py:326-328`; `pointer_version` is the replay counter) and live
  builds plus the deployed monitor would reject the field. Removal condition: a
  compatibility mechanism plus a monitor upgrade ordering.
- **Required-argument refactor of ~180 test call sites** — the structural guard
  (R12) enforces the same property on the code that matters, at 5% of the cost.
  Deliberately not done, not overlooked.
- **The Cloudflare deploy job and record-signer** — P3-3b.
- **Third-party verification** — §15.3 counsel gate.
- **Arming the nightly** — owner action (R2).
- **Lighthouse, analytics, the UA switch, TD-8/TD-10.**

## Constraints

- Protocol shape fixed: **nine protocol-typed parameters plus three CLI supply
  sites**; six of those nine are omission-capable (defaulted).
- `tests/conftest.py:14-30` forbids network in every test.
- `sigstore-python` clears G1 and is already named by `ARCHITECTURE.md:350`.
- Unauthenticated attestation lookups: 60/hour, shared per runner IP → R9.
- Standing gates: **five**.

## Current State

- `attestation.py`: protocol (`:46`), `AttestationResult` (`:39`), `StagingNoop`
  (`:59`). **No real provider.** Both identity constants and the lookup docstring
  pin `populus-data`.
- **Six omission-capable parameters** (computed): `build.py:1295`
  (`reconcile_inflight`), `:1475` (`run_build`), `:2151` (`run_publish`), `:2329`
  (`run_verify`), `client/snapshot.py:262`, `scripts/monitor.py:85`.
- **~190 omitting call sites; nine in production** (R13).
- `publish.yml`: `contents: read`, zero `attest`, **guarded off** by
  `POPULUS_PUBLISH_ARMED`, Verify step has **no token**.
- Five verdict consumers all act correctly on `ok=False`: `pointer.py:231`,
  `build.py:2375`/`:2397`, `client/snapshot.py:809`, `scripts/monitor.py:169`.
- `populus` PUBLIC; `populus-data` private; live builds published.

## Detected Stack

Python 3.12+ (uv/Hatch, `uv sync --frozen`, `click`, pytest with an autouse
no-network guard); deps include `mcp>=1.28.1`; Astro 7 dashboard untouched; GitHub
Actions. Five Makefile gates.

## Reuse Map

| Existing | Decision | Why |
|---|---|---|
| `AttestationProvider` protocol (`:46`) | **Reuse unchanged** | nine typed parameters depend on it |
| `AttestationResult` (`:39`) | **Extend** | R9 adds a transport/quota outcome alongside `ok`/`detail` |
| `StagingNoop` (`:59`) | **Keep** | §5.5 mandates an unattested P1 path; hermetic gates and ~180 tests want it explicitly |
| `P2_OIDC_ISSUER` (`:35`) | **Reuse** | already correct |
| `Fetcher` protocol (`client/snapshot.py`) | **Reuse** | makes R10's offline fixtures constructible |
| artifact-vs-manifest size+hash (`snapshot.py:586/:920`) | **Reuse** | §5.5 element 8 already implemented |
| `publish.yml`'s `Verify`-before-`Commit` order | **Reuse as the enforcement point** | no new gate invented |
| the AST/signature walk written to compute this scope | **Promote to a committed test** | R12 — it is the mechanism |
| `src/populus/net/` SEC client | **Do NOT reuse** | SEC-specific allowlist and UA |

## Architecture

`SigstoreAttestation(repo, identities, issuer, *, fetcher, trust_config)` behind
the unchanged protocol. `verify()` fetches candidates, filters to the SLSA
predicate with a matching subject digest, verifies against trust config, issuer
and resolved identity, and returns a result that **names the failed check and
distinguishes a lookup failure from a verification failure** (R9).

Selection is explicit at five entry points. Correctness is enforced not by a
required argument but by **R12's structural guard** — the only mechanism that
catches omission, which is the actual defect shape.

## Locked Decisions

1. Attestations live in `populus`.
2. The protocol shape does not change.
3. **The structural guard is the enforcement mechanism**; test call sites are
   exempt by design.
4. `StagingNoop` stays, explicitly selected at every production site.
5. Enforcement on the workflow path is R1's step ordering; the manual path is
   gated only by the operator's choice, stated in R2.
6. `attestation_phase` is cut to P3-3c.
7. Stop and report if `sigstore-python` fails `dep_guard`.

## Alternatives Considered

- **Required-argument refactor everywhere (revision 3)** — rejected on
  measurement: ~190 edits to enforce a property that matters at nine sites, and it
  still would not have caught the two parameters no round found.
- **Keep enumerating scope by grep** — rejected: three rounds, three wrong answers.
- **Ship the site first, defer signing (Path B)** — rejected by the owner in
  favour of the architecture's ordering.
- **Delete `StagingNoop`** — rejected: §5.5 mandates an unattested P1 path.

## Planned Files

- `src/populus/publish/attestation.py`
- `src/populus/publish/build.py`
- `src/populus/client/snapshot.py`
- `src/populus/mcp_server/server.py`
- `src/populus/cli.py`
- `scripts/monitor.py`
- `scripts/accept_m1_b.py`
- `scripts/accept_m2_5.py`
- `scripts/accept_m2_6.py`
- `.github/workflows/publish.yml`
- `tests/test_attestation.py`
- `tests/test_attestation_structure.py`
- `tests/test_publish.py`
- `tests/test_pointer_state.py`
- `tests/test_mcp_server_inst.py`
- `tests/fixtures/attestation/bundle_valid.json`
- `tests/fixtures/attestation/trust_config.json`
- `pyproject.toml`
- `uv.lock`
- `docs/runbooks/attestation.md`
- `docs/runbooks/rollback.md`
- `ARCHITECTURE.md`
- `REVIEW-RESPONSE.md`
- `STATUS.md`

## Implementation Tasks

- **T1** — Correct both identity constants and the lookup docstring; add R19's
  single-source repository segment. (R5, R6, R19)
- **T2** — Add `sigstore-python`; confirm `make security`. Stop and report if not. (R8)
- **T3** — Implement `SigstoreAttestation`: identity mapping, fetcher and
  trust-config seams, named-failure `detail`, **and R9's transport/quota
  distinction**; commit offline fixtures. (R7, R8, R9, R10)
- **T4** — Digest-keyed cache. (R11)
- **T5** — **`tests/test_attestation_structure.py`** — the AST + signature guard.
  Written and passing (against the nine known omissions) **before** T6, so it
  proves it catches them. (R12)
- **T6** — Fix the nine production omissions. (R13)
- **T7** — Explicit selection at all five entry points, including
  `scripts/monitor.py`'s `main()`. (R14)
- **T8** — Three `attest()` sites raise `PublishError` on `ok=False`. (R15)
- **T9** — Update callers broken by T7: `tests/test_mcp_server_inst.py`'s four
  argv lists and the embedded subprocess script at `test_pointer_state.py:857-863`. (R16)
- **T10** — `populus preflight-attestation`. (R17)
- **T11** — `publish.yml`: permissions incl. `attestations: read`, `GH_TOKEN` on
  Verify, the attest step between Publish and Verify, `--attestation` on all three
  invocations. (R1, R9, R14)
- **T12** — Docs: the P1 decision record; the repository-facts statement (`populus` public, `populus-data` private until §15.3, and what each bounds); `docs/runbooks/attestation.md` (incl.
  the 60/hour limit); ARCHITECTURE `:234-236`, `:347`, `:350`, `:356`, `:773`,
  `:778`, `:829`; `REVIEW-RESPONSE.md`; `rollback.md:121`; `STATUS.md:79`.
  (R2, R3, R4, R18)

## Testing Strategy

| Fixture | Test |
|---|---|
| valid bundle, correct identity + issuer → `ok=True` | `test_attestation.py` |
| wrong identity / wrong issuer / digest mismatch / wrong predicate / wrong trust config → `ok=False`, detail names the check | `test_attestation.py` |
| no bundle found → `ok=False`, never silently true | `test_attestation.py` |
| **rate-limit or transport error → a DISTINCT outcome, not "verification failed"** | `test_attestation.py` |
| unknown subject name → `ok=False`, no default identity | `test_attestation.py` |
| deployment subject with the publish identity → `ok=False` | `test_attestation.py` |
| lookup URL targets `populus` | `test_attestation.py` |
| **structural guard: zero omitting call sites under `src/` and `scripts/`** | `test_attestation_structure.py` |
| **structural guard catches a deliberately reintroduced omission** | `test_attestation_structure.py` |
| each of the five entry points refuses to run without an explicit provider | `test_attestation.py`, `test_mcp_server_inst.py` |
| three `attest()` sites raise `PublishError` on `ok=False` | `test_publish.py` |
| `publish.yml` lint: permissions, `GH_TOKEN` on Verify, attest step precedes Verify, `--attestation` on all three invocations | `test_attestation_structure.py` |
| `preflight-attestation` exit codes, each broken chain named | `test_attestation.py` |
| cache never crosses identity/issuer pins | `test_attestation.py` |
| R19 drift test | `test_attestation.py` |

**Required killing mutants:** each of the identity, issuer, digest-match,
predicate and trust-config pins; the lookup-repository segment; the
transport/verification distinction; **the structural guard itself** (reintroduce
an omission — the guard must fail); the attest-step-before-Verify ordering;
`GH_TOKEN` on Verify; the defaultless option at each of the five entry points;
each of the three `PublishError` raises. A test asserting only `ok is False`
without isolating which check fired is insufficient.

## Verification Matrix

| Req | Verified by |
|---|---|
| R1 | T11; workflow lint asserts step order and Verify's flag |
| R2 | T12; the arming prerequisite is named in Rollout and Current State |
| R3 | T12; repo facts stated |
| R4 | T12; the decision record exists and names the falsified premise |
| R5 | T1; lookup-URL test + mutant |
| R6 | T1; wrong-identity tests, both subject kinds |
| R7 | T3; unknown-subject and cross-kind tests |
| R8 | T3; the provider fixtures |
| R9 | T3/T11; transport-vs-verification fixture + mutant; `GH_TOKEN` lint |
| R10 | T3; the matrix runs offline under the socket guard |
| R11 | T4; cache-isolation test |
| R12 | T5; guard passes on the fixed tree and **fails on a reintroduced omission** |
| R13 | T6; the guard is the check |
| R14 | T7; five entry-point tests |
| R15 | T8; three `PublishError` tests + mutants |
| R16 | T9; **all five Makefile gates exit 0** |
| R17 | T10; preflight exit codes |
| R18 | T12; targeted grep returns nothing; `:724`/`:778` untouched |
| R19 | T1; drift test |

## Rollout / Rollback

1. Merge. Production entry points now require an explicit `--attestation`; test
   call sites are unchanged.
2. **Owner prerequisite:** provision `POPULUS_PUBLISH_ARMED=true` (R2) — until
   then the nightly does not run and R1's enforcement is untested in anger.
3. Nightly runs with `--attestation=sigstore`; the publish job attests and Verify
   blocks the commit if it cannot verify.
4. `populus preflight-attestation` against that build — first end-to-end proof.
5. Post-merge milestone: third-party verification at the §15.3 counsel gate.
6. P3-3b's signer then has an authentic `build_id`.

Rollback: revert the merge. Attestations are additive and unreferenced until
something verifies them.

## Simplicity Audit

The design got **smaller** by measuring: one provider class, one identity mapping,
five explicit entry points, nine edits, one guard. Revision 3's ~190-edit refactor
is replaced by a test.

**Rejected:** a provider registry; an abstract verification pipeline; caching
beyond a digest-keyed dict; the phase field (deferred); the required-argument
refactor of test call sites.

**Accepted, declared:** the structural guard is meta-programming (AST walking) in
the test suite, which is unusual for this repo. Justified because three rounds of
human enumeration produced three wrong answers and the guard is the only thing
that sees an omission.

## Tech Debt Introduced

1. **No P2-marked-artifact refusal until P3-3c** — a *deliberate*
   `--attestation=staging-noop` on a P2 build is still accepted. Owner: project
   owner.
2. **Manual publishes are gated only by the operator's choice** (R2) — R1's
   enforcement is workflow-path only, and the workflow is unarmed.
3. **Third-party verification blocked** by the §15.3 counsel gate.
4. **`attest()` is a seam, not a signer** for the Sigstore provider.
5. **Test call sites keep the defaulted parameter** — the guard exempts them by
   design; a future test could pass an unintended provider without failing it.
6. **Deployment-generation attestation unexercised until P3-3b**; R19 mitigates.

## Memory Touch-Points

- **`measure-the-mechanism`** — decisive. Three rounds of counting by hand gave
  three answers; thirty lines of AST gave the right one and shrank the design.
- **`reversing-a-reviewed-decision`** — R4 keeps the property, replaces the
  mechanism, writes the record.
- **`mutation-tests-pin-properties`** — the guard itself has a mutant: reintroduce
  an omission and it must fail.
- **`specify-before-rewriting`**, **`verify-against-a-frozen-tree`**,
  **`review-scope-decides-the-verdict`**, **`orchestrate-worktree-isolation`**,
  **`plan-v1-literal-rid-tokens`** — as before; the DoD enumerates R1–R19 literally.

## Failure-Mode Sweep

- **F0 verify-don't-assume** — ✓ the scope is now *computed*. Rounds 1–3 each
  asserted a count from a grep; each was wrong.
- **F1 gate-list completeness** — ✓ five gates; R16's DoD is that all five pass.
- **F2 full-tree gate scope** — ✓ Makefile entrypoints; the structural guard walks
  the whole tree.
- **F3 verify end-to-end** — ✓ owner-side reachable; the arming prerequisite (R2)
  and the counsel gate are both named rather than assumed away.
- **F4 honest handoff** — ✓ six declared debts, including the two that limit this
  run's own enforcement.
- **F5 no self-signing** — ✓ three external rounds already; the plan is now
  implementable.
- **N/A:** data-migration — the schema change was cut.

## Definition of Done

- **R1** done: attest step between Publish and Verify; Verify carries
  `--attestation=sigstore`; the ordering mutant is killed.
- **R2** done: the arming guard is stated in Current State and named as a Rollout
  prerequisite; no "no prerequisite" claim survives.
- **R3** done: repo facts stated with the `populus-data` bound.
- **R4** done: the P1 decision record exists and names the falsified premise.
- **R5** done: lookups target `populus`; URL test and mutant pass.
- **R6** done: both constants name `populus`.
- **R7** done: unknown subject → `ok=False`; cross-kind test passes.
- **R8** done: provider fixtures pass, each pin with a killing mutant.
- **R9** done: a rate-limit failure is reported distinctly from a verification
  failure; `GH_TOKEN` and `attestations: read` are on the Verify step; the mutant
  is killed.
- **R10** done: the full matrix runs offline under the socket guard.
- **R11** done: cache-isolation test passes.
- **R12** done: the guard passes on the fixed tree **and fails when an omission is
  reintroduced**.
- **R13** done: all nine production omissions fixed; the guard is the check.
- **R14** done: all five entry points refuse to run without an explicit choice.
- **R15** done: all three `attest()` sites raise on `ok=False`.
- **R16** done: **all five Makefile gates exit 0** on a hash-stable tree.
- **R17** done: preflight exits 0 on a good chain, non-zero naming each broken check.
- **R18** done: `grep -n 'populus-data/attestations\|populus-data/\.github/workflows' ARCHITECTURE.md`
  returns nothing; `:234-236`, `:347`, `:356`, `:773`, `:778`, `:829` amended;
  `:724`/`:778`'s correct mentions untouched; `REVIEW-RESPONSE.md`,
  `rollback.md:121` and `STATUS.md:79` updated.
- **R19** done: the drift test passes.

Plus: every required mutant killed.
