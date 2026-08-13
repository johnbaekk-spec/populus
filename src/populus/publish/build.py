"""Build assembly, release backends, and the §5.5 publication sequence (RUN 5).

The durable-recovery design (R35): every build is captured in ONE
self-contained recovery journal — ``journal.json`` inlines the build metadata,
the manifest, every build-scoped small artifact verbatim, and the exact
``congress.db`` bytes. The journal is durably staged in the data repo
(``.staging/<build_id>/journal.json``) BEFORE any remote mutation, then
uploaded and verified as the FIRST remote object; the consumer ``congress.db``
asset is extracted from it (identical bytes) and the Release is published only
when both verify. ``reconcile_inflight`` runs before any new build_id is
allocated and COMPLETES the single possible in-flight build — it never
deletes a draft to abandon it. Automatic recovery takes no source database,
raw archive, or canonical-store input: its only inputs are the data repo
(including ``.staging/``) and the remote; the §13.5 canonical-store re-build
is an operator runbook path only.
"""

from __future__ import annotations

import base64
import hashlib
import json
import re
import shutil
import sqlite3
import subprocess  # nosec B404 — gh CLI invocation, argv-list only, no shell
import tempfile
from collections.abc import Callable
from dataclasses import dataclass, replace
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Protocol

from populus import licenses
from populus.amendments import (
    ViewVerificationError,
    ensure_views,
    materialized_inst_derivation_views,
    verify_views,
)
from populus.db import connect
from populus.ingest import UnsafeArchivePathError
from populus.ingest.inst13f import compute_coverage, compute_period_coverage
from populus.inst_agg import (
    _PreparedAggregate,
    build_inst_agg,
    prepared_materialized_inst_aggregate,
)
from populus.inst_serving import (
    build_serving_projection,
    publication_periods,
    write_serving_db,
)
from populus.normalize_inst import NORMALIZATION_VERSION as INST_NORMALIZATION_VERSION
from populus.publish import atomic_write_bytes
from populus.publish.attestation import AttestationProvider, StagingNoop
from populus.publish.digests import (
    projection_for,
    LOGICAL_PROJECTION_VERSIONS,
    LOGICAL_PROJECTIONS,
    DigestError,
    logical_digest,
    sha256_file,
)
from populus.publish.manifest import (
    DB_ARTIFACT,
    INST_CLIENT_COMPAT,
    INST_DB_ARTIFACT,
    INST_MODULE,
    INST_SCHEMA_VERSION,
    INST_SERVING_ARTIFACT,
    INST_SOURCE_ARTIFACT,
    INST_SOURCE_SCHEMA,
    validate_inst_source,
    JOURNAL_ASSET,
    LICENSING_ARTIFACTS,
    MODULE,
    ArtifactEntry,
    build_manifest,
    find_artifact,
    module_db_artifact,
    module_db_artifacts,
    pointer_manifest_identity_error,
    render_manifest,
    resolve_within,
    safe_artifact_name,
    check_module_dispositions,
    validate_manifest,
)
from populus.publish.pointer import (
    ISSUANCE_SKEW_SECONDS,
    build_pointer,
    parse_rfc3339z,
    render_pointer,
    rfc3339z,
    validate_pointer,
)
from populus.stats import DATA_NOTE, compute_stats, read_house_meta, render_stats

STAGING_DIR = ".staging"
JOURNAL_VERSION = "1"
FEED_LIMIT = 500
SLICE_LIMIT = 200

_BUILD_ID = re.compile(r"^\d{8}\.\d+$")

_FEED_COLUMNS = (
    "txn_id",
    "filing_id",
    "bioguide_id",
    "chamber",
    "owner",
    "ticker",
    "asset_name",
    "asset_type",
    "side",
    "transaction_date",
    "filed_date",
    "days_to_file",
    "is_late",
    "amount_low",
    "amount_high",
    "amount_label",
    "cap_gains_over_200",
    "comment",
    "flags",
    "source",
    "license_id",
)


class PublishError(RuntimeError):
    """A publication invariant refused the operation (§5.5)."""


class BackendError(RuntimeError):
    """A release backend operation failed or was refused."""


def _render_json(document: object) -> str:
    """Byte-stable rendering: sorted keys, two-space indent, one newline."""
    return json.dumps(document, ensure_ascii=False, indent=2, sort_keys=True) + "\n"


def _build_id_key(build_id: str) -> tuple[int, int]:
    date_part, seq = build_id.split(".")
    return (int(date_part), int(seq))


# --- release backends --------------------------------------------------------


@dataclass(frozen=True)
class ReleaseInfo:
    build_id: str
    draft: bool
    assets: tuple[str, ...]


class ReleaseBackend(Protocol):
    """One interface over the local-dir staging store and ``gh`` Releases.

    ``upload`` may clobber only on drafts; a published release is exact-byte
    immutable (verify-only). ``delete_release`` is drafts-only and exists for
    the operator runbook — automatic recovery never calls it.
    """

    def locator(self, build_id: str, name: str) -> tuple[str, str]: ...

    def list_published_tags(self, date: str | None = None) -> list[str]: ...

    def list_draft_tags(self, date: str | None = None) -> list[str]: ...

    def get_release(self, build_id: str) -> ReleaseInfo | None: ...

    def ensure_draft(self, build_id: str) -> None: ...

    def upload(
        self, build_id: str, path: Path, *, name: str | None = None, clobber: bool = False
    ) -> None: ...

    def verify_asset(
        self, build_id: str, name: str, *, sha256: str, size: int
    ) -> bool: ...

    def publish_release(self, build_id: str) -> None: ...

    def delete_release(self, build_id: str) -> None: ...

    def read_asset(self, build_id: str, name: str) -> bytes: ...


class LocalDirBackend:
    """Release semantics over ``<data_repo>/releases/data-<build_id>/``.

    The directory is gitignored (a ``releases/.gitignore`` containing ``*``)
    — assets are sha-verified through the manifest, never git-diffed. Draft
    state is a ``.draft`` marker file; publishing removes it, after which the
    directory is treated as immutable.
    """

    kind = "local-dir"

    def __init__(self, data_repo: Path | str) -> None:
        self._releases = Path(data_repo) / "releases"

    def _safe_path(self, build_id: str, *parts: str) -> Path:
        """The single backend path chokepoint (R29/F1/F3).

        EVERY backend path — the release directory, its ``.draft`` marker, and
        each asset — is built here; no backend method joins a path by raw
        string outside this method. Containment is enforced structurally:

        * ``build_id`` must match the ``YYYYMMDD.N`` grammar (a single segment,
          no separators/traversal);
        * every ``parts`` component must be a plain filename (no ``/``/``\\``,
          not ``.``/``..``/empty, no NUL);
        * the fully-resolved target (following ANY symlink, incl. a symlinked
          ``data-<build_id>`` component) must stay within the realpath'd
          ``releases/`` root.

        Any violation raises ``BackendError`` — a symlinked release directory
        can never redirect a read/write/unlink outside the backend root.
        """
        if _BUILD_ID.match(build_id) is None:
            raise BackendError(f"unsafe build_id {build_id!r}")
        for part in parts:
            if (
                part in ("", ".", "..")
                or "/" in part
                or "\\" in part
                or "\x00" in part
            ):
                raise BackendError(
                    f"unsafe release path component {part!r} for data-{build_id}"
                )
        # Owned-base tamper check (R29 / §14 boundary): the configured data_repo
        # root is a trusted operator input, but the `releases/` subdir Populus
        # OWNS AND CREATES must be a real directory — not a symlink swapped in.
        # Checked on the component itself, BEFORE `.resolve()` follows it.
        if self._releases.is_symlink():
            raise BackendError(
                "releases/ is a symlink — refusing (Populus-owned base must be a"
                " real directory it created)"
            )
        root = self._releases.resolve()
        resolved = root.joinpath(f"data-{build_id}", *parts).resolve()
        if resolved != root and root not in resolved.parents:
            raise BackendError(
                f"release path for data-{build_id} escapes the releases root {root}"
            )
        return resolved

    def _dir(self, build_id: str) -> Path:
        return self._safe_path(build_id)

    def _asset_path(self, build_id: str, name: str) -> Path:
        """Containment-checked absolute path to an asset (R29/F3), via the
        single ``_safe_path`` chokepoint."""
        try:
            return self._safe_path(build_id, name)
        except BackendError as exc:
            raise BackendError(
                f"unsafe asset name {name!r} for data-{build_id}: {exc}"
            ) from exc

    def _ensure_root(self) -> None:
        if self._releases.is_symlink():
            raise BackendError(
                "releases/ is a symlink — refusing (Populus-owned base must be a"
                " real directory it created)"
            )
        self._releases.mkdir(parents=True, exist_ok=True)
        gitignore = self._releases / ".gitignore"
        if not gitignore.exists():
            gitignore.write_text("*\n", encoding="utf-8")

    def locator(self, build_id: str, name: str) -> tuple[str, str]:
        return ("path", f"releases/data-{build_id}/{name}")

    def _list(self, *, draft: bool, date: str | None) -> list[str]:
        if not self._releases.is_dir():
            return []
        found: list[str] = []
        for entry in sorted(self._releases.iterdir()):
            if not entry.is_dir() or not entry.name.startswith("data-"):
                continue
            build_id = entry.name[len("data-") :]
            if _BUILD_ID.match(build_id) is None:
                continue
            if date is not None and not build_id.startswith(f"{date}."):
                continue
            try:  # the .draft check routes through the containment chokepoint
                is_draft = self._safe_path(build_id, ".draft").exists()
            except BackendError:
                continue  # a symlinked/escaping release dir is not listable
            if is_draft == draft:
                found.append(build_id)
        return found

    def list_published_tags(self, date: str | None = None) -> list[str]:
        return self._list(draft=False, date=date)

    def list_draft_tags(self, date: str | None = None) -> list[str]:
        return self._list(draft=True, date=date)

    def get_release(self, build_id: str) -> ReleaseInfo | None:
        directory = self._dir(build_id)  # chokepoint: raises on symlink escape
        if not directory.is_dir():
            return None
        draft = self._safe_path(build_id, ".draft").exists()
        assets = tuple(
            sorted(
                entry.name
                for entry in directory.iterdir()
                if entry.is_file() and entry.name != ".draft"
            )
        )
        return ReleaseInfo(build_id, draft, assets)

    def ensure_draft(self, build_id: str) -> None:
        release = self.get_release(build_id)
        if release is None:
            self._ensure_root()
            directory = self._dir(build_id)
            directory.mkdir(parents=True, exist_ok=True)
            self._safe_path(build_id, ".draft").touch()
        elif not release.draft:
            raise BackendError(f"release data-{build_id} is already published")

    def upload(
        self, build_id: str, path: Path, *, name: str | None = None, clobber: bool = False
    ) -> None:
        release = self.get_release(build_id)
        if release is None:
            raise BackendError(f"no release data-{build_id} to upload into")
        asset_name = name or Path(path).name
        dest = self._asset_path(build_id, asset_name)
        data = Path(path).read_bytes()
        if dest.exists() and dest.read_bytes() == data:
            return  # exact-byte idempotent re-upload
        if not release.draft:
            raise BackendError(
                f"release data-{build_id} is published — assets are immutable"
            )
        if dest.exists() and not clobber:
            raise BackendError(
                f"asset {asset_name} already exists on draft data-{build_id}"
                " and clobber was not requested"
            )
        atomic_write_bytes(dest, data)

    def verify_asset(
        self, build_id: str, name: str, *, sha256: str, size: int
    ) -> bool:
        release = self.get_release(build_id)
        if release is None or name not in release.assets:
            return False
        asset = self._asset_path(build_id, name)
        return asset.stat().st_size == size and sha256_file(asset) == sha256

    def publish_release(self, build_id: str) -> None:
        release = self.get_release(build_id)
        if release is None:
            raise BackendError(f"no release data-{build_id} to publish")
        marker = self._safe_path(build_id, ".draft")  # chokepoint before unlink
        if marker.exists():
            marker.unlink()

    def delete_release(self, build_id: str) -> None:
        release = self.get_release(build_id)
        if release is None:
            raise BackendError(f"no release data-{build_id} to delete")
        if not release.draft:
            raise BackendError(
                f"release data-{build_id} is published — delete_release is"
                " drafts-only (operator runbook)"
            )
        shutil.rmtree(self._dir(build_id))

    def read_asset(self, build_id: str, name: str) -> bytes:
        asset = self._asset_path(build_id, name)
        if not asset.is_file():
            raise BackendError(f"release data-{build_id} has no asset {name}")
        return asset.read_bytes()


def _run_gh(args: list[str]) -> tuple[int, str, str]:
    """The real ``gh`` invocation (argv list, no shell); mock-replaced in tests."""
    proc = subprocess.run(  # nosec B603 B607 — fixed binary, argv list
        ["gh", *args], capture_output=True, text=True
    )
    return (proc.returncode, proc.stdout, proc.stderr)


