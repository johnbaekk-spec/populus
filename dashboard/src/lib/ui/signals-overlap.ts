/* ui/signals-overlap.ts — the Overlap tab of /signals/ (signals-v4 M3: R18,
   R24, R25, LD8, LD9, LD14). One of the ui/ domain modules: consumers import
   from ./index.ts only.

   Overlap lists the names that members of Congress traded (by trade date,
   inside the 13F quarter) and that notable managers changed (by quarter end)
   in the same quarter. It reads the ONE Congress-quarter join
   (`congress-quarter.ts`, LD10) and the Institutional tab's in-build moves:
   no second join. It is a co-occurrence in public filings — never
   coordination, never intent — and every row says each side's own direction:

   - Congress: cb / cs distinct members with a purchase / a sale line on the
     ticker; broad accounts (more than `BROAD_ACCOUNT_NAMES` names in the
     quarter) are counted only in the "Broad accounts" variant.
   - Managers: gb / gs distinct notable managers (CIKs) with a new stake or an
     add / a trim or an exit on it.
   - Direction: buy when the purchase side is larger, sell when the sale side
     is, mixed on a tie; the relation is mixed when either side is, same when
     the two directions agree, else opposite. Unanimous: neither side split.
   - Order: same › opposite › mixed, unanimous first, then the larger side's
     members plus the larger side's managers, then the ticker.

   Each name renders ONCE (`article.ov-item`), carrying both variants'
   relation and counts (the inactive one `hidden`); the opened row lists the
   counted members' lines through the one `congressLineHtml` (range, both
   dates, owner, receipt), the broad accounts' lines apart, and the managers'
   changes with their 13F receipts. The page carries, per variant, the first
   `sliceRows` names of each view (all, same, opposite); the counts are the
   true totals and the bound is stated where a view runs out first (LD11's
   grammar). Pure; build memory only (R23). */

import { type RenderCtx, esc, fmtInt, kindWordHtml, note, noteFromHtml, normalizeTicker13f, partyClass, rangeOfTotal, slug, tickerHrefFor } from "../format.ts";
import { affTextOf } from "../derive.ts";
import { BROAD_ACCOUNT_NAMES, CONGRESS_DETAIL_LINES, quarterLabel, quarterMembers, type BroadMember, type CongressQuarter, type MemberLines } from "../congress-quarter.ts";
import type { NotableMove } from "../notable-moves.ts";
import { signedUsd } from "../notable-moves.ts";
import { congressLineHtml, heldIslandHtml, memberLastName, type HeldCut } from "./signals.ts";
import { playbookStripHtml } from "./signals-playbooks.ts";
import type { LedgerItem } from "./shared.ts";
import { disclosureLedger } from "./shared.ts";

/** Rows a view shows before "Show 12 more", and its step (LD14). */
export const OVERLAP_STEP = 12;
/** The names the page carries per view (LD14's DOM bound, after LD11): the
    first this-many of each variant's all, same and opposite views. */
export const OVERLAP_SLICE_ROWS = 24;
/** The locked fallback, when the page would exceed its byte budget. */
export const OVERLAP_FALLBACK_ROWS = 12;
/** The managers an opened row lists a side (each with its change's 13F
    receipt); the rest are counted and one filer page away. */
export const OVERLAP_DETAIL_MANAGERS = 5;
/** The names a collapsed row's second line names before "+n". */
const SUMMARY_NAMES = 3;

export type OverlapVariant = "core" | "all";
export type OverlapDir = "buy" | "sell" | "mixed";
export type OverlapRel = "same" | "opposite" | "mixed";
const REL_ORDER: Readonly<Record<OverlapRel, number>> = { same: 0, opposite: 1, mixed: 2 };

/** One name in one variant. */
export interface OverlapRow {
  /** SEC-spelled (`normalizeTicker13f`) */
  ticker: string;
  /** the issuer as filed on its largest change (`cmpChangeSize`) */
  issuer: string;
  /** the counted members, newest trade first */
  buy: MemberLines[];
  sell: MemberLines[];
  /** the managers' changes on the name, in population order (the detail
      and the summary pick each manager's largest, `largestPerManager`) */
  mBuy: NotableMove[];
  mSell: NotableMove[];
  cb: number;
  cs: number;
  gb: number;
  gs: number;
  cdir: OverlapDir;
  gdir: OverlapDir;
  rel: OverlapRel;
  unanimous: boolean;
  score: number;
}

