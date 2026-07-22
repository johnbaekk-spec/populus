"""Atomic per-filing load (R8): stamping, idempotency, ghost rows, rollback,
and the public loader contract."""

from __future__ import annotations

import json
import sqlite3
from types import MappingProxyType

import pytest

from populus.canonical import canonical_json
from populus.load import ParsedRow, LoadResult, UnknownFilingError, load_filing

VERSIONS = dict(parse_status="parsed", parser_version="v1", normalization_version="n1")


def _insert_member(conn, bioguide_id="D000001"):
    conn.execute(
        "INSERT INTO members (bioguide_id, full_name, chamber, terms, raw)"
        " VALUES (?, 'Jane Doe', 'house', '[]', '{}')",
        (bioguide_id,),
    )


def _txn_ids(conn, filing_id):
    return {
        txn_id
        for (txn_id,) in conn.execute(
            "SELECT txn_id FROM transactions WHERE filing_id = ?", (filing_id,)
        )
    }


def test_load_populates_updates_and_stamps(initialized_db, make_filing, make_row):
    conn = initialized_db
    _insert_member(conn)
    fid = make_filing(conn, bioguide_id="D000001")
    rows = [
        make_row(asset_name="Apple Inc", row_ordinal=1, flags=["missing_ticker"]),
        make_row(asset_name="Microsoft Corp", row_ordinal=2),
    ]
    result = load_filing(
        conn, fid, rows,
        parse_status="parsed", parser_version="house-1.0.0", normalization_version="norm-1",
    )

    assert isinstance(result, LoadResult)
    assert result.filing_id == fid
    assert result.row_count == 2
    assert result.deleted == 0
    assert len(result.txn_ids) == 2

    stored = conn.execute(
        "SELECT bioguide_id, chamber, filed_date, source, license_id, flags,"
        " raw_row, txn_id, asset_name FROM transactions WHERE filing_id = ?"
        " ORDER BY row_ordinal",
        (fid,),
    ).fetchall()
    assert len(stored) == 2
    for bioguide_id, chamber, filed_date, source, license_id, *_ in stored:
        assert bioguide_id == "D000001"
        assert chamber == "house"
        assert filed_date == "2026-01-10"
        assert source == "house-clerk"
        assert license_id == "us-congress-disclosures"
    # flags serialize as a JSON array; raw_row stores the JCS canonical text.
    assert json.loads(stored[0][5]) == ["missing_ticker"]
    assert stored[1][5] == "[]"
    assert stored[0][6] == canonical_json(rows[0].raw_row).decode("utf-8")
    # txn_ids are returned in input order.
    assert stored[0][7] == result.txn_ids[0] and stored[0][8] == "Apple Inc"
    assert stored[1][7] == result.txn_ids[1] and stored[1][8] == "Microsoft Corp"

    filing = conn.execute(
        "SELECT parse_status, parser_version, normalization_version, row_count"
        " FROM filings WHERE filing_id = ?",
        (fid,),
    ).fetchone()
    assert filing == ("parsed", "house-1.0.0", "norm-1", 2)


def test_every_parsed_row_column_round_trips(initialized_db, make_filing):
    # F3: prove every normalized ParsedRow-backed column reaches its column
    # intact — a dropped or transposed value must fail here. Each field carries
    # a distinct, non-default sentinel.
    conn = initialized_db
    fid = make_filing(conn)
    raw = {"asset_name": "Sentinel Raw", "ticker": "SENT", "marker": "unique-raw-42"}
    row = ParsedRow(
        raw_row=raw,
        row_ordinal=7,
        asset_name="Sentinel Asset Name",
        side="sale_partial",
        source_row_no=13,
        owner="spouse",
        ticker="ZQXW",
        asset_type="corporate_bond",
        transaction_date="2025-11-30",
        days_to_file=99,
        is_late=1,
        amount_low=15001,
        amount_high=50000,
        amount_label="$15,001 - $50,000",
        cap_gains_over_200=1,
        comment="sentinel comment text",
        flags=["flag_a", "flag_b"],
        kadoa_id="kad-sentinel-7",
    )
    result = load_filing(conn, fid, [row], **VERSIONS)

    stored = conn.execute(
        "SELECT raw_row, row_ordinal, source_row_no, owner, ticker, asset_name,"
        " asset_type, side, transaction_date, days_to_file, is_late, amount_low,"
        " amount_high, amount_label, cap_gains_over_200, comment, flags, kadoa_id"
        " FROM transactions WHERE txn_id = ?",
        (result.txn_ids[0],),
    ).fetchone()
    assert stored == (
        canonical_json(raw).decode("utf-8"),
        7,
        13,
        "spouse",
        "ZQXW",
        "Sentinel Asset Name",
        "corporate_bond",
        "sale_partial",
        "2025-11-30",
        99,
        1,
        15001,
        50000,
        "$15,001 - $50,000",
        1,
        "sentinel comment text",
        '["flag_a", "flag_b"]',
        "kad-sentinel-7",
    )


