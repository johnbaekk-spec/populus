"""R8/R11/R16/R17: the Cloudflare Pages surface answers, or says it could not.

Four properties carry the weight here, and each one exists because a plausible
implementation gets it wrong:

* **R8** — the workflow-locked branch is compared against the project's
  ``production_branch`` *before* anything is uploaded, and a mismatch names both
  branches so the operator does not have to guess which end is wrong.
* **R11** — domain status comes from the ``…/domains`` subresource and from
  nowhere else. The project endpoint carries a ``domains`` array of bare strings
  with no status; a client that read membership in that array would report a
  still-``initializing`` domain as live. Two tests pin this: one asserts the
  project endpoint is never *requested* on the status path, the other serves a
  project payload that lists the domain while the subresource says
  ``initializing`` and requires the check to fail anyway.
* **R17** — 429, 5xx and transport failures are ``unavailable``, not a negative
  answer. A rate-limited API must never read as "the domain is inactive" or as
  tampering. The 4xx and ``success: false`` tests are what stop that from being
  vacuous: if everything were unavailable the distinction would be free.
* **No DELETE.** Cloudflare refuses to delete an active production deployment,
  so the plan deliberately does not call it. Two tests pin the absence — a
  behavioural sweep that drives every public method through a recording
  transport, and a source scan — because a method that is never exercised would
  slip past the sweep alone.

Every test runs on ``httpx.MockTransport``; ``tests/conftest.py`` blocks sockets,
so the module importing and a client constructing at all is itself evidence that
neither opens a connection.
"""

from __future__ import annotations

import copy
import inspect
import json
import re
from pathlib import Path
from typing import Any

import httpx
import pytest

from populus.deploy import cloudflare
from populus.deploy.cloudflare import (
    ACTIVE_DOMAIN_STATUS,
    DOMAIN_STATUSES,
    PagesClient,
    PagesError,
    PagesRejected,
    PagesUnavailable,
)
from populus.publish.attestation import REJECTED, UNAVAILABLE

ACCOUNT = "d7b5e4995e76a76c9899695b54c61226"
PROJECT = "publicfilings"
TOKEN = "cf-pages-read-token"
DOMAIN = "publicfilings.org"
DEPLOYMENT_ID = "6d2f8b41-93ce-4c07-a5e1-70b8d4c9f215"

# The pinned paths, written out here independently of the source. A test that
# imported the client's own path builders would agree with any mutation of them.
PROJECT_PATH = f"/client/v4/accounts/{ACCOUNT}/pages/projects/{PROJECT}"
DOMAINS_PATH = f"{PROJECT_PATH}/domains"
DEPLOYMENTS_PATH = f"{PROJECT_PATH}/deployments"
ROLLBACK_PATH = f"{DEPLOYMENTS_PATH}/{DEPLOYMENT_ID}/rollback"

FIXTURES = Path(__file__).parent / "fixtures" / "deploy"

#: What Cloudflare actually sends alongside a 429 or a 5xx — a full envelope
#: with ``success: false``. Serving it is what makes the "status before body"
#: ordering in ``_unwrap`` observable: an implementation that inspected the
#: envelope first would call these rejections.
_RATE_LIMITED = {
    "success": False,
    "errors": [{"code": 971, "message": "More than 1200 requests per five minutes"}],
    "messages": [],
    "result": None,
}
_SERVER_ERROR = {
    "success": False,
    "errors": [{"code": 10000, "message": "Internal server error"}],
    "messages": [],
    "result": None,
}
_FORBIDDEN = {
    "success": False,
    "errors": [{"code": 10000, "message": "Authentication error"}],
    "messages": [],
    "result": None,
}


def _fixture(name: str) -> dict:
    return json.loads((FIXTURES / name).read_text(encoding="utf-8"))


def _respond(spec: Any, path: str) -> httpx.Response:
    """Turn a route spec into a response, or fail the test.

    ``None`` means *this endpoint must not be requested* — which is how the R11
    "never consulted" test is expressed: the project route is left unset and the
    handler raises if the client reaches for it.
    """
    if spec is None:
        raise AssertionError(f"the client requested {path}, which this test forbids")
    if isinstance(spec, httpx.Response):
        return spec
    if isinstance(spec, tuple):
        status, body = spec
        return httpx.Response(status, json=body)
    return httpx.Response(200, json=spec)


