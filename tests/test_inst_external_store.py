"""RUN M2-11 T4 — the external-snapshot seam (plan R1/R2/R3/R16/R17/R18/R23/R24).

The institutional module derives from an ACCEPTED, immutable, versioned source
snapshot (`stage-build --inst-db`), never from the congress build database.
Everything here runs against hermetic fixture snapshots built with the real
schema DDL (`init_db` → `ensure_inst_schema` + `views.sql`) and finalized by
the SAME code path the owner protocol uses (`scripts/inst_snapshot.py`), so a
green test means the R23 sequence — checkpoint, `journal_mode=DELETE`
asserted, close, no sidecars — actually ran, not that a hand-rolled copy
happened to look similar.

The canonical audit store is never opened; every test input is built here.
"""

from __future__ import annotations

import contextlib
import hashlib
import json
import os
import shutil
import sqlite3
import sys
from pathlib import Path

import pytest
from click.testing import CliRunner

from populus.amendments import (
    ViewVerificationError,
    materialized_inst_derivation_views,
    verify_views,
)
from populus.cli import main as cli_main
from populus.db import connect, init_db
from populus.ingest.inst13f import compute_period_coverage
from populus.publish import build as build_module
from populus.publish.build import (
    LocalDirBackend,
    PublishError,
    finalize_build,
    run_publish,
    stage_build,
)
from populus.publish.digests import (
    LOGICAL_PROJECTIONS,
    logical_digest,
    projection_for,
    sha256_file,
)
from populus.publish.manifest import (
    INST_SOURCE_ARTIFACT,
    INST_SOURCE_SCHEMA,
    find_artifact,
    validate_inst_source,
    validate_manifest,
)

from test_inst_agg import _filer, _hold, _load, _security  # noqa: E402
from test_publish import NOW, make_repo, pin, seed_db  # noqa: E402

SCRIPTS = Path(__file__).resolve().parent.parent / "scripts"
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))
import inst_snapshot  # noqa: E402

CLOSED_PERIOD = "2026-03-31"
OPEN_PERIOD = "2026-06-30"


# --- the hermetic fixture snapshot (R23-faithful) -----------------------------


def _seed_inst_source(path: Path) -> Path:
    """A small but real institutional corpus: two filers, a CLOSED quarter
    (spanned by a definitional 13(f)-list interval) and an OPEN quarter (no
    covering list), every holding resolved so the ≥95% gate publishes.

    The source is switched to WAL mode before the cut, mirroring the canonical
    store — the whole point of the R23 finalization is undoing that on the
    copy.
    """
    init_db(str(path))
    conn = connect(str(path))
    try:
        _filer(conn, "0000000001", "Alpha Capital")
        _filer(conn, "0000000002", "Beta Partners")
        _security(conn, "sec:x")
        _security(conn, "sec:y")
        _load(conn, fid="inst:A-1", cik="0000000001", period=CLOSED_PERIOD,
              filed="2026-04-15",
              holds=[_hold(ordinal=1, issuer="X CO", cusip="111111111",
                           value=2000, security_id="sec:x")])
        _load(conn, fid="inst:B-1", cik="0000000002", period=CLOSED_PERIOD,
              filed="2026-04-16",
              holds=[_hold(ordinal=1, issuer="Y CO", cusip="222222222",
                           value=1000, security_id="sec:y")])
        # The OPEN quarter: filed, fully resolved, but no list interval spans
        # it — the same coverage/withhold machinery must carry it honestly.
        _load(conn, fid="inst:A-2", cik="0000000001", period=OPEN_PERIOD,
              filed="2026-07-10",
              holds=[_hold(ordinal=1, issuer="X CO", cusip="111111111",
                           value=2500, security_id="sec:x")])
        # One definitional list interval covering ONLY the closed quarter.
        conn.execute(
            "INSERT INTO security_list_intervals"
            " (security_id, id_type, value, valid_from, valid_to, quarter,"
            "  is_option, status_flag, provenance, confidence, review_state,"
            "  license_id, source_url, list_sha256, parser_version,"
            "  normalization_version)"
            " VALUES ('sec:x', 'cusip', '111111111', '2026-01-01',"
            " '2026-04-01', '2026q1', 0, '', 'sec-13f-list', 'high', 'auto',"
            " 'sec-13f-list', 'u', 'x', 'p', 'n')"
        )
        conn.execute("PRAGMA journal_mode=WAL")
    finally:
        conn.close()
    return path


def make_inst_snapshot(tmp_path: Path, *, version: int = 1) -> Path:
    """Build a source corpus and cut an ACCEPTED snapshot from it via the real
    `scripts/inst_snapshot.py` protocol (checkpoint → `journal_mode=DELETE`
    asserted → close → no sidecars → read-only reverify → hash → atomic
    rename → 0444)."""
    source = _seed_inst_source(tmp_path / "inst-source-corpus.db")
    dest_dir = tmp_path / "snapshots"
    dest_dir.mkdir(exist_ok=True)
    record = inst_snapshot.cut_snapshot(
        source, dest_dir, snapshot_version=version
    )
    return Path(record["destination"])


