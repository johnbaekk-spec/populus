"""B-5 (ALPHA-UX): issuer SIC ingest + the owned SIC→sector taxonomy.

Two halves, deliberately separate:

* ``issuer_sic`` — SIC code per issuer CIK, loaded from a **cached EDGAR
  snapshot** (a JSON object mapping CIK → SIC, produced by the ops fetch job
  from EDGAR submissions data; library code never touches the network). Every
  row records the snapshot's ``as_of`` date and source label.

* the packaged ``sic_taxonomy.yaml`` — a **versioned, owner-reviewed** mapping
  from SIC ranges to a closed sector vocabulary with a declared ``unknown``
  bucket. The taxonomy version travels with every derived sector so a number
  is traceable to the mapping revision that produced it.

The dashboard consumes ``issuer_sic`` (with ``taxonomy_version`` recorded in
``sic_taxonomy_meta``) and applies :func:`sector_for_sic` at build time; a
build whose database has no ``issuer_sic`` rows renders honest absence.
"""

from __future__ import annotations

import importlib.resources
import json
import re
import sqlite3
from dataclasses import dataclass
from datetime import date
from pathlib import Path

import yaml

_DDL = """
CREATE TABLE IF NOT EXISTS issuer_sic (
  cik TEXT PRIMARY KEY,              -- 10-digit zero-padded
  sic TEXT NOT NULL,                 -- as recorded by EDGAR, digits only
  sector TEXT NOT NULL,              -- resolved through the packaged taxonomy AT INGEST,
                                     -- so consumers read a value, never re-map
  as_of DATE NOT NULL,               -- snapshot date of the cached EDGAR input
  source TEXT NOT NULL               -- snapshot label, e.g. 'edgar-submissions'
);
CREATE TABLE IF NOT EXISTS sic_taxonomy_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
"""

_CIK_RE = re.compile(r"^\d{1,10}$")
_SIC_RE = re.compile(r"^\d{2,4}$")


def ensure_sector_schema(conn: sqlite3.Connection) -> None:
    conn.executescript(_DDL)


@dataclass(frozen=True)
class Taxonomy:
    version: int
    source: str
    license_note: str
    unknown_bucket: str
    ranges: tuple[tuple[int, int, str], ...]  # (from, to, sector), inclusive


def load_taxonomy(path: Path | str | None = None) -> Taxonomy:
    """Load and validate the taxonomy. Overlapping ranges are a defect —
    one SIC must map to exactly one sector or the mapping is not a function."""
    if path is None:
        text = (
            importlib.resources.files("populus")
            .joinpath("sic_taxonomy.yaml")
            .read_text(encoding="utf-8")
        )
    else:
        text = Path(path).read_text(encoding="utf-8")
    data = yaml.safe_load(text)
    ranges: list[tuple[int, int, str]] = []
    for pos, entry in enumerate(data.get("ranges") or []):
        lo, hi, sector = entry.get("from"), entry.get("to"), entry.get("sector")
        if not (isinstance(lo, int) and isinstance(hi, int) and lo <= hi and sector):
            raise ValueError(f"taxonomy range {pos} is malformed: {entry!r}")
        ranges.append((lo, hi, str(sector)))
    ranges.sort()
    for (alo, ahi, asec), (blo, bhi, bsec) in zip(ranges, ranges[1:]):
        if blo <= ahi:
            raise ValueError(
                f"taxonomy ranges overlap: [{alo},{ahi}]={asec} and [{blo},{bhi}]={bsec}"
            )
    version = data.get("taxonomy_version")
    if not isinstance(version, int) or version < 1:
        raise ValueError("taxonomy_version must be a positive integer")
    unknown = str(data.get("unknown_bucket") or "")
    if not unknown:
        raise ValueError("unknown_bucket must be declared")
    return Taxonomy(
        version=version,
        source=str(data.get("source") or ""),
        license_note=str(data.get("license_note") or ""),
        unknown_bucket=unknown,
        ranges=tuple(ranges),
    )


def sector_for_sic(taxonomy: Taxonomy, sic: str | None) -> str:
    """The sector for a SIC — or the declared unknown bucket. Never a guess:
    a malformed, absent, or out-of-range SIC is *unknown*, counted as such."""
    if sic is None or _SIC_RE.match(sic) is None:
        return taxonomy.unknown_bucket
    code = int(sic)
    for lo, hi, sector in taxonomy.ranges:
        if lo <= code <= hi:
            return sector
    return taxonomy.unknown_bucket


@dataclass(frozen=True)
class SectorIngestReport:
    read: int
    loaded: int
    malformed: int  # counted, never silently dropped (G3)
    taxonomy_version: int


def run_sectors_ingest(
    conn: sqlite3.Connection,
    *,
    snapshot_path: Path | str,
    as_of: str,
    source: str = "edgar-submissions",
    taxonomy_path: Path | str | None = None,
) -> SectorIngestReport:
    """Full-replace ``issuer_sic`` from a cached EDGAR-derived snapshot.

    The snapshot is a JSON object mapping CIK → SIC (both may be strings or
    ints as EDGAR emits them). Full-replace, because the snapshot is itself a
    complete statement as of its date — a partial merge would blend two
    as-of dates into one table and silently violate the dating rule.
    """
    # Strict calendar validation, matching the committee module: a snapshot
    # stamped 2026-02-30 would date every sector claim to a day that never
    # existed (same rule as the committee module).
    try:
        parsed_as_of = date.fromisoformat(as_of)
    except (TypeError, ValueError):
        parsed_as_of = None
    if parsed_as_of is None or parsed_as_of.isoformat() != as_of:
        raise ValueError(f"as_of must be a real YYYY-MM-DD date (got {as_of!r})")
    taxonomy = load_taxonomy(taxonomy_path)
    raw = json.loads(Path(snapshot_path).read_text(encoding="utf-8"))
    if not isinstance(raw, dict):
        raise ValueError("SIC snapshot must be a JSON object mapping CIK -> SIC")

    rows: list[tuple[str, str, str, str, str]] = []
    malformed = 0
    for cik_raw, sic_raw in raw.items():
        cik_text = str(cik_raw).strip()
        sic_text = str(sic_raw).strip()
        if not _CIK_RE.match(cik_text) or not _SIC_RE.match(sic_text):
            malformed += 1
            continue
        rows.append((cik_text.zfill(10), sic_text, sector_for_sic(taxonomy, sic_text), as_of, source))

    ensure_sector_schema(conn)
    conn.execute("BEGIN IMMEDIATE")
    try:
        conn.execute("DELETE FROM issuer_sic")
        conn.executemany(
            "INSERT OR REPLACE INTO issuer_sic (cik, sic, sector, as_of, source)"
            " VALUES (?, ?, ?, ?, ?)",
            rows,
        )
        for key, value in (
            ("taxonomy_version", str(taxonomy.version)),
            ("taxonomy_source", taxonomy.source),
            ("license_note", taxonomy.license_note),
            ("snapshot_as_of", as_of),
            ("snapshot_source", source),
        ):
            conn.execute(
                "INSERT INTO sic_taxonomy_meta (key, value) VALUES (?, ?)"
                " ON CONFLICT (key) DO UPDATE SET value = excluded.value",
                (key, value),
            )
        conn.execute("COMMIT")
    except BaseException:
        conn.execute("ROLLBACK")
        raise
    return SectorIngestReport(
        read=len(raw), loaded=len(rows), malformed=malformed, taxonomy_version=taxonomy.version
    )
