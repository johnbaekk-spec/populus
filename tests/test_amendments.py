"""§9.5 amendment semantics: views, durable flags, pair invariants (RUN 4;
R8–R9). The Senate pairing pass itself is tested in test_senate_ingest.py —
this module owns the default-view exclusion rule, flag durability across
row rebuilds, and the structural pair invariants."""

from __future__ import annotations

import json

import pytest

from populus.amendments import (
    ensure_views,
    flag_unresolved_pair_rows,
    pair_invariant_errors,
)


def _default_view_filings(conn):
    return {
        f
        for (f,) in conn.execute(
            "SELECT DISTINCT filing_id FROM v_default_transactions"
        )
    }


def _flags(conn, filing_id):
    return [
        json.loads(flags)
        for (flags,) in conn.execute(
            "SELECT flags FROM transactions WHERE filing_id = ? ORDER BY row_ordinal",
            (filing_id,),
        )
    ]


# --- view application (R9) ----------------------------------------------------


def test_ensure_views_is_idempotent_and_covers_preexisting_dbs(initialized_db):
    # init_db already applied the views; re-application is a no-op.
    ensure_views(initialized_db)
    # A pre-RUN-4 database (no views) gains them on first application.
    initialized_db.execute("DROP VIEW v_default_transactions")
    initialized_db.execute("DROP VIEW v_amendment_pairs")
    ensure_views(initialized_db)
    views = {
        name
        for (name,) in initialized_db.execute(
            "SELECT name FROM sqlite_master WHERE type = 'view'"
        )
    }
    assert {"v_default_transactions", "v_amendment_pairs"} <= views


# --- default-view semantics (R9/§9.5) -----------------------------------------


def test_default_view_excludes_original_of_unresolved_pair(
    initialized_db, make_amendment_pair
):
    original, amendment = make_amendment_pair(initialized_db)
    assert _default_view_filings(initialized_db) == {amendment}

    # Aggregates over the view therefore never double-count the pair.
    (count,) = initialized_db.execute(
        "SELECT COUNT(*) FROM v_default_transactions"
    ).fetchone()
    assert count == 1


def test_default_view_excludes_non_active_lifecycles(
    initialized_db, make_filing, make_row
):
    from populus.load import load_filing

    for filing_id, lifecycle in (
        ("house:1", "active"),
        ("house:2", "retired"),
        ("house:3", "superseded"),
        ("house:4", "withdrawn"),
    ):
        make_filing(
            initialized_db,
            filing_id=filing_id,
            lifecycle=lifecycle,
            doc_url=f"https://example.invalid/{filing_id}",
        )
        load_filing(
            initialized_db,
            filing_id,
            [make_row(asset_name=f"A {filing_id}")],
            parse_status="parsed",
            parser_version="t",
            normalization_version="t",
        )
    assert _default_view_filings(initialized_db) == {"house:1"}


def test_default_view_restores_original_when_amendment_not_active(
    initialized_db, make_amendment_pair
):
    original, amendment = make_amendment_pair(initialized_db)
    # If the amendment itself leaves the active lifecycle, it no longer
    # shadows its original (the exclusion keys on an ACTIVE superseder).
    initialized_db.execute(
        "UPDATE filings SET lifecycle = 'retired' WHERE filing_id = ?",
        (amendment,),
    )
    assert _default_view_filings(initialized_db) == {original}


def test_pairs_view_exposes_both_sides(initialized_db, make_amendment_pair):
    original, amendment = make_amendment_pair(initialized_db)
    row = initialized_db.execute(
        "SELECT amendment_filing_id, original_filing_id, chamber,"
        " amendment_filed_date, original_filed_date, amendment_lifecycle,"
        " original_lifecycle FROM v_amendment_pairs"
    ).fetchone()
    assert row == (
        amendment,
        original,
        "senate",
        "2026-06-01",
        "2026-05-10",
        "active",
        "active",
    )


# --- durable flag propagation (R8) --------------------------------------------


