"""§12.1 step 6 / §5.5 R13: the deployment signer, which trusts nothing it is told.

The deploy job is privileged — it holds the Cloudflare `Pages Edit` token and it
uploads the bytes. This module runs afterwards, in a *different* workflow with a
different identity (`record-sign.yml`, §5.5), and its entire reason to exist is
that it re-derives every field it signs. An attestation proves who emitted some
bytes; it proves nothing about whether the emitter checked them. So:

* **`build_id`** comes from the published pointer and manifest **after both
  verify against their attestations** — never from a job output, never from the
  artifact alone.
* **`code_sha`, `dist_digest`, `inventory_digest` and the inventory** come from
  the immutable `dist/` artifact this workflow downloads itself. The inventory
  is recomputed from the tree and required to be byte-identical to the shipped
  `inventory.json` before a single entry of it is believed.
* **`cf_production_deployment_id`** is read from the Cloudflare Pages API with
  the signer's own `Pages Read` token. The deploy job's claim, when the caller
  passes one, is *cross-checked* against that answer — a mismatch is a finding,
  not an input.
* **The served bytes** are swept inventory-wide by :mod:`populus.deploy.verify`.
  Marker-only checking is what this run's R15 exists to forbid: a compromised
  deploy job can preserve `build_id`, `code_sha` and `stats.json` exactly while
  replacing every HTML and JS file behind them.

**No non-GET Cloudflare request is issued from this module (R27, §17(h) as
amended).** §17(h) used to require the signer to "fail closed on a `Pages
Write`-scoped token", which is not observable: a `Pages Edit` token succeeds at
every read performed here, no response field distinguishes it, and the signer
cannot introspect its own scope (`GET /user/tokens/verify` returns no policies,
and the endpoint that does return them is one a sole-`Pages Read` token has no
permission to call). The amendment replaces it with the property that *is*
observable and is the one actually wanted — an over-scoped token cannot be
*used* to write from here, whatever it is scoped for. The enforcement is
structural rather than a promise in prose: every Cloudflare call goes through
:class:`CloudflareReads`, whose entire surface is
:data:`CloudflareReads.READ_SURFACE`, and the injected transport in
`tests/test_deploy_record.py` fails the test on any verb other than ``GET``.
The property is scoped to **this module**: the deploy job legitimately POSTs
(upload, rollback), so an unscoped version of it would be false by construction.

**Why the raw deployment payload, and not `PagesClient.latest_production_deployment()`.**
That method returns a typed :class:`~populus.deploy.cloudflare.Deployment` whose
``uses_functions`` is ``bool(entry.get("uses_functions"))`` — which turns a
*missing* provider signal into a confident ``False``. R16's no-Functions check
fails closed on a missing field precisely so an absent signal can never read as
"there are none", and handing it a reconstructed mapping would delete that
property while appearing to keep it. The signer therefore reads the same pinned
endpoint's raw result through the client's own request helper, and passes the
provider's object through untouched. A test removes ``uses_functions`` from the
recorded fixture and requires a refusal.

**Two failure kinds, never one** (R17). ``rejected`` means we got answers and
they did not line up. ``unavailable`` means we did not get an answer — a
transport failure, a 429, a 5xx, an attestation-API quota error. A rate limit
reported as tampering is a false alarm on the loudest channel the project has,
so the vocabulary is imported from :mod:`populus.publish.attestation` rather
than re-declared here.

**The subject name is pinned in code, not only in YAML (R25).**
``actions/attest-build-provenance`` names subjects by **basename** when given a
``subject-path``, so a generation written to
``builds/<id>/deployments/<gen>.json`` would attest as ``<gen>.json`` — and
:func:`populus.publish.attestation.resolve_identity` *refuses* that name, because
it is neither in ``SUBJECT_IDENTITIES`` nor under the ``deployments/`` prefix.
The record would be unverifiable by the verifier this project already ships.
:func:`generation_subject_name` therefore builds the name, and
:func:`sign_deployment` refuses to write anything whose subject name does not
resolve to the record-signer identity. The workflow attests the name this module
emits (``subject-name`` + ``subject-digest``), so the YAML cannot drift from it.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from populus.deploy.cloudflare import CustomDomain, PagesClient, PagesRejected, PagesUnavailable
from populus.deploy.verify import (
    DEFAULT_MARKER_PATH,
    DEFAULT_STATS_PATH,
    MARKER_BUILD_ID,
    MARKER_CODE_SHA,
    TD10_NOTE,
    VERIFICATION_SCOPE,
    HttpGetter,
    VerificationResult,
    VerifyUnavailable,
    check_markers,
    read_markers,
    sweep_inventory,
    verify_deployment,
)
from populus.publish import atomic_write_bytes
from populus.publish.attestation import (
    DEPLOYMENT_SUBJECT_PREFIX,
    P2_RECORD_SIGN_IDENTITY,
    REJECTED,
    UNAVAILABLE,
    VERIFIED,
    AttestationProvider,
    resolve_identity,
)
from populus.publish.digests import DIST_DIGEST_VERSION
from populus.publish.inventory import build_inventory, inventory_digest, render_inventory
from populus.publish.manifest import resolve_within
from populus.publish.pointer import rfc3339z

__all__ = [
    "ACCOUNT_ID_ENV",
    "EXIT_MISCONFIGURED",
    "EXIT_REJECTED",
    "EXIT_UNAVAILABLE",
    "EXIT_VERIFIED",
    "PAGES_READ_TOKEN_ENV",
    "ArtifactFacts",
    "CloudflareReads",
    "ProductionDeployment",
    "RecordRefused",
    "RecordUnavailable",
    "SigningResult",
    "artifact_facts",
    "attested_build_id",
    "generation_subject_name",
    "main",
    "next_generation",
    "render_generation",
    "sign_deployment",
]

#: Where the pointer lives in a `populus-data` checkout, and the two subject
#: names the existing verifier maps to the publish identity.
POINTER_NAME = "latest.json"
POINTER_SUBJECT = "latest.json"
MANIFEST_SUBJECT = "manifest.json"

#: The artifact layout §12.1 specifies: the deployable tree, and the inventory
#: as a **sibling outside it** so the inventory never inventories itself.
SITE_DIRNAME = "site"
INVENTORY_NAME = "inventory.json"

#: Generations are append-only, one directory per build (§5.5).
DEPLOYMENTS_DIRNAME = "deployments"

#: Read by :func:`main` only. The signer holds a `Pages Read` token and an
#: account id; it never sees a `Pages Write` credential (§14).
PAGES_READ_TOKEN_ENV = "CLOUDFLARE_PAGES_READ_TOKEN"
ACCOUNT_ID_ENV = "CLOUDFLARE_ACCOUNT_ID"

#: Exit codes, deliberately distinguishable — a verification failure and an
#: unreachable API are different problems and must page differently.
EXIT_VERIFIED = 0
EXIT_REJECTED = 1
EXIT_UNAVAILABLE = 2
EXIT_MISCONFIGURED = 3


class RecordRefused(Exception):
    """We reached everything we needed to and the answer was no."""


class RecordUnavailable(Exception):
    """No verdict was reached (R17) — nothing is attested, nothing is accused."""


@dataclass(frozen=True)
class ProductionDeployment:
    """The project's current production deployment, as the provider described it.

    ``payload`` is the provider's own object, carried verbatim so R16's
    no-Functions assertion reads the field's real presence or absence.
    """

    id: str
    url: str
    payload: Mapping[str, Any]


class CloudflareReads:
    """The signer's **entire** Cloudflare surface — and every method is a GET.

    One class, two methods, no write verb reachable from here (R27). The class
    exists so the property is a shape a reader and a test can both check, rather
    than an absence someone has to prove by reading every line of the module.
    """

    #: Pinned so a test can assert the surface did not quietly grow.
    READ_SURFACE = ("active_custom_domain", "production_deployment")

    def __init__(self, client: PagesClient) -> None:
        self._client = client

    def production_deployment(self) -> ProductionDeployment:
        """``GET …/deployments?env=production`` — the raw newest production entry.

        The raw result rather than the typed one: see the module docstring on
        ``uses_functions``. The pinned path and the verb guard both still come
        from :class:`~populus.deploy.cloudflare.PagesClient`, so this reads the
        same endpoint the deploy path reads, through the same transport.
        """
        result = self._client._request(
            "GET", self._client._deployments_path(), params={"env": "production"}
        )
        if not isinstance(result, list):
            raise PagesRejected(
                f"deployments endpoint returned {type(result).__name__}, not a list"
            )
        for entry in result:
            if not isinstance(entry, Mapping):
                raise PagesRejected(
                    f"deployment entry is {type(entry).__name__}, not an object"
                )
            if entry.get("environment") != "production":
                continue
            identifier = entry.get("id")
            url = entry.get("url")
            if not isinstance(identifier, str) or not identifier:
                raise PagesRejected(f"production deployment has no id: {entry!r}")
            if not isinstance(url, str) or not url:
                raise PagesRejected(
                    f"production deployment {identifier!r} carries no url; there is "
                    "no deployment-specific origin to verify against"
                )
            return ProductionDeployment(id=identifier, url=url, payload=dict(entry))
        raise PagesRejected(
            "the project reports no production deployment; there is nothing live "
            "to record (a first run records only after production is up)"
        )

    def active_custom_domain(self, domain: str) -> CustomDomain:
        """``GET …/projects/{project}/domains`` — the only endpoint with status."""
        return self._client.assert_custom_domain_active(domain)


@dataclass(frozen=True)
class ArtifactFacts:
    """Everything the signer derived from the artifact it downloaded itself."""

    inventory: dict
    inventory_digest: str
    dist_digest: str
    build_id: str
    code_sha: str
    stats_bytes: bytes


@dataclass(frozen=True)
class SigningResult:
    """What the signer concluded, and — only when verified — what it wrote."""

    outcome: str
    detail: str
    record: dict | None = None
    document: bytes | None = None
    subject_name: str | None = None
    generation: int | None = None
    path: Path | None = None
    verification: VerificationResult | None = None

    @property
    def ok(self) -> bool:
        return self.outcome == VERIFIED

    @property
    def unavailable(self) -> bool:
        return self.outcome == UNAVAILABLE

    @property
    def subject_digest(self) -> str | None:
        """``sha256:<hex>`` over the exact bytes written — what the action attests."""
        if self.document is None:
            return None
        return f"sha256:{hashlib.sha256(self.document).hexdigest()}"


def generation_subject_name(generation: int) -> str:
    """``deployments/<gen>.json`` — the name R25 pins.

    Not the basename. ``resolve_identity("3.json")`` returns ``None``, which
    means *refuse*, so a generation attested under its basename cannot be
    verified by anything this project ships.
    """
    return f"{DEPLOYMENT_SUBJECT_PREFIX}{generation}.json"


def render_generation(record: Mapping[str, Any]) -> bytes:
    """Byte-stable rendering — the attested subject is exactly the file's bytes."""
    return (
        json.dumps(dict(record), ensure_ascii=False, indent=2, sort_keys=True) + "\n"
    ).encode()