def _transport(
    seen: list[tuple[str, str, dict]],
    *,
    project: Any = None,
    domains: Any = None,
    deployments: Any = None,
    rollback: Any = None,
) -> httpx.MockTransport:
    """A recording MockTransport routed by the four pinned paths."""

    def handler(request: httpx.Request) -> httpx.Response:
        path = request.url.path
        seen.append((request.method, path, dict(request.url.params)))
        if path.endswith("/rollback"):
            return _respond(rollback, path)
        if path == DOMAINS_PATH:
            return _respond(domains, path)
        if path == DEPLOYMENTS_PATH:
            return _respond(deployments, path)
        if path == PROJECT_PATH:
            return _respond(project, path)
        raise AssertionError(f"unexpected path {path!r}")

    return httpx.MockTransport(handler)


def _client(transport: httpx.BaseTransport) -> PagesClient:
    return PagesClient(ACCOUNT, PROJECT, TOKEN, transport=transport)


def _paths(seen: list[tuple[str, str, dict]]) -> list[str]:
    return [path for _, path, _ in seen]


def _methods(seen: list[tuple[str, str, dict]]) -> list[str]:
    return [method for method, _, _ in seen]


def _domains_with_status(status: str) -> dict:
    """The recorded domains envelope, re-stated at a different status.

    Derived from the fixture rather than hand-written so a negative case cannot
    drift into a shape Cloudflare never sends.
    """
    payload = copy.deepcopy(_fixture("cf_domains.json"))
    entry = payload["result"][0]
    entry["status"] = status
    entry["verification_data"] = {"status": status}
    entry["validation_data"] = {"status": status, "method": "http"}
    return payload


# --- R8: production identity ------------------------------------------------


def test_production_branch_is_read_from_the_project_endpoint() -> None:
    """One GET, to the pinned project path, returning the configured branch."""
    seen: list = []
    client = _client(_transport(seen, project=_fixture("cf_project.json")))

    assert client.production_branch() == "main"
    assert _paths(seen) == [PROJECT_PATH]
    assert _methods(seen) == ["GET"]


def test_matching_production_branch_is_accepted() -> None:
    """Live values: project ``publicfilings``, branch ``main``."""
    seen: list = []
    client = _client(_transport(seen, project=_fixture("cf_project.json")))

    assert client.assert_production_branch("main") == "main"


def test_production_branch_mismatch_raises_and_names_both_branches() -> None:
    """R8: the abort must say what was expected AND what Cloudflare is set to.

    Naming only one of them leaves the operator unable to tell whether the
    workflow or the project is the thing that moved.

    Both branch names are checked **quoted**, and the configured one is a name
    that cannot occur incidentally. A first draft used ``"production"`` as the
    configured branch and asserted bare containment; the mutation that dropped
    the branch from the message survived, because the message still said
    "production branch mismatch". A substring that the sentence supplies for
    free asserts nothing.
    """
    payload = copy.deepcopy(_fixture("cf_project.json"))
    payload["result"]["production_branch"] = "release-candidate"
    seen: list = []
    client = _client(_transport(seen, project=payload))

    with pytest.raises(PagesRejected) as excinfo:
        client.assert_production_branch("main")

    message = str(excinfo.value)
    assert "'main'" in message
    assert "'release-candidate'" in message
    assert excinfo.value.outcome == REJECTED


def test_a_project_without_a_production_branch_is_rejected_not_guessed() -> None:
    payload = copy.deepcopy(_fixture("cf_project.json"))
    payload["result"].pop("production_branch")
    seen: list = []
    client = _client(_transport(seen, project=payload))

    with pytest.raises(PagesRejected):
        client.assert_production_branch("main")


# --- R11: the domain precondition ------------------------------------------


def test_an_active_custom_domain_passes() -> None:
    seen: list = []
    client = _client(_transport(seen, domains=_fixture("cf_domains.json")))

    entry = client.assert_custom_domain_active(DOMAIN)
    assert entry.name == DOMAIN
    assert entry.status == ACTIVE_DOMAIN_STATUS
    assert entry.verification_status == "active"
    assert entry.validation_status == "active"
    assert entry.validation_method == "http"


def test_an_initializing_custom_domain_raises() -> None:
    """``initializing`` is a documented status and is not ``active``."""
    assert "initializing" in DOMAIN_STATUSES
    seen: list = []
    client = _client(_transport(seen, domains=_domains_with_status("initializing")))

    with pytest.raises(PagesRejected) as excinfo:
        client.assert_custom_domain_active(DOMAIN)

    assert "initializing" in str(excinfo.value)
    assert excinfo.value.outcome == REJECTED


