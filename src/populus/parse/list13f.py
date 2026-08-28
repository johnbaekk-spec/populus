"""Parser for the SEC Official List of Section 13(f) Securities.

Two independent parsers over the SAME definitional publication — a fixed-width
text variant (published only for the most recent quarter) and a PDF variant
(every quarter, the only form for historical quarters) — plus the machinery the
definitional role demands:

* ``parse_list13f_text``  — the fixed-width layout, offsets taken from the file
  itself (see :data:`_TEXT_LAYOUT`), never guessed.
* ``parse_list13f_pdf`` + ``parse_list13f_legend`` — x-anchored column
  extraction reusing M1's generic ``extract_positioned``/``_column_of``
  primitives (NOT the House-specific segmenter), with flag semantics read from
  the document's own legend page and asserted present.
* ``cusip_check_digit_ok`` — the standard mod-10 double-add-double check,
  applied only to non-option rows (SEC synthetic option CUSIPs do not follow
  the standard rule — verified against the cached bytes).
* ``assert_cross_format_identity`` — the ground-truth gate: the two parsers'
  raw, cardinality-preserving row sequences must be identical.

Every source row lands in exactly one :class:`Disposition13f` bucket — nothing
is silently dropped (G3) — and the buckets partition ``rows_read``. The
file-wide status-conflict and duplicate decisions are made across the WHOLE
file before any record is emitted, so input order can never change the outcome
(the ``parse_company_tickers`` DC1 discipline).
"""

from __future__ import annotations

import io
import re
from collections import defaultdict
from dataclasses import dataclass, field
from typing import NamedTuple

from populus.canonical import nfc
from populus.identity.registry import normalize_cusip
from populus.parse.house_ptr import Line, _column_of, extract_positioned

#: Version stamped onto every seeded fact row (§5.1 transformation provenance).
LIST13F_PARSER_VERSION = "list13f-1.0.0"

#: Instrument-description values that mark an option leg. is_option is keyed off
#: the CLASS column, NOT the option asterisk: the asterisk marks the UNDERLYING
#: security that HAS a listed option (verified against 13flist2026q2 — the
#: asterisk never appears on a CALL/PUT row), while the CALL/PUT legs carry SEC
#: synthetic CUSIPs that do not satisfy the standard check-digit rule.
_OPTION_CLASSES = frozenset({"CALL", "PUT"})


# --- the verified fixed-width text layout (offsets cited, never guessed) --


class _TextLayout(NamedTuple):
    """Column slices of the 80-char fixed-width text variant.

    Verified against ``data-cache/13flist/13flist2026q2-txt.txt`` (25,333 rows,
    every row exactly 80 chars, 2026-07-30):

    ``[0:9]``   CUSIP · ``[9]`` option asterisk on the underlying (``*``/space) ·
    ``[10:40]`` issuer name · ``[40:67]`` issuer description (class) ·
    ``[67:70]`` STATUS (``*A*`` ADDED / ``*D*`` DELETED / blank) ·
    ``[79]``    trailing status letter (uniformly ``E``).
    """

    cusip: slice = slice(0, 9)
    option_asterisk: slice = slice(9, 10)
    name: slice = slice(10, 40)
    security_class: slice = slice(40, 67)
    status: slice = slice(67, 70)


_TEXT_LAYOUT = _TextLayout()
#: Every row of the fixed-width variant is exactly this many characters.
_TEXT_ROW_WIDTH = 80
#: The 0-based index of the trailing per-row status letter, uniformly ``E`` across
#: all 25,333 rows of 13flist2026q2 (verified 2026-07-30). Text-only: the PDF
#: variant renders no counterpart column (its rightmost content is STATUS), so it
#: is DOMAIN-VALIDATED here but is NOT part of the cross-format tuple — there is
#: nothing on the PDF side to compare it to (see :func:`assert_cross_format_identity`).
_TEXT_TRAILING = slice(79, 80)
_TEXT_TRAILING_DOMAIN = frozenset({"E"})

#: STATUS-column tokens (text variant) mapped to the canonical flag. The PDF
#: variant prints these as the words ADDED / DELETED instead; both map here.
_TEXT_STATUS = {"*A*": "ADDED", "*D*": "DELETED"}
_CANONICAL_FLAGS = ("", "ADDED", "DELETED")
#: The documented domains of the two other fixed-position text cells (G3): an
#: out-of-domain value is a COUNTED reject (``rejected_bad_field``), never silently
#: normalized to blank (that silent coercion was a past defect).
_TEXT_OPTION_DOMAIN = frozenset({"*", " "})
_TEXT_STATUS_DOMAIN = frozenset({"*A*", "*D*", "   "})


