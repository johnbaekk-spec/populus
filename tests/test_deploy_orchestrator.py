"""R9/R10/R11/R12/R14: the deploy sequence, tested as an *order*, not an outcome.

Every test here has to be able to fail for the right reason, and for an ordering
guarantee that is harder than it looks. "Assert production was never uploaded" is
satisfied by a run that aborted three steps earlier for an unrelated reason — the
assertion passes vacuously and the mutant that moves the production upload
survives. So each ordering test below does one of two things:

* it runs the **whole successful sequence** and pins where a step sits relative
  to the uploads (a test that cannot pass without reaching the uploads), or
* it aborts at a named step and asserts the steps *before* it did run — so the
  test proves it got far enough for its negative assertion to mean something.

The fakes are deliberately narrow. ``FakePages`` implements exactly the four
methods the orchestrator is allowed to call and records any other attribute the
orchestrator reaches for, so "no delete was attempted" is a statement about the
code rather than about which methods a mock happened to expose.
"""

from __future__ import annotations

import inspect
import re
from dataclasses import dataclass, field
from pathlib import Path
from types import SimpleNamespace
from typing import Any, Callable

import pytest

from populus.deploy import cloudflare, orchestrator
from populus.deploy.cloudflare import (
    ALLOWED_METHODS,
    CustomDomain,
    Deployment,
    PagesClient,
    PagesRejected,
    PagesUnavailable,
)
from populus.deploy.orchestrator import (
    ACCOUNT_ID_ENV,
    API_TOKEN_ENV,
    EXIT_DEPLOYED,
    EXIT_MISCONFIGURED,
    EXIT_REJECTED,
    EXIT_UNAVAILABLE,
    EXIT_UNCOMPENSATED,
    OUTCOME_DEPLOYED,
    POST_PROMOTION_SETTLE_SECONDS,
    PREVIEW,
    PRODUCTION,
    PROJECT_ENV,
    RUNBOOK,
    ArtifactRefused,
    DeployAborted,
    DeployOutcome,
    FirstRunUncompensated,
    PreviewVerificationFailed,
    ProductionVerificationFailed,
    RollbackAnchorUnverified,
    UploadedDeployment,
    artifact_expectations,
    main,
    run_deployment,
)
from populus.deploy.orchestrator import (
    PROPAGATION_REASON,
    PROPAGATION_RETRIES,
    PROPAGATION_SETTLE_SECONDS,
    RollbackExpectation,
    RollbackSiteObservation,
    _propagation_lag_only,
    capture_rollback_expectation,
    observe_rollback_root,
)
from populus.deploy.verify import Divergence, VerificationResult, check_no_functions
from populus.publish.attestation import REJECTED, UNAVAILABLE, VERIFIED
from populus.publish.digests import dist_digest
from populus.publish.inventory import build_inventory, render_inventory

DOMAIN = "publicfilings.org"
DOMAIN_URL = "https://publicfilings.org"
BRANCH = "main"
PREVIEW_URL = "https://preview.publicfilings.pages.dev"
PRIOR = "dep-prior"

#: R11c: the code_sha the default harness probe reports for BOTH the live
#: domain and the captured anchor, i.e. "they agree".
ANCHOR_SHA = "a" * 40

#: F1: a probe answers with the BUILD, not just the commit. Two deployments cut
#: from one commit against different data builds share `ANCHOR_SHA` and differ
#: only here, so `code_sha` alone cannot tell them apart.
ANCHOR_BUILD_ID = "20260801.1"


def _identity(code_sha: str = ANCHOR_SHA, build_id: str = ANCHOR_BUILD_ID):
    return orchestrator.ServedIdentity(build_id=build_id, code_sha=code_sha)


#: What the default harness probe answers for BOTH the live domain and the
#: captured anchor — and, by construction, the identity `OBSERVATION` carries,
#: because F2 binds the observation to the target by that identity.
ANCHOR_IDENTITY = _identity()

SITE = {
    "index.html": (
        b'<!doctype html><meta name="populus:build_id" content="20260805.1">'
        b'<meta name="populus:code_sha" content="' + b"a" * 40 + b'">'
    ),
    "assets/app.js": b"console.log(1)\n",
    "assets/app.css": b"body{}\n",
    "stats.json": b'{"stats_version":"stats-1.0.0"}\n',
    # LD12: every buildable tree carries exactly one root `_headers` control.
    "_headers": b"/*\n  Content-Security-Policy: default-src 'self'\n",
}

#: The pre-upload rollback observation the default harness observer reports —
#: and, unless a test overrides it, what the post-rollback observation reports
#: too ("restored exactly").
OBSERVATION = RollbackSiteObservation(
    body_sha256="c" * 64,
    body_length=1234,
    build_id=ANCHOR_BUILD_ID,
    code_sha=ANCHOR_SHA,
    headers=(
        ("content-security-policy", ("default-src 'self'",)),
        ("referrer-policy", ("strict-origin-when-cross-origin",)),
        ("strict-transport-security", ("max-age=31536000",)),
        ("x-content-type-options", ("nosniff",)),
    ),
)


# --- fakes -------------------------------------------------------------------


class FakePages:
    """The four Pages calls the ordered sequence is permitted to make.

    There is no ``delete``/``delete_deployment`` method here **on purpose**: a
    fake that owned one would make the no-DELETE assertion a statement about the
    fake. :meth:`__getattr__` records anything the orchestrator reaches for that
    is not one of the four, so an attempt to call a fifth API is visible even
    though it would fail anyway.
    """

    def __init__(
        self,
        log: list[tuple],
        *,
        production_branch: str = BRANCH,
        active_domains: tuple[str, ...] = (DOMAIN,),
        latest_id: str | None = PRIOR,
        rollback_uses_functions: Any = False,
        fail_with: Exception | None = None,
        production_ids: tuple[str, ...] | None = None,
    ) -> None:
        self.__dict__["unexpected_attributes"] = []
        self._log = log
        self.configured_branch = production_branch
        self.active_domains = set(active_domains)
        self.latest_id = latest_id
        # Newest-first, as the provider answers. Defaults to just the latest, so
        # every existing test keeps the behaviour it was written against.
        self.production_ids = (
            production_ids
            if production_ids is not None
            else ((latest_id,) if latest_id is not None else ())
        )
        self.rollback_uses_functions = rollback_uses_functions
        self.fail_with = fail_with
        self.rollbacks: list[str] = []
        # LD12c: raw production listings, served per `raw_deployments` call.
        # None derives a stable listing from `production_ids`; a list of
        # listings is popped per call so a test can model a concurrent change.
        self.raw_lists: list[list[dict]] | None = None
        self.raw_uses_functions: Any = False

    def assert_production_branch(self, expected: str) -> str:
        self._log.append(("assert-branch", expected))
        if self.fail_with is not None:
            raise self.fail_with
        if expected != self.configured_branch:
            raise PagesRejected(
                f"production branch mismatch: workflow {expected!r} vs project "
                f"{self.configured_branch!r}. Aborting before any upload (R8)."
            )
        return expected

    def assert_custom_domain_active(self, domain: str) -> CustomDomain:
        self._log.append(("assert-domain", domain))
        if domain not in self.active_domains:
            raise PagesRejected(
                f"custom domain {domain!r} is 'initializing', not 'active'. "
                "Aborting before the production upload (R11)."
            )
        return CustomDomain(name=domain, status="active")

    def latest_production_deployment(self) -> Deployment | None:
        self._log.append(("capture", self.latest_id))
        if self.latest_id is None:
            return None
        return _deployment(self.latest_id)

    def production_deployments(self) -> list[Deployment]:
        self._log.append(("list-production", tuple(self.production_ids)))
        return [_deployment(i) for i in self.production_ids]

    def raw_deployments(self, environment: str | None = None) -> list[dict]:
        """The RAW production listing the rollback-evidence capture reads."""
        self._log.append(("raw-list", environment))
        if self.raw_lists is not None:
            return list(self.raw_lists.pop(0)) if self.raw_lists else []
        return [
            _raw_deployment(i, self.raw_uses_functions) for i in self.production_ids
        ]

    def _deployments_path(self) -> str:
        """So `PagesDeploySurface(FakePages)` wiring tests can read raw lists."""
        return "deployments"

    def _request(self, method: str, path: str, params: dict | None = None) -> list[dict]:
        assert method == "GET", "the fake transport only reads"
        return self.raw_deployments((params or {}).get("env"))

    def rollback_payload(self, deployment_id: str) -> dict:
        """The provider's RAW object, exactly as ``PagesDeploySurface`` returns one.

        Spelled ``rollback_payload`` and not ``rollback`` because the difference
        is the defect: ``PagesClient.rollback`` answers with a typed
        ``Deployment`` whose ``uses_functions`` is ``bool(...)`` of a
        possibly-absent field, and a sequence that reconstructs a mapping from
        it can never fail closed on the provider having said nothing. A fake
        that offered both names would let the laundering path keep passing.
        """
        self._log.append(("rollback", deployment_id))
        self.rollbacks.append(deployment_id)
        return _raw_deployment(deployment_id, self.rollback_uses_functions)

    def __getattr__(self, name: str) -> Any:
        if name.startswith("__"):
            raise AttributeError(name)
        self.__dict__.setdefault("unexpected_attributes", []).append(name)
        raise AttributeError(
            f"FakePages exposes only the four pinned calls; something reached "
            f"for {name!r}"
        )


#: Passed as ``rollback_uses_functions`` to leave the field OUT of the provider
#: payload entirely — the state R16's no-Functions check must fail closed on,
#: and the one a reconstruction can never produce.
OMIT = object()


def _deployment(identifier: str) -> Deployment:
    return Deployment(
        id=identifier,
        environment="production",
        url=f"https://{identifier}.publicfilings.pages.dev",
        uses_functions=False,
    )


def _raw_deployment(identifier: str, uses_functions: Any = False) -> dict:
    payload = {
        "id": identifier,
        "environment": "production",
        "url": f"https://{identifier}.publicfilings.pages.dev",
    }
    if uses_functions is not OMIT:
        payload["uses_functions"] = uses_functions
    return payload


@dataclass
class UploadCall:
    path: Path
    environment: str
    branch: str
    digest: str


class FakeUploader:
    """Records what it was handed, and can misbehave on demand.

    ``on_upload`` runs **after** the tree's digest is recorded, so a hook that
    tampers with the sealed tree models exactly the R10 threat: the preview
    verified one tree, and something changed it before production.
    """

    def __init__(
        self,
        log: list[tuple],
        *,
        on_upload: Callable[[Path, str], None] | None = None,
        report_environment: Callable[[str], str] | None = None,
    ) -> None:
        self._log = log
        self.calls: list[UploadCall] = []
        self._on_upload = on_upload
        self._report_environment = report_environment or (lambda env: env)

    def __call__(
        self, path: Path, *, environment: str, branch: str
    ) -> UploadedDeployment:
        self._log.append(("upload", environment))
        self.calls.append(
            UploadCall(
                path=path,
                environment=environment,
                branch=branch,
                digest=dist_digest(path),
            )
        )
        if self._on_upload is not None:
            self._on_upload(path, environment)
        reported = self._report_environment(environment)
        url = PREVIEW_URL if environment == PREVIEW else f"https://{BRANCH}.example.invalid"
        return UploadedDeployment(
            id=f"dep-{environment}",
            url=url,
            environment=reported,
            payload={
                "id": f"dep-{environment}",
                "environment": reported,
                "url": url,
                "uses_functions": False,
            },
        )

    @property
    def environments(self) -> list[str]:
        return [call.environment for call in self.calls]


