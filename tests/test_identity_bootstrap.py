"""Seeding the identity registries: dispositions, determinism, accounting.

The claims proved here are the ones a consumer has to be able to trust:
DC1 (one title per CIK per snapshot), DC3 (a security_id does not depend on how
the corpus was partitioned or ordered), DC4 (symbols resolve per observation),
DC5 (three counter families that mean what they say), R7 (a bootstrap run is
all-or-nothing) and R14 (the parser is gated against the provider's real bytes).
"""

from __future__ import annotations

import json
import sqlite3
import zipfile
from dataclasses import asdict
from pathlib import Path

import pytest
from click.testing import CliRunner

from populus.cli import main
from populus.db import connect, init_db
from populus.identity import bootstrap as bootstrap_module
from populus.identity.bootstrap import (
    Disposition,
    FtdFormatError,
    bootstrap_ftd,
    bootstrap_tickers,
    format_bootstrap_summary,
    load_company_tickers,
    parse_ftd,
    run_identity_bootstrap,
)
from populus.identity.registry import (
    anchor,
    load_identity_registry,
    parse_identity_registry,
    provisional_security_id,
    resolve_cusip,
    resolve_entity_by_cik,
)

FIXTURES = Path(__file__).resolve().parent / "fixtures" / "inst"
REGISTRY_FIXTURES = FIXTURES / "registry"
IDENTITY_FIXTURES = FIXTURES / "identity"
FTD_FIXTURES = FIXTURES / "ftd"

SAMPLE = REGISTRY_FIXTURES / "company_tickers-sample.json"
SNAPSHOT2 = REGISTRY_FIXTURES / "company_tickers-snapshot2.json"
CONFLICT = REGISTRY_FIXTURES / "company_tickers-conflict.json"

# The provenance every company_tickers-derived row must carry (§5.1).
SOURCE = "company_tickers"
LICENSE = "sec-edgar"


def empty_registry():
    return parse_identity_registry("classes: []\ncontinuities: []\n")


def _fresh(tmp_path, name):
    path = tmp_path / name
    init_db(str(path))
    return connect(str(path))


def _run_tickers(conn, path, snapshot_date):
    rows, disposition = load_company_tickers(path)
    conn.execute("BEGIN IMMEDIATE")
    try:
        report = bootstrap_tickers(
            conn, rows, snapshot_date=snapshot_date, disposition=disposition
        )
        conn.execute("COMMIT")
    except BaseException:
        conn.execute("ROLLBACK")
        raise
    return report


def _run_ftd(conn, registry, *corpora, paths=None):
    sources = paths if paths is not None else [FTD_FIXTURES / n for n in corpora]
    observations, disposition = parse_ftd(sources)
    conn.execute("BEGIN IMMEDIATE")
    try:
        report = bootstrap_ftd(
            conn, observations, registry=registry, disposition=disposition
        )
        conn.execute("COMMIT")
    except BaseException:
        conn.execute("ROLLBACK")
        raise
    return report


def _identity_rows(conn):
    return conn.execute(
        "SELECT security_id, id_type, value, valid_from, valid_to, provenance,"
        " confidence, review_state, license_id FROM security_identifiers"
        " ORDER BY id_type, value, valid_from"
    ).fetchall()


def _security_ids(conn):
    return sorted(
        security_id
        for (security_id,) in conn.execute("SELECT security_id FROM securities")
    )


# --- company_tickers: parse (R3, DC1) -----------------------------------------


def test_sample_snapshot_parses_with_a_partitioning_disposition():
    rows, disposition = load_company_tickers(SAMPLE)
    assert disposition == Disposition(rows_read=4, accepted=4)
    assert [(row.cik, row.ticker, row.name) for row in rows] == [
        ("0000000001", "ALFA", "Alfa Corp"),
        ("0000000001", "ALFAW", "Alfa Corp"),
        ("0000000002", "BETA", "Beta Inc."),
        ("0000000003", "GAMA", "Gamma Ltd"),
    ]


def test_conflicting_titles_rejected_and_counted():
    # DC1: a CIK carrying two distinct titles in one snapshot has ALL of its
    # rows rejected — never both kept valid, never one silently preferred.
    rows, disposition = load_company_tickers(CONFLICT)
    assert disposition.rows_read == 3
    assert disposition.rejected_title_conflict == 2
    assert disposition.accepted == 1
    assert {row.cik for row in rows} == {"0000000002"}


def test_same_ticker_differing_titles_is_a_conflict_not_a_duplicate(tmp_path):
    # QA-F5: two rows with the SAME (cik, ticker) but DIFFERENT titles are a
    # title conflict — BOTH rejected. The old dedup-before-title-check kept the
    # first title and mislabeled the second row a plain duplicate, silently
    # choosing a name. Title conflicts must be decided across all valid rows
    # BEFORE duplicate bucketing.
    path = tmp_path / "same_ticker_conflict.json"
    path.write_text(
        json.dumps(
            {
                "0": {"cik_str": 7, "ticker": "DUP", "title": "First Name Inc"},
                "1": {"cik_str": 7, "ticker": "DUP", "title": "Second Name Inc"},
            }
        ),
        encoding="utf-8",
    )
    rows, disposition = load_company_tickers(path)
    assert disposition.rows_read == 2
    assert disposition.rejected_title_conflict == 2
    assert disposition.rejected_duplicate == 0
    assert disposition.accepted == 0
    assert rows == ()


