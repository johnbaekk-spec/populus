/* R14 (SRC §6-i, §6-iii) — the notable-manager moves and the consensus
   board, plus the per-period shard. signals-v4 M2 (R11, R12, R14, LD11, LD13):
   the moves and the board render on /signals/#institutional
   (`ui/signals-institutional.ts`) from the FULL in-build population; this
   module keeps their model — the board, the Named-moves DOM set and its slice
   totals, the lead-card picks — and the shard stays a public file with no
   page consumer (debt TD-3).

   Population: the registry's `notable` managers, ONE closed quarter, kinds
   new / add / trim / exit — classified by SHARES (R8) — with the producer's
   `book_discontinuity` rows excluded (R6). Everything derives from the serving
   activity grain already loaded for the landing feed, so the band, the shard
   and the consensus board cannot disagree about a row.

   Pure: no Node APIs, no DOM. The routes, the page and the tests all call the
   same functions. */

/* This module is CLIENT-SAFE: it is reached from `ui/institutional.ts`
   (`positionAnchor`) and from the landing island, so it imports no Node-backed
   module. The derivation that reads the serving grain lives beside it in
   `notable-moves-derive.ts` (server only). */
import type { ManagerType } from "./manager-directory.ts";
import type { LedgerItem } from "./ui/shared.ts";
import { displayIssuerName, esc, fmtInt, fmtUsd, slug } from "./format.ts";

export type MoveKind = "new" | "add" | "trim" | "exit";

/** One row of the band, as embedded and as served by the shard. */
export interface NotableMove {
  cik: string;
  /** curated display name (registry) */
  manager: string;
  principal: string | null;
  type: ManagerType;
  issuer: string;
  ticker: string | null;
  /** the mapping row's verified date, when a ticker is shown (LD6 ⓘ) */
  ticker_verified: string | null;
  kind: MoveKind;
  delta_shares: number | null;
  curr_value: number | null;
  delta_value: number | null;
  filed: string | null;
  doc: string | null;
  /** the position key, for the filer-page anchor (`#pos-<slug>`) */
  key: string;
  /** the producer's issuer key (grouping key of the consensus board); null = unkeyed */
  ikey: string | null;
}

export interface NotableMovesShard {
  v: 1;
  period: string;
  /** rows in the full population, before any byte bound */
  total: number;
  truncated: boolean;
  rows: NotableMove[];
}

/** New > Exit > Add > Trim (SRC §6-i). */
export const MOVE_KIND_PRIORITY: Record<MoveKind, number> = { new: 0, exit: 1, add: 2, trim: 3 };

/** The filer-page anchor of one position's change row (institutional.ts
    renders `id="pos-<slug(position_key)>"` on every changes row). */
export function positionAnchor(positionKey: string): string {
  return `pos-${slug(positionKey)}`;
}

/* ---------- the signed figures every move surface prints ---------- */

/** "+$1.2M" / "−$1.2M", or "—" for an undisclosed value. */
export function signedUsd(v: number | null): string {
  if (v == null) return "—";
  return v < 0 ? `−${fmtUsd(Math.abs(v))}` : `+${fmtUsd(v)}`;
}
/** "+1,234" / "−1,234" shares, or "—". */
export function signedShares(v: number | null): string {
  if (v == null) return "—";
  return v < 0 ? `−${fmtInt(Math.abs(v))}` : `+${fmtInt(v)}`;
}

/* ---------- the consensus board (SRC §6-iii) ---------- */

export interface ConsensusRow {
  issuerKey: string;
  issuer: string;
  ticker: string | null;
  newStakes: number;
  adds: number;
  trims: number;
  exits: number;
  /** distinct notable filers with any move in the name */
  filers: number;
  netDeltaUsd: number | null;
  netDeltaPartial: boolean;
  topMover: { manager: string; kind: MoveKind; cik: string } | null;
  /** R28: set only when another qualifying issuer key resolves to the same
      display name and the ticker does not tell them apart — the stable issuer
      key's ordinal among the keys sharing the name ("#2"). */
  disambiguator?: string | null;
}

/* ---------- R28: the reviewed fund-wrapper list ---------- */