# --- the comparison substrate and the accepted record --------------------------------


class RawRow(NamedTuple):
    """One source line's canonical cross-format tuple.

    Emitted once per source data line, PRE-dedup and in file order — the
    cardinality-preserving substrate the cross-format gate compares. ``cusip``
    is the normalized 9-char value (or the raw joined token when it will not
    normalize, so a malformed row still participates in the comparison).

    Every field is one BOTH formats can express, so the whole tuple is compared:
    ``status_flag`` is the STATUS column (text ``*A*``/``*D*``; PDF
    ADDED/DELETED word) and ``has_listed_option`` is the option asterisk on the
    underlying (text column 9; PDF a lone ``*`` in the CUSIP column). The
    text-only trailing status letter is deliberately NOT here — the PDF has no
    such column — but it is domain-validated at parse time all the same.
    """

    cusip: str
    issuer_name: str
    security_class: str
    status_flag: str
    has_listed_option: bool


@dataclass(frozen=True)
class List13fRecord:
    """One accepted, deduped, seed-worthy security for a quarter's list.

    A record is emitted for every CUSIP that appears on the quarter's list as a
    current 13(f) security (an unmarked or ADDED row). A CUSIP whose only rows
    are DELETED, or whose rows carry BOTH ADDED and DELETED (a status conflict),
    yields no record — it registers no validity for the quarter (G14, Locked
    Decisions 3-4).
    """

    cusip: str
    issuer_name: str
    security_class: str
    is_option: bool
    has_listed_option: bool
    status_flag: str  # "" (continuing) | "ADDED"; DELETED never becomes a record
    quarter: str
    #: 1-based source-line ordinal of the representative row (§5.1 provenance).
    row_ordinal: int
    #: The VERBATIM source row this record was read from — the original 80-char
    #: fixed-width text line, or the PDF data row reconstructed from its
    #: positioned words in reading order. Persisted onto the seeded fact row so a
    #: published or migrated identity can be audited against its exact source line
    #: without the gitignored cache (§5.1).
    raw_source: str = ""

    @property
    def sort_key(self) -> str:
        return self.cusip


# --- counted dispositions (G3) ------------------------------------------------


@dataclass(frozen=True)
class Disposition13f:
    """PARSE phase. Mutually exclusive buckets that sum to ``rows_read``.

    Mirrors ``identity.bootstrap.Disposition``: every source data line lands in
    exactly one bucket and the sum is asserted at construction, so an accounting
    bug fails loudly at the parse boundary (G3). The per-line buckets are:

    * ``accepted`` / ``accepted_option`` — the first seed-worthy line for a
      CUSIP (non-option / option), which becomes its record.
    * ``accepted_duplicate`` — a further seed-worthy line for a CUSIP already
      recorded (byte-identical repeats and the continuing+ADDED pairing).
    * ``counted_deleted`` — a DELETED line on a non-conflicted CUSIP; it seeds
      nothing (the prior quarter's own list already covers the prior quarter).
    * ``rejected_status_conflict`` — every line of a CUSIP that carries BOTH
      ADDED and DELETED anywhere in the file; neither seeds. Decided file-wide
      over EVERY candidate whose CUSIP normalizes — including a structurally-bad
      companion — so a malformed row can never let a conflicted CUSIP through
, and the outcome is order-independent.
    * ``rejected_definition_conflict`` — every line of a CUSIP whose seed-worthy
      rows disagree on issuer/class/option; only byte-identical definitions may
      collapse to one record, so an ambiguous CUSIP seeds neither row (G3).
    * ``rejected_malformed`` — the CUSIP will not normalize to 9 ``[0-9A-Z]``.
    * ``rejected_bad_check_digit`` — a NON-option CUSIP fails the check digit.
    * ``rejected_bad_width`` — the source line does not conform to the expected
      layout (text: not 80 chars; pdf: a data-region line that yielded no row).
    * ``rejected_bad_field`` — the line is the right width but a fixed-position
      cell (option asterisk, STATUS, or the trailing status letter) is outside
      its documented domain. Counted, never silently normalized to blank (G3).
    """

    rows_read: int = 0
    accepted: int = 0
    accepted_option: int = 0
    accepted_duplicate: int = 0
    counted_deleted: int = 0
    rejected_status_conflict: int = 0
    rejected_definition_conflict: int = 0
    rejected_malformed: int = 0
    rejected_bad_check_digit: int = 0
    rejected_bad_width: int = 0
    rejected_bad_field: int = 0

    BUCKETS = (
        "accepted",
        "accepted_option",
        "accepted_duplicate",
        "counted_deleted",
        "rejected_status_conflict",
        "rejected_definition_conflict",
        "rejected_malformed",
        "rejected_bad_check_digit",
        "rejected_bad_width",
        "rejected_bad_field",
    )

    def __post_init__(self) -> None:
        total = sum(getattr(self, bucket) for bucket in self.BUCKETS)
        if total != self.rows_read:
            raise ValueError(
                f"disposition buckets sum to {total} but {self.rows_read} rows"
                " were read — the buckets must partition the source rows"
            )

    @property
    def records_emitted(self) -> int:
        return self.accepted + self.accepted_option

    @property
    def parse_coverage(self) -> float:
        """Fraction of source rows that were structurally recognized.

        A row is "covered" unless it could not be read into well-formed fixed
        cells — a wrong-width line (``rejected_bad_width``) or an out-of-domain
        fixed cell (``rejected_bad_field``). A covered row was understood well
        enough to reach a CUSIP/status decision (it may still be a malformed-CUSIP
        or bad-check-digit reject). 1.0 when there are no rows to read.
        """
        if self.rows_read == 0:
            return 1.0
        unrecognized = self.rejected_bad_width + self.rejected_bad_field
        return (self.rows_read - unrecognized) / self.rows_read


