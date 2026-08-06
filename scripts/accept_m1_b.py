#!/usr/bin/env python3
"""RUN M1-B Phase A acceptance — the mandatory synchronous DEV gate (R11/R16/R18).

Run via ``make accept-m1-b``. Fully hermetic: committed ``tests/fixtures/``
bytes (the real 2015 House PDFs and Senate pages, plus a committed 2015 index
and a crafted historical Senate index) served through fake transports, so the
whole chain runs with zero sockets under the same discipline as the test suite.
It NEVER skips.

It drives, on committed bytes end to end:

    discover → verified-settled + resumable fetch (+ provenance sidecars)
    → evaluate → load → member join → cross-year amendment pair
    → per-era gate evaluation → gate-miss surfacing
    → stats.json render + schema validation
    → build → publish → verify (LocalDirBackend)
    → consumer-contract + entity/file-budget assertions

plus two resume sub-proofs (R3): a missing and a corrupt archive each refetch
exactly once on the SAME database, and a FRESH database over the verified
archive re-reads every document with ZERO PTR transport.

**What it asserts, and what it deliberately does not.** It asserts the chain and
the gate *behaviour* — above the gate, below the gate, and unmeasurable — not
that the fixtures meet ≥97%. This is the deliberate difference from
``accept-m2-6`` (which asserts its coverage gate passes): a below-gate era is a
surfaced decision for the owner, never a build failure.

**One assertion body, two modes.** ``assert_corpus`` is shared verbatim between
the hermetic gate and the ``--db`` run against the real Phase A corpus, and
every consumer assertion is written against the *published contract* rather than
a fixture-shaped expectation — the feed is exactly the latest 500 rows, and
historical publication is proven by the per-era stats keys plus the slices whose
own latest-``SLICE_LIMIT`` window genuinely contains era rows. That is what
makes the operational run a re-run of this gate rather than a second, weaker
script.

Reused populus code only; no second HTTP client, no forked ingest path.
"""

from __future__ import annotations

import argparse
import json
import sqlite3
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT / "src"))
sys.path.insert(0, str(REPO_ROOT / "tests"))

FIXTURES = REPO_ROOT / "tests" / "fixtures"
SCHEMA_PATH = REPO_ROOT / "tests" / "schemas" / "stats.schema.json"

MOMENT = datetime(2026, 7, 31, tzinfo=timezone.utc)
NOW_ISO = "2026-07-31T00:00:00Z"
ERA = "2015"
# ARCHITECTURE.md §9.10: the hard M1 published-file budget (owner decision
# 2026-08-01: raised from 4,000 — the 13-year corpus measured 3,856 tickers).
FILE_BUDGET = 8500

HOUSE_2015_PDFS = {
    "20002703": "2015_20002703.pdf",
    "20003021": "2015_20003021.pdf",
    "20003730": "2015_20003730.pdf",
    "9106099": "2015_9106099.pdf",
    "9106250": "2015_9106250.pdf",
    "9106286": "2015_9106286.pdf",
}
# The committed historical index names these filers; the alias fixtures below
# resolve all but one, so era join coverage is measured rather than trivial.
HOUSE_2015_MEMBERS = {
    "20002703": ("F000461", "Flores, Bill", "TX", "17"),
    "20003021": ("S000583", "Smith, Lamar", "TX", "21"),
    "20003730": ("D000399", "Doggett, Lloyd", "TX", "35"),
    "9106250": ("B001273", "Black, Diane", "TN", "06"),
    "9106286": ("F000372", "Frelinghuysen, Rodney P.", "NJ", "11"),
    # 9106099 (Clawson) is deliberately left unseeded — an unjoined historical
    # filer must stay visible, flagged, and counted.
}


# --- fakes -------------------------------------------------------------------


def _resp(status: int, content: bytes = b"", headers: dict | None = None):
    from populus.ingest import TransportResponse

    return TransportResponse(
        status_code=status, headers=dict(headers or {}), content=content
    )


