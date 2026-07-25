"""The snapshot client: §5.5 consumer protocol + crash-consistent cache.

The cache owns its crash-consistency invariant across three boundaries
(R24): write-time verify-before-rename, content-keyed idempotent re-install,
and read-time :meth:`SnapshotClient.reconcile`. The replay/equivocation
anchor is exactly the two-field ``(pointer_version, pointer_sha256)`` tuple;
the install sidecar is advisory metadata, cross-checked against the tuple
before it is believed. Artifacts from different builds never mix — the cache
is keyed by ``<module>/<build_id>``.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
import sqlite3
from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Protocol

import httpx
from packaging.specifiers import SpecifierSet
from packaging.version import InvalidVersion, Version

import populus
from populus.publish.attestation import AttestationProvider, StagingNoop
from populus.publish.manifest import (
    MODULE,
    module_artifacts,
    module_db_artifact,
    parse_release_download_url,
    pointer_manifest_identity_error,
    resolve_within,
    safe_artifact_name,
    validate_manifest,
)
from populus.publish.pointer import (
    TrustTupleError,
    evaluate_pointer,
    load_tuple,
    persist_tuple,
)


# The §5.5 cache location; callers (the P2 MCP server) pass it explicitly so
# tests and drills can relocate the cache without touching HOME.
DEFAULT_CACHE_ROOT = Path.home() / ".cache" / "populus"

# A module name is a single lowercase identifier — never a path. Validated at
# construction so it can never be an absolute/traversal/separator string that
# would place the cache outside cache_root (R29/F2).
_MODULE_NAME = re.compile(r"^[a-z][a-z0-9_]{0,63}$")


class FetchError(RuntimeError):
    """A fetch failed (transport, status, or malformed input)."""


class Fetcher(Protocol):
    """How the client reaches the data repo's git files and release assets."""

    def fetch_path(self, relpath: str) -> bytes: ...

    def fetch_asset(self, url: str, dest: Path) -> None: ...


class LocalRepoFetcher:
    """Read a local ``populus-data`` working tree (offline acceptance/tests)."""

    def __init__(self, data_repo: Path | str) -> None:
        self._data_repo = Path(data_repo)

    def fetch_path(self, relpath: str) -> bytes:
        try:
            target = resolve_within(self._data_repo, relpath)
        except Exception as exc:
            raise FetchError(f"unsafe path {relpath!r}: {exc}") from exc
        if not target.is_file():
            raise FetchError(f"{relpath} does not exist in {self._data_repo}")
        return target.read_bytes()

    def fetch_asset(self, url: str, dest: Path) -> None:
        raise FetchError(
            "url artifacts require the authenticated GitHub fetcher; the"
            " local-dir backend publishes the database as a path artifact"
        )