@dataclass(frozen=True)
class LegendSemantics:
    """The flag meanings read from the document's own legend page.

    The ADDED/DELETED/asterisk sentences are asserted present by
    :func:`parse_list13f_legend`; this object records that they were found and
    the (unreliable — see :data:`quarter_ending`) legend date.
    """

    added_present: bool
    deleted_present: bool
    option_asterisk_present: bool
    #: The "calendar quarter ending <date>" the legend claims. UNRELIABLE as the
    #: quarter identifier: the 2025q1 legend reads "March 31, 2024" (stale
    #: boilerplate). The filename/URL is authoritative; this is recorded only to
    #: flag drift (Locked Decision 1).
    quarter_ending: str | None


@dataclass(frozen=True)
class ParsedList13f:
    """The full result of parsing one quarter's list in one format."""

    quarter: str
    raw_rows: tuple[RawRow, ...]
    records: tuple[List13fRecord, ...]
    disposition: Disposition13f
    #: The in-document ``Year: YYYY Qtr:N`` marker (PDF only), for the ingest's
    #: filename-vs-document quarter cross-check. ``None`` for the text variant.
    document_quarter: str | None = None
    #: The SEC's own ``Total Count: NNN`` trailer (PDF, last page only). The ingest
    #: validates it against ``rows_read`` when present. ``None`` when the
    #: parse did not reach the trailer (e.g. the first-page excerpt or the text
    #: variant, which carries no such line).
    document_total_count: int | None = None
    legend: LegendSemantics | None = None


class List13fParseError(ValueError):
    """The source is not a parseable 13(f) list (e.g. the legend has drifted)."""


# --- quarter identity (pure; the filename/URL is authoritative — Decision 1) ---

_QUARTER_RE = re.compile(r"(\d{4})q([1-4])", re.IGNORECASE)
#: The first month of each calendar quarter (1-based) → (start_month, end month+1).
_QUARTER_MONTHS = {1: (1, 4), 2: (4, 7), 3: (7, 10), 4: (10, 13)}


def parse_quarter(text: str) -> str | None:
    """Extract the canonical ``YYYYqN`` quarter tag from a filename/URL/marker.

    Case-insensitive; returns the lower-cased canonical form (``2026q2``) or
    ``None``. The FIRST ``\\dqN`` match wins — the SEC filenames carry exactly
    one (``13flist2026q2.pdf`` / ``13flist2026q2-txt.txt``).
    """
    match = _QUARTER_RE.search(text)
    if match is None:
        return None
    return f"{match.group(1)}q{match.group(2)}"


