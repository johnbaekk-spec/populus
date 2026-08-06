"""R9/R10/R16: the PRODUCTION uploader and verifier, and the sequence through them.

``tests/test_deploy_orchestrator.py`` proves the *order*. It does so against
fakes, which is correct for an ordering test and was, until this file existed,
the only thing proving anything about the seams at all — there was no
``Uploader`` and no ``Verifier`` implementation in the repository, so every
ordering guarantee was a statement about ``FakeUploader`` and ``FakeVerifier``.
Worse, the ``Verifier`` Protocol had drifted to a shape
:func:`populus.deploy.verify.verify_deployment` cannot satisfy: it requires a
``stage`` keyword the real function does not accept, and nothing failed.

So this file does two things the ordering file cannot:

* it pins the production objects **against the Protocols**, by signature, so the
  same drift fails a test instead of passing one, and
* it runs :func:`~populus.deploy.orchestrator.run_deployment` end to end through
  the real :class:`~populus.deploy.upload.WranglerUploader`, the real
  :class:`~populus.deploy.upload.DeploymentVerifier`, the real
  :class:`~populus.deploy.upload.PagesDeploySurface` and the real
  :class:`~populus.deploy.cloudflare.PagesClient` — over an injected command
  runner and an injected transport, so nothing is spawned and nothing is
  connected (``tests/conftest.py`` blocks the network outright).

The two injected fakes model the boundary honestly. ``FakeWrangler`` does what
wrangler does: it reads the directory it is handed and makes those bytes
retrievable at a URL it prints. ``ServedTree`` then serves exactly those bytes.
Nothing in the chain is told what the answer should be, which is why a tampered
tree produces a real divergence here rather than a stubbed verdict.
"""

from __future__ import annotations

import inspect
import json
from collections.abc import Mapping
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import httpx
import pytest

from populus.deploy.cloudflare import API_HOST, PagesClient, PagesRejected
from populus.deploy.orchestrator import (
    PREVIEW,
    PRODUCTION,
    DeployAborted,
    PreviewVerificationFailed,
    ProductionVerificationFailed,
    Uploader,
    UploadedDeployment,
    Verifier,
    run_deployment,
)
from populus.deploy.upload import (
    DEFAULT_WRANGLER_PACKAGE,
    DeploymentVerifier,
    PagesDeploySurface,
    UploadFailed,
    WranglerUploader,
    _run_argv,
)
from populus.deploy.verify import (
    ALLOWED_RESPONSE_HEADERS,
    served_path,
    verify_deployment,
)
from populus.publish.inventory import build_inventory

ACCOUNT = "acct-1"
PROJECT = "populus-site"
TOKEN = "tok-1"
DOMAIN = "publicfilings.org"
DOMAIN_URL = "https://publicfilings.org"
BRANCH = "main"
PREVIEW_BRANCH = "populus-preview"
PRIOR = "dep-prior"
PRIOR_URL = "https://dep-prior.populus-site.pages.dev"

BUILD_ID = "20260805.1"
CODE_SHA = "a" * 40
STATS = b'{"stats_version":"stats-1.0.0"}\n'

SITE = {
    "index.html": (
        b'<!doctype html><meta name="populus:build_id" content="' + BUILD_ID.encode() + b'">'
        b'<meta name="populus:code_sha" content="' + CODE_SHA.encode() + b'">'
    ),
    "assets/app.js": b"console.log(1)\n",
    "assets/app.css": b"body{}\n",
    "stats.json": STATS,
}


# --- the served side ---------------------------------------------------------


@dataclass(frozen=True)
class _Response:
    """The three fields ``populus.deploy.verify`` reads off a response."""

    status_code: int
    content: bytes
    headers: Mapping[str, str]


