import { disclosureLedger, unavailableDesignPanel } from "./shared.ts";
import { memberProfileStats, type ChamberBenchmark } from "../inst-analytics.ts";
/* Pure page/section renderers. Every entity body is a string function called
   by the thin .astro page for SSR AND by the generic-route client driver —
   parity is by construction (one function, two callers). No Node APIs, no DOM.

   Honesty grammar: G1–G7 via the canonical format.ts components; charts
   zero-based, gaps stay gaps, no midpoints; NULL-honest institutional
   integers; the as-of time stamp every 13F table carries. */

/* ui/congress.ts — congressional member/ticker bodies, the entity transaction
   table, and the member-v2 sections. One of the ui/ domain modules: consumers
   import from ./index.ts only, never from this file directly. */

import {
  type TxnRow,
  type RenderCtx,
  type StatTile,
  type NoteCtx,
  assetNameCell,
  assetColumnNote,
  note,
  noteFromHtml,
  esc,
  fmtInt,
  fmtMoney,
  amountText,
  sideLabel,
  ownerQualifiersHtml,
  assetLineHtml,
  rangeBand,
  dualDate,
  flagTags,
  universalFlags,
  effectiveFlagKeys,
  universalFlagNote,
  srcLink,
  memberHrefFor,
  tickerHrefFor,
  partyClass,
  mergeFeed,
  pageSlice,
  pageCountFor,
  feedCountText,
  cardFoot,
  rangeOfTotal,
  thHtml,
  txnEdge,
  compactDisclosure,
  presentColumns,
  dataColumnsAttr,
  tableFootReasonHtml,
  type PresentColumns,
  DATE_ANOMALY_NOTE,
} from "../format.ts";
import {
  type MemberEntity,
  type TickerEntity,
  type SumRanges,
  type NetInterval,
  type QuarterlyFlowResult,
  excludeDateAnomalies,
  sumRanges,
  sumRangesText,
  undisclosedPctText,
  quarterlyFlow,
  monthlyFlow,
  lagCdf,
  lagCdfPointsText,
  estimatedCompleteness,
  completenessLabel,
  COMPLETENESS_SHADE_BELOW,
  FILING_WINDOW_DAYS,
  LAG_SAMPLE_MONTHS,
  type MonthFlow,
  type MonthlyFlowResult,
  type MonthCompleteness,
  type LagCdf,
  membersDisclosing,
  medianLag,
  lateCount,
  legacyTrailingMonthsBounds,
  windowMembership,
  affTextOf,
  netOverlaps,
  netFlow,
  netIntervalText,
  rankNetRows,
  memberNetByTicker,
  sectorMix,
  jurisdictionOverlap,
  notableRecent,
  membershipAsOf,
  type CommitteeMembership,
  type MembershipSnapshot,
  type SectorResolution,
  type MemberEntity as MemberEntityT,
} from "../derive.ts";
import { RANKING_FOOTNOTES as RANKING_FOOTNOTES_LIST } from "../congress-columns.ts";
import { type BuildStamps, breadcrumb, asOfNote, netCellHtml, netKindWord, sectorLabel } from "./shared.ts";
import { heldTableParts } from "../held-rows.ts";

/* ---------- flow ribbon ---------- */

function ribbonAxisMax(sums: SumRanges[]): number {
  let max = 1;
  for (const s of sums) {
    if (s.kind === "closed") max = Math.max(max, s.high);
    else if (s.kind === "open") max = Math.max(max, s.low);
  }
  return max;
}

function quarterSummary(q: { q: string; buy: SumRanges; sell: SumRanges }): string {
  const part = (label: string, s: SumRanges): string =>
    s.kind === "empty" ? `no ${label}` : `${label} ${sumRangesText(s)}`;
  return `${q.q}: ${part("purchases", q.buy)}, ${part("sales", q.sell)}`;
}

/** Div-drawn quarterly range ribbon. Zero-based always (C3); a quarter with
    no rows stays a visible gap (C2); open/unparsed bounds hatch (G4) with the
    count-based caption. `twoSided` puts sales below the axis (deep ticker). */
/** R13: the chart window holds nothing to plot — every quarter has zero
    purchase rows and zero sale rows — AND no row inside it was excluded for its
    side. With any excluded side the plot and its exclusion counts render as
    ever, so a reader is never told "no trades" about a window that held
    exchanges or unparsed sides. */
export function flowWindowEmpty(flow: QuarterlyFlowResult): boolean {
  return (
    flow.excludedSides === 0 &&
    flow.quarters.every((q) => q.buy.kind === "empty" && q.sell.kind === "empty")
  );
}

/** The first day of a quarter from its end date ("2024-12-31" -> "2024-10-01"). */
function quarterStart(end: string): string {
  const m = Number(end.slice(5, 7)) - 2;
  return `${end.slice(0, 4)}-${String(m).padStart(2, "0")}-01`;
}

/** R13: the ONE data-derived line an empty window renders instead of an
    empty plot — the window, the member's latest disclosed trade date, and the
    chart's `undated` and `dateAnomalies` counts when they are not zero.

    The window ends at the BUILD DATE when its final quarter has not closed
    (review R2-4): "to 2026-09-30" on a page built 2026-08-17 stated a month of
    trades as known-empty that had not happened yet. `asOf` is the build's
    generated-at date — the same date `quarterlyFlow` windowed by. */
export function flowWindowEmptyLine(flow: QuarterlyFlowResult, latestTraded: string | null, asOf: string | null = null): string {
  const first = flow.quarters[0]!;
  const last = flow.quarters[flow.quarters.length - 1]!;
  const open = asOf !== null && asOf < last.quarterEnd;
  const counts: string[] = [];
  if (flow.undated > 0) counts.push(`${fmtInt(flow.undated)} ${flow.undated === 1 ? "row has" : "rows have"} no parseable trade date`);
  if (flow.dateAnomalies > 0)
    counts.push(`${fmtInt(flow.dateAnomalies)} date-anomaly ${flow.dateAnomalies === 1 ? "row is" : "rows are"} excluded (${DATE_ANOMALY_NOTE})`);
  return (
    `<p class="section-note flow-window-empty" data-flow-empty>` +
    `No disclosed purchases or sales were traded in the chart window, ${esc(first.q)}–${esc(last.q)} ` +
    `(${esc(quarterStart(first.quarterEnd))} ${open ? `through ${esc(asOf!)}, the build date` : `to ${esc(last.quarterEnd)}`}). ` +
    (latestTraded
      ? `Most recent disclosed trade: <strong>${esc(latestTraded)}</strong> — the full history is in the tables below.`
      : `No row discloses a trade date — the full history is in the tables below.`) +
    (counts.length ? ` ${counts.map(esc).join(" · ")}.` : "") +
    `</p>`
  );
}

/** LD13 / LD25: a nice ceiling — 1, 2, 2.5, 4, 5, 8 or 10 × 10^k — at or
    above `v`, the quarterly ribbon's axis top. */
export function niceCeil(v: number): number {
  if (!(v > 0)) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  for (const step of [1, 2, 2.5, 4, 5, 8, 10]) if (step * p >= v) return step * p;
  return 10 * p;
}

/** LD25 (R24): the ribbon's ONE axis top, shared by purchases above and sales
    below — a nice ceiling over 1.12 × the largest PROVABLE MINIMUM on either
    side, so the axis fits what the filings prove; a maximum past it is cut and
    marked. When every minimum is zero (all "Under $X" or unparsed), the
    ceiling is over the largest maximum instead; 1 for an empty window. */
export function ribbonAxisTop(sums: readonly SumRanges[]): number {
  let maxLo = 0;
  let maxHi = 0;
  for (const s of sums) {
    if (s.kind === "closed") {
      maxLo = Math.max(maxLo, s.low);
      maxHi = Math.max(maxHi, s.high);
    } else if (s.kind === "open") {
      maxLo = Math.max(maxLo, s.low);
    }
  }
  const basis = maxLo > 0 ? maxLo : maxHi;
  return basis > 0 ? niceCeil(basis * 1.12) : 1;
}

/** A y-axis tick label in the site's money format, or null when that format
    would round the value (a half tick of $2.5K is $1.25K, which `fmtMoney`
    prints as $1.3K — a label must never misstate its gridline). */
function axisTickLabel(v: number): string | null {
  if (v === 0) return "$0";
  const unit = v >= 1_000_000 ? 1_000_000 : 1_000;
  const scaled = v / unit;
  return Math.round(scaled * 10) / 10 === scaled ? fmtMoney(v) : null;
}

/** The y-axis ticks of a two-sided ribbon: the top, its half and zero above;
    the same mirrored below. `pos` is the tick's height in the whole plot. */
export function ribbonAxisTicks(top: number): { pos: number; label: string | null; zero: boolean }[] {
  const half = top / 2;
  return [
    { pos: 100, label: axisTickLabel(top), zero: false },
    { pos: 75, label: axisTickLabel(half), zero: false },
    { pos: 50, label: "$0", zero: true },
    { pos: 25, label: axisTickLabel(half), zero: false },
    { pos: 0, label: axisTickLabel(top), zero: false },
  ];
}

/** One side's bar in one quarter, inside its half of the plot. The solid part
    is the provable minimum (0 → low); the lighter part runs to the maximum,
    and a maximum past the axis top — or an open one — is cut at the top with a
    marker that states it. Never a midpoint. An all-unparsed sum is hatched. */
function axisBarHtml(s: SumRanges, top: number, side: "buy" | "sell"): string {
  if (s.kind === "empty") return "";
  const cls = side === "buy" ? "rb-buy" : "rb-sell";
  const anchor = side === "buy" ? "bottom" : "top";
  const arrow = side === "buy" ? "↑" : "↓";
  const pct = (v: number): number => Math.min(100, (v / top) * 100);
  if (s.kind === "undisclosed") {
    return `<div class="rb-bar ${cls} rb-hatch" style="${anchor}:0;height:100%" aria-hidden="true"></div>` +
      `<span class="rb-cut" aria-hidden="true">${arrow} not disclosed</span>`;
  }
  const lo = pct(s.low);
  const solid = `<div class="rb-bar ${cls} rb-lo" style="${anchor}:0;height:${lo.toFixed(1)}%" aria-hidden="true"></div>`;
  if (s.kind === "open") {
    return solid +
      `<div class="rb-bar ${cls} rb-hi rb-hatch rb-cutoff" style="${anchor}:${lo.toFixed(1)}%;height:${(100 - lo).toFixed(1)}%" aria-hidden="true"></div>` +
      `<span class="rb-cut" aria-hidden="true">${arrow} open</span>`;
  }
  const cut = s.high > top;
  const hi = cut ? 100 - lo : pct(s.high) - lo;
  return solid +
    `<div class="rb-bar ${cls} rb-hi${cut ? " rb-cutoff" : ""}" style="${anchor}:${lo.toFixed(1)}%;height:${hi.toFixed(1)}%" aria-hidden="true"></div>` +
    (cut ? `<span class="rb-cut" aria-hidden="true">${arrow} ${esc(fmtMoney(s.high))}</span>` : "");
}

function rowsOf(s: SumRanges): number {
  return s.kind === "empty" ? 0 : s.rows;
}

/** The readout a quarter states when it is selected (LD13): its count of
    purchases and sales and both full ranges — the same facts the
    screen-reader summary carries. Launch review H2: the count is named for
    what it counts (purchases and sales, never "trades": exchanges are not
    drawn, and the readout says how many were not); a quarter the build date
    has not closed says it is so far, inside the 45-day filing window. */
export function quarterReadout(q: { q: string; quarterEnd?: string; buy: SumRanges; sell: SumRanges; other?: number }, asOf: string | null = null): string {
  const n = rowsOf(q.buy) + rowsOf(q.sell);
  const part = (s: SumRanges): string => (s.kind === "empty" ? "none" : sumRangesText(s));
  const open = asOf !== null && q.quarterEnd !== undefined && asOf < q.quarterEnd;
  const other = q.other ?? 0;
  return (
    `${q.q}${open ? " so far (inside the 45-day filing window)" : ""}: ` +
    `${fmtInt(n)} ${n === 1 ? "purchase or sale" : "purchases and sales"} · purchases ${part(q.buy)} · sales ${part(q.sell)}` +
    (other > 0 ? ` · ${fmtInt(other)} exchange/unparsed-side ${other === 1 ? "row" : "rows"} not drawn` : "")
  );
}

/** The quarterly flow ribbon — ONE renderer for both callers, the member page
    and `/congress/tickers/<T>/` (R24, LD13, LD25): purchases above and sales
    below one axis; a labelled y-axis whose top is `ribbonAxisTop`; a cut
    marker on every maximum past the top; "–" in an empty quarter; one plot
    control (a Tab stop whose arrow keys step through the quarters, a tap or
    pointer move selecting the nearest) feeding a polite readout; and the
    screen-reader summary with every full range. Zero-based (C3); a quarter
    with no rows stays a visible gap (C2); no midpoints.

    `twoSided` is kept for the callers' signature: the one-sided split the
    member page used is retired (R24), so both sides always share the axis.
    `notes` is OPTIONAL and only the member page passes one: without a scope
    the caption stays the visible `.rb-caption` it always was. `emptyWindow`
    (R13) is member-only: a window with nothing to plot becomes ONE line. */
