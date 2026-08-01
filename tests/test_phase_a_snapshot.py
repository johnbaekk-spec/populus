"""The Phase A snapshot resolver (RUN M1-B, R17).

The corpus the live Phase A ingests into is resolved from the published
manifest and sha256-verified — never assumed at a path, and never quietly
replaced by a fresh database when resolution fails. These tests pin both halves:
what a good data repo resolves to, and that every failure is a hard stop with a
named cause.
"""

from __future__ import annotations

import hashlib
import importlib.util
import json
import sqlite3
import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parent.parent


def _load_snapshot():
    spec = importlib.util.spec_from_file_location(
        "phase_a_snapshot", REPO_ROOT / "scripts" / "phase_a_snapshot.py"
    )
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


snapshot = _load_snapshot()


BUILD_ID = "20260731.1"


@pytest.fixture
def data_repo(tmp_path, make_filing, make_row):
    """A published data repo produced by the REAL build → publish path.

    This fixture used to hand-roll `manifest.json`, which made it a second,
    weaker definition of what a manifest is — and it was not in fact valid under
    the canonical `validate_manifest` (no `watermarks`, no `schema_version`, a
    non-conforming `publisher`, …). That was tolerable only for as long as the
    snapshot script did ad-hoc `.get()` reads; once it enforces the canonical
    boundary (code review round 2, F2), the fixture has to be canonical too.

    Driving `run_build` + `run_publish` means the manifest under test is exactly
    the shape production emits, so these tests can no longer pass against a
    manifest the real client would reject.
    """
    from datetime import datetime, timezone

    from populus.amendments import ensure_views
    from populus.db import connect, init_db
    from populus.load import load_filing
    from populus.publish.build import LocalDirBackend, run_build, run_publish

    repo = tmp_path / "populus-data"
    repo.mkdir()
    source_db = tmp_path / "source.db"
    init_db(str(source_db))
    conn = connect(str(source_db))
    try:
        ensure_views(conn)
        make_filing(conn, filing_id="house:1", doc_url="https://example.invalid/1")
        load_filing(
            conn,
            "house:1",
            [
                make_row(asset_name="Apple Inc"),
                make_row(asset_name="Beta", row_ordinal=2),
            ],
            parse_status="parsed",
            parser_version="t",
            normalization_version="t",
        )
    finally:
        conn.close()

    moment = datetime(2026, 7, 31, tzinfo=timezone.utc)
    backend = LocalDirBackend(repo)
    run_build(source_db, repo, now=lambda: moment, backend=backend)
    run_publish(repo, now=lambda: moment, backend=backend)

    # Pin the identity the rest of the module reads, rather than assuming it.
    pointer = json.loads((repo / "latest.json").read_text(encoding="utf-8"))
    assert pointer["build_id"] == BUILD_ID, pointer
    return repo


def _manifest_path(data_repo):
    return data_repo / "builds" / BUILD_ID / "manifest.json"


def _stats_path(data_repo):
    return data_repo / "builds" / BUILD_ID / "congress" / "stats.json"


def _asset_path(data_repo):
    return data_repo / "releases" / f"data-{BUILD_ID}" / "congress.db"


def test_resolution_walks_pointer_to_manifest_to_asset(data_repo):
    corpus = snapshot.resolve_corpus(data_repo)
    assert corpus.build_id == "20260731.1"
    assert corpus.asset_path.name == "congress.db"
    assert corpus.sha256 == hashlib.sha256(corpus.asset_path.read_bytes()).hexdigest()
    # The manifest-listed stats.json travels with it — that is what the copy is
    # asserted against.
    assert corpus.stats["totals"]["transaction_count_including_excluded"] == 2


def test_snapshot_copies_verifies_integrity_and_reconciles_counts(data_repo, tmp_path):
    out_path = tmp_path / "ops" / "phase-a.db"
    lines: list[str] = []
    assert snapshot.run_snapshot(data_repo, out_path, out=lines.append) == 0
    output = "\n".join(lines)

    assert "resolved build_id: 20260731.1" in output
    assert "matches the manifest" in output
    assert "integrity_check: ok" in output
    assert "transactions: 2 (matches the published stats.json)" in output
    # Provenance of every downstream figure is recorded, not implied.
    assert "published build 20260731.1" in output

    conn = sqlite3.connect(str(out_path))
    try:
        assert conn.execute("SELECT COUNT(*) FROM transactions").fetchone() == (2,)
        assert conn.execute("PRAGMA integrity_check").fetchone() == ("ok",)
        # The §9.5 views came across with the schema, so the gate can be run on
        # the copy without re-deriving anything.
        assert conn.execute(
            "SELECT COUNT(*) FROM v_default_transactions"
        ).fetchone() == (2,)
    finally:
        conn.close()


