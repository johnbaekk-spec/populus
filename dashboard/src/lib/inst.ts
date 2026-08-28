/* Institutional (13F) adapter. Server-only (node:sqlite) — binds the dashboard
   to the PUBLISHED aggregate contract, src/populus/inst_agg.sql, verbatim:
   integer columns that are NULL when legitimately unavailable (never a
   fabricated zero), canonical sorted JSON flag arrays, and the five tables the
   producer ships. Per M2-CONTRACT §3 the dashboard receives aggregate slices
   only. Per-filer holdings detail is NOT yet read here; M2-CONTRACT §3 was amended
   2026-08-02 to serve it, and the serving projection this module
   will read is added separately. Until then this file intentionally reads agg_* only.

   Period-correct sourcing: `agg_filer_registry` supplies identity
   (name, latest_period) — its count/value fields accumulate over ALL retained
   periods (inst_agg.py builds them without a period predicate) and are NOT
   period stats; every period-scoped number comes from
   `agg_filer_concentration` for the selected period. */

import { existsSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import path from "node:path";

/* ---------- row types mirroring inst_agg.sql ---------- */

export interface FilerRegistryRow {
  cik: string;
  filer_name: string;
  latest_period: string;
  /** cumulative over ALL retained periods — identity context only, never a
      quarter's number */
  position_count: number;
  total_value_usd: number;
  null_value_positions: number;
  unkeyed_positions: number;
}

export interface QoqDeltaRow {
  cik: string;
  position_key: string; // 'sid:<security_id>' | 'cusip:<cusip>'
  put_call: "LONG" | "PUT" | "CALL";
  curr_period: string;
  prev_period: string;
  change_kind: "new" | "add" | "trim" | "exit" | "unclassified";
  prev_value_usd: number | null;
  curr_value_usd: number | null;
  delta_value_usd: number | null;
  prev_shares: number | null;
  curr_shares: number | null;
  delta_shares: number | null;
  ssh_prnamt_type: "SH" | "PRN" | "UNKNOWN";
  flags: string[];
}

export interface TopHolderRow {
  issuer_key: string; // 'entity:<id>' | 'cusip6:<6>' | 'name:<norm>'
  period_of_report: string;
  rank: number;
  cik: string;
  filer_name: string;
  issuer_name: string;
  issuer_key_source: "entity" | "cusip6" | "name";
  value_usd: number;
  security_count: number;
  flags: string[];
}

export interface ConcentrationRow {
  cik: string;
  period_of_report: string;
  position_count: number;
  total_value_usd: number;
  null_value_positions: number;
  topn_value_usd: number;
  topn_share_bps: number | null; // NULL when total <= 0 (concentration_unavailable)
  hhi: number | null;
  flags: string[];
}

export interface InstWatermarks {
  latest_period_of_report: string | null;
  latest_filed_date: string | null;
}

export type InstData =
  | { present: false; reason: "module-absent" | "artifact-missing" }
  | {
      present: true;
      watermarks: InstWatermarks;
      topn: number;
      filers: FilerRegistryRow[];
      deltasByCik: Map<string, QoqDeltaRow[]>;
      concentrationByCik: Map<string, ConcentrationRow[]>;
      holdersByIssuer: Map<string, TopHolderRow[]>;
      /** R21: leaderboard rows keyed `${period}|${mode}` */
      addsByPeriodMode: Map<string, AddsRow[]>;
      /** R21: ambiguous-identity exclusion count keyed `${period}|${mode}` */
      addsExclusions: Map<string, number>;
      /** F15: every reporting period the CORPUS carries, ascending.
          Derived from `agg_filer_concentration`, which has a row for every
          filer-period on record — not from `agg_issuer_adds`, which only has
          rows for periods that happened to contain a new or added position.
          A genuinely closed quarter in which nothing was added is still a
          selectable quarter; inferring the list from activity made period
          CARDINALITY depend on activity, which R20 does not. */
      addsPeriods: string[];
      /** R11: curated typing for MATCHED filers only, keyed by padded CIK */
      typingByCik: Map<string, ManagerTyping>;
    };

function parseFlags(raw: unknown): string[] {
  try {
    const parsed = JSON.parse(String(raw ?? "[]"));
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

import {
  compareAddsRows,
  type AddsMode,
  type AddsRow,
} from "./inst-adds.ts";
import type { ManagerTyping } from "./manager-directory.ts";

function intOrNull(v: unknown): number | null {
  return v == null ? null : Number(v);
}

/** Load the whole published aggregate. Present requires BOTH the manifest's
    `inst` module entry AND a readable inst_agg.db — a declared module whose
    artifact cannot be read degrades to honest absence, never a partial page.
    The aggregate is small by construction (top-N slices), so one full read
    per build process is the simple, deterministic path. */
export function loadInstitutional(
  buildDir: string,
  manifest: { modules?: Record<string, { watermarks?: Record<string, unknown> }> },
): InstData {
  const module = manifest.modules?.inst;
  if (!module) return { present: false, reason: "module-absent" };
  const dbPath = process.env.POPULUS_INST_DB ?? path.join(buildDir, "inst_agg.db");
  if (!existsSync(dbPath)) return { present: false, reason: "artifact-missing" };

  const watermarks: InstWatermarks = {
    latest_period_of_report:
      module.watermarks?.latest_period_of_report == null
        ? null
        : String(module.watermarks.latest_period_of_report),
    latest_filed_date:
      module.watermarks?.latest_filed_date == null
        ? null
        : String(module.watermarks.latest_filed_date),
  };

  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const filers = (
      db.prepare(
        `SELECT cik, filer_name, latest_period, position_count, total_value_usd,
                null_value_positions, unkeyed_positions
         FROM agg_filer_registry ORDER BY cik`,
      ).all() as Record<string, unknown>[]
    ).map((r) => ({
      cik: String(r.cik),
      filer_name: String(r.filer_name),
      latest_period: String(r.latest_period),
      position_count: Number(r.position_count),
      total_value_usd: Number(r.total_value_usd),
      null_value_positions: Number(r.null_value_positions),
      unkeyed_positions: Number(r.unkeyed_positions),
    }));

    const deltasByCik = new Map<string, QoqDeltaRow[]>();
    for (const r of db
      .prepare(
        `SELECT cik, position_key, put_call, curr_period, prev_period, change_kind,
                prev_value_usd, curr_value_usd, delta_value_usd, prev_shares,
                curr_shares, delta_shares, ssh_prnamt_type, flags
         FROM agg_qoq_deltas
         ORDER BY cik, curr_period, position_key, put_call, ssh_prnamt_type`,
      )
      .all() as Record<string, unknown>[]) {
      const row: QoqDeltaRow = {
        cik: String(r.cik),
        position_key: String(r.position_key),
        put_call: String(r.put_call) as QoqDeltaRow["put_call"],
        curr_period: String(r.curr_period),
        prev_period: String(r.prev_period),
        change_kind: String(r.change_kind) as QoqDeltaRow["change_kind"],
        prev_value_usd: intOrNull(r.prev_value_usd),
        curr_value_usd: intOrNull(r.curr_value_usd),
        delta_value_usd: intOrNull(r.delta_value_usd),
        prev_shares: intOrNull(r.prev_shares),
        curr_shares: intOrNull(r.curr_shares),
        delta_shares: intOrNull(r.delta_shares),
        ssh_prnamt_type: String(r.ssh_prnamt_type) as QoqDeltaRow["ssh_prnamt_type"],
        flags: parseFlags(r.flags),
      };
      let list = deltasByCik.get(row.cik);
      if (!list) {
        list = [];
        deltasByCik.set(row.cik, list);
      }
      list.push(row);
    }

    const concentrationByCik = new Map<string, ConcentrationRow[]>();
    for (const r of db
      .prepare(
        `SELECT cik, period_of_report, position_count, total_value_usd,
                null_value_positions, topn_value_usd, topn_share_bps, hhi, flags
         FROM agg_filer_concentration ORDER BY cik, period_of_report`,
      )
      .all() as Record<string, unknown>[]) {
      const row: ConcentrationRow = {
        cik: String(r.cik),
        period_of_report: String(r.period_of_report),
        position_count: Number(r.position_count),
        total_value_usd: Number(r.total_value_usd),
        null_value_positions: Number(r.null_value_positions),
        topn_value_usd: Number(r.topn_value_usd),
        topn_share_bps: intOrNull(r.topn_share_bps),
        hhi: intOrNull(r.hhi),
        flags: parseFlags(r.flags),
      };
      let list = concentrationByCik.get(row.cik);
      if (!list) {
        list = [];
        concentrationByCik.set(row.cik, list);
      }
      list.push(row);
    }

    const holdersByIssuer = new Map<string, TopHolderRow[]>();
    for (const r of db
      .prepare(
        `SELECT issuer_key, period_of_report, rank, cik, filer_name, issuer_name,
                issuer_key_source, value_usd, security_count, flags
         FROM agg_issuer_top_holders ORDER BY issuer_key, period_of_report, rank`,
      )
      .all() as Record<string, unknown>[]) {
      const row: TopHolderRow = {
        issuer_key: String(r.issuer_key),
        period_of_report: String(r.period_of_report),
        rank: Number(r.rank),
        cik: String(r.cik),
        filer_name: String(r.filer_name),
        issuer_name: String(r.issuer_name),
        issuer_key_source: String(r.issuer_key_source) as TopHolderRow["issuer_key_source"],
        value_usd: Number(r.value_usd),
        security_count: Number(r.security_count),
        flags: parseFlags(r.flags),
      };
      let list = holdersByIssuer.get(row.issuer_key);
      if (!list) {
        list = [];
        holdersByIssuer.set(row.issuer_key, list);
      }
      list.push(row);
    }

    let topn = 25;
    try {
      const meta = db.prepare(`SELECT value FROM agg_build_meta WHERE key = 'topn'`).get() as
        | { value?: unknown }
        | undefined;
      if (meta?.value != null && /^\d+$/.test(String(meta.value))) topn = Number(meta.value);
    } catch {
      // agg_build_meta is provenance, not contract — absence keeps the default
    }

    return {
      present: true,
      watermarks,
      topn,
      filers,
      deltasByCik,
      concentrationByCik,
      holdersByIssuer,
      ...loadAdds(db),
      typingByCik: loadTyping(db),
    };
  } finally {
    db.close();
  }
}

/** R21: read the leaderboard tables.

    They are OPTIONAL at read time: an aggregate produced before this run has
    no `agg_issuer_adds`, and a missing table must degrade to an honestly empty
    leaderboard rather than take the whole institutional module down with it.
    An empty map is the same honest-absence state the section already renders
    for a module that is present but holds nothing for a period. */
function corpusPeriods(db: DatabaseSync): string[] {
  try {
    return (
      db.prepare(
        "SELECT DISTINCT period_of_report FROM agg_filer_concentration ORDER BY period_of_report",
      ).all() as Record<string, unknown>[]
    ).map((r) => String(r.period_of_report));
  } catch {
    return [];
  }
}

function loadAdds(db: DatabaseSync): {
  addsByPeriodMode: Map<string, AddsRow[]>;
  addsExclusions: Map<string, number>;
  addsPeriods: string[];
} {
  const addsByPeriodMode = new Map<string, AddsRow[]>();
  const addsExclusions = new Map<string, number>();
  const periods = new Set<string>();

  /* F21: a LEGACY SCHEMA and a PARTIAL one are different states.

     Both queries used to sit under one `catch`, so an aggregate that HAD
     `agg_issuer_adds` but whose exclusions relation was missing or unreadable
     loaded its leaderboard rows and silently defaulted every exclusion count to
     zero — publishing a bounded, filtered table while suppressing the omission
     statement R14 requires. That is the precise failure the note exists to
     prevent, arriving through the error path.

     So legacy detection happens FIRST, by asking the schema. If the adds
     relation exists, the exclusions relation is REQUIRED and a failure to read
     it throws rather than degrading. */
  const hasAdds = tableExists(db, "agg_issuer_adds");
  if (!hasAdds) {
    // A build with no leaderboard aggregate has NO selectable periods. Offering
    // corpus periods here published paths for quarters the leaderboard cannot
    // describe, and the endpoint then threw on their missing exclusion counts.
    // The section renders its honest-absence branch instead, which is the true
    // statement: this build has no leaderboard, not "this quarter had nothing".
    return { addsByPeriodMode, addsExclusions, addsPeriods: [] };
  }
  if (!tableExists(db, "agg_issuer_adds_exclusions")) {
    throw new Error(
      "inst_agg.db has agg_issuer_adds but no agg_issuer_adds_exclusions —" +
        " a leaderboard cannot be published without the ambiguous-identity counts" +
        " it is required to state. Rebuild the aggregate.",
    );
  }

  for (const r of db.prepare(
    `SELECT period_of_report, mode, issuer_key, issuer_key_source, issuer_name,
            manager_count, new_position_count, delta_value_usd,
            delta_value_is_partial, top_adder_cik, top_adder_name
       FROM agg_issuer_adds`,
  ).all() as Record<string, unknown>[]) {
    const key = `${String(r.period_of_report)}|${String(r.mode)}`;
    periods.add(String(r.period_of_report));
    const list = addsByPeriodMode.get(key) ?? [];
    list.push({
      issuer_key: String(r.issuer_key),
      issuer_key_source: String(r.issuer_key_source) as AddsRow["issuer_key_source"],
      issuer_name: r.issuer_name == null ? null : String(r.issuer_name),
      manager_count: Number(r.manager_count),
      new_position_count: Number(r.new_position_count),
      delta_value_usd: intOrNull(r.delta_value_usd),
      delta_value_is_partial: Number(r.delta_value_is_partial) === 1,
      top_adder_cik: intOrNull(r.top_adder_cik),
      top_adder_name: r.top_adder_name == null ? null : String(r.top_adder_name),
    });
    addsByPeriodMode.set(key, list);
  }
  for (const r of db.prepare(
    `SELECT period_of_report, mode, ambiguous_identity_exclusion_count
       FROM agg_issuer_adds_exclusions`,
  ).all() as Record<string, unknown>[]) {
    addsExclusions.set(
      `${String(r.period_of_report)}|${String(r.mode)}`,
      Number(r.ambiguous_identity_exclusion_count),
    );
    periods.add(String(r.period_of_report));
  }

  // Every (period, mode) that HAS rows must also have a count. A missing count
  // is not zero — it is unknown, and an unknown omission cannot be stated.
  for (const key of addsByPeriodMode.keys()) {
    if (!addsExclusions.has(key)) {
      throw new Error(
        `inst_agg.db has leaderboard rows for ${key} but no exclusion count for it —` +
          " the section cannot state an omission it was never given.",
      );
    }
  }

  for (const p of corpusPeriods(db)) periods.add(p);
  return { addsByPeriodMode, addsExclusions, addsPeriods: [...periods].sort() };
}

/** Does a relation exist? Asking the schema is how legacy detection stops being
    an exception handler that swallows real failures too. */
function tableExists(db: DatabaseSync, name: string): boolean {
  const rows = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name = ?",
  ).all(name) as unknown[];
  return rows.length > 0;
}

/** R11: the curated manager typing.

    Optional at read time for the same reason the leaderboard tables are: an
    aggregate built before this run has no `agg_manager_registry`, and the
    directory must degrade to filed names rather than fail. An empty map means
    "nothing is typed", which is the honest rendering of an untyped build. */
function loadTyping(db: DatabaseSync): Map<string, ManagerTyping> {
  const out = new Map<string, ManagerTyping>();
  try {
    for (const r of db.prepare(
      `SELECT cik, display_name, person, manager_type, notable FROM agg_manager_registry`,
    ).all() as Record<string, unknown>[]) {
      out.set(String(r.cik), {
        cik: String(r.cik),
        display_name: String(r.display_name),
        person: r.person == null ? null : String(r.person),
        manager_type: String(r.manager_type) as ManagerTyping["manager_type"],
        notable: Number(r.notable) === 1,
      });
    }
  } catch {
    // Pre-R11 aggregate: nothing is typed. The directory renders filed names.
  }
  return out;
}

/** The curated typing for a filer, or null when it is not in the registry. */
export function typingFor(inst: InstData, cik: string): ManagerTyping | null {
  if (!inst.present) return null;
  return inst.typingByCik.get(cik) ?? null;
}

/** The leaderboard rows for one period and mode, already in the locked total
    order. An absent (period, mode) yields an empty list, never a throw. */
export function addsFor(inst: InstData, period: string, mode: AddsMode): AddsRow[] {
  if (!inst.present) return [];
  return [...(inst.addsByPeriodMode.get(`${period}|${mode}`) ?? [])].sort(compareAddsRows);
}

/** The ambiguous-identity exclusion count for one period and mode.

    A MISSING row and a ZERO are the same rendered outcome (no exclusion
    clause), but they are different facts, so the accessor reports 0 for a
    missing row rather than pretending the count is unknown — the producer
    writes a row for every (period, mode) it emitted. */
export function addsExclusionCount(inst: InstData, period: string, mode: AddsMode): number {
  if (!inst.present) return 0;
  const n = inst.addsExclusions.get(`${period}|${mode}`);
  if (n === undefined) {
    // F21: a missing count is UNKNOWN, not zero. Defaulting it published a
    // verified "nothing was excluded" for a period nobody had counted — an
    // honesty claim with no measurement behind it. The producer writes an
    // explicit 0 for quiet quarters, so an absence here is a real defect.
    throw new Error(
      `inst_agg.db has no ambiguous-identity exclusion count for ${period}/${mode}.` +
        " A missing count cannot be rendered as zero. Rebuild the aggregate.",
    );
  }
  return n;
}

/* ---------- period-correct accessors ---------- */

export function filerPeriods(inst: InstData, cik: string): string[] {
  if (!inst.present) return [];
  return (inst.concentrationByCik.get(cik) ?? []).map((c) => c.period_of_report).sort();
}

export function concentrationFor(
  inst: InstData,
  cik: string,
  period: string,
): ConcentrationRow | null {
  if (!inst.present) return null;
  return (
    (inst.concentrationByCik.get(cik) ?? []).find((c) => c.period_of_report === period) ?? null
  );
}

export function deltasFor(inst: InstData, cik: string, period: string): QoqDeltaRow[] {
  if (!inst.present) return [];
  return (inst.deltasByCik.get(cik) ?? []).filter((d) => d.curr_period === period);
}

export function holdersFor(inst: InstData, issuerKey: string, period: string): TopHolderRow[] {
  if (!inst.present) return [];
  return (inst.holdersByIssuer.get(issuerKey) ?? []).filter(
    (h) => h.period_of_report === period,
  );
}

export function issuerPeriods(inst: InstData, issuerKey: string): string[] {
  if (!inst.present) return [];
  return [...new Set((inst.holdersByIssuer.get(issuerKey) ?? []).map((h) => h.period_of_report))].sort();
}

/** Issuer keys that are entity-keyed in the aggregate — the ONLY keys a ticker
    may resolve to: cusip6/name-keyed rows are weaker identity
    claims and are never matched from a present-day ticker mapping. */
export function entityKeyedIssuers(inst: InstData): Set<string> {
  if (!inst.present) return new Set();
  const keys = new Set<string>();
  for (const [key, rows] of inst.holdersByIssuer) {
    if (rows.some((r) => r.issuer_key_source === "entity")) keys.add(key);
  }
  return keys;
}

/** True when a path points inside the repository's test fixtures. Matched on the
    resolved path, so a relative argument, a `..` walk and the dev default all
    answer the same. */
function isTestFixturePath(p: string): boolean {
  return path.resolve(p).split(path.sep).join("/").includes("/tests/fixtures/");
}

/** Read the ticker-map snapshot named by POPULUS_TICKER_MAP.
    Dev default: the committed pipeline fixture. A missing file is an explicit
    null — every consumer then renders the honest no-map state.

    CI refuses a fixture-derived map. The refusal rejects the fixture PATH,
    not merely an unset variable: no real `company_tickers.json` exists on a
    runner (it reaches this tree only through `populus identity bootstrap
    --from-cache`, and `data-cache/` is not in git), so the fixture is the only
    path a refusal-on-unset would leave satisfiable — the same defect one step
    later. A build that shipped these mappings would present fixture data as
    production truth, and the served-tree sweep could not detect it, because the
    served bytes would faithfully equal the built bytes. The intended production
    setting is an explicitly ABSENT path: this returns null and the site renders
    the honest no-map state (TD-7). */
export function readTickerMapJson(repoRoot: string): unknown | null {
  const envPath = process.env.POPULUS_TICKER_MAP;
  const mapPath =
    envPath ?? path.join(repoRoot, "tests", "fixtures", "inst", "mcp", "company_tickers.json");
  if (process.env.CI && isTestFixturePath(mapPath)) {
    throw new Error(
      `POPULUS_TICKER_MAP resolves into tests/fixtures (${mapPath}) — a CI build` +
        " must not ship fixture-derived ticker mappings as production data." +
        (envPath === undefined
          ? " The variable is unset, so the dev fixture default applied."
          : "") +
        " Point it at a real company_tickers.json snapshot, or at an explicitly" +
        " absent path to publish the honest no-map state (TD-7).",
    );
  }
  if (!existsSync(mapPath)) return null;
  return JSON.parse(readFileSync(mapPath, "utf-8"));
}
