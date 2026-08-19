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
import sys
from collections.abc import Iterator
from contextlib import contextmanager

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

_INST_COVERAGE_TOTALS_NAME = "_populus_inst_coverage_totals"
_INST_COVERAGE_TOTALS_INDEX_NAME = "_populus_inst_coverage_totals_by_filing"
_INST_AGG_INPUT_NAME = "_populus_inst_agg_input"

_MATERIALIZED_INST_OBJECTS = (
    "_populus_inst_affiliation_sources",
    "_populus_inst_affiliation_edges",
    "_populus_inst_affiliation_edges_lookup",
    "v_inst_reconciled_filings",
    _INST_COVERAGE_TOTALS_NAME,
    _INST_COVERAGE_TOTALS_INDEX_NAME,
    "v_filer_reported_filings",
    "v_filer_reported_filings_by_filing",
    "v_filer_reported_holdings",
    "v_default_inst_filings",
    "v_default_inst_filings_by_filing",
    "v_default_holdings",
    _INST_AGG_INPUT_NAME,
)

# The restatement-survivor candidate set shared by the ingestion affiliation pass
# and connection-local publish materialization.  Keep main-qualified table names:
# caller TEMP state must never redirect the reviewed persistent population.
_INST_RESTATEMENT_SURVIVORS_SQL = """
SELECT f.filing_id, f.period_of_report, f.file_number_norm, f.other_managers
FROM main.inst_filings f
WHERE f.lifecycle = 'active'
  AND NOT EXISTS (
    SELECT 1 FROM main.inst_filings r
    WHERE r.lifecycle = 'active' AND r.amendment_type = 'RESTATEMENT'
      AND r.cik = f.cik AND r.period_of_report = f.period_of_report
      AND r.filing_id <> f.filing_id
      AND ( r.filed_date > f.filed_date
         OR (r.filed_date = f.filed_date
             AND COALESCE(r.amendment_no,0) > COALESCE(f.amendment_no,0))
         OR (r.filed_date = f.filed_date
             AND COALESCE(r.amendment_no,0) = COALESCE(f.amendment_no,0)
             AND r.accession > f.accession) )
  )
"""

_INST_AFFILIATION_EDGES_SQL = """
CREATE TEMP TABLE _populus_inst_affiliation_edges AS
SELECT
  c.period_of_report,
  json_extract(m.value, '$.file_number_norm') AS manager_file_number,
  c.filing_id AS source_filing_id
FROM temp._populus_inst_affiliation_sources c,
     json_each(c.other_managers) m
WHERE json_extract(m.value, '$.file_number_norm') IS NOT NULL
"""

_MATERIALIZED_INST_RECONCILED_FILINGS_SQL = """
CREATE TEMP TABLE v_inst_reconciled_filings AS
SELECT f.*
FROM main.inst_filings f
JOIN temp._populus_inst_affiliation_sources s ON s.filing_id = f.filing_id
WHERE NOT EXISTS (
  SELECT 1
  FROM temp._populus_inst_affiliation_edges AS a
       INDEXED BY _populus_inst_affiliation_edges_lookup
  WHERE a.period_of_report = f.period_of_report
    AND f.file_number_norm IS NOT NULL
    AND a.manager_file_number = f.file_number_norm
    AND a.source_filing_id <> f.filing_id
)
"""

_MATERIALIZED_FILER_REPORTED_FILINGS_SQL = """
CREATE TEMP TABLE v_filer_reported_filings AS
SELECT *
FROM main.v_filer_reported_filings
"""

_MATERIALIZED_DEFAULT_INST_FILINGS_SQL = """
CREATE TEMP TABLE v_default_inst_filings AS
SELECT p.*
FROM temp.v_filer_reported_filings p
WHERE NOT EXISTS (
  SELECT 1
  FROM temp._populus_inst_affiliation_edges AS a
       INDEXED BY _populus_inst_affiliation_edges_lookup
  WHERE a.period_of_report = p.period_of_report
    AND p.file_number_norm IS NOT NULL
    AND a.manager_file_number = p.file_number_norm
    AND a.source_filing_id <> p.filing_id
)
"""

