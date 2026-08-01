"""Member identity: loaders, resolver, join pass (RUN 4; R1–R4), and the
cache-gated end-to-end acceptance (R14).

Unit tests run on synthetic legislators YAML and the conftest factories;
the acceptance corpus test builds one DB from every committed cache and
auto-skips when ``data-cache/`` is absent.
"""

from __future__ import annotations

import json
import time
from pathlib import Path

import pytest
import yaml

from populus.members import (
    JoinReport,
    apply_member_join,
    alias_overlap_errors,
    build_resolver,
    default_aliases_text,
    house_hints_from_index,
    kadoa_hints_from_trades,
    load_aliases,
    load_members,
    normalize_filer_name,
    run_members_ingest,
)

REPO_ROOT = Path(__file__).resolve().parent.parent
DATA_CACHE = REPO_ROOT / "data-cache"


# --- name normalization (R2) --------------------------------------------------


@pytest.mark.parametrize(
    "raw,expected",
    [
        ("Doe, Jane", "jane doe"),
        ("BLUMENTHAL, RICHARD", "richard blumenthal"),
        ("Beyer, Donald Sternoff Jr", "donald sternoff beyer"),
        ("Dunn, Neal Patrick MD, Facs", "neal patrick dunn"),
        ("Begich, Nicholas III", "nicholas begich"),
        ("McConnell, Jr., A. Mitchell", "a mitchell mcconnell"),
        ("Wasserman Schultz, Debbie", "debbie wasserman schultz"),
        ("James A. Himes", "james a himes"),
        # Diacritics fold: sources disagree with the seed about accents.
        ("Sanchez, Linda T.", "linda t sanchez"),
        ("Sánchez, Linda T.", "linda t sanchez"),
        ("Grijalva, Raúl M.", "raul m grijalva"),
        ("O'Halleran, Tom", "tom o halleran"),
    ],
)
def test_normalize_filer_name(raw, expected):
    assert normalize_filer_name(raw) == expected


# --- legislators load (R1) ----------------------------------------------------


def _write_legislators(tmp_path, current, historical):
    directory = tmp_path / "legislators"
    directory.mkdir(exist_ok=True)
    (directory / "legislators-current.yaml").write_text(
        yaml.safe_dump(current), encoding="utf-8"
    )
    (directory / "legislators-historical.yaml").write_text(
        yaml.safe_dump(historical), encoding="utf-8"
    )
    return directory


CURRENT_ENTRY = {
    "id": {"bioguide": "C000001"},
    "name": {"first": "Maria", "last": "Cantwell", "official_full": "Maria Cantwell"},
    "terms": [
        {
            "type": "rep",
            "start": "1993-01-05",
            "end": "1995-01-03",
            "state": "WA",
            "district": 1,
            "party": "Democrat",
        },
        {
            "type": "sen",
            "start": "2001-01-03",
            "end": "2031-01-03",
            "state": "WA",
            "class": 1,
            "party": "Democrat",
        },
    ],
}
HISTORICAL_ENTRY = {
    # No official_full — the historical-majority shape (602 of 12,231).
    "id": {"bioguide": "H000001"},
    "name": {"first": "Old", "last": "Member"},
    "terms": [
        {
            "type": "rep",
            "start": "1901-12-02",
            "end": "1903-03-03",
            "state": "NY",
            "district": 3,
            "party": "Republican",
        }
    ],
}


def test_load_members_counts_fields_and_fallback(initialized_db, tmp_path):
    directory = _write_legislators(tmp_path, [CURRENT_ENTRY], [HISTORICAL_ENTRY])
    report = load_members(initialized_db, directory)
    assert (report.current, report.historical, report.upserted) == (1, 1, 2)
    assert report.skipped == ()

    # Latest-term derivation: Cantwell's latest term is a Senate term.
    row = initialized_db.execute(
        "SELECT full_name, chamber, party, state, district FROM members"
        " WHERE bioguide_id = 'C000001'"
    ).fetchone()
    assert row == ("Maria Cantwell", "senate", "Democrat", "WA", None)
    # official_full-absent fallback composes first + last.
    row = initialized_db.execute(
        "SELECT full_name, chamber, district FROM members WHERE bioguide_id = 'H000001'"
    ).fetchone()
    assert row == ("Old Member", "house", "3")
    # Full dated terms and the full raw entry survive as JSON.
    terms = json.loads(
        initialized_db.execute(
            "SELECT terms FROM members WHERE bioguide_id = 'C000001'"
        ).fetchone()[0]
    )
    assert [t["type"] for t in terms] == ["rep", "sen"]
    raw = json.loads(
        initialized_db.execute(
            "SELECT raw FROM members WHERE bioguide_id = 'C000001'"
        ).fetchone()[0]
    )
    assert raw["id"]["bioguide"] == "C000001"


