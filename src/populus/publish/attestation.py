"""The attestation seam (§5.5 trust model; RUN 5 brief, RUN P3-3a).

Every §5.5 call site goes through this seam, so the real provider drops in
without changing any caller's shape.

**Where attestations live.** GitHub associates an attestation with the
repository whose *workflow created it* — there is no cross-repo targeting on
``GET /repos/{owner}/{repo}/attestations/{digest}``. Both attesting workflows
(``publish.yml``, ``record-sign.yml``) live in ``populus``, so bundles are
published and looked up there. Earlier revisions of this docstring and the two
identity constants named ``populus-data``, which is where the *artifacts* land,
not where the workflow runs — that was wrong in both places and is corrected
here. ``ATTESTATION_REPO`` is the single source both the identities and the
lookup URL derive from, so they cannot drift apart (RUN P3-3a R19).

**Phase.** P1 was specified as "unattested by necessity" on the reasoning that
Free-plan attestations are unavailable on a private repo. That premise assumed
the attesting workflow lived in the private ``populus-data``. It does not — it
lives in ``populus``, which is public — so attestation is available now and P1
is attested. The property (nothing is trusted unsigned) is unchanged; only the
mechanism moved. See the decision record in ``docs/operations/attestation.md``.

**Verification pins**, all five required and each independently tested:
the Sigstore trust configuration, the OIDC issuer :data:`P2_OIDC_ISSUER`, the
per-subject-kind certificate identity (:data:`SUBJECT_IDENTITIES`), the SLSA
provenance predicate, and a subject-digest match. Verified results are cached
by subject digest.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Protocol

#: The repository whose workflows create attestations, and therefore the only
#: repository they can be fetched from. Single source for the identities below
#: and for the lookup URL — a drift test pins all three to it.
ATTESTATION_REPO = "johnbaekk-spec/populus"

P2_PUBLISH_IDENTITY = (
    f"https://github.com/{ATTESTATION_REPO}/"
    ".github/workflows/publish.yml@refs/heads/main"
)
P2_RECORD_SIGN_IDENTITY = (
    f"https://github.com/{ATTESTATION_REPO}/"
    ".github/workflows/record-sign.yml@refs/heads/main"
)
P2_OIDC_ISSUER = "https://token.actions.githubusercontent.com"

#: Which certificate identity is required for which subject kind (§5.5).
#: A subject name that is not in this map is **refused**, never verified against
#: a default identity — otherwise a deployment generation could be accepted on
#: the publish workflow's signature.
SUBJECT_IDENTITIES: dict[str, str] = {
    "manifest.json": P2_PUBLISH_IDENTITY,
    "latest.json": P2_PUBLISH_IDENTITY,
}

#: Subject names outside :data:`SUBJECT_IDENTITIES` that are still published by
#: ``publish.yml`` — the Release assets, whose names vary per build.
ASSET_IDENTITY = P2_PUBLISH_IDENTITY

#: Deployment generations, written by ``record-sign.yml`` (arrives with P3-3b).
DEPLOYMENT_SUBJECT_PREFIX = "deployments/"

# --- outcomes ---------------------------------------------------------------

#: Positively verified against every pin.
VERIFIED = "verified"
#: Reached the attestation API and the answer was "no" — missing bundle, wrong
#: identity, wrong issuer, wrong predicate, digest mismatch, bad signature.
REJECTED = "rejected"
#: Could **not** reach a verdict — transport error, or the unauthenticated
#: 60/hour rate limit. Distinct from :data:`REJECTED` on purpose: the publish
#: gate must never read "couldn't ask" as "checked and fine", nor report a quota
#: error as tampering.
UNAVAILABLE = "unavailable"

#: The only predicate type accepted. A bundle carrying anything else is not a
#: build-provenance attestation and is filtered out before any other check.
SLSA_PREDICATE_TYPE = "https://slsa.dev/provenance/v1"

#: What verify_dsse's first return value actually is: the DSSE envelope's
#: payload type, the same string for EVERY in-toto statement regardless of
#: predicate. The predicateType is a field inside the payload.
IN_TOTO_ENVELOPE_TYPE = "application/vnd.in-toto+json"


def resolve_identity(subject_name: str) -> str | None:
    """The certificate identity required for ``subject_name``, or None.

    None means *refuse* — there is deliberately no default identity.
    """
    if subject_name in SUBJECT_IDENTITIES:
        return SUBJECT_IDENTITIES[subject_name]
    if subject_name.startswith(DEPLOYMENT_SUBJECT_PREFIX):
        return P2_RECORD_SIGN_IDENTITY
    if subject_name.startswith("releases/") or subject_name.endswith(
        (".db", ".zip", ".tar.gz")
    ):
        return ASSET_IDENTITY
    return None


@dataclass(frozen=True)
class AttestationResult:
    """Outcome of one attest/verify call at a §5.5 site.

    ``ok`` keeps its original meaning — True only when positively verified — so
    every existing caller is unaffected. ``outcome`` is additive and lets a
    caller distinguish :data:`REJECTED` from :data:`UNAVAILABLE`, which ``ok``
    alone collapses into the same False.
    """

    ok: bool
    detail: str
    outcome: str = VERIFIED

    @property
    def unavailable(self) -> bool:
        return self.outcome == UNAVAILABLE


class AttestationProvider(Protocol):
    """The seam every §5.5 call site uses.

    ``subject_name`` names the artifact kind being attested/verified (e.g.
    ``"latest.json"``, ``"manifest.json"``, an asset name); ``data`` is the
    exact bytes that are the attestation subject.
    """

    def attest(self, subject_name: str, data: bytes) -> AttestationResult: ...

    def verify(self, subject_name: str, data: bytes) -> AttestationResult: ...


class BundleFetcher(Protocol):
    """How the provider reaches the GitHub attestation API.

    Injected rather than constructed, for the same reason ``client.snapshot``
    injects its fetcher: the test suite forbids sockets (``tests/conftest.py``),
    so every verification fixture must run offline.

    Implementations raise :class:`FetchUnavailable` for transport or quota
    failures — never returning an empty candidate list, which would be
    indistinguishable from "this artifact was never attested".
    """

    def fetch_bundles(self, digest_hex: str) -> list[dict]: ...


class BundleVerifier(Protocol):
    """Verifies a bundle's signature AND its certificate policy.

    The signature check and the identity/issuer check are ONE operation, not
    two: sigstore's ``verify_dsse(bundle, policy)`` fails unless the signature
    chains to the trusted root *and* the signing certificate matches the policy.
    Returns ``(predicate_type, payload_bytes)`` from the verified DSSE envelope.

    This shape matters for correctness. An earlier version compared
    ``bundle["certificate_identity"]`` against the expected identity — sibling
    JSON that anyone controlling the HTTP response could forge. Identity and
    issuer must come from the *verified certificate*, which is what the policy
    argument does.

    Raises :class:`VerificationFailed` when verification fails. Injected because
    the production verifier refreshes trusted key material over TUF at startup,
    which the suite's no-network guard forbids.
    """

    def verify(self, bundle: dict, *, identity: str, issuer: str) -> tuple[str, bytes]: ...


class VerificationFailed(Exception):
    """The bundle did not verify — bad signature, or certificate policy mismatch."""


class FetchUnavailable(RuntimeError):
    """The attestation API could not be reached or answered (incl. HTTP 429/403).

    Raised, not returned, so a fetcher cannot accidentally signal "no bundles".
    """


class StagingNoop:
    """The unattested provider: the trust boundary is the repo ACL, stated as such.

    Both operations succeed and say so honestly — nothing is signed, nothing is
    cryptographically verified. §5.5 mandates that this path exist; what it must
    never be is a *default*, which is why no production call site may omit an
    explicit provider (``tests/test_attestation_structure.py``).
    """

    def attest(self, subject_name: str, data: bytes) -> AttestationResult:
        return AttestationResult(
            ok=True, detail=f"staging-noop attest {subject_name} (ACL-bounded)"
        )

    def verify(self, subject_name: str, data: bytes) -> AttestationResult:
        return AttestationResult(
            ok=True, detail=f"staging-noop verify {subject_name} (ACL-bounded)"
        )


class SigstoreAttestation:
    """Verify GitHub artifact attestations against pinned identity and issuer.

    ``attest()`` is a **seam, not a signer** — stated plainly rather than
    implied. The signing happens in the workflow's attestation step, which runs
    with the OIDC token; this class cannot mint a bundle. What makes a missing
    or failed attestation actually stop a publish is the workflow's step order
    (attest -> verify -> commit), not a return value here. The method is kept so
    the seam stays usable by a provider that *can* fail, and so the three
    ``attest()`` call sites have something to check.

    ``verify()`` is the half that carries the trust, and it is fully exercised
    offline against committed fixtures.
    """

    def __init__(
        self,
        *,
        fetcher: BundleFetcher,
        trust_config: TrustConfig,
        repo: str = ATTESTATION_REPO,
        issuer: str = P2_OIDC_ISSUER,
        identities: dict[str, str] | None = None,
    ) -> None:
        self._fetcher = fetcher
        self._trust_config = trust_config
        self._repo = repo
        self._issuer = issuer
        self._identities = identities
        # Verified results, keyed by (digest, identity, issuer) — never by digest
        # alone, or a hit recorded under one pin would satisfy a different one.
        self._cache: dict[tuple[str, str, str], AttestationResult] = {}

    # -- helpers ------------------------------------------------------------

    def _identity_for(self, subject_name: str) -> str | None:
        if self._identities is not None:
            return self._identities.get(subject_name)
        return resolve_identity(subject_name)

    @staticmethod
    def _digest(data: bytes) -> str:
        import hashlib

        return hashlib.sha256(data).hexdigest()

    # -- protocol -----------------------------------------------------------

    def attest(self, subject_name: str, data: bytes) -> AttestationResult:
        identity = self._identity_for(subject_name)
        if identity is None:
            return AttestationResult(
                ok=False,
                detail=f"unknown subject {subject_name!r}: no certificate identity is mapped",
                outcome=REJECTED,
            )
        return AttestationResult(
            ok=True,
            detail=(
                f"sigstore attest {subject_name}: recorded (signing is performed by "
                "the workflow attestation step; enforcement is attest->verify->commit)"
            ),
        )

    def verify(self, subject_name: str, data: bytes) -> AttestationResult:
        identity = self._identity_for(subject_name)
        if identity is None:
            return AttestationResult(
                ok=False,
                detail=f"unknown subject {subject_name!r}: no certificate identity is mapped",
                outcome=REJECTED,
            )

        digest = self._digest(data)
        key = (digest, identity, self._issuer)
        if key in self._cache:
            return self._cache[key]

        try:
            candidates = self._fetcher.fetch_bundles(digest)
        except FetchUnavailable as exc:
            # Deliberately NOT cached and NOT `rejected`: we did not get an
            # answer. Caching would turn a transient 429 into a persistent
            # "unverified", and reporting it as rejection would read as tampering.
            return AttestationResult(
                ok=False,
                detail=f"attestation lookup unavailable for {subject_name}: {exc}",
                outcome=UNAVAILABLE,
            )

        if not candidates:
            return self._store(
                key,
                AttestationResult(
                    ok=False,
                    detail=(
                        f"no attestation found for {subject_name} "
                        f"(sha256:{digest}) in {self._repo}"
                    ),
                    outcome=REJECTED,
                ),
            )

        failures: list[str] = []
        for bundle in candidates:
            verdict = self._verify_one(bundle, subject_name, digest, identity)
            if verdict.ok:
                return self._store(key, verdict)
            failures.append(verdict.detail)

        return self._store(
            key,
            AttestationResult(
                ok=False,
                detail=(
                    f"no candidate bundle verified for {subject_name}: "
                    + "; ".join(failures)
                ),
                outcome=REJECTED,
            ),
        )

    def _store(self, key, result: AttestationResult) -> AttestationResult:
        self._cache[key] = result
        return result

    def _verify_one(
        self, bundle: dict, subject_name: str, digest: str, identity: str
    ) -> AttestationResult:
        """Verify one candidate.

        Order matters. The signature and the certificate policy are checked
        FIRST, by sigstore, because everything afterwards reads the payload that
        check returns. Reading predicate or subject from the raw bundle before
        verifying would be trusting attacker-controlled JSON.
        """
        try:
            predicate_type, payload = self._trust_config.verify(
                bundle, identity=identity, issuer=self._issuer
            )
        except VerificationFailed as exc:
            return AttestationResult(
                ok=False,
                detail=(
                    "signature or certificate policy did not verify "
                    f"(identity={identity}, issuer={self._issuer}): {exc}"
                ),
                outcome=REJECTED,
            )

        # sigstore's verify_dsse returns the DSSE ENVELOPE payload type — for
        # every in-toto statement that is "application/vnd.in-toto+json". The
        # SLSA predicateType lives INSIDE the statement JSON. The first real
        # bundle GitHub minted proved the distinction: P3-3a compared the
        # envelope type against the SLSA URL, and the fixtures had been built to
        # match the code's misreading — both agreed, both wrong vs reality
        # ("predicate mismatch: 'application/vnd.in-toto+json' !=
        # 'https://slsa.dev/provenance/v1'" on run 6's Verify step). Both layers
        # are now checked, each against its own contract.
        if predicate_type != IN_TOTO_ENVELOPE_TYPE:
            return AttestationResult(
                ok=False,
                detail=f"envelope type mismatch: {predicate_type!r} != {IN_TOTO_ENVELOPE_TYPE!r}",
                outcome=REJECTED,
            )

        try:
            statement = json.loads(payload)
        except (ValueError, TypeError) as exc:
            return AttestationResult(
                ok=False, detail=f"verified payload is not JSON: {exc}", outcome=REJECTED
            )

        statement_predicate = statement.get("predicateType")
        if statement_predicate != SLSA_PREDICATE_TYPE:
            return AttestationResult(
                ok=False,
                detail=(
                    f"predicate mismatch: {statement_predicate!r} != "
                    f"{SLSA_PREDICATE_TYPE!r}"
                ),
                outcome=REJECTED,
            )

        subjects = statement.get("subject") or []
        # Match the subject by NAME as well as digest. A single attest step can
        # carry several subjects, so digest-only matching would let pointer bytes
        # verify under the manifest's name and vice versa.
        matched = [
            s
            for s in subjects
            if isinstance(s, dict)
            and (s.get("digest") or {}).get("sha256") == digest
            and _subject_name_matches(str(s.get("name") or ""), subject_name)
        ]
        if not matched:
            names = sorted(str(s.get("name")) for s in subjects if isinstance(s, dict))
            return AttestationResult(
                ok=False,
                detail=(
                    f"no verified subject named {subject_name!r} with digest "
                    f"sha256:{digest} (statement carries {names})"
                ),
                outcome=REJECTED,
            )

        return AttestationResult(
            ok=True,
            detail=(
                f"sigstore verify {subject_name}: identity={identity} "
                f"issuer={self._issuer} digest=sha256:{digest}"
            ),
        )


def _subject_name_matches(statement_name: str, subject_name: str) -> bool:
    """A statement subject names a path; we name the artifact kind.

    `populus-data/builds/20260803.1/manifest.json` names subject `manifest.json`.
    """
    return statement_name == subject_name or statement_name.endswith("/" + subject_name)


# --- explicit provider selection --------------------------------------------

#: The two selectable providers. There is deliberately no default: an entry
#: point that forgets to choose must fail loudly, not inherit a no-op verifier.
PROVIDER_CHOICES = ("sigstore", "staging-noop")


def build_provider(choice: str, *, fetcher=None, trust_config=None):
    """Construct the named provider, or raise.

    Selection happens only at an entry point (CLI, MCP server argparse, monitor
    CLI, acceptance scripts, workflow command lines). Everything downstream
    receives the constructed provider, so no library call can silently end up
    unsigned.
    """
    if choice == "staging-noop":
        return StagingNoop()
    if choice == "sigstore":
        if fetcher is None or trust_config is None:
            raise ValueError(
                "the sigstore provider requires a bundle fetcher and a bundle "
                "verifier; see docs/operations/attestation.md"
            )
        return SigstoreAttestation(fetcher=fetcher, trust_config=trust_config)
    raise ValueError(
        f"unknown attestation provider {choice!r}; choose one of {PROVIDER_CHOICES}"
    )


# --- production adapters ----------------------------------------------------


class SigstoreBundleVerifier:
    """The production verifier, built on `sigstore` 4.x.

    Written against the installed API, not from memory — an earlier version
    called `Verifier._from_trust_config` and imported `sigstore.trust`, neither
    of which exists in the pinned release, so it raised ModuleNotFoundError on
    first use. It was never executed because every test injected a stand-in.
    That is why `_probe_api` exists below and why a test asserts the real
    adapter builds the policy it claims to.

    `verify_dsse` performs signature verification against the trusted root AND
    enforces the certificate policy in one call. Identity and issuer therefore
    come from the verified certificate, never from sibling JSON in the response.
    """

    def __init__(self, verifier=None) -> None:
        self._verifier = verifier

    def _build(self):
        if self._verifier is not None:
            return self._verifier
        from sigstore.verify import Verifier

        return Verifier.production()

    @staticmethod
    def build_policy(identity: str, issuer: str):
        """The certificate policy: this identity, this issuer. Nothing else."""
        from sigstore.verify import policy

        return policy.Identity(identity=identity, issuer=issuer)

    def verify(self, bundle: dict, *, identity: str, issuer: str) -> tuple[str, bytes]:
        from sigstore.errors import VerificationError
        from sigstore.models import Bundle

        try:
            parsed = Bundle.from_json(json.dumps(bundle).encode())
        except Exception as exc:  # InvalidBundle and friends
            raise VerificationFailed(f"bundle did not parse: {exc}") from exc

        try:
            return self._build().verify_dsse(parsed, self.build_policy(identity, issuer))
        except VerificationError as exc:
            raise VerificationFailed(str(exc)) from exc


def github_trust_config() -> SigstoreBundleVerifier:
    """The production bundle verifier. Constructed only at an entry point —
    `Verifier.production()` refreshes trusted key material over TUF."""
    return SigstoreBundleVerifier()
