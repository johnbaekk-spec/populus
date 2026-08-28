/* Pure derivations shared by the build-time pages, the entity endpoints, and
   the client driver. No Node APIs, no DOM APIs — everything here is a function
   of its arguments, so SSR and the generic entity route compute identical
   numbers from identical rows.

   Normative specs: docs/frontend/qoq-presentation.md (QoQ mapping, typed
   sumRanges, S4 taxonomy, ticker→issuer mapping, institutional time stamp)
   and dashboard/docs/pagination-and-counts.md (reused unchanged). */

import { pathSafeTicker } from "./format.ts";
// Deliberate module cycle with holdings.ts (function declarations only, used
// at call time — safe under ESM): the ONE filer-href primitive lives there.
import { filerHref } from "./holdings.ts";
export { pathSafeTicker };
import {
  type TxnRow,
  type PaperRow,
  fmtMoney,
  fmtInt,
  fmtUsd,
  esc,
  DATASET_VERSION,
} from "./format.ts";
import type { QoqDeltaRow } from "./inst.ts";

/* ---------- entity grouping ---------- */

export interface MemberMeta {
  name: string;
  party: string; // code: D | R | I | ""
  state: string | null;
  district: string | null;
  chamber: "house" | "senate";
  servingSince: string | null; // earliest term start year, from `terms`
  filingCount: number; // distinct default filings incl. paper
}

export interface MemberEntity extends MemberMeta {
  bioguide: string;
  txns: TxnRow[]; // filed desc (load order preserved)
  paper: PaperRow[]; // filed desc
}

export interface TickerEntity {
  ticker: string;
  txns: TxnRow[]; // filed desc
}

/** Group the one-pass feed rows by entity. Order within each entity inherits
    the feed's filed-desc order, so entity tables share the feed's sort. */
export function groupEntities(
  txns: TxnRow[],
  paper: PaperRow[],
): { members: Map<string, { txns: TxnRow[]; paper: PaperRow[] }>; tickers: Map<string, TxnRow[]> } {
  const members = new Map<string, { txns: TxnRow[]; paper: PaperRow[] }>();
  const tickers = new Map<string, TxnRow[]>();
  const memberBucket = (b: string) => {
    let m = members.get(b);
    if (!m) {
      m = { txns: [], paper: [] };
      members.set(b, m);
    }
    return m;
  };
  for (const t of txns) {
    if (t.bioguide) memberBucket(t.bioguide).txns.push(t);
    if (t.ticker) {
      let list = tickers.get(t.ticker);
      if (!list) {
        list = [];
        tickers.set(t.ticker, list);
      }
      list.push(t);
    }
  }
  for (const p of paper) {
    if (p.bioguide) memberBucket(p.bioguide).paper.push(p);
  }
  return { members, tickers };
}

/** Earliest term-start year from the members table's `terms` JSON; malformed
    input yields null (rendered as absence), never a guessed year. */
export function servingSince(termsJson: string | null): string | null {
  if (!termsJson) return null;
  let terms: unknown;
  try {
    terms = JSON.parse(termsJson);
  } catch {
    return null;
  }
  if (!Array.isArray(terms)) return null;
  let min: string | null = null;
  for (const t of terms) {
    const start = (t as { start?: unknown })?.start;
    if (typeof start !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(start)) continue;
    const y = start.slice(0, 4);
    if (min === null || y < min) min = y;
  }
  return min;
}

/* ---------- typed sumRanges (G1, spec §2) ---------- */

export type SumRanges =
  | { kind: "empty" }
  | { kind: "undisclosed"; rows: number }
  | { kind: "closed"; low: number; high: number; rows: number; undisclosed: 0 }
  | { kind: "open"; low: number; high: null; rows: number; undisclosed: number };

/** Statutory bucket floors are $X+1; display the $X boundary (same rule as
    the row-level amountText). */
function floorBoundary(low: number): number {
  return low % 1000 === 1 ? low - 1 : low;
}

export function sumRanges(rows: readonly Pick<TxnRow, "low" | "high">[]): SumRanges {
  if (rows.length === 0) return { kind: "empty" };
  let low = 0;
  let high = 0;
  let open = false;
  let undisclosed = 0;
  for (const r of rows) {
    if (r.low == null && r.high == null) {
      undisclosed++;
      open = true; // an unparsed row voids any upper-bound claim
      continue;
    }
    low += r.low == null ? 0 : floorBoundary(r.low);
    if (r.high == null) open = true; // open statutory cap: no upper bound
    else high += r.high;
  }
  if (undisclosed === rows.length) return { kind: "undisclosed", rows: rows.length };
  if (open) return { kind: "open", low, high: null, rows: rows.length, undisclosed };
  return { kind: "closed", low, high, rows: rows.length, undisclosed: 0 };
}

/** Text form. The caller renders `undisclosed` as the hatched block — this
    function still names it, so no sink can print a fabricated "$0+". */
export function sumRangesText(s: SumRanges): string {
  switch (s.kind) {
    case "empty":
      return "—";
    case "undisclosed":
      return "not disclosed";
    case "open":
      return `Over ${fmtMoney(s.low)}`;
    case "closed":
      return `${fmtMoney(s.low)}–${fmtMoney(s.high)}`;
  }
}

/** Count-based undisclosed fraction for hatch captions: rows whose
    amounts did not parse, over all rows in the aggregate. */
export function undisclosedPctText(s: SumRanges): string | null {
  if (s.kind === "undisclosed") return "100%";
  if (s.kind === "open" && s.undisclosed > 0) {
    return `${Math.round((s.undisclosed / s.rows) * 100)}%`;
  }
  return null;
}

/* ---------- date-anomaly exclusion (B-7, plan constraint 9) ---------- */

/** Rows flagged `date_anomaly` carry impossible trade dates (the corpus holds
    3031-04-30, 2220-04-07, 2202-09-19 and a future 2026-12-26) — any
    date-windowed aggregate that admits them inherits the corruption. Every
    windowed aggregate filters through here; the excluded count is returned so
    a surface can disclose the exclusion instead of silently shrinking. */
export function excludeDateAnomalies<T extends Pick<TxnRow, "flags">>(
  rows: readonly T[],
): { rows: T[]; excluded: number } {
  const kept = rows.filter((r) => !r.flags.includes("date_anomaly"));
  return { rows: kept, excluded: rows.length - kept.length };
}

/* ---------- C-4 net-interval algebra (ALPHA-UX plan §4 C-4) ----------

   EXTENDS the typed sumRanges — it does not replace it. Six states:
   `empty (Ø)` · `undisclosed (D)` · `finite [l,u]` · `lower-open (−∞,u]` ·
   `upper-open [l,+∞)` · `unbounded (−∞,+∞)`. The sixth is not optional:
   L−L and U−U both produce it, and a five-state set cannot represent its
   own results.

   NAMING (plan F-16.3): a source "Under $X" row is CAPPED, never
   "lower-open" — the live contract has no lower-open source state
   (`sumRanges` adds 0 for a null low, yielding `closed [0,X]`, which is
   exactly what the filing describes: a disclosed amount is non-negative).
   `lower-open (−∞,u]` denotes signed NET RESULTS only. */

export type NetInterval =
  | { kind: "empty" } // additive identity [0,0] — summed zero is a fact, not an absence
  | { kind: "undisclosed" } // any undisclosed operand poisons the result — never coerced to 0
  | { kind: "finite"; low: number; high: number }
  | { kind: "lower-open"; high: number } // (−∞, u] — net results only
  | { kind: "upper-open"; low: number } // [l, +∞)
  | { kind: "unbounded" }; // (−∞, +∞)

/** Source normalization happens BEFORE any arithmetic (constraint 7): the
    live SumRanges maps onto the algebra with no lower-open case, because no
    source state produces one. */