export function flowRibbon(
  flow: QuarterlyFlowResult,
  opts: { twoSided: boolean; sourceLine: string; notes?: NoteCtx; emptyWindow?: { latestTraded: string | null; asOf?: string }; asOf?: string },
): string {
  /* H2: the build date, so the open quarter's readout says "so far" */
  const asOf = opts.asOf ?? opts.emptyWindow?.asOf ?? null;
  const empty = opts.emptyWindow !== undefined && flowWindowEmpty(flow);
  const top = ribbonAxisTop(flow.quarters.flatMap((q) => [q.buy, q.sell]));
  const cols = flow.quarters
    .map((q) => {
      const none = q.buy.kind === "empty" && q.sell.kind === "empty";
      return (
        `<div class="rb-col" data-rb-col data-readout="${esc(quarterReadout(q, asOf))}">` +
        `<div class="rb-up">${axisBarHtml(q.buy, top, "buy")}</div>` +
        `<div class="rb-axis" aria-hidden="true"></div>` +
        `<div class="rb-down">${axisBarHtml(q.sell, top, "sell")}</div>` +
        (none ? `<span class="rb-none" aria-hidden="true">–</span>` : "") +
        `</div>`
      );
    })
    .join("");
  const ticks = ribbonAxisTicks(top)
    .map((t) => `<span class="rb-ytick${t.zero ? " rb-y0" : ""}" style="bottom:${t.pos}%">${t.label === null ? "" : esc(t.label)}</span>`)
    .join("");
  const labels = flow.quarters
    .map((q, i) => `<div class="rb-label${i === flow.quarters.length - 1 ? " rb-label-cur" : ""}">${esc(q.q)}</div>`)
    .join("");
  const hatched = flow.quarters
    .map((q) => {
      const parts: string[] = [];
      const buyPct = undisclosedPctText(q.buy);
      const sellPct = undisclosedPctText(q.sell);
      if (buyPct) parts.push(`${q.q} purchases hatched: ${buyPct} of the bound rests on unparsed amounts`);
      if (sellPct) parts.push(`${q.q} sales hatched: ${sellPct} of the bound rests on unparsed amounts`);
      return parts.join(" · ");
    })
    .filter(Boolean)
    .join(" · ");
  const exclusions: string[] = [];
  if (flow.undated > 0) exclusions.push(`${fmtInt(flow.undated)} rows with no parseable trade date excluded`);
  if (flow.excludedSides > 0) exclusions.push(`${fmtInt(flow.excludedSides)} exchange/unparsed-side rows excluded`);
  if (flow.dateAnomalies > 0)
    exclusions.push(`${fmtInt(flow.dateAnomalies)} date-anomaly rows excluded (${DATE_ANOMALY_NOTE})`);
  const caption = [
    hatched,
    "purchases above the axis, sales below",
    "solid = the provable minimum, lighter = up to the maximum; a maximum past the axis top is cut and marked",
    "gaps are gaps — no interpolation",
    "y from $0 · no midpoints — bar spans the disclosed bounds",
    ...exclusions,
    opts.sourceLine,
  ]
    .filter(Boolean)
    .join(" · ");
  const captionHtml = opts.notes
    ? `<div class="rb-caption rb-caption-note"><span class="src-derived">` +
      note(caption, opts.notes, "chart-method", {
        trigger: "label",
        textHtml: "how this chart is drawn&nbsp;·§",
        name: "how this chart is drawn",
      }) +
      `</span></div>`
    : `<div class="rb-caption">${esc(caption)}</div>`;
  const summary = flow.quarters.map(quarterSummary).join("; ");
  if (empty) {
    return (
      `<div class="ribbon ribbon-empty">` +
      flowWindowEmptyLine(flow, opts.emptyWindow!.latestTraded, opts.emptyWindow!.asOf ?? null) +
      captionHtml +
      `</div>`
    );
  }
  const first = flow.quarters[0]!;
  const last = flow.quarters[flow.quarters.length - 1]!;
  return (
    `<div class="ribbon ribbon-two ribbon-axis">` +
    `<div class="rb-legend" aria-hidden="true"><span><i class="rb-lg rb-lg-buy"></i>Purchases</span><span><i class="rb-lg rb-lg-sell"></i>Sales</span><span><i class="rb-lg rb-lg-max"></i>Up to the max</span></div>` +
    `<div class="rb-plot" data-rb-plot tabindex="0" role="group" aria-label="Disclosed flow by quarter, ${esc(first.q)} to ${esc(last.q)}: arrow keys step through the quarters" aria-describedby="rb-readout">` +
    `<div class="rb-yaxis" aria-hidden="true">${ticks}</div>` +
    `<div class="rb-track">${cols}</div>` +
    `</div>` +
    `<div class="rb-labels">${labels}</div>` +
    `<p class="rb-readout" id="rb-readout" role="status" aria-live="polite">${esc(quarterReadout(last, asOf))}</p>` +
    /* The caption is a DEFINITION — how the chart is drawn, what the
       hatching means, what is excluded — so on the member page it is a note
       anchored on the chart, with the marker left visible as its cue (LD3).
       The accessibility summary below is the chart's data, not its method. */
    captionHtml +
    `<p class="visually-hidden">Disclosed flow by quarter. ${esc(summary)}</p>` +
    `</div>`
  );
}

/* ---------- monthly flow panel (SIGNALS-CLARITY M3, R16–R19) ----------

   /congress's "Monthly flow": 36 trade months of disclosed purchases (above
   the axis) vs sales (below), drawn in `flowRibbon`'s bar grammar and classes — zero
   based, a month with no rows stays a gap, never a midpoint. An open sum is
   solid to its provable minimum with a short FIXED-height hatched cap, and an
   all-unparsed sum is a hatched stub at the axis (`monthlyBarHtml`; at 36 bars
   the quarterly ribbon's hatch-to-the-axis-top swamped the real bars — a
   recorded deviation from R16's wording, monthly ribbon only). A closed bar
   spans exactly its disclosed bounds, with no minimum height. Under it, breadth:
   distinct members with a purchase vs with a sale per month, counted, not dollar-weighted
   (L6). Recent months are shaded by ESTIMATED filing completeness from the
   build's own lag distribution (R17), and every estimate says it is one.

   Two variants render at build time — listed stocks (the default) and all
   asset types — and a small client script flips `hidden` between them; there
   is no fetch (L4). Each variant carries its own caption, exclusion counts,
   shading labels and a visually-hidden table of every month (R19). */

const MONTHLY_FLOW_MONTHS = 36;

const MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** The axis tick under a month: the year at January, the month name at the
    other quarter starts, nothing between (36 labels cannot fit a phone). */
function monthTick(month: string): string {
  const m = Number(month.slice(5, 7));
  if (m === 1) return month.slice(0, 4);
  return m % 3 === 1 ? MONTH_ABBR[m - 1]! : "";
}

/* Wording: the §0 gate (test/lib/banned-scan.ts) bans present-tense trading
   verbs on every built surface, so breadth is stated as "members with a
   purchase / with a sale" — what the filings disclose — never as a verb. */
/* ----- monthly bar geometry -----

   The quarterly `barHtml` is NOT used here: it floors a closed bar at 1.5% of
   the axis so a small range stays visible, and at 36 months on an outlier
   scale that floor draws an upper bound nobody disclosed (review F1: $25K–$200K
   drawn to about $1.2M). On the monthly ribbon every dollar-scaled edge is the
   true bound, and visibility is a SEPARATE mark with no dollar meaning. */

/** Percent of the axis, floored to the two decimals emitted — so a drawn top
    is never above the true bound, by rounding or otherwise. */
function axisPct(value: number, axisMax: number): number {
  return Math.floor(Math.min(100, (value / axisMax) * 100) * 100) / 100;
}

/** A closed range shorter than this share of the axis (about one pixel of the
    monthly half-track) cannot be seen at its true height, so it also gets the
    fixed `.mf-tick`. */
const MONTHLY_TICK_BELOW_PCT = 1;

/** A closed sum's true span on the axis, and whether it needs the tick. */
function closedSpan(s: Extract<SumRanges, { kind: "closed" }>, axisMax: number): { base: number; height: number; tick: boolean } {
  const base = axisPct(s.low, axisMax);
  const height = Math.max(0, axisPct(s.high, axisMax) - base);
  return { base, height, tick: height < MONTHLY_TICK_BELOW_PCT };
}

/** Whether a month's sum is drawn with the too-small-to-draw tick. */
function monthlyBarTicked(s: SumRanges, axisMax: number): boolean {
  return s.kind === "closed" && closedSpan(s, axisMax).tick;
}

/** A monthly bar. `from` is the edge it grows away from: `bottom` for
    purchases (above the axis), `top` for sales (hanging below it), so offsets
    are always measured from the axis.

    - CLOSED: one bar from the true low to the true high — no minimum height.
      When that is under `MONTHLY_TICK_BELOW_PCT` it is followed by `.mf-tick`,
      a fixed-height mark at the bar's position (a CSS constant, not dollars)
      that only says "a range is here, too small to draw at this scale";
    - OPEN (a provable minimum, no upper bound): solid from the axis to the
      minimum, then `.mf-cap` — a hatched cap of FIXED height with no closing
      edge, so it reads as "continues" and is never mistaken for a maximum;
    - UNDISCLOSED (rows exist, no amount parsed): `.mf-stub`, the same hatched
      mark at the axis on its side — present, of no stated size, never $0;
    - EMPTY: a gap.

    Nothing is a point estimate: only solid fills are dollar-scaled, and each
    is a disclosed bound. */
function monthlyBarHtml(s: SumRanges, axisMax: number, cls: string, from: "bottom" | "top"): string {
  if (s.kind === "empty") return `<div class="rb-bar rb-gap" aria-hidden="true"></div>`;
  if (s.kind === "undisclosed") {
    return `<div class="rb-bar ${cls} rb-hatch mf-stub" style="${from}:0" aria-hidden="true"></div>`;
  }
  if (s.kind === "open") {
    const base = axisPct(s.low, axisMax).toFixed(2);
    return (
      `<div class="rb-bar ${cls}" style="${from}:0;height:${base}%" aria-hidden="true"></div>` +
      `<div class="rb-bar ${cls} rb-hatch mf-cap" style="${from}:${base}%" aria-hidden="true"></div>`
    );
  }
  const span = closedSpan(s, axisMax);
  const base = span.base.toFixed(2);
  return (
    `<div class="rb-bar ${cls}" style="${from}:${base}%;height:${span.height.toFixed(2)}%" aria-hidden="true"></div>` +
    (span.tick ? `<div class="rb-bar ${cls} mf-tick" style="${from}:${base}%" aria-hidden="true"></div>` : "")
  );
}

/** A month's sum for the assistive-technology table: the state is said in
    words, since the table cannot show a hatch. */
function monthSumWords(s: SumRanges): string {
  switch (s.kind) {
    case "empty":
      return "none";
    case "undisclosed":
      return "undisclosed — amounts filed but none parsed";
    case "open":
      return `${sumRangesText(s)} (open — no upper bound disclosed)`;
    case "closed":
      return sumRangesText(s);
  }
}

function monthSummary(m: MonthFlow, c: MonthCompleteness): string {
  const part = (label: string, s: SumRanges): string =>
    s.kind === "empty" ? `no ${label}` : `${label} ${sumRangesText(s)}`;
  const net = netIntervalText(netFlow(m.buy, m.sell));
  const est = c.est !== null && c.tone !== null ? `; ${completenessLabel(c.est)}` : "";
  return (
    `${m.month}: ${part("purchases", m.buy)}, ${part("sales", m.sell)}, net ${net}; ` +
    `${fmtInt(m.buyers)} ${m.buyers === 1 ? "member" : "members"} with a purchase, ${fmtInt(m.sellers)} with a sale${est}`
  );
}

/** Launch M3b (R11, LD13): a nice member-count ceiling over the largest
    month and its ticks — 0 to the top in at most four equal steps. */
export function memberAxisTicks(max: number): { top: number; ticks: number[] } {
  const m = Math.max(1, max);
  const steps = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 5000];
  const step = steps.find((x) => Math.ceil(m / x) <= 4) ?? Math.ceil(m / 4);
  const top = Math.ceil(m / step) * step;
  const ticks: number[] = [];
  for (let v = 0; v <= top; v += step) ticks.push(v);
  return { top, ticks };
}

/** The x position of a month's centre, as a percentage of the plot. */
function monthX(i: number, n: number): number {
  return ((i + 0.5) / n) * 100;
}

/** One month's readout in each measure — the numbers the screen-reader table
    carries, in one line (R21: a readout per month). The estimate is stated
    only for a month still filling in, and always as an estimate. */
function monthReadouts(m: MonthFlow, c: MonthCompleteness, buildDate: string): { members: string; dollars: string } {
  const open = buildDate < m.end ? " (so far)" : "";
  const est = c.tone !== null ? ` · ${c.est !== null ? completenessLabel(c.est) : "completeness not estimated"}` : "";
  const part = (label: string, sum: SumRanges): string => `${label} ${sum.kind === "empty" ? "none" : monthSumWords(sum)}`;
  return {
    members:
      `${m.month}${open} · ${fmtInt(m.buyers)} ${m.buyers === 1 ? "member" : "members"} with a purchase · ` +
      `${fmtInt(m.sellers)} with a sale${est}`,
    dollars:
      `${m.month}${open} · ${part("purchases", m.buy)} · ${part("sales", m.sell)} · net ${netIntervalText(netFlow(m.buy, m.sell))}${est}`,
  };
}

/** Launch M3b (R21, LD23): the default Members view — distinct members with a
    disclosed purchase and with a disclosed sale per trade month, as two lines
    on a labelled member axis. Months still filling in form the "Filling in"
    zone, labelled an estimate, and dash both lines. The plot is ONE control
    (LD13): a Tab stop whose arrow keys step through the months, and a pointer
    that selects the nearest month; the readout is a polite live region. */
