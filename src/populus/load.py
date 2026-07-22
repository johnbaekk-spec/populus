"""Atomic per-filing load and the filing-insert seam (ARCHITECTURE.md §9.4).

``load_filing`` replaces a filing's parsed set in exactly one transaction —
``DELETE`` → insert the full set → update the ``filings`` row — so re-ingest
and reparse are idempotent and a corrected parse can never leave ghost rows.
``bioguide_id``/``chamber``/``filed_date``/``source``/``license_id`` are
stamped onto every transaction row from the filing (the §9.4 denormalized
invariant and §5.1's record-level license requirement).
"""

from __future__ import annotations

import json
import sqlite3
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from typing import Any

from populus.canonical import assign_identity, canonical_json


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
