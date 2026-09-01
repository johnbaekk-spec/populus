"""The deployment signer (RUN P3-3b T10 — R13/R15/R16/R17/R22/R25/R27).

The signer's whole claim is that it trusts nothing it is told, so almost every
test here hands it something false and requires a refusal that *names what it
caught*. A test that only asserted ``ok is False`` would survive a mutation
that removed a different check (`mutation-tests-pin-properties`).

Two fixtures carry properties that have no other home:

* **R27 / §17(h) as amended** — the Cloudflare transport asserts on the verb.
  Every call the signer makes reaches ``_Pages.handler``, and any verb other
  than ``GET`` fails the test there rather than being counted afterwards. The
  killing mutant is stated in ``test_the_signer_issues_no_non_get_request``:
  make ``record.py`` issue one ``POST`` and this test must fail. The property is
  scoped to ``record.py`` — the deploy job legitimately POSTs (upload,
  rollback), so an unscoped version of it would be false by construction.
* **R25** — the round trip. A generation attested under the explicit subject
  name ``deployments/<gen>.json`` verifies against the shipped verifier; one
  attested under its **basename** (what ``actions/attest-build-provenance``
  produces from a ``subject-path``) is refused on *both* readings, which is why
  the workflow must pass ``subject-name`` + ``subject-digest``.

Everything runs offline: ``tests/conftest.py`` blocks real I/O, the Pages API is
an ``httpx.MockTransport`` behind a real client, and the served site is another.
"""

from __future__ import annotations

import ast
import hashlib
import json
import re
import shlex
from datetime import datetime, timezone
from pathlib import Path

import httpx
import pytest
import yaml

from populus.deploy import record
from populus.deploy import verify as verify_module
from populus.deploy.cloudflare import PagesClient, PagesRejected
from populus.deploy.record import (
    ACCOUNT_ID_ENV,
    EXIT_MISCONFIGURED,
    EXIT_REJECTED,
    EXIT_UNAVAILABLE,
    EXIT_VERIFIED,
    MISCONFIGURED,
    PAGES_READ_TOKEN_ENV,
    CloudflareReads,
    gate_publish,
    highest_generation,
    sign_deployment,
)
from populus.deploy.verify import (
    LOCKED_CONTENT_SECURITY_POLICY,
    REQUIRED_RESPONSE_HEADERS,
    CONTROL_PATHS,
    MARKER_BUILD_ID,
    MARKER_CODE_SHA,
    TD10_NOTE,
    VerifyUnavailable,
    served_path,
)
from populus.publish.attestation import (
    P2_OIDC_ISSUER,
    P2_RECORD_SIGN_IDENTITY,
    REJECTED,
    SLSA_PREDICATE_TYPE,
    UNAVAILABLE,
    VERIFIED,
    AttestationResult,
    SigstoreAttestation,
    VerificationFailed,
    resolve_identity,
)
from populus.publish.inventory import build_inventory, write_inventory
from populus.publish.pointer import build_pointer, render_pointer

REPO_ROOT = Path(__file__).resolve().parents[1]
FIXTURES = REPO_ROOT / "tests" / "fixtures" / "deploy"
RECORD_SIGN_YML = REPO_ROOT / ".github" / "workflows" / "record-sign.yml"
PUBLISH_YML = REPO_ROOT / ".github" / "workflows" / "publish.yml"
RECORD_SOURCE = (REPO_ROOT / "src" / "populus" / "deploy" / "record.py").read_text(
    encoding="utf-8"
)

BUILD_ID = "20260805.1"
CODE_SHA = "4f1a8c2e6b3d4a7f9e0c5b2d8a6f1c34a9e7d013"
ACCOUNT_ID = "d7b5e4995e76a76c9899695b54c61226"
PROJECT = "publicfilings"
DOMAIN = "publicfilings.org"
PAGES_READ_TOKEN = "cf-pages-read-token"
RUN_ID = "18234567890"
ARTIFACT_ID = "3344556677"
ARTIFACT_EXPIRES = "2026-09-04T04:30:00Z"
NOW = datetime(2026, 8, 5, 4, 30, 0, tzinfo=timezone.utc)

DEPLOYMENTS = json.loads((FIXTURES / "cf_deployments.json").read_text(encoding="utf-8"))
DOMAINS = json.loads((FIXTURES / "cf_domains.json").read_text(encoding="utf-8"))
DEPLOYMENT_ID = DEPLOYMENTS["result"][0]["id"]
DEPLOYMENT_URL = DEPLOYMENTS["result"][0]["url"]
DEPLOYMENT_HOST = httpx.URL(DEPLOYMENT_URL).host

STATS_JSON = (
    json.dumps(
        {
            "stats_version": "3",
            "build_id": BUILD_ID,
            "site_file_count": 6,
            "counts": {"filings": 41230},
        },
        ensure_ascii=False,
        indent=2,
        sort_keys=True,
    )
    + "\n"
).encode()


# --- the built site ----------------------------------------------------------


def _page(*, build_id: str = BUILD_ID, code_sha: str = CODE_SHA, extra: str = "") -> bytes:
    head = (
        '<meta charset="utf-8">'
        f'<meta name="{MARKER_BUILD_ID}" content="{build_id}">'
        f'<meta name="{MARKER_CODE_SHA}" content="{code_sha}">'
    )
    body = f"<footer>build {build_id}</footer>{extra}"
    return f"<!doctype html><html><head>{head}</head><body>{body}</body></html>".encode()


#: LD12: the one control every valid tree carries. Never SERVED by `_Origin` —
#: the provider consumes it as configuration and answers 404 on `/_headers`.
HEADERS_CONTROL = b"/*\n  Content-Security-Policy: default-src 'self'\n"


def _site(**kwargs) -> dict[str, bytes]:
    return {
        "index.html": _page(**kwargs),
        "congress/index.html": _page(extra="<h1>Congress</h1>", **kwargs),
        "assets/app.js": b"export const buildId = '20260805.1';\n",
        "assets/site.css": b":root{--populus-ink:#101418}\n",
        "stats.json": STATS_JSON,
    }


def _artifact(tmp_path: Path, site: dict[str, bytes]) -> Path:
    """The §12.1 artifact: ``site/**`` plus a sibling ``inventory.json``."""
    root = tmp_path / "artifact"
    tree = root / "site"
    for path, body in site.items():
        target = tree / path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(body)
    tree.joinpath("_headers").write_bytes(HEADERS_CONTROL)
    write_inventory(tree, root / "inventory.json")
    return root


def _data_repo(tmp_path: Path, *, build_id: str = BUILD_ID) -> Path:
    """A `populus-data` checkout with a real pointer over a real manifest."""
    repo = tmp_path / "populus-data"
    manifest = {
        "schema_version": "1.0",
        "module": "congress",
        "build_id": build_id,
        "artifacts": [],
    }
    manifest_bytes = (
        json.dumps(manifest, ensure_ascii=False, indent=2, sort_keys=True) + "\n"
    ).encode()
    manifest_path = repo / "builds" / build_id / "manifest.json"
    manifest_path.parent.mkdir(parents=True, exist_ok=True)
    manifest_path.write_bytes(manifest_bytes)
    pointer = build_pointer(
        pointer_version=7,
        issued_at=datetime(2026, 8, 5, 4, 0, 0, tzinfo=timezone.utc),
        build_id=build_id,
        manifest_sha256=hashlib.sha256(manifest_bytes).hexdigest(),
    )
    (repo / "latest.json").write_text(render_pointer(pointer), encoding="utf-8")
    return repo


# --- the collaborators -------------------------------------------------------


class _Attestation:
    """The seam, with per-subject verdicts. Records what it was asked."""

    def __init__(self, verdicts: dict[str, AttestationResult] | None = None) -> None:
        self._verdicts = verdicts or {}
        self.verified: list[str] = []
        self.attested: list[tuple[str, bytes]] = []

    def verify(self, subject_name: str, data: bytes) -> AttestationResult:
        self.verified.append(subject_name)
        verdict = self._verdicts.get(subject_name)
        if verdict is not None:
            return verdict
        return AttestationResult(ok=True, detail=f"fake verify {subject_name}")

    def attest(self, subject_name: str, data: bytes) -> AttestationResult:
        self.attested.append((subject_name, data))
        if resolve_identity(subject_name) is None:
            return AttestationResult(
                ok=False, detail=f"unknown subject {subject_name!r}", outcome=REJECTED
            )
        return AttestationResult(ok=True, detail=f"fake attest {subject_name}")


class _Pages:
    """The recorded Pages API — and the R27 verb guard.

    The assertion lives in the transport, not in a post-hoc count, so a write
    the signer issues fails the test at the moment it is issued even if nothing
    afterwards looks at ``self.verbs``.
    """

    def __init__(
        self,
        *,
        deployments: dict | None = None,
        domains: dict | None = None,
        deployments_status: int = 200,
        raiser: Exception | None = None,
        token: str = PAGES_READ_TOKEN,
    ) -> None:
        self.deployments = DEPLOYMENTS if deployments is None else deployments
        self.domains = DOMAINS if domains is None else domains
        self.deployments_status = deployments_status
        self.raiser = raiser
        self.token = token
        self.verbs: list[str] = []
        self.paths: list[str] = []

    def handler(self, request: httpx.Request) -> httpx.Response:
        self.verbs.append(request.method)
        self.paths.append(request.url.path)
        assert request.method == "GET", (
            f"the signer issued {request.method} {request.url.path}: record.py "
            "must issue no non-GET Cloudflare request (R27, §17(h) as amended)"
        )
        assert request.headers.get("authorization") == f"Bearer {self.token}", (
            "the Pages API was called without the signer's own read token"
        )
        if self.raiser is not None:
            raise self.raiser
        if request.url.path.endswith("/domains"):
            return httpx.Response(200, json=self.domains)
        if request.url.path.endswith("/deployments"):
            assert request.url.params.get("env") == "production"
            return httpx.Response(self.deployments_status, json=self.deployments)
        return httpx.Response(404, json={"success": False, "errors": ["unpinned path"]})

    def reads(self) -> CloudflareReads:
        return CloudflareReads(
            PagesClient(
                ACCOUNT_ID,
                PROJECT,
                self.token,
                transport=httpx.MockTransport(self.handler),
            )
        )


class _Origin:
    """The served tree, per host: the deployment origin and the custom domain.

    It models **Cloudflare Pages**, not a static file server, and the difference
    is load-bearing. Pages serves an HTML file at its *served* path and
    307-redirects the literal one: ``index.html`` → ``/``, ``about.html`` →
    ``/about``, ``congress/index.html`` → ``/congress/``. A fixture that answered
    200 at the literal path modelled a server that does not exist, and would let
    a signer that never applied the rewrite pass every test and then fail on the
    first real deploy — the redirect reads as a hijack, which is exactly what a
    3xx on an inventoried path is supposed to mean.
    """

    def __init__(
        self,
        served: dict[str, bytes],
        *,
        domain_served: dict[str, bytes] | None = None,
        raiser: Exception | None = None,
    ) -> None:
        self.served = dict(served)
        self.domain_served = dict(domain_served) if domain_served is not None else None
        self.raiser = raiser
        self.hosts: list[str] = []
        self.seen: list[str] = []

    def handler(self, request: httpx.Request) -> httpx.Response:
        self.hosts.append(request.url.host)
        self.seen.append(str(request.url))
        if self.raiser is not None:
            raise self.raiser
        table = self.served
        if request.url.host == DOMAIN and self.domain_served is not None:
            table = self.domain_served
        # Tables are keyed in INVENTORY coordinates (that is what the build
        # produces and what a divergence must name), so the lookup maps them the
        # way the provider does.
        answers = {
            served_path(path): body
            for path, body in table.items()
            if path != "_headers"  # provider configuration, never an asset
        }
        path = request.url.path.lstrip("/")
        if path in answers:
            # Faithful to a real Pages deployment, whose `_headers` `/*`
            # rule puts the exact required headers on every served asset.
            return httpx.Response(
                200,
                content=answers[path],
                headers=dict(REQUIRED_RESPONSE_HEADERS),
            )
        if served_path(path) != path and served_path(path) in answers:
            return httpx.Response(307, headers={"location": f"/{served_path(path)}"})
        return httpx.Response(404, content=b"<!doctype html><title>404</title>")

    def client(self) -> httpx.Client:
        return httpx.Client(transport=httpx.MockTransport(self.handler))