def test_load_accepts_non_dict_mapping_raw_row(initialized_db, make_filing):
    # F1 at the loader seam: a MappingProxyType raw_row must load and store the
    # same canonical text as the equivalent dict.
    conn = initialized_db
    fid = make_filing(conn)
    plain = {"asset_name": "Proxy Asset", "ticker": "PRX"}
    row = ParsedRow(
        raw_row=MappingProxyType(plain),
        row_ordinal=1,
        asset_name="Proxy Asset",
        side="purchase",
    )
    result = load_filing(conn, fid, [row], **VERSIONS)
    raw_row = conn.execute(
        "SELECT raw_row FROM transactions WHERE txn_id = ?", (result.txn_ids[0],)
    ).fetchone()[0]
    assert raw_row == canonical_json(plain).decode("utf-8")


def test_load_stamps_kadoa_license(initialized_db, make_filing, make_row):
    conn = initialized_db
    fid = make_filing(
        conn,
        filing_id="kadoa:seed-77",
        source="kadoa",
        license_id="mit-kadoa-seed",
        doc_url="https://example.gov/original.pdf",
    )
    result = load_filing(
        conn, fid, [make_row(kadoa_id="k-77-1")], **VERSIONS
    )
    license_id, kadoa_id, source = conn.execute(
        "SELECT license_id, kadoa_id, source FROM transactions WHERE txn_id = ?",
        (result.txn_ids[0],),
    ).fetchone()
    assert license_id == "mit-kadoa-seed"
    assert kadoa_id == "k-77-1"
    assert source == "kadoa"


def test_denormalized_columns_equal_filing_values(initialized_db, make_filing, make_row):
    conn = initialized_db
    _insert_member(conn)
    house = make_filing(conn, bioguide_id="D000001")
    kadoa = make_filing(
        conn,
        filing_id="kadoa:seed-1",
        source="kadoa",
        license_id="mit-kadoa-seed",
        filed_date="2024-06-01",
    )
    load_filing(conn, house, [make_row(asset_name="Apple Inc")], **VERSIONS)
    load_filing(conn, kadoa, [make_row(asset_name="Tesla Inc")], **VERSIONS)
    # The §9.4 CI invariant: denormalized columns equal their filing's values.
    mismatches = conn.execute(
        "SELECT count(*) FROM transactions t JOIN filings f USING (filing_id)"
        " WHERE t.chamber != f.chamber OR t.filed_date != f.filed_date"
        "    OR t.source != f.source OR t.license_id != f.license_id"
        "    OR t.bioguide_id IS NOT f.bioguide_id"
    ).fetchone()[0]
    assert mismatches == 0


def test_reload_is_idempotent(initialized_db, make_filing, make_row):
    conn = initialized_db
    fid = make_filing(conn)
    rows = [
        make_row(asset_name="Apple Inc", row_ordinal=1),
        make_row(asset_name="Microsoft Corp", row_ordinal=2),
    ]
    first = load_filing(conn, fid, rows, **VERSIONS)
    # Reparse with new parser/normalization versions: identity must not move.
    second = load_filing(
        conn, fid, rows,
        parse_status="parsed", parser_version="v2", normalization_version="n2",
    )
    assert second.txn_ids == first.txn_ids
    assert second.deleted == 2
    assert _txn_ids(conn, fid) == set(first.txn_ids)
    assert conn.execute("SELECT count(*) FROM transactions").fetchone()[0] == 2


def test_reload_dropping_one_row_removes_exactly_it(initialized_db, make_filing, make_row):
    conn = initialized_db
    fid = make_filing(conn)
    a = make_row(asset_name="Apple Inc", row_ordinal=1)
    b = make_row(asset_name="Microsoft Corp", row_ordinal=2)
    c = make_row(asset_name="Nvidia Corp", row_ordinal=3)
    first = load_filing(conn, fid, [a, b, c], **VERSIONS)
    second = load_filing(conn, fid, [a, c], **VERSIONS)
    assert second.txn_ids == (first.txn_ids[0], first.txn_ids[2])
    assert _txn_ids(conn, fid) == {first.txn_ids[0], first.txn_ids[2]}


