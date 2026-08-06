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
    SigstoreBundleVerifier,
    VerificationFailed,
    StagingNoop,
    resolve_identity,
)

SUBJECT = b'{"build_id": "20260803.1"}'
DIGEST = hashlib.sha256(SUBJECT).hexdigest()


def bundle() -> dict:
    """An opaque bundle. Its CONTENTS are never read by our code — sigstore
    parses and verifies it, and we only inspect what verification returns.
    An earlier version read flat keys like `certificate_identity` off this dict,
    which no real Sigstore bundle has (`Bundle.from_json` rejects extra fields),
    so the sigstore path could never have succeeded on real input."""
    return {"mediaType": "application/vnd.dev.sigstore.bundle.v0.3+json"}


def statement(*, digest: str = DIGEST, name: str = "populus-data/manifest.json") -> bytes:
    """A verified in-toto statement payload, as `verify_dsse` returns it."""
    return json.dumps(
        {"_type": "https://in-toto.io/Statement/v1",
         "subject": [{"name": name, "digest": {"sha256": digest}}]}
    ).encode()


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


class FakeVerifier:
    """Models the REAL `BundleVerifier` contract: signature + certificate policy
    are one operation that either raises or returns (predicate_type, payload).

    `expect_identity`/`expect_issuer` stand in for what a real certificate
    policy enforces — so a test can prove our code passes the right policy,
    rather than comparing attacker-controlled JSON as the old design did."""

    def __init__(self, *, predicate=SLSA_PREDICATE_TYPE, payload=None,
                 fail=None, expect_identity=P2_PUBLISH_IDENTITY,
                 expect_issuer=P2_OIDC_ISSUER):
        self._predicate = predicate
        self._payload = payload if payload is not None else statement()
        self._fail = fail
        self._expect_identity = expect_identity
        self._expect_issuer = expect_issuer
        self.seen: list[tuple[str, str]] = []

    def verify(self, bundle: dict, *, identity: str, issuer: str):
        self.seen.append((identity, issuer))
        if self._fail:
            raise VerificationFailed(self._fail)
        if identity != self._expect_identity:
            raise VerificationFailed(
                f"certificate identity {identity!r} does not match the signing certificate"
            )
        if issuer != self._expect_issuer:
            raise VerificationFailed(f"OIDC issuer {issuer!r} does not match")
        return self._predicate, self._payload


