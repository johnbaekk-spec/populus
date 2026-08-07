"""§12.1 R9/R10/R16: the three production objects the ordered sequence injects.

:mod:`populus.deploy.orchestrator` owns the *order* and injects everything that
touches the outside world. Until this module existed, the only implementations
of its ``Uploader`` and ``Verifier`` seams were the fakes in the test-suite —
which means every ordering guarantee the suite proved was a statement about a
fake, and the ``Verifier`` Protocol had drifted to a shape
:func:`populus.deploy.verify.verify_deployment` could not satisfy without anyone
noticing. The three objects here are the real ones, and the suite now drives the
whole sequence through them.

**Why the wrangler CLI and not the Pages HTTP API.** Direct Upload is not a PUT
of a directory. The client hashes every asset with **blake3** over
``base64(content) + extension``, negotiates ``/pages/assets/check-missing``,
uploads the missing blobs under a short-lived JWT, and only then POSTs a
manifest of path → hash. blake3 is not in the standard library, and this project
does not take a new dependency to re-implement a protocol Cloudflare already
ships a client for. So the byte transfer is delegated to a **pinned**
``wrangler pages deploy``, invoked as an **argv list and never through a
shell** — the same shape :class:`populus.publish.build.GhReleaseBackend` uses
for the ``gh`` CLI. The command transport is injectable for exactly the same
reason it is there: the suite is hermetic and nothing may reach the network
under it (``tests/conftest.py``).

**wrangler moves bytes; it is not believed about what it did.** Its output is
human-facing text carrying no deployment id, and "the CLI printed success" is
not evidence. Every fact the sequence then acts on — the deployment id, the
environment the bytes really landed in, and the ``uses_functions`` signal R16
reads — is read back from the pinned Pages API. The URL wrangler printed is used
for exactly one thing: to require that the newest deployment in that environment
*is* the one this run just published. If it is not, another deploy raced us, and
every guarantee downstream ("production was never touched", "the same bytes")
is about a deployment this run did not create — so the upload refuses rather
than verifying someone else's tree under our name.

**Raw provider payloads, never reconstructions** (R16). Both the upload result
and the rollback result carry the provider's own object verbatim.
:func:`populus.deploy.verify.check_no_functions` fails **closed** on
``uses_functions`` being *absent*, and
:class:`~populus.deploy.cloudflare.Deployment` coerces that field with
``bool(entry.get("uses_functions"))`` — so any mapping rebuilt from the typed
object turns a missing provider signal into a confident ``False`` and deletes
the fail-closed property while appearing to keep it.
:mod:`populus.deploy.record` documents this trap by name for the signer;
:class:`PagesDeploySurface` is how the deploy path avoids it, which is why its
rollback is spelled :meth:`~PagesDeploySurface.rollback_payload` and returns a
mapping rather than reusing :meth:`PagesClient.rollback`'s typed answer. The
name differs on purpose: a bare ``PagesClient`` passed where the sequence wants
this surface fails loudly on a missing attribute instead of quietly laundering
the field.

**No transport library is named here.** wrangler owns the upload connection and
the verifier's client is injected, so this module needs no HTTP permission — the
dep guard's allowlist grants it ``subprocess`` and nothing else.
"""

from __future__ import annotations

import re
import subprocess  # nosec B404 — pinned wrangler CLI, argv list only, never a shell
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Protocol

from populus.deploy.cloudflare import CustomDomain, Deployment, PagesClient, PagesRejected
from populus.deploy.orchestrator import (
    PREVIEW,
    PRODUCTION,
    DeployError,
    UploadedDeployment,
)
from populus.deploy.verify import HttpGetter, VerificationResult, verify_deployment

__all__ = [
    "DEFAULT_WRANGLER_PACKAGE",
    "DeploymentLookup",
    "DeploymentVerifier",
    "PagesDeploySurface",
    "UploadFailed",
    "WranglerUploader",
]

#: The exact wrangler the deploy runs. A floating spec is not a pin: `wrangler`
#: publishes majors that change the Direct Upload flow, and "whatever npm served
#: today" is not a thing a deployment record can be a statement about. Override
#: with ``--wrangler-package`` when the pin is rolled; ``npx --yes`` installs
#: this exact spec and nothing else.
DEFAULT_WRANGLER_PACKAGE = "wrangler@4.42.0"