class ServedTree:
    """Serves the exact bytes an upload published, at the URL it published to.

    Not a stub of the verdict: the verifier fetches, hashes and compares real
    bytes, so a tampered tree diverges here for the reason it would in
    production. Unknown paths 404, which is what makes the control-path probes
    and the never-published probe meaningful rather than decorative.
    """

    def __init__(self) -> None:
        self.trees: dict[str, dict[str, bytes]] = {}
        self.requests: list[str] = []

    def publish(self, base_url: str, tree: Path) -> None:
        """Register the tree at the coordinates Pages actually answers on.

        Keyed through :func:`~populus.deploy.verify.served_path` rather than by
        the inventory path, because the provider does not serve
        ``index.html`` at ``/index.html``. Importing the rule instead of
        re-spelling it means this fake cannot drift from the one the verifier
        applies — a fake that served both spellings would hide a real defect.
        """
        self.trees[base_url.rstrip("/")] = {
            served_path(path.relative_to(tree).as_posix()): path.read_bytes()
            for path in sorted(tree.rglob("*"))
            if path.is_file()
        }

    def get(
        self, url: str, *, headers: Mapping[str, str], follow_redirects: bool
    ) -> _Response:
        assert follow_redirects is False, "redirects must stay disabled"
        self.requests.append(url)
        target = url.split("?", 1)[0]
        for base, files in self.trees.items():
            prefix = f"{base}/"
            if target.startswith(prefix):
                relpath = target[len(prefix) :]
                if relpath in files:
                    body = files[relpath]
                    return _Response(200, body, {"content-type": "text/html", "etag": "e"})
                return _Response(404, b"not found", {"content-type": "text/plain"})
        return _Response(404, b"no such origin", {"content-type": "text/plain"})


# --- the provider side -------------------------------------------------------


@dataclass
class FakePagesApi:
    """Cloudflare's state, as the pinned endpoints would report it.

    ``deployments`` holds RAW provider objects, newest first, because that is
    what the real endpoint returns and because the whole ``uses_functions``
    question is about which keys are present in them.
    """

    production_branch: str = BRANCH
    domain_status: str = "active"
    deployments: list[dict] = field(default_factory=list)
    rollback_payload: dict | None = None
    on_rollback: Any = None
    requests: list[tuple[str, str]] = field(default_factory=list)
    counter: int = 0

    def publish(self, environment: str, *, uses_functions: Any = False) -> dict:
        self.counter += 1
        identifier = f"dep-{environment}-{self.counter}"
        entry = {
            "id": identifier,
            "environment": environment,
            "url": f"https://{identifier}.{PROJECT}.pages.dev",
        }
        if uses_functions is not OMIT:
            entry["uses_functions"] = uses_functions
        self.deployments.insert(0, entry)
        return entry

    def handler(self, request: httpx.Request) -> httpx.Response:
        path = request.url.path
        self.requests.append((request.method, path))
        if path.endswith("/domains"):
            return _envelope([{"name": DOMAIN, "status": self.domain_status}])
        if path.endswith("/rollback"):
            payload = self.rollback_payload
            if payload is None:  # pragma: no cover - guards the fixture itself
                raise AssertionError("no rollback payload configured")
            if self.on_rollback is not None:
                self.on_rollback()
            return _envelope(payload)
        if path.endswith("/deployments"):
            environment = request.url.params.get("env")
            if environment is None:
                return _envelope(list(self.deployments))
            return _envelope(
                [e for e in self.deployments if e.get("environment") == environment]
            )
        return _envelope({"production_branch": self.production_branch})


OMIT = object()


def _envelope(result: Any) -> httpx.Response:
    return httpx.Response(200, json={"success": True, "errors": [], "result": result})