class GhReleaseBackend:
    """Release semantics over ``gh release`` against the private staging repo.

    Authentication comes from the step-scoped ``GH_TOKEN`` environment the
    workflow injects (§14/R33) — this class never handles the token itself.
    The command *transport* is injectable; tests exercise command construction
    and lifecycle through a recording shim, the real network path is P2
    operational (declared debt).
    """

    kind = "gh-release"

    def __init__(
        self,
        repo_slug: str,
        *,
        transport: Callable[[list[str]], tuple[int, str, str]] | None = None,
    ) -> None:
        self._repo = repo_slug
        self._gh = transport if transport is not None else _run_gh

    def _tag(self, build_id: str) -> str:
        return f"data-{build_id}"

    def locator(self, build_id: str, name: str) -> tuple[str, str]:
        return (
            "url",
            f"https://github.com/{self._repo}/releases/download/"
            f"data-{build_id}/{name}",
        )

    def _run(self, args: list[str]) -> str:
        code, out, err = self._gh(args)
        if code != 0:
            raise BackendError(
                f"gh {' '.join(args[:2])} failed ({code}): {err.strip() or out.strip()}"
            )
        return out

    def get_release(self, build_id: str) -> ReleaseInfo | None:
        code, out, err = self._gh(
            [
                "release",
                "view",
                self._tag(build_id),
                "--repo",
                self._repo,
                "--json",
                "isDraft,assets",
            ]
        )
        if code != 0:
            if "not found" in (err + out).lower():
                return None
            raise BackendError(f"gh release view failed ({code}): {err.strip()}")
        # `gh` output is remote, external bytes — a malformed or unexpected-
        # SHAPE response is a backend error, never an uncaught JSON/KeyError/
        # attr traceback. Every nested field touched below is type-checked at
        # this boundary (F8): `assets` is a list, each asset a dict with a
        # string `name`, and `isDraft` a bool.
        try:
            payload = json.loads(out)
            if not isinstance(payload, dict):
                raise ValueError("expected a JSON object")
        except ValueError as exc:
            raise BackendError(
                f"gh release view returned unparseable JSON: {exc}"
            ) from exc
        assets_raw = payload.get("assets")
        if assets_raw is None:
            assets_raw = []
        if not isinstance(assets_raw, list):
            raise BackendError("gh release view returned a non-list assets field")
        names: list[str] = []
        for asset in assets_raw:
            if not isinstance(asset, dict) or not isinstance(asset.get("name"), str):
                raise BackendError(
                    "gh release view returned a malformed asset record"
                )
            names.append(asset["name"])
        is_draft = payload.get("isDraft")
        if not isinstance(is_draft, bool):
            raise BackendError("gh release view returned a non-boolean isDraft")
        return ReleaseInfo(build_id, is_draft, tuple(sorted(names)))

    def _list(self, *, draft: bool, date: str | None) -> list[str]:
        out = self._run(
            [
                "release",
                "list",
                "--repo",
                self._repo,
                "--json",
                "tagName,isDraft",
                "--limit",
                "1000",
            ]
        )
        found: list[str] = []
        try:
            rows = json.loads(out or "[]")
            if not isinstance(rows, list):
                raise ValueError("expected a JSON array")
        except ValueError as exc:
            raise BackendError(
                f"gh release list returned unparseable JSON: {exc}"
            ) from exc
        for row in rows:
            # Shape-check each remote record before any field access. A
            # malformed record (not an object, or a non-string tagName /
            # non-bool isDraft) fails CLOSED with a BackendError — consistent
            # with get_release — rather than being silently skipped, so a
            # corrupt listing can never masquerade as "no such release" and let
            # recovery mis-decide (F1). A well-formed record whose tag is simply
            # not one of ours is legitimately skipped below.
            if not isinstance(row, dict):
                raise BackendError("gh release list returned a non-object record")
            tag = row.get("tagName")
            is_draft = row.get("isDraft")
            if not isinstance(tag, str) or not isinstance(is_draft, bool):
                raise BackendError("gh release list returned a malformed record")
            if not tag.startswith("data-"):
                continue
            build_id = tag[len("data-") :]
            if _BUILD_ID.match(build_id) is None:
                continue
            if date is not None and not build_id.startswith(f"{date}."):
                continue
            if is_draft == draft:
                found.append(build_id)
        return sorted(found)

    def list_published_tags(self, date: str | None = None) -> list[str]:
        return self._list(draft=False, date=date)

    def list_draft_tags(self, date: str | None = None) -> list[str]:
        return self._list(draft=True, date=date)

    def ensure_draft(self, build_id: str) -> None:
        release = self.get_release(build_id)
        if release is None:
            tag = self._tag(build_id)
            self._run(
                [
                    "release",
                    "create",
                    tag,
                    "--repo",
                    self._repo,
                    "--draft",
                    "--title",
                    tag,
                    "--notes",
                    f"Populus data build {build_id} (ARCHITECTURE.md §5.5)",
                ]
            )
        elif not release.draft:
            raise BackendError(f"release data-{build_id} is already published")

    def upload(
        self, build_id: str, path: Path, *, name: str | None = None, clobber: bool = False
    ) -> None:
        source = Path(path)
        asset_name = name or source.name
        # R32/F7: enforce the immutability contract inside the backend —
        # clobber is permitted only on drafts; a published release is
        # verify-only (exact-byte idempotent, otherwise refused), regardless
        # of the clobber flag or any state race between callers.
        release = self.get_release(build_id)
        if release is None:
            raise BackendError(f"no release data-{build_id} to upload into")
        if not release.draft:
            data = source.read_bytes()
            if self.verify_asset(
                build_id,
                asset_name,
                sha256=hashlib.sha256(data).hexdigest(),
                size=len(data),
            ):
                return  # exact-byte idempotent re-upload of a published asset
            raise BackendError(
                f"release data-{build_id} is published — assets are immutable"
                " (verify-only, no clobber)"
            )
        with tempfile.TemporaryDirectory(prefix="populus-upload-") as scratch:
            upload_path = source
            if asset_name != source.name:
                upload_path = Path(scratch) / asset_name
                shutil.copyfile(source, upload_path)
            args = [
                "release",
                "upload",
                self._tag(build_id),
                str(upload_path),
                "--repo",
                self._repo,
            ]
            if clobber:
                args.append("--clobber")
            self._run(args)

    def verify_asset(
        self, build_id: str, name: str, *, sha256: str, size: int
    ) -> bool:
        with tempfile.TemporaryDirectory(prefix="populus-verify-") as scratch:
            code, _out, _err = self._gh(
                [
                    "release",
                    "download",
                    self._tag(build_id),
                    "--repo",
                    self._repo,
                    "--pattern",
                    name,
                    "--dir",
                    scratch,
                ]
            )
            if code != 0:
                return False
            asset = Path(scratch) / name
            return (
                asset.is_file()
                and asset.stat().st_size == size
                and sha256_file(asset) == sha256
            )

    def publish_release(self, build_id: str) -> None:
        self._run(
            [
                "release",
                "edit",
                self._tag(build_id),
                "--repo",
                self._repo,
                "--draft=false",
            ]
        )

    def delete_release(self, build_id: str) -> None:
        release = self.get_release(build_id)
        if release is None:
            raise BackendError(f"no release data-{build_id} to delete")
        if not release.draft:
            raise BackendError(
                f"release data-{build_id} is published — delete_release is"
                " drafts-only (operator runbook)"
            )
        self._run(
            ["release", "delete", self._tag(build_id), "--repo", self._repo, "--yes"]
        )

    def read_asset(self, build_id: str, name: str) -> bytes:
        # Downloads into a caller-owned scratch dir that is always cleaned up
        # (F9) — the journal + embedded DB never leak into unmanaged storage.
        with tempfile.TemporaryDirectory(prefix="populus-asset-") as scratch:
            self._run(
                [
                    "release",
                    "download",
                    self._tag(build_id),
                    "--repo",
                    self._repo,
                    "--pattern",
                    name,
                    "--dir",
                    scratch,
                ]
            )
            asset = Path(scratch) / name
            if not asset.is_file():
                raise BackendError(
                    f"release data-{build_id} download missing {name}"
                )
            return asset.read_bytes()


# --- the recovery journal (R35) ----------------------------------------------


def render_journal(journal: dict) -> str:
    """Deterministic journal rendering (sorted keys, one trailing newline)."""
    return _render_json(journal)


def journal_sha256(journal_bytes: bytes) -> str:
    return hashlib.sha256(journal_bytes).hexdigest()


def build_journal(staged_dir: Path, manifest: dict, db_path: Path) -> bytes:
    """The self-contained recovery journal for one staged build.

    Inlines ``build_id``/``created_at``/``previous_build_id``/``watermarks``,
    the exact ``congress.db`` bytes (base64) with the manifest-recorded
    ``sha256``/``bytes``/``logical_digest``, and every build-scoped small
    artifact verbatim (including ``manifest.json``).
    """
    build_dir = Path(staged_dir) / "build"
    db_entry = find_artifact(manifest, DB_ARTIFACT)
    if db_entry is None:
        raise PublishError("manifest lists no congress.db artifact")
    db_bytes = Path(db_path).read_bytes()
    if (
        hashlib.sha256(db_bytes).hexdigest() != db_entry["sha256"]
        or len(db_bytes) != db_entry["bytes"]
    ):
        raise PublishError(
            "database snapshot does not match its manifest entry — refusing to"
            " journal an inconsistent build"
        )
    artifacts: dict[str, str] = {}
    for path in sorted(build_dir.rglob("*")):
        if path.is_file():
            artifacts[path.relative_to(build_dir).as_posix()] = path.read_text(
                encoding="utf-8"
            )
    journal = {
        "journal_version": JOURNAL_VERSION,
        "build_id": manifest["build_id"],
        "created_at": manifest["created_at"],
        "previous_build_id": manifest["previous_build_id"],
        "watermarks": manifest["modules"][MODULE]["watermarks"],
        "db": {
            "name": DB_ARTIFACT,
            "sha256": db_entry["sha256"],
            "bytes": db_entry["bytes"],
            "logical_digest": db_entry["logical_digest"],
            "b64": base64.b64encode(db_bytes).decode("ascii"),
        },
        "artifacts": artifacts,
    }
    return render_journal(journal).encode("utf-8")


def journal_load(journal_bytes: bytes) -> dict:
    """Parse and fully validate a journal; raises :class:`PublishError`."""
    try:
        journal = json.loads(journal_bytes.decode("utf-8"))
    except (UnicodeDecodeError, ValueError) as exc:
        raise PublishError(f"unparseable journal: {exc}") from exc
    if not isinstance(journal, dict) or journal.get("journal_version") != JOURNAL_VERSION:
        raise PublishError("journal has a missing or unsupported journal_version")
    build_id = journal.get("build_id")
    if not isinstance(build_id, str) or _BUILD_ID.match(build_id) is None:
        raise PublishError("journal build_id must match YYYYMMDD.N")
    artifacts = journal.get("artifacts")
    if (
        not isinstance(artifacts, dict)
        or "manifest.json" not in artifacts
        or not all(
            isinstance(text, str) and safe_artifact_name(relpath)
            for relpath, text in artifacts.items()
        )
    ):
        raise PublishError("journal artifacts must map safe relpaths to text,"
                           " including manifest.json")
    db_block = journal.get("db")
    if not isinstance(db_block, dict) or set(db_block) != {
        "name",
        "sha256",
        "bytes",
        "logical_digest",
        "b64",
    }:
        raise PublishError("journal db block has the wrong shape")
    try:
        db_bytes = base64.b64decode(db_block["b64"], validate=True)
    except (ValueError, TypeError) as exc:
        raise PublishError(f"journal db bytes do not decode: {exc}") from exc
    if (
        hashlib.sha256(db_bytes).hexdigest() != db_block["sha256"]
        or len(db_bytes) != db_block["bytes"]
    ):
        raise PublishError("journal db bytes do not match their declared digest")
    try:
        manifest = json.loads(artifacts["manifest.json"])
    except ValueError as exc:
        raise PublishError(f"journal manifest does not parse: {exc}") from exc
    manifest_errors = validate_manifest(manifest)
    if manifest_errors:
        raise PublishError(
            "journal manifest is invalid: " + "; ".join(manifest_errors)
        )
    if manifest["build_id"] != build_id or manifest["created_at"] != journal.get(
        "created_at"
    ):
        raise PublishError("journal metadata disagrees with its manifest")
    db_entry = find_artifact(manifest, DB_ARTIFACT)
    if db_entry is None or (
        db_entry["sha256"] != db_block["sha256"]
        or db_entry["bytes"] != db_block["bytes"]
        or db_entry["logical_digest"] != db_block["logical_digest"]
    ):
        raise PublishError("journal db block disagrees with the manifest entry")
    for relpath, text in artifacts.items():
        entry = find_artifact(manifest, relpath)
        if relpath == "manifest.json":
            continue
        if entry is None:
            raise PublishError(f"journal artifact {relpath} is not in the manifest")
        data = text.encode("utf-8")
        if (
            hashlib.sha256(data).hexdigest() != entry["sha256"]
            or len(data) != entry["bytes"]
        ):
            raise PublishError(
                f"journal artifact {relpath} does not match its manifest entry"
            )
    for entry in manifest["modules"][MODULE]["artifacts"]:
        if entry["name"] != DB_ARTIFACT and entry["name"] not in artifacts:
            raise PublishError(
                f"manifest artifact {entry['name']} is missing from the journal"
                " — refusing a partial build"
            )
    return journal


def journal_valid(journal_bytes: bytes) -> bool:
    try:
        journal_load(journal_bytes)
    except PublishError:
        return False
    return True


def journal_db_bytes(journal: dict) -> bytes:
    return base64.b64decode(journal["db"]["b64"], validate=True)


def journal_manifest(journal: dict) -> dict:
    return json.loads(journal["artifacts"]["manifest.json"])


def _assert_owned_base_real(base: Path, label: str) -> None:
    """A Populus-owned base subdir must be a real directory it created — not a
    symlink swapped in (R29 / §14 boundary tamper-detection).

    The configured ``data_repo`` root is a trusted operator input (a symlink
    planted there already implies publisher-filesystem write access — outside
    the threat model). This is the bounded, cheap check on the specific
    subdirectory Populus OWNS AND CREATES; it does NOT walk parents.
    """
    if base.is_symlink():
        raise PublishError(
            f"{label} is a symlink — refusing (Populus-owned base must be a"
            " real directory it created)"
        )


def _build_dir_escape_error(dest_builds_dir: Path, build_id: str) -> str | None:
    """A ``builds/<build_id>`` component that escapes the ``builds/`` root.

    Containment is rooted at the FIXED ``builds/`` directory: a symlinked
    ``builds/<build_id>`` (or a build_id that resolves outside) would redirect
    artifact writes outside the data repo (R29/F2). Returns an error string, or
    ``None`` when the component is a real directory contained under the root.
    """
    builds_root = Path(dest_builds_dir)
    # Owned-base tamper check (R29 / §14 boundary): the `builds/` subdir Populus
    # owns and creates must be a real directory, not a symlink swapped in (the
    # configured data_repo root itself is a trusted operator input).
    if builds_root.is_symlink():
        return "builds/ is a symlink — refusing (Populus-owned base must be a real directory)"
    build_dir = builds_root / build_id
    if build_dir.is_symlink():
        return f"builds/{build_id} is a symlink — refusing to materialize"
    try:
        resolve_within(builds_root, build_id)
    except UnsafeArchivePathError as exc:
        return f"builds/{build_id} escapes the builds root: {exc}"
    if build_dir.exists():
        root_real = builds_root.resolve()
        resolved = build_dir.resolve()
        if resolved != root_real / build_id:
            return f"builds/{build_id} resolves outside the builds root"
    return None


def materialize_from_journal(journal_bytes: bytes, dest_builds_dir: Path) -> str:
    """Write ``builds/<build_id>/`` from the journal, byte-for-byte verbatim.

    Idempotent: re-materializing writes identical bytes. The DB stays a
    Release asset — consumers reach it through the manifest locator, never
    through git.

    Containment (R29/F2): a symlinked ``builds/<build_id>`` is refused, and
    every artifact target is resolved from the FIXED ``builds/`` root (not the
    possibly-symlinked build dir), so nothing can be written outside ``builds/``.
    """
    journal = journal_load(journal_bytes)
    build_id = journal["build_id"]
    builds_root = Path(dest_builds_dir)
    escape = _build_dir_escape_error(builds_root, build_id)
    if escape is not None:
        raise PublishError(escape)
    (builds_root / build_id).mkdir(parents=True, exist_ok=True)
    for relpath, text in sorted(journal["artifacts"].items()):
        target = resolve_within(builds_root, f"{build_id}/{relpath}")
        atomic_write_bytes(target, text.encode("utf-8"))
    return build_id


# --- build-id allocation (R31) -----------------------------------------------


def next_build_id(data_repo: Path | str, today: date, backend: ReleaseBackend) -> str:
    """``YYYYMMDD.N`` from durable state: committed builds, published release
    tags, and staged builds — called only after ``reconcile_inflight`` has
    driven any in-flight draft to completion."""
    date_str = today.strftime("%Y%m%d")
    highest = 0

    def _consider(build_id: str) -> None:
        nonlocal highest
        if _BUILD_ID.match(build_id) and build_id.startswith(f"{date_str}."):
            highest = max(highest, int(build_id.split(".")[1]))

    data_repo = Path(data_repo)
    builds_dir = data_repo / "builds"
    if builds_dir.is_dir():
        for entry in builds_dir.iterdir():
            if entry.is_dir():
                _consider(entry.name)
    for build_id in backend.list_published_tags(date_str):
        _consider(build_id)
    staging_root = data_repo / STAGING_DIR
    if staging_root.is_dir():
        for entry in staging_root.iterdir():
            if entry.is_dir():
                _consider(entry.name)
    # DURABLE high-water mark. Every other input above is erasable: the
    # documented drafts-only cleanup (rollback.md Appendix A) deletes the draft
    # AND the staged build, after which a same-day rebuild would otherwise
    # REALLOCATE the interrupted id — binding one immutable build identity to
    # two different byte sets (QA-F1, round 7). The mark lives at the
    # DATA-REPOSITORY ROOT, which survives that cleanup, so an allocated id is
    # never handed out twice.
    _consider(f"{date_str}.{_allocation_high_water(data_repo, date_str)}")
    allocated = highest + 1
    _record_allocation(data_repo, date_str, allocated)
    return f"{date_str}.{allocated}"


#: Durable record of the highest build sequence allocated per date. It lives at
#: the DATA-REPO ROOT — deliberately NOT in `builds/` (which must not exist
#: before finalize, and whose base is symlink-guarded) and not in `.staging/` or
#: the release (both erased by the drafts-only cleanup). Build ids are immutable
#: identities, so an allocated id is never handed out twice (QA-F1, round 7).
ALLOCATIONS_FILE = ".build-allocations.json"


def _allocations_path(data_repo: Path) -> Path:
    return Path(data_repo) / ALLOCATIONS_FILE


def _allocation_high_water(data_repo: Path, date_str: str) -> int:
    path = _allocations_path(data_repo)
    if not path.is_file():
        return 0
    try:
        record = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return 0
    value = record.get(date_str) if isinstance(record, dict) else None
    return value if isinstance(value, int) and value >= 0 else 0


