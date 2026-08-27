"""House ingest orchestration: discovery, politeness, statuses, audit,
reconciliation, CLI, and archive-safe reparse (RUN 2; R1–R3, R12–R22, R25).

All live-path behavior is exercised through an injected fake transport and
fake clock — the autouse socket guard proves nothing escapes to the network.
The cached-2026 acceptance test auto-skips when ``data-cache/`` is absent.
"""

from __future__ import annotations

import codecs
import hashlib
import io
import itertools
import json
import zipfile
from datetime import date
from pathlib import Path

import pytest
from click.testing import CliRunner

from populus.cli import main as cli_main
from populus.db import connect, init_db
from populus.ingest import house
from populus.ingest.house import (
    BACKOFF_SCHEDULE,
    MIN_SPACING_S,
    USER_AGENT,
    DiscoverResult,
    ReparseSelector,
    TransportResponse,
    default_years,
    discover,
    reparse_house,
    run_house_ingest,
    select_reparse_targets,
)
from populus.parse import house_ptr
from populus.parse.house_ptr import (
    EmptyParseError,
    PtrHeader,
    PtrParse,
    segment_text_rows,
)

FIXTURES = Path(__file__).parent / "fixtures" / "house"
DATA_CACHE = Path(__file__).resolve().parent.parent / "data-cache" / "house"

EFILE_2026 = (FIXTURES / "2026_20034916.pdf").read_bytes()
EFILE_2026_B = (FIXTURES / "2026_20034800.pdf").read_bytes()
PAPER_2026 = (FIXTURES / "2026_9116146.pdf").read_bytes()
EFILE_2020 = (FIXTURES / "2020_20013901.pdf").read_bytes()
EFILE_2015 = (FIXTURES / "2015_20002703.pdf").read_bytes()

INDEX_URL = house.INDEX_URL_TEMPLATE.format(year=2026)


def _pdf_url(doc_id, year=2026):
    return house.DOC_URL_TEMPLATE.format(year=year, doc_id=doc_id)


# --- synthetic index / cache builders ---------------------------------------


def _index_xml(year, members) -> bytes:
    """A faithful miniature of the Clerk index: UTF-8 BOM, CRLF, M/D/YYYY."""
    rows = "".join(
        "<Member><Prefix />"
        f"<Last>{m.get('last', 'Doe')}</Last><First>{m.get('first', 'Jane')}</First>"
        f"<Suffix>{m.get('suffix', '')}</Suffix>"
        f"<FilingType>{m.get('type', 'P')}</FilingType>"
        f"<StateDst>{m.get('state', 'VA01')}</StateDst>"
        f"<Year>{year}</Year>"
        f"<FilingDate>{m.get('filed', f'7/2/{year}')}</FilingDate>"
        f"<DocID>{m['docid']}</DocID></Member>\r\n"
        for m in members
    )
    xml = (
        '<?xml version="1.0" encoding="utf-8"?>\r\n'
        f"<FinancialDisclosure>\r\n{rows}</FinancialDisclosure>"
    )
    return codecs.BOM_UTF8 + xml.encode("utf-8")


def _index_zip(year, members) -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        archive.writestr(f"{year}FD.xml", _index_xml(year, members))
        archive.writestr(f"{year}FD.txt", "not the parsed member")
    return buffer.getvalue()


def _make_cache(tmp_path, year, members, pdfs) -> Path:
    cache = tmp_path / "cache"
    (cache / "pdfs" / str(year)).mkdir(parents=True, exist_ok=True)
    (cache / f"{year}FD.xml").write_bytes(_index_xml(year, members))
    for doc_id, data in pdfs.items():
        (cache / "pdfs" / str(year) / f"{doc_id}.pdf").write_bytes(data)
    return cache


WITTMAN = {"docid": "20034916", "last": "Wittman", "first": "Robert J.", "filed": "7/10/2026"}
FIELDS = {"docid": "20034800", "last": "Fields", "first": "Cleo", "filed": "6/26/2026"}
PAPER_ROGERS = {"docid": "9116146", "last": "Rogers", "first": "Harold", "filed": "6/10/2026"}


# --- fakes -------------------------------------------------------------------


def _resp(status=200, content=b"", headers=None) -> TransportResponse:
    return TransportResponse(
        status_code=status, headers=dict(headers or {}), content=content
    )


class FakeTransport:
    """URL → queued responses; the last response repeats. Records all calls."""

    def __init__(self):
        self.routes: dict[str, list[TransportResponse]] = {}
        self.calls: list[tuple[str, dict[str, str]]] = []

    def route(self, url, *responses):
        self.routes[url] = list(responses)

    def get(self, url, *, headers):
        self.calls.append((url, dict(headers)))
        queue = self.routes[url]
        return queue.pop(0) if len(queue) > 1 else queue[0]

    def urls(self):
        return [url for url, _headers in self.calls]


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


def _run(conn, **overrides):
    kwargs = dict(
        years=[2026],
        raw_root=overrides.pop("raw_root"),
        run_id=overrides.pop("run_id", "run-test-1"),
        now=_now_factory(),
        host="testhost",
    )
    kwargs.update(overrides)
    return run_house_ingest(conn, **kwargs)


def _filing(conn, doc_id):
    return conn.execute(
        "SELECT parse_status, raw_path, response_hash, row_count, doc_url,"
        " filer_name_raw, filed_date FROM filings WHERE filing_id = ?",
        (f"house:{doc_id}",),
    ).fetchone()


# --- year window (R18/LD1) ---------------------------------------------------


def test_default_years_injected_dates():
    assert default_years(date(2026, 12, 15)) == [2026]
    assert default_years(date(2026, 1, 5)) == [2026, 2025]
    assert default_years(date(2026, 2, 1)) == [2026]
    assert default_years(date(2026, 7, 22)) == [2026]


# --- discovery (R1) ----------------------------------------------------------


def test_discover_filters_dedupes_and_reads_cache(tmp_path):
    cache = _make_cache(
        tmp_path,
        2026,
        [
            {"docid": "8068", "type": "W"},
            WITTMAN,
            {"docid": "10078673", "type": "C"},
            WITTMAN,  # duplicate P entry
            dict(FIELDS, suffix="Jr."),
        ],
        {},
    )
    result = discover(year=2026, cache_dir=cache)
    assert result.docids == ("20034916", "20034800")
    assert result.dup_docids == 1
    assert result.entries["20034916"].filer_name_raw == "Wittman, Robert J."
    assert result.entries["20034916"].filed_date == "2026-07-10"
    assert result.entries["20034800"].filer_name_raw == "Fields, Cleo Jr."


def test_discover_cache_missing_year_skips_with_note(tmp_path):
    # From-cache: an absent year is an approved SKIP, not a failure (LD1).
    result = discover(year=2020, cache_dir=tmp_path)
    assert result.docids == ()
    assert result.note is not None and "2020" in result.note
    assert result.failed is False


# --- live-discovery failure is explicit (F1/R1/R15) --------------------------


def _discover_live(tmp_path, *responses, seed_xml=None):
    transport = FakeTransport()
    clock = FakeClock()
    transport.route(INDEX_URL, *responses)
    raw_root = tmp_path / "raw"
    raw_root.mkdir(parents=True, exist_ok=True)
    if seed_xml is not None:
        (raw_root / "2026FD.xml").write_bytes(seed_xml)
    fetcher = house._PoliteFetcher(
        transport, sleep=clock.sleep, monotonic=clock.monotonic
    )
    return discover(year=2026, raw_root=raw_root, fetcher=fetcher), transport, clock


def test_discover_live_non_200_is_a_failure(tmp_path):
    result, _t, _c = _discover_live(tmp_path, _resp(404))
    assert result.failed is True
    assert result.docids == ()
    assert "404" in result.note


def test_discover_live_retry_exhaustion_is_a_failure(tmp_path):
    result, transport, clock = _discover_live(tmp_path, _resp(503))
    assert result.failed is True
    assert len(transport.calls) == 1 + len(BACKOFF_SCHEDULE)
    for delay in BACKOFF_SCHEDULE:
        assert delay in clock.sleeps


def test_discover_live_304_without_archived_xml_is_a_failure(tmp_path):
    result, _t, _c = _discover_live(tmp_path, _resp(304))
    assert result.failed is True
    assert "304" in result.note


def test_discover_live_304_with_archived_xml_succeeds(tmp_path):
    result, _t, _c = _discover_live(
        tmp_path, _resp(304), seed_xml=_index_xml(2026, [WITTMAN])
    )
    assert result.failed is False
    assert result.docids == ("20034916",)


def test_discover_live_zip_without_xml_member_is_a_failure(tmp_path):
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        archive.writestr("2026FD.txt", "no xml here")
    result, _t, _c = _discover_live(tmp_path, _resp(200, buffer.getvalue()))
    assert result.failed is True
    assert "no XML member" in result.note


def test_discover_live_unreadable_zip_is_a_failure(tmp_path):
    result, _t, _c = _discover_live(tmp_path, _resp(200, b"not a zip at all"))
    assert result.failed is True
    assert "unreadable" in result.note


# --- index-ZIP ceilings (RUN PUBLIC-SECURITY-HARDENING, R9/LD10) --------------


def _custom_zip(members) -> bytes:
    """A ZIP with exact member names/bytes: [(name, data), ...]."""
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
        for name, data in members:
            archive.writestr(name, data)
    return buffer.getvalue()


def _assert_no_partial_writes(tmp_path):
    raw_root = tmp_path / "raw"
    for name in ("2026FD.zip", "2026FD.xml", "2026FD.zip.meta.json"):
        assert not (raw_root / name).exists(), f"{name} written on a breach"


def test_zip_with_duplicate_xml_members_is_a_failure(tmp_path):
    payload = _custom_zip(
        [("2026FD.xml", _index_xml(2026, [WITTMAN])), ("extra.xml", b"<x/>")]
    )
    result, _t, _c = _discover_live(tmp_path, _resp(200, payload))
    assert result.failed is True
    assert "exactly one" in result.note
    _assert_no_partial_writes(tmp_path)


def test_zip_directory_member_is_not_the_xml_member(tmp_path):
    payload = _custom_zip([("2026FD.xml/", b"")])
    result, _t, _c = _discover_live(tmp_path, _resp(200, payload))
    assert result.failed is True
    assert "no XML member" in result.note
    _assert_no_partial_writes(tmp_path)


@pytest.mark.parametrize(
    "name", ["../evil.xml", "/abs.xml", "a/../../b.xml", "up\\down.xml"]
)
def test_zip_traversing_member_name_is_a_failure(tmp_path, name):
    payload = _custom_zip([(name, _index_xml(2026, [WITTMAN]))])
    result, _t, _c = _discover_live(tmp_path, _resp(200, payload))
    assert result.failed is True
    assert "non-traversing" in result.note
    _assert_no_partial_writes(tmp_path)


def test_compressed_body_over_the_zip_cap_is_a_failure(tmp_path, monkeypatch):
    monkeypatch.setattr(house, "HOUSE_ZIP_CAP", 64)
    payload = _custom_zip([("2026FD.xml", _index_xml(2026, [WITTMAN]))])
    assert len(payload) > 64
    result, _t, _c = _discover_live(tmp_path, _resp(200, payload))
    assert result.failed is True
    assert "compressed cap" in result.note
    _assert_no_partial_writes(tmp_path)


def test_declared_oversize_xml_member_is_a_failure(tmp_path, monkeypatch):
    monkeypatch.setattr(house, "XML_MEMBER_CAP", 128)
    payload = _custom_zip([("2026FD.xml", _index_xml(2026, [WITTMAN]))])
    result, _t, _c = _discover_live(tmp_path, _resp(200, payload))
    assert result.failed is True
    assert "uncompressed cap" in result.note
    _assert_no_partial_writes(tmp_path)


