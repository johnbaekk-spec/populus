"""The attestation seam (§5.5 trust model; RUN 5 brief).

P1 (private staging) carries no attestations — GitHub artifact attestations
are unavailable to private Free-plan repositories, and none are needed inside
the repo-ACL trust boundary. Every §5.5 call site still goes through this
seam so the P2 sigstore implementation drops in without touching callers.

P2 implementation notes (verified end to end in §5.5):

- Verify bundles with ``sigstore-python`` against the Sigstore trusted root
  shipped with the client (refreshed via Sigstore's TUF workflow).
- Required certificate identities, pinned per subject kind:
  pointer generations and manifests → :data:`P2_PUBLISH_IDENTITY`;
  deployment generations → :data:`P2_RECORD_SIGN_IDENTITY`.
- Required OIDC issuer for both: :data:`P2_OIDC_ISSUER`.
- Candidates come from the public attestation API
  (``GET /repos/<org>/populus-data/attestations/sha256:<hex>``), filtered to
  the SLSA provenance predicate whose subject digest matches; verified
  results are cached keyed by subject digest.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol

P2_PUBLISH_IDENTITY = (
    "https://github.com/johnbaekk-spec/populus-data/"
    ".github/workflows/publish.yml@refs/heads/main"
)
P2_RECORD_SIGN_IDENTITY = (
    "https://github.com/johnbaekk-spec/populus-data/"
    ".github/workflows/record-sign.yml@refs/heads/main"
)
P2_OIDC_ISSUER = "https://token.actions.githubusercontent.com"


@dataclass(frozen=True)
class AttestationResult:
    """Outcome of one attest/verify call at a §5.5 site."""

    ok: bool
    detail: str


class AttestationProvider(Protocol):
    """The seam every §5.5 call site uses.

    ``subject_name`` names the artifact kind being attested/verified (e.g.
    ``"latest.json"``, ``"manifest.json"``, an asset name); ``data`` is the
    exact bytes that are the attestation subject.
    """

    def attest(self, subject_name: str, data: bytes) -> AttestationResult: ...

    def verify(self, subject_name: str, data: bytes) -> AttestationResult: ...


class StagingNoop:
    """P1 provider: the trust boundary is the private repo ACL, stated as such.

    Both operations succeed and say so honestly — nothing is signed, nothing
    is cryptographically verified. The P2 sigstore provider replaces this
    class behind the same protocol.
    """

    def attest(self, subject_name: str, data: bytes) -> AttestationResult:
        return AttestationResult(
            ok=True, detail=f"staging-noop attest {subject_name} (P1, ACL-bounded)"
        )

    def verify(self, subject_name: str, data: bytes) -> AttestationResult:
        return AttestationResult(
            ok=True, detail=f"staging-noop verify {subject_name} (P1, ACL-bounded)"
        )
