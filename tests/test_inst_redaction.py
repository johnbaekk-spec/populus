"""C1 (refinement 20260910): a reviewed-ticker security publishes no CUSIP and
no key computed from it.

The property these tests pin is the one the owner decided on 2026-09-11 (HIDE
CUSIP where a verified ticker exists), in the form the counsel concern requires:
not "the CUSIP cell is blank" but "no published column still pairs the CUSIP —
or a CUSIP-derived key — with the ticker".
"""

from __future__ import annotations

import sqlite3

import pytest

from populus.identity.registry import anchor, provisional_security_id
from populus.inst_redaction import (
    WITHHELD_ISSUER_PREFIX,
    WITHHELD_POSITION_PREFIX,
    apply_cusip_redaction,
    apply_registry_redaction,
    plan_cusip_redaction,
)
from populus.ticker_mapping_13f import load_ticker_mapping

MAPPED_CUSIP = "88579Y101"      # 3M CO / COM -> MMM in the reviewed mapping
SIBLING_CUSIP = "88579Y200"     # another class in the SAME CUSIP-6 block
UNMAPPED_CUSIP = "123456789"    # no reviewed row names it


@pytest.fixture()
def mapped_row():
    row = next(
        r for r in load_ticker_mapping().rows
        if r.issuer_name_canonical == "3M CO" and r.title_of_class == "COM"
    )
    return row


@pytest.fixture()
def source(tmp_path, mapped_row):
    """A source shaped like the snapshot: one mapped row, one sibling class in
    the same issuer block, one unrelated security."""
    conn = sqlite3.connect(tmp_path / "source.db")
    conn.execute(
        "CREATE TABLE inst_holdings (issuer_name_raw TEXT, title_of_class TEXT,"
        " cusip TEXT, security_id TEXT)"
    )
    conn.executemany(
        "INSERT INTO inst_holdings VALUES (?, ?, ?, ?)",
        [
            (mapped_row.issuer_name_canonical, mapped_row.title_of_class, MAPPED_CUSIP,
             provisional_security_id(anchor("cusip", MAPPED_CUSIP))),
            ("3M CO", "NOTE 2.25% 2026", SIBLING_CUSIP,
             provisional_security_id(anchor("cusip", SIBLING_CUSIP))),
            ("SOME OTHER CORP", "COM", UNMAPPED_CUSIP,
             provisional_security_id(anchor("cusip", UNMAPPED_CUSIP))),
        ],
    )
    conn.commit()
    return conn


def _published(tmp_path, plan_rows):
    path = tmp_path / "published.db"
    conn = sqlite3.connect(path)
    conn.execute(
        "CREATE TABLE serving_filer_rows (security_id TEXT, cusip TEXT,"
        " issuer_name TEXT, position_key TEXT, issuer_key TEXT)"
    )
    conn.executemany("INSERT INTO serving_filer_rows VALUES (?, ?, ?, ?, ?)", plan_rows)
    conn.commit()
    conn.close()
    return path


def test_plan_covers_the_whole_issuer_block_and_the_derived_ids(source):
    plan = plan_cusip_redaction(source)
    assert MAPPED_CUSIP in plan.mapped_cusips
    # The sibling class carries the same CUSIP-6, and the block is joinable to
    # the ticker through the shared issuer key — so it is withheld too.
    assert plan.cusips == {MAPPED_CUSIP, SIBLING_CUSIP}
    assert UNMAPPED_CUSIP not in plan.cusips, "an unmapped security keeps today's behaviour"
    assert provisional_security_id(anchor("cusip", MAPPED_CUSIP)) in plan.security_ids
    assert plan.blocks == {MAPPED_CUSIP[:6]}
    assert f"cusip6:{MAPPED_CUSIP[:6]}" in plan.issuer_keys


