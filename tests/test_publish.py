"""§5.5 publication protocol: build, backends, journal recovery, publish,
verify, workflows, runbooks (RUN 5; R1–R3, R5, R9–R11, R15–R16, R19, R23,
R25–R26, R29–R35).

Shared helpers (``seed_db``/``publish_build``/``RecordingBackend``/``NOW``)
are imported by ``test_pointer_state.py``. All clocks are pinned; all remote
seams are local or recorded — the autouse socket guard proves nothing
escapes.
"""

from __future__ import annotations

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
    reconcile_inflight,
    run_build,
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
    assert module["digest_projection_version"] == "1"
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
        cli_main, ["build", "--db", str(db), "--data-repo", str(repo)]
    )
    assert result.exit_code == 0, result.output
    assert "staged build" in result.output

    result = runner.invoke(
        cli_main, ["publish", "--data-repo", str(repo), "--dry-run"]
    )
    assert result.exit_code == 0, result.output
    assert "dry-run" in result.output
    assert not (repo / "latest.json").exists()

    result = runner.invoke(cli_main, ["publish", "--data-repo", str(repo)])
    assert result.exit_code == 0, result.output
    assert "published build" in result.output

    result = runner.invoke(
        cli_main, ["verify", "--data-repo", str(repo), "--db", str(db)]
    )
    assert result.exit_code == 0, result.output
    assert "verify ok" in result.output


def test_cli_gh_backend_requires_repo_slug(tmp_path):
    repo = make_repo(tmp_path)
    result = CliRunner().invoke(
        cli_main,
        ["publish", "--data-repo", str(repo), "--backend", "gh-release"],
        env={"GH_REPO": None},
    )
    assert result.exit_code == 2
    assert "--repo" in result.output


def test_cli_verify_fails_cleanly_without_pointer(tmp_path):
    repo = make_repo(tmp_path)
    result = CliRunner().invoke(cli_main, ["verify", "--data-repo", str(repo)])
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

    result = CliRunner().invoke(cli_main, ["verify", "--data-repo", str(repo)])
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
        cli_main, ["verify", "--data-repo", str(repo), "--db", str(corrupt)]
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
        ["publish", "--data-repo", str(repo), "--rollback-to", first.build_id],
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
    token_steps = [
        step
        for step in job["steps"]
        if "GH_TOKEN" in (step.get("env") or {})
    ]
    assert len(token_steps) == 2
    for step in token_steps:
        run = step.get("run", "")
        assert "populus build" in run or "populus publish" in run
        assert step["env"]["GH_TOKEN"] == "${{ secrets.DATA_REPO_PAT }}"
    # Never in a run body, never echoed (R33).
    for step in job["steps"]:
        run = step.get("run", "")
        assert "DATA_REPO_PAT" not in run
        assert "GH_TOKEN" not in run


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
