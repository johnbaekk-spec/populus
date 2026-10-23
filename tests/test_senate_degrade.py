"""Senate eFD degraded publish (PLAN: Senate eFD degraded publish).

Since 2026-10-23 the eFD edge answers the agreement POST with an Akamai 403.
These tests pin the policy that lets the nightly publish DEGRADE instead of
failing, and every boundary that must still fail:

- a blocked run under ``--degrade-on-block`` exits 0 with a marker and leaves
  the seeded Senate rows untouched (control: the same run without the flag
  exits 1);
- a parse failure or a malformed index still exits 1 with the flag (control:
  the same store with a refused agreement exits 0);
- past the staleness bound a blocked run fails (control: inside it, it passes);
- ``stats.json`` reports the degraded state only while the newest Senate run is
  blocked, and every published count equals the seed's.

Everything runs through the real CLI over the offline fake transport; the
autouse socket guard proves nothing reaches the network.
"""

from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from pathlib import Path

import jsonschema
import pytest
from click.testing import CliRunner

from populus.cli import main as cli_main
from populus.db import connect
from populus.ingest import senate
from populus.ingest.senate import DATA_URL, HOME_URL
from populus.stats import compute_stats, senate_degraded_state
from test_senate_ingest import (
    EFILE_1ROW,
    FakeSenateTransport,
    U1,
    U2,
    _doc_url,
    _index_row,
    _make_cache,
    _resp,
    _route_handshake,
)

SCHEMA = json.loads(
    (Path(__file__).parent / "schemas" / "stats.schema.json").read_text()
)
NOW = lambda: "2026-10-23T12:00:00Z"  # noqa: E731


# --- helpers -----------------------------------------------------------------


def _cli(args, monkeypatch=None, transport=None):
    if transport is not None:
        import time as time_module

        monkeypatch.setattr(senate, "HttpxSenateTransport", lambda: transport)
        monkeypatch.setattr(time_module, "sleep", lambda _s: None)
    return CliRunner().invoke(cli_main, args)


@pytest.fixture
def seeded(tmp_path):
    """A store that already holds one good Senate filing from an `ok` run —
    the shape `seed-corpus` hands the nightly ingest (the previous release's
    congress.db, ingest_runs included)."""
    db = tmp_path / "populus.db"
    cache = _make_cache(
        tmp_path, [_index_row(U1)], {f"ptr_{U1}.html": EFILE_1ROW}
    )
    result = _cli(
        ["ingest", "congress-senate", "--db", str(db), "--from-cache", str(cache)]
    )
    assert result.exit_code == 0, result.output
    return db


def _set_last_ok_age(db: Path, days: float) -> None:
    finished = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
    conn = connect(str(db))
    try:
        conn.execute(
            "UPDATE ingest_runs SET started_at = ?, finished_at = ?"
            " WHERE job = 'congress-senate' AND status = 'ok'",
            (finished, finished),
        )
        conn.commit()
    finally:
        conn.close()


def _senate_snapshot(db: Path):
    conn = connect(str(db))
    try:
        filings = conn.execute(
            "SELECT filing_id, parse_status, raw_path, response_hash FROM filings"
            " WHERE chamber = 'senate' ORDER BY filing_id"
        ).fetchall()
        rows = conn.execute(
            "SELECT filing_id, row_ordinal, ticker, amount_low, amount_high"
            " FROM transactions WHERE filing_id LIKE 'senate:%'"
            " ORDER BY filing_id, row_ordinal"
        ).fetchall()
        return filings, rows
    finally:
        conn.close()


def _statuses(db: Path) -> list[str]:
    conn = connect(str(db))
    try:
        return [
            status
            for (status,) in conn.execute(
                "SELECT status FROM ingest_runs WHERE job = 'congress-senate'"
                " ORDER BY started_at, run_id"
            )
        ]
    finally:
        conn.close()


def _blocked_transport(status=403):
    """The 2026-10-23 shape: home 200 from gunicorn, agreement refused."""
    transport = FakeSenateTransport()
    _route_handshake(transport, agreement_status=status)
    return transport


