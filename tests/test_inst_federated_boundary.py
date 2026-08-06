"""RUN M2-8 T9 (plan R10, R17) — the retained federated boundary, both sides.

`M2-CONTRACT.md` §3.1 is normative: after the 2026-08-01 reversal the per-filer
holdings detail is PUBLISHED, and live EDGAR remains the path for exactly two
cases — a filing newer than the published build, and a filer/period outside the
published universe. Before M2-8, `inst_filer_holdings(mode='detail')` federated
for *any* period; that is what these tests narrow.

Both sides are asserted, because only one of them is self-evident:

  * inside the universe — the answer comes from `inst_serving.db` and the SEC
    transport is never touched (the transport here RAISES if it is, on top of
    the autouse socket guard, so "no network" is proved rather than assumed);
  * outside it — the live path is taken, and the response says WHICH of the two
    §3.1 cases sent it there.

The third state is the dangerous one and has its own tests: when the serving
artifact is missing, the boundary cannot be evaluated at all. The live path
stays open — it is the only answer left — but nothing may pretend the request
was *found* to be off-universe, and the cross-filer aggregate is never accepted
in the per-filer projection's place (it answers a different question at a
different grain).

No test opens a socket; every artifact is built in a tmp dir from committed
fixtures.
"""

from __future__ import annotations

import hashlib
import json
import sqlite3
from datetime import timedelta
from pathlib import Path

import pytest

# Reuse the vetted M2-4 corpus + envelope helpers and the RUN-5 publish helpers;
# neither is forked.
from test_mcp_server_inst import (
    AT,
    BRK,
    MCP_TICKERS,
    MERGE_AMENDMENT_NODASH,
    MERGE_BASE_NODASH,
    OTHER,
    REAL_DIR,
    _assert_inst_envelope,
    _call,
    _clock_client,
    _detail_url_map,
    _seed_source,
    _now,
)
from test_inst_ingest import _FakeSecTransport
from test_publish import NOW, make_repo, pin, publish_build, seed_db

from populus.inst_serving import SERVING_SCHEMA
from populus.amendments import ensure_views
from populus.client.snapshot import LocalRepoFetcher, SnapshotClient
from populus.db import connect, init_db
from populus.inst_agg import build_inst_agg
from populus.mcp_server.server import build_server
from populus.net.sec_client import SecClient
from populus.publish.manifest import (
    INST_CLIENT_COMPAT,
    INST_DB_ARTIFACT,
    INST_SCHEMA_VERSION,
    INST_SERVING_ARTIFACT,
)
from populus.publish.pointer import build_pointer, render_pointer

# The two periods the deterministic corpus publishes for BRK. OD-5 browsable
# geometry: a current and a prior period, both in the projection.
CURR = "2026-03-31"
PRIOR = "2025-12-31"
# Newer than anything the build covers → §3.1 case 1.
POST_BUILD = "2026-06-30"
# Older than anything the build covers → §3.1 case 2 (a period not yet
# ingested), NOT case 1. The distinction is the whole point of having two.
PRE_BUILD = "2025-06-30"
# A CIK the published universe has never heard of → §3.1 case 2.
UNKNOWN_CIK = "0004242424"


# --- the published serving projection ----------------------------------------
#
# The producer half (`publish/`, task T8) writes this file; these tests build it
# to the same consumer contract the server reads — table names plus the row keys
# `inst_serving.build_serving_projection` already emits.

# The producer's OWN schema, imported — never hand-copied. QA M2-8 M10: this
# block used to be a transcription of `SERVING_SCHEMA`, so renaming
# `serving_filer_rows.shares` -> `ssh_prnamt` in the producer broke production
# and passed every Python test here, while `_SERVING_DETAIL_SQL` names 17
# columns that `server.py` calls "the whole coupling surface" of table NAMES
# alone. The TypeScript side already did this correctly (it regex-extracts
# `SERVING_SCHEMA` from the Python source and prepares the real `.astro`
# queries against it); this is the Python side catching up.
_SCHEMA = SERVING_SCHEMA