def writable_copy(snapshot: Path, dest: Path) -> Path:
    """A mutable copy of a finalized (0444) snapshot, for mutation fixtures."""
    shutil.copyfile(snapshot, dest)
    os.chmod(dest, 0o644)
    return dest


def stage_with_snapshot(tmp_path, snapshot, *, repo_name="populus-data"):
    """stage + finalize one build whose inst module derives from *snapshot*."""
    db = seed_db(tmp_path / f"{repo_name}-populus.db")
    repo = make_repo(tmp_path, repo_name)
    backend = LocalDirBackend(repo)
    staged = stage_build(
        db, repo, now=pin(), backend=backend, inst_db_path=snapshot
    )
    report = finalize_build(staged)
    return repo, backend, staged, report


def read_inst_source_doc(staged) -> dict:
    return json.loads(
        (Path(staged.staging_dir) / "build" / INST_SOURCE_ARTIFACT).read_text(
            encoding="utf-8"
        )
    )


# --- the seam end-to-end (R1/R16/R24) -----------------------------------------


def test_stage_build_derives_inst_from_the_accepted_snapshot(tmp_path):
    """R1: with --inst-db, presence/coverage/watermarks/artifacts all come from
    the snapshot — the congress database carries NO inst data at all — and the
    R24 identity is the snapshot's whole-file SHA-256 plus the fields read from
    its own `inst_source_meta` table."""
    snapshot = make_inst_snapshot(tmp_path)
    expected_sha = sha256_file(snapshot)
    repo, _backend, staged, report = stage_with_snapshot(tmp_path, snapshot)

    assert report.inst_withheld is None
    assert report.inst_logical_digest is not None
    manifest = json.loads(
        (Path(staged.staging_dir) / "build" / "manifest.json").read_text()
    )
    assert set(manifest["modules"]) == {"congress", "inst"}
    # Watermarks read from the SNAPSHOT handle, not the congress snapshot.
    assert manifest["modules"]["inst"]["watermarks"] == {
        "latest_period_of_report": OPEN_PERIOD,
        "latest_filed_date": "2026-07-10",
    }

    # The provenance artifact: strict inst_source/v1, enumerated as an ordinary
    # path-backed artifact, identity == the file hashed BEFORE it was opened.
    doc = read_inst_source_doc(staged)
    assert validate_inst_source(doc) == []
    assert doc["schema"] == INST_SOURCE_SCHEMA
    assert doc["snapshot_sha256"] == expected_sha
    assert doc["snapshot_version"] == 1
    assert doc["snapshot_schema_version"] == inst_snapshot.META_SCHEMA_VERSION
    entry = find_artifact(manifest, INST_SOURCE_ARTIFACT)
    assert entry is not None, "inst_source.json is not enumerated in the manifest"
    assert entry.get("path", "").endswith(f"/{INST_SOURCE_ARTIFACT}")
    assert "logical_digest" not in entry, "an ordinary artifact, never a DB"
    assert validate_manifest(manifest) == []


def test_open_quarter_routes_through_the_same_coverage_machinery(tmp_path):
    """R17 (h): the open quarter appears in the SAME per-period coverage the
    build reports — `covered_by_list` False, numbers identical to what
    `compute_period_coverage` measures on the snapshot directly — never a
    separate code path and never a fabricated zero."""
    snapshot = make_inst_snapshot(tmp_path)
    _repo, _backend, _staged, report = stage_with_snapshot(tmp_path, snapshot)
    by_period = {
        row["period_of_report"]: row for row in report.inst_period_coverage
    }
    assert set(by_period) == {CLOSED_PERIOD, OPEN_PERIOD}
    assert by_period[CLOSED_PERIOD]["covered_by_list"] is True
    assert by_period[OPEN_PERIOD]["covered_by_list"] is False
    ro = sqlite3.connect(f"file:{snapshot}?mode=ro", uri=True)
    try:
        direct = {
            p.period_of_report: p for p in compute_period_coverage(ro)
        }
    finally:
        ro.close()
    for period, row in by_period.items():
        assert row["denominator"] == direct[period].denominator
        assert row["numerator"] == direct[period].numerator
        assert row["coverage"] == direct[period].coverage


# --- (a) read-only enforcement (R2) -------------------------------------------


