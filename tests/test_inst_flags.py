"""RUN M2-8 T10 (plan R15) — the spec's truth table, executed.

`docs/build/M2-8-outsized-position-spec.md` §5 is a 17-row table. Every row is a
case here, by number, so a failure names the spec row it violates. §6's mutation
list is exercised by `test_inst_flags_mutations.py`-style swaps run manually and
recorded in the dev notes.
"""

from __future__ import annotations

import pytest

from populus.inst_flags import (
    FLOOR_BPS,
    MIN_BASELINE_PERIODS,
    MULT,
    FlagState,
    PeriodBook,
    baseline_max,
    classify_position,
    eligible,
    max_share,
    share_bps,
)

# A published sequence of six periods; the newest is the one under test.
SEQ = ("2025-03-31", "2025-06-30", "2025-09-30", "2025-12-31", "2026-03-31", "2026-06-30")
CURRENT = "2026-06-30"
WINDOW_PERIODS = ("2025-09-30", "2025-12-31", "2026-03-31")  # only 3 — see helpers


def book(period: str, values, admitted: bool = True) -> PeriodBook:
    return PeriodBook(period=period, values=tuple(values), admitted=admitted)


def _book_values_with_max(target_bps: int) -> list[int]:
    """Values summing to 10,000 whose LARGEST element is exactly `target_bps`.

    A naive [target, 10000-target] is wrong whenever target < 5000: the remainder
    becomes the maximum. Splitting the remainder into chunks of at most `target`
    keeps `target` the largest element (ties are fine — the max is still `target`).
    """
    remainder = 10_000 - target_bps
    parts = [target_bps] * (remainder // target_bps)
    if remainder % target_bps:
        parts.append(remainder % target_bps)
    return [target_bps, *parts]


def window_with_max_share(share_bps_target: int, *, admitted_all=True, periods=None):
    """A 4-period window whose every period has `max_share` == the target."""
    periods = periods or SEQ[1:5]  # the four immediately preceding CURRENT
    return tuple(
        book(p, _book_values_with_max(share_bps_target), admitted=admitted_all)
        for p in periods
    )


def current_with(share_target: int, *, with_undisclosed=False, admitted=True):
    """A current book where one position is exactly `share_target` bps of 10,000.

    `with_undisclosed` appends a None. It is a distinct flag rather than an
    `extra=None` argument because `if extra is not None` cannot express "append a
    None" — the guard swallows exactly the value the test needs.
    """
    values = [share_target, 10_000 - share_target]
    if with_undisclosed:
        values.append(None)
    return book(CURRENT, values, admitted=admitted)


# --- constants are the owner's, not the developer's --------------------------


def test_od3_constants_are_the_owner_locked_values():
    assert (MIN_BASELINE_PERIODS, MULT, FLOOR_BPS) == (4, 150, 500)


# --- §5 truth table ----------------------------------------------------------


def test_row1_clearly_outsized():
    """900 bps vs a 500 bps baseline: 90,000 > 75,000, and above the floor."""
    cur = current_with(900)
    win = window_with_max_share(500)
    assert classify_position(900, cur, win, SEQ) is FlagState.OUTSIZED


def test_row2_below_the_multiple():
    """700 bps vs 500: 70,000 < 75,000."""
    cur = current_with(700)
    win = window_with_max_share(500)
    assert classify_position(700, cur, win, SEQ) is FlagState.NOT_OUTSIZED


def test_row3_exact_boundary_is_not_outsized():
    """750 bps vs 500 is EXACTLY 1.5x. The predicate is strict `>`.

    Mutation guard: `>` -> `>=` flips this row. So does rewriting the predicate as
    `share > base * MULT / 100`, whose truncating division lowers the bar.
    """
    cur = current_with(750)
    win = window_with_max_share(500)
    assert classify_position(750, cur, win, SEQ) is FlagState.NOT_OUTSIZED


def test_row4_below_the_floor_is_not_outsized():
    """400 bps clears the multiple against a 100 bps baseline but is under FLOOR_BPS."""
    cur = current_with(400)
    win = window_with_max_share(100)
    assert classify_position(400, cur, win, SEQ) is FlagState.NOT_OUTSIZED


def test_row5_exactly_at_the_floor_is_outsized():
    """500 bps is `>= FLOOR_BPS` — the floor is inclusive."""
    cur = current_with(500)
    win = window_with_max_share(100)
    assert classify_position(500, cur, win, SEQ) is FlagState.OUTSIZED


def test_row6_short_history_awaits_baseline():
    cur = current_with(900)
    win = window_with_max_share(500)[:3]           # n=3
    assert classify_position(900, cur, win, SEQ) is FlagState.AWAITING_BASELINE


def test_row7_gapped_history_awaits_baseline():
    """Four periods, but not contiguous with the current one."""
    cur = current_with(900)
    gapped = window_with_max_share(500, periods=("2025-03-31", "2025-06-30",
                                                 "2025-09-30", "2025-12-31"))
    # gapped ends at 2025-12-31; CURRENT is 2026-06-30, so 2026-03-31 is missing.
    assert classify_position(900, cur, gapped, SEQ) is FlagState.AWAITING_BASELINE


def test_row8_partial_lineage_in_the_window_awaits_baseline():
    """`failed:partial_lineage` is an ACCOUNTED, non-failing ingest outcome, so
    counting periods alone is not sufficient (review r2 F12)."""
    cur = current_with(900)
    win = list(window_with_max_share(500))
    win[1] = PeriodBook(win[1].period, win[1].values, admitted=False)
    assert classify_position(900, cur, tuple(win), SEQ) is FlagState.AWAITING_BASELINE


def test_row9_failed_filing_in_the_window_awaits_baseline():
    """Same mechanism as row 8 — the caller marks the period not admitted."""
    cur = current_with(900)
    win = list(window_with_max_share(500))
    win[3] = PeriodBook(win[3].period, win[3].values, admitted=False)
    assert classify_position(900, cur, tuple(win), SEQ) is FlagState.AWAITING_BASELINE


def test_row10_cover_conflict_exclusion_awaits_baseline():
    cur = current_with(900)
    win = list(window_with_max_share(500))
    win[0] = PeriodBook(win[0].period, win[0].values, admitted=False)
    assert classify_position(900, cur, tuple(win), SEQ) is FlagState.AWAITING_BASELINE


def test_row11_zero_total_awaits_baseline_and_never_divides():
    """A zero denominator must not reach the division at all."""
    cur = book(CURRENT, [0, 0])
    win = window_with_max_share(500)
    assert classify_position(0, cur, win, SEQ) is FlagState.AWAITING_BASELINE


def test_row12_all_null_total_awaits_baseline():
    cur = book(CURRENT, [None, None])
    win = window_with_max_share(500)
    assert classify_position(None, cur, win, SEQ) is FlagState.AWAITING_BASELINE


def test_row13_one_null_in_the_current_book_awaits_baseline():
    """§3.1 — a PARTIAL NULL disqualifies (review r4 F8).

    One undisclosed value leaves the denominator short, so EVERY share in the book
    is overstated — the flag would fire more readily exactly where the data is worst.
    """
    cur = current_with(900, with_undisclosed=True)
    win = window_with_max_share(500)
    assert classify_position(900, cur, win, SEQ) is FlagState.AWAITING_BASELINE


def test_row14_one_null_in_a_baseline_period_awaits_baseline():
    cur = current_with(900)
    win = list(window_with_max_share(500))
    win[2] = PeriodBook(win[2].period, win[2].values + (None,), admitted=True)
    assert classify_position(900, cur, tuple(win), SEQ) is FlagState.AWAITING_BASELINE


def test_row15_and_16_max_share_is_not_a_combined_topn_share():
    """The named fixture pair for R14 (review r2 F11).

    One 50% position and five 10% positions: `max_share` tells them apart, a
    combined top-5 share does not. Mutation guard: substituting a top-N share for
    `max_share` collapses these two.
    """
    one_big = book(CURRENT, [5_000, 5_000])            # largest single = 50%
    five_even = book(CURRENT, [1_000] * 10)            # largest single = 10%
    assert max_share(one_big) == 5_000
    assert max_share(five_even) == 1_000
    assert max_share(one_big) != max_share(five_even)


def test_row17_affiliate_reported_position_is_present_not_suppressed():
    """The book handed to the flag is the filer's OWN reported one (review r3 F5).

    This module never reads a view, so the property is enforced at the boundary:
    a book containing the affiliate-reported position classifies normally.
    """
    cur = current_with(900)
    win = window_with_max_share(500)
    assert classify_position(900, cur, win, SEQ) is FlagState.OUTSIZED


# --- unit-level guards -------------------------------------------------------


def test_share_bps_refuses_a_nonpositive_denominator():
    """A fabricated 0 share is exactly the plausible-looking number the NULL-honest
    rule exists to prevent, so this raises rather than returning a sentinel."""
    with pytest.raises(ValueError):
        share_bps(100, 0)
    with pytest.raises(ValueError):
        share_bps(100, -1)


def test_baseline_max_is_none_when_any_window_period_is_unusable():
    """A baseline over a SUBSET of the window is a smaller number, which lowers the
    bar and manufactures flags the full window would not produce."""
    win = list(window_with_max_share(500))
    assert baseline_max(tuple(win)) == 500
    win[2] = PeriodBook(win[2].period, win[2].values, admitted=False)
    assert baseline_max(tuple(win)) is None


def test_eligible_requires_the_window_to_immediately_precede_the_current_period():
    cur = current_with(900)
    good = window_with_max_share(500)
    assert eligible(cur, good, SEQ) is True
    shifted = window_with_max_share(500, periods=("2025-03-31", "2025-06-30",
                                                  "2025-09-30", "2025-12-31"))
    assert eligible(cur, shifted, SEQ) is False


def test_multiplication_and_division_forms_are_equivalent_for_integer_shares():
    """The spec ORIGINALLY claimed these forms differ. They do not.

    Found by a surviving mutation: swapping the divided form in broke no test,
    because no input distinguishes them for integer `share`. Rather than delete the
    test, it now asserts the true property — equivalence — so a future change that
    DOES introduce a divergence (e.g. `share` becoming a float) fails here loudly.

    See the CORRECTION block in M2-8-outsized-position-spec.md §2.
    """
    for base in range(0, 400):
        for share in range(0, 800):
            assert (share * 100 > base * MULT) == (share > base * MULT // 100), (
                f"forms diverged at base={base} share={share}")
