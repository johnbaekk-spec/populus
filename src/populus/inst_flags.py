"""RUN M2-8 T10 (plan R15) — the outsized-position flag.

Normative spec: ``docs/build/M2-8-outsized-position-spec.md``. That document was
written and reviewed BEFORE this module existed, and this module implements it
exactly; where the two disagree, the spec wins and this file is the defect.

What the flag claims, in full:

    "This position is a larger share of this filer's reported book than any single
     position it has reported in the last four quarters."

That is the ENTIRE claim. It is a comparison of a filer against its OWN prior
disclosures, computed from numbers the filer itself reported. It is not a claim
about skill, conviction, intent, quality, or expected return, and the surfaces that
render it must not say otherwise (the banned-wording list is enforced by the
dashboard gate, not here).

Three properties this module exists to guarantee:

1. **Integer exactness.** The predicate is written ``share * 100 > baseline * MULT``
   rather than ``share > baseline * MULT / 100``. For integer ``share`` the two are
   **equivalent** — an exhaustive check found zero divergences, and the spec's
   original claim that they differ was false (corrected 2026-08-05, found by a
   surviving mutation). The multiplication form is kept because it reads without
   reasoning about truncation and survives ``share`` ceasing to be an integer, not
   because the alternative is a bug.
2. **Eligibility before arithmetic.** A book with an incomplete denominator, or a
   baseline window that is short, gapped, or not fully admitted, yields
   ``awaiting_baseline`` — a NULL with an explicit state, never a flag and never a
   default. A filer new to the corpus is not "normal"; it is unmeasured.
3. **Annotation only.** Nothing may read this flag as an input — no filter, sort,
   rank, exclusion or gate. A persisted flag consumed by a decision path silently
   changes behaviour on any corpus that never ran the flag pass, which is the exact
   failure the M2-7 ``cover_conflict`` rule was written to prevent.

DEFERRAL, RECORDED (QA M2-8 M14)
--------------------------------
``classify_position`` has **no production call site**. No projection column
carries the flag, no surface renders it, and no MCP tool returns it — only the
constants are imported elsewhere. The classifier is complete and executed against
every row of the spec's truth table by ``tests/test_inst_flags.py``; what does not
exist is the wiring.

The deferral itself is defensible and was proposed by the spec: §7 asks whether to
ship the surfaces first and give the flag its own run, precisely because it is the
**only new claim** in a product whose credibility rests on making none. Shipping a
claim-bearing annotation in the same increment that first published the per-filer
substrate would mean the claim and the data it is computed from were reviewed
together, once.

What was NOT defensible is that nothing said so. R15 read "met" while the product
had no flag, and spec §1.2 ("every rendering carries the comparison in words, the
period pair, and the §5 ``data_note``") was vacuously satisfied because there is no
rendering — as are spec mutations 8 and 9, which cannot be performed against a
surface that does not exist. That is now stated here, in the module a reader
reaches first, rather than inferred from a grep returning nothing.

Wiring it is an owner decision, not a QA remediation: it adds a published claim.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum

__all__ = [
    "FLOOR_BPS",
    "MIN_BASELINE_PERIODS",
    "MULT",
    "FlagState",
    "PeriodBook",
    "baseline_max",
    "classify_position",
    "eligible",
    "max_share",
    "share_bps",
]

# --- OD-3, owner-locked 2026-08-02. Not developer defaults. ------------------
MIN_BASELINE_PERIODS = 4   # one year of the filer's own history
MULT = 150                 # 1.5x the filer's own prior maximum single-position share
FLOOR_BPS = 500            # 5% of the book, so tiny portfolios generate no noise


class FlagState(str, Enum):
    """The three outcomes. There is no fourth, and no implicit default."""

    OUTSIZED = "outsized"
    NOT_OUTSIZED = "not_outsized"
    AWAITING_BASELINE = "awaiting_baseline"


@dataclass(frozen=True)
class PeriodBook:
    """One filer-period's reported book, as the flag needs to see it.

    ``values`` is every retained position's ``value_usd`` for the period, with
    ``None`` preserved. The Nones are the point: a single undisclosed value makes
    the denominator incomplete, so they cannot be filtered out upstream.

    ``admitted`` is False when ingestion for this (filer, period) ended in
    ``failed:partial_lineage``, carried a ``failed``/``cover_failed`` filing, or was
    excluded by the M2-7 cover-conflict predicate. It is supplied by the caller
    because those dispositions live in the ingest journal and the filings table, not
    in the holdings themselves.
    """

    period: str
    values: tuple[int | None, ...]
    admitted: bool = True

    @property
    def total_value_usd(self) -> int:
        """Sum of the DISCLOSED values. Only meaningful when the book is complete —
        `has_undisclosed` must be checked first, which `eligible` does."""
        return sum(v for v in self.values if v is not None)

    @property
    def has_undisclosed(self) -> bool:
        return any(v is None for v in self.values)


def share_bps(value_usd: int, total_value_usd: int) -> int:
    """A position's share of the book, in basis points. Integer division.

    Caller must have established ``total_value_usd > 0``; this raises rather than
    returning a sentinel, because a fabricated 0 share is exactly the kind of
    plausible-looking number the NULL-honest rule exists to prevent.
    """
    if total_value_usd <= 0:
        raise ValueError("share_bps requires a positive denominator")
    return value_usd * 10_000 // total_value_usd


def max_share(book: PeriodBook) -> int | None:
    """The largest SINGLE position's share, or None when the book cannot support one.

    Note this is *not* ``topn_share_bps``, which is a combined top-N share — a
    different statistic entirely. A book of five 10% positions has a combined top-5
    share of 10,000 bps and a max single share of 1,000 bps.
    """
    if book.has_undisclosed:
        return None
    total = book.total_value_usd
    if total <= 0:
        return None
    disclosed = [v for v in book.values if v is not None]
    if not disclosed:
        return None
    return share_bps(max(disclosed), total)


def baseline_max(window: tuple[PeriodBook, ...]) -> int | None:
    """``MAX(max_share)`` over the baseline window, or None if any period fails.

    Returning None for *any* unusable period is deliberate: a baseline computed from
    a subset of the window is a smaller number, which lowers the bar and produces
    flags that the full window would not.
    """
    if len(window) != MIN_BASELINE_PERIODS:
        return None
    shares = []
    for book in window:
        if not book.admitted:
            return None
        share = max_share(book)
        if share is None:
            return None
        shares.append(share)
    return max(shares)


def _consecutive(periods: tuple[str, ...], sequence: tuple[str, ...]) -> bool:
    """True when `periods` is a contiguous run of `sequence`, in order.

    `sequence` is the published period sequence — the flag's notion of "immediately
    preceding" is positional within what was actually published, never calendar
    arithmetic, because a quarter the pipeline never ingested is a real gap.
    """
    if not periods:
        return False
    try:
        start = sequence.index(periods[0])
    except ValueError:
        return False
    return tuple(sequence[start:start + len(periods)]) == periods


def eligible(
    current: PeriodBook,
    window: tuple[PeriodBook, ...],
    published_sequence: tuple[str, ...],
) -> bool:
    """Every §3 condition. Any failure ⇒ `awaiting_baseline`, never a flag."""
    # §3.1 denominator completeness — current period
    if not current.admitted:
        return False
    if current.has_undisclosed:
        return False
    if current.total_value_usd <= 0:
        return False

    # §3.2 baseline completeness — exactly MIN_BASELINE_PERIODS, consecutive,
    # immediately preceding the current period, each fully admitted and complete.
    if len(window) != MIN_BASELINE_PERIODS:
        return False
    window_periods = tuple(b.period for b in window)
    if not _consecutive(window_periods + (current.period,), published_sequence):
        return False
    return baseline_max(window) is not None


def classify_position(
    value_usd: int | None,
    current: PeriodBook,
    window: tuple[PeriodBook, ...],
    published_sequence: tuple[str, ...],
) -> FlagState:
    """The flag for one position. Pure; no I/O, no clock, no database."""
    if not eligible(current, window, published_sequence):
        return FlagState.AWAITING_BASELINE
    if value_usd is None:
        # Unreachable when the book is eligible (an undisclosed value makes it
        # ineligible), but asserted rather than assumed.
        return FlagState.AWAITING_BASELINE

    base = baseline_max(window)
    assert base is not None  # guaranteed by eligible()
    share = share_bps(value_usd, current.total_value_usd)

    # Multiplication form: equivalent to the divided form for integer `share`
    # (verified exhaustively), but readable without truncation reasoning.
    if share * 100 > base * MULT and share >= FLOOR_BPS:
        return FlagState.OUTSIZED
    return FlagState.NOT_OUTSIZED