def _live(db, raw, *extra):
    return [
        "ingest", "congress-senate", "--db", str(db), "--raw-root", str(raw), *extra
    ]


# --- classification (R1) -------------------------------------------------------


def _home(status):
    def setup(t):
        t.route("GET", HOME_URL, _resp(status))
    return setup


def _agreement(status):
    def setup(t):
        _route_handshake(t, agreement_status=status)
    return setup


def _index(status, body=b""):
    def setup(t):
        _route_handshake(t)
        t.route("POST", DATA_URL, _resp(status, body))
    return setup


@pytest.mark.parametrize(
    ("setup", "blocked"),
    [
        (_home(403), True),
        (_home(500), True),
        (_home(senate.TRANSPORT_FAILURE_STATUS), True),
        (_agreement(403), True),
        (_agreement(200), True),
        (_index(403), True),
        (_index(503), True),
        # malformed answers: protocol changes, never degraded
        (lambda t: t.route("GET", HOME_URL, _resp(200, b"<html>no form</html>")), False),
        (_index(200, b"not json"), False),
        (_index(200, json.dumps({"data": []}).encode()), False),
    ],
)
def test_blocked_classification(tmp_path, setup, blocked):
    transport = FakeSenateTransport()
    setup(transport)
    session = senate._PoliteSession(
        transport, sleep=lambda _s: None, monotonic=lambda: 0.0, jitter=lambda: 0.0
    )
    result = senate.discover(
        raw_root=tmp_path / "raw", session=session, submitted_start_date="01/01/2026"
    )
    assert result.failed is True
    assert result.blocked is blocked


def test_cache_failures_are_never_blocked(tmp_path):
    empty = tmp_path / "cache"
    empty.mkdir()
    result = senate.discover(cache_dir=empty)
    assert result.failed is True and result.blocked is False


# --- exit policy (R2, R3) ------------------------------------------------------


def test_cli_blocked_with_flag_exits_zero_and_keeps_rows(seeded, tmp_path, monkeypatch):
    before = _senate_snapshot(seeded)
    assert before[0], "the seed must carry a Senate filing for this to prove anything"
    result = _cli(
        _live(seeded, tmp_path / "raw", "--degrade-on-block"),
        monkeypatch,
        _blocked_transport(),
    )
    assert result.exit_code == 0, result.output
    assert senate.DEGRADED_MARKER in result.output
    assert "agreement not accepted (HTTP 403" in result.output
    assert "bound is 14 days" in result.output
    assert "Senate filings through 2026-07-02" in result.output
    assert _senate_snapshot(seeded) == before
    assert _statuses(seeded) == ["ok", "blocked"]


def test_cli_blocked_without_flag_exits_one(seeded, tmp_path, monkeypatch):
    # Control: identical store and transport, no flag — today's behaviour.
    result = _cli(_live(seeded, tmp_path / "raw"), monkeypatch, _blocked_transport())
    assert result.exit_code == 1, result.output
    assert senate.DEGRADED_MARKER not in result.output
    assert _statuses(seeded) == ["ok", "blocked"]


# --- the staleness bound (R4) --------------------------------------------------


@pytest.mark.parametrize(("age_days", "exit_code"), [(13, 0), (15, 1)])
def test_cli_degrade_refused_past_bound(seeded, tmp_path, monkeypatch, age_days, exit_code):
    _set_last_ok_age(seeded, age_days)
    result = _cli(
        _live(seeded, tmp_path / "raw", "--degrade-on-block"),
        monkeypatch,
        _blocked_transport(),
    )
    assert result.exit_code == exit_code, result.output
    if exit_code:
        assert senate.DEGRADE_REFUSED_MARKER in result.output
        assert "past the 14-day bound" in result.output
        assert senate.DEGRADED_MARKER not in result.output
    else:
        assert senate.DEGRADED_MARKER in result.output


def test_cli_max_staleness_days_overrides_the_default(seeded, tmp_path, monkeypatch):
    _set_last_ok_age(seeded, 3)
    result = _cli(
        _live(seeded, tmp_path / "raw", "--degrade-on-block", "--max-staleness-days", "2"),
        monkeypatch,
        _blocked_transport(),
    )
    assert result.exit_code == 1, result.output
    assert "past the 2-day bound" in result.output