@dataclass
class VerifyCall:
    base_url: str
    stage: str
    inventory: dict
    deployment: dict


class FakeVerifier:
    """Returns the planned verdicts in call order; ``True`` once the plan runs out.

    ``plan`` entries are ``True`` (verified), ``False`` (rejected) or
    ``"unavailable"`` (R17 — no verdict reached), so a test can say "preview
    passes, production fails, the rollback then verifies" as ``[True, False,
    True]`` and nothing else has to be stubbed.
    """

    def __init__(self, log: list[tuple], *, plan: list[Any] | None = None) -> None:
        self._log = log
        self._plan = list(plan or [])
        self.calls: list[VerifyCall] = []

    def __call__(
        self,
        base_url: str,
        *,
        stage: str,
        inventory: dict,
        deployment: dict,
    ) -> VerificationResult:
        self._log.append(("verify", stage, base_url))
        self.calls.append(
            VerifyCall(
                base_url=base_url,
                stage=stage,
                inventory=inventory,
                deployment=deployment,
            )
        )
        verdict = self._plan.pop(0) if self._plan else True
        if verdict is True:
            return VerificationResult(
                ok=True,
                outcome=VERIFIED,
                detail=f"4/4 files verified at {base_url}",
                files_verified=4,
                files_total=4,
            )
        if verdict == "unavailable":
            return VerificationResult(
                ok=False,
                outcome=UNAVAILABLE,
                detail="verification unavailable: HTTP 429",
                files_total=4,
            )
        if isinstance(verdict, VerificationResult):
            return verdict
        return VerificationResult(
            ok=False,
            outcome=REJECTED,
            detail="index.html: served bytes are not the recorded bytes",
            files_verified=3,
            files_total=4,
        )

    @property
    def stages(self) -> list[str]:
        return [call.stage for call in self.calls]


@dataclass
class Harness:
    log: list[tuple]
    client: FakePages
    upload: FakeUploader
    verify: FakeVerifier
    source: Path
    root: Path
    _uploader_factory: Callable[..., FakeUploader] = field(repr=False, default=None)

    def run(self, **overrides: Any) -> DeployOutcome:
        kwargs: dict[str, Any] = dict(
            client=self.client,
            source=self.source,
            production_branch=BRANCH,
            custom_domain=DOMAIN,
            upload=self.upload,
            verify=self.verify,
            # R11c default: an agreeing probe, so tests that are not ABOUT the
            # anchor keep exercising what they were written to exercise. The
            # disagreement and unreadable cases get explicit overrides.
            serving_probe=lambda url: ANCHOR_IDENTITY,
            # LD12a/LD12c default: a coherent observation, identical before the
            # upload and after a rollback, so tests that are not ABOUT rollback
            # evidence keep exercising what they were written to exercise.
            observer=lambda url: OBSERVATION,
            # R11b default: never really sleep in the suite.
            settle=lambda seconds: None,
        )
        kwargs.update(overrides)
        return run_deployment(**kwargs)

    def with_uploader(self, **kwargs: Any) -> None:
        self.upload = FakeUploader(self.log, **kwargs)

    def with_verifier(self, **kwargs: Any) -> None:
        self.verify = FakeVerifier(self.log, **kwargs)

    @property
    def sealed_dirs(self) -> list[Path]:
        return sorted(
            path
            for path in self.root.iterdir()
            if path.name.startswith(".populus-upload-")
        )


@pytest.fixture
def harness(tmp_path: Path) -> Harness:
    source = tmp_path / "dist"
    for relpath, payload in SITE.items():
        target = source / relpath
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(payload)
    log: list[tuple] = []
    return Harness(
        log=log,
        client=FakePages(log),
        upload=FakeUploader(log),
        verify=FakeVerifier(log),
        source=source,
        root=tmp_path,
    )


def _index_of(log: list[tuple], *prefix: Any) -> int:
    for position, event in enumerate(log):
        if event[: len(prefix)] == tuple(prefix):
            return position
    raise AssertionError(f"no {prefix!r} event in {log!r}")


def _first_upload(log: list[tuple]) -> int:
    return _index_of(log, "upload")


# --- (1) R8: the branch assertion --------------------------------------------


def test_branch_mismatch_aborts_with_zero_uploads(harness: Harness) -> None:
    """R8: the project deploys production from another branch — stop now.

    Zero uploads *and* zero freezes: nothing was copied, nothing was sent, and
    the domain was never even consulted because the identity question failed
    first.
    """
    harness.client.configured_branch = "trunk"

    with pytest.raises(PagesRejected, match="production branch mismatch"):
        harness.run()

    assert harness.upload.calls == []
    assert harness.verify.calls == []
    assert harness.log == [("assert-branch", BRANCH)]
    assert harness.sealed_dirs == []


def test_the_branch_assertion_precedes_every_upload(harness: Harness) -> None:
    """Ordering mutant (c): move ``assert_production_branch`` after the upload.

    The abort test above cannot catch that mutant on its own — with the
    assertion moved, the mismatch run uploads a preview first and *then*
    raises, and "zero uploads" fails only because the assertion still runs at
    all. This test pins the position on a run that reaches both uploads, so it
    fails for the ordering and nothing else.
    """
    harness.run()

    assert harness.upload.environments == [PREVIEW, PRODUCTION]
    assert _index_of(harness.log, "assert-branch") < _first_upload(harness.log)


# --- (2) R11: the domain precondition ----------------------------------------


def test_inactive_domain_aborts_with_zero_uploads(harness: Harness) -> None:
    """R11: a domain that is not ``active`` aborts before anything is uploaded.

    The branch assertion is asserted to have run, so this is a test about the
    *domain* step failing and not about the run dying earlier for some other
    reason.
    """
    harness.client.active_domains = set()

    with pytest.raises(PagesRejected, match="not 'active'"):
        harness.run()

    assert harness.log == [("assert-branch", BRANCH), ("assert-domain", DOMAIN)]
    assert harness.upload.calls == []
    assert harness.verify.calls == []
    assert harness.sealed_dirs == []


def test_the_domain_assertion_precedes_every_upload(harness: Harness) -> None:
    """Ordering mutant (d): move ``assert_custom_domain_active`` after the upload.

    Same reasoning as the branch mutant: pinned on a run that actually uploads,
    so the assertion is about position rather than about existence.
    """
    harness.run()

    assert harness.upload.environments == [PREVIEW, PRODUCTION]
    assert _index_of(harness.log, "assert-domain") < _first_upload(harness.log)


# --- (5)-(6) R9: preview first, verified, before production ------------------


def test_preview_verification_failure_leaves_production_untouched(
    harness: Harness,
) -> None:
    """R9: the preview did not verify, so production is never uploaded.

    Non-vacuity: the preview upload *and* the preview verification are both
    asserted to have happened, so the empty production slot is the consequence
    of the failed verification rather than of an earlier abort.
    """
    harness.with_verifier(plan=[False])

    with pytest.raises(PreviewVerificationFailed, match="Production was not touched"):
        harness.run()

    assert harness.upload.environments == [PREVIEW]
    assert harness.verify.stages == [PREVIEW]
    assert PRODUCTION not in harness.upload.environments
    assert harness.client.rollbacks == []


def test_production_is_uploaded_only_after_the_preview_verifies(
    harness: Harness,
) -> None:
    """Ordering mutant (b): upload production before the preview verification.

    On the happy path both orders end with the same set of calls, which is
    exactly why the failure test above is not sufficient by itself — a mutant
    could upload production first and still abort before verifying it. Here the
    positions are pinned: preview upload, preview verify, production upload.
    """
    harness.run()

    assert harness.log.index(("upload", PREVIEW)) < harness.log.index(
        ("verify", PREVIEW, PREVIEW_URL)
    )
    assert harness.log.index(("verify", PREVIEW, PREVIEW_URL)) < harness.log.index(
        ("upload", PRODUCTION)
    )


def test_the_preview_is_verified_against_the_whole_inventory(
    harness: Harness,
) -> None:
    """R9 as amended: the preview sweep is inventory-wide, not marker-only.

    TD-4's bound is "the identical bytes already passed the preview sweep". If
    the preview were handed a trimmed inventory — markers and ``stats.json`` —
    that sentence would be vacuous. The orchestrator hands both stages the same
    sealed-tree inventory, and this pins it.
    """
    outcome = harness.run()

    preview_call, production_call = harness.verify.calls
    served = sorted(entry["path"] for entry in preview_call.inventory["files"])
    assert served == ["assets/app.css", "assets/app.js", "index.html", "stats.json"]
    assert preview_call.inventory == production_call.inventory == outcome.inventory
    assert outcome.file_count == len(SITE)


def test_the_full_sequence_runs_in_order(harness: Harness) -> None:
    """R12: the whole ordered sequence, pinned as one list.

    Any reordering of the seven steps changes this literal, which is the point
    of keeping the sequence in one function instead of across workflow steps.
    """
    outcome = harness.run()

    assert harness.log == [
        ("assert-branch", BRANCH),
        ("assert-domain", DOMAIN),
        ("capture", PRIOR),
        ("list-production", (PRIOR,)),
        # LD12c: the raw bracketing reads around the one rollback observation,
        # BEFORE the freeze and either upload.
        ("raw-list", "production"),
        ("raw-list", "production"),
        ("upload", PREVIEW),
        ("verify", PREVIEW, PREVIEW_URL),
        ("upload", PRODUCTION),
        ("verify", PRODUCTION, DOMAIN_URL),
    ]
    assert outcome.rollback_target == PRIOR
    assert outcome.dist_digest == harness.upload.calls[0].digest
    assert outcome.production_verification.outcome == VERIFIED


# --- (6) R10: provably the same bytes ----------------------------------------


def test_a_file_mutated_between_the_uploads_aborts_before_production(
    harness: Harness,
) -> None:
    """R10: the digest is re-checked immediately before the production upload.

    The tamper happens inside the preview upload, i.e. after the tree was
    frozen and before the production upload — the only window where the two
    uploads can disagree. Non-vacuity: the preview verification is asserted to
    have run, so the abort is the digest re-check and not an earlier step.
    """

    def tamper(path: Path, environment: str) -> None:
        if environment != PREVIEW:
            return
        target = path / "assets" / "app.js"
        target.chmod(0o600)
        target.write_bytes(b"console.log('tampered')\n")
        target.chmod(0o400)

    harness.with_uploader(on_upload=tamper)

    with pytest.raises(DeployAborted, match="R10") as raised:
        harness.run()

    assert "changed between the preview and production uploads" in str(raised.value)
    assert harness.verify.stages == [PREVIEW]
    assert harness.upload.environments == [PREVIEW]
    assert harness.client.rollbacks == []


