"""R21 — the recently-added-issuers leaderboard aggregate.

The fixtures here are built as delta-row tuples plus a grain->issuer map,
exactly the two structures the producer hands `_issuer_adds_rows`, so each test
pins a rule rather than a snapshot of a whole build.

The `top_adder` fixture is the important one: it is constructed so that a
manager whose COMBINED legs across several securities of one issuer outrank
another manager's larger SINGLE leg. An implementation that ranks position legs
instead of manager subtotals FAILS it rather than passing silently.
"""

from populus.inst_agg import (
    ADDS_MODES,
    _adds_issuer_name,
    _adds_sum,
    _issuer_adds_rows,
)

PERIOD = "2026-03-31"
INGESTED = "2026-08-21T00:00:00Z"


def delta(
    cik: str,
    position_key: str,
    *,
    change_kind: str = "add",
    delta_value: int | None = 100,
    put_call: str = "LONG",
    unit: str = "SH",
    curr_period: str = PERIOD,
):
    """A delta row in the producer's own tuple layout."""
    return (
        cik, position_key, put_call, curr_period, "2025-12-31", change_kind,
        None, None, delta_value, None, None, None, unit, "[]", INGESTED,
    )


def grain(cik, position_key, issuer_key, name="Issuer", *, put_call="LONG",
          unit="SH", source="entity", period=PERIOD):
    return {(cik, period, position_key, put_call, unit): {issuer_key: (source, name)}}


def merge(*maps):
    out: dict = {}
    for m in maps:
        for k, v in m.items():
            out.setdefault(k, {}).update(v)
    return out


FILERS = {
    "0000000001": {"filer_name": "Manager One"},
    "0000000002": {"filer_name": "Manager Two"},
}


def rows_by_mode(rows):
    return {m: [r for r in rows if r[1] == m] for m in ADDS_MODES}


# --- null aggregation --------------------------------------------------------

def test_all_null_value_sums_to_none_never_zero():
    """A wholly undisclosed issuer renders an em dash, never $0."""
    rows, _ = _issuer_adds_rows(
        [delta("0000000001", "sid:a", delta_value=None)],
        grain("0000000001", "sid:a", "entity:1"),
        FILERS, INGESTED,
    )
    row = rows_by_mode(rows)["all"][0]
    assert row[7] is None, "an all-null sum is NULL, never 0"
    assert row[8] == 1, "and it is marked partial"


def test_mixed_null_sums_only_disclosed_components_and_marks_partial():
    rows, _ = _issuer_adds_rows(
        [
            delta("0000000001", "sid:a", delta_value=500),
            delta("0000000002", "sid:b", delta_value=None),
        ],
        merge(grain("0000000001", "sid:a", "entity:1"),
              grain("0000000002", "sid:b", "entity:1")),
        FILERS, INGESTED,
    )
    row = rows_by_mode(rows)["all"][0]
    assert row[7] == 500, "only the disclosed component is summed"
    assert row[8] == 1, "a partial sum is never presented as a total"


def test_complete_sum_is_not_marked_partial():
    rows, _ = _issuer_adds_rows(
        [delta("0000000001", "sid:a", delta_value=5),
         delta("0000000002", "sid:b", delta_value=3)],
        merge(grain("0000000001", "sid:a", "entity:1"),
              grain("0000000002", "sid:b", "entity:1")),
        FILERS, INGESTED,
    )
    row = rows_by_mode(rows)["all"][0]
    assert row[7] == 8 and row[8] == 0


# --- top adder: SUBTOTALS, not legs -----------------------------------------

def test_top_adder_ranks_manager_subtotals_not_position_legs():
    """Manager One's three legs (40+40+40=120) beat Manager Two's single 100.

    A leg-ranking implementation names Manager Two, because 100 is the largest
    single leg. The published aggregate carries 58,829 multi-security
    manager/issuer/period rows, so this is the common case, not a corner.
    """
    deltas = [
        delta("0000000001", "sid:a", delta_value=40),
        delta("0000000001", "sid:b", delta_value=40),
        delta("0000000001", "sid:c", delta_value=40),
        delta("0000000002", "sid:d", delta_value=100),
    ]
    g = merge(
        grain("0000000001", "sid:a", "entity:1"),
        grain("0000000001", "sid:b", "entity:1"),
        grain("0000000001", "sid:c", "entity:1"),
        grain("0000000002", "sid:d", "entity:1"),
    )
    rows, _ = _issuer_adds_rows(deltas, g, FILERS, INGESTED)
    row = rows_by_mode(rows)["all"][0]
    assert row[9] == 1, "the manager with the larger SUBTOTAL is the top adder"
    assert row[10] == "Manager One"


