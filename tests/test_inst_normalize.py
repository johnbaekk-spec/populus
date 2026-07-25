"""13F normalization + coverage-input units (RUN M2-2; R4/R6/R9/R14/R16).

Pure — no DB import (G14, structural): the resolver is injected, so a CUSIP is
always resolved as-of a date and the module never reaches for a connection.
"""

from __future__ import annotations

import importlib

import pytest

from populus.normalize_inst import (
    INST_DATA_NOTE,
    INST_PARSE_DEFECT_FLAGS,
    INST_SOURCE_FACT_FLAGS,
    UNIT_MULTIPLIER,
    filing_reconciliation,
    inst_has_parse_defect,
    normalize_holding,
    unit_basis_for,
)
from populus.parse.inst13f import InfoTableRow


def _row(**overrides) -> InfoTableRow:
    raw = {
        "nameOfIssuer": "ACME CORP",
        "titleOfClass": "COM",
        "cusip": "037833100",
        "value": "1000000",
        "sshPrnamt": "1000",
        "sshPrnamtType": "SH",
        "putCall": None,
        "investmentDiscretion": "SOLE",
        "otherManager": None,
        "votingSole": "1000",
        "votingShared": "0",
        "votingNone": "0",
    }
    raw.update(overrides)
    return InfoTableRow(row_ordinal=1, raw_row=raw)


def _none_resolver(cusip, as_of):
    return None


# --- G14: no DB import -------------------------------------------------------


def test_module_does_not_import_the_database():
    mod = importlib.import_module("populus.normalize_inst")
    assert not hasattr(mod, "sqlite3")
    assert "populus.db" not in getattr(mod, "__dict__", {})


# --- unit basis / multiplier (R4/LD-5) ---------------------------------------


def test_unit_basis_cutover_is_the_filed_date_2023_01_03():
    assert unit_basis_for("2023-01-02") == "thousands"
    assert unit_basis_for("2023-01-03") == "whole"
    # A Q4-2022 report filed in 2023 is WHOLE — the discriminator is the filed
    # date, not the period (F7).
    assert unit_basis_for("2023-02-14") == "whole"
    assert unit_basis_for("2020-02-14") == "thousands"


def test_unit_multiplier_scales_value_usd():
    assert UNIT_MULTIPLIER == {"thousands": 1000, "whole": 1}
    whole = normalize_holding(_row(value="1000000"), unit_basis="whole",
                              period_of_report="2026-03-31", resolve_security=_none_resolver)
    assert whole.value_raw == 1000000 and whole.value_usd == 1000000
    thousands = normalize_holding(_row(value="45000"), unit_basis="thousands",
                                  period_of_report="2019-12-31", resolve_security=_none_resolver)
    assert thousands.value_raw == 45000 and thousands.value_usd == 45000000


# --- flag taxonomy ------------------------------------------------------------


def test_flag_frozensets_are_disjoint():
    assert INST_PARSE_DEFECT_FLAGS.isdisjoint(INST_SOURCE_FACT_FLAGS)
    assert inst_has_parse_defect(["value_unparsed"]) is True
    assert inst_has_parse_defect(["missing_security"]) is False  # a source fact, not a defect


# --- put/call + PRN (G5) ------------------------------------------------------


def test_put_call_and_prn_are_normalized_and_labeled():
    assert normalize_holding(_row(putCall="Call"), unit_basis="whole",
                             period_of_report="2026-03-31", resolve_security=_none_resolver).put_call == "CALL"
    assert normalize_holding(_row(putCall="Put"), unit_basis="whole",
                             period_of_report="2026-03-31", resolve_security=_none_resolver).put_call == "PUT"
    bad = normalize_holding(_row(putCall="Straddle"), unit_basis="whole",
                            period_of_report="2026-03-31", resolve_security=_none_resolver)
    assert bad.put_call is None and "put_call_unparsed" in bad.flags
    prn = normalize_holding(_row(sshPrnamtType="PRN", sshPrnamt="900000"), unit_basis="whole",
                            period_of_report="2026-03-31", resolve_security=_none_resolver)
    assert prn.ssh_prnamt_type == "PRN" and prn.ssh_prnamt == 900000