def test_cli_degrade_refused_without_ok_run(tmp_path, monkeypatch):
    result = _cli(
        _live(tmp_path / "fresh.db", tmp_path / "raw", "--degrade-on-block"),
        monkeypatch,
        _blocked_transport(),
    )
    assert result.exit_code == 1, result.output
    assert "no successful Senate ingest is on record" in result.output


def test_max_staleness_days_requires_the_flag(tmp_path):
    result = _cli(
        _live(tmp_path / "x.db", tmp_path / "raw", "--max-staleness-days", "3")
    )
    assert result.exit_code == 2
    assert "requires --degrade-on-block" in result.output


# --- non-blocked failures still fail (R5) ------------------------------------


def test_cli_parse_failure_exits_one_with_flag(seeded, tmp_path, monkeypatch):
    # A page with no transactions table is a parse failure (missing_table).
    transport = FakeSenateTransport()
    _route_handshake(transport, [_index_row(U2, filed="10/20/2026")])
    transport.route(
        "GET", _doc_url("ptr", U2), _resp(200, b"<html><body>no table</body></html>")
    )
    result = _cli(
        _live(seeded, tmp_path / "raw", "--degrade-on-block"), monkeypatch, transport
    )
    assert result.exit_code == 1, result.output
    assert "SENATE DEGRADE" not in result.output


def test_cli_malformed_index_exits_one_with_flag(seeded, tmp_path, monkeypatch):
    transport = FakeSenateTransport()
    _route_handshake(transport)
    transport.route("POST", DATA_URL, _resp(200, b"this is not json"))
    result = _cli(
        _live(seeded, tmp_path / "raw", "--degrade-on-block"), monkeypatch, transport
    )
    assert result.exit_code == 1, result.output
    assert _statuses(seeded)[-1] == "partial"


def test_control_same_store_refused_agreement_degrades(seeded, tmp_path, monkeypatch):
    # Re-planted control for the two tests above: the flag IS live on this
    # store, so their exit 1 comes from the failure class, not a dead flag.
    result = _cli(
        _live(seeded, tmp_path / "raw", "--degrade-on-block"),
        monkeypatch,
        _blocked_transport(),
    )
    assert result.exit_code == 0, result.output


def test_circuit_open_in_document_phase_never_degrades(seeded, tmp_path, monkeypatch):
    transport = FakeSenateTransport()
    uuids = [f"00000000-0000-4000-8000-00000000009{n}" for n in range(3)]
    _route_handshake(transport, [_index_row(u, filed="10/20/2026") for u in uuids])
    for u in uuids:
        transport.route("GET", _doc_url("ptr", u), _resp(403))
    result = _cli(
        _live(seeded, tmp_path / "raw", "--degrade-on-block"), monkeypatch, transport
    )
    assert result.exit_code == 1, result.output
    assert "CIRCUIT OPEN" in result.output
    assert "SENATE DEGRADE" not in result.output


# --- stats.json (R6) and honest counts (R9) --------------------------------


def _stats(db: Path) -> dict:
    conn = connect(str(db))
    try:
        return compute_stats(conn, now=NOW)
    finally:
        conn.close()


