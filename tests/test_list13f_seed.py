"""Seeding the definitional 13(f)-list identity intervals (RUN M2-5, R7).

Quarter-exact validity, authority-window intersection (mid-quarter, year and
leap-year boundaries), replay policy, cross-source precedence and the fail-closed
resolver — every behavioural claim exercised through the real seeder + resolver.
"""

from __future__ import annotations

import pytest

from populus.db import connect, init_db
from populus.identity.bootstrap import FtdObservation, Mutations, bootstrap_ftd
from populus.identity.list13f_seed import (
    List13fReseedError,
    bootstrap_13f_list,
)
from populus.identity.registry import (
    ensure_registry,
    parse_identity_registry,
    reconcile_only,
    resolve_cusip,
    resolve_security_name,
    registry_overlap_errors,
)
from populus.parse.list13f import parse_list13f_text

APPLE = "037833100"
MSFT = "594918104"
EMPTY = parse_identity_registry("classes: []\ncontinuities: []\n")


def _line(cusip, name, cls, *, status="   ", opt=False) -> str:
    row = (
        cusip.ljust(9)[:9] + ("*" if opt else " ") + name.ljust(30)[:30]
        + cls.ljust(27)[:27] + status + " " * 9 + "E"
    )
    assert len(row) == 80
    return row


def _fresh(tmp_path, name="t.db"):
    path = tmp_path / name
    init_db(str(path))
    conn = connect(str(path))
    ensure_registry(conn)
    return conn


def _seed_list(conn, quarter, rows, *, registry=EMPTY, sha="s1", replace=False, mutations=None):
    parsed = parse_list13f_text("\n".join(rows) + "\n", quarter=quarter)
    mutations = mutations if mutations is not None else Mutations()
    conn.execute("BEGIN IMMEDIATE")
    report = bootstrap_13f_list(
        conn,
        parsed,
        quarter=quarter,
        registry=registry,
        source_meta={"source_url": "u", "sha256": sha, "retrieved_at": "t", "raw_path": "p"},
        replace_quarter=replace,
        mutations=mutations,
    )
    conn.execute("COMMIT")
    return report, mutations


def _full_snapshot(conn):
    """Every persisted column of the list intervals, the seed ledger and the
    securities they created — the before/after substrate a replay must not move."""
    return {
        "intervals": conn.execute(
            "SELECT security_id, id_type, value, valid_from, valid_to, quarter,"
            " issuer_name, security_class, is_option, status_flag, provenance,"
            " confidence, review_state, license_id, source_url, list_sha256,"
            " retrieved_at, raw_path, row_ordinal, parser_version,"
            " normalization_version, raw FROM security_list_intervals"
            " ORDER BY value, valid_from"
        ).fetchall(),
        "ledger": conn.execute(
            "SELECT quarter, provenance, list_sha256, source_url, retrieved_at,"
            " raw_path, records_seeded, parser_version, normalization_version"
            " FROM security_list_seed_ledger ORDER BY quarter, provenance"
        ).fetchall(),
        "securities": conn.execute(
            "SELECT security_id, id_state, class, entity_id, entity_candidates,"
            " entity_link_state, review_state FROM securities ORDER BY security_id"
        ).fetchall(),
    }


def _seed_ftd(conn, value, dates, *, registry=EMPTY):
    obs = [
        FtdObservation(settlement_date=d, id_type="cusip", value=value, symbol=None,
                       issuer_name="FTD NAME")
        for d in dates
    ]
    conn.execute("BEGIN IMMEDIATE")
    bootstrap_ftd(conn, obs, registry=registry, mutations=Mutations())
    conn.execute("COMMIT")


# --- quarter-exact validity + contiguity (R7, G14) ----------------------------


def test_quarter_interval_is_exactly_the_quarter(tmp_path):
    conn = _fresh(tmp_path)
    _seed_list(conn, "2026q1", [_line(APPLE, "APPLE INC", "COM")])
    # Resolves for the whole quarter, closed at the quarter start, open at the
    # next quarter start (half-open [start, next_start)).
    assert resolve_cusip(conn, APPLE, "2026-01-01") is not None
    assert resolve_cusip(conn, APPLE, "2026-03-31") is not None
    assert resolve_cusip(conn, APPLE, "2025-12-31") is None       # before
    assert resolve_cusip(conn, APPLE, "2026-04-01") is None       # next-quarter start
    assert registry_overlap_errors(conn) == []


