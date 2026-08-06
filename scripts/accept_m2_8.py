#!/usr/bin/env python
"""RUN M2-8 T16 (plan R20) — end-to-end acceptance for the serving increment.

Follows the house pattern (`accept_m2_5.py`, `accept_m2_6.py`): it **never
skips**. Absent inputs are a hard failure with the exact missing paths named, so
a green result always means the path actually ran — not that it was unavailable.

The chain exercised, in the order the build performs it:

    corpus -> serving projection -> inst_serving.db -> manifest/digest contract
           -> producer/consumer seam -> flag classifier -> budget gate

Every number printed is measured from the run, never asserted from the plan.

QA M2-8 M3 — the two checks that verified nothing:

  * the producer/consumer column contract was `wanted = {c for c in
    activity_cols if ...}` followed by `check(wanted <= activity_cols, ...)`.
    `wanted` is built by comprehension OVER `activity_cols`, so the assertion was
    true by construction and could never fail — while being the ONLY guard on
    that contract. It is inverted below: the columns are extracted from the
    LOADER's own SELECT list and those are asserted to be produced.
  * the budget gate was `check_geometry(MeasuredGeometry(512, 512, 64, 64, 8,
    25 MiB))` — the maxima handed back in as the measurement, so every
    comparison was `value > value`. It is driven in BOTH directions below, and
    the real enforcing gate now measures a real `dist/`
    (`dashboard/test/post/file-budget.test.ts`).

The single-period affiliate fixture also meant `agg_qoq_deltas` was empty and the
activity grain emitted zero rows on every run, so the whole R13 path was
"checked by schema only". A two-period fixture is built here as well.
"""

from __future__ import annotations

import re
import sqlite3
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
sys.path.insert(0, str(ROOT / "tests"))

FAILURES: list[str] = []
NOTES: list[str] = []


def check(condition: bool, ok: str, bad: str) -> None:
    (NOTES if condition else FAILURES).append(ok if condition else bad)


def _loader_selected_columns(text: str, table_const: str) -> set[str]:
    """The columns the dashboard loader actually SELECTs from one table.

    Read out of the loader's own SQL rather than intersected with the producer's
    schema — an intersection can only ever return columns that already exist,
    which is precisely why the previous check could not fail.
    """
    # `(?:(?!SELECT).)*?` keeps the capture inside ONE statement. A plain `.*?`
    # starts at the FIRST SELECT in the file and runs to this table's FROM,
    # swallowing every intervening statement's columns — measured: it reported 25
    # columns for a 21-column table by merging in the filing dictionary's SELECT.
    match = re.search(
        r"SELECT\s+((?:(?!SELECT).)*?)\s+FROM\s+\$\{" + re.escape(table_const) + r"\}",
        text,
        re.DOTALL,
    )
    if match is None:
        return set()
    return {
        token.strip()
        for token in match.group(1).replace("\n", " ").split(",")
        if re.fullmatch(r"[a-z_][a-z0-9_]*", token.strip())
    }


