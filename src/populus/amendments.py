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

import hashlib
import importlib.resources
import sqlite3

#: Every view the institutional derivation reads (RUN M2-11, R3). The coverage
#: gate reads the default pair, presence probes read the reconciled population,
#: and the aggregate/serving builders read the per-filer reported pair — so a
#: snapshot whose stored SQL for ANY of these differs from the shipped
#: ``views.sql`` would derive published numbers from a predicate this release
#: never reviewed. ``verify_views`` refuses that snapshot instead.
INST_DERIVATION_VIEWS = (
    "v_inst_reconciled_filings",
    "v_default_inst_filings",
    "v_default_holdings",
    "v_filer_reported_filings",
    "v_filer_reported_holdings",
)


class ViewVerificationError(RuntimeError):
    """A database's stored view SQL differs from the shipped ``views.sql``.

    Carries the offending view's name in ``view_name`` so a caller can refuse
    with a message that names it (plan R3)."""

    def __init__(self, view_name: str, message: str) -> None:
        super().__init__(message)
        self.view_name = view_name


def verify_views(
    conn: sqlite3.Connection,
    *,
    views: tuple[str, ...] = INST_DERIVATION_VIEWS,
) -> None:
    """Read-only check that *conn*'s stored view SQL is the packaged DDL (R3).

    The comparison source is ``views.sql`` — THE definition (M2-7) — normalized
    exactly as :func:`ensure_views` normalizes it, so the two functions can
    never disagree about what "matching" means. Unlike ``ensure_views`` this
    NEVER writes: it is the gate a read-only snapshot handle runs before any
    institutional derivation, where repairing a stale view is not an option —
    the snapshot is immutable by design, so drift means the snapshot itself is
    wrong and must be re-cut.

    Raises :class:`ViewVerificationError` naming the first offending view,
    with the remediation (re-cut via ``scripts/inst_snapshot.py``) in the
    message. Verifies only the institutional derivation's views by default;
    a congress-only view is not this gate's business.
    """
    packaged = _packaged_views()
    for name in views:
        statement = packaged.get(name)
        if statement is None:  # a name absent from views.sql is a code defect
            raise ViewVerificationError(
                name,
                f"view {name} is not defined in the packaged views.sql —"
                " the verification list and the shipped DDL disagree",
            )
        stored = conn.execute(
            "SELECT sql FROM sqlite_master WHERE type = 'view' AND name = ?",
            (name,),
        ).fetchone()
        if stored is None:
            raise ViewVerificationError(
                name,
                f"snapshot is missing view {name} — the institutional"
                " derivation would fail or silently read the wrong population."
                " Re-cut the snapshot with scripts/inst_snapshot.py, which"
                " applies the shipped views.sql before finalizing.",
            )
        if not _same_definition(stored[0], statement):
            raise ViewVerificationError(
                name,
                f"snapshot view {name} does not match the shipped views.sql"
                " definition — refusing to derive from a predicate this"
                " release never reviewed. Re-cut the snapshot with"
                " scripts/inst_snapshot.py against the current release.",
            )


def packaged_view_digest() -> str:
    """SHA-256 over the normalized packaged view DDL, in file order.

    Written into ``inst_source_meta`` by ``scripts/inst_snapshot.py`` and read
    back by stage-build into ``inst_source.json`` (R24) — provenance for WHICH
    view definitions a snapshot was cut with, distinct from ``verify_views``,
    which enforces that they still match at derive time.
    """
    digest = hashlib.sha256()
    for name, statement in _packaged_views().items():
        digest.update(name.encode("utf-8"))
        digest.update(b"\x00")
        digest.update(_normalize_sql(statement).encode("utf-8"))
        digest.update(b"\x00")
    return digest.hexdigest()


def ensure_views(conn: sqlite3.Connection) -> None:
    """Apply the packaged view DDL, REPLACING any stale definition (idempotent).

    Called by ``db.init_db`` for fresh databases and by every RUN-4 CLI
    path, so pre-existing databases gain the views on first use.

    ``views.sql`` is THE definition (M2-7): a database created by an earlier
    release must end this call running THIS release's predicate. Under the
    previous ``CREATE VIEW IF NOT EXISTS`` an already-ingested corpus kept its
    original ``v_default_inst_filings`` forever, which would have kept serving
    filings the current predicate excludes.

    A view whose stored SQL already matches is left ALONE — not dropped and
    recreated — so this stays a no-op write-wise on an up-to-date database. That
    matters: both the ``inst-agg`` CLI and ``build_inst_agg`` preflight the
    aliased-destination refusal BEFORE calling this function, so a refused
    """
    for name, statement in _packaged_views().items():
        current = conn.execute(
            "SELECT sql FROM sqlite_master WHERE type = 'view' AND name = ?",
            (name,),
        ).fetchone()
        if current is not None:
            if _same_definition(current[0], statement):
                continue
            # `name` comes from the packaged DDL, never from caller input.
            conn.execute(f"DROP VIEW {name}")  # nosec B608
        conn.execute(statement)


def _packaged_views() -> dict[str, str]:
    """The packaged view DDL as ``{view_name: CREATE statement}``, in file order.

    ``views.sql`` holds one ``CREATE VIEW`` per statement and no other statement
    kind. A statement starts at the first line beginning ``CREATE VIEW`` — the
    leading comment block is dropped so the text compares against
    ``sqlite_master.sql``, which starts at the CREATE keyword, while comments
    INSIDE a statement are kept because SQLite stores them too. Matching on
    line start (not a substring search) is deliberate: the file's own commentary
    mentions the CREATE syntax.
    """
    ddl = (
        importlib.resources.files("populus")
        .joinpath("views.sql")
        .read_text(encoding="utf-8")
    )
    views: dict[str, str] = {}
    for chunk in ddl.split(";"):
        lines = chunk.splitlines()
        starts = [i for i, line in enumerate(lines) if line.startswith("CREATE VIEW ")]
        if not starts:
            continue
        statement = "\n".join(lines[starts[0]:]).strip()
        views[statement.split()[2]] = statement
    return views


def _same_definition(stored: str | None, packaged: str) -> bool:
    """Whether a stored view definition is the packaged one. Compared line-wise
    with trailing whitespace ignored — SQLite keeps the statement text verbatim,
    including the ``--`` comments inside it, so line structure must survive."""
    if stored is None:
        return False
    return _normalize_sql(stored) == _normalize_sql(packaged)


def _normalize_sql(sql: str) -> str:
    return "\n".join(line.rstrip() for line in sql.strip().splitlines())


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