def quarter_bounds(quarter: str) -> tuple[str, str]:
    """``(quarter_start, next_quarter_start)`` ISO dates for a ``YYYYqN`` tag.

    Half-open ``[start, next_start)`` so a quarter-end ``period_of_report``
    resolves (``start <= period < next_start``) and consecutive quarters are
    contiguous at resolution: 2025q1 → ``('2025-01-01', '2025-04-01')``, 2025q4 →
    ``('2025-10-01', '2026-01-01')`` (G5 — the endpoints are dates and the
    convention is explicit).
    """
    match = _QUARTER_RE.fullmatch(quarter)
    if match is None:
        raise List13fParseError(f"not a YYYYqN quarter tag: {quarter!r}")
    year = int(match.group(1))
    start_month, end_month = _QUARTER_MONTHS[int(match.group(2))]
    start = f"{year:04d}-{start_month:02d}-01"
    if end_month == 13:
        next_start = f"{year + 1:04d}-01-01"
    else:
        next_start = f"{year:04d}-{end_month:02d}-01"
    return start, next_start


# --- CUSIP check digit ---------------------------------------------------


def _cusip_char_value(ch: str) -> int | None:
    if ch.isdigit():
        return int(ch)
    if "A" <= ch <= "Z":
        return ord(ch) - ord("A") + 10
    return {"*": 36, "@": 37, "#": 38}.get(ch)


def cusip_check_digit_ok(cusip: str) -> bool:
    """The standard mod-10 double-add-double CUSIP check.

    Digits are 0-9, letters A-Z are 10-35, and the three SEC fill characters
    ``* @ #`` are 36-38. Every second position (1-indexed even) is doubled; the
    check digit is ``(10 - (sum mod 10)) mod 10`` and must equal the ninth
    character. Applied ONLY to non-option rows — verified 2026-07-30 that all
    13,113 non-option rows of 13flist2026q2 pass while the CALL/PUT legs (SEC
    synthetic CUSIPs) do not follow the rule.
    """
    if len(cusip) != 9:
        return False
    total = 0
    for position, ch in enumerate(cusip[:8]):
        value = _cusip_char_value(ch)
        if value is None:
            return False
        if position % 2 == 1:
            value *= 2
        total += value // 10 + value % 10
    check = (10 - (total % 10)) % 10
    return str(check) == cusip[8]


# --- shared candidate → disposition/records core -------------------------------


@dataclass(frozen=True)
class _Candidate:
    """One source data line's raw fields, before any disposition decision."""

    cusip_raw: str
    issuer_name: str
    security_class: str
    status_flag: str            # "", "ADDED", "DELETED" (canonical)
    has_listed_option: bool
    structural_ok: bool         # right width / re-joined CUSIP is 9 chars
    #: Every fixed-position cell (option asterisk, STATUS, trailing letter) is
    #: within its documented domain. False → a COUNTED ``rejected_bad_field``, not
    #: a silent blank. Defaults True so the PDF mapper opts in explicitly.
    field_ok: bool = True
    #: The verbatim source row this candidate was read from (§5.1).
    source_row: str = ""


@dataclass(frozen=True)
class _Parsed:
    """A parse-accepted line carried into the file-wide phase-B decision."""

    cusip: str
    is_option: bool
    has_listed_option: bool
    issuer_name: str
    security_class: str
    status_flag: str
    row_ordinal: int
    source_row: str


def _canonical_flag(status_flag: str) -> str:
    return status_flag if status_flag in _CANONICAL_FLAGS else ""


