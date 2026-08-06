"""R4/R5/R6: the upload snapshot binds hashed bytes to uploaded bytes.

The tests that matter here are the ones that mutate the source *during* the
freeze. A test that builds a tree, freezes it, and checks the digest proves only
that hashing works; the property under test is that the snapshot is unaffected
by a source that keeps moving.
"""

from __future__ import annotations

import os
import stat
from pathlib import Path

import pytest

from populus.deploy.snapshot import SnapshotError, freeze_tree
from populus.publish.digests import DigestError, dist_digest


def _tree(root: Path, files: dict[str, bytes]) -> Path:
    for relpath, payload in files.items():
        target = root / relpath
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(payload)
    return root


@pytest.fixture
def site(tmp_path: Path) -> Path:
    return _tree(
        tmp_path / "dist",
        {
            "index.html": b"<!doctype html><meta name=populus:build_id content=20260805.1>",
            "assets/app.js": b"console.log(1)\n",
            "assets/app.css": b"body{}\n",
            "congress/stats.json": b'{"stats_version":"stats-1.0.0"}\n',
        },
    )


def test_snapshot_hashes_the_destination_not_the_source(site: Path) -> None:
    """(6): the digest describes the sealed copy, so post-seal edits cannot move it."""
    snapshot = freeze_tree(site)
    try:
        assert snapshot.dist_digest == dist_digest(snapshot.path)
        assert snapshot.file_count == 4
    finally:
        snapshot.cleanup()


def test_post_seal_source_mutation_leaves_the_snapshot_unchanged(site: Path) -> None:
    """The whole point of R4: dist/ keeps moving, the uploaded bytes do not."""
    snapshot = freeze_tree(site)
    try:
        frozen = snapshot.dist_digest
        (site / "index.html").write_bytes(b"<!doctype html>DEFACED")
        (site / "assets" / "extra.js").write_bytes(b"injected\n")
        assert dist_digest(snapshot.path) == frozen
        assert not (snapshot.path / "assets" / "extra.js").exists()
        # And the source really did diverge — otherwise this test is vacuous.
        assert dist_digest(site) != frozen
    finally:
        snapshot.cleanup()


def test_the_digest_is_taken_from_the_sealed_copy_not_the_source(site: Path, monkeypatch) -> None:
    """THE binding property (6), pinned where it can actually fail.

    ``test_post_seal_source_mutation_...`` mutates the source *after*
    ``freeze_tree`` returns, so it passes even if the digest were computed from
    the source — by then the copy and the source still agreed at digest time.
    That is an end-state assertion, not the property.

    Here the source is mutated inside the window *between* the stability check
    and the digest, which is precisely where the two diverge. Reading the source
    at step 6 yields the mutated bytes; reading the sealed copy yields the frozen
    ones. Nothing else distinguishes them.
    """
    from populus.deploy import snapshot as snapshot_mod

    real_seal = snapshot_mod._seal

    def seal_then_deface(tree: Path) -> None:
        real_seal(tree)
        # The stability check has already run; the seal is on. Anything that
        # touches dist/ from here is invisible to the detector *by design* —
        # the guarantee has to come from where we read, not from noticing.
        (site / "index.html").write_bytes(b"<!doctype html>DEFACED-MID-FREEZE")
        (site / "assets" / "injected.js").write_bytes(b"payload\n")

    monkeypatch.setattr(snapshot_mod, "_seal", seal_then_deface)
    snapshot = freeze_tree(site)
    try:
        assert snapshot.dist_digest == dist_digest(snapshot.path)
        assert snapshot.dist_digest != dist_digest(site)
        # R6: the envelope must describe the sealed tree too, not the source.
        paths = {entry["path"] for entry in snapshot.inventory["files"]}
        assert "assets/injected.js" not in paths
        assert snapshot.file_count == 4
        sealed_index = next(
            e for e in snapshot.inventory["files"] if e["path"] == "index.html"
        )
        assert sealed_index["sha256"] != _sha256((site / "index.html").read_bytes())
    finally:
        snapshot.cleanup()


def _sha256(payload: bytes) -> str:
    import hashlib

    return hashlib.sha256(payload).hexdigest()


def test_the_uploader_only_ever_sees_the_sealed_path(site: Path) -> None:
    """(7): the snapshot exposes its own path, never the source."""
    snapshot = freeze_tree(site)
    try:
        assert snapshot.path != site
        assert not str(snapshot.path).startswith(str(site) + os.sep)
    finally:
        snapshot.cleanup()