class _FakeHouseTransport:
    """Serves the committed 2015 index ZIP and PDF bytes; 404 for anything else."""

    def __init__(self) -> None:
        import io
        import zipfile

        from populus.ingest import house

        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, "w") as archive:
            archive.writestr(
                "2015FD.xml",
                (FIXTURES / "house" / "2015FD.index.xml").read_bytes(),
            )
        self.files = {
            house.INDEX_URL_TEMPLATE.format(year=2015): buffer.getvalue(),
        }
        for doc_id, name in HOUSE_2015_PDFS.items():
            url = house.DOC_URL_TEMPLATE.format(year=2015, doc_id=doc_id)
            self.files[url] = (FIXTURES / "house" / name).read_bytes()
        self.attempts = 0
        self.pdf_attempts = 0
        self.requested: list[str] = []

    def get(self, url: str, *, headers):
        self.attempts += 1
        self.requested.append(url)
        if "/ptr-pdfs/" in url:
            self.pdf_attempts += 1
        content = self.files.get(url)
        if content is None:
            return _resp(404)
        return _resp(200, content, {"ETag": '"m1b-2015"'})


class _FakeSenateTransport:
    """The eFD handshake plus a bounded-window index, from committed bytes."""

    HOME_HTML = (
        b"<html><body><form>"
        b'<input type="hidden" name="csrfmiddlewaretoken" value="tok-m1b">'
        b"</form></body></html>"
    )

    def __init__(self) -> None:
        self.index = json.loads(
            (FIXTURES / "senate" / "hist-ptr-index.json").read_text(encoding="utf-8")
        )
        self.bodies: list[dict] = []
        self.attempts = 0

    def get(self, url: str, *, headers):
        from populus.ingest import senate

        self.attempts += 1
        if url == senate.HOME_URL:
            return _resp(200, self.HOME_HTML, {"set-cookie": "csrftoken=abc; Path=/"})
        for name in ("ptr", "paper"):
            prefix = f"{senate.EFD_BASE}/search/view/{name}/"
            if url.startswith(prefix):
                uuid = url[len(prefix) :].strip("/")
                page = FIXTURES / "senate" / f"{name}_{uuid}.html"
                if page.is_file():
                    return _resp(200, page.read_bytes())
        return _resp(404)

    def post(self, url: str, *, data, headers):
        from populus.ingest import senate

        self.attempts += 1
        if url == senate.HOME_URL:
            return _resp(302, b"", {"set-cookie": "sessionid=sess-m1b; Path=/"})
        if url == senate.DATA_URL:
            self.bodies.append(dict(data))
            return _resp(200, json.dumps(self.index).encode("utf-8"))
        return _resp(404)


class _Clock:
    def __init__(self) -> None:
        self.now = 0.0

    def monotonic(self) -> float:
        self.now += 0.5
        return self.now

    def sleep(self, seconds: float) -> None:
        self.now += seconds


def _now_factory():
    import itertools

    counter = itertools.count()
    return lambda: f"2026-07-31T00:00:{next(counter) % 60:02d}Z"


def _new_db(path: Path):
    from populus.amendments import ensure_views
    from populus.db import connect, init_db

    init_db(str(path))
    conn = connect(str(path))
    ensure_views(conn)
    return conn


# --- hermetic stages ---------------------------------------------------------


def _ingest_house_2015(conn, raw_root: Path, transport, *, run_id: str):
    from populus.ingest.house import run_house_ingest

    clock = _Clock()
    return run_house_ingest(
        conn,
        years=[2015],
        raw_root=raw_root,
        run_id=run_id,
        now=_now_factory(),
        host="accept",
        transport=transport,
        sleep=clock.sleep,
        monotonic=clock.monotonic,
    )


def _stage_house(conn, raw_root: Path, out) -> bool:
    from populus.ingest import house

    transport = _FakeHouseTransport()
    report = _ingest_house_2015(conn, raw_root, transport, run_id="accept-house")
    counts = report.years[0].reconciliation.status_counts
    out(
        f"house {ERA}: index PTRs {report.years[0].index_ptr_count}"
        f" | dup docids {report.years[0].dup_docids}"
        f" | parsed {counts.get('parsed', 0)}"
        f" | partial {counts.get('partial', 0)}"
        f" | needs_ocr {counts.get('needs_ocr', 0)}"
        f" | failed {counts.get('failed', 0)}"
        f" | PTR fetches {transport.pdf_attempts}"
    )
    ok = True
    if not report.ok:
        out("  <-- the 2015 House ingest did not reconcile cleanly")
        out(house.format_summary(report))
        ok = False

    # Every fetched document carries its §5.1 provenance sidecar, and the hash
    # in it necessarily preceded the bytes beside it.
    import hashlib

    for doc_id, name in HOUSE_2015_PDFS.items():
        pdf = raw_root / "pdfs" / ERA / f"{doc_id}.pdf"
        sidecar = pdf.with_name(f"{doc_id}.pdf.fetch-meta.json")
        if not sidecar.is_file():
            out(f"  <-- no provenance sidecar for {doc_id}")
            ok = False
            continue
        meta = json.loads(sidecar.read_text(encoding="utf-8"))
        expected = hashlib.sha256((FIXTURES / "house" / name).read_bytes()).hexdigest()
        if meta.get("response_hash") != expected or not meta.get("source_url"):
            out(f"  <-- sidecar for {doc_id} does not describe its bytes")
            ok = False
    if ok:
        out(
            f"  provenance: {len(HOUSE_2015_PDFS)} checkpoint-first sidecars"
            " (source_url + response_hash + retrieved_at)"
        )
    return ok