def main() -> int:  # noqa: PLR0915 - a linear acceptance script, deliberately flat
    from populus.inst_agg import build_inst_agg
    from populus.inst_budget import (
        ACTIVITY_SHARDS_MAX,
        GLOBAL_FILE_CAP,
        M1_MEASURED_PAGES,
        M2_FILER_PAGES,
        M3_RESERVED,
        MAX_SHARD_BYTES,
        PROVIDER_FILE_LIMIT,
        SITE_CHROME_FILES,
        BudgetBreach,
        MeasuredGeometry,
        check_geometry,
        check_measured_tree,
        measure_tree,
        worst_case_file_count,
    )
    from populus.inst_flags import FLOOR_BPS, MIN_BASELINE_PERIODS, MULT
    from populus.inst_serving import (
        build_serving_projection,
        publication_periods,
        write_serving_db,
    )
    from populus.publish.digests import (
        ARTIFACT_PROJECTIONS,
        logical_digest,
        projection_for,
    )
    from populus.publish.manifest import (
        INST_DB_ARTIFACT,
        INST_MODULE,
        INST_SERVING_ARTIFACT,
        module_db_artifacts,
    )

    # --- 1. a real composed corpus (the committed affiliate fixture) ----------
    from test_filer_reported_views import _fresh, _seed_affiliate_pair

    tmp = Path(tempfile.mkdtemp())
    conn = _fresh(tmp, "accept.db")
    _seed_affiliate_pair(conn)
    conn.commit()
    period = "2026-03-31"

    proj = build_serving_projection(conn, periods=(period,))
    print(f"projection: {len(proj.filings)} filings | {len(proj.filer_rows)} filer rows"
          f" | {len(proj.issuer_holder_rows)} issuer-holder rows"
          f" | {len(proj.activity_rows)} activity rows")

    # The F13 property, end to end: the affiliate-suppressed filer is PRESENT.
    reporters = {r["filer_key"] for r in proj.issuer_holder_rows}
    check(
        reporters == {"0000000001", "0000000002"},
        f"both reporters present at issuer grain: {sorted(reporters)}",
        f"a reporter was lost by the projection: {sorted(reporters)}",
    )
    per_filer = {r["filer_key"]: r["value_usd"] for r in proj.issuer_holder_rows}
    dedup = {r["issuer_dedup_total_usd"] for r in proj.issuer_holder_rows}
    check(
        sum(per_filer.values()) != next(iter(dedup)),
        f"membership {sum(per_filer.values())} and dedup total {next(iter(dedup))}"
        " are distinct — the two fields were not conflated",
        "membership and dedup total are equal — the fields have been conflated",
    )

    # --- 2. the artifact -----------------------------------------------------
    dest = tmp / INST_SERVING_ARTIFACT
    write_serving_db(proj, str(dest), source_conn=conn)
    check(dest.is_file(), f"artifact emitted: {dest.name} ({dest.stat().st_size:,} B)",
          "the serving artifact was not written")

    out = sqlite3.connect(str(dest))
    tables = {r[0] for r in out.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")}
    projected = set(ARTIFACT_PROJECTIONS[INST_SERVING_ARTIFACT])
    check(projected == tables,
          f"the artifact's tables are EXACTLY its digest projection: {sorted(tables)}",
          "artifact tables and digest projection diverge —"
          f" undigested: {sorted(tables - projected)};"
          f" unproduced: {sorted(projected - tables)}")

    # The §5.5 integrity chain must actually close: `manifest.py` REQUIRES a
    # logical_digest for this artifact, and three of its four tables shipped with
    # no primary key — which `digests.py` hard-fails on. The artifact could be
    # written and never published.
    try:
        computed = logical_digest(
            out, projection_for(INST_SERVING_ARTIFACT, INST_MODULE))
        NOTES.append(f"logical_digest computes over the artifact: {computed[:16]}…")
    except Exception as exc:  # noqa: BLE001 - acceptance reports, never masks
        FAILURES.append(f"the artifact cannot carry a logical_digest: {exc}")

    # --- 3. NULL-honesty, against a fixture that actually contains a NULL -----
    # `WHERE value_usd = 0` over a fixture with no undisclosed values passes
    # vacuously. The affiliate pair has none, so a NULL-bearing corpus is built.
    from test_filer_reported_views import _filer_fn, _load_fn, _security
    from test_inst_agg import _hold

    APPLE, APPLE_B = "037833100", "037833200"
    nconn = _fresh(tmp, "accept_null.db")
    sid_a = _security(nconn, f"sec:{APPLE}")
    sid_b = _security(nconn, f"sec:{APPLE_B}")
    _filer_fn(nconn, "0000000031", "028-00031", "Null Co")
    _load_fn(
        nconn, fid="inst:NULLCO", cik="0000000031", period=period,
        filed="2026-04-15", file_number_norm="028-00031", total=100,
        holds=[
            _hold(ordinal=1, issuer="NULL CO", cusip=APPLE, value=100,
                  security_id=sid_a),
            _hold(ordinal=2, issuer="NULL CO", cusip=APPLE_B, value=None,
                  security_id=sid_b),
        ],
    )
    nconn.commit()
    nproj = build_serving_projection(nconn, periods=(period,))
    ndest = tmp / "inst_serving_null.db"
    write_serving_db(nproj, str(ndest), source_conn=nconn)
    nout = sqlite3.connect(str(ndest))
    nulls = nout.execute(
        "SELECT COUNT(*) FROM serving_filer_rows WHERE value_usd IS NULL").fetchone()[0]
    zeros = nout.execute(
        "SELECT COUNT(*) FROM serving_filer_rows WHERE value_usd = 0").fetchone()[0]
    check(nulls > 0,
          f"the NULL-honesty check is non-vacuous: {nulls} undisclosed row(s) present",
          "the NULL-honesty fixture carries no NULL — the check would pass vacuously")
    check(zeros == 0, "no fabricated zero in the artifact",
          f"{zeros} rows carry a fabricated 0 where the source was NULL")

    # --- 4. the publication contract ----------------------------------------
    names = module_db_artifacts(INST_MODULE)
    check(INST_SERVING_ARTIFACT in names and INST_DB_ARTIFACT in names,
          f"inst declares both databases: {names}",
          f"inst does not declare both databases: {names}")
    check(projection_for(INST_SERVING_ARTIFACT, INST_MODULE)
          != projection_for(INST_DB_ARTIFACT, INST_MODULE),
          "the two inst databases digest under DIFFERENT projections",
          "both inst databases share one projection — one schema would go undigested")

    # The PRODUCER call site: `publish/build.py` must actually emit the artifact.
    # Everything above this line passed for an entire increment while nothing in
    # `src/populus/publish/` referenced the producer at all.
    build_src = (ROOT / "src" / "populus" / "publish" / "build.py").read_text("utf-8")
    check("write_serving_db(" in build_src,
          "publish/build.py calls write_serving_db — the artifact has a producer",
          "NOTHING in publish/build.py produces inst_serving.db: the manifest entry,"
          " digest, six threaded boundaries and both consumers are dead code")
    check(f"name=INST_SERVING_ARTIFACT" in build_src,
          "publish/build.py enumerates the serving artifact in the inst manifest",
          "the serving artifact is written but never enumerated — every boundary"
          " skips a name the manifest does not list")

    # --- 5. producer/consumer seam ------------------------------------------
    try:
        from populus.mcp_server import server as mcp
        required = set(getattr(mcp, "_SERVING_REQUIRED_TABLES", ()) or ())
        check(bool(required) and required <= tables,
              f"MCP's required tables are all produced: {sorted(required)}",
              f"MCP requires tables the producer omits: {sorted(required - tables)}")
    except Exception as exc:  # noqa: BLE001 - acceptance reports, never masks
        FAILURES.append(f"could not verify the MCP seam: {exc}")

    # --- 6. the ACTIVITY grain, on a two-period corpus -----------------------
    # The committed affiliate fixture is SINGLE-PERIOD, so `agg_qoq_deltas` is
    # empty and the R13 path emitted zero rows on every previous run. This builds
    # the real aggregate over two quarters and projects against it, exactly as
    # `run_build` does (ATTACH, not a hand-seeded table).
    #
    # It also carries the UNDISCLOSED shapes, so §6b below is non-vacuous: the
    # activity grain's NULL-honesty had no coverage at all and `curr_shares or 0`
    # survived every gate including this one (QA M2-8 R2 N3).
    MSFT, NVDA, AMZN, TSLA = "594918104", "67066G104", "023135106", "88160R101"
    aconn = _fresh(tmp, "accept_activity.db")
    asid = _security(aconn, f"sec:{APPLE}")
    msid = _security(aconn, f"sec:{MSFT}")
    nsid = _security(aconn, f"sec:{NVDA}")
    zsid = _security(aconn, f"sec:{AMZN}")
    tsid = _security(aconn, f"sec:{TSLA}")
    _filer_fn(aconn, "0000000041", "028-00041", "Two Period Co")
    _load_fn(aconn, fid="inst:P1", cik="0000000041", period="2025-12-31",
             filed="2026-01-15", file_number_norm="028-00041",
             holds=[_hold(ordinal=1, issuer="APPLE INC", cusip=APPLE, value=1000,
                          security_id=asid),
                    _hold(ordinal=2, issuer="MICROSOFT CORP", cusip=MSFT, value=500,
                          security_id=msid),
                    # value disclosed now, withheld next quarter
                    _hold(ordinal=3, issuer="NVIDIA CORP", cusip=NVDA, value=800,
                          security_id=nsid),
                    # withheld now, disclosed next quarter (the mirror)
                    _hold(ordinal=4, issuer="AMAZON COM INC", cusip=AMZN, value=None,
                          shares=None, security_id=zsid)])
    _load_fn(aconn, fid="inst:P2", cik="0000000041", period="2026-03-31",
             filed="2026-04-15", file_number_norm="028-00041",
             holds=[_hold(ordinal=1, issuer="APPLE INC", cusip=APPLE, value=1500,
                          security_id=asid),
                    _hold(ordinal=2, issuer="NVIDIA CORP", cusip=NVDA, value=None,
                          shares=None, security_id=nsid),
                    _hold(ordinal=3, issuer="AMAZON COM INC", cusip=AMZN, value=900,
                          security_id=zsid),
                    # new this period: no prior position to have shares
                    _hold(ordinal=4, issuer="TESLA INC", cusip=TSLA, value=400,
                          security_id=tsid)])
    aconn.commit()
    agg_path = tmp / INST_DB_ARTIFACT
    build_inst_agg(aconn, agg_path, ingested_at="2026-07-24T12:00:00Z")
    aconn.execute("ATTACH DATABASE ? AS inst_agg", (str(agg_path),))
    try:
        aperiods = publication_periods(aconn)
        aproj = build_serving_projection(aconn, periods=aperiods)
    finally:
        aconn.execute("DETACH DATABASE inst_agg")

    print(f"activity: {len(aproj.activity_rows)} rows over periods {aperiods}")
    check(bool(aproj.activity_rows),
          f"the activity grain produced {len(aproj.activity_rows)} row(s) over"
          f" {len(aperiods)} periods — the R13 path is EXERCISED, not schema-only",
          "the two-period fixture produced no activity rows — the QoQ path is"
          " still unexercised")

    activity_issuer_keys = {r["issuer_key"] for r in aproj.activity_rows}
    issuer_grain_keys = {r["issuer_key"] for r in aproj.issuer_holder_rows}
    check(activity_issuer_keys and activity_issuer_keys <= issuer_grain_keys,
          f"activity issuer keys join the issuer grain: {sorted(activity_issuer_keys)}",
          "activity issuer keys do not resolve against the issuer grain —"
          f" unjoinable: {sorted(activity_issuer_keys - issuer_grain_keys)}")

    exits = [r for r in aproj.activity_rows if r["change_kind"] == "exit"]
    check(bool(exits) and all(r["issuer_key"] and r["issuer_name"] for r in exits),
          f"every exit row names the issuer it exited ({len(exits)} exit rows)",
          "an exit row carries no issuer — the feed cannot say what was exited")

    # --- 6b. NULL-honesty in the ACTIVITY grain, against the aggregate --------
    # §3 above checks `serving_filer_rows` only. The activity grain — the one
    # whose values render as change copy in the feed — reached the artifact
    # unchecked, and `"curr_shares": curr_shares or 0` passed 263 tests AND this
    # script. The comparison is against `agg_qoq_deltas`, the grain's actual
    # source: an undisclosed quantity must arrive as NULL, never as a number.
    ACTIVITY_NULLABLE = ("prev_value_usd", "curr_value_usd", "delta_value_usd",
                         "prev_shares", "curr_shares", "delta_shares")
    GRAIN = ("cik", "curr_period", "position_key", "put_call", "ssh_prnamt_type")
    adest = tmp / "inst_serving_activity.db"
    write_serving_db(aproj, str(adest), source_conn=aconn)
    aout = sqlite3.connect(str(adest))
    aout.row_factory = sqlite3.Row
    agg_conn = sqlite3.connect(str(agg_path))
    agg_conn.row_factory = sqlite3.Row
    src_rows = {tuple(r[k] for k in GRAIN): r
                for r in agg_conn.execute("SELECT * FROM agg_qoq_deltas")}
    art_rows = {tuple(r[k] for k in GRAIN): r
                for r in aout.execute("SELECT * FROM serving_activity")}
    undisclosed = [(key[2], col) for key, r in src_rows.items()
                   for col in ACTIVITY_NULLABLE if r[col] is None]
    covered = {col for _pk, col in undisclosed}
    check(covered == set(ACTIVITY_NULLABLE),
          f"the activity NULL-honesty check is non-vacuous:"
          f" {len(undisclosed)} undisclosed value(s) across all"
          f" {len(ACTIVITY_NULLABLE)} nullable columns",
          "the activity fixture leaves column(s) with no NULL, so the check"
          f" passes vacuously for: {sorted(set(ACTIVITY_NULLABLE) - covered)}")
    fabricated = [
        (key[2], col, art_rows[key][col])
        for key, r in src_rows.items() if key in art_rows
        for col in ACTIVITY_NULLABLE
        if r[col] is None and art_rows[key][col] is not None
    ]
    check(set(art_rows) == set(src_rows) and not fabricated,
          "every undisclosed activity quantity reaches serving_activity as NULL",
          f"the activity grain fabricated a value for an undisclosed quantity:"
          f" {fabricated}")

    # --- 7. the producer/consumer COLUMN contract (inverted; see module docs) -
    activity_cols = {r[1] for r in out.execute("PRAGMA table_info(serving_activity)")}
    loader = ROOT / "dashboard" / "src" / "lib" / "activity.ts"
    if loader.is_file():
        text = loader.read_text(encoding="utf-8")
        wanted = _loader_selected_columns(text, "ACTIVITY_TABLE")
        check(bool(wanted),
              f"the loader's SELECT list was read: {len(wanted)} columns",
              "could not extract the loader's SELECT list — the column contract"
              " check would pass vacuously")
        check(wanted <= activity_cols,
              f"every column the loader SELECTs is produced ({len(wanted)} checked)",
              f"the loader reads columns the producer omits: {sorted(wanted - activity_cols)}")
        filing_cols = {r[1] for r in out.execute("PRAGMA table_info(serving_filings)")}
        wanted_filings = _loader_selected_columns(text, "FILINGS_TABLE")
        check(bool(wanted_filings) and wanted_filings <= filing_cols,
              f"every filing-dictionary column the loader SELECTs is produced"
              f" ({len(wanted_filings)} checked)",
              f"the loader reads filing columns the producer omits:"
              f" {sorted(wanted_filings - filing_cols)}")
    else:
        FAILURES.append(f"MISSING: {loader}")

    # --- 8. flag constants are the owner's ----------------------------------
    check((MIN_BASELINE_PERIODS, MULT, FLOOR_BPS) == (4, 150, 500),
          f"OD-3 constants intact: {MIN_BASELINE_PERIODS}/{MULT}/{FLOOR_BPS}",
          f"OD-3 constants drifted: {MIN_BASELINE_PERIODS}/{MULT}/{FLOOR_BPS}")

    # --- 9. the budget gate, driven in BOTH directions -----------------------
    at_max = MeasuredGeometry(ACTIVITY_SHARDS_MAX, MAX_SHARD_BYTES)
    try:
        check_geometry(at_max)
        NOTES.append("geometry at its hard maxima verifies")
    except BudgetBreach as exc:
        FAILURES.append(f"geometry at its documented maxima does not verify: {exc}")
    try:
        check_geometry(at_max, activity_shards_max=ACTIVITY_SHARDS_MAX - 1)
        FAILURES.append(
            "check_geometry ACCEPTED a geometry one over its maximum — the gate"
            " cannot fail, which is the M3/C5c tautology returning")
    except BudgetBreach:
        NOTES.append("geometry one over its maximum is REFUSED — the gate can fail")

    # The real enforcing gate, over the real built tree when one exists.
    dist = ROOT / "dashboard" / "dist"
    if dist.is_dir():
        measured = measure_tree(dist)
        try:
            check_measured_tree(measured)
            NOTES.append(
                f"MEASURED dist/: {measured.file_count:,} files"
                f" (cap {GLOBAL_FILE_CAP:,}, provider {PROVIDER_FILE_LIMIT:,});"
                f" largest {measured.largest_file} at {measured.max_file_bytes:,} B")
        except BudgetBreach as exc:
            FAILURES.append(str(exc))
        try:
            check_measured_tree(measured, file_cap=measured.file_count - 1)
            FAILURES.append(
                "check_measured_tree ACCEPTED a tree over its cap — the enforcing"
                " gate cannot fail")
        except BudgetBreach:
            NOTES.append("a tree one file over the cap is REFUSED — the gate can fail")
    else:
        NOTES.append(
            f"dist/ absent at {dist} — the measured-tree gate runs in"
            " `npm run test:post` (dashboard/test/post/file-budget.test.ts), which"
            " is where a real build exists. Nothing is skipped there.")

    # The forward PROJECTION is reported, never asserted (see inst_budget docs).
    # Every term is PRINTED, so a term that stops being summed is visible in the
    # output rather than only in a total that quietly shrank (QA M2-8 R2 N1).
    projected_total = worst_case_file_count(measured_files=M1_MEASURED_PAGES)
    check(
        projected_total
        == M1_MEASURED_PAGES + SITE_CHROME_FILES + M2_FILER_PAGES
        + ACTIVITY_SHARDS_MAX + M3_RESERVED,
        "the forward projection sums every committed term",
        "the forward projection dropped a term — the total understates the"
        " breach the owner acts on, which is the C5(a) defect returning",
    )
    print()
    print(f"forward projection: measured M1 {M1_MEASURED_PAGES:,}"
          f" + site chrome {SITE_CHROME_FILES}"
          f" + M2 filer pages {M2_FILER_PAGES:,}"
          f" + activity shards {ACTIVITY_SHARDS_MAX}"
          f" + M3 reservation {M3_RESERVED:,}"
          f" = {projected_total:,} vs self-cap {GLOBAL_FILE_CAP:,}")
    if projected_total > GLOBAL_FILE_CAP:
        NOTES.append(
            f"RESERVATION BREACH (owner decision required): the corrected forward"
            f" projection is {projected_total:,} against a {GLOBAL_FILE_CAP:,}"
            f" self-cap — {projected_total - GLOBAL_FILE_CAP:,} over"
            f" (measured tree {M1_MEASURED_PAGES + SITE_CHROME_FILES:,} ="
            f" {M1_MEASURED_PAGES:,} M1 pages + {SITE_CHROME_FILES} site chrome;"
            f" the chrome class was measured and left OUT of this sum for a whole"
            f" remediation pass, understating the breach by {SITE_CHROME_FILES})."
            " NOTE the 2026-08-05 raise to 18,000 already spent the easy remedy,"
            " so this branch firing again means a reservation cut or a Pages-tier"
            " change — there is no third raise with margin left. The overrun is"
            " INHERITED (M1-B/M1-E grew dist/ with nothing counting it) and the"
            " measured tree still fits today, so this is surfaced for the owner"
            " rather than failing the build — the same rule accept-m1-b applies to"
            " a below-gate era. Resolving it means raising the self-cap toward the"
            f" {PROVIDER_FILE_LIMIT:,} provider limit, shrinking a reservation, or"
            " moving a data class off Pages. It must NOT be re-tuned away here.")

    # --- report --------------------------------------------------------------
    print()
    for note in NOTES:
        print(f"  ok   {note}")
    for bad in FAILURES:
        print(f"  FAIL {bad}")
    print()
    if FAILURES:
        print(f"ACCEPTANCE FAILED — {len(FAILURES)} check(s) (this command never skips)")
        return 1
    print("ACCEPTANCE PASSED: projection -> artifact -> digest -> manifest/producer ->"
          " seam -> activity grain -> column contract -> flag constants -> budget,"
          " on real composed fixtures.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