def test_load_members_is_idempotent_and_updates(initialized_db, tmp_path):
    directory = _write_legislators(tmp_path, [CURRENT_ENTRY], [HISTORICAL_ENTRY])
    load_members(initialized_db, directory)
    changed = dict(CURRENT_ENTRY, name={**CURRENT_ENTRY["name"], "official_full": "M. Cantwell"})
    directory = _write_legislators(tmp_path, [changed], [HISTORICAL_ENTRY])
    report = load_members(initialized_db, directory)
    assert report.upserted == 2
    assert initialized_db.execute("SELECT COUNT(*) FROM members").fetchone() == (2,)
    assert initialized_db.execute(
        "SELECT full_name FROM members WHERE bioguide_id = 'C000001'"
    ).fetchone() == ("M. Cantwell",)


def test_load_members_counts_unloadable_entries(initialized_db, tmp_path):
    no_terms = {"id": {"bioguide": "X000001"}, "name": {"first": "No", "last": "Terms"}, "terms": []}
    no_bioguide = {"id": {}, "name": {"first": "No", "last": "Id"}, "terms": CURRENT_ENTRY["terms"]}
    directory = _write_legislators(tmp_path, [CURRENT_ENTRY], [no_terms, no_bioguide])
    report = load_members(initialized_db, directory)
    assert report.upserted == 1
    assert len(report.skipped) == 2


# --- aliases (R3) -------------------------------------------------------------


def test_load_aliases_full_replace_and_normalization(initialized_db, tmp_path, make_member):
    make_member(initialized_db, "D000001")
    path = tmp_path / "aliases.yaml"
    path.write_text(
        yaml.safe_dump(
            {
                "aliases": [
                    {
                        "alias": "Doe, Jane Q.",
                        "chamber": "house",
                        "state": "CA",
                        "district": 12,
                        "valid_from": "2013-01-03",
                        "bioguide_id": "D000001",
                        "note": "test",
                    }
                ]
            }
        )
    )
    assert load_aliases(initialized_db, path) == 1
    alias, district = initialized_db.execute(
        "SELECT alias, district FROM member_aliases"
    ).fetchone()
    assert alias == "jane q doe"  # stored normalized
    assert district == "12"  # coerced to text

    # Full replace: a second load with an empty file clears the table.
    path.write_text("aliases: []\n")
    assert load_aliases(initialized_db, path) == 0
    assert initialized_db.execute("SELECT COUNT(*) FROM member_aliases").fetchone() == (0,)


@pytest.mark.parametrize(
    "bad_entry,fragment",
    [
        ({"alias": "x", "chamber": "house", "valid_from": "2020-01-01", "bioguide_id": "D000001"}, "note"),
        ({"alias": "x", "chamber": "governor", "valid_from": "2020-01-01", "bioguide_id": "D000001", "note": "n"}, "chamber"),
    ],
)
def test_load_aliases_rejects_invalid_entries(initialized_db, tmp_path, bad_entry, fragment):
    path = tmp_path / "aliases.yaml"
    path.write_text(yaml.safe_dump({"aliases": [bad_entry]}))
    with pytest.raises(ValueError, match=fragment):
        load_aliases(initialized_db, path)


def test_packaged_alias_entries_reference_real_members():
    entries = (yaml.safe_load(default_aliases_text()) or {}).get("aliases") or []
    for entry in entries:
        assert entry.get("note"), f"alias {entry.get('alias')!r} has no justification"
        assert entry.get("chamber") in ("house", "senate")


# --- resolver (R2/R3) ---------------------------------------------------------


def test_resolver_exactly_one_rule(initialized_db, make_member):
    make_member(initialized_db, "D000001", first="Jane", last="Doe")
    resolver = build_resolver(initialized_db)
    assert resolver.resolve("Doe, Jane", "house", "2026-01-10").bioguide_id == "D000001"

    # A second contemporaneous Jane Doe (different state) makes it ambiguous
    # without hints, and resolvable with a state hint.
    make_member(initialized_db, "D000002", first="Jane", last="Doe", state="TX", district="5")
    resolver = build_resolver(initialized_db)
    ambiguous = resolver.resolve("Doe, Jane", "house", "2026-01-10")
    assert (ambiguous.bioguide_id, ambiguous.outcome) == (None, "ambiguous")
    hinted = resolver.resolve("Doe, Jane", "house", "2026-01-10", state="TX")
    assert hinted.bioguide_id == "D000002"


