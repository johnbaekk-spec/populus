/* Build-time data layer. Server-only (node:sqlite, fs) — never ships to the
   client. The site builds from ONE published data build, exactly per
   ARCHITECTURE §12.1: in CI the publisher passes the staged build explicitly;
   the dashboard never resolves latest.json (it is not a pointer consumer).

   Inputs (environment):
     POPULUS_BUILD_DIR  path to builds/<build_id> of the data repo   (CI: required)
     POPULUS_DB         path to the matching congress.db snapshot    (CI: required)
     POPULUS_DATA_REPO  dev convenience: a local data repo checkout; the newest
                        builds/<id> directory is used. Defaults to the sibling
                        ../populus-data of this repository. DEV ONLY.
*/

import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import path from "node:path";

import {
  type TxnRow,
  type PaperRow,
  type FeedItem,
  type StatTile,
  mergeFeed,
  txnToArray,
  paperToArray,
  TXN_COLS,
  PAPER_COLS,
  DATASET_VERSION,
} from "./format.ts";
import {
  groupEntities,
  parseTickerMap,
  buildSearchIndex,
  budgetWalk,
  servingSince,
  affTextOf,
  resolveTicker,
  tickerDataKey,
  DEFAULT_ENTITY_PAGE_BUDGET,
  type MemberEntity,
  type TickerEntity,
  type TickerMap,
} from "./derive.ts";
import { loadInstitutional, readTickerMapJson, type InstData } from "./inst.ts";

export type { StatTile, MemberEntity, TickerEntity };

export interface BuildData {
  buildId: string;
  generatedAt: string; // "YYYY-MM-DD HH:MM UTC"
  generatedAtDate: string; // "YYYY-MM-DD" — trailing-window / S7 calendar input
  codeSha: string;
  /* No manifest digest field exists, deliberately (Locked #6, R19): the
     manifest is re-assembled after the site builds, so any digest the site
     could compute is stale by construction. `manifest` (the parsed document)
     stays because module availability is derived from it, never assumed. */
  manifest: Record<string, any>; // parsed builds/<id>/manifest.json
  dataNote: string;
  stats: Record<string, any>; // parsed congress/stats.json (schema-validated upstream)
  /** The RAW bytes of congress/stats.json, verbatim and unparsed. `/stats.json`
      must be BYTE-equal to the canonical copy (R24, ARCHITECTURE §12.1) and the
      producer renders it as
      `json.dumps(…, ensure_ascii=False, indent=2, sort_keys=True) + "\n"`
      (`src/populus/stats.py`), which JS re-serialization cannot reproduce. So
      the bytes are carried through, never round-tripped. */
  statsJson: string;
  tiles: StatTile[];
  txns: TxnRow[];
  paper: PaperRow[];
  merged: FeedItem[];
  txnCount: number;
  paperCount: number;
  filedFrom: string; // earliest FILING year in this build
  tradesFrom: string; // earliest disclosed TRADE year (can precede filedFrom)
  dataset: string; // JSON string served at /congress/data/feed.v1.json
  dataLicenseMd: string;
  noticeTxt: string;
  /* --- entities (RUN P3-2) --- */
  members: MemberEntity[]; // every member in the extract (txn or paper)
  membersByKey: Map<string, MemberEntity>;
  tickers: TickerEntity[];
  tickersByKey: Map<string, TickerEntity>;
  cutMembers: Set<string>; // page-budget rank cuts (empty in ordinary builds)
  cutTickers: Set<string>;
  inst: InstData;
  tickerMap: TickerMap | null;
  searchIndexJson: string;
}

/** Modules present in this build's manifest — drives S1 surfaces and the S7
    suppression rule. Derived from the manifest, never assumed. */
export function moduleAvailability(build: BuildData): { congress: boolean; inst: boolean } {
  const modules = build.manifest?.modules ?? {};
  return { congress: "congress" in modules, inst: "inst" in modules };
}

/* ---------- source resolution ---------- */

