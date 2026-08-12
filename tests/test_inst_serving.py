"""RUN M2-8 T7 (plan R5/R6/R7) — the serving projection's structural invariants.

Each test pins a property an external review round established, and names it, so a
future edit that breaks one fails with the reason attached rather than a bare diff.
"""

from __future__ import annotations

import sqlite3

import pytest

from populus.inst_serving import (
    affiliate_groups,
    authoritative_full_periods,
    build_filing_dictionary,
    build_serving_projection,
)

from test_filer_reported_views import (  # established cross-fixture reuse
    APPLE,
    MSFT,
    _filer_fn,
    _fresh,
    _hold,
    _load_fn,
    _security,
    _seed_affiliate_pair,
)


# --- R5: provenance is compressed, never dropped -----------------------------


def test_every_row_resolves_to_its_filing_through_the_dictionary(tmp_path):
    """Review r2 F7: the projection drops per-row provenance STRINGS, but every row
    must still bind to the filing that reported it. Mutation guard: returning None
    for filing_key flips this."""
    conn = _fresh(tmp_path, "t7a.db")
    _seed_affiliate_pair(conn)
    conn.commit()

    proj = build_serving_projection(conn, periods=("2026-03-31",))
    assert proj.filings, "filing dictionary is empty"
    assert proj.filer_rows
    for row in proj.filer_rows:
        assert row["filing_key"] is not None, "holding row cannot name its filing"
    keys = {ref.filing_key for ref in proj.filings.values()}
    assert all(r["filing_key"] in keys for r in proj.filer_rows)

    # ONE dictionary entry per filing — not one per row (that is the whole point).
    assert len(proj.filings) <= len(proj.filer_rows)
    ref = next(iter(proj.filings.values()))
    for wanted in ("accession", "submission_type", "period_of_report", "filed_date"):
        assert wanted in ref.as_dict()


def test_projection_uses_one_reported_holdings_pass_and_no_default_holdings_scan(
    tmp_path,
):
    """The full serving projection must not re-enter either holdings view."""
    conn = _fresh(tmp_path, "single-pass.db")
    _seed_affiliate_pair(conn)
    conn.commit()
    statements: list[str] = []
    conn.set_trace_callback(statements.append)
    try:
        projection = build_serving_projection(conn, periods=("2026-03-31",))
    finally:
        conn.set_trace_callback(None)

    assert projection.filer_rows and projection.issuer_holder_rows
    normalized = [" ".join(statement.lower().split()) for statement in statements]
    reported_reads = [
        statement
        for statement in normalized
        if " from v_filer_reported_holdings h" in statement
    ]
    assert len(reported_reads) == 1, reported_reads
    assert " left join securities s " in reported_reads[0]
    assert " left join v_default_inst_filings d " in reported_reads[0]
    assert not any(" from v_default_holdings" in statement for statement in normalized)


def test_combined_holding_pass_matches_independent_legacy_queries(tmp_path):
    """The one-pass refactor preserves the complete two holding-derived grains."""
    from collections import defaultdict

    from populus.inst_agg import _issuer_key, _position_key, _put_call_bucket, _unit_key

    conn = _fresh(tmp_path, "combined-parity.db")
    _seed_affiliate_pair(conn)
    second_class = "037833200"
    sid_a = _security(conn, "sec:combined-a")
    sid_b = _security(conn, "sec:combined-b")
    _filer_fn(conn, "0000000099", "028-00099", "Dense Filer")
    _load_fn(
        conn,
        fid="inst:DENSE",
        cik="0000000099",
        period="2026-03-31",
        filed="2026-04-15",
        file_number_norm="028-00099",
        holds=[
            _hold(
                ordinal=1,
                issuer="DENSE ISSUER",
                cusip=APPLE,
                value=125,
                shares=10,
                unit="SH",
                security_id=sid_a,
            ),
            _hold(
                ordinal=2,
                issuer="DENSE ISSUER",
                cusip=second_class,
                value=None,
                shares=None,
                unit="PRN",
                put_call="PUT",
                security_id=sid_b,
            ),
        ],
    )
    conn.commit()
    periods = ("2026-03-31",)
    projection = build_serving_projection(conn, periods=periods)
    filings = build_filing_dictionary(conn)
    names = dict(conn.execute("SELECT cik,name_raw FROM inst_filers ORDER BY cik"))

    expected_filer_rows = []
    for row in conn.execute(
        "SELECT h.cik,h.period_of_report,h.filing_id,h.security_id,h.cusip,"
        " h.issuer_name_raw,h.title_of_class,h.value_usd,h.ssh_prnamt,"
        " h.ssh_prnamt_type,h.put_call,h.flags"
        " FROM v_filer_reported_holdings h WHERE h.period_of_report=?"
        " ORDER BY h.cik,h.period_of_report,h.holding_id",
        periods,
    ):
        (
            cik,
            period,
            filing_id,
            security_id,
            cusip,
            issuer_name,
            title_of_class,
            value_usd,
            shares,
            share_type,
            put_call,
            flags,
        ) = row
        ref = filings.get(filing_id)
        expected_filer_rows.append(
            {
                "cik": cik,
                "period": period,
                "filing_key": ref.filing_key if ref else None,
                "security_id": security_id,
                "cusip": cusip,
                "issuer_name": issuer_name,
                "title_of_class": title_of_class,
                "value_usd": value_usd,
                "shares": shares,
                "ssh_type": share_type,
                "put_call": put_call,
                "position_key": _position_key(security_id, cusip),
                "put_call_bucket": _put_call_bucket(put_call),
                "unit_key": _unit_key(share_type),
                "flags": flags,
            }
        )

    reported: dict[tuple, dict] = {}
    for row in conn.execute(
        "SELECT h.cik,h.period_of_report,h.security_id,h.cusip,h.issuer_name_raw,"
        " h.value_usd,s.entity_id,s.entity_link_state,h.filing_id"
        " FROM v_filer_reported_holdings h"
        " LEFT JOIN securities s ON s.security_id=h.security_id"
        " WHERE h.period_of_report=?"
        " ORDER BY h.cik,h.period_of_report,h.holding_id",
        periods,
    ):
        cik, period, security_id, cusip, issuer_name, value, entity_id, state, fid = row
        issuer_key, source = _issuer_key(entity_id, state, cusip, issuer_name)
        bucket = reported.setdefault(
            (issuer_key, period, cik),
            {
                "issuer_key_source": source,
                "issuer_name": issuer_name,
                "value_usd": 0,
                "undisclosed": False,
                "securities": set(),
                "filing_keys": set(),
            },
        )
        if value is None:
            bucket["undisclosed"] = True
        else:
            bucket["value_usd"] += value
        if security_id is not None or cusip is not None:
            bucket["securities"].add(security_id or f"cusip:{cusip}")
        if fid in filings:
            bucket["filing_keys"].add(filings[fid].filing_key)
        if issuer_name is not None and (
            bucket["issuer_name"] is None or issuer_name < bucket["issuer_name"]
        ):
            bucket["issuer_name"] = issuer_name

    dedup_total: dict[tuple[str, str], int] = defaultdict(int)
    dedup_undisclosed: set[tuple[str, str]] = set()
    for period, entity_id, state, cusip, issuer_name, value in conn.execute(
        "SELECT h.period_of_report,s.entity_id,s.entity_link_state,h.cusip,"
        " h.issuer_name_raw,h.value_usd FROM v_default_holdings h"
        " LEFT JOIN securities s ON s.security_id=h.security_id"
        " WHERE h.period_of_report=? ORDER BY h.holding_id",
        periods,
    ):
        issuer_key, _source = _issuer_key(entity_id, state, cusip, issuer_name)
        total_key = (issuer_key, period)
        if value is None:
            dedup_undisclosed.add(total_key)
        else:
            dedup_total[total_key] += value

    groups = {period: affiliate_groups(conn, period) for period in periods}
    expected_issuer_rows = []
    for issuer_key, period, cik in sorted(reported):
        bucket = reported[(issuer_key, period, cik)]
        total_key = (issuer_key, period)
        expected_issuer_rows.append(
            {
                "issuer_key": issuer_key,
                "issuer_key_source": bucket["issuer_key_source"],
                "issuer_name": bucket["issuer_name"],
                "period": period,
                "filer_key": cik,
                "filer_name": names.get(cik, cik),
                "affiliate_group_key": groups[period].get(cik, cik),
                "value_usd": None if bucket["undisclosed"] else bucket["value_usd"],
                "value_undisclosed_component": bucket["undisclosed"],
                "security_count": len(bucket["securities"]),
                "filing_keys": sorted(bucket["filing_keys"]),
                "issuer_dedup_total_usd": (
                    None
                    if total_key in dedup_undisclosed
                    else dedup_total.get(total_key, 0)
                ),
            }
        )

    assert projection.filer_rows == expected_filer_rows
    assert projection.issuer_holder_rows == expected_issuer_rows


