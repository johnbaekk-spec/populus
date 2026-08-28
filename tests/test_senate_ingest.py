"""Senate ingest orchestration: handshake, politeness floors, circuit
breaker, statuses, kind conversion, amendments, reconciliation, reparse,
CLI, and the cached-corpus acceptance (RUN 3; R1–R5, R7–R18).

All live-path behavior is exercised through an injected fake transport and
fake clock — the autouse socket guard proves nothing escapes to the
network. The cached-corpus acceptance auto-skips when ``data-cache/`` is
absent, and derives its expected per-status counts from the index itself
(never hardcoded blindly).
"""

from __future__ import annotations

import hashlib
import itertools
import json
import re
from collections import Counter
from pathlib import Path

import pytest
from click.testing import CliRunner

from populus.cli import main as cli_main
from populus.db import connect, init_db
from populus.ingest import TransportResponse, USER_AGENT, UnsafeArchivePathError
from populus.ingest import senate
from populus.ingest.house import ReparseSelector, select_reparse_targets
from populus.ingest.senate import (
    BACKOFF_SCHEDULE,
    CIRCUIT_403_THRESHOLD,
    DATA_URL,
    HOME_URL,
    MIN_SPACING_S,
    PAGE_LENGTH,
    discover,
    reparse_senate,
    run_senate_ingest,
)
from populus.parse.senate_ptr import EXPECTED_HEADER, PARSER_VERSION

FIXTURES = Path(__file__).parent / "fixtures" / "senate"
DATA_CACHE = Path(__file__).resolve().parent.parent / "data-cache" / "senate"

EFILE_1ROW = (FIXTURES / "ptr_40fbe259-f282-4982-a53f-1c7278d041cd.html").read_bytes()
EFILE_BOND = (FIXTURES / "ptr_a5fdbba4-9c67-4002-b931-1cd910ce590d.html").read_bytes()
PAPER = (FIXTURES / "paper_3a4c5095-028a-4614-a692-836719da4e63.html").read_bytes()


def _u(n: int) -> str:
    """A structurally valid, distinct test UUID."""
    return f"00000000-0000-4000-8000-{n:012d}"


U1, U2, U3, U4, U5, U6 = (_u(n) for n in range(1, 7))


def _doc_url(kind: str, uuid: str) -> str:
    return senate.DOC_URL_TEMPLATE.format(kind=kind, uuid=uuid)


# --- fakes -------------------------------------------------------------------


def _resp(status=200, content=b"", headers=None) -> TransportResponse:
    return TransportResponse(
        status_code=status, headers=dict(headers or {}), content=content
    )


HOME_HTML = (
    b"<html><body><form>"
    b'<input type="hidden" name="csrfmiddlewaretoken" value="tok123">'
    b"</form></body></html>"
)


class FakeSenateTransport:
    """(method, URL) -> queued responses; the last repeats. Records calls."""

    def __init__(self):
        self.routes: dict[tuple[str, str], list[TransportResponse]] = {}
        self.calls: list[tuple[str, str, dict, dict | None]] = []

    def route(self, method, url, *responses):
        self.routes[(method, url)] = list(responses)

    def _serve(self, method, url, headers, data):
        self.calls.append(
            (method, url, dict(headers), dict(data) if data is not None else None)
        )
        queue = self.routes[(method, url)]
        return queue.pop(0) if len(queue) > 1 else queue[0]

    def get(self, url, *, headers):
        return self._serve("GET", url, headers, None)

    def post(self, url, *, data, headers):
        return self._serve("POST", url, headers, data)

    def urls(self, method=None):
        return [u for m, u, _h, _d in self.calls if method is None or m == method]


class FakeClock:
    def __init__(self):
        self.now = 0.0
        self.sleeps: list[float] = []

    def monotonic(self) -> float:
        return self.now

    def sleep(self, seconds: float) -> None:
        self.sleeps.append(round(seconds, 6))
        self.now += seconds


def _now_factory():
    counter = itertools.count()
    return lambda: f"2026-07-22T00:00:{next(counter) % 60:02d}Z"


# --- index builders ----------------------------------------------------------


def _index_row(
    uuid,
    *,
    kind="ptr",
    first="Jane",
    last="Doe",
    office=None,
    title_date="07/02/2026",
    amendment=False,
    filed="07/02/2026",
    link=None,
):
    title = f"Periodic Transaction Report for {title_date}"
    if amendment:
        title += " (Amendment 1)"
    if link is None:
        link = (
            f'<a href="/search/view/{kind}/{uuid}/" target="_blank">{title}</a>'
        )
    if office is None:
        office = f"{last}, {first} (Senator)"
    return [first, last, office, link, filed]


def _index_json(rows, *, total=None) -> bytes:
    count = total if total is not None else len(rows)
    return json.dumps(
        {
            "draw": 0,
            "recordsTotal": count,
            "recordsFiltered": count,
            "data": rows,
            "result": "ok",
        }
    ).encode("utf-8")


def _route_handshake(transport, index_rows=None, *, agreement_status=302):
    transport.route(
        "GET", HOME_URL, _resp(200, HOME_HTML, {"Set-Cookie": "csrftoken=abc; Path=/"})
    )
    transport.route(
        "POST",
        HOME_URL,
        _resp(
            agreement_status,
            b"",
            {"Set-Cookie": "sessionid=sess1; Path=/", "Location": "/search/"},
        ),
    )
    if index_rows is not None:
        transport.route("POST", DATA_URL, _resp(200, _index_json(index_rows)))


def _make_cache(tmp_path, rows, pages) -> Path:
    cache = tmp_path / "cache"
    (cache / "pages").mkdir(parents=True, exist_ok=True)
    (cache / "ptr-index.json").write_bytes(_index_json(rows))
    for filename, data in pages.items():
        (cache / "pages" / filename).write_bytes(data)
    return cache


# --- synthetic e-file pages (partial-status cases) ---------------------------

ROW_OK = (
    "<tr><td>1</td><td>06/29/2026</td><td>Self</td><td>T</td>"
    "<td>AT&amp;T Inc.</td><td>Stock</td><td>Purchase</td>"
    "<td>$1,001 - $15,000</td><td>--</td></tr>"
)
ROW_BAD_NUMBER = ROW_OK.replace("<td>1</td>", "<td>x</td>", 1)


def _synthetic_page(rows_html: str, declared: str | None) -> bytes:
    header = "".join(f'<th scope="col">{h}</th>' for h in EXPECTED_HEADER)
    declared_html = f"<ul><li>{declared}</li></ul>" if declared else ""
    return (
        '<html><head><meta charset="utf-8"></head><body>'
        f'<section class="card"><div class="card-body">{declared_html}'
        f"<table><thead><tr>{header}</tr></thead><tbody>{rows_html}</tbody></table>"
        "</div></section></body></html>"
    ).encode("utf-8")


# --- run helpers -------------------------------------------------------------


def _run_live(conn, transport, clock, *, raw_root, run_id="run-test-1", jitter=None):
    return run_senate_ingest(
        conn,
        raw_root=raw_root,
        run_id=run_id,
        now=_now_factory(),
        host="testhost",
        transport=transport,
        sleep=clock.sleep,
        monotonic=clock.monotonic,
        jitter=jitter if jitter is not None else (lambda: 0.0),
    )


def _run_cache(conn, cache, *, run_id="run-test-1"):
    return run_senate_ingest(
        conn,
        raw_root=cache,
        cache_dir=cache,
        run_id=run_id,
        now=_now_factory(),
        host="testhost",
    )


def _filing(conn, uuid):
    return conn.execute(
        "SELECT parse_status, raw_path, response_hash, row_count, doc_url,"
        " filer_name_raw, filed_date, filing_kind, supersedes, lifecycle"
        " FROM filings WHERE filing_id = ?",
        (f"senate:{uuid}",),
    ).fetchone()


def _audit_row(conn, run_id="run-test-1"):
    return conn.execute(
        "SELECT status, finished_at, new_filings, rows_loaded, parse_failures,"
        " job, host FROM ingest_runs WHERE run_id = ?",
        (run_id,),
    ).fetchone()


def _row_flags(conn, uuid):
    return [
        json.loads(flags)
        for (flags,) in conn.execute(
            "SELECT flags FROM transactions WHERE filing_id = ? ORDER BY row_ordinal",
            (f"senate:{uuid}",),
        )
    ]


# --- the real httpx adapter (R4) ---------------------------------------------
#
# The production transport is otherwise never executed: every other test
# injects a fake, so redirect-following, an accidental client-side cookie
# store, or a broken multi-Set-Cookie conversion could regress with the whole
# suite green. These tests drive HttpxSenateTransport itself over an
# httpx.MockTransport, so the REAL bounded streaming path executes with no
# socket opened (the autouse guard would fail the test if one were).


class _RecordedMock:
    """An httpx.MockTransport that records requests and serves canned responses.

    *responses* maps ``(method, url)`` to an ``httpx.Response`` factory; a
    single-response recorder answers everything with that response.
    """

    def __init__(self, response=None, responses=None):
        import httpx

        self.calls = []

        def handler(request):
            self.calls.append(request)
            if responses is not None:
                return responses[(request.method, str(request.url))]()
            return response()

        self.transport = httpx.MockTransport(handler)


def _httpx_response(status=200, headers=None, content=b""):
    import httpx

    return lambda: httpx.Response(status, headers=headers or [], content=content)


def test_real_transport_get_is_stateless_and_never_follows_redirects():
    recorder = _RecordedMock(
        _httpx_response(302, [("location", "/search/"), ("set-cookie", "s=1")])
    )
    transport = senate.HttpxSenateTransport(transport=recorder.transport)
    response = transport.get(senate.HOME_URL, headers={"User-Agent": USER_AGENT})

    # The 302 is returned as-is for the caller to judge (LD13), not chased:
    # exactly one request left the adapter.
    (request,) = recorder.calls
    assert (request.method, str(request.url)) == ("GET", senate.HOME_URL)
    assert request.headers["User-Agent"] == USER_AGENT
    assert response.status_code == 302
    assert response.headers["location"] == "/search/"

    # Stateless (LD13): the Set-Cookie from the first response is NOT replayed
    # by the adapter on a second request — the library jar owns session state.
    transport.get(senate.HOME_URL, headers={"User-Agent": USER_AGENT})
    assert "cookie" not in recorder.calls[1].headers


