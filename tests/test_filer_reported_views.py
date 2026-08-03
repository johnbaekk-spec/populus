"""RUN M2-8 T5 (plan R8) — the per-filer reported population.

`v_default_*` suppresses a survivor whose file number appears as another
survivor's other-manager, so a cross-entity issuer total counts an affiliate
relationship once. Correct there; **wrong** for a filer's own page, which
promises "every position this filer reported". External review round 2 (F13)
established that building the filer page on `v_default_holdings` would silently
delete that filer's own rows while the page claimed completeness.

These tests pin two properties:

  1. **The regression itself** — an affiliate-suppressed filer keeps its full
     reported book in `v_filer_reported_holdings`, while the issuer total taken
     over `v_default_holdings` still counts the relationship exactly once.
  2. **Anti-drift** — `views.sql` restates the stage-1 restatement-survivor
     predicate in the new chain rather than refactoring the reviewed views to
     share a CTE. Duplication is only safe if it cannot diverge silently, so the
     exact set relationship between the two chains is asserted here:

         v_filer_reported_filings
             == v_default_inst_filings ∪ {survivors suppressed only by affiliation
                                          that also pass cover reconciliation}

     If either survivor predicate is edited without the other, this fails.
"""

from __future__ import annotations

from populus.amendments import ensure_views
from populus.db import connect, init_db
from populus.identity.registry import ensure_registry
from populus.load import ensure_inst_schema, upsert_inst_filer, upsert_inst_filing
from populus.load import InstFilingRow

from test_inst_agg import AT, _hold, _load

APPLE = "037833100"
MSFT = "594918104"


def _fresh(tmp_path, name="filer_reported.db"):
    path = tmp_path / name
    init_db(str(path))
    conn = connect(str(path))
    ensure_registry(conn)
    ensure_inst_schema(conn)
    ensure_views(conn)
    return conn


def _security(conn, security_id):
    conn.execute(
        "INSERT INTO securities (security_id, id_state, class, entity_id,"
        " entity_link_state, review_state) VALUES (?, 'provisional', NULL, NULL,"
        " 'unresolved', 'auto') ON CONFLICT (security_id) DO NOTHING",
        (security_id,),
    )
    return security_id


def _filer_fn(conn, cik, file_number_norm, name="Test Filer"):
    """A filer carrying its OWN normalized file number (the affiliation key)."""
    upsert_inst_filer(
        conn, cik=cik, name_raw=name, form13f_file_number=file_number_norm,
        file_number_norm=file_number_norm, entity_id=None, raw=None, flags=[],
        source_url="u", retrieved_at=None, response_hash=None, raw_path=None,
        parser_version="p", normalization_version="n", ingested_at=AT,
    )


def _load_fn(conn, *, fid, cik, period, filed, holds, file_number_norm,
             other_managers=(), total=None):
    """Load one filing with an explicit file number and other-manager list."""
    if total is None:
        total = sum(h.value_usd for h in holds if h.value_usd is not None)
    filing = InstFilingRow(
        filing_id=fid, cik=cik, accession=fid.split(":", 1)[1],
        submission_type="13F-HR", period_of_report=period, filed_date=filed,
        form_version=None, unit_basis="whole", is_amendment=0, amendment_type=None,
        amendment_no=None, amends=None, is_confidential_omitted=None,
        conf_denied_expired=None, filing_manager_raw="Test Filer",
        form13f_file_number=file_number_norm, file_number_norm=file_number_norm,
        report_type="13F HOLDINGS REPORT",
        other_managers=[{"file_number_norm": fn} for fn in other_managers],
        table_entry_total=len(holds), table_value_total=total,
        table_value_total_usd=total, row_count=len(holds), sum_value_usd=total,
        value_total_delta=0, resolved_rows=len(holds), resolved_value_usd=total,
        parse_status="parsed", failure_kind=None, flags=[],
        doc_url="d", table_url="t", table_filename="f.xml", table_raw_path="rp",
        source_url="s", retrieved_at=None, raw_path="r", index_response_hash=None,
        response_hash=None, table_response_hash=None, parser_version="p",
        normalization_version="n", ingested_at=AT,
    )
    upsert_inst_filing(conn, filing=filing, holdings=holds)


