"""House PTR classifier, segmentation, fallback, and golden corpus (RUN 2).

Golden hand-verification (R11): the expected JSON for **2026_20034916**,
**2015_20003021**, and **2020_20013901** was visually verified against the
rendered PDFs (page images) — row-by-row: owner, asset text incl. wraps,
side, both dates, amount label, and (where the column exists) the cap-gains
checkbox state. Regenerate goldens with ``UPDATE_GOLDENS=1 uv run pytest``.
"""

from __future__ import annotations

import json
import os
from pathlib import Path

import pytest

from populus.ingest.house import evaluate_document
from populus.normalize import KNOWN_FLAGS, normalize_row
from populus.parse import house_ptr
from populus.parse.house_ptr import (
    EmptyParseError,
    Line,
    UnreadablePdfError,
    Word,
    classify,
    parse_ptr,
    segment_rows,
    segment_text_rows,
)

FIXTURES = Path(__file__).parent / "fixtures" / "house"

# Filed dates from the House Clerk index XML (<YEAR>FD.xml), recorded once at
# golden-authoring time so the goldens do not depend on the uncommitted
# data-cache.
FIXTURE_FILED_DATES = {
    "2015_20002703": "2015-03-11",
    "2015_20003021": "2015-05-08",
    "2015_20003730": "2015-09-04",
    "2020_20013901": "2020-01-10",
    "2020_20016556": "2020-05-13",
    "2020_20017380": "2020-09-15",
    "2020_20017555": "2020-10-19",
    "2020_20017685": "2020-11-16",
    "2026_20033981": "2026-02-12",
    "2026_20034114": "2026-03-17",
    "2026_20034168": "2026-03-12",
    "2026_20034800": "2026-06-26",
    "2026_20034916": "2026-07-10",
}

EFILE_FIXTURES = sorted(FIXTURE_FILED_DATES)
PAPER_FIXTURES = sorted(
    p.stem for p in FIXTURES.glob("*.pdf") if p.stem not in FIXTURE_FILED_DATES
)


def _fixture_bytes(stem: str) -> bytes:
    return (FIXTURES / f"{stem}.pdf").read_bytes()


def _doc_id(stem: str) -> str:
    return stem.split("_")[1]


def build_golden_payload(stem: str) -> dict:
    """Parse + normalize one e-file fixture into the golden JSON shape."""
    data = _fixture_bytes(stem)
    doc_id = _doc_id(stem)
    filed_date = FIXTURE_FILED_DATES[stem]
    classification = classify(data, doc_id)
    parsed = parse_ptr(data, doc_id=doc_id)
    rows = []
    any_defect = False
    for ptr_row in parsed.rows:
        normalized = normalize_row(
            ptr_row.raw_row,
            filed_date=filed_date,
            cap_gains_cell=ptr_row.cap_gains_cell,
            cap_gains_column_present=parsed.cap_gains_column,
            row_ordinal=ptr_row.row_ordinal,
            source_row_no=ptr_row.source_row_no,
            structural_flags=ptr_row.structural_flags,
        )
        from populus.normalize import has_parse_defect

        any_defect = any_defect or has_parse_defect(normalized.flags)
        rows.append(
            {
                "raw_row": dict(ptr_row.raw_row),
                "row_ordinal": normalized.row_ordinal,
                "source_row_no": normalized.source_row_no,
                "owner": normalized.owner,
                "ticker": normalized.ticker,
                "asset_name": normalized.asset_name,
                "asset_type": normalized.asset_type,
                "side": normalized.side,
                "transaction_date": normalized.transaction_date,
                "days_to_file": normalized.days_to_file,
                "is_late": normalized.is_late,
                "amount_low": normalized.amount_low,
                "amount_high": normalized.amount_high,
                "amount_label": normalized.amount_label,
                "cap_gains_over_200": normalized.cap_gains_over_200,
                "comment": normalized.comment,
                "flags": normalized.flags,
            }
        )
    return {
        "filing": {
            "doc_id": doc_id,
            "classification": classification.kind,
            "parse_status": "partial" if any_defect else "parsed",
            "parse_path": parsed.path,
            "header": {
                "name": parsed.header.name,
                "status": parsed.header.status,
                "state_district": parsed.header.state_district,
            },
            "filed_date": filed_date,
        },
        "rows": rows,
    }