def test_real_transport_post_forwards_form_data_and_headers():
    recorder = _RecordedMock(_httpx_response(302))
    transport = senate.HttpxSenateTransport(transport=recorder.transport)
    response = transport.post(
        senate.HOME_URL,
        data={"csrfmiddlewaretoken": "tok123", "prohibition_agreement": "1"},
        headers={"Referer": senate.HOME_URL, "Cookie": "csrftoken=abc"},
    )
    (request,) = recorder.calls
    assert (request.method, str(request.url)) == ("POST", senate.HOME_URL)
    assert request.headers["content-type"] == "application/x-www-form-urlencoded"
    assert (
        request.read() == b"csrfmiddlewaretoken=tok123&prohibition_agreement=1"
    )
    assert request.headers["Referer"] == senate.HOME_URL
    assert request.headers["Cookie"] == "csrftoken=abc"
    assert response.status_code == 302


def test_real_transport_preserves_every_set_cookie_value():
    # httpx collapses repeated headers when dict()-ed: two Set-Cookie values
    # become one comma-joined string, and cookie attributes legitimately
    # contain commas ("Expires=Wed, 21 Oct 2026 ..."), so splitting that back
    # apart is impossible. The adapter must carry each value separately.
    raw = [
        ("set-cookie", "csrftoken=abc; Expires=Wed, 21 Oct 2026 07:28:00 GMT; Path=/"),
        ("set-cookie", "sessionid=sess1; Path=/; HttpOnly"),
        ("content-type", "text/html"),
    ]
    recorder = _RecordedMock(_httpx_response(200, raw, b"<html></html>"))
    response = senate.HttpxSenateTransport(transport=recorder.transport).get(
        senate.HOME_URL, headers={}
    )

    values = response.headers["set-cookie"].split("\n")
    assert values == [
        "csrftoken=abc; Expires=Wed, 21 Oct 2026 07:28:00 GMT; Path=/",
        "sessionid=sess1; Path=/; HttpOnly",
    ]
    assert response.headers["content-type"] == "text/html"
    assert response.content == b"<html></html>"

    # End-to-end contract: the library jar recovers BOTH cookies from it.
    jar = senate._CookieJar()
    jar.absorb(response.headers)
    header = jar.header()
    assert "csrftoken=abc" in header
    assert "sessionid=sess1" in header
    assert "Expires" not in header  # attributes are not replayed as cookies


def test_real_transport_drives_the_full_handshake(tmp_path):
    # The production adapter wired into the real session: handshake, cookie
    # replay, and index parsing all run through HttpxSenateTransport.
    responses = {
        ("GET", HOME_URL): _httpx_response(
            200, [("set-cookie", "csrftoken=abc; Path=/")], HOME_HTML
        ),
        ("POST", HOME_URL): _httpx_response(
            302, [("set-cookie", "sessionid=sess1; Path=/"), ("location", "/search/")]
        ),
        ("POST", DATA_URL): _httpx_response(
            200, [], _index_json([_index_row(U1)])
        ),
    }
    recorder = _RecordedMock(responses=responses)
    seen = recorder.calls

    clock = FakeClock()
    session = senate._PoliteSession(
        senate.HttpxSenateTransport(transport=recorder.transport),
        sleep=clock.sleep,
        monotonic=clock.monotonic,
        jitter=lambda: 0.0,
    )
    result = discover(
        raw_root=tmp_path / "raw",
        session=session,
        submitted_start_date="01/01/2012",
    )
    assert result.failed is False
    assert result.uuids == (U1,)
    # Cookies captured from the real adapter's responses were replayed.
    assert "csrftoken=abc" in seen[1].headers["Cookie"]
    index_cookie = seen[2].headers["Cookie"]
    assert "csrftoken=abc" in index_cookie and "sessionid=sess1" in index_cookie
    # The 302 answer to the agreement POST was returned as-is, never chased:
    # exactly the three protocol requests left the adapter.
    assert [(r.method, str(r.url)) for r in seen] == [
        ("GET", HOME_URL),
        ("POST", HOME_URL),
        ("POST", DATA_URL),
    ]
    assert all(r.headers["User-Agent"] == USER_AGENT for r in seen)


# --- handshake (R1/LD13) -----------------------------------------------------


def test_handshake_token_agreement_cookies_and_archive(tmp_path, initialized_db):
    transport = FakeSenateTransport()
    clock = FakeClock()
    _route_handshake(transport, [_index_row(U1)])
    transport.route("GET", _doc_url("ptr", U1), _resp(200, EFILE_1ROW))
    raw_root = tmp_path / "raw"
    report = _run_live(initialized_db, transport, clock, raw_root=raw_root)
    assert report.ok, senate.format_summary(report)

    # Strictly sequential, in protocol order (R2).
    assert [(m, u) for m, u, _h, _d in transport.calls] == [
        ("GET", HOME_URL),
        ("POST", HOME_URL),
        ("POST", DATA_URL),
        ("GET", _doc_url("ptr", U1)),
    ]

    # Agreement POST: token + prohibition_agreement, Referer, home cookie.
    _m, _u_, headers, data = transport.calls[1]
    assert data == {"csrfmiddlewaretoken": "tok123", "prohibition_agreement": "1"}
    assert headers["Referer"] == HOME_URL
    assert "csrftoken=abc" in headers["Cookie"]

    # Index POST: both handshake cookies replayed; the settled body fields.
    _m, _u_, headers, data = transport.calls[2]
    assert "csrftoken=abc" in headers["Cookie"]
    assert "sessionid=sess1" in headers["Cookie"]
    assert data["report_types"] == "[11]"
    assert data["submitted_start_date"] == "01/01/2012 00:00:00"  # empty store (LD5)
    assert data["start"] == "0"
    assert data["length"] == str(PAGE_LENGTH)
    assert data["csrfmiddlewaretoken"] == "tok123"
    assert headers["Referer"] == HOME_URL

    # Detail GET replays the session cookie too.
    _m, _u_, headers, _d = transport.calls[3]
    assert "sessionid=sess1" in headers["Cookie"]

    # Raw archive mirrors the cache layout: index at root, page under pages/.
    archived = json.loads((raw_root / "ptr-index.json").read_text(encoding="utf-8"))
    assert archived["recordsTotal"] == 1
    assert len(archived["data"]) == 1
    assert (raw_root / "pages" / f"ptr_{U1}.html").read_bytes() == EFILE_1ROW

    status, raw_path, response_hash, row_count, doc_url, name, filed, kind, *_ = (
        _filing(initialized_db, U1)
    )
    assert status == "parsed"
    assert raw_path == f"pages/ptr_{U1}.html"
    assert response_hash == hashlib.sha256(EFILE_1ROW).hexdigest()
    assert row_count == 1
    assert doc_url == _doc_url("ptr", U1)
    assert name == "Doe, Jane"
    assert filed == "2026-07-02"
    assert kind == "ptr"


@pytest.mark.parametrize("status", [302, 303])
def test_agreement_redirect_statuses_accepted(tmp_path, initialized_db, status):
    transport = FakeSenateTransport()
    clock = FakeClock()
    _route_handshake(transport, [_index_row(U1)], agreement_status=status)
    transport.route("GET", _doc_url("ptr", U1), _resp(200, EFILE_1ROW))
    report = _run_live(initialized_db, transport, clock, raw_root=tmp_path / "raw")
    assert report.ok
    assert not report.discovery_failed


@pytest.mark.parametrize("status", [200, 404, 400])
def test_agreement_non_redirect_is_discovery_failure(tmp_path, initialized_db, status):
    # LD13: the eFD agreement form re-renders with HTTP 200 when rejected —
    # continuing would scrape an anonymous session. Any non-302/303 stops.
    transport = FakeSenateTransport()
    clock = FakeClock()
    _route_handshake(transport, [_index_row(U1)], agreement_status=status)
    report = _run_live(initialized_db, transport, clock, raw_root=tmp_path / "raw")
    assert report.discovery_failed is True
    assert not report.ok
    assert "agreement not accepted" in report.note
    assert report.reconciliation is None
    # The index endpoint was never touched with a dead session.
    assert DATA_URL not in transport.urls()
    assert _audit_row(initialized_db)[0] == "partial"
    assert "FAILED" in senate.format_summary(report)


def _failure_case_home_500(transport):
    transport.route("GET", HOME_URL, _resp(500))


def _failure_case_no_token(transport):
    transport.route("GET", HOME_URL, _resp(200, b"<html><body>no form</body></html>"))


def _failure_case_index_404(transport):
    _route_handshake(transport)
    transport.route("POST", DATA_URL, _resp(404))


def _failure_case_index_not_json(transport):
    _route_handshake(transport)
    transport.route("POST", DATA_URL, _resp(200, b"this is not json"))


def _failure_case_no_records_total(transport):
    _route_handshake(transport)
    transport.route("POST", DATA_URL, _resp(200, json.dumps({"data": []}).encode()))


def _failure_case_no_data_array(transport):
    _route_handshake(transport)
    transport.route(
        "POST", DATA_URL, _resp(200, json.dumps({"recordsTotal": 1}).encode())
    )


@pytest.mark.parametrize(
    "setup",
    [
        _failure_case_home_500,
        _failure_case_no_token,
        _failure_case_index_404,
        _failure_case_index_not_json,
        _failure_case_no_records_total,
        _failure_case_no_data_array,
    ],
)
def test_live_discovery_failures_are_explicit(tmp_path, initialized_db, setup):
    transport = FakeSenateTransport()
    clock = FakeClock()
    setup(transport)
    report = _run_live(initialized_db, transport, clock, raw_root=tmp_path / "raw")
    assert report.discovery_failed is True
    assert report.reconciliation is None
    assert not report.ok
    assert _audit_row(initialized_db)[0] == "partial"


def test_cache_without_index_is_a_failure_not_a_skip(tmp_path, initialized_db):
    # LD11: one index, no reconciliation without it (unlike the House
    # per-year cache skip).
    empty = tmp_path / "cache"
    empty.mkdir()
    report = _run_cache(initialized_db, empty)
    assert report.discovery_failed is True
    assert not report.ok
    assert "no cached index" in report.note
    assert _audit_row(initialized_db)[0] == "partial"


def test_cache_unreadable_index_is_a_failure(tmp_path, initialized_db):
    cache = tmp_path / "cache"
    cache.mkdir()
    (cache / "ptr-index.json").write_text("{not json", encoding="utf-8")
    report = _run_cache(initialized_db, cache)
    assert report.discovery_failed is True
    assert "unreadable" in report.note