/** One reviewed fund-wrapper registrant. `key` is the stable identity: the
    issuer name as filed, normalized (`normalizedIssuerName` — whitespace
    collapsed, upper case), so every issuer key the producer assigns that
    registrant matches it however many share classes or series it files
    under. `name` is the reviewed name; `why` the review note. */
export interface FundWrapperEntry {
  key: string;
  name: string;
  why: string;
}

/** The identity the list is keyed on (DESIGN-POLISH R21: the normalized,
    upper-case name as filed). */
export function normalizedIssuerName(raw: string | null | undefined): string {
  return String(raw ?? "").split(/\s+/).filter((t) => t !== "").join(" ").toUpperCase();
}

/** R28 (H-11): registrants that are fund wrappers — trusts and ETF series
    whose "consensus" is a manager's cash or index sleeve, not a view on an
    operating company. Seeded 2026-09-26 by measuring, over every 13F
    position filed for the closed quarter 2026-03-31 on build 20260817.1
    (`serving_filer_rows`), the issuer names filed under three or more distinct
    classes, ranked by holder count; the fund registrants among them (a
    trust or fund series, a commodity or crypto trust) down to ~550 holders
    were kept by name review, and operating companies with many classes
    (ALPHABET INC, JPMORGAN CHASE & CO …) were left out. Every entry matched
    that quarter. The owner reviews the list at the M4 row-level review (D5). A
    test fails on any entry that matches no issuer in the closed quarter, so
    stale entries cannot accumulate. */