def _stage_verified_settled(conn, raw_root: Path, out) -> bool:
    """R3: a missing and a corrupt archive each refetch EXACTLY once, on the
    same database — the case the old `raw_path IS NOT NULL` skip lost forever."""
    from populus.ingest import house

    missing = raw_root / "pdfs" / ERA / "20002703.pdf"
    corrupt = raw_root / "pdfs" / ERA / "20003021.pdf"
    intact = corrupt.read_bytes()
    missing.unlink()
    corrupt.write_bytes(b"X" * len(intact))   # same length: a size check misses it

    transport = _FakeHouseTransport()
    report = _ingest_house_2015(conn, raw_root, transport, run_id="accept-resettle")
    ok = True
    if transport.pdf_attempts != 2:
        out(
            f"  <-- {transport.pdf_attempts} PTR fetch(es); exactly 2 (the missing"
            " and the corrupt archive) were expected"
        )
        ok = False
    if report.settled_reobtained != 2 or report.settled_verified != len(
        HOUSE_2015_PDFS
    ) - 2:
        out(
            f"  <-- settled_verified {report.settled_verified} /"
            f" settled_reobtained {report.settled_reobtained} do not describe"
            " one missing + one corrupt archive"
        )
        ok = False
    if corrupt.read_bytes() != intact:
        out("  <-- the corrupt archive was not healed")
        ok = False

    third = _FakeHouseTransport()
    again = _ingest_house_2015(conn, raw_root, third, run_id="accept-resettle-2")
    if third.pdf_attempts != 0:
        out(f"  <-- a third run refetched {third.pdf_attempts} document(s)")
        ok = False
    if ok:
        out(
            f"  verified-settled: 1 missing + 1 corrupt archive refetched exactly"
            f" once each ({transport.pdf_attempts} fetches), then"
            f" {again.settled_verified} verified and 0 refetched"
        )
        out(house.format_summary(again).splitlines()[0])
    return ok


def _stage_fresh_db_resume(raw_root: Path, tmp: Path, out) -> bool:
    """R3: a FRESH database over the verified archive makes ZERO PTR transport.

    This cannot pass by skipping settled rows — a new database has none."""
    path = tmp / "resume.db"
    conn = _new_db(path)
    try:
        transport = _FakeHouseTransport()
        report = _ingest_house_2015(conn, raw_root, transport, run_id="accept-fresh")
    finally:
        conn.close()
    if transport.pdf_attempts != 0:
        out(
            f"  <-- RESUME made {transport.pdf_attempts} PTR transport call(s);"
            " a verified archive must never be refetched"
        )
        return False
    if report.new_filings != len(HOUSE_2015_PDFS) or not report.ok:
        out(
            f"  <-- RESUME loaded {report.new_filings}/{len(HOUSE_2015_PDFS)}"
            " filings from the verified archive"
        )
        return False
    out(
        f"  fresh database re-read every document with ZERO transport"
        f" ({report.new_filings} filings, {report.rows_loaded} rows)"
    )
    return True