def test_filing_keys_do_not_depend_on_insertion_order(tmp_path):
    """Two builds of one corpus must produce byte-identical shards, so the key
    assignment cannot depend on insertion order.

    Calling the function twice on ONE connection proves nothing — it asserts an
    end state (two identical calls agree), and changing `ORDER BY filing_id` to
    `ORDER BY rowid` leaves that green. The property is that two corpora holding
    the SAME filings loaded in DIFFERENT orders assign the same keys, which is
    what a rowid ordering breaks.
    """
    sequences = (("A", "B", "C"), ("C", "A", "B"))
    assignments = []
    for index, order in enumerate(sequences):
        conn = _fresh(tmp_path, f"t7b{index}.db")
        sid = _security(conn, f"sec:{APPLE}")
        _filer_fn(conn, "0000000061", "028-00061", "Order Co")
        for fid in order:
            _load_fn(
                conn, fid=f"inst:{fid}", cik="0000000061", period="2026-03-31",
                filed="2026-04-15", file_number_norm="028-00061",
                holds=[_hold(ordinal=1, issuer="APPLE INC", cusip=APPLE, value=1,
                             security_id=sid)],
            )
        conn.commit()
        assignments.append(
            {k: v.filing_key for k, v in build_filing_dictionary(conn).items()})

    assert assignments[0] == assignments[1], (
        "filing keys depend on load order — two builds of one corpus would"
        f" produce different shards: {assignments}")


# --- R6: directional schemas -------------------------------------------------


def test_issuer_rows_always_carry_a_filer_key(tmp_path):
    """Review r2 F8: `cik` is implied inside a filer bucket but NEVER inside an
    issuer bucket, which holds many filers. A row without it cannot say who holds
    what, making the all-holders surface impossible."""
    conn = _fresh(tmp_path, "t7c.db")
    _seed_affiliate_pair(conn)
    conn.commit()
    proj = build_serving_projection(conn, periods=("2026-03-31",))
    assert proj.issuer_holder_rows
    for row in proj.issuer_holder_rows:
        assert row["filer_key"], "issuer-holder row without filer_key"
        assert row["filer_name"], "filer_key does not resolve to a name"


def test_issuer_grain_is_one_row_per_issuer_period_filer(tmp_path):
    """Review r3 F6: issuer rows are FILER-grained, not holding-grained. A filer
    holding two share classes of one issuer is ONE row with security_count 2."""
    conn = _fresh(tmp_path, "t7d.db")
    # Same ISSUER, two share classes: identical CUSIP-6 block (037833), different
    # check digits. _issuer_key falls back to cusip6 when the entity is unresolved,
    # so this — not a shared name string — is what makes them one issuer.
    APPLE_B = "037833200"
    sid_a = _security(conn, f"sec:{APPLE}")
    sid_b = _security(conn, f"sec:{APPLE_B}")
    _filer_fn(conn, "0000000009", "028-00009", "Two Classes")
    # same issuer NAME on both rows -> one issuer_key -> must collapse to one row
    _load_fn(
        conn, fid="inst:TWOCLASS", cik="0000000009", period="2026-03-31",
        filed="2026-04-15", file_number_norm="028-00009",
        holds=[
            _hold(ordinal=1, issuer="SAME ISSUER", cusip=APPLE, value=100,
                  security_id=sid_a),
            _hold(ordinal=2, issuer="SAME ISSUER", cusip=APPLE_B, value=200,
                  security_id=sid_b),
        ],
    )
    conn.commit()
    proj = build_serving_projection(conn, periods=("2026-03-31",))
    rows = [r for r in proj.issuer_holder_rows if r["filer_key"] == "0000000009"]
    assert len(rows) == 1, f"expected one issuer-holder row, got {len(rows)}"
    assert rows[0]["value_usd"] == 300, "value must sum across the filer's classes"
    assert rows[0]["security_count"] == 2


def test_membership_and_dedup_total_are_distinct_fields_never_summed(tmp_path):
    """Review r4 F4: holder MEMBERSHIP comes from the non-suppressed view so every
    reporter renders; the issuer's DEDUPLICATED total comes from the suppressed one
    so the relationship counts once. Storing one number would force a choice between
    dropping a reporter and double-counting."""
    conn = _fresh(tmp_path, "t7e.db")
    _seed_affiliate_pair(conn)
    conn.commit()
    proj = build_serving_projection(conn, periods=("2026-03-31",))

    per_filer = {r["filer_key"]: r["value_usd"] for r in proj.issuer_holder_rows}
    assert per_filer == {"0000000001": 700, "0000000002": 300}, "a reporter was lost"

    dedup = {r["issuer_dedup_total_usd"] for r in proj.issuer_holder_rows}
    assert dedup == {700}, "dedup total must count the affiliate relationship once"
    assert sum(per_filer.values()) == 1000
    assert sum(per_filer.values()) != next(iter(dedup)), (
        "per-filer sum and dedup total must differ here — if they are equal the two "
        "fields have been conflated"
    )


def test_undisclosed_component_yields_null_not_a_partial_sum(tmp_path):
    """NULL-honest: a partial sum presented as a total understates the holding while
    looking complete. Mutation guard: summing only the disclosed values flips this."""
    conn = _fresh(tmp_path, "t7f.db")
    APPLE_B = "037833200"   # same issuer block, second share class
    sid_a = _security(conn, f"sec:{APPLE}")
    sid_b = _security(conn, f"sec:{APPLE_B}")
    _filer_fn(conn, "0000000011", "028-00011", "Partial")
    _load_fn(
        conn, fid="inst:PARTIAL", cik="0000000011", period="2026-03-31",
        filed="2026-04-15", file_number_norm="028-00011", total=100,
        holds=[
            _hold(ordinal=1, issuer="PARTIAL CO", cusip=APPLE, value=100,
                  security_id=sid_a),
            _hold(ordinal=2, issuer="PARTIAL CO", cusip=APPLE_B, value=None,
                  security_id=sid_b),
        ],
    )
    conn.commit()
    proj = build_serving_projection(conn, periods=("2026-03-31",))
    rows = [r for r in proj.issuer_holder_rows if r["filer_key"] == "0000000011"]
    assert len(rows) == 1
    assert rows[0]["value_usd"] is None, "partial sum leaked as a total"
    assert rows[0]["value_undisclosed_component"] is True


# --- R7: grain separation ----------------------------------------------------


def test_holding_rows_never_carry_change_fields(tmp_path):
    """Review r2 F9: a position composed from several reported rows would either
    duplicate its delta across them or force a grouping that absorbs rows. Holding
    rows carry a position_key REFERENCE to agg_qoq_deltas instead."""
    conn = _fresh(tmp_path, "t7g.db")
    _seed_affiliate_pair(conn)
    conn.commit()
    proj = build_serving_projection(conn, periods=("2026-03-31",))
    for row in proj.filer_rows:
        for banned in ("change_kind", "delta_value_usd", "prev_value_usd", "delta_shares"):
            assert banned not in row, f"change field {banned} rode on a holding row"
        assert "position_key" in row, "reference to agg_qoq_deltas is missing"


