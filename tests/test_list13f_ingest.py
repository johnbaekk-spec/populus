"""Ingest of the SEC Official 13(f) List (RUN M2-5): fetch, cache, quarter
derivation, backfill selection — all offline (the transport is injected and the
autouse socket guard blocks any escape)."""

from __future__ import annotations

import hashlib
import io
import json
import shutil
from pathlib import Path

import pytest
from pypdf import PdfReader, PdfWriter

from populus.amendments import ensure_views
from populus.db import connect, init_db
from populus.identity.registry import ensure_registry
from populus.ingest import TransportResponse
from populus.ingest import list13f as _list13f
from populus.ingest.list13f import (
    List13fIngestError,
    _CacheSource,
    _LiveSource,
    pdf_url,
    quarter_from_url,
    select_backfill_quarters,
    txt_url,
)
from populus.load import ensure_inst_schema
from populus.net.sec_client import SecClient

FIXTURES = Path(__file__).parent / "fixtures" / "inst" / "13flist"


class _FakeSecTransport:
    """Serves committed excerpt bytes by URL; 404 for anything else."""

    def __init__(self, files: dict[str, bytes]) -> None:
        self.files = files
        self.requested: list[str] = []

    def get(self, url, *, headers):
        self.requested.append(url)
        content = self.files.get(url)
        if content is None:
            return TransportResponse(status_code=404, headers={}, content=b"")
        return TransportResponse(status_code=200, headers={}, content=content)


def _client(files):
    clock = iter(range(1, 10_000))
    return SecClient(
        _FakeSecTransport(files),
        contact="test@example.com",
        sleep=lambda _s: None,
        monotonic=lambda: next(clock),
    )


# --- quarter derivation from the URL/filename (Locked Decision 1) -------------


def test_quarter_from_url_for_every_variant():
    assert quarter_from_url(pdf_url("2026q2")) == "2026q2"
    assert quarter_from_url(txt_url("2026q2")) == "2026q2"
    for quarter in ("2025q1", "2025q2", "2025q3", "2025q4", "2026q1"):
        assert quarter_from_url(pdf_url(quarter)) == quarter


# --- live source through the SecClient (R2) -----------------------------------


def test_live_source_writes_the_sidecar_shape_with_matching_sha(tmp_path):
    txt = (FIXTURES / "13flist2026q2-excerpt.txt").read_bytes()
    pdf = (FIXTURES / "13flist2026q2-excerpt.pdf").read_bytes()
    client = _client({txt_url("2026q2"): txt, pdf_url("2026q2"): pdf})
    source = _LiveSource(client, tmp_path, now=lambda: "2026-07-30T00:00:00Z")

    loaded = source.load("2026q2")

    # Both variants were fetched and R5-checked (the excerpts are identical).
    assert loaded.cross_format_checked is True
    assert loaded.quarter == "2026q2"
    # The seed variant is the text one; its sidecar carries the §5.1 fields.
    meta = loaded.source_meta
    assert meta["source_url"] == txt_url("2026q2")
    assert meta["http_status"] == 200
    assert meta["bytes"] == len(txt)
    assert meta["sha256"] == hashlib.sha256(txt).hexdigest()
    assert meta["retrieved_at"] == "2026-07-30T00:00:00Z"
    assert "populus" in meta["user_agent"].lower()
    # The bytes and the sidecar were archived on disk.
    archived = tmp_path / "13flist2026q2-txt.txt"
    assert archived.read_bytes() == txt
    on_disk = json.loads((tmp_path / "13flist2026q2-txt.txt.meta.json").read_text())
    assert on_disk["sha256"] == meta["sha256"]