def test_malformed_and_duplicate_rows_are_bucketed(tmp_path):
    path = tmp_path / "messy.json"
    path.write_text(
        json.dumps(
            {
                "0": {"cik_str": 1, "ticker": "ALFA", "title": "Alfa Corp"},
                "1": {"cik_str": 1, "ticker": "ALFA", "title": "Alfa Corp"},
                "2": {"cik_str": "abc", "ticker": "BETA", "title": "Beta"},
                "3": {"cik_str": 2, "ticker": "", "title": "Beta"},
                "4": {"cik_str": 3, "ticker": "GAMA", "title": "   "},
                "5": "not an object",
            }
        ),
        encoding="utf-8",
    )
    rows, disposition = load_company_tickers(path)
    assert disposition.rows_read == 6
    assert disposition.accepted == 1
    assert disposition.rejected_duplicate == 1
    assert disposition.rejected_malformed == 4
    assert len(rows) == 1


def test_disposition_rejects_buckets_that_do_not_partition():
    with pytest.raises(ValueError) as excinfo:
        Disposition(rows_read=5, accepted=2)
    assert "partition" in str(excinfo.value)


# --- company_tickers: write semantics -----------------------------------------


def test_ticker_bootstrap_writes_the_declared_provenance(tmp_path):
    conn = _fresh(tmp_path, "i.db")
    _run_tickers(conn, SAMPLE, "2026-07-24")
    assert conn.execute(
        "SELECT entity_id, name, valid_from, valid_to, source, license_id"
        " FROM entity_names ORDER BY entity_id"
    ).fetchall() == [
        ("cik:0000000001", "Alfa Corp", "2026-07-24", None, SOURCE, LICENSE),
        ("cik:0000000002", "Beta Inc.", "2026-07-24", None, SOURCE, LICENSE),
        ("cik:0000000003", "Gamma Ltd", "2026-07-24", None, SOURCE, LICENSE),
    ]
    assert conn.execute(
        "SELECT ticker, provenance, confidence, review_state, license_id, valid_to"
        " FROM entity_tickers WHERE ticker = 'ALFA'"
    ).fetchone() == ("ALFA", "company_tickers", "high", "auto", "sec-edgar", None)
    # One CIK, two tickers, one title: ordinary one-to-many data.
    assert conn.execute(
        "SELECT count(*) FROM entity_tickers WHERE entity_id = 'cik:0000000001'"
    ).fetchone() == (2,)
    assert resolve_entity_by_cik(conn, "1", "2026-08-01").name == "Alfa Corp"
    conn.close()


def test_second_snapshot_closes_a_changed_title_and_keeps_absences_open(tmp_path):
    conn = _fresh(tmp_path, "i.db")
    _run_tickers(conn, SAMPLE, "2026-01-01")
    report = _run_tickers(conn, SNAPSHOT2, "2026-07-01")
    assert report.mutations.names_closed == 1
    # One reopened after the title change, one opened for the new CIK 4.
    assert report.mutations.names_opened == 2
    assert report.mutations.entities_inserted == 1  # CIK 4 is new
    # The old name is closed at the snapshot date; the new one opens there.
    assert conn.execute(
        "SELECT name, valid_from, valid_to FROM entity_names"
        " WHERE entity_id = 'cik:0000000001' ORDER BY valid_from"
    ).fetchall() == [
        ("Alfa Corp", "2026-01-01", "2026-07-01"),
        ("Alfa Corporation", "2026-07-01", None),
    ]
    assert resolve_entity_by_cik(conn, "1", "2026-03-01").name == "Alfa Corp"
    assert resolve_entity_by_cik(conn, "1", "2026-08-01").name == "Alfa Corporation"
    # Absence is not deletion: ALFAW and GAMA keep their open intervals.
    assert conn.execute(
        "SELECT valid_to FROM entity_tickers WHERE ticker = 'ALFAW'"
    ).fetchone() == (None,)
    assert report.state.entities_absent_from_snapshot == 1
    assert report.state.tickers_absent_from_snapshot == 2
    conn.close()


def test_a_reassigned_ticker_is_closed_and_reopened(tmp_path):
    conn = _fresh(tmp_path, "i.db")
    _run_tickers(conn, SAMPLE, "2026-01-01")
    reassigned = tmp_path / "reassigned.json"
    reassigned.write_text(
        json.dumps({"0": {"cik_str": 9, "ticker": "ALFA", "title": "Ninth Corp"}}),
        encoding="utf-8",
    )
    report = _run_tickers(conn, reassigned, "2026-07-01")
    assert report.mutations.tickers_closed_reassigned == 1
    assert conn.execute(
        "SELECT entity_id, valid_from, valid_to FROM entity_tickers"
        " WHERE ticker = 'ALFA' ORDER BY valid_from"
    ).fetchall() == [
        ("cik:0000000001", "2026-01-01", "2026-07-01"),
        ("cik:0000000009", "2026-07-01", None),
    ]
    conn.close()