def _finalize(
    candidates: list[_Candidate],
    *,
    quarter: str,
    document_quarter: str | None = None,
    document_total_count: int | None = None,
    legend: LegendSemantics | None = None,
) -> ParsedList13f:
    """Turn per-line candidates into raw_rows + records + the disposition.

    Phase A rejects structurally/format-bad lines per line. Phase B decides the
    duplicate and status-conflict outcomes across the WHOLE accepted set, in a
    canonical order, so the result is independent of input order.
    """
    raw_rows = tuple(
        RawRow(
            cusip=normalize_cusip(candidate.cusip_raw) or candidate.cusip_raw,
            issuer_name=candidate.issuer_name,
            security_class=candidate.security_class,
            status_flag=candidate.status_flag,
            has_listed_option=candidate.has_listed_option,
        )
        for candidate in candidates
    )

    # Phase 0 — the file-wide A/D status-conflict decision, computed over EVERY
    # candidate whose CUSIP normalizes, INCLUDING structurally-imperfect ones, and
    # BEFORE any per-row seed eligibility. A bad-width `*D*` companion must still
    # veto a valid `*A*` on the same CUSIP (Locked Decision 4): moving the decision
    # ahead of the structural rejection is deliberate. Fail-closed — a
    # CUSIP carrying both ADDED and DELETED anywhere seeds nothing.
    normalized_cusips = [normalize_cusip(candidate.cusip_raw) for candidate in candidates]
    status_by_cusip: dict[str, set[str]] = defaultdict(set)
    for candidate, ncusip in zip(candidates, normalized_cusips):
        if ncusip is not None:
            status_by_cusip[ncusip].add(candidate.status_flag)
    status_conflicted = {
        cusip
        for cusip, statuses in status_by_cusip.items()
        if "ADDED" in statuses and "DELETED" in statuses
    }

    rejected_bad_width = 0
    rejected_bad_field = 0
    rejected_malformed = 0
    rejected_bad_check_digit = 0
    rejected_status_conflict = 0
    parsed: list[_Parsed] = []
    for ordinal, (candidate, ncusip) in enumerate(
        zip(candidates, normalized_cusips), start=1
    ):
        if ncusip is not None and ncusip in status_conflicted:
            # The whole conflicted CUSIP is rejected file-wide, malformed rows and
            # all — decided before structural eligibility so none can slip through.
            rejected_status_conflict += 1
            continue
        if not candidate.structural_ok:
            rejected_bad_width += 1
            continue
        if not candidate.field_ok:
            rejected_bad_field += 1
            continue
        if ncusip is None:
            rejected_malformed += 1
            continue
        cusip = ncusip
        is_option = candidate.security_class.strip().upper() in _OPTION_CLASSES
        if not is_option and not cusip_check_digit_ok(cusip):
            rejected_bad_check_digit += 1
            continue
        parsed.append(
            _Parsed(
                cusip=cusip,
                is_option=is_option,
                has_listed_option=candidate.has_listed_option,
                issuer_name=candidate.issuer_name,
                security_class=candidate.security_class,
                status_flag=candidate.status_flag,
                row_ordinal=ordinal,
                source_row=candidate.source_row,
            )
        )

    by_cusip: dict[str, list[_Parsed]] = defaultdict(list)
    for line in parsed:
        by_cusip[line.cusip].append(line)

    accepted = 0
    accepted_option = 0
    accepted_duplicate = 0
    counted_deleted = 0
    rejected_definition_conflict = 0
    records: list[List13fRecord] = []
    for cusip, group in sorted(by_cusip.items()):
        # Status conflicts were already removed file-wide (phase 0), so a group is
        # A/D-consistent here; it is at most continuing + ADDED + DELETED lines.
        seed_worthy = [line for line in group if line.status_flag != "DELETED"]
        # A duplicate may collapse to one record ONLY when the seed-worthy
        # rows share one definition (issuer, class, is_option, has_listed_option).
        # If they disagree, the CUSIP's definition is ambiguous — reject the WHOLE
        # CUSIP and seed neither, never silently pick one and count the rest as
        # accepted duplicates. Status ("" vs ADDED) is deliberately NOT part of the
        # definition: a continuing+ADDED pairing is a legitimate same-security dup.
        definitions = {
            (line.issuer_name, line.security_class, line.is_option, line.has_listed_option)
            for line in seed_worthy
        }
        if len(definitions) > 1:
            rejected_definition_conflict += len(group)
            continue
        counted_deleted += len(group) - len(seed_worthy)
        if not seed_worthy:
            # DELETED-only: ceased to be a 13(f) security; seeds nothing (G14).
            continue
        representative = min(
            seed_worthy,
            key=lambda line: (line.status_flag, line.security_class, line.row_ordinal),
        )
        if representative.is_option:
            accepted_option += 1
        else:
            accepted += 1
        accepted_duplicate += len(seed_worthy) - 1
        seed_statuses = {line.status_flag for line in seed_worthy}
        record_flag = "ADDED" if seed_statuses == {"ADDED"} else ""
        records.append(
            List13fRecord(
                cusip=cusip,
                issuer_name=representative.issuer_name,
                security_class=representative.security_class,
                is_option=representative.is_option,
                has_listed_option=any(line.has_listed_option for line in seed_worthy),
                status_flag=record_flag,
                quarter=quarter,
                row_ordinal=representative.row_ordinal,
                raw_source=representative.source_row,
            )
        )

    disposition = Disposition13f(
        rows_read=len(candidates),
        accepted=accepted,
        accepted_option=accepted_option,
        accepted_duplicate=accepted_duplicate,
        counted_deleted=counted_deleted,
        rejected_status_conflict=rejected_status_conflict,
        rejected_definition_conflict=rejected_definition_conflict,
        rejected_malformed=rejected_malformed,
        rejected_bad_check_digit=rejected_bad_check_digit,
        rejected_bad_width=rejected_bad_width,
        rejected_bad_field=rejected_bad_field,
    )
    return ParsedList13f(
        quarter=quarter,
        raw_rows=raw_rows,
        records=tuple(sorted(records, key=lambda record: record.sort_key)),
        disposition=disposition,
        document_quarter=document_quarter,
        document_total_count=document_total_count,
        legend=legend,
    )


