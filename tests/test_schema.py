"""Schema exactness (§9.4), per-constraint enforcement, and the CLI surface."""

from __future__ import annotations

import importlib.metadata
import importlib.resources
import re
import sqlite3
from pathlib import Path

import pytest
from click.testing import CliRunner

import populus
from populus.cli import main as cli_main
from populus.db import connect, json1_supported

REPO_ROOT = Path(__file__).resolve().parent.parent

ALL_TABLES = {"members", "member_aliases", "filings", "transactions", "ingest_runs"}

# A minimal valid transactions row; tests override one column at a time so each
# failure isolates exactly one constraint.
VALID_TXN = {
    "txn_id": "house:1:aabbccddeeff00112233445566778899",
    "filing_id": None,  # set per call
    "raw_row": '{"asset_name":"Apple Inc"}',
    "row_fingerprint": "ab" * 32,
    "dup_seq": 1,
    "row_ordinal": 1,
    "chamber": "house",
    "asset_name": "Apple Inc",
    "side": "purchase",
    "filed_date": "2026-01-10",
    "flags": "[]",
    "source": "house-clerk",
    "license_id": "us-congress-disclosures",
}


def _insert_txn(conn, filing_id, **overrides):
    row = dict(VALID_TXN, filing_id=filing_id, **overrides)
    columns = ", ".join(row)
    placeholders = ", ".join("?" for _ in row)
    conn.execute(
        f"INSERT INTO transactions ({columns}) VALUES ({placeholders})",
        tuple(row.values()),
    )


def _insert_member(conn, bioguide_id="D000001", chamber="house"):
    conn.execute(
        "INSERT INTO members (bioguide_id, full_name, chamber, terms, raw)"
        " VALUES (?, ?, ?, ?, ?)",
        (bioguide_id, "Jane Doe", chamber, "[]", "{}"),
    )


def _insert_alias(conn, **overrides):
    values = dict(
        alias="doe jane",
        chamber="house",
        state="CA",
        district="12",
        valid_from="2025-01-03",
        valid_to=None,
        bioguide_id="D000001",
        note="seed mapping",
    )
    values.update(overrides)
    conn.execute(
        "INSERT INTO member_aliases (alias, chamber, state, district,"
        " valid_from, valid_to, bioguide_id, note)"
        " VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        tuple(values.values()),
    )


def _combined_output(result):
    # Click versions differ on whether Result.output already includes stderr;
    # append it only when it isn't already there.
    output = result.output
    try:
        stderr = result.stderr
    except (AttributeError, ValueError):
        stderr = ""
    if stderr and stderr not in output:
        output += stderr
    return output


# --- exact-DDL transcription ------------------------------------------------


def _architecture_ddl() -> str:
    text = (REPO_ROOT / "ARCHITECTURE.md").read_text(encoding="utf-8")
    blocks = re.findall(r"```sql\n(.*?)```", text, flags=re.DOTALL)
    matches = [
        block
        for block in blocks
        if "CREATE TABLE members" in block and "CREATE TABLE ingest_runs" in block
    ]
    assert len(matches) == 1, "expected exactly one §9.4 DDL block in ARCHITECTURE.md"
    return matches[0]


def _normalized(sql: str) -> str:
    lines = sql.replace("\r\n", "\n").split("\n")
    return "\n".join(line.rstrip() for line in lines).strip()


def test_schema_sql_matches_architecture_exactly():
    packaged = (
        importlib.resources.files("populus")
        .joinpath("schema.sql")
        .read_text(encoding="utf-8")
    )
    assert _normalized(packaged) == _normalized(_architecture_ddl())


def test_init_creates_all_tables_and_alias_index(initialized_db):
    tables = {
        name
        for (name,) in initialized_db.execute(
            "SELECT name FROM sqlite_master WHERE type = 'table'"
        )
    }
    assert ALL_TABLES <= tables
    index = initialized_db.execute(
        "SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'alias_no_overlap'"
    ).fetchone()
    assert index is not None


def test_json1_supported(initialized_db):
    assert json1_supported(initialized_db) is True


# --- per-constraint behavioral proofs ---------------------------------------


def test_raw_row_invalid_json_rejected(initialized_db, make_filing):
    fid = make_filing(initialized_db)
    with pytest.raises(sqlite3.IntegrityError):
        _insert_txn(initialized_db, fid, raw_row="not json")


def test_raw_row_non_object_rejected(initialized_db, make_filing):
    fid = make_filing(initialized_db)
    with pytest.raises(sqlite3.IntegrityError):
        _insert_txn(initialized_db, fid, raw_row="[1, 2]")


def test_flags_non_array_rejected(initialized_db, make_filing):
    fid = make_filing(initialized_db)
    with pytest.raises(sqlite3.IntegrityError):
        _insert_txn(initialized_db, fid, flags='{"a": 1}')


