"""§12.1 R12: the ordered deploy sequence, in one injected, testable function.

The order is the mechanism. Every step below is safe only because the steps
before it already ran, so spreading this sequence across workflow YAML would put
the actual security property in a place no test can reach. It lives here instead,
in :func:`run_deployment`, with the Pages client, the uploader and the verifier
all injected — the suite exercises the real ordering with no network at all
(``tests/conftest.py`` blocks sockets).

The eight steps, and what each one is load-bearing for:

1. **Assert the production branch (R8) — before any upload.** A mismatch means
   the bytes would land under an identity the workflow does not claim. Asserted
   first because after an upload the question is academic.
2. **Assert the custom domain is ``active`` (R11) — before any upload.**
   Activation is a provisioning precondition (Rollout prerequisite 4), not
   something this run polls for. Read from the ``…/domains`` subresource, which
   is the only endpoint carrying per-domain status.
3. **Capture the current production deployment id.** This is the rollback
   target, and it must be read *before* the production upload — afterwards the
   newest production deployment is the one that just failed verification, and
   "rolling back" to it would be a no-op dressed as a compensation. ``None`` is
   a real answer (R14), not an error.
4. **Freeze the built tree** (R4): from here on the uploader is handed a sealed
   private copy, so hashed bytes and uploaded bytes are one thing.
5. **Upload to a preview and verify it INVENTORY-WIDE (R9).** §12.1 step 4 is
   amended to require the same full sweep the signer runs, not markers plus a
   ``stats.json`` hash. This is not a nicety: TD-4 accepts one unverified-serving
   window on the strength of "the identical bytes already passed the preview
   sweep", and if the preview only read markers that sentence is vacuous.
6. **Upload the same sealed bytes to production (R10)**, re-checking
   ``dist_digest`` immediately before. The preview verified a specific tree; the
   production upload must be that tree and not a successor of it.
7. **Verify the live custom domain (R11)** — always, no exemption, no polling.
   The preview origin and the custom domain differ only in base URL, so both go
   through one verifier.
8. **On failure at 7: roll back to the captured deployment and re-verify.**

**TD-4 / R14 — the first run.** When step 3 captured nothing there is no rollback
target, and Cloudflare **refuses to delete an active production deployment**
("this will not delete the active production deployment if one exists"). So there
is **no automated compensation**, and this module does not invent one: there is no
delete call here, and :mod:`populus.deploy.cloudflare` deliberately exposes no
delete method to call. The run raises with the remediation pointer instead. That
exposure exists exactly once — after the first successful deploy every run has a
rollback target and TD-4 is gone permanently.

A verification that could not reach a verdict (``unavailable``, R17) is handled
the same as a negative one: not-verified is not verified, and production serving
bytes we cannot show are ours is the exposure TD-4 declares as unacceptable
whenever it *is* avoidable. The distinction is preserved in the message and in
the result the caller receives, so an outage is never reported as tampering.
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, NoReturn, Protocol

from populus.deploy.cloudflare import Deployment, PagesClient
from populus.deploy.snapshot import UploadSnapshot, freeze_tree
from populus.publish.digests import dist_digest

#: The two Cloudflare environments, spelled the way the provider spells them.
PREVIEW = "preview"
PRODUCTION = "production"

#: Where an operator goes when the first run fails production verification.
RUNBOOK = "docs/runbooks/deploy.md"

#: The branch name a preview upload is published under. It must differ from the
#: project's production branch: Pages decides *environment* from the branch name,
#: so a "preview" pushed under the production branch is a production deployment
#: with a reassuring label — the exact thing R9 exists to prevent.
DEFAULT_PREVIEW_BRANCH = "populus-preview"


class DeployError(RuntimeError):
    """Base for every failure the ordered sequence raises."""


class DeployAborted(DeployError):
    """A precondition refused. Nothing further is uploaded.

    Raised for the pre-upload assertions' own guard rails and for R10's
    seal re-check, i.e. the cases where the run stops with production untouched.
    """


class PreviewVerificationFailed(DeployError):
    """The preview did not verify, so production was never touched (R9)."""


class ProductionVerificationFailed(DeployError):
    """The live custom domain did not verify (R11).

    ``rolled_back_to`` is the deployment id captured at step 3 and handed to the
    provider's rollback; ``rollback_verified`` is whether the restored
    deployment then verified. Both are attributes rather than message text
    because a caller (the job summary, the incident issue) needs them
    structured.
    """

    def __init__(
        self,
        message: str,
        *,
        rolled_back_to: str | None = None,
        rollback_verified: bool | None = None,
    ) -> None:
        super().__init__(message)
        self.rolled_back_to = rolled_back_to
        self.rollback_verified = rollback_verified


class FirstRunUncompensated(ProductionVerificationFailed):
    """TD-4: production verification failed with no rollback target to use.

    A distinct type because it is a distinct operational situation — an
    unverified deployment is serving and only a human can clear it — and because
    a caller must be able to tell it apart from the ordinary compensated
    failure without parsing prose.
    """


@dataclass(frozen=True)
class UploadedDeployment:
    """What an uploader reports back about the deployment it just created.

    ``payload`` is the provider's raw deployment object, carried because the
    verifier's no-Functions check (R16) reads ``uses_functions`` off it and
    nothing else in this module has any business interpreting it.
    """

    id: str
    url: str
    environment: str
    payload: Mapping[str, Any] = field(default_factory=dict)


class Uploader(Protocol):
    """Publishes a sealed tree to one Pages environment.

    It is handed the **sealed snapshot path** and never the source ``dist/``;
    that is the whole point of freezing before step 5.
    """

    def __call__(
        self, path: Path, *, environment: str, branch: str
    ) -> UploadedDeployment: ...


class VerificationOutcome(Protocol):
    """The three fields the sequence reads off a verification.

    :class:`populus.deploy.verify.VerificationResult` satisfies this; the
    Protocol exists so the ordering can be tested without standing up an HTTP
    surface, not to invite a second verifier implementation.
    """

    @property
    def ok(self) -> bool: ...

    @property
    def outcome(self) -> str: ...

    @property
    def detail(self) -> str: ...


class Verifier(Protocol):
    """Verifies what a base URL serves against the sealed tree's inventory.

    One callable for both live checks (R9's preview origin and R11's custom
    domain), differing only in *base_url*. In production this is
    :func:`populus.deploy.verify.verify_deployment` with the HTTP client,
    ``build_id``, ``code_sha`` and ``stats_bytes`` already bound.
    """

    def __call__(
        self,
        base_url: str,
        *,
        stage: str,
        inventory: Mapping[str, Any],
        deployment: Mapping[str, Any],
    ) -> VerificationOutcome: ...


@dataclass(frozen=True)
class DeployOutcome:
    """A successful run: what went live, and what it hashes to.

    The sealed tree is gone by the time this is returned (it is cleaned up on
    every path), so the digest, inventory and file count are carried by value —
    they are what the signer re-derives independently in R13.
    """

    dist_digest: str
    inventory: Mapping[str, Any]
    file_count: int
    preview: UploadedDeployment
    production: UploadedDeployment
    preview_verification: VerificationOutcome
    production_verification: VerificationOutcome
    rollback_target: str | None


def run_deployment(
    *,
    client: PagesClient,
    source: Path | str,
    production_branch: str,
    custom_domain: str,
    upload: Uploader,
    verify: Verifier,
    preview_branch: str = DEFAULT_PREVIEW_BRANCH,
    runbook: str = RUNBOOK,
) -> DeployOutcome:
    """Run the §12.1 deploy sequence in order, or raise saying where it stopped.

    Raises :class:`DeployAborted` when a precondition refuses before production
    is touched, :class:`PreviewVerificationFailed` when the preview does not
    verify, :class:`ProductionVerificationFailed` when the live domain does not
    (after rolling back), and :class:`FirstRunUncompensated` when that happens on
    a run with no rollback target (TD-4). Cloudflare's own
    :class:`~populus.deploy.cloudflare.PagesUnavailable` propagates untouched:
    "could not ask" is not this module's verdict to convert.
    """
    if preview_branch == production_branch:
        raise DeployAborted(
            f"the preview branch {preview_branch!r} equals the production branch: "
            "Pages derives the environment from the branch name, so this would "
            "publish the 'preview' straight to production and R9's "
            "preview-verifies-before-production ordering would be a fiction"
        )

    # --- (1) R8: production identity, before anything is uploaded ------------
    client.assert_production_branch(production_branch)

    # --- (2) R11: the domain precondition, before anything is uploaded -------
    client.assert_custom_domain_active(custom_domain)

    # --- (3) the rollback target, captured BEFORE the production upload ------
    prior = client.latest_production_deployment()
    rollback_target = prior.id if prior is not None else None

    # --- (4) freeze: from here the uploader only ever sees sealed bytes ------
    snapshot = freeze_tree(source)
    try:
        # --- (5) preview, verified inventory-wide (R9) -----------------------
        preview = _upload(upload, snapshot, environment=PREVIEW, branch=preview_branch)
        preview_result = verify(
            preview.url,
            stage=PREVIEW,
            inventory=snapshot.inventory,
            deployment=dict(preview.payload),
        )
        if not preview_result.ok:
            raise PreviewVerificationFailed(
                f"preview verification did not pass ({preview_result.outcome}): "
                f"{preview_result.detail}. Production was not touched — the "
                "prior deployment is still serving (R9)."
            )

        # --- (6) R10: provably the same bytes --------------------------------
        _require_seal_intact(snapshot)
        production = _upload(
            upload, snapshot, environment=PRODUCTION, branch=production_branch
        )

        # --- (7) R11: verify the live custom domain --------------------------
        domain_url = _domain_url(custom_domain)
        production_result = verify(
            domain_url,
            stage=PRODUCTION,
            inventory=snapshot.inventory,
            deployment=dict(production.payload),
        )
        if not production_result.ok:
            # --- (8) compensate, or say plainly that we cannot ---------------
            _fail_production(
                client=client,
                verify=verify,
                domain_url=domain_url,
                inventory=snapshot.inventory,
                rollback_target=rollback_target,
                result=production_result,
                runbook=runbook,
            )

        return DeployOutcome(
            dist_digest=snapshot.dist_digest,
            inventory=snapshot.inventory,
            file_count=snapshot.file_count,
            preview=preview,
            production=production,
            preview_verification=preview_result,
            production_verification=production_result,
            rollback_target=rollback_target,
        )
    finally:
        # Every path, success and failure: the sealed copy is a private tree of
        # the whole site sitting next to dist/. Leaving one behind on the
        # failure path is how a runner accumulates them until it fills up.
        snapshot.cleanup()


def _upload(
    upload: Uploader, snapshot: UploadSnapshot, *, environment: str, branch: str
) -> UploadedDeployment:
    """Call the uploader and refuse a result that contradicts what was asked.

    The environment check is not defensive noise: "production was never touched"
    is only meaningful if the thing we called a preview really was a preview.
    An uploader that reports ``production`` for the preview leg has already done
    the damage R9 orders the steps to prevent, and the run must stop rather than
    proceed to verify it under the wrong name.
    """
    uploaded = upload(snapshot.path, environment=environment, branch=branch)
    if not uploaded.id:
        raise DeployAborted(
            f"the {environment} upload reported no deployment id; there is "
            "nothing to verify, roll back to, or record"
        )
    if uploaded.environment != environment:
        raise DeployAborted(
            f"the uploader was asked for a {environment!r} deployment and "
            f"reported a {uploaded.environment!r} one ({uploaded.id}). Aborting: "
            "the ordering guarantee is about which environment received the "
            "bytes, not about which one we intended to send them to."
        )
    if environment == PREVIEW and not uploaded.url:
        raise DeployAborted(
            "the preview upload reported no URL, so the inventory-wide preview "
            "sweep R9 requires has nothing to fetch"
        )
    return uploaded


def _require_seal_intact(snapshot: UploadSnapshot) -> None:
    """R10: re-hash the sealed tree immediately before the production upload.

    The seal is advisory — the process that owns it can undo it — so the digest
    the preview verified is re-derived here rather than assumed. A mismatch
    means the tree the preview verified is not the tree about to go live, which
    is precisely the substitution "same bytes" is a claim about.
    """
    observed = dist_digest(snapshot.path)
    if observed != snapshot.dist_digest:
        raise DeployAborted(
            "the sealed tree changed between the preview and production "
            f"uploads: it was {snapshot.dist_digest}, it now hashes to "
            f"{observed}. Production is a second upload of provably the same "
            "bytes (R10); aborting with production untouched."
        )


def _fail_production(
    *,
    client: PagesClient,
    verify: Verifier,
    domain_url: str,
    inventory: Mapping[str, Any],
    rollback_target: str | None,
    result: VerificationOutcome,
    runbook: str,
) -> NoReturn:
    """Step 8: roll back to the captured deployment, or declare TD-4."""
    if rollback_target is None:
        raise FirstRunUncompensated(_td4_message(result, runbook))

    restored = client.rollback(rollback_target)
    after = verify(
        domain_url,
        stage=PRODUCTION,
        inventory=inventory,
        deployment=_deployment_payload(restored),
    )
    restored_state = (
        "the restored deployment verified"
        if after.ok
        else f"the restored deployment did NOT verify ({after.outcome}): {after.detail}"
    )
    raise ProductionVerificationFailed(
        f"production verification did not pass ({result.outcome}) at {domain_url}: "
        f"{result.detail}. Rolled back to the deployment captured before the "
        f"upload ({rollback_target}); {restored_state}.",
        rolled_back_to=rollback_target,
        rollback_verified=after.ok,
    )


def _td4_message(result: VerificationOutcome, runbook: str) -> str:
    """The one failure in this module that a machine cannot finish handling.

    Everything an operator needs is in the text, because a TD-4 event is the one
    deploy failure class with no machine record of its own resolution: what
    failed, why nothing was rolled back, why no delete was attempted, where the
    remediation steps are, and that this cannot happen twice.
    """
    return (
        f"production verification did not pass ({result.outcome}): {result.detail}. "
        "There is NO automated compensation for this run (TD-4): no prior "
        "production deployment was captured, so there is nothing to roll back "
        "to, and Cloudflare refuses to delete an active production deployment — "
        "so no delete is attempted here or anywhere in the deploy path. The "
        "bytes that failed verification are serving now and only an owner action "
        f"can replace them: follow {runbook} section 4 (TD-4 remediation). The "
        "identical sealed bytes passed the inventory-wide preview sweep (R9), so "
        "start by suspecting routing, cache or domain state rather than the "
        "build. This exposure exists exactly once: after the first successful "
        "production deploy every run has a rollback target and TD-4 is gone."
    )


def _domain_url(custom_domain: str) -> str:
    """R11 verifies the live custom domain, not the deployment's own origin."""
    if "://" in custom_domain:
        return custom_domain.rstrip("/")
    return f"https://{custom_domain}"


def _deployment_payload(deployment: Deployment) -> dict[str, Any]:
    """The rolled-back deployment, shaped like the provider object a verifier reads."""
    return {
        "id": deployment.id,
        "environment": deployment.environment,
        "url": deployment.url,
        "uses_functions": deployment.uses_functions,
    }
