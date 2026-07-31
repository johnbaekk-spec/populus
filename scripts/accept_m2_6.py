#!/usr/bin/env python3
"""RUN M2-6 acceptance — the mandatory synchronous DEV gate (R8/R10/R15).

Run via ``make accept-m2-6``. Fully hermetic: a committed synthetic bulk corpus
(``tests/bulk_corpus.py``) is served through a ``_FakeSecTransport`` behind a
REAL :class:`~populus.net.sec_client.SecClient`, so the whole chain runs with
zero sockets under the same discipline as the test suite. It NEVER skips.

It drives, on committed bytes end to end:

    discover → rank → select top-N → drive the extended M2-2 seam
    → single finalize → measure coverage → build → publish (LocalDirBackend)
    → assert `inst` admitted to the manifest → INSTALL the published snapshot
    → SERVE it → assert `inst_health` provenance `published-snapshot`
    → one aggregate query returns corpus data with the snapshot build_id

plus a per-document cache-first RESUME sub-proof (R13): a second ingest over the
same raw archive with a FRESH counting transport and NO journal re-reads every
durable document with ZERO transport.

Reused populus code only; no second HTTP client, no forked ingest path.
"""

from __future__ import annotations

import json
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT / "src"))
sys.path.insert(0, str(REPO_ROOT / "tests"))

MOMENT = datetime(2026, 9, 30, tzinfo=timezone.utc)
NOW_ISO = "2026-09-30T00:00:00Z"
TOP_N = 5
COVERAGE_GATE = 0.95


class _FakeSecTransport:
    """Serves committed corpus bytes by URL; 404 for anything unknown."""

    def __init__(self, files: dict[str, bytes]) -> None:
        self.files = files
        self.requested: list[str] = []

    def get(self, url, *, headers):
        from populus.ingest import TransportResponse

        self.requested.append(url)
        content = self.files.get(url)
        if content is None:
            return TransportResponse(status_code=404, headers={}, content=b"")
        return TransportResponse(status_code=200, headers={}, content=content)


def _client(transport):
    from populus.net.sec_client import SecClient

    clock = iter(range(1, 10_000_000))
    return SecClient(
        transport, contact="accept@example.com",
        sleep=lambda _s: None, monotonic=lambda: next(clock),
    )


def _new_db(tmp: Path):
    from populus.amendments import ensure_views
    from populus.db import connect, init_db
    from populus.identity.registry import ensure_registry
    from populus.load import ensure_inst_schema

    path = tmp / "populus.db"
    init_db(str(path))
    conn = connect(str(path))
    ensure_registry(conn)
    ensure_inst_schema(conn)
    ensure_views(conn)
    return conn, path


def _seed_cusip(conn, cusip: str) -> None:
    """Seed a definitional CUSIP→security_id binding (the identity-coverage
    double, R11/LD-9): the acceptance proves the gate lifecycle, not the real
    13(f) list, so a seeded binding stands in for the list-seeded interval."""
    security_id = f"sec:accept:{cusip}"
    conn.execute(
        "INSERT INTO securities (security_id, id_state, review_state)"
        " VALUES (?, 'provisional', 'auto') ON CONFLICT DO NOTHING",
        (security_id,),
    )
    conn.execute(
        "INSERT INTO security_identifiers (security_id, id_type, value, valid_from,"
        " valid_to, provenance, confidence, review_state, license_id, raw)"
        " VALUES (?, 'cusip', ?, '2020-01-01', NULL, 'sec-ftd', 'high', 'auto',"
        " 'sec-ftd', NULL)",
        (security_id, cusip),
    )


def _build_and_publish(db_path: Path) -> tuple[Path, dict]:
    from populus.publish.build import LocalDirBackend, run_build, run_publish

    repo = Path(tempfile.mkdtemp(prefix="accept-m2-6-repo-"))
    backend = LocalDirBackend(repo)
    run_build(db_path, repo, now=lambda: MOMENT, backend=backend)
    run_publish(repo, now=lambda: MOMENT, backend=backend)
    latest = json.loads((repo / "latest.json").read_text(encoding="utf-8"))
    manifest = json.loads(
        (repo / "builds" / latest["build_id"] / "manifest.json").read_text(
            encoding="utf-8"
        )
    )
    return repo, manifest