_MATERIALIZED_INST_COVERAGE_TOTALS_SQL = f"""
CREATE TEMP TABLE {_INST_COVERAGE_TOTALS_NAME} AS
SELECT filing_id, COALESCE(SUM(value_usd), 0) AS resolved_usd
FROM main.inst_holdings
WHERE security_id IS NOT NULL
GROUP BY filing_id
"""

_MATERIALIZED_INST_AGG_INPUT_SQL = f"""
CREATE TEMP TABLE {_INST_AGG_INPUT_NAME} AS
SELECT
  h.cik,
  h.period_of_report,
  h.security_id,
  h.cusip,
  h.issuer_name_raw,
  h.title_of_class,
  h.value_usd,
  h.ssh_prnamt,
  h.ssh_prnamt_type,
  h.put_call,
  s.entity_id,
  s.entity_link_state,
  CASE
    WHEN h.security_id IS NULL AND h.cusip IS NULL THEN h.holding_id
    ELSE NULL
  END AS unkeyed_token,
  CASE WHEN d.filing_id IS NULL THEN 0 ELSE 1 END AS is_default
FROM main.inst_holdings AS h
JOIN temp.v_filer_reported_filings AS r
  ON r.filing_id = h.filing_id
LEFT JOIN main.securities AS s
  ON s.security_id = h.security_id
LEFT JOIN temp.v_default_inst_filings AS d
  ON d.filing_id = h.filing_id
"""


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


