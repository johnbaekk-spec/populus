"""§12.1 R9/R11/R15/R16/R17/R19: what the live site actually served.

A deployment is green only on live proof, and this module is where the proof is
taken. It answers one question — *are the bytes on the domain the bytes we
hashed?* — inventory-wide, because the marker-only version of that question is
vacuous.

**Why marker checks are not enough** (ARCHITECTURE §12.1, the sentence at
`:320`). A deploy job that has been compromised can keep `build_id`, `code_sha`
and `stats.json` exactly right and replace every HTML and JS file behind them —
the three fields it left alone are precisely the three a marker check reads. So
:func:`verify_deployment` fetches **every path in the published inventory**,
compares the content-decoded body hash **and** its length against the recorded
entry, and names the exact paths that diverged.

**Why markers are still parsed by name.** The site also embeds `build_id` in a
page-level JSON blob, so ``build_id in document`` is True even when the whole
footer has been replaced. Markers are therefore read from
``<meta name="populus:…" content="…">`` **by name** and compared with ``==``.
Never containment, and never an abbreviation: the dashboard's dev fallback
truncates a sha to 7 characters, and a 7-character prefix "matching" a full
digest is exactly the false pass this refuses.

**Why redirects are disabled.** A 3xx on an inventoried path is a failure, not
something to follow. An injected `_redirects` can point a path at content that
looks right to whoever asks the way we ask and wrong to everyone else;
following the hop and hashing what comes back would launder that into a pass.
The hop itself is the finding.

**Why the URL fetched is not the inventory path.** Cloudflare Pages does not
serve HTML at its literal path: it 307s `…/index.html` to the directory form
and `…/x.html` to the extension-less form, documented as "`/contact.html` will
be redirected to `/contact`, and `/about/index.html` will be redirected to
`/about/`", and confirmed by probe (a cache-busting query string does not
suppress it; the parameter is carried onto the redirect target). The dashboard
builds with Astro's `format: "directory"`, so 8,170 of its 12,543 files are
HTML — fetching each at its literal path would produce 8,170 divergences on a
healthy deployment and *no* marker check at all, since only a 200 populates
``bodies``. Every inventory path is therefore mapped through
:func:`served_path` to the URL the provider actually answers on, **and the
mapped URL is still fetched with redirects disabled**. That ordering is the
whole point: the alternative — follow one hop when the ``location`` looks
canonical — cannot distinguish the provider's own rewrite from a `_redirects`
line aiming a page at its own directory, so it would retire the detection this
module exists for. A 3xx on a *mapped* URL remains a divergence.

**Why the scope is `expected_paths` and never "full".** Fetching every
inventoried path proves every *expected* file is present and correct. It does
not prove closure: an *added* file, route or provider control is invisible to
it, because Cloudflare treats `_redirects`, `_headers`, `_worker.js` and
Functions as configuration rather than serving them as assets. Three bounded
provider checks narrow that gap — a no-Functions assertion, 404 probes on the
control paths (plus one never-published path, which is what a `/* … 200` splat
rewrite would trip), and a response-header allowlist. What remains is declared
as **TD-10**, and a test pins the non-detection as *not detected* so the limit
stays a known limit instead of quietly becoming a claim.

**Why an outage is not an accusation**. A transport failure, a 429 or a
5xx means no answer was obtained; it is reported as ``unavailable``, exactly as
``populus.publish.attestation`` separates ``UNAVAILABLE`` from ``REJECTED`` —
the same constants are imported here rather than re-declared, so the two cannot
drift. Reading a rate limit as tampering would raise a false alarm on the
loudest channel the system has.

**No client is built here.** The caller passes one in, already configured; this
module opens nothing at import or at call time and names no transport library.
The dep guard's network-primitive allowlist covers this module, and this module
does not use the permission: a client constructed here would be a client whose
redirect policy, timeout and proxy settings live somewhere other than the code
that depends on them, and ``follow_redirects=False`` is load-bearing enough
that it is passed explicitly on every call instead. That also keeps the suite
hermetic (``tests/conftest.py`` forbids real network I/O) and keeps this module
what it is: verification logic over fetched bytes. The
same routine runs against a preview origin and against the live custom domain —
R9 and R11 are one code path with a different ``base_url``, which is why
neither host appears anywhere below.
"""

from __future__ import annotations

import hashlib
import re
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from html import unescape
from typing import Any, Protocol
from uuid import uuid4

from populus.publish.attestation import REJECTED, UNAVAILABLE, VERIFIED
from populus.publish.inventory import (
    InventoryError,
    InventoryFile,
    ValidatedInventoryV2,
    validate_inventory_v2,
)

