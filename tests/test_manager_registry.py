"""R12/R13/R24 — the curated manager registry: schema, join, and status gate.

The seed is real checked-in data, so these tests assert PROPERTIES of it
(computed counts, uniqueness, taxonomy membership, provenance completeness)
rather than a snapshot of its contents, which would turn every curation edit
into a test failure.
"""

import sqlite3
from datetime import date

import pytest
import yaml

from populus.manager_registry import (
    CATASTROPHIC_MATCH_FLOOR,
    MANAGER_TYPES,
    REQUIRED_FIELDS,
    ManagerRegistryError,
    enforce_manager_registry_join,
    join_manager_registry,
    load_manager_registry,
    stale_rows,
)

REGISTRY = load_manager_registry()


def filer_registry_db(ciks) -> sqlite3.Connection:
    """A minimal `agg_filer_registry`, storing CIKs the way the real one does:
    zero-padded ten-character TEXT."""
    conn = sqlite3.connect(":memory:")
    conn.execute("CREATE TABLE agg_filer_registry (cik TEXT PRIMARY KEY, filer_name TEXT)")
    conn.executemany(
        "INSERT INTO agg_filer_registry (cik, filer_name) VALUES (?, ?)",
        [(f"{c:010d}", f"FILER {c}") for c in ciks],
    )
    return conn


def write_seed(tmp_path, managers, **top):
    doc = {"version": 1, "population_floor": 5000, "managers": managers, **top}
    p = tmp_path / "reg.yaml"
    p.write_text(yaml.safe_dump(doc), encoding="utf-8")
    return p


def row(**over):
    base = {
        "cik": 1067983,
        "display_name": "Berkshire Hathaway",
        "person": "Warren Buffett",
        "sec_name": "BERKSHIRE HATHAWAY INC",
        "manager_type": "insurer",
        "notable": True,
        "status": "active",
        "verified_channel": "A",
        "verified_date": "2026-08-21",
    }
    base.update(over)
    return base


# --- R12: schema and provenance ---------------------------------------------

def test_every_row_carries_identity_and_provenance():
    for r in REGISTRY.rows:
        assert r.cik > 0
        assert r.display_name and r.sec_name
        assert r.verified_channel, f"CIK {r.cik} has no verification channel"
        assert r.verified_date, f"CIK {r.cik} has no verification date"


def test_row_count_is_COMPUTED_from_the_seed_not_asserted_by_hand():
    """Earlier hand-written counts in the design document were wrong."""
    raw = yaml.safe_load(
        (__import__("importlib.resources", fromlist=["resources"]).files("populus")
         .joinpath("manager_registry.yaml")).read_text(encoding="utf-8")
    )
    assert len(REGISTRY.rows) == len(raw["managers"])


def test_ciks_are_unique():
    assert len({r.cik for r in REGISTRY.rows}) == len(REGISTRY.rows)


def test_every_manager_type_is_in_the_reviewed_taxonomy():
    assert {r.manager_type for r in REGISTRY.rows} <= MANAGER_TYPES


def test_notable_is_ORTHOGONAL_to_manager_type():
    """A notable hedge fund is both, and both filters must show it."""
    both = [r for r in REGISTRY.rows if r.notable and r.manager_type == "hedge_fund"]
    assert both, "the orthogonality is not exercised by this seed"
    for r in both:
        assert r.notable is True and r.manager_type == "hedge_fund"


def test_unconfirmed_candidates_are_RECORDED_as_excluded_not_silently_dropped():
    assert REGISTRY.excluded, "the excluded list must exist"
    for e in REGISTRY.excluded:
        assert e.get("candidate") and e.get("reason"), (
            "an excluded candidate states WHY, so a later maintainer does not re-add it blindly"
        )


@pytest.mark.parametrize("field", REQUIRED_FIELDS)
def test_a_row_lacking_any_required_field_is_REJECTED_not_defaulted(tmp_path, field):
    bad = row()
    del bad[field]
    # F16: there is no document-level fallback for ANY required field, so no
    # field needs special handling here. This used to build a `top` override
    # that was `{}` on both branches, under a comment describing the fallback
    # the loader had already stopped honouring.
    with pytest.raises(ManagerRegistryError, match="missing required field"):
        load_manager_registry(write_seed(tmp_path, [bad]))