class _Harness:
    def __init__(self, result, *, repo, artifact, pages, origin, attestation):
        self.result = result
        self.repo = repo
        self.artifact = artifact
        self.pages = pages
        self.origin = origin
        self.attestation = attestation

    @property
    def generations(self) -> list[Path]:
        return sorted((self.repo / "builds" / BUILD_ID / "deployments").glob("*.json"))


def _run(
    tmp_path: Path,
    *,
    site: dict[str, bytes] | None = None,
    served: dict[str, bytes] | None = None,
    domain_served: dict[str, bytes] | None = None,
    repo: Path | None = None,
    artifact: Path | None = None,
    pages: _Pages | None = None,
    origin: _Origin | None = None,
    attestation: _Attestation | None = None,
    **kwargs,
) -> _Harness:
    site = _site() if site is None else site
    artifact = _artifact(tmp_path, site) if artifact is None else artifact
    repo = _data_repo(tmp_path) if repo is None else repo
    pages = _Pages() if pages is None else pages
    origin = (
        _Origin(site if served is None else served, domain_served=domain_served)
        if origin is None
        else origin
    )
    attestation = _Attestation() if attestation is None else attestation
    result = sign_deployment(
        data_repo=repo,
        artifact_dir=artifact,
        pages=pages.reads(),
        http=origin.client(),
        attestation=attestation,
        domain=DOMAIN,
        workflow_run_id=RUN_ID,
        now=NOW,
        dist_artifact_id=ARTIFACT_ID,
        dist_artifact_expires_at=ARTIFACT_EXPIRES,
        **kwargs,
    )
    return _Harness(
        result,
        repo=repo,
        artifact=artifact,
        pages=pages,
        origin=origin,
        attestation=attestation,
    )


# --- the happy path (R13) ----------------------------------------------------


def test_a_verified_deployment_is_recorded(tmp_path):
    harness = _run(tmp_path)
    result = harness.result

    assert result.ok is True and result.outcome == VERIFIED
    assert result.generation == 1
    assert result.subject_name == "deployments/1.json"
    assert result.path == harness.repo / "builds" / BUILD_ID / "deployments" / "1.json"
    # The attested bytes are the written bytes, exactly.
    assert result.path.read_bytes() == result.document
    assert result.subject_digest == (
        "sha256:" + hashlib.sha256(result.document).hexdigest()
    )


def test_every_recorded_field_is_one_the_signer_derived(tmp_path):
    harness = _run(tmp_path)
    inventory = build_inventory(harness.artifact / "site")
    shipped = (harness.artifact / "inventory.json").read_bytes()

    assert harness.result.record == {
        "build_id": BUILD_ID,
        "generation": 1,
        "code_sha": CODE_SHA,
        "dist_digest": inventory["dist_digest"],
        "dist_digest_version": "1",
        # LD12b: the exact schema version and the exact canonical controls
        # identity the sign was verified under, plus separately named
        # control-effect counts — each exactly 1 on a successful sign.
        "inventory_version": "2",
        "inventory_digest": hashlib.sha256(shipped).hexdigest(),
        "controls": [
            {
                "path": "_headers",
                "kind": "cloudflare-pages-headers",
                "bytes": len(HEADERS_CONTROL),
                "sha256": hashlib.sha256(HEADERS_CONTROL).hexdigest(),
            }
        ],
        "swept_origin": DEPLOYMENT_URL,
        "verification_scope": "expected_paths",
        "files_verified": 5,
        "files_total": 5,
        "controls_total": 1,
        "control_effects_verified": 1,
        "domain": DOMAIN,
        "domain_scope": "marker_only",
        "domain_files_verified": 1,
        "domain_files_total": 5,
        "domain_controls_total": 1,
        "domain_control_effects_verified": 1,
        "workflow_run_id": RUN_ID,
        "dist_artifact_id": ARTIFACT_ID,
        "dist_artifact_expires_at": ARTIFACT_EXPIRES,
        "cf_production_deployment_id": DEPLOYMENT_ID,
        "verified_at": "2026-08-05T04:30:00Z",
        "non_detection": TD10_NOTE,
    }


def test_the_signer_verifies_both_attestations_before_using_either_document(tmp_path):
    harness = _run(tmp_path)
    # Pointer first, then the manifest it names, then the generation is attested.
    assert harness.attestation.verified == ["latest.json", "manifest.json"]
    assert [name for name, _ in harness.attestation.attested] == ["deployments/1.json"]


def test_the_deployment_url_and_the_domain_are_both_fetched(tmp_path):
    harness = _run(tmp_path)
    assert DEPLOYMENT_HOST in harness.origin.hosts, "the deployment origin was not swept"
    assert DOMAIN in harness.origin.hosts, "the live custom domain was never confirmed"


def test_generations_are_append_only(tmp_path):
    first = _run(tmp_path)
    second = _run(tmp_path, repo=first.repo, artifact=first.artifact)

    assert second.result.generation == 2
    assert second.result.subject_name == "deployments/2.json"
    assert [path.name for path in second.generations] == ["1.json", "2.json"]
    # The first generation is untouched — a redeploy appends, never overwrites.
    assert first.result.path.read_bytes() == first.result.document


# --- R13: nothing the deploy job says is believed ----------------------------


def test_a_claimed_deployment_id_is_cross_checked_not_trusted(tmp_path):
    harness = _run(tmp_path, claimed_deployment_id="deadbeef-0000-4000-8000-000000000000")

    assert harness.result.outcome == REJECTED
    assert "deadbeef" in harness.result.detail and DEPLOYMENT_ID in harness.result.detail
    assert harness.generations == [], "a refused run must write no generation"


def test_a_claimed_dist_digest_is_cross_checked_not_recorded(tmp_path):
    harness = _run(tmp_path, claimed_dist_digest="00" * 32)

    assert harness.result.outcome == REJECTED
    assert "dist_digest" in harness.result.detail
    assert harness.generations == []


def test_the_build_id_comes_from_the_attested_manifest_not_the_artifact(tmp_path):
    """An artifact built for another build cannot rename the published one.

    The assertion names *which* check fired, and that is the whole test. A
    mismatched artifact would eventually also fail the marker comparison on the
    served page — so an ``outcome == REJECTED`` assertion here survives deleting
    the cross-check entirely and merely proves a different check exists. What is
    pinned instead is that the artifact is rejected **before any fetch**, by the
    check that can say why (mutation M9).
    """
    harness = _run(tmp_path, site=_site(build_id="20260804.9"))

    assert harness.result.outcome == REJECTED
    assert "is not this build's site" in harness.result.detail
    assert "20260804.9" in harness.result.detail and BUILD_ID in harness.result.detail
    assert harness.origin.hosts == [], "the site was fetched before the artifact was checked"


def test_an_unattested_pointer_is_refused(tmp_path):
    attestation = _Attestation(
        {"latest.json": AttestationResult(ok=False, detail="no bundle", outcome=REJECTED)}
    )
    harness = _run(tmp_path, attestation=attestation)

    assert harness.result.outcome == REJECTED
    assert "latest.json did not verify" in harness.result.detail
    # It stopped there: the manifest was never even looked up.
    assert harness.attestation.verified == ["latest.json"]


def test_an_unattested_manifest_is_refused(tmp_path):
    attestation = _Attestation(
        {
            "manifest.json": AttestationResult(
                ok=False, detail="wrong identity", outcome=REJECTED
            )
        }
    )
    harness = _run(tmp_path, attestation=attestation)

    assert harness.result.outcome == REJECTED
    assert "manifest.json did not verify" in harness.result.detail


def test_a_manifest_that_the_pointer_does_not_hash_to_is_refused(tmp_path):
    repo = _data_repo(tmp_path)
    manifest = repo / "builds" / BUILD_ID / "manifest.json"
    manifest.write_bytes(manifest.read_bytes().replace(b'"artifacts": []', b'"artifacts": [1]'))
    harness = _run(tmp_path, repo=repo)

    assert harness.result.outcome == REJECTED
    assert "does not match the pointer" in harness.result.detail


def test_a_pointer_and_manifest_that_name_different_builds_are_refused(tmp_path):
    repo = _data_repo(tmp_path)
    pointer = json.loads((repo / "latest.json").read_text(encoding="utf-8"))
    pointer["build_id"] = "20260804.1"
    (repo / "latest.json").write_text(render_pointer(pointer), encoding="utf-8")
    harness = _run(tmp_path, repo=repo)

    assert harness.result.outcome == REJECTED
    assert "20260804.1" in harness.result.detail


def test_the_inventory_is_recomputed_from_the_tree_not_believed(tmp_path):
    """A shipped inventory that describes different bytes is not an inventory."""
    site = _site()
    artifact = _artifact(tmp_path, site)
    (artifact / "site" / "assets" / "app.js").write_bytes(b"// swapped after sealing\n")
    harness = _run(tmp_path, site=site, artifact=artifact)

    assert harness.result.outcome == REJECTED
    assert "not the inventory of the tree beside it" in harness.result.detail


def test_a_missing_inventory_sibling_is_refused(tmp_path):
    artifact = _artifact(tmp_path, _site())
    (artifact / "inventory.json").unlink()
    harness = _run(tmp_path, artifact=artifact)

    assert harness.result.outcome == REJECTED
    assert "inventory.json sibling" in harness.result.detail


# --- R15: the sweep is inventory-wide ----------------------------------------


def test_a_marker_preserving_tamper_is_caught(tmp_path):
    """build_id, code_sha and stats.json all correct; one JS asset is not.

    This is the attack the whole module exists for: the three fields a marker
    check reads are exactly the three a compromised deploy job would leave
    alone.
    """
    site = _site()
    served = dict(site)
    served["assets/app.js"] = b"export const buildId = '20260805.1';// +telemetry\n"
    harness = _run(tmp_path, site=site, served=served)

    assert harness.result.outcome == REJECTED
    assert "assets/app.js" in harness.result.detail
    assert "sha256" in harness.result.detail
    assert harness.generations == []


def test_the_domain_serving_another_build_is_caught(tmp_path):
    """The deployment origin is clean; the domain is not pointed at it."""
    site = _site()
    stale = dict(site)
    stale["index.html"] = _page(build_id="20260804.1")
    harness = _run(tmp_path, site=site, domain_served=stale)

    assert harness.result.outcome == REJECTED
    assert DOMAIN in harness.result.detail
    assert "index.html" in harness.result.detail


def test_a_domain_that_serves_nothing_is_caught(tmp_path):
    harness = _run(tmp_path, domain_served={})

    assert harness.result.outcome == REJECTED
    assert "HTTP 404" in harness.result.detail


# --- R16: the provider checks and the honest scope ---------------------------


def test_a_deployment_reporting_functions_is_refused(tmp_path):
    payload = json.loads(json.dumps(DEPLOYMENTS))
    payload["result"][0]["uses_functions"] = True
    harness = _run(tmp_path, pages=_Pages(deployments=payload))

    assert harness.result.outcome == REJECTED
    assert "uses_functions" in harness.result.detail


def test_a_missing_uses_functions_field_fails_closed(tmp_path):
    """The signer reads the RAW provider object for exactly this case.

    ``PagesClient.latest_production_deployment()`` coerces the field with
    ``bool()``, so a deployment payload that never carried it would arrive as
    ``uses_functions=False`` and pass. Mutant: make ``CloudflareReads`` return
    the typed deployment instead of the raw payload — this test must fail.
    """
    payload = json.loads(json.dumps(DEPLOYMENTS))
    del payload["result"][0]["uses_functions"]
    harness = _run(tmp_path, pages=_Pages(deployments=payload))

    assert harness.result.outcome == REJECTED
    assert "fails closed" in harness.result.detail


def test_the_record_claims_expected_paths_and_never_full(tmp_path):
    harness = _run(tmp_path)

    assert harness.result.record["verification_scope"] == "expected_paths"
    assert b'"full"' not in harness.result.document
    assert "full" not in json.loads(harness.result.document)["verification_scope"]