export function toNetInterval(s: SumRanges): NetInterval {
  switch (s.kind) {
    case "empty":
      return { kind: "empty" };
    case "undisclosed":
      return { kind: "undisclosed" };
    case "closed":
      return { kind: "finite", low: s.low, high: s.high };
    case "open":
      return { kind: "upper-open", low: s.low };
  }
}

/** Endpoints over signed infinities. `empty` is the identity [0,0]. The
    `undisclosed` state has NO endpoints — callers must branch on it first;
    this function throws rather than fabricate a bound for it. */
function netBounds(n: NetInterval): [number, number] {
  switch (n.kind) {
    case "empty":
      return [0, 0];
    case "finite":
      return [n.low, n.high];
    case "lower-open":
      return [Number.NEGATIVE_INFINITY, n.high];
    case "upper-open":
      return [n.low, Number.POSITIVE_INFINITY];
    case "unbounded":
      return [Number.NEGATIVE_INFINITY, Number.POSITIVE_INFINITY];
    case "undisclosed":
      throw new Error("undisclosed has no endpoints — branch before netBounds");
  }
}

function classifyBounds(low: number, high: number): NetInterval {
  const lOpen = low === Number.NEGATIVE_INFINITY;
  const uOpen = high === Number.POSITIVE_INFINITY;
  if (lOpen && uOpen) return { kind: "unbounded" };
  if (lOpen) return { kind: "lower-open", high };
  if (uOpen) return { kind: "upper-open", low };
  return { kind: "finite", low, high };
}

/** Interval subtraction `net = [pL − sU, pU − sL]` over signed infinities
    (p = gross purchases, s = gross sales). Any `undisclosed` operand yields
    `undisclosed` — undisclosed never silently becomes zero. */
export function subNet(p: NetInterval, s: NetInterval): NetInterval {
  if (p.kind === "undisclosed" || s.kind === "undisclosed") return { kind: "undisclosed" };
  const [pL, pU] = netBounds(p);
  const [sL, sU] = netBounds(s);
  return classifyBounds(pL - sU, pU - sL);
}

/** Net disclosed flow from two source-side sums — normalization first, then
    subtraction. This is C-4's one entry point from row data. */
export function netFlow(purchases: SumRanges, sales: SumRanges): NetInterval {
  return subNet(toNetInterval(purchases), toNetInterval(sales));
}

/** Directional copy requires a STRICT sign (constraint 8): accumulation only
    when l > 0, disposal only when u < 0. An interval touching or spanning
    zero — including [0,u] and [l,0] — is directionally indeterminate: null. */
export function netDirection(n: NetInterval): "accumulation" | "disposal" | null {
  if (n.kind === "undisclosed" || n.kind === "unbounded" || n.kind === "empty") return null;
  const [low, high] = netBounds(n);
  if (low > 0) return "accumulation";
  if (high < 0) return "disposal";
  return null;
}

/** Signed compact text for a net interval. Bounds that do not exist are said
    to not exist — never printed as a number. */
export function netIntervalText(n: NetInterval): string {
  switch (n.kind) {
    case "empty":
      return "$0";
    case "undisclosed":
      return "not disclosed";
    case "finite":
      return n.low === n.high ? fmtUsd(n.low) : `${fmtUsd(n.low)} to ${fmtUsd(n.high)}`;
    case "lower-open":
      return `at most ${fmtUsd(n.high)}`;
    case "upper-open":
      return `at least ${fmtUsd(n.low)}`;
    case "unbounded":
      return "unbounded — open bounds on both sides";
  }
}

/** Whether two net intervals overlap. Overlap is NOT a tie — it is
    non-transitive and cannot define equivalence classes; overlapping rows are
    incomparable. Returns null when either side is `undisclosed` (no
    endpoints, so the question does not type-check). */
export function netOverlaps(a: NetInterval, b: NetInterval): boolean | null {
  if (a.kind === "undisclosed" || b.kind === "undisclosed") return null;
  const [aL, aU] = netBounds(a);
  const [bL, bU] = netBounds(b);
  return aL <= bU && bL <= aU;
}

/** The display rank key, total over every orderable kind (constraint 8):
    lower bound desc → upper bound desc → canonical identity asc. The identity
    is the row's OWN key (`bioguide` on Leaders, `ticker` on Tickers) — never
    `txn_id`: an aggregate row has no single transaction. `undisclosed` is not
    orderable and never receives a sentinel — callers route it to the labeled
    structural bucket via `rankNetRows`. The key supplies ORDER, never
    superiority: overlapping rows keep their stable position and are marked
    incomparable by the caller. */
export function compareNet(a: NetInterval, b: NetInterval, idA: string, idB: string): number {
  const [aL, aU] = netBounds(a);
  const [bL, bU] = netBounds(b);
  // Sign comparisons, not subtraction: ∞ − ∞ is NaN, and a NaN comparator is
  // nondeterministic. −∞ lowers sort last; +∞ uppers sort first.
  if (aL !== bL) return aL > bL ? -1 : 1; // lower bound desc
  if (aU !== bU) return aU > bU ? -1 : 1; // upper bound desc
  return idA < idB ? -1 : idA > idB ? 1 : 0;
}

/** Partition + order: ranked rows by the display key, `undisclosed` rows to
    an explicit labeled bucket rendered AFTER all ranked rows — never
    interleaved, never given a sentinel value. */
export function rankNetRows<T>(
  rows: readonly T[],
  net: (t: T) => NetInterval,
  id: (t: T) => string,
): { ranked: T[]; undisclosedBucket: T[] } {
  const ranked: T[] = [];
  const undisclosedBucket: T[] = [];
  for (const row of rows) {
    (net(row).kind === "undisclosed" ? undisclosedBucket : ranked).push(row);
  }
  ranked.sort((a, b) => compareNet(net(a), net(b), id(a), id(b)));
  undisclosedBucket.sort((a, b) => (id(a) < id(b) ? -1 : id(a) > id(b) ? 1 : 0));
  return { ranked, undisclosedBucket };
}

/* ---------- C-4 rollups: Leaders (per member) + Tickers (per ticker) ------ */

export interface LeaderRow {
  /** canonical identity for the rank key (bioguide, or `raw:<name>` for
      unjoined filers — grouped, never dropped) */
  id: string;
  bioguide: string | null;
  name: string;
  party: string;
  state: string | null;
  district: string | null;
  chamber: "house" | "senate";
  txns: number; // ALL rows in window, incl. exchange/other — exact count
  buys: number;
  sells: number;
  excludedSides: number; // exchange/unparsed-side rows in the count but not the sums
  purchases: SumRanges;
  sales: SumRanges;
  net: NetInterval;
  late: number; // rows filed past the 45-day window
  lateDenom: number; // rows with a known late status — the rate's denominator
}

export interface CongressRollup {
  rows: LeaderRow[];
  /** rows the TRADED basis excluded for an impossible trade date — always 0 on
      the filed basis, where a filed date is well-defined (locked decision) */
  dateAnomalies: number;
  /** rows the TRADED basis could not place because they disclose no trade
      date — always 0 on the filed basis, which includes them */
  undated: number;
  range: CongressRange;
  basis: CongressBasis;
}

/** Range and basis for a congress rollup. Defaults are the locked section
    defaults: a trailing twelve months on the TRADED basis, because the
    sections answer what members traded in a window. */
export interface CongressWindowOpts {
  range?: CongressRange;
  basis?: CongressBasis;
}