# --- identity resolution (R9/G14) --------------------------------------------


def test_unmapped_cusip_is_retained_with_missing_security():
    h = normalize_holding(_row(), unit_basis="whole", period_of_report="2026-03-31",
                          resolve_security=_none_resolver)
    assert h.security_id is None
    assert h.issuer_name_raw == "ACME CORP"  # kept, never dropped
    assert "missing_security" in h.flags


def test_resolver_is_called_with_the_period_of_report():
    seen = {}

    def resolver(cusip, as_of):
        seen["cusip"], seen["as_of"] = cusip, as_of
        return "sec:test:1"

    h = normalize_holding(_row(cusip="037833100"), unit_basis="whole",
                          period_of_report="2026-03-31", resolve_security=resolver)
    assert seen == {"cusip": "037833100", "as_of": "2026-03-31"}
    assert h.security_id == "sec:test:1" and not h.flags


def test_malformed_cusip_is_cusip_unparsed_not_missing_security():
    h = normalize_holding(_row(cusip="12345"), unit_basis="whole",
                          period_of_report="2026-03-31", resolve_security=_none_resolver)
    assert h.cusip is None and h.security_id is None
    assert "cusip_unparsed" in h.flags


# --- reconciliation + coverage inputs (R16/LD-7) -----------------------------


def test_reconciliation_scales_total_and_reports_delta():
    rows = [
        normalize_holding(_row(value="45000"), unit_basis="thousands",
                          period_of_report="2019-12-31", resolve_security=_none_resolver),
        normalize_holding(_row(value="12000"), unit_basis="thousands",
                          period_of_report="2019-12-31", resolve_security=_none_resolver),
    ]
    rec = filing_reconciliation(table_entry_total=2, table_value_total=57000,
                                unit_basis="thousands", holdings=rows)
    assert rec.table_value_total_usd == 57000000  # 57000 * 1000
    assert rec.sum_value_usd == 57000000
    assert rec.value_total_delta == 0
    assert rec.row_count == 2 and rec.entry_total_mismatch is False
    assert rec.resolved_rows == 0 and rec.resolved_value_usd == 0


def test_reconciliation_flags_entry_total_mismatch():
    rec = filing_reconciliation(table_entry_total=5, table_value_total=1000,
                                unit_basis="whole", holdings=[])
    assert rec.row_count == 0 and rec.entry_total_mismatch is True
    # An info-table-failed filing still carries its cover total for the
    # denominator (F3) — value known.
    assert rec.table_value_total_usd == 1000


def test_data_note_carries_the_structural_caveat():
    assert "snapshot" in INST_DATA_NOTE
    assert "§5.2" in INST_DATA_NOTE or "5.2" in INST_DATA_NOTE


# --- QA-round-1 regressions ---------------------------------------------------


@pytest.mark.parametrize(
    "overrides,expected_flag",
    [
        ({"sshPrnamt": None}, "ssh_unparsed"),          # required, ABSENT
        ({"sshPrnamt": "1,000"}, "ssh_unparsed"),       # required, non-numeric
        ({"votingSole": None, "votingShared": None, "votingNone": None}, "voting_unparsed"),
        ({"votingSole": "x"}, "voting_unparsed"),
        ({"titleOfClass": None}, "row_incomplete"),
        ({"sshPrnamtType": None}, "row_incomplete"),
    ],
)
def test_absent_required_row_fields_are_defects_not_optional_absence(
    overrides, expected_flag
):
    """QA-F2 / R3-G3: an ABSENT required info-table field must be flagged, so the
    row cannot be reported as fully parsed (the filing is forced to `partial`)."""
    holding = normalize_holding(
        _row(**overrides),
        period_of_report="2026-03-31",
        unit_basis="whole",
        resolve_security=_none_resolver,
    )
    assert expected_flag in holding.flags
    assert inst_has_parse_defect(holding.flags) is True