def _record_allocation(data_repo: Path, date_str: str, sequence: int) -> None:
    path = _allocations_path(data_repo)
    record: dict = {}
    if path.is_file():
        try:
            loaded = json.loads(path.read_text(encoding="utf-8"))
            if isinstance(loaded, dict):
                record = loaded
        except (OSError, ValueError):
            record = {}
    if sequence <= record.get(date_str, 0):
        return
    record[date_str] = sequence
    atomic_write_bytes(
        path, (json.dumps(record, sort_keys=True) + "\n").encode("utf-8")
    )


# --- reconcile + completion (R25/R35) ----------------------------------------


@dataclass(frozen=True)
class ReconcileReport:
    completed: tuple[str, ...]
    actions: tuple[str, ...]


def _staged_journal_path(data_repo: Path, build_id: str) -> Path:
    return Path(data_repo) / STAGING_DIR / build_id / "journal.json"


def _recover_journal(
    data_repo: Path, build_id: str, backend: ReleaseBackend
) -> bytes:
    """The build's journal bytes: verified remote asset first, staged copy else.

    Automatic recovery reads nothing but the data repo and the remote — a
    build recoverable from neither is an operator problem (§13.5 runbook),
    stated loudly, never silently deleted.
    """
    def _valid(candidate: bytes | None) -> bytes | None:
        if (
            candidate is not None
            and journal_valid(candidate)
            and journal_load(candidate)["build_id"] == build_id
        ):
            return candidate
        return None

    remote: bytes | None = None
    release = backend.get_release(build_id)
    if release is not None and JOURNAL_ASSET in release.assets:
        try:
            remote = _valid(backend.read_asset(build_id, JOURNAL_ASSET))
        except (BackendError, OSError):
            remote = None
    staged_path = _staged_journal_path(data_repo, build_id)
    staged = _valid(staged_path.read_bytes()) if staged_path.is_file() else None
    if remote is not None and staged is not None and remote != staged:
        raise PublishError(
            f"staged journal for build {build_id} differs from the release's"
            " journal asset — refusing to re-publish a differing build;"
            " existing assets unchanged"
        )
    if remote is not None:
        return remote
    if staged is not None:
        return staged
    raise PublishError(
        f"no valid recovery journal for in-flight build {build_id}: neither the"
        f" release asset nor {STAGING_DIR}/{build_id}/journal.json is usable —"
        " complete it via the §13.5 disaster-recovery runbook (automatic"
        " recovery never re-reads source databases and never deletes a draft)"
    )


def _committed_build_conflict(
    data_repo: Path, build_id: str, journal: dict
) -> str | None:
    """A committed ``builds/<build_id>/`` file that differs from the journal.

    A committed build is immutable: the same ``build_id`` must always carry
    identical bytes. This compares EVERY git-tracked artifact the journal
    carries (manifest, feed, stats, per-entity slices, the licensing set) —
    not just ``manifest.json`` — against what is already committed, and returns
    the first mismatch (or ``None``). Callers run it in preflight, BEFORE any
    draft/upload/publish/materialize, so a conflicting republish refuses with
    ZERO mutations rather than after the release is already armed (R25/F2).
    """
    build_dir = Path(data_repo) / "builds" / build_id
    if not build_dir.is_dir():
        return None
    for relpath, text in journal["artifacts"].items():
        try:
            committed = resolve_within(build_dir, relpath)
        except UnsafeArchivePathError:
            return f"builds/{build_id}/{relpath} has an unsafe path"
        if committed.is_file() and committed.read_bytes() != text.encode("utf-8"):
            return (
                f"builds/{build_id}/{relpath} differs from the journal —"
                " refusing to overwrite a committed build"
            )
    return None


def require_complete_inst_module(
    aggregate_digest: str | None, serving_digest: str | None
) -> None:
    """R10's compensating control (QA M2-8 M12): both inst databases, or neither.

    `REQUIRED_INST_ARTIFACTS` deliberately does NOT list `inst_serving.db`. A
    hard entry there would invalidate every pre-M2-8 manifest — including a
    rollback target that was correct when it was published — which is a real
    constraint and the right call for the VALIDATOR.

    But optionality is only safe if something fails when a POST-M2-8 build omits
    the artifact, and nothing did: "optional" and "absent because nobody wrote
    the producer" were indistinguishable, which is exactly the state the
    increment shipped in. Every published build reported
    `per_filer_detail.published = false` and every per-filer request fell through
    to live EDGAR, while the manifest reported the module as published.

    So the requirement lives at the PRODUCER instead. Old manifests keep
    validating; a new build cannot silently regress to aggregate-only.
    """
    if aggregate_digest is not None and serving_digest is None:
        raise PublishError(
            f"the inst module cleared its gate and produced {INST_DB_ARTIFACT}"
            f" but not {INST_SERVING_ARTIFACT}. Since RUN M2-8 both are required"
            " of a build that publishes the module — per-filer detail would"
            " otherwise fall back to live EDGAR while the manifest reports the"
            " module as published (plan R9/R10)."
        )


def _inst_data_present(conn: sqlite3.Connection) -> bool:
    """Whether *conn* carries institutional data to derive from.

    Absence is decided by SCHEMA, not by whether a query happened to fail.

    An M1-ONLY database has no inst tables at all. `ensure_views` applies
    the inst view DDL unconditionally (SQLite accepts a view over a
    missing table), so the view exists while `inst_filings` does not, and
    probing the view raises rather than answering "absent". Discovered
    rebuilding a published congress.db, which carries the congress module
    only (RUN M1-B, stage B).

    The first version caught `sqlite3.OperationalError` around the probe,
    which read EVERY operational fault as "institutional data absent" — a
    malformed view, an incompatible schema, a locked or corrupt database
    could silently publish a congress-only build and drop a real
    institutional corpus on the floor (code review round 1, F3). So the
    missing-table case is identified positively, against `sqlite_master`,
    and the probe itself is left UNGUARDED: if the table is there, any
    error querying the view is a genuine fault and propagates out of
    `run_build` as a visible publication failure (R13/R16/R18).

    Presence is asked of the RECONCILED population, never of the default
    view (M2-7, external review F2): the default view excludes
    cover-conflict filings, so a corpus made entirely of conflicts must
    read as withheld-with-named-exclusions, not as absence.
    """
    inst_table_present = (
        conn.execute(
            "SELECT 1 FROM sqlite_master WHERE type = 'table'"
            " AND name = 'inst_filings'"
        ).fetchone()
        is not None
    )
    return inst_table_present and (
        conn.execute(
            "SELECT 1 FROM v_inst_reconciled_filings LIMIT 1"
        ).fetchone()
        is not None
    )


def _read_inst_source_meta(conn: sqlite3.Connection) -> dict:
    """The snapshot's own ``inst_source_meta`` row, strictly (R24).

    Written into the snapshot by ``scripts/inst_snapshot.py`` BEFORE the file
    was hashed, so every provenance field stage-build publishes comes from
    inside the hashed bytes — no filename parsing, no filesystem timestamps.
    Exactly one row; anything else means the snapshot was not cut by the R23
    protocol and is refused.
    """
    remediation = (
        " — this snapshot was not finalized by scripts/inst_snapshot.py;"
        " re-cut it with that protocol"
    )
    if (
        conn.execute(
            "SELECT 1 FROM sqlite_master WHERE type = 'table'"
            " AND name = 'inst_source_meta'"
        ).fetchone()
        is None
    ):
        raise PublishError(f"snapshot has no inst_source_meta table{remediation}")
    rows = conn.execute(
        "SELECT schema_version, snapshot_version, created_at_utc,"
        " view_definition_digest FROM inst_source_meta"
    ).fetchall()
    if len(rows) != 1:
        raise PublishError(
            f"inst_source_meta must carry exactly one row, found {len(rows)}"
            f"{remediation}"
        )
    schema_version, snapshot_version, created_at_utc, view_digest = rows[0]
    return {
        "schema_version": schema_version,
        "snapshot_version": snapshot_version,
        "created_at_utc": created_at_utc,
        "view_definition_digest": view_digest,
    }


def _derive_inst_module(
    source: sqlite3.Connection,
    *,
    inst_agg_path: Path,
    inst_serving_path: Path,
    created_at: str,
    end_read_txn: Callable[[], None] | None = None,
) -> dict:
    """Materialize the reviewed default population once for a complete derive."""
    with materialized_inst_derivation_views(source):
        with prepared_materialized_inst_aggregate(source) as prepared:
            try:
                return _derive_inst_module_in_materialized_scope(
                    source,
                    inst_agg_path=inst_agg_path,
                    inst_serving_path=inst_serving_path,
                    created_at=created_at,
                    end_read_txn=end_read_txn,
                    _prepared=prepared,
                )
            except BaseException as primary_error:
                cleanup_errors: list[BaseException] = []
                if end_read_txn is not None and source.in_transaction:
                    try:
                        source.execute("ROLLBACK")
                    except BaseException as exc:
                        cleanup_errors.append(exc)
                attached = False
                if not source.in_transaction:
                    try:
                        attached = any(
                            row[1] == "inst_agg"
                            for row in source.execute("PRAGMA database_list")
                        )
                    except BaseException as exc:
                        cleanup_errors.append(exc)
                if attached:
                    try:
                        source.execute("DETACH DATABASE inst_agg")
                    except BaseException:
                        try:
                            source.execute("DETACH DATABASE inst_agg")
                        except BaseException as exc:
                            cleanup_errors.append(exc)
                for error in cleanup_errors:
                    primary_error.add_note(
                        f"inst derive cleanup also failed:"
                        f" {type(error).__name__}: {error}"
                    )
                raise


def _derive_inst_module_in_materialized_scope(
    source: sqlite3.Connection,
    *,
    inst_agg_path: Path,
    inst_serving_path: Path,
    created_at: str,
    end_read_txn: Callable[[], None] | None = None,
    _prepared: _PreparedAggregate | None = None,
) -> dict:
    """The full inst gate + derivation against *source*, for both input shapes.

    *source* is either the congress build snapshot (the pre-M2-11 path) or the
    accepted external snapshot's read-only handle (RUN M2-11, R1). Everything
    here READS *source* and writes only the two derived databases, so the same
    sequence serves both; the read-only enforcement on the external handle is
    the connection's own ``mode=ro`` (R2), not a property of this function.

    ``end_read_txn`` is the external-snapshot seam (R16): the caller's single
    explicit read transaction must span through ``build_serving_projection``,
    but SQLite refuses DETACH inside an open transaction, so the caller hands
    in its commit and it runs after the projection is fully read, before the
    DETACH. ``None`` (the congress path) preserves today's behaviour exactly.
    """
    build_inst_agg(
        source,
        inst_agg_path,
        ingested_at=created_at,
        _prepared=_prepared,
    )
    # Fail-closed gate (OWNER DECISION 2026-07-24): consume the reused
    # compute_coverage's `meets_threshold` at exactly COVERAGE_THRESHOLD,
    # keyed on the cover_failed flag — never re-derived here, never
    # widened by FTD inference. Coverage is never re-keyed off
    # `total IS NULL`.
    coverage = compute_coverage(source)
    # Per-period figures are REPORTING ONLY (R9/R11): the corpus-wide
    # gate decision above is unchanged. They ride along on the report and,
    # for a withheld build, name the quarters that carry no list coverage.
    period_coverage = compute_period_coverage(source)
    derived: dict = {
        "inst_logical": None,
        "inst_serving_logical": None,
        "inst_watermarks": None,
        "inst_withheld": None,
        "inst_period_coverage": [
            {
                "period_of_report": period.period_of_report,
                "denominator": period.denominator,
                "numerator": period.numerator,
                "coverage": period.coverage,
                "covered_by_list": period.covered_by_list,
            }
            for period in period_coverage
        ],
        # M2-7 §I5: the dispositions behind the numbers, on EVERY measured
        # build. A published coverage figure that does not say which filings
        # were excluded to produce it is the silence the rule forbids.
        "inst_cover_dispositions": {
            "cover_rounding_count": coverage.cover_rounding_count,
            "cover_rounding_max_delta_usd": coverage.cover_rounding_max_delta_usd,
            "cover_conflict_count": coverage.cover_conflict_count,
            "cover_conflict_filing_ids": list(coverage.cover_conflict_filing_ids),
        },
    }
    if not coverage.meets_threshold:
        if coverage.cover_failed_count > 0:
            reason = "cover_failed"
        elif not coverage.certifiable:
            reason = "not_measurable"
        else:
            reason = "below_threshold"
        derived["inst_withheld"] = {
            "reason": reason,
            "denominator": coverage.denominator,
            "numerator": coverage.numerator,
            "coverage": coverage.coverage,
            "cover_failed_count": coverage.cover_failed_count,
            "certifiable": coverage.certifiable,
            # R11: name the uncovered quarters (periods with no covering
            # definitional list). Additive — the typed `reason` set and
            # the 0.95 threshold are unchanged; an uncovered quarter keeps
            # exactly today's FTD-only arithmetic and fails closed.
            "uncovered_quarters": [
                period.period_of_report
                for period in period_coverage
                if not period.covered_by_list
            ],
            # M2-7 §I5: the withheld-reason surface names the excluded
            # conflicts too. A `not_measurable` build must be readable as
            # "these filings, by filing_id", never as an unexplained no.
            "cover_rounding_count": coverage.cover_rounding_count,
            "cover_rounding_max_delta_usd": coverage.cover_rounding_max_delta_usd,
            "cover_conflict_filing_ids": list(coverage.cover_conflict_filing_ids),
        }
        if end_read_txn is not None:
            end_read_txn()
        return derived
    agg_conn = connect(str(inst_agg_path))
    try:
        derived["inst_logical"] = logical_digest(
            agg_conn, LOGICAL_PROJECTIONS[INST_MODULE]
        )
    finally:
        agg_conn.close()
    # --- RUN M2-8 T8 (R9): the per-filer SERVING artifact ----------
    # The projection reads the composed views (in *source*) AND
    # `agg_qoq_deltas` (in the aggregate just written), so the
    # aggregate is ATTACHed for the duration. ATTACH does not write
    # to *source*, and the DETACH is unconditional, so the source's
    # bytes are untouched either way.
    inst_serving_periods = publication_periods(source)
    # The watermarks are read HERE — before the single read transaction ends —
    # so they describe the same snapshot state as every derived artifact
    # (review F5: reading them after the COMMIT let them describe a different
    # source state; only the DETACH may follow the COMMIT).
    inst_watermarks = {
        "latest_period_of_report": source.execute(
            "SELECT MAX(period_of_report) FROM v_default_inst_filings"
        ).fetchone()[0],
        "latest_filed_date": source.execute(
            "SELECT MAX(filed_date) FROM v_default_inst_filings"
        ).fetchone()[0],
    }
    source.execute("ATTACH DATABASE ? AS inst_agg", (str(inst_agg_path),))
    try:
        serving_projection = build_serving_projection(
            source, periods=inst_serving_periods
        )
    except BaseException:
        # The owner catches this outside the prepared context, rolls back its
        # read transaction, then DETACHes before prepared TEMP/settings cleanup.
        raise
    else:
        # SQLite refuses DETACH inside an open transaction, so the external
        # snapshot's single read transaction ends here — AFTER every read the
        # projection performs, which is exactly the span R16 requires.
        if end_read_txn is not None:
            end_read_txn()
        source.execute("DETACH DATABASE inst_agg")
    write_serving_db(
        serving_projection,
        str(inst_serving_path),
        source_conn=source,
    )
    serving_conn = connect(str(inst_serving_path))
    try:
        derived["inst_serving_logical"] = logical_digest(
            serving_conn,
            projection_for(INST_SERVING_ARTIFACT, INST_MODULE),
        )
    finally:
        serving_conn.close()
    derived["inst_watermarks"] = inst_watermarks
    return derived


