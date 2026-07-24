"""Registry-revision migration: convergence, interval cutting, supersessions.

The contract under test (R17): applying a revised `securities.yaml` to an
already-POPULATED database and re-running the same corpus produces `securities`
and `security_identifiers` rows **row-identical** to a clean build with that
registry and corpus. The append-only supersession ledger — which a clean build
legitimately lacks — is the only permitted difference.

That is what makes a reviewed identity declaration safe to land on a live
registry: the answer does not depend on whether the declaration arrived before
or after the data.
"""

from __future__ import annotations

import sqlite3
from pathlib import Path

import pytest

from populus.db import connect, init_db
from populus.identity.bootstrap import bootstrap_ftd, parse_ftd
from populus.identity.registry import (
    SECURITY_ID_REFERENCING_TABLES,
    anchor,
    load_identity_registry,
    provisional_security_id,
    reconcile_identity_registry,
    reconcile_only,
    resolve_cusip,
    resolve_security_successor,
    resolve_superseded,
)

FIXTURES = Path(__file__).resolve().parent / "fixtures" / "inst"
IDENTITY_FIXTURES = FIXTURES / "identity"
FTD_FIXTURES = FIXTURES / "ftd"



def empty_registry():
    from populus.identity.registry import parse_identity_registry

    return parse_identity_registry("classes: []\ncontinuities: []\n")


def _fresh_db(tmp_path, name):
    path = tmp_path / name
    init_db(str(path))
    return connect(str(path))


def _feed(conn, registry, *corpora):
    """Reconcile then re-run the corpus, exactly as the bootstrap command does."""
    observations, disposition = parse_ftd([FTD_FIXTURES / name for name in corpora])
    conn.execute("BEGIN IMMEDIATE")
    try:
        mutations = reconcile_identity_registry(conn, registry)
        report = bootstrap_ftd(
            conn,
            observations,
            registry=registry,
            disposition=disposition,
            mutations=mutations,
        )
        conn.execute("COMMIT")
    except BaseException:
        conn.execute("ROLLBACK")
        raise
    return report


def _snapshot(conn):
    """The two tables the convergence contract covers, fully ordered."""
    return {
        "securities": conn.execute(
            "SELECT security_id, id_state, class, entity_id, entity_candidates,"
            " entity_link_state, review_state FROM securities ORDER BY security_id"
        ).fetchall(),
        "security_identifiers": conn.execute(
            "SELECT security_id, id_type, value, valid_from, valid_to, provenance,"
            " confidence, review_state, license_id FROM security_identifiers"
            " ORDER BY id_type, value, valid_from"
        ).fetchall(),
    }


def _ledger(conn):
    return conn.execute(
        "SELECT old_security_id, security_id, reason FROM security_supersessions"
        " ORDER BY old_security_id, security_id"
    ).fetchall()


# --- transaction discipline ---------------------------------------------------


def test_reconcile_requires_an_open_transaction(initialized_db):
    registry = load_identity_registry(IDENTITY_FIXTURES / "securities-class.yaml")
    with pytest.raises(sqlite3.ProgrammingError) as excinfo:
        reconcile_identity_registry(initialized_db, registry)
    assert "open transaction" in str(excinfo.value)
    # The bracketing wrapper is the standalone entry point.
    reconcile_only(initialized_db, registry)
    assert not initialized_db.in_transaction


def test_every_fk_to_securities_is_repointed(initialized_db):
    # Interlock: adding a table with an FK to `securities` without adding it to
    # SECURITY_ID_REFERENCING_TABLES would silently orphan its rows at the next
    # promotion. This fails the moment that happens.
    registry_tables = [
        name
        for (name,) in initialized_db.execute(
            "SELECT name FROM sqlite_master WHERE type = 'table'"
        )
    ]
    referencing = set()
    for table in registry_tables:
        for row in initialized_db.execute(
            f"PRAGMA foreign_key_list({table})"  # nosec B608 — a sqlite_master name
        ):
            if row[2] == "securities":
                referencing.add(table)
    assert referencing == set(SECURITY_ID_REFERENCING_TABLES)


# --- empty -> class (promotion + merge) ---------------------------------------