def test_index_pagination_across_two_pages(tmp_path):
    transport = FakeSenateTransport()
    clock = FakeClock()
    _route_handshake(transport)
    page_one = [_index_row(_u(n)) for n in range(1, PAGE_LENGTH + 1)]
    page_two = [_index_row(_u(PAGE_LENGTH + 1)), _index_row(_u(PAGE_LENGTH + 2))]
    total = len(page_one) + len(page_two)
    transport.route(
        "POST",
        DATA_URL,
        _resp(200, _index_json(page_one, total=total)),
        _resp(200, _index_json(page_two, total=total)),
    )
    session = senate._PoliteSession(
        transport, sleep=clock.sleep, monotonic=clock.monotonic, jitter=lambda: 0.0
    )
    raw_root = tmp_path / "raw"
    result = discover(
        raw_root=raw_root, session=session, submitted_start_date="01/01/2012"
    )
    assert result.failed is False
    assert len(result.uuids) == total
    starts = [d["start"] for _m, u, _h, d in transport.calls if u == DATA_URL]
    assert starts == ["0", str(PAGE_LENGTH)]
    # The merged index is archived whole.
    archived = json.loads((raw_root / "ptr-index.json").read_text(encoding="utf-8"))
    assert len(archived["data"]) == total
    assert archived["recordsTotal"] == total


# --- discovery window (R1/LD5) -----------------------------------------------


def test_window_seeded_store_is_max_senate_filed_minus_90_days(
    tmp_path, initialized_db, make_filing
):
    # A newer HOUSE filing must not move the Senate window (per-chamber MAX).
    make_filing(
        initialized_db,
        filing_id=f"senate:{U5}",
        chamber="senate",
        source="senate-efd",
        doc_url=_doc_url("ptr", U5),
        filed_date="2026-07-01",
    )
    make_filing(initialized_db, filed_date="2026-07-10")  # house default
    transport = FakeSenateTransport()
    clock = FakeClock()
    _route_handshake(transport, [])
    _run_live(initialized_db, transport, clock, raw_root=tmp_path / "raw")
    (_m, _u_, _h, data), = [c for c in transport.calls if c[1] == DATA_URL]
    assert data["submitted_start_date"] == "04/02/2026 00:00:00"  # 2026-07-01 − 90 d


# --- politeness floors (R2/G6) -----------------------------------------------


def test_floor_constants_are_pinned():
    assert MIN_SPACING_S == 2.0
    assert BACKOFF_SCHEDULE == (2.0, 4.0, 8.0)
    assert CIRCUIT_403_THRESHOLD == 3


def test_ua_spacing_and_sequential_order(tmp_path, initialized_db):
    transport = FakeSenateTransport()
    clock = FakeClock()
    _route_handshake(transport, [_index_row(U1), _index_row(U2, filed="07/01/2026")])
    transport.route("GET", _doc_url("ptr", U1), _resp(200, EFILE_1ROW))
    transport.route("GET", _doc_url("ptr", U2), _resp(200, EFILE_BOND))
    report = _run_live(initialized_db, transport, clock, raw_root=tmp_path / "raw")
    assert report.ok
    # The identifying RUN-2 UA on every fetch, GET and POST alike.
    assert transport.calls
    assert all(h["User-Agent"] == USER_AGENT for _m, _u_, h, _d in transport.calls)
    # 5 fetches, 4 gaps, each exactly the 2.0 s floor with zero jitter.
    assert clock.sleeps == [MIN_SPACING_S] * 4


def test_jitter_adds_to_the_floor_never_subtracts(tmp_path, initialized_db):
    transport = FakeSenateTransport()
    clock = FakeClock()
    _route_handshake(transport, [_index_row(U1)])
    transport.route("GET", _doc_url("ptr", U1), _resp(200, EFILE_1ROW))
    _run_live(
        initialized_db,
        transport,
        clock,
        raw_root=tmp_path / "raw",
        jitter=lambda: 0.5,
    )
    assert clock.sleeps == [2.5, 2.5, 2.5]


def test_negative_jitter_cannot_reduce_the_floor(tmp_path, initialized_db):
    transport = FakeSenateTransport()
    clock = FakeClock()
    _route_handshake(transport, [_index_row(U1)])
    transport.route("GET", _doc_url("ptr", U1), _resp(200, EFILE_1ROW))
    _run_live(
        initialized_db,
        transport,
        clock,
        raw_root=tmp_path / "raw",
        jitter=lambda: -7.0,
    )
    assert clock.sleeps == [MIN_SPACING_S] * 3


@pytest.mark.parametrize("status", [429, 500, 503])
def test_retryable_status_backs_off_then_recovers(tmp_path, initialized_db, status):
    transport = FakeSenateTransport()
    clock = FakeClock()
    _route_handshake(transport, [_index_row(U1)])
    transport.route(
        "GET", _doc_url("ptr", U1), _resp(status), _resp(200, EFILE_1ROW)
    )
    report = _run_live(initialized_db, transport, clock, raw_root=tmp_path / "raw")
    assert report.ok
    assert _filing(initialized_db, U1)[0] == "parsed"
    assert BACKOFF_SCHEDULE[0] in clock.sleeps


def test_backoff_exhaustion_persists_fetch_failed_then_refetches(
    tmp_path, initialized_db
):
    transport = FakeSenateTransport()
    clock = FakeClock()
    _route_handshake(transport, [_index_row(U1)])
    transport.route("GET", _doc_url("ptr", U1), _resp(503))
    report = _run_live(initialized_db, transport, clock, raw_root=tmp_path / "raw")

    detail_calls = [u for u in transport.urls("GET") if u == _doc_url("ptr", U1)]
    assert len(detail_calls) == 1 + len(BACKOFF_SCHEDULE)
    for delay in BACKOFF_SCHEDULE:
        assert delay in clock.sleeps
    status, raw_path, response_hash, row_count, *_ = _filing(initialized_db, U1)
    assert (status, raw_path, response_hash, row_count) == ("failed", None, None, 0)
    assert not report.ok
    assert report.failure_kinds["fetch_failed"] == 1
    assert _audit_row(initialized_db)[0] == "partial"

    # NULL raw_path stays re-fetch-eligible: the next run recovers it.
    transport.route("GET", _doc_url("ptr", U1), _resp(200, EFILE_1ROW))
    second = _run_live(
        initialized_db, transport, clock, raw_root=tmp_path / "raw", run_id="run-2"
    )
    assert second.ok
    assert _filing(initialized_db, U1)[0] == "parsed"


def test_index_5xx_exhaustion_is_discovery_failure(tmp_path, initialized_db):
    transport = FakeSenateTransport()
    clock = FakeClock()
    _route_handshake(transport)
    transport.route("POST", DATA_URL, _resp(503))
    report = _run_live(initialized_db, transport, clock, raw_root=tmp_path / "raw")
    assert report.discovery_failed is True
    assert len([u for u in transport.urls("POST") if u == DATA_URL]) == 1 + len(
        BACKOFF_SCHEDULE
    )


# --- circuit breaker (R3/LD6) ------------------------------------------------


def test_breaker_trips_at_three_consecutive_403s(tmp_path, initialized_db):
    transport = FakeSenateTransport()
    clock = FakeClock()
    rows = [
        _index_row(U1),
        _index_row(U2, filed="07/01/2026"),
        _index_row(U3, filed="06/30/2026"),
        _index_row(U4, filed="06/29/2026"),
    ]
    _route_handshake(transport, rows)
    transport.route("GET", _doc_url("ptr", U1), _resp(200, EFILE_1ROW))
    for uuid in (U2, U3, U4):
        transport.route("GET", _doc_url("ptr", uuid), _resp(403))
    report = _run_live(initialized_db, transport, clock, raw_root=tmp_path / "raw")

    assert report.circuit_open_url == _doc_url("ptr", U4)
    assert not report.ok
    assert _audit_row(initialized_db)[0] == "circuit_open"
    # Persisted filings stand: U1 parsed; U2/U3 recorded fetch-failed; U4
    # was never persisted and surfaces as unaccounted.
    assert _filing(initialized_db, U1)[0] == "parsed"
    assert _filing(initialized_db, U2)[0] == "failed"
    assert _filing(initialized_db, U3)[0] == "failed"
    assert _filing(initialized_db, U4) is None
    assert report.reconciliation.unaccounted == (U4,)
    summary = senate.format_summary(report)
    assert "CIRCUIT OPEN" in summary
    assert _doc_url("ptr", U4) in summary


def test_breaker_counter_resets_on_any_non_403(tmp_path, initialized_db):
    # 403,403,200,403,403,403 — the success resets the counter, so the trip
    # lands on the SIXTH fetch, not the third.
    transport = FakeSenateTransport()
    clock = FakeClock()
    uuids = [U1, U2, U3, U4, U5, U6]
    rows = [_index_row(u_, filed="07/01/2026") for u_ in uuids]
    _route_handshake(transport, rows)
    for uuid, response in zip(
        uuids,
        [_resp(403), _resp(403), _resp(200, EFILE_1ROW), _resp(403), _resp(403), _resp(403)],
        strict=True,
    ):
        transport.route("GET", _doc_url("ptr", uuid), response)
    report = _run_live(initialized_db, transport, clock, raw_root=tmp_path / "raw")
    assert report.circuit_open_url == _doc_url("ptr", U6)
    assert _filing(initialized_db, U3)[0] == "parsed"
    assert _filing(initialized_db, U1)[0] == "failed"
    assert _filing(initialized_db, U5)[0] == "failed"
    assert _filing(initialized_db, U6) is None
    assert _audit_row(initialized_db)[0] == "circuit_open"


def test_lone_403_is_fetch_failed_and_the_run_continues(tmp_path, initialized_db):
    transport = FakeSenateTransport()
    clock = FakeClock()
    _route_handshake(transport, [_index_row(U1), _index_row(U2, filed="07/01/2026")])
    transport.route("GET", _doc_url("ptr", U1), _resp(403))
    transport.route("GET", _doc_url("ptr", U2), _resp(200, EFILE_1ROW))
    report = _run_live(initialized_db, transport, clock, raw_root=tmp_path / "raw")
    assert report.circuit_open_url is None
    assert _filing(initialized_db, U1)[0] == "failed"
    assert _filing(initialized_db, U2)[0] == "parsed"
    assert report.failure_kinds["fetch_failed"] == 1
    assert _audit_row(initialized_db)[0] == "partial"