def _derive_inst_from_snapshot(
    inst_db_path: Path,
    *,
    inst_agg_path: Path,
    inst_serving_path: Path,
    created_at: str,
) -> tuple[dict, dict]:
    """Derive the inst module from an accepted external snapshot (R1/R2/R16/R24).

    Returns ``(derived, inst_source_document)``. The sequence is the R16
    identity contract, in order:

    1. the snapshot's whole-file SHA-256 is computed BEFORE the file is opened
       — the identity is the bytes on disk, not what a connection sees;
    2. the file is opened ``mode=ro&immutable=1`` — permitted because the R23
       protocol finalized it as genuinely immutable (0444, sidecar-free); a
       write attempt through any derive path is a hard failure (R2);
    3. ONE explicit read transaction spans view verification, metadata capture,
       the coverage gate, the aggregate build, and the serving projection, so
       every derived number observed one snapshot state (R16);
    4. provenance fields come from the ``inst_source_meta`` row INSIDE the
       hashed file (R24) — provenance cannot drift from identity.
    """
    if not inst_db_path.is_file():
        raise PublishError(
            f"inst snapshot {inst_db_path} does not exist — cut one with"
            " scripts/inst_snapshot.py"
        )
    snapshot_sha = sha256_file(inst_db_path)
    inst_conn = sqlite3.connect(
        f"file:{inst_db_path}?mode=ro&immutable=1", uri=True, isolation_level=None
    )
    try:
        committed = False

        def _end_read_txn() -> None:
            nonlocal committed
            if not committed:
                inst_conn.execute("COMMIT")
                committed = True

        inst_conn.execute("BEGIN")
        try:
            try:
                verify_views(inst_conn)
            except ViewVerificationError as exc:
                raise PublishError(str(exc)) from exc
            meta = _read_inst_source_meta(inst_conn)
            if _inst_data_present(inst_conn):
                derived = _derive_inst_module(
                    inst_conn,
                    inst_agg_path=inst_agg_path,
                    inst_serving_path=inst_serving_path,
                    created_at=created_at,
                    end_read_txn=_end_read_txn,
                )
            else:
                derived = {
                    "inst_logical": None,
                    "inst_serving_logical": None,
                    "inst_watermarks": None,
                    "inst_withheld": None,
                    "inst_period_coverage": None,
                    "inst_cover_dispositions": None,
                }
            _end_read_txn()
        except sqlite3.OperationalError as exc:
            # R2: the snapshot is read-only in every path. A derive-path write
            # attempt surfaces from SQLite as "attempt to write a readonly
            # database" — a publication invariant violation, not an incidental
            # operational fault.
            if "readonly" in str(exc).lower():
                raise PublishError(
                    f"a derivation path attempted to WRITE the read-only inst"
                    f" snapshot {inst_db_path}: {exc} — the snapshot is"
                    " immutable by contract (R2)"
                ) from exc
            raise
    finally:
        inst_conn.close()
    document = {
        "schema": INST_SOURCE_SCHEMA,
        "snapshot_sha256": snapshot_sha,
        "snapshot_schema_version": meta["schema_version"],
        "snapshot_version": meta["snapshot_version"],
        "created_at_utc": meta["created_at_utc"],
        "view_definition_digest": meta["view_definition_digest"],
    }
    source_errors = validate_inst_source(document)
    if source_errors:
        raise PublishError(
            "snapshot metadata does not form a valid inst_source/v1 document: "
            + "; ".join(source_errors)
            + " — re-cut the snapshot with scripts/inst_snapshot.py"
        )
    return derived, document


def _complete_extra_module_assets(
    data_repo: Path,
    build_id: str,
    manifest: dict,
    *,
    backend: ReleaseBackend,
    actions: list[str],
    draft: bool,
    scratch: Path | None,
) -> None:
    """Upload/verify every non-congress module's Release DB asset (R3/R12).

    The recovery journal is congress-scoped — ``congress.db`` is extracted from
    it — so an additional module's aggregate (``inst_agg.db``) is sourced from
    the staged ``assets/`` directory instead. On a draft, a not-yet-uploaded
    asset is uploaded from staging; if staging is gone AND the asset is not
    already a verified draft asset (the narrow fresh-runner post-journal /
    pre-inst-upload window), recovery **refuses loudly** with the release still a
    draft and the pointer unmoved — resolved by the drafts-only cleanup +
    rebuild (TD-M2-3-1). On an already-published release the asset must simply
    verify present (immutability), or the re-publish is refused.
    """
    for module_name in sorted(manifest.get("modules", {})):
        if module_name == MODULE:
            continue  # congress.db is sourced from the journal itself
        # EVERY database artifact for the module, not just the primary one
        # (RUN M2-8 T8; external review r3 F9). Resolving a single name here is
        # how a second asset gets silently skipped at upload and verification.
        for db_name in module_db_artifacts(module_name):
            entry = find_artifact(manifest, db_name, module=module_name)
            if entry is None:
                continue  # a build predating this artifact legitimately has none
            if backend.verify_asset(
                build_id, db_name, sha256=entry["sha256"], size=entry["bytes"]
            ):
                continue  # already uploaded and verified — idempotent
            if not draft:
                raise PublishError(
                    f"release data-{build_id} is published but module {module_name!r}"
                    f" asset {db_name} is missing or does not verify — refusing to"
                    " re-publish an inconsistent release"
                )
            staged_asset = (
                Path(data_repo) / STAGING_DIR / build_id / "assets" / db_name
            )
            if not staged_asset.is_file():
                raise PublishError(
                    f"module {module_name!r} Release asset {db_name} for"
                    f" data-{build_id} is neither a verified draft asset nor present"
                    " in staging: the congress-scoped recovery journal cannot"
                    " regenerate it. The release is still a draft and the pointer is"
                    " unmoved — run the drafts-only cleanup (docs/runbooks/rollback.md"
                    " Appendix A) and rebuild under a new build_id to regenerate it"
                    " (TD-M2-3-1)."
                )
            data = staged_asset.read_bytes()
            if (
                hashlib.sha256(data).hexdigest() != entry["sha256"]
                or len(data) != entry["bytes"]
            ):
                raise PublishError(
                    f"staged {db_name} for data-{build_id} does not match its"
                    " manifest entry — refusing to upload an inconsistent asset"
                )
            upload_file = Path(scratch) / db_name
            upload_file.write_bytes(data)
            backend.upload(build_id, upload_file, name=db_name, clobber=True)
            actions.append(f"upload:{db_name}")
            if not backend.verify_asset(
                build_id, db_name, sha256=entry["sha256"], size=entry["bytes"]
            ):
                raise PublishError(
                    f"{db_name} asset on data-{build_id} failed verification after"
                    " upload"
                )



def _require_attested(result) -> None:
    """A failing attest() stops the publish.

    All three call sites previously discarded this value, so a provider that
    reported failure was ignored and the publish continued. For the sigstore
    provider attest() is a seam (the workflow's attest step does the signing),
    but the seam must remain usable by a provider that CAN fail — otherwise the
    check is decorative.
    """
    if not result.ok:
        raise PublishError(f"attestation failed: {result.detail}")


def _complete_build(
    data_repo: Path,
    build_id: str,
    journal_bytes: bytes,
    *,
    backend: ReleaseBackend,
    attestation: AttestationProvider,
    now: Callable[[], datetime],
    actions: list[str],
) -> int:
    """Drive one journaled build to the fully published/committed/pointed
    state, idempotently, in the §5.5 P1 order; returns the pointer version.

    Order: draft → journal uploaded+verified FIRST → consumer ``congress.db``
    (identical bytes, extracted from the journal) uploaded+verified →
    ``publish_release`` (immutability attaches here) → materialize
    ``builds/<id>/`` → attestation seam → pointer LAST → clear staging.
    """
    journal = journal_load(journal_bytes)
    if journal["build_id"] != build_id:
        raise PublishError(
            f"journal is for {journal['build_id']}, not {build_id}"
        )
    # F2: refuse a conflicting republish BEFORE any backend mutation — a
    # committed build that differs from this journal (any artifact, not just
    # manifest.json) means we would overwrite a different committed build.
    # (reconcile_inflight reaches _complete_build without _preflight, so the
    # checks must live here too; run_publish also runs them in _preflight.)
    escape = _build_dir_escape_error(data_repo / "builds", build_id)
    if escape is not None:
        raise PublishError(escape)
    conflict = _committed_build_conflict(data_repo, build_id, journal)
    if conflict is not None:
        raise PublishError(conflict)
    # The extra-module asset preflight must run here too: reconciliation reaches
    # this point WITHOUT _preflight, so without it a resumed publish could upload
    # the journal and congress.db before discovering a missing/corrupt staged
    # inst_agg.db — partially mutating a build that was never publishable
    # (QA-F1, round 6).
    _preflight_module_assets(Path(data_repo), build_id, journal, backend)
    manifest_text: str = journal["artifacts"]["manifest.json"]
    manifest_bytes = manifest_text.encode("utf-8")
    manifest_sha = hashlib.sha256(manifest_bytes).hexdigest()
    manifest = journal_manifest(journal)  # validated in journal_load
    journal_sha = journal_sha256(journal_bytes)
    db_sha = journal["db"]["sha256"]
    db_size = journal["db"]["bytes"]

    release = backend.get_release(build_id)
    if release is None:
        backend.ensure_draft(build_id)
        actions.append(f"ensure_draft:{build_id}")
        release = backend.get_release(build_id)
        if release is None:
            raise BackendError(f"backend failed to create draft data-{build_id}")

    if release.draft:
        with tempfile.TemporaryDirectory(prefix="populus-publish-") as scratch:
            if not backend.verify_asset(
                build_id, JOURNAL_ASSET, sha256=journal_sha, size=len(journal_bytes)
            ):
                journal_file = Path(scratch) / JOURNAL_ASSET
                journal_file.write_bytes(journal_bytes)
                backend.upload(
                    build_id, journal_file, name=JOURNAL_ASSET, clobber=True
                )
                actions.append(f"upload:{JOURNAL_ASSET}")
                if not backend.verify_asset(
                    build_id,
                    JOURNAL_ASSET,
                    sha256=journal_sha,
                    size=len(journal_bytes),
                ):
                    raise PublishError(
                        f"journal asset on data-{build_id} failed verification"
                        " after upload"
                    )
            if not backend.verify_asset(
                build_id, DB_ARTIFACT, sha256=db_sha, size=db_size
            ):
                db_file = Path(scratch) / DB_ARTIFACT
                db_file.write_bytes(journal_db_bytes(journal))
                backend.upload(build_id, db_file, name=DB_ARTIFACT, clobber=True)
                actions.append(f"upload:{DB_ARTIFACT}")
                if not backend.verify_asset(
                    build_id, DB_ARTIFACT, sha256=db_sha, size=db_size
                ):
                    raise PublishError(
                        f"congress.db asset on data-{build_id} failed"
                        " verification after upload"
                    )
            # After the journal + congress.db (P1 order preserved), upload each
            # additional module's Release asset from staging, before publish (R3).
            _complete_extra_module_assets(
                data_repo,
                build_id,
                manifest,
                backend=backend,
                actions=actions,
                draft=True,
                scratch=Path(scratch),
            )
        backend.publish_release(build_id)
        actions.append(f"publish_release:{build_id}")
    else:
        # Published releases are exact-byte immutable: verify, never mutate.
        if not backend.verify_asset(
            build_id, JOURNAL_ASSET, sha256=journal_sha, size=len(journal_bytes)
        ) or not backend.verify_asset(
            build_id, DB_ARTIFACT, sha256=db_sha, size=db_size
        ):
            raise PublishError(
                f"release data-{build_id} is already published with different"
                " bytes — refusing to re-publish; existing assets unchanged"
            )
        # Each additional module's asset must also verify present on the
        # published release (immutability), or the re-publish is refused.
        _complete_extra_module_assets(
            data_repo,
            build_id,
            manifest,
            backend=backend,
            actions=actions,
            draft=False,
            scratch=None,
        )

    # The complete committed-build conflict check ran in preflight above (F2),
    # before any mutation; materialize is byte-idempotent for the matching case.
    builds_dir = data_repo / "builds"
    materialize_from_journal(journal_bytes, builds_dir)
    actions.append(f"materialize:{build_id}")

    _require_attested(attestation.attest("manifest.json", manifest_bytes))

    latest_path = data_repo / "latest.json"
    current: dict | None = None
    if latest_path.exists():
        try:
            current = json.loads(latest_path.read_text(encoding="utf-8"))
        except (OSError, ValueError) as exc:
            raise PublishError(f"latest.json is unreadable: {exc}") from exc
        pointer_errors = validate_pointer(current)
        if pointer_errors:
            raise PublishError(
                "latest.json is invalid: " + "; ".join(pointer_errors)
            )
    if (
        current is not None
        and current["build_id"] == build_id
        and current["manifest_sha256"] == manifest_sha
    ):
        pointer_version = current["pointer_version"]
    else:
        pointer_version = (current["pointer_version"] if current else 0) + 1
        pointer = build_pointer(
            pointer_version=pointer_version,
            issued_at=now(),
            build_id=build_id,
            manifest_sha256=manifest_sha,
        )
        pointer_bytes = render_pointer(pointer).encode("utf-8")
        _require_attested(attestation.attest("latest.json", pointer_bytes))
        atomic_write_bytes(latest_path, pointer_bytes)
        actions.append(f"pointer:{pointer_version}")

    _assert_owned_base_real(Path(data_repo) / STAGING_DIR, ".staging/")
    staged_dir = Path(data_repo) / STAGING_DIR / build_id
    if staged_dir.exists():
        shutil.rmtree(staged_dir)
        actions.append(f"clear_staging:{build_id}")
    return pointer_version


def reconcile_inflight(
    data_repo: Path | str,
    *,
    now: Callable[[], datetime],
    backend: ReleaseBackend,
    attestation: AttestationProvider | None = None,
) -> ReconcileReport:
    """Complete the single possible in-flight build before anything new.

    Handles (a) any remote draft — adopts its build_id and drives it forward
    from its journal (remote asset first, staged copy else); (b) any staged
    build whose release already exists (published-but-uncommitted /
    unpointed) — finishes materialize/pointer/clear. Never deletes anything;
    staged-only builds with no remote state are left for the normal publish
    path.
    """
    data_repo = Path(data_repo)
    attestation = attestation or StagingNoop()
    actions: list[str] = []
    completed: list[str] = []

    drafts = backend.list_draft_tags()
    if len(drafts) > 1:
        raise PublishError(
            "publication serialization invariant violated: multiple in-flight"
            f" drafts {sorted(drafts)} — §13.3 guarantees at most one; resolve"
            " via the operator runbook"
        )
    for build_id in drafts:
        journal_bytes = _recover_journal(data_repo, build_id, backend)
        _complete_build(
            data_repo,
            build_id,
            journal_bytes,
            backend=backend,
            attestation=attestation,
            now=now,
            actions=actions,
        )
        completed.append(build_id)

    staging_root = data_repo / STAGING_DIR
    if staging_root.is_dir():
        for staged in sorted(staging_root.iterdir()):
            build_id = staged.name
            if (
                not staged.is_dir()
                or _BUILD_ID.match(build_id) is None
                or build_id in completed
            ):
                continue
            if not (staged / "journal.json").is_file():
                continue  # unjournaled scratch: never a durable build
            if backend.get_release(build_id) is None:
                continue  # staged-only: the normal publish path owns it
            journal_bytes = _recover_journal(data_repo, build_id, backend)
            _complete_build(
                data_repo,
                build_id,
                journal_bytes,
                backend=backend,
                attestation=attestation,
                now=now,
                actions=actions,
            )
            completed.append(build_id)

    # A published-but-uncommitted release with no staging left anywhere (a
    # fresh runner after a crash between publish_release and the commit):
    # §13.3 serialization means only the NEWEST published release can be in
    # that state — its journal asset is the recovery source.
    published = [
        build_id
        for build_id in backend.list_published_tags()
        if build_id not in completed
    ]
    if published:
        newest = max(published, key=_build_id_key)
        if not (data_repo / "builds" / newest / "manifest.json").is_file():
            journal_bytes = _recover_journal(data_repo, newest, backend)
            _complete_build(
                data_repo,
                newest,
                journal_bytes,
                backend=backend,
                attestation=attestation,
                now=now,
                actions=actions,
            )
            completed.append(newest)

    return ReconcileReport(tuple(completed), tuple(actions))