def test_an_out_of_order_snapshot_never_rewrites_history(tmp_path):
    conn = _fresh(tmp_path, "i.db")
    _run_tickers(conn, SAMPLE, "2026-07-01")
    report = _run_tickers(conn, SNAPSHOT2, "2020-01-01")
    # The registry already holds intervals that start AFTER this snapshot, so
    # the changed title is refused rather than back-dated.
    assert conn.execute(
        "SELECT name FROM entity_names WHERE entity_id = 'cik:0000000001'"
    ).fetchall() == [("Alfa Corp",)]
    assert report.state.names_ahead_of_snapshot > 0
    assert report.state.tickers_ahead_of_snapshot > 0
    conn.close()


def test_bootstrap_tickers_requires_an_open_transaction(tmp_path):
    conn = _fresh(tmp_path, "i.db")
    rows, disposition = load_company_tickers(SAMPLE)
    with pytest.raises(sqlite3.ProgrammingError):
        bootstrap_tickers(
            conn, rows, snapshot_date="2026-07-24", disposition=disposition
        )
    conn.close()


# --- DC5: the three families --------------------------------------------------


@pytest.mark.parametrize("path", [SAMPLE, SNAPSHOT2, CONFLICT])
def test_ticker_buckets_sum_to_rows_read(path):
    _rows, disposition = load_company_tickers(path)
    assert (
        sum(getattr(disposition, bucket) for bucket in Disposition.BUCKETS)
        == disposition.rows_read
    )


@pytest.mark.parametrize(
    "corpus",
    [
        "cnsfails-partition-a.txt",
        "cnsfails-partition-b.txt",
        "cnsfails-reuse.txt",
        "cnsfails-real-excerpt.txt",
    ],
)
def test_ftd_buckets_sum_to_rows_read(corpus):
    _observations, disposition = parse_ftd([FTD_FIXTURES / corpus])
    assert (
        sum(getattr(disposition, bucket) for bucket in Disposition.BUCKETS)
        == disposition.rows_read
    )


def test_ticker_state_is_a_post_write_metric_not_a_write_count(tmp_path):
    # The phase check: `entities_in_registry` counts what the registry HOLDS for
    # this input and is identical on a clean first ingest and its replay; the
    # write count is what differs.
    conn = _fresh(tmp_path, "i.db")
    first = _run_tickers(conn, SAMPLE, "2026-07-24")
    second = _run_tickers(conn, SAMPLE, "2026-07-24")
    assert first.state.entities_in_registry == 3
    assert second.state.entities_in_registry == 3
    assert first.mutations.entities_inserted == 3
    assert second.mutations.entities_inserted == 0


def test_ticker_totals_hold_in_one_unit_on_both_sides(tmp_path):
    conn = _fresh(tmp_path, "i.db")
    report = _run_tickers(conn, SAMPLE, "2026-07-24")
    rows, disposition = load_company_tickers(SAMPLE)
    distinct_ciks = len({row.cik for row in rows})
    assert (
        report.state.names_current + report.state.names_ahead_of_snapshot
        == distinct_ciks
    )
    assert (
        report.state.tickers_current + report.state.tickers_ahead_of_snapshot
        == disposition.accepted
    )
    conn.close()


@pytest.mark.parametrize(
    "prelude,ticker_source,snapshot,corpus,characteristic",
    [
        (
            (SAMPLE, "2026-01-01"),
            SNAPSHOT2,
            "2026-07-01",
            "cnsfails-partition-a.txt",
            "entities_absent_from_snapshot",
        ),
        (
            (SAMPLE, "2026-07-01"),
            SNAPSHOT2,
            "2020-01-01",
            "cnsfails-partition-a.txt",
            "names_ahead_of_snapshot",
        ),
        (None, SAMPLE, "2026-07-24", "cnsfails-reuse.txt", "observations_disputed"),
    ],
    ids=["absence", "out-of-order", "reuse"],
)
def test_replay_zeroes_every_mutation_and_repeats_every_state(
    tmp_path, prelude, ticker_source, snapshot, corpus, characteristic
):
    from populus.identity.bootstrap import TICKER_STATE_FIELDS

    conn = _fresh(tmp_path, "i.db")
    if prelude is not None:
        _run_tickers(conn, prelude[0], prelude[1])
    registry = empty_registry()

    def once():
        tickers = _run_tickers(conn, ticker_source, snapshot)
        ftd = _run_ftd(conn, registry, corpus)
        return tickers, ftd

    first_tickers, first_ftd = once()
    second_tickers, second_ftd = once()

    for mutations in (second_tickers.mutations, second_ftd.mutations):
        assert all(value == 0 for value in asdict(mutations).values()), asdict(
            mutations
        )
    assert second_tickers.state == first_tickers.state
    assert second_ftd.state == first_ftd.state
    # And the field this fixture exists to exercise is non-zero on BOTH runs,
    # so the replay assertion is not vacuous.
    ticker_family = characteristic in TICKER_STATE_FIELDS
    for tickers, ftd in ((first_tickers, first_ftd), (second_tickers, second_ftd)):
        state = tickers.state if ticker_family else ftd.state
        assert getattr(state, characteristic) > 0, characteristic
    conn.close()


