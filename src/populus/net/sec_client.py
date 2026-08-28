"""The conservative SEC federated client (ARCHITECTURE.md §11.4).

One of the modules allowed to import the sanctioned HTTP client. Everything
that decides *whether and when* a request goes out lives here, in code, with no
configuration seam (G6): the request-rate floor, the backoff schedule, the
circuit-breaker threshold and the per-endpoint-class cache TTLs are module
constants, and the constructor takes no knob for any of them.

Concurrency — two independent mechanisms, in a fixed lock order:

``_gate``   CLIENT-WIDE. Serializes spacing and every transport call, so the
            floor applies ACROSS different URLs. A ten-thread fan-out over ten
            distinct endpoints is still spaced; a per-URL lock would not be.
``_state``  Guards the in-flight map, the response cache and the breaker
            counters. Held only for short non-I/O sections — never across a
            wait and never during a request.

Order is always ``_gate`` then (briefly) ``_state``; ``_state`` is never held
while acquiring ``_gate``, so the two cannot deadlock.

Single flight: concurrent callers for one URL elect a leader and the rest wait.
Followers receive the leader's response **or its exception**, irrespective of
cache TTL — they joined before anything was cached, so a zero TTL still yields
one request rather than N. Failed flights are removed and never cached, so the
next caller retries cleanly.

The breaker is checked twice on purpose: once on the fast path, and again
inside the gate immediately before the transport call. Without the second
check, N leaders queued on the gate when the breaker latches would each still
send a request — precisely the retry storm the breaker exists to prevent.

Library code never reads the wall clock: ``sleep`` and ``monotonic`` are
injected, so every behaviour here is provable offline with no live network.
"""

from __future__ import annotations

import threading
from collections.abc import Callable, Mapping
from dataclasses import dataclass, field
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from typing import Protocol

from populus.net import (
    ACCEPT_ENCODING,
    DEFAULT_SEC_CONTACT,
    SEC_APP_NAME,
    SEC_CONTACT_ENV,
    SEC_HOST_SUFFIX,
    SEC_HOSTS,
    TransportResponse,
)

# --- politeness policy: in code, never config (G6) ----------------------------

#: <= 2 req/s, client-wide. SEC publishes this ceiling; Populus sits at it
#: rather than probing it.
MIN_INTERVAL_S = 0.5

#: Exponential backoff on 429 and 5xx. Exhausting it returns the last response
#: rather than escalating — a slow SEC is not something to push harder on.
BACKOFF_SCHEDULE = (1.0, 2.0, 4.0, 8.0)

#: Consecutive 403s that latch the breaker. A 403 is never retried and the UA
#: is never varied: sustained refusal means stop and diagnose, not rotate.
CIRCUIT_403_THRESHOLD = 3

#: Response-cache lifetime by endpoint class. Filing archives are immutable
#: once published; a filer's submission history changes at most daily.
TTL_S = {
    "submissions": 3600,
    "archives": 86400,
    "bootstrap": 86400,
    "default": 900,
}

_ENDPOINT_PREFIXES = (
    ("https://data.sec.gov/submissions/", "submissions"),
    ("https://www.sec.gov/Archives/", "archives"),
    ("https://www.sec.gov/files/", "bootstrap"),
)


def _lower_authority(url: str) -> str:
    """Lower-case scheme+authority only, preserving path case (string ops only —
    the stdlib URL-parsing module is banned repo-wide).

    The host guard admits SEC hostnames case-insensitively, so the endpoint-class
    match must too, or an admitted upper-case host (`https://WWW.SEC.GOV/files/…`)
    falls through to the short default TTL and revalidates needlessly. (QA-F3)
    """
    idx = url.find("://")
    if idx == -1:
        return url.lower()
    after = idx + 3
    slash = url.find("/", after)
    if slash == -1:
        return url.lower()
    return url[:slash].lower() + url[slash:]


def endpoint_class(url: str) -> str:
    """The cache class of *url* — a prefix match on a host-normalized URL."""
    normalized = _lower_authority(url)
    for prefix, name in _ENDPOINT_PREFIXES:
        if normalized.startswith(prefix):
            return name
    return "default"