def test_the_record_carries_the_td10_non_detection(tmp_path):
    harness = _run(tmp_path)
    note = json.loads(harness.result.document)["non_detection"]

    assert note == TD10_NOTE
    assert "TD-10" in note and "closure" in note


def test_the_record_counts_every_inventoried_file(tmp_path):
    harness = _run(tmp_path)
    record_doc = harness.result.record

    assert record_doc["files_verified"] == record_doc["files_total"] == len(_site())


# --- R17: an outage is never an accusation -----------------------------------


def test_a_rate_limited_pages_api_is_unavailable(tmp_path):
    harness = _run(tmp_path, pages=_Pages(deployments_status=429))

    assert harness.result.outcome == UNAVAILABLE
    assert harness.result.unavailable is True
    assert harness.result.outcome != REJECTED
    # The message names the status and says out loud what it is not.
    assert "HTTP 429" in harness.result.detail
    assert "lookup failure" in harness.result.detail
    assert harness.generations == []


def test_a_pages_transport_failure_is_unavailable(tmp_path):
    harness = _run(tmp_path, pages=_Pages(raiser=httpx.ConnectError("no route")))

    assert harness.result.outcome == UNAVAILABLE
    assert "no verdict" in harness.result.detail


def test_an_unreachable_site_is_unavailable(tmp_path):
    site = _site()
    origin = _Origin(site, raiser=httpx.ReadTimeout("timed out"))
    harness = _run(tmp_path, site=site, origin=origin)

    assert harness.result.outcome == UNAVAILABLE
    assert harness.generations == []


def test_an_unreachable_domain_is_unavailable_not_a_divergence(tmp_path):
    """The deployment sweeps clean and only the domain leg fails to answer."""

    class _FlakyDomain(_Origin):
        def handler(self, request: httpx.Request) -> httpx.Response:
            if request.url.host == DOMAIN:
                self.hosts.append(request.url.host)
                raise httpx.ConnectError("domain unreachable")
            return super().handler(request)

    site = _site()
    harness = _run(tmp_path, site=site, origin=_FlakyDomain(site))

    assert harness.result.outcome == UNAVAILABLE
    assert "did not answer" in harness.result.detail


def test_an_unavailable_attestation_lookup_is_unavailable(tmp_path):
    attestation = _Attestation(
        {
            "latest.json": AttestationResult(
                ok=False, detail="HTTP 429 from the attestation API", outcome=UNAVAILABLE
            )
        }
    )
    harness = _run(tmp_path, attestation=attestation)

    assert harness.result.outcome == UNAVAILABLE
    assert "unavailable" in harness.result.detail


def test_an_inactive_custom_domain_is_refused(tmp_path):
    domains = json.loads(json.dumps(DOMAINS))
    domains["result"][0]["status"] = "initializing"
    harness = _run(tmp_path, pages=_Pages(domains=domains))

    assert harness.result.outcome == REJECTED
    assert "initializing" in harness.result.detail


# --- R27 / §17(h): the signer issues no non-GET Cloudflare request -----------


def test_the_signer_issues_no_non_get_request(tmp_path):
    """The named mutant: make ``record.py`` issue one ``POST`` and this fails.

    ``_Pages.handler`` asserts on the verb, so the failure happens inside the
    signer's own call rather than in a tally afterwards. Both halves matter —
    the assertion below would pass vacuously if nothing had been called at all,
    so the call count is pinned too.
    """
    harness = _run(tmp_path)

    assert harness.result.ok is True
    assert harness.pages.verbs, "no Cloudflare call was made; the property is vacuous"
    assert set(harness.pages.verbs) == {"GET"}
    assert len(harness.pages.verbs) >= 2  # the deployments list and the domains list


def test_the_cloudflare_surface_is_two_reads_and_nothing_else():
    """R27 structurally — and the assertion is no longer self-referential.

    This test used to compare the class's public callables against
    ``CloudflareReads.READ_SURFACE``, a constant ten lines above the class in
    the same file. Adding a method *and* adding its name to the constant kept it
    green, which is to say it asserted that someone had updated a tuple, not
    that the surface was two reads. It was decoration.

    The expected set is now a literal written **here**. Growing the class fails
    the first assertion; growing the class and the constant together still fails
    it. The second assertion keeps the constant honest, since production code
    and the module docstring both point at it.
    """
    expected = {"active_custom_domain", "production_deployment"}
    public = {
        name
        for name in vars(CloudflareReads)
        if not name.startswith("_") and callable(getattr(CloudflareReads, name))
    }
    assert public == expected, (
        "the signer's Cloudflare surface changed. This is not a test to update "
        "in passing: every method here is a request the signer issues under a "
        "token §14 scopes to Pages Read (R27)."
    )
    assert set(CloudflareReads.READ_SURFACE) == expected


def test_the_read_helper_refuses_a_non_get_verb():
    """R27 executably: ``_get`` raises rather than promising.

    The structural test above says the class has two methods. It cannot say the
    class *reads*, because ``self._client`` is a whole ``PagesClient`` and
    Python cannot take ``rollback`` away from it. What can be pinned is that the
    one helper every request leaves through refuses anything but a GET — so a
    later change that generalises it has to delete this test on purpose.
    """
    reads = _Pages().reads()
    with pytest.raises(PagesRejected) as raised:
        reads._get("/anything", method="PUT")
    assert "read-only" in str(raised.value)
    assert "PUT" in str(raised.value)

    # And the default is the accepted one: the guard is not simply refusing
    # everything, which would make the assertion above pass vacuously.
    assert reads.production_deployment().id == DEPLOYMENT_ID


def test_the_signer_touches_only_read_helpers_on_the_pages_client():
    """The third reading: what does ``record.py`` reach for on ``self._client``?

    ``CloudflareReads`` holds a full client, so ``self._client.rollback(...)``
    is one line away at all times. The transport fixture catches a write that
    runs and this catches one that is written; between them the only remaining
    hole is a line that is neither executed nor written, which is not a hole.
    """
    allowed = {"_request", "_deployments_path", "assert_custom_domain_active"}
    tree = ast.parse(RECORD_SOURCE)
    touched = {
        node.attr
        for node in ast.walk(tree)
        if isinstance(node, ast.Attribute)
        and isinstance(node.value, ast.Attribute)
        and node.value.attr == "_client"
    }
    assert touched, "no `self._client` access found — the guard is vacuous"
    assert touched <= allowed, (
        f"record.py reaches {sorted(touched - allowed)} on the Pages client; "
        "every one of those is authority the signer is not supposed to hold (R27)"
    )


def test_record_py_names_no_write_verb_and_calls_none():
    """A second, independent reading of the same property, over the source.

    The transport fixture catches a write that *runs*; this catches one that is
    written but only reached on some path a test does not exercise.
    """
    tree = ast.parse(RECORD_SOURCE)
    called = {
        node.func.attr
        for node in ast.walk(tree)
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute)
    }
    assert "rollback" not in called, "record.py calls the rollback endpoint (R27)"

    verbs = {
        node.value
        for node in ast.walk(tree)
        if isinstance(node, ast.Constant)
        and isinstance(node.value, str)
        and node.value in {"GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"}
    }
    assert verbs == {"GET"}, f"record.py names non-GET verbs: {sorted(verbs - {'GET'})}"


def test_the_signer_bakes_in_no_host_or_project():
    """Project, domain and account are inputs; nothing is locked in the module."""
    assert "publicfilings" not in RECORD_SOURCE
    assert "pages.dev" not in RECORD_SOURCE


# --- R25: the subject name round-trips, the basename does not ----------------


class _Fetcher:
    def __init__(self, bundles: list[dict] | None = None, raises: Exception | None = None):
        self._bundles = bundles or []
        self._raises = raises

    def fetch_bundles(self, digest_hex: str) -> list[dict]:
        if self._raises is not None:
            raise self._raises
        return list(self._bundles)


class _Verifier:
    """Models the real contract: signature + certificate policy in one call."""

    def __init__(self, payload: bytes, *, expect_identity: str = P2_RECORD_SIGN_IDENTITY):
        self._payload = payload
        self._expect_identity = expect_identity
        self.seen: list[tuple[str, str]] = []

    def verify(self, bundle: dict, *, identity: str, issuer: str):
        self.seen.append((identity, issuer))
        if identity != self._expect_identity:
            raise VerificationFailed(f"certificate identity {identity!r} does not match")
        if issuer != P2_OIDC_ISSUER:
            raise VerificationFailed(f"issuer {issuer!r} does not match")
        # The REAL verify_dsse contract (run 6): first element is the DSSE
        # ENVELOPE type; the SLSA predicateType lives inside the statement.
        return "application/vnd.in-toto+json", self._payload


def _statement(name: str, document: bytes) -> bytes:
    """The in-toto statement `attest-build-provenance` produces for one subject."""
    return json.dumps(
        {
            "_type": "https://in-toto.io/Statement/v1",
            "predicateType": SLSA_PREDICATE_TYPE,
            "subject": [
                {
                    "name": name,
                    "digest": {"sha256": hashlib.sha256(document).hexdigest()},
                }
            ],
        }
    ).encode()


def _provider(statement_name: str, document: bytes) -> SigstoreAttestation:
    return SigstoreAttestation(
        fetcher=_Fetcher([{"mediaType": "application/vnd.dev.sigstore.bundle.v0.3+json"}]),
        trust_config=_Verifier(_statement(statement_name, document)),
    )


def test_a_generation_attested_under_the_deployments_name_round_trips(tmp_path):
    """R25, the positive half: attest as ``deployments/<gen>.json`` → verifies."""
    harness = _run(tmp_path)
    subject = harness.result.subject_name
    document = harness.result.document
    assert subject == "deployments/1.json"

    verifier = _provider(subject, document)
    result = verifier.verify(subject, document)

    assert result.ok is True and result.outcome == VERIFIED
    assert P2_RECORD_SIGN_IDENTITY in result.detail


def test_a_basename_attested_generation_is_refused_on_both_readings(tmp_path):
    """R25, the negative half — and it fails twice, for two different reasons.

    ``actions/attest-build-provenance`` with ``subject-path`` names the subject
    by basename, so a generation at ``builds/<id>/deployments/1.json`` would
    attest as ``1.json``. Asking for it under either name refuses: the basename
    resolves to no identity at all, and the pinned name matches no statement
    subject. That is why the workflow passes ``subject-name`` explicitly.
    """
    harness = _run(tmp_path)
    document = harness.result.document
    basename = Path(harness.result.subject_name).name
    assert basename == "1.json"

    # The action attested the basename; the verifier is asked for the real name.
    verifier = _provider(basename, document)
    pinned = verifier.verify("deployments/1.json", document)
    assert pinned.ok is False and pinned.outcome == REJECTED
    assert "no verified subject named" in pinned.detail

    # And asking under the basename is refused before any bundle is fetched.
    assert resolve_identity(basename) is None
    by_basename = _provider(basename, document).verify(basename, document)
    assert by_basename.ok is False and by_basename.outcome == REJECTED
    assert "no certificate identity is mapped" in by_basename.detail


def test_the_signer_refuses_a_subject_name_the_verifier_would_refuse(tmp_path):
    """The pin is in code: the name is built, then checked against the resolver.

    Mutant: make ``generation_subject_name`` return the bare ``<gen>.json``.
    ``sign_deployment`` must refuse rather than write a generation nothing can
    verify.
    """
    assert resolve_identity(record.generation_subject_name(4)) == P2_RECORD_SIGN_IDENTITY

    monkey = record.generation_subject_name
    try:
        record.generation_subject_name = lambda generation: f"{generation}.json"
        harness = _run(tmp_path)
    finally:
        record.generation_subject_name = monkey

    assert harness.result.outcome == REJECTED
    assert "does not resolve to the record-signer identity" in harness.result.detail
    assert harness.generations == []


# --- §17(h) credential fixtures ----------------------------------------------


def _no_sleep(_seconds: float) -> None:
    """The settle between no-verdict retries, removed.

    Passed explicitly rather than patched globally: a test that reaches the
    retry path should say so in its own body, and the two callers below would
    otherwise sleep 90 real seconds each — which is how this file went from
    1.4s to 181s the first time the retry landed.
    """


