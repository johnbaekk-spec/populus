"""13F cover + information-table parser units (RUN M2-2; R1/R2/R3/R7/R14).

Pure — no DB, no network. The info-table filename is proven to be discovered
from ``index.json`` (never hardcoded, R1/F1): a renamed table still resolves, a
numeric name and a named file both resolve, and ambiguity/absence raise.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from populus.parse.inst13f import (
    CoverParseError,
    InfoTableAmbiguousError,
    InfoTableMissingError,
    discover_info_table_name,
    normalize_file_number,
    parse_cover,
    parse_info_table,
)

REAL = Path(__file__).parent / "fixtures" / "inst" / "real" / "CIK0001067983"
CRAFTED = Path(__file__).parent / "fixtures" / "inst" / "crafted"

BERKSHIRE_2026 = "000119312526226661"
BASE_2025Q1 = "000095012325005701"
AMENDMENT_2025Q1 = "000095012325008361"


def _cover(nodash: str):
    return parse_cover((REAL / nodash / "primary_doc.xml").read_bytes())


def _table_bytes(nodash: str, root=None) -> bytes:
    """The accession's information table, resolved through index discovery (R1).

    Never opens a literal SEC table filename: the name is variable per accession
    (`53405.xml`, `43981.xml`, `form13fInfoTable.xml`), so every read — in source
    AND in tests — goes through `discover_info_table_name` (QA-F1).
    """
    directory = (root or REAL) / nodash
    name = discover_info_table_name((directory / "index.json").read_bytes())
    return (directory / name).read_bytes()


# --- info-table discovery (R1/F1/F2) -----------------------------------------


def test_info_table_discovered_from_index_named_and_numeric():
    # The base's info table is a NAMED file, the amendment's is NUMERIC — both
    # discovered from index.json, proving no filename is hardcoded (R1).
    base_index = (REAL / BASE_2025Q1 / "index.json").read_bytes()
    amd_index = (REAL / AMENDMENT_2025Q1 / "index.json").read_bytes()
    assert discover_info_table_name(base_index) == "form13fInfoTable.xml"
    assert discover_info_table_name(amd_index) == "43981.xml"
    assert discover_info_table_name((REAL / BERKSHIRE_2026 / "index.json").read_bytes()) == "53405.xml"


def test_info_table_discovery_survives_a_renamed_table():
    # A hardcoded filename would fail here; discovery does not (F1).
    index = json.dumps(
        {"directory": {"item": [
            {"name": "primary_doc.xml"},
            {"name": "an_utterly_renamed_table.xml", "size": "10"},
        ]}}
    )
    assert discover_info_table_name(index) == "an_utterly_renamed_table.xml"


def test_info_table_absent_and_ambiguous_raise():
    only_cover = json.dumps({"directory": {"item": [{"name": "primary_doc.xml"}]}})
    with pytest.raises(InfoTableMissingError):
        discover_info_table_name(only_cover)
    two = json.dumps({"directory": {"item": [
        {"name": "primary_doc.xml"}, {"name": "a.xml"}, {"name": "b.xml"},
    ]}})
    with pytest.raises(InfoTableAmbiguousError):
        discover_info_table_name(two)


def test_info_table_name_with_a_path_separator_is_refused():
    # A remote index value that is not a bare XML file name is refused before it
    # can be joined to a path (F4).
    escaping = json.dumps({"directory": {"item": [
        {"name": "primary_doc.xml"}, {"name": "../../etc/evil.xml"},
    ]}})
    with pytest.raises(InfoTableMissingError):
        discover_info_table_name(escaping)


# --- cover fields (R2) --------------------------------------------------------


def test_cover_fields_on_real_2026_filing():
    cover = _cover(BERKSHIRE_2026)
    assert cover.submission_type == "13F-HR"
    assert cover.period_of_report == "2026-03-31"  # 03-31-2026 -> ISO
    assert cover.is_amendment is False
    assert cover.filing_manager == "Berkshire Hathaway Inc"
    assert cover.form13f_file_number == "028-04545"
    assert cover.file_number_norm == "028-4545"
    assert cover.report_type == "13F HOLDINGS REPORT"
    assert cover.table_entry_total == 90
    assert cover.table_value_total == 263095703570
    assert cover.is_confidential_omitted is False
    assert cover.other_included_managers_count == 14
    assert len(cover.other_managers) == 14
    assert cover.schema_version == "X0202"
    # otherManager seq 4 (Buffett) — a DIFFERENT filer (028-554 != 028-4545).
    buffett = next(m for m in cover.other_managers if m.seq == 4)
    assert buffett.form13f_file_number == "28-554"
    assert buffett.file_number_norm == "028-554"
    assert buffett.name == "Buffett Warren E"


def test_cover_base_2025q1_has_no_isamendment_element():
    # The 2025-Q1 base cover omits <isAmendment> entirely — default to False.
    cover = _cover(BASE_2025Q1)
    assert cover.is_amendment is False
    assert cover.is_confidential_omitted is True  # the base omitted confidential holdings
    assert cover.table_entry_total == 110


def test_cover_amendment_new_holdings_maps_and_captures_conf_denied():
    cover = _cover(AMENDMENT_2025Q1)
    assert cover.submission_type == "13F-HR/A"
    assert cover.is_amendment is True
    assert cover.amendment_type == "NEW_HOLDINGS"  # "NEW HOLDINGS" -> NEW_HOLDINGS
    assert cover.amendment_no == 1
    assert cover.conf_denied_expired is True
    assert cover.table_entry_total == 4
    assert cover.table_value_total == 1106550356


def test_parse_cover_raises_on_malformed_xml():
    with pytest.raises(CoverParseError) as exc:
        parse_cover(b"<edgarSubmission><unclosed>")
    assert exc.value.kind == "cover_malformed"


def test_parse_cover_raises_on_missing_required_field():
    cover = (CRAFTED / "CIK0009000010" / "000900001024000002" / "primary_doc.xml").read_bytes()
    with pytest.raises(CoverParseError) as exc:
        parse_cover(cover)
    assert exc.value.kind == "cover_missing_field"


def test_parse_cover_does_not_expand_external_entities():
    # F5: an external-entity reference neither expands nor fetches; the field
    # reads empty and the strict parse refuses rather than leaking anything.
    xxe = b"""<?xml version="1.0"?>