class GitHubRepoFetcher:
    """Authenticated reads from the private staging repo (R27).

    Git files come from the contents API (raw media type); release assets are
    resolved and downloaded through the authenticated Release Assets API (never
    the manifest's browser-download URL — R27/F5). The HTTP transport is
    injectable so tests run hermetically over ``httpx.MockTransport``.
    """

    def __init__(
        self,
        repo_slug: str,
        token: str,
        *,
        transport: httpx.BaseTransport | None = None,
    ) -> None:
        self._repo = repo_slug
        # Every token-bearing request targets api.github.com under THIS repo
        # only. Release assets are fetched via the asset-id API endpoint, and
        # httpx strips Authorization on the cross-origin 302 to the blob host,
        # so the bearer token never reaches a browser-download / redirect URL.
        self._client = httpx.Client(
            transport=transport,
            follow_redirects=True,
            timeout=60.0,
            headers={
                "Authorization": f"Bearer {token}",
                "X-GitHub-Api-Version": "2022-11-28",
                "User-Agent": f"populus-client/{populus.__version__}",
            },
        )

    def fetch_path(self, relpath: str) -> bytes:
        url = f"https://api.github.com/repos/{self._repo}/contents/{relpath}"
        try:
            response = self._client.get(
                url, headers={"Accept": "application/vnd.github.raw+json"}
            )
        except httpx.InvalidURL as exc:
            # Malformed URLs raise at call time, not as transport errors —
            # both branches must land in FetchError.
            raise FetchError(f"malformed URL {url!r}: {exc}") from exc
        except httpx.HTTPError as exc:
            raise FetchError(f"fetch of {relpath} failed: {type(exc).__name__}") from exc
        if response.status_code != 200:
            raise FetchError(
                f"fetch of {relpath} returned HTTP {response.status_code}"
            )
        return response.content

    def fetch_asset(self, url: str, dest: Path) -> None:
        # The manifest hands a canonical github.com browser-download URL. The
        # bearer token is NEVER sent there (R27/F5): parse the pinned
        # (owner/repo, build tag, asset name), confirm it is under THIS repo,
        # resolve the asset id through the authenticated Release Assets API, and
        # download the api.github.com asset endpoint with the octet-stream media
        # type. GitHub 302-redirects that to a short-lived blob URL on another
        # host; httpx strips Authorization on the cross-origin hop.
        parts = parse_release_download_url(url)
        if parts is None or f"{parts['owner']}/{parts['repo']}" != self._repo:
            raise FetchError(
                "refusing to send the repository token to a release URL"
                f" outside {self._repo}: {url!r}"
            )
        asset_id = self._resolve_asset_id(f"data-{parts['build_id']}", parts["asset"])
        api_url = f"https://api.github.com/repos/{self._repo}/releases/assets/{asset_id}"
        try:
            response = self._client.get(
                api_url, headers={"Accept": "application/octet-stream"}
            )
        except httpx.HTTPError as exc:
            raise FetchError(f"asset fetch failed: {type(exc).__name__}") from exc
        # GitHub returns 200 (streamed) or 302 (followed by httpx). A followed
        # 302 lands as 200 here; any other status is a failure.
        if response.status_code != 200:
            raise FetchError(f"asset fetch returned HTTP {response.status_code}")
        dest.write_bytes(response.content)

    def _resolve_asset_id(self, tag: str, asset_name: str) -> int:
        """The integer asset id for *asset_name* on release *tag*, via the API.

        Deep-validates the (remote, untrusted) release JSON: an object with an
        ``assets`` array of records, each a dict whose ``name`` matches and
        whose ``id`` is a genuine integer — never a bare index that could raise.
        """
        api_url = f"https://api.github.com/repos/{self._repo}/releases/tags/{tag}"
        try:
            response = self._client.get(
                api_url, headers={"Accept": "application/vnd.github+json"}
            )
        except httpx.HTTPError as exc:
            raise FetchError(
                f"release lookup for {tag} failed: {type(exc).__name__}"
            ) from exc
        if response.status_code != 200:
            raise FetchError(
                f"release lookup for {tag} returned HTTP {response.status_code}"
            )
        try:
            payload = response.json()
        except ValueError as exc:
            raise FetchError(f"release {tag} response is not JSON: {exc}") from exc
        assets = payload.get("assets") if isinstance(payload, dict) else None
        if not isinstance(assets, list):
            raise FetchError(f"release {tag} response has no assets array")
        for asset in assets:
            if not isinstance(asset, dict) or asset.get("name") != asset_name:
                continue
            asset_id = asset.get("id")
            if not isinstance(asset_id, int) or isinstance(asset_id, bool):
                raise FetchError(
                    f"release {tag} asset {asset_name!r} has a non-integer id"
                )
            return asset_id
        raise FetchError(f"release {tag} has no asset named {asset_name!r}")


@dataclass(frozen=True)
class RefreshResult:
    """Outcome of one refresh: ``status`` ∈ installed · idempotent ·
    incompatible · refused; ``build_id`` is the build now being served."""

    status: str
    build_id: str | None
    pointer_version: int | None
    message: str


