"""Parser for the SEC Official List of Section 13(f) Securities (RUN M2-5).

Text offsets, PDF x-anchored columns, legend semantics, the CUSIP check digit,
counted dispositions and the R5 cross-format gate — every behavioural assertion
is pinned against the committed verbatim excerpts (see
tests/fixtures/inst/13flist/PROVENANCE.md) or a fixture-shaped synthetic row,
and the file-wide decisions are asserted order-independent.
"""

from __future__ import annotations

import dataclasses
import io
import json
import os
from pathlib import Path

import pytest
from pypdf import PdfReader, PdfWriter

from populus.parse.list13f import (
    CrossFormatMismatchError,
    Disposition13f,
    List13fParseError,
    assert_cross_format_identity,
    cusip_check_digit_ok,
    parse_list13f_legend,
    parse_list13f_pdf,
    parse_list13f_text,
    parse_quarter,
    quarter_bounds,
)

FIXTURES = Path(__file__).parent / "fixtures" / "inst" / "13flist"
EXPECTED = Path(__file__).parent / "fixtures" / "inst" / "expected"


def _txt() -> str:
    return (FIXTURES / "13flist2026q2-excerpt.txt").read_text(encoding="utf-8")


def _pdf(quarter: str = "2026q2") -> bytes:
    return (FIXTURES / f"13flist{quarter}-excerpt.pdf").read_bytes()


def _line(cusip, name, cls, *, status="   ", opt=False) -> str:
    """One 80-char fixed-width row in the verified layout (for edge cases the
    first-page excerpt does not contain)."""
    row = (
        cusip.ljust(9)[:9]
        + ("*" if opt else " ")
        + name.ljust(30)[:30]
        + cls.ljust(27)[:27]
        + status
        + " " * 9
        + "E"
    )
    assert len(row) == 80, len(row)
    return row


# --- text layout (R3) ---------------------------------------------------------


def test_text_offsets_against_the_committed_excerpt():
    parsed = parse_list13f_text(_txt(), quarter="2026q2")
    by_cusip = {record.cusip: record for record in parsed.records}
    # The underlying share row: non-option, and the option asterisk marks it as
    # HAVING a listed option (it is not itself an option leg).
    shs = by_cusip["B38564108"]
    assert shs.issuer_name == "CMB.TECH NV"
    assert shs.security_class == "SHS"
    assert shs.is_option is False
    assert shs.has_listed_option is True
    # Its CALL / PUT legs are options, keyed off the CLASS column, not the asterisk.
    assert by_cusip["B38564908"].security_class == "CALL"
    assert by_cusip["B38564908"].is_option is True
    assert by_cusip["B38564908"].has_listed_option is False
    assert by_cusip["B38564958"].security_class == "PUT"
    assert by_cusip["B38564958"].is_option is True


def test_golden_roundtrip():
    parsed = parse_list13f_text(_txt(), quarter="2026q2")
    payload = {
        "quarter": parsed.quarter,
        "disposition": dataclasses.asdict(parsed.disposition),
        "records": [dataclasses.asdict(record) for record in parsed.records],
        "raw_rows": [list(row) for row in parsed.raw_rows],
    }
    path = EXPECTED / "list13f-2026q2.expected.json"
    if os.environ.get("UPDATE_GOLDENS") == "1":
        path.write_text(
            json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
        )
    assert path.exists(), "golden missing: run UPDATE_GOLDENS=1"
    assert payload == json.loads(path.read_text(encoding="utf-8"))


# --- CUSIP check digit, scoped to non-option (R6) -----------------------------


def test_cusip_check_digit_algorithm():
    # Real issuer CUSIPs pass; the same value with a wrong ninth digit fails.
    assert cusip_check_digit_ok("037833100") is True   # Apple
    assert cusip_check_digit_ok("594918104") is True   # Microsoft
    assert cusip_check_digit_ok("037833101") is False  # wrong check digit
    assert cusip_check_digit_ok("0378331") is False    # too short


