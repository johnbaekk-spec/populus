"""Ingest orchestration package: the shared transport identity.

These symbols are the cross-chamber transport contract — the identifying
User-Agent (G6), the transport response shape, and the archive-path
containment proof — hoisted here so sibling ingest modules share one
identity without importing each other (a House import would drag the PDF
parsing chain into Senate runs, and vice versa).
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass, field
from pathlib import Path

import populus
from populus.operator_identity import filings_user_agent, operator_contact


def user_agent() -> str:
    """The parenthesized filings User-Agent, resolved at CALL time (D9).

    ``POPULUS_CONTACT`` set after import affects every later request — the
    identity was previously frozen into a module constant at import.
    """
    return filings_user_agent(operator_contact()[0], populus.__version__)


@dataclass(frozen=True)
class TransportResponse:
    status_code: int
    headers: Mapping[str, str]
    content: bytes


@dataclass(frozen=True)
class FetchMetrics:
    """What one polite fetcher actually did.

    Part of the shared transport contract for the same reason
    :class:`TransportResponse` is: both chambers' fetchers report it, and the
    operational record (request counts, retries, status mix, backoff seconds)
    must mean the same thing in both summaries so Phase B sizing can be
    re-derived from measurement instead of a planning prior.

    ``attempts`` counts every request that left the process, retries included;
    ``retries`` counts only the 429/5xx answers that actually triggered a
    backoff. Politeness spacing is not backoff and is not in
    ``backoff_sleep_s``.
    """

    attempts: int = 0
    retries: int = 0
    backoff_sleep_s: float = 0.0
    status_counts: Mapping[int, int] = field(default_factory=dict)

    def format_line(self, label: str, *, elapsed_s: float | None) -> str:
        """The one-line operational record both ``format_summary``s print."""
        mix = (
            ", ".join(
                f"{status}:{count}" for status, count in sorted(self.status_counts.items())
            )
            or "none"
        )
        elapsed = "n/a (cache mode)" if elapsed_s is None else f"{elapsed_s:.1f}s"
        return (
            f"{label} transport: attempts {self.attempts}"
            f" | retries {self.retries}"
            f" | status mix {mix}"
            f" | backoff_sleep_s {self.backoff_sleep_s:.1f}"
            f" | elapsed {elapsed}"
        )


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
