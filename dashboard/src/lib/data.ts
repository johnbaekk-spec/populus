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
  isCanonicalDate,
  mergeFeed,
  normalizeTicker,
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
import {
  concentrationFor,
  deltasFor,
  filerPeriods,
  loadInstitutional,
  readTickerMapJson,
  type InstData,
} from "./inst.ts";
import { filingWindow } from "./derive.ts";
import { boundQoqDeltas, selectTopFilers, type FilerBudgetState } from "./holdings.ts";
import { resolveServingDbPath } from "./activity.ts";
import {
  assembleFilerPayload,
  FILER_FRAGMENT_PARTS_MAX,
  FILER_FRAGMENT_SHARD_ENVELOPE_BYTES,
  FILER_TAIL_SHARDS_MAX,
  fragmentFilerPayload,
  readServingFilings,
  serializeFilerFragmentEntry,
  type FilerAggregateInputs,
  type FilerRouteV2,
} from "./filer-payload.ts";
import { paginateByBytes, SHARD_RESPONSE_CEILING_BYTES } from "./shards.ts";
import { buildSignalArtifact, validateSignalArtifact } from "./signals.ts";

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
  /* --- ALPHA-UX C-3 context (B-5/B-6 tables; null until a build carries them) --- */
  sectorData: SectorData | null;
  committeeData: CommitteeData | null;
}

export interface SectorData {
  /** issuer CIK (10-digit) → sector, resolved by the producer's taxonomy at ingest */
  sectorByCik: Map<string, string>;
  taxonomyVersion: string;
  asOf: string;
}

export interface CommitteeData {
  /** bioguide → memberships (with validity windows — the dating contract) */
  byMember: Map<
    string,
    { committeeId: string; name: string; role: string | null; validFrom: string; validTo: string }[]
  >;
  jurisdictionByCommittee: Map<string, string[]>;
  mappingVersion: string;
  snapshotDate: string;
  /** snapshot-WIDE validity bounds across all members (review F7): a member
      with zero rows inside this window is known-none, not unknown */
  windowFrom: string;
  windowTo: string;
}

/** Optional B-5/B-6 tables. Absence (older builds) is an explicit null the
    pages render as honest absence — never a guessed empty mix. */