# --- the re-derivations ------------------------------------------------------


def attested_build_id(
    data_repo: Path | str, *, attestation: AttestationProvider
) -> tuple[str, dict]:
    """The build id, from the pointer and manifest **after** both verify.

    Order is the whole point: neither document is parsed for a value we keep
    until its attestation has verified. The pointer's `manifest_sha256` is then
    checked against the manifest's real bytes, and the two `build_id` values
    must agree — a pointer that names one build and a manifest that describes
    another is an equivocation, not a rounding error.
    """
    repo = Path(data_repo)
    pointer_path = repo / POINTER_NAME
    if not pointer_path.is_file():
        raise RecordRefused(f"no published pointer at {pointer_path}")
    pointer_bytes = pointer_path.read_bytes()
    _require_attested(attestation, POINTER_SUBJECT, pointer_bytes)

    pointer = _load_json(pointer_bytes, POINTER_NAME)
    # `manifest_path` comes out of a document we have now verified, but path
    # containment is still enforced: a verified document is not a licence to
    # read anywhere on the filesystem.
    try:
        manifest_path = resolve_within(repo, str(pointer.get("manifest_path")))
    except (ValueError, OSError) as exc:
        raise RecordRefused(f"pointer names an unsafe manifest path: {exc}") from exc
    if not manifest_path.is_file():
        raise RecordRefused(f"no manifest at {manifest_path}")
    manifest_bytes = manifest_path.read_bytes()

    digest = hashlib.sha256(manifest_bytes).hexdigest()
    if digest != pointer.get("manifest_sha256"):
        raise RecordRefused(
            f"manifest sha256 {digest} does not match the pointer's "
            f"{pointer.get('manifest_sha256')!r}"
        )
    _require_attested(attestation, MANIFEST_SUBJECT, manifest_bytes)

    manifest = _load_json(manifest_bytes, "manifest.json")
    build_id = manifest.get("build_id")
    if not isinstance(build_id, str) or not build_id:
        raise RecordRefused("the attested manifest carries no build_id")
    if pointer.get("build_id") != build_id:
        raise RecordRefused(
            f"pointer names build {pointer.get('build_id')!r} but the manifest it "
            f"points at is build {build_id!r}"
        )
    return build_id, manifest