def test_domain_status_is_read_only_from_the_domains_subresource() -> None:
    """R11: the project endpoint is not requested at all on the status path.

    ``project=None`` makes the transport raise if it is touched, so this fails
    loudly rather than silently tolerating a second, wrong source of truth.
    """
    seen: list = []
    client = _client(_transport(seen, project=None, domains=_fixture("cf_domains.json")))

    client.assert_custom_domain_active(DOMAIN)

    assert _paths(seen) == [DOMAINS_PATH]
    assert PROJECT_PATH not in _paths(seen)


def test_the_project_domains_array_cannot_vouch_for_an_inactive_domain() -> None:
    """The complement of the test above, with the project endpoint available.

    The recorded project payload lists ``publicfilings.org`` in its ``domains``
    array — attachment, not activation — while the subresource says
    ``initializing``. The only way to pass this would be to believe the array.
    """
    project = _fixture("cf_project.json")
    assert DOMAIN in project["result"]["domains"]

    seen: list = []
    client = _client(
        _transport(seen, project=project, domains=_domains_with_status("initializing"))
    )

    with pytest.raises(PagesRejected):
        client.assert_custom_domain_active(DOMAIN)


def test_the_project_endpoints_domains_are_bare_strings_with_no_status() -> None:
    """Pins the fixture's realism, which the two tests above depend on.

    If someone "helpfully" enriched the fixture into a list of objects carrying
    a status, reading it would start to look defensible.
    """
    domains = _fixture("cf_project.json")["result"]["domains"]
    assert domains == ["publicfilings.pages.dev", DOMAIN]
    assert all(isinstance(entry, str) for entry in domains)


def test_a_domain_not_attached_to_the_project_is_rejected() -> None:
    seen: list = []
    client = _client(_transport(seen, domains=_fixture("cf_domains.json")))

    with pytest.raises(PagesRejected) as excinfo:
        client.assert_custom_domain_active("example.org")

    assert "example.org" in str(excinfo.value)


def test_the_domain_check_asks_once_and_does_not_poll() -> None:
    """R11 is a precondition assertion, not a wait loop.

    Activation happens before the workflow is armed; a client that polled would
    turn a misconfiguration into a timeout and hide it behind a delay.
    """
    seen: list = []
    client = _client(_transport(seen, domains=_domains_with_status("pending")))

    with pytest.raises(PagesRejected):
        client.assert_custom_domain_active(DOMAIN)

    assert _paths(seen) == [DOMAINS_PATH]


# --- R16/R17: unavailable is not a negative answer --------------------------


def test_a_rate_limit_is_unavailable_not_a_negative_answer() -> None:
    seen: list = []
    client = _client(_transport(seen, project=(429, _RATE_LIMITED)))

    with pytest.raises(PagesUnavailable) as excinfo:
        client.assert_production_branch("main")

    assert excinfo.value.outcome == UNAVAILABLE
    assert not isinstance(excinfo.value, PagesRejected)
    assert "429" in str(excinfo.value)


def test_a_server_error_is_unavailable_not_a_negative_answer() -> None:
    seen: list = []
    client = _client(_transport(seen, project=(500, _SERVER_ERROR)))

    with pytest.raises(PagesUnavailable) as excinfo:
        client.assert_production_branch("main")

    assert excinfo.value.outcome == UNAVAILABLE
    assert not isinstance(excinfo.value, PagesRejected)