function rollupRows(
  groups: Map<string, TxnRow[]>,
  idOf: (key: string, first: TxnRow) => Pick<LeaderRow, "id" | "bioguide" | "name" | "party" | "state" | "district" | "chamber">,
  range: CongressRange,
  basis: CongressBasis,
  dateAnomalies: number,
  undated: number,
): CongressRollup {
  const rows: LeaderRow[] = [];
  for (const [key, list] of groups) {
    const first = list[0]!;
    const buysRows = list.filter((r) => r.side === "purchase");
    const sellRows = list.filter((r) => r.side === "sale" || r.side === "sale_partial");
    const purchases = sumRanges(buysRows);
    const sales = sumRanges(sellRows);
    rows.push({
      ...idOf(key, first),
      txns: list.length,
      buys: buysRows.length,
      sells: sellRows.length,
      excludedSides: list.length - buysRows.length - sellRows.length,
      purchases,
      sales,
      net: netFlow(purchases, sales),
      late: lateCount(list),
      lateDenom: list.filter((r) => r.late != null).length,
    });
  }
  return { rows, dateAnomalies, undated, range, basis };
}

/** Per-member rollup over a trailing filed-date window. Unjoined filers group
    by printed name (`raw:<name>`) — counted, never dropped. Every derived
    number is either an interval (sums, net) or an exact count with its
    denominator beside it — never an interval implied to be exact or vice
    versa. */
export function leadersRollup(
  allTxns: readonly TxnRow[],
  now: string,
  opts: CongressWindowOpts = {},
): CongressRollup {
  const { range = "12m", basis = "traded" } = opts;
  const {
    rows: windowed,
    dateAnomalies: excluded,
    undated,
  } = partitionByWindow(allTxns, congressRangeBounds(range, now), basis);
  const groups = new Map<string, TxnRow[]>();
  for (const t of windowed) {
    const key = t.bioguide ?? `raw:${t.name}`;
    let list = groups.get(key);
    if (!list) {
      list = [];
      groups.set(key, list);
    }
    list.push(t);
  }
  return rollupRows(
    groups,
    (key, first) => ({
      id: key,
      bioguide: first.bioguide,
      name: first.name,
      party: first.party,
      state: first.state,
      district: first.district,
      chamber: first.chamber,
    }),
    range,
    basis,
    excluded,
    undated,
  );
}

/** Per-ticker rollup over the same window. Only rows that disclose a ticker
    participate — the caller states how many rows have none (the largest
    discloser by flow has zero distinct tickers; a ticker view that hid that
    silently would misrank the whole surface). */
export function congressTickersRollup(
  allTxns: readonly TxnRow[],
  now: string,
  opts: CongressWindowOpts = {},
): CongressRollup & { noTickerRows: number } {
  const { range = "12m", basis = "traded" } = opts;
  const {
    rows: windowed,
    dateAnomalies: excluded,
    undated,
  } = partitionByWindow(allTxns, congressRangeBounds(range, now), basis);
  const groups = new Map<string, TxnRow[]>();
  let noTickerRows = 0;
  for (const t of windowed) {
    if (!t.ticker) {
      noTickerRows++;
      continue;
    }
    let list = groups.get(t.ticker);
    if (!list) {
      list = [];
      groups.set(t.ticker, list);
    }
    list.push(t);
  }
  const rollup = rollupRows(
    groups,
    (key, first) => ({
      id: key,
      bioguide: null,
      name: key,
      party: first.party,
      state: null,
      district: null,
      chamber: first.chamber,
    }),
    range,
    basis,
    excluded,
    undated,
  );
  return { ...rollup, noTickerRows };
}

/* ---------- quarterly flow ---------- */

export interface QuarterFlow {
  q: string; // "24Q3"
  quarterEnd: string; // YYYY-MM-DD
  buy: SumRanges;
  sell: SumRanges;
}

export interface QuarterlyFlowResult {
  quarters: QuarterFlow[]; // oldest → newest, gaps included as empty
  undated: number; // rows with no parseable trade date — excluded, disclosed
  excludedSides: number; // exchange/other rows — excluded, disclosed
  dateAnomalies: number; // date_anomaly-flagged rows — excluded, disclosed (constraint 9)
}

function quarterOf(date: string): { label: string; end: string } {
  const y = Number(date.slice(0, 4));
  const m = Number(date.slice(5, 7));
  const q = Math.ceil(m / 3);
  const endMonth = q * 3;
  const endDay = endMonth === 3 || endMonth === 12 ? 31 : 30;
  return {
    label: `${String(y).slice(2)}Q${q}`,
    end: `${y}-${String(endMonth).padStart(2, "0")}-${endDay}`,
  };
}

function prevQuarterEnd(end: string): string {
  const y = Number(end.slice(0, 4));
  const m = Number(end.slice(5, 7));
  return m === 3 ? `${y - 1}-12-31` : `${y}-${String(m - 3).padStart(2, "0")}-${m - 3 === 6 || m - 3 === 9 ? 30 : 31}`;
}

/** Disclosed flow by quarter over the trailing `count` quarters ending at the
    quarter of `endDate` (the build's as-of). Quarters with no rows stay in the
    axis as gaps (C2) — they are never interpolated away. Quarter assignment
    uses the TRADE date; rows without one cannot be placed and are excluded
    with their count disclosed in the caption (C4). */
export function quarterlyFlow(
  allTxns: readonly TxnRow[],
  endDate: string,
  count = 8,
): QuarterlyFlowResult {
  const { rows: txns, excluded: dateAnomalies } = excludeDateAnomalies(allTxns);
  const ends: string[] = [];
  let cursor = quarterOf(endDate).end;
  for (let i = 0; i < count; i++) {
    ends.unshift(cursor);
    cursor = prevQuarterEnd(cursor);
  }
  const byEnd = new Map<string, { buys: TxnRow[]; sells: TxnRow[] }>();
  for (const end of ends) byEnd.set(end, { buys: [], sells: [] });
  let undated = 0;
  let excludedSides = 0;
  for (const t of txns) {
    if (!t.traded) {
      undated++;
      continue;
    }
    const q = quarterOf(t.traded);
    const bucket = byEnd.get(q.end);
    if (!bucket) continue; // outside the window — not an exclusion to disclose
    if (t.side === "purchase") bucket.buys.push(t);
    else if (t.side === "sale" || t.side === "sale_partial") bucket.sells.push(t);
    else excludedSides++;
  }
  return {
    quarters: ends.map((end) => ({
      q: quarterOf(end).label,
      quarterEnd: end,
      buy: sumRanges(byEnd.get(end)!.buys),
      sell: sumRanges(byEnd.get(end)!.sells),
    })),
    undated,
    excludedSides,
    dateAnomalies,
  };
}

/* ---------- trailing windows, medians, top tickers ---------- */

function monthsBefore(dateIso: string, months: number): string {
  const y = Number(dateIso.slice(0, 4));
  const m = Number(dateIso.slice(5, 7));
  const total = y * 12 + (m - 1) - months;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  return `${ny}-${String(nm).padStart(2, "0")}-${dateIso.slice(8, 10)}`;
}

/* ---------- the single congress window-membership authority ----------

   ONE rule decides whether a disclosure falls in a date window. Before this,
   two disagreed: the rollups matched on `traded ?? filed` (neither a traded
   nor a filed basis) while the feed island matched on an explicit basis with
   its own anomaly handling. Both now call `windowMembership`, and nothing else
   in the tree computes window membership.

   BASIS IS EXPLICIT AND ANOMALY POLICY FOLLOWS FROM IT (locked decision):
   on `traded`, rows flagged `date_anomaly` carry impossible trade dates and are
   EXCLUDED and counted, and rows with no trade date cannot be placed in a trade
   window so they are EXCLUDED and counted separately. On `filed`, the filed
   date is always well-defined and never anomalous, so NEITHER exclusion
   applies — a single cross-basis exclusion rule was explicitly rejected because
   it would silently change filed-basis feed results.

   `traded_or_filed` is the WEAKER LEGACY basis the per-member and per-ticker
   detail pages have always used: the trade date when present, else the filing
   date, which never precedes the trade. It is named rather than hidden so a
   reader can see it is a mixed claim, and it exists so those pages — explicit
   non-goals of this change — keep their exact numbers while still routing
   through this one predicate instead of a second rule. */

