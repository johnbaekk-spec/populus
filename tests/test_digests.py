"""Digests, inventory envelope, journal round-trip, path safety (RUN 5; R4,
R5, R12, R13, R29, R35).

The dist and logical digest envelopes are reconstructed INDEPENDENTLY in
these tests (hardcoded framing and column lists), so any drift in the
implementation's byte contract fails here.
"""

from __future__ import annotations

import hashlib
import json
import os
import sqlite3
from pathlib import Path

import pytest

from test_publish import NOW, make_repo, pin, seed_db

from populus.canonical import canonical_json
from populus.db import connect
from populus.ingest import UnsafeArchivePathError
from populus.publish.build import (
    STAGING_DIR,
    LocalDirBackend,
    build_journal,
    journal_db_bytes,
    journal_load,
    journal_valid,
    materialize_from_journal,
    run_build,
)
from populus.publish.digests import (
    LOGICAL_PROJECTIONS,
    DigestError,
    dist_digest,
    logical_digest,
    sha256_file,
)
from populus.publish.inventory import (
    build_inventory,
    inventory_digest,
    render_inventory,
    write_inventory,
)
from populus.publish.manifest import (
    resolve_within,
    safe_artifact_name,
    validate_locator,
)

# --- dist_digest (R12) --------------------------------------------------------


def make_tree(tmp_path: Path, files: dict[str, bytes]) -> Path:
    tree = tmp_path / "tree"
    for relpath, data in files.items():
        target = tree / relpath
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)
    return tree


def expected_dist(files: dict[str, bytes]) -> str:
    """The §12.1 framing, reconstructed independently of the implementation."""
    framed = b""
    for relpath in sorted(files, key=lambda p: p.encode("utf-8")):
        data = files[relpath]
        framed += (
            relpath.encode("utf-8")
            + b"\x00"
            + str(len(data)).encode("ascii")
            + b"\x00"
            + hashlib.sha256(data).hexdigest().encode("ascii")
            + b"\x0a"
        )
    return hashlib.sha256(framed).hexdigest()


def test_dist_digest_exact_framing(tmp_path):
    files = {"index.html": b"<html>hello</html>", "sub/data.bin": b"\x00\x01\x02"}
    tree = make_tree(tmp_path, files)
    assert dist_digest(tree) == expected_dist(files)


def test_dist_digest_bytewise_path_ordering(tmp_path):
    # 'Z' (0x5a) sorts before 'a' (0x61) bytewise; '-' (0x2d) before '/'
    # (0x2f): the independent reconstruction proves the sort matches.
    files = {"Z.txt": b"z", "b.txt": b"b", "a-b": b"1", "a/b": b"2"}
    tree = make_tree(tmp_path, files)
    assert dist_digest(tree) == expected_dist(files)


def test_dist_digest_mode_invariance(tmp_path):
    files = {"page.html": b"content"}
    tree = make_tree(tmp_path, files)
    before = dist_digest(tree)
    os.chmod(tree / "page.html", 0o755)
    assert dist_digest(tree) == before  # mode is deliberately excluded


def test_dist_digest_rejects_symlink(tmp_path):
    tree = make_tree(tmp_path, {"real.txt": b"x"})
    (tree / "link.txt").symlink_to(tree / "real.txt")
    with pytest.raises(DigestError, match="symlink"):
        dist_digest(tree)


def test_dist_digest_rejects_symlinked_directory(tmp_path):
    tree = make_tree(tmp_path, {"real/inner.txt": b"x"})
    (tree / "alias").symlink_to(tree / "real", target_is_directory=True)
    with pytest.raises(DigestError, match="symlink"):
        dist_digest(tree)


def test_dist_digest_rejects_fifo(tmp_path):
    tree = make_tree(tmp_path, {"real.txt": b"x"})
    os.mkfifo(tree / "pipe")
    with pytest.raises(DigestError, match="non-regular"):
        dist_digest(tree)


def test_dist_digest_rejects_missing_tree(tmp_path):
    with pytest.raises(DigestError, match="not a directory"):
        dist_digest(tmp_path / "absent")


# --- inventory (R13) ----------------------------------------------------------


