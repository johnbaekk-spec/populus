"""RUN M2-11 T6 — the owner tooling, exercised ONLY against disposable fixture
copies (plan R11/R23).

`scripts/inst_snapshot.py` is the R23 cut protocol; its finalization sequence
is additionally pinned by the seam tests in `test_inst_external_store.py`
(which build their fixtures THROUGH it). `scripts/measure_inst_derive.py` is
the R11 T0 ladder; here it runs end-to-end over a fixture snapshot so every
rung is proven executable before it ever meets the 23 GB store.
"""

from __future__ import annotations

import json
import sqlite3
import sys
import time
from contextlib import contextmanager
from pathlib import Path

import pytest

from populus.publish.digests import sha256_file

from test_inst_external_store import (  # noqa: E402
    _seed_inst_source,
    make_inst_snapshot,
)

SCRIPTS = Path(__file__).resolve().parent.parent / "scripts"
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))
import inst_snapshot  # noqa: E402
import measure_inst_derive  # noqa: E402


# --- inst_snapshot.py ---------------------------------------------------------


def test_cut_record_carries_identity_and_corroboration(tmp_path):
    source = _seed_inst_source(tmp_path / "src.db")
    dest_dir = tmp_path / "snapshots"
    dest_dir.mkdir()
    pre = sha256_file(source)
    record = inst_snapshot.cut_snapshot(source, dest_dir, snapshot_version=3)
    dest = Path(record["destination"])
    assert dest.name == "inst-source-v3.db"
    assert record["snapshot_sha256"] == sha256_file(dest)
    # The source hashes are labelled corroboration, never proof: both are
    # recorded, and the tool itself never wrote the source.
    assert record["source_main_file_sha256_pre"] == pre
    assert set(record["timings"]) >= {"backup_s", "finalize_s", "reverify_s",
                                      "sha256_s", "total_s"}
    # The snapshot carries its own metadata, inside the hashed bytes (R24).
    ro = sqlite3.connect(f"file:{dest}?mode=ro", uri=True)
    try:
        row = ro.execute(
            "SELECT schema_version, snapshot_version, view_definition_digest"
            " FROM inst_source_meta"
        ).fetchone()
    finally:
        ro.close()
    assert row[0] == inst_snapshot.META_SCHEMA_VERSION
    assert row[1] == 3
    assert row[2] == record["view_definition_digest"]


def test_cut_refuses_without_explicit_source_and_dest(capsys):
    with pytest.raises(SystemExit):
        inst_snapshot.main([])  # argparse: both flags are required
    assert "required" in capsys.readouterr().err


def test_cut_main_refuses_a_missing_source(tmp_path, capsys):
    dest_dir = tmp_path / "snapshots"
    dest_dir.mkdir()
    code = inst_snapshot.main([
        "--source", str(tmp_path / "absent.db"),
        "--dest-dir", str(dest_dir),
        "--snapshot-version", "1",
    ])
    assert code == 1
    assert "REFUSED" in capsys.readouterr().err
    assert list(dest_dir.iterdir()) == []


def test_cut_main_prints_the_record_block(tmp_path, capsys):
    source = _seed_inst_source(tmp_path / "src.db")
    dest_dir = tmp_path / "snapshots"
    dest_dir.mkdir()
    code = inst_snapshot.main([
        "--source", str(source),
        "--dest-dir", str(dest_dir),
        "--snapshot-version", "1",
    ])
    out = capsys.readouterr().out
    assert code == 0
    assert "snapshot_sha256" in out
    assert "CORROBORATION" in out
    assert "view_definition_digest" in out
    assert "timing" in out


def test_cut_refuses_when_free_space_is_short(tmp_path, monkeypatch):
    source = _seed_inst_source(tmp_path / "src.db")
    dest_dir = tmp_path / "snapshots"
    dest_dir.mkdir()

    class _Cramped:
        free = 1

    monkeypatch.setattr(
        inst_snapshot.shutil, "disk_usage", lambda _p: _Cramped
    )
    with pytest.raises(inst_snapshot.SnapshotCutError, match="free"):
        inst_snapshot.cut_snapshot(source, dest_dir, snapshot_version=1)
    assert list(dest_dir.iterdir()) == []


def test_publish_refuses_a_destination_created_between_check_and_publish(
    tmp_path, monkeypatch
):
    """F3 (TOCTOU): a destination created AFTER the existence check but BEFORE
    the publication must survive byte-identical — os.link fails EEXIST where
    a plain os.rename would silently REPLACE it."""
    source = _seed_inst_source(tmp_path / "src.db")
    dest_dir = tmp_path / "snapshots"
    dest_dir.mkdir()
    planted = b"a concurrent cut published this first"
    real_publish = inst_snapshot._publish_no_replace

    def race_then_publish(temp_path, dest):
        # The race: the destination appears between the advisory check
        # (already passed) and the publication primitive.
        Path(dest).write_bytes(planted)
        real_publish(temp_path, dest)

    monkeypatch.setattr(inst_snapshot, "_publish_no_replace", race_then_publish)
    with pytest.raises(inst_snapshot.SnapshotCutError, match="refusing"):
        inst_snapshot.cut_snapshot(source, dest_dir, snapshot_version=1)
    dest = dest_dir / "inst-source-v1.db"
    assert dest.read_bytes() == planted, (
        "the concurrently created destination was replaced — the publication"
        " primitive is not no-replace"
    )
    # The temp sibling was cleaned up; only the survivor remains.
    assert [p.name for p in dest_dir.iterdir()] == [dest.name]


def test_chmod_failure_refuses_to_publish(tmp_path, monkeypatch):
    """F4: a snapshot that cannot be sealed 0444 is not accepted — the cut
    aborts with NO destination."""
    source = _seed_inst_source(tmp_path / "src.db")
    dest_dir = tmp_path / "snapshots"
    dest_dir.mkdir()

    def boom(_path):
        raise PermissionError("chmod refused")

    monkeypatch.setattr(inst_snapshot, "_seal_read_only", boom)
    with pytest.raises(PermissionError, match="chmod refused"):
        inst_snapshot.cut_snapshot(source, dest_dir, snapshot_version=1)
    assert list(dest_dir.iterdir()) == []


def test_reverify_provably_runs_against_a_0444_file(tmp_path, monkeypatch):
    """F4: the reverify runs on the ALREADY-immutable temp sibling — observed
    directly (a spy records the mode at reverify time) and enforced by
    reverify_copy itself, which refuses a writable file."""
    source = _seed_inst_source(tmp_path / "src.db")
    dest_dir = tmp_path / "snapshots"
    dest_dir.mkdir()
    seen_modes: list[int] = []
    real_reverify = inst_snapshot.reverify_copy

    def spy(copy_path):
        seen_modes.append(copy_path.stat().st_mode & 0o777)
        real_reverify(copy_path)

    monkeypatch.setattr(inst_snapshot, "reverify_copy", spy)
    inst_snapshot.cut_snapshot(source, dest_dir, snapshot_version=1)
    assert seen_modes == [0o444]
    # And the enforcement: reverify_copy REFUSES a writable file, so the
    # mutant that seals after publication cannot pass verification.
    writable = tmp_path / "writable-copy.db"
    import shutil as _shutil

    _shutil.copyfile(dest_dir / "inst-source-v1.db", writable)
    import os as _os

    _os.chmod(writable, 0o644)
    with pytest.raises(inst_snapshot.SnapshotCutError, match="writable"):
        real_reverify(writable)