function membersChartHtml(flow: MonthlyFlowResult, comp: readonly MonthCompleteness[], buildDate: string, scope: string): string {
  const n = flow.months.length;
  const { top, ticks } = memberAxisTicks(Math.max(0, ...flow.months.flatMap((m) => [m.buyers, m.sellers])));
  const firstFill = comp.findIndex((c) => c.tone !== null);
  const fillFrom = firstFill < 0 ? n : firstFill;
  const pt = (i: number, v: number): string => `${((i + 0.5) / n * 1000).toFixed(1)},${(1000 - (v / top) * 1000).toFixed(1)}`;
  const line = (vals: number[], from: number, to: number, cls: string): string =>
    to - from < 1 && !(to === from && n === 1)
      ? ""
      : `<polyline class="mf-line ${cls}" vector-effect="non-scaling-stroke" points="${vals.slice(from, to + 1).map((v, k) => pt(from + k, v)).join(" ")}"></polyline>`;
  const buyers = flow.months.map((m) => m.buyers);
  const sellers = flow.months.map((m) => m.sellers);
  const solidTo = Math.min(n - 1, fillFrom === n ? n - 1 : fillFrom - 1);
  const dashFrom = Math.max(0, fillFrom - 1);
  const lines =
    (solidTo >= 0 ? line(buyers, 0, solidTo, "mf-line-buy") + line(sellers, 0, solidTo, "mf-line-sell") : "") +
    (fillFrom < n ? line(buyers, dashFrom, n - 1, "mf-line-buy mf-line-est") + line(sellers, dashFrom, n - 1, "mf-line-sell mf-line-est") : "");
  const yTicks = ticks
    .map((v) => `<span class="mf-ytick" style="bottom:${((v / top) * 100).toFixed(2)}%">${fmtInt(v)}</span>`)
    .join("");
  const xTicks = flow.months
    .map((m, i) => ({ label: monthTick(m.month), i }))
    .filter((t) => t.label !== "")
    .map((t) => `<span class="mf-x" style="left:${monthX(t.i, n).toFixed(2)}%">${esc(t.label)}</span>`)
    .join("");
  const zone =
    fillFrom < n
      ? `<div class="mf-fill" style="left:${((fillFrom / n) * 100).toFixed(2)}%;width:${(((n - fillFrom) / n) * 100).toFixed(2)}%"><span>Filling in (est.)</span></div>`
      : "";
  const last = flow.months[n - 1]!;
  return (
    `<div class="mf-measure" data-flow-measure="members">` +
    `<p class="mf-legend" aria-hidden="true"><span class="mf-key-buy">with a purchase</span><span class="mf-key-sell">with a sale</span></p>` +
    `<div class="mf-chart"><span class="mf-yt" aria-hidden="true">members</span>` +
    `<div class="mf-plot mf-hit" tabindex="0" role="group" aria-label="Members with a disclosed purchase and with a disclosed sale per trade month — arrow keys step through the months" aria-describedby="${esc(scope)}-ro-members">` +
    `<div class="mf-yaxis" aria-hidden="true">${yTicks}</div>` +
    zone +
    `<svg viewBox="0 0 1000 1000" preserveAspectRatio="none" aria-hidden="true" focusable="false">${lines}</svg>` +
    `<span class="mf-cursor" aria-hidden="true" hidden></span>` +
    `<div class="mf-xaxis" aria-hidden="true">${xTicks}</div>` +
    `</div></div>` +
    `<p class="mf-readout" id="${esc(scope)}-ro-members" role="status" aria-live="polite">${esc(monthReadouts(last, comp[n - 1]!, buildDate).members)}</p>` +
    `</div>`
  );
}

function monthlyFlowVariantHtml(
  variant: "stocks" | "all",
  flow: MonthlyFlowResult,
  cdf: LagCdf,
  buildDate: string,
  hidden: boolean,
): string {
  const comp = flow.months.map((m) => estimatedCompleteness(cdf, m, buildDate));
  const axisMax = ribbonAxisMax(flow.months.flatMap((m) => [m.buy, m.sell]));
  const drawn = flow.months.some((m) => m.buy.kind !== "empty" || m.sell.kind !== "empty");
  const toneCls = (c: MonthCompleteness): string => (c.tone === null ? "" : ` mf-${c.tone}`);
  const scope = `mf-${variant}`;
  const cols = flow.months
    .map(
      (m, i) =>
        `<div class="rb-col${toneCls(comp[i]!)}" role="img" aria-label="${esc(monthSummary(m, comp[i]!))}">` +
        `<div class="rb-up">${monthlyBarHtml(m.buy, axisMax, "rb-buy", "bottom")}</div>` +
        `<div class="rb-axis" aria-hidden="true"></div>` +
        `<div class="rb-down">${monthlyBarHtml(m.sell, axisMax, "rb-sell", "top")}</div>` +
        `</div>`,
    )
    .join("");
  const labels = flow.months
    .map((m) => `<div class="rb-label">${esc(monthTick(m.month))}</div>`)
    .join("");
  const first = flow.months[0]!;
  const last = flow.months[flow.months.length - 1]!;
  const openMonth = buildDate < last.end;

  /* Shading labels: one line per shaded month, every "(est.)" kept (copy item
     congress-11). They and the completeness method below now live in the
     "still filling in" tip (R21); the honesty classes and the full method
     wording stay emitted there, where the visible-word budget does not reach. */
  const shaded = flow.months
    .map((m, i) => ({ m, c: comp[i]! }))
    .filter(({ c }) => c.tone !== null)
    .reverse();
  const shadeItems = shaded
    .map(
      ({ m, c }) =>
        `<li class="mf-shade-${c.tone}"><span class="mf-swatch" aria-hidden="true"></span>` +
        `${esc(m.month)} ${c.est !== null ? esc(completenessLabel(c.est)) : "completeness not estimated"}` +
        `${c.tone === "window" ? " · inside the 45-day window" : ""}</li>`,
    )
    .join("");
  const shadeHtml = shaded.length
    ? `<ul class="mf-shade-labels" aria-label="Months still filling in">${shadeItems}</ul>`
    : `<span class="mf-shade-labels">No month in the window is under ${Math.round(COMPLETENESS_SHADE_BELOW * 100)}% filed (est.) or inside the 45-day window.</span>`;

  const completenessHtml =
    `<span class="mf-completeness">` +
    (cdf.n === 0
      ? `Completeness is not estimated: no row traded ${esc(cdf.sampleFrom)} to ${esc(cdf.sampleTo)} carries a filing lag, so this build has no mature sample to measure. `
      : `Shading estimates how much of each month is filed so far: the share of this build's mature sample — ` +
        `${fmtInt(cdf.n)} trades made ${esc(cdf.sampleFrom)} to ${esc(cdf.sampleTo)} (${LAG_SAMPLE_MONTHS.newest}–${LAG_SAMPLE_MONTHS.oldest} months before the build), all asset types — ` +
        `filed within the month's age at the build (the build date minus the month's midpoint; for the build's own month, the midpoint of the days elapsed so far). Filed within ${esc(lagCdfPointsText(cdf))}. ` +
        `Trades in that sample that are still unfiled are not observed yet, so the estimate slightly overstates completeness. ` +
        `Shaded: under ${Math.round(COMPLETENESS_SHADE_BELOW * 100)}% filed (est.); darker: the month ended fewer than ${FILING_WINDOW_DAYS} days before the build, inside the 45-day filing window. `) +
    `<a href="/methodology/#monthly-flow">Method ↗</a></span>`;

  const exclusions: string[] = [];
  if (flow.listedStockOnly && flow.notListed > 0) {
    const other = flow.notListed - flow.untyped;
    exclusions.push(
      `${fmtInt(flow.notListed)} in-window ${flow.notListed === 1 ? "row" : "rows"} excluded as not listed stock ` +
        `(${fmtInt(flow.untyped)} untyped — the filing states no asset type; ${fmtInt(other)} another asset type)`,
    );
  }
  if (flow.excludedSides > 0)
    exclusions.push(`${fmtInt(flow.excludedSides)} in-window exchange/unparsed-side ${flow.excludedSides === 1 ? "row" : "rows"} excluded`);
  if (flow.undated > 0)
    exclusions.push(`${fmtInt(flow.undated)} ${flow.undated === 1 ? "row" : "rows"} with no parseable trade date excluded`);
  if (flow.dateAnomalies > 0)
    exclusions.push(`${fmtInt(flow.dateAnomalies)} date-anomaly ${flow.dateAnomalies === 1 ? "row" : "rows"} excluded (${DATE_ANOMALY_NOTE})`);
  const exclusionsHtml = `<span class="mf-exclusions">${
    exclusions.length ? `${esc(exclusions.join(" · "))}.` : "No row in this window was excluded."
  }</span>`;

  const kinds = new Set(flow.months.flatMap((m) => [m.buy.kind, m.sell.kind]));
  const ticked = flow.months.some((m) => monthlyBarTicked(m.buy, axisMax) || monthlyBarTicked(m.sell, axisMax));
  const caption = [
    `trade months ${first.month} to ${last.month}${openMonth ? ` (through ${buildDate}, the build date)` : ""}`,
    flow.listedStockOnly
      ? `listed stocks: rows whose filed asset type is ST (House Clerk code) or Stock (Senate eFD label) — never inferred from a name`
      : `all asset types`,
    "Members: distinct members per month with a disclosed purchase or sale — members, not dollars",
    /* launch review H3: an unjoined filer is counted by its printed name */
    flow.unjoined > 0
      ? `${fmtInt(flow.unjoined)} ${flow.unjoined === 1 ? "filer" : "filers"} with no matched member record ${flow.unjoined === 1 ? "is" : "are"} counted in Members by the name as filed`
      : "",
    "Dollars: purchases above the axis, sales and partial sales below",
    drawn ? `y from $0 to ${fmtMoney(axisMax)} · no midpoints — each bar spans the summed disclosed bounds` : "y from $0",
    ticked ? "a thin tick marks a month whose range is too small to draw at this scale — the tick is a marker, not a dollar amount" : "",
    kinds.has("open") ? "a hatched cap means no upper bound is disclosed (an open-ended or unparsed amount) — the bar shows the provable minimum only, and the cap's height is not a dollar amount" : "",
    kinds.has("undisclosed") ? "a hatched stub at the axis means amounts were filed but none parsed — never counted as $0" : "",
    "gaps are gaps — no interpolation",
    "source: House Clerk + Senate eFD",
  ]
    .filter(Boolean)
    .join(" · ");

  const rows = flow.months
    .map((m, i) => {
      const c = comp[i]!;
      const ro = monthReadouts(m, c, buildDate);
      return (
        `<tr data-ro-members="${esc(ro.members)}" data-ro-dollars="${esc(ro.dollars)}"><th scope="row">${esc(m.month)}</th><td>${esc(monthSumWords(m.buy))}</td><td>${esc(monthSumWords(m.sell))}</td>` +
        `<td>${esc(netIntervalText(netFlow(m.buy, m.sell)))}</td><td>${fmtInt(m.buyers)}</td><td>${fmtInt(m.sellers)}</td>` +
        `<td>${c.est === null ? "not estimated" : esc(completenessLabel(c.est))}${c.tone === "window" ? " · inside the 45-day window" : ""}</td></tr>`
      );
    })
    .join("");
  const scopeWords = variant === "stocks" ? "listed stocks" : "all asset types";
  const table =
    /* The clip pattern is on a wrapping BLOCK: a <table> ignores `width:1px`
       and `overflow`, so a visually-hidden table still widens the page. */
    `<div class="visually-hidden"><table class="mf-table">` +
    `<caption>Disclosed flow by trade month, ${scopeWords}, ${esc(first.month)} to ${esc(last.month)}. Amounts are summed statutory ranges; the net is an interval, never a point.</caption>` +
    `<thead><tr><th scope="col">Trade month</th><th scope="col">Purchases</th><th scope="col">Sales</th>` +
    `<th scope="col">Net (interval)</th><th scope="col">Members with a purchase</th><th scope="col">Members with a sale</th>` +
    `<th scope="col">Estimated completeness</th></tr></thead><tbody>${rows}</tbody></table></div>`;

  const notes = { scope };
  /* R21: the method, completeness and exclusion text are tips now — each keeps
     its honesty class inside the note, and each label stays on the page. */
  const tips =
    `<div class="mf-notes">` +
    noteFromHtml(shadeHtml + " " + completenessHtml, notes, "filling", { trigger: "label", textHtml: "Shaded months are still filling in (est.)" }) +
    ` · ` +
    noteFromHtml(exclusionsHtml, notes, "excluded", { trigger: "label", textHtml: "Excluded rows" }) +
    ` · ` +
    noteFromHtml(`<span class="rb-caption">${esc(caption)}</span>`, notes, "drawn", { trigger: "label", textHtml: "How it’s drawn" }) +
    ` · <a href="/methodology/#monthly-flow">Method ↗</a></div>`;

  const dollars =
    `<div class="mf-measure" data-flow-measure="dollars" hidden>` +
    `<p class="mf-legend" aria-hidden="true"><span class="mf-key-buy">purchases, above</span><span class="mf-key-sell">sales, below</span></p>` +
    `<div class="mf-dollars">` +
    `<div class="mf-dollar-axis" aria-hidden="true"><span>${esc(fmtMoney(axisMax))}</span><span>$0</span><span>${esc(fmtMoney(axisMax))}</span></div>` +
    `<div class="ribbon ribbon-two ribbon-monthly mf-hit" tabindex="0" role="group" aria-label="Disclosed purchases and sales per trade month — arrow keys step through the months" aria-describedby="${esc(scope)}-ro-dollars">` +
    `<div class="rb-track">${cols}</div>` +
    `<div class="rb-labels" aria-hidden="true">${labels}</div>` +
    `</div></div>` +
    `<p class="mf-readout" id="${esc(scope)}-ro-dollars" role="status" aria-live="polite">${esc(monthReadouts(last, comp[comp.length - 1]!, buildDate).dollars)}</p>` +
    `</div>`;

  return (
    `<div class="mf-variant" data-flow-variant="${variant}"${hidden ? " hidden" : ""}>` +
    membersChartHtml(flow, comp, buildDate, scope) +
    dollars +
    tips +
    table +
    `</div>`
  );
}

/** The whole "Monthly flow" panel: Members or Dollars × Stocks or All assets,
    all four built here from the build's rows and switched with no fetch
    (launch M3b, R21, LD23). Members on listed stocks is the default. */
export function monthlyFlowPanel(txns: readonly TxnRow[], buildDate: string, months = MONTHLY_FLOW_MONTHS): string {
  const cdf = lagCdf(txns, buildDate);
  const stocks = monthlyFlow(txns, buildDate, months, { listedStockOnly: true });
  const all = monthlyFlow(txns, buildDate, months);
  const controls =
    `<div class="mf-controls">` +
    `<div class="seg" role="group" aria-label="Measure">` +
    `<button type="button" data-flow-measure-toggle="members" aria-pressed="true">Members</button>` +
    `<button type="button" data-flow-measure-toggle="dollars" aria-pressed="false">Dollars</button>` +
    `</div>` +
    `<div class="seg" role="group" aria-label="Asset types drawn">` +
    `<button type="button" data-flow-toggle="stocks" aria-pressed="true">Stocks</button>` +
    `<button type="button" data-flow-toggle="all" aria-pressed="false">All assets</button>` +
    `</div></div>`;
  return (
    `<section class="panel panel-wide" id="monthly-flow-section" aria-labelledby="monthly-flow-h">` +
    `<div class="panel-head"><h2 class="section-h" id="monthly-flow-h">Monthly flow</h2>` +
    `<span class="panel-note">${months} months · by trade month</span>` +
    controls +
    `</div>` +
    `<noscript><p class="caveat-inline">Dollars and All assets need JavaScript.</p></noscript>` +
    monthlyFlowVariantHtml("stocks", stocks, cdf, buildDate, false) +
    monthlyFlowVariantHtml("all", all, cdf, buildDate, true) +
    `</section>`
  );
}

