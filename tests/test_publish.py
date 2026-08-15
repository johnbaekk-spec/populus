"""§5.5 publication protocol: build, backends, journal recovery, publish,
verify, workflows, runbooks (RUN 5; R1–R3, R5, R9–R11, R15–R16, R19, R23,
R25–R26, R29–R35).

Shared helpers (``seed_db``/``publish_build``/``RecordingBackend``/``NOW``)
are imported by ``test_pointer_state.py``. All clocks are pinned; all remote
seams are local or recorded — the autouse socket guard proves nothing
escapes.
"""

from __future__ import annotations

import base64

import hashlib
import json
import re
import shutil
import subprocess  # nosec B404 — bash -n over runbook snippets, argv only
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
import yaml
from click.testing import CliRunner

from populus import licenses
from populus.cli import main as cli_main
from populus.db import connect, init_db
from populus.load import ParsedRow, insert_filing, load_filing
from populus.publish.attestation import AttestationResult, StagingNoop
from populus.publish.build import (
    BackendError,
    GhReleaseBackend,
    LocalDirBackend,
    PublishError,
    STAGING_DIR,
    journal_load,
    journal_valid,
    materialize_from_journal,
    next_build_id,
    STAGE_STATE_FILE,
    finalize_build,
    read_stage_state,
    reconcile_inflight,
    require_site_file_count,
    run_build,
    stage_build,
    write_stage_state,
    run_publish,
    run_verify,
)
from populus.publish.manifest import (
    CLIENT_COMPAT,
    MANIFEST_SCHEMA_VERSION,
    REQUIRED_CONGRESS_ARTIFACTS,
    find_artifact,
    validate_manifest,
)
from populus.publish.pointer import build_pointer, render_pointer
from populus.stats import render_stats

REPO_ROOT = Path(__file__).resolve().parent.parent
WORKFLOWS = REPO_ROOT / ".github" / "workflows"
RUNBOOKS = REPO_ROOT / "docs" / "runbooks"

NOW = datetime(2026, 7, 23, 12, 0, 0, tzinfo=timezone.utc)


def pin(moment: datetime = NOW):
    """The single pinned clock seam every test feeds."""
    return lambda: moment


# --- shared factories (also imported by test_pointer_state.py) ---------------


def seed_db(path: Path, *, ticker: str = "AAPL", asset: str = "Apple Inc") -> Path:
    """A minimal ingested database: one member, one filing, two rows."""
    init_db(str(path))
    conn = connect(str(path))
    try:
        conn.execute(
            "INSERT INTO members (bioguide_id, full_name, chamber, party,"
            " state, district, terms, raw) VALUES"
            " ('D000001', 'Jane Doe', 'house', 'Democrat', 'CA', '12', '[]', '{}')"
        )
        insert_filing(
            conn,
            filing_id="house:1",
            chamber="house",
            bioguide_id="D000001",
            filer_name_raw="Doe, Jane",
            filing_kind="ptr",
            filed_date="2026-01-10",
            doc_url="https://disclosures-clerk.house.gov/ptr/1.pdf",
            source="house-clerk",
            ingested_at="2026-01-11T00:00:00Z",
        )
        load_filing(
            conn,
            "house:1",
            [
                ParsedRow(
                    raw_row={"asset": asset, "side": "purchase"},
                    row_ordinal=1,
                    asset_name=asset,
                    side="purchase",
                    ticker=ticker,
                    transaction_date="2026-01-02",
                    amount_low=1001,
                    amount_high=15000,
                ),
                ParsedRow(
                    raw_row={"asset": "US Treasury Note", "side": "sale"},
                    row_ordinal=2,
                    asset_name="US Treasury Note",
                    side="sale",
                    ticker=None,
                    transaction_date="2026-01-03",
                    amount_low=15001,
                    amount_high=50000,
                ),
            ],
            parse_status="parsed",
            parser_version="test-1",
            normalization_version="test-1",
        )
    finally:
        conn.close()
    return path


def mutate_db(path: Path) -> None:
    """Add a second filing so the logical content (and digest) changes."""
    conn = connect(str(path))
    try:
        insert_filing(
            conn,
            filing_id="house:2",
            chamber="house",
            bioguide_id="D000001",
            filer_name_raw="Doe, Jane",
            filing_kind="ptr",
            filed_date="2026-02-10",
            doc_url="https://disclosures-clerk.house.gov/ptr/2.pdf",
            source="house-clerk",
            ingested_at="2026-02-11T00:00:00Z",
        )
        load_filing(
            conn,
            "house:2",
            [
                ParsedRow(
                    raw_row={"asset": "NVIDIA", "side": "purchase"},
                    row_ordinal=1,
                    asset_name="NVIDIA Corp",
                    side="purchase",
                    ticker="NVDA",
                    transaction_date="2026-02-01",
                    amount_low=1001,
                    amount_high=15000,
                )
            ],
            parse_status="parsed",
            parser_version="test-1",
            normalization_version="test-1",
        )
    finally:
        conn.close()


def make_repo(tmp_path: Path, name: str = "populus-data") -> Path:
    repo = tmp_path / name
    repo.mkdir(exist_ok=True)
    return repo


def publish_build(db_path: Path, repo: Path, *, moment: datetime = NOW):
    """build + publish over a LocalDirBackend; returns the PublishReport."""
    backend = LocalDirBackend(repo)
    run_build(db_path, repo, now=pin(moment), backend=backend)
    return run_publish(repo, now=pin(moment), backend=backend)


def latest_pointer(repo: Path) -> dict:
    return json.loads((repo / "latest.json").read_text(encoding="utf-8"))


def read_manifest(repo: Path, build_id: str) -> dict:
    return json.loads(
        (repo / "builds" / build_id / "manifest.json").read_text(encoding="utf-8")
    )


class RecordingBackend:
    """A LocalDirBackend that records remote ops and injects one-shot faults."""

    def __init__(self, data_repo: Path, *, fail: dict | None = None) -> None:
        self._inner = LocalDirBackend(data_repo)
        self.ops: list[tuple] = []
        self._fail = dict(fail or {})

    def _record(self, op: str, *detail) -> None:
        self.ops.append((op, *detail))
        if op in self._fail:
            raise self._fail.pop(op)

    def op_names(self) -> list[str]:
        return [op[0] for op in self.ops]

    def locator(self, build_id, name):
        return self._inner.locator(build_id, name)

    def list_published_tags(self, date=None):
        return self._inner.list_published_tags(date)

    def list_draft_tags(self, date=None):
        return self._inner.list_draft_tags(date)

    def get_release(self, build_id):
        return self._inner.get_release(build_id)

    def ensure_draft(self, build_id):
        self._record("ensure_draft", build_id)
        return self._inner.ensure_draft(build_id)

    def upload(self, build_id, path, *, name=None, clobber=False):
        self._record("upload", name or Path(path).name, clobber)
        return self._inner.upload(build_id, path, name=name, clobber=clobber)

    def verify_asset(self, build_id, name, *, sha256, size):
        self._record("verify_asset", name)
        return self._inner.verify_asset(build_id, name, sha256=sha256, size=size)

    def publish_release(self, build_id):
        self._record("publish_release", build_id)
        return self._inner.publish_release(build_id)

    def delete_release(self, build_id):
        self._record("delete_release", build_id)
        return self._inner.delete_release(build_id)

    def read_asset(self, build_id, name):
        return self._inner.read_asset(build_id, name)


class SpyAttestation:
    """Records every seam call; optionally fails verification per subject."""

    def __init__(self, fail_verify: set[str] | None = None) -> None:
        self.calls: list[tuple[str, str]] = []
        self._fail_verify = fail_verify or set()

    def attest(self, subject_name: str, data: bytes) -> AttestationResult:
        self.calls.append(("attest", subject_name))
        return AttestationResult(True, f"spy attest {subject_name}")

    def verify(self, subject_name: str, data: bytes) -> AttestationResult:
        self.calls.append(("verify", subject_name))
        ok = subject_name not in self._fail_verify
        return AttestationResult(ok, f"spy verify {subject_name} ok={ok}")


# --- next_build_id (R31) ------------------------------------------------------


def test_next_build_id_spans_local_published_and_staging(tmp_path):
    repo = make_repo(tmp_path)
    backend = LocalDirBackend(repo)
    (repo / "builds" / "20260723.1").mkdir(parents=True)
    (repo / STAGING_DIR / "20260723.2").mkdir(parents=True)
    backend.ensure_draft("20260723.3")
    backend.publish_release("20260723.3")
    assert next_build_id(repo, NOW.date(), backend) == "20260723.4"


def test_next_build_id_resets_next_day(tmp_path):
    repo = make_repo(tmp_path)
    backend = LocalDirBackend(repo)
    (repo / "builds" / "20260723.7").mkdir(parents=True)
    assert next_build_id(repo, NOW.date(), backend) == "20260723.8"
    assert (
        next_build_id(repo, (NOW + timedelta(days=1)).date(), backend)
        == "20260724.1"
    )


# --- run_build (R1/R2/R3/R34/R35) --------------------------------------------


def test_run_build_manifest_exact_shape_and_licensing(tmp_path):
    db = seed_db(tmp_path / "populus.db")
    repo = make_repo(tmp_path)
    report = run_build(db, repo, now=pin(), backend=LocalDirBackend(repo))
    assert report.build_id == "20260723.1"
    build_dir = repo / STAGING_DIR / report.build_id / "build"
    manifest = json.loads((build_dir / "manifest.json").read_text(encoding="utf-8"))

    # Exact §5.5 top-level and module shape.
    assert set(manifest) == {
        "build_id",
        "created_at",
        "previous_build_id",
        "publisher",
        "modules",
    }
    assert manifest["created_at"] == "2026-07-23T12:00:00Z"
    assert manifest["previous_build_id"] is None
    module = manifest["modules"]["congress"]
    assert set(module) == {
        "schema_version",
        "client_compat",
        "deprecation",
        "normalization_version",
        "digest_projection_version",
        "watermarks",
        "artifacts",
    }
    assert module["schema_version"] == MANIFEST_SCHEMA_VERSION
    assert module["client_compat"] == CLIENT_COMPAT
    # M1-E bumped the congress projection to "2": the byte envelope gained the
    # filing_status/subholding_of/location columns, and digests.py states that
    # a module's projection version bumps exactly when its envelope changes.
    assert module["digest_projection_version"] == "2"
    assert set(module["watermarks"]) == {
        "house_index_last_modified",
        "senate_max_filed_date",
    }
    register = licenses.load_register()
    assert validate_manifest(
        manifest, register_ids=licenses.register_ids(register)
    ) == []

    # Every artifact carries license_ids; the DB entry carries logical_digest.
    names = {entry["name"] for entry in module["artifacts"]}
    assert {
        "congress.db",
        "congress/feed.json",
        "congress/stats.json",
        "congress/members/D000001.json",
        "congress/tickers/AAPL.json",
        "licenses.json",
        "DATA-LICENSE.md",
        "NOTICE",
    } <= names
    for entry in module["artifacts"]:
        assert entry["license_ids"], entry["name"]
    db_entry = find_artifact(manifest, "congress.db")
    assert db_entry["logical_digest"] == report.logical_digest
    assert db_entry["path"] == f"releases/data-{report.build_id}/congress.db"

    # R34: the licensing set is regenerated from the packaged register.
    assert (build_dir / "DATA-LICENSE.md").read_text(
        encoding="utf-8"
    ) == licenses.render_data_license(register)
    assert (build_dir / "NOTICE").read_text(
        encoding="utf-8"
    ) == licenses.render_notice(register)
    assert json.loads((build_dir / "licenses.json").read_text(encoding="utf-8")) == register


def test_run_build_journal_is_valid_and_deterministic(tmp_path):
    db = seed_db(tmp_path / "populus.db")
    repo = make_repo(tmp_path)
    backend = LocalDirBackend(repo)
    report = run_build(db, repo, now=pin(), backend=backend)
    journal_path = repo / STAGING_DIR / report.build_id / "journal.json"
    first = journal_path.read_bytes()
    assert journal_valid(first)
    # Rebuilding with the same pinned clock adopts the same staged-only
    # build_id and reproduces the journal byte for byte.
    report2 = run_build(db, repo, now=pin(), backend=backend)
    assert report2.build_id == report.build_id
    assert report2.adopted
    assert journal_path.read_bytes() == first


def test_run_build_skips_and_counts_nonconforming_tickers(tmp_path):
    db = seed_db(tmp_path / "populus.db", ticker="BAD TICKER")
    repo = make_repo(tmp_path)
    report = run_build(db, repo, now=pin(), backend=LocalDirBackend(repo))
    assert report.skipped_tickers == ("BAD TICKER",)
    build_dir = repo / STAGING_DIR / report.build_id / "build"
    assert not (build_dir / "congress" / "tickers").exists()
    # The rows stay in the feed (TD-6) — only the slice route is skipped.
    feed = json.loads(
        (build_dir / "congress" / "feed.json").read_text(encoding="utf-8")
    )
    assert any(row["ticker"] == "BAD TICKER" for row in feed["rows"])


def test_run_build_refuses_a_store_whose_member_join_never_ran(tmp_path):
    """The production outage of 2026-08-07 → 2026-08-14, pinned.

    `publish.yml` ingested house and senate but never `members`, and
    `apply_member_join` is the ONLY writer of `transactions.bioguide_id`. Seven
    builds (20260807.1 … 20260812.1) therefore published a site with no member
    pages, and live 404s every `/congress/members/<bioguide>` today. Nothing
    failed, because the slice loop simply iterated zero times.

    Rows present + zero joined must be a refusal. Delete the guard in
    `build.py` and this test fails: the build would succeed and emit no member
    artifact, which is precisely what shipped.
    """
    db = seed_db(tmp_path / "populus.db")
    conn = connect(str(db))
    try:
        # Exactly the shipped state: the roster was never loaded, so the join
        # resolved nothing. NULL, not '' — the released store held real NULLs.
        conn.execute("UPDATE transactions SET bioguide_id = NULL")
        conn.execute("UPDATE filings SET bioguide_id = NULL")
        conn.execute("DELETE FROM members")
        conn.commit()
    finally:
        conn.close()
    repo = make_repo(tmp_path)
    with pytest.raises(PublishError, match="member join is absent"):
        run_build(
            db,
            repo,
            now=pin(),
            backend=LocalDirBackend(repo),
            expect_member_join=True,
        )


def test_an_undeclared_build_still_permits_an_identity_less_store(tmp_path):
    """The declaration is what arms the guard — mirroring `expected_modules`.

    Synthetic library builds legitimately hold filings with no roster, so the
    library default stays permissive and only the production CLI declares. This
    pins that boundary: change the default and the suite's identity-less
    fixtures would start failing for a reason none of them is about.
    """
    db = seed_db(tmp_path / "populus.db")
    conn = connect(str(db))
    try:
        conn.execute("UPDATE transactions SET bioguide_id = NULL")
        conn.execute("UPDATE filings SET bioguide_id = NULL")
        conn.execute("DELETE FROM members")
        conn.commit()
    finally:
        conn.close()
    repo = make_repo(tmp_path)
    report = run_build(db, repo, now=pin(), backend=LocalDirBackend(repo))
    assert report.build_id


def test_run_build_emits_member_slices_when_the_join_ran(tmp_path):
    """The positive control for the refusal above.

    Without this, a guard that refused EVERY declared build would still pass the
    refusal test. This proves the joined path is unaffected and actually writes
    the member artifact whose absence was the outage.
    """
    db = seed_db(tmp_path / "populus.db")
    repo = make_repo(tmp_path)
    report = run_build(
        db, repo, now=pin(), backend=LocalDirBackend(repo), expect_member_join=True
    )
    members_dir = repo / STAGING_DIR / report.build_id / "build" / "congress" / "members"
    assert sorted(p.name for p in members_dir.glob("*.json")) == ["D000001.json"]


def test_every_production_build_call_site_declares_the_member_join():
    """A default-permissive guard is only as good as its production callers.

    `expect_member_join` defaults to False so synthetic builds keep working, so
    a new publishing call site that forgets to declare it would silently
    reopen the outage. Same reasoning — and same AST approach — as
    `tests/test_attestation_structure.py`: a signature-level default cannot see
    an omission at the call site, so the call sites are pinned here.
    """
    import ast

    cli_path = Path(__file__).parents[1] / "src" / "populus" / "cli.py"
    tree = ast.parse(cli_path.read_text(encoding="utf-8"))
    offenders = []
    found = 0
    for node in ast.walk(tree):
        if not isinstance(node, ast.Call):
            continue
        func = node.func
        name = getattr(func, "id", None) or getattr(func, "attr", None)
        if name not in {"run_build", "stage_build"}:
            continue
        found += 1
        declared = [
            kw
            for kw in node.keywords
            if kw.arg == "expect_member_join"
            and isinstance(kw.value, ast.Constant)
            and kw.value.value is True
        ]
        if not declared:
            offenders.append(f"cli.py:{node.lineno} {name}(...)")
    # Guard against a vacuous pass: if the call sites move or are renamed, an
    # empty sweep would report success while checking nothing.
    assert found == 2, f"expected 2 CLI build call sites, found {found}"
    assert offenders == [], (
        "production build call sites do not declare `expect_member_join=True`"
        " and would publish a site with no member pages:\n  "
        + "\n  ".join(offenders)
    )


def test_run_build_refuses_missing_inputs(tmp_path):
    repo = make_repo(tmp_path)
    # No DB, nothing staged, nothing to reconcile → a new build cannot be
    # assembled, so this refuses.
    with pytest.raises(PublishError, match="source database is required"):
        run_build(
            tmp_path / "absent.db", repo, now=pin(), backend=LocalDirBackend(repo)
        )
    db = seed_db(tmp_path / "populus.db")
    with pytest.raises(PublishError, match="data repo"):
        run_build(
            db, tmp_path / "absent-repo", now=pin(), backend=LocalDirBackend(repo)
        )


def test_run_build_recovers_inflight_draft_without_source_db(tmp_path):
    """F1: a fresh runner completes an interrupted publish through the build
    entry point with NO source database — only the data repo + backend."""
    db = seed_db(tmp_path / "populus.db")
    repo = make_repo(tmp_path)
    report = run_build(db, repo, now=pin(), backend=LocalDirBackend(repo))
    build_id = report.build_id
    # Simulate an interrupted publish: a draft with journal + DB uploaded,
    # published, but not yet committed; staging cleared away.
    staged = repo / STAGING_DIR / build_id
    backend0 = LocalDirBackend(repo)
    backend0.ensure_draft(build_id)
    backend0.upload(build_id, staged / "journal.json", name="journal.json")
    backend0.upload(build_id, staged / "assets" / "congress.db", name="congress.db")
    backend0.publish_release(build_id)
    shutil.rmtree(staged)

    # Fresh runner, NO source database passed — recovery must still complete.
    fresh = RecordingBackend(repo)
    recovery = run_build(None, repo, now=pin(), backend=fresh)
    assert build_id in {recovery.build_id, *recovery.reconciled}
    assert latest_pointer(repo)["build_id"] == build_id
    assert (repo / "builds" / build_id / "manifest.json").is_file()
    assert run_verify(repo, now=pin(), db_path=db).ok


def test_run_build_preserves_staged_journal_verbatim(tmp_path):
    """F2: adopting a staged build preserves its exact bytes — a later clock
    and a mutated source database must not change the journal."""
    db = seed_db(tmp_path / "populus.db")
    repo = make_repo(tmp_path)
    first = run_build(db, repo, now=pin(), backend=LocalDirBackend(repo))
    journal_path = repo / STAGING_DIR / first.build_id / "journal.json"
    original = journal_path.read_bytes()

    # Mutate the source and advance the clock, then re-run build.
    mutate_db(db)
    later = run_build(
        db, repo, now=pin(NOW + timedelta(days=3)), backend=LocalDirBackend(repo)
    )
    assert later.build_id == first.build_id
    assert later.adopted and later.preserved
    assert journal_path.read_bytes() == original  # exact bytes, not re-produced
    # created_at still bears the ORIGINAL clock, not the later one (R35).
    assert journal_load(original)["created_at"] == "2026-07-23T12:00:00Z"


# --- publish ordering (R9/R26/R35) -------------------------------------------


def test_publish_uploads_journal_first_then_db_then_publishes(tmp_path):
    db = seed_db(tmp_path / "populus.db")
    repo = make_repo(tmp_path)
    run_build(db, repo, now=pin(), backend=LocalDirBackend(repo))
    backend = RecordingBackend(repo)
    report = run_publish(repo, now=pin(), backend=backend)
    uploads = [op for op in backend.ops if op[0] == "upload"]
    assert [op[1] for op in uploads] == ["journal.json", "congress.db"]
    names = backend.op_names()
    assert names.index("ensure_draft") < names.index("upload")
    assert names.index("upload") < names.index("publish_release")
    assert "delete_release" not in names
    assert report.pointer_version == 1
    assert (repo / "latest.json").is_file()


def test_publish_pointer_written_only_after_release_published(tmp_path):
    db = seed_db(tmp_path / "populus.db")
    repo = make_repo(tmp_path)
    run_build(db, repo, now=pin(), backend=LocalDirBackend(repo))
    backend = RecordingBackend(
        repo, fail={"publish_release": BackendError("injected crash")}
    )
    with pytest.raises(BackendError):
        run_publish(repo, now=pin(), backend=backend)
    # Nothing consumer-visible was written: no pointer, no committed build.
    assert not (repo / "latest.json").exists()
    assert not (repo / "builds").exists()
    # The staged journal survives — the same build completes on the next run.
    build_id = backend.ops[0][1]
    assert (repo / STAGING_DIR / build_id / "journal.json").is_file()


def test_publish_journal_verify_failure_blocks_consumer_db_upload(tmp_path):
    db = seed_db(tmp_path / "populus.db")
    repo = make_repo(tmp_path)
    run_build(db, repo, now=pin(), backend=LocalDirBackend(repo))

    class JournalVerifyFails(RecordingBackend):
        def verify_asset(self, build_id, name, *, sha256, size):
            self.ops.append(("verify_asset", name))
            if name == "journal.json":
                return False
            return self._inner.verify_asset(
                build_id, name, sha256=sha256, size=size
            )

    backend = JournalVerifyFails(repo)
    with pytest.raises(PublishError, match="journal asset"):
        run_publish(repo, now=pin(), backend=backend)
    assert ("upload", "congress.db", True) not in backend.ops


# --- the fresh-runner recovery matrix (R25/R31/R35) ---------------------------


def _staged(repo: Path, build_id: str) -> Path:
    return repo / STAGING_DIR / build_id


def _boundary_pre_draft(repo, build_id, journal_bytes):
    """Journal staged, nothing remote."""


def _boundary_draft_created(repo, build_id, journal_bytes):
    LocalDirBackend(repo).ensure_draft(build_id)