def test_cli_live_circuit_open_exits_one(tmp_path, monkeypatch):
    import time as time_module

    transport = FakeSenateTransport()
    rows = [_index_row(u_, filed="07/01/2026") for u_ in (U1, U2, U3)]
    _route_handshake(transport, rows)
    for uuid in (U1, U2, U3):
        transport.route("GET", _doc_url("ptr", uuid), _resp(403))
    monkeypatch.setattr(senate, "HttpxSenateTransport", lambda: transport)
    monkeypatch.setattr(time_module, "sleep", lambda _s: None)
    result = CliRunner().invoke(
        cli_main,
        ["ingest", "congress-senate", "--raw-root", str(tmp_path / "raw"),
         "--db", str(tmp_path / "populus.db")],
    )
    assert result.exit_code == 1, result.output
    assert "CIRCUIT OPEN" in result.output


# --- index hardening (R9) ----------------------------------------------------

BAD_LINKS = [
    '<a href="https://evil.example/search/view/ptr/00000000-0000-4000-8000-000000000099/">x</a>',
    '<a href="/search/view/ptr/../../etc/passwd/">x</a>',
    '<a href="/search/view/ptr/not-a-uuid/">x</a>',
    '<a href="/other/view/ptr/00000000-0000-4000-8000-000000000099/">x</a>',
    "no anchor at all",
]


def test_malformed_index_rows_rejected_counted_not_ok(tmp_path, initialized_db):
    rows = [_index_row(U1)]
    rows += [_index_row(U2, link=link) for link in BAD_LINKS]
    rows.append(["only", "two"])  # malformed shape
    rows.append([1, 2, 3, 4, 5])  # non-string fields
    cache = _make_cache(tmp_path, rows, {f"ptr_{U1}.html": EFILE_1ROW})
    report = _run_cache(initialized_db, cache)
    assert len(report.rejected_rows) == len(BAD_LINKS) + 2
    assert not report.ok
    assert "REJECTED INDEX ROWS" in senate.format_summary(report)
    # The legitimate filing still ingested; nothing was fetched or written
    # for any rejected row.
    assert _filing(initialized_db, U1)[0] == "parsed"
    assert initialized_db.execute("SELECT count(*) FROM filings").fetchone() == (1,)


def test_duplicate_uuids_deduped(tmp_path, initialized_db):
    rows = [_index_row(U1), _index_row(U1)]
    cache = _make_cache(tmp_path, rows, {f"ptr_{U1}.html": EFILE_1ROW})
    report = _run_cache(initialized_db, cache)
    assert report.dup_uuids == 1
    assert report.index_count == 1
    assert report.ok


def test_archive_relpath_refuses_unvalidated_inputs():
    for kind, uuid in (
        ("ptr", "../../escape"),
        ("ptr", "00000000-0000-4000-8000-00000000000g"),
        ("zzz", U1),
        ("", U1),
    ):
        with pytest.raises(UnsafeArchivePathError):
            senate._archive_relpath(kind, uuid)
    assert senate._archive_relpath("ptr", U1) == f"pages/ptr_{U1}.html"


# --- statuses and reconciliation (R7/R8/R13) ---------------------------------


def test_cache_ingest_statuses_and_reconciliation(tmp_path, initialized_db):
    rows = [
        _index_row(U1),
        _index_row(U2, kind="paper", first="RICHARD ", last="BLUMENTHAL",
                   office="Senator", filed="07/17/2026"),
        _index_row(U3, filed="06/30/2026"),  # no cached page → fetch_failed
        _index_row(U4, filed="06/29/2026"),  # garbage page → failed archived
    ]
    cache = _make_cache(
        tmp_path,
        rows,
        {
            f"ptr_{U1}.html": EFILE_1ROW,
            f"paper_{U2}.html": PAPER,
            f"ptr_{U4}.html": b"<html><body>nothing here</body></html>",
        },
    )
    report = _run_cache(initialized_db, cache)
    rec = report.reconciliation
    assert rec.index_count == 4
    assert rec.total == 4
    assert rec.unaccounted == ()
    assert rec.status_counts == {"parsed": 1, "needs_ocr": 1, "failed": 2}
    assert rec.failed_fetch == 1
    assert rec.failed_archived == 1
    assert report.failure_kinds == {"fetch_failed": 1, "missing_table": 1}
    assert not report.ok

    # Paper filing retained with raw archive, hash, metadata, doc link (G3).
    status, raw_path, response_hash, row_count, doc_url, name, filed, *_ = (
        _filing(initialized_db, U2)
    )
    assert status == "needs_ocr"
    assert raw_path == f"pages/paper_{U2}.html"
    assert response_hash == hashlib.sha256(PAPER).hexdigest()
    assert row_count == 0
    assert doc_url == _doc_url("paper", U2)
    assert name == "BLUMENTHAL, RICHARD"  # office column ignored (LD4)
    assert filed == "2026-07-17"

    summary = senate.format_summary(report)
    assert "index rows 4" in summary
    assert "needs_ocr 1" in summary
    assert "fetch_failed 1" in summary
    assert "missing_table 1" in summary


def test_filer_name_trailing_comma_and_title_vs_filed_date(tmp_path, initialized_db):
    # Real index quirks: 'Moran,  ' carries a trailing comma; McCormick's
    # link title says 06/27 while the filed column says 06/26 — the filing
    # date must come from the index column (R8), never the title.
    rows = [
        _index_row(U1, first="Jerry", last="Moran,  ", filed="06/25/2026",
                   title_date="06/25/2026"),
        _index_row(U2, first="David H", last="McCormick", filed="06/26/2026",
                   title_date="06/27/2026"),
    ]
    cache = _make_cache(
        tmp_path, rows,
        {f"ptr_{U1}.html": EFILE_1ROW, f"ptr_{U2}.html": EFILE_1ROW},
    )
    report = _run_cache(initialized_db, cache)
    assert report.ok
    assert _filing(initialized_db, U1)[5] == "Moran, Jerry"
    assert _filing(initialized_db, U2)[5] == "McCormick, David H"
    assert _filing(initialized_db, U2)[6] == "2026-06-26"


def test_declared_mismatch_and_defect_rows_load_partial(tmp_path, initialized_db):
    rows = [_index_row(U1), _index_row(U2, filed="07/01/2026")]
    cache = _make_cache(
        tmp_path,
        rows,
        {
            # One row but the page declares two → partial (LD7).
            f"ptr_{U1}.html": _synthetic_page(ROW_OK, "(2 transactions total)"),
            # Non-numeric '#' → source_row_no defect → partial (LD15).
            f"ptr_{U2}.html": _synthetic_page(ROW_BAD_NUMBER, "(1 transaction total)"),
        },
    )
    report = _run_cache(initialized_db, cache)
    assert _filing(initialized_db, U1)[0] == "partial"
    assert _filing(initialized_db, U2)[0] == "partial"
    assert report.declared_mismatches == 1
    assert report.total_efile_rows == 2
    assert report.clean_efile_rows == 1  # U1's row is defect-free; U2's is not
    assert report.ok  # partial reconciles — not a failure (G3 outcome-only)
    assert "declared_mismatch 1" in senate.format_summary(report)
    flags = _row_flags(initialized_db, U2)
    assert any("source_row_no_unparsed" in f for f in flags)


def _failed_detail(summary: str) -> dict[str, int]:
    """The parsed `failed N (k1 a, k2 b, …)` subtotals from a summary line."""
    match = re.search(r"failed (\d+) \(([^)]*)\)", summary)
    assert match is not None, summary
    subtotals = {}
    for part in match.group(2).split(","):
        name, value = part.rsplit(" ", 1)
        subtotals[name.strip()] = int(value)
    return {"failed": int(match.group(1)), **subtotals}


def test_archived_parse_failure_stays_in_the_split_on_later_runs(
    tmp_path, initialized_db
):
    # R13: an archived parser failure is settled, so a later run never
    # re-evaluates it — but reconciliation still counts it as failed. The
    # displayed split must account for it (archived_prior), never print a
    # failed total that its own subtotals contradict.
    garbage = b"<html><body>no transactions table here</body></html>"
    cache = _make_cache(tmp_path, [_index_row(U1)], {f"ptr_{U1}.html": garbage})

    first = _run_cache(initialized_db, cache)
    first_detail = _failed_detail(senate.format_summary(first))
    assert first_detail["failed"] == 1
    assert first_detail["missing_table"] == 1
    assert first_detail["archived_prior"] == 0
    assert (
        first_detail["fetch_failed"]
        + first_detail["missing_table"]
        + first_detail["header_mismatch"]
        + first_detail["archived_prior"]
        == first_detail["failed"]
    )

    second = _run_cache(initialized_db, cache, run_id="run-2")
    assert second.new_filings == 0  # settled: archived and same kind
    assert second.reconciliation.status_counts == {"failed": 1}
    assert second.reconciliation.failed_archived == 1
    second_detail = _failed_detail(senate.format_summary(second))
    assert second_detail["failed"] == 1
    assert second_detail["missing_table"] == 0  # nothing re-evaluated this run
    assert second_detail["archived_prior"] == 1  # …but the failure is still shown
    assert (
        second_detail["fetch_failed"]
        + second_detail["missing_table"]
        + second_detail["header_mismatch"]
        + second_detail["archived_prior"]
        == second_detail["failed"]
    )
    assert not second.ok


def test_failure_split_sums_to_failed_across_mixed_kinds(tmp_path, initialized_db):
    # Mixed run: one fetch-failed (no cached page), one archived parse
    # failure, one clean — the subtotals still sum to the failed total.
    rows = [
        _index_row(U1),
        _index_row(U2, filed="07/01/2026"),
        _index_row(U3, filed="06/30/2026"),
    ]
    cache = _make_cache(
        tmp_path,
        rows,
        {
            f"ptr_{U1}.html": EFILE_1ROW,
            f"ptr_{U2}.html": b"<html><body>nothing</body></html>",
        },
    )
    report = _run_cache(initialized_db, cache)
    detail = _failed_detail(senate.format_summary(report))
    assert detail == {
        "failed": 2,
        "fetch_failed": 1,
        "missing_table": 1,
        "header_mismatch": 0,
        "archived_prior": 0,
    }


def test_second_identical_run_adds_nothing(tmp_path, initialized_db):
    cache = _make_cache(tmp_path, [_index_row(U1)], {f"ptr_{U1}.html": EFILE_1ROW})
    first = _run_cache(initialized_db, cache)
    assert first.new_filings == 1
    before = initialized_db.execute("SELECT count(*) FROM transactions").fetchone()
    second = _run_cache(initialized_db, cache, run_id="run-2")
    assert second.new_filings == 0
    assert second.ok
    assert initialized_db.execute("SELECT count(*) FROM transactions").fetchone() == before