/* ---------- sum-of-ranges display ---------- */

/** Aggregate flow as text; an all-unparsed aggregate renders the hatched
    not-disclosed treatment, never a fabricated $0+ (spec §2). */
export function flowCellHtml(s: SumRanges): string {
  if (s.kind === "undisclosed") {
    return `<span class="nc-chip" title="every amount in this aggregate is unparsed">not disclosed</span>`;
  }
  return esc(sumRangesText(s));
}

/* ---------- entity transaction table (real <table>) ---------- */

export interface EntityTableOpts {
  kind: "member" | "ticker";
  caption: string;
  page: number;
  ctx: RenderCtx;
  /* OPT-IN. This renderer has three call sites — the member
     page (in scope) and two `/tickers/*` bodies (not). Without a scope its
     `<thead>` is byte-identical to the pre-run output, so the ticker pages are
     untouched; with one, the `Side · Owner` header carries the owner-code
     explanation the member page's `.entity-lede` used to print as a paragraph.

     This is a FIFTH key-less table variant, which no revision of the
     plan enumerated — its `<thead>` is a literal with no sort or data key, so
     the descriptor is supplied here rather than invented at render time.
     Recorded as a deviation; the plan named four. */
  notes?: NoteCtx;
  /** R25: the member table's side filter (default All — the server's page) */
  side?: MemberSide;
}

/* The owner-code explanation, in ONE place in this module. The full
   text also lives at `/methodology/#owner-codes`, which T1 populated by moving
   it off this page — the note carries it too because a reader looking at an
   `SP` badge inside a table should not have to leave the table to learn what it
   means, and §7 forbids softening text on the way to a new channel. The deep
   link is what makes the two the same statement rather than two wordings. */
const OWNER_CODE_NOTE =
  `Filings under this member include transactions by spouse (SP), dependent children (DC), and ` +
  `joint accounts (JT) — the STOCK Act does not distinguish who directed a trade. ` +
  `<a href="/methodology/#owner-codes">Owner codes ↗</a>`;

/* R25 (launch M4b): the member trades table's columns — Side, Ticker,
   Asset · owner, Range, Traded → filed, Src — decided over EVERY row its pager
   can show (R12). The owner and partial qualifiers ride on the asset line,
   outside its ellipsis (`assetLineHtml` with `qualifiers`), so they are never
   a separate column a reader could lose; the Range cell carries every flag
   chip; the dates cell keeps the lag and LATE. */
const MEMBER_TXN_COLUMNS: readonly (readonly [string, string, string])[] = [
  ["kind", "Side", "c-kind"], ["ticker", "Ticker", "c-ticker"], ["asset", "Asset · owner", "c-secondary c-flex"],
  ["range", "Range", "c-num"], ["dates", "Traded → filed", "c-num"], ["src", "Src", "c-src"],
];
export function memberTxnColumns(txns: readonly TxnRow[]): PresentColumns {
  return presentColumns<TxnRow>(txns, MEMBER_TXN_COLUMNS.map(([key]) =>
    key === "ticker"
      ? { key, hasValue: (r: TxnRow) => r.ticker != null, emptyReason: "Ticker: no row names a ticker; each filed asset is in the Asset column." }
      : { key, always: true },
  ));
}

/** R25 / LD25: member trades page 25 rows (the `/e/` route included); the
    feed's transport page size is unchanged. */
export const MEMBER_PAGE_SIZE = 25;

/** The member trades table's side filter (R25): All, Buys, Sells. */
export type MemberSide = "all" | "buy" | "sell";

/** The rows a side filter keeps, from the member's whole collection — a
    partial sale is a sale; an exchange shows under All only. */
export function memberSideRows(txns: readonly TxnRow[], side: MemberSide): TxnRow[] {
  if (side === "buy") return txns.filter((t) => t.side === "purchase");
  if (side === "sell") return txns.filter((t) => t.side === "sale" || t.side === "sale_partial");
  return [...txns];
}

/** The member trades count (rule 6): "1–25 of 140 transactions", or of the
    side the filter selected — "1–12 of 12 purchases". */
export function memberTradesCountText(page: number, shown: number, total: number, side: MemberSide = "all"): string {
  const noun = side === "buy" ? "purchases" : side === "sell" ? "sales" : "transactions";
  if (total <= 0 || shown <= 0) return `0 ${noun}`;
  const lo = page * MEMBER_PAGE_SIZE + 1;
  return rangeOfTotal(lo, lo + shown - 1, total, noun);
}

function txnCellsMember(r: TxnRow, ctx: RenderCtx, stated: readonly string[] = [], cols: readonly string[] | null = null): string {
  const side = sideLabel(r.side, r.flags);
  const amountUnknown = r.low == null && r.high == null;
  const has = (k: string): boolean => cols === null || cols.includes(k);
  return (
    `<td class="c-side c-kind ${side.cls}" role="cell">${esc(side.text)}</td>` +
    (has("ticker") ? `<td class="c-ticker" role="cell">${r.ticker ? `<a href="${tickerHrefFor(r.ticker, ctx)}">${esc(r.ticker)}</a>` : "—"}</td>` : "") +
    /* R17 (M3, T3.3): the default asset text, its as-filed note printing;
       the partial and owner qualifiers follow it, outside the ellipsis */
    `<td class="c-asset c-secondary c-flex" role="cell">${assetLineHtml(r, { notes: { scope: "member-asset" }, qualifiers: true })}</td>` +
    `<td class="c-amount c-num${amountUnknown ? " unknown" : ""}" role="cell">${esc(amountText(r))}${flagTags(r.flags, r, { stated })}</td>` +
    `<td class="c-traded c-num" role="cell">${dualDate(r, true)}</td>` +
    `<td class="c-src" role="cell">${srcLink(r.doc)}</td>`
  );
}

function txnCellsTicker(r: TxnRow, ctx: RenderCtx, stated: readonly string[] = [], pinned = false): string {
  const side = sideLabel(r.side, r.flags);
  const owner = ownerQualifiersHtml(r);
  const amountUnknown = r.low == null && r.high == null;
  const memberCell = r.bioguide
    ? `<a href="${memberHrefFor(r.bioguide, ctx)}">${esc(r.name)}</a> <span class="aff ${partyClass(r.party)}">${esc(
        affTextOf(r),
      )}</span>`
    : `<span class="unjoined-name">${esc(r.name)}</span> <span class="aff ${partyClass(r.party)}">${esc(affTextOf(r))}</span>`;
  return (
    `<td class="c-filed c-num has-marks">${esc(r.filed)}</td>` +
    /* signals-v3 M3 (R19): a row pinned from the ticker's "On Signals" block
       says so in words, beside the member it names */
    `<td class="c-member c-flex">${memberCell}${pinned ? ` <span class="on-signals-mark">On Signals</span>` : ""}</td>` +
    `<td class="c-side c-kind ${side.cls}">${esc(side.text)}${owner ? ` ${owner}` : ""}</td>` +
    `<td class="c-traded c-num">${dualDate(r)}</td>` +
    `<td class="c-amount c-num${amountUnknown ? " unknown" : ""}">${esc(amountText(r))}</td>` +
    `<td class="c-range c-bar">${rangeBand(r)}${flagTags(r.flags, r, { stated })}</td>` +
    `<td class="c-src">${srcLink(r.doc)}</td>`
  );
}

export function entityTxnRowsHtml(
  rows: TxnRow[],
  kind: "member" | "ticker",
  ctx: RenderCtx,
  stated: readonly string[] = [],
  /** the table's `data-columns` set (R12); null renders every column */
  columns: readonly string[] | null = null,
  /** signals-v3 M3 (R19), the ticker page's preview only: every row carries
      `data-txn`, and a row whose txnId is in `pinned` is marked On Signals.
      Every other caller passes nothing and renders the bytes it always did. */
  rowOpts: { dataTxn?: boolean; pinned?: ReadonlySet<string> } = {},
): string {
  /* The row's kind edge (tr[data-edge]); `data-kind` stays the table kind. */
  return rows
    .map((r) => {
      const edge = txnEdge(r);
      const pinned = kind === "ticker" && rowOpts.pinned?.has(r.txnId) === true;
      const cells = kind === "member" ? txnCellsMember(r, ctx, stated, columns) : txnCellsTicker(r, ctx, stated, pinned);
      return `<tr${pinned ? ' class="on-signals"' : ""}${edge ? ` data-edge="${edge}"` : ""}${rowOpts.dataTxn ? ` data-txn="${esc(r.txnId)}"` : ""}${kind === "member" ? ' role="row"' : ""}>${cells}</tr>`;
    })
    .join("\n");
}

export function entityTableCountText(page: number, shown: number, total: number): string {
  return feedCountText({
    page,
    txnMatched: total,
    paperMatched: 0,
    txnOnPage: shown,
    paperOnPage: 0,
    txnTotal: total,
    indeterminate: 0,
  });
}

export function entityTxnTable(txns: TxnRow[], opts: EntityTableOpts): string {
  const member = opts.kind === "member";
  const side: MemberSide = member ? (opts.side ?? "all") : "all";
  /* R25: the member table pages 25 rows of the side the filter selected; the
     ticker table keeps the feed's 50. */
  const rows = member ? memberSideRows(txns, side) : txns;
  const pageSize = member ? MEMBER_PAGE_SIZE : undefined;
  const merged = mergeFeed(rows, []);
  const pageRows = pageSlice(merged, opts.page, pageSize).filter((i): i is TxnRow => i.kind === "txn");
  const pages = pageCountFor(merged, pageSize);
  /* Universal-flag hoisting runs over EVERY row the table can page through, not this page —
     the client re-renders rows on paging, and a per-page set would let page 2
     contradict the note page 1 left above it. The set travels to the client in
     `data-stated-flags` so both sides suppress identically. */
  const stated = universalFlags(txns.map(effectiveFlagKeys));
  /* The ledger ROLE of every column (DESIGN-POLISH M1, R2): the header and
     each cell carry the same class, so a right-aligned number sits under a
     right-aligned header by construction. */
  /* R12: the member table's columns come from its full collection and ride to
     the client pager in `data-columns`; the ticker table's are all fixed. */
  const cols = member ? memberTxnColumns(txns) : null;
  const heads: readonly (readonly [string, string, string])[] =
    member
      ? MEMBER_TXN_COLUMNS.filter(([key]) => cols!.columns.includes(key)).map(([key, label, cls]) => [label, cls, key] as const)
      : [["Filed", "c-num", ""], ["Member", "c-member c-flex", ""], ["Side · Owner", "c-kind", ""], ["Traded · Lag", "c-num", ""],
         ["Amount", "c-num", ""], ["Range · Flags", "c-bar", ""], ["Src", "c-src", ""]];
  /* Only the owner-bearing header carries a note, and only when a scope is
     passed. On the member table that is "Asset · owner": the asset rule and
     the owner codes are stated once, on the column that prints both. */
  const headNote = (label: string): string | null =>
    !opts.notes
      ? null
      : label === "Side · Owner"
        ? OWNER_CODE_NOTE
        : label === "Asset · owner"
          ? `${esc(assetColumnNote())} ${OWNER_CODE_NOTE}`
          : null;
  const count = member
    ? memberTradesCountText(opts.page, pageRows.length, rows.length, side)
    : entityTableCountText(opts.page, pageRows.length, txns.length);
  return (
    universalFlagNote(stated) +
    `<div class="table-scroll"><table class="etable" data-entity-table data-kind="${opts.kind}"` +
    /* `data-paged` is the ONLY thing that exempts a table from the
       whole-distribution hoisting gate, and only these two renderers page. A visible page of a
       paged table can be uniform while its full collection is not, which is the
       one case the gate cannot judge from HTML. */
    `${pages > 1 ? ' data-paged="1"' : ""} data-stated-flags="${esc(stated.join(","))}"${cols ? dataColumnsAttr(cols) : ""}` +
    /* R40 (M1 contract): the member table carries explicit table roles and
       its card layout key, so a phone card keeps table semantics in WebKit */
    `${member ? ' role="table" data-card="member-trades"' : ""}>` +
    `<caption class="visually-hidden">${esc(opts.caption)}</caption>` +
    `<thead${member ? ' role="rowgroup"' : ""}><tr${member ? ' role="row"' : ""}>${heads
      .map(([h, cls, key]) =>
        // The ticker table's fixed newest-filed-first order is stated by the
        // header's aria-sort and caret, never a "▾" typed into the label.
        thHtml({ label: h, mark: null, cls, noteHtml: headNote(h), notes: opts.notes, noteKey: h === "Asset · owner" ? "asset" : "side-owner", order: member || h !== "Filed" ? undefined : "descending", ...(key ? { col: key } : {}) }),
      )
      .join("")}</tr></thead>` +
    `<tbody data-entity-rows${member ? ' role="rowgroup"' : ""}>${entityTxnRowsHtml(pageRows, opts.kind, opts.ctx, stated, cols ? cols.columns : null)}</tbody>` +
    `</table></div>` +
    (cols ? tableFootReasonHtml(cols) : "") +
    `<div class="table-foot">` +
    (member
      ? /* member-13: the same fact in half the words; the note keeps the supersede rule */
        `<div class="view-note">${opts.notes ? note("Each row is the latest version of its filing: an amendment replaces the original it supersedes, and the original stays in the published record.", opts.notes, "amended", { trigger: "label", textHtml: "Amended filings: latest version shown" }) : "Amended filings: latest version shown"} <a href="/methodology/#defaults" aria-label="what is excluded">↗</a></div>`
      : `<div class="view-note">${opts.notes ? note("Each row is the latest version of its filing: an amendment replaces the original it supersedes, and the original stays in the published record.", opts.notes, "amended", { trigger: "label", textHtml: "Amended filings show the latest version" }) : "Amended filings show the latest version"} · <a href="/methodology/#defaults">what's excluded ↗</a></div>`) +
    `<div class="pager">` +
    `<span class="pager-range" data-entity-count tabindex="-1">${esc(count)}</span>` +
    `<button class="pager-btn is-unavailable" data-entity-newer aria-disabled="true">← newer</button>` +
    `<button class="pager-btn${pages > 1 ? "" : " is-unavailable"}" data-entity-older aria-disabled="${pages > 1 ? "false" : "true"}">older →</button>` +
    `</div></div>` +
    `<p class="visually-hidden" data-entity-status role="status" aria-live="polite"></p>`
  );
}