def _stage_senate(conn, tmp: Path, out) -> bool:
    """The historical Senate era: the cross-year pair, and the live-mode window
    seam sending both bounds."""
    from populus.ingest import senate

    cache = tmp / "senate-cache"
    (cache / "pages").mkdir(parents=True, exist_ok=True)
    index = json.loads(
        (FIXTURES / "senate" / "hist-ptr-index.json").read_text(encoding="utf-8")
    )
    (cache / "ptr-index.json").write_text(json.dumps(index), encoding="utf-8")
    for source in sorted((FIXTURES / "senate").glob("*.html")):
        (cache / "pages" / source.name).write_bytes(source.read_bytes())

    report = senate.run_senate_ingest(
        conn,
        raw_root=cache,
        cache_dir=cache,
        run_id="accept-senate",
        now=_now_factory(),
        host="accept",
    )
    counts = report.reconciliation.status_counts if report.reconciliation else {}
    out(
        f"senate historical: index rows {report.index_count}"
        f" | parsed {counts.get('parsed', 0)}"
        f" | needs_ocr {counts.get('needs_ocr', 0)}"
        f" | amendments {report.amendments_total}"
        f" (paired {report.amendments_paired})"
    )
    ok = True
    if not report.ok:
        out("  <-- the historical Senate ingest did not reconcile cleanly")
        ok = False
    if (report.amendments_total, report.amendments_paired) != (1, 1):
        out("  <-- the cross-year amendment pair did not link")
        ok = False

    pairs = conn.execute(
        "SELECT amendment_filing_id, original_filing_id, amendment_filed_date,"
        " original_filed_date FROM v_amendment_pairs"
    ).fetchall()
    if len(pairs) != 1:
        out(f"  <-- {len(pairs)} amendment pair(s) recorded, expected 1")
        ok = False
    else:
        amendment_id, original_id, amendment_filed, original_filed = pairs[0]
        if original_filed[:4] == amendment_filed[:4]:
            out("  <-- the linked pair does not span a year boundary")
            ok = False
        in_default = {
            f for (f,) in conn.execute(
                "SELECT DISTINCT filing_id FROM v_default_transactions"
            )
        }
        if original_id in in_default:
            out("  <-- the superseded original is still in the default view")
            ok = False
        flagged = all(
            "amendment_unresolved" in json.loads(flags)
            for (flags,) in conn.execute(
                "SELECT flags FROM transactions WHERE filing_id IN (?, ?)",
                (amendment_id, original_id),
            )
        )
        if not flagged:
            out("  <-- both sides of the pair are not flagged amendment_unresolved")
            ok = False
        if ok:
            out(
                f"  cross-year pair: {original_filed} original superseded by a"
                f" {amendment_filed} amendment; both sides flagged; the original"
                " is excluded from v_default_transactions (no double count)"
            )

    # The R14 seam, live: both bounds reach the request body, and the default
    # body is unchanged.
    live_conn = _new_db(tmp / "senate-live.db")
    try:
        transport = _FakeSenateTransport()
        clock = _Clock()
        live = senate.run_senate_ingest(
            live_conn,
            raw_root=tmp / "senate-live-raw",
            run_id="accept-senate-window",
            now=_now_factory(),
            host="accept",
            transport=transport,
            sleep=clock.sleep,
            monotonic=clock.monotonic,
            jitter=lambda: 0.0,
            submitted_start_date="01/01/2015",
            submitted_end_date="03/31/2016",
        )
    finally:
        live_conn.close()
    body = transport.bodies[0] if transport.bodies else {}
    if (body.get("submitted_start_date"), body.get("submitted_end_date")) != (
        "01/01/2015",
        "03/31/2016",
    ):
        out(f"  <-- the window seam did not send both bounds: {body!r:.200}")
        ok = False
    else:
        out(
            "  window seam: requested submitted 01/01/2015 → 03/31/2016"
            f" | attempts {live.fetch.attempts} retries {live.fetch.retries}"
            f" elapsed {live.elapsed_s:.1f}s"
        )
    default_body = senate._index_post_body(
        "tok-m1b", submitted_start_date="01/01/2012", start=0
    )
    if default_body["submitted_end_date"] != "":
        out("  <-- the default request body is no longer open-ended")
        ok = False
    return ok


