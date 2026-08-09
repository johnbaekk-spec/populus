#!/usr/bin/env python
"""RUN M2-11 T6 (plan R23/R24) — cut an ACCEPTED institutional source snapshot.

Owner protocol, deliberately incapable of running by accident: it refuses to do
anything unless given an explicit ``--source`` (the canonical audit store) and
``--dest-dir`` (the snapshots directory). Nothing here writes the source — it
is opened ``mode=ro`` and copied through the sqlite3 backup API; the pre/post
main-file hashes are printed as CORROBORATION only (a WAL family cannot be
byte-proven unchanged by main-file hash alone — the enforcement is the
read-only open plus the OS ACL).

The finalization sequence is the one MEASURED at plan revision 3 (F5): a
backup-API destination inherits WAL mode, and ``wal_checkpoint`` does not
change that, so the mode switch is EXPLICIT and its returned value ASSERTED —
skipping it ships a snapshot that grows ``-wal``/``-shm`` sidecars on first
read-only open, which is exactly what an immutable artifact must never do.

Order (every step is load-bearing; see R23):

  free-space preflight
  -> backup API to a UNIQUE temp sibling in dest-dir
  -> apply the shipped views.sql to the COPY
  -> write the single-row inst_source_meta (R24 — INSIDE the hashed bytes)
  -> PRAGMA wal_checkpoint(TRUNCATE)
  -> PRAGMA journal_mode=DELETE, returned value asserted == 'delete'
  -> close; assert no -wal/-shm sidecars exist
  -> chmod 0444 the TEMP sibling (immutability BEFORE verification — F4)
  -> reopen read-only; re-run verify_views + PRAGMA integrity_check, and
     assert the file being reverified carries no write bits
  -> sha256 of the finalized (already-immutable) bytes
  -> fsync (file and directory)
  -> REFUSE an existing destination
  -> atomic NO-REPLACE publication: os.link(temp, dest) + os.unlink(temp)
     (link fails EEXIST if the destination appeared after the check — F3)

The chmod happens on the temp sibling BEFORE the reverify and the publication,
so the reverify provably runs against the final-permission (0444) state, and a
crash at ANY point after publication leaves an already-immutable destination —
there is no window in which an accepted snapshot exists writable.

An interruption anywhere before the publication leaves NO destination file —
only a temp sibling, removed on the failure path.
"""

from __future__ import annotations

import argparse
import hashlib
import os
import shutil
import sqlite3
import sys
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from populus.amendments import (  # noqa: E402
    ensure_views,
    packaged_view_digest,
    verify_views,
)

#: The R24 metadata schema version carried inside every snapshot.
META_SCHEMA_VERSION = "1.0"

#: Free space demanded before the cut starts: the source size plus a quarter,
#: because the temp sibling is a full copy and the checkpoint needs headroom.
FREE_SPACE_FACTOR = 1.25


class SnapshotCutError(RuntimeError):
    """The cut was refused or an invariant failed; no destination was written."""


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _utc_now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _assert_no_sidecars(db_path: Path) -> None:
    """A finalized snapshot must be a SINGLE file (R23)."""
    sidecars = [
        sibling
        for suffix in ("-wal", "-shm")
        if (sibling := Path(str(db_path) + suffix)).exists()
    ]
    if sidecars:
        raise SnapshotCutError(
            f"sidecar file(s) survived finalization: {sidecars} — the"
            " journal-mode switch did not take; the snapshot is not standalone"
        )


def write_source_meta(
    conn: sqlite3.Connection,
    *,
    snapshot_version: int,
    created_at_utc: str,
    view_definition_digest: str,
) -> None:
    """Write the strict single-row ``inst_source_meta`` table (R24).

    Lives INSIDE the file that gets hashed, so stage-build's provenance
    artifact can never drift from the snapshot's identity. Replaced wholesale
    on every cut — a snapshot carries exactly its own metadata, nothing
    inherited.
    """
    conn.execute("DROP TABLE IF EXISTS inst_source_meta")
    conn.execute(
        "CREATE TABLE inst_source_meta ("
        " schema_version TEXT NOT NULL,"
        " snapshot_version INTEGER NOT NULL,"
        " created_at_utc TEXT NOT NULL,"
        " view_definition_digest TEXT NOT NULL)"
    )
    conn.execute(
        "INSERT INTO inst_source_meta VALUES (?, ?, ?, ?)",
        (
            META_SCHEMA_VERSION,
            snapshot_version,
            created_at_utc,
            view_definition_digest,
        ),
    )