def test_a_tampered_asset_is_refused_before_any_copy(data_repo, tmp_path):
    asset = data_repo / "releases" / "data-20260731.1" / "congress.db"
    original = asset.read_bytes()
    # Same length — a size-only check would wave this through.
    asset.write_bytes(b"X" + original[1:])

    lines: list[str] = []
    out_path = tmp_path / "phase-a.db"
    assert snapshot.run_snapshot(data_repo, out_path, out=lines.append) == 1
    output = "\n".join(lines)
    assert "sha256" in output and "does not match the manifest" in output
    assert not out_path.exists()   # nothing was copied


def test_a_size_mismatch_is_refused(data_repo, tmp_path):
    asset = data_repo / "releases" / "data-20260731.1" / "congress.db"
    asset.write_bytes(asset.read_bytes() + b"\x00" * 4096)
    lines: list[str] = []
    assert snapshot.run_snapshot(data_repo, tmp_path / "p.db", out=lines.append) == 1
    assert "the manifest entry" in "\n".join(lines)


def test_a_missing_pointer_manifest_or_asset_is_a_hard_stop_not_a_fresh_db(
    data_repo, tmp_path
):
    """Substituting a fresh database would silently invalidate the enlarged-
    corpus budget measurement and the Senate watermark behaviour, so every
    resolution failure exits nonzero and writes nothing."""
    out_path = tmp_path / "phase-a.db"

    asset = data_repo / "releases" / "data-20260731.1" / "congress.db"
    asset.unlink()
    lines: list[str] = []
    assert snapshot.run_snapshot(data_repo, out_path, out=lines.append) == 1
    assert "does not exist" in "\n".join(lines)
    assert not out_path.exists()

    manifest = data_repo / "builds" / "20260731.1" / "manifest.json"
    manifest.unlink()
    lines = []
    assert snapshot.run_snapshot(data_repo, out_path, out=lines.append) == 1
    assert "manifest" in "\n".join(lines)
    assert not out_path.exists()

    (data_repo / "latest.json").unlink()
    lines = []
    assert snapshot.run_snapshot(data_repo, out_path, out=lines.append) == 1
    assert "latest.json does not exist" in "\n".join(lines)
    assert not out_path.exists()


def test_a_manifest_without_a_congress_db_entry_is_a_hard_stop(data_repo, tmp_path):
    """Still a hard stop — now caught EARLIER, by the canonical validator.

    A congress module with no `congress.db` artifact is not merely uninteresting
    to this script, it is an invalid §5.5 manifest, and since round 2 the script
    refuses to dereference an invalid manifest at all. The script's own
    "enumerates no congress.db artifact" message therefore becomes unreachable
    through a *validated* manifest; it is retained as defence in depth for a
    module that validates but lacks the entry.
    """
    manifest_path = _manifest_path(data_repo)
    manifest = json.loads(manifest_path.read_text())
    manifest["modules"]["congress"]["artifacts"] = [
        a for a in manifest["modules"]["congress"]["artifacts"]
        if a["name"] != "congress.db"
    ]
    manifest_path.write_text(json.dumps(manifest), encoding="utf-8")

    lines: list[str] = []
    assert snapshot.run_snapshot(data_repo, tmp_path / "p.db", out=lines.append) == 1
    output = "\n".join(lines)
    assert "is invalid and will not be dereferenced" in output
    assert "congress.db" in output
    assert not (tmp_path / "p.db").exists()


def _rewrite_stats(data_repo, mutate):
    """Rewrite the published stats.json AND re-point its manifest entry.

    A build whose stats artifact genuinely disagrees with its database is a
    different failure from a *tampered* stats artifact, and each has its own
    hard stop. This helper produces the first: manifest and artifact agree with
    each other, and both disagree with the corpus.
    """
    build_id = "20260731.1"
    stats_path = data_repo / "builds" / build_id / "congress" / "stats.json"
    stats = json.loads(stats_path.read_text())
    mutate(stats)
    stats_path.write_text(json.dumps(stats, indent=2), encoding="utf-8")

    manifest_path = data_repo / "builds" / build_id / "manifest.json"
    manifest = json.loads(manifest_path.read_text())
    for artifact in manifest["modules"]["congress"]["artifacts"]:
        if artifact["name"] == "congress/stats.json":
            artifact["sha256"] = hashlib.sha256(stats_path.read_bytes()).hexdigest()
            artifact["bytes"] = stats_path.stat().st_size
    manifest_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")