# --- classifier (R4) ---------------------------------------------------------


@pytest.mark.parametrize("stem", EFILE_FIXTURES)
def test_classifier_efile_sweep(stem):
    c = classify(_fixture_bytes(stem), _doc_id(stem))
    assert c.kind == "efile"
    assert c.conflict is False
    assert c.text_chars >= 200


@pytest.mark.parametrize("stem", PAPER_FIXTURES)
def test_classifier_paper_sweep(stem):
    c = classify(_fixture_bytes(stem), _doc_id(stem))
    assert c.kind == "paper"
    assert c.conflict is False
    assert c.text_chars < 200


def test_classifier_corpus_has_24_fixtures_zero_conflicts():
    assert len(EFILE_FIXTURES) == 13
    assert len(PAPER_FIXTURES) == 11


def test_conflict_efile_yield_paper_shape():
    # Real e-file text under a paper-shaped DocID: signals disagree ⇒ paper
    # (conservative) + conflict marker.
    c = classify(_fixture_bytes("2026_20034916"), "9123456")
    assert c.kind == "paper"
    assert c.conflict is True


def test_conflict_paper_yield_efile_shape():
    c = classify(_fixture_bytes("2026_9116146"), "20099999")
    assert c.kind == "paper"
    assert c.conflict is True


# --- paper filings (R5) ------------------------------------------------------


@pytest.mark.parametrize("stem", PAPER_FIXTURES)
def test_paper_fixture_needs_ocr_zero_rows(stem):
    evaluated = evaluate_document(
        _fixture_bytes(stem), doc_id=_doc_id(stem), filed_date="2026-01-01"
    )
    assert evaluated.status == "needs_ocr"
    assert evaluated.rows == ()
    assert evaluated.total_rows == 0


# --- positioned segmentation (R7/LD20, fail-if-removed) ----------------------

ANCHORS = [
    (26.0, "id"),
    (62.0, "owner"),
    (101.0, "asset"),
    (248.0, "side"),
    (313.0, "date"),
    (365.0, "notification"),
    (430.0, "amount"),
    (505.0, "capgains"),
]


def _structural_line(top, *, page=0, asset="Acme Corp (ACME)", amount="$1,001 - $15,000"):
    words = [
        Word("SP", 62.0),
        *(Word(t, 101.0 + 10 * i) for i, t in enumerate(asset.split())),
        Word("P", 248.0),
        Word("01/05/2026", 313.0),
        Word("01/07/2026", 365.0),
    ]
    words += [Word(t, 430.0 + 12 * i) for i, t in enumerate(amount.split())]
    return Line(top=top, words=tuple(words), page=page)


def _asset_line(top, text, *, page=0):
    return Line(
        top=top,
        words=tuple(Word(t, 101.0 + 10 * i) for i, t in enumerate(text.split())),
        page=page,
    )


def _subline(top, text, *, page=0):
    return Line(
        top=top,
        words=tuple(Word(t, 101.0 + 10 * i) for i, t in enumerate(text.split())),
        page=page,
    )


def test_wrap_within_pitch_attaches():
    # Two-line asset cell: the wrap joins its row; one candidate emitted.
    lines = [
        _structural_line(100.0, asset="Cognizant Technology Solutions"),
        _asset_line(110.5, "Corporation - Class A (CTSH)"),
        _subline(128.0, "FILING STATUS: New"),
        _structural_line(166.0, asset="Costco Wholesale (COST)"),
        _subline(184.0, "FILING STATUS: New"),
    ]
    candidates = segment_rows(lines, ANCHORS)
    assert len(candidates) == 2
    assert (
        candidates[0].asset_text
        == "Cognizant Technology Solutions Corporation - Class A (CTSH)"
    )
    assert candidates[0].structural_flags() == set()