def test_check_digit_is_scoped_to_non_option_rows():
    # A non-option row with a bad check digit is rejected; an OPTION row (CALL)
    # with a synthetic CUSIP that also fails the standard rule is ACCEPTED —
    # SEC option CUSIPs are not subject to it. Mutation guard: dropping the
    # is_option scoping would reject the option row and drop accepted_option to 0.
    text = "\n".join(
        [
            _line("037833100", "APPLE INC", "COM"),           # valid non-option
            _line("037833101", "BADSUM CORP", "COM"),         # bad check digit
            _line("88160R109", "OPT UNDERLYING", "CALL"),     # option, bad std check
        ]
    ) + "\n"
    parsed = parse_list13f_text(text, quarter="2026q1")
    assert parsed.disposition.accepted == 1
    assert parsed.disposition.rejected_bad_check_digit == 1
    assert parsed.disposition.accepted_option == 1
    cusips = {record.cusip for record in parsed.records}
    assert cusips == {"037833100", "88160R109"}


# --- dispositions: dedup, conflict, deleted (R6/G3, Locked Decisions 3-4) ------


def test_duplicate_rows_dedup_with_count():
    row = _line("037833100", "APPLE INC", "COM")
    parsed = parse_list13f_text("\n".join([row, row]) + "\n", quarter="2026q1")
    assert parsed.disposition.rows_read == 2
    assert parsed.disposition.accepted == 1
    assert parsed.disposition.accepted_duplicate == 1
    assert len(parsed.records) == 1


@pytest.mark.parametrize("order", [("*A*", "*D*"), ("*D*", "*A*")])
def test_status_conflict_is_order_independent_and_seeds_nothing(order):
    # An ADDED+DELETED pair for one CUSIP is a contradiction decided across the
    # WHOLE file: NEITHER row seeds, in EITHER input order (Locked Decision 4).
    rows = [_line("037833100", "APPLE INC", "COM", status=order[0]),
            _line("037833100", "APPLE INC", "COM", status=order[1])]
    parsed = parse_list13f_text("\n".join(rows) + "\n", quarter="2026q1")
    assert parsed.disposition.rejected_status_conflict == 2
    assert parsed.disposition.accepted == 0
    assert parsed.records == ()


def test_bad_width_deleted_companion_still_vetoes_a_valid_added():
    # F5 / Locked Decision 4: a valid 80-char *A* row plus the SAME CUSIP's
    # malformed 79-char *D* row (trailing 'E' clipped) is a file-wide status
    # conflict — the CUSIP seeds NOTHING even though one leg is structurally bad.
    # The conflict is decided over the full candidate set BEFORE per-row structural
    # rejection. Mutation guard: deciding conflicts only over structurally-valid
    # survivors would drop the *D* first, leaving accepted==1 and seeding the CUSIP.
    added = _line("037833100", "APPLE INC", "COM", status="*A*")           # 80 chars
    deleted_bad = _line("037833100", "APPLE INC", "COM", status="*D*")[:-1]  # 79 chars
    assert len(deleted_bad) == 79
    parsed = parse_list13f_text("\n".join([added, deleted_bad]) + "\n", quarter="2026q1")
    assert parsed.disposition.rejected_status_conflict == 2
    assert parsed.disposition.rejected_bad_width == 0  # both counted as the conflict
    assert parsed.disposition.accepted == 0
    assert parsed.records == ()


@pytest.mark.parametrize(
    "order",
    [("APPLE INC", "OTHER ISSUER"), ("OTHER ISSUER", "APPLE INC")],
    ids=["apple-first", "other-first"],
)
def test_definition_conflict_outcome_is_order_independent(order):
    # Round-1 F6: conflicting same-CUSIP metadata must be REJECTED, and the
    # outcome must not depend on which row the source happens to list first —
    # rejecting is what makes it order-independent, whereas any "pick a winner"
    # rule (first-wins, last-wins, min-by-name) is order-sensitive by construction.
    # Mutation guard: restoring the first-wins representative would make BOTH
    # parametrizations emit one record, and the issuer_name would differ between
    # them — the exact defect the finding reproduced (ALPHA vs BETA).
    rows = [
        _line("037833100", order[0], "COM"),
        _line("037833100", order[1], "COM"),
    ]
    parsed = parse_list13f_text("\n".join(rows) + "\n", quarter="2026q1")
    assert parsed.records == ()
    assert parsed.disposition.rejected_definition_conflict == 2
    assert parsed.disposition.accepted == 0
    assert parsed.disposition.accepted_duplicate == 0


def test_conflicting_option_flag_alone_is_a_definition_conflict():
    # The option asterisk is part of the definition: two rows identical except for
    # the underlying's listed-option marker are contradictory, not duplicates.
    rows = [
        _line("037833100", "APPLE INC", "COM", opt=False),
        _line("037833100", "APPLE INC", "COM", opt=True),
    ]
    parsed = parse_list13f_text("\n".join(rows) + "\n", quarter="2026q1")
    assert parsed.records == ()
    assert parsed.disposition.rejected_definition_conflict == 2


