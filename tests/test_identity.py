"""§5.4 identity registries: schema, as-of resolution, ownership windows.

The load-bearing claims proved here are the ones that make identity safe to
build on: G14 (no mapping used outside its interval, no date-free
identifier -> entity path), DC1 (one name per entity per date or none), DC2
(validity never spans a gap or an ownership boundary), DC3 (a declared
security_id is durable) and R18 (an unreviewed reuse candidate resolves
nowhere).
"""

from __future__ import annotations

import inspect
import sqlite3
from pathlib import Path

import pytest

from populus.identity.registry import (
    PROVISIONAL_ID_PREFIX,
    REUSE_REVIEW_HORIZON_DAYS,
    SECURITY_ID_REFERENCING_TABLES,
    EntityRef,
    IdentityRegistryError,
    OwnerWindow,
    anchor,
    cut_interval,
    default_securities_text,
    ensure_registry,
    entity_id_for,
    load_identity_registry,
    normalize_cik,
    normalize_cusip,
    normalize_entity_name,
    normalize_ticker,
    owner_windows,
    parse_identity_registry,
    provisional_security_id,
    registry_overlap_errors,
    resolve_cusip,
    resolve_entity_by_cik,
    resolve_security_successor,
    resolve_superseded,
    resolve_ticker_as_of,
    target_for,
    union_intervals,
)

FIXTURES = Path(__file__).resolve().parent / "fixtures" / "inst"
IDENTITY_FIXTURES = FIXTURES / "identity"

REGISTRY_TABLES = {
    "entities",
    "entity_names",
    "entity_tickers",
    "securities",
    "security_identifiers",
    "security_supersessions",
}
M1_TABLES = {"members", "member_aliases", "filings", "transactions", "ingest_runs"}


# --- schema (R1) --------------------------------------------------------------


def test_db_init_creates_every_registry_table_and_index(initialized_db):
    tables = {
        name
        for (name,) in initialized_db.execute(
            "SELECT name FROM sqlite_master WHERE type = 'table'"
        )
    }
    assert REGISTRY_TABLES <= tables
    # The M1 schema is untouched by this run.
    assert M1_TABLES <= tables
    indexes = {
        name
        for (name,) in initialized_db.execute(
            "SELECT name FROM sqlite_master WHERE type = 'index'"
        )
    }
    assert {"security_identifier_no_overlap", "entity_ticker_no_overlap"} <= indexes
    assert "alias_no_overlap" in indexes


def test_ensure_registry_is_idempotent_and_upgrades_an_m1_database(tmp_path):
    # A database created before RUN M2-1 (schema.sql only) gains the registry
    # on first use, with no M1 table touched.
    import importlib.resources

    path = tmp_path / "m1.db"
    conn = sqlite3.connect(str(path), isolation_level=None)
    conn.executescript(
        importlib.resources.files("populus")
        .joinpath("schema.sql")
        .read_text(encoding="utf-8")
    )
    before = {
        name
        for (name,) in conn.execute(
            "SELECT name FROM sqlite_master WHERE type = 'table'"
        )
    }
    assert not (REGISTRY_TABLES & before)
    ensure_registry(conn)
    ensure_registry(conn)  # idempotent
    after = {
        name
        for (name,) in conn.execute(
            "SELECT name FROM sqlite_master WHERE type = 'table'"
        )
    }
    assert REGISTRY_TABLES <= after
    assert before <= after
    conn.close()


def test_entity_cik_is_unique(initialized_db):
    initialized_db.execute(
        "INSERT INTO entities (entity_id, cik) VALUES ('cik:0000000001', '0000000001')"
    )
    with pytest.raises(sqlite3.IntegrityError):
        initialized_db.execute(
            "INSERT INTO entities (entity_id, cik)"
            " VALUES ('cik:other', '0000000001')"
        )


def test_id_type_check_rejects_an_unadmitted_identifier(initialized_db):
    initialized_db.execute(
        "INSERT INTO securities (security_id, id_state) VALUES ('sec:x', 'declared')"
    )
    with pytest.raises(sqlite3.IntegrityError):
        initialized_db.execute(
            "INSERT INTO security_identifiers (security_id, id_type, value,"
            " valid_from, provenance, confidence, review_state, license_id)"
            " VALUES ('sec:x', 'isin', 'US0378331005', '2020-01-01', 'sec-ftd',"
            " 'high', 'auto', 'sec-ftd')"
        )