class SnapshotClient:
    """§5.5 MCP-client consumer over a durable, identity-scoped cache."""

    def __init__(
        self,
        cache_root: Path | str,
        fetcher: Fetcher,
        *,
        now: Callable[[], datetime],
        client_version: str | None = None,
        attestation: AttestationProvider | None = None,
        module: str = MODULE,
    ) -> None:
        self._fetcher = fetcher
        self._now = now
        self._client_version = client_version or populus.__version__
        self._attestation = attestation or StagingNoop()
        # F2: `module` becomes a cache directory name — enforce a strict
        # identifier grammar so it can never be an absolute/traversal/separator
        # (or symlink-named) escape.
        if not isinstance(module, str) or _MODULE_NAME.match(module) is None:
            raise ValueError(
                f"module {module!r} is not a valid module name"
                " (^[a-z][a-z0-9_]{0,63}$)"
            )
        self._module = module
        # Realpath the cache root ONCE; every cache path is then built through
        # the single `_safe_under` chokepoint and asserted to stay within it.
        cache_root_path = Path(cache_root)
        cache_root_path.mkdir(parents=True, exist_ok=True, mode=0o700)
        self._cache_root = cache_root_path.resolve()
        os.chmod(self._cache_root, 0o700)
        self._module_dir = self._safe_under(module)
        self._module_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
        os.chmod(self._module_dir, 0o700)
        self._tuple_path = self._safe_under(module, "trust.json")
        self._sidecar_path = self._safe_under(module, "install.json")
        self._current_path = self._safe_under(module, "current")

    def _safe_under(self, *parts: str) -> Path:
        """The single client cache-path chokepoint (R29/F2).

        Every cache path — the module dir, trust/sidecar/current markers, each
        per-build dir, and the ``.tmp-<build_id>`` staging dir — is built here.
        Each component must be a plain filename (no ``/``/``\\``, not
        ``.``/``..``/empty, no NUL), and the fully-resolved target (following
        ANY symlink) must stay within the realpath'd cache root; anything else
        raises ``ValueError``. No call site joins raw strings under the cache.
        """
        for part in parts:
            if (
                not isinstance(part, str)
                or part in ("", ".", "..")
                or "/" in part
                or "\\" in part
                or "\x00" in part
            ):
                raise ValueError(f"unsafe cache path component {part!r}")
        resolved = self._cache_root.joinpath(*parts).resolve()
        if resolved != self._cache_root and self._cache_root not in resolved.parents:
            raise ValueError(
                f"cache path {os.path.join(*parts)} escapes {self._cache_root}"
            )
        return resolved

    # --- serving state -------------------------------------------------------

    def current_build(self) -> str | None:
        """The build the client is serving, or ``None``."""
        if not self._current_path.is_file():
            return None
        build_id = self._current_path.read_text(encoding="utf-8").strip()
        # The `current` marker is client-owned but corruptible; route its
        # build_id through the chokepoint (a bad segment → not serving).
        try:
            manifest_file = self._safe_under(self._module, build_id, "manifest.json")
        except ValueError:
            return None
        if manifest_file.is_file():
            return build_id
        return None

    def db_path(self) -> Path | None:
        # Module-aware (R13/F6): resolve THIS module's database artifact —
        # `congress.db` for congress, `inst_agg.db` for inst — never a hardcoded
        # name, so an inst client reads its own aggregate through the accessor.
        build_id = self.current_build()
        if build_id is None:
            return None
        candidate = self._safe_under(
            self._module, build_id, module_db_artifact(self._module)
        )
        return candidate if candidate.is_file() else None

    def _load_trust(self) -> tuple[int, str] | None:
        """The persisted tuple; corruption is state loss for a client (TD-7)."""
        try:
            return load_tuple(self._tuple_path)
        except TrustTupleError:
            return None

    def _read_sidecar(self) -> dict | None:
        if not self._sidecar_path.is_file():
            return None
        try:
            sidecar = json.loads(self._sidecar_path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return None
        if (
            isinstance(sidecar, dict)
            and isinstance(sidecar.get("build_id"), str)
            # A single safe path segment — the build_id becomes a cache dir name.
            and safe_artifact_name(sidecar.get("build_id"))
            and "/" not in sidecar["build_id"]
            and isinstance(sidecar.get("pointer_version"), int)
            and isinstance(sidecar.get("pointer_sha256"), str)
            and isinstance(sidecar.get("manifest_sha256"), str)
        ):
            return sidecar
        return None

    def _build_complete(
        self, build_id: str, expected_manifest_sha256: str | None = None
    ) -> bool:
        """Every manifest-listed artifact present with matching bytes.

        The cached manifest is on-disk (corruptible) input: any malformed or
        wrong-shape record makes the build "incomplete" (re-fetch + re-verify),
        never an uncaught index/type error.

        When *expected_manifest_sha256* is given, the cached ``manifest.json``
        must hash to it — binding a pre-existing cache dir to the authenticated
        pointer's manifest (R8/R24/F1). Without this a self-consistent OTHER
        build copied under this build_id would pass and be served as current.
        """
        try:
            build_dir = self._safe_under(self._module, build_id)
        except ValueError:
            return False  # a bad build_id segment is never a complete build
        manifest_file = build_dir / "manifest.json"
        if not manifest_file.is_file():
            return False
        try:
            manifest_raw = manifest_file.read_bytes()
        except OSError:
            return False
        if (
            expected_manifest_sha256 is not None
            and hashlib.sha256(manifest_raw).hexdigest() != expected_manifest_sha256
        ):
            return False  # cached manifest is not the authenticated one
        try:
            manifest = json.loads(manifest_raw.decode("utf-8"))
            entries = module_artifacts(manifest, self._module)
        except (ValueError, KeyError, TypeError):
            return False
        if not isinstance(entries, list):
            return False
        for entry in entries:
            if not isinstance(entry, dict):
                return False
            name, size, sha = entry.get("name"), entry.get("bytes"), entry.get("sha256")
            if not isinstance(name, str) or not isinstance(size, int) or not isinstance(sha, str):
                return False
            try:
                artifact = resolve_within(build_dir, name)
            except Exception:
                return False
            if not artifact.is_file() or artifact.stat().st_size != size:
                return False
            if hashlib.sha256(artifact.read_bytes()).hexdigest() != sha:
                return False
        return True

    def _atomic_text(self, path: Path, text: str) -> None:
        from populus.publish import atomic_write_bytes

        atomic_write_bytes(path, text.encode("utf-8"), mode=0o600)

    def _set_current(self, build_id: str) -> None:
        self._atomic_text(self._current_path, build_id + "\n")

    def _write_sidecar(
        self, build_id: str, version: int, sha: str, manifest_sha256: str
    ) -> None:
        # The advisory sidecar records the manifest digest too (F1), so offline
        # reconcile can bind the cached build dir to the authenticated manifest
        # without re-fetching. It stays advisory — cross-checked against the
        # two-field trust tuple before it is ever believed.
        self._atomic_text(
            self._sidecar_path,
            json.dumps(
                {
                    "build_id": build_id,
                    "pointer_version": version,
                    "pointer_sha256": sha,
                    "manifest_sha256": manifest_sha256,
                },
                indent=2,
                sort_keys=True,
            )
            + "\n",
        )

    # --- crash recovery (R24) ------------------------------------------------

    def reconcile(self) -> None:
        """Read-time healing: remove orphans, repair ``current`` offline.

        A crash between tuple-persist and ``current``-update is healed from
        the advisory sidecar — believed only when it cross-checks against the
        two-field tuple AND its build directory verifies completely. The
        online idempotent branch of :meth:`refresh` covers the
        sidecar-not-yet-written window.
        """
        for orphan in self._module_dir.glob(".tmp-*"):
            if orphan.is_dir():
                shutil.rmtree(orphan, ignore_errors=True)
            else:
                orphan.unlink(missing_ok=True)
        trust = self._load_trust()
        if trust is None:
            return
        version, sha = trust
        sidecar = self._read_sidecar()
        if (
            sidecar is not None
            and sidecar["pointer_version"] == version
            and sidecar["pointer_sha256"] == sha
            and self._build_complete(
                sidecar["build_id"], sidecar["manifest_sha256"]
            )
        ):
            if self.current_build() != sidecar["build_id"]:
                self._set_current(sidecar["build_id"])

    # --- refresh -------------------------------------------------------------

    def refresh(self) -> RefreshResult:
        """One protocol-conformant poll of ``latest.json``.

        Any failure at any step leaves the prior cache, tuple, sidecar, and
        ``current`` untouched — the last verified build keeps serving.
        """
        self.reconcile()
        serving = self.current_build()
        try:
            pointer_bytes = self._fetcher.fetch_path("latest.json")
        except FetchError as exc:
            return RefreshResult("refused", serving, None, f"pointer fetch failed: {exc}")
        trust = self._load_trust()
        decision = evaluate_pointer(
            pointer_bytes,
            now=self._now(),
            trust=trust,
            attestation=self._attestation,
        )
        if decision.status == "idempotent":
            # Online heal for the tuple-persisted/current-missing window: the
            # authenticated, universally valid pointer whose digest matches
            # the tuple names the build_id.
            build_id = decision.pointer["build_id"]
            version = decision.pointer["pointer_version"]
            manifest_sha = decision.pointer["manifest_sha256"]
            # Bind the pre-existing cache dir to the authenticated pointer's
            # manifest before healing `current` to it (F1).
            if serving != build_id and self._build_complete(build_id, manifest_sha):
                self._write_sidecar(
                    build_id, version, decision.pointer_sha256, manifest_sha
                )
                self._set_current(build_id)
                serving = build_id
            return RefreshResult(
                "idempotent", serving, version, "pointer unchanged; no state change"
            )
        if decision.status not in ("install", "bootstrap"):
            detail = "; ".join(decision.errors) or decision.status
            return RefreshResult(
                "refused",
                serving,
                None,
                f"pointer {decision.status}: {detail} — last verified build"
                " keeps serving",
            )
        return self._install(decision.pointer, decision.pointer_sha256, serving)

    def _install(
        self, pointer: dict, pointer_sha256: str, serving: str | None
    ) -> RefreshResult:
        build_id = pointer["build_id"]
        version = pointer["pointer_version"]
        try:
            manifest_bytes = self._fetcher.fetch_path(pointer["manifest_path"])
        except FetchError as exc:
            return RefreshResult("refused", serving, None, f"manifest fetch failed: {exc}")
        if hashlib.sha256(manifest_bytes).hexdigest() != pointer["manifest_sha256"]:
            return RefreshResult(
                "refused",
                serving,
                None,
                "manifest bytes do not hash to the pointer's manifest_sha256 —"
                " last verified build keeps serving",
            )
        verdict = self._attestation.verify("manifest.json", manifest_bytes)
        if not verdict.ok:
            return RefreshResult(
                "refused", serving, None, f"manifest attestation rejected: {verdict.detail}"
            )
        try:
            manifest = json.loads(manifest_bytes.decode("utf-8"))
        except (UnicodeDecodeError, ValueError) as exc:
            return RefreshResult("refused", serving, None, f"manifest unparseable: {exc}")
        manifest_errors = validate_manifest(manifest)
        if manifest_errors:
            return RefreshResult(
                "refused",
                serving,
                None,
                "manifest invalid: " + "; ".join(manifest_errors),
            )
        identity_error = pointer_manifest_identity_error(manifest, build_id)
        if identity_error is not None:
            return RefreshResult(
                "refused",
                serving,
                None,
                f"{identity_error} — last verified build keeps serving",
            )
        module = manifest["modules"].get(self._module)
        if module is None:
            return RefreshResult(
                "refused", serving, None, f"manifest has no module {self._module!r}"
            )

        # client_compat (R22): a PEP 440 specifier against our own version.
        compat = module["client_compat"]
        try:
            compatible = Version(self._client_version) in SpecifierSet(compat)
        except InvalidVersion:
            compatible = False
        if not compatible:
            return RefreshResult(
                "incompatible",
                serving,
                None,
                f"build {build_id} requires client_compat {compat!r} but this"
                f" client is version {self._client_version} — refusing the"
                " update and continuing to serve the last compatible cached"
                " build",
            )

        build_dir = self._safe_under(self._module, build_id)
        # Reuse a pre-existing cache dir ONLY if its manifest binds to the
        # freshly-authenticated pointer's manifest_sha256 (F1); otherwise treat
        # it as a cache miss and re-install the authenticated artifacts.
        if not self._build_complete(build_id, pointer["manifest_sha256"]):
            tmp_dir = self._safe_under(self._module, f".tmp-{build_id}")
            if tmp_dir.exists():
                shutil.rmtree(tmp_dir)
            tmp_dir.mkdir(mode=0o700)
            try:
                for entry in module["artifacts"]:
                    target = resolve_within(tmp_dir, entry["name"])
                    target.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
                    if entry.get("path") is not None:
                        data = self._fetcher.fetch_path(entry["path"])
                        target.write_bytes(data)
                    else:
                        self._fetcher.fetch_asset(entry["url"], target)
                    if (
                        target.stat().st_size != entry["bytes"]
                        or hashlib.sha256(target.read_bytes()).hexdigest()
                        != entry["sha256"]
                    ):
                        raise FetchError(
                            f"artifact {entry['name']} failed hash/size"
                            " verification"
                        )
                    if entry["name"].endswith(".db"):
                        check = sqlite3.connect(str(target))
                        try:
                            (integrity,) = check.execute(
                                "PRAGMA integrity_check"
                            ).fetchone()
                        finally:
                            check.close()
                        if integrity != "ok":
                            raise FetchError(
                                f"artifact {entry['name']} failed"
                                f" integrity_check: {integrity}"
                            )
                    os.chmod(target, 0o600)
                (tmp_dir / "manifest.json").write_bytes(manifest_bytes)
                os.chmod(tmp_dir / "manifest.json", 0o600)
                for directory in [tmp_dir, *tmp_dir.rglob("*")]:
                    if directory.is_dir():
                        os.chmod(directory, 0o700)
                if build_dir.exists():
                    shutil.rmtree(build_dir)  # unreferenced partial (never current)
                os.replace(tmp_dir, build_dir)
            except (FetchError, OSError, sqlite3.Error) as exc:
                # A hash-consistent but corrupt/non-SQLite database raises
                # sqlite3.DatabaseError from PRAGMA integrity_check above — it
                # must take the same controlled refusal path as a fetch/IO
                # failure (R8/R14/F4): tmp_dir removed, prior cache + trust
                # tuple untouched, last verified build keeps serving.
                shutil.rmtree(tmp_dir, ignore_errors=True)
                return RefreshResult(
                    "refused",
                    serving,
                    None,
                    f"install of {build_id} failed: {exc} — prior cache and"
                    " trust tuple untouched",
                )

        # Install boundaries, in order: artifacts renamed → tuple → sidecar →
        # current. reconcile()/the idempotent branch heal any crash between.
        persist_tuple(self._tuple_path, version, pointer_sha256)
        self._write_sidecar(build_id, version, pointer_sha256, pointer["manifest_sha256"])
        self._set_current(build_id)
        return RefreshResult(
            "installed", build_id, version, f"installed build {build_id}"
        )