def _argv(repo: Path, artifact: Path) -> list[str]:
    return [
        "--data-repo",
        str(repo),
        "--artifact",
        str(artifact),
        "--project",
        PROJECT,
        "--domain",
        DOMAIN,
        "--workflow-run-id",
        RUN_ID,
        "--dist-artifact-id",
        ARTIFACT_ID,
        "--dist-artifact-expires-at",
        ARTIFACT_EXPIRES,
        "--attestation",
        "staging-noop",
    ]


def test_the_signer_fails_closed_with_a_missing_token(tmp_path, monkeypatch, capsys):
    """No `Pages Read` token means no lookup, so nothing is attested at all."""
    monkeypatch.setenv(ACCOUNT_ID_ENV, ACCOUNT_ID)
    monkeypatch.delenv(PAGES_READ_TOKEN_ENV, raising=False)
    site = _site()
    artifact = _artifact(tmp_path, site)
    repo = _data_repo(tmp_path)

    exit_code = record.main(_argv(repo, artifact))

    assert exit_code == EXIT_MISCONFIGURED
    assert PAGES_READ_TOKEN_ENV in capsys.readouterr().err
    assert not (repo / "builds" / BUILD_ID / "deployments").exists()


def test_the_signer_fails_closed_with_a_missing_account_id(tmp_path, monkeypatch, capsys):
    monkeypatch.delenv(ACCOUNT_ID_ENV, raising=False)
    monkeypatch.setenv(PAGES_READ_TOKEN_ENV, PAGES_READ_TOKEN)
    repo = _data_repo(tmp_path)

    exit_code = record.main(_argv(repo, _artifact(tmp_path, _site())))

    assert exit_code == EXIT_MISCONFIGURED
    assert ACCOUNT_ID_ENV in capsys.readouterr().err


def test_the_signer_succeeds_with_a_pages_read_token(tmp_path, monkeypatch):
    """The token reaches the client, every call is a GET, and a record lands."""
    monkeypatch.setenv(ACCOUNT_ID_ENV, ACCOUNT_ID)
    monkeypatch.setenv(PAGES_READ_TOKEN_ENV, PAGES_READ_TOKEN)
    output = tmp_path / "github_output"
    monkeypatch.setenv("GITHUB_OUTPUT", str(output))

    site = _site()
    artifact = _artifact(tmp_path, site)
    repo = _data_repo(tmp_path)
    pages = _Pages()
    origin = _Origin(site)
    built: list[tuple[str, str, str]] = []

    def _client(account_id, project, token, **kwargs):
        built.append((account_id, project, token))
        return PagesClient(
            account_id, project, token, transport=httpx.MockTransport(pages.handler)
        )

    monkeypatch.setattr(record, "PagesClient", _client)
    exit_code = record.main(
        _argv(repo, artifact), http_factory=origin.client, now=NOW
    )

    assert exit_code == EXIT_VERIFIED
    assert built == [(ACCOUNT_ID, PROJECT, PAGES_READ_TOKEN)]
    assert set(pages.verbs) == {"GET"}
    assert (repo / "builds" / BUILD_ID / "deployments" / "1.json").is_file()

    # The attest step reads these; the code, not the YAML, chooses the name.
    emitted = dict(
        line.split("=", 1) for line in output.read_text(encoding="utf-8").splitlines()
    )
    assert emitted["subject_name"] == "deployments/1.json"
    assert emitted["outcome"] == VERIFIED
    assert emitted["generation"] == "1"
    written = (repo / "builds" / BUILD_ID / "deployments" / "1.json").read_bytes()
    assert emitted["subject_digest"] == "sha256:" + hashlib.sha256(written).hexdigest()


def test_the_entry_point_exit_codes_distinguish_refusal_from_outage(tmp_path, monkeypatch):
    """A quota error and a tamper must not page the same way."""
    monkeypatch.setenv(ACCOUNT_ID_ENV, ACCOUNT_ID)
    monkeypatch.setenv(PAGES_READ_TOKEN_ENV, PAGES_READ_TOKEN)
    site = _site()
    artifact = _artifact(tmp_path, site)

    served = dict(site)
    served["assets/site.css"] = b":root{--populus-ink:#000}\n"
    rejecting = _Pages()
    monkeypatch.setattr(
        record,
        "PagesClient",
        lambda *a, **kw: PagesClient(
            ACCOUNT_ID, PROJECT, PAGES_READ_TOKEN, transport=httpx.MockTransport(rejecting.handler)
        ),
    )
    assert (
        record.main(
            _argv(_data_repo(tmp_path), artifact),
            http_factory=_Origin(served).client,
            now=NOW,
        )
        == EXIT_REJECTED
    )

    outage = _Pages(deployments_status=429)
    monkeypatch.setattr(
        record,
        "PagesClient",
        lambda *a, **kw: PagesClient(
            ACCOUNT_ID, PROJECT, PAGES_READ_TOKEN, transport=httpx.MockTransport(outage.handler)
        ),
    )
    assert (
        record.main(
            _argv(_data_repo(tmp_path / "second"), artifact),
            http_factory=_Origin(site).client,
            now=NOW,
            sleep=_no_sleep,
        )
        == EXIT_UNAVAILABLE
    )


def test_the_only_transport_built_here_disables_redirects():
    """`main` builds one client; every other path takes an injected one."""
    client = record._default_http_client()
    try:
        assert client.follow_redirects is False
    finally:
        client.close()


def test_main_closes_the_client_it_built_and_not_the_one_it_was_given(
    tmp_path, monkeypatch
):
    """The client `main` opens is the one `main` must close.

    Nothing closed it, which leaks a connection pool on every run — invisible in
    a job that exits a second later, which is precisely why it would have
    survived forever. An INJECTED client is a different matter: it belongs to
    its caller, and closing it would be reaching into someone else's resource,
    so the two halves are asserted separately.
    """
    monkeypatch.setenv(ACCOUNT_ID_ENV, ACCOUNT_ID)
    monkeypatch.setenv(PAGES_READ_TOKEN_ENV, PAGES_READ_TOKEN)
    site = _site()
    pages = _Pages()
    monkeypatch.setattr(
        record,
        "PagesClient",
        lambda *a, **kw: PagesClient(
            ACCOUNT_ID, PROJECT, PAGES_READ_TOKEN, transport=httpx.MockTransport(pages.handler)
        ),
    )

    built: list[httpx.Client] = []

    def _default():
        client = _Origin(site).client()
        built.append(client)
        return client

    monkeypatch.setattr(record, "_default_http_client", _default)
    assert record.main(_argv(_data_repo(tmp_path), _artifact(tmp_path, site)), now=NOW) == (
        EXIT_VERIFIED
    )
    assert len(built) == 1
    assert built[0].is_closed, "main leaked the client it opened"

    injected = _Origin(site).client()
    try:
        assert (
            record.main(
                _argv(_data_repo(tmp_path / "second"), _artifact(tmp_path, site)),
                http_factory=lambda: injected,
                now=NOW,
            )
            == EXIT_VERIFIED
        )
        assert not injected.is_closed, "main closed a client it was handed"
    finally:
        injected.close()


# --- an outage never pages as tampering, in production or in the suite -------


def test_the_class_the_signer_catches_is_the_class_verify_raises():
    """The order-dependency detector, and the reason it exists.

    ``tests/test_deploy_verify.py`` used to call ``importlib.reload`` on
    ``populus.deploy.verify`` and never restore it. ``reload`` re-executes the
    body into the same module object, so ``verify.VerifyUnavailable`` became a
    NEW class while ``record.py`` — imported earlier — kept the old one, and
    ``record.py``'s ``except VerifyUnavailable`` stopped catching what the
    reloaded ``_fetch`` raised. ``pytest tests/test_deploy_verify.py
    tests/test_deploy_record.py`` failed; the reverse order passed; alphabetical
    default collection is the only reason CI read green.

    This assertion fails the moment anything reloads that module ahead of this
    file, whatever the collection order — so the defect can no longer hide in
    it. The three bindings are checked separately because they can diverge
    separately: the name imported into ``record``, the name the raising function
    closes over, and the class the module currently exposes.
    """
    assert record.VerifyUnavailable is verify_module.VerifyUnavailable, (
        "populus.deploy.verify was re-imported after record.py bound its "
        "exception class — record.py's `except VerifyUnavailable` is now dead "
        "code and an outage will page as tampering"
    )
    assert (
        record._sweep_entries.__globals__["VerifyUnavailable"]
        is record.VerifyUnavailable
    )
    assert record.served_path is verify_module.served_path


def test_the_gate_fetch_policy_matches_the_sweep_fetch_policy():
    """The gate copies `verify._fetch`'s policy; the copy may not drift.

    It is a copy on purpose — the gate fetches one path and has no inventory, so
    ``sweep_inventory`` does not fit, and binding another module's private name
    is the coupling the reload defect above was made of. A copy without a drift
    test is how "an outage is not an accusation" ends up true on one path and
    false on the other.
    """
    assert record._GATE_NO_ANSWER_STATUSES == verify_module._NO_ANSWER_STATUSES
    assert record._GATE_REQUEST_HEADERS == verify_module._REQUEST_HEADERS


def test_an_outage_that_reaches_the_top_level_is_unavailable_not_rejected(tmp_path):
    """The production half of the defect: `sign_deployment` caught nothing.

    Every path below `sign_deployment` is *supposed* to convert
    ``VerifyUnavailable`` into ``RecordUnavailable`` first. When one did not —
    which is exactly what the reload produced, and what deleting a conversion
    would produce — the exception escaped, `main` died with a traceback, and
    Python exited **1**, which is ``EXIT_REJECTED``. A Cloudflare outage paged
    identically to "the site was tampered with".

    Mutant: delete the ``except VerifyUnavailable`` clause in
    ``sign_deployment``. This test then errors on the raise instead of failing
    an assertion, and the exit-code test below reads 1.
    """
    def _outage(*args, **kwargs):
        raise VerifyUnavailable("HTTP 429 fetching the marker page")

    original = record._confirm_domain
    try:
        record._confirm_domain = _outage
        harness = _run(tmp_path)
    finally:
        record._confirm_domain = original

    assert harness.result.outcome == UNAVAILABLE
    assert harness.result.outcome != REJECTED
    assert harness.result.unavailable is True
    assert "429" in harness.result.detail
    assert harness.generations == [], "an outage must not write a generation"


def test_an_escaped_outage_exits_unavailable_and_never_rejected(tmp_path, monkeypatch):
    """The same defect at the exit code, which is what actually pages someone."""
    monkeypatch.setenv(ACCOUNT_ID_ENV, ACCOUNT_ID)
    monkeypatch.setenv(PAGES_READ_TOKEN_ENV, PAGES_READ_TOKEN)
    pages = _Pages()
    monkeypatch.setattr(
        record,
        "PagesClient",
        lambda *a, **kw: PagesClient(
            ACCOUNT_ID, PROJECT, PAGES_READ_TOKEN, transport=httpx.MockTransport(pages.handler)
        ),
    )

    def _outage(*args, **kwargs):
        raise VerifyUnavailable("the edge did not answer")

    monkeypatch.setattr(record, "_confirm_domain", _outage)
    site = _site()
    exit_code = record.main(
        _argv(_data_repo(tmp_path), _artifact(tmp_path, site)),
        http_factory=_Origin(site).client,
        now=NOW,
        sleep=_no_sleep,
    )

    assert exit_code == EXIT_UNAVAILABLE
    assert exit_code != EXIT_REJECTED


def _signing_pages(monkeypatch):
    """The recorded Pages API, wired in as the signer's client."""
    pages = _Pages()
    monkeypatch.setattr(
        record,
        "PagesClient",
        lambda *a, **kw: PagesClient(
            ACCOUNT_ID, PROJECT, PAGES_READ_TOKEN, transport=httpx.MockTransport(pages.handler)
        ),
    )
    return pages