def test_audit_row_success_fields(tmp_path, initialized_db):
    cache = _make_cache(tmp_path, [_index_row(U1)], {f"ptr_{U1}.html": EFILE_1ROW})
    _run_cache(initialized_db, cache)
    status, finished, new_filings, rows_loaded, failures, job, host = _audit_row(
        initialized_db
    )
    assert status == "ok"
    assert finished is not None
    assert (new_filings, rows_loaded, failures) == (1, 1, 0)
    assert job == "congress-senate"
    assert host == "testhost"


def test_audit_row_finalized_on_fatal(tmp_path, initialized_db, monkeypatch):
    def _boom(*args, **kwargs):
        raise RuntimeError("injected fatal")

    monkeypatch.setattr(senate, "_process_uuid", _boom)
    cache = _make_cache(tmp_path, [_index_row(U1)], {f"ptr_{U1}.html": EFILE_1ROW})
    with pytest.raises(RuntimeError, match="injected fatal"):
        _run_cache(initialized_db, cache)
    status, finished, *_ = _audit_row(initialized_db)
    assert status == "failed"
    assert finished is not None


# --- lifecycle preservation (R10/LD9 — ingest never transitions lifecycle) ---


def _seed_senate_filing(conn, uuid, *, kind="ptr", lifecycle, parse_status, raw_path):
    from populus.load import insert_filing

    insert_filing(
        conn,
        filing_id=f"senate:{uuid}",
        chamber="senate",
        filer_name_raw="Doe, Jane",
        filing_kind="ptr",
        filed_date="2026-07-02",
        doc_url=_doc_url(kind, uuid),
        source="senate-efd",
        ingested_at="2026-07-01T00:00:00Z",
        parse_status=parse_status,
        lifecycle=lifecycle,
        raw_path=raw_path,
    )


@pytest.mark.parametrize("lifecycle", ["superseded", "retired", "withdrawn"])
def test_fetch_failed_retry_preserves_lifecycle(tmp_path, initialized_db, lifecycle):
    # A non-active filing whose fetch failed earlier (raw_path NULL) is
    # re-fetched on the next run. Ingest records the parse outcome only —
    # it must never reactivate the filing (§9.4 lifecycle vs parse_status).
    _seed_senate_filing(
        initialized_db, U1, lifecycle=lifecycle, parse_status="failed", raw_path=None
    )
    cache = _make_cache(tmp_path, [_index_row(U1)], {f"ptr_{U1}.html": EFILE_1ROW})
    report = _run_cache(initialized_db, cache)
    assert report.ok
    status, *_rest, stored_lifecycle = _filing(initialized_db, U1)
    assert status == "parsed"  # the retry did re-evaluate the document …
    assert stored_lifecycle == lifecycle  # … without touching lifecycle


@pytest.mark.parametrize("lifecycle", ["superseded", "retired", "withdrawn"])
def test_kind_conversion_preserves_lifecycle(tmp_path, initialized_db, lifecycle):
    # R18 permits a paper→e-file conversion to re-fetch and re-evaluate,
    # but not to transition lifecycle.
    _seed_senate_filing(
        initialized_db,
        U1,
        kind="paper",
        lifecycle=lifecycle,
        parse_status="needs_ocr",
        raw_path=f"pages/paper_{U1}.html",
    )
    cache = _make_cache(tmp_path, [_index_row(U1)], {f"ptr_{U1}.html": EFILE_1ROW})
    report = _run_cache(initialized_db, cache)
    assert report.conversions == 1
    status, raw_path, _hash, row_count, doc_url, *_rest, stored_lifecycle = _filing(
        initialized_db, U1
    )
    assert (status, row_count) == ("parsed", 1)
    assert raw_path == f"pages/ptr_{U1}.html"
    assert doc_url == _doc_url("ptr", U1)
    assert stored_lifecycle == lifecycle


def test_new_filing_defaults_to_active_lifecycle(tmp_path, initialized_db):
    cache = _make_cache(tmp_path, [_index_row(U1)], {f"ptr_{U1}.html": EFILE_1ROW})
    _run_cache(initialized_db, cache)
    assert _filing(initialized_db, U1)[9] == "active"


def test_amendment_linkage_does_not_transition_lifecycle(tmp_path, initialized_db):
    # LD9: pairing sets `supersedes` only — the paired original stays
    # active until OQ-13 lands (no supersede automation).
    rows = [
        _index_row(U1, title_date="05/10/2026", filed="05/10/2026"),
        _index_row(U2, title_date="05/10/2026", filed="06/01/2026", amendment=True),
    ]
    cache = _make_cache(
        tmp_path, rows,
        {f"ptr_{U1}.html": EFILE_1ROW, f"ptr_{U2}.html": EFILE_BOND},
    )
    _run_cache(initialized_db, cache)
    assert _filing(initialized_db, U1)[9] == "active"
    assert _filing(initialized_db, U2)[9] == "active"
    assert _filing(initialized_db, U2)[8] == f"senate:{U1}"


# --- kind conversion (R18/LD14) ----------------------------------------------


def test_paper_to_efile_conversion_then_settled(tmp_path, initialized_db):
    transport = FakeSenateTransport()
    clock = FakeClock()
    raw_root = tmp_path / "raw"

    # Run 1: the index reports the UUID as a paper filing.
    _route_handshake(transport, [_index_row(U1, kind="paper")])
    transport.route("GET", _doc_url("paper", U1), _resp(200, PAPER))
    first = _run_live(initialized_db, transport, clock, raw_root=raw_root)
    assert first.ok
    status, raw_path, _hash, row_count, doc_url, *_ = _filing(initialized_db, U1)
    assert (status, row_count) == ("needs_ocr", 0)
    assert raw_path == f"pages/paper_{U1}.html"
    assert doc_url == _doc_url("paper", U1)

    # Run 2: the same UUID now appears as e-filed (§9.2 conversion) — the
    # document is re-fetched, re-archived under the ptr path, re-evaluated.
    transport.route("POST", DATA_URL, _resp(200, _index_json([_index_row(U1)])))
    transport.route("GET", _doc_url("ptr", U1), _resp(200, EFILE_1ROW))
    second = _run_live(
        initialized_db, transport, clock, raw_root=raw_root, run_id="run-2"
    )
    assert second.ok
    assert second.conversions == 1
    assert second.new_filings == 1
    status, raw_path, response_hash, row_count, doc_url, *_ = _filing(
        initialized_db, U1
    )
    assert status == "parsed"
    assert row_count == 1
    assert raw_path == f"pages/ptr_{U1}.html"
    assert doc_url == _doc_url("ptr", U1)
    assert response_hash == hashlib.sha256(EFILE_1ROW).hexdigest()
    assert initialized_db.execute(
        "SELECT count(*) FROM transactions WHERE filing_id = ?",
        (f"senate:{U1}",),
    ).fetchone() == (1,)
    # The prior kind's archive file stays on disk as raw history.
    assert (raw_root / "pages" / f"paper_{U1}.html").exists()

    # Run 3: unchanged kind ⇒ settled ⇒ NO fetch — the rule is kind-aware,
    # not a blanket refetch.
    detail_fetches_before = len(
        [u for u in transport.urls("GET") if u == _doc_url("ptr", U1)]
    )
    third = _run_live(
        initialized_db, transport, clock, raw_root=raw_root, run_id="run-3"
    )
    assert third.ok
    assert third.new_filings == 0
    assert third.conversions == 0
    detail_fetches_after = len(
        [u for u in transport.urls("GET") if u == _doc_url("ptr", U1)]
    )
    assert detail_fetches_after == detail_fetches_before == 1


# --- amendments (R10/LD9/§9.5) -----------------------------------------------


def test_amendment_pairs_with_unambiguous_index_original(tmp_path, initialized_db):
    rows = [
        _index_row(U1, title_date="05/10/2026", filed="05/10/2026"),
        _index_row(U2, title_date="05/10/2026", filed="06/01/2026", amendment=True),
    ]
    cache = _make_cache(
        tmp_path, rows,
        {f"ptr_{U1}.html": EFILE_1ROW, f"ptr_{U2}.html": EFILE_BOND},
    )
    report = _run_cache(initialized_db, cache)
    assert report.ok
    assert (report.amendments_total, report.amendments_paired) == (1, 1)

    *_, kind, supersedes, lifecycle = _filing(initialized_db, U2)
    assert kind == "ptr_amendment"
    assert supersedes == f"senate:{U1}"
    assert lifecycle == "active"  # no supersede automation (OQ-13 gate)
    *_, orig_kind, orig_supersedes, orig_lifecycle = _filing(initialized_db, U1)
    assert orig_kind == "ptr"
    assert orig_supersedes is None
    assert orig_lifecycle == "active"

    # §9.5/RUN 4: BOTH sides of the pair carry the flag after ingest — the
    # amendment's rows from normalization, the original's from the
    # flag-propagation pass at the ingest tail.
    assert all("amendment_unresolved" in f for f in _row_flags(initialized_db, U2))
    assert all("amendment_unresolved" in f for f in _row_flags(initialized_db, U1))
    # The flag is a source fact: the amendment still parses clean.
    assert _filing(initialized_db, U2)[0] == "parsed"
    assert "amendments 1 (paired 1, unpaired 0)" in senate.format_summary(report)


def test_amendment_ambiguous_or_missing_original_stays_null(tmp_path, initialized_db):
    rows = [
        # Two same-filer originals on the amendment's report date → ambiguous.
        _index_row(U1, title_date="06/16/2026", filed="06/16/2026"),
        _index_row(U2, title_date="06/16/2026", filed="06/16/2026"),
        _index_row(U3, title_date="06/16/2026", filed="06/20/2026", amendment=True),
        # No original anywhere for this one → missing.
        _index_row(U4, title_date="07/15/2025", filed="05/15/2026", amendment=True,
                   first="John", last="Fetterman"),
    ]
    cache = _make_cache(
        tmp_path, rows,
        {
            f"ptr_{U1}.html": EFILE_1ROW,
            f"ptr_{U2}.html": EFILE_1ROW,
            f"ptr_{U3}.html": EFILE_BOND,
            f"ptr_{U4}.html": EFILE_BOND,
        },
    )
    report = _run_cache(initialized_db, cache)
    assert (report.amendments_total, report.amendments_paired) == (2, 0)
    assert _filing(initialized_db, U3)[8] is None  # supersedes NULL
    assert _filing(initialized_db, U4)[8] is None
    assert all("amendment_unresolved" in f for f in _row_flags(initialized_db, U3))
    assert all("amendment_unresolved" in f for f in _row_flags(initialized_db, U4))