def test_ratio_bomb_is_a_failure_without_extraction(tmp_path):
    # 8 MiB of zeros deflates to ~8 KiB: a >100:1 declared ratio — refused
    # from the central directory, with the real (unmonkeypatched) ceilings.
    payload = _custom_zip([("2026FD.xml", b"\0" * (8 * 1024 * 1024))])
    assert len(payload) < house.HOUSE_ZIP_CAP
    result, _t, _c = _discover_live(tmp_path, _resp(200, payload))
    assert result.failed is True
    assert "ratio" in result.note
    _assert_no_partial_writes(tmp_path)


def test_corrupt_zip_member_data_is_a_failure(tmp_path):
    payload = bytearray(_custom_zip([("2026FD.xml", _index_xml(2026, [WITTMAN]))]))
    # Flip bytes inside the compressed data (past the local header).
    for offset in range(60, 72):
        payload[offset] ^= 0xFF
    result, _t, _c = _discover_live(tmp_path, _resp(200, bytes(payload)))
    assert result.failed is True
    _assert_no_partial_writes(tmp_path)


def test_doctype_bearing_index_xml_is_refused_and_never_archived(tmp_path):
    evil = (
        b'<?xml version="1.0"?><!DOCTYPE FinancialDisclosure ['
        b'<!ENTITY x "y">]><FinancialDisclosure>&x;</FinancialDisclosure>'
    )
    payload = _custom_zip([("2026FD.xml", evil)])
    result, _t, _c = _discover_live(tmp_path, _resp(200, payload))
    assert result.failed is True
    assert "refused" in result.note
    _assert_no_partial_writes(tmp_path)


def test_a_clean_index_zip_passes_all_ceilings_and_is_archived(tmp_path):
    payload = _custom_zip([("2026FD.xml", _index_xml(2026, [WITTMAN]))])
    result, _t, _c = _discover_live(tmp_path, _resp(200, payload))
    assert result.failed is False
    assert result.docids == ("20034916",)
    raw_root = tmp_path / "raw"
    assert (raw_root / "2026FD.zip").read_bytes() == payload
    assert (raw_root / "2026FD.xml").read_bytes() == _index_xml(2026, [WITTMAN])
    assert (raw_root / "2026FD.zip.meta.json").exists()


@pytest.mark.parametrize(
    "responses,seed",
    [
        ((_resp(404),), None),
        ((_resp(503),), None),
        ((_resp(304),), None),
        ((_resp(200, b"not a zip"),), None),
    ],
)
def test_discovery_failure_never_reports_success(
    tmp_path, initialized_db, responses, seed
):
    # The false-success mode: no reconciliation exists, so counting only
    # failed/unaccounted DocIDs would report ok. The run must be not-ok, the
    # audit 'partial', and the CLI exit 1.
    transport = FakeTransport()
    clock = FakeClock()
    transport.route(INDEX_URL, *responses)
    report = _run(
        initialized_db,
        raw_root=tmp_path / "raw",
        transport=transport,
        sleep=clock.sleep,
        monotonic=clock.monotonic,
    )
    year = report.years[0]
    assert year.discovery_failed is True
    assert year.reconciliation is None
    assert report.discovery_failures == 1
    assert not report.ok
    assert initialized_db.execute(
        "SELECT status FROM ingest_runs WHERE run_id = 'run-test-1'"
    ).fetchone() == ("partial",)
    assert "FAILED" in house.format_summary(report)


def test_cli_exits_one_on_live_discovery_failure(tmp_path, monkeypatch):
    import time as time_module

    transport = FakeTransport()
    transport.route(INDEX_URL, _resp(500))
    monkeypatch.setattr(house, "HttpxTransport", lambda: transport)
    monkeypatch.setattr(time_module, "sleep", lambda _s: None)
    db_path = tmp_path / "populus.db"
    result = CliRunner().invoke(
        cli_main,
        ["ingest", "congress-house", "--raw-root", str(tmp_path / "raw"),
         "--db", str(db_path), "--year", "2026"],
    )
    assert result.exit_code == 1, result.output
    assert "FAILED" in result.output


def test_discover_live_conditional_get(tmp_path):
    transport = FakeTransport()
    clock = FakeClock()
    zip_bytes = _index_zip(2026, [WITTMAN])
    transport.route(
        INDEX_URL,
        _resp(200, zip_bytes, {"ETag": '"tag-1"', "Last-Modified": "Fri, 10 Jul 2026 00:00:00 GMT"}),
        _resp(304),
    )
    raw_root = tmp_path / "raw"
    fetcher = house._PoliteFetcher(transport, sleep=clock.sleep, monotonic=clock.monotonic)

    first = discover(year=2026, raw_root=raw_root, fetcher=fetcher)
    assert first.docids == ("20034916",)
    assert (raw_root / "2026FD.zip").read_bytes() == zip_bytes
    assert (raw_root / "2026FD.xml").exists()
    meta = json.loads((raw_root / "2026FD.zip.meta.json").read_text())
    # The conditional-GET validators, plus the archived ZIP's own hash for
    # §5.1 provenance parity with the per-document sidecars (RUN M1-B, R2).
    assert meta == {
        "etag": '"tag-1"',
        "last_modified": "Fri, 10 Jul 2026 00:00:00 GMT",
        "response_hash": hashlib.sha256(zip_bytes).hexdigest(),
    }

    second = discover(year=2026, raw_root=raw_root, fetcher=fetcher)
    assert second.docids == ("20034916",)
    _url, headers = transport.calls[1]
    assert headers["If-None-Match"] == '"tag-1"'
    assert headers["If-Modified-Since"] == "Fri, 10 Jul 2026 00:00:00 GMT"


# --- DocID validation and archive containment (F2/R2 security) --------------

TRAVERSAL_DOCIDS = [
    "../../../../etc/passwd",
    "..%2f..%2fescape",
    "/absolute/path",
    "20034916/../../escape",
    "2003\\4916",
    "20034916.pdf",
    "abc123",
    "2003 4916",
    "",
]


@pytest.mark.parametrize("doc_id", [d for d in TRAVERSAL_DOCIDS if d])
def test_malicious_docids_are_rejected_at_the_index_boundary(doc_id):
    result = house._index_entries(
        _index_xml(2026, [{"docid": doc_id, "filed": "7/2/2026"}]), 2026
    )
    assert result.docids == ()
    assert result.entries == {}
    assert result.rejected_docids == (doc_id,)


@pytest.mark.parametrize("doc_id", ["20034916", "9116146", "8068", "1234567890"])
def test_real_corpus_docid_shapes_are_accepted(doc_id):
    # Every DocID in the cached 2015/2020/2026 indexes is purely numeric
    # (4, 7, or 8 digits); the validator must not reject legitimate filings.
    result = house._index_entries(
        _index_xml(2026, [{"docid": doc_id, "filed": "7/2/2026"}]), 2026
    )
    assert result.docids == (doc_id,)
    assert result.rejected_docids == ()


@pytest.mark.parametrize("doc_id", [d for d in TRAVERSAL_DOCIDS if d])
def test_archive_relpath_refuses_unvalidated_docid(doc_id):
    with pytest.raises(house.UnsafeArchivePathError):
        house._archive_relpath(2026, doc_id)


def test_archive_path_enforces_containment(tmp_path):
    root = tmp_path / "raw"
    root.mkdir()
    assert house._archive_path(root, "pdfs/2026/20034916.pdf") == (
        root.resolve() / "pdfs" / "2026" / "20034916.pdf"
    )
    for escaping in ("../outside.pdf", "pdfs/../../outside.pdf", "/etc/passwd"):
        with pytest.raises(house.UnsafeArchivePathError):
            house._archive_path(root, escaping)


def test_traversal_docid_never_writes_outside_raw_root(tmp_path, initialized_db):
    # End-to-end: a compromised index entry must not place bytes anywhere,
    # must be visible in the report, and must make the run not-ok (G3).
    outside = tmp_path / "outside"
    outside.mkdir()
    transport = FakeTransport()
    clock = FakeClock()
    transport.route(
        INDEX_URL,
        _resp(200, _index_zip(2026, [
            {"docid": "../../outside/pwned", "filed": "7/2/2026"}, WITTMAN,
        ])),
    )
    transport.route(_pdf_url("20034916"), _resp(200, EFILE_2026))
    report = _run(
        initialized_db,
        raw_root=tmp_path / "raw",
        transport=transport,
        sleep=clock.sleep,
        monotonic=clock.monotonic,
    )
    assert list(outside.iterdir()) == []
    assert not (tmp_path / "outside" / "pwned.pdf").exists()
    # Only the legitimate DocID was ever requested.
    assert transport.urls().count(_pdf_url("20034916")) == 1
    assert all("pwned" not in url for url in transport.urls())
    year = report.years[0]
    assert year.rejected_docids == ("../../outside/pwned",)
    assert not report.ok
    assert "REJECTED DOCIDS" in house.format_summary(report)
    # The legitimate filing still ingested (rejection is per-DocID, not fatal).
    assert _filing(initialized_db, "20034916")[0] == "parsed"


# --- politeness and retries (R2) ---------------------------------------------


def _live_run(tmp_path, transport, clock, members, initialized_db):
    raw_root = tmp_path / "raw"
    return _run(
        initialized_db,
        raw_root=raw_root,
        transport=transport,
        sleep=clock.sleep,
        monotonic=clock.monotonic,
    )


def test_live_fetch_ua_spacing_archive(tmp_path, initialized_db):
    transport = FakeTransport()
    clock = FakeClock()
    transport.route(INDEX_URL, _resp(200, _index_zip(2026, [WITTMAN, FIELDS])))
    transport.route(_pdf_url("20034916"), _resp(200, EFILE_2026))
    transport.route(_pdf_url("20034800"), _resp(200, EFILE_2026_B))
    report = _live_run(tmp_path, transport, clock, None, initialized_db)

    # Exact identifying UA on every call (G6).
    assert transport.calls
    assert all(h["User-Agent"] == USER_AGENT for _url, h in transport.calls)
    # Strictly sequential with >= MIN_SPACING_S between consecutive fetches:
    # 3 requests, 2 spacing sleeps.
    assert clock.sleeps == [MIN_SPACING_S, MIN_SPACING_S]

    # Raw bytes archived, path + sha256 recorded (R2).
    status, raw_path, response_hash, row_count, doc_url, name, filed = _filing(
        initialized_db, "20034916"
    )
    assert status == "parsed"
    assert raw_path == "pdfs/2026/20034916.pdf"
    assert (tmp_path / "raw" / raw_path).read_bytes() == EFILE_2026
    assert response_hash == hashlib.sha256(EFILE_2026).hexdigest()
    assert doc_url == _pdf_url("20034916")
    assert name == "Wittman, Robert J."
    assert filed == "2026-07-10"
    assert report.ok


@pytest.mark.parametrize("status", [429, 500, 503])
def test_retryable_status_backs_off_then_recovers(tmp_path, initialized_db, status):
    transport = FakeTransport()
    clock = FakeClock()
    transport.route(INDEX_URL, _resp(200, _index_zip(2026, [WITTMAN])))
    transport.route(
        _pdf_url("20034916"), _resp(status), _resp(200, EFILE_2026)
    )
    report = _live_run(tmp_path, transport, clock, None, initialized_db)
    assert report.ok
    assert _filing(initialized_db, "20034916")[0] == "parsed"
    # One backoff sleep of BACKOFF_SCHEDULE[0] (spacing was already covered
    # by the backoff interval itself).
    assert BACKOFF_SCHEDULE[0] in clock.sleeps