#: (filing_key, accession, submission_type, period, filed_date, doc_url).
#: BRK's current period is composed from a base filing AND a later NEW-HOLDINGS
#: amendment, so the two filed dates differ — a row restamped with the wrong
#: one would misreport when that position was disclosed (G4).
_FILINGS = [
    (0, "0001193125-26-054580", "13F-HR", PRIOR, "2026-02-14",
     "https://www.sec.gov/Archives/edgar/data/1067983/brk-2025q4.xml"),
    (1, "0001193125-26-226661", "13F-HR", CURR, "2026-05-15",
     "https://www.sec.gov/Archives/edgar/data/1067983/brk-2026q1.xml"),
    (2, "0000950123-26-009999", "13F-HR/A", CURR, "2026-06-02",
     "https://www.sec.gov/Archives/edgar/data/1067983/brk-2026q1-a.xml"),
]

#: (cik, period, filing_key, security_id, cusip, issuer, value_usd, shares).
_HOLDINGS = [
    (BRK, PRIOR, 0, "sec:aapl", "037833100", "APPLE INC", 1000, 100),
    (BRK, PRIOR, 0, "sec:msft", "594918104", "MICROSOFT CORP", 500, 50),
    (BRK, CURR, 1, "sec:aapl", "037833100", "APPLE INC", 2000, 150),
    (BRK, CURR, 1, "sec:nvda", "67066G104", "NVIDIA CORP", 300, 30),
    # Disclosed only by the amendment — its own filed date, not the base's.
    (BRK, CURR, 2, "sec:msft", "594918104", "MICROSOFT CORP", 900, 60),
    # A second published filer, so "the universe" is never one filer wide.
    (OTHER, CURR, 1, "sec:aapl", "037833100", "APPLE INC", 800, 40),
]


def write_serving_db(path: Path) -> Path:
    """A published per-filer projection over the deterministic corpus."""
    conn = sqlite3.connect(str(path))
    try:
        conn.executescript(_SCHEMA)
        conn.executemany(
            "INSERT INTO serving_filings (filing_key, accession, submission_type,"
            " period_of_report, filed_date, doc_url, source)"
            " VALUES (?, ?, ?, ?, ?, ?, 'sec-edgar')",
            _FILINGS,
        )
        # Values that satisfy the PRODUCER's constraints, because the schema above
        # IS the producer's. The hand copy this replaced declared `issuer_name
        # TEXT` and left `flags` / `put_call_bucket` / `unit_key` nullable, so the
        # fixture wrote NULL into three columns the real artifact declares NOT
        # NULL — a permissive transcription that could never disagree with the
        # producer because it was never compared to it (M10).
        conn.executemany(
            "INSERT INTO serving_filer_rows (row_id, cik, period, filing_key,"
            " security_id, cusip, issuer_name, title_of_class, value_usd, shares,"
            " ssh_type, put_call, position_key, put_call_bucket, unit_key, flags)"
            " VALUES (?, ?, ?, ?, ?, ?, ?, 'COM', ?, ?, 'SH', NULL, ?, 'LONG',"
            " 'SH', '[]')",
            [(i, *row, f"sid:{row[3]}") for i, row in enumerate(_HOLDINGS)],
        )
        conn.commit()
    finally:
        conn.close()
    return path


class _ExplodingTransport:
    """Any SEC request is a failure — the published path must not reach here.

    Belt and braces over the autouse socket guard: this fails inside the tool
    (where the tool's own catch-all would otherwise convert a real socket error
    into a tidy envelope) AND leaves the attempted URL on `requested`, so a test
    can assert the absence of the attempt rather than the absence of a socket.
    """

    def __init__(self) -> None:
        self.requested: list[str] = []

    def get(self, url, *, headers):  # noqa: D102 — transport protocol
        self.requested.append(url)
        raise AssertionError(
            f"the published path opened a live SEC request: {url}"
        )


def _client(transport) -> SecClient:
    counter = iter(range(1, 1_000_000))
    return SecClient(
        transport, contact="test@example.com",
        sleep=lambda _s: None, monotonic=lambda: next(counter),
    )


@pytest.fixture(scope="module")
def agg_db(tmp_path_factory) -> str:
    """The deterministic ``inst_agg.db`` (M2-4 corpus), built once."""
    root = tmp_path_factory.mktemp("boundary_agg")
    src = root / "populus.db"
    init_db(str(src))
    conn = connect(str(src))
    _seed_source(conn)
    ensure_views(conn)
    out = root / "inst_agg.db"
    build_inst_agg(conn, out, ingested_at=AT)
    conn.close()
    return str(out)


@pytest.fixture(scope="module")
def serving_db(tmp_path_factory) -> str:
    return str(write_serving_db(tmp_path_factory.mktemp("boundary_srv") / "inst_serving.db"))