def test_resolver_constraints_chamber_term_state_district(initialized_db, make_member):
    make_member(
        initialized_db,
        "C000001",
        first="Maria",
        last="Cantwell",
        chamber="senate",
        state="WA",
        district=None,
        terms=[
            {"type": "rep", "start": "1993-01-05", "end": "1995-01-03", "state": "WA", "district": 1},
            {"type": "sen", "start": "2001-01-03", "end": "2031-01-03", "state": "WA"},
        ],
    )
    resolver = build_resolver(initialized_db)
    # Per-term type, not the denormalized members.chamber: a 1994 HOUSE
    # filing joins through the rep term even though members.chamber='senate'.
    assert resolver.resolve("Cantwell, Maria", "house", "1994-06-01").bioguide_id == "C000001"
    # No senate term in 1994; no house term in 2026.
    assert resolver.resolve("Cantwell, Maria", "senate", "1994-06-01").bioguide_id is None
    assert resolver.resolve("Cantwell, Maria", "house", "2026-06-01").bioguide_id is None
    assert resolver.resolve("Cantwell, Maria", "senate", "2026-06-01").bioguide_id == "C000001"
    # Term boundaries are inclusive on both ends.
    assert resolver.resolve("Cantwell, Maria", "house", "1993-01-05").bioguide_id == "C000001"
    assert resolver.resolve("Cantwell, Maria", "house", "1995-01-03").bioguide_id == "C000001"
    assert resolver.resolve("Cantwell, Maria", "house", "1995-01-04").bioguide_id is None
    # District is a HARD constraint whenever supplied (R2/R4/F3): a matching
    # district resolves, and a MISMATCHED district resolves to NULL — never
    # silently dropped to attribute the filing to a non-matching member.
    assert resolver.resolve("Cantwell, Maria", "house", "1994-06-01", state="WA", district="1").bioguide_id == "C000001"
    assert resolver.resolve("Cantwell, Maria", "house", "1994-06-01", state="WA", district="9").bioguide_id is None
    assert resolver.resolve("Cantwell, Maria", "house", "1994-06-01", state="OR").bioguide_id is None


def test_resolver_mismatched_district_resolves_to_null(initialized_db, make_member):
    # F3: a filing carrying an incorrect/stale district can never be
    # attributed to a member who does not match it. The only member with
    # this name sits in district 5; a district-3 hint yields NULL.
    make_member(
        initialized_db,
        "D000001",
        first="Jane",
        last="Doe",
        state="TX",
        district="5",
        terms=[{"type": "rep", "start": "2021-01-03", "end": "2027-01-03", "state": "TX", "district": 5}],
    )
    resolver = build_resolver(initialized_db)
    assert resolver.resolve("Doe, Jane", "house", "2026-01-10", state="TX", district="5").bioguide_id == "D000001"
    assert resolver.resolve("Doe, Jane", "house", "2026-01-10", state="TX", district="3").bioguide_id is None
    # A wrong state is equally hard.
    assert resolver.resolve("Doe, Jane", "house", "2026-01-10", state="CA", district="5").bioguide_id is None


def test_resolver_nickname_and_middle_and_initial_forms(initialized_db, make_member):
    make_member(
        initialized_db,
        "M000355",
        first="Mitch",
        last="McConnell",
        official_full="Mitch McConnell",
        chamber="senate",
        state="KY",
        district=None,
        terms=[{"type": "sen", "start": "1985-01-03", "end": "2027-01-03", "state": "KY"}],
    )
    make_member(
        initialized_db,
        "T000278",
        first="Tommy",
        middle="Hawley",
        last="Tuberville",
        chamber="senate",
        state="AL",
        district=None,
        terms=[{"type": "sen", "start": "2021-01-03", "end": "2027-01-03", "state": "AL"}],
    )
    make_member(
        initialized_db,
        "S001190",
        first="Bradley",
        middle="Scott",
        nickname="Brad",
        last="Schneider",
        terms=[{"type": "rep", "start": "2013-01-03", "end": "2027-01-03", "state": "IL", "district": 10}],
        state="IL",
        district="10",
    )
    resolver = build_resolver(initialized_db)
    # Nickname variant.
    assert resolver.resolve("Schneider, Brad", "house", "2026-01-10").bioguide_id == "S001190"
    # first+middle+last variant.
    assert resolver.resolve("Bradley Scott Schneider", "house", "2026-01-10").bioguide_id == "S001190"
    # Middle-token drop: reduced key (first, last).
    assert resolver.resolve("Tuberville, Tommy H", "senate", "2026-01-10").bioguide_id == "T000278"
    # A leading single-letter initial skips to the next token.
    make_member(
        initialized_db,
        "M999999",
        first="Addison",
        middle="Mitchell",
        last="McConnell2",
        chamber="senate",
        state="KY",
        district=None,
        terms=[{"type": "sen", "start": "1985-01-03", "end": "2027-01-03", "state": "KY"}],
    )
    resolver = build_resolver(initialized_db)
    assert (
        resolver.resolve("McConnell2, Jr., A. Mitchell", "senate", "2026-01-10").bioguide_id
        == "M999999"
    )


