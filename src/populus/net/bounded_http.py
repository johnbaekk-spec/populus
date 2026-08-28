"""Bounded HTTP transport helper (RUN PUBLIC-SECURITY-HARDENING, R9/LD10).

Every REAL httpx transport in the repository — House, Senate GET/POST, and the
SEC federated client — routes its request through :func:`bounded_http_request`,
which enforces one generous availability ceiling (LD10: 128 MiB of decoded
body) on responses from the fixed government hosts. Injected/fake transports
used by the hermetic test suites are untouched: they never construct httpx
objects and are bounded by their fixtures.

The helper:

* rejects an oversized declared ``Content-Length`` BEFORE iterating the body;
* otherwise streams, counting **decoded** bytes, and aborts at ``limit + 1``;
* always closes the response (the ``httpx.stream`` context manager);
* preserves multiple ``Set-Cookie`` values by newline-joining them (header
  values cannot contain a newline), matching the Senate transport's existing
  cookie-jar contract;
* keeps redirects disabled and takes the caller's timeout/headers/form data
  unchanged;
* returns the shared :class:`populus.ingest.TransportResponse` on success.

A breach raises :class:`ResponseTooLarge` — a named ingest failure whose
message carries the URL, the configured cap, the declared size when present,
and the observed lower bound. Exception strings NEVER include response bodies
or request headers.

Sibling inventory (Task 8 step 5, swept 2026-08-27) — every other full-body
consumer in ``src/``, classified:

* ``inst_bulk.py`` / ``inst_ingest.py`` / ``inst13f_seam.py`` /
  ``list13f_ingest.py`` — SEC documents fetched through ``SecClient``, whose
  only real transport is ``HttpxSecTransport`` → covered transitively by this
  helper.
* ``ingest/house.py`` / ``ingest/senate.py`` document fetches — go through
  the polite fetcher/session over ``HttpxTransport`` / ``HttpxSenateTransport``
  → covered transitively by this helper.
* ``Path.read_bytes`` / ``read_text`` call sites (checkpoint, archives,
  caches, deploy snapshot, publish, record) — LOCAL-ONLY files this process
  previously wrote (or the operator supplied); no remote trust boundary.
* ``zipfile ... archive.read`` in ``ingest/house.py`` discovery — hardened in
  place with the LD10 ZIP ceilings (16 MiB compressed, 64 MiB member, 100:1
  ratio, exactly one regular XML member).
* ``zipfile ... archive.read`` in ``identity/bootstrap.py`` (``_ftd_streams``)
  — reads an operator-supplied LOCAL SEC fails-to-deliver archive path;
  local-only at this boundary (a populus-fetched copy arrives via the bounded
  ``SecClient``).
* ``deploy/cloudflare.py`` / ``deploy/verify.py`` / ``deploy/record.py`` /
  ``deploy/orchestrator.py`` — authenticated Cloudflare API and the project's
  OWN attested production domain, verified against a signed size/sha256
  inventory; separately owned, outside the unauthenticated government-ingest
  risk class.
* ``client/snapshot.py`` — authenticated GitHub Releases API with its own
  transport seam and manifest contract; separately owned.
"""

from __future__ import annotations

from collections.abc import Mapping

from populus.ingest import TransportResponse

#: LD10 — the shared decoded-body ceiling for House, Senate GET/POST and SEC.
HTTP_BODY_CAP = 128 * 1024 * 1024


class ResponseTooLarge(RuntimeError):
    """The response body exceeded the configured ceiling (LD10/R9).

    Carries the URL, the configured cap, the declared ``Content-Length`` when
    the server sent one, and the observed lower bound on the decoded size.
    The message never includes body bytes or request headers.
    """

    def __init__(
        self,
        url: str,
        *,
        limit: int,
        declared: int | None,
        observed: int,
    ) -> None:
        declared_text = "absent" if declared is None else str(declared)
        super().__init__(
            f"response too large for {url}: cap {limit} bytes,"
            f" declared Content-Length {declared_text},"
            f" observed at least {observed} bytes"
        )
        self.url = url
        self.limit = limit
        self.declared = declared
        self.observed = observed


def _declared_length(headers: Mapping[str, str]) -> int | None:
    raw = headers.get("content-length")
    if raw is None:
        return None
    try:
        value = int(raw.strip())
    except ValueError:
        return None
    return value if value >= 0 else None


def bounded_http_request(
    method: str,
    url: str,
    *,
    headers: Mapping[str, str],
    data: Mapping[str, str] | None = None,
    limit: int = HTTP_BODY_CAP,
    timeout: float = 60.0,
    transport: object | None = None,
) -> TransportResponse:
    """Perform one bounded HTTP request via httpx; see the module docstring.

    *transport* is a test seam only: an ``httpx.BaseTransport`` (e.g.
    ``httpx.MockTransport``) forwarded to the client so the boundary tests can
    exercise the REAL streaming/counting code with zero sockets. Live callers
    never pass it.
    """
    import httpx

    client_kwargs: dict = {"timeout": timeout, "follow_redirects": False}
    if transport is not None:
        client_kwargs["transport"] = transport
    with httpx.Client(**client_kwargs) as client:
        with client.stream(
            method, url, headers=dict(headers), data=dict(data) if data else None
        ) as response:
            declared = _declared_length(response.headers)
            if declared is not None and declared > limit:
                # Rejected BEFORE any body iteration; the context manager
                # closes the response without reading it.
                raise ResponseTooLarge(
                    url, limit=limit, declared=declared, observed=declared
                )
            chunks: list[bytes] = []
            total = 0
            for chunk in response.iter_bytes():
                total += len(chunk)
                if total > limit:
                    raise ResponseTooLarge(
                        url, limit=limit, declared=declared, observed=total
                    )
                chunks.append(chunk)
            content = b"".join(chunks)
            out_headers = dict(response.headers)
            set_cookies = response.headers.get_list("set-cookie")
            if set_cookies:
                # Header values cannot contain a newline, so newline-joining
                # keeps several cookies from one response distinguishable for
                # the Senate cookie jar (same contract as before).
                out_headers["set-cookie"] = "\n".join(set_cookies)
            return TransportResponse(
                status_code=response.status_code,
                headers=out_headers,
                content=content,
            )
