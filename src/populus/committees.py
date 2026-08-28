"""B-6 (ALPHA-UX): committee + membership ingest from ``cc0-legislators``.

The source (`congress-legislators`, CC0 — already licensed as
``cc0-legislators``) publishes **current** committees and memberships only.
The dating rule (plan F-12/S-5: *membership joins as of the trade date*) is
therefore explicit here rather than assumed: every membership row carries a
``[valid_from, valid_to]`` window supplied by the caller — normally the
current congress's start date and the snapshot date — and the join predicate
:func:`membership_as_of` answers ``None`` (unknown), never a guess, for any
date outside the snapshot's declared validity.

Also loads the packaged, versioned committee→sector jurisdiction mapping
(``committee_jurisdiction.yaml``) into ``committee_jurisdiction`` so the
dashboard reads tables only. Its non-allegation rule travels in the table
metadata and in every consumer.
"""

from __future__ import annotations

import importlib.resources
import sqlite3
from dataclasses import dataclass
from datetime import date
from pathlib import Path

import yaml

_DDL = """
CREATE TABLE IF NOT EXISTS committees (
  committee_id TEXT PRIMARY KEY,     -- thomas_id, e.g. 'HSAG'
  name TEXT NOT NULL,
  chamber TEXT NOT NULL,             -- 'house' | 'senate' | 'joint'
  url TEXT
);
CREATE TABLE IF NOT EXISTS committee_memberships (
  committee_id TEXT NOT NULL REFERENCES committees (committee_id),
  bioguide_id TEXT NOT NULL,
  role TEXT,                         -- title as published ('Chair', …) or NULL
  snapshot_date DATE NOT NULL,       -- when the source snapshot was taken
  valid_from DATE NOT NULL,          -- membership known valid from (congress start)
  valid_to DATE NOT NULL,            -- …through (normally = snapshot_date)
  PRIMARY KEY (committee_id, bioguide_id, snapshot_date)
);
CREATE TABLE IF NOT EXISTS committee_jurisdiction (
  committee_id TEXT NOT NULL,
  sector TEXT NOT NULL,              -- B-5 sic_taxonomy vocabulary
  mapping_version INTEGER NOT NULL,
  source TEXT NOT NULL,
  PRIMARY KEY (committee_id, sector)
);
"""

def _canonical_date(value: object) -> date | None:
    """A REAL canonical ``YYYY-MM-DD`` calendar date, or None.

    Shape is not enough: ``2026-02-30`` and ``0000-01-01``
    match the pattern but name no day, and a dated-membership answer for a
    date that never existed is a fabricated fact. ``date.fromisoformat``
    rejects both; it also accepts other ISO-8601 spellings in 3.11+, so the
    round-trip check pins the canonical form.
    """
    if not isinstance(value, str):
        return None
    try:
        parsed = date.fromisoformat(value)
    except ValueError:
        return None
    return parsed if parsed.isoformat() == value else None


def ensure_committee_schema(conn: sqlite3.Connection) -> None:
    conn.executescript(_DDL)


@dataclass(frozen=True)
class CommitteeIngestReport:
    committees: int
    memberships: int
    skipped: int  # entries with no thomas_id / bioguide — counted, never dropped silently
    jurisdiction_rows: int
    mapping_version: int


