"""R27 acceptance-script contracts: preflight rigour and period authority.

The acceptance command itself cannot run in CI — it needs a wired institutional
build no local release carries (see the run's Dev Notes). Its two decision
functions can and must be tested directly, because both were review findings:

- F8: preflight checked `Path.exists()` and then printed that everything was
  readable. An unreadable database passed and failed later, unnamed.
- F9: closure was decided from the reviewer's wall clock, over a period universe
  derived from non-empty adds rows — so a quiet newest quarter was skipped in
  favour of an older busy one, certifying a quarter the page does not lead with.
"""

from __future__ import annotations

import importlib.util
import json
import os
import sqlite3
import sys
from datetime import date, timedelta
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parent.parent


def _load():
    spec = importlib.util.spec_from_file_location(
        "accept_alpha_surfaces_v2", REPO_ROOT / "scripts" / "acceptance" / "surfaces.py"
    )
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


accept = _load()


# --------------------------------------------------------------------------
# F8 — preflight validates the contract each argument actually has
# --------------------------------------------------------------------------


def test_preflight_passes_when_every_artifact_is_usable(tmp_path):
    build = tmp_path / "build"
    build.mkdir()
    db = tmp_path / "inst.db"
    db.write_bytes(b"x")
    assert accept.preflight({"--build-dir": (build, "dir"), "--inst-db": (db, "file")}) == []


def test_preflight_names_every_failing_flag_not_just_the_first(tmp_path):
    """An operator with three wrong arguments must learn all three at once."""
    problems = accept.preflight(
        {
            "--build-dir": (tmp_path / "nope", "dir"),
            "--congress-db": (tmp_path / "absent.db", "file"),
            "--inst-db": (tmp_path / "also-absent.db", "file"),
        }
    )
    assert len(problems) == 3
    joined = " ; ".join(problems)
    for flag in ("--build-dir", "--congress-db", "--inst-db"):
        assert flag in joined


def test_preflight_rejects_an_existing_but_unreadable_file(tmp_path):
    """EXISTENCE IS NOT READABILITY — the exact F8 defect."""
    db = tmp_path / "inst.db"
    db.write_bytes(b"x")
    os.chmod(db, 0o000)
    try:
        if os.access(db, os.R_OK):  # running as root: the mode bits do not bind
            pytest.skip("process can read mode-000 files; the check cannot be exercised")
        problems = accept.preflight({"--inst-db": (db, "file")})
        assert problems == [f"--inst-db={db} is not readable"]
    finally:
        os.chmod(db, 0o600)


def test_preflight_rejects_a_directory_passed_as_a_database(tmp_path):
    d = tmp_path / "looks-like-a-db"
    d.mkdir()
    assert accept.preflight({"--inst-db": (d, "file")}) == [
        f"--inst-db={d} is a directory, not a file"
    ]


def test_preflight_rejects_a_file_passed_as_the_build_dir(tmp_path):
    f = tmp_path / "not-a-dir"
    f.write_text("")
    assert accept.preflight({"--build-dir": (f, "dir")}) == [
        f"--build-dir={f} is not a directory"
    ]


def test_preflight_rejects_a_non_traversable_build_dir(tmp_path):
    """Readable but not executable: it lists, then fails on every open."""
    d = tmp_path / "build"
    d.mkdir()
    os.chmod(d, 0o400)
    try:
        if os.access(d, os.R_OK | os.X_OK):
            pytest.skip("process ignores directory mode bits")
        assert accept.preflight({"--build-dir": (d, "dir")}) == [
            f"--build-dir={d} is not readable and traversable"
        ]
    finally:
        os.chmod(d, 0o700)


# --------------------------------------------------------------------------
# F9 — the build's own date, and the selector's own period universe
# --------------------------------------------------------------------------


def _build_with_generated_at(tmp_path: Path, generated_at) -> Path:
    build = tmp_path / "build"
    (build / "congress").mkdir(parents=True)
    payload = {} if generated_at is None else {"generated_at": generated_at}
    (build / "congress" / "stats.json").write_text(json.dumps(payload))
    return build