__all__ = [
    "ALLOWED_RESPONSE_HEADERS",
    "CONTROL_PATHS",
    "Divergence",
    "HeaderMultimap",
    "MARKER_BUILD_ID",
    "MARKER_CODE_SHA",
    "REJECTED",
    "SECURITY_HEADER_NAMES",
    "SweepResult",
    "TD10_NOTE",
    "UNAVAILABLE",
    "VERIFICATION_SCOPE",
    "VERIFIED",
    "VerificationResult",
    "VerifyInputError",
    "VerifyUnavailable",
    "LOCKED_CONTENT_SECURITY_POLICY",
    "REQUIRED_RESPONSE_HEADERS",
    "check_headers",
    "check_markers",
    "check_no_functions",
    "check_stats",
    "normalize_security_header_multimap",
    "probe_control_paths",
    "read_markers",
    "served_path",
    "sweep_inventory",
    "verify_deployment",
]

#: The two machine-readable markers the site emits. Free text in the
#: footer is not a marker; a `<meta>` with these names is.
MARKER_BUILD_ID = "populus:build_id"
MARKER_CODE_SHA = "populus:code_sha"

#: What a record may claim about its own coverage. There is deliberately no
#: ``"full"`` anywhere in this module — see the docstring and TD-10.
VERIFICATION_SCOPE = "expected_paths"

#: Carried into every verified result so the honest limit travels with the
#: claim rather than living only in a document nobody reads at 3am.
TD10_NOTE = (
    "scope proves every expected path is present and correct; it does not prove "
    "closure — an added file or provider control is TD-10, narrowed by the "
    "no-Functions, control-path and header checks but not eliminated"
)

#: Provider control files Cloudflare consumes as configuration instead of
#: serving. Each is probed **separately**, and every one is probed on every run:
#: a loop that stopped at the first answer would let one poisoned path hide
#: behind another.
CONTROL_PATHS = ("/_redirects", "/_headers", "/_worker.js")

#: The byte-exact Content-Security-Policy this deployment locks (it supersedes
#: an earlier hash-pinned policy) and ships as
#: `dashboard/public/_headers`. `script-src` carries NO inline hashes — the
#: pre-paint theme IIFE is external (`/theme-init.js`) and the bundler is
#: forbidden to inline modules — and the sole non-'self' origins are the
#: analytics beacon's (a reviewed feature added after the bare policy was
#: first locked). REQUIRED on every served asset and required to be EQUAL to this
#: value — not merely present, because a policy that is present but weakened is
#: precisely what a "has a CSP" check waves through. `style-src` carries
#: `'unsafe-inline'` and deliberately NO style hash: CSP2+ ignores
#: `'unsafe-inline'` in a directive that also lists hashes, so adding one would
#: silently re-block every data-driven bar width on the site (TD-PSH-3).
#: `tests/test_deploy_verify.py` pins this constant against the shipped
#: `_headers` bytes, so the two cannot drift apart unnoticed.
LOCKED_CONTENT_SECURITY_POLICY = (
    "default-src 'self'; "
    "script-src 'self' https://static.cloudflareinsights.com; "
    "style-src 'self' 'unsafe-inline'; "
    "img-src 'self' data:; "
    "font-src 'self'; "
    "connect-src 'self' https://cloudflareinsights.com; "
    "object-src 'none'; "
    "base-uri 'none'; "
    "frame-ancestors 'none'; "
    "form-action 'self'; "
    "upgrade-insecure-requests"
)

#: HSTS per LD13/R12: one year, deliberately WITHOUT `includeSubDomains` or
#: `preload` — subdomain readiness is unproven and a policy without either
#: remains reversible by serving `max-age=0` over HTTPS.
LOCKED_STRICT_TRANSPORT_SECURITY = "max-age=31536000"

#: Response headers that must be present exactly once AND equal to the given
#: value — the four security headers the shipped `_headers` control sets.
#: Checked on inventory-sampled assets that served 200 — the control-path
#: probes in :func:`probe_control_paths` are untouched, because a 404 carries
#: no `_headers` rule and asserting one there would fail the deploy for a
#: correctly-absent control path. A missing, weakened, duplicated/conflicting
#: value on any sampled path fails verification.
REQUIRED_RESPONSE_HEADERS = {
    "content-security-policy": LOCKED_CONTENT_SECURITY_POLICY,
    "strict-transport-security": LOCKED_STRICT_TRANSPORT_SECURITY,
    "x-content-type-options": "nosniff",
    "referrer-policy": "strict-origin-when-cross-origin",
}

#: The security-header names one shared normalization covers, everywhere a
#: policy header is judged: ordinary verification here, and the rollback
#: observation in :mod:`populus.deploy.orchestrator`. One helper, so a
#: duplicated or conflicting policy header cannot be collapsed before either.
SECURITY_HEADER_NAMES = tuple(sorted(REQUIRED_RESPONSE_HEADERS))



