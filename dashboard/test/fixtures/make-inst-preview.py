"""Locked #19 — the NONSHIPPING institutional fixture-preview envelope.

Builds, with REAL producer code and zero producer edits:
  1. an identity-seeded 13F source DB (the ``tests/test_mcp_server_inst.py``
     mini-corpus pattern: AAPL/MSFT/NVDA securities linked ``entity:cik:<cik>``
     with ``link='resolved'``, Berkshire's two-period QoQ timeline, a second
     filer, and the SH→PRN unit-mismatch bond) — a raw-only corpus cannot emit
     ``entity:`` issuer keys, so the seed resolves identities BEFORE aggregation;
  2. a fresh ``inst_agg.db`` via ``populus.inst_agg.build_inst_agg``;
  3. (envelope mode) a temp build dir named after the dev build id, carrying the
     dev congress artifacts plus ``inst_agg.db`` and a manifest extended with
     the ``inst`` module EXACTLY per ``populus.publish.manifest`` policy, its
     watermarks derived from the seeded source DB's filings, validated by the
     real ``validate_manifest`` before anything is written.

Self-check: the mapped issuer ``entity:cik:0000320193`` (AAPL via the committed
``tests/fixtures/inst/mcp/company_tickers.json`` mapping fixture — reused, not
duplicated) must exist entity-keyed in ``agg_issuer_top_holders``; failing that
is a loud exit with remediation, never a silent skip.

Usage (from the repo root):
  uv run python dashboard/test/fixtures/make-inst-preview.py OUTDIR [--agg-only]
      [--data-repo PATH]

The last stdout line is a JSON object with the resolved paths, for the
post-build test harness. Then, printed above it, the exact commands:
  POPULUS_BUILD_DIR=<outdir>/builds/<id> POPULUS_DB=<congress.db> \
  POPULUS_TICKER_MAP=tests/fixtures/inst/mcp/company_tickers.json \
  npx astro build --outDir dist-fixture   (then: npx astro preview --outDir …)
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import shutil
import sqlite3
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(REPO_ROOT / "tests"))
sys.path.insert(0, str(REPO_ROOT / "src"))

from test_inst_agg import _entity, _filer, _hold, _load, _security  # noqa: E402

from populus.amendments import ensure_views  # noqa: E402
from populus.db import connect, init_db  # noqa: E402
from populus.inst_agg import build_inst_agg  # noqa: E402
from populus.normalize_inst import NORMALIZATION_VERSION  # noqa: E402
from populus.publish.digests import (  # noqa: E402
    LOGICAL_PROJECTION_VERSIONS,
    LOGICAL_PROJECTIONS,
    logical_digest,
)
from populus.publish.manifest import (  # noqa: E402
    INST_CLIENT_COMPAT,
    INST_DB_ARTIFACT,
    INST_MODULE,
    INST_SCHEMA_VERSION,
    render_manifest,
    validate_manifest,
)

AT = "2026-07-24T12:00:00Z"
MAP_FIXTURE = REPO_ROOT / "tests" / "fixtures" / "inst" / "mcp" / "company_tickers.json"

BRK = "0001067983"
OTHER = "0009000099"
BOND_FILER = "0009000077"
AAPL_CIK, MSFT_CIK, NVDA_CIK = "0000320193", "0000789019", "0001045810"
AAPL_ENTITY_KEY = "entity:cik:0000320193"


def seed_source(conn) -> None:
    """The resolved mini-corpus (tests/test_mcp_server_inst.py:52-85 pattern)."""
    for cik, sid in ((AAPL_CIK, "sec:aapl"), (MSFT_CIK, "sec:msft"), (NVDA_CIK, "sec:nvda")):
        _security(conn, sid, entity_id=_entity(conn, cik), link="resolved")
    _security(conn, "sec:bond")  # unresolved bond (name-keyed issuer)

    _filer(conn, BRK, "BERKSHIRE HATHAWAY INC")
    _load(conn, fid="inst:BRK-2025Q4", cik=BRK, period="2025-12-31", filed="2026-02-14",
          holds=[_hold(ordinal=1, issuer="APPLE INC", cusip="037833100", value=1000,
                       shares=100, security_id="sec:aapl"),
                 _hold(ordinal=2, issuer="MICROSOFT CORP", cusip="594918104", value=500,
                       shares=50, security_id="sec:msft")])
    _load(conn, fid="inst:BRK-2026Q1", cik=BRK, period="2026-03-31", filed="2026-05-15",
          holds=[_hold(ordinal=1, issuer="APPLE INC", cusip="037833100", value=2000,
                       shares=150, security_id="sec:aapl"),
                 _hold(ordinal=2, issuer="NVIDIA CORP", cusip="67066G104", value=300,
                       shares=30, security_id="sec:nvda")])
    _filer(conn, OTHER, "OTHER CAPITAL LLC")
    _load(conn, fid="inst:OTH-2026Q1", cik=OTHER, period="2026-03-31", filed="2026-05-14",
          holds=[_hold(ordinal=1, issuer="APPLE INC", cusip="037833100", value=800,
                       shares=40, security_id="sec:aapl")])
    # SH one quarter, PRN the next: ONE continuous position whose Δshares must
    # be NULL + shares_unit_mismatch (never a fabricated 0).
    _filer(conn, BOND_FILER, "BOND FUND LP")
    _load(conn, fid="inst:BND-2025Q4", cik=BOND_FILER, period="2025-12-31", filed="2026-02-10",
          holds=[_hold(ordinal=1, issuer="SOME BOND", cusip="123456789", value=100,
                       shares=10, unit="SH", security_id="sec:bond")])
    _load(conn, fid="inst:BND-2026Q1", cik=BOND_FILER, period="2026-03-31", filed="2026-05-10",
          holds=[_hold(ordinal=1, issuer="SOME BOND", cusip="123456789", value=200,
                       shares=20, unit="PRN", security_id="sec:bond")])


def build_fixture_agg(outdir: Path) -> tuple[Path, Path, dict]:
    """Seed → aggregate → self-check. Returns (source_db, agg_db, watermarks)."""
    source_dir = outdir / "source"
    source_dir.mkdir(parents=True, exist_ok=True)
    src = source_dir / "populus.db"
    if src.exists():
        src.unlink()
    init_db(str(src))
    conn = connect(str(src))
    seed_source(conn)
    ensure_views(conn)
    agg = outdir / "inst_agg.db"
    report = build_inst_agg(conn, agg, ingested_at=AT)
    row = conn.execute(
        "SELECT MAX(period_of_report), MAX(filed_date) FROM v_default_inst_filings"
    ).fetchone()
    watermarks = {"latest_period_of_report": row[0], "latest_filed_date": row[1]}
    conn.close()

    check = sqlite3.connect(str(agg))
    try:
        hit = check.execute(
            "SELECT COUNT(*) FROM agg_issuer_top_holders"
            " WHERE issuer_key = ? AND issuer_key_source = 'entity'",
            (AAPL_ENTITY_KEY,),
        ).fetchone()[0]
    finally:
        check.close()
    if hit == 0:
        sys.exit(
            f"SELF-CHECK FAILED: {AAPL_ENTITY_KEY} is not entity-keyed in"
            " agg_issuer_top_holders. The seed must resolve issuer identities"
            " BEFORE aggregation (securities linked entity_id with"
            " link='resolved') — a raw corpus falls back to cusip6:/name: keys"
            " and the mapped-ticker happy path is unbuildable. Fix the seed in"
            " dashboard/test/fixtures/make-inst-preview.py; do not relax the"
            " dashboard's entity-keyed match rule (Locked #18)."
        )
    if not MAP_FIXTURE.exists():
        sys.exit(f"SELF-CHECK FAILED: mapping fixture missing at {MAP_FIXTURE}")
    print(
        f"fixture aggregate: {report.filers} filers, {report.qoq_rows} qoq rows,"
        f" {report.issuer_rows} issuer rows, {report.concentration_rows} concentration rows",
        file=sys.stderr,
    )
    return src, agg, watermarks


def resolve_dev_build(data_repo: Path) -> tuple[str, Path, Path]:
    builds = data_repo / "builds"
    ids = sorted(
        (p.name for p in builds.iterdir() if re.match(r"^\d{8}\.\d+$", p.name)),
        key=lambda i: (i.split(".")[0], int(i.split(".")[1])),
    )
    if not ids:
        sys.exit(f"no builds under {builds}")
    build_id = ids[-1]
    db = data_repo / "releases" / f"data-{build_id}" / "congress.db"
    if not db.exists():
        sys.exit(f"congress.db not found at {db}")
    return build_id, builds / build_id, db


def assemble_envelope(outdir: Path, agg: Path, watermarks: dict, data_repo: Path) -> dict:
    build_id, dev_build_dir, congress_db = resolve_dev_build(data_repo)
    dest = outdir / "builds" / build_id
    if dest.exists():
        shutil.rmtree(dest)
    shutil.copytree(dev_build_dir, dest)
    shutil.copy2(agg, dest / INST_DB_ARTIFACT)

    manifest = json.loads((dest / "manifest.json").read_text(encoding="utf-8"))
    agg_bytes = (dest / INST_DB_ARTIFACT).read_bytes()
    agg_conn = sqlite3.connect(str(dest / INST_DB_ARTIFACT))
    try:
        inst_logical = logical_digest(agg_conn, LOGICAL_PROJECTIONS["inst"])
    finally:
        agg_conn.close()
    manifest["modules"][INST_MODULE] = {
        "schema_version": INST_SCHEMA_VERSION,
        "client_compat": INST_CLIENT_COMPAT,
        "deprecation": None,
        "normalization_version": NORMALIZATION_VERSION,
        "digest_projection_version": LOGICAL_PROJECTION_VERSIONS[INST_MODULE],
        "watermarks": watermarks,
        "artifacts": [
            {
                "name": INST_DB_ARTIFACT,
                "sha256": hashlib.sha256(agg_bytes).hexdigest(),
                "bytes": len(agg_bytes),
                "path": f"builds/{build_id}/{INST_DB_ARTIFACT}",
                "license_ids": ["us-gov-sec-edgar"],
                "logical_digest": inst_logical,
            }
        ],
    }
    errors = validate_manifest(
        manifest, required_modules=frozenset({"congress", INST_MODULE})
    )
    if errors:
        sys.exit("envelope manifest fails validate_manifest:\n" + "\n".join(errors))
    (dest / "manifest.json").write_text(render_manifest(manifest), encoding="utf-8")
    return {
        "build_id": build_id,
        "build_dir": str(dest),
        "congress_db": str(congress_db),
        "ticker_map": str(MAP_FIXTURE),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("outdir", type=Path)
    parser.add_argument("--agg-only", action="store_true",
                        help="build only the fixture aggregate DB (unit tests)")
    parser.add_argument("--data-repo", type=Path,
                        default=REPO_ROOT.parent / "populus-data")
    args = parser.parse_args()
    args.outdir.mkdir(parents=True, exist_ok=True)

    src, agg, watermarks = build_fixture_agg(args.outdir)
    if args.agg_only:
        print(json.dumps({"agg_db": str(agg), "source_db": str(src),
                          "watermarks": watermarks, "ticker_map": str(MAP_FIXTURE)}))
        return

    result = assemble_envelope(args.outdir, agg, watermarks, args.data_repo)
    print("# build the fixture preview with:", file=sys.stderr)
    print(
        f"POPULUS_BUILD_DIR={result['build_dir']} POPULUS_DB={result['congress_db']}"
        f" POPULUS_TICKER_MAP={result['ticker_map']}"
        " npx astro build --outDir dist-fixture",
        file=sys.stderr,
    )
    print("# then: npx astro preview --outDir dist-fixture", file=sys.stderr)
    print(json.dumps(result))


if __name__ == "__main__":
    main()
