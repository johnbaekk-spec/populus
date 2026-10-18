/* signals-v4 M2 (R13, LD10): the ONE join of Congress trade lines to a 13F
   quarter. The Congress column on every Named move and Consensus row reads
   it (M2); Overlap reads it too (M3).

   - Quarter: the period must be a calendar quarter end (MM-DD ∈ 03-31,
     06-30, 09-30, 12-31), else there is no join and its consumers state the
     absence. The bounds are inclusive: the first day of the quarter's first
     month → the quarter end.
   - Lines: the build's rows without a date anomaly, traded inside the
     quarter, a listed stock as filed (`isListedStock`: ST / Stock only), with
     a ticker, on a purchase ("buy") or a sale or partial sale ("sell").
     Exchanges and unparsed sides are out. Filed dates are not bounded: every
     line the build knows counts.
   - Ticker: `normalizeTicker13f`, the site's one comparison form, so BRK.B
     and BRK-B meet; GOOG and GOOGL stay distinct.
   - Member: `s3MemberKey` (the bioguide, else "raw:" + the filed name).
     Breadth: the member's distinct tickers in the quarter's lines.
   - Broad account: breadth above `BROAD_ACCOUNT_NAMES`. Such a member
     matches almost any name, so the Congress column counts without them and
     names them instead.

   Pure: no Node APIs, no DOM. Build memory only — never serialized (R23). */

import { isListedStock, normalizeTicker13f, type TxnRow } from "./format.ts";
import { excludeDateAnomalies } from "./derive.ts";
import { s3MemberKey } from "./signals.ts";

/** A member trading more distinct names than this in one quarter is a broad
    account (LD10): excluded from the Congress column and named in its tip. */
export const BROAD_ACCOUNT_NAMES = 25;
/** The most Congress lines one side of a detail lists; the rest are one link
    away on the ticker page. */
export const CONGRESS_DETAIL_LINES = 12;

export type QuarterSide = "buy" | "sell";

/** The quarter-end MM-DD → the quarter's first month. */
const QUARTER_START_MONTH: Readonly<Record<string, string>> = { "03-31": "01", "06-30": "04", "09-30": "07", "12-31": "10" };
/** The quarter ends, in words (Methodology reads them from here). */
export const QUARTER_ENDS_TEXT = "March 31, June 30, September 30 or December 31";

/** The inclusive bounds of the calendar quarter ending on `period`, or null
    when `period` is not a calendar quarter end. */
export function quarterBounds(period: string | null | undefined): { start: string; end: string } | null {
  const m = /^(\d{4})-(03-31|06-30|09-30|12-31)$/.exec(String(period ?? ""));
  if (!m) return null;
  return { start: `${m[1]}-${QUARTER_START_MONTH[m[2]!]}-01`, end: `${m[1]}-${m[2]}` };
}

/** "Q1 2026" for 2026-03-31, or null for a period that is not a quarter end. */
export function quarterLabel(period: string | null | undefined): string | null {
  const b = quarterBounds(period);
  if (!b) return null;
  const q = { "01": 1, "04": 2, "07": 3, "10": 4 }[b.start.slice(5, 7) as "01" | "04" | "07" | "10"];
  return `Q${q} ${b.end.slice(0, 4)}`;
}

/** A Congress side as the quarter join reads it; null for an exchange or an
    unparsed side, which never join. */
export function quarterSideOf(side: TxnRow["side"]): QuarterSide | null {
  if (side === "purchase") return "buy";
  if (side === "sale" || side === "sale_partial") return "sell";
  return null;
}

/** A 13F move's side: a new stake or an add is a buy, a trim or an exit a sell. */
export function moveSide(kind: "new" | "add" | "trim" | "exit"): QuarterSide {
  return kind === "new" || kind === "add" ? "buy" : "sell";
}

/** One member's lines on one ticker and side in the quarter. */
export interface MemberLines {
  key: string;
  name: string;
  bioguide: string | null;
  party: string;
  state: string | null;
  district: string | null;
  chamber: TxnRow["chamber"];
  /** the member's distinct tickers in the quarter's lines */
  breadth: number;
  /** newest trade first */
  rows: TxnRow[];
}

export interface BroadMember {
  memberKey: string;
  name: string;
  breadth: number;
}