def test_live_source_falls_back_to_pdf_when_the_text_variant_is_404(tmp_path):
    # Historical quarters 404 on the -txt.txt variant; the PDF is used and no
    # cross-format check runs.
    pdf = (FIXTURES / "13flist2025q1-excerpt.pdf").read_bytes()
    client = _client({pdf_url("2025q1"): pdf})  # no txt entry → 404
    source = _LiveSource(client, tmp_path, now=lambda: "2026-07-30T00:00:00Z")

    loaded = source.load("2025q1")

    assert loaded.cross_format_checked is False
    assert loaded.source_meta["source_url"] == pdf_url("2025q1")
    # The quarter comes from the request, not the stale legend (2024).
    assert loaded.quarter == "2025q1"
    assert all(record.quarter == "2025q1" for record in loaded.parsed.records)


def test_secclient_transport_is_required_positional():
    # There is no default transport — a caller can never accidentally reach the
    # live network (G6 / the socket guard's structural partner).
    with pytest.raises(TypeError):
        SecClient(contact="x", sleep=lambda _s: None, monotonic=lambda: 0.0)


# --- cache source (offline) ---------------------------------------------------


def _cache_dir_with(tmp_path, quarters, *, include_txt=()):
    cache = tmp_path / "13flist"
    cache.mkdir()
    for quarter in quarters:
        shutil.copy(FIXTURES / f"13flist{quarter}-excerpt.pdf", cache / f"13flist{quarter}.pdf")
        meta = {
            "source_url": pdf_url(quarter),
            "http_status": 200,
            "bytes": (cache / f"13flist{quarter}.pdf").stat().st_size,
            "sha256": hashlib.sha256((cache / f"13flist{quarter}.pdf").read_bytes()).hexdigest(),
            "retrieved_at": "2026-07-30T00:00:00Z",
            "user_agent": "populus-mcp/0.0.1",
        }
        (cache / f"13flist{quarter}.pdf.meta.json").write_text(json.dumps(meta))
    for quarter in include_txt:
        shutil.copy(FIXTURES / f"13flist{quarter}-excerpt.txt", cache / f"13flist{quarter}-txt.txt")
        txt_bytes = (cache / f"13flist{quarter}-txt.txt").read_bytes()
        (cache / f"13flist{quarter}-txt.txt.meta.json").write_text(
            json.dumps({"source_url": txt_url(quarter),
                        "http_status": 200,
                        "bytes": len(txt_bytes),
                        "sha256": hashlib.sha256(txt_bytes).hexdigest(),
                        "retrieved_at": "2026-07-30T00:00:00Z",
                        "user_agent": "populus-mcp/0.0.1"})
        )
    return cache


def test_cache_source_reads_sidecar_provenance(tmp_path):
    cache = _cache_dir_with(tmp_path, ["2026q1"])
    source = _CacheSource(cache)
    assert source.available_quarters() == {"2026q1"}
    loaded = source.load("2026q1")
    assert loaded.source_meta["source_url"] == pdf_url("2026q1")
    assert loaded.source_meta["raw_path"] == "13flist2026q1.pdf"
    assert loaded.source_meta["sha256"] == hashlib.sha256(
        (cache / "13flist2026q1.pdf").read_bytes()
    ).hexdigest()


def test_cache_source_runs_r5_when_both_formats_present(tmp_path):
    cache = _cache_dir_with(tmp_path, ["2026q2"], include_txt=["2026q2"])
    loaded = _CacheSource(cache).load("2026q2")
    assert loaded.cross_format_checked is True
    # The text variant is the seed source when present.
    assert loaded.source_meta["source_url"] == txt_url("2026q2")