export type CongressRange = "7d" | "30d" | "90d" | "12m";

/** The two bases a reader can choose between on the congress surfaces. */
export type CongressBasis = "traded" | "filed";

/** Every basis the predicate accepts, including the legacy mixed one. */
export type WindowBasis = CongressBasis | "traded_or_filed";

/** An inclusive ISO calendar-date window `[start, end]`. Both ends are dates,
    never timestamps — the corpus stores dates and a timestamp comparison would
    silently drop the boundary day in a non-UTC reader's locale. */
export interface DateWindow {
  start: string; // YYYY-MM-DD, inclusive
  end: string; // YYYY-MM-DD, inclusive
}

/** Subtract one calendar year, clamping Feb 29 to Feb 28 when the target year
    is not a leap year (2024-02-29 → 2023-02-28, never an invalid 2023-02-29). */
function yearBefore(dateIso: string): string {
  const y = Number(dateIso.slice(0, 4)) - 1;
  const md = dateIso.slice(5);
  const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  return `${y}-${md === "02-29" && !leap ? "02-28" : md}`;
}

/** The locked bounds for a named range ending at `end` (the build's
    generated-at date). Day ranges span EXACTLY N calendar days INCLUDING
    `end`, so `start = end - (N - 1)`; a 7d window is 7 days, not 8. The 12m
    window starts one calendar year before `end` plus one day, so it likewise
    contains `end` and does not double-count the anniversary date. */
export function congressRangeBounds(range: CongressRange, end: string): DateWindow {
  const days = range === "7d" ? 7 : range === "30d" ? 30 : range === "90d" ? 90 : null;
  const start = days === null ? addDays(yearBefore(end), 1) : addDays(end, -(days - 1));
  return { start, end };
}

/** Reader-facing labels for a range and a basis. They live beside the rule
    rather than in a renderer because the SSR default view and the client
    rollup must produce IDENTICAL strings — the SSR/client parity test compares them
    byte for byte, and two copies of "12 months" would eventually disagree. */
export function rangeLabelOf(range: CongressRange): string {
  return range === "12m" ? "12 months" : `${range.slice(0, -1)} days`;
}

export function basisLabelOf(basis: CongressBasis): string {
  return basis === "traded" ? "trade date" : "filing date";
}

/** The window a section is actually showing, stated with its exact dates. A
    range name alone is not a measurement — the reader needs the bounds the
    build used, and those move with every build. */
export function windowStatement(range: CongressRange, basis: CongressBasis, w: DateWindow): string {
  return `trailing ${rangeLabelOf(range)} by ${basisLabelOf(basis)} · ${w.start} to ${w.end} inclusive`;
}

/** Why a row is or is not in the window. `anomaly` and `undated` are distinct
    from `out` because both are EXCLUSIONS a surface must state, not ordinary
    non-matches: a row that simply falls outside a window is not evidence of
    anything, while an excluded row is data the reader cannot see. */
export type WindowVerdict = "in" | "out" | "anomaly" | "undated";

/** THE window-membership rule. A null bound is unbounded on that side, which
    is what the feed's optional from/to inputs mean. */
export function windowMembership(
  row: Pick<TxnRow, "traded" | "filed" | "flags">,
  window: { start: string | null; end: string | null },
  basis: WindowBasis,
): WindowVerdict {
  let d: string | null;
  if (basis === "filed") {
    d = row.filed;
  } else if (basis === "traded_or_filed") {
    d = row.traded ?? row.filed;
  } else {
    if (row.flags.includes("date_anomaly")) return "anomaly";
    d = row.traded;
    if (d == null) return "undated";
  }
  if (window.start != null && window.start !== "" && d < window.start) return "out";
  if (window.end != null && window.end !== "" && d > window.end) return "out";
  return "in";
}

/** Rows kept by the window, with every exclusion counted so the caller can
    state it. Counts are of rows the basis EXCLUDED, never of rows that merely
    fell outside the dates. */
export interface WindowPartition<T> {
  rows: T[];
  dateAnomalies: number;
  undated: number;
}

/** Bounds for the LEGACY trailing-N-months windows the per-member and
    per-ticker detail pages use. Those pages are explicit non-goals of this
    change, so their boundaries are preserved to the day: `[now - N months,
    now]`, inclusive at both ends, with the day-of-month carried through. New
    surfaces use `congressRangeBounds` and its exact day arithmetic instead;
    this exists so the detail pages route through the ONE membership predicate
    rather than keeping a second rule of their own. */
export function legacyTrailingMonthsBounds(now: string, months: number): DateWindow {
  return { start: monthsBefore(now, months), end: now };
}

export function partitionByWindow<T extends Pick<TxnRow, "traded" | "filed" | "flags">>(
  rows: readonly T[],
  window: { start: string | null; end: string | null },
  basis: WindowBasis,
): WindowPartition<T> {
  const kept: T[] = [];
  let dateAnomalies = 0;
  let undated = 0;
  for (const r of rows) {
    const verdict = windowMembership(r, window, basis);
    if (verdict === "in") kept.push(r);
    else if (verdict === "anomaly") dateAnomalies++;
    else if (verdict === "undated") undated++;
  }
  return { rows: kept, dateAnomalies, undated };
}

export function medianLag(txns: readonly Pick<TxnRow, "lag">[]): number | null {
  const lags = txns.map((t) => t.lag).filter((l): l is number => l != null).sort((a, b) => a - b);
  if (lags.length === 0) return null;
  const mid = Math.floor(lags.length / 2);
  return lags.length % 2 === 1 ? lags[mid]! : Math.round((lags[mid - 1]! + lags[mid]!) / 2);
}

export function lateCount(txns: readonly Pick<TxnRow, "late">[]): number {
  return txns.filter((t) => t.late === 1).length;
}

export interface TopTicker {
  ticker: string;
  n: number;
  flow: SumRanges;
  last: string; // YYYY-MM of the latest trade (or filing when undated)
}

export function topTickers(
  txns: readonly TxnRow[],
  now: string,
  months = 24,
  limit = 6,
): TopTicker[] {
  const byTicker = new Map<string, TxnRow[]>();
  // Legacy detail-page window (non-goal surface): anomalies are dropped first,
  // then membership is decided by the ONE predicate on the mixed basis these
  // pages have always used. Identical rows in, identical rows out.
  const bounds = legacyTrailingMonthsBounds(now, months);
  for (const t of excludeDateAnomalies(txns).rows) {
    if (!t.ticker || windowMembership(t, bounds, "traded_or_filed") !== "in") continue;
    let list = byTicker.get(t.ticker);
    if (!list) {
      list = [];
      byTicker.set(t.ticker, list);
    }
    list.push(t);
  }
  return [...byTicker.entries()]
    .map(([ticker, rows]) => ({
      ticker,
      n: rows.length,
      flow: sumRanges(rows),
      last: rows.map((r) => (r.traded ?? r.filed).slice(0, 7)).sort().at(-1)!,
    }))
    .sort((a, b) => b.n - a.n || (a.ticker < b.ticker ? -1 : 1))
    .slice(0, limit);
}

export interface MemberDisclosing {
  bioguide: string | null;
  name: string;
  party: string;
  state: string | null;
  district: string | null;
  chamber: "house" | "senate";
  buys: number;
  sells: number;
  flow: SumRanges;
}

/** Members-disclosing rollup for a ticker (trailing window). Counts are FILED
    transactions, never net positions — ranges cannot be netted. */