@pytest.fixture()
def transport() -> _ExplodingTransport:
    return _ExplodingTransport()


@pytest.fixture()
def bounded(agg_db, serving_db, transport):
    """Both published artifacts present — the boundary can be evaluated."""
    return build_server(
        db_path=":memory:", build_id="cong-1",
        inst_db_path=agg_db, inst_build_id="inst-1",
        inst_watermarks={"latest_period_of_report": CURR,
                         "latest_filed_date": "2026-06-02"},
        inst_serving_db_path=serving_db,
        sec_client=_client(transport),
        now=_now,
    )


@pytest.fixture()
def unbounded(agg_db, transport):
    """The aggregate only — a pre-M2-8 build. The boundary is UNEVALUATED."""
    return build_server(
        db_path=":memory:", build_id="cong-1",
        inst_db_path=agg_db, inst_build_id="inst-1",
        sec_client=_client(transport),
        now=_now,
    )


def _boundary_of(response) -> dict:
    return response["results"]["federated_boundary"]


# --- side 1: inside the published universe, nothing goes live ----------------


def test_an_in_universe_detail_request_is_served_from_the_snapshot(bounded, transport):
    """R10/R17, the half that used to be impossible: a filer+period the build
    published is answered from `inst_serving.db`, and NO live SEC request is
    made. `mode='detail'` used to mean "always federate"; it now means "the
    position list", and where that list comes from is the boundary's decision."""
    e = _call(bounded, "inst_filer_holdings", cik=BRK, period=CURR, mode="detail")
    _assert_inst_envelope(e)
    # §11.3: a snapshot-served answer is build-stamped, never live-stamped.
    assert e["build_id"] == "inst-1" and "live_source" not in e
    assert e["results"]["served_from"] == "published-serving-projection"
    assert _boundary_of(e) == {
        "route": "published",
        "reason": "in_published_universe",
        "boundary_evaluated": True,
        "explanation": _boundary_of(e)["explanation"],
        "published_periods": [CURR, PRIOR],
    }
    assert "NO live SEC request" in _boundary_of(e)["explanation"]
    # The proof, not the inference: the transport was never asked for anything.
    assert transport.requested == []
    # Three positions for the current period (base + the amendment's addition).
    assert e["results"]["position_count_published"] == 3
    assert {h["issuer_name"] for h in e["results"]["holdings"]} == {
        "APPLE INC", "NVIDIA CORP", "MICROSOFT CORP"
    }


def test_snapshot_mode_serves_the_published_per_filer_detail(bounded, transport):
    """R10: `mode='snapshot'` gained the published position list beside the
    aggregate profile. Without this half, narrowing `detail` would merely
    delete an answer instead of relocating it."""
    e = _call(bounded, "inst_filer_holdings", cik=BRK, period=CURR)
    _assert_inst_envelope(e)
    assert e["results"]["mode"] == "snapshot"
    # The aggregate profile is still there, unchanged.
    assert e["results"]["concentration"] is not None
    detail = e["results"]["published_detail"]
    assert detail["period_of_report"] == CURR
    assert detail["position_count_published"] == 3
    assert _boundary_of(e)["route"] == "published"
    assert transport.requested == []


def test_an_omitted_period_resolves_inside_the_universe_and_stays_local(
    bounded, transport
):
    """"Latest" is not a licence to go live. With no period given, the newest
    period the build published for this filer answers the question; only a
    period the build does not reach is §3.1 case 1."""
    e = _call(bounded, "inst_filer_holdings", cik=BRK, mode="detail")
    assert _boundary_of(e)["route"] == "published"
    assert e["results"]["period_of_report"] == CURR
    assert transport.requested == []


def test_published_rows_carry_both_dates_and_their_OWN_filing_provenance(bounded):
    """G4: a composed period mixes a base filing and its amendment. Every row
    carries the period AND the filed date of the filing that disclosed IT —
    restamping the base rows with the amendment's date would misreport when
    those positions became public."""
    e = _call(bounded, "inst_filer_holdings", cik=BRK, period=CURR, mode="detail")
    by_issuer = {h["issuer_name"]: h for h in e["results"]["holdings"]}
    assert all(h["period_of_report"] == CURR for h in by_issuer.values())
    assert by_issuer["APPLE INC"]["filed_date"] == "2026-05-15"
    assert by_issuer["MICROSOFT CORP"]["filed_date"] == "2026-06-02"
    assert by_issuer["APPLE INC"]["doc_url"].endswith("brk-2026q1.xml")
    assert by_issuer["MICROSOFT CORP"]["doc_url"].endswith("brk-2026q1-a.xml")
    # The projection stores normalized whole-USD values, so `unit_basis` is not
    # carried; that is stated rather than left to read as an unparsed value.
    assert by_issuer["APPLE INC"]["unit_basis"] is None
    assert "normalized to whole USD" in e["results"]["unit_basis_note"]