/* internal: exported for tests (review F9) — the corruption/absence distinction is load-bearing. */
export function loadContext(dbPath: string): { sectorData: SectorData | null; committeeData: CommitteeData | null } {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  let sectorData: SectorData | null = null;
  let committeeData: CommitteeData | null = null;
  // Review F9: absence is detected EXPLICITLY (sqlite_master), never inferred
  // from a swallowed exception — schema drift, corruption, or a locked file
  // must fail the build loudly, not impersonate the legitimate "not in this
  // build" state.
  const hasTable = (name: string): boolean =>
    db
      .prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?`)
      .get(name) !== undefined;
  // Review F7: a table FAMILY is wholly absent (→ honest null), complete
  // (→ load), or PARTIAL (→ build failure) — a half-migrated or damaged build
  // must never masquerade as "not in this build".
  const familyState = (tables: string[]): "absent" | "complete" | "partial" => {
    const present = tables.filter(hasTable);
    return present.length === 0 ? "absent" : present.length === tables.length ? "complete" : "partial";
  };
  try {
    const sectorFamily = familyState(["issuer_sic", "sic_taxonomy_meta"]);
    if (sectorFamily === "partial") {
      throw new Error(
        "the B-5 sector table family is PARTIALLY present in this build's database — " +
          "a half-migrated or damaged build cannot pass as honest absence",
      );
    }
    if (sectorFamily === "complete") {
      const meta = new Map(
        (db.prepare(`SELECT key, value FROM sic_taxonomy_meta`).all() as Record<string, unknown>[]).map(
          (r) => [String(r.key), String(r.value)],
        ),
      );
      const sectorByCik = new Map<string, string>();
      for (const r of db.prepare(`SELECT cik, sector FROM issuer_sic`).all() as Record<string, unknown>[]) {
        sectorByCik.set(String(r.cik), String(r.sector));
      }
      // Review r3-F7: the family is COMPLETE here, so "empty" is a failed or
      // never-run ingest — a producer defect. Converting it to null would let
      // it wear the legitimate "not in this build" page.
      // The sector snapshot's own as-of date is displayed beside every sector
      // claim — same strictness (F0 full-set sweep).
      if (meta.has("snapshot_as_of") && !isCanonicalDate(meta.get("snapshot_as_of"))) {
        throw new Error(
          `sic_taxonomy_meta.snapshot_as_of is not a real YYYY-MM-DD date ` +
            `(${JSON.stringify(meta.get("snapshot_as_of"))}) — sector claims must carry a real as-of date`,
        );
      }
      if (sectorByCik.size === 0) {
        throw new Error(
          "the B-5 sector tables exist but hold no issuer rows — an empty or failed " +
            "ingest cannot pass as honest absence; run `populus sectors`, or drop the " +
            "tables if this build is deliberately without sector data",
        );
      }
      if (!meta.has("taxonomy_version") || !meta.has("snapshot_as_of")) {
        throw new Error(
          "issuer_sic is populated but sic_taxonomy_meta is missing its required keys — " +
            "refusing to render sector claims without their taxonomy provenance",
        );
      }
      sectorData = {
        sectorByCik,
        taxonomyVersion: meta.get("taxonomy_version")!,
        asOf: meta.get("snapshot_as_of")!,
      };
    }
    const committeeFamily = familyState(["committees", "committee_memberships", "committee_jurisdiction"]);
    if (committeeFamily === "partial") {
      throw new Error(
        "the B-6 committee table family is PARTIALLY present in this build's database — " +
          "a half-migrated or damaged build cannot pass as honest absence",
      );
    }
    if (committeeFamily === "complete") {
      /* Review c2r3-F2: the read below INNER-JOINs memberships to committees,
         so a row naming a committee the committees table does not carry would
         vanish silently — and one surviving membership keeps the family
         non-empty, so the affected member is then answered KNOWN-NONE instead
         of unknown. Count first and refuse the discrepancy: a partial or
         corrupted substrate must fail, never quietly erase a membership. */
      const sourceRows = Number(
        (db.prepare(`SELECT COUNT(*) AS n FROM committee_memberships`).get() as { n: number }).n,
      );
      const orphans = Number(
        (
          db
            .prepare(
              `SELECT COUNT(*) AS n FROM committee_memberships m
               WHERE NOT EXISTS (SELECT 1 FROM committees c WHERE c.committee_id = m.committee_id)`,
            )
            .get() as { n: number }
        ).n,
      );
      if (orphans > 0) {
        throw new Error(
          `${orphans} of ${sourceRows} committee_memberships rows name a committee absent from ` +
            `the committees table — the join would drop them silently and answer those members ` +
            `"known to have no committee"; refusing a partial committee substrate`,
        );
      }
      const byMember: CommitteeData["byMember"] = new Map();
      let snapshotDate = "";
      const snapshotDates = new Set<string>();
      const validFroms = new Set<string>();
      const validTos = new Set<string>();
      for (const r of db
        .prepare(
          `SELECT m.bioguide_id, m.committee_id, c.name, m.role, m.valid_from, m.valid_to, m.snapshot_date
           FROM committee_memberships m JOIN committees c ON c.committee_id = m.committee_id
           ORDER BY m.bioguide_id, m.committee_id`,
        )
        .all() as Record<string, unknown>[]) {
        const key = String(r.bioguide_id);
        let list = byMember.get(key);
        if (!list) {
          list = [];
          byMember.set(key, list);
        }
        list.push({
          committeeId: String(r.committee_id),
          name: String(r.name),
          role: r.role == null ? null : String(r.role),
          validFrom: String(r.valid_from),
          validTo: String(r.valid_to),
        });
        snapshotDates.add(String(r.snapshot_date));
        if (String(r.snapshot_date) > snapshotDate) snapshotDate = String(r.snapshot_date);
        validFroms.add(String(r.valid_from));
        validTos.add(String(r.valid_to));
      }
      const jurisdictionByCommittee = new Map<string, string[]>();
      const mappingVersions = new Set<string>();
      for (const r of db
        .prepare(`SELECT committee_id, sector, mapping_version FROM committee_jurisdiction`)
        .all() as Record<string, unknown>[]) {
        const cid = String(r.committee_id);
        let list = jurisdictionByCommittee.get(cid);
        if (!list) {
          list = [];
          jurisdictionByCommittee.set(cid, list);
        }
        list.push(String(r.sector));
        mappingVersions.add(String(r.mapping_version));
      }
      // Review r3-F8: overlap claims attribute to ONE mapping revision — rows
      // from mixed revisions (a half-applied re-ingest) cannot share a page
      // under a single arbitrary version label.
      if (mappingVersions.size > 1) {
        throw new Error(
          `committee_jurisdiction carries ${mappingVersions.size} mapping versions ` +
            `(${[...mappingVersions].sort().join(", ")}) — a half-applied re-ingest; ` +
            `every row must carry one version or the attribution is a lie`,
        );
      }
      if (snapshotDates.size > 1) {
        throw new Error(
          `committee_memberships carries ${snapshotDates.size} snapshot dates ` +
            `(${[...snapshotDates].sort().join(", ")}) — memberships are a full-replace ` +
            `snapshot; mixed dates mean a partial ingest`,
        );
      }
      /* Review c2-F2: the validity window is a property of the SNAPSHOT, and
         the ingest writes one `valid_from`/`valid_to` pair for every row. Mixed
         bounds therefore mean a partial ingest — and widening them to the outer
         hull would let a member whose rows begin later be reported as
         KNOWN to have no committee on dates their own rows never covered.
         Reject rather than widen. */
      if (validFroms.size > 1 || validTos.size > 1) {
        throw new Error(
          `committee_memberships carries ${validFroms.size} valid_from and ${validTos.size} ` +
            `valid_to values (${[...validFroms].sort().join(", ")} / ${[...validTos].sort().join(", ")}) — ` +
            `one full-replace snapshot has exactly one validity window; mixed bounds mean a ` +
            `partial ingest, and widening them would manufacture known-none answers`,
        );
      }
      let joinedRows = 0;
      for (const list of byMember.values()) joinedRows += list.length;
      if (joinedRows !== sourceRows) {
        throw new Error(
          `the committee membership join returned ${joinedRows} of ${sourceRows} source rows — ` +
            `rows were dropped by the read, which would silently erase memberships`,
        );
      }
      const mappingVersion = [...mappingVersions][0] ?? "";
      // Review r3-F7: complete-but-empty is a defect here too.
      if (byMember.size === 0) {
        throw new Error(
          "the B-6 committee tables exist but hold no memberships — an empty or failed " +
            "ingest cannot pass as honest absence; run `populus committees`, or drop the " +
            "tables if this build is deliberately without committee data",
        );
      }
      if (mappingVersion === "") {
        throw new Error(
          "committee memberships are present but committee_jurisdiction is empty — " +
            "the jurisdiction mapping must load with its family or overlap claims have no version",
        );
      }
      const windowFrom = [...validFroms][0] ?? "";
      const windowTo = [...validTos][0] ?? "";
      /* Review c2r2-F2: the window decides what is ANSWERABLE, so its bounds
         are validated as real calendar dates and ordered — a blank, malformed,
         impossible (`0000-00-00`, `2026-02-30`) or inverted pair would turn
         unsupported dates into known-none or membership answers. */
      for (const [field, value] of [
        ["valid_from", windowFrom],
        ["valid_to", windowTo],
        ["snapshot_date", snapshotDate],
      ] as const) {
        if (!isCanonicalDate(value)) {
          throw new Error(
            `committee_memberships.${field} is not a real YYYY-MM-DD date (${JSON.stringify(value)}) — ` +
              `refusing to answer membership questions against an unparseable window`,
          );
        }
      }
      if (windowFrom > windowTo) {
        throw new Error(
          `committee_memberships validity window is inverted (${windowFrom} → ${windowTo}) — ` +
            `an impossible window would make every date both inside and outside it`,
        );
      }
      {
        committeeData = {
          byMember,
          jurisdictionByCommittee,
          mappingVersion,
          snapshotDate,
          windowFrom,
          windowTo,
        };
      }
    }
  } finally {
    db.close();
  }
  return { sectorData, committeeData };
}

/* ---------- D-1: the per-build signal artifact (memoized like the build) --- */

let signalCache: import("./signals.ts").SignalArtifact | null = null;

/* D-1c lifecycle chaining (reviews F1 → r3-F1, r3-F2).

   The prior artifact is DURABLE: the publisher points POPULUS_PRIOR_SIGNALS
   at the previous published build's own copy in the data repo — not at a
   live-site fetch, so a transient outage cannot silently reset lifecycle
   history. Rules:

     * CI + prior path set   → the file MUST exist and pass the full schema
                               validator, else the build FAILS.
     * CI + no prior path    → allowed ONLY with the explicit one-time
                               bootstrap flag; otherwise fatal.
     * not CI (local dev)    → absent prior is a declared cold start, the
                               same dev-convenience seam `resolveSources`
                               uses for the build directory. */
export function resolvePriorSignalArtifact(): import("./signals.ts").SignalArtifact | null {
  let priorArtifact: import("./signals.ts").SignalArtifact | null = null;
  const priorPath = process.env.POPULUS_PRIOR_SIGNALS;
  const bootstrap = process.env.POPULUS_SIGNALS_BOOTSTRAP === "1";
  if (priorPath) {
  if (!existsSync(priorPath)) {
    throw new Error(
      `POPULUS_PRIOR_SIGNALS points at ${priorPath}, which does not exist — ` +
        `refusing to publish a silent cold start; restore the previous build's ` +
        `signals.v1.json or declare POPULUS_SIGNALS_BOOTSTRAP=1 deliberately`,
    );
  }
  const parsed: unknown = JSON.parse(readFileSync(priorPath, "utf-8"));
  const defects = validateSignalArtifact(parsed);
  if (defects.length > 0) {
    throw new Error(
      `POPULUS_PRIOR_SIGNALS (${priorPath}) is not a valid v1 signal artifact — ` +
        `chaining to it would erase lifecycle continuity while claiming to preserve it. ` +
        `Defects: ${defects.slice(0, 5).join("; ")}${defects.length > 5 ? ` (+${defects.length - 5} more)` : ""}`,
    );
  }
  priorArtifact = parsed as import("./signals.ts").SignalArtifact;
} else if (process.env.CI && !bootstrap) {
  throw new Error(
    "no prior signal artifact was supplied (POPULUS_PRIOR_SIGNALS unset) and this is not " +
      "a declared bootstrap — an ordinary published build must chain lifecycle state. " +
      "Set POPULUS_SIGNALS_BOOTSTRAP=1 for the ONE build that starts the chain.",
  );
}
  return priorArtifact;
}