export function membersDisclosing(
  txns: readonly TxnRow[],
  now: string,
  months = 12,
  limit = 7,
): MemberDisclosing[] {
  const byMember = new Map<string, TxnRow[]>();
  const bounds = legacyTrailingMonthsBounds(now, months);
  for (const t of excludeDateAnomalies(txns).rows) {
    if (windowMembership(t, bounds, "traded_or_filed") !== "in") continue;
    const key = t.bioguide ?? `raw:${t.name}`;
    let list = byMember.get(key);
    if (!list) {
      list = [];
      byMember.set(key, list);
    }
    list.push(t);
  }
  return [...byMember.values()]
    .map((rows) => {
      const first = rows[0]!;
      return {
        bioguide: first.bioguide,
        name: first.name,
        party: first.party,
        state: first.state,
        district: first.district,
        chamber: first.chamber,
        buys: rows.filter((r) => r.side === "purchase").length,
        sells: rows.filter((r) => r.side === "sale" || r.side === "sale_partial").length,
        flow: sumRanges(rows),
      };
    })
    .sort((a, b) => b.buys + b.sells - (a.buys + a.sells) || (a.name < b.name ? -1 : 1))
    .slice(0, limit);
}

/* ---------- C-3: member page v2 derivations ---------- */

export interface TickerNetRow {
  ticker: string;
  buys: number;
  sells: number;
  purchases: SumRanges;
  sales: SumRanges;
  net: NetInterval;
}

/** Net disclosed flow by ticker for one member — interval subtraction with
    open-bound propagation (F-10/F-13), over the member's whole disclosed
    history. Rows without a ticker are counted out, stated by the caller. */
export function memberNetByTicker(txns: readonly TxnRow[]): {
  rows: TickerNetRow[];
  noTickerRows: number;
} {
  const byTicker = new Map<string, TxnRow[]>();
  let noTickerRows = 0;
  for (const t of txns) {
    if (!t.ticker) {
      noTickerRows++;
      continue;
    }
    let list = byTicker.get(t.ticker);
    if (!list) {
      list = [];
      byTicker.set(t.ticker, list);
    }
    list.push(t);
  }
  const rows = [...byTicker.entries()].map(([ticker, list]) => {
    const buysRows = list.filter((r) => r.side === "purchase");
    const sellRows = list.filter((r) => r.side === "sale" || r.side === "sale_partial");
    const purchases = sumRanges(buysRows);
    const sales = sumRanges(sellRows);
    return { ticker, buys: buysRows.length, sells: sellRows.length, purchases, sales, net: netFlow(purchases, sales) };
  });
  return { rows, noTickerRows };
}

/** How a ticker resolves toward a sector. Every failure mode is its own
    labeled bucket — a mix that collapsed them would overstate coverage. */
export type SectorResolution =
  | { state: "sector"; sector: string }
  | { state: "unresolved-ticker" } // ticker→issuer mapping has no (unique) answer
  | { state: "no-sic" }; // issuer resolved, but no SIC on record

export interface SectorMixRow {
  key: string; // sector name, or the bucket label
  bucket: boolean; // true → a coverage bucket, not a sector claim
  txns: number;
  flow: SumRanges;
}

export function sectorMix(
  txns: readonly TxnRow[],
  resolve: (ticker: string) => SectorResolution,
): SectorMixRow[] {
  const groups = new Map<string, { bucket: boolean; rows: TxnRow[] }>();
  const put = (key: string, bucket: boolean, row: TxnRow): void => {
    let g = groups.get(key);
    if (!g) {
      g = { bucket, rows: [] };
      groups.set(key, g);
    }
    g.rows.push(row);
  };
  for (const t of txns) {
    if (!t.ticker) {
      put("no ticker disclosed", true, t);
      continue;
    }
    const res = resolve(t.ticker);
    if (res.state === "sector") put(res.sector, false, t);
    else if (res.state === "unresolved-ticker") put("ticker not resolved to an issuer", true, t);
    else put("issuer has no SIC on record", true, t);
  }
  return [...groups.entries()]
    .map(([key, g]) => ({ key, bucket: g.bucket, txns: g.rows.length, flow: sumRanges(g.rows) }))
    .sort((a, b) =>
      a.bucket !== b.bucket ? (a.bucket ? 1 : -1) : b.txns - a.txns || (a.key < b.key ? -1 : 1),
    );
}

/* --- committee membership as of the trade date (B-6 consumer) --- */

export interface CommitteeMembership {
  committeeId: string;
  name: string;
  role: string | null;
  validFrom: string;
  validTo: string;
}

/** One member's memberships PLUS the snapshot-wide validity window. The
    window is a property of the SNAPSHOT (all members), not of one member's
    rows — a member with zero rows inside a valid snapshot is
    KNOWN to sit on no committee, which is [] and not null. */
export interface MembershipSnapshot {
  memberships: readonly CommitteeMembership[];
  windowFrom: string;
  windowTo: string;
}

/** TS twin of the producer's dating rule: committees as of `tradeDate`; []
    means known-none (date inside the snapshot window, no rows); NULL means
    unknown (no snapshot, undated trade, or date outside the snapshot's
    validity) — the two are never collapsed. */
export function membershipAsOf(
  snapshot: MembershipSnapshot | null,
  tradeDate: string | null,
): CommitteeMembership[] | null {
  if (snapshot === null) return null;
  if (tradeDate == null || !/^\d{4}-\d{2}-\d{2}$/.test(tradeDate)) return null;
  if (tradeDate < snapshot.windowFrom || tradeDate > snapshot.windowTo) return null;
  return snapshot.memberships.filter((r) => r.validFrom <= tradeDate && r.validTo >= tradeDate);
}

export interface JurisdictionOverlapRow {
  txn: TxnRow;
  sector: string;
  committees: { committeeId: string; name: string }[];
}

export interface JurisdictionOverlapResult {
  rows: JurisdictionOverlapRow[];
  undatable: number;
  /** trades where the member sat on ≥1 committee ABSENT from the (deliberately
      partial) jurisdiction mapping and no mapped committee matched — the
      question is UNANSWERABLE for them, never a confirmed non-overlap */
  coverageUnknown: number;
  /** the unmapped committee ids encountered, for the coverage statement */
  unmappedCommittees: string[];
}

/** S-5 context rows: disclosed trades whose issuer's sector falls inside a
    committee the member sat on AS OF THE TRADE DATE. A trade whose date the
    membership snapshots cannot answer is skipped and counted — never joined
    against current membership as if dated. Renders only WITH the
    non-allegation caveat (the renderer owns that; this function computes the
    join and nothing more). */
export function jurisdictionOverlap(
  txns: readonly TxnRow[],
  snapshot: MembershipSnapshot,
  jurisdictionByCommittee: ReadonlyMap<string, readonly string[]>,
  resolve: (ticker: string) => SectorResolution,
): JurisdictionOverlapResult {
  const rows: JurisdictionOverlapRow[] = [];
  let undatable = 0;
  let coverageUnknown = 0;
  const unmapped = new Set<string>();
  for (const t of excludeDateAnomalies(txns).rows) {
    if (!t.ticker) continue;
    const res = resolve(t.ticker);
    if (res.state !== "sector") continue;
    const asOf = membershipAsOf(snapshot, t.traded);
    if (asOf === null) {
      undatable++;
      continue;
    }
    const hits = asOf.filter((m) =>
      (jurisdictionByCommittee.get(m.committeeId) ?? []).includes(res.sector),
    );
    if (hits.length > 0) {
      rows.push({
        txn: t,
        sector: res.sector,
        committees: hits.map((h) => ({ committeeId: h.committeeId, name: h.name })),
      });
      continue;
    }
    // No mapped hit. If any committee the member sat on that day is absent
    // from the mapping, the answer is UNKNOWN for this trade, not "no".
    const unmappedHere = asOf.filter((m) => !jurisdictionByCommittee.has(m.committeeId));
    if (unmappedHere.length > 0) {
      coverageUnknown++;
      for (const m of unmappedHere) unmapped.add(m.committeeId);
    }
  }
  return { rows, undatable, coverageUnknown, unmappedCommittees: [...unmapped].sort() };
}