def test_the_published_position_list_discloses_its_own_truncation(bounded):
    """The measured worst case is a 37,140-position filer, so the list is
    bounded — and says so, with the full published count beside it."""
    e = _call(bounded, "inst_filer_holdings", cik=BRK, period=CURR, mode="detail",
              limit=1)
    assert e["results"]["returned"] == 1
    assert e["results"]["position_count_published"] == 3
    assert e["results"]["truncated"] is True
    assert "3 published positions" in e["results"]["truncation_note"]


def test_every_published_row_carries_its_own_accession(bounded):
    """§5.1 provenance. `_SERVING_DETAIL_SQL` already SELECTs `f.accession` and
    the shaper discarded it one line later, leaving a consumer with a `doc_url`
    it could not cross-reference against EDGAR's index.

    A composed period mixes a base filing with its amendments, so the accessions
    must DIFFER across rows — one restamped value would be worse than none.

    Mutation guard: dropping `accession=` from the shaper call fails here.
    """
    e = _call(bounded, "inst_filer_holdings", cik=BRK, period=CURR, mode="detail")
    holdings = e["results"]["holdings"]
    assert holdings
    for h in holdings:
        assert h.get("accession"), f"a published row carries no accession: {h}"
    # BRK's current period is a base filing PLUS a later NEW-HOLDINGS amendment.
    assert len({h["accession"] for h in holdings}) > 1, (
        "every row got the same accession — the composition was restamped")


@pytest.fixture()
def both_planes(agg_db, serving_db):
    """One server that can answer from BOTH planes.

    The published artifact covers `CURR`/`PRIOR`; the transport serves the real
    2025-Q1 base + NEW-HOLDINGS amendment, a period the build does not carry, so
    the same server answers one request from `inst_serving.db` and the other
    live. That is the only configuration in which the two planes' output can be
    compared at all — every existing test checks one plane against itself, which
    is exactly why N4 was invisible.
    """
    from populus.mcp_server import inst_queries as iq

    files = {iq.COMPANY_TICKERS_URL: MCP_TICKERS.read_bytes()}
    files.update(_detail_url_map(REAL_DIR, BRK, MERGE_BASE_NODASH))
    files.update(_detail_url_map(REAL_DIR, BRK, MERGE_AMENDMENT_NODASH))
    return build_server(
        db_path=":memory:", build_id="cong-1",
        inst_db_path=agg_db, inst_build_id="inst-1",
        inst_watermarks={"latest_period_of_report": CURR,
                         "latest_filed_date": "2026-06-02"},
        inst_serving_db_path=serving_db,
        sec_client=_clock_client(_FakeSecTransport(files)),
        now=_now,
    )


def test_both_planes_shape_a_holding_identically(both_planes):
    """`server.py:605` states the contract: *"Rows are shaped exactly like the
    federated ones so a client parses both planes identically."* This asserts it
    ACROSS the seam.

    QA M2-8 R2 N4: `accession` was added to `shape_holding` and passed on the
    published plane only, so one client parsing both planes got a real §5.1
    `source_record_id` from `period=CURR` and `null` from `period=2025-03-31` —
    and `null` is indistinguishable from "this filing has no accession", which is
    never true of a 13F. No test could see it, because no test held both planes'
    output at once.

    Mutation guard: dropping `accession=` from either `shape_holding` call site
    raises a TypeError; passing a constant on one plane fails the per-row check.
    """
    published = _call(both_planes, "inst_filer_holdings", cik=BRK, period=CURR,
                      mode="detail")
    live = _call(both_planes, "inst_filer_holdings", cik=BRK, period="2025-03-31",
                 mode="detail")
    # Prove the two answers really came from different planes before comparing.
    assert published["results"]["served_from"] == "published-serving-projection"
    assert "build_id" in published and "live_source" not in published
    assert _boundary_of(live)["route"] == "federated"
    assert "live_source" in live and "build_id" not in live

    pub_rows, live_rows = published["results"]["holdings"], live["results"]["holdings"]
    assert pub_rows and live_rows
    assert set(pub_rows[0]) == set(live_rows[0]), (
        "the planes emit different keys, so a client cannot parse them with one"
        f" code path: {sorted(set(pub_rows[0]) ^ set(live_rows[0]))}")
    for plane, rows in (("published", pub_rows), ("live", live_rows)):
        for row in rows:
            for field in ("accession", "period_of_report", "filed_date", "doc_url"):
                assert row.get(field), (
                    f"the {plane} plane dropped the §5.1 per-record provenance"
                    f" field {field!r}: {row}")
        # Per-row and not restamped: both periods are composed from a base plus
        # an amendment, so each answer must carry more than one accession.
        assert len({row["accession"] for row in rows}) > 1, (
            f"every {plane} row carries the same accession — a composed period"
            " was restamped with one filing's identity")