def test_declared_split_totals_are_single_unit_and_hold(tmp_path):
    # One anchor mapping to TWO securities is exactly the case that made an
    # anchor-counted total false; every stated total is asserted here.
    registry = load_identity_registry(IDENTITY_FIXTURES / "securities-fresh-split.yaml")
    conn = _fresh(tmp_path, "i.db")
    report = _run_ftd(conn, registry, "cnsfails-reuse.txt")
    state = report.state
    observations, disposition = parse_ftd([FTD_FIXTURES / "cnsfails-reuse.txt"])
    pairs = {(o.value, o.settlement_date) for o in observations}

    assert state.anchors_in_registry == 1
    assert state.securities_in_registry == 2
    assert state.securities_declared + state.securities_provisional == 2
    assert (
        state.links_resolved + state.links_conflicted + state.links_unresolved == 2
    )
    assert state.observations_covered + state.observations_disputed == len(pairs)
    assert (
        state.symbols_resolved + state.symbols_unresolved + state.symbols_blank
        == disposition.accepted
    )
    conn.close()


def test_every_counter_field_declares_a_unit():
    from populus.identity.bootstrap import (
        DISPOSITION_UNITS,
        MUTATION_UNITS,
        REGISTRY_STATE_UNITS,
        Mutations,
        RegistryState,
    )

    for cls, units in (
        (Disposition, DISPOSITION_UNITS),
        (Mutations, MUTATION_UNITS),
        (RegistryState, REGISTRY_STATE_UNITS),
    ):
        names = {f.name for f in __import__("dataclasses").fields(cls)}
        assert names == set(units), (cls.__name__, names ^ set(units))


# --- DC3: identity does not depend on partition, order or arrival -------------


def test_two_clean_builds_of_one_corpus_agree_exactly(tmp_path):
    registry = empty_registry()
    first = _fresh(tmp_path, "one.db")
    second = _fresh(tmp_path, "two.db")
    for conn in (first, second):
        _run_ftd(conn, registry, "cnsfails-partition-a.txt", "cnsfails-partition-b.txt")
    assert _security_ids(first) == _security_ids(second)
    assert _identity_rows(first) == _identity_rows(second)
    first.close()
    second.close()


@pytest.mark.parametrize(
    "plan",
    [
        ("ab",),
        ("ba",),
        ("a", "b"),
        ("b", "a"),
    ],
    ids=["merged-a-then-b", "merged-b-then-a", "a-then-b", "b-then-a"],
)
def test_every_partition_and_order_yields_identical_ids_and_rows(tmp_path, plan):
    registry = empty_registry()
    reference = _fresh(tmp_path, "reference.db")
    _run_ftd(
        reference, registry, "cnsfails-partition-a.txt", "cnsfails-partition-b.txt"
    )
    expected_ids = _security_ids(reference)
    expected_rows = _identity_rows(reference)

    conn = _fresh(tmp_path, "candidate.db")
    names = {
        "a": ["cnsfails-partition-a.txt"],
        "b": ["cnsfails-partition-b.txt"],
        "ab": ["cnsfails-partition-a.txt", "cnsfails-partition-b.txt"],
        "ba": ["cnsfails-partition-b.txt", "cnsfails-partition-a.txt"],
    }
    for step in plan:
        _run_ftd(conn, registry, *names[step])
    assert _security_ids(conn) == expected_ids
    assert _identity_rows(conn) == expected_rows
    reference.close()
    conn.close()


def test_an_earlier_backfill_never_rekeys_an_existing_security(tmp_path):
    # DC3's sharpest case: import February alone, then add the earlier January
    # file. The ids observed after the first import must be byte-identical.
    registry = empty_registry()
    conn = _fresh(tmp_path, "i.db")
    _run_ftd(conn, registry, "cnsfails-partition-b.txt")
    after_b = _security_ids(conn)
    _run_ftd(conn, registry, "cnsfails-partition-a.txt")
    after_a = _security_ids(conn)
    assert set(after_b) <= set(after_a)
    assert after_b == sorted(
        provisional_security_id(anchor("cusip", value))
        for value in ("AAA111111", "BBB222222")
    )
    conn.close()


def test_observations_never_change_any_security_id(tmp_path):
    # Interlock B: observations only add dated bindings. Feeding more data must
    # not change any existing id or its id_state.
    registry = empty_registry()
    conn = _fresh(tmp_path, "i.db")
    _run_ftd(conn, registry, "cnsfails-partition-a.txt")
    before = conn.execute(
        "SELECT security_id, id_state FROM securities ORDER BY security_id"
    ).fetchall()
    _run_ftd(conn, registry, "cnsfails-partition-b.txt")
    after = conn.execute(
        "SELECT security_id, id_state FROM securities ORDER BY security_id"
    ).fetchall()
    assert before == after
    conn.close()