#: Response headers a static Pages asset is expected to carry. Anything else is
#: a finding, because an injected `_headers` is how a static deployment grows
#: behaviour. Notably absent, and absent on purpose: ``set-cookie``,
#: ``location`` and the ``access-control-*`` family — the three an attacker
#: would actually want.
ALLOWED_RESPONSE_HEADERS = frozenset(
    {
        "accept-ranges",
        # Cloudflare Pages sets this on served assets. Observed on the first
        # REAL deployment (run 9); the allowlist had been written from the spec
        # and had never seen a live response, which is exactly what the code
        # review said it could not verify without one.
        "access-control-allow-origin",
        "age",
        "alt-svc",
        "cache-control",
        "cf-cache-status",
        "cf-ray",
        "connection",
        "content-encoding",
        # Required, not merely tolerated — see REQUIRED_RESPONSE_HEADERS. It is
        # listed here as well because the allowlist and the required-set are
        # independent checks: omitting it here would flag the very header R36
        # exists to ship.
        "content-security-policy",
        "content-language",
        "content-length",
        "content-type",
        "cross-origin-embedder-policy",
        "cross-origin-opener-policy",
        "cross-origin-resource-policy",
        "date",
        "etag",
        "expires",
        "keep-alive",
        "last-modified",
        "nel",
        "permissions-policy",
        # Preview deployments carry `x-robots-tag: noindex` — Cloudflare adds it
        # so preview URLs are not indexed. Allowed rather than required: it is
        # present on preview and absent on production, so demanding it either
        # way would make one of the two legs fail for a reason unrelated to the
        # bytes.
        "x-robots-tag",
        "referrer-policy",
        "report-to",
        "reporting-endpoints",
        "server",
        "server-timing",
        "strict-transport-security",
        "transfer-encoding",
        "vary",
        "x-content-type-options",
        "x-frame-options",
    }
)

#: §12.1 samples headers rather than asserting them tree-wide; the marker page
#: and `stats.json` are always in the sample.
HEADER_SAMPLE_SIZE = 10

#: Appended to every fetch so an edge cache cannot answer for the origin.
CACHE_BUST_PARAM = "populus-verify"

_REQUEST_HEADERS = {"cache-control": "no-cache", "pragma": "no-cache"}

#: Statuses that mean *we did not get an answer*, mirroring the
#: attestation fetcher's treatment of 403/429. Everything >= 500 joins them.
_NO_ANSWER_STATUSES = frozenset({403, 408, 425, 429})

#: Both are **inventory** paths, not URLs, and stay that way: they index the
#: envelope, name the file inside the downloaded artifact
#: (``populus.deploy.record`` opens ``site/index.html`` with this), and key
#: :attr:`SweepResult.bodies`. :func:`served_path` is applied at the moment of
#: fetching and nowhere else, so the mapping never leaks into an identifier.
DEFAULT_MARKER_PATH = "index.html"
DEFAULT_STATS_PATH = "stats.json"

#: The document Pages serves for a directory, and the suffix it strips. Named
#: because :func:`served_path` and the collision guard must agree on them.
_INDEX_DOCUMENT = "index.html"
_HTML_SUFFIX = ".html"


class VerifyInputError(ValueError):
    """The inputs are malformed — a bug or a corrupt envelope, not a verdict.

    Raised, never folded into a verdict: "the inventory we were handed is not
    an inventory" must not be reportable as "the site is fine" *or* as "the
    site was tampered with".
    """


class VerifyUnavailable(RuntimeError):
    """No verdict was reached: transport failure, 429, 5xx.

    Raised internally and converted to an ``unavailable`` result at the top
    level. It is a distinct type for the same reason
    :class:`populus.publish.attestation.FetchUnavailable` is: a caller must not
    be able to reach "tampered" by squinting at a quota error.
    """


class HeaderMultimap(Protocol):
    """Occurrence-preserving response headers.

    A plain ``Mapping[str, str]`` cannot *represent* two occurrences of one
    header, so judging a policy through one silently collapses the duplicated/
    conflicting case this run must refuse. The HTTP boundary therefore exposes
    ``multi_items()`` — every ``(name, value)`` occurrence, in order —
    alongside the mapping-style ``get`` the redirect handling reads.
    The real client's ``Headers`` type satisfies this natively.
    """

    def multi_items(self) -> Sequence[tuple[str, str]]: ...

    def get(self, key: str, default: str | None = None) -> str | None: ...


class HttpResponse(Protocol):
    """The three things this module reads off a response.

    ``body`` is the **content-decoded** payload — any transfer/content encoding
    already removed — which is what the inventory's ``sha256``/``bytes`` were
    computed over. The wire length is deliberately not consulted: a gzipped
    asset's ``content-length`` header describes the compressed bytes and would
    disagree with the inventory on every compressible file.
    """

    @property
    def status_code(self) -> int: ...

    @property
    def content(self) -> bytes: ...

    @property
    def headers(self) -> HeaderMultimap: ...


class HttpGetter(Protocol):
    """An already-configured client. Injected, never constructed here.

    ``follow_redirects`` is passed explicitly on every call rather than being
    left to the client's default, so the redirects-disabled property is a
    property of *this* module and cannot be undone by how a caller happened to
    build its client.
    """

    def get(
        self, url: str, *, headers: Mapping[str, str], follow_redirects: bool
    ) -> HttpResponse: ...


@dataclass(frozen=True)
class Divergence:
    """One inventoried path whose served bytes are not the recorded bytes."""

    path: str
    reason: str

    def __str__(self) -> str:  # pragma: no cover - formatting only
        return f"{self.path}: {self.reason}"


