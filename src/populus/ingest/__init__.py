"""Ingest orchestration package (RUN 2+): the shared transport identity.

These symbols are the cross-chamber transport contract — the identifying
User-Agent (G6), the transport response shape, and the archive-path
containment proof — hoisted here so sibling ingest modules share one
identity without importing each other (a House import would drag the PDF
parsing chain into Senate runs, and vice versa).
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path

import populus

USER_AGENT = (
    f"PopulusBot/{populus.__version__} "
    "(+https://github.com/johnbaekk-spec/populus; contact: johnbaekk@gmail.com)"
)


@dataclass(frozen=True)
class TransportResponse:
    status_code: int
    headers: Mapping[str, str]
    content: bytes


class UnsafeArchivePathError(ValueError):
    """A raw-archive path would resolve outside its configured root."""


def archive_path(raw_root: Path, relpath: str) -> Path:
    """Join *relpath* under *raw_root*, proving containment after resolution.

    Belt-and-braces with each chamber's identifier validation at the index
    boundary: even if a future caller builds a relative path some other way,
    nothing can be written outside the configured archive root.
    """
    root = Path(raw_root).resolve()
    candidate = (root / relpath).resolve()
    if candidate != root and root not in candidate.parents:
        raise UnsafeArchivePathError(
            f"archive path {relpath!r} escapes the archive root {root}"
        )
    return candidate