def test_retry_exhaustion_persists_fetch_failed(tmp_path, initialized_db):
    transport = FakeTransport()
    clock = FakeClock()
    transport.route(INDEX_URL, _resp(200, _index_zip(2026, [WITTMAN])))
    transport.route(_pdf_url("20034916"), _resp(503))
    report = _live_run(tmp_path, transport, clock, None, initialized_db)

    # 1 initial + len(BACKOFF_SCHEDULE) retries, with the full delay ladder.
    pdf_calls = [u for u in transport.urls() if u == _pdf_url("20034916")]
    assert len(pdf_calls) == 1 + len(BACKOFF_SCHEDULE)
    for delay in BACKOFF_SCHEDULE:
        assert delay in clock.sleeps

    # Persisted as failed with NULL raw_path — re-fetch-eligible (R17), no
    # out-of-band 'missing' state.
    status, raw_path, response_hash, row_count, *_rest = _filing(
        initialized_db, "20034916"
    )
    assert (status, raw_path, response_hash, row_count) == ("failed", None, None, 0)
    assert not report.ok
    year = report.years[0]
    assert year.failure_kinds["fetch_failed"] == 1
    assert year.reconciliation.total == 1
    audit = initialized_db.execute(
        "SELECT status FROM ingest_runs WHERE run_id = 'run-test-1'"
    ).fetchone()
    assert audit == ("partial",)


@pytest.mark.parametrize("lifecycle", ["superseded", "retired", "withdrawn"])
def test_refetch_preserves_lifecycle(tmp_path, initialized_db, make_filing, lifecycle):
    # Ingest records the parse outcome only; lifecycle records the filing's
    # standing (§9.4). A fetch-failed retry re-evaluates the document but
    # must never reactivate a non-active filing through the upsert.
    make_filing(
        initialized_db,
        filing_id="house:20034916",
        filed_date="2026-07-10",
        parse_status="failed",
        lifecycle=lifecycle,
    )
    cache = _make_cache(tmp_path, 2026, [WITTMAN], {"20034916": EFILE_2026})
    _run(initialized_db, raw_root=cache, cache_dir=cache)
    status, *_rest = _filing(initialized_db, "20034916")
    assert status == "parsed"
    assert initialized_db.execute(
        "SELECT lifecycle FROM filings WHERE filing_id = 'house:20034916'"
    ).fetchone() == (lifecycle,)


def test_new_filing_defaults_to_active_lifecycle(tmp_path, initialized_db):
    cache = _make_cache(tmp_path, 2026, [WITTMAN], {"20034916": EFILE_2026})
    _run(initialized_db, raw_root=cache, cache_dir=cache)
    assert initialized_db.execute(
        "SELECT lifecycle FROM filings WHERE filing_id = 'house:20034916'"
    ).fetchone() == ("active",)


def test_fetch_failed_docid_is_refetched_next_run(tmp_path, initialized_db):
    transport = FakeTransport()
    clock = FakeClock()
    transport.route(INDEX_URL, _resp(200, _index_zip(2026, [WITTMAN])))
    transport.route(_pdf_url("20034916"), _resp(503))
    _live_run(tmp_path, transport, clock, None, initialized_db)

    transport.route(_pdf_url("20034916"), _resp(200, EFILE_2026))
    report = _run(
        initialized_db,
        raw_root=tmp_path / "raw",
        run_id="run-test-2",
        transport=transport,
        sleep=clock.sleep,
        monotonic=clock.monotonic,
    )
    assert report.ok
    assert _filing(initialized_db, "20034916")[0] == "parsed"


# --- cache-mode ingest, statuses, idempotency (R3/R5/R12) --------------------


def test_cache_ingest_statuses_and_reconciliation(tmp_path, initialized_db):
    corrupt = b"%PDF-1.4 not really a pdf"
    cache = _make_cache(
        tmp_path,
        2026,
        [WITTMAN, PAPER_ROGERS, {"docid": "20039999", "filed": "7/2/2026"},
         {"docid": "20038888", "filed": "7/3/2026"}],
        {"20034916": EFILE_2026, "9116146": PAPER_2026, "20038888": corrupt},
    )
    report = _run(initialized_db, raw_root=cache, cache_dir=cache)
    year = report.years[0]
    rec = year.reconciliation

    # Every index PTR DocID lands in exactly one schema parse_status (G3).
    assert rec.index_ptr_count == 4
    assert rec.total == 4
    assert rec.unaccounted == ()
    assert rec.status_counts == {"parsed": 1, "needs_ocr": 1, "failed": 2}
    assert rec.failed_fetch == 1  # 20039999: no cached pdf
    assert rec.failed_archived == 1  # 20038888: unreadable bytes, archived
    assert year.failure_kinds == {"fetch_failed": 1, "unreadable": 1}
    assert not report.ok

    # Paper filing retained with metadata + doc_url and zero rows (R5).
    status, raw_path, _hash, row_count, doc_url, name, filed = _filing(
        initialized_db, "9116146"
    )
    assert status == "needs_ocr"
    assert raw_path == "pdfs/2026/9116146.pdf"
    assert row_count == 0
    assert doc_url == _pdf_url("9116146")
    assert name == "Rogers, Harold"
    assert filed == "2026-06-10"

    summary = house.format_summary(report)
    assert "index PTRs 4" in summary
    assert "fetch_failed 1" in summary
    assert "unreadable 1" in summary


def test_second_identical_run_adds_nothing(tmp_path, initialized_db):
    cache = _make_cache(tmp_path, 2026, [WITTMAN], {"20034916": EFILE_2026})
    first = _run(initialized_db, raw_root=cache, cache_dir=cache)
    assert first.years[0].new_filings == 1
    before = initialized_db.execute("SELECT count(*) FROM transactions").fetchone()
    second = _run(
        initialized_db, raw_root=cache, cache_dir=cache, run_id="run-test-2"
    )
    assert second.years[0].new_filings == 0
    assert second.ok
    after = initialized_db.execute("SELECT count(*) FROM transactions").fetchone()
    assert after == before


def test_classifier_conflict_counts_as_paper(tmp_path, initialized_db):
    # E-file text under a paper-shaped DocID: conservative needs_ocr + a
    # conflict tick in the summary (tech-debt: not persisted per filing).
    cache = _make_cache(
        tmp_path,
        2026,
        [{"docid": "9134916", "filed": "7/10/2026"}],
        {"9134916": EFILE_2026},
    )
    report = _run(initialized_db, raw_root=cache, cache_dir=cache)
    assert report.years[0].conflicts == 1
    assert _filing(initialized_db, "9134916")[0] == "needs_ocr"
    assert "conflicts 1" in house.format_summary(report)


# --- zero-candidate guard at ingest level (R20/LD24) -------------------------


def test_empty_parse_is_failed_not_refetched_then_reparse_recovers(
    tmp_path, initialized_db, monkeypatch
):
    cache = _make_cache(tmp_path, 2026, [WITTMAN], {"20034916": EFILE_2026})

    def _empty(pdf_bytes, *, doc_id):
        raise EmptyParseError("injected zero candidates")

    monkeypatch.setattr(house, "parse_ptr", _empty)
    report = _run(initialized_db, raw_root=cache, cache_dir=cache)
    status, raw_path, _hash, row_count, *_ = _filing(initialized_db, "20034916")
    assert status == "failed"
    assert raw_path == "pdfs/2026/20034916.pdf"  # archive retained
    assert row_count == 0
    assert report.years[0].failure_kinds["empty_parse"] == 1
    assert not report.ok
    assert "empty_parse 1" in house.format_summary(report)

    # Second run: archived ⇒ settled ⇒ not re-processed, still failed.
    second = _run(
        initialized_db, raw_root=cache, cache_dir=cache, run_id="run-test-2"
    )
    assert second.years[0].new_filings == 0

    # Parser fixed (monkeypatch gone) ⇒ reparse from the archive recovers.
    monkeypatch.setattr(house, "parse_ptr", house_ptr.parse_ptr)
    reparse_report = reparse_house(
        initialized_db, raw_root=cache, selector=ReparseSelector()
    )
    assert reparse_report.statuses == {"house:20034916": "parsed"}
    assert _filing(initialized_db, "20034916")[0] == "parsed"


# --- flag taxonomy at ingest level (R21) -------------------------------------

BASE_RAW = {
    "owner": "SP",
    "asset_name": "Acme Corp (ACME) [ST]",
    "ticker": "ACME",
    "side": "P",
    "transaction_date": "7/1/2026",
    "amount_label": "$1,001 - $15,000",
    "comment": None,
}

DEFECT_CASES = {
    "side_unparsed": (dict(BASE_RAW, side="Q"), None, frozenset()),
    "owner_unparsed": (dict(BASE_RAW, owner="QQ"), None, frozenset()),
    "amount_unparsed": (dict(BASE_RAW, amount_label="$1 to $2"), None, frozenset()),
    "date_missing": (dict(BASE_RAW, transaction_date=None), None, frozenset()),
    "asset_unparsed": (dict(BASE_RAW, asset_name=None, ticker=None), None, frozenset()),
    "capgains_unparsed": (BASE_RAW, "??", frozenset()),
    "row_incomplete": (BASE_RAW, None, frozenset({"row_incomplete"})),
    "row_orphan": (BASE_RAW, None, frozenset({"row_incomplete", "row_orphan"})),
    "text_fallback": (BASE_RAW, None, frozenset({"text_fallback"})),
}


def _fake_parse(raw_row, cap_gains_cell, structural_flags):
    row = house_ptr.PtrRow(
        raw_row=raw_row,
        cap_gains_cell=cap_gains_cell,
        source_row_no=None,
        row_ordinal=1,
        structural_flags=structural_flags,
    )
    return PtrParse(
        header=PtrHeader(name="Hon. Test", status="Member", state_district="VA01"),
        rows=(row,),
        path="positioned",
        cap_gains_column=True,
    )


@pytest.mark.parametrize("flag", sorted(DEFECT_CASES))
def test_each_defect_flag_makes_filing_partial_and_row_unclean(
    tmp_path, initialized_db, monkeypatch, flag
):
    raw_row, capgains, structural = DEFECT_CASES[flag]
    monkeypatch.setattr(
        house, "parse_ptr", lambda data, *, doc_id: _fake_parse(raw_row, capgains, structural)
    )
    cache = _make_cache(tmp_path, 2026, [WITTMAN], {"20034916": EFILE_2026})
    report = _run(initialized_db, raw_root=cache, cache_dir=cache)
    year = report.years[0]
    assert _filing(initialized_db, "20034916")[0] == "partial"
    assert year.total_efile_rows == 1
    assert year.clean_efile_rows == 0
    flags = json.loads(
        initialized_db.execute(
            "SELECT flags FROM transactions WHERE filing_id = 'house:20034916'"
        ).fetchone()[0]
    )
    assert flag in flags


def test_source_fact_only_rows_are_parsed_and_clean(tmp_path, initialized_db):
    # 2015_20002703: ticker-less funds (missing_ticker) and a genuine
    # date_anomaly — source facts, not defects ⇒ parsed, all rows clean.
    cache = _make_cache(
        tmp_path,
        2015,
        [{"docid": "20002703", "last": "Flores", "first": "Bill", "filed": "3/11/2015"}],
        {"20002703": EFILE_2015},
    )
    report = _run(initialized_db, raw_root=cache, cache_dir=cache, years=[2015])
    year = report.years[0]
    assert _filing(initialized_db, "20002703")[0] == "parsed"
    assert year.total_efile_rows == 5
    assert year.clean_efile_rows == 5
    stored_flags = [
        json.loads(flags)
        for (flags,) in initialized_db.execute(
            "SELECT flags FROM transactions WHERE filing_id = 'house:20002703'"
        )
    ]
    assert any("missing_ticker" in f for f in stored_flags)
    assert any("date_anomaly" in f for f in stored_flags)


# --- pypdf fallback at ingest level (R22) ------------------------------------


def test_fallback_filing_loads_partial_with_unclean_rows(
    tmp_path, initialized_db, monkeypatch
):
    import pdfplumber

    original_open = pdfplumber.open

    def _broken_open(*args, **kwargs):
        raise RuntimeError("pdfplumber disabled by test")

    cache = _make_cache(
        tmp_path,
        2020,
        [{"docid": "20013901", "last": "Blumenauer", "first": "Earl", "filed": "1/10/2020"}],
        {"20013901": EFILE_2020},
    )
    monkeypatch.setattr(pdfplumber, "open", _broken_open)
    try:
        report = _run(initialized_db, raw_root=cache, cache_dir=cache, years=[2020])
    finally:
        monkeypatch.setattr(pdfplumber, "open", original_open)
    year = report.years[0]
    assert _filing(initialized_db, "20013901")[0] == "partial"
    assert year.total_efile_rows == 4
    assert year.clean_efile_rows == 0
    assert year.text_fallback_rows == 4
    assert "text_fallback 4" in house.format_summary(report)
    assert report.ok  # partial is not failed — the filing reconciled