def test_same_cusip_conflicting_definitions_seed_neither():
    # F11: two rows for one CUSIP with DIFFERENT issuer/class are a definition
    # conflict — only byte-identical definitions may collapse to one record. The
    # whole CUSIP is rejected; neither row seeds and NEITHER is an accepted
    # duplicate. Mutation guard: silently picking one representative would give
    # accepted==1, accepted_duplicate==1 and a seeded record.
    rows = [
        _line("037833100", "APPLE INC", "COM"),
        _line("037833100", "OTHER ISSUER", "PFD"),
    ]
    parsed = parse_list13f_text("\n".join(rows) + "\n", quarter="2026q1")
    assert parsed.disposition.rejected_definition_conflict == 2
    assert parsed.disposition.accepted == 0
    assert parsed.disposition.accepted_duplicate == 0
    assert parsed.records == ()


def test_byte_identical_rows_still_collapse_to_one_record():
    # The F11 fix must NOT reject legitimate byte-identical duplicates: two rows
    # that agree on every definition field collapse to one accepted record with one
    # accepted_duplicate (the DC1 dedup discipline is preserved).
    row = _line("037833100", "APPLE INC", "COM")
    parsed = parse_list13f_text("\n".join([row, row]) + "\n", quarter="2026q1")
    assert parsed.disposition.accepted == 1
    assert parsed.disposition.accepted_duplicate == 1
    assert parsed.disposition.rejected_definition_conflict == 0
    assert len(parsed.records) == 1


def test_deleted_only_cusip_registers_no_record():
    parsed = parse_list13f_text(
        _line("037833100", "APPLE INC", "COM", status="*D*") + "\n", quarter="2026q1"
    )
    assert parsed.disposition.counted_deleted == 1
    assert parsed.disposition.accepted == 0
    assert parsed.records == ()


def test_continuing_plus_added_seeds_once_as_continuing():
    # A CUSIP appearing both blank (continuing) and ADDED seeds one record, as
    # continuing (status ""); the extra seed-worthy line is accepted_duplicate.
    rows = [_line("037833100", "APPLE INC", "COM"),
            _line("037833100", "APPLE INC", "COM", status="*A*")]
    parsed = parse_list13f_text("\n".join(rows) + "\n", quarter="2026q1")
    assert parsed.disposition.accepted == 1
    assert parsed.disposition.accepted_duplicate == 1
    assert len(parsed.records) == 1
    assert parsed.records[0].status_flag == ""


def test_added_only_cusip_records_as_added():
    parsed = parse_list13f_text(
        _line("037833100", "APPLE INC", "COM", status="*A*") + "\n", quarter="2026q1"
    )
    assert parsed.records[0].status_flag == "ADDED"


def test_bad_width_line_is_a_counted_structural_reject():
    parsed = parse_list13f_text(
        _line("037833100", "APPLE INC", "COM") + "\n" + "too short\n", quarter="2026q1"
    )
    assert parsed.disposition.rejected_bad_width == 1
    assert parsed.disposition.parse_coverage < 1.0
    assert parsed.disposition.accepted == 1


def _raw_row(cusip, name, cls, *, opt=" ", status="   ", trailing="E") -> str:
    """An 80-char row with arbitrary (possibly out-of-domain) fixed cells, for the
    F9 domain-validation edge cases the excerpt does not contain."""
    row = (
        cusip.ljust(9)[:9] + opt + name.ljust(30)[:30] + cls.ljust(27)[:27]
        + status + " " * 9 + trailing
    )
    assert len(row) == 80, len(row)
    return row


def test_unknown_text_status_is_a_counted_reject_not_blank():
    # A width-valid row whose STATUS cell is neither *A*, *D* nor blank must be a
    # COUNTED reject — NOT silently coerced to "" and accepted as continuing (F9).
    # Mutation guard: mapping an unknown status to "" (the pre-fix behaviour) would
    # accept this row and drop rejected_bad_field to 0.
    parsed = parse_list13f_text(
        _raw_row("037833100", "APPLE INC", "COM", status="*X*") + "\n", quarter="2026q1"
    )
    assert parsed.disposition.rejected_bad_field == 1
    assert parsed.disposition.accepted == 0
    assert parsed.records == ()
    assert parsed.disposition.parse_coverage < 1.0


