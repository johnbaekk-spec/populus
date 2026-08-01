"""RUN M2-6 — the default-inert extension of the M2-2 ingest seam.

Covers the allowlist + report-period assertion, the deferred-finalize
equivalence, and the per-document cache-first, checkpoint-before-bytes resume
(R13) at every interruption boundary plus the corrupt-at-rest / absent-bytes /
missing-entry-self-heal paths. Every durable document is proven to resume with
ZERO transport; a never-durable one is fetched exactly once.

The corruption-replacement boundary is interrupted MID-REPLACEMENT, in both
directions, by spying on the two ``atomic_write_bytes`` calls — so the write
ORDER is observable and reversing it fails the resume assertions. A test that
let both writes finish before resuming could not see the order at all.
"""

from __future__ import annotations

import json
import shutil
from pathlib import Path

import pytest

import bulk_corpus as bc
from bulk_corpus import FilerSpec, FilingSpec, filer_lineage, filer_url_map

import populus.inst_bulk as ib
import populus.ingest.checkpoint as checkpoint_mod
import populus.ingest.inst13f as inst13f
from populus.amendments import ensure_views
from populus.db import connect, init_db
from populus.identity.registry import ensure_registry
from populus.ingest import TransportResponse
from populus.ingest.inst13f import (
    compute_coverage,
    finalize_inst_ingest,
    run_inst13f_ingest,
)
from populus.load import ensure_inst_schema
from populus.net.sec_client import SecClient

NOW = "2026-09-30T00:00:00Z"

CRAFTED_DIR = Path(__file__).parent / "fixtures" / "inst" / "crafted"

# A single-filing filer → four documents (submissions + index/cover/table).
SEAM_FILER = FilerSpec("0009100001", "MEGA CAPITAL", (
    FilingSpec(1, "13F-HR", "2026-07-05", bc.REPORT_PERIOD, 900_000_000, "911000010"),
))
ACCESSION = "0009100001-26-000001"
NODASH = ACCESSION.replace("-", "")
TABLE = "tbl_0001_1.xml"


class _FakeTransport:
    def __init__(self, files):
        self.files = dict(files)
        self.requested: list[str] = []

    def get(self, url, *, headers):
        self.requested.append(url)
        content = self.files.get(url)
        if content is None:
            return TransportResponse(status_code=404, headers={}, content=b"")
        return TransportResponse(status_code=200, headers={}, content=content)


def _client(transport):
    clock = iter(range(1, 10_000_000))
    return SecClient(
        transport, contact="test@example.com",
        sleep=lambda _s: None, monotonic=lambda: next(clock),
    )


_DB_SEQ = iter(range(1, 10_000_000))


def _fresh_db(tmp_path):
    path = tmp_path / f"seam-{next(_DB_SEQ)}.db"
    init_db(str(path))
    conn = connect(str(path))
    ensure_registry(conn)
    ensure_inst_schema(conn)
    ensure_views(conn)
    conn.execute(
        "INSERT INTO securities (security_id, id_state, review_state)"
        " VALUES ('sec:t', 'provisional', 'auto') ON CONFLICT DO NOTHING"
    )
    conn.execute(
        "INSERT INTO security_identifiers (security_id, id_type, value, valid_from,"
        " valid_to, provenance, confidence, review_state, license_id, raw)"
        " VALUES ('sec:t', 'cusip', '911000010', '2020-01-01', NULL, 'sec-ftd',"
        " 'high', 'auto', 'sec-ftd', NULL)"
    )
    return conn


_RUN_SEQ = iter(range(1, 10_000_000))


def _ingest(conn, url_map, raw_root, *, resume=True):
    transport = ib.CountingTransport(_FakeTransport(url_map))
    client = _client(transport)
    report = run_inst13f_ingest(
        conn, run_id=f"seam-{next(_RUN_SEQ)}", now=lambda: NOW, host="h",
        ingested_at=NOW, ciks=[SEAM_FILER.cik],
        accessions=filer_lineage(SEAM_FILER), report_period=bc.REPORT_PERIOD,
        run_passes=True, resume=resume, client=client, raw_root=raw_root,
    )
    return report, transport


# --- allowlist + report-period assertion -------------------------------------