// astro build/dev always runs with cwd = dashboard/ (module paths get
// rebundled under dist/, so import.meta.url is not usable for this).
const repoRoot = path.resolve(process.cwd(), "..");

function buildIdKey(id: string): [string, number] {
  const [d, n] = id.split(".");
  return [d ?? "", Number(n ?? 0)];
}

function resolveSources(): { buildDir: string; dbPath: string; buildId: string } {
  const envBuildDir = process.env.POPULUS_BUILD_DIR;
  const envDb = process.env.POPULUS_DB;
  if (envBuildDir && envDb) {
    // The build id comes from the MANIFEST inside the build, never from the
    // directory name. CI points POPULUS_BUILD_DIR at
    // `.staging/<build_id>/build`, so basename() yields the literal string
    // "build" — which is what the site published as its populus:build_id
    // marker on run 10, and what the record signer refused to attest:
    // "the downloaded artifact was built for 'build' but the attested pointer
    // publishes '20260807.4'". Dev never saw it because its fallback path ends
    // in the id. The manifest is the authority on its own identity.
    const manifestPath = path.join(envBuildDir, "manifest.json");
    if (!existsSync(manifestPath))
      throw new Error(`POPULUS_BUILD_DIR has no manifest.json: ${manifestPath}`);
    const declared = JSON.parse(readFileSync(manifestPath, "utf-8"))?.build_id;
    if (typeof declared !== "string" || declared.length === 0)
      throw new Error(`manifest.json declares no build_id: ${manifestPath}`);
    return { buildDir: envBuildDir, dbPath: envDb, buildId: declared };
  }
  if (envBuildDir || envDb) {
    throw new Error("POPULUS_BUILD_DIR and POPULUS_DB must be set together");
  }
  // The "newest local build" fallback below is a DEV convenience and must never
  // decide what a published site serves — CI passes the staged verified build
  // explicitly (§12.1). Hold that line in code, not just in documentation.
  if (process.env.CI) {
    throw new Error(
      "CI builds must set POPULUS_BUILD_DIR + POPULUS_DB explicitly —" +
        " the newest-local-build fallback is dev-only and is refused here",
    );
  }
  // Dev convenience: newest build in a local data-repo checkout.
  const dataRepo = process.env.POPULUS_DATA_REPO ?? path.resolve(repoRoot, "..", "populus-data");
  const buildsDir = path.join(dataRepo, "builds");
  if (!existsSync(buildsDir)) {
    throw new Error(
      `No data source: set POPULUS_BUILD_DIR + POPULUS_DB, or point POPULUS_DATA_REPO at a data repo (tried ${buildsDir})`,
    );
  }
  const ids = readdirSync(buildsDir).filter((n) => /^\d{8}\.\d+$/.test(n));
  if (ids.length === 0) throw new Error(`No builds found under ${buildsDir}`);
  ids.sort((a, b) => {
    const [da, na] = buildIdKey(a);
    const [db, nb] = buildIdKey(b);
    return da === db ? na - nb : da < db ? -1 : 1;
  });
  const buildId = ids[ids.length - 1]!;
  return {
    buildDir: path.join(buildsDir, buildId),
    dbPath: path.join(dataRepo, "releases", `data-${buildId}`, "congress.db"),
    buildId,
  };
}

/** Where the ONE canonical `stats.json` lives inside the data build. The site's
    `/stats.json` route serves these exact bytes (R24), so the byte-equality
    check has a single named source rather than a path re-derived per caller. */
export function statsSourcePath(): string {
  return path.join(resolveSources().buildDir, "congress", "stats.json");
}

/* ---------- row loading ---------- */

function partyCode(party: unknown): string {
  const p = String(party ?? "");
  if (p.startsWith("Democrat")) return "D";
  if (p.startsWith("Republican")) return "R";
  if (p.startsWith("Independent")) return "I";
  return "";
}