def test_consecutive_quarters_resolve_contiguously(tmp_path):
    conn = _fresh(tmp_path)
    _seed_list(conn, "2026q1", [_line(APPLE, "APPLE INC", "COM")])
    _seed_list(conn, "2026q2", [_line(APPLE, "APPLE INC", "COM")], sha="s2")
    sid_q1 = resolve_cusip(conn, APPLE, "2026-03-31")
    sid_q2_boundary = resolve_cusip(conn, APPLE, "2026-04-01")
    sid_q2 = resolve_cusip(conn, APPLE, "2026-06-30")
    assert sid_q1 == sid_q2_boundary == sid_q2  # empty authority ⇒ one provisional id
    assert resolve_cusip(conn, APPLE, "2026-07-01") is None
    assert registry_overlap_errors(conn) == []


def test_deleted_and_conflict_rows_seed_nothing(tmp_path):
    # Two seed-nothing shapes, both driven through the REAL parser + seeder (F16):
    #  * a DELETED-only CUSIP (MSFT) — ceased to be 13(f); and
    #  * an A/D status-CONFLICT CUSIP (AMZN carrying both *A* and *D*) — a genuine
    #    conflict substrate, which the earlier version of this test omitted.
    # Neither leaves a security_list_intervals row and neither resolves. Mutation
    # guard: a seeder that consulted a conflicted CUSIP's rows would seed AMZN.
    AMZN = "023135106"
    conn = _fresh(tmp_path)
    _seed_list(
        conn,
        "2026q1",
        [
            _line(APPLE, "APPLE INC", "COM"),                     # seeds
            _line(MSFT, "MICROSOFT CORP", "COM", status="*D*"),   # DELETED-only → no seed
            _line(AMZN, "AMAZON COM INC", "COM", status="*A*"),   # conflict leg A
            _line(AMZN, "AMAZON COM INC", "COM", status="*D*"),   # conflict leg D
        ],
    )
    assert resolve_cusip(conn, APPLE, "2026-03-31") is not None
    assert resolve_cusip(conn, MSFT, "2026-03-31") is None
    assert resolve_cusip(conn, AMZN, "2026-03-31") is None
    # No interval row persisted for either the DELETED-only or the conflicted CUSIP.
    remaining = {
        v for (v,) in conn.execute(
            "SELECT DISTINCT value FROM security_list_intervals"
        )
    }
    assert remaining == {APPLE}


# --- authority-window intersection matrix (Locked Decision 6) ------------------

SPLIT = parse_identity_registry(
    """
classes:
  - security_id: sec:before
    class: equity
    identifiers: [{id_type: cusip, value: "037833100", to: "2026-02-15"}]
    note: "apple before the mid-quarter reassignment"
    review_state: reviewed
  - security_id: sec:after
    class: equity
    identifiers: [{id_type: cusip, value: "037833100", from: "2026-02-15"}]
    note: "apple after the mid-quarter reassignment"
    review_state: reviewed
continuities: []
"""
)


def test_mid_quarter_boundary_splits_and_never_backfills(tmp_path):
    conn = _fresh(tmp_path)
    _seed_list(conn, "2026q1", [_line(APPLE, "APPLE INC", "COM")], registry=SPLIT)
    # The quarter [2026-01-01, 2026-04-01) is cut at the 2026-02-15 boundary; each
    # sub-interval resolves to ITS owner — the quarter-end owner is never
    # back-filled across the reassignment (G14).
    assert resolve_cusip(conn, APPLE, "2026-01-01") == "sec:before"
    assert resolve_cusip(conn, APPLE, "2026-02-14") == "sec:before"  # boundary-1
    assert resolve_cusip(conn, APPLE, "2026-02-15") == "sec:after"   # boundary (from inclusive)
    assert resolve_cusip(conn, APPLE, "2026-03-31") == "sec:after"
    assert registry_overlap_errors(conn) == []


def test_year_boundary_quarters_are_contiguous(tmp_path):
    conn = _fresh(tmp_path)
    _seed_list(conn, "2025q4", [_line(APPLE, "APPLE INC", "COM")])
    _seed_list(conn, "2026q1", [_line(APPLE, "APPLE INC", "COM")], sha="s2")
    assert resolve_cusip(conn, APPLE, "2025-12-31") is not None
    assert resolve_cusip(conn, APPLE, "2026-01-01") is not None  # Q4→Q1 across the year
    assert registry_overlap_errors(conn) == []