/* ---------- member page body ---------- */

export function memberStatTiles(m: MemberEntity, stamps: BuildStamps): StatTile[] {
  // constraint 9: trailing-window tiles are date-windowed aggregates too.
  const flow12 = sumRanges(
    excludeDateAnomalies(m.txns).rows.filter(
      (t) =>
        windowMembership(
          t,
          legacyTrailingMonthsBounds(stamps.generatedAtDate, 12),
          "traded_or_filed",
        ) === "in",
    ),
  );
  const lag = medianLag(m.txns);
  const late = lateCount(m.txns);
  return [
    {
      value: fmtInt(m.filingCount),
      label: `filings incl. ${fmtInt(m.paper.length)} paper`,
      title:
        "distinct default-view filings for this member, including paper (needs-OCR) filings that carry zero machine-readable rows",
    },
    { value: fmtInt(m.txns.length), label: "transactions" },
    {
      value: flow12.kind === "empty" ? "—" : sumRangesText(flow12),
      label: "disclosed flow · trailing 12m",
      title:
        "sum of statutory bucket bounds over the trailing 12 months — an interval, not an estimate of value",
    },
    {
      value: lag == null ? "—" : `+${lag}d`,
      label: "median lag",
      title: "median days between trade date and filing date, over rows that disclose both",
    },
    {
      value: String(late),
      label: "late filings",
      title: "rows filed past the STOCK Act's 45-day window",
      muted: late === 0,
    },
  ];
}

/** S5 + member-17: the member's needs-OCR paper filings — counted in totals,
    not machine-read until OCR, each linked to the original. */
export function memberPaperBlock(m: MemberEntity): string {
  if (m.paper.length === 0) return "";
  const rows = m.paper
    .map(
      (p) =>
        `<tr role="row"><td class="c-filed c-num has-marks" role="cell">${esc(p.filed)}</td>` +
        `<td class="c-secondary c-flex" role="cell"><span class="chip-ocr">needs OCR</span></td>` +
        `<td class="c-src" role="cell">${srcLink(p.doc)}</td></tr>`,
    )
    .join("\n");
  return (
    `<section class="paper-block" aria-labelledby="paper-h">` +
    `<h2 id="paper-h" class="section-h">Paper filings — not machine-readable</h2>` +
    `<p class="section-note">Counted in totals, but not machine-readable until OCR. Each links to the original.</p>` +
    `<div class="table-scroll"><table class="etable" role="table" data-card="generic"><caption class="visually-hidden">Paper filings needing OCR for this member</caption>` +
    `<thead role="rowgroup"><tr role="row">${thHtml({ label: "Filed", cls: "c-num", order: "descending" })}<th scope="col" class="c-secondary c-flex" role="columnheader">Status</th><th scope="col" class="c-src" role="columnheader">Src</th></tr></thead>` +
    `<tbody role="rowgroup">${rows}</tbody></table></div></section>`
  );
}

/** LD24 (R23): the layout thresholds — active at four or more trades,
    compact at three or fewer (a member with no transactions and only paper
    filings included); the profile at ten or more; sectors at two or more;
    the filing history at two or more filings. */
export const MEMBER_ACTIVE_MIN_TRADES = 4;
export const MEMBER_PROFILE_MIN_TRADES = 10;
export const MEMBER_SECTORS_MIN = 2;
export const MEMBER_HISTORY_MIN_FILINGS = 2;

/** A committee role that is the chair — never a vice chair or ranking member. */
export function isChairRole(role: string | null): boolean {
  return role !== null && /^chair(man|woman|person)?$/i.test(role.trim());
}

/** The member's active signals, as the page computed them from the build's
    signal artifact (kinds s1–s6), for the compact layout's Signals fact. */
export interface MemberSignalsSummary {
  retentionDays: number;
  active: readonly { kind: string; label: string; ticker: string | null }[];
}

/** One distinct filing behind the member's transactions. */
function memberFilings(m: MemberEntity): MemberHistoryRowIn[] {
  return Array.from(
    m.txns
      .reduce((map, row) => {
        const old = map.get(row.doc);
        map.set(row.doc, { filed: row.filed, doc: row.doc, count: (old?.count ?? 0) + 1 });
        return map;
      }, new Map<string, MemberHistoryRowIn>())
      .values(),
  ).sort((a, b) => b.filed.localeCompare(a.filed));
}

/** The owner as words on a compact card: a missing owner reads "owner not
    stated", never "self" (R2); a partial sale says so. */
function ownerWords(r: Pick<TxnRow, "owner" | "side">): string {
  const who =
    r.owner === "self" ? "self" :
    r.owner === "spouse" ? "spouse (SP)" :
    r.owner === "child" ? "dependent child (DC)" :
    r.owner === "joint" ? "joint (JT)" : "owner not stated";
  return r.side === "sale_partial" ? `${who} · partial sale` : who;
}

/** The ledger (R23): Trades (filings and paper) · Last filed · Net flow · 12m
    · Late ("N of M" over the rows with a late status). */
export function memberLedgerHtml(m: MemberEntity, stamps: BuildStamps): string {
  const rows12 = excludeDateAnomalies(m.txns).rows.filter(
    (t) => windowMembership(t, legacyTrailingMonthsBounds(stamps.generatedAtDate, 12), "traded_or_filed") === "in",
  );
  // net = purchases − sales through the ONE net arithmetic (`netFlow`)
  const net12 = netFlow(
    sumRanges(rows12.filter((t) => t.side === "purchase")),
    sumRanges(rows12.filter((t) => t.side === "sale" || t.side === "sale_partial")),
  );
  const late = lateCount(m.txns);
  const withStatus = m.txns.filter((t) => t.late != null).length;
  const lastFiled = [...m.txns.map((t) => t.filed), ...m.paper.map((p) => p.filed)].filter(Boolean).sort().at(-1) ?? null;
  return disclosureLedger([
    {
      label: "Trades",
      value: fmtInt(m.txns.length),
      // member-02: "1 filing", and paper only when there is any
      detail: `${countOf(m.filingCount, "filing", "filings")}${m.paper.length > 0 ? ` · ${fmtInt(m.paper.length)} paper` : ""}`,
      subKind: "count",
    },
    { label: "Last filed", value: lastFiled ?? "—", detail: lastFiled ? "newest filing" : "", subKind: "date", tone: "blue" },
    {
      label: "Net flow · 12m",
      value: rows12.length === 0 ? "—" : net12.kind === "unbounded" ? "unbounded" : netIntervalText(net12),
      detail: rows12.length > 0 && net12.kind === "unbounded" ? "open on both sides · an interval" : "purchases − sales",
      subKind: "qualifier",
      noteHtml: esc("Purchases minus sales over the trailing 12 months, summed from the statutory ranges on each filing — an interval, not an estimate of value."),
    },
    {
      label: "Late",
      value: withStatus === 0 ? "—" : `${fmtInt(late)} of ${fmtInt(withStatus)}`,
      detail: "filed after 45 days",
      tone: late > 0 ? "gold" : "ink",
      noteHtml: esc(`Rows filed past the STOCK Act's 45-day window, out of the ${fmtInt(withStatus)} ${withStatus === 1 ? "row" : "rows"} whose dates allow a late status.`),
    },
  ], { scope: "member-ledger" });
}

export function memberBody(
  m: MemberEntity,
  stamps: BuildStamps,
  ctx: RenderCtx,
  page = 0,
  deps: MemberV2Deps = { resolveSector: null, sectorMeta: null, committees: null },
  signalsHtml = "",
  side: MemberSide = "all",
): string {
  const active = m.txns.length >= MEMBER_ACTIVE_MIN_TRADES;
  // Committees the member currently sits on, when the build carries the roster.
  const committeesNow = deps.committees
    ? (membershipAsOf({ memberships: deps.committees.memberships, windowFrom: deps.committees.windowFrom, windowTo: deps.committees.windowTo }, deps.committees.snapshotDate) ?? [])
    : null;
  const chamberWord = m.chamber === "senate" ? "U.S. Senate" : "U.S. House";
  /* member-01 (adapted): the party code once, "since", and each committee
     with its Chair mark; the member ID lives in the breadcrumb. */
  const subline =
    `<span class="aff ${partyClass(m.party)}">${esc(affTextOf(m))}</span>` +
    ` · ${esc(chamberWord)}` +
    (m.servingSince ? ` · since ${esc(m.servingSince)}` : "") +
    (committeesNow ?? [])
      .map((c) => ` · <span class="member-cmte">${esc(c.name)}${isChairRole(c.role) ? ` <span class="chair-badge">Chair</span>` : ""}</span>`)
      .join("");
  const head =
    breadcrumb([
      { text: "/congress", href: "/congress/" },
      { text: "members" },
      { text: m.bioguide },
    ]) +
    `<header class="entity-head member-head">` +
    `<div class="entity-head-copy">` +
    `<h1 class="entity-title">${esc(m.name)}</h1>` +
    `<div class="entity-subline">${subline}</div>` +
    `</div>` +
    memberLedgerHtml(m, stamps) +
    `</header>` +
    /* member-03: the sources, the ranges claim (its note keeps the full
       sentence and the methodology anchor) and the as-of date, once. */
    `<div class="design-provenance">House Clerk + Senate eFD · amounts are ` +
    noteFromHtml(
      `Amounts are statutory ranges; totals on this page are therefore ranges too. ` +
        `<a href="/methodology/#amount-ranges">Amount ranges ↗</a>`,
      { scope: "member-stamp" },
      "statutory-ranges",
      { trigger: "label", textHtml: "statutory ranges" },
    ) +
    ` · as of ${esc(stamps.generatedAtDate)}</div>`;
  if (!active) return head + memberCompactHtml(m, ctx, deps) + memberPaperBlock(m);

  const flow = quarterlyFlow(m.txns, stamps.generatedAtDate, 8);
  // R13: the member's latest disclosed trade date, over rows whose dates are
  // not anomalous (an impossible date is never the "latest trade").
  const latestTraded = excludeDateAnomalies(m.txns).rows.reduce<string | null>(
    (best, t) => (t.traded && (best === null || t.traded > best) ? t.traded : best),
    null,
  );
  const v2 = memberV2Parts(m, stamps, ctx, deps);
  const buys = memberSideRows(m.txns, "buy").length;
  const sells = memberSideRows(m.txns, "sell").length;
  const sideBtn = (key: MemberSide, label: string, n: number | null): string =>
    `<button type="button" data-side="${key}" aria-pressed="${key === side}">${label}${n === null ? "" : ` <span class="n">${fmtInt(n)}</span>`}</button>`;
  const main =
    /* R24: the quarterly chart leads — both sides on one labelled axis */
    `<section class="panel panel-wide design-member-chart" aria-labelledby="flow-h">` +
    `<div class="panel-head"><h2 id="flow-h" class="section-h">Quarterly flow</h2>` +
    `<span class="panel-note">8 quarters · by trade date</span></div>` +
    flowRibbon(flow, {
      twoSided: true,
      sourceLine: "source: House Clerk + Senate eFD",
      notes: { scope: "member-chart" },
      emptyWindow: { latestTraded, asOf: stamps.generatedAtDate },
    }) +
    `</section>` +
    `<section class="panel panel-wide member-trades" aria-labelledby="txns-h">` +
    `<div class="panel-head"><h2 id="txns-h" class="section-h">Trades</h2>` +
    // member-12: the plural fixed; the as-of time lives on the provenance line
    `<span class="panel-note">${countOf(m.txns.length, "trade", "trades")} · newest filed first</span>` +
    /* R25: the side filter runs over the member JSON the pager already
       fetches; it needs a script, so it is revealed by one */
    `<div class="seg member-side-filter" role="group" aria-label="Side" data-side-filter hidden>` +
    sideBtn("all", "All", null) + sideBtn("buy", "Buys", buys) + sideBtn("sell", "Sells", sells) +
    `</div></div>` +
    entityTxnTable(m.txns, {
      kind: "member",
      caption: `Trades for ${m.name}, newest filed first`,
      page,
      ctx,
      notes: { scope: "member-txns" },
      side,
    }) +
    `</section>`;
  const signals = signalsHtml || MEMBER_SIGNALS_UNJOINED;
  return (
    head +
    `<div class="member-grid" data-member-layout="active">` +
    `<div class="member-main">${main}</div>` +
    `<aside class="member-side" aria-label="Member summary">` +
    v2.top +
    (m.txns.length >= MEMBER_PROFILE_MIN_TRADES ? tradingProfileHtml(m, stamps, deps.chamber ?? null) : "") +
    v2.sectors +
    signals +
    `</aside>` +
    `</div>` +
    memberHistoryHtml(m) +
    memberPaperBlock(m) +
    v2.context
  );
}

/** "1 filing", "3 filings": a count and its noun, agreeing. */
function countOf(n: number, one: string, many: string): string {
  return `${fmtInt(n)} ${n === 1 ? one : many}`;
}

/** The member's own reporting window: the span of filing dates across its
    machine-readable rows and its paper filings, never the site's publish date. */
function filedWindow(m: { txns: readonly { filed: string }[]; paper: readonly { filed: string }[] }): string {
  const dates = [...m.txns.map((r) => r.filed), ...m.paper.map((p) => p.filed)].filter((d) => !!d).sort();
  if (dates.length === 0) return "No filings on record";
  const first = dates[0]!, last = dates[dates.length - 1]!;
  return first === last ? `Filed ${first}` : `Filed ${first} → ${last}`;
}

/** The Signals cell the /e/ route renders when the server join is not
    available: a stated empty state, like the page's own no-signals line. */
const MEMBER_SIGNALS_UNJOINED =
  `<section class="panel member-side-sec" aria-label="Signals" data-empty-state><div class="panel-head"><h2 class="section-h">Signals</h2></div>` +
  `<p class="section-note">Signals are joined on the server; this view carries none. <a href="/signals/">Every rule, with its definition →</a></p></section>`;

/** R23 / LD24: the compact layout for a member with three or fewer trades —
    one card per trade (none for a paper-only member, whose paper filings are
    counted and linked below), then three COMPUTED facts: committees with
    Chair, committee overlap as of each trade date, and signals in the window.
    No fact is hard-coded: "None" is printed only where it was computed. */