interface MemberDbMeta {
  name: string | null;
  party: string | null;
  state: string | null;
  district: string | null;
  chamber: string | null;
  terms: string | null;
  txnFilingCount: number;
  paperFilingCount: number;
}

function loadRows(dbPath: string): {
  txns: TxnRow[];
  paper: PaperRow[];
  memberMeta: Map<string, MemberDbMeta>;
} {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const txnRows = db
      .prepare(
        `SELECT t.filed_date, t.transaction_date, t.bioguide_id, t.chamber,
                t.ticker, t.side, t.owner, t.amount_low, t.amount_high,
                t.days_to_file, t.is_late, t.flags,
                f.doc_url, f.filer_name_raw,
                m.full_name, m.party, m.state, m.district
         FROM v_default_transactions t
         JOIN filings f ON f.filing_id = t.filing_id
         LEFT JOIN members m ON m.bioguide_id = t.bioguide_id
         ORDER BY t.filed_date DESC, t.transaction_date DESC, t.txn_id`,
      )
      .all() as Record<string, unknown>[];

    const txns: TxnRow[] = txnRows.map((r) => ({
      kind: "txn",
      filed: String(r.filed_date),
      traded: r.transaction_date == null ? null : String(r.transaction_date),
      name: String(r.full_name ?? r.filer_name_raw),
      bioguide: r.bioguide_id == null ? null : String(r.bioguide_id),
      party: r.bioguide_id == null ? "" : partyCode(r.party),
      state: r.state == null ? null : String(r.state),
      district: r.district == null ? null : String(r.district),
      chamber: r.chamber === "senate" ? "senate" : "house",
      ticker: r.ticker == null ? null : String(r.ticker),
      side: String(r.side) as TxnRow["side"],
      owner: r.owner == null ? null : (String(r.owner) as TxnRow["owner"]),
      low: r.amount_low == null ? null : Number(r.amount_low),
      high: r.amount_high == null ? null : Number(r.amount_high),
      lag: r.days_to_file == null ? null : Number(r.days_to_file),
      late: r.is_late == null ? null : (Number(r.is_late) as 0 | 1),
      flags: JSON.parse(String(r.flags ?? "[]")) as string[],
      doc: String(r.doc_url),
    }));

    const paperRows = db
      .prepare(
        `SELECT f.filed_date, f.bioguide_id, f.filer_name_raw, f.chamber, f.doc_url,
                m.full_name, m.party, m.state, m.district
         FROM filings f
         LEFT JOIN members m ON m.bioguide_id = f.bioguide_id
         WHERE f.parse_status = 'needs_ocr' AND f.lifecycle = 'active'
         ORDER BY f.filed_date DESC, f.filing_id`,
      )
      .all() as Record<string, unknown>[];

    const paper: PaperRow[] = paperRows.map((r) => ({
      kind: "paper",
      filed: String(r.filed_date),
      name: String(r.full_name ?? r.filer_name_raw),
      bioguide: r.bioguide_id == null ? null : String(r.bioguide_id),
      party: r.bioguide_id == null ? "" : partyCode(r.party),
      state: r.state == null ? null : String(r.state),
      district: r.district == null ? null : String(r.district),
      chamber: r.chamber === "senate" ? "senate" : "house",
      doc: String(r.doc_url),
    }));

    // Member metadata + per-member filing counts for the entity pages: one
    // query each, grouped in memory (Locked #2 — no per-entity SQL).
    const memberMeta = new Map<string, MemberDbMeta>();
    const metaRows = db
      .prepare(
        `SELECT m.bioguide_id, m.full_name, m.party, m.state, m.district,
                m.chamber, m.terms
         FROM members m
         WHERE m.bioguide_id IN (
           SELECT DISTINCT bioguide_id FROM v_default_transactions
            WHERE bioguide_id IS NOT NULL
           UNION
           SELECT DISTINCT bioguide_id FROM filings
            WHERE parse_status = 'needs_ocr' AND lifecycle = 'active'
              AND bioguide_id IS NOT NULL)`,
      )
      .all() as Record<string, unknown>[];
    for (const r of metaRows) {
      memberMeta.set(String(r.bioguide_id), {
        name: r.full_name == null ? null : String(r.full_name),
        party: r.party == null ? null : String(r.party),
        state: r.state == null ? null : String(r.state),
        district: r.district == null ? null : String(r.district),
        chamber: r.chamber == null ? null : String(r.chamber),
        terms: r.terms == null ? null : String(r.terms),
        txnFilingCount: 0,
        paperFilingCount: 0,
      });
    }
    const bump = (
      rows: Record<string, unknown>[],
      field: "txnFilingCount" | "paperFilingCount",
    ) => {
      for (const r of rows) {
        const meta = memberMeta.get(String(r.bioguide_id));
        if (meta) meta[field] = Number(r.c);
      }
    };
    bump(
      db
        .prepare(
          `SELECT bioguide_id, COUNT(DISTINCT filing_id) AS c
           FROM v_default_transactions WHERE bioguide_id IS NOT NULL
           GROUP BY bioguide_id`,
        )
        .all() as Record<string, unknown>[],
      "txnFilingCount",
    );
    bump(
      db
        .prepare(
          `SELECT bioguide_id, COUNT(*) AS c
           FROM filings
           WHERE parse_status = 'needs_ocr' AND lifecycle = 'active'
             AND bioguide_id IS NOT NULL
           GROUP BY bioguide_id`,
        )
        .all() as Record<string, unknown>[],
      "paperFilingCount",
    );

    return { txns, paper, memberMeta };
  } finally {
    db.close();
  }
}