def test_leap_year_february_29_is_covered(tmp_path):
    conn = _fresh(tmp_path)
    _seed_list(conn, "2024q1", [_line(APPLE, "APPLE INC", "COM")])
    assert resolve_cusip(conn, APPLE, "2024-02-29") is not None


# --- replay policy (Locked Decision 11) ---------------------------------------


def test_same_sha_reseed_is_replay_zero(tmp_path):
    from dataclasses import asdict

    conn = _fresh(tmp_path)
    _seed_list(conn, "2026q1", [_line(APPLE, "APPLE INC", "COM")], sha="same")
    before = _full_snapshot(conn)
    _report, mutations = _seed_list(
        conn, "2026q1", [_line(APPLE, "APPLE INC", "COM")], sha="same"
    )
    # EVERY write counter is zero on an identical replay — not just a hand-picked
    # three (F15). A broken ON CONFLICT idempotency guard, or a new uncounted
    # metadata write (e.g. the ledger), would surface here.
    assert all(value == 0 for value in asdict(mutations).values()), asdict(mutations)
    # And the full persisted state — every interval column, the ledger and the
    # securities — is byte-identical before and after.
    assert _full_snapshot(conn) == before


def test_different_sha_reseed_is_a_hard_error_naming_both_hashes(tmp_path):
    conn = _fresh(tmp_path)
    _seed_list(conn, "2026q1", [_line(APPLE, "APPLE INC", "COM")], sha="original")
    with pytest.raises(List13fReseedError) as excinfo:
        _seed_list(conn, "2026q1", [_line(APPLE, "APPLE INC", "COM")], sha="corrected")
    message = str(excinfo.value)
    assert "original" in message and "corrected" in message


def test_replace_quarter_supersedes_the_whole_quarter(tmp_path):
    # Replacement supersedes the ENTIRE prior quarter (F14): a CUSIP DROPPED from
    # the corrected list must DISAPPEAR, not linger. The corrected list excludes
    # Apple (the old CUSIP) entirely and seeds MSFT instead. Mutation guard:
    # retagging the old rows with the new sha and merely inserting the new rows —
    # without deleting the removed CUSIP — would leave Apple resolvable here.
    conn = _fresh(tmp_path)
    _seed_list(conn, "2026q1", [_line(APPLE, "APPLE INC", "COM")], sha="v1")
    assert resolve_cusip(conn, APPLE, "2026-03-31") is not None
    _report, mutations = _seed_list(
        conn,
        "2026q1",
        [_line(MSFT, "MICROSOFT CORP", "COM")],  # Apple is GONE from the corrected list
        sha="v2",
        replace=True,
    )
    assert mutations.list_intervals_removed == 1   # Apple's interval removed
    assert mutations.list_intervals_inserted == 1  # MSFT seeded
    # Only the corrected list's rows remain, all under the new sha.
    shas = {s for (s,) in conn.execute("SELECT DISTINCT list_sha256 FROM security_list_intervals")}
    assert shas == {"v2"}
    assert resolve_cusip(conn, APPLE, "2026-03-31") is None       # DROPPED — gone
    assert resolve_cusip(conn, MSFT, "2026-03-31") is not None
    # The seed ledger reflects the corrected source only.
    assert conn.execute(
        "SELECT list_sha256 FROM security_list_seed_ledger WHERE quarter = '2026q1'"
    ).fetchone()[0] == "v2"


def test_zero_record_quarter_reseed_with_a_different_sha_hard_errors(tmp_path):
    # F6: a DELETED-only list seeds ZERO interval rows, but the quarter is still
    # recorded in the seed ledger — so a different-sha reseed of that quarter is
    # the mandated hard error, not a silent second seed. Mutation guard: driving
    # the replay check off security_list_intervals (empty here) would let both
    # seeds succeed.
    conn = _fresh(tmp_path)
    report, _ = _seed_list(
        conn, "2026q1", [_line(MSFT, "MICROSOFT CORP", "COM", status="*D*")], sha="old"
    )
    assert report.records_seeded == 0
    assert report.intervals_present == 0
    # The quarter IS in the ledger despite zero interval rows — that is what makes
    # the reseed check see it.
    assert conn.execute(
        "SELECT list_sha256, records_seeded FROM security_list_seed_ledger"
        " WHERE quarter = '2026q1'"
    ).fetchone() == ("old", 0)
    with pytest.raises(List13fReseedError) as excinfo:
        _seed_list(
            conn, "2026q1", [_line(MSFT, "MICROSOFT CORP", "COM", status="*D*")], sha="new"
        )
    assert "old" in str(excinfo.value) and "new" in str(excinfo.value)