def test_no_published_column_pairs_a_withheld_cusip_with_anything(tmp_path, source):
    plan = plan_cusip_redaction(source)
    mapped_sid = provisional_security_id(anchor("cusip", MAPPED_CUSIP))
    other_sid = provisional_security_id(anchor("cusip", UNMAPPED_CUSIP))
    path = _published(tmp_path, [
        (mapped_sid, MAPPED_CUSIP, "3M CO", f"sid:{mapped_sid}", f"cusip6:{MAPPED_CUSIP[:6]}"),
        (None, SIBLING_CUSIP, "3M CO", f"cusip:{SIBLING_CUSIP}", f"cusip6:{MAPPED_CUSIP[:6]}"),
        (other_sid, UNMAPPED_CUSIP, "SOME OTHER CORP", f"sid:{other_sid}", "cusip6:123456"),
    ])
    apply_cusip_redaction(plan, path)

    conn = sqlite3.connect(path)
    rows = conn.execute(
        "SELECT security_id, cusip, position_key, issuer_key FROM serving_filer_rows"
        " ORDER BY issuer_name, position_key"
    ).fetchall()
    withheld = [r for r in rows if r[2].startswith(WITHHELD_POSITION_PREFIX)]
    assert len(withheld) == 2, "both classes of the reviewed issuer are withheld"
    for security_id, cusip, position_key, issuer_key in withheld:
        assert security_id is None and cusip is None
        assert issuer_key.startswith(WITHHELD_ISSUER_PREFIX)
    # One issuer block, one opaque issuer key — the aggregation grain survives.
    assert len({r[3] for r in withheld}) == 1

    # The unmapped security is untouched: today's behaviour, as decided.
    assert (other_sid, UNMAPPED_CUSIP, f"sid:{other_sid}", "cusip6:123456") in rows

    # And the file itself carries no withheld value anywhere — not in a live
    # row, not in a freed page (the pass runs with secure_delete + VACUUM).
    blob = path.read_bytes()
    for token in (MAPPED_CUSIP, SIBLING_CUSIP, mapped_sid, f"cusip6:{MAPPED_CUSIP[:6]}"):
        assert token.encode() not in blob, f"{token} still recoverable from the file"
    assert UNMAPPED_CUSIP.encode() in blob


def test_the_opaque_map_is_shared_so_cross_file_joins_survive(tmp_path, source):
    """The aggregate and the serving projection are joined on `position_key`;
    one plan rewrites both, so the join still holds after redaction."""
    plan = plan_cusip_redaction(source)
    mapped_sid = provisional_security_id(anchor("cusip", MAPPED_CUSIP))
    a = _published(tmp_path / "a", [(mapped_sid, MAPPED_CUSIP, "3M CO",
                                     f"sid:{mapped_sid}", f"cusip6:{MAPPED_CUSIP[:6]}")])
    b = _published(tmp_path / "b", [(mapped_sid, MAPPED_CUSIP, "3M CO",
                                     f"sid:{mapped_sid}", f"cusip6:{MAPPED_CUSIP[:6]}")])
    apply_cusip_redaction(plan, a)
    apply_cusip_redaction(plan, b)
    key_a = sqlite3.connect(a).execute("SELECT position_key FROM serving_filer_rows").fetchone()
    key_b = sqlite3.connect(b).execute("SELECT position_key FROM serving_filer_rows").fetchone()
    assert key_a == key_b


@pytest.fixture(autouse=True)
def _mkdirs(tmp_path):
    (tmp_path / "a").mkdir(exist_ok=True)
    (tmp_path / "b").mkdir(exist_ok=True)


# --- the published congress.db's SEC 13F list (C1 addendum) ------------------


def _registry_db(tmp_path, mapped_row):
    """A congress.db-shaped copy: the SEC list table plus the securities rows it
    references, with one reviewed issuer, one sibling class in its CUSIP-6 block,
    and one unrelated security."""
    path = tmp_path / "congress.db"
    conn = sqlite3.connect(path)
    conn.execute(
        "CREATE TABLE securities (security_id TEXT PRIMARY KEY, entity_id TEXT)"
    )
    conn.execute(
        "CREATE TABLE security_list_intervals (security_id TEXT NOT NULL,"
        " id_type TEXT NOT NULL, value TEXT NOT NULL, valid_from DATE NOT NULL,"
        " issuer_name TEXT, security_class TEXT, source_row TEXT, raw JSON,"
        " PRIMARY KEY (value, valid_from))"
    )
    rows = [
        (MAPPED_CUSIP, mapped_row.issuer_name_canonical, mapped_row.title_of_class),
        (SIBLING_CUSIP, "3M CO", "NOTE 2.25% 2026"),
        (UNMAPPED_CUSIP, "SOME OTHER CORP", "COM"),
    ]
    for cusip, name, klass in rows:
        sid = provisional_security_id(anchor("cusip", cusip))
        conn.execute("INSERT INTO securities VALUES (?, NULL)", (sid,))
        conn.execute(
            "INSERT INTO security_list_intervals VALUES (?,'cusip',?,?,?,?,?,?)",
            (sid, cusip, "2026-01-01", name, klass, f"{cusip}*{name}  {klass}",
             f'{{"id_type":"cusip","value":"{cusip}"}}'),
        )
    conn.commit()
    conn.close()
    return path