def test_cache_source_flags_a_document_quarter_mismatch(tmp_path):
    # The filename is authoritative; if the PDF's in-document Year/Qtr header
    # disagrees, that is a corrupt/misnamed file and must error (not silently
    # trust the filename against a different document). The sidecar is valid
    # (matching bytes/url) so we reach the document-quarter check, not the F10 one.
    cache = tmp_path / "13flist"
    cache.mkdir()
    # A 2026Q2 PDF deliberately mis-filed as 2026Q1.
    shutil.copy(FIXTURES / "13flist2026q2-excerpt.pdf", cache / "13flist2026q1.pdf")
    pdf_bytes = (cache / "13flist2026q1.pdf").read_bytes()
    (cache / "13flist2026q1.pdf.meta.json").write_text(
        json.dumps({"source_url": pdf_url("2026q1"), "http_status": 200,
                    "bytes": len(pdf_bytes), "sha256": hashlib.sha256(pdf_bytes).hexdigest(),
                    "retrieved_at": "2026-07-30T00:00:00Z", "user_agent": "populus-mcp/0.0.1"})
    )
    with pytest.raises(List13fIngestError, match="quarter mismatch"):
        _CacheSource(cache).load("2026q1")


def test_cache_source_missing_quarter_errors(tmp_path):
    cache = tmp_path / "13flist"
    cache.mkdir()
    with pytest.raises(List13fIngestError, match="no cached list"):
        _CacheSource(cache).load("2099q9")


# --- F2: the R5 cross-format gate is mandatory for the dual-format quarter -----


def _full_txt_sidecar(cache, quarter):
    txt_bytes = (cache / f"13flist{quarter}-txt.txt").read_bytes()
    (cache / f"13flist{quarter}-txt.txt.meta.json").write_text(
        json.dumps({"source_url": txt_url(quarter), "http_status": 200,
                    "bytes": len(txt_bytes), "sha256": hashlib.sha256(txt_bytes).hexdigest(),
                    "retrieved_at": "2026-07-30T00:00:00Z", "user_agent": "populus-mcp/0.0.1"})
    )


def test_text_only_cache_for_the_dual_format_quarter_is_refused(tmp_path):
    # F2: 2026q2 ships in BOTH formats and its R5 gate is non-negotiable. A cache
    # holding ONLY the 2026q2 text (no PDF) must be REFUSED, never seeded blind.
    # Mutation guard: seeding the text without requiring the PDF (the pre-fix
    # behaviour) would return a LoadedQuarter here instead of raising.
    cache = tmp_path / "13flist"
    cache.mkdir()
    shutil.copy(FIXTURES / "13flist2026q2-excerpt.txt", cache / "13flist2026q2-txt.txt")
    _full_txt_sidecar(cache, "2026q2")
    with pytest.raises(List13fIngestError, match="mandatory"):
        _CacheSource(cache).load("2026q2")


def test_pdf_only_cache_for_the_dual_format_quarter_is_refused(tmp_path):
    # Round-1 F2, the OTHER direction: the dual-format quarter must fail closed
    # when the TEXT side is the one missing, not only when the PDF is. Without
    # this the gate could be satisfied by whichever variant happened to be cached,
    # which is exactly the "runs only when the counterpart happens to exist"
    # defect. Mutation guard: requiring only the PDF would return a LoadedQuarter
    # here (seeded from the PDF, R5 never run) instead of raising.
    cache = tmp_path / "13flist"
    cache.mkdir()
    pdf_bytes = (FIXTURES / "13flist2026q2-excerpt.pdf").read_bytes()
    (cache / "13flist2026q2.pdf").write_bytes(pdf_bytes)
    (cache / "13flist2026q2.pdf.meta.json").write_text(
        json.dumps({"source_url": pdf_url("2026q2"), "http_status": 200,
                    "bytes": len(pdf_bytes), "sha256": hashlib.sha256(pdf_bytes).hexdigest(),
                    "retrieved_at": "2026-07-30T00:00:00Z", "user_agent": "populus-mcp/0.0.1"})
    )
    with pytest.raises(List13fIngestError, match="mandatory"):
        _CacheSource(cache).load("2026q2")