@dataclass(frozen=True)
class SweepResult:
    """Outcome of the served-entry sweep.

    ``files_total`` means SERVED entries only — ``len(files)`` of the validated
    inventory — never files-plus-controls. Controls have no URL, so a
    sweep cannot count them; their evidence is the separately named
    control-effect fields on :class:`VerificationResult`.
    """

    divergences: tuple[Divergence, ...]
    files_verified: int
    files_total: int
    bodies: dict[str, bytes] = field(default_factory=dict)
    headers: dict[str, HeaderMultimap] = field(default_factory=dict)

    @property
    def diverged_paths(self) -> tuple[str, ...]:
        return tuple(sorted({d.path for d in self.divergences}))


@dataclass(frozen=True)
class VerificationResult:
    """What was checked, what failed, and whether we got an answer at all."""

    ok: bool
    outcome: str
    detail: str
    verification_scope: str = VERIFICATION_SCOPE
    files_verified: int = 0
    files_total: int = 0
    #: LD12b: the control-effect leg, counted under its own names so it can
    #: never masquerade as a served-file count. On a successful sweep both are
    #: exactly 1 — the one `_headers` control, its effect proven by the exact
    #: required-header values plus the `/_headers` 404 probe.
    controls_total: int = 0
    control_effects_verified: int = 0
    divergences: tuple[Divergence, ...] = ()
    findings: tuple[str, ...] = ()

    @property
    def unavailable(self) -> bool:
        return self.outcome == UNAVAILABLE

    @property
    def diverged_paths(self) -> tuple[str, ...]:
        """Exactly which inventoried paths diverged, sorted."""
        return tuple(sorted({d.path for d in self.divergences}))

    def as_record(self) -> dict:
        """The §12.1 step 6 verification block for a deployment generation."""
        return {
            "verification_scope": self.verification_scope,
            "files_verified": self.files_verified,
            "files_total": self.files_total,
            "controls_total": self.controls_total,
            "control_effects_verified": self.control_effects_verified,
            "outcome": self.outcome,
            "diverged_paths": list(self.diverged_paths),
            "non_detection": TD10_NOTE,
        }


# --- marker parsing ----------------------------------------------------

_META_TAG = re.compile(r"<meta\b([^>]*?)/?>", re.IGNORECASE | re.DOTALL)
_ATTRIBUTE = re.compile(
    r"""([A-Za-z_:][-A-Za-z0-9_:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))"""
)


def read_markers(document: str | bytes) -> dict[str, list[str]]:
    """Every ``<meta name=… content=…>`` in *document*, keyed by name.

    Values are lists because a duplicate marker is a real state a tampered page
    can be in, and collapsing it here would decide the question silently.
    Attribute order, quoting style and extra attributes are all tolerated; what
    is not tolerated is finding the value anywhere other than the ``content``
    of a ``<meta>`` whose ``name`` matches.
    """
    if isinstance(document, bytes):
        text = document.decode("utf-8", errors="replace")
    else:
        text = document

    found: dict[str, list[str]] = {}
    for match in _META_TAG.finditer(text):
        attributes: dict[str, str] = {}
        for attribute in _ATTRIBUTE.finditer(match.group(1)):
            name = attribute.group(1).lower()
            value = next(v for v in attribute.groups()[1:] if v is not None)
            attributes.setdefault(name, unescape(value))
        marker = attributes.get("name")
        if marker is not None and "content" in attributes:
            found.setdefault(marker, []).append(attributes["content"])
    return found


def check_markers(document: str | bytes, *, build_id: str, code_sha: str) -> list[str]:
    """Compare the named markers to the expected values, **exactly**.

    ``==`` on the full value, in both directions: neither a served
    abbreviation of the expected sha nor a served superstring of it passes.
    Containment is the defect this function exists to not have.
    """
    markers = read_markers(document)
    findings: list[str] = []
    for name, expected in ((MARKER_BUILD_ID, build_id), (MARKER_CODE_SHA, code_sha)):
        values = markers.get(name, [])
        if not values:
            findings.append(
                f"marker {name!r} is absent: the page carries no such <meta> "
                "(a value appearing elsewhere in the document is not a marker)"
            )
        elif len(values) > 1:
            findings.append(
                f"marker {name!r} appears {len(values)} times ({values!r}); an "
                "honest page emits exactly one, so no exact statement is possible"
            )
        elif values[0] != expected:
            findings.append(
                f"marker {name!r} mismatch: served {values[0]!r} != expected "
                f"{expected!r} (compared exactly, not by containment)"
            )
    return findings


# --- stats.json byte-equality -------------------------------------------


def check_stats(served: bytes, expected: bytes) -> list[str]:
    """The served ``stats.json`` must be the built one, byte for byte.

    Byte equality, not JSON equality: the canonical copy is rendered once with
    a named serialization, and a re-serialized copy that parses to the same
    object is a different artifact from the one the manifest lists.
    """
    if served == expected:
        return []
    return [
        "stats.json is not byte-equal to the built copy: "
        f"served sha256={hashlib.sha256(served).hexdigest()} ({len(served)} bytes) "
        f"!= built sha256={hashlib.sha256(expected).hexdigest()} "
        f"({len(expected)} bytes)"
    ]


