"""RUN M2-6 — bulk 13F corpus: discovery, ranking, universe, journals,
coordinator, metrics (all hermetic under the autouse no-network guard).

The ranking value is agreement-tested against ``v_default_inst_filings``: for
each amendment topology the pre-ingest effective survivor value MUST equal
Σ ``table_value_total_usd`` over the view after the full lineage is ingested — so
the ranking rule is a proven restatement of the view, never a second merge.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

import bulk_corpus as bc
from bulk_corpus import (
    FilerSpec,
    FilingSpec,
    build_bulk_corpus,
    filer_lineage,
    filer_refs,
    filer_url_map,
)

import populus.inst_bulk as ib
from populus.amendments import ensure_views
from populus.db import connect, init_db
from populus.identity.registry import ensure_registry
from populus.ingest import TransportResponse
from populus.load import ensure_inst_schema
from populus.net.sec_client import SecClient

NOW = "2026-09-30T00:00:00Z"
FIXTURE_FORM_IDX = (
    Path(__file__).parent / "fixtures" / "inst" / "bulk"
    / "full-index" / "2026" / "QTR3" / "form.idx"
)


# --- hermetic wiring ---------------------------------------------------------


class _FakeTransport:
    """Serves committed bytes by URL; records requests; 404 for the unknown.

    ``forbid`` returns 403 for a URL (three consecutive ones latch the SEC
    breaker). ``statuses`` maps a URL to an arbitrary status code with an
    (empty or error-page) body, so the 403/404/5xx transport-failure paths are
    provable without a socket.
    """

    def __init__(self, files, *, forbid=(), statuses=None):
        self.files = dict(files)
        self.requested: list[str] = []
        self._forbid = set(forbid)
        self._statuses = dict(statuses or {})

    def get(self, url, *, headers):
        self.requested.append(url)
        status = self._statuses.get(url)
        if status is not None:
            return TransportResponse(
                status_code=status, headers={}, content=b"<html>error page</html>"
            )
        if url in self._forbid:
            return TransportResponse(status_code=403, headers={}, content=b"")
        content = self.files.get(url)
        if content is None:
            return TransportResponse(status_code=404, headers={}, content=b"")
        return TransportResponse(status_code=200, headers={}, content=content)


def _client(transport):
    clock = iter(range(1, 10_000_000))
    return SecClient(
        transport, contact="test@example.com",
        sleep=lambda _s: None, monotonic=lambda: next(clock),
    )


def _counting_client(files, **kw):
    transport = ib.CountingTransport(_FakeTransport(files, **kw))
    return _client(transport), transport


_DB_SEQ = iter(range(1, 10_000_000))


def _fresh_db(tmp_path):
    path = tmp_path / f"bulk-{next(_DB_SEQ)}.db"
    init_db(str(path))
    conn = connect(str(path))
    ensure_registry(conn)
    ensure_inst_schema(conn)
    ensure_views(conn)
    return conn


def _seed_cusip(conn, cusip):
    sid = f"sec:test:{cusip}"
    conn.execute(
        "INSERT INTO securities (security_id, id_state, review_state)"
        " VALUES (?, 'provisional', 'auto') ON CONFLICT DO NOTHING",
        (sid,),
    )
    conn.execute(
        "INSERT INTO security_identifiers (security_id, id_type, value, valid_from,"
        " valid_to, provenance, confidence, review_state, license_id, raw)"
        " VALUES (?, 'cusip', ?, '2020-01-01', NULL, 'sec-ftd', 'high', 'auto',"
        " 'sec-ftd', NULL)",
        (sid, cusip),
    )


def _mono():
    counter = iter(range(1, 10_000_000))
    return lambda: next(counter)


# --- R1/R2/R12: discovery + parser -------------------------------------------


def test_parse_form_index_keeps_13f_drops_noise_and_counts_rejects():
    text = FIXTURE_FORM_IDX.read_text(encoding="utf-8")
    refs, rejected = ib.parse_form_index(text)
    # 13 filings across seven filers; the 10-K row is out of scope (not a reject).
    assert len(refs) == 13
    assert rejected == []
    forms = {r.form for r in refs}
    assert forms == {"13F-HR", "13F-HR/A"}
    mega = [r for r in refs if r.cik == "0009100001"][0]
    assert mega.accession == "0009100001-26-000001"
    assert mega.accession_nodash == "000910000126000001"
    assert mega.filed_date == "2026-07-05"


def test_parse_form_index_skips_header_and_rejects_malformed_13f():
    text = (
        "Description: junk\n"
        "Form Type   Company Name   CIK   Date Filed  File Name\n"
        "------------------------------------------------------\n"
        "13F-HR   GOOD LLC   9100001   2026-07-05  edgar/data/9100001/0009100001-26-000001.txt\n"
        "13F-HR   BADDATE LLC   9100002   nope   edgar/data/9100002/0009100002-26-000001.txt\n"
        "13F-HR   BADFILE LLC   9100003   2026-07-05  not/a/valid/accession.txt\n"
        "10-K     IGNORED CO   9100004   2026-07-05  edgar/data/9100004/0009100004-26-000001.txt\n"
    )
    refs, rejected = ib.parse_form_index(text)
    assert [r.cik for r in refs] == ["0009100001"]
    assert len(rejected) == 2   # bad date + bad filename; the 10-K is not a reject


def test_parse_form_index_counts_short_13f_rows_as_rejected():
    # A 13F row truncated below the four-column invariant is CORRUPT, not
    # out-of-scope: the form is identified before the structural check so the row
    # lands in `rejected` instead of vanishing from the accounting (F2). A short
    # NON-13F row is still simply out of scope.
    text = (
        "Form Type   Company Name   CIK   Date Filed  File Name\n"
        "------------------------------------------------------\n"
        "13F-HR   GOOD LLC   9100001   2026-07-05  edgar/data/9100001/0009100001-26-000001.txt\n"
        "13F-HR   edgar/data/9100002/0009100002-26-000001.txt\n"
        "13F-HR/A   9100003   edgar/data/9100003/0009100003-26-000001.txt\n"
        "10-K   TRUNCATED CO\n"
    )
    refs, rejected = ib.parse_form_index(text)
    assert [r.accession for r in refs] == ["0009100001-26-000001"]
    assert len(rejected) == 2                      # both short 13F rows counted
    assert all("13F-HR" in line for line in rejected)


@pytest.mark.parametrize("corrupt_filename", [
    "Xedgar/data/9100002/0009100002-26-000001.txt",              # prefixed
    "/Archives/edgar/data/9100002/0009100002-26-000001.txt",     # path-prefixed
    "edgar/data/9100002/0009100002-26-000001.txt.bak",           # suffixed
    "edgar/data/9100002/0009100002-26-000001.txt.gz",            # suffixed
])
def test_parse_form_index_rejects_prefixed_or_suffixed_filenames(corrupt_filename):
    # An unanchored search would find the valid-looking substring inside each of
    # these and admit the filing with an invalid source path; the exact full
    # match rejects them (F2).
    text = (
        "Form Type   Company Name   CIK   Date Filed  File Name\n"
        "------------------------------------------------------\n"
        f"13F-HR   CORRUPT LLC   9100002   2026-07-05  {corrupt_filename}\n"
    )
    refs, rejected = ib.parse_form_index(text)
    assert refs == []
    assert len(rejected) == 1
    assert corrupt_filename in rejected[0]


# --- F1: an acceptable status is required BEFORE decoding or parsing ----------


@pytest.mark.parametrize("status", [403, 404, 500, 503])
def test_discovery_propagates_transport_failure_instead_of_an_empty_universe(status):
    # A 403/404/5xx index response is NOT an index. Decoding it would turn a
    # transient SEC failure into an EMPTY universe — silently removing every
    # filer from the run — so it propagates before the body is touched.
    corpus = build_bulk_corpus()
    client, _t = _counting_client(
        corpus.url_map, statuses={bc.form_index_url(): status}
    )
    with pytest.raises(ib.SecStatusError) as excinfo:
        ib.discover_universe(client, corpus.filing_quarter)
    assert excinfo.value.status_code == status
    assert excinfo.value.url == bc.form_index_url()


_AFTER_RESTATEMENT_COVER = (
    "https://www.sec.gov/Archives/edgar/data/9100003/000910000326000002"
    "/primary_doc.xml"
)


@pytest.mark.parametrize("status", [403, 404, 500, 503])
def test_ranking_propagates_a_transport_failed_cover_and_journals_nothing_for_it(
    status, tmp_path
):
    # A transport failure must never become the terminal `cover_failed` result a
    # resumed sweep would trust: it propagates, and the failed accession has NO
    # journal entry (while the covers that DID parse before it are kept).
    corpus = build_bulk_corpus()
    refs = list(ib.parse_form_index(FIXTURE_FORM_IDX.read_text())[0])
    journal = tmp_path / "rank.json"
    client, _t = _counting_client(
        corpus.url_map, statuses={_AFTER_RESTATEMENT_COVER: status}
    )
    # flush_every=25 means NOTHING has been flushed when the failure lands, so
    # this also proves the sweep flushes the covers that parsed before it.
    with pytest.raises(ib.SecStatusError) as excinfo:
        ib.rank_universe(
            client, refs, corpus.report_period, journal_path=journal, flush_every=25
        )
    assert excinfo.value.status_code == status
    entries = ib.load_journal(
        journal, expected_kind="rank", binding_field="refs_sha256",
        binding_value=ib.refs_sha256(refs, corpus.report_period),
    ).entries
    assert "0009100003-26-000002" not in entries      # never frozen
    assert "0009100001-26-000001" in entries          # earlier work preserved


def test_rank_resume_refetches_a_transport_failed_cover(tmp_path):
    # The resume proof: after a transport-failed sweep, a second sweep over the
    # SAME journal REFETCHES the failed cover (it was never journaled) and does
    # NOT refetch the ones that parsed — and the filer ranks at its true value.
    corpus = build_bulk_corpus()
    refs = list(ib.parse_form_index(FIXTURE_FORM_IDX.read_text())[0])
    journal = tmp_path / "rank.json"
    client1, _t1 = _counting_client(
        corpus.url_map, statuses={_AFTER_RESTATEMENT_COVER: 503}
    )
    with pytest.raises(ib.SecStatusError):
        ib.rank_universe(
            client1, refs, corpus.report_period, journal_path=journal, flush_every=25
        )

    client2, t2 = _counting_client(corpus.url_map)
    rank = ib.rank_universe(
        client2, refs, corpus.report_period, journal_path=journal, flush_every=25
    )
    requested = t2._inner.requested
    assert _AFTER_RESTATEMENT_COVER in requested        # refetched, not frozen
    assert not any(u.endswith("000910000126000001/primary_doc.xml")
                   for u in requested)                 # journaled cover reused
    values = {r.cik: r.effective_value_usd for r in rank.ranked}
    assert values["0009100003"] == bc.EXPECTED_EFFECTIVE["0009100003"]
    assert rank.rank_failed == ()                      # no frozen cover_failed


def test_discover_universe_fetches_the_form_index_url():
    corpus = build_bulk_corpus()
    client, transport = _counting_client(corpus.url_map)
    result = ib.discover_universe(client, corpus.filing_quarter)
    assert result.url == bc.form_index_url()
    assert bc.form_index_url() in transport._inner.requested
    assert len(result.refs) == 13


def test_inst_bulk_imports_no_http_library():
    import populus.inst_bulk as module

    source = Path(module.__file__).read_text(encoding="utf-8")
    assert "import httpx" not in source
    assert "import requests" not in source


# --- R3/F1: ranking agreement against v_default_inst_filings ------------------

# Each case: (label, filings, expected_effective_value). The value is asserted
# BOTH against a constant AND against Σ table_value_total_usd over v_default
# after ingesting the full lineage — proving the ranking rule matches the view.
_AGREEMENT_CASES = {
    "base_only": (
        [FilingSpec(1, "13F-HR", "2026-07-05", bc.REPORT_PERIOD, 900_000_000, "911000010")],
        900_000_000,
    ),
    "new_holdings_only": (
        [
            FilingSpec(1, "13F-HR", "2026-07-05", bc.REPORT_PERIOD, 80_000_000, "911000051"),
            FilingSpec(2, "13F-HR/A", "2026-08-05", bc.REPORT_PERIOD, 40_000_000, "911000052",
                       "NEW HOLDINGS", 1),
        ],
        120_000_000,
    ),
    "restatement": (
        [
            FilingSpec(1, "13F-HR", "2026-07-05", bc.REPORT_PERIOD, 100_000_000, "911000021"),
            FilingSpec(2, "13F-HR/A", "2026-08-05", bc.REPORT_PERIOD, 500_000_000, "911000022",
                       "RESTATEMENT", 1),
        ],
        500_000_000,
    ),
    "new_holdings_before_restatement": (
        [
            FilingSpec(1, "13F-HR", "2026-07-05", bc.REPORT_PERIOD, 100_000_000, "911000041"),
            FilingSpec(2, "13F-HR/A", "2026-08-01", bc.REPORT_PERIOD, 20_000_000, "911000042",
                       "NEW HOLDINGS", 1),
            FilingSpec(3, "13F-HR/A", "2026-09-01", bc.REPORT_PERIOD, 200_000_000, "911000043",
                       "RESTATEMENT", 2),
        ],
        200_000_000,
    ),
    "new_holdings_after_restatement": (
        [
            FilingSpec(1, "13F-HR", "2026-07-05", bc.REPORT_PERIOD, 100_000_000, "911000031"),
            FilingSpec(2, "13F-HR/A", "2026-08-05", bc.REPORT_PERIOD, 300_000_000, "911000032",
                       "RESTATEMENT", 1),
            FilingSpec(3, "13F-HR/A", "2026-09-05", bc.REPORT_PERIOD, 50_000_000, "911000033",
                       "NEW HOLDINGS", 2),
        ],
        350_000_000,
    ),
    "mixed": (
        [
            FilingSpec(1, "13F-HR", "2026-07-05", bc.REPORT_PERIOD, 100_000_000, "911000081"),
            FilingSpec(2, "13F-HR/A", "2026-07-20", bc.REPORT_PERIOD, 30_000_000, "911000082",
                       "NEW HOLDINGS", 1),
            FilingSpec(3, "13F-HR/A", "2026-08-20", bc.REPORT_PERIOD, 400_000_000, "911000083",
                       "RESTATEMENT", 2),
            FilingSpec(4, "13F-HR/A", "2026-09-20", bc.REPORT_PERIOD, 60_000_000, "911000084",
                       "NEW HOLDINGS", 3),
        ],
        # base + NH-before superseded by the restatement; restatement + NH-after survive.
        460_000_000,
    ),
}


def _v_default_value(conn, cik, period):
    return conn.execute(
        "SELECT COALESCE(SUM(table_value_total_usd), 0) FROM v_default_inst_filings"
        " WHERE cik = ? AND period_of_report = ?",
        (cik, period),
    ).fetchone()[0]


def _ingest_filer(conn, filer, url_map, *, resume=False):
    from populus.ingest.inst13f import run_inst13f_ingest

    client, _t = _counting_client(url_map)
    return run_inst13f_ingest(
        conn, run_id=f"seam-{filer.cik}", now=lambda: NOW, host="h",
        ingested_at=NOW, ciks=[filer.cik], accessions=filer_lineage(filer),
        report_period=bc.REPORT_PERIOD, run_passes=True, resume=resume,
        client=client, raw_root=conn_raw(conn),
    )


def conn_raw(conn):
    # A throwaway raw root per connection (live source archives here).
    import tempfile

    return Path(tempfile.mkdtemp(prefix="bulk-raw-"))


@pytest.mark.parametrize("label", sorted(_AGREEMENT_CASES))
def test_ranking_value_matches_v_default_survivor_set(label, tmp_path):
    filings, expected = _AGREEMENT_CASES[label]
    filer = FilerSpec("0009109999", f"CASE {label.upper()}", tuple(filings))
    url_map = filer_url_map(filer)

    # Pre-ingest ranking value.
    client, _t = _counting_client(url_map)
    rank = ib.rank_universe(client, filer_refs(filer), bc.REPORT_PERIOD)
    assert len(rank.ranked) == 1
    effective = rank.ranked[0].effective_value_usd
    assert effective == expected, f"{label}: ranking value"

    # Post-ingest v_default value over the full lineage.
    conn = _fresh_db(tmp_path)
    for spec in filings:
        _seed_cusip(conn, spec.cusip)
    _ingest_filer(conn, filer, url_map)
    view_value = _v_default_value(conn, filer.cik, bc.REPORT_PERIOD)
    conn.close()
    assert effective == view_value, f"{label}: ranking value == v_default value"


def test_ranking_usd_conversion_respects_the_filed_date_era(tmp_path):
    # A pre-2023 filing reports thousands; a post-2023 one whole dollars. The
    # ranking USD conversion keys on filed_date exactly like the ingest, so both
    # must agree with v_default after ingest.
    pre = FilerSpec("0009108001", "PRE ERA", (
        FilingSpec(1, "13F-HR", "2022-11-14", bc.REPORT_PERIOD, 15_000, "911000901"),
    ))
    post = FilerSpec("0009108002", "POST ERA", (
        FilingSpec(1, "13F-HR", "2026-07-14", bc.REPORT_PERIOD, 15_000, "911000902"),
    ))
    for filer, expected in ((pre, 15_000_000), (post, 15_000)):
        url_map = filer_url_map(filer)
        client, _t = _counting_client(url_map)
        rank = ib.rank_universe(client, filer_refs(filer), bc.REPORT_PERIOD)
        assert rank.ranked[0].effective_value_usd == expected
        conn = _fresh_db(tmp_path)
        _seed_cusip(conn, filer.filings[0].cusip)
        _ingest_filer(conn, filer, url_map)
        assert _v_default_value(conn, filer.cik, bc.REPORT_PERIOD) == expected
        conn.close()


def test_ranking_drops_wrong_report_period_and_excludes_unparseable_cover():
    corpus = build_bulk_corpus()
    client, _t = _counting_client(corpus.url_map)
    result = ib.discover_universe(client, corpus.filing_quarter)
    rank = ib.rank_universe(client, result.refs, corpus.report_period)
    # WRONG PERIOD CO (period 2026-03-31) never appears despite its 999M value.
    assert "0009100007" not in {r.cik for r in rank.ranked}
    # A filer whose cover 404s (unparseable) is rank_failed, not misranked.
    broken = dict(corpus.url_map)
    base = "https://www.sec.gov/Archives/edgar/data/9100001/000910000126000001"
    broken[f"{base}/primary_doc.xml"] = b"<not-xml"
    client2, _t2 = _counting_client(broken)
    refs = ib.discover_universe(client2, corpus.filing_quarter).refs
    rank2 = ib.rank_universe(client2, refs, corpus.report_period)
    assert "0009100001" in rank2.rank_failed
    assert "0009100001" not in {r.cik for r in rank2.ranked}


def test_select_top_n_cuts_below_the_smallest_filers():
    corpus = build_bulk_corpus()
    client, _t = _counting_client(corpus.url_map)
    refs = ib.discover_universe(client, corpus.filing_quarter).refs
    rank = ib.rank_universe(client, refs, corpus.report_period)
    universe = ib.select_top_n(rank, corpus.filing_quarter, corpus.report_period, 5)
    assert list(universe.ciks) == [
        "0009100001", "0009100002", "0009100003", "0009100004", "0009100005",
    ]
    # SMALL FRY LP (10M) is ranked but beyond N.
    assert "0009100006" in {r.cik for r in rank.ranked}
    assert "0009100006" not in universe.ciks


def test_full_lineage_target_avoids_amendment_unlinked(tmp_path):
    # Ingesting ONLY the surviving restatement without its base reproduces the
    # amendment_unlinked flag; ingesting the complete lineage does not — proving
    # the universe must carry the whole lineage.
    filer = FilerSpec("0009107001", "LINEAGE", (
        FilingSpec(1, "13F-HR", "2026-07-05", bc.REPORT_PERIOD, 100_000_000, "911000701"),
        FilingSpec(2, "13F-HR/A", "2026-08-05", bc.REPORT_PERIOD, 500_000_000, "911000702",
                   "RESTATEMENT", 1),
    ))
    url_map = filer_url_map(filer)
    from populus.ingest.inst13f import run_inst13f_ingest

    # Survivor-only (drop the base from the allowlist).
    conn = _fresh_db(tmp_path)
    _seed_cusip(conn, "911000702")
    client, _t = _counting_client(url_map)
    run_inst13f_ingest(
        conn, run_id="lin-partial", now=lambda: NOW, host="h", ingested_at=NOW,
        ciks=[filer.cik], accessions={"0009107001-26-000002"},
        report_period=bc.REPORT_PERIOD, run_passes=True, resume=False,
        client=client, raw_root=tmp_path / "raw1",
    )
    flags = json.loads(conn.execute(
        "SELECT flags FROM inst_filings WHERE accession = '0009107001-26-000002'"
    ).fetchone()[0])
    assert "amendment_unlinked" in flags
    conn.close()

    # Full lineage → linked.
    conn2 = _fresh_db(tmp_path)
    _seed_cusip(conn2, "911000701")
    _seed_cusip(conn2, "911000702")
    _ingest_filer(conn2, filer, url_map)
    flags2 = json.loads(conn2.execute(
        "SELECT flags FROM inst_filings WHERE accession = '0009107001-26-000002'"
    ).fetchone()[0])
    assert "amendment_unlinked" not in flags2
    conn2.close()


# --- R17/F4: universe + two-journal binding ----------------------------------


def test_universe_write_load_roundtrip_and_digest_mismatch(tmp_path):
    corpus = build_bulk_corpus()
    client, _t = _counting_client(corpus.url_map)
    refs = ib.discover_universe(client, corpus.filing_quarter).refs
    rank = ib.rank_universe(client, refs, corpus.report_period)
    universe = ib.select_top_n(rank, corpus.filing_quarter, corpus.report_period, 5)
    path = tmp_path / "universe.json"
    ib.write_universe(path, universe)
    loaded = ib.load_universe(path)
    assert loaded.universe_sha256 == universe.universe_sha256
    assert loaded.ciks == universe.ciks
    # Tamper with an entry without fixing the digest → rejected.
    payload = json.loads(path.read_text())
    payload["entries"][0]["effective_value_usd"] += 1
    path.write_text(json.dumps(payload))
    with pytest.raises(ib.UniverseError):
        ib.load_universe(path)


def test_rank_journal_binds_to_refs_sha256(tmp_path):
    corpus = build_bulk_corpus()
    client, _t = _counting_client(corpus.url_map)
    refs = ib.discover_universe(client, corpus.filing_quarter).refs
    journal = tmp_path / "rank.json"
    ib.rank_universe(client, refs, corpus.report_period, journal_path=journal, flush_every=1)
    # A load bound to a DIFFERENT refs digest is rejected (source truth changed).
    with pytest.raises(ib.JournalError):
        ib.load_journal(
            journal, expected_kind="rank",
            binding_field="refs_sha256", binding_value="deadbeef",
        )


def test_rank_journal_resume_skips_already_fetched_covers(tmp_path):
    corpus = build_bulk_corpus()
    refs = list(ib.parse_form_index(FIXTURE_FORM_IDX.read_text())[0])
    journal = tmp_path / "rank.json"
    client1, t1 = _counting_client(corpus.url_map)
    ib.rank_universe(client1, refs, corpus.report_period, journal_path=journal, flush_every=1)
    first_attempts = t1.attempts
    assert first_attempts > 0
    # A second sweep with the SAME journal fetches zero covers (all journaled).
    client2, t2 = _counting_client(corpus.url_map)
    ib.rank_universe(client2, refs, corpus.report_period, journal_path=journal)
    assert t2.attempts == 0


@pytest.mark.parametrize("kind,binding_field,other_field", [
    ("rank", "refs_sha256", "universe_sha256"),
    ("ingest", "universe_sha256", "refs_sha256"),
])
def test_journal_rejects_corrupt_unknown_version_duplicate_and_mismatch(
    tmp_path, kind, binding_field, other_field
):
    path = tmp_path / f"{kind}.json"
    good = {"a": {"x": 1}, "b": {"y": 2}}
    ib.write_journal(path, kind=kind, binding_field=binding_field,
                     binding_value="digest-1", entries=good)
    # Round-trips.
    doc = ib.load_journal(path, expected_kind=kind,
                          binding_field=binding_field, binding_value="digest-1")
    assert doc.entries == good

    # Binding mismatch.
    with pytest.raises(ib.JournalError):
        ib.load_journal(path, expected_kind=kind,
                        binding_field=binding_field, binding_value="digest-2")
    # Wrong kind.
    with pytest.raises(ib.JournalError):
        ib.load_journal(path, expected_kind=other_field.split("_")[0],
                        binding_field=binding_field, binding_value="digest-1")

    raw = json.loads(path.read_text())
    # Unknown version.
    bad = dict(raw, version=999)
    path.write_text(json.dumps(bad))
    with pytest.raises(ib.JournalError):
        ib.load_journal(path, expected_kind=kind,
                        binding_field=binding_field, binding_value="digest-1")
    # Duplicate entry key.
    dup = dict(raw, entries=[{"key": "a", "value": 1}, {"key": "a", "value": 2}])
    path.write_text(json.dumps(dup))
    with pytest.raises(ib.JournalError):
        ib.load_journal(path, expected_kind=kind,
                        binding_field=binding_field, binding_value="digest-1")
    # Corrupt JSON.
    path.write_text("{not json")
    with pytest.raises(ib.JournalError):
        ib.load_journal(path, expected_kind=kind,
                        binding_field=binding_field, binding_value="digest-1")


def test_missing_journal_is_an_empty_fresh_start(tmp_path):
    doc = ib.load_journal(tmp_path / "absent.json", expected_kind="ingest",
                          binding_field="universe_sha256", binding_value="d")
    assert doc.entries == {} and doc.meta == {}


# --- R5/R6/F3: coordinator + disposition state table -------------------------


_RUN_SEQ = iter(range(1, 10_000_000))


def _run_bulk(conn, universe, url_map, *, journal_path=None, forbid=(), raw_root=None):
    transport = ib.CountingTransport(_FakeTransport(url_map, forbid=forbid))
    client = _client(transport)
    import tempfile

    # A fresh run_id per session, exactly as the CLI mints a uuid per invocation
    # (the per-CIK ingest_runs row is keyed on it, so a resume must not collide).
    return ib.run_bulk_ingest(
        conn, universe, client=client, transport=transport,
        raw_root=raw_root or Path(tempfile.mkdtemp(prefix="bulk-run-")),
        run_id=f"bulk-{next(_RUN_SEQ)}", now=lambda: NOW, host="h", ingested_at=NOW,
        monotonic=_mono(), journal_path=journal_path,
    ), transport


def _built_universe(corpus, top_n=5):
    client, _t = _counting_client(corpus.url_map)
    refs = ib.discover_universe(client, corpus.filing_quarter).refs
    rank = ib.rank_universe(client, refs, corpus.report_period)
    return ib.select_top_n(rank, corpus.filing_quarter, corpus.report_period, top_n)


def test_coordinator_loads_all_filers_and_reconciles(tmp_path):
    corpus = build_bulk_corpus()
    conn = _fresh_db(tmp_path)
    for c in corpus.cusips:
        _seed_cusip(conn, c)
    universe = _built_universe(corpus)
    report, _t = _run_bulk(conn, universe, corpus.url_map)
    conn.close()
    assert report.ok and report.reconciled
    assert report.loaded_filers == 5
    assert report.finalized and report.coverage.meets_threshold
    assert all(d == "loaded" for d in
               [r.disposition for r in report.results])
    # Every target accession accounted parsed/partial in the per-accession map.
    for r in report.results:
        assert set(r.per_accession.values()) <= {"parsed", "partial"}


def test_per_accession_map_classifies_absent_and_partial_lineage(tmp_path):
    # Drop one amendment document from the served map so its accession is present
    # in submissions but its docs 404 → a failed target → partial_lineage.
    corpus = build_bulk_corpus()
    conn = _fresh_db(tmp_path)
    for c in corpus.cusips:
        _seed_cusip(conn, c)
    universe = _built_universe(corpus)
    partial_map = dict(corpus.url_map)
    # AFTER HOLDINGS amendment #3 (a NEW_HOLDINGS): remove its table + cover so it
    # fails to load, leaving the base + restatement loaded → mixed lineage.
    base = "https://www.sec.gov/Archives/edgar/data/9100003/000910000326000003"
    for suffix in ("/primary_doc.xml", "/index.json", "/tbl_0003_3.xml"):
        partial_map.pop(base + suffix, None)
    report, _t = _run_bulk(conn, universe, partial_map)
    conn.close()
    after = [r for r in report.results if r.cik == "0009100003"][0]
    assert after.disposition == "failed:partial_lineage"
    assert "0009100003-26-000003" in after.per_accession
    # base + restatement loaded, amendment #3 failed (cover 404 → cover_failed).
    assert after.parsed_count == 2
    # Reconciliation still holds on the partial run.
    assert report.reconciled


def test_absent_target_is_classified_not_dropped(tmp_path):
    # A universe lineage that names an accession not present in submissions →
    # 'absent' in the per-accession map, and the filer is failed(partial_lineage).
    corpus = build_bulk_corpus()
    conn = _fresh_db(tmp_path)
    for c in corpus.cusips:
        _seed_cusip(conn, c)
    base_universe = _built_universe(corpus)
    # Inject a phantom target into MEGA's lineage.
    from populus.inst_bulk import RankedFiler, Universe, _universe_body, _digest
    entries = list(base_universe.entries)
    mega = entries[0]
    entries[0] = RankedFiler(
        rank=mega.rank, cik=mega.cik, effective_value_usd=mega.effective_value_usd,
        period_of_report=mega.period_of_report,
        lineage=mega.lineage + ("0009100001-26-000099",),
    )
    body = _universe_body(base_universe.filing_quarter, base_universe.report_period,
                          base_universe.top_n, entries)
    universe = Universe(base_universe.filing_quarter, base_universe.report_period,
                        base_universe.top_n, tuple(entries), _digest(body))
    report, _t = _run_bulk(conn, universe, corpus.url_map)
    conn.close()
    mega_result = [r for r in report.results if r.cik == "0009100001"][0]
    assert mega_result.per_accession["0009100001-26-000099"] == "absent"
    assert mega_result.disposition == "failed:partial_lineage"


def test_period_mismatch_target_is_recorded_not_loaded(tmp_path):
    # A target whose cover period differs from the locked report_period is a
    # period_mismatch — recorded, never loaded.
    filer = FilerSpec("0009106001", "MISMATCH", (
        FilingSpec(1, "13F-HR", "2026-07-05", "2026-03-31", 50_000_000, "911000601"),
    ))
    from populus.ingest.inst13f import run_inst13f_ingest

    conn = _fresh_db(tmp_path)
    _seed_cusip(conn, "911000601")
    client, _t = _counting_client(filer_url_map(filer))
    report = run_inst13f_ingest(
        conn, run_id="mm", now=lambda: NOW, host="h", ingested_at=NOW,
        ciks=[filer.cik], accessions={"0009106001-26-000001"},
        report_period="2026-06-30", run_passes=True, resume=False,
        client=client, raw_root=tmp_path / "raw",
    )
    assert report.period_mismatched == ("0009106001-26-000001",)
    assert conn.execute("SELECT COUNT(*) FROM inst_filings").fetchone()[0] == 0
    conn.close()


def test_breaker_trip_stops_run_and_marks_pending(tmp_path):
    corpus = build_bulk_corpus()
    conn = _fresh_db(tmp_path)
    for c in corpus.cusips:
        _seed_cusip(conn, c)
    universe = _built_universe(corpus)
    # Forbid RESTATE PARTNERS' archive documents (rank 2), leaving its
    # submissions readable: index/cover/index across its two accessions produce
    # three consecutive 403s that latch the client-wide breaker, so the run STOPS
    # and later filers are pending.
    forbid = {u for u in corpus.url_map if "/9100002/" in u}
    report, _t = _run_bulk(conn, universe, corpus.url_map, forbid=forbid)
    conn.close()
    assert report.circuit_open_url is not None
    assert not report.finalized     # finalize deferred on a circuit stop
    dispositions = {r.cik: r.disposition for r in report.results}
    assert dispositions["0009100001"] == "loaded"          # rank 1 loaded first
    assert dispositions["0009100002"] == "circuit_open"     # tripped here
    assert dispositions["0009100003"] == "pending"          # unreached
    assert dispositions["0009100004"] == "pending"
    assert report.reconciled       # every universe CIK still accounted for


def test_resume_after_breaker_completes_the_run(tmp_path):
    corpus = build_bulk_corpus()
    conn = _fresh_db(tmp_path)
    for c in corpus.cusips:
        _seed_cusip(conn, c)
    universe = _built_universe(corpus)
    journal = tmp_path / "ingest.json"
    raw = tmp_path / "raw"
    forbid = {u for u in corpus.url_map if "/9100002/" in u}
    first, _t = _run_bulk(conn, universe, corpus.url_map,
                          journal_path=journal, forbid=forbid, raw_root=raw)
    assert first.circuit_open_url is not None
    # Resume with the block lifted and the SAME journal → completes, MEGA skipped
    # as already-done, the rest loaded.
    second, _t2 = _run_bulk(conn, universe, corpus.url_map,
                            journal_path=journal, raw_root=raw)
    conn.close()
    dispositions = {r.cik: r.disposition for r in second.results}
    assert dispositions["0009100001"] == "already-done"
    assert second.loaded_filers >= 4
    assert second.finalized and second.reconciled and second.ok


def test_ingest_error_is_persisted_and_run_continues(tmp_path, monkeypatch):
    corpus = build_bulk_corpus()
    conn = _fresh_db(tmp_path)
    for c in corpus.cusips:
        _seed_cusip(conn, c)
    universe = _built_universe(corpus)
    real = ib.run_inst13f_ingest
    calls = {"n": 0}

    def flaky(*args, **kwargs):
        calls["n"] += 1
        if kwargs.get("ciks") == ["0009100002"]:
            raise RuntimeError("boom")
        return real(*args, **kwargs)

    monkeypatch.setattr(ib, "run_inst13f_ingest", flaky)
    report, _t = _run_bulk(conn, universe, corpus.url_map)
    conn.close()
    dispositions = {r.cik: r.disposition for r in report.results}
    assert dispositions["0009100002"] == "ingest_error:RuntimeError"
    assert dispositions["0009100003"] == "loaded"   # run continued
    assert report.reconciled
    assert not report.ok                            # an unexpected error flips ok


# --- R14/F5: metrics ----------------------------------------------------------


def test_metrics_count_transport_and_accumulate_across_resume(tmp_path):
    corpus = build_bulk_corpus()
    conn = _fresh_db(tmp_path)
    for c in corpus.cusips:
        _seed_cusip(conn, c)
    universe = _built_universe(corpus)
    journal = tmp_path / "ingest.json"
    raw = tmp_path / "raw"
    forbid = {u for u in corpus.url_map if "/9100002/" in u}
    first, t1 = _run_bulk(conn, universe, corpus.url_map,
                          journal_path=journal, forbid=forbid, raw_root=raw)
    assert first.session_metrics["attempts"] == t1.attempts
    assert first.session_metrics["breaker_events"] == 1
    session1_attempts = first.session_metrics["attempts"]
    second, t2 = _run_bulk(conn, universe, corpus.url_map,
                           journal_path=journal, raw_root=raw)
    conn.close()
    # Cumulative attempts across the two sessions exceed either alone; sessions=2.
    assert second.cumulative_metrics["sessions"] == 2
    assert second.cumulative_metrics["attempts"] == session1_attempts + t2.attempts


def test_counting_transport_separates_retries_and_304s():
    class Inner:
        def __init__(self, statuses):
            self._statuses = iter(statuses)

        def get(self, url, *, headers):
            return TransportResponse(
                status_code=next(self._statuses), headers={}, content=b"x"
            )

    transport = ib.CountingTransport(Inner([200, 503, 304, 429]))
    for _ in range(4):
        transport.get("https://www.sec.gov/x", headers={})
    assert transport.attempts == 4
    assert transport.retries == 2       # 503 + 429
    assert transport.not_modified == 1  # 304


# --- R11/R12: CLI (hermetic via a monkeypatched client factory) --------------


def test_cli_inst_bulk_discover_then_ingest(tmp_path, monkeypatch):
    from click.testing import CliRunner

    from populus import cli

    corpus = build_bulk_corpus()

    def fake_factory():
        transport = ib.CountingTransport(_FakeTransport(corpus.url_map))
        return _client(transport), transport

    monkeypatch.setattr(cli, "_live_bulk_client", fake_factory)
    runner = CliRunner()
    out_dir = tmp_path / "ops"

    discover = runner.invoke(cli.main, [
        "inst-bulk", "discover",
        "--filing-quarter", "2026q3",
        "--report-period", "2026-06-30",
        "--out", str(out_dir),
        "--top-n", "5",
    ])
    assert discover.exit_code == 0, discover.output
    assert "selected 5" in discover.output
    universe_file = out_dir / "universe-2026-06-30.json"
    assert universe_file.exists()
    assert (out_dir / "rank-journal-2026q3.json").exists()

    db = str(tmp_path / "cli.db")
    init_db(db)
    conn = connect(db)
    for c in corpus.cusips:
        _seed_cusip(conn, c)
    conn.commit()
    conn.close()

    ingest = runner.invoke(cli.main, [
        "inst-bulk", "ingest",
        "--db", db,
        "--universe", str(universe_file),
        "--raw-root", str(tmp_path / "raw"),
        "--out", str(out_dir),
    ])
    assert ingest.exit_code == 0, ingest.output
    assert "loaded 5" in ingest.output
    assert "value-coverage:" in ingest.output
    assert (out_dir / "ingest-journal-2026-06-30.json").exists()


def test_cli_inst_bulk_discover_rejects_bad_report_period(tmp_path):
    from click.testing import CliRunner

    from populus import cli

    result = CliRunner().invoke(cli.main, [
        "inst-bulk", "discover",
        "--filing-quarter", "2026q3",
        "--report-period", "2026-6-30",       # not canonical YYYY-MM-DD
        "--out", str(tmp_path / "ops"),
    ])
    assert result.exit_code != 0
    assert "canonical YYYY-MM-DD" in result.output


# --- R16/F8: deferral seam benchmark -----------------------------------------


def test_finalize_runs_each_global_pass_once_regardless_of_n(tmp_path, monkeypatch):
    # The number of global post-passes is independent of N: the coordinator runs
    # finalize ONCE no matter how many filers it drove.
    from populus.ingest import inst13f

    counts = {"link": 0, "affiliate": 0, "coverage": 0, "invariant": 0}
    for name, key in (("link_inst_amendments", "link"),
                      ("mark_affiliated_coverage", "affiliate"),
                      ("compute_coverage", "coverage"),
                      ("inst_pair_invariant_errors", "invariant")):
        real = getattr(inst13f, name)

        def wrap(conn, _real=real, _key=key):
            counts[_key] += 1
            return _real(conn)

        monkeypatch.setattr(inst13f, name, wrap)

    corpus = build_bulk_corpus()
    conn = _fresh_db(tmp_path)
    for c in corpus.cusips:
        _seed_cusip(conn, c)
    universe = _built_universe(corpus)      # five filers
    _run_bulk(conn, universe, corpus.url_map)
    conn.close()
    # Five filers driven, but each global pass ran exactly once (deferred finalize).
    assert counts == {"link": 1, "affiliate": 1, "coverage": 1, "invariant": 1}


# --- KI-4 / B1: the bulk summary renders unmeasurable coverage honestly ------


def test_bulk_summary_renders_unmeasurable_coverage_with_raw_sums():
    # S2: `unmeasurable` — never N/A, 0%, or 100% — with the raw sums beside it
    # for diagnosis (R5/R3).
    from populus.ingest.inst13f import InstCoverage
    from populus.inst_bulk import BulkReport, format_bulk_summary

    coverage = InstCoverage(denominator=1_000_000, numerator=1_500_000,
                            cover_failed_count=1, inflated_filing_count=0,
                            coverage=None, certifiable=False,
                            meets_threshold=False)
    text = format_bulk_summary(
        BulkReport(run_id="r", filing_quarter="2026q1",
                   report_period="2026-03-31", universe_size=0,
                   coverage=coverage)
    )
    assert "value-coverage: 1500000 / 1000000 = unmeasurable" in text
    for forbidden in ("N/A", "0.00%", "100.00%", "150.00%"):
        assert forbidden not in text, forbidden


def test_bulk_summary_renders_a_measurable_ratio_exactly():
    # S2 measurable arm: units and precision (percent, 2 decimals) are
    # byte-identical to the pre-fix output.
    from populus.ingest.inst13f import InstCoverage
    from populus.inst_bulk import BulkReport, format_bulk_summary

    coverage = InstCoverage(denominator=10_000_000, numerator=9_996_000,
                            cover_failed_count=0, inflated_filing_count=0,
                            coverage=0.9996, certifiable=True,
                            meets_threshold=True)
    text = format_bulk_summary(
        BulkReport(run_id="r", filing_quarter="2026q1",
                   report_period="2026-03-31", universe_size=0,
                   coverage=coverage)
    )
    assert "value-coverage: 9996000 / 10000000 = 99.96%" in text