class FakeWrangler:
    """The injected command transport, doing what ``wrangler pages deploy`` does.

    It reads the directory it was handed, makes those bytes retrievable at a
    fresh URL, registers the deployment with the provider fake, and prints the
    URL in the shape wrangler prints it. It reports **only** a URL — no
    deployment id — because that is the real constraint the uploader is built
    around.
    """

    def __init__(
        self,
        api: FakePagesApi,
        served: ServedTree,
        *,
        exit_code: int = 0,
        stdout: str | None = None,
        stderr: str = "",
        uses_functions: Any = False,
        environment_for: dict[str, str] | None = None,
        serve_domain: bool = True,
        tamper_domain: bool = False,
    ) -> None:
        self.api = api
        self.served = served
        self.exit_code = exit_code
        self.stdout = stdout
        self.stderr = stderr
        self.uses_functions = uses_functions
        self.environment_for = environment_for or {
            PREVIEW_BRANCH: PREVIEW,
            BRANCH: PRODUCTION,
        }
        self.serve_domain = serve_domain
        self.tamper_domain = tamper_domain
        self.calls: list[list[str]] = []

    def __call__(self, argv):
        argv = list(argv)
        self.calls.append(argv)
        if self.exit_code != 0:
            return (self.exit_code, self.stdout or "", self.stderr)
        if self.stdout is not None:
            return (0, self.stdout, self.stderr)

        directory = Path(argv[argv.index("deploy") + 1])
        branch = next(a.split("=", 1)[1] for a in argv if a.startswith("--branch="))
        environment = self.environment_for[branch]
        entry = self.api.publish(environment, uses_functions=self.uses_functions)
        self.served.publish(entry["url"], directory)
        if environment == PRODUCTION and self.serve_domain:
            self.served.publish(DOMAIN_URL, directory)
            if self.tamper_domain:
                # The custom domain answers with bytes that are not the ones
                # that were uploaded — the situation R11 exists to catch, and
                # the only way to reach the rollback path with the deployment
                # itself intact.
                self.served.trees[DOMAIN_URL]["assets/app.js"] = b"defaced\n"

        return (
            0,
            "🌎 Uploading... (4/4)\n"
            f"✨ Deployment complete! Take a peek over at {entry['url']}\n",
            "",
        )


@dataclass
class Rig:
    """The whole real chain, with exactly two things injected: argv and transport."""

    api: FakePagesApi
    served: ServedTree
    wrangler: FakeWrangler
    surface: PagesDeploySurface
    upload: WranglerUploader
    verify: DeploymentVerifier
    source: Path

    def run(self, **overrides: Any):
        kwargs: dict[str, Any] = dict(
            client=self.surface,
            source=self.source,
            production_branch=BRANCH,
            custom_domain=DOMAIN,
            upload=self.upload,
            verify=self.verify,
        )
        kwargs.update(overrides)
        return run_deployment(**kwargs)


@pytest.fixture
def rig(tmp_path: Path) -> Rig:
    source = tmp_path / "site"
    for relpath, payload in SITE.items():
        target = source / relpath
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(payload)

    api = FakePagesApi(
        deployments=[
            {
                "id": PRIOR,
                "environment": "production",
                "url": PRIOR_URL,
                "uses_functions": False,
            }
        ]
    )
    served = ServedTree()
    wrangler = FakeWrangler(api, served)
    surface = PagesDeploySurface(
        PagesClient(
            ACCOUNT, PROJECT, TOKEN, transport=httpx.MockTransport(api.handler)
        )
    )
    return Rig(
        api=api,
        served=served,
        wrangler=wrangler,
        surface=surface,
        upload=WranglerUploader(project=PROJECT, lookup=surface, runner=wrangler),
        verify=DeploymentVerifier(
            client=served, build_id=BUILD_ID, code_sha=CODE_SHA, stats_bytes=STATS
        ),
        source=source,
    )


# --- the Protocols are satisfied by the production objects -------------------


def _call_shape(func) -> list[tuple[str, Any]]:
    """Parameter names and kinds, ``self`` dropped. Names matter: they are keywords."""
    return [
        (name, parameter.kind)
        for name, parameter in inspect.signature(func).parameters.items()
        if name != "self"
    ]


def test_the_production_uploader_satisfies_the_uploader_protocol() -> None:
    """Same parameter names, same kinds — a drift in either fails here.

    ``run_deployment`` calls this with ``environment=`` and ``branch=`` as
    keywords, so a rename is a runtime ``TypeError`` in production and nothing
    else would notice: no test called the real object.
    """
    assert _call_shape(WranglerUploader.__call__) == _call_shape(Uploader.__call__)
    assert [name for name, _ in _call_shape(Uploader.__call__)] == [
        "path",
        "environment",
        "branch",
    ]


def test_the_production_verifier_satisfies_the_verifier_protocol() -> None:
    """Including ``stage``, which is the keyword that had already drifted."""
    assert _call_shape(DeploymentVerifier.__call__) == _call_shape(Verifier.__call__)
    assert "stage" in inspect.signature(DeploymentVerifier.__call__).parameters


