"""Per-era parse gate and member-join coverage (ARCHITECTURE.md §5.2).

The ≥97% e-file parse gate originally measured on one corpus ("≥97% of e-filed
**rows** parsed clean"; ``STATUS.md`` line 39: 97.5% on the real 312-PTR 2026
corpus) was never encoded anywhere — ``format_summary``
computed a rate and printed it, and nothing compared it to a threshold. A
historical backfill needs it per ``(chamber, year)``, derived from the persisted
corpus rather than from one run's ephemeral report, so an era measured across
several sessions still has one answer.

**Two independent censuses per era, and only one of them carries a threshold.**

1. The **e-file filing census** — filings with ``source != 'kadoa'`` and
   ``parse_status != 'needs_ocr'`` — split into *measurable* (the document's
   expected row count is known) and *unmeasurable* (it is not: ``failed``, or
   ``row_count`` NULL or 0). This census has no threshold. It answers a prior
   question: is the row denominator knowable at all?

2. The **e-file row census** — clean rows over total rows, "clean" via
   :func:`populus.normalize.has_parse_defect`, the single source of truth for
   the flag taxonomy (never re-implemented in SQL). Threshold **0.97**,
   unchanged from the 2026 baseline so historical eras are measured on the same
   ruler. It counts rows over **exactly** the measurable population census 1
   defines — a failed filing, or one whose ``row_count`` is NULL/0, may still
   hold stored transactions, and those rows lie outside the declared
   denominator, so they contribute nothing to the floor. The two censuses are
   held consistent by construction (census 2 draws its era keys from census 1's
   measurable set) and the consistency is asserted before any rate is derived.

**An unknown denominator is never a pass** (LD10). If an era holds even one
unmeasurable e-file filing its row gate is ``unmeasurable`` — non-passing and
surfaced — because one unmeasured document can hold disproportionately many
transactions, so no percentage of *filings* can bound true *row* coverage. A row
rate is still computed and printed over the measurable subset, explicitly
labelled a floor over a partial denominator; it is evidence, never the verdict.
The only n/a status is ``no_efile_filings``, and it is provable: the filing
census is exactly zero.

Surfacing is "surface, don't decide": a ``miss`` or ``unmeasurable`` era emits
an explicit OWNER DECISION REQUIRED report naming the era and the three
options. Eras are severity-ranked so a one-filing unknown and an era-wide
blackout read differently — ranking is presentation only and never suppresses,
downgrades, or hides an era.

Pure over one database connection: no clock, no network, no writes.
"""

from __future__ import annotations

import json
import sqlite3
from dataclasses import dataclass

from populus.normalize import has_parse_defect

GATE_THRESHOLD = 0.97

# The three options the owner chooses between when an era does not pass; quoted
# verbatim from the original decision record so the tooling never paraphrases it.
GATE_OPTIONS = (
    "(a) era-scoped gates published honestly per year in stats.json",
    "(b) a parser extension for the older template era, then"
    " `populus reparse congress-house --parser-version <old>` (archive-only,"
    " no refetch)",
    "(c) accepting a higher needs_ocr share as counted-not-parsed",
)


class ParseGateConsistencyError(RuntimeError):
    """The two censuses disagree about the measurable population.

    A hard stop rather than a warning: the printed row rate is only meaningful
    as a floor over the denominator the filing census declared, so a row counted
    outside that population silently corrupts the floor, the severity ordering,
    the published stats figures, and the evidence the owner decision rests on.
    Unreachable by construction — the row census draws its era keys from the
    filing census's measurable set — and asserted anyway.
    """


@dataclass(frozen=True)
class EraParseCoverage:
    """One ``(chamber, year)`` era's two censuses and its gate verdict."""

    chamber: str
    year: str
    efile_filings: int
    measurable_efile_filings: int
    unmeasurable_efile_filings: int
    # A severity figure, NOT a gate threshold: it ranks surfaced eras and is
    # printed on every era line. Nothing passes because of it.
    efile_filing_measurable_rate: float | None
    efile_rows: int
    clean_efile_rows: int
    efile_parse_rate: float | None
    # False ⇒ efile_parse_rate is a FLOOR over a partial denominator.
    row_denominator_known: bool
    needs_ocr_filings: int
    status: str  # 'pass' | 'miss' | 'unmeasurable' | 'no_efile_filings'
    meets_gate: bool
    severity: float

    @property
    def unmeasurable_share(self) -> float | None:
        if self.efile_filings == 0:
            return None
        return self.unmeasurable_efile_filings / self.efile_filings

    def format_line(self, *, threshold: float = GATE_THRESHOLD) -> str:
        if self.efile_parse_rate is None:
            rate = "n/a"
        else:
            label = "floor" if not self.row_denominator_known else "rate"
            rate = f"{100.0 * self.efile_parse_rate:.1f}% ({label})"
        return (
            f"{self.chamber} {self.year}"
            f" | e-file rows {self.clean_efile_rows}/{self.efile_rows} = {rate}"
            f" vs gate {100.0 * threshold:.0f}%"
            f" | e-file filings {self.efile_filings}"
            f" (measurable {self.measurable_efile_filings},"
            f" unmeasurable {self.unmeasurable_efile_filings})"
            f" | needs_ocr {self.needs_ocr_filings}"
            f" | status {self.status}"
        )