def test_accession_allowlist_restricts_the_loaded_set(tmp_path):
    filer = FilerSpec("0009105001", "MULTI", (
        FilingSpec(1, "13F-HR", "2026-07-05", bc.REPORT_PERIOD, 100_000_000, "911005001"),
        FilingSpec(2, "13F-HR/A", "2026-08-05", bc.REPORT_PERIOD, 50_000_000, "911005002",
                   "NEW HOLDINGS", 1),
    ))
    url_map = filer_url_map(filer)
    conn = _fresh_db(tmp_path)
    transport = ib.CountingTransport(_FakeTransport(url_map))
    client = _client(transport)
    run_inst13f_ingest(
        conn, run_id="allow", now=lambda: NOW, host="h", ingested_at=NOW,
        ciks=[filer.cik], accessions={"0009105001-26-000001"},   # base only
        report_period=bc.REPORT_PERIOD, run_passes=True, resume=False,
        client=client, raw_root=tmp_path / "raw",
    )
    loaded = {r[0] for r in conn.execute("SELECT accession FROM inst_filings")}
    assert loaded == {"0009105001-26-000001"}    # the amendment was not loaded
    conn.close()


def test_defaults_are_inert_no_allowlist_loads_everything(tmp_path):
    filer = FilerSpec("0009105002", "BOTH", (
        FilingSpec(1, "13F-HR", "2026-07-05", bc.REPORT_PERIOD, 100_000_000, "911005011"),
        FilingSpec(2, "13F-HR/A", "2026-08-05", bc.REPORT_PERIOD, 50_000_000, "911005012",
                   "NEW HOLDINGS", 1),
    ))
    url_map = filer_url_map(filer)
    conn = _fresh_db(tmp_path)
    transport = ib.CountingTransport(_FakeTransport(url_map))
    client = _client(transport)
    # accessions=None, report_period=None, run_passes default True, resume default
    # False → today's behaviour: every discovered accession loads.
    run_inst13f_ingest(
        conn, run_id="inert", now=lambda: NOW, host="h", ingested_at=NOW,
        ciks=[filer.cik], client=client, raw_root=tmp_path / "raw",
    )
    loaded = {r[0] for r in conn.execute("SELECT accession FROM inst_filings")}
    assert loaded == {"0009105002-26-000001", "0009105002-26-000002"}
    conn.close()


# --- deferred finalize equivalence (R16/F8) ----------------------------------


def test_run_passes_false_plus_finalize_equals_default_all_in_one(tmp_path):
    def _dump(conn):
        return conn.execute(
            "SELECT filing_id, parse_status, amends, flags FROM inst_filings"
            " ORDER BY filing_id"
        ).fetchall()

    # Default: passes run inline at the tail.
    c1 = _fresh_db_crafted(tmp_path)
    run_inst13f_ingest(c1, run_id="d1", now=lambda: NOW, host="h", ingested_at=NOW,
                       cache_dir=CRAFTED_DIR)
    cov1 = compute_coverage(c1)
    dump1 = _dump(c1)
    c1.close()

    # Deferred: run_passes=False then a single finalize.
    c2 = _fresh_db_crafted(tmp_path)
    run_inst13f_ingest(c2, run_id="d2", now=lambda: NOW, host="h", ingested_at=NOW,
                       cache_dir=CRAFTED_DIR, run_passes=False)
    finalize = finalize_inst_ingest(c2)
    cov2 = compute_coverage(c2)
    dump2 = _dump(c2)
    c2.close()

    assert dump1 == dump2                       # identical lineage + flags
    assert cov1 == cov2                          # identical coverage inputs
    assert finalize.coverage == cov1


def _fresh_db_crafted(tmp_path):
    path = tmp_path / f"crafted-{next(_DB_SEQ)}.db"
    init_db(str(path))
    conn = connect(str(path))
    ensure_registry(conn)
    ensure_inst_schema(conn)
    ensure_views(conn)
    return conn


# --- per-document cache-first resume (R13/F2) --------------------------------


def _canonical_raw(tmp_path):
    """A fully-durable archive from one clean resume ingest, plus the clean DB
    row snapshot to compare every resumed run against."""
    conn = _fresh_db(tmp_path)
    raw = tmp_path / "raw-canonical"
    _ingest(conn, filer_url_map(SEAM_FILER), raw)
    holdings = conn.execute("SELECT COUNT(*) FROM inst_holdings").fetchone()[0]
    status = conn.execute(
        "SELECT parse_status FROM inst_filings WHERE accession = ?", (ACCESSION,)
    ).fetchone()[0]
    conn.close()
    return raw, holdings, status


def _paths(raw: Path):
    cikdir = raw / f"CIK{SEAM_FILER.cik}"
    acc = cikdir / NODASH
    return {
        "submissions": cikdir / "submissions.json",
        "submissions_meta": cikdir / "submissions-meta.json",
        "index": acc / "index.json",
        "cover": acc / "primary_doc.xml",
        "table": acc / TABLE,
        "fetch_meta": acc / "fetch-meta.json",
        "acc_dir": acc,
    }