def test_id_state_check_rejects_an_undeclared_tier(initialized_db):
    with pytest.raises(sqlite3.IntegrityError):
        initialized_db.execute(
            "INSERT INTO securities (security_id, id_state)"
            " VALUES ('sec:x', 'guessed')"
        )


def test_security_review_state_check_rejects_an_unknown_verdict(initialized_db):
    with pytest.raises(sqlite3.IntegrityError):
        initialized_db.execute(
            "INSERT INTO securities (security_id, id_state, review_state)"
            " VALUES ('sec:x', 'declared', 'probably')"
        )


@pytest.mark.parametrize(
    "column,bad",
    [("confidence", "vibes"), ("review_state", "probably")],
)
def test_identifier_enumerations_are_checked(initialized_db, column, bad):
    initialized_db.execute(
        "INSERT INTO securities (security_id, id_state) VALUES ('sec:x', 'declared')"
    )
    values = {"confidence": "high", "review_state": "auto"}
    values[column] = bad
    with pytest.raises(sqlite3.IntegrityError):
        initialized_db.execute(
            "INSERT INTO security_identifiers (security_id, id_type, value,"
            " valid_from, provenance, confidence, review_state, license_id)"
            " VALUES ('sec:x', 'cusip', '111111111', '2020-01-01', 'sec-ftd',"
            " ?, ?, 'sec-ftd')",
            (values["confidence"], values["review_state"]),
        )


def test_entity_link_state_check_forbids_a_stamped_link_without_the_state(
    initialized_db, make_entity
):
    make_entity(initialized_db)
    with pytest.raises(sqlite3.IntegrityError):
        initialized_db.execute(
            "INSERT INTO securities (security_id, id_state, entity_id,"
            " entity_link_state) VALUES ('sec:x', 'declared', 'cik:0000000001',"
            " 'unresolved')"
        )
    with pytest.raises(sqlite3.IntegrityError):
        initialized_db.execute(
            "INSERT INTO securities (security_id, id_state, entity_id,"
            " entity_link_state) VALUES ('sec:y', 'declared', NULL, 'resolved')"
        )


def test_supersession_reason_is_checked_and_one_to_many_is_allowed(initialized_db):
    for security_id in ("sec:a", "sec:b"):
        initialized_db.execute(
            "INSERT INTO securities (security_id, id_state) VALUES (?, 'declared')",
            (security_id,),
        )
    with pytest.raises(sqlite3.IntegrityError):
        initialized_db.execute(
            "INSERT INTO security_supersessions (old_security_id, security_id,"
            " reason, source) VALUES ('sec:old', 'sec:a', 'renamed', 'x')"
        )
    for successor in ("sec:a", "sec:b"):
        initialized_db.execute(
            "INSERT INTO security_supersessions (old_security_id, security_id,"
            " reason, source) VALUES ('sec:old', ?, 'split', 'securities.yaml')",
            (successor,),
        )
    assert resolve_superseded(initialized_db, "sec:old") == ("sec:a", "sec:b")
    assert resolve_security_successor(initialized_db, "sec:old") is None


def test_entity_names_primary_key_is_the_no_overlap_key(initialized_db, make_entity):
    make_entity(initialized_db, valid_from="2020-01-01")
    with pytest.raises(sqlite3.IntegrityError):
        make_entity(initialized_db, name="Other", valid_from="2020-01-01")


def test_two_securities_cannot_hold_one_identifier_from_the_same_day(
    initialized_db, make_security_identifier
):
    make_security_identifier(initialized_db, security_id="sec:a", id_state="declared")
    with pytest.raises(sqlite3.IntegrityError):
        make_security_identifier(
            initialized_db, security_id="sec:b", id_state="declared"
        )


def test_two_entities_cannot_hold_one_ticker_from_the_same_day(
    initialized_db, make_entity, make_entity_ticker
):
    first = make_entity(initialized_db, "1")
    second = make_entity(initialized_db, "2", name="Beta Inc")
    make_entity_ticker(initialized_db, entity_id=first, ticker="ALFA")
    with pytest.raises(sqlite3.IntegrityError):
        make_entity_ticker(initialized_db, entity_id=second, ticker="ALFA")


# --- the invariant a UNIQUE index cannot express ------------------------------