def _seed_affiliate_pair(conn, period="2026-03-31"):
    """COVERED (028-00002) reports its own book AND is named as an other-manager
    by COVERER (028-00001) — so `v_default_*` suppresses COVERED to keep the
    issuer total honest."""
    sid = _security(conn, f"sec:{APPLE}")
    _filer_fn(conn, "0000000001", "028-00001", "Coverer")
    _filer_fn(conn, "0000000002", "028-00002", "Covered")
    _load_fn(
        conn, fid="inst:COVERER", cik="0000000001", period=period, filed="2026-04-15",
        file_number_norm="028-00001", other_managers=("028-00002",),
        holds=[_hold(ordinal=1, issuer="APPLE INC", cusip=APPLE, value=700,
                     security_id=sid)],
    )
    _load_fn(
        conn, fid="inst:COVERED", cik="0000000002", period=period, filed="2026-04-15",
        file_number_norm="028-00002", other_managers=(),
        holds=[_hold(ordinal=1, issuer="APPLE INC", cusip=APPLE, value=300,
                     security_id=sid)],
    )
    return sid


def _ids(conn, view):
    return {r[0] for r in conn.execute(f"SELECT filing_id FROM {view}")}


# --- 1. the F13 regression -------------------------------------------------


def test_affiliate_suppressed_filer_keeps_its_own_book_on_the_filer_view(tmp_path):
    """The exact defect review F13 identified: a filer covered by an affiliate
    disappears from the default view. Its own page must still show its position,
    while the issuer total still counts the relationship once."""
    conn = _fresh(tmp_path)
    _seed_affiliate_pair(conn)

    # The default (cross-entity) chain suppresses COVERED — that is correct there.
    assert "inst:COVERED" not in _ids(conn, "v_default_inst_filings")
    assert "inst:COVERER" in _ids(conn, "v_default_inst_filings")

    # The per-filer chain keeps BOTH: each filer reported its own book.
    assert _ids(conn, "v_filer_reported_filings") == {"inst:COVERER", "inst:COVERED"}

    # COVERED's own page shows its own position — the regression.
    covered_rows = conn.execute(
        "SELECT COUNT(*), COALESCE(SUM(value_usd), 0) FROM v_filer_reported_holdings"
        " WHERE cik = '0000000002'"
    ).fetchone()
    assert covered_rows == (1, 300), "the covered filer lost its own reported book"

    # ...while the issuer total over the DEFAULT view still counts it once.
    issuer_total = conn.execute(
        "SELECT COALESCE(SUM(value_usd), 0) FROM v_default_holdings"
        " WHERE cusip = ?", (APPLE,)
    ).fetchone()[0]
    assert issuer_total == 700, "issuer total must not double-count the affiliate"

    # And the per-filer view deliberately sums to MORE than the issuer total —
    # that is the whole point, and why the two must never be summed together.
    filer_total = conn.execute(
        "SELECT COALESCE(SUM(value_usd), 0) FROM v_filer_reported_holdings"
        " WHERE cusip = ?", (APPLE,)
    ).fetchone()[0]
    assert filer_total == 1000
    assert filer_total > issuer_total


# --- 2. anti-drift between the two restated survivor predicates ------------


def test_filer_chain_equals_default_chain_plus_only_affiliation_suppressed(tmp_path):
    """`views.sql` restates stage 1 rather than sharing a CTE. This asserts the
    exact set relationship, so editing one predicate without the other fails."""
    conn = _fresh(tmp_path)
    _seed_affiliate_pair(conn)
    # A third, wholly unaffiliated filer must be in BOTH chains.
    sid = _security(conn, f"sec:{MSFT}")
    _filer_fn(conn, "0000000003", "028-00003", "Independent")
    _load_fn(
        conn, fid="inst:INDEP", cik="0000000003", period="2026-03-31",
        filed="2026-04-15", file_number_norm="028-00003", other_managers=(),
        holds=[_hold(ordinal=1, issuer="MICROSOFT CORP", cusip=MSFT, value=500,
                     security_id=sid)],
    )

    filer_chain = _ids(conn, "v_filer_reported_filings")
    default_chain = _ids(conn, "v_default_inst_filings")
    reconciled = _ids(conn, "v_inst_reconciled_filings")

    # Everything the default chain serves is in the filer chain.
    assert default_chain <= filer_chain

    # The difference is EXACTLY the affiliation-suppressed survivors — i.e. rows
    # dropped by stage 2 alone, not by stage 1 or stage 3.
    suppressed_by_affiliation_only = filer_chain - reconciled
    assert filer_chain - default_chain == suppressed_by_affiliation_only
    assert suppressed_by_affiliation_only == {"inst:COVERED"}

    # The unaffiliated filer is in both, proving the filer chain is not simply
    # "everything" and still applies stages 1 and 3.
    assert "inst:INDEP" in filer_chain and "inst:INDEP" in default_chain