# --- R6: affiliate grouping (review r5 F3, r6 F3) ----------------------------


def test_affiliate_group_is_a_canonical_component_over_cik_nodes(tmp_path):
    """Nodes are CIKs, not filings: a CIK with several surviving filings must still
    belong to exactly one group. The key is the component's smallest cik."""
    conn = _fresh(tmp_path, "t7h.db")
    _seed_affiliate_pair(conn)
    conn.commit()
    groups = affiliate_groups(conn, "2026-03-31")
    assert groups["0000000001"] == groups["0000000002"], "coverer/covered not grouped"
    assert groups["0000000001"] == "0000000001", "key is not the smallest cik"


def test_unaffiliated_filer_is_its_own_group(tmp_path):
    conn = _fresh(tmp_path, "t7i.db")
    sid = _security(conn, f"sec:{APPLE}")
    _filer_fn(conn, "0000000020", "028-00020", "Alone")
    _load_fn(
        conn, fid="inst:ALONE", cik="0000000020", period="2026-03-31",
        filed="2026-04-15", file_number_norm="028-00020",
        holds=[_hold(ordinal=1, issuer="APPLE INC", cusip=APPLE, value=5,
                     security_id=sid)],
    )
    conn.commit()
    groups = affiliate_groups(conn, "2026-03-31")
    assert groups["0000000020"] == "0000000020"


def test_affiliate_groups_are_recomputed_per_period(tmp_path):
    """G4: a group asserted from another quarter would be identity time-travel."""
    conn = _fresh(tmp_path, "t7j.db")
    _seed_affiliate_pair(conn, period="2026-03-31")
    conn.commit()
    assert affiliate_groups(conn, "2026-03-31")
    assert affiliate_groups(conn, "2025-12-31") == {}, "group leaked across periods"


# --- R13: authoritative-full composition for exits (review r6 F4) ------------


def test_authoritative_full_requires_exactly_one_surviving_base(tmp_path):
    """An exit asserts ABSENCE. That is only defensible from a composition that
    would have contained the position. A clean base qualifies."""
    conn = _fresh(tmp_path, "t7k.db")
    _seed_affiliate_pair(conn)
    conn.commit()
    ok = authoritative_full_periods(conn)
    assert ("0000000001", "2026-03-31") in ok
    assert ("0000000002", "2026-03-31") in ok


def test_two_filers_covering_one_third_party_share_a_group(tmp_path):
    """The symmetric edge is load-bearing, and a pairwise fixture does NOT prove it.

    Shape: B(0000000101) and C(0000000102) each name A(0000000103) as an other
    manager. With directional edges only, traversal from B yields {B,A} keyed 101
    and traversal from C yields {C,A} keyed 102 — A is overwritten and **B and C
    land in different groups despite being one affiliate component**. The reverse
    edge makes A's neighbours reachable from either side, so all three key to 101.

    This was found by a SURVIVING mutation: deleting `adjacency[other].add(cik)`
    passed every earlier test, because each of those used a single covering pair.
    """
    conn = _fresh(tmp_path, "t7l.db")
    sid = _security(conn, f"sec:{APPLE}")
    for cik, fn, name in (
        ("0000000101", "028-00101", "Coverer B"),
        ("0000000102", "028-00102", "Coverer C"),
        ("0000000103", "028-00103", "Covered A"),
    ):
        _filer_fn(conn, cik, fn, name)
    # B and C both name A; A names nobody.
    _load_fn(conn, fid="inst:B", cik="0000000101", period="2026-03-31",
             filed="2026-04-15", file_number_norm="028-00101",
             other_managers=("028-00103",),
             holds=[_hold(ordinal=1, issuer="APPLE INC", cusip=APPLE, value=10,
                          security_id=sid)])
    _load_fn(conn, fid="inst:C", cik="0000000102", period="2026-03-31",
             filed="2026-04-15", file_number_norm="028-00102",
             other_managers=("028-00103",),
             holds=[_hold(ordinal=1, issuer="APPLE INC", cusip=APPLE, value=20,
                          security_id=sid)])
    _load_fn(conn, fid="inst:A", cik="0000000103", period="2026-03-31",
             filed="2026-04-15", file_number_norm="028-00103",
             holds=[_hold(ordinal=1, issuer="APPLE INC", cusip=APPLE, value=30,
                          security_id=sid)])
    conn.commit()

    groups = affiliate_groups(conn, "2026-03-31")
    assert groups["0000000101"] == groups["0000000102"] == groups["0000000103"], (
        f"one affiliate component split across groups: {groups}")
    assert groups["0000000101"] == "0000000101", "key is not the component minimum"


# --- T8: the emitted artifact, and the producer/consumer seam ----------------


def test_write_serving_db_emits_exactly_the_projected_tables(tmp_path):
    """The producer's table names ARE the contract: `digests.ARTIFACT_PROJECTIONS`
    digests them and the MCP consumer queries them. A rename in one place without
    the others leaves the boundary silently unevaluated in production.

    This gap was real: `inst_serving.db` was declared in the manifest, threaded
    through publish, and read by MCP before anything wrote it. The T9 agent asked
    "confirm the producer writes these names" — nothing did.

    EXACTLY, not `<=`: a producer table absent from `ARTIFACT_PROJECTIONS` would
    ship inside a digested artifact while contributing nothing to its digest, so
    tampering with it would not be detectable. The subset form this test used to
    assert could not see that.
    """
    import sqlite3

    from populus.inst_serving import write_serving_db
    from populus.publish.digests import ARTIFACT_PROJECTIONS

    conn = _fresh(tmp_path, "t8emit.db")
    _seed_affiliate_pair(conn)
    conn.commit()
    proj = build_serving_projection(conn, periods=("2026-03-31",))

    dest = tmp_path / "inst_serving.db"
    write_serving_db(proj, str(dest), source_conn=conn)
    out = sqlite3.connect(str(dest))
    written = {r[0] for r in out.execute(
        "SELECT name FROM sqlite_master WHERE type='table'"
        " AND name NOT LIKE 'sqlite_%'")}

    projected = set(ARTIFACT_PROJECTIONS["inst_serving.db"])
    assert written == projected, (
        "the artifact's tables and its digest projection have diverged —"
        f" produced-but-undigested: {sorted(written - projected)};"
        f" digested-but-unproduced: {sorted(projected - written)}")


def test_logical_digest_is_computable_and_stable_over_the_artifact(tmp_path):
    """`manifest.py` REQUIRES a `logical_digest` for `inst_serving.db`, so an
    artifact whose digest cannot be computed is a publication deadlock: the
    build raises `DigestError`, and `run_verify` reports "logical_digest could
    not be recomputed" for every build carrying it.

    That was the shipped state — three of the four projected tables had no
    primary key and `digests._table_columns` hard-fails without one. No test
    anywhere computed a digest over a serving database, which is why it shipped.

    Mutation guard: dropping `row_id INTEGER PRIMARY KEY` from any of
    `serving_filer_rows` / `serving_issuer_holder_rows` / `serving_activity`
    raises here.
    """
    import sqlite3

    from populus.inst_serving import write_serving_db
    from populus.publish.digests import logical_digest, projection_for
    from populus.publish.manifest import (
        INST_MODULE,
        INST_SERVING_ARTIFACT,
        _DB_ARTIFACTS,
    )

    assert INST_SERVING_ARTIFACT in _DB_ARTIFACTS, (
        "the manifest no longer requires a digest for the serving artifact — this"
        " test exists because it does")

    conn = _fresh(tmp_path, "t8digest.db")
    _seed_affiliate_pair(conn)
    conn.commit()
    projection = projection_for(INST_SERVING_ARTIFACT, INST_MODULE)

    digests = []
    for name in ("first.db", "second.db"):
        # A SEPARATE projection each time — two independent builds of one corpus,
        # not one projection serialized twice (which would test only the writer).
        proj = build_serving_projection(conn, periods=("2026-03-31",))
        dest = tmp_path / name
        write_serving_db(proj, str(dest), source_conn=conn)
        out = sqlite3.connect(str(dest))
        try:
            digests.append(logical_digest(out, projection))
        finally:
            out.close()

    assert digests[0] == digests[1], (
        "two builds of one corpus produced different logical digests — the §5.5"
        " integrity chain cannot be reproduced")