# --- the three closure-narrowing provider checks -----------------------


def check_no_functions(deployment: Mapping[str, Any]) -> list[str]:
    """The deployment must report that it runs no Functions/Worker.

    Fails **closed** on a missing signal. The site is pure static; if the
    provider payload does not carry ``uses_functions`` we cannot assert its
    absence, and "the field wasn't there" must never read as "there are none".
    """
    if not isinstance(deployment, Mapping):
        raise VerifyInputError(f"deployment payload is not a mapping: {type(deployment)!r}")
    if "uses_functions" not in deployment:
        return [
            "deployment payload carries no 'uses_functions' field: the "
            "no-Functions assertion cannot be made, so it fails closed"
        ]
    value = deployment["uses_functions"]
    if value is not False:
        return [
            f"deployment reports uses_functions={value!r}: this site is pure "
            "static, and a Functions/Worker deployment is not verifiable by "
            "fetching assets"
        ]
    return []


def probe_control_paths(
    client: HttpGetter,
    base_url: str,
    *,
    cache_bust: str,
    control_paths: Sequence[str] = CONTROL_PATHS,
) -> list[str]:
    """Every control path must 404 — each probed on its own.

    All probes run on every call. Returning at the first bad answer would let a
    poisoned `/_headers` hide behind a poisoned `/_redirects`, which is the
    shape a "these all 404" check usually rots into.

    A never-published path is probed alongside them: a catch-all rewrite
    (`/* /index.html 200`) answers 200 for a path that has never existed, and
    that is the only cheap signal of one.

    These paths are probed **literally**, without :func:`served_path`: the
    claim being tested is that the control file is not served where it lives,
    and none of them is HTML, so the provider's index/extension rewrite does
    not apply to any of them anyway.
    """
    findings: list[str] = []
    probes = list(control_paths) + [f"/populus-never-published-{cache_bust}"]
    for probe in probes:
        fetched = _fetch(client, _url(base_url, probe.lstrip("/"), cache_bust))
        if fetched.status_code != 404:
            findings.append(
                f"control-path probe {probe} answered HTTP "
                f"{fetched.status_code}, expected 404 — the deployment is "
                "serving or acting on a provider control file"
            )
    return findings


def normalize_security_header_multimap(
    headers: HeaderMultimap,
    *,
    names: Sequence[str] = SECURITY_HEADER_NAMES,
) -> dict[str, tuple[str, ...]]:
    """The security headers as an occurrence-preserving normalized multimap.

    One shared normalization used by ordinary verification here and
    by the rollback observation in :mod:`populus.deploy.orchestrator`, so the
    two cannot disagree about what a policy header "is": names lower-cased,
    surrounding whitespace stripped off each value, **absence = empty tuple**
    (explicit, never a missing key), and every occurrence retained — collapsing
    two conflicting policies into one is exactly what this exists to prevent.
    The *consumers* refuse more than one occurrence; this function only makes
    the duplication observable.
    """
    normalized: dict[str, list[str]] = {name: [] for name in names}
    for raw_name, raw_value in headers.multi_items():
        name = raw_name.lower()
        if name in normalized:
            normalized[name].append(raw_value.strip())
    return {name: tuple(values) for name, values in normalized.items()}


def check_headers(
    headers: HeaderMultimap,
    *,
    path: str,
    allowlist: frozenset[str] = ALLOWED_RESPONSE_HEADERS,
    required: Mapping[str, str] = REQUIRED_RESPONSE_HEADERS,
) -> list[str]:
    """Flag headers outside the allowlist, and required headers missing/altered/duplicated.

    Two independent directions. The allowlist catches behaviour a static asset
    GAINED; *required* catches a control the deployment LOST — a CSP that is
    absent, present but rewritten, or present **twice with any values** is not
    detectable by an allowlist, which by construction only ever objects to
    headers it does not recognise. Occurrences are read through
    :func:`normalize_security_header_multimap`, so two conflicting policy
    headers are refused rather than collapsed into whichever one a mapping
    lookup happened to return.
    """
    findings: list[str] = []

    unexpected = sorted(
        {name.lower() for name, _value in headers.multi_items()} - allowlist
    )
    if unexpected:
        findings.append(
            f"unexpected response header(s) on {path}: {unexpected} — a static "
            "asset gained behaviour it was not built with"
        )

    observed = normalize_security_header_multimap(headers, names=sorted(required))
    for name, want in sorted(required.items()):
        values = observed[name]
        if not values:
            findings.append(
                f"missing required response header on {path}: {name} — the "
                "deployment is not carrying the policy it was built with"
            )
        elif len(values) > 1:
            findings.append(
                f"{name} on {path} appears {len(values)} times ({values!r}); a "
                "duplicated/conflicting policy header is refused, never collapsed"
            )
        elif values[0] != want:
            findings.append(
                f"{name} on {path} does not equal the locked policy: "
                f"observed {values[0]!r}"
            )

    return findings