def test_registry_overlap_errors_reports_contained_windows(
    initialized_db, make_entity, make_entity_ticker, make_security_identifier
):
    entity = make_entity(initialized_db)
    make_entity_ticker(
        initialized_db, entity_id=entity, ticker="ALFA", valid_from="2020-01-01"
    )
    make_entity_ticker(
        initialized_db,
        entity_id=entity,
        ticker="ALFA",
        valid_from="2020-06-01",
        valid_to="2020-07-01",
    )
    make_security_identifier(
        initialized_db, security_id="sec:a", valid_from="2020-01-01"
    )
    make_security_identifier(
        initialized_db,
        security_id="sec:b",
        valid_from="2020-06-01",
        valid_to="2020-07-01",
    )
    errors = registry_overlap_errors(initialized_db)
    assert any("entity_tickers" in error and "ALFA" in error for error in errors)
    assert any("security_identifiers" in error for error in errors)


def test_registry_overlap_errors_catches_a_containment_three_rows_apart(
    initialized_db, make_entity, make_entity_ticker
):
    # The adjacent-pair scan is complete for start-ordered intervals: a window
    # that contains a LATER one is still caught with unrelated rows in between.
    entity = make_entity(initialized_db)
    make_entity_ticker(
        initialized_db,
        entity_id=entity,
        ticker="ALFA",
        valid_from="2020-01-01",
        valid_to="2030-01-01",
    )
    for start, end in (("2021-01-01", "2021-02-01"), ("2022-01-01", "2022-02-01")):
        make_entity_ticker(
            initialized_db,
            entity_id=entity,
            ticker="ALFA",
            valid_from=start,
            valid_to=end,
        )
    errors = registry_overlap_errors(initialized_db)
    assert any("ALFA" in error for error in errors)


def test_registry_overlap_errors_accepts_windows_that_meet_at_a_boundary(
    initialized_db, make_entity, make_entity_ticker
):
    entity = make_entity(initialized_db)
    make_entity_ticker(
        initialized_db,
        entity_id=entity,
        ticker="ALFA",
        valid_from="2020-01-01",
        valid_to="2020-06-01",
    )
    make_entity_ticker(
        initialized_db, entity_id=entity, ticker="ALFA", valid_from="2020-06-01"
    )
    assert registry_overlap_errors(initialized_db) == []


# --- as-of resolution (R2/G14) ------------------------------------------------


def test_every_resolver_requires_an_as_of_date():
    # The structural G14 guard: there is no public identifier -> entity path
    # that can be called without a date, so "the current mapping" is not
    # expressible.
    from populus.identity import registry as registry_module

    dated = {"resolve_cusip", "resolve_entity_by_cik", "resolve_ticker_as_of"}
    found = {
        name
        for name in dir(registry_module)
        if name.startswith("resolve_")
        and name not in ("resolve_superseded", "resolve_security_successor")
    }
    assert found == dated
    for name in sorted(dated):
        parameter = inspect.signature(
            getattr(registry_module, name)
        ).parameters.get("as_of_date")
        assert parameter is not None, name
        assert parameter.default is inspect.Parameter.empty, name


def test_resolve_cusip_is_bounded_by_its_half_open_interval(
    initialized_db, make_security_identifier
):
    make_security_identifier(
        initialized_db,
        security_id="sec:a",
        value="111111111",
        valid_from="2026-01-05",
        valid_to="2026-01-08",
    )
    assert resolve_cusip(initialized_db, "111111111", "2026-01-04") is None
    assert resolve_cusip(initialized_db, "111111111", "2026-01-05") == "sec:a"
    assert resolve_cusip(initialized_db, "111111111", "2026-01-07") == "sec:a"
    # valid_to is EXCLUSIVE.
    assert resolve_cusip(initialized_db, "111111111", "2026-01-08") is None


def test_resolve_ticker_is_bounded_by_its_half_open_interval(
    initialized_db, make_entity, make_entity_ticker
):
    entity = make_entity(initialized_db)
    make_entity_ticker(
        initialized_db,
        entity_id=entity,
        ticker="ALFA",
        valid_from="2026-01-05",
        valid_to="2026-01-08",
    )
    assert resolve_ticker_as_of(initialized_db, "ALFA", "2026-01-04") is None
    assert resolve_ticker_as_of(initialized_db, "ALFA", "2026-01-05") == entity
    assert resolve_ticker_as_of(initialized_db, "ALFA", "2026-01-08") is None


def test_cusip_cannot_chain_through_a_current_ticker(
    initialized_db, make_entity, make_entity_ticker, make_security_identifier
):
    # The G14 defect this design forbids: CUSIP -> "current" ticker -> CIK.
    # The CUSIP binding is January-only while the ticker is open-ended, so a
    # February question about the CUSIP has no answer — the open ticker window
    # cannot be borrowed to manufacture one.
    entity = make_entity(initialized_db)
    make_entity_ticker(
        initialized_db, entity_id=entity, ticker="ALFA", valid_from="2020-01-01"
    )
    make_security_identifier(
        initialized_db,
        security_id="sec:a",
        value="111111111",
        valid_from="2026-01-01",
        valid_to="2026-02-01",
    )
    assert resolve_cusip(initialized_db, "111111111", "2026-01-15") == "sec:a"
    assert resolve_cusip(initialized_db, "111111111", "2026-02-15") is None
    assert resolve_ticker_as_of(initialized_db, "ALFA", "2026-02-15") == entity