def test_write_serving_db_replaces_rather_than_appending(tmp_path):
    """The house producer contract (`inst_agg.build_inst_agg`): a re-run over one
    corpus yields the same content. Without the replace this either crashed on
    `serving_filings`' unique key or silently DOUBLED the three grain tables,
    whose only key is a surrogate assigned by enumeration.

    Live path: the staging directory is per-build-id and `reconcile_inflight`
    re-enters `_complete_build` on the same build_id.

    Mutation guard: deleting the `dest_path.unlink()` fails this.
    """
    import sqlite3

    from populus.inst_serving import write_serving_db

    conn = _fresh(tmp_path, "t8fresh.db")
    _seed_affiliate_pair(conn)
    conn.commit()
    proj = build_serving_projection(conn, periods=("2026-03-31",))

    dest = tmp_path / "inst_serving.db"
    counts = []
    for _ in range(3):
        write_serving_db(proj, str(dest), source_conn=conn)
        out = sqlite3.connect(str(dest))
        try:
            counts.append(tuple(
                out.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
                for table in ("serving_filings", "serving_filer_rows",
                              "serving_issuer_holder_rows", "serving_activity")
            ))
        finally:
            out.close()
    assert counts[0] == counts[1] == counts[2], (
        f"re-running the producer changed the row counts: {counts}")


def test_write_serving_db_refuses_to_overwrite_its_own_source(tmp_path):
    """The destination is REPLACED, so aliasing it to the ingested corpus would
    delete the corpus. `inst_agg` refuses this explicitly; the serving producer
    must too, and it must refuse BEFORE the unlink.

    Mutation guard: deleting the `refuse_if_dest_aliases_source` call destroys
    the source database instead of raising.
    """
    import pytest

    from populus.inst_agg import InstAggError
    from populus.inst_serving import write_serving_db

    conn = _fresh(tmp_path, "t8alias.db")
    _seed_affiliate_pair(conn)
    conn.commit()
    proj = build_serving_projection(conn, periods=("2026-03-31",))

    source = tmp_path / "t8alias.db"
    assert source.is_file()
    with pytest.raises(InstAggError):
        write_serving_db(proj, str(source), source_conn=conn)
    assert source.is_file(), "the refused write deleted the source database"
    assert conn.execute(
        "SELECT COUNT(*) FROM inst_filings").fetchone()[0] > 0, "corpus destroyed"


def test_emitted_rows_round_trip_with_null_honesty(tmp_path):
    """A NULL value must survive as NULL in the artifact — the one thing a
    serialization step is most likely to quietly turn into 0."""
    import sqlite3

    from populus.inst_serving import write_serving_db

    conn = _fresh(tmp_path, "t8null.db")
    APPLE_B = "037833200"
    sid_a = _security(conn, f"sec:{APPLE}")
    sid_b = _security(conn, f"sec:{APPLE_B}")
    _filer_fn(conn, "0000000031", "028-00031", "Null Co")
    _load_fn(
        conn, fid="inst:NULLCO", cik="0000000031", period="2026-03-31",
        filed="2026-04-15", file_number_norm="028-00031", total=100,
        holds=[
            _hold(ordinal=1, issuer="NULL CO", cusip=APPLE, value=100,
                  security_id=sid_a),
            _hold(ordinal=2, issuer="NULL CO", cusip=APPLE_B, value=None,
                  security_id=sid_b),
        ],
    )
    conn.commit()
    proj = build_serving_projection(conn, periods=("2026-03-31",))
    dest = tmp_path / "inst_serving.db"
    write_serving_db(proj, str(dest), source_conn=conn)
    out = sqlite3.connect(str(dest))

    values = [r[0] for r in out.execute(
        "SELECT value_usd FROM serving_filer_rows WHERE cik='0000000031'")]
    assert None in values, "an undisclosed value was materialised as a number"
    assert 0 not in values, "NULL was fabricated into 0 on the way to the artifact"

    row = out.execute(
        "SELECT value_usd, value_undisclosed_component FROM"
        " serving_issuer_holder_rows WHERE filer_key='0000000031'").fetchone()
    assert row[0] is None and row[1] == 1


# --- T13/R13: the ACTIVITY grain ---------------------------------------------
#
# This grain shipped with ZERO tests anywhere — `_build_activity_rows` is the
# most complex logic in the module (exit assertability, composition ordering,
# prior/current filing keys, issuer display fields) and nothing exercised it,
# because no fixture in the repository had two periods. Three defects fell out
# of the first two-period fixture ever run against it: a private issuer-key
# rule whose intersection with every other grain was EMPTY, exit rows carrying
# no issuer at all, and a false exit from an unclassifiable amendment.


def _seed_two_periods(conn, *, cik="0000000041", exit_issuer=True):
    """A filer over two consecutive quarters: APPLE grows, MICROSOFT is dropped.

    Produces one `add` and one `exit` in `agg_qoq_deltas` — the minimum corpus
    that exercises the QoQ join, the exit path and the prior-period lookup.
    """
    sid_a = _security(conn, f"sec:{APPLE}")
    sid_m = _security(conn, f"sec:{MSFT}")
    _filer_fn(conn, cik, "028-00041", "Two Period Co")
    prior = [
        _hold(ordinal=1, issuer="APPLE INC", cusip=APPLE, value=1000, security_id=sid_a),
        _hold(ordinal=2, issuer="MICROSOFT CORP", cusip=MSFT, value=500,
              security_id=sid_m),
    ]
    current = [
        _hold(ordinal=1, issuer="APPLE INC", cusip=APPLE, value=1500, security_id=sid_a),
    ]
    if not exit_issuer:
        current.append(
            _hold(ordinal=2, issuer="MICROSOFT CORP", cusip=MSFT, value=500,
                  security_id=sid_m)
        )
    _load_fn(conn, fid="inst:P1", cik=cik, period="2025-12-31", filed="2026-01-15",
             file_number_norm="028-00041", holds=prior)
    _load_fn(conn, fid="inst:P2", cik=cik, period="2026-03-31", filed="2026-04-15",
             file_number_norm="028-00041", holds=current)
    conn.commit()


def _project_with_aggregate(conn, tmp_path, name="agg.db"):
    """Build the REAL aggregate and project against it.

    The aggregate lives in `inst_agg.db` and the composed views live in the
    snapshot, so the publish path ATTACHes one to the other — this attaches it
    the same way rather than seeding `agg_qoq_deltas` by hand, so the fixture
    exercises the producer that actually runs in `run_build`.
    """
    from populus.inst_agg import build_inst_agg
    from populus.inst_serving import publication_periods

    agg_path = tmp_path / name
    build_inst_agg(conn, agg_path, ingested_at="2026-07-24T12:00:00Z")
    conn.execute("ATTACH DATABASE ? AS inst_agg", (str(agg_path),))
    try:
        periods = publication_periods(conn)
        return build_serving_projection(conn, periods=periods), periods
    finally:
        conn.execute("DETACH DATABASE inst_agg")


