/* signals-v4 M3 (T3.3, T3.7): LD14 restated independently of
   `signals-overlap.ts` and of `congress-quarter.ts` — the unit tests and the
   post-build test recount the Overlap rows with it. */

import type { TxnRow } from "../../src/lib/format.ts";
import type { NotableMove } from "../../src/lib/notable-moves.ts";

/** LD14 restated independently of `signals-overlap.ts` and of
    `congress-quarter.ts`: both variants' rows, in their order. */
export function independentOverlap(txns: readonly TxnRow[], moves: readonly NotableMove[], period: string): { core: string[]; all: string[] } {
  const r = independentOverlapRows(txns, moves, period);
  return { core: r.core.map((x) => `${x.t}:${x.rel}`), all: r.all.map((x) => `${x.t}:${x.rel}`) };
}

/** One recounted name: the four distinct counts (members by their own key,
    managers by CIK — each a `Set`, never a count of lines or changes), the
    two directions, the relation, unanimity and the score. */
export interface RecountRow {
  t: string;
  cb: number;
  cs: number;
  gb: number;
  gs: number;
  cdir: string;
  gdir: string;
  rel: string;
  un: boolean;
  score: number;
}

/** Both variants' recounted rows, in their order (codex M3 round 1, F5: the
    numbers, not only the relation, so a rule that counts rows fails). */
export function independentOverlapRows(txns: readonly TxnRow[], moves: readonly NotableMove[], period: string): { core: RecountRow[]; all: RecountRow[] } {
  const m = /^(\d{4})-(03-31|06-30|09-30|12-31)$/.exec(period)!;
  const start = `${m[1]}-${{ "03-31": "01", "06-30": "04", "09-30": "07", "12-31": "10" }[m[2]!]}-01`;
  const norm = (t: string): string => t.trim().toUpperCase().replace(/\./g, "-");
  const sideOf = (s: TxnRow["side"]): "b" | "s" | null => (s === "purchase" ? "b" : s === "sale" || s === "sale_partial" ? "s" : null);
  const lines = txns.filter((t) => !t.flags.includes("date_anomaly") && t.traded !== null && t.traded >= start && t.traded <= period && (t.assetType === "ST" || t.assetType === "Stock") && !!t.ticker && sideOf(t.side) !== null);
  const who = (t: TxnRow): string => t.bioguide ?? `raw:${t.name}`;
  const breadth = new Map<string, Set<string>>();
  for (const t of lines) breadth.set(who(t), (breadth.get(who(t)) ?? new Set()).add(norm(t.ticker!)));
  const g = new Map<string, { b: Set<string>; s: Set<string> }>();
  for (const mv of moves) {
    if (!mv.ticker) continue;
    const e = g.get(norm(mv.ticker)) ?? { b: new Set(), s: new Set() };
    (mv.kind === "new" || mv.kind === "add" ? e.b : e.s).add(mv.cik);
    g.set(norm(mv.ticker), e);
  }
  const variant = (incl: boolean): RecountRow[] => {
    const c = new Map<string, { b: Set<string>; s: Set<string> }>();
    for (const t of lines) {
      if (!incl && breadth.get(who(t))!.size > 25) continue;
      const e = c.get(norm(t.ticker!)) ?? { b: new Set(), s: new Set() };
      (sideOf(t.side) === "b" ? e.b : e.s).add(who(t));
      c.set(norm(t.ticker!), e);
    }
    const dir = (b: number, s: number) => (b > s ? "buy" : s > b ? "sell" : "mixed");
    const rows: RecountRow[] = [];
    for (const [t, ce] of c) {
      const ge = g.get(t);
      if (!ge) continue;
      const cd = dir(ce.b.size, ce.s.size);
      const gd = dir(ge.b.size, ge.s.size);
      rows.push({
        t, cb: ce.b.size, cs: ce.s.size, gb: ge.b.size, gs: ge.s.size, cdir: cd, gdir: gd,
        rel: cd === "mixed" || gd === "mixed" ? "mixed" : cd === gd ? "same" : "opposite",
        un: (ce.b.size === 0 || ce.s.size === 0) && (ge.b.size === 0 || ge.s.size === 0),
        score: Math.max(ce.b.size, ce.s.size) + Math.max(ge.b.size, ge.s.size),
      });
    }
    const ro: Record<string, number> = { same: 0, opposite: 1, mixed: 2 };
    rows.sort((a, b) => ro[a.rel]! - ro[b.rel]! || (a.un === b.un ? 0 : a.un ? -1 : 1) || b.score - a.score || (a.t < b.t ? -1 : 1));
    return rows;
  };
  return { core: variant(false), all: variant(true) };
}