# --- build assembly (R1/R2/R34/R35) ------------------------------------------


@dataclass(frozen=True)
class BuildReport:
    build_id: str
    staging_dir: str
    previous_build_id: str | None
    logical_digest: str
    artifact_count: int
    skipped_tickers: tuple[str, ...]
    adopted: bool
    reconciled: tuple[str, ...]
    # True when an existing valid staged journal / completed in-flight build
    # was preserved or recovered verbatim rather than assembled fresh (F2).
    preserved: bool = False
    # The inst cross-filer aggregate outcome (R7). When inst data is present but
    # the M2 >=95% gate withholds it, this carries the typed reason (reason ∈
    # {below_threshold, cover_failed, not_measurable} + the coverage numbers);
    # it is None when inst published or no inst data was present.
    inst_withheld: dict | None = None
    # The inst logical digest when the inst module published (R5); None otherwise.
    inst_logical_digest: str | None = None
    # Per-period value-coverage breakdown (RUN M2-5, R9): reporting only, present
    # whenever inst data was measured (pass or withheld); None otherwise.
    inst_period_coverage: list[dict] | None = None
    # The M2-7 cover-reconciliation dispositions behind the coverage numbers:
    # {cover_rounding_count, cover_rounding_max_delta_usd, cover_conflict_count,
    # cover_conflict_filing_ids}. Present whenever inst data was measured — a
    # PASSING build states what it tolerated and excluded too, not only a
    # withheld one (spec §I5). Reporting only; the gate is unchanged.
    inst_cover_dispositions: dict | None = None


def _report_from_manifest(
    build_id: str,
    manifest: dict,
    *,
    staging_dir: str,
    adopted: bool,
    preserved: bool,
    reconciled: tuple[str, ...],
) -> BuildReport:
    db_entry = find_artifact(manifest, DB_ARTIFACT) or {}
    return BuildReport(
        build_id=build_id,
        staging_dir=staging_dir,
        previous_build_id=manifest.get("previous_build_id"),
        logical_digest=db_entry.get("logical_digest", ""),
        # Count EVERY module's artifacts: a preserved two-module build would
        # otherwise under-report its display-only count (QA-F2 nit, round 5).
        artifact_count=sum(
            len(module.get("artifacts", []))
            for module in manifest.get("modules", {}).values()
        ),
        skipped_tickers=(),
        adopted=adopted,
        reconciled=reconciled,
        preserved=preserved,
    )


def _feed_rows(conn: sqlite3.Connection, *, limit: int, where: str = "", params: tuple = ()) -> list[dict]:
    select = ", ".join(_FEED_COLUMNS)
    # nosec B608 — columns are a module constant; `where` is one of the two
    # literal fragments below; values are bound parameters.
    rows = conn.execute(
        f"SELECT {select} FROM v_default_transactions{where}"  # nosec B608
        " ORDER BY filed_date DESC, transaction_date DESC, txn_id"
        " LIMIT ?",
        (*params, limit),
    ).fetchall()
    documents = []
    for row in rows:
        document = dict(zip(_FEED_COLUMNS, row))
        document["flags"] = json.loads(document["flags"])
        documents.append(document)
    return documents


def _write_staged(build_dir: Path, relpath: str, text: str) -> None:
    target = resolve_within(build_dir, relpath)
    target.parent.mkdir(parents=True, exist_ok=True)
    atomic_write_bytes(target, text.encode("utf-8"))


@dataclass(frozen=True)
class StagedBuild:
    """A build whose data artifacts exist but whose manifest is not yet final.

    §12.1 needs the site built *from* the verified data build, and the site
    build reads ``manifest.json`` to decide which surfaces exist
    (``dashboard/src/lib/data.ts:86``). But the manifest cannot be final until
    the site exists, because ``stats.json`` carries the served file count. That
    circularity is why the build is two phases rather than one:

    ``stage_build`` → data artifacts + a **provisional** manifest → the site
    builds against it → ``finalize_build`` patches the count, discards the
    provisional manifest, re-assembles from the same walk, and only then writes
    the recovery journal (which must stay LAST, R35).

    ``report`` is set when nothing was assembled — a preserved or reconciled
    build. Those are already published and journal-sealed, so ``finalize_build``
    returns them untouched and the caller must not deploy from them.
    """

    build_id: str
    staging_dir: str
    fresh: bool
    report: BuildReport | None = None
    # Everything `_seal_build` needs; only meaningful when `fresh` is True.
    _state: dict | None = None

    @property
    def deployable(self) -> bool:
        """Whether this run produced bytes a deploy leg should publish.

        A preserved or reconciled build is already live; re-deploying it would
        re-produce a sealed journal for artifacts that never changed.
        """
        return self.fresh


#: Where ``stage_build`` parks the state ``finalize_build`` needs when the two
#: phases run in different processes (the workflow runs the site build between
#: them). Deliberately a sibling of ``build/``, never inside it: anything under
#: ``build_dir`` is walked into the manifest, and this file is scaffolding, not
#: a published artifact.
STAGE_STATE_FILE = "stage-state.json"


def _stage_state_path(staging_dir: Path | str) -> Path:
    return Path(staging_dir) / STAGE_STATE_FILE


def write_stage_state(staged: StagedBuild) -> Path:
    """Persist *staged* so a later process can finalize it.

    Only the values that cannot be recovered from the staged tree are written.
    ``stats_document`` is not among them — it is already on disk at
    ``build/congress/stats.json``, and re-reading it there keeps one copy
    authoritative instead of two that can disagree.
    """
    path = _stage_state_path(staged.staging_dir)
    if not staged.fresh or staged._state is None:
        payload = {"fresh": False, "build_id": staged.build_id}
    else:
        state = staged._state
        payload = {
            "fresh": True,
            "build_id": state["build_id"],
            "created_at": state["created_at"],
            "previous_build_id": state["previous_build_id"],
            "watermarks": state["watermarks"],
            "db_logical": state["db_logical"],
            "inst_logical": state["inst_logical"],
            # RUN M2-8's serving substrate crosses the stage/finalize process
            # boundary too. `_seal_build` reads it unconditionally whenever
            # `inst_logical` is set, so omitting it here made every build with a
            # populated inst module KeyError at the FINAL seal while the
            # provisional seal — same function, in-memory state — passed.
            "inst_serving_logical": state["inst_serving_logical"],
            "inst_watermarks": state["inst_watermarks"],
            "inst_withheld": state["inst_withheld"],
            "inst_period_coverage": state["inst_period_coverage"],
            "inst_cover_dispositions": state["inst_cover_dispositions"],
            "skipped_tickers": list(state["skipped_tickers"]),
            "adopted": state["adopted"],
            "reconciled": list(state["reconciled"]),
            "expected_modules": state.get("expected_modules"),
        }
    atomic_write_bytes(path, _render_json(payload).encode("utf-8"))
    return path


def _recompute_db_logical(snapshot_path: Path) -> str:
    """The congress logical digest, read from the snapshot rather than believed.

    `finalize_build` runs in a different process from `stage_build`, so every
    value crossing that boundary is attacker-controlled in the same sense a file
    on disk is. Anything cheap to recompute is recomputed.
    """
    if not snapshot_path.is_file():
        raise PublishError(f"staged build is missing {snapshot_path}")
    snapshot = connect(str(snapshot_path))
    try:
        ensure_views(snapshot)
        return logical_digest(snapshot)
    finally:
        snapshot.close()


def _validated_expected_modules(payload: dict) -> list[str] | None:
    """The staged expected-module set, or None for a genuinely legacy sidecar.

    Present-but-unusable is a hard error at LOAD time as well as at seal time
    (review c2r2-F1): an emptied list is not a legacy shape, it is corruption,
    and the difference decides whether the F-26 gate runs at all.
    """
    if "expected_modules" not in payload:
        return None
    value = payload["expected_modules"]
    if (
        not isinstance(value, list)
        or not value
        or not all(isinstance(name, str) and name for name in value)
    ):
        raise PublishError(
            "staged build state carries an unusable expected-module set"
            f" ({value!r}) — a missing field is a legacy stage-state, but an empty"
            " or malformed one is corruption and must not finalize"
        )
    return list(value)


def read_stage_state(
    staging_dir: Path | str, *, data_repo: Path | str, backend: ReleaseBackend
) -> StagedBuild:
    """Rebuild a :class:`StagedBuild` written by :func:`write_stage_state`."""
    staging_dir = Path(staging_dir)
    path = _stage_state_path(staging_dir)
    if not path.is_file():
        raise PublishError(
            f"no staged build state at {path} — run `populus stage-build` first"
        )
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        raise PublishError(f"staged build state is unreadable: {exc}") from exc

    if not payload.get("fresh"):
        raise PublishError(
            "the staged build was preserved or reconciled, not freshly assembled"
            " — there is nothing to finalize and nothing to deploy"
        )

    # The build id comes from the DIRECTORY, never from the sidecar.
    #
    # Trusting `payload["build_id"]` reintroduced the exact failure QA round 7
    # exists to prevent: a hand-edited sidecar published real congress.db bytes
    # under a fabricated identity that never passed through `next_build_id`'s
    # durable high-water mark, so one immutable build id could name two
    # different byte sets. The directory is the authority because it is what
    # `stage_build` actually allocated; the sidecar's copy is kept only as a
    # cross-check, and a disagreement is a hard error rather than a silent
    # preference for either side.
    build_id = staging_dir.name
    if _BUILD_ID.match(build_id) is None:
        raise PublishError(
            f"staging directory {staging_dir} is not named after a valid build id"
        )
    claimed = payload.get("build_id")
    if claimed != build_id:
        raise PublishError(
            f"staged build state claims build_id {claimed!r} but lives in "
            f"{build_id!r} — refusing to finalize a build whose identity is in "
            "dispute"
        )

    build_dir = staging_dir / "build"
    stats_path = build_dir / "congress" / "stats.json"
    if not stats_path.is_file():
        raise PublishError(f"staged build is missing {stats_path}")
    state = {
        "build_dir": build_dir,
        "staging_dir": staging_dir,
        "data_repo": Path(data_repo),
        "snapshot_path": staging_dir / "assets" / DB_ARTIFACT,
        "inst_agg_path": staging_dir / "assets" / INST_DB_ARTIFACT,
        # Reconstructed from the staging tree exactly as `inst_agg_path` is —
        # `stage_build` derives it the same way (`assets_dir / ...`), so a
        # persisted copy would be a second authority that can disagree.
        "inst_serving_path": staging_dir / "assets" / INST_SERVING_ARTIFACT,
        "register": licenses.load_register(),
        "backend": backend,
        "stats_document": json.loads(stats_path.read_text(encoding="utf-8")),
        "build_id": build_id,
        "created_at": payload["created_at"],
        "previous_build_id": payload["previous_build_id"],
        "watermarks": payload["watermarks"],
        # Recomputed from the snapshot, never taken from the sidecar. A forged
        # `db_logical` flows straight into the manifest's congress.db entry, and
        # `journal_load`'s consistency check compares it against the journal —
        # which was written from the same forged value, so the two agree.
        # `run_verify` would catch it, but only after Publish has made the
        # Release immutable.
        "db_logical": _recompute_db_logical(staging_dir / "assets" / DB_ARTIFACT),
        "inst_logical": payload["inst_logical"],
        "inst_serving_logical": payload["inst_serving_logical"],
        "inst_watermarks": payload["inst_watermarks"],
        "inst_withheld": payload["inst_withheld"],
        # NOTE: `expected_modules` is deliberately NOT set here — see the
        # conditional merge below. Presence/absence of the key is load-bearing.
        "inst_period_coverage": payload["inst_period_coverage"],
        "inst_cover_dispositions": payload["inst_cover_dispositions"],
        "skipped_tickers": payload["skipped_tickers"],
        "adopted": payload["adopted"],
        "reconciled": payload["reconciled"],
    }
    # Review c2r3-F1: for a genuinely legacy sidecar the key is OMITTED, never
    # set to None — `_seal_build` bypasses the gate on ABSENCE alone, so a
    # present None must stay distinguishable from "this state predates the
    # gate" and remains fatal.
    validated_expected = _validated_expected_modules(payload)
    if validated_expected is not None:
        state["expected_modules"] = validated_expected
    return StagedBuild(
        build_id=build_id,
        staging_dir=str(staging_dir),
        fresh=True,
        _state=state,
    )


