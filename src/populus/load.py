"""Atomic per-filing load and the filing-insert seam (ARCHITECTURE.md §9.4).

``load_filing`` replaces a filing's parsed set in exactly one transaction —
``DELETE`` → insert the full set → update the ``filings`` row — so re-ingest
and reparse are idempotent and a corrected parse can never leave ghost rows.
``bioguide_id``/``chamber``/``filed_date``/``source``/``license_id`` are
stamped onto every transaction row from the filing (the §9.4 denormalized
invariant and §5.1's record-level license requirement).
"""

from __future__ import annotations

import importlib.resources
import json
import sqlite3
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from typing import Any

from populus.canonical import assign_identity, canonical_json


def ensure_inst_schema(conn: sqlite3.Connection) -> None:
    """Apply the packaged inst DDL (all ``IF NOT EXISTS`` — idempotent).

    The M2 counterpart of ``identity.registry.ensure_registry``: called by
    ``db.init_db`` for fresh databases (before ``ensure_views``, which defines
    the two inst views over these tables) and by every M2 CLI path, so a
    pre-existing M1/M2-1 database gains the inst tables on first M2 use without
    touching any M1 table.
    """
    ddl = (
        importlib.resources.files("populus")
        .joinpath("inst.sql")
        .read_text(encoding="utf-8")
    )
    conn.executescript(ddl)


@dataclass(frozen=True)
class ParsedRow:
    """One normalized transaction row plus its exact extracted ``raw_row``.

    ``raw_row`` is the identity input: values exactly as printed, NFC at
    extraction, missing field = JSON ``null`` (never ``""``). Everything else
    is normalized output destined for the corresponding column.
    """

    raw_row: Mapping[str, Any]
    row_ordinal: int
    asset_name: str
    side: str
    source_row_no: int | None = None
    owner: str | None = None
    ticker: str | None = None
    asset_type: str | None = None
    transaction_date: str | None = None
    days_to_file: int | None = None
    is_late: int | None = None
    amount_low: int | None = None
    amount_high: int | None = None
    amount_label: str | None = None
    cap_gains_over_200: int | None = None
    comment: str | None = None
    flags: list[str] = field(default_factory=list)
    kadoa_id: str | None = None


@dataclass(frozen=True)
class RowIdentity:
    row_fingerprint: str
    dup_seq: int
    txn_id: str


@dataclass(frozen=True)
class LoadResult:
    filing_id: str
    row_count: int
    txn_ids: tuple[str, ...]
    deleted: int


class UnknownFilingError(LookupError):
    """``load_filing`` was asked to load rows for a filing_id not in filings."""


