"""Deploy-side machinery for §12.1: freeze a tree, upload it, verify what served.

This package is deliberately split by trust boundary, not by convenience:

* ``snapshot`` — freezes the built site so the bytes that were hashed are the
  bytes that get uploaded (R4/R5/R6).
* ``cloudflare`` — the Pages API surface, pinned endpoint by endpoint.
* ``verify`` — what the deploy job checks about what it just published.
* ``upload`` — the real Cloudflare uploader and the verifier adapter, so the
  ordered sequence runs against production objects rather than fakes.
* ``orchestrator`` — the ordered sequence, in one testable place (R12).
* ``record`` — the signer body, which trusts none of the above (R13/R27).

Nothing here reaches the network at import time; every remote-facing class takes
an injected transport so the suite stays hermetic (``tests/conftest.py``).
"""

from __future__ import annotations

__all__ = ["SnapshotError", "UploadSnapshot", "freeze_tree"]

from populus.deploy.snapshot import SnapshotError, UploadSnapshot, freeze_tree