def test_a_row_without_its_OWN_verified_date_is_rejected(tmp_path):
    """F7: no document-level fallback for a REQUIRED row field.

    `verified_date` is the expiry clock for THIS row's verification. Inheriting
    it from a document default lets a row claim a date on which nobody verified
    it — which is precisely the unsourced-provenance claim the loader exists to
    refuse. The shipped seed already carries a per-row date on all 113 rows.

    The document-level key is supplied here DELIBERATELY, and the shipped seed no
    longer carries it (F16): the point is that the loader rejects the row even
    when the key is present, so the key is inert rather than merely absent.
    """
    bad = row()
    del bad["verified_date"]
    with pytest.raises(ManagerRegistryError, match="missing required field"):
        load_manager_registry(write_seed(tmp_path, [bad], verified_date_default="2026-08-21"))


def test_a_duplicate_cik_is_rejected(tmp_path):
    with pytest.raises(ManagerRegistryError, match="appears twice"):
        load_manager_registry(write_seed(tmp_path, [row(), row(display_name="Other")]))


def test_an_unreviewed_manager_type_is_rejected(tmp_path):
    with pytest.raises(ManagerRegistryError, match="not in the reviewed taxonomy"):
        load_manager_registry(write_seed(tmp_path, [row(manager_type="sovereign_ish")]))


def test_a_non_boolean_notable_is_rejected(tmp_path):
    with pytest.raises(ManagerRegistryError, match="orthogonal"):
        load_manager_registry(write_seed(tmp_path, [row(notable="yes")]))


def test_a_non_integer_cik_is_rejected(tmp_path):
    with pytest.raises(ManagerRegistryError, match="non-integer CIK"):
        load_manager_registry(write_seed(tmp_path, [row(cik="0001067983")]))


# --- R13/R24: the join and the status gate ----------------------------------

def test_the_join_normalizes_BOTH_sides_to_the_integer_cik():
    """The seed stores integers; agg_filer_registry stores padded text. A text
    comparison would silently match nothing at all."""
    conn = filer_registry_db([r.cik for r in REGISTRY.rows])
    report = join_manager_registry(conn, REGISTRY)
    assert len(report.matched) == len(REGISTRY.rows)
    assert report.match_rate == 1.0


def test_an_ACTIVE_row_that_does_not_join_FAILS_the_build_NAMING_the_cik(tmp_path):
    seed = load_manager_registry(
        write_seed(tmp_path, [row(cik=111, display_name="Gone Capital", status="active")])
    )
    report = join_manager_registry(filer_registry_db([999]), seed)
    assert [r.cik for r in report.unmatched_active] == [111]
    with pytest.raises(ManagerRegistryError) as exc:
        enforce_manager_registry_join(report)
    assert "111" in str(exc.value), "the failure must name the CIK, not just a count"
    assert "Gone Capital" in str(exc.value)


def test_a_RETIRED_row_is_excluded_from_typed_views_WITHOUT_failing(tmp_path):
    """The realistic shape: one manager wound down among a healthy seed."""
    managers = [row(cik=i, display_name=f"Live {i}") for i in range(1, 10)]
    managers.append(row(cik=111, display_name="Wound Down", status="retired"))
    seed = load_manager_registry(write_seed(tmp_path, managers))
    report = join_manager_registry(filer_registry_db(range(1, 10)), seed)
    enforce_manager_registry_join(report)  # must not raise
    assert [r.cik for r in report.unmatched_retired] == [111]
    assert 111 not in report.typed_ciks, "a retired row never types a filer"


def test_a_seed_that_is_ENTIRELY_retired_trips_the_backstop(tmp_path):
    """No single row is wrong, and that is exactly the case no per-row rule can
    catch: the seed has stopped describing the population it types."""
    seed = load_manager_registry(
        write_seed(tmp_path, [row(cik=111, display_name="Wound Down", status="retired")])
    )
    report = join_manager_registry(filer_registry_db([999]), seed)
    assert not report.unmatched_active
    with pytest.raises(ManagerRegistryError, match="decayed past the point"):
        enforce_manager_registry_join(report)


def test_unmatched_rows_are_reported_by_IDENTIFIER_not_by_percentage(tmp_path):
    seed = load_manager_registry(
        write_seed(
            tmp_path,
            [row(cik=111, display_name="A", status="retired"),
             row(cik=222, display_name="B", status="retired")],
        )
    )
    report = join_manager_registry(filer_registry_db([]), seed)
    assert sorted(r.cik for r in report.unmatched_retired) == [111, 222]