def test_valid_version_2_empty_and_unselected_periods_are_empty_streams(tmp_path):
    """Missing period dictionary rows are valid when no backing row references them."""
    from populus.inst_agg import build_inst_agg

    conn = _fresh(tmp_path, "empty-compact.db")
    sid = _security(conn, f"sec:{APPLE}")
    _filer_fn(conn, "0000000042", "028-00042", "One Period")
    _load_fn(
        conn,
        fid="inst:ONLY",
        cik="0000000042",
        period="2026-03-31",
        filed="2026-04-15",
        file_number_norm="028-00042",
        holds=[
            _hold(
                ordinal=1,
                issuer="APPLE INC",
                cusip=APPLE,
                value=1,
                security_id=sid,
            )
        ],
    )
    conn.commit()
    aggregate_path = tmp_path / "empty-compact-agg.db"
    build_inst_agg(conn, aggregate_path, ingested_at="2026-08-10T00:00:00Z")
    aggregate = sqlite3.connect(str(aggregate_path))
    assert aggregate.execute("SELECT COUNT(*) FROM _agg_qoq_deltas").fetchone()[0] == 0
    assert aggregate.execute("SELECT COUNT(*) FROM _agg_qoq_periods").fetchone()[0] == 0
    aggregate.close()

    conn.execute("ATTACH DATABASE ? AS empty_agg", (str(aggregate_path),))
    try:
        assert build_serving_projection(
            conn, periods=("2026-03-31",)
        ).activity_rows == []
        assert build_serving_projection(
            conn, periods=("2026-06-30",)
        ).activity_rows == []
    finally:
        conn.execute("DETACH DATABASE empty_agg")


def test_compact_path_never_reads_the_public_compatibility_view(tmp_path):
    """Version-2 serving must decode private rows rather than re-enter the view."""
    from populus.inst_agg import build_inst_agg

    conn = _fresh(tmp_path, "compact-no-view.db")
    _seed_two_periods(conn)
    aggregate_path = tmp_path / "compact-no-view-agg.db"
    build_inst_agg(conn, aggregate_path, ingested_at="2026-08-10T00:00:00Z")
    conn.execute("ATTACH DATABASE ? AS compact_agg", (str(aggregate_path),))

    def deny_public_view(action, name, _column, _database, _trigger):
        if action == sqlite3.SQLITE_READ and name == "agg_qoq_deltas":
            return sqlite3.SQLITE_DENY
        return sqlite3.SQLITE_OK

    conn.set_authorizer(deny_public_view)
    try:
        projection = build_serving_projection(
            conn, periods=("2025-12-31", "2026-03-31")
        )
        assert projection.activity_rows
    finally:
        conn.set_authorizer(None)
        conn.execute("DETACH DATABASE compact_agg")


def test_genuine_legacy_public_table_matches_version_2_activity(tmp_path):
    """The compatibility fallback remains exact for a physical legacy table."""
    from populus.inst_agg import build_inst_agg

    conn = _fresh(tmp_path, "legacy-fallback.db")
    _seed_two_periods(conn)
    aggregate_path = tmp_path / "v2-for-legacy.db"
    build_inst_agg(conn, aggregate_path, ingested_at="2026-08-10T00:00:00Z")
    current = sqlite3.connect(str(aggregate_path))
    rows = current.execute("SELECT * FROM agg_qoq_deltas").fetchall()
    current.close()

    conn.execute("ATTACH DATABASE ? AS current_agg", (str(aggregate_path),))
    try:
        expected = build_serving_projection(
            conn, periods=("2025-12-31", "2026-03-31")
        ).activity_rows
    finally:
        conn.execute("DETACH DATABASE current_agg")

    legacy_path = tmp_path / "legacy-agg.db"
    legacy = sqlite3.connect(str(legacy_path))
    legacy.execute(
        "CREATE TABLE agg_qoq_deltas ("
        "cik TEXT,position_key TEXT,put_call TEXT,curr_period TEXT,"
        "prev_period TEXT,change_kind TEXT,prev_value_usd INTEGER,"
        "curr_value_usd INTEGER,delta_value_usd INTEGER,prev_shares INTEGER,"
        "curr_shares INTEGER,delta_shares INTEGER,ssh_prnamt_type TEXT,"
        "flags TEXT,ingested_at TEXT)"
    )
    legacy.executemany(
        "INSERT INTO agg_qoq_deltas VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", rows
    )
    legacy.commit()
    legacy.close()

    conn.execute("ATTACH DATABASE ? AS legacy_agg", (str(legacy_path),))
    try:
        actual = build_serving_projection(
            conn, periods=("2025-12-31", "2026-03-31")
        ).activity_rows
    finally:
        conn.execute("DETACH DATABASE legacy_agg")
    assert actual == expected


@pytest.mark.parametrize(
    ("mutation", "message"),
    [
        (
            "UPDATE _agg_qoq_deltas SET filer_id=999999",
            "orphaned dictionary reference",
        ),
        (
            "UPDATE _agg_qoq_deltas SET curr_period_id=999999",
            "orphaned dictionary reference",
        ),
        (
            "UPDATE _agg_qoq_deltas SET prev_period_id=999999",
            "orphaned dictionary reference",
        ),
        (
            "UPDATE agg_build_meta SET value='1' WHERE key='aggregate_version'",
            "contradictory version metadata",
        ),
        ("DROP TABLE _agg_qoq_periods", "partial"),
        ("UPDATE _agg_qoq_deltas SET flags_mask=32", "invalid compact QoQ"),
    ],
)
def test_corrupt_version_2_storage_fails_closed_before_activity(
    tmp_path, mutation, message
):
    from populus.inst_agg import InstAggError, build_inst_agg

    conn = _fresh(tmp_path, f"corrupt-{abs(hash(mutation))}.db")
    _seed_two_periods(conn)
    aggregate_path = tmp_path / f"corrupt-{abs(hash(mutation))}-agg.db"
    build_inst_agg(conn, aggregate_path, ingested_at="2026-08-10T00:00:00Z")
    aggregate = sqlite3.connect(str(aggregate_path))
    aggregate.execute("PRAGMA ignore_check_constraints=ON")
    aggregate.execute(mutation)
    aggregate.commit()
    aggregate.close()

    conn.execute("ATTACH DATABASE ? AS corrupt_agg", (str(aggregate_path),))
    try:
        with pytest.raises(InstAggError, match=message):
            build_serving_projection(
                conn, periods=("2025-12-31", "2026-03-31")
            )
    finally:
        conn.execute("DETACH DATABASE corrupt_agg")


def test_multiple_reachable_aggregate_schemas_fail_closed(tmp_path):
    from populus.inst_agg import InstAggError, build_inst_agg

    conn = _fresh(tmp_path, "multiple-aggregate.db")
    _seed_two_periods(conn)
    aggregate_path = tmp_path / "multiple-aggregate-agg.db"
    build_inst_agg(conn, aggregate_path, ingested_at="2026-08-10T00:00:00Z")
    conn.execute("ATTACH DATABASE ? AS agg_one", (str(aggregate_path),))
    conn.execute("ATTACH DATABASE ? AS agg_two", (str(aggregate_path),))
    try:
        with pytest.raises(InstAggError, match="multiple reachable"):
            build_serving_projection(
                conn, periods=("2025-12-31", "2026-03-31")
            )
    finally:
        conn.execute("DETACH DATABASE agg_two")
        conn.execute("DETACH DATABASE agg_one")


def test_quoted_aggregate_schema_name_is_safe_and_functional(tmp_path):
    from populus.inst_agg import build_inst_agg

    conn = _fresh(tmp_path, "quoted-aggregate.db")
    _seed_two_periods(conn)
    aggregate_path = tmp_path / "quoted-aggregate-agg.db"
    build_inst_agg(conn, aggregate_path, ingested_at="2026-08-10T00:00:00Z")
    conn.execute('ATTACH DATABASE ? AS "agg""quoted"', (str(aggregate_path),))
    try:
        projection = build_serving_projection(
            conn, periods=("2025-12-31", "2026-03-31")
        )
        assert projection.activity_rows
    finally:
        conn.execute('DETACH DATABASE "agg""quoted"')


#: Three more real CUSIPs, so the undisclosed-value fixture below can hold one
#: position per NULL shape rather than one position asked to carry several.
NVDA, AMZN, TSLA = "67066G104", "023135106", "88160R101"

#: Every activity column that may legitimately be NULL. `serving_activity`
#: declares all six nullable, and each one means "the filer did not disclose
#: this", which is a different fact from a disclosed zero.
_ACTIVITY_NULLABLE_NUMERICS = (
    "prev_value_usd", "curr_value_usd", "delta_value_usd",
    "prev_shares", "curr_shares", "delta_shares",
)