# --- typed-fragment invariants survive the loader (R25) ----------------------


def test_orphaned_amount_fragment_survives_loader_round_trip(
    tmp_path, initialized_db, monkeypatch
):
    lines = [
        "SP   Alphabet Inc. Class A (GOOGL)   P   06/15/2026   06/15/2026   $50,001 - $100,000",
        "$100,000",
    ]
    candidates = segment_text_rows(lines)
    parse_result = PtrParse(
        header=PtrHeader(name="Hon. Test", status="Member", state_district="VA01"),
        rows=tuple(house_ptr._emit(candidates)),
        path="text_fallback",
        cap_gains_column=True,
    )
    monkeypatch.setattr(house, "parse_ptr", lambda data, *, doc_id: parse_result)
    cache = _make_cache(tmp_path, 2026, [WITTMAN], {"20034916": EFILE_2026})
    _run(initialized_db, raw_root=cache, cache_dir=cache)

    stored = initialized_db.execute(
        "SELECT raw_row, asset_name, amount_label, flags FROM transactions"
        " WHERE filing_id = 'house:20034916' ORDER BY row_ordinal"
    ).fetchall()
    assert len(stored) == 2
    neighbor_raw = json.loads(stored[0][0])
    orphan_raw = json.loads(stored[1][0])
    # Neighbor untouched: its cells hold only their own columns' text.
    assert neighbor_raw["asset_name"] == "Alphabet Inc. Class A (GOOGL)"
    assert neighbor_raw["amount_label"] == "$50,001 - $100,000"
    # Orphan carries the fragment verbatim in its own (amount) cell.
    assert orphan_raw["amount_label"] == "$100,000"
    assert orphan_raw["asset_name"] is None
    assert stored[1][2] == "$100,000"
    orphan_flags = json.loads(stored[1][3])
    assert {"row_incomplete", "row_orphan"} <= set(orphan_flags)
    assert "$" not in stored[0][1]  # normalized neighbor asset intact


# --- audit lifecycle (R15) ---------------------------------------------------


def _audit_rows(conn):
    return conn.execute(
        "SELECT run_id, job, started_at, finished_at, new_filings, rows_loaded,"
        " parse_failures, status, host FROM ingest_runs"
    ).fetchall()


def test_audit_row_success(tmp_path, initialized_db):
    cache = _make_cache(tmp_path, 2026, [WITTMAN], {"20034916": EFILE_2026})
    _run(initialized_db, raw_root=cache, cache_dir=cache)
    rows = _audit_rows(initialized_db)
    assert len(rows) == 1
    run_id, job, started, finished, new_filings, rows_loaded, failures, status, host = rows[0]
    assert run_id == "run-test-1"
    assert job == "congress-house"
    assert started is not None and finished is not None
    assert (new_filings, rows_loaded, failures) == (1, 1, 0)
    assert status == "ok"
    assert host == "testhost"


def test_audit_row_partial_on_failed_docid(tmp_path, initialized_db):
    cache = _make_cache(tmp_path, 2026, [WITTMAN, {"docid": "20039999"}],
                        {"20034916": EFILE_2026})
    _run(initialized_db, raw_root=cache, cache_dir=cache)
    rows = _audit_rows(initialized_db)
    assert len(rows) == 1
    assert rows[0][7] == "partial"
    assert rows[0][6] == 1  # parse_failures counts the fetch-failed docid


def test_audit_row_finalized_on_fatal(tmp_path, initialized_db, monkeypatch):
    def _boom(*args, **kwargs):
        raise RuntimeError("injected fatal")

    monkeypatch.setattr(house, "_process_docid", _boom)
    cache = _make_cache(tmp_path, 2026, [WITTMAN], {"20034916": EFILE_2026})
    with pytest.raises(RuntimeError, match="injected fatal"):
        _run(initialized_db, raw_root=cache, cache_dir=cache)
    rows = _audit_rows(initialized_db)
    assert len(rows) == 1
    assert rows[0][7] == "failed"
    assert rows[0][3] is not None  # finished_at stamped on the fatal path


def test_fatal_after_first_document_records_committed_counters(
    tmp_path, initialized_db, monkeypatch
):
    # F3: the first document commits, the second raises. The finalized audit
    # must reflect what the database actually holds — understating it would
    # make committed rows and audit totals diverge exactly during failure
    # recovery.
    real_process = house._process_docid
    calls = {"n": 0}

    def _fail_on_second(conn, *, entry, pdf_bytes, now):
        calls["n"] += 1
        if calls["n"] == 2:
            raise RuntimeError("injected fatal on second document")
        return real_process(conn, entry=entry, pdf_bytes=pdf_bytes, now=now)

    monkeypatch.setattr(house, "_process_docid", _fail_on_second)
    cache = _make_cache(
        tmp_path, 2026, [WITTMAN, FIELDS],
        {"20034916": EFILE_2026, "20034800": EFILE_2026_B},
    )
    with pytest.raises(RuntimeError, match="injected fatal on second document"):
        _run(initialized_db, raw_root=cache, cache_dir=cache)

    committed_filings = initialized_db.execute(
        "SELECT count(*) FROM filings"
    ).fetchone()[0]
    committed_rows = initialized_db.execute(
        "SELECT count(*) FROM transactions"
    ).fetchone()[0]
    assert (committed_filings, committed_rows) == (1, 1)

    rows = _audit_rows(initialized_db)
    assert len(rows) == 1
    _rid, _job, _started, finished, new_filings, rows_loaded, failures, status, _host = rows[0]
    assert status == "failed"
    assert finished is not None
    # The audit agrees with the committed database state.
    assert new_filings == committed_filings
    assert rows_loaded == committed_rows
    assert failures == 0


# --- reparse (R14/R19) -------------------------------------------------------


@pytest.fixture
def reparsed_db(tmp_path, initialized_db):
    """Two archived filings + one fetch-failed (raw_path NULL) filing."""
    cache = _make_cache(
        tmp_path,
        2026,
        [WITTMAN, FIELDS, {"docid": "20039999", "filed": "7/2/2026"}],
        {"20034916": EFILE_2026, "20034800": EFILE_2026_B},
    )
    _run(initialized_db, raw_root=cache, cache_dir=cache)
    return initialized_db, cache


def _recording_reader():
    seen: list[Path] = []

    def _read(path: Path) -> bytes:
        seen.append(path)
        return path.read_bytes()

    return seen, _read


def test_reparse_default_excludes_null_archive(reparsed_db):
    conn, cache = reparsed_db
    seen, reader = _recording_reader()
    report = reparse_house(
        conn, raw_root=cache, selector=ReparseSelector(), read_archive=reader
    )
    assert set(report.statuses) == {"house:20034800", "house:20034916"}
    assert report.selection.excluded_no_archive == 1
    assert report.ok
    # The NULL-archive filing's path was never read.
    assert all("20039999" not in str(p) for p in seen)
    assert len(seen) == 2


def test_reparse_since_selector(reparsed_db):
    conn, cache = reparsed_db
    seen, reader = _recording_reader()
    report = reparse_house(
        conn,
        raw_root=cache,
        selector=ReparseSelector(since="2026-07-01"),
        read_archive=reader,
    )
    # 20034800 filed 2026-06-26 (excluded by date); 20039999 filed 2026-07-02
    # but has no archive (excluded centrally).
    assert set(report.statuses) == {"house:20034916"}
    assert report.selection.excluded_no_archive == 1
    assert [str(p) for p in seen] == [str(Path(cache) / "pdfs/2026/20034916.pdf")]


def test_reparse_parser_version_selector(reparsed_db):
    conn, cache = reparsed_db
    seen, reader = _recording_reader()
    report = reparse_house(
        conn,
        raw_root=cache,
        selector=ReparseSelector(parser_version=house_ptr.PARSER_VERSION),
        read_archive=reader,
    )
    assert set(report.statuses) == {"house:20034800", "house:20034916"}
    assert report.selection.excluded_no_archive == 1
    assert all("20039999" not in str(p) for p in seen)


def test_reparse_explicit_filing_archived(reparsed_db):
    conn, cache = reparsed_db
    report = reparse_house(
        conn, raw_root=cache, selector=ReparseSelector(filing="house:20034916")
    )
    assert report.statuses == {"house:20034916": "parsed"}
    assert report.ok


def test_reparse_explicit_filing_without_archive_is_skipped(reparsed_db):
    conn, cache = reparsed_db
    seen, reader = _recording_reader()
    report = reparse_house(
        conn,
        raw_root=cache,
        selector=ReparseSelector(filing="house:20039999"),
        read_archive=reader,
    )
    assert report.statuses == {}
    assert report.selection.skipped_no_archive == ("house:20039999",)
    assert not report.ok
    assert seen == []  # never read, never a crash (R19)


def test_reparse_unknown_filing_reports_not_found(reparsed_db):
    conn, cache = reparsed_db
    report = reparse_house(
        conn, raw_root=cache, selector=ReparseSelector(filing="house:404404")
    )
    assert report.selection.not_found == ("house:404404",)
    assert not report.ok


def test_reparse_preserves_txn_ids(reparsed_db):
    conn, cache = reparsed_db
    before = {
        txn_id
        for (txn_id,) in conn.execute(
            "SELECT txn_id FROM transactions WHERE filing_id = 'house:20034916'"
        )
    }
    reparse_house(
        conn, raw_root=cache, selector=ReparseSelector(filing="house:20034916")
    )
    after = {
        txn_id
        for (txn_id,) in conn.execute(
            "SELECT txn_id FROM transactions WHERE filing_id = 'house:20034916'"
        )
    }
    assert after == before
    parser_version = conn.execute(
        "SELECT parser_version FROM filings WHERE filing_id = 'house:20034916'"
    ).fetchone()[0]
    assert parser_version == house_ptr.PARSER_VERSION


def test_select_reparse_targets_filters_centrally(reparsed_db):
    conn, _cache = reparsed_db
    for selector in (
        ReparseSelector(),
        ReparseSelector(since="2026-01-01"),
        ReparseSelector(parser_version=house_ptr.PARSER_VERSION),
    ):
        selection = select_reparse_targets(conn, selector)
        assert all(raw_path is not None for _f, raw_path in selection.targets)
        assert selection.excluded_no_archive == 1


# --- CLI (R13/R14) -----------------------------------------------------------


def test_cli_ingest_end_to_end_exit_zero(tmp_path):
    cache = _make_cache(
        tmp_path, 2026, [WITTMAN, PAPER_ROGERS],
        {"20034916": EFILE_2026, "9116146": PAPER_2026},
    )
    db_path = tmp_path / "populus.db"
    result = CliRunner().invoke(
        cli_main,
        ["ingest", "congress-house", "--from-cache", str(cache),
         "--db", str(db_path), "--year", "2026"],
    )
    assert result.exit_code == 0, result.output
    assert "index PTRs 2" in result.output
    assert "parsed 1" in result.output
    assert "needs_ocr 1" in result.output
    assert "efile rows: 1 clean / 1 total" in result.output
    conn = connect(str(db_path))  # --db was auto-initialized (LD9)
    assert conn.execute("SELECT count(*) FROM filings").fetchone() == (2,)
    conn.close()


def test_cli_ingest_exit_one_on_failed_docid(tmp_path):
    cache = _make_cache(
        tmp_path, 2026, [WITTMAN, {"docid": "20039999"}], {"20034916": EFILE_2026}
    )
    db_path = tmp_path / "populus.db"
    result = CliRunner().invoke(
        cli_main,
        ["ingest", "congress-house", "--from-cache", str(cache),
         "--db", str(db_path), "--year", "2026"],
    )
    assert result.exit_code == 1
    assert "fetch_failed 1" in result.output