<!DOCTYPE edgarSubmission [ <!ENTITY xxe SYSTEM "file:///etc/passwd"> ]>
<edgarSubmission xmlns="http://www.sec.gov/edgar/thirteenffiler">
  <headerData><submissionType>&xxe;</submissionType>
    <filerInfo><periodOfReport>03-31-2024</periodOfReport></filerInfo></headerData>
  <formData><coverPage><filingManager><name>x</name></filingManager></coverPage></formData>
</edgarSubmission>"""
    with pytest.raises(CoverParseError) as exc:
        parse_cover(xxe)
    assert "root:" not in str(exc.value)  # no /etc/passwd content leaked


# --- information table (R3) ---------------------------------------------------


def test_info_table_row_counts_and_first_row_verbatim():
    rows = parse_info_table(_table_bytes(BERKSHIRE_2026))
    assert len(rows) == 90
    first = rows[0]
    assert first.raw_row == {
        "nameOfIssuer": "ALLY FINL INC",
        "titleOfClass": "COM",
        "cusip": "02005N100",
        "value": "498992850",
        "sshPrnamt": "12719675",
        "sshPrnamtType": "SH",
        "putCall": None,  # equities: putCall absent -> null, a fixed key (R3/R15)
        "investmentDiscretion": "DFND",
        "otherManager": "4",
        "votingSole": "12719675",
        "votingShared": "0",
        "votingNone": "0",
    }


def test_amendment_info_table_has_four_rows():
    rows = parse_info_table(_table_bytes(AMENDMENT_2025Q1))
    assert [r.name_of_issuer for r in rows] == [
        "D R HORTON INC", "LENNAR CORP", "LENNAR CORP", "NUCOR CORP",
    ]
    assert sum(int(r.value) for r in rows) == 1106550356


def test_info_table_never_drops_a_row_and_keeps_bad_fields_raw():
    rows = parse_info_table(
        (CRAFTED / "CIK0009000007" / "000900000724000002" / "malformed7.xml").read_bytes()
    )
    assert len(rows) == 3  # the malformed row is retained, not dropped (G3)
    assert rows[1].cusip == "12345"  # kept exactly as printed; normalize flags it


# --- file-number canonicalization (R7/F14) -----------------------------------


def test_file_number_equal_encodings_match_and_distinct_stay_distinct():
    assert normalize_file_number("028-00554") == normalize_file_number("28-554") == "028-554"
    assert normalize_file_number("028-04545") == "028-4545"
    assert normalize_file_number("028-04545") != normalize_file_number("28-554")
    assert normalize_file_number("not-a-number") is None
    assert normalize_file_number(None) is None


# --- QA-round-1 regressions ---------------------------------------------------


def _holdings_cover(entry_total: str | None, value_total: str | None) -> bytes:
    entry = f"<tableEntryTotal>{entry_total}</tableEntryTotal>" if entry_total is not None else ""
    value = f"<tableValueTotal>{value_total}</tableValueTotal>" if value_total is not None else ""
    return f"""<?xml version="1.0"?>