/* ---------- stat tiles (derived from published stats.json, formulas stated) */

interface ParseCell {
  parsed?: number;
  partial?: number;
  needs_ocr?: number;
  total?: number;
}

function chamberParse(byYear: Record<string, ParseCell> | undefined): {
  parsed: number;
  partial: number;
  needsOcr: number;
  total: number;
} {
  let parsed = 0, partial = 0, needsOcr = 0, total = 0;
  for (const cell of Object.values(byYear ?? {})) {
    parsed += cell.parsed ?? 0;
    partial += cell.partial ?? 0;
    needsOcr += cell.needs_ocr ?? 0;
    total += cell.total ?? 0;
  }
  return { parsed, partial, needsOcr, total };
}

/** Coverage percentage that can never overstate itself: exactly "100" only when
    the numerator equals the denominator, and floored (never rounded up)
    otherwise — 2,499/2,500 prints 99.9, not 100. */
export function pct(num: number, den: number): string {
  if (den === 0) return "—";
  if (num === den) return "100";
  const v = (num / den) * 100;
  return Math.min(99.9, Math.floor(v * 10) / 10).toFixed(1);
}

/** Per-chamber e-file parse coverage, shared by the feed tiles, Home's module
    card, and the methodology page — one derivation, one denominator rule. */
export function coverageSummary(stats: Record<string, any>): {
  housePct: string;
  houseParsed: number;
  houseEfile: number;
  senatePct: string;
  senateParsed: number;
  senateEfile: number;
  needsOcr: number;
} {
  const cov = stats?.totals?.parse_coverage_primary_by_chamber_year_including_excluded;
  if (cov == null || typeof cov !== "object") {
    throw new Error(
      "stats.json is missing totals.parse_coverage_primary_by_chamber_year_including_excluded" +
        " — refusing to publish coverage derived from absent data",
    );
  }
  const house = chamberParse(cov.house);
  const senate = chamberParse(cov.senate);
  const houseEfile = house.total - house.needsOcr;
  const senateEfile = senate.total - senate.needsOcr;
  return {
    housePct: pct(house.parsed, houseEfile),
    houseParsed: house.parsed,
    houseEfile,
    senatePct: pct(senate.parsed, senateEfile),
    senateParsed: senate.parsed,
    senateEfile,
    needsOcr:
      stats?.totals?.needs_ocr_filing_count_including_excluded ??
      house.needsOcr + senate.needsOcr,
  };
}

