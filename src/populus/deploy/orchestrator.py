"""§12.1: the ordered deploy sequence, in one injected, testable function.

The order is the mechanism. Every step below is safe only because the steps
before it already ran, so spreading this sequence across workflow YAML would put
the actual security property in a place no test can reach. It lives here instead,
in :func:`run_deployment`, with the Pages client, the uploader and the verifier
all injected — the suite exercises the real ordering with no network at all
(``tests/conftest.py`` blocks sockets).

The eight steps, and what each one is load-bearing for:

1. **Assert the production branch — before any upload.** A mismatch means
   the bytes would land under an identity the workflow does not claim. Asserted
   first because after an upload the question is academic.
2. **Assert the custom domain is ``active`` — before any upload.**
   Activation is a provisioning precondition (Rollout prerequisite 4), not
   something this run polls for. Read from the ``…/domains`` subresource, which
   is the only endpoint carrying per-domain status.
3. **Capture the current production deployment id, and prove it is the one
   serving.** This is the rollback target, and it must be read *before* the
   production upload — afterwards the newest production deployment is the one
   that just failed verification, and "rolling back" to it would be a no-op
   dressed as a compensation. ``None`` is a real answer, not an error.
   **Serving-anchor proof:** "newest production deployment by creation" is not "the deployment
   the domain serves", and the two diverge after any dashboard rollback, so the
   anchor's own ``populus:code_sha`` is compared against the live domain's and a
   disagreement refuses here — before the freeze, production untouched.
4. **Freeze the built tree**: from here on the uploader is handed a sealed
   private copy, so hashed bytes and uploaded bytes are one thing.
5. **Upload to a preview and verify it INVENTORY-WIDE.** §12.1 step 4 is
   amended to require the same full sweep the signer runs, not markers plus a
   ``stats.json`` hash. This is not a nicety: TD-4 accepts one unverified-serving
   window on the strength of "the identical bytes already passed the preview
   sweep", and if the preview only read markers that sentence is vacuous.
6. **Upload the same sealed bytes to production**, re-checking
   ``dist_digest`` immediately before. The preview verified a specific tree; the
   production upload must be that tree and not a successor of it.
7. **Verify the live custom domain** — always, no exemption, no polling.
   The preview origin and the custom domain differ only in base URL, so both go
   through one verifier. **Post-promotion settle:** the domain is given one bounded settle after
   the promotion and BEFORE the first sweep, because ``_await`` returns when the
   origin answers while individual objects may still be materialising, and a
   partially written body reads as a hash mismatch. **Propagation tolerance:** when the ONLY
   findings are inventoried paths
   answering 404, the domain is given one bounded settle and the FULL inventory
   is verified again — a promotion's last objects can still be resolving on the
   edge seconds after the origin itself answers. Every other finding shape, and
   a second failure of the same shape, rolls back at once.
8. **On failure at 7: roll back to the captured deployment and re-verify.**

**The first run.** When step 3 captured nothing there is no rollback
target, and Cloudflare **refuses to delete an active production deployment**
("this will not delete the active production deployment if one exists"). So there
is **no automated compensation**, and this module does not invent one: there is no
delete call here, and :mod:`populus.deploy.cloudflare` deliberately exposes no
delete method to call. The run raises with the remediation pointer instead. That
exposure exists exactly once — after the first successful deploy every run has a
rollback target and TD-4 is gone permanently.

A verification that could not reach a verdict (``unavailable``) is handled
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
import time
from collections.abc import Callable, Iterable, Mapping, Sequence
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, NoReturn, Protocol
from uuid import uuid4

from populus.deploy.cloudflare import Deployment, PagesClient, PagesError
from populus.deploy.snapshot import UploadSnapshot, freeze_tree
from populus.deploy.verify import (
    _REQUEST_HEADERS,
    CACHE_BUST_PARAM,
    DEFAULT_MARKER_PATH,
    DEFAULT_STATS_PATH,
    MARKER_BUILD_ID,
    MARKER_CODE_SHA,
    HeaderMultimap,
    normalize_security_header_multimap,
    read_markers,
    served_path,
)
from populus.publish.attestation import REJECTED, UNAVAILABLE
from populus.publish.digests import dist_digest
from populus.publish.inventory import (
    InventoryError,
    build_inventory,
    render_inventory,
    validate_inventory_v2,
)

#: The two Cloudflare environments, spelled the way the provider spells them.
PREVIEW = "preview"
PRODUCTION = "production"

#: Where an operator goes when the first run fails production verification.
RUNBOOK = "docs/operations/deploy.md"

#: The branch name a preview upload is published under. It must differ from the
#: project's production branch: Pages decides *environment* from the branch name,
#: so a "preview" pushed under the production branch is a production deployment
#: with a reassuring label — the exact thing the preview sweep exists to prevent.
DEFAULT_PREVIEW_BRANCH = "populus-preview"

#: The branch this workflow is locked to. The pre-upload assertion checks Cloudflare agrees before a
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

#: The one production divergence reason that may be a propagation lag rather
#: than a wrong deployment, matched EXACTLY against `Divergence.reason`. A 403,
#: a 5xx, a 3xx hijack, a digest or length mismatch, a marker mismatch, a
#: header or control-path finding — none of those become true by waiting, and
#: none of them are tolerated here for a moment.
PROPAGATION_REASON = "HTTP 404, expected 200"

#: How long to let the custom domain settle AFTER a production promotion and
#: BEFORE the first verification sweep. Added 2026-08-14: run 31774209281
#: promoted a good build and, seconds later, three `congress/data/tickers/*.json`
#: shards served TRUNCATED bodies — `AAXJ.v1.json` came back 571 bytes when both
#: the new build (835) and the previous deployment (835) disagree with that
#: length, so it was a partial object rather than a stale one. The 404 tolerance cannot help
#: there and must not: a body-hash mismatch is indistinguishable from tampering
#: and is never waited out. Delaying the QUESTION is safe; softening the ANSWER
#: is not. So the settle moved to before the first sweep, where it costs one
#: bounded wait on every deploy and weakens no verdict.
POST_PROMOTION_SETTLE_SECONDS = 45.0

#: How long to let the custom domain settle before ONE re-verification, and how
#: many times that is allowed. One retry, not a loop: the point is to absorb the
#: seconds between a promotion and the last object resolving on the edge, not to
#: keep asking a broken deployment until it agrees.
PROPAGATION_SETTLE_SECONDS = 45.0
PROPAGATION_RETRIES = 1

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


class RollbackAnchorUnverified(DeployError):
    """The captured rollback target is not what the custom domain serves.

    `latest_production_deployment()` answers "newest production deployment by
    creation", which is NOT "the deployment currently serving". The two diverge
    the moment anyone rolls back in the Cloudflare dashboard — and that is
    precisely the state a previous failed deploy leaves behind.

    Measured 2026-08-14, run 31774209281: production had been rolled back by
    hand to `2f3830b6` (verified live, code_sha d823597 — which is what let the
    record gate pass at all). The job still captured `e679ab11`, the prior
    run's failed promotion, as its anchor, and on failure "rolled back" to it.
    The site moved from the attested build to an unattested one, re-opening the
    record-gate deadlock the manual rollback had just cleared.

    A compensating rollback is only compensating if it restores the state that
    existed before the upload, so this refuses BEFORE anything is uploaded —
    production untouched, and the operator told exactly which two ids disagree.
    """


class DeployAborted(DeployError):
    """A precondition refused. Nothing further is uploaded.

    Raised for the pre-upload assertions' own guard rails and for the
    seal re-check, i.e. the cases where the run stops with production untouched.
    """


class PreviewVerificationFailed(DeployError):
    """The preview did not verify, so production was never touched."""


class ProductionVerificationFailed(DeployError):
    """The live custom domain did not verify.

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
    verifier's no-Functions check reads ``uses_functions`` off it and
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
    refuses is not a compensation.

    ``rollback_payload`` returns the provider's **raw** deployment object and is
    named differently from ``PagesClient.rollback`` for a reason worth stating.
    The no-Functions assertion fails *closed* on ``uses_functions`` being
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

    #: Newest-first, so the anchor resolver can stop at the first deployment
    #: that serves what the domain serves. The original proof-only rule PROVED the anchor rather than
    #: resolving it, which refuses correctly but leaves the deploy blocked for
    #: as long as the divergence stands — and a provider-side rollback creates
    #: exactly that divergence by design.
    def production_deployments(self) -> Iterable[Deployment]: ...

    #: LD12c: the provider's RAW production listing — the seam rollback
    #: evidence is captured from, so a typed object can never launder an absent
    #: ``uses_functions`` into a confident ``False``.
    def raw_deployments(
        self, environment: str | None = None
    ) -> list[Mapping[str, Any]]: ...

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

    One callable for both live checks (the preview origin and the custom
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
    they are what the signer re-derives independently.
    """

    dist_digest: str
    inventory: Mapping[str, Any]
    file_count: int
    preview: UploadedDeployment
    production: UploadedDeployment
    preview_verification: VerificationOutcome
    production_verification: VerificationOutcome
    rollback_target: str | None


@dataclass(frozen=True)
class ServedIdentity:
    """The BUILD a URL is serving: ``populus:build_id`` AND ``populus:code_sha``.

    Code identity alone does not identify a deployment. Two deployments built
    from the same commit against different data builds carry the same
    ``code_sha`` and different ``build_id`` — indistinguishable to a code-only
    comparison, so the anchor resolver would accept the newest match rather
    than the one actually serving the domain, which is precisely the
    wrong-build-restore the serving anchor exists to prevent. Both markers are
    compared, exactly, never by prefix.
    """

    build_id: str
    code_sha: str


class ServingProbe(Protocol):
    """Reads the :class:`ServedIdentity` a base URL is serving right now.

    Returns both markers, or ``None`` when the identity could not be determined
    — transport failure, a non-200, a missing, empty or duplicated
    ``build_id`` or ``code_sha``. ``None`` is "could not ask", never "no
    deployment": the caller refuses on it rather than guessing, because this
    runs before any upload where refusing is free.
    """

    def __call__(self, base_url: str) -> ServedIdentity | None: ...


class OriginReadiness(Protocol):
    """Polls a freshly-uploaded origin until it answers, or gives up."""

    def __call__(self, url: str, *, stage: str) -> None: ...


def _await(ready: OriginReadiness | None, url: str, *, stage: str) -> None:
    """Wait for a just-uploaded deployment to start serving, before verifying.

    Cloudflare returns the deployment URL the moment the upload is accepted,
    but the edge needs a few seconds to route it — until then every path
    answers **522**, which is correctly classified as "no verdict reached"
    rather than tampering. So the sweep ran against an origin that did not
    exist yet and the whole deploy aborted on an outage that was really a race
    (run 7: `HTTP 522 fetching .../404?populus-verify=...`; the same URL
    answered 200 moments later).

    This waits for readiness — it does NOT retry verification. A tampered or
    genuinely broken deployment still fails; the only thing tolerated is the
    interval before a brand-new origin is reachable at all. Injected so the
    suite stays hermetic and the timeout is testable.
    """
    if ready is not None:
        ready(url, stage=stage)


def _propagation_lag_only(result: VerificationOutcome) -> bool:
    """True when EVERY finding is an inventoried path answering 404.

    Run 31752834344 promoted a deployment whose three `_astro/*.js` bundles were
    still resolving on the custom domain, rejected on their 404s, and rolled a
    good build back. Probed minutes later, all three served 200 from that very
    deployment — the bytes were always there.

    `_await` does not cover this: it waits for the ORIGIN to answer at all (the
    522 race), and here the origin was answering 200 for 9,668 of 9,671 paths.

    The predicate is deliberately narrow and structural rather than a substring
    test on `detail`:

    * every finding must correspond to a divergence — a marker mismatch, a
      `stats.json` byte difference, a header finding or a control-path finding
      is a finding with NO divergence, so the counts diverge and this returns
      False;
    * every divergence reason must be exactly `PROPAGATION_REASON`;
    * the outcome must be REJECTED. This was previously left to a
      claim in this docstring — "an UNAVAILABLE result carries no divergences,
      so it cannot get here" — which is true of `verify_deployment` today and
      is exactly the kind of invariant that holds until someone edits the other
      file. A partial, malformed, or future result that is UNAVAILABLE *and*
      carries 404 divergences must fail closed, so the outcome is now checked
      rather than reasoned about.

    Anything this predicate does not recognise keeps the old behaviour: roll
    back immediately.
    """
    if getattr(result, "outcome", None) != REJECTED:
        return False
    divergences = getattr(result, "divergences", ())
    findings = getattr(result, "findings", ())
    if not divergences or len(findings) != len(divergences):
        return False
    return all(d.reason == PROPAGATION_REASON for d in divergences)


def _assert_anchor_is_serving(
    probe: ServingProbe, *, prior: Any, domain_url: str
) -> None:
    """Refuse unless the captured anchor is the deployment the domain serves.

    Both halves are read through the same probe so the comparison is like for
    like. An unreadable answer on either side is a refusal too: an anchor we
    cannot confirm is an anchor we cannot rely on, and this runs before the
    freeze, so nothing has been uploaded and nothing needs undoing.
    """
    served = probe(domain_url)
    anchored = probe(prior.url)
    if served is None or anchored is None:
        raise RollbackAnchorUnverified(
            f"cannot confirm the rollback anchor: {domain_url} reported "
            f"{served!r} and the captured deployment {prior.id} "
            f"({prior.url}) reported {anchored!r} for "
            f"{MARKER_BUILD_ID!r}/{MARKER_CODE_SHA!r}. Nothing was uploaded; "
            "production is untouched. Re-run once both answer, or fix the "
            "deployment that does not serve a marker"
        )
    if served != anchored:
        raise RollbackAnchorUnverified(
            f"the rollback anchor is not what {domain_url} serves: the domain "
            f"serves {served!r} but the captured deployment "
            f"{prior.id} ({prior.url}) serves {anchored!r} (build_id AND "
            "code_sha, compared exactly, "
            "never by prefix). `latest_production_deployment()` answers "
            "'newest by creation', which diverges from 'currently serving' "
            "after any dashboard rollback — and rolling back to it would move "
            "the site to a build nobody asked for. Nothing was uploaded; "
            "production is untouched. Roll production forward or back until "
            "the two agree, then re-run (see docs/operations/rollback.md)"
        )


# --- rollback evidence, captured BEFORE anything is uploaded ----


@dataclass(frozen=True)
class RollbackSiteObservation:
    """One coherent, cache-busted observation of the custom-domain root.

    Everything a post-rollback restoration is compared against — body identity,
    both markers, and the normalized security-header multimap — derived from
    ONE response, so the expectation cannot be an internally mixed composite of
    two deployments racing each other. ``headers`` is stored as a sorted tuple
    of ``(name, (value, ...))`` pairs — fully immutable, with explicit absence
    as an empty tuple, exactly what
    :func:`~populus.deploy.verify.normalize_security_header_multimap` reports.
    """

    body_sha256: str
    body_length: int
    build_id: str
    code_sha: str
    headers: tuple[tuple[str, tuple[str, ...]], ...]


@dataclass(frozen=True)
class RollbackExpectation:
    """LD12a: what a compensating rollback must restore, captured pre-upload.

    Provider identity from the RAW production mapping — a non-empty ``id``,
    ``environment == "production"``, and an explicit ``uses_functions is
    False`` (a mapping that says nothing is a refusal, never a default) — plus
    one :class:`RollbackSiteObservation`. This is honest point-in-time
    identity/marker/header restoration, not a prior-tree inventory proof
    (TD-PSH-8): the failed artifact's v2 inventory is never consulted, and no
    v1 inventory is ever parsed.
    """

    deployment_id: str
    environment: str
    uses_functions: bool
    observation: RollbackSiteObservation


class RollbackObserver(Protocol):
    """Observes the custom-domain root once, or raises :class:`DeployAborted`.

    Injected so the suite stays hermetic; the production adapter is
    :func:`observe_rollback_root`.
    """

    def __call__(self, domain_url: str) -> RollbackSiteObservation: ...


def _raw_production_head(
    entries: Sequence[Mapping[str, Any]], *, when: str
) -> tuple[str, str, bool]:
    """Validate the first raw production entry into ``(id, environment, False)``."""
    if not entries:
        raise DeployAborted(
            f"the raw production listing was non-empty before the observation "
            f"and empty {when}; the provider changed under us. Nothing was "
            "frozen or uploaded"
        )
    head = entries[0]
    if not isinstance(head, Mapping):
        raise DeployAborted(
            f"malformed provider payload {when}: the first production entry is "
            f"{type(head).__name__}, not an object. Nothing was frozen or uploaded"
        )
    identifier = head.get("id")
    if not isinstance(identifier, str) or not identifier:
        raise DeployAborted(
            f"malformed provider payload {when}: the first production entry "
            "carries no id. Nothing was frozen or uploaded"
        )
    environment = head.get("environment")
    if environment != "production":
        raise DeployAborted(
            f"the first entry of the production listing reports environment "
            f"{environment!r} {when}; refusing to derive a rollback expectation "
            "from it. Nothing was frozen or uploaded"
        )
    if "uses_functions" not in head or head["uses_functions"] is not False:
        raise DeployAborted(
            f"the prior production deployment {identifier} does not carry an "
            f"explicit uses_functions=False {when} "
            f"(observed {head.get('uses_functions', '<absent>')!r}); this site "
            "is pure static and an absent signal never reads as 'there are "
            "none'. Nothing was frozen or uploaded"
        )
    return identifier, environment, False


def capture_rollback_expectation(
    pages: PagesSurface,
    observer: RollbackObserver,
    domain_url: str,
    *,
    anchor: Any | None = None,
    probe: ServingProbe | None = None,
) -> RollbackExpectation | None:
    """LD12c: the SOLE producer of a :class:`RollbackExpectation`.

    Reads the raw production listing, validates the prior deployment's raw
    identity, takes exactly one domain-root observation through *observer*,
    then re-reads the raw listing and requires the same first
    id/environment/no-Functions signal — a concurrent provider change aborts
    here, before ``freeze_tree`` or either upload. An empty raw listing is the
    existing first-run uncompensated case and returns ``None``.

    *anchor* reconciles the captured rollback evidence with the serving-anchor
    fix: when
    the resolved serving anchor is NOT the newest-by-creation deployment (the
    state any provider-side rollback leaves behind), the expectation's identity
    is taken from the anchor's own raw entry — the deployment a compensating
    rollback would actually restore — while the bracketing stability check
    still pins the FIRST entry, which is where a concurrent deploy appears.

    *probe* closes the bracket's real hole. Comparing the provider head across
    the two raw reads only detects a deploy that lands BETWEEN them; a deploy
    that lands after the caller verified the anchor but before the first read
    leaves both reads identical and sails through — and the expectation then
    pairs an OLD rollback target with the NEW deployment's body and markers,
    which guarantees that any later rollback fails restoration verification.
    So the observation is bound to the target *by identity*, inside the
    bracket: the anchor deployment must itself serve the very
    ``build_id``/``code_sha`` the observation carries. Observation and target
    are then provably one deployment, not two reads with a stable head.

    The bracket then CLOSES on the live domain. The anchor comparison cannot
    see a provider-side rollback that lands after the observation: such a
    rollback creates no deployment (both raw reads stay identical) and a
    per-deployment anchor URL is immutable (it always serves its own build).
    Re-probing ``domain_url`` at the end of the bracket is the only check that
    sees the domain move — and a move means the expectation would compensate to
    the anchor rather than to the deployment that was actually serving.

    The complete raw mappings are ephemeral: validated fields are copied out
    and the mappings are dropped — never logged, signed, or written into any
    evidence bundle.
    """
    anchor_id = None if anchor is None else anchor.id
    before = pages.raw_deployments(environment="production")
    if not before:
        return None

    def _select(entries: Sequence[Mapping[str, Any]], *, when: str) -> tuple[str, str, bool]:
        if anchor_id is None:
            return _raw_production_head(entries, when=when)
        for entry in entries:
            if isinstance(entry, Mapping) and entry.get("id") == anchor_id:
                return _raw_production_head([entry], when=when)
        raise DeployAborted(
            f"the serving anchor {anchor_id} is absent from the raw production "
            f"listing {when}; refusing to derive a rollback expectation. "
            "Nothing was frozen or uploaded"
        )

    head_before = _raw_production_head(before, when="before the observation")
    target_before = _select(before, when="before the observation")

    observation = observer(domain_url)

    # Bind the observation to the target, inside the bracket. The head-stability
    # check below cannot see a deploy that landed before the first read; this
    # can, because such a deploy makes the domain serve markers the anchor does
    # not.
    observed: ServedIdentity | None = None
    if anchor is not None:
        if probe is None:
            raise DeployAborted(
                "the rollback expectation cannot be bound to the serving "
                f"anchor {anchor_id}: no serving probe was supplied, so the "
                "observation and the rollback target cannot be proven to be "
                "the same deployment. Nothing was frozen or uploaded"
            )
        observed = ServedIdentity(
            build_id=observation.build_id, code_sha=observation.code_sha
        )
        anchored = probe(anchor.url)
        if anchored is None:
            raise DeployAborted(
                f"the rollback expectation cannot be bound to the serving "
                f"anchor {anchor_id} ({anchor.url}): it did not answer with "
                "one build_id and one code_sha, so the observation cannot be "
                "proven to be that deployment. Nothing was frozen or uploaded"
            )
        if anchored != observed:
            raise DeployAborted(
                f"the rollback observation is not the serving anchor's: "
                f"{domain_url} served {observed!r} while the anchor "
                f"{anchor_id} ({anchor.url}) serves {anchored!r}; a deploy "
                "landed between the anchor proof and this capture, so the "
                "expectation would pair an old rollback target with the new "
                "deployment's body and markers. Nothing was frozen or uploaded"
            )

    after = pages.raw_deployments(environment="production")
    head_after = _raw_production_head(after, when="after the observation")
    target_after = _select(after, when="after the observation")
    if head_before != head_after or target_before != target_after:
        raise DeployAborted(
            f"the raw production listing changed while the rollback expectation "
            f"was being captured (first entry {head_before[0]} → {head_after[0]}, "
            f"target {target_before[0]} → {target_after[0]}); a deploy raced "
            "this run. Nothing was frozen or uploaded"
        )

    # Close the bracket on the LIVE DOMAIN, not on the anchor. A per-deployment
    # anchor URL is immutable — it always serves its own build — so re-probing
    # it can never reveal that the DOMAIN moved. A provider-side rollback that
    # lands after the observation repoints the domain at an older deployment
    # WITHOUT changing newest-by-creation listing order, so both raw reads and
    # the anchor comparison above still agree while the observation now
    # describes a deployment the domain no longer serves. Only a second look at
    # the domain itself sees that.
    if anchor is not None and observed is not None:
        assert probe is not None  # established above with the anchor
        serving_now = probe(domain_url)
        if serving_now is None:
            raise DeployAborted(
                f"the rollback expectation could not be closed: {domain_url} "
                "did not answer with one build_id and one code_sha at the end "
                f"of the capture bracket, so the observation of anchor "
                f"{anchor_id} cannot be proven still current. Nothing was "
                "frozen or uploaded"
            )
        if serving_now != observed:
            raise DeployAborted(
                f"the live domain changed while the rollback expectation was "
                f"being captured: {domain_url} served {observed!r} at the "
                f"observation and {serving_now!r} at the close of the bracket. "
                "A provider-side rollback landed under this run, so the "
                f"expectation would compensate to {anchor_id} rather than to "
                "the deployment that was actually serving. Nothing was frozen "
                "or uploaded"
            )

    identifier, environment, uses_functions = target_after
    return RollbackExpectation(
        deployment_id=identifier,
        environment=environment,
        uses_functions=uses_functions,
        observation=observation,
    )


def observe_rollback_root(client: Any) -> RollbackObserver:
    """The production :class:`RollbackObserver`: ONE custom-domain root GET.

    Exactly one request — a UUID cache-bust query, ``Cache-Control: no-cache``,
    ``Pragma: no-cache``, ``follow_redirects=False`` — requiring HTTP 200.
    Body hash/length, exactly one non-empty ``populus:build_id`` and
    ``populus:code_sha``, and the shared normalized security-header multimap
    (explicit absence, more than one occurrence refused rather than collapsed)
    all derive from that one response. Transport failure, 429/5xx, any non-200,
    duplicate/missing/empty markers, or an ambiguous header raises
    :class:`DeployAborted` — before snapshot or upload on the capture leg, and
    read as "not restored" on the post-rollback leg.
    """

    def _observe(domain_url: str) -> RollbackSiteObservation:
        url = f"{domain_url.rstrip('/')}/?{CACHE_BUST_PARAM}={uuid4().hex}"
        try:
            response = client.get(
                url, headers=_REQUEST_HEADERS, follow_redirects=False
            )
        except AssertionError:
            # The suite's no-network guard: an accidental real fetch must fail
            # loudly, never launder into a tidy abort.
            raise
        except Exception as exc:
            raise DeployAborted(
                f"the rollback observation could not be taken: transport error "
                f"fetching {domain_url}: {exc}. Nothing was frozen or uploaded"
            ) from exc
        status = getattr(response, "status_code", None)
        if status != 200:
            raise DeployAborted(
                f"the rollback observation requires HTTP 200 from the "
                f"custom-domain root; {domain_url} answered {status!r}. "
                "Nothing was frozen or uploaded"
            )
        body = response.content
        markers = read_markers(body)
        values: dict[str, str] = {}
        for name in (MARKER_BUILD_ID, MARKER_CODE_SHA):
            found = markers.get(name, [])
            if len(found) != 1 or not found[0].strip():
                raise DeployAborted(
                    f"the rollback observation requires exactly one non-empty "
                    f"{name!r} marker; {domain_url} served {len(found)}. "
                    "Nothing was frozen or uploaded"
                )
            values[name] = found[0]
        raw_headers: HeaderMultimap = response.headers
        normalized = normalize_security_header_multimap(raw_headers)
        ambiguous = sorted(
            name for name, occurrences in normalized.items() if len(occurrences) > 1
        )
        if ambiguous:
            raise DeployAborted(
                f"the rollback observation refuses ambiguous security "
                f"header(s) {ambiguous} on {domain_url}: more than one "
                "occurrence is refused, never collapsed. Nothing was frozen "
                "or uploaded"
            )
        import hashlib

        return RollbackSiteObservation(
            body_sha256=hashlib.sha256(body).hexdigest(),
            body_length=len(body),
            build_id=values[MARKER_BUILD_ID],
            code_sha=values[MARKER_CODE_SHA],
            headers=tuple(sorted(normalized.items())),
        )

    return _observe


#: How many production deployments to probe when resolving the anchor. The
#: common case matches on the first (nothing rolled back); the bound exists so a
#: project with a long history cannot turn one deploy into hundreds of probes.
ANCHOR_SEARCH_LIMIT = 20


def _resolve_serving_anchor(
    client: PagesSurface, probe: ServingProbe, *, domain_url: str
) -> Any:
    """The production deployment that serves what the domain serves.

    The original rule proved the anchor and refused on divergence, which is right — rolling
    back to "newest by creation" would move the site to a build nobody asked
    for. But refusing is only half an answer: a provider-side rollback creates
    that divergence *by design*, and the runbook offers it as the operational
    escape hatch, so the deploy path stayed blocked until someone deleted
    deployment history. Run 31866841710 died here with the domain on the
    attested `d823597b…` and the newest-by-creation deployment on `4fd29878…`
    — a divergence the previous run's own compensating rollback had created.

    So resolve it instead: walk production deployments newest-first and take the
    first one whose FULL served identity — `populus:build_id` AND
    `populus:code_sha` — equals the domain's. Both, because a code-only match is
    not a build match: two deployments cut from one commit against different
    data builds are indistinguishable by `code_sha`, so a code-only walk takes
    the newest of them rather than the one serving, and a later compensating
    rollback restores a build nobody asked for. That IS the
    anchor by definition — the deployment currently serving. The caller still
    runs `_assert_anchor_is_serving` afterwards, so a wrong answer here fails
    closed rather than compensating onto the wrong build.
    """
    served = probe(domain_url)
    if served is None:
        raise RollbackAnchorUnverified(
            f"cannot resolve the rollback anchor: {domain_url} did not answer "
            f"with one {MARKER_BUILD_ID!r} and one {MARKER_CODE_SHA!r}. "
            "Nothing was uploaded; production is "
            "untouched. Re-run once the domain answers"
        )
    examined: list[str] = []
    for deployment in list(client.production_deployments())[:ANCHOR_SEARCH_LIMIT]:
        if deployment.environment != "production":
            continue
        examined.append(deployment.id)
        if probe(deployment.url) == served:
            return deployment
    raise RollbackAnchorUnverified(
        f"no production deployment serves what {domain_url} serves "
        f"({served!r}); examined {len(examined)} of the newest "
        f"{ANCHOR_SEARCH_LIMIT} ({', '.join(examined[:5])}"
        f"{', …' if len(examined) > 5 else ''}). Nothing was uploaded; "
        "production is untouched. The domain is serving something this project "
        "did not deploy, or the deployment that served it was deleted"
    )


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
    await_origin: OriginReadiness | None = None,
    settle: Callable[[float], None] = time.sleep,
    serving_probe: ServingProbe,
    observer: RollbackObserver,
) -> DeployOutcome:
    """Run the §12.1 deploy sequence in order, or raise saying where it stopped.

    Raises :class:`DeployAborted` when a precondition refuses before production
    is touched, :class:`PreviewVerificationFailed` when the preview does not
    verify, :class:`ProductionVerificationFailed` when the live domain does not
    (after rolling back), and :class:`FirstRunUncompensated` when that happens on
    a run with no rollback target. Cloudflare's own
    :class:`~populus.deploy.cloudflare.PagesUnavailable` propagates untouched:
    "could not ask" is not this module's verdict to convert.
    """
    if preview_branch == production_branch:
        raise DeployAborted(
            f"the preview branch {preview_branch!r} equals the production branch: "
            "Pages derives the environment from the branch name, so this would "
            "publish the 'preview' straight to production and the ordered sequence's "
            "preview-verifies-before-production ordering would be a fiction"
        )

    # --- (1) production identity, before anything is uploaded ----------------
    client.assert_production_branch(production_branch)

    # --- (2) the domain precondition, before anything is uploaded ------------
    client.assert_custom_domain_active(custom_domain)

    # --- (3) the rollback target, captured BEFORE the production upload ------
    # RESOLVED as the deployment the domain actually serves, not assumed
    # to be the newest by creation — those are different questions, and any
    # provider-side rollback makes them different answers. `latest_production_
    # deployment()` still decides whether there is a prior deployment at all
    # (the first-run None), so the first-run path is unchanged.
    prior = client.latest_production_deployment()
    if prior is not None:
        prior = _resolve_serving_anchor(
            client, serving_probe, domain_url=_domain_url(custom_domain)
        )
    # And still PROVED, after resolution. Kept deliberately: the resolver
    # above is now the thing that could be wrong, and this is what makes a wrong
    # answer fail closed. Before any upload, so a refusal costs nothing —
    # production is untouched.
    if prior is not None:
        _assert_anchor_is_serving(
            serving_probe, prior=prior, domain_url=_domain_url(custom_domain)
        )

    # --- (3b) LD12a/LD12c: rollback evidence, BEFORE the freeze --------------
    # One raw-identity + one coherent domain-root observation, bracketed by raw
    # provider reads. Any capture failure — transport, non-200, marker/header
    # ambiguity, provider-id drift, malformed payload — raises DeployAborted
    # here, with ZERO snapshot/upload/provider-mutation calls made.
    expectation: RollbackExpectation | None = None
    if prior is not None:
        expectation = capture_rollback_expectation(
            client,
            observer,
            _domain_url(custom_domain),
            anchor=prior,
            probe=serving_probe,
        )
        if expectation is None:
            raise DeployAborted(
                "the provider reported a prior production deployment and then "
                "an empty raw production listing; the rollback expectation "
                "cannot be captured. Nothing was frozen or uploaded"
            )
        if expectation.deployment_id != prior.id:
            raise DeployAborted(
                f"provider-id drift while capturing rollback evidence: the "
                f"serving anchor is {prior.id} but the expectation resolved to "
                f"{expectation.deployment_id}. Nothing was frozen or uploaded"
            )
    rollback_target = expectation.deployment_id if expectation is not None else None

    # --- (4) freeze: from here the uploader only ever sees sealed bytes ------
    snapshot = freeze_tree(source)
    try:
        # --- (5) preview, verified inventory-wide -----------------------
        preview = _upload(upload, snapshot, environment=PREVIEW, branch=preview_branch)
        _await(await_origin, preview.url, stage=PREVIEW)
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
                "prior deployment is still serving."
            )

        # --- (6) provably the same bytes --------------------------------------
        _require_seal_intact(snapshot)
        production = _upload(
            upload, snapshot, environment=PRODUCTION, branch=production_branch
        )

        # --- (7) verify the live custom domain --------------------------------
        domain_url = _domain_url(custom_domain)
        _await(await_origin, f"https://{custom_domain}", stage=PRODUCTION)
        # `_await` returns as soon as the origin ANSWERS; individual
        # objects can still be materialising behind it, and a partially written
        # body reads as a hash mismatch — which the 404 tolerance rightly refuses to wait
        # out. So the wait happens here, before the question is asked, where it
        # cannot soften any answer.
        settle(POST_PROMOTION_SETTLE_SECONDS)
        production_result = verify(
            domain_url,
            stage=PRODUCTION,
            inventory=snapshot.inventory,
            deployment=dict(production.payload),
        )
        # Absorb custom-domain propagation lag, and NOTHING else. The
        # re-verification is the SAME inventory-wide check, not a spot-check of
        # the paths that 404'd — so the verdict that lets a deploy stand is
        # always a full verification, never a composite of one full pass plus a
        # patch. Bounded by PROPAGATION_RETRIES, and every attempt says so out
        # loud: a silent retry would turn a genuinely broken deploy into a slow
        # one.
        attempts = 0
        while (
            not production_result.ok
            and attempts < PROPAGATION_RETRIES
            and _propagation_lag_only(production_result)
        ):
            attempts += 1
            # Derived from `divergences`, which `_propagation_lag_only` just
            # proved non-empty — not from `diverged_paths`, which the
            # VerificationOutcome Protocol does not require of a test double.
            lagging = sorted({d.path for d in production_result.divergences})
            print(
                f"deploy: production verification found only propagation-shaped "
                f"404s on {len(lagging)} path(s) ({', '.join(lagging[:5])}"
                f"{', …' if len(lagging) > 5 else ''}); settling "
                f"{PROPAGATION_SETTLE_SECONDS:g}s and re-verifying the full "
                f"inventory once (attempt {attempts}/{PROPAGATION_RETRIES})",
                file=sys.stderr,
            )
            settle(PROPAGATION_SETTLE_SECONDS)
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
                observer=observer,
                domain_url=domain_url,
                expectation=expectation,
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
    the damage the step ordering exists to prevent, and the run must stop rather than
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
            "required inventory-wide sweep has nothing to fetch"
        )
    return uploaded


def _require_seal_intact(snapshot: UploadSnapshot) -> None:
    """Re-hash the sealed tree immediately before the production upload.

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
    observer: RollbackObserver,
    domain_url: str,
    expectation: RollbackExpectation | None,
    result: VerificationOutcome,
    runbook: str,
) -> NoReturn:
    """Step 8: roll back to the captured expectation, or declare TD-4.

    LD12a: restoration is judged against the PRE-UPLOAD expectation — the raw
    prior provider identity and the one coherent root observation — never
    against the attempted (failed) artifact's inventory. The raw rollback
    response must name the captured id, ``environment == "production"``, and an
    explicit ``uses_functions is False``; a fresh observation (fresh UUID, same
    adapter) must match the captured one exactly. Any mismatch or
    unavailability keeps ``rollback_verified=False`` on the existing loud
    :class:`ProductionVerificationFailed`/operator-runbook path.
    """
    if expectation is None:
        raise FirstRunUncompensated(_td4_message(result, runbook))
    rollback_target = expectation.deployment_id

    # The provider's own object, verbatim. Reconstructing a mapping from the
    # typed `Deployment` here would set `uses_functions` to `bool(...)` of a
    # possibly-absent field, and the no-Functions requirement — which exists to
    # fail closed when the provider says nothing — could never do so here.
    restored = client.rollback_payload(rollback_target)
    problems: list[str] = []
    if restored.get("id") != rollback_target:
        problems.append(
            f"the raw rollback response names {restored.get('id')!r}, not the "
            f"captured target {rollback_target}"
        )
    if restored.get("environment") != "production":
        problems.append(
            f"the raw rollback response reports environment "
            f"{restored.get('environment')!r}, not 'production'"
        )
    if "uses_functions" not in restored or restored["uses_functions"] is not False:
        problems.append(
            "the raw rollback response does not carry an explicit "
            f"uses_functions=False (observed "
            f"{restored.get('uses_functions', '<absent>')!r})"
        )
    if not problems:
        try:
            fresh = observer(domain_url)
        except DeployAborted as exc:
            problems.append(f"the post-rollback observation was unavailable: {exc}")
        else:
            if fresh != expectation.observation:
                problems.append(
                    "the post-rollback observation does not match the captured "
                    "one exactly: "
                    + _observation_drift(expectation.observation, fresh)
                )

    restored_state = (
        "the restored deployment matches the pre-upload expectation exactly "
        "(raw id/environment/no-Functions, root body, both markers, and the "
        "security-header multimap)"
        if not problems
        else "the restored deployment did NOT verify: " + "; ".join(problems)
    )
    raise ProductionVerificationFailed(
        f"production verification did not pass ({result.outcome}) at {domain_url}: "
        f"{result.detail}. Rolled back to the deployment captured before the "
        f"upload ({rollback_target}); {restored_state}.",
        rolled_back_to=rollback_target,
        rollback_verified=not problems,
    )


