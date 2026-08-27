"""§12.1 file inventory envelope v2: ``inventory.json`` + ``inventory_digest``.

The same enumeration as ``dist_digest``, published so every trust boundary can
tell *which* served file diverged. Serialization is RFC 8785 canonical JSON —
``inventory_digest`` is the SHA-256 of those exact canonical bytes, so the
render carries no trailing newline (the §12.1 envelope is the byte contract).
The inventory is written as a sibling OUTSIDE the tree it describes, so it
never inventories itself and is never deployed.

RUN PUBLIC-SECURITY-HARDENING R12/LD12/LD12b — inventory version "2", the
anti-downgrade contract. The exact canonical object is::

    {
      "inventory_version": "2",
      "dist_digest_version": "1",
      "dist_digest": "<sha256 of every uploaded regular file, v1 framing>",
      "files": [{"path": "...", "bytes": 0, "sha256": "<hex>"}],
      "controls": [{"path": "_headers", "kind": "cloudflare-pages-headers",
                    "bytes": 0, "sha256": "<hex>"}]
    }

Key sets are exact at every level. ``files`` and ``controls`` are each sorted
ascending bytewise by the UTF-8 of ``path``; paths are unique ACROSS both
arrays. A new build carries exactly one control: the regular root ``_headers``
with the exact kind above. ``dist_digest`` keeps its unchanged version-1
framing and covers every regular file — controls included — so full-tree byte
binding needs no second digest; ``inventory_digest`` (SHA-256 of the full
canonical document) binds the control identity.

:func:`validate_inventory_v2` is the ONE external trust boundary: it accepts an
untrusted mapping, raises :class:`InventoryError` before any I/O on any
exact-key/type/digest-syntax/path/order/uniqueness/control violation, and
returns immutable typed tuples. There is deliberately NO v1 parser, union, or
auto-detect anywhere in production code: a missing control is malformed, never
"probably v1". Pre-v2 signed records remain immutable archival bytes; rollback
compatibility is LD12a's observed prior-site contract, not inventory
reinterpretation.

Structural validation never claims to prove bytes it was not given: tree and
artifact entry points separately recompute each size/hash and the v1 dist
digest against real bytes.
"""

from __future__ import annotations

import hashlib
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path

from populus.canonical import canonical_json
from populus.publish import atomic_write_bytes
from populus.publish.digests import (
    DIST_DIGEST_VERSION,
    DigestError,
    _walk_regular,
    dist_digest,
    sha256_file,
)

#: The one inventory schema production code understands. Not a tuple of
#: accepted versions and never to become one (LD12: no union, no auto-detect).
INVENTORY_VERSION = "2"

#: The exact ``kind`` of the one provider control a new build carries.
CONTROL_KIND = "cloudflare-pages-headers"

#: Provider-control artifacts: Cloudflare consumes these as *configuration*
#: rather than serving them as assets, so no URL exists on which one could be
#: fetched back. They are inventoried under ``controls`` rather than ``files``
#: for that reason alone — ``dist_digest`` still covers them, so full-tree byte
#: binding is unchanged, and ``_require_copy_faithful`` proves ``files`` ∪
#: ``controls`` equals the copied tree. What iterates ``files`` ONLY is
#: anything that assumes a servable URL: the domain-serving sweep and the
#: served-file counts.
#:
#: Distinct from :data:`populus.deploy.verify.CONTROL_PATHS`, which is the
#: *probe* list — URLs asserted to 404, and a superset, because `_redirects`
#: and `_worker.js` are probed as must-be-absent though the build emits neither.
CONTROL_FILE_PATHS = frozenset({"_headers"})

_TOP_LEVEL_KEYS = frozenset(
    {"inventory_version", "dist_digest_version", "dist_digest", "files", "controls"}
)
_FILE_KEYS = frozenset({"path", "bytes", "sha256"})
_CONTROL_KEYS = frozenset({"path", "kind", "bytes", "sha256"})
_HEX = frozenset("0123456789abcdef")