def test_the_floor_is_a_CATASTROPHIC_backstop_beneath_the_named_row_rule(tmp_path):
    """It can only fire once every ACTIVE row matched — otherwise the named-row
    rule raises first. So the floor catches a wholesale join break, never the
    ordinary decay of one manager reorganizing."""
    managers = [row(cik=1, display_name="Live", status="active")]
    managers += [
        row(cik=100 + i, display_name=f"Dead {i}", status="retired") for i in range(9)
    ]
    seed = load_manager_registry(write_seed(tmp_path, managers))
    report = join_manager_registry(filer_registry_db([1]), seed)
    assert not report.unmatched_active, "every active row matched"
    assert report.match_rate < CATASTROPHIC_MATCH_FLOOR
    with pytest.raises(ManagerRegistryError, match="decayed past the point"):
        enforce_manager_registry_join(report)


def test_typed_views_use_matched_rows_only(tmp_path):
    seed = load_manager_registry(
        write_seed(tmp_path, [row(cik=1, status="active"), row(cik=2, display_name="X", status="retired")])
    )
    report = join_manager_registry(filer_registry_db([1]), seed)
    assert report.typed_ciks == frozenset({1})


# --- verification ageing -----------------------------------------------------

def test_stale_rows_are_reported_against_the_verified_date_clock(tmp_path):
    seed = load_manager_registry(
        write_seed(tmp_path, [row(cik=1, verified_date="2020-01-01")])
    )
    assert [r.cik for r in stale_rows(seed, date(2026, 8, 21))] == [1]
    assert stale_rows(seed, date(2020, 2, 1)) == ()


def test_the_shipped_seed_is_fresh_as_of_its_own_newest_verification():
    newest = max(r.verified_date for r in REGISTRY.rows)
    assert stale_rows(REGISTRY, date.fromisoformat(newest)) == ()


# --- the build-stage gate ----------------------------------------------------

def test_the_gate_FIRES_at_or_above_the_declared_floor_when_a_row_vanishes(tmp_path):
    """The population-scale skip must not silently disable the gate.

    A registry the size of the real filer population, missing exactly one
    seeded CIK, must fail and name it.
    """
    from populus.inst_agg import gate_manager_registry

    seeded = [r.cik for r in REGISTRY.rows]
    dropped = seeded[0]
    # Population scale means AT OR ABOVE the seed's declared floor — padding to
    # 6,000 filers, with one seeded CIK missing.
    ciks = seeded[1:] + list(range(9_000_000, 9_006_000))
    db = tmp_path / "agg.db"
    conn = sqlite3.connect(db)
    conn.execute("CREATE TABLE agg_filer_registry (cik TEXT PRIMARY KEY, filer_name TEXT)")
    # The gate also materializes the typing, so the fixture carries the same
    # table a real aggregate's DDL creates.
    conn.execute(
        "CREATE TABLE agg_manager_registry (cik TEXT PRIMARY KEY, display_name TEXT,"
        " person TEXT, manager_type TEXT, notable INTEGER, verified_date TEXT)"
    )
    conn.executemany(
        "INSERT INTO agg_filer_registry (cik, filer_name) VALUES (?, ?)",
        [(f"{c:010d}", "F") for c in ciks],
    )
    conn.commit()
    conn.close()

    with pytest.raises(ManagerRegistryError) as exc:
        gate_manager_registry(db)
    assert str(dropped) in str(exc.value), "the gate must name the CIK that vanished"