def test_ambiguous_rows_fail_closed(initialized_db, make_entity, make_entity_ticker):
    first = make_entity(initialized_db, "1")
    second = make_entity(initialized_db, "2", name="Beta Inc")
    make_entity_ticker(
        initialized_db, entity_id=first, ticker="ALFA", valid_from="2020-01-01"
    )
    # Only reachable by bypassing the unique index (different valid_from); the
    # resolver still refuses rather than picking one.
    make_entity_ticker(
        initialized_db, entity_id=second, ticker="ALFA", valid_from="2020-01-02"
    )
    assert resolve_ticker_as_of(initialized_db, "ALFA", "2021-01-01") is None
    assert registry_overlap_errors(initialized_db) != []


def test_resolve_entity_by_cik_returns_a_non_null_name_or_nothing(
    initialized_db, make_entity
):
    entity = make_entity(initialized_db, "320193", name="Apple Inc.")
    reference = resolve_entity_by_cik(initialized_db, "320193", "2021-01-01")
    assert reference == EntityRef(
        entity_id=entity, cik="0000320193", name="Apple Inc."
    )
    assert isinstance(reference.name, str) and reference.name
    # Before the name interval opens there is no unique applicable name.
    assert resolve_entity_by_cik(initialized_db, "320193", "2019-01-01") is None
    assert resolve_entity_by_cik(initialized_db, "999999", "2021-01-01") is None


def test_resolve_entity_by_cik_fails_closed_on_two_applicable_names(
    initialized_db, make_entity
):
    make_entity(initialized_db, "1", name="Alfa Corp", valid_from="2020-01-01")
    make_entity(initialized_db, "1", name="Alfa Holdings", valid_from="2020-06-01")
    assert resolve_entity_by_cik(initialized_db, "1", "2021-01-01") is None


def test_a_disputed_identifier_resolves_nowhere_in_either_era(
    initialized_db, make_security_identifier
):
    # R18: an unreviewed reuse candidate is never resolvable, at any date,
    # because doing so could conflate two distinct instruments.
    make_security_identifier(
        initialized_db,
        security_id="sec:a",
        value="444444444",
        valid_from="2013-01-31",
        valid_to="2013-02-01",
        review_state="disputed",
        confidence="low",
    )
    make_security_identifier(
        initialized_db,
        security_id="sec:a",
        value="444444444",
        valid_from="2024-05-01",
        valid_to="2024-05-02",
        review_state="disputed",
        confidence="low",
    )
    assert resolve_cusip(initialized_db, "444444444", "2013-01-31") is None
    assert resolve_cusip(initialized_db, "444444444", "2024-05-01") is None


def test_a_disputed_ticker_row_resolves_nowhere(
    initialized_db, make_entity, make_entity_ticker
):
    entity = make_entity(initialized_db)
    make_entity_ticker(
        initialized_db,
        entity_id=entity,
        ticker="ALFA",
        valid_from="2020-01-01",
        review_state="disputed",
    )
    assert resolve_ticker_as_of(initialized_db, "ALFA", "2021-01-01") is None


# --- normalizers reject rather than coerce ------------------------------------


@pytest.mark.parametrize(
    "raw,expected",
    [
        ("320193", "0000320193"),
        (320193, "0000320193"),
        ("0000320193", "0000320193"),
        ("cik:320193", "0000320193"),
        # QA-F5: overpadded input canonicalizes to EXACTLY ten digits, never
        # more — one numeric CIK must not exist under two keys.
        ("000000000001", "0000000001"),
        ("00000000000320193", "0000320193"),
        ("", None),
        ("32A193", None),
        ("12345678901", None),  # 11 significant digits — rejected
        (None, None),
    ],
)
def test_normalize_cik(raw, expected):
    assert normalize_cik(raw) == expected


@pytest.mark.parametrize(
    "raw,expected",
    [
        ("037833100", "037833100"),
        (" b38564108 ", "B38564108"),
        ("03783310", None),  # eight characters: never padded into a valid CUSIP
        ("0378331000", None),
        ("037-83310", None),
        (None, None),
    ],
)
def test_normalize_cusip(raw, expected):
    assert normalize_cusip(raw) == expected