@pytest.mark.parametrize(
    "filed,expected",
    [
        ("1846-01-11", "Y000001"),  # inside the window
        ("1846-01-12", "Y000001"),  # on the inclusive end bound
        ("1846-01-13", None),  # after the window — no identity time travel
    ],
)
def test_other_names_validity_window_end(initialized_db, make_member, filed, expected):
    # G14: an alternate name applies only inside its own validity bounds.
    make_member(
        initialized_db,
        "Y000001",
        first="David",
        last="Yulee",
        other_names=[{"last": "Levy", "end": "1846-01-12"}],
        terms=[{"type": "rep", "start": "1841-03-04", "end": "1855-03-03", "state": "FL", "district": 0}],
        state="FL",
        district="0",
    )
    resolver = build_resolver(initialized_db)
    assert resolver.resolve("Levy, David", "house", filed).bioguide_id == expected
    # The base name applies at every date with a term.
    assert resolver.resolve("Yulee, David", "house", "1850-01-01").bioguide_id == "Y000001"


@pytest.mark.parametrize(
    "filed,expected",
    [
        ("2004-12-31", None),  # before the start bound
        ("2005-01-01", "N000001"),  # on the inclusive start bound
        ("2005-06-01", "N000001"),  # inside
    ],
)
def test_other_names_validity_window_start(initialized_db, make_member, filed, expected):
    make_member(
        initialized_db,
        "N000001",
        first="Nora",
        last="Newname",
        other_names=[{"last": "Oldname", "start": "2005-01-01"}],
        terms=[{"type": "rep", "start": "2001-01-03", "end": "2011-01-03", "state": "OH", "district": 2}],
        state="OH",
        district="2",
    )
    resolver = build_resolver(initialized_db)
    assert resolver.resolve("Oldname, Nora", "house", filed).bioguide_id == expected


def test_alias_precedence_windows_and_conflict(initialized_db, make_member, make_alias):
    # Two members; the alias decides an otherwise-unmatchable name.
    make_member(initialized_db, "D000001", first="Jane", last="Doe")
    make_member(initialized_db, "S000001", first="Janet", last="Doe", state="TX", district="5")
    make_alias(
        initialized_db,
        alias="J. Doe",
        bioguide_id="D000001",
        valid_from="2020-01-01",
        valid_to="2026-01-01",
    )
    resolver = build_resolver(initialized_db)
    assert resolver.resolve("J. Doe", "house", "2025-06-01").bioguide_id == "D000001"
    # [valid_from, valid_to): the end bound is exclusive.
    assert resolver.resolve("J. Doe", "house", "2026-01-01").bioguide_id is None
    assert resolver.resolve("J. Doe", "house", "2019-12-31").bioguide_id is None
    # Chamber-scoped.
    assert resolver.resolve("J. Doe", "senate", "2025-06-01").bioguide_id is None

    # Two applicable rows naming DIFFERENT members: fail closed.
    make_alias(
        initialized_db,
        alias="J. Doe",
        bioguide_id="S000001",
        state="TX",
        valid_from="2020-06-01",
    )
    resolver = build_resolver(initialized_db)
    conflicted = resolver.resolve("J. Doe", "house", "2025-06-01")
    assert (conflicted.bioguide_id, conflicted.outcome) == (None, "alias_conflict")
    assert alias_overlap_errors(initialized_db)  # and CI flags the file


def test_alias_requires_member_term_overlap(initialized_db, make_member, make_alias):
    # An alias cannot time-travel past the member's terms (G14).
    make_member(
        initialized_db,
        "D000001",
        terms=[{"type": "rep", "start": "2013-01-03", "end": "2015-01-03", "state": "CA", "district": 12}],
    )
    make_alias(initialized_db, alias="Doe, J.", bioguide_id="D000001", valid_from="2013-01-03")
    resolver = build_resolver(initialized_db)
    assert resolver.resolve("Doe, J.", "house", "2014-06-01").bioguide_id == "D000001"
    assert resolver.resolve("Doe, J.", "house", "2016-06-01").bioguide_id is None