def test_unknown_option_cell_is_a_counted_reject_not_false():
    # The option cell is '*' or blank; any other glyph is a counted reject, never
    # silently read as "no listed option" (F9).
    parsed = parse_list13f_text(
        _raw_row("037833100", "APPLE INC", "COM", opt="X") + "\n", quarter="2026q1"
    )
    assert parsed.disposition.rejected_bad_field == 1
    assert parsed.disposition.accepted == 0


def test_bad_trailing_status_letter_is_a_counted_reject():
    # The trailing per-row status letter is uniformly 'E'; a different letter is a
    # counted reject, never ignored (F9). It has no PDF counterpart, so it is
    # validated here rather than cross-compared (F1).
    parsed = parse_list13f_text(
        _raw_row("037833100", "APPLE INC", "COM", trailing="Z") + "\n", quarter="2026q1"
    )
    assert parsed.disposition.rejected_bad_field == 1
    assert parsed.disposition.accepted == 0


def test_unknown_pdf_status_word_is_a_counted_reject_not_blank():
    # Round-1 F4, PDF side: the STATUS column's vocabulary is ADDED / DELETED /
    # blank. A row whose status column carries anything else must be a COUNTED
    # reject, not silently coerced to "" and seeded as continuing — the same
    # discipline the text parser applies to its *A*/*D*/blank cell.
    # Driven through the real row mapper with the real page anchors, so this
    # exercises the production PDF path rather than a hand-built candidate.
    from populus.parse.list13f import (
        _is_list13f_header,
        _list13f_anchors,
        _list13f_row_mapper,
    )
    from populus.parse.house_ptr import extract_positioned

    anchors = None
    data_line = None
    for page in extract_positioned(_pdf("2026q2")):
        for line in page:
            if _is_list13f_header([w.text for w in line.words]):
                anchors = _list13f_anchors(line)
            elif anchors is not None and data_line is None:
                data_line = line
        if data_line is not None:
            break
    assert anchors is not None and data_line is not None

    clean = _list13f_row_mapper(data_line, anchors)
    assert clean.field_ok is True  # the real row is in-vocabulary

    # Re-point the STATUS column at the issuer-description x so a NON-status word
    # ("SHS") lands in the status column — a realistic column-drift misread. The
    # CUSIP and name columns are left intact, so the row is structurally fine and
    # ONLY the status vocabulary is violated.
    drifted = [(x, name) for x, name in anchors if name not in ("description", "status")]
    drifted.append((dict((n, x) for x, n in anchors)["description"], "status"))
    drifted.sort()
    mapped = _list13f_row_mapper(data_line, drifted)
    assert mapped.structural_ok is True      # the CUSIP still re-joins to 9 chars
    assert mapped.status_flag == ""          # unmapped …
    assert mapped.field_ok is False          # … but NOT accepted as "continuing"

    parsed = _finalize_one(mapped)
    assert parsed.disposition.rejected_bad_field == 1
    assert parsed.records == ()


def _finalize_one(candidate):
    """Run the real file-wide finalizer over a single candidate."""
    from populus.parse.list13f import _finalize

    return _finalize([candidate], quarter="2026q2")


def test_disposition_buckets_must_partition_rows_read():
    with pytest.raises(ValueError, match="partition"):
        Disposition13f(rows_read=5, accepted=1)  # 1 != 5


def test_excerpt_parse_coverage_is_total():
    parsed = parse_list13f_text(_txt(), quarter="2026q2")
    assert parsed.disposition.parse_coverage == 1.0
    assert parsed.disposition.rejected_bad_width == 0
    assert parsed.disposition.rejected_bad_field == 0


# --- PDF: legend, x-anchored columns, 3-token CUSIP (R4) ----------------------


