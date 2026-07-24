"""The §11.4 SEC federated client: politeness, coalescing, caching, refusal.

Every test is hermetic — the transport and both clock hooks are injected and
the autouse no-network fixture blocks sockets — so the whole policy surface is
provable without touching SEC. The live provider check that a hermetic test
CANNOT make (does SEC actually accept these bytes?) is the mandatory smoke
command in the plan's Rollout §7.
"""

from __future__ import annotations

import threading
import time
from pathlib import Path

import pytest

from populus.ingest import USER_AGENT as M1_USER_AGENT
from populus.net import ACCEPT_ENCODING, DEFAULT_SEC_CONTACT, TransportResponse
from populus.net import sec_client as sec_client_module
from populus.net.sec_client import (
    BACKOFF_SCHEDULE,
    CIRCUIT_403_THRESHOLD,
    MIN_INTERVAL_S,
    TTL_S,
    HttpxSecTransport,
    SecCircuitOpenError,
    SecClient,
    SecUrlError,
    endpoint_class,
    sec_contact,
    sec_user_agent,
    validate_sec_url,
)

REPO_ROOT = Path(__file__).resolve().parent.parent
BOOTSTRAP_URL = "https://www.sec.gov/files/company_tickers.json"
SUBMISSIONS_URL = "https://data.sec.gov/submissions/CIK0001067983.json"
ARCHIVE_URL = "https://www.sec.gov/Archives/edgar/data/1067983/index.json"


class FakeClock:
    """A monotonic clock that only advances when the client sleeps."""

    def __init__(self) -> None:
        self.now = 1000.0
        self.slept: list[float] = []

    def monotonic(self) -> float:
        return self.now

    def sleep(self, seconds: float) -> None:
        self.slept.append(seconds)
        self.now += seconds

    def advance(self, seconds: float) -> None:
        self.now += seconds


class RecordingTransport:
    """Replays scripted responses and records exactly what was sent."""

    def __init__(self, responses=None, *, default=None) -> None:
        self._responses = list(responses or [])
        self._default = default or TransportResponse(200, {}, b"ok")
        self.sent: list[tuple[str, dict]] = []
        self.lock = threading.Lock()

    def get(self, url: str, *, headers) -> TransportResponse:
        with self.lock:
            self.sent.append((url, dict(headers)))
            if self._responses:
                return self._responses.pop(0)
        return self._default

    @property
    def calls(self) -> int:
        return len(self.sent)


def make_client(transport, clock=None, *, contact=DEFAULT_SEC_CONTACT):
    clock = clock or FakeClock()
    return (
        SecClient(
            transport,
            contact=contact,
            sleep=clock.sleep,
            monotonic=clock.monotonic,
        ),
        clock,
    )


# --- R15: the exact User-Agent bytes ------------------------------------------


def test_the_emitted_user_agent_is_the_pinned_sec_accepted_form():
    # The byte string M2-CONTRACT §1 recorded at HTTP 200 on 2026-07-24.
    assert sec_user_agent(DEFAULT_SEC_CONTACT) == "Populus johnbaekk@gmail.com"
    assert sec_user_agent("ops@example.org") == "Populus ops@example.org"
    # No version segment, no parentheses, no URL.
    assert "(" not in sec_user_agent(DEFAULT_SEC_CONTACT)
    assert "/" not in sec_user_agent(DEFAULT_SEC_CONTACT)


def test_the_parenthesized_m1_user_agent_is_never_sent(tmp_path):
    transport = RecordingTransport()
    client, _clock = make_client(transport)
    client.get(BOOTSTRAP_URL)
    _url, headers = transport.sent[0]
    assert headers["User-Agent"] == "Populus johnbaekk@gmail.com"
    assert headers["User-Agent"] != M1_USER_AGENT
    assert "PopulusBot" not in headers["User-Agent"]
    # And the literal cannot leak in from the source either.
    for name in ("__init__.py", "sec_client.py"):
        source = (REPO_ROOT / "src" / "populus" / "net" / name).read_text(
            encoding="utf-8"
        )
        assert "PopulusBot" not in source


def test_every_request_carries_the_same_ua_and_accept_encoding():
    transport = RecordingTransport()
    client, clock = make_client(transport)
    for url in (BOOTSTRAP_URL, SUBMISSIONS_URL, ARCHIVE_URL):
        client.get(url)
    assert transport.calls == 3
    user_agents = {headers["User-Agent"] for _url, headers in transport.sent}
    assert user_agents == {"Populus johnbaekk@gmail.com"}
    assert all(
        headers["Accept-Encoding"] == ACCEPT_ENCODING
        for _url, headers in transport.sent
    )
    assert ACCEPT_ENCODING == "gzip, deflate"