def test_a_derive_path_write_attempt_is_a_publish_error(tmp_path, monkeypatch):
    """R2 / mutation `drop mode=ro`: a derive-path mutant that WRITES the
    snapshot must surface as a hard PublishError. If the `mode=ro` open were
    dropped, this write would succeed silently and the test would fail —
    killing that mutant.

    The snapshot handed in is a WRITABLE copy on purpose: the finalized 0444
    file mode is defense in depth, and leaving it in place here would let a
    dropped `mode=ro` hide behind the OS permission bit — the same
    OperationalError for a different reason. This test isolates the connection
    mode as the enforcing layer."""
    snapshot = writable_copy(
        make_inst_snapshot(tmp_path), tmp_path / "writable-snap.db"
    )
    real = build_module.build_inst_agg

    def writing_mutant(source_conn, dest_path, **kwargs):
        source_conn.execute("CREATE TABLE mutant_scribble (x)")
        return real(source_conn, dest_path, **kwargs)

    monkeypatch.setattr(build_module, "build_inst_agg", writing_mutant)
    with pytest.raises(PublishError, match="read-only"):
        stage_with_snapshot(tmp_path, snapshot)


# --- (b) view verification (R3) -----------------------------------------------


def test_b_view_drift_refusal_names_the_view(tmp_path):
    """R3 / mutation `skip verify_views`: a snapshot whose stored view SQL
    differs from the shipped views.sql is refused, NAMING the view and the
    remediation. If verify_views were skipped, the drifted view would derive
    successfully here and the raise would not happen."""
    snapshot = make_inst_snapshot(tmp_path)
    drifted = writable_copy(snapshot, tmp_path / "drifted.db")
    conn = sqlite3.connect(str(drifted), isolation_level=None)
    try:
        conn.execute("DROP VIEW v_default_holdings")
        conn.execute(
            "CREATE VIEW v_default_holdings AS SELECT * FROM inst_holdings"
        )
    finally:
        conn.close()
    with pytest.raises(PublishError, match="v_default_holdings") as excinfo:
        stage_with_snapshot(tmp_path, drifted)
    assert "inst_snapshot.py" in str(excinfo.value)


def test_b_missing_view_refusal_names_the_view(tmp_path):
    snapshot = make_inst_snapshot(tmp_path)
    broken = writable_copy(snapshot, tmp_path / "missing-view.db")
    conn = sqlite3.connect(str(broken), isolation_level=None)
    try:
        conn.execute("DROP VIEW v_filer_reported_holdings")
    finally:
        conn.close()
    with pytest.raises(PublishError, match="v_filer_reported_holdings") as excinfo:
        stage_with_snapshot(tmp_path, broken)
    assert "missing" in str(excinfo.value)
    assert "inst_snapshot.py" in str(excinfo.value)


def test_verify_views_is_read_only_and_typed(tmp_path):
    """T1: verify_views never writes, and its error carries the view name."""
    snapshot = make_inst_snapshot(tmp_path)
    before = sha256_file(snapshot)
    ro = sqlite3.connect(f"file:{snapshot}?mode=ro", uri=True)
    try:
        verify_views(ro)  # a matching snapshot passes on a read-only handle
    finally:
        ro.close()
    assert sha256_file(snapshot) == before

    drifted = writable_copy(snapshot, tmp_path / "typed.db")
    conn = sqlite3.connect(str(drifted), isolation_level=None)
    try:
        conn.execute("DROP VIEW v_default_inst_filings")
    finally:
        conn.close()
    ro = sqlite3.connect(f"file:{drifted}?mode=ro", uri=True)
    try:
        with pytest.raises(ViewVerificationError) as excinfo:
            verify_views(ro)
    finally:
        ro.close()
    assert excinfo.value.view_name == "v_default_inst_filings"


# --- (c) interleaving + the single read transaction (R16) ---------------------


def test_c_second_connection_committing_mid_derive_changes_nothing(
    tmp_path, monkeypatch
):
    """R16: a second connection that COMMITS a change mid-derive alters neither
    the observed data nor the recorded identity — the identity was hashed
    before the file was opened, and the single read transaction over the
    immutable-mode handle observes one snapshot state throughout."""
    snapshot = make_inst_snapshot(tmp_path)
    # A control run on a pristine copy, for the observed-data comparison.
    control_dir = tmp_path / "control"
    control_dir.mkdir()
    control_snapshot = writable_copy(snapshot, control_dir / "snap.db")
    _r, _b, control_staged, control_report = stage_with_snapshot(
        control_dir, control_snapshot, repo_name="control-data"
    )

    victim_dir = tmp_path / "victim"
    victim_dir.mkdir()
    victim_snapshot = writable_copy(snapshot, victim_dir / "snap.db")
    pre_hash = sha256_file(victim_snapshot)

    real = build_module.compute_coverage

    def commit_mid_derive(conn):
        writer = sqlite3.connect(str(victim_snapshot), isolation_level=None)
        try:
            writer.execute("BEGIN IMMEDIATE")
            writer.execute(
                "UPDATE inst_holdings SET value_usd = value_usd * 100"
            )
            writer.execute("COMMIT")
        finally:
            writer.close()
        return real(conn)

    monkeypatch.setattr(build_module, "compute_coverage", commit_mid_derive)
    _r, _b, staged, report = stage_with_snapshot(
        victim_dir, victim_snapshot, repo_name="victim-data"
    )
    # The file DID change on disk...
    assert sha256_file(victim_snapshot) != pre_hash
    # ...but the observed data is the pre-commit state...
    assert report.inst_logical_digest == control_report.inst_logical_digest
    assert report.inst_period_coverage == control_report.inst_period_coverage
    # ...and the recorded identity is the hash captured BEFORE the open.
    assert read_inst_source_doc(staged)["snapshot_sha256"] == pre_hash