def test_both_uploads_receive_the_same_sealed_bytes(harness: Harness) -> None:
    """R10's positive half: production is a second upload of the same tree.

    The uploader is handed the sealed snapshot — never the source ``dist/`` —
    and the same path with the same digest twice.
    """
    outcome = harness.run()

    preview_call, production_call = harness.upload.calls
    assert preview_call.path == production_call.path
    assert preview_call.path != harness.source
    assert preview_call.digest == production_call.digest == outcome.dist_digest
    assert preview_call.branch != production_call.branch
    assert production_call.branch == BRANCH


# --- (8) rollback -------------------------------------------------------------


def test_production_verification_failure_rolls_back_to_the_captured_id(
    harness: Harness,
) -> None:
    """Ordering mutant (a): delete the rollback step.

    Non-vacuity: the run is asserted to have reached the production
    verification (both uploads, two verify calls) before the rollback is
    demanded, so this cannot pass by never getting there.
    """
    harness.with_verifier(plan=[True, False, True])

    with pytest.raises(ProductionVerificationFailed) as raised:
        harness.run()

    assert harness.upload.environments == [PREVIEW, PRODUCTION]
    assert harness.client.rollbacks == [PRIOR]
    assert raised.value.rolled_back_to == PRIOR
    assert not isinstance(raised.value, FirstRunUncompensated)


def test_the_rollback_is_reverified_against_the_captured_expectation(
    harness: Harness,
) -> None:
    """Ordering mutant (a2): roll back but skip the restoration check.

    LD12a: restoration is judged against the PRE-UPLOAD expectation — a fresh
    observation of the custom-domain root taken AFTER the rollback call — and
    never against the attempted (failed) artifact's inventory. The observer is
    called exactly twice: once for the capture, once post-rollback.
    """
    calls: list[str] = []

    def observer(url: str) -> RollbackSiteObservation:
        calls.append(url)
        harness.log.append(("observe", url))
        return OBSERVATION

    harness.with_verifier(plan=[True, False])

    with pytest.raises(ProductionVerificationFailed) as raised:
        harness.run(observer=observer)

    assert harness.log[-2:] == [
        ("rollback", PRIOR),
        ("observe", DOMAIN_URL),
    ]
    assert calls == [DOMAIN_URL, DOMAIN_URL]
    # The attempted inventory is NEVER re-verified against the restored
    # deployment: the verifier ran exactly twice, preview and production.
    assert harness.verify.stages == [PREVIEW, PRODUCTION]
    assert raised.value.rollback_verified is True
    assert "matches the pre-upload expectation" in str(raised.value)


def test_a_rollback_that_does_not_restore_exactly_says_so(harness: Harness) -> None:
    """The restoration check is a real comparison, not a formality.

    The post-rollback observation drifts on the body hash and one header;
    ``rollback_verified`` must be False and the drifted fields named.
    """
    drifted = RollbackSiteObservation(
        body_sha256="d" * 64,
        body_length=OBSERVATION.body_length,
        build_id=OBSERVATION.build_id,
        code_sha=OBSERVATION.code_sha,
        headers=OBSERVATION.headers[1:],
    )
    answers = [OBSERVATION, drifted]

    harness.with_verifier(plan=[True, False])

    with pytest.raises(ProductionVerificationFailed) as raised:
        harness.run(observer=lambda url: answers.pop(0))

    assert raised.value.rollback_verified is False
    assert "did NOT verify" in str(raised.value)
    assert "body_sha256" in str(raised.value)


def test_an_unavailable_post_rollback_observation_is_not_restored(
    harness: Harness,
) -> None:
    """LD12a: mismatch OR unavailability — both keep rollback_verified False."""
    answers: list[Any] = [OBSERVATION]

    def observer(url: str) -> RollbackSiteObservation:
        if answers:
            return answers.pop(0)
        raise DeployAborted("the rollback observation requires HTTP 200; got 503")

    harness.with_verifier(plan=[True, False])

    with pytest.raises(ProductionVerificationFailed) as raised:
        harness.run(observer=observer)

    assert raised.value.rollback_verified is False
    assert "unavailable" in str(raised.value)


def test_the_rollback_target_is_captured_before_the_production_upload(
    harness: Harness,
) -> None:
    """Ordering mutant (e): capture the rollback target after the upload.

    After the production upload the newest production deployment is the one
    that just failed verification, so a capture moved below the upload would
    "roll back" to the bad deployment — a no-op wearing a compensation's name.
    The fake advances its own latest id when production is uploaded, which is
    what a real project does, so the mutant is observable rather than
    theoretical.
    """

    def advance(path: Path, environment: str) -> None:
        if environment == PRODUCTION:
            harness.client.latest_id = "dep-production"

    harness.with_uploader(on_upload=advance)
    harness.with_verifier(plan=[True, False, True])

    with pytest.raises(ProductionVerificationFailed) as raised:
        harness.run()

    assert harness.client.latest_id == "dep-production"
    assert harness.client.rollbacks == [PRIOR]
    assert raised.value.rolled_back_to == PRIOR
    assert _index_of(harness.log, "capture") < _first_upload(harness.log)


# --- R14 / TD-4: the first run ------------------------------------------------


def test_first_run_failure_raises_the_td4_pointer(harness: Harness) -> None:
    """R14/TD-4: no prior deployment, so no automated compensation exists.

    The message has to carry everything an operator needs, because this is the
    one deploy failure with no machine record of its own resolution: no
    rollback target, the runbook, and the fact that it can only happen once.
    """
    harness.client.latest_id = None
    harness.with_verifier(plan=[True, False])

    with pytest.raises(FirstRunUncompensated) as raised:
        harness.run()

    message = str(raised.value)
    assert RUNBOOK in message
    assert "NO automated compensation" in message
    assert "exactly once" in message
    assert "nothing to roll back" in message
    # It reached production verification — otherwise the assertions below about
    # what was *not* called would be about an abort that happened much earlier.
    assert harness.upload.environments == [PREVIEW, PRODUCTION]
    assert harness.verify.stages == [PREVIEW, PRODUCTION]
    assert harness.client.rollbacks == []
    assert raised.value.rolled_back_to is None


def test_first_run_failure_attempts_no_delete_anywhere(harness: Harness) -> None:
    """TD-4: the compensation Cloudflare refuses is not attempted, at all.

    Four independent statements, because any one of them alone could be
    satisfied by an accident: the run really did reach the uncompensated
    failure; the orchestrator reached for no client API beyond the four pinned
    calls; the real :class:`PagesClient` exposes no deletion method to reach
    for; and the orchestrator's own source contains no delete call.
    """
    harness.client.latest_id = None
    harness.with_verifier(plan=[True, False])

    with pytest.raises(FirstRunUncompensated):
        harness.run()

    assert harness.client.unexpected_attributes == []
    assert [name for name in dir(PagesClient) if "delete" in name.lower()] == []
    assert "DELETE" not in ALLOWED_METHODS
    source = inspect.getsource(orchestrator)
    assert not re.search(r"\.delete\w*\s*\(", source)
    assert "DELETE" not in source


# --- verification verdicts ----------------------------------------------------


def test_an_unavailable_verification_is_not_a_pass(harness: Harness) -> None:
    """R17: "we could not ask" is not "it verified" — and it is not tampering.

    The run fails and compensates like any other unverified production, and the
    distinction survives into the message so an outage is never reported as a
    divergence.
    """
    harness.with_verifier(plan=[True, "unavailable", True])

    with pytest.raises(ProductionVerificationFailed) as raised:
        harness.run()

    message = str(raised.value)
    assert UNAVAILABLE in message
    assert REJECTED not in message
    assert harness.client.rollbacks == [PRIOR]


# --- the sealed tree ----------------------------------------------------------


def _run_scenario(harness: Harness, scenario: str) -> None:
    """Drive one terminal path; the sealed tree must be gone afterwards either way."""
    if scenario == "success":
        harness.run()
        return
    if scenario == "preview-failure":
        harness.with_verifier(plan=[False])
        expected: type[Exception] = PreviewVerificationFailed
    elif scenario == "production-failure":
        harness.with_verifier(plan=[True, False, True])
        expected = ProductionVerificationFailed
    elif scenario == "first-run":
        harness.client.latest_id = None
        harness.with_verifier(plan=[True, False])
        expected = FirstRunUncompensated
    elif scenario == "digest-abort":

        def tamper(path: Path, environment: str) -> None:
            if environment == PREVIEW:
                target = path / "index.html"
                target.chmod(0o600)
                target.write_bytes(b"<!doctype html>DEFACED")
                target.chmod(0o400)

        harness.with_uploader(on_upload=tamper)
        expected = DeployAborted
    else:  # pragma: no cover - guards the parametrization itself
        raise AssertionError(f"unknown scenario {scenario!r}")

    with pytest.raises(expected):
        harness.run()


@pytest.mark.parametrize(
    "scenario",
    ["success", "preview-failure", "production-failure", "first-run", "digest-abort"],
)
def test_the_sealed_snapshot_is_removed_on_every_path(
    harness: Harness, scenario: str
) -> None:
    """The private copy of the whole site does not outlive the run.

    Non-vacuity: the uploader records the sealed path it was handed, so every
    scenario proves a snapshot was created before asserting it is gone. A
    ``finally`` that never ran because the freeze never happened would fail the
    first assertion, not pass the second.
    """
    _run_scenario(harness, scenario)

    assert harness.upload.calls, "no upload happened, so nothing proves a tree was frozen"
    sealed = harness.upload.calls[0].path
    assert not sealed.exists()
    assert harness.sealed_dirs == []


# --- guards on the injected callables ----------------------------------------


def test_a_preview_branch_equal_to_production_is_refused(harness: Harness) -> None:
    """Pages derives the environment from the branch name.

    A "preview" published under the production branch is a production
    deployment, which would make R9's ordering a fiction while every other test
    still passed.
    """
    with pytest.raises(DeployAborted, match="equals the production branch"):
        harness.run(preview_branch=BRANCH)

    assert harness.upload.calls == []
    assert harness.log == []


def test_an_uploader_that_reports_the_wrong_environment_aborts(
    harness: Harness,
) -> None:
    """"Production was never touched" has to be about the environment, not the label.

    An uploader that answers ``production`` for the preview leg has already done
    the thing the ordering exists to prevent; verifying it under the name
    ``preview`` would launder that into a pass.
    """
    harness.with_uploader(report_environment=lambda env: PRODUCTION)

    with pytest.raises(DeployAborted, match="asked for a 'preview' deployment"):
        harness.run()

    assert harness.upload.environments == [PREVIEW]
    assert harness.verify.calls == []