def test_both_formats_present_for_the_dual_format_quarter_passes_the_gate(tmp_path):
    # The positive control for the two negatives above: with BOTH variants cached
    # the quarter loads AND records that the R5 identity check actually ran.
    cache = tmp_path / "13flist"
    cache.mkdir()
    shutil.copy(FIXTURES / "13flist2026q2-excerpt.txt", cache / "13flist2026q2-txt.txt")
    _full_txt_sidecar(cache, "2026q2")
    pdf_bytes = (FIXTURES / "13flist2026q2-excerpt.pdf").read_bytes()
    (cache / "13flist2026q2.pdf").write_bytes(pdf_bytes)
    (cache / "13flist2026q2.pdf.meta.json").write_text(
        json.dumps({"source_url": pdf_url("2026q2"), "http_status": 200,
                    "bytes": len(pdf_bytes), "sha256": hashlib.sha256(pdf_bytes).hexdigest(),
                    "retrieved_at": "2026-07-30T00:00:00Z", "user_agent": "populus-mcp/0.0.1"})
    )
    loaded = _CacheSource(cache).load("2026q2")
    assert loaded.cross_format_checked is True
    assert loaded.source_meta["source_url"] == txt_url("2026q2")


def test_live_text_200_but_pdf_failure_is_a_hard_error(tmp_path):
    # F2/F10: a live request where the text returns 200 but the PDF fails (500)
    # must be a HARD ERROR at the FETCH layer — never a "PDF absent" silent
    # fallback that seeds the text unvalidated. Uses a non-dual-format quarter so
    # the guard under test is the fetcher itself, not the F2 both-required check.
    # Mutation guard: treating any non-200 as an absent variant would let this seed
    # the text unvalidated (return a LoadedQuarter instead of raising).
    txt = (FIXTURES / "13flist2026q2-excerpt.txt").read_bytes()

    class _TextOkPdf500:
        def get(self, url, *, headers):
            if url == txt_url("2026q1"):
                return TransportResponse(status_code=200, headers={}, content=txt)
            return TransportResponse(status_code=500, headers={}, content=b"")

    clock = iter(range(1, 10_000))
    client = SecClient(_TextOkPdf500(), contact="t@example.com",
                       sleep=lambda _s: None, monotonic=lambda: next(clock))
    source = _LiveSource(client, tmp_path, now=lambda: "2026-07-30T00:00:00Z")
    with pytest.raises(List13fIngestError, match="HTTP 500"):
        source.load("2026q1")


def test_invalid_utf8_text_is_a_hard_error(tmp_path):
    # F9: a text variant with invalid UTF-8 bytes is a hard error — never repaired
    # with U+FFFD and seeded. Mutation guard: decoding with errors="replace" would
    # accept the bytes and proceed to a seedable parse.
    cache = tmp_path / "13flist"
    cache.mkdir()
    # A row whose issuer-name column carries a raw invalid byte (0xFF), padded to 80.
    good = "037833100 " + "APPLE INC".ljust(30) + "COM".ljust(27) + "   " + " " * 9 + "E"
    raw = good.encode("utf-8")[:15] + b"\xff" + good.encode("utf-8")[16:] + b"\n"
    (cache / "13flist2026q1-txt.txt").write_bytes(raw)
    (cache / "13flist2026q1-txt.txt.meta.json").write_text(
        json.dumps({"source_url": txt_url("2026q1"), "http_status": 200,
                    "bytes": len(raw), "sha256": hashlib.sha256(raw).hexdigest(),
                    "retrieved_at": "2026-07-30T00:00:00Z", "user_agent": "populus-mcp/0.0.1"})
    )
    with pytest.raises(List13fIngestError, match="valid UTF-8"):
        _CacheSource(cache).load("2026q1")


# --- F4: parse-coverage gate enforced before a variant may seed ---------------