def test_empty_to_class_converges_with_a_clean_build(tmp_path):
    corpus = ("cnsfails-boundary-span.txt",)
    declared = load_identity_registry(IDENTITY_FIXTURES / "securities-class.yaml")

    populated = _fresh_db(tmp_path, "populated.db")
    _feed(populated, empty_registry(), *corpus)
    provisional_ids = {
        value: provisional_security_id(anchor("cusip", value))
        for value in ("111111111", "333333333")
    }
    assert set(
        security_id
        for (security_id,) in populated.execute("SELECT security_id FROM securities")
    ) == set(provisional_ids.values())

    report = _feed(populated, declared, *corpus)

    clean = _fresh_db(tmp_path, "clean.db")
    _feed(clean, declared, *corpus)

    assert _snapshot(populated) == _snapshot(clean)
    # One declared security now owns both bindings.
    assert [row[0] for row in _snapshot(populated)["securities"]] == [
        "sec:test-issuer-common"
    ]
    # Two supersessions — one per promoted provisional id — and a clean build
    # legitimately has none.
    assert _ledger(populated) == [
        (provisional_ids["111111111"], "sec:test-issuer-common", "promotion"),
        (provisional_ids["333333333"], "sec:test-issuer-common", "promotion"),
    ]
    assert _ledger(clean) == []
    for provisional in provisional_ids.values():
        assert (
            resolve_security_successor(populated, provisional)
            == "sec:test-issuer-common"
        )
    assert report.mutations.securities_promoted == 2
    assert report.mutations.supersessions_recorded == 2
    # Both bindings changed owner without crossing a boundary: moved, not cut.
    assert report.mutations.intervals_moved == 2
    assert report.mutations.intervals_cut == 0
    populated.close()
    clean.close()


def test_class_chain_extension_keeps_the_id_and_collapses_the_chain(tmp_path):
    # Revision 1 declares the class; revision 2 adds a fourth identifier that
    # was provisional in between. The class id must be byte-identical, and the
    # ORIGINAL predecessor must still resolve to it.
    base = load_identity_registry(IDENTITY_FIXTURES / "securities-class.yaml")
    extended = load_identity_registry(
        IDENTITY_FIXTURES / "securities-class-extended.yaml"
    )
    corpus = ("cnsfails-boundary-span.txt",)

    populated = _fresh_db(tmp_path, "populated.db")
    _feed(populated, empty_registry(), *corpus)
    first_predecessor = provisional_security_id(anchor("cusip", "111111111"))
    _feed(populated, base, *corpus)
    identity_before = [
        row[0] for row in _snapshot(populated)["securities"]
    ]
    _feed(populated, extended, *corpus)
    identity_after = [row[0] for row in _snapshot(populated)["securities"]]
    assert identity_before == identity_after == ["sec:test-issuer-common"]

    clean = _fresh_db(tmp_path, "clean.db")
    _feed(clean, extended, *corpus)
    assert _snapshot(populated) == _snapshot(clean)
    # Chain collapsing: the first predecessor still points at the live id.
    assert (
        resolve_security_successor(populated, first_predecessor)
        == "sec:test-issuer-common"
    )
    populated.close()
    clean.close()


# --- declared class -> split over a boundary-crossing interval ----------------