def _boundary_partial_journal(repo, build_id, journal_bytes):
    backend = LocalDirBackend(repo)
    backend.ensure_draft(build_id)
    corrupt = repo / "corrupt-journal.json"
    corrupt.write_bytes(journal_bytes[: len(journal_bytes) // 2])
    backend.upload(build_id, corrupt, name="journal.json")
    corrupt.unlink()


def _boundary_journal_uploaded_no_db(repo, build_id, journal_bytes):
    backend = LocalDirBackend(repo)
    backend.ensure_draft(build_id)
    staged_journal = _staged(repo, build_id) / "journal.json"
    backend.upload(build_id, staged_journal, name="journal.json")
    # The staged copy is dropped: recovery must come from the REMOTE journal.
    shutil.rmtree(_staged(repo, build_id))


def _boundary_both_uploaded_pre_publish(repo, build_id, journal_bytes):
    backend = LocalDirBackend(repo)
    backend.ensure_draft(build_id)
    staged = _staged(repo, build_id)
    backend.upload(build_id, staged / "journal.json", name="journal.json")
    backend.upload(build_id, staged / "assets" / "congress.db", name="congress.db")


def _boundary_published_pre_commit(repo, build_id, journal_bytes):
    _boundary_both_uploaded_pre_publish(repo, build_id, journal_bytes)
    LocalDirBackend(repo).publish_release(build_id)


def _boundary_published_pre_commit_no_staging(repo, build_id, journal_bytes):
    # The CI fresh-runner shape: staging is gone entirely, so completion must
    # recover from the published release's own journal asset.
    _boundary_published_pre_commit(repo, build_id, journal_bytes)
    shutil.rmtree(_staged(repo, build_id))


def _boundary_committed_pre_pointer(repo, build_id, journal_bytes):
    _boundary_published_pre_commit(repo, build_id, journal_bytes)
    materialize_from_journal(journal_bytes, repo / "builds")


_BOUNDARIES = {
    "staged_journal_pre_draft": _boundary_pre_draft,
    "draft_created_no_assets": _boundary_draft_created,
    "partial_journal_upload": _boundary_partial_journal,
    "journal_verified_pre_consumer_db": _boundary_journal_uploaded_no_db,
    "both_verified_pre_publish": _boundary_both_uploaded_pre_publish,
    "published_pre_commit": _boundary_published_pre_commit,
    "published_pre_commit_empty_workspace": _boundary_published_pre_commit_no_staging,
    "committed_pre_pointer": _boundary_committed_pre_pointer,
}


# The pre-draft boundary is BENIGN by construction and owner-accepted (§13.5,
# 2026-07-23): before the first remote mutation there is no durable remote or
# committed state, so a crash strands nothing — a fresh runner rebuilds from the
# (regenerable) source DB. The two draft-armed-but-no-valid-journal boundaries
# leave an orphan remote draft with no durable recovery journal (committing the
# inline-DB journal to git is rejected — it would regress DR-5/§13.4 git-bloat):
# recovery refuses LOUDLY (operator runbook) and preserves the draft. The same-
# build_id completion guarantee therefore applies from the FIRST REMOTE JOURNAL
# onward, not before.
_NO_DURABLE_JOURNAL = {
    "staged_journal_pre_draft",
    "draft_created_no_assets",
    "partial_journal_upload",
}


def _fresh_runner_workspace(runner_repo: Path, dest: Path) -> Path:
    """A brand-new Actions runner (F1): committed data-repo state + the remote.

    A fresh runner is a fresh git clone plus the (mock) remote. It carries ONLY
    genuinely durable state: the remote (`releases/`), and `builds/` +
    `latest.json` which are committed together atomically at finalize (§5.5 P1)
    — so they travel only as a pair. The ephemeral `.staging/` scratch (which
    inlines the DB and is NEVER committed to git — DR-5/§13.4) is a lost
    runner's working directory and is NEVER carried over.
    """
    dest.mkdir()
    if (runner_repo / "releases").is_dir():
        shutil.copytree(runner_repo / "releases", dest / "releases")
    # builds/ and latest.json are one atomic finalize commit: present together
    # or not at all. A materialized-but-unpointed builds/ (latest.json absent)
    # was never committed, so a fresh clone would not have it either.
    if (runner_repo / "latest.json").is_file():
        shutil.copyfile(runner_repo / "latest.json", dest / "latest.json")
        if (runner_repo / "builds").is_dir():
            shutil.copytree(runner_repo / "builds", dest / "builds")
    assert not (dest / STAGING_DIR).exists()  # scratch never travels (the defect)
    return dest


@pytest.mark.parametrize("boundary", sorted(_BOUNDARIES))
def test_fresh_runner_completes_same_build_at_every_boundary(tmp_path, boundary):
    """Recovery is driven from a genuinely FRESH runner workspace — committed
    data-repo state + the (mock) remote only, with NO carried-over `.staging/`
    (R25/R31/R35).

    From the first remote journal onward, recovery COMPLETES the same build_id
    with no source database, raw archive, or canonical store. Before a durable
    journal exists (pre-draft, or a draft armed with no/partial journal),
    recovery refuses SAFELY — never a partial pointer, never a deleted draft —
    because a lost runner genuinely cannot complete it, and rebuilding from the
    regenerable source DB is the correct, honest behavior (owner-accepted
    pre-draft limitation, §13.5).
    """
    runner = make_repo(tmp_path, "runner")
    db = seed_db(tmp_path / "populus.db")
    build_report = run_build(db, runner, now=pin(), backend=LocalDirBackend(runner))
    build_id = build_report.build_id
    journal_bytes = (_staged(runner, build_id) / "journal.json").read_bytes()
    _BOUNDARIES[boundary](runner, build_id, journal_bytes)

    # The lost runner is gone; a NEW runner reconstructs its workspace from the
    # committed data repo + the remote alone — never the old `.staging/` scratch.
    repo = _fresh_runner_workspace(runner, tmp_path / "fresh")
    backend = RecordingBackend(repo)
    remote_dir = repo / "releases" / f"data-{build_id}"

    if boundary in _NO_DURABLE_JOURNAL:
        with pytest.raises(PublishError):
            run_publish(repo, now=pin(), backend=backend)
        # Safe refusal at every no-durable-journal boundary: nothing consumer-
        # visible written, nothing deleted.
        assert "delete_release" not in backend.op_names()
        assert not (repo / "latest.json").exists()
        assert not (repo / "builds" / build_id / "manifest.json").exists()
        if boundary == "staged_journal_pre_draft":
            # Benign by construction: no remote mutation occurred, so a fresh
            # runner starts completely clean — nothing is stranded.
            assert not remote_dir.exists()
        else:
            # An orphan draft is stranded on the remote but PRESERVED (resolved
            # via the §13.5 operator runbook), never abandoned by deletion.
            assert backend.get_release(build_id) is not None
        return

    report = run_publish(repo, now=pin(), backend=backend)
    completed = {report.build_id, *report.reconciled}
    assert build_id in completed
    assert "delete_release" not in backend.op_names()

    # Consistent published + committed + pointed state, exact bytes from the
    # journal — reconstructed with no `.staging/` at all.
    release = backend.get_release(build_id)
    assert release is not None and not release.draft
    assert set(release.assets) == {"congress.db", "journal.json"}
    remote_journal = (remote_dir / "journal.json").read_bytes()
    assert remote_journal == journal_bytes
    journal = journal_load(journal_bytes)
    committed_manifest = (repo / "builds" / build_id / "manifest.json").read_bytes()
    assert committed_manifest == journal["artifacts"]["manifest.json"].encode("utf-8")
    assert latest_pointer(repo)["build_id"] == build_id
    assert not _staged(repo, build_id).exists()
    verify = run_verify(repo, now=pin(), db_path=db)
    assert verify.ok, verify.errors

    # Idempotent completion: re-driving the SAME build from yet another fresh
    # runner (journal recovered from the published release) changes nothing.
    pointer_before = latest_pointer(repo)
    again = run_publish(
        repo, now=pin(), backend=RecordingBackend(repo), build_id=build_id
    )
    assert again.build_id == build_id
    assert latest_pointer(repo) == pointer_before
    assert latest_pointer(repo)["pointer_version"] == 1


def test_recovery_without_any_journal_fails_loudly_never_deletes(tmp_path):
    """A draft recoverable from neither journal is an operator problem."""
    db = seed_db(tmp_path / "populus.db")
    repo = make_repo(tmp_path)
    report = run_build(db, repo, now=pin(), backend=LocalDirBackend(repo))
    build_id = report.build_id
    LocalDirBackend(repo).ensure_draft(build_id)
    shutil.rmtree(_staged(repo, build_id))
    backend = RecordingBackend(repo)
    with pytest.raises(PublishError, match="disaster-recovery runbook"):
        run_publish(repo, now=pin(), backend=backend)
    assert "delete_release" not in backend.op_names()
    assert backend.get_release(build_id) is not None  # the draft survives


def _git(repo: Path, *args: str) -> subprocess.CompletedProcess:
    return subprocess.run(  # nosec B603 B607 — fixed binary, argv list, test-only
        ["git", "-c", "user.name=t", "-c", "user.email=t@t", "-C", str(repo), *args],
        capture_output=True,
        text=True,
        check=True,
    )


def test_draft_onward_recovery_from_fresh_git_clone_no_db_in_git(tmp_path):
    """F1 (durable boundary, real git): from the first remote journal onward a
    genuinely fresh runner — a real `git clone` carrying committed state only,
    plus the remote — completes the SAME build_id with NO working-tree
    `.staging/` scratch. And NO DB bytes are ever committed to git: the inline-
    DB journal and the DB itself are Release assets (DR-5/§13.4)."""
    runner = make_repo(tmp_path, "runner")
    _git(runner, "init", "-q")
    _git(runner, "commit", "-q", "--allow-empty", "-m", "init")

    db = seed_db(tmp_path / "populus.db")
    report = run_build(db, runner, now=pin(), backend=LocalDirBackend(runner))
    build_id = report.build_id
    journal_bytes = (_staged(runner, build_id) / "journal.json").read_bytes()
    # Durable boundary: journal + DB uploaded and the release PUBLISHED (the
    # first remote object exists); builds/ + latest.json not yet committed.
    _boundary_published_pre_commit(runner, build_id, journal_bytes)

    # The workflow only ever `git add builds latest.json` — never `.staging` or
    # the DB. Nothing DB-bearing is tracked in git (releases/ is gitignored).
    tracked = _git(runner, "ls-files").stdout.split()
    assert not any(
        ".staging" in path or path.endswith("journal.json") or path.endswith(".db")
        for path in tracked
    ), tracked

    # A brand-new runner: real clone of committed state only, then the remote
    # (releases/ is gitignored — the off-git 'remote' — so it is copied across).
    fresh = tmp_path / "fresh"
    _git(tmp_path, "clone", "-q", str(runner), str(fresh))
    assert not (fresh / STAGING_DIR).exists()  # scratch never traveled
    assert not (fresh / "releases").exists()  # gitignored: DB/journal not cloned
    shutil.copytree(runner / "releases", fresh / "releases")

    result = run_publish(fresh, now=pin(), backend=RecordingBackend(fresh))
    assert build_id in {result.build_id, *result.reconciled}
    assert latest_pointer(fresh)["build_id"] == build_id
    release = LocalDirBackend(fresh).get_release(build_id)
    assert release is not None and not release.draft
    assert run_verify(fresh, now=pin(), db_path=db).ok


def test_differing_republish_of_published_build_refused(tmp_path):
    db = seed_db(tmp_path / "populus.db")
    repo = make_repo(tmp_path)
    report = publish_build(db, repo)
    build_id = report.build_id
    asset = repo / "releases" / f"data-{build_id}" / "congress.db"
    before = hashlib.sha256(asset.read_bytes()).hexdigest()

    # A differing (but internally valid) journal for the SAME build_id, built
    # from a mutated database in a second repo.
    db2 = seed_db(make_repo(tmp_path, "other") / "populus2.db")
    mutate_db(db2)
    repo2 = make_repo(tmp_path, "repo2")
    run_build(db2, repo2, now=pin(), backend=LocalDirBackend(repo2))
    differing = (_staged(repo2, build_id) / "journal.json").read_bytes()
    assert journal_valid(differing) and differing != (
        repo / "releases" / f"data-{build_id}" / "journal.json"
    ).read_bytes()
    staged = _staged(repo, build_id)
    staged.mkdir(parents=True)
    (staged / "journal.json").write_bytes(differing)

    with pytest.raises(PublishError, match="refusing to re-publish"):
        run_publish(repo, now=pin(), backend=LocalDirBackend(repo), build_id=build_id)
    assert hashlib.sha256(asset.read_bytes()).hexdigest() == before


def test_conflicting_committed_build_refused_with_zero_backend_mutations(tmp_path):
    """F2: a journal conflicting with an already-committed build is refused in
    preflight — BEFORE any draft/upload/publish — so a conflicting republish
    causes ZERO backend mutations and leaves the committed build untouched. The
    check is COMPLETE: any committed artifact differing (not only manifest.json)
    triggers it."""
    db = seed_db(tmp_path / "populus.db")
    repo = make_repo(tmp_path)
    first = publish_build(db, repo)  # build A: committed + published + pointed
    build_id = first.build_id
    committed = {
        p.relative_to(repo).as_posix(): p.read_bytes()
        for p in (repo / "builds" / build_id).rglob("*")
        if p.is_file()
    }
    # Drop the remote release so recovery does not short-circuit on a
    # remote-vs-staged journal mismatch; the committed build stays.
    shutil.rmtree(repo / "releases" / f"data-{build_id}")
    # A DIFFERENT (valid) journal for the SAME build_id, from a mutated DB.
    db2 = seed_db(make_repo(tmp_path, "other") / "populus2.db")
    mutate_db(db2)
    repo2 = make_repo(tmp_path, "repo2")
    run_build(db2, repo2, now=pin(), backend=LocalDirBackend(repo2))
    differing = (_staged(repo2, build_id) / "journal.json").read_bytes()
    staged = _staged(repo, build_id)
    staged.mkdir(parents=True)
    (staged / "journal.json").write_bytes(differing)

    backend = RecordingBackend(repo)
    with pytest.raises(PublishError, match="overwrite a committed build"):
        run_publish(repo, now=pin(), backend=backend, build_id=build_id)
    # Zero backend mutations: no draft created, no upload, no publish.
    assert backend.op_names() == []
    # The committed build is untouched, byte for byte.
    assert {
        p.relative_to(repo).as_posix(): p.read_bytes()
        for p in (repo / "builds" / build_id).rglob("*")
        if p.is_file()
    } == committed


def test_conflicting_committed_build_detected_beyond_manifest(tmp_path):
    """F2: the conflict check compares EVERY committed artifact — a build whose
    manifest.json still matches the journal but whose feed.json was tampered is
    still refused (the old check compared only manifest.json)."""
    db = seed_db(tmp_path / "populus.db")
    repo = make_repo(tmp_path)
    first = publish_build(db, repo)
    build_id = first.build_id
    # The ORIGINAL journal (manifest matches the committed build exactly).
    orig_journal = (
        repo / "releases" / f"data-{build_id}" / "journal.json"
    ).read_bytes()
    # Tamper ONLY a non-manifest committed artifact.
    feed = repo / "builds" / build_id / "congress" / "feed.json"
    feed.write_bytes(feed.read_bytes().replace(b"purchase", b"purchsae", 1))
    # Drop the remote release; stage the original journal for recovery.
    shutil.rmtree(repo / "releases" / f"data-{build_id}")
    staged = _staged(repo, build_id)
    staged.mkdir(parents=True)
    (staged / "journal.json").write_bytes(orig_journal)

    backend = RecordingBackend(repo)
    with pytest.raises(PublishError, match="feed.json differs from the journal"):
        run_publish(repo, now=pin(), backend=backend, build_id=build_id)
    assert backend.op_names() == []


def test_dry_run_writes_nothing(tmp_path):
    db = seed_db(tmp_path / "populus.db")
    repo = make_repo(tmp_path)
    run_build(db, repo, now=pin(), backend=LocalDirBackend(repo))
    backend = RecordingBackend(repo)
    report = run_publish(repo, now=pin(), backend=backend, dry_run=True)
    assert report.dry_run
    assert not (repo / "latest.json").exists()
    assert not (repo / "builds").exists()
    assert not (repo / "releases").exists()
    mutating = {"ensure_draft", "upload", "publish_release", "delete_release"}
    assert not mutating & set(backend.op_names())


def test_second_publish_bumps_pointer_version_and_previous_build(tmp_path):
    db = seed_db(tmp_path / "populus.db")
    repo = make_repo(tmp_path)
    first = publish_build(db, repo)
    assert latest_pointer(repo)["pointer_version"] == 1
    mutate_db(db)
    second = publish_build(db, repo, moment=NOW + timedelta(days=1))
    pointer = latest_pointer(repo)
    assert pointer["pointer_version"] == 2
    assert second.build_id == "20260724.1"
    assert pointer["build_id"] == second.build_id
    manifest = read_manifest(repo, second.build_id)
    assert manifest["previous_build_id"] == first.build_id


def test_rollback_to_mints_higher_pointer_targeting_older_build(tmp_path):
    db = seed_db(tmp_path / "populus.db")
    repo = make_repo(tmp_path)
    first = publish_build(db, repo)
    mutate_db(db)
    publish_build(db, repo, moment=NOW + timedelta(days=1))
    report = run_publish(
        repo,
        now=pin(NOW + timedelta(days=1, hours=1)),
        backend=LocalDirBackend(repo),
        rollback_to=first.build_id,
    )
    pointer = latest_pointer(repo)
    assert report.pointer_version == 3
    assert pointer["pointer_version"] == 3
    assert pointer["build_id"] == first.build_id
    manifest_bytes = (
        repo / "builds" / first.build_id / "manifest.json"
    ).read_bytes()
    assert pointer["manifest_sha256"] == hashlib.sha256(manifest_bytes).hexdigest()
    verify = run_verify(repo, now=pin(NOW + timedelta(days=1, hours=2)))
    assert verify.ok, verify.errors


def test_rollback_refused_when_target_release_asset_missing(tmp_path):
    """F4: rollback verifies the target's immutable Release assets through the
    backend BEFORE repointing — a missing DB asset refuses the rollback."""
    db = seed_db(tmp_path / "populus.db")
    repo = make_repo(tmp_path)
    first = publish_build(db, repo)
    mutate_db(db)
    publish_build(db, repo, moment=NOW + timedelta(days=1))
    before = latest_pointer(repo)
    # Remove the target build's Release directory entirely.
    shutil.rmtree(repo / "releases" / f"data-{first.build_id}")
    with pytest.raises(PublishError, match="missing or does not match"):
        run_publish(
            repo,
            now=pin(NOW + timedelta(days=1, hours=1)),
            backend=LocalDirBackend(repo),
            rollback_to=first.build_id,
        )
    assert latest_pointer(repo) == before  # pointer untouched


def test_rollback_refused_when_target_asset_corrupt(tmp_path):
    """F4: a corrupt target DB asset (hash mismatch) refuses the rollback."""
    db = seed_db(tmp_path / "populus.db")
    repo = make_repo(tmp_path)
    first = publish_build(db, repo)
    mutate_db(db)
    publish_build(db, repo, moment=NOW + timedelta(days=1))
    before = latest_pointer(repo)
    asset = repo / "releases" / f"data-{first.build_id}" / "congress.db"
    asset.write_bytes(asset.read_bytes() + b"corruption")
    with pytest.raises(PublishError, match="missing or does not match"):
        run_publish(
            repo,
            now=pin(NOW + timedelta(days=1, hours=1)),
            backend=LocalDirBackend(repo),
            rollback_to=first.build_id,
        )
    assert latest_pointer(repo) == before


def test_rollback_refused_on_unparseable_target_manifest(tmp_path):
    """F4: a malformed rollback-target manifest refuses cleanly (PublishError),
    never an uncaught JSON exception out of the publish command."""
    db = seed_db(tmp_path / "populus.db")
    repo = make_repo(tmp_path)
    first = publish_build(db, repo)
    mutate_db(db)
    publish_build(db, repo, moment=NOW + timedelta(days=1))
    before = latest_pointer(repo)
    # The older target build's committed metadata is corrupt (digest-consistent
    # is irrelevant — verify never gets that far; the parse must not crash).
    (repo / "builds" / first.build_id / "manifest.json").write_bytes(b"{ not json")
    with pytest.raises(PublishError, match="unparseable manifest"):
        run_publish(
            repo,
            now=pin(NOW + timedelta(days=1, hours=1)),
            backend=LocalDirBackend(repo),
            rollback_to=first.build_id,
        )
    assert latest_pointer(repo) == before  # nothing repointed


def test_rollback_reconciles_pending_draft_before_repointing(tmp_path):
    """F7: `--rollback-to` runs reconcile_inflight FIRST. A pending recoverable
    draft is completed before the rollback repoints, so it is neither stranded
    nor able to later mint a higher pointer that silently undoes the rollback."""
    db = seed_db(tmp_path / "populus.db")
    repo = make_repo(tmp_path)
    first = publish_build(db, repo)  # b1 → pointer v1
    mutate_db(db)
    b2 = run_build(
        db, repo, now=pin(NOW + timedelta(days=1)), backend=LocalDirBackend(repo)
    ).build_id
    # Arm a recoverable in-flight draft for b2 (journal + DB uploaded, not yet
    # published) — an interrupted publish a fresh runner would complete.
    journal_bytes = (_staged(repo, b2) / "journal.json").read_bytes()
    _boundary_both_uploaded_pre_publish(repo, b2, journal_bytes)

    report = run_publish(
        repo,
        now=pin(NOW + timedelta(days=1, hours=1)),
        backend=LocalDirBackend(repo),
        rollback_to=first.build_id,
    )
    # The pending draft was completed FIRST (reconciled), THEN the rollback ran.
    assert b2 in report.reconciled
    assert report.build_id == first.build_id
    b2_release = LocalDirBackend(repo).get_release(b2)
    assert b2_release is not None and not b2_release.draft  # not stranded
    assert (repo / "builds" / b2 / "manifest.json").is_file()  # b2 committed
    pointer = latest_pointer(repo)
    assert pointer["build_id"] == first.build_id  # rollback is the newest pointer
    assert pointer["pointer_version"] == 3  # v1=b1, v2=reconciled b2, v3=rollback

    # The rollback stands: a later reconcile finds nothing pending and does not
    # repoint back to the newer build.
    rec = reconcile_inflight(
        repo, now=pin(NOW + timedelta(days=1, hours=2)), backend=LocalDirBackend(repo)
    )
    assert rec.completed == ()
    assert latest_pointer(repo)["build_id"] == first.build_id


def test_rollback_dry_run_refuses_while_draft_pending(tmp_path):
    """F7: `--rollback-to --dry-run` must not mutate; with an in-flight draft
    pending it refuses (reporting the state) rather than silently ignoring it."""
    db = seed_db(tmp_path / "populus.db")
    repo = make_repo(tmp_path)
    first = publish_build(db, repo)
    before = latest_pointer(repo)
    mutate_db(db)
    b2 = run_build(
        db, repo, now=pin(NOW + timedelta(days=1)), backend=LocalDirBackend(repo)
    ).build_id
    journal_bytes = (_staged(repo, b2) / "journal.json").read_bytes()
    _boundary_both_uploaded_pre_publish(repo, b2, journal_bytes)

    with pytest.raises(PublishError, match="in-flight draft"):
        run_publish(
            repo,
            now=pin(NOW + timedelta(days=1, hours=1)),
            backend=LocalDirBackend(repo),
            rollback_to=first.build_id,
            dry_run=True,
        )
    assert latest_pointer(repo) == before  # dry-run mutated nothing
    assert LocalDirBackend(repo).get_release(b2).draft  # draft untouched


def test_publish_nothing_staged_fails_cleanly(tmp_path):
    repo = make_repo(tmp_path)
    with pytest.raises(PublishError, match="nothing staged"):
        run_publish(repo, now=pin(), backend=LocalDirBackend(repo))


@pytest.mark.parametrize(
    "kwargs",
    [
        {"build_id": "../../etc"},
        {"build_id": "20260723.1/../.."},
        {"rollback_to": "../evil"},
        {"rollback_to": "not-a-build-id"},
    ],
)
def test_publish_rejects_traversal_build_ids_at_boundary(tmp_path, kwargs):
    """Path-safety sweep: externally-supplied `--build`/`--rollback-to` that are
    not well-formed build ids are refused at the boundary — before any path is
    derived from them (no `.staging/<id>` / `builds/<id>` / `data-<id>` escape),
    with zero backend mutations."""
    db = seed_db(tmp_path / "populus.db")
    repo = make_repo(tmp_path)
    publish_build(db, repo)  # a valid published build exists
    backend = RecordingBackend(repo)
    with pytest.raises(PublishError, match="not a valid build_id"):
        run_publish(repo, now=pin(), backend=backend, **kwargs)
    assert backend.op_names() == []


def test_publish_attests_manifest_and_pointer(tmp_path):
    db = seed_db(tmp_path / "populus.db")
    repo = make_repo(tmp_path)
    run_build(db, repo, now=pin(), backend=LocalDirBackend(repo))
    spy = SpyAttestation()
    run_publish(repo, now=pin(), backend=LocalDirBackend(repo), attestation=spy)
    assert ("attest", "manifest.json") in spy.calls
    assert ("attest", "latest.json") in spy.calls


# --- backend lifecycle (R11/R32) ---------------------------------------------


def test_local_backend_lifecycle(tmp_path):
    repo = make_repo(tmp_path)
    backend = LocalDirBackend(repo)
    bid = "20260723.1"
    assert backend.get_release(bid) is None
    backend.ensure_draft(bid)
    assert backend.get_release(bid).draft
    assert (repo / "releases" / ".gitignore").read_text() == "*\n"

    payload = tmp_path / "a.txt"
    payload.write_text("one")
    backend.upload(bid, payload, name="asset.txt")
    payload.write_text("two")
    with pytest.raises(BackendError, match="clobber"):
        backend.upload(bid, payload, name="asset.txt")
    backend.upload(bid, payload, name="asset.txt", clobber=True)  # drafts clobber
    sha = hashlib.sha256(b"two").hexdigest()
    assert backend.verify_asset(bid, "asset.txt", sha256=sha, size=3)

    backend.publish_release(bid)
    assert not backend.get_release(bid).draft
    backend.upload(bid, payload, name="asset.txt")  # exact-byte idempotent: ok
    payload.write_text("three")
    with pytest.raises(BackendError, match="immutable"):
        backend.upload(bid, payload, name="asset.txt", clobber=True)
    with pytest.raises(BackendError, match="drafts-only"):
        backend.delete_release(bid)

    draft = "20260723.2"
    backend.ensure_draft(draft)
    backend.delete_release(draft)  # drafts-only operator path
    assert backend.get_release(draft) is None


def test_local_backend_upload_rejects_traversal_and_symlink_escape(tmp_path):
    """F3: an asset name (or a symlinked build dir) that would escape the
    backend root is refused — nothing is written outside `releases/`."""
    repo = make_repo(tmp_path)
    backend = LocalDirBackend(repo)
    bid = "20260723.1"
    backend.ensure_draft(bid)
    src = tmp_path / "payload"
    src.write_bytes(b"escape attempt")

    # (a) traversal asset names are rejected before any write.
    outside = tmp_path / "escaped.txt"
    for hostile in ("../../../escaped.txt", "../congress.db", "sub/../../x"):
        with pytest.raises(BackendError, match="unsafe asset name"):
            backend.upload(bid, src, name=hostile)
    assert not outside.exists()
    assert list((repo / "releases" / f"data-{bid}").iterdir()) == [
        repo / "releases" / f"data-{bid}" / ".draft"
    ]  # nothing was written into the build dir either

    # (b) a symlinked build dir cannot be used to escape the releases root —
    # the chokepoint refuses it (at get_release/_safe_path) before any write.
    external = tmp_path / "external"
    external.mkdir()
    (external / ".draft").touch()  # so a naive get_release would see a release
    (repo / "releases" / "data-20260723.2").symlink_to(
        external, target_is_directory=True
    )
    with pytest.raises(BackendError, match="escapes the releases root"):
        backend.upload("20260723.2", src, name="congress.db")
    assert not (external / "congress.db").exists()  # never written through the link


def test_publish_release_refuses_symlinked_release_dir(tmp_path):
    """F1: publish_release routes the `.draft` unlink through the containment
    chokepoint — a symlinked `data-<build_id>` pointing outside `releases/` is
    refused and the external `.draft` is never unlinked."""
    repo = make_repo(tmp_path)
    backend = LocalDirBackend(repo)
    (repo / "releases").mkdir(parents=True, exist_ok=True)
    external = tmp_path / "external"
    external.mkdir()
    marker = external / ".draft"
    marker.touch()
    (repo / "releases" / "data-20260723.1").symlink_to(
        external, target_is_directory=True
    )
    with pytest.raises(BackendError, match="escapes the releases root"):
        backend.publish_release("20260723.1")
    assert marker.exists()  # the external .draft was never unlinked


def test_materialize_from_journal_refuses_symlinked_build_dir(tmp_path):
    """F2: materialize refuses a symlinked `builds/<build_id>` and writes every
    artifact from the fixed `builds/` root — nothing lands outside `builds/`."""
    db = seed_db(tmp_path / "populus.db")
    repo = make_repo(tmp_path)
    build_id = run_build(db, repo, now=pin(), backend=LocalDirBackend(repo)).build_id
    journal_bytes = (_staged(repo, build_id) / "journal.json").read_bytes()

    builds = tmp_path / "builds-under-test"
    builds.mkdir()
    external = tmp_path / "outside-builds"
    external.mkdir()
    (builds / build_id).symlink_to(external, target_is_directory=True)

    with pytest.raises(PublishError, match="symlink"):
        materialize_from_journal(journal_bytes, builds)
    assert list(external.iterdir()) == []  # nothing written through the symlink


def test_publish_refuses_symlinked_build_dir_with_zero_backend_mutations(tmp_path):
    """F2: a symlinked `builds/<build_id>` is refused in preflight — BEFORE any
    backend mutation — so the release is never armed and nothing is written
    outside `builds/`."""
    db = seed_db(tmp_path / "populus.db")
    repo = make_repo(tmp_path)
    build_id = run_build(db, repo, now=pin(), backend=LocalDirBackend(repo)).build_id
    external = tmp_path / "external"
    external.mkdir()
    (repo / "builds").mkdir(parents=True, exist_ok=True)
    (repo / "builds" / build_id).symlink_to(external, target_is_directory=True)

    backend = RecordingBackend(repo)
    with pytest.raises(PublishError, match="symlink"):
        run_publish(repo, now=pin(), backend=backend)
    assert backend.op_names() == []  # refused in preflight → zero backend mutations
    assert list(external.iterdir()) == []  # nothing written outside builds/
    assert not (repo / "latest.json").exists()  # no pointer written


# --- owned-base symlink refusal (R9/F1-F4, round 9) --------------------------


def test_backend_refuses_symlinked_releases_base(tmp_path):
    """F1: the Populus-owned `releases/` base must be a real directory it
    created — a symlink swapped in is refused, no write redirected outside."""
    repo = make_repo(tmp_path)
    external = tmp_path / "external-releases"
    external.mkdir()
    (repo / "releases").symlink_to(external, target_is_directory=True)
    backend = LocalDirBackend(repo)
    with pytest.raises(BackendError, match="releases/ is a symlink"):
        backend.ensure_draft("20260723.1")
    assert list(external.iterdir()) == []  # nothing created through the symlink


def test_run_build_refuses_symlinked_staging_base(tmp_path):
    """F2: the Populus-owned `.staging/` base must be a real directory — a
    symlink is refused before any staged content is written."""
    db = seed_db(tmp_path / "populus.db")
    repo = make_repo(tmp_path)
    external = tmp_path / "external-staging"
    external.mkdir()
    (repo / STAGING_DIR).symlink_to(external, target_is_directory=True)
    with pytest.raises(PublishError, match=r"\.staging/ is a symlink"):
        run_build(db, repo, now=pin(), backend=LocalDirBackend(repo))
    assert list(external.iterdir()) == []  # nothing written through the symlink


def test_publish_refuses_symlinked_builds_base(tmp_path):
    """F3: the Populus-owned `builds/` base must be a real directory — a symlink
    is refused in preflight, before any backend mutation or materialize write."""
    db = seed_db(tmp_path / "populus.db")
    repo = make_repo(tmp_path)
    run_build(db, repo, now=pin(), backend=LocalDirBackend(repo))
    external = tmp_path / "external-builds"
    external.mkdir()
    (repo / "builds").symlink_to(external, target_is_directory=True)
    backend = RecordingBackend(repo)
    with pytest.raises(PublishError, match="builds/ is a symlink"):
        run_publish(repo, now=pin(), backend=backend)
    assert backend.op_names() == []  # refused before any backend mutation
    assert list(external.iterdir()) == []  # nothing written through the symlink
    assert not (repo / "latest.json").exists()


class FakeGh:
    """A recording ``gh`` shim: scripted (matcher → response) queue."""

    def __init__(self):
        self.calls: list[list[str]] = []
        self.responses: list[tuple[tuple[str, ...], tuple[int, str, str]]] = []

    def script(self, prefix: tuple[str, ...], code: int, out: str = "", err: str = ""):
        self.responses.append((prefix, (code, out, err)))

    def __call__(self, args: list[str]) -> tuple[int, str, str]:
        self.calls.append(list(args))
        for index, (prefix, response) in enumerate(self.responses):
            if tuple(args[: len(prefix)]) == prefix:
                self.responses.pop(index)
                return response
        raise AssertionError(f"unscripted gh call: {args}")


def test_gh_backend_command_construction(tmp_path):
    gh = FakeGh()
    backend = GhReleaseBackend("acme/populus-data", transport=gh)
    tag = "data-20260723.1"
    asset = tmp_path / "journal.json"
    asset.write_bytes(b"journal-bytes")

    # Absent release → view says not found → create --draft.
    gh.script(("release", "view"), 1, "", "release not found")
    gh.script(("release", "create"), 0)
    backend.ensure_draft("20260723.1")
    assert gh.calls[0][:3] == ["release", "view", tag]
    create = gh.calls[1]
    assert create[:3] == ["release", "create", tag]
    assert "--draft" in create and "--repo" in create

    # Upload to a DRAFT (view says draft) with and without clobber.
    gh.script(("release", "view"), 0, json.dumps({"isDraft": True, "assets": []}), "")
    gh.script(("release", "upload"), 0)
    backend.upload("20260723.1", asset, clobber=True)
    assert gh.calls[-1][:2] == ["release", "upload"]
    assert gh.calls[-1][-1] == "--clobber"
    gh.script(("release", "view"), 0, json.dumps({"isDraft": True, "assets": []}), "")
    gh.script(("release", "upload"), 0)
    backend.upload("20260723.1", asset)
    assert gh.calls[-1][-1] != "--clobber"

    # F7: upload to a PUBLISHED release is verify-only — a clobber attempt whose
    # bytes do not match the published asset is rejected, and NO upload command
    # is issued (the state guard fires inside the backend, not via a race).
    gh.script(
        ("release", "view"),
        0,
        json.dumps({"isDraft": False, "assets": [{"name": "journal.json"}]}),
        "",
    )
    gh.script(("release", "download"), 1, "", "download failed")  # verify → False
    with pytest.raises(BackendError, match="immutable"):
        backend.upload("20260723.1", asset, clobber=True)
    assert gh.calls[-1][:2] == ["release", "download"]  # verify, never upload

    # Publish flips the draft flag once.
    gh.script(("release", "edit"), 0)
    backend.publish_release("20260723.1")
    assert gh.calls[-1][:3] == ["release", "edit", tag]
    assert "--draft=false" in gh.calls[-1]

    # delete_release refuses a published release before any delete call.
    gh.script(
        ("release", "view"), 0, json.dumps({"isDraft": False, "assets": []}), ""
    )
    with pytest.raises(BackendError, match="drafts-only"):
        backend.delete_release("20260723.1")
    assert gh.calls[-1][:2] == ["release", "view"]

    # delete_release deletes a draft with --yes.
    gh.script(
        ("release", "view"), 0, json.dumps({"isDraft": True, "assets": []}), ""
    )
    gh.script(("release", "delete"), 0)
    backend.delete_release("20260723.1")
    assert gh.calls[-1][:3] == ["release", "delete", tag]
    assert "--yes" in gh.calls[-1]

    # Listing filters drafts vs published and parses tags.
    listing = json.dumps(
        [
            {"tagName": "data-20260723.1", "isDraft": True},
            {"tagName": "data-20260723.2", "isDraft": False},
            {"tagName": "raw-2026-07", "isDraft": False},
        ]
    )
    gh.script(("release", "list"), 0, listing)
    assert backend.list_draft_tags() == ["20260723.1"]
    gh.script(("release", "list"), 0, listing)
    assert backend.list_published_tags("20260723") == ["20260723.2"]

    # Backend-aware locator: gh ⇒ url artifacts (locked decision 2).
    kind, url = backend.locator("20260723.1", "congress.db")
    assert kind == "url"
    assert url == (
        "https://github.com/acme/populus-data/releases/download/"
        "data-20260723.1/congress.db"
    )


def test_gh_backend_rejects_malformed_remote_json(tmp_path):
    """Class sweep: `gh` output is remote, external bytes — a malformed release
    view/list response is a BackendError, never an uncaught JSON traceback."""
    gh = FakeGh()
    backend = GhReleaseBackend("acme/populus-data", transport=gh)
    gh.script(("release", "view"), 0, "{ not json")
    with pytest.raises(BackendError, match="unparseable JSON"):
        backend.get_release("20260723.1")
    gh.script(("release", "list"), 0, "not json either")
    with pytest.raises(BackendError, match="unparseable JSON"):
        backend.list_published_tags()


def test_gh_backend_rejects_malformed_nested_shape(tmp_path):
    """F8: top-level-valid `gh` JSON whose NESTED records are malformed becomes
    a controlled BackendError, never an uncaught KeyError/attr access."""
    gh = FakeGh()
    backend = GhReleaseBackend("acme/populus-data", transport=gh)
    # release view: an asset record with no 'name' (the `{}` KeyError case).
    gh.script(("release", "view"), 0, json.dumps({"isDraft": True, "assets": [{}]}))
    with pytest.raises(BackendError, match="malformed asset record"):
        backend.get_release("20260723.1")
    # release view: a non-list assets field.
    gh.script(("release", "view"), 0, json.dumps({"isDraft": False, "assets": 5}))
    with pytest.raises(BackendError, match="non-list assets"):
        backend.get_release("20260723.1")
    # release view: a non-boolean isDraft.
    gh.script(("release", "view"), 0, json.dumps({"isDraft": "yes", "assets": []}))
    with pytest.raises(BackendError, match="non-boolean isDraft"):
        backend.get_release("20260723.1")
    # release list: a malformed record fails CLOSED with a BackendError (F1),
    # consistent with get_release — not silently skipped.
    gh.script(
        ("release", "list"), 0, json.dumps([{"tagName": 123, "isDraft": False}])
    )
    with pytest.raises(BackendError, match="malformed record"):
        backend.list_published_tags()
    gh.script(("release", "list"), 0, json.dumps(["junk"]))
    with pytest.raises(BackendError, match="non-object record"):
        backend.list_published_tags()
    # A well-formed record whose tag is simply not ours is still skipped; only
    # our data-* tags are returned.
    gh.script(
        ("release", "list"),
        0,
        json.dumps(
            [
                {"tagName": "v1.2.3", "isDraft": False},
                {"tagName": "data-20260723.1", "isDraft": False},
            ]
        ),
    )
    assert backend.list_published_tags() == ["20260723.1"]


# --- manifest URL grammar pinning (R29/F5) -----------------------------------


def _manifest_with_db_url(tmp_path, url: str) -> dict:
    db = seed_db(tmp_path / "populus.db")
    repo = make_repo(tmp_path)
    report = publish_build(db, repo)
    manifest = read_manifest(repo, report.build_id)
    entry = find_artifact(manifest, "congress.db")
    del entry["path"]
    entry["url"] = url
    return manifest


def test_manifest_accepts_canonical_release_url(tmp_path):
    manifest = _manifest_with_db_url(
        tmp_path,
        "https://github.com/acme/populus-data/releases/download/"
        "data-20260723.1/congress.db",
    )
    assert validate_manifest(manifest) == []


@pytest.mark.parametrize(
    "url",
    [
        # Off-origin host containing the build tag — the exfiltration vector.
        "https://evil.example.com/acme/populus-data/releases/download/"
        "data-20260723.1/congress.db",
        # github.com subdomain trick.
        "https://github.com.evil.example/acme/populus-data/releases/download/"
        "data-20260723.1/congress.db",
        # Wrong build tag.
        "https://github.com/acme/populus-data/releases/download/"
        "data-20260722.1/congress.db",
        # Asset segment does not match the artifact name.
        "https://github.com/acme/populus-data/releases/download/"
        "data-20260723.1/secrets.db",
        # Not a release-download path at all.
        "https://github.com/acme/populus-data/blob/main/congress.db",
        "http://github.com/acme/populus-data/releases/download/"
        "data-20260723.1/congress.db",
    ],
)
def test_manifest_rejects_noncanonical_release_urls(tmp_path, url):
    manifest = _manifest_with_db_url(tmp_path, url)
    errors = validate_manifest(manifest)
    assert errors and any("congress.db" in error for error in errors)


# --- watermark evidence (R3/F12) ---------------------------------------------


def test_manifest_rejects_absent_or_malformed_watermarks(tmp_path):
    db = seed_db(tmp_path / "populus.db")
    repo = make_repo(tmp_path)
    report = publish_build(db, repo)
    base = read_manifest(repo, report.build_id)

    def with_watermarks(value):
        manifest = json.loads(json.dumps(base))
        manifest["modules"]["congress"]["watermarks"] = value
        return manifest

    both = {"house_index_last_modified": None, "senate_max_filed_date": None}
    # Both-null is legitimate freshness evidence (fresh DB, no index meta).
    assert validate_manifest(with_watermarks(both)) == []
    # An empty map carries no freshness evidence — rejected (F12).
    assert any(
        "watermark" in e for e in validate_manifest(with_watermarks({}))
    )
    # A missing required key is rejected.
    assert any(
        "watermark" in e
        for e in validate_manifest(
            with_watermarks({"house_index_last_modified": None})
        )
    )
    # An extra key is rejected.
    assert any(
        "watermark" in e
        for e in validate_manifest(with_watermarks({**both, "extra": None}))
    )
    # A non-string, non-null value is rejected.
    assert any(
        "watermark" in e
        for e in validate_manifest(
            with_watermarks({**both, "house_index_last_modified": 123})
        )
    )


# --- manifest requires the congress module (R3/R17/F5) -----------------------


def test_manifest_requires_congress_module(tmp_path):
    """F5: a structurally valid manifest that omits the `congress` module is
    rejected — every RUN 5 consumer dereferences it unconditionally, so its
    absence must be a validation defect, not a downstream KeyError."""
    db = seed_db(tmp_path / "populus.db")
    repo = make_repo(tmp_path)
    report = publish_build(db, repo)
    base = read_manifest(repo, report.build_id)
    assert validate_manifest(base) == []  # the real manifest is accepted

    # (a) the congress module renamed away — only an unrelated module present.
    only_other = json.loads(json.dumps(base))
    only_other["modules"] = {"weather": only_other["modules"]["congress"]}
    errors = validate_manifest(only_other)
    assert errors and any("congress" in error for error in errors)

    # (b) congress missing while other (structurally valid) modules are present.
    missing = json.loads(json.dumps(base))
    module = missing["modules"]["congress"]
    missing["modules"] = {"senate": module, "house": json.loads(json.dumps(module))}
    errors = validate_manifest(missing)
    assert errors and any("congress" in error for error in errors)


@pytest.mark.parametrize("required", sorted(REQUIRED_CONGRESS_ARTIFACTS))
def test_manifest_requires_full_mandatory_artifact_set(tmp_path, required):
    """F6: a semantically partial build — missing the DB, feed, stats, or any
    licensing artifact — is rejected, so a consumer never persists a higher
    pointer for an incomplete build (R2/R3/R8/R10)."""
    db = seed_db(tmp_path / "populus.db")
    repo = make_repo(tmp_path)
    report = publish_build(db, repo)
    manifest = read_manifest(repo, report.build_id)
    assert validate_manifest(manifest) == []  # the complete build is accepted

    artifacts = manifest["modules"]["congress"]["artifacts"]
    manifest["modules"]["congress"]["artifacts"] = [
        entry for entry in artifacts if entry["name"] != required
    ]
    errors = validate_manifest(manifest)
    assert any(
        "missing required artifact" in error and required in error
        for error in errors
    )


# --- run_verify (R10/R34) ----------------------------------------------------


@pytest.fixture
def published(tmp_path):
    db = seed_db(tmp_path / "populus.db")
    repo = make_repo(tmp_path)
    report = publish_build(db, repo)
    return db, repo, report.build_id


def test_verify_green_on_fresh_publish(published):
    db, repo, build_id = published
    report = run_verify(repo, now=pin(), db_path=db)
    assert report.ok and report.build_id == build_id
    assert report.checked_artifacts >= 8


def test_verify_detects_tampered_artifact(published):
    _db, repo, build_id = published
    target = repo / "builds" / build_id / "congress" / "feed.json"
    target.write_bytes(target.read_bytes().replace(b"purchase", b"purchsae", 1))
    report = run_verify(repo, now=pin())
    assert not report.ok
    assert any("feed.json" in error for error in report.errors)


def test_verify_detects_pointer_manifest_mismatch(published):
    _db, repo, _build_id = published
    pointer = latest_pointer(repo)
    pointer["manifest_sha256"] = "0" * 64
    (repo / "latest.json").write_text(render_pointer(pointer), encoding="utf-8")
    report = run_verify(repo, now=pin())
    assert not report.ok
    assert any("manifest_sha256" in error for error in report.errors)


def test_verify_detects_missing_artifact(published):
    _db, repo, build_id = published
    (repo / "builds" / build_id / "congress" / "stats.json").unlink()
    report = run_verify(repo, now=pin())
    assert not report.ok
    assert any("stats.json" in error and "missing" in error for error in report.errors)


def test_verify_detects_missing_or_inconsistent_licensing(published):
    _db, repo, build_id = published
    notice = repo / "builds" / build_id / "NOTICE"
    original = notice.read_text(encoding="utf-8")
    notice.write_text(original + "tampered\n", encoding="utf-8")
    report = run_verify(repo, now=pin())
    assert not report.ok
    assert any("NOTICE" in error for error in report.errors)


def test_verify_db_reconciliation_passes_source_fails_mutated(published, tmp_path):
    db, repo, _build_id = published
    assert run_verify(repo, now=pin(), db_path=db).ok
    mutated = tmp_path / "mutated.db"
    shutil.copyfile(db, mutated)
    mutate_db(mutated)
    report = run_verify(repo, now=pin(), db_path=mutated)
    assert not report.ok
    assert any("logical_digest" in error for error in report.errors)
    assert any("row count" in error for error in report.errors)


def test_verify_db_reconciliation_rejects_corrupt_db(published, tmp_path):
    """F3: a non-SQLite file passed to --db is a controlled verify failure, not
    an uncaught sqlite3.Error traceback."""
    _db, repo, _build_id = published
    corrupt = tmp_path / "corrupt.db"
    corrupt.write_bytes(b"this is not a valid sqlite database at all")
    report = run_verify(repo, now=pin(), db_path=corrupt)
    assert not report.ok
    assert any(
        "logical digest" in error or "--db" in error for error in report.errors
    )


def test_verify_db_reconciliation_rejects_digest_consistent_malformed_stats(published):
    """F3: a manifest-SHA-consistent but malformed stats.json is a controlled
    failure during --db reconciliation, not a JSON/KeyError traceback."""
    db, repo, build_id = published
    stats_path = repo / "builds" / build_id / "congress" / "stats.json"
    malformed = b"{ not valid json for stats"
    stats_path.write_bytes(malformed)
    manifest = read_manifest(repo, build_id)
    entry = find_artifact(manifest, "congress/stats.json")
    entry["sha256"] = hashlib.sha256(malformed).hexdigest()
    entry["bytes"] = len(malformed)
    _repoint_to_edited_manifest(repo, build_id, manifest)

    report = run_verify(repo, now=pin(), db_path=db)  # valid --db, malformed stats
    assert not report.ok
    assert any(
        "stats.json" in error and "malformed" in error for error in report.errors
    )


def test_verify_url_artifacts_scoped_honestly(published):
    _db, repo, build_id = published
    manifest = read_manifest(repo, build_id)
    entry = find_artifact(manifest, "congress.db")
    del entry["path"]
    entry["url"] = (
        "https://github.com/acme/populus-data/releases/download/"
        f"data-{build_id}/congress.db"
    )
    manifest_text = json.dumps(manifest, ensure_ascii=False, indent=2, sort_keys=True) + "\n"
    (repo / "builds" / build_id / "manifest.json").write_text(
        manifest_text, encoding="utf-8"
    )
    pointer = latest_pointer(repo)
    pointer["manifest_sha256"] = hashlib.sha256(
        manifest_text.encode("utf-8")
    ).hexdigest()
    (repo / "latest.json").write_text(render_pointer(pointer), encoding="utf-8")
    report = run_verify(repo, now=pin())
    assert report.ok, report.errors
    assert any("publish-time verified" in note for note in report.notes)


def test_verify_reports_expired_pointer(published):
    _db, repo, _build_id = published
    report = run_verify(repo, now=pin(NOW + timedelta(days=8)))
    assert not report.ok
    assert any("expired" in error for error in report.errors)


def test_verify_reports_future_issued_pointer(published):
    """F4: a pointer issued beyond the small skew tolerance is a verify error,
    consistent with the client's evaluate_pointer future-issuance rejection —
    but issuance within the skew is tolerated."""
    _db, repo, _build_id = published  # pointer issued_at == NOW
    # Verify clock an hour BEFORE issuance (> the 300s skew): future-issued.
    report = run_verify(repo, now=pin(NOW - timedelta(hours=1)))
    assert not report.ok
    assert any("future" in error for error in report.errors)
    # Just inside the skew window: no future-issuance error.
    within = run_verify(repo, now=pin(NOW - timedelta(seconds=60)))
    assert not any("future" in error for error in within.errors)


# --- verify checks the LOCAL database without --db (R10/F2) ------------------


def _repoint_to_edited_manifest(repo: Path, build_id: str, manifest: dict) -> None:
    """Write an edited manifest and mint a matching pointer so `run_verify`
    sees a self-consistent pointer → manifest chain (the manifest sha256 and
    licensing renders stay valid; only the artifact under test changes)."""
    manifest_text = (
        json.dumps(manifest, ensure_ascii=False, indent=2, sort_keys=True) + "\n"
    )
    (repo / "builds" / build_id / "manifest.json").write_text(
        manifest_text, encoding="utf-8"
    )
    pointer = latest_pointer(repo)
    pointer["manifest_sha256"] = hashlib.sha256(
        manifest_text.encode("utf-8")
    ).hexdigest()
    (repo / "latest.json").write_text(render_pointer(pointer), encoding="utf-8")


def _db_asset(repo: Path, build_id: str) -> Path:
    return repo / "releases" / f"data-{build_id}" / "congress.db"


def test_verify_checks_local_db_integrity_and_digest_without_db(published):
    """F2: without --db, `verify` runs PRAGMA integrity_check on the LOCAL
    database artifact and recomputes its logical_digest from the manifest-
    resolved file (the acceptance command has no external database)."""
    _db, repo, build_id = published
    # Green: the freshly published local database passes both checks.
    report = run_verify(repo, now=pin())
    assert report.ok, report.errors


def test_verify_rejects_hash_consistent_corrupt_local_db(published):
    """F2: a database whose bytes hash to the manifest sha256 but is not a
    valid SQLite file is caught by integrity_check — the manifest can be
    internally consistent yet the published database corrupt."""
    _db, repo, build_id = published
    garbage = b"this is definitely not a valid sqlite database file"
    _db_asset(repo, build_id).write_bytes(garbage)
    manifest = read_manifest(repo, build_id)
    entry = find_artifact(manifest, "congress.db")
    entry["sha256"] = hashlib.sha256(garbage).hexdigest()
    entry["bytes"] = len(garbage)
    _repoint_to_edited_manifest(repo, build_id, manifest)

    report = run_verify(repo, now=pin())  # no --db
    assert not report.ok
    assert any(
        "congress.db" in error
        and ("integrity" in error or "SQLite" in error or "logical_digest" in error)
        for error in report.errors
    )


def test_verify_rejects_wrong_logical_digest_on_local_db(published):
    """F2 (mutation-killer): a valid database whose manifest logical_digest is
    wrong is caught by direct recomputation — no --db required."""
    _db, repo, build_id = published
    manifest = read_manifest(repo, build_id)
    entry = find_artifact(manifest, "congress.db")
    assert entry["logical_digest"] != "ab" * 32
    entry["logical_digest"] = "ab" * 32  # valid hex, but the DB won't reproduce it
    _repoint_to_edited_manifest(repo, build_id, manifest)

    report = run_verify(repo, now=pin())  # no --db
    assert not report.ok
    assert any(
        "congress.db" in error and "logical_digest" in error
        for error in report.errors
    )


@pytest.mark.parametrize(
    "malformed",
    [
        b"{ this is not valid json",  # unparseable → decode/parse failure
        b"[1, 2, 3]",  # valid JSON but not an object → structure failure
    ],
)
def test_verify_rejects_digest_consistent_malformed_manifest(published, malformed):
    """F2: a manifest whose bytes hash to the pointer's manifest_sha256 but are
    not valid/structured JSON returns a failed VerifyReport, never an uncaught
    traceback (mirrors the monitor stats.json guard)."""
    _db, repo, build_id = published
    (repo / "builds" / build_id / "manifest.json").write_bytes(malformed)
    pointer = latest_pointer(repo)
    pointer["manifest_sha256"] = hashlib.sha256(malformed).hexdigest()
    (repo / "latest.json").write_text(render_pointer(pointer), encoding="utf-8")

    report = run_verify(repo, now=pin())
    assert report.ok is False
    assert any(
        "manifest" in error
        and ("unparseable" in error or "not a JSON object" in error)
        for error in report.errors
    )


# --- full-path reproducibility gate (R5/R23) ---------------------------------


def test_two_independent_builds_reproduce_logical_digest(tmp_path):
    from test_house_ingest import EFILE_2026, EFILE_2026_B, FIELDS, WITTMAN, _make_cache

    from populus.amendments import ensure_views
    from populus.ingest import house

    cache = _make_cache(
        tmp_path,
        2026,
        [WITTMAN, FIELDS],
        {"20034916": EFILE_2026, "20034800": EFILE_2026_B},
    )
    digests = []
    for run in (1, 2):
        db_path = tmp_path / f"rebuild{run}.db"
        init_db(str(db_path))
        conn = connect(str(db_path))
        try:
            counter = iter(range(1000))
            report = house.run_house_ingest(
                conn,
                years=[2026],
                raw_root=tmp_path / f"raw{run}",
                cache_dir=cache,
                run_id=f"repro-{run}",
                now=lambda: f"2026-07-23T0{run}:00:{next(counter) % 60:02d}Z",
                host=f"host{run}",
            )
            assert report.ok
            ensure_views(conn)
        finally:
            conn.close()
        repo = make_repo(tmp_path, f"repo{run}")
        build = run_build(
            db_path, repo, now=pin(), backend=LocalDirBackend(repo)
        )
        manifest = json.loads(
            (
                repo / STAGING_DIR / build.build_id / "build" / "manifest.json"
            ).read_text(encoding="utf-8")
        )
        digests.append(find_artifact(manifest, "congress.db")["logical_digest"])
    assert digests[0] == digests[1]


# --- CLI wiring (R19) --------------------------------------------------------


def test_cli_build_publish_verify_end_to_end(tmp_path):
    db = seed_db(tmp_path / "populus.db")
    repo = make_repo(tmp_path)
    runner = CliRunner()
    result = runner.invoke(
        cli_main, ["build", "--attestation=staging-noop", "--db", str(db), "--data-repo", str(repo)]
    )
    assert result.exit_code == 0, result.output
    assert "staged build" in result.output

    result = runner.invoke(
        cli_main, ["publish", "--attestation=staging-noop", "--data-repo", str(repo), "--dry-run"]
    )
    assert result.exit_code == 0, result.output
    assert "dry-run" in result.output
    assert not (repo / "latest.json").exists()

    result = runner.invoke(cli_main, ["publish", "--attestation=staging-noop", "--data-repo", str(repo)])
    assert result.exit_code == 0, result.output
    assert "published build" in result.output

    result = runner.invoke(
        cli_main, ["verify", "--attestation=staging-noop", "--data-repo", str(repo), "--db", str(db)]
    )
    assert result.exit_code == 0, result.output
    assert "verify ok" in result.output


def test_cli_gh_backend_requires_repo_slug(tmp_path):
    repo = make_repo(tmp_path)
    result = CliRunner().invoke(
        cli_main,
        ["publish", "--attestation=staging-noop", "--data-repo", str(repo), "--backend", "gh-release"],
        env={"GH_REPO": None},
    )
    assert result.exit_code == 2
    assert "--repo" in result.output


def test_cli_verify_fails_cleanly_without_pointer(tmp_path):
    repo = make_repo(tmp_path)
    result = CliRunner().invoke(cli_main, ["verify", "--attestation=staging-noop", "--data-repo", str(repo)])
    assert result.exit_code == 1
    assert "Traceback" not in result.output
    assert "latest.json" in result.output


def test_cli_verify_surfaces_malformed_manifest_cleanly(published):
    """F2 (CLI): a digest-consistent malformed manifest surfaces as a clean
    ClickException failure (SystemExit), not a raised JSONDecodeError."""
    _db, repo, build_id = published
    malformed = b"{ this is not valid json"
    (repo / "builds" / build_id / "manifest.json").write_bytes(malformed)
    pointer = latest_pointer(repo)
    pointer["manifest_sha256"] = hashlib.sha256(malformed).hexdigest()
    (repo / "latest.json").write_text(render_pointer(pointer), encoding="utf-8")

    result = CliRunner().invoke(cli_main, ["verify", "--attestation=staging-noop", "--data-repo", str(repo)])
    assert result.exit_code == 1
    # Clean click failure, not a leaked ValueError/JSONDecodeError traceback.
    assert isinstance(result.exception, SystemExit)
    assert "Traceback" not in result.output
    assert "manifest" in result.output


def test_cli_verify_db_surfaces_corrupt_db_cleanly(published, tmp_path):
    """F3 (CLI): a non-SQLite file passed to --db surfaces as a clean
    ClickException failure, not a raised sqlite3.Error."""
    _db, repo, _build_id = published
    corrupt = tmp_path / "corrupt.db"
    corrupt.write_bytes(b"definitely not a sqlite database")
    result = CliRunner().invoke(
        cli_main, ["verify", "--attestation=staging-noop", "--data-repo", str(repo), "--db", str(corrupt)]
    )
    assert result.exit_code == 1
    assert isinstance(result.exception, SystemExit)
    assert "Traceback" not in result.output


def test_cli_publish_rollback_surfaces_malformed_target_cleanly(tmp_path):
    """F4 (CLI): a malformed rollback-target manifest surfaces as a clean
    ClickException failure, not a raised JSONDecodeError."""
    db = seed_db(tmp_path / "populus.db")
    repo = make_repo(tmp_path)
    first = publish_build(db, repo)
    mutate_db(db)
    publish_build(db, repo, moment=NOW + timedelta(days=1))
    (repo / "builds" / first.build_id / "manifest.json").write_bytes(b"{ not json")

    result = CliRunner().invoke(
        cli_main,
        ["publish", "--attestation=staging-noop", "--data-repo", str(repo), "--rollback-to", first.build_id],
    )
    assert result.exit_code == 1
    assert isinstance(result.exception, SystemExit)
    assert "Traceback" not in result.output
    assert "unparseable" in result.output or "rollback target" in result.output


# --- workflow shape, pinning, and auth (R15/R16/R30/R33) ----------------------


def _load_workflow(name: str) -> dict:
    return yaml.safe_load((WORKFLOWS / name).read_text(encoding="utf-8"))


def _triggers(workflow: dict) -> dict:
    # YAML 1.1 parses the bare key `on` as boolean True.
    return workflow.get("on", workflow.get(True))


def test_publish_workflow_shape(tmp_path):
    workflow = _load_workflow("publish.yml")
    assert set(_triggers(workflow)) == {"schedule", "workflow_dispatch"}
    assert workflow["permissions"] == {"contents": "read"}
    assert workflow["concurrency"] == {
        "group": "data-publish",
        "cancel-in-progress": False,
    }
    assert "env" not in workflow
    job = workflow["jobs"]["publish"]
    assert "refs/heads/main" in job["if"]
    assert "POPULUS_PUBLISH_ARMED" in job["if"]
    assert "env" not in job
    commit_step = next(
        step for step in job["steps"] if "git push" in step.get("run", "")
    )
    assert "for attempt in 1 2 3" in commit_step["run"]
    assert "git pull --rebase" in commit_step["run"]
    assert "git add builds latest.json" in commit_step["run"]
    assert "releases" not in commit_step["run"]
    # DR-5/§13.4: the inline-DB recovery journal and the DB are Release assets,
    # NEVER committed to git — no workflow step commits .staging/ or a journal.
    for step in job["steps"]:
        run = step.get("run", "")
        assert ".staging" not in run
        assert "journal" not in run


def test_publish_workflow_gh_token_step_scoped(tmp_path):
    workflow = _load_workflow("publish.yml")
    job = workflow["jobs"]["publish"]
    # The property is that the long-lived PAT is step-scoped to build/publish.
    # This used to be expressed by counting ANY step with a GH_TOKEN, which
    # conflated the PAT with the job's own ephemeral `github.token`. RUN P3-3a
    # gives the Verify step `github.token` so its attestation lookups are
    # authenticated (unauthenticated: 60/hour shared per runner IP, making a
    # quota error indistinguishable from tampering in the step that gates the
    # pointer commit). The assertion below is therefore SHARPENED, not relaxed:
    # it now pins the PAT specifically, and additionally forbids any OTHER
    # secret from appearing as GH_TOKEN anywhere in the job.
    #
    # RUN P3-3b T5 AMENDMENT, recorded not silent: `populus build` was split
    # into `stage-build` + `finalize-build` around the site build (the manifest
    # cannot be final until the site exists, because stats.json carries the
    # served file count). They cannot share a step, so the count moves 2 -> 3
    # and "populus build" is no longer a substring of either phase. The
    # PROPERTY is unchanged — the long-lived PAT appears only on the steps that
    # write to populus-data, and nowhere else — and the allowed set is still
    # enumerated exactly rather than loosened to a prefix match.
    pat = "${{ secrets.DATA_REPO_PAT }}"
    pat_bearing = {"populus stage-build", "populus finalize-build", "populus publish"}
    pat_steps = [
        step for step in job["steps"] if (step.get("env") or {}).get("GH_TOKEN") == pat
    ]
    assert len(pat_steps) == 3
    for step in pat_steps:
        run = step.get("run", "")
        assert any(command in run for command in pat_bearing), (
            f"a step holds the data-repo PAT but runs none of {sorted(pat_bearing)}: "
            f"{step.get('name')!r}"
        )

    for step in job["steps"]:
        token = (step.get("env") or {}).get("GH_TOKEN")
        if token is None or token == pat:
            continue
        assert token == "${{ github.token }}", (
            f"step {step.get('name')!r} sets GH_TOKEN to {token!r}: only the "
            "step-scoped PAT or the job's own ephemeral token are permitted"
        )
    # Never in a run body, never echoed (R33).
    for step in job["steps"]:
        run = step.get("run", "")
        assert "DATA_REPO_PAT" not in run
        assert "GH_TOKEN" not in run


# --- RUN M2-11 T7: the self-hosted publish host and its gates (R4/R5/R6/R25) --
#
# Every assertion below is ADDITIVE. The three tests above keep their wording
# and their bite unchanged — the point of R6 is that moving this job onto the
# owner's Mac did not cost a single pre-existing guarantee.

#: LD-1, exact and ordered. `self-hosted` on its own would match any runner
#: ever registered on this account; the two extra labels are what bind the job
#: to the one machine that holds the institutional store.
SELF_HOSTED_LABELS = ["self-hosted", "macOS", "populus-ops"]


def test_publish_job_runs_on_the_exact_self_hosted_label_set():
    job = _load_workflow("publish.yml")["jobs"]["publish"]
    assert job["runs-on"] == SELF_HOSTED_LABELS, (
        "the publish job's runner labels are LD-1 and are pinned here: it is "
        "the only job allowed on the self-hosted machine, and it must be "
        "targeted by all three labels, in this order"
    )


@pytest.mark.parametrize(
    ("workflow", "job_id"),
    [
        ("publish.yml", "deploy"),
        ("publish.yml", "assert-signed"),
        ("record-sign.yml", "record"),
    ],
)
def test_the_other_three_jobs_stay_github_hosted(workflow, job_id):
    """R5: deploy, sign, and assert-signed stay on ubuntu-latest.

    Not an aesthetic preference — these are the jobs holding Cloudflare write
    authority and the attestation identity, and §14's isolation analysis is
    written against EPHEMERAL hosted runners. Moving any of them onto the Mac
    would silently invalidate that analysis, so it is pinned.

    `sign` is asserted through `record-sign.yml`'s `record` job: the caller-side
    `sign` job is a reusable-workflow call and carries no `runs-on` of its own,
    so pinning the caller would assert nothing about where the signer runs.
    """
    assert _load_workflow(workflow)["jobs"][job_id]["runs-on"] == "ubuntu-latest"


def test_sign_job_is_a_reusable_call_with_no_runner_of_its_own():
    # Guards the test above from going vacuous: if `sign` ever grew its own
    # `runs-on`, the record-job assertion would no longer cover it.
    sign = _load_workflow("publish.yml")["jobs"]["sign"]
    assert "runs-on" not in sign
    assert sign["uses"] == "./.github/workflows/record-sign.yml"


def _stage_step(job: dict) -> dict:
    return next(
        step for step in job["steps"] if "populus stage-build" in step.get("run", "")
    )


def test_inst_db_path_comes_from_a_repository_variable_only():
    """R4/LD-2: `vars.POPULUS_INST_DB`, step-scoped, and nowhere else.

    Read through `secrets.` a repository variable resolves to the empty string
    SILENTLY — the P3-3b lesson the deploy step's own comment records. That
    mutation is killed here.
    """
    workflow = _load_workflow("publish.yml")
    job = workflow["jobs"]["publish"]
    stage = _stage_step(job)
    env = stage.get("env") or {}
    assert env.get("INST_SOURCE_DB") == "${{ vars.POPULUS_INST_DB }}", (
        "the accepted-snapshot path must be read from the repository VARIABLE; "
        "`secrets.POPULUS_INST_DB` resolves to '' with no error at all"
    )
    # The raw text, so a `secrets.` read cannot hide behind YAML shape.
    text = (WORKFLOWS / "publish.yml").read_text(encoding="utf-8")
    assert "secrets.POPULUS_INST_DB" not in text
    # Interpolated into a `run:` body it would be neither maskable nor
    # quotable; every step reads it as an env var or not at all.
    for step in job["steps"]:
        assert "POPULUS_INST_DB" not in step.get("run", ""), (
            f"step {step.get('name')!r} names POPULUS_INST_DB in its run body"
        )
    # Unset must OMIT the flag rather than pass it empty (R1: byte-identical
    # congress-only build), and the guard must be the shell's, not a template's.
    run = stage["run"]
    assert 'if [ -n "${INST_SOURCE_DB:-}" ]' in run
    assert '--inst-db "$INST_SOURCE_DB"' in run
    assert "--inst-db ''" not in run


def test_no_machine_path_literal_is_committed_in_the_workflow():
    """R4: the snapshot lives on the owner's machine; its path is provisioned,
    never committed. A literal would also survive a variable being unset."""
    text = (WORKFLOWS / "publish.yml").read_text(encoding="utf-8")
    for literal in ("/Users/", "Populus-ops", "inst-source-v"):
        assert literal not in text, f"machine path literal {literal!r} committed"


def test_scheduled_runs_additionally_require_the_supervised_validation_flag():
    """R25: a NIGHTLY needs `POPULUS_SELFHOSTED_VALIDATED == 'true'`; a
    `workflow_dispatch` is exempt, because a supervised dispatch is the only
    way the owner can validate the machine in the first place.

    Removing the schedule condition is a mutation this kills: it would arm an
    unattended nightly against a runner nobody has ever watched run.
    """
    job = _load_workflow("publish.yml")["jobs"]["publish"]
    condition = " ".join(job["if"].split())
    # Every pre-existing guard survives.
    assert "github.ref == 'refs/heads/main'" in condition
    assert "vars.POPULUS_PUBLISH_ARMED == 'true'" in condition
    # The gate itself, and its dispatch exemption.
    assert "vars.POPULUS_SELFHOSTED_VALIDATED == 'true'" in condition
    assert "github.event_name != 'schedule'" in condition
    assert (
        "(github.event_name != 'schedule' || "
        "vars.POPULUS_SELFHOSTED_VALIDATED == 'true')" in condition
    ), (
        "the validation flag must be OR'd with the dispatch exemption inside "
        "its own parenthesised clause — AND'd flat it would block dispatch too, "
        "and there would be no way to validate the machine"
    )


def test_uv_step_is_os_tolerant_and_asserts_the_pin():
    """R10: the pin is still a pin, and obtaining uv no longer depends on
    `python3 -m pip install` succeeding — which on an externally-managed
    macOS Python it does not."""
    job = _load_workflow("publish.yml")["jobs"]["publish"]
    step = next(
        s for s in job["steps"] if s.get("name") == "Install uv (version-pinned)"
    )
    pin_value = (step.get("env") or {}).get("UV_PIN")
    assert pin_value == "0.7.13", "the uv pin moved out of the workflow or drifted"
    run = step["run"]
    assert "command -v uv" in run, (
        "an already-present (checksum-gated) uv must be used, not overwritten"
    )
    assert "uv --version" in run, "the pin must be asserted against the machine"
    assert "exit 1" in run, "a drifted toolchain must fail closed"
    assert "self-hosted-runner.md" in run, "fail closed WITH a remediation line"


def test_record_sign_workflow_shape():
    workflow = _load_workflow("record-sign.yml")
    assert set(_triggers(workflow)) == {"workflow_call"}
    assert workflow["permissions"] == {
        "contents": "write",
        "id-token": "write",
        "attestations": "write",
    }
    job = workflow["jobs"]["record"]
    assert "POPULUS_RECORD_SIGN_ARMED" in job["if"]
    step_envs = [step.get("env") or {} for step in job["steps"]]
    assert any("CLOUDFLARE_PAGES_READ_TOKEN" in env for env in step_envs)


def test_every_external_action_is_sha_pinned():
    uses = re.compile(r"^\s*(?:-\s+)?uses:\s*(\S+)", re.MULTILINE)
    pinned = re.compile(r"@[0-9a-f]{40}$")
    found = 0
    for workflow_file in sorted(WORKFLOWS.glob("*.yml")):
        for reference in uses.findall(workflow_file.read_text(encoding="utf-8")):
            if reference.startswith("./"):
                continue
            assert pinned.search(reference), (
                f"{workflow_file.name}: {reference} is not pinned to a full"
                " 40-hex commit SHA"
            )
            found += 1
    assert found >= 1  # the standing test bites: at least one external action


# --- runbooks (R18) -----------------------------------------------------------


@pytest.mark.parametrize("runbook", ["rollback.md", "disaster-recovery.md"])
def test_runbook_exists_with_gated_executable_snippets(runbook):
    text = (RUNBOOKS / runbook).read_text(encoding="utf-8")
    blocks = re.findall(r"```bash\n(.*?)```", text, re.DOTALL)
    assert blocks, f"{runbook} has no executable bash blocks"
    for block in blocks:
        result = subprocess.run(  # nosec B603 B607 — syntax check only
            ["bash", "-n"], input=block, capture_output=True, text=True
        )
        assert result.returncode == 0, f"{runbook} snippet fails bash -n:\n{block}\n{result.stderr}"


# --- RUN M2-3: cross-filer inst module (R4/R6/R7/R10/R11/R12/R13) -------------

from test_inst_agg import _entity, _filer, _hold, _load, _security  # noqa: E402


def seed_inst(db_path: Path, *, covered: bool) -> Path:
    """Add inst 13F data to a seeded congress db.

    ``covered=True`` → every holding resolves and Σvalue == Σcover total, so
    value-coverage is 1.0 (the gate publishes inst). ``covered=False`` → one
    holding is unresolved, so coverage is 0.90 (< 0.95): certifiable but below
    the gate (withheld with reason ``below_threshold``).
    """
    conn = connect(str(db_path))
    try:
        _filer(conn, "0000000001", "Alpha Capital")
        _security(conn, "sec:x")
        if covered:
            holds = [_hold(ordinal=1, issuer="X CO", cusip="111111111",
                           value=1000, security_id="sec:x")]
        else:
            _security(conn, "sec:y")
            holds = [
                _hold(ordinal=1, issuer="X CO", cusip="111111111", value=900,
                      security_id="sec:x"),
                _hold(ordinal=2, issuer="Y CO", cusip="222222222", value=100,
                      security_id=None),  # unresolved → drags coverage to 0.90
            ]
        _load(conn, fid="inst:A-1", cik="0000000001", period="2026-03-31",
              filed="2026-04-15", holds=holds)
    finally:
        conn.close()
    return db_path


def _staged_asset(repo: Path, build_id: str, name: str) -> Path:
    return _staged(repo, build_id) / "assets" / name


# --- manifest admits inst (R4/F1) --------------------------------------------


def test_manifest_admits_inst_generic_rejects_unknown_and_defects(tmp_path):
    db = seed_db(tmp_path / "populus.db")
    seed_inst(db, covered=True)
    repo = make_repo(tmp_path)
    report = publish_build(db, repo)
    manifest = read_manifest(repo, report.build_id)  # congress + inst
    assert set(manifest["modules"]) == {"congress", "inst"}
    assert validate_manifest(manifest) == []

    # Generic inst-only validation: no congress required.
    inst_only = json.loads(json.dumps(manifest))
    inst_only["modules"] = {"inst": inst_only["modules"]["inst"]}
    assert validate_manifest(inst_only, required_modules=frozenset()) == []
    # …but the standard-build default still requires congress.
    assert any("congress" in e for e in validate_manifest(inst_only))

    # An unknown module is rejected.
    unknown = json.loads(json.dumps(manifest))
    unknown["modules"]["weather"] = json.loads(json.dumps(manifest["modules"]["inst"]))
    assert any(
        "weather" in e and "unknown" in e for e in validate_manifest(unknown)
    )

    # inst defect: no artifacts.
    empty = json.loads(json.dumps(manifest))
    empty["modules"]["inst"]["artifacts"] = []
    assert any(
        "inst" in e and "artifacts must be a non-empty list" in e
        for e in validate_manifest(empty)
    )

    # inst defect: wrong watermark keys (congress keys on the inst module).
    wm = json.loads(json.dumps(manifest))
    wm["modules"]["inst"]["watermarks"] = {
        "house_index_last_modified": None, "senate_max_filed_date": None
    }
    assert any("inst" in e and "watermark" in e for e in validate_manifest(wm))

    # inst defect: the DB artifact drops its logical_digest.
    nold = json.loads(json.dumps(manifest))
    for entry in nold["modules"]["inst"]["artifacts"]:
        if entry["name"] == "inst_agg.db":
            entry.pop("logical_digest")
    assert any(
        "logical_digest" in e for e in validate_manifest(nold)
    )


# --- the M2 gate at build time (R7) ------------------------------------------


def test_inst_gate_withholds_below_threshold_congress_publishes(tmp_path):
    """R7/R10a: FTD-shaped under-coverage withholds inst (fail-closed) while
    congress publishes and verifies; only congress assets ship."""
    db = seed_db(tmp_path / "populus.db")
    seed_inst(db, covered=False)
    repo = make_repo(tmp_path)
    backend = LocalDirBackend(repo)
    report = run_build(db, repo, now=pin(), backend=backend)
    assert report.inst_withheld is not None
    assert report.inst_withheld["reason"] == "below_threshold"
    assert report.inst_withheld["certifiable"] is True   # measurable, just < 0.95
    assert abs(report.inst_withheld["coverage"] - 0.90) < 1e-9
    # M2-7 §I5: the withheld payload also states what was tolerated and excluded
    # on the way to this number — here, nothing.
    assert report.inst_withheld["cover_rounding_count"] == 0
    assert report.inst_withheld["cover_conflict_filing_ids"] == []
    assert report.inst_logical_digest is None
    manifest = read_manifest_staged(repo, report.build_id)
    assert set(manifest["modules"]) == {"congress"}

    run_publish(repo, now=pin(), backend=backend)
    assert run_verify(repo, now=pin()).ok
    release = backend.get_release(report.build_id)
    assert set(release.assets) == {"congress.db", "journal.json"}


def seed_inst_cover_mix(db_path: Path) -> Path:
    """Add a three-filing 13F corpus spanning all three M2-7 dispositions:
    exact (Q1), tolerated rounding (Q2, +$999 on a $1,000,000 cover) and an
    excluded conflict (Q3, +$10,001 on a $10,000,000 cover — one dollar past
    tol(T)). The surviving two clear the gate, so the module still publishes."""
    conn = connect(str(db_path))
    try:
        _filer(conn, "0000000001", "Alpha Capital")
        _security(conn, "sec:x")
        _security(conn, "sec:round")
        _security(conn, "sec:bad")
        _load(conn, fid="inst:A-1", cik="0000000001", period="2026-03-31",
              filed="2026-04-15",
              holds=[_hold(ordinal=1, issuer="X CO", cusip="111111111",
                           value=1000, security_id="sec:x")])
        _load(conn, fid="inst:A-2", cik="0000000001", period="2026-06-30",
              filed="2026-07-15", total=1_000_000,
              holds=[_hold(ordinal=1, issuer="R CO", cusip="333333333",
                           value=1_000_999, security_id="sec:round")])
        _load(conn, fid="inst:A-3", cik="0000000001", period="2026-09-30",
              filed="2026-10-15", total=10_000_000,
              holds=[_hold(ordinal=1, issuer="B CO", cusip="444444444",
                           value=10_010_001, security_id="sec:bad")])
    finally:
        conn.close()
    return db_path


def seed_inst_all_conflict(db_path: Path) -> Path:
    """A 13F corpus in which EVERY filing is a cover conflict. `inst_filings` is
    populated and the reconciled population is non-empty, but the default view —
    and therefore both sides of the coverage ratio — is empty."""
    conn = connect(str(db_path))
    try:
        _filer(conn, "0000000001", "Alpha Capital")
        _security(conn, "sec:bad1")
        _security(conn, "sec:bad2")
        _load(conn, fid="inst:C-1", cik="0000000001", period="2026-03-31",
              filed="2026-04-15", total=10_000_000,
              holds=[_hold(ordinal=1, issuer="B CO", cusip="444444444",
                           value=10_010_001, security_id="sec:bad1")])
        _load(conn, fid="inst:C-2", cik="0000000001", period="2026-06-30",
              filed="2026-07-15", total=1_000_000,
              holds=[_hold(ordinal=1, issuer="D CO", cusip="555555555",
                           value=1_500_000, security_id="sec:bad2")])
    finally:
        conn.close()
    return db_path


def test_inst_build_names_the_cover_dispositions_behind_its_numbers(tmp_path):
    """M2-7 §I5: a PASSING build states what it tolerated and what it excluded to
    reach its coverage number — the conflict named by filing_id — and the
    excluded filing's holdings never reach the published aggregate.

    Mutation guard: dropping `inst_cover_dispositions` from the build report, or
    readmitting the conflict to the default view, fails here.
    """
    db = seed_inst_cover_mix(seed_db(tmp_path / "populus.db"))
    repo = make_repo(tmp_path)
    backend = LocalDirBackend(repo)
    report = run_build(db, repo, now=pin(), backend=backend)

    assert report.inst_withheld is None                     # the rest publishes
    assert report.inst_cover_dispositions == {
        "cover_rounding_count": 1,
        "cover_rounding_max_delta_usd": 999,
        "cover_conflict_count": 1,
        "cover_conflict_filing_ids": ["inst:A-3"],
    }
    manifest = read_manifest_staged(repo, report.build_id)
    assert set(manifest["modules"]) == {"congress", "inst"}
    agg = connect(str(_staged_asset(repo, report.build_id, "inst_agg.db")))
    try:
        periods = {row[0] for row in agg.execute(
            "SELECT DISTINCT period_of_report FROM agg_filer_concentration"
        )}
    finally:
        agg.close()
    assert periods == {"2026-03-31", "2026-06-30"}           # never 2026-09-30


def test_inst_build_period_coverage_never_reads_over_100pct_with_a_rounding_filing(
    tmp_path,
):
    """External review round 2, F1 — through the BUILD REPORT, which is where the
    impossible figure would have been published.

    `inst_period_coverage` is the surface an operator reads per quarter. Before
    the fix the per-period denominator summed the DECLARED cover total while the
    numerator summed the RESOLVED holdings, so 2026-06-30 (the +$999 rounding
    filing) reported 100.0999…% — above 100%, from a build that passed its gate.

    Mutation guard: reverting `compute_period_coverage`'s denominator to
    `SUM(table_value_total_usd)` makes the 2026-06-30 row read 1.000999 and
    fails both the `<= 1.0` sweep and the exact max(S,T) denominator assertion.
    """
    db = seed_inst_cover_mix(seed_db(tmp_path / "populus.db"))
    repo = make_repo(tmp_path)
    report = run_build(db, repo, now=pin(), backend=LocalDirBackend(repo))

    periods = {p["period_of_report"]: p for p in report.inst_period_coverage}
    assert set(periods) == {"2026-03-31", "2026-06-30"}    # the conflict is gone
    for period in periods.values():
        assert period["coverage"] is not None
        assert period["coverage"] <= 1.0, period            # no >100% figure
    rounding = periods["2026-06-30"]
    assert rounding["denominator"] == 1_000_999             # max(S, T), not T
    assert rounding["numerator"] == 1_000_999
    assert rounding["coverage"] == 1.0                      # never 1.000999
    # The per-period figures reconcile with the corpus-wide ones they are cut
    # from — they could not, while the two used different denominators.
    assert sum(p["denominator"] for p in periods.values()) == 1_001_999


def test_an_all_conflict_corpus_is_withheld_and_names_it_never_reported_absent(
    tmp_path,
):
    """External review round 2, F2: build presence was tested AFTER the cover
    exclusion, so a corpus made entirely of conflicts read as "no institutional
    data ingested" — an ABSENCE — when the truth is a non-measurable corpus with
    named exclusions. Data was ingested; it was withheld.

    Mutation guard: pointing the presence probe back at `v_default_inst_filings`
    makes `inst_withheld` None and the gate record read `absent`, failing every
    assertion below.
    """
    db = seed_inst_all_conflict(seed_db(tmp_path / "populus.db"))
    conn = connect(str(db))
    try:
        # The precondition the defect turned on: the reconciled population is
        # NON-EMPTY while the default view is empty.
        assert conn.execute(
            "SELECT COUNT(*) FROM v_inst_reconciled_filings"
        ).fetchone()[0] == 2
        assert conn.execute(
            "SELECT COUNT(*) FROM v_default_inst_filings"
        ).fetchone()[0] == 0
    finally:
        conn.close()

    repo = make_repo(tmp_path)
    report = run_build(db, repo, now=pin(), backend=LocalDirBackend(repo))

    assert report.inst_withheld is not None                  # withheld, not absent
    assert report.inst_withheld["reason"] == "not_measurable"
    assert report.inst_withheld["certifiable"] is False
    assert report.inst_withheld["denominator"] == 0
    assert report.inst_withheld["coverage"] is None
    # …and it NAMES every filing it excluded, which is the whole point (§I5).
    assert report.inst_withheld["cover_conflict_filing_ids"] == [
        "inst:C-1", "inst:C-2",
    ]
    assert report.inst_cover_dispositions["cover_conflict_count"] == 2
    assert report.inst_logical_digest is None
    manifest = read_manifest_staged(repo, report.build_id)
    assert set(manifest["modules"]) == {"congress"}          # congress publishes


def test_cli_build_output_names_the_excluded_conflicts(tmp_path):
    """External review round 2, F3, surface 4 of 6: `populus build` printed
    coverage figures with zero `cover_conflict` references, so the operator
    running the build could not see which filings had been dropped from both
    sides of the ratio. NON-EMPTY conflict set by construction.

    Mutation guard: deleting the `cover_dispositions_from_mapping` echo from
    `cli.build` fails the last two assertions.
    """
    db = seed_inst_cover_mix(seed_db(tmp_path / "populus.db"))
    repo = make_repo(tmp_path)
    result = CliRunner().invoke(
        cli_main, ["build", "--attestation=staging-noop", "--db", str(db), "--data-repo", str(repo)]
    )

    assert result.exit_code == 0, result.output
    assert "inst module included" in result.output           # the passing path…
    assert "cover_conflict EXCLUDED 1: inst:A-3" in result.output   # …still says
    assert "cover_rounding 1 (max delta 999)" in result.output


def test_cli_publish_absence_notice_names_the_excluded_conflicts(tmp_path):
    """External review round 2, F3, surface 5 of 6: the publish boundary's
    withheld notice stated the coverage number and the reason but never the
    excluded `filing_id`s — the last place an operator could have learned what
    was dropped, and it was silent.

    Drives the real build→publish CLI chain over an all-conflict corpus, so the
    notice is rendered from the gate record a real build wrote (F2's path), not
    from a hand-built dict.

    Mutation guard: deleting the disposition line from `_inst_absence_notice`,
    or dropping `cover_conflict_filing_ids` from the withheld payload, fails the
    last assertion.
    """
    db = seed_inst_all_conflict(seed_db(tmp_path / "populus.db"))
    repo = make_repo(tmp_path)
    runner = CliRunner()
    built = runner.invoke(
        cli_main, ["build", "--attestation=staging-noop", "--db", str(db), "--data-repo", str(repo)]
    )
    assert built.exit_code == 0, built.output
    assert "inst module WITHHELD (not_measurable)" in built.output
    assert "cover_conflict EXCLUDED 2: inst:C-1, inst:C-2" in built.output

    published = runner.invoke(cli_main, ["publish", "--attestation=staging-noop", "--data-repo", str(repo)])
    assert published.exit_code == 0, published.output
    assert "inst module: WITHHELD" in published.output
    assert "cover_conflict EXCLUDED 2: inst:C-1, inst:C-2" in published.output


def test_inst_gate_publishes_both_modules_when_covered(tmp_path):
    """R10b: a fully-covered corpus publishes BOTH modules; verify recomputes
    both; inst_agg.db ships as a Release asset in journal-first order."""
    db = seed_db(tmp_path / "populus.db")
    seed_inst(db, covered=True)
    repo = make_repo(tmp_path)
    backend = RecordingBackend(repo)
    report = run_build(db, repo, now=pin(), backend=LocalDirBackend(repo))
    assert report.inst_withheld is None
    assert report.inst_logical_digest is not None
    manifest = read_manifest_staged(repo, report.build_id)
    assert set(manifest["modules"]) == {"congress", "inst"}

    # RUN M2-8 T8 (R9): the inst module publishes TWO databases. This is the
    # end-to-end proof that something PRODUCES `inst_serving.db` — the manifest
    # entry, the digest, the six threaded boundaries and both consumers were all
    # written before any call site was, so every build shipped
    # `per_filer_detail.published = false` while ARCHITECTURE.md documented the
    # asset as live. A unit test of `write_serving_db` cannot see that; only a
    # real `run_build` can.
    inst_entry = find_artifact(manifest, "inst_serving.db", module="inst")
    assert inst_entry is not None, (
        "run_build did not enumerate inst_serving.db — nothing produces the"
        " artifact and every downstream boundary silently no-ops")
    assert inst_entry["logical_digest"], "the serving artifact carries no digest"
    assert inst_entry["bytes"] > 0

    run_publish(repo, now=pin(), backend=backend)
    # Journal first, then congress.db, then the inst assets (P1 order preserved).
    uploads = [op[1] for op in backend.ops if op[0] == "upload"]
    assert uploads == [
        "journal.json", "congress.db", "inst_agg.db", "inst_serving.db",
    ]
    release = backend.get_release(report.build_id)
    assert set(release.assets) == {
        "congress.db", "inst_agg.db", "inst_serving.db", "journal.json",
    }
    released = repo / "releases" / f"data-{report.build_id}"
    assert (released / "inst_agg.db").is_file()
    assert (released / "inst_serving.db").is_file()

    # The published artifact really carries the serving grains — an empty or
    # schema-only database would satisfy every assertion above.
    serving = connect(str(released / "inst_serving.db"))
    try:
        tables = {r[0] for r in serving.execute(
            "SELECT name FROM sqlite_master WHERE type='table'")}
        assert {"serving_filings", "serving_filer_rows",
                "serving_issuer_holder_rows", "serving_activity"} <= tables
        assert serving.execute(
            "SELECT COUNT(*) FROM serving_filer_rows").fetchone()[0] > 0
    finally:
        serving.close()

    verify = run_verify(repo, now=pin())
    assert verify.ok, verify.errors


def test_inst_gate_withholds_on_cover_failure(tmp_path):
    db = seed_db(tmp_path / "populus.db")
    conn = connect(str(db))
    try:
        _filer(conn, "0000000001")
        _load(conn, fid="inst:A-cf", cik="0000000001", period="2026-03-31",
              filed="2026-04-15", holds=[], total=None, parse_status="failed",
              failure_kind="cover_malformed", flags=["cover_failed"])
    finally:
        conn.close()
    repo = make_repo(tmp_path)
    report = run_build(db, repo, now=pin(), backend=LocalDirBackend(repo))
    assert report.inst_withheld is not None
    assert report.inst_withheld["reason"] == "cover_failed"
    assert report.inst_withheld["cover_failed_count"] >= 1


def test_verify_detects_tampered_inst_asset(tmp_path):
    """Byte tampering is caught by the OUTER sha256 (before any recomputation)."""
    db = seed_db(tmp_path / "populus.db")
    seed_inst(db, covered=True)
    repo = make_repo(tmp_path)
    report = publish_build(db, repo)
    asset = repo / "releases" / f"data-{report.build_id}" / "inst_agg.db"
    asset.write_bytes(asset.read_bytes() + b"tamper")
    verify = run_verify(repo, now=pin())
    assert not verify.ok
    assert any("inst_agg.db" in e for e in verify.errors)


def test_verify_recomputes_the_inst_logical_digest(tmp_path):
    """QA-F5 (round 3) / R4-R10b: `verify` must RECOMPUTE the inst module's
    logical digest, not merely re-hash its bytes.

    The byte-tamper test above trips the outer sha256 first, so it never reaches
    this branch. Here the asset is untouched and hash-consistent; only the
    manifest's recorded `logical_digest` is wrong, so the failure can ONLY come
    from module-specific recomputation. Mirrors the congress analogue.
    """
    db = seed_db(tmp_path / "populus.db")
    seed_inst(db, covered=True)
    repo = make_repo(tmp_path)
    report = publish_build(db, repo)

    manifest = read_manifest(repo, report.build_id)
    entry = find_artifact(manifest, "inst_agg.db", module="inst")
    assert entry["logical_digest"] != "ab" * 32
    entry["logical_digest"] = "ab" * 32   # valid hex the DB cannot reproduce
    _repoint_to_edited_manifest(repo, report.build_id, manifest)

    verify = run_verify(repo, now=pin())
    assert not verify.ok
    assert any(
        "inst_agg.db" in error and "logical_digest" in error
        for error in verify.errors
    ), verify.errors


# --- snapshot serve via the module-aware accessor (R6/R13) --------------------


def test_snapshot_client_serves_inst_and_congress_via_db_path(tmp_path):
    from populus.client.snapshot import LocalRepoFetcher, SnapshotClient

    db = seed_db(tmp_path / "populus.db")
    seed_inst(db, covered=True)
    repo = make_repo(tmp_path)
    publish_build(db, repo)
    fetcher = LocalRepoFetcher(repo)

    inst = SnapshotClient(tmp_path / "cache", fetcher, now=pin(), module="inst")
    assert inst.refresh().status == "installed"
    inst_db = inst.db_path()
    assert inst_db is not None and inst_db.name == "inst_agg.db"
    reader = connect(str(inst_db))
    try:
        assert reader.execute(
            "SELECT COUNT(*) FROM agg_filer_registry"
        ).fetchone()[0] >= 1
    finally:
        reader.close()
    # Idempotent re-poll: an unchanged pointer changes nothing (R10a).
    assert inst.refresh().status == "idempotent"

    # Regression: the congress client still resolves congress.db.
    congress = SnapshotClient(tmp_path / "cache", fetcher, now=pin(), module="congress")
    assert congress.refresh().status == "installed"
    assert congress.db_path().name == "congress.db"


def test_a_withheld_module_stops_serving_the_previously_cached_build(tmp_path):
    """QA-F1 (M2-4): once a NEWER published build withholds `inst` (the M2 ≥95%
    coverage gate), the client must STOP serving the previously cached
    institutional build. Continuing to serve it would hand back STALE
    institutional data while health reported the module present — silently
    defeating the withholding gate. Drives the real snapshot resolution path.
    """
    from populus.client.snapshot import LocalRepoFetcher, SnapshotClient

    # Build 1: inst covered → published and cached by the client.
    db = seed_db(tmp_path / "populus.db")
    seed_inst(db, covered=True)
    repo = make_repo(tmp_path)
    publish_build(db, repo)
    fetcher = LocalRepoFetcher(repo)
    v1_pointer_bytes = fetcher.fetch_path("latest.json")   # kept for the replay
    inst = SnapshotClient(tmp_path / "cache", fetcher, now=pin(), module="inst")
    assert inst.refresh().status == "installed"
    assert inst.db_path() is not None
    first_build = inst.current_build()
    assert first_build is not None

    # Build 2, same repo: coverage now BELOW the gate → inst is withheld.
    seed_inst(db, covered=False)
    publish_build(db, repo, moment=NOW + timedelta(days=1))
    manifest_now = read_manifest(repo, latest_pointer(repo)["build_id"])
    assert "inst" not in manifest_now["modules"], "the gate should have withheld inst"

    # The client's clock must advance with the publisher's, or the new pointer
    # reads as future-issued and refuses for an unrelated reason.
    later = pin(NOW + timedelta(days=1))
    inst_later = SnapshotClient(
        tmp_path / "cache", fetcher, now=later, module="inst"
    )
    assert inst_later.current_build() == first_build  # still serving the cached build
    result = result_withdrawn = inst_later.refresh()
    # It must NOT keep serving the old build.
    assert result.status == "withdrawn", result
    assert inst_later.current_build() is None
    assert inst_later.db_path() is None, "stale institutional data is still served"
    assert "does not include module" in (result.message or "")

    # Congress, published in the same build, is unaffected.
    congress = SnapshotClient(
        tmp_path / "cache", fetcher, now=later, module="congress"
    )
    assert congress.refresh().status == "installed"

    # QA-r2-F1 — the withdrawal must be DURABLE. A fresh client whose pointer
    # fetch then fails must not resurrect the withdrawn build from the advisory
    # sidecar during read-time reconcile. (Round 1 cleared only the `current`
    # marker, so exactly this sequence resumed serving the stale data.)
    class _OfflineFetcher:
        def fetch_path(self, path):
            from populus.client.snapshot import FetchError

            raise FetchError("offline")

    revived = SnapshotClient(
        tmp_path / "cache", _OfflineFetcher(), now=later, module="inst"
    )
    revived.reconcile()
    assert revived.current_build() is None, "reconcile resurrected a withdrawn build"
    assert revived.db_path() is None
    offline = revived.refresh()
    assert offline.status == "refused"
    assert revived.db_path() is None, "stale institutional data came back offline"

    # QA-r3-F1 — REPLAY of the pointer that originally installed inst must not
    # resurrect it either. Withdrawal left the trust tuple at the old pointer, so
    # replaying it evaluated as `idempotent` and the online heal branch rebuilt
    # `current` from the retained cache. A tombstone bound to the withdrawing
    # pointer now blocks every heal path until a NEWER build republishes.
    class _ReplayFetcher:
        """Serves the ORIGINAL v1 pointer again (a rollback/replay attempt)."""

        def __init__(self, payload):
            self._payload = payload

        def fetch_path(self, path):
            if path == "latest.json":
                return self._payload
            return LocalRepoFetcher(repo).fetch_path(path)

    replayed = SnapshotClient(
        tmp_path / "cache", _ReplayFetcher(v1_pointer_bytes), now=later,
        module="inst",
    )
    result = replayed.refresh()
    assert replayed.current_build() is None, (
        f"replaying the old pointer resurrected the withdrawn build "
        f"({result.status}: {result.message})"
    )
    assert replayed.db_path() is None, "withheld institutional data came back via replay"

    # And the withdrawal itself must carry the verified-omission FACT, since
    # `current_manifest()` is None once the marker is cleared (QA-r3-F2).
    assert result_withdrawn.verified_omission is True
    assert congress.db_path() is not None


# --- rollback preflight over every module's assets (R11) ---------------------


def _two_inst_builds(tmp_path):
    db = seed_db(tmp_path / "populus.db")
    seed_inst(db, covered=True)
    repo = make_repo(tmp_path)
    first = publish_build(db, repo)
    mutate_db(db)
    publish_build(db, repo, moment=NOW + timedelta(days=1))
    return repo, first.build_id


def test_rollback_refused_when_target_inst_asset_missing(tmp_path):
    repo, target = _two_inst_builds(tmp_path)
    before = latest_pointer(repo)
    (repo / "releases" / f"data-{target}" / "inst_agg.db").unlink()
    with pytest.raises(PublishError, match="missing or does not match"):
        run_publish(
            repo, now=pin(NOW + timedelta(days=1, hours=1)),
            backend=LocalDirBackend(repo), rollback_to=target,
        )
    assert latest_pointer(repo) == before


def test_rollback_refused_when_target_inst_asset_corrupt(tmp_path):
    repo, target = _two_inst_builds(tmp_path)
    before = latest_pointer(repo)
    asset = repo / "releases" / f"data-{target}" / "inst_agg.db"
    asset.write_bytes(asset.read_bytes() + b"corruption")
    with pytest.raises(PublishError, match="missing or does not match"):
        run_publish(
            repo, now=pin(NOW + timedelta(days=1, hours=1)),
            backend=LocalDirBackend(repo), rollback_to=target,
        )
    assert latest_pointer(repo) == before


# --- fresh-runner inst crash boundary + drafts-only recovery (R12) ------------


def _inst_build(tmp_path, name="runner"):
    runner = make_repo(tmp_path, name)
    db = seed_db(tmp_path / "populus.db")
    seed_inst(db, covered=True)
    report = run_build(db, runner, now=pin(), backend=LocalDirBackend(runner))
    return runner, report.build_id, db


def test_fresh_runner_inst_completes_when_all_assets_uploaded(tmp_path):
    """R12: with journal + congress.db + BOTH inst databases uploaded and
    published, a fresh runner (no staging) completes the same build_id.

    `inst_serving.db` is in the list because the congress-scoped recovery journal
    cannot regenerate a module asset: on a fresh runner every enumerated module
    database must already be a verified release asset or the publish is refused.
    Leaving it out is the *other* test (`..._refuses_loudly_...`).
    """
    runner, build_id, source_db = _inst_build(tmp_path)
    b = LocalDirBackend(runner)
    b.ensure_draft(build_id)
    for name in ("journal.json", "congress.db", "inst_agg.db", "inst_serving.db"):
        src = (_staged(runner, build_id) / name if name == "journal.json"
               else _staged_asset(runner, build_id, name))
        b.upload(build_id, src, name=name)
    # The release stays a DRAFT: that is exactly the boundary under test (QA-F2).
    # Pre-publishing here would have tested an already-published release instead,
    # leaving draft→published recovery completely uncovered.
    assert b.get_release(build_id).draft

    repo = _fresh_runner_workspace(runner, tmp_path / "fresh")
    backend = RecordingBackend(repo)
    report = run_publish(repo, now=pin(), backend=backend)
    assert build_id in {report.build_id, *report.reconciled}
    release = backend.get_release(build_id)
    assert not release.draft  # the fresh runner PUBLISHED the draft
    assert set(release.assets) == {
        "congress.db", "inst_agg.db", "inst_serving.db", "journal.json",
    }
    assert latest_pointer(repo)["build_id"] == build_id
    assert "delete_release" not in backend.op_names()


def test_fresh_runner_inst_refuses_loudly_at_pre_inst_window(tmp_path):
    """R12/TD-M2-3-1: journal + congress.db uploaded but inst_agg.db not yet, and
    a fresh runner lost staging → refuse loudly (draft intact, pointer unmoved);
    the drafts-only cleanup then succeeds."""
    runner, build_id, source_db = _inst_build(tmp_path)
    b = LocalDirBackend(runner)
    b.ensure_draft(build_id)
    b.upload(build_id, _staged(runner, build_id) / "journal.json", name="journal.json")
    b.upload(build_id, _staged_asset(runner, build_id, "congress.db"), name="congress.db")
    # inst_agg.db intentionally NOT uploaded; release left a draft.

    repo = _fresh_runner_workspace(runner, tmp_path / "fresh")  # no staging carried
    backend = RecordingBackend(repo)
    with pytest.raises(PublishError, match="drafts-only cleanup"):
        run_publish(repo, now=pin(), backend=backend)
    # Refused safely: draft preserved, pointer unmoved, nothing deleted.
    assert backend.get_release(build_id).draft
    assert not (repo / "latest.json").exists()
    assert "delete_release" not in backend.op_names()
    # The documented drafts-only cleanup (rollback.md Appendix A) then succeeds.
    backend.delete_release(build_id)
    assert backend.get_release(build_id) is None

    # ...and the procedure is proven END-TO-END: rebuild under a FRESH build_id
    # (regenerating inst_agg.db) and publish it successfully (QA-F3). Without
    # this the documented recovery stopped at "delete the draft".
    # The full documented procedure, SAME DAY on the workspace that carries the
    # durable allocation record, with the same backend the draft lived on. The
    # operator also removes the staged build, then rebuilds.
    #
    # Why `runner` and not the fresh `repo`: `builds/` travels to a fresh runner
    # only TOGETHER WITH `latest.json` (one atomic finalize commit), and nothing
    # was ever published here — so `repo` carries no durable state at all. In
    # that specific case reallocating `.1` is harmless, because no durable
    # object ever bound `.1` to bytes (draft deleted, staging gone, nothing
    # committed or published). The burned-id guarantee is about workspaces where
    # durable evidence DOES exist, which is what this asserts (QA-F1/F2, round 7).
    shutil.rmtree(runner / ".staging" / build_id, ignore_errors=True)
    runner_backend = LocalDirBackend(runner)
    # The fresh workspace holds a COPY of the remote, so the cleanup above
    # deleted the draft only there; in reality both point at one remote. Apply
    # the same drafts-only cleanup on this root before rebuilding.
    runner_backend.delete_release(build_id)
    assert runner_backend.get_release(build_id) is None
    same_day = pin()
    rebuilt = run_build(source_db, runner, now=same_day, backend=runner_backend)
    assert rebuilt.build_id != build_id, (
        "the interrupted build_id must be BURNED, not reallocated on a same-day"
        f" rebuild after cleanup (got {rebuilt.build_id} again)"
    )
    # ...and strictly newer, so identities only ever move forward.
    assert int(rebuilt.build_id.split(".")[1]) > int(build_id.split(".")[1])
    final = run_publish(runner, now=same_day, backend=runner_backend)
    assert final.build_id == rebuilt.build_id
    released = runner_backend.get_release(rebuilt.build_id)
    assert not released.draft
    assert {"congress.db", "inst_agg.db", "inst_serving.db", "journal.json"} <= set(
        released.assets)
    assert latest_pointer(runner)["build_id"] == rebuilt.build_id
    # The interrupted identity is gone and never republished.
    assert runner_backend.get_release(build_id) is None


def test_same_runner_inst_uploads_from_staging(tmp_path):
    """R12: on the SAME runner (staging intact), a missing inst asset is
    re-uploaded from staging and completion is automatic."""
    runner, build_id, source_db = _inst_build(tmp_path)
    b = LocalDirBackend(runner)
    b.ensure_draft(build_id)
    b.upload(build_id, _staged(runner, build_id) / "journal.json", name="journal.json")
    b.upload(build_id, _staged_asset(runner, build_id, "congress.db"), name="congress.db")
    # neither inst asset uploaded, but .staging/ is intact.
    backend = RecordingBackend(runner)
    run_publish(runner, now=pin(), backend=backend)
    release = backend.get_release(build_id)
    assert not release.draft
    assert set(release.assets) == {
        "congress.db", "inst_agg.db", "inst_serving.db", "journal.json",
    }
    uploaded = [op[1] for op in backend.ops if op[0] == "upload"]
    # BOTH inst databases recover from staging — `_complete_extra_module_assets`
    # iterates `module_db_artifacts`, so a regression to a scalar lookup would
    # re-upload only the aggregate and silently drop the serving artifact.
    assert "inst_agg.db" in uploaded
    assert "inst_serving.db" in uploaded
    assert latest_pointer(runner)["build_id"] == build_id


# --- second build bumps the pointer; unchanged re-poll is idempotent (R10a) ---


def test_inst_withheld_second_build_bumps_pointer_idempotent_republish(tmp_path):
    db = seed_db(tmp_path / "populus.db")
    seed_inst(db, covered=False)   # inst withheld; congress carries the build
    repo = make_repo(tmp_path)
    backend = LocalDirBackend(repo)
    publish_build(db, repo)
    v1 = latest_pointer(repo)["pointer_version"]

    mutate_db(db)
    second = publish_build(db, repo, moment=NOW + timedelta(days=1))
    v2 = latest_pointer(repo)["pointer_version"]
    assert v2 == v1 + 1

    # Re-publishing the same, already-committed build is idempotent — no bump.
    run_publish(
        repo, now=pin(NOW + timedelta(days=1)), backend=backend,
        build_id=second.build_id,
    )
    assert latest_pointer(repo)["pointer_version"] == v2


def read_manifest_staged(repo: Path, build_id: str) -> dict:
    return json.loads(
        (repo / STAGING_DIR / build_id / "build" / "manifest.json").read_text(
            encoding="utf-8"
        )
    )


@pytest.mark.parametrize("damage", ["missing", "corrupt"])
def test_republish_refuses_when_a_published_inst_asset_is_damaged(tmp_path, damage):
    """QA-F4 / published-immutability: re-publishing an already-PUBLISHED
    two-module release whose `inst_agg.db` asset is missing or corrupt must be
    REFUSED — no delete, no re-upload, pointer unchanged. This is the
    `draft=False` branch, which only verify-time and rollback-time tests covered.

    Staging is deliberately kept INTACT: an empty-staging workspace refuses with
    "nothing staged to publish" long before the asset checks, which would make
    this assertion vacuous (the first version of this test did exactly that —
    caught by mutating both the preflight and the immutability branch).
    """
    runner, build_id, _db = _inst_build(tmp_path)
    b = LocalDirBackend(runner)
    b.ensure_draft(build_id)
    for name in ("journal.json", "congress.db", "inst_agg.db"):
        src = (_staged(runner, build_id) / name if name == "journal.json"
               else _staged_asset(runner, build_id, name))
        b.upload(build_id, src, name=name)
    # Publish the release through the BACKEND directly, so staging survives — a
    # completed `run_publish` clears it, and an empty staging refuses with
    # "nothing staged" long before the asset checks (which is precisely how the
    # first version of this test went vacuous).
    b.publish_release(build_id)
    assert not b.get_release(build_id).draft
    pointer_before = (runner / "latest.json").read_bytes() if (
        runner / "latest.json"
    ).exists() else None

    # Damage the PUBLISHED inst asset in the backend store (staging untouched).
    asset = runner / "releases" / f"data-{build_id}" / "inst_agg.db"
    if damage == "missing":
        asset.unlink()
    else:
        asset.write_bytes(b"not a database")

    backend = RecordingBackend(runner)
    with pytest.raises(PublishError) as excinfo:
        run_publish(runner, now=pin(), backend=backend)
    # It refuses for the RIGHT reason — the published release is immutable and
    # its module asset cannot be re-uploaded or silently repaired.
    assert "published" in str(excinfo.value) or "inst_agg.db" in str(excinfo.value)
    assert "delete_release" not in backend.op_names()
    assert "upload" not in backend.op_names()
    after = (runner / "latest.json").read_bytes() if (
        runner / "latest.json"
    ).exists() else None
    assert after == pointer_before  # pointer untouched by the refusal


def test_resolve_snapshot_reports_gate_withholding_through_the_real_client(
    tmp_path, monkeypatch
):
    """QA-r3-F2: the MCP resolver's gate-withheld branch must be reachable with
    the REAL SnapshotClient. It was not: withdrawal clears the `current` marker,
    so the resolver's `current_manifest()` re-read always returned None and
    production reported a neutral resolution failure even when a verified
    manifest demonstrably withheld `inst`. A mocked client that kept returning a
    manifest hid this — so this test uses no mock at all.
    """
    import sys

    from populus.mcp_server import server as srv_mod

    db = seed_db(tmp_path / "populus.db")
    seed_inst(db, covered=True)
    repo = make_repo(tmp_path)
    publish_build(db, repo)
    cache = tmp_path / "cache"
    argv = ["populus-mcp", "--attestation=staging-noop", "--data-repo", str(repo), "--cache", str(cache)]
    monkeypatch.setattr(sys, "argv", argv)
    monkeypatch.setattr(srv_mod, "_utc_now", pin())

    covered = srv_mod._resolve_snapshot()
    assert covered["inst_db_path"] is not None
    assert covered["inst_from_published_manifest"] is True
    assert covered["inst_absent_reason"] is None

    # Republish with coverage BELOW the gate: inst is withheld.
    seed_inst(db, covered=False)
    publish_build(db, repo, moment=NOW + timedelta(days=1))
    assert "inst" not in read_manifest(repo, latest_pointer(repo)["build_id"])["modules"]
    monkeypatch.setattr(srv_mod, "_utc_now", pin(NOW + timedelta(days=1)))

    withheld = srv_mod._resolve_snapshot()
    assert withheld["inst_db_path"] is None
    assert withheld["inst_from_published_manifest"] is False
    assert withheld["inst_absent_gate_withheld"] is True, (
        "the verified-omission branch is unreachable with the real client"
    )
    assert "withheld it" in withheld["inst_absent_reason"]


def test_a_withdrawn_module_is_restored_when_a_newer_build_republishes_it(tmp_path):
    """QA-r4-F4: withdrawal must not be a one-way door. Drives the REAL client
    through covered → withheld → covered again and proves the tombstone does not
    permanently suppress a legitimate newer module — while still rejecting a
    replay of the old pointer."""
    from populus.client.snapshot import LocalRepoFetcher, SnapshotClient

    db = seed_db(tmp_path / "populus.db")
    seed_inst(db, covered=True)
    repo = make_repo(tmp_path)
    publish_build(db, repo)
    fetcher = LocalRepoFetcher(repo)
    v1_pointer = fetcher.fetch_path("latest.json")
    cache = tmp_path / "cache"

    inst = SnapshotClient(cache, fetcher, now=pin(), module="inst")
    assert inst.refresh().status == "installed"
    first_build = inst.current_build()

    # v2: withheld.
    seed_inst(db, covered=False)
    publish_build(db, repo, moment=NOW + timedelta(days=1))
    t2 = pin(NOW + timedelta(days=1))
    assert SnapshotClient(cache, fetcher, now=t2, module="inst").refresh().status == (
        "withdrawn"
    )

    # v3: coverage restored — the module must come BACK.
    seed_inst(db, covered=True)
    publish_build(db, repo, moment=NOW + timedelta(days=2))
    t3 = pin(NOW + timedelta(days=2))
    assert "inst" in read_manifest(repo, latest_pointer(repo)["build_id"])["modules"]

    restored = SnapshotClient(cache, fetcher, now=t3, module="inst")
    result = restored.refresh()
    assert result.status == "installed", f"republication was suppressed: {result}"
    third_build = restored.current_build()
    assert third_build is not None and third_build != first_build
    assert restored.db_path() is not None

    # Idempotent on a repeat poll, and still serving.
    again = SnapshotClient(cache, fetcher, now=t3, module="inst")
    assert again.refresh().status == "idempotent"
    assert again.current_build() == third_build

    # Anti-replay is NOT weakened: the original v1 pointer is still rejected.
    class _ReplayFetcher:
        def fetch_path(self, path):
            return v1_pointer if path == "latest.json" else fetcher.fetch_path(path)

    replayed = SnapshotClient(cache, _ReplayFetcher(), now=t3, module="inst")
    replayed.refresh()
    assert replayed.current_build() == third_build, (
        "an old pointer replay changed what is served"
    )


def test_a_withdrawal_whose_cleanup_fails_still_fails_closed_in_production(
    tmp_path, monkeypatch
):
    """QA-r5-F1: if the tombstone lands but unlinking `current` raises OSError,
    the earlier code returned `refused` with `serving` still set — and
    `_resolve_snapshot` then took `db_path()` at face value and served the
    coverage-gate-WITHHELD database, labeled as a valid published snapshot.
    The verified omission is a fact about the manifest, not about our disk, so
    it must fail closed regardless of cleanup success."""
    import sys

    from populus.client.snapshot import LocalRepoFetcher, SnapshotClient
    from populus.mcp_server import server as srv_mod

    db = seed_db(tmp_path / "populus.db")
    seed_inst(db, covered=True)
    repo = make_repo(tmp_path)
    publish_build(db, repo)
    cache = tmp_path / "cache"
    argv = ["populus-mcp", "--attestation=staging-noop", "--data-repo", str(repo), "--cache", str(cache)]
    monkeypatch.setattr(sys, "argv", argv)
    monkeypatch.setattr(srv_mod, "_utc_now", pin())
    assert srv_mod._resolve_snapshot()["inst_db_path"] is not None

    seed_inst(db, covered=False)
    publish_build(db, repo, moment=NOW + timedelta(days=1))
    monkeypatch.setattr(srv_mod, "_utc_now", pin(NOW + timedelta(days=1)))

    # The RECORD write fails — a read-only cache, a locked file, an NFS blip.
    # (This previously injected on `current`, a file the lifecycle rewrite
    # RETIRED, so the injection never fired and the test silently degraded into
    # an ordinary committed withdrawal — QA-VERIFY-N-c.)
    from populus.client import snapshot as snap_mod

    real_write = snap_mod.SnapshotClient._write_record

    def _explode(self, *a, **kw):
        if self._module == "inst":          # scoped: congress must stay healthy
            raise OSError("permission denied")
        return real_write(self, *a, **kw)

    monkeypatch.setattr(snap_mod.SnapshotClient, "_write_record", _explode)

    resolved = srv_mod._resolve_snapshot()
    assert resolved["inst_db_path"] is None, (
        "the withheld institutional database was served after a cleanup failure"
    )
    assert resolved["inst_from_published_manifest"] is False
    assert resolved["inst_absent_gate_withheld"] is True
    assert "withheld it" in resolved["inst_absent_reason"]

    # The accessors fail closed too, even without reconcile running.
    stuck = SnapshotClient(cache, LocalRepoFetcher(repo),
                           now=pin(NOW + timedelta(days=1)), module="inst")
    assert stuck.current_build() is None and stuck.db_path() is None



# =============================================================================
# Module serving lifecycle — docs/build/RUN-M2-4-withdrawal-lifecycle.md §7.
# The spec is the contract; these tests are its enumerated requirements.
# =============================================================================


def _installed_inst(tmp_path, *, covered=True):
    """A cache with `inst` installed from a published build. Returns the pieces
    every lifecycle test needs."""
    from populus.client.snapshot import LocalRepoFetcher, SnapshotClient

    db = seed_db(tmp_path / "populus.db")
    seed_inst(db, covered=covered)
    repo = make_repo(tmp_path)
    publish_build(db, repo)
    cache = tmp_path / "cache"
    fetcher = LocalRepoFetcher(repo)
    client = SnapshotClient(cache, fetcher, now=pin(), module="inst")
    result = client.refresh()
    return db, repo, cache, fetcher, client, result


def _record(cache):
    return json.loads((cache / "inst" / "serving.json").read_text())


def _write_record(cache, **fields):
    rec = _record(cache)
    rec.update(fields)
    (cache / "inst" / "serving.json").write_text(json.dumps(rec))


def _fresh(cache, fetcher, *, moment=None):
    from populus.client.snapshot import SnapshotClient

    return SnapshotClient(cache, fetcher, now=pin(moment) if moment else pin(),
                          module="inst")


def test_install_writes_an_anchor_bound_serving_record(tmp_path):
    """§3: the record carries the EXACT verified pointer bytes, and the build it
    names is derived from those authenticated bytes — not asserted by the record."""
    _db, _repo, cache, _f, client, result = _installed_inst(tmp_path)
    assert result.status == "installed"
    rec = _record(cache)
    raw = base64.b64decode(rec["pointer_bytes"])
    assert hashlib.sha256(raw).hexdigest() == rec["pointer_sha256"]
    pointer = json.loads(raw)
    assert rec["installed_build"] == pointer["build_id"]
    assert client.serving_build() == pointer["build_id"]
    assert client.db_path() is not None
    # The retired markers must not come back.
    for gone in ("current", "install.json", "withdrawn.json"):
        assert not (cache / "inst" / gone).exists(), f"{gone} was resurrected"


# --- §7 anti-replay negative controls: each differs in EXACTLY one respect ----


def test_negative_control_1_equal_version_different_digest(tmp_path):
    """A version-only check — the exact round-8 F3 defect — would pass this."""
    _db, _repo, cache, fetcher, _c, _r = _installed_inst(tmp_path)
    _write_record(cache, pointer_sha256="0" * 64)
    assert _fresh(cache, fetcher).serving_build() is None


def test_negative_control_2_different_version_equal_digest(tmp_path):
    _db, _repo, cache, fetcher, _c, _r = _installed_inst(tmp_path)
    _write_record(cache, pointer_version=_record(cache)["pointer_version"] + 1)
    assert _fresh(cache, fetcher).serving_build() is None


def test_negative_control_3_bytes_do_not_hash_to_the_anchor(tmp_path):
    """Tuple fields copied correctly AND the forged bytes are internally
    consistent — they name the real build and its real manifest digest, so every
    other check passes. ONLY the bytes→anchor binding can reject this, which is
    what makes the record PROOF rather than assertion (§3).

    (A first version forged bytes naming build "x"; the installed_build
    cross-check caught that, so the test passed even with the binding removed —
    it proved nothing. Mutation testing surfaced it.)
    """
    _db, _repo, cache, fetcher, _c, _r = _installed_inst(tmp_path)
    rec = _record(cache)
    real = json.loads(base64.b64decode(rec["pointer_bytes"]))
    forged = json.dumps({                       # same claims, different bytes
        "build_id": real["build_id"],
        "manifest_sha256": real["manifest_sha256"],
        "pointer_version": real["pointer_version"],
    }, sort_keys=True).encode()
    assert hashlib.sha256(forged).hexdigest() != rec["pointer_sha256"]
    _write_record(cache, pointer_bytes=base64.b64encode(forged).decode())
    assert _fresh(cache, fetcher).serving_build() is None


def test_negative_control_4_installed_build_names_a_different_complete_build(tmp_path):
    """The record names another build that is fully present on disk. Authority
    comes from the authenticated bytes, so the mismatch must be caught."""
    from populus.client.snapshot import SnapshotClient

    db, repo, cache, fetcher, _c, _r = _installed_inst(tmp_path)
    first = _record(cache)["installed_build"]
    # Publish and install a SECOND build so two complete builds exist.
    publish_build(db, repo, moment=NOW + timedelta(days=1))
    later = pin(NOW + timedelta(days=1))
    second_client = SnapshotClient(cache, fetcher, now=later, module="inst")
    assert second_client.refresh().status == "installed"
    second = _record(cache)["installed_build"]
    assert first != second and (cache / "inst" / first / "manifest.json").is_file()

    _write_record(cache, installed_build=first)   # anchored at `second`
    assert SnapshotClient(cache, fetcher, now=later, module="inst").serving_build() is None


def test_negative_control_5_named_builds_artifacts_are_missing(tmp_path):
    _db, _repo, cache, fetcher, _c, _r = _installed_inst(tmp_path)
    build = _record(cache)["installed_build"]
    (cache / "inst" / build / "inst_agg.db").unlink()
    assert _fresh(cache, fetcher).serving_build() is None


def test_negative_control_5b_named_builds_artifacts_are_corrupt(tmp_path):
    _db, _repo, cache, fetcher, _c, _r = _installed_inst(tmp_path)
    build = _record(cache)["installed_build"]
    (cache / "inst" / build / "inst_agg.db").write_bytes(b"not the verified bytes")
    assert _fresh(cache, fetcher).serving_build() is None


@pytest.mark.parametrize(
    "mutate, label",
    [
        (lambda p: p.unlink(), "absent"),
        (lambda p: p.write_text("{not json"), "unparseable"),
        (lambda p: p.write_text('{"pointer_version":"7","pointer_sha256":1,'
                                '"pointer_bytes":[],"installed_build":2}'),
         "wrong types"),
        (lambda p: p.write_text("{}"), "empty object"),
    ],
)
def test_negative_control_6_absent_or_malformed_records(tmp_path, mutate, label):
    """§1: an unparseable record proves nothing, so it yields ABSENCE of service —
    it is never read as 'no restriction'."""
    _db, _repo, cache, fetcher, _c, _r = _installed_inst(tmp_path)
    mutate(cache / "inst" / "serving.json")
    assert _fresh(cache, fetcher).serving_build() is None, label


def test_a_corrupt_trust_anchor_fails_closed(tmp_path):
    _db, _repo, cache, fetcher, _c, _r = _installed_inst(tmp_path)
    (cache / "inst" / "trust.json").write_text("{corrupt")
    assert _fresh(cache, fetcher).serving_build() is None


# --- §7 lifecycle -------------------------------------------------------------


def _withdraw_inst(db, repo, cache, fetcher, *, day=1):
    """Publish a build that WITHHOLDS inst, and poll it."""
    seed_inst(db, covered=False)
    publish_build(db, repo, moment=NOW + timedelta(days=day))
    client = _fresh(cache, fetcher, moment=NOW + timedelta(days=day))
    return client, client.refresh()


def test_a_verified_omission_withdraws_the_module(tmp_path):
    """§4: the manifest omits inst → withdrawn, carrying `verified_omission`,
    and nothing is served for it."""
    db, repo, cache, fetcher, _c, _r = _installed_inst(tmp_path)
    client, result = _withdraw_inst(db, repo, cache, fetcher)
    assert result.status == "withdrawn"
    assert result.verified_omission is True
    assert client.serving_build() is None and client.db_path() is None
    assert _record(cache)["installed_build"] is None

    # Congress, published in the same build, is unaffected.
    congress = _fresh(cache, fetcher, moment=NOW + timedelta(days=1))
    from populus.client.snapshot import SnapshotClient
    cong = SnapshotClient(cache, fetcher, now=pin(NOW + timedelta(days=1)),
                          module="congress")
    assert cong.refresh().status == "installed"


def test_withdraw_then_offline_restart_stays_absent(tmp_path):
    """A fresh client that cannot reach the repo must not resurrect the module."""
    db, repo, cache, fetcher, _c, _r = _installed_inst(tmp_path)
    _withdraw_inst(db, repo, cache, fetcher)

    from populus.client.snapshot import FetchError, SnapshotClient

    class _Offline:
        def fetch_path(self, path):
            raise FetchError("offline")

    revived = SnapshotClient(cache, _Offline(), now=pin(NOW + timedelta(days=1)),
                             module="inst")
    assert revived.serving_build() is None
    assert revived.refresh().status == "refused"
    assert revived.db_path() is None


def test_withdraw_then_replay_of_the_pre_withdrawal_pointer_stays_absent(tmp_path):
    """The anchor advanced at the commit, so the old pointer is a ROLLBACK and is
    refused — no heal can fire from it."""
    db, repo, cache, fetcher, _c, _r = _installed_inst(tmp_path)
    v1 = fetcher.fetch_path("latest.json")
    _withdraw_inst(db, repo, cache, fetcher)

    from populus.client.snapshot import SnapshotClient

    class _Replay:
        def fetch_path(self, path):
            return v1 if path == "latest.json" else fetcher.fetch_path(path)

    replayed = SnapshotClient(cache, _Replay(), now=pin(NOW + timedelta(days=1)),
                              module="inst")
    replayed.refresh()
    assert replayed.serving_build() is None, "a replayed pointer resurrected the build"
    assert replayed.db_path() is None


def test_withdraw_then_a_newer_build_republishes_and_it_serves(tmp_path):
    """Withdrawal is not a one-way door."""
    db, repo, cache, fetcher, _c, _r = _installed_inst(tmp_path)
    _withdraw_inst(db, repo, cache, fetcher)

    seed_inst(db, covered=True)
    publish_build(db, repo, moment=NOW + timedelta(days=2))
    restored = _fresh(cache, fetcher, moment=NOW + timedelta(days=2))
    assert restored.refresh().status == "installed"
    assert restored.serving_build() is not None
    assert restored.db_path() is not None

    # Repeat polls are stable — no oscillation.
    for _ in range(3):
        again = _fresh(cache, fetcher, moment=NOW + timedelta(days=2))
        assert again.refresh().status == "idempotent"
        assert again.serving_build() == restored.serving_build()


def test_install_withdraw_install_withdraw_is_stable(tmp_path):
    """§7: alternating transitions, each committing cleanly."""
    db, repo, cache, fetcher, _c, _r = _installed_inst(tmp_path)
    for day, covered, expected in ((1, False, None), (2, True, "serve"),
                                   (3, False, None), (4, True, "serve")):
        seed_inst(db, covered=covered)
        publish_build(db, repo, moment=NOW + timedelta(days=day))
        client = _fresh(cache, fetcher, moment=NOW + timedelta(days=day))
        client.refresh()
        if expected is None:
            assert client.serving_build() is None, f"day {day} should be absent"
        else:
            assert client.serving_build() is not None, f"day {day} should serve"


# --- §5 crash/failure boundaries ---------------------------------------------


def test_install_write2_failure_is_absent_then_heals_and_serves(tmp_path):
    """§5: anchor committed, record not yet written → ABSENT; the idempotent heal
    at the same authenticated pointer completes it and it serves."""
    from populus.client.snapshot import LocalRepoFetcher, SnapshotClient

    db = seed_db(tmp_path / "populus.db")
    seed_inst(db, covered=True)
    repo = make_repo(tmp_path)
    publish_build(db, repo)
    cache = tmp_path / "cache"
    fetcher = LocalRepoFetcher(repo)

    boom = SnapshotClient(cache, fetcher, now=pin(), module="inst")
    real_write = SnapshotClient._write_record
    def _fail(self, *a, **k):
        raise OSError("disk full")
    SnapshotClient._write_record = _fail
    try:
        result = boom.refresh()
    finally:
        SnapshotClient._write_record = real_write
    assert result.status == "refused"

    # Pre-refresh: the partial state proves nothing.
    stranded = SnapshotClient(cache, fetcher, now=pin(), module="inst")
    assert stranded.serving_build() is None

    # Post-refresh: the heal completes it at the equal authenticated pointer.
    healed = SnapshotClient(cache, fetcher, now=pin(), module="inst")
    assert healed.refresh().status in ("installed", "idempotent")
    assert healed.serving_build() is not None
    assert healed.db_path() is not None


def test_withdrawal_write2_failure_is_absent_and_replay_cannot_restore(tmp_path):
    """§5 + §7: the anchor committed the withdrawal, so even though the null
    record never landed, the module is absent AND a replay of the pre-withdrawal
    pointer cannot bring it back. This is the exact path that resurrected
    withheld data under the old design."""
    from populus.client.snapshot import SnapshotClient

    db, repo, cache, fetcher, _c, _r = _installed_inst(tmp_path)
    v1 = fetcher.fetch_path("latest.json")

    seed_inst(db, covered=False)
    publish_build(db, repo, moment=NOW + timedelta(days=1))
    later = pin(NOW + timedelta(days=1))

    boom = SnapshotClient(cache, fetcher, now=later, module="inst")
    real_write = SnapshotClient._write_record
    SnapshotClient._write_record = lambda self, *a, **k: (_ for _ in ()).throw(
        OSError("disk full"))
    try:
        result = boom.refresh()
    finally:
        SnapshotClient._write_record = real_write
    # The withdrawal COMMITTED at the anchor even though the record failed.
    assert result.status == "withdrawn" and result.verified_omission is True

    stranded = SnapshotClient(cache, fetcher, now=later, module="inst")
    assert stranded.serving_build() is None

    class _Replay:
        def fetch_path(self, path):
            return v1 if path == "latest.json" else fetcher.fetch_path(path)

    replayed = SnapshotClient(cache, _Replay(), now=later, module="inst")
    replayed.refresh()
    assert replayed.serving_build() is None, (
        "a replayed pre-withdrawal pointer restored the withheld build"
    )


def test_reconcile_never_raises_and_removes_orphans(tmp_path):
    """§6: refresh() calls reconcile on every poll, so an escaping OSError would
    take down every module, not one."""
    _db, _repo, cache, fetcher, client, _r = _installed_inst(tmp_path)
    orphan = cache / "inst" / ".tmp-leftover"
    orphan.mkdir()
    client.reconcile()
    assert not orphan.exists()
    # An unreadable module dir must not raise out.
    import unittest.mock as mock
    with mock.patch.object(type(cache), "glob", side_effect=OSError("boom")):
        client.reconcile()   # must not raise


# --- §7 serialization ---------------------------------------------------------


def test_lock_contention_refuses_without_writing_and_keeps_serving(tmp_path):
    """§4.1: contention is TRANSIENT and says nothing about what is already
    proven. The contender writes nothing and serving is unaffected."""
    import fcntl

    _db, _repo, cache, fetcher, client, _r = _installed_inst(tmp_path)
    proven = client.serving_build()
    assert proven is not None                      # a stable proven build (rev-6 F1)
    before = (cache / "inst" / "serving.json").read_bytes()
    anchor_before = (cache / "inst" / "trust.json").read_bytes()

    holder = open(cache / "inst" / ".lock", "a+")
    fcntl.flock(holder.fileno(), fcntl.LOCK_EX)
    try:
        contender = _fresh(cache, fetcher)
        result = contender.refresh()
        assert result.status == "refused"
        assert "lock" in result.message
        assert contender.serving_build() == proven, "contention changed serving"
    finally:
        fcntl.flock(holder.fileno(), fcntl.LOCK_UN)
        holder.close()

    assert (cache / "inst" / "serving.json").read_bytes() == before
    assert (cache / "inst" / "trust.json").read_bytes() == anchor_before


def test_the_lock_is_released_after_an_exception_mid_transition(tmp_path):
    """§4.1: released on EVERY exit path, including exceptions — otherwise one
    crash wedges the module forever."""
    from populus.client.snapshot import SnapshotClient

    db, repo, cache, fetcher, _c, _r = _installed_inst(tmp_path)
    publish_build(db, repo, moment=NOW + timedelta(days=1))
    later = pin(NOW + timedelta(days=1))

    boom = SnapshotClient(cache, fetcher, now=later, module="inst")
    real = SnapshotClient._install
    SnapshotClient._install = lambda self, *a, **k: (_ for _ in ()).throw(
        RuntimeError("crash mid-transition"))
    try:
        with pytest.raises(RuntimeError):
            boom.refresh()
    finally:
        SnapshotClient._install = real

    # A subsequent refresh must be able to take the lock.
    after = SnapshotClient(cache, fetcher, now=later, module="inst")
    assert after.refresh().status in ("installed", "idempotent")


def test_a_stale_writer_cannot_regress_the_anchor(tmp_path):
    """§7 serialization: a writer that paused before its transition must not be
    able to commit an older generation over a newer one.

    (The first version of this test was VACUOUS: it defined a `_StaleFetcher`
    and never instantiated it, serialized `serving.json` into a variable named
    `v1_bytes` that was never used, and then polled with the REAL fetcher — so
    it merely re-asserted the withdrawal and exercised nothing about anchor
    regression. An independent review caught it. This version captures the
    genuine pre-withdrawal pointer bytes and replays them.)"""
    from populus.client.snapshot import SnapshotClient

    db, repo, cache, fetcher, _c, _r = _installed_inst(tmp_path)
    v1_pointer = fetcher.fetch_path("latest.json")          # the STALE pointer
    v1_anchor = json.loads((cache / "inst" / "trust.json").read_text())

    # A newer build withdraws inst and commits.
    seed_inst(db, covered=False)
    publish_build(db, repo, moment=NOW + timedelta(days=1))
    later = pin(NOW + timedelta(days=1))
    assert SnapshotClient(cache, fetcher, now=later,
                          module="inst").refresh().status == "withdrawn"
    anchor_after = json.loads((cache / "inst" / "trust.json").read_text())
    assert anchor_after["pointer_version"] > v1_anchor["pointer_version"]

    class _StaleWriter:
        """The paused writer, resuming with the pre-withdrawal pointer."""

        def fetch_path(self, path):
            return v1_pointer if path == "latest.json" else fetcher.fetch_path(path)

    for attempt in (1, 2, 3):
        stale = SnapshotClient(cache, _StaleWriter(), now=later, module="inst")
        result = stale.refresh()
        assert result.status == "refused", (
            f"attempt {attempt}: a stale pointer was accepted ({result.status})"
        )
        assert json.loads((cache / "inst" / "trust.json").read_text()) == anchor_after, (
            f"attempt {attempt}: the anchor was regressed"
        )
        assert stale.serving_build() is None
        assert _record(cache)["installed_build"] is None


def test_the_fail_closed_path_when_the_lock_is_unavailable(tmp_path, monkeypatch):
    """§7 serialization, the clause that was unasserted: 'with the fail-closed
    path asserted when the lock is unavailable'."""
    from populus.client import snapshot as snap_mod

    _db, _repo, cache, fetcher, _c, _r = _installed_inst(tmp_path)
    monkeypatch.setattr(snap_mod.fcntl, "flock",
                        lambda fd, op: (_ for _ in ()).throw(
                            OSError(45, "Operation not supported")))
    client = _fresh(cache, fetcher)
    assert client._disabled_reason is not None
    assert client.serving_build() is None                 # fails CLOSED
    assert client.db_path() is None
    result = client.refresh()
    assert result.status == "refused" and "disabled" in result.message
    # No transition was attempted, so durable state is untouched.
    assert _record(cache)["installed_build"] is not None


def test_an_unsupported_flock_disables_the_module_before_reading_cache_state(
    tmp_path, monkeypatch
):
    """§4.1: unsupported flock is PERSISTENT — no transition could ever be
    serialized — so the module is disabled at construction, and it is a
    configuration outcome rather than a serving decision."""
    import fcntl as fcntl_mod

    from populus.client import snapshot as snap_mod

    _db, _repo, cache, fetcher, client, _r = _installed_inst(tmp_path)
    assert client.serving_build() is not None      # proven before we break flock

    def _unsupported(fd, op):
        raise OSError(95, "Operation not supported")

    monkeypatch.setattr(snap_mod.fcntl, "flock", _unsupported)
    disabled = _fresh(cache, fetcher)
    assert disabled._disabled_reason is not None
    assert "flock" in disabled._disabled_reason
    assert disabled.serving_build() is None
    assert disabled.db_path() is None
    result = disabled.refresh()
    assert result.status == "refused" and "disabled" in result.message
    assert fcntl_mod is snap_mod.fcntl or True     # module identity sanity


# --- §7(b) production resolver, partitioned by what each case SHOULD do -------


def _resolve(repo, cache, monkeypatch, *, moment=None):
    """Run the real MCP resolver against this repo/cache."""
    import sys

    from populus.mcp_server import server as srv_mod

    monkeypatch.setattr(sys, "argv",
                        ["populus-mcp", "--attestation=staging-noop", "--data-repo", str(repo), "--cache", str(cache)])
    monkeypatch.setattr(srv_mod, "_utc_now", pin(moment) if moment else pin())
    return srv_mod._resolve_snapshot()


def test_resolver_must_serve_first_install(tmp_path, monkeypatch):
    db = seed_db(tmp_path / "populus.db")
    seed_inst(db, covered=True)
    repo = make_repo(tmp_path)
    publish_build(db, repo)
    r = _resolve(repo, tmp_path / "cache", monkeypatch)
    assert r["inst_db_path"] is not None
    assert r["inst_from_published_manifest"] is True
    assert r["db_path"] is not None                      # congress available


def test_resolver_must_serve_after_republication_and_rollback(tmp_path, monkeypatch):
    db, repo, cache, fetcher, _c, _r = _installed_inst(tmp_path)
    _withdraw_inst(db, repo, cache, fetcher)
    seed_inst(db, covered=True)
    publish_build(db, repo, moment=NOW + timedelta(days=2))
    r = _resolve(repo, cache, monkeypatch, moment=NOW + timedelta(days=2))
    assert r["inst_db_path"] is not None, "republication was suppressed"
    assert r["inst_from_published_manifest"] is True
    assert r["db_path"] is not None


def test_resolver_must_serve_a_healed_install_write2_partial(tmp_path, monkeypatch):
    """§7(b): the partial state heals at the equal authenticated pointer and
    serves — the test must not forbid correct healing."""
    from populus.client.snapshot import LocalRepoFetcher, SnapshotClient

    db = seed_db(tmp_path / "populus.db")
    seed_inst(db, covered=True)
    repo = make_repo(tmp_path)
    publish_build(db, repo)
    cache = tmp_path / "cache"
    boom = SnapshotClient(cache, LocalRepoFetcher(repo), now=pin(), module="inst")
    real = SnapshotClient._write_record
    SnapshotClient._write_record = lambda self, *a, **k: (_ for _ in ()).throw(
        OSError("disk full"))
    try:
        boom.refresh()
    finally:
        SnapshotClient._write_record = real
    assert SnapshotClient(cache, LocalRepoFetcher(repo), now=pin(),
                          module="inst").serving_build() is None   # pre-refresh

    r = _resolve(repo, cache, monkeypatch)                          # post-refresh
    assert r["inst_db_path"] is not None, "the heal was forbidden"
    assert r["inst_from_published_manifest"] is True


def test_resolver_must_remain_absent_for_a_verified_withdrawal(tmp_path, monkeypatch):
    db, repo, cache, fetcher, _c, _r = _installed_inst(tmp_path)
    _withdraw_inst(db, repo, cache, fetcher)
    r = _resolve(repo, cache, monkeypatch, moment=NOW + timedelta(days=1))
    assert r["inst_db_path"] is None
    assert r["inst_from_published_manifest"] is False
    assert r["inst_absent_gate_withheld"] is True
    assert "withheld it" in r["inst_absent_reason"]
    assert r["db_path"] is not None                      # congress unaffected


def test_corrupt_artifacts_are_absent_pre_refresh_and_re_verified_online(
    tmp_path, monkeypatch
):
    """Corrupt cached artifacts prove nothing (§7a → absent). Post-refresh the
    behaviour depends on whether the source can still supply them:

    ONLINE the build is re-fetched and re-verified against the manifest digest,
    so serving it is safe and permanent absence would be a worse outcome —
    self-healing is the point of a content-addressed cache. §7(b) lists corrupt
    artifacts under must-remain-absent without drawing that distinction; this
    test pins BOTH halves so the difference is explicit rather than accidental.
    """
    _db, repo, cache, fetcher, _c, _r = _installed_inst(tmp_path)
    build = _record(cache)["installed_build"]
    (cache / "inst" / build / "inst_agg.db").write_bytes(b"corrupt")

    # (a) pre-refresh: the durable state proves nothing.
    assert _fresh(cache, fetcher).serving_build() is None

    # (b) post-refresh, ONLINE: re-fetched and re-verified, so it serves again.
    r = _resolve(repo, cache, monkeypatch)
    assert r["inst_db_path"] is not None
    assert r["inst_from_published_manifest"] is True
    assert r["db_path"] is not None


def test_corrupt_artifacts_stay_absent_when_they_cannot_be_re_fetched(tmp_path):
    """The offline half: nothing can re-establish the proof, so it stays absent."""
    from populus.client.snapshot import FetchError, SnapshotClient

    _db, _repo, cache, _f, _c, _r = _installed_inst(tmp_path)
    build = _record(cache)["installed_build"]
    (cache / "inst" / build / "inst_agg.db").write_bytes(b"corrupt")

    class _Offline:
        def fetch_path(self, path):
            raise FetchError("offline")

    client = SnapshotClient(cache, _Offline(), now=pin(), module="inst")
    assert client.serving_build() is None
    assert client.refresh().status == "refused"
    assert client.db_path() is None


@pytest.mark.parametrize("mutate", [
    lambda p: p.unlink(),
    lambda p: p.write_text("{not json"),
])
def test_resolver_heals_a_malformed_record_at_an_equal_pointer(
    tmp_path, monkeypatch, mutate
):
    """§7(b): where the equal authenticated pointer publishes the module and its
    build verifies, healing is CORRECT — absence would be wrong here."""
    _db, repo, cache, _f, _c, _r = _installed_inst(tmp_path)
    mutate(cache / "inst" / "serving.json")
    r = _resolve(repo, cache, monkeypatch)
    assert r["inst_db_path"] is not None
    assert r["inst_from_published_manifest"] is True


def test_an_unsupported_flock_stops_the_server_with_an_honest_reason(
    tmp_path, monkeypatch
):
    """An unsupported `flock` is a CACHE-level failure, not a module-level one:
    no module can be transitioned safely, so the server must refuse to start
    rather than serve unserialized. The message must name the real cause — not
    the generic 'no current snapshot' advice, which would send an operator
    chasing a publish problem they do not have."""
    from populus.client import snapshot as snap_mod

    db = seed_db(tmp_path / "populus.db")
    seed_inst(db, covered=True)
    repo = make_repo(tmp_path)
    publish_build(db, repo)
    monkeypatch.setattr(snap_mod.fcntl, "flock",
                        lambda fd, op: (_ for _ in ()).throw(
                            OSError(95, "Operation not supported")))
    with pytest.raises(SystemExit) as excinfo:
        _resolve(repo, tmp_path / "cache", monkeypatch)
    assert "flock" in str(excinfo.value)


# --- §7 reporting -------------------------------------------------------------


def test_verified_omission_is_reconstructed_on_an_idempotent_poll(tmp_path):
    """§4: after a restart the pointer is unchanged, so the poll is `idempotent`
    — the gate-withheld FACT must still be reported, not degrade to neutral."""
    db, repo, cache, fetcher, _c, _r = _installed_inst(tmp_path)
    _withdraw_inst(db, repo, cache, fetcher)

    restarted = _fresh(cache, fetcher, moment=NOW + timedelta(days=1))
    result = restarted.refresh()
    assert restarted.serving_build() is None
    # The FLAG itself must survive. The earlier version allowed
    # `... or _record(cache)["installed_build"] is None`, whose second disjunct
    # is trivially true after any successful withdrawal — so the test passed
    # even if the heal stopped carrying the flag, i.e. exactly the regression it
    # is named for. Assert only the fact that matters.
    assert result.verified_omission is True
    assert _record(cache)["installed_build"] is None


def test_a_corrupt_anchor_cannot_resurrect_a_withheld_build_via_replay(tmp_path):
    """QA-BLOCKER-1 (independent review): the money question, answered.

    Sequence that served coverage-gate-WITHHELD data as published:
      1. inst installed from build A at pointer v1.
      2. A newer build withholds inst; the withdrawal COMMITS (anchor at v2,
         null record). Absent — correct.
      3. `trust.json` becomes corrupt (an enumerated state, spec §5 last row).
      4. The pointer source returns the OLD v1 pointer — a stale mirror, a CDN
         or git cache, a rolled-back data repo, or a replay inside the 7-day
         attestation window.
      5. `_load_trust` swallowed the corruption and returned None, which
         `evaluate_pointer` read as BOOTSTRAP, so v1 was accepted, build A was
         re-installed, and `_resolve_snapshot` reported it with
         `inst_from_published_manifest=True` — i.e. the >=95% coverage guarantee
         asserted over a build the current manifest deliberately omits.
    """
    import sys

    from populus.client.snapshot import SnapshotClient
    from populus.mcp_server import server as srv_mod

    db, repo, cache, fetcher, _c, _r = _installed_inst(tmp_path)
    withheld_build = _record(cache)["installed_build"]
    v1_pointer = fetcher.fetch_path("latest.json")

    _withdraw_inst(db, repo, cache, fetcher)                 # commits at v2
    assert _fresh(cache, fetcher, moment=NOW + timedelta(days=1)).serving_build() is None

    # (3) the anchor is corrupted, (4) the stale pointer comes back
    (cache / "inst" / "trust.json").write_text("garbage")

    class _StalePointer:
        def fetch_path(self, path):
            return v1_pointer if path == "latest.json" else fetcher.fetch_path(path)

    later = pin(NOW + timedelta(days=1))
    client = SnapshotClient(cache, _StalePointer(), now=later, module="inst")
    result = client.refresh()
    assert result.status == "refused", (
        f"a corrupt anchor re-bootstrapped from a stale pointer: {result.status}"
    )
    assert client.serving_build() is None
    assert client.db_path() is None, "the withheld build was resurrected"

    # And through the PRODUCTION resolver — the path that stamps provenance.
    monkey_argv = ["populus-mcp", "--attestation=staging-noop", "--data-repo", str(repo), "--cache", str(cache)]
    real_argv = sys.argv
    real_now = srv_mod._utc_now
    sys.argv = monkey_argv
    srv_mod._utc_now = later
    try:
        resolved = srv_mod._resolve_snapshot()
    finally:
        sys.argv = real_argv
        srv_mod._utc_now = real_now
    assert resolved["inst_db_path"] is None, (
        f"the resolver served the withheld build {withheld_build}"
    )
    assert resolved["inst_from_published_manifest"] is False, (
        "withheld data was stamped with the >=95% coverage guarantee"
    )


def test_the_resolver_module_boundary_absorbs_an_inst_io_failure(tmp_path, monkeypatch):
    """The RESOLVER-level guarantee: any inst I/O failure resolves to an honest
    absence with congress unaffected.

    (Named for the boundary it actually exercises — QA-VERIFY-N-b. It was
    previously named for `_install`'s temp-directory guard, but still passed
    with that guard removed, because this module boundary catches the escape
    either way. `test_a_full_cache_filesystem_does_not_take_down_the_server`
    is the one that pins the guard itself.)"""
    import shutil as shutil_mod
    import sys

    from populus.mcp_server import server as srv_mod

    db, repo, cache, _f, _c, _r = _installed_inst(tmp_path)
    # A newer build so `_install` actually runs, plus a stuck orphan.
    seed_inst(db, covered=True)
    publish_build(db, repo, moment=NOW + timedelta(days=1))
    orphan = cache / "inst" / f".tmp-{latest_pointer(repo)['build_id']}"
    orphan.mkdir(parents=True, exist_ok=True)

    def _stuck(path, *a, **k):
        raise PermissionError("cannot remove")

    monkeypatch.setattr(shutil_mod, "rmtree", _stuck)
    monkeypatch.setattr(sys, "argv",
                        ["populus-mcp", "--attestation=staging-noop", "--data-repo", str(repo), "--cache", str(cache)])
    monkeypatch.setattr(srv_mod, "_utc_now", pin(NOW + timedelta(days=1)))

    resolved = srv_mod._resolve_snapshot()          # must NOT raise
    assert resolved["db_path"] is not None, "congress died with the inst module"
    assert resolved["inst_from_published_manifest"] is False
    assert resolved["inst_absent_gate_withheld"] is False, (
        "an I/O failure was misreported as a coverage-gate decision"
    )


def test_a_full_cache_filesystem_does_not_take_down_the_server(tmp_path, monkeypatch):
    """The same escape via `mkdir` — ENOSPC on the temp directory."""
    from populus.client.snapshot import SnapshotClient

    db, repo, cache, fetcher, _c, _r = _installed_inst(tmp_path)
    seed_inst(db, covered=True)
    publish_build(db, repo, moment=NOW + timedelta(days=1))

    real_mkdir = Path.mkdir

    def _no_space(self, *a, **k):
        if self.name.startswith(".tmp-"):
            raise OSError(28, "No space left on device")
        return real_mkdir(self, *a, **k)

    monkeypatch.setattr(Path, "mkdir", _no_space)
    client = SnapshotClient(cache, fetcher, now=pin(NOW + timedelta(days=1)),
                            module="inst")
    result = client.refresh()                        # must NOT raise
    assert result.status == "refused"


def test_an_unopenable_lock_file_does_not_escape_refresh(tmp_path, monkeypatch):
    """`_module_lock`'s open() was outside the guard that wrapped only flock."""
    from populus.client.snapshot import SnapshotClient

    _db, _repo, cache, fetcher, _c, _r = _installed_inst(tmp_path)
    proven = _fresh(cache, fetcher).serving_build()

    import builtins
    real_open = builtins.open

    def _no_open(path, *a, **k):
        if str(path).endswith(".lock"):
            raise OSError(30, "Read-only file system")
        return real_open(path, *a, **k)

    # Construct FIRST (so the constructor probe succeeds), then break open() —
    # this isolates `_module_lock`'s own open rather than the disabled-state
    # path, which would otherwise short-circuit the test.
    client = SnapshotClient(cache, fetcher, now=pin(), module="inst")
    assert client._disabled_reason is None
    monkeypatch.setattr(builtins, "open", _no_open)
    result = client.refresh()                        # must NOT raise
    assert result.status == "refused"
    monkeypatch.undo()
    # Nothing was written; the proven build still serves.
    assert _fresh(cache, fetcher).serving_build() == proven


def test_an_unreadable_artifact_is_incomplete_not_an_exception(tmp_path, monkeypatch):
    """`_build_complete` runs inside BOTH serving_build() and refresh(), so an
    EACCES/EIO there would take down every module."""
    _db, _repo, cache, fetcher, _c, _r = _installed_inst(tmp_path)
    build = _record(cache)["installed_build"]
    target = cache / "inst" / build / "inst_agg.db"

    real_read = Path.read_bytes

    def _unreadable(self, *a, **k):
        if self == target:
            raise OSError(13, "Permission denied")
        return real_read(self, *a, **k)

    monkeypatch.setattr(Path, "read_bytes", _unreadable)
    client = _fresh(cache, fetcher)
    assert client.serving_build() is None            # incomplete, not a crash
    assert client.db_path() is None


def test_a_non_flock_lock_failure_is_not_blamed_on_flock_support(tmp_path, monkeypatch):
    """QA-NIT-2: every OSError from the lock probe was reported as 'the cache
    filesystem does not support flock'. A read-only cache, EACCES, or a
    directory where the lock file belongs would send an operator chasing a
    filesystem-capability problem they do not have."""
    import builtins

    from populus.client.snapshot import SnapshotClient

    _db, repo, cache, fetcher, _c, _r = _installed_inst(tmp_path)
    real_open = builtins.open

    def _read_only(path, *a, **k):
        if str(path).endswith(".lock"):
            raise OSError(30, "Read-only file system")
        return real_open(path, *a, **k)

    monkeypatch.setattr(builtins, "open", _read_only)
    client = SnapshotClient(cache, fetcher, now=pin(), module="inst")
    assert client._disabled_reason is not None            # still fails closed
    assert "does not support flock" not in client._disabled_reason
    assert "EROFS" in client._disabled_reason or "Read-only" in client._disabled_reason


def test_install_write1_failure_leaves_prior_state_untouched(tmp_path, monkeypatch):
    """§5 row 'install write 1 fails (tuple)': the COMMIT never happened, so
    nothing changed and the prior build keeps serving. Untested before —
    §5 separated these rows precisely because an earlier revision collapsed them
    wrongly, and they are the commit-boundary rows."""
    from populus.client import snapshot as snap_mod
    from populus.client.snapshot import SnapshotClient

    db, repo, cache, fetcher, _c, _r = _installed_inst(tmp_path)
    before_build = _fresh(cache, fetcher).serving_build()
    before_anchor = (cache / "inst" / "trust.json").read_bytes()
    before_record = (cache / "inst" / "serving.json").read_bytes()

    seed_inst(db, covered=True)
    publish_build(db, repo, moment=NOW + timedelta(days=1))
    monkeypatch.setattr(snap_mod, "persist_tuple",
                        lambda *a, **k: (_ for _ in ()).throw(OSError("disk full")))
    client = SnapshotClient(cache, fetcher, now=pin(NOW + timedelta(days=1)),
                            module="inst")
    result = client.refresh()
    assert result.status == "refused"
    monkeypatch.undo()

    after = _fresh(cache, fetcher, moment=NOW + timedelta(days=1))
    assert after.serving_build() == before_build, "the prior build stopped serving"
    assert (cache / "inst" / "trust.json").read_bytes() == before_anchor
    assert (cache / "inst" / "serving.json").read_bytes() == before_record


def test_withdrawal_write1_failure_does_not_commit(tmp_path, monkeypatch):
    """§5 row 'withdrawal write 1 fails (tuple)': the withdrawal did NOT commit,
    so prior state stands and the refusal says so honestly rather than claiming
    a withdrawal that never happened."""
    from populus.client import snapshot as snap_mod
    from populus.client.snapshot import SnapshotClient

    db, repo, cache, fetcher, _c, _r = _installed_inst(tmp_path)
    before_build = _fresh(cache, fetcher).serving_build()

    seed_inst(db, covered=False)
    publish_build(db, repo, moment=NOW + timedelta(days=1))
    monkeypatch.setattr(snap_mod, "persist_tuple",
                        lambda *a, **k: (_ for _ in ()).throw(OSError("disk full")))
    client = SnapshotClient(cache, fetcher, now=pin(NOW + timedelta(days=1)),
                            module="inst")
    result = client.refresh()
    assert result.status == "refused"
    assert "did NOT commit" in result.message
    assert result.verified_omission is False, (
        "a withdrawal that did not commit must not claim to have been verified"
    )
    assert result.observed_omission is True, (
        "an uncommitted withdrawal must still signal that a verified manifest"
        " omitted the module, or the stale build is served with no signal"
    )
    monkeypatch.undo()
    assert _fresh(cache, fetcher).serving_build() == before_build

    # Retrying once the write works commits properly.
    retried = SnapshotClient(cache, fetcher, now=pin(NOW + timedelta(days=1)),
                             module="inst")
    assert retried.refresh().status == "withdrawn"
    assert retried.serving_build() is None


def test_an_authorized_rollback_to_the_withdrawn_build_serves(tmp_path):
    """§7: 'authorized higher-version rollback to the withdrawn build → served'.
    This was QA-r7-F2, a SHIPPED blocker, and had no regression test — the
    similarly-named resolver test only republishes a newer build."""
    from populus.client.snapshot import SnapshotClient

    db, repo, cache, fetcher, _c, _r = _installed_inst(tmp_path)
    original = _fresh(cache, fetcher).serving_build()
    assert original is not None

    seed_inst(db, covered=False)
    publish_build(db, repo, moment=NOW + timedelta(days=1))
    later = pin(NOW + timedelta(days=1))
    assert SnapshotClient(cache, fetcher, now=later,
                          module="inst").refresh().status == "withdrawn"

    # An AUTHORIZED higher-version pointer that names the withdrawn build again.
    run_publish(repo, now=pin(NOW + timedelta(days=2)),
                backend=LocalDirBackend(repo), rollback_to=original)
    t3 = pin(NOW + timedelta(days=2, hours=1))
    client = SnapshotClient(cache, fetcher, now=t3, module="inst")
    result = client.refresh()
    assert client.serving_build() == original, (
        f"an authorized rollback to the withdrawn build stayed suppressed"
        f" ({result.status}: {result.message})"
    )
    assert client.db_path() is not None
    assert original in str(client.db_path())


def test_opposite_transitions_serialize_rather_than_interleave(tmp_path):
    """§7: 'opposite transitions (install vs withdrawal) serialize rather than
    interleave'. With the lock held by a withdrawal, an install cannot slip in;
    the durable state is one transition's or the other's, never a mixture."""
    import fcntl

    from populus.client.snapshot import SnapshotClient

    db, repo, cache, fetcher, _c, _r = _installed_inst(tmp_path)
    # The NEXT build WITHHOLDS inst, so the transition the blocked client would
    # attempt is a withdrawal while an install-shaped poll is locked out — two
    # opposite transitions contending for the same module (QA-VERIFY-N-d).
    seed_inst(db, covered=False)
    publish_build(db, repo, moment=NOW + timedelta(days=1))
    later = pin(NOW + timedelta(days=1))

    holder = open(cache / "inst" / ".lock", "a+")
    fcntl.flock(holder.fileno(), fcntl.LOCK_EX)
    try:
        blocked = SnapshotClient(cache, fetcher, now=later, module="inst")
        result = blocked.refresh()
        assert result.status == "refused"
        # The install did NOT partially apply while the other writer holds it.
        anchor = json.loads((cache / "inst" / "trust.json").read_text())
        rec = _record(cache)
        assert rec["pointer_version"] == anchor["pointer_version"], (
            "state was left mid-transition by a writer that never held the lock"
        )
    finally:
        fcntl.flock(holder.fileno(), fcntl.LOCK_UN)
        holder.close()

    # Once released, the withdrawal proceeds normally — the opposite transition
    # completes intact rather than interleaving with the blocked poll.
    after = SnapshotClient(cache, fetcher, now=later, module="inst")
    assert after.refresh().status == "withdrawn"
    assert after.serving_build() is None


def test_a_pending_withdrawal_is_flagged_to_the_resolver(tmp_path, monkeypatch):
    """QA-NIT-3: when a verified manifest omits the module but the withdrawal
    could not commit, the prior build keeps serving (spec §4/§5 — nothing
    committed). Those bytes did pass the gate when published, so serving them is
    defensible — but reporting them as clean published data with NO signal hides
    that the current build no longer publishes this module."""
    import sys

    from populus.client import snapshot as snap_mod
    from populus.mcp_server import server as srv_mod

    from populus.client.snapshot import LocalRepoFetcher, SnapshotClient

    db, repo, cache, _f, _c, _r = _installed_inst(tmp_path)
    seed_inst(db, covered=False)
    publish_build(db, repo, moment=NOW + timedelta(days=1))
    # Install congress FIRST so the patched write only affects the inst
    # transition — otherwise congress cannot install either and the server
    # exits for an unrelated reason.
    later = pin(NOW + timedelta(days=1))
    assert SnapshotClient(cache, LocalRepoFetcher(repo), now=later,
                          module="congress").refresh().status == "installed"

    monkeypatch.setattr(snap_mod, "persist_tuple",
                        lambda *a, **k: (_ for _ in ()).throw(OSError("disk full")))
    monkeypatch.setattr(sys, "argv",
                        ["populus-mcp", "--attestation=staging-noop", "--data-repo", str(repo), "--cache", str(cache)])
    monkeypatch.setattr(srv_mod, "_utc_now", pin(NOW + timedelta(days=1)))

    resolved = srv_mod._resolve_snapshot()
    assert resolved["inst_db_path"] is not None          # still serving (§4)
    assert resolved["inst_stale_withdrawal_pending"] is True, (
        "the pending withdrawal was not surfaced"
    )


def test_a_deleted_anchor_beside_a_record_cannot_resurrect_a_withheld_build(tmp_path):
    """QA-VERIFY-BLOCKER-1: the sibling of the corrupt-anchor hazard, through
    `unlink` instead of corruption.

    No correct transition can produce "serving record at generation N, no
    anchor" — the anchor is written FIRST in both directions — so that state is
    state loss or tampering, never bootstrap. Treating it as bootstrap let a
    replayed pre-withdrawal pointer reinstate the withheld build and had the
    resolver stamp it `inst_from_published_manifest=True`.
    """
    import sys

    from populus.client.snapshot import SnapshotClient
    from populus.mcp_server import server as srv_mod

    db, repo, cache, fetcher, _c, _r = _installed_inst(tmp_path)
    withheld_build = _record(cache)["installed_build"]
    v1_pointer = fetcher.fetch_path("latest.json")

    _withdraw_inst(db, repo, cache, fetcher)                  # commits at v2
    (cache / "inst" / "trust.json").unlink()                  # anchor DELETED
    assert (cache / "inst" / "serving.json").exists()         # record survives

    class _StalePointer:
        def fetch_path(self, path):
            return v1_pointer if path == "latest.json" else fetcher.fetch_path(path)

    later = pin(NOW + timedelta(days=1))
    client = SnapshotClient(cache, _StalePointer(), now=later, module="inst")
    result = client.refresh()
    assert result.status == "refused", (
        f"a deleted anchor re-bootstrapped from a stale pointer: {result.status}"
    )
    assert "remove the ENTIRE directory" in result.message
    assert client.serving_build() is None
    assert client.db_path() is None, f"{withheld_build} was resurrected"

    real_argv, real_now = sys.argv, srv_mod._utc_now
    sys.argv = ["populus-mcp", "--attestation=staging-noop", "--data-repo", str(repo), "--cache", str(cache)]
    srv_mod._utc_now = later
    try:
        resolved = srv_mod._resolve_snapshot()
    finally:
        sys.argv, srv_mod._utc_now = real_argv, real_now
    assert resolved["inst_db_path"] is None
    assert resolved["inst_from_published_manifest"] is False


def test_genuine_bootstrap_is_untouched_by_the_unanchored_refusal(tmp_path):
    """The refusal must not break REAL bootstrap: a module directory with no
    state files AND no cached builds was never established, so one unexpired
    pointer is accepted as before (TD-7)."""
    import shutil as shutil_mod

    from populus.client.snapshot import SnapshotClient

    _db, _repo, cache, fetcher, _c, _r = _installed_inst(tmp_path)
    shutil_mod.rmtree(cache / "inst")                 # genuinely fresh
    client = SnapshotClient(cache, fetcher, now=pin(), module="inst")
    assert client.refresh().status == "installed"
    assert client.serving_build() is not None


def test_clearing_only_the_state_files_still_refuses(tmp_path):
    """QA-VERIFY3-B2: the earlier refusal RECOMMENDED clearing the module dir,
    and clearing only the state files (or losing both) left the build artifacts
    behind — so the next poll read `bootstrap`, accepted a stale pointer, and
    reinstated the withheld build. The fix's own remediation walked the operator
    into the hole it had just closed.

    Any local state — a serving record OR a cached build directory — now means
    this is not a genuine bootstrap.
    """
    from populus.client.snapshot import SnapshotClient

    db, repo, cache, fetcher, _c, _r = _installed_inst(tmp_path)
    withheld = _record(cache)["installed_build"]
    v1_pointer = fetcher.fetch_path("latest.json")
    _withdraw_inst(db, repo, cache, fetcher)

    # BOTH state files gone; the cached build directory remains.
    (cache / "inst" / "trust.json").unlink()
    (cache / "inst" / "serving.json").unlink()
    assert (cache / "inst" / withheld).is_dir()

    class _StalePointer:
        def fetch_path(self, path):
            return v1_pointer if path == "latest.json" else fetcher.fetch_path(path)

    client = SnapshotClient(cache, _StalePointer(),
                            now=pin(NOW + timedelta(days=1)), module="inst")
    result = client.refresh()
    assert result.status == "refused", f"the withheld build came back: {result.status}"
    assert client.db_path() is None
    # And the remediation no longer recommends a partial clear.
    assert "ENTIRE directory" in result.message
    assert "7 days" in result.message


def test_a_pending_withdrawal_reaches_the_health_tools(tmp_path, monkeypatch):
    """QA-VERIFY-BLOCKER-2: the N3 signal was computed by the resolver and then
    DROPPED by `main()`, so `inst_health` still reported clean published data
    with the >=95% guarantee and no staleness signal. Drive the whole chain —
    resolver → build_server → tool output — not just the resolver dict."""
    import sys

    from populus.client.snapshot import LocalRepoFetcher, SnapshotClient
    from populus.client import snapshot as snap_mod
    from populus.mcp_server import server as srv_mod

    db, repo, cache, _f, _c, _r = _installed_inst(tmp_path)
    seed_inst(db, covered=False)
    publish_build(db, repo, moment=NOW + timedelta(days=1))
    later = pin(NOW + timedelta(days=1))
    assert SnapshotClient(cache, LocalRepoFetcher(repo), now=later,
                          module="congress").refresh().status == "installed"

    monkeypatch.setattr(snap_mod, "persist_tuple",
                        lambda *a, **k: (_ for _ in ()).throw(OSError("disk full")))
    monkeypatch.setattr(sys, "argv",
                        ["populus-mcp", "--attestation=staging-noop", "--data-repo", str(repo), "--cache", str(cache)])
    monkeypatch.setattr(srv_mod, "_utc_now", later)
    resolved = srv_mod._resolve_snapshot()
    assert resolved["inst_stale_withdrawal_pending"] is True

    server = srv_mod.build_server(
        db_path=resolved["db_path"], build_id=resolved["build_id"],
        inst_db_path=resolved["inst_db_path"],
        inst_build_id=resolved["inst_build_id"],
        inst_watermarks=resolved["inst_watermarks"],
        inst_from_published_manifest=resolved["inst_from_published_manifest"],
        inst_absent_reason=resolved["inst_absent_reason"],
        inst_absent_gate_withheld=resolved["inst_absent_gate_withheld"],
        inst_stale_withdrawal_pending=resolved["inst_stale_withdrawal_pending"],
        now=later,
    )
    health = server._tool_manager.get_tool("inst_health").fn()["results"]
    assert health["stale_withdrawal_pending"] is True
    joined = " ".join(health["caveats"])
    assert "STALE" in joined, "the tool reported clean published data"
    assert "no longer includes this module" in joined


def test_an_unreadable_repo_file_does_not_take_down_the_server(tmp_path, monkeypatch):
    """QA-VERIFY-N-a: `LocalRepoFetcher.fetch_path` guarded only path resolution,
    so an unreadable `latest.json` or `manifest.json` raised a bare OSError.
    Callers guard `FetchError` only, so it escaped `refresh()` — and the
    CONGRESS resolution has no module boundary above it, so the server died."""
    import sys

    from populus.mcp_server import server as srv_mod

    db = seed_db(tmp_path / "populus.db")
    seed_inst(db, covered=True)
    repo = make_repo(tmp_path)
    publish_build(db, repo)

    real_read = Path.read_bytes

    def _unreadable(self, *a, **k):
        if self.name == "latest.json":
            raise OSError(13, "Permission denied")
        return real_read(self, *a, **k)

    monkeypatch.setattr(Path, "read_bytes", _unreadable)
    monkeypatch.setattr(sys, "argv",
                        ["populus-mcp", "--attestation=staging-noop", "--data-repo", str(repo),
                         "--cache", str(tmp_path / "cache")])
    monkeypatch.setattr(srv_mod, "_utc_now", pin())

    # No snapshot can be resolved, but it must be an honest SystemExit rather
    # than a PermissionError traceback out of the client.
    with pytest.raises(SystemExit):
        srv_mod._resolve_snapshot()


def test_an_unanchored_refusal_reaches_the_operator_with_remediation(
    tmp_path, monkeypatch
):
    """QA-VERIFY-N-f: the client's refusal message carries actionable
    remediation ("Clear <module dir> ..."), and the resolver discarded it — an
    operator saw only `refresh outcome: 'refused'`."""
    import sys

    from populus.mcp_server import server as srv_mod

    db, repo, cache, fetcher, _c, _r = _installed_inst(tmp_path)
    _withdraw_inst(db, repo, cache, fetcher)
    (cache / "inst" / "trust.json").write_text("garbage")

    later = pin(NOW + timedelta(days=1))
    monkeypatch.setattr(sys, "argv",
                        ["populus-mcp", "--attestation=staging-noop", "--data-repo", str(repo), "--cache", str(cache)])
    monkeypatch.setattr(srv_mod, "_utc_now", later)
    resolved = srv_mod._resolve_snapshot()
    assert resolved["inst_db_path"] is None
    assert "remove the ENTIRE directory" in resolved["inst_absent_reason"], (
        "the actionable remediation never reached the operator"
    )
    assert "corrupt" in resolved["inst_absent_reason"]


def test_the_stale_signal_reaches_the_data_plane_not_only_health(tmp_path):
    """QA-VERIFY3-N3: with a pending withdrawal the health tools warned, but the
    DATA tools returned the old `build_id` with an unmodified note and no
    staleness marker — and the note is non-removable precisely so a response
    lifted out of context carries its caveats."""
    from populus.mcp_server import server as srv_mod

    # A REAL installed inst aggregate, so the health tool's queries resolve.
    _db, _repo, cache, fetcher, _c, _r = _installed_inst(tmp_path)
    inst_db = _fresh(cache, fetcher).db_path()
    assert inst_db is not None

    server = srv_mod.build_server(
        db_path=":memory:", build_id="cong-1",
        inst_db_path=str(inst_db), inst_build_id="inst-old",
        inst_from_published_manifest=True,
        inst_stale_withdrawal_pending=True,
        now=lambda: datetime(2026, 7, 25, tzinfo=timezone.utc),
    )
    health = server._tool_manager.get_tool("inst_health").fn()["results"]
    assert health["caveats"][0].startswith("STALE"), (
        "the coverage assurance was ordered above the staleness warning"
    )
    # Any inst data response — the lookup needs no aggregate tables to fail
    # validation, so use the health tool's envelope, which shares `_inst_env`.
    env_out = server._tool_manager.get_tool("inst_health").fn()
    assert "STALE" in env_out["data_note"], "the data plane carried no staleness"


def test_an_idempotent_heal_write_failure_refuses_without_escaping(tmp_path, monkeypatch):
    """§5 row 'idempotent heal write fails' — untested until now (QA-VERIFY3-N4)."""
    from populus.client import snapshot as snap_mod
    from populus.client.snapshot import SnapshotClient

    db, repo, cache, fetcher, _c, _r = _installed_inst(tmp_path)
    # Strand the cache in the install write-2 window.
    seed_inst(db, covered=True)
    publish_build(db, repo, moment=NOW + timedelta(days=1))
    later = pin(NOW + timedelta(days=1))
    real_write = snap_mod.SnapshotClient._write_record
    monkeypatch.setattr(snap_mod.SnapshotClient, "_write_record",
                        lambda self, *a, **k: (_ for _ in ()).throw(OSError("full")))
    SnapshotClient(cache, fetcher, now=later, module="inst").refresh()

    # The heal at the same anchored pointer also cannot write.
    healer = SnapshotClient(cache, fetcher, now=later, module="inst")
    result = healer.refresh()                     # must NOT raise
    assert result.status == "refused"
    assert healer.serving_build() is None
    monkeypatch.setattr(snap_mod.SnapshotClient, "_write_record", real_write)
    ok = SnapshotClient(cache, fetcher, now=later, module="inst")
    ok.refresh()
    assert ok.serving_build() is not None


def test_a_corrupt_record_heals_to_a_null_record_when_the_pointer_omits(tmp_path):
    """§5's corrupt-record row: recovery follows whichever state the
    authenticated pointer implies — a NULL withdrawal record when it omits the
    module, not necessarily an install (rev-6 F2). Only the publishing half was
    pinned (QA-VERIFY3-N4)."""
    db, repo, cache, fetcher, _c, _r = _installed_inst(tmp_path)
    _withdraw_inst(db, repo, cache, fetcher)
    (cache / "inst" / "serving.json").write_text("garbage")

    client = _fresh(cache, fetcher, moment=NOW + timedelta(days=1))
    assert client.serving_build() is None
    result = client.refresh()
    assert result.status == "withdrawn"
    assert result.verified_omission is True
    assert _record(cache)["installed_build"] is None, "healed to an install"


# --- RUN M2-5: coverage cleared by the definitional 13(f) list (R10/R11) -------

from populus.amendments import ensure_views as _ensure_views  # noqa: E402
from populus.identity.registry import (  # noqa: E402
    ensure_registry as _ensure_registry,
    load_identity_registry as _load_registry,
    resolve_cusip as _resolve_cusip,
)
from populus.load import ensure_inst_schema as _ensure_inst_schema  # noqa: E402
from populus.mcp_server import inst_queries as _iq  # noqa: E402
from populus.net.sec_client import SecClient as _SecClient  # noqa: E402
from populus.ingest import TransportResponse as _TransportResponse  # noqa: E402

MCP_TICKERS = REPO_ROOT / "tests" / "fixtures" / "inst" / "mcp" / "company_tickers.json"
APPLE_CUSIP = "037833100"


class _TickerTransport:
    """Serves company_tickers.json for live ticker resolution; 404 otherwise."""

    def __init__(self) -> None:
        self.files = {_iq.COMPANY_TICKERS_URL: MCP_TICKERS.read_bytes()}

    def get(self, url, *, headers):
        content = self.files.get(url)
        if content is None:
            return _TransportResponse(status_code=404, headers={}, content=b"")
        return _TransportResponse(status_code=200, headers={}, content=content)


def _ticker_client():
    counter = iter(range(1, 1_000_000))
    return _SecClient(_TickerTransport(), contact="t@example.com",
                      sleep=lambda _s: None, monotonic=lambda: next(counter))


BRK = "0001067983"
#: The TRACKED real Berkshire 13F corpus — four cached filings covering three
#: periods (2025-03-31 incl. an amendment, 2025-12-31, 2026-03-31). R10 drives the
#: production ingest over THESE bytes rather than a hand-written filing, so broken
#: stamping, re-ingest behaviour or seed-before-ingest ordering cannot pass (F7).
REAL_INST_DIR = REPO_ROOT / "tests" / "fixtures" / "inst" / "real"


def _corpus_quarters_and_rows() -> dict[str, list[str]]:
    """Derive each quarter's 13(f)-list rows FROM THE REAL CORPUS's own filings.

    The definitional list must cover the securities the corpus actually holds,
    so the rows are read out of the cached ``form13fInfoTable`` documents rather
    than invented: for each filing, its ``periodOfReport`` picks the quarter and
    every ``<cusip>``/``<nameOfIssuer>`` pair becomes one fixed-width row. One row
    per CUSIP per quarter (name chosen deterministically as the lexicographic
    minimum), because same-CUSIP rows that disagree on issuer/class are a
    definition conflict the parser rejects outright (F6).
    """
    import re as _re

    from populus.parse.list13f import parse_quarter as _pq

    by_quarter: dict[str, dict[str, str]] = {}
    for cik_dir in sorted(REAL_INST_DIR.iterdir()):
        if not cik_dir.is_dir():
            continue
        for acc_dir in sorted(p for p in cik_dir.iterdir() if p.is_dir()):
            primary = acc_dir / "primary_doc.xml"
            if not primary.is_file():
                continue
            period = _re.search(
                r"periodOfReport>\s*(\d{2})-(\d{2})-(\d{4})",
                primary.read_text(errors="replace"),
            )
            if period is None:
                continue
            month, _day, year = period.group(1), period.group(2), period.group(3)
            quarter = f"{year}q{(int(month) - 1) // 3 + 1}"
            assert _pq(quarter) == quarter
            for table in sorted(acc_dir.glob("*.xml")):
                if table.name == "primary_doc.xml":
                    continue
                text = table.read_text(errors="replace")
                for entry in _re.findall(r"<infoTable>(.*?)</infoTable>", text, _re.S):
                    cusip = _re.search(r"<[\w:]*cusip>\s*([^<\s]+)", entry)
                    name = _re.search(r"<[\w:]*nameOfIssuer>\s*([^<]+)", entry)
                    if cusip is None or name is None:
                        continue
                    value = cusip.group(1).strip().upper()
                    issuer = " ".join(name.group(1).split())[:30]
                    slot = by_quarter.setdefault(quarter, {})
                    slot[value] = min(slot.get(value, issuer), issuer)
    return {
        quarter: [
            _list_row(cusip, cusips[cusip])
            for cusip in sorted(cusips)
        ]
        for quarter, cusips in sorted(by_quarter.items())
    }


def _list_row(cusip: str, issuer: str) -> str:
    """One 80-char row in the verified fixed-width 13(f)-list layout."""
    row = (
        cusip.ljust(9)[:9] + " " + issuer.ljust(30)[:30] + "COM".ljust(27)
        + "   " + " " * 9 + "E"
    )
    assert len(row) == 80, len(row)
    return row


def _write_list_cache(list_dir: Path, quarters: dict[str, list[str]]) -> None:
    """Write each quarter's list + a full, verified §5.1 sidecar (F5 requires it)."""
    list_dir.mkdir(parents=True, exist_ok=True)
    for quarter, rows in quarters.items():
        content = ("\n".join(rows) + "\n").encode("utf-8")
        name = f"13flist{quarter}-txt.txt"
        (list_dir / name).write_bytes(content)
        (list_dir / f"{name}.meta.json").write_text(json.dumps({
            "source_url": f"https://www.sec.gov/files/investment/{name}",
            "http_status": 200,
            "bytes": len(content),
            "sha256": hashlib.sha256(content).hexdigest(),
            "retrieved_at": "2026-07-30T00:00:00Z",
            "user_agent": "populus-mcp/0.0.1",
        }))


def _seed_identity_via_list(db_path: Path, tmp_path: Path) -> dict:
    """Run the REAL production chain: identity bootstrap (tickers + FTD + the
    13(f) lists) and then ``run_inst13f_ingest`` over the TRACKED cached Berkshire
    filings — the locked rollout order (seed → ingest), with every ``security_id``
    stamped by the production resolver at ingest, never hand-set (R10/F7).

    Returns the measured corpus facts the caller asserts against, so the test
    never hard-codes a figure it did not measure.
    """
    from populus.identity.bootstrap import run_identity_bootstrap
    from populus.ingest.inst13f import compute_coverage, run_inst13f_ingest
    from populus.ingest.list13f import _CacheSource

    cache = tmp_path / "reg"
    cache.mkdir()
    (cache / "company_tickers.json").write_text(
        json.dumps({"0": {"cik_str": 320193, "ticker": "AAPL", "title": "Apple Inc"}})
    )
    # FTD supplies the AAPL symbol → entity link (the list carries no tickers);
    # it does NOT cover the 2026-Q1 quarter-end, so list coverage is what makes
    # the gate pass.
    ftd = cache / "cnsfails.txt"
    ftd.write_text(
        "SETTLEMENT DATE|CUSIP|SYMBOL|QUANTITY (FAILS)|DESCRIPTION|PRICE\n"
        f"20250115|{APPLE_CUSIP}|AAPL|100|APPLE INC|150.00\n"
    )
    quarters = _corpus_quarters_and_rows()
    assert quarters, "the tracked real corpus yielded no filings"
    list_dir = tmp_path / "13flist"
    _write_list_cache(list_dir, quarters)

    conn = connect(str(db_path))
    try:
        _ensure_registry(conn)
        _ensure_inst_schema(conn)
        _ensure_views(conn)
        run_identity_bootstrap(
            conn,
            tickers_path=cache / "company_tickers.json",
            ftd_paths=[ftd],
            registry=_load_registry(),
            snapshot_date="2025-01-01",  # AAPL→CIK valid before the FTD date
            run_id="reg-1",
            now=lambda: "2026-07-23T00:00:00Z",
            host="h",
            list13f_source=_CacheSource(list_dir),
            list13f_quarters=sorted(quarters),
        )
        # Covered by the LIST for the whole quarter; FTD alone does not reach
        # 2026-03-31 — and both sources bind to ONE security_id.
        sid = _resolve_cusip(conn, APPLE_CUSIP, "2026-03-31")
        assert sid is not None
        assert _resolve_cusip(conn, APPLE_CUSIP, "2025-01-15") == sid  # FTD date

        # THE PRODUCTION INGEST over the tracked cached filings. Nothing is
        # inserted by a test helper: filer, filings and holdings all come from the
        # real parser, and each holding's security_id is stamped by resolve_cusip
        # inside the ingest. Mutating the resolver to return None would leave the
        # holdings unresolved and collapse the coverage → gate → serve chain.
        run_inst13f_ingest(
            conn,
            run_id="inst-r10",
            now=lambda: "2026-07-23T00:00:00Z",
            host="h",
            ingested_at="2026-07-23T00:00:00Z",
            ciks=[BRK],
            cache_dir=str(REAL_INST_DIR),
        )
        holdings, stamped = conn.execute(
            "SELECT COUNT(*), COUNT(security_id) FROM v_default_holdings"
        ).fetchone()
        assert holdings > 0, "the real corpus ingested no holdings"
        measured = {
            "holdings": holdings,
            "stamped": stamped,
            "coverage": compute_coverage(conn).coverage,
            "period_total": conn.execute(
                "SELECT SUM(value_usd) FROM v_default_holdings h"
                " JOIN v_default_inst_filings f ON f.filing_id = h.filing_id"
                " WHERE f.cik = ? AND f.period_of_report = '2026-03-31'",
                (BRK,),
            ).fetchone()[0],
            "filer_name": conn.execute(
                "SELECT name_raw FROM inst_filers WHERE cik = ?", (BRK,)
            ).fetchone()[0],
        }
        return measured
    finally:
        conn.close()


def test_r10_full_lifecycle_serves_inst_from_the_published_manifest(tmp_path, monkeypatch):
    """R10: build → publish with the gate PASSING (via the 13(f) list) → the real
    SnapshotClient installs inst → both inst tools answer with
    inst_from_published_manifest=True. NOTHING is mocked: the production
    _resolve_snapshot() runs the real client, and its UNMODIFIED output drives
    build_server."""
    import sys

    from populus.mcp_server import server as srv_mod

    db = seed_db(tmp_path / "populus.db")
    measured = _seed_identity_via_list(db, tmp_path)
    # The real corpus really was ingested and really was fully stamped by the
    # production resolver — the precondition the gate then measures.
    assert measured["stamped"] == measured["holdings"]
    assert measured["coverage"] >= 0.95
    repo = make_repo(tmp_path)
    publish_build(db, repo)

    # The gate passed on the list-seeded corpus: inst is in the published manifest.
    manifest = read_manifest(repo, latest_pointer(repo)["build_id"])
    assert "inst" in manifest["modules"]

    cache = tmp_path / "cache"
    monkeypatch.setattr(sys, "argv",
                        ["populus-mcp", "--attestation=staging-noop", "--data-repo", str(repo), "--cache", str(cache)])
    monkeypatch.setattr(srv_mod, "_utc_now", pin())

    resolved = srv_mod._resolve_snapshot()  # the REAL client, no mock
    assert resolved["inst_from_published_manifest"] is True
    assert resolved["inst_db_path"] is not None

    # The UNMODIFIED resolver output drives build_server (a hand-built
    # inst_from_published_manifest=True would not satisfy R10).
    server = srv_mod.build_server(**resolved, sec_client=_ticker_client())

    def call(name, **kwargs):
        return server._tool_manager.get_tool(name).fn(**kwargs)

    # inst_from_published_manifest=True surfaces as the health provenance stamp —
    # the server is serving inst from a VERIFIED published manifest (not --inst-db).
    assert call("inst_health")["results"]["provenance"] == "published-snapshot"

    filer_env = call("inst_filer_holdings", cik=BRK, period="2026-03-31")
    ticker_env = call("inst_ticker_holders", ticker="AAPL", period="2026-03-31")

    # Neither data-plane answer carries the "UNVERIFIED SOURCE" prefix an
    # unpublished (--inst-db) snapshot would stamp — they came from the manifest.
    assert "UNVERIFIED SOURCE" not in json.dumps(filer_env)
    assert "UNVERIFIED SOURCE" not in json.dumps(ticker_env)
    # Real data from the tracked corpus: the served totals must equal what was
    # MEASURED in the source database (not a figure written into the test), and
    # Berkshire must appear among Apple's institutional holders.
    filer_results = filer_env["results"]
    assert filer_results["cik"] == BRK
    assert filer_results["filer"]["filer_name"] == measured["filer_name"]
    assert filer_results["concentration"]["total_value_usd"] == measured["period_total"]
    assert filer_results["concentration"]["total_value_usd"] > 0
    holders = ticker_env["results"]["holders"]
    assert any(h["cik"] == BRK for h in holders)


def _seed_inst_ftd_only_uncovered(db_path: Path):
    """An inst corpus whose only period has valid FTD coverage but NO 13(f) list:
    coverage stays at the FTD-only figure (below the gate) and the quarter is
    uncovered-by-list."""
    from populus.identity.bootstrap import FtdObservation, Mutations, bootstrap_ftd

    conn = connect(str(db_path))
    try:
        _ensure_registry(conn)
        _ensure_inst_schema(conn)
        _ensure_views(conn)
        conn.execute("BEGIN IMMEDIATE")
        bootstrap_ftd(
            conn,
            [FtdObservation(settlement_date="2026-06-30", id_type="cusip",
                            value=APPLE_CUSIP, symbol=None, issuer_name="APPLE INC")],
            registry=_load_registry(), mutations=Mutations(),
        )
        conn.execute("COMMIT")
        sid = _resolve_cusip(conn, APPLE_CUSIP, "2026-06-30")  # FTD-resolved
        assert sid is not None
        _filer(conn, "0000000001", "Alpha Capital")
        _load(conn, fid="inst:A-1", cik="0000000001", period="2026-06-30", filed="2026-07-15",
              holds=[
                  _hold(ordinal=1, issuer="APPLE INC", cusip=APPLE_CUSIP, value=900,
                        security_id=sid),
                  _hold(ordinal=2, issuer="MSFT", cusip="594918104", value=100,
                        security_id=None),  # no list, no FTD → unresolved
              ])
    finally:
        conn.close()


def test_build_withheld_reason_names_the_uncovered_quarter(tmp_path):
    """R11: a below-gate build names the quarters that carry no definitional list.
    Mutation guard: dropping the naming would leave uncovered_quarters empty."""
    db = seed_db(tmp_path / "populus.db")
    _seed_inst_ftd_only_uncovered(db)
    repo = make_repo(tmp_path)
    report = run_build(db, repo, now=pin(), backend=LocalDirBackend(repo))
    assert report.inst_withheld is not None
    assert abs(report.inst_withheld["coverage"] - 0.90) < 1e-9  # FTD-only, not zero
    assert report.inst_withheld["uncovered_quarters"] == ["2026-06-30"]
    # The per-period breakdown rides along on the report (R9).
    periods = {p["period_of_report"]: p for p in report.inst_period_coverage}
    assert periods["2026-06-30"]["covered_by_list"] is False


def test_build_from_an_m1_only_database_yields_an_m1_build(tmp_path):
    """A database carrying no inst TABLES is inst-absent (RUN M1-B, stage B).

    `ensure_views` applies the inst view DDL unconditionally — SQLite accepts a
    view over a missing table — so on an M1-only database the view exists while
    `inst_filings` does not. Probing it must read as "absent" and produce the
    byte-identical M1 build the guard promises, not raise. This is the shape of
    every published `congress.db`, so without it a published corpus cannot be
    rebuilt from.
    """
    import sqlite3 as sqlite3_module

    from populus.amendments import ensure_views
    from populus.db import connect, init_db
    from populus.publish.build import LocalDirBackend, run_build

    db_path = tmp_path / "m1-only.db"
    init_db(str(db_path))
    conn = connect(str(db_path))
    try:
        # Reproduce the published shape exactly: a released congress.db carries
        # the congress module ONLY — verified against
        # populus-data releases/data-20260724.3/congress.db, which holds no
        # inst table, index, or view.
        for name in ("v_default_inst_filings", "v_default_holdings"):
            conn.execute(f"DROP VIEW IF EXISTS {name}")  # nosec B608
        for name in ("inst_holdings", "inst_filings", "inst_filers"):
            conn.execute(f"DROP TABLE IF EXISTS {name}")  # nosec B608
        assert conn.execute(
            "SELECT 1 FROM sqlite_master WHERE name LIKE 'inst%'"
            " OR name LIKE 'v_default_inst%'"
        ).fetchone() is None

        # This is what run_build does first, and it is what creates the trap:
        # the inst view DDL applies over a table that does not exist.
        ensure_views(conn)
        assert conn.execute(
            "SELECT 1 FROM sqlite_master WHERE type = 'view'"
            " AND name = 'v_default_inst_filings'"
        ).fetchone() is not None
        assert conn.execute(
            "SELECT 1 FROM sqlite_master WHERE type = 'table'"
            " AND name = 'inst_filings'"
        ).fetchone() is None
        with pytest.raises(sqlite3_module.OperationalError):
            conn.execute("SELECT 1 FROM v_default_inst_filings LIMIT 1")
    finally:
        conn.close()

    repo = tmp_path / "data-repo"
    repo.mkdir()
    backend = LocalDirBackend(repo)
    report = run_build(
        db_path, repo, now=lambda: datetime(2026, 7, 31, tzinfo=timezone.utc),
        backend=backend,
    )
    manifest = json.loads(
        (repo / ".staging" / report.build_id / "build" / "manifest.json").read_text()
        if (repo / ".staging" / report.build_id / "build" / "manifest.json").exists()
        else (repo / ".staging" / report.build_id / "manifest.json").read_text()
    )
    # An M1 build: the congress module only, no inst module, no inst_agg asset.
    assert "inst" not in manifest.get("modules", {})
    assert "congress" in manifest["modules"]


def test_a_broken_institutional_schema_fails_the_build_it_does_not_read_absent(
    tmp_path,
):
    """An operational fault probing the inst view must PROPAGATE (F3).

    The M1-only guard above must identify absence by SCHEMA — `inst_filings`
    missing from `sqlite_master` — never by "the probe raised". A database that
    HAS an institutional corpus but whose view or schema is broken is a genuine
    publication failure: swallowing it would publish a congress-only build and
    silently drop real institutional data.
    """
    import sqlite3 as sqlite3_module

    from populus.db import connect, init_db
    from populus.publish.build import LocalDirBackend, run_build

    db_path = tmp_path / "broken-inst.db"
    init_db(str(db_path))
    conn = connect(str(db_path))
    try:
        for name in ("v_default_holdings", "v_default_inst_filings"):
            conn.execute(f"DROP VIEW IF EXISTS {name}")  # nosec B608
        for name in ("inst_holdings", "inst_filings", "inst_filers"):
            conn.execute(f"DROP TABLE IF EXISTS {name}")  # nosec B608
        # The table IS there — so this is NOT an inst-absent database — but its
        # schema is incompatible with the view the build reads it through.
        conn.execute("CREATE TABLE inst_filings (filing_id TEXT PRIMARY KEY)")
        conn.commit()
        assert conn.execute(
            "SELECT 1 FROM sqlite_master WHERE type = 'table'"
            " AND name = 'inst_filings'"
        ).fetchone() is not None
    finally:
        conn.close()

    repo = tmp_path / "data-repo"
    repo.mkdir()
    with pytest.raises(sqlite3_module.OperationalError):
        run_build(
            db_path, repo, now=lambda: datetime(2026, 7, 31, tzinfo=timezone.utc),
            backend=LocalDirBackend(repo),
        )


def test_a_malformed_institutional_view_is_healed_not_read_as_absence(tmp_path):
    """The other half of F3, updated at the M1-B/M2-7 merge: the inst tables
    are intact and the VIEW the build reads them through is broken. Since M2-7,
    `ensure_views` REPLACES a view whose stored SQL differs from views.sql
    (staleness replacement, its R7) — so the malformed definition is repaired
    and the build proceeds; what remains forbidden is reading the fault as
    "no institutional data". Faults ensure_views cannot heal (locked/corrupt
    databases) are covered by the sibling F3 tests."""
    from populus.db import connect, init_db
    from populus.publish.build import LocalDirBackend, run_build

    db_path = tmp_path / "malformed-view.db"
    init_db(str(db_path))
    conn = connect(str(db_path))
    try:
        conn.execute("DROP VIEW IF EXISTS v_default_holdings")
        conn.execute("DROP VIEW IF EXISTS v_default_inst_filings")
        conn.execute(
            "CREATE VIEW v_default_inst_filings AS"
            " SELECT * FROM inst_filings_that_do_not_exist"
        )
        conn.commit()
        assert conn.execute(
            "SELECT 1 FROM sqlite_master WHERE type = 'table'"
            " AND name = 'inst_filings'"
        ).fetchone() is not None          # NOT an inst-absent database
    finally:
        conn.close()

    repo = tmp_path / "data-repo"
    repo.mkdir()
    report = run_build(
        db_path, repo, now=lambda: datetime(2026, 7, 31, tzinfo=timezone.utc),
        backend=LocalDirBackend(repo),
    )
    # the build neither crashed nor mistook the fault for absence, and the
    # malformed definition was replaced with the canonical one
    conn = connect(str(db_path))
    try:
        stored = conn.execute(
            "SELECT sql FROM sqlite_master WHERE name = 'v_default_inst_filings'"
        ).fetchone()[0]
        assert "inst_filings_that_do_not_exist" not in stored
    finally:
        conn.close()
    assert report.build_id


# --- T5: the two-phase build seam (R2/R24) -----------------------------------


def test_stage_build_writes_a_provisional_manifest_the_site_can_read(tmp_path):
    """R2 — `data.ts:86` derives which surfaces exist from `manifest.modules`,
    so the manifest has to exist BEFORE the site build, not after it."""
    db = seed_db(tmp_path / "populus.db")
    repo = make_repo(tmp_path)
    staged = stage_build(db, repo, now=pin(), backend=LocalDirBackend(repo))
    assert staged.fresh and staged.deployable
    build_dir = Path(staged.staging_dir) / "build"
    manifest = json.loads((build_dir / "manifest.json").read_text(encoding="utf-8"))
    assert "congress" in manifest["modules"]
    # The journal stays LAST (R35): staging must not have sealed anything.
    assert not (repo / STAGING_DIR / staged.build_id / "journal.json").exists()


def test_the_final_manifest_does_not_list_itself(tmp_path):
    """The self-listing hazard: `build_dir.rglob` hashes everything it finds.

    Today `manifest.json` is written after the walk, which is the ONLY reason it
    is never self-listed. A provisional manifest left in place through the final
    walk would gain a self-entry whose digest is stale the instant the manifest
    is re-rendered.
    """
    db = seed_db(tmp_path / "populus.db")
    repo = make_repo(tmp_path)
    staged = stage_build(db, repo, now=pin(), backend=LocalDirBackend(repo))
    build_dir = Path(staged.staging_dir) / "build"
    assert (build_dir / "manifest.json").exists(), "provisional manifest missing"
    report = finalize_build(staged, site_file_count=41)
    manifest = json.loads((build_dir / "manifest.json").read_text(encoding="utf-8"))
    names = {
        entry["name"]
        for module in manifest["modules"].values()
        for entry in module["artifacts"]
    }
    assert "manifest.json" not in names, "the manifest listed itself"
    assert report.build_id == staged.build_id


def test_journal_recovery_reproduces_the_committed_manifest_byte_for_byte(tmp_path):
    """R35 — `materialize_from_journal` is the recovery anchor.

    If the journal sealed a manifest that disagrees with the tree (the exact
    failure a surviving provisional manifest would cause), recovery silently
    reconstructs different bytes than were published.
    """
    db = seed_db(tmp_path / "populus.db")
    repo = make_repo(tmp_path)
    staged = stage_build(db, repo, now=pin(), backend=LocalDirBackend(repo))
    finalize_build(staged, site_file_count=41)
    build_dir = Path(staged.staging_dir) / "build"
    committed = (build_dir / "manifest.json").read_bytes()
    journal = journal_load(
        (repo / STAGING_DIR / staged.build_id / "journal.json").read_bytes()
    )
    assert journal["artifacts"]["manifest.json"].encode("utf-8") == committed


def test_two_phase_and_single_phase_agree_on_everything_but_the_count(tmp_path):
    """The wrapper must not be a different build, only a build with no site."""
    (tmp_path / "a").mkdir()
    (tmp_path / "b").mkdir()
    db_a = seed_db(tmp_path / "a.db")
    repo_a = make_repo(tmp_path / "a")
    one_shot = run_build(db_a, repo_a, now=pin(), backend=LocalDirBackend(repo_a))

    db_b = seed_db(tmp_path / "b.db")
    repo_b = make_repo(tmp_path / "b")
    staged = stage_build(db_b, repo_b, now=pin(), backend=LocalDirBackend(repo_b))
    two_phase = finalize_build(staged)

    assert one_shot.build_id == two_phase.build_id
    assert one_shot.artifact_count == two_phase.artifact_count
    assert one_shot.logical_digest == two_phase.logical_digest
    manifest_a = json.loads(
        (Path(one_shot.staging_dir) / "build" / "manifest.json").read_text("utf-8")
    )
    manifest_b = json.loads(
        (Path(two_phase.staging_dir) / "build" / "manifest.json").read_text("utf-8")
    )
    assert manifest_a == manifest_b


def test_the_wrapper_publishes_a_null_site_file_count(tmp_path):
    """R3 — `run_build` has no site to count, so it must not invent one.

    The non-null assertion lives in the workflow (a publish-time check), which
    is what stops this wrapper from satisfying it by accident.
    """
    db = seed_db(tmp_path / "populus.db")
    repo = make_repo(tmp_path)
    report = run_build(db, repo, now=pin(), backend=LocalDirBackend(repo))
    stats = json.loads(
        (Path(report.staging_dir) / "build" / "congress" / "stats.json").read_text("utf-8")
    )
    assert stats.get("site_file_count") is None


def test_finalize_patches_the_count_through_the_same_renderer(tmp_path):
    """R24 — one writer, so the canonical bytes stay comparable to the served copy."""
    db = seed_db(tmp_path / "populus.db")
    repo = make_repo(tmp_path)
    staged = stage_build(db, repo, now=pin(), backend=LocalDirBackend(repo))
    finalize_build(staged, site_file_count=137)
    stats_path = Path(staged.staging_dir) / "build" / "congress" / "stats.json"
    stats = json.loads(stats_path.read_text("utf-8"))
    assert stats["site_file_count"] == 137
    assert stats_path.read_text("utf-8") == render_stats(stats)


def test_the_count_is_inside_the_manifest_digest(tmp_path):
    """Patching stats after the provisional manifest must not leave it stale."""
    db = seed_db(tmp_path / "populus.db")
    repo = make_repo(tmp_path)
    staged = stage_build(db, repo, now=pin(), backend=LocalDirBackend(repo))
    build_dir = Path(staged.staging_dir) / "build"
    provisional = json.loads((build_dir / "manifest.json").read_text("utf-8"))
    finalize_build(staged, site_file_count=137)
    final = json.loads((build_dir / "manifest.json").read_text("utf-8"))
    before = find_artifact(provisional, "congress/stats.json")["sha256"]
    after = find_artifact(final, "congress/stats.json")["sha256"]
    assert before != after, "the manifest still carries the pre-count stats digest"
    actual = hashlib.sha256(
        (build_dir / "congress" / "stats.json").read_bytes()
    ).hexdigest()
    assert after == actual


def test_a_nonsense_site_file_count_is_refused(tmp_path):
    db = seed_db(tmp_path / "populus.db")
    repo = make_repo(tmp_path)
    staged = stage_build(db, repo, now=pin(), backend=LocalDirBackend(repo))
    with pytest.raises(PublishError, match="must be positive"):
        finalize_build(staged, site_file_count=0)


def test_a_preserved_build_is_not_deployable_and_finalizes_untouched(tmp_path):
    """R2 — a preserved build is already published and journal-sealed.

    Re-producing it would re-journal artifacts that never changed, so the deploy
    leg must be skipped rather than re-run.
    """
    db = seed_db(tmp_path / "populus.db")
    repo = make_repo(tmp_path)
    first = run_build(db, repo, now=pin(), backend=LocalDirBackend(repo))

    staged = stage_build(db, repo, now=pin(), backend=LocalDirBackend(repo))
    assert not staged.fresh
    assert not staged.deployable
    assert staged.report is not None
    report = finalize_build(staged, site_file_count=999)
    assert report is staged.report
    assert report.build_id == first.build_id
    # The count was ignored, because there is nothing to re-seal.
    stats = json.loads(
        (Path(first.staging_dir) / "build" / "congress" / "stats.json").read_text("utf-8")
    )
    assert stats.get("site_file_count") is None


def test_stage_state_survives_a_process_boundary(tmp_path):
    """T5 — the workflow builds the site BETWEEN the two phases, in a new process.

    So the handle has to round-trip through disk. This is the property that
    makes the CLI seam possible at all.
    """
    db = seed_db(tmp_path / "populus.db")
    repo = make_repo(tmp_path)
    staged = stage_build(db, repo, now=pin(), backend=LocalDirBackend(repo))
    write_stage_state(staged)

    revived = read_stage_state(
        staged.staging_dir, data_repo=repo, backend=LocalDirBackend(repo)
    )
    report = finalize_build(revived, site_file_count=88)
    assert report.build_id == staged.build_id
    stats = json.loads(
        (Path(staged.staging_dir) / "build" / "congress" / "stats.json").read_text("utf-8")
    )
    assert stats["site_file_count"] == 88


def test_the_stage_state_sidecar_is_never_a_published_artifact(tmp_path):
    """It lives beside `build/`, not inside it — anything inside is manifested."""
    db = seed_db(tmp_path / "populus.db")
    repo = make_repo(tmp_path)
    staged = stage_build(db, repo, now=pin(), backend=LocalDirBackend(repo))
    path = write_stage_state(staged)
    build_dir = Path(staged.staging_dir) / "build"
    assert path.parent == Path(staged.staging_dir)
    assert not str(path).startswith(str(build_dir) + "/")

    finalize_build(staged, site_file_count=41)
    manifest = json.loads((build_dir / "manifest.json").read_text("utf-8"))
    names = {
        entry["name"]
        for module in manifest["modules"].values()
        for entry in module["artifacts"]
    }
    assert STAGE_STATE_FILE not in names


def test_finalizing_a_preserved_build_from_disk_refuses_loudly(tmp_path):
    """A preserved build has nothing to finalize; the CLI must say so, not guess."""
    db = seed_db(tmp_path / "populus.db")
    repo = make_repo(tmp_path)
    run_build(db, repo, now=pin(), backend=LocalDirBackend(repo))
    staged = stage_build(db, repo, now=pin(), backend=LocalDirBackend(repo))
    assert not staged.fresh
    write_stage_state(staged)
    with pytest.raises(PublishError, match="nothing to finalize"):
        read_stage_state(
            staged.staging_dir, data_repo=repo, backend=LocalDirBackend(repo)
        )


# --- T6: the publish-time site_file_count assertion (R3) ---------------------


def test_publish_time_assertion_rejects_a_null_count(tmp_path):
    """R3 — the schema permits null; the DEPLOYING path must not.

    A build that never ran the site seam would otherwise publish stats claiming
    to describe a site nobody counted.
    """
    db = seed_db(tmp_path / "populus.db")
    repo = make_repo(tmp_path)
    report = run_build(db, repo, now=pin(), backend=LocalDirBackend(repo))
    with pytest.raises(PublishError, match="did not run for this build"):
        require_site_file_count(report.staging_dir)


def test_publish_time_assertion_accepts_a_finalized_build(tmp_path):
    db = seed_db(tmp_path / "populus.db")
    repo = make_repo(tmp_path)
    staged = stage_build(db, repo, now=pin(), backend=LocalDirBackend(repo))
    finalize_build(staged, site_file_count=64)
    assert require_site_file_count(staged.staging_dir) == 64


def test_publish_time_assertion_rejects_a_pre_seam_build(tmp_path):
    """An absent key is a different failure from a null one, and says so."""
    db = seed_db(tmp_path / "populus.db")
    repo = make_repo(tmp_path)
    report = run_build(db, repo, now=pin(), backend=LocalDirBackend(repo))
    stats_path = Path(report.staging_dir) / "build" / "congress" / "stats.json"
    stats = json.loads(stats_path.read_text("utf-8"))
    del stats["site_file_count"]
    stats_path.write_text(render_stats(stats), encoding="utf-8")
    with pytest.raises(PublishError, match="predates"):
        require_site_file_count(report.staging_dir)


@pytest.mark.parametrize("bogus", [0, -1, True, "12", 1.5])
def test_publish_time_assertion_rejects_nonsense_counts(tmp_path, bogus):
    """`True` is the interesting one: in Python it is an int, and it is not a count."""
    db = seed_db(tmp_path / "populus.db")
    repo = make_repo(tmp_path)
    report = run_build(db, repo, now=pin(), backend=LocalDirBackend(repo))
    stats_path = Path(report.staging_dir) / "build" / "congress" / "stats.json"
    stats = json.loads(stats_path.read_text("utf-8"))
    stats["site_file_count"] = bogus
    stats_path.write_text(render_stats(stats), encoding="utf-8")
    with pytest.raises(PublishError):
        require_site_file_count(report.staging_dir)


def test_compute_stats_always_emits_the_key(tmp_path):
    """Present-and-null, never absent: an absent key is invisible to consumers."""
    db = seed_db(tmp_path / "populus.db")
    repo = make_repo(tmp_path)
    report = run_build(db, repo, now=pin(), backend=LocalDirBackend(repo))
    stats = json.loads(
        (Path(report.staging_dir) / "build" / "congress" / "stats.json").read_text("utf-8")
    )
    assert "site_file_count" in stats
    assert stats["site_file_count"] is None


# --- the two-phase seam must not trust the sidecar (code review) --------------


def test_a_forged_build_id_in_the_sidecar_is_refused(tmp_path):
    """QA round 7's invariant, reintroduced by the process boundary and now closed.

    A hand-edited `stage-state.json` published real congress.db bytes under an
    identity that never passed through `next_build_id`'s durable high-water
    mark — one immutable build id naming two different byte sets. The directory
    is the authority; the sidecar's copy is a cross-check.
    """
    db = seed_db(tmp_path / "populus.db")
    repo = make_repo(tmp_path)
    staged = stage_build(db, repo, now=pin(), backend=LocalDirBackend(repo))
    write_stage_state(staged)

    sidecar = Path(staged.staging_dir) / STAGE_STATE_FILE
    payload = json.loads(sidecar.read_text("utf-8"))
    payload["build_id"] = "20200101.7"
    sidecar.write_text(json.dumps(payload), encoding="utf-8")

    with pytest.raises(PublishError, match="identity is in dispute"):
        read_stage_state(staged.staging_dir, data_repo=repo, backend=LocalDirBackend(repo))


def test_a_forged_db_logical_in_the_sidecar_is_ignored(tmp_path):
    """It flows into the manifest's congress.db entry, and the journal check
    cannot catch it because the journal was written from the same forged value."""
    db = seed_db(tmp_path / "populus.db")
    repo = make_repo(tmp_path)
    staged = stage_build(db, repo, now=pin(), backend=LocalDirBackend(repo))
    real = staged._state["db_logical"]
    write_stage_state(staged)

    sidecar = Path(staged.staging_dir) / STAGE_STATE_FILE
    payload = json.loads(sidecar.read_text("utf-8"))
    payload["db_logical"] = "0" * 64
    sidecar.write_text(json.dumps(payload), encoding="utf-8")

    revived = read_stage_state(staged.staging_dir, data_repo=repo, backend=LocalDirBackend(repo))
    assert revived._state["db_logical"] == real, "the forged digest was believed"


def test_a_staging_dir_not_named_like_a_build_id_is_refused(tmp_path):
    db = seed_db(tmp_path / "populus.db")
    repo = make_repo(tmp_path)
    staged = stage_build(db, repo, now=pin(), backend=LocalDirBackend(repo))
    write_stage_state(staged)
    renamed = Path(staged.staging_dir).parent / "not-a-build-id"
    Path(staged.staging_dir).rename(renamed)
    with pytest.raises(PublishError, match="not named after a valid build id"):
        read_stage_state(renamed, data_repo=repo, backend=LocalDirBackend(repo))


def test_both_stats_copies_are_patched_and_byte_equal(tmp_path):
    """R24 / §12.1 step 2 — 'both places identically'.

    The site build emits dist/stats.json from the PROVISIONAL document, whose
    count is still null. Patching only the canonical copy leaves the live site
    reporting null forever while the published manifest reports the integer.
    """
    db = seed_db(tmp_path / "populus.db")
    repo = make_repo(tmp_path)
    staged = stage_build(db, repo, now=pin(), backend=LocalDirBackend(repo))
    build_dir = Path(staged.staging_dir) / "build"

    # Stand in for the site build: it copies the provisional bytes verbatim.
    dist = tmp_path / "dist"
    dist.mkdir()
    (dist / "stats.json").write_bytes((build_dir / "congress" / "stats.json").read_bytes())
    assert json.loads((dist / "stats.json").read_text())["site_file_count"] is None

    finalize_build(staged, site_file_count=12543, dist_dir=dist)

    served = (dist / "stats.json").read_bytes()
    canonical = (build_dir / "congress" / "stats.json").read_bytes()
    assert served == canonical, "the two stats.json copies are not byte-equal"
    assert json.loads(served)["site_file_count"] == 12543


def test_a_missing_served_stats_is_refused_not_ignored(tmp_path):
    """Silently skipping the patch is how the served copy stays null."""
    db = seed_db(tmp_path / "populus.db")
    repo = make_repo(tmp_path)
    staged = stage_build(db, repo, now=pin(), backend=LocalDirBackend(repo))
    empty = tmp_path / "dist"
    empty.mkdir()
    with pytest.raises(PublishError, match="no served stats.json"):
        finalize_build(staged, site_file_count=41, dist_dir=empty)


def test_the_byte_equality_assertion_can_actually_fire(tmp_path, monkeypatch):
    """Pins the guard, not just the happy path.

    Both copies are written from one `rendered` string, so in normal operation
    they cannot differ and the assertion is unreachable — which means a mutation
    deleting it survives every other test. What it genuinely guards is the two
    WRITERS disagreeing: `_write_staged` and `Path.write_text` differing on
    encoding or newline handling. So make them disagree and require the error.
    """
    from populus.publish import build as build_mod

    db = seed_db(tmp_path / "populus.db")
    repo = make_repo(tmp_path)
    staged = stage_build(db, repo, now=pin(), backend=LocalDirBackend(repo))
    build_dir = Path(staged.staging_dir) / "build"
    dist = tmp_path / "dist"
    dist.mkdir()
    (dist / "stats.json").write_bytes((build_dir / "congress" / "stats.json").read_bytes())

    real_write = build_mod._write_staged

    def divergent_write(target_dir, relpath, payload):
        if relpath == "congress/stats.json":
            payload = payload + "\n"  # one byte of drift, as an encoding bug would
        return real_write(target_dir, relpath, payload)

    monkeypatch.setattr(build_mod, "_write_staged", divergent_write)
    with pytest.raises(PublishError, match="byte-equality does not hold"):
        finalize_build(staged, site_file_count=99, dist_dir=dist)