def test_flag_propagation_flags_both_sides_idempotently(
    initialized_db, make_amendment_pair
):
    original, amendment = make_amendment_pair(initialized_db)
    # The factory mirrors ingest: amendment rows flagged, original rows not.
    assert all("amendment_unresolved" not in f for f in _flags(initialized_db, original))

    changed = flag_unresolved_pair_rows(initialized_db)
    assert changed == 1  # exactly the original's row gained the flag
    for filing_id in (original, amendment):
        assert all(
            "amendment_unresolved" in f for f in _flags(initialized_db, filing_id)
        )
    # Idempotent: nothing left to add, flags not duplicated.
    assert flag_unresolved_pair_rows(initialized_db) == 0
    assert all(
        f.count("amendment_unresolved") == 1
        for f in _flags(initialized_db, original)
    )


def test_flag_propagation_never_writes_lifecycle_or_supersedes(
    initialized_db, make_amendment_pair
):
    original, amendment = make_amendment_pair(initialized_db)
    before = initialized_db.execute(
        "SELECT filing_id, lifecycle, supersedes FROM filings ORDER BY filing_id"
    ).fetchall()
    flag_unresolved_pair_rows(initialized_db)
    after = initialized_db.execute(
        "SELECT filing_id, lifecycle, supersedes FROM filings ORDER BY filing_id"
    ).fetchall()
    assert after == before


def test_house_reparse_tail_restores_pair_flags(
    initialized_db, make_amendment_pair, tmp_path
):
    # R8 durability: even a HOUSE reparse (which rebuilds no senate rows but
    # runs the propagation pass at its tail) restores a stripped flag.
    from populus.ingest.house import ReparseSelector, reparse_house

    original, _amendment = make_amendment_pair(initialized_db)
    flag_unresolved_pair_rows(initialized_db)
    initialized_db.execute(
        "UPDATE transactions SET flags = '[]' WHERE filing_id = ?", (original,)
    )
    reparse_house(
        initialized_db, raw_root=tmp_path, selector=ReparseSelector()
    )
    assert all(
        "amendment_unresolved" in f for f in _flags(initialized_db, original)
    )


# --- pair invariants (R8) -----------------------------------------------------


def test_pair_invariants_clean_pair(initialized_db, make_amendment_pair):
    make_amendment_pair(initialized_db)
    assert pair_invariant_errors(initialized_db) == []


def test_pair_invariants_detect_defects(initialized_db, make_filing):
    make_filing(
        initialized_db,
        filing_id="house:10",
        chamber="house",
        filed_date="2026-06-01",
        doc_url="https://example.invalid/house:10",
    )
    # Chamber mismatch + amendment filed BEFORE its original.
    make_filing(
        initialized_db,
        filing_id="senate:00000000-0000-4000-8000-000000000011",
        chamber="senate",
        filer_name_raw="Doe, Jane",
        filed_date="2026-05-01",
        filing_kind="ptr_amendment",
        supersedes="house:10",
        source="senate-efd",
        doc_url="https://example.invalid/senate:11",
    )
    errors = pair_invariant_errors(initialized_db)
    assert len(errors) == 2
    assert any("chamber" in e for e in errors)
    assert any("before its original" in e for e in errors)


def test_pair_invariants_detect_self_reference(initialized_db, make_filing):
    make_filing(initialized_db, filing_id="house:20")
    initialized_db.execute(
        "UPDATE filings SET supersedes = 'house:20' WHERE filing_id = 'house:20'"
    )
    errors = pair_invariant_errors(initialized_db)
    assert errors == ["house:20: supersedes itself"]


@pytest.mark.parametrize("same_day", ["2026-05-10"])
def test_pair_invariants_allow_same_day_pair(initialized_db, make_amendment_pair, same_day):
    make_amendment_pair(
        initialized_db, original_filed=same_day, amendment_filed=same_day
    )
    assert pair_invariant_errors(initialized_db) == []