def test_verify_deployment_alone_cannot_satisfy_the_verifier_protocol() -> None:
    """The reason the adapter exists, pinned so it cannot be forgotten again.

    ``verify_deployment`` takes no ``stage``, so the Protocol the ordering tests
    describe was unsatisfiable by the only real verification routine in the
    repository. Deleting :class:`DeploymentVerifier` and passing the function
    straight in is the mutant; it fails here.
    """
    assert "stage" not in inspect.signature(verify_deployment).parameters
    with pytest.raises(TypeError):
        verify_deployment(
            object(), "https://example.invalid", stage=PREVIEW, inventory={}, deployment={}
        )


def test_an_unknown_verification_stage_is_refused(rig: Rig) -> None:
    """``stage`` is validated, not ignored: a third stage is a bug, not a label."""
    with pytest.raises(ValueError, match="unknown verification stage"):
        rig.verify("https://example.invalid", stage="staging", inventory={}, deployment={})


# --- the command ------------------------------------------------------------


def test_the_wrangler_command_is_a_pinned_argv_list(rig: Rig, tmp_path: Path) -> None:
    """Argv, never a shell, and a pinned package rather than "whatever npm serves".

    The credentials are deliberately absent: wrangler reads
    ``CLOUDFLARE_API_TOKEN``/``CLOUDFLARE_ACCOUNT_ID`` from the step-scoped
    environment, so no token is ever placed on a command line (where it would be
    visible to every other process on the runner).
    """
    sealed = tmp_path / "sealed"

    argv = rig.upload.command(sealed, branch=PREVIEW_BRANCH)

    assert argv == [
        "npx",
        "--yes",
        DEFAULT_WRANGLER_PACKAGE,
        "pages",
        "deploy",
        str(sealed),
        f"--project-name={PROJECT}",
        f"--branch={PREVIEW_BRANCH}",
        "--commit-dirty=true",
    ]
    assert "@" in DEFAULT_WRANGLER_PACKAGE, "an unpinned spec is not a pin"
    assert TOKEN not in " ".join(argv)
    assert not any(";" in part or "&&" in part for part in argv)


def test_the_default_command_runner_is_the_real_one_and_is_never_used_here() -> None:
    """The seam is injectable, and the suite injects: nothing is spawned.

    Without the default the production path would have no transport at all;
    without the injection this file would spawn ``npx`` on every run.
    """
    assert WranglerUploader(project=PROJECT, lookup=None).runner is _run_argv
    assert WranglerUploader(project=PROJECT, lookup=None, runner=len).runner is len


def test_a_failing_wrangler_is_an_upload_failure(rig: Rig, tmp_path: Path) -> None:
    rig.wrangler.exit_code = 1
    rig.wrangler.stderr = "✘ [ERROR] Authentication error [code: 10000]"

    with pytest.raises(UploadFailed, match="exited 1"):
        rig.upload(tmp_path, environment=PREVIEW, branch=PREVIEW_BRANCH)

    assert "Authentication error" in str(
        pytest.raises(
            UploadFailed, rig.upload, tmp_path, environment=PREVIEW, branch=PREVIEW_BRANCH
        ).value
    )


def test_wrangler_printing_no_url_is_an_upload_failure(rig: Rig, tmp_path: Path) -> None:
    """"It said success" is not evidence of which deployment it created."""
    rig.wrangler.stdout = "✨ Success! Uploaded 0 files (4 already uploaded)\n"

    with pytest.raises(UploadFailed, match="no \\*.pages.dev URL"):
        rig.upload(tmp_path, environment=PREVIEW, branch=PREVIEW_BRANCH)


def test_a_deployment_that_is_not_the_one_wrangler_made_is_refused(
    rig: Rig, tmp_path: Path
) -> None:
    """A concurrent deploy voids every guarantee downstream, so the run stops.

    "Production was never touched" and "the same bytes" would otherwise be
    claims about a tree this run did not publish.
    """
    rig.wrangler.stdout = (
        f"✨ Deployment complete! Take a peek over at https://someone-else.{PROJECT}.pages.dev\n"
    )
    rig.api.publish(PREVIEW)

    with pytest.raises(UploadFailed, match="Another deployment landed"):
        rig.upload(tmp_path, environment=PREVIEW, branch=PREVIEW_BRANCH)