def test_a_truncated_position_list_is_reachable_in_full_through_the_cursor(bounded):
    """QA M2-8 M9: the recovery path, which did not exist.

    `limit` is capped at `_DETAIL_LIMIT_MAX = 5000` and there was no cursor or
    offset, so 32,140 of the named 37,140-position filer's rows were permanently
    unreachable through this boundary — while the truncation note advised
    "Raise `limit` (max 5000)", advice already at its ceiling. R11's "complete
    position list" was not reachable through MCP at all.

    Credit where due: the truncation was always signalled honestly (`truncated`,
    `position_count_published`, `returned`). It was the way out that was missing,
    and the house idiom (`env.encode_cursor`, used by `congress_recent_trades`)
    already existed.

    Mutation guard: dropping `next_cursor`, or ignoring `cursor` in the tool,
    leaves this unable to collect every row.
    """
    collected: list[dict] = []
    cursor = None
    for _ in range(10):  # bounded so a non-advancing cursor fails as a hang, not a loop
        e = _call(bounded, "inst_filer_holdings", cik=BRK, period=CURR,
                  mode="detail", limit=1, cursor=cursor)
        results = e["results"]
        collected.extend(results["holdings"])
        assert results["position_count_published"] == 3, (
            "the TRUE total must be stated on every page, not the page size")
        cursor = results.get("next_cursor")
        if not results["truncated"]:
            break
    assert cursor is None, "the last page must not offer a cursor"
    assert len(collected) == 3, (
        f"the complete published list is unreachable: collected {len(collected)} of 3")
    # every row distinct — a cursor that failed to advance would repeat page 1
    assert len({h["cusip"] for h in collected}) == 3


def test_a_single_page_answer_carries_a_null_cursor_not_a_missing_key(bounded):
    """An absent key reads as "this server does not page"; an explicit null reads
    as "there is no next page". Only the second is true here."""
    e = _call(bounded, "inst_filer_holdings", cik=BRK, period=CURR, mode="detail")
    assert e["results"]["truncated"] is False
    assert "next_cursor" in e["results"]
    assert e["results"]["next_cursor"] is None


def test_a_forged_cursor_is_refused_with_a_corrective_hint(bounded):
    """A malformed cursor must not silently restart at offset 0 — a client
    paging through 37,140 rows would loop forever on page 1 and never know."""
    e = _call(bounded, "inst_filer_holdings", cik=BRK, period=CURR, mode="detail",
              cursor="not-a-cursor")
    assert "error" in e["results"]
    assert "cursor" in e["results"]["error"]


# --- side 2: outside it, the live path is taken and says which case ----------


def test_a_period_newer_than_the_build_takes_the_federated_path(bounded, transport):
    """§3.1 case 1 — filings newer than the published build."""
    e = _call(bounded, "inst_filer_holdings", cik=BRK, period=POST_BUILD,
              mode="detail")
    _assert_inst_envelope(e)
    # A live outcome, so live-stamped — even though the fetch itself failed.
    assert "live_source" in e and "build_id" not in e
    assert _boundary_of(e)["route"] == "federated"
    assert _boundary_of(e)["reason"] == "post_snapshot"
    assert _boundary_of(e)["published_latest_period"] == CURR
    assert transport.requested, "case 1 must actually reach the federated client"


def test_a_filer_outside_the_published_universe_takes_the_federated_path(
    bounded, transport
):
    """§3.1 case 2 — a filer that appeared in EDGAR after discovery ran."""
    e = _call(bounded, "inst_filer_holdings", cik=UNKNOWN_CIK, period=CURR,
              mode="detail")
    assert _boundary_of(e)["route"] == "federated"
    assert _boundary_of(e)["reason"] == "off_universe"
    assert _boundary_of(e)["published_periods"] == []
    assert transport.requested