def _resume_into_fresh(tmp_path, raw: Path, url_map=None):
    conn = _fresh_db(tmp_path)
    report, transport = _ingest(conn, url_map or filer_url_map(SEAM_FILER), raw)
    holdings = conn.execute("SELECT COUNT(*) FROM inst_holdings").fetchone()[0]
    status = conn.execute(
        "SELECT parse_status FROM inst_filings WHERE accession = ?", (ACCESSION,)
    ).fetchone()[0]
    conn.close()
    return transport, holdings, status


def _copy(raw: Path, tmp_path, name: str) -> Path:
    dest = tmp_path / name
    shutil.copytree(raw, dest)
    return dest


def test_boundary_all_durable_reads_everything_with_zero_transport(tmp_path):
    raw, holds, status = _canonical_raw(tmp_path)
    work = _copy(raw, tmp_path, "all-durable")
    transport, h2, s2 = _resume_into_fresh(tmp_path, work)
    assert transport.attempts == 0          # every document durable
    assert (h2, s2) == (holds, status)      # identical to a clean run


def test_boundary_submissions_durable_only_refetches_accession_docs(tmp_path):
    raw, holds, status = _canonical_raw(tmp_path)
    work = _copy(raw, tmp_path, "subm-only")
    shutil.rmtree(_paths(work)["acc_dir"])   # crash after submissions, before docs
    transport, h2, s2 = _resume_into_fresh(tmp_path, work)
    # submissions cache-first (0), index+cover+table fetched (3) — NOT four.
    assert transport.attempts == 3
    assert (h2, s2) == (holds, status)


def test_boundary_some_accession_docs_durable(tmp_path):
    raw, holds, status = _canonical_raw(tmp_path)
    work = _copy(raw, tmp_path, "some-docs")
    p = _paths(work)
    # Keep index durable; drop cover + table bytes AND their checkpoint entries.
    meta = json.loads(p["fetch_meta"].read_text())
    for key in ("primary_doc.xml", TABLE):
        meta["documents"].pop(key, None)
    p["fetch_meta"].write_text(json.dumps(meta))
    p["cover"].unlink()
    p["table"].unlink()
    transport, h2, s2 = _resume_into_fresh(tmp_path, work)
    assert transport.attempts == 2          # cover + table only; index reused
    assert (h2, s2) == (holds, status)


def test_boundary_first_write_crash_checkpoint_present_bytes_absent(tmp_path):
    # A crash AFTER the checkpoint entry, BEFORE the byte rename: the checkpoint
    # names a hash but the bytes are absent. Resume fetches that document exactly
    # once and nothing else.
    raw, holds, status = _canonical_raw(tmp_path)
    work = _copy(raw, tmp_path, "checkpoint-no-bytes")
    p = _paths(work)
    assert "primary_doc.xml" in json.loads(p["fetch_meta"].read_text())["documents"]
    p["cover"].unlink()                     # checkpoint stays, bytes gone
    transport, h2, s2 = _resume_into_fresh(tmp_path, work)
    assert transport.attempts == 1          # exactly one fetch, for the cover
    cover_fetches = [u for u in transport._inner.requested if u.endswith("/primary_doc.xml")]
    assert len(cover_fetches) == 1
    assert (h2, s2) == (holds, status)


def test_boundary_corrupt_at_rest_bytes_mismatch_checkpoint_refetches(tmp_path):
    raw, holds, status = _canonical_raw(tmp_path)
    work = _copy(raw, tmp_path, "corrupt-at-rest")
    p = _paths(work)
    p["cover"].write_bytes(b"<corrupt/>")   # bytes present but mismatch checkpoint
    transport, h2, s2 = _resume_into_fresh(tmp_path, work)
    assert transport.attempts == 1          # the mismatching doc is refetched
    assert (h2, s2) == (holds, status)      # and the run recovers cleanly


# --- the corruption-replacement crash boundary (d), interrupted MID-REPLACEMENT
#
# The replacement path performs exactly two durable writes: the expected-hash
# CHECKPOINT (fetch-meta.json) and the document BYTE rename (primary_doc.xml).
# A test that lets BOTH complete before resuming cannot see their order — the
# end state is the same either way. These two tests interrupt BETWEEN them, in
# each direction, and resume from that ACTUAL intermediate archive state:
#
#   * crash after the checkpoint, before the bytes  → exactly ONE refetch;
#   * crash after the bytes, before anything else   → ZERO transport.
#
# Reversing the production order (bytes renamed before the checkpoint is
# committed) makes the spy interrupt land in the opposite state and FAILS both
# assertions — that is the ordering guard.
#
# The replacement document is byte-different from the pre-corruption one (a
# re-serialized but semantically identical cover), so the new checkpoint hash
# differs from the old one and the two orderings are actually distinguishable.


class _Interrupt(RuntimeError):
    """A simulated crash at an exact durability boundary."""