def test_the_upload_result_carries_the_raw_provider_payload(
    rig: Rig, tmp_path: Path
) -> None:
    """R16: a provider that omits ``uses_functions`` must arrive omitting it.

    The uploader hands the verifier the provider's own object. A reconstruction
    — even one that copies four fields faithfully — would give the key a value
    and make ``check_no_functions``'s fail-closed branch unreachable.
    """
    rig.wrangler.uses_functions = OMIT

    uploaded = rig.upload(tmp_path, environment=PREVIEW, branch=PREVIEW_BRANCH)

    assert "uses_functions" not in uploaded.payload
    assert dict(uploaded.payload) == rig.api.deployments[0]
    assert isinstance(uploaded, UploadedDeployment)


def test_the_reported_environment_comes_from_the_provider(
    rig: Rig, tmp_path: Path
) -> None:
    """Not from the request. The ordering guarantee is about where bytes landed.

    ``run_deployment`` refuses an upload whose reported environment is not the
    one it asked for; that check was previously compared against the fake's own
    echo of the argument, which could never disagree. Here the value is
    Cloudflare's answer, so a branch that maps to the wrong environment is
    actually detectable.
    """
    rig.wrangler.environment_for = {PREVIEW_BRANCH: PRODUCTION, BRANCH: PRODUCTION}

    uploaded = rig.upload(tmp_path, environment=PRODUCTION, branch=PREVIEW_BRANCH)

    assert uploaded.environment == PRODUCTION


# --- the Pages surface ------------------------------------------------------


def test_the_rollback_returns_the_raw_provider_object(rig: Rig) -> None:
    """The deploy-side twin of the signer's fail-closed rule.

    ``PagesClient.rollback`` answers with a typed ``Deployment`` whose
    ``uses_functions`` is ``bool(entry.get(...))`` — a missing signal becomes a
    confident ``False``. ``rollback_payload`` returns what Cloudflare sent.
    """
    rig.api.rollback_payload = {"id": PRIOR, "environment": "production", "url": PRIOR_URL}

    payload = rig.surface.rollback_payload(PRIOR)

    assert payload == {"id": PRIOR, "environment": "production", "url": PRIOR_URL}
    assert "uses_functions" not in payload
    assert ("POST", f"/client/v4/accounts/{ACCOUNT}/pages/projects/{PROJECT}"
            f"/deployments/{PRIOR}/rollback") in rig.api.requests


def test_the_surface_is_exactly_five_calls_and_none_of_them_removes_anything(
    rig: Rig,
) -> None:
    """Cloudflare declines to remove an active production deployment (TD-4).

    A method for it would be a compensation the provider refuses, so there is
    none here, none on ``PagesClient``, and the verb is not even permitted.
    """
    public = sorted(
        name for name in dir(rig.surface) if not name.startswith("_") and name != "SURFACE"
    )

    assert public == sorted(PagesDeploySurface.SURFACE)
    assert [name for name in public if "delete" in name or "remove" in name] == []


def test_an_empty_rollback_id_is_refused(rig: Rig) -> None:
    with pytest.raises(PagesRejected, match="requires a deployment id"):
        rig.surface.rollback_payload("")


def test_raw_deployments_reads_the_pinned_endpoint(rig: Rig) -> None:
    entries = rig.surface.raw_deployments("production")

    assert entries == [
        {"id": PRIOR, "environment": "production", "url": PRIOR_URL, "uses_functions": False}
    ]
    assert rig.surface.raw_deployments() == entries
    assert ("GET", f"/client/v4/accounts/{ACCOUNT}/pages/projects/{PROJECT}/deployments") in (
        rig.api.requests
    )
    assert API_HOST == "https://api.cloudflare.com"


# --- the whole sequence, through the real objects ----------------------------


def test_the_sequence_runs_green_through_the_production_objects(rig: Rig) -> None:
    """The ordering tests stop being statements about fakes.

    Real uploader, real verifier, real Pages surface, real client — and a real
    inventory-wide sweep over the bytes that were actually published. Nothing is
    spawned and nothing is connected.
    """
    outcome = rig.run()

    assert rig.wrangler.calls[0][:5] == ["npx", "--yes", DEFAULT_WRANGLER_PACKAGE, "pages", "deploy"]
    assert outcome.preview.environment == PREVIEW
    assert outcome.production.environment == PRODUCTION
    assert outcome.preview_verification.ok and outcome.production_verification.ok
    assert outcome.production_verification.files_verified == len(SITE)
    assert outcome.rollback_target == PRIOR
    assert outcome.dist_digest
    # The sweep really fetched every inventoried path on both legs, plus the
    # control probes — a marker-only check would show a handful of requests.
    assert len(rig.served.requests) >= 2 * (len(SITE) + len(("_redirects", "_headers", "_worker.js")) + 1)