# --- cross-source precedence + order independence (R7) ------------------------


@pytest.mark.parametrize("ftd_first", [True, False])
def test_ftd_and_list_share_one_security_id_order_independent(tmp_path, ftd_first):
    conn = _fresh(tmp_path)
    if ftd_first:
        _seed_ftd(conn, APPLE, ["2025-01-15"])
        _seed_list(conn, "2026q1", [_line(APPLE, "APPLE INC", "COM")])
    else:
        _seed_list(conn, "2026q1", [_line(APPLE, "APPLE INC", "COM")])
        _seed_ftd(conn, APPLE, ["2025-01-15"])
    # One security_id: the empty authority mints one provisional id for the CUSIP,
    # and BOTH sources bind to it.
    sid_ftd = resolve_cusip(conn, APPLE, "2025-01-15")     # FTD-covered date
    sid_list = resolve_cusip(conn, APPLE, "2026-03-31")    # list-covered date
    assert sid_ftd is not None and sid_ftd == sid_list
    # The FTD-only date resolves via FTD and is NOT re-tagged as list-sourced.
    provenances = {
        p for (p,) in conn.execute(
            "SELECT DISTINCT provenance FROM security_identifiers WHERE value = ?", (APPLE,)
        )
    }
    assert provenances == {"sec-ftd"}


def test_a_period_with_no_seeded_list_resolves_via_ftd_or_none(tmp_path):
    conn = _fresh(tmp_path)
    _seed_ftd(conn, APPLE, ["2025-01-15"])
    # An FTD date with no list coverage resolves via FTD.
    assert resolve_cusip(conn, APPLE, "2025-01-15") is not None
    # A date covered by neither source resolves nowhere (fail-closed).
    assert resolve_cusip(conn, APPLE, "2026-03-31") is None


# --- fail-closed precedence: the definitional layer decides (F12) -------------

DISPUTED = parse_identity_registry(
    """
classes:
  - security_id: sec:disputed-apple
    class: equity
    identifiers: [{id_type: cusip, value: "037833100"}]
    note: "apple flagged disputed by reviewed commit"
    review_state: disputed
continuities: []
"""
)


def test_a_disputed_covering_list_row_resolves_to_none_never_ftd(tmp_path):
    conn = _fresh(tmp_path)
    # FTD covers the quarter-end date too — but the definitional layer covers it
    # and is disputed, so it decides: None, WITHOUT falling through to FTD (F12).
    _seed_ftd(conn, APPLE, ["2026-03-31"], registry=DISPUTED)
    _seed_list(conn, "2026q1", [_line(APPLE, "APPLE INC", "COM")], registry=DISPUTED)
    assert resolve_cusip(conn, APPLE, "2026-03-31") is None


def test_ambiguous_covering_list_rows_resolve_to_none_never_ftd(tmp_path):
    conn = _fresh(tmp_path)
    _seed_ftd(conn, APPLE, ["2026-05-01"])
    # Directly insert TWO overlapping definitional rows covering 2026-05-01 (an
    # ambiguity the seeder cannot produce, but the resolver must fail closed on).
    conn.executescript(
        f"""
        INSERT INTO securities (security_id, id_state, class, review_state)
          VALUES ('sec:a','provisional',NULL,'auto') ON CONFLICT DO NOTHING;
        INSERT INTO securities (security_id, id_state, class, review_state)
          VALUES ('sec:b','provisional',NULL,'auto') ON CONFLICT DO NOTHING;
        INSERT INTO security_list_intervals
          (security_id,id_type,value,valid_from,valid_to,quarter,is_option,status_flag,
           provenance,confidence,review_state,license_id,source_url,list_sha256,
           parser_version,normalization_version)
          VALUES ('sec:a','cusip','{APPLE}','2026-01-01','2026-07-01','2026q1',0,'',
                  'sec-13f-list','high','auto','sec-13f-list','u','x','p','n');
        INSERT INTO security_list_intervals
          (security_id,id_type,value,valid_from,valid_to,quarter,is_option,status_flag,
           provenance,confidence,review_state,license_id,source_url,list_sha256,
           parser_version,normalization_version)
          VALUES ('sec:b','cusip','{APPLE}','2026-04-01','2026-10-01','2026q2',0,'',
                  'sec-13f-list','high','auto','sec-13f-list','u','y','p','n');
        """
    )
    conn.commit()
    # Both rows cover 2026-05-01 → ambiguous → None, and NEVER the FTD row.
    assert resolve_cusip(conn, APPLE, "2026-05-01") is None
    # A date only ONE list row covers still resolves (the ambiguity is local).
    assert resolve_cusip(conn, APPLE, "2026-02-01") == "sec:a"


