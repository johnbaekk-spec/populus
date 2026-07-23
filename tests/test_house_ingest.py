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
    assert meta == {"etag": '"tag-1"', "last_modified": "Fri, 10 Jul 2026 00:00:00 GMT"}

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
