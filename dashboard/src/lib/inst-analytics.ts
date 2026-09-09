/* Pure institutional analytics over the PUBLISHED aggregate — the inputs the
   four-screen design's Institutional and Filer bands need that
   `agg_filer_concentration` and `agg_qoq_deltas` can honestly supply:

   * tracked value for ONE closed period (never each filer's latest quarter
     folded into a falsely uniform total);
   * new-position weights per filer — a new position's reported value over the
     filer's COMPLETE reported book for the same period, withheld whenever any
     position in that book lacks a value;
   * the tracked-population medians a filer's book shape is compared against.

   Nothing here names an issuer: production position keys are provisional
   security ids with no name in the aggregate (measured 2026-09-09 on build
   20260812.1: 9.39M `sid:` keys, 95K `cusip:` keys, zero names). Anything
   issuer-named comes from the serving artifact (see `clusterBoard` in
   activity.ts), not from here. No Node APIs, no DOM. */

import type { ConcentrationRow, InstData, QoqDeltaRow } from "./inst.ts";
import type { TxnRow } from "./format.ts";

/* ---------- one closed period, one total ---------- */

export interface TrackedValue {
  period: string;
  /** filers with a concentration row for the period */
  filers: number;
  /** sum of reported 13(f) long value over those filers — disclosed values only */
  totalValueUsd: number;
  /** filers whose period book carries at least one NULL-valued position — the
      total is a LOWER bound when this is non-zero, and says so */
  partialBooks: number;
}

export function trackedValueFor(inst: InstData, period: string): TrackedValue | null {
  if (!inst.present) return null;
  let filers = 0;
  let total = 0;
  let partial = 0;
  for (const rows of inst.concentrationByCik.values()) {
    const c = rows.find((r) => r.period_of_report === period);
    if (!c) continue;
    filers++;
    total += c.total_value_usd;
    if (c.null_value_positions > 0) partial++;
  }
  if (filers === 0) return null;
  return { period, filers, totalValueUsd: total, partialBooks: partial };
}

/* ---------- new-position weights ---------- */

export interface NewPositionLeader {
  cik: string;
  filerName: string;
  period: string;
  /** the filer's largest new position as a share of the complete book, in bps */
  maxWeightBps: number;
  /** new positions at or above `thresholdBps` */
  atThreshold: number;
  /** all new positions the filer reported for the period */
  newPositions: number;
  /** the complete book's reported value — the denominator */
  bookValueUsd: number;
}

export interface NewPositionLeaders {
  period: string;
  thresholdBps: number;
  rows: NewPositionLeader[];
  /** filers with ≥1 new position whose book was NOT complete (a NULL-valued
      position, or a zero total) — excluded from ranking and STATED */
  incompleteBooks: number;
  /** filers evaluated (had a concentration row and ≥1 new delta for the period) */
  evaluated: number;
}

export const NEW_POSITION_THRESHOLD_BPS = 200;

/** Rank filers by the weight of their largest NEW position for one period.
    A filer is rankable only over a complete, fully valued book; the same
    rule `holdingsTableHtml` applies to per-row weights. */
export function newPositionLeaders(
  inst: InstData,
  period: string,
  opts: { limit?: number; thresholdBps?: number } = {},
): NewPositionLeaders | null {
  if (!inst.present) return null;
  const limit = opts.limit ?? 5;
  const thresholdBps = opts.thresholdBps ?? NEW_POSITION_THRESHOLD_BPS;
  const nameOf = new Map(inst.filers.map((f) => [f.cik, f.filer_name]));
  const rows: NewPositionLeader[] = [];
  let incomplete = 0;
  let evaluated = 0;
  for (const [cik, deltas] of inst.deltasByCik) {
    const news = deltas.filter((d) => d.curr_period === period && d.change_kind === "new");
    if (news.length === 0) continue;
    const conc = (inst.concentrationByCik.get(cik) ?? []).find((c) => c.period_of_report === period);
    if (!conc) continue;
    evaluated++;
    if (conc.null_value_positions > 0 || conc.total_value_usd <= 0 || news.some((d) => d.curr_value_usd == null)) {
      incomplete++;
      continue;
    }
    let max = 0;
    let at = 0;
    for (const d of news) {
      const bps = Math.round((d.curr_value_usd! / conc.total_value_usd) * 10_000);
      if (bps > max) max = bps;
      if (bps >= thresholdBps) at++;
    }
    if (at === 0) continue;
    rows.push({
      cik,
      filerName: nameOf.get(cik) ?? `CIK ${cik}`,
      period,
      maxWeightBps: max,
      atThreshold: at,
      newPositions: news.length,
      bookValueUsd: conc.total_value_usd,
    });
  }
  rows.sort((a, b) => b.maxWeightBps - a.maxWeightBps || b.atThreshold - a.atThreshold || (a.cik < b.cik ? -1 : 1));
  return { period, thresholdBps, rows: rows.slice(0, limit), incompleteBooks: incomplete, evaluated };
}