def test_the_sequence_reimplements_no_transport_and_no_cloudflare_surface() -> None:
    """The sequence is composed, not reimplemented.

    The orchestrator owns the *order*; the endpoint pinning lives in
    ``cloudflare`` and the sweep lives in ``verify``. If the ordered sequence
    grew its own HTTP call the injection story — and the hermetic suite — would
    be over.

    This replaces a blanket ``"httpx" not in inspect.getsource(orchestrator)``,
    and the replacement is deliberate and narrower rather than weaker. The
    module gained an entry point (``publish.yml`` runs it as its own process),
    and something in it therefore has to build the served-tree client the
    verifier is handed — exactly as ``deploy/record.py`` does, for exactly the
    same reason. A blanket string check would now be false, so the property is
    pinned where it actually lives: **no function the sequence reaches names a
    transport**, the one that does is reached only from ``main()``, and the
    Cloudflare host still appears nowhere at all.
    """
    assert cloudflare.API_HOST not in inspect.getsource(orchestrator)

    sequence = (
        orchestrator.run_deployment,
        orchestrator._upload,
        orchestrator._require_seal_intact,
        orchestrator._fail_production,
        orchestrator._td4_message,
        orchestrator._domain_url,
        orchestrator.artifact_expectations,
    )
    for function in sequence:
        assert "httpx" not in inspect.getsource(function), function.__name__

    naming_a_transport = sorted(
        name
        for name, value in vars(orchestrator).items()
        if inspect.isfunction(value) and "httpx" in inspect.getsource(value)
    )
    assert naming_a_transport == ["_default_http_client"]
    assert "_default_http_client" not in inspect.getsource(orchestrator.run_deployment)


# --- R16: the rollback re-verification reads the RAW provider payload ---------


def test_the_rollback_reverification_receives_the_raw_provider_payload(
    harness: Harness,
) -> None:
    """A provider answer omitting ``uses_functions`` must still fail closed.

    The deploy-side twin of ``test_deploy_record.py``'s
    ``test_a_missing_uses_functions_field_fails_closed``. The orchestrator used
    to rebuild this mapping from the typed ``Deployment``, always setting
    ``"uses_functions": deployment.uses_functions`` — and
    ``cloudflare._deployment`` computes that as ``bool(entry.get(...))``, so an
    absent provider signal arrived as a confident ``False``.
    ``check_no_functions`` fails closed *only* on the key being ABSENT, which
    the reconstruction made impossible: the check could not have fired on this
    path no matter what Cloudflare answered.

    Mutant: put a reconstruction back (`{"id": …, "uses_functions": d.uses_functions}`)
    — the key reappears, the refusal never fires, and this fails.
    """
    harness.client.rollback_uses_functions = OMIT
    harness.with_verifier(plan=[True, False])

    with pytest.raises(ProductionVerificationFailed) as raised:
        harness.run()

    # Non-vacuity: the run really did reach the rollback restoration check.
    assert harness.client.rollbacks == [PRIOR]
    assert raised.value.rollback_verified is False
    message = str(raised.value)
    assert "uses_functions" in message and "absent" in message


def test_a_provider_payload_that_does_carry_the_field_still_passes(
    harness: Harness,
) -> None:
    """The companion half: the check is about the field, not about the dict.

    Without this, the test above would also pass against a payload that carried
    nothing at all, and "fails closed on absence" would be indistinguishable
    from "always fails".
    """
    harness.with_verifier(plan=[True, False])

    with pytest.raises(ProductionVerificationFailed) as raised:
        harness.run()

    assert harness.client.rollbacks == [PRIOR]
    assert raised.value.rollback_verified is True


def test_the_sequence_never_reaches_for_the_laundering_rollback(
    harness: Harness,
) -> None:
    """``PagesClient.rollback`` returns a typed deployment, so it is not used.

    ``FakePages`` exposes ``rollback_payload`` and records anything else reached
    for, so a sequence that called ``client.rollback(...)`` would both fail and
    say which name it wanted. The source assertion covers the case where a
    future edit reconstructs the mapping *after* calling the raw method.
    """
    harness.with_verifier(plan=[True, False])

    with pytest.raises(ProductionVerificationFailed):
        harness.run()

    assert harness.client.unexpected_attributes == []
    source = inspect.getsource(orchestrator._fail_production)
    assert "rollback_payload" in source
    assert not re.search(r"""["']uses_functions["']\s*:""", source)


# --- the entry point ----------------------------------------------------------
#
# `publish.yml` runs this module as its own process. Until it had a `main()` the
# deploy step exited 0 having done nothing: a green job that deployed nothing,
# whose empty `deployment_id` output then made the signer's cross-check skip
# itself. Every test below drives `main()` — argv, environment, `$GITHUB_OUTPUT`
# and the exit code — rather than `run_deployment`, because that gap was
# invisible to a suite that only ever called the function.


BUILD_ID = "20260805.1"
CODE_SHA = "a" * 40
ACCOUNT = "acct-1"
PROJECT = "populus-site"
TOKEN = "tok-1"


@pytest.fixture
def artifact(tmp_path: Path) -> tuple[Path, Path]:
    """A downloaded site artifact: ``site/`` plus its SIBLING ``inventory.json``."""
    root = tmp_path / "site-artifact"
    source = root / "site"
    for relpath, payload in SITE.items():
        target = source / relpath
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(payload)
    inventory = root / "inventory.json"
    inventory.write_bytes(render_inventory(build_inventory(source)))
    return source, inventory


@dataclass
class Cli:
    """The entry point with every seam faked, so no process and no connection."""

    log: list[tuple]
    client: FakePages
    upload: FakeUploader
    verify: FakeVerifier
    source: Path
    inventory: Path
    output: Path

    def argv(self, *extra: str) -> list[str]:
        return [
            "--source",
            str(self.source),
            "--inventory",
            str(self.inventory),
            "--custom-domain",
            DOMAIN,
            *extra,
        ]

    def run(self, *extra: str, pages: bool = True, **kwargs: Any) -> int:
        factories: dict[str, Any] = {
            "upload_factory": lambda: self.upload,
            "verifier_factory": lambda: self.verify,
            # No readiness sleeps in the suite. The real poller waits for a
            # brand-new Pages origin to start routing (12 x 5s); left
            # un-injected here it made this file take 19 minutes, and a slow
            # suite is a suite people stop running.
            "readiness_factory": lambda: (lambda url, *, stage: None),
            # R11c: an agreeing probe, and R11b: no real sleeps. Tests that are
            # ABOUT either seam override these.
            "probe_factory": lambda: (lambda url: ANCHOR_IDENTITY),
            # LD12a/LD12c: a coherent, stable observation by default.
            "observer_factory": lambda: (lambda url: OBSERVATION),
            "settle_factory": lambda: (lambda seconds: None),
        }
        if pages:
            factories["pages_factory"] = lambda: self.client
        factories.update(kwargs)
        return main(self.argv(*extra), **factories)

    @property
    def emitted(self) -> dict[str, str]:
        """``$GITHUB_OUTPUT`` parsed as the ``key=value`` lines it is written as."""
        if not self.output.exists():
            return {}
        return dict(
            line.split("=", 1)
            for line in self.output.read_text(encoding="utf-8").splitlines()
            if line
        )


@pytest.fixture
def cli(tmp_path: Path, artifact: tuple[Path, Path], monkeypatch) -> Cli:
    source, inventory = artifact
    output = tmp_path / "github-output.txt"
    monkeypatch.setenv("GITHUB_OUTPUT", str(output))
    monkeypatch.setenv(ACCOUNT_ID_ENV, ACCOUNT)
    monkeypatch.setenv(PROJECT_ENV, PROJECT)
    monkeypatch.setenv(API_TOKEN_ENV, TOKEN)
    log: list[tuple] = []
    return Cli(
        log=log,
        client=FakePages(log),
        upload=FakeUploader(log),
        verify=FakeVerifier(log),
        source=source,
        inventory=inventory,
        output=output,
    )


def test_the_entry_point_runs_the_whole_sequence(cli: Cli) -> None:
    """The defect this file exists to close: no ``main()`` at all.

    Without one the module exited 0 with an empty ``deployment_id``, and every
    assertion below is one the old state fails: the sequence ran, both uploads
    happened, both verifications happened, and the workflow was handed the id
    of the deployment that verified.
    """
    assert cli.run() == EXIT_DEPLOYED

    assert cli.upload.environments == [PREVIEW, PRODUCTION]
    assert cli.verify.stages == [PREVIEW, PRODUCTION]
    assert cli.emitted["outcome"] == "deployed"
    assert cli.emitted["deployment_id"] == "dep-production"
    assert cli.emitted["preview_deployment_id"] == "dep-preview"
    assert cli.emitted["dist_digest"] == cli.upload.calls[0].digest
    assert cli.emitted["rolled_back_to"] == ""


def test_the_entry_point_parses_the_flags_the_workflow_passes(cli: Cli) -> None:
    """``--source``, ``--inventory``, ``--custom-domain`` and nothing else.

    That is the literal command in ``publish.yml``, so the defaults have to
    carry the rest: the production branch R8 asserts, and a preview branch that
    differs from it. A default that matched production would publish the
    "preview" straight to production.
    """
    assert cli.run() == EXIT_DEPLOYED

    assert ("assert-branch", "main") in cli.log
    assert ("assert-domain", DOMAIN) in cli.log
    preview_call, production_call = cli.upload.calls
    assert preview_call.branch == orchestrator.DEFAULT_PREVIEW_BRANCH
    assert production_call.branch == "main"
    assert preview_call.branch != production_call.branch
    assert cli.verify.calls[-1].base_url == DOMAIN_URL


def test_the_production_branch_lock_can_be_stated_explicitly(cli: Cli) -> None:
    """R8's lock is a value, not a constant baked into the module."""
    cli.client.configured_branch = "trunk"

    assert cli.run("--production-branch", "trunk") == EXIT_DEPLOYED
    assert ("assert-branch", "trunk") in cli.log
    assert cli.upload.calls[1].branch == "trunk"


def test_the_pages_client_is_built_from_the_environment(cli: Cli, monkeypatch) -> None:
    """The three credentials the workflow injects, read by these exact names.

    Read through the wrong context (``secrets.`` for a repository VARIABLE) they
    resolve to the empty string silently, so the names are pinned here and the
    emptiness is refused below.
    """
    seen: dict[str, str] = {}

    def _client(account_id: str, project: str, token: str) -> FakePages:
        seen.update(account_id=account_id, project=project, token=token)
        return cli.client

    monkeypatch.setattr(orchestrator, "PagesClient", _client)

    assert cli.run(pages=False) == EXIT_DEPLOYED
    assert seen == {"account_id": ACCOUNT, "project": PROJECT, "token": TOKEN}