def test_counts_that_disagree_with_the_published_stats_are_a_hard_stop(
    data_repo, tmp_path
):
    """A copy that does not reconcile with the build it claims to come from is
    refused — the alternative is Phase A figures with no provenance."""

    def bump(stats):
        stats["totals"]["transaction_count_including_excluded"] = 999

    _rewrite_stats(data_repo, bump)
    lines: list[str] = []
    assert snapshot.run_snapshot(data_repo, tmp_path / "p.db", out=lines.append) == 1
    output = "\n".join(lines)
    assert "does not reconcile with the published corpus" in output
    assert "transactions: copy has 2" in output


@pytest.mark.parametrize(
    ("section", "key"),
    [
        ("totals", "filing_count_including_excluded"),
        ("totals", "transaction_count_including_excluded"),
        ("default", "row_count"),
    ],
)
def test_a_missing_expected_count_is_a_hard_stop_never_a_skipped_check(
    data_repo, tmp_path, section, key
):
    """Absent evidence is refused, not waved through (F4).

    Skipping a count the stats artifact does not carry — and then printing that
    the copied count matches stats.json — let a malformed or tampered artifact
    bypass part of the mandatory pre-ingest reconciliation while the snapshot
    reported successful provenance verification. All three counts are required.
    """
    _rewrite_stats(data_repo, lambda stats: stats[section].pop(key))
    out_path = tmp_path / "p.db"
    lines: list[str] = []
    assert snapshot.run_snapshot(data_repo, out_path, out=lines.append) == 1
    output = "\n".join(lines)
    assert "carries no usable expected count" in output
    assert "hard stop, not a skipped check" in output
    # And nothing was reported as reconciled.
    assert "matches the published stats.json" not in output


@pytest.mark.parametrize("value", ["3", None, True, 2.0])
def test_a_non_integer_expected_count_is_a_hard_stop(data_repo, tmp_path, value):
    """A count of the right magnitude but the wrong type is not evidence.
    ``True`` is called out explicitly: ``bool`` is an ``int`` subclass and
    ``True == 1`` would otherwise reconcile a one-filing corpus."""

    def retype(stats):
        stats["totals"]["filing_count_including_excluded"] = value

    _rewrite_stats(data_repo, retype)
    lines: list[str] = []
    assert snapshot.run_snapshot(data_repo, tmp_path / "p.db", out=lines.append) == 1
    assert "carries no usable expected count" in "\n".join(lines)


def test_a_tampered_stats_artifact_is_refused_against_its_manifest_entry(
    data_repo, tmp_path
):
    """The counts file gets the same integrity treatment as the database it
    reconciles. Verifying the corpus byte-for-byte and then trusting an
    unverified counts file would rest the whole assertion on a file anything
    could have rewritten (F4)."""
    stats_path = data_repo / "builds" / "20260731.1" / "congress" / "stats.json"
    original = stats_path.read_text(encoding="utf-8")
    # A SAME-LENGTH edit, so the size check cannot catch it and only the sha256
    # comparison can — and one that leaves every count correct, so the
    # reconciliation downstream would have passed happily.
    tampered = original.replace("2026-07-31T00:00:00Z", "2027-01-01T00:00:00Z", 1)
    assert tampered != original and len(tampered) == len(original)
    stats_path.write_text(tampered, encoding="utf-8")   # manifest NOT updated

    lines: list[str] = []
    out_path = tmp_path / "p.db"
    assert snapshot.run_snapshot(data_repo, out_path, out=lines.append) == 1
    output = "\n".join(lines)
    assert "congress/stats.json sha256" in output
    assert "does not match the manifest" in output
    assert not out_path.exists()          # refused before any copy


def test_a_locator_escaping_the_data_repo_is_refused(data_repo, tmp_path):
    """Traversal is refused — now by the canonical locator grammar, which fires
    before the script's own containment proof. Both layers are kept; the one
    that answers first is simply the stricter one."""
    manifest_path = _manifest_path(data_repo)
    manifest = json.loads(manifest_path.read_text())
    for artifact in manifest["modules"]["congress"]["artifacts"]:
        if artifact["name"] == "congress.db":
            artifact["path"] = "../escape/congress.db"
    manifest_path.write_text(json.dumps(manifest), encoding="utf-8")

    out_path = tmp_path / "p.db"
    lines: list[str] = []
    assert snapshot.run_snapshot(data_repo, out_path, out=lines.append) == 1
    assert "is invalid and will not be dereferenced" in "\n".join(lines)
    assert not out_path.exists()