#: The grain of one `agg_qoq_deltas` / `serving_activity` row.
_ACTIVITY_GRAIN = ("cik", "curr_period", "position_key", "put_call", "ssh_prnamt_type")


def _activity_by_grain(rows) -> dict[tuple, dict]:
    return {tuple(r[k] for k in _ACTIVITY_GRAIN): r for r in rows}


def _seed_undisclosed_two_periods(conn, cik="0000000061"):
    """Two periods carrying one position per NULL shape the activity grain has.

      * APPLE  — fully disclosed on both sides: the control, nothing is NULL;
      * MSFT   — held, then gone. An exit has no current position, so
                 `curr_shares` is NULL;
      * NVIDIA — still held; the CURRENT filing prints neither a parseable value
                 nor a share count, so `curr_value_usd`, `delta_value_usd`,
                 `curr_shares` and `delta_shares` are NULL;
      * AMAZON — the mirror: the PRIOR filing disclosed neither, so
                 `prev_value_usd`, `prev_shares` and both deltas are NULL;
      * TESLA  — new this period. There is no prior position to have shares, so
                 `prev_shares` is NULL while `prev_value_usd` is a REAL 0
                 (absence is a genuine zero; presence-without-disclosure is not).

    The undisclosed shapes are routine — they are why `sumDisclosedValue` and
    the `value_label` machinery exist — and NO fixture in the repository produced
    one before, so the activity grain's value-side NULL-honesty was unexercised.
    """
    sid_a = _security(conn, f"sec:{APPLE}")
    sid_m = _security(conn, f"sec:{MSFT}")
    sid_n = _security(conn, f"sec:{NVDA}")
    sid_z = _security(conn, f"sec:{AMZN}")
    sid_t = _security(conn, f"sec:{TSLA}")
    _filer_fn(conn, cik, "028-00061", "Undisclosed Co")
    _load_fn(
        conn, fid="inst:U1", cik=cik, period="2025-12-31", filed="2026-01-15",
        file_number_norm="028-00061",
        holds=[
            _hold(ordinal=1, issuer="APPLE INC", cusip=APPLE, value=1000,
                  security_id=sid_a),
            _hold(ordinal=2, issuer="MICROSOFT CORP", cusip=MSFT, value=500,
                  security_id=sid_m),
            _hold(ordinal=3, issuer="NVIDIA CORP", cusip=NVDA, value=800,
                  security_id=sid_n),
            _hold(ordinal=4, issuer="AMAZON COM INC", cusip=AMZN, value=None,
                  shares=None, security_id=sid_z),
        ],
    )
    _load_fn(
        conn, fid="inst:U2", cik=cik, period="2026-03-31", filed="2026-04-15",
        file_number_norm="028-00061",
        holds=[
            _hold(ordinal=1, issuer="APPLE INC", cusip=APPLE, value=1500,
                  security_id=sid_a),
            _hold(ordinal=2, issuer="NVIDIA CORP", cusip=NVDA, value=None,
                  shares=None, security_id=sid_n),
            _hold(ordinal=3, issuer="AMAZON COM INC", cusip=AMZN, value=900,
                  security_id=sid_z),
            _hold(ordinal=4, issuer="TESLA INC", cusip=TSLA, value=400,
                  security_id=sid_t),
        ],
    )
    conn.commit()


def test_the_activity_grain_is_NULL_honest_from_aggregate_to_artifact(tmp_path):
    """QA M2-8 R2 N3, pinned as a property rather than an end state.

    The filer grain's NULL-honesty was pinned
    (`test_emitted_rows_round_trip_with_null_honesty`); the activity grain's was
    not, and `"curr_shares": curr_shares or 0` SURVIVED 263 tests and
    `make accept-m2-8` on a fixture that genuinely carried a NULL there. The
    activity grain is the one whose values render as change copy in the feed, so
    a fabricated `0` publishes "0 shares" / "$0" for a position the filer simply
    did not size.

    The assertion is not "some field is None": it reads the AGGREGATE — the
    source `_build_activity_rows` projects from — and requires every nullable
    numeric to arrive unchanged, first in the projection and then in
    `serving_activity` after serialization. A field added later is covered
    automatically as long as it is listed in `_ACTIVITY_NULLABLE_NUMERICS`, and
    a `x or 0` anywhere on the path fails here.

    Mutation guard: `or 0` on ANY of the six columns, in the projection or the
    writer, FAILS this test.
    """
    import sqlite3

    from populus.inst_serving import write_serving_db

    conn = _fresh(tmp_path, "actnull.db")
    _seed_undisclosed_two_periods(conn)
    proj, _periods = _project_with_aggregate(conn, tmp_path, name="agg_null.db")

    agg = sqlite3.connect(str(tmp_path / "agg_null.db"))
    agg.row_factory = sqlite3.Row
    source = _activity_by_grain(agg.execute("SELECT * FROM agg_qoq_deltas"))
    assert source, "the fixture produced no aggregate rows to project"

    # NON-VACUITY, measured rather than assumed: a test that supplies the thing
    # it checks proves nothing. Name every (row, column) that is genuinely NULL
    # at the source, and require the value side to be represented — an exit's
    # `curr_shares` alone would leave `curr_value_usd`/`delta_value_usd`
    # untested, which is the gap QA measured separately.
    undisclosed = {
        (key, field)
        for key, row in source.items()
        for field in _ACTIVITY_NULLABLE_NUMERICS
        if row[field] is None
    }
    covered = {field for _key, field in undisclosed}
    assert covered == set(_ACTIVITY_NULLABLE_NUMERICS), (
        "the fixture does not carry a real NULL in every nullable activity"
        f" column, so `x or 0` on the uncovered one(s) would survive:"
        f" {sorted(set(_ACTIVITY_NULLABLE_NUMERICS) - covered)}")

    # 1. the projection must not alter a single nullable numeric.
    projected = _activity_by_grain(proj.activity_rows)
    assert set(projected) == set(source), (
        f"projected grains diverge from the aggregate's:"
        f" {sorted(set(projected) ^ set(source))}")
    for key, row in source.items():
        for field in _ACTIVITY_NULLABLE_NUMERICS:
            if row[field] is None:
                assert projected[key][field] is None, (
                    f"{field} was fabricated as {projected[key][field]!r} for"
                    f" {key} — an undisclosed quantity became a number")
            else:
                assert projected[key][field] == row[field]

    # 2. and neither must serialization, which is where a 0 is easiest to invent.
    dest = tmp_path / "inst_serving_null_activity.db"
    write_serving_db(proj, str(dest), source_conn=conn)
    out = sqlite3.connect(str(dest))
    out.row_factory = sqlite3.Row
    emitted = _activity_by_grain(out.execute("SELECT * FROM serving_activity"))
    assert set(emitted) == set(source)
    for key, row in source.items():
        for field in _ACTIVITY_NULLABLE_NUMERICS:
            if row[field] is None:
                assert emitted[key][field] is None, (
                    f"{field} reached serving_activity as"
                    f" {emitted[key][field]!r} for {key} — NULL was fabricated"
                    " into a number on the way to the artifact")
            else:
                assert emitted[key][field] == row[field]


def test_activity_issuer_key_is_the_canonical_key_every_other_grain_uses(tmp_path):
    """The activity feed links to the issuer/holders surface by `issuer_key`, so
    the key MUST be `inst_agg._issuer_key` — the same function the issuer-holder
    grain and the published aggregate use.

    The shipped code minted `f"cusip:{cusip}"` inline: a different NAMESPACE
    (`cusip:` not `cusip6:`) at a different GRANULARITY (the 9-character
    security, not the 6-character issuer block) with no entity resolution.
    Measured intersection with `serving_issuer_holder_rows`: EMPTY — every
    activity→issuer link resolved zero rows on every build, and two share
    classes of one issuer read as two issuers in the feed while remaining one
    issuer everywhere else.

    Mutation guard: restoring `f"cusip:{cusip}"` empties the intersection here.
    """
    conn = _fresh(tmp_path, "actkey.db")
    _seed_two_periods(conn)
    proj, _periods = _project_with_aggregate(conn, tmp_path)

    assert proj.activity_rows, "the two-period fixture produced no activity rows"
    activity_keys = {r["issuer_key"] for r in proj.activity_rows}
    issuer_keys = {r["issuer_key"] for r in proj.issuer_holder_rows}
    assert None not in activity_keys, "an activity row carries no issuer_key"
    assert activity_keys <= issuer_keys, (
        "activity issuer keys do not resolve against the issuer grain —"
        f" unjoinable: {sorted(activity_keys - issuer_keys)}")
    assert all(k.startswith(("entity:", "cusip6:", "name:")) for k in activity_keys), (
        f"activity minted a private issuer-key namespace: {sorted(activity_keys)}")