def _seal_build(state: dict, *, provisional: bool) -> BuildReport | None:
    """Assemble the manifest from ``build_dir`` and, when final, the journal.

    Called twice per fresh build. The provisional pass exists only so the site
    build has a manifest to read; the final pass is the one whose bytes are
    published.

    **The provisional manifest must not survive into the final walk.**
    ``build_dir.rglob("*")`` hashes every file it finds, and today
    ``manifest.json`` is written *after* the walk, which is the only reason the
    manifest never lists itself. A provisional manifest left in place would
    acquire a self-entry whose digest goes stale the moment this function
    re-renders it — and `validate_manifest` would then reject the result, or
    worse, `build_journal` would seal a manifest that disagrees with the tree it
    describes. So the final pass deletes it first, restoring exactly the file
    set the single-phase build used to see.
    """
    build_dir: Path = state["build_dir"]
    manifest_path = build_dir / "manifest.json"
    if not provisional and manifest_path.exists():
        manifest_path.unlink()

    register = state["register"]
    backend: ReleaseBackend = state["backend"]
    build_id: str = state["build_id"]
    snapshot_path: Path = state["snapshot_path"]
    data_license_ids = sorted(licenses.ingestible_ids(register))
    register_license_ids = sorted(licenses.register_ids(register))
    locator_kind, locator_value = backend.locator(build_id, DB_ARTIFACT)
    entries = [
        ArtifactEntry(
            name=DB_ARTIFACT,
            sha256=sha256_file(snapshot_path),
            bytes=snapshot_path.stat().st_size,
            license_ids=tuple(data_license_ids),
            path=locator_value if locator_kind == "path" else None,
            url=locator_value if locator_kind == "url" else None,
            logical_digest=state["db_logical"],
        )
    ]
    for path in sorted(build_dir.rglob("*")):
        if not path.is_file():
            continue
        relpath = path.relative_to(build_dir).as_posix()
        entries.append(
            ArtifactEntry(
                name=relpath,
                sha256=sha256_file(path),
                bytes=path.stat().st_size,
                license_ids=tuple(
                    register_license_ids
                    if relpath in LICENSING_ARTIFACTS
                    else data_license_ids
                ),
                path=f"builds/{build_id}/{relpath}",
            )
        )
    manifest = build_manifest(
        build_id=build_id,
        created_at=state["created_at"],
        previous_build_id=state["previous_build_id"],
        watermarks=state["watermarks"],
        artifacts=entries,
    )
    # Post-assembly injection of the inst module when it cleared the gate (R3/R7).
    # `build_manifest` stays congress-scoped (zero M1 regression); the inst
    # aggregate is a separate Release asset alongside congress.db.
    inst_logical = state["inst_logical"]
    if inst_logical is not None:
        inst_agg_path: Path = state["inst_agg_path"]
        inst_kind, inst_value = backend.locator(build_id, INST_DB_ARTIFACT)
        inst_entry = ArtifactEntry(
            name=INST_DB_ARTIFACT,
            sha256=sha256_file(inst_agg_path),
            bytes=inst_agg_path.stat().st_size,
            license_ids=tuple(data_license_ids),
            path=inst_value if inst_kind == "path" else None,
            url=inst_value if inst_kind == "url" else None,
            logical_digest=inst_logical,
        )
        inst_serving_logical = state["inst_serving_logical"]
        require_complete_inst_module(inst_logical, inst_serving_logical)
        inst_artifacts = [inst_entry.to_dict()]
        # The SECOND inst database (RUN M2-8 T8, R9). Enumerated here or it is
        # not published at all: `_complete_extra_module_assets`,
        # `_preflight_module_assets`, `run_verify`, `run_rollback` and the client
        # installer all iterate `module_db_artifacts` and skip a name the
        # manifest does not list, so a missing entry silently disables all five.
        #
        # This lives in `_seal_build` because P3-3 moved manifest assembly here
        # and made it run TWICE — provisionally so the site build can read
        # `manifest.modules`, then finally once the served file count is known.
        # Both passes must enumerate the serving artifact: the provisional pass
        # is what `data.ts` reads to decide the institutional surfaces exist.
        if inst_serving_logical is not None:
            inst_serving_path: Path = state["inst_serving_path"]
            serving_kind, serving_value = backend.locator(
                build_id, INST_SERVING_ARTIFACT
            )
            inst_artifacts.append(
                ArtifactEntry(
                    name=INST_SERVING_ARTIFACT,
                    sha256=sha256_file(inst_serving_path),
                    bytes=inst_serving_path.stat().st_size,
                    license_ids=tuple(data_license_ids),
                    path=serving_value if serving_kind == "path" else None,
                    url=serving_value if serving_kind == "url" else None,
                    logical_digest=inst_serving_logical,
                ).to_dict()
            )
        manifest["modules"][INST_MODULE] = {
            "schema_version": INST_SCHEMA_VERSION,
            "client_compat": INST_CLIENT_COMPAT,
            "deprecation": None,
            "normalization_version": INST_NORMALIZATION_VERSION,
            "digest_projection_version": LOGICAL_PROJECTION_VERSIONS[INST_MODULE],
            "watermarks": state["inst_watermarks"],
            "artifacts": inst_artifacts,
        }
    manifest_errors = validate_manifest(
        manifest, register_ids=licenses.register_ids(register)
    )
    if manifest_errors:
        raise PublishError(
            "assembled manifest failed validation: " + "; ".join(manifest_errors)
        )
    # F-26 (ALPHA-UX): the module-presence gate. Every module in the DECLARED
    # expected set must carry a typed disposition with an explicit exit rule —
    # served → publish; withheld → only with a source-owned reason from the
    # closed list (the inst coverage gate's own typed reasons); anything else
    # → publication-fatal. Runs on BOTH seal passes, so an accidentally
    # missing module fails at stage time, before any deploy leg runs.
    # Review c2r2-F1 → c2r3-F1: the ABSENCE OF THE KEY is the only bypass (a
    # legacy sidecar staged before this gate existed; `read_stage_state` omits
    # the key entirely for those). A key that is PRESENT and empty, malformed,
    # or None is a corrupted stage-state — skipping the gate for it would
    # republish the exact silent-module outage F-26 exists to prevent.
    if "expected_modules" in state:
        expected_modules = state["expected_modules"]
        if (
            not isinstance(expected_modules, (list, tuple))
            or not expected_modules
            or not all(isinstance(name, str) and name for name in expected_modules)
        ):
            raise PublishError(
                "module disposition gate (F-26): the staged expected-module set is"
                f" present but unusable ({expected_modules!r}) — an emptied or corrupted"
                " stage-state must not publish; re-stage with an explicit set"
            )
        dispositions: dict[str, dict] = {}
        for module_name in sorted(set(expected_modules) | set(manifest["modules"])):
            if module_name in manifest["modules"]:
                dispositions[module_name] = {"state": "served", "reason": None}
            elif module_name == INST_MODULE and state["inst_withheld"] is not None:
                dispositions[module_name] = {
                    "state": "withheld",
                    "reason": state["inst_withheld"].get("reason"),
                }
            # otherwise: NO disposition — exactly the case the checker makes fatal
        disposition_errors = check_module_dispositions(
            dispositions, expected_modules=frozenset(expected_modules)
        )
        if disposition_errors:
            raise PublishError(
                "module disposition gate (F-26): " + "; ".join(disposition_errors)
            )
    _write_staged(build_dir, "manifest.json", render_manifest(manifest))
    if provisional:
        return None

    # --- the recovery journal, durably staged LAST (R35) ----------------------
    staging_dir: Path = state["staging_dir"]
    journal_bytes = build_journal(staging_dir, manifest, snapshot_path)
    atomic_write_bytes(
        _staged_journal_path(state["data_repo"], build_id), journal_bytes
    )

    return BuildReport(
        build_id=build_id,
        staging_dir=str(staging_dir),
        previous_build_id=state["previous_build_id"],
        logical_digest=state["db_logical"],
        # Every module's artifacts, matching `_report_from_manifest` — a fresh
        # two-module build must not report only the congress count (QA-F4 nit).
        artifact_count=sum(
            len(module.get("artifacts", []))
            for module in manifest.get("modules", {}).values()
        ),
        skipped_tickers=tuple(state["skipped_tickers"]),
        adopted=state["adopted"],
        reconciled=state["reconciled"],
        inst_withheld=state["inst_withheld"],
        inst_logical_digest=inst_logical,
        inst_period_coverage=state["inst_period_coverage"],
        inst_cover_dispositions=state["inst_cover_dispositions"],
    )


def finalize_build(
    staged: StagedBuild,
    *,
    site_file_count: int | None = None,
    dist_dir: Path | str | None = None,
) -> BuildReport:
    """Complete *staged*: patch the served file count, re-seal, write the journal.

    ``site_file_count`` is the number of files the site build emitted. It is
    optional because the single-phase wrapper has no site to count; when it is
    ``None`` the staged ``stats.json`` keeps the ``null`` ``compute_stats``
    wrote, which is what every non-deploying caller wants. **The deploying path
    must pass a real count** — R3 puts that assertion in the workflow, not in
    the schema, precisely so this wrapper cannot satisfy it by accident.

    A preserved or reconciled build is returned untouched: it is already sealed.
    """
    if staged.report is not None:
        return staged.report
    state = staged._state
    if state is None:  # pragma: no cover — constructed only by stage_build
        raise PublishError("staged build carries no state to finalize")

    if site_file_count is not None:
        if site_file_count <= 0:
            raise PublishError(
                f"site_file_count must be positive, got {site_file_count}"
            )
        stats_document = dict(state["stats_document"])
        stats_document["site_file_count"] = site_file_count
        state["stats_document"] = stats_document
        # ONE writer, TWO destinations. §12.1 step 2 requires the count written
        # "into the one stats.json in *both* places identically … assert the two
        # copies are byte-equal", and the site build has already emitted its copy
        # from the PROVISIONAL document (count still null) by the time we get
        # here. Patching only the canonical copy would leave the live site
        # serving `site_file_count: null` forever while the published manifest
        # reports the real integer — two documents §12.1 promises are identical.
        rendered = render_stats(stats_document)
        _write_staged(state["build_dir"], "congress/stats.json", rendered)
        if dist_dir is not None:
            served = Path(dist_dir) / "stats.json"
            if not served.is_file():
                raise PublishError(
                    f"no served stats.json at {served} — the site build did not "
                    "emit one, so the two copies cannot be made identical (R24)"
                )
            served.write_text(rendered, encoding="utf-8")
            # Assert rather than assume: this is the byte-equality §12.1 names,
            # and it is the only place both copies exist at once.
            canonical = (state["build_dir"] / "congress" / "stats.json").read_bytes()
            if served.read_bytes() != canonical:
                raise PublishError(
                    "the served and canonical stats.json differ after patching — "
                    "R24's byte-equality does not hold"
                )

    report = _seal_build(state, provisional=False)
    assert report is not None  # provisional=False always returns a report
    return report


def run_build(
    db_path: Path | str | None,
    data_repo: Path | str,
    *,
    now: Callable[[], datetime],
    raw_root: Path | str | None = None,
    backend: ReleaseBackend,
    attestation: AttestationProvider | None = None,
) -> BuildReport:
    """Assemble and finalize one staged build in a single call.

    The single-phase entry point every existing caller uses (4 in production:
    ``cli.py``, ``accept_m1_b.py``, ``accept_m2_5.py``, ``accept_m2_6.py``; the
    rest are tests). It stages and finalizes with **no site file count**, so the
    published ``stats.json`` keeps ``site_file_count: null`` — the deploying
    path uses ``stage_build``/``finalize_build`` directly.

    ``attestation`` is forwarded as an **explicit keyword**, never through
    ``**kwargs``: ``tests/test_attestation_structure.py`` walks call sites for
    exactly this parameter and treats kwargs-forwarding as an omission, because
    a forwarded parameter cannot be seen by a signature-level guard.
    """
    staged = stage_build(
        db_path,
        data_repo,
        now=now,
        raw_root=raw_root,
        backend=backend,
        attestation=attestation,
    )
    return finalize_build(staged)


def stage_build(
    db_path: Path | str | None,
    data_repo: Path | str,
    *,
    now: Callable[[], datetime],
    raw_root: Path | str | None = None,
    backend: ReleaseBackend,
    attestation: AttestationProvider | None = None,
    inst_db_path: Path | str | None = None,
    expected_modules: frozenset[str] = frozenset({MODULE}),
) -> StagedBuild:
    """Assemble one staged build under ``.staging/<build_id>/`` (§5.5).

    ``expected_modules`` (F-26, ALPHA-UX): the DECLARED module set this release
    must account for — every named module needs a typed disposition (present →
    served; absent → a source-owned withholding or publication failure). The
    library default {congress} preserves congress-only test builds; the
    production CLI declares {congress, inst}, which is what catches a build
    that silently lost a module. A fresh stage REQUIRES a non-empty declared
    set — there is no bypass (review F8): a caller wanting fewer modules
    declares fewer, visibly. (A LEGACY staged sidecar predating this gate has
    no persisted expectation; only that recovery-reseal path skips it.)

    ``inst_db_path`` (RUN M2-11, R1): the accepted external inst snapshot.
    When given, institutional presence, coverage, watermarks and both derived
    databases come from THAT file — opened read-only, one read transaction,
    identity captured as its whole-file SHA-256 plus its own
    ``inst_source_meta`` fields, published as ``inst_source.json`` (R24).
    When ``None``, behaviour is byte-identical to before the parameter existed.

    Recovery-first (F1): shared state is reconciled BEFORE the source database
    is required or opened, so a fresh runner completes an interrupted publish
    from the data repo + Release backend alone — no source-database input. The
    database is required only when genuinely new artifacts must be assembled.
    A staged-only build with a valid journal is preserved verbatim (F2), never
    re-produced from the current database or clock.

    Assembly path: snapshot → integrity check → logical digest → stats →
    feed + slices → licensing set → manifest → recovery journal (durably
    staged LAST, after which the build is completable from the data repo alone).
    """
    if not expected_modules:
        raise PublishError(
            "expected_modules must name at least one module (F-26) — a fresh stage"
            " with no declared expectation is the silent-outage shape; declare the"
            " set explicitly, including a deliberately reduced one"
        )
    data_repo = Path(data_repo)
    if not data_repo.is_dir():
        raise PublishError(f"data repo {data_repo} does not exist")

    # F1: reconcile in-flight state first — needs no source database.
    reconciled = reconcile_inflight(
        data_repo, now=now, backend=backend, attestation=attestation
    )

    # F2: a staged-only build with a valid journal is preserved verbatim; an
    # invalid/partial staged journal for an id with no Release is rebuilt.
    staging_root = data_repo / STAGING_DIR
    staged_candidates: list[str] = []
    if staging_root.is_dir():
        for entry in sorted(staging_root.iterdir()):
            if (
                entry.is_dir()
                and _BUILD_ID.match(entry.name)
                and (entry / "journal.json").is_file()
                and backend.get_release(entry.name) is None
            ):
                staged_candidates.append(entry.name)
    rebuild_id: str | None = None
    if staged_candidates:
        staged_id = max(staged_candidates, key=_build_id_key)
        staged_journal = _staged_journal_path(data_repo, staged_id).read_bytes()
        if (
            journal_valid(staged_journal)
            and journal_load(staged_journal)["build_id"] == staged_id
        ):
            preserved = _report_from_manifest(
                staged_id,
                journal_manifest(journal_load(staged_journal)),
                staging_dir=str(staging_root / staged_id),
                adopted=True,
                preserved=True,
                reconciled=reconciled.completed,
            )
            # Already sealed and published: nothing to finalize, nothing to
            # deploy. Re-producing it would re-journal a build whose journal is
            # the authority on its own contents.
            return StagedBuild(
                build_id=staged_id,
                staging_dir=str(staging_root / staged_id),
                fresh=False,
                report=preserved,
            )
        rebuild_id = staged_id  # invalid journal → rebuild this id from source

    # From here fresh artifacts must be assembled, which requires the database.
    if db_path is None or not Path(db_path).exists():
        if reconciled.completed and rebuild_id is None:
            completed_id = max(reconciled.completed, key=_build_id_key)
            manifest_file = data_repo / "builds" / completed_id / "manifest.json"
            manifest = json.loads(manifest_file.read_text(encoding="utf-8"))
            completed = _report_from_manifest(
                completed_id,
                manifest,
                staging_dir="",
                adopted=False,
                preserved=True,
                reconciled=reconciled.completed,
            )
            return StagedBuild(
                build_id=completed_id,
                staging_dir="",
                fresh=False,
                report=completed,
            )
        raise PublishError(
            f"a source database is required to assemble a new build"
            f" ({db_path} is missing) — recovery of an in-flight build needs none"
        )
    db_path = Path(db_path)

    moment = now()
    created_at = rfc3339z(moment)
    adopted = rebuild_id is not None
    build_id = rebuild_id or next_build_id(data_repo, moment.date(), backend)

    _assert_owned_base_real(staging_root, ".staging/")
    staging_dir = staging_root / build_id
    if staging_dir.exists():
        shutil.rmtree(staging_dir)  # scratch / invalid-journal id being rebuilt
    build_dir = staging_dir / "build"
    assets_dir = staging_dir / "assets"
    build_dir.mkdir(parents=True)
    assets_dir.mkdir(parents=True)

    # --- snapshot + integrity + logical digest ------------------------------
    snapshot_path = assets_dir / DB_ARTIFACT
    source = connect(str(db_path))
    try:
        ensure_views(source)
        destination = sqlite3.connect(str(snapshot_path))
        try:
            source.backup(destination)
        finally:
            destination.close()
    finally:
        source.close()
    snapshot = connect(str(snapshot_path))
    try:
        (integrity,) = snapshot.execute("PRAGMA integrity_check").fetchone()
        if integrity != "ok":
            raise PublishError(f"snapshot failed integrity_check: {integrity}")
        ensure_views(snapshot)
        db_logical = logical_digest(snapshot)

        # --- stats (reuse; injected created_at, no clock reads) -------------
        house_meta = (
            read_house_meta(raw_root) if raw_root is not None else None
        )
        stats_document = compute_stats(
            snapshot, now=lambda: created_at, house_meta=house_meta
        )
        _write_staged(build_dir, "congress/stats.json", render_stats(stats_document))

        # --- feed + per-entity slices (locked decision 6) --------------------
        feed = {
            "feed_version": "1",
            "data_note": DATA_NOTE,
            "rows": _feed_rows(snapshot, limit=FEED_LIMIT),
        }
        _write_staged(build_dir, "congress/feed.json", _render_json(feed))

        for (bioguide_id,) in snapshot.execute(
            "SELECT DISTINCT bioguide_id FROM v_default_transactions"
            " WHERE bioguide_id IS NOT NULL ORDER BY bioguide_id"
        ):
            slice_doc = {
                "slice_version": "1",
                "bioguide_id": bioguide_id,
                "data_note": DATA_NOTE,
                "rows": _feed_rows(
                    snapshot,
                    limit=SLICE_LIMIT,
                    where=" WHERE bioguide_id = ?",
                    params=(bioguide_id,),
                ),
            }
            _write_staged(
                build_dir,
                f"congress/members/{bioguide_id}.json",
                _render_json(slice_doc),
            )

        skipped_tickers: list[str] = []
        for (ticker,) in snapshot.execute(
            "SELECT DISTINCT ticker FROM v_default_transactions"
            " WHERE ticker IS NOT NULL ORDER BY ticker"
        ):
            if not safe_artifact_name(ticker) or "/" in ticker:
                # Rows stay in the feed, the DB, and stats (TD-6) — only the
                # per-ticker slice route is skipped, and counted.
                skipped_tickers.append(ticker)
                continue
            slice_doc = {
                "slice_version": "1",
                "ticker": ticker,
                "data_note": DATA_NOTE,
                "rows": _feed_rows(
                    snapshot,
                    limit=SLICE_LIMIT,
                    where=" WHERE ticker = ?",
                    params=(ticker,),
                ),
            }
            _write_staged(
                build_dir, f"congress/tickers/{ticker}.json", _render_json(slice_doc)
            )

        # --- licensing set (R34; §15.1/§17 license gate) ---------------------
        register = licenses.load_register()
        register_errors = licenses.validate_register(register)
        if register_errors:
            raise PublishError(
                "packaged license register is invalid: "
                + "; ".join(register_errors)
            )
        _write_staged(build_dir, "licenses.json", _render_json(register))
        _write_staged(
            build_dir, "DATA-LICENSE.md", licenses.render_data_license(register)
        )
        _write_staged(build_dir, "NOTICE", licenses.render_notice(register))

        watermarks = {
            "house_index_last_modified": stats_document["freshness"][
                "house_index_last_modified"
            ],
            "senate_max_filed_date": stats_document["freshness"][
                "senate_db_max_filed_date"
            ],
        }

        # --- inst cross-filer aggregates + the M2 >=95% coverage gate (R1/R7) --
        # Guard on inst data: absent → a byte-identical M1 build (no inst module,
        # no inst_agg.db asset). The recovery journal stays congress-scoped
        # either way (R3); the inst asset is a separate staged Release asset.
        inst_agg_path = assets_dir / INST_DB_ARTIFACT
        inst_serving_path = assets_dir / INST_SERVING_ARTIFACT
        if inst_db_path is not None:
            # RUN M2-11 (R1): the accepted external snapshot is the ONLY inst
            # input — presence, coverage, watermarks and both derived databases
            # come from its read-only handle, never from the congress snapshot.
            derived, inst_source_document = _derive_inst_from_snapshot(
                Path(inst_db_path),
                inst_agg_path=inst_agg_path,
                inst_serving_path=inst_serving_path,
                created_at=created_at,
            )
            # `manifest.py` declares this artifact, `digests.py` declares its
            # projection, six publication boundaries thread it, the MCP
            # snapshot path reads it and `snapshot.py` installs it. THIS is
            # the call site that makes any of that reachable — without it
            # every build reported `per_filer_detail.published = false` and
            # every per-filer request fell through to live EDGAR (M2-8 T8).
            #
            # The provenance artifact is an ordinary staged file under
            # `build_dir`, so `_seal_build`'s walk enumerates it and the
            # recovery journal carries it verbatim — the generic installer
            # then handles it with zero code change (R24).
            _write_staged(
                build_dir,
                INST_SOURCE_ARTIFACT,
                _render_json(inst_source_document),
            )
            # Producer guard (R24): a build given --inst-db that fails to
            # emit its provenance is refused — "optional" must never be
            # indistinguishable from "absent because nobody wrote it".
            if not (build_dir / INST_SOURCE_ARTIFACT).is_file():
                raise PublishError(
                    f"stage-build was given --inst-db but did not emit"
                    f" {INST_SOURCE_ARTIFACT} — refusing to publish an inst"
                    " module whose source identity is unrecorded (R24)"
                )
        elif _inst_data_present(snapshot):
            derived = _derive_inst_module(
                snapshot,
                inst_agg_path=inst_agg_path,
                inst_serving_path=inst_serving_path,
                created_at=created_at,
            )
        else:
            derived = {
                "inst_logical": None,
                "inst_serving_logical": None,
                "inst_watermarks": None,
                "inst_withheld": None,
                "inst_period_coverage": None,
                "inst_cover_dispositions": None,
            }
        inst_logical: str | None = derived["inst_logical"]
        inst_serving_logical: str | None = derived["inst_serving_logical"]
        inst_watermarks: dict | None = derived["inst_watermarks"]
        inst_withheld: dict | None = derived["inst_withheld"]
        inst_period_coverage: list[dict] | None = derived["inst_period_coverage"]
        inst_cover_dispositions: dict | None = derived["inst_cover_dispositions"]
    finally:
        snapshot.close()

    # --- previous build ------------------------------------------------------
    previous_build_id: str | None = None
    latest_path = data_repo / "latest.json"
    if latest_path.exists():
        try:
            current = json.loads(latest_path.read_text(encoding="utf-8"))
        except (OSError, ValueError) as exc:
            raise PublishError(f"latest.json is unreadable: {exc}") from exc
        pointer_errors = validate_pointer(current)
        if pointer_errors:
            raise PublishError(
                "latest.json is invalid: " + "; ".join(pointer_errors)
            )
        previous_build_id = current["build_id"]

    # --- state handed to the sealing phase ------------------------------------
    # Everything `_seal_build` needs, captured once. The manifest is assembled
    # from `build_dir` twice — provisionally now so the site build has something
    # to read, and finally in `finalize_build` after the served file count is
    # known — so the assembly itself lives in `_seal_build`, not here.
    state = {
        "build_dir": build_dir,
        "staging_dir": staging_dir,
        "data_repo": data_repo,
        "snapshot_path": snapshot_path,
        "inst_agg_path": inst_agg_path,
        "build_id": build_id,
        "expected_modules": sorted(expected_modules),
        "created_at": created_at,
        "previous_build_id": previous_build_id,
        "watermarks": watermarks,
        "register": register,
        "backend": backend,
        "db_logical": db_logical,
        "inst_logical": inst_logical,
        # RUN M2-8: `_seal_build` enumerates the serving artifact from these.
        "inst_serving_path": inst_serving_path,
        "inst_serving_logical": inst_serving_logical,
        "inst_watermarks": inst_watermarks,
        "inst_withheld": inst_withheld,
        "inst_period_coverage": inst_period_coverage,
        "inst_cover_dispositions": inst_cover_dispositions,
        "skipped_tickers": skipped_tickers,
        "adopted": adopted,
        "reconciled": reconciled.completed,
        "stats_document": stats_document,
    }
    # The provisional manifest: written so `data.ts` can read `manifest.modules`
    # and decide which surfaces exist. It is NOT journalled — the journal stays
    # last, after finalize re-assembles (R35).
    _seal_build(state, provisional=True)
    return StagedBuild(
        build_id=build_id,
        staging_dir=str(staging_dir),
        fresh=True,
        _state=state,
    )