function buildTiles(
  stats: Record<string, any>,
  rowCount: number,
  filedFrom: string,
): StatTile[] {
  const cov = stats?.totals?.parse_coverage_primary_by_chamber_year_including_excluded;
  if (cov == null || typeof cov !== "object") {
    // Publishing "0 filings / —%" would be a false coverage claim; fail loudly.
    throw new Error(
      "stats.json is missing totals.parse_coverage_primary_by_chamber_year_including_excluded" +
        " — refusing to publish coverage tiles derived from absent data",
    );
  }
  const house = chamberParse(cov.house);
  const senate = chamberParse(cov.senate);
  const houseEfile = house.total - house.needsOcr;
  const senateEfile = senate.total - senate.needsOcr;
  const needsOcr: number =
    stats?.totals?.needs_ocr_filing_count_including_excluded ?? house.needsOcr + senate.needsOcr;
  return [
    {
      value: rowCount.toLocaleString("en-US"),
      label: `rows filed since ${filedFrom}`,
      title:
        "transactions in the default view (active filings minus superseded amendment" +
        " originals). Counts filings made in this window; disclosed trade dates can be earlier.",
    },
    {
      // Label states the denominator the percentage actually divides — the
      // paper filings excluded from it get their own tile, not a silent share.
      value: pct(house.parsed, houseEfile),
      unit: "%",
      label: `House parse · ${houseEfile} e-filed`,
      title: `fully parsed ${house.parsed} of ${houseEfile} e-filed House PTRs; ${house.partial} partial. A further ${house.needsOcr} of ${house.total} total House filings are paper and not machine-readable — excluded from this denominator and counted in the paper tile.`,
    },
    {
      value: pct(senate.parsed, senateEfile),
      unit: "%",
      label: `Senate parse · ${senateEfile} e-filed`,
      title: `fully parsed ${senate.parsed} of ${senateEfile} e-filed Senate PTRs; ${senate.partial} partial. A further ${senate.needsOcr} of ${senate.total} total Senate filings are paper and not machine-readable — excluded from this denominator and counted in the paper tile.`,
    },
    {
      value: String(needsOcr),
      // Split by chamber so the parse tiles above are composable: a reader can
      // recover all-filings coverage per chamber without opening a tooltip.
      label:
        house.needsOcr + senate.needsOcr === needsOcr
          ? `paper · need OCR · ${house.needsOcr} H · ${senate.needsOcr} S`
          : "paper · need OCR",
      title:
        "filings submitted on paper — retained and counted in filing totals with zero" +
        " transaction rows, not yet machine-readable. Excluded from the parse" +
        " denominators above, which count e-filed filings only.",
      muted: true,
    },
  ];
}

/* ---------- assembly (memoized once per build process) ---------- */

let cache: BuildData | null = null;