def test_alias_does_not_bypass_supplied_district(initialized_db, make_member, make_alias):
    # F2: aliases never bypass the hard state/district constraint. A
    # district-scoped alias applies ONLY to a matching supplied district; a
    # mismatched district resolves to NULL — never attributes the filing to
    # the alias's member. A state-scoped (district-less) alias likewise does
    # NOT apply when a district hint is supplied.
    make_member(initialized_db, "D000001", first="Jane", last="Doe", state="CA", district="12")
    make_alias(
        initialized_db,
        alias="J.Q. Doe",
        bioguide_id="D000001",
        state="CA",
        district="12",
        valid_from="2013-01-03",
    )
    resolver = build_resolver(initialized_db)
    # Matching supplied district → the alias applies.
    assert resolver.resolve("J.Q. Doe", "house", "2014-06-01", state="CA", district="12").bioguide_id == "D000001"
    # MISMATCHED supplied district → NULL (the alias must not bypass it).
    assert resolver.resolve("J.Q. Doe", "house", "2014-06-01", state="CA", district="30").bioguide_id is None
    # Mismatched state → NULL.
    assert resolver.resolve("J.Q. Doe", "house", "2014-06-01", state="TX", district="12").bioguide_id is None
    # With NO district hint (e.g. a source that omits it), the alias applies.
    assert resolver.resolve("J.Q. Doe", "house", "2014-06-01", state="CA").bioguide_id == "D000001"

    # A state-scoped alias (no district) does not apply to a district-hinted
    # filing — it cannot wildcard the supplied district.
    initialized_db.execute("DELETE FROM member_aliases")
    make_alias(
        initialized_db,
        alias="J.Q. Doe",
        bioguide_id="D000001",
        state="CA",
        valid_from="2013-01-03",
    )
    resolver = build_resolver(initialized_db)
    assert resolver.resolve("J.Q. Doe", "house", "2014-06-01", state="CA", district="12").bioguide_id is None
    # ...but it does apply when no district is supplied (e.g. a Senate filing).
    assert resolver.resolve("J.Q. Doe", "house", "2014-06-01", state="CA").bioguide_id == "D000001"


def test_alias_versioned_stale_district_correction(initialized_db, make_member, make_alias):
    # F2/F3: a verified stale SOURCE district is corrected by an alias scoped
    # to the EXACT stale (source_district, date). The member redistricted
    # 6 → 7 in 2025; the source index still prints district 6. Automatic
    # matching for a 2026 filing fails (term district 7 != supplied 6); the
    # correction resolves it, and only for the stale district and window.
    make_member(
        initialized_db,
        "M001218",
        first="Rich",
        middle="Dean",
        last="McCormick",
        official_full="Richard McCormick",
        state="GA",
        district="7",
        terms=[
            {"type": "rep", "start": "2023-01-03", "end": "2025-01-03", "state": "GA", "district": 6},
            {"type": "rep", "start": "2025-01-03", "end": "2027-01-03", "state": "GA", "district": 7},
        ],
    )
    resolver = build_resolver(initialized_db)
    # Without a correction, the 2026 stale-district filing is NULL (hard
    # constraint: supplied 6 != the current GA-7 term district).
    assert resolver.resolve("McCormick, Richard Dean Dr", "house", "2026-04-07", state="GA", district="6").bioguide_id is None
    # A genuine district-7 filing already resolves automatically (supplied 7
    # matches the term), needing no correction.
    assert resolver.resolve("McCormick, Richard Dean Dr", "house", "2026-04-07", state="GA", district="7").bioguide_id == "M001218"

    make_alias(
        initialized_db,
        alias="McCormick, Richard Dean Dr",
        bioguide_id="M001218",
        state="GA",
        district="6",  # the EXACT stale source district
        valid_from="2025-01-03",  # the exact stale window
    )
    resolver = build_resolver(initialized_db)
    # The correction resolves the stale-district-6 2026 filing...
    assert resolver.resolve("McCormick, Richard Dean Dr", "house", "2026-04-07", state="GA", district="6").bioguide_id == "M001218"
    # ...but is scoped to the exact stale district: a different wrong
    # district (8) is NOT wildcarded by the correction — it stays NULL.
    assert resolver.resolve("McCormick, Richard Dean Dr", "house", "2026-04-07", state="GA", district="8").bioguide_id is None


# --- hint builders (R4) -------------------------------------------------------


def test_house_hints_from_index(tmp_path):
    xml = tmp_path / "2026FD.xml"
    xml.write_text(
        """
        <FinancialDisclosure>
          <Member><FilingType>P</FilingType><DocID>20031234</DocID>
            <Last>Doe</Last><First>Jane</First><StateDst>MO04</StateDst>
            <FilingDate>1/10/2026</FilingDate></Member>
          <Member><FilingType>P</FilingType><DocID>20035678</DocID>
            <Last>Roe</Last><First>Al</First><StateDst>AK00</StateDst>
            <FilingDate>1/11/2026</FilingDate></Member>
          <Member><FilingType>A</FilingType><DocID>20039999</DocID>
            <Last>Skip</Last><First>Not</First><StateDst>CA01</StateDst>
            <FilingDate>1/12/2026</FilingDate></Member>
          <Member><FilingType>P</FilingType><DocID>20030001</DocID>
            <Last>Odd</Last><First>Dst</First><StateDst>weird</StateDst>
            <FilingDate>1/13/2026</FilingDate></Member>
        </FinancialDisclosure>
        """
    )
    hints = house_hints_from_index([xml])
    assert hints["house:20031234"] == ("MO", "4")
    assert hints["house:20035678"] == ("AK", "0")  # at-large
    assert "house:20039999" not in hints  # non-PTR
    assert "house:20030001" not in hints  # unparseable StateDst