def test_declared_class_split_cuts_the_interval_and_keeps_the_incumbent(tmp_path):
    base = load_identity_registry(IDENTITY_FIXTURES / "securities-class.yaml")
    split = load_identity_registry(IDENTITY_FIXTURES / "securities-class-split.yaml")
    corpus = ("cnsfails-boundary-span.txt",)

    populated = _fresh_db(tmp_path, "populated.db")
    _feed(populated, base, *corpus)
    # The two adjacent observations merged into ONE interval spanning the
    # boundary the next revision is about to declare.
    before = populated.execute(
        "SELECT security_id, valid_from, valid_to FROM security_identifiers"
        " WHERE value = '333333333'"
    ).fetchall()
    assert before == [("sec:test-issuer-common", "2019-12-31", "2020-01-02")]

    report = _feed(populated, split, *corpus)

    # The incumbent kept its id, its class, its review_state, and its other
    # bindings; only the post-boundary piece moved.
    incumbent = populated.execute(
        "SELECT id_state, class, review_state FROM securities WHERE security_id = ?",
        ("sec:test-issuer-common",),
    ).fetchone()
    assert incumbent == ("declared", "equity", "reviewed")
    assert populated.execute(
        "SELECT security_id, valid_from, valid_to FROM security_identifiers"
        " WHERE value = '333333333' ORDER BY valid_from"
    ).fetchall() == [
        ("sec:test-issuer-common", "2019-12-31", "2020-01-01"),
        ("sec:test-successor", "2020-01-01", "2020-01-02"),
    ]
    assert populated.execute(
        "SELECT security_id FROM security_identifiers WHERE value = '111111111'"
    ).fetchall() == [("sec:test-issuer-common",)]

    assert report.mutations.intervals_cut == 1
    assert report.mutations.securities_split == 1
    # A retained incumbent is NOT superseded (QA-F4): it is still live and owns
    # its unaffected bindings, so no security-level supersession row names it as
    # a predecessor, and neither resolver redirects it. The post-boundary binding
    # simply moved to a newly-declared successor (an interval reassignment, not a
    # supersession).
    assert _ledger(populated) == []
    assert resolve_security_successor(populated, "sec:test-issuer-common") is None
    assert resolve_superseded(populated, "sec:test-issuer-common") == ()

    # As-of resolution now answers differently on each side of the boundary.
    assert (
        resolve_cusip(populated, "333333333", "2019-12-31")
        == "sec:test-issuer-common"
    )
    assert resolve_cusip(populated, "333333333", "2020-01-01") == "sec:test-successor"

    clean = _fresh_db(tmp_path, "clean.db")
    _feed(clean, split, *corpus)
    assert _snapshot(populated) == _snapshot(clean)
    assert populated.execute("PRAGMA foreign_key_check").fetchall() == []
    populated.close()
    clean.close()


# --- fresh split of an undeclared value ---------------------------------------


def test_fresh_split_fans_out_one_to_many_and_fails_closed(tmp_path):
    split = load_identity_registry(
        IDENTITY_FIXTURES / "securities-fresh-split.yaml"
    )
    corpus = ("cnsfails-reuse.txt",)

    populated = _fresh_db(tmp_path, "populated.db")
    _feed(populated, empty_registry(), *corpus)
    predecessor = provisional_security_id(anchor("cusip", "444444444"))
    report = _feed(populated, split, *corpus)

    assert sorted(
        security_id
        for (security_id,) in populated.execute("SELECT security_id FROM securities")
    ) == ["sec:test-reuse-era-one", "sec:test-reuse-era-two"]
    assert resolve_superseded(populated, predecessor) == (
        "sec:test-reuse-era-one",
        "sec:test-reuse-era-two",
    )
    # Two successors: resolution is fail-closed, not "pick the first".
    assert resolve_security_successor(populated, predecessor) is None
    assert report.mutations.securities_split == 1
    assert report.mutations.supersessions_recorded == 2

    assert resolve_cusip(populated, "444444444", "2013-01-31") == (
        "sec:test-reuse-era-one"
    )
    assert resolve_cusip(populated, "444444444", "2024-05-01") == (
        "sec:test-reuse-era-two"
    )

    clean = _fresh_db(tmp_path, "clean.db")
    _feed(clean, split, *corpus)
    assert _snapshot(populated) == _snapshot(clean)
    populated.close()
    clean.close()


def test_reconcile_only_fails_closed_when_a_revision_disputes_a_binding(tmp_path):
    # QA-F3: an authority revision that turns a resolvable binding disputed must
    # fail closed on a POPULATED database even with NO observation pass
    # (reconcile-only), converging with a clean build. Before the fix,
    # reconciliation left review_state untouched, so resolve_cusip stayed
    # resolvable (fail-open) while a clean build correctly returned None.
    cleared = load_identity_registry(IDENTITY_FIXTURES / "securities-continuity.yaml")
    corpus = ("cnsfails-reuse.txt",)

    populated = _fresh_db(tmp_path, "populated.db")
    _feed(populated, cleared, *corpus)
    # With the continuity clearing the decade-apart gap, the value resolves.
    assert resolve_cusip(populated, "444444444", "2013-01-31") is not None
    assert resolve_cusip(populated, "444444444", "2024-05-01") is not None

    # The revision drops the continuity → the gap is now an undeclared reuse.
    reconcile_only(populated, empty_registry())

    # Fail closed on BOTH eras, with no observation pass to re-flag it.
    assert resolve_cusip(populated, "444444444", "2013-01-31") is None
    assert resolve_cusip(populated, "444444444", "2024-05-01") is None

    # And it converges with a clean build under the revised authority.
    clean = _fresh_db(tmp_path, "clean.db")
    _feed(clean, empty_registry(), *corpus)
    assert _snapshot(populated) == _snapshot(clean)
    populated.close()
    clean.close()