def finalize_copy(
    copy_path: Path,
    *,
    snapshot_version: int,
    created_at_utc: str | None = None,
    switch_journal_mode: bool = True,
) -> None:
    """Views + metadata + the MEASURED finalization sequence, on *copy_path*.

    ``switch_journal_mode`` exists only so a test can prove the mutant that
    skips the mode switch is caught by the no-sidecar assertion — production
    callers never pass it.
    """
    conn = sqlite3.connect(str(copy_path), isolation_level=None)
    try:
        ensure_views(conn)
        write_source_meta(
            conn,
            snapshot_version=snapshot_version,
            created_at_utc=created_at_utc or _utc_now(),
            view_definition_digest=packaged_view_digest(),
        )
        conn.execute("PRAGMA wal_checkpoint(TRUNCATE)")
        if switch_journal_mode:
            (mode,) = conn.execute("PRAGMA journal_mode=DELETE").fetchone()
            if mode != "delete":
                raise SnapshotCutError(
                    f"PRAGMA journal_mode=DELETE returned {mode!r}, not"
                    " 'delete' — the snapshot would keep its WAL family"
                )
    finally:
        conn.close()
    _assert_no_sidecars(copy_path)


def _seal_read_only(copy_path: Path) -> None:
    """chmod 0444 the finalized temp sibling BEFORE reverify + publication (F4).

    A seam function so a test can prove the chmod-failure path refuses to
    publish. If this raises, the cut aborts with NO destination — a snapshot
    that cannot be made immutable is not accepted.
    """
    os.chmod(copy_path, 0o444)


def _publish_no_replace(temp_path: Path, dest: Path) -> None:
    """Atomic no-replace publication (F3).

    ``os.rename`` REPLACES an existing destination, so a destination created
    between the existence check and the rename would be silently clobbered
    (TOCTOU). ``os.link`` fails with EEXIST instead — the kernel enforces the
    no-replace property atomically — and the temp name is then unlinked. Both
    names live in the same directory, so the hard link cannot cross a
    filesystem boundary. The published inode is the already-0444 temp inode,
    so the destination is immutable from the instant it exists.
    """
    try:
        os.link(temp_path, dest)
    except FileExistsError as exc:
        raise SnapshotCutError(
            f"destination {dest} appeared during the cut — refusing to"
            " overwrite an existing snapshot"
        ) from exc
    os.unlink(temp_path)


def reverify_copy(copy_path: Path) -> None:
    """Reopen read-only and re-run verify_views + integrity_check (R23).

    The journal mode is re-asserted from the READ-ONLY handle, and the
    no-sidecar assertion runs again AFTERWARDS — measured behaviour (plan F5,
    re-measured this run): a copy left in WAL mode shows no sidecars at close,
    but the first read-only reopen CREATES ``-shm``/``-wal`` and they survive
    that connection's close. A mutant that skips the mode switch therefore
    passes the first no-sidecar check and is caught HERE.
    """
    conn = sqlite3.connect(f"file:{copy_path}?mode=ro", uri=True)
    try:
        verify_views(conn)
        (mode,) = conn.execute("PRAGMA journal_mode").fetchone()
        if mode != "delete":
            raise SnapshotCutError(
                f"read-only reopen reports journal_mode {mode!r}, not"
                " 'delete' — the finalization mode switch did not take"
            )
        (integrity,) = conn.execute("PRAGMA integrity_check").fetchone()
        if integrity != "ok":
            raise SnapshotCutError(
                f"finalized copy failed integrity_check: {integrity}"
            )
    finally:
        conn.close()
    _assert_no_sidecars(copy_path)
    # F4: the reverify must prove the FINAL-permission state, not a writable
    # stand-in — the cut chmods the temp sibling 0444 BEFORE calling here, so
    # any write bit at this point means the seal step was skipped or reverted.
    mode = copy_path.stat().st_mode & 0o777
    if mode & 0o222:
        raise SnapshotCutError(
            f"reverify ran against a writable file (mode {oct(mode)}) — the"
            " snapshot must be sealed 0444 BEFORE verification so the verified"
            " state is the published state"
        )


