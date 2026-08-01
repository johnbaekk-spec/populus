"""``stats.json`` — the M1 honesty layer (ARCHITECTURE.md §5.2; RUN 4).

Two strictly separated families of numbers:

- ``default`` — every quantitative AGGREGATE reads ``v_default_transactions``
  (§9.5: active filings minus the original side of every unresolved
  amendment pair — a pair never contributes twice to any number). Includes
  the P1 join-coverage gate (joined rate over primary-source rows in the
  default view).
- ``totals`` — archive INVENTORY metrics that intentionally describe the
  whole store: their keys are suffixed ``_including_excluded`` wherever the
  number can differ from a default-view count.

Rates are 0–1 floats suffixed ``_rate`` beside their integer counts; an
unknown value is an explicit ``null``, never omitted or zeroed. Output is
deterministic for a given database and injected ``now`` (sorted keys,
sorted lists).
"""

from __future__ import annotations

import json
import re
import sqlite3
from collections.abc import Callable, Mapping
from email.utils import parsedate_to_datetime
from pathlib import Path

from populus.parse_gate import compute_parse_gate

STATS_VERSION = "stats-1.0.0"

DATA_NOTE = (
    "STOCK Act disclosure lag: PTRs are due within 45 days of a transaction —"
    " 'filed today' does not mean 'bought today'; every record carries both"
    " transaction_date and filed_date. Amounts are statutory ranges"
    " (amount_low/amount_high bound a bucket, never an exact value). PTRs are"
    " transaction flows, not holdings — anything portfolio-shaped is a labeled"
    " flow estimate until annual FD reports are ingested. Use of these records"
    " is subject to the 5 U.S.C. §13107(c) prohibited-use conditions"
    " recorded in the conditions register (license_id us-congress-disclosures)."
)

_META_YEAR = re.compile(r"^(\d{4})FD\.zip\.meta\.json$")


def read_house_meta(raw_root: Path | str) -> dict[str, str | None]:
    """``year → Last-Modified`` from the per-year House index meta sidecars.

    Reads the ``<YEAR>FD.zip.meta.json`` validators the House ingest
    persists beside its archived index; absent or unreadable sidecars simply
    contribute nothing (freshness then reports ``null``).
    """
    meta: dict[str, str | None] = {}
    root = Path(raw_root)
    if not root.is_dir():
        return meta
    for path in sorted(root.iterdir()):
        match = _META_YEAR.match(path.name)
        if match is None:
            continue
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            continue
        meta[match.group(1)] = payload.get("last_modified")
    return meta


def _latest_http_date(values) -> str | None:
    best = None
    best_parsed = None
    for value in values:
        if not value:
            continue
        try:
            parsed = parsedate_to_datetime(value)
        except (TypeError, ValueError):
            continue
        if best_parsed is None or parsed > best_parsed:
            best, best_parsed = value, parsed
    return best


def _rate(numerator: int, denominator: int) -> float | None:
    if denominator == 0:
        return None
    return numerator / denominator


def _median(values: list) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    mid = len(ordered) // 2
    if len(ordered) % 2:
        return float(ordered[mid])
    return (ordered[mid - 1] + ordered[mid]) / 2.0


def _late_stats(conn: sqlite3.Connection, chamber: str | None) -> dict:
    condition = "" if chamber is None else " WHERE chamber = ?"
    params = () if chamber is None else (chamber,)
    # nosec B608 — `condition` is one of two literals above; the chamber
    # value is bound as a parameter.
    rows_with_status, late_count = conn.execute(
        "SELECT COUNT(is_late), COALESCE(SUM(is_late), 0)"
        f" FROM v_default_transactions{condition}",  # nosec B608
        params,
    ).fetchone()
    days = [
        d
        for (d,) in conn.execute(
            "SELECT days_to_file FROM v_default_transactions"
            f"{condition or ' WHERE 1=1'} AND days_to_file IS NOT NULL",  # nosec B608
            params,
        )
    ]
    return {
        "rows_with_late_status": rows_with_status,
        "late_count": late_count,
        "late_rate": _rate(late_count, rows_with_status),
        "median_days_to_file": _median(days),
    }