@dataclass(frozen=True)
class EraJoinCoverage:
    """One ``(chamber, year)`` era's member-join coverage, primary sources only.

    ``stats.json`` publishes an aggregate primary join rate over the whole
    corpus, which lets a large modern corpus mask an era of unresolved
    historical filers. This is the same measurement, per era, so the masking is
    structurally impossible.
    """

    chamber: str
    year: str
    filings: int
    filings_joined: int
    filings_unjoined: int
    rows: int
    rows_joined: int
    join_rate: float | None
    unresolved_filers: tuple[str, ...]

    def format_line(self) -> str:
        rate = "n/a" if self.join_rate is None else f"{100.0 * self.join_rate:.1f}%"
        line = (
            f"{self.chamber} {self.year}"
            f" | filings joined {self.filings_joined}/{self.filings}"
            f" (unjoined {self.filings_unjoined})"
            f" | rows joined {self.rows_joined}/{self.rows} = {rate}"
        )
        if self.unresolved_filers:
            shown = ", ".join(self.unresolved_filers[:5])
            more = (
                f", +{len(self.unresolved_filers) - 5} more"
                if len(self.unresolved_filers) > 5
                else ""
            )
            line += f" | unresolved: {shown}{more}"
        return line


@dataclass(frozen=True)
class ParseGateReport:
    eras: tuple[EraParseCoverage, ...]
    join: tuple[EraJoinCoverage, ...]
    threshold: float

    @property
    def owner_decision_required(self) -> bool:
        return any(era.status in ("miss", "unmeasurable") for era in self.eras)

    @property
    def surfaced(self) -> tuple[EraParseCoverage, ...]:
        """Every non-passing era, severity-ranked — never a subset of them."""
        return tuple(
            sorted(
                (e for e in self.eras if e.status in ("miss", "unmeasurable")),
                key=_severity_key,
                reverse=True,
            )
        )


def _severity_key(era: EraParseCoverage) -> tuple[float, float, int]:
    """Unmeasurable share first, then row-rate shortfall, then era size."""
    shortfall = (
        0.0
        if era.efile_parse_rate is None
        else max(0.0, GATE_THRESHOLD - era.efile_parse_rate)
    )
    return (era.severity, shortfall, era.efile_filings)


def _rate(numerator: int, denominator: int) -> float | None:
    if denominator == 0:
        return None
    return numerator / denominator


def _assert_census_consistency(eras: dict[tuple[str, str], dict]) -> None:
    """The two censuses describe the same population, or nothing is reported.

    Held by construction in :func:`compute_parse_gate` — the row census draws
    its era keys from the filing census's measurable set — and checked here so a
    future edit that re-derives the row population in SQL cannot reintroduce
    the disagreement silently. Two invariants:

    * an era whose filing census found **no** measurable e-file filing has no
      measurable denominator at all, so it must contribute **zero** floor rows;
    * the clean subset can never exceed the total it is a subset of.
    """
    for (chamber, year), counters in sorted(eras.items()):
        if counters["measurable"] == 0 and counters["rows"] != 0:
            raise ParseGateConsistencyError(
                f"{chamber} {year}: the row census counted {counters['rows']}"
                " rows for an era whose filing census found no measurable"
                " e-file filing — the two censuses disagree about the"
                " measurable population"
            )
        if counters["clean"] > counters["rows"]:
            raise ParseGateConsistencyError(
                f"{chamber} {year}: {counters['clean']} clean rows out of"
                f" {counters['rows']} total — the clean subset escaped its"
                " denominator"
            )