def _install_and_serve(repo: Path, out) -> bool:
    """Install the published snapshot and serve it — the F6/R15 lifecycle."""
    from populus.client.snapshot import LocalRepoFetcher, SnapshotClient
    from populus.mcp_server.server import _inst_watermarks, build_server

    cache = Path(tempfile.mkdtemp(prefix="accept-m2-6-cache-"))
    inst_client = SnapshotClient(
        cache, LocalRepoFetcher(repo), now=lambda: MOMENT, module="inst"
    )
    inst_client.refresh()
    inst_db = inst_client.db_path()
    if inst_db is None:
        out("  <-- INSTALL FAILED: the published snapshot did not resolve an inst DB")
        return False
    build_id = inst_client.current_build()
    server = build_server(
        db_path=":memory:",
        build_id="cong-accept",
        inst_db_path=str(inst_db),
        inst_build_id=build_id,
        inst_watermarks=_inst_watermarks(inst_client.current_manifest()),
        inst_from_published_manifest=True,
        now=lambda: MOMENT,
    )

    def call(name, **kwargs):
        return server._tool_manager.get_tool(name).fn(**kwargs)

    ok = True
    health = call("inst_health")["results"]
    if health.get("provenance") != "published-snapshot":
        out(f"  <-- inst_health provenance is {health.get('provenance')!r},"
            " not 'published-snapshot'")
        ok = False
    else:
        out(f"  inst_health provenance: {health['provenance']}"
            f" | filers {health['counts']['filers']}"
            f" | snapshot_build {health['snapshot_build']}")

    lookup = call("inst_filer_lookup", query="MEGA")
    matches = lookup["results"].get("matches", [])
    if not matches:
        out("  <-- aggregate query returned no corpus data")
        ok = False
    elif lookup.get("build_id") != build_id:
        out(f"  <-- aggregate query build_id {lookup.get('build_id')!r}"
            f" != snapshot build_id {build_id!r}")
        ok = False
    else:
        out(f"  aggregate query inst_filer_lookup('MEGA'): {len(matches)} match(es)"
            f" with snapshot build_id {build_id}")
    return ok


def _resume_zero_transport(corpus, universe, raw_root: Path, out) -> bool:
    """R13 sub-proof: re-ingest over the SAME raw archive with a fresh counting
    transport and NO journal — every durable document is re-read with ZERO
    transport, so a durably archived document is never refetched."""
    import populus.inst_bulk as ib
    from populus.amendments import ensure_views
    from populus.db import connect, init_db
    from populus.identity.registry import ensure_registry
    from populus.load import ensure_inst_schema

    tmp = Path(tempfile.mkdtemp(prefix="accept-m2-6-resume-"))
    path = tmp / "resume.db"
    init_db(str(path))
    conn = connect(str(path))
    ensure_registry(conn)
    ensure_inst_schema(conn)
    ensure_views(conn)
    for cusip in corpus.cusips:
        _seed_cusip(conn, cusip)
    transport = ib.CountingTransport(_FakeSecTransport(corpus.url_map))
    client = _client(transport)
    clock = iter(range(1, 10_000_000))
    report = ib.run_bulk_ingest(
        conn, universe, client=client, transport=transport, raw_root=raw_root,
        run_id="accept-resume", now=lambda: NOW_ISO, host="accept",
        ingested_at=NOW_ISO, monotonic=lambda: next(clock), journal_path=None,
    )
    conn.close()
    if transport.attempts != 0:
        out(f"  <-- RESUME made {transport.attempts} transport call(s);"
            " a durable document must never be refetched")
        return False
    if report.loaded_filers != len(universe.entries):
        out(f"  <-- RESUME loaded {report.loaded_filers}/{len(universe.entries)}"
            " filers from the durable archive")
        return False
    out(f"  RESUME re-read every durable document with ZERO transport"
        f" ({report.loaded_filers} filers, {report.holdings_loaded} holdings)")
    return True