def test_inventory_envelope_order_and_digest(tmp_path):
    files = {"b.txt": b"bee", "a/c.txt": b"sea"}
    tree = make_tree(tmp_path, files)
    inventory = build_inventory(tree)
    assert inventory["dist_digest_version"] == "1"
    assert inventory["dist_digest"] == expected_dist(files)
    assert [entry["path"] for entry in inventory["files"]] == ["a/c.txt", "b.txt"]
    for entry in inventory["files"]:
        assert entry["bytes"] == len(files[entry["path"]])
        assert entry["sha256"] == hashlib.sha256(files[entry["path"]]).hexdigest()
    # RFC 8785 exact canonical bytes; the digest covers exactly those bytes.
    rendered = render_inventory(inventory)
    assert rendered == canonical_json(inventory)
    assert inventory_digest(inventory) == hashlib.sha256(rendered).hexdigest()


def test_write_inventory_sibling_guard(tmp_path):
    tree = make_tree(tmp_path, {"x.txt": b"x"})
    with pytest.raises(DigestError, match="inside the tree"):
        write_inventory(tree, tree / "inventory.json")
    with pytest.raises(DigestError, match="inside the tree"):
        write_inventory(tree, tree / "deep" / "inventory.json")
    sibling = tmp_path / "inventory.json"
    inventory = write_inventory(tree, sibling)
    assert sibling.read_bytes() == render_inventory(inventory)


def test_inventory_rejects_non_regular_trees(tmp_path):
    tree = make_tree(tmp_path, {"real.txt": b"x"})
    (tree / "link").symlink_to(tree / "real.txt")
    with pytest.raises(DigestError):
        build_inventory(tree)


# --- logical digest (R4/R5) ---------------------------------------------------

# Projection v1 column lists, hardcoded independently of PRAGMA table_info.
PROJECTED_COLUMNS = {
    "filings": [
        "filing_id", "chamber", "bioguide_id", "filer_name_raw", "filing_kind",
        "filed_date", "doc_url", "raw_path", "response_hash", "parse_status",
        "lifecycle", "supersedes", "primary_filing_id", "parser_version",
        "normalization_version", "row_count", "source", "license_id",
    ],
    "member_aliases": [
        "alias_id", "alias", "chamber", "state", "district", "valid_from",
        "valid_to", "bioguide_id", "note",
    ],
    "members": [
        "bioguide_id", "full_name", "chamber", "party", "state", "district",
        "terms", "raw",
    ],
    "transactions": [
        "txn_id", "filing_id", "raw_row", "row_fingerprint", "dup_seq",
        "row_ordinal", "source_row_no", "bioguide_id", "chamber", "owner",
        "ticker", "asset_name", "asset_type", "side", "transaction_date",
        "filed_date", "days_to_file", "is_late", "amount_low", "amount_high",
        "amount_label", "cap_gains_over_200", "comment",
        "filing_status", "subholding_of", "location", "flags", "source",
        "license_id", "kadoa_id",
    ],
}
PROJECTED_PKS = {
    "filings": "filing_id",
    "member_aliases": "alias_id",
    "members": "bioguide_id",
    "transactions": "txn_id",
}


def expected_logical(conn) -> str:
    """§5.5 envelope, reconstructed independently: sorted tables, T: frames,
    PK-ordered RFC 8785 rows, one per line."""
    digest = hashlib.sha256()
    for table in sorted(PROJECTED_COLUMNS):
        digest.update(f"T:{table}\n".encode())
        columns = PROJECTED_COLUMNS[table]
        rows = conn.execute(
            f"SELECT {', '.join(columns)} FROM {table}"  # nosec B608 — test constants
            f" ORDER BY {PROJECTED_PKS[table]}"
        ).fetchall()
        for row in rows:
            digest.update(canonical_json(dict(zip(columns, row))))
            digest.update(b"\n")
    return digest.hexdigest()


@pytest.fixture
def seeded(tmp_path):
    db_path = seed_db(tmp_path / "populus.db")
    conn = connect(str(db_path))
    yield conn, db_path
    conn.close()


def test_logical_digest_matches_independent_envelope(seeded):
    conn, _path = seeded
    conn.execute(
        "INSERT INTO member_aliases (alias, chamber, state, district,"
        " valid_from, valid_to, bioguide_id, note) VALUES"
        " ('doe jane', 'house', NULL, NULL, '2013-01-03', NULL, 'D000001', 'test')"
    )
    assert logical_digest(conn) == expected_logical(conn)