@pytest.mark.parametrize("column", ["is_late", "cap_gains_over_200"])
def test_boolean_checks_reject_non_boolean(initialized_db, make_filing, column):
    fid = make_filing(initialized_db)
    with pytest.raises(sqlite3.IntegrityError):
        _insert_txn(initialized_db, fid, **{column: 2})


def test_side_enum_rejected(initialized_db, make_filing):
    fid = make_filing(initialized_db)
    with pytest.raises(sqlite3.IntegrityError):
        _insert_txn(initialized_db, fid, side="buy")


@pytest.mark.parametrize(
    "column,value",
    [
        ("parse_status", "ok"),
        ("lifecycle", "dead"),
        ("chamber", "governor"),
        ("source", "quiverquant"),
    ],
)
def test_filings_enum_checks_rejected(initialized_db, make_filing, column, value):
    with pytest.raises(sqlite3.IntegrityError):
        make_filing(initialized_db, **{column: value})


def test_members_chamber_enum_rejected(initialized_db):
    with pytest.raises(sqlite3.IntegrityError):
        _insert_member(initialized_db, chamber="governor")


def test_foreign_keys_enforced(initialized_db):
    # This test fails if connect() ever stops setting PRAGMA foreign_keys=ON:
    # SQLite would then accept the orphan row.
    assert initialized_db.execute("PRAGMA foreign_keys").fetchone()[0] == 1
    with pytest.raises(sqlite3.IntegrityError):
        _insert_txn(initialized_db, "house:absent")
    with pytest.raises(sqlite3.IntegrityError):
        _insert_alias(initialized_db, bioguide_id="B999999")


def test_identity_unique_constraint(initialized_db, make_filing):
    fid = make_filing(initialized_db)
    _insert_txn(initialized_db, fid)
    with pytest.raises(sqlite3.IntegrityError):
        _insert_txn(initialized_db, fid, txn_id="house:1:different0000000000000000000000")


def test_alias_no_overlap_rejects_duplicate(initialized_db):
    # SQLite unique indexes treat NULLs as distinct, so two alias rows
    # differing only in NULL state/district both insert; the full
    # temporal-overlap invariant is members.alias_overlap_errors, tested
    # below and over the packaged alias file (ARCHITECTURE.md §9.4).
    _insert_member(initialized_db)
    _insert_alias(initialized_db)
    with pytest.raises(sqlite3.IntegrityError):
        _insert_alias(initialized_db, note="identical key tuple")


def test_alias_temporal_overlap_is_a_defect(initialized_db):
    # The §9.4 invariant the unique index cannot express: two applicable
    # rows for one (alias, date) — via NULL disambiguators or overlapping
    # windows — are a defect caught by members.alias_overlap_errors.
    from populus.members import alias_overlap_errors

    _insert_member(initialized_db)
    _insert_alias(initialized_db, valid_from="2025-01-03", valid_to=None)
    _insert_alias(
        initialized_db,
        state=None,
        district=None,
        valid_from="2026-01-01",
        note="overlaps the open-ended row via NULL disambiguators",
    )
    errors = alias_overlap_errors(initialized_db)
    assert len(errors) == 1
    assert "overlap" in errors[0]

    # Disjoint windows are not a defect.
    initialized_db.execute("DELETE FROM member_aliases")
    _insert_alias(initialized_db, valid_from="2020-01-01", valid_to="2022-01-01")
    _insert_alias(
        initialized_db, valid_from="2022-01-01", note="starts where the first ends"
    )
    assert alias_overlap_errors(initialized_db) == []


def test_packaged_alias_file_has_no_overlaps(initialized_db):
    # The live seed file must satisfy its own invariant. Loading requires
    # the referenced members to exist; synthesize them from the file.
    import yaml

    from populus.members import (
        alias_overlap_errors,
        default_aliases_text,
        load_aliases,
    )

    entries = (yaml.safe_load(default_aliases_text()) or {}).get("aliases") or []
    for bioguide_id in {entry["bioguide_id"] for entry in entries}:
        _insert_member(initialized_db, bioguide_id=bioguide_id)
    load_aliases(initialized_db)
    assert alias_overlap_errors(initialized_db) == []


def test_init_creates_default_and_pair_views(initialized_db):
    views = {
        name
        for (name,) in initialized_db.execute(
            "SELECT name FROM sqlite_master WHERE type = 'view'"
        )
    }
    assert {"v_default_transactions", "v_amendment_pairs"} <= views


@pytest.mark.parametrize("column", ["filer_name_raw", "source"])
def test_filings_not_null_enforced(initialized_db, make_filing, column):
    with pytest.raises(sqlite3.IntegrityError):
        make_filing(initialized_db, **{column: None})


@pytest.mark.parametrize("column", ["asset_name", "chamber"])
def test_transactions_not_null_enforced(initialized_db, make_filing, column):
    fid = make_filing(initialized_db)
    with pytest.raises(sqlite3.IntegrityError):
        _insert_txn(initialized_db, fid, **{column: None})


# --- packaging identity (R1) ------------------------------------------------