def test_a_published_filer_at_an_uningested_period_is_case_2_not_case_1(
    bounded, transport
):
    """The two federated cases are not interchangeable. A period BEFORE the
    build's coverage is "not yet ingested" (case 2); only a period after it is
    "newer than the build" (case 1). Collapsing them would make the response
    say the build is behind when it is simply bounded."""
    e = _call(bounded, "inst_filer_holdings", cik=BRK, period=PRE_BUILD,
              mode="detail")
    assert _boundary_of(e)["reason"] == "off_universe"
    assert _boundary_of(e)["published_periods"] == [CURR, PRIOR]
    assert transport.requested


def test_the_prior_period_is_inside_the_universe_not_outside_it(bounded, transport):
    """OD-5 publishes the current AND prior period, so a reader can see what
    moved. If only the current period counted as in-universe, every look at the
    prior quarter would silently become a live fetch."""
    e = _call(bounded, "inst_filer_holdings", cik=BRK, period=PRIOR, mode="detail")
    assert _boundary_of(e)["route"] == "published"
    assert e["results"]["position_count_published"] == 2
    assert transport.requested == []


# --- the third state: the boundary cannot be evaluated -----------------------


def test_without_the_serving_artifact_the_boundary_is_declared_unevaluated(
    unbounded, transport
):
    """R17 + the lead's constraint: a missing artifact is an EXPLICIT failure.

    The live path stays open (it is the only answer left), but the response may
    not claim the request was found to be off-universe — that would report a
    finding from an oracle that was never consulted.
    """
    e = _call(unbounded, "inst_filer_holdings", cik=BRK, period=CURR, mode="detail")
    boundary = _boundary_of(e)
    assert boundary["route"] == "federated"
    assert boundary["reason"] == "universe_unavailable"
    assert boundary["boundary_evaluated"] is False
    assert "could NOT be evaluated" in boundary["explanation"]
    assert "inst_serving.db" in boundary["detail"]
    assert transport.requested


def test_the_aggregate_is_never_accepted_as_the_serving_projection(
    agg_db, transport
):
    """The named hazard: `inst_agg.db` is a valid SQLite file of the SAME module
    at a DIFFERENT grain. Handed over as the per-filer projection it would make
    the boundary read "in universe" for filers whose positions were never
    published — suppressing the only correct answer. It is refused by name."""
    server = build_server(
        db_path=":memory:", build_id="cong-1",
        inst_db_path=agg_db, inst_build_id="inst-1",
        inst_serving_db_path=agg_db,        # the WRONG artifact, deliberately
        sec_client=_client(transport),
        now=_now,
    )
    health = _call(server, "inst_health")["results"]["per_filer_detail"]
    assert health["published"] is False
    assert "serving_filer_rows" in health["reason"]
    e = _call(server, "inst_filer_holdings", cik=BRK, period=CURR, mode="detail")
    assert _boundary_of(e)["reason"] == "universe_unavailable"
    assert "published_detail" not in e["results"]


def test_an_unpublished_period_yields_a_stated_absence_not_an_empty_list(bounded):
    """NULL-honest (G3): "no positions were published for this quarter" and
    "this filer held nothing" are different facts. A fabricated `holdings: []`
    would assert the second while only the first is known."""
    e = _call(bounded, "inst_filer_holdings", cik=BRK, period=POST_BUILD)
    results = e["results"]
    assert "published_detail" not in results
    assert results["published_detail_unavailable"]["reason"]
    assert "mode='detail'" in results["published_detail_unavailable"]["retry"]
    assert "holdings" not in results


def test_inst_health_states_which_side_of_the_boundary_it_can_serve(
    bounded, unbounded
):
    """Two artifacts back this module and the aggregate's presence says nothing
    about the projection's. An operator asking "why is everything going live?"
    gets the fact, not an inference."""
    served = _call(bounded, "inst_health")["results"]["per_filer_detail"]
    assert served["published"] is True
    assert served["artifact"] == "inst_serving.db"
    assert "reason" not in served
    withheld = _call(unbounded, "inst_health")["results"]["per_filer_detail"]
    assert withheld["published"] is False
    assert "inst_serving.db" in withheld["reason"]