/* ---------- tracked-population medians ---------- */

export interface ConcentrationBenchmark {
  period: string;
  /** filers with a concentration row for the period */
  population: number;
  /** medians over filers whose statistic is defined (stated per statistic) */
  topnShareBps: { median: number; n: number } | null;
  hhi: { median: number; n: number } | null;
  positions: { median: number; n: number } | null;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid]! : Math.round((s[mid - 1]! + s[mid]!) / 2);
}

export function concentrationBenchmark(inst: InstData, period: string): ConcentrationBenchmark | null {
  if (!inst.present) return null;
  const rows: ConcentrationRow[] = [];
  for (const list of inst.concentrationByCik.values()) {
    const c = list.find((r) => r.period_of_report === period);
    if (c) rows.push(c);
  }
  if (rows.length === 0) return null;
  const shares = rows.filter((r) => r.topn_share_bps != null).map((r) => r.topn_share_bps!);
  // HHI is only meaningful over a complete book — the same rule the filer's own
  // book-shape panel applies, so the median is computed over the same population.
  const hhis = rows.filter((r) => r.hhi != null && r.null_value_positions === 0).map((r) => r.hhi!);
  const positions = rows.map((r) => r.position_count);
  const stat = (v: number[]): { median: number; n: number } | null => {
    const m = median(v);
    return m == null ? null : { median: m, n: v.length };
  };
  return { period, population: rows.length, topnShareBps: stat(shares), hhi: stat(hhis), positions: stat(positions) };
}

/** Deltas for one filer and period, split by kind — the counts the filer
    ledger prints beside its position count. */
export function deltaKindCounts(deltas: readonly QoqDeltaRow[], period: string): Record<QoqDeltaRow["change_kind"], number> {
  const out: Record<QoqDeltaRow["change_kind"], number> = { new: 0, add: 0, trim: 0, exit: 0, unclassified: 0 };
  for (const d of deltas) if (d.curr_period === period) out[d.change_kind]++;
  return out;
}

/* ---------- the congressional trading-profile benchmark ---------- */

export interface MemberProfileStats {
  /** median trade→filing lag in days over rows disclosing both dates */
  medianLag: number | null;
  /** rows per distinct filing document */
  rowsPerFiling: number | null;
  /** share of rows whose disclosed bracket tops out at $15K */
  shareSmallBracket: number | null;
  /** share of rows that are purchases */
  buyShare: number | null;
  /** share of rows with no spouse / child / joint owner code */
  selfOwnedShare: number | null;
  rows: number;
}

export function memberProfileStats(txns: readonly TxnRow[]): MemberProfileStats {
  const rows = txns.length;
  if (rows === 0)
    return { medianLag: null, rowsPerFiling: null, shareSmallBracket: null, buyShare: null, selfOwnedShare: null, rows: 0 };
  const lags = txns.filter((t) => t.lag != null).map((t) => t.lag!);
  const docs = new Set(txns.map((t) => t.doc)).size;
  const small = txns.filter((t) => t.high != null && t.high <= 15_000).length;
  const buys = txns.filter((t) => t.side === "purchase").length;
  const self = txns.filter((t) => !t.owner || t.owner === "self").length;
  return {
    medianLag: median(lags),
    rowsPerFiling: docs > 0 ? rows / docs : null,
    shareSmallBracket: small / rows,
    buyShare: buys / rows,
    selfOwnedShare: self / rows,
    rows,
  };
}

export interface ChamberBenchmark {
  chamber: "house" | "senate";
  /** members with ≥1 transaction in the chamber */
  members: number;
  medianLag: number | null;
  rowsPerFiling: number | null;
  shareSmallBracket: number | null;
  buyShare: number | null;
  selfOwnedShare: number | null;
}

/** Per-member statistics, then the median across the chamber's members — a
    member is one observation regardless of how many rows they filed, so a
    4,000-row filer does not become the chamber. */
export function chamberBenchmark(
  members: readonly { chamber: "house" | "senate"; txns: readonly TxnRow[] }[],
  chamber: "house" | "senate",
): ChamberBenchmark | null {
  const stats = members.filter((m) => m.chamber === chamber && m.txns.length > 0).map((m) => memberProfileStats(m.txns));
  if (stats.length === 0) return null;
  const pick = (f: (s: MemberProfileStats) => number | null): number | null =>
    median(stats.map(f).filter((v): v is number => v != null));
  const round2 = (v: number | null): number | null => (v == null ? null : Math.round(v * 1000) / 1000);
  return {
    chamber,
    members: stats.length,
    medianLag: pick((s) => s.medianLag),
    rowsPerFiling: round2(pick((s) => s.rowsPerFiling)),
    shareSmallBracket: round2(pick((s) => s.shareSmallBracket)),
    buyShare: round2(pick((s) => s.buyShare)),
    selfOwnedShare: round2(pick((s) => s.selfOwnedShare)),
  };
}