def test_distribution_identity():
    assert importlib.metadata.version("populus-mcp") == "0.0.1"
    assert populus.__version__ == "0.0.1"


# --- CLI: db init -----------------------------------------------------------


def test_cli_db_init_creates_schema(tmp_path):
    target = tmp_path / "t.db"
    result = CliRunner().invoke(cli_main, ["db", "init", str(target)])
    assert result.exit_code == 0, _combined_output(result)
    conn = connect(str(target))
    tables = {
        name
        for (name,) in conn.execute("SELECT name FROM sqlite_master WHERE type = 'table'")
    }
    conn.close()
    assert ALL_TABLES <= tables


def test_cli_db_init_refuses_already_initialized(tmp_path):
    target = tmp_path / "t.db"
    runner = CliRunner()
    assert runner.invoke(cli_main, ["db", "init", str(target)]).exit_code == 0
    result = runner.invoke(cli_main, ["db", "init", str(target)])
    combined = _combined_output(result)
    assert result.exit_code == 1
    assert "Traceback" not in combined
    assert len(combined.strip().splitlines()) == 1


def test_cli_db_init_unopenable_target(tmp_path):
    blocker = tmp_path / "afile"
    blocker.write_text("a regular file, not a directory")
    result = CliRunner().invoke(cli_main, ["db", "init", str(blocker / "db.sqlite")])
    combined = _combined_output(result)
    assert result.exit_code != 0
    assert "Traceback" not in combined
    assert len(combined.strip().splitlines()) == 1


# --- CLI: full §5.3 surface and stubs ---------------------------------------


def test_cli_help_lists_all_eight_commands():
    result = CliRunner().invoke(cli_main, ["--help"])
    assert result.exit_code == 0
    for command in (
        "db",
        "ingest",
        "reparse",
        "build",
        "publish",
        "verify",
        "stats",
        "backfill-audit",
    ):
        assert command in result.output


def test_reparse_help_shows_selectors():
    result = CliRunner().invoke(cli_main, ["reparse", "--help"])
    assert result.exit_code == 0
    for option in ("--filing", "--since", "--parser-version"):
        assert option in result.output


def test_publish_help_shows_dry_run():
    result = CliRunner().invoke(cli_main, ["publish", "--help"])
    assert result.exit_code == 0
    assert "--dry-run" in result.output


# All §5.3 commands are implemented (house/senate RUNs 2–3, backfill/members
# RUN 4, build/publish/verify RUN 5); each validates its option surface.
@pytest.mark.parametrize(
    "args,needed",
    [
        (["ingest", "congress-backfill"], "--db"),
        (["ingest", "congress-backfill", "--db", "x.db"], "--from-cache"),
        (["ingest", "members"], "--db"),
        (["ingest", "members", "--db", "x.db"], "--from-cache"),
    ],
)
def test_run4_ingest_jobs_validate_options(args, needed):
    result = CliRunner().invoke(cli_main, args)
    assert result.exit_code == 2
    assert needed in _combined_output(result)


def test_members_only_options_rejected_for_other_jobs(tmp_path):
    aliases = tmp_path / "aliases.yaml"
    aliases.write_text("aliases: []\n")
    result = CliRunner().invoke(
        cli_main,
        ["ingest", "congress-house", "--db", "x.db", "--aliases", str(aliases)],
    )
    assert result.exit_code == 2
    assert "apply only to ingest members" in _combined_output(result)


def test_stats_requires_db_option():
    result = CliRunner().invoke(cli_main, ["stats"])
    assert result.exit_code == 2
    assert "--db" in _combined_output(result)


# The RUN-5 pipeline commands are implemented; with missing prerequisites
# they fail cleanly (ClickException, no traceback), never with a stub.
@pytest.mark.parametrize(
    "args",
    [
        ["build", "--db", "absent.db", "--data-repo", "absent-repo"],
        ["publish", "--data-repo", "absent-repo"],
        ["publish", "--dry-run", "--data-repo", "absent-repo"],
        ["verify", "--data-repo", "absent-repo"],
    ],
)
def test_pipeline_commands_fail_cleanly_without_prerequisites(args, tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    result = CliRunner().invoke(cli_main, args)
    assert result.exit_code == 1
    assert not isinstance(result.exception, NotImplementedError)
    assert "Traceback" not in _combined_output(result)
    assert "Error" in _combined_output(result)


@pytest.mark.parametrize(
    "selectors",
    [
        ["--filing", "house:1", "--since", "2026-01-01"],
        ["--filing", "house:1", "--parser-version", "v1"],
        ["--since", "2026-01-01", "--parser-version", "v1"],
        ["--filing", "house:1", "--since", "2026-01-01", "--parser-version", "v1"],
    ],
)
def test_reparse_selectors_mutually_exclusive(selectors):
    result = CliRunner().invoke(cli_main, ["reparse", "congress-house", *selectors])
    assert result.exit_code == 2
    assert "mutually exclusive" in _combined_output(result)