def test_a_no_verdict_signing_attempt_is_retried_and_can_then_succeed(tmp_path, monkeypatch):
    """One 502 must not leave a correct deployment unattested.

    Run 32342764618 (2026-08-20): a single 502 on one swept path failed the
    signer, and a rerun of the identical command attested it seconds later. The
    deployment was never in doubt — only reachable.
    """
    monkeypatch.setenv(ACCOUNT_ID_ENV, ACCOUNT_ID)
    monkeypatch.setenv(PAGES_READ_TOKEN_ENV, PAGES_READ_TOKEN)
    _signing_pages(monkeypatch)
    site = _site()

    real = record._confirm_domain
    attempts: list[int] = []

    def flaky(*args, **kwargs):
        attempts.append(1)
        if len(attempts) == 1:
            raise VerifyUnavailable(
                "HTTP 502 fetching https://origin/congress/tickers/CNMD/: no "
                "verdict was reached"
            )
        return real(*args, **kwargs)

    monkeypatch.setattr(record, "_confirm_domain", flaky)
    slept: list[float] = []

    exit_code = record.main(
        _argv(_data_repo(tmp_path), _artifact(tmp_path, site)),
        http_factory=_Origin(site).client,
        now=NOW,
        sleep=slept.append,
    )

    assert exit_code == EXIT_VERIFIED
    assert len(attempts) == 2, "the outage was not retried"
    assert slept == [record.SIGN_SETTLE_SECONDS], "the served tree got no settle"


def test_a_rejection_is_never_retried(tmp_path, monkeypatch):
    """A divergence does not become true by waiting — and must not be re-asked.

    This is the asymmetry the whole change rests on. If a REJECTED outcome ever
    became retryable here, the signer would be re-asking a question it already
    got a real answer to, which is how a tamper turns into a pass.
    """
    monkeypatch.setenv(ACCOUNT_ID_ENV, ACCOUNT_ID)
    monkeypatch.setenv(PAGES_READ_TOKEN_ENV, PAGES_READ_TOKEN)
    _signing_pages(monkeypatch)
    site = _site()
    served = dict(site)
    served["assets/site.css"] = b":root{--populus-ink:#000}\n"
    slept: list[float] = []

    exit_code = record.main(
        _argv(_data_repo(tmp_path), _artifact(tmp_path, site)),
        http_factory=_Origin(served).client,
        now=NOW,
        sleep=slept.append,
    )

    assert exit_code == EXIT_REJECTED
    assert slept == [], "a divergence was retried; it must be answered once"


def test_a_persistent_outage_still_exits_unavailable_after_bounded_retries(
    tmp_path, monkeypatch
):
    """Bounded, not a loop. A broken origin still pages, just not on the first 502."""
    monkeypatch.setenv(ACCOUNT_ID_ENV, ACCOUNT_ID)
    monkeypatch.setenv(PAGES_READ_TOKEN_ENV, PAGES_READ_TOKEN)
    _signing_pages(monkeypatch)
    site = _site()
    attempts: list[int] = []

    def always_out(*args, **kwargs):
        attempts.append(1)
        raise VerifyUnavailable("the edge did not answer")

    monkeypatch.setattr(record, "_confirm_domain", always_out)
    slept: list[float] = []

    exit_code = record.main(
        _argv(_data_repo(tmp_path), _artifact(tmp_path, site)),
        http_factory=_Origin(site).client,
        now=NOW,
        sleep=slept.append,
    )

    assert exit_code == EXIT_UNAVAILABLE
    assert exit_code != EXIT_REJECTED, "an outage must never page as a tamper"
    assert len(attempts) == record.SIGN_UNAVAILABLE_RETRIES + 1
    assert len(slept) == record.SIGN_UNAVAILABLE_RETRIES


def test_a_pages_rejection_says_it_may_be_configuration(tmp_path):
    """`PagesRejected` covers a config fault as well as a finding.

    The exit code cannot separate them — downgrading every ``PagesRejected``
    would also downgrade "Cloudflare reports a different deployment is live",
    which is the finding this signer exists to make — so the detail names the
    source instead, and an operator is not left to infer tampering from a
    domain that was never attached to the project.
    """
    domains = json.loads(json.dumps(DOMAINS))
    domains["result"] = []
    harness = _run(tmp_path, pages=_Pages(domains=domains))

    assert harness.result.outcome == REJECTED
    assert "Cloudflare Pages API" in harness.result.detail
    assert "configuration" in harness.result.detail


# --- the domain leg's cache-bust is not a function of the build --------------


def test_the_domain_cache_bust_differs_between_deployments_of_one_build(tmp_path):
    """§5.5 anticipates one build being deployed more than once.

    The bust was ``sha256(f"{build_id}:{code_sha}")``, which is a function of
    the build and nothing else — so generation 2's domain URL was byte-identical
    to generation 1's, and an edge cache could answer the second check out of
    the first check's stored body. That is the one thing the parameter exists to
    prevent (``verify.py`` documents it as defeating edge caching, and
    ``verify_deployment`` uses ``uuid4``).

    Mutant: put the digest back. Both runs then produce the same URL and this
    fails.
    """
    first = _run(tmp_path)
    second = _run(tmp_path, repo=first.repo, artifact=first.artifact)
    assert first.result.ok and second.result.generation == 2

    def _domain_urls(harness) -> list[str]:
        return [url for url in harness.origin.seen if DOMAIN in url]

    one, two = _domain_urls(first), _domain_urls(second)
    assert one and two, "the domain leg issued no request"
    assert set(one).isdisjoint(two), (
        "the same build produced byte-identical domain URLs on two deployments; "
        f"an edge cache can answer the second from the first: {one!r}"
    )
    # And the parameter is actually present — the assertion above would hold
    # vacuously if the bust were dropped entirely.
    assert all(f"{verify_module.CACHE_BUST_PARAM}=" in url for url in one + two)


# --- every recorded number states its host -----------------------------------


def test_the_record_names_the_host_each_count_describes(tmp_path):
    """A reader of `deployments/1.json` must not read a sweep as a domain check.

    The sweep runs on the deployment-specific provider origin; the domain leg
    checks one path. The record carried ``files_verified``/``files_total`` and
    named neither host, so "12,543/12,543 verified" on a record *for
    publicfilings.org* read as a statement about publicfilings.org. It was a
    statement about a different machine.

    Mutant: delete ``swept_origin``, or set ``domain_files_total`` to 1 so the
    domain leg scores full marks. Both fail here.
    """
    harness = _run(tmp_path)
    written = json.loads(harness.result.path.read_text(encoding="utf-8"))

    assert written["swept_origin"] == DEPLOYMENT_URL
    assert written["swept_origin"] != f"https://{DOMAIN}"
    assert written["verification_scope"] == "expected_paths"
    assert written["files_verified"] == written["files_total"] == len(_site())

    assert written["domain"] == DOMAIN
    assert written["domain_scope"] == "marker_only"
    assert written["domain_files_verified"] == 1
    assert written["domain_files_total"] == len(_site())
    assert written["domain_files_verified"] < written["domain_files_total"], (
        "the domain leg must not report a full-marks fraction for a check that "
        "covered one path"
    )

    # Every count in the record belongs to a host named in the record.
    hosts = {written["swept_origin"], written["domain"]}
    assert len(hosts) == 2
    assert TD10_NOTE == written["non_detection"], (
        "TD-10 is about what the expected-paths scope cannot see on the host it "
        "swept, not about which host that was — it does not cover this"
    )


def test_the_domain_count_is_measured_not_assumed(tmp_path):
    """`domain_files_verified` comes back from the sweep, not from a literal.

    The domain leg checks one path today, so ``assert … == 1`` would pass
    against a hardcoded ``1`` — it would assert the constant, not the wiring.
    The count is therefore observed at its source: make ``_confirm_domain``
    report a different number and the record must carry that number. Mutant:
    write ``"domain_files_verified": 1`` and this fails.
    """
    harness = _run(tmp_path)
    assert harness.result.record["domain_files_verified"] == 1
    seen = [url for url in harness.origin.seen if DOMAIN in url]
    # One counted marker fetch plus the control-path probes and the
    # never-published probe (LD12b: the domain leg now proves the control's
    # absence-as-asset too).
    assert len(seen) == 1 + len(CONTROL_PATHS) + 1, (
        "the domain leg issued a different request set than it counted"
    )
    marker_fetches = [
        url for url in seen
        if "_redirects" not in url and "_headers" not in url
        and "_worker" not in url and "never-published" not in url
    ]
    assert len(marker_fetches) == 1

    original = record._confirm_domain
    try:
        record._confirm_domain = lambda *a, **kw: (3, 1, 1)
        widened = _run(tmp_path / "widened")
    finally:
        record._confirm_domain = original

    assert widened.result.record["domain_files_verified"] == 3, (
        "the recorded domain count is a literal, not what the domain leg returned"
    )


def test_the_detail_line_names_both_hosts(tmp_path):
    """The line an operator reads in the job log, not just the JSON."""
    harness = _run(tmp_path)
    assert DEPLOYMENT_URL in harness.result.detail
    assert DOMAIN in harness.result.detail
    assert "marker_only" in harness.result.detail
    assert "expected_paths" in harness.result.detail


# --- $GITHUB_OUTPUT framing --------------------------------------------------


def test_a_value_with_a_newline_is_emitted_as_a_heredoc(tmp_path, monkeypatch):
    """`name=value` is line-oriented; a newline writes a second output.

    None of the emitted values contains one today — they are an outcome
    constant, an integer, a subject name this module builds, a digest and a
    path. "Obviously impossible" is how this class of hole is always argued, so
    the framing is made unambiguous instead of the argument being trusted.
    """
    output = tmp_path / "github_output"
    monkeypatch.setenv("GITHUB_OUTPUT", str(output))
    monkeypatch.setattr(record, "_default_http_client", lambda: None)

    injected = record.SigningResult(
        outcome=VERIFIED,
        detail="ok",
        generation=1,
        subject_name="deployments/1.json",
        path=Path("/tmp/a\nrecord_path=/etc/passwd\n1.json"),
    )
    record._emit_outputs(injected)
    text = output.read_text(encoding="utf-8")

    parsed = _parse_github_output(text)
    assert set(parsed) == {
        "outcome",
        "generation",
        "subject_name",
        "subject_digest",
        "record_path",
    }, f"a newline in a value forged an extra output entry: {sorted(parsed)}"
    assert parsed["record_path"] == str(injected.path), (
        "the multi-line value did not survive its own framing"
    )
    assert parsed["outcome"] == VERIFIED
    assert parsed["subject_name"] == "deployments/1.json"

    # The framing is the heredoc form, under a delimiter the value cannot contain.
    heredoc = [line for line in text.splitlines() if line.startswith("record_path<<")]
    assert len(heredoc) == 1, f"expected one heredoc-framed value, got {text!r}"
    delimiter = heredoc[0].split("<<", 1)[1]
    assert delimiter and delimiter not in str(injected.path)

    # The guard is not decoration: the unguarded form IS exploitable, and this
    # is what it would have produced.
    unguarded = _parse_github_output(f"record_path={injected.path}\n")
    assert unguarded["record_path"] == "/etc/passwd", (
        "the plain form is not actually exploitable; this test proves nothing"
    )


def test_a_clean_value_keeps_the_plain_form(tmp_path, monkeypatch):
    """The guard only fires when it must — the workflow reads `name=value`."""
    output = tmp_path / "github_output"
    monkeypatch.setenv("GITHUB_OUTPUT", str(output))
    record._emit_outputs(
        record.SigningResult(
            outcome=VERIFIED,
            detail="ok",
            generation=3,
            subject_name="deployments/3.json",
            path=Path("/data/builds/20260805.1/deployments/3.json"),
        )
    )
    lines = output.read_text(encoding="utf-8").splitlines()

    assert "<<" not in output.read_text(encoding="utf-8")
    assert "generation=3" in lines
    assert "record_path=/data/builds/20260805.1/deployments/3.json" in lines


def _parse_github_output(text: str) -> dict[str, str]:
    """Read a `$GITHUB_OUTPUT` file the way the runner does.

    Written out rather than eyeballing the raw text: the property is what the
    *runner* ends up with, and a heredoc body legitimately contains lines that
    look like `name=value`. Asserting on the raw text flagged the CORRECT output
    as the bug on this test's first run, which is the whole argument for parsing.
    """
    parsed: dict[str, str] = {}
    lines = text.splitlines()
    index = 0
    while index < len(lines):
        line = lines[index]
        head = line.split("<<", 1)[0]
        if "<<" in line and "=" not in head:
            delimiter = line.split("<<", 1)[1]
            body: list[str] = []
            index += 1
            while index < len(lines) and lines[index] != delimiter:
                body.append(lines[index])
                index += 1
            parsed[head] = "\n".join(body)
        elif "=" in line:
            name, value = line.split("=", 1)
            parsed[name] = value
        index += 1
    return parsed