def provider(fetcher=None, trust=None, **kw) -> SigstoreAttestation:
    return SigstoreAttestation(
        fetcher=fetcher or FakeFetcher([bundle()]),
        trust_config=trust or FakeVerifier(),
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
    """The signing certificate does not match the identity we require."""
    v = FakeVerifier(expect_identity="https://github.com/someone/else/w.yml@main")
    result = provider(trust=v).verify("manifest.json", SUBJECT)
    assert result.ok is False and result.outcome == REJECTED
    assert "certificate policy did not verify" in result.detail
    # and we asked for the RIGHT identity — the policy is ours, not the bundle's
    assert v.seen == [(P2_PUBLISH_IDENTITY, P2_OIDC_ISSUER)]


def test_wrong_oidc_issuer_is_rejected_and_named() -> None:
    v = FakeVerifier(expect_issuer="https://accounts.example.com")
    result = provider(trust=v).verify("manifest.json", SUBJECT)
    assert result.ok is False and result.outcome == REJECTED
    assert "certificate policy did not verify" in result.detail


def test_subject_digest_mismatch_is_rejected_and_named() -> None:
    """The bundle verified, but it attests different bytes."""
    result = provider(trust=FakeVerifier(payload=statement(digest="00" * 32))).verify(
        "manifest.json", SUBJECT
    )
    assert result.ok is False and result.outcome == REJECTED
    assert "no verified subject" in result.detail


def test_wrong_predicate_type_is_rejected_and_named() -> None:
    result = provider(
        trust=FakeVerifier(predicate="https://in-toto.io/attestation/link")
    ).verify("manifest.json", SUBJECT)
    assert result.ok is False and result.outcome == REJECTED
    assert "predicate mismatch" in result.detail


def test_a_bad_signature_is_rejected_and_named() -> None:
    """The signature is the root of trust (§14). This must fail before any
    payload is read — everything downstream trusts what verification returns."""
    result = provider(trust=FakeVerifier(fail="signature does not chain to the root")).verify(
        "manifest.json", SUBJECT
    )
    assert result.ok is False and result.outcome == REJECTED
    assert "signature or certificate policy did not verify" in result.detail


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
    # The signing certificate is the publish workflow's; the subject demands the
    # record signer's. The policy we hand sigstore must therefore be rejected.
    v = FakeVerifier(expect_identity=P2_PUBLISH_IDENTITY)
    result = provider(trust=v).verify("deployments/1.json", SUBJECT)
    assert result.ok is False and result.outcome == REJECTED
    assert v.seen == [(P2_RECORD_SIGN_IDENTITY, P2_OIDC_ISSUER)]


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
    """A verdict recorded under one pin must not satisfy another."""
    fetcher = FakeFetcher([bundle()])
    p = provider(fetcher)
    assert p.verify("manifest.json", SUBJECT).ok is True
    assert fetcher.calls == 1
    p.verify("manifest.json", SUBJECT)
    assert fetcher.calls == 1, "an identical second call should hit the cache"


def test_the_cache_key_includes_the_identity_within_one_instance() -> None:
    """The cache is per-instance, so comparing two instances proves nothing —
    a fresh one starts empty and the key never matters. Two subjects with the
    SAME bytes but DIFFERENT required identities, inside ONE provider, is the
    case a digest-only key would get wrong."""
    v = FakeVerifier(expect_identity=P2_PUBLISH_IDENTITY,
                     payload=statement(name="populus-data/manifest.json"))
    p = provider(FakeFetcher([bundle()]), trust=v)

    first = p.verify("manifest.json", SUBJECT)
    assert first.ok is True

    # Same digest; this subject requires the record-signer identity instead.
    second = p.verify("deployments/1.json", SUBJECT)
    assert second.ok is False, "a different identity pin must not reuse the verdict"
    assert v.seen == [
        (P2_PUBLISH_IDENTITY, P2_OIDC_ISSUER),
        (P2_RECORD_SIGN_IDENTITY, P2_OIDC_ISSUER),
    ]


def test_the_subject_name_is_bound_not_just_the_digest() -> None:
    """One attest step can carry several subjects. Matching on digest alone
    would let pointer bytes verify under the manifest's name and vice versa."""
    v = FakeVerifier(payload=statement(name="populus-data/latest.json"))
    result = provider(trust=v).verify("manifest.json", SUBJECT)
    assert result.ok is False and result.outcome == REJECTED
    assert "no verified subject named 'manifest.json'" in result.detail


def test_the_production_verifier_builds_the_policy_it_claims_to() -> None:
    """The real adapter was never executed before — it called APIs that do not
    exist in the pinned sigstore and would have raised on first use. This pins
    the policy construction against the installed library."""
    from sigstore.verify import policy as sigstore_policy

    built = SigstoreBundleVerifier.build_policy(P2_PUBLISH_IDENTITY, P2_OIDC_ISSUER)
    assert isinstance(built, sigstore_policy.Identity)


def test_the_production_verifier_rejects_a_non_bundle() -> None:
    """A dict that is not a Sigstore bundle must fail closed, not crash."""
    with pytest.raises(VerificationFailed) as excinfo:
        SigstoreBundleVerifier().verify({"nope": 1}, identity="i", issuer="s")
    assert "did not parse" in str(excinfo.value)


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


# --- F6: the production fetcher's three response branches ------------------
# It previously had zero tests, sitting inside the httpx allowlist without the
# injectable-transport property that justifies the other entries there.


def _fetcher_with(handler):
    import httpx

    from populus.client.snapshot import GitHubBundleFetcher

    return GitHubBundleFetcher(transport=httpx.MockTransport(handler))


def test_fetcher_unwraps_the_api_envelope() -> None:
    """The API returns {"attestations":[{"bundle":{...}}]}. Returning the
    wrapper would hand the verifier an object that is not a bundle and can
    never parse — which is exactly what the first implementation did."""
    import httpx

    inner = {"mediaType": "application/vnd.dev.sigstore.bundle.v0.3+json"}
    f = _fetcher_with(
        lambda r: httpx.Response(200, json={"attestations": [{"bundle": inner, "repository_id": 1}]})
    )
    assert f.fetch_bundles("ab" * 32) == [inner]


def test_fetcher_treats_404_as_a_real_answer() -> None:
    """404 means 'nothing was attested for this digest' — a verdict, not an
    outage. It must NOT raise, or a never-attested artifact would report as
    unavailable and mask a genuine gap."""
    import httpx

    f = _fetcher_with(lambda r: httpx.Response(404, json={"message": "Not Found"}))
    assert f.fetch_bundles("ab" * 32) == []


def test_fetcher_raises_unavailable_on_rate_limit() -> None:
    """403/429 is 'could not ask'. Returning [] would make a quota error
    indistinguishable from 'never attested' — the confusion R9 exists to stop."""
    import httpx

    for status in (403, 429):
        f = _fetcher_with(lambda r, s=status: httpx.Response(s, json={"message": "rate limited"}))
        with pytest.raises(FetchUnavailable) as excinfo:
            f.fetch_bundles("ab" * 32)
        assert "60/hour" in str(excinfo.value) or "rate limited" in str(excinfo.value).lower()


def test_fetcher_raises_unavailable_on_transport_error() -> None:
    import httpx

    def boom(request):
        raise httpx.ConnectError("no route to host")

    with pytest.raises(FetchUnavailable):
        _fetcher_with(boom).fetch_bundles("ab" * 32)


# --- F9: preflight had zero tests and dropped a path-containment control ----


def _repo_with_pointer(tmp_path, manifest_path="builds/20260803.1/manifest.json"):
    import json as _json

    repo = tmp_path / "data"
    (repo / "builds" / "20260803.1").mkdir(parents=True)
    (repo / "builds" / "20260803.1" / "manifest.json").write_text('{"build_id":"20260803.1"}')
    (repo / "latest.json").write_text(
        _json.dumps({"build_id": "20260803.1", "manifest_path": manifest_path})
    )
    return repo


def test_preflight_refuses_a_traversing_manifest_path(tmp_path) -> None:
    """`manifest_path` comes from an untrusted pointer. `run_verify` routes it
    through `resolve_within`; preflight dropped that control, turning a crafted
    latest.json into an arbitrary local file read."""
    from click.testing import CliRunner

    from populus.cli import main as cli_main

    repo = _repo_with_pointer(tmp_path, manifest_path="../../../../etc/passwd")
    result = CliRunner().invoke(
        cli_main, ["preflight-attestation", "--data-repo", str(repo)]
    )
    assert result.exit_code != 0
    assert "unsafe" in result.output.lower()


def test_preflight_fails_cleanly_without_a_pointer(tmp_path) -> None:
    from click.testing import CliRunner

    from populus.cli import main as cli_main

    result = CliRunner().invoke(
        cli_main, ["preflight-attestation", "--data-repo", str(tmp_path)]
    )
    assert result.exit_code != 0
    assert "no pointer" in result.output.lower()
    assert "Traceback" not in result.output