export interface Overlap {
  /** the quarter end, or null when there is no closed calendar quarter */
  period: string | null;
  start: string | null;
  end: string | null;
  /** why there are no rows to read, when there are none for a structural reason */
  absent: string | null;
  /** broad accounts excluded (`core`) and included (`all`), each in order */
  core: OverlapRow[];
  all: OverlapRow[];
  broad: readonly BroadMember[];
  /** the per-view bound the page carries */
  sliceRows: number;
}

/** The order of a name's changes by size (LD14's "largest change", D3): the
    larger absolute Δ $ first, a change that disclosed no value last; ties by
    the larger absolute Δ shares, then by position key — deterministic, and
    independent of the population's kind-first order. */
export function cmpChangeSize(a: NotableMove, b: NotableMove): number {
  const av = a.delta_value == null ? null : Math.abs(a.delta_value);
  const bv = b.delta_value == null ? null : Math.abs(b.delta_value);
  if (av !== bv) {
    if (av === null) return 1;
    if (bv === null) return -1;
    return bv - av;
  }
  const as = a.delta_shares == null ? -1 : Math.abs(a.delta_shares);
  const bs = b.delta_shares == null ? -1 : Math.abs(b.delta_shares);
  if (as !== bs) return bs - as;
  return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
}

/** One change a manager — its largest by `cmpChangeSize` — the managers in
    the order of those changes. The detail's and the summary's one pick (the
    counts are of managers, so a manager is listed once). */
export function largestPerManager(moves: readonly NotableMove[]): NotableMove[] {
  const best = new Map<string, NotableMove>();
  for (const m of moves) {
    const cur = best.get(m.cik);
    if (!cur || cmpChangeSize(m, cur) < 0) best.set(m.cik, m);
  }
  return [...best.values()].sort(cmpChangeSize);
}

function dirOf(b: number, s: number): OverlapDir {
  return b > s ? "buy" : s > b ? "sell" : "mixed";
}

export function cmpOverlap(a: Pick<OverlapRow, "rel" | "unanimous" | "score" | "ticker">, b: Pick<OverlapRow, "rel" | "unanimous" | "score" | "ticker">): number {
  if (a.rel !== b.rel) return REL_ORDER[a.rel] - REL_ORDER[b.rel];
  if (a.unanimous !== b.unanimous) return a.unanimous ? -1 : 1;
  if (a.score !== b.score) return b.score - a.score;
  return a.ticker < b.ticker ? -1 : a.ticker > b.ticker ? 1 : 0;
}

/** LD14 over one variant. */
function variantRows(q: CongressQuarter, byTicker: Map<string, NotableMove[]>, includeBroad: boolean): OverlapRow[] {
  const rows: OverlapRow[] = [];
  for (const [ticker, moves] of byTicker) {
    if (!q.byTicker.has(ticker)) continue;
    const buy = quarterMembers(q, ticker, "buy", { includeBroad });
    const sell = quarterMembers(q, ticker, "sell", { includeBroad });
    if (buy.length + sell.length === 0) continue;
    const mBuy = moves.filter((m) => m.kind === "new" || m.kind === "add");
    const mSell = moves.filter((m) => m.kind === "trim" || m.kind === "exit");
    const gb = new Set(mBuy.map((m) => m.cik)).size;
    const gs = new Set(mSell.map((m) => m.cik)).size;
    const cdir = dirOf(buy.length, sell.length);
    const gdir = dirOf(gb, gs);
    const rel: OverlapRel = cdir === "mixed" || gdir === "mixed" ? "mixed" : cdir === gdir ? "same" : "opposite";
    rows.push({
      ticker, issuer: [...moves].sort(cmpChangeSize)[0]!.issuer, buy, sell, mBuy, mSell, cb: buy.length, cs: sell.length, gb, gs, cdir, gdir, rel,
      unanimous: (buy.length === 0 || sell.length === 0) && (gb === 0 || gs === 0),
      score: Math.max(buy.length, sell.length) + Math.max(gb, gs),
    });
  }
  return rows.sort(cmpOverlap);
}

/** LD1 / LD14: both variants from the quarter join and the in-build moves.
    `quarter` null (no calendar quarter) or no moves give no rows, with the
    reason stated. */
