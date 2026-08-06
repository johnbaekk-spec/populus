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
from datetime import datetime, timezone
from pathlib import Path

import httpx
import pytest
import yaml

from populus.deploy import record
from populus.deploy.cloudflare import PagesClient
from populus.deploy.record import (
    ACCOUNT_ID_ENV,
    EXIT_MISCONFIGURED,
    EXIT_REJECTED,
    EXIT_UNAVAILABLE,
    EXIT_VERIFIED,
    PAGES_READ_TOKEN_ENV,
    CloudflareReads,
    sign_deployment,
)
from populus.deploy.verify import MARKER_BUILD_ID, MARKER_CODE_SHA, TD10_NOTE
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
    """The served tree, per host: the deployment origin and the custom domain."""

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
        path = request.url.path.lstrip("/")
        if path in table:
            return httpx.Response(200, content=table[path])
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
        "inventory_digest": hashlib.sha256(shipped).hexdigest(),
        "verification_scope": "expected_paths",
        "files_verified": 5,
        "files_total": 5,
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
    """R27 structurally: the seam cannot grow a write verb unnoticed."""
    public = {
        name
        for name in vars(CloudflareReads)
        if not name.startswith("_") and callable(getattr(CloudflareReads, name))
    }
    assert public == set(CloudflareReads.READ_SURFACE)


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
        return SLSA_PREDICATE_TYPE, self._payload


def _statement(name: str, document: bytes) -> bytes:
    """The in-toto statement `attest-build-provenance` produces for one subject."""
    return json.dumps(
        {
            "_type": "https://in-toto.io/Statement/v1",
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


def test_the_reusable_workflow_declares_both_secrets():
    """R13 — a called workflow inherits nothing; undeclared secrets are empty.

    The file already referenced ``CLOUDFLARE_PAGES_READ_TOKEN`` while declaring
    no ``secrets:`` block at all, which resolves to the empty string at run time
    and would have failed as a missing credential — closed, but for the wrong
    reason and one deploy later than necessary.
    """
    secrets = _triggers(_workflow())["workflow_call"]["secrets"]
    assert set(secrets) == {"DATA_REPO_PAT", "CLOUDFLARE_PAGES_READ_TOKEN"}
    for name, spec in secrets.items():
        assert spec["required"] is True, f"{name} is declared optional"


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