def test_cli_ingest_requires_db(tmp_path):
    cache = _make_cache(tmp_path, 2026, [], {})
    result = CliRunner().invoke(
        cli_main, ["ingest", "congress-house", "--from-cache", str(cache)]
    )
    assert result.exit_code == 2


def test_cli_reparse_end_to_end(tmp_path):
    cache = _make_cache(tmp_path, 2026, [WITTMAN], {"20034916": EFILE_2026})
    db_path = tmp_path / "populus.db"
    runner = CliRunner()
    assert (
        runner.invoke(
            cli_main,
            ["ingest", "congress-house", "--from-cache", str(cache),
             "--db", str(db_path), "--year", "2026"],
        ).exit_code
        == 0
    )
    result = runner.invoke(
        cli_main,
        ["reparse", "congress-house", "--db", str(db_path),
         "--raw-root", str(cache), "--filing", "house:20034916"],
    )
    assert result.exit_code == 0, result.output
    assert "reparsed 1" in result.output


def test_cli_reparse_skipped_no_archive_exits_one(tmp_path):
    cache = _make_cache(
        tmp_path, 2026, [WITTMAN, {"docid": "20039999"}], {"20034916": EFILE_2026}
    )
    db_path = tmp_path / "populus.db"
    runner = CliRunner()
    runner.invoke(
        cli_main,
        ["ingest", "congress-house", "--from-cache", str(cache),
         "--db", str(db_path), "--year", "2026"],
    )
    result = runner.invoke(
        cli_main,
        ["reparse", "congress-house", "--db", str(db_path),
         "--raw-root", str(cache), "--filing", "house:20039999"],
    )
    assert result.exit_code == 1
    assert "skipped_no_archive" in result.output


def test_cli_year_skip_note(tmp_path):
    cache = _make_cache(tmp_path, 2026, [WITTMAN], {"20034916": EFILE_2026})
    db_path = tmp_path / "populus.db"
    result = CliRunner().invoke(
        cli_main,
        ["ingest", "congress-house", "--from-cache", str(cache),
         "--db", str(db_path), "--year", "2020"],
    )
    # A year with no cached index skips with a note and reconciles nothing.
    assert result.exit_code == 0, result.output
    assert "skipped" in result.output


# --- multi-year ingest (F5/R18) ----------------------------------------------


def _two_year_cache(tmp_path):
    """One cache dir holding two years, exercised as the January window."""
    cache = tmp_path / "cache"
    for year, members, pdfs in (
        (2026, [WITTMAN, PAPER_ROGERS],
         {"20034916": EFILE_2026, "9116146": PAPER_2026}),
        (2020, [{"docid": "20013901", "last": "Blumenauer", "first": "Earl",
                 "filed": "1/10/2020"},
                {"docid": "20019999", "filed": "2/2/2020"}],
         {"20013901": EFILE_2020}),
    ):
        (cache / "pdfs" / str(year)).mkdir(parents=True, exist_ok=True)
        (cache / f"{year}FD.xml").write_bytes(_index_xml(year, members))
        for doc_id, data in pdfs.items():
            (cache / "pdfs" / str(year) / f"{doc_id}.pdf").write_bytes(data)
    return cache


def test_two_year_ingest_reconciles_each_year_independently(tmp_path, initialized_db):
    # R18's January window: default_years(Jan) == [Y, Y-1]. Each year is
    # discovered and reconciled on its own; counters and the clean-row
    # denominator aggregate across both.
    assert default_years(date(2026, 1, 5)) == [2026, 2025]
    cache = _two_year_cache(tmp_path)
    report = _run(
        initialized_db, raw_root=cache, cache_dir=cache, years=[2026, 2020]
    )

    assert [y.year for y in report.years] == [2026, 2020]
    y2026, y2020 = report.years

    # Two independent reconciliations, each summing to its own index count.
    assert y2026.reconciliation.index_ptr_count == 2
    assert y2026.reconciliation.total == 2
    assert y2026.reconciliation.status_counts == {"parsed": 1, "needs_ocr": 1}
    assert y2026.reconciliation.unaccounted == ()
    assert y2020.reconciliation.index_ptr_count == 2
    assert y2020.reconciliation.total == 2
    assert y2020.reconciliation.status_counts == {"parsed": 1, "failed": 1}
    assert y2020.reconciliation.failed_fetch == 1
    assert y2020.reconciliation.unaccounted == ()

    # Per-year e-file row counts stay separate (2020_20013901 emits 4 rows;
    # its two ticker-less Treasury rows carry only the source fact
    # missing_ticker, so they are clean).
    assert (y2026.total_efile_rows, y2026.clean_efile_rows) == (1, 1)
    assert (y2020.total_efile_rows, y2020.clean_efile_rows) == (4, 4)

    # ...and the run-level counters are the true sum of both years.
    assert report.new_filings == 4
    assert report.rows_loaded == 5
    assert report.parse_failures == 1
    assert not report.ok  # the 2020 fetch failure

    # Both years' filings actually landed, each stamped with its own dates.
    assert _filing(initialized_db, "20034916")[6] == "2026-07-10"
    assert _filing(initialized_db, "20013901")[6] == "2020-01-10"
    assert initialized_db.execute("SELECT count(*) FROM filings").fetchone() == (4,)

    # One summary line per year, plus the AGGREGATE clean-row denominator
    # (5 e-file rows across both years, not one year's).
    summary = house.format_summary(report)
    assert "house 2026 | index PTRs 2" in summary
    assert "house 2020 | index PTRs 2" in summary
    assert "efile rows: 5 clean / 5 total = 100.0%" in summary

    # Exactly one audit row covers the whole multi-year invocation (R15).
    audit = _audit_rows(initialized_db)
    assert len(audit) == 1
    assert audit[0][4] == 4  # new_filings
    assert audit[0][5] == 5  # rows_loaded
    assert audit[0][7] == "partial"


def test_two_year_ingest_second_year_failure_is_isolated(tmp_path, initialized_db):
    # A defect in the SECOND January year must not be masked by the first
    # year's success: the run is not-ok and the failed year is visible.
    cache = _two_year_cache(tmp_path)
    (cache / "2020FD.xml").unlink()
    report = _run(
        initialized_db, raw_root=cache, cache_dir=cache, years=[2026, 2020]
    )
    assert len(report.years) == 2
    assert report.years[0].reconciliation.total == 2
    assert report.years[1].reconciliation is None
    assert report.years[1].note is not None
    # From-cache absence is an approved skip, so the run still reconciles ok.
    assert report.years[1].discovery_failed is False
    assert report.ok
    summary = house.format_summary(report)
    assert "house 2020 | skipped" in summary


# --- cached-2026 corpus acceptance (R12/R13/R20/R22) -------------------------


@pytest.mark.skipif(
    not (DATA_CACHE / "2026FD.xml").exists(),
    reason="data-cache/house not present (local-only acceptance corpus)",
)
def test_cached_2026_corpus_acceptance(tmp_path):
    db_path = tmp_path / "acceptance.db"
    init_db(str(db_path))
    conn = connect(str(db_path))
    try:
        report = run_house_ingest(
            conn,
            years=[2026],
            raw_root=DATA_CACHE,
            cache_dir=DATA_CACHE,
            run_id="run-acceptance",
            now=_now_factory(),
            host="testhost",
        )
        year = report.years[0]
        rec = year.reconciliation
        assert rec.index_ptr_count == 312
        assert rec.total == 312
        assert rec.unaccounted == ()
        assert year.conflicts == 0
        assert year.failure_kinds.get("empty_parse", 0) == 0
        assert year.text_fallback_rows == 0
        assert report.ok, house.format_summary(report)
        # P1 gate (ARCHITECTURE.md §17): >= 97% of e-filed rows parse clean,
        # denominator = every emitted e-file row.
        assert year.total_efile_rows > 0
        rate = year.clean_efile_rows / year.total_efile_rows
        assert rate >= 0.97, house.format_summary(report)
    finally:
        conn.close()


# --- resumable fetch: checkpoint-before-bytes sidecars (RUN M1-B, R2) --------


def _sidecar(raw_root, doc_id, year=2026):
    return Path(raw_root) / "pdfs" / str(year) / f"{doc_id}.pdf.fetch-meta.json"


def _archived(raw_root, doc_id, year=2026):
    return Path(raw_root) / "pdfs" / str(year) / f"{doc_id}.pdf"


class CountingHouseTransport:
    """Counts every request that leaves the process, then delegates."""

    def __init__(self, inner):
        self._inner = inner
        self.attempts = 0
        self.pdf_attempts = 0

    def get(self, url, *, headers):
        self.attempts += 1
        if "/ptr-pdfs/" in url:
            self.pdf_attempts += 1
        return self._inner.get(url, headers=headers)


def _live_transport(members, pdfs, year=2026):
    transport = FakeTransport()
    transport.route(
        house.INDEX_URL_TEMPLATE.format(year=year),
        _resp(200, _index_zip(year, members), {"ETag": '"t"'}),
    )
    for doc_id, data in pdfs.items():
        transport.route(_pdf_url(doc_id, year), _resp(200, data))
    return transport


def test_live_fetch_writes_the_provenance_sidecar_checkpoint_first(
    tmp_path, initialized_db
):
    transport = _live_transport([WITTMAN], {"20034916": EFILE_2026})
    raw_root = tmp_path / "raw"
    report = _run(
        initialized_db, raw_root=raw_root, transport=transport,
        sleep=FakeClock().sleep, monotonic=FakeClock().monotonic,
    )
    assert report.ok, house.format_summary(report)

    sidecar = json.loads(_sidecar(raw_root, "20034916").read_text(encoding="utf-8"))
    # §5.1 provenance fields, and the hash that necessarily preceded the bytes.
    assert sidecar["source_url"] == _pdf_url("20034916")
    assert sidecar["response_hash"] == hashlib.sha256(EFILE_2026).hexdigest()
    assert sidecar["retrieved_at"] is not None
    assert _archived(raw_root, "20034916").read_bytes() == EFILE_2026


def _spy_writes(monkeypatch) -> list[str]:
    """Record the order of durable writes across BOTH writers.

    The document bytes go through the House module's own ``atomic_write_bytes``
    and the checkpoint sidecar through the shared
    ``populus.ingest.checkpoint`` primitive, so a spy on one alone would observe
    half the ordering this guards.
    """
    import populus.ingest.checkpoint as checkpoint_mod

    order: list[str] = []
    real_write = house.atomic_write_bytes

    def spy(path, data):
        real_write(path, data)
        order.append(Path(path).name)

    monkeypatch.setattr(house, "atomic_write_bytes", spy)
    monkeypatch.setattr(checkpoint_mod, "atomic_write_bytes", spy)
    return order


def test_the_checkpoint_is_written_before_the_bytes(tmp_path, initialized_db, monkeypatch):
    """The ordering rule itself, not just its end state: a checkpoint that
    landed AFTER its bytes would leave bytes no resume could verify."""
    order = _spy_writes(monkeypatch)
    _run(
        initialized_db, raw_root=tmp_path / "raw",
        transport=_live_transport([WITTMAN], {"20034916": EFILE_2026}),
        sleep=FakeClock().sleep, monotonic=FakeClock().monotonic,
    )
    # Discovery now archives the index ZIP/XML atomically too (R9/LD10), so
    # the spy sees those writes first; the ordering rule under test is the
    # per-document checkpoint-before-bytes pair.
    doc_writes = [n for n in order if not n.startswith("2026FD")]
    assert doc_writes == ["20034916.pdf.fetch-meta.json", "20034916.pdf"]