def test_c_exactly_one_read_transaction_spans_the_derivation(
    tmp_path, monkeypatch
):
    """R16 / mutation `split the transaction`: exactly one BEGIN and one COMMIT
    execute on the snapshot handle, and the COMMIT comes after the last
    projection read. A mutant that commits between phases doubles the count
    and dies here."""
    snapshot = make_inst_snapshot(tmp_path)
    statements: list[str] = []
    real_connect = sqlite3.connect

    class _Recording:
        def __init__(self, conn):
            self._conn = conn

        def execute(self, sql, *args):
            statements.append(sql if isinstance(sql, str) else str(sql))
            return self._conn.execute(sql, *args)

        def __getattr__(self, name):
            return getattr(self._conn, name)

    def recording_connect(database, *args, **kwargs):
        conn = real_connect(database, *args, **kwargs)
        if isinstance(database, str) and "immutable=1" in database:
            return _Recording(conn)
        return conn

    monkeypatch.setattr(build_module.sqlite3, "connect", recording_connect)
    stage_with_snapshot(tmp_path, snapshot)
    begins = [i for i, s in enumerate(statements) if s.strip() == "BEGIN"]
    commits = [i for i, s in enumerate(statements) if s.strip() == "COMMIT"]
    assert len(begins) == 1, statements
    assert len(commits) == 1, statements
    materializations = [
        i
        for i, s in enumerate(statements)
        if s.strip().startswith("CREATE TEMP TABLE v_default_inst_filings")
    ]
    assert len(materializations) == 1, statements
    reported_materializations = [
        i
        for i, s in enumerate(statements)
        if s.strip().startswith("CREATE TEMP TABLE v_filer_reported_filings")
        and "main.v_filer_reported_filings" in s
    ]
    assert len(reported_materializations) == 1, statements
    coverage_totals = [
        i
        for i, s in enumerate(statements)
        if s.strip().startswith(
            "CREATE TEMP TABLE _populus_inst_coverage_totals"
        )
        and "FROM main.inst_holdings" in s
    ]
    assert len(coverage_totals) == 1, statements
    aggregate_inputs = [
        i
        for i, s in enumerate(statements)
        if s.strip().startswith("CREATE TEMP TABLE _populus_inst_agg_input")
        and "FROM main.inst_holdings" in s
    ]
    assert len(aggregate_inputs) == 1, statements
    assert begins[0] < min(
        materializations[0], reported_materializations[0], coverage_totals[0],
        aggregate_inputs[0],
    ), "TEMP setup ran before BEGIN"
    reads = [
        i
        for i, s in enumerate(statements)
        if s.strip().upper().startswith(("SELECT", "WITH", "EXPLAIN"))
        and "v_filer_reported_holdings" in s
    ]
    assert reads, "the serving projection never read the snapshot"
    assert begins[0] < min(
        i for i, s in enumerate(statements) if "sqlite_master" in s
    ), "verify_views ran before the transaction opened"
    assert commits[0] > max(reads), (
        "the transaction ended before the projection finished reading"
    )
    # Review F5: NO snapshot read of any kind may execute after the single
    # COMMIT — the watermarks (and anything else derived from the snapshot)
    # must describe the state the transaction observed. Only the DETACH (and
    # non-reading statements like PRAGMA) may follow. This is asserted over
    # EVERY statement on the instrumented snapshot handle, not just a named
    # view, so a new post-commit read cannot slip past a narrower pattern.
    post_commit = [s.strip() for s in statements[commits[0] + 1 :]]
    offending = [
        s
        for s in post_commit
        if s.upper().startswith(("SELECT", "WITH", "EXPLAIN"))
    ]
    assert offending == [], (
        f"snapshot reads executed AFTER the single COMMIT: {offending}"
    )