# --- text parser ---------------------------------------------------------


def parse_list13f_text(data: str, *, quarter: str) -> ParsedList13f:
    """Parse the fixed-width text variant against the verified offsets.

    Blank lines are dropped (they carry no row); every non-blank line is a
    counted candidate. A line that is not exactly 80 characters is
    ``rejected_bad_width`` — never silently reshaped.
    """
    candidates: list[_Candidate] = []
    for raw_line in nfc(data).split("\n"):
        line = raw_line.rstrip("\r")
        if line.strip() == "":
            continue
        structural_ok = len(line) == _TEXT_ROW_WIDTH
        cusip_raw = line[_TEXT_LAYOUT.cusip]
        option_cell = line[_TEXT_LAYOUT.option_asterisk]
        name = " ".join(line[_TEXT_LAYOUT.name].split())
        security_class = " ".join(line[_TEXT_LAYOUT.security_class].split())
        status_cell = line[_TEXT_LAYOUT.status]
        trailing_cell = line[_TEXT_TRAILING]
        # Validate every fixed-position cell against its documented domain. An
        # unknown option/status/trailing value is NOT coerced to blank: the
        # row is a counted ``rejected_bad_field``. Only meaningful on a
        # right-width line — a wrong-width line is already ``rejected_bad_width``.
        field_ok = structural_ok and (
            option_cell in _TEXT_OPTION_DOMAIN
            and status_cell in _TEXT_STATUS_DOMAIN
            and trailing_cell in _TEXT_TRAILING_DOMAIN
        )
        candidates.append(
            _Candidate(
                cusip_raw=cusip_raw,
                issuer_name=name,
                security_class=security_class,
                status_flag=_TEXT_STATUS.get(status_cell, ""),
                has_listed_option=option_cell == "*",
                structural_ok=structural_ok,
                field_ok=field_ok,
                # The source line VERBATIM (post-NFC, minus only the line
                # terminator) — the audit substrate persisted onto the fact row
                #. Not re-derived from the parsed cells: it must be able to
                # disagree with them if the parse is ever wrong.
                source_row=line,
            )
        )
    return _finalize(candidates, quarter=quarter)


# --- PDF legend ----------------------------------------------------------


_QUARTER_ENDING_RE = re.compile(
    r"quarter ending\s+([A-Z][a-z]+ \d{1,2},\s*\d{4})", re.IGNORECASE
)


def _legend_text(pdf_bytes: bytes) -> str:
    import pdfplumber

    try:
        with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
            if len(pdf.pages) < 2:
                raise List13fParseError(
                    "13(f) list PDF has no legend page (fewer than 2 pages)"
                )
            return nfc(pdf.pages[1].extract_text() or "")
    except List13fParseError:
        raise
    except Exception as exc:  # noqa: BLE001 — any engine error is a parse failure
        raise List13fParseError(f"could not read the legend page: {exc}") from exc