def test_interruption_after_publication_leaves_an_immutable_file(
    tmp_path, monkeypatch
):
    """F4: a crash at ANY point after the publication leaves a destination
    that is already 0444 and fully verified — there is no rename→chmod window
    in which an accepted snapshot exists writable."""
    source = _seed_inst_source(tmp_path / "src.db")
    dest_dir = tmp_path / "snapshots"
    dest_dir.mkdir()
    real_publish = inst_snapshot._publish_no_replace

    def publish_then_crash(temp_path, dest):
        real_publish(temp_path, dest)
        raise RuntimeError("crashed immediately after publication")

    monkeypatch.setattr(inst_snapshot, "_publish_no_replace", publish_then_crash)
    with pytest.raises(RuntimeError, match="after publication"):
        inst_snapshot.cut_snapshot(source, dest_dir, snapshot_version=1)
    dest = dest_dir / "inst-source-v1.db"
    assert dest.exists()
    assert dest.stat().st_mode & 0o777 == 0o444
    # The published file passes the full read-only reverify as-is.
    inst_snapshot.reverify_copy(dest)


# --- measure_inst_derive.py ---------------------------------------------------


def test_measure_ladder_runs_end_to_end_over_a_fixture(tmp_path, monkeypatch, capsys):
    snapshot = make_inst_snapshot(tmp_path)
    real_materializer = measure_inst_derive.materialized_inst_derivation_views
    real_bound = measure_inst_derive._sqlite_execution_bound
    real_explain = measure_inst_derive.explain_plans
    real_build_pilot = measure_inst_derive.build_pilot_subset
    real_build_agg = measure_inst_derive.build_inst_agg
    entries: list[str] = []
    events: list[str] = []
    cleanup_counts: dict[str, int] = {}
    full_state: dict = {}

    def main_name(conn):
        path = next(row[2] for row in conn.execute("PRAGMA database_list")
                    if row[1] == "main")
        return Path(path).name

    @contextmanager
    def materializer_spy(conn):
        name = main_name(conn)
        label = "full" if name == snapshot.name else "pilot"
        entries.append(name)
        entered = False
        try:
            with real_materializer(conn):
                entered = True
                events.append(f"{label}-enter")
                if label == "full":
                    full_state["connection"] = conn
                    full_state["materializer_connection_id"] = id(conn)
                yield
        finally:
            cleanup_counts[label] = conn.execute(
                "SELECT COUNT(*) FROM sqlite_temp_schema"
                " WHERE name LIKE '_populus_inst_%'"
                " OR name LIKE 'v_filer_reported_%'"
                " OR name LIKE 'v_default_%'"
                " OR name = 'v_inst_reconciled_filings'"
            ).fetchone()[0]
            if entered:
                events.append(f"{label}-exit")

    @contextmanager
    def bound_spy(conn, phase):
        marker = phase == "materialization" and main_name(conn) == snapshot.name
        try:
            with real_bound(conn, phase) as guard:
                if marker:
                    events.append("full-guard-enter")
                yield guard
        finally:
            if marker:
                events.append("full-guard-exit")

    def explain_spy(conn):
        materialized = conn.execute(
            "SELECT 1 FROM sqlite_temp_schema"
            " WHERE type = 'table' AND name = '_populus_inst_agg_input'"
        ).fetchone() is not None
        if main_name(conn) == snapshot.name:
            events.append("materialized-explain" if materialized else "baseline-explain")
            if materialized:
                full_state["explain_connection_id"] = id(conn)
        return real_explain(conn)

    def build_pilot_spy(*args, **kwargs):
        full_conn = full_state["connection"]
        full_state["retained_at_pilot"] = (
            full_conn.in_transaction
            and full_conn.execute(
                "SELECT 1 FROM sqlite_temp_schema"
                " WHERE type = 'table' AND name = '_populus_inst_agg_input'"
            ).fetchone() is not None
        )
        events.append("pilot-copy")
        return real_build_pilot(*args, **kwargs)

    def build_agg_spy(conn, *args, **kwargs):
        label = "full" if main_name(conn) == snapshot.name else "pilot"
        events.append(f"{label}-aggregate")
        if label == "full":
            full_state["aggregate_connection_id"] = id(conn)
            full_state["aggregate_in_transaction"] = conn.in_transaction
            full_state["aggregate_has_input"] = conn.execute(
                "SELECT 1 FROM sqlite_temp_schema"
                " WHERE type = 'table' AND name = '_populus_inst_agg_input'"
            ).fetchone() is not None
        return real_build_agg(conn, *args, **kwargs)

    monkeypatch.setattr(
        measure_inst_derive, "materialized_inst_derivation_views", materializer_spy
    )
    monkeypatch.setattr(measure_inst_derive, "_sqlite_execution_bound", bound_spy)
    monkeypatch.setattr(measure_inst_derive, "explain_plans", explain_spy)
    monkeypatch.setattr(measure_inst_derive, "build_pilot_subset", build_pilot_spy)
    monkeypatch.setattr(measure_inst_derive, "build_inst_agg", build_agg_spy)
    # The fixture has 2 filers; with the production 1,500 cut BOTH are top filers
    # and the tail is empty — which the F1 vacuity guard correctly refuses to
    # certify. Cut at 1 so exactly one tail filer exists and the ladder is
    # measuring something real.
    monkeypatch.setattr(measure_inst_derive, "TOP_FILER_CUT", 1)
    code = measure_inst_derive.main([
        "--snapshot", str(snapshot), "--measured-files", "12000", "--full",
    ])
    out = capsys.readouterr().out
    assert code == 0, out
    assert "(i) view gate: PASS" in out
    assert "(ii) cardinality" in out
    assert "worst_case_file_count(measured_files=12000)" in out
    assert "(iii) resources" in out
    assert "(iv) baseline plan coverage_denominator" in out
    assert "(iv) materialized plan period_coverage_numerator" in out
    assert "(iv) baseline plan cover_dispositions_reconciled" in out
    assert "(iv) materialized plan cover_dispositions_default" in out
    assert "(iv) materialized plan coverage_cover_failed" in out
    assert "(v) pilot" in out
    assert entries == [snapshot.name, "pilot.db"]
    assert [event for event in events if event in {
        "full-enter", "pilot-enter", "pilot-exit", "full-exit",
    }] == ["full-enter", "pilot-enter", "pilot-exit", "full-exit"]
    assert events.index("baseline-explain") < events.index("full-guard-enter")
    assert events.index("full-guard-enter") < events.index("full-enter")
    assert events.index("full-enter") < events.index("materialized-explain")
    assert events.index("materialized-explain") < events.index("full-guard-exit")
    assert events.index("full-guard-exit") < events.index("pilot-copy")
    assert events.index("pilot-exit") < events.index("full-aggregate")
    assert events.index("full-aggregate") < events.index("full-exit")
    assert cleanup_counts == {"pilot": 0, "full": 0}
    assert full_state["retained_at_pilot"] is True
    assert full_state["materializer_connection_id"] == full_state[
        "explain_connection_id"
    ] == full_state["aggregate_connection_id"]
    assert full_state["aggregate_in_transaction"] is True
    assert full_state["aggregate_has_input"] is True
    with pytest.raises(sqlite3.ProgrammingError, match="closed"):
        full_state["connection"].execute("SELECT 1")

    pilot_line = next(
        line for line in out.splitlines() if line.startswith("(v) pilot: ")
    )
    pilot = json.loads(pilot_line[len("(v) pilot: "):])
    assert pilot["peak_rss_bytes"] > 0
    assert set(pilot) >= {
        "materialization_s",
        "coverage_s",
        "period_coverage_s",
        "aggregate_s",
        "aggregate_bytes",
        "serving_projection_s",
    }
    assert pilot["tail_payloads"]["ceiling_bytes"] == 1 << 20
    full_line = next(
        line for line in out.splitlines() if line.startswith("(vi) full: ")
    )
    full = json.loads(full_line[len("(vi) full: "):])
    rung_time = float(next(
        line.removeprefix("(iv) materialization_s: ")
        for line in out.splitlines()
        if line.startswith("(iv) materialization_s: ")
    ))
    assert full["materialization_s"] == rung_time
    assert full["label"] == "full" and pilot["label"] == "pilot"
    assert (
        f"(vi) materialization reuse: rung (iv) {rung_time:.3f}s; no rebuild"
        in out
    )