def test_kadoa_hints_include_state_and_district(tmp_path):
    # R4/F3: House hints carry state AND district parsed from the office
    # suffix; state is backfilled from that suffix when the record's own
    # state field is absent; senate rows carry no district.
    trades = tmp_path / "trades.json"
    trades.write_text(
        json.dumps(
            [
                {
                    "id": "house_1_g0",
                    "branch": "congress",
                    "chamber": "house",
                    "state": "CT",
                    "office": "U.S. Representative · CT-04",
                },
                {
                    "id": "house_2_g0",
                    "branch": "congress",
                    "chamber": "house",
                    "state": None,  # state backfilled from the office suffix
                    "office": "U.S. Representative · CA-39",
                },
                {
                    "id": "senate_00000000-0000-4000-8000-000000000001_t0",
                    "branch": "congress",
                    "chamber": "senate",
                    "state": "AL",
                    "office": "U.S. Senator · AL",
                },
                {"id": "oge_x_g0", "branch": "executive"},
            ]
        )
    )
    hints = kadoa_hints_from_trades(trades)
    assert hints["kadoa:house_1_g0"] == ("CT", "4")  # district parsed
    assert hints["kadoa:house_2_g0"] == ("CA", "39")  # state + district from suffix
    assert hints["kadoa:senate_00000000-0000-4000-8000-000000000001_t0"] == ("AL", None)
    assert len(hints) == 3  # the OGE row contributes nothing


# --- join pass (R4) -----------------------------------------------------------


def test_apply_member_join_updates_both_tables_and_counts(
    initialized_db, make_member, make_filing, make_row
):
    from populus.load import load_filing

    make_member(initialized_db, "D000001", first="Jane", last="Doe")
    make_filing(initialized_db, filing_id="house:1", filer_name_raw="Doe, Jane")
    make_filing(
        initialized_db, filing_id="house:2", filer_name_raw="Nobody, Known"
    )
    for filing_id in ("house:1", "house:2"):
        load_filing(
            initialized_db,
            filing_id,
            [make_row(asset_name=f"A {filing_id}")],
            parse_status="parsed",
            parser_version="t",
            normalization_version="t",
        )
    report = apply_member_join(initialized_db)
    assert isinstance(report, JoinReport)
    assert report.by_source["house-clerk"].filings == 2
    assert report.by_source["house-clerk"].joined == 1
    assert report.unresolved == (("Nobody, Known", "house", "house-clerk", 1),)

    # Both tables updated together; denormalized invariant holds.
    assert initialized_db.execute(
        "SELECT bioguide_id FROM filings WHERE filing_id = 'house:1'"
    ).fetchone() == ("D000001",)
    assert initialized_db.execute(
        "SELECT bioguide_id FROM transactions WHERE filing_id = 'house:1'"
    ).fetchone() == ("D000001",)
    assert initialized_db.execute(
        "SELECT COUNT(*) FROM transactions t JOIN filings f ON f.filing_id = t.filing_id"
        " WHERE t.bioguide_id IS NOT f.bioguide_id"
    ).fetchone() == (0,)

    # Idempotent re-run: nothing changes.
    again = apply_member_join(initialized_db)
    assert again.changed == 0


def test_join_rerun_after_alias_edit_reresolves(
    initialized_db, make_member, make_filing, make_alias
):
    make_member(initialized_db, "D000001", first="Jane", last="Doe")
    make_filing(initialized_db, filing_id="house:1", filer_name_raw="J.Q. Doe")
    assert apply_member_join(initialized_db).joined == 0

    make_alias(initialized_db, alias="J.Q. Doe", bioguide_id="D000001")
    report = apply_member_join(initialized_db)
    assert report.joined == 1
    assert report.changed == 1
    assert initialized_db.execute(
        "SELECT bioguide_id FROM filings WHERE filing_id = 'house:1'"
    ).fetchone() == ("D000001",)


def test_run_members_ingest_writes_audit_row(initialized_db, tmp_path):
    directory = _write_legislators(tmp_path, [CURRENT_ENTRY], [])
    aliases = tmp_path / "aliases.yaml"
    aliases.write_text("aliases: []\n")
    report = run_members_ingest(
        initialized_db,
        legislators_dir=directory,
        aliases_path=aliases,
        run_id="members-test-1",
        now=lambda: "2026-07-23T00:00:00Z",
        host="testhost",
    )
    assert report.members.upserted == 1
    row = initialized_db.execute(
        "SELECT job, status, rows_loaded, new_filings, parse_failures, host"
        " FROM ingest_runs WHERE run_id = 'members-test-1'"
    ).fetchone()
    assert row == ("members", "ok", 1, 0, 0, "testhost")


# --- end-to-end acceptance (R14) ----------------------------------------------


