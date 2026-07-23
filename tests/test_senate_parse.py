"""Senate eFD PTR parser: structure/edge units, golden corpus, paper pages
(RUN 3; R6/R7/R11/R12).

Golden hand-verification (R12): the expected JSON for **ptr_a5fdbba4…**
(Sen. Fetterman's child-owned corporate-bond filing) was verified row-by-row
against the committed HTML — owner, ticker ``--``, both asset
representations (lossless raw incl. Rate/Coupon and Matures vs the clean
display), side, date, amount, comment — and those assertions are encoded
explicitly below, not only via golden bytes. The 851 KB / 703-row filing
asserts its declared total, the exact descending ``#`` sequence, and
first/midpoint/last coordinate pairs. Regenerate goldens with
``UPDATE_GOLDENS=1 uv run pytest``.
"""

from __future__ import annotations

import json
import os
import unicodedata
from pathlib import Path

import pytest

from populus.ingest import senate
from populus.ingest.senate import evaluate_page
from populus.normalize import KNOWN_FLAGS, has_parse_defect, normalize_row
from populus.parse.senate_ptr import (
    EXPECTED_HEADER,
    PARSER_VERSION,
    HeaderMismatchError,
    MissingTableError,
    parse_ptr_page,
)

FIXTURES = Path(__file__).parent / "fixtures" / "senate"

# Filed dates from the cached eFD index (data-cache/senate/ptr-index.json),
# recorded once at golden-authoring time so the goldens do not depend on the
# uncommitted data-cache. Note two title-date ≠ filed-date cases (McCormick
# ff0b0573: title 06/27 filed 06/26; 5245bd7a: title 05/29 filed 05/28).
FIXTURE_FILED_DATES = {
    "ptr_029f67f3-121a-406c-bddf-a9a7e7d6267b": "2026-05-07",
    "ptr_40fbe259-f282-4982-a53f-1c7278d041cd": "2026-07-02",
    "ptr_4aa0094d-d9da-4a05-aa13-6d9f5d376105": "2026-06-02",
    "ptr_4f4d76c6-52ab-4edb-884d-b6c43e7b1bbe": "2026-07-06",
    "ptr_5245bd7a-a8b7-4d3e-8fb1-f563322da8f8": "2026-05-28",
    "ptr_a5fdbba4-9c67-4002-b931-1cd910ce590d": "2026-07-09",
    "ptr_fda235b3-bad7-4637-8fa1-053f354d929c": "2026-07-21",
    "ptr_ff0b0573-2809-40ae-8197-4b26648e9027": "2026-06-26",
}
PAPER_FILED_DATES = {
    "paper_3a4c5095-028a-4614-a692-836719da4e63": "2026-07-17",
    "paper_a0d25e8f-fe54-4328-a7ea-504da008742b": "2026-06-08",
    "paper_d02263c3-381d-4ee9-8d84-2c44d9baa59e": "2026-05-19",
}

EFILE_FIXTURES = sorted(FIXTURE_FILED_DATES)
PAPER_FIXTURES = sorted(PAPER_FILED_DATES)

BOND = "ptr_a5fdbba4-9c67-4002-b931-1cd910ce590d"
LARGE = "ptr_fda235b3-bad7-4637-8fa1-053f354d929c"


def _fixture_bytes(stem: str) -> bytes:
    return (FIXTURES / f"{stem}.html").read_bytes()


def _uuid(stem: str) -> str:
    return stem.split("_", 1)[1]