def test_the_consumer_reads_the_tables_the_producer_declares():
    """The producer/consumer seam, pinned.

    `publish/digests.py` `ARTIFACT_PROJECTIONS['inst_serving.db']` enumerates the
    tables the build WRITES and digests; `server._SERVING_REQUIRED_TABLES` names
    the ones the MCP boundary READS. Nothing else connects the two halves — a
    rename on either side would leave the boundary permanently "unevaluated" in
    production while every test on both sides still passed, because each half is
    internally consistent with its own fixture.
    """
    from populus.mcp_server import server as srv
    from populus.publish.digests import ARTIFACT_PROJECTIONS

    declared = set(ARTIFACT_PROJECTIONS[INST_SERVING_ARTIFACT])
    assert set(srv._SERVING_REQUIRED_TABLES) <= declared, (
        "the boundary reads a table the published artifact does not carry:"
        f" {sorted(set(srv._SERVING_REQUIRED_TABLES) - declared)}"
    )
    # And the fixture these tests build must be that same schema, or every
    # assertion above would be about a database the build never produces.
    assert set(srv._SERVING_REQUIRED_TABLES) <= {
        line.split("(")[0].split()[-1]
        for line in _SCHEMA.splitlines()
        if line.startswith("CREATE TABLE")
    }


# --- the client half: resolving the new Release artifact (R10) ---------------


def _publish_with_inst(tmp_path, *, serving: bool):
    """A published local repo whose manifest carries an ``inst`` module.

    The congress build is published for real; the inst module is then injected
    into the manifest as build-scoped path artifacts and the pointer re-minted
    (the pattern `test_pointer_state.py` already uses to publish a manifest the
    producer does not yet emit — T8 owns the producer side).
    """
    db = seed_db(tmp_path / "populus.db")
    repo = make_repo(tmp_path)
    build_id = publish_build(db, repo).build_id
    build_dir = repo / "builds" / build_id

    names = [INST_DB_ARTIFACT] + ([INST_SERVING_ARTIFACT] if serving else [])
    artifacts = []
    for name in names:
        target = build_dir / name
        payload = sqlite3.connect(str(target))
        try:
            # A REAL SQLite file: install runs PRAGMA integrity_check on any
            # `.db` artifact, so a stub of bytes would be refused there.
            payload.execute(f"CREATE TABLE marker_{name.split('.')[0]} (x INTEGER)")
            payload.commit()
        finally:
            payload.close()
        data = target.read_bytes()
        artifacts.append({
            "name": name,
            "sha256": hashlib.sha256(data).hexdigest(),
            "bytes": len(data),
            "license_ids": ["sec-edgar"],
            "path": f"builds/{build_id}/{name}",
            "logical_digest": "0" * 64,
        })

    manifest_path = build_dir / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    congress = manifest["modules"]["congress"]
    manifest["modules"]["inst"] = {
        "schema_version": INST_SCHEMA_VERSION,
        "client_compat": INST_CLIENT_COMPAT,
        "deprecation": None,
        "normalization_version": congress["normalization_version"],
        "digest_projection_version": congress["digest_projection_version"],
        "watermarks": {"latest_period_of_report": CURR,
                       "latest_filed_date": "2026-06-02"},
        "artifacts": artifacts,
    }
    text = json.dumps(manifest, ensure_ascii=False, indent=2, sort_keys=True) + "\n"
    manifest_path.write_text(text, encoding="utf-8")
    pointer = build_pointer(
        pointer_version=2,
        issued_at=NOW + timedelta(hours=1),
        build_id=build_id,
        manifest_sha256=hashlib.sha256(text.encode("utf-8")).hexdigest(),
    )
    (repo / "latest.json").write_text(render_pointer(pointer), encoding="utf-8")
    return repo, tmp_path / "cache", build_id


def _inst_client(cache, repo):
    return SnapshotClient(
        cache, LocalRepoFetcher(repo), now=pin(NOW + timedelta(hours=2)),
        module="inst",
    )


def test_the_client_resolves_the_new_per_build_serving_artifact(tmp_path):
    """R10: `inst_serving.db` is delivered by the SAME proven mechanism as
    `congress.db` / `inst_agg.db` — enumerated and hashed in the manifest,
    fetched, verified and installed under `<module>/<build_id>/`."""
    repo, cache, build_id = _publish_with_inst(tmp_path, serving=True)
    client = _inst_client(cache, repo)
    assert client.refresh().status == "installed"
    serving = client.serving_db_path()
    assert serving is not None
    assert serving.name == INST_SERVING_ARTIFACT
    assert serving.parent.name == build_id
    assert serving.is_file()
    # Two DIFFERENT artifacts of one module, resolved independently.
    assert client.db_path().name == INST_DB_ARTIFACT
    assert serving != client.db_path()