def test_pdf_with_no_data_region_is_refused(tmp_path):
    # F4: a PDF with a valid cover and legend but NO data pages parses as
    # rows_read=0 at parse_coverage=1.0 — it must be REFUSED, never silently
    # seeded empty. Mutation guard: not enforcing rows_read>0 would return a
    # LoadedQuarter with zero records here.
    reader = PdfReader(io.BytesIO((FIXTURES / "13flist2026q2-excerpt.pdf").read_bytes()))
    writer = PdfWriter()
    writer.add_page(reader.pages[0])  # cover
    writer.add_page(reader.pages[1])  # legend — but no data page
    buf = io.BytesIO()
    writer.write(buf)
    pdf_bytes = buf.getvalue()
    cache = tmp_path / "13flist"
    cache.mkdir()
    (cache / "13flist2025q1.pdf").write_bytes(pdf_bytes)
    (cache / "13flist2025q1.pdf.meta.json").write_text(
        json.dumps({"source_url": pdf_url("2025q1"), "http_status": 200,
                    "bytes": len(pdf_bytes), "sha256": hashlib.sha256(pdf_bytes).hexdigest(),
                    "retrieved_at": "2026-07-30T00:00:00Z", "user_agent": "populus-mcp/0.0.1"})
    )
    with pytest.raises(List13fIngestError, match="zero data rows"):
        _CacheSource(cache).load("2025q1")


def test_parse_coverage_below_the_floor_is_refused():
    # F4: a parse below the 99.9% coverage floor is refused before it can seed.
    # Exercised on the module validator with a crafted low-coverage disposition.
    import dataclasses as _dc

    from populus.parse.list13f import Disposition13f, parse_list13f_pdf

    parsed = parse_list13f_pdf((FIXTURES / "13flist2026q1-excerpt.pdf").read_bytes(),
                               quarter="2026q1")
    # 2 of 1000 data lines unrecognized ⇒ coverage 0.998 < 0.999.
    low = Disposition13f(rows_read=1000, accepted=998, rejected_bad_width=2)
    assert low.parse_coverage < _list13f.PARSE_COVERAGE_FLOOR
    starved = _dc.replace(parsed, disposition=low)
    with pytest.raises(List13fIngestError, match="parse coverage"):
        _list13f._validate_parse(starved, quarter="2026q1", variant="pdf")


def test_parse_coverage_exactly_at_the_floor_is_accepted():
    # Round-1 F3, the BOUNDARY: the gate is ">= 0.999", so a parse at EXACTLY the
    # floor must PASS. 999 of 1000 rows recognized = 0.999 exactly. Mutation guard:
    # writing the comparison as `coverage <= FLOOR` (or the floor as a strict `>`)
    # would reject this and the test fails — this is the case an off-by-one in the
    # comparison operator breaks, and the below/above tests alone would not catch.
    import dataclasses as _dc

    from populus.parse.list13f import Disposition13f, parse_list13f_pdf

    parsed = parse_list13f_pdf((FIXTURES / "13flist2026q1-excerpt.pdf").read_bytes(),
                               quarter="2026q1")
    boundary = Disposition13f(rows_read=1000, accepted=999, rejected_bad_width=1)
    assert boundary.parse_coverage == pytest.approx(_list13f.PARSE_COVERAGE_FLOOR)
    at_floor = _dc.replace(parsed, disposition=boundary,
                           document_total_count=boundary.rows_read)
    _list13f._validate_parse(at_floor, quarter="2026q1", variant="pdf")  # must NOT raise


def test_parse_coverage_above_the_floor_is_accepted():
    # The passing case: a clean full-coverage parse of the real committed excerpt
    # goes through the same validator untouched.
    from populus.parse.list13f import parse_list13f_pdf

    parsed = parse_list13f_pdf((FIXTURES / "13flist2026q1-excerpt.pdf").read_bytes(),
                               quarter="2026q1")
    assert parsed.disposition.parse_coverage == 1.0
    _list13f._validate_parse(parsed, quarter="2026q1", variant="pdf")  # must NOT raise