def compute_stats(
    conn: sqlite3.Connection,
    *,
    now: Callable[[], str],
    house_meta: Mapping[str, str | None] | None = None,
) -> dict:
    """Assemble the §5.2 stats document from one database."""
    # --- default-view aggregates (§9.5) --------------------------------------
    (default_rows,) = conn.execute(
        "SELECT COUNT(*) FROM v_default_transactions"
    ).fetchone()
    by_source = dict(
        conn.execute(
            "SELECT source, COUNT(*) FROM v_default_transactions GROUP BY source"
        ).fetchall()
    )
    kadoa_count = by_source.get("kadoa", 0)
    primary_count = default_rows - kadoa_count

    join_by_source: dict[str, dict] = {}
    for source, rows, joined in conn.execute(
        "SELECT source, COUNT(*), COUNT(bioguide_id)"
        " FROM v_default_transactions GROUP BY source"
    ):
        join_by_source[source] = {
            "rows": rows,
            "joined": joined,
            "join_rate": _rate(joined, rows),
        }
    primary_joined, primary_rows = conn.execute(
        "SELECT COUNT(bioguide_id), COUNT(*) FROM v_default_transactions"
        " WHERE source != 'kadoa'"
    ).fetchone()

    default = {
        "row_count": default_rows,
        "source_mix": {
            "primary_count": primary_count,
            "primary_rate": _rate(primary_count, default_rows),
            "kadoa_count": kadoa_count,
            "kadoa_rate": _rate(kadoa_count, default_rows),
            "by_source": {s: by_source.get(s, 0) for s in sorted(by_source)},
        },
        "late_filing": {
            "overall": _late_stats(conn, None),
            "by_chamber": {
                "house": _late_stats(conn, "house"),
                "senate": _late_stats(conn, "senate"),
            },
        },
        "join_coverage": {
            # The P1 gate (§9.7): joined rate over primary-source
            # transactions in the default view.
            "primary_rows": primary_rows,
            "primary_joined": primary_joined,
            "primary_join_rate": _rate(primary_joined, primary_rows),
            "by_source": join_by_source,
        },
    }

    # --- inventory totals (explicitly include excluded rows) -----------------
    (filing_count,) = conn.execute("SELECT COUNT(*) FROM filings").fetchone()
    (txn_count,) = conn.execute("SELECT COUNT(*) FROM transactions").fetchone()
    filings_by_source = dict(
        conn.execute("SELECT source, COUNT(*) FROM filings GROUP BY source").fetchall()
    )
    documents_by_source = dict(
        conn.execute(
            "SELECT source, COUNT(DISTINCT doc_url) FROM filings GROUP BY source"
        ).fetchall()
    )
    parse_coverage: dict[str, dict[str, dict[str, int]]] = {}
    for chamber, year, status, count in conn.execute(
        "SELECT chamber, substr(filed_date, 1, 4), parse_status, COUNT(*)"
        " FROM filings WHERE source != 'kadoa'"
        " GROUP BY chamber, substr(filed_date, 1, 4), parse_status"
    ):
        cell = parse_coverage.setdefault(chamber, {}).setdefault(year, {})
        cell[status] = count
    for chamber_cells in parse_coverage.values():
        for cell in chamber_cells.values():
            cell["total"] = sum(cell.values())
    (needs_ocr,) = conn.execute(
        "SELECT COUNT(*) FROM filings WHERE parse_status = 'needs_ocr'"
    ).fetchone()
    (member_count,) = conn.execute("SELECT COUNT(*) FROM members").fetchone()
    (pair_count,) = conn.execute(
        "SELECT COUNT(*) FROM filings WHERE supersedes IS NOT NULL"
    ).fetchone()

    # Per-era gate + join coverage (RUN M1-B, R6/R15). Both are ADDITIVE: the
    # existing keys and their shapes are untouched, and
    # parse_coverage_primary_by_chamber_year_including_excluded still auto-
    # extends by year with no code change. The gate figures come from
    # populus.parse_gate so the published numbers and the ones the ingest
    # summary prints are one computation, never two that can disagree.
    gate = compute_parse_gate(conn)
    efile_gate: dict[str, dict[str, dict]] = {}
    for era in gate.eras:
        efile_gate.setdefault(era.chamber, {})[era.year] = {
            "clean_efile_rows": era.clean_efile_rows,
            "efile_rows": era.efile_rows,
            "efile_parse_rate": era.efile_parse_rate,
            "row_denominator_known": era.row_denominator_known,
            "efile_filings": era.efile_filings,
            "measurable_efile_filings": era.measurable_efile_filings,
            "unmeasurable_efile_filings": era.unmeasurable_efile_filings,
            "efile_filing_measurable_rate": era.efile_filing_measurable_rate,
            "status": era.status,
            "meets_gate": era.meets_gate,
        }
    member_join: dict[str, dict[str, dict]] = {}
    for era in gate.join:
        member_join.setdefault(era.chamber, {})[era.year] = {
            "filings": era.filings,
            "filings_joined": era.filings_joined,
            "rows": era.rows,
            "rows_joined": era.rows_joined,
            "join_rate": era.join_rate,
        }

    totals = {
        "filing_count_including_excluded": filing_count,
        "transaction_count_including_excluded": txn_count,
        "filing_count_by_source_including_excluded": {
            s: filings_by_source[s] for s in sorted(filings_by_source)
        },
        "source_document_count_including_excluded": {
            s: documents_by_source[s] for s in sorted(documents_by_source)
        },
        "parse_coverage_primary_by_chamber_year_including_excluded": parse_coverage,
        "efile_parse_gate_by_chamber_year_including_excluded": efile_gate,
        "member_join_primary_by_chamber_year_including_excluded": member_join,
        "needs_ocr_filing_count_including_excluded": needs_ocr,
        "member_count": member_count,
        "unresolved_pair_count": pair_count,
    }

    # --- freshness -----------------------------------------------------------
    (house_max_filed,) = conn.execute(
        "SELECT MAX(filed_date) FROM filings"
        " WHERE chamber = 'house' AND source = 'house-clerk'"
    ).fetchone()
    (senate_max_filed,) = conn.execute(
        "SELECT MAX(filed_date) FROM filings"
        " WHERE chamber = 'senate' AND source = 'senate-efd'"
    ).fetchone()
    last_runs: dict[str, dict] = {}
    # Ordered scan, last row per job wins — deterministic even on
    # started_at ties (run_id breaks them).
    for run_id, job, started_at, finished_at, status in conn.execute(
        "SELECT run_id, job, started_at, finished_at, status"
        " FROM ingest_runs ORDER BY started_at, run_id"
    ):
        last_runs[job] = {
            "run_id": run_id,
            "started_at": started_at,
            "finished_at": finished_at,
            "status": status,
        }
    freshness = {
        "house_index_last_modified": _latest_http_date(
            (house_meta or {}).values()
        ),
        "house_index_last_modified_by_year": {
            year: value for year, value in sorted((house_meta or {}).items())
        },
        "house_db_max_filed_date": house_max_filed,
        "senate_db_max_filed_date": senate_max_filed,
        "last_ingest_runs": last_runs,
    }

    # --- unresolved names (never dropped — G3) -------------------------------
    unresolved_names = [
        {
            "filer_name_raw": name,
            "chamber": chamber,
            "source": source,
            "filing_count": count,
        }
        for name, chamber, source, count in conn.execute(
            "SELECT filer_name_raw, chamber, source, COUNT(*) FROM filings"
            " WHERE bioguide_id IS NULL"
            " GROUP BY filer_name_raw, chamber, source"
            " ORDER BY filer_name_raw, chamber, source"
        )
    ]

    return {
        "stats_version": STATS_VERSION,
        "generated_at": now(),
        "data_note": DATA_NOTE,
        "default": default,
        "totals": totals,
        "freshness": freshness,
        "unresolved_names": unresolved_names,
    }


def render_stats(stats: Mapping) -> str:
    """Byte-stable rendering: sorted keys, two-space indent, one newline."""
    return json.dumps(stats, ensure_ascii=False, indent=2, sort_keys=True) + "\n"