@pytest.mark.parametrize("unset", [ACCOUNT_ID_ENV, PROJECT_ENV, API_TOKEN_ENV])
def test_a_missing_credential_exits_misconfigured_before_any_upload(
    cli: Cli, monkeypatch, unset: str, capsys
) -> None:
    """Fail closed, and fail *early*: nothing is uploaded and nothing is claimed.

    An empty account id or project is not a runtime error somewhere useful — it
    is a deploy that targets account ``""`` and fails far from its cause.
    """
    monkeypatch.setenv(unset, "")

    assert cli.run(pages=False) == EXIT_MISCONFIGURED

    assert unset in capsys.readouterr().err
    assert cli.upload.calls == []
    assert cli.log == []
    assert cli.emitted["outcome"] == "misconfigured"
    assert cli.emitted["deployment_id"] == ""


def test_a_production_verification_failure_exits_rejected(cli: Cli) -> None:
    """Exit 1, the rollback target reported, and **no** deployment id claimed."""
    cli.verify = FakeVerifier(cli.log, plan=[True, False, True])

    assert cli.run() == EXIT_REJECTED

    assert cli.client.rollbacks == [PRIOR]
    assert cli.emitted["outcome"] == "rejected"
    assert cli.emitted["rolled_back_to"] == PRIOR
    assert cli.emitted["deployment_id"] == ""


def test_a_first_run_failure_exits_with_its_own_code(cli: Cli, capsys) -> None:
    """TD-4 is not an ordinary rejection and must not page like one.

    Unverified bytes are serving, no rollback happened, and none was possible.
    A caller that could only see "non-zero" would treat this as the compensated
    case, which is the one situation where nothing is serving unverified.
    """
    cli.client.latest_id = None
    cli.verify = FakeVerifier(cli.log, plan=[True, False])

    assert cli.run() == EXIT_UNCOMPENSATED

    assert EXIT_UNCOMPENSATED != EXIT_REJECTED
    assert cli.client.rollbacks == []
    assert RUNBOOK in capsys.readouterr().err
    assert cli.emitted["outcome"] == "uncompensated"
    assert cli.emitted["deployment_id"] == ""


def test_a_preview_verification_failure_exits_rejected(cli: Cli) -> None:
    """R9: production was never touched, and the exit code says rejected."""
    cli.verify = FakeVerifier(cli.log, plan=[False])

    assert cli.run() == EXIT_REJECTED

    assert cli.upload.environments == [PREVIEW]
    assert cli.emitted["deployment_id"] == ""


def test_an_unreachable_pages_api_exits_unavailable(cli: Cli) -> None:
    """R17: a 429 is an outage, and an outage is not a negative answer.

    Same non-zero exit as a rejection would make a rate limit indistinguishable
    from tampering on the loudest channel the project has.
    """
    cli.client.fail_with = PagesUnavailable("Cloudflare could not answer: HTTP 429")

    assert cli.run() == EXIT_UNAVAILABLE

    assert EXIT_UNAVAILABLE != EXIT_REJECTED
    assert cli.upload.calls == []
    assert cli.emitted["outcome"] == "unavailable"


def test_a_rejecting_pages_api_exits_rejected(cli: Cli) -> None:
    """The other half of R17: Cloudflare answered, and the answer was no."""
    cli.client.configured_branch = "trunk"

    assert cli.run() == EXIT_REJECTED

    assert cli.upload.calls == []
    assert cli.emitted["outcome"] == "rejected"


def test_the_exit_codes_are_all_distinct() -> None:
    """Four situations, four codes. A collision silently merges two pages."""
    codes = [
        EXIT_DEPLOYED,
        EXIT_REJECTED,
        EXIT_UNAVAILABLE,
        EXIT_MISCONFIGURED,
        EXIT_UNCOMPENSATED,
    ]
    assert len(set(codes)) == len(codes)
    assert EXIT_DEPLOYED == 0


def test_an_unset_github_output_is_not_an_error(cli: Cli, monkeypatch) -> None:
    """Running outside Actions is a normal thing to do (an operator, a rehearsal)."""
    monkeypatch.delenv("GITHUB_OUTPUT")

    assert cli.run() == EXIT_DEPLOYED
    assert not cli.output.exists()


def test_the_outputs_are_appended_in_the_key_equals_value_form(cli: Cli) -> None:
    """The literal ``$GITHUB_OUTPUT`` contract, and appended rather than truncating.

    A step that wrote over the file would discard whatever an earlier step in
    the same job had already put there.
    """
    cli.output.write_text("earlier_step=kept\n", encoding="utf-8")

    assert cli.run() == EXIT_DEPLOYED

    lines = cli.output.read_text(encoding="utf-8").splitlines()
    assert lines[0] == "earlier_step=kept"
    assert "deployment_id=dep-production" in lines
    assert all("=" in line for line in lines)


# --- what the artifact says about itself, checked before any upload -----------


def test_an_inventory_that_is_not_the_tree_aborts_with_zero_uploads(
    cli: Cli, capsys
) -> None:
    """The sweep is scoped to the shipped inventory, so it has to BE the tree.

    A tree that gained, lost or changed a file after its inventory was rendered
    would be verified against the wrong list — every path in the list could pass
    while an added file served anything at all.
    """
    (cli.source / "assets" / "app.js").write_bytes(b"console.log(2)\n")

    assert cli.run() == EXIT_REJECTED

    assert "is not the inventory of" in capsys.readouterr().err
    assert cli.upload.calls == []
    assert cli.log == []
    assert cli.emitted["outcome"] == "rejected"


def test_the_expectations_come_from_the_built_tree(cli: Cli) -> None:
    """``build_id``/``code_sha``/``stats.json`` are read from the artifact itself.

    Not from a job input: the deploy job asks "is what is serving what we
    built", and an expectation supplied by the same caller that supplied the
    bytes makes that question circular. Tying the build id to an attested
    pointer is the signer's job, in another workflow under another identity.
    """
    expectations = artifact_expectations(cli.source, cli.inventory)

    assert expectations.build_id == BUILD_ID
    assert expectations.code_sha == CODE_SHA
    assert expectations.stats_bytes == SITE["stats.json"]
    assert expectations.inventory["dist_digest"] == dist_digest(cli.source)


@pytest.mark.parametrize(
    "index,reason",
    [
        (b"<!doctype html><p>no markers here</p>", "0 'populus:build_id'"),
        (
            b'<!doctype html><meta name="populus:build_id" content="20260805.1">'
            b'<meta name="populus:build_id" content="20260805.2">'
            b'<meta name="populus:code_sha" content="' + b"a" * 40 + b'">',
            "2 'populus:build_id'",
        ),
        (
            b'<!doctype html><meta name="populus:build_id" content="">'
            b'<meta name="populus:code_sha" content="' + b"a" * 40 + b'">',
            "empty 'populus:build_id'",
        ),
    ],
)
def test_a_tree_whose_markers_are_not_exactly_one_is_refused(
    cli: Cli, index: bytes, reason: str
) -> None:
    """Zero, two, or empty is not a value the served page can be compared to."""
    (cli.source / "index.html").write_bytes(index)
    cli.inventory.write_bytes(render_inventory(build_inventory(cli.source)))

    with pytest.raises(ArtifactRefused, match=re.escape(reason)):
        artifact_expectations(cli.source, cli.inventory)


def test_a_missing_source_or_inventory_is_refused(cli: Cli, tmp_path: Path) -> None:
    """Both halves of the §12.1 envelope, named separately when absent."""
    with pytest.raises(ArtifactRefused, match="is not a directory"):
        artifact_expectations(tmp_path / "nope", cli.inventory)
    with pytest.raises(ArtifactRefused, match="does not exist"):
        artifact_expectations(cli.source, tmp_path / "nope.json")


# --- the entry point wires the REAL production objects -----------------------


def test_the_default_uploader_is_the_wrangler_uploader(cli: Cli, monkeypatch) -> None:
    """Not a fake, and bound to the project name the environment supplied.

    ``main`` builds it only when the caller injects nothing, so this is the one
    place the production wiring itself is asserted.
    """
    built: dict[str, Any] = {}

    def _uploader(**kwargs: Any) -> FakeUploader:
        built.update(kwargs)
        return cli.upload

    monkeypatch.setattr("populus.deploy.upload.WranglerUploader", _uploader)
    # R8/LD9: the entry point resolves the LOCK-INSTALLED binary before it
    # builds the uploader. Stubbed here so the test does not depend on this
    # checkout's node_modules; the resolver's own refusal behavior is covered
    # in tests/test_deploy_upload.py.
    resolved = Path("/repo/dashboard/node_modules/.bin/wrangler")
    monkeypatch.setattr(
        "populus.deploy.upload.resolve_wrangler_executable", lambda: resolved
    )

    assert (
        main(
            cli.argv(),
            pages_factory=lambda: cli.client,
            readiness_factory=lambda: (lambda url, *, stage: None),
            verifier_factory=lambda: cli.verify,
            probe_factory=lambda: (lambda url: ANCHOR_IDENTITY),
            observer_factory=lambda: (lambda url: OBSERVATION),
            settle_factory=lambda: (lambda seconds: None),
        )
        == EXIT_DEPLOYED
    )
    assert built["project"] == PROJECT
    assert built["lookup"] is cli.client
    assert built["executable"] == resolved


def test_a_missing_lock_installed_wrangler_is_misconfiguration_before_any_call(
    cli: Cli, monkeypatch, tmp_path: Path, capsys
) -> None:
    """R8/LD9: no dashboard/node_modules/.bin/wrangler → refuse BEFORE anything.

    The working directory is an empty tree, so the resolver finds nothing.
    The exit is `misconfigured`, the message names the remediation (`npm ci`),
    and the provider log is empty — no upload, no verification, no read, and
    certainly no registry fetch.
    """
    monkeypatch.chdir(tmp_path)

    result = main(
        cli.argv(),
        pages_factory=lambda: cli.client,
        readiness_factory=lambda: (lambda url, *, stage: None),
        verifier_factory=lambda: cli.verify,
        probe_factory=lambda: (lambda url: ANCHOR_IDENTITY),
        settle_factory=lambda: (lambda seconds: None),
    )

    assert result == EXIT_MISCONFIGURED
    err = capsys.readouterr().err
    assert "wrangler" in err and "npm ci" in err
    assert cli.log == []
    assert cli.emitted["outcome"] == "misconfigured"


def test_the_default_verifier_is_bound_to_the_artifact(cli: Cli, monkeypatch) -> None:
    """The real ``DeploymentVerifier``, holding the tree's own expectations.

    The client comes from the injected factory, which is what keeps this test
    hermetic while still proving ``main`` constructs the production verifier
    rather than something that only looks like one.
    """
    built: dict[str, Any] = {}
    sentinel = object()

    def _verifier(**kwargs: Any) -> FakeVerifier:
        built.update(kwargs)
        return cli.verify

    monkeypatch.setattr("populus.deploy.upload.DeploymentVerifier", _verifier)

    assert (
        main(
            cli.argv(),
            pages_factory=lambda: cli.client,
            readiness_factory=lambda: (lambda url, *, stage: None),
            upload_factory=lambda: cli.upload,
            http_factory=lambda: sentinel,
            probe_factory=lambda: (lambda url: ANCHOR_IDENTITY),
            observer_factory=lambda: (lambda url: OBSERVATION),
            settle_factory=lambda: (lambda seconds: None),
        )
        == EXIT_DEPLOYED
    )
    assert built == {
        "client": sentinel,
        "build_id": BUILD_ID,
        "code_sha": CODE_SHA,
        "stats_bytes": SITE["stats.json"],
    }