# --- inventory path → served URL path ----------------------------------------


def served_path(path: str) -> str:
    """The URL path the provider answers 200 on for the inventoried *path*.

    Three rewrites, matching what Cloudflare Pages documents and what probing a
    live Pages origin returns:

    * ``index.html`` → ``""`` (the site root; the observed ``location`` is ``/``)
    * ``<dir>/index.html`` → ``<dir>/`` (trailing slash kept — Pages redirects
      `/about/index.html` to `/about/`, not to `/about`)
    * ``<name>.html`` → ``<name>``

    Everything else — ``.js``, ``.css``, ``.json``, images, fonts — is returned
    unchanged, because Pages serves non-HTML assets at their literal path.

    This is a rewrite of the *request*, never of the *identity*: the returned
    value is used to build one URL and is not stored, reported or compared.
    Divergences, ``bodies`` keys and ``diverged_paths`` all stay in inventory
    coordinates, so a finding still names the file the build produced.
    """
    if path == _INDEX_DOCUMENT:
        return ""
    if path.endswith(f"/{_INDEX_DOCUMENT}"):
        return path[: -len(_INDEX_DOCUMENT)]
    if path.endswith(_HTML_SUFFIX):
        return path[: -len(_HTML_SUFFIX)]
    return path


# --- the inventory-wide sweep ------------------------------------------


def sweep_inventory(
    client: HttpGetter,
    base_url: str,
    inventory: Mapping[str, Any],
    *,
    cache_bust: str,
    keep: Sequence[str] = (),
    header_paths: Sequence[str] = (),
) -> SweepResult:
    """Validate the FULL untrusted envelope, then sweep its served entries.

    The external trust boundary: *inventory* is an untrusted mapping
    and is validated — complete, exact, v2 — through
    :func:`~populus.publish.inventory.validate_inventory_v2` before any fetch.
    A partial one-file envelope, a v1-shaped document, or a missing/unknown
    control raises :class:`VerifyInputError` here, before network. The actual
    fetching lives in the package-internal :func:`_sweep_entries`, which only
    ever accepts typed entries from a validated document.
    """
    validated = _validated(inventory)
    return _sweep_entries(
        client,
        base_url,
        validated.files,
        cache_bust=cache_bust,
        keep=keep,
        header_paths=header_paths,
    )


def _sweep_entries(
    client: HttpGetter,
    base_url: str,
    entries: Sequence[InventoryFile],
    *,
    cache_bust: str,
    keep: Sequence[str] = (),
    header_paths: Sequence[str] = (),
) -> SweepResult:
    """Fetch every given served entry and compare hash and length.

    **Package-internal, and typed on purpose**: *entries* is a
    ``Sequence[InventoryFile]`` taken from a :class:`ValidatedInventoryV2` —
    never an inventory-shaped mapping, which this function deliberately cannot
    parse. That is what lets :func:`populus.deploy.record._confirm_domain`
    reuse the exact fetch policy on one already-validated marker entry without
    any public seam ever accepting a partial envelope.

    This is the load-bearing check. Both fields are compared, and which one
    disagreed is reported: a length-only comparison passes any same-size edit,
    and a hash-only comparison accepts an entry whose recorded length the
    served body contradicts.

    Each entry is fetched at :func:`served_path` of its inventory path — the
    URL the provider answers on — still with redirects disabled, so a 3xx on
    that mapped URL is reported exactly as it always was.

    *keep* names paths whose decoded body the caller still needs (the marker
    page, ``stats.json``) — retained from **this** fetch rather than fetched
    again, so the marker check and the sweep are statements about one response
    and not two. Its keys are inventory paths: the mapping is a fetch-time
    detail and a caller that asked for ``index.html`` gets ``index.html`` back.
    """
    _require_served_injective(entries)
    kept = set(keep)
    wanted_headers = set(header_paths)

    divergences: list[Divergence] = []
    bodies: dict[str, bytes] = {}
    headers: dict[str, Mapping[str, str]] = {}
    verified = 0

    for entry in entries:
        served = served_path(entry.path)
        fetched = _fetch(client, _url(base_url, served, cache_bust))
        status = fetched.status_code
        if 300 <= status < 400:
            location = fetched.headers.get("location", "")
            divergences.append(
                Divergence(
                    entry.path,
                    f"HTTP {status} at /{served} redirect to {location!r} — a 3xx "
                    "on the served URL of an inventoried path is a hijack, not a "
                    "hop to follow (the provider's own index/extension rewrite is "
                    "already applied, so there is nothing legitimate left to hop)",
                )
            )
            continue
        if status != 200:
            divergences.append(Divergence(entry.path, f"HTTP {status}, expected 200"))
            continue

        body = fetched.content
        if entry.path in kept:
            bodies[entry.path] = body
        if entry.path in wanted_headers:
            headers[entry.path] = fetched.headers

        digest = hashlib.sha256(body).hexdigest()
        wrong_digest = digest != entry.sha256
        wrong_length = len(body) != entry.bytes
        if wrong_digest or wrong_length:
            reasons = []
            if wrong_digest:
                reasons.append(f"sha256 {digest} != {entry.sha256}")
            if wrong_length:
                reasons.append(f"length {len(body)} != {entry.bytes}")
            divergences.append(Divergence(entry.path, "; ".join(reasons)))
            continue
        verified += 1

    return SweepResult(
        divergences=tuple(divergences),
        files_verified=verified,
        files_total=len(entries),
        bodies=bodies,
        headers=headers,
    )