def test_amendment_pairs_via_stored_filing_when_original_left_the_index(
    tmp_path, initialized_db
):
    # Run 1 ingests the original; run 2's window no longer contains it, only
    # the amendment — the DB-side candidate query still resolves the pair.
    cache1 = _make_cache(
        tmp_path / "one",
        [_index_row(U1, title_date="05/10/2026", filed="05/10/2026")],
        {f"ptr_{U1}.html": EFILE_1ROW},
    )
    _run_cache(initialized_db, cache1)
    cache2 = _make_cache(
        tmp_path / "two",
        [_index_row(U2, title_date="05/10/2026", filed="06/01/2026", amendment=True)],
        {f"ptr_{U2}.html": EFILE_BOND},
    )
    report = _run_cache(initialized_db, cache2, run_id="run-2")
    assert report.ok
    assert (report.amendments_total, report.amendments_paired) == (1, 1)
    assert _filing(initialized_db, U2)[8] == f"senate:{U1}"


def test_amendment_linkage_heals_after_crash_between_upsert_and_linkage(
    tmp_path, initialized_db, monkeypatch
):
    rows = [
        _index_row(U1, title_date="05/10/2026", filed="05/10/2026"),
        _index_row(U2, title_date="05/10/2026", filed="06/01/2026", amendment=True),
    ]
    cache = _make_cache(
        tmp_path, rows,
        {f"ptr_{U1}.html": EFILE_1ROW, f"ptr_{U2}.html": EFILE_BOND},
    )

    def _crash(*args, **kwargs):
        raise RuntimeError("injected crash before linkage")

    monkeypatch.setattr(senate, "_link_amendments", _crash)
    with pytest.raises(RuntimeError, match="injected crash"):
        _run_cache(initialized_db, cache)
    assert _audit_row(initialized_db)[0] == "failed"
    assert _filing(initialized_db, U2)[8] is None  # upserted, not yet linked

    # Rerun with the crash gone: both filings are settled (no reprocessing),
    # but the linkage pass runs over ALL amendment index rows and heals.
    monkeypatch.undo()
    report = _run_cache(initialized_db, cache, run_id="run-2")
    assert report.ok
    assert report.new_filings == 0
    assert (report.amendments_total, report.amendments_paired) == (1, 1)
    assert _filing(initialized_db, U2)[8] == f"senate:{U1}"


# --- reparse (R15) -----------------------------------------------------------


@pytest.fixture
def reparsed_db(tmp_path, initialized_db):
    """One parsed e-file, one paper, one amendment, one fetch-failed."""
    rows = [
        _index_row(U1, filed="07/02/2026"),
        _index_row(U2, kind="paper", filed="05/19/2026"),
        _index_row(U3, title_date="07/02/2026", filed="07/03/2026", amendment=True),
        _index_row(U4, filed="06/01/2026"),  # no page → fetch-failed
    ]
    cache = _make_cache(
        tmp_path,
        rows,
        {
            f"ptr_{U1}.html": EFILE_BOND,
            f"paper_{U2}.html": PAPER,
            f"ptr_{U3}.html": EFILE_1ROW,
        },
    )
    _run_cache(initialized_db, cache)
    return initialized_db, cache


def _recording_reader():
    seen: list[Path] = []

    def _read(path: Path) -> bytes:
        seen.append(path)
        return path.read_bytes()

    return seen, _read


def test_reparse_statuses_identity_and_no_fetching(reparsed_db):
    conn, cache = reparsed_db
    before = {
        txn_id
        for (txn_id,) in conn.execute(
            "SELECT txn_id FROM transactions WHERE filing_id = ?",
            (f"senate:{U1}",),
        )
    }
    seen, reader = _recording_reader()
    report = reparse_senate(
        conn, raw_root=cache, selector=ReparseSelector(), read_archive=reader
    )
    assert report.statuses == {
        f"senate:{U1}": "parsed",
        f"senate:{U2}": "needs_ocr",  # paper stays needs_ocr
        f"senate:{U3}": "parsed",
    }
    assert report.selection.excluded_no_archive == 1  # the fetch-failed U4
    assert report.ok
    # Reads came exclusively from the raw archive; no transport exists here.
    assert all(str(p).startswith(str(cache)) for p in seen)
    assert len(seen) == 3
    after = {
        txn_id
        for (txn_id,) in conn.execute(
            "SELECT txn_id FROM transactions WHERE filing_id = ?",
            (f"senate:{U1}",),
        )
    }
    assert after == before  # §9.4 identity stability
    assert conn.execute(
        "SELECT parser_version FROM filings WHERE filing_id = ?",
        (f"senate:{U1}",),
    ).fetchone() == (PARSER_VERSION,)


def test_reparse_reproduces_amendment_flag_from_filing_kind(reparsed_db):
    conn, cache = reparsed_db
    reparse_senate(
        conn, raw_root=cache, selector=ReparseSelector(filing=f"senate:{U3}")
    )
    assert all("amendment_unresolved" in f for f in _row_flags(conn, U3))


@pytest.fixture
def paired_reparse_db(tmp_path, initialized_db):
    """An unambiguous pair: U2 (amendment) supersedes U1 (original)."""
    rows = [
        _index_row(U1, title_date="05/10/2026", filed="05/10/2026"),
        _index_row(U2, title_date="05/10/2026", filed="06/01/2026", amendment=True),
    ]
    cache = _make_cache(
        tmp_path,
        rows,
        {f"ptr_{U1}.html": EFILE_1ROW, f"ptr_{U2}.html": EFILE_BOND},
    )
    _run_cache(initialized_db, cache)
    assert _filing(initialized_db, U2)[8] == f"senate:{U1}"
    return initialized_db, cache


def _pair_fully_flagged(conn) -> bool:
    return all(
        "amendment_unresolved" in flags
        for uuid in (U1, U2)
        for flags in _row_flags(conn, uuid)
    )


def test_reparse_original_keeps_both_pair_sides_flagged(paired_reparse_db):
    # R8 durability: load_filing deletes and re-inserts the original's rows;
    # the propagation pass at the reparse tail restores the original side.
    conn, cache = paired_reparse_db
    assert _pair_fully_flagged(conn)
    reparse_senate(
        conn, raw_root=cache, selector=ReparseSelector(filing=f"senate:{U1}")
    )
    assert _pair_fully_flagged(conn)


def test_reparse_amendment_keeps_both_pair_sides_flagged(paired_reparse_db):
    conn, cache = paired_reparse_db
    reparse_senate(
        conn, raw_root=cache, selector=ReparseSelector(filing=f"senate:{U2}")
    )
    assert _pair_fully_flagged(conn)


def test_full_reparse_keeps_both_pair_sides_flagged(paired_reparse_db):
    conn, cache = paired_reparse_db
    reparse_senate(conn, raw_root=cache, selector=ReparseSelector())
    assert _pair_fully_flagged(conn)


def test_reparse_selectors(reparsed_db):
    conn, cache = reparsed_db
    report = reparse_senate(
        conn, raw_root=cache, selector=ReparseSelector(filing=f"senate:{U1}")
    )
    assert set(report.statuses) == {f"senate:{U1}"}

    report = reparse_senate(
        conn, raw_root=cache, selector=ReparseSelector(since="2026-07-01")
    )
    # U1 filed 07/02, U3 filed 07/03; U2 (05/19) out of window; U4 (06/01)
    # has no archive.
    assert set(report.statuses) == {f"senate:{U1}", f"senate:{U3}"}

    report = reparse_senate(
        conn, raw_root=cache, selector=ReparseSelector(parser_version=PARSER_VERSION)
    )
    assert set(report.statuses) == {f"senate:{U1}", f"senate:{U2}", f"senate:{U3}"}


def test_reparse_explicit_no_archive_filing_skipped_never_read(reparsed_db):
    conn, cache = reparsed_db
    seen, reader = _recording_reader()
    report = reparse_senate(
        conn,
        raw_root=cache,
        selector=ReparseSelector(filing=f"senate:{U4}"),
        read_archive=reader,
    )
    assert report.statuses == {}
    assert report.selection.skipped_no_archive == (f"senate:{U4}",)
    assert not report.ok
    assert seen == []


def test_reparse_chamber_isolation(reparsed_db, make_filing):
    conn, cache = reparsed_db
    make_filing(conn, parser_version="house-stamp")  # house:10042026
    report = reparse_senate(conn, raw_root=cache, selector=ReparseSelector())
    assert all(f.startswith("senate:") for f in report.statuses)
    # The House filing is untouched, and the House-default selection still
    # sees only House rows.
    assert conn.execute(
        "SELECT parser_version FROM filings WHERE filing_id = 'house:10042026'"
    ).fetchone() == ("house-stamp",)
    house_selection = select_reparse_targets(conn, ReparseSelector())
    assert all(f.startswith("house:") for f, _p in house_selection.targets) or (
        house_selection.targets == ()
    )
    assert not any(
        f.startswith("senate:")
        for f, _p in house_selection.targets
    )


# --- CLI (R14) ---------------------------------------------------------------


def test_cli_ingest_from_cache_end_to_end(tmp_path):
    cache = _make_cache(
        tmp_path,
        [_index_row(U1), _index_row(U2, kind="paper", filed="05/19/2026")],
        {f"ptr_{U1}.html": EFILE_1ROW, f"paper_{U2}.html": PAPER},
    )
    db_path = tmp_path / "populus.db"
    result = CliRunner().invoke(
        cli_main,
        ["ingest", "congress-senate", "--from-cache", str(cache),
         "--db", str(db_path)],
    )
    assert result.exit_code == 0, result.output
    assert "index rows 2" in result.output
    assert "parsed 1" in result.output
    assert "needs_ocr 1" in result.output
    assert "efile rows: 1 clean / 1 total" in result.output
    conn = connect(str(db_path))  # --db auto-initialized
    assert conn.execute("SELECT count(*) FROM filings").fetchone() == (2,)
    conn.close()


def test_cli_year_is_rejected_for_senate(tmp_path):
    cache = _make_cache(tmp_path, [], {})
    result = CliRunner().invoke(
        cli_main,
        ["ingest", "congress-senate", "--from-cache", str(cache),
         "--db", str(tmp_path / "populus.db"), "--year", "2026"],
    )
    assert result.exit_code == 2
    assert "congress-house" in result.output