def artifact_facts(
    artifact_dir: Path | str,
    *,
    marker_path: str = DEFAULT_MARKER_PATH,
    stats_path: str = DEFAULT_STATS_PATH,
) -> ArtifactFacts:
    """Recompute everything the record claims about the built tree.

    The shipped `inventory.json` is not read *for* its entries — it is compared
    against an inventory recomputed from the tree, byte for byte in its RFC 8785
    canonical form. If the two agree, the sweep can use the recomputed document
    and the recorded `inventory_digest` describes bytes we hashed ourselves.
    """
    root = Path(artifact_dir)
    site = root / SITE_DIRNAME
    shipped_path = root / INVENTORY_NAME
    if not site.is_dir():
        raise RecordRefused(
            f"the downloaded artifact has no {SITE_DIRNAME}/ tree at {site}"
        )
    if not shipped_path.is_file():
        raise RecordRefused(f"the downloaded artifact has no {INVENTORY_NAME} sibling")

    recomputed = build_inventory(site)
    shipped_bytes = shipped_path.read_bytes()
    if shipped_bytes != render_inventory(recomputed):
        raise RecordRefused(
            "the artifact's inventory.json is not the inventory of the tree beside "
            f"it (recomputed digest {inventory_digest(recomputed)}, shipped "
            f"{hashlib.sha256(shipped_bytes).hexdigest()}); no entry of it is "
            "trusted"
        )
    if recomputed.get("dist_digest_version") != DIST_DIGEST_VERSION:
        raise RecordRefused(
            f"artifact declares dist_digest_version "
            f"{recomputed.get('dist_digest_version')!r}, this signer computes "
            f"{DIST_DIGEST_VERSION!r}"
        )

    marker_file = site / marker_path
    if not marker_file.is_file():
        raise RecordRefused(f"the built tree has no marker page at {marker_path}")
    markers = read_markers(marker_file.read_bytes())
    build_id = _one_marker(markers, MARKER_BUILD_ID, marker_path)
    code_sha = _one_marker(markers, MARKER_CODE_SHA, marker_path)

    stats_file = site / stats_path
    if not stats_file.is_file():
        raise RecordRefused(f"the built tree has no {stats_path}")

    return ArtifactFacts(
        inventory=recomputed,
        inventory_digest=inventory_digest(recomputed),
        dist_digest=str(recomputed["dist_digest"]),
        build_id=build_id,
        code_sha=code_sha,
        stats_bytes=stats_file.read_bytes(),
    )