def _stage_members(conn, out) -> bool:
    """Seed the era's members + temporal aliases, join, and measure per era."""
    from populus.members import apply_member_join, normalize_filer_name
    from populus.parse_gate import compute_join_coverage

    for bioguide_id, name, state, district in HOUSE_2015_MEMBERS.values():
        last, first = (part.strip() for part in name.split(",", 1))
        terms = [
            {
                "type": "rep",
                "start": "2013-01-03",
                "end": "2017-01-03",
                "state": state,
                "district": int(district),
            }
        ]
        conn.execute(
            "INSERT INTO members (bioguide_id, full_name, chamber, party, state,"
            " district, terms, raw) VALUES (?, ?, 'house', 'Republican', ?, ?, ?, ?)"
            " ON CONFLICT DO NOTHING",
            (
                bioguide_id,
                f"{first} {last}",
                state,
                district,
                json.dumps(terms),
                json.dumps({"id": {"bioguide": bioguide_id}}),
            ),
        )
        conn.execute(
            "INSERT INTO member_aliases (alias, chamber, state, district,"
            " valid_from, valid_to, bioguide_id, note)"
            " VALUES (?, 'house', NULL, NULL, '2013-01-03', '2017-01-03', ?, ?)",
            (
                normalize_filer_name(name),
                bioguide_id,
                "RUN M1-B acceptance: the 2015 era filer",
            ),
        )
    report = apply_member_join(conn)
    era = next(
        (
            c
            for c in compute_join_coverage(conn)
            if (c.chamber, c.year) == ("house", ERA)
        ),
        None,
    )
    if era is None:
        out(f"  <-- no house {ERA} join coverage was measured")
        return False
    out(f"member join: {era.format_line()}")
    ok = True
    if era.filings_joined != len(HOUSE_2015_MEMBERS):
        out(
            f"  <-- {era.filings_joined} filings joined, expected"
            f" {len(HOUSE_2015_MEMBERS)}"
        )
        ok = False
    if era.filings_unjoined != 1 or not era.unresolved_filers:
        out("  <-- the unjoined historical filer is not visible and counted")
        ok = False
    if report.by_source.get("house-clerk") is None:
        out("  <-- the join report carries no house-clerk source split")
        ok = False
    return ok


def _stage_crafted_surfacing(tmp: Path, out) -> bool:
    """Drive the surfacing below the gate, on eras the fixtures cannot exhibit:
    a sub-gate era (measurable, under 0.97) and a zero-row e-file era."""
    from populus.load import ParsedRow, load_filing, upsert_filing
    from populus.parse_gate import compute_parse_gate, format_gate_decision

    conn = _new_db(tmp / "crafted.db")
    try:
        def _filing(filing_id, filed_date, status, rows):
            upsert_filing(
                conn,
                filing_id=filing_id,
                chamber="house",
                filer_name_raw="Crafted, Casey",
                filing_kind="ptr",
                filed_date=filed_date,
                doc_url=f"https://example.invalid/{filing_id}",
                source="house-clerk",
                ingested_at=NOW_ISO,
                rows=rows,
                parse_status=status,
                parser_version="accept",
                normalization_version="accept",
                raw_path=None,
                response_hash=None,
                lifecycle="active",
            )
            load_filing(
                conn, filing_id, rows, parse_status=status,
                parser_version="accept", normalization_version="accept",
            )

        def _row(n, *, defective):
            return ParsedRow(
                raw_row={"asset_name": f"A{n}", "side": "purchase"},
                row_ordinal=n,
                asset_name=f"A{n}",
                side="purchase",
                flags=["amount_unparsed"] if defective else [],
            )

        # A sub-gate era: fully measurable, 90% clean — below 0.97.
        sub_gate = [_row(n, defective=n > 90) for n in range(1, 101)]
        _filing("house:sub-gate", "2013-04-01", "partial", sub_gate)
        # A zero-row e-file era: the template parses nothing, so the row
        # denominator is unknown and the era can never read as n/a or pass.
        _filing("house:zero-row", "2014-04-01", "failed", [])

        report = compute_parse_gate(conn)
        decision = format_gate_decision(report)
        eras = {(e.chamber, e.year): e for e in report.eras}
        ok = True
        if eras[("house", "2013")].status != "miss":
            out(f"  <-- the sub-gate era read {eras[('house', '2013')].status}")
            ok = False
        if eras[("house", "2014")].status != "unmeasurable":
            out(f"  <-- the zero-row era read {eras[('house', '2014')].status}")
            ok = False
        if not report.owner_decision_required or "OWNER DECISION REQUIRED" not in decision:
            out("  <-- a non-passing era did not surface a decision")
            ok = False
        for fragment in ("house 2013", "house 2014", "(a) era-scoped gates",
                         "(b) a parser extension", "(c) accepting a higher"):
            if fragment not in decision:
                out(f"  <-- the decision report omits {fragment!r}")
                ok = False
        if [e.year for e in report.surfaced] != ["2014", "2013"]:
            out("  <-- surfaced eras are not severity-ranked worst-first")
            ok = False
        if ok:
            out("  " + "\n  ".join(decision.splitlines()))
        return ok
    finally:
        conn.close()