def test_build_date_comes_from_the_builds_own_stats_json(tmp_path):
    build = _build_with_generated_at(tmp_path, "2026-08-12T06:17:00Z")
    assert accept.build_generated_date(build) == ("2026-08-12", None)


def test_build_date_is_refused_rather_than_guessed(tmp_path):
    build = _build_with_generated_at(tmp_path, None)
    value, why = accept.build_generated_date(build)
    assert value is None
    assert "generated_at" in why

    missing = tmp_path / "empty"
    missing.mkdir()
    value, why = accept.build_generated_date(missing)
    assert value is None
    assert "does not exist" in why


def _conn_with(periods_concentration, periods_adds=(), periods_exclusions=()):
    conn = sqlite3.connect(":memory:")
    conn.execute("CREATE TABLE agg_filer_concentration (period_of_report TEXT)")
    conn.execute("CREATE TABLE agg_issuer_adds (period_of_report TEXT, mode TEXT)")
    conn.execute("CREATE TABLE agg_issuer_adds_exclusions (period_of_report TEXT, mode TEXT)")
    conn.executemany(
        "INSERT INTO agg_filer_concentration VALUES (?)", [(p,) for p in periods_concentration]
    )
    conn.executemany(
        "INSERT INTO agg_issuer_adds VALUES (?, 'all')", [(p,) for p in periods_adds]
    )
    conn.executemany(
        "INSERT INTO agg_issuer_adds_exclusions VALUES (?, 'all')",
        [(p,) for p in periods_exclusions],
    )
    return conn


def test_selector_periods_offers_a_quiet_quarter_the_adds_rows_never_mention():
    """The F9 defect exactly: 2025-12-31 is closed and on record, but nothing
    was added in it. Deriving the universe from adds rows skipped it and
    certified 2025-09-30 instead — a quarter the page does not lead with."""
    conn = _conn_with(
        periods_concentration=["2025-06-30", "2025-09-30", "2025-12-31"],
        periods_adds=["2025-06-30", "2025-09-30"],
    )
    assert accept.selector_periods(conn, "2026-08-12") == [
        "2025-12-31",
        "2025-09-30",
        "2025-06-30",
    ]


def test_selector_periods_never_offers_an_open_quarter():
    """Strictly after the 45-day deadline, measured against the BUILD date."""
    period = "2026-06-30"
    deadline = date.fromisoformat(period) + timedelta(days=accept.FILING_DEADLINE_DAYS)
    conn = _conn_with(periods_concentration=[period])
    assert accept.selector_periods(conn, deadline.isoformat()) == []
    assert accept.selector_periods(conn, (deadline + timedelta(days=1)).isoformat()) == [period]


def test_selector_periods_uses_the_build_date_not_the_wall_clock():
    """Replaying an old build must certify the quarters THAT build offered."""
    conn = _conn_with(periods_concentration=["2024-12-31", "2025-03-31", "2025-06-30"])
    # As of a 2025-06-01 build only the two older quarters had closed, even
    # though every one of them is long closed by any present-day clock.
    assert accept.selector_periods(conn, "2025-06-01") == ["2025-03-31", "2024-12-31"]


def test_selector_periods_caps_at_the_selectors_declared_cardinality():
    conn = _conn_with(
        periods_concentration=["2024-09-30", "2024-12-31", "2025-03-31", "2025-06-30"]
    )
    offered = accept.selector_periods(conn, "2026-08-12")
    assert len(offered) == accept.ADDS_PERIOD_COUNT == 3
    assert offered[0] == "2025-06-30"


def test_selector_periods_tolerates_a_missing_relation():
    conn = sqlite3.connect(":memory:")
    conn.execute("CREATE TABLE agg_issuer_adds (period_of_report TEXT, mode TEXT)")
    conn.execute("INSERT INTO agg_issuer_adds VALUES ('2025-03-31', 'all')")
    assert accept.selector_periods(conn, "2026-08-12") == ["2025-03-31"]