export function buildOverlap(quarter: CongressQuarter | null, moves: readonly NotableMove[], opts: { sliceRows?: number; absent?: string | null } = {}): Overlap {
  const sliceRows = opts.sliceRows ?? OVERLAP_SLICE_ROWS;
  if (!quarter) {
    return { period: null, start: null, end: null, absent: opts.absent ?? "no closed calendar quarter to join", core: [], all: [], broad: [], sliceRows };
  }
  const byTicker = new Map<string, NotableMove[]>();
  for (const m of moves) {
    if (!m.ticker) continue;
    const t = normalizeTicker13f(m.ticker);
    let l = byTicker.get(t);
    if (!l) byTicker.set(t, (l = []));
    l.push(m);
  }
  return {
    period: quarter.period, start: quarter.start, end: quarter.end, absent: opts.absent ?? null,
    core: variantRows(quarter, byTicker, false),
    all: variantRows(quarter, byTicker, true),
    broad: quarter.broad,
    sliceRows,
  };
}

/** The relation counts of one variant. */
export function overlapCounts(rows: readonly OverlapRow[]): { same: number; opposite: number; mixed: number; all: number } {
  const n = { same: 0, opposite: 0, mixed: 0, all: rows.length };
  for (const r of rows) n[r.rel]++;
  return n;
}

/** The names the page carries (LD14's DOM bound): per variant, the first
    `sliceRows` of its all, same and opposite views — each view a contiguous
    run of the variant's order, so the client can tell where one runs out. */
export function overlapCarried(o: Pick<Overlap, "core" | "all" | "sliceRows">): Set<string> {
  const out = new Set<string>();
  for (const rows of [o.core, o.all]) {
    for (const rel of [null, "same", "opposite"] as const) {
      const view = rel === null ? rows : rows.filter((r) => r.rel === rel);
      for (const r of view.slice(0, o.sliceRows)) out.add(r.ticker);
    }
  }
  return out;
}

/** A row's anchor (LD8 `#ov-{ticker}`). */
export function overlapRowId(ticker: string): string {
  return `ov-${slug(normalizeTicker13f(ticker))}`;
}

/* ---------------------------------------------------------------- labels */

const REL_LABEL = (r: Pick<OverlapRow, "rel" | "cdir">): { text: string; cls: string } =>
  r.rel === "same" ? (r.cdir === "buy" ? { text: "SAME · BUY SIDE", cls: "ov-rel-buy" } : { text: "SAME · SELL SIDE", cls: "ov-rel-sell" }) : r.rel === "opposite" ? { text: "OPPOSITE", cls: "ov-rel-opp" } : { text: "MIXED", cls: "ov-rel-mix" };

function plural(n: number, one: string, many: string): string {
  return `${fmtInt(n)} ${n === 1 ? one : many}`;
}

/** One variant's summary cells: the relation, the members, the counts. */
function variantCells(r: OverlapRow): { rel: string; who: string; cg: string } {
  const rl = REL_LABEL(r);
  const seen = new Set<string>();
  const members = [...r.buy, ...r.sell].filter((m) => (seen.has(m.key) ? false : (seen.add(m.key), true)));
  const who =
    members
      .slice(0, SUMMARY_NAMES)
      .map((m) => `${esc(memberLastName(m.name))} <span class="aff ${partyClass(m.party)}">${esc(affTextOf(m))}</span>`)
      .join(", ") + (members.length > SUMMARY_NAMES ? ` +${fmtInt(members.length - SUMMARY_NAMES)}` : "");
  return {
    rel: `<span class="ov-rel ${rl.cls}">${esc(rl.text)}</span>`,
    who,
    cg:
      `<span aria-hidden="true"><span class="c-buy">▲${fmtInt(r.cb)}</span> · <span class="c-sell">▼${fmtInt(r.cs)}</span></span>` +
      `<span class="visually-hidden">Congress: ${plural(r.cb, "member", "members")} with a purchase, ${fmtInt(r.cs)} with a sale</span>`,
  };
}

/** A cell that differs between the variants renders both, the broad-inclusive
    one `hidden`; a cell they share renders once. */
function both(cls: string, core: string | null, all: string): string {
  if (core === all) return `<span class="${cls}">${all}</span>`;
  return (
    (core === null ? "" : `<span class="${cls}" data-v="core">${core}</span>`) +
    `<span class="${cls}" data-v="all"${core === null ? "" : " hidden"}>${all}</span>`
  );
}