# --- §5.1 source-row provenance on the fact row (round-1 F9) ------------------


def test_seeded_row_persists_the_verbatim_source_line(tmp_path):
    # F9: the fact row must carry the ORIGINAL source line — both in its own
    # `source_row` column and inside the deterministic `raw` JSON — so a published
    # or migrated identity is auditable against its exact source row without the
    # gitignored cache. Mutation guard: reverting `raw` to synthesized
    # identity/interval metadata (the pre-fix shape) leaves both assertions failing.
    import json as _json

    conn = _fresh(tmp_path)
    line = _line(APPLE, "APPLE INC", "COM")
    _seed_list(conn, "2026q1", [line])
    source_row, raw = conn.execute(
        "SELECT source_row, raw FROM security_list_intervals WHERE value = ?", (APPLE,)
    ).fetchone()
    assert source_row == line               # byte-for-byte the 80-char source line
    assert _json.loads(raw)["source_row"] == line
    # And it is the SOURCE, not a re-rendering: the exact fixed-width padding is
    # present, which a field-by-field reconstruction would not reproduce.
    assert len(source_row) == 80
    assert source_row.startswith(APPLE)


def test_source_row_survives_an_authority_revision_recut(tmp_path):
    # F9 + Locked Decision 6: when a later securities.yaml revision cuts a seeded
    # quarter at a mid-quarter ownership boundary, EVERY resulting piece must keep
    # the origin line — an audit trail that survives migration is the whole point.
    # `raw` is recomputed per piece (it encodes the piece's interval) but stays a
    # pure function of the source row, so it remains deterministic.
    import json as _json

    conn = _fresh(tmp_path)
    line = _line(APPLE, "APPLE INC", "COM")
    _seed_list(conn, "2026q1", [line])          # empty authority ⇒ one row
    reconcile_only(conn, SPLIT)                  # revise ⇒ cut at 2026-02-15
    rows = conn.execute(
        "SELECT security_id, valid_from, source_row, raw FROM security_list_intervals"
        " WHERE value = ? ORDER BY valid_from", (APPLE,)
    ).fetchall()
    assert len(rows) == 2, "the revision must cut the quarter into two pieces"
    assert [r[0] for r in rows] == ["sec:before", "sec:after"]
    for _sid, _from, source_row, raw in rows:
        assert source_row == line                       # carried verbatim
        assert _json.loads(raw)["source_row"] == line   # and into the raw JSON
    assert registry_overlap_errors(conn) == []


def test_recut_raw_is_deterministic_across_seed_then_revise_orders(tmp_path):
    # The determinism half of F9: seed-then-revise and revise-then-seed must end
    # byte-identical INCLUDING source_row and raw, so adding the source line did
    # not make the migration path order-dependent.
    seed_then_revise = _fresh(tmp_path, "a.db")
    _seed_list(seed_then_revise, "2026q1", [_line(APPLE, "APPLE INC", "COM")])
    reconcile_only(seed_then_revise, SPLIT)

    revise_then_seed = _fresh(tmp_path, "b.db")
    reconcile_only(revise_then_seed, SPLIT)
    _seed_list(revise_then_seed, "2026q1", [_line(APPLE, "APPLE INC", "COM")],
               registry=SPLIT)

    query = (
        "SELECT security_id, value, valid_from, valid_to, source_row, raw"
        " FROM security_list_intervals ORDER BY value, valid_from"
    )
    assert seed_then_revise.execute(query).fetchall() == (
        revise_then_seed.execute(query).fetchall()
    )


# --- set-based seeding (round-1 F10) ------------------------------------------