def test_a_build_without_the_serving_artifact_resolves_to_absence_not_the_aggregate(
    tmp_path,
):
    """A pre-M2-8 build publishes only the aggregate. That is a legitimate
    absence — and the one thing it must never become is the aggregate wearing
    the serving artifact's name."""
    repo, cache, _build_id = _publish_with_inst(tmp_path, serving=False)
    client = _inst_client(cache, repo)
    assert client.refresh().status == "installed"
    assert client.db_path() is not None          # the aggregate IS served
    assert client.serving_db_path() is None      # the projection is NOT


def test_a_cached_file_the_manifest_never_enumerated_is_not_served(tmp_path):
    """The manifest is the authority on what the build published. A file that
    merely SITS in the build directory was never hash-verified by
    `_build_complete`, so serving it would hand back unverified bytes under a
    verified build's name."""
    repo, cache, build_id = _publish_with_inst(tmp_path, serving=False)
    client = _inst_client(cache, repo)
    assert client.refresh().status == "installed"
    planted = cache / "inst" / build_id / INST_SERVING_ARTIFACT
    planted.write_bytes(b"not enumerated anywhere")
    assert planted.is_file()
    assert _inst_client(cache, repo).serving_db_path() is None


def test_asking_a_non_inst_module_for_a_serving_artifact_is_a_category_error(
    tmp_path,
):
    """congress publishes no serving projection. Returning `None` there would
    read as "this build simply predates M2-8" — a false statement about a
    module that will never have one."""
    repo, cache, _build_id = _publish_with_inst(tmp_path, serving=True)
    congress_client = SnapshotClient(
        cache, LocalRepoFetcher(repo), now=pin(NOW + timedelta(hours=2))
    )
    assert congress_client.refresh().status == "installed"
    with pytest.raises(ValueError, match="publishes no serving artifact"):
        congress_client.serving_db_path()


# --- the COLUMN contract, not just the table names (QA M2-8 M10) -------------


def test_every_column_the_boundary_reads_is_declared_by_the_producer(tmp_path):
    """`server.py` calls the two table names "the whole coupling surface". They
    are not: `_SERVING_DETAIL_SQL` names seventeen COLUMNS across two tables, and
    nothing compared them to the producer's schema.

    This prepares the boundary's real SQL against a database built from the real
    `SERVING_SCHEMA`. Renaming `serving_filer_rows.shares` -> `ssh_prnamt` in the
    producer used to break production and pass every Python test here; now it
    fails at `prepare` time with the missing column named.

    Mutation guard: rename any column in `SERVING_SCHEMA` and this fails.
    """
    from populus.mcp_server.server import _SERVING_DETAIL_SQL

    path = tmp_path / "columns.db"
    conn = sqlite3.connect(str(path))
    try:
        conn.executescript(SERVING_SCHEMA)
        # Non-vacuity: the statement must actually resolve columns, not merely
        # parse. A prepare over an empty schema would also "succeed" if the SQL
        # were reduced to `SELECT 1`.
        assert "h.security_id" in _SERVING_DETAIL_SQL
        assert _SERVING_DETAIL_SQL.count(",") >= 15, "the projection lost columns"
        conn.execute(
            _SERVING_DETAIL_SQL, ("0000000000", "2026-03-31", 10, 0)
        ).fetchall()
    finally:
        conn.close()


def test_the_producer_declares_every_table_the_boundary_requires(tmp_path):
    """The table half of the same contract, executed rather than asserted from a
    hand-maintained tuple."""
    from populus.mcp_server.server import _SERVING_REQUIRED_TABLES

    path = tmp_path / "tables.db"
    conn = sqlite3.connect(str(path))
    try:
        conn.executescript(SERVING_SCHEMA)
        produced = {
            row[0]
            for row in conn.execute(
                "SELECT name FROM sqlite_master WHERE type='table'"
            )
        }
    finally:
        conn.close()
    assert _SERVING_REQUIRED_TABLES, "the required-table set is empty — vacuous"
    missing = set(_SERVING_REQUIRED_TABLES) - produced
    assert not missing, f"the boundary requires tables the producer omits: {sorted(missing)}"
