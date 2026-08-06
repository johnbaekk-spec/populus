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
from typing import Any, Callable

import pytest

from populus.deploy import cloudflare, orchestrator
from populus.deploy.cloudflare import (
    ALLOWED_METHODS,
    CustomDomain,
    Deployment,
    PagesClient,
    PagesRejected,
)
from populus.deploy.orchestrator import (
    PREVIEW,
    PRODUCTION,
    RUNBOOK,
    DeployAborted,
    DeployOutcome,
    FirstRunUncompensated,
    PreviewVerificationFailed,
    ProductionVerificationFailed,
    UploadedDeployment,
    run_deployment,
)
from populus.deploy.verify import VerificationResult
from populus.publish.attestation import REJECTED, UNAVAILABLE, VERIFIED
from populus.publish.digests import dist_digest

DOMAIN = "publicfilings.org"
DOMAIN_URL = "https://publicfilings.org"
BRANCH = "main"
PREVIEW_URL = "https://preview.publicfilings.pages.dev"
PRIOR = "dep-prior"

SITE = {
    "index.html": (
        b'<!doctype html><meta name="populus:build_id" content="20260805.1">'
        b'<meta name="populus:code_sha" content="' + b"a" * 40 + b'">'
    ),
    "assets/app.js": b"console.log(1)\n",
    "assets/app.css": b"body{}\n",
    "stats.json": b'{"stats_version":"stats-1.0.0"}\n',
}


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
    ) -> None:
        self.__dict__["unexpected_attributes"] = []
        self._log = log
        self.configured_branch = production_branch
        self.active_domains = set(active_domains)
        self.latest_id = latest_id
        self.rollbacks: list[str] = []

    def assert_production_branch(self, expected: str) -> str:
        self._log.append(("assert-branch", expected))
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

    def rollback(self, deployment_id: str) -> Deployment:
        self._log.append(("rollback", deployment_id))
        self.rollbacks.append(deployment_id)
        return _deployment(deployment_id)

    def __getattr__(self, name: str) -> Any:
        if name.startswith("__"):
            raise AttributeError(name)
        self.__dict__.setdefault("unexpected_attributes", []).append(name)
        raise AttributeError(
            f"FakePages exposes only the four pinned calls; something reached "
            f"for {name!r}"
        )


def _deployment(identifier: str) -> Deployment:
    return Deployment(
        id=identifier,
        environment="production",
        url=f"https://{identifier}.publicfilings.pages.dev",
        uses_functions=False,
    )


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


def test_the_rollback_is_reverified_on_the_custom_domain(harness: Harness) -> None:
    """Ordering mutant (a2): roll back but skip the re-verification.

    A rollback that is not re-verified is a hope. The third verification runs
    against the live custom domain, *after* the rollback call, and its verdict
    is carried on the exception.
    """
    harness.with_verifier(plan=[True, False, True])

    with pytest.raises(ProductionVerificationFailed) as raised:
        harness.run()

    assert harness.log[-2:] == [
        ("rollback", PRIOR),
        ("verify", PRODUCTION, DOMAIN_URL),
    ]
    assert harness.verify.calls[-1].deployment["id"] == PRIOR
    assert raised.value.rollback_verified is True
    assert "the restored deployment verified" in str(raised.value)


def test_a_rollback_that_does_not_verify_says_so(harness: Harness) -> None:
    """The re-verification is a real check, not a formality.

    If it were ignored, both verdicts would produce the same message and the
    ``rollback_verified`` attribute would be decorative.
    """
    harness.with_verifier(plan=[True, False, False])

    with pytest.raises(ProductionVerificationFailed) as raised:
        harness.run()

    assert raised.value.rollback_verified is False
    assert "did NOT verify" in str(raised.value)


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


def test_the_module_calls_exactly_one_cloudflare_surface(harness: Harness) -> None:
    """The sequence is composed, not reimplemented.

    The orchestrator owns the *order*; the endpoint pinning lives in
    ``cloudflare`` and the sweep lives in ``verify``. If this module grew its own
    HTTP call the injection story — and the hermetic suite — would be over.
    """
    source = inspect.getsource(orchestrator)
    assert "httpx" not in source
    assert cloudflare.API_HOST not in source
