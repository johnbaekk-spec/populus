"""B-5: the owned SIC→sector taxonomy and the issuer_sic ingest."""

import json
import sqlite3

import pytest

from populus import sectors


@pytest.fixture()
def conn():
    c = sqlite3.connect(":memory:")
    yield c
    c.close()


def test_taxonomy_loads_is_total_and_versioned():
    tax = sectors.load_taxonomy()
    assert tax.version >= 1
    assert tax.unknown_bucket == "unknown"
    assert tax.license_note  # the licensing note is part of the contract
    # A function, not a relation: every 4-digit SIC maps to exactly one bucket.
    seen = {sectors.sector_for_sic(tax, str(code)) for code in range(0, 10000)}
    assert "unknown" in seen  # gaps land in the DECLARED bucket
    assert "manufacturing" in seen and "finance-insurance-realestate" in seen


def test_sector_for_sic_never_guesses():
    tax = sectors.load_taxonomy()
    assert sectors.sector_for_sic(tax, None) == "unknown"
    assert sectors.sector_for_sic(tax, "not-a-sic") == "unknown"
    assert sectors.sector_for_sic(tax, "3571") == "manufacturing"
    assert sectors.sector_for_sic(tax, "6022") == "finance-insurance-realestate"


def test_overlapping_taxonomy_ranges_are_a_defect(tmp_path):
    bad = tmp_path / "tax.yaml"
    bad.write_text(
        "taxonomy_version: 1\nsource: t\nlicense_note: t\nunknown_bucket: unknown\n"
        "ranges:\n  - { from: 100, to: 500, sector: a }\n  - { from: 400, to: 900, sector: b }\n"
    )
    with pytest.raises(ValueError, match="overlap"):
        sectors.load_taxonomy(bad)


def test_ingest_full_replace_counts_malformed_and_records_meta(conn, tmp_path):
    snap = tmp_path / "sic.json"
    snap.write_text(json.dumps({"320193": "3571", "bad cik": "3571", "789019": "no"}))
    report = sectors.run_sectors_ingest(conn, snapshot_path=snap, as_of="2026-08-12")
    assert report.loaded == 1
    assert report.malformed == 2  # counted, never silently dropped
    row = conn.execute("SELECT cik, sic, sector, as_of, source FROM issuer_sic").fetchone()
    assert row == ("0000320193", "3571", "manufacturing", "2026-08-12", "edgar-submissions")
    meta = dict(conn.execute("SELECT key, value FROM sic_taxonomy_meta").fetchall())
    assert meta["snapshot_as_of"] == "2026-08-12"
    assert int(meta["taxonomy_version"]) >= 1

    # Full replace: a second snapshot does not blend as-of dates.
    snap2 = tmp_path / "sic2.json"
    snap2.write_text(json.dumps({"789019": "7372"}))
    sectors.run_sectors_ingest(conn, snapshot_path=snap2, as_of="2026-09-01")
    rows = conn.execute("SELECT cik FROM issuer_sic").fetchall()
    assert rows == [("0000789019",)]


def test_ingest_rejects_bad_as_of(conn, tmp_path):
    snap = tmp_path / "sic.json"
    snap.write_text("{}")
    with pytest.raises(ValueError, match="as_of"):
        sectors.run_sectors_ingest(conn, snapshot_path=snap, as_of="last week")


@pytest.mark.parametrize("bad", ["2026-02-30", "0000-01-01", "2026-1-3", "last week"])
def test_ingest_refuses_impossible_as_of_dates(conn, tmp_path, bad):
    snap = tmp_path / "sic.json"
    snap.write_text("{}")
    with pytest.raises(ValueError, match="real YYYY-MM-DD"):
        sectors.run_sectors_ingest(conn, snapshot_path=snap, as_of=bad)


def test_ingest_accepts_a_real_leap_day(conn, tmp_path):
    snap = tmp_path / "sic.json"
    snap.write_text('{"320193": "3571"}')
    report = sectors.run_sectors_ingest(conn, snapshot_path=snap, as_of="2024-02-29")
    assert report.loaded == 1
