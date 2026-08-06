"""§12.1 R4: freeze the built tree so hashed bytes and uploaded bytes are one thing.

The threat is mundane, not exotic: the site build writes into ``dist/``, and
anything else on the runner that touches ``dist/`` between "we hashed it" and
"we uploaded it" makes the deployment record a statement about bytes that never
went live. A digest computed over a directory someone can still write to proves
nothing about what the uploader read.

The seven steps (R4), and which one carries the weight:

1. Enumerate the source, recording ``(path, size, mtime_ns, inode)``.
2. Create a fresh private destination (``mkdtemp``, ``0700``) on the same
   filesystem as the source.
3. **One-pass copy-and-hash** — each source file is read exactly once, and the
   hash is computed from the bytes as they are written. There is no second read
   to disagree with the first.
4. Re-enumerate the source and require the identity set unchanged. This is a
   **detector of an unstable source**, not the binding — see below.
5. Seal the destination (``0400`` files, ``0500`` directories). Advisory only:
   the process owner, and root, can still write. Sealing raises the cost of an
   accident; it does not stop an attacker who already runs as us.
6. Compute ``dist_digest`` and the inventory **from the destination**.
7. Hand the uploader the sealed path and nothing else.

**The binding is (6) + (7), not (4).** Steps 6 and 7 read the same private tree,
so "uploaded bytes ≡ hashed bytes" holds *regardless of what the source does
afterwards* — even if step 4's comparison were removed entirely. Step 4 exists
to make an unstable source loud rather than silent: it turns "the build wrote
into dist/ while we copied" from a mystery into a named error. Deleting it
would lose a diagnostic, not the guarantee. Keep that distinction if this code
is ever refactored — an earlier revision of the plan had the guarantee resting
on the re-enumeration, which would have been wrong.

Symlinks, devices and FIFOs fail hard, inherited from ``_walk_regular``: §12.1
says a static tree has none, and a symlink is exactly how a copy would read
different bytes than an enumeration.
"""

from __future__ import annotations

import hashlib
import os
import shutil
import stat
import tempfile
from dataclasses import dataclass
from pathlib import Path

from populus.publish.digests import DigestError, _walk_regular, dist_digest
from populus.publish.inventory import build_inventory

# Read size for the one-pass copy. Large enough that syscall overhead is not the
# bottleneck on a few thousand small files; small enough not to hold a whole
# asset in memory.
_CHUNK = 1024 * 1024

_FILE_MODE = 0o400
_DIR_MODE = 0o500
_PRIVATE_DIR_MODE = 0o700


class SnapshotError(RuntimeError):
    """The source tree changed under us, or could not be frozen."""


@dataclass(frozen=True)
class _Identity:
    """What we record about a source file to notice it being replaced.

    ``inode`` catches the atomic-rename case that ``(size, mtime_ns)`` misses:
    a writer that replaces a file with a same-sized copy at the same timestamp
    still lands on a new inode.
    """

    size: int
    mtime_ns: int
    inode: int


@dataclass(frozen=True)
class UploadSnapshot:
    """A sealed, private copy of a built tree, plus what it hashes to.

    ``path`` is the only thing an uploader should ever be given. ``inventory``
    is the §12.1 envelope computed over that same path, so ``dist_digest`` here
    and the digest a verifier recomputes from the served tree are comparable
    without a second enumeration of the original ``dist/``.
    """

    path: Path
    dist_digest: str
    inventory: dict
    file_count: int

    def cleanup(self) -> None:
        """Remove the sealed copy. Safe to call twice.

        The seal (``0500`` directories) blocks unlink of the contents, so the
        modes come back off before the tree is removed. This is why sealing is
        documented as advisory: we can undo it ourselves.
        """
        if not self.path.exists():
            return
        for root, dirs, files in os.walk(self.path, topdown=False):
            root_path = Path(root)
            for name in files:
                _chmod_quietly(root_path / name, stat.S_IWUSR | stat.S_IRUSR)
            for name in dirs:
                _chmod_quietly(root_path / name, _PRIVATE_DIR_MODE)
        _chmod_quietly(self.path, _PRIVATE_DIR_MODE)
        shutil.rmtree(self.path, ignore_errors=True)


def _chmod_quietly(path: Path, mode: int) -> None:
    try:
        path.chmod(mode)
    except OSError:
        # Best-effort: a mode we cannot restore is not a reason to abort a
        # cleanup that is already on the failure path.
        pass


def _identities(tree: Path) -> dict[str, _Identity]:
    """Identity of every regular file under *tree*, keyed by relative path."""
    out: dict[str, _Identity] = {}
    for relpath, path in _walk_regular(tree):
        info = path.stat()
        out[relpath] = _Identity(
            size=info.st_size, mtime_ns=info.st_mtime_ns, inode=info.st_ino
        )
    return out


