"""The attestation provider (RUN P3-3a, R5-R11).

Every pin is tested separately, and each negative asserts **which** check fired
rather than just ``ok is False`` — a test that only asserts the end state would
survive a mutation that removed a different pin (`mutation-tests-pin-properties`).

All fixtures run offline: `tests/conftest.py` installs an autouse socket guard,
which is exactly why the bundle fetcher and the trust configuration are injected
rather than constructed.
"""

from __future__ import annotations

import hashlib
import json

import pytest

from populus.publish.attestation import (
    ATTESTATION_REPO,
    P2_OIDC_ISSUER,
    P2_PUBLISH_IDENTITY,
    P2_RECORD_SIGN_IDENTITY,
    REJECTED,
    SLSA_PREDICATE_TYPE,
    UNAVAILABLE,
    VERIFIED,
    AttestationResult,
    FetchUnavailable,
    SigstoreAttestation,
    StagingNoop,
    resolve_identity,
)

SUBJECT = b'{"build_id": "20260803.1"}'
DIGEST = hashlib.sha256(SUBJECT).hexdigest()


def bundle(
    *,
    digest: str = DIGEST,
    identity: str = P2_PUBLISH_IDENTITY,
    issuer: str = P2_OIDC_ISSUER,
    predicate: str = SLSA_PREDICATE_TYPE,
) -> dict:
    return {
        "predicateType": predicate,
        "certificate_identity": identity,
        "certificate_oidc_issuer": issuer,
        "statement": {
            "predicateType": predicate,
            "subject": [{"name": "manifest.json", "digest": {"sha256": digest}}],
        },
    }


class FakeFetcher:
    def __init__(self, bundles: list[dict] | None = None, raises: Exception | None = None):
        self._bundles = bundles or []
        self._raises = raises
        self.calls = 0

    def fetch_bundles(self, digest_hex: str) -> list[dict]:
        self.calls += 1
        if self._raises is not None:
            raise self._raises
        return list(self._bundles)


class FakeTrust:
    """A committed trust configuration stand-in — no TUF refresh, no sockets."""

    def __init__(self, ok: bool = True):
        self._ok = ok

    def verify_bundle(self, bundle: dict) -> bool:
        return self._ok


def provider(fetcher=None, trust=None, **kw) -> SigstoreAttestation:
    return SigstoreAttestation(
        fetcher=fetcher or FakeFetcher([bundle()]),
        trust_config=trust or FakeTrust(),
        **kw,
    )


# --- the happy path ---------------------------------------------------------


def test_a_valid_bundle_verifies() -> None:
    result = provider().verify("manifest.json", SUBJECT)
    assert result.ok is True
    assert result.outcome == VERIFIED
    assert P2_PUBLISH_IDENTITY in result.detail


# --- each pin, separately ---------------------------------------------------


def test_wrong_certificate_identity_is_rejected_and_named() -> None:
    p = provider(FakeFetcher([bundle(identity="https://github.com/evil/repo/x.yml@main")]))
    result = p.verify("manifest.json", SUBJECT)
    assert result.ok is False and result.outcome == REJECTED
    assert "certificate identity mismatch" in result.detail


def test_wrong_oidc_issuer_is_rejected_and_named() -> None:
    p = provider(FakeFetcher([bundle(issuer="https://accounts.example.com")]))
    result = p.verify("manifest.json", SUBJECT)
    assert result.ok is False and result.outcome == REJECTED
    assert "OIDC issuer mismatch" in result.detail


def test_subject_digest_mismatch_is_rejected_and_named() -> None:
    p = provider(FakeFetcher([bundle(digest="00" * 32)]))
    result = p.verify("manifest.json", SUBJECT)
    assert result.ok is False and result.outcome == REJECTED
    assert "subject digest mismatch" in result.detail


def test_wrong_predicate_type_is_rejected_and_named() -> None:
    p = provider(FakeFetcher([bundle(predicate="https://in-toto.io/attestation/link")]))
    result = p.verify("manifest.json", SUBJECT)
    assert result.ok is False and result.outcome == REJECTED
    assert "predicate mismatch" in result.detail


def test_bad_signature_against_the_trust_config_is_rejected_and_named() -> None:
    """The trust configuration is the root of trust — §14 says so explicitly.
    Without this test an implementation could skip it and pass everything else."""
    p = provider(trust=FakeTrust(ok=False))
    result = p.verify("manifest.json", SUBJECT)
    assert result.ok is False and result.outcome == REJECTED
    assert "trust configuration" in result.detail


def test_no_bundle_found_is_rejected_never_silently_true() -> None:
    p = provider(FakeFetcher([]))
    result = p.verify("manifest.json", SUBJECT)
    assert result.ok is False and result.outcome == REJECTED
    assert "no attestation found" in result.detail


# --- R9: "rejected" and "could not ask" are different answers ---------------


def test_a_lookup_failure_is_unavailable_not_rejected() -> None:
    """The Verify step's lookups are rate-limited (60/hour unauthenticated,
    shared per runner IP). If a quota error collapsed into `rejected`, a green
    pointer commit would mean "couldn't ask" and a red one would read as
    tampering. Both are wrong."""
    p = provider(FakeFetcher(raises=FetchUnavailable("HTTP 429 rate limit exceeded")))
    result = p.verify("manifest.json", SUBJECT)
    assert result.ok is False
    assert result.outcome == UNAVAILABLE
    assert result.unavailable is True
    assert "unavailable" in result.detail