export function memberCompactHtml(m: MemberEntity, ctx: RenderCtx, deps: MemberV2Deps): string {
  const n = m.txns.length;
  const title = n === 0 ? "No trades on record" : n === 1 ? "The one trade on record" : `The ${fmtInt(n)} trades on record`;
  const cards = m.txns
    .map((r) => {
      const sd = sideLabel(r.side, r.flags);
      const edge = txnEdge(r);
      return (
        `<li class="one-r"${edge ? ` data-edge="${edge}"` : ""}>` +
        `<span class="one-side c-kind ${sd.cls}">${esc(sd.text)}</span>` +
        `<div class="one-what">` +
        `<div class="one-l1"><span class="one-tk">${r.ticker ? `<a href="${tickerHrefFor(r.ticker, ctx)}">${esc(r.ticker)}</a>` : "—"}</span>` +
        `<span class="one-iss">${assetLineHtml(r, { notes: { scope: "member-asset" } })} <span class="asset-sep">·</span> <span class="owner-note">${esc(ownerWords(r))}</span></span></div>` +
        `<div class="one-l2"><span class="one-amt c-num">${esc(amountText(r))}</span>${flagTags(r.flags, r)}<span class="one-dates">${dualDate(r, true)}</span></div>` +
        `</div>` +
        `<span class="one-src c-src">${srcLink(r.doc)}</span>` +
        `</li>`
      );
    })
    .join("");
  const body =
    n === 0
      ? `<p class="section-note member-paper-only">No machine-readable trade on record: ${countOf(m.paper.length, "paper filing is", "paper filings are")} counted below, not machine-read until OCR.</p>`
      : `<ol class="one-trades">${cards}</ol>`;
  return (
    `<section class="panel panel-wide member-compact" aria-labelledby="compact-h" data-member-layout="compact">` +
    `<div class="panel-head"><h2 id="compact-h" class="section-h">${esc(title)}</h2><span class="panel-note">${esc(filedWindow(m))}</span></div>` +
    body +
    `<dl class="member-facts">` +
    `<div><dt>Committees</dt><dd>${compactCommitteesFact(deps)}</dd></div>` +
    `<div><dt>Committee overlap</dt><dd>${compactOverlapFact(m, deps)}</dd></div>` +
    `<div><dt>Signals</dt><dd>${compactSignalsFact(deps.signals ?? null)}</dd></div>` +
    `</dl>` +
    `</section>`
  );
}

function compactCommitteesFact(deps: MemberV2Deps): string {
  if (deps.committees === null) return "Committee data is not in this build.";
  const now = membershipAsOf(
    { memberships: deps.committees.memberships, windowFrom: deps.committees.windowFrom, windowTo: deps.committees.windowTo },
    deps.committees.snapshotDate,
  );
  if (now === null) return "Not known for the snapshot date.";
  if (now.length === 0) return `None on record <span class="fact-dim">(snapshot ${esc(deps.committees.snapshotDate)})</span>`;
  return now.map((c) => `${esc(c.name)}${isChairRole(c.role) ? " (Chair)" : ""}`).join(" · ");
}

/** "Committee overlap" as of each trade date (LD24): "None" only when every
    trade could be checked — dated inside the snapshot, a ticker with a
    sector — and every committee is mapped; an unmapped committee reads "not
    checked"; each hit is context, never an allegation. */
function compactOverlapFact(m: MemberEntity, deps: MemberV2Deps): string {
  if (deps.committees === null) return "Not checked: committee data is not in this build.";
  if (deps.resolveSector === null) return "Not checked: sector data is not in this build.";
  if (m.txns.length === 0) return "No trades to check.";
  const resolve = deps.resolveSector;
  const snapshot: MembershipSnapshot = { memberships: deps.committees.memberships, windowFrom: deps.committees.windowFrom, windowTo: deps.committees.windowTo };
  const overlap = jurisdictionOverlap(m.txns, snapshot, deps.committees.jurisdictionByCommittee, resolve);
  const dated = excludeDateAnomalies(m.txns).rows;
  const anomalies = m.txns.length - dated.length;
  const noSector = dated.filter((t) => !t.ticker || resolve(t.ticker).state !== "sector").length;
  const unchecked: string[] = [];
  if (overlap.coverageUnknown > 0)
    unchecked.push(`${countOf(overlap.coverageUnknown, "trade", "trades")} on unmapped committees (${overlap.unmappedCommittees.map(esc).join(", ")}): not checked`);
  if (overlap.undatable > 0) unchecked.push(`${countOf(overlap.undatable, "trade predates", "trades predate")} the membership snapshot: not checked`);
  if (noSector > 0) unchecked.push(`${countOf(noSector, "trade has", "trades have")} no issuer sector: not checked`);
  if (anomalies > 0) unchecked.push(`${countOf(anomalies, "trade has", "trades have")} an impossible date: not checked`);
  const hits = overlap.rows.map(
    (r) =>
      `${r.txn.ticker ? esc(r.txn.ticker) : "—"} (${esc(sectorLabel(r.sector))}) · ${r.committees.map((c) => esc(c.name)).join(", ")}, as of ${esc(r.txn.traded ?? "—")} <span class="fact-dim">— context, not an allegation</span>`,
  );
  if (hits.length > 0) return hits.join("<br>") + (unchecked.length ? `<br><span class="fact-dim">${unchecked.join(" · ")}.</span>` : "");
  if (unchecked.length > 0) return `Not checked for every trade. <span class="fact-dim">${unchecked.join(" · ")}.</span>`;
  return `None. <span class="fact-dim">No trade falls inside a committee they sat on as of its trade date.</span>`;
}

/** "Signals" (LD24): the member's ACTIVE signals of any kind, s1–s6; "None
    in the last N days" only when that was computed. */
function compactSignalsFact(sig: MemberSignalsSummary | null): string {
  if (sig === null) return "Signals are joined on the server; this view carries none.";
  if (sig.active.length === 0) return `None <span class="fact-dim">in the last ${fmtInt(sig.retentionDays)} days.</span>`;
  return (
    sig.active.map((s) => `${esc(s.label)}${s.ticker ? ` · <span class="mono-ticker">${esc(s.ticker)}</span>` : ""}`).join("<br>") +
    ` <a href="/signals/">All signals →</a>`
  );
}

/** The member's Filing history (R26): only with two or more filings; the
    first 12 in the DOM, the rest held in the island (rule 8). */
function memberHistoryHtml(m: MemberEntity): string {
  const filings = memberFilings(m);
  if (filings.length < MEMBER_HISTORY_MIN_FILINGS) return "";
  const historyN = MEMBER_HISTORY_COMPACT_ROWS;
  const shown = Math.min(historyN, filings.length);
  const collapsed = filings.length > historyN;
  const parts = heldTableParts<MemberHistoryRowIn, null>({
    rootId: "member-history-tbody",
    render: MEMBER_HISTORY_ROWS,
    rowFn: memberHistoryRowHtml,
    rows: filings,
    shown,
    shared: null,
  });
  /* member-14: the meta line is cut; the identity date takes the slack */
  return (
    `<section class="panel design-member-history" aria-label="Filing history"><div class="panel-head"><h2 class="section-h">Filing history</h2></div>` +
    `<div class="table-scroll"><table class="etable" role="table" data-card="generic"><caption class="visually-hidden">Filing history</caption>` +
    /* the heads through thHtml (launch final pass): each states its
       data-label, which withTableRoles / rolesFor copy onto the Rows cell, so
       a phone card labels its number instead of printing it bare */
    `<thead role="rowgroup"><tr role="row">` +
    thHtml({ label: "Filed", cls: "c-flex", attrs: ' role="columnheader"' }) +
    thHtml({ label: "Rows", cls: "c-num", attrs: ' role="columnheader"' }) +
    thHtml({ label: "Receipt", cls: "c-src", attrs: ' role="columnheader"' }) +
    `</tr></thead>` +
    `<tbody id="member-history-tbody" role="rowgroup"${collapsed ? ' data-collapsed="true" data-held="json"' : ""}>${parts.bodyRows}</tbody></table></div>` +
    parts.island +
    compactDisclosure({ rootId: "member-history-tbody", total: filings.length, shown, noun: "filings", domBacked: true }) +
    `</section>`
  );
}

/* ---------- deep congressional ticker body ---------- */

export function congressTickerBody(t: TickerEntity, stamps: BuildStamps, ctx: RenderCtx): string {
  const flow = quarterlyFlow(t.txns, stamps.generatedAtDate, 8);
  const disclosing = membersDisclosing(t.txns, stamps.generatedAtDate, 12, 7);
  const everMembers = new Set(t.txns.map((r) => r.bioguide ?? `raw:${r.name}`)).size;
  const flow12 = sumRanges(
    excludeDateAnomalies(t.txns).rows.filter(
      (r) =>
        windowMembership(
          r,
          legacyTrailingMonthsBounds(stamps.generatedAtDate, 12),
          "traded_or_filed",
        ) === "in",
    ),
  );
  const latestFiled = t.txns[0]?.filed ?? null;
  /* DESIGN-POLISH M2 (R15): the header's figures through the ONE ledger. */
  const ledger = disclosureLedger(
    [
      { label: "Members · ever", value: fmtInt(everMembers), detail: "" },
      { label: "Transactions", value: fmtInt(t.txns.length), detail: "" },
      {
        label: "Disclosed flow · 12m",
        value: flow12.kind === "empty" ? "—" : sumRangesText(flow12),
        detail: "an interval",
        subKind: "qualifier",
        noteHtml: esc("sum of statutory bucket bounds over the trailing 12 months — an interval, not an estimate of value"),
      },
      { label: "Latest filing", value: latestFiled ? latestFiled.slice(5) : "—", detail: latestFiled ?? "", subKind: "date" },
    ],
    { scope: "ticker-ledger", label: "Ticker disclosure statistics" },
  );
  const memberRows = disclosing
    .map(
      (m) =>
        `<tr><td class="c-member c-flex">${
          m.bioguide
            ? `<a href="${memberHrefFor(m.bioguide, ctx)}">${esc(m.name)}</a>`
            : esc(m.name)
        } <span class="aff ${partyClass(m.party)}">${esc(affTextOf(m))}</span></td>` +
        `<td class="c-num c-buy">${fmtInt(m.buys)}</td>` +
        `<td class="c-num c-sell">${fmtInt(m.sells)}</td>` +
        `<td class="c-num">${flowCellHtml(m.flow)}</td></tr>`,
    )
    .join("\n");
  return (
    breadcrumb([
      { text: "/congress", href: "/congress/" },
      { text: "tickers" },
      { text: t.ticker },
    ]) +
    `<header class="entity-head">` +
    `<div class="entity-head-copy">` +
    `<h1 class="entity-title"><span class="mono-ticker">${esc(t.ticker)}</span></h1>` +
    `<p class="entity-lede">Congressional disclosures mentioning this ticker. This page reports what members <em>filed</em>, on the STOCK Act's 45-day clock — it says nothing about ${esc(
      t.ticker,
    )} itself, and disclosed ranges cannot be netted into a position.${
      /* R2: the holders link renders ONLY when that page was built for this
         ticker (ctx.holdersPage). An unconditional link was a dressed 404 on
         every ticker whose issuer the 13F side could not resolve. */
      ctx.holdersPage
        ? ` <a href="/institutional/tickers/${esc(encodeURIComponent(t.ticker))}/holders/">13F institutional holders of ${esc(t.ticker)} ↗</a>`
        : ""
    }</p>` +
    `</div>` +
    ledger +
    `</header>` +
    `<div class="entity-grid">` +
    `<section class="panel" aria-labelledby="flow2-h">` +
    `<div class="panel-head"><h2 id="flow2-h" class="section-h">Disclosed flow by quarter, both sides</h2>` +
    `<span class="panel-note">bar = [min, max] bucket sums · purchases above axis, sales below</span></div>` +
    flowRibbon(flow, { twoSided: true, sourceLine: "source: House Clerk + Senate eFD", asOf: stamps.generatedAtDate }) +
    `</section>` +
    `<section class="panel" aria-labelledby="md-h">` +
    `<div class="panel-head"><h2 id="md-h" class="section-h">Members disclosing ${esc(t.ticker)}</h2><span class="panel-note">trailing 12m</span></div>` +
    (disclosing.length === 0
      ? `<p class="section-note">No members disclosed ${esc(t.ticker)} in the trailing 12 months.</p>`
      : `<div class="table-scroll"><table class="etable etable-compact"><caption class="visually-hidden">Members disclosing ${esc(
          t.ticker,
        )}, trailing 12 months</caption>` +
        `<thead><tr><th scope="col" class="c-member c-flex">Member</th><th scope="col" class="c-num">Buys</th><th scope="col" class="c-num">Sales</th><th scope="col" class="c-num">Flow range</th></tr></thead>` +
        `<tbody>${memberRows}</tbody></table></div>`) +
    cardFoot({ short: "Counts of filed transactions", full: "Counts are filed transactions, not net positions; disclosed ranges cannot be netted into a position.", scope: "ticker-members-foot", key: "counts" }) +
    `</section>` +
    `</div>` +
    `<section class="panel panel-wide" aria-labelledby="recent-h">` +
    `<div class="panel-head"><h2 id="recent-h" class="section-h">Recent ${esc(t.ticker)} disclosures</h2>` +
    `<span class="panel-note">${countOf(t.txns.length, "row", "rows")} · filed date desc · ${asOfNote(stamps)}</span></div>` +
    entityTxnTable(t.txns, {
      kind: "ticker",
      caption: `Congressional disclosures mentioning ${t.ticker}`,
      page: 0,
      ctx,
    }) +
    `</section>`
  );
}

/* ================================================================================
   C-3 — Member page v2 (ALPHA-UX): net disclosed flow by ticker (interval
   subtraction), sector mix, largest recent disclosures, and committee
   jurisdiction-overlap context. Build-time sections appended by the member
   PAGE; the /e/ budget-cut fallback keeps the v1 body (its data endpoint does
   not carry the B-5/B-6 context).
   ============================================================================ */

