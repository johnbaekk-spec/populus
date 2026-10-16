"""Normalization maps (R8–R10), the locked flag taxonomy (R21/LD25), the
missing-asset sentinel (LD18), cap-gains cases (LD11), and the R24
amount-completion oracle asymmetry."""

from __future__ import annotations

import pytest

from populus.load import ParsedRow
from populus.normalize import (
    KNOWN_FLAGS,
    NORMALIZATION_VERSION,
    PARSE_DEFECT_FLAGS,
    SOURCE_FACT_FLAGS,
    TICKER_FLAGS,
    UNPARSED_ASSET_SENTINEL,
    has_parse_defect,
    normalize_amount,
    normalize_asset,
    normalize_capgains,
    normalize_comment,
    normalize_dates,
    normalize_owner,
    normalize_row,
    normalize_side,
    normalize_ticker,
    ticker_from_raw_row,
    ticker_legs,
)

# --- flag taxonomy (R21) -----------------------------------------------------


def test_flag_sets_are_disjoint():
    assert PARSE_DEFECT_FLAGS.isdisjoint(SOURCE_FACT_FLAGS)


def test_known_flags_exact_membership():
    assert PARSE_DEFECT_FLAGS == {
        "side_unparsed",
        "owner_unparsed",
        "amount_unparsed",
        "date_missing",
        "asset_unparsed",
        "capgains_unparsed",
        "row_incomplete",
        "row_orphan",
        "text_fallback",
        "source_row_no_unparsed",
        "declared_total_mismatch",
        # Senate exchange legs: a ticker cell no token rule reads.
        "ticker_unparsed",
    }
    assert SOURCE_FACT_FLAGS == {
        "missing_ticker",
        "amount_spouse_cap",
        "date_anomaly",
        "amendment_unresolved",
        "declared_total_verified",
    }
    assert KNOWN_FLAGS == PARSE_DEFECT_FLAGS | SOURCE_FACT_FLAGS


@pytest.mark.parametrize("flag", sorted(PARSE_DEFECT_FLAGS))
def test_every_defect_flag_is_a_parse_defect(flag):
    assert has_parse_defect([flag]) is True


@pytest.mark.parametrize("flag", sorted(SOURCE_FACT_FLAGS))
def test_source_facts_alone_are_not_defects(flag):
    assert has_parse_defect([flag]) is False


def test_has_parse_defect_truth_table():
    assert has_parse_defect([]) is False
    assert has_parse_defect(["missing_ticker", "date_anomaly"]) is False
    assert has_parse_defect(["missing_ticker", "capgains_unparsed"]) is True
    assert has_parse_defect(["text_fallback"]) is True


# --- side / owner (R8) -------------------------------------------------------


@pytest.mark.parametrize(
    "raw,expected",
    [
        ("P", "purchase"),
        ("S", "sale"),
        ("S (partial)", "sale_partial"),
        ("s (partial)", "sale_partial"),
        ("E", "exchange"),
        # Senate eFD printed labels (RUN 3).
        ("Purchase", "purchase"),
        ("Sale (Full)", "sale"),
        ("Sale (Partial)", "sale_partial"),
        ("Exchange", "exchange"),
    ],
)
def test_side_map(raw, expected):
    side, flags = normalize_side(raw)
    assert side == expected
    assert flags == frozenset()


@pytest.mark.parametrize("raw", ["X", "SALE", None])
def test_unknown_side_is_other_flagged(raw):
    side, flags = normalize_side(raw)
    assert side == "other"
    assert flags == {"side_unparsed"}


@pytest.mark.parametrize(
    "raw,expected",
    [
        ("SP", "spouse"),
        ("DC", "child"),
        ("JT", "joint"),
        ("self", "self"),
        # Senate eFD printed labels (RUN 3).
        ("Self", "self"),
        ("Spouse", "spouse"),
        ("Child", "child"),
        ("Joint", "joint"),
    ],
)
def test_owner_map(raw, expected):
    owner, flags = normalize_owner(raw)
    assert owner == expected
    assert flags == frozenset()


def test_blank_owner_is_null_unflagged():
    # LD5: an empty owner cell is a legitimate self-implied blank.
    assert normalize_owner(None) == (None, frozenset())
    assert normalize_owner("  ") == (None, frozenset())