def test_a_crash_between_the_checkpoint_and_the_bytes_refetches_exactly_once(
    tmp_path, initialized_db, monkeypatch
):
    """Resume from the ACTUAL intermediate state the ordering produces: the
    sidecar is durable, the bytes never landed. Exactly one refetch follows —
    and never a duplicate request for bytes that ARE durable."""

    class _Interrupt(RuntimeError):
        pass

    import populus.ingest.checkpoint as checkpoint_mod

    real_write = house.atomic_write_bytes
    written: list[str] = []

    def spy(path, data):
        real_write(path, data)
        # Discovery's atomic index ZIP/XML writes (R9/LD10) are not part of
        # the per-document ordering this test exercises.
        if Path(path).name.startswith("2026FD"):
            return
        written.append(Path(path).name)
        if Path(path).name.endswith(".fetch-meta.json"):
            raise _Interrupt("crash immediately after the checkpoint")

    monkeypatch.setattr(house, "atomic_write_bytes", spy)
    monkeypatch.setattr(checkpoint_mod, "atomic_write_bytes", spy)

    raw_root = tmp_path / "raw"
    with pytest.raises(_Interrupt):
        _run(
            initialized_db, raw_root=raw_root,
            transport=_live_transport([WITTMAN], {"20034916": EFILE_2026}),
            sleep=FakeClock().sleep, monotonic=FakeClock().monotonic,
        )
    monkeypatch.undo()
    # The checkpoint is durable; the bytes are not.
    assert written == ["20034916.pdf.fetch-meta.json"]
    assert _sidecar(raw_root, "20034916").exists()
    assert not _archived(raw_root, "20034916").exists()

    counting = CountingHouseTransport(
        _live_transport([WITTMAN], {"20034916": EFILE_2026})
    )
    resumed = _run(
        initialized_db, raw_root=raw_root, transport=counting, run_id="run-resume",
        sleep=FakeClock().sleep, monotonic=FakeClock().monotonic,
    )
    assert resumed.ok, house.format_summary(resumed)
    assert counting.pdf_attempts == 1                 # exactly one
    assert _archived(raw_root, "20034916").read_bytes() == EFILE_2026

    again = CountingHouseTransport(
        _live_transport([WITTMAN], {"20034916": EFILE_2026})
    )
    _run(
        initialized_db, raw_root=raw_root, transport=again, run_id="run-resume-2",
        sleep=FakeClock().sleep, monotonic=FakeClock().monotonic,
    )
    assert again.pdf_attempts == 0                    # and never a second


def test_a_non_200_ptr_is_never_checkpointed_or_archived(tmp_path, initialized_db):
    """A 404 must not freeze into a durable empty file: no sidecar, no bytes,
    raw_path NULL, and the filing stays re-fetch-eligible forever."""
    transport = _live_transport([WITTMAN], {})
    transport.route(_pdf_url("20034916"), _resp(404))
    raw_root = tmp_path / "raw"
    report = _run(
        initialized_db, raw_root=raw_root, transport=transport,
        sleep=FakeClock().sleep, monotonic=FakeClock().monotonic,
    )
    assert report.ok is False
    assert not _sidecar(raw_root, "20034916").exists()
    assert not _archived(raw_root, "20034916").exists()
    status, raw_path, response_hash, *_ = _filing(initialized_db, "20034916")
    assert (status, raw_path, response_hash) == ("failed", None, None)


def test_archived_bytes_without_a_checkpoint_are_refetched_never_self_healed(
    tmp_path, initialized_db
):
    """Unverifiable bytes are never promoted to durable provenance (F1).

    Bytes on disk with no sidecar have nothing to verify against — legacy,
    partial, misplaced, and corrupted archives all look identical. Minting a
    sidecar out of them would record a hash of whatever happened to be there,
    with a null ``retrieved_at``, and report ZERO transport for a document
    never checked against the source. The live path must fetch instead.
    """
    members = [WITTMAN]
    pdfs = {"20034916": EFILE_2026}
    raw_root = tmp_path / "raw"
    _run(
        initialized_db, raw_root=raw_root, transport=_live_transport(members, pdfs),
        sleep=FakeClock().sleep, monotonic=FakeClock().monotonic,
    )
    # The exact state a pre-existing archive presents: bytes, no checkpoint.
    # Wrong bytes, of the same length, so a self-heal would checkpoint a hash
    # that is not the source's and freeze the corruption in as "durable".
    _sidecar(raw_root, "20034916").unlink()
    _archived(raw_root, "20034916").write_bytes(b"X" * len(EFILE_2026))

    counting = CountingHouseTransport(_live_transport(members, pdfs))
    report = _run(
        initialized_db, raw_root=raw_root, transport=counting,
        run_id="run-no-checkpoint",
        sleep=FakeClock().sleep, monotonic=FakeClock().monotonic,
    )
    assert report.ok, house.format_summary(report)
    assert counting.pdf_attempts == 1                     # fetched, not trusted
    assert _archived(raw_root, "20034916").read_bytes() == EFILE_2026

    sidecar = json.loads(_sidecar(raw_root, "20034916").read_text(encoding="utf-8"))
    assert sidecar["response_hash"] == hashlib.sha256(EFILE_2026).hexdigest()
    assert sidecar["retrieved_at"] is not None      # genuine retrieval, never null

    # And the healed archive is settled again: no perpetual refetch loop.
    again = CountingHouseTransport(_live_transport(members, pdfs))
    _run(
        initialized_db, raw_root=raw_root, transport=again, run_id="run-no-cp-2",
        sleep=FakeClock().sleep, monotonic=FakeClock().monotonic,
    )
    assert again.pdf_attempts == 0


def test_an_unreadable_checkpoint_is_fetch_required_not_trusted(
    tmp_path, initialized_db
):
    """A truncated/garbage sidecar reads back as "no checkpoint" — which must
    mean fetch-required, exactly as an absent one does.

    Driven from a FRESH database, so there is no stored ``filings.response_hash``
    to settle the filing before the archive is consulted: the only evidence on
    offer is the sidecar, and it is unreadable. This is the exact inverse of
    ``test_fresh_database_over_a_verified_archive_makes_zero_ptr_transport`` —
    zero transport is earned by a verifiable checkpoint, never by bytes alone.
    """
    members = [WITTMAN]
    pdfs = {"20034916": EFILE_2026}
    raw_root = tmp_path / "raw"
    _run(
        initialized_db, raw_root=raw_root, transport=_live_transport(members, pdfs),
        sleep=FakeClock().sleep, monotonic=FakeClock().monotonic,
    )
    _sidecar(raw_root, "20034916").write_text("{not json", encoding="utf-8")

    fresh_path = tmp_path / "fresh.db"
    init_db(str(fresh_path))
    fresh = connect(str(fresh_path))
    try:
        counting = CountingHouseTransport(_live_transport(members, pdfs))
        report = _run(
            fresh, raw_root=raw_root, transport=counting, run_id="run-badmeta",
            sleep=FakeClock().sleep, monotonic=FakeClock().monotonic,
        )
        assert report.ok, house.format_summary(report)
        assert counting.pdf_attempts == 1
    finally:
        fresh.close()
    sidecar = json.loads(_sidecar(raw_root, "20034916").read_text(encoding="utf-8"))
    assert sidecar["retrieved_at"] is not None


def test_cache_mode_writes_no_sidecar(tmp_path, initialized_db):
    cache = _make_cache(tmp_path, 2026, [WITTMAN], {"20034916": EFILE_2026})
    report = _run(initialized_db, raw_root=cache, cache_dir=cache)
    assert report.ok, house.format_summary(report)
    assert not _sidecar(cache, "20034916").exists()


# --- verified-settled eligibility (RUN M1-B, R3/LD9) -------------------------


def test_missing_and_corrupt_archives_each_refetch_exactly_once_on_the_same_db(
    tmp_path, initialized_db
):
    """The bug this closes: `raw_path IS NOT NULL` skipped a filing forever even
    when its archived document was gone or corrupt, because the decision was
    made before anything could inspect the bytes."""
    members = [WITTMAN, FIELDS, PAPER_ROGERS]
    pdfs = {
        "20034916": EFILE_2026,
        "20034800": EFILE_2026_B,
        "9116146": PAPER_2026,
    }
    raw_root = tmp_path / "raw"
    first = _run(
        initialized_db, raw_root=raw_root, transport=_live_transport(members, pdfs),
        sleep=FakeClock().sleep, monotonic=FakeClock().monotonic,
    )
    assert first.ok, house.format_summary(first)
    assert first.settled_verified == 0      # nothing was settled yet
    assert first.settled_reobtained == 0

    # One archive deleted, one corrupted to the SAME length (a size check would
    # miss it), one left intact.
    _archived(raw_root, "20034916").unlink()
    intact = _archived(raw_root, "20034800").read_bytes()
    _archived(raw_root, "20034800").write_bytes(b"X" * len(intact))

    counting = CountingHouseTransport(_live_transport(members, pdfs))
    second = _run(
        initialized_db, raw_root=raw_root, transport=counting, run_id="run-test-2",
        sleep=FakeClock().sleep, monotonic=FakeClock().monotonic,
    )
    assert second.ok, house.format_summary(second)
    assert counting.pdf_attempts == 2       # exactly the two broken ones
    assert second.settled_reobtained == 2
    assert second.settled_verified == 1     # the intact paper filing
    assert _archived(raw_root, "20034800").read_bytes() == intact  # healed

    # And a THIRD run over the now-verified archive fetches nothing more.
    third_counter = CountingHouseTransport(_live_transport(members, pdfs))
    third = _run(
        initialized_db, raw_root=raw_root, transport=third_counter,
        run_id="run-test-3",
        sleep=FakeClock().sleep, monotonic=FakeClock().monotonic,
    )
    assert third_counter.pdf_attempts == 0
    assert third.settled_verified == 3
    assert third.settled_reobtained == 0


def test_fresh_database_over_a_verified_archive_makes_zero_ptr_transport(
    tmp_path, initialized_db, tmp_path_factory
):
    """The resume proof that cannot pass by skipping settled rows: a brand-new
    database has no rows to skip, so every document must come from the verified
    archive rather than the network."""
    members = [WITTMAN, FIELDS]
    pdfs = {"20034916": EFILE_2026, "20034800": EFILE_2026_B}
    raw_root = tmp_path / "raw"
    first = _run(
        initialized_db, raw_root=raw_root, transport=_live_transport(members, pdfs),
        sleep=FakeClock().sleep, monotonic=FakeClock().monotonic,
    )
    assert first.ok, house.format_summary(first)

    fresh_path = tmp_path / "fresh.db"
    init_db(str(fresh_path))
    fresh = connect(str(fresh_path))
    try:
        counting = CountingHouseTransport(_live_transport(members, pdfs))
        resumed = _run(
            fresh, raw_root=raw_root, transport=counting, run_id="run-fresh",
            sleep=FakeClock().sleep, monotonic=FakeClock().monotonic,
        )
        assert resumed.ok, house.format_summary(resumed)
        assert counting.pdf_attempts == 0            # ZERO transport
        assert resumed.settled_verified == 0         # nothing was skipped …
        assert resumed.new_filings == 2              # … the corpus fully reloaded
        assert resumed.years[0].reconciliation.total == 2
    finally:
        fresh.close()