def test_the_readiness_poller_never_sleeps_for_real_in_the_suite() -> None:
    """A slow suite is a suite people stop running.

    The readiness poller waits for a brand-new Pages origin to start routing
    (12 x 5s). Un-injected, two tests that drove `main()` for its production
    wiring paid the full backoff against a mocked 522 and this file took
    **19 minutes**. Every `main()` call here injects a no-op; this asserts the
    poller itself honours an injected sleep, so the next person to add a
    `main()` test has a fast default to reach for and a named reason.
    """
    from populus.deploy.upload import await_origin

    class _Dead:
        def get(self, url: str, **kwargs: Any) -> Any:
            return SimpleNamespace(status_code=522)

    slept: list[float] = []
    ready = await_origin(_Dead(), attempts=3, delay_seconds=5.0, sleep=slept.append)
    ready("https://example.invalid/", stage="preview")

    # Exhausts its attempts, sleeps BETWEEN them only, and never raises: a dead
    # origin is the sweep's verdict to render, not this helper's.
    assert slept == [5.0, 5.0]


# --- (7a) R11a: custom-domain propagation lag, and NOTHING else --------------
#
# Run 31752834344 promoted a good deployment, saw three `_astro/*.js` bundles
# answer 404 on the custom domain seconds later, and rolled it back. Probed
# afterwards those same three paths served 200 from that same deployment: the
# bytes were never missing, the edge had not finished resolving them. The cost
# was a 2h13m ingest thrown away. These tests pin the narrow tolerance that
# absorbs it — and, more importantly, every shape it must NOT absorb.


def _rejected(*divergences: Divergence, extra_findings: tuple[str, ...] = ()) -> VerificationResult:
    """A rejection carrying real divergences, the way the real verifier builds one."""
    findings = tuple(str(d) for d in divergences) + extra_findings
    return VerificationResult(
        ok=False,
        outcome=REJECTED,
        detail=f"expected_paths: {len(findings)} finding(s)",
        files_verified=4 - len(divergences),
        files_total=4,
        divergences=divergences,
        findings=findings,
    )


def _lag(*paths: str) -> VerificationResult:
    return _rejected(*(Divergence(p, PROPAGATION_REASON) for p in paths))


class RecordingSettle:
    def __init__(self) -> None:
        self.waits: list[float] = []

    def __call__(self, seconds: float) -> None:
        self.waits.append(seconds)


def test_a_propagation_404_settles_and_the_full_inventory_is_reverified(
    harness: Harness,
) -> None:
    """The production leg of run 31752834344, replayed with the fix in place."""
    harness.with_verifier(plan=[True, _lag("_astro/a.js", "_astro/b.js"), True])
    settle = RecordingSettle()

    outcome = harness.run(settle=settle)

    # R11b's pre-sweep settle, then R11a's retry settle — in that order.
    assert settle.waits == [POST_PROMOTION_SETTLE_SECONDS, PROPAGATION_SETTLE_SECONDS]
    assert harness.client.rollbacks == [], "a good deployment must not be rolled back"
    # Three verifications: preview, the lagging production pass, the re-verify.
    assert harness.verify.stages == [PREVIEW, PRODUCTION, PRODUCTION]
    # The retry is the SAME inventory-wide check, not a spot-check of the 404s.
    assert harness.verify.calls[2].inventory == harness.verify.calls[1].inventory
    assert outcome.production_verification.ok


def test_the_propagation_retry_is_bounded_and_then_rolls_back(
    harness: Harness,
) -> None:
    """A deployment that is genuinely missing files still fails — one wait, no loop."""
    harness.with_verifier(plan=[True, _lag("_astro/a.js"), _lag("_astro/a.js")])
    settle = RecordingSettle()

    with pytest.raises(ProductionVerificationFailed) as raised:
        harness.run(settle=settle)

    # One pre-sweep settle plus exactly PROPAGATION_RETRIES retry settles.
    assert len(settle.waits) == 1 + PROPAGATION_RETRIES
    assert harness.client.rollbacks == [PRIOR]
    assert raised.value.rolled_back_to == PRIOR


@pytest.mark.parametrize(
    "result, why",
    [
        (
            _rejected(Divergence("index.html", "sha256 aaa != bbb")),
            "a digest divergence is tampering, not latency",
        ),
        (
            _rejected(Divergence("_astro/a.js", "HTTP 403, expected 200")),
            "403 does not become 200 by waiting",
        ),
        (
            _rejected(Divergence("_astro/a.js", "HTTP 500, expected 200")),
            "a 5xx is not a propagation lag",
        ),
        (
            _rejected(
                Divergence("_astro/a.js", PROPAGATION_REASON),
                extra_findings=("marker 'populus:code_sha' mismatch: served 'x' != expected 'y'",),
            ),
            "a marker mismatch alongside a 404 is the WRONG DEPLOYMENT serving",
        ),
        (
            _rejected(
                Divergence("_astro/a.js", PROPAGATION_REASON),
                extra_findings=("stats.json is not byte-equal to the built copy",),
            ),
            "a stats.json difference is a finding with no divergence behind it",
        ),
    ],
)
def test_only_a_pure_404_rejection_is_ever_settled(
    harness: Harness, result: VerificationResult, why: str
) -> None:
    """Everything else rolls back immediately, with no wait at all."""
    harness.with_verifier(plan=[True, result])
    settle = RecordingSettle()

    with pytest.raises(ProductionVerificationFailed):
        harness.run(settle=settle)

    assert settle.waits == [POST_PROMOTION_SETTLE_SECONDS], why
    assert harness.client.rollbacks == [PRIOR]
    # Preview and the rejected production pass — no retry of the production
    # check itself, and (LD12a) NO third verify: restoration is judged against
    # the captured expectation, never the attempted inventory.
    assert harness.verify.stages == [PREVIEW, PRODUCTION]


def test_an_unavailable_production_verification_is_never_settled(
    harness: Harness,
) -> None:
    """R17: 'could not ask' is not a rejection, and must not enter the retry."""
    harness.with_verifier(plan=[True, "unavailable"])
    settle = RecordingSettle()

    with pytest.raises(ProductionVerificationFailed):
        harness.run(settle=settle)

    assert settle.waits == [POST_PROMOTION_SETTLE_SECONDS]


def test_the_predicate_refuses_a_rejection_carrying_no_divergences() -> None:
    """A findings-only rejection (markers, stats, headers) has nothing to wait for.

    Guards the default `VerificationResult` shape the rest of this suite uses:
    if an empty `divergences` tuple ever counted as 'all reasons are 404', every
    existing rejection test would silently start settling.
    """
    assert not _propagation_lag_only(
        VerificationResult(ok=False, outcome=REJECTED, detail="x", findings=("m",))
    )
    assert not _propagation_lag_only(
        VerificationResult(ok=False, outcome=REJECTED, detail="x")
    )


# --- R11a remediation: review round 3 blockers F1, F2, F3 --------------------


def test_an_unavailable_outcome_carrying_404_divergences_still_fails_closed(
    harness: Harness,
) -> None:
    """Review F1: the outcome is CHECKED, not reasoned about.

    `verify_deployment` returns UNAVAILABLE early with no divergences, so today
    this state cannot arise — which is precisely why the predicate must not
    depend on that remaining true in another module. A contradictory result
    (R17 'no verdict reached' carrying propagation-shaped divergences) is the
    fail-closed case.
    """
    contradictory = VerificationResult(
        ok=False,
        outcome=UNAVAILABLE,
        detail="verification unavailable: HTTP 429",
        divergences=(Divergence("_astro/a.js", PROPAGATION_REASON),),
        findings=(f"_astro/a.js: {PROPAGATION_REASON}",),
    )
    assert not _propagation_lag_only(contradictory)

    harness.with_verifier(plan=[True, contradictory])
    settle = RecordingSettle()
    with pytest.raises(ProductionVerificationFailed):
        harness.run(settle=settle)
    assert settle.waits == [POST_PROMOTION_SETTLE_SECONDS], (
        "an unavailable verdict must never trigger the RETRY settle"
    )
    assert harness.client.rollbacks == [PRIOR]


def test_the_retry_announces_each_attempt_with_its_lagging_paths(
    harness: Harness, capsys: pytest.CaptureFixture[str]
) -> None:
    """Review F3: the operator signal is a requirement, so it is asserted.

    Without this, deleting the message — or dropping the paths, the settle
    duration or the attempt counter from it — leaves the suite green while an
    operator loses the only explanation for why a rollback was delayed.
    """
    harness.with_verifier(plan=[True, _lag("_astro/a.js", "_astro/b.js"), True])
    harness.run(settle=RecordingSettle())

    err = capsys.readouterr().err
    assert "_astro/a.js" in err and "_astro/b.js" in err
    assert "2 path(s)" in err
    assert f"settling {PROPAGATION_SETTLE_SECONDS:g}s" in err
    assert "re-verifying the full inventory" in err
    assert f"attempt 1/{PROPAGATION_RETRIES}" in err


def test_main_injects_the_settle_seam_and_never_really_sleeps(cli: Cli) -> None:
    """Review F2: the CLI wiring itself, not only `run_deployment`.

    `publish.yml` runs this module as a process, so `main`'s `settle_factory`
    hop is the seam that actually executes in production. Removing it would
    leave every other R11a test green while the deploy either lost the wait or
    slept for real inside the suite.
    """
    cli.verify = FakeVerifier(cli.log, plan=[True, _lag("_astro/a.js"), True])
    settle = RecordingSettle()

    code = cli.run(verifier_factory=lambda: cli.verify, settle_factory=lambda: settle)

    assert code == EXIT_DEPLOYED
    assert settle.waits == [POST_PROMOTION_SETTLE_SECONDS, PROPAGATION_SETTLE_SECONDS]
    assert cli.emitted.get("outcome") == OUTCOME_DEPLOYED
    assert cli.client.rollbacks == []


# --- R11b: settle BEFORE the first production sweep --------------------------
#
# Run 31774209281 promoted a good build; seconds later three
# `congress/data/tickers/*.v1.json` shards served TRUNCATED bodies —
# `AAXJ.v1.json` came back 571 bytes against an expected 835, a length the
# previous deployment does not have either, so it was a partial object rather
# than a stale one. R11a cannot absorb that and must not: a body-hash mismatch
# is indistinguishable from tampering. The wait therefore has to happen BEFORE
# the question is asked.