def test_the_gate_ABSTAINS_below_the_seed_DECLARED_population_floor(tmp_path):
    """A partial extract is not the population the seed describes. Measured on
    the real data: the published aggregate matches 113/113, a local
    single-quarter extract matches 2 — gating the latter would report the
    extract's scope as a curation defect on every run."""
    from populus.inst_agg import gate_manager_registry

    db = tmp_path / "agg.db"
    conn = sqlite3.connect(db)
    conn.execute("CREATE TABLE agg_filer_registry (cik TEXT PRIMARY KEY, filer_name TEXT)")
    # The gate also materializes the typing, so the fixture carries the same
    # table a real aggregate's DDL creates.
    conn.execute(
        "CREATE TABLE agg_manager_registry (cik TEXT PRIMARY KEY, display_name TEXT,"
        " person TEXT, manager_type TEXT, notable INTEGER, verified_date TEXT)"
    )
    # 1-3 are seeded ACTIVE rows that join; 99 is present but RETIRED. Only the
    # active ones may be typed.
    conn.executemany(
        "INSERT INTO agg_filer_registry (cik, filer_name) VALUES (?, ?)",
        [(f"{c:010d}", "F") for c in (1, 2, 3, 99)],
    )
    conn.commit()
    conn.close()

    import populus.inst_agg as _ia

    seed = load_manager_registry(
        write_seed(
            tmp_path,
            [row(cik=1), row(cik=2, display_name="B"), row(cik=3, display_name="C"),
             row(cik=99, display_name="Retired", status="retired")],
        )
    )
    orig = _ia.load_manager_registry
    _ia.load_manager_registry = lambda: seed
    try:
        gate_manager_registry(db)  # must not raise
    finally:
        _ia.load_manager_registry = orig

    # F11: "does not raise" is NOT the property that matters. F26 was a SILENT
    # loss — the gate abstained and materialized nothing, so partial extracts
    # rendered zero curated names while the suite stayed green. Assert the
    # TABLE CONTENTS: exactly the matched ACTIVE rows.
    conn = sqlite3.connect(db)
    typed = {int(c) for (c,) in conn.execute("SELECT cik FROM agg_manager_registry")}
    conn.close()
    assert typed == {1, 2, 3}, f"expected the matched active rows to be typed, got {typed}"


def test_the_gate_PASSES_against_a_population_that_carries_every_seeded_cik(tmp_path):
    from populus.inst_agg import gate_manager_registry

    seeded = [r.cik for r in REGISTRY.rows]
    db = tmp_path / "agg.db"
    conn = sqlite3.connect(db)
    conn.execute("CREATE TABLE agg_filer_registry (cik TEXT PRIMARY KEY, filer_name TEXT)")
    # The gate also materializes the typing, so the fixture carries the same
    # table a real aggregate's DDL creates.
    conn.execute(
        "CREATE TABLE agg_manager_registry (cik TEXT PRIMARY KEY, display_name TEXT,"
        " person TEXT, manager_type TEXT, notable INTEGER, verified_date TEXT)"
    )
    conn.executemany(
        "INSERT INTO agg_filer_registry (cik, filer_name) VALUES (?, ?)",
        [(f"{c:010d}", "F") for c in seeded + list(range(9_000_000, 9_006_000))],
    )
    conn.commit()
    conn.close()
    gate_manager_registry(db)  # must not raise


def test_the_gate_STILL_FIRES_when_one_of_many_seeded_filers_vanishes(tmp_path):
    """The abstention must not weaken the decay rule it exists to serve: a
    majority present means this IS the population, so the one that vanished is
    a real disappearance and is named."""
    from populus.inst_agg import gate_manager_registry

    seeded = [r.cik for r in REGISTRY.rows]
    dropped = seeded[0]
    db = tmp_path / "agg.db"
    conn = sqlite3.connect(db)
    conn.execute("CREATE TABLE agg_filer_registry (cik TEXT PRIMARY KEY, filer_name TEXT)")
    conn.execute(
        "CREATE TABLE agg_manager_registry (cik TEXT PRIMARY KEY, display_name TEXT,"
        " person TEXT, manager_type TEXT, notable INTEGER, verified_date TEXT)"
    )
    conn.executemany(
        "INSERT INTO agg_filer_registry (cik, filer_name) VALUES (?, ?)",
        [(f"{c:010d}", "F") for c in list(seeded[1:]) + list(range(9_000_000, 9_006_000))],
    )
    conn.commit()
    conn.close()
    with pytest.raises(ManagerRegistryError) as exc:
        gate_manager_registry(db)
    assert str(dropped) in str(exc.value)