def test_identifier_rows_carry_deterministic_non_null_raw(tmp_path):
    # QA-F6 / R1: every persisted identifier interval carries raw JSON (never
    # NULL), byte-identical across a clean rebuild.
    import json as _json

    corpus = ("cnsfails-boundary-span.txt",)
    declared = load_identity_registry(IDENTITY_FIXTURES / "securities-class.yaml")

    a = _fresh_db(tmp_path, "a.db")
    _feed(a, declared, *corpus)
    rows_a = a.execute(
        "SELECT value, valid_from, raw FROM security_identifiers"
        " ORDER BY value, valid_from"
    ).fetchall()
    assert rows_a
    for _value, _vf, raw in rows_a:
        assert raw is not None
        _json.loads(raw)  # valid JSON

    b = _fresh_db(tmp_path, "b.db")
    _feed(b, declared, *corpus)
    rows_b = b.execute(
        "SELECT value, valid_from, raw FROM security_identifiers"
        " ORDER BY value, valid_from"
    ).fetchall()
    assert rows_a == rows_b
    a.close()
    b.close()


@pytest.mark.parametrize(
    "registry_name",
    ["securities-continuity.yaml", None],  # None → empty registry (reuse → disputed)
    ids=["continuity-cleared", "disputed"],
)
def test_full_feed_replay_reports_zero_mutations(tmp_path, registry_name):
    # QA-F1/R12: a full reconcile+observation feed replayed over a reuse value —
    # whether continuity-CLEARED or DISPUTED — must report ZERO mutations and
    # leave state unchanged. This exercises reconciliation over the affected
    # fixtures, which the generic replay test did not, and would catch a
    # review-state authority↔reuse toggle.
    corpus = ("cnsfails-reuse.txt",)
    registry = (
        empty_registry()
        if registry_name is None
        else load_identity_registry(IDENTITY_FIXTURES / registry_name)
    )
    conn = _fresh_db(tmp_path, "replay.db")
    _feed(conn, registry, *corpus)
    before = _snapshot(conn)
    report = _feed(conn, registry, *corpus)  # identical replay
    nonzero = {k: v for k, v in vars(report.mutations).items() if v}
    assert nonzero == {}, (registry_name, nonzero)
    assert _snapshot(conn) == before  # state byte-identical after replay
    conn.close()


@pytest.mark.parametrize("state", ["auto", "disputed"])
def test_a_nonreviewed_continuity_does_not_clear_a_reuse(tmp_path, state):
    # QA-F1: only a REVIEWED continuity clears a reuse gap. An `auto`/`disputed`
    # continuity must leave the identifier disputed and unresolvable in both
    # eras — never silently conflate two eras of a reused CUSIP.
    from populus.identity.registry import parse_identity_registry

    registry = parse_identity_registry(
        "classes: []\ncontinuities:\n"
        '  - anchor: {id_type: cusip, value: "444444444"}\n'
        '    gap_from: "2013-02-01"\n    gap_to: "2024-05-01"\n'
        "    note: not a reviewed clearance\n"
        f"    review_state: {state}\n"
    )
    conn = _fresh_db(tmp_path, "nonreviewed.db")
    _feed(conn, registry, "cnsfails-reuse.txt")
    assert resolve_cusip(conn, "444444444", "2013-01-31") is None
    assert resolve_cusip(conn, "444444444", "2024-05-01") is None
    conn.close()


def _seed_ticker(conn, *, entity_id, ticker, valid_from):
    conn.execute(
        "INSERT INTO entities (entity_id, cik) VALUES (?, ?)"
        " ON CONFLICT (entity_id) DO NOTHING",
        (entity_id, entity_id.split(":", 1)[1]),
    )
    conn.execute(
        "INSERT INTO entity_tickers (entity_id, ticker, valid_from, valid_to,"
        " provenance, confidence, review_state, license_id)"
        " VALUES (?, ?, ?, NULL, 'company_tickers', 'high', 'auto', 'sec-edgar')",
        (entity_id, ticker, valid_from),
    )


