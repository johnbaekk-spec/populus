# Attestation — what is signed, by whom, and how to check it

RUN P3-3a. Companion to §5.5 (trust model) and §14 (supply chain).

## What this replaced

Until this run, `AttestationProvider` had exactly one implementation:
`StagingNoop`, which answers "verified" to every question without looking at
anything. It was written honestly as a temporary stand-in and clearly labelled —
and it was never replaced. Worse, it was reachable **by omission**: six functions
defaulted to it, so eleven production call sites inherited it silently, including
the shipped MCP server and `populus verify`, the command the publish workflow runs
to decide whether to commit a pointer.

So the system reported "verified" for every build it has ever published. Nothing
was tampered with; the check simply was not being made.

## Decision record — attesting during P1

**§5.5 previously specified P1 as "unattested by necessity"** (`:347`, `:356`,
`:829`), on the reasoning that GitHub artifact attestations are unavailable to
private repositories on the Free plan.

**That premise was false.** It assumed the attesting workflow lived in the
private `populus-data`. It does not — `publish.yml` and `record-sign.yml` both
live in `populus`, which is **public**. GitHub associates an attestation with the
repository whose *workflow created it*, so availability follows `populus`'s
visibility, never `populus-data`'s.

**The property is unchanged: nothing is trusted unsigned.** Only the mechanism
moved — from "we cannot sign yet, so the ACL is the boundary" to "we sign, and
the signature is the boundary." Recorded here rather than silently overturned,
per the project's rule on reversing reviewed decisions.

Two consequences follow, and both are honest limits rather than oversights:

- **Third-party verification is still not possible.** An outsider must fetch the
  subject bytes, and those live in `populus-data`, which stays private until the
  §15.3 counsel gate. Owner-side verification — publisher, monitor, MCP client —
  works today.
- **`populus-data`'s eventual flip does not change where bundles live.** They
  remain in `populus`.

## What is signed

The publish workflow attests two paths directly, via SHA-pinned
`actions/attest-build-provenance` — `populus-data/latest.json` and
`populus-data/builds/*/manifest.json`:

| Subject | Required certificate identity |
|---|---|
| `manifest.json` | `publish.yml@refs/heads/main` |
| each `latest.json` generation | `publish.yml@refs/heads/main` |
| every Release asset | **not attested directly** — covered transitively: the attested `manifest.json` carries each asset's sha256 and byte size, and `run_verify` checks assets against it |
| deployment generations (arrives with P3-3b) | `record-sign.yml@refs/heads/main` |

Identity is resolved **per subject kind**. A subject name that maps to nothing is
refused — there is deliberately no default identity, so a deployment generation
can never be accepted on the publish workflow's signature.

### Deployment generations are attested under an explicit subject name

A deployment generation is written to
`populus-data/builds/<build_id>/deployments/<gen>.json` and **must be attested
under the subject name `deployments/<gen>.json`** — the directory component is
part of the name, not decoration. The signer therefore passes
`subject-name: deployments/<gen>.json` together with `subject-digest` to
`actions/attest-build-provenance`, in place of `subject-path`.

This is a pinned convention rather than a style choice, because the naive
alternative fails **both** of this module's checks at once. With `subject-path`
the action names the subject by its **basename**, so the generation would be
attested as `<gen>.json`, and:

- `resolve_identity` (`src/populus/publish/attestation.py`) returns `None` —
  *refuse* — for any name that is neither in `SUBJECT_IDENTITIES` nor prefixed
  with `DEPLOYMENT_SUBJECT_PREFIX` (`deployments/`). `resolve_identity("3.json")`
  is a refusal, and there is no default identity to fall back to.
- `_subject_name_matches` requires the in-bundle statement name to **equal** the
  queried name or end with `"/" + name`. A caller asking for
  `deployments/3.json` matches no statement named `3.json`.

So a basename-attested generation is unverifiable from either direction, and the
failure looks like a missing bundle rather than a naming mistake. The explicit
`subject-name` satisfies the prefix arm and the exact-match arm together.

The contrast with `manifest.json` is deliberate, not an inconsistency:
`publish.yml` attests it *by path* (`populus-data/builds/*/manifest.json`), the
action reduces that to the basename, and `SUBJECT_IDENTITIES` maps the bare
`"manifest.json"` to match. The two subject kinds use opposite mechanisms
because they are named by opposite means. A round-trip attest → verify fixture
pins the generation convention, and a generation attested by basename must be
**refused** by that fixture.

`ATTESTATION_REPO` is the single source both identities and the lookup URL derive
from; a drift test pins all three to it.

## How enforcement actually works

The workflow's step order **is** the enforcement:

```
Build → Publish → Attest → Verify → Commit manifest and pointer
```