def run_committees_ingest(
    conn: sqlite3.Connection,
    *,
    legislators_dir: Path | str,
    snapshot_date: str,
    valid_from: str,
    jurisdiction_path: Path | str | None = None,
) -> CommitteeIngestReport:
    """Full-replace committees + memberships from the cached source dir.

    ``snapshot_date`` (when the cc0-legislators snapshot was taken) and
    ``valid_from`` (the current congress's start date) are REQUIRED — they
    are the dating contract. Full-replace, because the source is
    current-membership-only: merging snapshots would fabricate a history the
    source does not publish.
    """
    for name, value in (("snapshot_date", snapshot_date), ("valid_from", valid_from)):
        if _canonical_date(value) is None:
            raise ValueError(f"{name} must be a real YYYY-MM-DD date (got {value!r})")
    if valid_from > snapshot_date:
        raise ValueError("valid_from must not be after snapshot_date")

    legislators_dir = Path(legislators_dir)
    committees_raw = yaml.safe_load(
        (legislators_dir / "committees-current.yaml").read_text(encoding="utf-8")
    ) or []
    membership_raw = yaml.safe_load(
        (legislators_dir / "committee-membership-current.yaml").read_text(encoding="utf-8")
    ) or {}

    committee_rows: list[tuple[str, str, str, str | None]] = []
    skipped = 0
    known_ids: set[str] = set()
    for entry in committees_raw:
        thomas_id = entry.get("thomas_id")
        name = entry.get("name")
        ctype = entry.get("type")
        if not thomas_id or not name or ctype not in ("house", "senate", "joint"):
            skipped += 1
            continue
        known_ids.add(thomas_id)
        committee_rows.append((thomas_id, name, ctype, entry.get("url")))

    membership_rows: list[tuple[str, str, str | None, str, str, str]] = []
    for committee_id, people in membership_raw.items():
        # Subcommittee ids extend the parent id (e.g. 'HSAG16'); memberships
        # are stored at the id the source publishes. Rows naming a committee
        # the committees file does not carry are counted, not invented into
        # the committees table.
        if not isinstance(people, list):
            skipped += 1
            continue
        for person in people:
            bioguide = (person or {}).get("bioguide")
            if not bioguide:
                skipped += 1
                continue
            membership_rows.append(
                (
                    committee_id,
                    bioguide,
                    person.get("title"),
                    snapshot_date,
                    valid_from,
                    snapshot_date,
                )
            )

    jurisdiction = load_jurisdiction(jurisdiction_path)
    jur_rows = [
        (cid, sector, jurisdiction["mapping_version"], jurisdiction["source"])
        for cid, sectors in jurisdiction["committees"].items()
        for sector in sectors
    ]

    ensure_committee_schema(conn)
    conn.execute("BEGIN IMMEDIATE")
    try:
        conn.execute("DELETE FROM committee_memberships")
        conn.execute("DELETE FROM committees")
        conn.execute("DELETE FROM committee_jurisdiction")
        conn.executemany(
            "INSERT INTO committees (committee_id, name, chamber, url) VALUES (?, ?, ?, ?)",
            committee_rows,
        )
        # Memberships reference committees; subcommittee rows attach to their
        # parent committee when the exact id is absent, else are skipped+counted.
        resolved: list[tuple[str, str, str | None, str, str, str]] = []
        seen: set[tuple[str, str]] = set()
        unattached = 0
        for row in membership_rows:
            cid = row[0]
            target = cid if cid in known_ids else cid[:4] if cid[:4] in known_ids else None
            if target is None:
                unattached += 1
                continue
            key = (target, row[1])
            if key in seen:
                continue  # a member on a committee and its subcommittee: one row
            seen.add(key)
            resolved.append((target, *row[1:]))
        skipped += unattached
        conn.executemany(
            "INSERT INTO committee_memberships"
            " (committee_id, bioguide_id, role, snapshot_date, valid_from, valid_to)"
            " VALUES (?, ?, ?, ?, ?, ?)",
            resolved,
        )
        conn.executemany(
            "INSERT INTO committee_jurisdiction (committee_id, sector, mapping_version, source)"
            " VALUES (?, ?, ?, ?)",
            jur_rows,
        )
        conn.execute("COMMIT")
    except BaseException:
        conn.execute("ROLLBACK")
        raise
    return CommitteeIngestReport(
        committees=len(committee_rows),
        memberships=len(resolved),
        skipped=skipped,
        jurisdiction_rows=len(jur_rows),
        mapping_version=jurisdiction["mapping_version"],
    )


def load_jurisdiction(path: Path | str | None = None) -> dict:
    """The packaged committee→sector mapping, validated."""
    if path is None:
        text = (
            importlib.resources.files("populus")
            .joinpath("committee_jurisdiction.yaml")
            .read_text(encoding="utf-8")
        )
    else:
        text = Path(path).read_text(encoding="utf-8")
    data = yaml.safe_load(text)
    version = data.get("mapping_version")
    if not isinstance(version, int) or version < 1:
        raise ValueError("mapping_version must be a positive integer")
    committees: dict[str, list[str]] = {}
    for cid, entry in (data.get("committees") or {}).items():
        sectors = (entry or {}).get("sectors") or []
        if not sectors:
            raise ValueError(f"committee {cid} maps to no sectors — remove it or map it")
        committees[str(cid)] = [str(s) for s in sectors]
    return {
        "mapping_version": version,
        "source": str(data.get("source") or ""),
        "committees": committees,
    }


def membership_as_of(
    conn: sqlite3.Connection, bioguide_id: str, trade_date: str
) -> list[tuple[str, str]] | None:
    """Committees this member sat on AS OF ``trade_date`` — or ``None`` when
    the question is unanswerable from the snapshots on record.

    The dating rule, enforced: a trade date outside every stored validity
    window returns ``None`` ("membership as of that date is not known"),
    which is a different claim from ``[]`` ("known, and none"). Callers must
    preserve that distinction — collapsing None into [] would assert an
    absence the source cannot support.
    """
    # A trade date that names no real day is UNKNOWN, never an answer.
    if _canonical_date(trade_date) is None:
        return None
    windows = conn.execute(
        "SELECT MIN(valid_from), MAX(valid_to) FROM committee_memberships"
    ).fetchone()
    if windows is None or windows[0] is None:
        return None  # no snapshot at all
    if trade_date < windows[0] or trade_date > windows[1]:
        return None  # outside every declared validity window
    rows = conn.execute(
        "SELECT m.committee_id, c.name FROM committee_memberships m"
        " JOIN committees c ON c.committee_id = m.committee_id"
        " WHERE m.bioguide_id = ? AND m.valid_from <= ? AND m.valid_to >= ?"
        " ORDER BY m.committee_id",
        (bioguide_id, trade_date, trade_date),
    ).fetchall()
    return [(r[0], r[1]) for r in rows]