def test_a_transport_error_is_unavailable() -> None:
    def explode(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("connection reset", request=request)

    client = _client(httpx.MockTransport(explode))

    with pytest.raises(PagesUnavailable) as excinfo:
        client.production_branch()

    assert excinfo.value.outcome == UNAVAILABLE


def test_a_rate_limited_domain_lookup_does_not_read_as_inactive() -> None:
    """The R17 property at the R11 call site — where a false negative would hurt.

    A 429 here must not abort the deploy claiming the custom domain is not
    active; it must say the lookup failed.
    """
    seen: list = []
    client = _client(_transport(seen, domains=(429, _RATE_LIMITED)))

    with pytest.raises(PagesUnavailable) as excinfo:
        client.assert_custom_domain_active(DOMAIN)

    message = str(excinfo.value)
    assert excinfo.value.outcome == UNAVAILABLE
    assert not isinstance(excinfo.value, PagesRejected)
    assert "429" in message
    # The R11 rejection reads "... is 'initializing', not 'active'". An outage
    # must not borrow that sentence.
    assert f"not {ACTIVE_DOMAIN_STATUS!r}" not in message


def test_a_4xx_answer_is_rejected_not_unavailable() -> None:
    """Without this the unavailable tests are free — everything could be an outage."""
    seen: list = []
    client = _client(_transport(seen, project=(403, _FORBIDDEN)))

    with pytest.raises(PagesRejected) as excinfo:
        client.production_branch()

    assert excinfo.value.outcome == REJECTED
    assert not isinstance(excinfo.value, PagesUnavailable)


def test_a_success_false_envelope_on_a_200_is_rejected() -> None:
    seen: list = []
    client = _client(
        _transport(
            seen,
            project={
                "success": False,
                "errors": [{"code": 8000007, "message": "Project not found"}],
                "messages": [],
                "result": None,
            },
        )
    )

    with pytest.raises(PagesRejected) as excinfo:
        client.production_branch()

    assert "Project not found" in str(excinfo.value)


def test_a_non_json_body_is_unavailable() -> None:
    """An interstitial or challenge page is an outage, not a verdict."""
    seen: list = []
    client = _client(
        _transport(seen, project=httpx.Response(200, text="<html>challenge</html>"))
    )

    with pytest.raises(PagesUnavailable):
        client.production_branch()


# --- deployments ------------------------------------------------------------


def test_production_deployments_are_listed_with_env_production() -> None:
    seen: list = []
    client = _client(_transport(seen, deployments=_fixture("cf_deployments.json")))

    client.production_deployments()

    assert _paths(seen) == [DEPLOYMENTS_PATH]
    assert seen[0][2] == {"env": "production"}


def test_deployment_fields_are_parsed_from_the_recorded_shape() -> None:
    """``uses_functions`` is only on the deployment object — R16 needs it."""
    seen: list = []
    client = _client(_transport(seen, deployments=_fixture("cf_deployments.json")))

    latest = client.latest_production_deployment()

    assert latest is not None
    assert latest.id == DEPLOYMENT_ID
    assert latest.environment == "production"
    assert latest.url == "https://6d2f8b41.publicfilings.pages.dev"
    assert latest.uses_functions is False


def test_a_deployment_reporting_functions_is_parsed_as_such() -> None:
    """R16's no-Functions check reads this field, so it must be read, not assumed.

    The recorded fixture says ``false``; without a ``true`` case a constant
    ``uses_functions=False`` would satisfy every other assertion here.
    """
    payload = copy.deepcopy(_fixture("cf_deployments.json"))
    payload["result"][0]["uses_functions"] = True
    seen: list = []
    client = _client(_transport(seen, deployments=payload))

    latest = client.latest_production_deployment()
    assert latest is not None
    assert latest.uses_functions is True


def test_a_preview_deployment_is_not_mistaken_for_production() -> None:
    """``environment`` is read from the entry, not assumed from the query.

    The ``env=production`` filter is Cloudflare's to honour; if a preview entry
    comes back anyway, taking ``result[0]`` would roll back to the wrong thing.
    """
    payload = copy.deepcopy(_fixture("cf_deployments.json"))
    payload["result"][0]["environment"] = "preview"
    seen: list = []
    client = _client(_transport(seen, deployments=payload))

    latest = client.latest_production_deployment()
    assert latest is not None
    assert latest.environment == "production"
    assert latest.id == "0a7c3e59-1b8d-4f26-9c40-e5137ab6d802"


def test_no_prior_deployment_is_a_real_answer_not_an_error() -> None:
    """R14: the live project has zero deployments, and that is not a failure."""
    seen: list = []
    empty = {"success": True, "errors": [], "messages": [], "result": []}
    client = _client(_transport(seen, deployments=empty))

    assert client.latest_production_deployment() is None


def test_rollback_posts_to_the_exact_pinned_path() -> None:
    seen: list = []
    rolled_back = copy.deepcopy(_fixture("cf_deployments.json")["result"][1])
    client = _client(
        _transport(
            seen,
            rollback={
                "success": True,
                "errors": [],
                "messages": [],
                "result": rolled_back,
            },
        )
    )

    deployment = client.rollback(DEPLOYMENT_ID)

    assert seen == [("POST", ROLLBACK_PATH, {})]
    assert deployment.id == "0a7c3e59-1b8d-4f26-9c40-e5137ab6d802"


# --- no DELETE anywhere -----------------------------------------------------

#: Values for every required parameter any public method takes. A new method
#: whose parameter is not listed here fails the sweep rather than being skipped.
_SWEEP_ARGS = {
    "expected": "main",
    "domain": DOMAIN,
    "deployment_id": DEPLOYMENT_ID,
}


def _catch_all(seen: list) -> httpx.MockTransport:
    """Answers every path plausibly, so the sweep gets past each method's body."""
    project = _fixture("cf_project.json")
    domains = _fixture("cf_domains.json")
    deployments = _fixture("cf_deployments.json")
    single = {
        "success": True,
        "errors": [],
        "messages": [],
        "result": deployments["result"][0],
    }

    def handler(request: httpx.Request) -> httpx.Response:
        path = request.url.path
        seen.append((request.method, path, dict(request.url.params)))
        if path.endswith("/rollback"):
            return httpx.Response(200, json=single)
        if path == DOMAINS_PATH:
            return httpx.Response(200, json=domains)
        if path.startswith(DEPLOYMENTS_PATH):
            return httpx.Response(200, json=deployments)
        return httpx.Response(200, json=project)

    return httpx.MockTransport(handler)


def _drive_every_public_method(client: PagesClient) -> list[str]:
    driven = []
    for name in sorted(dir(client)):
        if name.startswith("_"):
            continue
        attr = getattr(client, name)
        if not callable(attr):
            continue
        kwargs = {}
        for param_name, param in inspect.signature(attr).parameters.items():
            if param.default is not inspect.Parameter.empty:
                continue
            if param.kind in (param.VAR_POSITIONAL, param.VAR_KEYWORD):
                continue
            assert param_name in _SWEEP_ARGS, (
                f"public method {name!r} takes {param_name!r}, which this sweep "
                "does not know how to supply — wire it into _SWEEP_ARGS so the "
                "no-DELETE property keeps covering every method"
            )
            kwargs[param_name] = _SWEEP_ARGS[param_name]
        try:
            attr(**kwargs)
        except PagesError:
            pass
        driven.append(name)
    return driven


def test_no_public_method_issues_an_http_delete() -> None:
    """Every public method, driven, and not one of them sends a DELETE.

    Cloudflare "will not delete the active production deployment if one exists",
    so a deletion would be a compensation the provider declines. The sweep is
    generic on purpose: a delete method added later is driven automatically
    rather than being invisible to a hand-written list.
    """
    seen: list = []
    client = _client(_catch_all(seen))

    driven = _drive_every_public_method(client)

    assert set(driven) == {
        "assert_custom_domain_active",
        "assert_production_branch",
        "custom_domains",
        "latest_production_deployment",
        "production_branch",
        "production_deployments",
        "project",
        "rollback",
    }
    assert seen, "the sweep issued no requests at all; it would pass vacuously"
    assert set(_methods(seen)) == {"GET", "POST"}


def test_the_module_source_names_no_delete_verb() -> None:
    """The structural half: a method never exercised would slip past the sweep."""
    source = Path(cloudflare.__file__).read_text(encoding="utf-8")

    assert not re.search(r"""['"]DELETE['"]""", source)
    assert not re.search(r"\.delete\s*\(", source)
    assert not re.search(r"""request\(\s*['"]delete['"]""", source, re.IGNORECASE)


def test_an_unpinned_verb_never_reaches_the_transport() -> None:
    """The guard runs before the request is built, so nothing can smuggle one out."""
    seen: list = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request.method)
        return httpx.Response(200, json={"success": True, "result": {}})

    client = _client(httpx.MockTransport(handler))

    with pytest.raises(PagesRejected):
        client._request("DELETE", DEPLOYMENTS_PATH + f"/{DEPLOYMENT_ID}")

    assert seen == []


# --- hermetic construction --------------------------------------------------


def test_construction_opens_no_connection() -> None:
    """Nothing moves until a method is called (``tests/conftest.py`` forbids sockets)."""
    seen: list = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request.method)
        raise AssertionError("construction must not issue a request")

    PagesClient(ACCOUNT, PROJECT, TOKEN, transport=httpx.MockTransport(handler))

    assert seen == []


def test_a_client_without_a_token_is_refused() -> None:
    with pytest.raises(PagesRejected):
        PagesClient(ACCOUNT, PROJECT, "", transport=httpx.MockTransport(lambda r: None))
