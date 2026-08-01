"""Checkpoint-before-bytes resume primitives, shared by every ingest module.

Lifted verbatim out of ``populus.ingest.inst13f`` (RUN M2-6, R13) so the House
PTR fetch (RUN M1-B, R1/R2) resumes on ONE implementation rather than a second
copy of the same ordering rule. The invariant these three functions encode:

    a document's expected sha256 is committed to a durable sidecar BEFORE its
    bytes are written

so a crash between the two leaves an absent-bytes state that resumes with
exactly one fetch, and bytes that survive a crash always have a checkpoint to
verify them against. Reading the sidecar back and re-hashing the archived bytes
is therefore a complete durability test: hash matches ⇒ the document is durable
and needs no transport.

The sidecars ARE the §5.1 provenance sidecars — ``source_url``,
``response_hash``, ``retrieved_at`` per document. ``doc_key`` selects the slot:
``None`` for a single-document sidecar (the House per-PDF sidecar, inst's
``submissions-meta.json``), or the document filename for a shared per-accession
sidecar carrying several documents.

Pure stdlib plus the durable writer; no clock, no network, no database.
"""

from __future__ import annotations

import hashlib
import json
from pathlib import Path

from populus.publish import atomic_write_bytes


def sha256_hex(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def read_provenance(meta_path: Path, doc_key: str | None) -> dict | None:
    """The committed §5.1 provenance entry for a document, or ``None``.

    ``None`` covers every way a sidecar can fail to answer: absent, unreadable,
    not JSON, not an object, or carrying no entry for *doc_key*. This is the
    single parser behind both :func:`read_checkpoint` and the House durability
    predicate, so "what the sidecar says" has exactly one implementation.
    """
    if not meta_path.exists():
        return None
    try:
        meta = json.loads(meta_path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return None
    if not isinstance(meta, dict):
        return None
    if doc_key is None:
        return meta
    entry = (meta.get("documents") or {}).get(doc_key)
    return entry if isinstance(entry, dict) else None


def read_checkpoint(
    meta_path: Path, doc_key: str | None
) -> tuple[str | None, str | None]:
    """The committed ``(response_hash, retrieved_at)`` for a document, or
    ``(None, None)`` when no checkpoint exists yet."""
    entry = read_provenance(meta_path, doc_key)
    if entry is None:
        return None, None
    return entry.get("response_hash"), entry.get("retrieved_at")


def commit_checkpoint(
    meta_path: Path,
    doc_key: str | None,
    *,
    url: str,
    response_hash: str,
    retrieved_at: str | None,
) -> None:
    """Durably record a document's expected hash BEFORE its bytes are written.

    Read-modify-write of the shared sidecar so sibling documents' checkpoints
    survive; the top-level ``retrieved_at`` stays the max over recorded docs so
    an offline cache reader sees the same provenance it always has.
    """
    if doc_key is None:
        payload = {
            "retrieved_at": retrieved_at,
            "source_url": url,
            "response_hash": response_hash,
        }
        atomic_write_bytes(
            meta_path, (json.dumps(payload, indent=2) + "\n").encode("utf-8")
        )
        return
    meta: dict = {}
    if meta_path.exists():
        try:
            meta = json.loads(meta_path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            meta = {}
    documents = dict(meta.get("documents") or {})
    documents[doc_key] = {
        "source_url": url,
        "response_hash": response_hash,
        "retrieved_at": retrieved_at,
    }
    retrieved_values = [
        entry.get("retrieved_at")
        for entry in documents.values()
        if isinstance(entry, dict) and entry.get("retrieved_at")
    ]
    meta["documents"] = documents
    meta["retrieved_at"] = max(retrieved_values) if retrieved_values else None
    atomic_write_bytes(
        meta_path, (json.dumps(meta, indent=2) + "\n").encode("utf-8")
    )


def archive_verified(archive: Path, expected_hash: str | None) -> bool:
    """Whether *archive* exists and re-hashes to *expected_hash* (RUN M1-B, R3).

    The honest durability test for an archived document whose expected hash is
    recorded elsewhere (the House PTR case: ``filings.response_hash``). A full
    re-hash, never a size or mtime comparison — same-length corruption is
    exactly the failure a cheaper check would miss.
    """
    if expected_hash is None:
        return False
    try:
        if not archive.is_file():
            return False
        return sha256_hex(archive.read_bytes()) == expected_hash
    except OSError:
        return False