def test_materialization_changes_neither_snapshot_bytes_nor_main_schema(tmp_path):
    snapshot = make_inst_snapshot(tmp_path)
    before_hash = sha256_file(snapshot)
    ro = sqlite3.connect(
        f"file:{snapshot}?mode=ro&immutable=1", uri=True, isolation_level=None
    )
    try:
        schema = ro.execute(
            "SELECT type, name, tbl_name, COALESCE(sql, '')"
            " FROM main.sqlite_schema ORDER BY type, name, tbl_name, sql"
        ).fetchall()
        with materialized_inst_derivation_views(ro):
            assert ro.execute(
                "SELECT COUNT(*) FROM temp.v_default_inst_filings"
            ).fetchone()[0] > 0
            assert ro.execute(
                "SELECT type, name FROM sqlite_temp_schema"
                " WHERE name LIKE 'v_default_%'"
                " OR name LIKE 'v_filer_reported_%'"
                " OR name = 'v_inst_reconciled_filings'"
                " OR name LIKE '_populus_inst_%'"
                " ORDER BY name"
            ).fetchall() == [
                ("table", "_populus_inst_agg_input"),
                ("table", "_populus_inst_coverage_totals"),
                ("index", "_populus_inst_coverage_totals_by_filing"),
                ("view", "v_default_holdings"),
                ("table", "v_default_inst_filings"),
                ("index", "v_default_inst_filings_by_filing"),
                ("table", "v_filer_reported_filings"),
                ("index", "v_filer_reported_filings_by_filing"),
                ("view", "v_filer_reported_holdings"),
                ("table", "v_inst_reconciled_filings"),
            ]
            assert ro.execute(
                "SELECT type, name, tbl_name, COALESCE(sql, '')"
                " FROM main.sqlite_schema ORDER BY type, name, tbl_name, sql"
            ).fetchall() == schema
        assert ro.execute(
            "SELECT name FROM sqlite_temp_schema"
            " WHERE name LIKE 'v_default_%'"
            " OR name LIKE 'v_filer_reported_%'"
            " OR name = 'v_inst_reconciled_filings'"
            " OR name LIKE '_populus_inst_%'"
        ).fetchall() == []
    finally:
        ro.close()
    assert sha256_file(snapshot) == before_hash
    assert all(
        not Path(f"{snapshot}{suffix}").exists()
        for suffix in ("-journal", "-wal", "-shm")
    )


def test_materialized_aggregate_and_complete_serving_projection_parity(tmp_path):
    """D6/D9: both artifact meanings and every serving field are identical."""
    from populus.inst_agg import build_inst_agg
    from populus.inst_serving import (
        build_serving_projection,
        publication_periods,
        write_serving_db,
    )
    from populus.publish.manifest import INST_MODULE, INST_SERVING_ARTIFACT

    snapshot = make_inst_snapshot(tmp_path)

    def derive(label, materialized):
        conn = sqlite3.connect(
            f"file:{snapshot}?mode=ro&immutable=1", uri=True, isolation_level=None
        )
        agg_path = tmp_path / f"{label}-agg.db"
        serving_path = tmp_path / f"{label}-serving.db"
        try:
            scope = (
                materialized_inst_derivation_views(conn)
                if materialized
                else contextlib.nullcontext()
            )
            with scope:
                build_inst_agg(conn, agg_path, ingested_at="2026-01-01T00:00:00Z")
                periods = publication_periods(conn)
                conn.execute("ATTACH DATABASE ? AS inst_agg", (str(agg_path),))
                try:
                    projection = build_serving_projection(conn, periods=periods)
                finally:
                    conn.execute("DETACH DATABASE inst_agg")
                write_serving_db(projection, serving_path, source_conn=conn)
        finally:
            conn.close()
        agg = sqlite3.connect(str(agg_path))
        serving = sqlite3.connect(str(serving_path))
        try:
            return (
                logical_digest(agg, LOGICAL_PROJECTIONS[INST_MODULE]),
                logical_digest(
                    serving,
                    projection_for(INST_SERVING_ARTIFACT, INST_MODULE),
                ),
                projection,
            )
        finally:
            agg.close()
            serving.close()

    baseline = derive("baseline", False)
    materialized = derive("materialized", True)
    assert materialized == baseline


def test_withholding_path_cleans_the_materialized_namespace(tmp_path):
    snapshot = make_inst_snapshot(tmp_path)
    source = writable_copy(snapshot, tmp_path / "withheld.db")
    conn = sqlite3.connect(str(source), isolation_level=None)
    try:
        conn.execute("UPDATE inst_holdings SET security_id = NULL")
        result = build_module._derive_inst_module(
            conn,
            inst_agg_path=tmp_path / "withheld-agg.db",
            inst_serving_path=tmp_path / "withheld-serving.db",
            created_at="2026-01-01T00:00:00Z",
        )
        assert result["inst_withheld"] is not None
        assert conn.execute(
            "SELECT name FROM sqlite_temp_schema"
            " WHERE name LIKE 'v_default_%'"
            " OR name LIKE 'v_filer_reported_%'"
            " OR name LIKE '_populus_inst_%'"
        ).fetchall() == []
    finally:
        conn.close()


# --- (d) identity mutations (R16) ---------------------------------------------