def test_untyped_text_after_a_filing_status_continues_that_sub_line():
    # M1-E (owner decision 2026-08-01). Before the sub-line columns existed
    # this text had nowhere to live, so it opened a flagged orphan — a
    # fabricated "transaction" with no side, date, or amount. FILING STATUS is
    # now captured, so its wrapped tail continues it and NOTHING is dropped.
    lines = [
        _structural_line(100.0),
        _subline(118.0, "FILING STATUS: New"),
        _asset_line(143.0, "Stray Asset Text"),
    ]
    candidates = segment_rows(lines, ANCHORS)
    assert len(candidates) == 1
    assert candidates[0].asset_text == "Acme Corp (ACME)"
    assert candidates[0].filing_status_text == "New Stray Asset Text"
    assert candidates[0].structural_flags() == set()


def test_row_shaped_text_after_a_filing_status_still_opens_a_flagged_orphan():
    # The F4 property M1-E must not lose: only UNTYPED prose continues a
    # sub-line. Anything carrying a real column signature is transaction-
    # shaped and stays visible as a flagged orphan.
    lines = [
        _structural_line(100.0),
        _subline(118.0, "FILING STATUS: New"),
        Line(top=143.0, words=(Word("Stray", 101.0), Word("$1,001 - $15,000", 430.0))),
    ]
    candidates = segment_rows(lines, ANCHORS)
    assert len(candidates) == 2
    assert candidates[0].filing_status_text == "New"
    assert {"row_incomplete", "row_orphan"} <= candidates[1].structural_flags()


def test_an_orphan_does_not_steal_an_open_rows_later_wrap_lines():
    # M1-D. A continued page REPRINTS the cap-gains glyph; the duplicate
    # cannot complete the row's already-filled capgains cell, so it opens an
    # orphan. Before the fix that orphan became `open_candidate` and captured
    # the row's REAL wrap line — the asset tail and the second half of a
    # split amount — leaving '$15,001 -' unjoined (measured on 2018/20009671).
    # The orphan is still emitted and still flagged; it just may not steal the
    # continuation context of a row whose block nothing has closed.
    struct = Line(
        top=100.0,
        words=(
            Word("SP", 62.0),
            *(Word(t, 101.0 + 10 * i) for i, t in enumerate("CNO FINL GROUP INC B/E".split())),
            Word("P", 248.0),
            Word("01/05/2026", 313.0),
            Word("01/07/2026", 365.0),
            Word("$15,001 -", 430.0),
            Word("gfedc", 505.0),          # the row's OWN cap-gains glyph
        ),
    )
    lines = [
        struct,
        Line(top=110.5, words=(Word("gfedc", 505.0),)),   # continued page reprints it
        Line(top=121.0, words=(Word("05.250%", 101.0), Word("$50,000", 430.0))),
    ]
    candidates = segment_rows(lines, ANCHORS)
    row = candidates[0]
    assert row.amount_label == "$15,001 - $50,000"
    assert row.asset_text == "CNO FINL GROUP INC B/E 05.250%"
    assert row.structural_flags() == set()
    # the duplicate glyph is still surfaced, never silently dropped
    assert len(candidates) == 2
    assert {"row_incomplete", "row_orphan"} <= candidates[1].structural_flags()


def test_a_closed_block_still_hands_context_to_the_orphan():
    # The M1-D restore is scoped to a row whose block is still OPEN. Once a
    # sub-line closes it, the pre-M1-D behaviour stands unchanged (F4).
    lines = [
        _structural_line(100.0),
        _subline(118.0, "FILING STATUS: New"),
        Line(top=143.0, words=(Word("Stray", 101.0), Word("$1,001 - $15,000", 430.0))),
        _asset_line(153.5, "More Stray Text"),
    ]
    candidates = segment_rows(lines, ANCHORS)
    assert candidates[0].asset_text == "Acme Corp (ACME)"
    orphan = candidates[1]
    assert {"row_incomplete", "row_orphan"} <= orphan.structural_flags()
    # the second stray line continues the ORPHAN, not the closed row
    assert "More Stray Text" in (orphan.asset_text or "")