def compute_parse_gate(
    conn: sqlite3.Connection, *, threshold: float = GATE_THRESHOLD
) -> ParseGateReport:
    """The per-``(chamber, year)`` gate report, derived from the database."""
    eras: dict[tuple[str, str], dict] = {}

    def cell(chamber: str, year: str) -> dict:
        return eras.setdefault(
            (chamber, year),
            {
                "efile_filings": 0,
                "measurable": 0,
                "unmeasurable": 0,
                "needs_ocr": 0,
                "rows": 0,
                "clean": 0,
            },
        )

    # --- census 1: e-file filings, split by whether their expected row count
    # is known. `row_count` is persisted by populus.load on every load, so a
    # NULL or 0 means the document produced nothing countable — same unknown
    # denominator as an outright parse failure.
    #
    # This census also DEFINES the measurable population census 2 draws from:
    # each measurable filing's era key is recorded here and reused verbatim
    # below, so the two censuses cannot disagree about which filings count or
    # about which era a filing belongs to.
    measurable_era: dict[str, tuple[str, str]] = {}
    for filing_id, chamber, year, parse_status, row_count in conn.execute(
        "SELECT filing_id, chamber, substr(filed_date, 1, 4), parse_status,"
        " row_count FROM filings WHERE source != 'kadoa'"
    ):
        counters = cell(chamber, year)
        if parse_status == "needs_ocr":
            # §5.2: paper is retained and counted in dispositions, and excluded
            # from BOTH e-file censuses. It is not a parse failure.
            counters["needs_ocr"] += 1
            continue
        counters["efile_filings"] += 1
        measurable = (
            parse_status != "failed"
            and isinstance(row_count, int)
            and row_count > 0
        )
        counters["measurable" if measurable else "unmeasurable"] += 1
        if measurable:
            measurable_era[filing_id] = (chamber, year)

    # --- census 2: e-file transaction rows, clean vs total, over EXACTLY the
    # measurable population census 1 defined. "Clean" comes from
    # has_parse_defect over the stored flags — never a second flag taxonomy in
    # SQL (normalize.py owns the list).
    #
    # A failed filing, or one whose `row_count` is NULL/0, can still hold stored
    # transactions (a partial load, a stale count, a reparse that emptied the
    # count but not the table). Those rows are outside the declared denominator:
    # counting them would put rows in the printed floor that the filing census
    # has already declared unmeasurable, inflating the floor, the severity
    # ordering, the stats figures, and the owner-decision evidence. Membership
    # is tested against `measurable_era` rather than re-derived in SQL, so there
    # is one predicate, evaluated once.
    for filing_id, flags in conn.execute(
        "SELECT t.filing_id, t.flags"
        " FROM transactions t JOIN filings f ON f.filing_id = t.filing_id"
        " WHERE f.source != 'kadoa' AND f.parse_status != 'needs_ocr'"
    ):
        era_key = measurable_era.get(filing_id)
        if era_key is None:
            continue
        counters = cell(*era_key)
        counters["rows"] += 1
        try:
            parsed_flags = json.loads(flags)
        except (TypeError, ValueError):
            parsed_flags = []
        if not has_parse_defect(parsed_flags):
            counters["clean"] += 1

    _assert_census_consistency(eras)

    coverages: list[EraParseCoverage] = []
    for (chamber, year), counters in sorted(eras.items()):
        efile_filings = counters["efile_filings"]
        unmeasurable = counters["unmeasurable"]
        rows = counters["rows"]
        clean = counters["clean"]
        parse_rate = _rate(clean, rows)
        denominator_known = unmeasurable == 0
        if efile_filings == 0:
            status, meets = "no_efile_filings", True
        elif not denominator_known:
            # No tolerance band: a percentage of filings cannot bound row
            # coverage, so the row gate refuses to certify a denominator it
            # does not know (LD10). An era whose e-file filings produced zero
            # rows lands here by construction — every such filing is
            # unmeasurable — so a template that parses nothing can never read
            # as n/a or pass.
            status, meets = "unmeasurable", False
        elif parse_rate is not None and parse_rate >= threshold:
            status, meets = "pass", True
        else:
            status, meets = "miss", False
        coverages.append(
            EraParseCoverage(
                chamber=chamber,
                year=year,
                efile_filings=efile_filings,
                measurable_efile_filings=counters["measurable"],
                unmeasurable_efile_filings=unmeasurable,
                efile_filing_measurable_rate=_rate(
                    counters["measurable"], efile_filings
                ),
                efile_rows=rows,
                clean_efile_rows=clean,
                efile_parse_rate=parse_rate,
                row_denominator_known=denominator_known,
                needs_ocr_filings=counters["needs_ocr"],
                status=status,
                meets_gate=meets,
                severity=_rate(unmeasurable, efile_filings) or 0.0,
            )
        )
    return ParseGateReport(
        eras=tuple(coverages),
        join=compute_join_coverage(conn),
        threshold=threshold,
    )


