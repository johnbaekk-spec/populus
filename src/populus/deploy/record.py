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

**Every recorded number states its host (§5.5).** The sweep runs against the
*deployment-specific* provider origin, whose hostname is per-deployment and is
not the site's domain; the custom-domain leg checks one path on the domain
itself. A record that said ``files_verified: 12543`` and named neither host
invited exactly one reading — "the domain served 12,543 correct files" — which
is false. So :func:`sign_deployment` records ``swept_origin``
beside ``files_verified``/``files_total``, and ``domain`` beside
``domain_scope``/``domain_files_verified``/``domain_files_total``. Two hosts,
two scopes, four numbers, and none of them anonymous. ``TD10_NOTE`` does not
cover this: it is about what the *expected-paths* scope cannot see on the host
it swept, not about which host that was.

**Two entry points, one module** (:data:`SUBCOMMANDS`).

* ``sign`` (R13) is everything above, run by ``record-sign.yml`` after a deploy.
* ``gate`` (R18) is run by ``publish.yml`` *before* the next publish, and it is
  a different program with a different trust posture: it holds **no Cloudflare
  credential** (§14 forbids the publish job one), so its only live read is an
  unauthenticated fetch of the domain's own ``populus:code_sha`` marker. It
  **verifies** the highest deployment generation's attestation against the
  pinned ``record-sign.yml`` identity rather than merely resolving its path —
  an unsigned file that is present is exactly what R18's revision 1 accepted,
  and it must fail. See :func:`gate_publish`.

The flat, subcommand-less argv form is ``sign``, because ``record-sign.yml``
predates the split and invokes the signer with flags only. That is a contract,
not a convenience: see :func:`_normalize_argv`.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
import time
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from uuid import uuid4