def test_a_tampered_tree_fails_the_preview_sweep_for_real(rig: Rig) -> None:
    """No stubbed verdict: the served bytes are hashed and disagree.

    The custom domain is still served normally, so this cannot pass merely
    because the domain had nothing on it — the failure is the preview sweep, and
    production is never uploaded.
    """
    original = FakeWrangler.__call__

    def tamper(self, argv):
        result = original(self, argv)
        for tree in self.served.trees.values():
            tree["assets/app.js"] = b"console.log('tampered')\n"
        return result

    rig.wrangler.__class__.__call__ = tamper
    try:
        with pytest.raises(PreviewVerificationFailed, match="Production was not touched"):
            rig.run()
    finally:
        rig.wrangler.__class__.__call__ = original

    assert len(rig.wrangler.calls) == 1


def _findings_for(rig: Rig, payload: Mapping[str, Any]) -> tuple[str, ...]:
    """Re-run the real verifier against what is still published, for the reasons.

    ``PreviewVerificationFailed`` carries a *count* of findings, not their text,
    so a ``pytest.raises(..., match=...)`` on the message would pass for any
    failure at all — including one caused by the fixture. The bytes and the
    provider payload both outlive the run, so the verdict is re-derived here and
    the assertion is about which finding fired.
    """
    return rig.verify(
        payload["url"],
        stage=PREVIEW,
        inventory=build_inventory(rig.source),
        deployment=payload,
    ).findings


def test_a_functions_deployment_is_refused_by_the_real_verifier(rig: Rig) -> None:
    """R16 through the production chain: the provider says it runs a Worker."""
    rig.wrangler.uses_functions = True

    with pytest.raises(PreviewVerificationFailed, match="Production was not touched"):
        rig.run()

    assert len(rig.wrangler.calls) == 1
    findings = _findings_for(rig, rig.api.deployments[0])
    assert [f for f in findings if "uses_functions=True" in f]


def test_a_provider_omitting_uses_functions_fails_closed_end_to_end(rig: Rig) -> None:
    """Absence is refused by the real objects, not only in a unit check.

    Mutant: rebuild the payload anywhere between the provider and
    ``check_no_functions`` — in the uploader, or in the orchestrator's rollback
    path — and the key reappears as ``False``, the check passes, and this test
    is the one that stops passing.
    """
    rig.wrangler.uses_functions = OMIT

    with pytest.raises(PreviewVerificationFailed, match="Production was not touched"):
        rig.run()

    published = rig.api.deployments[0]
    assert "uses_functions" not in published
    assert [f for f in _findings_for(rig, published) if "fails closed" in f]


def test_a_green_run_is_green_for_the_right_reason(rig: Rig) -> None:
    """The control for the two tests above: with the field present, zero findings.

    Without it, "the sweep produced a finding" would be indistinguishable from
    "this fixture can never verify anything".
    """
    rig.run()

    preview = [e for e in rig.api.deployments if e["environment"] == PREVIEW][0]
    assert preview["uses_functions"] is False
    assert _findings_for(rig, preview) == ()


# The rollback pair below differs in ONE key and nothing else: same bytes, same
# tampering, same restore. That is what makes it a test of the raw payload
# rather than of the fixture — a reconstruction flips the first verdict to
# match the second.


def _rollback_rig(rig: Rig, payload: dict) -> None:
    """Domain serves defaced bytes; the rollback restores the built ones."""
    rig.wrangler.tamper_domain = True
    rig.api.on_rollback = lambda: rig.served.publish(DOMAIN_URL, rig.source)
    rig.api.rollback_payload = payload


