"""Row canonicalization and identity (ARCHITECTURE.md §9.4).

``raw_row`` is the exact extracted raw field object — values as the source
printed them, NFC-normalized at extraction, missing field = JSON ``null``
(never the empty string). Identity is derived solely from it:

- ``row_fingerprint`` — SHA-256 over the RFC 8785 (JCS) canonical serialization
  of ``raw_row``; length-delimited by construction, invariant to key order and
  to any normalization change.
- ``txn_id`` — ``<filing_id>:<first 32 hex of row_fingerprint>``, with
  ``#<dup_seq>`` appended only when ``dup_seq > 1``.
- ``dup_seq`` — 1..n among identical fingerprints within one filing, numbered
  in source-coordinate order (``source_row_no`` where the source prints one,
  else ``row_ordinal``).
"""

from __future__ import annotations

import hashlib
import unicodedata
from collections.abc import Mapping, Sequence
from typing import TYPE_CHECKING, Any

import rfc8785

if TYPE_CHECKING:
    from populus.load import ParsedRow, RowIdentity


def nfc(s: str) -> str:
    """NFC-normalize extracted text (applied once, at extraction)."""
    return unicodedata.normalize("NFC", s)


def canonical_json(raw_row: Mapping[str, Any]) -> bytes:
    """RFC 8785 (JCS) canonical UTF-8 serialization of *raw_row*.

    The seam accepts any ``Mapping`` (R6), but ``rfc8785`` only serializes
    plain ``dict``s — a ``MappingProxyType`` or other Mapping raises
    ``CanonicalizationError``. Materialize into a ``dict`` at the boundary; the
    JCS output is identical because canonicalization is key/value-defined, not
    type-defined. ``raw_row`` is a flat scalar object (§9.4), so a shallow copy
    suffices.
    """
    return rfc8785.dumps(dict(raw_row))


def row_fingerprint(raw_row: Mapping[str, Any]) -> str:
    """Full 64-hex SHA-256 of the JCS serialization of *raw_row*."""
    return hashlib.sha256(canonical_json(raw_row)).hexdigest()


def txn_id(filing_id: str, fingerprint: str, dup_seq: int) -> str:
    """``<filing_id>:<fingerprint32>`` with ``#<dup_seq>`` only when > 1."""
    base = f"{filing_id}:{fingerprint[:32]}"
    if dup_seq > 1:
        return f"{base}#{dup_seq}"
    return base


def assign_identity(filing_id: str, rows: Sequence[ParsedRow]) -> list[RowIdentity]:
    """Compute per-row identity for one filing's parsed set, in input order.

    Identical fingerprints are numbered 1..n by source coordinate:
    ``source_row_no`` where present, else ``row_ordinal`` (ties broken by
    ``row_ordinal``, then input position).
    """
    # Imported here, not at module top: load.py imports this module at runtime.
    from populus.load import RowIdentity

    fingerprints = [row_fingerprint(row.raw_row) for row in rows]
    groups: dict[str, list[int]] = {}
    for idx, fp in enumerate(fingerprints):
        groups.setdefault(fp, []).append(idx)

    dup_seq = [1] * len(rows)
    for indices in groups.values():
        ordered = sorted(
            indices,
            key=lambda i: (
                rows[i].source_row_no
                if rows[i].source_row_no is not None
                else rows[i].row_ordinal,
                rows[i].row_ordinal,
                i,
            ),
        )
        for seq, i in enumerate(ordered, start=1):
            dup_seq[i] = seq

    return [
        RowIdentity(
            row_fingerprint=fingerprints[i],
            dup_seq=dup_seq[i],
            txn_id=txn_id(filing_id, fingerprints[i], dup_seq[i]),
        )
        for i in range(len(rows))
    ]