def test_newly_discovered_earlier_duplicate_shifts_later_dup_seq(
    initialized_db, make_filing, make_row
):
    conn = initialized_db
    fid = make_filing(conn)
    dup_raw = {"asset_name": "Dup Asset", "side": "P"}
    unique = make_row(asset_name="Unique Corp", row_ordinal=1)
    first = load_filing(
        conn, fid,
        [unique,
         make_row(raw_row=dup_raw, asset_name="Dup Asset", row_ordinal=2),
         make_row(raw_row=dup_raw, asset_name="Dup Asset", row_ordinal=3)],
        **VERSIONS,
    )
    unique_id, dup_base, dup_2 = first.txn_ids
    assert dup_2 == f"{dup_base}#2"

    # A reparse discovers another identical duplicate EARLIER in the document.
    second = load_filing(
        conn, fid,
        [make_row(raw_row=dup_raw, asset_name="Dup Asset", row_ordinal=1),
         make_row(asset_name="Unique Corp", row_ordinal=2),
         make_row(raw_row=dup_raw, asset_name="Dup Asset", row_ordinal=3),
         make_row(raw_row=dup_raw, asset_name="Dup Asset", row_ordinal=4)],
        **VERSIONS,
    )
    # The unique row's identity is untouched (the spec's stability guarantee);
    # later duplicates shift (§9.4's accepted residual instability).
    assert second.txn_ids[1] == unique_id
    assert second.txn_ids[0] == dup_base
    assert second.txn_ids[2] == f"{dup_base}#2"
    assert second.txn_ids[3] == f"{dup_base}#3"


def test_zero_row_load_is_valid(initialized_db, make_filing):
    conn = initialized_db
    fid = make_filing(conn, parse_status="needs_ocr")
    result = load_filing(
        conn, fid, [],
        parse_status="needs_ocr", parser_version="v1", normalization_version="n1",
    )
    assert result.row_count == 0
    assert result.txn_ids == ()
    assert conn.execute("SELECT count(*) FROM transactions").fetchone()[0] == 0
    row_count = conn.execute(
        "SELECT row_count FROM filings WHERE filing_id = ?", (fid,)
    ).fetchone()[0]
    assert row_count == 0


def test_midload_failure_rolls_back_to_prior_state(initialized_db, make_filing, make_row):
    conn = initialized_db
    fid = make_filing(conn)
    original = [
        make_row(asset_name="Apple Inc", row_ordinal=1),
        make_row(asset_name="Microsoft Corp", row_ordinal=2),
    ]
    load_filing(conn, fid, original, **VERSIONS)
    before = conn.execute(
        "SELECT txn_id, raw_row, asset_name FROM transactions ORDER BY txn_id"
    ).fetchall()

    # First replacement row is valid and INSERTs; the second is canonically
    # valid JSON but violates the side CHECK — the failure happens after a
    # successful insert, so a partial-commit loader would fail this test.
    replacement = [
        make_row(asset_name="Nvidia Corp", row_ordinal=1),
        make_row(asset_name="Broken Corp", row_ordinal=2, side="bogus"),
    ]
    with pytest.raises(sqlite3.IntegrityError):
        load_filing(
            conn, fid, replacement,
            parse_status="parsed", parser_version="v9", normalization_version="n9",
        )

    after = conn.execute(
        "SELECT txn_id, raw_row, asset_name FROM transactions ORDER BY txn_id"
    ).fetchall()
    assert after == before
    filing = conn.execute(
        "SELECT parse_status, parser_version, normalization_version, row_count"
        " FROM filings WHERE filing_id = ?",
        (fid,),
    ).fetchone()
    assert filing == ("parsed", "v1", "n1", 2)


def test_unknown_filing_raises_and_writes_nothing(initialized_db, make_row):
    conn = initialized_db
    with pytest.raises(UnknownFilingError):
        load_filing(conn, "house:absent", [make_row()], **VERSIONS)
    assert conn.execute("SELECT count(*) FROM transactions").fetchone()[0] == 0
    assert conn.execute("SELECT count(*) FROM filings").fetchone()[0] == 0
    # No transaction was left open on the connection.
    conn.execute("BEGIN IMMEDIATE")
    conn.execute("ROLLBACK")