def cut_snapshot(
    source: Path,
    dest_dir: Path,
    *,
    snapshot_version: int,
    created_at_utc: str | None = None,
) -> dict:
    """The full R23 protocol; returns the printed record as a dict.

    Raises :class:`SnapshotCutError` on any refusal or failed invariant; on
    every failure path the temp sibling is removed and NO destination exists.
    """
    timings: dict[str, float] = {}
    started = time.monotonic()
    if not source.is_file():
        raise SnapshotCutError(f"--source {source} is not a file")
    if not dest_dir.is_dir():
        raise SnapshotCutError(f"--dest-dir {dest_dir} is not a directory")
    dest = dest_dir / f"inst-source-v{snapshot_version}.db"
    if dest.exists():
        raise SnapshotCutError(
            f"destination {dest} already exists — snapshots are immutable and"
            " versioned (LD-8); cut the next version instead"
        )

    # --- free-space preflight ------------------------------------------------
    source_bytes = source.stat().st_size
    free = shutil.disk_usage(dest_dir).free
    needed = int(source_bytes * FREE_SPACE_FACTOR)
    if free < needed:
        raise SnapshotCutError(
            f"only {free:,} bytes free in {dest_dir}; the cut needs"
            f" {needed:,} (source is {source_bytes:,} bytes)"
        )

    source_hash_pre = _sha256_file(source)

    # --- backup API into a UNIQUE temp sibling (same dir → atomic rename) ----
    fd, temp_name = tempfile.mkstemp(
        prefix=f".inst-source-v{snapshot_version}.", suffix=".tmp", dir=dest_dir
    )
    os.close(fd)
    temp_path = Path(temp_name)
    try:
        t0 = time.monotonic()
        src_conn = sqlite3.connect(f"file:{source}?mode=ro", uri=True)
        try:
            copy_conn = sqlite3.connect(str(temp_path))
            try:
                src_conn.backup(copy_conn)
            finally:
                copy_conn.close()
        finally:
            src_conn.close()
        timings["backup_s"] = time.monotonic() - t0

        t0 = time.monotonic()
        finalize_copy(
            temp_path,
            snapshot_version=snapshot_version,
            created_at_utc=created_at_utc,
        )
        timings["finalize_s"] = time.monotonic() - t0

        # F4: immutability FIRST. The temp sibling is sealed 0444 before the
        # reverify and the hash, so verification runs against the exact
        # permission state that gets published, and no crash window can leave
        # an accepted snapshot writable.
        _seal_read_only(temp_path)

        t0 = time.monotonic()
        reverify_copy(temp_path)
        timings["reverify_s"] = time.monotonic() - t0

        t0 = time.monotonic()
        snapshot_sha = _sha256_file(temp_path)
        timings["sha256_s"] = time.monotonic() - t0

        # fsync the finalized bytes and the directory before the rename, so
        # the rename can never publish a name whose bytes are not durable.
        file_fd = os.open(temp_path, os.O_RDONLY)
        try:
            os.fsync(file_fd)
        finally:
            os.close(file_fd)
        dir_fd = os.open(dest_dir, os.O_RDONLY)
        try:
            os.fsync(dir_fd)
        finally:
            os.close(dir_fd)

        # Re-checked before publishing — but the check is ADVISORY only: the
        # enforcement is _publish_no_replace, whose os.link fails EEXIST
        # atomically if the name appears between this check and the publish
        # (F3 — a plain rename here would silently REPLACE it).
        if dest.exists():
            raise SnapshotCutError(
                f"destination {dest} appeared during the cut — refusing to"
                " overwrite an existing snapshot"
            )
        _publish_no_replace(temp_path, dest)
    except BaseException:
        temp_path.unlink(missing_ok=True)
        for suffix in ("-wal", "-shm"):  # a failed reverify may have spawned them
            Path(str(temp_path) + suffix).unlink(missing_ok=True)
        raise

    source_hash_post = _sha256_file(source)
    timings["total_s"] = time.monotonic() - started
    return {
        "snapshot_version": snapshot_version,
        "destination": str(dest),
        "snapshot_sha256": snapshot_sha,
        "source_main_file_sha256_pre": source_hash_pre,
        "source_main_file_sha256_post": source_hash_post,
        "view_definition_digest": packaged_view_digest(),
        "timings": timings,
    }


def _print_record(record: dict) -> None:
    print("=== inst snapshot record (R23) ===")
    print(f"snapshot_version : {record['snapshot_version']}")
    print(f"destination      : {record['destination']}")
    print(f"snapshot_sha256  : {record['snapshot_sha256']}")
    print(
        "source main-file sha256 pre  (CORROBORATION):"
        f" {record['source_main_file_sha256_pre']}"
    )
    print(
        "source main-file sha256 post (CORROBORATION):"
        f" {record['source_main_file_sha256_post']}"
    )
    if record["source_main_file_sha256_pre"] != record["source_main_file_sha256_post"]:
        print(
            "NOTE: main-file hashes differ. For a WAL-mode source this does"
            " NOT by itself prove a write by this tool (checkpoints by other"
            " readers move bytes between the WAL and the main file); the"
            " enforcement is the read-only open modes plus the OS ACL."
        )
    print(f"view_definition_digest : {record['view_definition_digest']}")
    for name, seconds in record["timings"].items():
        print(f"timing {name:<12}: {seconds:.2f}s")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description=(
            "Cut an accepted, immutable institutional source snapshot (R23)."
            " Refuses to run without explicit --source and --dest-dir."
        )
    )
    parser.add_argument(
        "--source", required=True, help="The canonical audit store (opened read-only)."
    )
    parser.add_argument(
        "--dest-dir",
        required=True,
        help="The snapshots directory; receives inst-source-v<N>.db.",
    )
    parser.add_argument(
        "--snapshot-version",
        required=True,
        type=int,
        help="The version N for inst-source-v<N>.db (immutable; never reused).",
    )
    args = parser.parse_args(argv)
    if args.snapshot_version < 1:
        parser.error("--snapshot-version must be a positive integer")
    try:
        record = cut_snapshot(
            Path(args.source),
            Path(args.dest_dir),
            snapshot_version=args.snapshot_version,
        )
    except SnapshotCutError as exc:
        print(f"REFUSED: {exc}", file=sys.stderr)
        return 1
    _print_record(record)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