def insert_filing(
    conn: sqlite3.Connection,
    *,
    filing_id: str,
    chamber: str,
    filer_name_raw: str,
    filing_kind: str,
    filed_date: str,
    doc_url: str,
    source: str,
    ingested_at: str,
    license_id: str = "us-congress-disclosures",
    bioguide_id: str | None = None,
    raw_path: str | None = None,
    response_hash: str | None = None,
    parse_status: str = "parsed",
    lifecycle: str = "active",
    supersedes: str | None = None,
    primary_filing_id: str | None = None,
    parser_version: str | None = None,
    normalization_version: str | None = None,
    row_count: int | None = None,
) -> None:
    """Insert one ``filings`` row. ``ingested_at`` is a parameter — library
    code never reads the wall clock."""
    conn.execute(
        """
        INSERT INTO filings (
          filing_id, chamber, bioguide_id, filer_name_raw, filing_kind,
          filed_date, doc_url, raw_path, response_hash, parse_status,
          lifecycle, supersedes, primary_filing_id, parser_version,
          normalization_version, row_count, source, license_id, ingested_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            filing_id,
            chamber,
            bioguide_id,
            filer_name_raw,
            filing_kind,
            filed_date,
            doc_url,
            raw_path,
            response_hash,
            parse_status,
            lifecycle,
            supersedes,
            primary_filing_id,
            parser_version,
            normalization_version,
            row_count,
            source,
            license_id,
            ingested_at,
        ),
    )


# --- institutional 13F load path (RUN M2-2) ----------------------------------


@dataclass(frozen=True)
class InstParsedRow:
    """One normalized 13F holding plus its exact extracted ``raw_row``.

    ``raw_row`` is the identity input (RFC 8785 fingerprint); ``source_row_no``
    is always ``None`` (13F prints no row number) so identical rows are numbered
    by ``row_ordinal``. Everything else maps to an ``inst_holdings`` column.
    """

    raw_row: Mapping[str, Any]
    row_ordinal: int
    issuer_name_raw: str
    title_of_class: str | None
    cusip_raw: str | None
    cusip: str | None
    value_raw: int | None
    unit_basis: str
    value_usd: int | None
    ssh_prnamt: int | None
    ssh_prnamt_type: str | None
    put_call: str | None
    investment_discretion: str | None
    other_manager: str | None
    other_manager_seqs: list[int]
    voting_sole: int | None
    voting_shared: int | None
    voting_none: int | None
    security_id: str | None
    flags: list[str] = field(default_factory=list)
    source_row_no: int | None = None


@dataclass(frozen=True)
class InstFilingRow:
    """One ``inst_filings`` row: every column, with the complete §5.1 provenance
    contract as physical values (R10). ``amends`` is set later by the amendment-
    lineage pass; ``lifecycle`` is never mutated for amendments (LD-4)."""

    filing_id: str
    cik: str
    accession: str
    submission_type: str
    period_of_report: str
    filed_date: str
    form_version: str | None
    unit_basis: str
    is_amendment: int
    amendment_type: str | None
    amendment_no: int | None
    amends: str | None
    is_confidential_omitted: int | None
    conf_denied_expired: int | None
    filing_manager_raw: str
    form13f_file_number: str | None
    file_number_norm: str | None
    report_type: str | None
    other_managers: list
    table_entry_total: int | None
    table_value_total: int | None
    table_value_total_usd: int | None
    row_count: int | None
    sum_value_usd: int | None
    value_total_delta: int | None
    resolved_rows: int | None
    resolved_value_usd: int | None
    parse_status: str
    failure_kind: str | None
    flags: list[str]
    doc_url: str
    table_url: str | None
    table_filename: str | None
    table_raw_path: str | None  # archived info-table relpath (holding raw_path)
    source_url: str
    retrieved_at: str | None
    raw_path: str | None
    index_response_hash: str | None
    response_hash: str | None
    table_response_hash: str | None
    parser_version: str
    normalization_version: str
    ingested_at: str
    lifecycle: str = "active"
    source: str = "sec-edgar"
    license_id: str = "sec-edgar"


_INST_FILING_COLUMNS = (
    "filing_id", "cik", "accession", "submission_type", "period_of_report",
    "filed_date", "form_version", "unit_basis", "is_amendment", "amendment_type",
    "amendment_no", "amends", "is_confidential_omitted", "conf_denied_expired",
    "filing_manager_raw", "form13f_file_number", "file_number_norm", "report_type",
    "other_managers", "table_entry_total", "table_value_total",
    "table_value_total_usd", "row_count", "sum_value_usd", "value_total_delta",
    "resolved_rows", "resolved_value_usd", "parse_status", "failure_kind",
    "lifecycle", "flags", "doc_url", "table_url", "table_filename", "source",
    "source_url", "source_record_id", "retrieved_at", "raw_path",
    "index_response_hash", "response_hash", "table_response_hash",
    "parser_version", "normalization_version", "license_id", "ingested_at",
)

_INST_HOLDING_COLUMNS = (
    "holding_id", "filing_id", "raw_row", "row_fingerprint", "dup_seq",
    "row_ordinal", "cik", "accession", "period_of_report", "filed_date",
    "security_id", "cusip_raw", "cusip", "issuer_name_raw", "title_of_class",
    "value_raw", "unit_basis", "value_usd", "ssh_prnamt", "ssh_prnamt_type",
    "put_call", "investment_discretion", "other_manager", "other_manager_seqs",
    "voting_sole", "voting_shared", "voting_none", "flags", "source",
    "source_url", "source_record_id", "retrieved_at", "response_hash",
    "raw_path", "parser_version", "normalization_version", "license_id",
    "ingested_at",
)


def _compact_json(value: object) -> str:
    """Deterministic sorted/compact JSON for a stored column (R15)."""
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def upsert_inst_filer(
    conn: sqlite3.Connection,
    *,
    cik: str,
    name_raw: str,
    form13f_file_number: str | None,
    file_number_norm: str | None,
    entity_id: str | None,
    raw: Mapping[str, Any] | None,
    flags: Sequence[str],
    source_url: str,
    retrieved_at: str | None,
    response_hash: str | None,
    raw_path: str | None,
    parser_version: str,
    normalization_version: str,
    ingested_at: str,
) -> None:
    """Insert-or-update one ``inst_filers`` row (provenance from the per-CIK
    ``submissions-meta.json``; a missing sidecar → ``retrieved_at`` NULL +
    ``submissions_meta_missing`` in *flags*, never the wall clock — R19)."""
    conn.execute(
        """
        INSERT INTO inst_filers (
          cik, name_raw, form13f_file_number, file_number_norm, entity_id, raw,
          flags, source, source_url, source_record_id, retrieved_at,
          response_hash, raw_path, parser_version, normalization_version,
          license_id, ingested_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'sec-edgar', ?, ?, ?, ?, ?, ?, ?,
                  'sec-edgar', ?)
        ON CONFLICT (cik) DO UPDATE SET
          name_raw = excluded.name_raw,
          form13f_file_number = excluded.form13f_file_number,
          file_number_norm = excluded.file_number_norm,
          entity_id = excluded.entity_id,
          raw = excluded.raw,
          flags = excluded.flags,
          source_url = excluded.source_url,
          retrieved_at = excluded.retrieved_at,
          response_hash = excluded.response_hash,
          raw_path = excluded.raw_path,
          parser_version = excluded.parser_version,
          normalization_version = excluded.normalization_version,
          ingested_at = excluded.ingested_at
        """,
        (
            cik,
            name_raw,
            form13f_file_number,
            file_number_norm,
            entity_id,
            _compact_json(raw) if raw is not None else None,
            _compact_json(sorted(flags)),
            source_url,
            cik,  # source_record_id
            retrieved_at,
            response_hash,
            raw_path,
            parser_version,
            normalization_version,
            ingested_at,
        ),
    )


def upsert_inst_filing(
    conn: sqlite3.Connection,
    *,
    filing: InstFilingRow,
    holdings: Sequence[InstParsedRow],
) -> LoadResult:
    """Insert-or-replace one filing and its holdings in ONE transaction (R10).

    Mirrors :func:`upsert_filing`: a new filing's row and its full holding set
    commit together (crash-consistent), re-running is idempotent (ON CONFLICT +
    DELETE-then-insert), and empty *holdings* is valid (a ``13F-NT`` notice, an
    info-table-failed filing, or a cover-failed filing writes zero holdings).
    Per-holding §5.1 provenance is derived from the filing's info-table fetch.
    """
    conn.execute("BEGIN IMMEDIATE")
    try:
        deleted = conn.execute(
            "DELETE FROM inst_holdings WHERE filing_id = ?", (filing.filing_id,)
        ).rowcount
        placeholders = ", ".join("?" for _ in _INST_FILING_COLUMNS)
        updates = ", ".join(
            f"{col} = excluded.{col}"
            for col in _INST_FILING_COLUMNS
            if col != "filing_id"
        )
        conn.execute(
            f"INSERT INTO inst_filings ({', '.join(_INST_FILING_COLUMNS)})"  # nosec B608
            f" VALUES ({placeholders})"
            f" ON CONFLICT (filing_id) DO UPDATE SET {updates}",
            (
                filing.filing_id,
                filing.cik,
                filing.accession,
                filing.submission_type,
                filing.period_of_report,
                filing.filed_date,
                filing.form_version,
                filing.unit_basis,
                filing.is_amendment,
                filing.amendment_type,
                filing.amendment_no,
                filing.amends,
                filing.is_confidential_omitted,
                filing.conf_denied_expired,
                filing.filing_manager_raw,
                filing.form13f_file_number,
                filing.file_number_norm,
                filing.report_type,
                _compact_json(filing.other_managers),
                filing.table_entry_total,
                filing.table_value_total,
                filing.table_value_total_usd,
                filing.row_count,
                filing.sum_value_usd,
                filing.value_total_delta,
                filing.resolved_rows,
                filing.resolved_value_usd,
                filing.parse_status,
                filing.failure_kind,
                filing.lifecycle,
                _compact_json(sorted(filing.flags)),
                filing.doc_url,
                filing.table_url,
                filing.table_filename,
                filing.source,
                filing.source_url,
                filing.accession,  # source_record_id
                filing.retrieved_at,
                filing.raw_path,
                filing.index_response_hash,
                filing.response_hash,
                filing.table_response_hash,
                filing.parser_version,
                filing.normalization_version,
                filing.license_id,
                filing.ingested_at,
            ),
        )
        identities = assign_identity(filing.filing_id, holdings)
        conn.executemany(
            f"INSERT INTO inst_holdings ({', '.join(_INST_HOLDING_COLUMNS)})"  # nosec B608
            f" VALUES ({', '.join('?' for _ in _INST_HOLDING_COLUMNS)})",
            [
                (
                    identity.txn_id,
                    filing.filing_id,
                    canonical_json(row.raw_row).decode("utf-8"),
                    identity.row_fingerprint,
                    identity.dup_seq,
                    row.row_ordinal,
                    filing.cik,
                    filing.accession,
                    filing.period_of_report,
                    filing.filed_date,
                    row.security_id,
                    row.cusip_raw,
                    row.cusip,
                    row.issuer_name_raw,
                    row.title_of_class,
                    row.value_raw,
                    row.unit_basis,
                    row.value_usd,
                    row.ssh_prnamt,
                    row.ssh_prnamt_type,
                    row.put_call,
                    row.investment_discretion,
                    row.other_manager,
                    _compact_json(row.other_manager_seqs),
                    row.voting_sole,
                    row.voting_shared,
                    row.voting_none,
                    _compact_json(sorted(row.flags)),
                    filing.source,
                    filing.table_url,
                    f"{filing.accession}:{row.row_ordinal}",
                    filing.retrieved_at,
                    filing.table_response_hash,
                    filing.table_raw_path,
                    filing.parser_version,
                    filing.normalization_version,
                    filing.license_id,
                    filing.ingested_at,
                )
                for row, identity in zip(holdings, identities, strict=True)
            ],
        )
        conn.execute("COMMIT")
    except BaseException:
        conn.execute("ROLLBACK")
        raise

    return LoadResult(
        filing_id=filing.filing_id,
        row_count=len(holdings),
        txn_ids=tuple(identity.txn_id for identity in identities),
        deleted=deleted,
    )


def load_filing(
    conn: sqlite3.Connection,
    filing_id: str,
    rows: Sequence[ParsedRow],
    *,
    parse_status: str,
    parser_version: str,
    normalization_version: str,
) -> LoadResult:
    """Atomically replace *filing_id*'s parsed set with *rows*.

    One transaction: DELETE prior rows → insert the full set → update the
    ``filings`` row. Any failure rolls back to the prior full state. Raises
    :class:`UnknownFilingError` (writing nothing) when the filing is absent.
    """
    known = conn.execute(
        "SELECT 1 FROM filings WHERE filing_id = ?", (filing_id,)
    ).fetchone()
    if known is None:
        raise UnknownFilingError(filing_id)

    conn.execute("BEGIN IMMEDIATE")
    try:
        bioguide_id, chamber, filed_date, source, license_id = conn.execute(
            "SELECT bioguide_id, chamber, filed_date, source, license_id"
            " FROM filings WHERE filing_id = ?",
            (filing_id,),
        ).fetchone()

        deleted = conn.execute(
            "DELETE FROM transactions WHERE filing_id = ?", (filing_id,)
        ).rowcount

        identities = _insert_transaction_rows(
            conn,
            filing_id,
            rows,
            bioguide_id=bioguide_id,
            chamber=chamber,
            filed_date=filed_date,
            source=source,
            license_id=license_id,
        )

        conn.execute(
            "UPDATE filings SET parse_status = ?, parser_version = ?,"
            " normalization_version = ?, row_count = ? WHERE filing_id = ?",
            (parse_status, parser_version, normalization_version, len(rows), filing_id),
        )
        conn.execute("COMMIT")
    except BaseException:
        conn.execute("ROLLBACK")
        raise

    return LoadResult(
        filing_id=filing_id,
        row_count=len(rows),
        txn_ids=tuple(identity.txn_id for identity in identities),
        deleted=deleted,
    )


def _insert_transaction_rows(
    conn: sqlite3.Connection,
    filing_id: str,
    rows: Sequence[ParsedRow],
    *,
    bioguide_id: str | None,
    chamber: str,
    filed_date: str,
    source: str,
    license_id: str,
) -> list[RowIdentity]:
    """Insert *rows* for *filing_id*, stamping the denormalized filing values.

    Runs inside the caller's open transaction; shared by :func:`load_filing`
    and :func:`upsert_filing` so the row-insert semantics cannot fork.
    """
    identities = assign_identity(filing_id, rows)
    conn.executemany(
        """
        INSERT INTO transactions (
          txn_id, filing_id, raw_row, row_fingerprint, dup_seq,
          row_ordinal, source_row_no, bioguide_id, chamber, owner,
          ticker, asset_name, asset_type, side, transaction_date,
          filed_date, days_to_file, is_late, amount_low, amount_high,
          amount_label, cap_gains_over_200, comment, flags, source,
          license_id, kadoa_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                  ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        [
            (
                identity.txn_id,
                filing_id,
                canonical_json(row.raw_row).decode("utf-8"),
                identity.row_fingerprint,
                identity.dup_seq,
                row.row_ordinal,
                row.source_row_no,
                bioguide_id,
                chamber,
                row.owner,
                row.ticker,
                row.asset_name,
                row.asset_type,
                row.side,
                row.transaction_date,
                filed_date,
                row.days_to_file,
                row.is_late,
                row.amount_low,
                row.amount_high,
                row.amount_label,
                row.cap_gains_over_200,
                row.comment,
                json.dumps(row.flags, ensure_ascii=False),
                source,
                license_id,
                row.kadoa_id,
            )
            for row, identity in zip(rows, identities, strict=True)
        ],
    )
    return identities


def upsert_filing(
    conn: sqlite3.Connection,
    *,
    filing_id: str,
    chamber: str,
    filer_name_raw: str,
    filing_kind: str,
    filed_date: str,
    doc_url: str,
    source: str,
    ingested_at: str,
    rows: Sequence[ParsedRow],
    parse_status: str,
    parser_version: str,
    normalization_version: str,
    license_id: str = "us-congress-disclosures",
    bioguide_id: str | None = None,
    raw_path: str | None = None,
    response_hash: str | None = None,
    lifecycle: str = "active",
) -> LoadResult:
    """Insert-or-replace a filing and its transaction set in ONE transaction.

    The crash-consistency seam (R16): a new filing's row and its parsed set
    commit together, so no interruption can strand a committed filing with
    zero transactions that later DocID diffing would skip. Re-running is
    idempotent (the ``ON CONFLICT`` update plus the DELETE-then-insert row
    replace). Empty *rows* is valid (``needs_ocr``/``failed`` filings).
    """
    conn.execute("BEGIN IMMEDIATE")
    try:
        deleted = conn.execute(
            "DELETE FROM transactions WHERE filing_id = ?", (filing_id,)
        ).rowcount
        conn.execute(
            """
            INSERT INTO filings (
              filing_id, chamber, bioguide_id, filer_name_raw, filing_kind,
              filed_date, doc_url, raw_path, response_hash, parse_status,
              lifecycle, parser_version, normalization_version, row_count,
              source, license_id, ingested_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT (filing_id) DO UPDATE SET
              chamber = excluded.chamber,
              bioguide_id = excluded.bioguide_id,
              filer_name_raw = excluded.filer_name_raw,
              filing_kind = excluded.filing_kind,
              filed_date = excluded.filed_date,
              doc_url = excluded.doc_url,
              raw_path = excluded.raw_path,
              response_hash = excluded.response_hash,
              parse_status = excluded.parse_status,
              lifecycle = excluded.lifecycle,
              parser_version = excluded.parser_version,
              normalization_version = excluded.normalization_version,
              row_count = excluded.row_count,
              source = excluded.source,
              license_id = excluded.license_id,
              ingested_at = excluded.ingested_at
            """,
            (
                filing_id,
                chamber,
                bioguide_id,
                filer_name_raw,
                filing_kind,
                filed_date,
                doc_url,
                raw_path,
                response_hash,
                parse_status,
                lifecycle,
                parser_version,
                normalization_version,
                len(rows),
                source,
                license_id,
                ingested_at,
            ),
        )
        identities = _insert_transaction_rows(
            conn,
            filing_id,
            rows,
            bioguide_id=bioguide_id,
            chamber=chamber,
            filed_date=filed_date,
            source=source,
            license_id=license_id,
        )
        conn.execute("COMMIT")
    except BaseException:
        conn.execute("ROLLBACK")
        raise

    return LoadResult(
        filing_id=filing_id,
        row_count=len(rows),
        txn_ids=tuple(identity.txn_id for identity in identities),
        deleted=deleted,
    )