# === R18: the pre-publish gate ==============================================
#
# The gate is a different program from the signer with a different trust
# posture, and almost every test below is a state that must NOT publish. The one
# that must — the first run — is a conjunction of two facts, and both halves are
# tested alone to prove neither is sufficient by itself.


def _deployed(
    tmp_path: Path,
    *,
    build_id: str = BUILD_ID,
    generation: int = 1,
    code_sha: str = CODE_SHA,
    repo: Path | None = None,
) -> Path:
    """A `populus-data` checkout holding one written deployment generation."""
    repo = _data_repo(tmp_path, build_id=build_id) if repo is None else repo
    path = repo / "builds" / build_id / "deployments" / f"{generation}.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(
        record.render_generation(
            {
                "build_id": build_id,
                "generation": generation,
                "code_sha": code_sha,
                "verification_scope": "expected_paths",
            }
        )
    )
    return repo


def _gate(
    repo: Path | str,
    *,
    served: dict[str, bytes] | None = None,
    origin: _Origin | None = None,
    attestation: _Attestation | None = None,
    domain: str = DOMAIN,
    **kwargs,
):
    origin = _Origin(_site() if served is None else served) if origin is None else origin
    return gate_publish(
        data_repo=repo,
        http=origin.client(),
        attestation=_Attestation() if attestation is None else attestation,
        domain=domain,
        **kwargs,
    ), origin


# --- the passing states ------------------------------------------------------


def test_the_gate_passes_on_a_verified_generation_the_domain_serves(tmp_path):
    result, origin = _gate(_deployed(tmp_path))

    assert result.ok is True and result.outcome == VERIFIED
    assert result.first_run is False
    assert result.generation == 1 and result.build_id == BUILD_ID
    assert result.code_sha == CODE_SHA
    assert origin.hosts == [DOMAIN], "the gate read something other than the domain"


def test_the_first_run_predicate_needs_both_halves(tmp_path):
    """Zero generations AND no live deployment. Neither alone, ever.

    This is the only state in which the gate passes without verifying a
    generation, so it is the only place a permanent bypass could hide. All three
    combinations are asserted together, because the defect this shape has is
    always "one half was enough".
    """
    empty = _data_repo(tmp_path)  # a pointer, but no deployments/ anywhere
    deployed = _deployed(tmp_path / "b")

    both, _ = _gate(empty, served={})
    assert both.ok is True and both.first_run is True
    assert "first run" in both.detail

    # Half one: nothing recorded, but something is live.
    live_only, _ = _gate(empty)
    assert live_only.outcome == REJECTED
    assert live_only.first_run is False
    assert "unrecorded" in live_only.detail

    # Half two: something recorded, but nothing is live.
    recorded_only, _ = _gate(deployed, served={})
    assert recorded_only.outcome == REJECTED
    assert recorded_only.first_run is False
    assert "resolves to no deployment" in recorded_only.detail


def test_the_gate_reads_the_domain_at_its_served_path(tmp_path):
    """Cloudflare 307s `index.html` to `/`; the gate must ask for `/`.

    A gate that asked for the literal path would read the provider's own
    redirect as a hijack and refuse every publish forever. A gate that followed
    it would launder an injected `_redirects` into a pass. It asks for the
    served path with redirects disabled — both properties, one line.
    """
    _, origin = _gate(_deployed(tmp_path))
    (url,) = origin.seen

    assert url.startswith(f"https://{DOMAIN}/?"), f"asked for {url!r}"
    assert "index.html" not in url
    assert f"{verify_module.CACHE_BUST_PARAM}=" in url


def test_the_gate_cache_bust_is_fresh_on_every_call(tmp_path):
    repo = _deployed(tmp_path)
    _, first = _gate(repo)
    _, second = _gate(repo)
    assert first.seen != second.seen, "the gate's cache-bust repeats between runs"


# --- R18's whole point: it VERIFIES, it does not resolve ---------------------


def test_an_unsigned_generation_fails_the_gate(tmp_path):
    """Revision 1 of R18 said "resolves the path"; an unsigned file resolves.

    Mutant: drop the `_require_attested` call in `_gate`. This test is the one
    that fails, and it is the whole difference between the requirement as
    written and the requirement as meant.
    """
    attestation = _Attestation(
        {
            "deployments/1.json": AttestationResult(
                ok=False, detail="no bundle for this digest", outcome=REJECTED
            )
        }
    )
    result, _ = _gate(_deployed(tmp_path), attestation=attestation)

    assert result.outcome == REJECTED
    assert "deployments/1.json did not verify" in result.detail
    assert attestation.verified == ["deployments/1.json"]


def test_the_gate_verifies_before_it_reads_a_single_field(tmp_path):
    """Order, not merely presence: the bytes are unparsed until they verify.

    A generation whose `code_sha` matches the domain but whose attestation is
    refused must still fail — otherwise "verified" means "the file said the
    right thing", which is what an attacker who can write the file provides.
    """
    attestation = _Attestation(
        {
            "deployments/1.json": AttestationResult(
                ok=False, detail="wrong certificate identity", outcome=REJECTED
            )
        }
    )
    result, _ = _gate(_deployed(tmp_path), attestation=attestation)

    assert result.outcome == REJECTED
    assert "wrong certificate identity" in result.detail
    assert "code_sha" not in result.detail, (
        "the gate reported on a field it read out of a document that did not verify"
    )


def test_the_gate_pins_the_record_signer_identity(tmp_path):
    """The identity is the signer's, resolved from the subject name (R18/R25)."""
    assert resolve_identity("deployments/1.json") == P2_RECORD_SIGN_IDENTITY

    monkey = record.generation_subject_name
    try:
        record.generation_subject_name = lambda generation: f"{generation}.json"
        result, _ = _gate(_deployed(tmp_path))
    finally:
        record.generation_subject_name = monkey

    assert result.outcome == REJECTED
    assert "does not resolve to the record-signer identity" in result.detail


def test_a_generation_whose_code_sha_is_not_what_the_domain_serves_fails(tmp_path):
    result, _ = _gate(_deployed(tmp_path, code_sha="9" * 40))

    assert result.outcome == REJECTED
    assert "9999" in result.detail and CODE_SHA in result.detail
    assert "not the deployment that was signed" in result.detail


def test_the_code_sha_comparison_is_exact_and_not_a_prefix(tmp_path):
    """`SITE_CODE_SHA` is the full sha precisely so a 7-char prefix cannot pass."""
    result, _ = _gate(_deployed(tmp_path, code_sha=CODE_SHA[:7]))

    assert result.outcome == REJECTED
    assert "compared exactly, never by prefix" in result.detail


def test_a_domain_serving_no_marker_fails_rather_than_reading_as_first_run(tmp_path):
    """200 with no marker is a live site, not an absent one.

    The 404 arm returns "nothing is deployed"; this arm must not, or a page that
    merely dropped its markers would satisfy half the first-run predicate.
    """
    served = dict(_site())
    served["index.html"] = b"<!doctype html><html><head></head><body>hi</body></html>"
    result, _ = _gate(_data_repo(tmp_path), served=served)

    assert result.outcome == REJECTED
    assert MARKER_CODE_SHA in result.detail


def test_a_domain_that_redirects_the_marker_page_is_a_finding(tmp_path):
    """A 3xx on the SERVED path is a hijack — the rewrite is not a licence."""

    class _Hijack(_Origin):
        def handler(self, request):
            self.hosts.append(request.url.host)
            self.seen.append(str(request.url))
            return httpx.Response(302, headers={"location": "https://elsewhere/"})

    result, _ = _gate(_deployed(tmp_path), origin=_Hijack(_site()))

    assert result.outcome == REJECTED
    assert "hijack" in result.detail and "elsewhere" in result.detail


# --- an outage is never an accusation, on this path either -------------------


def test_a_rate_limited_domain_is_unavailable_not_rejected(tmp_path):
    class _Limited(_Origin):
        def handler(self, request):
            self.hosts.append(request.url.host)
            self.seen.append(str(request.url))
            return httpx.Response(429, content=b"slow down")

    result, _ = _gate(_deployed(tmp_path), origin=_Limited(_site()))

    assert result.outcome == UNAVAILABLE
    assert result.unavailable is True and result.outcome != REJECTED
    assert "HTTP 429" in result.detail
    assert "never evidence of tampering" in result.detail


def test_an_unreachable_domain_is_unavailable(tmp_path):
    result, _ = _gate(
        _deployed(tmp_path), origin=_Origin(_site(), raiser=httpx.ConnectError("no route"))
    )

    assert result.outcome == UNAVAILABLE
    assert "transport error" in result.detail


def test_an_unavailable_attestation_lookup_does_not_block_forever(tmp_path):
    """A quota error from the attestation API is an outage, not a refusal."""
    attestation = _Attestation(
        {
            "deployments/1.json": AttestationResult(
                ok=False, detail="HTTP 429 from the attestation API", outcome=UNAVAILABLE
            )
        }
    )
    result, _ = _gate(_deployed(tmp_path), attestation=attestation)

    assert result.outcome == UNAVAILABLE
    assert result.outcome != REJECTED


def test_a_5xx_from_the_domain_is_unavailable(tmp_path):
    class _Down(_Origin):
        def handler(self, request):
            self.hosts.append(request.url.host)
            self.seen.append(str(request.url))
            return httpx.Response(503, content=b"origin down")

    result, _ = _gate(_deployed(tmp_path), origin=_Down(_site()))
    assert result.outcome == UNAVAILABLE


# --- locating the generation -------------------------------------------------


def test_the_highest_generation_is_by_build_then_generation(tmp_path):
    """Generations restart at 1 per build, so ordering by number alone lies.

    Mutant: compare generations across builds. `20260101.1`'s generation 3 then
    outranks `20260805.1`'s generation 1 — the reverse of the truth, silently.
    """
    repo = _data_repo(tmp_path, build_id="20260101.1")
    for generation in (1, 2, 3):
        _deployed(
            tmp_path, repo=repo, build_id="20260101.1", generation=generation
        )
    _deployed(tmp_path, repo=repo, build_id="20260805.1", generation=1)

    found = highest_generation(repo)
    assert found.build_id == "20260805.1"
    assert found.generation == 1
    assert found.path == repo / "builds" / "20260805.1" / "deployments" / "1.json"


def test_the_highest_generation_orders_sequence_numerically_not_lexically(tmp_path):
    repo = _data_repo(tmp_path, build_id="20260805.2")
    _deployed(tmp_path, repo=repo, build_id="20260805.2", generation=1)
    _deployed(tmp_path, repo=repo, build_id="20260805.10", generation=1)

    assert highest_generation(repo).build_id == "20260805.10"


def test_generations_above_nine_sort_numerically(tmp_path):
    repo = _data_repo(tmp_path)
    for generation in (1, 2, 10):
        _deployed(tmp_path, repo=repo, generation=generation)

    assert highest_generation(repo).generation == 10


def test_an_empty_checkout_has_no_generation(tmp_path):
    assert highest_generation(_data_repo(tmp_path)) is None
    assert highest_generation(tmp_path / "nothing-here") is None


def test_an_unorderable_build_directory_is_refused_not_skipped(tmp_path):
    """A gate that shrugged at a directory it could not order could be disabled
    by creating one."""
    repo = _deployed(tmp_path)
    stray = repo / "builds" / "not-a-build-id" / "deployments"
    stray.mkdir(parents=True)
    (stray / "1.json").write_bytes(b"{}\n")

    result, _ = _gate(repo)
    assert result.outcome == REJECTED
    assert "not-a-build-id" in result.detail


def test_an_unnumbered_generation_file_is_refused(tmp_path):
    repo = _deployed(tmp_path)
    (repo / "builds" / BUILD_ID / "deployments" / "latest.json").write_bytes(b"{}\n")

    result, _ = _gate(repo)
    assert result.outcome == REJECTED
    assert "not a numbered generation" in result.detail


