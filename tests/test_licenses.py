"""§15 conditions register: completeness, statutory notice, drift guard,
and DB license coverage (RUN 4; R12)."""

from __future__ import annotations

from pathlib import Path

from populus.licenses import (
    ingestible_ids,
    load_register,
    register_ids,
    render_data_license,
    render_notice,
    required_notices,
    validate_register,
)

REPO_ROOT = Path(__file__).resolve().parent.parent

# The exact §15.2 register entry set. `sec-edgar` and `sec-ftd` are the RUN
# M2-1 endpoint-level determinations under the retained `us-govworks-sec`
# umbrella — written before any SEC ingest path or SEC-derived fixture (G11).
SECTION_15_2_IDS = {
    "us-congress-disclosures",
    "us-govworks-sec",
    "sec-edgar",
    "sec-ftd",
    "us-govworks-treasury",
    "us-govworks-cftc",
    "bls-tos",
    "bea-tos",
    "fred-per-series",
    "cc0-legislators",
    "mit-kadoa-seed",
    "capitol-api-reference",
}

STATUTORY_NOTICE = (
    "It shall be unlawful for any person to obtain or use a report— (A) for"
    " any unlawful purpose; (B) for any commercial purpose, other than by"
    " news and communications media for dissemination to the general public;"
    " (C) for determining or establishing the credit rating of any"
    " individual; or (D) for use, directly or indirectly, in the"
    " solicitation of money for any political, charitable, or other purpose."
)


def test_register_is_valid_and_complete():
    register = load_register()
    assert validate_register(register) == []
    assert register_ids(register) == SECTION_15_2_IDS


def test_statutory_notice_verbatim():
    register = load_register()
    notices = dict(required_notices(register))
    assert STATUTORY_NOTICE in notices["us-congress-disclosures"]
    # The verbatim text also survives into both generated documents.
    assert STATUTORY_NOTICE in render_data_license(register)
    assert STATUTORY_NOTICE in render_notice(register)


def test_bls_disclaimer_is_a_required_notice():
    register = load_register()
    notices = [notice for lid, notice in required_notices(register) if lid == "bls-tos"]
    assert any("BLS.gov cannot vouch" in n for n in notices)


def test_reference_only_and_placeholders_not_ingestible():
    register = load_register()
    by_id = {entry["license_id"]: entry for entry in register["entries"]}
    assert by_id["capitol-api-reference"]["ingestible"] is False
    assert by_id["capitol-api-reference"]["status"] == "determined"
    for placeholder in ("bls-tos", "bea-tos", "fred-per-series"):
        assert by_id[placeholder]["status"] == "placeholder"
        assert by_id[placeholder]["ingestible"] is False
    # The M1 sources are ingestible and determined.
    for active in ("us-congress-disclosures", "cc0-legislators", "mit-kadoa-seed"):
        assert by_id[active]["ingestible"] is True
        assert by_id[active]["status"] == "determined"


# Determination dates are pinned per phase: the M1 entries were determined on
# the RUN-4 register date, the two M2 endpoint-level entries on the M2 phase-
# entry date (M2-CONTRACT §1 live verification, 2026-07-24).
M1_REGISTER_DATE = "2026-07-23"
M2_REGISTER_DATE = "2026-07-24"
M2_ENTRY_IDS = {"sec-edgar", "sec-ftd"}


def _one_quarter_later(iso: str) -> str:
    """The §14 quarterly-cadence review date: same day, three months on
    (clamped to month-end when the target month is shorter, e.g. day 31 → 30)."""
    import calendar
    from datetime import date

    determined = date.fromisoformat(iso)
    month = determined.month + 3
    year = determined.year + (month - 1) // 12
    target_month = (month - 1) % 12 + 1
    last_day = calendar.monthrange(year, target_month)[1]
    return date(year, target_month, min(determined.day, last_day)).isoformat()


def test_register_dates_per_quarterly_cadence():
    register = load_register()
    for entry in register["entries"]:
        expected_determined = (
            M2_REGISTER_DATE
            if entry["license_id"] in M2_ENTRY_IDS
            else M1_REGISTER_DATE
        )
        assert entry["determination_date"] == expected_determined, entry["license_id"]
        # The invariant, not a second hard-coded table: review_by is exactly one
        # quarter after the determination, for every entry in every phase.
        assert entry["review_by"] == _one_quarter_later(
            entry["determination_date"]
        ), entry["license_id"]