def test_a_declared_cusip_change_keeps_one_security_with_two_dated_bindings(tmp_path):
    # The corporate-action case: the class owns both the old and the new CUSIP,
    # so a corpus of only-OLD then only-NEW yields ONE security.
    registry = load_identity_registry(IDENTITY_FIXTURES / "securities-class.yaml")
    old = tmp_path / "old.txt"
    new = tmp_path / "new.txt"
    header = "SETTLEMENT DATE|CUSIP|SYMBOL|QUANTITY (FAILS)|DESCRIPTION|PRICE\n"
    old.write_text(header + "20180301|111111111|OLDT|5|OLD ISSUER COM|1.00\n", "utf-8")
    new.write_text(header + "20220301|222222222|NEWT|5|NEW ISSUER COM|1.00\n", "utf-8")

    conn = _fresh(tmp_path, "i.db")
    _run_ftd(conn, registry, paths=[old])
    _run_ftd(conn, registry, paths=[new])
    assert _security_ids(conn) == ["sec:test-issuer-common"]
    assert resolve_cusip(conn, "111111111", "2018-03-01") == resolve_cusip(
        conn, "222222222", "2022-03-01"
    )
    # CUSIP stays a DATED ATTRIBUTE: neither binding leaks into the other era.
    assert resolve_cusip(conn, "222222222", "2018-03-01") is None
    conn.close()


# --- DC2 / R9: validity never spans a gap or an ownership boundary -----------


def test_gapped_observations_produce_two_intervals(tmp_path):
    conn = _fresh(tmp_path, "i.db")
    _run_ftd(
        conn, empty_registry(), "cnsfails-partition-a.txt", "cnsfails-partition-b.txt"
    )
    rows = conn.execute(
        "SELECT valid_from, valid_to FROM security_identifiers"
        " WHERE value = 'AAA111111' ORDER BY valid_from"
    ).fetchall()
    assert rows == [("2026-01-05", "2026-01-07"), ("2026-02-09", "2026-02-10")]
    # The two adjacent January days merged; the month-long gap did not.
    assert resolve_cusip(conn, "AAA111111", "2026-01-06") is not None
    assert resolve_cusip(conn, "AAA111111", "2026-01-20") is None
    conn.close()


def test_union_never_spans_an_ownership_boundary(tmp_path):
    # Interlock C: adjacent observations on B-1 and B belong to DIFFERENT
    # owners, so they must not merge into one interval.
    registry = load_identity_registry(IDENTITY_FIXTURES / "securities-class-split.yaml")
    conn = _fresh(tmp_path, "i.db")
    _run_ftd(conn, registry, "cnsfails-boundary-span.txt")
    assert conn.execute(
        "SELECT security_id, valid_from, valid_to FROM security_identifiers"
        " WHERE value = '333333333' ORDER BY valid_from"
    ).fetchall() == [
        ("sec:test-issuer-common", "2019-12-31", "2020-01-01"),
        ("sec:test-successor", "2020-01-01", "2020-01-02"),
    ]
    conn.close()


# --- R18: fail-closed reuse ---------------------------------------------------


def test_undeclared_reuse_is_disputed_and_resolves_nowhere(tmp_path):
    conn = _fresh(tmp_path, "i.db")
    report = _run_ftd(conn, empty_registry(), "cnsfails-reuse.txt")
    assert report.state.identity_reuse_candidates == 1
    assert report.state.observations_disputed == 2
    assert report.state.observations_covered == 0
    assert report.mutations.securities_flagged_disputed == 1
    assert resolve_cusip(conn, "444444444", "2013-01-31") is None
    assert resolve_cusip(conn, "444444444", "2024-05-01") is None
    # Counted AND listed — never dropped (G3).
    assert report.disputed == (("cusip", "444444444", "REUSED ISSUER TWO COM"),)
    conn.close()


def test_a_declared_split_gives_two_ids_each_resolvable_in_its_own_era(tmp_path):
    registry = load_identity_registry(IDENTITY_FIXTURES / "securities-fresh-split.yaml")
    conn = _fresh(tmp_path, "i.db")
    report = _run_ftd(conn, registry, "cnsfails-reuse.txt")
    assert report.disputed == ()
    assert report.state.observations_disputed == 0
    assert resolve_cusip(conn, "444444444", "2013-01-31") == "sec:test-reuse-era-one"
    assert resolve_cusip(conn, "444444444", "2024-05-01") == "sec:test-reuse-era-two"
    conn.close()


def test_a_declared_continuity_restores_one_resolvable_security(tmp_path):
    registry = load_identity_registry(IDENTITY_FIXTURES / "securities-continuity.yaml")
    conn = _fresh(tmp_path, "i.db")
    report = _run_ftd(conn, registry, "cnsfails-reuse.txt")
    assert report.mutations.securities_cleared_by_continuity == 1
    assert report.state.identity_reuse_candidates == 1
    assert report.state.observations_disputed == 0
    expected = provisional_security_id(anchor("cusip", "444444444"))
    assert resolve_cusip(conn, "444444444", "2013-01-31") == expected
    assert resolve_cusip(conn, "444444444", "2024-05-01") == expected
    # Reviewed, but the GAP itself is still not covered (DC2 holds).
    assert resolve_cusip(conn, "444444444", "2018-06-01") is None
    conn.close()


# --- DC4: as-of symbol -> entity, per observation -----------------------------