/* ---------- A-4: largest recent disclosures (homepage rail) ---------- */

export interface NotableRecentResult {
  rows: TxnRow[]; // largest first, by disclosed LOWER bound (F-16 — never the upper)
  windowFrom: string; // inclusive filed-date window start
  /** in-window rows whose amount has no lower bound at all — they cannot rank
      in a "largest" list and their count is disclosed instead */
  unrankable: number;
  dateAnomalies: number; // constraint 9, disclosed
}

/** The homepage "notable this week" rail: filings from the trailing `days`
    by FILED date, ranked by the disclosed lower bound (a capped "Under $X"
    row has lower bound 0 and legitimately ranks last). Ties break filed desc
    then load order, so the rail is reproducible per build. */
export function notableRecent(
  allTxns: readonly TxnRow[],
  now: string,
  days = 7,
  limit = 5,
): NotableRecentResult {
  const { rows: txns, excluded: dateAnomalies } = excludeDateAnomalies(allTxns);
  // The rail's existing bounds are preserved to the day — this is the homepage
  // surface, not a section this change rebuilds. Only MEMBERSHIP moves to the
  // shared predicate, on the filed basis the rail has always used.
  const from = addDays(now, -days);
  const inWindow = txns.filter((t) => windowMembership(t, { start: from, end: now }, "filed") === "in");
  const lowOf = (t: TxnRow): number | null => (t.low != null ? t.low : t.high != null ? 0 : null);
  const rankable = inWindow.filter((t) => lowOf(t) !== null);
  const order = new Map(allTxns.map((t, i) => [t, i]));
  rankable.sort((a, b) => {
    const ka = lowOf(a)!;
    const kb = lowOf(b)!;
    if (ka !== kb) return kb - ka;
    if (a.filed !== b.filed) return a.filed < b.filed ? 1 : -1;
    return (order.get(a) ?? 0) - (order.get(b) ?? 0);
  });
  return {
    rows: rankable.slice(0, limit),
    windowFrom: from,
    unrankable: inWindow.length - rankable.length,
    dateAnomalies,
  };
}

/* ---------- QoQ presentation mapping (docs/qoq-presentation.md §1) ---------- */

export interface QoqPresentation {
  chipText: string;
  chipCls: "qoq-new" | "qoq-add" | "qoq-trim" | "qoq-exit" | "qoq-nc";
  /** page-scoped markers the chip carries (each resolves to a footnote line) */
  chipMarkers: string[];
  /** ‡r on the position cell when identity was producer-reconciled */
  positionMarkers: string[];
  /** value-delta cell: number | hatched n/c | em-dash */
  valueDelta: { kind: "num"; text: string } | { kind: "nc" } | { kind: "dash" };
  sharesDeltaText: string; // "—" when NULL (never 0)
  /** grain disclosure beside the position, "" when LONG · SH */
  grainNote: string;
}

const CHIP: Record<string, { text: string; cls: QoqPresentation["chipCls"] }> = {
  new: { text: "new", cls: "qoq-new" },
  add: { text: "add", cls: "qoq-add" },
  trim: { text: "trim", cls: "qoq-trim" },
  exit: { text: "exit", cls: "qoq-exit" },
  unclassified: { text: "n/c", cls: "qoq-nc" },
};

export function qoqPresentation(row: QoqDeltaRow): QoqPresentation {
  // Fail-closed: an unknown change_kind presents as not-classifiable, never a
  // guessed direction (the producer owns classification).
  const chip = CHIP[row.change_kind] ?? CHIP.unclassified!;
  const chipMarkers: string[] = [];
  const positionMarkers: string[] = [];
  if (row.change_kind === "exit") chipMarkers.push("‡e");
  if (row.flags.includes("classified_by_value")) chipMarkers.push("†v");
  if (row.flags.includes("shares_unit_mismatch")) chipMarkers.push("‡u");
  if (row.flags.includes("identity_reconciled_by_cusip")) positionMarkers.push("‡r");

  let valueDelta: QoqPresentation["valueDelta"];
  if (row.delta_value_usd != null) {
    const sign = row.delta_value_usd > 0 ? "+" : "";
    valueDelta = { kind: "num", text: `${sign}${fmtUsd(row.delta_value_usd)}` };
  } else if (row.flags.includes("value_undisclosed_one_side")) {
    valueDelta = { kind: "nc" };
  } else {
    valueDelta = { kind: "dash" };
  }

  const sharesDeltaText =
    row.delta_shares == null
      ? "—"
      : `${row.delta_shares > 0 ? "+" : row.delta_shares < 0 ? "−" : ""}${fmtInt(Math.abs(row.delta_shares))}`;

  const grainParts: string[] = [];
  if (row.put_call !== "LONG") grainParts.push(row.put_call);
  if (row.ssh_prnamt_type === "PRN") grainParts.push("PRN");
  else if (row.ssh_prnamt_type !== "SH") grainParts.push("unit —");

  return {
    chipText: chip.text,
    chipCls: chip.cls,
    chipMarkers,
    positionMarkers,
    valueDelta,
    sharesDeltaText,
    grainNote: grainParts.join(" · "),
  };
}

/* ---------- S7 filing-window state ---------- */

export interface FilingWindow {
  open: boolean;
  quarterEnd: string; // the quarter the open window belongs to
  deadline: string; // quarter end + 45 days
}

function addDays(dateIso: string, days: number): string {
  const t = Date.UTC(
    Number(dateIso.slice(0, 4)),
    Number(dateIso.slice(5, 7)) - 1,
    Number(dateIso.slice(8, 10)),
  );
  const d = new Date(t + days * 86_400_000);
  return d.toISOString().slice(0, 10);
}

/** Calendar-derived 13F window: the latest quarter end at or before the
    build's generated_at date, open while generated_at ≤ quarter end + 45d.
    Suppression when the module is absent is the caller's responsibility. */
export function filingWindow(generatedAtDate: string): FilingWindow {
  const d = generatedAtDate.slice(0, 10);
  const y = Number(d.slice(0, 4));
  const candidates = [
    `${y - 1}-12-31`,
    `${y}-03-31`,
    `${y}-06-30`,
    `${y}-09-30`,
    `${y}-12-31`,
  ];
  let quarterEnd = candidates[0]!;
  for (const c of candidates) {
    if (c <= d) quarterEnd = c;
  }
  const deadline = addDays(quarterEnd, 45);
  return { open: d <= deadline, quarterEnd, deadline };
}

/* ---------- generic-route key parsing (S2/S4) ---------- */

export type EntityKey =
  | { ok: true; kind: "m" | "t" | "f"; key: string }
  | { ok: false; reason: "missing" | "malformed" };

const BIOGUIDE_RE = /^[A-Z]\d{6}$/;
const TICKER_KEY_RE = /^[A-Z0-9][A-Z0-9.:$\-]{0,15}$/;
const CIK_RE = /^\d{1,10}$/;

export function parseEntityKey(raw: string | null): EntityKey {
  if (!raw) return { ok: false, reason: "missing" };
  const idx = raw.indexOf(":");
  if (idx < 1) return { ok: false, reason: "malformed" };
  const kind = raw.slice(0, idx);
  const key = raw.slice(idx + 1);
  if (kind === "m") {
    return BIOGUIDE_RE.test(key) ? { ok: true, kind: "m", key } : { ok: false, reason: "malformed" };
  }
  if (kind === "t") {
    const t = key.toUpperCase();
    return TICKER_KEY_RE.test(t) ? { ok: true, kind: "t", key: t } : { ok: false, reason: "malformed" };
  }
  if (kind === "f") {
    if (!CIK_RE.test(key)) return { ok: false, reason: "malformed" };
    return { ok: true, kind: "f", key: key.padStart(10, "0") };
  }
  return { ok: false, reason: "malformed" };
}