def test_unknown_owner_token_flagged():
    owner, flags = normalize_owner("ZZ")
    assert owner is None
    assert flags == {"owner_unparsed"}


# --- ticker (R8) -------------------------------------------------------------


def test_ticker_uppercased():
    assert normalize_ticker("RdS.b") == ("RDS.B", frozenset())


@pytest.mark.parametrize("raw", [None, "", "  ", "--"])
def test_ticker_missing_forms(raw):
    ticker, flags = normalize_ticker(raw)
    assert ticker is None
    assert flags == {"missing_ticker"}


# --- Senate exchange legs ------------------------------------------------------

# The exact `raw_row` the live Wyden exchange row stores (senate:5ecc9b5c…,
# build 20260817.1): the eFD ticker cell prints `--` (BERY is not linked), a
# <br/>, then the AMCR link, and text_content() keeps every newline and the
# indentation between them. The pre-fix normalizer stripped only the outer
# whitespace and published `--` + newlines + spaces + `AMCR` as the ticker.
WYDEN_TICKER_CELL = (
    "\n" + " " * 40 + "\n" + " " * 44 + "--\n" + " " * 40 + "\n" + " " * 40 + "\n"
    + " " * 44 + "\n" + " " * 44 + "AMCR\n" + " " * 40 + "\n" + " " * 36
)
WYDEN_RAW_ROW = {
    "amount_label": "$100,001 - $250,000",
    "asset_name": "BERY - Berry Global Group, Inc. (Exchanged) Amcor plc Ordinary Shares (Received)",
    "comment": "--",
    "owner": "Spouse",
    "side": "Exchange",
    "ticker": WYDEN_TICKER_CELL,
    "transaction_date": "04/30/2025",
}
# The Hagerty exchange (senate:f60cfac8…): both legs linked, ETRN then EQT.
HAGERTY_TICKER_CELL = WYDEN_TICKER_CELL.replace("--", "ETRN").replace("AMCR", "EQT")


def test_the_live_wyden_cell_shape_is_the_one_measured():
    # The constant really is the stored shape: `--` and AMCR on separate
    # lines, with interior newlines and runs of spaces.
    assert WYDEN_TICKER_CELL.split() == ["--", "AMCR"]
    assert WYDEN_TICKER_CELL.strip() != "AMCR" and "\n" in WYDEN_TICKER_CELL.strip()


@pytest.mark.parametrize(
    "raw, expected",
    [
        # received leg is `ticker`; a `--` exchanged leg is NULL, unflagged
        (WYDEN_TICKER_CELL, ("AMCR", None, frozenset())),
        # both legs linked
        (HAGERTY_TICKER_CELL, ("EQT", "ETRN", frozenset())),
        ("etrn eqt", ("EQT", "ETRN", frozenset())),
        # a `--` received leg: no ticker (flagged), the exchanged leg kept,
        # never a fallback to it
        ("BERY --", (None, "BERY", frozenset({"missing_ticker"}))),
        # both legs unlinked
        ("-- --", (None, None, frozenset({"missing_ticker"}))),
        # the caret symbols eFD prints stay verbatim (owner: preserved)
        ("MPLX ^MWE", ("^MWE", "MPLX", frozenset())),
        # one-token exchange cells keep today's result, no exchanged leg
        ("ANCX", ("ANCX", None, frozenset())),
        ("--", (None, None, frozenset({"missing_ticker"}))),
        (None, (None, None, frozenset({"missing_ticker"}))),
        # three tokens: no rule reads it — never the joined text
        ("-- -- --", (None, None, frozenset({"ticker_unparsed"}))),
        ("A B C", (None, None, frozenset({"ticker_unparsed"}))),
    ],
)
def test_exchange_ticker_legs(raw, expected):
    assert ticker_legs(raw, exchange=True) == expected