def test_exit_rows_carry_the_issuer_they_exited(tmp_path):
    """R13: the activity projection supplies the issuer display fields
    `agg_qoq_deltas` does not hold. An exit has no CURRENT-period holding row by
    definition, so a lookup keyed only on the current period misses for exactly
    the rows that most need a name — every exit shipped with
    `issuer_key = None, issuer_name = None` and the feed could not say what was
    exited.

    Mutation guard: deleting the prior-period fallback leaves these None.
    """
    conn = _fresh(tmp_path, "actexit.db")
    _seed_two_periods(conn)
    proj, _periods = _project_with_aggregate(conn, tmp_path)

    exits = [r for r in proj.activity_rows if r["change_kind"] == "exit"]
    assert exits, "the fixture produced no exit row"
    for row in exits:
        assert row["issuer_key"] is not None, "exit row carries no issuer_key"
        assert row["issuer_name"], "exit row carries no issuer_name"
    assert {r["issuer_name"] for r in exits} == {"MICROSOFT CORP"}


def test_exit_carries_both_compositions_and_the_prior_filing_keys(tmp_path):
    """An exit is an absence claim, so it must name BOTH the composition that
    established the position and the composition it is absent from (r3 F7)."""
    conn = _fresh(tmp_path, "actcomp.db")
    _seed_two_periods(conn)
    proj, _periods = _project_with_aggregate(conn, tmp_path)

    exits = [r for r in proj.activity_rows if r["change_kind"] == "exit"]
    assert exits
    for row in exits:
        assert row["prior_filing_keys"], "exit does not name the prior composition"
        assert row["current_filing_keys"], "exit does not name the current composition"
        assert row["prior_filing_keys"] != row["current_filing_keys"]
    # A non-exit carries neither — they are exit-only fields.
    for row in proj.activity_rows:
        if row["change_kind"] != "exit":
            assert row["prior_filing_keys"] == []
            assert row["current_filing_keys"] == []


# --- the plan's three named exit cases (R13 Testing Strategy) -----------------


def _exit_case(tmp_path, name, *, amendments):
    """Two periods where the CURRENT period's composition is `amendments`.

    Each entry is `(fid, submission_type, is_amendment, amendment_type,
    filed_date, holds)`. Filed dates are explicit because restatement
    resolution is ordered by them: a RESTATEMENT suppresses only what was filed
    BEFORE it, so "a later NEW-HOLDINGS" in the plan's case (b) has to actually
    be later or the fixture silently becomes a different case.
    """
    conn = _fresh(tmp_path, name)
    sid_a = _security(conn, f"sec:{APPLE}")
    sid_m = _security(conn, f"sec:{MSFT}")
    _filer_fn(conn, "0000000051", "028-00051", "Exit Case Co")
    _load_fn(
        conn, fid="inst:PRIOR", cik="0000000051", period="2025-12-31",
        filed="2026-01-15", file_number_norm="028-00051",
        holds=[
            _hold(ordinal=1, issuer="APPLE INC", cusip=APPLE, value=1000,
                  security_id=sid_a),
            _hold(ordinal=2, issuer="MICROSOFT CORP", cusip=MSFT, value=500,
                  security_id=sid_m),
        ],
    )
    for fid, subtype, is_amendment, amendment_type, filed, holds in amendments:
        _load_fn(
            conn, fid=fid, cik="0000000051", period="2026-03-31",
            filed=filed, file_number_norm="028-00051",
            submission_type=subtype, is_amendment=is_amendment,
            amendment_type=amendment_type,
            holds=[_hold(ordinal=i + 1, security_id=sid, **h)
                   for i, (h, sid) in enumerate(holds)],
        )
    conn.commit()
    return conn


_APPLE_HOLD = ({"issuer": "APPLE INC", "cusip": APPLE, "value": 1500}, f"sec:{APPLE}")


def test_exit_case_a_base_plus_new_holdings_is_authoritative(tmp_path):
    """Plan exit case (a): a clean base plus a NEW-HOLDINGS amendment. Both are
    accounted for, so absence IS assertable and a real exit may be published."""
    conn = _exit_case(
        tmp_path, "case_a.db",
        amendments=[
            ("inst:BASE", "13F-HR", 0, None, "2026-04-15", [_APPLE_HOLD]),
            ("inst:NEWA", "13F-HR/A", 1, "NEW_HOLDINGS", "2026-05-01", [_APPLE_HOLD]),
        ],
    )
    assert ("0000000051", "2026-03-31") in authoritative_full_periods(conn)


def test_exit_case_b_base_plus_restatement_plus_new_holdings_is_authoritative(tmp_path):
    """Plan exit case (b): a base, a RESTATEMENT that supersedes it, then a later
    NEW-HOLDINGS. The restatement resolution leaves exactly one surviving base
    and every amendment carries a known type."""
    conn = _exit_case(
        tmp_path, "case_b.db",
        amendments=[
            ("inst:BASE", "13F-HR", 0, None, "2026-04-15", [_APPLE_HOLD]),
            ("inst:REST", "13F-HR/A", 1, "RESTATEMENT", "2026-05-01", [_APPLE_HOLD]),
            ("inst:NEWB", "13F-HR/A", 1, "NEW_HOLDINGS", "2026-05-15", [_APPLE_HOLD]),
        ],
    )
    assert ("0000000051", "2026-03-31") in authoritative_full_periods(conn)


def _surviving_full_reports(conn, cik="0000000051", period="2026-03-31") -> int:
    """How many filings the composition guard actually COUNTS for one period.

    Measured with the module's own predicate over the resolved view, so a
    fixture cannot drift into a different case (zero full reports rather than
    two) and leave the test passing for the wrong reason.
    """
    from populus.inst_serving import _is_full_holdings_report

    return sum(
        1
        for row in conn.execute(
            "SELECT submission_type, is_amendment, amendment_type"
            " FROM v_filer_reported_filings"
            " WHERE cik = ? AND period_of_report = ?",
            (cik, period),
        )
        if _is_full_holdings_report(*row)
    )


def test_two_surviving_full_reports_are_NOT_assertable(tmp_path):
    """The plan's other half: *"exactly one surviving base 13F-HR for the (cik,
    period) after restatement resolution — TWO OR MORE surviving bases ⇒ not
    assertable"* (`RUN-M2-8-plan.md:340`).

    Every other exit fixture in this file lands on ZERO full reports, so all of
    them pass under a predicate relaxed from `!= 1` to `< 1` — QA M2-8 R2 N2
    measured exactly that: the mutation survived 263 tests and `accept-m2-8`.
    The code implements the rule; nothing observed it.

    The shape that isolates the upper bound is a base plus a RESTATEMENT filed
    BEFORE it: a restatement supersedes only what was filed earlier, so it
    suppresses nothing and both filings survive resolution. The two documents
    disagree about what was held — an out-of-order restatement, a duplicated
    base accession, or a supersede link that was never written — and a
    composition that contradicts itself cannot support "this position is gone".

    Mutation guard: `!= 1` → `< 1` (or `> 1`, or dropping the count) makes this
    period authoritative and FAILS here. [[mutation-tests-pin-properties]]
    """
    conn = _exit_case(
        tmp_path, "case_two_bases.db",
        amendments=[
            # Filed FIRST, so it supersedes nothing that follows it.
            ("inst:REST", "13F-HR/A", 1, "RESTATEMENT", "2026-04-01", [_APPLE_HOLD]),
            ("inst:BASE", "13F-HR", 0, None, "2026-04-15", [_APPLE_HOLD]),
        ],
    )
    # Non-vacuity: this must be the TWO case, not another zero case in disguise.
    assert _surviving_full_reports(conn) == 2, (
        "the fixture no longer produces two surviving full reports, so it no"
        " longer exercises the upper bound of the composition guard")
    assert ("0000000051", "2026-03-31") not in authoritative_full_periods(conn)