export const FUND_WRAPPER_ISSUERS: readonly FundWrapperEntry[] = [
  { key: "ISHARES TR", name: "iShares Trust", why: "multi-series fund registrant" },
  { key: "VANGUARD INDEX FDS", name: "Vanguard Index Funds", why: "multi-series fund registrant" },
  { key: "SPDR SERIES TRUST", name: "SPDR Series Trust", why: "multi-series fund registrant" },
  { key: "STATE STR SPDR S&P 500 ETF T", name: "SPDR S&P 500 ETF Trust", why: "single-index ETF trust" },
  { key: "INVESCO QQQ TR", name: "Invesco QQQ Trust", why: "single-index ETF trust" },
  { key: "SCHWAB STRATEGIC TR", name: "Schwab Strategic Trust", why: "multi-series fund registrant" },
  { key: "SELECT SECTOR SPDR TR", name: "Select Sector SPDR Trust", why: "multi-series fund registrant" },
  { key: "ISHARES INC", name: "iShares, Inc.", why: "multi-series fund registrant" },
  { key: "INVESCO EXCHANGE TRADED FD T", name: "Invesco Exchange-Traded Fund Trust", why: "multi-series fund registrant" },
  { key: "VANGUARD INTL EQUITY INDEX F", name: "Vanguard International Equity Index Funds", why: "multi-series fund registrant" },
  { key: "SPDR GOLD TR", name: "SPDR Gold Trust", why: "commodity or crypto trust" },
  { key: "VANGUARD SCOTTSDALE FDS", name: "Vanguard Scottsdale Funds", why: "multi-series fund registrant" },
  { key: "VANGUARD WORLD FD", name: "Vanguard World Fund", why: "multi-series fund registrant" },
  { key: "VANECK ETF TRUST", name: "VanEck ETF Trust", why: "multi-series fund registrant" },
  { key: "J P MORGAN EXCHANGE TRADED F", name: "J.P. Morgan Exchange-Traded Fund Trust", why: "multi-series fund registrant" },
  { key: "VANGUARD TAX-MANAGED FDS", name: "Vanguard Tax-Managed Funds", why: "multi-series fund registrant" },
  { key: "INVESCO EXCH TRADED FD TR II", name: "Invesco Exchange-Traded Fund Trust II", why: "multi-series fund registrant" },
  { key: "VANGUARD BD INDEX FDS", name: "Vanguard Bond Index Funds", why: "multi-series fund registrant" },
  { key: "VANGUARD SPECIALIZED FUNDS", name: "Vanguard Specialized Funds", why: "multi-series fund registrant" },
  { key: "DIMENSIONAL ETF TRUST", name: "Dimensional ETF Trust", why: "multi-series fund registrant" },
  { key: "VANGUARD WHITEHALL FDS", name: "Vanguard Whitehall Funds", why: "multi-series fund registrant" },
  { key: "GLOBAL X FDS", name: "Global X Funds", why: "multi-series fund registrant" },
  { key: "WISDOMTREE TR", name: "WisdomTree Trust", why: "multi-series fund registrant" },
  { key: "FIRST TR EXCHANGE-TRADED FD", name: "First Trust Exchange-Traded Fund", why: "multi-series fund registrant" },
  { key: "SPDR INDEX SHS FDS", name: "SPDR Index Shares Funds", why: "multi-series fund registrant" },
  { key: "ISHARES GOLD TR", name: "iShares Gold Trust", why: "commodity or crypto trust" },
  { key: "AMERICAN CENTY ETF TR", name: "American Century ETF Trust", why: "multi-series fund registrant" },
  { key: "ISHARES BITCOIN TRUST ETF", name: "iShares Bitcoin Trust ETF", why: "commodity or crypto trust" },
  { key: "VANGUARD STAR FDS", name: "Vanguard STAR Funds", why: "multi-series fund registrant" },
  { key: "PIMCO ETF TR", name: "PIMCO ETF Trust", why: "multi-series fund registrant" },
  { key: "FIDELITY COVINGTON TRUST", name: "Fidelity Covington Trust", why: "multi-series fund registrant" },
  { key: "ISHARES SILVER TR", name: "iShares Silver Trust", why: "commodity or crypto trust" },
  { key: "PROSHARES TR", name: "ProShares Trust", why: "multi-series fund registrant" },
  { key: "VANGUARD MUN BD FDS", name: "Vanguard Municipal Bond Funds", why: "multi-series fund registrant" },
  { key: "FIRST TR EXCHANGE TRADED FD", name: "First Trust Exchange-Traded Fund", why: "multi-series fund registrant" },
  { key: "STATE STR SPDR S&P MIDCAP 40", name: "SPDR S&P MidCap 400 ETF Trust", why: "single-index ETF trust" },
  { key: "STATE STR SPDR DOW JONES IND", name: "SPDR Dow Jones Industrial Average ETF Trust", why: "single-index ETF trust" },
  { key: "GOLDMAN SACHS ETF TR", name: "Goldman Sachs ETF Trust", why: "commodity or crypto trust" },
  { key: "PACER FDS TR", name: "Pacer Funds Trust", why: "multi-series fund registrant" },
  { key: "VANGUARD ADMIRAL FDS INC", name: "Vanguard Admiral Funds", why: "multi-series fund registrant" },
  { key: "VANGUARD MALVERN FDS", name: "Vanguard Malvern Funds", why: "multi-series fund registrant" },
  { key: "VANGUARD CHARLOTTE FDS", name: "Vanguard Charlotte Funds", why: "multi-series fund registrant" },
  { key: "JANUS DETROIT STR TR", name: "Janus Detroit Street Trust", why: "multi-series fund registrant" },
  { key: "FIRST TR EXCHNG TRADED FD VI", name: "First Trust Exchange-Traded Fund VI", why: "multi-series fund registrant" },
  { key: "BLACKROCK ETF TRUST II", name: "BLACKROCK ETF TRUST II (EDGAR conformed name)", why: "multi-series fund registrant" },
  { key: "ALPS ETF TR", name: "ALPS ETF Trust", why: "multi-series fund registrant" },
  { key: "EA SERIES TRUST", name: "EA Series Trust", why: "multi-series fund registrant" },
  { key: "BLACKROCK ETF TRUST", name: "BLACKROCK ETF TRUST (EDGAR conformed name)", why: "multi-series fund registrant" },
  { key: "AMPLIFY ETF TR", name: "Amplify ETF Trust", why: "multi-series fund registrant" },
  { key: "FIRST TR EXCH TRADED FD III", name: "First Trust Exchange-Traded Fund III", why: "multi-series fund registrant" },
  { key: "INNOVATOR ETFS TRUST", name: "Innovator ETFs Trust", why: "multi-series fund registrant" },
  { key: "WORLD GOLD TR", name: "World Gold Trust", why: "commodity or crypto trust" },
  { key: "DBX ETF TR", name: "DBX ETF Trust", why: "multi-series fund registrant" },
  { key: "FIDELITY MERRIMACK STR TR", name: "Fidelity Merrimack Street Trust", why: "multi-series fund registrant" },
  { key: "INVESCO EXCH TRD SLF IDX FD", name: "Invesco Exchange-Traded Self-Indexed Fund Trust", why: "multi-series fund registrant" },
  { key: "ETF SER SOLUTIONS", name: "ETF Series Solutions", why: "multi-series fund registrant" },
  { key: "SSGA ACTIVE ETF TR", name: "SSgA Active ETF Trust", why: "multi-series fund registrant" },
  { key: "FRANKLIN TEMPLETON ETF TR", name: "Franklin Templeton ETF Trust", why: "multi-series fund registrant" },
  { key: "ARK ETF TR", name: "ARK ETF Trust", why: "multi-series fund registrant" },
  { key: "ISHARES U S ETF TR", name: "iShares U.S. ETF Trust", why: "multi-series fund registrant" },
  { key: "GRAYSCALE BITCOIN TRUST ETF", name: "Grayscale Bitcoin Trust ETF", why: "commodity or crypto trust" },
];