def next_generation(data_repo: Path | str, build_id: str) -> tuple[int, Path]:
    """The next append-only generation number for *build_id*, and its path.

    Generations are never overwritten: a build may be deployed more than once
    across recovery or rollback, and each deployment is its own record (§5.5).
    An existing file at the computed path is a hard refusal rather than a
    silent replacement — that is what "append-only" has to mean to be worth
    anything.
    """
    directory = Path(data_repo) / "builds" / build_id / DEPLOYMENTS_DIRNAME
    highest = 0
    if directory.is_dir():
        for existing in directory.glob("*.json"):
            try:
                number = int(existing.stem)
            except ValueError:
                raise RecordRefused(
                    f"{existing} is not a numbered generation; refusing to guess "
                    "which generation is current"
                ) from None
            highest = max(highest, number)
    generation = highest + 1
    path = directory / f"{generation}.json"
    if path.exists():
        raise RecordRefused(f"generation {generation} already exists at {path}")
    return generation, path


# --- the whole signing (R13/R15/R16/R17/R25/R27) -----------------------------


def sign_deployment(
    *,
    data_repo: Path | str,
    artifact_dir: Path | str,
    pages: CloudflareReads,
    http: HttpGetter,
    attestation: AttestationProvider,
    domain: str,
    workflow_run_id: str,
    now: datetime,
    dist_artifact_id: str | None = None,
    dist_artifact_expires_at: str | None = None,
    claimed_deployment_id: str | None = None,
    claimed_dist_digest: str | None = None,
    marker_path: str = DEFAULT_MARKER_PATH,
    stats_path: str = DEFAULT_STATS_PATH,
) -> SigningResult:
    """Verify the live deployment and write the next attested generation.

    Every ``claimed_*`` argument is exactly that — the deploy job's word for
    something. Each is cross-checked against a value derived here, and a
    mismatch is a refusal. None of them is ever recorded in place of the derived
    value.

    A malformed inventory envelope raises
    :class:`~populus.deploy.verify.VerifyInputError` rather than becoming a
    verdict, deliberately and for the same reason ``verify.py`` does it: "the
    inventory we were handed is not an inventory" is neither "the site is fine"
    nor "the site was tampered with". In the workflow it fails the job, which is
    closed.
    """
    try:
        return _sign(
            data_repo=data_repo,
            artifact_dir=artifact_dir,
            pages=pages,
            http=http,
            attestation=attestation,
            domain=domain,
            workflow_run_id=workflow_run_id,
            now=now,
            dist_artifact_id=dist_artifact_id,
            dist_artifact_expires_at=dist_artifact_expires_at,
            claimed_deployment_id=claimed_deployment_id,
            claimed_dist_digest=claimed_dist_digest,
            marker_path=marker_path,
            stats_path=stats_path,
        )
    except RecordUnavailable as exc:
        return SigningResult(outcome=UNAVAILABLE, detail=f"no verdict: {exc}")
    except (RecordRefused, PagesRejected) as exc:
        return SigningResult(outcome=REJECTED, detail=f"refused to attest: {exc}")
    except PagesUnavailable as exc:
        # R17 again, one layer down: the Pages API not answering is an outage.
        return SigningResult(outcome=UNAVAILABLE, detail=f"no verdict: {exc}")


