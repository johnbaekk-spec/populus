"""The Form 13F filing deadline, with the Exchange Act Rule 0-3 roll.

A Form 13F report is due 45 days after the end of the calendar quarter, and
Exchange Act Rule 0-3(a) (17 CFR 240.0-3(a)) moves a deadline that falls on a
weekend or holiday: "if the last day on which papers can be accepted as timely
filed falls on a Saturday, Sunday or holiday, such papers may be filed on the
first business day following." The SEC's Form 13F FAQ applies it to 13F: "When
the filing deadline falls on a Saturday, Sunday or a holiday, then your filing
is due on the first business day thereafter."

The holidays are the eleven legal public holidays of 5 U.S.C. 6103(a), on the
day the federal government observes them: a holiday on a Saturday is observed
the Friday before (5 U.S.C. 6103(b)(1)); one on a Sunday, the Monday after
(Executive Order 11582, section 3(a)). New Year's Day on a Saturday is therefore
observed on 31 December of the year before. Juneteenth is a holiday from 2021
(Pub. L. 117-17) and the Martin Luther King, Jr. holiday from 1986.

Not modelled: a one-off closure by executive order (a national day of
mourning, a Christmas Eve closure) and Inauguration Day (5 U.S.C. 6103(c),
Washington-area only; 20 January is nowhere near a 13F deadline). Either could
move a real deadline by a day that this function does not know about.

ONE rule in two runtimes: `dashboard/src/lib/inst-adds.ts`
(`filingDeadline`, `rule03Roll`) implements the same calendar, and both read the
shared fixture `tests/fixtures/refinement/filing_deadline_cases.json`.
"""

from __future__ import annotations

import datetime as _dt
from functools import lru_cache

#: A 13F is due this many days after quarter end, before the Rule 0-3 roll.
FILING_DEADLINE_DAYS = 45


def _nth_weekday(year: int, month: int, weekday: int, n: int) -> _dt.date:
    """The n-th `weekday` (Monday = 0) of the month; n = -1 is the last."""
    if n > 0:
        first = _dt.date(year, month, 1)
        return first + _dt.timedelta(days=(weekday - first.weekday()) % 7 + 7 * (n - 1))
    nxt = _dt.date(year + (month == 12), month % 12 + 1, 1)
    last = nxt - _dt.timedelta(days=1)
    return last - _dt.timedelta(days=(last.weekday() - weekday) % 7)


def _observed(day: _dt.date) -> _dt.date:
    """The day a fixed-date holiday is observed: Saturday → the Friday before,
    Sunday → the Monday after."""
    if day.weekday() == 5:
        return day - _dt.timedelta(days=1)
    if day.weekday() == 6:
        return day + _dt.timedelta(days=1)
    return day


@lru_cache(maxsize=64)
def federal_holidays(year: int) -> frozenset[_dt.date]:
    """The observed dates of the legal public holidays OF `year` (5 U.S.C.
    6103(a)). An observed date may fall in the year before (New Year's Day on
    a Saturday)."""
    fixed = [(1, 1), (7, 4), (11, 11), (12, 25)]
    if year >= 2021:
        fixed.append((6, 19))
    days = {_observed(_dt.date(year, m, d)) for m, d in fixed}
    if year >= 1986:
        days.add(_nth_weekday(year, 1, 0, 3))  # Martin Luther King, Jr.
    days.add(_nth_weekday(year, 2, 0, 3))  # Washington's Birthday
    days.add(_nth_weekday(year, 5, 0, -1))  # Memorial Day
    days.add(_nth_weekday(year, 9, 0, 1))  # Labor Day
    days.add(_nth_weekday(year, 10, 0, 2))  # Columbus Day
    days.add(_nth_weekday(year, 11, 3, 4))  # Thanksgiving Day
    return frozenset(days)


def is_business_day(day: _dt.date) -> bool:
    """Neither a Saturday, a Sunday nor an observed federal holiday."""
    if day.weekday() >= 5:
        return False
    return day not in federal_holidays(day.year) and day not in federal_holidays(day.year + 1)


def rule_0_3_roll(day: _dt.date) -> _dt.date:
    """`day` itself when it is a business day, else the first business day
    following (Rule 0-3(a))."""
    while not is_business_day(day):
        day += _dt.timedelta(days=1)
    return day


def filing_deadline(period_end: str) -> str:
    """The last timely filing day of the 13F for the quarter ending
    `period_end` (ISO date): 45 days after it, rolled by Rule 0-3."""
    end = _dt.date.fromisoformat(period_end[:10])
    return rule_0_3_roll(end + _dt.timedelta(days=FILING_DEADLINE_DAYS)).isoformat()