def test_id_owner_only_line_emitted_incomplete():
    # A structural signal with no transaction columns still opens and emits.
    lines = [
        Line(top=100.0, words=(Word("12", 26.0), Word("SP", 62.0))),
    ]
    candidates = segment_rows(lines, ANCHORS)
    assert len(candidates) == 1
    assert candidates[0].id_cell == "12"
    assert candidates[0].owner_cell == "SP"
    assert "row_incomplete" in candidates[0].structural_flags()
    assert "row_orphan" not in candidates[0].structural_flags()


def test_orphan_candidate_is_emitted_and_defective():
    # A sub-line with no open candidate opens an orphan; it is emitted and
    # (via row_orphan ∈ PARSE_DEFECT_FLAGS) lowers the clean-row rate.
    lines = [_subline(100.0, "DESCRIPTION: stranded comment")]
    candidates = segment_rows(lines, ANCHORS)
    assert len(candidates) == 1
    flags = candidates[0].structural_flags()
    assert {"row_incomplete", "row_orphan"} <= flags
    assert candidates[0].comment_text == "stranded comment"


def test_positioned_amount_fragment_joins_split_cell():
    # pdfplumber also splits amount cells across lines (2020_20017555): the
    # amount-only line is a fragment routed through the completion oracle,
    # never a new row (R24 applied to the positioned path).
    lines = [
        _structural_line(100.0, amount="$50,001 -"),
        Line(top=110.5, words=(Word("$100,000", 430.0),)),
        _subline(128.0, "FILING STATUS: New"),
    ]
    candidates = segment_rows(lines, ANCHORS)
    assert len(candidates) == 1
    assert candidates[0].amount_label == "$50,001 - $100,000"
    assert candidates[0].structural_flags() == set()


def test_positioned_mixed_asset_and_amount_fragment_line():
    # One physical line carrying an asset wrap AND an amount continuation
    # (2020_20013901's "[gS] $100,000"): each cell routes to its own column.
    lines = [
        _structural_line(100.0, asset="uS TREaSuR NT 2.25% 02/20", amount="$50,001 -"),
        Line(top=110.5, words=(Word("[gS]", 101.0), Word("$100,000", 430.0))),
    ]
    candidates = segment_rows(lines, ANCHORS)
    assert len(candidates) == 1
    assert candidates[0].asset_text == "uS TREaSuR NT 2.25% 02/20 [gS]"
    assert candidates[0].amount_label == "$50,001 - $100,000"


def test_positioned_spouse_cap_amount_reassembles():
    # Corpus shape (DocID 20033695): amount cell "Spouse/DC Over" on the
    # structural line, "$1,000,000" on the wrap line beside an asset tag.
    lines = [
        _structural_line(100.0, asset="U.S. Treasury Note due 2/28/2029", amount="Spouse/DC Over"),
        Line(top=110.5, words=(Word("[GS]", 101.0), Word("$1,000,000", 430.0))),
        _subline(128.0, "FILING STATUS: New"),
    ]
    candidates = segment_rows(lines, ANCHORS)
    assert len(candidates) == 1
    assert candidates[0].amount_label == "Spouse/DC Over $1,000,000"
    assert candidates[0].asset_text == "U.S. Treasury Note due 2/28/2029 [GS]"


def test_a_wrapped_comment_tail_continues_its_comment_not_a_new_row():
    # M1-C (docs/build/M1-C-subline-wrap-decision.md) REVERSES the original
    # R7/F4 control, which made this prose tail open a flagged orphan. The
    # 13-year backfill measured that mechanism manufacturing 1,761 phantom
    # transaction rows out of wrapped DESCRIPTION lines, dragging 9 of 14
    # House eras under the 97% gate. A long comment wraps like any other
    # printed line; its tail is comment text, not a disclosure event.
    continuation_words = tuple(
        Word(t, x)
        for t, x in [
            ("advisors.", 101.0), ("I", 150.0), ("have", 160.0), ("no", 185.0),
            ("role", 200.0), ("in", 250.0), ("specific", 320.0),
            ("investment", 370.0), ("decisions", 440.0),
        ]
    )
    lines = [
        _structural_line(100.0),
        _subline(118.0, "DESCRIPTION: All investment decisions related to"),
        Line(top=130.7, words=continuation_words),
        _structural_line(156.0, asset="Second Row Corp (SRC)"),
    ]
    candidates = segment_rows(lines, ANCHORS)
    assert len(candidates) == 2
    assert candidates[0].structural_flags() == set()
    # The tail is kept, joined to the comment it continues — never dropped.
    comment = candidates[0].comment_text or ""
    assert comment.startswith("All investment decisions related to")
    assert "advisors." in comment
    assert candidates[1].asset_text == "Second Row Corp (SRC)"