/** A manager's change on the name: manager, kind, Δ $, filed date, 13F receipt. */
function managerLineHtml(m: NotableMove): string {
  const dir = m.delta_value == null ? "c-muted" : m.delta_value < 0 ? "c-sell" : "c-buy";
  return (
    `<li class="ov-mline">` +
    `<span class="ov-m">${esc(m.manager)}</span>` +
    `${kindWordHtml(m.kind)}` +
    `<span class="mv-dv ${dir}">${esc(signedUsd(m.delta_value))}</span>` +
    `<span class="mv-fil">filed ${m.filed ? `<time datetime="${esc(m.filed)}">${esc(m.filed)}</time>` : "date not stated"}</span>` +
    (m.doc ? `<a class="mv-src" href="${esc(m.doc)}" rel="noopener" target="_blank">13F ↗</a>` : `<span class="mv-src c-muted">13F —</span>`) +
    `</li>`
  );
}

/** The opened row (LD14): both sides' lines. Each member's newest Congress
    line — the counted members first, then the broad accounts' (counted only
    with Broad accounts on) — at most `CONGRESS_DETAIL_LINES` a side, every
    further line on the ticker page; then each manager's largest change on
    the name with its receipt, at most `OVERLAP_DETAIL_MANAGERS` a side. */
function overlapDetailHtml(core: OverlapRow | null, all: OverlapRow, q: Pick<Overlap, "period" | "start" | "end">, ctx: RenderCtx): string {
  const counted = new Set([...(core?.buy ?? []), ...(core?.sell ?? [])].map((m) => `${m.key}`));
  const href = tickerHrefFor(all.ticker, ctx);
  const side = (members: MemberLines[], label: string): string => {
    const kept = members.filter((m) => counted.has(m.key));
    const broad = members.filter((m) => !counted.has(m.key));
    const total = members.reduce((n, m) => n + lineCount(m), 0);
    if (total === 0) return "";
    /* one line a member, its newest: the count is of members */
    const shown = [...kept, ...broad].slice(0, CONGRESS_DETAIL_LINES).map((m) => m.rows[0]!);
    const keptShown = shown.slice(0, Math.min(kept.length, CONGRESS_DETAIL_LINES));
    const broadShown = shown.slice(keptShown.length);
    const more = total - shown.length;
    return (
      `<p class="ov-det-k">${esc(label)}</p>` +
      (keptShown.length ? `<ul class="cl-list">${keptShown.map((t) => congressLineHtml(t, ctx)).join("")}</ul>` : "") +
      (broad.length
        ? `<p class="mv-cong-none">Broad accounts — more than ${fmtInt(BROAD_ACCOUNT_NAMES)} names in the quarter, counted only with Broad accounts on: ` +
          `${esc(broad.map((m) => `${m.name} (${fmtInt(m.breadth)} names)`).join(", "))}.</p>` +
          (broadShown.length ? `<ul class="cl-list">${broadShown.map((t) => congressLineHtml(t, ctx)).join("")}</ul>` : "")
        : "") +
      (more > 0 ? `<p class="mv-cong-more"><a href="${esc(href)}">${plural(more, "more line", "more lines")} on the ticker page ↗</a></p>` : "")
    );
  };
  const managers = (moves: NotableMove[], label: string): string => {
    if (moves.length === 0) return "";
    /* one change a manager, its largest (never the population's first, which
       orders by kind before size): the count is of managers */
    const shown = largestPerManager(moves).slice(0, OVERLAP_DETAIL_MANAGERS);
    const more = moves.length - shown.length;
    return (
      `<p class="ov-det-k">${esc(label)}</p>` +
      `<ul class="ov-mlist">${shown.map(managerLineHtml).join("")}</ul>` +
      (more > 0 ? `<p class="mv-cong-more">${plural(more, "more change", "more changes")} on this name; each manager's filer page lists its own.</p>` : "")
    );
  };
  const quarter = quarterLabel(q.period) ?? q.period ?? "the quarter";
  return (
    `<div class="ov-det">` +
    `<div class="ov-side"><p class="ov-det-h">Congress · traded in ${esc(quarter)} (${esc(q.start ?? "—")} → ${esc(q.end ?? "—")})</p>` +
    side(all.buy, "Purchases") +
    side(all.sell, "Sales") +
    `</div>` +
    `<div class="ov-side"><p class="ov-det-h">Notable managers · quarter ended ${esc(q.period ?? "—")}</p>` +
    managers(all.mBuy, "New stakes and adds") +
    managers(all.mSell, "Trims and exits") +
    `</div>` +
    `</div>`
  );
}

/** A member's lines as the island carries them (launch M7a, D5): the newest
    line — the one the opened row lists — and the count of all of them, which
    is every input the row reads. */