def test_logical_digest_excludes_ingest_runs_and_ingested_at(seeded):
    conn, _path = seeded
    before = logical_digest(conn)
    conn.execute(
        "INSERT INTO ingest_runs (run_id, job, started_at, status, host)"
        " VALUES ('r1', 'congress-house', '2026-07-23T00:00:00Z', 'ok', 'h')"
    )
    conn.execute("UPDATE filings SET ingested_at = '2030-01-01T00:00:00Z'")
    assert logical_digest(conn) == before


def test_logical_digest_changes_on_transactions_mutation(seeded):
    conn, _path = seeded
    before = logical_digest(conn)
    conn.execute("UPDATE transactions SET asset_name = 'Apple Inc.' WHERE row_ordinal = 1")
    assert logical_digest(conn) != before


def test_logical_digest_raw_row_is_opaque_text(seeded):
    conn, _path = seeded
    before = logical_digest(conn)
    # Semantically identical JSON, different bytes: the digest MUST change,
    # because TEXT is hashed as its stored bytes, never parsed.
    (raw,) = conn.execute(
        "SELECT raw_row FROM transactions WHERE row_ordinal = 1"
    ).fetchone()
    reordered = json.dumps(json.loads(raw), sort_keys=True, separators=(",  ", ": "))
    assert reordered != raw and json.loads(reordered) == json.loads(raw)
    conn.execute(
        "UPDATE transactions SET raw_row = ? WHERE row_ordinal = 1", (reordered,)
    )
    assert logical_digest(conn) != before


def test_logical_digest_null_distinct_from_zero_both_directions(seeded):
    conn, _path = seeded
    # NULL → 0 flips the digest…
    conn.execute("UPDATE transactions SET is_late = NULL")
    null_digest = logical_digest(conn)
    conn.execute("UPDATE transactions SET is_late = 0")
    zero_digest = logical_digest(conn)
    assert null_digest != zero_digest
    # …and 0 → NULL flips it back (both directions bind, R4).
    conn.execute("UPDATE transactions SET is_late = NULL")
    assert logical_digest(conn) == null_digest


def test_logical_digest_null_distinct_from_empty_string_both_directions(seeded):
    conn, _path = seeded
    conn.execute("UPDATE transactions SET comment = NULL")
    null_digest = logical_digest(conn)
    conn.execute("UPDATE transactions SET comment = ''")
    empty_digest = logical_digest(conn)
    assert null_digest != empty_digest
    conn.execute("UPDATE transactions SET comment = NULL")
    assert logical_digest(conn) == null_digest


def test_logical_digest_rejects_blob(seeded):
    conn, _path = seeded
    conn.execute(
        "UPDATE transactions SET comment = ? WHERE row_ordinal = 1",
        (b"\x00\xff",),
    )
    with pytest.raises(DigestError, match="BLOB"):
        logical_digest(conn)


def test_logical_digest_insertion_order_independent(tmp_path):
    """Two DBs, same logical rows in different insertion order ⇒ one digest
    (PK-sorted rows; file bytes may differ)."""
    from populus.load import ParsedRow, insert_filing, load_filing
    from populus.db import init_db

    digests = []
    for order in ((1, 2), (2, 1)):
        db_path = tmp_path / f"order{order[0]}{order[1]}.db"
        init_db(str(db_path))
        conn = connect(str(db_path))
        try:
            for filing_number in order:
                insert_filing(
                    conn,
                    filing_id=f"house:{filing_number}",
                    chamber="house",
                    filer_name_raw="Doe, Jane",
                    filing_kind="ptr",
                    filed_date="2026-01-10",
                    doc_url=f"https://x.invalid/{filing_number}.pdf",
                    source="house-clerk",
                    ingested_at=f"2026-01-1{filing_number}T00:00:00Z",
                )
                load_filing(
                    conn,
                    f"house:{filing_number}",
                    [
                        ParsedRow(
                            raw_row={"n": filing_number},
                            row_ordinal=1,
                            asset_name=f"Asset {filing_number}",
                            side="purchase",
                        )
                    ],
                    parse_status="parsed",
                    parser_version="t1",
                    normalization_version="t1",
                )
            digests.append(logical_digest(conn))
        finally:
            conn.close()
    assert digests[0] == digests[1]