def _sign(
    *,
    data_repo: Path | str,
    artifact_dir: Path | str,
    pages: CloudflareReads,
    http: HttpGetter,
    attestation: AttestationProvider,
    domain: str,
    workflow_run_id: str,
    now: datetime,
    dist_artifact_id: str | None,
    dist_artifact_expires_at: str | None,
    claimed_deployment_id: str | None,
    claimed_dist_digest: str | None,
    marker_path: str,
    stats_path: str,
) -> SigningResult:
    # Keyword, always: `test_attestation_structure.py` flags any production call
    # to an attestation-taking callable that passes it positionally, because a
    # positional argument is one refactor away from being an inherited default.
    build_id, _manifest = attested_build_id(data_repo, attestation=attestation)
    facts = artifact_facts(artifact_dir, marker_path=marker_path, stats_path=stats_path)

    if facts.build_id != build_id:
        raise RecordRefused(
            f"the downloaded artifact was built for {facts.build_id!r} but the "
            f"attested pointer publishes {build_id!r}; this artifact is not this "
            "build's site"
        )
    if claimed_dist_digest is not None and claimed_dist_digest != facts.dist_digest:
        raise RecordRefused(
            f"the deploy job claims dist_digest {claimed_dist_digest!r}; the "
            f"artifact hashes to {facts.dist_digest!r}"
        )

    deployment = pages.production_deployment()
    if claimed_deployment_id and claimed_deployment_id != deployment.id:
        raise RecordRefused(
            f"the deploy job claims production deployment "
            f"{claimed_deployment_id!r}; Cloudflare reports {deployment.id!r} is "
            "the project's production deployment. The mismatch is the finding."
        )
    pages.active_custom_domain(domain)

    verification = verify_deployment(
        http,
        deployment.url,
        inventory=facts.inventory,
        build_id=build_id,
        code_sha=facts.code_sha,
        stats_bytes=facts.stats_bytes,
        deployment=deployment.payload,
        marker_path=marker_path,
        stats_path=stats_path,
    )
    if verification.unavailable:
        raise RecordUnavailable(verification.detail)
    if not verification.ok:
        raise RecordRefused(
            f"the deployment did not verify: {'; '.join(verification.findings)}"
        )
    if verification.verification_scope != VERIFICATION_SCOPE:
        raise RecordRefused(
            f"verification claims scope {verification.verification_scope!r}; a "
            f"record may only ever claim {VERIFICATION_SCOPE!r}"
        )

    _confirm_domain(
        http,
        domain,
        inventory=facts.inventory,
        build_id=build_id,
        code_sha=facts.code_sha,
        marker_path=marker_path,
    )

    generation, path = next_generation(data_repo, build_id)
    subject_name = generation_subject_name(generation)
    if resolve_identity(subject_name) != P2_RECORD_SIGN_IDENTITY:
        raise RecordRefused(
            f"subject name {subject_name!r} does not resolve to the record-signer "
            f"identity ({P2_RECORD_SIGN_IDENTITY}); attesting it would produce a "
            "generation the shipped verifier refuses (R25)"
        )

    record = {
        "build_id": build_id,
        "generation": generation,
        "code_sha": facts.code_sha,
        "dist_digest": facts.dist_digest,
        "dist_digest_version": DIST_DIGEST_VERSION,
        "inventory_digest": facts.inventory_digest,
        "verification_scope": verification.verification_scope,
        "files_verified": verification.files_verified,
        "files_total": verification.files_total,
        "workflow_run_id": workflow_run_id,
        "dist_artifact_id": dist_artifact_id or None,
        "dist_artifact_expires_at": dist_artifact_expires_at or None,
        "cf_production_deployment_id": deployment.id,
        "verified_at": rfc3339z(now),
        # TD-10 travels with the claim. A record that stated its scope without
        # stating what that scope cannot see would be the overclaim the scope
        # rename exists to prevent.
        "non_detection": TD10_NOTE,
    }
    document = render_generation(record)

    attested = attestation.attest(subject_name, document)
    if not attested.ok:
        raise RecordRefused(f"the attestation seam refused {subject_name}: {attested.detail}")

    atomic_write_bytes(path, document)
    return SigningResult(
        outcome=VERIFIED,
        detail=(
            f"generation {generation} for build {build_id}: "
            f"{verification.files_verified}/{verification.files_total} files "
            f"verified at {VERIFICATION_SCOPE} on deployment {deployment.id}"
        ),
        record=record,
        document=document,
        subject_name=subject_name,
        generation=generation,
        path=path,
        verification=verification,
    )