export interface MemberV2Deps {
  /** null → sector data not in this build (honest absence) */
  resolveSector: ((ticker: string) => SectorResolution) | null;
  sectorMeta: { taxonomyVersion: string; asOf: string } | null;
  /** null → committee data not in this build */
  committees: {
    memberships: CommitteeMembership[];
    /** snapshot-WIDE validity bounds */
    windowFrom: string;
    windowTo: string;
    jurisdictionByCommittee: ReadonlyMap<string, readonly string[]>;
    mappingVersion: string;
    snapshotDate: string;
  } | null;
  /** the chamber's per-member medians the trading profile is compared against;
      null → "no median benchmark" (the generic /e/ route, older callers) */
  chamber?: ChamberBenchmark | null;
  /** the member's active signals (kinds s1–s6) for the compact layout's
      Signals fact; null/absent → stated as not joined in this view */
  signals?: MemberSignalsSummary | null;
}

/** The S-5 caveat. NON-REMOVABLE: rendered beside every overlap row set, and
    pinned by test. It asserts the absence of any allegation. */
export const NON_ALLEGATION_CAVEAT =
  "A jurisdiction overlap is context, not an accusation: it establishes and implies no legal, " +
  "ethical, or causal conflict. It states only that the issuer's sector falls within a committee " +
  "this member sat on as of the trade date, per the sources and mapping versions shown.";

function absentPanel(title: string, detail: string): string {
  return (
    `<section class="panel" aria-label="${esc(title)}">` +
    `<div class="panel-head"><h2 class="section-h">${esc(title)}</h2></div>` +
    `<p class="section-note">${esc(detail)}</p></section>`
  );
}

/* The `§` clause for the member net-flow table, taken
   from the same `RANKING_FOOTNOTES` registry whose rendered block was deleted. Scope is
   the table, key is the column — both stable, neither derived from a counter. */
function memberFlowNoteHtml(): string | null {
  return RANKING_FOOTNOTES_LIST.find((f) => f.mark === "§")?.html ?? null;
}

/* ---------- the trading profile (side column, ten or more trades) ---------- */

/** Five per-member statistics on a 0–100 track with the chamber's per-member
    MEDIAN as a tick. Every number is computed from this member's rows; the
    median is over the chamber's members (one observation each), supplied by
    the page or null for callers without the corpus. member-07/08/09: the caps
    meta and the medians paragraph become one header tip, the labels shorten
    (each keeps its definition note), and the summary line keeps only the
    figure the ledger and bars do not already state. */
function tradingProfileHtml(m: MemberEntityT, stamps: BuildStamps, bench: ChamberBenchmark | null): string {
  const st = memberProfileStats(m.txns);
  const chamberWord = m.chamber === "senate" ? "Senate" : "House";
  type Metric = { label: string; value: number | null; text: string; scale: number; median: number | null; medText: (v: number) => string; compare: ((v: number, med: number) => string) | null; title: string };
  const pct = (v: number | null): string => (v == null ? "—" : `${Math.round(v * 100)}%`);
  const metrics: Metric[] = [
    {
      label: "Median lag", value: st.medianLag, text: st.medianLag == null ? "—" : `+${fmtInt(st.medianLag)}d`, scale: 112,
      median: bench?.medianLag ?? null, medText: (v) => `median +${fmtInt(v)}d`,
      compare: (v, med) => (v < med ? "faster than chamber" : v > med ? "slower than chamber" : "at chamber median"),
      title: "median days between trade date and filing date, over rows that disclose both",
    },
    {
      label: "Rows per filing", value: st.rowsPerFiling, text: st.rowsPerFiling == null ? "—" : st.rowsPerFiling >= 10 ? fmtInt(Math.round(st.rowsPerFiling)) : st.rowsPerFiling.toFixed(1), scale: 100,
      median: bench?.rowsPerFiling ?? null, medText: (v) => `median ${v >= 10 ? fmtInt(Math.round(v)) : v.toFixed(1)}`,
      compare: (v, med) => (v > med * 3 ? "far above median" : v > med ? "above median" : v < med ? "below median" : "at median"),
      title: "machine-readable transaction rows per distinct source filing",
    },
    {
      label: "≤$15K share", value: st.shareSmallBracket == null ? null : st.shareSmallBracket * 100, text: pct(st.shareSmallBracket), scale: 100,
      median: bench?.shareSmallBracket == null ? null : bench.shareSmallBracket * 100, medText: (v) => `median ${Math.round(v)}%`,
      compare: (v, med) => (v > med ? "small-lot profile" : v < med ? "larger lots" : "at median"),
      title: "rows whose disclosed bracket tops out at $15,000",
    },
    {
      label: "Buy share", value: st.buyShare == null ? null : st.buyShare * 100, text: pct(st.buyShare), scale: 100,
      median: bench?.buyShare == null ? null : bench.buyShare * 100, medText: (v) => `median ${Math.round(v)}%`,
      compare: (v, med) => (Math.abs(v - med) < 5 ? "≈ chamber" : v > med ? "above median" : "below median"),
      title: "purchases as a share of all disclosed rows — a count of disclosures, not of dollars",
    },
    {
      label: "Self-owned", value: st.selfOwnedShare == null ? null : st.selfOwnedShare * 100, text: pct(st.selfOwnedShare), scale: 100,
      median: bench?.selfOwnedShare == null ? null : bench.selfOwnedShare * 100, medText: (v) => `median ${Math.round(v)}%`,
      compare: (v, med) => (v < med ? "family accounts" : v > med ? "mostly self-owned" : "at median"),
      title: "rows with no spouse (SP), dependent-child (DC) or joint (JT) owner code",
    },
  ];
  const row = (x: Metric): string => {
    const w = x.value == null ? null : Math.max(0, Math.min(100, (x.value / x.scale) * 100));
    const tick = x.median == null ? null : Math.max(0, Math.min(100, (x.median / x.scale) * 100));
    const cmp = x.value != null && x.median != null && x.compare ? x.compare(x.value, x.median) : x.median != null ? x.medText(x.median) : "";
    const cls = x.value != null && x.median != null ? (x.value > x.median ? " book-above" : x.value < x.median ? " book-below" : "") : "";
    return `<div class="book-metric"><dt>${note(x.title, { scope: "member-tiles" }, x.label, { trigger: "label", textHtml: esc(x.label) })}</dt><dd>` +
      `<span class="book-track" aria-hidden="true">${tick == null ? "" : `<i class="book-median" style="left:${tick.toFixed(1)}%"></i>`}${w == null ? "" : `<span style="width:${w.toFixed(1)}%"></span>`}</span>` +
      `<span>${esc(x.text)}</span><span class="book-compare${cls}">${esc(cmp)}${x.median != null && cmp !== x.medText(x.median) ? `<span class="visually-hidden"> — ${esc(x.medText(x.median))}</span>` : ""}</span></dd></div>`;
  };
  /* member-09: the one figure no other part of the page states */
  const gross = memberStatTiles(m, stamps).find((t) => t.label === "disclosed flow · trailing 12m")!;
  const head = bench
    ? note(
        `Tick = median of the ${fmtInt(bench.members)} ${chamberWord} members with disclosed rows in this build, one value per member, so a high-volume filer does not become the chamber. Describes the filing record, not intent.`,
        { scope: "member-profile" },
        "medians",
        { trigger: "label", textHtml: `vs ${chamberWord} median`, name: `vs ${chamberWord} median` },
      )
    : "no median benchmark";
  return (
    `<section class="panel member-side-sec design-trading-profile" aria-label="Profile">` +
    `<div class="panel-head"><h2 class="section-h">Profile</h2>` +
    `<span class="panel-note">${head}</span></div>` +
    `<dl>${metrics.map(row).join("")}</dl>` +
    `<p class="section-note book-source">${note(gross.title!, { scope: "member-tiles" }, gross.label, { trigger: "label", textHtml: "Gross flow · 12m" })}: ${esc(gross.value)}</p>` +
    `</section>`
  );
}

/** Rows each Top tickers window shows before its "Show all N tickers"
    (R26: 8 per window); the rest are held in the island (rule 8), so no row
    is unreachable (DV19). */
export const MEMBER_FLOW_COMPACT_ROWS = 8;
/** Filings the member's Filing history shows before its Show-all (E: 12, fixed). */
export const MEMBER_HISTORY_COMPACT_ROWS = 12;

/* ---------- held-row functions (pagination-and-counts.md rule 8, LD26) ----------

   Each is the ONE row function of its table: the server renders the first N
   rows through it and the client binder (`registerHeldRows` +
   `initDomDisclosures`) renders the held rows through it from the island. It
   reads nothing but its arguments — no closure over the build, no ctx — so
   the island can carry every input and the two sides are byte-identical. */

/** The registered name of the member net-by-ticker row function. */
export const MEMBER_NET_ROWS = "member-net";
/** The registered name of the member filing-history row function. */
export const MEMBER_HISTORY_ROWS = "member-history";

/** One net-by-ticker row as the island carries it: every input the row
    function reads, the neighbour-derived `overlapsPrev` and the build-derived
    `cut` (a budget-cut ticker links to `/e/`, `format.ts` `tickerHrefFor`)
    included. `sep` marks the separator row that introduces the
    wholly-undisclosed bucket (its value is the bucket's ticker count). */
export interface MemberNetRowIn {
  sep?: number;
  ticker: string;
  cut: boolean;
  purchases: SumRanges;
  sales: SumRanges;
  buys: number;
  sells: number;
  net: NetInterval;
  overlapsPrev: boolean;
}
/** The net-by-ticker table's table-wide inputs: the diverging bar's scale
    (the largest provable minimum on either side over EVERY row of the
    window) and the column count the separator row spans. */
export interface MemberNetShared {
  scale: number;
  cols: number;
}

const lowerOf = (sum: SumRanges): number => (sum.kind === "closed" || sum.kind === "open" ? sum.low : 0);

/** A Top tickers row (R26): Ticker · Buy ◂ ▸ sell bar · buys·sells · Net —
    net flows, not holdings, in the live interval grammar (≥ only when
    one-signed, ≈ when it overlaps the row above). */
export function memberNetRowHtml(r: MemberNetRowIn, _index: number, s: MemberNetShared): string {
  if (r.sep !== undefined) {
    return `<tr class="unranked-sep" role="row"><td colspan="${s.cols}" role="cell">${fmtInt(r.sep)} tickers carry a wholly-undisclosed side — no endpoints, listed last, never zero</td></tr>`;
  }
  const nk = netKindWord(r.net);
  /* The row's kind edge follows its net direction; a bounded range that
     spans zero (FLAT) and a range with no statable direction ("—") take the
     neutral flat edge. */
  const edge = nk.word === "NET BUY" ? "netbuy" : nk.word === "NET SELL" ? "netsell" : "flat";
  const href = tickerHrefFor(r.ticker, r.cut ? { cutTickers: new Set([r.ticker]) } : {});
  return `<tr class="design-net-row" data-edge="${edge}" role="row">` +
    `<td class="c-ticker c-flex" role="cell"><a href="${href}">${esc(r.ticker)}</a><span class="visually-hidden"> ${esc(nk.word)}${nk.why ? ` ${esc(nk.why)}` : ""}</span></td>` +
    `<td class="c-bar" role="cell"><span class="design-diverging" aria-hidden="true"><span style="right:50%;width:${(lowerOf(r.purchases) / s.scale * 50).toFixed(1)}%"></span><span class="sale" style="left:50%;width:${(lowerOf(r.sales) / s.scale * 50).toFixed(1)}%"></span></span><span class="visually-hidden">Purchases ${flowCellHtml(r.purchases)}; sales ${flowCellHtml(r.sales)}</span></td>` +
    `<td class="c-num c-bs" role="cell"><span class="c-buy">${fmtInt(r.buys)}</span>·<span class="c-sell">${fmtInt(r.sells)}</span></td>` +
    `<td class="c-num c-net has-marks ${nk.word === "NET BUY" ? "c-buy" : nk.word === "NET SELL" ? "c-sell" : "c-muted"}" role="cell">${netCellHtml(r.net, r.overlapsPrev)}</td></tr>`;
}

/** One filing-history row as the island carries it. */
export interface MemberHistoryRowIn {
  filed: string;
  doc: string;
  count: number;
}

export function memberHistoryRowHtml(row: MemberHistoryRowIn, _index = 0, _shared: unknown = null): string {
  return (
    `<tr role="row"><td class="c-flex" role="cell">${esc(row.filed)}</td>` +
    `<td class="c-num" role="cell">${fmtInt(row.count)}</td><td class="c-src" role="cell">${srcLink(row.doc)}</td></tr>`
  );
}

export function memberV2Sections(
  m: MemberEntityT,
  stamps: BuildStamps,
  ctx: RenderCtx,
  deps: MemberV2Deps,
): string {
  const parts = memberV2Parts(m, stamps, ctx, deps);
  return parts.top + parts.sectors + parts.context;
}

/** One Top tickers window: the member's net flow per ticker over `rows`,
    ranked (undisclosed bucket last, with its separator), the first 8 in the
    DOM and the rest in the island. */