def test_the_build_id_shape_matches_the_allocator(tmp_path):
    """The gate's pattern is a copy of `publish.build`'s; pin them equal."""
    from populus.publish.build import _BUILD_ID

    assert record._BUILD_ID_PATTERN.pattern == _BUILD_ID.pattern


def test_a_generation_whose_contents_contradict_its_filename_is_refused(tmp_path):
    """Attested or not, `deployments/2.json` claiming to be generation 5 is a
    document nobody can reason about."""
    repo = _deployed(tmp_path)
    path = repo / "builds" / BUILD_ID / "deployments" / "1.json"
    path.write_bytes(
        record.render_generation(
            {"build_id": BUILD_ID, "generation": 5, "code_sha": CODE_SHA}
        )
    )

    result, _ = _gate(repo)
    assert result.outcome == REJECTED
    assert "by its name" in result.detail


def test_a_generation_recording_another_build_is_refused(tmp_path):
    repo = _deployed(tmp_path)
    path = repo / "builds" / BUILD_ID / "deployments" / "1.json"
    path.write_bytes(
        record.render_generation(
            {"build_id": "20260101.1", "generation": 1, "code_sha": CODE_SHA}
        )
    )

    result, _ = _gate(repo)
    assert result.outcome == REJECTED
    assert "records build" in result.detail


def test_a_generation_with_no_code_sha_is_refused(tmp_path):
    repo = _deployed(tmp_path)
    path = repo / "builds" / BUILD_ID / "deployments" / "1.json"
    path.write_bytes(record.render_generation({"build_id": BUILD_ID, "generation": 1}))

    result, _ = _gate(repo)
    assert result.outcome == REJECTED
    assert "carries no code_sha" in result.detail


def test_a_missing_checkout_is_misconfigured_not_a_first_run(tmp_path):
    """An absent directory is not evidence that nothing was ever deployed.

    Mutant: return `None` from `highest_generation` for a missing checkout and
    let the first-run predicate see it. A failed checkout step would then
    satisfy half the bypass on every run.
    """
    result, _ = _gate(tmp_path / "no-checkout-here", served={})

    assert result.outcome == MISCONFIGURED
    assert result.ok is False
    assert result.first_run is False
    assert "no populus-data checkout" in result.detail


# --- the gate holds no Cloudflare credential (§14) ---------------------------


def test_the_gate_makes_no_cloudflare_call(tmp_path):
    """§14 forbids the publish job a Cloudflare credential, so the gate has none.

    A gate that grew a control-plane fallback would be a gate that needs the
    credential §14 withholds — which is why this is a test and not a comment.
    """
    calls: list[tuple] = []

    class _Forbidden:
        def __init__(self, *args, **kwargs):
            calls.append((args, kwargs))

    monkeyed = record.PagesClient
    try:
        record.PagesClient = _Forbidden
        result, origin = _gate(_deployed(tmp_path))
    finally:
        record.PagesClient = monkeyed

    assert result.ok is True
    assert calls == [], "the gate constructed a Cloudflare client"
    assert set(origin.hosts) == {DOMAIN}, (
        f"the gate contacted something other than the live domain: {origin.hosts}"
    )


def test_no_gate_function_can_reach_the_cloudflare_seam():
    """The runtime check above cannot fail on a branch no fixture takes.

    So the gate's whole call graph is read out of the source instead: none of
    its functions may so much as NAME ``PagesClient`` or ``CloudflareReads``. A
    control-plane fallback added for a state the fixtures do not cover fails
    here rather than shipping.
    """
    tree = ast.parse(RECORD_SOURCE)
    functions = {
        node.name: node
        for node in ast.walk(tree)
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))
    }
    gate_graph = ["gate_publish", "_gate", "_domain_code_sha", "_gate_fetch", "_main_gate"]
    for name in gate_graph:
        assert name in functions, f"{name} no longer exists; the guard is stale"

    forbidden = {"PagesClient", "CloudflareReads", "ProductionDeployment"}
    for name in gate_graph:
        named = {
            node.id
            for node in ast.walk(functions[name])
            if isinstance(node, ast.Name)
        } | {
            node.attr
            for node in ast.walk(functions[name])
            if isinstance(node, ast.Attribute)
        }
        assert not (named & forbidden), (
            f"{name}() names {sorted(named & forbidden)} — the publish job holds "
            "no Cloudflare credential (§14), so the gate must not have a path "
            "that needs one"
        )


def test_the_gate_sends_no_credential_to_the_domain(tmp_path):
    """Unauthenticated, per R18 — and it is the public's own question."""
    seen_headers: list[dict] = []

    class _Recording(_Origin):
        def handler(self, request):
            seen_headers.append({k.lower(): v for k, v in request.headers.items()})
            return super().handler(request)

    _gate(_deployed(tmp_path), origin=_Recording(_site()))

    assert seen_headers
    for headers in seen_headers:
        assert "authorization" not in headers
        assert "cookie" not in headers
        assert headers.get("cache-control") == "no-cache"


# --- the gate CLI ------------------------------------------------------------


def _gate_argv(repo: Path, *extra: str) -> list[str]:
    return ["gate", "--data-repo", str(repo), "--domain", DOMAIN, *extra]


def _module_argv(run: str) -> list[str]:
    """A workflow `run:` body → the argv the process actually receives.

    `${{ … }}` expressions contain spaces, so a plain `.split()` shreds them
    into three tokens each and would make this test assert something no runner
    ever executes. They are collapsed to a placeholder first, then `shlex`
    handles the quoting the YAML uses.
    """
    collapsed = re.sub(r"\$\{\{[^}]*\}\}", "PLACEHOLDER", " ".join(run.split()))
    tokens = shlex.split(collapsed)
    prefix = ["uv", "run", "python", "-m", "populus.deploy.record"]
    assert tokens[: len(prefix)] == prefix, f"unexpected invocation: {tokens!r}"
    return tokens[len(prefix) :]


def test_the_gate_cli_exit_codes_are_the_signers(tmp_path):
    """0/1/2/3 — one mapping, shared, so the two entry points cannot disagree."""
    site = _site()
    verified = record.main(
        _gate_argv(_deployed(tmp_path)),
        http_factory=_Origin(site).client,
        attestation_factory=_Attestation,
    )
    assert verified == EXIT_VERIFIED

    rejected = record.main(
        _gate_argv(_deployed(tmp_path / "b", code_sha="0" * 40)),
        http_factory=_Origin(site).client,
        attestation_factory=_Attestation,
    )
    assert rejected == EXIT_REJECTED

    unavailable = record.main(
        _gate_argv(_deployed(tmp_path / "c")),
        http_factory=_Origin(site, raiser=httpx.ConnectError("no route")).client,
        attestation_factory=_Attestation,
    )
    assert unavailable == EXIT_UNAVAILABLE

    misconfigured = record.main(
        _gate_argv(tmp_path / "absent"),
        http_factory=_Origin({}).client,
        attestation_factory=_Attestation,
    )
    assert misconfigured == EXIT_MISCONFIGURED


def test_the_gate_cli_matches_what_the_publish_workflow_runs(tmp_path):
    """The exact argv from `publish.yml`, parsed here rather than assumed.

    `record.py` had no `gate` at all while `publish.yml:85` already invoked one;
    running that line verbatim produced `error: the following arguments are
    required: --artifact, --project, --workflow-run-id, --attestation` and
    exit 2. This test is that line.
    """
    invocation = _module_argv(_publish_gate_step()["run"])
    assert invocation[0] == "gate", f"publish.yml names no subcommand: {invocation!r}"
    assert "--data-repo" in invocation and "--domain" in invocation

    # Parse the workflow's own flag shape, with the fixture's values substituted.
    argv = ["gate"]
    for flag, _value in zip(invocation[1::2], invocation[2::2], strict=True):
        argv += [flag, str(_deployed(tmp_path)) if flag == "--data-repo" else DOMAIN]

    parsed = record._parse_args(argv)
    assert parsed.command == "gate"
    assert parsed.domain == DOMAIN
    assert (
        record.main(
            argv,
            http_factory=_Origin(_site()).client,
            attestation_factory=_Attestation,
        )
        == EXIT_VERIFIED
    )


def test_the_gate_defaults_to_the_real_verifier_never_the_no_op():
    """`publish.yml` passes no `--attestation`, so the default carries the trust.

    Defaulting to `staging-noop` would make the gate answer "verified" to every
    file on disk, which is the R18 failure with extra steps. The default is the
    strong provider; the no-op is still something you have to type.
    """
    parsed = record._parse_args(["gate", "--data-repo", ".", "--domain", DOMAIN])
    assert parsed.attestation == "sigstore"

    chosen = record._parse_args(
        ["gate", "--data-repo", ".", "--domain", DOMAIN, "--attestation", "staging-noop"]
    )
    assert chosen.attestation == "staging-noop"


def test_the_gate_marker_path_defaults_to_the_inventory_path():
    """`index.html` in inventory coordinates; the URL rewrite happens later."""
    parsed = record._parse_args(["gate", "--data-repo", ".", "--domain", DOMAIN])
    assert parsed.marker_path == verify_module.DEFAULT_MARKER_PATH == "index.html"


# --- the argv contract the split must not break ------------------------------


def test_a_flat_argv_still_runs_the_signer(tmp_path):
    """`record-sign.yml` passes flags and no subcommand. That keeps working.

    The two files ship at different times; a run between them would fail on
    argv, in the step that decides whether a live deployment is attested at all.
    """
    parsed = record._parse_args(_argv(tmp_path / "repo", tmp_path / "artifact"))
    assert parsed.command == "sign"
    assert parsed.artifact == str(tmp_path / "artifact")


def test_the_explicit_sign_subcommand_parses_identically(tmp_path):
    flat = record._parse_args(_argv(tmp_path / "r", tmp_path / "a"))
    explicit = record._parse_args(["sign", *_argv(tmp_path / "r", tmp_path / "a")])
    assert vars(flat) == vars(explicit)


def test_the_signer_argv_in_the_workflow_parses(tmp_path):
    """The real `record-sign.yml` command line, tokenised and parsed.

    A shape assertion over the YAML would pass while argparse rejected it; this
    runs the parser the process runs.
    """
    argv = _module_argv(_step("record")["run"])
    assert argv[0].startswith("-"), (
        f"record-sign.yml now names a subcommand ({argv[0]!r}); this test exists "
        "for the flag-only form, so it is the wrong test for that workflow"
    )
    assert argv[0] not in record.SUBCOMMANDS

    parsed = record._parse_args(argv)
    assert parsed.command == "sign", "the flat form no longer routes to the signer"
    assert parsed.attestation == "sigstore"
    assert parsed.project and parsed.domain and parsed.workflow_run_id


def test_a_bare_argv_still_demands_the_signers_required_flags(capsys):
    """No subcommand and no flags is the signer with nothing — an argparse error,
    exactly as before the split."""
    with pytest.raises(SystemExit) as raised:
        record._parse_args([])
    assert raised.value.code == 2
    assert "--data-repo" in capsys.readouterr().err


def test_top_level_help_lists_both_subcommands(capsys):
    with pytest.raises(SystemExit) as raised:
        record._parse_args(["--help"])
    assert raised.value.code == 0
    out = capsys.readouterr().out
    assert "gate" in out and "sign" in out


def test_the_subcommand_list_is_what_normalize_consults():
    """Adding a subcommand without listing it would silently route to `sign`."""
    assert record.SUBCOMMANDS == ("sign", "gate")
    assert record.DEFAULT_SUBCOMMAND == "sign"
    assert record._normalize_argv(["gate", "--domain", "x"])[0] == "gate"
    assert record._normalize_argv(["--domain", "x"])[0] == "sign"
    assert record._normalize_argv([])[0] == "sign"


# --- the workflow (R13's secrets block, R25's subject name) ------------------


def _workflow() -> dict:
    return yaml.safe_load(RECORD_SIGN_YML.read_text(encoding="utf-8"))


def _triggers(workflow: dict) -> dict:
    # YAML 1.1 parses the bare key `on` as boolean True.
    return workflow.get("on", workflow.get(True))


def _steps() -> list[dict]:
    return _workflow()["jobs"]["record"]["steps"]