def _confirm_domain(
    http: HttpGetter,
    domain: str,
    *,
    inventory: Mapping[str, Any],
    build_id: str,
    code_sha: str,
    marker_path: str,
) -> None:
    """Confirm the live custom domain serves this same build (§5.5).

    §5.5 defines this leg as *identity plus markers*, not a second byte proof of
    the whole tree — the tree was just swept on the deployment-specific origin,
    and the Pages API already answered which deployment production is. It is
    still run through :func:`~populus.deploy.verify.sweep_inventory` rather than
    a hand-rolled fetch, over a one-path envelope, so the domain leg inherits
    exactly the same policy: redirects disabled, cache-busted, decoded-body hash
    **and** length compared, outages raised as outages.
    """
    files = [
        entry
        for entry in inventory.get("files", [])
        if isinstance(entry, Mapping) and entry.get("path") == marker_path
    ]
    if not files:
        raise RecordRefused(
            f"the inventory has no entry for {marker_path!r}; the domain leg has "
            "nothing to confirm against"
        )
    envelope = {
        "dist_digest_version": inventory.get("dist_digest_version"),
        "dist_digest": inventory.get("dist_digest"),
        "files": files,
    }
    try:
        sweep = sweep_inventory(
            http,
            f"https://{domain}",
            envelope,
            cache_bust=hashlib.sha256(f"{build_id}:{code_sha}".encode()).hexdigest()[:16],
            keep=(marker_path,),
        )
    except VerifyUnavailable as exc:
        raise RecordUnavailable(f"the custom domain did not answer: {exc}") from exc

    findings = [str(divergence) for divergence in sweep.divergences]
    body = sweep.bodies.get(marker_path)
    if body is None:
        findings.append(f"{domain} did not serve {marker_path}")
    else:
        findings.extend(check_markers(body, build_id=build_id, code_sha=code_sha))
    if findings:
        raise RecordRefused(
            f"the custom domain {domain} does not serve this deployment: "
            + "; ".join(findings)
        )