`populus verify --attestation=sigstore` exits non-zero on a failed verdict, and
the Commit step has no `if: always()`. So a missing, failed, or deleted attest
step fails Verify and **the pointer is never committed**.

Stated plainly: for the Sigstore provider, `attest()` is a **seam, not a signer**
— the Actions step does the signing, and the provider cannot mint a bundle. The
three `attest()` call sites do now raise on failure, which matters for any future
provider that *can* fail, but it is not what gates this pipeline.

**This gates the workflow path only.** See "Limits" below.

## Choosing a provider

There is no default. Every entry point requires an explicit choice:

```bash
populus build   --attestation=sigstore --db populus.db --data-repo ../populus-data
populus publish --attestation=sigstore --data-repo ../populus-data
populus verify  --attestation=sigstore --data-repo ../populus-data
uv run populus-monitor --attestation=sigstore --state-dir ... --repo ...
populus-mcp --attestation=sigstore --data-repo ../populus-data
```

`--attestation=staging-noop` selects the unsigned path. It still exists — §5.5
mandates an unattested path, and the hermetic acceptance scripts legitimately use
it — but it can only be reached by typing it.

**Exempt, deliberately:** `populus-mcp --db <path>` reads a local database
directly and never constructs a verifying client, so it needs no provider. The
argparse enforces the requirement only when resolving a *published* snapshot.

## Preflight

```bash
populus preflight-attestation --data-repo ../populus-data
```

A positive gate: it resolves the published pointer and manifest, verifies both,
and exits non-zero **naming the failed check**. Run it before arming anything.

## "Rejected" and "could not check" are different answers

Unauthenticated attestation lookups are capped at **60/hour per client address**.
With a single boolean, a rate-limit error would be indistinguishable from
tampering — in the step that gates the pointer commit. That would mean a green
commit could silently mean "couldn't ask."

So results carry an outcome:

- `verified` — every pin matched.
- `rejected` — we got an answer and it was no (missing bundle, wrong identity,
  wrong issuer, wrong predicate, digest mismatch, bad signature).
- `unavailable` — we could not get an answer. **Never cached**, so a transient
  429 cannot harden into a permanent "unverified".

The Verify step carries `GH_TOKEN: ${{ github.token }}` and the job holds
`attestations: write`, so CI lookups are authenticated. If you see `unavailable`
locally, export `GH_TOKEN` — it is a quota problem, not a security event.

## Why the structural test exists

`tests/test_attestation_structure.py` walks signatures and the AST and fails if
**any** production call site omits `attestation`.

It exists because the defect is an *omission*, and three consecutive review
rounds tried to enumerate the affected sites by grepping for `or StagingNoop()`.
A missing argument has no string to find, so all three enumerations were wrong —
each in a different way, and two of the six omission-capable parameters were
named by none of them. Thirty lines of AST produced the complete set immediately.

Test call sites are exempt by design: they are hermetic (the suite forbids
network), they legitimately want the no-op, and they carry no trust posture.

## Limits, stated

1. **The workflow is not armed.** `publish.yml` is guarded by
   `POPULUS_PUBLISH_ARMED`, which is unprovisioned, and today's publishes are run
   by hand. On the manual path the operator's `--attestation` choice is the only
   gate. Provisioning that variable is what makes the enforcement above real.
2. **A deliberate `--attestation=staging-noop` on a real build is still
   accepted.** Refusing it requires marking the artifact's phase, which is
   deferred to P3-3c (neither the manifest nor the pointer has a schema version
   that can carry the field, and both validators reject unknown keys, so live
   builds and the deployed monitor would break).
3. **Third-party verification** waits on the §15.3 counsel gate.
4. **Deployment-generation attestation** is unexercised until P3-3b's signer
   lands; a drift test keeps its identity constant honest in the meantime, and
   the subject-name convention above is the contract that signer must meet — it
   is pinned by the verifier today, whether or not anything writes a generation
   yet.

## Generation fields added by inventory v2 (PR 5, R12/LD12b)

A signed deployment generation now names `inventory_version: "2"`, the exact
canonical `controls` identity (path/kind/bytes/sha256 of the one `_headers`
control — bound by `inventory_digest` over the full canonical document, so no
separate unauthenticated "control digest" exists), and four control-effect
counts beside the served-file counts: `controls_total`,
`control_effects_verified` (the origin sweep) and `domain_controls_total`,
`domain_control_effects_verified` (the custom-domain leg). The signer refuses
to attest unless each of the four is exactly 1. `files_total` and
`domain_files_total` mean served entries only; artifact-level `file_count`
(files + controls) lives on the deploy side. Pre-v2 generations remain
immutable archival bytes and are never re-parsed by production code.
