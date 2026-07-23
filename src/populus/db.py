"""SQLite connection and schema initialization (ARCHITECTURE.md §9.4).

The schema lives in the packaged ``schema.sql`` — a byte-faithful transcription
of the §9.4 DDL. SQLite enforces foreign keys only when ``PRAGMA foreign_keys``
is ON for the connection, so :func:`connect` owns that pragma; all Populus code
must obtain connections through it.
"""

from __future__ import annotations

import importlib.resources
import sqlite3

from populus.amendments import ensure_views


def connect(path: str) -> sqlite3.Connection:
    """Open *path* in autocommit mode with foreign-key enforcement ON.

    Autocommit (``isolation_level=None``) leaves transaction boundaries to the
    caller — the atomic per-filing loader brackets its own work with explicit
    ``BEGIN IMMEDIATE`` / ``COMMIT``.
    """
    conn = sqlite3.connect(path, isolation_level=None)
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def json1_supported(conn: sqlite3.Connection) -> bool:
    """Whether this SQLite build provides the JSON1 functions the DDL needs."""
    try:
        conn.execute("SELECT json_valid('{}')")
    except sqlite3.OperationalError:
        return False
    return True


def init_db(path: str) -> None:
    """Create the full §9.4 schema at *path*, plus the §9.5 views.

    Refuses a database that already contains the schema (``members`` present)
    and fails with an actionable error when the SQLite build lacks JSON1
    (required by the ``json_valid``/``json_type`` CHECK constraints; built in
    since SQLite 3.38). The view DDL lives in ``views.sql`` (applied
    idempotently by ``amendments.ensure_views``) so ``schema.sql`` stays
    byte-identical to the §9.4 block.
    """
    conn = connect(path)
    try:
        if not json1_supported(conn):
            raise sqlite3.OperationalError(
                "this SQLite build lacks the JSON1 functions required by the "
                "schema (json_valid/json_type CHECKs); SQLite >= 3.38 is required"
            )
        already = conn.execute(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'members'"
        ).fetchone()
        if already is not None:
            raise FileExistsError(
                f"refusing to initialize {path}: it already contains a Populus schema"
            )
        schema = (
            importlib.resources.files("populus")
            .joinpath("schema.sql")
            .read_text(encoding="utf-8")
        )
        conn.executescript(schema)
        ensure_views(conn)
    finally:
        conn.close()
