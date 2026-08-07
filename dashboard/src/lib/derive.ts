/* Pure derivations shared by the build-time pages, the entity endpoints, and
   the client driver. No Node APIs, no DOM APIs — everything here is a function
   of its arguments, so SSR and the generic entity route compute identical
   numbers from identical rows.

   Normative specs: dashboard/docs/qoq-presentation.md (QoQ mapping, typed
   sumRanges, S4 taxonomy, ticker→issuer mapping, institutional time stamp)
   and dashboard/docs/pagination-and-counts.md (reused unchanged). */

import { pathSafeTicker } from "./format.ts";
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

/** Count-based undisclosed fraction for hatch captions (R15): rows whose
    amounts did not parse, over all rows in the aggregate. */
export function undisclosedPctText(s: SumRanges): string | null {
  if (s.kind === "undisclosed") return "100%";
  if (s.kind === "open" && s.undisclosed > 0) {
    return `${Math.round((s.undisclosed / s.rows) * 100)}%`;
  }
  return null;
}

/* ---------- quarterly flow (C1–C7) ---------- */

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
  txns: readonly TxnRow[],
  endDate: string,
  count = 8,
): QuarterlyFlowResult {
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

/** Rows whose trade (falling back to filing, which never precedes the trade)
    is within the trailing window ending at `now`. */
export function inTrailingMonths(t: Pick<TxnRow, "traded" | "filed">, now: string, months: number): boolean {
  const d = t.traded ?? t.filed;
  return d >= monthsBefore(now, months) && d <= now;
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
  for (const t of txns) {
    if (!t.ticker || !inTrailingMonths(t, now, months)) continue;
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
  for (const t of txns) {
    if (!inTrailingMonths(t, now, months)) continue;
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

/* ---------- QoQ presentation mapping (Locked #8, spec §1) ---------- */

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

/* ---------- S7 filing-window state (Locked #17) ---------- */

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
  // Injective, filename- and route-safe for EVERY ticker (Locked #13 says
  // every ticker gets a data endpoint, and the Senate corpus contains tickers
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
    the identical key with the identical code. */
function fnv1a64(s: string): string {
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

/* ---------- ticker→issuer mapping (Locked #18, spec §4) ---------- */

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

/* ---------- search index (R11) ---------- */

/** The exact serialized field allowlist — arrays of fixed-arity tuples, no
    objects, so an accidental field addition fails the shape test. */
export interface SearchIndex {
  v: 1;
  tickers: [string, string, number][]; // [ticker, mapped issuer name or "", txn count]
  members: [string, string, string, number][]; // [bioguide, name, affiliation, row count]
  filers: [string, string][]; // [cik (unpadded), filer name]
}

export function buildSearchIndex(
  members: readonly { bioguide: string; name: string; aff: string; rows: number }[],
  tickers: readonly { ticker: string; name: string; rows: number }[],
  filers: readonly { cik: string; name: string }[],
): SearchIndex {
  return {
    v: 1,
    tickers: tickers.map((t) => [t.ticker, t.name, t.rows]),
    members: members.map((m) => [m.bioguide, m.name, m.aff, m.rows]),
    filers: filers.map((f) => [f.cik.replace(/^0+/, ""), f.name]),
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
  for (const [cik, name] of index.filers) {
    if (!name.toLowerCase().includes(lower)) continue;
    hits.push({
      kind: "filer",
      key: cik,
      label: name,
      sub: `CIK ${cik.padStart(10, "0")}`,
      href: `/institutional/filers/${encodeURIComponent(cik)}/`,
    });
    if (++count >= limit) break;
  }
  return hits;
}

/* ---------- budget walk (ARCHITECTURE §9.10/§12.1, Locked #13) ---------- */

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