# --- internals ---------------------------------------------------------------


def _require_attested(
    attestation: AttestationProvider, subject_name: str, data: bytes
) -> None:
    result = attestation.verify(subject_name, data)
    if result.ok:
        return
    if result.outcome == UNAVAILABLE:
        raise RecordUnavailable(
            f"attestation lookup for {subject_name} was unavailable: {result.detail}"
        )
    raise RecordRefused(f"{subject_name} did not verify: {result.detail}")


def _load_json(data: bytes, what: str) -> dict:
    try:
        loaded = json.loads(data)
    except ValueError as exc:
        raise RecordRefused(f"{what} is not JSON: {exc}") from exc
    if not isinstance(loaded, dict):
        raise RecordRefused(f"{what} is {type(loaded).__name__}, not an object")
    return loaded


def _one_marker(markers: Mapping[str, list[str]], name: str, path: str) -> str:
    values = markers.get(name, [])
    if len(values) != 1:
        raise RecordRefused(
            f"the built {path} carries {len(values)} {name!r} markers; exactly one "
            "is the contract, and no exact statement is possible otherwise"
        )
    value = values[0]
    if not value:
        raise RecordRefused(f"the built {path} carries an empty {name!r} marker")
    return value


# --- entry point -------------------------------------------------------------


def _default_http_client():
    """The served-tree client, built here and nowhere else.

    This is the single line in the signer that names a transport library, and it
    is reached only from :func:`main`. Every verification path takes an injected
    client, which is what keeps the suite hermetic (``tests/conftest.py`` blocks
    real I/O) and what makes the R27 transport fixture possible at all.
    ``follow_redirects`` is False here *as well as* on every call
    :mod:`populus.deploy.verify` makes: belt and braces on the one policy whose
    failure mode is a silent pass.
    """
    import httpx

    return httpx.Client(follow_redirects=False, timeout=30.0)


def _parse_args(argv: Sequence[str] | None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        prog="populus-record-sign",
        description=(
            "Verify the live production deployment and write the next attested "
            "deployment generation (ARCHITECTURE §12.1 step 6)."
        ),
    )
    parser.add_argument("--data-repo", required=True, help="populus-data checkout")
    parser.add_argument(
        "--artifact", required=True, help="directory holding site/ and inventory.json"
    )
    parser.add_argument("--project", required=True, help="Cloudflare Pages project")
    parser.add_argument("--domain", required=True, help="the live custom domain")
    parser.add_argument("--workflow-run-id", required=True)
    parser.add_argument("--dist-artifact-id", default="")
    parser.add_argument("--dist-artifact-expires-at", default="")
    parser.add_argument(
        "--claimed-deployment-id",
        default="",
        help="the deploy job's claim, cross-checked against the Pages API",
    )
    parser.add_argument("--claimed-dist-digest", default="")
    parser.add_argument(
        "--attestation",
        required=True,
        choices=("sigstore", "staging-noop"),
        help="no default: an unsigned run must be chosen out loud",
    )
    return parser.parse_args(argv)