<edgarSubmission>
  <headerData><submissionType>13F-HR</submissionType></headerData>
  <formData>
    <coverPage>
      <reportCalendarOrQuarter>03-31-2026</reportCalendarOrQuarter>
      <filingManager><name>Test Manager</name></filingManager>
    </coverPage>
    <summaryPage>{entry}{value}</summaryPage>
  </formData>
</edgarSubmission>""".encode()


@pytest.mark.parametrize(
    "entry_total,value_total",
    [
        ("2", None),        # value total absent
        ("2", "not-a-number"),  # value total non-numeric
        (None, "1000"),     # entry total absent
    ],
    ids=["value-absent", "value-non-numeric", "entry-absent"],
)
def test_a_holdings_cover_without_interpretable_totals_is_cover_missing_field(
    entry_total, value_total
):
    """QA-F1 / R2-R16-R18: on a HOLDINGS report the summary totals are required —
    a missing/uninterpretable value total must become a cover-failed filing with
    an UNKNOWN total, never a silent 0 that inflates coverage."""
    with pytest.raises(CoverParseError) as excinfo:
        parse_cover(_holdings_cover(entry_total, value_total))
    assert excinfo.value.kind == "cover_missing_field"


def test_a_notice_cover_without_totals_is_valid():
    """The converse: a 13F-NT notice legitimately reports no holdings/totals."""
    notice = b"""<?xml version="1.0"?>
<edgarSubmission>
  <headerData><submissionType>13F-NT</submissionType></headerData>
  <formData>
    <coverPage>
      <reportCalendarOrQuarter>03-31-2026</reportCalendarOrQuarter>
      <filingManager><name>Test Manager</name></filingManager>
    </coverPage>
    <summaryPage/>
  </formData>
</edgarSubmission>"""
    cover = parse_cover(notice)
    assert cover.submission_type == "13F-NT"
    assert cover.table_value_total is None


def test_raw_row_preserves_whitespace_exactly_while_accessors_trim():
    """QA-F4 / R3-R15: `raw_row` is the observation as printed (NFC only), so the
    archived text and the canonical fingerprint match source. Trimming belongs to
    the normalization-facing accessors."""
    xml = b"""<?xml version="1.0"?>
<informationTable>
  <infoTable>
    <nameOfIssuer>  ACME CORP  </nameOfIssuer>
    <titleOfClass>COM</titleOfClass>
    <cusip> 037833100 </cusip>
    <value>1000</value>
    <shrsOrPrnAmt><sshPrnamt> 500 </sshPrnamt><sshPrnamtType>SH</sshPrnamtType></shrsOrPrnAmt>
    <investmentDiscretion>SOLE</investmentDiscretion>
    <votingAuthority><Sole>500</Sole><Shared>0</Shared><None>0</None></votingAuthority>
  </infoTable>
</informationTable>"""
    (row,) = parse_info_table(xml)
    # Exactly as printed — whitespace intact.
    assert row.raw_row["nameOfIssuer"] == "  ACME CORP  "
    assert row.raw_row["cusip"] == " 037833100 "
    assert row.raw_row["sshPrnamt"] == " 500 "
    # The typed/normalization-facing view is trimmed.
    assert row.name_of_issuer == "ACME CORP"
    assert row.cusip == "037833100"
    assert row.ssh_prnamt == "500"
    # Two rows differing only in whitespace stay distinguishable in raw_row.
    other = parse_info_table(xml.replace(b"  ACME CORP  ", b"ACME CORP"))[0]
    assert other.raw_row["nameOfIssuer"] != row.raw_row["nameOfIssuer"]
    assert other.name_of_issuer == row.name_of_issuer


@pytest.mark.parametrize("bad_period", ["02-30-2026", "13-01-2026", "00-15-2026"])
def test_an_impossible_cover_period_is_a_failed_cover(bad_period):
    """QA-F2 / R2-R18: the period must be a REAL calendar date, not merely
    MM-DD-YYYY-shaped — an impossible date would otherwise be persisted as
    `period_of_report` and used as the as-of key for identity resolution."""
    cover = f"""<?xml version="1.0"?>
<edgarSubmission>
  <headerData><submissionType>13F-HR</submissionType></headerData>
  <formData>
    <coverPage>
      <reportCalendarOrQuarter>{bad_period}</reportCalendarOrQuarter>
      <filingManager><name>Test Manager</name></filingManager>
    </coverPage>
    <summaryPage><tableEntryTotal>1</tableEntryTotal><tableValueTotal>100</tableValueTotal></summaryPage>
  </formData>
</edgarSubmission>""".encode()
    with pytest.raises(CoverParseError) as excinfo:
        parse_cover(cover)
    assert excinfo.value.kind == "cover_missing_field"
    assert "period_of_report" in str(excinfo.value)