@pytest.mark.parametrize(
    "raw,expected",
    [("aapl", "AAPL"), ("BRK.B", "BRK.B"), ("  ", None), ("A B", None), (None, None)],
)
def test_normalize_ticker(raw, expected):
    assert normalize_ticker(raw) == expected


def test_normalize_entity_name_collapses_whitespace_and_keeps_case():
    assert normalize_entity_name("  Apple\t Inc.  ") == "Apple Inc."
    assert normalize_entity_name("   ") is None


def test_entity_id_for_rejects_a_non_cik():
    assert entity_id_for("320193") == "cik:0000320193"
    with pytest.raises(ValueError):
        entity_id_for("not-a-cik")


# --- ownership windows, provisional ids, targets ------------------------------


def test_provisional_ids_are_pure_deterministic_and_labelled():
    first = provisional_security_id(anchor("cusip", "037833100"))
    second = provisional_security_id(anchor("cusip", "037833100"))
    assert first == second
    assert first.startswith(PROVISIONAL_ID_PREFIX)
    assert first != provisional_security_id(anchor("cusip", "594918104"))


def test_target_for_returns_the_declared_owner_inside_its_window():
    registry = load_identity_registry(IDENTITY_FIXTURES / "securities-class-split.yaml")
    before = target_for(registry, "cusip", "333333333", "2019-12-31")
    on_boundary = target_for(registry, "cusip", "333333333", "2020-01-01")
    assert before == ("sec:test-issuer-common", "declared", "equity")
    assert on_boundary == ("sec:test-successor", "declared", "equity")
    # A value named by no class is fully provisional, one id for all time.
    unnamed = target_for(registry, "cusip", "888888888", "2020-01-01")
    assert unnamed == (
        provisional_security_id(anchor("cusip", "888888888")),
        "provisional",
        None,
    )


def test_owner_windows_coalesce_adjacent_same_owner_windows():
    registry = parse_identity_registry(
        """
classes:
  - security_id: "sec:one"
    identifiers:
      - {id_type: cusip, value: "111111111", to: "2020-01-01"}
      - {id_type: cusip, value: "111111111", from: "2020-01-01"}
    note: one owner, stated as two touching windows
    review_state: reviewed
continuities: []
"""
    )
    windows = owner_windows(registry, "cusip", "111111111")
    assert windows == (
        OwnerWindow(None, None, "sec:one", "declared", None),
    )


# --- cut_interval unit table (R17) --------------------------------------------

_WINDOWS = (
    OwnerWindow(None, "2020-01-01", "sec:a", "declared", "equity"),
    OwnerWindow("2020-01-01", "2021-01-01", "sec:b", "declared", "equity"),
    OwnerWindow("2021-01-01", None, "sec:c", "declared", "equity"),
)


@pytest.mark.parametrize(
    "interval,expected",
    [
        # wholly inside one window
        (("2019-01-01", "2019-06-01"), (("sec:a", "2019-01-01", "2019-06-01"),)),
        # crossing one boundary
        (
            ("2019-12-31", "2020-01-02"),
            (
                ("sec:a", "2019-12-31", "2020-01-01"),
                ("sec:b", "2020-01-01", "2020-01-02"),
            ),
        ),
        # crossing two boundaries
        (
            ("2019-12-31", "2021-01-02"),
            (
                ("sec:a", "2019-12-31", "2020-01-01"),
                ("sec:b", "2020-01-01", "2021-01-01"),
                ("sec:c", "2021-01-01", "2021-01-02"),
            ),
        ),
        # starting exactly on a boundary
        (("2020-01-01", "2020-02-01"), (("sec:b", "2020-01-01", "2020-02-01"),)),
        # ending exactly on a boundary
        (("2019-12-01", "2020-01-01"), (("sec:a", "2019-12-01", "2020-01-01"),)),
        # open-ended valid_to
        (
            ("2020-06-01", None),
            (
                ("sec:b", "2020-06-01", "2021-01-01"),
                ("sec:c", "2021-01-01", None),
            ),
        ),
        # a single day
        (("2020-05-05", "2020-05-06"), (("sec:b", "2020-05-05", "2020-05-06"),)),
    ],
)
def test_cut_interval_partitions_and_reconstructs_exactly(interval, expected):
    pieces = cut_interval(interval, _WINDOWS)
    assert pieces == expected
    # Totality: the pieces cover the input exactly once — no lost or
    # duplicated days.
    assert pieces[0][1] == interval[0]
    assert pieces[-1][2] == interval[1]
    for previous, current in zip(pieces, pieces[1:]):
        assert previous[2] == current[1]


