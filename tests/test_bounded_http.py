"""Bounded HTTP transport boundary tests (RUN PUBLIC-SECURITY-HARDENING, R9/LD10).

Every test drives the REAL httpx streaming/counting code over an
``httpx.MockTransport`` — no socket is opened (the autouse guard would fail
the test if one were). The fake/injected ingest transports are untouched by
the helper and keep their own hermetic suites.
"""

from __future__ import annotations

import httpx
import pytest

from populus.ingest import TransportResponse
from populus.ingest.house import HttpxTransport
from populus.ingest.senate import HttpxSenateTransport, TransportFailure
from populus.net.bounded_http import (
    HTTP_BODY_CAP,
    ResponseTooLarge,
    bounded_http_request,
)
from populus.net.sec_client import HttpxSecTransport

URL = "https://www.example.gov/index.zip"


class _Stream(httpx.SyncByteStream):
    """A canned byte stream that records iteration and close."""

    def __init__(self, chunks):
        self.chunks = list(chunks)
        self.closed = False
        self.iterated = False

    def __iter__(self):
        self.iterated = True
        yield from self.chunks

    def close(self):
        self.closed = True


def _transport_for(status=200, *, chunks=(), headers=()):
    stream = _Stream(chunks)

    def handler(request):
        return httpx.Response(status, headers=list(headers), stream=stream)

    return httpx.MockTransport(handler), stream


# --- helper-level boundaries --------------------------------------------------


def test_exact_boundary_body_is_accepted():
    transport, _stream = _transport_for(chunks=[b"a" * 40, b"b" * 60])
    response = bounded_http_request(
        "GET", URL, headers={}, limit=100, transport=transport
    )
    assert isinstance(response, TransportResponse)
    assert response.status_code == 200
    assert len(response.content) == 100


def test_missing_content_length_still_aborts_at_limit_plus_one():
    # No declared size at all: only the streamed count can stop it.
    transport, stream = _transport_for(chunks=[b"x" * 60, b"y" * 60])
    with pytest.raises(ResponseTooLarge) as excinfo:
        bounded_http_request("GET", URL, headers={}, limit=100, transport=transport)
    err = excinfo.value
    assert err.declared is None
    assert err.observed >= 101
    assert stream.closed, "the response must be closed on abort"


def test_lying_content_length_is_caught_by_the_streamed_count():
    # Declared 10 bytes, actually far more: the count is the authority.
    transport, stream = _transport_for(
        chunks=[b"x" * 90, b"y" * 90], headers=[("content-length", "10")]
    )
    with pytest.raises(ResponseTooLarge) as excinfo:
        bounded_http_request("GET", URL, headers={}, limit=100, transport=transport)
    assert excinfo.value.declared == 10
    assert excinfo.value.observed >= 101
    assert stream.closed


def test_declared_oversize_is_rejected_before_any_iteration():
    transport, stream = _transport_for(
        chunks=[b"never read"], headers=[("content-length", "101")]
    )
    with pytest.raises(ResponseTooLarge) as excinfo:
        bounded_http_request("GET", URL, headers={}, limit=100, transport=transport)
    assert excinfo.value.declared == 101
    assert not stream.iterated, "an oversized declared body must never be read"
    assert stream.closed


def test_chunk_crossing_the_cap_aborts_and_closes():
    transport, stream = _transport_for(chunks=[b"a" * 99, b"b" * 99])
    with pytest.raises(ResponseTooLarge):
        bounded_http_request("GET", URL, headers={}, limit=100, transport=transport)
    assert stream.closed


def test_exception_text_names_the_facts_and_never_the_body():
    transport, _stream = _transport_for(
        chunks=[b"SECRET-BODY-BYTES" * 10], headers=[("content-length", "170")]
    )
    with pytest.raises(ResponseTooLarge) as excinfo:
        bounded_http_request(
            "GET", URL, headers={"X-Auth": "SECRET-HEADER"}, limit=100,
            transport=transport,
        )
    text = str(excinfo.value)
    assert URL in text and "100" in text and "170" in text
    assert "SECRET-BODY-BYTES" not in text
    assert "SECRET-HEADER" not in text


def test_multiple_set_cookie_values_are_preserved_newline_joined():
    headers = [
        ("set-cookie", "csrftoken=abc; Expires=Wed, 21 Oct 2026 07:28:00 GMT"),
        ("set-cookie", "sessionid=sess1; HttpOnly"),
    ]
    transport, _stream = _transport_for(chunks=[b"ok"], headers=headers)
    response = bounded_http_request(
        "GET", URL, headers={}, limit=100, transport=transport
    )
    assert response.headers["set-cookie"].split("\n") == [
        "csrftoken=abc; Expires=Wed, 21 Oct 2026 07:28:00 GMT",
        "sessionid=sess1; HttpOnly",
    ]


def test_redirects_are_not_followed():
    calls = []

    def handler(request):
        calls.append(str(request.url))
        return httpx.Response(302, headers=[("location", "https://evil.example/")])

    response = bounded_http_request(
        "GET", URL, headers={}, limit=100,
        transport=httpx.MockTransport(handler),
    )
    assert response.status_code == 302
    assert calls == [URL]


# --- the three real transports are wired through the cap ----------------------


def _oversize_transport():
    """Declares one byte over the shared 128 MiB cap; body never read."""
    return _transport_for(
        chunks=[b"tiny"], headers=[("content-length", str(HTTP_BODY_CAP + 1))]
    )


def test_house_real_transport_enforces_the_shared_cap():
    transport, stream = _oversize_transport()
    with pytest.raises(ResponseTooLarge):
        HttpxTransport(transport=transport).get(URL, headers={})
    assert not stream.iterated


def test_sec_real_transport_enforces_the_shared_cap():
    transport, stream = _oversize_transport()
    with pytest.raises(ResponseTooLarge):
        HttpxSecTransport(transport=transport).get(URL, headers={})
    assert not stream.iterated


def test_senate_real_get_enforces_the_shared_cap_as_a_named_failure():
    transport, stream = _oversize_transport()
    # ResponseTooLarge must surface AS ITSELF — never be swallowed into the
    # retryable TransportFailure ladder (a too-large body is deterministic).
    with pytest.raises(ResponseTooLarge):
        HttpxSenateTransport(transport=transport).get(URL, headers={})
    assert not stream.iterated


def test_senate_real_post_enforces_the_shared_cap_as_a_named_failure():
    transport, stream = _oversize_transport()
    with pytest.raises(ResponseTooLarge):
        HttpxSenateTransport(transport=transport).post(
            URL, data={"a": "1"}, headers={}
        )
    assert not stream.iterated


def test_senate_transport_failure_mapping_is_unchanged():
    def handler(request):
        raise httpx.ConnectError("boom", request=request)

    with pytest.raises(TransportFailure):
        HttpxSenateTransport(transport=httpx.MockTransport(handler)).get(
            URL, headers={}
        )


def test_real_transports_return_the_shared_response_type_on_success():
    ok = httpx.MockTransport(lambda request: httpx.Response(200, content=b"body"))
    for response in (
        HttpxTransport(transport=ok).get(URL, headers={}),
        HttpxSecTransport(transport=ok).get(URL, headers={}),
        HttpxSenateTransport(transport=ok).get(URL, headers={}),
        HttpxSenateTransport(transport=ok).post(URL, data={"a": "1"}, headers={}),
    ):
        assert isinstance(response, TransportResponse)
        assert response.status_code == 200
        assert response.content == b"body"
