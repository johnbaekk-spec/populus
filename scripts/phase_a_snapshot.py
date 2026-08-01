#!/usr/bin/env python3
"""Resolve, verify, and snapshot the published corpus for RUN M1-B Phase A (R17).

The live Phase A works on a **copy** of the canonical corpus, never on a
production database in place: an interrupted historical ingest must not leave
the real store mid-era, and `rm -rf ops/m1-b` must be a complete rollback.

The copy's source is not assumed — there is no bare ``populus.db`` to reach for.
It is *resolved* from the current published build, which is also what makes
every Phase A figure auditable back to a build id:

    latest.json → builds/<build_id>/manifest.json
                → the congress.db artifact entry (§5.5)
                → releases/data-<build_id>/congress.db

The asset's sha256 and byte length must equal the manifest entry, or this exits
nonzero. A verified asset is then copied through SQLite's **backup API** — the
same call ``run_build`` uses — rather than a filesystem copy, which can capture
a torn page set and carries no integrity contract. The copy is finally checked
with ``PRAGMA integrity_check`` and against the manifest-listed
``congress/stats.json`` row counts, before any ingestion writes to it.

The counts file gets the **same integrity treatment as the database it
reconciles** — its own sha256 and size against its own manifest entry — and
**all three** counts (filings, transactions, ``v_default_transactions``) are
required, each a genuine integer. A missing or non-integer count is a hard stop,
never a skipped check that still reports a match: absent evidence would
otherwise let a malformed or tampered artifact bypass part of the mandatory
pre-ingest reconciliation while this script printed successful provenance
verification.

A missing or mismatching source is a hard stop with a named cause. Substituting
a fresh database is explicitly refused: it would silently invalidate both the
enlarged-corpus budget measurement and the Senate watermark behaviour the
historical window exists to exercise.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sqlite3
import sys
from dataclasses import dataclass
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
if str(REPO_ROOT / "src") not in sys.path:
    sys.path.insert(0, str(REPO_ROOT / "src"))

DB_ARTIFACT = "congress.db"
STATS_ARTIFACT = "congress/stats.json"


class SnapshotError(RuntimeError):
    """The corpus could not be resolved or did not verify — a hard stop."""


@dataclass(frozen=True)
class ResolvedCorpus:
    build_id: str
    manifest_path: Path
    asset_path: Path
    sha256: str
    bytes: int
    stats: dict


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _read_json(path: Path, label: str) -> dict:
    if not path.is_file():
        raise SnapshotError(f"{label} does not exist: {path}")
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except ValueError as exc:
        raise SnapshotError(f"{label} is unreadable ({exc}): {path}") from exc


def _resolve_under(data_repo: Path, relpath: str, label: str) -> Path:
    """Join a manifest locator under the data repo, proving containment.

    Manifest paths obey a strict POSIX grammar, but this reads a file from a
    locator, so containment is proven here rather than assumed upstream.
    """
    from populus.ingest import UnsafeArchivePathError, archive_path

    try:
        return archive_path(data_repo, relpath)
    except UnsafeArchivePathError as exc:
        raise SnapshotError(f"{label} locator escapes the data repo: {exc}") from exc


def resolve_corpus(data_repo: Path) -> ResolvedCorpus:
    """The published ``congress.db``, verified against its manifest entry."""
    from populus.publish.manifest import (
        find_artifact,
        pointer_manifest_identity_error,
        validate_manifest,
    )

    data_repo = Path(data_repo)
    pointer = _read_json(data_repo / "latest.json", "latest.json")
    build_id = pointer.get("build_id")
    if not build_id:
        raise SnapshotError("latest.json carries no build_id")
    manifest_relpath = pointer.get("manifest_path") or (
        f"builds/{build_id}/manifest.json"
    )
    manifest_path = _resolve_under(data_repo, manifest_relpath, "manifest")
    manifest = _read_json(manifest_path, f"manifest for build {build_id}")

    # --- the canonical §5.5 manifest boundary, REUSED not re-implemented -----
    #
    # This script used to dereference the manifest with ad-hoc `.get()` reads,
    # which is a second, weaker validation boundary beside the one the client,
    # monitor, and verifier all share (code review round 2, F2). Two concrete
    # holes that closed with it:
    #
    #   * a hash-consistent manifest for a DIFFERENT build could be dereferenced
    #     and reported under `latest.json`'s build id, cross-binding identities;
    #   * an artifact entry missing `bytes` slipped past size verification
    #     entirely, because the check was written `if expected_bytes is not
    #     None` — absent evidence read as "nothing to check", the same fail-open
    #     shape as round-1 F4.
    #
    # `validate_manifest` guarantees every artifact entry carries a well-formed
    # `sha256` and a non-negative integer `bytes`, which is what lets the size
    # comparisons below be unconditional rather than defensive.
    errors = validate_manifest(manifest)
    if errors:
        raise SnapshotError(
            f"the manifest for build {build_id} is invalid and will not be"
            " dereferenced: " + "; ".join(errors)
        )
    identity_error = pointer_manifest_identity_error(manifest, build_id)
    if identity_error is not None:
        raise SnapshotError(
            f"latest.json points at build {build_id} but {identity_error}"
        )

    entry = find_artifact(manifest, DB_ARTIFACT)
    if entry is None:
        raise SnapshotError(
            f"build {build_id} enumerates no {DB_ARTIFACT} artifact — the"
            " manifest does not describe a congress database to copy"
        )
    locator = entry.get("path")
    if not locator:
        raise SnapshotError(
            f"the {DB_ARTIFACT} entry of build {build_id} has no local path"
            " (a url-located asset needs `populus verify --remote`, not a"
            " local snapshot)"
        )
    asset = _resolve_under(data_repo, locator, DB_ARTIFACT)
    if not asset.is_file():
        raise SnapshotError(f"published {DB_ARTIFACT} does not exist: {asset}")

    actual_bytes = asset.stat().st_size
    # Unconditional: `validate_manifest` above proved `bytes` is present and a
    # non-negative integer, so there is no "absent, therefore skip" branch left.
    expected_bytes = entry["bytes"]
    if actual_bytes != expected_bytes:
        raise SnapshotError(
            f"{DB_ARTIFACT} is {actual_bytes} bytes; the manifest entry for"
            f" build {build_id} says {expected_bytes}"
        )
    actual_sha = _sha256_file(asset)
    expected_sha = entry.get("sha256")
    if actual_sha != expected_sha:
        raise SnapshotError(
            f"{DB_ARTIFACT} sha256 {actual_sha} does not match the manifest"
            f" entry {expected_sha} for build {build_id} — refusing to copy an"
            " asset that is not the published corpus"
        )

    stats_entry = find_artifact(manifest, STATS_ARTIFACT)
    if stats_entry is None or not stats_entry.get("path"):
        raise SnapshotError(
            f"build {build_id} enumerates no local {STATS_ARTIFACT} — the"
            " expected corpus counts cannot be asserted"
        )
    stats_path = _resolve_under(data_repo, stats_entry["path"], STATS_ARTIFACT)
    # The stats artifact is the sole source of the expected counts, so it gets
    # the same integrity treatment as the database it reconciles: sha256 and
    # size against its own manifest entry. Verifying the corpus byte-for-byte
    # and then reconciling it against an unverified counts file would leave the
    # whole assertion resting on a file anything could have rewritten (F4).
    if not stats_path.is_file():
        raise SnapshotError(f"published {STATS_ARTIFACT} does not exist: {stats_path}")
    stats_bytes = stats_path.stat().st_size
    expected_stats_bytes = stats_entry["bytes"]   # validated present above
    if stats_bytes != expected_stats_bytes:
        raise SnapshotError(
            f"{STATS_ARTIFACT} is {stats_bytes} bytes; the manifest entry for"
            f" build {build_id} says {expected_stats_bytes}"
        )
    stats_sha = _sha256_file(stats_path)
    if stats_sha != stats_entry.get("sha256"):
        raise SnapshotError(
            f"{STATS_ARTIFACT} sha256 {stats_sha} does not match the manifest"
            f" entry {stats_entry.get('sha256')} for build {build_id} —"
            " refusing to reconcile against counts that are not the published"
            " ones"
        )
    stats = _read_json(stats_path, STATS_ARTIFACT)
    return ResolvedCorpus(
        build_id=build_id,
        manifest_path=manifest_path,
        asset_path=asset,
        sha256=actual_sha,
        bytes=actual_bytes,
        stats=stats,
    )


def backup_copy(source_path: Path, destination_path: Path) -> None:
    """Copy through SQLite's backup API (the ``run_build`` pattern).

    A plain filesystem copy of a live SQLite file can capture a torn page set
    and has no integrity contract; the backup API produces a consistent
    database or fails.
    """
    destination_path.parent.mkdir(parents=True, exist_ok=True)
    if destination_path.exists():
        destination_path.unlink()
    source = sqlite3.connect(f"file:{source_path}?mode=ro", uri=True)
    try:
        destination = sqlite3.connect(str(destination_path))
        try:
            source.backup(destination)
        finally:
            destination.close()
    finally:
        source.close()


def assert_copy(destination_path: Path, corpus: ResolvedCorpus, out=print) -> None:
    """Integrity + the manifest-listed corpus counts, before any ingestion."""
    conn = sqlite3.connect(str(destination_path))
    try:
        (integrity,) = conn.execute("PRAGMA integrity_check").fetchone()
        if integrity != "ok":
            raise SnapshotError(f"the Phase A copy failed integrity_check: {integrity}")
        counts = {
            "filings": conn.execute("SELECT COUNT(*) FROM filings").fetchone()[0],
            "transactions": conn.execute(
                "SELECT COUNT(*) FROM transactions"
            ).fetchone()[0],
            "v_default_transactions": conn.execute(
                "SELECT COUNT(*) FROM v_default_transactions"
            ).fetchone()[0],
        }
    finally:
        conn.close()

    totals = corpus.stats.get("totals") or {}
    default = corpus.stats.get("default") or {}
    expected = {
        "filings": totals.get("filing_count_including_excluded"),
        "transactions": totals.get("transaction_count_including_excluded"),
        "v_default_transactions": default.get("row_count"),
    }
    # ALL THREE counts are required, and each must be a real integer (R17/LD12).
    #
    # The first version skipped any count the stats artifact did not carry and
    # then printed "matches the published stats.json" for it anyway, so a
    # malformed or tampered artifact could bypass part of the mandatory
    # pre-ingest reconciliation while the snapshot reported successful
    # provenance verification (code review round 1, F4). Absent evidence is now
    # a hard stop, never a silent pass. `bool` is excluded explicitly because it
    # is an `int` subclass and `True == 1` would otherwise reconcile a
    # one-filing corpus.
    missing = [
        name
        for name, value in expected.items()
        if not isinstance(value, int) or isinstance(value, bool)
    ]
    if missing:
        raise SnapshotError(
            "the published stats.json carries no usable expected count for "
            + ", ".join(sorted(missing))
            + " — every one of filings, transactions, and v_default_transactions"
            " must be asserted before ingestion, so a missing or non-integer"
            " count is a hard stop, not a skipped check"
        )
    mismatches = [
        f"{name}: copy has {counts[name]}, the published stats.json says {value}"
        for name, value in expected.items()
        if value != counts[name]
    ]
    if mismatches:
        raise SnapshotError(
            "the Phase A copy does not reconcile with the published corpus: "
            + "; ".join(mismatches)
        )
    out(f"  integrity_check: {integrity}")
    for name in ("filings", "transactions", "v_default_transactions"):
        out(f"  {name}: {counts[name]} (matches the published stats.json)")


def run_snapshot(data_repo: Path | str, out_path: Path | str, out=print) -> int:
    try:
        corpus = resolve_corpus(Path(data_repo))
    except SnapshotError as exc:
        out(f"SNAPSHOT FAILED: {exc}")
        return 1
    out(f"resolved build_id: {corpus.build_id}")
    out(f"  manifest: {corpus.manifest_path}")
    out(f"  asset:    {corpus.asset_path}")
    out(f"  sha256:   {corpus.sha256} ({corpus.bytes} bytes) — matches the manifest")

    destination = Path(out_path)
    try:
        backup_copy(corpus.asset_path, destination)
        assert_copy(destination, corpus, out=out)
    except (SnapshotError, sqlite3.Error) as exc:
        out(f"SNAPSHOT FAILED: {exc}")
        return 1
    out(f"Phase A database ready: {destination}")
    out(
        "Provenance of every Phase A figure from here on:"
        f" published build {corpus.build_id}, congress.db sha256 {corpus.sha256}."
    )
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description=(
            "Resolve the published congress.db from a data repo's manifest,"
            " sha256-verify it, and copy it for the RUN M1-B Phase A operation."
        )
    )
    parser.add_argument(
        "--data-repo",
        required=True,
        help="the populus-data repository holding latest.json + builds/ + releases/",
    )
    parser.add_argument(
        "--out", required=True, help="destination path for the Phase A database copy"
    )
    args = parser.parse_args(argv)
    return run_snapshot(args.data_repo, args.out)


if __name__ == "__main__":
    sys.exit(main())