class InventoryError(ValueError):
    """The document is not an exact inventory v2 — a refusal, never a verdict.

    Every external seam maps this into its own existing contract
    (``VerifyInputError``, ``RecordRefused``, ``DeployAborted``, …) so a
    malformed, partial, v1-shaped, or downgraded envelope fails before any
    network or signing operation.
    """


@dataclass(frozen=True)
class InventoryFile:
    """One served entry, already validated. Immutable by construction."""

    path: str
    bytes: int
    sha256: str

    def as_document(self) -> dict:
        return {"path": self.path, "bytes": self.bytes, "sha256": self.sha256}


@dataclass(frozen=True)
class InventoryControl:
    """One provider-control entry, already validated. Immutable by construction."""

    path: str
    kind: str
    bytes: int
    sha256: str

    def as_document(self) -> dict:
        return {
            "path": self.path,
            "kind": self.kind,
            "bytes": self.bytes,
            "sha256": self.sha256,
        }


@dataclass(frozen=True)
class ValidatedInventoryV2:
    """The typed result of :func:`validate_inventory_v2` — and nothing else.

    Only the validator constructs one in production code; holding this type is
    holding the proof that the full document passed exact validation. Internal
    consumers (``verify._sweep_entries``, ``record._confirm_domain``) accept
    the typed entries and never re-parse an inventory-shaped mapping.
    """

    inventory_version: str
    dist_digest_version: str
    dist_digest: str
    files: tuple[InventoryFile, ...]
    controls: tuple[InventoryControl, ...]

    def as_document(self) -> dict:
        """The exact canonical-equivalent mapping (for rendering/digesting)."""
        return {
            "inventory_version": self.inventory_version,
            "dist_digest_version": self.dist_digest_version,
            "dist_digest": self.dist_digest,
            "files": [entry.as_document() for entry in self.files],
            "controls": [entry.as_document() for entry in self.controls],
        }

    def controls_identity(self) -> list[dict]:
        """The exact canonical ``controls`` identity a signed record carries."""
        return [entry.as_document() for entry in self.controls]


def _require_path(path: object, *, where: str) -> str:
    if not isinstance(path, str) or not path:
        raise InventoryError(f"{where}: 'path' must be a non-empty string, got {path!r}")
    if path.startswith("/"):
        raise InventoryError(f"{where}: path {path!r} has a leading slash")
    if "\\" in path:
        raise InventoryError(f"{where}: path {path!r} carries a backslash separator")
    if any(ord(ch) < 0x20 or ord(ch) == 0x7F for ch in path):
        raise InventoryError(f"{where}: path {path!r} carries a control character")
    for segment in path.split("/"):
        if segment in ("", ".", ".."):
            raise InventoryError(
                f"{where}: path {path!r} has an empty, '.', or '..' segment"
            )
    return path


def _require_hex_digest(value: object, *, where: str, field_name: str) -> str:
    if (
        not isinstance(value, str)
        or len(value) != 64
        or not set(value) <= _HEX
    ):
        raise InventoryError(
            f"{where}: {field_name!r} must be lowercase 64-hex, got {value!r}"
        )
    return value


def _require_bytes(value: object, *, where: str) -> int:
    if not isinstance(value, int) or isinstance(value, bool) or value < 0:
        raise InventoryError(
            f"{where}: 'bytes' must be a non-boolean integer >= 0, got {value!r}"
        )
    return value


def _require_entries(raw: object, *, key: str) -> list[Mapping]:
    if not isinstance(raw, Sequence) or isinstance(raw, (str, bytes)):
        raise InventoryError(f"inventory {key!r} is not a list")
    entries: list[Mapping] = []
    for index, entry in enumerate(raw):
        if not isinstance(entry, Mapping):
            raise InventoryError(
                f"inventory {key}[{index}] is {type(entry).__name__}, not an object"
            )
        entries.append(entry)
    return entries