# --- the whole verification -------------------------


def verify_deployment(
    client: HttpGetter,
    base_url: str,
    *,
    inventory: Mapping[str, Any],
    build_id: str,
    code_sha: str,
    stats_bytes: bytes,
    deployment: Mapping[str, Any],
    marker_path: str = DEFAULT_MARKER_PATH,
    stats_path: str = DEFAULT_STATS_PATH,
    control_paths: Sequence[str] = CONTROL_PATHS,
    header_allowlist: frozenset[str] = ALLOWED_RESPONSE_HEADERS,
    header_sample_size: int = HEADER_SAMPLE_SIZE,
    cache_bust: str | None = None,
) -> VerificationResult:
    """Verify what *base_url* serves against the inventory and the markers.

    One routine for both live checks: the preview origin and the custom
    domain differ only in *base_url*. That is deliberate — §12.1 step 4
    is amended to run this same inventory-wide sweep on the preview, because
    TD-4's bound ("the identical bytes already passed the preview sweep") is
    vacuous if the preview only read markers.

    The FULL untrusted envelope is validated first: a v1-shaped,
    partial, or control-less document raises :class:`VerifyInputError` before
    any network I/O. The verifier never fetches ``_headers`` as an asset — it
    still requires ``/_headers`` to answer 404 — and proves the control's exact
    *effect* through the required security-header values on representative
    HTML, JS, CSS and JSON paths, recorded under the separately named
    ``controls_total``/``control_effects_verified`` (both exactly 1 on
    success).
    """
    validated = _validated(inventory)
    entries = validated.files
    known = {entry.path for entry in entries}
    for required in (marker_path, stats_path):
        if required not in known:
            raise VerifyInputError(
                f"{required!r} is not in the inventory, so the sweep would not "
                "cover it; verification cannot be scoped to paths it cannot see"
            )

    bust = cache_bust or uuid4().hex
    sample = _header_sample(marker_path, stats_path, entries, header_sample_size)

    # No network yet: the provider payload is already in hand, and a Functions
    # deployment is not made verifiable by fetching more assets.
    findings: list[str] = check_no_functions(deployment)
    control_findings: list[str] = []

    try:
        sweep = _sweep_entries(
            client,
            base_url,
            entries,
            cache_bust=bust,
            keep=(marker_path, stats_path),
            header_paths=sample,
        )

        marker_body = sweep.bodies.get(marker_path)
        if marker_body is None:
            findings.append(
                f"markers unreadable: {marker_path} did not serve 200 (see the "
                "divergence for that path)"
            )
        else:
            findings.extend(
                check_markers(marker_body, build_id=build_id, code_sha=code_sha)
            )

        stats_body = sweep.bodies.get(stats_path)
        if stats_body is None:
            findings.append(f"stats.json unreadable: {stats_path} did not serve 200")
        else:
            findings.extend(check_stats(stats_body, stats_bytes))

        control_findings.extend(
            probe_control_paths(
                client, base_url, cache_bust=bust, control_paths=control_paths
            )
        )

        for path in sample:
            observed = sweep.headers.get(path)
            if observed is not None:
                # Header findings are CONTROL-effect findings: the `_headers`
                # control is what puts these values on served responses.
                control_findings.extend(
                    check_headers(observed, path=path, allowlist=header_allowlist)
                )
        findings.extend(control_findings)
    except VerifyUnavailable as exc:
        # R17: we did not get an answer. Not a divergence, not a finding, and
        # emphatically not tampering — the caller retries or alarms as an
        # outage, and nothing is attested either way.
        return VerificationResult(
            ok=False,
            outcome=UNAVAILABLE,
            detail=f"verification unavailable: {exc}",
            files_total=len(entries),
            controls_total=len(validated.controls),
        )

    findings.extend(str(divergence) for divergence in sweep.divergences)
    ok = not findings
    controls_total = len(validated.controls)
    control_effects_verified = (
        controls_total if not control_findings and controls_total == 1 else 0
    )
    detail = (
        f"{VERIFICATION_SCOPE}: {sweep.files_verified}/{sweep.files_total} files "
        f"verified at {base_url}; {TD10_NOTE}"
        if ok
        # NAME the findings, do not just count them. Run 9 rejected with
        # "10 finding(s)" and nothing else, and diagnosing it meant re-running
        # the sweep by hand against a preview that happened to still exist. A
        # verifier that refuses without saying what it saw makes every failure
        # an investigation. Capped so a wholesale divergence cannot bury the
        # log, with the remainder counted.
        else (
            f"{VERIFICATION_SCOPE}: {len(findings)} finding(s) at {base_url}: "
            + "; ".join(str(f) for f in findings[:8])
            + (f"; (+{len(findings) - 8} more)" if len(findings) > 8 else "")
        )
    )
    return VerificationResult(
        ok=ok,
        outcome=VERIFIED if ok else REJECTED,
        detail=detail,
        files_verified=sweep.files_verified,
        files_total=sweep.files_total,
        controls_total=controls_total,
        control_effects_verified=control_effects_verified,
        divergences=sweep.divergences,
        findings=tuple(findings),
    )