type HeldMemberLines = MemberLines & { lineCount?: number };
function lineCount(m: MemberLines): number {
  return (m as HeldMemberLines).lineCount ?? m.rows.length;
}
function slimRow(r: OverlapRow): OverlapRow {
  const slim = (ms: MemberLines[]): HeldMemberLines[] => ms.map((m) => ({ ...m, rows: m.rows.slice(0, 1), lineCount: m.rows.length }));
  return { ...r, buy: slim(r.buy), sell: slim(r.sell) };
}
/** One held name (launch M7a, D5): its two variants' rows as data, its
    ordinals, and its anchor — `overlapItemHtml`'s inputs. */
export interface HeldOverlapItem {
  id: string;
  core: OverlapRow | null;
  all: OverlapRow;
  ord: { core: number | null; all: number };
}
/** The Overlap's island: the carried names past the first view. */
export interface HeldOverlap {
  q: Pick<Overlap, "period" | "start" | "end">;
  items: HeldOverlapItem[];
  cut: HeldCut;
}

/** One name (both variants): an `article.ov-item` holding a `<details>`. */
export function overlapItemHtml(core: OverlapRow | null, all: OverlapRow, ord: { core: number | null; all: number }, q: Pick<Overlap, "period" | "start" | "end">, ctx: RenderCtx, shown: boolean): string {
  const c = core ? variantCells(core) : null;
  const a = variantCells(all);
  /* the managers by their largest change, the buy side's first; a manager on
     both sides is named once, on its buy side */
  const buyers = largestPerManager(all.mBuy);
  const seenCik = new Set(buyers.map((m) => m.cik));
  const named = [...buyers, ...largestPerManager(all.mSell).filter((m) => !seenCik.has(m.cik))];
  const managers =
    named
      .slice(0, SUMMARY_NAMES)
      .map((m) => `${esc(m.manager)} ${kindWordHtml(m.kind)}`)
      .join(" · ") + (named.length > SUMMARY_NAMES ? ` +${fmtInt(named.length - SUMMARY_NAMES)}` : "");
  const mg =
    `<span aria-hidden="true"><span class="c-buy">▲${fmtInt(all.gb)}</span> · <span class="c-sell">▼${fmtInt(all.gs)}</span></span>` +
    `<span class="visually-hidden">Managers: ${plural(all.gb, "manager", "managers")} opened or added, ${fmtInt(all.gs)} trimmed or exited</span>`;
  const summary =
    `<summary class="ov-sum">` +
    `<span class="ov-tk mono-ticker">${esc(all.ticker)}</span>` +
    both("ov-rl", c?.rel ?? null, a.rel) +
    `<span class="ov-iss"><span class="filed-name">${esc(all.issuer)}</span></span>` +
    both("ov-who", c?.who ?? null, a.who) +
    both("ov-cg", c?.cg ?? null, a.cg) +
    `<span class="ov-mg">${mg}</span>` +
    `<span class="ov-mw">${managers}</span>` +
    `<span class="si-row-chv" aria-hidden="true"></span>` +
    `</summary>`;
  return (
    `<article class="ov-item" id="${esc(overlapRowId(all.ticker))}" data-core="${core?.rel ?? ""}" data-all="${all.rel}" data-oc="${ord.core ?? ""}" data-oa="${ord.all}"${shown ? "" : " hidden"}>` +
    `<details class="ov-row" name="ov-rows">${summary}${overlapDetailHtml(core, all, q, ctx)}</details>` +
    `</article>`
  );
}

/** LD11's grammar for the Overlap's own bound. */
export function overlapBoundText(n: number): string {
  /* copy item signals-12 */
  return `This page carries the first ${fmtInt(n)} names — ticker and filer pages have the rest.`;
}

export function overlapRangeText(shown: number, total: number): string {
  return rangeOfTotal(1, shown, total, "names");
}

/** The co-occurrence statement every Overlap surface carries (LD14). */
export function overlapTipText(o: Pick<Overlap, "start" | "end">): string {
  return (
    `Names members of Congress traded and notable managers changed in the same quarter. Congress by trade date${o.start && o.end ? ` (${o.start} → ${o.end})` : " inside the 13F quarter"}; 13F by quarter end. ` +
    `Direction is each side's net. A co-occurrence in public filings — never coordination, never intent.`
  );
}