def test_measure_projection_rung_is_honest_when_unmeasured(tmp_path, capsys):
    """Codex F3: without --measured-files the projection rung stays honest AND
    the tail-geometry step REFUSES (exit 3) — a headroom gate over an
    unmeasured tree proves nothing, so it must never pass silently."""
    snapshot = make_inst_snapshot(tmp_path)
    code = measure_inst_derive.main(["--snapshot", str(snapshot)])
    captured = capsys.readouterr()
    assert code == 3
    assert "not computed" in captured.out  # never a defaulted largest term
    assert "measured tree count required" in captured.err


def test_measure_refuses_a_missing_snapshot(tmp_path, capsys):
    code = measure_inst_derive.main(["--snapshot", str(tmp_path / "no.db")])
    assert code == 1
    assert "REFUSED" in capsys.readouterr().err


def test_measure_refuses_negative_pilot_filers(tmp_path, capsys):
    """Codex F4: a negative pilot bound reaches SQLite as `LIMIT -1` = NO limit.

    The "bounded" pilot would then derive the FULL corpus with none of the
    --full abort thresholds applied. It must refuse at parse time, before any
    snapshot work, with a nonzero exit.
    """
    snapshot = make_inst_snapshot(tmp_path)
    code = measure_inst_derive.main(
        ["--snapshot", str(snapshot), "--pilot-filers", "-1"]
    )
    captured = capsys.readouterr()
    assert code != 0
    assert "REFUSED: --pilot-filers -1" in captured.err
    # Refused BEFORE the ladder ran: no view gate, no cardinality, no pilot.
    assert "view gate" not in captured.out


def test_measure_refuses_zero_pilot_filers(tmp_path, capsys):
    """Zero is the same defect class: a pilot that measures nothing must not
    certify anything. The bound is >= 1."""
    snapshot = make_inst_snapshot(tmp_path)
    code = measure_inst_derive.main(
        ["--snapshot", str(snapshot), "--pilot-filers", "0"]
    )
    assert code != 0
    assert "REFUSED: --pilot-filers 0" in capsys.readouterr().err


def test_measure_refuses_negative_measured_files(tmp_path, capsys):
    """Codex F4: a negative measured tree count shrinks the projection's
    largest term and fabricates global headroom, so certification would pass
    on an impossible measurement."""
    snapshot = make_inst_snapshot(tmp_path)
    code = measure_inst_derive.main(
        ["--snapshot", str(snapshot), "--measured-files", "-5000"]
    )
    captured = capsys.readouterr()
    assert code != 0
    assert "REFUSED: --measured-files -5000" in captured.err
    assert "view gate" not in captured.out


def test_measure_view_gate_fails_closed_on_drift(tmp_path, capsys):
    import shutil as _shutil

    snapshot = make_inst_snapshot(tmp_path)
    drifted = tmp_path / "drifted.db"
    _shutil.copyfile(snapshot, drifted)
    conn = sqlite3.connect(str(drifted), isolation_level=None)
    try:
        conn.execute("DROP VIEW v_default_holdings")
    finally:
        conn.close()
    code = measure_inst_derive.main(["--snapshot", str(drifted)])
    captured = capsys.readouterr()
    assert code == 1
    assert "view gate: FAIL" in captured.err
    assert "v_default_holdings" in captured.err


def test_pilot_subset_is_bounded(tmp_path):
    snapshot = make_inst_snapshot(tmp_path)
    pilot = tmp_path / "pilot.db"
    copied = measure_inst_derive.build_pilot_subset(
        snapshot, pilot, filer_limit=1
    )
    assert copied == 1
    conn = sqlite3.connect(str(pilot))
    try:
        # Only the copied filer's filings/holdings came along.
        assert conn.execute(
            "SELECT COUNT(DISTINCT cik) FROM inst_filings"
        ).fetchone()[0] == 1
    finally:
        conn.close()


def _fixture_projection(tmp_path):
    """A real (projection, agg_path, latest_filed) triple derived from the
    fixture snapshot through the production code paths."""
    import shutil as _shutil

    from populus.inst_agg import build_inst_agg
    from populus.inst_serving import build_serving_projection, publication_periods

    snapshot = make_inst_snapshot(tmp_path)
    working = tmp_path / "working.db"
    _shutil.copyfile(snapshot, working)
    agg = tmp_path / "agg.db"
    wconn = sqlite3.connect(str(working), isolation_level=None)
    try:
        build_inst_agg(wconn, agg, ingested_at="2026-01-01T00:00:00Z")
        periods = publication_periods(wconn)
        wconn.execute("ATTACH DATABASE ? AS inst_agg", (str(agg),))
        try:
            projection = build_serving_projection(wconn, periods=periods)
        finally:
            wconn.execute("DETACH DATABASE inst_agg")
        latest_filed = wconn.execute(
            "SELECT MAX(filed_date) FROM v_default_inst_filings"
        ).fetchone()[0]
    finally:
        wconn.close()
    return projection, agg, latest_filed


def test_ld7_selection_parity_with_the_dashboard_rule():
    """R22 parity: the Python reimplementation of the LD-7 selection and the
    exported TS rule (`dashboard/src/lib/holdings.ts::selectTopFilers`) must
    produce the identical ordered CIK list from the SAME interchange fixture.
    The dashboard-side half of this assertion reads the same file."""
    fixture = json.loads(
        (Path(__file__).parent / "fixtures" / "filer_selection_parity.v1.json")
        .read_text(encoding="utf-8")
    )
    got = measure_inst_derive.select_top_filers(
        fixture["rows"], fixture["budget"]
    )
    assert got == fixture["expected"]
    # The rule's properties, stated: nulls after every number, ties ascending.
    assert measure_inst_derive.select_top_filers(
        [
            {"cik": "b", "latestPeriodValueUsd": None},
            {"cik": "a", "latestPeriodValueUsd": None},
            {"cik": "c", "latestPeriodValueUsd": 1},
        ],
        3,
    ) == ["c", "a", "b"]