def sec_user_agent(contact: str) -> str:
    """The exact SEC-accepted User-Agent byte string.

    ``"Populus johnbaekk@gmail.com"`` with the default contact — verified
    2026-07-24 to return 200 where the parenthesized M1 form returns 403
    (M2-CONTRACT §1). No version segment, no parentheses, no URL.
    """
    return f"{SEC_APP_NAME} {contact}"


def sec_contact(
    environ: Mapping[str, str] | None = None,
    *,
    warn: Callable[[str], None] | None = None,
) -> tuple[str, str | None]:
    """``(contact, warning)`` — pure; the caller decides how to emit the warning.

    Returns the configured contact address and, when the operator has not set
    one, the warning explaining why it matters. Optionally routes that warning
    through an injected callable so a startup path can emit it without
    reaching for a logger of its own.
    """
    if environ is None:
        import os

        environ = os.environ
    configured = (environ.get(SEC_CONTACT_ENV) or "").strip()
    if configured:
        return (configured, None)
    warning = (
        f"{SEC_CONTACT_ENV} is not set: SEC fair access asks every automated"
        f" client to identify itself with a MONITORED contact address, so it can"
        f" reach an operator instead of blocking the traffic. Falling back to"
        f" {DEFAULT_SEC_CONTACT!r}; set {SEC_CONTACT_ENV} to your own address."
    )
    if warn is not None:
        warn(warning)
    return (DEFAULT_SEC_CONTACT, warning)


# --- transport ----------------------------------------------------------------


class SecTransport(Protocol):
    def get(self, url: str, *, headers: Mapping[str, str]) -> TransportResponse: ...


class HttpxSecTransport:
    """The real HTTP client; constructed only by a live caller, never by default.

    Uses the module-level per-call helper rather than holding a client object:
    a persistent client owns a connection pool that must be closed explicitly,
    and nothing here has a lifecycle to close it in.
    """

    def __init__(self, *, transport: object | None = None) -> None:
        # *transport* is a hermetic test seam (httpx.MockTransport);
        # the live path constructs with no arguments.
        self._transport = transport

    def get(self, url: str, *, headers: Mapping[str, str]) -> TransportResponse:
        # R9/LD10: the shared bounded helper streams and counts decoded bytes;
        # a body over the 128 MiB ceiling raises ResponseTooLarge (named
        # failure) instead of buffering without limit. Redirects stay disabled.
        from populus.net.bounded_http import bounded_http_request

        return bounded_http_request(
            "GET", url, headers=headers, transport=self._transport
        )


class SecCircuitOpenError(RuntimeError):
    """Sustained 403: the breaker latched. Stop the job; never retry harder."""

    def __init__(self, url: str) -> None:
        super().__init__(
            f"SEC circuit open: {CIRCUIT_403_THRESHOLD} consecutive 403s;"
            f" last at {url}. Diagnose the request shape (User-Agent, rate,"
            f" endpoint) — do not retry, rotate the UA, or change source address."
        )
        self.url = url


class SecUrlError(ValueError):
    """The URL is not an https SEC endpoint this client may talk to."""


@dataclass(frozen=True)
class SecResponse:
    url: str
    status_code: int
    headers: Mapping[str, str]
    content: bytes
    #: Served from the in-memory cache without contacting SEC.
    from_cache: bool = False
    #: Served from cache after SEC confirmed it with a 304.
    revalidated: bool = False


@dataclass
class _CacheEntry:
    response: SecResponse
    etag: str | None
    stored_at: float


@dataclass
class _Flight:
    event: threading.Event = field(default_factory=threading.Event)
    result: SecResponse | None = None
    error: BaseException | None = None


def _header(headers: Mapping[str, str], name: str) -> str | None:
    lowered = name.lower()
    for key, value in headers.items():
        if key.lower() == lowered:
            return value
    return None


