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

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import path from "node:path";

import {
  type TxnRow,
  type PaperRow,
  type FeedItem,
  mergeFeed,
  txnToArray,
  paperToArray,
  TXN_COLS,
  PAPER_COLS,
  DATASET_VERSION,
} from "./format";

export interface StatTile {
  value: string;
  unit?: string;
  label: string;
  title?: string; // full breakdown for the tooltip
  muted?: boolean;
}

export interface BuildData {
  buildId: string;
  generatedAt: string; // "YYYY-MM-DD HH:MM UTC"
  codeSha: string;
  manifestShaAbbrev: string; // "9f2c…41aa"
  manifestSha: string;
  dataNote: string;
  tiles: StatTile[];
  txns: TxnRow[];
  paper: PaperRow[];
  merged: FeedItem[];
  txnCount: number;
  sinceYear: string;
  dataset: string; // JSON string served at /congress/data/feed.v1.json
  dataLicenseMd: string;
  noticeTxt: string;
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
    return { buildDir: envBuildDir, dbPath: envDb, buildId: path.basename(envBuildDir) };
  }
  if (envBuildDir || envDb) {
    throw new Error("POPULUS_BUILD_DIR and POPULUS_DB must be set together");
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

/* ---------- row loading ---------- */

function partyCode(party: unknown): string {
  const p = String(party ?? "");
  if (p.startsWith("Democrat")) return "D";
  if (p.startsWith("Republican")) return "R";
  if (p.startsWith("Independent")) return "I";
  return "";
}

function loadRows(dbPath: string): { txns: TxnRow[]; paper: PaperRow[] } {
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

    return { txns, paper };
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

function pct(num: number, den: number): string {
  if (den === 0) return "—";
  const v = (num / den) * 100;
  const s = v >= 99.95 ? "100" : v.toFixed(1);
  return s;
}

function buildTiles(stats: Record<string, any>, rowCount: number, sinceYear: string): StatTile[] {
  const cov = stats?.totals?.parse_coverage_primary_by_chamber_year_including_excluded ?? {};
  const house = chamberParse(cov.house);
  const senate = chamberParse(cov.senate);
  const houseEfile = house.total - house.needsOcr;
  const senateEfile = senate.total - senate.needsOcr;
  const needsOcr: number =
    stats?.totals?.needs_ocr_filing_count_including_excluded ?? house.needsOcr + senate.needsOcr;
  return [
    {
      value: rowCount.toLocaleString("en-US"),
      label: `rows since ${sinceYear}`,
      title: "transactions in the default view (active filings minus superseded amendment originals)",
    },
    {
      value: pct(house.parsed, houseEfile),
      unit: "%",
      label: `House parse · ${house.total} filings`,
      title: `fully parsed ${house.parsed} of ${houseEfile} e-filed House PTRs (${house.partial} partial, ${house.needsOcr} paper/need-OCR of ${house.total} total)`,
    },
    {
      value: pct(senate.parsed, senateEfile),
      unit: "%",
      label: `Senate parse · ${senate.total} filings`,
      title: `fully parsed ${senate.parsed} of ${senateEfile} e-filed Senate PTRs (${senate.partial} partial, ${senate.needsOcr} paper/need-OCR of ${senate.total} total)`,
    },
    {
      value: String(needsOcr),
      label: "paper · need OCR",
      title: "filings submitted on paper — retained and counted, not yet machine-readable",
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

  const statsPath = path.join(buildDir, "congress", "stats.json");
  const stats = JSON.parse(readFileSync(statsPath, "utf-8"));
  const manifestBytes = readFileSync(path.join(buildDir, "manifest.json"));
  const manifestSha = createHash("sha256").update(manifestBytes).digest("hex");
  const dataLicenseMd = readFileSync(path.join(buildDir, "DATA-LICENSE.md"), "utf-8");
  const noticeTxt = readFileSync(path.join(buildDir, "NOTICE"), "utf-8");

  const { txns, paper } = loadRows(dbPath);
  const merged = mergeFeed(txns, paper);

  let sinceYear = "";
  for (const t of txns) {
    const y = (t.traded ?? t.filed).slice(0, 4);
    if (!sinceYear || y < sinceYear) sinceYear = y;
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

  cache = {
    buildId,
    generatedAt,
    codeSha,
    manifestSha,
    manifestShaAbbrev: `${manifestSha.slice(0, 4)}…${manifestSha.slice(-4)}`,
    dataNote: String(stats.data_note ?? ""),
    tiles: buildTiles(stats, rowCount, sinceYear),
    txns,
    paper,
    merged,
    txnCount: txns.length,
    sinceYear,
    dataset,
    dataLicenseMd,
    noticeTxt,
  };
  return cache;
}