from populus.deploy.cloudflare import CustomDomain, PagesClient, PagesRejected, PagesUnavailable
from populus.deploy.verify import (
    CACHE_BUST_PARAM,
    DEFAULT_MARKER_PATH,
    DEFAULT_STATS_PATH,
    MARKER_BUILD_ID,
    MARKER_CODE_SHA,
    TD10_NOTE,
    VERIFICATION_SCOPE,
    HttpGetter,
    HttpResponse,
    VerificationResult,
    VerifyUnavailable,
    _sweep_entries,
    check_headers,
    check_markers,
    probe_control_paths,
    read_markers,
    served_path,
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
from populus.publish.inventory import (
    INVENTORY_VERSION,
    InventoryError,
    ValidatedInventoryV2,
    build_inventory,
    inventory_digest,
    render_inventory,
    validate_inventory_v2,
)
from populus.publish.manifest import resolve_within
from populus.publish.pointer import rfc3339z

__all__ = [
    "ACCOUNT_ID_ENV",
    "DOMAIN_SCOPE",
    "EXIT_MISCONFIGURED",
    "EXIT_REJECTED",
    "EXIT_UNAVAILABLE",
    "EXIT_VERIFIED",
    "MISCONFIGURED",
    "PAGES_READ_TOKEN_ENV",
    "SUBCOMMANDS",
    "ArtifactFacts",
    "CloudflareReads",
    "GateResult",
    "Generation",
    "ProductionDeployment",
    "RecordMisconfigured",
    "RecordRefused",
    "RecordUnavailable",
    "SigningResult",
    "artifact_facts",
    "attested_build_id",
    "gate_publish",
    "generation_subject_name",
    "highest_generation",
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

#: How many times a *no-verdict* signing attempt is retried, and how long the
#: served tree is given to settle in between.
#:
#: Only ``UNAVAILABLE`` is retried, and that asymmetry is the whole point. The
#: exit codes above exist because "a verification failure and an unreachable API
#: are different problems and must page differently" — but the workflow failed
#: the step identically for both, so the distinction died at the job boundary.
#: On 2026-08-20 one 502 on a single swept path (run 32342764618) left a
#: correct deployment unattested and would have blocked every later publish
#: through R18, because the gate compares live ``code_sha`` against the attested
#: generation. A rerun of the same command succeeded unchanged.
#:
#: ``REJECTED`` is never retried and must never become retryable here: a
#: divergence does not become true by waiting, which is precisely why
#: ``PROPAGATION_REASON`` in the orchestrator matches 404-vs-200 EXACTLY and
#: excludes 5xx, digest and marker findings. This retries the *absence* of an
#: answer, never an answer we dislike. Counts mirror the orchestrator's
#: ``PROPAGATION_RETRIES``/``PROPAGATION_SETTLE_SECONDS`` so there is one cadence
#: in the deploy path rather than two.
SIGN_UNAVAILABLE_RETRIES = 2
SIGN_SETTLE_SECONDS = 45.0

#: A fourth outcome, alongside ``verified``/``rejected``/``unavailable``. It is
#: declared here rather than in :mod:`populus.publish.attestation` because it is
#: not an attestation verdict: it means the *inputs* were wrong (a checkout that
#: is not there, a credential that is unset), which is neither "we asked and the
#: answer was no" nor "we could not ask".
MISCONFIGURED = "misconfigured"

#: What the custom-domain leg actually covers (§5.5). The deployment origin is
#: swept at :data:`~populus.deploy.verify.VERIFICATION_SCOPE`; the domain is
#: checked for the marker page and nothing else, and the record says so under
#: its own key so no number is read against the wrong host.
DOMAIN_SCOPE = "marker_only"

#: The two entry points. Order is the argv order a caller may use; the flat
#: form with no subcommand at all is :data:`DEFAULT_SUBCOMMAND`.
SUBCOMMANDS = ("sign", "gate")
DEFAULT_SUBCOMMAND = "sign"

#: ``YYYYMMDD.N`` — the same shape ``populus.publish.build`` allocates. Kept as
#: a literal rather than imported from that module (it is private there, and
#: importing the release-backend module into the signer would drag the ``gh``
#: release-tool shell-out seam along with it); ``tests/test_deploy_record.py``
#: pins the two
#: patterns equal so they cannot drift.
_BUILD_ID_PATTERN = re.compile(r"^\d{8}\.\d+$")

#: The gate's own copy of :mod:`populus.deploy.verify`'s fetch policy. It is
#: duplicated, deliberately and with a drift test: the gate fetches **one** path
#: and has no inventory to sweep, so it cannot go through ``sweep_inventory``,
#: and reaching into ``verify._fetch`` would bind a private name across a module
#: boundary — which is exactly the coupling that made a stray ``importlib.reload``
#: able to break ``except VerifyUnavailable`` from another test file.
_GATE_NO_ANSWER_STATUSES = frozenset({403, 408, 425, 429})
_GATE_REQUEST_HEADERS = {"cache-control": "no-cache", "pragma": "no-cache"}


class RecordRefused(Exception):
    """We reached everything we needed to and the answer was no."""


class RecordUnavailable(Exception):
    """No verdict was reached (R17) — nothing is attested, nothing is accused."""


class RecordMisconfigured(Exception):
    """The inputs are wrong — not a verdict about anything that was deployed.

    A missing ``populus-data`` checkout is the case this exists for: the gate
    cannot tell "nothing has ever been deployed" from "the checkout step did not
    run" by looking at an absent directory, and guessing either way is how a
    first-run predicate becomes a permanent bypass.
    """


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

    One class, two methods, no write verb reachable from here. The class
    exists so the property is a shape a reader and a test can both check, rather
    than an absence someone has to prove by reading every line of the module.

    :data:`READ_SURFACE` is documentation, not enforcement: a surface test
    that merely re-asserted the constant would be decoration, because adding a method *and*
    adding its name to the constant keeps such an assertion green. Two things carry
    the property instead. The test now pins the surface to a **literal** set
    written in the test file, so growing the constant is what fails. And every
    request this class issues leaves through :meth:`_get`, which refuses any
    verb but ``GET`` at run time rather than promising not to be handed one.

    What that still does not do is make ``PagesClient.rollback`` unreachable —
    ``self._client`` holds a full client and Python has no way to take a method
    away. So the AST guard in ``tests/test_deploy_record.py`` pins the set of
    ``self._client`` attributes this module touches, and the transport fixture
    fails on the verb. Three readings, none of which is a promise.
    """

    #: Pinned so a test can assert the surface did not quietly grow. The test
    #: compares it against a literal, so editing this line does not silence it.
    READ_SURFACE = ("active_custom_domain", "production_deployment")

    def __init__(self, client: PagesClient) -> None:
        self._client = client

    def _get(
        self,
        path: str,
        *,
        params: Mapping[str, str] | None = None,
        method: str = "GET",
    ) -> Any:
        """The one place this class reaches the transport, and it reads only.

        ``method`` is a parameter so the refusal is **executable**. A helper
        that merely hardcoded the verb would be a helper someone could later
        generalise in one line; this one raises on the attempt, and a test makes
        the attempt. The default is the only accepted value, so every real call
        site below simply omits it.
        """
        if method != "GET":
            raise PagesRejected(
                f"CloudflareReads was asked to issue {method!r}: this class is "
                "the signer's entire Cloudflare surface and it is read-only "
                "(R27, §17(h) as amended)"
            )
        return self._client._request(method, path, params=params)

    def production_deployment(self) -> ProductionDeployment:
        """``GET …/deployments?env=production`` — the raw newest production entry.

        The raw result rather than the typed one: see the module docstring on
        ``uses_functions``. The pinned path and the verb guard both still come
        from :class:`~populus.deploy.cloudflare.PagesClient`, so this reads the
        same endpoint the deploy path reads, through the same transport.
        """
        result = self._get(
            self._client._deployments_path(), params={"env": "production"}
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
        """``GET …/projects/{project}/domains`` — the only endpoint with status.

        Delegated rather than routed through :meth:`_get`, and the reason is
        worth a line: the status comparison, the "not attached to this project"
        message and the ``ACTIVE_DOMAIN_STATUS`` constant all live in
        :mod:`populus.deploy.cloudflare`, and re-implementing them here to reach
        them through the local helper would mean two copies of the one check R11
        turns on. It is a read either way — the client's own verb guard and the
        injected transport's assertion both cover it.
        """
        return self._client.assert_custom_domain_active(domain)


@dataclass(frozen=True)
class ArtifactFacts:
    """Everything the signer derived from the artifact it downloaded itself.

    ``validated`` is the proof the recomputed inventory passed the FULL
    exact-v2 validation (LD12/LD12b) — it, not the raw mapping, is what the
    domain leg's typed entry sweep consumes. A v1-shaped or control-less
    artifact never constructs one of these.
    """

    inventory: dict
    validated: ValidatedInventoryV2
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


@dataclass(frozen=True)
class Generation:
    """One deployment generation on disk, located but not yet believed."""

    build_id: str
    generation: int
    path: Path

    @property
    def subject_name(self) -> str:
        return generation_subject_name(self.generation)


@dataclass(frozen=True)
class GateResult:
    """What the pre-publish gate concluded (R18).

    ``first_run`` is a separate field rather than an inference from
    ``generation is None``: "the gate passed because nothing has ever been
    deployed" and "the gate passed because generation 7 verified" are different
    enough that an operator reading a green run must not have to work out which
    one happened.
    """

    outcome: str
    detail: str
    build_id: str | None = None
    generation: int | None = None
    code_sha: str | None = None
    first_run: bool = False

    @property
    def ok(self) -> bool:
        return self.outcome == VERIFIED

    @property
    def unavailable(self) -> bool:
        return self.outcome == UNAVAILABLE


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

    try:
        recomputed = build_inventory(site)
    except InventoryError as exc:
        raise RecordRefused(
            f"the downloaded tree does not produce an exact inventory v2 — "
            f"nothing is fetched or signed over it: {exc}"
        ) from exc
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
    # LD12/LD12b: the FULL exact-v2 validation, before anything is fetched or
    # signed. `build_inventory` self-validates today, but the signer's refusal
    # must not rest on the producer's manners: a v1-shaped, partial, or
    # control-less artifact is refused HERE, in the signer's own contract.
    try:
        validated = validate_inventory_v2(recomputed)
    except InventoryError as exc:
        raise RecordRefused(
            f"the artifact's inventory is not an exact inventory v2 — nothing "
            f"is fetched or signed over it: {exc}"
        ) from exc

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
        validated=validated,
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
    except VerifyUnavailable as exc:
        # The one that was missing, and the one that mattered most. Every
        # verification path below is *supposed* to convert this to
        # `RecordUnavailable` before it reaches here — `verify_deployment`
        # catches it, `_confirm_domain` catches it — so an escape means one of
        # those conversions was removed, or the raising module was re-imported
        # under a second identity (which is precisely what a stray
        # `importlib.reload` in another test file did). Uncaught it left `main`
        # to die with a traceback, and a Python traceback exits 1, which is
        # `EXIT_REJECTED`: a Cloudflare outage would have paged identically to
        # "the site was tampered with", contradicting the contract stated at the
        # top of this module. Fail-safe, not fail-silent — it is UNAVAILABLE.
        return SigningResult(
            outcome=UNAVAILABLE,
            detail=(
                f"no verdict: a served-tree lookup did not answer and the outage "
                f"reached the top level unconverted: {exc}"
            ),
        )
    except RecordRefused as exc:
        return SigningResult(outcome=REJECTED, detail=f"refused to attest: {exc}")
    except PagesRejected as exc:
        # Still REJECTED — the Pages API answered and the answer did not line up
        # — but the detail names the source, because this class covers a
        # configuration fault ("the domain is not attached to this project") as
        # well as a real finding, and an operator must not read the first as the
        # second. The exit code cannot separate them: downgrading every
        # `PagesRejected` would also downgrade "Cloudflare says a different
        # deployment is live", which is the finding this signer exists to make.
        return SigningResult(
            outcome=REJECTED,
            detail=(
                f"refused to attest — the Cloudflare Pages API answered and the "
                f"answer did not line up (check the project's configuration "
                f"before reading this as tampering): {exc}"
            ),
        )
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

    # LD12b: a successful sign requires each control total/verified value to be
    # exactly one. `verification.ok` already implies the effect verified, but
    # the requirement is stated on the RECORD's fields, so it is enforced on
    # them rather than inferred.
    if (
        verification.controls_total != 1
        or verification.control_effects_verified != 1
    ):
        raise RecordRefused(
            "the origin sweep did not verify exactly one control effect "
            f"(controls_total={verification.controls_total}, "
            f"control_effects_verified={verification.control_effects_verified}); "
            "a generation is signed only over a proven `_headers` control"
        )

    domain_files_verified, domain_controls_total, domain_control_effects = (
        _confirm_domain(
            http,
            domain,
            validated=facts.validated,
            build_id=build_id,
            code_sha=facts.code_sha,
            marker_path=marker_path,
        )
    )
    if domain_controls_total != 1 or domain_control_effects != 1:
        raise RecordRefused(
            "the custom-domain leg did not verify exactly one control effect "
            f"(domain_controls_total={domain_controls_total}, "
            f"domain_control_effects_verified={domain_control_effects})"
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
        # LD12b: the generation names the exact schema it was verified under
        # and the exact canonical controls identity — no redundant
        # unauthenticated "control digest" field exists; `inventory_digest`
        # over the full canonical document already binds `controls`.
        "inventory_version": INVENTORY_VERSION,
        "inventory_digest": facts.inventory_digest,
        "controls": facts.validated.controls_identity(),
        # --- the deployment-origin leg: which host, what scope, how many ---
        # `swept_origin` is not decoration. Without it `files_verified` names no
        # host, and a reader of a record for a custom domain has every reason to
        # assume it describes that domain. It describes the provider origin.
        "swept_origin": deployment.url,
        "verification_scope": verification.verification_scope,
        "files_verified": verification.files_verified,
        "files_total": verification.files_total,
        "controls_total": verification.controls_total,
        "control_effects_verified": verification.control_effects_verified,
        # --- the custom-domain leg: same three questions, different answers ---
        # One path was checked here, out of the same inventory total, which is
        # why `domain_files_total` is the served-entry count rather than 1:
        # "1/5" states the gap, "1/1" would hide it behind a full-marks
        # fraction. LD12b: `domain_files_total` means len(files) — served
        # entries only, never files-plus-controls.
        "domain": domain,
        "domain_scope": DOMAIN_SCOPE,
        "domain_files_verified": domain_files_verified,
        "domain_files_total": verification.files_total,
        "domain_controls_total": domain_controls_total,
        "domain_control_effects_verified": domain_control_effects,
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
            f"verified at {VERIFICATION_SCOPE} on {deployment.url} "
            f"(deployment {deployment.id}); {domain_files_verified}/"
            f"{verification.files_total} at {DOMAIN_SCOPE} on {domain}"
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
    validated: ValidatedInventoryV2,
    build_id: str,
    code_sha: str,
    marker_path: str,
) -> tuple[int, int, int]:
    """Confirm the live custom domain serves this same build (§5.5, LD12b).

    §5.5 defines this leg as *identity plus markers plus the control's exact
    effect*, not a second byte proof of the whole tree — the tree was just
    swept on the deployment-specific origin, and the Pages API already answered
    which deployment production is. It receives the **already-validated**
    :class:`~populus.publish.inventory.ValidatedInventoryV2`, selects its one
    marker entry, and hands that typed entry to the package-internal
    :func:`~populus.deploy.verify._sweep_entries` — it never constructs a
    synthetic partial envelope, because no public seam may accept one. The
    typed entry inherits exactly the same fetch policy: redirects disabled,
    cache-busted, decoded-body hash **and** length compared, outages raised as
    outages.

    The control's effect is checked on the domain too: the exact required
    security-header values on the marker response
    (:func:`~populus.deploy.verify.check_headers`) plus the ``/_headers``-must-
    404 control-path probes.

    Returns ``(domain_files_verified, domain_controls_total,
    domain_control_effects_verified)`` — measured, never assumed; on success
    ``(1, 1, 1)``.

    The cache-bust is :func:`~uuid.uuid4`, matching
    :func:`~populus.deploy.verify.verify_deployment`. It used to be
    ``sha256(build_id:code_sha)``, which is a *function of the build*: §5.5
    anticipates one build being deployed more than once (recovery, rollback,
    a re-run), so generation 2's domain URL was byte-identical to generation 1's
    and an edge cache could answer the second check from the first check's
    stored body. A cache-bust that repeats is not a cache-bust.
    """
    markers_in_files = [
        entry for entry in validated.files if entry.path == marker_path
    ]
    if not markers_in_files:
        raise RecordRefused(
            f"the inventory has no entry for {marker_path!r}; the domain leg has "
            "nothing to confirm against"
        )
    marker_entry = markers_in_files[0]
    bust = uuid4().hex
    base_url = f"https://{domain}"
    try:
        sweep = _sweep_entries(
            http,
            base_url,
            (marker_entry,),
            cache_bust=bust,
            keep=(marker_path,),
            header_paths=(marker_path,),
        )
        control_findings = probe_control_paths(http, base_url, cache_bust=bust)
    except VerifyUnavailable as exc:
        raise RecordUnavailable(f"the custom domain did not answer: {exc}") from exc

    findings = [str(divergence) for divergence in sweep.divergences]
    body = sweep.bodies.get(marker_path)
    if body is None:
        findings.append(f"{domain} did not serve {marker_path}")
    else:
        findings.extend(check_markers(body, build_id=build_id, code_sha=code_sha))
    observed_headers = sweep.headers.get(marker_path)
    if observed_headers is not None:
        control_findings.extend(check_headers(observed_headers, path=marker_path))
    if findings or control_findings:
        raise RecordRefused(
            f"the custom domain {domain} does not serve this deployment: "
            + "; ".join(findings + control_findings)
        )
    domain_controls_total = len(validated.controls)
    domain_control_effects = domain_controls_total if domain_controls_total == 1 else 0
    return sweep.files_verified, domain_controls_total, domain_control_effects


# --- the pre-publish gate (R18) ----------------------------------------------


def highest_generation(data_repo: Path | str) -> Generation | None:
    """The newest deployment generation in a `populus-data` checkout, or None.

    "Newest" is ``(build id, generation)``, in that order. Generation numbers
    restart at 1 for every build (:func:`next_generation`), so comparing them
    across builds would rank ``20260101.1`` generation 3 above ``20260805.1``
    generation 1 — the reverse of the truth, and silently.

    Two things are refusals rather than skips, for the same reason
    :func:`next_generation` refuses an unnumbered file: a gate that shrugged at
    a directory it could not order would be a gate that could be turned off by
    creating one. A build directory whose name is not ``YYYYMMDD.N``, and a
    generation file whose stem is not an integer, both raise.

    Returns None only when there are genuinely zero generations — which is half
    of the first-run predicate and must therefore mean exactly one thing.
    """
    builds = Path(data_repo) / "builds"
    if not builds.is_dir():
        return None

    best: tuple[tuple[int, int, int], Generation] | None = None
    for directory in sorted(p for p in builds.iterdir() if p.is_dir()):
        deployments = directory / DEPLOYMENTS_DIRNAME
        if not deployments.is_dir():
            continue
        entries = sorted(deployments.glob("*.json"))
        if not entries:
            continue
        order = _build_order(directory.name)
        for existing in entries:
            try:
                number = int(existing.stem)
            except ValueError:
                raise RecordRefused(
                    f"{existing} is not a numbered generation; the gate will not "
                    "guess which generation is the current one"
                ) from None
            key = (*order, number)
            if best is None or key > best[0]:
                best = (
                    key,
                    Generation(
                        build_id=directory.name, generation=number, path=existing
                    ),
                )
    return None if best is None else best[1]


def gate_publish(
    *,
    data_repo: Path | str,
    http: HttpGetter,
    attestation: AttestationProvider,
    domain: str,
    marker_path: str = DEFAULT_MARKER_PATH,
    acknowledged_code_sha: str = "",
) -> GateResult:
    """R18: the previous deploy must have left a **verified** generation.

    Revision 1 of R18 said the gate "resolves ``builds/<id>/deployments/``",
    which an unsigned file satisfies. §13.2 and §12.1 step 6 want something
    stronger and this function is it. In order:

    1. Find the highest generation in the checkout ``publish.yml`` already has
       (:func:`highest_generation`). No network, no Cloudflare.
    2. Read the **live domain's** ``populus:code_sha`` marker over an
       unauthenticated GET. The publish job holds no Cloudflare credential —
       §14 forbids it one — so the domain's own answer is the only live signal
       available, and it is also the right one: the question is what the public
       is being served, not what the provider's control plane says.
    3. **Verify the generation's attestation** against the identity
       :func:`~populus.publish.attestation.resolve_identity` pins for a
       ``deployments/`` subject, which is ``record-sign.yml@refs/heads/main``.
       The document's bytes are not parsed for a single value before this
       passes — same order as :func:`attested_build_id`, same reason.
    4. Require the attested record's ``code_sha`` to equal what the domain
       serves.

    **The first-run predicate, and only it:** pass when the domain resolves to
    no deployment *and* the checkout holds zero generations. Every other
    unresolvable state fails closed — including "the domain serves nothing but
    seven generations exist" (a rollback nobody recorded) and "the domain serves
    a build but no generation exists" (a deploy whose signer was skipped, which
    is R20's failure arriving a day late).

    An outage is never a refusal here either: a 429 from the domain, a transport
    failure or an attestation-API quota error returns ``unavailable``, because
    "the publish gate could not ask" must not be reportable as "the last deploy
    was tampered with".
    """
    try:
        return _gate(
            data_repo=data_repo,
            http=http,
            attestation=attestation,
            domain=domain,
            marker_path=marker_path,
            acknowledged_code_sha=acknowledged_code_sha,
        )
    except RecordMisconfigured as exc:
        return GateResult(outcome=MISCONFIGURED, detail=f"misconfigured: {exc}")
    except RecordUnavailable as exc:
        return GateResult(outcome=UNAVAILABLE, detail=f"no verdict: {exc}")
    except VerifyUnavailable as exc:
        # The same escape hatch `sign_deployment` grew, for the same reason: an
        # outage that reaches the top level unconverted must not exit 1.
        return GateResult(
            outcome=UNAVAILABLE,
            detail=f"no verdict: the live check did not answer: {exc}",
        )
    except RecordRefused as exc:
        return GateResult(outcome=REJECTED, detail=f"refused to publish: {exc}")


def _gate(
    *,
    data_repo: Path | str,
    http: HttpGetter,
    attestation: AttestationProvider,
    domain: str,
    marker_path: str,
    acknowledged_code_sha: str = "",
) -> GateResult:
    repo = Path(data_repo)
    if not repo.is_dir():
        raise RecordMisconfigured(
            f"no populus-data checkout at {repo}: an absent directory is not "
            "evidence that nothing was ever deployed, and the first-run "
            "predicate must not be satisfiable by a checkout step that failed"
        )

    found = highest_generation(repo)

    # A domain with no deployment behind it and a domain whose origin is having
    # an outage are the SAME observation: Cloudflare answers 522 either way,
    # because "no origin" is literally what a Pages project with zero
    # deployments has. The status code cannot separate them, and R17 is right
    # that an outage must never be read as evidence.
    #
    # The separation comes from the predicate's other half, which is independent
    # of the network: the checkout either holds a generation or it does not. An
    # unreachable domain is therefore allowed to mean "nothing was ever
    # deployed" ONLY when populus-data independently proves nothing was ever
    # deployed. If a generation exists, an unreachable domain is exactly the
    # outage R17 describes and still refuses to answer.
    #
    # This is not a widening of the first-run predicate — it is the predicate as
    # R18 states it ("the domain resolves to no deployment AND the checkout
    # holds zero generations"), reached in the case where the first half is
    # observed as an outage rather than as a clean answer.
    try:
        served = _domain_code_sha(http, domain, marker_path=marker_path)
    except (RecordUnavailable, VerifyUnavailable):
        if found is not None:
            raise
        served = None

    if found is None and served is None:
        return GateResult(
            outcome=VERIFIED,
            first_run=True,
            detail=(
                f"first run: {domain} resolves to no deployment and {repo} holds "
                "zero deployment generations. This is the only state in which "
                "the gate passes without verifying one (R18/R14)."
            ),
        )
    if found is None:
        # The documented clearing path for TD-4's one real deadlock: a
        # deployment went live and could not be attested, so the gate blocks
        # every future publish -- INCLUDING the one carrying the fix. Left
        # unresolvable, the only escapes are attesting a build known to be
        # wrong, or deleting an active production deployment Cloudflare refuses
        # to delete.
        #
        # So the operator may acknowledge it -- and the acknowledgement is
        # deliberately expensive to give:
        #   * it must name the EXACT code_sha the domain is serving, so it
        #     cannot be set once and forgotten, and cannot be guessed;
        #   * it lives on `workflow_dispatch` only, so a scheduled nightly can
        #     never carry one;
        #   * it clears exactly this state (live deployment, zero generations)
        #     and no other refusal;
        #   * it is recorded in the verdict, so the run log says a human
        #     overrode a safety gate and which deployment they overrode.
        # It does not attest anything. The next successful run writes the first
        # real generation and this path is never reachable again.
        if acknowledged_code_sha and acknowledged_code_sha == served:
            return GateResult(
                outcome=VERIFIED,
                first_run=True,
                detail=(
                    f"OVERRIDE: an operator acknowledged the unrecorded "
                    f"deployment serving {served!r} on {domain}. The gate is "
                    "cleared for THIS run only; nothing was attested, and the "
                    "next run must produce a real generation (TD-4 runbook)."
                ),
            )
        raise RecordRefused(
            f"{domain} serves a deployment (populus:code_sha {served!r}) but "
            f"{repo} holds zero deployment generations. Something went live "
            "unrecorded — the first-run predicate needs BOTH halves, and this "
            "is the shape R20's skipped signer leaves behind. If this is a "
            "known incident, re-dispatch with acknowledge_unrecorded_code_sha "
            f"set to {served!r} (see docs/operations/deploy.md, TD-4)"
        )
    if served is None:
        raise RecordRefused(
            f"{repo} records generation {found.generation} for build "
            f"{found.build_id} but {domain} resolves to no deployment. The gate "
            "cannot confirm the recorded deployment is the live one, and will "
            "not publish over an unexplained state"
        )

    document = found.path.read_bytes()
    subject_name = found.subject_name
    if resolve_identity(subject_name) != P2_RECORD_SIGN_IDENTITY:
        raise RecordRefused(
            f"subject name {subject_name!r} does not resolve to the record-signer "
            f"identity ({P2_RECORD_SIGN_IDENTITY}); the gate verifies against the "
            "identity the signer is pinned to and nothing else (R18/R25)"
        )
    # Attestation FIRST. Everything below reads values out of these bytes, and a
    # present-but-unsigned file is exactly what revision 1 of this requirement
    # would have accepted.
    _require_attested(attestation, subject_name, document)

    recorded = _load_json(document, str(found.path))
    if recorded.get("generation") != found.generation:
        raise RecordRefused(
            f"{found.path} is generation {found.generation} by its name but "
            f"{recorded.get('generation')!r} by its contents"
        )
    if recorded.get("build_id") != found.build_id:
        raise RecordRefused(
            f"{found.path} sits under build {found.build_id!r} but records build "
            f"{recorded.get('build_id')!r}"
        )
    code_sha = recorded.get("code_sha")
    if not isinstance(code_sha, str) or not code_sha:
        raise RecordRefused(
            f"the attested {found.path} carries no code_sha; there is nothing to "
            "compare against what the domain serves"
        )
    if code_sha != served:
        raise RecordRefused(
            f"{domain} serves populus:code_sha {served!r}; the attested "
            f"generation {found.generation} for build {found.build_id} records "
            f"{code_sha!r} (compared exactly, never by prefix). The live site is "
            "not the deployment that was signed"
        )

    return GateResult(
        outcome=VERIFIED,
        build_id=found.build_id,
        generation=found.generation,
        code_sha=code_sha,
        detail=(
            f"generation {found.generation} for build {found.build_id} is "
            f"attested under {subject_name} and its code_sha {code_sha} is what "
            f"{domain} serves"
        ),
    )


def _domain_code_sha(
    http: HttpGetter, domain: str, *, marker_path: str
) -> str | None:
    """The ``populus:code_sha`` the live domain serves, or None for "nothing".

    None means the domain **answered** and the answer was 404: there is no
    deployment behind it. That is a resolution, not an outage, which is what
    makes it usable as half of the first-run predicate. An outage — transport
    failure, 429, 5xx — raises instead, and never reaches the predicate.

    Unauthenticated by construction: this function is handed a plain HTTP client
    and no credential exists in this code path to hand it. The publish job holds
    none (§14), and the gate asks the public site the public's question.

    *marker_path* stays an **inventory** path throughout; the URL is built
    through :func:`~populus.deploy.verify.served_path` because Cloudflare Pages
    307-redirects ``index.html`` to ``/``. Without that rewrite this function
    would take the provider's redirect as a hijack and refuse every publish
    forever — a gate that fails closed on nothing at all is still a gate that
    never opens.
    """
    url = (
        f"https://{domain}/{served_path(marker_path)}"
        f"?{CACHE_BUST_PARAM}={uuid4().hex}"
    )
    response = _gate_fetch(http, url)
    status = response.status_code
    if status == 404:
        return None
    if 300 <= status < 400:
        raise RecordRefused(
            f"{url} answered HTTP {status} redirect to "
            f"{response.headers.get('location', '')!r}; a 3xx on the marker page "
            "is a hijack, not a hop to follow"
        )
    if status != 200:
        raise RecordRefused(
            f"{url} answered HTTP {status}; the gate reads 200 as 'this is what "
            "is live' and 404 as 'nothing is live', and has no reading for this"
        )
    return _one_marker(read_markers(response.content), MARKER_CODE_SHA, marker_path)


def _gate_fetch(http: HttpGetter, url: str) -> HttpResponse:
    """One cache-busted, redirect-disabled GET, with R17's split preserved.

    A local copy of :func:`populus.deploy.verify._fetch`'s policy rather than a
    call to it: that function is private, the gate has no inventory to sweep so
    ``sweep_inventory`` does not fit, and binding another module's private name
    is the coupling that let a reload in one test file break an ``except``
    clause in another. ``tests/test_deploy_record.py`` pins the two policies
    equal so the copy cannot drift.

    ``AssertionError`` is re-raised for the same reason it is there: it is what
    the suite's no-network guard raises, and laundering a real network call into
    a tidy ``unavailable`` would hide it.
    """
    try:
        response = http.get(url, headers=_GATE_REQUEST_HEADERS, follow_redirects=False)
    except AssertionError:
        raise
    except Exception as exc:  # transport-layer failure of any shape
        raise RecordUnavailable(f"transport error fetching {url}: {exc}") from exc

    status = response.status_code
    if status in _GATE_NO_ANSWER_STATUSES or status >= 500:
        raise RecordUnavailable(
            f"HTTP {status} fetching {url}: no verdict was reached (a rate limit "
            "or an origin error is an outage, never evidence of tampering)"
        )
    return response


def _build_order(build_id: str) -> tuple[int, int]:
    """``YYYYMMDD.N`` → a sortable key, or a refusal."""
    if _BUILD_ID_PATTERN.match(build_id) is None:
        raise RecordRefused(
            f"build directory {build_id!r} is not a <YYYYMMDD>.<n> build id; the "
            "gate will not guess which of two builds deployed later"
        )
    date_part, sequence = build_id.split(".")
    return int(date_part), int(sequence)


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


def _normalize_argv(argv: Sequence[str] | None) -> list[str]:
    """Insert the implicit ``sign`` subcommand — the compatibility contract.

    ``record-sign.yml`` invokes ``python -m populus.deploy.record --data-repo …``
    with flags and no subcommand, and it predates the split. Rewriting that
    workflow to add the word ``sign`` would be a two-file change whose halves
    ship at different times; a run between the two would fail on argv, in the
    step that decides whether a live deployment gets attested at all. So the
    flat form keeps working, permanently, and this is the one function that says
    so.

    ``-h``/``--help`` alone is passed through untouched, so top-level help lists
    the subcommands instead of silently answering for ``sign``.
    """
    tokens = list(sys.argv[1:] if argv is None else argv)
    if tokens and (tokens[0] in SUBCOMMANDS or tokens[0] in ("-h", "--help")):
        return tokens
    return [DEFAULT_SUBCOMMAND, *tokens]


def _add_sign_arguments(parser: argparse.ArgumentParser) -> None:
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


def _add_gate_arguments(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--data-repo", required=True, help="populus-data checkout")
    parser.add_argument("--domain", required=True, help="the live custom domain")
    parser.add_argument(
        "--marker-path",
        default=DEFAULT_MARKER_PATH,
        help="the page carrying the populus:code_sha marker",
    )
    parser.add_argument(
        "--acknowledge-unrecorded-code-sha",
        default="",
        help=(
            "TD-4 clearing path: acknowledge a live-but-unrecorded deployment "
            "by naming the EXACT code_sha it serves. Clears only that one "
            "state, for one run, and attests nothing. See "
            "docs/operations/deploy.md."
        ),
    )
    parser.add_argument(
        # Unlike `sign`, this one HAS a default — and the default is the strong
        # provider, never the no-op. The property the defaultless flag protects
        # is "no entry point silently inherits StagingNoop"; defaulting to
        # sigstore satisfies it in the fail-closed direction, and it is what
        # lets `publish.yml` call the gate with two flags. Choosing the no-op
        # here is still a thing you have to type.
        "--attestation",
        default="sigstore",
        choices=("sigstore", "staging-noop"),
        help="default sigstore; staging-noop verifies nothing and must be chosen",
    )


def _parse_args(argv: Sequence[str] | None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        prog="populus-record",
        description=(
            "The deployment record: sign a generation after a deploy (§12.1 "
            "step 6), or gate the next publish on the last one (R18)."
        ),
    )
    subparsers = parser.add_subparsers(dest="command", required=True)
    _add_sign_arguments(
        subparsers.add_parser(
            "sign",
            help="verify the live deployment and write the next generation",
            description=(
                "Verify the live production deployment and write the next "
                "attested deployment generation (ARCHITECTURE §12.1 step 6). "
                "This is also what a bare, subcommand-less argv runs."
            ),
        )
    )
    _add_gate_arguments(
        subparsers.add_parser(
            "gate",
            help="refuse to publish unless the last deploy left a verified generation",
            description=(
                "Require an attestation-verified deployment generation whose "
                "code_sha matches what the live domain serves (R18). Issues no "
                "Cloudflare request and holds no Cloudflare credential."
            ),
        )
    )
    return parser.parse_args(_normalize_argv(argv))


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
    pairs = [
        ("outcome", result.outcome),
        ("generation", "" if result.generation is None else str(result.generation)),
        ("subject_name", result.subject_name or ""),
        ("subject_digest", result.subject_digest or ""),
        ("record_path", "" if result.path is None else str(result.path)),
    ]
    with open(destination, "a", encoding="utf-8") as handle:
        for name, value in pairs:
            handle.write(_github_output_entry(name, value))


def _github_output_entry(name: str, value: str) -> str:
    """One ``$GITHUB_OUTPUT`` entry, with the newline hole closed.

    ``name=value`` is line-oriented, so a value containing a newline writes a
    second line that the runner parses as *another output* — the file format's
    standard injection. Every value emitted here is derived (an outcome
    constant, an integer, a subject name this module built, a digest, a path),
    so none of them contains one today; a path with a newline in it is the one
    that is not obviously impossible, and "obviously impossible" is how this
    class of hole is always argued.

    So: a value with no newline gets the plain form, and a value with one gets
    the heredoc form under a random delimiter, which is what the runner
    documents for multi-line values. The delimiter is
    :func:`~uuid.uuid4`-derived, so a value cannot contain it; the check below
    is nonetheless made rather than assumed, and refuses rather than emitting
    something the runner would misparse.
    """
    if "\n" not in value and "\r" not in value:
        return f"{name}={value}\n"
    delimiter = f"ghadelim_{uuid4().hex}"
    if delimiter in value:  # pragma: no cover - 128 bits says otherwise
        raise RecordRefused(
            f"cannot emit output {name!r}: its value contains the random "
            "heredoc delimiter, so no framing of it is unambiguous"
        )
    return f"{name}<<{delimiter}\n{value}\n{delimiter}\n"


def main(
    argv: Sequence[str] | None = None,
    *,
    pages_factory=None,
    http_factory=None,
    attestation_factory=None,
    now: datetime | None = None,
    sleep: Callable[[float], None] = time.sleep,
) -> int:
    """Run ``sign`` or ``gate``. The factories exist so both are testable offline.

    **The argv contract, unchanged where it matters.** A bare flag list with no
    subcommand still runs the signer, because ``record-sign.yml`` invokes it
    that way (see :func:`_normalize_argv`). ``gate`` is reached only by naming
    it, which is what ``publish.yml`` does.

    Exit codes are shared by both: ``0`` verified, ``1`` rejected, ``2``
    unavailable, ``3`` misconfigured. The sign path fails closed on a **missing**
    credential (§17(h)): no account id or no `Pages Read` token means the signer
    cannot read the Pages API, and a signer that cannot read the Pages API must
    not fall back to trusting the deploy job's claim. It exits before any call is
    made. The gate needs no credential at all and asks for none.
    """
    args = _parse_args(argv)
    if args.command == "gate":
        return _main_gate(
            args, http_factory=http_factory, attestation_factory=attestation_factory
        )
    return _main_sign(
        args,
        pages_factory=pages_factory,
        http_factory=http_factory,
        attestation_factory=attestation_factory,
        now=now,
        sleep=sleep,
    )


def _main_gate(
    args: argparse.Namespace, *, http_factory=None, attestation_factory=None
) -> int:
    """R18's entry point. It builds no Pages client and reads no Pages token.

    That is not an oversight to be tidied up later: §14 forbids the publish job
    a Cloudflare credential, so there is nothing to read, and a gate that grew a
    fallback to the control plane would be a gate that needs the credential §14
    withholds.
    """
    owned, http = _http(http_factory)
    try:
        attestation = (
            attestation_factory()
            if attestation_factory is not None
            else _build_attestation(args.attestation)
        )
        result = gate_publish(
            data_repo=args.data_repo,
            http=http,
            attestation=attestation,
            domain=args.domain,
            marker_path=args.marker_path,
            acknowledged_code_sha=args.acknowledge_unrecorded_code_sha,
        )
    finally:
        if owned:
            http.close()

    if result.ok:
        print(f"record-gate: {result.detail}")
        return EXIT_VERIFIED
    print(f"record-gate: {result.detail}", file=sys.stderr)
    return _exit_code(result.outcome)


def _main_sign(
    args: argparse.Namespace,
    *,
    pages_factory=None,
    http_factory=None,
    attestation_factory=None,
    now: datetime | None = None,
    sleep: Callable[[float], None] = time.sleep,
) -> int:
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

    owned, http = _http(http_factory)
    try:
        attestation = (
            attestation_factory()
            if attestation_factory is not None
            else _build_attestation(args.attestation)
        )
        for attempt in range(SIGN_UNAVAILABLE_RETRIES + 1):
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
            if result.outcome != UNAVAILABLE:
                break
            if attempt == SIGN_UNAVAILABLE_RETRIES:
                break
            print(f"record-sign: {result.detail}", file=sys.stderr)
            print(
                f"record-sign: no verdict was reached, so nothing has been "
                f"attested and nothing has been rejected; settling "
                f"{SIGN_SETTLE_SECONDS:.0f}s and asking again "
                f"(retry {attempt + 1} of {SIGN_UNAVAILABLE_RETRIES})",
                file=sys.stderr,
            )
            sleep(SIGN_SETTLE_SECONDS)
    finally:
        if owned:
            http.close()
    _emit_outputs(result)

    if result.ok:
        print(f"record-sign: {result.detail}")
        print(f"record-sign: wrote {result.path} as {result.subject_name}")
        return EXIT_VERIFIED
    print(f"record-sign: {result.detail}", file=sys.stderr)
    return _exit_code(result.outcome)


def _http(http_factory) -> tuple[bool, HttpGetter]:
    """The client, and whether **we** own it and must therefore close it.

    An injected client belongs to its caller — closing it would be reaching into
    someone else's resource — but the one :func:`_default_http_client` builds
    belongs to this process and nothing was closing it. That leaked a connection
    pool on every run; harmless in a job that exits immediately, which is
    exactly why it would have survived indefinitely.
    """
    if http_factory is not None:
        return False, http_factory()
    return True, _default_http_client()


def _exit_code(outcome: str) -> int:
    """One mapping, shared by both entry points, so they cannot disagree."""
    return {
        VERIFIED: EXIT_VERIFIED,
        REJECTED: EXIT_REJECTED,
        UNAVAILABLE: EXIT_UNAVAILABLE,
        MISCONFIGURED: EXIT_MISCONFIGURED,
    }[outcome]


if __name__ == "__main__":  # pragma: no cover - exercised via main()
    raise SystemExit(main())