#: Every deployment origin Pages hands out lives under this suffix, and the only
#: thing the printed URL is used for is matching it to an API answer.
_PAGES_URL = re.compile(r"https://[A-Za-z0-9][A-Za-z0-9.-]*\.pages\.dev")

_DEFAULT_TIMEOUT = 900.0


class UploadFailed(DeployError):
    """The upload did not happen, or did not happen the way we asked.

    A subclass of :class:`~populus.deploy.orchestrator.DeployError` so the entry
    point's exit-code mapping covers it without naming this module: an upload
    that failed produced no verification and therefore claims nothing.
    """


#: ``(argv) -> (returncode, stdout, stderr)``. Injected in tests; the default is
#: :func:`_run_argv`, which is the single line in this package that spawns a
#: process.
CommandRunner = Callable[[Sequence[str]], "tuple[int, str, str]"]


def _run_argv(argv: Sequence[str]) -> tuple[int, str, str]:
    """The real invocation: argv list, no shell, output captured.

    ``shell=True`` is not a thing this codebase does anywhere, and the argument
    list is built from a pinned package spec plus values the caller already
    holds — there is no string to interpolate a command into.
    """
    try:
        proc = subprocess.run(  # nosec B603 — argv list, no shell, fixed program
            list(argv),
            capture_output=True,
            text=True,
            check=False,
            timeout=_DEFAULT_TIMEOUT,
        )
    except OSError as exc:
        raise UploadFailed(
            f"could not run {argv[0]!r}: {exc}. The deploy job needs Node on the "
            "runner; nothing was uploaded."
        ) from exc
    except subprocess.TimeoutExpired as exc:
        raise UploadFailed(
            f"{argv[0]!r} did not finish within {_DEFAULT_TIMEOUT:.0f}s: {exc}. "
            "The upload's outcome is unknown, so this run claims nothing about it."
        ) from exc
    return (proc.returncode, proc.stdout or "", proc.stderr or "")


class DeploymentLookup(Protocol):
    """Reads deployments back from the provider as **raw** objects.

    Narrow on purpose: the uploader needs to know what Cloudflare says it just
    created, and nothing else about the Pages API.
    """

    def raw_deployments(
        self, environment: str | None = None
    ) -> list[Mapping[str, Any]]: ...


class PagesDeploySurface:
    """The deploy sequence's entire Cloudflare surface — five calls, two raw.

    A class rather than four loose functions for the same reason
    :class:`populus.deploy.record.CloudflareReads` is one: the surface is then a
    shape a reader and a test can both check, instead of an absence someone has
    to prove by reading every line of the caller.

    Note what is **not** here, and stays not here: no deletion. Cloudflare
    documents that the operation "will not remove the active production
    deployment if one exists", so it is not a compensation — see
    :mod:`populus.deploy.cloudflare`, which exposes no such method to wrap, and
    TD-4 in :mod:`populus.deploy.orchestrator`.
    """

    #: Pinned so a test can assert the surface did not quietly grow.
    SURFACE = (
        "assert_production_branch",
        "assert_custom_domain_active",
        "latest_production_deployment",
        "raw_deployments",
        "rollback_payload",
    )

    def __init__(self, client: PagesClient) -> None:
        self._client = client

    def assert_production_branch(self, expected: str) -> str:
        return self._client.assert_production_branch(expected)

    def assert_custom_domain_active(self, domain: str) -> CustomDomain:
        return self._client.assert_custom_domain_active(domain)

    def latest_production_deployment(self) -> Deployment | None:
        """The rollback target. Typed is fine here: only ``id`` is ever read.

        The laundering hazard is specific to ``uses_functions``, and this answer
        is used to name a deployment to roll back to — not to assert anything
        about what that deployment runs.
        """
        return self._client.latest_production_deployment()

    def raw_deployments(
        self, environment: str | None = None
    ) -> list[Mapping[str, Any]]:
        """``GET …/deployments`` — the provider's own objects, newest first.

        Read through the client's request helper so the pinned path, the verb
        guard and the injected transport are all still the ones
        :mod:`populus.deploy.cloudflare` owns; only the *typing* is skipped, and
        that is the entire point.

        *environment* is optional and the uploader deliberately omits it. Asking
        for ``?env=preview`` would filter out the very answer the caller needs to
        see: an upload that was asked for a preview and landed in **production**
        would come back "no such deployment" instead of "here is your deployment,
        and it is a production one" — and the sequence's environment guard, which
        exists for exactly that case, would never get to fire.
        """
        params = {"env": environment} if environment is not None else None
        result = self._client._request(
            "GET", self._client._deployments_path(), params=params
        )
        if not isinstance(result, list):
            raise PagesRejected(
                f"deployments endpoint returned {type(result).__name__}, not a list"
            )
        entries: list[Mapping[str, Any]] = []
        for entry in result:
            if not isinstance(entry, Mapping):
                raise PagesRejected(
                    f"deployment entry is {type(entry).__name__}, not an object"
                )
            entries.append(entry)
        return entries

    def rollback_payload(self, deployment_id: str) -> Mapping[str, Any]:
        """``POST …/deployments/{id}/rollback``, returning the RAW deployment.

        The re-verification after a rollback runs R16's no-Functions check
        against this mapping. Handing it a mapping rebuilt from
        :class:`~populus.deploy.cloudflare.Deployment` would set
        ``uses_functions`` to ``bool(...)`` of a possibly-absent field, so a
        provider answer that never carried the signal would arrive as a
        confident ``False`` and pass a check whose whole design is to fail
        closed on absence.
        """
        if not deployment_id:
            raise PagesRejected("rollback requires a deployment id")
        result = self._client._request(
            "POST", self._client._rollback_path(deployment_id)
        )
        if not isinstance(result, Mapping):
            raise PagesRejected(
                f"rollback returned {type(result).__name__}, not a deployment object"
            )
        return result