# --- publish (R9/R10/R25/R26/R31/R35) ----------------------------------------


@dataclass(frozen=True)
class PublishReport:
    build_id: str
    pointer_version: int | None
    dry_run: bool
    actions: tuple[str, ...]
    reconciled: tuple[str, ...] = ()


def _preflight_module_assets(
    data_repo: Path, build_id: str, journal: dict, backend: ReleaseBackend
) -> None:
    """Every NON-congress module DB asset must be obtainable BEFORE the first
    mutation: staged with the manifest's exact sha256/size, or already a verified
    asset on the release. Without this a dry-run could claim a build would
    publish while its inst_agg.db is missing/corrupt, and a real publish could
    upload the journal and congress.db before refusing — mutating on a build that
    was never publishable (QA-F6, §5.5 preflight).

    Shared by `_preflight` AND the draft-reconciliation path, which reaches
    `_complete_build` without `_preflight` (QA-F1, round 6).
    """
    manifest_text = journal["artifacts"].get("manifest.json")
    if manifest_text:
        try:
            staged_manifest = json.loads(manifest_text)
        except ValueError:
            staged_manifest = None
        if isinstance(staged_manifest, dict):
            assets_dir = Path(data_repo) / STAGING_DIR / build_id / "assets"
            for module_name in sorted(staged_manifest.get("modules", {})):
                if module_name == MODULE:
                    continue  # congress.db comes from the journal itself
                # EVERY database artifact, not just the primary one — the resume/reconcile
                # path must not silently skip a second asset either (review r3 F9).
                for db_name in module_db_artifacts(module_name):
                    entry = find_artifact(staged_manifest, db_name, module=module_name)
                    if entry is None:
                        continue
                    if backend.verify_asset(
                        build_id, db_name, sha256=entry["sha256"], size=entry["bytes"]
                    ):
                        continue  # already uploaded and verified on the release
                    staged_asset = assets_dir / db_name
                    if not staged_asset.is_file():
                        # Same operator guidance as the in-flight refusal: the
                        # congress-scoped journal cannot regenerate a module asset,
                        # so the resolution is the drafts-only cleanup + rebuild.
                        raise PublishError(
                            f"module {module_name!r} asset {db_name} is neither staged"
                            f" at {staged_asset} nor a verified release asset —"
                            " refusing to publish an incomplete multi-module build."
                            " Run the drafts-only cleanup (docs/runbooks/rollback.md"
                            " Appendix A) and rebuild under a new build_id to"
                            " regenerate it (TD-M2-3-1)."
                        )
                    if (
                        sha256_file(staged_asset) != entry["sha256"]
                        or staged_asset.stat().st_size != entry["bytes"]
                    ):
                        raise PublishError(
                            f"staged module asset {db_name} does not match the"
                            f" manifest (sha256/bytes) — refusing an inconsistent"
                            " publish"
                        )


def _preflight(
    data_repo: Path,
    build_id: str,
    journal_bytes: bytes,
    backend: ReleaseBackend,
) -> None:
    """Verify every immutable target BEFORE the first write (R25)."""
    journal = journal_load(journal_bytes)  # refuses partial builds (R10)
    # F2: a symlinked builds/<build_id> would redirect materialize writes
    # outside the data repo — refuse here, before any draft/upload/publish.
    escape = _build_dir_escape_error(Path(data_repo) / "builds", build_id)
    if escape is not None:
        raise PublishError(escape)
    # A committed build that differs from this journal (any artifact) is a
    # conflicting republish — refuse here, before any draft/upload/publish.
    conflict = _committed_build_conflict(data_repo, build_id, journal)
    if conflict is not None:
        raise PublishError(conflict)
    # Staged artifacts, where still present, must agree with the journal.
    build_dir = Path(data_repo) / STAGING_DIR / build_id / "build"
    if build_dir.is_dir():
        for relpath, text in journal["artifacts"].items():
            staged = build_dir / relpath
            if staged.is_file() and staged.read_text(encoding="utf-8") != text:
                raise PublishError(
                    f"staged artifact {relpath} differs from the journal —"
                    " refusing an inconsistent publish"
                )

    _preflight_module_assets(Path(data_repo), build_id, journal, backend)

    release = backend.get_release(build_id)
    if release is not None and not release.draft:
        journal_sha = journal_sha256(journal_bytes)
        if not backend.verify_asset(
            build_id, JOURNAL_ASSET, sha256=journal_sha, size=len(journal_bytes)
        ):
            raise PublishError(
                f"release data-{build_id} is already published with different"
                " bytes — refusing to re-publish; existing assets unchanged"
            )
    latest_path = Path(data_repo) / "latest.json"
    if latest_path.exists():
        try:
            current = json.loads(latest_path.read_text(encoding="utf-8"))
        except (OSError, ValueError) as exc:
            raise PublishError(f"latest.json is unreadable: {exc}") from exc
        pointer_errors = validate_pointer(current)
        if pointer_errors:
            raise PublishError(
                "latest.json is invalid: " + "; ".join(pointer_errors)
            )


def _staged_build_ids(data_repo: Path) -> list[str]:
    staging_root = Path(data_repo) / STAGING_DIR
    if not staging_root.is_dir():
        return []
    found = []
    for entry in staging_root.iterdir():
        if (
            entry.is_dir()
            and _BUILD_ID.match(entry.name)
            and (entry / "journal.json").is_file()
        ):
            found.append(entry.name)
    return sorted(found, key=_build_id_key)


