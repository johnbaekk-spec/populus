import { briefingCards, disclosureLedger, pairBandHtml, plannedLine, unavailableDesignPanel } from "./shared.ts";
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
  note,
  noteFromHtml,
  esc,
  fmtInt,
  amountText,
  sideLabel,
  ownerNote,
  ownerNoteLong,
  rangeBand,
  dualDate,
  flagTags,
  universalFlags,
  effectiveFlagKeys,
  universalFlagNote,
  srcLink,
  watchStarHtml,
  memberHrefFor,
  tickerHrefFor,
  partyClass,
  mergeFeed,
  pageSlice,
  pageCountFor,
  feedCountText,
  cardFoot,
  thHtml,
  hangMark,
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
  type QuarterlyFlowResult,
  excludeDateAnomalies,
  sumRanges,
  sumRangesText,
  undisclosedPctText,
  quarterlyFlow,
  topTickers,
  membersDisclosing,
  medianLag,
  lateCount,
  legacyTrailingMonthsBounds,
  windowMembership,
  affTextOf,
  partyLabel,
  netOverlaps,
  netDirection,
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
import { type BuildStamps, breadcrumb, asOfNote, netCellHtml } from "./shared.ts";

/* ---------- flow ribbon ---------- */

function ribbonAxisMax(sums: SumRanges[]): number {
  let max = 1;
  for (const s of sums) {
    if (s.kind === "closed") max = Math.max(max, s.high);
    else if (s.kind === "open") max = Math.max(max, s.low);
  }
  return max;
}