@pytest.mark.parametrize(
    "raw, expected",
    [
        ("rds.b", ("RDS.B", None, frozenset())),
        ("  WMB  ", ("WMB", None, frozenset())),
        ("--", (None, None, frozenset({"missing_ticker"}))),
        ("   ", (None, None, frozenset({"missing_ticker"}))),
        # two tokens are an exchange shape only: on any other row, even two
        # placeholders, the cell is unreadable
        ("AB CD", (None, None, frozenset({"ticker_unparsed"}))),
        ("-- --", (None, None, frozenset({"ticker_unparsed"}))),
        (WYDEN_TICKER_CELL, (None, None, frozenset({"ticker_unparsed"}))),
    ],
)
def test_non_exchange_ticker_legs(raw, expected):
    assert ticker_legs(raw, exchange=False) == expected
    # the one-cell contract (kadoa backfill) is the same rule without the leg
    assert normalize_ticker(raw) == (expected[0], expected[2])


def test_ticker_flags_are_the_rules_own_and_partitioned():
    assert TICKER_FLAGS == {"missing_ticker", "ticker_unparsed"}
    assert "ticker_unparsed" in PARSE_DEFECT_FLAGS
    assert "missing_ticker" in SOURCE_FACT_FLAGS
    assert has_parse_defect(["ticker_unparsed"]) is True


def test_ticker_from_raw_row_reads_the_side_from_the_row():
    assert ticker_from_raw_row(WYDEN_RAW_ROW) == ("AMCR", None, frozenset())
    # the same cell on a purchase row is not an exchange: unreadable
    assert ticker_from_raw_row(dict(WYDEN_RAW_ROW, side="Purchase")) == (
        None,
        None,
        frozenset({"ticker_unparsed"}),
    )
    # the House exchange code reads as an exchange too
    assert ticker_from_raw_row({"ticker": "CBS", "side": "E"}) == ("CBS", None, frozenset())
    assert ticker_from_raw_row({}) == (None, None, frozenset({"missing_ticker"}))


def test_normalize_row_on_the_live_wyden_row():
    row = normalize_row(
        WYDEN_RAW_ROW,
        filed_date="2026-08-08",
        cap_gains_cell=None,
        cap_gains_column_present=False,
        row_ordinal=1,
        source_row_no=1,
        asset_display_cell=WYDEN_RAW_ROW["asset_name"],
        asset_type_cell="Stock",
    )
    assert row.raw_row == WYDEN_RAW_ROW  # lossless: identity input untouched
    assert row.ticker == "AMCR"
    assert row.exchanged_ticker is None
    assert row.side == "exchange"
    assert row.flags == []


def test_normalize_row_carries_both_legs():
    row = normalize_row(
        dict(WYDEN_RAW_ROW, ticker=HAGERTY_TICKER_CELL),
        filed_date="2025-08-11",
        cap_gains_cell=None,
        cap_gains_column_present=False,
        row_ordinal=1,
        source_row_no=1,
    )
    assert (row.ticker, row.exchanged_ticker, row.flags) == ("EQT", "ETRN", [])


# --- asset (LD18) ------------------------------------------------------------


def test_asset_collapses_whitespace_and_extracts_type_tag():
    name, asset_type, flags = normalize_asset("Crown Castle Inc.  Common Stock (CCI) [ST]")
    assert name == "Crown Castle Inc. Common Stock (CCI) [ST]"
    assert asset_type == "ST"
    assert flags == frozenset()


def test_asset_type_tag_case_normalized():
    _name, asset_type, _flags = normalize_asset("uS TREaSuR 2.375% 05/29 [gS]")
    assert asset_type == "GS"


def test_missing_asset_gets_sentinel():
    name, asset_type, flags = normalize_asset(None)
    assert name == UNPARSED_ASSET_SENTINEL
    assert asset_type is None
    assert flags == {"asset_unparsed"}


# --- amounts (R9, Appendix C) ------------------------------------------------

TEN_BUCKETS = [
    ("$1,001 - $15,000", 1_001, 15_000),
    ("$15,001 - $50,000", 15_001, 50_000),
    ("$50,001 - $100,000", 50_001, 100_000),
    ("$100,001 - $250,000", 100_001, 250_000),
    ("$250,001 - $500,000", 250_001, 500_000),
    ("$500,001 - $1,000,000", 500_001, 1_000_000),
    ("$1,000,001 - $5,000,000", 1_000_001, 5_000_000),
    ("$5,000,001 - $25,000,000", 5_000_001, 25_000_000),
    ("$25,000,001 - $50,000,000", 25_000_001, 50_000_000),
    ("Over $50,000,000", 50_000_001, None),
]