def test_a_ticker_change_within_the_corpus_yields_a_conflict(tmp_path):
    conn = _fresh(tmp_path, "i.db")
    _run_tickers(conn, SAMPLE, "2025-01-01")
    report = _run_ftd(
        conn, empty_registry(), "cnsfails-partition-a.txt", "cnsfails-partition-b.txt"
    )
    security = provisional_security_id(anchor("cusip", "AAA111111"))
    entity_id, candidates, link_state = conn.execute(
        "SELECT entity_id, entity_candidates, entity_link_state FROM securities"
        " WHERE security_id = ?",
        (security,),
    ).fetchone()
    assert link_state == "conflict"
    assert entity_id is None
    assert json.loads(candidates) == ["cik:0000000001", "cik:0000000003"]
    assert report.mutations.links_conflicted == 1
    conn.close()


def test_a_unanimous_corpus_stamps_the_entity(tmp_path):
    conn = _fresh(tmp_path, "i.db")
    _run_tickers(conn, SAMPLE, "2025-01-01")
    report = _run_ftd(conn, empty_registry(), "cnsfails-partition-a.txt")
    security = provisional_security_id(anchor("cusip", "BBB222222"))
    assert conn.execute(
        "SELECT entity_id, entity_link_state FROM securities WHERE security_id = ?",
        (security,),
    ).fetchone() == ("cik:0000000002", "resolved")
    assert report.mutations.links_stamped >= 1
    assert report.state.links_resolved >= 1
    conn.close()


def test_an_observation_before_the_ticker_snapshot_stays_unresolved(tmp_path):
    # The intended G14 consequence: entity_tickers intervals open at the
    # snapshot date, so an earlier observation has no applicable mapping.
    conn = _fresh(tmp_path, "i.db")
    _run_tickers(conn, SAMPLE, "2026-07-24")
    report = _run_ftd(conn, empty_registry(), "cnsfails-partition-a.txt")
    assert report.state.symbols_resolved == 0
    assert report.state.symbols_unresolved == 3
    assert report.state.links_unresolved == 2
    conn.close()


def test_a_blank_symbol_is_counted_as_a_blank_link_attempt(tmp_path):
    path = tmp_path / "blank.txt"
    path.write_text(
        "SETTLEMENT DATE|CUSIP|SYMBOL|QUANTITY (FAILS)|DESCRIPTION|PRICE\n"
        "20260105|AAA111111||100|ALFA CORP COM|10.00\n",
        encoding="utf-8",
    )
    conn = _fresh(tmp_path, "i.db")
    report = _run_ftd(conn, empty_registry(), paths=[path])
    assert report.state.symbols_blank == 1
    assert report.state.symbols_resolved == 0
    conn.close()


# --- R14: the provider's real bytes -------------------------------------------


def test_the_real_archive_excerpt_parses_with_exact_counts():
    observations, disposition = parse_ftd(
        [FTD_FIXTURES / "cnsfails-real-excerpt.txt"]
    )
    # 20 data rows + the archive's two real trailer lines, which carry no '|'.
    assert disposition == Disposition(
        rows_read=22, accepted=20, rejected_blank=2
    )
    first = observations[0]
    # A real international-issue CUSIP: letters are not a malformed value.
    assert first.value == "B38564108"
    assert first.settlement_date == "2026-06-15"
    assert first.symbol == "CMBT"
    assert first.issuer_name == "CMB.TECH NV (BEL)"
    assert {o.settlement_date for o in observations} == {"2026-06-15"}
    assert len({o.value for o in observations}) == 20


def test_the_real_excerpt_provenance_is_recorded():
    provenance = (FTD_FIXTURES / "PROVENANCE.md").read_text(encoding="utf-8")
    for required in (
        "sec-ftd",
        "cnsfails202606b.zip",
        "https://www.sec.gov/files/data/fails-deliver-data/",
        "eacc947fdf3661a33bbcbcf112ae92dd05740083ef8fa82a6d4a4498b4622a2c",
        "2026-07-24",
        "SETTLEMENT DATE|CUSIP|SYMBOL|QUANTITY (FAILS)|DESCRIPTION|PRICE",
    ):
        assert required in provenance, required


def test_the_real_excerpt_seeds_one_day_intervals(tmp_path):
    conn = _fresh(tmp_path, "i.db")
    report = _run_ftd(conn, empty_registry(), "cnsfails-real-excerpt.txt")
    assert report.state.anchors_in_registry == 20
    assert report.state.securities_in_registry == 20
    assert report.state.securities_provisional == 20
    rows = conn.execute(
        "SELECT valid_from, valid_to FROM security_identifiers"
    ).fetchall()
    assert set(rows) == {("2026-06-15", "2026-06-16")}
    conn.close()


def test_zip_and_text_inputs_are_equivalent(tmp_path):
    archive = tmp_path / "cnsfails.zip"
    with zipfile.ZipFile(archive, "w") as handle:
        handle.write(FTD_FIXTURES / "cnsfails-real-excerpt.txt", "cnsfails.txt")
    from_zip, zip_disposition = parse_ftd([archive])
    from_text, text_disposition = parse_ftd(
        [FTD_FIXTURES / "cnsfails-real-excerpt.txt"]
    )
    assert from_zip == from_text
    assert zip_disposition == text_disposition


def test_a_malformed_header_names_the_columns_found():
    with pytest.raises(FtdFormatError) as excinfo:
        parse_ftd([FTD_FIXTURES / "cnsfails-malformed.txt"])
    message = str(excinfo.value)
    assert "SETTLEMENT DATE" in message  # what was required
    assert "SETTLE_DT" in message  # what was actually there