function barHtml(s: SumRanges, axisMax: number, cls: string): string {
  if (s.kind === "empty") return `<div class="rb-bar rb-gap" aria-hidden="true"></div>`;
  if (s.kind === "undisclosed") {
    return `<div class="rb-bar ${cls} rb-hatch" style="bottom:0;height:100%" aria-hidden="true"></div>`;
  }
  const basePct = Math.min(100, (s.low / axisMax) * 100);
  if (s.kind === "open") {
    // The provable minimum is solid to `low`; above it the source discloses no
    // upper bound, so the remainder is hatch to the axis top — never a solid
    // bar pretending a maximum exists.
    const solid = `<div class="rb-bar ${cls}" style="bottom:0;height:${basePct.toFixed(1)}%" aria-hidden="true"></div>`;
    const hatch = `<div class="rb-bar ${cls} rb-hatch" style="bottom:${basePct.toFixed(1)}%;height:${(100 - basePct).toFixed(1)}%" aria-hidden="true"></div>`;
    return solid + hatch;
  }
  const topPct = Math.min(100, (s.high / axisMax) * 100);
  const height = Math.max(topPct - basePct, 1.5);
  return `<div class="rb-bar ${cls}" style="bottom:${basePct.toFixed(1)}%;height:${height.toFixed(1)}%" aria-hidden="true"></div>`;
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

export function flowRibbon(
  flow: QuarterlyFlowResult,
  /* `notes` is OPTIONAL and only the member page passes one.
     The other caller is the deep ticker page (`ui.ts` `tickerUnifiedBody`),
     which this run does not own, so without a scope this renderer emits the
     visible `.rb-caption` byte-for-byte as before.

     `emptyWindow` (R13) is also member-only: when the window holds nothing to
     plot, the chart becomes ONE line (`flowWindowEmptyLine`) and keeps its
     method note; with any excluded side the plot renders as before. */
  opts: { twoSided: boolean; sourceLine: string; notes?: NoteCtx; emptyWindow?: { latestTraded: string | null; asOf?: string } },
): string {
  const empty = opts.emptyWindow !== undefined && flowWindowEmpty(flow);
  const axisMax = ribbonAxisMax(flow.quarters.flatMap((q) => [q.buy, q.sell]));
  const cols = flow.quarters
    .map((q) => {
      if (opts.twoSided) {
        return (
          `<div class="rb-col">` +
          `<div class="rb-up">${barHtml(q.buy, axisMax, "rb-buy")}</div>` +
          `<div class="rb-axis" aria-hidden="true"></div>` +
          `<div class="rb-down">${barHtml(q.sell, axisMax, "rb-sell")}</div>` +
          `</div>`
        );
      }
      return (
        `<div class="rb-col">` +
        `<div class="rb-up rb-split"><div class="rb-half">${barHtml(q.buy, axisMax, "rb-buy")}</div>` +
        `<div class="rb-half">${barHtml(q.sell, axisMax, "rb-sell")}</div></div>` +
        `</div>`
      );
    })
    .join("");
  const labels = flow.quarters
    .map((q) => `<div class="rb-label">${esc(q.q)}</div>`)
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
    "gaps are gaps — no interpolation",
    "y from $0 · no midpoints — bar spans the disclosed bounds",
    ...exclusions,
    opts.sourceLine,
  ]
    .filter(Boolean)
    .join(" · ");
  const summary = flow.quarters.map(quarterSummary).join("; ");
  if (empty) {
    return (
      `<div class="ribbon ribbon-empty">` +
      flowWindowEmptyLine(flow, opts.emptyWindow!.latestTraded, opts.emptyWindow!.asOf ?? null) +
      (opts.notes
        ? `<div class="rb-caption rb-caption-note"><span class="src-derived">` +
          note(caption, opts.notes, "chart-method", {
            trigger: "label",
            textHtml: "how this chart is drawn&nbsp;·§",
            name: "how this chart is drawn",
          }) +
          `</span></div>`
        : `<div class="rb-caption">${esc(caption)}</div>`) +
      `</div>`
    );
  }
  return (
    `<div class="ribbon${opts.twoSided ? " ribbon-two" : ""}">` +
    `<div class="rb-track">${cols}</div>` +
    `<div class="rb-labels">${labels}</div>` +
    /* The caption is a DEFINITION — how the chart is drawn, what the
       hatching means, what is excluded — so it moves into a note anchored on
       the chart, with the marker left visible as its cue (LD3). The
       accessibility summary below is untouched: it is the chart's data, not its
       method, and it was never the channel this requirement moves. */
    (opts.notes
      ? `<div class="rb-caption rb-caption-note"><span class="src-derived">` +
        note(caption, opts.notes, "chart-method", {
          trigger: "label",
          textHtml: "how this chart is drawn&nbsp;·§",
          name: "how this chart is drawn",
        }) +
        `</span></div>`
      : `<div class="rb-caption">${esc(caption)}</div>`) +
    `<p class="visually-hidden">Disclosed flow by quarter. ${esc(summary)}</p>` +
    `</div>`
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

/* R12 (DESIGN-POLISH M2): the member table's columns, decided over EVERY row
   its pager can show. The Owner column counts a row as having a value when it
   carries an owner code OR the partial-sale qualifier, because `ownerNote`
   prints both in that cell (H-18). */
const MEMBER_TXN_COLUMNS: readonly (readonly [string, string, string])[] = [
  ["kind", "Kind", "c-kind"], ["ticker", "Ticker", "c-ticker"], ["asset", "Asset", "c-secondary c-flex"],
  ["owner", "Owner", "c-secondary"], ["range", "Range", "c-num"], ["amount-range", "Amount range", "c-bar"],
  ["dates", "Traded → Filed", "c-num"], ["src", "Source", "c-src"],
];
export function memberTxnColumns(txns: readonly TxnRow[]): PresentColumns {
  return presentColumns<TxnRow>(txns, MEMBER_TXN_COLUMNS.map(([key]) =>
    key === "ticker"
      ? { key, hasValue: (r: TxnRow) => r.ticker != null, emptyReason: "Ticker: no row names a ticker; each filed asset is in the Asset column." }
      : key === "owner"
        ? {
            key,
            honesty: true,
            hasValue: (r: TxnRow) => r.owner === "spouse" || r.owner === "child" || r.owner === "joint" || r.side === "sale_partial",
            emptyReason: "Owner: no row carries a partial-sale qualifier or a spouse (SP), dependent (DC) or joint (JT) owner code.",
          }
        : { key, always: true },
  ));
}

function txnCellsMember(r: TxnRow, ctx: RenderCtx, stated: readonly string[] = [], cols: readonly string[] | null = null): string {
  const side = sideLabel(r.side, r.flags);
  const owner = ownerNote(r);
  const ownerLong = ownerNoteLong(r);
  const amountUnknown = r.low == null && r.high == null;
  const tickerCell = r.ticker
    ? `<a href="${tickerHrefFor(r.ticker, ctx)}">${esc(r.ticker)}</a>`
    : assetNameCell(r);
  const has = (k: string): boolean => cols === null || cols.includes(k);
  return (
    `<td class="c-side c-kind ${side.cls}">${esc(side.text)}</td>` +
    (has("ticker") ? `<td class="c-ticker">${r.ticker ? tickerCell : "—"}</td>` : "") +
    `<td class="c-asset c-secondary c-flex">${esc(r.asset || "Asset not named")}</td>` +
    (has("owner") ? `<td class="c-owner c-secondary">${owner ? `${esc(owner)}<span class="visually-hidden"> (${esc(ownerLong)})</span>` : "—"}</td>` : "") +
    `<td class="c-amount c-num${amountUnknown ? " unknown" : ""}">${esc(amountText(r))}</td>` +
    `<td class="c-range c-bar">${rangeBand(r)}${flagTags(r.flags, r, { stated })}</td>` +
    `<td class="c-traded c-num">${dualDate(r, true)}</td>` +
    `<td class="c-src">${srcLink(r.doc)}</td>`
  );
}

function txnCellsTicker(r: TxnRow, ctx: RenderCtx, stated: readonly string[] = []): string {
  const side = sideLabel(r.side, r.flags);
  const owner = ownerNote(r);
  const ownerLong = ownerNoteLong(r);
  const amountUnknown = r.low == null && r.high == null;
  const memberCell = r.bioguide
    ? `<a href="${memberHrefFor(r.bioguide, ctx)}">${esc(r.name)}</a> <span class="aff ${partyClass(r.party)}">${esc(
        affTextOf(r),
      )}</span>`
    : `<span class="unjoined-name">${esc(r.name)}</span> <span class="aff ${partyClass(r.party)}">${esc(affTextOf(r))}</span>`;
  return (
    `<td class="c-filed c-num has-marks">${esc(r.filed)}</td>` +
    `<td class="c-member c-flex">${memberCell}</td>` +
    `<td class="c-side c-kind ${side.cls}">${esc(side.text)}${
      owner
        ? ` <span class="owner-note">${esc(owner)}<span class="visually-hidden"> (${esc(ownerLong)})</span></span>`
        : ""
    }</td>` +
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
): string {
  /* The row's kind edge (tr[data-edge]); `data-kind` stays the table kind. */
  return rows
    .map((r) => {
      const edge = txnEdge(r);
      const cells = kind === "member" ? txnCellsMember(r, ctx, stated, columns) : txnCellsTicker(r, ctx, stated);
      return `<tr${edge ? ` data-edge="${edge}"` : ""}>${cells}</tr>`;
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
  const merged = mergeFeed(txns, []);
  const pageRows = pageSlice(merged, opts.page).filter((i): i is TxnRow => i.kind === "txn");
  const pages = pageCountFor(merged);
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
  const cols = opts.kind === "member" ? memberTxnColumns(txns) : null;
  const heads: readonly (readonly [string, string, string])[] =
    opts.kind === "member"
      ? MEMBER_TXN_COLUMNS.filter(([key]) => cols!.columns.includes(key)).map(([key, label, cls]) => [label, cls, key] as const)
      : [["Filed", "c-num", ""], ["Member", "c-member c-flex", ""], ["Side · Owner", "c-kind", ""], ["Traded · Lag", "c-num", ""],
         ["Amount", "c-num", ""], ["Range · Flags", "c-bar", ""], ["Src", "c-src", ""]];
  /* Only `Side · Owner` carries a note, and only when a scope is
     passed. Deliberately not every column: this run moves the strings that WERE
     on the page, and inventing an explanation for six columns that never had
     one would be new copy, not a relocation. The header's own label is the
     note's trigger. */
  const headNote = (label: string): string | null =>
    opts.notes && (label === "Side · Owner" || label === "Owner") ? OWNER_CODE_NOTE : null;
  const count = entityTableCountText(opts.page, pageRows.length, txns.length);
  return (
    universalFlagNote(stated) +
    `<div class="table-scroll"><table class="etable" data-entity-table data-kind="${opts.kind}"` +
    /* `data-paged` is the ONLY thing that exempts a table from the
       whole-distribution hoisting gate, and only these two renderers page. A visible page of a
       paged table can be uniform while its full collection is not, which is the
       one case the gate cannot judge from HTML. */
    `${pages > 1 ? ' data-paged="1"' : ""} data-stated-flags="${esc(stated.join(","))}"${cols ? dataColumnsAttr(cols) : ""}>` +
    `<caption class="visually-hidden">${esc(opts.caption)}</caption>` +
    `<thead><tr>${heads
      .map(([h, cls, key]) =>
        // The ticker table's fixed newest-filed-first order is stated by the
        // header's aria-sort and caret, never a "▾" typed into the label.
        thHtml({ label: h, mark: null, cls, noteHtml: headNote(h), notes: opts.notes, noteKey: "side-owner", order: opts.kind === "member" || h !== "Filed" ? undefined : "descending", ...(key ? { col: key } : {}) }),
      )
      .join("")}</tr></thead>` +
    `<tbody data-entity-rows>${entityTxnRowsHtml(pageRows, opts.kind, opts.ctx, stated, cols ? cols.columns : null)}</tbody>` +
    `</table></div>` +
    (cols ? tableFootReasonHtml(cols) : "") +
    `<div class="table-foot">` +
    `<div class="view-note">${opts.notes ? note("Each row is the latest version of its filing: an amendment replaces the original it supersedes, and the original stays in the published record.", opts.notes, "amended", { trigger: "label", textHtml: "Amended filings show the latest version" }) : "Amended filings show the latest version"} · <a href="/methodology/#defaults">what's excluded ↗</a></div>` +
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

/** S5: the member's needs-OCR paper filings — retained and counted, stated. */
export function memberPaperBlock(m: MemberEntity): string {
  if (m.paper.length === 0) return "";
  const rows = m.paper
    .map(
      (p) =>
        `<tr><td class="c-filed c-num has-marks">${esc(p.filed)}</td>` +
        `<td class="c-secondary c-flex"><span class="chip-ocr">paper filing — needs OCR</span> <span class="paper-note">retained and counted; zero machine-readable rows</span></td>` +
        `<td class="c-src">${srcLink(p.doc)}</td></tr>`,
    )
    .join("\n");
  return (
    `<section class="paper-block" aria-labelledby="paper-h">` +
    `<h2 id="paper-h" class="section-h">Paper filings — not machine-readable</h2>` +
    `<p class="section-note">These filings were submitted on paper. They are <strong>retained and counted</strong> — they appear in filing totals with zero transaction rows — but their contents are not yet machine-readable, and Public Filings does not hand-transcribe. The archived document is already the record.</p>` +
    `<div class="table-scroll"><table class="etable"><caption class="visually-hidden">Paper filings needing OCR for this member</caption>` +
    `<thead><tr>${thHtml({ label: "Filed", cls: "c-num", order: "descending" })}<th scope="col" class="c-secondary c-flex">Status</th><th scope="col" class="c-src">Src</th></tr></thead>` +
    `<tbody>${rows}</tbody></table></div></section>`
  );
}

/* The single clause `#member-footnotes` published. It is referenced from
   TWO places on the member page — the Flow range column and the quarterly-flow
   panel's "derived ·§" marker — so it is declared once and both notes read it,
   which is what stops the two channels drifting apart. */
const MEMBER_FLOW_NOTE =
  `flow range = sum of statutory bucket bounds — an interval, not an estimate of value; ` +
  `derived by Public Filings from the disclosed ranges`;

export function memberBody(m: MemberEntity, stamps: BuildStamps, ctx: RenderCtx, page = 0, deps: MemberV2Deps = { resolveSector: null, sectorMeta: null, committees: null }, signalsHtml = ""): string {
  const watched = ctx.watched.has(m.bioguide);
  const flow = quarterlyFlow(m.txns, stamps.generatedAtDate, 8);
  // R13: the member's latest disclosed trade date, over rows whose dates are
  // not anomalous (an impossible date is never the "latest trade").
  const latestTraded = excludeDateAnomalies(m.txns).rows.reduce<string | null>(
    (best, t) => (t.traded && (best === null || t.traded > best) ? t.traded : best),
    null,
  );
  const v2 = memberV2Parts(m, stamps, ctx, deps);
  const top = topTickers(m.txns, stamps.generatedAtDate, 24, 6);
  // R16 stats: net flow = purchases minus sales over the trailing 12 months,
  // through the ONE net arithmetic (`netFlow`, net = [pL−sU, pU−sL]) the
  // net-by-ticker table uses — never a gross sum of both sides.
  const rows12 = excludeDateAnomalies(m.txns).rows.filter(
    (t) => windowMembership(t, legacyTrailingMonthsBounds(stamps.generatedAtDate, 12), "traded_or_filed") === "in",
  );
  const net12 = netFlow(
    sumRanges(rows12.filter((t) => t.side === "purchase")),
    sumRanges(rows12.filter((t) => t.side === "sale" || t.side === "sale_partial")),
  );
  const distinctTickers = new Set(m.txns.map((t) => t.ticker).filter((t): t is string => t != null)).size;
  const lateTotal = lateCount(m.txns);
  // Committees the member currently sits on, when the build carries the roster.
  const committeesNow = deps.committees
    ? (membershipAsOf({ memberships: deps.committees.memberships, windowFrom: deps.committees.windowFrom, windowTo: deps.committees.windowTo }, deps.committees.snapshotDate) ?? [])
    : null;
  const aff = affTextOf(m);
  const partyWord = partyLabel(m.party);
  const chamberWord = m.chamber === "senate" ? "U.S. Senate" : "U.S. House";
  const topRows = top
    .map(
      (t) =>
        `<tr><td class="c-ticker c-flex"><a href="${tickerHrefFor(t.ticker, ctx)}">${esc(t.ticker)}</a></td>` +
        `<td class="c-num">${fmtInt(t.n)}</td>` +
        `<td class="c-num has-marks">${flowCellHtml(t.flow)}${hangMark("§")}</td>` +
        `<td class="c-num c-muted">${esc(t.last)}</td></tr>`,
    )
    .join("\n");
  const topTable =
    top.length === 0
      ? `<p class="section-note">No tickers disclosed in the trailing 24 months.</p>`
      : `<div class="table-scroll"><table class="etable etable-compact"><caption class="visually-hidden">Most-disclosed tickers, trailing 24 months</caption>` +
        /* `member-footnotes` had ONE mark, §, and it qualifies this
           column. The descriptor rule applies — this `<thead>` is a literal
           with no sort key, so the plan supplies the column key rather than the
           renderer inventing one. */
        `<thead><tr>${thHtml({ label: "Ticker", cls: "c-ticker c-flex" })}${thHtml({ label: "Trades", cls: "c-num" })}` +
        thHtml({ label: "Flow range ·§", cls: "c-num", noteHtml: MEMBER_FLOW_NOTE, notes: { scope: "member-top" }, noteKey: "flow-range" }) +
        `${thHtml({ label: "Last", cls: "c-num" })}</tr></thead>` +
        `<tbody>${topRows}</tbody></table></div>`;

  return (
    breadcrumb([
      { text: "/congress", href: "/congress/" },
      { text: "members" },
      { text: m.bioguide },
    ]) +
    `<header class="entity-head">` +
    `<div class="entity-head-copy">` +
    `<h1 class="entity-title">${esc(m.name)} ${watchStarHtml("member", m.bioguide, m.name, watched)}</h1>` +
    `<div class="entity-subline"><span class="aff ${partyClass(m.party)}">${esc(
      partyWord ? `${partyWord} — ${aff}` : aff,
    )}</span> · ${esc(chamberWord)}${
      m.servingSince ? ` · serving since ${esc(m.servingSince)}` : ""
    }${committeesNow && committeesNow.length > 0 ? ` · ${committeesNow.map((c) => esc(c.name)).join(", ")}` : ""} · <span class="mono-id">member ID ${esc(m.bioguide)}</span>` +
    /* The identity `.entity-lede` paragraph is gone from the page
       surface and its two claims are notes on the things they are about.

       The RANGES claim is a property of every total on this page; its trigger
       is the words "statutory ranges" in the provenance strip just below the
       identity (DESIGN-POLISH M1: a label trigger, no glyph). The OWNER-CODE
       claim is a property of one column, so it anchors on that column's header
       (see `entityTxnTable`).

       Neither is softened and neither is lost: both open declaratively with no
       JavaScript, both print, and the owner-code text additionally has its own
       methodology anchor, which T1 populated by moving it off this page. */
    `</div>` +
    `</div>` +
    /* R16: four stats — disclosures · net flow range (12m) · distinct tickers ·
       late filings. The `—` tiles for the annual-holdings and 13F joins are
       gone with the empty panels they fed; the joins are named ONCE in the
       planned line below. */
    disclosureLedger([
      { label: "Disclosures", value: fmtInt(m.txns.length), detail: `${fmtInt(m.filingCount)} filings · ${fmtInt(m.paper.length)} paper · retained`, subKind: "count" },
      /* A range value ("−$250K to −$75.0K") is WIDE (`data-wide`): the figure
         takes its width, never cutting it. The unbounded interval's wording is
         not a value: the value says "unbounded" and its sub says why (R15;
         review C2-2) — the 37-character phrase wrote over the next figure. */
      {
        label: "Net flow · 12m",
        value: rows12.length === 0 ? "—" : net12.kind === "unbounded" ? "unbounded" : netIntervalText(net12),
        detail: rows12.length > 0 && net12.kind === "unbounded" ? "open on both sides · an interval" : "purchases − sales · an interval",
        subKind: "qualifier",
        noteHtml: esc("Purchases minus sales over the trailing 12 months, summed from the statutory ranges on each filing — an interval, not an estimate of value."),
      },
      { label: "Distinct tickers", value: fmtInt(distinctTickers), detail: "across every disclosed row" },
      { label: "Late filings", value: fmtInt(lateTotal), detail: "filed past the 45-day window", tone: "gold" },
    ], { scope: "member-ledger" }) +
    `</header>` +
    `<div class="design-provenance">Flows from periodic transaction reports · House Clerk + Senate eFD · ` +
    noteFromHtml(
      `Amounts are statutory ranges; totals on this page are therefore ranges too. ` +
        `<a href="/methodology/#amount-ranges">Amount ranges ↗</a>`,
      { scope: "member-stamp" },
      "statutory-ranges",
      { trigger: "label", textHtml: "statutory ranges" },
    ) +
    ` · every row retains its receipt</div>` +
    /* R16: the quarterly buy/sell chart leads, as on the ticker page; an
       empty window is ONE data-derived line (R13). */
    `<section class="panel panel-wide design-member-chart" aria-labelledby="flow-h">` +
    `<div class="panel-head"><h2 id="flow-h" class="section-h">Disclosed flow by quarter</h2>` +
    `<span class="panel-note">bar = [min, max] of bucket sums · <span class="src-derived">` +
    noteFromHtml(MEMBER_FLOW_NOTE, { scope: "member-flow" }, "derived", { trigger: "label", textHtml: "derived&nbsp;·§", name: "derived" }) +
    `</span></span></div>` +
    flowRibbon(flow, {
      twoSided: false,
      sourceLine: "source: House Clerk + Senate eFD",
      notes: { scope: "member-chart" },
      emptyWindow: { latestTraded, asOf: stamps.generatedAtDate },
    }) +
    `</section>` +
    /* Band M1: Net flow by ticker (1.7fr) │ Trading profile + Sector mix (1fr). */
    v2.band +
    `<section class="panel panel-wide" aria-labelledby="txns-h">` +
    `<div class="panel-head"><h2 id="txns-h" class="section-h">All disclosed transactions</h2>` +
    `<span class="panel-note">${fmtInt(m.txns.length)} rows · filed date desc · ${asOfNote(stamps)}</span></div>` +
    entityTxnTable(m.txns, {
      kind: "member",
      caption: `All disclosed transactions for ${m.name}`,
      page,
      ctx,
      // The owner-code half of the deleted `.entity-lede`, on the
      // column it is about. The two `/tickers/*` callers pass nothing.
      notes: { scope: "member-txns" },
    }) +
    `</section>` +
    /* Band M2: Filing history (1fr, compact 12) │ Signals on this member (1fr)
       — a two-column pair, because the overlap cell has no data. A Signals cell
       that holds only its empty-state line collapses the pair to one column
       with that line under the history, and the band says so (R10, D-8). */
    memberHistoryBandHtml(m, signalsHtml) +
    memberPaperBlock(m) +
    /* R14: the ONE Planned line, at the page foot and outside every band; the
       13F column of the net-flow table is removed and named here. Then the
       collapsed context disclosures, which hold the cards. */
    plannedLine(["annual holdings", "13F overlap"]) +
    v2.context +
    `<details class="design-supplement"><summary>Additional disclosure analysis</summary>` +
    `<div class="entity-grid">` +
    `<section class="panel" aria-labelledby="top-h">` +
    `<div class="panel-head"><h2 id="top-h" class="section-h">Most-disclosed tickers</h2><span class="panel-note">trailing 24m</span></div>` +
    topTable +
    `</section>` +
    briefingCards([
      { tag: "Disclosed transactions", title: `${fmtInt(m.txns.length)} reported transactions`, body: "Amounts are the ranges in the filing. Purchases and sales are disclosures, not a statement of current holdings.", tone: "gold" },
      { tag: "Reporting window", title: `Published ${stamps.generatedAtDate}`, body: "Trade date and filing date are retained separately. Late and unparseable records stay identified in the data.", tone: "gold" },
      { tag: "Holdings coverage", title: "Annual holdings are not in this view", body: "Periodic transaction reports do not establish a portfolio. Annual holdings and reconciliation require annual financial-disclosure records.", tone: "green" },
    ]) +
    `</div>` +
    `</details>`
  );
}

/** The Signals cell the /e/ route renders when the server join is not
    available: a stated empty state, like the page's own no-signals line. */
const MEMBER_SIGNALS_UNJOINED =
  `<section class="panel" aria-label="Signals" data-empty-state><div class="panel-head"><h2 class="section-h">Signals</h2></div>` +
  `<p class="section-note">Signals are joined on the server; this view carries none. <a href="/signals/">Every rule, with its definition →</a></p></section>`;

/** Band M2 (DESIGN-POLISH M2, F): the member's Filing history, compact 12
    through the named binder, beside its Signals cell in a `.design-pair`.
    A Signals cell that is only its empty-state line (`data-empty-state`)
    collapses the pair: one column, the line under the history, and
    `data-collapsed="empty-state"` so the balance check knows the pair was
    collapsed on purpose, never lost (R10, T-4). */
function memberHistoryBandHtml(m: MemberEntity, signalsHtml: string): string {
  const filings = Array.from(
    m.txns
      .reduce((map, row) => {
        const old = map.get(row.doc);
        map.set(row.doc, { filed: row.filed, doc: row.doc, count: (old?.count ?? 0) + 1 });
        return map;
      }, new Map<string, { filed: string; doc: string; count: number }>())
      .values(),
  ).sort((a, b) => b.filed.localeCompare(a.filed));
  const signals = signalsHtml || MEMBER_SIGNALS_UNJOINED;
  /* The history is the PRIMARY cell and shows its fixed default of 12 in
     every state (coordinator decision CD-1): a default view is never tuned to
     one data build, and a primary is never cut to balance its side cell. */
  const historyN = MEMBER_HISTORY_COMPACT_ROWS;
  const shown = Math.min(historyN, filings.length);
  const collapsed = filings.length > historyN;
  const rows = filings
    .map(
      (row, i) =>
        `<tr${i >= historyN ? " data-compact-extra" : ""}><td class="c-flex">${esc(row.filed)}</td>` +
        `<td class="c-num">${fmtInt(row.count)}</td><td class="c-src">${srcLink(row.doc)}</td></tr>`,
    )
    .join("");
  /* The filing history has no text column: its identity date (first column)
     takes the slack and stays left-aligned; Rows is a number, Receipt a
     receipt (R1, round 3 NEW-E). */
  const history =
    `<section class="panel design-member-history" aria-label="Filing history"><div class="panel-head"><h2 class="section-h">Filing history</h2><span class="panel-note">SOURCE REPORTS · FILED ↓</span></div>` +
    (filings.length === 0
      ? `<p class="section-note">No machine-readable filing on record for this member.</p>`
      : `<div class="table-scroll"><table class="etable"><caption class="visually-hidden">Filing history</caption>` +
        `<thead><tr><th scope="col" class="c-flex">Filed</th><th scope="col" class="c-num">Rows</th><th scope="col" class="c-src">Receipt</th></tr></thead>` +
        `<tbody id="member-history-tbody"${collapsed ? ' data-collapsed="true"' : ""}>${rows}</tbody></table></div>` +
        compactDisclosure({ rootId: "member-history-tbody", total: filings.length, shown, noun: "filings", domBacked: true })) +
    `</section>`;
  /* The history is the primary cell; an empty-state Signals cell collapses
     the pair (derived from its `data-empty-state`), and the lone
     three-column history is then capped at the half-band width (CD-2). */
  return pairBandHtml("design-pair design-member-history-band", history, signals, { primary: "left" });
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
    flowRibbon(flow, { twoSided: true, sourceLine: "source: House Clerk + Senate eFD" }) +
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
    `<span class="panel-note">${fmtInt(t.txns.length)} rows · filed date desc · ${asOfNote(stamps)}</span></div>` +
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

/* ---------- the trading profile (Congress Member.dc.html, right of flows) ---------- */

/** Five per-member statistics on a 0–100 track with the chamber's per-member
    MEDIAN as a gold tick — "vs House median" in the reference. Every number is
    computed from this member's rows; the median is over the chamber's members
    (one observation each), supplied by the page or null for callers without
    the corpus, in which case the panel says "no median benchmark". */
function tradingProfileHtml(m: MemberEntityT, stamps: BuildStamps, bench: ChamberBenchmark | null): string {
  const st = memberProfileStats(m.txns);
  const chamberWord = m.chamber === "senate" ? "Senate" : "House";
  type Metric = { label: string; value: number | null; text: string; scale: number; median: number | null; medText: (v: number) => string; compare: ((v: number, med: number) => string) | null; title: string };
  const pct = (v: number | null): string => (v == null ? "—" : `${Math.round(v * 100)}%`);
  const metrics: Metric[] = [
    {
      label: "Filing lag (median)", value: st.medianLag, text: st.medianLag == null ? "—" : `+${fmtInt(st.medianLag)}d`, scale: 112,
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
      label: "Share ≤ $15K bracket", value: st.shareSmallBracket == null ? null : st.shareSmallBracket * 100, text: pct(st.shareSmallBracket), scale: 100,
      median: bench?.shareSmallBracket == null ? null : bench.shareSmallBracket * 100, medText: (v) => `median ${Math.round(v)}%`,
      compare: (v, med) => (v > med ? "small-lot profile" : v < med ? "larger lots" : "at median"),
      title: "rows whose disclosed bracket tops out at $15,000",
    },
    {
      label: "Buy share of rows", value: st.buyShare == null ? null : st.buyShare * 100, text: pct(st.buyShare), scale: 100,
      median: bench?.buyShare == null ? null : bench.buyShare * 100, medText: (v) => `median ${Math.round(v)}%`,
      compare: (v, med) => (Math.abs(v - med) < 5 ? "≈ chamber" : v > med ? "above median" : "below median"),
      title: "purchases as a share of all disclosed rows — a count of disclosures, not of dollars",
    },
    {
      label: "Self-owned share", value: st.selfOwnedShare == null ? null : st.selfOwnedShare * 100, text: pct(st.selfOwnedShare), scale: 100,
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
  const tiles = memberStatTiles(m, stamps);
  return (
    `<section class="panel design-trading-profile" aria-label="Trading profile">` +
    `<div class="panel-head"><h2 class="section-h">Trading profile</h2>` +
    `<span class="panel-note">${bench ? `VS ${chamberWord.toUpperCase()} MEDIAN · TICK = MEDIAN · ${fmtInt(bench.members)} MEMBERS` : "DISCLOSED RECORD · NO MEDIAN BENCHMARK"}</span></div>` +
    `<dl>${metrics.map(row).join("")}</dl>` +
    `<p class="section-note book-source">${tiles.map((t) => `${t.title ? note(t.title, { scope: "member-tiles" }, t.label, { trigger: "label", textHtml: esc(t.label) }) : esc(t.label)}: ${esc(t.value)}`).join(" · ")}</p>` +
    (bench
      ? `<p class="section-note">Medians are per member across the ${fmtInt(bench.members)} ${chamberWord} members with disclosed rows in this build — one observation each, so a high-volume filer does not become the chamber. Statistics describe the filing record, never intent.</p>`
      : "") +
    `</section>`
  );
}

/** Rows the member's "Net disclosed flow by ticker" shows before its Show-all
    — the FIXED default of the approved preview (E: compact 20; coordinator
    decision CD-1: a default view is never tuned to one data build, and the
    primary cell of band M1 is never cut to balance its side cell). The rest
    ride in the DOM behind the named binder (`initDomDisclosures`), so no row
    is unreachable. */
export const MEMBER_FLOW_COMPACT_ROWS = 20;
/** Filings the member's Filing history shows before its Show-all (E: 12, fixed). */
export const MEMBER_HISTORY_COMPACT_ROWS = 12;

export function memberV2Sections(
  m: MemberEntityT,
  stamps: BuildStamps,
  ctx: RenderCtx,
  deps: MemberV2Deps,
): string {
  const parts = memberV2Parts(m, stamps, ctx, deps);
  return parts.band + parts.context;
}

/** The member-v2 pieces, placed apart by `memberBody` (DESIGN-POLISH M2, F):
    band M1 (net flow │ trading profile + sector mix) after the chart, and the
    collapsed context disclosure at the page foot, after the Planned line.
    `memberV2Sections` keeps returning both, in that order, for its callers. */
function memberV2Parts(
  m: MemberEntityT,
  stamps: BuildStamps,
  ctx: RenderCtx,
  deps: MemberV2Deps,
): { band: string; context: string } {
  /* --- net disclosed flow by ticker (F-10: flows, never holdings) --- */
  const { rows: netRows, noTickerRows } = memberNetByTicker(m.txns);
  const { ranked, undisclosedBucket } = rankNetRows(netRows, (r) => r.net, (r) => r.ticker);
  const lower = (sum: SumRanges): number => sum.kind === "closed" || sum.kind === "open" ? sum.low : 0;
  const scale = Math.max(1, ...netRows.flatMap(row => [lower(row.purchases), lower(row.sales)]));
  const identities = new Map<string, { asset: string; last: string }>();
  for (const row of m.txns) if (row.ticker) {
    const previous = identities.get(row.ticker);
    const date = row.traded ?? "";
    if (!previous || date > previous.last) identities.set(row.ticker, { asset: row.asset ?? "—", last: date });
  }
  const netRowHtml = (r: (typeof netRows)[number], overlapsPrev: boolean): string => {
    const direction = netDirection(r.net);
    /* The row's kind edge follows its net direction; a range that spans zero
       (MIXED) takes the flat edge. */
    const edge = direction === "accumulation" ? "netbuy" : direction === "disposal" ? "netsell" : "flat";
    return `<tr class="design-net-row" data-edge="${edge}"><td class="c-kind ${direction === "accumulation" ? "c-buy" : direction === "disposal" ? "c-sell" : "c-muted"}">${direction === "accumulation" ? "BUY" : direction === "disposal" ? "SELL" : "MIXED"}</td>` +
      `<td class="c-ticker"><a href="${tickerHrefFor(r.ticker, ctx)}">${esc(r.ticker)}</a></td>` +
      `<td class="design-issuer c-secondary c-flex">${esc(identities.get(r.ticker)?.asset ?? "—")}</td>` +
      `<td class="c-bar"><span class="design-diverging" aria-hidden="true"><span style="right:50%;width:${lower(r.purchases) / scale * 50}%"></span><span class="sale" style="left:50%;width:${lower(r.sales) / scale * 50}%"></span></span><span class="visually-hidden">Purchases ${flowCellHtml(r.purchases)}; sales ${flowCellHtml(r.sales)}</span></td>` +
      `<td class="c-num c-buy">${fmtInt(r.buys)}</td><td class="c-num c-sell">${fmtInt(r.sells)}</td>` +
      `<td class="c-num c-net has-marks">${netCellHtml(r.net, overlapsPrev)}</td>` +
      `<td class="c-filed c-num">${esc(identities.get(r.ticker)?.last || "—")}</td></tr>`;
  };
  /* The 13F column is REMOVED (DESIGN-POLISH M2, R12): it was empty by
     construction — the institutional join is not in this build — and a
     derived column that is empty over the whole collection is not rendered;
     the page's Planned line names "13F overlap". */
  const netHeads = [
    thHtml({ label: "Net", cls: "c-kind" }),
    thHtml({ label: "Ticker", cls: "c-ticker" }),
    thHtml({ label: "Issuer", cls: "c-secondary c-flex" }),
    thHtml({ label: "Buy ◂ ▸ Sell", cls: "c-bar", noteHtml: memberFlowNoteHtml(), notes: { scope: "member-netflow" }, noteKey: "gross-purchases" }),
    thHtml({ label: "Buys", cls: "c-num" }),
    thHtml({ label: "Sells", cls: "c-num" }),
    thHtml({ label: "Net range", mark: "·§", cls: "c-num", noteHtml: memberFlowNoteHtml(), notes: { scope: "member-netflow" }, noteKey: "net" }),
    thHtml({ label: "Last traded", cls: "c-num" }),
  ];
  /* Compaction counts TICKERS: the first MEMBER_FLOW_COMPACT_ROWS tickers show
     and every later ticker row is held back in the DOM (`data-compact-extra`).
     The undisclosed bucket's separator row travels with the first ticker it
     introduces, so the count "1–20 of 608 tickers" is exact in every state. */
  const netTickers = ranked.length + undisclosedBucket.length;
  /* The fixed default (CD-1): band M1's primary cell shows its 20 whatever
     its side cell holds; a side cell may end earlier (G9). */
  const flowsN = MEMBER_FLOW_COMPACT_ROWS;
  const shownTickers = Math.min(flowsN, netTickers);
  const held = (tickerIndex: number, html: string): string =>
    tickerIndex >= flowsN ? html.replace(/^<tr\b/, "<tr data-compact-extra") : html;
  const netRowList = [
    ...ranked.map((r, i) => held(i, netRowHtml(r, i > 0 ? netOverlaps(r.net, ranked[i - 1]!.net) === true : false))),
    ...(undisclosedBucket.length > 0
      ? [
          held(
            ranked.length,
            `<tr class="unranked-sep"><td colspan="${netHeads.length}">${fmtInt(undisclosedBucket.length)} tickers carry a wholly-undisclosed side — no endpoints, listed last, never zero</td></tr>`,
          ),
          ...undisclosedBucket.map((r, j) => held(ranked.length + j, netRowHtml(r, false))),
        ]
      : []),
  ];
  const netCollapsed = netTickers > flowsN;
  /* The undisclosed bucket's statement is TRUE in both states, so when its
     separator row sits past the compact slice the disclosure states it beside
     the count — the bucket is never held back without being named. */
  const bucketBeyond =
    undisclosedBucket.length > 0 && ranked.length >= flowsN
      ? `${fmtInt(undisclosedBucket.length)} tickers carry a wholly-undisclosed side and are listed last, never as zero.`
      : undefined;
  const netTable =
    netRows.length === 0
      ? `<p class="section-note">No ticker-keyed disclosures on record.</p>`
      : `<div class="table-scroll"><table class="etable etable-compact">` +
        `<caption class="visually-hidden">Net disclosed flow by ticker for ${esc(m.name)}</caption>` +
        /* One trigger per header: the Buy ◂ ▸ Sell bar carried the same §
           clause twice (gross purchases, gross sales); it is stated once, from
           the header's own label. */
        `<thead><tr>${netHeads.join("")}</tr></thead>` +
        `<tbody id="member-flows-tbody"${netCollapsed ? ' data-collapsed="true"' : ""}>${netRowList.join("\n")}</tbody></table></div>` +
        compactDisclosure({
          rootId: "member-flows-tbody",
          total: netTickers,
          shown: shownTickers,
          noun: "tickers",
          domBacked: true,
          ...(bucketBeyond ? { bound: esc(bucketBeyond) } : {}),
        });
  /* The net-flow card's `.card-foot` is a DEFINITION of what the table
     is and is not, so it becomes a note. It is composed here rather than inside
     the branch above because the panel head that anchors it is assembled below,
     and the string must be identical on both sides — one composition, one
     text, no chance of the anchor and the table disagreeing.

     The row-exclusion clause travels WITH it: `noTickerRows` is a count of what
     the reader cannot see in this table, and separating it from the sentence
     that explains the table's scope is how a count loses its meaning. */
  const netFootNote =
    `PTRs are flows, not holdings — this table nets disclosed flow intervals; it is NOT a portfolio ` +
    `and cannot become one without the member's annual FD report` +
    (noTickerRows > 0
      ? ` · ${fmtInt(noTickerRows)} rows disclose no ticker and are outside this table`
      : "");

  /* --- largest recent disclosures (F-12: rank by lower bound) --- */
  const recent = notableRecent(m.txns, stamps.generatedAtDate, 90, 5);
  const recentRows = recent.rows
    .map(
      (r) =>
        `<tr${txnEdge(r) ? ` data-edge="${txnEdge(r)}"` : ""}><td class="c-filed c-num has-marks">${esc(r.filed)}</td>` +
        `<td class="c-ticker c-flex">${r.ticker ? `<a href="${tickerHrefFor(r.ticker, ctx)}">${esc(r.ticker)}</a>` : assetNameCell(r)}</td>` +
        `<td class="c-side c-kind ${sideLabel(r.side, r.flags).cls}">${esc(sideLabel(r.side, r.flags).text)}</td>` +
        `<td class="c-num">${esc(amountText(r))}</td>` +
        `<td class="c-src">${srcLink(r.doc)}</td></tr>`,
    )
    .join("\n");
  const recentPanel =
    recent.rows.length === 0
      ? `<p class="section-note">No rankable disclosures in the trailing 90 days${
          recent.unrankable > 0 ? ` (${fmtInt(recent.unrankable)} rows disclose no lower bound)` : ""
        }.</p>`
      : `<div class="table-scroll"><table class="etable etable-compact">` +
        `<caption class="visually-hidden">Largest recent disclosures for ${esc(m.name)}</caption>` +
        `<thead><tr>${thHtml({ label: "Filed", cls: "c-num", order: "descending" })}<th scope="col" class="c-ticker c-flex">Asset</th><th scope="col" class="c-kind">Side</th><th scope="col" class="c-num">Amount</th><th scope="col" class="c-src">Src</th></tr></thead>` +
        `<tbody>${recentRows}</tbody></table></div>` +
        cardFoot({
          short: "Ranked by disclosed lower bound, last 90 days",
          full: `Ranked by the disclosed lower bound, over the trailing 90 days by filed date${
            recent.unrankable > 0 ? `; ${fmtInt(recent.unrankable)} rows with no lower bound cannot rank` : ""
          }.`,
          scope: "member-recent-foot",
          key: "rank",
        });

  /* --- sector mix (B-5) --- */
  let sectorPanel: string;
  if (deps.resolveSector === null || deps.sectorMeta === null) {
    sectorPanel = unavailableDesignPanel("Sector rotation", "NET DISCLOSED FLOW", ["Sector", "Flow range", "Rows"], "Sector data is not in this build. The issuer-SIC join is required to calculate these rows.");
  } else {
    const mix = sectorMix(m.txns, deps.resolveSector);
    const mixRows = mix
      .map(
        (r) =>
          `<tr class="${r.bucket ? "mix-bucket" : ""}"><td class="c-flex">${esc(r.key)}${r.bucket ? ` <span class="mono-note">coverage</span>` : ""}</td>` +
          `<td class="c-num">${fmtInt(r.txns)}</td>` +
          `<td class="c-num">${flowCellHtml(r.flow)}</td></tr>`,
      )
      .join("\n");
    sectorPanel =
      `<section class="panel" aria-label="Sector mix">` +
      `<div class="panel-head"><h2 class="section-h">Sector mix</h2>` +
      `<span class="panel-note">taxonomy v${esc(deps.sectorMeta.taxonomyVersion)} · SIC as of ${esc(deps.sectorMeta.asOf)}</span></div>` +
      `<div class="table-scroll"><table class="etable etable-compact">` +
      `<caption class="visually-hidden">Disclosed transactions by issuer sector</caption>` +
      `<thead><tr>${thHtml({ label: "Sector", cls: "c-flex" })}${thHtml({ label: "Trades", cls: "c-num" })}${thHtml({ label: "Flow range", cls: "c-num" })}</tr></thead>` +
      `<tbody>${mixRows}</tbody></table></div>` +
      cardFoot({ short: "Sector from SEC SIC codes", full: "Sector comes from SEC EDGAR SIC codes through the site's own taxonomy; rows without a sector are listed as coverage, never folded into a sector.", scope: "member-sector-foot", key: "sector" }) +
      `</section>`;
  }

  /* --- committee jurisdiction overlap (B-6 / S-5) --- */
  let committeePanel: string;
  if (deps.committees === null) {
    committeePanel = absentPanel(
      "Committees",
      "Committee membership data is not in this build. It lands with the first build after the cc0-legislators committee ingest (B-6) — absence is stated, never guessed from current rosters.",
    );
  } else {
    const { memberships, windowFrom, windowTo, jurisdictionByCommittee, mappingVersion, snapshotDate } =
      deps.committees;
    const snapshot: MembershipSnapshot = { memberships, windowFrom, windowTo };
    const current = membershipAsOf(snapshot, snapshotDate) ?? [];
    const overlap =
      deps.resolveSector === null
        ? null // overlap needs BOTH datasets; with sectors absent the join is unanswerable
        : jurisdictionOverlap(m.txns, snapshot, jurisdictionByCommittee, deps.resolveSector);
    // An unmapped committee makes "no overlap" unanswerable — the
    // definitive-absence copy is only usable when mapping coverage is complete
    // for everything this member sat on.
    const coverageNote =
      overlap !== null && overlap.unmappedCommittees.length > 0
        ? ` · ${fmtInt(overlap.coverageUnknown)} trades touch committees outside the jurisdiction mapping (${overlap.unmappedCommittees
            .map((c) => esc(c))
            .join(", ")}) — unanswerable there, not cleared`
        : "";
    const overlapHtml =
      overlap === null
        ? `<p class="section-note">Jurisdiction overlap needs the sector join too — sector data is not in this build, so the question is stated as unanswerable rather than answered from half the inputs.</p>`
        : overlap.rows.length === 0
          ? `<p class="section-note">${
              overlap.unmappedCommittees.length > 0
                ? `No overlaps found within the MAPPED committee jurisdictions`
                : `No disclosed trades fall inside this member's committee jurisdictions as of their trade dates`
            }${
              overlap.undatable > 0
                ? ` · ${fmtInt(overlap.undatable)} trades predate the membership snapshot's validity window and are unanswerable, not cleared`
                : ""
            }${coverageNote}.</p>`
          : `<div class="table-scroll"><table class="etable etable-compact">` +
            `<caption class="visually-hidden">Trades within committee jurisdiction as of the trade date</caption>` +
            `<thead><tr><th scope="col">Traded</th><th scope="col" class="c-ticker">Ticker</th><th scope="col" class="c-secondary c-flex">Sector</th><th scope="col" class="c-secondary">Committee</th><th scope="col" class="c-src">Src</th></tr></thead>` +
            `<tbody>${overlap.rows
              .slice(0, 12)
              .map(
                (r) =>
                  `<tr><td class="c-filed">${esc(r.txn.traded ?? "—")}</td>` +
                  `<td class="c-ticker">${esc(r.txn.ticker ?? "—")}</td>` +
                  `<td class="c-secondary c-flex">${esc(r.sector)}</td>` +
                  `<td class="c-secondary">${r.committees.map((c) => esc(c.name)).join(", ")}</td>` +
                  `<td class="c-src">${srcLink(r.txn.doc)}</td></tr>`,
              )
              .join("\n")}</tbody></table></div>` +
            (overlap.undatable > 0 || overlap.unmappedCommittees.length > 0
              ? `<div class="caveat-line">${
                  overlap.undatable > 0
                    ? `${fmtInt(overlap.undatable)} trades predate the membership snapshot's validity window — unanswerable, not cleared`
                    : ""
                }${overlap.undatable > 0 && coverageNote ? " · " : ""}${coverageNote.replace(/^ · /, "")}</div>`
              : "");
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

  /* Band M1: Net flow by ticker (1.7fr, the PRIMARY cell) │ trading profile
     plus sector mix (1fr). */
  const band = pairBandHtml(
    "design-member-band design-flow-band",
    `<section class="panel" aria-label="Net disclosed flow by ticker">` +
    `<div class="panel-head"><h2 class="section-h">Net disclosed flow by ticker</h2>` +
    // The card-foot's text, anchored on the panel it qualifies.
    `<span class="panel-note"><span class="src-derived">` +
    note(netFootNote, { scope: "member-netflow" }, "scope", { trigger: "label", textHtml: "flows, not holdings&nbsp;·§", name: "flows, not holdings" }) +
    `</span></span>` +
    `<span class="panel-note">ALL DISCLOSED HISTORY · net range</span></div>` +
    netTable +
    `</section>`,
    `<div>` + tradingProfileHtml(m, stamps, deps.chamber ?? null) + sectorPanel + `</div>`,
    { primary: "left" },
  );
  const context =
    `<details class="design-supplement"><summary>Recent disclosures and committee context</summary><div class="entity-grid"><section class="panel" aria-label="Largest recent disclosures"><div class="panel-head"><h2 class="section-h">Largest recent disclosures</h2><span class="panel-note">trailing 90d · lower bound</span></div>` + recentPanel + `</section>` + committeePanel + `</div></details>`;
  return { band, context };
}