@pytest.mark.parametrize("damage", ["absent", "unreadable"])
def test_settled_skip_on_the_same_db_requires_the_sidecar_too(
    tmp_path, initialized_db, damage
):
    """A settled skip requires the PROVENANCE, not just the bytes (round 2, F1).

    The settled pre-pass and `_obtain_document` are two resume boundaries, and
    the pre-pass used to bypass the other's checkpoint requirement: it verified
    the archived bytes against the database hash and skipped, never looking at
    the sidecar. Delete or corrupt a sidecar while leaving its bytes intact and
    that document's source URL and retrieval time were gone permanently — every
    later run did zero transport and no path could ever restore them.

    Same database, intact bytes, damaged sidecar: exactly one fetch, and full
    §5.1 provenance rewritten.
    """
    members = [WITTMAN]
    pdfs = {"20034916": EFILE_2026}
    raw_root = tmp_path / "raw"
    _run(
        initialized_db, raw_root=raw_root, transport=_live_transport(members, pdfs),
        sleep=FakeClock().sleep, monotonic=FakeClock().monotonic,
    )
    original = json.loads(_sidecar(raw_root, "20034916").read_text(encoding="utf-8"))
    assert original["retrieved_at"] is not None

    # The bytes stay exactly right — only the provenance is damaged, so the
    # database-hash check alone still says "settled".
    if damage == "absent":
        _sidecar(raw_root, "20034916").unlink()
    else:
        _sidecar(raw_root, "20034916").write_text("{truncated", encoding="utf-8")
    assert _archived(raw_root, "20034916").read_bytes() == EFILE_2026

    counting = CountingHouseTransport(_live_transport(members, pdfs))
    report = _run(
        initialized_db, raw_root=raw_root, transport=counting, run_id="run-nosidecar",
        sleep=FakeClock().sleep, monotonic=FakeClock().monotonic,
    )
    assert report.ok, house.format_summary(report)
    assert report.settled_verified == 0        # NOT skipped on the DB hash alone
    assert report.settled_reobtained == 1
    assert counting.pdf_attempts == 1          # exactly one fetch

    restored = json.loads(_sidecar(raw_root, "20034916").read_text(encoding="utf-8"))
    assert restored["source_url"] == _pdf_url("20034916")
    assert restored["response_hash"] == hashlib.sha256(EFILE_2026).hexdigest()
    assert restored["retrieved_at"] is not None
    assert _archived(raw_root, "20034916").read_bytes() == EFILE_2026

    # Provenance restored ⇒ genuinely settled again, at zero transport.
    again = CountingHouseTransport(_live_transport(members, pdfs))
    third = _run(
        initialized_db, raw_root=raw_root, transport=again, run_id="run-nosidecar-2",
        sleep=FakeClock().sleep, monotonic=FakeClock().monotonic,
    )
    assert again.pdf_attempts == 0
    assert third.settled_verified == 1


def test_a_sidecar_disagreeing_with_the_stored_hash_is_not_settled(
    tmp_path, initialized_db
):
    """A readable sidecar that names a DIFFERENT hash is not evidence for these
    bytes — the two provenance records contradict each other, so the document is
    re-obtained rather than one of them being quietly preferred."""
    members = [WITTMAN]
    pdfs = {"20034916": EFILE_2026}
    raw_root = tmp_path / "raw"
    _run(
        initialized_db, raw_root=raw_root, transport=_live_transport(members, pdfs),
        sleep=FakeClock().sleep, monotonic=FakeClock().monotonic,
    )
    sidecar_path = _sidecar(raw_root, "20034916")
    meta = json.loads(sidecar_path.read_text(encoding="utf-8"))
    meta["response_hash"] = hashlib.sha256(b"something else").hexdigest()
    sidecar_path.write_text(json.dumps(meta), encoding="utf-8")

    counting = CountingHouseTransport(_live_transport(members, pdfs))
    report = _run(
        initialized_db, raw_root=raw_root, transport=counting, run_id="run-badhash",
        sleep=FakeClock().sleep, monotonic=FakeClock().monotonic,
    )
    assert report.settled_verified == 0
    assert counting.pdf_attempts == 1
    restored = json.loads(sidecar_path.read_text(encoding="utf-8"))
    assert restored["response_hash"] == hashlib.sha256(EFILE_2026).hexdigest()


# --- the provenance boundary: complete §5.1 set or fetch-required -----------
# docs/build/M1-B-provenance-boundary-spec.md. Three review rounds each found a
# different boundary enforcing a weaker rule; these tests pin the ONE rule at
# BOTH boundaries, including the fresh-database path where the settled pre-pass
# is structurally inert and `_obtain_document` is the only thing deciding.


def _seed_live_archive(tmp_path, initialized_db):
    """One document fetched for real, leaving a complete archive + sidecar."""
    members = [WITTMAN]
    pdfs = {"20034916": EFILE_2026}
    raw_root = tmp_path / "raw"
    _run(
        initialized_db, raw_root=raw_root, transport=_live_transport(members, pdfs),
        sleep=FakeClock().sleep, monotonic=FakeClock().monotonic,
    )
    return members, pdfs, raw_root


def _rewrite_sidecar(raw_root, mutate):
    path = _sidecar(raw_root, "20034916")
    meta = json.loads(path.read_text(encoding="utf-8"))
    mutate(meta)
    path.write_text(json.dumps(meta, indent=2), encoding="utf-8")


def _fetches(raw_root, members, pdfs, db, run_id):
    counting = CountingHouseTransport(_live_transport(members, pdfs))
    report = _run(
        db, raw_root=raw_root, transport=counting, run_id=run_id,
        sleep=FakeClock().sleep, monotonic=FakeClock().monotonic,
    )
    return counting.pdf_attempts, report


def _fresh_db(tmp_path, name="fresh.db"):
    path = tmp_path / name
    init_db(str(path))
    return connect(str(path))


def test_a_hash_only_checkpoint_is_not_durable(tmp_path, initialized_db):
    """The round-3 finding, at the boundary it was found on.

    A checkpoint carrying only `response_hash` — no `retrieved_at`, no
    `source_url` — matched the bytes and therefore read as durable forever. This
    is the exact residue the removed round-1 self-heal branch wrote into real
    archives, so it is not hypothetical.
    """
    members, pdfs, raw_root = _seed_live_archive(tmp_path, initialized_db)
    _rewrite_sidecar(
        raw_root,
        lambda meta: meta.clear()
        or meta.update({"response_hash": hashlib.sha256(EFILE_2026).hexdigest()}),
    )
    # Fresh DB: the settled pre-pass has no rows, so `_obtain_document` alone
    # decides — which is precisely why hardening the pre-pass was insufficient.
    fresh = _fresh_db(tmp_path)
    try:
        attempts, report = _fetches(raw_root, members, pdfs, fresh, "run-hashonly")
        assert report.ok, house.format_summary(report)
        assert attempts == 1
    finally:
        fresh.close()
    restored = json.loads(_sidecar(raw_root, "20034916").read_text(encoding="utf-8"))
    assert restored["source_url"] == _pdf_url("20034916")
    assert restored["retrieved_at"] is not None


@pytest.mark.parametrize(
    "field", ["response_hash", "retrieved_at", "source_url"]
)
@pytest.mark.parametrize("boundary", ["same_db", "fresh_db"])
def test_a_checkpoint_missing_any_provenance_field_is_fetch_required(
    tmp_path, initialized_db, field, boundary
):
    """Every field of the §5.1 set is load-bearing, at BOTH boundaries (I2).

    A hash proves the bytes, a timestamp proves *when* the source said so, and a
    URL proves *which* source. Provenance missing any one of the three is not
    provenance, and no field may be inferred from the others.
    """
    members, pdfs, raw_root = _seed_live_archive(tmp_path, initialized_db)
    _rewrite_sidecar(raw_root, lambda meta: meta.pop(field))

    if boundary == "same_db":
        attempts, report = _fetches(
            raw_root, members, pdfs, initialized_db, f"run-{field}-same"
        )
        assert report.settled_verified == 0
        assert report.settled_reobtained == 1
    else:
        fresh = _fresh_db(tmp_path)
        try:
            attempts, report = _fetches(
                raw_root, members, pdfs, fresh, f"run-{field}-fresh"
            )
        finally:
            fresh.close()
    assert report.ok, house.format_summary(report)
    assert attempts == 1

    restored = json.loads(_sidecar(raw_root, "20034916").read_text(encoding="utf-8"))
    assert restored["response_hash"] == hashlib.sha256(EFILE_2026).hexdigest()
    assert restored["retrieved_at"]
    assert restored["source_url"] == _pdf_url("20034916")


@pytest.mark.parametrize("blank", [None, "", "   "])
def test_a_blank_retrieved_at_is_absence_wearing_a_key(
    tmp_path, initialized_db, blank
):
    """`null`, `""`, and whitespace are not a retrieval time (I4). A
    presence-only check would wave all three through — and `null` is exactly
    what the removed round-1 self-heal branch wrote."""
    members, pdfs, raw_root = _seed_live_archive(tmp_path, initialized_db)
    _rewrite_sidecar(raw_root, lambda meta: meta.__setitem__("retrieved_at", blank))
    fresh = _fresh_db(tmp_path)
    try:
        attempts, _ = _fetches(raw_root, members, pdfs, fresh, "run-blank-time")
    finally:
        fresh.close()
    assert attempts == 1


def test_a_checkpoint_naming_a_different_source_url_is_fetch_required(
    tmp_path, initialized_db
):
    """`source_url` is VERIFIED against the canonical URL, not merely present
    (I3). A sidecar naming another document's URL is worse than one naming
    none: it is confident and wrong, and survives any presence-only check."""
    members, pdfs, raw_root = _seed_live_archive(tmp_path, initialized_db)
    _rewrite_sidecar(
        raw_root,
        lambda meta: meta.__setitem__("source_url", _pdf_url("29999999")),
    )
    fresh = _fresh_db(tmp_path)
    try:
        attempts, _ = _fetches(raw_root, members, pdfs, fresh, "run-wrong-url")
    finally:
        fresh.close()
    assert attempts == 1
    restored = json.loads(_sidecar(raw_root, "20034916").read_text(encoding="utf-8"))
    assert restored["source_url"] == _pdf_url("20034916")


def test_settled_skip_requires_complete_provenance_not_just_a_hash(
    tmp_path, initialized_db
):
    """Boundary 1 evaluates the same rule: a sidecar whose hash agrees with the
    database but which carries no retrieval time is not a settled skip."""
    members, pdfs, raw_root = _seed_live_archive(tmp_path, initialized_db)
    _rewrite_sidecar(raw_root, lambda meta: meta.pop("retrieved_at"))
    attempts, report = _fetches(
        raw_root, members, pdfs, initialized_db, "run-settled-incomplete"
    )
    assert report.settled_verified == 0
    assert report.settled_reobtained == 1
    assert attempts == 1
    # Repaired, and settled at zero transport thereafter (I5).
    again, third = _fetches(
        raw_root, members, pdfs, initialized_db, "run-settled-repaired"
    )
    assert again == 0
    assert third.settled_verified == 1


def test_a_fresh_database_refetches_an_incomplete_checkpoint(
    tmp_path, initialized_db
):
    """Boundary 3, the negative of the zero-transport resume proof.

    `test_fresh_database_over_a_verified_archive_makes_zero_ptr_transport` shows
    a COMPLETE archive costs nothing on a fresh database. This shows an
    incomplete one is not silently reused there — the case that has no other
    guard, because the settled pre-pass has no rows to consult.
    """
    members, pdfs, raw_root = _seed_live_archive(tmp_path, initialized_db)
    _rewrite_sidecar(raw_root, lambda meta: meta.pop("source_url"))
    fresh = _fresh_db(tmp_path)
    try:
        attempts, report = _fetches(raw_root, members, pdfs, fresh, "run-fresh-incomplete")
        assert report.ok, house.format_summary(report)
        assert attempts == 1
        assert report.new_filings == 1
    finally:
        fresh.close()

    # And now a second fresh database over the repaired archive is free again.
    fresh2 = _fresh_db(tmp_path, "fresh2.db")
    try:
        attempts2, _ = _fetches(raw_root, members, pdfs, fresh2, "run-fresh-repaired")
        assert attempts2 == 0
    finally:
        fresh2.close()