def test_sec_contact_prefers_the_environment_and_explains_the_fallback():
    contact, warning = sec_contact({"POPULUS_CONTACT": " ops@example.org "})
    assert contact == "ops@example.org"
    assert warning is None

    warned: list[str] = []
    contact, warning = sec_contact({}, warn=warned.append)
    assert contact == DEFAULT_SEC_CONTACT
    assert warning is not None and warned == [warning]
    assert "POPULUS_CONTACT" in warning
    assert "MONITORED" in warning


# --- R5: the rate floor is client-wide and not configurable -------------------


def test_the_rate_floor_applies_across_different_urls():
    # A per-URL lock would let three distinct endpoints go out at once. The
    # floor is CLIENT-wide precisely so it cannot.
    transport = RecordingTransport()
    client, clock = make_client(transport)
    client.get(BOOTSTRAP_URL)
    client.get(SUBMISSIONS_URL)
    client.get(ARCHIVE_URL)
    assert clock.slept == [MIN_INTERVAL_S, MIN_INTERVAL_S]
    assert MIN_INTERVAL_S == 0.5  # <= 2 req/s


def test_elapsed_real_time_counts_against_the_floor():
    transport = RecordingTransport()
    client, clock = make_client(transport)
    client.get(BOOTSTRAP_URL)
    clock.advance(0.2)
    client.get(SUBMISSIONS_URL)
    assert clock.slept == [pytest.approx(0.3)]
    clock.advance(MIN_INTERVAL_S)
    client.get(ARCHIVE_URL)
    assert clock.slept == [pytest.approx(0.3)]  # no extra sleep needed


def test_the_rate_floor_still_spaces_a_retry_after_a_transport_exception():
    # F2 regression: the client-wide minimum interval must cover the NEXT attempt
    # even when a transport call raises. Recording `_last_request` only on success
    # let an immediate timeout's retry fire back-to-back, breaking the floor (G6).
    class ExplodeOnce:
        def __init__(self):
            self.calls = 0

        def get(self, url, *, headers):
            self.calls += 1
            if self.calls == 1:
                raise RuntimeError("immediate timeout")
            return TransportResponse(200, {}, b"ok")

    transport = ExplodeOnce()
    client, clock = make_client(transport)
    with pytest.raises(RuntimeError):
        client.get(BOOTSTRAP_URL)
    # The failed flight moved the rate clock, so the retry waits out the floor
    # instead of firing immediately.
    client.get(BOOTSTRAP_URL)
    assert transport.calls == 2
    assert clock.slept == [MIN_INTERVAL_S]


def test_retry_after_accepts_seconds_and_http_date():
    # QA-F3: both RFC 7231 forms, resolved against an injected UTC reference.
    from datetime import datetime, timezone

    from populus.net.sec_client import _retry_after_seconds

    now = datetime(2026, 7, 24, 12, 0, 0, tzinfo=timezone.utc)
    assert _retry_after_seconds({"Retry-After": "120"}, now) == 120.0
    assert _retry_after_seconds(
        {"Retry-After": "Fri, 24 Jul 2026 12:02:00 GMT"}, now
    ) == 120.0
    # A past HTTP-date is not honoured (never retry earlier than now).
    assert _retry_after_seconds(
        {"Retry-After": "Fri, 24 Jul 2026 11:58:00 GMT"}, now
    ) is None
    assert _retry_after_seconds({"Retry-After": "not-a-date"}, now) is None
    assert _retry_after_seconds({}, now) is None


def test_endpoint_class_normalizes_host_case_but_not_path():
    # QA-F3: the host guard admits SEC hostnames case-insensitively, so endpoint
    # classification (which selects the cache TTL) must too — an upper-case host
    # must not fall through to the short default TTL. Path case is preserved so
    # `/Archives/` still matches.
    from populus.net.sec_client import endpoint_class

    assert endpoint_class("https://www.sec.gov/files/company_tickers.json") == "bootstrap"
    assert endpoint_class("https://WWW.SEC.GOV/files/company_tickers.json") == "bootstrap"
    assert endpoint_class("https://www.sec.gov/Archives/edgar/data/1/x.xml") == "archives"
    assert endpoint_class("https://WWW.SEC.GOV/Archives/edgar/data/1/x.xml") == "archives"