def test_a_row_shaped_fragment_after_a_comment_still_opens_a_flagged_orphan():
    # The safety condition M1-C rests on, and the property that keeps the
    # original R7/F4 concern intact: a fragment carrying ANY typed cell is
    # row-shaped, so it can never be absorbed into a comment. Measured on
    # an AMOUNT-bearing fragment: the sharpest case, because R24 forbids an
    # amount from opening a row structurally, so only the typed-cell test
    # keeps it out of the comment. It lands in a flagged orphan, visible.
    row_shaped = tuple(
        Word(t, x)
        for t, x in [("FINAL", 101.0), ("PAYMENT", 150.0), ("$1,001 - $15,000", 430.0)]
    )
    lines = [
        _structural_line(100.0),
        _subline(118.0, "DESCRIPTION: a filer comment"),
        Line(top=130.7, words=row_shaped),
        _structural_line(156.0, asset="Second Row Corp (SRC)"),
    ]
    candidates = segment_rows(lines, ANCHORS)
    assert len(candidates) == 3
    assert candidates[0].comment_text == "a filer comment"
    orphan = candidates[1]
    assert {"row_incomplete", "row_orphan"} <= orphan.structural_flags()
    assert candidates[2].asset_text == "Second Row Corp (SRC)"


def test_a_structural_line_closes_the_subline_wrap_window():
    # A row is never a sub-line's tail: once a structural line opens a row,
    # prose that follows is asset continuation on THAT row, so a later
    # comment cannot reach backwards past it.
    lines = [
        _structural_line(100.0),
        _subline(118.0, "DESCRIPTION: a filer comment"),
        _structural_line(143.0, asset="Second Row Corp (SRC)"),
        Line(top=155.7, words=(Word("Series", 101.0), Word("B", 150.0))),
    ]
    candidates = segment_rows(lines, ANCHORS)
    assert len(candidates) == 2
    assert candidates[0].comment_text == "a filer comment"
    assert candidates[1].asset_text == "Second Row Corp (SRC) Series B"
    assert candidates[1].structural_flags() == set()


def test_post_comment_row_shaped_text_opens_its_own_candidate():
    # The failure mode F4 guards: text after a comment that carries real row
    # columns must open a row, not vanish into the comment.
    lines = [
        _structural_line(100.0),
        _subline(118.0, "DESCRIPTION: a filer comment"),
        _structural_line(143.0, asset="Real Row Corp (RRC)"),
    ]
    candidates = segment_rows(lines, ANCHORS)
    assert len(candidates) == 2
    assert candidates[0].comment_text == "a filer comment"
    assert candidates[1].asset_text == "Real Row Corp (RRC)"
    assert candidates[1].structural_flags() == set()


# --- zero-candidate guard (R20, fail-if-removed) -----------------------------


def test_zero_candidates_raise_empty_parse(monkeypatch):
    monkeypatch.setattr(house_ptr, "segment_rows", lambda lines, columns: [])
    with pytest.raises(EmptyParseError):
        parse_ptr(_fixture_bytes("2026_20034916"), doc_id="20034916")


def test_text_fallback_zero_candidates_raise_empty_parse(monkeypatch):
    monkeypatch.setattr(
        house_ptr, "extract_positioned", _raise_unreadable
    )
    monkeypatch.setattr(house_ptr, "segment_text_rows", lambda lines: [])
    with pytest.raises(EmptyParseError):
        parse_ptr(_fixture_bytes("2020_20013901"), doc_id="20013901")


def _raise_unreadable(pdf_bytes):
    raise UnreadablePdfError("injected")