def test_cut_interval_leaves_a_provisional_row_untouched():
    windows = (OwnerWindow(None, None, "sec:prov:x", "provisional", None),)
    assert cut_interval(("2020-01-01", "2020-01-02"), windows) == (
        ("sec:prov:x", "2020-01-01", "2020-01-02"),
    )


# --- union_intervals: adjacency only (DC2/R9) ---------------------------------


@pytest.mark.parametrize(
    "existing,dates,expected",
    [
        ((), (), ()),
        ((), ("2026-01-05",), (("2026-01-05", "2026-01-06"),)),
        # adjacent observations merge
        (
            (),
            ("2026-01-05", "2026-01-06"),
            (("2026-01-05", "2026-01-07"),),
        ),
        # a one-day gap is NEVER bridged
        (
            (),
            ("2026-01-05", "2026-01-07"),
            (("2026-01-05", "2026-01-06"), ("2026-01-07", "2026-01-08")),
        ),
        # duplicates are idempotent
        (
            (),
            ("2026-01-05", "2026-01-05"),
            (("2026-01-05", "2026-01-06"),),
        ),
        # order does not matter
        (
            (),
            ("2026-01-07", "2026-01-05", "2026-01-06"),
            (("2026-01-05", "2026-01-08"),),
        ),
        # an existing interval is extended by an adjacent observation
        (
            (("2026-01-05", "2026-01-06"),),
            ("2026-01-06",),
            (("2026-01-05", "2026-01-07"),),
        ),
        # an open-ended existing interval absorbs later observations
        (
            (("2026-01-05", None),),
            ("2026-02-01",),
            (("2026-01-05", None),),
        ),
    ],
)
def test_union_intervals(existing, dates, expected):
    assert union_intervals(existing, dates) == expected


def test_gapped_observations_leave_the_gap_day_unresolvable(
    initialized_db, make_security_identifier
):
    for start, end in union_intervals((), ("2026-01-05", "2026-01-07")):
        make_security_identifier(
            initialized_db,
            security_id="sec:a",
            value="111111111",
            valid_from=start,
            valid_to=end,
        )
    assert resolve_cusip(initialized_db, "111111111", "2026-01-05") == "sec:a"
    assert resolve_cusip(initialized_db, "111111111", "2026-01-06") is None
    assert resolve_cusip(initialized_db, "111111111", "2026-01-07") == "sec:a"
    assert resolve_cusip(initialized_db, "111111111", "2026-01-08") is None


# --- interlocks ---------------------------------------------------------------


def test_declared_id_survives_binding_revision():
    # Interlock A: declared ids are literals from the authority. Across three
    # reviewed revisions — base, one more binding, then a split handing one
    # binding away — the class keeps its id, its other identifiers and its
    # metadata.
    base = load_identity_registry(IDENTITY_FIXTURES / "securities-class.yaml")
    extended = load_identity_registry(
        IDENTITY_FIXTURES / "securities-class-extended.yaml"
    )
    split = load_identity_registry(IDENTITY_FIXTURES / "securities-class-split.yaml")

    identity = "sec:test-issuer-common"
    for registry in (base, extended, split):
        entry = registry.class_for(identity)
        assert entry is not None
        assert entry.security_id == identity
        assert entry.class_ == "equity"
        assert entry.review_state == "reviewed"

    def values(registry):
        return {
            window.value for window in registry.class_for(identity).identifiers
        }

    assert values(base) == {"111111111", "222222222", "333333333"}
    assert values(extended) == {"111111111", "222222222", "333333333", "555555555"}
    # After the split it STILL owns the other two for all time.
    assert values(split) == {"111111111", "222222222", "333333333"}
    for value in ("111111111", "222222222"):
        assert owner_windows(split, "cusip", value) == (
            OwnerWindow(None, None, identity, "declared", "equity"),
        )
    assert target_for(split, "cusip", "333333333", "2019-12-31")[0] == identity
    assert target_for(split, "cusip", "333333333", "2020-01-01")[0] == (
        "sec:test-successor"
    )