/** LD9: the Overlap tab's three figures — Same side, Opposite, Quarter. */
export function overlapLedgerItems(o: Overlap | null): LedgerItem[] {
  if (o === null || o.period === null) {
    const why = o === null ? "not computed in this view" : (o.absent ?? "no closed quarter");
    return [
      { label: "Same side", value: "—", detail: why, subKind: "absence", tone: "green" },
      { label: "Opposite", value: "—", detail: why, subKind: "absence", tone: "gold" },
      { label: "Quarter", value: "—", detail: why, subKind: "absence" },
    ];
  }
  const n = overlapCounts(o.core);
  return [
    { label: "Same side", value: fmtInt(n.same), detail: "names", subKind: "count", tone: "green" },
    { label: "Opposite", value: fmtInt(n.opposite), detail: "names", subKind: "count", tone: "gold" },
    { label: "Quarter", value: quarterLabel(o.period) ?? o.period, detail: "by trade date", subKind: "date" },
  ];
}

export function overlapLedgerHtml(o: Overlap | null): string {
  return disclosureLedger(overlapLedgerItems(o), { scope: "signals-ov-ledger" });
}

/** The Overlap tabpanel's content (the panel element is `signalsBody`'s).
    `null` is the artifact-only view. `playbooks` adds the head's playbook
    strip — only where the page renders the Playbooks tab it links to. */
/** `keep`: the names another tab's visible rows link (a move's "See {TICKER}
    in Overlap →"); they stay in the page, held, so the link works without
    script (launch M7a). */