def test_mutation_during_the_copy_is_detected(site: Path, monkeypatch) -> None:
    """(4) as a detector: a file rewritten mid-freeze must not pass silently."""
    from populus.deploy import snapshot as snapshot_mod

    real_copy = snapshot_mod._copy_one
    state = {"done": 0}

    def mutating_copy(src: Path, dest: Path):
        result = real_copy(src, dest)
        state["done"] += 1
        if state["done"] == 1:
            # Something else on the runner writes into dist/ mid-copy.
            (site / "congress" / "stats.json").write_bytes(b'{"stats_version":"x"}\n')
        return result

    monkeypatch.setattr(snapshot_mod, "_copy_one", mutating_copy)
    with pytest.raises(SnapshotError, match="mutated while being frozen"):
        freeze_tree(site)


def test_file_added_during_the_copy_is_detected(site: Path, monkeypatch) -> None:
    from populus.deploy import snapshot as snapshot_mod

    real_copy = snapshot_mod._copy_one
    state = {"done": 0}

    def adding_copy(src: Path, dest: Path):
        result = real_copy(src, dest)
        state["done"] += 1
        if state["done"] == 1:
            (site / "late.html").write_bytes(b"late\n")
        return result

    monkeypatch.setattr(snapshot_mod, "_copy_one", adding_copy)
    with pytest.raises(SnapshotError, match="changed while being frozen"):
        freeze_tree(site)


def test_atomic_replacement_at_identical_size_and_mtime_is_detected(site: Path, monkeypatch) -> None:
    """``inode`` is why the identity tuple is not just ``(size, mtime_ns)``.

    A writer that replaces a file with a same-sized copy and restores the
    timestamp defeats a ``(size, mtime)`` comparison entirely.
    """
    from populus.deploy import snapshot as snapshot_mod

    target = site / "assets" / "app.css"
    original = target.stat()
    real_copy = snapshot_mod._copy_one
    state = {"done": 0}

    def replacing_copy(src: Path, dest: Path):
        result = real_copy(src, dest)
        state["done"] += 1
        if state["done"] == 1:
            replacement = target.with_suffix(".css.new")
            replacement.write_bytes(b"body{}\n")  # same length
            os.replace(replacement, target)
            os.utime(target, ns=(original.st_atime_ns, original.st_mtime_ns))
        return result

    monkeypatch.setattr(snapshot_mod, "_copy_one", replacing_copy)
    with pytest.raises(SnapshotError, match="mutated while being frozen"):
        freeze_tree(site)


def test_a_failed_freeze_leaves_no_snapshot_behind(site: Path, monkeypatch, tmp_path: Path) -> None:
    """A half-frozen tree must never be reachable by an uploader."""
    from populus.deploy import snapshot as snapshot_mod

    before = set(tmp_path.iterdir())

    def exploding_copy(src: Path, dest: Path):
        raise OSError("disk full")

    monkeypatch.setattr(snapshot_mod, "_copy_one", exploding_copy)
    with pytest.raises(OSError):
        freeze_tree(site)
    assert set(tmp_path.iterdir()) == before


def test_the_sealed_tree_is_read_only(site: Path) -> None:
    """(5): advisory, but it must actually be applied."""
    snapshot = freeze_tree(site)
    try:
        for root, dirs, files in os.walk(snapshot.path):
            for name in files:
                mode = (Path(root) / name).stat().st_mode
                assert not mode & stat.S_IWUSR, f"{name} is writable"
            for name in dirs:
                mode = (Path(root) / name).stat().st_mode
                assert not mode & stat.S_IWUSR, f"{name}/ is writable"
    finally:
        snapshot.cleanup()


def test_inventory_is_the_published_envelope_over_the_sealed_tree(site: Path) -> None:
    """R6: the inventory a verifier compares against describes what we uploaded."""
    snapshot = freeze_tree(site)
    try:
        paths = {entry["path"] for entry in snapshot.inventory["files"]}
        assert paths == {
            "index.html",
            "assets/app.js",
            "assets/app.css",
            "congress/stats.json",
        }
        assert snapshot.inventory["dist_digest"] == snapshot.dist_digest
        assert snapshot.inventory["dist_digest_version"] == "1"
    finally:
        snapshot.cleanup()


def test_symlinks_fail_hard(tmp_path: Path) -> None:
    """§12.1: a static tree has none, and a symlink is how a copy reads other bytes."""
    site = _tree(tmp_path / "dist", {"index.html": b"hi\n"})
    (tmp_path / "secret").write_bytes(b"not for the internet\n")
    (site / "leak.html").symlink_to(tmp_path / "secret")
    with pytest.raises(DigestError, match="symlink"):
        freeze_tree(site)


def test_cleanup_is_idempotent_and_removes_the_seal(site: Path) -> None:
    snapshot = freeze_tree(site)
    snapshot.cleanup()
    assert not snapshot.path.exists()
    snapshot.cleanup()


def test_empty_tree_is_a_snapshot_not_an_error(tmp_path: Path) -> None:
    empty = tmp_path / "dist"
    empty.mkdir()
    snapshot = freeze_tree(empty)
    try:
        assert snapshot.file_count == 0
        assert snapshot.inventory["files"] == []
    finally:
        snapshot.cleanup()