export function getBuildData(): BuildData {
  if (cache) return cache;

  const { buildDir, dbPath, buildId } = resolveSources();
  if (!existsSync(dbPath)) throw new Error(`congress.db not found at ${dbPath}`);

  // Keep the raw text as well as the parse: `/stats.json` re-serves these exact
  // bytes (R24). Reading only the parse — as this did — made the canonical bytes
  // unreachable from the dashboard, and no re-serialization can recover them.
  const statsPath = path.join(buildDir, "congress", "stats.json");
  const statsJson = readFileSync(statsPath, "utf-8");
  const stats = JSON.parse(statsJson);
  const manifest = JSON.parse(readFileSync(path.join(buildDir, "manifest.json"), "utf-8"));
  const dataLicenseMd = readFileSync(path.join(buildDir, "DATA-LICENSE.md"), "utf-8");
  const noticeTxt = readFileSync(path.join(buildDir, "NOTICE"), "utf-8");

  const { txns, paper, memberMeta } = loadRows(dbPath);
  const merged = mergeFeed(txns, paper);

  // The tile counts rows *filed* in this build's window, so it must be labelled
  // by the filing window. Deriving it from min(traded) let a single 2023 trade
  // imply three years of coverage when every filing in the build is from 2026.
  let filedFrom = "";
  let tradesFrom = "";
  for (const t of txns) {
    const f = t.filed.slice(0, 4);
    if (!filedFrom || f < filedFrom) filedFrom = f;
    const y = (t.traded ?? t.filed).slice(0, 4);
    if (!tradesFrom || y < tradesFrom) tradesFrom = y;
  }

  const generatedAtIso = String(stats.generated_at ?? "");
  const generatedAt = generatedAtIso
    ? `${generatedAtIso.slice(0, 10)} ${generatedAtIso.slice(11, 16)} UTC`
    : "";

  let codeSha = process.env.SITE_CODE_SHA ?? "";
  if (!codeSha) {
    try {
      codeSha = execFileSync("git", ["rev-parse", "--short", "HEAD"], {
        cwd: repoRoot,
        encoding: "utf-8",
      }).trim();
    } catch {
      codeSha = "unknown";
    }
  }

  const rowCount: number = stats?.default?.row_count ?? txns.length;

  const dataset = JSON.stringify({
    dataset_version: DATASET_VERSION,
    build_id: buildId,
    generated_at: stats.generated_at ?? null,
    data_note: stats.data_note ?? "",
    txn_cols: TXN_COLS,
    paper_cols: PAPER_COLS,
    txns: txns.map(txnToArray),
    paper: paper.map(paperToArray),
  });

  const generatedAtDate = generatedAtIso.slice(0, 10);

  /* --- entity assembly (RUN P3-2, Locked #2) --- */
  const groups = groupEntities(txns, paper);
  const members: MemberEntity[] = [...groups.members.entries()]
    .map(([bioguide, g]) => {
      const meta = memberMeta.get(bioguide);
      const first = (g.txns[0] ?? g.paper[0])!;
      const chamber =
        meta?.chamber === "senate" || meta?.chamber === "house" ? meta.chamber : first.chamber;
      return {
        bioguide,
        name: meta?.name ?? first.name,
        party: meta?.party != null ? partyCode(meta.party) : first.party,
        state: meta?.state ?? first.state,
        district: meta?.district ?? first.district,
        chamber,
        servingSince: servingSince(meta?.terms ?? null),
        filingCount: (meta?.txnFilingCount ?? 0) + (meta?.paperFilingCount ?? 0),
        txns: g.txns,
        paper: g.paper,
      };
    })
    .sort((a, b) => (a.bioguide < b.bioguide ? -1 : 1));
  const membersByKey = new Map(members.map((m) => [m.bioguide, m]));

  const tickers: TickerEntity[] = [...groups.tickers.entries()]
    .map(([ticker, rows]) => ({ ticker, txns: rows }))
    .sort((a, b) => (a.ticker < b.ticker ? -1 : 1));
  const tickersByKey = new Map(tickers.map((t) => [t.ticker, t]));

  // Page-budget walk (Locked #13). POPULUS_TEST_PAGE_BUDGET is a build-time
  // test knob forcing a small budget so the generic-route path is provable;
  // the production constant sits far above the dev extract's entity count.
  const budgetEnv = process.env.POPULUS_TEST_PAGE_BUDGET;
  const budget =
    budgetEnv != null && /^\d+$/.test(budgetEnv) ? Number(budgetEnv) : DEFAULT_ENTITY_PAGE_BUDGET;
  const { cutMembers, cutTickers } = budgetWalk(
    members.map((m) => ({ bioguide: m.bioguide, rows: m.txns.length + m.paper.length })),
    tickers.map((t) => ({ ticker: t.ticker, rows: t.txns.length })),
    budget,
  );

  const inst = loadInstitutional(buildDir, manifest);
  const mapJson = readTickerMapJson(repoRoot);
  const tickerMap = mapJson === null ? null : parseTickerMap(mapJson);

  const searchIndexJson = JSON.stringify(
    buildSearchIndex(
      members.map((m) => ({
        bioguide: m.bioguide,
        name: m.name,
        aff: affTextOf(m),
        rows: m.txns.length + m.paper.length,
      })),
      tickers.map((t) => ({
        ticker: t.ticker,
        name: (() => {
          const res = resolveTicker(tickerMap, t.ticker);
          return res.state === "resolved" ? res.name : "";
        })(),
        rows: t.txns.length,
      })),
      inst.present ? inst.filers.map((f) => ({ cik: f.cik, name: f.filer_name })) : [],
    ),
  );

  cache = {
    buildId,
    generatedAt,
    generatedAtDate,
    codeSha,
    manifest,
    dataNote: String(stats.data_note ?? ""),
    stats,
    statsJson,
    tiles: buildTiles(stats, rowCount, filedFrom),
    txns,
    paper,
    merged,
    txnCount: txns.length,
    paperCount: paper.length,
    filedFrom,
    tradesFrom,
    dataset,
    dataLicenseMd,
    noticeTxt,
    members,
    membersByKey,
    tickers,
    tickersByKey,
    cutMembers,
    cutTickers,
    inst,
    tickerMap,
    searchIndexJson,
  };
  return cache;
}