function topTickersTable(rows: readonly TxnRow[], ctx: RenderCtx, rootId: string, label: string, emptyLine: string): string {
  const { rows: netRows } = memberNetByTicker(rows);
  if (netRows.length === 0) return `<p class="section-note">${esc(emptyLine)}</p>`;
  const { ranked, undisclosedBucket } = rankNetRows(netRows, (r) => r.net, (r) => r.ticker);
  const scale = Math.max(1, ...netRows.flatMap((row) => [lowerOf(row.purchases), lowerOf(row.sales)]));
  const cutOf = (ticker: string): boolean => ctx.cutTickers?.has(ticker) === true;
  /* LD26 / rule 8: every input the row function reads, per row — the
     overlaps-the-row-above flag and the budget-cut flag are decided HERE, on
     the server, and travel with the row, so held rows render byte-identically. */
  const input = (r: (typeof netRows)[number], overlapsPrev: boolean): MemberNetRowIn => ({
    ticker: r.ticker, cut: cutOf(r.ticker), purchases: r.purchases, sales: r.sales,
    buys: r.buys, sells: r.sells, net: r.net, overlapsPrev,
  });
  const heads = [
    thHtml({ label: "Ticker", cls: "c-ticker c-flex" }),
    thHtml({ label: "Buy ◂ ▸ sell", cls: "c-bar", noteHtml: memberFlowNoteHtml(), notes: { scope: `${rootId}-h` }, noteKey: "gross" }),
    thHtml({ label: "B·S", cls: "c-num" }),
    thHtml({ label: "Net", mark: "·§", cls: "c-num", noteHtml: memberFlowNoteHtml(), notes: { scope: `${rootId}-h` }, noteKey: "net" }),
  ];
  const all: MemberNetRowIn[] = [
    ...ranked.map((r, i) => input(r, i > 0 ? netOverlaps(r.net, ranked[i - 1]!.net) === true : false)),
    ...(undisclosedBucket.length > 0
      ? [{ ...input(undisclosedBucket[0]!, false), sep: undisclosedBucket.length }, ...undisclosedBucket.map((r) => input(r, false))]
      : []),
  ];
  const tickers = ranked.length + undisclosedBucket.length;
  const n = MEMBER_FLOW_COMPACT_ROWS;
  const shownTickers = Math.min(n, tickers);
  /* the separator sits in the row list but is not a ticker: the DOM slice is
     the first `shownTickers` tickers plus the separator when it falls inside */
  const domRows = shownTickers + (undisclosedBucket.length > 0 && ranked.length < shownTickers ? 1 : 0);
  const parts = heldTableParts<MemberNetRowIn, MemberNetShared>({
    rootId, render: MEMBER_NET_ROWS, rowFn: memberNetRowHtml, rows: all, shown: domRows, shared: { scale, cols: heads.length },
  });
  const collapsed = tickers > n;
  /* The undisclosed bucket's statement is TRUE in both states, so when its
     separator sits past the compact slice the disclosure states it. */
  const bucketBeyond = undisclosedBucket.length > 0 && ranked.length >= n
    ? `${fmtInt(undisclosedBucket.length)} tickers carry a wholly-undisclosed side and are listed last, never as zero.`
    : undefined;
  return (
    `<div class="table-scroll"><table class="etable etable-compact member-top" role="table" data-card="generic">` +
    `<caption class="visually-hidden">${esc(label)}</caption>` +
    `<thead role="rowgroup"><tr role="row">${heads.join("")}</tr></thead>` +
    `<tbody id="${rootId}" role="rowgroup"${collapsed ? ' data-collapsed="true" data-held="json"' : ""}>${parts.bodyRows}</tbody></table></div>` +
    parts.island +
    compactDisclosure({ rootId, total: tickers, shown: shownTickers, noun: "tickers", domBacked: true, ...(bucketBeyond ? { bound: esc(bucketBeyond) } : {}) })
  );
}

/** The member's side-column and context pieces, placed by `memberBody`:
    Top tickers (two windows), Sectors, and the collapsed committee context
    at the page foot. `memberV2Sections` returns all three, in order. */
function memberV2Parts(
  m: MemberEntityT,
  stamps: BuildStamps,
  ctx: RenderCtx,
  deps: MemberV2Deps,
): { top: string; sectors: string; context: string } {
  /* --- Top tickers: net disclosed flow by ticker (F-10: flows, never holdings) --- */
  const { noTickerRows } = memberNetByTicker(m.txns);
  const rows24 = excludeDateAnomalies(m.txns).rows.filter(
    (t) => windowMembership(t, legacyTrailingMonthsBounds(stamps.generatedAtDate, 24), "traded_or_filed") === "in",
  );
  /* member-05: "flows, not holdings" stays visible once; what the table is
     not, and the rows outside it, go in its note */
  const netFootNote =
    `PTRs are flows, not holdings — this table nets disclosed flow intervals per ticker; it is NOT a portfolio ` +
    `and cannot become one without the member's annual FD report` +
    (noTickerRows > 0 ? ` · ${fmtInt(noTickerRows)} rows disclose no ticker and are outside this table` : "");
  const top =
    `<section class="panel member-side-sec member-top-tickers" aria-label="Top tickers">` +
    `<div class="panel-head"><h2 class="section-h">Top tickers</h2>` +
    `<span class="panel-note"><span class="src-derived">` +
    note(netFootNote, { scope: "member-netflow" }, "scope", { trigger: "label", textHtml: "flows, not holdings&nbsp;·§", name: "flows, not holdings" }) +
    `</span></span>` +
    `<div class="seg member-top-window" role="group" aria-label="Window" data-top-window hidden>` +
    `<button type="button" data-window="24m" aria-pressed="true">24 months</button><button type="button" data-window="all" aria-pressed="false">All</button>` +
    `</div></div>` +
    `<div data-top-variant="24m">${topTickersTable(rows24, ctx, "member-top-24m-tbody", `Net disclosed flow by ticker for ${m.name}, last 24 months`, "No ticker-keyed trades in the last 24 months.")}</div>` +
    `<div data-top-variant="all" hidden>${topTickersTable(m.txns, ctx, "member-top-all-tbody", `Net disclosed flow by ticker for ${m.name}, all history`, "No ticker-keyed disclosures on record.")}</div>` +
    `</section>`;

  /* --- sectors (B-5): only with two or more sectors; absence of the dataset is stated --- */
  let sectors = "";
  if (deps.resolveSector === null || deps.sectorMeta === null) {
    sectors = unavailableDesignPanel("Sector rotation", "NET DISCLOSED FLOW", ["Sector", "Flow range", "Rows"], "Sector data is not in this build. The issuer-SIC join is required to calculate these rows.");
  } else {
    const mix = sectorMix(m.txns, deps.resolveSector);
    const real = mix.filter((r) => !r.bucket);
    if (real.length >= MEMBER_SECTORS_MIN) {
      const max = Math.max(1, ...real.map((r) => r.txns));
      const noTicker = mix.find((r) => r.bucket && r.key === "no ticker disclosed")?.txns ?? 0;
      const unmatched = mix.filter((r) => r.bucket && r.key !== "no ticker disclosed").reduce((a, r) => a + r.txns, 0);
      const gap = noTicker + unmatched;
      sectors =
        `<section class="panel member-side-sec member-sectors" aria-label="Sectors">` +
        `<div class="panel-head"><h2 class="section-h">Sectors</h2>` +
        `<span class="panel-note">` +
        note(
          `Sector from SEC SIC codes (as of ${deps.sectorMeta.asOf}) via the site's taxonomy v${deps.sectorMeta.taxonomyVersion}. Rows without a sector are shown as coverage, never folded in.`,
          { scope: "member-sectors" },
          "sector",
          { trigger: "label", textHtml: "trades by issuer sector", name: "trades by issuer sector" },
        ) +
        `</span></div>` +
        `<div class="table-scroll"><table class="etable etable-compact" role="table" data-card="generic"><caption class="visually-hidden">Trades by issuer sector</caption>` +
        `<thead role="rowgroup"><tr role="row">${thHtml({ label: "Sector", cls: "c-flex" })}<th scope="col" class="c-bar" role="columnheader"><span class="visually-hidden">Share</span></th>${thHtml({ label: "Trades", cls: "c-num" })}</tr></thead>` +
        `<tbody role="rowgroup">${real
          .map(
            (r) =>
              `<tr role="row"><td class="c-flex" role="cell">${esc(sectorLabel(r.key))}</td>` +
              `<td class="c-bar" role="cell"><span class="sx-bar" aria-hidden="true"><i style="width:${((r.txns / max) * 100).toFixed(1)}%"></i></span></td>` +
              `<td class="c-num" role="cell">${fmtInt(r.txns)}</td></tr>`,
          )
          .join("\n")}</tbody></table></div>` +
        (gap > 0
          ? `<p class="section-note sx-gap">${fmtInt(gap)} more without a sector: ${fmtInt(noTicker)} no ticker, ${fmtInt(unmatched)} unmatched</p>`
          : "") +
        `</section>`;
    }
  }

  /* --- largest recent disclosures (F-12: rank by lower bound), member-19 --- */
  const recent = notableRecent(m.txns, stamps.generatedAtDate, 90, 5);
  const recentRows = recent.rows
    .map(
      (r) =>
        `<tr${txnEdge(r) ? ` data-edge="${txnEdge(r)}"` : ""} role="row"><td class="c-filed c-num has-marks" role="cell">${esc(r.filed)}</td>` +
        `<td class="c-ticker c-flex" role="cell">${r.ticker ? `<a href="${tickerHrefFor(r.ticker, ctx)}">${esc(r.ticker)}</a>` : assetNameCell(r, { scope: "member-recent-asset" })}</td>` +
        `<td class="c-side c-kind ${sideLabel(r.side, r.flags).cls}" role="cell">${esc(sideLabel(r.side, r.flags).text)}</td>` +
        `<td class="c-num" role="cell">${esc(amountText(r))}</td>` +
        `<td class="c-src" role="cell">${srcLink(r.doc)}</td></tr>`,
    )
    .join("\n");
  const recentPanel =
    recent.rows.length === 0
      ? `<p class="section-note">None in the last 90 days${recent.unrankable > 0 ? ` (${fmtInt(recent.unrankable)} rows disclose no lower bound)` : ""}.</p>`
      : `<div class="table-scroll"><table class="etable etable-compact" role="table" data-card="generic">` +
        `<caption class="visually-hidden">Largest recent disclosures for ${esc(m.name)}</caption>` +
        `<thead role="rowgroup"><tr role="row">${thHtml({ label: "Filed", cls: "c-num", order: "descending" })}<th scope="col" class="c-ticker c-flex" role="columnheader">Asset</th><th scope="col" class="c-kind" role="columnheader">Side</th><th scope="col" class="c-num" role="columnheader">Amount</th><th scope="col" class="c-src" role="columnheader">Src</th></tr></thead>` +
        `<tbody role="rowgroup">${recentRows}</tbody></table></div>` +
        (recent.unrankable > 0 ? `<p class="section-note">${fmtInt(recent.unrankable)} rows with no lower bound cannot rank.</p>` : "");

  /* --- committee jurisdiction overlap (B-6 / S-5), member-19/20 --- */
  let committeePanel: string;
  if (deps.committees === null) {
    committeePanel = absentPanel(
      "Committees",
      "Committee membership data is not in this build. It lands with the first build after the cc0-legislators committee ingest (B-6) — absence is stated, never guessed from current rosters.",
    );
  } else {
    const { memberships, windowFrom, windowTo, jurisdictionByCommittee, mappingVersion, snapshotDate } = deps.committees;
    const snapshot: MembershipSnapshot = { memberships, windowFrom, windowTo };
    const current = membershipAsOf(snapshot, snapshotDate) ?? [];
    const overlap =
      deps.resolveSector === null
        ? null // overlap needs BOTH datasets; with sectors absent the join is unanswerable
        : jurisdictionOverlap(m.txns, snapshot, jurisdictionByCommittee, deps.resolveSector);
    /* An unmapped committee makes "no overlap" unanswerable: "not checked",
       never cleared (member-20, adapted) */
    const coverageNote =
      overlap !== null && overlap.unmappedCommittees.length > 0
        ? `${countOf(overlap.coverageUnknown, "trade", "trades")} on unmapped committees (${overlap.unmappedCommittees.map((c) => esc(c)).join(", ")}): not checked`
        : "";
    const undatableNote =
      overlap !== null && overlap.undatable > 0
        ? `${countOf(overlap.undatable, "trade predates", "trades predate")} the membership snapshot's validity window: unanswerable, not cleared`
        : "";
    const overlapHtml =
      overlap === null
        ? `<p class="section-note">Jurisdiction overlap needs the sector join too — sector data is not in this build, so the question is stated as unanswerable rather than answered from half the inputs.</p>`
        : overlap.rows.length === 0
          ? `<p class="section-note">${
              overlap.unmappedCommittees.length > 0 ? `No overlaps within the mapped committee jurisdictions` : `No trades in this member's committee jurisdictions`
            }${[undatableNote, coverageNote].filter(Boolean).map((t) => ` · ${t}`).join("")}.</p>`
          : `<div class="table-scroll"><table class="etable etable-compact" role="table" data-card="generic">` +
            `<caption class="visually-hidden">Trades within committee jurisdiction as of the trade date</caption>` +
            `<thead role="rowgroup"><tr role="row"><th scope="col" class="c-filed" role="columnheader">Traded</th><th scope="col" class="c-ticker" role="columnheader">Ticker</th><th scope="col" class="c-secondary c-flex" role="columnheader">Sector</th><th scope="col" class="c-secondary" role="columnheader">Committee</th><th scope="col" class="c-src" role="columnheader">Src</th></tr></thead>` +
            `<tbody role="rowgroup">${overlap.rows
              .slice(0, 12)
              .map(
                (r) =>
                  `<tr role="row"><td class="c-filed" role="cell">${esc(r.txn.traded ?? "—")}</td>` +
                  `<td class="c-ticker" role="cell">${esc(r.txn.ticker ?? "—")}</td>` +
                  `<td class="c-secondary c-flex" role="cell">${esc(sectorLabel(r.sector))}</td>` +
                  `<td class="c-secondary" role="cell">${r.committees.map((c) => esc(c.name)).join(", ")}</td>` +
                  `<td class="c-src" role="cell">${srcLink(r.txn.doc)}</td></tr>`,
              )
              .join("\n")}</tbody></table></div>` +
            (undatableNote || coverageNote ? `<div class="caveat-line">${[undatableNote, coverageNote].filter(Boolean).join(" · ")}</div>` : "");
    committeePanel =
      `<section class="panel" aria-label="Committees and jurisdiction overlap">` +
      `<div class="panel-head"><h2 class="section-h">Committees · jurisdiction overlap</h2>` +
      `<span class="panel-note">membership snapshot ${esc(snapshotDate)} · jurisdiction mapping v${esc(mappingVersion)}</span></div>` +
      (current.length > 0
        ? `<p class="section-note">Serves on: ${current.map((c) => esc(c.name) + (c.role ? ` (${esc(c.role)})` : "")).join(" · ")}</p>`
        : `<p class="section-note">No committee memberships on record in the snapshot.</p>`) +
      overlapHtml +
      `<div class="caveat-line non-allegation">${esc(NON_ALLEGATION_CAVEAT)}</div>` +
      `</section>`;
  }
  const context =
    `<details class="design-supplement"><summary>Recent disclosures and committee context</summary><div class="entity-grid"><section class="panel" aria-label="Largest recent disclosures"><div class="panel-head"><h2 class="section-h">Largest recent disclosures</h2><span class="panel-note">last 90 days · by lower bound</span></div>` +
    recentPanel + `</section>` + committeePanel + `</div></details>`;
  return { top, sectors, context };
}