def test_bad_dates_and_cusips_are_malformed_not_silently_dropped(tmp_path):
    path = tmp_path / "bad.txt"
    path.write_text(
        "SETTLEMENT DATE|CUSIP|SYMBOL|QUANTITY (FAILS)|DESCRIPTION|PRICE\n"
        "2026061|AAA111111|ALFA|1|A|1.00\n"
        "20261399|AAA111111|ALFA|1|A|1.00\n"
        "20260615|SHORT|ALFA|1|A|1.00\n"
        "20260615|AAA111111|ALFA\n"
        "\n"
        "Trailer record count 4\n"
        "20260615|AAA111111|ALFA|1|A|1.00\n"
        "20260615|AAA111111|ALFA|9|A|1.00\n",
        encoding="utf-8",
    )
    _observations, disposition = parse_ftd([path])
    assert disposition == Disposition(
        rows_read=8,
        accepted=1,
        rejected_blank=2,
        rejected_malformed=4,
        rejected_duplicate=1,
    )


def test_bootstrap_ftd_requires_an_open_transaction(tmp_path):
    conn = _fresh(tmp_path, "i.db")
    observations, disposition = parse_ftd([FTD_FIXTURES / "cnsfails-partition-a.txt"])
    with pytest.raises(sqlite3.ProgrammingError):
        bootstrap_ftd(
            conn, observations, registry=empty_registry(), disposition=disposition
        )
    conn.close()


# --- R7: one audit row, one data transaction ----------------------------------


def _run_command(conn, tmp_path, *, registry, ftd_paths=(), run_id="identity-test"):
    return run_identity_bootstrap(
        conn,
        tickers_path=SAMPLE,
        ftd_paths=ftd_paths,
        registry=registry,
        snapshot_date="2026-07-24",
        run_id=run_id,
        now=lambda: "2026-07-24T00:00:00+00:00",
        host="test-host",
    )


def _registry_snapshot(conn):
    return (
        conn.execute(
            "SELECT * FROM securities ORDER BY security_id"
        ).fetchall(),
        conn.execute(
            "SELECT * FROM security_identifiers ORDER BY id_type, value, valid_from"
        ).fetchall(),
        conn.execute(
            "SELECT * FROM security_supersessions ORDER BY old_security_id"
        ).fetchall(),
    )


def test_a_successful_run_records_one_ok_audit_row(tmp_path):
    conn = _fresh(tmp_path, "i.db")
    report = _run_command(
        conn,
        tmp_path,
        registry=empty_registry(),
        ftd_paths=[FTD_FIXTURES / "cnsfails-partition-a.txt"],
    )
    assert report.ok
    assert conn.execute(
        "SELECT job, status, rows_loaded, parse_failures, finished_at, host"
        " FROM ingest_runs"
    ).fetchall() == [
        ("identity", "ok", 7, 0, "2026-07-24T00:00:00+00:00", "test-host")
    ]
    conn.close()


@pytest.mark.parametrize("failing_pass", ["bootstrap_ftd", "bootstrap_tickers"])
def test_a_failure_rolls_back_the_whole_run_including_the_migration(
    tmp_path, monkeypatch, failing_pass
):
    # The all-or-nothing guarantee, with a NON-no-op registry revision in the
    # same transaction: if the migration could commit independently, the
    # registry would be left half-rekeyed under a failed run.
    conn = _fresh(tmp_path, "i.db")
    _run_ftd(conn, empty_registry(), "cnsfails-boundary-span.txt")
    before = _registry_snapshot(conn)
    assert before[0]  # the migration really does have work to do

    declared = load_identity_registry(IDENTITY_FIXTURES / "securities-class.yaml")

    def boom(*args, **kwargs):
        raise RuntimeError("injected failure")

    monkeypatch.setattr(bootstrap_module, failing_pass, boom)
    with pytest.raises(RuntimeError):
        _run_command(
            conn,
            tmp_path,
            registry=declared,
            ftd_paths=[FTD_FIXTURES / "cnsfails-boundary-span.txt"],
        )
    assert _registry_snapshot(conn) == before
    assert conn.execute(
        "SELECT status, finished_at FROM ingest_runs"
    ).fetchall() == [("failed", "2026-07-24T00:00:00+00:00")]
    conn.close()


def test_a_failure_finalizing_the_audit_row_rolls_the_data_back_too(
    tmp_path, monkeypatch
):
    conn = _fresh(tmp_path, "i.db")
    _run_ftd(conn, empty_registry(), "cnsfails-boundary-span.txt")
    before = _registry_snapshot(conn)

    def boom(*args, **kwargs):
        raise RuntimeError("injected finalization failure")

    monkeypatch.setattr(bootstrap_module, "_finalize_run_ok", boom)
    with pytest.raises(RuntimeError):
        _run_command(
            conn,
            tmp_path,
            registry=load_identity_registry(
                IDENTITY_FIXTURES / "securities-class.yaml"
            ),
            ftd_paths=[FTD_FIXTURES / "cnsfails-boundary-span.txt"],
        )
    assert _registry_snapshot(conn) == before
    # Never left `running`: the row ends `failed` even though the data
    # transaction was rolled back after the audit row was opened.
    assert conn.execute("SELECT status FROM ingest_runs").fetchall() == [("failed",)]
    conn.close()