def parse_list13f_legend(pdf_bytes: bytes) -> LegendSemantics:
    """Read the flag semantics from the legend page and assert they are present.

    Fails loud (``List13fParseError``) if the ADDED, DELETED or option-asterisk
    sentences are absent — a legend drift must stop the run, not be assumed
    away. Verified against every cached quarter 2025q1-2026q2.
    """
    text = _legend_text(pdf_bytes)
    flat = " ".join(text.lower().split())
    added = "added" in flat and "become a section 13(f) security" in flat
    deleted = "deleted" in flat and "ceases to be a 13(f) security" in flat
    asterisk = "asterisk" in flat and "listed option" in flat
    missing = [
        name
        for name, present in (
            ("ADDED", added),
            ("DELETED", deleted),
            ("option-asterisk", asterisk),
        )
        if not present
    ]
    if missing:
        raise List13fParseError(
            "13(f) list legend page is missing required semantics: "
            + ", ".join(missing)
            + " — the flag meanings must be read from the document, not assumed"
        )
    match = _QUARTER_ENDING_RE.search(text)
    return LegendSemantics(
        added_present=added,
        deleted_present=deleted,
        option_asterisk_present=asterisk,
        quarter_ending=match.group(1) if match else None,
    )


# --- PDF data parser -----------------------------------------------------

#: The repeated column-header line on every data page.
_PDF_HEADER = ("CUSIP", "NO", "ISSUER", "NAME", "ISSUER", "DESCRIPTION", "STATUS")
_PDF_STATUS = {"ADDED": "ADDED", "DELETED": "DELETED"}
_DOCUMENT_QUARTER_RE = re.compile(r"Year:\s*(\d{4})\s*Qtr:\s*(\d)")
_TOTAL_COUNT_RE = re.compile(r"Total Count:\s*([\d,]+)")


def _is_list13f_header(texts: list[str]) -> bool:
    return tuple(texts) == _PDF_HEADER


def _is_run_header(words: tuple) -> bool:
    """The two per-page run-stamp lines (``Run Date:`` / ``Run Time:``)."""
    return (
        len(words) >= 2
        and words[0].text == "Run"
        and words[1].text in ("Date:", "Time:")
    )


def _is_total_count(words: tuple) -> bool:
    """The final ``Total Count: NNN`` document trailer (last page only).

    It carries no CUSIP-column content, so it is a document footer, not a data
    row; the SEC's own row count printed here (verified to equal the text
    variant's row count) is not part of the listing. Filtered, never counted.
    """
    return (
        len(words) >= 2
        and words[0].text == "Total"
        and words[1].text == "Count:"
    )


def _list13f_anchors(line: Line) -> list[tuple[float, str]]:
    """Column x-anchors from the ``CUSIP NO ISSUER NAME ISSUER DESCRIPTION
    STATUS`` header line (words already sorted by x0 in :class:`Line`).

    Both ``ISSUER`` words are present; the first opens the name column and the
    second the description column — order, not text, distinguishes them.
    """
    words = line.words
    return [
        (words[0].x0, "cusip"),        # CUSIP
        (words[2].x0, "name"),         # first ISSUER (of "ISSUER NAME")
        (words[4].x0, "description"),  # second ISSUER (of "ISSUER DESCRIPTION")
        (words[6].x0, "status"),       # STATUS
    ]


def _list13f_row_mapper(
    line: Line, anchors: list[tuple[float, str]]
) -> _Candidate:
    """Map one positioned data line to a candidate row.

    Words are bucketed into columns by x-anchor (the generic ``_column_of``);
    the CUSIP renders as three space-split tokens (6+2+1) that are re-joined,
    the option asterisk (a lone ``*`` left of the issuer name) sits in the CUSIP
    column and is detected there, and the STATUS column carries the ADDED /
    DELETED words. A line whose re-joined CUSIP is not 9 characters is flagged
    ``structural_ok=False`` and retained (never dropped — G3).
    """
    columns: dict[str, list[str]] = {
        "cusip": [],
        "name": [],
        "description": [],
        "status": [],
    }
    for word in line.words:
        columns[_column_of(word.x0, anchors)].append(word.text)
    cusip_tokens = [token for token in columns["cusip"] if token != "*"]
    has_listed_option = "*" in columns["cusip"]
    cusip_raw = "".join(cusip_tokens)
    status_text = " ".join(columns["status"]).strip().upper()
    # An unrecognized STATUS word is a counted ``rejected_bad_field``, never a
    # silent "continuing" blank — the same domain discipline as the text side.
    field_ok = status_text == "" or status_text in _PDF_STATUS
    return _Candidate(
        cusip_raw=cusip_raw,
        issuer_name=" ".join(columns["name"]),
        security_class=" ".join(columns["description"]),
        status_flag=_PDF_STATUS.get(status_text, ""),
        has_listed_option=has_listed_option,
        structural_ok=len(cusip_raw) == 9,
        field_ok=field_ok,
        # The PDF has no literal "line" to quote, so the canonical reconstruction
        # is its positioned words re-joined in reading order — the same row a
        # reader sees on the page. Deterministic for a given page layout.
        source_row=line.text,
    )