export function signalsOverlapHtml(o: Overlap | null, ctx: RenderCtx, opts: { playbooks?: boolean; keep?: ReadonlySet<string> } = {}): string {
  const tip = noteFromHtml(
    `<span class="si-tip-p">${esc(overlapTipText(o ?? { start: null, end: null }))}</span>` +
      `<span class="si-tip-p">The managers' side is 13F: quarter-end, long-only snapshots filed up to 45 days after the quarter — never current holdings; an exit is inferred from absence in the next filing.</span>` +
      `<span class="si-tip-p">Same and opposite read the two sides' directions; mixed is a tie on either side. Unanimous names — neither side split — come first, then the names with the most members and managers. ` +
      `Tickers compare in the SEC spelling, so BRK.B meets BRK-B. <a href="/methodology/#signals-overlap">How Overlap is read ↗</a></span>`,
    { scope: "signals-overlap" },
    "about",
    { trigger: "mark", name: "About overlap" },
  );
  const head = `<div class="panel-head"><h2 class="section-h" id="overlap-h">Overlap</h2>${tip}${opts.playbooks ? playbookStripHtml("overlap") : ""}</div>`;
  const open = (empty: boolean): string => `<section class="panel sig-ov" id="ov-section" aria-labelledby="overlap-h"${empty ? " data-empty-state" : ""}>`;
  if (o === null) {
    return open(true) + head + `<p class="section-note">Overlap is computed on the server from the build's Congress rows and 13F changes; this view carries the Congress artifact only.</p></section>`;
  }
  if (o.period === null) {
    return open(true) + head + `<p class="section-note">No Overlap: ${esc(o.absent ?? "no closed calendar quarter to join")}. Absence is stated, never simulated.</p></section>`;
  }
  const quarter = quarterLabel(o.period) ?? o.period;
  /* copy item signals-15, adapted (wording-ban: "move" as a verb): the tab's one visible not-coordination line */
  const lede = `<p class="section-note ov-lede">Names Congress traded and notable managers changed in ${esc(quarter)} — co-occurrence, not coordination or intent.</p>`;
  if (o.all.length === 0) {
    return (
      open(true) + head + lede +
      `<p class="section-note">No name in ${esc(quarter)} has both a member of Congress's listed-stock line and a notable manager's change` +
      (o.absent ? `: ${esc(o.absent)}` : "") +
      `. Zero is the computed answer.</p></section>`
    );
  }
  const nc = overlapCounts(o.core);
  const na = overlapCounts(o.all);
  const carried = overlapCarried(o);
  const coreBy = new Map(o.core.map((r, i) => [r.ticker, { r, i }]));
  const allIdx = new Map(o.all.map((r, i) => [r.ticker, i]));
  /* the carried names in the default view's order (core, then the names only
     the broad-inclusive variant has, in its order); the first OVERLAP_STEP of
     the core view show */
  const items = o.all
    .filter((r) => carried.has(r.ticker))
    .sort((x, y) => {
      const cx = coreBy.get(x.ticker)?.i ?? Infinity;
      const cy = coreBy.get(y.ticker)?.i ?? Infinity;
      return cx !== cy ? cx - cy : allIdx.get(x.ticker)! - allIdx.get(y.ticker)!;
    });
  /* launch M7a (D5, LD27): the first view's names are in the page; every
     other carried name ships in the island as data and renders through
     `overlapItemHtml` when a view needs it */
  const firstView = (r: OverlapRow): boolean => (coreBy.get(r.ticker)?.i ?? Infinity) < OVERLAP_STEP;
  const inPage = (r: OverlapRow): boolean => firstView(r) || (opts.keep?.has(overlapRowId(r.ticker)) ?? false);
  const rows = items
    .filter(inPage)
    .map((r) => {
      const c = coreBy.get(r.ticker) ?? null;
      return overlapItemHtml(c?.r ?? null, r, { core: c?.i ?? null, all: allIdx.get(r.ticker)! }, o, ctx, firstView(r));
    })
    .join("\n");
  const heldItems: HeldOverlapItem[] = items
    .filter((r) => !inPage(r))
    .map((r) => {
      const c = coreBy.get(r.ticker) ?? null;
      return { id: overlapRowId(r.ticker), core: c ? slimRow(c.r) : null, all: slimRow(r), ord: { core: c?.i ?? null, all: allIdx.get(r.ticker)! } };
    });
  const cutMembers = new Set<string>();
  const cutTickers = new Set<string>();
  for (const it of heldItems) {
    if (ctx.cutTickers?.has(it.all.ticker)) cutTickers.add(it.all.ticker);
    for (const m of [...it.all.buy, ...it.all.sell]) for (const t of m.rows) if (t.bioguide && ctx.cutMembers?.has(t.bioguide)) cutMembers.add(t.bioguide);
  }
  const island = heldItems.length > 0 ? heldIslandHtml("ov-list", { q: { period: o.period, start: o.start, end: o.end }, items: heldItems, cut: { members: [...cutMembers].sort(), tickers: [...cutTickers].sort() } } satisfies HeldOverlap) : "";
  const count = (k: "same" | "opposite" | "all"): string => {
    const core = fmtInt(nc[k]);
    const all = fmtInt(na[k]);
    return core === all ? `<span class="ov-n">${core}</span>` : `<span class="ov-n" data-v="core">${core}</span><span class="ov-n" data-v="all" hidden>${all}</span>`;
  };
  const relButton = (rel: "all" | "same" | "opposite", label: string): string =>
    `<button type="button" data-ov-rel="${rel}" aria-pressed="${rel === "all" ? "true" : "false"}">${esc(label)} · ${count(rel)}</button>`;
  const broadTip = note(
    o.broad.length > 0
      ? `Members who traded more than ${BROAD_ACCOUNT_NAMES} names in ${quarter}: ${o.broad.map((b) => `${b.name} (${b.breadth})`).join(", ")}. They match almost any name, so they are not counted unless this is on; an opened row lists their lines apart either way.`
      : `Members who traded more than ${BROAD_ACCOUNT_NAMES} names in ${quarter} match almost any name, so they are not counted unless this is on. None did in ${quarter}.`,
    { scope: "signals-overlap" },
    "broad",
    { trigger: "mark", name: "About broad accounts" },
  );
  /* the default view's carried run: the core names the page holds from the
     view's first, contiguously (the client reads each view's run the same way) */
  const held = new Set(items.filter((r) => coreBy.has(r.ticker)).map((r) => coreBy.get(r.ticker)!.i));
  let coreCarried = 0;
  while (held.has(coreCarried)) coreCarried++;
  const coreShown = Math.min(OVERLAP_STEP, coreCarried);
  return (
    `<section class="panel sig-ov" id="ov-section" aria-labelledby="overlap-h" data-ov-step="${OVERLAP_STEP}" data-ov-n="${nc.all} ${na.all}" data-ov-same="${nc.same} ${na.same}" data-ov-opp="${nc.opposite} ${na.opposite}">` +
    head +
    lede +
    `<div class="ov-tools" data-scroll-region="Overlap filters · scroll sideways">` +
    `<div class="seg ov-rels" role="group" aria-label="Relation">${relButton("same", "Same")}${relButton("opposite", "Opposite")}${relButton("all", "All")}</div>` +
    `<button type="button" class="ov-broad" id="ov-broad" aria-pressed="false"><span class="ov-box" aria-hidden="true"></span>Broad accounts</button>${broadTip}` +
    `</div>` +
    `<div class="ov-head" aria-hidden="true"><span>Ticker</span><span>Issuer · members</span><span>Congress</span><span>Notable managers</span></div>` +
    `<div class="ov-list" id="ov-list">${rows}</div>` +
    island +
    `<p class="section-note" id="ov-empty"${o.core.length === 0 ? "" : " hidden"}>No names in this view.${o.core.length === 0 ? " Every name here was traded only by broad accounts; turn Broad accounts on to list them." : ""}</p>` +
    `<div class="feed-foot"><div class="pager">` +
    `<span class="pager-range" id="ov-range" tabindex="-1">${esc(overlapRangeText(coreShown, nc.all))}</span>` +
    `<button type="button" class="pager-btn${coreShown < coreCarried ? "" : " is-unavailable"}" id="ov-more" aria-disabled="${coreShown < coreCarried ? "false" : "true"}">Show ${fmtInt(OVERLAP_STEP)} more</button>` +
    `</div></div>` +
    `<p class="section-note ov-bound" id="ov-bound"${coreShown === coreCarried && coreCarried < nc.all ? "" : " hidden"}>${esc(overlapBoundText(coreCarried))}</p>` +
    `<p class="visually-hidden" id="ov-status" role="status" aria-live="polite"></p>` +
    `<noscript><p class="section-note">Filtering, Broad accounts and paging need JavaScript; ${plural(nc.all, "name is", "names are")} in this view, broad accounts not counted.</p></noscript>` +
    `<p class="si-foot"><a href="/methodology/#signals-overlap">How Overlap is read ↗</a> <a href="/methodology/#signals-congress-column">The Congress-quarter join ↗</a></p>` +
    `</section>`
  );
}