def test_cli_ingest_requires_db_and_source(tmp_path):
    cache = _make_cache(tmp_path, [], {})
    result = CliRunner().invoke(
        cli_main, ["ingest", "congress-senate", "--from-cache", str(cache)]
    )
    assert result.exit_code == 2
    result = CliRunner().invoke(
        cli_main,
        ["ingest", "congress-senate", "--db", str(tmp_path / "populus.db")],
    )
    assert result.exit_code == 2


def test_cli_exits_one_on_live_discovery_failure(tmp_path, monkeypatch):
    import time as time_module

    transport = FakeSenateTransport()
    transport.route("GET", HOME_URL, _resp(500))
    monkeypatch.setattr(senate, "HttpxSenateTransport", lambda: transport)
    monkeypatch.setattr(time_module, "sleep", lambda _s: None)
    result = CliRunner().invoke(
        cli_main,
        ["ingest", "congress-senate", "--raw-root", str(tmp_path / "raw"),
         "--db", str(tmp_path / "populus.db")],
    )
    assert result.exit_code == 1, result.output
    assert "FAILED" in result.output


def test_cli_exit_one_on_failed_uuid(tmp_path):
    cache = _make_cache(
        tmp_path, [_index_row(U1), _index_row(U3, filed="06/30/2026")],
        {f"ptr_{U1}.html": EFILE_1ROW},
    )
    result = CliRunner().invoke(
        cli_main,
        ["ingest", "congress-senate", "--from-cache", str(cache),
         "--db", str(tmp_path / "populus.db")],
    )
    assert result.exit_code == 1
    assert "fetch_failed 1" in result.output


def test_cli_reparse_end_to_end_and_skip_exit(tmp_path):
    cache = _make_cache(
        tmp_path,
        [_index_row(U1), _index_row(U4, filed="06/01/2026")],
        {f"ptr_{U1}.html": EFILE_1ROW},
    )
    db_path = tmp_path / "populus.db"
    runner = CliRunner()
    runner.invoke(
        cli_main,
        ["ingest", "congress-senate", "--from-cache", str(cache),
         "--db", str(db_path)],
    )
    result = runner.invoke(
        cli_main,
        ["reparse", "congress-senate", "--db", str(db_path),
         "--raw-root", str(cache), "--filing", f"senate:{U1}"],
    )
    assert result.exit_code == 0, result.output
    assert "reparse congress-senate | reparsed 1" in result.output

    result = runner.invoke(
        cli_main,
        ["reparse", "congress-senate", "--db", str(db_path),
         "--raw-root", str(cache), "--filing", f"senate:{U4}"],
    )
    assert result.exit_code == 1
    assert "skipped_no_archive" in result.output


def test_cli_reparse_requires_db_and_raw_root(tmp_path):
    result = CliRunner().invoke(cli_main, ["reparse", "congress-senate"])
    assert result.exit_code == 2


# --- cached-corpus acceptance (R16) ------------------------------------------

_HREF_KIND = re.compile(r'href="/search/view/(ptr|paper)/')


def _index_kind_counts() -> tuple[int, Counter]:
    index = json.loads((DATA_CACHE / "ptr-index.json").read_text(encoding="utf-8"))
    kinds: Counter[str] = Counter()
    for row in index["data"]:
        match = _HREF_KIND.search(row[3])
        assert match is not None, row
        kinds[match.group(1)] += 1
    return len(index["data"]), kinds


@pytest.mark.skipif(
    not (DATA_CACHE / "ptr-index.json").exists(),
    reason="data-cache/senate not present (local-only acceptance corpus)",
)
def test_cached_corpus_acceptance(tmp_path):
    index_rows, kinds = _index_kind_counts()
    assert index_rows == 53

    db_path = tmp_path / "acceptance.db"
    init_db(str(db_path))
    conn = connect(str(db_path))
    try:
        report = run_senate_ingest(
            conn,
            raw_root=DATA_CACHE,
            cache_dir=DATA_CACHE,
            run_id="run-acceptance",
            now=_now_factory(),
            host="testhost",
        )
        rec = report.reconciliation
        summary = senate.format_summary(report)
        assert rec is not None, summary
        assert rec.index_count == index_rows
        assert rec.unaccounted == ()
        # Exact status equality, counts derived from the index (R16): every
        # e-filed page parses, every paper page is needs_ocr, nothing else.
        assert rec.status_counts == {
            "parsed": kinds["ptr"],
            "needs_ocr": kinds["paper"],
        }, summary
        assert rec.status_counts.get("partial", 0) == 0
        assert rec.status_counts.get("failed", 0) == 0
        assert report.ok, summary
        assert report.rows_loaded == 991
        assert report.clean_efile_rows == report.total_efile_rows == 991
        assert report.declared_mismatches == 0
        assert report.rejected_rows == ()
        # The 4 real amendments in the cached window pair with nothing
        # unambiguous (Boozman has two same-day originals; the others'
        # originals predate the window) — conservative NULL (§9.5).
        expected_amendments = sum(
            1
            for row in json.loads(
                (DATA_CACHE / "ptr-index.json").read_text(encoding="utf-8")
            )["data"]
            if "(Amendment" in row[3]
        )
        assert report.amendments_total == expected_amendments
        assert report.amendments_paired == 0
        assert conn.execute("SELECT count(*) FROM filings").fetchone() == (
            index_rows,
        )
        assert conn.execute("SELECT count(*) FROM transactions").fetchone() == (991,)
    finally:
        conn.close()


@pytest.mark.skipif(
    not (DATA_CACHE / "ptr-index.json").exists(),
    reason="data-cache/senate not present (local-only acceptance corpus)",
)
def test_cli_cached_corpus_acceptance(tmp_path):
    result = CliRunner().invoke(
        cli_main,
        ["ingest", "congress-senate", "--from-cache", str(DATA_CACHE),
         "--db", str(tmp_path / "acceptance.db")],
    )
    assert result.exit_code == 0, result.output
    assert "index rows 53" in result.output
    assert "parsed 49" in result.output
    assert "needs_ocr 4" in result.output
    assert "efile rows: 991 clean / 991 total = 100.0%" in result.output


# --- submitted-date window seam (RUN M1-B, R14) ------------------------------


def _index_body(transport):
    """The DataTables search body of the first index POST."""
    return next(d for m, u, _h, d in transport.calls if m == "POST" and u == DATA_URL)


def test_default_body_is_byte_identical_to_the_watermark_behaviour(
    tmp_path, initialized_db
):
    """The seam is default-inert: with neither option, the request is exactly
    the one the incremental job has always sent."""
    transport = FakeSenateTransport()
    _route_handshake(transport, [_index_row(U1)])
    transport.route("GET", _doc_url("ptr", U1), _resp(200, EFILE_1ROW))
    _run_live(initialized_db, transport, FakeClock(), raw_root=tmp_path / "raw")

    body = _index_body(transport)
    assert body["submitted_start_date"] == "01/01/2012 00:00:00"   # empty store (LD5)
    assert body["submitted_end_date"] == ""               # no upper bound
    assert body == senate._index_post_body(
        "tok123", submitted_start_date="01/01/2012", start=0
    )


def test_an_explicit_start_bound_is_sent(tmp_path, initialized_db):
    transport = FakeSenateTransport()
    _route_handshake(transport, [_index_row(U1)])
    transport.route("GET", _doc_url("ptr", U1), _resp(200, EFILE_1ROW))
    run_senate_ingest(
        initialized_db, raw_root=tmp_path / "raw", run_id="run-start",
        now=_now_factory(), host="testhost", transport=transport,
        sleep=FakeClock().sleep, monotonic=FakeClock().monotonic,
        jitter=lambda: 0.0, submitted_start_date="01/01/2015",
    )
    body = _index_body(transport)
    assert body["submitted_start_date"] == "01/01/2015 00:00:00"
    assert body["submitted_end_date"] == ""


def test_an_explicit_end_bound_is_sent(tmp_path, initialized_db):
    transport = FakeSenateTransport()
    _route_handshake(transport, [_index_row(U1)])
    transport.route("GET", _doc_url("ptr", U1), _resp(200, EFILE_1ROW))
    run_senate_ingest(
        initialized_db, raw_root=tmp_path / "raw", run_id="run-end",
        now=_now_factory(), host="testhost", transport=transport,
        sleep=FakeClock().sleep, monotonic=FakeClock().monotonic,
        jitter=lambda: 0.0, submitted_end_date="03/31/2016",
    )
    body = _index_body(transport)
    assert body["submitted_start_date"] == "01/01/2012 00:00:00"   # still derived
    assert body["submitted_end_date"] == "03/31/2016 00:00:00"


def test_both_bounds_select_exactly_the_window(tmp_path, initialized_db):
    transport = FakeSenateTransport()
    _route_handshake(transport, [_index_row(U1)])
    transport.route("GET", _doc_url("ptr", U1), _resp(200, EFILE_1ROW))
    report = run_senate_ingest(
        initialized_db, raw_root=tmp_path / "raw", run_id="run-window",
        now=_now_factory(), host="testhost", transport=transport,
        sleep=FakeClock().sleep, monotonic=FakeClock().monotonic,
        jitter=lambda: 0.0,
        submitted_start_date="01/01/2015", submitted_end_date="03/31/2016",
    )
    body = _index_body(transport)
    # The WIRE format carries " 00:00:00" (eFD 503s a bare date — see
    # `_efd_datetime`); the report and summary keep the human date-only form.
    assert (body["submitted_start_date"], body["submitted_end_date"]) == (
        "01/01/2015 00:00:00", "03/31/2016 00:00:00",
    )
    assert report.window == ("01/01/2015", "03/31/2016")
    assert "senate window: submitted 01/01/2015 → 03/31/2016" in senate.format_summary(
        report
    )


def test_a_historical_insert_cannot_regress_the_derived_watermark(
    tmp_path, initialized_db
):
    """Why the historical window is safe against a current corpus: the derived
    start is MAX(filed_date) − 90 days, so inserting OLDER filings leaves it
    exactly where it was."""
    cache = _make_cache(
        tmp_path, [_index_row(U1, filed="07/01/2026")], {f"ptr_{U1}.html": EFILE_1ROW}
    )
    _run_cache(initialized_db, cache)
    before = senate._submitted_start_date(initialized_db)

    cache_old = _make_cache(
        tmp_path / "old",
        [_index_row(U2, title_date="02/10/2015", filed="02/10/2015")],
        {f"ptr_{U2}.html": EFILE_BOND},
    )
    _run_cache(initialized_db, cache_old, run_id="run-hist")
    assert senate._submitted_start_date(initialized_db) == before