def test_no_politeness_knob_is_exposed(monkeypatch):
    import inspect

    parameters = set(inspect.signature(SecClient.__init__).parameters)
    # `sleep`/`monotonic`/`utcnow` are injected CLOCKS (for hermetic tests), not
    # politeness knobs; no rate/TTL/threshold/backoff configuration is exposed.
    assert parameters == {
        "self", "transport", "contact", "sleep", "monotonic", "utcnow"
    }
    for forbidden in ("rate", "min_interval", "ttl", "threshold", "backoff"):
        assert not any(forbidden in name for name in parameters)


def test_transport_is_required_and_has_no_default():
    import inspect

    parameter = inspect.signature(SecClient.__init__).parameters["transport"]
    assert parameter.default is inspect.Parameter.empty
    assert parameter.kind is inspect.Parameter.POSITIONAL_OR_KEYWORD
    with pytest.raises(TypeError):
        SecClient(contact="x", sleep=lambda _s: None, monotonic=lambda: 0.0)


# --- single flight ------------------------------------------------------------


def _wait_until(predicate, timeout=5.0):
    deadline = time.monotonic() + timeout
    while not predicate() and time.monotonic() < deadline:
        time.sleep(0.005)
    return predicate()


def test_concurrent_callers_for_one_url_share_one_request_even_at_zero_ttl(
    monkeypatch,
):
    # Followers join the flight BEFORE anything is cached, so the TTL is
    # irrelevant to them: eight callers still make one request. A zero TTL is
    # the sharp case — a design that consulted the cache on the follower path
    # would send eight.
    monkeypatch.setitem(TTL_S, "bootstrap", 0)
    release = threading.Event()

    class Blocking:
        def __init__(self):
            self.calls = 0
            self.entered = threading.Event()

        def get(self, url, *, headers):
            self.calls += 1
            self.entered.set()
            release.wait(timeout=5)
            return TransportResponse(200, {}, b"payload")

    transport = Blocking()
    client, _clock = make_client(transport)
    results: dict[int, object] = {}

    def worker(index):
        results[index] = client.get(BOOTSTRAP_URL)

    threads = [threading.Thread(target=worker, args=(index,)) for index in range(8)]
    threads[0].start()
    assert transport.entered.wait(timeout=5)
    for thread in threads[1:]:
        thread.start()
    assert _wait_until(lambda: client.coalesced == 7)
    release.set()
    for thread in threads:
        thread.join(timeout=10)

    assert transport.calls == 1
    assert client.coalesced == 7
    assert {response.content for response in results.values()} == {b"payload"}


def test_a_failing_flight_propagates_to_followers_and_then_retries_cleanly():
    class Failing:
        def __init__(self):
            self.calls = 0
            self.gate = threading.Event()

        def get(self, url, *, headers):
            self.calls += 1
            if self.calls == 1:
                self.gate.wait(timeout=5)
                raise RuntimeError("upstream exploded")
            return TransportResponse(200, {}, b"recovered")

    transport = Failing()
    client, _clock = make_client(transport)

    results: dict[int, object] = {}
    errors: dict[int, BaseException] = {}

    def worker(index):
        try:
            results[index] = client.get(BOOTSTRAP_URL)
        except BaseException as exc:  # noqa: BLE001
            errors[index] = exc

    leader = threading.Thread(target=worker, args=(0,))
    leader.start()
    while client.coalesced == 0 and leader.is_alive():
        follower = threading.Thread(target=worker, args=(1,))
        follower.start()
        follower.join(timeout=0.1)
        if not follower.is_alive():
            break
    transport.gate.set()
    leader.join(timeout=5)

    # The leader raised; every follower saw the SAME exception object.
    assert isinstance(errors[0], RuntimeError)
    assert all(exc is errors[0] for exc in errors.values())
    # The failed flight was removed, never cached: the next call retries.
    assert client.get(BOOTSTRAP_URL).content == b"recovered"


def test_backoff_retries_happen_inside_one_flight():
    transport = RecordingTransport(
        [
            TransportResponse(429, {}, b""),
            TransportResponse(503, {}, b""),
            TransportResponse(200, {}, b"ok"),
        ]
    )
    client, clock = make_client(transport)
    response = client.get(BOOTSTRAP_URL)
    assert response.status_code == 200
    assert transport.calls == 3
    # Retries happen INSIDE the gate, so a second caller cannot interleave; and
    # each backoff already exceeds the spacing floor, so no extra sleep is
    # added on top of it.
    assert clock.slept == [BACKOFF_SCHEDULE[0], BACKOFF_SCHEDULE[1]]


# --- the breaker --------------------------------------------------------------