def parse_list13f_pdf(pdf_bytes: bytes, *, quarter: str) -> ParsedList13f:
    """Parse a quarter's list PDF via x-anchored column extraction.

    Reuses ONLY the generic ``extract_positioned``/``_column_of`` primitives
    plus this module's two 13F-specific helpers; the House segmenter is never
    touched. The legend semantics are read and asserted first, so a drifted
    legend fails the parse. Per-page run-stamp and column-header lines are
    filtered (not counted); every remaining data-region line is a counted
    candidate.
    """
    legend = parse_list13f_legend(pdf_bytes)
    pages = extract_positioned(pdf_bytes)
    candidates: list[_Candidate] = []
    document_quarter: str | None = None
    document_total_count: int | None = None
    anchors: list[tuple[float, str]] | None = None
    for page in pages:
        for line in page:
            texts = [word.text for word in line.words]
            if _is_list13f_header(texts):
                anchors = _list13f_anchors(line)
                continue
            if _is_run_header(line.words):
                match = _DOCUMENT_QUARTER_RE.search(line.text)
                if match is not None:
                    document_quarter = f"{match.group(1)}q{match.group(2)}"
                continue
            if _is_total_count(line.words):
                match = _TOTAL_COUNT_RE.search(line.text)
                if match is not None:
                    document_total_count = int(match.group(1).replace(",", ""))
                continue
            if anchors is None:
                # Cover / legend region — no data header seen yet.
                continue
            candidates.append(_list13f_row_mapper(line, anchors))
    return _finalize(
        candidates,
        quarter=quarter,
        document_quarter=document_quarter,
        document_total_count=document_total_count,
        legend=legend,
    )


# --- cross-format ground-truth gate --------------------------------------


class CrossFormatMismatchError(List13fParseError):
    """The text and PDF parses of one quarter are not row-for-row identical."""


def assert_cross_format_identity(
    text_parsed: ParsedList13f, pdf_parsed: ParsedList13f
) -> None:
    """Require the two formats' raw row sequences to be identical.

    Compares the FULL ``raw_rows`` sequences — count, order, multiplicity and
    every ``(cusip, name, class, status_flag, has_listed_option)`` tuple — BEFORE
    any dedup or seeding. Both the STATUS column and the option asterisk are in
    the tuple, so a PDF parse that drops the underlying's ``*`` or misreads a
    status now fails HERE, not silently. The one text cell with no PDF
    counterpart — the trailing status letter — is domain-validated in the text
    parser instead; it cannot be cross-compared because the PDF renders no such
    column. The PDF parser is validated against the text parser's ground truth; a
    PDF parse that drops, duplicates or misreads any identical source row fails
    here. The error carries the first diverging index and a multiset diff.
    """
    text_rows = text_parsed.raw_rows
    pdf_rows = pdf_parsed.raw_rows
    if len(text_rows) != len(pdf_rows):
        raise CrossFormatMismatchError(
            f"row count differs: text has {len(text_rows)} rows, pdf has"
            f" {len(pdf_rows)} rows"
            + _multiset_diff(text_rows, pdf_rows)
        )
    for index, (text_row, pdf_row) in enumerate(zip(text_rows, pdf_rows)):
        if text_row != pdf_row:
            raise CrossFormatMismatchError(
                f"row {index} differs:\n  text: {text_row!r}\n  pdf:  {pdf_row!r}"
                + _multiset_diff(text_rows, pdf_rows)
            )


def _multiset_diff(text_rows: tuple, pdf_rows: tuple) -> str:
    from collections import Counter

    text_only = Counter(text_rows) - Counter(pdf_rows)
    pdf_only = Counter(pdf_rows) - Counter(text_rows)
    if not text_only and not pdf_only:
        return ""
    lines = ["\nmultiset diff:"]
    for row, count in list(text_only.items())[:10]:
        lines.append(f"  only in text (x{count}): {row!r}")
    for row, count in list(pdf_only.items())[:10]:
        lines.append(f"  only in pdf  (x{count}): {row!r}")
    return "\n".join(lines)