/** Entries that match no issuer name filed in the closed quarter — stale on
    this build. `issuerNames` is every issuer name the quarter's filings carry
    (any filer, not only notable ones), as filed. */
export function staleFundWrapperEntries(issuerNames: Iterable<string>, list: readonly FundWrapperEntry[] = FUND_WRAPPER_ISSUERS): FundWrapperEntry[] {
  const names = new Set<string>();
  for (const n of issuerNames) names.add(normalizedIssuerName(n));
  return list.filter((e) => !names.has(e.key));
}

/** The Institutional tab's "Top add" figure (signals-v4 LD9; it was the
    /institutional/ header's "Consensus add", R15, DESIGN-POLISH M2 review
    R2-3). The value is the name's reviewed TICKER, its sub the count of
    notable managers who opened it; a name no reviewed ticker maps has that
    count as its value — a figure, never "—", which on this ledger reads as
    "no top add" on a quarter that has one — and its filed name leads the
    sub. Only a quarter with no qualifying name shows "—". */
export function consensusAddLedgerItem(consensus: ConsensusRow | null, period: string | null, wrappersExcluded = 0): LedgerItem {
  /* R28: the figure is row 1 of the board, so it excludes the reviewed fund
     wrappers too, and its note says how many. */
  const wrappers = wrappersExcluded > 0
    ? ` ${fmtInt(wrappersExcluded)} fund-wrapper ${wrappersExcluded === 1 ? "registrant" : "registrants"} on the reviewed list ${wrappersExcluded === 1 ? "is" : "are"} excluded.`
    : "";
  if (!consensus) {
    return {
      label: "Top add",
      value: "—",
      /* the closed quarter is stated beside it (the provenance strip and the
         other figures' subs), so the absence fits two lines */
      detail: period ? "no name moved by ≥3 notable managers" : "no closed quarter yet",
      subKind: "absence",
      tone: "blue",
      ...(wrappers ? { noteHtml: `No issuer was opened by enough notable managers in the closed quarter ${esc(period ?? "")}.${wrappers}` } : {}),
    };
  }
  const n = consensus.newStakes;
  const managers = `${fmtInt(n)} ${n === 1 ? "manager" : "managers"}`;
  return {
    label: "Top add",
    value: consensus.ticker ?? managers,
    detail: consensus.ticker ? `${fmtInt(n)} notable ${n === 1 ? "manager" : "managers"} opened it` : `${consensus.issuer} · no reviewed ticker`,
    subKind: consensus.ticker ? "count" : "absence",
    tone: "blue",
    noteHtml:
      `${esc(consensus.ticker ? `${consensus.ticker} ${consensus.issuer}` : consensus.issuer)}: the issuer the most notable managers opened a new stake in during the closed quarter ${esc(period ?? "")}` +
      (consensus.ticker ? "" : `; no reviewed ticker maps it, so the figure is the number of notable managers who opened it`) +
      `. The first row of Consensus.${wrappers}`,
  };
}