def test_tail_payload_is_the_full_filer_payload_v1(tmp_path, monkeypatch):
    """LD-10 measures the REAL payload: every field of the R22 literal
    FilerPayloadV1 interface is serialized, the shard count is derived, and
    the headroom is checked against inst_budget's terms. The cut is
    monkeypatched to 1 so the two-filer fixture actually HAS a tail."""
    projection, agg, latest_filed = _fixture_projection(tmp_path)
    monkeypatch.setattr(measure_inst_derive, "TOP_FILER_CUT", 1)
    dist = measure_inst_derive.tail_payload_distribution(
        projection, agg_path=agg, latest_filed=latest_filed
    )
    assert dist["tail_filers"] == 1
    assert dist["max_bytes"] > 0
    assert dist["over_ceiling_count"] == 0
    assert dist["shard_count"] == 1
    assert dist["shard_limit"] == 4_096
    assert dist["routing_index_files"] == 1
    assert dist["v1_transition_files"] == 1
    assert dist["fragment_target_bytes"] == 768 * 1024
    assert dist["fragment_parts_limit"] == 64
    assert dist["fragment_sizing_sentinel"] == 99_999
    assert dist["fragment_count"] >= dist["tail_filers"]
    assert dist["reassembly_mismatch_count"] == 0
    assert dist["route_mismatch_count"] == 0
    assert dist["index_over_ceiling"] is False
    assert dist["headroom_ok"] is True
    assert dist["stop"] is False
    # The serialized entry is the FULL R22 field set, byte-for-byte the
    # planner's `"cik":payload` shape — rebuild it and check the fields.
    tail_cik = "0000000002"  # cik 1 wins the LD-7 cut of 1 in the fixture
    rows = [
        {**r, "filing_key": None if r["filing_key"] is None
         else str(r["filing_key"])}
        for r in projection.filer_rows
        if r["cik"] == tail_cik
    ]
    agg_inputs = measure_inst_derive._load_aggregate_inputs(agg)
    payload = measure_inst_derive.build_filer_payload(
        tail_cik,
        filer_name=agg_inputs["registry"][tail_cik]["filer_name"],
        latest_period=agg_inputs["registry"][tail_cik]["latest_period"],
        rows=rows,
        filings_by_key={},
        agg=agg_inputs,
        latest_filed=latest_filed,
        window=measure_inst_derive.WIDEST_FILING_WINDOW,
    )
    assert set(payload) == {
        "v", "kind", "cik", "filerName", "latestPeriod", "periods", "current",
        "prior", "filings", "rowsByPeriod", "totalsByPeriod", "concByPeriod",
        "deltasByPeriod", "deltaTotalsByPeriod", "latestFiled", "topn", "window",
    }
    assert payload["v"] == 1 and payload["kind"] == "filer"
    assert payload["topn"] == 25
    assert set(payload["window"]) == {"open", "quarterEnd", "deadline"}
    assert payload["latestFiled"] == latest_filed
    # NULL-honest: concByPeriod carries the real ConcentrationRow shape.
    conc = payload["concByPeriod"][payload["latestPeriod"]]
    assert set(conc) >= {
        "cik", "period_of_report", "position_count", "total_value_usd",
        "null_value_positions", "topn_value_usd", "topn_share_bps", "hhi",
        "flags",
    }


def _expand_parity_rows(case: dict, columns: list[str]) -> list[dict]:
    rows = [dict(zip(columns, r)) for r in case["rawRows"]]
    spec = case.get("generateRows")
    if spec:
        cik = case["args"]["cik"]
        for i in range(spec["count"]):
            issuer = f"PAD CORP {i:04d} " + spec["padChar"] * spec["padLength"]
            rows.append(dict(zip(columns, [
                cik, spec["period"], None, None, f"{i:09d}", issuer, "COM",
                1_000_000 - i, i + 1, "SH", "LONG", f"sid:p{i}", "LONG", "SH",
                "[]",
            ])))
    return rows


def test_filer_payload_byte_parity_with_the_dashboard_assembler():
    """Codex F2: the T0 payload builder and the production assembler must
    reproduce the SAME canonical serialized FilerPayloadV1, byte for byte, from
    the shared interchange fixture — flags normalization, sort tie-break, the
    embed-cap boundary, a null-heavy row, both window states, and
    referenced-only filings. The dashboard half of this assertion
    (dashboard/test/filer-payload.test.ts) reads the same file."""
    import hashlib

    fixture = json.loads(
        (Path(__file__).parent / "fixtures" / "filer_payload_parity.v1.json")
        .read_text(encoding="utf-8")
    )
    names = [c["name"] for c in fixture["cases"]]
    assert names == [
        "flags_sort_ties_null_heavy_referenced_only",
        "window_null_empty_rows",
        "cap_boundary_over_embed_cap",
    ]
    for case in fixture["cases"]:
        cik = case["args"]["cik"]
        rows = _expand_parity_rows(case, fixture["columns"])
        agg = {
            "topn": case["agg"]["topn"],
            "conc_by_filer": {cik: case["agg"]["concByPeriod"]},
            "deltas_by_filer": {cik: case["agg"]["deltasByPeriod"]},
        }
        payload = measure_inst_derive.build_filer_payload(
            cik,
            filer_name=case["args"]["filerName"],
            latest_period=case["args"]["latestPeriod"],
            rows=rows,
            filings_by_key=case["filings"],
            agg=agg,
            latest_filed=case["agg"]["latestFiled"],
            window=case["agg"]["window"],
        )
        serialized = measure_inst_derive._dumps(payload)
        encoded = serialized.encode("utf-8")
        fragments = measure_inst_derive.fragment_filer_payload(payload)
        fragment_summary = {
            "parts": len(fragments),
            "fragments": [
                {
                    "part": fragment["part"],
                    "section": fragment["section"],
                    "period": fragment["period"],
                    "start": fragment["start"],
                    "records": (
                        len(fragment["data"])
                        if isinstance(fragment["data"], list)
                        else None
                    ),
                    "entry_utf8_bytes": len(
                        measure_inst_derive._fragment_entry_json(fragment).encode(
                            "utf-8"
                        )
                    ),
                }
                for fragment in fragments
            ],
        }
        assert fragment_summary == case["fragment_summary_v2"], case["name"]
        assert (
            measure_inst_derive.reassemble_filer_fragments(fragments) == payload
        ), case["name"]
        if "expected" in case:
            assert serialized == case["expected"], case["name"]
        assert len(encoded) == case["expected_utf8_bytes"], case["name"]
        assert (
            hashlib.sha256(encoded).hexdigest() == case["expected_sha256"]
        ), case["name"]
    # The cap case genuinely crossed the embed cap: capped rows < true total.
    cap_case = fixture["cases"][2]
    cik = cap_case["args"]["cik"]
    rows = _expand_parity_rows(cap_case, fixture["columns"])
    payload = measure_inst_derive.build_filer_payload(
        cik,
        filer_name=cap_case["args"]["filerName"],
        latest_period=cap_case["args"]["latestPeriod"],
        rows=rows,
        filings_by_key=cap_case["filings"],
        agg={
            "topn": cap_case["agg"]["topn"],
            "conc_by_filer": {cik: cap_case["agg"]["concByPeriod"]},
            "deltas_by_filer": {cik: cap_case["agg"]["deltasByPeriod"]},
        },
        latest_filed=cap_case["agg"]["latestFiled"],
        window=cap_case["agg"]["window"],
    )
    period = cap_case["generateRows"]["period"]
    assert payload["totalsByPeriod"][period] == cap_case["generateRows"]["count"]
    assert len(payload["rowsByPeriod"][period]) < payload["totalsByPeriod"][period]


def test_fragment_cut_uses_the_literal_five_digit_sizing_sentinel(monkeypatch):
    """The 99999 values are load-bearing sizing inputs, not decorative
    constants. Spy at the helper seam so replacing them with current part
    numbers (or dropping conservative sizing) fails this test directly."""
    calls = []
    real = measure_inst_derive._fragment_value

    def spy(**kwargs):
        calls.append((kwargs["part"], kwargs["parts"]))
        return real(**kwargs)

    monkeypatch.setattr(measure_inst_derive, "_fragment_value", spy)
    measure_inst_derive._chunk_fragment_records(
        "0000000001", "rows", "2026-03-31", [{"row": 1}]
    )
    assert calls
    assert calls[0] == (
        measure_inst_derive.FILER_FRAGMENT_SIZING_SENTINEL,
        measure_inst_derive.FILER_FRAGMENT_SIZING_SENTINEL,
    ) == (99_999, 99_999)