def test_top_adder_ties_break_on_smallest_cik():
    deltas = [delta("0000000002", "sid:a", delta_value=50),
              delta("0000000001", "sid:b", delta_value=50)]
    g = merge(grain("0000000002", "sid:a", "entity:1"),
              grain("0000000001", "sid:b", "entity:1"))
    rows, _ = _issuer_adds_rows(deltas, g, FILERS, INGESTED)
    assert rows_by_mode(rows)["all"][0][9] == 1


def test_top_adder_is_null_when_no_manager_has_a_disclosed_subtotal():
    """Never an arbitrary fallback — an unrankable field is stated as absent."""
    deltas = [delta("0000000001", "sid:a", delta_value=None),
              delta("0000000002", "sid:b", delta_value=None)]
    g = merge(grain("0000000001", "sid:a", "entity:1"),
              grain("0000000002", "sid:b", "entity:1"))
    rows, _ = _issuer_adds_rows(deltas, g, FILERS, INGESTED)
    row = rows_by_mode(rows)["all"][0]
    assert row[9] is None and row[10] is None


def test_partial_subtotal_is_eligible_and_the_row_carries_the_marker():
    deltas = [delta("0000000001", "sid:a", delta_value=90),
              delta("0000000001", "sid:b", delta_value=None),
              delta("0000000002", "sid:c", delta_value=10)]
    g = merge(grain("0000000001", "sid:a", "entity:1"),
              grain("0000000001", "sid:b", "entity:1"),
              grain("0000000002", "sid:c", "entity:1"))
    rows, _ = _issuer_adds_rows(deltas, g, FILERS, INGESTED)
    row = rows_by_mode(rows)["all"][0]
    assert row[9] == 1, "a partial subtotal still ranks"
    assert row[8] == 1, "and the row says the value is partial"


# --- ambiguous identity ------------------------------------------------------

def test_a_grain_with_disagreeing_issuer_keys_is_rejected_and_counted():
    """Not split, not assigned to one — stated."""
    g = {(("0000000001"), PERIOD, "sid:a", "LONG", "SH"): {
        "entity:1": ("entity", "Issuer A"),
        "entity:2": ("entity", "Issuer B"),
    }}
    rows, ambiguous = _issuer_adds_rows(
        [delta("0000000001", "sid:a")], g, FILERS, INGESTED
    )
    assert rows == [], "an ambiguous grain contributes to no issuer"
    assert ambiguous[(PERIOD, "all")] == 1
    assert ambiguous[(PERIOD, "new")] == 0 if (PERIOD, "new") in ambiguous else True


def test_ambiguity_is_counted_per_mode():
    g = {("0000000001", PERIOD, "sid:a", "LONG", "SH"): {
        "entity:1": ("entity", "A"), "entity:2": ("entity", "B")}}
    _, ambiguous = _issuer_adds_rows(
        [delta("0000000001", "sid:a", change_kind="new")], g, FILERS, INGESTED
    )
    assert ambiguous[(PERIOD, "all")] == 1, "a new position is in the all mode too"
    assert ambiguous[(PERIOD, "new")] == 1


def test_one_grain_backed_by_several_holdings_sharing_an_issuer_is_not_ambiguous():
    g = {("0000000001", PERIOD, "sid:a", "LONG", "SH"): {
        "entity:1": ("entity", "Issuer A")}}
    rows, ambiguous = _issuer_adds_rows(
        [delta("0000000001", "sid:a")], g, FILERS, INGESTED
    )
    assert len(rows_by_mode(rows)["all"]) == 1
    assert ambiguous == {}


# --- modes are independent ---------------------------------------------------

def test_new_mode_metrics_are_computed_over_new_rows_only():
    """The whole reason mode is a path dimension, not a client filter."""
    deltas = [
        delta("0000000001", "sid:a", change_kind="new", delta_value=10),
        delta("0000000002", "sid:b", change_kind="add", delta_value=990),
    ]
    g = merge(grain("0000000001", "sid:a", "entity:1"),
              grain("0000000002", "sid:b", "entity:1"))
    rows, _ = _issuer_adds_rows(deltas, g, FILERS, INGESTED)
    by = rows_by_mode(rows)
    assert by["all"][0][7] == 1000 and by["all"][0][5] == 2
    # the new-only view must NOT carry the add's 990, its manager, or its count
    assert by["new"][0][7] == 10, "new mode sums only new positions"
    assert by["new"][0][5] == 1, "and counts only their managers"
    assert by["new"][0][10] == "Manager One", "and names only their top adder"


def test_trim_and_exit_never_reach_the_leaderboard():
    deltas = [delta("0000000001", "sid:a", change_kind="trim", delta_value=-5),
              delta("0000000001", "sid:b", change_kind="exit", delta_value=-5)]
    g = merge(grain("0000000001", "sid:a", "entity:1"),
              grain("0000000001", "sid:b", "entity:1"))
    rows, _ = _issuer_adds_rows(deltas, g, FILERS, INGESTED)
    assert rows == []


# --- total order -------------------------------------------------------------