@contextmanager
def materialized_inst_derivation_views(
    conn: sqlite3.Connection,
) -> Iterator[None]:
    """Freeze institutional filing sets and coverage totals in local TEMP.

    A verified persistent view supplies the canonical cover-passing candidates
    once.  Its frozen, indexed reported set serves the per-filer consumers and
    the affiliation anti-join that produces the frozen default set.
    The restatement-survivor affiliation sources and their normalized manager
    edges are staged once, the anti-join is index-served, and the canonical
    pre-cover reconciled population is frozen before private affiliation staging
    disappears.  Eligible holding values are aggregated once by filing for the
    coverage/disposition consumers.  One narrow aggregate input table freezes
    every filer-reported holding plus exact default membership and issuer inputs.
    Both packaged holdings views are shadowed in TEMP so their unqualified filing
    references resolve to the corresponding frozen tables.  Persistent objects
    are never changed.  Caller-owned TEMP state is refused rather than replaced,
    and only objects successfully created here are removed on every exit path.
    """
    placeholders = ", ".join("?" for _ in _MATERIALIZED_INST_OBJECTS)
    collisions = conn.execute(
        f"SELECT type, name FROM sqlite_temp_schema WHERE name IN ({placeholders})"
        " ORDER BY name",  # nosec B608 — fixed placeholder count, values bound
        _MATERIALIZED_INST_OBJECTS,
    ).fetchall()
    if collisions:
        names = ", ".join(name for _type, name in collisions)
        raise RuntimeError(
            "refusing institutional TEMP materialization because caller-owned"
            f" object(s) already exist: {names}"
        )

    # A public caller must not be able to freeze data from a stale packaged view.
    # This read-only gate runs before the first query against a main data table.
    verify_views(conn)

    created_objects: list[tuple[str, str]] = []
    try:
        conn.execute(
            "CREATE TEMP TABLE _populus_inst_affiliation_sources AS "
            + _INST_RESTATEMENT_SURVIVORS_SQL
        )
        created_objects.append(("TABLE", "_populus_inst_affiliation_sources"))
        conn.execute(_INST_AFFILIATION_EDGES_SQL)
        created_objects.append(("TABLE", "_populus_inst_affiliation_edges"))
        conn.execute(
            "CREATE INDEX temp._populus_inst_affiliation_edges_lookup"
            " ON _populus_inst_affiliation_edges"
            " (period_of_report, manager_file_number, source_filing_id)"
        )
        created_objects.append(("INDEX", "_populus_inst_affiliation_edges_lookup"))
        conn.execute(_MATERIALIZED_INST_RECONCILED_FILINGS_SQL)
        created_objects.append(("TABLE", "v_inst_reconciled_filings"))
        conn.execute(_MATERIALIZED_FILER_REPORTED_FILINGS_SQL)
        created_objects.append(("TABLE", "v_filer_reported_filings"))
        conn.execute(
            "CREATE INDEX temp.v_filer_reported_filings_by_filing"
            " ON v_filer_reported_filings(filing_id)"
        )
        created_objects.append(("INDEX", "v_filer_reported_filings_by_filing"))
        conn.execute(_MATERIALIZED_DEFAULT_INST_FILINGS_SQL)
        created_objects.append(("TABLE", "v_default_inst_filings"))
        conn.execute(
            "CREATE INDEX temp.v_default_inst_filings_by_filing"
            " ON v_default_inst_filings(filing_id)"
        )
        created_objects.append(("INDEX", "v_default_inst_filings_by_filing"))
        conn.execute(_MATERIALIZED_INST_COVERAGE_TOTALS_SQL)
        created_objects.append(("TABLE", _INST_COVERAGE_TOTALS_NAME))
        conn.execute(
            f"CREATE UNIQUE INDEX temp.{_INST_COVERAGE_TOTALS_INDEX_NAME}"
            f" ON {_INST_COVERAGE_TOTALS_NAME}(filing_id)"  # nosec B608
        )
        created_objects.append(("INDEX", _INST_COVERAGE_TOTALS_INDEX_NAME))
        conn.execute(_MATERIALIZED_INST_AGG_INPUT_SQL)
        created_objects.append(("TABLE", _INST_AGG_INPUT_NAME))

        # All consumer tables are frozen.  Drop implementation-only state before the
        # consumer scope so no downstream query can accidentally depend on it.
        conn.execute("DROP INDEX temp._populus_inst_affiliation_edges_lookup")
        created_objects.remove(("INDEX", "_populus_inst_affiliation_edges_lookup"))
        conn.execute("DROP TABLE temp._populus_inst_affiliation_edges")
        created_objects.remove(("TABLE", "_populus_inst_affiliation_edges"))
        conn.execute("DROP TABLE temp._populus_inst_affiliation_sources")
        created_objects.remove(("TABLE", "_populus_inst_affiliation_sources"))

        for view_name in ("v_filer_reported_holdings", "v_default_holdings"):
            holdings_ddl = _packaged_views()[view_name]
            temp_holdings_ddl = holdings_ddl.replace(
                "CREATE VIEW ", "CREATE TEMP VIEW ", 1
            )
            conn.execute(temp_holdings_ddl)
            created_objects.append(("VIEW", view_name))
        yield
    finally:
        primary_error_active = sys.exc_info()[0] is not None
        failed_drops: list[tuple[str, str]] = []
        for object_type, name in reversed(created_objects):
            # Both fields come only from the fixed tuples above, never callers.
            try:
                conn.execute(
                    f"DROP {object_type} IF EXISTS temp.{name}"  # nosec B608
                )
            except sqlite3.Error:
                # Finish the dependent-first sweep, then retry a transient
                # cleanup failure once so one bad DROP cannot strand its peers.
                failed_drops.append((object_type, name))
        cleanup_error: sqlite3.Error | None = None
        for object_type, name in failed_drops:
            try:
                conn.execute(
                    f"DROP {object_type} IF EXISTS temp.{name}"  # nosec B608
                )
            except sqlite3.Error as exc:
                if cleanup_error is None:
                    cleanup_error = exc
        if cleanup_error is not None and not primary_error_active:
            raise cleanup_error


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