def test_measure_headroom_gate_refuses_an_over_cap_measured_tree(
    tmp_path, monkeypatch, capsys
):
    """Codex F3 removal-fails: a measured tree whose projection (including the
    DERIVED shard count) exceeds the 18,000 global cap is exit 3."""
    snapshot = make_inst_snapshot(tmp_path)
    monkeypatch.setattr(measure_inst_derive, "TOP_FILER_CUT", 1)
    code = measure_inst_derive.main([
        "--snapshot", str(snapshot), "--measured-files", "17999", "--full",
    ])
    captured = capsys.readouterr()
    assert code == 3
    assert "measured global headroom is negative" in captured.err
    assert "18000-file global cap" in captured.err


def test_measure_headroom_gate_reports_and_passes_a_fitting_tree(
    tmp_path, monkeypatch, capsys
):
    """Codex F3: a fitting measured tree passes AND the headroom arithmetic is
    printed with the derived shard count as a term."""
    snapshot = make_inst_snapshot(tmp_path)
    monkeypatch.setattr(measure_inst_derive, "TOP_FILER_CUT", 1)
    code = measure_inst_derive.main([
        "--snapshot", str(snapshot), "--measured-files", "12442", "--full",
    ])
    captured = capsys.readouterr()
    assert code == 0, captured.err
    assert "measured global headroom: 18000 cap -" in captured.out
    assert "derived shard(s)" in captured.out


def test_measure_exits_nonzero_on_an_over_ceiling_payload(
    tmp_path, monkeypatch, capsys
):
    """Removal-fails (R11/LD-10): a payload over the client-response ceiling
    is a STOP — main returns nonzero, never a warning."""
    snapshot = make_inst_snapshot(tmp_path)
    monkeypatch.setattr(measure_inst_derive, "TOP_FILER_CUT", 1)
    monkeypatch.setattr(measure_inst_derive, "CLIENT_RESPONSE_CEILING_BYTES", 1)
    code = measure_inst_derive.main(["--snapshot", str(snapshot)])
    captured = capsys.readouterr()
    assert code != 0
    assert "STOP (LD-10)" in captured.err
    assert "ceiling" in captured.err


def test_measure_exits_nonzero_on_a_headroom_breach(
    tmp_path, monkeypatch, capsys
):
    """Removal-fails (R11): a derived shard count over the reserved file
    headroom is a STOP — main returns nonzero."""
    snapshot = make_inst_snapshot(tmp_path)
    monkeypatch.setattr(measure_inst_derive, "TOP_FILER_CUT", 1)
    monkeypatch.setattr(measure_inst_derive, "TAIL_SHARD_LIMIT", 0)
    code = measure_inst_derive.main(["--snapshot", str(snapshot)])
    captured = capsys.readouterr()
    assert code != 0
    assert "STOP (R11)" in captured.err
    assert "headroom" in captured.err


def test_pilot_only_is_explicitly_non_certifying(tmp_path, monkeypatch, capsys):
    """Codex delta F1: the pilot is bounded below the prerender cut, so it can
    contain no tail filer. A pilot-only run must NOT read as a pass."""
    snapshot = make_inst_snapshot(tmp_path)
    monkeypatch.setattr(measure_inst_derive, "TOP_FILER_CUT", 1)
    code = measure_inst_derive.main([
        "--snapshot", str(snapshot), "--measured-files", "12442",
    ])  # deliberately no --full
    err = capsys.readouterr().err
    assert code == 3, "pilot-only must be non-certifying"
    assert "NOT CERTIFIED" in err
    assert "Re-run with --full" in err


def test_a_full_run_measuring_no_tail_is_non_certifying(tmp_path, capsys):
    """The vacuity guard for rung (vi): an empty tail measurement is not a pass.
    With the production cut this fixture's 2 filers are both prerendered."""
    snapshot = make_inst_snapshot(tmp_path)
    code = measure_inst_derive.main([
        "--snapshot", str(snapshot), "--measured-files", "12442", "--full",
    ])
    err = capsys.readouterr().err
    assert code == 3
    assert "measured 0 tail payloads" in err


def test_widest_window_is_the_conservative_serialization(tmp_path):
    """Codex delta F2: `false` serializes one byte wider than `true`, so the
    unknown-window measurement must take the wider one, and a supplied build
    date must produce the REAL window instead."""
    import json as _json
    widest = measure_inst_derive.WIDEST_FILING_WINDOW
    assert widest["open"] is False
    wider = len(_json.dumps(widest, separators=(",", ":")))
    narrower = len(_json.dumps({**widest, "open": True}, separators=(",", ":")))
    assert wider == narrower + 1, "the widest window must be the wider serialization"
    real = measure_inst_derive.filing_window_for("2026-08-08")
    assert real["quarterEnd"] == "2026-06-30" and real["deadline"] == "2026-08-14"
    assert real["open"] is True, "2026-08-08 is inside the 45-day window"
    closed = measure_inst_derive.filing_window_for("2026-09-01")
    assert closed["open"] is False


def test_explain_uses_every_exact_production_coverage_statement(tmp_path):
    from populus.amendments import materialized_inst_derivation_views
    from populus.ingest.inst13f import (
        _COVERAGE_DENOMINATOR_SQL,
        _COVERAGE_NUMERATOR_SQL,
        _PERIOD_COVERAGE_DENOMINATOR_SQL,
        _PERIOD_COVERAGE_NUMERATOR_SQL,
        _production_coverage_queries,
    )
    from populus.inst_serving import publication_periods
    from populus.inst_agg import _production_aggregate_queries

    persistent_queries = {
        "coverage_denominator": _COVERAGE_DENOMINATOR_SQL,
        "coverage_numerator": _COVERAGE_NUMERATOR_SQL,
        "period_coverage_denominator": _PERIOD_COVERAGE_DENOMINATOR_SQL,
        "period_coverage_numerator": _PERIOD_COVERAGE_NUMERATOR_SQL,
    }
    snapshot = make_inst_snapshot(tmp_path)
    conn = measure_inst_derive._ro_connect(snapshot)
    try:
        selected_baseline = _production_coverage_queries(conn)
        aggregate_baseline = _production_aggregate_queries(conn)
        assert {
            key: selected_baseline[key] for key in persistent_queries
        } == persistent_queries
        baseline = measure_inst_derive.explain_plans(conn)
        with materialized_inst_derivation_views(conn):
            selected_materialized = _production_coverage_queries(conn)
            aggregate_materialized = _production_aggregate_queries(conn)
            materialized = measure_inst_derive.explain_plans(conn)
            periods = publication_periods(conn)
            placeholders = ",".join("?" for _ in periods)
            serving_sql = (
                "SELECT h.cik, h.period_of_report, h.filing_id, h.security_id,"
                " h.cusip, h.issuer_name_raw, h.title_of_class, h.value_usd,"
                " h.ssh_prnamt, h.ssh_prnamt_type, h.put_call, h.flags"
                " FROM v_filer_reported_holdings h"
                f" WHERE h.period_of_report IN ({placeholders})"
                " ORDER BY h.cik, h.period_of_report, h.holding_id"
            )
            serving_plan = [
                row[3]
                for row in conn.execute(
                    "EXPLAIN QUERY PLAN " + serving_sql, periods
                ).fetchall()
            ]
    finally:
        conn.close()
    exact_coverage_names = {
        "coverage_denominator",
        "coverage_numerator",
        "period_coverage_denominator",
        "period_coverage_numerator",
        "cover_dispositions_reconciled",
        "cover_dispositions_default",
        "coverage_cover_failed",
    }
    assert exact_coverage_names <= set(baseline)
    assert exact_coverage_names <= set(materialized)
    assert set(aggregate_baseline) == {
        "agg_default_holdings_pass",
        "agg_filer_reported_periods",
    }
    assert set(aggregate_materialized) == {
        "agg_input_sign_preflight",
        "agg_materialized_positions",
    }
    assert "_populus_inst_agg_input" in aggregate_materialized[
        "agg_input_sign_preflight"
    ]
    assert "value_usd < 0 OR ssh_prnamt < 0" in aggregate_materialized[
        "agg_input_sign_preflight"
    ]
    assert "_populus_inst_agg_input" in aggregate_materialized[
        "agg_materialized_positions"
    ]
    assert "v_default_holdings" not in aggregate_materialized[
        "agg_materialized_positions"
    ]
    for name in aggregate_materialized:
        plan = "\n".join(materialized[name])
        assert "_populus_inst_agg_input" in plan
    for name in exact_coverage_names - {"coverage_cover_failed"}:
        assert "_populus_inst_coverage_totals" in selected_materialized[name]
        plan = "\n".join(materialized[name])
        assert "_populus_inst_coverage_totals_by_filing" in plan
        assert "inst_holdings" not in plan
        assert "CORRELATED" not in plan
        assert "json_each" not in plan
    cover_failed_sql = selected_materialized["coverage_cover_failed"]
    cover_failed_plan = "\n".join(materialized["coverage_cover_failed"])
    assert "json_each(v_default_inst_filings.flags)" in cover_failed_sql
    assert "json_each" in cover_failed_plan
    grouped = "\n".join(materialized["period_coverage_numerator"])
    assert "_populus_inst_coverage_totals_by_filing" in grouped
    serving = "\n".join(serving_plan)
    assert "v_filer_reported_filings_by_filing" in serving
    assert "CORRELATED" not in serving
    assert "json_each" not in serving


