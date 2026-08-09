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
    assert "(iv) plan coverage_denominator" in out
    assert "(v) pilot" in out
    # The pilot record carries peak RSS and per-phase wall clock.
    pilot_line = next(
        line for line in out.splitlines() if line.startswith("(v) pilot: ")
    )
    pilot = json.loads(pilot_line[len("(v) pilot: "):])
    assert pilot["peak_rss_bytes"] > 0
    assert "coverage_s" in pilot and "aggregate_s" in pilot
    assert pilot["tail_payloads"]["ceiling_bytes"] == 1 << 20


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
    assert dist["shard_limit"] == 256  # inst_budget.FILER_TAIL_SHARDS_RESERVED
    assert dist["routing_index_files"] == 1
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
        "deltasByPeriod", "latestFiled", "topn", "window",
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