export function getSignalArtifact(): import("./signals.ts").SignalArtifact {
  if (signalCache) return signalCache;
  const build = getBuildData();
  const resolve = sectorResolver(build);
  const priorArtifact = resolvePriorSignalArtifact();
  signalCache = buildSignalArtifact({
    priorArtifact,
    txns: build.txns,
    buildId: build.buildId,
    generatedAtDate: build.generatedAtDate,
    generatedAt: build.generatedAt,
    s5:
      build.committeeData !== null && resolve !== null
        ? {
            membershipsByMember: build.committeeData.byMember,
            windowFrom: build.committeeData.windowFrom,
            windowTo: build.committeeData.windowTo,
            jurisdictionByCommittee: build.committeeData.jurisdictionByCommittee,
            resolveSector: resolve,
          }
        : null,
  });
  return signalCache;
}

/** One sector-resolution rule for every consumer: ticker → unique issuer CIK
    (Locked #18 mapping, ambiguity refused) → producer-resolved sector. */
export function sectorResolver(build: BuildData): ((ticker: string) => import("./derive.ts").SectorResolution) | null {
  if (build.sectorData === null || build.tickerMap === null) return null;
  const { sectorByCik } = build.sectorData;
  const map = build.tickerMap;
  return (ticker: string) => {
    const res = resolveTicker(map, ticker);
    if (res.state !== "resolved") return { state: "unresolved-ticker" };
    const sector = sectorByCik.get(res.cik);
    return sector === undefined ? { state: "no-sic" } : { state: "sector", sector };
  };
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
        `SELECT t.txn_id, t.filed_date, t.transaction_date, t.bioguide_id, t.chamber,
                t.ticker, t.asset_name, t.asset_type, t.side, t.owner,
                t.amount_low, t.amount_high,
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
      txnId: String(r.txn_id),
      filed: String(r.filed_date),
      traded: r.transaction_date == null ? null : String(r.transaction_date),
      name: String(r.full_name ?? r.filer_name_raw),
      bioguide: r.bioguide_id == null ? null : String(r.bioguide_id),
      party: r.bioguide_id == null ? "" : partyCode(r.party),
      state: r.state == null ? null : String(r.state),
      district: r.district == null ? null : String(r.district),
      chamber: r.chamber === "senate" ? "senate" : "house",
      // B-7/F-5 parser gate: outer whitespace is stripped at the load boundary
      // so a "\n   AMCR"-style source value can never mint a second entity or
      // a whitespace URL slug.
      ticker: normalizeTicker(r.ticker == null ? null : String(r.ticker)),
      asset: r.asset_name == null ? null : String(r.asset_name),
      assetType: r.asset_type == null ? null : String(r.asset_type),
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
      inst.present
        ? // R22: search hits must carry the top/tail target too — a tail
          // filer hit linking to the pre-rendered route is a dressed 404.
          inst.filers.map((f) => ({
            cik: f.cik,
            name: f.filer_name,
            top: instTopFilerCiks(inst).has(f.cik),
          }))
        : [],
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
    ...loadContext(dbPath),
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
    /** R22: top/tail target for the holder's filer link — the client body
        renderer routes through `filerHref` with this, so a tail filer in a
        browser ticker payload never links into a 404. */
    tier: FilerBudgetState;
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
        tier: filerTier(build, r.cik),
      })),
  };
}

/* ---------- R22: the filer budget seams + the tail shard family ---------- */

/** Mirrored from `src/populus/inst_budget.py::FILER_TAIL_SHARDS_RESERVED` — a
    hard shard budget the tail family must fit inside (the walk FAILS past it,
    never truncates — LD-9/LD-10). Pinned against the Python constant by test. */
/* internal: exported for tests (F1) — the mirror test reads it; no other module does. */
export { FILER_TAIL_SHARDS_MAX };

/** LD-7 selection over the loaded aggregate — the ONE call site of
    `holdings.selectTopFilers` inputs: latest-period reported total value comes
    from the period concentration row (Locked #6 — the registry total is
    cumulative over ALL periods and is NOT a quarter's number). Memoized per
    aggregate object: `getStaticPaths`, every link producer, and the shard
    planner must see the same 1,500. */
const topFilerCache = new WeakMap<object, Set<string>>();
function instTopFilerCiks(inst: InstData): Set<string> {
  if (!inst.present) return new Set();
  let tops = topFilerCache.get(inst);
  if (!tops) {
    tops = new Set(
      selectTopFilers(
        inst.filers.map((f) => ({
          cik: f.cik,
          latestPeriodValueUsd:
            concentrationFor(inst, f.cik, f.latest_period)?.total_value_usd ?? null,
        })),
      ),
    );
    topFilerCache.set(inst, tops);
  }
  return tops;
}

export function topFilerCiks(build: BuildData): Set<string> {
  return instTopFilerCiks(build.inst);
}

export function filerTier(build: BuildData, cik: string): FilerBudgetState {
  return topFilerCiks(build).has(cik) ? "top" : "tail";
}

/** The aggregate half of a FilerPayloadV1 — exactly the `ui.filerBody` inputs
    the pre-rendered `[cik].astro` page uses, computed by ONE function so the
    page, the component, and the shard planner cannot drift (R22 parity). */
export function filerAggregateInputs(build: BuildData, cik: string): FilerAggregateInputs {
  const inst = build.inst;
  if (!inst.present) {
    return {
      concByPeriod: {},
      deltasByPeriod: {},
      deltaTotalsByPeriod: {},
      latestFiled: null,
      topn: 25,
      window: null,
    };
  }
  const periods = filerPeriods(inst, cik);
  /* RUN M2-12: the bound is applied HERE, at the one assembly point, because
     both filer renderers read this function — the pre-rendered top-1,500 page
     and the tail filer served through the shard family. Bounding in either
     renderer instead would leave the other unbounded and let the two drift,
     which is exactly the shape of the defect this replaces. */
  const bounded = periods.map((p) => [p, boundQoqDeltas(deltasFor(inst, cik, p))] as const);
  return {
    concByPeriod: Object.fromEntries(periods.map((p) => [p, concentrationFor(inst, cik, p)])),
    deltasByPeriod: Object.fromEntries(bounded.map(([p, b]) => [p, b.rows])),
    deltaTotalsByPeriod: Object.fromEntries(bounded.map(([p, b]) => [p, b.total])),
    latestFiled: inst.watermarks.latest_filed_date,
    topn: inst.topn,
    window: filingWindow(build.generatedAtDate),
  };
}

interface FilerShardFile {
  name: string;
  body: string;
  /** MEASURED byte length of `body` — not an estimate. */
  bytes: number;
  ciks: string[];
}

interface FilerShardFamily {
  present: boolean;
  /** Named absence, stated in the index body — a client must never have to
      infer "no tail" from an empty object. The ONLY absence is a genuinely
      absent module: with the module present, an unlocatable or unreadable
      serving artifact THROWS (build failure) rather than publishing an empty
      index whose every tail link is dead (Codex F7). */
  reason: "module-absent" | null;
  /** cik10 → inclusive shard range and exact fragment count. */
  routes: Record<string, FilerRouteV2>;
  indexBody: string;
  shards: FilerShardFile[];
}

function absentFamily(reason: Exclude<FilerShardFamily["reason"], null>): FilerShardFamily {
  return {
    present: false,
    reason,
    routes: {},
    indexBody: `{"v":2,"kind":"filer-index","absent":${JSON.stringify(reason)},"routes":{}}`,
    shards: [],
  };
}

/* One plan per build process: the index endpoint, the shard endpoints, and the
   post-build assertions must all describe the same family. */
let filerFamilyCache: { key: string; family: FilerShardFamily } | null = null;

/**
 * The tail shard family (R22, LD-9, LD-10): every published filer OUTSIDE the
 * LD-7 top 1,500, assembled once, split at record boundaries, and fed into the
 * ONE byte-bounded filler. The walk FAILS the build — never truncates or widens
 * — so every logical filer reconstructs from a bounded contiguous shard range.
 */
export function filerTailShards(build: BuildData): FilerShardFamily {
  const inst = build.inst;
  const dbPath = resolveServingDbPath();
  const key = `${build.buildId}|${dbPath ?? "(unresolvable)"}`;
  if (filerFamilyCache && filerFamilyCache.key === key) return filerFamilyCache.family;

  let family: FilerShardFamily;
  if (!inst.present) family = absentFamily("module-absent");
  else {
    // Codex F7: the absent-family path is reserved for a genuinely absent
    // module. With inst.present, a missing/unreadable serving artifact is a
    // BUILD FAILURE naming the path — never a silent empty routing index
    // whose every tail link is dead.
    if (!dbPath) {
      throw new Error(
        "inst module is present but no serving artifact path resolves " +
          "(POPULUS_INST_SERVING_DB / POPULUS_INST_DB / POPULUS_BUILD_DIR all unset) — " +
          "refusing to publish an empty filer routing index (R22)",
      );
    }
    if (!existsSync(dbPath)) {
      throw new Error(
        `inst module is present but the serving artifact ${dbPath} does not exist — ` +
          `refusing to publish an empty filer routing index (R22)`,
      );
    }
    let db: DatabaseSync;
    try {
      db = new DatabaseSync(dbPath, { readOnly: true });
    } catch (err) {
      throw new Error(
        `inst module is present but the serving artifact ${dbPath} cannot be opened ` +
          `(${(err as Error).message}) — refusing to publish an empty filer routing index (R22)`,
      );
    }
    {
      try {
        const filings = readServingFilings(db);
        const tops = instTopFilerCiks(inst);
        const tail = inst.filers
          .filter((f) => !tops.has(f.cik))
          .sort((a, b) => (a.cik < b.cik ? -1 : a.cik > b.cik ? 1 : 0));
        const servingDb = db;
        const items: { key: string; json: string }[] = [];
        const fragmentMeta = new Map<string, { cik: string; part: number; parts: number }>();
        const expectedParts = new Map<string, number>();
        for (const f of tail) {
          const payload = assembleFilerPayload(servingDb, {
            cik: f.cik,
            filerName: f.filer_name,
            latestPeriod: f.latest_period,
            requestedPeriod: f.latest_period,
            filings,
            agg: filerAggregateInputs(build, f.cik),
          });
          const fragments = fragmentFilerPayload(payload);
          expectedParts.set(f.cik, fragments.length);
          for (const fragment of fragments) {
            const key = `${fragment.cik}:${fragment.part}`;
            items.push({ key, json: serializeFilerFragmentEntry(fragment) });
            fragmentMeta.set(key, {
              cik: fragment.cik,
              part: fragment.part,
              parts: fragment.parts,
            });
          }
        }
        const plan = paginateByBytes(items, {
          overheadBytes: FILER_FRAGMENT_SHARD_ENVELOPE_BYTES,
          shardLimit: FILER_TAIL_SHARDS_MAX,
          itemNoun: "filer fragment",
        });
        const routes: Record<string, FilerRouteV2> = {};
        const seenParts = new Map<string, number[]>();
        const shards: FilerShardFile[] = plan.shards.map((s) => {
          const name = String(s.index);
          const body =
            `{"v":2,"kind":"filer-fragment-shard","shard":${s.index},` +
            `"shard_count":${plan.shards.length},` +
            `"entries":{${s.entries.map((e) => e.json).join(",")}}}`;
          const bytes = Buffer.byteLength(body);
          if (bytes > SHARD_RESPONSE_CEILING_BYTES) {
            // Unreachable by construction (the reservation is an upper bound).
            // Fail closed rather than publish a shard over the LD-10 ceiling.
            throw new Error(
              `filer fragment shard ${name} measured ${bytes} bytes, over the ` +
                `${SHARD_RESPONSE_CEILING_BYTES}-byte LD-10 ceiling`,
            );
          }
          const ciks = new Set<string>();
          for (const entry of s.entries) {
            const meta = fragmentMeta.get(entry.key);
            if (!meta) throw new Error(`missing fragment metadata for ${entry.key}`);
            ciks.add(meta.cik);
            const route = routes[meta.cik];
            if (route === undefined) routes[meta.cik] = [s.index, s.index, meta.parts];
            else {
              if (route[2] !== meta.parts) {
                throw new Error(`filer ${meta.cik} fragment total drifted inside the family`);
              }
              route[1] = s.index;
            }
            const observed = seenParts.get(meta.cik) ?? [];
            observed.push(meta.part);
            seenParts.set(meta.cik, observed);
          }
          return { name, body, bytes, ciks: [...ciks] };
        });
        // LD-9 completeness, asserted rather than trusted.
        for (const f of tail) {
          const parts = expectedParts.get(f.cik);
          const route = routes[f.cik];
          const observed = seenParts.get(f.cik) ?? [];
          if (parts === undefined || route === undefined) {
            throw new Error(
              `published tail filer ${f.cik} is missing from the routing index — ` +
                `the shard family is incomplete, which is a build failure (R22)`,
            );
          }
          if (parts < 1 || parts > FILER_FRAGMENT_PARTS_MAX
              || route[2] !== parts || route[1] - route[0] + 1 > parts
              || observed.length !== parts
              || observed.some((part, index) => part !== index)) {
            throw new Error(
              `published tail filer ${f.cik} has contradictory route/fragment geometry`,
            );
          }
        }
        const indexBody =
          `{"v":2,"kind":"filer-index","absent":null,"routes":{` +
          tail.map((f) => `${JSON.stringify(f.cik)}:${JSON.stringify(routes[f.cik])}`).join(",") +
          `}}`;
        const indexBytes = Buffer.byteLength(indexBody);
        if (indexBytes > SHARD_RESPONSE_CEILING_BYTES) {
          throw new Error(
            `filer routing index measured ${indexBytes} bytes, over the ` +
              `${SHARD_RESPONSE_CEILING_BYTES}-byte client-response ceiling`,
          );
        }
        family = { present: true, reason: null, routes, indexBody, shards };
      } finally {
        db.close();
      }
    }
  }
  filerFamilyCache = { key, family };
  return family;
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