def _publish_rollback(
    data_repo: Path,
    rollback_to: str,
    *,
    backend: ReleaseBackend,
    now: Callable[[], datetime],
    attestation: AttestationProvider,
    dry_run: bool,
) -> PublishReport:
    """§13.5 staging rollback: a new, higher pointer targeting an older build.

    Preflight (F4): the target must be a complete, verifiable published build
    — its committed manifest validates, its build_id matches, and EVERY
    immutable asset the manifest enumerates reconciles (committed ``path``
    files by hash; Release ``url`` assets — the database and journal — through
    the backend) BEFORE ``latest.json`` is repointed. A missing or corrupt
    target asset refuses the rollback instead of pointing consumers at it.
    """
    manifest_path = data_repo / "builds" / rollback_to / "manifest.json"
    if not manifest_path.is_file():
        raise PublishError(
            f"rollback target {rollback_to} has no committed manifest at"
            f" builds/{rollback_to}/manifest.json"
        )
    manifest_bytes = manifest_path.read_bytes()
    # The rollback target's committed metadata is external, corruptible input
    # (F4): a malformed target manifest must refuse cleanly, never raise an
    # uncaught JSON exception out of the publish command.
    try:
        manifest = json.loads(manifest_bytes.decode("utf-8"))
    except (UnicodeDecodeError, ValueError) as exc:
        raise PublishError(
            f"rollback target {rollback_to} has an unparseable manifest: {exc}"
        ) from exc
    manifest_errors = validate_manifest(manifest)
    if manifest_errors or manifest["build_id"] != rollback_to:
        raise PublishError(
            f"rollback target manifest is invalid: {'; '.join(manifest_errors)}"
        )
    identity = pointer_manifest_identity_error(manifest, rollback_to)
    if identity is not None:
        raise PublishError(f"rollback target: {identity}")
    # Verify every enumerated immutable asset of EVERY module before repointing
    # (R11): a missing/corrupt inst_agg.db refuses the rollback just as a missing
    # congress.db does — consumers are never pointed at an unverifiable build.
    for module_name in sorted(manifest["modules"]):
        for entry in manifest["modules"][module_name]["artifacts"]:
            name = entry["name"]
            if entry.get("path") is not None:
                try:
                    committed = resolve_within(data_repo, entry["path"])
                except UnsafeArchivePathError as exc:
                    raise PublishError(f"rollback target {name}: unsafe path: {exc}")
                if (
                    not committed.is_file()
                    or committed.stat().st_size != entry["bytes"]
                    or sha256_file(committed) != entry["sha256"]
                ):
                    raise PublishError(
                        f"rollback target artifact {name} is missing or does not"
                        " match its manifest — refusing to repoint"
                    )
            else:
                if not backend.verify_asset(
                    rollback_to, name, sha256=entry["sha256"], size=entry["bytes"]
                ):
                    raise PublishError(
                        f"rollback target Release asset {name} for"
                        f" data-{rollback_to} is missing or corrupt — refusing to"
                        " repoint at an unverifiable build"
                    )
    latest_path = data_repo / "latest.json"
    if not latest_path.exists():
        raise PublishError("rollback requires an existing latest.json pointer")
    try:
        current = json.loads(latest_path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        raise PublishError(f"latest.json is unreadable: {exc}") from exc
    pointer_errors = validate_pointer(current)
    if pointer_errors:
        raise PublishError("latest.json is invalid: " + "; ".join(pointer_errors))
    pointer_version = current["pointer_version"] + 1
    if dry_run:
        return PublishReport(rollback_to, pointer_version, True, ("dry_run:rollback",))
    pointer = build_pointer(
        pointer_version=pointer_version,
        issued_at=now(),
        build_id=rollback_to,
        manifest_sha256=hashlib.sha256(manifest_bytes).hexdigest(),
    )
    pointer_bytes = render_pointer(pointer).encode("utf-8")
    _require_attested(attestation.attest("latest.json", pointer_bytes))
    atomic_write_bytes(latest_path, pointer_bytes)
    return PublishReport(
        rollback_to, pointer_version, False, (f"pointer:{pointer_version}",)
    )


def require_site_file_count(staging_dir: Path | str) -> int:
    """Assert a staged build carries a real served-file count, and return it.

    **This is deliberately a publish-time check and not a schema rule.** The
    schema requires the key and permits ``null``, because
    ``tests/schemas/stats.schema.json`` is closed-world and is validated in
    three places (``tests/test_stats.py``, ``scripts/accept_m1_b.py``,
    ``tests/test_members.py``) that build stats without ever running the site
    seam — making it a non-nullable integer there would break standing gates
    over builds that have no site by design.

    So the schema answers "is this document well-formed?" and this answers "did
    the deploying path actually run?". Those are different questions, and
    collapsing them into one would either break the gates or lose the ability to
    tell "nobody wrote a count" from "this build never needed one".

    The deploying workflow calls this between ``finalize-build`` and the deploy
    leg. Nothing else should: the single-phase ``run_build`` wrapper publishes
    ``null`` on purpose.
    """
    stats_path = Path(staging_dir) / "build" / "congress" / "stats.json"
    if not stats_path.is_file():
        raise PublishError(f"no staged stats.json at {stats_path}")
    try:
        stats = json.loads(stats_path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        raise PublishError(f"staged stats.json is unreadable: {exc}") from exc
    if "site_file_count" not in stats:
        raise PublishError(
            "staged stats.json has no `site_file_count` key — it predates the"
            " §12.1 site seam and cannot be deployed"
        )
    count = stats["site_file_count"]
    if count is None:
        raise PublishError(
            "staged stats.json carries `site_file_count: null` — the site build"
            " and `populus finalize-build` did not run for this build, so the"
            " published stats would describe a site that was never counted"
        )
    if not isinstance(count, int) or isinstance(count, bool) or count < 1:
        raise PublishError(f"`site_file_count` must be a positive integer, got {count!r}")
    return count


def run_publish(
    data_repo: Path | str,
    *,
    now: Callable[[], datetime],
    backend: ReleaseBackend,
    build_id: str | None = None,
    attestation: AttestationProvider | None = None,
    dry_run: bool = False,
    rollback_to: str | None = None,
) -> PublishReport:
    """§5.5 P1 publication: journal first, pointer last, complete-on-resume.

    ``reconcile_inflight`` runs first, so an interrupted prior publish is
    completed (same build_id) before — or instead of — anything new.
    ``--dry-run`` writes nothing anywhere, including no reconcile mutations.
    """
    data_repo = Path(data_repo)
    attestation = attestation or StagingNoop()
    if not data_repo.is_dir():
        raise PublishError(f"data repo {data_repo} does not exist")
    # Path-safety: the externally-supplied build ids (`--build`/`--rollback-to`)
    # flow into `.staging/<id>/`, `builds/<id>/`, and `data-<id>` joins. Reject
    # anything that is not a well-formed build_id at the boundary, so no path is
    # derived from an unvalidated traversal string (R29).
    for label, value in (("--build", build_id), ("--rollback-to", rollback_to)):
        if value is not None and _BUILD_ID.match(value) is None:
            raise PublishError(
                f"{label} {value!r} is not a valid build_id (YYYYMMDD.N)"
            )
    if rollback_to is not None:
        # F7: resolve in-flight publication state BEFORE mutating the pointer,
        # exactly as the normal publish path does (R18/R25/R35). A pending
        # recoverable draft is completed first so the rollback repoints against
        # a consistent state and cannot be silently undone by the next reconcile
        # (which would otherwise complete the draft and mint a still-higher
        # pointer back to the newer build). --dry-run must not mutate, so it
        # refuses when in-flight drafts are pending rather than reconciling.
        if dry_run:
            drafts = backend.list_draft_tags()
            if drafts:
                raise PublishError(
                    "refusing --rollback-to --dry-run while in-flight draft(s)"
                    f" {sorted(drafts)} are pending — a real rollback reconciles"
                    " them first; resolve or run without --dry-run"
                )
            return _publish_rollback(
                data_repo,
                rollback_to,
                backend=backend,
                now=now,
                attestation=attestation,
                dry_run=True,
            )
        reconcile = reconcile_inflight(
            data_repo, now=now, backend=backend, attestation=attestation
        )
        report = _publish_rollback(
            data_repo,
            rollback_to,
            backend=backend,
            now=now,
            attestation=attestation,
            dry_run=False,
        )
        return replace(report, reconciled=reconcile.completed)

    staged = _staged_build_ids(data_repo)
    target = build_id or (staged[-1] if staged else None)

    if dry_run:
        if target is None:
            raise PublishError(
                "nothing staged to publish — run `populus build` first"
            )
        journal_bytes = _recover_journal(data_repo, target, backend)
        _preflight(data_repo, target, journal_bytes, backend)
        return PublishReport(target, None, True, (f"dry_run:{target}",))

    reconcile = reconcile_inflight(
        data_repo, now=now, backend=backend, attestation=attestation
    )
    if target is None:
        if reconcile.completed:
            return PublishReport(
                reconcile.completed[-1],
                None,
                False,
                reconcile.actions,
                reconciled=reconcile.completed,
            )
        raise PublishError("nothing staged to publish — run `populus build` first")
    if target in reconcile.completed:
        return PublishReport(
            target, None, False, reconcile.actions, reconciled=reconcile.completed
        )

    journal_bytes = _recover_journal(data_repo, target, backend)
    _preflight(data_repo, target, journal_bytes, backend)
    actions: list[str] = []
    pointer_version = _complete_build(
        data_repo,
        target,
        journal_bytes,
        backend=backend,
        attestation=attestation,
        now=now,
        actions=actions,
    )
    return PublishReport(
        target,
        pointer_version,
        False,
        tuple(actions),
        reconciled=reconcile.completed,
    )


# --- verify (R10/R34) --------------------------------------------------------


@dataclass(frozen=True)
class VerifyReport:
    ok: bool
    build_id: str | None
    errors: tuple[str, ...]
    notes: tuple[str, ...]
    checked_artifacts: int


def _verify_local_db_artifact(
    db_file: Path,
    entry: dict,
    *,
    projection: dict[str, frozenset[str]],
    label: str,
) -> list[str]:
    """SQLite integrity + logical-digest checks for a LOCAL database artifact.

    R10 requires ``populus verify`` to validate each published module database's
    ``PRAGMA integrity_check`` and to recompute its ``logical_digest`` under the
    module's own *projection*, directly from the manifest-resolved artifact —
    with no ``--db`` supplied (F2). A hash-consistent but corrupt or non-SQLite
    file, or a manifest whose ``logical_digest`` disagrees with the actual
    database, is a defect here. (``--db`` remains the §13.5 disaster-recovery
    source reconciliation.)
    """
    errors: list[str] = []
    try:
        conn = connect(str(db_file))
    except sqlite3.Error as exc:
        return [f"{label}: not a valid SQLite database: {exc}"]
    try:
        try:
            (integrity,) = conn.execute("PRAGMA integrity_check").fetchone()
        except sqlite3.Error as exc:
            return [f"{label}: PRAGMA integrity_check could not run: {exc}"]
        if integrity != "ok":
            errors.append(
                f"{label}: PRAGMA integrity_check reported {integrity!r}"
            )
        expected = entry.get("logical_digest")
        try:
            recomputed = logical_digest(conn, projection)
        except (DigestError, sqlite3.Error) as exc:
            errors.append(
                f"{label}: logical_digest could not be recomputed: {exc}"
            )
        else:
            if recomputed != expected:
                errors.append(
                    f"{label}: recomputed logical_digest {recomputed} does"
                    f" not reconcile with the manifest logical_digest {expected}"
                )
    finally:
        conn.close()
    return errors


def run_verify(
    data_repo: Path | str,
    *,
    now: Callable[[], datetime],
    db_path: Path | str | None = None,
    attestation: AttestationProvider | None = None,
) -> VerifyReport:
    """Recompute hashes, logical digests, and pointer/manifest consistency.

    ``url`` artifacts were byte-verified at publish time against the journal;
    re-fetching them here is ``verify --remote`` (P2) — stated in the notes,
    never silently claimed. With ``db_path``, performs the §13.5
    disaster-recovery reconciliation: logical digest plus row counts against
    the manifest-listed ``stats.json``.
    """
    data_repo = Path(data_repo)
    attestation = attestation or StagingNoop()
    errors: list[str] = []
    notes: list[str] = []
    checked = 0

    latest_path = data_repo / "latest.json"
    if not latest_path.is_file():
        return VerifyReport(False, None, ("latest.json does not exist",), (), 0)
    pointer_bytes = latest_path.read_bytes()
    try:
        pointer = json.loads(pointer_bytes.decode("utf-8"))
    except (UnicodeDecodeError, ValueError) as exc:
        return VerifyReport(False, None, (f"latest.json unparseable: {exc}",), (), 0)
    pointer_errors = validate_pointer(pointer)
    if pointer_errors:
        return VerifyReport(
            False, None, tuple(f"pointer: {err}" for err in pointer_errors), (), 0
        )
    moment = now()
    if parse_rfc3339z(pointer["expires_at"]) <= moment:
        errors.append(f"pointer expired at {pointer['expires_at']} (stale)")
    # Future-issuance: a pointer issued beyond the same small skew the client's
    # state machine tolerates (evaluate_pointer) is rejected here too (F4), so
    # `verify` and the consumer agree on which pointers are acceptable.
    if parse_rfc3339z(pointer["issued_at"]) > moment + timedelta(
        seconds=ISSUANCE_SKEW_SECONDS
    ):
        errors.append(
            f"pointer issued in the future at {pointer['issued_at']}"
        )
    verdict = attestation.verify("latest.json", pointer_bytes)
    if not verdict.ok:
        errors.append(f"pointer attestation rejected: {verdict.detail}")

    build_id = pointer["build_id"]
    try:
        manifest_file = resolve_within(data_repo, pointer["manifest_path"])
    except Exception as exc:  # UnsafeArchivePathError and kin
        return VerifyReport(
            False, build_id, (*errors, f"manifest path unsafe: {exc}"), (), 0
        )
    if not manifest_file.is_file():
        return VerifyReport(
            False,
            build_id,
            (*errors, f"manifest missing at {pointer['manifest_path']}"),
            (),
            0,
        )
    manifest_bytes = manifest_file.read_bytes()
    if hashlib.sha256(manifest_bytes).hexdigest() != pointer["manifest_sha256"]:
        errors.append("manifest bytes do not hash to the pointer's manifest_sha256")
    verdict = attestation.verify("manifest.json", manifest_bytes)
    if not verdict.ok:
        errors.append(f"manifest attestation rejected: {verdict.detail}")
    # A digest-consistent manifest can still be malformed (bytes hash to the
    # pointer's manifest_sha256 yet are not valid/structured JSON) — return a
    # failed report, never a traceback (F2; mirrors the monitor stats guard).
    try:
        manifest = json.loads(manifest_bytes.decode("utf-8"))
    except (UnicodeDecodeError, ValueError) as exc:
        return VerifyReport(
            False, build_id, (*errors, f"manifest unparseable: {exc}"), tuple(notes), 0
        )
    if not isinstance(manifest, dict):
        return VerifyReport(
            False,
            build_id,
            (*errors, "manifest is not a JSON object"),
            tuple(notes),
            0,
        )
    register = licenses.load_register()
    register_errors = licenses.validate_register(register)
    errors.extend(f"register: {err}" for err in register_errors)
    manifest_errors = validate_manifest(
        manifest, register_ids=licenses.register_ids(register)
    )
    errors.extend(f"manifest: {err}" for err in manifest_errors)
    if manifest_errors:
        return VerifyReport(False, build_id, tuple(errors), tuple(notes), 0)
    identity_error = pointer_manifest_identity_error(manifest, build_id)
    if identity_error is not None:
        return VerifyReport(
            False, build_id, (*errors, identity_error), tuple(notes), 0
        )

    # Recompute EVERY module's artifact hashes and DB logical digest (R4): a
    # two-module build re-verifies both congress.db (congress projection) and
    # inst_agg.db (inst projection), each under its own module's allowlist.
    stats_bytes: bytes | None = None
    for module_name in sorted(manifest["modules"]):
        # The set of names that must be logical-digest verified for this module.
        # A membership test, not an equality test: with two inst databases an
        # `== db_artifact` comparison verifies the aggregate and silently skips
        # the serving projection (review r3 F9).
        db_artifacts = set(module_db_artifacts(module_name))
        for entry in manifest["modules"][module_name]["artifacts"]:
            name = entry["name"]
            if entry.get("path") is not None:
                try:
                    artifact_file = resolve_within(data_repo, entry["path"])
                except Exception as exc:
                    errors.append(f"{name}: unsafe path: {exc}")
                    continue
                if not artifact_file.is_file():
                    errors.append(f"{name}: missing at {entry['path']}")
                    continue
                checked += 1
                if artifact_file.stat().st_size != entry["bytes"]:
                    errors.append(f"{name}: byte size differs from the manifest")
                if sha256_file(artifact_file) != entry["sha256"]:
                    errors.append(f"{name}: sha256 differs from the manifest")
                elif name == "congress/stats.json":
                    stats_bytes = artifact_file.read_bytes()
                elif name in db_artifacts:
                    # F2: a LOCAL (path) database artifact is integrity- and
                    # logical-digest-checked here (under its module's own
                    # projection), with no --db required.
                    errors.extend(
                        _verify_local_db_artifact(
                            artifact_file,
                            entry,
                            projection=projection_for(name, module_name),
                            label=name,
                        )
                    )
            else:
                notes.append(
                    f"{name}: remote release asset — publish-time verified;"
                    " `verify --remote` is P2"
                )

    # Licensing set (R34): present, enumerated, and byte-consistent with the
    # packaged register renders.
    expected_renders = {
        "licenses.json": _render_json(register),
        "DATA-LICENSE.md": licenses.render_data_license(register),
        "NOTICE": licenses.render_notice(register),
    }
    for name, expected in expected_renders.items():
        entry = find_artifact(manifest, name)
        if entry is None:
            errors.append(f"licensing artifact {name} is not enumerated (R34)")
            continue
        committed = data_repo / "builds" / build_id / name
        if not committed.is_file():
            errors.append(f"licensing artifact {name} is missing from the build")
        elif committed.read_text(encoding="utf-8") != expected:
            errors.append(
                f"licensing artifact {name} is inconsistent with the packaged"
                " register"
            )

    if db_path is not None:
        db_entry = find_artifact(manifest, DB_ARTIFACT)
        # The --db argument and the manifest-listed stats.json are both
        # external, corruptible inputs (F3): a non-SQLite --db raises
        # sqlite3.Error, and a digest-consistent malformed stats.json raises
        # JSON/shape errors. Every one is converted to a verify error here,
        # never an uncaught traceback.
        try:
            conn = connect(str(db_path))
        except sqlite3.Error as exc:
            errors.append(f"--db is not a valid SQLite database: {exc}")
            return VerifyReport(
                False, build_id, tuple(errors), tuple(notes), checked
            )
        try:
            try:
                recomputed = logical_digest(conn)
            except (DigestError, sqlite3.Error) as exc:
                errors.append(f"logical digest of the given database failed: {exc}")
            else:
                if db_entry is not None and recomputed != db_entry["logical_digest"]:
                    errors.append(
                        "logical_digest of the given database does not reconcile"
                        " with the manifest"
                    )
            if stats_bytes is not None:
                try:
                    stats_doc = json.loads(stats_bytes.decode("utf-8"))
                    totals = stats_doc["totals"]
                    if not isinstance(totals, dict):
                        raise ValueError("stats.json 'totals' is not an object")
                except (UnicodeDecodeError, ValueError, KeyError, TypeError) as exc:
                    errors.append(
                        f"stats.json for --db reconciliation is malformed: {exc}"
                    )
                else:
                    counts = {
                        "filing_count_including_excluded": "filings",
                        "transaction_count_including_excluded": "transactions",
                        "member_count": "members",
                    }
                    for stat_key, table in counts.items():
                        try:
                            (count,) = conn.execute(
                                f'SELECT COUNT(*) FROM "{table}"'  # nosec B608 — constant
                            ).fetchone()
                        except sqlite3.Error as exc:
                            errors.append(
                                f"--db row count for {table} failed: {exc}"
                            )
                            continue
                        if totals.get(stat_key) != count:
                            errors.append(
                                f"row count for {table} ({count}) does not reconcile"
                                f" with stats.json {stat_key} ({totals.get(stat_key)})"
                            )
        finally:
            conn.close()

    return VerifyReport(
        ok=not errors,
        build_id=build_id,
        errors=tuple(errors),
        notes=tuple(notes),
        checked_artifacts=checked,
    )
