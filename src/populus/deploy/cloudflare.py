"""§12.1 R8/R11/R16: the Cloudflare Pages API, pinned endpoint by endpoint.

Every call here is pinned because the *obvious* alternative gives a wrong answer,
an absent answer, or no answer at all. The pins, and what each one is defending
against:

1. ``GET …/pages/projects/{project}`` — the source of ``production_branch``, and
   of **nothing else this module trusts**. Its ``domains`` field is an array of
   **bare strings** (``["publicfilings.pages.dev", "publicfilings.org"]``): a
   domain appears there once it is *attached* to the project, carrying no status
   whatsoever. Reading membership in that array as "the domain is live" is the
   exact mistake R11 exists to prevent — it would pass while the certificate was
   still ``initializing`` and the domain served nothing.

2. ``GET …/pages/projects/{project}/domains`` — the **only** endpoint that
   carries per-domain ``status``, one of ``initializing | pending | active |
   deactivated | blocked | error``, plus ``verification_data.status`` and
   ``validation_data.status``. R11's precondition reads here and nowhere else.
   The two are separate methods on purpose: nothing in this module can satisfy a
   status question with the project payload, because the project payload is never
   fetched on that path.

3. ``GET …/deployments?env=production`` — ``id``, ``environment``, ``url`` and
   ``uses_functions``. The last is what R16's no-Functions check needs, and it is
   only on the deployment object.

4. ``POST …/deployments/{id}/rollback`` — the one non-GET call, and the only
   compensation the provider actually offers.

**There is deliberately no deployment-deletion method here, and its absence is a
decision, not an oversight.** Revision 2 of the plan specified
``DELETE …/deployments/{id}`` as the first-run compensation. Cloudflare's own
Pages known-issues documentation says the operation "will not delete the active
production deployment if one exists" — so the compensation would have been a call
the provider declines, dressed up as a rollback. This module does not call an
endpoint whose documented behaviour is to refuse. A first run with no prior
deployment therefore has **no automated compensation** (TD-4); that is stated in
the plan and remediated by the owner, not papered over here. A future reader who
adds a delete method is undoing that, not completing it.

**Failures are two kinds, never one** (R16/R17, following the ``rejected`` vs
``unavailable`` split in ``populus.publish.attestation``):

* :class:`PagesRejected` — we reached Cloudflare and the answer was no. The
  branch differs, the domain is ``initializing``, the project does not exist.
* :class:`PagesUnavailable` — we did not get an answer: transport error, HTTP
  429, HTTP 5xx, a body that is not JSON. A rate-limited API must never read as
  "tampered" or "inactive"; that is a verification *outage*, and collapsing the
  two is how a quota error becomes a false accusation.

The transport is injected (``tests/conftest.py`` forbids sockets), and nothing
opens a connection at import or at construction — the first byte moves when a
method is called.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import httpx

from populus.publish.attestation import REJECTED, UNAVAILABLE

#: Scheme + host only; every path below is written out in full so a test can pin
#: the literal string it expects.
API_HOST = "https://api.cloudflare.com"

#: Every value ``…/domains`` is documented to return for ``status``.
DOMAIN_STATUSES = (
    "initializing",
    "pending",
    "active",
    "deactivated",
    "blocked",
    "error",
)

#: The only one of those that means the domain is serving.
ACTIVE_DOMAIN_STATUS = "active"

#: The verbs this client is permitted to issue: four reads and one rollback.
#: Anything else — notably the deletion discussed in the module docstring — is
#: refused before a request is built.
ALLOWED_METHODS = frozenset({"GET", "POST"})

_DEFAULT_TIMEOUT = 30.0


class PagesError(RuntimeError):
    """Base for every failure this module raises.

    ``outcome`` mirrors ``populus.publish.attestation``: a caller that only looks
    at "did this raise" sees the same thing either way, and a caller that needs
    to tell an outage from a verdict has one attribute to read.
    """

    outcome = REJECTED


class PagesRejected(PagesError):
    """Cloudflare answered, and the answer was no."""

    outcome = REJECTED


class PagesUnavailable(PagesError):
    """No verdict was reached — transport error, HTTP 429, HTTP 5xx, bad body.

    Distinct from :class:`PagesRejected` on purpose (R17). "Could not ask" is not
    "asked and the answer was bad", and a deploy that conflates them reports a
    rate limit as tampering.
    """

    outcome = UNAVAILABLE


@dataclass(frozen=True)
class CustomDomain:
    """One entry from the ``…/domains`` subresource — the only status there is.

    ``verification_data`` and ``validation_data`` are carried because they say
    *why* a domain is not active, which is the difference between an error
    message an owner can act on and one that only restates the failure.
    """

    name: str
    status: str
    verification_status: str | None = None
    validation_status: str | None = None
    validation_method: str | None = None

    @property
    def active(self) -> bool:
        return self.status == ACTIVE_DOMAIN_STATUS


@dataclass(frozen=True)
class Deployment:
    """The four deployment fields the deploy path and R16 actually read."""

    id: str
    environment: str
    url: str
    uses_functions: bool


class PagesClient:
    """The pinned Cloudflare Pages surface, over an injected transport.

    *transport* is ``None`` in production (httpx builds its own) and an
    ``httpx.MockTransport`` in every test. Construction performs no I/O.
    """

    def __init__(
        self,
        account_id: str,
        project: str,
        token: str,
        *,
        transport: httpx.BaseTransport | None = None,
        timeout: float = _DEFAULT_TIMEOUT,
    ) -> None:
        if not account_id or not project or not token:
            raise PagesRejected(
                "PagesClient requires an account id, a project name and an API "
                "token; refusing to build a client that would fail open"
            )
        self._account_id = account_id
        self._project = project
        self._token = token
        self._transport = transport
        self._timeout = timeout

    # --- pinned paths -------------------------------------------------------

    @property
    def project_name(self) -> str:
        return self._project

    def _project_path(self) -> str:
        return f"/client/v4/accounts/{self._account_id}/pages/projects/{self._project}"

    def _domains_path(self) -> str:
        return f"{self._project_path()}/domains"

    def _deployments_path(self) -> str:
        return f"{self._project_path()}/deployments"

    def _rollback_path(self, deployment_id: str) -> str:
        return f"{self._deployments_path()}/{deployment_id}/rollback"

    # --- transport ----------------------------------------------------------

    def _request(
        self, method: str, path: str, *, params: dict[str, str] | None = None
    ) -> Any:
        """Issue one request and unwrap the Cloudflare envelope.

        The verb guard runs before anything is built, so an unpinned verb never
        reaches the transport at all — a caller cannot smuggle one past the
        injected transport's own assertions.
        """
        if method not in ALLOWED_METHODS:
            raise PagesRejected(
                f"{method} is not a verb this client issues; the pinned surface "
                f"is {sorted(ALLOWED_METHODS)}"
            )
        url = f"{API_HOST}{path}"
        headers = {
            "Authorization": f"Bearer {self._token}",
            "Accept": "application/json",
        }
        try:
            with httpx.Client(transport=self._transport, timeout=self._timeout) as client:
                response = client.request(method, url, params=params, headers=headers)
        except httpx.HTTPError as exc:
            raise PagesUnavailable(
                f"transport error contacting {path}: {exc}"
            ) from exc
        return _unwrap(response, path)

    # --- R8: production identity -------------------------------------------

    def project(self) -> dict:
        """The raw project result.

        Callers wanting domain status must not use this. ``result["domains"]``
        is an array of bare strings with no status attached — see the module
        docstring, and :meth:`custom_domains` for the endpoint that answers.
        """
        result = self._request("GET", self._project_path())
        if not isinstance(result, dict):
            raise PagesRejected(
                f"project endpoint returned {type(result).__name__}, not an object"
            )
        return result

    def production_branch(self) -> str:
        """The branch Cloudflare is configured to treat as production."""
        branch = self.project().get("production_branch")
        if not isinstance(branch, str) or not branch:
            raise PagesRejected(
                f"project {self._project!r} reports no production_branch; "
                "refusing to guess which branch is production"
            )
        return branch

    def assert_production_branch(self, expected: str) -> str:
        """R8: the workflow-locked branch must be the project's production branch.

        Called before any upload. A mismatch means the bytes about to be pushed
        would land somewhere other than the identity the workflow claims, so the
        run aborts while nothing has been uploaded yet.
        """
        configured = self.production_branch()
        if configured != expected:
            raise PagesRejected(
                "production branch mismatch: the workflow is locked to "
                f"{expected!r} but Cloudflare project {self._project!r} deploys "
                f"production from {configured!r}. Aborting before any upload (R8)."
            )
        return configured

    # --- R11: the domain precondition --------------------------------------

    def custom_domains(self) -> list[CustomDomain]:
        """Every custom domain **with its status** — the ``…/domains`` subresource.

        This is the only method in the module that can answer a status question,
        and it does not read the project endpoint to do it.
        """
        result = self._request("GET", self._domains_path())
        if not isinstance(result, list):
            raise PagesRejected(
                f"domains subresource returned {type(result).__name__}, not a list"
            )
        return [_custom_domain(entry) for entry in result]

    def assert_custom_domain_active(self, domain: str) -> CustomDomain:
        """R11: *domain* must be ``active`` on the domains subresource.

        No polling and no waiting. Activation is a one-time provisioning
        precondition confirmed before the workflow is ever armed (Rollout
        prerequisite 4); a run that waited for it would be re-deriving a
        guarantee it was handed, and would turn a misconfiguration into a
        timeout instead of an error.
        """
        found = {entry.name: entry for entry in self.custom_domains()}
        entry = found.get(domain)
        if entry is None:
            raise PagesRejected(
                f"custom domain {domain!r} is not attached to project "
                f"{self._project!r}; the domains subresource lists {sorted(found)}. "
                "Aborting before the production upload (R11)."
            )
        if not entry.active:
            raise PagesRejected(
                f"custom domain {domain!r} is {entry.status!r}, not "
                f"{ACTIVE_DOMAIN_STATUS!r} (verification="
                f"{entry.verification_status!r}, validation="
                f"{entry.validation_status!r}). Activation is a provisioning "
                "prerequisite, not something this run polls for. Aborting before "
                "the production upload (R11)."
            )
        return entry

    # --- deployments --------------------------------------------------------

    def production_deployments(self) -> list[Deployment]:
        """Production deployments, newest first, as Cloudflare orders them."""
        result = self._request(
            "GET", self._deployments_path(), params={"env": "production"}
        )
        if not isinstance(result, list):
            raise PagesRejected(
                f"deployments endpoint returned {type(result).__name__}, not a list"
            )
        return [_deployment(entry) for entry in result]

    def latest_production_deployment(self) -> Deployment | None:
        """The newest production deployment, or ``None`` when there is none.

        ``None`` is a real answer, not an error (R14): on the first run there is
        no prior deployment, and that is the only thing special about it. The
        caller decides what that means; this method does not invent one.
        """
        for deployment in self.production_deployments():
            if deployment.environment == "production":
                return deployment
        return None

    def rollback(self, deployment_id: str) -> Deployment:
        """``POST …/deployments/{id}/rollback`` — the only compensation offered.

        Cloudflare constrains this to successful production builds, which is
        exactly the set the caller captured before uploading. It is also the only
        non-GET call in the module; see the docstring for why deletion is not the
        sibling a reader might expect.
        """
        if not deployment_id:
            raise PagesRejected("rollback requires a deployment id")
        result = self._request("POST", self._rollback_path(deployment_id))
        if not isinstance(result, dict):
            raise PagesRejected(
                f"rollback returned {type(result).__name__}, not a deployment object"
            )
        return _deployment(result)


# --- envelope handling ------------------------------------------------------


def _unwrap(response: httpx.Response, path: str) -> Any:
    """Turn one Cloudflare response into ``result``, or into the right failure.

    The split is the whole point (R17). 429 and 5xx are *outages*; a 4xx that is
    not 429 is Cloudflare telling us something about our request, and failing
    loudly on it is correct — including 401/403, which say our authority is wrong
    and must not be retried away as a blip.
    """
    status = response.status_code
    if status == 429 or status >= 500:
        raise PagesUnavailable(
            f"Cloudflare could not answer {path}: HTTP {status}. This is a lookup "
            "failure, not a negative answer — it must never be read as a domain "
            "being inactive or a deployment being tampered with."
        )
    if status >= 400:
        raise PagesRejected(f"HTTP {status} from {path}: {_snippet(response)}")
    try:
        payload = response.json()
    except ValueError as exc:
        raise PagesUnavailable(
            f"{path} returned HTTP {status} with a body that is not JSON "
            f"({exc}); no verdict was reached"
        ) from exc
    if not isinstance(payload, dict):
        raise PagesRejected(f"{path} returned {type(payload).__name__}, not an envelope")
    if not payload.get("success"):
        raise PagesRejected(f"{path} reported success=false: {payload.get('errors')}")
    return payload.get("result")


def _snippet(response: httpx.Response, limit: int = 200) -> str:
    try:
        text = response.text
    except Exception:  # pragma: no cover - a body we cannot even decode
        return "<undecodable body>"
    return text[:limit]


def _custom_domain(entry: Any) -> CustomDomain:
    if not isinstance(entry, dict):
        raise PagesRejected(f"domain entry is {type(entry).__name__}, not an object")
    name = entry.get("name")
    status = entry.get("status")
    if not isinstance(name, str) or not isinstance(status, str):
        raise PagesRejected(f"domain entry lacks a name/status pair: {entry!r}")
    verification = entry.get("verification_data") or {}
    validation = entry.get("validation_data") or {}
    return CustomDomain(
        name=name,
        status=status,
        verification_status=verification.get("status"),
        validation_status=validation.get("status"),
        validation_method=validation.get("method"),
    )


def _deployment(entry: Any) -> Deployment:
    if not isinstance(entry, dict):
        raise PagesRejected(f"deployment entry is {type(entry).__name__}, not an object")
    identifier = entry.get("id")
    if not isinstance(identifier, str) or not identifier:
        raise PagesRejected(f"deployment entry has no id: {entry!r}")
    return Deployment(
        id=identifier,
        environment=entry.get("environment") or "",
        url=entry.get("url") or "",
        uses_functions=bool(entry.get("uses_functions")),
    )
