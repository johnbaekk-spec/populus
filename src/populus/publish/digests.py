"""Canonical digests (ARCHITECTURE.md §5.5 logical digest; §12.1 dist digest).

``dist_digest`` is the reproducible tree digest over regular files only, with
the exact §12.1 framing; ``logical_digest`` is the §5.5 canonical logical
export of ONE MODULE's database under that module's explicit, versioned
projection (``LOGICAL_PROJECTIONS[<module>]`` — ``congress`` over congress.db,
``inst`` over inst_agg.db). It is projection-parametric, not congress-only.
Both are byte-exact contracts: changing either envelope bumps its version.
"""

from __future__ import annotations

import hashlib
import os
import sqlite3
from pathlib import Path

import rfc8785

from populus.canonical import canonical_json

DIST_DIGEST_VERSION = "1"

# Per-module projections (§5.5), each stated as an allowlist, not an exclusion
# heuristic. Operational tables are excluded ENTIRELY (`ingest_runs` for
# congress, `agg_build_meta` for inst); the allowlisted tables are included with
# every column except their per-table exclusions. Columns are read BY NAME from
# PRAGMA table_info, never by position. A module's projection version bumps only
# when its byte envelope changes.
LOGICAL_PROJECTIONS: dict[str, dict[str, frozenset[str]]] = {
    "congress": {
        "filings": frozenset({"ingested_at"}),
        "member_aliases": frozenset(),
        "members": frozenset(),
        "transactions": frozenset(),
    },
    # The four cross-filer aggregate tables (populus.inst_agg), each minus its
    # volatile `ingested_at`; `agg_build_meta` is excluded entirely.
    "inst": {
        "agg_filer_registry": frozenset({"ingested_at"}),
        "agg_qoq_deltas": frozenset({"ingested_at"}),
        "agg_issuer_top_holders": frozenset({"ingested_at"}),
        "agg_filer_concentration": frozenset({"ingested_at"}),
    },
}
LOGICAL_PROJECTION_VERSIONS = {"congress": "1", "inst": "1"}
# Back-compat aliases: the unqualified names are the congress projection v1, so
# every existing caller that passes nothing keeps the exact same envelope.
LOGICAL_PROJECTION_V1: dict[str, frozenset[str]] = LOGICAL_PROJECTIONS["congress"]
LOGICAL_PROJECTION_VERSION = LOGICAL_PROJECTION_VERSIONS["congress"]


class DigestError(ValueError):
    """A tree or database violates the digest contract (hard error)."""


def sha256_file(path: Path | str) -> str:
    """Streaming SHA-256 hex digest of one file's bytes."""
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _walk_regular(tree: Path) -> list[tuple[str, Path]]:
    """``(relative posix path, absolute path)`` for every regular file.

    Symlinks (file or directory), devices, FIFOs, and any other non-regular
    entry fail hard (§12.1: a static tree has none). Paths are sorted
    ascending bytewise by their UTF-8 relative path.
    """
    tree = Path(tree)
    if not tree.is_dir():
        raise DigestError(f"not a directory: {tree}")
    entries: list[tuple[str, Path]] = []
    for root, dirs, files in os.walk(tree, followlinks=False):
        root_path = Path(root)
        for name in dirs:
            candidate = root_path / name
            if candidate.is_symlink():
                raise DigestError(f"symlinked directory in tree: {candidate}")
        for name in files:
            candidate = root_path / name
            if candidate.is_symlink():
                raise DigestError(f"symlink in tree: {candidate}")
            if not candidate.is_file():
                raise DigestError(f"non-regular file in tree: {candidate}")
            entries.append((candidate.relative_to(tree).as_posix(), candidate))
    entries.sort(key=lambda item: item[0].encode("utf-8"))
    return entries


def dist_digest(tree: Path | str) -> str:
    """§12.1 canonical tree digest, ``dist_digest_version`` = ``"1"``.

    Frame per file: ``path`` 0x00 ``decimal(byte length)`` 0x00
    ``sha256hex(contents)`` 0x0a; digest = SHA-256 of the concatenation.
    File mode is deliberately not included.
    """
    digest = hashlib.sha256()
    for relpath, path in _walk_regular(Path(tree)):
        size = path.stat().st_size
        digest.update(relpath.encode("utf-8"))
        digest.update(b"\x00")
        digest.update(str(size).encode("ascii"))
        digest.update(b"\x00")
        digest.update(sha256_file(path).encode("ascii"))
        digest.update(b"\x0a")
    return digest.hexdigest()


def _table_columns(
    conn: sqlite3.Connection,
    table: str,
    projection: dict[str, frozenset[str]],
) -> tuple[list[str], list[str]]:
    """``(included column names, primary-key column names)`` for *table*.

    Read by name from ``PRAGMA table_info`` — never by index — with the
    *projection*'s per-table exclusions applied. PK columns are ordered by
    their position within the primary key.
    """
    info = conn.execute(f'PRAGMA table_info("{table}")').fetchall()
    if not info:
        raise DigestError(f"projection table missing from database: {table}")
    by_name = [
        {"name": row[1], "pk": row[5]}
        for row in info
    ]
    excluded = projection[table]
    included = [col["name"] for col in by_name if col["name"] not in excluded]
    pk = [col["name"] for col in sorted(by_name, key=lambda c: c["pk"]) if col["pk"] > 0]
    if not pk:
        raise DigestError(f"projection table has no primary key: {table}")
    return included, pk


def logical_digest(
    conn: sqlite3.Connection,
    projection: dict[str, frozenset[str]] = LOGICAL_PROJECTION_V1,
) -> str:
    """§5.5 logical digest of one database under *projection* (default congress).

    Byte envelope: tables in ascending lexicographic table-name order, each
    framed ``T:<table>\\n``, then one line per row in ascending primary-key
    order — the row as an RFC 8785 canonical JSON object (column names as
    keys; SQL NULL → JSON ``null``; INTEGER/REAL as JSON numbers; TEXT as an
    opaque JSON string, never parsed) followed by ``\\n``. BLOB values are a
    projection defect and fail hard. The envelope is projection-parametric so
    each module (congress, inst) hashes exactly its own allowlisted tables.
    """
    digest = hashlib.sha256()
    for table in sorted(projection):
        included, pk = _table_columns(conn, table, projection)
        digest.update(f"T:{table}\n".encode("utf-8"))
        select = ", ".join(f'"{name}"' for name in included)
        order = ", ".join(f'"{name}"' for name in pk)
        # nosec B608 — identifiers come from PRAGMA table_info over the
        # projection-constant table set; values are never interpolated.
        cursor = conn.execute(
            f'SELECT {select} FROM "{table}" ORDER BY {order}'  # nosec B608
        )
        for row in cursor:
            obj: dict[str, object] = {}
            for name, value in zip(included, row):
                if isinstance(value, bytes):
                    raise DigestError(
                        f"BLOB value in projected column {table}.{name}"
                    )
                obj[name] = value
            try:
                digest.update(canonical_json(obj))
            except (rfc8785.CanonicalizationError, rfc8785.IntegerDomainError) as exc:
                raise DigestError(
                    f"row in {table} cannot canonicalize: {exc}"
                ) from exc
            digest.update(b"\n")
    return digest.hexdigest()
