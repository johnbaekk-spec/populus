#!/usr/bin/env python
"""RUN M2-11 T8 (plan R21) — composition acceptance for the accepted-snapshot
publish path.

Follows the house pattern (`accept_m2_5.py`, `accept_m2_6.py`,
`accept_m2_8.py`): it **never skips**. Every input this gate needs is built
here or is a committed file; an absent one is a hard failure naming the exact
path and its remediation, so a green result always means the path actually
ran.

What is composed, in the order the publish job performs it:

    cut an accepted snapshot (the REAL scripts/inst_snapshot.py protocol)
      -> stage-build --inst-db: ro+immutable open -> view verify -> ONE read
         transaction -> identity captured before the open -> coverage ->
         aggregate -> serving -> manifest module injection -> inst_source.json
      -> the refusal paths (writable store, drifted view, missing view, and the
         UNSET path that must still be today's congress-only build)
      -> congress byte-identity against a baseline build (R18)
      -> the repo-wide runner-governance sweep (R7)
      -> the file-budget arithmetic incl. the two M2-11 terms (R22/R27)
      -> manifest compatibility and the generic installer (R24)

Why a composition and not "the tests already cover it": the unit suite proves
each seam in isolation with the neighbouring one stubbed. This gate runs them
against each other, on one snapshot, through the CLI the workflow actually
invokes — which is where a flag that never reaches `stage_build`, or a
provenance artifact that validates but is never enumerated, shows up.

Every number printed is measured from this run, never asserted from the plan.
"""

from __future__ import annotations

import hashlib
import json
import shutil
import sqlite3
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "src"))
sys.path.insert(0, str(ROOT / "tests"))
sys.path.insert(0, str(ROOT / "scripts"))

FAILURES: list[str] = []
NOTES: list[str] = []


def check(condition: bool, ok: str, bad: str) -> None:
    (NOTES if condition else FAILURES).append(ok if condition else bad)


def require_input(path: Path, what: str, remediation: str) -> None:
    """A missing input is a hard ERROR, never a skip (R21).

    Raised rather than recorded: the checks below are written assuming their
    inputs exist, and a gate that continues past a missing input reports on
    something other than what it claims to.
    """
    if not path.exists():
        raise SystemExit(
            f"accept-m2-11 cannot run: {what} is missing at {path}.\n"
            f"  remediation: {remediation}\n"
            "  This gate never skips — a missing input is a failure."
        )


class _RecordingConnection:
    """Records every statement executed on the snapshot handle.

    Only the immutable-mode handle is wrapped (see `_recording_connect`), so
    the congress build's own connections are untouched and the transaction
    count below means what it says.
    """

    def __init__(self, conn: sqlite3.Connection, log: list[str]) -> None:
        self._conn = conn
        self._log = log

    def execute(self, sql, *args):  # noqa: ANN001 - proxies sqlite3's own signature
        self._log.append(sql if isinstance(sql, str) else str(sql))
        return self._conn.execute(sql, *args)

    def __getattr__(self, name):  # noqa: ANN001
        return getattr(self._conn, name)