@pytest.mark.skipif(
    not (DATA_CACHE / "kadoa" / "trades.json").exists()
    or not (DATA_CACHE / "house" / "2026FD.xml").exists()
    or not (DATA_CACHE / "senate" / "ptr-index.json").exists()
    or not (DATA_CACHE / "legislators" / "legislators-current.yaml").exists(),
    reason="data-cache not present (local-only acceptance corpus)",
)
def test_end_to_end_cache_acceptance(tmp_path):
    import jsonschema

    from populus import backfill, stats
    from populus.db import connect, init_db
    from populus.ingest import house, senate

    now = lambda: "2026-07-23T00:00:00Z"  # noqa: E731
    db_path = tmp_path / "e2e.db"
    init_db(str(db_path))
    conn = connect(str(db_path))

    house.run_house_ingest(
        conn,
        years=[2015, 2020, 2026],
        raw_root=DATA_CACHE / "house",
        cache_dir=DATA_CACHE / "house",
        run_id="e2e-house",
        now=now,
        host="test",
    )
    senate.run_senate_ingest(
        conn,
        raw_root=DATA_CACHE / "senate",
        cache_dir=DATA_CACHE / "senate",
        run_id="e2e-senate",
        now=now,
        host="test",
    )

    # File-derived expectations — never hardcoded counts (G3).
    records = json.loads((DATA_CACHE / "kadoa" / "trades.json").read_text())
    expected_congress = sum(
        1 for r in records if backfill.classify_row(r) == "congress"
    )
    expected_oge = sum(1 for r in records if backfill.classify_row(r) == "oge")
    expected_documents = {
        (kid.chamber, kid.document_key)
        for kid in (
            backfill.parse_kadoa_id(r.get("id"))
            for r in records
            if backfill.classify_row(r) == "congress"
        )
    }

    started = time.monotonic()
    report = backfill.run_backfill_ingest(
        conn,
        trades_path=DATA_CACHE / "kadoa" / "trades.json",
        run_id="e2e-backfill",
        now=now,
        host="test",
    )
    import_wall_seconds = time.monotonic() - started
    # The 1,104-filing import is 1,104 small transactions by design; the
    # accepted cost is seconds, recorded here.
    assert import_wall_seconds < 60, f"import took {import_wall_seconds:.1f}s"

    assert report.total == len(records)
    assert report.imported == expected_congress
    assert report.excluded_oge == expected_oge
    assert report.excluded_invalid == 0
    assert report.reconciled
    assert conn.execute(
        "SELECT COUNT(*) FROM filings WHERE source = 'kadoa'"
    ).fetchone() == (expected_congress,)
    assert conn.execute(
        "SELECT COUNT(DISTINCT doc_url) FROM filings WHERE source = 'kadoa'"
    ).fetchone() == (len(expected_documents),)

    # Crosswalk reconciliation: every retired kadoa filing points at a
    # parsed/partial primary that shares its document key.
    for kadoa_id, primary in conn.execute(
        "SELECT filing_id, primary_filing_id FROM filings"
        " WHERE source = 'kadoa' AND lifecycle = 'retired'"
    ):
        assert primary is not None
        parsed = backfill.parse_kadoa_id(kadoa_id.split(":", 1)[1])
        assert primary == f"{parsed.chamber}:{parsed.document_key}"
        assert conn.execute(
            "SELECT parse_status FROM filings WHERE filing_id = ?", (primary,)
        ).fetchone()[0] in ("parsed", "partial")

    # Members + join.
    from populus.members import (
        apply_member_join,
        house_hints_from_index,
        kadoa_hints_from_trades,
        load_aliases,
        load_members,
    )

    members_report = load_members(conn, DATA_CACHE / "legislators")
    assert members_report.current == 537
    assert members_report.historical == 12231
    load_aliases(conn)
    apply_member_join(
        conn,
        house_hints=house_hints_from_index(
            sorted((DATA_CACHE / "house").glob("*FD.xml"))
        ),
        kadoa_hints=kadoa_hints_from_trades(DATA_CACHE / "kadoa" / "trades.json"),
    )

    # THE P1 GATE (§9.7): >= 98% of primary-source transactions in the
    # default view joined.
    joined, total = conn.execute(
        "SELECT COUNT(bioguide_id), COUNT(*) FROM v_default_transactions"
        " WHERE source != 'kadoa'"
    ).fetchone()
    assert total > 0
    assert joined / total >= 0.98, f"join coverage {joined}/{total} = {joined/total:.4f}"

    # Stats: schema-valid, source mix reconciles with the DB.
    document = stats.compute_stats(conn, now=now, house_meta=None)
    schema = json.loads(
        (Path(__file__).parent / "schemas" / "stats.schema.json").read_text()
    )
    jsonschema.validate(document, schema)
    mix = document["default"]["source_mix"]
    assert mix["primary_count"] + mix["kadoa_count"] == document["default"]["row_count"]
    assert document["totals"]["filing_count_by_source_including_excluded"]["kadoa"] == (
        expected_congress
    )
    assert document["totals"]["source_document_count_including_excluded"]["kadoa"] == (
        len(expected_documents)
    )
    unresolved_total = sum(
        entry["filing_count"] for entry in document["unresolved_names"]
    )
    assert unresolved_total == conn.execute(
        "SELECT COUNT(*) FROM filings WHERE bioguide_id IS NULL"
    ).fetchone()[0]

    # Audit draw → fill clean → score round-trip on the real population.
    draw = backfill.run_audit_draw(
        conn,
        out_dir=tmp_path / "audit",
        mode="initial",
        seed=7,
        run_id="e2e-draw",
        now=now,
        host="test",
    )
    filled = json.loads(draw.worksheet_json_path.read_text())
    for name, payload in filled["instruments"].items():
        entries = payload.values() if name == "quota" else [payload]
        for entry in entries:
            for row in entry["rows"]:
                row["verification"].update(
                    {field: "ok" for field in backfill.CRITICAL_FIELDS}
                )
                row["verification"].update(
                    cosmetic="none", verified_by="e2e", verified_at="2026-07-23"
                )
    disposition = backfill.score_audit(
        filled, conn, draw_record_bytes=draw.record_path.read_bytes()
    )
    assert disposition.status == "pass"
    assert disposition.required_actions == frozenset()
    assert disposition.binomial_upper_bound == pytest.approx(0.0198, abs=0.0005)

    conn.close()