# --- inst logical digest (R2/R5) ----------------------------------------------

# The inst projection v1 column lists + PKs, hardcoded independently of the
# implementation so any drift in the byte contract fails here.
INST_PROJECTED_COLUMNS = {
    "agg_filer_registry": [
        "cik", "filer_name", "latest_period", "position_count",
        "total_value_usd", "null_value_positions", "unkeyed_positions",
    ],
    "agg_qoq_deltas": [
        "cik", "position_key", "put_call", "curr_period", "prev_period",
        "change_kind", "prev_value_usd", "curr_value_usd", "delta_value_usd",
        "prev_shares", "curr_shares", "delta_shares", "ssh_prnamt_type", "flags",
    ],
    "agg_issuer_top_holders": [
        "issuer_key", "period_of_report", "rank", "cik", "filer_name",
        "issuer_name", "issuer_key_source", "value_usd", "security_count", "flags",
    ],
    "agg_filer_concentration": [
        # RUN M2-8 T6 added max_position_share_bps. This list is a DELIBERATE
        # independent restatement of the projection — it caught the new column,
        # which is exactly its job. Keep it in DDL order.
        "cik", "period_of_report", "position_count", "total_value_usd",
        "null_value_positions", "topn_value_usd", "topn_share_bps", "hhi",
        "max_position_share_bps", "flags",
    ],
}
INST_PROJECTED_PKS = {
    "agg_filer_registry": "cik",
    # QA-F8: the COMPLETE primary key — ssh_prnamt_type is part of the grain,
    # so omitting it leaves multi-unit rows nondeterministically ordered and an
    # ordering regression could evade this independent oracle.
    "agg_qoq_deltas": "cik, position_key, put_call, ssh_prnamt_type, curr_period",
    "agg_issuer_top_holders": "issuer_key, period_of_report, rank",
    "agg_filer_concentration": "cik, period_of_report",
}


def expected_inst_logical(conn) -> str:
    digest = hashlib.sha256()
    for table in sorted(INST_PROJECTED_COLUMNS):
        digest.update(f"T:{table}\n".encode())
        columns = INST_PROJECTED_COLUMNS[table]
        rows = conn.execute(
            f"SELECT {', '.join(columns)} FROM {table}"  # nosec B608 — test constants
            f" ORDER BY {INST_PROJECTED_PKS[table]}"
        ).fetchall()
        for row in rows:
            digest.update(canonical_json(dict(zip(columns, row))))
            digest.update(b"\n")
    return digest.hexdigest()


@pytest.fixture
def inst_agg_conn(tmp_path):
    """A small populated inst_agg.db opened for digesting."""
    from test_inst_agg import _db, _filer, _hold, _load, _security

    src = _db(tmp_path)
    _filer(src, "0000000001")
    _security(src, "sec:x")
    _load(
        src, fid="inst:A-1", cik="0000000001", period="2025-12-31",
        filed="2026-01-15",
        holds=[
            _hold(ordinal=1, issuer="X CO", cusip="111111111", value=1000,
                  security_id="sec:x"),
            _hold(ordinal=2, issuer="NULLCO", cusip="222222222", value=None),
        ],
    )
    _load(
        src, fid="inst:A-2", cik="0000000001", period="2026-03-31",
        filed="2026-04-15",
        holds=[_hold(ordinal=1, issuer="X CO", cusip="111111111", value=1500,
                     security_id="sec:x")],
    )
    from populus.amendments import ensure_views
    from populus.inst_agg import build_inst_agg

    ensure_views(src)
    out = tmp_path / "inst_agg.db"
    build_inst_agg(src, out, ingested_at="2026-07-24T00:00:00Z")
    src.close()
    agg = connect(str(out))
    yield agg, out
    agg.close()


def test_inst_logical_digest_matches_independent_envelope(inst_agg_conn):
    agg, _out = inst_agg_conn
    assert logical_digest(agg, LOGICAL_PROJECTIONS["inst"]) == expected_inst_logical(agg)