def test_the_domain_settles_before_the_first_production_sweep(
    harness: Harness,
) -> None:
    """The settle precedes the first production verify, on a run that PASSES.

    Ordering is the whole point: a wait that happens after the sweep, or only on
    failure, leaves the truncated-body window wide open.
    """
    order: list[str] = []
    harness.with_verifier(plan=[True, True])

    def recording_verify(base_url, *, stage, inventory, deployment):
        order.append(f"verify:{stage}")
        return harness.verify(
            base_url, stage=stage, inventory=inventory, deployment=deployment
        )

    def recording_settle(seconds: float) -> None:
        order.append(f"settle:{seconds:g}")

    harness.run(verify=recording_verify, settle=recording_settle)

    assert order == [
        f"verify:{PREVIEW}",
        f"settle:{POST_PROMOTION_SETTLE_SECONDS:g}",
        f"verify:{PRODUCTION}",
    ]


def test_the_pre_sweep_settle_happens_even_when_everything_passes(
    harness: Harness,
) -> None:
    """Unconditional: it is not a failure handler, so a green run pays it too."""
    settle = RecordingSettle()
    harness.run(settle=settle)
    assert settle.waits == [POST_PROMOTION_SETTLE_SECONDS]


def test_a_truncated_body_is_never_waited_out(harness: Harness) -> None:
    """The exact production finding: served 571 bytes against an expected 835.

    It must roll back on the first look — one pre-sweep settle, no retry settle.
    Widening R11a to cover this shape is the tempting wrong fix, and this is the
    test that refuses it.
    """
    truncated = _rejected(
        Divergence(
            "congress/data/tickers/AAXJ.v1.json",
            "sha256 9a25d7ff00756232 != aa06ca30e2f0f191; length 571 != 835",
        )
    )
    harness.with_verifier(plan=[True, truncated])
    settle = RecordingSettle()

    with pytest.raises(ProductionVerificationFailed):
        harness.run(settle=settle)

    assert settle.waits == [POST_PROMOTION_SETTLE_SECONDS], "no RETRY settle"
    assert harness.client.rollbacks == [PRIOR]


# --- R11c: the rollback anchor must be the deployment actually serving -------


def test_an_anchor_that_is_not_serving_aborts_before_any_upload(
    harness: Harness,
) -> None:
    """Run 31774209281's second defect, replayed.

    Production had been rolled back by hand to one deployment while a newer one
    existed; the job anchored on the newer and later 'rolled back' to it. With
    NO candidate serving what the domain serves, there is no anchor to resolve
    and the refusal must land BEFORE the freeze so production is untouched.
    """
    def disagreeing(url: str):
        return _identity("d823597b") if "publicfilings.org" in url else _identity("7967b560")

    with pytest.raises(RollbackAnchorUnverified) as raised:
        harness.run(serving_probe=disagreeing)

    assert "d823597b" in str(raised.value)
    assert harness.upload.calls == [], "nothing may be uploaded"
    assert harness.client.rollbacks == [], "nothing may be rolled back"
    assert harness.sealed_dirs == [], "the tree must not even be frozen"


def test_the_anchor_resolves_to_the_serving_deployment_not_the_newest(
    harness: Harness,
) -> None:
    """R11d — run 31866841710, the deadlock R11c's refusal left behind.

    A provider-side rollback is the documented escape hatch, and it makes
    'newest by creation' and 'currently serving' different deployments *by
    design*. Refusing on that divergence (R11c) protected production but left
    every subsequent deploy blocked until someone deleted deployment history.

    Here `dep-newest` is newest and `dep-serving` is what the domain answers
    with. The anchor must be `dep-serving`, and a later verification failure
    must compensate onto THAT — restoring the site people are actually looking
    at, not the newest build nobody promoted.
    """
    harness.client.production_ids = ("dep-newest", "dep-serving", "dep-older")

    def probe(url: str):
        if "publicfilings.org" in url:
            return ANCHOR_IDENTITY     # the domain, after a dashboard rollback
        if "dep-serving" in url:
            return ANCHOR_IDENTITY     # the deployment that actually serves it
        return _identity("4fd29878")   # newest-by-creation, never promoted

    outcome = harness.run(serving_probe=probe)

    assert outcome.rollback_target == "dep-serving", (
        "the anchor must be the deployment the domain serves, not the newest"
    )
    assert harness.upload.calls != [], "the deploy must now proceed, not deadlock"


def test_the_anchor_search_stops_at_the_first_match(harness: Harness) -> None:
    """The common case — nothing rolled back — never walks past the newest.

    Without this, a project with a long deployment history would pay a request
    per deployment on every deploy, and the bound would be the only thing
    keeping that finite.

    The winner is probed THREE times by design: once to resolve it, once by
    `_assert_anchor_is_serving`, which re-reads rather than trusting the value
    the resolver already has, and once inside the rollback-evidence bracket to
    bind the observation to the target (F2). Each re-reads rather than trusting
    an earlier value, which is what makes each proof independent of the thing it
    is proving, so this is asserted here rather than optimised away.
    """
    harness.client.production_ids = (PRIOR, "dep-older", "dep-oldest")
    probed: list[str] = []

    def probe(url: str):
        probed.append(url)
        return ANCHOR_IDENTITY

    harness.run(serving_probe=probe)
    candidates = [u for u in probed if "publicfilings.org" not in u]
    assert all(PRIOR in u for u in candidates), (
        f"the search walked past the first match: {candidates}"
    )
    assert len(candidates) == 3, (
        "resolve, prove, then bind the observation — each independently"
    )


@pytest.mark.parametrize(
    "probe, why",
    [
        (lambda url: None, "neither side readable"),
        (
            lambda url: None if "publicfilings.org" in url else _identity("7967b560"),
            "the live domain unreadable",
        ),
        (
            lambda url: _identity("d823597b") if "publicfilings.org" in url else None,
            "the anchor unreadable",
        ),
    ],
)
def test_an_unreadable_anchor_also_aborts(harness: Harness, probe, why: str) -> None:
    """'Could not ask' is not 'they agree'. Refusing here is free."""
    with pytest.raises(RollbackAnchorUnverified):
        harness.run(serving_probe=probe)
    assert harness.upload.calls == [], why


def test_an_agreeing_anchor_proceeds_normally(harness: Harness) -> None:
    """The check must not become a blanket refusal."""
    outcome = harness.run(serving_probe=lambda url: ANCHOR_IDENTITY)
    assert outcome.rollback_target == PRIOR
    assert harness.upload.environments == [PREVIEW, PRODUCTION]


def test_the_first_run_never_probes_because_there_is_no_anchor(
    harness: Harness,
) -> None:
    """TD-4: no prior deployment means nothing to cross-check, not a refusal."""
    harness.client.latest_id = None
    probed: list[str] = []

    def counting(url: str):
        probed.append(url)
        return ANCHOR_IDENTITY

    harness.run(serving_probe=counting)
    assert probed == [], "with no anchor there is no question to ask"


# --- R12/LD12a/LD12c: rollback evidence, captured before anything moves ------


def _no_uploads(harness: Harness) -> None:
    """ZERO snapshot/upload/provider-mutation calls — the LD12c order property."""
    assert harness.upload.calls == []
    assert harness.client.rollbacks == []
    assert harness.sealed_dirs == [], "freeze_tree ran before the capture refusal"


def test_capture_failure_aborts_with_zero_snapshot_upload_or_mutation(
    harness: Harness,
) -> None:
    """The observation cannot be taken → DeployAborted, production untouched."""

    def failing_observer(url: str) -> RollbackSiteObservation:
        raise DeployAborted("the rollback observation requires HTTP 200; got 503")

    with pytest.raises(DeployAborted, match="HTTP 200"):
        harness.run(observer=failing_observer)

    _no_uploads(harness)


def test_a_concurrent_provider_change_during_capture_aborts_pre_freeze(
    harness: Harness,
) -> None:
    """LD12c: the bracketing raw reads must agree on the first entry."""
    harness.client.raw_lists = [
        [_raw_deployment(PRIOR)],
        [_raw_deployment("dep-raced"), _raw_deployment(PRIOR)],
    ]

    with pytest.raises(DeployAborted, match="changed while the rollback expectation"):
        harness.run()

    _no_uploads(harness)


def test_an_emptied_raw_listing_after_the_observation_aborts(harness: Harness) -> None:
    harness.client.raw_lists = [[_raw_deployment(PRIOR)], []]

    with pytest.raises(DeployAborted, match="empty after the observation"):
        harness.run()

    _no_uploads(harness)


@pytest.mark.parametrize(
    "entry, match",
    [
        ({"environment": "production", "uses_functions": False}, "carries no id"),
        (
            {"id": PRIOR, "environment": "preview", "uses_functions": False},
            "environment 'preview'",
        ),
        ({"id": PRIOR, "environment": "production"}, "uses_functions"),
        (
            {"id": PRIOR, "environment": "production", "uses_functions": True},
            "uses_functions",
        ),
    ],
    ids=["no-id", "wrong-environment", "missing-uses-functions", "true-uses-functions"],
)
def test_a_malformed_raw_prior_deployment_aborts_pre_freeze(
    harness: Harness, entry: dict, match: str
) -> None:
    """LD12c reads the RAW mapping: absence never launders into False."""
    harness.client.raw_lists = [[entry], [entry]]

    with pytest.raises(DeployAborted, match=match):
        harness.run()

    _no_uploads(harness)


def test_the_capture_uses_the_serving_anchors_raw_entry_not_newest_by_creation(
    harness: Harness,
) -> None:
    """R11d reconciliation: after a provider-side rollback the serving anchor is
    NOT the newest-by-creation deployment, and the expectation must name the
    anchor — the deployment a compensating rollback would actually restore."""
    newest = "dep-failed-earlier"
    harness.client.production_ids = (newest, PRIOR)

    # The domain serves ANCHOR_SHA; the newest deployment serves something else,
    # so the anchor resolver lands on PRIOR.
    def probe(url: str):
        if newest in url:
            return _identity("f" * 40)
        return ANCHOR_IDENTITY

    harness.with_verifier(plan=[True, False])
    with pytest.raises(ProductionVerificationFailed) as raised:
        harness.run(serving_probe=probe)

    assert raised.value.rolled_back_to == PRIOR
    assert harness.client.rollbacks == [PRIOR]


# --- F1/F2: the serving anchor is a BUILD, and the observation is bound to it