def validate_sec_url(url: str) -> str:
    """Prove *url* is an https URL on an SEC host; return its lower-cased host.

    Plain string work on purpose — the stdlib URL-parsing package is banned
    repo-wide by the dependency guard, and the checking here is deliberately
    stricter than a general parser would be: userinfo
    (``https://www.sec.gov@evil.example/``) and an explicit port are refused
    outright rather than interpreted.
    """
    if not url.startswith("https://"):
        raise SecUrlError(f"refusing {url!r}: only https SEC endpoints are allowed")
    remainder = url[len("https://") :]
    for separator in ("/", "?", "#"):
        position = remainder.find(separator)
        if position != -1:
            remainder = remainder[:position]
    if not remainder:
        raise SecUrlError(f"refusing {url!r}: no host")
    if "@" in remainder:
        raise SecUrlError(
            f"refusing {url!r}: userinfo in the authority — the real host is"
            " whatever follows '@', which is not what this URL appears to say"
        )
    if ":" in remainder:
        raise SecUrlError(f"refusing {url!r}: an explicit port is not allowed")
    host = remainder.lower()
    if host in SEC_HOSTS:
        return host
    if host.endswith(SEC_HOST_SUFFIX) and len(host) > len(SEC_HOST_SUFFIX):
        return host
    raise SecUrlError(f"refusing {url!r}: {host!r} is not an SEC host")