def test_inst_logical_digest_excludes_ingested_at_and_build_meta(inst_agg_conn):
    agg, _out = inst_agg_conn
    before = logical_digest(agg, LOGICAL_PROJECTIONS["inst"])
    # Volatile provenance and the excluded meta table must not move the digest.
    agg.execute("UPDATE agg_filer_registry SET ingested_at = '2099-01-01T00:00:00Z'")
    agg.execute(
        "UPDATE agg_build_meta SET value = '2099-01-01T00:00:00Z'"
        " WHERE key = 'ingested_at'"
    )
    agg.execute(
        "INSERT INTO agg_build_meta (key, value) VALUES ('extra', 'whatever')"
    )
    assert logical_digest(agg, LOGICAL_PROJECTIONS["inst"]) == before


def test_compact_qoq_view_matches_legacy_values_types_and_digest():
    from populus.inst_agg import _load_ddl

    compact = sqlite3.connect(":memory:")
    legacy = sqlite3.connect(":memory:")
    compact.executescript(_load_ddl())
    compact.execute(
        "INSERT INTO agg_build_meta(key,value) VALUES('ingested_at',?)",
        ("2026-08-10T00:00:00Z",),
    )
    compact.executemany(
        "INSERT INTO _agg_qoq_filers(filer_id,cik) VALUES(?,?)",
        [(1, "0000000001"), (2, "0000000002")],
    )
    compact.executemany(
        "INSERT INTO _agg_qoq_periods(period_id,period) VALUES(?,?)",
        [
            (1, "2025-12-31"),
            (2, "2026-03-31"),
            (3, "2026-06-30"),
        ],
    )
    rows = []
    for mask in range(32):
        rows.append(
            (
                1 + mask % 2,
                f"sid:code-{mask:02d}",
                mask % 3,
                2 + mask % 2,
                1,
                mask % 5,
                -(2**63) if mask == 0 else (None if mask % 4 == 0 else mask),
                2**63 - 1 if mask == 31 else (None if mask % 5 == 0 else mask + 1),
                None if mask % 3 == 0 else 1,
                None if mask % 4 == 0 else mask,
                None if mask % 5 == 0 else mask + 1,
                None if mask % 6 == 0 else 1,
                mask % 3,
                mask,
            )
        )
    compact.executemany(
        "INSERT INTO _agg_qoq_deltas VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)", rows
    )

    legacy.executescript(
        """
        CREATE TABLE agg_qoq_deltas (
          cik TEXT NOT NULL, position_key TEXT NOT NULL, put_call TEXT NOT NULL,
          curr_period TEXT NOT NULL, prev_period TEXT NOT NULL,
          change_kind TEXT NOT NULL, prev_value_usd INTEGER,
          curr_value_usd INTEGER, delta_value_usd INTEGER, prev_shares INTEGER,
          curr_shares INTEGER, delta_shares INTEGER, ssh_prnamt_type TEXT NOT NULL,
          flags TEXT NOT NULL, ingested_at TEXT NOT NULL,
          PRIMARY KEY(cik,position_key,put_call,ssh_prnamt_type,curr_period)
        );
        """
    )
    public_rows = compact.execute("SELECT * FROM agg_qoq_deltas").fetchall()
    legacy.executemany(
        "INSERT INTO agg_qoq_deltas VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        public_rows,
    )

    columns = [row[1] for row in compact.execute("PRAGMA table_info(agg_qoq_deltas)")]
    order = "cik,position_key,put_call,ssh_prnamt_type,curr_period"
    typed = ",".join(f"typeof({column})" for column in columns)
    assert compact.execute(
        f"SELECT *,{typed} FROM agg_qoq_deltas ORDER BY {order}"  # nosec B608
    ).fetchall() == legacy.execute(
        f"SELECT *,{typed} FROM agg_qoq_deltas ORDER BY {order}"  # nosec B608
    ).fetchall()
    projection = {"agg_qoq_deltas": frozenset({"ingested_at"})}
    with pytest.raises(DigestError, match="safe integer domain"):
        logical_digest(compact, projection)
    with pytest.raises(DigestError, match="safe integer domain"):
        logical_digest(legacy, projection)
    compact.execute(
        "UPDATE _agg_qoq_deltas SET prev_value_usd=?"
        " WHERE position_key='sid:code-00'",
        (-(2**53 - 1),),
    )
    compact.execute(
        "UPDATE _agg_qoq_deltas SET curr_value_usd=?"
        " WHERE position_key='sid:code-31'",
        (2**53 - 1,),
    )
    legacy.execute(
        "UPDATE agg_qoq_deltas SET prev_value_usd=?"
        " WHERE position_key='sid:code-00'",
        (-(2**53 - 1),),
    )
    legacy.execute(
        "UPDATE agg_qoq_deltas SET curr_value_usd=?"
        " WHERE position_key='sid:code-31'",
        (2**53 - 1,),
    )
    assert logical_digest(compact, projection) == logical_digest(legacy, projection)

    assert compact.execute(
        "SELECT type FROM sqlite_master WHERE name='agg_qoq_deltas'"
    ).fetchone() == ("view",)
    backing_sql = compact.execute(
        "SELECT sql FROM sqlite_master WHERE type='table'"
        " AND name='_agg_qoq_deltas'"
    ).fetchone()[0]
    assert "WITHOUT ROWID" in backing_sql.upper()
    assert compact.execute(
        "SELECT filer_id,cik FROM _agg_qoq_filers ORDER BY filer_id"
    ).fetchall() == [(1, "0000000001"), (2, "0000000002")]
    assert {row[0] for row in compact.execute(
        "SELECT DISTINCT change_kind FROM agg_qoq_deltas"
    )} == {"new", "add", "trim", "exit", "unclassified"}
    with pytest.raises(sqlite3.OperationalError, match="view"):
        compact.execute("UPDATE agg_qoq_deltas SET change_kind='new'")
    with pytest.raises(sqlite3.IntegrityError, match="CHECK"):
        compact.execute(
            "INSERT INTO _agg_qoq_deltas VALUES(1,'sid:bad-code',3,2,1,0,"
            "NULL,NULL,NULL,NULL,NULL,NULL,0,0)"
        )
    with pytest.raises(sqlite3.IntegrityError, match="CHECK"):
        compact.execute(
            "INSERT INTO _agg_qoq_deltas VALUES(1,'sid:bad-mask',0,2,1,0,"
            "NULL,NULL,NULL,NULL,NULL,NULL,0,32)"
        )
    compact.close()
    legacy.close()