def test_reconcile_only_resets_split_links_and_counts_it(tmp_path):
    # Stated consequence: per-observation entity candidates cannot be
    # redistributed across a split, so every security the split touches is
    # reset to `unresolved` and the reset is COUNTED rather than hidden. Without
    # re-feeding the corpus in the same command, that is where they stay.
    base = load_identity_registry(IDENTITY_FIXTURES / "securities-class.yaml")
    split = load_identity_registry(IDENTITY_FIXTURES / "securities-class-split.yaml")

    conn = _fresh_db(tmp_path, "populated.db")
    conn.execute("BEGIN IMMEDIATE")
    _seed_ticker(
        conn, entity_id="cik:0000000001", ticker="SPAN", valid_from="2010-01-01"
    )
    _seed_ticker(
        conn, entity_id="cik:0000000001", ticker="KEEP", valid_from="2010-01-01"
    )
    conn.execute("COMMIT")
    _feed(conn, base, "cnsfails-boundary-span.txt")
    assert conn.execute(
        "SELECT entity_link_state FROM securities WHERE security_id = ?",
        ("sec:test-issuer-common",),
    ).fetchone() == ("resolved",)

    mutations = reconcile_only(conn, split)
    # The retained incumbent held candidates derived from observations that no
    # longer all belong to it, so it is reset along with the successor.
    assert mutations.links_reset_on_split >= 1
    assert sorted(
        row[0] for row in conn.execute("SELECT entity_link_state FROM securities")
    ) == ["unresolved", "unresolved"]
    conn.close()


def test_reconcile_then_refeed_reresolves_the_links(tmp_path):
    # The same command re-runs the corpus, so the reset is not the end state:
    # candidates are re-derived per owner and convergence with a clean build
    # holds for the link columns too.
    base = load_identity_registry(IDENTITY_FIXTURES / "securities-class.yaml")
    split = load_identity_registry(IDENTITY_FIXTURES / "securities-class-split.yaml")

    populated = _fresh_db(tmp_path, "populated.db")
    clean = _fresh_db(tmp_path, "clean.db")
    for conn in (populated, clean):
        conn.execute("BEGIN IMMEDIATE")
        _seed_ticker(
            conn, entity_id="cik:0000000001", ticker="SPAN", valid_from="2010-01-01"
        )
        _seed_ticker(
            conn, entity_id="cik:0000000001", ticker="KEEP", valid_from="2010-01-01"
        )
        conn.execute("COMMIT")
    _feed(populated, base, "cnsfails-boundary-span.txt")
    _feed(populated, split, "cnsfails-boundary-span.txt")
    _feed(clean, split, "cnsfails-boundary-span.txt")
    assert _snapshot(populated) == _snapshot(clean)
    assert sorted(
        row[0] for row in populated.execute("SELECT entity_link_state FROM securities")
    ) == ["resolved", "resolved"]
    populated.close()
    clean.close()


def test_fresh_split_successors_start_unresolved(tmp_path):
    split = load_identity_registry(IDENTITY_FIXTURES / "securities-fresh-split.yaml")
    conn = _fresh_db(tmp_path, "populated.db")
    conn.execute("BEGIN IMMEDIATE")
    _seed_ticker(
        conn, entity_id="cik:0000000001", ticker="RUSE", valid_from="2010-01-01"
    )
    conn.execute("COMMIT")
    _feed(conn, empty_registry(), "cnsfails-reuse.txt")
    mutations = reconcile_only(conn, split)
    # The predecessor is retired outright, so its successors are CREATED empty
    # rather than reset — a different write, honestly counted as such.
    assert mutations.links_reset_on_split == 0
    assert mutations.securities_created == 2
    assert sorted(
        row[0] for row in conn.execute("SELECT entity_link_state FROM securities")
    ) == ["unresolved", "unresolved"]
    conn.close()


# --- idempotence and collision safety -----------------------------------------