def test_the_anchor_is_resolved_by_build_id_not_by_code_sha_alone(
    harness: Harness,
) -> None:
    """F1: one commit, two data builds — `code_sha` cannot tell them apart.

    `dep-newest` and `dep-serving` were cut from the SAME commit against
    DIFFERENT data builds, so they carry one `code_sha` and two `build_id`s,
    and they serve different bodies. A resolver that compares only `code_sha`
    matches `dep-newest` first (newest by creation) and anchors there — the
    wrong-build restore the serving anchor exists to prevent. Comparing the
    full identity lands on `dep-serving`, which is what the domain answers
    with, and the compensating rollback then restores the site people are
    actually looking at.
    """
    harness.client.production_ids = ("dep-newest", "dep-serving", "dep-older")
    shared_sha = "9" * 40
    serving = _identity(shared_sha, build_id="20260826.2")
    newest = _identity(shared_sha, build_id="20260827.1")  # same commit, new data

    def probe(url: str):
        if "publicfilings.org" in url:
            return serving
        if "dep-serving" in url:
            return serving
        return newest

    served = RollbackSiteObservation(
        body_sha256="d" * 64,
        body_length=999,
        build_id=serving.build_id,
        code_sha=serving.code_sha,
        headers=OBSERVATION.headers,
    )
    harness.with_verifier(plan=[True, False])

    with pytest.raises(ProductionVerificationFailed) as raised:
        harness.run(serving_probe=probe, observer=lambda url: served)

    assert raised.value.rolled_back_to == "dep-serving", (
        "code_sha alone matched dep-newest first; only build_id separates them"
    )
    assert harness.client.rollbacks == ["dep-serving"]


def test_a_build_id_only_divergence_aborts_rather_than_picking_one(
    harness: Harness,
) -> None:
    """F1, the other half: no candidate serves the domain's BUILD.

    Every deployment answers with the domain's `code_sha`, so a code-only
    comparison accepts the first one it walks — silently, and wrongly. With
    `build_id` in the comparison nothing matches, and the resolver refuses
    before the freeze instead of choosing.
    """
    harness.client.production_ids = ("dep-newest", "dep-older")
    shared_sha = "9" * 40

    def probe(url: str):
        if "publicfilings.org" in url:
            return _identity(shared_sha, build_id="20260826.2")
        return _identity(shared_sha, build_id="20260827.1")

    with pytest.raises(RollbackAnchorUnverified) as raised:
        harness.run(serving_probe=probe)

    assert "no production deployment serves" in str(raised.value)
    _no_uploads(harness)


def test_a_deploy_landing_before_the_first_raw_read_aborts_pre_freeze(
    harness: Harness,
) -> None:
    """F2: the bracket must bind the observation to the target, not just the head.

    A deploy that lands AFTER the anchor proof but BEFORE the capture's first
    raw read leaves both raw reads identical — the head/target stability check
    sees nothing. The domain, however, is now serving the new build, so the
    expectation would pair the OLD rollback target with the NEW deployment's
    body and markers, and every later rollback would fail restoration
    verification. Binding the observation to the anchor by identity catches it.

    The race is modelled where it happens: the observer is the first thing the
    capture calls after its raw read, and here it answers with the new build's
    markers, exactly as the live domain would.
    """
    landed = RollbackSiteObservation(
        body_sha256="b" * 64,
        body_length=4321,
        build_id="20260827.9",  # the deploy that landed; the anchor is 20260801.1
        code_sha=ANCHOR_SHA,
        headers=OBSERVATION.headers,
    )
    probes: list[str] = []

    def probe(url: str):
        probes.append(url)
        return ANCHOR_IDENTITY

    with pytest.raises(DeployAborted) as raised:
        harness.run(serving_probe=probe, observer=lambda url: landed)

    assert "not the serving anchor's" in str(raised.value)
    assert "20260827.9" in str(raised.value)
    _no_uploads(harness)
    assert ("raw-list", "production") in harness.log, (
        "the abort must land INSIDE the capture, not before it"
    )
    assert probes, "the binding probe must actually have been asked"


def test_a_provider_rollback_landing_after_the_observation_aborts_pre_freeze(
    harness: Harness,
) -> None:
    """F1: the closing side of the bracket must look at the DOMAIN, not the anchor.

    A provider-side rollback that lands AFTER the domain observation repoints
    the custom domain at an older deployment. It creates nothing, so the
    newest-by-creation raw listing is byte-identical across both reads; and a
    per-deployment anchor URL is immutable, so the anchor still serves its own
    build and the F2 identity binding still agrees. Every pre-fix check passes,
    while the captured expectation now names a deployment the domain is no
    longer serving — a later failure would compensate to the wrong build.

    Only a second look at the live domain sees it.
    """
    older = "dep-older"
    older_identity = _identity(build_id="20260701.1")
    harness.client.production_ids = (PRIOR, older)
    rolled_back = False

    def observer(url: str) -> RollbackSiteObservation:
        nonlocal rolled_back
        rolled_back = True  # the provider rollback lands right here
        return OBSERVATION

    probes: list[str] = []

    def probe(url: str):
        probes.append(url)
        if url == DOMAIN_URL:
            return older_identity if rolled_back else ANCHOR_IDENTITY
        return ANCHOR_IDENTITY if PRIOR in url else older_identity

    with pytest.raises(DeployAborted) as raised:
        harness.run(serving_probe=probe, observer=observer)

    message = str(raised.value)
    assert "the live domain changed" in message
    assert "20260701.1" in message
    _no_uploads(harness)
    assert ("raw-list", "production") in harness.log, (
        "the abort must land INSIDE the capture, not before it"
    )
    assert probes.count(DOMAIN_URL) >= 2, (
        "the bracket must re-read the DOMAIN; the anchor URL is immutable and "
        "cannot reveal that the domain moved"
    )


def test_capture_rollback_expectation_returns_none_on_an_empty_listing(
    harness: Harness,
) -> None:
    """An empty raw production listing is the existing first-run case."""
    harness.client.production_ids = ()
    result = capture_rollback_expectation(
        harness.client, lambda url: OBSERVATION, DOMAIN_URL
    )
    assert result is None


def test_the_expectation_carries_the_raw_identity_and_the_one_observation(
    harness: Harness,
) -> None:
    expectation = capture_rollback_expectation(
        harness.client,
        lambda url: OBSERVATION,
        DOMAIN_URL,
        anchor=_deployment(PRIOR),
        probe=lambda url: ANCHOR_IDENTITY,
    )
    assert expectation == RollbackExpectation(
        deployment_id=PRIOR,
        environment="production",
        uses_functions=False,
        observation=OBSERVATION,
    )


def test_a_v1_prior_site_rolls_back_by_observation_not_inventory(
    harness: Harness,
) -> None:
    """LD12a: first v2 failure rolling back to an OBSERVED v1 site.

    A pre-v2 deployment serves no security headers — the observation's header
    multimap is explicit absence — and no v1 inventory exists or is parsed.
    Restoration equality is over the observation, so the v1 site restores
    cleanly; TD-PSH-8 (no prior-tree inventory proof) is the declared limit.
    """
    v1_observation = RollbackSiteObservation(
        body_sha256="e" * 64,
        body_length=512,
        build_id="20260701.1",
        code_sha=ANCHOR_SHA,
        headers=(
            ("content-security-policy", ()),
            ("referrer-policy", ()),
            ("strict-transport-security", ()),
            ("x-content-type-options", ()),
        ),
    )
    harness.with_verifier(plan=[True, False])

    with pytest.raises(ProductionVerificationFailed) as raised:
        harness.run(
            observer=lambda url: v1_observation,
            # F2 binds the observation to the anchor by identity, so the v1
            # site's own build_id is what both must answer with.
            serving_probe=lambda url: _identity(build_id="20260701.1"),
        )

    assert raised.value.rollback_verified is True
    assert "matches the pre-upload expectation" in str(raised.value)


def test_a_v2_to_v2_rollback_restores_the_captured_headers_exactly(
    harness: Harness,
) -> None:
    """v2→v2: the prior site carried the policy; a restore that loses one
    header is NOT restored."""
    lost_header = RollbackSiteObservation(
        body_sha256=OBSERVATION.body_sha256,
        body_length=OBSERVATION.body_length,
        build_id=OBSERVATION.build_id,
        code_sha=OBSERVATION.code_sha,
        headers=tuple(
            (name, () if name == "strict-transport-security" else values)
            for name, values in OBSERVATION.headers
        ),
    )
    answers = [OBSERVATION, lost_header]
    harness.with_verifier(plan=[True, False])

    with pytest.raises(ProductionVerificationFailed) as raised:
        harness.run(observer=lambda url: answers.pop(0))

    assert raised.value.rollback_verified is False
    assert "headers" in str(raised.value)


def test_a_wrong_raw_rollback_response_keeps_rollback_unverified(
    harness: Harness,
) -> None:
    """The raw rollback result must name the captured id/production."""

    def wrong_rollback(deployment_id: str) -> dict:
        harness.client.rollbacks.append(deployment_id)
        return _raw_deployment("dep-somebody-else")

    harness.client.rollback_payload = wrong_rollback
    harness.with_verifier(plan=[True, False])

    with pytest.raises(ProductionVerificationFailed) as raised:
        harness.run()

    assert raised.value.rollback_verified is False
    assert "not the captured target" in str(raised.value)


# --- PR #35 classifier: header/control findings never settle -----------------


@pytest.mark.parametrize(
    "extra, why",
    [
        (
            "missing required response header on index.html: "
            "content-security-policy — the deployment is not carrying the "
            "policy it was built with",
            "a LOST control never settles",
        ),
        (
            "content-security-policy on index.html does not equal the locked "
            "policy: observed \"default-src *\"",
            "a WEAKENED control never settles",
        ),
        (
            "content-security-policy on index.html appears 2 times; a "
            "duplicated/conflicting policy header is refused, never collapsed",
            "a DUPLICATED control never settles",
        ),
        (
            "control-path probe /_headers answered HTTP 200, expected 404 — the "
            "deployment is serving or acting on a provider control file",
            "a SERVED control file never settles",
        ),
    ],
    ids=["missing-header", "weakened-header", "duplicated-header", "served-control"],
)
def test_a_header_or_control_finding_never_qualifies_for_the_settle(
    harness: Harness, extra: str, why: str
) -> None:
    """R12/Task 10.4: header/control findings always have findings beyond
    divergences, so the counts diverge and the classifier refuses — the
    deployment rolls back at once, with no retry settle."""
    result = _rejected(
        Divergence("_astro/a.js", PROPAGATION_REASON), extra_findings=(extra,)
    )
    assert not _propagation_lag_only(result), why

    harness.with_verifier(plan=[True, result])
    settle = RecordingSettle()
    with pytest.raises(ProductionVerificationFailed):
        harness.run(settle=settle)

    assert settle.waits == [POST_PROMOTION_SETTLE_SECONDS], why
    assert harness.client.rollbacks == [PRIOR]
    assert harness.verify.stages == [PREVIEW, PRODUCTION]


def test_a_pure_v2_file_404_result_still_gets_exactly_one_full_retry(
    harness: Harness,
) -> None:
    """The other half of the mutation pair: v2 changed nothing about the one
    settle a pure inventoried-file-404 rejection is entitled to."""
    harness.with_verifier(plan=[True, _lag("congress/data/feed.v1.json"), True])
    settle = RecordingSettle()

    outcome = harness.run(settle=settle)

    assert settle.waits == [POST_PROMOTION_SETTLE_SECONDS, PROPAGATION_SETTLE_SECONDS]
    assert harness.client.rollbacks == []
    assert harness.verify.stages == [PREVIEW, PRODUCTION, PRODUCTION]
    assert outcome.production_verification.ok