class SecClient:
    """Rate-floored, single-flight, ETag-caching, breaker-guarded SEC client.

    *transport* is required and positional: there is no default, so a test can
    never accidentally reach the live network and a caller must state which
    transport it is using.
    """

    def __init__(
        self,
        transport: SecTransport,
        *,
        contact: str,
        sleep: Callable[[float], None],
        monotonic: Callable[[], float],
        utcnow: Callable[[], datetime] | None = None,
    ) -> None:
        self._transport = transport
        self._user_agent = sec_user_agent(contact)
        self._sleep = sleep
        self._monotonic = monotonic
        # Wall-clock UTC, injectable for tests — needed ONLY to resolve an
        # HTTP-date `Retry-After` (an absolute instant) to a delay. Defaults to
        # the real UTC clock; the rest of the client stays wall-clock-free.
        self._utcnow = utcnow or (lambda: datetime.now(timezone.utc))
        self._gate = threading.Lock()
        self._state = threading.Lock()
        self._flights: dict[str, _Flight] = {}
        self._cache: dict[str, _CacheEntry] = {}
        self._consecutive_403 = 0
        self._latched: str | None = None
        self._last_request: float | None = None  # owned by _gate
        self.coalesced = 0
        self.cache_hits = 0

    @property
    def user_agent(self) -> str:
        return self._user_agent

    def get(self, url: str) -> SecResponse:
        """Fetch *url*, honouring every §11.4 condition."""
        with self._state:
            if self._latched is not None:
                raise SecCircuitOpenError(self._latched)
        validate_sec_url(url)

        leader = False
        with self._state:
            if self._latched is not None:
                raise SecCircuitOpenError(self._latched)
            entry = self._cache.get(url)
            if entry is not None and self._fresh(entry, url):
                self.cache_hits += 1
                return SecResponse(
                    url=entry.response.url,
                    status_code=entry.response.status_code,
                    headers=entry.response.headers,
                    content=entry.response.content,
                    from_cache=True,
                )
            flight = self._flights.get(url)
            if flight is None:
                flight = _Flight()
                self._flights[url] = flight
                leader = True
            else:
                self.coalesced += 1

        if not leader:
            # Followers share the leader's outcome whatever the TTL is: they
            # joined before anything was stored, so a zero TTL still means one
            # request, and a failure propagates instead of becoming N failures.
            flight.event.wait()
            if flight.error is not None:
                raise flight.error
            assert flight.result is not None  # set together with the event
            return flight.result

        try:
            with self._gate:
                with self._state:
                    latched = self._latched
                if latched is not None:
                    # The breaker opened while this leader queued on the gate.
                    # Make ZERO transport calls.
                    raise SecCircuitOpenError(latched)
                response = self._perform(url)
        except BaseException as exc:
            with self._state:
                flight.error = exc
                self._flights.pop(url, None)
            flight.event.set()
            raise
        with self._state:
            if response.status_code == 200 and not response.from_cache:
                self._cache[url] = _CacheEntry(
                    response=response,
                    etag=_header(response.headers, "etag"),
                    stored_at=self._monotonic(),
                )
            elif response.revalidated:
                cached = self._cache.get(url)
                if cached is not None:
                    cached.stored_at = self._monotonic()
            flight.result = response
            self._flights.pop(url, None)
        flight.event.set()
        return response

    # --- internals (all called with _gate held, except _fresh) ----------------

    def _fresh(self, entry: _CacheEntry, url: str) -> bool:
        ttl = TTL_S.get(endpoint_class(url), TTL_S["default"])
        return self._monotonic() - entry.stored_at < ttl

    def _space(self) -> None:
        if self._last_request is None:
            return
        elapsed = self._monotonic() - self._last_request
        if elapsed < MIN_INTERVAL_S:
            self._sleep(MIN_INTERVAL_S - elapsed)

    def _perform(self, url: str) -> SecResponse:
        delays = iter(BACKOFF_SCHEDULE)
        while True:
            with self._state:
                entry = self._cache.get(url)
            headers = {
                "User-Agent": self._user_agent,
                "Accept-Encoding": ACCEPT_ENCODING,
            }
            if entry is not None and entry.etag:
                headers["If-None-Match"] = entry.etag
            self._space()
            # Record the attempt BEFORE the transport call: the client-wide rate
            # floor must still space the NEXT attempt even if this call raises
            # (an immediate timeout/exception must never let a retry skip the
            # 0.5 s floor). Recording it only on success (the old behavior) let a
            # failed flight's retry fire with no spacing. (G6)
            self._last_request = self._monotonic()
            response = self._transport.get(url, headers=headers)
            status = response.status_code

            if status == 403:
                with self._state:
                    self._consecutive_403 += 1
                    if self._consecutive_403 >= CIRCUIT_403_THRESHOLD:
                        self._latched = url
                        raise SecCircuitOpenError(url)
                # Below the threshold the 403 is surfaced, never retried.
                return self._to_response(url, response)
            with self._state:
                self._consecutive_403 = 0

            if status == 429 or 500 <= status <= 599:
                delay = next(delays, None)
                if delay is None:
                    return self._to_response(url, response)
                retry_after = _retry_after_seconds(response.headers, self._utcnow())
                if retry_after is not None and retry_after > delay:
                    delay = retry_after
                self._sleep(delay)
                continue

            if status == 304 and entry is not None:
                return SecResponse(
                    url=url,
                    status_code=entry.response.status_code,
                    headers=entry.response.headers,
                    content=entry.response.content,
                    from_cache=True,
                    revalidated=True,
                )
            return self._to_response(url, response)

    @staticmethod
    def _to_response(url: str, response: TransportResponse) -> SecResponse:
        return SecResponse(
            url=url,
            status_code=response.status_code,
            headers=dict(response.headers),
            content=response.content,
        )


def _retry_after_seconds(
    headers: Mapping[str, str], now_utc: datetime
) -> float | None:
    """``Retry-After`` in seconds, honoured only when LONGER than our backoff.

    Accepts BOTH RFC 7231 forms (QA-F3): delay-seconds, or an HTTP-date resolved
    against ``now_utc`` (an injected UTC reference, so this stays deterministic
    and testable). A past-dated or malformed value yields ``None``.
    """
    raw = _header(headers, "retry-after")
    if raw is None:
        return None
    raw = raw.strip()
    try:
        seconds = float(raw)
        return seconds if seconds >= 0 else None
    except ValueError:
        pass
    try:
        when = parsedate_to_datetime(raw)
    except (TypeError, ValueError):
        return None
    if when is None:
        return None
    if when.tzinfo is None:  # RFC 7231 HTTP-dates are GMT/UTC
        when = when.replace(tzinfo=timezone.utc)
    seconds = (when - now_utc).total_seconds()
    return seconds if seconds >= 0 else None