def test_pdf_reproduces_the_text_records_via_x_anchored_columns():
    text_parsed = parse_list13f_text(_txt(), quarter="2026q2")
    pdf_parsed = parse_list13f_pdf(_pdf("2026q2"), quarter="2026q2")
    # The 3-token CUSIP ("B38564 10 8") is re-joined to 9 chars and the
    # positional columns reproduce the text parse exactly. EVERY identity and
    # flag field must match; `raw_source` is excluded because it is deliberately
    # format-specific §5.1 provenance — the verbatim 80-char text line on one side
    # and the reconstructed PDF row on the other (F9) — and is asserted separately
    # below. Excluding it is the ONLY relaxation: all eight other fields, and the
    # record count and ordering, are still compared exactly.
    def identity_fields(records):
        return [
            {k: v for k, v in dataclasses.asdict(r).items() if k != "raw_source"}
            for r in records
        ]

    assert identity_fields(pdf_parsed.records) == identity_fields(text_parsed.records)
    assert len(pdf_parsed.records) == len(text_parsed.records)
    assert pdf_parsed.document_quarter == "2026q2"
    # Both sides DO carry a source row, and each is its own format's rendering —
    # neither is empty and neither was copied from the other format.
    for pdf_record, text_record in zip(pdf_parsed.records, text_parsed.records):
        assert pdf_record.raw_source and text_record.raw_source
        assert len(text_record.raw_source) == 80  # the fixed-width source line


def test_pdf_legend_semantics_present():
    legend = parse_list13f_legend(_pdf("2026q2"))
    assert legend.added_present and legend.deleted_present
    assert legend.option_asterisk_present
    assert legend.quarter_ending == "June 30, 2026"


def test_pdf_legend_is_read_from_the_document_and_fails_loud_on_drift():
    # Build a 2-page PDF whose page 1 is the COVER (not the legend): the semantics
    # are absent, so parsing MUST fail loud rather than assume them (R4). Mutation
    # guard: a parser that hard-coded the semantics would not raise here.
    reader = PdfReader(io.BytesIO(_pdf("2026q2")))
    writer = PdfWriter()
    writer.add_page(reader.pages[0])  # cover
    writer.add_page(reader.pages[0])  # cover again in the legend slot
    buf = io.BytesIO()
    writer.write(buf)
    with pytest.raises(List13fParseError, match="missing required semantics"):
        parse_list13f_legend(buf.getvalue())


def test_stale_legend_date_is_parsed_but_not_the_quarter():
    # The 2025Q1 legend reads "quarter ending March 31, 2024" (stale boilerplate)
    # while the document's own Year/Qtr header and filename say 2025Q1. The parser
    # records the (stale) legend date but the authoritative quarter is the file's
    # (Locked Decision 1).
    parsed = parse_list13f_pdf(_pdf("2025q1"), quarter="2025q1")
    assert parsed.legend.quarter_ending == "March 31, 2024"
    assert parsed.document_quarter == "2025q1"


@pytest.mark.parametrize("quarter", ["2025q1", "2025q2", "2025q3", "2025q4", "2026q1"])
def test_every_era_excerpt_parses_with_full_coverage(quarter):
    parsed = parse_list13f_pdf(_pdf(quarter), quarter=quarter)
    assert parsed.disposition.parse_coverage == 1.0
    assert parsed.document_quarter == quarter
    assert len(parsed.records) > 0


# --- cross-format ground-truth gate (R5) --------------------------------------


def test_cross_format_identity_holds_on_the_excerpts():
    text_parsed = parse_list13f_text(_txt(), quarter="2026q2")
    pdf_parsed = parse_list13f_pdf(_pdf("2026q2"), quarter="2026q2")
    assert_cross_format_identity(text_parsed, pdf_parsed)  # does not raise


def test_cross_format_gate_fails_when_a_pdf_row_is_perturbed():
    # Mutation guard: perturb one PDF raw row and the gate MUST catch it, with the
    # diverging index reported.
    text_parsed = parse_list13f_text(_txt(), quarter="2026q2")
    pdf_parsed = parse_list13f_pdf(_pdf("2026q2"), quarter="2026q2")
    rows = list(pdf_parsed.raw_rows)
    rows[3] = rows[3]._replace(issuer_name="TAMPERED NAME")
    broken = dataclasses.replace(pdf_parsed, raw_rows=tuple(rows))
    with pytest.raises(CrossFormatMismatchError, match="row 3 differs"):
        assert_cross_format_identity(text_parsed, broken)


def test_cross_format_gate_catches_a_dropped_row():
    text_parsed = parse_list13f_text(_txt(), quarter="2026q2")
    pdf_parsed = parse_list13f_pdf(_pdf("2026q2"), quarter="2026q2")
    broken = dataclasses.replace(pdf_parsed, raw_rows=pdf_parsed.raw_rows[:-1])
    with pytest.raises(CrossFormatMismatchError, match="row count differs"):
        assert_cross_format_identity(text_parsed, broken)