# --- pypdf fallback provenance and boundaries (R22/R23, the F14 test) --------


def _load_golden(stem: str) -> dict:
    return json.loads((FIXTURES / f"{stem}.expected.json").read_text(encoding="utf-8"))


def _disable_pdfplumber(monkeypatch):
    """No pdfplumber output — positioned or text — can serve the parse."""
    import pdfplumber

    def _broken_open(*args, **kwargs):
        raise RuntimeError("pdfplumber disabled by test")

    monkeypatch.setattr(pdfplumber, "open", _broken_open)


def _spy_pypdf_extract_text(monkeypatch):
    import pypdf

    calls: list[dict] = []
    original = pypdf.PageObject.extract_text

    def _recording(self, *args, **kwargs):
        calls.append(dict(kwargs))
        return original(self, *args, **kwargs)

    monkeypatch.setattr(pypdf.PageObject, "extract_text", _recording)
    return calls


def _assert_fallback_matches_golden(parsed, golden):
    assert parsed.path == "text_fallback"
    golden_rows = golden["rows"]
    assert len(parsed.rows) == len(golden_rows)
    assert [r.raw_row["transaction_date"] for r in parsed.rows] == [
        g["raw_row"]["transaction_date"] for g in golden_rows
    ]
    for ptr_row, golden_row in zip(parsed.rows, golden_rows, strict=True):
        assert "text_fallback" in ptr_row.structural_flags
        normalized = normalize_row(
            ptr_row.raw_row,
            filed_date=golden["filing"]["filed_date"],
            cap_gains_cell=ptr_row.cap_gains_cell,
            cap_gains_column_present=parsed.cap_gains_column,
            row_ordinal=ptr_row.row_ordinal,
            source_row_no=ptr_row.source_row_no,
            structural_flags=ptr_row.structural_flags,
        )
        for field in (
            "owner",
            "ticker",
            "side",
            "transaction_date",
            "asset_name",
            "amount_low",
            "amount_high",
        ):
            assert getattr(normalized, field) == golden_row[field], field


def test_pypdf_fallback_provenance_when_pdfplumber_raises(monkeypatch):
    # Both pdfplumber legs disabled + a spy on the pypdf call: the fallback's
    # text can only have come from pypdf layout mode (R23), and its emitted
    # rows match the committed golden's boundaries exactly (R22).
    _disable_pdfplumber(monkeypatch)
    calls = _spy_pypdf_extract_text(monkeypatch)
    parsed = parse_ptr(_fixture_bytes("2020_20013901"), doc_id="20013901")
    layout_calls = [c for c in calls if c.get("extraction_mode") == "layout"]
    assert layout_calls, "fallback never called pypdf in layout mode"
    assert all(
        c.get("layout_mode_space_vertically") is False for c in layout_calls
    )
    _assert_fallback_matches_golden(parsed, _load_golden("2020_20013901"))


def test_pypdf_fallback_on_empty_positioned_words(monkeypatch):
    # Second trigger: positioned extraction "succeeds" but yields no words.
    monkeypatch.setattr(house_ptr, "extract_positioned", lambda data: [[], []])
    parsed = parse_ptr(_fixture_bytes("2020_20013901"), doc_id="20013901")
    _assert_fallback_matches_golden(parsed, _load_golden("2020_20013901"))


def test_fallback_removed_means_unreadable(monkeypatch):
    _disable_pdfplumber(monkeypatch)
    monkeypatch.setattr(
        house_ptr, "extract_pages_pypdf_layout", _raise_unreadable
    )
    with pytest.raises(UnreadablePdfError):
        parse_ptr(_fixture_bytes("2020_20013901"), doc_id="20013901")


def test_classifier_text_is_not_the_parsers_source():
    # R23 static guarantee: the fallback parser's text source is the
    # dedicated pypdf layout extractor, not the classifier's extract_pages.
    import inspect

    fallback_source = inspect.getsource(house_ptr._parse_text_fallback)
    assert "extract_pages_pypdf_layout" in fallback_source
    assert "extract_pages(" not in fallback_source
    layout_source = inspect.getsource(house_ptr.extract_pages_pypdf_layout)
    assert "import pdfplumber" not in layout_source
    assert "from pypdf import PdfReader" in layout_source
    assert 'extraction_mode="layout"' in layout_source
    assert "layout_mode_space_vertically=False" in layout_source