@pytest.mark.parametrize("label,low,high", TEN_BUCKETS)
def test_statutory_buckets(label, low, high):
    assert normalize_amount(label) == (low, high, frozenset())


def test_spouse_cap_form():
    low, high, flags = normalize_amount("Over $1,000,000")
    assert (low, high) == (1_000_001, None)
    assert flags == {"amount_spouse_cap"}


def test_spouse_cap_corpus_form():
    # The 2026 corpus prints the cap as "Spouse/DC Over $1,000,000" (DocID
    # 20033695, wrapped across two physical lines) — same statutory meaning.
    low, high, flags = normalize_amount("Spouse/DC Over $1,000,000")
    assert (low, high) == (1_000_001, None)
    assert flags == {"amount_spouse_cap"}
    # The unwrapped first line alone is NOT a complete label (the R24
    # completion oracle must reject it so the join is attempted).
    _low, _high, fragment_flags = normalize_amount("Spouse/DC Over")
    assert "amount_unparsed" in fragment_flags


def test_unrecognized_label_flags_and_preserves():
    low, high, flags = normalize_amount("$1,000 to $15,000")
    assert (low, high) == (None, None)
    assert flags == {"amount_unparsed"}


def test_amount_completion_oracle_asymmetry():
    # R24: the wrapped-cell join test relies on exactly this asymmetry —
    # a fragment does not parse, the rejoined label does.
    _low, _high, fragment_flags = normalize_amount("$50,001 -")
    assert "amount_unparsed" in fragment_flags
    low, high, joined_flags = normalize_amount("$50,001 - $100,000")
    assert (low, high) == (50_001, 100_000)
    assert joined_flags == frozenset()


def test_absent_amount_is_unflagged_here():
    # row_incomplete (a structural flag) covers absence; amount_unparsed is
    # reserved for unrecognized printed labels.
    assert normalize_amount(None) == (None, None, frozenset())


# --- dates (R10) -------------------------------------------------------------


def test_days_to_file_and_late_boundary():
    # 45 days exactly is on time; 46 is late.
    iso, days, late, flags = normalize_dates("1/1/2026", "2026-02-15")
    assert (iso, days, late, flags) == ("2026-01-01", 45, 0, frozenset())
    iso, days, late, flags = normalize_dates("1/1/2026", "2026-02-16")
    assert (iso, days, late, flags) == ("2026-01-01", 46, 1, frozenset())


def test_unpadded_date_parses():
    iso, days, late, flags = normalize_dates("4/7/2015", "2015-05-08")
    assert iso == "2015-04-07"
    assert days == 31
    assert late == 0
    assert flags == frozenset()


def test_date_anomaly_keeps_and_flags():
    # Filed before transacted (real corpus case: 2015_20002703's TPH row).
    iso, days, late, flags = normalize_dates("3/18/2015", "2015-03-11")
    assert iso == "2015-03-18"
    assert days == -7
    assert late == 0
    assert flags == {"date_anomaly"}


@pytest.mark.parametrize("raw", [None, "13/45/2020", "not a date", "2020-01-01"])
def test_bad_or_missing_date(raw):
    iso, days, late, flags = normalize_dates(raw, "2026-01-01")
    assert (iso, days, late) == (None, None, None)
    assert flags == {"date_missing"}


# --- comment (RUN 3) ---------------------------------------------------------


@pytest.mark.parametrize("raw", [None, "", "   ", "--", " -- "])
def test_comment_missing_forms_are_null(raw):
    assert normalize_comment(raw) is None


def test_comment_free_text_is_collapsed_and_preserved():
    assert normalize_comment("Dividend Reinvestment") == "Dividend Reinvestment"
    assert (
        normalize_comment("  Sale of exercised\n  stock option  ")
        == "Sale of exercised stock option"
    )


# --- cap gains (LD11) --------------------------------------------------------


@pytest.mark.parametrize(
    "raw,expected,flags",
    [
        ("gfedcb", 1, frozenset()),
        ("gfedc", 0, frozenset()),
        (None, 0, frozenset()),
        ("", 0, frozenset()),
        ("??", None, frozenset({"capgains_unparsed"})),
    ],
)
def test_capgains_column_present(raw, expected, flags):
    assert normalize_capgains(raw, column_present=True) == (expected, flags)