/* ---------- per-entity endpoints (columnar, {v, kind, t, p, meta}) ---------- */

/** The unified ticker page's institutional section, serialized into the ticker
    endpoint so the client-rendered body and the prerendered body draw from one
    structure (parity by construction). */
export interface TickerInstSection {
  state: "module-absent" | "no-map" | "unmapped" | "ambiguous" | "resolved-no-data" | "data";
  name?: string; // mapped present-day issuer name (G14, † labeled)
  cik?: string;
  period?: string;
  latestFiled?: string | null;
  topn?: number;
  holders?: {
    rank: number;
    cik: string;
    name: string;
    value: number;
    securities: number;
    keySource: string;
    flags: string[];
  }[];
}

export function tickerInstSection(build: BuildData, ticker: string): TickerInstSection {
  if (!build.inst.present) return { state: "module-absent" };
  const res = resolveTicker(build.tickerMap, ticker);
  if (res.state === "no-map") return { state: "no-map" };
  if (res.state === "unmapped") return { state: "unmapped" };
  if (res.state === "ambiguous") return { state: "ambiguous" };
  const rows = build.inst.holdersByIssuer.get(res.issuerKey) ?? [];
  // Locked #18: match ONLY entity-keyed aggregate rows — a cusip6/name-keyed
  // issuer is never joined from a present-day ticker mapping.
  const entityRows = rows.filter((r) => r.issuer_key_source === "entity");
  if (entityRows.length === 0) {
    return { state: "resolved-no-data", name: res.name, cik: res.cik };
  }
  const periods = [...new Set(entityRows.map((r) => r.period_of_report))].sort();
  const period = periods.at(-1)!;
  return {
    state: "data",
    name: res.name,
    cik: res.cik,
    period,
    latestFiled: build.inst.watermarks.latest_filed_date,
    topn: build.inst.topn,
    holders: entityRows
      .filter((r) => r.period_of_report === period)
      .map((r) => ({
        rank: r.rank,
        cik: r.cik,
        name: r.filer_name,
        value: r.value_usd,
        securities: r.security_count,
        keySource: r.issuer_key_source,
        flags: r.flags,
      })),
  };
}

export function memberPayloadJson(build: BuildData, bioguide: string): string | null {
  const m = build.membersByKey.get(bioguide);
  if (!m) return null;
  return JSON.stringify({
    v: DATASET_VERSION,
    kind: "m",
    t: m.txns.map(txnToArray),
    p: m.paper.map(paperToArray),
    meta: {
      bioguide: m.bioguide,
      name: m.name,
      party: m.party,
      state: m.state,
      district: m.district,
      chamber: m.chamber,
      servingSince: m.servingSince,
      filingCount: m.filingCount,
      buildId: build.buildId,
      generatedAt: build.generatedAt,
      generatedAtDate: build.generatedAtDate,
    },
  });
}