# --- the shared assertion body (hermetic AND operational) --------------------


def _expected_feed_ids(conn, limit: int) -> list[str]:
    return [
        txn_id
        for (txn_id,) in conn.execute(
            "SELECT txn_id FROM v_default_transactions"
            " ORDER BY filed_date DESC, transaction_date DESC, txn_id LIMIT ?",
            (limit,),
        )
    ]


def _era_slice_entities(conn, column: str, era: str, limit: int) -> list[str]:
    """Entities whose OWN latest-``limit`` window contains an era row.

    Mirrors ``_feed_rows``' ordering exactly, so the assertion is true on the
    fixture corpus and on an enlarged real one alike — an entity with more than
    ``limit`` newer rows genuinely has no era row in its published slice, and
    asserting otherwise would fail a correct build.
    """
    # nosec B608 — `column` is one of two module-chosen literals below; every
    # value is a bound parameter.
    rows = conn.execute(
        f"SELECT {column} FROM (SELECT {column}, filed_date,"  # nosec B608
        f"   ROW_NUMBER() OVER (PARTITION BY {column}"
        "     ORDER BY filed_date DESC, transaction_date DESC, txn_id) AS rn"
        f"   FROM v_default_transactions WHERE {column} IS NOT NULL)"
        " WHERE rn <= ? AND substr(filed_date, 1, 4) = ?"
        f" GROUP BY {column} ORDER BY {column}",
        (limit, era),
    ).fetchall()
    return [value for (value,) in rows]


def feed_matches_contract(feed_ids: list[str], expected: list[str]) -> bool:
    """The feed contract is EXACT: the same ids, in the same order.

    A containment or set check would accept a truncated or reordered feed, and
    would also accept the wrong thing for the right-looking reason on a corpus
    where every published row happens to be an expected one. ``feed.json`` is
    contractually the latest ``FEED_LIMIT`` rows by filed date, so equality is
    both the true contract and the only check that can fail on a real defect.
    """
    return feed_ids == expected


def within_file_budget(published_files: int, budget: int) -> bool:
    """The §9.10 M1 page budget is a HARD cap, not a target to drift past."""
    return published_files <= budget