@pytest.mark.parametrize(
    "label, mutate",
    [
        (
            "holding_value",
            "UPDATE inst_holdings SET value_usd = value_usd + 1"
            " WHERE holding_id = (SELECT holding_id FROM inst_holdings"
            " ORDER BY holding_id LIMIT 1)",
        ),
        (
            "security_mapping",
            "UPDATE inst_holdings SET security_id = NULL"
            " WHERE holding_id = (SELECT holding_id FROM inst_holdings"
            " ORDER BY holding_id LIMIT 1)",
        ),
        (
            "filer_name",
            "UPDATE inst_filers SET name_raw = 'Renamed Capital'"
            " WHERE cik = '0000000001'",
        ),
        (
            "filing_lifecycle",
            "UPDATE inst_filings SET lifecycle = 'superseded'"
            " WHERE filing_id = 'inst:A-1'",
        ),
        (
            "view_definition",
            "DROP VIEW v_amendment_pairs",
        ),
    ],
)
def test_d_each_identity_mutation_changes_the_snapshot_hash(
    tmp_path, label, mutate
):
    """R16: the identity is the WHOLE-FILE hash, so every derivation-relevant
    byte inside the snapshot moves it — a value, a mapping, a name, a
    lifecycle field, a view definition. Each copy carries exactly ONE change
    and must produce a different hash than the original."""
    snapshot = make_inst_snapshot(tmp_path)
    baseline = sha256_file(snapshot)
    mutated = writable_copy(snapshot, tmp_path / f"mut-{label}.db")
    conn = sqlite3.connect(str(mutated), isolation_level=None)
    try:
        conn.execute(mutate)
    finally:
        conn.close()
    assert sha256_file(mutated) != baseline, (
        f"mutation {label!r} did not move the snapshot identity"
    )


def test_d_all_five_mutations_produce_five_distinct_hashes(tmp_path):
    snapshot = make_inst_snapshot(tmp_path)
    hashes = {sha256_file(snapshot)}
    for label, mutate in (
        ("value", "UPDATE inst_holdings SET value_usd = value_usd + 1"
                  " WHERE holding_id = (SELECT holding_id FROM inst_holdings"
                  " ORDER BY holding_id LIMIT 1)"),
        ("mapping", "UPDATE inst_holdings SET security_id = NULL"
                    " WHERE holding_id = (SELECT holding_id FROM inst_holdings"
                    " ORDER BY holding_id LIMIT 1)"),
        ("name", "UPDATE inst_filers SET name_raw = 'Renamed Capital'"
                 " WHERE cik = '0000000001'"),
        ("lifecycle", "UPDATE inst_filings SET lifecycle = 'superseded'"
                      " WHERE filing_id = 'inst:A-1'"),
        ("view", "DROP VIEW v_amendment_pairs"),
    ):
        mutated = writable_copy(snapshot, tmp_path / f"five-{label}.db")
        conn = sqlite3.connect(str(mutated), isolation_level=None)
        try:
            conn.execute(mutate)
        finally:
            conn.close()
        hashes.add(sha256_file(mutated))
    assert len(hashes) == 6


# --- (e) congress parity (R1/R18) ---------------------------------------------


def test_e_no_inst_db_is_byte_identical_and_honestly_not_built(tmp_path):
    """R1/R18: `stage_build` without `--inst-db` on a congress-only fixture is
    byte-identical whether the parameter is omitted or passed as None — the
    None path IS the pre-change path (the parameter defaults to None, so every
    pre-existing caller compiles to it) — and the honest 'not built' outcome
    still occurs: no inst module, no inst_source.json, nothing withheld."""
    outputs = []
    for name, kwargs in (
        ("omitted", {}),
        ("explicit-none", {"inst_db_path": None}),
    ):
        sub = tmp_path / name
        sub.mkdir()
        db = seed_db(sub / "populus.db")
        repo = make_repo(sub)
        staged = stage_build(
            db, repo, now=pin(), backend=LocalDirBackend(repo), **kwargs
        )
        report = finalize_build(staged)
        assert report.inst_logical_digest is None
        assert report.inst_withheld is None
        build_dir = Path(staged.staging_dir) / "build"
        assert not (build_dir / INST_SOURCE_ARTIFACT).exists()
        manifest = json.loads((build_dir / "manifest.json").read_text())
        assert set(manifest["modules"]) == {"congress"}
        tree = {
            p.relative_to(build_dir).as_posix(): hashlib.sha256(
                p.read_bytes()
            ).hexdigest()
            for p in sorted(build_dir.rglob("*"))
            if p.is_file()
        }
        outputs.append(tree)
    assert outputs[0] == outputs[1], "the None path diverged from the default"


# --- (f) manifest compatibility + the generic installer (R24) -----------------


def _publish_with_snapshot(tmp_path, snapshot):
    db = seed_db(tmp_path / "populus.db")
    repo = make_repo(tmp_path)
    backend = LocalDirBackend(repo)
    staged = stage_build(
        db, repo, now=pin(), backend=backend, inst_db_path=snapshot
    )
    finalize_build(staged)
    run_publish(repo, now=pin(), backend=backend)
    return repo