@pytest.mark.parametrize("raw", [None, "gfedcb", "??"])
def test_capgains_column_absent_is_null_unflagged(raw):
    # 2015 layout has no Cap-Gains column: NULL with no flag, whatever junk
    # might land in the cell slot.
    assert normalize_capgains(raw, column_present=False) == (None, frozenset())


# --- normalize_row composition -----------------------------------------------

RAW_ROW = {
    "owner": "SP",
    "asset_name": "CBS Corporation Class B (CBS) [ST]",
    "ticker": "CBS",
    "side": "E",
    "transaction_date": "12/05/2019",
    "amount_label": "$1,001 - $15,000",
    "comment": "Name change",
}


def test_normalize_row_composes_all_fields():
    row = normalize_row(
        RAW_ROW,
        filed_date="2020-01-10",
        cap_gains_cell="gfedc",
        cap_gains_column_present=True,
        row_ordinal=1,
        source_row_no=None,
    )
    assert isinstance(row, ParsedRow)
    assert row.raw_row == RAW_ROW
    assert row.owner == "spouse"
    assert row.ticker == "CBS"
    assert row.asset_name == "CBS Corporation Class B (CBS) [ST]"
    assert row.asset_type == "ST"
    assert row.side == "exchange"
    assert row.transaction_date == "2019-12-05"
    assert row.days_to_file == 36
    assert row.is_late == 0
    assert (row.amount_low, row.amount_high) == (1_001, 15_000)
    assert row.amount_label == "$1,001 - $15,000"
    assert row.cap_gains_over_200 == 0
    assert row.comment == "Name change"
    assert row.flags == []
    assert has_parse_defect(row.flags) is False


def test_normalize_row_unions_structural_flags():
    row = normalize_row(
        dict(RAW_ROW, ticker=None),
        filed_date="2020-01-10",
        cap_gains_cell=None,
        cap_gains_column_present=True,
        row_ordinal=2,
        source_row_no=7,
        structural_flags={"row_incomplete", "row_orphan"},
    )
    assert row.source_row_no == 7
    assert set(row.flags) == {"missing_ticker", "row_incomplete", "row_orphan"}
    assert set(row.flags) <= KNOWN_FLAGS
    assert has_parse_defect(row.flags) is True


def test_normalize_row_senate_asset_seams():
    # LD2: raw_row keeps the lossless printed asset cell; the clean display
    # cell supplies the normalized asset_name and the printed Asset Type
    # column supplies asset_type directly.
    raw = dict(
        RAW_ROW,
        asset_name=(
            "\n  Cheniere Energy Partners L P Note\n"
            "  Rate/Coupon: 4.5% Matures: 2029-10-01\n"
        ),
        ticker="--",
        side="Sale (Full)",
        comment="--",
    )
    row = normalize_row(
        raw,
        filed_date="2026-07-09",
        cap_gains_cell=None,
        cap_gains_column_present=False,
        row_ordinal=1,
        source_row_no=3,
        asset_display_cell="Cheniere Energy Partners L P Note",
        asset_type_cell="Corporate Bond",
    )
    assert row.raw_row == raw  # lossless — annotation retained in raw
    assert row.asset_name == "Cheniere Energy Partners L P Note"
    assert row.asset_type == "Corporate Bond"
    assert row.side == "sale"
    assert row.ticker is None
    assert row.comment is None
    assert row.cap_gains_over_200 is None
    assert set(row.flags) == {"missing_ticker"}


def test_normalize_row_senate_blank_type_cell_falls_back_to_tag():
    row = normalize_row(
        RAW_ROW,
        filed_date="2020-01-10",
        cap_gains_cell=None,
        cap_gains_column_present=False,
        row_ordinal=1,
        source_row_no=1,
        asset_type_cell="   ",
    )
    # A whitespace-only printed type cell contributes nothing; the House
    # [XX]-tag derivation from the asset source still applies.
    assert row.asset_type == "ST"


def test_normalization_version_is_stamped_constant():
    # norm-1.2.0: the Senate two-leg exchange ticker rule and exchanged_ticker.
    assert NORMALIZATION_VERSION == "norm-1.2.0"