def test_the_completeness_predicate_rejects_every_incomplete_shape(tmp_path):
    """The predicate itself, driven directly over the full rejection set.

    Behavioural coverage alone leaves one line unkillable: a checkpoint with NO
    `response_hash` is *also* rejected downstream, because `sha256_hex(bytes)`
    can never equal `None`. Dropping the presence check therefore changes no
    observable behaviour, and a mutation of it survives every end-to-end test.
    That makes it redundant, not wrong — it states the "complete set" reading
    explicitly and guards a future refactor of the comparison. Pinning it here
    is what keeps it honest rather than decorative.
    """
    url = _pdf_url("20034916")
    good = {
        "source_url": url,
        "response_hash": "a" * 64,
        "retrieved_at": "2026-07-31T00:00:00Z",
    }
    meta_path = tmp_path / "doc.pdf.fetch-meta.json"

    def check(payload, *, expected_hash=None):
        if payload is None:
            meta_path.unlink(missing_ok=True)
        elif isinstance(payload, str):
            meta_path.write_text(payload, encoding="utf-8")
        else:
            meta_path.write_text(json.dumps(payload), encoding="utf-8")
        return house._checkpoint_is_complete(
            meta_path, expected_hash=expected_hash, url=url
        )

    assert check(good) is True
    assert check(good, expected_hash="a" * 64) is True

    assert check(None) is False                      # absent
    assert check("{not json") is False               # unparseable
    assert check("[]") is False                      # not an object
    for field in ("source_url", "response_hash", "retrieved_at"):
        assert check({k: v for k, v in good.items() if k != field}) is False
    assert check({**good, "response_hash": ""}) is False
    assert check({**good, "response_hash": 12345}) is False
    assert check({**good, "retrieved_at": None}) is False
    assert check({**good, "retrieved_at": "   "}) is False
    assert check({**good, "source_url": _pdf_url("29999999")}) is False
    assert check({**good, "source_url": None}) is False
    # The DB-hash consistency check, when the caller supplies one.
    assert check(good, expected_hash="b" * 64) is False


def test_both_resume_boundaries_share_one_completeness_predicate(
    tmp_path, initialized_db, monkeypatch
):
    """I1 — one predicate, no second opinion.

    Forcing `_checkpoint_is_complete` to refuse must make BOTH boundaries fetch.
    If either had kept its own field reads, that boundary would still skip, and
    the whole class of defect this spec exists to end would still be reachable.
    """
    members, pdfs, raw_root = _seed_live_archive(tmp_path, initialized_db)
    monkeypatch.setattr(
        house, "_checkpoint_is_complete", lambda *a, **k: False
    )

    same_attempts, same_report = _fetches(
        raw_root, members, pdfs, initialized_db, "run-pred-same"
    )
    assert same_attempts == 1, "boundary 1 did not consult the shared predicate"
    assert same_report.settled_verified == 0

    fresh = _fresh_db(tmp_path)
    try:
        fresh_attempts, _ = _fetches(raw_root, members, pdfs, fresh, "run-pred-fresh")
    finally:
        fresh.close()
    assert fresh_attempts == 1, "boundary 2 did not consult the shared predicate"


def test_cache_mode_settles_without_a_sidecar(tmp_path, initialized_db):
    """Cache mode is deliberately exempt from the sidecar requirement: it writes
    no sidecar by contract and has no transport with which to make one, so
    requiring one there would make every cached corpus permanently unsettleable."""
    cache = _make_cache(tmp_path, 2026, [WITTMAN], {"20034916": EFILE_2026})
    first = _run(initialized_db, raw_root=cache, cache_dir=cache)
    assert first.ok, house.format_summary(first)
    assert not _sidecar(cache, "20034916").exists()

    second = _run(
        initialized_db, raw_root=cache, cache_dir=cache, run_id="run-cache-2"
    )
    assert second.ok, house.format_summary(second)
    assert second.settled_verified == 1        # settled, with no sidecar in sight
    assert second.settled_reobtained == 0


def test_an_archive_row_whose_response_hash_is_null_is_not_settled(
    tmp_path, initialized_db
):
    """raw_path alone is not evidence — without a stored hash the bytes cannot
    be verified, so the filing is re-obtained rather than trusted."""
    members = [WITTMAN]
    pdfs = {"20034916": EFILE_2026}
    raw_root = tmp_path / "raw"
    _run(
        initialized_db, raw_root=raw_root, transport=_live_transport(members, pdfs),
        sleep=FakeClock().sleep, monotonic=FakeClock().monotonic,
    )
    initialized_db.execute(
        "UPDATE filings SET response_hash = NULL WHERE filing_id = 'house:20034916'"
    )
    counting = CountingHouseTransport(_live_transport(members, pdfs))
    report = _run(
        initialized_db, raw_root=raw_root, transport=counting, run_id="run-nohash",
        sleep=FakeClock().sleep, monotonic=FakeClock().monotonic,
    )
    assert report.settled_reobtained == 1
    assert report.settled_verified == 0
    # Zero transport all the same: the sidecar still verifies the bytes.
    assert counting.pdf_attempts == 0
    assert _filing(initialized_db, "20034916")[2] == hashlib.sha256(
        EFILE_2026
    ).hexdigest()


def test_settled_counters_appear_in_the_summary(tmp_path, initialized_db):
    raw_root = tmp_path / "raw"
    _run(
        initialized_db, raw_root=raw_root,
        transport=_live_transport([WITTMAN], {"20034916": EFILE_2026}),
        sleep=FakeClock().sleep, monotonic=FakeClock().monotonic,
    )
    report = _run(
        initialized_db, raw_root=raw_root, run_id="run-2",
        transport=_live_transport([WITTMAN], {"20034916": EFILE_2026}),
        sleep=FakeClock().sleep, monotonic=FakeClock().monotonic,
    )
    summary = house.format_summary(report)
    assert "settled_verified 1" in summary
    assert "settled_reobtained 0" in summary


# --- needs_ocr counting on the 2015 paper corpus (RUN M1-B, R7) --------------


PAPER_2015 = (FIXTURES / "2015_9106099.pdf").read_bytes()
PAPER_2015_B = (FIXTURES / "2015_9106250.pdf").read_bytes()
EFILE_2015_B = (FIXTURES / "2015_20003021.pdf").read_bytes()

HIST_EFILE = {"docid": "20002703", "last": "Historic", "first": "Ellen", "filed": "3/2/2015"}
HIST_EFILE_B = {"docid": "20003021", "last": "Second", "first": "Sam", "filed": "4/9/2015"}
HIST_PAPER = {"docid": "9106099", "last": "Paperone", "first": "Pat", "filed": "5/1/2015"}
HIST_PAPER_B = {"docid": "9106250", "last": "Papertwo", "first": "Pia", "filed": "6/1/2015"}


def test_2015_paper_is_needs_ocr_retained_counted_and_out_of_both_censuses(
    tmp_path, initialized_db
):
    from populus.amendments import ensure_views
    from populus.parse_gate import compute_parse_gate

    ensure_views(initialized_db)
    members = [HIST_EFILE, HIST_EFILE_B, HIST_PAPER, HIST_PAPER_B]
    cache = _make_cache(
        tmp_path, 2015, members,
        {
            "20002703": EFILE_2015,
            "20003021": EFILE_2015_B,
            "9106099": PAPER_2015,
            "9106250": PAPER_2015_B,
        },
    )
    report = run_house_ingest(
        initialized_db, years=[2015], raw_root=cache, cache_dir=cache,
        run_id="run-2015", now=_now_factory(), host="testhost",
    )
    counts = report.years[0].reconciliation.status_counts
    assert counts["needs_ocr"] == 2                # retained + counted

    # Retained WITH its document link — never dropped.
    status, _raw, _hash, row_count, doc_url, *_ = _filing(initialized_db, "9106099")
    assert status == "needs_ocr"
    assert doc_url.endswith("/2015/9106099.pdf")
    assert row_count == 0

    era = next(
        e for e in compute_parse_gate(initialized_db).eras
        if (e.chamber, e.year) == ("house", "2015")
    )
    assert era.needs_ocr_filings == 2
    assert era.efile_filings == 2                  # paper in NEITHER census
    assert era.measurable_efile_filings + era.unmeasurable_efile_filings == 2


# --- archive-only reparse by parser_version (RUN M1-B, R8) -------------------


def test_reparse_by_parser_version_restamps_historical_filings_without_transport(
    tmp_path, initialized_db
):
    """Readiness for owner option (b): a parser extension re-evaluates the
    archived era from disk. No re-fetch, no parser fork, and no parser change is
    made in this run."""
    members = [HIST_EFILE]
    cache = _make_cache(tmp_path, 2015, members, {"20002703": EFILE_2015})
    run_house_ingest(
        initialized_db, years=[2015], raw_root=cache, cache_dir=cache,
        run_id="run-2015", now=_now_factory(), host="testhost",
    )
    initialized_db.execute(
        "UPDATE filings SET parser_version = 'house-ptr-OLD'"
        " WHERE filing_id = 'house:20002703'"
    )

    reads: list[Path] = []

    def _read(path):
        reads.append(Path(path))
        return Path(path).read_bytes()

    selection = select_reparse_targets(
        initialized_db, ReparseSelector(parser_version="house-ptr-OLD")
    )
    assert [f for f, _p in selection.targets] == ["house:20002703"]

    report = reparse_house(
        initialized_db, raw_root=cache,
        selector=ReparseSelector(parser_version="house-ptr-OLD"),
        read_archive=_read,
    )
    assert report.ok
    assert reads == [Path(cache) / "pdfs" / "2015" / "20002703.pdf"]  # archive only
    (stamped,) = initialized_db.execute(
        "SELECT parser_version FROM filings WHERE filing_id = 'house:20002703'"
    ).fetchone()
    assert stamped == house_ptr.PARSER_VERSION       # re-stamped, re-evaluated


# --- fetcher instrumentation (RUN M1-B, R20) ---------------------------------


def test_retry_path_counts_two_attempts_one_retry_and_one_backoff(
    tmp_path, initialized_db
):
    transport = _live_transport([WITTMAN], {})
    transport.route(_pdf_url("20034916"), _resp(429), _resp(200, EFILE_2026))
    clock = FakeClock()
    report = _run(
        initialized_db, raw_root=tmp_path / "raw", transport=transport,
        sleep=clock.sleep, monotonic=clock.monotonic,
    )
    assert report.ok, house.format_summary(report)
    # index (1) + PTR 429 (1) + PTR 200 (1)
    assert report.fetch.attempts == 3
    assert report.fetch.retries == 1
    assert report.fetch.status_counts == {200: 2, 429: 1}
    assert report.fetch.backoff_sleep_s == BACKOFF_SCHEDULE[0]
    assert BACKOFF_SCHEDULE[0] in clock.sleeps

    summary = house.format_summary(report)
    assert "house transport: attempts 3 | retries 1" in summary
    assert "status mix 200:2, 429:1" in summary


def test_no_retry_path_counts_one_attempt_per_request_and_no_backoff(
    tmp_path, initialized_db
):
    clock = FakeClock()
    report = _run(
        initialized_db, raw_root=tmp_path / "raw",
        transport=_live_transport([WITTMAN], {"20034916": EFILE_2026}),
        sleep=clock.sleep, monotonic=clock.monotonic,
    )
    assert report.fetch.attempts == 2            # index + one PTR
    assert report.fetch.retries == 0
    assert report.fetch.backoff_sleep_s == 0.0
    assert report.fetch.status_counts == {200: 2}


def test_elapsed_comes_from_the_injected_monotonic_and_is_none_in_cache_mode(
    tmp_path, initialized_db
):
    class _RecordingClock:
        """Absurd values a real monotonic clock could never produce, so a
        wall-clock read would be unmistakable."""

        def __init__(self):
            self.now = 1_000_000.0
            self.seen: list[float] = []

        def monotonic(self) -> float:
            self.seen.append(self.now)
            self.now += 12.5
            return self.seen[-1]

        def sleep(self, _seconds: float) -> None:
            pass

    clock = _RecordingClock()
    report = _run(
        initialized_db, raw_root=tmp_path / "raw",
        transport=_live_transport([WITTMAN], {"20034916": EFILE_2026}),
        sleep=clock.sleep, monotonic=clock.monotonic,
    )
    assert report.elapsed_s == clock.seen[-1] - clock.seen[0]
    assert report.elapsed_s > 0
    assert f"elapsed {report.elapsed_s:.1f}s" in house.format_summary(report)

    cache = _make_cache(tmp_path, 2026, [WITTMAN], {"20034916": EFILE_2026})
    cache_report = _run(
        initialized_db, raw_root=cache, cache_dir=cache, run_id="run-cache",
    )
    assert cache_report.elapsed_s is None        # no clock injected, none faked
    assert cache_report.fetch.attempts == 0
    assert "elapsed n/a (cache mode)" in house.format_summary(cache_report)