def run_acceptance(out=print) -> int:
    import populus.inst_bulk as ib
    from bulk_corpus import EXPECTED_EFFECTIVE, build_bulk_corpus

    out("RUN M2-6 acceptance — hermetic bulk 13F corpus (committed fixtures, zero sockets)")
    corpus = build_bulk_corpus()
    tmp = Path(tempfile.mkdtemp(prefix="accept-m2-6-"))
    conn, db_path = _new_db(tmp)
    for cusip in corpus.cusips:
        _seed_cusip(conn, cusip)

    transport = ib.CountingTransport(_FakeSecTransport(corpus.url_map))
    client = _client(transport)

    # 1. discover
    discovery = ib.discover_universe(client, corpus.filing_quarter)
    out(f"discover: {len(discovery.refs)} refs"
        f" (rejected {len(discovery.rejected)}) from {discovery.url}")

    # 2. rank (resumable rank journal, bound to refs_sha256)
    rank_journal = tmp / "rank-journal.json"
    rank_result = ib.rank_universe(
        client, discovery.refs, corpus.report_period, journal_path=rank_journal
    )
    ranking_ok = all(
        r.effective_value_usd == EXPECTED_EFFECTIVE.get(r.cik)
        for r in rank_result.ranked
    )
    out(f"rank: {len(rank_result.ranked)} filers ranked"
        f" (rank_failed {len(rank_result.rank_failed)})"
        f" | survivor values match v_default oracle: {'yes' if ranking_ok else 'NO'}")

    # 3. select top-N
    universe = ib.select_top_n(
        rank_result, corpus.filing_quarter, corpus.report_period, TOP_N
    )
    out(f"select: top-{TOP_N} = {list(universe.ciks)}")

    # 4-5. drive the extended seam + single finalize (measured)
    ingest_journal = tmp / "ingest-journal.json"
    raw_root = tmp / "raw"
    clock = iter(range(1, 10_000_000))
    report = ib.run_bulk_ingest(
        conn, universe, client=client, transport=transport, raw_root=raw_root,
        run_id="accept-ingest", now=lambda: NOW_ISO, host="accept",
        ingested_at=NOW_ISO, monotonic=lambda: next(clock),
        journal_path=ingest_journal,
    )
    coverage = report.coverage
    conn.close()
    out(f"ingest: {report.loaded_filers}/{report.universe_size} filers loaded"
        f" | {report.holdings_loaded} holdings"
        f" | reconciled {report.reconciled}"
        f" | attempts {report.session_metrics['attempts']}"
        f" retries {report.session_metrics['retries']}"
        f" 304s {report.session_metrics['not_modified']}"
        f" cache_hits {report.session_metrics['cache_hits']}")
    pct = f"{coverage.coverage:.4f}" if coverage.coverage is not None else "N/A"
    out(f"coverage: {coverage.numerator}/{coverage.denominator} = {pct}"
        f" | meets_threshold {coverage.meets_threshold}")
    # M2-7 §I5: an acceptance run that prints a coverage number prints what was
    # tolerated and excluded to reach it (external review F3).
    out(f"  {coverage.disposition_line}")

    # 6-7. build → publish → assert admission
    repo, manifest = _build_and_publish(db_path)
    inst_in_manifest = "inst" in manifest.get("modules", {})
    out(f"publish: inst in manifest = {inst_in_manifest}")

    ok = True
    if not ranking_ok:
        out("  <-- ranking value diverged from the v_default survivor oracle")
        ok = False
    if not report.ok:
        out("  <-- bulk ingest did not reconcile cleanly")
        ok = False
    if not (coverage.meets_threshold and coverage.coverage is not None
            and coverage.coverage >= COVERAGE_GATE):
        out("  <-- coverage did not meet the 0.95 gate")
        ok = False
    if not inst_in_manifest:
        out("  <-- inst was NOT admitted to the published manifest")
        ok = False

    # 8. install → serve
    out("install → serve:")
    if not _install_and_serve(repo, out):
        ok = False

    # 9. resume sub-proof (R13)
    out("resume (per-document cache-first, R13):")
    if not _resume_zero_transport(corpus, universe, raw_root, out):
        ok = False

    out("")
    if ok:
        out("ACCEPTANCE PASSED: discover→rank→drive→finalize→build→publish→install"
            "→serve on committed fixtures, ranking matches v_default, inst admitted,"
            " served with published-snapshot provenance, and durable resume refetches"
            " nothing.")
        return 0
    out("ACCEPTANCE FAILED: see the markers above.")
    return 1


def main() -> int:
    return run_acceptance()


if __name__ == "__main__":
    sys.exit(main())