@dataclass(frozen=True)
class WranglerUploader:
    """Publishes a sealed tree to one Pages environment, then reads back what happened.

    Satisfies :class:`populus.deploy.orchestrator.Uploader`. *runner* is the
    injected command transport; *lookup* is how the result is confirmed against
    the provider rather than against the CLI's own prose.
    """

    project: str
    lookup: DeploymentLookup
    runner: CommandRunner = _run_argv
    package: str = DEFAULT_WRANGLER_PACKAGE

    def command(self, path: Path, *, branch: str) -> list[str]:
        """The exact argv. Split out so a test can pin it without running it.

        ``--commit-dirty=true`` because the runner's checkout is dirty by
        construction (the artifact was downloaded into it) and wrangler
        otherwise stops to ask a question no one is there to answer. The
        credentials are **not** here: ``CLOUDFLARE_API_TOKEN`` and
        ``CLOUDFLARE_ACCOUNT_ID`` are read by wrangler from the step-scoped
        environment the workflow injects, so this class never handles the token
        — the same posture as ``GhReleaseBackend`` and ``GH_TOKEN``.
        """
        return [
            "npx",
            "--yes",
            self.package,
            "pages",
            "deploy",
            str(path),
            f"--project-name={self.project}",
            f"--branch={branch}",
            "--commit-dirty=true",
        ]

    def __call__(
        self, path: Path, *, environment: str, branch: str
    ) -> UploadedDeployment:
        argv = self.command(path, branch=branch)
        code, out, err = self.runner(argv)
        if code != 0:
            raise UploadFailed(
                f"wrangler pages deploy exited {code} for the {environment} "
                f"upload: {(err or out).strip()[:400]}"
            )
        printed = _pages_urls(f"{out}\n{err}")
        if not printed:
            raise UploadFailed(
                f"wrangler reported no *.pages.dev URL for the {environment} "
                "upload, so there is no way to tell which deployment it created; "
                "refusing to guess"
            )
        return self._confirm(environment, printed)

    def _confirm(
        self, environment: str, printed: frozenset[str]
    ) -> UploadedDeployment:
        """Match the CLI's URL to the provider's newest deployment, or refuse.

        Newest-only, deliberately: if the deployment wrangler just made is not
        the newest one the project has, something else deployed between the
        upload and this read. "Production was never touched" and "the same
        bytes" are then claims about a tree this run did not publish, and the
        honest move is to stop rather than to verify whichever deployment
        happens to match further down the list.

        Unfiltered by environment, equally deliberately: the answer this read
        exists to obtain is *which environment the bytes actually landed in*,
        and a query scoped to the environment we asked for cannot return "the
        other one".
        """
        entries = self.lookup.raw_deployments()
        if not entries:
            raise UploadFailed(
                "the Pages API lists no deployment after the "
                f"{environment} upload; there is nothing to verify or record"
            )
        newest = entries[0]
        url = newest.get("url")
        identifier = newest.get("id")
        if not isinstance(identifier, str) or not identifier:
            raise UploadFailed(
                f"the newest deployment after the {environment} upload carries "
                f"no id: {newest!r}"
            )
        if not isinstance(url, str) or url not in printed:
            raise UploadFailed(
                f"the newest deployment ({identifier}) is at {url!r}, which is "
                f"not the URL wrangler just published ({sorted(printed)}). "
                "Another deployment landed in the middle of this run, so nothing "
                "below this point would be a statement about the bytes this run "
                "uploaded."
            )
        return UploadedDeployment(
            id=identifier,
            url=url,
            environment=str(newest.get("environment") or ""),
            payload=newest,
        )