def test_a_parse_failure_before_the_transaction_still_records_the_run(tmp_path):
    conn = _fresh(tmp_path, "i.db")
    with pytest.raises(FtdFormatError):
        _run_command(
            conn,
            tmp_path,
            registry=empty_registry(),
            ftd_paths=[FTD_FIXTURES / "cnsfails-malformed.txt"],
        )
    assert conn.execute("SELECT status FROM ingest_runs").fetchall() == [("failed",)]
    conn.close()


# --- the summary and the CLI --------------------------------------------------


def test_the_summary_prints_every_unit_and_lists_disputed_identifiers(tmp_path):
    conn = _fresh(tmp_path, "i.db")
    report = _run_command(
        conn,
        tmp_path,
        registry=empty_registry(),
        ftd_paths=[FTD_FIXTURES / "cnsfails-reuse.txt"],
    )
    summary = format_bootstrap_summary(report)
    assert "disposition [parse phase; buckets sum to rows_read]" in summary
    assert "rows_read: 4 source rows" in summary
    assert "entities_inserted: 3 entities rows" in summary
    assert "anchors_in_registry: 1 anchors" in summary
    assert "disputed identifiers awaiting review (1)" in summary
    assert "cusip 444444444 — REUSED ISSUER TWO COM" in summary
    conn.close()


def test_cli_bootstrap_seeds_the_registry(tmp_path):
    cache = tmp_path / "cache"
    cache.mkdir()
    (cache / "company_tickers.json").write_text(
        SAMPLE.read_text(encoding="utf-8"), encoding="utf-8"
    )
    db_path = tmp_path / "i.db"
    result = CliRunner().invoke(
        main,
        [
            "identity",
            "bootstrap",
            "--from-cache",
            str(cache),
            "--ftd",
            str(FTD_FIXTURES / "cnsfails-reuse.txt"),
            "--securities",
            str(IDENTITY_FIXTURES / "securities-fresh-split.yaml"),
            "--db",
            str(db_path),
            "--as-of",
            "2026-07-24",
        ],
    )
    assert result.exit_code == 0, result.output
    assert "identity bootstrap" in result.output
    conn = connect(str(db_path))
    # --securities reached BOTH the migration and the FTD pass.
    assert _security_ids(conn) == [
        "sec:test-reuse-era-one",
        "sec:test-reuse-era-two",
    ]
    assert conn.execute("SELECT count(*) FROM entity_tickers").fetchone() == (4,)
    conn.close()


def test_cli_reports_a_missing_ticker_file_as_a_usage_error(tmp_path):
    cache = tmp_path / "cache"
    cache.mkdir()
    result = CliRunner().invoke(
        main,
        ["identity", "bootstrap", "--from-cache", str(cache), "--db",
         str(tmp_path / "i.db")],
    )
    assert result.exit_code == 2
    assert "company_tickers.json does not exist" in result.output
    assert "Traceback" not in result.output


def test_cli_reports_a_malformed_archive_on_one_line(tmp_path):
    cache = tmp_path / "cache"
    cache.mkdir()
    (cache / "company_tickers.json").write_text(
        SAMPLE.read_text(encoding="utf-8"), encoding="utf-8"
    )
    result = CliRunner().invoke(
        main,
        [
            "identity",
            "bootstrap",
            "--from-cache",
            str(cache),
            "--ftd",
            str(FTD_FIXTURES / "cnsfails-malformed.txt"),
            "--db",
            str(tmp_path / "i.db"),
        ],
    )
    assert result.exit_code == 1
    assert "Traceback" not in result.output
    assert "fails-to-deliver" in result.output


def test_cli_rejects_a_non_iso_as_of(tmp_path):
    cache = tmp_path / "cache"
    cache.mkdir()
    (cache / "company_tickers.json").write_text(
        SAMPLE.read_text(encoding="utf-8"), encoding="utf-8"
    )
    # QA-F4: reject free-text, compact, and week-date forms — only canonical
    # YYYY-MM-DD may enter the lexicographically-compared date columns.
    for bad in ("last tuesday", "20200101", "2020-W01-1"):
        result = CliRunner().invoke(
            main,
            ["identity", "bootstrap", "--from-cache", str(cache), "--db",
             str(tmp_path / "i.db"), "--as-of", bad],
        )
        assert result.exit_code == 2, bad
        assert "canonical ISO date" in result.output, bad


def test_cli_reports_an_invalid_authority_file(tmp_path):
    cache = tmp_path / "cache"
    cache.mkdir()
    (cache / "company_tickers.json").write_text(
        SAMPLE.read_text(encoding="utf-8"), encoding="utf-8"
    )
    result = CliRunner().invoke(
        main,
        [
            "identity",
            "bootstrap",
            "--from-cache",
            str(cache),
            "--securities",
            str(IDENTITY_FIXTURES / "securities-invalid.yaml"),
            "--db",
            str(tmp_path / "i.db"),
        ],
    )
    assert result.exit_code == 1
    assert "999999999" in result.output
    assert "Traceback" not in result.output