def test_total_count_trailer_mismatch_is_refused():
    # F4: when the SEC prints its own 'Total Count' trailer, a parse that does not
    # match it exactly is refused (the parse dropped or gained rows). Mutation
    # guard: ignoring the trailer would let a row-count divergence seed.
    import dataclasses as _dc

    from populus.parse.list13f import parse_list13f_pdf

    parsed = parse_list13f_pdf((FIXTURES / "13flist2026q1-excerpt.pdf").read_bytes(),
                               quarter="2026q1")
    assert parsed.disposition.rows_read == 34
    tampered = _dc.replace(parsed, document_total_count=35)  # SEC says 35, we parsed 34
    with pytest.raises(List13fIngestError, match="Total Count"):
        _list13f._validate_parse(tampered, quarter="2026q1", variant="pdf")


# --- F10: sidecars are mandatory and verified against the bytes in cache mode --


def test_cache_sidecar_is_required(tmp_path):
    # F10: a present cache file with NO sidecar is a hard error (not meta={}).
    cache = tmp_path / "13flist"
    cache.mkdir()
    shutil.copy(FIXTURES / "13flist2026q1-excerpt.pdf", cache / "13flist2026q1.pdf")
    with pytest.raises(List13fIngestError, match="sidecar is"):
        _CacheSource(cache).load("2026q1")


def test_cache_sidecar_sha_mismatch_is_refused(tmp_path):
    # F10: a sidecar whose sha256 does not match the bytes is a hard error — a
    # stale hash can no longer seed content under a wrong provenance. Mutation
    # guard: trusting the supplied sha would accept this.
    cache = tmp_path / "13flist"
    cache.mkdir()
    shutil.copy(FIXTURES / "13flist2026q1-excerpt.pdf", cache / "13flist2026q1.pdf")
    (cache / "13flist2026q1.pdf.meta.json").write_text(
        json.dumps({"source_url": pdf_url("2026q1"), "http_status": 200,
                    "bytes": (cache / "13flist2026q1.pdf").stat().st_size,
                    "sha256": "0" * 64,  # wrong
                    "retrieved_at": "2026-07-30T00:00:00Z", "user_agent": "populus-mcp/0.0.1"})
    )
    with pytest.raises(List13fIngestError, match="sha256"):
        _CacheSource(cache).load("2026q1")


def test_cache_sidecar_malformed_json_is_a_typed_error(tmp_path):
    # Round-1 F5: a corrupt sidecar must be a TYPED ingest error naming the file —
    # not a raw json.JSONDecodeError leaking out of the ingest layer, and never a
    # silent fall-back to an empty metadata object. Mutation guard: removing the
    # try/except would raise JSONDecodeError, which this pytest.raises rejects.
    cache = tmp_path / "13flist"
    cache.mkdir()
    shutil.copy(FIXTURES / "13flist2026q1-excerpt.pdf", cache / "13flist2026q1.pdf")
    (cache / "13flist2026q1.pdf.meta.json").write_text("{not valid json,,,")
    with pytest.raises(List13fIngestError, match="not valid JSON"):
        _CacheSource(cache).load("2026q1")


def test_cache_sidecar_that_is_not_an_object_is_refused(tmp_path):
    # Valid JSON, wrong shape: a list carries no §5.1 fields and must be refused
    # with a typed error rather than blowing up on attribute access downstream.
    cache = tmp_path / "13flist"
    cache.mkdir()
    shutil.copy(FIXTURES / "13flist2026q1-excerpt.pdf", cache / "13flist2026q1.pdf")
    (cache / "13flist2026q1.pdf.meta.json").write_text("[1, 2, 3]")
    with pytest.raises(List13fIngestError, match="not a JSON object"):
        _CacheSource(cache).load("2026q1")