def test_the_published_list_withholds_a_reviewed_issuers_cusip(tmp_path, mapped_row):
    path = _registry_db(tmp_path, mapped_row)
    counts = apply_registry_redaction(path)
    assert counts["withheld_cusips"] == 2, "the whole CUSIP-6 block, not just the mapped class"

    conn = sqlite3.connect(path)
    kept = conn.execute(
        "SELECT value, issuer_name, security_class, source_row, raw"
        " FROM security_list_intervals ORDER BY value"
    ).fetchall()
    # Every row SURVIVES — the list is the next build's corpus, so nothing is
    # dropped; only the CUSIP and what it derives are withheld.
    assert len(kept) == 3
    withheld = [r for r in kept if r[0].startswith("withheld:")]
    assert len(withheld) == 2
    for value, name, klass, source_row, raw in withheld:
        assert source_row is None and raw is None, "the CUSIP is echoed in both"
        assert name is not None and klass is not None, "issuer identity is kept"
    # The unmapped security is untouched: publishing CUSIPs alone is pre-existing.
    assert any(r[0] == UNMAPPED_CUSIP for r in kept)

    # The derived security id follows, in BOTH tables, so the FK still resolves.
    sids = {r[0] for r in conn.execute("SELECT security_id FROM securities")}
    list_sids = {r[0] for r in conn.execute("SELECT security_id FROM security_list_intervals")}
    assert list_sids <= sids, "a list row points at a securities row that is gone"
    assert sum(s.startswith("sec:withheld:") for s in sids) == 2

    # And nothing recoverable is left in the file, including freed pages.
    blob = path.read_bytes()
    for token in (MAPPED_CUSIP, SIBLING_CUSIP,
                  provisional_security_id(anchor("cusip", MAPPED_CUSIP))):
        assert token.encode() not in blob, f"{token} still recoverable"
    assert UNMAPPED_CUSIP.encode() in blob


def test_a_cusip_written_inside_a_filers_own_text_is_withheld_too(tmp_path, source):
    """Measured on real data: managers describe corporate actions in the issuer-name
    field ("EXXON MOBIL CORP COM EXCHANGED FOR CUSIP 30233Q108"), and an ISIN carries
    the CUSIP as its middle nine characters. Those rows share an opaque position key
    with the properly-named rows that carry the ticker, so an embedded CUSIP is just
    as joinable as the column was. Exact-match scrubbing alone left four of them."""
    plan = plan_cusip_redaction(source)
    mapped_sid = provisional_security_id(anchor("cusip", MAPPED_CUSIP))
    path = _published(tmp_path, [
        (mapped_sid, MAPPED_CUSIP, f"3M CO COM EXCHANGED FOR CUSIP {MAPPED_CUSIP}",
         f"sid:{mapped_sid}", f"cusip6:{MAPPED_CUSIP[:6]}"),
        (None, None, f"3M CO REGISTERED SHS ISIN#US{MAPPED_CUSIP}7", "pos:9", "iss:9"),
        (None, None, f"SOME OTHER CORP {UNMAPPED_CUSIP}", f"cusip:{UNMAPPED_CUSIP}",
         "cusip6:123456"),
    ])
    apply_cusip_redaction(plan, path)

    names = [r[0] for r in sqlite3.connect(path).execute(
        "SELECT issuer_name FROM serving_filer_rows ORDER BY issuer_name")]
    assert not any(MAPPED_CUSIP in n for n in names), names
    # The filer's own words survive around the withheld identifier.
    assert any(n.startswith("3M CO COM EXCHANGED FOR CUSIP") for n in names), names
    assert any("(CUSIP withheld)" in n for n in names), names
    # An unmapped security's text is untouched.
    assert f"SOME OTHER CORP {UNMAPPED_CUSIP}" in names
    assert MAPPED_CUSIP.encode() not in path.read_bytes()