def test_m2_register_entries_well_formed():
    # G11: both M2 sources are registered, determined, and ingestible BEFORE
    # any code or fixture derived from them exists.
    register = load_register()
    assert register["register_version"] == "licenses-1.1.0"
    by_id = {entry["license_id"]: entry for entry in register["entries"]}
    for license_id in sorted(M2_ENTRY_IDS):
        entry = by_id[license_id]
        assert entry["status"] == "determined"
        assert entry["ingestible"] is True
        # Every §15.1 field carries real content, not a placeholder shell.
        assert entry["permitted_uses"], license_id
        assert entry["restrictions"], license_id
        assert entry["attribution"], license_id
        assert len(entry["determination_basis"]) > 80, license_id
        assert "17 U.S.C." in entry["instrument"], license_id
    # Both entries are mirrored into the generated documents.
    rendered = render_data_license(register)
    for license_id in sorted(M2_ENTRY_IDS):
        assert f"`{license_id}`" in rendered


def test_sec_edgar_records_the_ua_condition():
    # The verified 2026-07-24 correction is recorded as a restriction, so the
    # register — not only the client — carries why the UA form is what it is.
    register = load_register()
    by_id = {entry["license_id"]: entry for entry in register["entries"]}
    restrictions = " ".join(by_id["sec-edgar"]["restrictions"])
    assert "403" in restrictions
    assert "PopulusBot" in restrictions
    assert "Accept-Encoding: gzip, deflate" in restrictions
    assert "2 requests/second" in restrictions


def test_sec_ftd_records_the_no_inference_condition():
    # DC2/G14 is a condition of the source, not only an implementation choice:
    # FTD rows are point-in-time observations and validity is never inferred
    # across a gap. The fixture-redistribution permission (R14) is recorded too.
    register = load_register()
    by_id = {entry["license_id"]: entry for entry in register["entries"]}
    restrictions = " ".join(by_id["sec-ftd"]["restrictions"])
    assert "never inferred across a gap" in restrictions
    assert "point-in-time settlement-date observations" in restrictions
    permitted = " ".join(by_id["sec-ftd"]["permitted_uses"])
    assert "test fixture" in permitted


def test_validate_register_catches_defects():
    register = load_register()
    broken = {
        "register_version": register["register_version"],
        "entries": [
            dict(register["entries"][0], review_by="2026-07-23"),  # not after
            dict(register["entries"][1], license_id=register["entries"][0]["license_id"]),
            {k: v for k, v in register["entries"][2].items() if k != "attribution"},
        ],
    }
    errors = validate_register(broken)
    assert any("review_by" in e for e in errors)
    assert any("duplicate" in e for e in errors)
    assert any("attribution" in e for e in errors)


def test_generated_documents_have_no_drift():
    # DATA-LICENSE.md and NOTICE are committed generated files: regenerating
    # from the register must reproduce them byte-for-byte.
    register = load_register()
    assert (REPO_ROOT / "DATA-LICENSE.md").read_text(
        encoding="utf-8"
    ) == render_data_license(register)
    assert (REPO_ROOT / "NOTICE").read_text(encoding="utf-8") == render_notice(register)


def test_every_db_license_id_is_registered(initialized_db, make_filing, make_row):
    # Every license_id the pipeline stamps must exist in the register and be
    # ingestible (G11): exercise both write paths.
    from populus.load import load_filing

    make_filing(initialized_db, filing_id="house:1")  # us-congress-disclosures
    make_filing(
        initialized_db,
        filing_id="kadoa:house_1_g0",
        source="kadoa",
        license_id="mit-kadoa-seed",
        doc_url="https://example.invalid/k",
    )
    for filing_id in ("house:1", "kadoa:house_1_g0"):
        load_filing(
            initialized_db,
            filing_id,
            [make_row(asset_name=f"A {filing_id}")],
            parse_status="parsed",
            parser_version="t",
            normalization_version="t",
        )
    used = {
        lid
        for (lid,) in initialized_db.execute(
            "SELECT license_id FROM filings UNION SELECT license_id FROM transactions"
        )
    }
    allowed = ingestible_ids(load_register())
    assert used <= allowed, used - allowed


def test_render_script_is_stdlib_plus_populus_only():
    # The dependency guard scans scripts/ too; this pins the render script's
    # import surface so it stays runnable in a bare environment.
    import ast

    tree = ast.parse(
        (REPO_ROOT / "scripts" / "render_licenses.py").read_text(encoding="utf-8")
    )
    roots = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            roots.update(alias.name.split(".")[0] for alias in node.names)
        elif isinstance(node, ast.ImportFrom) and node.module:
            roots.add(node.module.split(".")[0])
    assert roots <= {"sys", "pathlib", "populus", "__future__"}