def test_filer_chain_still_applies_restatement_supersede(tmp_path):
    """Stage 1 is NOT omitted: a superseded original stays out of both chains.
    Mutation guard — deleting the survivor CTE from the new view flips this."""
    conn = _fresh(tmp_path)
    sid = _security(conn, f"sec:{APPLE}")
    _filer_fn(conn, "0000000004", "028-00004", "Restater")
    _load_fn(
        conn, fid="inst:ORIG", cik="0000000004", period="2026-03-31",
        filed="2026-04-15", file_number_norm="028-00004",
        holds=[_hold(ordinal=1, issuer="APPLE INC", cusip=APPLE, value=100,
                     security_id=sid)],
    )
    # A later RESTATEMENT for the same (cik, period) supersedes the original.
    filing = InstFilingRow(
        filing_id="inst:REST", cik="0000000004", accession="REST",
        submission_type="13F-HR/A", period_of_report="2026-03-31",
        filed_date="2026-05-15", form_version=None, unit_basis="whole",
        is_amendment=1, amendment_type="RESTATEMENT", amendment_no=1, amends=None,
        is_confidential_omitted=None, conf_denied_expired=None,
        filing_manager_raw="Restater", form13f_file_number="028-00004",
        file_number_norm="028-00004", report_type="13F HOLDINGS REPORT",
        other_managers=[], table_entry_total=1, table_value_total=900,
        table_value_total_usd=900, row_count=1, sum_value_usd=900,
        value_total_delta=0, resolved_rows=1, resolved_value_usd=900,
        parse_status="parsed", failure_kind=None, flags=[], doc_url="d",
        table_url="t", table_filename="f.xml", table_raw_path="rp", source_url="s",
        retrieved_at=None, raw_path="r", index_response_hash=None,
        response_hash=None, table_response_hash=None, parser_version="p",
        normalization_version="n", ingested_at=AT,
    )
    upsert_inst_filing(
        conn,
        filing=filing,
        holdings=[_hold(ordinal=1, issuer="APPLE INC", cusip=APPLE, value=900,
                        security_id=sid)],
    )

    filer_chain = _ids(conn, "v_filer_reported_filings")
    assert "inst:REST" in filer_chain
    assert "inst:ORIG" not in filer_chain, "superseded original leaked into the filer view"


def test_filer_chain_still_applies_cover_reconciliation(tmp_path):
    """Stage 3 is NOT omitted: a filing whose resolved sum exceeds its declared
    cover total beyond tolerance stays out of both chains (M2-7)."""
    conn = _fresh(tmp_path)
    sid = _security(conn, f"sec:{APPLE}")
    _filer_fn(conn, "0000000005", "028-00005", "Conflicted")
    # declares 1,000 but resolves 1,000,000 — far past max($1,000, 0.1%)
    _load_fn(
        conn, fid="inst:CONFLICT", cik="0000000005", period="2026-03-31",
        filed="2026-04-15", file_number_norm="028-00005", total=1_000,
        holds=[_hold(ordinal=1, issuer="APPLE INC", cusip=APPLE, value=1_000_000,
                     security_id=sid)],
    )
    assert "inst:CONFLICT" not in _ids(conn, "v_filer_reported_filings")
    assert "inst:CONFLICT" not in _ids(conn, "v_default_inst_filings")
    # ...but it IS in the pre-reconciliation population, so it can still be named.
    assert "inst:CONFLICT" in _ids(conn, "v_inst_reconciled_filings")


# --- 3. T6: max-single-position-share, computed on the non-suppressed view --


def test_max_position_share_differs_from_topn_share(tmp_path):
    """R14 / review round 2 F11 — the named fixture pair. A book of ONE 50%
    position and a book of FIVE 10% positions have the same combined top-5
    share; only max_position_share_bps tells them apart. Mutation guard:
    substituting topn_share_bps for max_position_share_bps flips this."""
    from populus.inst_agg import build_inst_agg

    conn = _fresh(tmp_path, "maxshare.db")
    # Filer ONE: a single position worth 5,000 out of 10,000 => 50% (5000 bps)
    sid_a = _security(conn, f"sec:{APPLE}")
    sid_b = _security(conn, f"sec:{MSFT}")
    _filer_fn(conn, "0000000010", "028-00010", "One Big")
    _load_fn(
        conn, fid="inst:ONEBIG", cik="0000000010", period="2026-03-31",
        filed="2026-04-15", file_number_norm="028-00010",
        holds=[
            _hold(ordinal=1, issuer="APPLE INC", cusip=APPLE, value=5_000,
                  security_id=sid_a),
            _hold(ordinal=2, issuer="MICROSOFT CORP", cusip=MSFT, value=5_000,
                  security_id=sid_b),
        ],
    )
    conn.commit()

    out = tmp_path / "agg.db"
    build_inst_agg(conn, str(out), topn=5, ingested_at=AT)
    import sqlite3
    agg = sqlite3.connect(str(out))
    row = agg.execute(
        "SELECT topn_share_bps, max_position_share_bps, total_value_usd"
        " FROM agg_filer_concentration WHERE cik = '0000000010'"
    ).fetchone()
    topn_share, max_share, total = row
    assert total == 10_000
    # Both positions are inside the top-5, so the COMBINED share is the whole book.
    assert topn_share == 10_000, "top-N share should be 100% of the book"
    # The LARGEST SINGLE position is only half of it.
    assert max_share == 5_000, "max single-position share should be 50%"
    assert max_share != topn_share, "the two statistics must not coincide here"