def test_sustained_403_latches_and_the_latched_client_never_calls_again():
    transport = RecordingTransport(default=TransportResponse(403, {}, b"denied"))
    client, _clock = make_client(transport)
    for _ in range(CIRCUIT_403_THRESHOLD - 1):
        assert client.get(BOOTSTRAP_URL).status_code == 403
    with pytest.raises(SecCircuitOpenError):
        client.get(SUBMISSIONS_URL)
    calls_at_latch = transport.calls
    # Latched: the fast path refuses without a request.
    for url in (BOOTSTRAP_URL, SUBMISSIONS_URL, ARCHIVE_URL):
        with pytest.raises(SecCircuitOpenError):
            client.get(url)
    assert transport.calls == calls_at_latch


def test_a_non_403_resets_the_consecutive_counter():
    transport = RecordingTransport(
        [
            TransportResponse(403, {}, b""),
            TransportResponse(403, {}, b""),
            TransportResponse(200, {}, b"ok"),
            TransportResponse(403, {}, b""),
            TransportResponse(403, {}, b""),
        ]
    )
    client, _clock = make_client(transport)
    for url in (BOOTSTRAP_URL, SUBMISSIONS_URL, ARCHIVE_URL, BOOTSTRAP_URL + "?a"):
        client.get(url)
    # Five responses, two 403s since the reset — still under the threshold.
    assert client.get(BOOTSTRAP_URL + "?b").status_code == 403


def test_a_403_is_never_retried():
    transport = RecordingTransport(default=TransportResponse(403, {}, b""))
    client, clock = make_client(transport)
    assert client.get(BOOTSTRAP_URL).status_code == 403
    assert transport.calls == 1
    assert clock.slept == []


def test_leaders_queued_when_the_breaker_latches_make_zero_transport_calls():
    # The in-gate re-check. Without it, every leader already queued on the gate
    # would still fire — exactly the storm the breaker exists to stop.
    released = threading.Event()
    seen = threading.Event()

    class Blocking:
        def __init__(self):
            self.calls = 0
            self.lock = threading.Lock()

        def get(self, url, *, headers):
            with self.lock:
                self.calls += 1
                mine = self.calls
            if mine == 1:
                seen.set()
                released.wait(timeout=5)
            return TransportResponse(403, {}, b"denied")

    transport = Blocking()
    client, _clock = make_client(transport)
    # Pre-load the breaker so the first in-flight 403 trips it.
    client._consecutive_403 = CIRCUIT_403_THRESHOLD - 1  # noqa: SLF001

    urls = [f"{BOOTSTRAP_URL}?queued={index}" for index in range(5)]
    results: dict[int, BaseException] = {}

    def worker(index, url):
        try:
            client.get(url)
        except BaseException as exc:  # noqa: BLE001
            results[index] = exc

    threads = [
        threading.Thread(target=worker, args=(index, url))
        for index, url in enumerate(urls)
    ]
    threads[0].start()
    assert seen.wait(timeout=5)
    for thread in threads[1:]:
        thread.start()
    # Give the queued leaders time to reach the gate.
    threading.Event().wait(0.1)
    released.set()
    for thread in threads:
        thread.join(timeout=10)

    assert transport.calls == 1  # only the leader that latched it
    assert len(results) == 5
    assert all(isinstance(exc, SecCircuitOpenError) for exc in results.values())


# --- the ETag-aware cache -----------------------------------------------------


def test_a_fresh_entry_is_served_without_a_request():
    transport = RecordingTransport(default=TransportResponse(200, {}, b"payload"))
    client, _clock = make_client(transport)
    first = client.get(BOOTSTRAP_URL)
    second = client.get(BOOTSTRAP_URL)
    assert transport.calls == 1
    assert first.from_cache is False
    assert second.from_cache is True
    assert second.content == b"payload"
    assert client.cache_hits == 1


def test_a_stale_entry_revalidates_with_the_etag_and_a_304_serves_the_cache():
    transport = RecordingTransport(
        [
            TransportResponse(200, {"ETag": '"v1"'}, b"payload"),
            TransportResponse(304, {}, b""),
        ]
    )
    client, clock = make_client(transport)
    client.get(BOOTSTRAP_URL)
    clock.advance(TTL_S["bootstrap"] + 1)
    revalidated = client.get(BOOTSTRAP_URL)
    assert transport.sent[1][1]["If-None-Match"] == '"v1"'
    assert revalidated.status_code == 200
    assert revalidated.content == b"payload"
    assert revalidated.revalidated is True
    # The refreshed entry is fresh again.
    assert client.get(BOOTSTRAP_URL).from_cache is True
    assert transport.calls == 2