def _require_sorted_unique(paths: Sequence[str], *, key: str) -> None:
    encoded = [path.encode("utf-8") for path in paths]
    for previous, current in zip(encoded, encoded[1:]):
        if current == previous:
            raise InventoryError(f"inventory {key!r} lists {current.decode()!r} twice")
        if current < previous:
            raise InventoryError(
                f"inventory {key!r} is not UTF-8-bytewise path sorted: "
                f"{current.decode()!r} follows {previous.decode()!r}"
            )


def validate_inventory_v2(document: object) -> ValidatedInventoryV2:
    """Validate one untrusted mapping into the exact typed v2 envelope.

    Raises :class:`InventoryError` — before any I/O — on any violation of the
    LD12 contract: exact key sets at every level, string versions
    (``inventory_version == "2"``, ``dist_digest_version == "1"``), lowercase
    64-hex digests, normalized relative POSIX paths, non-boolean ``bytes >= 0``,
    per-array UTF-8-bytewise sort, cross-array path uniqueness, and exactly one
    control — the regular root ``_headers`` with kind
    :data:`CONTROL_KIND`. A v1-shaped document (no ``inventory_version``, a
    ``control_files`` key, a missing ``controls`` array) is malformed here,
    never reinterpreted.
    """
    if not isinstance(document, Mapping):
        raise InventoryError(
            f"inventory is not a mapping: {type(document).__name__}"
        )
    keys = frozenset(document.keys())
    if keys != _TOP_LEVEL_KEYS:
        missing = sorted(_TOP_LEVEL_KEYS - keys)
        extra = sorted(k if isinstance(k, str) else repr(k) for k in keys - _TOP_LEVEL_KEYS)
        raise InventoryError(
            "inventory top-level key set is not exact "
            f"(missing={missing}, unexpected={extra}); a document without "
            "'inventory_version'/'controls' is malformed, never v1"
        )
    version = document["inventory_version"]
    if version != INVENTORY_VERSION or not isinstance(version, str):
        raise InventoryError(
            f"inventory declares inventory_version {version!r}; production code "
            f"understands exactly {INVENTORY_VERSION!r} (no union, no auto-detect)"
        )
    dd_version = document["dist_digest_version"]
    if dd_version != DIST_DIGEST_VERSION or not isinstance(dd_version, str):
        raise InventoryError(
            f"inventory declares dist_digest_version {dd_version!r}; the fixed "
            f"framing is {DIST_DIGEST_VERSION!r}"
        )
    tree_digest = _require_hex_digest(
        document["dist_digest"], where="inventory", field_name="dist_digest"
    )

    files: list[InventoryFile] = []
    for index, entry in enumerate(_require_entries(document["files"], key="files")):
        where = f"files[{index}]"
        entry_keys = frozenset(entry.keys())
        if entry_keys != _FILE_KEYS:
            raise InventoryError(
                f"{where}: key set must be exactly {sorted(_FILE_KEYS)}, "
                f"got {sorted(str(k) for k in entry_keys)}"
            )
        files.append(
            InventoryFile(
                path=_require_path(entry["path"], where=where),
                bytes=_require_bytes(entry["bytes"], where=where),
                sha256=_require_hex_digest(
                    entry["sha256"], where=where, field_name="sha256"
                ),
            )
        )
    if not files:
        raise InventoryError("inventory lists no files; there is nothing to verify")

    controls: list[InventoryControl] = []
    for index, entry in enumerate(
        _require_entries(document["controls"], key="controls")
    ):
        where = f"controls[{index}]"
        entry_keys = frozenset(entry.keys())
        if entry_keys != _CONTROL_KEYS:
            raise InventoryError(
                f"{where}: key set must be exactly {sorted(_CONTROL_KEYS)}, "
                f"got {sorted(str(k) for k in entry_keys)}"
            )
        kind = entry["kind"]
        if not isinstance(kind, str) or not kind:
            raise InventoryError(f"{where}: 'kind' must be a non-empty string")
        controls.append(
            InventoryControl(
                path=_require_path(entry["path"], where=where),
                kind=kind,
                bytes=_require_bytes(entry["bytes"], where=where),
                sha256=_require_hex_digest(
                    entry["sha256"], where=where, field_name="sha256"
                ),
            )
        )

    _require_sorted_unique([entry.path for entry in files], key="files")
    _require_sorted_unique([entry.path for entry in controls], key="controls")
    overlap = {entry.path for entry in files} & {entry.path for entry in controls}
    if overlap:
        raise InventoryError(
            f"path(s) listed in both 'files' and 'controls': {sorted(overlap)}"
        )

    if len(controls) != 1:
        raise InventoryError(
            f"a new build carries exactly one control; this inventory carries "
            f"{len(controls)} ({[c.path for c in controls]!r}). A missing "
            "control is malformed, never 'probably v1'"
        )
    control = controls[0]
    if control.path != "_headers":
        raise InventoryError(
            f"the one control must be the root '_headers', got {control.path!r} "
            "(`_redirects`, `_worker.js` and Functions remain prohibited)"
        )
    if control.kind != CONTROL_KIND:
        raise InventoryError(
            f"control '_headers' declares kind {control.kind!r}; the exact kind "
            f"is {CONTROL_KIND!r}"
        )
    if any(entry.path in CONTROL_FILE_PATHS for entry in files):
        raise InventoryError(
            "'_headers' appears under 'files'; a provider control is not a "
            "served asset"
        )

    return ValidatedInventoryV2(
        inventory_version=INVENTORY_VERSION,
        dist_digest_version=DIST_DIGEST_VERSION,
        dist_digest=tree_digest,
        files=tuple(files),
        controls=tuple(controls),
    )