def test_stats_senate_degraded_state(seeded, tmp_path, monkeypatch):
    healthy = _stats(seeded)
    assert healthy["freshness"]["senate_degraded"] is None
    jsonschema.validate(healthy, SCHEMA)

    for _ in range(2):  # two consecutive degraded builds
        result = _cli(
            _live(seeded, tmp_path / "raw", "--degrade-on-block"),
            monkeypatch,
            _blocked_transport(),
        )
        assert result.exit_code == 0, result.output
    conn = connect(str(seeded))
    try:
        # The second blocked run must not move the date the block was first seen.
        conn.execute(
            "UPDATE ingest_runs SET started_at = '2026-10-23T09:00:00+00:00'"
            " WHERE run_id = (SELECT run_id FROM ingest_runs"
            "  WHERE job = 'congress-senate' AND status = 'blocked'"
            "  ORDER BY started_at DESC, run_id DESC LIMIT 1)"
        )
        conn.execute(
            "UPDATE ingest_runs SET started_at = '2026-10-23T08:00:00+00:00'"
            " WHERE run_id = (SELECT run_id FROM ingest_runs"
            "  WHERE job = 'congress-senate' AND status = 'blocked'"
            "  ORDER BY started_at, run_id LIMIT 1)"
        )
        conn.execute(
            "UPDATE ingest_runs SET started_at = '2026-10-22T07:00:00+00:00',"
            " finished_at = '2026-10-22T07:22:33+00:00'"
            " WHERE job = 'congress-senate' AND status = 'ok'"
        )
        conn.commit()
        (last_ok,) = conn.execute(
            "SELECT finished_at FROM ingest_runs WHERE status = 'ok'"
            " AND job = 'congress-senate'"
        ).fetchone()
    finally:
        conn.close()
    degraded = _stats(seeded)
    jsonschema.validate(degraded, SCHEMA)
    assert degraded["freshness"]["senate_degraded"] == {
        "blocked_since": "2026-10-23",
        "last_good_ingest_at": last_ok,
    }

    # A later ok run clears the state by itself (control).
    cache = _make_cache(tmp_path, [_index_row(U1)], {f"ptr_{U1}.html": EFILE_1ROW})
    result = _cli(
        ["ingest", "congress-senate", "--db", str(seeded), "--from-cache", str(cache)]
    )
    assert result.exit_code == 0, result.output
    assert _stats(seeded)["freshness"]["senate_degraded"] is None


def test_senate_degraded_state_with_no_ok_run(initialized_db):
    initialized_db.execute(
        "INSERT INTO ingest_runs (run_id, job, started_at, finished_at, status)"
        " VALUES ('r1', 'congress-senate', '2026-10-23T08:00:00Z',"
        " '2026-10-23T08:00:05Z', 'blocked')"
    )
    assert senate_degraded_state(initialized_db) == {
        "blocked_since": "2026-10-23",
        "last_good_ingest_at": None,
    }


def _run(conn, run_id, started, status):
    conn.execute(
        "INSERT INTO ingest_runs (run_id, job, started_at, finished_at, status)"
        " VALUES (?, 'congress-senate', ?, ?, ?)",
        (run_id, started, started, status),
    )


def test_blocked_since_is_the_first_block_after_the_last_ok(initialized_db):
    conn = initialized_db
    _run(conn, "a", "2026-10-20T07:00:00Z", "blocked")  # healed by the next ok
    _run(conn, "b", "2026-10-22T07:00:00Z", "ok")
    _run(conn, "c", "2026-10-23T08:00:00Z", "blocked")
    _run(conn, "d", "2026-10-25T08:00:00Z", "blocked")
    assert senate_degraded_state(conn) == {
        "blocked_since": "2026-10-23",
        "last_good_ingest_at": "2026-10-22T07:00:00Z",
    }
    # Control: the newest run decides. A later ok clears it; so does a later
    # ordinary failure (that build never publishes, but the state is honest).
    _run(conn, "e", "2026-10-26T08:00:00Z", "ok")
    assert senate_degraded_state(conn) is None
    _run(conn, "f", "2026-10-27T08:00:00Z", "partial")
    assert senate_degraded_state(conn) is None


def test_degraded_counts_equal_the_seed(seeded, tmp_path, monkeypatch):
    before = _stats(seeded)
    result = _cli(
        _live(seeded, tmp_path / "raw", "--degrade-on-block"),
        monkeypatch,
        _blocked_transport(),
    )
    assert result.exit_code == 0, result.output
    after = _stats(seeded)
    assert after["default"] == before["default"]
    assert after["totals"] == before["totals"]
    assert after["unresolved_names"] == before["unresolved_names"]
    assert (
        after["freshness"]["senate_db_max_filed_date"]
        == before["freshness"]["senate_db_max_filed_date"]
        == "2026-07-02"
    )
    # Only the audit history and the degraded statement differ.
    assert before["freshness"]["senate_degraded"] is None
    assert after["freshness"]["senate_degraded"] is not None
    assert after["freshness"]["last_ingest_runs"]["congress-senate"]["status"] == "blocked"