/** R28: the board's two stated exclusions — the reviewed fund wrappers and
    the moves no issuer key groups. */
export function consensusExclusionText(board: Pick<ConsensusBoard, "wrappersExcluded" | "unkeyedMoves">): string {
  const w = board.wrappersExcluded;
  const u = board.unkeyedMoves;
  return (
    `${fmtInt(w)} fund-wrapper ${w === 1 ? "registrant" : "registrants"} on the reviewed list ${w === 1 ? "is" : "are"} excluded · ` +
    `${fmtInt(u)} ${u === 1 ? "move carries" : "moves carry"} no issuer identity and ${u === 1 ? "is" : "are"} outside this board.`
  );
}

/** The consensus board's count noun: its rows are the highest-ranked
    `limit` of the qualifying issuers, so when more qualify than it lists the
    count names that bound (review R-4). */
export function consensusBoundNoun(board: Pick<ConsensusBoard, "qualifying" | "rows">): { boundNoun: string; definite: boolean } {
  return board.qualifying > board.rows.length
    ? { boundNoun: "highest-ranked issuers", definite: true }
    : { boundNoun: "issuers", definite: false };
}

export interface ConsensusBoard {
  period: string;
  minFilers: number;
  rows: ConsensusRow[];
  qualifying: number;
  /** R28: issuer keys that would qualify but are on the reviewed fund-wrapper
      list — excluded from the board and from the "Top add" figure */
  wrappersExcluded: number;
  /** R28: moves that carry no issuer key and so cannot be grouped */
  unkeyedMoves: number;
}

/** Issuers ≥ `minFilers` DISTINCT notable filers moved in the quarter, ranked
    by new-stake count then net $. Built from the same moves as the band. */
export function consensusBoard(
  period: string,
  moves: readonly NotableMove[],
  opts: { minFilers?: number; limit?: number; wrappers?: readonly FundWrapperEntry[] } = {},
): ConsensusBoard {
  const issuerKeyOf = (m: NotableMove): string | null => m.ikey;
  const minFilers = opts.minFilers ?? 3;
  const limit = opts.limit ?? 50;
  const wrapperKeys = new Set((opts.wrappers ?? FUND_WRAPPER_ISSUERS).map((e) => e.key));
  let unkeyedMoves = 0;
  let wrappersExcluded = 0;
  interface Acc { names: string[]; tickers: Map<string, number>; byKind: Record<MoveKind, Set<string>>; filers: Set<string>; net: number; any: boolean; partial: boolean; top: NotableMove | null }
  const groups = new Map<string, Acc>();
  for (const m of moves) {
    const key = issuerKeyOf(m);
    if (!key) {
      unkeyedMoves++;
      continue;
    }
    let g = groups.get(key);
    if (!g) {
      g = { names: [], tickers: new Map(), byKind: { new: new Set(), add: new Set(), trim: new Set(), exit: new Set() }, filers: new Set(), net: 0, any: false, partial: false, top: null };
      groups.set(key, g);
    }
    g.names.push(m.issuer);
    if (m.ticker) g.tickers.set(m.ticker, (g.tickers.get(m.ticker) ?? 0) + 1);
    g.byKind[m.kind].add(m.cik);
    g.filers.add(m.cik);
    if (m.delta_value == null) g.partial = true;
    else { g.net += m.delta_value; g.any = true; }
    if (g.top === null || Math.abs(m.delta_value ?? -1) > Math.abs(g.top.delta_value ?? -1)) g.top = m;
  }
  const rows: ConsensusRow[] = [];
  for (const [key, g] of groups) {
    if (g.filers.size < minFilers) continue;
    /* R28: a group ANY of whose filed names is a reviewed fund wrapper is
       excluded and counted — never silently dropped. */
    if (g.names.some((n) => wrapperKeys.has(normalizedIssuerName(n)))) {
      wrappersExcluded++;
      continue;
    }
    const ticker = [...g.tickers.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0]?.[0] ?? null;
    rows.push({
      issuerKey: key,
      issuer: displayIssuerName(g.names) ?? key,
      ticker,
      newStakes: g.byKind.new.size,
      adds: g.byKind.add.size,
      trims: g.byKind.trim.size,
      exits: g.byKind.exit.size,
      filers: g.filers.size,
      netDeltaUsd: g.any ? g.net : null,
      netDeltaPartial: g.partial,
      topMover: g.top ? { manager: g.top.manager, kind: g.top.kind, cik: g.top.cik } : null,
    });
  }
  rows.sort((a, b) =>
    b.newStakes - a.newStakes ||
    ((b.netDeltaUsd ?? Number.NEGATIVE_INFINITY) - (a.netDeltaUsd ?? Number.NEGATIVE_INFINITY)) ||
    (a.issuerKey < b.issuerKey ? -1 : 1),
  );
  disambiguateConsensusLabels(rows);
  return { period, minFilers, rows: rows.slice(0, limit), qualifying: rows.length, wrappersExcluded, unkeyedMoves };
}

