"""The shared checkpoint-before-bytes primitives (RUN M1-B, R1/R2).

One implementation, two callers: the inst 13F fetch (RUN M2-6, R13) and the
House PTR fetch. These tests pin the ordering rule the resume behaviour of both
depends on — the checkpoint is durable BEFORE the bytes — and the two
consequences that fall out of it: a crash between the writes resumes with
exactly one fetch, and a non-200 is never recorded as durable.
"""

from __future__ import annotations

import json

from populus.ingest.checkpoint import (
    archive_verified,
    commit_checkpoint,
    read_checkpoint,
    sha256_hex,
)


def test_commit_then_read_round_trips_single_slot(tmp_path):
    meta = tmp_path / "doc.pdf.fetch-meta.json"
    commit_checkpoint(
        meta,
        None,
        url="https://example.invalid/doc.pdf",
        response_hash=sha256_hex(b"bytes"),
        retrieved_at="2026-07-31T00:00:00Z",
    )
    assert read_checkpoint(meta, None) == (
        sha256_hex(b"bytes"),
        "2026-07-31T00:00:00Z",
    )
    payload = json.loads(meta.read_text(encoding="utf-8"))
    # §5.1 provenance: the source URL travels with the hash and the timestamp.
    assert payload["source_url"] == "https://example.invalid/doc.pdf"


def test_commit_then_read_round_trips_named_slots_without_clobbering_siblings(tmp_path):
    meta = tmp_path / "fetch-meta.json"
    commit_checkpoint(
        meta, "a.xml", url="u/a", response_hash="aa", retrieved_at="2026-01-01T00:00:00Z"
    )
    commit_checkpoint(
        meta, "b.xml", url="u/b", response_hash="bb", retrieved_at="2026-02-02T00:00:00Z"
    )
    assert read_checkpoint(meta, "a.xml") == ("aa", "2026-01-01T00:00:00Z")
    assert read_checkpoint(meta, "b.xml") == ("bb", "2026-02-02T00:00:00Z")
    # The top-level timestamp is the max over recorded documents.
    assert json.loads(meta.read_text())["retrieved_at"] == "2026-02-02T00:00:00Z"


def test_absent_or_unreadable_sidecar_reads_as_no_checkpoint(tmp_path):
    missing = tmp_path / "nope.json"
    assert read_checkpoint(missing, None) == (None, None)
    broken = tmp_path / "broken.json"
    broken.write_text("{not json", encoding="utf-8")
    assert read_checkpoint(broken, None) == (None, None)
    assert read_checkpoint(broken, "a.xml") == (None, None)


def test_archive_verified_is_a_full_rehash_not_a_size_check(tmp_path):
    doc = tmp_path / "doc.pdf"
    doc.write_bytes(b"original")
    digest = sha256_hex(b"original")
    assert archive_verified(doc, digest) is True

    # Same-length corruption — the exact case a size or mtime check misses.
    doc.write_bytes(b"corrupte")
    assert len(doc.read_bytes()) == len(b"original")
    assert archive_verified(doc, digest) is False

    doc.unlink()
    assert archive_verified(doc, digest) is False
    # No stored hash is not evidence of durability either.
    doc.write_bytes(b"original")
    assert archive_verified(doc, None) is False


def test_a_directory_in_the_archive_slot_is_not_verified(tmp_path):
    slot = tmp_path / "doc.pdf"
    slot.mkdir()
    assert archive_verified(slot, sha256_hex(b"anything")) is False


def test_checkpoint_precedes_bytes_so_a_crash_between_them_refetches_once(tmp_path):
    """The ordering rule, exercised as the fetch path uses it.

    Simulating the crash: the checkpoint lands, the bytes never do. Resuming
    over that state finds no archived file, so exactly one fetch happens — never
    a duplicate request for bytes that are already durable.
    """
    meta = tmp_path / "doc.pdf.fetch-meta.json"
    target = tmp_path / "doc.pdf"
    content = b"%PDF-1.4 real bytes"

    commit_checkpoint(
        meta, None, url="u", response_hash=sha256_hex(content), retrieved_at="t"
    )
    # <-- crash here: sidecar written, bytes absent.
    assert meta.exists() and not target.exists()

    expected, _ = read_checkpoint(meta, None)
    assert expected == sha256_hex(content)
    assert archive_verified(target, expected) is False  # ⇒ one fetch

    target.write_bytes(content)
    # After the retry completes, the same predicate now says durable ⇒ zero
    # further transport, on this database or any other.
    assert archive_verified(target, expected) is True


def test_bytes_that_disagree_with_their_checkpoint_are_not_durable(tmp_path):
    """Corrupt-at-rest, or an in-flight replacement that never completed: the
    committed hash and the bytes on disk disagree, so the document is refetched
    rather than trusted. (The non-200 half of the guard — never committing a
    failure response at all — is proven end-to-end against the real fetch path
    in ``test_house_ingest``.)"""
    meta = tmp_path / "doc.pdf.fetch-meta.json"
    target = tmp_path / "doc.pdf"
    commit_checkpoint(
        meta, None, url="u", response_hash=sha256_hex(b"expected"), retrieved_at="t"
    )
    target.write_bytes(b"replaced")

    expected, _ = read_checkpoint(meta, None)
    assert archive_verified(target, expected) is False