/** Endpoint filename key for a ticker: `:` (legal in tickers like CRYPTO:BTC)
    maps to `~`, which no ticker contains — colons are hostile to some
    filesystems/CDNs in static file names. Deterministic and collision-free. */
export function tickerDataKey(ticker: string): string {
  // Injective, filename- and route-safe for EVERY ticker (every ticker gets a
  // data endpoint, and the Senate corpus contains tickers
  // with raw whitespace). Safe bytes pass through; anything else — including
  // the legacy ':' and the escape character itself — becomes ~XX per UTF-8
  // byte. Deterministic and collision-free, so the same function computes the
  // same key at build time and in the /e/ client.
  let out = "";
  for (const ch of ticker) {
    if (/^[A-Za-z0-9._-]$/.test(ch)) out += ch;
    else
      for (const byte of new TextEncoder().encode(ch))
        out += "~" + byte.toString(16).toUpperCase().padStart(2, "0");
  }
  // The real Senate corpus contains a "ticker" of newlines and ~40 spaces;
  // escaping tripled it past the 255-byte filename limit (ENAMETOOLONG on the
  // runner). Over-long keys keep a readable prefix and gain a digest tail.
  // Injectivity is no longer structural for these, so `tickerDataKeys` asserts
  // key uniqueness at build time — a collision fails the build loudly rather
  // than serving one ticker's data under another's name.
  if (out.length > 120) out = out.slice(0, 80) + "~~" + fnv1a64(ticker);
  return out;
}

/** FNV-1a 64-bit, hex — sync and dependency-free so the /e/ client computes
    the identical key with the identical code. ONE implementation, shared with
    the signal-id derivation (reuse map). */
export function fnv1a64(s: string): string {
  let h = 0xcbf29ce484222325n;
  for (const byte of new TextEncoder().encode(s)) {
    h ^= BigInt(byte);
    h = (h * 0x100000001b3n) & 0xffffffffffffffffn;
  }
  return h.toString(16).padStart(16, "0");
}

export function memberDataPath(bioguide: string): string {
  return `/congress/data/members/${encodeURIComponent(bioguide)}.v1.json`;
}

export function tickerDataPath(ticker: string): string {
  return `/congress/data/tickers/${encodeURIComponent(tickerDataKey(ticker))}.v1.json`;
}

/* ---------- fetch-outcome classifier (spec §3) ---------- */

export interface EntityPayload {
  v: number;
  kind: "m" | "t";
  t: unknown[][];
  p: unknown[][];
  meta: Record<string, unknown>;
}

export type FetchClassification =
  | { outcome: "ok"; payload: EntityPayload }
  | { outcome: "not_found" }
  | { outcome: "server_error"; status: number }
  | { outcome: "bad_payload"; detail: string }
  | { outcome: "version_mismatch"; got: unknown };

export function classifyResponse(status: number, body: unknown): FetchClassification {
  if (status === 404) return { outcome: "not_found" };
  if (status < 200 || status >= 300) return { outcome: "server_error", status };
  if (typeof body !== "object" || body === null) {
    return { outcome: "bad_payload", detail: "payload is not a JSON object" };
  }
  const p = body as Record<string, unknown>;
  if (typeof p.v !== "number") return { outcome: "bad_payload", detail: "payload has no version field" };
  if (p.v !== DATASET_VERSION) return { outcome: "version_mismatch", got: p.v };
  if (p.kind !== "m" && p.kind !== "t") {
    return { outcome: "bad_payload", detail: "payload has no entity kind" };
  }
  if (!Array.isArray(p.t) || !Array.isArray(p.p) || typeof p.meta !== "object" || p.meta === null) {
    return { outcome: "bad_payload", detail: "payload is missing its column arrays" };
  }
  return { outcome: "ok", payload: p as unknown as EntityPayload };
}

/* ---------- ticker→issuer mapping (docs/qoq-presentation.md §4) ---------- */

export interface TickerMapEntry {
  cik: string; // 10-digit
  name: string;
}

export interface TickerMap {
  byTicker: Map<string, TickerMapEntry | "ambiguous">;
  read: number;
  malformed: number;
  titleConflict: number;
  duplicate: number;
}

const SEC_TICKER_RE = /^[A-Z0-9][A-Z0-9.\-]{0,15}$/;

function normCik(raw: unknown): string | null {
  if (raw == null) return null;
  let text = String(raw).trim();
  if (text.toLowerCase().startsWith("cik")) text = text.slice(3).replace(/^:/, "").trim();
  if (!text || !/^\d+$/.test(text)) return null;
  const significant = text.replace(/^0+/, "");
  if (significant.length > 10) return null;
  return significant.padStart(10, "0");
}

function normTicker(raw: unknown): string | null {
  if (raw == null) return null;
  const text = String(raw).normalize("NFC").trim().toUpperCase();
  return SEC_TICKER_RE.test(text) ? text : null;
}

function normName(raw: unknown): string | null {
  if (raw == null) return null;
  const text = String(raw).normalize("NFC").replace(/\s+/g, " ").trim();
  return text || null;
}

/** Parse a company_tickers.json snapshot with the SAME dispositions as the
    pipeline's identity bootstrap (malformed / DC1 title conflict / duplicate),
    then index for the ticker→issuer direction: a ticker naming more than one
    CIK is deterministically AMBIGUOUS — rejected, never picked from. */
export function parseTickerMap(data: unknown): TickerMap {
  let entries: unknown[];
  if (Array.isArray(data)) {
    entries = data;
  } else if (typeof data === "object" && data !== null) {
    const keys = Object.keys(data as Record<string, unknown>).sort((a, b) => {
      const na = /^\d+$/.test(a) ? Number(a) : Number.POSITIVE_INFINITY;
      const nb = /^\d+$/.test(b) ? Number(b) : Number.POSITIVE_INFINITY;
      return na === nb ? (a < b ? -1 : 1) : na - nb;
    });
    entries = keys.map((k) => (data as Record<string, unknown>)[k]);
  } else {
    throw new Error("company_tickers must be an object or a list");
  }

  let malformed = 0;
  const valid: { cik: string; ticker: string; name: string }[] = [];
  for (const entry of entries) {
    if (typeof entry !== "object" || entry === null) {
      malformed++;
      continue;
    }
    const e = entry as Record<string, unknown>;
    const cik = normCik(e.cik_str);
    const ticker = normTicker(e.ticker);
    const name = normName(e.title);
    if (cik === null || ticker === null || name === null) {
      malformed++;
      continue;
    }
    valid.push({ cik, ticker, name });
  }

  // DC1: a CIK with two distinct normalized titles in one snapshot rejects ALL
  // of its rows — decided across every valid row before duplicate bucketing.
  const titles = new Map<string, Set<string>>();
  for (const row of valid) {
    let set = titles.get(row.cik);
    if (!set) {
      set = new Set();
      titles.set(row.cik, set);
    }
    set.add(row.name);
  }
  const conflicted = new Set([...titles.entries()].filter(([, s]) => s.size > 1).map(([c]) => c));

  let titleConflict = 0;
  let duplicate = 0;
  const seen = new Set<string>();
  const byTicker = new Map<string, TickerMapEntry | "ambiguous">();
  for (const row of valid) {
    if (conflicted.has(row.cik)) {
      titleConflict++;
      continue;
    }
    const pairKey = `${row.cik} ${row.ticker}`;
    if (seen.has(pairKey)) {
      duplicate++;
      continue;
    }
    seen.add(pairKey);
    const existing = byTicker.get(row.ticker);
    if (existing === undefined) {
      byTicker.set(row.ticker, { cik: row.cik, name: row.name });
    } else if (existing !== "ambiguous" && existing.cik !== row.cik) {
      byTicker.set(row.ticker, "ambiguous");
    }
  }
  return { byTicker, read: entries.length, malformed, titleConflict, duplicate };
}