# --- historical-era join (RUN M1-B, R9) --------------------------------------


def test_historical_era_joins_via_a_temporal_alias_and_unjoined_stay_visible(
    initialized_db, make_member, make_alias, make_filing, make_row
):
    """The 2015 shape: a member who left Congress before the modern corpus
    begins, reached through an alias valid only in their era, and a second
    filer nobody can resolve — retained, flagged NULL, and counted."""
    from populus.amendments import ensure_views
    from populus.load import load_filing
    from populus.members import apply_member_join
    from populus.parse_gate import compute_join_coverage

    conn = initialized_db
    ensure_views(conn)
    make_member(
        conn,
        "H000001",
        first="Ellen",
        last="Historic",
        terms=[
            {
                "type": "rep",
                "start": "2013-01-03",
                "end": "2017-01-03",
                "state": "VA",
                "district": 1,
            }
        ],
    )
    make_alias(
        conn,
        alias="Historic, Ellen",
        bioguide_id="H000001",
        valid_from="2013-01-03",
        valid_to="2017-01-03",
    )

    for filing_id, filer, filed in (
        ("house:20002703", "Historic, Ellen", "2015-03-02"),
        ("house:20003021", "Vanished, Victor", "2015-04-09"),
    ):
        make_filing(
            conn,
            filing_id=filing_id,
            filer_name_raw=filer,
            filed_date=filed,
            doc_url=f"https://example.invalid/{filing_id}",
        )
        load_filing(
            conn,
            filing_id,
            [make_row(asset_name=f"Asset {filing_id}")],
            parse_status="parsed",
            parser_version="t",
            normalization_version="t",
        )

    report = apply_member_join(conn)
    assert report.by_source["house-clerk"].joined == 1

    joined = dict(
        conn.execute("SELECT filing_id, bioguide_id FROM filings ORDER BY filing_id")
    )
    assert joined["house:20002703"] == "H000001"
    assert joined["house:20003021"] is None       # explicit NULL, never dropped
    # The denormalized row column moved with it (the §9.4 CI invariant).
    assert conn.execute(
        "SELECT DISTINCT bioguide_id FROM transactions"
        " WHERE filing_id = 'house:20002703'"
    ).fetchone() == ("H000001",)

    # And the era measurement sees exactly that, filer named.
    era = next(
        c for c in compute_join_coverage(conn) if (c.chamber, c.year) == ("house", "2015")
    )
    assert (era.filings_joined, era.filings, era.filings_unjoined) == (1, 2, 1)
    assert (era.rows_joined, era.rows) == (1, 2)
    assert era.unresolved_filers == ("Vanished, Victor",)


def test_a_2015_filing_does_not_resolve_through_a_modern_only_alias(
    initialized_db, make_member, make_alias
):
    """Temporal aliases are what make the era join honest: an alias opened for
    the modern corpus must not reach back and attribute a 2015 filing."""
    from populus.members import build_resolver

    make_member(
        initialized_db,
        "M000001",
        first="Modern",
        last="Member",
        terms=[
            {
                "type": "rep",
                "start": "2019-01-03",
                "end": "2027-01-03",
                "state": "CA",
                "district": 12,
            }
        ],
    )
    make_alias(
        initialized_db,
        alias="Member, Modern",
        bioguide_id="M000001",
        valid_from="2019-01-03",
    )
    resolver = build_resolver(initialized_db)
    assert resolver.resolve("Member, Modern", "house", "2015-03-02").bioguide_id is None
    assert (
        resolver.resolve("Member, Modern", "house", "2020-03-02").bioguide_id
        == "M000001"
    )