def test_inst_logical_digest_null_concentration_distinct_from_zero(inst_agg_conn):
    agg, _out = inst_agg_conn
    # A NULL HHI (concentration unavailable) must digest differently from a real 0.
    agg.execute("UPDATE agg_filer_concentration SET hhi = NULL")
    null_digest = logical_digest(agg, LOGICAL_PROJECTIONS["inst"])
    agg.execute("UPDATE agg_filer_concentration SET hhi = 0")
    zero_digest = logical_digest(agg, LOGICAL_PROJECTIONS["inst"])
    assert null_digest != zero_digest


def test_inst_logical_digest_congress_projection_is_disjoint(inst_agg_conn):
    agg, _out = inst_agg_conn
    # The congress projection's tables are absent from inst_agg.db — a defect.
    with pytest.raises(DigestError, match="projection table missing"):
        logical_digest(agg)  # default = congress projection


# --- journal round-trip (R35) -------------------------------------------------


def test_journal_round_trip_reproduces_exact_bytes(tmp_path):
    db = seed_db(tmp_path / "populus.db")
    repo = make_repo(tmp_path)
    report = run_build(db, repo, now=pin(), backend=LocalDirBackend(repo))
    staged = repo / STAGING_DIR / report.build_id
    journal_bytes = (staged / "journal.json").read_bytes()
    assert journal_valid(journal_bytes)
    journal = journal_load(journal_bytes)

    # The inlined DB bytes ARE the snapshot, exactly.
    db_bytes = journal_db_bytes(journal)
    assert hashlib.sha256(db_bytes).hexdigest() == journal["db"]["sha256"]
    assert db_bytes == (staged / "assets" / "congress.db").read_bytes()
    assert journal["db"]["logical_digest"] == report.logical_digest

    # Materialization reproduces every small artifact byte for byte,
    # including created_at-bearing files (stats.json, manifest.json).
    dest = tmp_path / "materialized"
    build_id = materialize_from_journal(journal_bytes, dest)
    assert build_id == report.build_id
    staged_build = staged / "build"
    staged_files = sorted(
        p.relative_to(staged_build).as_posix()
        for p in staged_build.rglob("*")
        if p.is_file()
    )
    materialized_files = sorted(
        p.relative_to(dest / build_id).as_posix()
        for p in (dest / build_id).rglob("*")
        if p.is_file()
    )
    assert staged_files == materialized_files
    for relpath in staged_files:
        assert (dest / build_id / relpath).read_bytes() == (
            staged_build / relpath
        ).read_bytes(), relpath

    # Deterministic rendering: rebuilding the journal from the same staged
    # tree yields identical bytes.
    manifest = json.loads(journal["artifacts"]["manifest.json"])
    rebuilt = build_journal(staged, manifest, staged / "assets" / "congress.db")
    assert rebuilt == journal_bytes