def _build_attestation(choice: str):
    from populus.publish.attestation import build_provider

    if choice == "sigstore":
        from populus.client.snapshot import github_bundle_fetcher
        from populus.publish.attestation import github_trust_config

        return build_provider(
            "sigstore", fetcher=github_bundle_fetcher(), trust_config=github_trust_config()
        )
    return build_provider(choice)


def _emit_outputs(result: SigningResult) -> None:
    """Hand the workflow the subject name and digest **the code chose** (R25).

    The attest step reads these, so the YAML cannot name a subject the code did
    not pin — which is exactly how a generation ends up attested under its
    basename and refused by the verifier.
    """
    destination = os.environ.get("GITHUB_OUTPUT")
    if not destination:
        return
    lines = [
        f"outcome={result.outcome}",
        f"generation={result.generation if result.generation is not None else ''}",
        f"subject_name={result.subject_name or ''}",
        f"subject_digest={result.subject_digest or ''}",
        f"record_path={result.path if result.path is not None else ''}",
    ]
    with open(destination, "a", encoding="utf-8") as handle:
        handle.write("\n".join(lines) + "\n")


def main(
    argv: Sequence[str] | None = None,
    *,
    pages_factory=None,
    http_factory=None,
    attestation_factory=None,
    now: datetime | None = None,
) -> int:
    """Run the signer. The factories exist so this path is testable offline.

    Fails closed on a **missing** credential (§17(h)): no account id or no
    `Pages Read` token means the signer cannot read the Pages API, and a signer
    that cannot read the Pages API must not fall back to trusting the deploy
    job's claim. It exits before any call is made.
    """
    args = _parse_args(argv)

    if pages_factory is None:
        account_id = os.environ.get(ACCOUNT_ID_ENV, "").strip()
        token = os.environ.get(PAGES_READ_TOKEN_ENV, "").strip()
        missing = [
            name
            for name, value in ((ACCOUNT_ID_ENV, account_id), (PAGES_READ_TOKEN_ENV, token))
            if not value
        ]
        if missing:
            print(
                f"record-sign: {', '.join(missing)} is unset — the signer needs its "
                "own Pages Read credential to identify the production deployment, "
                "and will not attest a deployment it could not look up.",
                file=sys.stderr,
            )
            return EXIT_MISCONFIGURED
        pages = CloudflareReads(PagesClient(account_id, args.project, token))
    else:
        pages = pages_factory()

    http = http_factory() if http_factory is not None else _default_http_client()
    attestation = (
        attestation_factory()
        if attestation_factory is not None
        else _build_attestation(args.attestation)
    )

    result = sign_deployment(
        data_repo=args.data_repo,
        artifact_dir=args.artifact,
        pages=pages,
        http=http,
        attestation=attestation,
        domain=args.domain,
        workflow_run_id=args.workflow_run_id,
        now=now or datetime.now(timezone.utc),
        dist_artifact_id=args.dist_artifact_id,
        dist_artifact_expires_at=args.dist_artifact_expires_at,
        claimed_deployment_id=args.claimed_deployment_id or None,
        claimed_dist_digest=args.claimed_dist_digest or None,
    )
    _emit_outputs(result)

    if result.ok:
        print(f"record-sign: {result.detail}")
        print(f"record-sign: wrote {result.path} as {result.subject_name}")
        return EXIT_VERIFIED
    print(f"record-sign: {result.detail}", file=sys.stderr)
    return EXIT_UNAVAILABLE if result.unavailable else EXIT_REJECTED


if __name__ == "__main__":  # pragma: no cover - exercised via main()
    raise SystemExit(main())
