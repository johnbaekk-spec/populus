/* Institutional (13F) adapter. Server-only (node:sqlite) — binds the dashboard
   to the PUBLISHED aggregate contract, src/populus/inst_agg.sql, verbatim:
   integer columns that are NULL when legitimately unavailable (never a
   fabricated zero), canonical sorted JSON flag arrays, and the five tables the
   producer ships. Per M2-CONTRACT §3 the dashboard receives aggregate slices
   only; per-filer holdings detail is federated to EDGAR, never served here.

   Period-correct sourcing (Locked #6): `agg_filer_registry` supplies identity
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
      quarter's number (Locked #6) */
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
    };

function parseFlags(raw: unknown): string[] {
  try {
    const parsed = JSON.parse(String(raw ?? "[]"));
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

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
    };
  } finally {
    db.close();
  }
}

/* ---------- period-correct accessors (Locked #6) ---------- */

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
    may resolve to (Locked #18): cusip6/name-keyed rows are weaker identity
    claims and are never matched from a present-day ticker mapping. */
export function entityKeyedIssuers(inst: InstData): Set<string> {
  if (!inst.present) return new Set();
  const keys = new Set<string>();
  for (const [key, rows] of inst.holdersByIssuer) {
    if (rows.some((r) => r.issuer_key_source === "entity")) keys.add(key);
  }
  return keys;
}

/** Read the ticker-map snapshot named by POPULUS_TICKER_MAP (Locked #18).
    Dev default: the committed pipeline fixture. A missing file is an explicit
    null — every consumer then renders the honest no-map state. */
export function readTickerMapJson(repoRoot: string): unknown | null {
  const mapPath =
    process.env.POPULUS_TICKER_MAP ??
    path.join(repoRoot, "tests", "fixtures", "inst", "mcp", "company_tickers.json");
  if (!existsSync(mapPath)) return null;
  return JSON.parse(readFileSync(mapPath, "utf-8"));
}