def test_an_optional_absent_field_is_not_a_defect():
    """The converse: putCall/otherManager are legitimately absent on equities."""
    holding = normalize_holding(
        _row(putCall=None, otherManager=None),
        period_of_report="2026-03-31",
        unit_basis="whole",
        resolve_security=_none_resolver,
    )
    assert "put_call_unparsed" not in holding.flags
    assert "row_incomplete" not in holding.flags


def test_an_unknown_cover_total_stays_null_never_zero():
    """QA-F1 / R16: coercing an unknown cover total to 0 would drop the filing's
    denominator contribution without raising cover_failed_count — inflating
    coverage. It must stay NULL (unknown)."""
    rec = filing_reconciliation(
        table_entry_total=None,
        table_value_total=None,
        holdings=[],
        unit_basis="whole",
    )
    assert rec.table_value_total_usd is None
    assert rec.value_total_delta is None


@pytest.mark.parametrize(
    "overrides",
    [
        {"votingSole": None},
        {"votingShared": None},
        {"votingNone": None},
    ],
    ids=["sole-missing", "shared-missing", "none-missing"],
)
def test_each_voting_member_is_individually_required(overrides):
    """QA-F2 / R3: Sole, Shared and None are each required — ONE missing value is
    incomplete data, not acceptable partial absence."""
    holding = normalize_holding(
        _row(**overrides),
        period_of_report="2026-03-31",
        unit_basis="whole",
        resolve_security=_none_resolver,
    )
    assert "voting_unparsed" in holding.flags
    assert inst_has_parse_defect(holding.flags) is True


def test_missing_investment_discretion_is_a_defect():
    """QA-F1 / R3-G3: investmentDiscretion is a required info-table field."""
    holding = normalize_holding(
        _row(investmentDiscretion=None),
        period_of_report="2026-03-31",
        unit_basis="whole",
        resolve_security=_none_resolver,
    )
    assert "row_incomplete" in holding.flags
    assert inst_has_parse_defect(holding.flags) is True


def test_a_malformed_other_manager_component_is_flagged_not_dropped():
    """QA-F3 / R3-G3: a non-numeric otherManager component must flag, not vanish —
    otherwise the normalized sequence list is incomplete while the row reports as
    fully parsed."""
    holding = normalize_holding(
        _row(otherManager="1, X, 3"),
        period_of_report="2026-03-31",
        unit_basis="whole",
        resolve_security=_none_resolver,
    )
    assert holding.other_manager_seqs == [1, 3]          # the valid ones survive
    assert "other_manager_unparsed" in holding.flags     # ...and the loss is flagged
    assert inst_has_parse_defect(holding.flags) is True
    # A well-formed list is not flagged.
    clean = normalize_holding(
        _row(otherManager="1,2,3"),
        period_of_report="2026-03-31",
        unit_basis="whole",
        resolve_security=_none_resolver,
    )
    assert clean.other_manager_seqs == [1, 2, 3]
    assert "other_manager_unparsed" not in clean.flags


def test_an_empty_other_manager_component_is_also_flagged():
    """QA-F2 (round 4): an EMPTY component inside a non-empty delimited value
    (`1,,3`) is malformed input, not an absence — skipping it silently would lose
    a component while the row still reported as fully parsed."""
    holding = normalize_holding(
        _row(otherManager="1,,3"),
        period_of_report="2026-03-31",
        unit_basis="whole",
        resolve_security=_none_resolver,
    )
    assert holding.other_manager_seqs == [1, 3]
    assert "other_manager_unparsed" in holding.flags
    assert inst_has_parse_defect(holding.flags) is True