export interface CongressQuarter {
  period: string;
  start: string;
  end: string;
  /** normalized ticker → each side's members, by member key */
  byTicker: Map<string, { buy: Map<string, MemberLines>; sell: Map<string, MemberLines> }>;
  /** the broad accounts, widest first */
  broad: BroadMember[];
  /** distinct members with a line in the quarter */
  members: number;
  /** lines in the quarter */
  lines: number;
}

/** Newest trade first, then the newest filing, then the row identity — one
    order wherever a member's lines are listed. */
function cmpLines(a: TxnRow, b: TxnRow): number {
  if (a.traded !== b.traded) return (a.traded ?? "") < (b.traded ?? "") ? 1 : -1;
  if (a.filed !== b.filed) return a.filed < b.filed ? 1 : -1;
  return a.txnId < b.txnId ? -1 : a.txnId > b.txnId ? 1 : 0;
}

/** LD10: the quarter's Congress lines, joined by ticker and side, or null when
    `period` is not a calendar quarter end. */
export function congressQuarter(txns: readonly TxnRow[], period: string | null | undefined): CongressQuarter | null {
  const bounds = quarterBounds(period);
  if (!bounds) return null;
  const lines = excludeDateAnomalies(txns).rows.filter(
    (t) =>
      t.traded !== null &&
      t.traded >= bounds.start &&
      t.traded <= bounds.end &&
      isListedStock(t.assetType) &&
      !!t.ticker &&
      quarterSideOf(t.side) !== null,
  );
  const tickersOf = new Map<string, Set<string>>();
  for (const t of lines) {
    const k = s3MemberKey(t);
    let s = tickersOf.get(k);
    if (!s) tickersOf.set(k, (s = new Set()));
    s.add(normalizeTicker13f(t.ticker!));
  }
  const byTicker: CongressQuarter["byTicker"] = new Map();
  for (const t of lines) {
    const ticker = normalizeTicker13f(t.ticker!);
    const side = quarterSideOf(t.side)!;
    let entry = byTicker.get(ticker);
    if (!entry) byTicker.set(ticker, (entry = { buy: new Map(), sell: new Map() }));
    const key = s3MemberKey(t);
    let m = entry[side].get(key);
    if (!m) {
      m = { key, name: t.name, bioguide: t.bioguide, party: t.party, state: t.state, district: t.district, chamber: t.chamber, breadth: tickersOf.get(key)!.size, rows: [] };
      entry[side].set(key, m);
    }
    m.rows.push(t);
  }
  for (const entry of byTicker.values()) for (const side of [entry.buy, entry.sell]) for (const m of side.values()) m.rows.sort(cmpLines);
  const nameOf = new Map<string, string>();
  for (const t of lines) if (!nameOf.has(s3MemberKey(t))) nameOf.set(s3MemberKey(t), t.name);
  const broad: BroadMember[] = [...tickersOf]
    .filter(([, s]) => s.size > BROAD_ACCOUNT_NAMES)
    .map(([memberKey, s]) => ({ memberKey, name: nameOf.get(memberKey) ?? memberKey, breadth: s.size }))
    .sort((a, b) => b.breadth - a.breadth || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return { period: bounds.end, start: bounds.start, end: bounds.end, byTicker, broad, members: tickersOf.size, lines: lines.length };
}

/** Whether a member is a broad account in this quarter. */
export function isBroad(m: Pick<MemberLines, "breadth">): boolean {
  return m.breadth > BROAD_ACCOUNT_NAMES;
}

/** The members on `side` of `ticker` in the quarter, newest trade first (then
    by name): without the broad accounts unless `includeBroad`. A null ticker
    — a move no reviewed ticker maps — joins nothing. */
export function quarterMembers(q: CongressQuarter | null, ticker: string | null, side: QuarterSide, opts: { includeBroad?: boolean } = {}): MemberLines[] {
  if (!q || !ticker) return [];
  const entry = q.byTicker.get(normalizeTicker13f(ticker));
  if (!entry) return [];
  return [...entry[side].values()]
    .filter((m) => opts.includeBroad === true || !isBroad(m))
    .sort((a, b) => cmpLines(a.rows[0]!, b.rows[0]!) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

/** R13: the Congress column — distinct non-broad members on `side` of `ticker`. */
export function congressCount(q: CongressQuarter | null, ticker: string | null, side: QuarterSide, opts: { includeBroad?: boolean } = {}): number {
  return quarterMembers(q, ticker, side, opts).length;
}