def _copy_one(src: Path, dest: Path) -> tuple[int, str]:
    """Copy *src* to *dest* reading once; return ``(bytes written, sha256)``.

    The digest is taken from the buffer that is written, so there is no window
    in which the hashed bytes and the stored bytes could differ.
    """
    digest = hashlib.sha256()
    written = 0
    dest.parent.mkdir(parents=True, exist_ok=True)
    with open(src, "rb") as reader, open(dest, "wb") as writer:
        while True:
            chunk = reader.read(_CHUNK)
            if not chunk:
                break
            digest.update(chunk)
            writer.write(chunk)
            written += len(chunk)
    return written, digest.hexdigest()


def _seal(tree: Path) -> None:
    """Make *tree* read-only, deepest entries first."""
    for root, dirs, files in os.walk(tree, topdown=False):
        root_path = Path(root)
        for name in files:
            (root_path / name).chmod(_FILE_MODE)
        for name in dirs:
            (root_path / name).chmod(_DIR_MODE)
    tree.chmod(_DIR_MODE)


def freeze_tree(source: Path | str, *, parent: Path | str | None = None) -> UploadSnapshot:
    """Freeze *source* into a sealed private copy and describe it.

    *parent* is where the private copy is created; it defaults to *source*'s
    parent so the copy lands on the same filesystem (a cross-device copy is
    still correct here — nothing is renamed — but staying local keeps the copy
    cheap and avoids filling an unrelated volume).

    Raises ``SnapshotError`` if the source changed while being copied, and
    ``DigestError`` (from ``_walk_regular``) if it contains anything that is not
    a regular file.
    """
    source = Path(source)
    if not source.is_dir():
        raise DigestError(f"not a directory: {source}")

    # (1) enumerate before touching anything
    before = _identities(source)

    # (2) fresh private destination
    parent_dir = Path(parent) if parent is not None else source.parent
    parent_dir.mkdir(parents=True, exist_ok=True)
    dest = Path(tempfile.mkdtemp(prefix=".populus-upload-", dir=parent_dir))
    dest.chmod(_PRIVATE_DIR_MODE)

    snapshot: UploadSnapshot | None = None
    try:
        # (3) one-pass copy-and-hash
        copied: dict[str, tuple[int, str]] = {}
        for relpath, path in _walk_regular(source):
            copied[relpath] = _copy_one(path, dest / relpath)

        # (4) detector: did the source move under us?
        after = _identities(source)
        _require_stable(before, after, copied)

        # (5) seal — advisory
        _seal(dest)

        # (6) digest and inventory FROM THE DESTINATION
        inventory = build_inventory(dest)
        snapshot = UploadSnapshot(
            path=dest,
            dist_digest=dist_digest(dest),
            inventory=inventory,
            file_count=len(inventory["files"]),
        )
    except BaseException:
        # A half-frozen tree must never reach an uploader (7).
        UploadSnapshot(path=dest, dist_digest="", inventory={}, file_count=0).cleanup()
        raise

    # Cross-check: the one-pass hashes must equal what the destination hashes to.
    # These are computed from different reads of different files, so a mismatch
    # means the copy itself is untrustworthy, not that the source moved.
    _require_copy_faithful(copied, snapshot)
    return snapshot


def _require_stable(
    before: dict[str, _Identity],
    after: dict[str, _Identity],
    copied: dict[str, tuple[int, str]],
) -> None:
    """Fail loudly if the source was written to during the copy."""
    if before.keys() != after.keys():
        added = sorted(after.keys() - before.keys())
        removed = sorted(before.keys() - after.keys())
        raise SnapshotError(
            "source tree changed while being frozen: "
            f"added={added[:5]} removed={removed[:5]}"
        )
    drifted = sorted(path for path in before if before[path] != after[path])
    if drifted:
        raise SnapshotError(
            f"source files mutated while being frozen: {drifted[:5]}"
        )
    # A file whose size changed between enumeration and copy would already have
    # tripped the identity check, but the copy is the authority on what we hold.
    mismatched = sorted(
        path
        for path, identity in before.items()
        if path in copied and copied[path][0] != identity.size
    )
    if mismatched:
        raise SnapshotError(
            f"copied byte counts disagree with the enumeration: {mismatched[:5]}"
        )


def _require_copy_faithful(
    copied: dict[str, tuple[int, str]], snapshot: UploadSnapshot
) -> None:
    """The copy's own hashes must agree with the sealed tree's inventory."""
    inventoried = {entry["path"]: entry["sha256"] for entry in snapshot.inventory["files"]}
    if inventoried.keys() != copied.keys():
        raise SnapshotError(
            "sealed tree does not contain exactly the copied files: "
            f"{sorted(inventoried.keys() ^ copied.keys())[:5]}"
        )
    divergent = sorted(
        path for path, (_, digest) in copied.items() if inventoried[path] != digest
    )
    if divergent:
        raise SnapshotError(f"copied bytes do not match the sealed tree: {divergent[:5]}")