def test_f_old_manifests_without_inst_source_still_validate(tmp_path):
    snapshot = make_inst_snapshot(tmp_path)
    repo = _publish_with_snapshot(tmp_path, snapshot)
    build_id = json.loads((repo / "latest.json").read_text())["build_id"]
    manifest = json.loads(
        (repo / "builds" / build_id / "manifest.json").read_text()
    )
    # The new build's manifest round-trips validation with the entry present.
    assert validate_manifest(manifest) == []
    assert find_artifact(manifest, INST_SOURCE_ARTIFACT) is not None
    # An OLD manifest — the same document without the artifact — still
    # validates: the entry is optional at the validator, required only at the
    # producer (the R24 compensating-control pattern from M2-8 M12).
    old = json.loads(json.dumps(manifest))
    old["modules"]["congress"]["artifacts"] = [
        entry
        for entry in old["modules"]["congress"]["artifacts"]
        if entry["name"] != INST_SOURCE_ARTIFACT
    ]
    assert validate_manifest(old) == []


def test_f_inst_source_entry_must_not_carry_a_logical_digest(tmp_path):
    snapshot = make_inst_snapshot(tmp_path)
    repo = _publish_with_snapshot(tmp_path, snapshot)
    build_id = json.loads((repo / "latest.json").read_text())["build_id"]
    manifest = json.loads(
        (repo / "builds" / build_id / "manifest.json").read_text()
    )
    entry = find_artifact(manifest, INST_SOURCE_ARTIFACT)
    entry["logical_digest"] = "ab" * 32
    assert any(
        INST_SOURCE_ARTIFACT in error and "logical_digest" in error
        for error in validate_manifest(manifest)
    )


def test_f_generic_installer_handles_the_new_artifact_unchanged(tmp_path):
    """R24 (locked, round-4 N2): client/snapshot.py installs inst_source.json
    through its EXISTING ordinary-artifact path — this test exercises that
    path over the new artifact; the file itself is deliberately not edited."""
    from populus.client.snapshot import LocalRepoFetcher, SnapshotClient

    snapshot = make_inst_snapshot(tmp_path)
    repo = _publish_with_snapshot(tmp_path, snapshot)
    fetcher = LocalRepoFetcher(repo)
    client = SnapshotClient(tmp_path / "cache", fetcher, now=pin(), module="congress")
    assert client.refresh().status == "installed"
    build_id = client.current_build()
    installed = tmp_path / "cache" / "congress" / build_id / INST_SOURCE_ARTIFACT
    assert installed.is_file(), (
        "the generic installer did not install the ordinary provenance artifact"
    )
    doc = json.loads(installed.read_text(encoding="utf-8"))
    assert validate_inst_source(doc) == []
    assert doc["snapshot_sha256"] == sha256_file(snapshot)

    # The inst module client still installs and serves both databases.
    inst = SnapshotClient(tmp_path / "cache", fetcher, now=pin(), module="inst")
    assert inst.refresh().status == "installed"
    assert inst.db_path() is not None


def test_f_producer_guard_refuses_a_build_that_skips_the_emission(
    tmp_path, monkeypatch
):
    """R24 producer guard: a build given --inst-db that fails to emit
    inst_source.json is a PublishError — 'optional at the validator' is safe
    only because THIS fails."""
    snapshot = make_inst_snapshot(tmp_path)
    real = build_module._write_staged

    def skipping_mutant(build_dir, relpath, text):
        if relpath == INST_SOURCE_ARTIFACT:
            return  # the mutant: emission silently dropped
        return real(build_dir, relpath, text)

    monkeypatch.setattr(build_module, "_write_staged", skipping_mutant)
    with pytest.raises(PublishError, match="inst_source.json"):
        stage_with_snapshot(tmp_path, snapshot)


def test_meta_refusals_name_the_protocol(tmp_path):
    """R24: a snapshot without a strict single-row inst_source_meta was not cut
    by the R23 protocol and is refused with the remediation named."""
    snapshot = make_inst_snapshot(tmp_path)
    # missing table
    no_meta = writable_copy(snapshot, tmp_path / "no-meta.db")
    conn = sqlite3.connect(str(no_meta), isolation_level=None)
    try:
        conn.execute("DROP TABLE inst_source_meta")
    finally:
        conn.close()
    with pytest.raises(PublishError, match="inst_source_meta"):
        stage_with_snapshot(tmp_path, no_meta)
    # two rows
    two_rows = writable_copy(snapshot, tmp_path / "two-rows.db")
    conn = sqlite3.connect(str(two_rows), isolation_level=None)
    try:
        conn.execute(
            "INSERT INTO inst_source_meta SELECT * FROM inst_source_meta"
        )
    finally:
        conn.close()
    with pytest.raises(PublishError, match="exactly one row"):
        (tmp_path / "two").mkdir()
        stage_with_snapshot(tmp_path / "two", two_rows)


# --- (g) snapshot finalization (R23) ------------------------------------------


