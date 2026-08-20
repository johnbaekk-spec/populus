"""§12.1 file inventory envelope: ``inventory.json`` + ``inventory_digest``.

The same enumeration as ``dist_digest``, published so every trust boundary can
tell *which* served file diverged. Serialization is RFC 8785 canonical JSON —
``inventory_digest`` is the SHA-256 of those exact canonical bytes, so the
render carries no trailing newline (the §12.1 envelope is the byte contract).
The inventory is written as a sibling OUTSIDE the tree it describes, so it
never inventories itself and is never deployed.
"""

from __future__ import annotations

import hashlib
from collections.abc import Mapping
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


#: Provider-control artifacts: Cloudflare consumes these as *configuration*
#: rather than serving them as assets, so no URL exists on which one could be
#: fetched back. They are inventoried separately from the served tree for that
#: reason alone — ``dist_digest`` still covers them, so full-tree byte binding
#: is unchanged, and ``_require_copy_faithful`` proves ``files`` ∪
#: ``control_files`` equals the copied tree. What iterates ``files`` ONLY is
#: anything that assumes a servable URL: the domain-serving sweep and
#: ``site_file_count``.
#:
#: Distinct from :data:`populus.deploy.verify.CONTROL_PATHS`, which is the
#: *probe* list — URLs asserted to 404, and a superset, because `_redirects`
#: and `_worker.js` are probed as must-be-absent though the build emits neither.
CONTROL_FILE_PATHS = frozenset({"_headers"})


def build_inventory(tree: Path | str) -> dict:
    """The §12.1 inventory document for *tree* (regular files only).

    Served files land in ``files``; provider-control artifacts land in
    ``control_files`` (see :data:`CONTROL_FILE_PATHS`). Both are enumerated
    from the same walk, so a file is in exactly one of the two lists and the
    union is the whole tree.
    """
    tree = Path(tree)
    files: list[dict] = []
    control_files: list[dict] = []
    for relpath, path in _walk_regular(tree):
        entry = {
            "path": relpath,
            "bytes": path.stat().st_size,
            "sha256": sha256_file(path),
        }
        if relpath in CONTROL_FILE_PATHS:
            control_files.append(entry)
        else:
            files.append(entry)
    return {
        "dist_digest_version": DIST_DIGEST_VERSION,
        "dist_digest": dist_digest(tree),
        "files": files,
        "control_files": control_files,
    }


def render_inventory(inventory: Mapping) -> bytes:
    """The exact RFC 8785 canonical bytes of *inventory*."""
    return canonical_json(inventory)


def inventory_digest(inventory: Mapping) -> str:
    """SHA-256 over the exact canonical bytes of *inventory*."""
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
