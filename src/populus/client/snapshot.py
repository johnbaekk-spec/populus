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

import base64
import binascii
import errno
import fcntl
from contextlib import contextmanager

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
        # An unreadable file is a FETCH failure, not an escaping OSError: every
        # caller guards `FetchError` only, so a bare OSError here propagates out
        # of `refresh()` — which runs on every poll — and kills the whole server,
        # congress included (QA-VERIFY-N-a).
        try:
            if not target.is_file():
                raise FetchError(f"{relpath} does not exist in {self._data_repo}")
            return target.read_bytes()
        except OSError as exc:
            raise FetchError(f"cannot read {relpath} from {self._data_repo}: {exc}") from exc

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
    incompatible · refused · withdrawn; ``build_id`` is the build now being
    served (``None`` when nothing is). ``withdrawn`` means a VERIFIED manifest
    omitted this module — the M2 coverage gate withheld it — so nothing is
    served and no previously cached build is reused (QA-r6-F4)."""

    status: str
    build_id: str | None
    pointer_version: int | None
    message: str
    #: True only when a VERIFIED manifest was read, demonstrably omitted this
    #: module, AND the withdrawal committed. Consumers may not infer this from
    #: absence alone, so the fact travels on the result itself (QA-r3-F2).
    verified_omission: bool = False
    #: True when a verified manifest omitted the module but the withdrawal could
    #: NOT be committed, so the prior build is still being served. Distinct from
    #: `verified_omission` — nothing was withdrawn — but the caller must be able
    #: to say the served data is stale rather than report it as clean published
    #: data with no signal at all (QA-NIT-3).
    observed_omission: bool = False


#: errnos that mean "this filesystem cannot do flock at all" — as opposed to a
#: transient or permission problem, which must be reported as itself (QA-NIT-2).
_LOCKING_UNSUPPORTED = frozenset(
    code for code in (
        getattr(errno, name, None)
        for name in ("ENOTSUP", "EOPNOTSUPP", "ENOLCK", "EINVAL", "ENOSYS")
    )
    if code is not None
)


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
        self._record_path = self._safe_under(module, "serving.json")
        self._lock_path = self._safe_under(module, ".lock")
        # An UNSUPPORTED lock facility is persistent — no transition could ever
        # be serialized safely — so the module is disabled here, BEFORE any
        # cache state is consulted (spec §4.1). Contention is different: it is
        # transient and leaves serving to whatever `serving_build()` proves.
        self._disabled_reason: str | None = None
        try:
            with open(self._lock_path, "a+") as probe:
                fcntl.flock(probe.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
                fcntl.flock(probe.fileno(), fcntl.LOCK_UN)
        except OSError as exc:
            code = getattr(exc, "errno", None)
            if code in (errno.EWOULDBLOCK, errno.EAGAIN):
                pass                      # merely contended right now — fine
            elif code in _LOCKING_UNSUPPORTED:
                self._disabled_reason = (
                    "the cache filesystem does not support flock, so module"
                    f" state cannot be updated safely: {exc}"
                )
            else:
                # Some OTHER I/O problem — read-only cache, EACCES, a directory
                # where the lock file belongs, EMFILE. Still fail closed, but do
                # NOT blame flock support: that sends an operator chasing the
                # wrong cause (QA-NIT-2).
                self._disabled_reason = (
                    f"the module cache at {self._module_dir} cannot be locked"
                    f" ({errno.errorcode.get(code, code)}: {exc.strerror or exc}),"
                    " so module state cannot be updated safely"
                )
        self._tuple_path = self._safe_under(module, "trust.json")
        # `install.json` (sidecar), `withdrawn.json` (tombstone) and `current`
        # are RETIRED — see docs/build/RUN-M2-4-withdrawal-lifecycle.md §2. Every
        # QA finding in rounds 5-8 was cross-file inference between those
        # advisory markers; one anchor-validated record removes the category.

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

    def _read_record(self) -> dict | None:
        """The serving record, or ``None`` when absent, unreadable or malformed.

        Malformed is NOT "no restriction": under §1 of the lifecycle spec, an
        unparseable record proves nothing, so it yields absence of service.
        """
        try:
            raw = json.loads(self._record_path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return None
        if not (
            isinstance(raw, dict)
            and isinstance(raw.get("pointer_version"), int)
            and not isinstance(raw.get("pointer_version"), bool)
            and isinstance(raw.get("pointer_sha256"), str)
            and isinstance(raw.get("pointer_bytes"), str)
            and (raw.get("installed_build") is None
                 or isinstance(raw.get("installed_build"), str))
        ):
            return None
        return raw

    def serving_build(self) -> str | None:
        """The build this module may serve — the SOLE serving oracle (spec §3).

        Positive proof or nothing: the record must match the trust anchor on
        BOTH tuple fields, its embedded pointer bytes must hash to that anchor,
        and the build those AUTHENTICATED bytes name must verify on disk. Any
        gap — absent record, corrupt record, mismatched generation, equivocating
        digest, a record naming some other cached build, missing artifacts —
        yields ``None``.

        The pointer bytes are what make this proof rather than assertion: an
        earlier design took ``build_id``/``manifest_sha256`` from the record
        itself, so the record certified its own claim and a valid-shaped corrupt
        one could name a different complete build (spec rev-1 F2).
        """
        if self._disabled_reason is not None:
            # No transition on this cache could ever be serialized safely, so
            # the module cannot be kept correct — it serves nothing. Checked
            # HERE so there is exactly one oracle (spec §6); putting it only on
            # the accessors would create the second oracle rev-4 F2 warned of.
            return None
        try:
            trust = load_tuple(self._tuple_path)
        except TrustTupleError:
            return None                      # corrupt anchor: fail closed
        if trust is None:
            return None
        version, sha = trust
        rec = self._read_record()
        if rec is None:
            return None
        if rec["pointer_version"] != version or rec["pointer_sha256"] != sha:
            return None                      # stale, or equal-version equivocation
        try:
            pointer_bytes = base64.b64decode(rec["pointer_bytes"], validate=True)
        except (ValueError, binascii.Error):
            return None
        if hashlib.sha256(pointer_bytes).hexdigest() != sha:
            return None                      # bytes not bound to the anchor
        if rec["installed_build"] is None:
            return None                      # withdrawn
        try:
            pointer = json.loads(pointer_bytes.decode("utf-8"))
            build_id = pointer["build_id"]
            manifest_sha = pointer["manifest_sha256"]
        except (UnicodeDecodeError, ValueError, KeyError, TypeError):
            return None
        if rec["installed_build"] != build_id:
            return None                      # record names some other build
        if not isinstance(build_id, str) or not safe_artifact_name(build_id):
            return None
        if not self._build_complete(build_id, manifest_sha):
            return None                      # artifacts missing or corrupt
        return build_id

    def _write_record(
        self, pointer_bytes: bytes, version: int, sha: str, installed_build: str | None
    ) -> None:
        """Write the serving record atomically (spec §3)."""
        self._atomic_text(
            self._record_path,
            json.dumps(
                {
                    "pointer_version": version,
                    "pointer_sha256": sha,
                    "pointer_bytes": base64.b64encode(pointer_bytes).decode("ascii"),
                    "installed_build": installed_build,
                },
                indent=2,
                sort_keys=True,
            )
            + "\n",
        )

    @contextmanager
    def _module_lock(self):
        """Exclusive per-module lock over the whole read-modify-write (spec §4.1).

        Yields True when held. Contention yields False — the caller returns
        `refused` WITHOUT writing, and serving continues as whatever
        `serving_build()` still proves. An unsupported `flock` is a persistent
        condition and disables the module at construction, so it never reaches
        here. Released on every exit path, including exceptions.
        """
        handle = None
        try:
            try:
                handle = open(self._lock_path, "a+")  # noqa: SIM115 — closed below
            except OSError:
                # Cannot even open the lock file (read-only cache, EMFILE, a
                # directory in its place). Treat as contention: no transition
                # proceeds, nothing is written, and the error does not escape
                # refresh() (QA-BLOCKER-2).
                yield False
                return
            try:
                fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
            except OSError:
                yield False
                return
            try:
                yield True
            finally:
                fcntl.flock(handle.fileno(), fcntl.LOCK_UN)
        finally:
            if handle is not None:
                handle.close()


    def current_build(self) -> str | None:
        """The build the client is serving, or ``None``.

        Delegates to :meth:`serving_build`, the sole oracle (spec §6): serving
        is never decided from a marker file, a generation comparison, or the
        relationship between two advisory records — every such rule in QA rounds
        5-8 became a finding.
        """
        return self.serving_build()

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

    def current_manifest(self) -> dict | None:
        """The cached ``manifest.json`` for the build being served, or ``None``.

        Additive, read-only freshness accessor: the MCP server reads this
        module's manifest watermarks (§5.5) to surface freshness in health
        without a re-fetch. Any absent/malformed cache state yields ``None``
        rather than raising — a corruptible on-disk file is never trusted to be
        well-formed (mirrors :meth:`current_build`).
        """
        build_id = self.current_build()
        if build_id is None:
            return None
        try:
            manifest_file = self._safe_under(self._module, build_id, "manifest.json")
        except ValueError:
            return None
        if not manifest_file.is_file():
            return None
        try:
            manifest = json.loads(manifest_file.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return None
        return manifest if isinstance(manifest, dict) else None

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
            # An unreadable artifact is "not complete", never an escaping
            # error: this runs inside serving_build() AND refresh(), so an
            # EACCES/EIO here would take down every module (QA-BLOCKER-2).
            try:
                if not artifact.is_file() or artifact.stat().st_size != size:
                    return False
                if hashlib.sha256(artifact.read_bytes()).hexdigest() != sha:
                    return False
            except OSError:
                return False
        return True

    def _atomic_text(self, path: Path, text: str) -> None:
        from populus.publish import atomic_write_bytes

        atomic_write_bytes(path, text.encode("utf-8"), mode=0o600)

    # --- crash recovery (R24) ------------------------------------------------

    def reconcile(self) -> None:
        """Read-time cleanup of orphaned temp directories.

        Under the lifecycle spec (§3) there is nothing left to *heal* offline:
        serving is derived from the anchor-validated record, so a crash between
        the two transition writes already evaluates to absent and needs no
        repair to be safe. The online `idempotent` branch of :meth:`refresh`
        completes such a window when the authenticated pointer is seen again.

        Every failure here is swallowed: `refresh()` calls this on every poll,
        so an escaping ``OSError`` would take down the whole server rather than
        one module (QA-r6-F1).
        """
        try:
            for orphan in self._module_dir.glob(".tmp-*"):
                if orphan.is_dir():
                    shutil.rmtree(orphan, ignore_errors=True)
                else:
                    orphan.unlink(missing_ok=True)
        except OSError:
            pass

    # --- refresh -------------------------------------------------------------

    def refresh(self) -> RefreshResult:
        """One protocol-conformant poll of ``latest.json``.

        Serialized by the per-module lock (spec §4.1): the whole read-modify-
        write — trust load, pointer evaluation, both transition writes, any heal
        — happens under it, so a stale writer cannot interleave and roll the
        anchor backward. Contention is transient and yields `refused` WITHOUT a
        write; serving continues as whatever :meth:`serving_build` still proves.

        Any failure at any step leaves the prior cache, tuple and record
        untouched — the last verified build keeps serving.
        """
        if self._disabled_reason is not None:
            return RefreshResult(
                "refused", None, None,
                f"module {self._module!r} is disabled: {self._disabled_reason}",
            )
        with self._module_lock() as acquired:
            if not acquired:
                return RefreshResult(
                    "refused",
                    self.serving_build(),
                    None,
                    "another process holds this module's cache lock; no state"
                    " was changed and serving is unaffected",
                )
            return self._refresh_locked()

    def _refresh_locked(self) -> RefreshResult:
        self.reconcile()
        serving = self.serving_build()
        try:
            pointer_bytes = self._fetcher.fetch_path("latest.json")
        except FetchError as exc:
            return RefreshResult("refused", serving, None, f"pointer fetch failed: {exc}")
        # The EXACT verified bytes travel to the record — never a re-serialized
        # dict, which would not hash to the anchor (spec §3).
        self._last_pointer_bytes = pointer_bytes
        # A PRESENT-BUT-CORRUPT anchor must NOT be laundered into "no anchor".
        # `_load_trust` swallows TrustTupleError and returns None (TD-7 state
        # loss), which `evaluate_pointer` reads as bootstrap — so ANY unexpired
        # attested pointer is accepted, including one older than a committed
        # withdrawal, which then re-installs the coverage-gate-WITHHELD build and
        # stamps it `inst_from_published_manifest=True`. `serving_build()` fails
        # CLOSED on this same file, so routing it through `_load_trust` here made
        # the client read one anchor two contradictory ways, fail-open on the
        # write path. Absence of proof is absence of service (spec §1), and a
        # corrupt anchor is absence of proof.
        try:
            trust = load_tuple(self._tuple_path)
        except TrustTupleError as exc:
            return self._refuse_unanchored(f"present but corrupt ({exc})")
        if trust is None and self._has_local_state():
            # A DELETED anchor beside a surviving record is the same hazard
            # through a different door: no correct transition can produce
            # "record at generation N, no anchor", because the anchor is written
            # FIRST in both directions. So this is state loss or tampering, not
            # bootstrap — and treating it as bootstrap let a replayed
            # pre-withdrawal pointer reinstate a withheld build exactly as the
            # corrupt case did. Genuine bootstrap (NEITHER file) is untouched.
            return self._refuse_unanchored(
                "missing, but this module's cache still holds local state"
            )
        decision = evaluate_pointer(
            pointer_bytes,
            now=self._now(),
            trust=trust,
            attestation=self._attestation,
        )
        if decision.status == "idempotent":
            # The anchored pointer is unchanged. If we are already serving what
            # it implies there is nothing to do; otherwise COMPLETE the record it
            # implies — a write-2 window from either transition heals here
            # (spec §4). Which record depends on the manifest, so a pointer that
            # OMITS the module heals to a null record, never to a serving one.
            version = decision.pointer["pointer_version"]
            if serving is not None:
                return RefreshResult(
                    "idempotent", serving, version,
                    "pointer unchanged; no state change",
                )
            # Nothing is proven at this anchor — a write-2 window from either
            # transition. COMPLETE it through the ordinary install path, which
            # already fetches and verifies the manifest, writes the withdrawal
            # when the module is omitted, and short-circuits the artifact fetch
            # when the build is already complete. Reusing it keeps ONE verified
            # path instead of a parallel heal that can disagree with it — an
            # earlier draft read the manifest from the module's cache dir, which
            # a withdrawn module does not have, and so silently lost the
            # verified-omission fact.
            return self._install(decision.pointer, decision.pointer_sha256, None)
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

    def _has_local_state(self) -> bool:
        """Whether this module's cache holds state a genuine bootstrap wouldn't.

        A serving record OR any installed build directory both mean this cache
        has been used before, so `bootstrap` — which accepts any unexpired
        pointer with NO replay protection — is the wrong reading. Checking only
        the record left a hole: clearing just the state files (which the earlier
        refusal message actually RECOMMENDED), or losing both, left the build
        artifacts behind and let a stale pointer reinstate a withheld build
        (QA-VERIFY3-B2).
        """
        if self._record_path.exists():
            return True
        try:
            return any(
                child.is_dir() and not child.name.startswith(".")
                for child in self._module_dir.iterdir()
            )
        except OSError:
            return True          # cannot tell: fail closed

    def _refuse_unanchored(self, condition: str) -> RefreshResult:
        """Refuse to re-bootstrap when the anchor cannot be trusted.

        Without a valid anchor there is NO replay protection, so any unexpired
        attested pointer would be accepted — including one older than a
        committed withdrawal, which reinstates a build the current published
        manifest withholds and has the resolver stamp it as verified published
        data. Absence of proof is absence of service (spec §1).
        """
        return RefreshResult(
            "refused",
            None,
            None,
            f"the trust anchor at {self._tuple_path} is {condition}. Refusing to"
            " re-bootstrap from it: without a valid anchor there is no replay"
            " protection, so a stale pointer could reinstate a build the current"
            " published manifest withholds. To recover, FIRST confirm the data"
            " repository's latest.json is current — a pointer up to 7 days old"
            " is still accepted on a genuine bootstrap — and only then remove"
            f" the ENTIRE directory {self._module_dir} (including its cached"
            " build directories, not just the state files).",
        )

    def _pointer_bytes_for(self, pointer: dict, pointer_sha256: str) -> bytes | None:
        """The exact bytes whose digest is the anchor.

        Reuses the bytes already stored in the record when they still hash to
        the anchor; otherwise the fetched bytes are supplied by the caller via
        :attr:`_last_pointer_bytes`. Never re-serializes the pointer dict — a
        re-serialization would not hash to the anchor (spec §3).
        """
        raw = getattr(self, "_last_pointer_bytes", None)
        if raw is not None and hashlib.sha256(raw).hexdigest() == pointer_sha256:
            return raw
        rec = self._read_record()
        if rec is not None:
            try:
                stored = base64.b64decode(rec["pointer_bytes"], validate=True)
            except (ValueError, binascii.Error):
                return None
            if hashlib.sha256(stored).hexdigest() == pointer_sha256:
                return stored
        return None

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
            # The CURRENT, verified build does not carry this module — e.g.
            # `inst` withheld by the M2 >=95% coverage gate. Serving the
            # previously cached build would hand back STALE data while health
            # reported the module present, defeating the gate (QA-F1).
            #
            # TUPLE FIRST — it IS the commit (spec §4). Once it lands, the old
            # record no longer matches the anchor, so the module is immediately
            # absent, and any replay of a pre-commit pointer is a rollback and
            # is refused. The null record that follows only tidies; if it fails,
            # the withdrawal has still committed.
            try:
                persist_tuple(self._tuple_path, version, pointer_sha256)
            except OSError as exc:
                # Write 1 failed: nothing committed, prior state stands, the
                # next refresh retries. Report honestly rather than claim a
                # withdrawal that did not happen.
                return RefreshResult(
                    "refused", serving, None,
                    f"build {build_id} does not include module"
                    f" {self._module!r}, but the anchor could not be advanced"
                    f" ({exc}); the withdrawal did NOT commit, so the PREVIOUS"
                    " build keeps serving even though the current published"
                    " manifest omits this module — treat it as stale until a"
                    " later refresh commits the withdrawal",
                    observed_omission=True,
                )
            try:
                raw = self._pointer_bytes_for(pointer, pointer_sha256)
                if raw is not None:
                    self._write_record(raw, version, pointer_sha256, None)
            except OSError:
                pass  # committed already; the heal completes the record later
            return RefreshResult(
                "withdrawn",
                None,
                version,
                f"build {build_id} does not include module {self._module!r} —"
                " it is not published in the current build, so nothing is served"
                " for it (a previously cached build is NOT reused)",
                verified_omission=True,
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
            try:
                # INSIDE the guard (QA-BLOCKER-2): an unremovable orphan or a
                # full/read-only cache made these two lines raise straight out
                # of refresh(), which runs on every poll — so one module's I/O
                # failure killed the server and took congress with it. reconcile
                # now swallows the same rmtree, which meant the orphan survived
                # and detonated here instead.
                if tmp_dir.exists():
                    shutil.rmtree(tmp_dir)
                tmp_dir.mkdir(mode=0o700)
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

        # Install boundaries, in order: artifacts renamed → TUPLE (the commit)
        # → record (spec §4). Between the two the old record no longer matches
        # the advanced anchor, so the module reads absent — fail-closed — and
        # the `idempotent` heal completes it on the next poll.
        try:
            persist_tuple(self._tuple_path, version, pointer_sha256)
        except OSError as exc:
            return RefreshResult(
                "refused", serving, None,
                f"install of {build_id} failed at the anchor write: {exc} —"
                " prior cache and trust tuple untouched",
            )
        raw = self._pointer_bytes_for(pointer, pointer_sha256)
        if raw is None:
            return RefreshResult(
                "refused", None, version,
                f"install of {build_id} could not bind the verified pointer"
                " bytes to the anchor; nothing is served for this module",
            )
        try:
            self._write_record(raw, version, pointer_sha256, build_id)
        except OSError as exc:
            return RefreshResult(
                "refused", None, version,
                f"install of {build_id} committed the anchor but could not write"
                f" the serving record ({exc}); the module reads absent until the"
                " next poll completes it",
            )
        return RefreshResult(
            "installed", build_id, version, f"installed build {build_id}"
        )


class GitHubBundleFetcher:
    """Fetch attestation bundles from the public GitHub API.

    Unauthenticated lookups are capped at 60/hour per client address, so
    a token is strongly preferred in CI — without one a quota error is
    indistinguishable from "never attested" to any caller that only looks at
    ``ok``. That is why quota and transport failures raise
    :class:`FetchUnavailable` rather than returning an empty list.
    """

    def __init__(self, repo: str | None = None, token: str | None = None,
                 transport=None) -> None:
        from populus.publish.attestation import ATTESTATION_REPO

        self._repo = repo or ATTESTATION_REPO
        self._token = token
        self._transport = transport  # injected in tests; None uses the real network

    def fetch_bundles(self, digest_hex: str) -> list[dict]:
        import httpx

        url = f"https://api.github.com/repos/{self._repo}/attestations/sha256:{digest_hex}"
        headers = {"Accept": "application/vnd.github+json"}
        if self._token:
            headers["Authorization"] = f"Bearer {self._token}"
        try:
            client = httpx.Client(transport=self._transport, timeout=30.0)
            with client:
                response = client.get(url, headers=headers)
        except httpx.HTTPError as exc:
            raise _fetch_unavailable(f"transport error contacting {url}: {exc}") from exc

        if response.status_code == 404:
            return []  # a real answer: nothing was attested for this digest
        if response.status_code in (403, 429):
            raise _fetch_unavailable(
                f"rate limited or forbidden (HTTP {response.status_code}); "
                "unauthenticated attestation lookups are capped at 60/hour"
            )
        if response.status_code >= 400:
            raise _fetch_unavailable(f"HTTP {response.status_code} from {url}")
        # The API wraps each bundle: {"attestations":[{"bundle":{...}, ...}]}.
        # Returning the wrapper would hand `_verify_one` an object that is not a
        # Sigstore bundle and can never parse — unwrap to the bundle itself.
        payload = response.json() or {}
        bundles = []
        for entry in payload.get("attestations") or []:
            if isinstance(entry, dict) and isinstance(entry.get("bundle"), dict):
                bundles.append(entry["bundle"])
            elif isinstance(entry, dict):
                bundles.append(entry)
        return bundles


def github_bundle_fetcher(token: str | None = None) -> GitHubBundleFetcher:
    """The production bundle fetcher, reading GH_TOKEN if no token is passed."""
    import os

    return GitHubBundleFetcher(token=token or os.environ.get("GH_TOKEN"))


def _fetch_unavailable(message: str):
    from populus.publish.attestation import FetchUnavailable

    return FetchUnavailable(message)