def test_an_unavailable_lookup_is_not_cached() -> None:
    """Caching a transient 429 would turn it into a permanent 'unverified'."""
    fetcher = FakeFetcher(raises=FetchUnavailable("boom"))
    p = provider(fetcher)
    p.verify("manifest.json", SUBJECT)
    p.verify("manifest.json", SUBJECT)
    assert fetcher.calls == 2


# --- R7: identity resolves per subject kind --------------------------------


def test_unknown_subject_is_refused_with_no_default_identity() -> None:
    result = provider().verify("mystery.txt", SUBJECT)
    assert result.ok is False and result.outcome == REJECTED
    assert "no certificate identity is mapped" in result.detail


def test_a_deployment_subject_requires_the_record_signer_identity() -> None:
    """The publish workflow's signature must not satisfy a deployment generation.
    With a single identity per provider instance this would silently pass."""
    assert resolve_identity("deployments/1.json") == P2_RECORD_SIGN_IDENTITY
    p = provider(FakeFetcher([bundle(identity=P2_PUBLISH_IDENTITY)]))
    result = p.verify("deployments/1.json", SUBJECT)
    assert result.ok is False and result.outcome == REJECTED
    assert "certificate identity mismatch" in result.detail


def test_release_assets_use_the_publish_identity() -> None:
    assert resolve_identity("releases/data-20260803.1/congress.db") == P2_PUBLISH_IDENTITY


# --- R5 / R19: the lookup repository ---------------------------------------


def test_identities_and_lookup_derive_from_one_repository() -> None:
    """R19 drift guard: `P2_RECORD_SIGN_IDENTITY` is not exercised until P3-3b,
    so without this it could rot unnoticed."""
    assert ATTESTATION_REPO == "johnbaekk-spec/populus"
    for identity in (P2_PUBLISH_IDENTITY, P2_RECORD_SIGN_IDENTITY):
        assert f"github.com/{ATTESTATION_REPO}/" in identity
    assert "populus-data" not in P2_PUBLISH_IDENTITY
    assert "populus-data" not in P2_RECORD_SIGN_IDENTITY


# --- R11: cache isolation ---------------------------------------------------


def test_a_cache_hit_never_crosses_a_different_identity_pin() -> None:
    fetcher = FakeFetcher([bundle()])
    p = provider(fetcher)
    assert p.verify("manifest.json", SUBJECT).ok is True
    assert fetcher.calls == 1
    p.verify("manifest.json", SUBJECT)
    assert fetcher.calls == 1, "second identical call should hit the cache"

    other = SigstoreAttestation(
        fetcher=fetcher,
        trust_config=FakeTrust(),
        identities={"manifest.json": "https://github.com/other/repo/w.yml@main"},
    )
    result = other.verify("manifest.json", SUBJECT)
    assert result.ok is False, "a different identity pin must not reuse the verdict"
    assert fetcher.calls == 2


# --- the no-op provider still exists and is honest -------------------------


def test_staging_noop_says_what_it_is() -> None:
    result = StagingNoop().verify("manifest.json", SUBJECT)
    assert result.ok is True
    assert "staging-noop" in result.detail and "ACL-bounded" in result.detail


def test_attestation_result_defaults_to_verified_for_existing_callers() -> None:
    """`outcome` is additive: every pre-existing two-arg construction still works."""
    assert AttestationResult(ok=True, detail="x").outcome == VERIFIED


# --- mutation-driven additions ---------------------------------------------
# The first mutation run killed only 9/14. Two survivors were real test gaps:
# the cache test used a SECOND provider instance (whose cache is empty, so the
# key never mattered), and nothing exercised a FAILING attest(). Both below.


def test_the_cache_key_includes_the_identity_within_one_instance() -> None:
    """Kills M9. The cache is per-instance, so comparing two instances proved
    nothing about the key. Two subjects with the SAME bytes but DIFFERENT
    required identities must not share a verdict inside one provider."""
    # `manifest.json` -> publish identity; `deployments/1.json` -> record-sign.
    fetcher = FakeFetcher([bundle(identity=P2_PUBLISH_IDENTITY)])
    p = provider(fetcher)

    first = p.verify("manifest.json", SUBJECT)
    assert first.ok is True

    # Same bytes, same digest — but this subject requires a different identity.
    # Keyed by digest alone, this would wrongly reuse the verdict above.
    second = p.verify("deployments/1.json", SUBJECT)
    assert second.ok is False, "a different identity pin must not reuse the verdict"
    assert "certificate identity mismatch" in second.detail


def test_a_failing_attest_stops_the_publish() -> None:
    """Kills M10. All three attest() sites previously discarded their result;
    nothing in the suite proved the new raise is reachable."""
    from populus.publish.build import PublishError, _require_attested

    _require_attested(AttestationResult(ok=True, detail="fine"))  # no raise

    with pytest.raises(PublishError) as excinfo:
        _require_attested(
            AttestationResult(ok=False, detail="signature did not verify", outcome=REJECTED)
        )
    assert "attestation failed" in str(excinfo.value)
    assert "signature did not verify" in str(excinfo.value)