def test_the_containment_proof_still_refuses_a_traversal_locator(data_repo):
    """The script's own containment boundary, exercised directly.

    The manifest validator now rejects a traversal locator first, so the
    `_resolve_under` guard is no longer reachable through `run_snapshot`. It is
    defence in depth against any future path that dereferences a locator without
    re-validating, and it must keep working — an unreachable guard that has
    silently rotted is worse than no guard.
    """
    with pytest.raises(snapshot.SnapshotError) as excinfo:
        snapshot._resolve_under(data_repo, "../escape/congress.db", "congress.db")
    assert "escapes the data repo" in str(excinfo.value)


# --- the canonical manifest boundary (code review round 2, F2) ---------------


def test_an_invalid_manifest_is_never_dereferenced(data_repo, tmp_path):
    """The script must not maintain a second, weaker idea of a valid manifest.

    A missing `watermarks` block is a defect the canonical `validate_manifest`
    names and the old ad-hoc `.get()` reads sailed straight past, because
    nothing the script itself read happened to be missing.
    """
    manifest_path = _manifest_path(data_repo)
    manifest = json.loads(manifest_path.read_text())
    del manifest["modules"]["congress"]["watermarks"]
    manifest_path.write_text(json.dumps(manifest), encoding="utf-8")

    out_path = tmp_path / "p.db"
    lines: list[str] = []
    assert snapshot.run_snapshot(data_repo, out_path, out=lines.append) == 1
    output = "\n".join(lines)
    assert "is invalid and will not be dereferenced" in output
    assert "watermarks" in output
    assert not out_path.exists()


def test_an_artifact_entry_without_bytes_is_refused_not_size_skipped(
    data_repo, tmp_path
):
    """The precise fail-open the reviewer named (round 2, F2).

    The size check was written `if expected_bytes is not None`, so an entry with
    no `bytes` field bypassed size verification altogether while the snapshot
    went on to report published provenance — absent evidence read as "nothing to
    check", the same shape as round-1 F4. `validate_manifest` requires a
    non-negative integer `bytes` on every entry, so this is now a hard stop and
    the size comparison downstream is unconditional.
    """
    manifest_path = _manifest_path(data_repo)
    manifest = json.loads(manifest_path.read_text())
    for artifact in manifest["modules"]["congress"]["artifacts"]:
        if artifact["name"] == "congress.db":
            del artifact["bytes"]
    manifest_path.write_text(json.dumps(manifest), encoding="utf-8")

    out_path = tmp_path / "p.db"
    lines: list[str] = []
    assert snapshot.run_snapshot(data_repo, out_path, out=lines.append) == 1
    output = "\n".join(lines)
    assert "is invalid and will not be dereferenced" in output
    assert "bytes must be a non-negative integer" in output
    assert not out_path.exists()


def test_a_pointer_naming_a_different_build_than_its_manifest_is_refused(
    data_repo, tmp_path
):
    """Pointer/manifest identity, via the canonical checker.

    A structurally valid, internally hash-consistent manifest for build B,
    reached through a pointer claiming build A, would have been dereferenced and
    every Phase A figure reported under A's build id — defeating cache identity,
    monitor state, and rollback. The identities must agree.

    Editing `build_id` in place would NOT test this: the validator also scopes
    every artifact path to the manifest's own build, so a one-field edit fails
    validation and never reaches the identity check. A real second build is
    produced instead, so the manifest under test is genuinely valid — just for
    the wrong build.
    """
    from datetime import datetime, timezone

    from populus.publish.build import LocalDirBackend, run_build, run_publish
    from populus.publish.manifest import validate_manifest

    moment = datetime(2026, 7, 31, tzinfo=timezone.utc)
    backend = LocalDirBackend(data_repo)
    run_build(
        data_repo.parent / "source.db", data_repo, now=lambda: moment, backend=backend
    )
    run_publish(data_repo, now=lambda: moment, backend=backend)
    second = json.loads((data_repo / "latest.json").read_text(encoding="utf-8"))
    assert second["build_id"] != BUILD_ID, second
    # The second build's manifest is valid on its own terms …
    assert not validate_manifest(
        json.loads(
            (data_repo / "builds" / second["build_id"] / "manifest.json").read_text()
        )
    )

    # … but the pointer claims the FIRST build while pointing at it.
    (data_repo / "latest.json").write_text(
        json.dumps(
            {
                "build_id": BUILD_ID,
                "manifest_path": f"builds/{second['build_id']}/manifest.json",
                "pointer_version": 2,
            }
        ),
        encoding="utf-8",
    )

    out_path = tmp_path / "p.db"
    lines: list[str] = []
    assert snapshot.run_snapshot(data_repo, out_path, out=lines.append) == 1
    output = "\n".join(lines)
    assert "does not match the pointer's build_id" in output
    assert "refusing a cross-build binding" in output
    assert not out_path.exists()