def test_cli_accepts_the_window_options_for_senate(tmp_path):
    cache = _make_cache(tmp_path, [_index_row(U1)], {f"ptr_{U1}.html": EFILE_1ROW})
    result = CliRunner().invoke(
        cli_main,
        ["ingest", "congress-senate", "--from-cache", str(cache),
         "--db", str(tmp_path / "populus.db"),
         "--submitted-start", "01/01/2015", "--submitted-end", "03/31/2016"],
    )
    assert result.exit_code == 0, result.output
    assert "parse gate (e-file rows, per chamber-year):" in result.output


@pytest.mark.parametrize("option", ["--submitted-start", "--submitted-end"])
def test_cli_rejects_the_window_options_for_other_jobs(tmp_path, option):
    for job in ("congress-house", "members", "inst-13f"):
        result = CliRunner().invoke(
            cli_main,
            ["ingest", job, "--db", str(tmp_path / "populus.db"),
             option, "01/01/2015"],
        )
        assert result.exit_code == 2, result.output
        assert "congress-senate" in result.output


@pytest.mark.parametrize("value", ["2015-01-01", "1/1/2015", "01/2015", "nonsense"])
def test_cli_rejects_a_malformed_window_bound(tmp_path, value):
    result = CliRunner().invoke(
        cli_main,
        ["ingest", "congress-senate", "--db", str(tmp_path / "populus.db"),
         "--from-cache", str(tmp_path), "--submitted-start", value],
    )
    assert result.exit_code == 2
    assert "MM/DD/YYYY" in result.output


# --- cross-year amendment pair (RUN M1-B, R10) -------------------------------


def test_cross_year_amendment_pair_links_flags_both_sides_and_excludes_original(
    tmp_path, initialized_db
):
    """A 2015 original whose amendment is submitted in 2016 — the pair a
    2015-only window could never observe, which is why the Phase A Senate window
    carries the Q1-2016 tail."""
    from populus.amendments import ensure_views

    ensure_views(initialized_db)
    rows = [
        _index_row(U1, title_date="12/15/2015", filed="12/15/2015"),
        _index_row(U2, title_date="12/15/2015", filed="01/20/2016", amendment=True),
    ]
    cache = _make_cache(
        tmp_path, rows,
        {f"ptr_{U1}.html": EFILE_1ROW, f"ptr_{U2}.html": EFILE_BOND},
    )
    report = _run_cache(initialized_db, cache)
    assert report.ok, senate.format_summary(report)
    assert (report.amendments_total, report.amendments_paired) == (1, 1)

    *_, kind, supersedes, _lifecycle = _filing(initialized_db, U2)
    assert (kind, supersedes) == ("ptr_amendment", f"senate:{U1}")
    # Both sides flagged — the amendment from normalization, the original from
    # the propagation pass.
    assert all("amendment_unresolved" in f for f in _row_flags(initialized_db, U1))
    assert all("amendment_unresolved" in f for f in _row_flags(initialized_db, U2))

    # And the default view excludes the superseded original — no double count.
    default_filings = {
        f for (f,) in initialized_db.execute(
            "SELECT DISTINCT filing_id FROM v_default_transactions"
        )
    }
    assert f"senate:{U1}" not in default_filings
    assert f"senate:{U2}" in default_filings


# --- session instrumentation (RUN M1-B, R20) ---------------------------------


def test_senate_retry_path_counts_two_attempts_one_retry_and_one_backoff(
    tmp_path, initialized_db
):
    transport = FakeSenateTransport()
    _route_handshake(transport, [_index_row(U1)])
    transport.route(
        "GET", _doc_url("ptr", U1), _resp(429), _resp(200, EFILE_1ROW)
    )
    clock = FakeClock()
    report = _run_live(initialized_db, transport, clock, raw_root=tmp_path / "raw")
    assert report.ok, senate.format_summary(report)

    # home GET + agreement POST + index POST + detail 429 + detail 200
    assert report.fetch.attempts == 5
    assert report.fetch.retries == 1
    assert report.fetch.status_counts == {200: 3, 302: 1, 429: 1}
    assert report.fetch.backoff_sleep_s == BACKOFF_SCHEDULE[0]
    assert BACKOFF_SCHEDULE[0] in clock.sleeps

    summary = senate.format_summary(report)
    assert "senate transport: attempts 5 | retries 1" in summary
    assert "status mix 200:3, 302:1, 429:1" in summary


def test_senate_no_retry_path_counts_no_retries_and_no_backoff(
    tmp_path, initialized_db
):
    transport = FakeSenateTransport()
    _route_handshake(transport, [_index_row(U1)])
    transport.route("GET", _doc_url("ptr", U1), _resp(200, EFILE_1ROW))
    clock = FakeClock()
    report = _run_live(initialized_db, transport, clock, raw_root=tmp_path / "raw")
    assert report.fetch.attempts == 4
    assert report.fetch.retries == 0
    assert report.fetch.backoff_sleep_s == 0.0
    assert report.fetch.status_counts == {200: 3, 302: 1}


def test_senate_elapsed_comes_from_the_injected_monotonic_and_is_none_in_cache_mode(
    tmp_path, initialized_db
):
    class _RecordingClock:
        def __init__(self):
            self.now = 5_000_000.0
            self.seen: list[float] = []

        def monotonic(self) -> float:
            self.seen.append(self.now)
            self.now += 2.5
            return self.seen[-1]

        def sleep(self, _seconds: float) -> None:
            pass

    transport = FakeSenateTransport()
    _route_handshake(transport, [_index_row(U1)])
    transport.route("GET", _doc_url("ptr", U1), _resp(200, EFILE_1ROW))
    clock = _RecordingClock()
    report = _run_live(initialized_db, transport, clock, raw_root=tmp_path / "raw")
    assert report.elapsed_s == clock.seen[-1] - clock.seen[0]
    assert report.elapsed_s > 0

    cache = _make_cache(tmp_path, [_index_row(U3)], {f"ptr_{U3}.html": EFILE_1ROW})
    cached = _run_cache(initialized_db, cache, run_id="run-cache-elapsed")
    assert cached.elapsed_s is None
    assert cached.fetch.attempts == 0
    assert "elapsed n/a (cache mode)" in senate.format_summary(cached)


def test_a_tripped_breaker_still_reports_what_the_session_actually_did(
    tmp_path, initialized_db
):
    """The counters are finalized on every exit path, including the one that
    stops the job — an operational record that vanished on the failure path
    would be worthless exactly when it is needed."""
    transport = FakeSenateTransport()
    _route_handshake(transport, [_index_row(U1), _index_row(U2), _index_row(U3)])
    for uuid in (U1, U2, U3):
        transport.route("GET", _doc_url("ptr", uuid), _resp(403))
    report = _run_live(
        initialized_db, transport, FakeClock(), raw_root=tmp_path / "raw"
    )
    assert report.circuit_open_url is not None
    assert report.fetch.attempts > 0
    assert report.fetch.status_counts[403] == CIRCUIT_403_THRESHOLD
    assert "senate transport: attempts" in senate.format_summary(report)


def test_the_wire_date_always_carries_a_time_component():
    """eFD answers 503 — not 400 — to a submitted-date without a time.

    Established 2026-08-07 by a controlled pair on one session, three seconds
    apart: `08/01/2026 00:00:00` → 200, `08/01/2026` → 503. The date-only form
    worked historically; the server changed under us, and the 503 spent a day
    masquerading as an outage (it survived five wrong hypotheses: IP blocking,
    headers, connection reuse, page length, user-agent). Every path into the
    body — CLI windows, watermark defaults, era bounds — must pass through the
    one normalizer, so no caller can reintroduce the bare form.
    """
    body = senate._index_post_body("tok", submitted_start_date="01/01/2012", start=0)
    assert body["submitted_start_date"].endswith(" 00:00:00")
    bounded = senate._index_post_body(
        "tok", submitted_start_date="01/01/2015", submitted_end_date="12/31/2015", start=0
    )
    assert bounded["submitted_end_date"].endswith(" 00:00:00")
    # A value that already carries a time must pass through untouched, not
    # gain a second one.
    explicit = senate._index_post_body(
        "tok", submitted_start_date="01/01/2015 12:30:00", start=0
    )
    assert explicit["submitted_start_date"] == "01/01/2015 12:30:00"


def test_a_transport_timeout_is_retried_like_a_5xx():
    """Run 8 died on a bare `httpx.ReadTimeout` after the whole House leg had
    already succeeded — hours of work lost to one slow eFD response.

    A transport failure is the same operational event as a 5xx: eFD did not
    answer this time. It rides the EXISTING backoff ladder rather than a second
    policy that could drift from the first.
    """
    calls = {"n": 0}

    class FlakyTransport:
        def get(self, url, *, headers):
            calls["n"] += 1
            if calls["n"] == 1:
                raise senate.TransportFailure("GET: ReadTimeout: timed out")
            return senate.TransportResponse(status_code=200, content=b"ok", headers={})

        def post(self, url, *, data, headers):  # pragma: no cover - unused here
            raise AssertionError("not reached")

    slept: list[float] = []
    session = senate._PoliteSession(
        transport=FlakyTransport(), sleep=slept.append,
        monotonic=lambda: 0.0, jitter=lambda: 0.0,
    )
    response = session.get("https://efdsearch.senate.gov/search/home/", headers={})

    assert response.status_code == 200, "the retry did not recover the request"
    assert calls["n"] == 2, "the timeout was not retried"
    assert session.retries == 1
    assert slept, "the retry did not back off"
    # Counted under the synthetic status so the transport summary shows it.
    assert session.status_counts[senate.TRANSPORT_FAILURE_STATUS] == 1


def test_a_transport_that_never_answers_still_gives_up():
    """The ladder is finite: an eFD that is genuinely down must not spin forever."""
    class DeadTransport:
        def get(self, url, *, headers):
            raise senate.TransportFailure("GET: ConnectError: refused")

        def post(self, url, *, data, headers):  # pragma: no cover
            raise AssertionError("not reached")

    session = senate._PoliteSession(
        transport=DeadTransport(), sleep=lambda _: None,
        monotonic=lambda: 0.0, jitter=lambda: 0.0,
    )
    response = session.get("https://efdsearch.senate.gov/search/home/", headers={})
    assert response.status_code == senate.TRANSPORT_FAILURE_STATUS