def test_horizon_flag_does_not_widen_validity(initialized_db, make_security_identifier):
    # Interlock D: the reuse horizon is a REVIEW trigger, never a validity
    # rule. Flagging a decade-scale gap must not bridge it.
    from populus.identity.registry import reuse_review_decisions

    registry = load_identity_registry(IDENTITY_FIXTURES / "securities-continuity.yaml")
    for start, end in (("2013-01-31", "2013-02-01"), ("2024-05-01", "2024-05-02")):
        make_security_identifier(
            initialized_db,
            security_id="sec:a",
            value="444444444",
            valid_from=start,
            valid_to=end,
        )
    before = initialized_db.execute(
        "SELECT valid_from, valid_to FROM security_identifiers ORDER BY valid_from"
    ).fetchall()
    decision = reuse_review_decisions(
        initialized_db, anchor("cusip", "444444444"), registry
    )
    assert decision.flagged and decision.cleared and not decision.disputed
    after = initialized_db.execute(
        "SELECT valid_from, valid_to FROM security_identifiers ORDER BY valid_from"
    ).fetchall()
    assert after == before
    # And the gap stays unresolvable even though it was cleared for review.
    assert resolve_cusip(initialized_db, "444444444", "2018-06-01") is None


def test_reuse_horizon_is_a_labelled_decade_scale_constant():
    assert REUSE_REVIEW_HORIZON_DAYS == 3650


def test_a_declared_boundary_inside_the_gap_explains_it(
    initialized_db, make_security_identifier
):
    from populus.identity.registry import reuse_review_decisions

    registry = load_identity_registry(
        IDENTITY_FIXTURES / "securities-fresh-split.yaml"
    )
    make_security_identifier(
        initialized_db,
        security_id="sec:test-reuse-era-one",
        id_state="declared",
        value="444444444",
        valid_from="2013-01-31",
        valid_to="2013-02-01",
    )
    make_security_identifier(
        initialized_db,
        security_id="sec:test-reuse-era-two",
        id_state="declared",
        value="444444444",
        valid_from="2024-05-01",
        valid_to="2024-05-02",
    )
    decision = reuse_review_decisions(
        initialized_db, anchor("cusip", "444444444"), registry
    )
    assert decision.flagged
    assert not decision.disputed and not decision.cleared


def test_security_id_referencing_tables_is_the_enforced_constant():
    assert SECURITY_ID_REFERENCING_TABLES == (
        "security_identifiers",
        "security_supersessions",
    )


# --- the authority file (R16) -------------------------------------------------


def test_packaged_securities_file_loads_and_validates():
    # Mirrors the packaged-aliases invariant: the shipped file must satisfy its
    # own rules.
    registry = load_identity_registry()
    assert registry.classes == ()
    assert registry.continuities == ()
    text = default_securities_text()
    assert "classes:" in text and "continuities:" in text
    assert parse_identity_registry(text) == registry


@pytest.mark.parametrize(
    "name",
    [
        "securities-class.yaml",
        "securities-class-extended.yaml",
        "securities-class-split.yaml",
        "securities-fresh-split.yaml",
        "securities-continuity.yaml",
    ],
)
def test_valid_authority_fixtures_parse(name):
    registry = load_identity_registry(IDENTITY_FIXTURES / name)
    assert isinstance(registry.classes, tuple)


def test_the_invalid_fixture_names_the_uncovered_range():
    with pytest.raises(IdentityRegistryError) as excinfo:
        load_identity_registry(IDENTITY_FIXTURES / "securities-invalid.yaml")
    message = str(excinfo.value)
    assert "999999999" in message
    assert "2020-01-01" in message


_ONE_WINDOW = '      - {id_type: cusip, value: "111111111"}\n'


def _authority(body: str) -> str:
    return body