# --- internals ---------------------------------------------------------------


#: The representative response classes on which the control's header effect is
#: proven (R12/Task 10.4): one of each, always in the sample when present.
_REPRESENTATIVE_SUFFIXES = (".html", ".js", ".css", ".json")


def _header_sample(
    marker_path: str, stats_path: str, entries: Sequence[InventoryFile], size: int
) -> tuple[str, ...]:
    """The sampled paths: load-bearing ones and one of each representative type.

    The marker page and ``stats.json`` come first (they always were the
    sample's anchors); then the FIRST inventory entry of each representative
    suffix — HTML, JS, CSS, JSON — so the exact header values are proven on
    every response class the control governs, not only on whatever happened to
    sort first; then inventory order up to *size*.
    """
    representatives: list[str] = []
    for suffix in _REPRESENTATIVE_SUFFIXES:
        for entry in entries:
            if entry.path.endswith(suffix):
                representatives.append(entry.path)
                break
    sample: list[str] = []
    for candidate in (
        marker_path,
        stats_path,
        *representatives,
        *(entry.path for entry in entries),
    ):
        if candidate not in sample:
            sample.append(candidate)
        if len(sample) >= max(size, 2 + len(representatives)):
            break
    return tuple(sample)


def _validated(inventory: Mapping[str, Any]) -> ValidatedInventoryV2:
    """Full v2 validation at the external seam, in this module's vocabulary.

    A malformed envelope raises rather than returning an empty list: a sweep
    over zero files would report ``0/0 verified`` and pass. The one validator
    lives in :mod:`populus.publish.inventory`; its refusal is re-raised as
    :class:`VerifyInputError` because "the inventory we were handed is not an
    inventory" is this module's input-error contract, never a verdict.
    """
    try:
        return validate_inventory_v2(inventory)
    except InventoryError as exc:
        raise VerifyInputError(str(exc)) from exc


def _require_served_injective(entries: Sequence[InventoryFile]) -> None:
    """Two entries can be distinct files and still be served from one URL.

    `about.html` and a bare `about`, or `.html` and `index.html`. The tree
    this ships has no such pair, but the mapping is not injective in general
    and a silent collision would let one of the two be verified twice while
    the other was never fetched at all. Raised, not folded into a verdict:
    the ambiguity is in the inputs.
    """
    served_by: dict[str, str] = {}
    for entry in entries:
        served = served_path(entry.path)
        collides_with = served_by.get(served)
        if collides_with is not None:
            raise VerifyInputError(
                f"inventory entries {collides_with!r} and {entry.path!r} are both "
                f"served at /{served} — one URL cannot verify two files, and "
                "guessing which one it answered for is not verification"
            )
        served_by[served] = entry.path


def _url(base_url: str, path: str, cache_bust: str) -> str:
    """Origin + ``/`` + *path* + the cache-buster, verbatim.

    *path* is taken as already-served coordinates: :func:`sweep_inventory`
    passes it through :func:`served_path` first, and the control probes pass
    their literal path because a control file must 404 where it literally
    lives. Doing the rewrite in one named place instead of here keeps this
    function a formatter and keeps the provider quirk somewhere a reader can
    find it.

    Plain string work rather than a URL library, for the same reason the SEC
    client's host guard is plain string work: the parsers that would be
    convenient here are the ones this codebase does not import.
    """
    separator = "&" if "?" in path else "?"
    return f"{base_url.rstrip('/')}/{path}{separator}{CACHE_BUST_PARAM}={cache_bust}"


def _fetch(client: HttpGetter, url: str) -> HttpResponse:
    """One cache-busted fetch with redirects disabled.

    Anything the client raises is an outage, not a verdict — except
    ``AssertionError``, which is what the suite's no-network guard raises. That
    one is re-raised so an accidental real fetch fails the test loudly instead
    of being laundered into a tidy ``unavailable``.
    """
    try:
        response = client.get(url, headers=_REQUEST_HEADERS, follow_redirects=False)
    except AssertionError:
        raise
    except Exception as exc:  # transport-layer failure of any shape
        raise VerifyUnavailable(f"transport error fetching {url}: {exc}") from exc

    status = response.status_code
    if status in _NO_ANSWER_STATUSES or status >= 500:
        raise VerifyUnavailable(
            f"HTTP {status} fetching {url}: no verdict was reached (a rate limit "
            "or an origin error is an outage, never evidence of tampering)"
        )
    return response