def test_total_order_is_value_desc_nulls_last_then_managers_then_issuer_key():
    deltas = [
        delta("0000000001", "sid:a", delta_value=None),   # issuer N -> null
        delta("0000000001", "sid:b", delta_value=10),     # issuer B
        delta("0000000001", "sid:c", delta_value=50),     # issuer A
    ]
    g = merge(
        grain("0000000001", "sid:a", "entity:N"),
        grain("0000000001", "sid:b", "entity:B"),
        grain("0000000001", "sid:c", "entity:A"),
    )
    rows, _ = _issuer_adds_rows(deltas, g, FILERS, INGESTED)
    order = [r[2] for r in rows_by_mode(rows)["all"]]
    assert order == ["entity:A", "entity:B", "entity:N"], (
        "value DESC with NULLS LAST — a null must not rank as zero or as largest"
    )


def test_issuer_key_breaks_a_full_tie_deterministically():
    deltas = [delta("0000000001", "sid:a", delta_value=10),
              delta("0000000001", "sid:b", delta_value=10)]
    g = merge(grain("0000000001", "sid:a", "entity:z"),
              grain("0000000001", "sid:b", "entity:a"))
    rows, _ = _issuer_adds_rows(deltas, g, FILERS, INGESTED)
    assert [r[2] for r in rows_by_mode(rows)["all"]] == ["entity:a", "entity:z"]


# --- issuer naming -----------------------------------------------------------

def test_issuer_name_is_the_most_frequent_non_null_tie_broken_lexicographically():
    assert _adds_issuer_name(["B", "A", "A", None]) == "A"
    assert _adds_issuer_name(["B", "A"]) == "A"
    assert _adds_issuer_name([None, None]) is None


def test_helper_sum_semantics():
    assert _adds_sum([None, None]) == (None, True)
    assert _adds_sum([5, None]) == (5, True)
    assert _adds_sum([5, 3]) == (8, False)


# --- end-to-end through the REAL producer -----------------------------------


def test_the_leaderboard_is_populated_by_a_real_two_period_build(tmp_path):
    """Integration, not unit: the aggregate the DASHBOARD reads must carry the
    leaderboard, and both build paths must agree on it.

    `_agg` builds the python path AND the materialized bulk path and compares
    every relation, so this also pins that the two paths do not diverge on the
    new tables — the twin-code-path defect this repository has been bitten by.
    """
    from test_inst_agg import _agg, _db, _entity, _filer, _hold, _load, _rows, _security

    conn = _db(tmp_path)
    cik = "0000000001"
    _filer(conn, cik, "Manager One")
    eid = _entity(conn, "0000009999")
    sid = _security(conn, "sec:aaa", entity_id=eid, link="resolved")

    # Prior quarter: one position. Current quarter: bigger, plus a brand-new one.
    _load(conn, fid=f"f:{cik}:1", cik=cik, period="2025-12-31", filed="2026-02-10",
          holds=[_hold(ordinal=1, issuer="ACME CORP", cusip="00000010", value=1_000,
                       shares=100, security_id=sid)])
    sid2 = _security(conn, "sec:bbb", entity_id=_entity(conn, "0000008888"), link="resolved")
    _load(conn, fid=f"f:{cik}:2", cik=cik, period="2026-03-31", filed="2026-05-10",
          holds=[
              _hold(ordinal=1, issuer="ACME CORP", cusip="00000010", value=3_000,
                    shares=300, security_id=sid),
              _hold(ordinal=2, issuer="NEWCO INC", cusip="00000020", value=500,
                    shares=50, security_id=sid2),
          ])

    agg = _agg(conn, tmp_path)
    rows = _rows(
        agg,
        "SELECT * FROM agg_issuer_adds WHERE period_of_report = '2026-03-31'"
        " ORDER BY mode, issuer_key",
    )
    assert rows, "a real two-period build must produce leaderboard rows"

    all_mode = [r for r in rows if r["mode"] == "all"]
    new_mode = [r for r in rows if r["mode"] == "new"]

    # `all` sees the add (ACME, +2000) and the new position (NEWCO, +500).
    assert {r["delta_value_usd"] for r in all_mode} == {2_000, 500}
    # `new` sees ONLY the brand-new position — never the add's value.
    assert [r["delta_value_usd"] for r in new_mode] == [500]
    assert all(r["new_position_count"] == 1 for r in new_mode)

    for r in rows:
        assert r["manager_count"] == 1
        assert r["top_adder_cik"] == 1, "the padded CIK is stored as an integer"
        assert r["top_adder_name"] == "Manager One"
        assert r["delta_value_is_partial"] == 0

    # Every emitted (period, mode) carries an exclusion row, even at zero: an
    # absent row and a zero are different claims.
    excl = _rows(agg, "SELECT * FROM agg_issuer_adds_exclusions ORDER BY mode")
    assert {e["mode"] for e in excl} == {"all", "new"}
    assert all(e["ambiguous_identity_exclusion_count"] == 0 for e in excl)