def _replacement_map():
    """The URL map for the replacement fetch: the cover bytes differ from the
    archived ones while parsing to the identical filing."""
    url_map = dict(filer_url_map(SEAM_FILER))
    cover_url = next(u for u in url_map if u.endswith("/primary_doc.xml"))
    variant = url_map[cover_url].replace(
        b"</edgarSubmission>", b"  <!-- refiled -->\n</edgarSubmission>"
    )
    assert variant != url_map[cover_url]
    url_map[cover_url] = variant
    return url_map


def _replace_until(tmp_path, work: Path, stop_after: Path, monkeypatch):
    """Run a replacement ingest over *work*, crashing immediately after the
    ``atomic_write_bytes`` whose target is *stop_after*. Returns the observed
    write order."""
    order: list[str] = []
    real_write = inst13f.atomic_write_bytes

    def spy(path, data):
        real_write(path, data)
        order.append(Path(path).name)
        if Path(path) == stop_after:
            raise _Interrupt(f"crash immediately after writing {Path(path).name}")

    # Both durable writes are spied: the document bytes go through inst13f's
    # own writer, and the checkpoint sidecar through the shared
    # ``populus.ingest.checkpoint`` primitive the House fetch also uses
    # (RUN M1-B, R1). Patching only one would silently stop observing half
    # the ordering this test exists to guard.
    monkeypatch.setattr(inst13f, "atomic_write_bytes", spy)
    monkeypatch.setattr(checkpoint_mod, "atomic_write_bytes", spy)
    conn = _fresh_db(tmp_path)
    with pytest.raises(_Interrupt):
        _ingest(conn, _replacement_map(), work)
    conn.close()
    monkeypatch.undo()
    return order


def test_replacement_crash_between_checkpoint_and_byte_rename_refetches_once(
    tmp_path, monkeypatch
):
    raw, holds, status = _canonical_raw(tmp_path)
    work = _copy(raw, tmp_path, "replacement-mid")
    p = _paths(work)
    p["cover"].write_bytes(b"<corrupt/>")

    order = _replace_until(tmp_path, work, p["fetch_meta"], monkeypatch)
    # The checkpoint is the FIRST of the two writes — the bytes never landed.
    assert order == ["fetch-meta.json"]
    assert p["cover"].read_bytes() == b"<corrupt/>"
    checkpoint = json.loads(p["fetch_meta"].read_text())["documents"]["primary_doc.xml"]
    assert checkpoint["response_hash"] != inst13f._sha256(p["cover"].read_bytes())

    # Resume from that ACTUAL intermediate state: the bytes do not match their
    # committed checkpoint, so the cover — and only the cover — is refetched.
    transport, h2, s2 = _resume_into_fresh(tmp_path, work, _replacement_map())
    assert transport.attempts == 1
    assert [u for u in transport._inner.requested if u.endswith("/primary_doc.xml")]
    assert (h2, s2) == (holds, status)


def test_replacement_crash_after_byte_rename_resumes_with_zero_transport(
    tmp_path, monkeypatch
):
    raw, holds, status = _canonical_raw(tmp_path)
    work = _copy(raw, tmp_path, "replacement-post")
    p = _paths(work)
    p["cover"].write_bytes(b"<corrupt/>")

    order = _replace_until(tmp_path, work, p["cover"], monkeypatch)
    # The byte rename is the SECOND write: its checkpoint was already committed.
    assert order == ["fetch-meta.json", "primary_doc.xml"]
    checkpoint = json.loads(p["fetch_meta"].read_text())["documents"]["primary_doc.xml"]
    assert checkpoint["response_hash"] == inst13f._sha256(p["cover"].read_bytes())

    # Resume from that ACTUAL intermediate state (nothing ran after the rename):
    # the replaced document is durable, so NOTHING is refetched.
    transport, h2, s2 = _resume_into_fresh(tmp_path, work, _replacement_map())
    assert transport.attempts == 0
    assert (h2, s2) == (holds, status)


def test_boundary_missing_checkpoint_entry_self_heals_zero_transport(tmp_path):
    # Defensive (unreachable under the ordering): durable bytes with no checkpoint
    # entry self-heal from disk with zero transport, and the entry is restored.
    raw, holds, status = _canonical_raw(tmp_path)
    work = _copy(raw, tmp_path, "self-heal")
    p = _paths(work)
    meta = json.loads(p["fetch_meta"].read_text())
    meta["documents"].pop("primary_doc.xml", None)   # bytes stay, entry removed
    p["fetch_meta"].write_text(json.dumps(meta))
    transport, h2, s2 = _resume_into_fresh(tmp_path, work)
    assert transport.attempts == 0
    healed = json.loads(p["fetch_meta"].read_text())["documents"]
    assert "primary_doc.xml" in healed
    assert (h2, s2) == (holds, status)