class _CountingConn:
    """Delegating connection proxy that counts statement calls.

    Counts CALLS (round trips issued from Python), not parameter sets: sqlite3's
    trace callback fires once per parameter set, so it cannot tell an
    ``executemany`` from a per-row loop — the very distinction F10 is about.
    """

    def __init__(self, conn):
        self._conn = conn
        self.execute_calls = 0
        self.executemany_calls = 0

    def execute(self, *args, **kwargs):
        self.execute_calls += 1
        return self._conn.execute(*args, **kwargs)

    def executemany(self, *args, **kwargs):
        self.executemany_calls += 1
        return self._conn.executemany(*args, **kwargs)

    def __getattr__(self, name):  # in_transaction, total_changes, cursor, …
        return getattr(self._conn, name)


def _valid_cusips(count):
    """`count` distinct, check-digit-valid CUSIPs."""
    from populus.parse.list13f import cusip_check_digit_ok

    out, base = [], 0
    while len(out) < count:
        stem = f"{base:08d}"
        for check in "0123456789":
            if cusip_check_digit_ok(stem + check):
                out.append(stem + check)
                break
        base += 1
    return out


def test_seeding_is_set_based_not_per_row(tmp_path):
    # F10: the seeder must not issue per-record SQL. Statement CALLS are measured
    # for a 5-record and a 60-record quarter: with batching the two counts are
    # EQUAL — the extra rows become executemany parameter sets, not extra calls.
    # With the pre-fix per-record loop (one ensure_security + one
    # upsert_list_interval each) the 60-row quarter issued ~110 more calls than
    # the 5-row one. Mutation guard: restoring that loop makes the counts diverge
    # and this assertion fails with both numbers in the message.
    def rows_for(count):
        return [
            _line(cusip, f"ISSUER {index}", "COM")
            for index, cusip in enumerate(_valid_cusips(count))
        ]

    small = _CountingConn(_fresh(tmp_path, "small.db"))
    _seed_list(small, "2026q1", rows_for(5))
    large = _CountingConn(_fresh(tmp_path, "large.db"))
    _seed_list(large, "2026q1", rows_for(60))

    assert (large.execute_calls, large.executemany_calls) == (
        small.execute_calls,
        small.executemany_calls,
    ), (
        "statement calls grew with row count — the seeder is issuing per-row SQL"
        f" ({small.execute_calls} execute + {small.executemany_calls} executemany"
        f" for 5 rows vs {large.execute_calls} + {large.executemany_calls} for 60)"
    )
    # The batches are the two set-based writes (securities, then intervals) — the
    # per-row path used zero executemany, so this pins the mechanism, not just the
    # count.
    assert large.executemany_calls == 2
    # And the 60-record quarter really did seed all 60 intervals.
    assert large.execute(
        "SELECT COUNT(*) FROM security_list_intervals"
    ).fetchone()[0] == 60


def test_batched_seeding_preserves_replay_zero_and_counts(tmp_path):
    # F10 must not weaken the accounting it replaced: a first seed counts every
    # insert, an identical replay counts zero, and the row content is unchanged.
    conn = _fresh(tmp_path)
    rows = [_line(APPLE, "APPLE INC", "COM"), _line(MSFT, "MICROSOFT CORP", "COM")]
    _report, first = _seed_list(conn, "2026q1", rows, sha="same")
    assert first.list_intervals_inserted == 2
    assert first.securities_created == 2
    _report2, replay = _seed_list(conn, "2026q1", rows, sha="same")
    assert replay.list_intervals_inserted == 0
    assert replay.securities_created == 0
    assert conn.execute("SELECT COUNT(*) FROM security_list_intervals").fetchone()[0] == 2


# --- resolve_security_name: the definitional list is the sole name source ------


def test_resolve_security_name_returns_the_covering_quarter_name_or_none(tmp_path):
    conn = _fresh(tmp_path)
    _seed_list(conn, "2026q1", [_line(APPLE, "APPLE INC", "COM")])
    sid = resolve_cusip(conn, APPLE, "2026-03-31")
    assert resolve_security_name(conn, sid, "2026-03-31") == "APPLE INC"
    # Outside the covered quarter there is no persisted name — never fabricated.
    assert resolve_security_name(conn, sid, "2026-04-01") is None
    assert resolve_security_name(conn, "sec:nonexistent", "2026-03-31") is None