def _step(fragment: str) -> dict:
    matches = [
        step for step in _steps() if fragment.lower() in str(step.get("name", "")).lower()
    ]
    assert len(matches) == 1, f"{fragment!r} matches {len(matches)} steps in record-sign.yml"
    return matches[0]


def _publish_gate_step() -> dict:
    """The publish workflow's step that invokes this module's `gate`.

    Located by what it RUNS rather than by its name: R18 requires the name not
    to contain "verify" (it would capture `_step_index` in
    `test_attestation_structure.py`), so a name-based lookup here would couple
    this file to a naming constraint that exists for an unrelated reason.
    """
    doc = yaml.safe_load(PUBLISH_YML.read_text(encoding="utf-8"))
    matches = [
        step
        for job in doc["jobs"].values()
        for step in (job.get("steps") or [])
        if "populus.deploy.record gate" in " ".join(str(step.get("run", "")).split())
    ]
    assert len(matches) == 1, (
        f"publish.yml invokes `populus.deploy.record gate` {len(matches)} times"
    )
    return matches[0]


def test_the_signer_resolves_both_secrets_from_its_own_environment():
    """RUN PUBLIC-SECURITY-HARDENING R4/LD5 — superseding the workflow_call
    declaration this test used to pin.

    Environment secrets in a reusable workflow are selected by ``environment:``
    on the CALLED job, never passed through ``workflow_call``: the record job
    names `production-record-sign`, references exactly its two secrets, and the
    trigger declares NO secrets block (a caller-passed mapping would be a
    second, wider path to the same credentials). Until the owner creates the
    environment, both references resolve empty and the job fails closed.
    """
    triggers = _triggers(_workflow())
    assert "secrets" not in (triggers["workflow_call"] or {})
    job = _workflow()["jobs"]["record"]
    assert job.get("environment") == "production-record-sign"
    rendered = yaml.safe_dump(job)
    assert "secrets.DATA_REPO_PAT" in rendered
    assert "secrets.CLOUDFLARE_PAGES_READ_TOKEN" in rendered


def test_the_workflow_keeps_its_permissions_and_its_arming_guard():
    workflow = _workflow()
    assert workflow["permissions"] == {
        "contents": "write",
        "id-token": "write",
        "attestations": "write",
    }
    assert "POPULUS_RECORD_SIGN_ARMED" in workflow["jobs"]["record"]["if"]


def test_the_workflow_holds_no_pages_write_credential():
    """§14: the signer is `Pages Read` only, and the file may not say otherwise."""
    text = RECORD_SIGN_YML.read_text(encoding="utf-8")
    assert "CLOUDFLARE_API_TOKEN" not in text
    assert "wrangler" not in text


def test_the_attest_step_names_the_subject_and_never_a_path():
    """R25 — ``subject-path`` would name the subject by basename and be refused."""
    step = _step("attest")
    assert step["uses"].startswith("actions/attest-build-provenance@")
    inputs = step["with"]
    assert "subject-path" not in inputs, (
        "subject-path names subjects by basename; resolve_identity refuses "
        "'<gen>.json' (R25)"
    )
    assert "subject-digest" in inputs
    # The name comes from the signer's own output, so YAML cannot drift from code.
    assert "subject_name" in inputs["subject-name"]
    assert "deployments/" in inputs["subject-name"] or "steps." in inputs["subject-name"]


def test_the_generation_is_attested_before_it_is_committed():
    """Ordering is the enforcement, exactly as in publish.yml."""
    names = [str(step.get("name", "")) for step in _steps()]
    attest = next(i for i, name in enumerate(names) if "attest" in name.lower())
    commit = next(i for i, name in enumerate(names) if "commit" in name.lower())
    assert attest < commit


def test_the_signer_step_runs_the_python_signer_with_its_own_token():
    step = _step("record")
    assert "populus.deploy.record" in step["run"]
    assert step["env"]["CLOUDFLARE_PAGES_READ_TOKEN"] == (
        "${{ secrets.CLOUDFLARE_PAGES_READ_TOKEN }}"
    )
    assert "--attestation" in step["run"]


def test_every_action_is_pinned_to_a_commit_sha():
    uses = re.findall(r"uses:\s*(\S+)", RECORD_SIGN_YML.read_text(encoding="utf-8"))
    assert uses, "the workflow uses no actions at all"
    for reference in uses:
        assert re.search(r"@[0-9a-f]{40}$", reference), f"{reference} is not SHA-pinned"


def test_any_node_setup_uses_the_dashboard_node_version_file():
    """There is no repo-root `.node-version`; the only one lives in dashboard/."""
    assert not (REPO_ROOT / ".node-version").exists()
    for step in _steps():
        if "setup-node" in str(step.get("uses", "")):
            assert step["with"]["node-version-file"] == "dashboard/.node-version"


def test_the_workflow_commits_only_the_generation():
    commit = _step("commit")
    assert "git pull --rebase" in commit["run"]
    assert "for attempt in 1 2 3" in commit["run"]
    assert "builds" in commit["run"]
    assert "latest.json" not in commit["run"], "the signer never moves the pointer"


@pytest.mark.parametrize(
    "fragment", ["download", "record", "attest", "commit"]
)
def test_the_workflow_has_the_step_the_protocol_requires(fragment):
    assert _step(fragment) is not None


# --- the first-run predicate must survive an UNREACHABLE domain --------------


class _DeadOrigin(_Origin):
    """A domain with nothing behind it: Cloudflare answers 522, not 404.

    This is what a Pages project with zero deployments actually serves — "no
    origin" is precisely what 522 means — so the FIRST observation of a
    never-deployed domain is outage-shaped, not clean.
    """

    def __init__(self) -> None:
        super().__init__({})

    def handler(self, request):
        self.hosts.append(request.url.host)
        return httpx.Response(522, text="")


def test_an_unreachable_domain_with_zero_generations_is_the_first_run(tmp_path):
    """Found by dispatching, not by any fixture.

    The gate required a CLEAN "no deployment" answer before evaluating the
    predicate, so on the real first run it read 522 as an outage and refused —
    unreachable in exactly the state it exists for. The run died at the gate
    before ingesting anything.
    """
    result, _ = _gate(_data_repo(tmp_path), origin=_DeadOrigin())

    assert result.ok is True and result.outcome == VERIFIED
    assert result.first_run is True
    assert "first run" in result.detail


def test_an_unreachable_domain_with_a_generation_is_still_an_outage(tmp_path):
    """The half that must NOT move.

    An unreachable domain may mean "never deployed" only while the checkout
    independently agrees nothing was ever deployed. Once a generation exists,
    R17 holds and the gate refuses to answer rather than guessing.
    """
    result, _ = _gate(_deployed(tmp_path), origin=_DeadOrigin())

    assert result.outcome == UNAVAILABLE
    assert result.first_run is False
    assert result.ok is False


# --- TD-4's clearing path: narrow, single-use, loud -------------------------


def test_the_override_clears_only_the_exact_live_sha(tmp_path):
    """Run 10 put a deployment live that could not be attested (its build_id
    marker was wrong), so the gate blocked every subsequent publish — including
    the one carrying the fix. Attesting a known-bad build or deleting an active
    production deployment were the only other exits, and both are worse.

    The acknowledgement must name the sha the domain actually serves, so it
    cannot be set once and left on.
    """
    repo = _data_repo(tmp_path)

    right, _ = _gate(repo, acknowledged_code_sha=CODE_SHA)
    assert right.ok is True
    assert "OVERRIDE" in right.detail and CODE_SHA in right.detail

    wrong, _ = _gate(repo, acknowledged_code_sha="0" * 40)
    assert wrong.outcome == REJECTED, "a stale acknowledgement cleared the gate"


def test_the_override_clears_no_other_refusal(tmp_path):
    """It is scoped to live-deployment-with-zero-generations. Every other
    refusal — an unsigned generation, a sha mismatch — must be untouched."""
    repo = _deployed(tmp_path)  # a generation EXISTS
    result, _ = _gate(repo, served={}, acknowledged_code_sha=CODE_SHA)
    assert result.outcome == REJECTED, "the override leaked into another state"


# --- R12/LD12: the signer refuses non-v2 artifacts before network/signing ----


def _strip_control(root: Path) -> None:
    """Rewrite the artifact as its pre-v2 self: no `_headers`, v1-shaped JSON."""
    import populus.publish.inventory as inventory_module
    from populus.canonical import canonical_json

    tree = root / "site"
    (tree / "_headers").unlink()
    document = {
        "dist_digest_version": "1",
        "dist_digest": inventory_module.dist_digest(tree),
        "files": [
            {
                "path": rel,
                "bytes": path.stat().st_size,
                "sha256": inventory_module.sha256_file(path),
            }
            for rel, path in inventory_module._walk_regular(tree)
        ],
    }
    (root / "inventory.json").write_bytes(canonical_json(document))


def test_a_v1_shaped_artifact_is_refused_before_any_network_or_signing(tmp_path):
    """LD12b killing test: the seam refuses BEFORE the Pages read, the sweep,
    and the attest call — a v1 envelope cannot even reach I/O."""
    artifact = _artifact(tmp_path, _site())
    _strip_control(artifact)
    harness = _run(tmp_path, artifact=artifact)

    assert harness.result.outcome == REJECTED
    assert "inventory" in harness.result.detail
    assert harness.origin.seen == [], "the sweep ran over a refused envelope"
    assert harness.pages.verbs == [], "the Pages API was read for a refused envelope"
    assert harness.attestation.attested == [], "a refused envelope was attested"
    # LD12b killing assertion. `attested` alone passed before the fix: the
    # signer verified the pointer and the manifest attestations FIRST, so a v1
    # artifact reached the attestation PROVIDER — an I/O boundary — before the
    # inventory refused it. `verified` is the collection that records those
    # calls, and it was ["latest.json", "manifest.json"] here.
    assert harness.attestation.verified == [], (
        "a v1 artifact reached the attestation provider before being refused"
    )


def test_an_artifact_whose_tree_lost_its_control_is_refused(tmp_path):
    """A tree without `_headers` cannot re-derive an exact v2 inventory."""
    artifact = _artifact(tmp_path, _site())
    (artifact / "site" / "_headers").unlink()
    harness = _run(tmp_path, artifact=artifact)

    assert harness.result.outcome == REJECTED
    assert harness.origin.seen == []
    assert harness.attestation.attested == []
    assert harness.attestation.verified == [], (
        "a control-less artifact reached the attestation provider before "
        "being refused"
    )


@pytest.mark.parametrize("forbidden", ["_redirects", "_worker.js", "functions/api.js"])
def test_an_artifact_carrying_a_prohibited_control_is_refused_before_any_io(
    tmp_path, forbidden
):
    """LD12 killing test at the SIGNER seam.

    Before the fix `build_inventory` filed `_redirects`, `_worker.js` and
    Functions artifacts under `files`, so this artifact produced a document that
    validated cleanly and the signer went on to read Cloudflare, sweep the
    origin, and attest a generation whose tree carries prohibited provider
    behaviour.
    """
    artifact = _artifact(tmp_path, _site())
    target = artifact / "site" / forbidden
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(b"/* /index.html 200\n")
    harness = _run(tmp_path, artifact=artifact)

    assert harness.result.outcome == REJECTED
    assert harness.origin.seen == []
    assert harness.pages.verbs == []
    assert harness.attestation.verified == []
    assert harness.attestation.attested == []


def test_a_domain_missing_the_control_effect_is_not_signed(tmp_path):
    """LD12b: the domain leg checks the exact header values too.

    The deployment origin serves the full header set (the sweep passes); the
    custom domain answers without HSTS. The sign must refuse and attest
    nothing.
    """
    site = _site()

    # Serve the domain WITHOUT the required headers by overriding the origin:
    class _WeakDomain(_Origin):
        def handler(self, request):
            response = super().handler(request)
            if request.url.host == DOMAIN and response.status_code == 200:
                headers = {
                    k: v
                    for k, v in response.headers.items()
                    if k.lower() != "strict-transport-security"
                }
                return httpx.Response(200, content=response.content, headers=headers)
            return response

    origin = _WeakDomain(site)
    harness = _run(tmp_path, site=site, origin=origin)

    assert harness.result.outcome == REJECTED
    assert "strict-transport-security" in harness.result.detail
    assert harness.attestation.attested == []