def assert_corpus(
    db_path: Path,
    *,
    raw_root: Path | None,
    data_repo: Path,
    era: str = ERA,
    file_budget: int = FILE_BUDGET,
    out=print,
) -> bool:
    """Gate → stats → build → publish → verify → consumers → budgets.

    Shared verbatim between the hermetic gate and the real Phase A corpus: the
    modes differ only in how the database, archive root, and data repo are
    obtained. Every assertion below is written against the published contract,
    never against a fixture-shaped expectation.
    """
    import jsonschema

    from populus.db import connect
    from populus.parse_gate import compute_parse_gate, format_gate_report
    from populus.publish.attestation import StagingNoop
    from populus.publish.build import (
        FEED_LIMIT,
        SLICE_LIMIT,
        LocalDirBackend,
        run_build,
        run_publish,
        run_verify,
    )
    from populus.stats import compute_stats, render_stats

    ok = True
    conn = connect(str(db_path))
    try:
        # 6. the per-era gate, measured and surfaced (never a build failure).
        gate = compute_parse_gate(conn)
        out(format_gate_report(gate))
        if gate.owner_decision_required:
            out(
                "  (a surfaced decision is NOT an acceptance failure — the gate"
                " reports it and the owner decides.)"
            )

        # 7. stats.json: rendered and schema-validated, with the era keys.
        stats = compute_stats(conn, now=lambda: NOW_ISO)
        rendered = render_stats(stats)
        jsonschema.validate(stats, json.loads(SCHEMA_PATH.read_text()))
        if rendered != render_stats(compute_stats(conn, now=lambda: NOW_ISO)):
            out("  <-- stats.json rendering is not byte-stable")
            ok = False
        totals = stats["totals"]
        era_gate = (
            totals["efile_parse_gate_by_chamber_year_including_excluded"]
            .get("house", {})
            .get(era)
        )
        era_join = (
            totals["member_join_primary_by_chamber_year_including_excluded"]
            .get("house", {})
            .get(era)
        )
        if era_gate is None or era_join is None:
            out(f"  <-- stats.json carries no house {era} era keys")
            ok = False
        else:
            out(
                f"stats.json house {era}:"
                f" e-file rows {era_gate['clean_efile_rows']}/{era_gate['efile_rows']}"
                f" | status {era_gate['status']}"
                f" | join rows {era_join['rows_joined']}/{era_join['rows']}"
            )
            if era_gate["efile_filings"] == 0 and era_join["filings"] == 0:
                out(f"  <-- the {era} era published no filings at all")
                ok = False

        expected_feed = _expected_feed_ids(conn, FEED_LIMIT)
        era_members = _era_slice_entities(conn, "bioguide_id", era, SLICE_LIMIT)
        era_tickers = _era_slice_entities(conn, "ticker", era, SLICE_LIMIT)
    finally:
        conn.close()

    # 8. build → publish → verify, on a local repo.
    backend = LocalDirBackend(data_repo)
    # Hermetic acceptance (no network, no published bundles): StagingNoop is
    # correct here, but it is passed EXPLICITLY — an implicit default is the
    # defect this run removes (RUN P3-3a R13).
    run_build(
        db_path, data_repo, now=lambda: MOMENT, raw_root=raw_root,
        backend=backend, attestation=StagingNoop()
    )
    run_publish(data_repo, now=lambda: MOMENT, backend=backend, attestation=StagingNoop())
    latest = json.loads((data_repo / "latest.json").read_text(encoding="utf-8"))
    build_dir = data_repo / "builds" / latest["build_id"]
    verify = run_verify(data_repo, now=lambda: MOMENT, attestation=StagingNoop())
    out(
        f"publish: build {latest['build_id']}"
        f" | verify: {'ok' if verify.ok else 'FAILED'}"
        f" | artifacts checked {verify.checked_artifacts}"
    )
    if not verify.ok:
        for error in verify.errors:
            out(f"  <-- verify: {error}")
        ok = False

    # 8a. the feed contract: EXACTLY the latest FEED_LIMIT rows, in order. An
    # era row can never appear here on a current corpus (the feed is the latest
    # 500 by filed date), so asserting "contains an era row" would fail a
    # correctly generated operational build.
    feed = json.loads((build_dir / "congress" / "feed.json").read_text(encoding="utf-8"))
    feed_ids = [row["txn_id"] for row in feed["rows"]]
    if not feed_matches_contract(feed_ids, expected_feed):
        out(
            f"  <-- congress/feed.json is not the database's latest"
            f" {FEED_LIMIT} rows (got {len(feed_ids)}, expected"
            f" {len(expected_feed)}; same order required)"
        )
        ok = False
    else:
        out(
            f"consumers: congress/feed.json == the DB's expected latest"
            f" {FEED_LIMIT} ({len(feed_ids)} rows, same ids, same order)"
        )

    # 8b. historical publication, proven where it is actually observable: the
    # slices whose own latest-SLICE_LIMIT window contains era rows.
    qualifying = 0
    for column, entities, folder in (
        ("bioguide_id", era_members, "members"),
        ("ticker", era_tickers, "tickers"),
    ):
        for entity in entities:
            path = build_dir / "congress" / folder / f"{entity}.json"
            if not path.is_file():
                # A ticker whose name is not a safe artifact name is skipped by
                # design (TD-6); its rows still live in the DB, feed, and stats.
                if folder == "tickers":
                    continue
                out(f"  <-- no published slice for {column} {entity!r}")
                ok = False
                continue
            document = json.loads(path.read_text(encoding="utf-8"))
            if not any(
                row["filed_date"].startswith(era) for row in document["rows"]
            ):
                out(f"  <-- the {entity!r} slice carries no {era} row")
                ok = False
            else:
                qualifying += 1
    if qualifying:
        out(
            f"  {qualifying} qualifying slice(s) carry {era} rows"
            f" ({len(era_members)} member / {len(era_tickers)} ticker entities"
            f" whose latest-{SLICE_LIMIT} window reaches the era)"
        )
    else:
        # A measured finding, not a false failure: on a large modern corpus no
        # entity's latest-200 window need reach 2015.
        out(
            f"  MEASURED: no entity's latest-{SLICE_LIMIT} window contains a"
            f" {era} row, so the era published no per-entity slice rows."
            " The era's publication is evidenced by the stats keys above."
        )

    # 9. entity + file budgets against the §9.10 assumptions and the hard cap.
    member_pages = len(list((build_dir / "congress" / "members").glob("*.json")))
    ticker_pages = len(list((build_dir / "congress" / "tickers").glob("*.json")))
    published_files = sum(1 for path in build_dir.rglob("*") if path.is_file())
    out(
        f"budget: member pages {member_pages} (~700 assumed)"
        f" | ticker pages {ticker_pages} (~2,500 assumed)"
        f" | published files {published_files} / {file_budget} M1 budget"
    )
    if not within_file_budget(published_files, file_budget):
        out(
            f"  <-- published files {published_files} exceed the hard M1 budget"
            f" of {file_budget} (ARCHITECTURE.md §9.10)"
        )
        ok = False
    return ok