def test_a_200_replaces_the_cached_body():
    transport = RecordingTransport(
        [
            TransportResponse(200, {"ETag": '"v1"'}, b"old"),
            TransportResponse(200, {"ETag": '"v2"'}, b"new"),
        ]
    )
    client, clock = make_client(transport)
    client.get(BOOTSTRAP_URL)
    clock.advance(TTL_S["bootstrap"] + 1)
    assert client.get(BOOTSTRAP_URL).content == b"new"
    assert client.get(BOOTSTRAP_URL).content == b"new"
    assert transport.calls == 2


def test_a_non_200_is_never_cached():
    transport = RecordingTransport(
        [TransportResponse(404, {}, b""), TransportResponse(200, {}, b"ok")]
    )
    client, _clock = make_client(transport)
    assert client.get(BOOTSTRAP_URL).status_code == 404
    assert client.get(BOOTSTRAP_URL).status_code == 200
    assert transport.calls == 2


@pytest.mark.parametrize(
    "url,expected",
    [
        (SUBMISSIONS_URL, "submissions"),
        (ARCHIVE_URL, "archives"),
        (BOOTSTRAP_URL, "bootstrap"),
        ("https://www.sec.gov/cgi-bin/browse-edgar", "default"),
        ("https://data.sec.gov/api/xbrl/frames/x.json", "default"),
    ],
)
def test_endpoint_class_is_a_pure_prefix_match(url, expected):
    assert endpoint_class(url) == expected


def test_every_endpoint_class_has_a_ttl():
    classes = {
        endpoint_class(url)
        for url in (SUBMISSIONS_URL, ARCHIVE_URL, BOOTSTRAP_URL, "https://x.sec.gov/a")
    }
    assert classes <= set(TTL_S)
    assert set(TTL_S) == {"submissions", "archives", "bootstrap", "default"}
    assert TTL_S["archives"] >= TTL_S["submissions"] >= TTL_S["default"]


# --- backoff details ----------------------------------------------------------


def test_retry_after_is_honoured_only_when_longer_than_our_own_backoff():
    transport = RecordingTransport(
        [
            TransportResponse(429, {"Retry-After": "30"}, b""),
            TransportResponse(429, {"Retry-After": "0.1"}, b""),
            TransportResponse(200, {}, b"ok"),
        ]
    )
    client, clock = make_client(transport)
    client.get(BOOTSTRAP_URL)
    backoffs = [delay for delay in clock.slept if delay not in (MIN_INTERVAL_S,)]
    assert backoffs == [30.0, BACKOFF_SCHEDULE[1]]


def test_exhausting_the_schedule_returns_the_last_response_rather_than_escalating():
    transport = RecordingTransport(default=TransportResponse(503, {}, b"down"))
    client, clock = make_client(transport)
    response = client.get(BOOTSTRAP_URL)
    assert response.status_code == 503
    assert transport.calls == len(BACKOFF_SCHEDULE) + 1
    assert [d for d in clock.slept if d in BACKOFF_SCHEDULE] == list(BACKOFF_SCHEDULE)


# --- the host guard -----------------------------------------------------------


@pytest.mark.parametrize(
    "url",
    [
        "http://www.sec.gov/files/x.json",
        "https://evil.example/files/x.json",
        "https://www.sec.gov.evil.example/x",
        "https://www.sec.gov@evil.example/x",
        "https://notsec.gov/x",
        "https://.sec.gov/x",
        "https://www.sec.gov:8443/x",
        "ftp://www.sec.gov/x",
        "https:///x",
    ],
)
def test_the_host_guard_refuses_before_any_request(url):
    transport = RecordingTransport()
    client, _clock = make_client(transport)
    with pytest.raises(SecUrlError):
        client.get(url)
    assert transport.calls == 0


@pytest.mark.parametrize(
    "url",
    [
        BOOTSTRAP_URL,
        SUBMISSIONS_URL,
        "https://WWW.SEC.GOV/files/x.json",
        "https://efts.sec.gov/LATEST/search-index?q=x",
    ],
)
def test_the_host_guard_admits_sec_endpoints(url):
    assert validate_sec_url(url).endswith("sec.gov")


def test_the_real_transport_holds_no_persistent_client():
    # A persistent pooled client would need an explicit close, and nothing here
    # has a lifecycle to close it in.
    transport = HttpxSecTransport()
    assert vars(transport) == {}
    assert "httpx" not in dir(sec_client_module)