def test_concentration_measured_on_the_filers_own_book_not_the_suppressed_one(tmp_path):
    """Review round 3 F5: concentration (and therefore the flag baseline) must be
    computed from v_filer_reported_holdings. An affiliate-suppressed filer would
    otherwise have NO concentration row at all, or one built from a truncated book.
    Mutation guard: pointing the second pass back at v_default_holdings drops the
    covered filer's row entirely."""
    from populus.inst_agg import build_inst_agg
    import sqlite3

    conn = _fresh(tmp_path, "conc_source.db")
    _seed_affiliate_pair(conn)
    conn.commit()

    out = tmp_path / "agg2.db"
    build_inst_agg(conn, str(out), topn=5, ingested_at=AT)
    agg = sqlite3.connect(str(out))

    covered = agg.execute(
        "SELECT position_count, total_value_usd, max_position_share_bps"
        " FROM agg_filer_concentration WHERE cik = '0000000002'"
    ).fetchone()
    assert covered is not None, "affiliate-suppressed filer lost its concentration row"
    assert covered == (1, 300, 10_000), "book must be the filer's OWN reported one"

    # The issuer-level aggregate still counts the relationship once.
    issuer_total = agg.execute(
        "SELECT COALESCE(SUM(value_usd), 0) FROM agg_issuer_top_holders"
    ).fetchone()[0]
    assert issuer_total == 700, "issuer aggregate must stay deduplicated"


# --- 4. QA-1: the registry must not exclude affiliate-suppressed filers -----


def test_registry_includes_affiliate_suppressed_filer_so_it_gets_a_page(tmp_path):
    """QA-1. The dashboard's getStaticPaths iterates agg_filer_registry, so a
    filer missing from the registry gets NO page at all. Seeding the registry from
    the affiliation-suppressed view meant the very filer whose holdings T5 repaired
    was still unviewable — the F13 fix delivering nothing end-to-end.

    Mutation guard: seeding `filers` from v_default_inst_filings (or moving the
    count accumulation back to the v_default_holdings pass) flips this."""
    from populus.inst_agg import build_inst_agg
    import sqlite3

    conn = _fresh(tmp_path, "registry_qa1.db")
    _seed_affiliate_pair(conn)
    conn.commit()

    out = tmp_path / "agg_qa1.db"
    build_inst_agg(conn, str(out), topn=5, ingested_at=AT)
    agg = sqlite3.connect(str(out))

    rows = {r[0]: r[1] for r in agg.execute(
        "SELECT cik, filer_name FROM agg_filer_registry")}
    assert "0000000002" in rows, "affiliate-suppressed filer has no registry row -> no page"
    assert "0000000001" in rows

    # The NAME must come from the seeded filer set, not the setdefault fallback.
    # Without this the seed-query fix is not load-bearing: pass 2's setdefault
    # would still create the row, but `filer_name` would silently degrade to the
    # bare CIK and the page would render an unnamed filer. (A surviving mutation
    # on the seed query is what exposed this — the first version of this test
    # asserted only membership, i.e. an end state rather than the property.)
    assert rows["0000000002"] == "Covered", (
        f"registry name degraded to the CIK fallback: {rows['0000000002']!r}")
    assert rows["0000000001"] == "Coverer"
    ciks = set(rows)

    # Its registry counts describe its OWN book (1 position, 300), not a
    # deduplicated or truncated one.
    row = agg.execute(
        "SELECT position_count, total_value_usd FROM agg_filer_registry"
        " WHERE cik = '0000000002'"
    ).fetchone()
    assert row == (1, 300)

    # Every filer carrying a concentration row must also carry a registry row,
    # or the page that renders the concentration cannot be generated.
    conc_ciks = {r[0] for r in agg.execute("SELECT DISTINCT cik FROM agg_filer_concentration")}
    assert conc_ciks <= ciks, f"concentration rows with no registry row: {conc_ciks - ciks}"

    # Cross-entity issuer totals stay deduplicated — the relationship counts once.
    assert agg.execute(
        "SELECT COALESCE(SUM(value_usd), 0) FROM agg_issuer_top_holders"
    ).fetchone()[0] == 700