export function tickerPayloadJson(build: BuildData, ticker: string): string | null {
  const t = build.tickersByKey.get(ticker);
  if (!t) return null;
  return JSON.stringify({
    v: DATASET_VERSION,
    kind: "t",
    t: t.txns.map(txnToArray),
    p: [],
    meta: {
      ticker: t.ticker,
      buildId: build.buildId,
      generatedAt: build.generatedAt,
      generatedAtDate: build.generatedAtDate,
      inst: tickerInstSection(build, t.ticker),
    },
  });
}

/** Endpoint filename keys (colon-safe) for every ticker in the extract. */
export function tickerDataKeys(build: BuildData): { key: string; ticker: string }[] {
  // Every ticker, no filter (Locked #13): tickerDataKey escapes every unsafe
  // byte, so even a ticker with a raw newline gets a well-formed endpoint.
  // Over-long keys carry a digest tail, so injectivity is asserted here — a
  // collision must fail the BUILD, never serve one ticker's data as another's.
  const keys = build.tickers.map((t) => ({ key: tickerDataKey(t.ticker), ticker: t.ticker }));
  const seen = new Map<string, string>();
  for (const { key, ticker } of keys) {
    const prior = seen.get(key);
    if (prior !== undefined && prior !== ticker)
      throw new Error(`ticker data key collision: ${JSON.stringify(prior)} and ${JSON.stringify(ticker)} both map to ${key}`);
    seen.set(key, ticker);
  }
  return keys;
}

/* ---------- methodology tiles (R8): every tile names its stats.json key ---- */

export interface MethodologyTile extends StatTile {
  /** dotted stats.json path(s) this tile derives from — asserted by tests so a
      mockup number with no live source cannot ship */
  statsKeys: string[];
  sub: string; // the mono sub-line under the label
}

export function methodologyM1Tiles(stats: Record<string, any>, filedFrom: string): MethodologyTile[] {
  const cov = coverageSummary(stats);
  const rowCount: number = stats.default.row_count;
  const unresolved: number = stats.totals.unresolved_pair_count;
  const late = stats.default.late_filing.overall;
  return [
    {
      value: cov.housePct,
      unit: "%",
      label: "House e-file parse",
      sub: `${cov.houseParsed} / ${cov.houseEfile} e-filed`,
      statsKeys: ["totals.parse_coverage_primary_by_chamber_year_including_excluded"],
    },
    {
      value: cov.senatePct,
      unit: "%",
      label: "Senate e-file parse",
      sub: `${cov.senateParsed} / ${cov.senateEfile} e-filed`,
      statsKeys: ["totals.parse_coverage_primary_by_chamber_year_including_excluded"],
    },
    {
      value: rowCount.toLocaleString("en-US"),
      label: `rows filed since ${filedFrom}`,
      sub: "v_default_transactions",
      statsKeys: ["default.row_count"],
    },
    {
      value: String(cov.needsOcr),
      label: "paper filings need OCR",
      sub: "retained, zero rows",
      muted: true,
      statsKeys: ["totals.needs_ocr_filing_count_including_excluded"],
    },
    {
      value: String(unresolved),
      label: "filer name-pairs unjoined",
      sub: "bioguide_id = null",
      muted: true,
      statsKeys: ["totals.unresolved_pair_count"],
    },
    {
      value: late.median_days_to_file == null ? "—" : `+${Math.round(late.median_days_to_file)}d`,
      label: "median days to file",
      sub: `${(late.late_count as number).toLocaleString("en-US")} late of ${(late.rows_with_late_status as number).toLocaleString("en-US")}`,
      statsKeys: ["default.late_filing.overall.median_days_to_file", "default.late_filing.overall.late_count"],
    },
  ];
}