def test_g_finalized_snapshot_is_delete_mode_standalone_and_reverified(tmp_path):
    snapshot = make_inst_snapshot(tmp_path)
    assert oct(snapshot.stat().st_mode & 0o777) == oct(0o444)
    assert not Path(str(snapshot) + "-wal").exists()
    assert not Path(str(snapshot) + "-shm").exists()
    ro = sqlite3.connect(f"file:{snapshot}?mode=ro", uri=True)
    try:
        (mode,) = ro.execute("PRAGMA journal_mode").fetchone()
        assert mode == "delete"
        verify_views(ro)
        (integrity,) = ro.execute("PRAGMA integrity_check").fetchone()
        assert integrity == "ok"
    finally:
        ro.close()
    # No sidecars even after the read-only reopen — the measured WAL trap.
    assert not Path(str(snapshot) + "-wal").exists()
    assert not Path(str(snapshot) + "-shm").exists()


def test_g_reopen_under_0444_and_a_non_writable_directory_works(tmp_path):
    snapshot = make_inst_snapshot(tmp_path)
    directory = snapshot.parent
    os.chmod(directory, 0o555)
    try:
        ro = sqlite3.connect(f"file:{snapshot}?mode=ro&immutable=1", uri=True)
        try:
            verify_views(ro)
            assert ro.execute(
                "SELECT COUNT(*) FROM inst_holdings"
            ).fetchone()[0] > 0
        finally:
            ro.close()
    finally:
        os.chmod(directory, 0o755)


def test_g_mutant_skipping_journal_mode_delete_is_caught(tmp_path):
    """Mutation `skip journal_mode=DELETE`: the copy passes the FIRST no-sidecar
    check (a clean close leaves none — measured), but the read-only reverify
    reports mode 'wal' and recreates sidecars, so the protocol refuses."""
    source = _seed_inst_source(tmp_path / "src.db")
    copy = tmp_path / "mutant-copy.db"
    src = sqlite3.connect(f"file:{source}?mode=ro", uri=True)
    try:
        dest = sqlite3.connect(str(copy))
        try:
            src.backup(dest)
        finally:
            dest.close()
    finally:
        src.close()
    inst_snapshot.finalize_copy(
        copy, snapshot_version=1, switch_journal_mode=False
    )
    with pytest.raises(inst_snapshot.SnapshotCutError, match="delete"):
        inst_snapshot.reverify_copy(copy)


def test_g_interrupted_cut_leaves_no_destination(tmp_path, monkeypatch):
    source = _seed_inst_source(tmp_path / "src.db")
    dest_dir = tmp_path / "snapshots"
    dest_dir.mkdir()

    def boom(_copy_path):
        raise RuntimeError("interrupted mid-cut")

    monkeypatch.setattr(inst_snapshot, "reverify_copy", boom)
    with pytest.raises(RuntimeError, match="interrupted"):
        inst_snapshot.cut_snapshot(source, dest_dir, snapshot_version=1)
    assert list(dest_dir.iterdir()) == [], (
        "an interrupted cut left files in the destination directory"
    )


def test_g_existing_destination_is_refused(tmp_path):
    source = _seed_inst_source(tmp_path / "src.db")
    dest_dir = tmp_path / "snapshots"
    dest_dir.mkdir()
    inst_snapshot.cut_snapshot(source, dest_dir, snapshot_version=1)
    with pytest.raises(inst_snapshot.SnapshotCutError, match="already exists"):
        inst_snapshot.cut_snapshot(source, dest_dir, snapshot_version=1)


# --- T3: the CLI refusals -----------------------------------------------------


def _cli_stage_args(tmp_path, inst_db: str) -> list[str]:
    db = seed_db(tmp_path / "populus.db")
    repo = make_repo(tmp_path)
    return [
        "stage-build",
        "--db", str(db),
        "--data-repo", str(repo),
        "--attestation", "staging-noop",
        "--inst-db", inst_db,
    ]


def test_cli_refuses_a_missing_inst_db(tmp_path):
    result = CliRunner().invoke(
        cli_main, _cli_stage_args(tmp_path, str(tmp_path / "absent.db"))
    )
    assert result.exit_code != 0
    assert "does not exist" in result.output
    assert "inst_snapshot.py" in result.output


def test_cli_refuses_a_directory_inst_db(tmp_path):
    directory = tmp_path / "a-directory"
    directory.mkdir()
    result = CliRunner().invoke(
        cli_main, _cli_stage_args(tmp_path, str(directory))
    )
    assert result.exit_code != 0
    assert "is a directory" in result.output


def test_cli_refuses_a_writable_inst_db(tmp_path):
    writable = tmp_path / "writable.db"
    writable.write_bytes(b"not even sqlite")
    result = CliRunner().invoke(
        cli_main, _cli_stage_args(tmp_path, str(writable))
    )
    assert result.exit_code != 0
    assert "writable" in result.output
    assert "chmod 444" in result.output


def test_cli_accepts_a_finalized_snapshot(tmp_path):
    snapshot = make_inst_snapshot(tmp_path)
    result = CliRunner().invoke(
        cli_main, _cli_stage_args(tmp_path, str(snapshot))
    )
    assert result.exit_code == 0, result.output
    assert "build_id=" in result.output  # the machine-readable contract lines
    assert "staging_dir=" in result.output