def _observation_drift(
    expected: RollbackSiteObservation, observed: RollbackSiteObservation
) -> str:
    """Name exactly which fields drifted, so the 3am read needs no diffing."""
    drifted = [
        f"{field_name} {getattr(expected, field_name)!r} -> "
        f"{getattr(observed, field_name)!r}"
        for field_name in (
            "body_sha256",
            "body_length",
            "build_id",
            "code_sha",
            "headers",
        )
        if getattr(expected, field_name) != getattr(observed, field_name)
    ]
    return "; ".join(drifted)


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
        "identical sealed bytes passed the inventory-wide preview sweep, so "
        "start by suspecting routing, cache or domain state rather than the "
        "build. This exposure exists exactly once: after the first successful "
        "production deploy every run has a rollback target and TD-4 is gone."
    )


def _domain_url(custom_domain: str) -> str:
    """Verify the live custom domain, not the deployment's own origin."""
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
    trust model, and it belongs to the signer, which re-derives it in
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

    try:
        observed = build_inventory(source)
    except InventoryError as exc:
        raise ArtifactRefused(
            f"{source} does not produce an exact inventory v2: {exc}"
        ) from exc
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

    # LD12b: the external CLI seam validates the FULL document — the byte
    # comparison above proves declared == observed, and this proves observed is
    # an exact v2 envelope in its own right, refused before any provider call.
    try:
        validate_inventory_v2(observed)
    except InventoryError as exc:
        raise ArtifactRefused(
            f"{inventory_path} is not an exact inventory v2: {exc}"
        ) from exc

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
            "the branch this workflow is locked to; the deploy asserts Cloudflare agrees "
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
    # Security invariant: there is deliberately NO
    # --wrangler-package (or any other wrangler override) flag. The uploader
    # invokes only the lock-installed dashboard/node_modules/.bin/wrangler, and
    # a CLI seam that could name a different package would reintroduce the
    # deploy-time remote-install path this run removed.
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


