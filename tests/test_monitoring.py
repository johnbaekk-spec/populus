"""The D8 monitor observability contract (T3.3/T3.4).

`populus.monitoring.monitor.run_monitor` reports every immutable-settings
evaluation as a frozen `MonitorCheck` through a REQUIRED `report` callback:
`unchecked` is visible but non-alarming, `failed` follows the consecutive-
failure counter/alarm policy and prevents tuple advancement, a raising checker
fails closed, and no status is ever silent or represented as `passed`. The CLI
serializes each record as one JSON line on stdout; alarms stay on stderr.

The pointer state machine itself is pinned by tests/test_pointer_state.py —
this module owns only the MonitorCheck/report seam and its exit-code edges.
"""

from __future__ import annotations

import dataclasses
import json
from datetime import timedelta
from pathlib import Path

import pytest

from test_publish import NOW, make_repo, mutate_db, pin, publish_build, seed_db

from populus.client.snapshot import LocalRepoFetcher
from populus.monitoring.monitor import (
    MonitorCheck,
    _report_check,
    check_immutable_releases_stub,
    run_monitor,
)
from populus.publish.pointer import load_tuple, persist_tuple


@pytest.fixture
def published(tmp_path):
    """A published repo plus a seeded monitor state dir (floor = current)."""
    db = seed_db(tmp_path / "populus.db")
    repo = make_repo(tmp_path)
    publish_build(db, repo)
    state = tmp_path / "monitor"
    pointer_bytes = (repo / "latest.json").read_bytes()
    import hashlib

    persist_tuple(
        state / "pointer-tuple.json",
        json.loads(pointer_bytes)["pointer_version"],
        hashlib.sha256(pointer_bytes).hexdigest(),
    )
    return db, repo, state


def poll(repo, state, *, checker=None, moment=NOW):
    alerts: list[str] = []
    reports: list[MonitorCheck] = []
    kwargs = {}
    if checker is not None:
        kwargs["check_immutable_releases"] = checker
    code = run_monitor(
        state,
        LocalRepoFetcher(repo),
        now=pin(moment),
        alert=alerts.append,
        report=reports.append,
        **kwargs,
    )
    return code, alerts, reports


# --- the MonitorCheck record itself ------------------------------------------


def test_monitor_check_is_frozen_and_status_constrained():
    check = check_immutable_releases_stub()
    assert check.check == "immutable_releases"
    assert check.status == "unchecked"
    with pytest.raises(dataclasses.FrozenInstanceError):
        check.status = "passed"
    # A status outside the contract can never be constructed, so a failed
    # evaluation cannot be serialized as anything but what it is.
    with pytest.raises(ValueError):
        MonitorCheck(check="immutable_releases", status="ok", detail="")


def test_report_callback_is_required():
    with pytest.raises(TypeError):
        run_monitor("state", None, now=pin(), alert=lambda m: None)


# --- status paths through run_monitor ----------------------------------------


def test_passed_is_reported_and_exits_zero(published):
    _db, repo, state = published
    code, alerts, reports = poll(
        repo,
        state,
        checker=lambda: MonitorCheck(
            check="immutable_releases", status="passed", detail="setting on"
        ),
    )
    assert code == 0 and alerts == []
    assert [(r.check, r.status) for r in reports] == [("immutable_releases", "passed")]


def test_unchecked_default_stub_is_visible_but_non_alarming(published):
    _db, repo, state = published
    code, alerts, reports = poll(repo, state)  # default = the stub
    assert code == 0
    assert alerts == []  # not an alarm
    assert [r.status for r in reports] == ["unchecked"]  # but always observable
    assert "PAT" in reports[0].detail


def test_unchecked_does_not_block_tuple_advancement(published):
    db, repo, state = published
    mutate_db(db)
    publish_build(db, repo, moment=NOW + timedelta(hours=6))
    code, _alerts, reports = poll(
        repo, state, moment=NOW + timedelta(hours=7)
    )
    assert code == 0 and reports[0].status == "unchecked"
    assert load_tuple(state / "pointer-tuple.json")[0] == 2


def test_failed_first_poll_counts_but_does_not_alarm(published):
    db, repo, state = published
    mutate_db(db)
    publish_build(db, repo, moment=NOW + timedelta(hours=6))
    before = load_tuple(state / "pointer-tuple.json")
    failing = lambda: MonitorCheck(  # noqa: E731
        check="immutable_releases", status="failed", detail="immutable releases off"
    )
    code, alerts, reports = poll(
        repo, state, checker=failing, moment=NOW + timedelta(hours=7)
    )
    assert code == 1
    assert alerts == []  # first failure: counted, below the alarm threshold
    assert reports[0].status == "failed"  # never silent, never "passed"
    # A failed settings check prevents tuple advancement.
    assert load_tuple(state / "pointer-tuple.json") == before
    assert (state / "failures").read_text().strip() == "1"


def test_failed_second_poll_alarms(published):
    _db, repo, state = published
    failing = lambda: MonitorCheck(  # noqa: E731
        check="immutable_releases", status="failed", detail="immutable releases off"
    )
    assert poll(repo, state, checker=failing)[0] == 1
    code, alerts, reports = poll(repo, state, checker=failing)
    assert code == 1
    assert any("2 consecutive failures" in m for m in alerts)
    assert reports[0].status == "failed"


def test_a_raising_checker_fails_closed_without_leaking_the_message(published):
    """Fail-closed: an exception is a `failed` record, and its detail carries
    the exception TYPE only — a raised message can contain a credential."""
    _db, repo, state = published

    def boom():
        raise RuntimeError("Authorization: Bearer ghp_SECRETSECRET")

    code, alerts, reports = poll(repo, state, checker=boom)
    assert code == 1
    assert reports[0].status == "failed"
    assert "RuntimeError" in reports[0].detail
    assert "ghp_SECRETSECRET" not in reports[0].detail
    assert all("ghp_SECRETSECRET" not in m for m in alerts)


def test_success_resets_the_failure_counter_and_exit_codes_hold(published):
    _db, repo, state = published
    failing = lambda: MonitorCheck(  # noqa: E731
        check="immutable_releases", status="failed", detail="off"
    )
    assert poll(repo, state, checker=failing)[0] == 1
    assert poll(repo, state)[0] == 0  # unchecked stub passes the poll
    assert (state / "failures").read_text().strip() == "0"
    # Fail-closed trust state is still exit 2, reported nothing (never reached).
    code, _alerts, reports = poll(repo, Path(str(state) + "-missing"))
    assert code == 2 and reports == []


# --- the CLI serialization seam ----------------------------------------------


def test_cli_report_writes_one_json_line_per_check_on_stdout(capsys):
    _report_check(check_immutable_releases_stub())
    out, err = capsys.readouterr()
    assert err == ""
    lines = out.splitlines()
    assert len(lines) == 1
    record = json.loads(lines[0])
    assert record == {
        "check": "immutable_releases",
        "status": "unchecked",
        "detail": "stub: requires the Administration:read PAT (§14)",
    }
