"""R8 — `agg_security_directory`, the period-keyed identity projection.

Fixture-driven on purpose. The available inst corpus carries a SINGLE period
(`2026-06-30`), so it cannot exercise the two properties that matter most —
that an issuer renamed between quarters resolves per-quarter, and that an exit
row joins on the PRIOR period. A corpus that cannot distinguish right from
wrong here would make a green run meaningless.
"""

from __future__ import annotations

import sqlite3

import pytest

from populus.inst_agg import InstAggError, _write_security_directory

_RELATION = "(SELECT * FROM holdings)"


def _source(rows: list[tuple]) -> sqlite3.Connection:
    conn = sqlite3.connect(":memory:")
    conn.execute(
        "CREATE TABLE holdings (cik TEXT, period_of_report TEXT, security_id TEXT,"
        " cusip TEXT, issuer_name_raw TEXT, title_of_class TEXT, value_usd INTEGER,"
        " entity_id TEXT, entity_link_state TEXT, is_default INTEGER)"
    )
    conn.executemany("INSERT INTO holdings VALUES (?,?,?,?,?,?,?,?,?,?)", rows)
    return conn


def _dest() -> sqlite3.Connection:
    conn = sqlite3.connect(":memory:")
    conn.execute(
        "CREATE TABLE agg_security_directory (period_of_report TEXT, position_key TEXT,"
        " issuer_key TEXT, issuer_name TEXT, class_title TEXT, ticker TEXT, cusip TEXT,"
        " resolution_source TEXT, ingested_at TEXT,"
        " PRIMARY KEY (period_of_report, position_key))"
    )
    return conn


def _run(rows: list[tuple]) -> dict[tuple[str, str], sqlite3.Row]:
    src, dest = _source(rows), _dest()
    _write_security_directory(src, dest, ingested_at="T", source_relation=_RELATION)
    dest.row_factory = sqlite3.Row
    return {
        (r["period_of_report"], r["position_key"]): r
        for r in dest.execute("SELECT * FROM agg_security_directory")
    }


def test_a_renamed_issuer_resolves_PER_PERIOD_not_once() -> None:
    """The G14 guard: one key, two quarters, two different reported names.

    A directory keyed on `position_key` alone would stamp whichever name won
    onto BOTH rows — silently rewriting history. This is the single most
    important property of the table.
    """
    out = _run([
        ("c1", "2026-03-31", "S1", "037833100", "Apple Computer Inc", "COM", 100, None, None, 1),
        ("c1", "2026-06-30", "S1", "037833100", "Apple Inc", "COM", 100, None, None, 1),
    ])
    assert out[("2026-03-31", "sid:S1")]["issuer_name"] == "Apple Computer Inc"
    assert out[("2026-06-30", "sid:S1")]["issuer_name"] == "Apple Inc"


def test_the_representative_is_the_highest_value_then_lexicographic() -> None:
    """Deterministic across rebuilds, not insertion-ordered."""
    out = _run([
        ("c1", "2026-06-30", "S1", "037833100", "Zeta Holdings", "COM", 10, None, None, 1),
        ("c2", "2026-06-30", "S1", "037833100", "Alpha Corp", "COM", 900, None, None, 1),
    ])
    assert out[("2026-06-30", "sid:S1")]["issuer_name"] == "Alpha Corp", "value must win"

    # Equal value -> lexicographic identity breaks the tie, both orders alike.
    tied = [
        ("c1", "2026-06-30", "S2", "111111100", "Beta Inc", "COM", 500, None, None, 1),
        ("c2", "2026-06-30", "S2", "111111100", "Alpha Inc", "COM", 500, None, None, 1),
    ]
    assert _run(tied)[("2026-06-30", "sid:S2")]["issuer_name"] == "Alpha Inc"
    assert _run(tied[::-1])[("2026-06-30", "sid:S2")]["issuer_name"] == "Alpha Inc"


def test_resolution_source_records_HOW_the_issuer_was_keyed() -> None:
    out = _run([
        ("c1", "2026-06-30", "S1", "037833100", "Apple Inc", "COM", 10, "E9", "resolved", 1),
        ("c1", "2026-06-30", "S2", "594918104", "Microsoft Corp", "COM", 10, None, None, 1),
        ("c1", "2026-06-30", "S3", None, "Private Co", None, 10, None, None, 1),
    ])
    assert out[("2026-06-30", "sid:S1")]["resolution_source"] == "entity"
    assert out[("2026-06-30", "sid:S1")]["issuer_key"] == "entity:E9"
    assert out[("2026-06-30", "sid:S2")]["resolution_source"] == "cusip6"
    assert out[("2026-06-30", "sid:S2")]["issuer_key"] == "cusip6:594918"
    assert out[("2026-06-30", "sid:S3")]["resolution_source"] == "name"
    # An unresolved entity link is NOT an entity key — the weaker claim is used.
    assert out[("2026-06-30", "sid:S3")]["class_title"] is None


def test_an_unresolved_entity_link_does_not_produce_an_entity_key() -> None:
    """`entity_id` present but not `resolved` must fall through, not be trusted."""
    out = _run([
        ("c1", "2026-06-30", "S1", "037833100", "Apple Inc", "COM", 10, "E9", "conflict", 1),
    ])
    assert out[("2026-06-30", "sid:S1")]["resolution_source"] == "cusip6"


def test_ticker_is_never_invented() -> None:
    """No registry ships in production, so a ticker would be fabricated."""
    out = _run([
        ("c1", "2026-06-30", "S1", "037833100", "Apple Inc", "COM", 10, "E9", "resolved", 1),
    ])
    assert out[("2026-06-30", "sid:S1")]["ticker"] is None


@pytest.mark.parametrize("blank", ["", "   "])
def test_an_empty_resolved_name_is_a_BUILD_ERROR(blank: str) -> None:
    """R8: never publish a blank identity — it renders as an empty cell, which
    is the defect this requirement exists to remove wearing a disguise."""
    with pytest.raises(InstAggError, match="empty issuer name"):
        _run([("c1", "2026-06-30", "S1", "037833100", blank, "COM", 10, None, None, 1)])


def test_non_default_rows_are_excluded() -> None:
    """The directory describes the DEFAULT population, like every other agg."""
    out = _run([
        ("c1", "2026-06-30", "S1", "037833100", "Apple Inc", "COM", 10, None, None, 0),
    ])
    assert out == {}


def test_a_cusip_only_position_keys_on_cusip() -> None:
    out = _run([
        ("c1", "2026-06-30", None, "037833100", "Apple Inc", "COM", 10, None, None, 1),
    ])
    assert ("2026-06-30", "cusip:037833100") in out