/** The label a consensus row reads as — ticker, filed name and, when needed,
    the disambiguating ordinal. No two rows of one board share it (R28). */
export function consensusRowLabel(r: Pick<ConsensusRow, "ticker" | "issuer" | "disambiguator">): string {
  return `${r.ticker ? `${r.ticker} ` : ""}${r.issuer}${r.disambiguator ? ` ${r.disambiguator}` : ""}`;
}

/** R28: when two issuer keys resolve to one display name, each is told apart
    by its ticker, or — when no ticker separates them — by its stable issuer
    key's ordinal among the keys sharing the name, in codepoint order. Runs over
    EVERY qualifying row, so the ordinal does not depend on the board's cut. */
function disambiguateConsensusLabels(rows: ConsensusRow[]): void {
  const byName = new Map<string, ConsensusRow[]>();
  for (const r of rows) {
    const k = normalizedIssuerName(r.issuer);
    byName.set(k, [...(byName.get(k) ?? []), r]);
  }
  for (const same of byName.values()) {
    if (same.length < 2) continue;
    const ordered = [...same].sort((a, b) => (a.issuerKey < b.issuerKey ? -1 : a.issuerKey > b.issuerKey ? 1 : 0));
    const tickerCount = new Map<string, number>();
    for (const r of same) if (r.ticker) tickerCount.set(r.ticker, (tickerCount.get(r.ticker) ?? 0) + 1);
    for (const r of same) {
      const tickerTells = r.ticker !== null && tickerCount.get(r.ticker) === 1;
      r.disambiguator = tickerTells ? null : `#${ordered.indexOf(r) + 1}`;
    }
  }
}

/* ---------- signals-v4 M2 (R11, R12, LD11, LD13): the Named moves model ---------- */

/** Moves the DOM carries per filter slice (LD11). */
export const NAMED_MOVES_SLICE_ROWS = 30;
/** LD11's locked fallback: the per-slice bound when 30 would carry the page
    past `SIGNALS_PAGE_BYTES` (the page applies it, `pages/signals`). */
export const NAMED_MOVES_FALLBACK_ROWS = 20;
/** LD11: the Signals page's byte budget, 2 MiB (a post-build test holds it).
    Raised from 1.5 MiB on 2026-10-19, owner decision: on production data the
    page at both fallbacks measured 1,665,958 B, over 1.5 MiB, because the M3
    size model had under-predicted production (signals-v4.md, Reversed
    decisions, with each bound's measured bytes). */
export const SIGNALS_PAGE_BYTES = 2_097_152;
/** What the page's layout adds around the rendered body (head, masthead,
    footer, script and style links): the body must leave this much of the
    budget. Measured on the build and recorded in signals-v4.md. */
export const SIGNALS_PAGE_CHROME_BYTES = 65_536;
/** The Named moves' visible floor: the server shows this many, and the
    column fit never shows fewer (LD6). */
export const NAMED_MOVES_MIN = 15;
/** "Show 15 more". */
export const NAMED_MOVES_STEP = 15;