def test_the_join_MECHANISM_is_verified_independently_of_coverage(tmp_path):
    """F9: a broken join and a small module have the same symptom — zero
    matches — but only one is a defect. The mechanism is checked directly so
    the coverage rule never has to distinguish them."""
    from populus.inst_agg import gate_manager_registry

    db = tmp_path / "agg.db"
    conn = sqlite3.connect(db)
    conn.execute("CREATE TABLE agg_filer_registry (cik TEXT PRIMARY KEY, filer_name TEXT)")
    conn.execute(
        "CREATE TABLE agg_manager_registry (cik TEXT PRIMARY KEY, display_name TEXT,"
        " person TEXT, manager_type TEXT, notable INTEGER, verified_date TEXT)"
    )
    # CIKs that no longer normalize to integers: the join cannot match anything,
    # at any scale, and that is not curation decay.
    conn.executemany(
        "INSERT INTO agg_filer_registry (cik, filer_name) VALUES (?, ?)",
        [("CIK-0001067983", "F"), ("CIK-0000320193", "G")],
    )
    conn.commit()
    conn.close()
    with pytest.raises(ManagerRegistryError, match="do not normalize to a positive integer"):
        gate_manager_registry(db, publication=True)


def test_an_EMPTY_filer_relation_is_a_valid_published_state(tmp_path):
    """A corpus whose filings all conflict is WITHHELD and publishes its own
    absence. There is no join to verify, so there is nothing to fail on."""
    from populus.inst_agg import gate_manager_registry

    db = tmp_path / "agg.db"
    conn = sqlite3.connect(db)
    conn.execute("CREATE TABLE agg_filer_registry (cik TEXT PRIMARY KEY, filer_name TEXT)")
    conn.execute(
        "CREATE TABLE agg_manager_registry (cik TEXT PRIMARY KEY, display_name TEXT,"
        " person TEXT, manager_type TEXT, notable INTEGER, verified_date TEXT)"
    )
    conn.commit()
    conn.close()
    gate_manager_registry(db, publication=True)  # must not raise


def test_a_RETIRED_row_that_STILL_JOINS_is_excluded_from_typed_views(tmp_path):
    """F8: 'retired' is a curation decision about the LABEL, not an observation
    about the filer's presence. A still-filing manager marked retired must lose
    its curated name and type."""
    managers = [row(cik=i, display_name=f"Live {i}") for i in range(1, 10)]
    managers.append(row(cik=99, display_name="Still Filing", status="retired"))
    seed = load_manager_registry(write_seed(tmp_path, managers))
    report = join_manager_registry(filer_registry_db(list(range(1, 10)) + [99]), seed)
    assert 99 in report.matched, "the CIK is present and the join sees it"
    assert 99 not in report.typed_ciks, "but a retired row never types a filer"
    enforce_manager_registry_join(report)  # and it is not a failure


def test_a_wrong_join_target_at_population_scale_FAILS_rather_than_abstaining(tmp_path):
    """F9's exact hole: numerically valid CIKs that simply are not the seed's.

    The mechanism check passes (they parse), coverage is zero, and the OLD rule
    read zero coverage as 'this must be a small extract' and abstained. The
    declared floor removes that escape: at population scale, zero matches is a
    catastrophic join defect and must fail.
    """
    from populus.inst_agg import gate_manager_registry

    db = tmp_path / "agg.db"
    conn = sqlite3.connect(db)
    conn.execute("CREATE TABLE agg_filer_registry (cik TEXT PRIMARY KEY, filer_name TEXT)")
    conn.execute(
        "CREATE TABLE agg_manager_registry (cik TEXT PRIMARY KEY, display_name TEXT,"
        " person TEXT, manager_type TEXT, notable INTEGER, verified_date TEXT)"
    )
    # 6,000 filers — above the declared floor — none of them seeded.
    conn.executemany(
        "INSERT INTO agg_filer_registry (cik, filer_name) VALUES (?, ?)",
        [(f"{c:010d}", "F") for c in range(8_000_000, 8_006_000)],
    )
    conn.commit()
    conn.close()
    with pytest.raises(ManagerRegistryError) as exc:
        gate_manager_registry(db, publication=True)
    assert "do not join" in str(exc.value), "every active row is named as missing"


def test_the_declared_floor_is_REQUIRED_and_validated(tmp_path):
    doc_missing = write_seed(tmp_path, [row()])
    import yaml as _yaml

    data = _yaml.safe_load(doc_missing.read_text())
    del data["population_floor"]
    doc_missing.write_text(_yaml.safe_dump(data), encoding="utf-8")
    with pytest.raises(ManagerRegistryError, match="population_floor"):
        load_manager_registry(doc_missing)