def test_an_ambiguous_composition_degrades_the_exit_end_to_end(tmp_path):
    """N2 carried to a published row. Two surviving full reports must reach the
    artifact as `unclassified` + `exit_not_assertable`, never as `exit`:
    "this institution sold out of X", asserted from a document set that
    contradicts itself, is the exact claim `exit_not_assertable` exists to
    refuse."""
    conn = _exit_case(
        tmp_path, "case_two_bases_e2e.db",
        amendments=[
            ("inst:REST", "13F-HR/A", 1, "RESTATEMENT", "2026-04-01", [_APPLE_HOLD]),
            ("inst:BASE", "13F-HR", 0, None, "2026-04-15", [_APPLE_HOLD]),
        ],
    )
    assert _surviving_full_reports(conn) == 2
    proj, _periods = _project_with_aggregate(conn, tmp_path, name="agg_two_bases.db")

    assert proj.activity_rows, "fixture produced no activity rows"
    assert "exit" not in {r["change_kind"] for r in proj.activity_rows}, (
        "an exit was published from a composition holding two contradictory"
        " full holdings reports")
    degraded = [r for r in proj.activity_rows if r["change_kind"] == "unclassified"]
    assert degraded, "the dropped MICROSOFT position did not surface at all"
    assert any("exit_not_assertable" in r["flags"] for r in degraded), (
        "the row degraded silently — the reason must be stated, not omitted")


def test_exit_case_c_new_holdings_only_is_never_authoritative(tmp_path):
    """Plan exit case (c) — the FORBIDDEN one: a NEW-HOLDINGS amendment with no
    base in the period. There is no full holdings report for a position to be
    absent from, so absence is not assertable and the row must degrade to
    `unclassified` + `exit_not_assertable` rather than claim a sale."""
    conn = _exit_case(
        tmp_path, "case_c.db",
        amendments=[("inst:NEWONLY", "13F-HR/A", 1, "NEW_HOLDINGS", "2026-04-15",
                     [_APPLE_HOLD])],
    )
    assert ("0000000051", "2026-03-31") not in authoritative_full_periods(conn)


def test_exit_case_c_null_amendment_type_does_not_pass_as_a_base(tmp_path):
    """The measured false exit. `parse/inst13f.py` leaves `amendment_type` NULL
    whenever `<amendmentType>` is absent or unrecognised — a reachable, expected
    production state with its own flag (`amendment_type_unknown`).

    The shipped predicate detected bases as `amendment_type IS NULL` and ALSO
    admitted None as a "known type", so a `13F-HR/A` of unknown type satisfied
    both guards at once: the period read authoritative-full and every position
    absent from that one amendment published as `change_kind='exit'` — the
    product asserting "this institution sold out of X" from a document set that
    cannot support absence.

    Mutation guard: restoring `bases = [r for r in rows if r[1] is None]`, or
    putting `None` back into the known-type set, flips this to authoritative.
    """
    conn = _exit_case(
        tmp_path, "case_c_null.db",
        amendments=[("inst:UNKNOWNA", "13F-HR/A", 1, None, "2026-04-15",
                     [_APPLE_HOLD])],
    )
    assert ("0000000051", "2026-03-31") not in authoritative_full_periods(conn)


def test_a_base_plus_an_unclassifiable_amendment_is_not_authoritative(tmp_path):
    """Isolates the KNOWN-TYPE guard, which the amendment-only fixtures cannot
    reach (they already fail on "zero full holdings reports").

    Here the period has a clean base — one full report, everything parsed — plus
    a `13F-HR/A` whose `<amendmentType>` the parser could not classify. That
    amendment might be a RESTATEMENT, i.e. it might replace the base wholesale,
    so the composition cannot be trusted to list everything held. `None` must
    therefore NOT be a member of `KNOWN_AMENDMENT_TYPES`.

    Mutation guard: adding `None` back to `KNOWN_AMENDMENT_TYPES` flips this to
    authoritative. A surviving mutation on that set is what showed the earlier
    exit fixtures were pinning the base rule twice and the type rule not at all.
    """
    from populus.inst_serving import KNOWN_AMENDMENT_TYPES

    assert None not in KNOWN_AMENDMENT_TYPES

    conn = _exit_case(
        tmp_path, "case_base_plus_unknown.db",
        amendments=[
            ("inst:BASE", "13F-HR", 0, None, "2026-04-15", [_APPLE_HOLD]),
            ("inst:UNKA", "13F-HR/A", 1, None, "2026-05-01", [_APPLE_HOLD]),
        ],
    )
    assert ("0000000051", "2026-03-31") not in authoritative_full_periods(conn)


def test_a_false_exit_degrades_to_unclassified_end_to_end(tmp_path):
    """The predicate above, carried all the way to a projected row: the corpus
    that cannot support absence must publish `unclassified` +
    `exit_not_assertable`, never `exit`."""
    conn = _exit_case(
        tmp_path, "case_c_e2e.db",
        amendments=[("inst:UNKNOWNA", "13F-HR/A", 1, None, "2026-04-15",
                     [_APPLE_HOLD])],
    )
    proj, _periods = _project_with_aggregate(conn, tmp_path, name="agg_c.db")

    assert proj.activity_rows, "fixture produced no activity rows"
    kinds = {r["change_kind"] for r in proj.activity_rows}
    assert "exit" not in kinds, (
        "a false exit was published from an amendment-only composition")
    degraded = [r for r in proj.activity_rows if r["change_kind"] == "unclassified"]
    assert degraded, "the dropped MICROSOFT position did not surface at all"
    assert any("exit_not_assertable" in r["flags"] for r in degraded), (
        "the row degraded silently — the reason must be stated, not omitted")


def test_an_unparsed_member_of_the_composition_blocks_an_exit(tmp_path):
    """A failed or cover-failed member could have carried the security, so the
    composition cannot assert absence."""
    conn = _exit_case(
        tmp_path, "case_unparsed.db",
        amendments=[("inst:BASE", "13F-HR", 0, None, "2026-04-15", [_APPLE_HOLD])],
    )
    conn.execute(
        "UPDATE inst_filings SET parse_status = 'failed' WHERE filing_id = 'inst:BASE'")
    conn.commit()
    assert ("0000000051", "2026-03-31") not in authoritative_full_periods(conn)


def test_activity_rows_survive_the_artifact_round_trip(tmp_path):
    """The activity grain is the one the dashboard loader reads by column name.
    A projected row that never reaches `serving_activity` is a grain the feed
    renders as empty."""
    import sqlite3

    from populus.inst_serving import write_serving_db

    conn = _fresh(tmp_path, "actrt.db")
    _seed_two_periods(conn)
    proj, _periods = _project_with_aggregate(conn, tmp_path)

    dest = tmp_path / "inst_serving.db"
    write_serving_db(proj, str(dest), source_conn=conn)
    out = sqlite3.connect(str(dest))
    out.row_factory = sqlite3.Row
    rows = out.execute(
        "SELECT * FROM serving_activity ORDER BY row_id").fetchall()
    assert len(rows) == len(proj.activity_rows)
    for row in rows:
        assert row["issuer_key"], "issuer_key was lost in serialization"
        assert row["filing_keys"].startswith("["), "filing_keys is not a JSON array"
    kinds = {row["change_kind"] for row in rows}
    assert "exit" in kinds and "add" in kinds, f"unexpected change kinds: {kinds}"