def test_materialized_derivation_refuses_without_an_active_transaction(tmp_path):
    snapshot = make_inst_snapshot(tmp_path)
    scratch = tmp_path / "scratch"
    scratch.mkdir()
    conn = measure_inst_derive._ro_connect(snapshot)
    try:
        with pytest.raises(RuntimeError, match="active materialized source transaction"):
            measure_inst_derive._derive_from_materialized(
                conn,
                scratch,
                label="full",
                window=measure_inst_derive.WIDEST_FILING_WINDOW,
                materialization_s=1.0,
            )
    finally:
        conn.close()
    assert not (scratch / "full-inst_agg.db").exists()


def test_materialized_derivation_refuses_an_incomplete_namespace(tmp_path):
    snapshot = make_inst_snapshot(tmp_path)
    scratch = tmp_path / "scratch"
    scratch.mkdir()
    conn = measure_inst_derive._ro_connect(snapshot)
    try:
        conn.execute("BEGIN")
        conn.execute("CREATE TEMP TABLE _populus_inst_agg_input(incomplete INTEGER)")
        with pytest.raises(RuntimeError, match="complete owned materialized namespace"):
            measure_inst_derive._derive_from_materialized(
                conn,
                scratch,
                label="full",
                window=measure_inst_derive.WIDEST_FILING_WINDOW,
                materialization_s=1.0,
            )
        assert not conn.in_transaction
    finally:
        conn.close()
    assert not (scratch / "full-inst_agg.db").exists()


def test_materialized_explain_timeout_cleans_once_and_suppresses_later_rungs(
    tmp_path, monkeypatch, capsys
):
    snapshot = make_inst_snapshot(tmp_path)
    real_materializer = measure_inst_derive.materialized_inst_derivation_views
    real_bound = measure_inst_derive._sqlite_execution_bound
    real_explain = measure_inst_derive.explain_plans
    active_guards: dict[int, measure_inst_derive._SQLiteExecutionGuard] = {}
    events: list[str] = []
    residue: list[int] = []

    @contextmanager
    def bound_spy(conn, phase):
        with real_bound(conn, phase) as guard:
            active_guards[id(conn)] = guard
            try:
                yield guard
            finally:
                active_guards.pop(id(conn), None)

    @contextmanager
    def materializer_spy(conn):
        events.append("call")
        entered = False
        try:
            with real_materializer(conn):
                entered = True
                events.append("enter")
                yield
        finally:
            residue.append(conn.execute(
                "SELECT COUNT(*) FROM sqlite_temp_schema"
                " WHERE name LIKE '_populus_inst_%'"
                " OR name LIKE 'v_filer_reported_%'"
                " OR name LIKE 'v_default_%'"
                " OR name = 'v_inst_reconciled_filings'"
            ).fetchone()[0])
            if entered:
                events.append("exit")

    def explain_timeout(conn):
        materialized = conn.execute(
            "SELECT 1 FROM sqlite_temp_schema"
            " WHERE type = 'table' AND name = '_populus_inst_agg_input'"
        ).fetchone() is not None
        if materialized:
            guard = active_guards[id(conn)]
            guard.deadline = time.monotonic() - 1
            guard._expire()
            conn.execute(
                "WITH RECURSIVE n(x) AS (VALUES(0) UNION ALL"
                " SELECT x+1 FROM n WHERE x<100000000) SELECT SUM(x) FROM n"
            ).fetchone()
        return real_explain(conn)

    monkeypatch.setattr(measure_inst_derive, "SQLITE_PHASE_TIMEOUT_SECONDS", 60)
    monkeypatch.setattr(measure_inst_derive, "SQLITE_PROGRESS_OPCODES", 1)
    monkeypatch.setattr(measure_inst_derive, "_sqlite_execution_bound", bound_spy)
    monkeypatch.setattr(
        measure_inst_derive, "materialized_inst_derivation_views", materializer_spy
    )
    monkeypatch.setattr(measure_inst_derive, "explain_plans", explain_timeout)
    code = measure_inst_derive.main([
        "--snapshot", str(snapshot), "--measured-files", "12000", "--full",
    ])
    captured = capsys.readouterr()
    assert code == 4
    assert events == ["call", "enter", "exit"]
    assert residue == [0]
    assert "phase materialization" in captured.err
    assert "later phases suppressed" in captured.err
    assert "(v) pilot" not in captured.out
    assert "(vi) full" not in captured.out
    assert "snapshot_immutability: PASS" in captured.out


def test_forced_sqlite_timeout_is_exit_4_and_suppresses_later_phases(
    tmp_path, monkeypatch, capsys
):
    snapshot = make_inst_snapshot(tmp_path)
    monkeypatch.setattr(measure_inst_derive, "SQLITE_PHASE_TIMEOUT_SECONDS", -1)
    monkeypatch.setattr(measure_inst_derive, "SQLITE_PROGRESS_OPCODES", 1)
    code = measure_inst_derive.main([
        "--snapshot", str(snapshot), "--measured-files", "12000", "--full",
    ])
    captured = capsys.readouterr()
    assert code == 4
    assert "phase materialization" in captured.err
    assert "later phases suppressed" in captured.err
    assert "(v) pilot" not in captured.out
    assert "snapshot_immutability: PASS" in captured.out