def test_the_rollback_reverification_fails_closed_on_the_raw_payload(rig: Rig) -> None:
    """The exact path defect 3 lived on, exercised through the real chain.

    The custom domain serves bytes that are not the ones uploaded, so R11 fails
    and the sequence rolls back. The rollback restores correct bytes, so the
    **only** thing that can make the re-verification fail is the provider's
    payload carrying no ``uses_functions``. It must.

    The orchestrator used to rebuild that mapping from the typed ``Deployment``
    — ``uses_functions`` computed as ``bool(entry.get(...))`` — so the key was
    always present and ``check_no_functions``'s fail-closed branch was
    unreachable on this path no matter what Cloudflare answered.
    """
    _rollback_rig(rig, {"id": PRIOR, "environment": "production", "url": PRIOR_URL})

    with pytest.raises(ProductionVerificationFailed) as raised:
        rig.run()

    assert raised.value.rolled_back_to == PRIOR
    assert raised.value.rollback_verified is False
    assert "did NOT verify" in str(raised.value)
    assert ("POST", f"/client/v4/accounts/{ACCOUNT}/pages/projects/{PROJECT}"
            f"/deployments/{PRIOR}/rollback") in rig.api.requests


def test_the_same_rollback_carrying_the_field_re_verifies(rig: Rig) -> None:
    """One key different, opposite verdict — which is what makes the pair sharp.

    If anything between the provider and the check invented the field, this
    outcome and the one above would be identical and neither test would be
    about the payload.
    """
    _rollback_rig(
        rig,
        {
            "id": PRIOR,
            "environment": "production",
            "url": PRIOR_URL,
            "uses_functions": False,
        },
    )

    with pytest.raises(ProductionVerificationFailed) as raised:
        rig.run()

    assert raised.value.rolled_back_to == PRIOR
    assert raised.value.rollback_verified is True
    assert "the restored deployment verified" in str(raised.value)


def test_an_inactive_domain_stops_the_real_chain_before_wrangler_runs(rig: Rig) -> None:
    """R11 precedes every upload, and here "no upload" means no process at all."""
    rig.api.domain_status = "initializing"

    with pytest.raises(PagesRejected, match="not 'active'"):
        rig.run()

    assert rig.wrangler.calls == []


def test_nothing_in_this_file_reaches_the_network(rig: Rig) -> None:
    """The two seams are the only way out, and both are injected.

    ``tests/conftest.py`` blocks connections outright, so a real client would
    fail the suite loudly; this pins the *intent* alongside that guard.
    """
    rig.run()

    assert rig.upload.runner is rig.wrangler
    assert rig.verify.client is rig.served
    assert all(url.startswith("https://") for url in rig.served.requests)
    assert {method for method, _ in rig.api.requests} <= {"GET", "POST"}


def test_the_response_headers_the_fake_serves_are_ones_a_static_asset_may_carry() -> None:
    """Keeps the green path honest: a header outside the allowlist is a finding.

    If the fake served something disallowed, every sweep above would fail for a
    reason that has nothing to do with what is being tested.
    """
    assert {"content-type", "etag"} <= ALLOWED_RESPONSE_HEADERS


def test_the_uploaded_payload_round_trips_as_the_provider_sent_it(rig: Rig) -> None:
    """No normalisation, no key ordering, no dropped fields."""
    rig.api.deployments = []
    rig.wrangler.uses_functions = False
    uploaded = rig.upload(rig.source, environment=PREVIEW, branch=PREVIEW_BRANCH)

    assert json.loads(json.dumps(dict(uploaded.payload))) == rig.api.deployments[0]


def test_an_upload_the_provider_never_recorded_is_refused(rig: Rig) -> None:
    """wrangler said it deployed; the API lists nothing. That is not a success."""
    rig.api.deployments = []
    rig.wrangler.stdout = f"✨ Deployment complete! Take a peek over at https://x.{PROJECT}.pages.dev\n"

    with pytest.raises(UploadFailed, match="lists no deployment"):
        rig.upload(rig.source, environment=PREVIEW, branch=PREVIEW_BRANCH)


def test_the_orchestrator_aborts_when_the_environment_disagrees(rig: Rig) -> None:
    """The guard that only became real once the environment came from the provider."""
    rig.wrangler.environment_for = {PREVIEW_BRANCH: PRODUCTION, BRANCH: PRODUCTION}

    with pytest.raises(DeployAborted, match="asked for a 'preview' deployment"):
        rig.run()

    assert len(rig.wrangler.calls) == 1