@pytest.mark.parametrize(
    "dropped",
    ["source_url", "http_status", "bytes", "sha256", "retrieved_at", "user_agent"],
)
def test_every_required_sidecar_field_is_enforced(tmp_path, dropped):
    # Round-1 F5: EACH §5.1 field is individually required — a sidecar missing any
    # one of them cannot seed. Parametrized so dropping the enforcement of a single
    # field (rather than all six) is still caught.
    cache = tmp_path / "13flist"
    cache.mkdir()
    shutil.copy(FIXTURES / "13flist2026q1-excerpt.pdf", cache / "13flist2026q1.pdf")
    content = (cache / "13flist2026q1.pdf").read_bytes()
    meta = {
        "source_url": pdf_url("2026q1"), "http_status": 200, "bytes": len(content),
        "sha256": hashlib.sha256(content).hexdigest(),
        "retrieved_at": "2026-07-30T00:00:00Z", "user_agent": "populus-mcp/0.0.1",
    }
    del meta[dropped]
    (cache / "13flist2026q1.pdf.meta.json").write_text(json.dumps(meta))
    with pytest.raises(List13fIngestError, match="missing required"):
        _CacheSource(cache).load("2026q1")


def test_cache_sidecar_byte_count_mismatch_is_refused(tmp_path):
    # Round-1 F5: the byte count is verified against the file, not trusted.
    cache = tmp_path / "13flist"
    cache.mkdir()
    shutil.copy(FIXTURES / "13flist2026q1-excerpt.pdf", cache / "13flist2026q1.pdf")
    content = (cache / "13flist2026q1.pdf").read_bytes()
    (cache / "13flist2026q1.pdf.meta.json").write_text(json.dumps({
        "source_url": pdf_url("2026q1"), "http_status": 200,
        "bytes": len(content) + 1,  # wrong
        "sha256": hashlib.sha256(content).hexdigest(),
        "retrieved_at": "2026-07-30T00:00:00Z", "user_agent": "populus-mcp/0.0.1",
    }))
    with pytest.raises(List13fIngestError, match="bytes"):
        _CacheSource(cache).load("2026q1")


# --- backfill selection (R8) --------------------------------------------------


def _fresh_inst_db(tmp_path):
    path = tmp_path / "inst.db"
    init_db(str(path))
    conn = connect(str(path))
    ensure_registry(conn)
    ensure_inst_schema(conn)
    ensure_views(conn)
    return conn


def _seed_period(conn, period):
    conn.execute(
        "INSERT INTO inst_filers (cik, name_raw, source, source_url,"
        " source_record_id, parser_version, normalization_version, ingested_at)"
        " VALUES ('0000000001','F','sec-edgar','u','0000000001','p','n','2026-01-01T00:00:00Z')"
    )
    conn.execute(
        "INSERT INTO inst_filings (filing_id, cik, accession, submission_type,"
        " period_of_report, filed_date, unit_basis, is_amendment,"
        " filing_manager_raw, parse_status, doc_url, source, source_url,"
        " source_record_id, parser_version, normalization_version, ingested_at)"
        " VALUES (?, '0000000001', ?, '13F-HR', ?, ?, 'whole',"
        " 0, 'F', 'parsed', 'u', 'sec-edgar', 'u', ?, 'p', 'n', '2026-01-01T00:00:00Z')",
        (f"inst:{period}", period, period, period, period),
    )
    conn.commit()


def test_select_backfill_defaults_to_quarters_covering_loaded_periods(tmp_path):
    conn = _fresh_inst_db(tmp_path)
    _seed_period(conn, "2026-03-31")  # falls in 2026q1
    available = {"2025q4", "2026q1", "2026q2"}
    assert select_backfill_quarters(conn, available) == ["2026q1"]
    conn.close()


def test_select_backfill_start_quarter_overrides(tmp_path):
    conn = _fresh_inst_db(tmp_path)  # no periods loaded
    available = {"2025q4", "2026q1", "2026q2"}
    assert select_backfill_quarters(conn, available) == []  # nothing to cover
    assert select_backfill_quarters(conn, available, start_quarter="2026q1") == [
        "2026q1",
        "2026q2",
    ]
    conn.close()


def test_select_backfill_rejects_a_bad_start_quarter(tmp_path):
    conn = _fresh_inst_db(tmp_path)
    with pytest.raises(List13fIngestError, match="YYYYqN"):
        select_backfill_quarters(conn, {"2026q1"}, start_quarter="nonsense")
    conn.close()