def compute_join_coverage(conn: sqlite3.Connection) -> tuple[EraJoinCoverage, ...]:
    """Per-``(chamber, year)`` member-join coverage over primary sources.

    Filing counts come from ``filings``; row counts from
    ``v_default_transactions``, the same §9.5 population every published
    aggregate reads, so the era figures reconcile with ``stats.json`` rather
    than describing a different set of rows.
    """
    cells: dict[tuple[str, str], dict] = {}

    def cell(chamber: str, year: str) -> dict:
        return cells.setdefault(
            (chamber, year),
            {"filings": 0, "filings_joined": 0, "rows": 0, "rows_joined": 0,
             "unresolved": set()},
        )

    for chamber, year, bioguide_id, filer_name_raw in conn.execute(
        "SELECT chamber, substr(filed_date, 1, 4), bioguide_id, filer_name_raw"
        " FROM filings WHERE source != 'kadoa'"
    ):
        counters = cell(chamber, year)
        counters["filings"] += 1
        if bioguide_id is not None:
            counters["filings_joined"] += 1
        else:
            counters["unresolved"].add(filer_name_raw)

    for chamber, year, rows, joined in conn.execute(
        "SELECT chamber, substr(filed_date, 1, 4), COUNT(*), COUNT(bioguide_id)"
        " FROM v_default_transactions WHERE source != 'kadoa'"
        " GROUP BY chamber, substr(filed_date, 1, 4)"
    ):
        counters = cell(chamber, year)
        counters["rows"] += rows
        counters["rows_joined"] += joined

    return tuple(
        EraJoinCoverage(
            chamber=chamber,
            year=year,
            filings=counters["filings"],
            filings_joined=counters["filings_joined"],
            filings_unjoined=counters["filings"] - counters["filings_joined"],
            rows=counters["rows"],
            rows_joined=counters["rows_joined"],
            join_rate=_rate(counters["rows_joined"], counters["rows"]),
            unresolved_filers=tuple(sorted(counters["unresolved"])),
        )
        for (chamber, year), counters in sorted(cells.items())
    )


def format_gate_report(report: ParseGateReport) -> str:
    """Every era's measured line plus the decision block when one is owed."""
    lines = ["parse gate (e-file rows, per chamber-year):"]
    if not report.eras:
        lines.append("  (no filings)")
    for era in report.eras:
        lines.append(f"  {era.format_line(threshold=report.threshold)}")
    lines.append("member join (primary sources, per chamber-year):")
    if not report.join:
        lines.append("  (no filings)")
    for era in report.join:
        lines.append(f"  {era.format_line()}")
    decision = format_gate_decision(report)
    if decision:
        lines.append(decision)
    return "\n".join(lines)


def format_gate_decision(report: ParseGateReport) -> str:
    """The OWNER DECISION REQUIRED block, or ``''`` when every era passes.

    Never weakens the gate and never proceeds silently: a non-passing era is
    named with its measured figures and the three options. Eras are ordered by
    severity so the worst reads first; every surfaced era is listed.
    """
    surfaced = report.surfaced
    if not surfaced:
        return ""
    lines = [
        "OWNER DECISION REQUIRED:"
        f" {len(surfaced)} era(s) did not pass the"
        f" {100.0 * report.threshold:.0f}% e-file row gate."
    ]
    for era in surfaced:
        share = era.unmeasurable_share
        share_text = "n/a" if share is None else f"{100.0 * share:.1f}%"
        if era.efile_parse_rate is None:
            measured = "no e-file rows produced"
        elif era.row_denominator_known:
            measured = f"row rate {100.0 * era.efile_parse_rate:.1f}%"
        else:
            measured = (
                f"row rate {100.0 * era.efile_parse_rate:.1f}% — a FLOOR over a"
                " partial denominator, not a verdict"
            )
        lines.append(
            f"  {era.chamber} {era.year} [{era.status}]: {measured};"
            f" unmeasurable e-file filings {era.unmeasurable_efile_filings}"
            f"/{era.efile_filings} ({share_text} of the era)"
        )
    lines.append("  Options:")
    for option in GATE_OPTIONS:
        lines.append(f"    {option}")
    lines.append(
        "  This tooling surfaces the decision and never proceeds past it,"
        " weakens the gate, or selects an option on the owner's behalf."
    )
    return "\n".join(lines)