def test_pilot_copy_failure_unwinds_the_retained_full_namespace(
    tmp_path, monkeypatch, capsys
):
    snapshot = make_inst_snapshot(tmp_path)
    real_materializer = measure_inst_derive.materialized_inst_derivation_views
    events: list[str] = []
    residue: list[int] = []

    @contextmanager
    def materializer_spy(conn):
        entered = False
        try:
            with real_materializer(conn):
                entered = True
                events.append("full-enter")
                yield
        finally:
            residue.append(conn.execute(
                "SELECT COUNT(*) FROM sqlite_temp_schema"
                " WHERE name LIKE '_populus_inst_%'"
                " OR name LIKE 'v_filer_reported_%'"
                " OR name LIKE 'v_default_%'"
                " OR name = 'v_inst_reconciled_filings'"
            ).fetchone()[0])
            if entered:
                events.append("full-exit")

    def fail_pilot_copy(*_args, **_kwargs):
        raise RuntimeError("forced pilot copy failure")

    monkeypatch.setattr(
        measure_inst_derive, "materialized_inst_derivation_views", materializer_spy
    )
    monkeypatch.setattr(measure_inst_derive, "build_pilot_subset", fail_pilot_copy)
    with pytest.raises(RuntimeError, match="forced pilot copy failure"):
        measure_inst_derive.main([
            "--snapshot", str(snapshot), "--measured-files", "12000", "--full",
        ])
    captured = capsys.readouterr()
    assert events == ["full-enter", "full-exit"]
    assert residue == [0]
    assert "(v) pilot" not in captured.out
    assert "(vi) full" not in captured.out
    assert "snapshot_immutability: PASS" in captured.out


def test_resource_abort_unwinds_the_retained_full_namespace(
    tmp_path, monkeypatch, capsys
):
    snapshot = make_inst_snapshot(tmp_path)
    real_materializer = measure_inst_derive.materialized_inst_derivation_views
    entries: list[str] = []
    exits: list[str] = []
    residue: dict[str, int] = {}
    ram_values = iter([16 * measure_inst_derive.GIB, 1])

    def main_name(conn):
        path = next(row[2] for row in conn.execute("PRAGMA database_list")
                    if row[1] == "main")
        return Path(path).name

    @contextmanager
    def materializer_spy(conn):
        name = main_name(conn)
        label = "full" if name == snapshot.name else "pilot"
        entries.append(label)
        try:
            with real_materializer(conn):
                yield
        finally:
            residue[label] = conn.execute(
                "SELECT COUNT(*) FROM sqlite_temp_schema"
                " WHERE name LIKE '_populus_inst_%'"
                " OR name LIKE 'v_filer_reported_%'"
                " OR name LIKE 'v_default_%'"
                " OR name = 'v_inst_reconciled_filings'"
            ).fetchone()[0]
            exits.append(label)

    monkeypatch.setattr(measure_inst_derive, "TOP_FILER_CUT", 1)
    monkeypatch.setattr(measure_inst_derive, "free_ram_bytes", lambda: next(ram_values))
    monkeypatch.setattr(
        measure_inst_derive, "materialized_inst_derivation_views", materializer_spy
    )
    code = measure_inst_derive.main([
        "--snapshot", str(snapshot), "--measured-files", "12000", "--full",
    ])
    captured = capsys.readouterr()
    assert code == 2
    assert entries == ["full", "pilot"]
    assert exits == ["pilot", "full"]
    assert residue == {"pilot": 0, "full": 0}
    assert "(vi) ABORT: free RAM" in captured.err
    assert "(v) pilot:" in captured.out
    assert "(vi) full:" not in captured.out
    assert "snapshot_immutability: PASS" in captured.out


def test_sqlite_timeout_handler_is_always_cleared(tmp_path, monkeypatch):
    snapshot = make_inst_snapshot(tmp_path)
    conn = measure_inst_derive._ro_connect(snapshot)
    monkeypatch.setattr(measure_inst_derive, "SQLITE_PHASE_TIMEOUT_SECONDS", -1)
    monkeypatch.setattr(measure_inst_derive, "SQLITE_PROGRESS_OPCODES", 1)
    try:
        with pytest.raises(measure_inst_derive._SQLitePhaseTimeout):
            with measure_inst_derive._sqlite_execution_bound(conn, "coverage"):
                conn.execute("SELECT COUNT(*) FROM inst_holdings").fetchone()
        assert conn.execute("SELECT COUNT(*) FROM inst_holdings").fetchone()[0] > 0
    finally:
        conn.close()


def test_sqlite_timeout_guard_interrupts_registered_destination(monkeypatch):
    source = sqlite3.connect(":memory:")
    destination = sqlite3.connect(":memory:")
    monkeypatch.setattr(measure_inst_derive, "SQLITE_PHASE_TIMEOUT_SECONDS", 0.01)
    monkeypatch.setattr(measure_inst_derive, "SQLITE_PROGRESS_OPCODES", 1)
    try:
        with pytest.raises(measure_inst_derive._SQLitePhaseTimeout) as caught:
            with measure_inst_derive._sqlite_execution_bound(
                source, "aggregate"
            ) as guard:
                guard.register(destination)
                destination.execute(
                    "WITH RECURSIVE n(x) AS (VALUES(0) UNION ALL"
                    " SELECT x+1 FROM n WHERE x<100000000) SELECT SUM(x) FROM n"
                ).fetchone()
        assert caught.value.phase == "aggregate"
        assert source.execute("SELECT 1").fetchone() == (1,)
        assert destination.execute("SELECT 1").fetchone() == (1,)
    finally:
        source.close()
        destination.close()


def test_sqlite_timeout_guard_checks_the_commit_boundary(monkeypatch):
    source = sqlite3.connect(":memory:")
    destination = sqlite3.connect(":memory:")
    monkeypatch.setattr(measure_inst_derive, "SQLITE_PHASE_TIMEOUT_SECONDS", 60)
    try:
        with pytest.raises(measure_inst_derive._SQLitePhaseTimeout):
            with measure_inst_derive._sqlite_execution_bound(
                source, "aggregate"
            ) as guard:
                guard.register(destination)
                destination.execute("CREATE TABLE result(x INTEGER)")
                destination.execute("INSERT INTO result VALUES (1)")
                guard.checkpoint()
                destination.commit()
                guard.deadline = time.monotonic() - 1
                guard.checkpoint()
        assert source.execute("SELECT 1").fetchone() == (1,)
        assert destination.execute("SELECT COUNT(*) FROM result").fetchone() == (1,)
    finally:
        source.close()
        destination.close()


def test_forced_pilot_destination_timeout_unwinds_the_retained_full_namespace(
    tmp_path, monkeypatch, capsys
):
    snapshot = make_inst_snapshot(tmp_path)
    original_register = measure_inst_derive._SQLiteExecutionGuard.register
    real_materializer = measure_inst_derive.materialized_inst_derivation_views
    events: list[str] = []
    residue: dict[str, int] = {}
    connections: dict[str, sqlite3.Connection] = {}

    def main_name(conn):
        path = next(row[2] for row in conn.execute("PRAGMA database_list")
                    if row[1] == "main")
        return Path(path).name

    @contextmanager
    def materializer_spy(conn):
        label = "full" if main_name(conn) == snapshot.name else "pilot"
        connections[label] = conn
        try:
            with real_materializer(conn):
                events.append(f"{label}-enter")
                yield
        finally:
            try:
                residue[label] = conn.execute(
                    "SELECT COUNT(*) FROM sqlite_temp_schema"
                    " WHERE name LIKE '_populus_inst_%'"
                    " OR name LIKE 'v_filer_reported_%'"
                    " OR name LIKE 'v_default_%'"
                    " OR name = 'v_inst_reconciled_filings'"
                ).fetchone()[0]
            except sqlite3.OperationalError as exc:
                if "interrupted" not in str(exc).lower():
                    raise
            events.append(f"{label}-exit")

    def expire_when_destination_registers(self, conn):
        with self._lock:
            already_registered = bool(self._connections)
        original_register(self, conn)
        if (
            already_registered
            and self.phase == "aggregate"
            and getattr(self, "source_name", "pilot.db") == "pilot.db"
        ):
            self.deadline = time.monotonic() - 1
            self._expire()

    def remember_pilot_source(self, conn):
        with self._lock:
            already_registered = bool(self._connections)
        if not already_registered:
            self.source_name = main_name(conn)
        expire_when_destination_registers(self, conn)

    monkeypatch.setattr(
        measure_inst_derive._SQLiteExecutionGuard,
        "register",
        remember_pilot_source,
    )
    monkeypatch.setattr(
        measure_inst_derive, "materialized_inst_derivation_views", materializer_spy
    )
    code = measure_inst_derive.main([
        "--snapshot", str(snapshot), "--measured-files", "12000", "--full",
    ])
    captured = capsys.readouterr()
    assert code == 4
    assert "phase aggregate" in captured.err
    assert "later phases suppressed" in captured.err
    assert events == ["full-enter", "pilot-enter", "pilot-exit", "full-exit"]
    assert residue["full"] == 0
    assert all(count == 0 for count in residue.values())
    for conn in connections.values():
        with pytest.raises(sqlite3.ProgrammingError, match="closed"):
            conn.execute("SELECT 1")
    assert "(v) pilot:" not in captured.out
    assert "(vi) full:" not in captured.out
    assert "snapshot_immutability: PASS" in captured.out


