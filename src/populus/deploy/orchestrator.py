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

**The entry point** (:func:`main`) is part of the mechanism, not packaging
around it. ``publish.yml`` runs this module as its own process
(``python -m populus.deploy.orchestrator``), and a module with no ``main()``
exits 0 having done nothing — a deploy step that reports success while
deploying nothing, whose empty ``deployment_id`` output then makes the signer's
cross-check skip itself. So the CLI contract lives here beside the sequence it
starts: the flags, the credential names, the ``$GITHUB_OUTPUT`` keys, and exit
codes that distinguish *rejected* from *could not ask* from *nothing was
configured* from TD-4's uncompensated first run. Those four are different
operational situations and a caller must be able to tell them apart without
parsing prose.
"""

from __future__ import annotations

import argparse
import os
import sys
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, NoReturn, Protocol

from populus.deploy.cloudflare import Deployment, PagesClient, PagesError
from populus.deploy.snapshot import UploadSnapshot, freeze_tree
from populus.deploy.verify import (
    DEFAULT_MARKER_PATH,
    DEFAULT_STATS_PATH,
    MARKER_BUILD_ID,
    MARKER_CODE_SHA,
    read_markers,
)
from populus.publish.attestation import UNAVAILABLE
from populus.publish.digests import dist_digest
from populus.publish.inventory import build_inventory, render_inventory

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

#: The branch this workflow is locked to. R8 asserts Cloudflare agrees before a
#: byte moves; the default is the repository's default branch and the flag
#: exists so the lock is a value the workflow can state out loud.
DEFAULT_PRODUCTION_BRANCH = "main"

#: Read by :func:`main` only. The token is the step-scoped `Pages Edit`
#: credential; the account id and project name are repository variables. All
#: three are required, and a missing one exits before any call is made — a
#: deploy that silently targets account "" project "" is the failure mode this
#: check exists for.
API_TOKEN_ENV = "CLOUDFLARE_API_TOKEN"
ACCOUNT_ID_ENV = "CLOUDFLARE_ACCOUNT_ID"
PROJECT_ENV = "CLOUDFLARE_PAGES_PROJECT"

#: Exit codes, deliberately distinguishable — these are four different pages at
#: 3am. ``EXIT_UNCOMPENSATED`` is TD-4 and nothing else: unverified bytes are
#: serving and only an owner action can replace them.
EXIT_DEPLOYED = 0
EXIT_REJECTED = 1
EXIT_UNAVAILABLE = 2
EXIT_MISCONFIGURED = 3
EXIT_UNCOMPENSATED = 4

#: The ``$GITHUB_OUTPUT`` value written on each terminal path, so a job summary
#: (and a human reading the log) sees the same vocabulary the exit code carries.
OUTCOME_DEPLOYED = "deployed"
OUTCOME_REJECTED = "rejected"
OUTCOME_UNAVAILABLE = "unavailable"
OUTCOME_MISCONFIGURED = "misconfigured"
OUTCOME_UNCOMPENSATED = "uncompensated"


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


class PagesSurface(Protocol):
    """The provider calls the ordered sequence is permitted to make.

    Four, and no more. The production implementation is
    :class:`populus.deploy.upload.PagesDeploySurface`, which composes
    :class:`~populus.deploy.cloudflare.PagesClient`; there is deliberately no
    method here for removing a deployment, because Cloudflare declines that
    operation on an active production deployment and a compensation the provider
    refuses is not a compensation (TD-4).

    ``rollback_payload`` returns the provider's **raw** deployment object and is
    named differently from ``PagesClient.rollback`` for a reason worth stating.
    R16's no-Functions assertion fails *closed* on ``uses_functions`` being
    absent, and the typed :class:`~populus.deploy.cloudflare.Deployment` coerces
    that field with ``bool(...)`` — so any mapping rebuilt from the typed object
    turns "the provider said nothing" into "there are none", deleting the
    property while looking like it kept it. The signer avoids this trap by
    reading raw (:mod:`populus.deploy.record`); the rollback re-verification
    here is the *other* place the same payload is judged, so it reads raw too.
    Because the name differs, passing a bare ``PagesClient`` fails loudly on a
    missing attribute instead of silently laundering the field.
    """

    def assert_production_branch(self, expected: str) -> str: ...

    def assert_custom_domain_active(self, domain: str) -> Any: ...

    def latest_production_deployment(self) -> Deployment | None: ...

    def rollback_payload(self, deployment_id: str) -> Mapping[str, Any]: ...


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
    client: PagesSurface,
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
    client: PagesSurface,
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

    # The provider's own object, verbatim. Reconstructing a mapping from the
    # typed `Deployment` here would set `uses_functions` to `bool(...)` of a
    # possibly-absent field, and R16's check — which exists to fail closed when
    # the provider says nothing — would be unable to ever do so on this path.
    restored = client.rollback_payload(rollback_target)
    after = verify(
        domain_url,
        stage=PRODUCTION,
        inventory=inventory,
        deployment=restored,
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


# --- the entry point ---------------------------------------------------------


class ArtifactRefused(DeployAborted):
    """The artifact does not describe itself consistently, so nothing is uploaded.

    A subclass of :class:`DeployAborted` because it is the same situation seen
    one step earlier: a precondition refused with production untouched.
    """


@dataclass(frozen=True)
class ArtifactExpectations:
    """What the built tree says about itself, read before anything is uploaded.

    These are the values the served bytes are then compared against. They come
    from the **artifact**, not from a job input: the deploy job's question is
    "is what is serving what we built", and an expectation supplied by the same
    caller that supplies the bytes would make that question circular. Tying the
    build id to an attested pointer is a different question with a different
    trust model, and it belongs to the signer (R13), which re-derives it in
    another workflow under another identity.
    """

    build_id: str
    code_sha: str
    stats_bytes: bytes
    inventory: dict


def artifact_expectations(
    source: Path | str,
    inventory_path: Path | str,
    *,
    marker_path: str = DEFAULT_MARKER_PATH,
    stats_path: str = DEFAULT_STATS_PATH,
) -> ArtifactExpectations:
    """Read the tree's own markers and cross-check the shipped inventory.

    The inventory comparison is **byte** equality against the canonical
    rendering of a freshly walked tree, not a field-by-field comparison of two
    parsed documents: the artifact ships one specific serialization, and a copy
    that parses equal is a different artifact from the one the manifest lists.
    A mismatch means the tree and its declared inventory disagree, which is
    exactly the disagreement everything downstream assumes away.
    """
    source = Path(source)
    inventory_path = Path(inventory_path)
    if not source.is_dir():
        raise ArtifactRefused(f"--source {source} is not a directory")
    if not inventory_path.is_file():
        raise ArtifactRefused(f"--inventory {inventory_path} does not exist")

    observed = build_inventory(source)
    declared = inventory_path.read_bytes()
    if render_inventory(observed) != declared:
        raise ArtifactRefused(
            f"{inventory_path} is not the inventory of {source}: the shipped "
            f"document is {len(declared)} bytes and the tree canonicalises to "
            f"{len(render_inventory(observed))}, dist_digest "
            f"{observed['dist_digest']}. Aborting before any upload — the "
            "verification about to run is scoped to this inventory, so a tree "
            "that does not match it would be verified against the wrong list."
        )

    stats_file = source / stats_path
    marker_file = source / marker_path
    for required in (stats_file, marker_file):
        if not required.is_file():
            raise ArtifactRefused(
                f"the built tree has no {required.name}; verification cannot be "
                "scoped to paths it cannot see"
            )

    markers = read_markers(marker_file.read_bytes())
    return ArtifactExpectations(
        build_id=_one_marker(markers, MARKER_BUILD_ID, marker_path),
        code_sha=_one_marker(markers, MARKER_CODE_SHA, marker_path),
        stats_bytes=stats_file.read_bytes(),
        inventory=observed,
    )


def _one_marker(markers: Mapping[str, list[str]], name: str, path: str) -> str:
    """Exactly one, and non-empty. Zero or two is not a value to compare against."""
    values = markers.get(name, [])
    if len(values) != 1:
        raise ArtifactRefused(
            f"the built {path} carries {len(values)} {name!r} markers; exactly "
            "one is the contract, and no exact statement is possible otherwise"
        )
    if not values[0]:
        raise ArtifactRefused(f"the built {path} carries an empty {name!r} marker")
    return values[0]


def _parse_args(argv: Sequence[str] | None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        prog="populus-deploy",
        description=(
            "Upload the built site to a Pages preview, verify it inventory-wide, "
            "publish the same sealed bytes to production and verify the live "
            "custom domain (ARCHITECTURE §12.1 steps 1-5)."
        ),
    )
    parser.add_argument("--source", required=True, help="the built site/ tree")
    parser.add_argument(
        "--inventory",
        required=True,
        help="the §12.1 inventory.json shipped beside the tree, cross-checked here",
    )
    parser.add_argument("--custom-domain", required=True, help="the live custom domain")
    parser.add_argument(
        "--production-branch",
        default=DEFAULT_PRODUCTION_BRANCH,
        help=(
            "the branch this workflow is locked to; R8 asserts Cloudflare agrees "
            f"before any upload (default: {DEFAULT_PRODUCTION_BRANCH})"
        ),
    )
    parser.add_argument(
        "--preview-branch",
        default=DEFAULT_PREVIEW_BRANCH,
        help=(
            "the branch the preview is published under; it must differ from the "
            "production branch or the 'preview' is a production deployment"
        ),
    )
    parser.add_argument(
        "--wrangler-package",
        default=None,
        help="override the pinned wrangler npm spec the uploader invokes",
    )
    return parser.parse_args(argv)


def _default_http_client():
    """The served-tree client, built here and nowhere else.

    This is the single function in the module that names a transport library,
    and it is reached only from :func:`main` — the same arrangement, for the
    same reason, as ``populus.deploy.record._default_http_client``: ``publish.yml``
    runs this module as its own process, so something in it has to build the
    client, and no other module hands one out. Every verification path takes an
    INJECTED client, which is what keeps the suite hermetic and what lets the
    ordering tests drive the real verifier without reaching the network.
    ``follow_redirects`` is False here as well as on every call
    :mod:`populus.deploy.verify` makes: belt and braces on the one policy whose
    failure mode is a silent pass.
    """
    import httpx

    return httpx.Client(follow_redirects=False, timeout=30.0)


def _emit_outputs(
    *,
    outcome: str,
    deployment_id: str = "",
    preview_deployment_id: str = "",
    dist_digest_value: str = "",
    rolled_back_to: str = "",
) -> None:
    """Hand the workflow what this run actually established.

    ``deployment_id`` is emitted **only on a verified production deploy**, and
    that restraint is the point: the signer cross-checks its own Pages read
    against this value, so publishing the id of a deployment that failed
    verification — or one that was then rolled back — would hand the signer a
    claim this run did not establish. An empty value is an honest answer; the
    signer treats a missing claim as "nothing to cross-check", not as agreement.
    """
    destination = os.environ.get("GITHUB_OUTPUT")
    if not destination:
        return
    lines = [
        f"outcome={outcome}",
        f"deployment_id={deployment_id}",
        f"preview_deployment_id={preview_deployment_id}",
        f"dist_digest={dist_digest_value}",
        f"rolled_back_to={rolled_back_to}",
    ]
    with open(destination, "a", encoding="utf-8") as handle:
        handle.write("\n".join(lines) + "\n")


def main(
    argv: Sequence[str] | None = None,
    *,
    pages_factory=None,
    upload_factory=None,
    http_factory=None,
    verifier_factory=None,
) -> int:
    """Run the §12.1 deploy sequence as a process. The factories keep it testable.

    Every factory defaults to the real object; the suite injects fakes so the
    entry point itself — argv parsing, credential reading, the ``$GITHUB_OUTPUT``
    emission and every exit code — is exercised without a connection being
    opened. Fails closed on a missing credential before any call is made: a
    deploy that targets account ``""`` project ``""`` fails somewhere far from
    the cause, and the cause is a variable read through the wrong context.
    """
    from populus.deploy.upload import (
        DeploymentVerifier,
        PagesDeploySurface,
        WranglerUploader,
    )

    args = _parse_args(argv)

    project = os.environ.get(PROJECT_ENV, "").strip()
    if pages_factory is None or upload_factory is None:
        account_id = os.environ.get(ACCOUNT_ID_ENV, "").strip()
        token = os.environ.get(API_TOKEN_ENV, "").strip()
        missing = [
            name
            for name, value in (
                (ACCOUNT_ID_ENV, account_id),
                (PROJECT_ENV, project),
                (API_TOKEN_ENV, token),
            )
            if not value
        ]
        if missing:
            print(
                f"deploy: {', '.join(missing)} is unset — refusing to deploy to an "
                "unnamed account or project. Repository VARIABLES read through "
                "`secrets.` resolve to the empty string silently, which is how "
                "this ends up empty.",
                file=sys.stderr,
            )
            _emit_outputs(outcome=OUTCOME_MISCONFIGURED)
            return EXIT_MISCONFIGURED
        client = PagesClient(account_id, project, token)
    else:
        client = None

    try:
        expectations = artifact_expectations(args.source, args.inventory)
    except (ArtifactRefused, OSError, ValueError) as exc:
        print(f"deploy: {exc}", file=sys.stderr)
        _emit_outputs(outcome=OUTCOME_REJECTED)
        return EXIT_REJECTED

    pages = pages_factory() if pages_factory is not None else PagesDeploySurface(client)
    if upload_factory is not None:
        upload = upload_factory()
    else:
        upload = WranglerUploader(
            project=project,
            lookup=pages,
            **({"package": args.wrangler_package} if args.wrangler_package else {}),
        )
    if verifier_factory is not None:
        verify = verifier_factory()
    else:
        verify = DeploymentVerifier(
            client=http_factory() if http_factory is not None else _default_http_client(),
            build_id=expectations.build_id,
            code_sha=expectations.code_sha,
            stats_bytes=expectations.stats_bytes,
        )

    try:
        outcome = run_deployment(
            client=pages,
            source=args.source,
            production_branch=args.production_branch,
            custom_domain=args.custom_domain,
            upload=upload,
            verify=verify,
            preview_branch=args.preview_branch,
        )
    except FirstRunUncompensated as exc:
        # TD-4: the bytes are live and unverified. This is its own exit code
        # because it is its own operational situation — no rollback happened,
        # none was possible, and only an owner action can clear it.
        print(f"deploy: {exc}", file=sys.stderr)
        _emit_outputs(outcome=OUTCOME_UNCOMPENSATED)
        return EXIT_UNCOMPENSATED
    except ProductionVerificationFailed as exc:
        print(f"deploy: {exc}", file=sys.stderr)
        _emit_outputs(
            outcome=OUTCOME_REJECTED, rolled_back_to=exc.rolled_back_to or ""
        )
        return EXIT_REJECTED
    except DeployError as exc:
        print(f"deploy: {exc}", file=sys.stderr)
        _emit_outputs(outcome=OUTCOME_REJECTED)
        return EXIT_REJECTED
    except PagesError as exc:
        # R17: "we could not ask" is not "the answer was no". A rate-limited or
        # unreachable Pages API must not page the same way tampering does.
        unavailable = exc.outcome == UNAVAILABLE
        print(f"deploy: {exc}", file=sys.stderr)
        _emit_outputs(
            outcome=OUTCOME_UNAVAILABLE if unavailable else OUTCOME_REJECTED
        )
        return EXIT_UNAVAILABLE if unavailable else EXIT_REJECTED

    _emit_outputs(
        outcome=OUTCOME_DEPLOYED,
        deployment_id=outcome.production.id,
        preview_deployment_id=outcome.preview.id,
        dist_digest_value=outcome.dist_digest,
    )
    print(
        f"deploy: {outcome.file_count} files, dist_digest {outcome.dist_digest}; "
        f"preview {outcome.preview.id} verified, production {outcome.production.id} "
        f"verified on {args.custom_domain}"
    )
    return EXIT_DEPLOYED


if __name__ == "__main__":  # pragma: no cover - exercised via main()
    raise SystemExit(main())
