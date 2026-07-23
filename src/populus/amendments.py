"""§9.5 amendment semantics: views, durable flags, pair invariants (RUN 4).

The conservative default only (OQ-13 open): pair detection stays where it
is (the Senate ingest's ``_link_amendments``); this module owns the pair's
default-view semantics (``v_default_transactions`` excludes the original of
an unresolved pair), the uncertainty view (``v_amendment_pairs``), the
durable ``amendment_unresolved`` flag on BOTH sides of every pair, and the
pair invariants. No supersede automation — no ``lifecycle`` writes.

Flag durability: ``load_filing`` deletes and re-inserts a filing's rows, so
:func:`flag_unresolved_pair_rows` runs at the tail of every job that
rebuilds rows or re-derives pairs — Senate ingest, ``reparse_senate``, and
``reparse_house`` — leaving both sides flagged after any reparse.
"""

from __future__ import annotations

import importlib.resources
import sqlite3


def ensure_views(conn: sqlite3.Connection) -> None:
    """Apply the packaged view DDL (CREATE VIEW IF NOT EXISTS — idempotent).

    Called by ``db.init_db`` for fresh databases and by every RUN-4 CLI
    path, so pre-existing databases gain the views on first use.
    """
    ddl = (
        importlib.resources.files("populus")
        .joinpath("views.sql")
        .read_text(encoding="utf-8")
    )
    conn.executescript(ddl)


def flag_unresolved_pair_rows(conn: sqlite3.Connection) -> int:
    """Add ``amendment_unresolved`` to every pair-side row missing it.

    Covers both sides of every ``supersedes`` link (the amendment's rows
    normally already carry the flag from normalization; the original's rows
    only get it here). One idempotent bulk statement; returns rows updated.
    """
    cursor = conn.execute(
        """
        UPDATE transactions
        SET flags = json_insert(flags, '$[#]', 'amendment_unresolved')
        WHERE filing_id IN (
            SELECT o.filing_id FROM filings a
            JOIN filings o ON o.filing_id = a.supersedes
            UNION
            SELECT a.filing_id FROM filings a WHERE a.supersedes IS NOT NULL
        )
        AND NOT EXISTS (
            SELECT 1 FROM json_each(transactions.flags)
            WHERE json_each.value = 'amendment_unresolved'
        )
        """
    )
    return cursor.rowcount


def pair_invariant_errors(conn: sqlite3.Connection) -> list[str]:
    """Structural invariants over every ``supersedes`` pair.

    The target must exist (FK-enforced, still verified), share the
    amendment's chamber, precede-or-equal it in ``filed_date``, and never be
    the amendment itself.
    """
    errors: list[str] = []
    for amendment_id, supersedes, a_chamber, a_filed, o_chamber, o_filed in conn.execute(
        """
        SELECT a.filing_id, a.supersedes, a.chamber, a.filed_date,
               o.chamber, o.filed_date
        FROM filings a
        LEFT JOIN filings o ON o.filing_id = a.supersedes
        WHERE a.supersedes IS NOT NULL
        ORDER BY a.filing_id
        """
    ):
        if amendment_id == supersedes:
            errors.append(f"{amendment_id}: supersedes itself")
            continue
        if o_chamber is None:
            errors.append(f"{amendment_id}: supersedes missing filing {supersedes}")
            continue
        if o_chamber != a_chamber:
            errors.append(
                f"{amendment_id}: chamber {a_chamber} != original's {o_chamber}"
            )
        if o_filed is not None and a_filed < o_filed:
            errors.append(
                f"{amendment_id}: filed {a_filed} before its original ({o_filed})"
            )
    return errors