# --- wrapped-cell continuation, text path (R24) ------------------------------


def test_text_split_amount_reassembles_on_real_fixture(monkeypatch):
    # Layout mode splits "$50,001 - $100,000" across lines on 2020_20013901
    # (T3a evidence); the fallback rejoins it to the exact Appendix C label.
    monkeypatch.setattr(house_ptr, "extract_positioned", _raise_unreadable)
    parsed = parse_ptr(_fixture_bytes("2020_20013901"), doc_id="20013901")
    labels = [r.raw_row["amount_label"] for r in parsed.rows]
    assert labels == [
        "$1,001 - $15,000",
        "$50,001 - $100,000",
        "$50,001 - $100,000",
        "$1,001 - $15,000",
    ]


STRUCTURAL_TEXT = (
    "SP   Alphabet Inc. Class A (GOOGL)   P   06/15/2026   06/15/2026   $50,001 - $100,000"
)


def test_amount_fragment_after_closed_block_opens_orphan():
    lines = [
        "SP   Acme Corp (ACME)   P   01/05/2026   01/07/2026   $50,001 -",
        "FILING STATUS: New",
        "$100,000",
    ]
    candidates = segment_text_rows(lines)
    assert len(candidates) == 2
    assert candidates[0].amount_label == "$50,001 -"
    assert candidates[1].amount_label == "$100,000"
    assert {"row_incomplete", "row_orphan"} <= candidates[1].structural_flags()


def test_noncompleting_fragment_with_no_open_block_is_orphan():
    candidates = segment_text_rows(["$100,000"])
    assert len(candidates) == 1
    assert candidates[0].amount_label == "$100,000"
    assert {"row_incomplete", "row_orphan"} <= candidates[0].structural_flags()


# --- typed-fragment routing (R25/LD28, the F15 negative control) -------------


def test_amount_fragment_never_contaminates_open_asset_cell():
    # OPEN row block (no intervening sub-line) — exactly the state the prior
    # design mishandled. The fragment cannot complete the (already complete)
    # amount cell, so it opens a flagged orphan carrying the fragment in
    # raw_row's amount cell; the prior candidate is byte-identical.
    candidates = segment_text_rows([STRUCTURAL_TEXT, "$100,000"])
    assert len(candidates) == 2
    assert candidates[0].asset_text == "Alphabet Inc. Class A (GOOGL)"
    assert candidates[0].amount_label == "$50,001 - $100,000"
    assert candidates[1].amount_label == "$100,000"
    assert candidates[1].asset_text is None
    assert {"row_incomplete", "row_orphan"} <= candidates[1].structural_flags()
    assert all("$" not in (c.asset_text or "") for c in candidates)


def test_garbled_amount_fragment_over_incomplete_cell_still_orphans():
    # The open candidate's amount cell is incomplete; the garbled fragment's
    # join is attempted, fails to parse, and still opens the orphan rather
    # than contaminating the asset cell.
    lines = [
        "SP   Alphabet Inc. Class A (GOOGL)   P   06/15/2026   06/15/2026   $50,001 -",
        "$100,00X",
    ]
    candidates = segment_text_rows(lines)
    assert len(candidates) == 2
    assert candidates[0].asset_text == "Alphabet Inc. Class A (GOOGL)"
    assert candidates[0].amount_label == "$50,001 -"
    assert candidates[1].amount_label == "$100,00X"
    assert candidates[1].asset_text is None
    assert {"row_incomplete", "row_orphan"} <= candidates[1].structural_flags()
    assert all("$" not in (c.asset_text or "") for c in candidates)


def test_untyped_fragment_with_open_block_still_continues_asset():
    # The fix must not disable legitimate asset continuation. (Text-path
    # candidates always carry text_fallback — a declared defect, LD23.)
    candidates = segment_text_rows([STRUCTURAL_TEXT, "Common Stock [ST]"])
    assert len(candidates) == 1
    assert candidates[0].asset_text == "Alphabet Inc. Class A (GOOGL) Common Stock [ST]"
    assert candidates[0].structural_flags() == {"text_fallback"}