def test_journal_rejects_tampered_db_and_artifacts(tmp_path):
    db = seed_db(tmp_path / "populus.db")
    repo = make_repo(tmp_path)
    report = run_build(db, repo, now=pin(), backend=LocalDirBackend(repo))
    journal_bytes = (
        repo / STAGING_DIR / report.build_id / "journal.json"
    ).read_bytes()
    journal = json.loads(journal_bytes.decode("utf-8"))

    tampered_db = dict(journal)
    # Flip the head of the inlined DB (the SQLite header bytes) — the tail is
    # zero-padded pages whose base64 is already all 'A's.
    tampered_db["db"] = dict(
        journal["db"], b64="AAAAAAAA" + journal["db"]["b64"][8:]
    )
    assert not journal_valid(json.dumps(tampered_db).encode("utf-8"))

    tampered_artifact = json.loads(journal_bytes.decode("utf-8"))
    tampered_artifact["artifacts"]["NOTICE"] += "tampered\n"
    assert not journal_valid(json.dumps(tampered_artifact).encode("utf-8"))

    partial = json.loads(journal_bytes.decode("utf-8"))
    del partial["artifacts"]["congress/stats.json"]
    assert not journal_valid(json.dumps(partial).encode("utf-8"))


# --- path safety (R29) --------------------------------------------------------


@pytest.mark.parametrize(
    "locator",
    [
        "/etc/passwd",
        "..",
        "../outside.json",
        "builds/../../outside.json",
        "builds\\20260101.1\\manifest.json",
        "builds//manifest.json",
        "builds/./manifest.json",
        "builds/\x01/manifest.json",
        "",
        ".hidden/file.json",
    ],
)
def test_validate_locator_rejects(locator):
    assert validate_locator(locator) != []


@pytest.mark.parametrize(
    "locator",
    [
        "latest.json",
        "builds/20260723.1/manifest.json",
        "builds/20260723.1/congress/feed.json",
        "releases/data-20260723.1/congress.db",
    ],
)
def test_validate_locator_accepts(locator):
    assert validate_locator(locator) == []


def test_resolve_within_contains_and_rejects_escapes(tmp_path):
    root = tmp_path / "root"
    (root / "builds").mkdir(parents=True)
    (root / "builds" / "ok.json").write_text("{}")
    assert resolve_within(root, "builds/ok.json").read_text() == "{}"
    for bad in ("../outside", "/abs", "a/../../b"):
        with pytest.raises(UnsafeArchivePathError):
            resolve_within(root, bad)
    # Symlink escape: the grammar passes but resolution leaves the root.
    outside = tmp_path / "outside"
    outside.mkdir()
    (outside / "secret.json").write_text("{}")
    (root / "link").symlink_to(outside, target_is_directory=True)
    with pytest.raises(UnsafeArchivePathError):
        resolve_within(root, "link/secret.json")


@pytest.mark.parametrize(
    "name,ok",
    [
        ("congress.db", True),
        ("congress/feed.json", True),
        ("DATA-LICENSE.md", True),
        ("NOTICE", True),
        ("congress/members/D000001.json", True),
        ("BRK.B", True),
        ("--", False),
        (".hidden", False),
        ("a/../b", False),
        ("a b", False),
        ("", False),
        ("a\\b", False),
        (None, False),
    ],
)
def test_safe_artifact_name(name, ok):
    assert safe_artifact_name(name) is ok


def test_sha256_file_streams(tmp_path):
    target = tmp_path / "blob.bin"
    target.write_bytes(b"populus" * 100_000)
    assert sha256_file(target) == hashlib.sha256(b"populus" * 100_000).hexdigest()