def main() -> int:  # noqa: PLR0912, PLR0915 - a linear acceptance script, deliberately flat
    from click.testing import CliRunner

    from populus.cli import main as cli_main
    from populus.inst_budget import (
        ACTIVITY_SHARDS_MAX,
        FILER_ROUTING_INDEX_FILES,
        FILER_SHARD_BYTE_CEILING,
        FILER_TAIL_SHARDS_RESERVED,
        FILER_V1_TRANSITION_FILES,
        GLOBAL_FILE_CAP,
        M1_MEASURED_PAGES,
        M2_FILER_PAGES,
        M3_RESERVED,
        MAX_SHARD_BYTES,
        PROVIDER_FILE_LIMIT,
        SITE_CHROME_FILES,
        worst_case_file_count,
    )
    from populus.ingest.inst13f import compute_period_coverage
    from populus.publish.build import (
        LocalDirBackend,
        PublishError,
        finalize_build,
        run_publish,
        stage_build,
    )
    from populus.publish.attestation import StagingNoop
    from populus.publish.digests import sha256_file
    from populus.publish.manifest import (
        INST_DB_ARTIFACT,
        INST_MODULE,
        INST_SERVING_ARTIFACT,
        INST_SOURCE_ARTIFACT,
        find_artifact,
        validate_inst_source,
        validate_manifest,
    )

    require_input(
        ROOT / "scripts" / "inst_snapshot.py",
        "the accepted-snapshot cutter",
        "restore scripts/inst_snapshot.py — this gate cuts its fixture with the"
        " real R23 protocol and will not hand-roll a substitute",
    )
    require_input(
        ROOT / "tests" / "test_inst_external_store.py",
        "the seam test module (its fixture builders are reused here)",
        "restore tests/test_inst_external_store.py",
    )
    require_input(
        ROOT / "tests" / "test_workflow_governance.py",
        "the repo-wide workflow governance sweep",
        "restore tests/test_workflow_governance.py",
    )
    require_input(
        ROOT / ".github" / "workflows" / "publish.yml",
        "the publish workflow",
        "restore .github/workflows/publish.yml",
    )

    import inst_snapshot  # noqa: E402 - after the sys.path insert above
    import test_workflow_governance as governance  # noqa: E402
    from test_inst_external_store import (  # noqa: E402
        CLOSED_PERIOD,
        OPEN_PERIOD,
        make_inst_snapshot,
        writable_copy,
    )
    from test_publish import make_repo, pin, seed_db  # noqa: E402

    # This gate is hermetic and signs nothing, so the no-op provider is the
    # honest choice — but it is passed EXPLICITLY at every call site.
    # `tests/test_attestation_structure.py` forbids production code (`src/`
    # and `scripts/`, which includes this file) from omitting the argument:
    # an omission has no string to grep for and silently inherits a verifier
    # that answers "verified" to everything.
    unattested = StagingNoop()

    tmp = Path(tempfile.mkdtemp(prefix="accept-m2-11."))
    print(f"workspace: {tmp}")

    def workdir(name: str) -> Path:
        """A fresh sub-workspace. The test fixture builders take an EXISTING
        directory (pytest hands them `tmp_path`), so creating it here is what
        keeps this gate on the same helpers the suite uses instead of forking
        them."""
        path = tmp / name
        path.mkdir(parents=True, exist_ok=True)
        return path

    # --- 1. an accepted snapshot, cut by the real protocol --------------------
    snapshot = make_inst_snapshot(workdir("cut"))
    snapshot_sha = sha256_file(snapshot)
    mode = snapshot.stat().st_mode & 0o777
    check(
        mode == 0o444,
        f"the cut snapshot is sealed 0444 ({snapshot.name})",
        f"the cut snapshot is mode {oct(mode)}, not 0444 — an accepted"
        " snapshot must be immutable before it is ever published",
    )
    check(
        not Path(str(snapshot) + "-wal").exists()
        and not Path(str(snapshot) + "-shm").exists(),
        "the cut snapshot is standalone (no -wal/-shm sidecars)",
        "the cut snapshot kept a WAL family — the journal-mode switch did not"
        " take, and the file is not self-contained",
    )
    print(f"snapshot: {snapshot.name} {snapshot.stat().st_size:,} B"
          f" sha256 {snapshot_sha[:12]}…")

    # --- 2. stage-build --inst-db, instrumented ------------------------------
    # The whole derivation is observed through the snapshot handle: the URI it
    # was opened with, and every statement executed on it. This is what turns
    # "ro open / single transaction" from a code-reading claim into a measured
    # one.
    statements: list[str] = []
    opened_uris: list[str] = []
    real_connect = sqlite3.connect

    def _recording_connect(database, *args, **kwargs):  # noqa: ANN001
        conn = real_connect(database, *args, **kwargs)
        if isinstance(database, str) and "immutable=1" in database:
            opened_uris.append(database)
            return _RecordingConnection(conn, statements)
        return conn

    inst_run = workdir("inst-run")
    congress_db = seed_db(inst_run / "populus.db")
    inst_repo = make_repo(inst_run, "populus-data")
    sqlite3.connect = _recording_connect  # type: ignore[assignment]
    try:
        staged = stage_build(
            congress_db,
            inst_repo,
            now=pin(),
            backend=LocalDirBackend(inst_repo),
            attestation=unattested,
            inst_db_path=snapshot,
        )
        report = finalize_build(staged)
    finally:
        sqlite3.connect = real_connect  # type: ignore[assignment]

    check(
        len(opened_uris) == 1
        and "mode=ro" in opened_uris[0]
        and "immutable=1" in opened_uris[0],
        f"the snapshot is opened exactly once, read-only + immutable"
        f" ({opened_uris[0].split('?')[-1] if opened_uris else 'no open'})",
        f"snapshot opens were {opened_uris!r} — R2 requires exactly one"
        " mode=ro&immutable=1 handle",
    )
    begins = [i for i, s in enumerate(statements) if s.strip() == "BEGIN"]
    commits = [i for i, s in enumerate(statements) if s.strip() == "COMMIT"]
    check(
        len(begins) == 1 and len(commits) == 1,
        "the derivation spans exactly ONE read transaction"
        f" ({len(statements)} statements on the snapshot handle)",
        f"{len(begins)} BEGIN / {len(commits)} COMMIT on the snapshot handle —"
        " R16 requires one transaction, or the identity describes a state the"
        " derivation never saw as a whole",
    )
    view_reads = [s for s in statements if "sqlite_master" in s]
    check(
        bool(view_reads) and begins and statements.index(view_reads[0]) > begins[0],
        "view verification reads the snapshot INSIDE the transaction",
        "the view verification did not run inside the read transaction",
    )
    check(
        any("v_filer_reported_holdings" in s for s in statements),
        "the serving projection read the snapshot's reported views",
        "no read of v_filer_reported_holdings — the serving projection did not"
        " derive from the snapshot",
    )

    build_dir = Path(staged.staging_dir) / "build"
    manifest = json.loads((build_dir / "manifest.json").read_text(encoding="utf-8"))
    check(
        set(manifest["modules"]) == {"congress", INST_MODULE},
        "the manifest carries BOTH modules (inst injected from the snapshot)",
        f"manifest modules are {sorted(manifest['modules'])} — the inst module"
        " was not injected from the snapshot",
    )
    check(
        report.inst_withheld is None and report.inst_logical_digest is not None,
        f"the inst module published (logical_digest"
        f" {(report.inst_logical_digest or '')[:12]}…)",
        f"the inst module did not publish: withheld={report.inst_withheld!r}",
    )
    # The two derived databases are RELEASE assets, not files under `build/`
    # (§5.5: databases go to Releases, the small JSON tree is committed), so
    # they are located by walking the staging dir rather than assumed to sit
    # beside the manifest — an assumption that would have made this check pass
    # or fail for the wrong reason.
    staged_files = {
        p.name: p for p in Path(staged.staging_dir).rglob("*") if p.is_file()
    }
    for artifact in (INST_DB_ARTIFACT, INST_SERVING_ARTIFACT):
        # `find_artifact` defaults to the congress module — the derived
        # databases live under `inst`, so the module is named explicitly.
        entry = find_artifact(manifest, artifact, INST_MODULE)
        staged_file = staged_files.get(artifact)
        check(
            entry is not None
            and "logical_digest" in entry
            and staged_file is not None
            and staged_file.stat().st_size > 0,
            f"{artifact} was aggregated/served, staged"
            f" ({(staged_file.stat().st_size if staged_file else 0):,} B) and"
            " enumerated with a logical digest",
            f"{artifact} is missing from the staged build or from the manifest"
            f" (entry={entry is not None}, staged={staged_file is not None})",
        )

    # Coverage is compared against what the snapshot itself measures — the
    # build must not have its own arithmetic (R17: the open quarter included).
    ro = real_connect(f"file:{snapshot}?mode=ro", uri=True)
    try:
        direct = {p.period_of_report: p for p in compute_period_coverage(ro)}
    finally:
        ro.close()
    measured = {row["period_of_report"]: row for row in report.inst_period_coverage or []}
    check(
        set(measured) == set(direct) == {CLOSED_PERIOD, OPEN_PERIOD},
        f"per-period coverage covers every period in the snapshot"
        f" ({', '.join(sorted(measured))})",
        f"coverage periods {sorted(measured)} != snapshot periods"
        f" {sorted(direct)}",
    )
    check(
        all(
            measured[p]["numerator"] == direct[p].numerator
            and measured[p]["denominator"] == direct[p].denominator
            for p in direct
        ),
        "the build's coverage numbers equal the snapshot's own measurement",
        "the build's coverage numbers diverge from compute_period_coverage on"
        " the snapshot — one of the two is not measuring the source",
    )
    check(
        measured.get(OPEN_PERIOD, {}).get("covered_by_list") is False,
        "the OPEN quarter is carried honestly (covered_by_list false), not"
        " dropped and not fabricated",
        "the open quarter lost its honest coverage flag (R17)",
    )

    # The provenance artifact: emitted, strict-valid, identity == the bytes
    # hashed BEFORE the file was opened, enumerated as an ORDINARY artifact.
    source_doc_path = build_dir / INST_SOURCE_ARTIFACT
    check(
        source_doc_path.is_file(),
        f"{INST_SOURCE_ARTIFACT} was emitted by the build",
        f"{INST_SOURCE_ARTIFACT} was not emitted — the R24 producer guard did"
        " not fire either, which is worse than the missing file",
    )
    if source_doc_path.is_file():
        doc = json.loads(source_doc_path.read_text(encoding="utf-8"))
        errors = validate_inst_source(doc)
        check(
            errors == [],
            "the provenance document validates against inst_source/v1",
            f"the provenance document is invalid: {errors}",
        )
        check(
            doc.get("snapshot_sha256") == snapshot_sha,
            "the recorded source identity IS the snapshot's whole-file SHA-256",
            f"recorded identity {doc.get('snapshot_sha256')} !="
            f" measured {snapshot_sha}",
        )
        # Read from INSIDE the hashed file, never from the filename: the
        # cutter's own constant is the only thing this may agree with.
        check(
            doc.get("snapshot_schema_version") == inst_snapshot.META_SCHEMA_VERSION
            and doc.get("snapshot_version") == 1,
            f"the provenance fields come from the snapshot's own"
            f" inst_source_meta row (schema"
            f" {inst_snapshot.META_SCHEMA_VERSION}, version 1)",
            f"the provenance metadata disagrees with the cutter: {doc}",
        )
        entry = find_artifact(manifest, INST_SOURCE_ARTIFACT)
        check(
            entry is not None and "logical_digest" not in entry,
            "the provenance artifact is enumerated as an ordinary path-backed"
            " artifact (no logical digest)",
            "the provenance artifact is missing from the manifest or carries a"
            " logical_digest — it is JSON, not a database",
        )
    check(
        validate_manifest(manifest) == [],
        "the whole manifest validates with the inst module and the new artifact",
        f"manifest validation errors: {validate_manifest(manifest)}",
    )

    # --- 3. the refusal paths -------------------------------------------------
    # (a) a WRITABLE store is refused at the command line, before any build work
    runner = CliRunner()
    writable = writable_copy(snapshot, tmp / "writable-store.db")
    cli_dir = workdir("cli-refusals")
    cli_repo = make_repo(cli_dir, "populus-data")
    cli_db = seed_db(cli_dir / "populus.db")
    result = runner.invoke(
        cli_main,
        [
            "stage-build",
            "--db", str(cli_db),
            "--data-repo", str(cli_repo),
            "--attestation", "staging-noop",
            "--inst-db", str(writable),
        ],
    )
    check(
        result.exit_code != 0
        and "writable" in result.output
        and "inst_snapshot.py" in result.output,
        "a WRITABLE store URI is refused at the CLI, with the remediation named",
        f"a writable --inst-db was accepted (exit {result.exit_code}):"
        f" {result.output.strip()[:200]}",
    )

    # (b)/(c) a drifted view and a missing view are refused BY NAME. These need
    # a writable copy to mutate, so they drive `stage_build` directly — the CLI
    # would refuse the copy for being writable before ever reaching the check
    # under test.
    for label, view, needle in (
        ("drifted", "v_default_holdings", "v_default_holdings"),
        ("missing", "v_filer_reported_holdings", "v_filer_reported_holdings"),
    ):
        broken = writable_copy(snapshot, tmp / f"{label}-view.db")
        conn = real_connect(str(broken), isolation_level=None)
        try:
            conn.execute(f"DROP VIEW {view}")
            if label == "drifted":
                conn.execute(
                    f"CREATE VIEW {view} AS SELECT * FROM inst_holdings"
                )
        finally:
            conn.close()
        sub = workdir(f"{label}-run")
        sub_repo = make_repo(sub, "populus-data")
        try:
            stage_build(
                seed_db(sub / "populus.db"),
                sub_repo,
                now=pin(),
                backend=LocalDirBackend(sub_repo),
                attestation=unattested,
                inst_db_path=broken,
            )
        except PublishError as exc:
            message = str(exc)
            check(
                needle in message and "inst_snapshot.py" in message,
                f"a {label} view is refused, NAMING {needle} and the snapshot-cut"
                " remediation",
                f"a {label} view was refused without naming the view or the"
                f" remediation: {message[:200]}",
            )
        else:
            FAILURES.append(
                f"a {label} view DERIVED SUCCESSFULLY — the R3 view gate is not"
                " enforcing, and the module would publish against SQL that is"
                " not the shipped SQL"
            )

    # (d) the UNSET path: no --inst-db is today's congress-only build, and the
    # publish boundary says so out loud rather than implying a withholding.
    unset_dir = workdir("unset")
    unset_repo = make_repo(unset_dir, "populus-data")
    unset_db = seed_db(unset_dir / "populus.db")
    staged_out = runner.invoke(
        cli_main,
        [
            "stage-build",
            "--db", str(unset_db),
            "--data-repo", str(unset_repo),
            "--attestation", "staging-noop",
        ],
    )
    check(
        staged_out.exit_code == 0,
        "stage-build with no --inst-db succeeds (the flag is optional)",
        f"stage-build without --inst-db failed: {staged_out.output.strip()[:300]}",
    )
    staging_dir = next(
        line.split("=", 1)[1]
        for line in staged_out.output.splitlines()
        if line.startswith("staging_dir=")
    )
    finalized = runner.invoke(
        cli_main,
        [
            "finalize-build",
            "--staging-dir", staging_dir,
            "--site-file-count", "1",
            "--data-repo", str(unset_repo),
        ],
    )
    check(
        finalized.exit_code == 0,
        "the congress-only build finalizes",
        f"finalize-build failed on the congress-only path:"
        f" {finalized.output.strip()[:300]}",
    )
    published = runner.invoke(
        cli_main,
        [
            "publish",
            "--attestation", "staging-noop",
            "--data-repo", str(unset_repo),
        ],
    )
    check(
        published.exit_code == 0
        and "inst module: not built (no institutional data ingested)"
        in published.output,
        "the unset path publishes congress-only and states 'not built' —"
        " never a withholding that did not happen",
        f"the congress-only publish did not print the honest 'not built' line"
        f" (exit {published.exit_code}): {published.output.strip()[:300]}",
    )
    unset_manifest = json.loads(
        (
            unset_repo
            / "builds"
            / json.loads((unset_repo / "latest.json").read_text())["build_id"]
            / "manifest.json"
        ).read_text(encoding="utf-8")
    )
    check(
        set(unset_manifest["modules"]) == {"congress"},
        "the unset path publishes the congress module and nothing else",
        f"the unset path published modules {sorted(unset_manifest['modules'])}",
    )

    # --- 4. congress byte-identity against a baseline build (R18) ------------
    # Two builds from IDENTICAL congress inputs at the same pinned instant: one
    # congress-only, one with --inst-db. Every congress artifact must be the
    # same bytes. `manifest.json` is the one expected difference (it gains the
    # inst module), so it is compared structurally instead of being waved past.
    baseline_dir = workdir("baseline")
    baseline_repo = make_repo(baseline_dir, "populus-data")
    baseline_staged = stage_build(
        seed_db(baseline_dir / "populus.db"),
        baseline_repo,
        now=pin(),
        backend=LocalDirBackend(baseline_repo),
        attestation=unattested,
    )
    finalize_build(baseline_staged)
    baseline_build = Path(baseline_staged.staging_dir) / "build"

    def tree_hashes(root: Path) -> dict[str, str]:
        return {
            p.relative_to(root).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest()
            for p in sorted(root.rglob("*"))
            if p.is_file()
        }

    base_tree = tree_hashes(baseline_build)
    inst_tree = tree_hashes(build_dir)
    check(
        bool(base_tree),
        f"the baseline congress build produced {len(base_tree)} artifact file(s)",
        "the baseline congress build produced NO files — the comparison below"
        " would be vacuous",
    )
    divergent = sorted(
        name
        for name, digest in base_tree.items()
        if name != "manifest.json" and inst_tree.get(name) != digest
    )
    check(
        not divergent,
        f"every congress artifact is byte-identical with and without --inst-db"
        f" ({len(base_tree) - 1} file(s) compared)",
        f"congress artifacts diverged under --inst-db: {divergent} — the inst"
        " seam is not additive, and R18's whole claim is that it is",
    )
    base_manifest = json.loads(
        (baseline_build / "manifest.json").read_text(encoding="utf-8")
    )
    # The congress module's entry list gains EXACTLY ONE member: inst_source.json
    # is an ordinary path-backed artifact and is enumerated under congress (the
    # always-present module) rather than under `inst`, whose tuple is DB-only
    # with logical-digest semantics. So the comparison names that one addition
    # instead of excluding "whatever differs" — an exclusion that broad would
    # have accepted a changed congress.db too.
    base_congress = base_manifest["modules"]["congress"]
    inst_congress = manifest["modules"]["congress"]
    added = [
        entry
        for entry in inst_congress["artifacts"]
        if entry not in base_congress["artifacts"]
    ]
    check(
        [entry["name"] for entry in added] == [INST_SOURCE_ARTIFACT]
        and {k: v for k, v in inst_congress.items() if k != "artifacts"}
        == {k: v for k, v in base_congress.items() if k != "artifacts"}
        and [
            entry
            for entry in base_congress["artifacts"]
            if entry not in inst_congress["artifacts"]
        ]
        == [],
        f"the manifest's congress module gains exactly one entry"
        f" ({INST_SOURCE_ARTIFACT}) and changes in no other way",
        f"the manifest's congress module changed beyond the provenance entry:"
        f" added {[entry['name'] for entry in added]}",
    )
    check(
        set(manifest["modules"]) - set(base_manifest["modules"]) == {INST_MODULE},
        "the only manifest module the snapshot adds is the inst module",
        "the inst build's manifest differs from the baseline by more than the"
        " inst module",
    )

    # --- 5. the runner-governance sweep (plan R7) ----------------------------
    # The committed sweep functions are CALLED, not re-implemented: a copy here
    # would be one more thing to keep in step with the real invariant.
    for name in (
        "test_no_pr_like_triggers_anywhere",
        "test_self_hosted_labels_only_in_allowed_jobs",
        "test_no_inst_refresh_module_exists",
        "test_no_code_references_refresh_arming_variable",
        "test_refresh_stub_exists_and_carries_retention_obligation",
    ):
        try:
            getattr(governance, name)()
        except AssertionError as exc:
            FAILURES.append(f"governance sweep {name} FAILED: {exc}")
        else:
            NOTES.append(f"governance sweep {name} holds")
    check(
        governance.ALLOWED_SELF_HOSTED_JOBS == [("publish.yml", "publish")],
        "exactly ONE job is allowlisted onto the self-hosted machine"
        " (publish.yml:publish)",
        f"the self-hosted allowlist is {governance.ALLOWED_SELF_HOSTED_JOBS} —"
        " a second entry is a plan revision, not an edit",
    )

    # --- 6. the file-budget arithmetic (R22/R27) -----------------------------
    projected = worst_case_file_count(measured_files=M1_MEASURED_PAGES)
    expected = (
        M1_MEASURED_PAGES
        + SITE_CHROME_FILES
        + M2_FILER_PAGES
        + ACTIVITY_SHARDS_MAX
        + M3_RESERVED
        + FILER_TAIL_SHARDS_RESERVED
        + FILER_ROUTING_INDEX_FILES
        + FILER_V1_TRANSITION_FILES
    )
    check(
        projected == expected,
        f"the forward projection sums every committed term ({projected:,})",
        f"the forward projection is {projected:,}, the sum of the committed"
        f" terms is {expected:,} — a term is missing from one of them, which is"
        " the C5/N1 defect class inst_budget documents",
    )
    print(f"filer_v1_transition_files={FILER_V1_TRANSITION_FILES}")
    check(
        FILER_SHARD_BYTE_CEILING == 1024 * 1024 < MAX_SHARD_BYTES,
        f"the LD-10 client-response ceiling is {FILER_SHARD_BYTE_CEILING:,} B,"
        f" well inside the provider's {MAX_SHARD_BYTES:,} B hard limit",
        f"the shard ceiling is {FILER_SHARD_BYTE_CEILING:,} B — LD-10 binds the"
        " READER's bound at 1 MiB, not the provider's",
    )
    buffer = PROVIDER_FILE_LIMIT - GLOBAL_FILE_CAP
    check(
        (GLOBAL_FILE_CAP, PROVIDER_FILE_LIMIT, buffer) == (18_000, 20_000, 2_000),
        f"the self-cap is the owner's 18,000/90% decision — buffer to the"
        f" provider's hard {PROVIDER_FILE_LIMIT:,} is {buffer:,} files",
        f"the cap arithmetic is {GLOBAL_FILE_CAP:,}/{PROVIDER_FILE_LIMIT:,}"
        f" (buffer {buffer:,}) — the recorded decision is 18,000 with a 2,000"
        " buffer, and changing it is an owner decision",
    )
    print()
    print(f"forward projection: measured M1 {M1_MEASURED_PAGES:,}"
          f" + site chrome {SITE_CHROME_FILES}"
          f" + M2 filer pages {M2_FILER_PAGES:,}"
          f" + activity shards {ACTIVITY_SHARDS_MAX}"
          f" + M3 reservation {M3_RESERVED:,}"
          f" + tail filer shards {FILER_TAIL_SHARDS_RESERVED}"
          f" + routing index {FILER_ROUTING_INDEX_FILES}"
          f" + filer_v1_transition_files={FILER_V1_TRANSITION_FILES}"
          f" = {projected:,} vs self-cap {GLOBAL_FILE_CAP:,}")

    # --- 7. manifest compatibility and the generic installer (R24) -----------
    from populus.client.snapshot import LocalRepoFetcher, SnapshotClient

    publish_dir = workdir("publish-run")
    publish_repo = make_repo(publish_dir, "populus-data")
    publish_backend = LocalDirBackend(publish_repo)
    publish_staged = stage_build(
        seed_db(publish_dir / "populus.db"),
        publish_repo,
        now=pin(),
        backend=publish_backend,
        attestation=unattested,
        inst_db_path=snapshot,
    )
    finalize_build(publish_staged)
    run_publish(
        publish_repo, now=pin(), backend=publish_backend, attestation=unattested
    )
    published_id = json.loads((publish_repo / "latest.json").read_text())["build_id"]
    published_manifest = json.loads(
        (publish_repo / "builds" / published_id / "manifest.json").read_text(
            encoding="utf-8"
        )
    )
    check(
        find_artifact(published_manifest, INST_SOURCE_ARTIFACT) is not None
        and validate_manifest(published_manifest) == [],
        "a NEW manifest carrying inst_source.json publishes and validates",
        "the published manifest is invalid or omits the provenance artifact",
    )
    old_manifest = json.loads(json.dumps(published_manifest))
    for module in old_manifest["modules"].values():
        module["artifacts"] = [
            entry
            for entry in module["artifacts"]
            if entry["name"] != INST_SOURCE_ARTIFACT
        ]
    check(
        validate_manifest(old_manifest) == [],
        "an OLD manifest with no inst_source.json still validates (R24: the"
        " entry is required at the producer, optional at the validator)",
        f"an old manifest was rejected: {validate_manifest(old_manifest)} —"
        " every already-published build would fail verification",
    )
    fetcher = LocalRepoFetcher(publish_repo)
    client = SnapshotClient(
        tmp / "client-cache",
        fetcher,
        now=pin(),
        module="congress",
        attestation=unattested,
    )
    check(
        client.refresh().status == "installed",
        "the generic installer installs the build carrying the new artifact,"
        " unchanged",
        "the generic installer refused the build carrying inst_source.json",
    )
    installed = (
        tmp / "client-cache" / "congress" / client.current_build() / INST_SOURCE_ARTIFACT
    )
    check(
        installed.is_file()
        and json.loads(installed.read_text(encoding="utf-8"))["snapshot_sha256"]
        == snapshot_sha,
        "the installed provenance artifact carries the snapshot identity all"
        " the way to a consumer's cache",
        "the provenance artifact did not reach the consumer cache intact",
    )
    inst_client = SnapshotClient(
        tmp / "client-cache",
        fetcher,
        now=pin(),
        module=INST_MODULE,
        attestation=unattested,
    )
    check(
        inst_client.refresh().status == "installed" and inst_client.db_path() is not None,
        "the inst module installs and serves from the published build",
        "the inst module did not install from the published build",
    )

    # --- report ---------------------------------------------------------------
    print()
    for note in NOTES:
        print(f"  ok   {note}")
    for bad in FAILURES:
        print(f"  FAIL {bad}")
    print()
    shutil.rmtree(tmp, ignore_errors=True)
    if FAILURES:
        print(
            f"ACCEPTANCE FAILED — {len(FAILURES)} check(s) (this command never skips)"
        )
        return 1
    print(
        "ACCEPTANCE PASSED: snapshot cut -> ro+immutable single-transaction"
        " derive -> coverage/aggregate/serving -> manifest + inst_source.json"
        " -> refusals (writable, drifted view, missing view, unset) -> congress"
        " byte-identity -> governance sweep -> budget arithmetic -> manifest"
        " compatibility + installer, on a real cut snapshot."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