def test_incomplete_amount_cell_joins_fragment_text_path():
    lines = [
        "SP   Acme Corp (ACME)   P   01/05/2026   01/07/2026   $50,001 -",
        "$100,000",
    ]
    candidates = segment_text_rows(lines)
    assert len(candidates) == 1
    assert candidates[0].amount_label == "$50,001 - $100,000"


# --- golden corpus (R6/R11) --------------------------------------------------


@pytest.mark.parametrize("stem", EFILE_FIXTURES)
def test_golden_round_trip(stem):
    golden_path = FIXTURES / f"{stem}.expected.json"
    payload = build_golden_payload(stem)
    if os.environ.get("UPDATE_GOLDENS") == "1":
        golden_path.write_text(
            json.dumps(payload, indent=2, ensure_ascii=False) + "\n",
            encoding="utf-8",
        )
    assert golden_path.exists(), f"golden missing: run UPDATE_GOLDENS=1 for {stem}"
    assert payload == json.loads(golden_path.read_text(encoding="utf-8"))


def test_goldens_and_fixtures_are_one_to_one():
    goldens = {p.stem.removesuffix(".expected") for p in FIXTURES.glob("*.expected.json")}
    assert goldens == set(EFILE_FIXTURES)


def test_goldens_all_come_from_the_positioned_path():
    for stem in EFILE_FIXTURES:
        golden = _load_golden(stem)
        assert golden["filing"]["parse_path"] == "positioned", stem


def test_2015_goldens_have_no_capgains_column():
    # Older-layout tolerance (OQ-6): absent Cap-Gains column ⇒ NULL, no flag.
    for stem in (s for s in EFILE_FIXTURES if s.startswith("2015")):
        golden = _load_golden(stem)
        for row in golden["rows"]:
            assert row["cap_gains_over_200"] is None, stem
            assert "capgains_unparsed" not in row["flags"], stem


def test_multipage_fixture_row_count():
    # 2015_20003021 spans two pages with wrapped asset cells and repeated
    # column headers; the same asset (CTSH) appears as three distinct rows.
    golden = _load_golden("2015_20003021")
    assert len(golden["rows"]) == 13
    ctsh = [r for r in golden["rows"] if r["ticker"] == "CTSH"]
    assert [r["transaction_date"] for r in ctsh] == [
        "2015-03-30",
        "2015-04-14",
        "2015-04-16",
    ]


def test_corpus_date_anomaly_is_kept_and_flagged():
    # Real source fact: 2015_20002703's TPH Partners row was filed 2015-03-11
    # against a printed transaction date of 03/18/2015.
    golden = _load_golden("2015_20002703")
    anomalies = [r for r in golden["rows"] if "date_anomaly" in r["flags"]]
    assert len(anomalies) == 1
    assert anomalies[0]["days_to_file"] == -7
    assert anomalies[0]["is_late"] == 0


def test_capgains_checked_rows_in_2020_16556():
    # Visual truth anchor for LD11: 2020_20016556 mixes checked (gfedcb) and
    # unchecked (gfedc) cap-gains boxes.
    golden = _load_golden("2020_20016556")
    checked = [r for r in golden["rows"] if r["cap_gains_over_200"] == 1]
    unchecked = [r for r in golden["rows"] if r["cap_gains_over_200"] == 0]
    assert checked and unchecked
    assert len(checked) + len(unchecked) == len(golden["rows"])


# --- flag-vocabulary sweep (R21) ---------------------------------------------


def test_every_emitted_flag_is_known_across_corpus():
    emitted: set[str] = set()
    for stem in EFILE_FIXTURES:
        payload = build_golden_payload(stem)
        for row in payload["rows"]:
            emitted.update(row["flags"])
    # Synthetic defect cases funnel through normalize_row (see
    # tests/test_normalize.py); here the whole real corpus is swept.
    assert emitted <= KNOWN_FLAGS