export type TickerResolution =
  | { state: "resolved"; cik: string; issuerKey: string; name: string }
  | { state: "ambiguous" }
  | { state: "unmapped" }
  | { state: "no-map" };

export function resolveTicker(map: TickerMap | null, ticker: string): TickerResolution {
  if (map === null) return { state: "no-map" };
  const entry = map.byTicker.get(ticker.toUpperCase());
  if (entry === undefined) return { state: "unmapped" };
  if (entry === "ambiguous") return { state: "ambiguous" };
  return {
    state: "resolved",
    cik: entry.cik,
    issuerKey: `entity:cik:${entry.cik}`,
    name: entry.name,
  };
}

/* ---------- search index ---------- */

/** The exact serialized field allowlist — arrays of fixed-arity tuples, no
    objects, so an accidental field addition fails the shape test. */
export interface SearchIndex {
  v: 1;
  tickers: [string, string, number][]; // [ticker, mapped issuer name or "", txn count]
  members: [string, string, string, number][]; // [bioguide, name, affiliation, row count]
  filers: [string, string, 0 | 1][]; // [cik (unpadded), filer name, 1 = top-1500 pre-rendered]
}

export function buildSearchIndex(
  members: readonly { bioguide: string; name: string; aff: string; rows: number }[],
  tickers: readonly { ticker: string; name: string; rows: number }[],
  filers: readonly { cik: string; name: string; top: boolean }[],
): SearchIndex {
  return {
    v: 1,
    tickers: tickers.map((t) => [t.ticker, t.name, t.rows]),
    members: members.map((m) => [m.bioguide, m.name, m.aff, m.rows]),
    // The tier flag rides in the index so a client hit can address the
    // top/tail target through filerHref — a tail hit must not link to a
    // pre-rendered route that does not exist.
    filers: filers.map((f) => [f.cik.replace(/^0+/, ""), f.name, f.top ? 1 : 0]),
  };
}

export interface SearchHit {
  kind: "ticker" | "member" | "filer";
  key: string;
  label: string;
  sub: string;
  href: string;
}

export function searchIndexValid(data: unknown): data is SearchIndex {
  if (typeof data !== "object" || data === null) return false;
  const d = data as Record<string, unknown>;
  return d.v === 1 && Array.isArray(d.tickers) && Array.isArray(d.members) && Array.isArray(d.filers);
}

/** Client-side query over the prebuilt index: ticker prefix, name substring.
    Free text never leaves the device — this is the whole search engine. */
export function searchQuery(index: SearchIndex, q: string, limit = 8): SearchHit[] {
  const query = q.trim();
  if (!query) return [];
  const upper = query.toUpperCase();
  const lower = query.toLowerCase();
  const hits: SearchHit[] = [];
  for (const [ticker, name, rows] of index.tickers) {
    if (!ticker.startsWith(upper)) continue;
    hits.push({
      kind: "ticker",
      key: ticker,
      label: ticker,
      sub: name || `${fmtInt(rows)} disclosed txns`,
      href: `/tickers/${encodeURIComponent(ticker)}/`,
    });
    if (hits.length >= limit) break;
  }
  let count = 0;
  for (const [bioguide, name, aff, rows] of index.members) {
    if (!name.toLowerCase().includes(lower)) continue;
    hits.push({
      kind: "member",
      key: bioguide,
      label: name,
      sub: `${aff} · ${fmtInt(rows)} rows`,
      href: `/congress/members/${encodeURIComponent(bioguide)}/`,
    });
    if (++count >= limit) break;
  }
  count = 0;
  for (const [cik, name, top] of index.filers) {
    if (!name.toLowerCase().includes(lower)) continue;
    hits.push({
      kind: "filer",
      key: cik,
      label: name,
      sub: `CIK ${cik.padStart(10, "0")}`,
      // ONE href primitive (filerHref): older indexes without the tier flag resolve
      // as tail — the /e/ shell is prerendered and never 404s.
      href: filerHref(cik, top === 1 ? "top" : "tail"),
    });
    if (++count >= limit) break;
  }
  return hits;
}

/* ---------- budget walk (ARCHITECTURE §9.10/§12.1) ---------- */

/** Headroom under the §9.10 ≤8,500 module-1 page cap (owner decision
    2026-08-01: raised from 4,000 for the 13-year corpus's 3,856-ticker tail):
    entity pages other than the fixed routes. A member consumes one page; a
    ticker consumes two (unified + deep congressional view). */
export const DEFAULT_ENTITY_PAGE_BUDGET = 8300;

export interface BudgetCut {
  cutMembers: Set<string>;
  cutTickers: Set<string>;
}

/** Deterministic rank-cut: members first (row count desc, bioguide asc), then
    tickers (txn count desc, ticker asc). Every cut entity keeps its data
    endpoint and is reachable at /e/?k=… — the cut changes where a page
    renders, never whether the record is reachable. */
export function budgetWalk(
  members: readonly { bioguide: string; rows: number }[],
  tickers: readonly { ticker: string; rows: number }[],
  budget: number,
): BudgetCut {
  const cutMembers = new Set<string>();
  const cutTickers = new Set<string>();
  let remaining = budget;
  const rankedMembers = [...members].sort(
    (a, b) => b.rows - a.rows || (a.bioguide < b.bioguide ? -1 : 1),
  );
  for (const m of rankedMembers) {
    if (remaining >= 1) remaining -= 1;
    else cutMembers.add(m.bioguide);
  }
  const rankedTickers = [...tickers].sort(
    (a, b) => b.rows - a.rows || (a.ticker < b.ticker ? -1 : 1),
  );
  for (const t of rankedTickers) {
    if (remaining >= 2) remaining -= 2;
    else cutTickers.add(t.ticker);
  }
  return { cutMembers, cutTickers };
}

/* ---------- primary-source URLs ---------- */

export function edgarFilerUrl(cik: string): string {
  return `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${encodeURIComponent(cik)}&type=13F&dateb=&owner=include&count=40`;
}

export function edgarTickerUrl(ticker: string): string {
  return `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${encodeURIComponent(ticker)}&type=&dateb=&owner=include&count=40`;
}

export function bioguideProfileUrl(bioguide: string): string {
  return `https://bioguide.congress.gov/search/bio/${encodeURIComponent(bioguide)}`;
}

/* ---------- misc shared text ---------- */

export function affTextOf(m: Pick<MemberEntity, "party" | "state" | "district" | "chamber">): string {
  if (!m.party && !m.state) return "—";
  const p = m.party || "?";
  if (!m.state) return p;
  if (m.chamber === "house" && m.district != null && m.district !== "") {
    const d = m.district === "0" ? "AL" : /^[1-9][0-9]*$/.test(m.district) ? m.district : null;
    if (d !== null) return `${p}–${m.state}-${d}`;
  }
  return `${p}–${m.state}`;
}

/** "D–CA-11" long form: "Democrat — California 11th" is not derivable from
    the members table codes without a state-name table; the compact affiliation
    is the honest, source-backed form used everywhere. */
export function partyLabel(party: string): string {
  return party === "D" ? "Democrat" : party === "R" ? "Republican" : party === "I" ? "Independent" : "";
}

export function escAttr(s: string): string {
  return esc(s);
}
