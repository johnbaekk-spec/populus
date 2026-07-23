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

# The exact §15.2 register entry set.
SECTION_15_2_IDS = {
    "us-congress-disclosures",
    "us-govworks-sec",
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


def test_register_dates_per_quarterly_cadence():
    register = load_register()
    for entry in register["entries"]:
        assert entry["determination_date"] == "2026-07-23"
        assert entry["review_by"] == "2026-10-23"


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