/** The kind chips, in their order (New, Exits, Adds, Trims). */
export const NAMED_MOVE_KINDS: readonly MoveKind[] = ["new", "exit", "add", "trim"];
/** The manager-type chips (LD11). Other types are reached through "any". */
export const NAMED_MOVE_TYPES: readonly ManagerType[] = ["hedge_fund", "family_office", "asset_manager", "insurer", "alt_manager"];

/** One filter slice's key in `data-mv-totals`: "{kind|any}|{type|any}". */
export function namedMovesSliceKey(kind: string | null, type: string | null): string {
  return `${kind ?? "any"}|${type ?? "any"}`;
}

/** The ONE slice predicate the server's totals and DOM set and the client's
    chips share. */
export function namedMoveMatches(m: Pick<NotableMove, "kind" | "type">, kind: string | null, type: string | null): boolean {
  return (kind === null || m.kind === kind) && (type === null || m.type === type);
}

/** Every slice: kind ∈ {any, …kinds} × type ∈ {any, …types}. */
export function namedMovesSlices(): { kind: MoveKind | null; type: ManagerType | null }[] {
  const out: { kind: MoveKind | null; type: ManagerType | null }[] = [];
  for (const kind of [null, ...NAMED_MOVE_KINDS]) for (const type of [null, ...NAMED_MOVE_TYPES]) out.push({ kind, type });
  return out;
}

/** The 30 slice totals over the FULL population — the counts the page states
    when a filter cuts the list (LD11). */
export function namedMovesSliceTotals(moves: readonly NotableMove[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const { kind, type } of namedMovesSlices()) out[namedMovesSliceKey(kind, type)] = 0;
  for (const m of moves) {
    for (const kind of [null, m.kind]) {
      for (const type of [null, m.type]) {
        const k = namedMovesSliceKey(kind, type);
        if (k in out) out[k]!++;
      }
    }
  }
  return out;
}

/** The identity a name filter groups by: the producer's issuer key, or — for
    a move no issuer key groups — its own position key, so a lead card on an
    unkeyed name still filters to every move on that security. */
export function moveNameKey(m: Pick<NotableMove, "ikey" | "key">): string {
  return m.ikey ?? `pos:${m.key}`;
}

/** LD11: the moves the page carries, in population order — for each slice
    its first `sliceRows`, plus every move on a named key (the listed
    Consensus rows and the lead cards), so a name filter lists every move on
    its key. */
export function namedMovesDomSet(moves: readonly NotableMove[], nameKeys: ReadonlySet<string>, sliceRows = NAMED_MOVES_SLICE_ROWS): NotableMove[] {
  const keep = new Set<number>();
  for (const { kind, type } of namedMovesSlices()) {
    let n = 0;
    for (let i = 0; i < moves.length && n < sliceRows; i++) {
      if (namedMoveMatches(moves[i]!, kind, type)) {
        keep.add(i);
        n++;
      }
    }
  }
  moves.forEach((m, i) => {
    if (nameKeys.has(moveNameKey(m))) keep.add(i);
  });
  return moves.filter((_, i) => keep.has(i));
}

/** LD13: the Institutional lead cards' picks. */
export interface InstLeadCards {
  /** the Consensus board's first row */
  consensus: ConsensusRow | null;
  /** the new stake with the largest Δ $ (ties: population order, `cmpMoves`) */
  newStake: NotableMove | null;
  /** the exit with the most negative Δ $ (ties: population order) */
  exit: NotableMove | null;
}

export function instLeadCards(board: Pick<ConsensusBoard, "rows"> | null, moves: readonly NotableMove[]): InstLeadCards {
  let newStake: NotableMove | null = null;
  let exit: NotableMove | null = null;
  for (const m of moves) {
    if (m.delta_value == null) continue;
    if (m.kind === "new" && (newStake === null || m.delta_value > newStake.delta_value!)) newStake = m;
    if (m.kind === "exit" && (exit === null || m.delta_value < exit.delta_value!)) exit = m;
  }
  return { consensus: board?.rows[0] ?? null, newStake, exit };
}