/** Methodology `#signals-overlap` (signals-v4 R27, LD14): the rule, every
    constant read from code. */
export function signalsOverlapMethodHtml(): string {
  const li = (s: string): string => `<li>${s}</li>`;
  return (
    `<section class="si-method" id="signals-overlap" aria-labelledby="signals-overlap-h">` +
    `<h3 class="section-h" id="signals-overlap-h">Overlap: Congress and notable managers on one name</h3>` +
    `<p class="metho-body">The Overlap tab on <a href="/signals/#overlap">/signals</a> lists the names that members of Congress traded and notable managers changed in the same 13F quarter. ` +
    `It is a co-occurrence in public filings — never coordination, never intent — and it computes no price and no return.</p>` +
    `<ul class="si-method-list">` +
    li(`<strong>The join.</strong> The same quarter join as the Congress column (<a href="#signals-congress-column">above</a>): Congress lines by trade date inside the quarter, listed stock as filed, a ticker, a purchase or a sale; 13F changes by the quarter they report. Tickers compare in the SEC spelling, so a name filed under a different spelling on the two sides is not matched.`) +
    li(`<strong>Counts.</strong> Congress: the distinct members with a purchase line (▲) and with a sale line (▼) on the name. Notable managers: the distinct managers with a new stake or an add (▲), and with a trim or an exit (▼).`) +
    li(`<strong>Direction.</strong> Each side's net: the larger of its two counts, or mixed on a tie. The relation is <em>same</em> when the two directions agree, <em>opposite</em> when they differ, and <em>mixed</em> when either side is mixed. A name is unanimous when neither side is split.`) +
    li(`<strong>Order.</strong> Same, then opposite, then mixed; unanimous names first; then the larger Congress count plus the larger manager count, highest first; then the ticker.`) +
    li(`<strong>Broad accounts.</strong> A member who traded more than ${fmtInt(BROAD_ACCOUNT_NAMES)} distinct tickers in the quarter matches almost any name, so the default view does not count them, and a name only they traded is not listed. "Broad accounts" counts them; an opened row lists their lines apart in either view.`) +
    li(`<strong>Detail.</strong> An opened row lists at most ${fmtInt(CONGRESS_DETAIL_LINES)} Congress lines a side, each with its range, owner, both dates and its receipt, the rest on the ticker page; and each manager's largest change on the name, at most ${fmtInt(OVERLAP_DETAIL_MANAGERS)} managers a side, each with its 13F receipt.`) +
    li(`<strong>What the page carries.</strong> In each view (the two variants, each by All, Same and Opposite) the first ${fmtInt(OVERLAP_SLICE_ROWS)} names — ${fmtInt(OVERLAP_FALLBACK_ROWS)} when the page would pass its byte budget — and ${fmtInt(OVERLAP_STEP)} show before "Show ${fmtInt(OVERLAP_STEP)} more". Every count is the true total; where a view runs past what the page carries, the tab says so.`) +
    `</ul>` +
    `</section>`
  );
}