MALFORMED = {
    "missing note": (
        'classes:\n  - security_id: "sec:x"\n    identifiers:\n' + _ONE_WINDOW,
        "note",
    ),
    "two windows both unbounded below": (
        # F1 regression: two classes owning one value with no `from` are both
        # unbounded below. This must raise an actionable IdentityRegistryError,
        # not a raw TypeError from comparing a date with None.
        'classes:\n  - security_id: "sec:a"\n    note: n\n    identifiers:\n'
        '      - {id_type: cusip, value: "999999999", to: "2015-01-01"}\n'
        '  - security_id: "sec:b"\n    note: n\n    identifiers:\n'
        '      - {id_type: cusip, value: "999999999", to: "2020-01-01"}\n'
        "continuities: []\n",
        "unbounded below",
    ),
    "noncanonical compact boundary date": (
        # QA-F4: date.fromisoformat accepts compact/week-date forms, which would
        # be retained noncanonical and compared lexicographically. Reject them.
        'classes:\n  - security_id: "sec:x"\n    note: n\n    identifiers:\n'
        '      - {id_type: cusip, value: "444444444", to: "20200101"}\n'
        "continuities: []\n",
        "canonical ISO date",
    ),
    "reserved provisional prefix": (
        'classes:\n  - security_id: "sec:prov:abc"\n    note: n\n'
        "    identifiers:\n" + _ONE_WINDOW,
        "reserved",
    ),
    "malformed security_id": (
        'classes:\n  - security_id: "SEC:Bad Id"\n    note: n\n'
        "    identifiers:\n" + _ONE_WINDOW,
        "security_id must match",
    ),
    "duplicate security_id": (
        'classes:\n  - security_id: "sec:x"\n    note: n\n    identifiers:\n'
        '      - {id_type: cusip, value: "111111111"}\n'
        '  - security_id: "sec:x"\n    note: n\n    identifiers:\n'
        '      - {id_type: cusip, value: "222222222"}\n',
        "duplicate security_id",
    ),
    "empty identifiers": (
        'classes:\n  - security_id: "sec:x"\n    note: n\n    identifiers: []\n',
        "non-empty list",
    ),
    "unadmitted id_type": (
        'classes:\n  - security_id: "sec:x"\n    note: n\n    identifiers:\n'
        '      - {id_type: isin, value: "111111111"}\n',
        "id_type must be one of",
    ),
    "not a cusip": (
        'classes:\n  - security_id: "sec:x"\n    note: n\n    identifiers:\n'
        '      - {id_type: cusip, value: "11111"}\n',
        "9-character CUSIP",
    ),
    "empty window": (
        'classes:\n  - security_id: "sec:x"\n    note: n\n    identifiers:\n'
        '      - {id_type: cusip, value: "111111111", from: "2021-01-01",'
        ' to: "2020-01-01"}\n',
        "empty",
    ),
    "duplicate identifier entry": (
        'classes:\n  - security_id: "sec:x"\n    note: n\n    identifiers:\n'
        + _ONE_WINDOW
        + _ONE_WINDOW,
        "duplicate identifier entry",
    ),
    "overlapping windows": (
        'classes:\n  - security_id: "sec:x"\n    note: n\n    identifiers:\n'
        '      - {id_type: cusip, value: "111111111", to: "2021-01-01"}\n'
        '  - security_id: "sec:y"\n    note: n\n    identifiers:\n'
        '      - {id_type: cusip, value: "111111111", from: "2020-01-01"}\n',
        "overlap",
    ),
    "non-covering windows": (
        'classes:\n  - security_id: "sec:x"\n    note: n\n    identifiers:\n'
        '      - {id_type: cusip, value: "111111111", to: "2020-01-01"}\n'
        '  - security_id: "sec:y"\n    note: n\n    identifiers:\n'
        '      - {id_type: cusip, value: "111111111", from: "2021-01-01"}\n',
        "no owner on",
    ),
    "gap_from after gap_to": (
        "classes: []\ncontinuities:\n"
        '  - anchor: {id_type: cusip, value: "444444444"}\n'
        '    gap_from: "2024-05-01"\n    gap_to: "2013-02-01"\n    note: n\n',
        "must precede",
    ),
    "continuity with a bad anchor": (
        "classes: []\ncontinuities:\n"
        '  - anchor: {id_type: cusip, value: "44"}\n'
        '    gap_from: "2013-02-01"\n    gap_to: "2024-05-01"\n    note: n\n',
        "9-character CUSIP",
    ),
    "continuity anchor owned by two classes": (
        'classes:\n  - security_id: "sec:x"\n    note: n\n    identifiers:\n'
        '      - {id_type: cusip, value: "444444444", to: "2020-01-01"}\n'
        '  - security_id: "sec:y"\n    note: n\n    identifiers:\n'
        '      - {id_type: cusip, value: "444444444", from: "2020-01-01"}\n'
        "continuities:\n"
        '  - anchor: {id_type: cusip, value: "444444444"}\n'
        '    gap_from: "2013-02-01"\n    gap_to: "2024-05-01"\n    note: n\n',
        "2 classes",
    ),
    "continuity without a note": (
        "classes: []\ncontinuities:\n"
        '  - anchor: {id_type: cusip, value: "444444444"}\n'
        '    gap_from: "2013-02-01"\n    gap_to: "2024-05-01"\n',
        "note",
    ),
}


@pytest.mark.parametrize("label", sorted(MALFORMED))
def test_authority_validation_is_actionable(label):
    text, needle = MALFORMED[label]
    with pytest.raises(IdentityRegistryError) as excinfo:
        parse_identity_registry(_authority(text))
    assert needle in str(excinfo.value), str(excinfo.value)