def test_a_class_that_both_loses_and_gains_a_binding_survives(tmp_path):
    # The chained revision: in ONE reviewed change the class hands 222222222 to
    # a new successor AND takes over 111111111, which was provisional. It is
    # then both a rename source and a rename destination — retiring it would
    # orphan the rows about to land on it.
    from populus.identity.registry import parse_identity_registry

    owns_new = parse_identity_registry(
        'classes:\n  - security_id: "sec:test-issuer-common"\n'
        "    class: equity\n    identifiers:\n"
        '      - {id_type: cusip, value: "222222222"}\n'
        "    note: revision A — the class owns only the post-change CUSIP\n"
        "    review_state: reviewed\ncontinuities: []\n"
    )
    swapped = parse_identity_registry(
        'classes:\n  - security_id: "sec:test-issuer-common"\n'
        "    class: equity\n    identifiers:\n"
        '      - {id_type: cusip, value: "111111111"}\n'
        "    note: revision B — the class keeps its id but swaps its binding\n"
        "    review_state: reviewed\n"
        '  - security_id: "sec:test-successor"\n'
        "    class: equity\n    identifiers:\n"
        '      - {id_type: cusip, value: "222222222"}\n'
        "    note: revision B — the successor receives the old binding\n"
        "    review_state: reviewed\ncontinuities: []\n"
    )
    header = "SETTLEMENT DATE|CUSIP|SYMBOL|QUANTITY (FAILS)|DESCRIPTION|PRICE\n"
    corpus = tmp_path / "swap.txt"
    corpus.write_text(
        header
        + "20180301|111111111|ONE|5|ISSUER ONE COM|1.00\n"
        + "20220301|222222222|TWO|5|ISSUER TWO COM|1.00\n",
        encoding="utf-8",
    )

    def feed(conn, registry):
        observations, disposition = parse_ftd([corpus])
        conn.execute("BEGIN IMMEDIATE")
        try:
            mutations = reconcile_identity_registry(conn, registry)
            bootstrap_ftd(
                conn,
                observations,
                registry=registry,
                disposition=disposition,
                mutations=mutations,
            )
            conn.execute("COMMIT")
        except BaseException:
            conn.execute("ROLLBACK")
            raise

    populated = _fresh_db(tmp_path, "populated.db")
    feed(populated, empty_registry())
    feed(populated, owns_new)
    feed(populated, swapped)

    assert populated.execute("PRAGMA foreign_key_check").fetchall() == []
    assert sorted(
        security_id
        for (security_id,) in populated.execute("SELECT security_id FROM securities")
    ) == ["sec:test-issuer-common", "sec:test-successor"]
    assert resolve_cusip(populated, "111111111", "2018-03-01") == (
        "sec:test-issuer-common"
    )
    assert resolve_cusip(populated, "222222222", "2022-03-01") == "sec:test-successor"
    # QA-F3: the survivor lost a binding through the rename path but stays live,
    # so it must NOT be recorded as superseded — neither resolver redirects it.
    assert resolve_security_successor(populated, "sec:test-issuer-common") is None
    assert resolve_superseded(populated, "sec:test-issuer-common") == ()
    assert not any(
        old == "sec:test-issuer-common" for old, _new, _reason in _ledger(populated)
    )

    clean = _fresh_db(tmp_path, "clean.db")
    feed(clean, swapped)
    assert _snapshot(populated) == _snapshot(clean)
    populated.close()
    clean.close()


def test_reconcile_with_an_unchanged_registry_is_a_no_op(tmp_path):
    from dataclasses import asdict

    declared = load_identity_registry(IDENTITY_FIXTURES / "securities-class.yaml")
    conn = _fresh_db(tmp_path, "populated.db")
    _feed(conn, declared, "cnsfails-boundary-span.txt")
    before = _snapshot(conn)
    mutations = reconcile_only(conn, declared)
    assert all(value == 0 for value in asdict(mutations).values()), asdict(mutations)
    assert _snapshot(conn) == before
    conn.close()


def test_cutting_never_violates_the_global_no_overlap_index(tmp_path):
    split = load_identity_registry(IDENTITY_FIXTURES / "securities-class-split.yaml")
    conn = _fresh_db(tmp_path, "populated.db")
    _feed(conn, load_identity_registry(IDENTITY_FIXTURES / "securities-class.yaml"),
          "cnsfails-boundary-span.txt")
    _feed(conn, split, "cnsfails-boundary-span.txt")
    starts = conn.execute(
        "SELECT id_type, value, valid_from, count(*) FROM security_identifiers"
        " GROUP BY id_type, value, valid_from HAVING count(*) > 1"
    ).fetchall()
    assert starts == []
    assert conn.execute("PRAGMA foreign_key_check").fetchall() == []
    conn.close()