@pytest.mark.parametrize(
    ("target", "reported_phase"),
    [
        ("coverage", "coverage"),
        ("aggregate", "aggregate"),
        ("destination", "aggregate"),
        ("serving", "serving"),
    ],
)
def test_forced_full_phase_timeouts_unwind_the_retained_namespace(
    tmp_path, monkeypatch, capsys, target, reported_phase
):
    snapshot = make_inst_snapshot(tmp_path)
    original_register = measure_inst_derive._SQLiteExecutionGuard.register
    real_materializer = measure_inst_derive.materialized_inst_derivation_views
    events: list[str] = []
    residue: dict[str, int] = {}
    connections: dict[str, sqlite3.Connection] = {}

    def main_name(conn):
        path = next(row[2] for row in conn.execute("PRAGMA database_list")
                    if row[1] == "main")
        return Path(path).name

    @contextmanager
    def materializer_spy(conn):
        label = "full" if main_name(conn) == snapshot.name else "pilot"
        connections[label] = conn
        try:
            with real_materializer(conn):
                events.append(f"{label}-enter")
                yield
        finally:
            try:
                residue[label] = conn.execute(
                    "SELECT COUNT(*) FROM sqlite_temp_schema"
                    " WHERE name LIKE '_populus_inst_%'"
                    " OR name LIKE 'v_filer_reported_%'"
                    " OR name LIKE 'v_default_%'"
                    " OR name = 'v_inst_reconciled_filings'"
                ).fetchone()[0]
            except sqlite3.OperationalError as exc:
                if "interrupted" not in str(exc).lower():
                    raise
            events.append(f"{label}-exit")

    def expire_selected_full_guard(self, conn):
        with self._lock:
            already_registered = bool(self._connections)
        if not already_registered:
            self.source_name = main_name(conn)
        original_register(self, conn)
        is_full = self.source_name == snapshot.name
        expire_source = (
            not already_registered
            and target != "destination"
            and self.phase == target
        )
        expire_destination = (
            already_registered
            and target == "destination"
            and self.phase == "aggregate"
        )
        if is_full and (expire_source or expire_destination):
            self.deadline = time.monotonic() - 1
            self._expire()

    monkeypatch.setattr(measure_inst_derive, "TOP_FILER_CUT", 1)
    monkeypatch.setattr(
        measure_inst_derive._SQLiteExecutionGuard,
        "register",
        expire_selected_full_guard,
    )
    monkeypatch.setattr(
        measure_inst_derive, "materialized_inst_derivation_views", materializer_spy
    )
    code = measure_inst_derive.main([
        "--snapshot", str(snapshot), "--measured-files", "12000", "--full",
    ])
    captured = capsys.readouterr()
    assert code == 4
    assert f"phase {reported_phase}" in captured.err
    assert "later phases suppressed" in captured.err
    assert events == ["full-enter", "pilot-enter", "pilot-exit", "full-exit"]
    assert residue["pilot"] == 0
    assert all(count == 0 for count in residue.values())
    for conn in connections.values():
        with pytest.raises(sqlite3.ProgrammingError, match="closed"):
            conn.execute("SELECT 1")
    assert "(v) pilot:" in captured.out
    assert "(vi) materialization reuse:" in captured.out
    assert "(vi) full:" not in captured.out
    assert "snapshot_immutability: PASS" in captured.out


@pytest.mark.parametrize("difference", ["hash", "schema", "sidecar"])
def test_d1_forced_state_differences_are_exit_5(
    tmp_path, monkeypatch, capsys, difference
):
    snapshot = make_inst_snapshot(tmp_path)
    state = measure_inst_derive._snapshot_state(snapshot)
    changed = json.loads(json.dumps(state))
    if difference == "hash":
        changed["sha256"] = "0" * 64
    elif difference == "schema":
        changed["main_sqlite_schema"].append(["table", "mutant", "mutant", ""])
    else:
        changed["sidecars"]["-wal"] = True
    states = iter([state, changed])
    monkeypatch.setattr(measure_inst_derive, "_snapshot_state", lambda _p: next(states))
    monkeypatch.setattr(measure_inst_derive, "_run_ladder", lambda *_args: 0)
    code = measure_inst_derive.main(["--snapshot", str(snapshot)])
    assert code == 5
    assert "STOP (D1)" in capsys.readouterr().err


def test_d1_exit_5_precedes_another_nonzero_status(tmp_path, monkeypatch):
    snapshot = make_inst_snapshot(tmp_path)
    state = measure_inst_derive._snapshot_state(snapshot)
    changed = json.loads(json.dumps(state))
    changed["sha256"] = "f" * 64
    states = iter([state, changed])
    monkeypatch.setattr(measure_inst_derive, "_snapshot_state", lambda _p: next(states))
    monkeypatch.setattr(measure_inst_derive, "_run_ladder", lambda *_args: 3)
    assert measure_inst_derive.main(["--snapshot", str(snapshot)]) == 5


def test_d1_matching_state_preserves_another_nonzero_status(tmp_path, monkeypatch):
    snapshot = make_inst_snapshot(tmp_path)
    state = measure_inst_derive._snapshot_state(snapshot)
    monkeypatch.setattr(measure_inst_derive, "_snapshot_state", lambda _p: state)
    monkeypatch.setattr(measure_inst_derive, "_run_ladder", lambda *_args: 3)
    assert measure_inst_derive.main(["--snapshot", str(snapshot)]) == 3


def test_r12_boundary_is_inclusive_at_exactly_one_point_five_gib():
    limit = int(1.5 * (2**30))
    assert limit == measure_inst_derive.R12_AGGREGATE_LIMIT_BYTES
    assert measure_inst_derive._r12_decision(limit) == {
        "aggregate_bytes": limit,
        "limit_bytes": limit,
        "branch": "no_compression",
        "stop": False,
    }
    assert measure_inst_derive._r12_decision(limit + 1) == {
        "aggregate_bytes": limit + 1,
        "limit_bytes": limit,
        "branch": "new_delta_required",
        "stop": True,
    }


def test_binding_output_names_widest_window_and_r12_branch(
    tmp_path, monkeypatch, capsys
):
    snapshot = make_inst_snapshot(tmp_path)
    monkeypatch.setattr(measure_inst_derive, "TOP_FILER_CUT", 1)
    code = measure_inst_derive.main([
        "--snapshot", str(snapshot), "--measured-files", "12000", "--full",
    ])
    out = capsys.readouterr().out
    assert code == 0
    assert "WIDEST valid FilingWindow (--build-date intentionally omitted)" in out
    assert '"branch": "no_compression"' in out