def serving_probe(client: Any, *, marker_path: str = DEFAULT_MARKER_PATH) -> ServingProbe:
    """The real :class:`ServingProbe`: fetch the marker page, read its identity.

    Cache-busted like every other served-tree read in this codebase — a cached
    answer would defeat the whole point of asking what is live NOW. Anything
    other than a clean 200 carrying exactly one non-empty `populus:build_id`
    AND exactly one non-empty `populus:code_sha` is
    reported as ``None`` ("could not ask"), never guessed at, because the caller
    treats a confident wrong answer as licence to roll back to the wrong build.
    Both markers, because `code_sha` alone names a COMMIT, not a build.
    """

    def _probe(base_url: str) -> ServedIdentity | None:
        # Request the path the PROVIDER answers 200 on, not the
        # inventory path. `served_path("index.html")` is "" — Pages redirects
        # /index.html to / with a 307 (the status a live origin returns, and
        # what the `_Origin` fixture reproduces), and with redirects refused
        # (correctly) the literal path never reaches 200 — so the probe
        # answered None for every deployment and the anchor proof became a blanket
        # pre-upload refusal.
        path = served_path(marker_path)
        # A FRESH bust per request. A fixed key is not a cache bust;
        # a cached domain marker matching a cached anchor marker is exactly the
        # agreement the anchor proof must not be fooled by. Same param and same uuid4().hex
        # pattern the verifier's own fetches use.
        separator = "&" if "?" in path else "?"
        url = (
            f"{base_url.rstrip('/')}/{path}{separator}"
            f"{CACHE_BUST_PARAM}={uuid4().hex}"
        )
        try:
            response = client.get(
                url, headers=_REQUEST_HEADERS, follow_redirects=False
            )
        except AssertionError:
            # The suite's no-network guard. Laundering it into None would let an
            # accidental real fetch read as "could not ask" — the same shape as
            # `_fetch`'s carve-out, and for the same reason.
            raise
        except Exception:
            return None
        if getattr(response, "status_code", None) != 200:
            return None
        markers = read_markers(response.content)
        found: dict[str, str] = {}
        for name in (MARKER_BUILD_ID, MARKER_CODE_SHA):
            values = markers.get(name, [])
            # An EMPTY marker is not a value. Two empty strings compare
            # equal, which would have read as "the anchor is serving" — the
            # exact bypass this check exists to prevent. Matches `_one_marker`.
            if len(values) != 1 or not values[0].strip():
                return None
            found[name] = values[0]
        return ServedIdentity(
            build_id=found[MARKER_BUILD_ID], code_sha=found[MARKER_CODE_SHA]
        )

    return _probe


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
    readiness_factory=None,
    settle_factory=None,
    probe_factory=None,
    observer_factory=None,
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
        await_origin,
        DeploymentVerifier,
        PagesDeploySurface,
        UploadFailed,
        WranglerUploader,
        resolve_wrangler_executable,
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
        # Resolve the lock-installed binary — and refuse on missing or
        # non-executable local state — BEFORE any upload, verification, or
        # provider call. The workflow additionally asserts the binary and its
        # version before the token-bearing step; this is the Python-side half
        # of the same fail-closed contract, and it never fetches anything.
        try:
            wrangler = resolve_wrangler_executable()
        except UploadFailed as exc:
            print(f"deploy: {exc}", file=sys.stderr)
            _emit_outputs(outcome=OUTCOME_MISCONFIGURED)
            return EXIT_MISCONFIGURED
        upload = WranglerUploader(
            project=project,
            lookup=pages,
            executable=wrangler,
        )
    readiness_client = http_factory() if http_factory is not None else _default_http_client()
    if verifier_factory is not None:
        verify = verifier_factory()
    else:
        verify = DeploymentVerifier(
            client=readiness_client,
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
            # Injected so the suite never sleeps: a test that drives main()
            # end to end would otherwise pay the real backoff on every mocked
            # 522, which is how this poller first made the tests hang.
            await_origin=(
                readiness_factory()
                if readiness_factory is not None
                else await_origin(readiness_client)
            ),
            # Same reason as await_origin: a test that drives main() through a
            # propagation-shaped rejection must not pay the real settle.
            settle=(settle_factory() if settle_factory is not None else time.sleep),
            # Always a real probe here. `run_deployment` takes this as a
            # REQUIRED keyword precisely so no caller can quietly opt out of the
            # anchor cross-check by omitting it.
            serving_probe=(
                probe_factory()
                if probe_factory is not None
                else serving_probe(readiness_client)
            ),
            # LD12c: always a real observer here. `run_deployment` takes this
            # as a REQUIRED keyword precisely so no caller can quietly opt out
            # of pre-upload rollback-evidence capture by omitting it.
            observer=(
                observer_factory()
                if observer_factory is not None
                else observe_rollback_root(readiness_client)
            ),
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
        # "We could not ask" is not "the answer was no". A rate-limited or
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