def _pages_urls(text: str) -> frozenset[str]:
    """Every ``*.pages.dev`` URL wrangler printed, trailing punctuation removed."""
    return frozenset(match.rstrip(".") for match in _PAGES_URL.findall(text))


@dataclass(frozen=True)
class DeploymentVerifier:
    """Binds :func:`populus.deploy.verify.verify_deployment` to ``Verifier``.

    An adapter and not a signature change, because the two callables answer to
    different owners. ``verify_deployment`` is a general routine over *(client,
    base_url, inventory, expectations, provider payload)* and is called by the
    signer too, with no notion of a deploy "stage". The sequence, in contrast,
    injects **one** callable it invokes three times and needs the expectations
    already bound so it cannot vary them between the preview leg and the
    production leg — which is precisely the substitution R9's amended
    "inventory-wide on both legs" exists to forbid. Binding them here, once, in
    a frozen dataclass, is what makes "the same verification ran on both" a
    property of construction rather than of call sites.

    ``stage`` is a label, not a switch: R9 and R11 are deliberately one code
    path differing only in ``base_url``. It is validated rather than ignored, so
    a caller that invents a third stage is a bug that stops here instead of
    quietly verifying something under a name no one defined.
    """

    client: HttpGetter
    build_id: str
    code_sha: str
    stats_bytes: bytes

    def __call__(
        self,
        base_url: str,
        *,
        stage: str,
        inventory: Mapping[str, Any],
        deployment: Mapping[str, Any],
    ) -> VerificationResult:
        if stage not in (PREVIEW, PRODUCTION):
            raise ValueError(
                f"unknown verification stage {stage!r}; the sequence has exactly "
                f"two, {PREVIEW!r} and {PRODUCTION!r}"
            )
        return verify_deployment(
            self.client,
            base_url,
            inventory=inventory,
            build_id=self.build_id,
            code_sha=self.code_sha,
            stats_bytes=self.stats_bytes,
            deployment=deployment,
        )


def await_origin(
    client: Any,
    *,
    attempts: int = 12,
    delay_seconds: float = 5.0,
    sleep: Any = None,
) -> Any:
    """A readiness poller for a freshly-uploaded Pages origin.

    Cloudflare hands back the deployment URL as soon as the upload is accepted,
    but the edge takes a few seconds to route it; until then every path answers
    **522**. The verifier is right to call that "no verdict" — so the fix is to
    stop asking too early, not to soften the verdict.

    Returns when the origin answers anything that is not a 5xx, or after
    ``attempts`` tries. Deliberately does NOT raise on exhaustion: if the origin
    truly never comes up, the sweep that follows will say so with its own
    evidence, and this helper has no business pre-empting that verdict.
    """
    import time

    naptime = sleep if sleep is not None else time.sleep

    def _ready(url: str, *, stage: str) -> None:
        for attempt in range(attempts):
            try:
                response = client.get(url, follow_redirects=False)
            except Exception:  # transport not up yet — indistinguishable from 522
                pass
            else:
                if response.status_code < 500:
                    return
            if attempt < attempts - 1:
                naptime(delay_seconds)

    return _ready
