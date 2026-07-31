"""RUN M2-5 / F3: a declared authority split must repoint persisted
``inst_holdings`` as-of each holding's filing period (G14 — no identity
time-travel). A split hands different periods of one CUSIP to different owners,
so a holding cannot be blanket-moved like a rename; it must resolve by its own
``period_of_report``. Exercised on both the fully-retired and retained-owner
forms, with holdings on BOTH sides of the boundary."""

from __future__ import annotations

from populus.amendments import ensure_views
from populus.db import connect, init_db
from populus.identity.bootstrap import Mutations
from populus.identity.list13f_seed import bootstrap_13f_list
from populus.identity.registry import (
    ensure_registry,
    parse_identity_registry,
    reconcile_identity_registry,
    resolve_cusip,
)
from populus.load import ensure_inst_schema
from populus.parse.list13f import parse_list13f_text

from test_inst_agg import _filer, _hold, _load  # established cross-fixture reuse

APPLE = "037833100"

FULL_SPLIT = parse_identity_registry(
    """
classes:
  - security_id: sec:apple-before
    class: equity
    identifiers: [{id_type: cusip, value: "037833100", to: "2026-02-15"}]
    note: "apple before the mid-quarter reassignment"
    review_state: reviewed
  - security_id: sec:apple-after
    class: equity
    identifiers: [{id_type: cusip, value: "037833100", from: "2026-02-15"}]
    note: "apple after the mid-quarter reassignment"
    review_state: reviewed
continuities: []
"""
)

DECLARED_APPLE = parse_identity_registry(
    """
classes:
  - security_id: sec:apple
    class: equity
    identifiers: [{id_type: cusip, value: "037833100"}]
    note: "apple declared owner, whole history"
    review_state: reviewed
continuities: []
"""
)

RETAINED_SPLIT = parse_identity_registry(
    """
classes:
  - security_id: sec:apple
    class: equity
    identifiers: [{id_type: cusip, value: "037833100", to: "2026-02-15"}]
    note: "apple retains the pre-boundary window"
    review_state: reviewed
  - security_id: sec:apple-successor
    class: equity
    identifiers: [{id_type: cusip, value: "037833100", from: "2026-02-15"}]
    note: "successor takes the post-boundary window"
    review_state: reviewed
continuities: []
"""
)


def _line(cusip, name, cls):
    row = cusip.ljust(9)[:9] + " " + name.ljust(30)[:30] + cls.ljust(27)[:27] + "   " + " " * 9 + "E"
    assert len(row) == 80
    return row


def _fresh(tmp_path):
    path = tmp_path / "split.db"
    init_db(str(path))
    conn = connect(str(path))
    ensure_registry(conn)
    ensure_inst_schema(conn)
    ensure_views(conn)
    return conn


def _seed(conn, registry, *, sha="s1"):
    parsed = parse_list13f_text(_line(APPLE, "APPLE INC", "COM") + "\n", quarter="2026q1")
    conn.execute("BEGIN IMMEDIATE")
    try:
        bootstrap_13f_list(
            conn, parsed, quarter="2026q1", registry=registry,
            source_meta={"source_url": "u", "sha256": sha, "retrieved_at": "t", "raw_path": "p"},
            mutations=Mutations(),
        )
        conn.execute("COMMIT")
    except BaseException:
        conn.execute("ROLLBACK")
        raise


def _holdings_across_the_boundary(conn, sid):
    # Two holdings of the SAME cusip, one PRE-boundary (2026-02-01) and one POST
    # (2026-03-31), both initially stamped with `sid`.
    _filer(conn, "0000000001")
    _load(conn, fid="inst:PRE", cik="0000000001", period="2026-02-01", filed="2026-04-15",
          holds=[_hold(ordinal=1, issuer="APPLE", cusip=APPLE, value=1000, security_id=sid)])
    _load(conn, fid="inst:POST", cik="0000000001", period="2026-03-31", filed="2026-05-15",
          holds=[_hold(ordinal=1, issuer="APPLE", cusip=APPLE, value=1000, security_id=sid)])


def _sid_of(conn, fid):
    return conn.execute(
        "SELECT security_id FROM inst_holdings WHERE filing_id = ?", (fid,)
    ).fetchone()[0]


def _reconcile(conn, registry):
    conn.execute("BEGIN IMMEDIATE")
    try:
        mutations = reconcile_identity_registry(conn, registry)
        conn.execute("COMMIT")
    except BaseException:
        conn.execute("ROLLBACK")
        raise
    return mutations


def test_fully_retired_split_repoints_holdings_on_both_sides(tmp_path):
    # A provisional id owns the whole quarter; both holdings resolve to it. A
    # reviewed revision then splits the CUSIP at 2026-02-15 into two DECLARED ids
    # (the provisional fully retires). Each holding must repoint AS-OF ITS PERIOD.
    conn = _fresh(tmp_path)
    _seed(conn, parse_identity_registry("classes: []\ncontinuities: []\n"))
    prov = resolve_cusip(conn, APPLE, "2026-03-31")
    assert prov is not None and prov.startswith("sec:prov:")
    _holdings_across_the_boundary(conn, prov)

    mutations = _reconcile(conn, FULL_SPLIT)

    assert mutations.holdings_repointed_on_split == 2
    assert resolve_cusip(conn, APPLE, "2026-02-01") == "sec:apple-before"
    assert resolve_cusip(conn, APPLE, "2026-03-31") == "sec:apple-after"
    # The pre-boundary holding is the before-owner; the post-boundary one is the
    # AFTER-owner — NEVER left attached to the retired provisional (the F3 defect).
    assert _sid_of(conn, "inst:PRE") == "sec:apple-before"
    assert _sid_of(conn, "inst:POST") == "sec:apple-after"
    # The G14 consistency invariant: every holding equals its own as-of resolution.
    assert _sid_of(conn, "inst:PRE") == resolve_cusip(conn, APPLE, "2026-02-01")
    assert _sid_of(conn, "inst:POST") == resolve_cusip(conn, APPLE, "2026-03-31")
    assert conn.execute("PRAGMA foreign_key_check").fetchall() == []
    conn.close()


def test_retained_owner_split_repoints_only_the_post_boundary_holding(tmp_path):
    # The declared owner sec:apple keeps [.., 2026-02-15) and hands [2026-02-15, ..)
    # to a successor — the exact retained-owner case F3 names. The pre-boundary
    # holding stays sec:apple; only the post-boundary one moves.
    conn = _fresh(tmp_path)
    _seed(conn, DECLARED_APPLE)
    assert resolve_cusip(conn, APPLE, "2026-03-31") == "sec:apple"
    _holdings_across_the_boundary(conn, "sec:apple")

    mutations = _reconcile(conn, RETAINED_SPLIT)

    assert mutations.holdings_repointed_on_split == 1  # only the post-boundary holding
    assert _sid_of(conn, "inst:PRE") == "sec:apple"              # retained, unchanged
    assert _sid_of(conn, "inst:POST") == "sec:apple-successor"   # moved across the boundary
    assert _sid_of(conn, "inst:PRE") == resolve_cusip(conn, APPLE, "2026-02-01")
    assert _sid_of(conn, "inst:POST") == resolve_cusip(conn, APPLE, "2026-03-31")
    assert conn.execute("PRAGMA foreign_key_check").fetchall() == []
    conn.close()