# --- entry points ------------------------------------------------------------


def run_acceptance(out=print) -> int:
    """The hermetic gate: committed fixtures, zero sockets, never skips."""
    out(
        "RUN M1-B Phase A acceptance — hermetic historical chain"
        " (committed fixtures, zero sockets)"
    )
    tmp = Path(tempfile.mkdtemp(prefix="accept-m1-b-"))
    raw_root = tmp / "raw" / "house"
    db_path = tmp / "phase-a.db"
    conn = _new_db(db_path)
    ok = True
    try:
        if not _stage_house(conn, raw_root, out):
            ok = False
        out("verified-settled resume (R3):")
        if not _stage_verified_settled(conn, raw_root, out):
            ok = False
        out("fresh-database resume (R3):")
        if not _stage_fresh_db_resume(raw_root, tmp, out):
            ok = False
        if not _stage_senate(conn, tmp, out):
            ok = False
        if not _stage_members(conn, out):
            ok = False
    finally:
        conn.close()

    out("gate-miss surfacing on crafted eras (R5):")
    if not _stage_crafted_surfacing(tmp, out):
        ok = False

    data_repo = tmp / "data-repo"
    data_repo.mkdir(parents=True, exist_ok=True)
    if not assert_corpus(
        db_path, raw_root=raw_root, data_repo=data_repo, out=out
    ):
        ok = False

    out("")
    if ok:
        out(
            "ACCEPTANCE PASSED: discover→verified-settled→resume→evaluate→load→"
            "join→pair→gate→surface→stats→build→publish→verify on committed"
            " fixtures, with the feed matching the DB's latest 500 exactly and"
            " the published file count inside the M1 budget."
        )
        return 0
    out("ACCEPTANCE FAILED: see the markers above.")
    return 1


def run_operational_acceptance(
    db: Path | str, raw_root: Path | str | None, data_repo: Path | str, out=print
) -> int:
    """The same assertion body, against the real Phase A corpus (R18)."""
    out("RUN M1-B Phase A acceptance — OPERATIONAL mode (real corpus)")
    db_path = Path(db)
    if not db_path.is_file():
        out(f"ACCEPTANCE FAILED: {db_path} does not exist")
        return 1
    repo = Path(data_repo)
    repo.mkdir(parents=True, exist_ok=True)
    out(f"database: {db_path}")
    conn = sqlite3.connect(str(db_path))
    try:
        for table in ("filings", "transactions"):
            (count,) = conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()  # nosec B608
            out(f"  {table}: {count}")
    finally:
        conn.close()
    ok = assert_corpus(
        db_path,
        raw_root=Path(raw_root) if raw_root is not None else None,
        data_repo=repo,
        out=out,
    )
    out("")
    if ok:
        out(
            "ACCEPTANCE PASSED (operational): the same assertion body holds on"
            " the real Phase A corpus."
        )
        return 0
    out("ACCEPTANCE FAILED (operational): see the markers above.")
    return 1


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--db", help="operational mode: the real Phase A database")
    parser.add_argument("--raw-root", help="operational mode: the raw archive root")
    parser.add_argument("--data-repo", help="operational mode: a local data repo")
    args = parser.parse_args(argv)
    if args.db is None:
        return run_acceptance()
    if args.data_repo is None:
        parser.error("--data-repo is required with --db")
    return run_operational_acceptance(args.db, args.raw_root, args.data_repo)


if __name__ == "__main__":
    sys.exit(main())