def test_cross_format_gate_catches_a_dropped_option_asterisk():
    # F1: the option asterisk (has_listed_option) is now part of the compared
    # tuple. Row 0 (B38564108) HAS a listed option; a PDF parser that dropped its
    # underlying '*' must fail the R5 gate — pre-fix it compared as flags="" on
    # both sides and passed. Mutation guard: removing has_listed_option from RawRow
    # would make this row compare equal and the gate would NOT raise.
    text_parsed = parse_list13f_text(_txt(), quarter="2026q2")
    pdf_parsed = parse_list13f_pdf(_pdf("2026q2"), quarter="2026q2")
    assert text_parsed.raw_rows[0].has_listed_option is True  # the substrate carries it
    rows = list(pdf_parsed.raw_rows)
    rows[0] = rows[0]._replace(has_listed_option=False)  # the dropped-asterisk defect
    broken = dataclasses.replace(pdf_parsed, raw_rows=tuple(rows))
    with pytest.raises(CrossFormatMismatchError, match="row 0 differs"):
        assert_cross_format_identity(text_parsed, broken)


def test_raw_rows_preserve_cardinality_before_dedup():
    # F13: raw_rows is the PRE-dedup, cardinality-preserving substrate. Two
    # identical source lines must produce TWO equal raw_rows (not one), and the R5
    # gate must see a count mismatch against a one-row counterpart. Mutation guard:
    # a parser that deduplicated raw_rows before comparison would make len == 1 and
    # the count-mismatch assertion below would not raise.
    row = _line("037833100", "APPLE INC", "COM")
    two = parse_list13f_text("\n".join([row, row]) + "\n", quarter="2026q1")
    one = parse_list13f_text(row + "\n", quarter="2026q1")
    assert len(two.raw_rows) == 2
    assert two.raw_rows[0] == two.raw_rows[1]  # identical lines → equal tuples
    assert len(one.raw_rows) == 1
    with pytest.raises(CrossFormatMismatchError, match="row count differs"):
        assert_cross_format_identity(two, one)


# --- raw source provenance on the record (round-1 F9) -------------------------


def test_text_record_carries_its_verbatim_source_line():
    # F9: the record must carry the ORIGINAL source line, not a re-rendering of
    # the parsed cells — that is what lets a published fact be audited against its
    # exact source row without the gitignored cache. Mutation guard: synthesizing
    # raw_source from the parsed fields would lose the exact column padding and
    # this byte-equality assertion would fail.
    line = _line("037833100", "APPLE INC", "COM")
    parsed = parse_list13f_text(line + "\n", quarter="2026q1")
    assert parsed.records[0].raw_source == line
    assert len(parsed.records[0].raw_source) == 80


def test_record_raw_source_is_the_representative_row_from_the_real_excerpt():
    # Against the committed verbatim excerpt: the stored line must appear in the
    # source file EXACTLY, at the record's own 1-based row_ordinal.
    text = _txt()
    parsed = parse_list13f_text(text, quarter="2026q2")
    lines = [line for line in text.split("\n") if line.strip()]
    for record in parsed.records[:5]:
        assert record.raw_source == lines[record.row_ordinal - 1]
        assert record.cusip in record.raw_source


def test_pdf_record_carries_its_reconstructed_source_row():
    # The PDF has no literal line to quote, so the canonical reconstruction is the
    # positioned words in reading order. It must be non-empty and contain the
    # issuer name — a placeholder or empty string would defeat the audit purpose.
    parsed = parse_list13f_pdf(_pdf("2026q2"), quarter="2026q2")
    record = parsed.records[0]
    assert record.raw_source != ""
    assert record.issuer_name.split()[0] in record.raw_source


# --- pure quarter helpers (Locked Decision 1) ---------------------------------


def test_parse_quarter_and_bounds():
    assert parse_quarter("13flist2026q2.pdf") == "2026q2"
    assert parse_quarter("https://www.sec.gov/files/investment/13flist2025q1-txt.txt") == "2025q1"
    assert parse_quarter("no-quarter-here") is None
    assert quarter_bounds("2026q1") == ("2026-01-01", "2026-04-01")
    assert quarter_bounds("2026q2") == ("2026-04-01", "2026-07-01")
    assert quarter_bounds("2025q4") == ("2025-10-01", "2026-01-01")  # year rollover
