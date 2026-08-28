"""§5.5 artifact publication protocol.

Modules: ``digests`` (logical + dist digests), ``inventory`` (§12.1 envelope),
``manifest`` (build manifest + path grammar), ``pointer`` (latest.json + the
four-way state machine + the two-field trust tuple), ``attestation`` (the P2
sigstore seam; ``StagingNoop`` in P1), ``build`` (build assembly, release
backends, the single-journal recovery protocol, publish, verify).

Library code here never reads the wall clock — every current-time value is
injected by the CLI, scripts, or tests.
"""

from __future__ import annotations

import os
import tempfile
from pathlib import Path


def atomic_write_bytes(path: Path, data: bytes, *, mode: int | None = None) -> None:
    """Durably replace *path* with *data*: temp file + fsync + ``os.replace``.

    The temp file lives in the destination directory so the final rename never
    crosses filesystems. A crash at any point leaves either the old complete
    file or the new complete file, never a torn one.
    """
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_name = tempfile.mkstemp(dir=path.parent, prefix=".tmp-")
    try:
        with os.fdopen(fd, "wb") as handle:
            handle.write(data)
            handle.flush()
            os.fsync(handle.fileno())
        if mode is not None:
            os.chmod(tmp_name, mode)
        os.replace(tmp_name, path)
    except BaseException:
        try:
            os.unlink(tmp_name)
        except OSError:
            pass
        raise
