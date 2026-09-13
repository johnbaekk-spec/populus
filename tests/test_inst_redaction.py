"""C1 (refinement 20260910): a reviewed-ticker security publishes no CUSIP and
no key computed from it.

The property these tests pin is the one the owner decided on 2026-09-11 (HIDE
CUSIP where a verified ticker exists), in the form the counsel concern requires:
not "the CUSIP cell is blank" but "no published column still pairs the CUSIP —
or a CUSIP-derived key — with the ticker".
"""

from __future__ import annotations

import re
import sqlite3
from pathlib import Path

import pytest

from populus.identity.registry import anchor, provisional_security_id
from populus.inst_redaction import (
    DISCLOSURE_WITHHELD_TEXT,
    close_withheld_cusips,
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


# --- F1: the published list SEEDS the next build, so the pass must replay ----


def _replay_registry_db(tmp_path, mapped_row, *, block_size=12):
    """A congress.db whose CUSIP-6 block holds `block_size` classes, so a second
    pass has more than nine withheld values to renumber."""
    path = tmp_path / "congress-replay.db"
    conn = sqlite3.connect(path)
    conn.execute("CREATE TABLE securities (security_id TEXT PRIMARY KEY, entity_id TEXT)")
    conn.execute(
        "CREATE TABLE security_list_intervals (security_id TEXT NOT NULL,"
        " id_type TEXT NOT NULL, value TEXT NOT NULL, valid_from DATE NOT NULL,"
        " issuer_name TEXT, security_class TEXT, source_row TEXT, raw JSON,"
        " PRIMARY KEY (value, valid_from))"
    )
    rows = [(MAPPED_CUSIP, mapped_row.issuer_name_canonical, mapped_row.title_of_class)]
    # Siblings in the SAME block: 88579Y2xx .. enough to pass ten.
    rows += [
        (f"88579Y{200 + i:03d}"[:9], "3M CO", f"NOTE CLASS {i}")
        for i in range(block_size - 1)
    ]
    rows.append((UNMAPPED_CUSIP, "SOME OTHER CORP", "COM"))
    for cusip, name, klass in rows:
        sid = provisional_security_id(anchor("cusip", cusip))
        conn.execute("INSERT OR IGNORE INTO securities VALUES (?, NULL)", (sid,))
        conn.execute(
            "INSERT INTO security_list_intervals VALUES (?,'cusip',?,?,?,?,?,?)",
            (sid, cusip, "2026-01-01", name, klass, f"{cusip}*{name}  {klass}",
             f'{{"id_type":"cusip","value":"{cusip}"}}'),
        )
    conn.commit()
    conn.close()
    return path


def test_a_second_pass_over_the_seeded_artifact_preserves_every_opaque_identity(
    tmp_path, mapped_row
):
    """publish -> seed -> publish. The published congress.db is what
    `populus seed-corpus` restores the next run's corpus from, so
    `apply_registry_redaction` runs again over rows it already withheld. It
    must be IDEMPOTENT: the ordinals it assigned are stable identities, and
    renumbering them collides on PRIMARY KEY (value, valid_from) because
    `withheld:10` sorts before `withheld:2`.
    """
    path = _replay_registry_db(tmp_path, mapped_row, block_size=12)
    # `filed_cusips` is what publish passes: the closure over the FILED
    # holdings, which keep every CUSIP in the build's own store.
    filed = frozenset({MAPPED_CUSIP})
    first = apply_registry_redaction(path, filed_cusips=filed)
    assert first["withheld_cusips"] >= 11, "fewer than eleven never reaches the collision"

    conn = sqlite3.connect(path)
    after_first = dict(
        conn.execute("SELECT issuer_name || '|' || security_class, value"
                     " FROM security_list_intervals")
    )
    sids_first = {r[0] for r in conn.execute("SELECT security_id FROM securities")}
    conn.close()
    assert sum(v.startswith("withheld:") for v in after_first.values()) >= 11

    # The SECOND pass, on the artifact as the next build receives it.
    second = apply_registry_redaction(path, filed_cusips=filed)
    assert second["withheld_cusips"] == 0, (
        "an already-withheld row was re-planned; 'withhe' is not an issuer block"
    )

    conn = sqlite3.connect(path)
    after_second = dict(
        conn.execute("SELECT issuer_name || '|' || security_class, value"
                     " FROM security_list_intervals")
    )
    sids_second = {r[0] for r in conn.execute("SELECT security_id FROM securities")}
    values = [r[0] for r in conn.execute("SELECT value FROM security_list_intervals")]
    conn.close()
    assert after_second == after_first, "an opaque identity moved between publishes"
    assert sids_second == sids_first, "a withheld security_id was reassigned"
    assert len(values) == len(set(values)), "the replay collided on (value, valid_from)"


def test_a_newly_listed_security_is_numbered_above_the_ordinals_already_in_use(
    tmp_path, mapped_row
):
    """A security added AFTER the first publish must not be handed an ordinal
    the seeded artifact already holds."""
    path = _replay_registry_db(tmp_path, mapped_row, block_size=12)
    filed = frozenset({MAPPED_CUSIP})
    first = apply_registry_redaction(path, filed_cusips=filed)
    taken = first["withheld_cusips"]

    # The SEC adds another class in the same reviewed block before the next run.
    new_cusip = "88579Y999"
    sid = provisional_security_id(anchor("cusip", new_cusip))
    conn = sqlite3.connect(path)
    conn.execute("INSERT INTO securities VALUES (?, NULL)", (sid,))
    conn.execute(
        "INSERT INTO security_list_intervals VALUES (?,'cusip',?,?,?,?,?,?)",
        (sid, new_cusip, "2026-06-30", "3M CO", "NOTE NEW CLASS",
         f"{new_cusip}*3M CO  NOTE NEW CLASS",
         f'{{"id_type":"cusip","value":"{new_cusip}"}}'),
    )
    conn.commit()
    conn.close()

    second = apply_registry_redaction(path, filed_cusips=filed)
    assert second["withheld_cusips"] == 1, "the new class is withheld, the old ones are not"

    conn = sqlite3.connect(path)
    values = [r[0] for r in conn.execute("SELECT value FROM security_list_intervals")]
    conn.close()
    assert len(values) == len(set(values)), "the new ordinal collided with an existing one"
    assert f"withheld:{taken + 1}" in values, "the new class did not take the next free ordinal"
    assert new_cusip.encode() not in path.read_bytes()


# --- F2: the closure is ONE implementation, shared with the join probe -------


def test_the_closure_follows_a_shared_security_id_edge_not_only_the_block():
    """The producer closes over TWO edges. A CUSIP that shares a security_id with
    a withheld member is withheld, and the further block THAT CUSIP carries
    follows it. The join probe derives its truth from this same function, so a
    single-hop version of it would leave this population unverified.
    """
    shared_sid = provisional_security_id(anchor("cusip", MAPPED_CUSIP))
    far_cusip = "594918104"        # a different block entirely
    far_sibling = "594918302"      # ...whose sibling rides along
    rows = [
        ("3M CO", "COM", MAPPED_CUSIP, shared_sid),
        ("3M CO", "NOTE 2.25% 2026", SIBLING_CUSIP, None),
        # Reached ONLY through the shared security_id — no block relation at all.
        ("RENAMED HOLDCO", "COM", far_cusip, shared_sid),
        ("RENAMED HOLDCO", "CLASS B", far_sibling, None),
        ("SOME OTHER CORP", "COM", UNMAPPED_CUSIP, None),
    ]
    closure = close_withheld_cusips(rows)
    assert MAPPED_CUSIP in closure.mapped
    assert SIBLING_CUSIP in closure.cusips, "the block edge"
    assert far_cusip in closure.cusips, "the shared-security_id edge"
    assert far_sibling in closure.cusips, "the block the security-id edge reached"
    assert UNMAPPED_CUSIP not in closure.cusips, "the closure is closed, not everything"
    # Every member names the ticker it is joinable to, so the probe can report it.
    assert closure.tickers[far_cusip] == closure.tickers[MAPPED_CUSIP]
    assert closure.tickers[far_sibling] == closure.tickers[MAPPED_CUSIP]


def test_a_replay_without_a_cusip_bearing_source_refuses_instead_of_under_withholding(
    tmp_path, mapped_row
):
    """The seeded artifact cannot name its own withheld blocks — that is what
    withholding them means. Re-running with no `filed_cusips` and no
    `inst_source` could only under-withhold, so it refuses.
    """
    path = _replay_registry_db(tmp_path, mapped_row, block_size=12)
    apply_registry_redaction(path, filed_cusips=frozenset({MAPPED_CUSIP}))
    with pytest.raises(ValueError, match="seeded artifact"):
        apply_registry_redaction(path)


# --- T1 (2026-09-13): CUSIPs a MEMBER wrote into disclosure text -------------
#
# The owner's decision closing the one residual C1 named at release: three
# CUSIPs in five rows of `transactions.comment` and its verbatim `raw_row`
# copy, where the filer stated BOTH identifiers in one sentence. Nothing about
# those cells is a CUSIP column, so every pass above walks straight past them.


DISCLOSURE_SENTENCE = (
    "11/3/23 Buy 247 shares of EOG Resources, Inc, cusip {cusip}, ticker EOG,"
    " at a price of $125.6342/share."
)
RECEIPT_URL = "https://disclosures-clerk.house.gov/public_disc/ptr-pdfs/2023/20024109.pdf"


def _disclosure_db(tmp_path, mapped_row):
    """A congress.db-shaped copy carrying BOTH published surfaces: the SEC 13F
    list (so the whole pass runs as publish runs it) and a `transactions` table
    whose comment states a withheld CUSIP beside its ticker, with the filing's
    receipt link beside it."""
    path = _registry_db(tmp_path, mapped_row)
    conn = sqlite3.connect(path)
    conn.execute("CREATE TABLE filings (filing_id TEXT PRIMARY KEY, doc_url TEXT)")
    conn.execute("INSERT INTO filings VALUES ('house:20024109', ?)", (RECEIPT_URL,))
    conn.execute(
        "CREATE TABLE transactions (txn_id TEXT PRIMARY KEY, filing_id TEXT,"
        " comment TEXT, raw_row TEXT NOT NULL, ticker TEXT, asset_name TEXT)"
    )
    rows = [
        # The owner's case: the member paired the two identifiers themselves.
        ("t:withheld", "house:20024109",
         DISCLOSURE_SENTENCE.format(cusip=MAPPED_CUSIP), "MMM"),
        # A sibling class in the same reviewed block — closed over, so withheld.
        ("t:sibling", "house:20024109",
         DISCLOSURE_SENTENCE.format(cusip=SIBLING_CUSIP), "MMM"),
        # An UNMAPPED security's CUSIP pairs with no ticker: it must SURVIVE.
        # Over-redaction is a defect too — it edits the congressional record
        # for nothing.
        ("t:kept", "house:20024109",
         DISCLOSURE_SENTENCE.format(cusip=UNMAPPED_CUSIP), None),
    ]
    for txn_id, filing_id, comment, ticker in rows:
        raw = (
            '{"asset_name":"EOG Resources, Inc. (EOG) [ST]","comment":'
            + f'"{comment}"'
            + ',"side":"P"}'
        )
        conn.execute(
            "INSERT INTO transactions VALUES (?,?,?,?,?,?)",
            (txn_id, filing_id, comment, raw, ticker, "EOG Resources, Inc. (EOG) [ST]"),
        )
    conn.commit()
    conn.close()
    return path


def test_a_cusip_the_filer_wrote_into_disclosure_text_is_withheld_visibly(
    tmp_path, mapped_row
):
    """Pre-change this FAILS: `apply_registry_redaction` rewrote the SEC list
    and nothing else, so the member's sentence published the CUSIP verbatim
    next to the ticker and the join probe reported the pair."""
    path = _disclosure_db(tmp_path, mapped_row)
    counts = apply_registry_redaction(path, filed_cusips=frozenset({MAPPED_CUSIP}))

    assert counts["transactions.comment"] == 2, "the mapped class and its block sibling"
    assert counts["transactions.raw_row"] == 2

    conn = sqlite3.connect(path)
    by_id = {
        r[0]: r[1:]
        for r in conn.execute("SELECT txn_id, comment, raw_row FROM transactions")
    }
    conn.close()

    for txn_id in ("t:withheld", "t:sibling"):
        comment, raw = by_id[txn_id]
        # VISIBLE, not a silent deletion: the reader can see an edit was made.
        assert DISCLOSURE_WITHHELD_TEXT in comment, txn_id
        assert DISCLOSURE_WITHHELD_TEXT in raw, txn_id
        # Every other word of the filer's sentence survives, including the
        # ticker they stated — only the identifier is withheld.
        assert "247 shares of EOG Resources" in comment
        assert "ticker EOG" in comment
        assert "$125.6342/share" in comment

    # An unmapped security pairs with nothing, so its CUSIP is NOT edited.
    kept_comment, kept_raw = by_id["t:kept"]
    assert UNMAPPED_CUSIP in kept_comment and UNMAPPED_CUSIP in kept_raw

    # Nothing is dropped, and the raw bytes carry no copy in a freed page —
    # the probe reads the file, not the live rows.
    assert len(by_id) == 3
    blob = path.read_bytes()
    assert MAPPED_CUSIP.encode() not in blob
    assert SIBLING_CUSIP.encode() not in blob


def test_the_receipt_link_still_points_at_the_unaltered_source_document(
    tmp_path, mapped_row
):
    """The withheld text must stay one click from the original. If the receipt
    moved — or were cleared the way `security_list_intervals.raw` is — the edit
    would become unverifiable rather than merely visible."""
    path = _disclosure_db(tmp_path, mapped_row)
    apply_registry_redaction(path, filed_cusips=frozenset({MAPPED_CUSIP}))
    conn = sqlite3.connect(path)
    urls = dict(conn.execute("SELECT filing_id, doc_url FROM filings"))
    joined = conn.execute(
        "SELECT f.doc_url FROM transactions t JOIN filings f USING (filing_id)"
        " WHERE t.txn_id = 't:withheld'"
    ).fetchone()
    conn.close()
    assert urls["house:20024109"] == RECEIPT_URL
    assert joined == (RECEIPT_URL,)


def test_the_disclosure_sweep_is_idempotent_across_a_seeded_republish(
    tmp_path, mapped_row
):
    """The published congress.db seeds the next build, so this pass runs again
    over text it already marked. The marker carries no CUSIP-shaped token, so
    a second pass must change nothing at all."""
    path = _disclosure_db(tmp_path, mapped_row)
    filed = frozenset({MAPPED_CUSIP})
    apply_registry_redaction(path, filed_cusips=filed)
    first = sqlite3.connect(path)
    before = first.execute(
        "SELECT txn_id, comment, raw_row FROM transactions ORDER BY txn_id"
    ).fetchall()
    first.close()

    second = apply_registry_redaction(path, filed_cusips=filed)
    assert second["transactions.comment"] == 0
    assert second["transactions.raw_row"] == 0
    conn = sqlite3.connect(path)
    after = conn.execute(
        "SELECT txn_id, comment, raw_row FROM transactions ORDER BY txn_id"
    ).fetchall()
    conn.close()
    assert after == before


def test_a_congress_db_with_no_sec_list_still_has_its_disclosure_text_swept(
    tmp_path, mapped_row
):
    """The list pass returns early when `security_list_intervals` is absent.
    The disclosure sweep must not be behind that exit — an artifact without the
    list is an ordinary shape, not a reason to publish the CUSIP.

    Without the list, the BLOCK is unknowable: the sibling class is reachable
    only through the list's own rows. So the sweep covers exactly the caller's
    closed set and says so, rather than appearing to cover more. This is the
    weaker of the two behaviours and it is asserted as such deliberately —
    publish always passes the list, and the case above pins the full set."""
    path = _disclosure_db(tmp_path, mapped_row)
    conn = sqlite3.connect(path)
    conn.execute("DROP TABLE security_list_intervals")
    conn.commit()
    conn.close()

    counts = apply_registry_redaction(path, filed_cusips=frozenset({MAPPED_CUSIP}))
    assert counts["security_list_intervals.absent"] == 0
    assert counts["transactions.comment"] == 1, "the caller's set, with no block to close over"
    assert MAPPED_CUSIP.encode() not in path.read_bytes()
    assert SIBLING_CUSIP.encode() in path.read_bytes(), (
        "an unreachable block member is left alone, not guessed at"
    )


def test_the_dashboard_marker_matches_the_publishers(tmp_path):
    """Two copies of one string, in two languages. The dashboard counts rows by
    matching this literal; a diverged copy would report "none withheld" on a
    build that withheld some, which is the shape of a false green."""
    ts = (
        Path(__file__).resolve().parents[1]
        / "dashboard" / "src" / "lib" / "data.ts"
    ).read_text(encoding="utf-8")
    match = re.search(r'CUSIP_WITHHELD_MARKER\s*=\s*"([^"]+)"', ts)
    assert match is not None, "the dashboard constant was renamed or removed"
    assert match.group(1) == DISCLOSURE_WITHHELD_TEXT