def build_golden_payload(stem: str) -> dict:
    """Parse + normalize one e-file fixture into the golden JSON shape."""
    parsed = parse_ptr_page(_fixture_bytes(stem), uuid=_uuid(stem))
    filed_date = FIXTURE_FILED_DATES[stem]
    rows = []
    any_defect = False
    for page_row in parsed.rows:
        normalized = normalize_row(
            page_row.raw_row,
            filed_date=filed_date,
            cap_gains_cell=None,
            cap_gains_column_present=False,
            row_ordinal=page_row.row_ordinal,
            source_row_no=page_row.source_row_no,
            structural_flags=page_row.structural_flags,
            asset_display_cell=page_row.raw_asset_display,
            asset_type_cell=page_row.asset_type_cell,
        )
        any_defect = any_defect or has_parse_defect(normalized.flags)
        rows.append(
            {
                "raw_row": dict(page_row.raw_row),
                "raw_asset_display": page_row.raw_asset_display,
                "asset_type_cell": page_row.asset_type_cell,
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
    declared_mismatch = (
        parsed.declared_total is not None and parsed.declared_total != len(rows)
    )
    return {
        "filing": {
            "uuid": _uuid(stem),
            "parse_status": "partial" if any_defect or declared_mismatch else "parsed",
            "declared_total": parsed.declared_total,
            "title": parsed.title,
            "filer_display": parsed.filer_display,
            "filed_date": filed_date,
        },
        "rows": rows,
    }


# --- synthetic page builders (structure/edge units) ---------------------------


def _cells(
    *,
    number="1",
    txn_date="06/29/2026",
    owner="Self",
    ticker="T",
    asset="AT&amp;T Inc.",
    asset_type="Stock",
    side="Purchase",
    amount="$1,001 - $15,000",
    comment="--",
) -> str:
    return (
        f"<tr><td>{number}</td><td>{txn_date}</td><td>{owner}</td>"
        f"<td>{ticker}</td><td>{asset}</td><td>{asset_type}</td>"
        f"<td>{side}</td><td>{amount}</td><td>{comment}</td></tr>"
    )


def _page(
    rows_html: str,
    *,
    header: tuple[str, ...] = EXPECTED_HEADER,
    declared: str | None = "(1 transaction total)",
    card_class: str = "card",
) -> bytes:
    header_html = "".join(f'<th scope="col">{h}</th>' for h in header)
    declared_html = (
        f'<ul><li class="list-inline-item">{declared}</li></ul>' if declared else ""
    )
    return (
        '<html><head><meta charset="utf-8"></head><body><main>'
        f'<section class="{card_class}"><div class="card-body">'
        f"{declared_html}"
        f"<table><thead><tr>{header_html}</tr></thead>"
        f"<tbody>{rows_html}</tbody></table>"
        "</div></section></main></body></html>"
    ).encode("utf-8")


def _evaluate(html: bytes, *, filed_date="2026-07-01", amendment=False):
    return evaluate_page(
        html, uuid="test-uuid", kind="ptr", filed_date=filed_date, amendment=amendment
    )


# --- structure errors (R6, fail-loud) -----------------------------------------


def test_missing_table_raises():
    with pytest.raises(MissingTableError):
        parse_ptr_page(b"<html><body><p>no table</p></body></html>", uuid="u")


def test_table_outside_section_card_is_missing():
    # The transactions table is located under section.card specifically —
    # an unrelated table elsewhere must not be mis-parsed as transactions.
    html = (
        "<html><body><table><thead><tr><th>Other</th></tr></thead>"
        "<tbody></tbody></table></body></html>"
    ).encode()
    with pytest.raises(MissingTableError):
        parse_ptr_page(html, uuid="u")


def test_header_drift_raises():
    drifted = ("#", "Date", "Owner", "Ticker", "Asset Name", "Asset Type",
               "Type", "Amount", "Comment")
    with pytest.raises(HeaderMismatchError):
        parse_ptr_page(_page(_cells(), header=drifted), uuid="u")


def test_extra_header_column_raises():
    with pytest.raises(HeaderMismatchError):
        parse_ptr_page(
            _page(_cells(), header=EXPECTED_HEADER + ("Extra",)), uuid="u"
        )


def test_structure_errors_map_to_distinct_failed_kinds():
    missing = _evaluate(b"<html><body></body></html>")
    assert (missing.status, missing.failure_kind) == ("failed", "missing_table")
    drifted = _evaluate(_page(_cells(), header=EXPECTED_HEADER[:-1] + ("Notes",)))
    assert (drifted.status, drifted.failure_kind) == ("failed", "header_mismatch")


# --- raw extraction (R6/LD3) --------------------------------------------------


def test_raw_row_has_exactly_the_seven_identity_keys():
    parse = parse_ptr_page(_page(_cells()), uuid="u")
    assert set(parse.rows[0].raw_row) == {
        "owner", "asset_name", "ticker", "side",
        "transaction_date", "amount_label", "comment",
    }


def test_raw_cells_are_untouched_not_collapsed():
    row_html = (
        "<tr><td>1</td><td>\n  06/29/2026\n </td><td>Self</td><td>T</td>"
        "<td>AT&amp;T  Inc.</td><td>Stock</td><td>Purchase</td>"
        "<td>$1,001 - $15,000</td><td>--</td></tr>"
    )
    parse = parse_ptr_page(_page(row_html), uuid="u")
    raw = parse.rows[0].raw_row
    # Exact text content: entity decoded, internal double space preserved,
    # surrounding whitespace preserved — NFC only, nothing else.
    assert raw["transaction_date"] == "\n  06/29/2026\n "
    assert raw["asset_name"] == "AT&T  Inc."


def test_whitespace_only_cell_is_null():
    parse = parse_ptr_page(_page(_cells(ticker="\n   \n")), uuid="u")
    assert parse.rows[0].raw_row["ticker"] is None


def test_nfc_applied_at_extraction():
    decomposed = "Nestlé S.A."  # e + combining acute
    parse = parse_ptr_page(_page(_cells(asset=decomposed)), uuid="u")
    raw = parse.rows[0].raw_row["asset_name"]
    assert raw == unicodedata.normalize("NFC", decomposed)
    assert "́" not in raw  # composed é, not e + combining mark


def test_bond_annotation_retained_in_raw_and_excluded_from_display():
    asset = (
        "\n  EVERSOURCE ENERGY SER A NOTE\n"
        '  <div class="text-muted"><em>Rate/Coupon:</em> 6.1%<br> '
        "<em>Matures:</em> 2056-08-15</div>\n"
    )
    parse = parse_ptr_page(_page(_cells(asset=asset)), uuid="u")
    row = parse.rows[0]
    assert "Rate/Coupon: 6.1%" in " ".join(row.raw_row["asset_name"].split())
    assert "Matures: 2056-08-15" in " ".join(row.raw_row["asset_name"].split())
    assert row.raw_asset_display == "EVERSOURCE ENERGY SER A NOTE"


def test_bonds_differing_only_by_coupon_have_distinct_raw_rows():
    # LD3's point: lossless raw identity cannot conflate two bonds whose
    # only difference is the muted annotation.
    coupon_a = _cells(asset='X Note<div class="text-muted">Rate/Coupon: 4.5%</div>')
    coupon_b = _cells(asset='X Note<div class="text-muted">Rate/Coupon: 6.1%</div>')
    row_a = parse_ptr_page(_page(coupon_a), uuid="u").rows[0]
    row_b = parse_ptr_page(_page(coupon_b), uuid="u").rows[0]
    assert row_a.raw_row != row_b.raw_row
    assert row_a.raw_asset_display == row_b.raw_asset_display == "X Note"


# --- source_row_no (R6/LD15) --------------------------------------------------


def test_source_row_no_from_number_column():
    parse = parse_ptr_page(
        _page(_cells(number="17"), declared="(1 transaction total)"), uuid="u"
    )
    row = parse.rows[0]
    assert row.source_row_no == 17
    assert row.row_ordinal == 1
    assert row.structural_flags == frozenset()


@pytest.mark.parametrize("bad", ["x", "1a", "1.5", "-3", "0", "  "])
def test_non_positive_number_cell_is_a_visible_parse_defect(bad):
    parse = parse_ptr_page(_page(_cells(number=bad)), uuid="u")
    row = parse.rows[0]
    assert row.source_row_no is None
    assert "source_row_no_unparsed" in row.structural_flags
    evaluated = _evaluate(_page(_cells(number=bad)))
    assert evaluated.status == "partial"
    assert has_parse_defect(evaluated.rows[0].flags)


def test_short_row_is_incomplete_with_null_missing_cells():
    parse = parse_ptr_page(
        _page("<tr><td>1</td><td>06/29/2026</td></tr>", declared=None), uuid="u"
    )
    row = parse.rows[0]
    assert "row_incomplete" in row.structural_flags
    assert "source_row_no_unparsed" not in row.structural_flags
    assert row.source_row_no == 1
    assert row.raw_row["owner"] is None
    assert row.raw_row["asset_name"] is None
    assert row.raw_asset_display is None
    assert row.asset_type_cell is None
    evaluated = _evaluate(_page("<tr><td>1</td><td>06/29/2026</td></tr>", declared=None))
    assert evaluated.status == "partial"


# --- declared total (LD7) -----------------------------------------------------


def test_declared_total_plural_form():
    html = _page(_cells() + _cells(number="2"), declared="(2 transactions total)")
    parse = parse_ptr_page(html, uuid="u")
    assert parse.declared_total == 2
    assert _evaluate(html).status == "parsed"


def test_declared_total_singular_form():
    parse = parse_ptr_page(_page(_cells(), declared="(1 transaction total)"), uuid="u")
    assert parse.declared_total == 1


def test_declared_total_absent_is_none_and_not_a_mismatch():
    html = _page(_cells(), declared=None)
    assert parse_ptr_page(html, uuid="u").declared_total is None
    evaluated = _evaluate(html)
    assert evaluated.status == "parsed"
    assert evaluated.declared_mismatch is False


def test_declared_count_mismatch_makes_filing_partial():
    # The truncation guard: a declared total disagreeing with the emitted
    # row count can never pass silently as parsed.
    html = _page(_cells(), declared="(2 transactions total)")
    evaluated = _evaluate(html)
    assert evaluated.status == "partial"
    assert evaluated.declared_mismatch is True
    assert evaluated.declared_total == 2
    assert evaluated.total_rows == 1
    # No row-level defect: the mismatch alone drives the status.
    assert all(not has_parse_defect(r.flags) for r in evaluated.rows)


# --- comments -----------------------------------------------------------------


def test_dashes_comment_raw_kept_normalized_null():
    evaluated = _evaluate(_page(_cells(comment="--")))
    assert evaluated.rows[0].raw_row["comment"] == "--"
    assert evaluated.rows[0].comment is None


def test_long_free_text_comment_preserved():
    text = (
        "Sale of exercised stock option; strike price $77.68; expires"
        " 12/13/2030."
    )
    evaluated = _evaluate(_page(_cells(comment=text)))
    assert evaluated.rows[0].raw_row["comment"] == text
    assert evaluated.rows[0].comment == text


# --- paper pages (R7/G3) ------------------------------------------------------


@pytest.mark.parametrize("stem", PAPER_FIXTURES)
def test_paper_fixture_needs_ocr_zero_rows_parser_never_invoked(stem, monkeypatch):
    def _never(*args, **kwargs):
        raise AssertionError("the e-file parser must not run on a paper page")

    monkeypatch.setattr(senate, "parse_ptr_page", _never)
    evaluated = evaluate_page(
        _fixture_bytes(stem),
        uuid=_uuid(stem),
        kind="paper",
        filed_date=PAPER_FILED_DATES[stem],
        amendment=False,
    )
    assert evaluated.status == "needs_ocr"
    assert evaluated.rows == ()
    assert evaluated.total_rows == 0
    assert evaluated.efile is False


# --- golden corpus (R12) ------------------------------------------------------


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
    assert len(EFILE_FIXTURES) == 8
    assert len(PAPER_FIXTURES) == 3


def _load_golden(stem: str) -> dict:
    return json.loads((FIXTURES / f"{stem}.expected.json").read_text(encoding="utf-8"))


def test_all_committed_efile_goldens_are_parsed():
    for stem in EFILE_FIXTURES:
        golden = _load_golden(stem)
        assert golden["filing"]["parse_status"] == "parsed", stem
        assert golden["filing"]["declared_total"] == len(golden["rows"]), stem


def test_parser_version_constant():
    assert PARSER_VERSION == "senate-ptr-1.0.0"


# --- the hand-verified bond filing (R12, Fetterman ptr_a5fdbba4…) -------------


def test_bond_filing_hand_verified():
    """Verified row-by-row against the committed HTML: three child-owned
    corporate-bond rows printed in # order 3-2-1, ticker ``--``, comment
    ``--``, both asset representations pinned."""
    parsed = parse_ptr_page(_fixture_bytes(BOND), uuid=_uuid(BOND))
    evaluated = evaluate_page(
        _fixture_bytes(BOND),
        uuid=_uuid(BOND),
        kind="ptr",
        filed_date=FIXTURE_FILED_DATES[BOND],
        amendment=False,
    )
    assert evaluated.status == "parsed"
    assert parsed.declared_total == 3 == len(parsed.rows)
    assert parsed.title == "Periodic Transaction Report for 07/09/2026"

    # Printed order 3-2-1 → row_ordinal 1..3 with source_row_no 3/2/1.
    assert [r.row_ordinal for r in evaluated.rows] == [1, 2, 3]
    assert [r.source_row_no for r in evaluated.rows] == [3, 2, 1]

    expected = [
        # (clean asset display, coupon, matures, side)
        ("Cheniere Energy Partners L P Note", "4.5%", "2029-10-01", "sale"),
        ("NISOURCE INC NOTE", "6.95%", "2054-11-30", "purchase"),
        ("EVERSOURCE ENERGY SER A NOTE", "6.1%", "2056-08-15", "purchase"),
    ]
    for row, (display, coupon, matures, side) in zip(
        evaluated.rows, expected, strict=True
    ):
        # Raw asset text is lossless: the printed Rate/Coupon and Matures
        # annotation is INSIDE raw_row.asset_name (LD3) …
        collapsed_raw = " ".join(row.raw_row["asset_name"].split())
        assert collapsed_raw == f"{display} Rate/Coupon: {coupon} Matures: {matures}"
        # … while the normalized asset_name is the clean collapsed display.
        assert row.asset_name == display
        assert row.asset_type == "Corporate Bond"
        assert row.side == side
        assert row.owner == "child"
        # Ticker prints the literal '--' (inside the cell's whitespace) →
        # NULL + missing_ticker; comment '--' → NULL with raw kept.
        assert row.raw_row["ticker"].strip() == "--"
        assert row.ticker is None
        assert row.raw_row["comment"] == "--"
        assert row.comment is None
        assert (row.amount_low, row.amount_high) == (1_001, 15_000)
        assert row.amount_label == "$1,001 - $15,000"
        assert row.flags == ["missing_ticker"]
        assert not has_parse_defect(row.flags)

    # Dates: #3 sold 06/24/2026, #2 and #1 bought 06/16/2026; filed 07/09.
    assert [r.transaction_date for r in evaluated.rows] == [
        "2026-06-24", "2026-06-16", "2026-06-16",
    ]
    assert [r.days_to_file for r in evaluated.rows] == [15, 23, 23]
    assert [r.is_late for r in evaluated.rows] == [0, 0, 0]


# --- the 851 KB / 703-row filing (R12, Armstrong ptr_fda235b3…) ---------------


def test_large_filing_exact_sequence_and_spot_checks():
    parsed = parse_ptr_page(_fixture_bytes(LARGE), uuid=_uuid(LARGE))
    assert parsed.declared_total == 703 == len(parsed.rows)

    # The exact descending printed sequence 703…1 — stronger than any
    # universal inequality, and true at the midpoint where ordinal == #.
    assert [r.source_row_no for r in parsed.rows] == list(range(703, 0, -1))

    # Explicit coordinate pairs: (ordinal 1 → source 703),
    # (ordinal 352 → source 352), (ordinal 703 → source 1).
    assert (parsed.rows[0].row_ordinal, parsed.rows[0].source_row_no) == (1, 703)
    assert (parsed.rows[351].row_ordinal, parsed.rows[351].source_row_no) == (352, 352)
    assert (parsed.rows[702].row_ordinal, parsed.rows[702].source_row_no) == (703, 1)

    evaluated = evaluate_page(
        _fixture_bytes(LARGE),
        uuid=_uuid(LARGE),
        kind="ptr",
        filed_date=FIXTURE_FILED_DATES[LARGE],
        amendment=False,
    )
    assert evaluated.status == "parsed"
    assert evaluated.total_rows == 703

    first, last = evaluated.rows[0], evaluated.rows[702]
    assert first.ticker == "UHS"
    assert first.asset_name == "Universal Health Services, Inc. Common Stock"
    assert first.transaction_date == "2026-03-27"
    assert first.owner == "self"
    assert first.side == "purchase"
    assert first.amount_label == "$1,001 - $15,000"

    assert last.ticker == "DVN"
    assert last.asset_name == "Devon Energy Corporation Common Stock"
    assert last.transaction_date == "2026-03-24"
    assert last.owner == "self"
    assert last.side == "sale"
    assert last.amount_label == "$50,001 - $100,000"
    assert (last.amount_low, last.amount_high) == (50_001, 100_000)


# --- flag-vocabulary sweep ----------------------------------------------------


def test_every_emitted_flag_is_known_across_corpus():
    emitted: set[str] = set()
    for stem in EFILE_FIXTURES:
        payload = build_golden_payload(stem)
        for row in payload["rows"]:
            emitted.update(row["flags"])
    assert emitted <= KNOWN_FLAGS