def build_inventory(tree: Path | str) -> dict:
    """The §12.1 inventory-v2 document for *tree* (regular files only).

    Served files land in ``files``; provider-control artifacts land in
    ``controls`` (see :data:`CONTROL_FILE_PATHS`) with the exact
    :data:`CONTROL_KIND`. Both are enumerated from the same walk, so a file is
    in exactly one of the two lists and the union is the whole tree. The result
    is self-validated through :func:`validate_inventory_v2` before it is
    returned: a producer must not be able to emit a document the consumers
    refuse — a tree without a root ``_headers`` raises here, at build time.
    """
    tree = Path(tree)
    files: list[dict] = []
    controls: list[dict] = []
    for relpath, path in _walk_regular(tree):
        if relpath in CONTROL_FILE_PATHS:
            controls.append(
                {
                    "path": relpath,
                    "kind": CONTROL_KIND,
                    "bytes": path.stat().st_size,
                    "sha256": sha256_file(path),
                }
            )
        else:
            files.append(
                {
                    "path": relpath,
                    "bytes": path.stat().st_size,
                    "sha256": sha256_file(path),
                }
            )
    document = {
        "inventory_version": INVENTORY_VERSION,
        "dist_digest_version": DIST_DIGEST_VERSION,
        "dist_digest": dist_digest(tree),
        "files": files,
        "controls": controls,
    }
    validate_inventory_v2(document)
    return document


def render_inventory(inventory: Mapping) -> bytes:
    """The exact RFC 8785 canonical bytes of *inventory*."""
    return canonical_json(inventory)


def inventory_digest(inventory: Mapping) -> str:
    """SHA-256 over the exact canonical bytes of *inventory*.

    Unchanged from v1 in mechanism: the digest is over the FULL canonical
    document, so it binds the ``controls`` identity without a second,
    unauthenticated "control digest" field.
    """
    return hashlib.sha256(render_inventory(inventory)).hexdigest()


def write_inventory(tree: Path | str, dest: Path | str) -> dict:
    """Build *tree*'s inventory and write it to *dest*; returns the document.

    Refuses a *dest* that resolves inside *tree* — the inventory must be a
    sibling outside the tree so it never inventories itself.
    """
    tree = Path(tree).resolve()
    dest = Path(dest)
    resolved_parent = dest.parent.resolve()
    if resolved_parent == tree or tree in resolved_parent.parents:
        raise DigestError(
            f"inventory destination {dest} is inside the tree it describes"
        )
    inventory = build_inventory(tree)
    atomic_write_bytes(dest, render_inventory(inventory))
    return inventory
