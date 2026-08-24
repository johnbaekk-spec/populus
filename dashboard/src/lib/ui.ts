/* Pure page/section renderers. Every entity body is a string function called
   by the thin .astro page for SSR AND by the generic-route client driver —
   parity is by construction (one function, two callers). No Node APIs, no DOM.

   Honesty grammar: G1–G7 via the canonical format.ts components; charts per
   C1–C7 (zero-based, gaps stay gaps, no midpoints); NULL-honest institutional
   integers; the Locked #20 stamp on every 13F table. */

import {
  type TxnRow,
  type RenderCtx,
  type StatTile,
  type FootnoteEntry,
  type NoteCtx,
  assetNameCell,
  colWhyHtml,
  fnMark,
  note,
  noteBody,
  noteFromHtml,
  esc,
  fmtInt,
  fmtUsd,
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
  srcLinkDerived,
  terminusRow,
  footnoteBlock,
  compactDisclosure,
  COMPACT_ROWS,
  statTiles,
  watchStarHtml,
  memberHrefFor,
  tickerHrefFor,
  congressTickerHref,
  partyClass,
  mergeFeed,
  pageSlice,
  pageCountFor,
  feedCountText,
} from "./format.ts";
import {
  type MemberEntity,
  type TickerEntity,
  type SumRanges,
  type QuarterlyFlowResult,
  type FilingWindow,
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
  qoqPresentation,
  edgarFilerUrl,
  edgarTickerUrl,
  bioguideProfileUrl,
} from "./derive.ts";
import {
  filerHref,
  holdingsPageCount,
  holdingsPageSlice,
  holdingsRangeText,
  sortQoqDeltas,
  type FilerBudgetState,
} from "./holdings.ts";
import type { ConcentrationRow, QoqDeltaRow, TopHolderRow } from "./inst.ts";
import { HOLDER_COLUMNS, HOLDER_ZERO_CAVEAT, holderSortNote, orderRankedHolders, type HolderSortKey } from "./holders-sort.ts";
import type { TickerInstSection } from "./data.ts";

export interface BuildStamps {
  buildId: string;
  generatedAt: string; // "YYYY-MM-DD HH:MM UTC"
  generatedAtDate: string; // "YYYY-MM-DD"
}

/* ---------- small shared pieces ---------- */

export function breadcrumb(parts: { text: string; href?: string }[]): string {
  return (
    `<nav class="crumb" aria-label="Breadcrumb">` +
    parts
      .map((p) =>
        p.href ? `<a href="${esc(p.href)}">${esc(p.text)}</a>` : `<span>${esc(p.text)}</span>`,
      )
      .join(" / ") +
    `</nav>`
  );
}

/* SL-R9: the build id is OUT of this stamp. It is not a fact about the window
   the panel rendered, it is a fact about the deploy, and `Base.astro`'s footer
   already prints it once per page — `m1-layout.test.ts:52` pins exactly that
   "rendered once, in the footer" rule. Repeating it beside every window
   statement spent characters on the least reader-relevant token in the line.
   The one caller that is NOT a `.panel-note` — the signals page's `.si-asof`,
   out of scope for this run — appends it explicitly, so that surface's bytes
   are unchanged. */
function asOfNote(stamps: BuildStamps): string {
  return `as of ${esc(stamps.generatedAt)}`;
}

/** Locked #20: the institutional table time stamp. The published aggregate has
    no per-row filed date, so the honest form pairs the quarter-end with the
    module's build-wide filed-date watermark — never "current holdings". */
export function instStamp(period: string, latestFiled: string | null): string {
  const filed =
    latestFiled == null
      ? `latest filing date not recorded in this build's watermarks`
      : `latest filing in build filed ${esc(latestFiled)}`;
  return `<span class="inst-stamp">quarter-end ${esc(period)} · ${filed}</span>`;
}

export const INST_STAMP_CAVEAT =
  "per-filer filing dates are not in the published aggregate — the filed-date watermark is build-wide, not per row";

/* ---------- flow ribbon (C1–C7) ---------- */

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
export function flowRibbon(
  flow: QuarterlyFlowResult,
  opts: { twoSided: boolean; sourceLine: string },
): string {
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
    exclusions.push(`${fmtInt(flow.dateAnomalies)} date-anomaly rows excluded (impossible trade dates)`);
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
  return (
    `<div class="ribbon${opts.twoSided ? " ribbon-two" : ""}">` +
    `<div class="rb-track">${cols}</div>` +
    `<div class="rb-labels">${labels}</div>` +
    `<div class="rb-caption">${esc(caption)}</div>` +
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

/* ---------- entity transaction table (real <table>, R16) ---------- */

export interface EntityTableOpts {
  kind: "member" | "ticker";
  caption: string;
  page: number;
  ctx: RenderCtx;
}

function txnCellsMember(r: TxnRow, ctx: RenderCtx, stated: readonly string[] = []): string {
  const side = sideLabel(r.side, r.flags);
  const owner = ownerNote(r);
  const ownerLong = ownerNoteLong(r);
  const amountUnknown = r.low == null && r.high == null;
  const tickerCell = r.ticker
    ? `<a href="${tickerHrefFor(r.ticker, ctx)}">${esc(r.ticker)}</a>`
    : assetNameCell(r);
  return (
    `<td class="c-filed">${esc(r.filed)}</td>` +
    `<td class="c-ticker">${tickerCell}</td>` +
    `<td class="c-side ${side.cls}">${esc(side.text)}${
      owner
        ? ` <span class="owner-note">${esc(owner)}<span class="visually-hidden"> (${esc(ownerLong)})</span></span>`
        : ""
    }</td>` +
    `<td class="c-traded">${dualDate(r)}</td>` +
    `<td class="c-amount${amountUnknown ? " unknown" : ""}">${esc(amountText(r))}</td>` +
    `<td class="c-range">${rangeBand(r)}${flagTags(r.flags, r, { stated })}</td>` +
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
    `<td class="c-filed">${esc(r.filed)}</td>` +
    `<td class="c-member">${memberCell}</td>` +
    `<td class="c-side ${side.cls}">${esc(side.text)}${
      owner
        ? ` <span class="owner-note">${esc(owner)}<span class="visually-hidden"> (${esc(ownerLong)})</span></span>`
        : ""
    }</td>` +
    `<td class="c-traded">${dualDate(r)}</td>` +
    `<td class="c-amount${amountUnknown ? " unknown" : ""}">${esc(amountText(r))}</td>` +
    `<td class="c-range">${rangeBand(r)}${flagTags(r.flags, r, { stated })}</td>` +
    `<td class="c-src">${srcLink(r.doc)}</td>`
  );
}

export function entityTxnRowsHtml(
  rows: TxnRow[],
  kind: "member" | "ticker",
  ctx: RenderCtx,
  stated: readonly string[] = [],
): string {
  const cells = kind === "member" ? txnCellsMember : txnCellsTicker;
  return rows.map((r) => `<tr>${cells(r, ctx, stated)}</tr>`).join("\n");
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
  /* R10 defect #12. Over EVERY row the table can page through, not this page —
     the client re-renders rows on paging, and a per-page set would let page 2
     contradict the note page 1 left above it. The set travels to the client in
     `data-stated-flags` so both sides suppress identically. */
  const stated = universalFlags(txns.map(effectiveFlagKeys));
  const heads =
    opts.kind === "member"
      ? ["Filed ▾", "Ticker", "Side · Owner", "Traded · Lag", "Amount", "Range · Flags", "Src"]
      : ["Filed ▾", "Member", "Side · Owner", "Traded · Lag", "Amount", "Range · Flags", "Src"];
  const count = entityTableCountText(opts.page, pageRows.length, txns.length);
  return (
    universalFlagNote(stated) +
    `<div class="table-scroll"><table class="etable" data-entity-table data-kind="${opts.kind}"` +
    /* B35: `data-paged` is the ONLY thing that exempts a table from the R10
       whole-dist gate, and only these two renderers page. A visible page of a
       paged table can be uniform while its full collection is not, which is the
       one case the gate cannot judge from HTML. */
    `${pages > 1 ? ' data-paged="1"' : ""} data-stated-flags="${esc(stated.join(","))}">` +
    `<caption class="visually-hidden">${esc(opts.caption)}</caption>` +
    `<thead><tr>${heads.map((h) => `<th scope="col">${esc(h)}</th>`).join("")}</tr></thead>` +
    `<tbody data-entity-rows>${entityTxnRowsHtml(pageRows, opts.kind, opts.ctx, stated)}</tbody>` +
    `</table></div>` +
    `<div class="table-foot">` +
    `<div class="view-note">v_default_transactions — active filings minus superseded amendment originals · <a href="/methodology/#defaults">what's excluded ↗</a></div>` +
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
        `<tr><td class="c-filed">${esc(p.filed)}</td>` +
        `<td><span class="chip-ocr">paper filing — needs OCR</span> <span class="paper-note">retained and counted; zero machine-readable rows</span></td>` +
        `<td class="c-src">${srcLink(p.doc)}</td></tr>`,
    )
    .join("\n");
  return (
    `<section class="paper-block" aria-labelledby="paper-h">` +
    `<h2 id="paper-h" class="section-h">Paper filings — not machine-readable</h2>` +
    `<p class="section-note">These filings were submitted on paper. They are <strong>retained and counted</strong> — they appear in filing totals with zero transaction rows — but their contents are not yet machine-readable, and Public Filings does not hand-transcribe. The archived document is already the record.</p>` +
    `<div class="table-scroll"><table class="etable"><caption class="visually-hidden">Paper filings needing OCR for this member</caption>` +
    `<thead><tr><th scope="col">Filed ▾</th><th scope="col">Status</th><th scope="col">Src</th></tr></thead>` +
    `<tbody>${rows}</tbody></table></div></section>`
  );
}

/* SL-R7: the single clause `#member-footnotes` published. It is referenced from
   TWO places on the member page — the Flow range column and the quarterly-flow
   panel's "derived ·§" marker — so it is declared once and both notes read it,
   which is what stops the two channels drifting apart. */
const MEMBER_FLOW_NOTE =
  `flow range = sum of statutory bucket bounds — an interval, not an estimate of value; ` +
  `derived by Public Filings from the disclosed ranges`;

export function memberBody(m: MemberEntity, stamps: BuildStamps, ctx: RenderCtx, page = 0): string {
  const watched = ctx.watched.has(m.bioguide);
  const flow = quarterlyFlow(m.txns, stamps.generatedAtDate, 8);
  const top = topTickers(m.txns, stamps.generatedAtDate, 24, 6);
  const aff = affTextOf(m);
  const partyWord = partyLabel(m.party);
  const chamberWord = m.chamber === "senate" ? "U.S. Senate" : "U.S. House";
  const topRows = top
    .map(
      (t) =>
        `<tr><td class="c-ticker"><a href="${tickerHrefFor(t.ticker, ctx)}">${esc(t.ticker)}</a></td>` +
        `<td class="c-num">${fmtInt(t.n)}</td>` +
        `<td class="c-num">${flowCellHtml(t.flow)}${fnMark("§")}</td>` +
        `<td class="c-num c-muted">${esc(t.last)}</td></tr>`,
    )
    .join("\n");
  const topTable =
    top.length === 0
      ? `<p class="section-note">No tickers disclosed in the trailing 24 months.</p>`
      : `<div class="table-scroll"><table class="etable etable-compact"><caption class="visually-hidden">Most-disclosed tickers, trailing 24 months</caption>` +
        /* SL-R7: `member-footnotes` had ONE mark, §, and it qualifies this
           column. R7b's descriptor rule applies — this `<thead>` is a literal
           with no sort key, so the plan supplies the column key rather than the
           renderer inventing one. */
        `<thead><tr><th scope="col">Ticker</th><th scope="col">Txns</th>` +
        `<th scope="col">Flow range ·§${noteFromHtml(MEMBER_FLOW_NOTE, { scope: "member-top" }, "flow-range")}</th>` +
        `<th scope="col">Last</th></tr></thead>` +
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
    } · <span class="mono-id">bioguide ${esc(m.bioguide)}</span></div>` +
    `<p class="entity-lede">Filings under this member include transactions by spouse (SP), dependent children (DC), and joint accounts (JT) — the STOCK Act does not distinguish who directed a trade. Amounts are statutory ranges; totals below are therefore ranges too.</p>` +
    `</div>` +
    statTiles(memberStatTiles(m, stamps), { label: "Member disclosure statistics", compact: true }) +
    `</header>` +
    `<div class="entity-grid">` +
    `<section class="panel" aria-labelledby="flow-h">` +
    `<div class="panel-head"><h2 id="flow-h" class="section-h">Disclosed flow by quarter</h2>` +
    `<span class="panel-note">bar = [min, max] of bucket sums · <span class="src-derived">derived&nbsp;·§</span>` +
    noteFromHtml(MEMBER_FLOW_NOTE, { scope: "member-flow" }, "derived") + `</span></div>` +
    flowRibbon(flow, { twoSided: false, sourceLine: "source: House Clerk + Senate eFD" }) +
    `</section>` +
    `<section class="panel" aria-labelledby="top-h">` +
    `<div class="panel-head"><h2 id="top-h" class="section-h">Most-disclosed tickers</h2><span class="panel-note">trailing 24m</span></div>` +
    topTable +
    `</section>` +
    `</div>` +
    `<section class="panel panel-wide" aria-labelledby="txns-h">` +
    `<div class="panel-head"><h2 id="txns-h" class="section-h">All disclosed transactions</h2>` +
    `<span class="panel-note">${fmtInt(m.txns.length)} rows · filed date desc · ${asOfNote(stamps)}</span></div>` +
    entityTxnTable(m.txns, {
      kind: "member",
      caption: `All disclosed transactions for ${m.name}`,
      page,
      ctx,
    }) +
    `</section>` +
    memberPaperBlock(m)
  );
}

/* ---------- unified ticker page body ---------- */

export interface TickerHeaderInfo {
  ticker: string;
  /** present-day mapped issuer name (G14, †) or null when unresolved */
  mappedName: string | null;
}

function tickerTitleHtml(info: TickerHeaderInfo): string {
  const name = info.mappedName
    ? ` — ${esc(info.mappedName)}<a class="fn-ref" href="#ticker-footnotes" aria-label="footnote: present-day mapping">†</a>`
    : "";
  return `<span class="mono-ticker">${esc(info.ticker)}</span>${name}`;
}

export function tickerInstSectionHtml(inst: TickerInstSection, ticker: string): string {
  const head = (note: string): string =>
    `<div class="section-head"><h2 class="section-h2">Institutional holders <span class="section-note-inline">· 13F${note}</span></h2></div>`;
  if (inst.state === "module-absent") {
    return (
      `<section class="page-section" id="institutional">` +
      head("") +
      `<div class="absent-block">` +
      `<h3 class="absent-h">The institutional module is not in this build.</h3>` +
      `<p>13F holdings for ${esc(ticker)} will render here when a build publishes the institutional aggregate. Nothing is shown rather than something unverified. <a href="/methodology/#m2">methodology §13F ↗</a></p>` +
      `<p class="mono-note"><a href="${esc(edgarTickerUrl(ticker))}" rel="noopener" target="_blank">search ${esc(ticker)} on SEC EDGAR ↗</a></p>` +
      `</div></section>`
    );
  }
  if (inst.state === "no-map" || inst.state === "unmapped" || inst.state === "ambiguous") {
    const reason =
      inst.state === "ambiguous"
        ? `This ticker names more than one issuer in the SEC's present-day ticker file, so Public Filings refuses to pick one.`
        : inst.state === "no-map"
          ? `This build carries no ticker→issuer mapping input, so the join is not attempted.`
          : `This ticker is not in the SEC's present-day ticker file.`;
    return (
      `<section class="page-section" id="institutional">` +
      head("") +
      `<div class="absent-block">` +
      `<h3 class="absent-h">Not resolved to an issuer — deliberately.</h3>` +
      `<p>${reason} Issuer rankings are keyed by registry identity, and Public Filings does not guess identity from names. Filer pages list holdings by issuer name as filed, or check the primary source: <a href="${esc(
        edgarTickerUrl(ticker),
      )}" rel="noopener" target="_blank">${esc(ticker)} on SEC EDGAR ↗</a></p>` +
      `</div></section>`
    );
  }
  if (inst.state === "resolved-no-data") {
    return (
      `<section class="page-section" id="institutional">` +
      head("") +
      `<div class="absent-block">` +
      `<h3 class="absent-h">Mapped, but not in the published aggregate.</h3>` +
      `<p>${esc(ticker)} resolves to ${esc(inst.name ?? "an issuer")} (CIK ${esc(
        inst.cik ?? "",
      )}), but this build's aggregate holds no entity-keyed top-holder rows for it. <a href="${esc(
        edgarTickerUrl(ticker),
      )}" rel="noopener" target="_blank">${esc(ticker)} on SEC EDGAR ↗</a></p>` +
      `</div></section>`
    );
  }
  // data
  const holders = inst.holders ?? [];
  /* R10 #12 applies to EVERY flag-bearing table, not only the entity txn one.
     Measured before wiring these: 1,004 pages carried a table whose every row
     read `security not in mapping`, with no caveat line above it. */
  const statedHolders = universalFlags(holders.map((h) => h.flags));
  const rows = holders
    .map(
      (h) =>
        `<tr><td class="c-num c-muted">${fmtInt(h.rank)}</td>` +
        // ONE href primitive (R22): the payload carries the top/tail target.
        `<td class="c-filer"><a href="${esc(filerHref(h.cik, h.tier ?? "tail"))}">${esc(h.name)}</a></td>` +
        `<td class="c-num c-strong">${esc(fmtUsd(h.value))}</td>` +
        `<td class="c-num">${fmtInt(h.securities)}</td>` +
        `<td class="c-flags">${flagTags(h.flags, undefined, { stated: statedHolders })}</td>` +
        `<td class="c-src">${srcLinkDerived("#ticker-inst-footnotes", edgarFilerUrl(h.cik))}</td></tr>`,
    )
    .join("\n");
  return (
    `<section class="page-section" id="institutional">` +
    `<div class="section-head"><h2 class="section-h2">Institutional holders <span class="section-note-inline">· 13F · ${instStamp(
      inst.period!,
      inst.latestFiled ?? null,
    )} · longs only</span></h2>` +
    `<a class="section-link" href="/institutional/tickers/${esc(encodeURIComponent(ticker))}/holders/">full holders view ↗</a></div>` +
    universalFlagNote(statedHolders) +
    `<div class="table-scroll"><table class="etable" data-sticky-first data-stated-flags="${esc(statedHolders.join(","))}">` +
    `<caption class="visually-hidden">Top institutional holders of ${esc(ticker)} for quarter ${esc(inst.period!)}</caption>` +
    `<thead><tr><th scope="col">#</th><th scope="col">Filer</th><th scope="col">Value ▾</th><th scope="col">Securities</th><th scope="col">Flags</th><th scope="col">Src</th></tr></thead>` +
    `<tbody>${rows}</tbody></table></div>` +
    terminusRow({
      author: "populus",
      html: `The published aggregate ranks the top ${fmtInt(inst.topn ?? 25)} holders per issuer — a build parameter of the Public Filings aggregation, not a census. Rows beyond it exist in individual filings on EDGAR. <a href="/methodology/#m2">methodology §13F ↗</a>`,
    }) +
    footnoteBlock(
      [
        {
          mark: "§",
          html: `derived by Public Filings from the published aggregate (agg_issuer_top_holders); per-filer filed dates, share counts and document links are not in the published aggregate — the EDGAR link opens the filer's 13F list`,
        },
        { mark: "n/c", html: `${esc(INST_STAMP_CAVEAT)}` },
      ],
      { id: "ticker-inst-footnotes" },
    ) +
    `</section>`
  );
}

export function tickerUnifiedBody(
  t: TickerEntity,
  inst: TickerInstSection,
  stamps: BuildStamps,
  ctx: RenderCtx,
  opts: { fullTable: boolean; page?: number },
): string {
  const info: TickerHeaderInfo = {
    ticker: t.ticker,
    mappedName: inst.name ?? null,
  };
  const watched = ctx.watchedTickers?.has(t.ticker) ?? false;
  const disclosing = membersDisclosing(t.txns, stamps.generatedAtDate, 12, 5);
  const latestFiled = t.txns[0]?.filed ?? null;
  const tiles: StatTile[] = [
    { value: fmtInt(t.txns.length), label: "congress txns" },
    {
      value: latestFiled ? latestFiled.slice(5) : "—",
      label: "latest PTR filing",
      title: latestFiled ? `latest filing mentioning ${t.ticker}: ${latestFiled}` : undefined,
    },
  ];
  const memberRows = disclosing
    .map(
      (m) =>
        `<tr><td class="c-member">${
          m.bioguide
            ? `<a href="${memberHrefFor(m.bioguide, ctx)}">${esc(m.name)}</a>`
            : esc(m.name)
        } <span class="aff ${partyClass(m.party)}">${esc(affTextOf(m))}</span></td>` +
        `<td class="c-num c-buy">${fmtInt(m.buys)}</td>` +
        `<td class="c-num c-sell">${fmtInt(m.sells)}</td>` +
        `<td class="c-num">${flowCellHtml(m.flow)}</td></tr>`,
    )
    .join("\n");
  const membersCard =
    disclosing.length === 0
      ? `<p class="section-note">No members disclosed ${esc(t.ticker)} in the trailing 12 months.</p>`
      : `<div class="table-scroll"><table class="etable etable-compact"><caption class="visually-hidden">Members disclosing ${esc(
          t.ticker,
        )}, trailing 12 months</caption>` +
        `<thead><tr><th scope="col">Member</th><th scope="col">Buys</th><th scope="col">Sales</th><th scope="col">Flow range</th></tr></thead>` +
        `<tbody>${memberRows}</tbody></table></div>` +
        `<div class="card-foot">buys · sales · flow range — ranges cannot be netted</div>`;

  /* R10 #12: the compact preview is NOT paged, so its five rows ARE the whole
     set it speaks for — a flag universal among them is universal, full stop.
     This was the fifth flag-bearing renderer and the last one still repeating a
     caveat on every row; the whole-dist assertion in
     `test/post/universal-caveat.test.ts` is what named it. */
  const previewRows = t.txns.slice(0, 5);
  const statedPreview = universalFlags(previewRows.map(effectiveFlagKeys));
  const recent = opts.fullTable
    ? entityTxnTable(t.txns, {
        kind: "ticker",
        caption: `All congressional disclosures mentioning ${t.ticker}`,
        page: opts.page ?? 0,
        ctx,
      })
    : universalFlagNote(statedPreview) +
      `<div class="table-scroll"><table class="etable etable-compact" data-stated-flags="${esc(statedPreview.join(","))}"><caption class="visually-hidden">Latest congressional filings mentioning ${esc(
        t.ticker,
      )}</caption>` +
      `<thead><tr><th scope="col">Filed ▾</th><th scope="col">Member</th><th scope="col">Side · Owner</th><th scope="col">Traded · Lag</th><th scope="col">Amount</th><th scope="col">Range · Flags</th><th scope="col">Src</th></tr></thead>` +
      `<tbody>${entityTxnRowsHtml(previewRows, "ticker", ctx, statedPreview)}</tbody></table></div>` +
      `<div class="card-foot"><span>traded → filed dual dates on every row</span><a href="${congressTickerHref(
        t.ticker,
      )}">all ${fmtInt(t.txns.length)} ↗</a></div>`;

  return (
    `<div class="crumb">/tickers/${esc(t.ticker)} — one security, every public record we hold</div>` +
    `<header class="entity-head">` +
    `<div class="entity-head-copy">` +
    `<h1 class="entity-title">${tickerTitleHtml(info)} ${watchStarHtml("ticker", t.ticker, t.ticker, watched)}</h1>` +
    `<p class="entity-lede">Everything below is disclosure, not market data: what Congress filed about ${esc(
      t.ticker,
    )} and which institutions reported holding it. Each section keeps its own clock — congressional trades on the 45-day PTR clock, 13F holdings as quarter-end snapshots.</p>` +
    `</div>` +
    statTiles(tiles, { label: "Ticker disclosure statistics", compact: true }) +
    `</header>` +
    `<nav class="section-index" aria-label="Sections">` +
    `<a href="#congress" class="si-active">Congress <span class="si-n">${fmtInt(t.txns.length)}</span></a>` +
    `<a href="#institutional">Institutional${
      inst.state === "data" ? ` <span class="si-n">top ${fmtInt(inst.topn ?? 25)}</span>` : ""
    }</a>` +
    `<span class="si-soon">Financials <span class="badge-soon">SOON</span></span>` +
    `<span class="si-soon">Macro <span class="badge-soon">SOON</span></span>` +
    `<span class="si-asof">${asOfNote(stamps)} · build ${esc(stamps.buildId)}</span>` +
    `</nav>` +
    `<section class="page-section" id="congress">` +
    `<div class="section-head"><h2 class="section-h2">Congressional disclosures <span class="section-note-inline">· PTRs · statutory ranges · filed ≤45d late</span></h2>` +
    (opts.fullTable
      ? ""
      : `<a class="section-link" href="${congressTickerHref(t.ticker)}">full congressional view ↗</a>`) +
    `</div>` +
    `<div class="entity-grid">` +
    `<section class="panel" aria-label="Members disclosing">` +
    `<div class="panel-head"><h2 class="section-h">Members disclosing · trailing 12m</h2></div>` +
    membersCard +
    `</section>` +
    `<section class="panel" aria-label="Latest filings">` +
    `<div class="panel-head"><h2 class="section-h">${opts.fullTable ? "All filings" : "Latest filings"}</h2><span class="panel-note">filed date desc</span></div>` +
    recent +
    `</section>` +
    `</div>` +
    `</section>` +
    tickerInstSectionHtml(inst, t.ticker) +
    `<section class="page-section planned-grid" aria-label="Planned sections">` +
    `<div class="planned-card"><h2 class="section-h">Financials — as filed <span class="badge-soon">PLANNED</span></h2>` +
    `<p>${esc(t.ticker)}'s as-reported XBRL fundamentals will appear here when the financials module passes its gates. Until then: <a href="${esc(
      edgarTickerUrl(t.ticker),
    )}" rel="noopener" target="_blank">${esc(t.ticker)} on EDGAR ↗</a></p></div>` +
    `<div class="planned-card"><h2 class="section-h">Macro context <span class="badge-soon">PLANNED</span></h2>` +
    `<p>Rates, inflation, and positioning series land here with the macro module — vintage-aware, never nowcast.</p></div>` +
    `</section>` +
    footnoteBlock(
      info.mappedName
        ? [
            {
              mark: "†",
              html: `issuer name from the SEC's present-day ticker file (company_tickers.json) — a present-day mapping, not the name as of each filing`,
            },
          ]
        : [],
      { id: "ticker-footnotes" },
    )
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
  const tiles: StatTile[] = [
    { value: fmtInt(everMembers), label: "members · ever" },
    { value: fmtInt(t.txns.length), label: "transactions" },
    {
      value: flow12.kind === "empty" ? "—" : sumRangesText(flow12),
      label: "disclosed flow · trailing 12m",
      title: "sum of statutory bucket bounds — an interval, not an estimate of value",
    },
    { value: latestFiled ? latestFiled.slice(5) : "—", label: "latest filing" },
  ];
  const memberRows = disclosing
    .map(
      (m) =>
        `<tr><td class="c-member">${
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
    )} itself, and disclosed ranges cannot be netted into a position. <a href="/institutional/tickers/${esc(
      encodeURIComponent(t.ticker),
    )}/holders/">13F institutional holders of ${esc(t.ticker)} ↗</a></p>` +
    `</div>` +
    statTiles(tiles, { label: "Ticker disclosure statistics", compact: true }) +
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
        `<thead><tr><th scope="col">Member</th><th scope="col">Buys</th><th scope="col">Sales</th><th scope="col">Flow range</th></tr></thead>` +
        `<tbody>${memberRows}</tbody></table></div>`) +
    `<div class="card-foot">counts are filed transactions, not net positions — ranges cannot be netted</div>` +
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

/* ---------- 13F holders page body (build-time only) ---------- */

/* SL-R7: the two clauses `#holders-footnotes` published, each moved to the
   thing it qualifies — † to the issuer name in the lede (it is about the
   ticker→issuer mapping, not about a column), § to the Src column, which is
   where `srcLinkDerived` prints the marker. */
const HOLDERS_MAPPING_NOTE =
  `ticker→issuer via the SEC's present-day ticker file (company_tickers.json), matched only ` +
  `against entity-keyed issuers in the aggregate — a present-day mapping, not the name as of ` +
  `each filing`;
const HOLDERS_DERIVED_NOTE =
  `derived by Public Filings from the published aggregate (agg_issuer_top_holders); the ` +
  `mockup's per-holder filed dates, lags, share counts and document links are not in the ` +
  `published aggregate and are not shown — the EDGAR link opens the filer's 13F filings`;

export function holdersBody(
  ticker: string,
  issuerName: string,
  holders: (TopHolderRow & { tier?: FilerBudgetState })[],
  periods: string[],
  period: string,
  latestFiled: string | null,
  topn: number,
  window: FilingWindow | null,
): string {
  const active = holders.filter((h) => h.period_of_report === period);
  const totalValue = active.reduce((sum, h) => sum + h.value_usd, 0);
  const tiles: StatTile[] = [
    {
      value: fmtUsd(totalValue),
      label: `top-${fmtInt(active.length)} value`,
      title: `summed reported value of the ranked holders for ${period}; NULL-value positions are excluded from sums by the producer and surfaced beside them`,
    },
    { value: fmtInt(active.length), label: "ranked holders" },
  ];
  const chips = periods
    .map(
      (p) =>
        `<button class="chip${p === period ? " chip-active" : ""}" data-period="${esc(p)}" aria-pressed="${p === period}">${esc(p)}</button>`,
    )
    .join("");
  return (
    breadcrumb([
      { text: "/institutional", href: "/institutional/" },
      { text: "tickers" },
      { text: ticker },
      { text: "holders" },
    ]) +
    `<header class="entity-head">` +
    `<div class="entity-head-copy">` +
    `<h1 class="entity-title">Who holds <span class="mono-ticker">${esc(ticker)}</span></h1>` +
    `<p class="entity-lede">Institutional holders of ${esc(issuerName)}${fnMark("†")}` +
    noteFromHtml(HOLDERS_MAPPING_NOTE, { scope: "holders-lede" }, "issuer-mapping") +
    ` per 13F filings for the quarter ended <strong>${esc(
      period,
    )}</strong>. Long positions only; managers under $100M in 13(f) securities do not file. The ranking below is a top-${fmtInt(
      topn,
    )} slice of the Public Filings aggregate — not a census.</p>` +
    `</div>` +
    statTiles(tiles, { label: "Holder statistics", compact: true }) +
    `</header>` +
    (window?.open
      ? s7Banner(window)
      : "") +
    `<div class="period-row"><span class="period-label">Period</span><div class="chips" data-period-chips>${chips}</div>` +
    `<span class="period-note">quarter-end snapshots — positions may have changed since</span>` +
    `<noscript><span class="period-note">period switching needs JavaScript; showing ${esc(period)}</span></noscript></div>` +
    `<div data-holders-root>` +
    holdersTableHtml(active, period, latestFiled, topn) +
    `</div>`
  );
}

export function holdersTableHtml(
  rows: (TopHolderRow & { tier?: FilerBudgetState })[],
  period: string,
  latestFiled: string | null,
  topn: number,
  sort: { key: HolderSortKey; dir: "asc" | "desc" } = { key: "value", dir: "desc" },
): string {
  // Ordering is domain-owned (holders-sort.ts); this renderer only paints what
  // it is handed, so the server render and the client re-render cannot drift.
  // Flag hoisting is computed over ALL rows, never the sorted slice, so the
  // universal-flag note stays a property of the table rather than of an order.
  const statedRanked = universalFlags(rows.map((h) => h.flags));
  const { ranked, unranked } = orderRankedHolders(rows, sort.key, sort.dir);
  const rowHtml = (list: (TopHolderRow & { tier?: FilerBudgetState })[]): string =>
    list
    .map(
      (h) =>
        `<tr><td class="c-num c-muted">${fmtInt(h.rank)}</td>` +
        // ONE href primitive (R22): tier rides on the row through the SSR call
        // AND the embedded period payload, so both renders link identically.
        `<td class="c-filer"><a href="${esc(filerHref(h.cik, h.tier ?? "tail"))}">${esc(h.filer_name)}</a></td>` +
        `<td class="c-num c-strong">${esc(fmtUsd(h.value_usd))}</td>` +
        `<td class="c-num">${fmtInt(h.security_count)}</td>` +
        `<td class="c-keysrc"><span class="mono-note">${esc(h.issuer_key_source)}</span></td>` +
        `<td class="c-flags">${flagTags(h.flags, undefined, { stated: statedRanked })}</td>` +
        `<td class="c-src">${srcLinkDerived(null, edgarFilerUrl(h.cik))}</td></tr>`,
    )
    .join("\n");
  const body =
    rowHtml(ranked as (TopHolderRow & { tier?: FilerBudgetState })[]) +
    (unranked.length > 0
      ? `\n<tr class="unranked-sep"><td colspan="${HOLDER_COLUMNS.length}">${fmtInt(unranked.length)} row${unranked.length === 1 ? "" : "s"} have no ` +
        `value for the active sort key — listed below in rank order, never treated as zero</td></tr>\n` +
        rowHtml(unranked as (TopHolderRow & { tier?: FilerBudgetState })[])
      : "");
  /* SL-R5/R7: `HOLDER_COLUMNS.why` was declared REQUIRED for every unsortable
     column and then never rendered by this header — the reason a reader was
     promised existed only in the source. It renders now, as a note, together
     with the § clause that `#holders-footnotes` carried for the Src column.
     This table renders on `/institutional/tickers/[t]/holders/` only, which is
     in scope, so the scope is fixed here rather than threaded (SL-R2b applies
     to renderers shared with routes this run does not own). */
  const holderNote = (c: (typeof HOLDER_COLUMNS)[number]): string => {
    const body = noteBody(c.why, c.label === "Src" ? HOLDERS_DERIVED_NOTE : null);
    return body ? noteFromHtml(body, { scope: "holders-ranked" }, c.key ?? c.label) : "";
  };
  const heads = HOLDER_COLUMNS.map((c) =>
    c.key === null
      ? `<th scope="col">${esc(c.label)}${holderNote(c)}</th>`
      : `<th scope="col" data-sort="${c.key}" aria-sort="${c.key === sort.key ? (sort.dir === "desc" ? "descending" : "ascending") : "none"}">` +
        `<button type="button" class="th-sort">${esc(c.label)}</button>${holderNote(c)}</th>`,
  ).join("");
  return (
    `<div class="panel panel-wide">` +
    `<div class="panel-head"><h2 class="section-h">Ranked holders — ${esc(period)}</h2>` +
    `<span class="panel-note">${instStamp(period, latestFiled)}</span></div>` +
    universalFlagNote(statedRanked) +
    `<div class="table-scroll"><table class="etable" data-sticky-first data-holders-table data-stated-flags="${esc(statedRanked.join(","))}">` +
    `<caption class="visually-hidden">Top institutional holders for quarter ${esc(period)}</caption>` +
    `<thead><tr>${heads}</tr></thead>` +
    `<tbody data-holders-body>${body}</tbody></table></div>` +
    `<p class="section-note" data-holders-status role="status" aria-live="polite">${esc(holderSortNote(sort.key, sort.dir, unranked.length))}</p>` +
    terminusRow({
      author: "populus",
      html: `The aggregate publishes the top ${fmtInt(topn)} holders per issuer — a build parameter of the Public Filings aggregation. Rows beyond it exist in individual filings on EDGAR but are not ranked here. <a href="/methodology/#m2">methodology §13F ↗</a>`,
    }) +
    `<div class="caveat-line">${esc(INST_STAMP_CAVEAT)}</div>` +
    `<div class="caveat-line">${esc(HOLDER_ZERO_CAVEAT)}</div>` +
    `</div>`
  );
}

/* ---------- filer page body (build-time only) ---------- */

export function filerTiles(conc: ConcentrationRow | null, deltaCount: number): StatTile[] {
  if (conc === null) {
    return [
      { value: "—", label: "reported value", title: "no concentration row for this period" },
      { value: "—", label: "positions" },
      { value: "n/a ·§", label: "top-N share", muted: true },
      { value: "—", label: "QoQ moves" },
    ];
  }
  return [
    {
      value: fmtUsd(conc.total_value_usd),
      label: "reported value",
      title: `sum of disclosed values for ${conc.period_of_report}; ${conc.null_value_positions} positions carry a NULL value and are excluded from the sum, surfaced here rather than folded away`,
    },
    {
      value: fmtInt(conc.position_count),
      label: "positions",
      title: "ALL retained default holdings for this (filer, period), including NULL-value ones",
    },
    {
      value:
        conc.null_value_positions === 0
          ? "0"
          : fmtInt(conc.null_value_positions),
      label: "null-value positions",
      muted: conc.null_value_positions === 0,
      title: "holdings whose <value> did not parse — retained and counted, never zero-filled",
    },
    {
      value: conc.topn_share_bps == null ? "n/a ·§" : `${(conc.topn_share_bps / 100).toFixed(1)}%`,
      label: "top-N share ·§",
      muted: conc.topn_share_bps == null,
      title:
        conc.topn_share_bps == null
          ? "concentration_unavailable: the period's disclosed total is 0 (or every value is NULL) — the producer stores NULL, never a fabricated 0"
          : "share of the period's disclosed value held in the top-N positions; denominator is reported 13F value, not total assets",
    },
    {
      value: conc.hhi == null ? "n/a ·§" : fmtInt(conc.hhi),
      label: "HHI (bps) ·§",
      muted: conc.hhi == null,
      title:
        conc.hhi == null
          ? "concentration_unavailable: no disclosed denominator for this period"
          : "integer Herfindahl–Hirschman index in basis points over disclosed position values",
    },
    { value: fmtInt(deltaCount), label: "QoQ moves" },
  ];
}

export const QOQ_FOOTNOTES: FootnoteEntry[] = [
  {
    mark: "†v",
    html: `direction classified from reported value, not shares <code>classified_by_value</code>`,
  },
  {
    mark: "‡u",
    html: `reported unit changed across the pair (SH↔PRN); the share delta is withheld rather than fabricated <code>shares_unit_mismatch</code>`,
  },
  {
    mark: "‡r",
    html: `position matched across quarters by exact reported CUSIP over a registry gap — producer-reconciled identity, never a name match <code>identity_reconciled_by_cusip</code>`,
  },
  {
    mark: "‡e",
    html: `"exit" = absent this quarter: disposed, delisted, under confidential treatment, or reported instead by an affiliated manager — the filing does not say which`,
  },
  {
    mark: "n/c",
    html: `change not classifiable: value undisclosed on one side of the quarter pair, or neither shares nor value can classify it <code>value_undisclosed_one_side</code> <code>change_kind_undeterminable</code>`,
  },
  {
    mark: "§",
    html: `derived by Public Filings from the published aggregate; NULL means the source did not disclose a usable value — never zero`,
  },
];

const QOQ_FN = new Map(QOQ_FOOTNOTES.map((e) => [e.mark, e.html]));

/* SL-R7b/R7c: the position-changes table's `<thead>` is a literal with no sort
   key, so the plan supplies the column descriptors and the emitter-verified
   mark→column mapping. Read off where each marker is actually RENDERED, not off
   the column names: `qoqPresentation.chipMarkers` prints †v/‡e/n-c on the Change
   chip, `positionMarkers` prints ‡r beside the position key, ‡u withholds the
   share delta, and § is this variant's derivation clause — this table renders no
   Src column, so it hangs on Δ value (R7c). */
const QOQ_COL_NOTES: Record<string, string | undefined> = {
  "position-grain": QOQ_FN.get("‡r"),
  change: noteBody(QOQ_FN.get("†v"), QOQ_FN.get("‡e"), QOQ_FN.get("n/c")),
  "delta-value": QOQ_FN.get("§"),
  "delta-shares": QOQ_FN.get("‡u"),
};
const QOQ_COLS: readonly (readonly [string, string])[] = [
  ["position-grain", "Position · grain"],
  ["change", "Change"],
  ["delta-value", "Δ value"],
  ["delta-shares", "Δ shares"],
  ["prev-value", "Prev value"],
  ["curr-value", "Curr value"],
  ["prev-shares", "Prev shares"],
  ["curr-shares", "Curr shares"],
  ["flags", "Flags"],
];

export function qoqChipHtml(row: QoqDeltaRow): string {
  const p = qoqPresentation(row);
  const markers = p.chipMarkers.map((m) => fnMark(m)).join("");
  return `<span class="qoq-chip ${p.chipCls}">${esc(p.chipText)}</span>${markers}`;
}

export function changesTableHtml(
  deltas: QoqDeltaRow[],
  period: string,
  latestFiled: string | null,
  opts: { total?: number; page?: number } = {},
): string {
  /* `deltas` arrives already ordered and bounded by `holdings.boundQoqDeltas`;
     re-ordering here is idempotent and keeps this function correct for a caller
     that hands it a raw list. `total` is the count BEFORE the bound — it is
     what every printed count uses, so a capped page never understates the
     filer's activity while looking complete. */
  const ordered = sortQoqDeltas(deltas);
  const total = opts.total ?? ordered.length;
  const page = opts.page ?? 0;
  const embedded = ordered.length;
  const pageRows = holdingsPageSlice(ordered, page);
  const pageCount = holdingsPageCount(embedded);
  /* Over `ordered` — every row this table can page through — not `pageRows`.
     See the note in `holdings.ts`: a per-page set makes the caveat flicker
     between pages of one table. */
  const statedDeltas = universalFlags(ordered.map((d) => d.flags));
  const rows = pageRows
    .map((d) => {
      const p = qoqPresentation(d);
      const grain = p.grainNote ? ` <span class="mono-note">${esc(p.grainNote)}</span>` : "";
      const posMarkers = p.positionMarkers.map((m) => fnMark(m)).join("");
      const valueDelta =
        p.valueDelta.kind === "num"
          ? esc(p.valueDelta.text)
          : p.valueDelta.kind === "nc"
            ? `<span class="nc-chip">n/c</span>`
            : "—";
      const cell = (v: number | null): string => (v == null ? "—" : esc(fmtUsd(v)));
      const shareCell = (v: number | null): string => (v == null ? "—" : fmtInt(v));
      return (
        /* R6. Column order is the answer to "added or trimmed?" arriving before
           the reader has to scroll for it. The change chip used to be the
           EIGHTH of nine columns, behind six numeric ones, so on any viewport
           under ~1024px the one column the table exists to communicate was the
           one off-screen. Identity, then the verdict, then the two deltas that
           justify it; the four raw prev/curr levels are the supporting detail
           and follow. Nothing is removed — the order changed. */
        `<tr><td class="c-pos"><span class="mono-note${posMarkers ? " reconciled" : ""}">${esc(d.position_key)}</span>${posMarkers}${grain}</td>` +
        `<td class="c-chip">${qoqChipHtml(d)}</td>` +
        `<td class="c-num">${valueDelta}</td>` +
        `<td class="c-num">${esc(p.sharesDeltaText)}</td>` +
        `<td class="c-num">${cell(d.prev_value_usd)}</td>` +
        `<td class="c-num">${cell(d.curr_value_usd)}</td>` +
        `<td class="c-num">${shareCell(d.prev_shares)}</td>` +
        `<td class="c-num">${shareCell(d.curr_shares)}</td>` +
        `<td class="c-flags">${flagTags(d.flags, undefined, { stated: statedDeltas })}</td></tr>`
      );
    })
    .join("\n");
  return (
    universalFlagNote(statedDeltas) +
    `<div class="table-scroll"><table class="etable" data-sticky-first${
      pageCount > 1 ? ' data-paged="1"' : ""
    } data-stated-flags="${esc(statedDeltas.join(","))}">` +
    `<caption class="visually-hidden">Position changes into quarter ${esc(period)}</caption>` +
    `<thead><tr>` +
    QOQ_COLS.map(([key, label]) => {
      const body = QOQ_COL_NOTES[key];
      return (
        `<th scope="col">${esc(label)}` +
        (body ? noteFromHtml(body, { scope: "filer-changes" }, key) : "") +
        `</th>`
      );
    }).join("") +
    `</tr></thead>` +
    `<tbody>${rows}</tbody></table></div>` +
    changesPagerHtml(page, pageRows.length, embedded, pageCount) +
    /* The bound names itself, with the TRUE total — the grammar the holdings
       surface below already uses (G3). An uncapped period must render nothing
       here: a terminus on a complete list would claim a withholding that never
       happened, which is the same lie in the other direction. */
    (total > embedded
      ? terminusRow({
          author: "populus",
          html:
            `${fmtInt(total - embedded)} of this filer's ${fmtInt(total)} quarter-over-quarter ` +
            `changes for ${esc(period)} are not embedded in this page — the page byte budget ` +
            `caps the embed, and the largest changes are kept. The rest are in the published ` +
            `aggregate (agg_qoq_deltas) and derivable from the filings themselves. ` +
            `<a href="/methodology/#m2">methodology §13F ↗</a>`,
        })
      : "") +
    `<div class="panel-note table-stamp">${instStamp(period, latestFiled)} · <span class="caveat-inline">${esc(
      INST_STAMP_CAVEAT,
    )}</span></div>`
  );
}

/** The changes pager. Mirrors the holdings pager's markup and its range line so
    the two tables on one page behave identically; `data-changes-page` is the
    only new hook. A single page renders no pager at all. */
function changesPagerHtml(
  page: number,
  rowsOnPage: number,
  matched: number,
  pageCount: number,
): string {
  if (pageCount <= 1) return "";
  const range = holdingsRangeText({ page, rowsOnPage, matched, noun: "changes" });
  const btn = (dir: "prev" | "next", label: string, disabled: boolean): string =>
    `<button class="pager-btn" data-changes-page="${dir}" aria-disabled="${disabled}"${
      disabled ? " disabled" : ""
    }>${label}</button>`;
  return (
    `<div class="pager" data-changes-pager>` +
    btn("prev", "← previous", page <= 0) +
    `<span class="pager-range" tabindex="-1">${esc(range)}</span>` +
    btn("next", "next →", page >= pageCount - 1) +
    `</div>`
  );
}

export function filerPeriodSectionHtml(
  conc: ConcentrationRow | null,
  deltas: QoqDeltaRow[],
  period: string,
  latestFiled: string | null,
  topn: number,
  opts: { total?: number; page?: number } = {},
): string {
  /* `total` is the count before the embed bound. The tile MUST report it: a
     capped page that tiled `deltas.length` would state a smaller number of
     moves than the filer actually made, with nothing on the page saying so. */
  const total = opts.total ?? deltas.length;
  const changes =
    total === 0
      ? `<p class="section-note">No quarter-over-quarter rows land in ${esc(
          period,
        )} — either the first period on record for this filer, or nothing keyable on either side.</p>`
      : changesTableHtml(deltas, period, latestFiled, { total, page: opts.page });
  return (
    statTiles(filerTiles(conc, total), { label: `Period statistics for ${period}`, compact: true }) +
    `<section class="panel panel-wide" aria-label="Position changes">` +
    `<div class="panel-head"><h2 class="section-h">Position changes — into ${esc(period)}</h2>` +
    `<span class="panel-note">producer-classified (change_kind) · grain: position × put/call × unit</span></div>` +
    changes +
    terminusRow({
      author: "populus",
      html: `Changes derive from the aggregate's top-${fmtInt(topn)} slices and keyable positions only; unkeyable holdings are counted in the registry, not differenced. <a href="/methodology/#m2">methodology §13F ↗</a>`,
    }) +
    `</section>`
  );
}

export function filerEdgarBlock(cik: string, filerName: string): string {
  return (
    `<section class="edgar-block" aria-label="Full holdings on EDGAR">` +
    `<h2 class="section-h">The complete filing on EDGAR.</h2>` +
    `<p>The position list above is served from the published Public Filings build — every position this filer reported for the selected quarter, as it reported it. This block is <strong>provenance, not a substitute</strong>: the filing itself is the record, and it is one click away. Serving this list is <a href="/methodology/">M2-CONTRACT §3</a>, amended 2026-08-02; §3.1 keeps live EDGAR for filings newer than this build.</p>`+
    `<a class="cta" href="${esc(edgarFilerUrl(cik))}" rel="noopener" target="_blank">Open ${esc(
      filerName,
    )}'s 13F filings on SEC EDGAR ↗</a>` +
    `</section>`
  );
}

export function filerBody(
  filer: { cik: string; name: string; latestPeriod: string },
  periods: string[],
  period: string,
  conc: ConcentrationRow | null,
  deltas: QoqDeltaRow[],
  latestFiled: string | null,
  topn: number,
  window: FilingWindow | null,
  opts: { total?: number; page?: number } = {},
): string {
  const chips = periods
    .map(
      (p) =>
        `<button class="chip${p === period ? " chip-active" : ""}" data-period="${esc(p)}" aria-pressed="${p === period}">${esc(p)}</button>`,
    )
    .join("");
  return (
    breadcrumb([
      { text: "/institutional", href: "/institutional/" },
      { text: "filers" },
      { text: `CIK ${filer.cik}` },
    ]) +
    `<header class="entity-head">` +
    `<div class="entity-head-copy">` +
    `<h1 class="entity-title">${esc(filer.name)}</h1>` +
    `<div class="entity-subline">13F aggregate · latest period on record <span class="mono-id">${esc(
      filer.latestPeriod,
    )}</span> · <span class="mono-id">CIK ${esc(filer.cik)}</span> · <a class="mono-note" href="${esc(
      edgarFilerUrl(filer.cik),
    )}" rel="noopener" target="_blank">EDGAR ↗</a></div>` +
    // QA M2-8 M6: this used to be a THIRD phrasing of the §5 data_note, under a
    // heading one character away from the canonical box's ("What a 13F is — and
    // is not." vs "What a 13F is — and is not"), rendering on the same page — so
    // a reader met two same-titled blocks with different wording and no way to
    // know which was authoritative. It now states the one claim the header
    // itself must carry and POINTS at the canonical box rather than restating it.
    `<div class="explainer"><span class="explainer-h">A quarter-end snapshot.</span> ` +
    `Filed up to 45 days later, so this page is <strong>not current holdings</strong> ` +
    `and never a complete portfolio. ` +
    `<a href="#inst-data-note">what a 13F is — and is not ↓</a> · ` +
    `<a href="/methodology/#m2">methodology §13F ↗</a></div>` +
    `</div>` +
    `</header>` +
    (window?.open ? s7Banner(window) : "") +
    `<div class="period-row"><span class="period-label">Period</span><div class="chips" data-period-chips>${chips}</div>` +
    `<noscript><span class="period-note">period switching needs JavaScript; showing ${esc(period)}</span></noscript></div>` +
    `<div data-filer-root>` +
    filerPeriodSectionHtml(conc, deltas, period, latestFiled, topn, opts) +
    `</div>` +
    filerEdgarBlock(filer.cik, filer.name)
  );
}

/* ---------- states S1/S2/S4/S7 ---------- */

export function s1ModuleAbsent(reason: "module-absent" | "artifact-missing"): string {
  const detail =
    reason === "artifact-missing"
      ? `This build's manifest declares the institutional module, but its aggregate artifact is not readable here — so the pages hold back rather than render unverified numbers.`
      : `This build does not include the institutional module. When a build passes the module's publication gates, filer and holder pages render here from its published aggregate — until then, absence is stated instead of simulated.`;
  return (
    `<div class="s1-block">` +
    `<div class="s1-mark" aria-hidden="true"></div>` +
    `<h1 class="s1-h">This build withheld the institutional module — deliberately.</h1>` +
    `<p class="s1-detail">${detail}</p>` +
    `<p class="mono-note">module presence is read from the build manifest · <a href="/methodology/#m2">methodology §13F ↗</a></p>` +
    `</div>`
  );
}

export function s2OutOfExtract(kind: "m" | "t" | "f", key: string): string {
  const noun = kind === "m" ? "member" : kind === "t" ? "ticker" : "filer";
  const source =
    kind === "m"
      ? { label: "Open this member's official bioguide profile ↗", href: bioguideProfileUrl(key) }
      : kind === "f"
        ? { label: "Open this filer on SEC EDGAR ↗", href: edgarFilerUrl(key) }
        : { label: `Search ${key} on SEC EDGAR ↗`, href: edgarTickerUrl(key) };
  return (
    `<div class="s2-block">` +
    `<div class="crumb">/e/ · ${esc(kind)}:${esc(key)}</div>` +
    `<h1 class="s1-h">We don't render a page for this ${noun}.</h1>` +
    `<p class="s1-detail">It falls outside the published extract for this build. Rendering it here would mean showing numbers that haven't been through the pipeline's checks — so instead, here is the primary source itself:</p>` +
    `<a class="cta" href="${esc(source.href)}" rel="noopener" target="_blank">${esc(source.label)}</a>` +
    `<p class="mono-note">the extract boundary is a published budget, not a paywall</p>` +
    `</div>`
  );
}

export function s4Skeleton(endpoint: string, keyLabel: string): string {
  return (
    `<div class="s4-shell">` +
    `<div class="crumb">${esc(keyLabel)}</div>` +
    `<p class="s4-note">long-tail entity — rendered on your device from the same published extract <span class="mono-note">${esc(
      endpoint,
    )}</span></p>` +
    `<div class="feed-loading" aria-hidden="true">` +
    `<div class="bar" style="width:88%"></div><div class="bar" style="width:76%"></div>` +
    `<div class="bar" style="width:82%"></div><div class="bar" style="width:64%"></div></div>` +
    `<p class="mono-note">same-origin fetch · no external calls · identical template to pre-rendered pages</p>` +
    `<p class="visually-hidden" role="status">Loading the published record for this page.</p>` +
    `</div>`
  );
}

export type S4ErrorKind =
  | "server_error"
  | "network_error"
  | "bad_payload"
  | "version_mismatch"
  | "render_error"
  | "timeout"
  | "key_error";

export function s4Error(kind: S4ErrorKind, endpoint: string, detail: string, retryable: boolean): string {
  const heads: Record<S4ErrorKind, string> = {
    server_error: "The extract endpoint answered with an error.",
    network_error: "The request did not complete.",
    bad_payload: "The endpoint answered, but not with a usable record.",
    version_mismatch: "This page's code and the published data disagree on version.",
    render_error: "The record loaded but this page failed to draw it.",
    timeout: "This is taking too long.",
    key_error: "This is not a valid entity address.",
  };
  return (
    `<div class="s4-error" data-error-kind="${esc(kind)}">` +
    `<h1 class="s1-h">${esc(heads[kind])}</h1>` +
    `<p class="s1-detail">${esc(detail)} Nothing shown here is stale or invented — the published extract is still the record.</p>` +
    `<div class="s4-actions">` +
    (retryable ? `<button class="cta" data-retry>Try again</button>` : "") +
    (kind !== "key_error"
      ? `<a class="plain-link" href="${esc(endpoint)}">open the raw endpoint ↗</a>`
      : `<a class="plain-link" href="/congress/">back to the feed ↗</a>`) +
    `</div></div>`
  );
}

export function s7Banner(window: FilingWindow): string {
  return (
    `<div class="s7-banner" role="note">` +
    `<span class="s7-chip">FILING WINDOW OPEN</span>` +
    `<div class="s7-copy">Quarter <strong>${esc(window.quarterEnd)}</strong>: the 13F window is open until <strong>${esc(
      window.deadline,
    )}</strong>. Rankings and QoQ moves that touch this quarter are <strong>provisional by construction</strong> — filers who have not yet reported are not zeros.</div>` +
    `</div>`
  );
}

/* ---------- Home pieces (Locked #14: specimen from a real row) ---------- */

export function pickSpecimen(txns: readonly TxnRow[]): TxnRow | null {
  return (
    txns.find(
      (t) => t.ticker != null && t.traded != null && t.low != null && t.high != null,
    ) ?? null
  );
}

export function specimenCard(r: TxnRow, ctx: RenderCtx): string {
  const side = sideLabel(r.side, r.flags);
  const owner = ownerNote(r);
  const lagText = r.lag == null ? "" : ` <span class="spec-lag">+${r.lag}d</span>`;
  return (
    `<aside class="specimen" aria-label="What a number looks like here">` +
    `<div class="spec-head">what a number looks like here</div>` +
    `<div class="spec-body">` +
    `<div class="spec-row1"><span class="spec-name">${
      r.bioguide ? `<a href="${memberHrefFor(r.bioguide, ctx)}">${esc(r.name)}</a>` : esc(r.name)
    } <span class="aff ${partyClass(r.party)}">${esc(affTextOf(r))}</span></span>${srcLink(r.doc)}</div>` +
    `<div class="spec-row2"><span class="mono-ticker">${esc(r.ticker ?? "—")}</span>` +
    `<span class="spec-side ${side.cls}">${esc(side.text)}${owner ? ` <span class="owner-note">${esc(owner)}</span>` : ""}</span>` +
    `<span class="spec-amount">${esc(amountText(r))}</span></div>` +
    rangeBand(r) +
    `<div class="spec-scale" aria-hidden="true"><span>$1K</span><span>$1M</span><span>$50M+</span></div>` +
    `<div class="spec-dates">` +
    `<div><div class="spec-l">Traded</div><div class="spec-v">${esc(r.traded ?? "—")}</div></div>` +
    `<div><div class="spec-l">Filed</div><div class="spec-v">${esc(r.filed)}${lagText}</div></div>` +
    `<div><div class="spec-l">Amount</div><div class="spec-v">a range — an exact figure does not exist</div></div>` +
    `</div></div>` +
    `<div class="spec-foot">range · staleness · truncation · inference · receipt — <a href="/methodology/">the uncertainty grammar ↗</a></div>` +
    `</aside>`
  );
}

export interface ModuleCardStats {
  live: boolean;
  statLines: string[]; // mono stat lines, already true (build-derived)
}

export function moduleCard(
  name: string,
  href: string | null,
  desc: string,
  stats: ModuleCardStats,
): string {
  const badge = stats.live
    ? `<span class="badge-live">LIVE</span>`
    : `<span class="badge-planned">PLANNED</span>`;
  const inner =
    `<div class="mod-head"><span class="mod-name">${esc(name)}</span>${badge}</div>` +
    `<p class="mod-desc">${esc(desc)}</p>` +
    `<div class="mod-stats">${stats.statLines.map((l) => esc(l)).join("<br>")}</div>`;
  if (href && stats.live) {
    return `<a class="mod-card" href="${esc(href)}">${inner}</a>`;
  }
  return `<div class="mod-card mod-card-planned">${inner}</div>`;
}

/* ================================================================================
   C-4 — Congress rankings (ALPHA-UX): /congress gains Feed · Leaders · Tickers.
   Metric definitions are the C-4 contract in derive.ts (six-state net algebra,
   total display key, structural undisclosed bucket, strict-sign direction).
   ============================================================================ */

/** The /congress surface tabs. Feed is the existing index; Leaders and
    Tickers are build-time ranking tables. */
/* R1: `congressTabs` is DELETED. The sub-tab nav is the navigation the single
   /congress/ page exists to remove — comparing the three views was the thing
   that required leaving the page. Its two retired routes are static stubs
   (R25), and its CSS is removed with it rather than left as a dead selector. */

import {
  type CongressBasis,
  type CongressRange,
  type CongressRollup,
  type LeaderRow,
  type NetInterval,
  congressRangeBounds,
  congressTickersRollup,
  leadersRollup,
  windowStatement,
  netDirection,
  netIntervalText,
  netOverlaps,
  rankNetRows,
} from "./derive.ts";

import {
  congressRankingColumns,
  overlapFlags,
  sortRankingRows,
  type CongressColumn,
  type CongressSortKey,
  RANKING_FOOTNOTES as RANKING_FOOTNOTES_LIST,
} from "./congress-columns.ts";

/* SL-R6/R7: `footnotesId` is gone from this path. It existed ONLY so the ≈
   marker could point at whichever of /congress/'s two ranking footnote blocks
   belonged to its section. R7 deletes both blocks and moves their text onto the
   Net column's header note, so there is no id left to thread — and threading a
   dangling one would be the broken internal link R23's own check forbids. The
   marker itself stays visible (LD3); only its href is gone. */
function netCellHtml(net: NetInterval, overlapsPrev: boolean): string {
  const dir = netDirection(net);
  const dirHtml =
    dir === "accumulation"
      ? ` <span class="net-dir net-acc">net accumulation</span>`
      : dir === "disposal"
        ? ` <span class="net-dir net-dis">net disposal</span>`
        : "";
  const overlap = overlapsPrev ? fnMark("≈") : "";
  return `${esc(netIntervalText(net))}${dirHtml}${overlap}`;
}

function rankingRowHtml(
  r: LeaderRow,
  pos: number | null,
  overlapsPrev: boolean,
  kind: "leaders" | "tickers",
  ctx: RenderCtx,
): string {
  const who =
    kind === "tickers"
      ? `<a href="${tickerHrefFor(r.id, ctx)}">${esc(r.id)}</a>`
      : r.bioguide
        ? `<a href="${memberHrefFor(r.bioguide, ctx)}">${esc(r.name)}</a> <span class="aff ${partyClass(r.party)}">${esc(
            affTextOf(r),
          )}</span>`
        : `<span class="unjoined-name">${esc(r.name)}</span> <span class="aff ${partyClass(r.party)}">${esc(affTextOf(r))}</span>`;
  const lateCell =
    r.lateDenom === 0
      ? `<span class="none">—</span>`
      : `${fmtInt(r.late)} of ${fmtInt(r.lateDenom)}`;
  return (
    `<tr><td class="c-num c-muted">${pos == null ? "" : fmtInt(pos)}</td>` +
    `<td class="c-member">${who}</td>` +
    `<td class="c-num">${fmtInt(r.txns)}</td>` +
    `<td class="c-num c-buy">${fmtInt(r.buys)}</td>` +
    `<td class="c-num c-sell">${fmtInt(r.sells)}</td>` +
    `<td class="c-num">${flowCellHtml(r.purchases)}</td>` +
    `<td class="c-num">${flowCellHtml(r.sales)}</td>` +
    `<td class="c-num c-net">${netCellHtml(r.net, overlapsPrev)}</td>` +
    `<td class="c-num">${lateCell}</td></tr>`
  );
}

/* SL-R6/R7: `RANKING_FOOTNOTES` moved to `congress-columns.ts`, which is where
   the columns that now carry its text are declared, and is re-exported here so
   no consumer's import path changed. `RANKING_FOOTNOTES_ID` is retired with the
   block it named — the section no longer renders a footnote container. */
export { RANKING_FOOTNOTES } from "./congress-columns.ts";

/* ---------- R2/R5/R6/R7/R18/R19: the congress ranking sections ------------

   ONE renderer serves BOTH ranking sections: the ticker momentum section that
   leads /congress/ and the member net-flow section that closes it. They order
   the same `LeaderRow` shape through the same contract, so a second renderer
   would be two copies of one set of honesty rules.

   RENDER ROOTS ARE EXPLICIT AND SINGLY OWNED (R18). Each `tbody` carries an id,
   one renderer writes it, and a header sort replaces ONLY that `tbody` — never
   the enclosing table, thead, caption, or a sibling root. The member ranking's
   wholly-undisclosed bucket is a SEPARATE table with a SEPARATE root precisely
   so no sort of the ranked table can reach into it. */

/** The ids every congress render root is addressed by. Declared once so the
    server, the client island and the browser tests cannot drift apart — a sort
    that writes an id nobody renders is a silent no-op. */
export const CONGRESS_ROOTS = {
  momentum: "momentum-tbody",
  feed: "feed-tbody",
  membersRanked: "members-ranked-tbody",
  membersUndisclosed: "members-undisclosed-tbody",
} as const;

export interface RankingSectionOpts {
  /** the tbody id this section's ranked rows render into */
  rootId: string;
  /** the tbody id for the wholly-undisclosed bucket, when the section has one */
  undisclosedRootId?: string;
  /** rendered above the table; the section's own heading */
  heading: string;
  /** id for the section element, so the retired sub-tab stubs can anchor to it */
  sectionId: string;
  /** render the range/basis control (momentum only) */
  controls?: boolean;
  /** rows rendered while collapsed */
  compact?: number;
  /** SL-R14. What the SAME corpus holds on the other basis and at the next
      wider range. Supplied by the caller because only the caller holds the
      full row set — the rollup handed to this renderer is already windowed.
      Absent means "not computed", and the empty-window block then states the
      lag without offering a switch it cannot price. */
  alternatives?: RankingAlternatives;
}

/** The sortable header row. A sortable column carries its key and a real
    button; an unsortable one carries its stated reason as visible text, not a
    title attribute — a tooltip is not a channel this site treats as published.
    `aria-sort` starts on the column the server actually ordered by. */
function rankingHeadHtml(
  cols: CongressColumn[],
  active: CongressSortKey,
  dir: "asc" | "desc",
  notes: NoteCtx,
): string {
  return cols
    .map((c) => {
      if (!c.sortable) {
        return (
          `<th scope="col"${c.numeric ? ' class="c-num"' : ""}>${esc(c.label)}` +
          colWhyHtml(c.why, notes, c.key ?? c.label) + `</th>`
        );
      }
      const sortAttr = c.key === active ? (dir === "desc" ? "descending" : "ascending") : "none";
      /* SL-R6: a SORTABLE column can carry a note too — the ranking footnotes
         qualified Txns, Late and the three flow columns, all of which sort. The
         key is `c.key`, non-null on this branch by the type. R25 keeps the
         button's click out of the sort handler. */
      return (
        `<th scope="col"${c.numeric ? ' class="c-num"' : ""} data-congress-sort="${esc(c.key)}" ` +
        `data-congress-dir="${c.defaultDir}" aria-sort="${sortAttr}">` +
        `<button class="th-sort" type="button">${esc(c.label)}</button>` +
        (c.note ? noteFromHtml(c.note, notes, c.key) : "") +
        `</th>`
      );
    })
    .join("");
}

/** The ranked rows for one root, at a given sort. Exported because the client
    island renders the SAME function over the SAME rows — that identity is what
    the R3 parity test compares, and it is why no second row renderer exists. */
export function rankingRowsHtml(
  rows: readonly LeaderRow[],
  kind: "leaders" | "tickers",
  ctx: RenderCtx,
  opts: { numbered?: boolean; startAt?: number } = {},
): string {
  // R18: the incomparability marker is recomputed from THIS order. Carrying a
  // marker over from a previous sort would claim an overlap against a row that
  // is no longer above it.
  const flags = overlapFlags(rows);
  const numbered = opts.numbered ?? true;
  const start = opts.startAt ?? 1;
  return rows
    .map((r, i) => rankingRowHtml(r, numbered ? start + i : null, flags[i]!, kind, ctx))
    .join("\n");
}

/** The rows an interval sort could not rank, with their own stated separator.
    They are NOT the undisclosed bucket — see `sortRankingRows`. */
function unrankableSeparatorHtml(n: number, colspan: number, columnLabel: string): string {
  return (
    `<tr class="unranked-sep"><td colspan="${colspan}">${fmtInt(n)} ` +
    `${n === 1 ? "row discloses" : "rows disclose"} no amount at all for “${esc(columnLabel)}”, ` +
    `so ${n === 1 ? "it has" : "they have"} no endpoints to rank by — listed after every ranked ` +
    `row, never coerced to $0</td></tr>`
  );
}

/** The full body for one root at one sort: ranked rows, then the separator and
    the rows this column cannot rank. One function so the server and the client
    produce identical bytes. */
export function rankingRootHtml(
  rows: readonly LeaderRow[],
  key: CongressSortKey,
  dir: "asc" | "desc",
  kind: "leaders" | "tickers",
  ctx: RenderCtx,
  opts: { compact?: number } = {},
): { html: string; total: number; shown: number } {
  const cols = congressRankingColumns(kind);
  const { ranked, unrankable } = sortRankingRows(rows, key, dir);
  const total = ranked.length + unrankable.length;
  const limit = opts.compact ?? total;
  const rankedShown = ranked.slice(0, limit);
  // The compact slice is a bound on the WHOLE table, so it consumes the ranked
  // rows first and only then the unrankable tail — otherwise collapsing could
  // drop every ranked row and show only the tail.
  const unrankableShown = unrankable.slice(0, Math.max(0, limit - ranked.length));
  const activeLabel =
    cols.find((c) => c.sortable && c.key === key)?.label ?? key;
  return {
    html:
      rankingRowsHtml(rankedShown, kind, ctx) +
      // F5: the separator states that rows exist which this column CANNOT
      // rank. That is a stated absence, so it renders whenever the bucket is
      // non-empty — NOT only when a bucket row happens to survive the compact
      // slice. Ten ranked rows followed by unrankable ones used to hide the
      // fact that the unrankable ones existed at all, which is exactly the
      // omission R19 forbids.
      (unrankable.length > 0
        ? "\n" +
          unrankableSeparatorHtml(unrankable.length, cols.length, activeLabel) +
          (unrankableShown.length > 0
            ? "\n" +
              rankingRowsHtml(unrankableShown, kind, ctx, { numbered: false })
            : "")
        : ""),
    total,
    shown: rankedShown.length + unrankableShown.length,
  };
}

/** The range and basis control (R2). Both are segmented buttons, matching the
    feed's existing `.seg` control, so there is one interaction idiom on the
    page. With scripting off they are inert, which is why the section states
    the window it actually rendered rather than relying on the control to. */
function rangeControlHtml(range: CongressRange, basis: CongressBasis): string {
  const seg = (
    group: "range" | "basis",
    label: string,
    values: readonly (readonly [string, string])[],
    active: string,
  ): string =>
    `<div class="filter-group" role="group" aria-label="${esc(label)}">` +
    `<span class="filter-label" aria-hidden="true">${esc(label)}</span><div class="seg">` +
    values
      .map(
        ([v, text]) =>
          `<button type="button" data-${group}="${esc(v)}" aria-pressed="${v === active}">${esc(text)}</button>`,
      )
      .join("") +
    `</div></div>`;
  return (
    `<div class="range-control" id="momentum-controls">` +
    seg("range", "Range", [["7d", "7d"], ["30d", "30d"], ["90d", "90d"], ["12m", "12m"]], range) +
    seg("basis", "Dates", [["traded", "traded"], ["filed", "filed"]], basis) +
    `<noscript><span class="caveat-inline">the range and basis controls need JavaScript — ` +
    `the window rendered below is stated in full beside the heading</span></noscript>` +
    `</div>`
  );
}

/** The exclusion clauses for a rollup. Every clause is a count of rows the
    reader cannot see and why — never a silent shrink. */
/* SL-R11/R12/LD4. The clauses and their SUMMED ROW TOTAL are produced by ONE
   pass over one list, so the visible suffix and the note body cannot disagree.
   That is the whole point: a stale count inside a hover is worse than one on
   the page, because nobody sees it go wrong. */
function exclusionParts(
  rollup: CongressRollup & { noTickerRows?: number },
  kind: "leaders" | "tickers",
): { n: number; text: string }[] {
  const out: { n: number; text: string }[] = [];
  if (rollup.dateAnomalies > 0)
    out.push({
      n: rollup.dateAnomalies,
      text:
        `${fmtInt(rollup.dateAnomalies)} date-anomaly ${
          rollup.dateAnomalies === 1 ? "row" : "rows"
        } excluded from the trade-date window (impossible trade dates)`,
    });
  if (rollup.undated > 0)
    out.push({
      n: rollup.undated,
      text:
        `${fmtInt(rollup.undated)} ${
          rollup.undated === 1 ? "row discloses" : "rows disclose"
        } no trade date and cannot be placed in a trade-date window — switch the basis to filing date to include them`,
    });
  if (kind === "tickers" && (rollup.noTickerRows ?? 0) > 0)
    out.push({
      n: rollup.noTickerRows!,
      text:
        `${fmtInt(rollup.noTickerRows!)} in-window rows disclose no ticker and cannot appear in a ticker ranking — ` +
        `the largest disclosers by flow can be entirely non-equity; the member ranking below is keyed by member instead`,
    });
  return out;
}

export function rankingExclusions(
  rollup: CongressRollup & { noTickerRows?: number },
  kind: "leaders" | "tickers",
): string[] {
  return exclusionParts(rollup, kind).map((p) => p.text);
}

/** SL-R11/LD4: the SUMMED excluded-row magnitude — never a count of categories.
    Round-1 review objected that "· 3 exclusions" surfaces the number of
    CATEGORIES while burying the number of ROWS, which is the honesty-bearing
    figure. The owner accepted it. This is that figure. */
export function rankingExcludedRows(
  rollup: CongressRollup & { noTickerRows?: number },
  kind: "leaders" | "tickers",
): number {
  return exclusionParts(rollup, kind).reduce((sum, p) => sum + p.n, 0);
}

/** SL-R11/R12: the window statement AND its excluded-row suffix AND the note
    carrying the per-category clauses — one function, so the server render and
    the client rewrite are the same bytes by construction rather than by two
    call sites remembering to agree. */
export function rankingWindowHtml(
  windowText: string,
  rollup: CongressRollup & { noTickerRows?: number },
  kind: "leaders" | "tickers",
  sectionId: string,
): string {
  const clauses = rankingExclusions(rollup, kind);
  if (clauses.length === 0) return esc(windowText);
  const rows = rankingExcludedRows(rollup, kind);
  /* LD4, the mitigation the owner directed: the SIZE of what the reader cannot
     see stays on the page at every width, and is the note's anchor. The three
     per-category counts and their definitions live in the note body. */
  return (
    `${esc(windowText)} · ${fmtInt(rows)} ${rows === 1 ? "row" : "rows"} excluded` +
    note(clauses.join(" · "), { scope: "window" }, sectionId)
  );
}


/* ------------------------------------------------ SL-R14: the empty window */

/** The ordered range vocabulary, single-sourced from the control that offers
    it — so "the next wider range" cannot disagree with what is clickable. */
export const CONGRESS_RANGES: readonly CongressRange[] = ["7d", "30d", "90d", "12m"];

export interface RankingAlternatives {
  /** rankable rows this window holds on the OTHER date basis */
  otherBasis: number;
  /** the next wider range and what it holds, or null at the widest */
  wider: { range: CongressRange; n: number } | null;
}

/** SL-R14. Both alternatives are computed from the rows in hand, by the SAME
    rollup functions the view uses, so a stated count cannot disagree with what
    the control paints when the reader presses it. */
export function rankingAlternatives(
  rows: readonly TxnRow[],
  generatedAtDate: string,
  kind: "leaders" | "tickers",
  range: CongressRange,
  basis: CongressBasis,
): RankingAlternatives {
  const roll = kind === "tickers" ? congressTickersRollup : leadersRollup;
  const other: CongressBasis = basis === "traded" ? "filed" : "traded";
  const i = CONGRESS_RANGES.indexOf(range);
  const widerRange = i >= 0 && i < CONGRESS_RANGES.length - 1 ? CONGRESS_RANGES[i + 1]! : null;
  /* CODE-REVIEW F2: count the rows that can actually ENTER the ranked table,
     not every row in the rollup. `rankNetRows` moves a wholly-undisclosed row
     into its own bucket with its own root, unreachable by any sort of the
     ranked table — so a rollup of one undisclosed row has `rows.length === 1`
     and `ranked.length === 0`. Counting the former made the empty-window block
     offer "1 by filing date", and activating that control produced another
     empty ranked table. R14 forbids exactly that: an offer that resolves to
     nothing is worse than stating the window is empty, because it spends the
     reader's trust as well as their click. Same derivation as the section
     itself uses at the `rankNetRows` call above, so the two cannot disagree. */
  const rankableAt = (r: CongressRange, b: CongressBasis): number =>
    rankNetRows(roll(rows, generatedAtDate, { range: r, basis: b }).rows, (x) => x.net, (x) => x.id).ranked.length;
  return {
    otherBasis: rankableAt(range, other),
    wider: widerRange === null ? null : { range: widerRange, n: rankableAt(widerRange, basis) },
  };
}

/** SL-R14 / LD2. `7d` stays offered: an empty window is a true and interesting
    fact about the corpus — the statutory filing lag — so the section STATES it
    instead of the control being hidden or the tbody painting empty with no
    explanation, which is what `rankingRootHtml([])` produced before.

    TERMINAL BRANCHES, both real and both tested: at `12m` there is no wider
    range, so only the other basis is named; and when the other basis is ALSO
    zero at that range, the block says the corpus holds no rankable rows in this
    window on either basis and offers NO control — it never renders a switch
    that would change nothing. */
export function emptyWindowHtml(
  range: CongressRange,
  basis: CongressBasis,
  alt: RankingAlternatives,
  noun: string,
): string {
  const basisWord = basis === "traded" ? "trade date" : "filing date";
  const otherWord = basis === "traded" ? "filing date" : "trade date";
  const lag =
    `No ${esc(noun)} disclose a ${esc(basisWord)} inside this ${esc(range)} window. That is a fact about the ` +
    `corpus, not a gap in it: a Periodic Transaction Report may be filed up to 45 days after the ` +
    `trade, so a short window measured by trade date can be genuinely empty while filings arrive.`;
  const offers: string[] = [];
  if (alt.otherBasis > 0)
    offers.push(
      `<button type="button" class="linklike" data-basis="${esc(basis === "traded" ? "filed" : "traded")}">` +
        `${fmtInt(alt.otherBasis)} by ${esc(otherWord)}</button>`,
    );
  if (alt.wider && alt.wider.n > 0)
    offers.push(
      `<button type="button" class="linklike" data-range="${esc(alt.wider.range)}">` +
        `${fmtInt(alt.wider.n)} at ${esc(alt.wider.range)}</button>`,
    );
  const body =
    offers.length > 0
      ? `${lag} The same corpus holds ${offers.join(" and ")}.`
      : `${lag} The corpus holds no rankable ${esc(noun)} in this window on either basis` +
        `${alt.wider === null ? " and there is no wider range to offer" : ""}, so no switch is offered — ` +
        `a control that would change nothing is worse than none.`;
  return `<p class="section-note empty-window">${body}</p>`;
}

/** One ranking section — used for BOTH the ticker momentum section and the
    member net-flow section. SSR renders the authoritative default view; the
    client re-renders only the roots. */
export function congressRankingSection(
  kind: "leaders" | "tickers",
  rollup: CongressRollup & { noTickerRows?: number },
  stamps: BuildStamps,
  ctx: RenderCtx,
  opts: RankingSectionOpts,
): string {
  const cols = congressRankingColumns(kind);
  const compact = opts.compact ?? COMPACT_ROWS;
  const bounds = congressRangeBounds(rollup.range, stamps.generatedAtDate);
  const windowText = windowStatement(rollup.range, rollup.basis, bounds);

  // R6/R18: the wholly-undisclosed bucket is fixed by the NET interval and
  // computed ONCE here. It gets its own table and its own root, so it is not
  // reachable by any sort of the ranked table.
  const { ranked, undisclosedBucket } = rankNetRows(
    rollup.rows,
    (r) => r.net,
    (r) => r.id,
  );

  const main = rankingRootHtml(ranked, "net", "desc", kind, ctx, { compact });
  const bucket = rankingRootHtml(undisclosedBucket, "name", "asc", kind, ctx, { compact });

  const caption =
    kind === "leaders"
      ? `Members ranked by net disclosed flow, ${windowText}`
      : `Tickers ranked by net disclosed flow, ${windowText}`;
  const noun = kind === "leaders" ? "members" : "tickers";
  return (
    `<section class="panel panel-wide" id="${esc(opts.sectionId)}" aria-label="${esc(caption)}">` +
    `<div class="panel-head"><h2 class="section-h">${esc(opts.heading)}</h2>` +
    `<span class="panel-note" id="${esc(opts.sectionId)}-window">` +
    rankingWindowHtml(windowText, rollup, kind, opts.sectionId) +
    `</span></div>` +
    (opts.controls ? rangeControlHtml(rollup.range, rollup.basis) : "") +
    /* SL-R13/R29: the pending indicator. NOT a queue — `range` and `basis` are
       module state and `receiveRows` already reapplies them, so a pre-arrival
       click has always been applied. The defect is that `setSeg` paints the
       button pressed at click time, so between the click and the dataset's
       arrival the control asserts a window the table has not painted. This
       node lets it say so instead. It ships in the SSR bytes and starts hidden
       because a client cannot reveal an element that was never rendered. */
    (opts.controls
      ? `<p class="section-note pending-note" id="${esc(opts.sectionId)}-pending" role="status" aria-live="polite" hidden></p>`
      : "") +
    /* SL-R6: the three prose claims this paragraph carried are now notes on the
       columns they are about — interval-ness and the § derivation on the three
       flow columns, the direction rule and the ≈ incomparability rule on Net.
       The paragraph itself is gone; its `<noscript>` is NOT, because that
       sentence is about scripting rather than about a column, so no column note
       is the right home for it and a no-JavaScript reader must still get it. */
    `<p class="section-note"><noscript>Sorting by column header needs JavaScript; the order below is by net disclosed flow, largest first.</noscript></p>` +
    `<div class="table-scroll"><table class="etable" data-sticky-first>` +
    `<caption class="visually-hidden">${esc(caption)}</caption>` +
    `<thead><tr>${rankingHeadHtml(cols, "net", "desc", { scope: `rank-${opts.sectionId}` })}</tr></thead>` +
    `<tbody id="${esc(opts.rootId)}">${main.html}</tbody></table></div>` +
    /* SL-R14 / LD2: a zero-rankable window STATES itself. The container ships
       in both states so the client can fill it when a range change empties the
       window — an element that was never rendered cannot be filled in later,
       which is the F16 lesson applied to this block. */
    `<div id="${esc(opts.sectionId)}-empty">` +
    (main.total === 0
      ? emptyWindowHtml(
          rollup.range,
          rollup.basis,
          opts.alternatives ?? { otherBasis: 0, wider: null },
          noun,
        )
      : "") +
    `</div>` +
    // The terminus row states the bound in BOTH states — it is not a
    // consequence of collapsing, it is the fact that the table is bounded.
    // F16: the terminus renders in BOTH states — visible when rows are held
    // back, hidden-but-present when they are not. A momentum range change can
    // take this table from "everything fits" to "833 tickers, 10 shown", and
    // the client can only reveal a notice that exists.
    terminusRow({
      author: "populus",
      hidden: main.total <= main.shown,
      html:
        `${fmtInt(Math.max(0, main.total - main.shown))} further ranked ${esc(noun)} are not rendered above — ` +
        `a Public Filings render bound, not a data bound. Every row remains in the ` +
        `<a href="/congress/data/feed.v1.json">published dataset</a>.`,
    }) +
    compactDisclosure({ rootId: opts.rootId, total: main.total, shown: main.shown, noun }) +
    (undisclosedBucket.length > 0 && opts.undisclosedRootId
      ? `<div class="unrankable-block"><h3 class="section-h">Not rankable — amounts wholly undisclosed</h3>` +
        `<p class="section-note">These rows include at least one side whose every amount failed to parse. ` +
        `They have no endpoints, so they hold no position in the ranking — listed after it, never sorted ` +
        `to the bottom as if small, and never merged into it by any sort.</p>` +
        `<div class="table-scroll"><table class="etable">` +
        `<caption class="visually-hidden">Unrankable ${esc(noun)} — amounts wholly undisclosed</caption>` +
        `<thead><tr>${rankingHeadHtml(cols, "name", "asc", { scope: `undisc-${opts.sectionId}` })}</tr></thead>` +
        `<tbody id="${esc(opts.undisclosedRootId)}">${bucket.html}</tbody></table></div>` +
        (bucket.total > bucket.shown
          ? terminusRow({
              author: "populus",
              html: `${fmtInt(bucket.total - bucket.shown)} further wholly-undisclosed ${esc(noun)} are not rendered above.`,
            })
          : "") +
        compactDisclosure({
          rootId: opts.undisclosedRootId,
          total: bucket.total,
          shown: bucket.shown,
          noun,
        }) +
        `</div>`
      : "") +
    /* SL-R11: the visible `.caveat-line` and its `#<sectionId>-caveat` root are
       DELETED. Unlike R10's terminus rows, nothing is lost to a reader with
       scripting off: the clauses moved into a note, which opens declaratively
       through `popovertarget` with no JavaScript at all, and their SUMMED ROW
       TOTAL stays visible on the window statement at every width (LD4). */
    `</section>`
  );
}

/* ---------- R9/R20/R21: the recently-added-issuers leaderboard ---------- */

import { addsRowHtml } from "./inst-adds-render.ts";
import {
  ADDS_MODES,
  addsNoteHtml,
  addsPayloadHref,
  type AddsMode,
  type AddsPayload,
} from "./inst-adds.ts";

export const ADDS_FOOTNOTES: FootnoteEntry[] = [
  {
    mark: "‡",
    html:
      `a <strong>partial</strong> sum omits at least one position whose value the source did not ` +
      `disclose. It is a lower bound on what was added, never a total — and an issuer whose every ` +
      `contributing delta was undisclosed renders an em dash, never <code>$0</code>`,
  },
  {
    mark: "§",
    html:
      `"issuer" is an <strong>issuer key</strong>, not a ticker: its source may be a resolved entity ` +
      `link, a CUSIP-6 issuer block, or a normalized reported name, and each is a weaker claim than ` +
      `the one before it. The key and its source are printed so the strength of the identity is visible`,
  },
  {
    mark: "†",
    html:
      `the top adder is the manager whose positions in this issuer <strong>sum</strong> to the largest ` +
      `disclosed increase this quarter — summed across every security of the issuer first, then ranked, ` +
      `so a manager holding several share classes is not split into pieces that each look small`,
  },
];

const ADDS_FN = new Map(ADDS_FOOTNOTES.map((e) => [e.mark, e.html]));

/** F3: the leaderboard's column contract. Its orders are well-defined — every
    column is a scalar, a name, or the same nullable-value ordering the payload
    is already sorted by — so success criterion 2 requires them to be sortable,
    and the one column that is not states why. Comparators stay caller-owned. */
export type AddsSortKey = "issuer" | "managers" | "new" | "value" | "adder";

export function addsColumns(): CongressColumn[] {
  return [
    {
      sortable: false,
      key: null,
      label: "#",
      numeric: true,
      why:
        "the rank number is produced by the active sort, not held by the row — ordering by it " +
        "would be circular, so it renumbers with every sort instead",
    },
    /* SL-R7: each mark's text moves onto the column it qualified —
       § → Issuer, ‡ → Δ value added, † → Top adder — read off ADDS_FOOTNOTES
       rather than retyped, so the two cannot drift. */
    {
      sortable: true,
      key: "issuer" as never,
      label: "Issuer ·§",
      defaultDir: "asc",
      numeric: false,
      note: ADDS_FN.get("§"),
    },
    { sortable: true, key: "managers" as never, label: "Managers", defaultDir: "desc", numeric: true },
    { sortable: true, key: "new" as never, label: "New positions", defaultDir: "desc", numeric: true },
    {
      sortable: true,
      key: "value" as never,
      label: "Δ value added ·‡",
      defaultDir: "desc",
      numeric: true,
      note: ADDS_FN.get("‡"),
    },
    {
      sortable: true,
      key: "adder" as never,
      label: "Top adder ·†",
      defaultDir: "asc",
      numeric: false,
      note: ADDS_FN.get("†"),
    },
  ];
}

function addsHeadHtml(
  cols: CongressColumn[],
  active: string,
  dir: "asc" | "desc",
  notes: NoteCtx,
): string {
  return cols
    .map((c) => {
      if (!c.sortable) {
        return (
          `<th scope="col"${c.numeric ? ' class="c-num"' : ""}>${esc(c.label)}` +
          colWhyHtml(c.why, notes, c.key ?? c.label) + `</th>`
        );
      }
      const sortAttr = c.key === active ? (dir === "desc" ? "descending" : "ascending") : "none";
      // SL-R7: same rule as the ranking head — Issuer, Δ value and Top adder
      // are sortable AND carry a mark, so the note hangs off the sortable
      // branch as well.
      return (
        `<th scope="col"${c.numeric ? ' class="c-num"' : ""} data-adds-sort="${esc(String(c.key))}" ` +
        `data-adds-dir="${c.defaultDir}" aria-sort="${sortAttr}">` +
        `<button class="th-sort" type="button">${esc(c.label)}</button>` +
        (c.note ? noteFromHtml(c.note, notes, String(c.key)) : "") +
        `</th>`
      );
    })
    .join("");
}

export interface AddsSectionOpts {
  /** rows rendered while collapsed */
  compact?: number;
  period: string;
  mode: AddsMode;
  /** every period the selector may offer — closed periods only (R20) */
  periods: readonly string[];
  buildId: string;
}

/** The leaderboard section: closed-period selector, new-only toggle, the note
    composed from BOTH independent omission states, and the bounded table. */
export function addsSectionHtml(payload: AddsPayload, opts: AddsSectionOpts): string {
  // F10: the payload arrives ALREADY BOUNDED, from the endpoint or from the
  // page's single `boundAdds` call. Re-bounding here reported `truncated:
  // false` — the omitted rows were already gone, so there was nothing left to
  // notice — which silently erased the truncation notice on the no-JS view.
  const total = payload.rows.length;
  const shown = Math.min(total, opts.compact ?? COMPACT_ROWS);
  const rows = payload.rows.slice(0, shown).map((r, i) => addsRowHtml(r, i + 1)).join("\n");
  const cols = addsColumns();

  const periodBtns = opts.periods
    .map(
      (p) =>
        `<button type="button" class="mgr-chip" data-adds-period="${esc(p)}" aria-pressed="${
          p === opts.period
        }">${esc(p)}</button>`,
    )
    .join("");
  const modeBtns = ADDS_MODES.map(
    (m) =>
      `<button type="button" class="mgr-chip" data-adds-mode="${esc(m)}" aria-pressed="${
        m === opts.mode
      }">${m === "new" ? "new positions only" : "new + added"}</button>`,
  ).join("");

  return (
    `<section class="panel panel-wide" id="inst-adds-section" aria-label="Recently added issuers">` +
    `<div class="panel-head"><h2 class="section-h">Recently added issuers</h2>` +
    `<span class="panel-note" id="inst-adds-window">quarter ended ${esc(payload.period)}</span></div>` +
    `<p class="section-note">Which issuers 13F managers reported <strong>adding</strong> in a closed ` +
    `reporting quarter. The window is a <strong>quarter</strong>, never a rolling day count — ` +
    `quarterly filings cannot support one — and only quarters whose 45-day filing deadline has ` +
    `passed are offered, because an open quarter counts only the managers who filed early.` +
    /* F5: this sentence used to end "the quarter shown above is rendered in
       full below", which the renderer directly contradicts — it slices to the
       compact bound like every other table. A reader with scripting off was
       told the table was complete while issuers were being omitted, which is
       the precise failure the truncation machinery exists to prevent. It now
       states the bound AND gives a no-JS route to the whole bounded payload. */
    `<noscript> Changing the quarter or the mode needs JavaScript, and the table below is the ` +
    `compact slice of this quarter — not the whole of it. The complete bounded payload for this ` +
    `quarter is published as JSON at <a href="${esc(addsPayloadHref(opts.period, opts.mode))}">` +
    `${esc(addsPayloadHref(opts.period, opts.mode))}</a>.</noscript></p>` +
    /* SL-R16: two sibling `.mgr-chips` groups STACKED, each with only an
       `aria-label` — so a sighted reader met two unlabelled rows of buttons and
       had to infer which axis each one moved. They become ONE `.control-row`
       with VISIBLE `Quarter` and `Count` labels, reusing `.range-control`'s
       one-row idiom (`global.css`) rather than adding a second. The
       `data-adds-period` / `data-adds-mode` hooks and the `#inst-adds-controls`
       id are unchanged, so the island binds exactly what it bound before. */
    `<div class="range-control control-row">` +
    `<div class="filter-group" id="inst-adds-controls" role="group" aria-label="Reporting quarter">` +
    `<span class="filter-label">Quarter</span><div class="chips">${periodBtns}</div></div>` +
    `<div class="filter-group" role="group" aria-label="Which changes to count">` +
    `<span class="filter-label">Count</span><div class="chips">${modeBtns}</div></div>` +
    `</div>` +
    `<div class="table-scroll"><table class="etable" data-sticky-first>` +
    `<caption class="visually-hidden">Issuers ranked by disclosed value added in the quarter ended ${esc(
      payload.period,
    )}</caption>` +
    `<thead><tr>${addsHeadHtml(cols, "value", "desc", { scope: "inst-adds" })}</tr></thead>` +
    `<tbody id="inst-adds-tbody">${rows}</tbody></table></div>` +
    /* R19/F6: the NAMED bound beside the compact table. The congress ranking
       sections have carried this since R19 was written; the leaderboard and
       the directory were rendering a disclosure control with no statement of
       what it was holding back, so rows were withheld with no named author.

       Rendered in BOTH states — visible when rows are held back, present but
       hidden when they are not — so the client can reveal the sentence and the
       button TOGETHER when a quarter with more issuers is selected. A notice
       that was never rendered cannot be filled in later (F16). */
    terminusRow({
      author: "populus",
      hidden: total <= shown,
      html:
        `${fmtInt(Math.max(0, total - shown))} further issuers are not rendered above — ` +
        `a Public Filings render bound, not a data bound. Every issuer in this quarter's ` +
        `bounded payload remains in ` +
        `<a href="${esc(addsPayloadHref(opts.period, opts.mode))}">the published JSON</a>.`,
    }) +
    // R7: the leaderboard is compact-by-default like every other table, and the
    // note below reports the ENDPOINT's truncation, which is a different fact
    // from this render bound and is stated separately.
    compactDisclosure({ rootId: "inst-adds-tbody", total, shown, noun: "issuers" }) +
    // The note container ALWAYS renders, even when empty: the client cannot
    // insert a container that was never there, so an initially-absent note
    // meant a later period's omission could not be stated at all (F12).
    (addsNoteHtml(payload) || `<div class="caveat-line" id="inst-adds-note"></div>`) +
    // F12: the live status node the period/mode control writes into. It was
    // targeted by the failure handler but never rendered, so a failed fetch
    // reached the console and nothing else — the reader saw the old quarter
    // with no indication their request had failed. It is `role="status"` so a
    // screen reader is told too, and it renders in EVERY state.
    `<p class="caveat-line" id="inst-adds-status" role="status" aria-live="polite"></p>` +
    // F2/F3: the bounded rows travel with the page so the island can sort and
    // expand them WITHOUT a fetch. Without this the compact slice was a
    // one-way door: rows past it were unreachable on the default view.
    `<script type="application/json" id="inst-adds-data">${JSON.stringify(payload.rows).replaceAll(
      "</",
      "<\\/",
    )}</script>` +
    `</section>`
  );
}

/* ---------- A-4: homepage "notable this week" rail ---------- */

import { type NotableRecentResult } from "./derive.ts";

export function notableRailHtml(res: NotableRecentResult, ctx: RenderCtx): string {
  if (res.rows.length === 0 && res.unrankable === 0) return "";
  const rows = res.rows
    .map((r) => {
      const side = sideLabel(r.side, r.flags);
      const owner = ownerNote(r);
      const who = r.bioguide
        ? `<a href="${memberHrefFor(r.bioguide, ctx)}">${esc(r.name)}</a>`
        : esc(r.name);
      const what = r.ticker
        ? `<a class="mono-ticker" href="${tickerHrefFor(r.ticker, ctx)}">${esc(r.ticker)}</a>`
        : assetNameCell(r);
      return (
        `<div class="rail-row" role="listitem">` +
        `<span class="rail-who">${who} <span class="aff ${partyClass(r.party)}">${esc(affTextOf(r))}</span></span>` +
        `<span class="rail-what">${what}</span>` +
        `<span class="rail-side ${side.cls}">${esc(side.text)}${owner ? ` <span class="owner-note">${esc(owner)}</span>` : ""}</span>` +
        `<span class="rail-amount">${esc(amountText(r))}</span>` +
        `<span class="rail-filed">filed ${esc(r.filed)}</span>` +
        srcLink(r.doc, "rail-src") +
        `</div>`
      );
    })
    .join("\n");
  const notes: string[] = [
    `ranked by the disclosed LOWER bound — never a midpoint, never the upper bound`,
    `filings from ${esc(res.windowFrom)} onward`,
  ];
  if (res.unrankable > 0)
    notes.push(
      `${fmtInt(res.unrankable)} in-window ${res.unrankable === 1 ? "row" : "rows"} disclose no lower bound and cannot rank in a largest-first list`,
    );
  if (res.dateAnomalies > 0) notes.push(`${fmtInt(res.dateAnomalies)} date-anomaly rows excluded`);
  return (
    `<section class="rail" aria-label="Largest recent disclosures">` +
    `<div class="rail-head"><h2 class="section-h2">Largest recent disclosures — last 7 days</h2>` +
    `<span><a class="section-link" href="/signals/">signals ↗</a> · <a class="section-link" href="/congress/leaders/">full rankings ↗</a></span></div>` +
    `<div class="rail-rows" role="list">${rows}</div>` +
    `<div class="rail-caption">${notes.join(" · ")}</div>` +
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

import {
  memberNetByTicker,
  sectorMix,
  jurisdictionOverlap,
  notableRecent,
  membershipAsOf,
  type CommitteeMembership,
  type MembershipSnapshot,
  type SectorResolution,
  type MemberEntity as MemberEntityT,
} from "./derive.ts";

export interface MemberV2Deps {
  /** null → sector data not in this build (honest absence) */
  resolveSector: ((ticker: string) => SectorResolution) | null;
  sectorMeta: { taxonomyVersion: string; asOf: string } | null;
  /** null → committee data not in this build */
  committees: {
    memberships: CommitteeMembership[];
    /** snapshot-WIDE validity bounds (review F7) */
    windowFrom: string;
    windowTo: string;
    jurisdictionByCommittee: ReadonlyMap<string, readonly string[]>;
    mappingVersion: string;
    snapshotDate: string;
  } | null;
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

/* SL-R7 / CODE-REVIEW F1: the `§` clause for the member net-flow table, taken
   from the same `RANKING_FOOTNOTES` registry whose block R7 deleted. Scope is
   the table, key is the column — both stable, neither derived from a counter. */
function memberFlowNote(column: string): string {
  const clause = RANKING_FOOTNOTES_LIST.find((f) => f.mark === "§")?.html ?? "";
  return clause ? noteFromHtml(clause, { scope: "member-netflow" }, column) : "";
}

export function memberV2Sections(
  m: MemberEntityT,
  stamps: BuildStamps,
  ctx: RenderCtx,
  deps: MemberV2Deps,
): string {
  /* --- net disclosed flow by ticker (F-10: flows, never holdings) --- */
  const { rows: netRows, noTickerRows } = memberNetByTicker(m.txns);
  const { ranked, undisclosedBucket } = rankNetRows(netRows, (r) => r.net, (r) => r.ticker);
  const netRowHtml = (r: (typeof netRows)[number], overlapsPrev: boolean): string =>
    `<tr><td class="c-ticker"><a href="${tickerHrefFor(r.ticker, ctx)}">${esc(r.ticker)}</a></td>` +
    `<td class="c-num c-buy">${fmtInt(r.buys)}</td>` +
    `<td class="c-num c-sell">${fmtInt(r.sells)}</td>` +
    `<td class="c-num">${flowCellHtml(r.purchases)}</td>` +
    `<td class="c-num">${flowCellHtml(r.sales)}</td>` +
    `<td class="c-num c-net">${netCellHtml(r.net, overlapsPrev)}</td></tr>`;
  const netTable =
    netRows.length === 0
      ? `<p class="section-note">No ticker-keyed disclosures on record.</p>`
      : `<div class="table-scroll"><table class="etable etable-compact">` +
        `<caption class="visually-hidden">Net disclosed flow by ticker for ${esc(m.name)}</caption>` +
        `<thead><tr><th scope="col">Ticker</th><th scope="col">Purch.</th><th scope="col">Sales</th>` +
        /* SL-R7 / CODE-REVIEW F1: this table hand-rolls its `<thead>` — it never
           went through `rankingHeadHtml`, so R7's header conversion missed it while the
           `footnoteBlock(RANKING_FOOTNOTES, …)` explaining its three `·§` markers WAS
           deleted. That left three markers on a reader-facing surface pointing at an
           explanation that no longer existed anywhere. A marker without its clause is
           the §7 failure this run exists to prevent, not a cosmetic gap. */
        `<th scope="col">Gross purchases ${fnMark("·§")}${memberFlowNote("gross-purchases")}</th>` +
        `<th scope="col">Gross sales ${fnMark("·§")}${memberFlowNote("gross-sales")}</th>` +
        `<th scope="col">Net disclosed flow ${fnMark("·§")}${memberFlowNote("net")}</th></tr></thead>` +
        `<tbody>${ranked
          .map((r, i) => netRowHtml(r, i > 0 ? netOverlaps(r.net, ranked[i - 1]!.net) === true : false))
          .join("\n")}${
          undisclosedBucket.length > 0
            ? `<tr class="unranked-sep"><td colspan="6">${fmtInt(undisclosedBucket.length)} tickers carry a wholly-undisclosed side — no endpoints, listed last, never zero</td></tr>` +
              undisclosedBucket.map((r) => netRowHtml(r, false)).join("\n")
            : ""
        }</tbody></table></div>` +
        `<div class="card-foot">PTRs are flows, not holdings — this table nets disclosed flow intervals; it is NOT a portfolio and cannot become one without the member's annual FD report${
          noTickerRows > 0 ? ` · ${fmtInt(noTickerRows)} rows disclose no ticker and are outside this table` : ""
        }</div>`;

  /* --- largest recent disclosures (F-12: rank by lower bound) --- */
  const recent = notableRecent(m.txns, stamps.generatedAtDate, 90, 5);
  const recentRows = recent.rows
    .map(
      (r) =>
        `<tr><td class="c-filed">${esc(r.filed)}</td>` +
        `<td class="c-ticker">${r.ticker ? `<a href="${tickerHrefFor(r.ticker, ctx)}">${esc(r.ticker)}</a>` : assetNameCell(r)}</td>` +
        `<td class="c-side ${sideLabel(r.side, r.flags).cls}">${esc(sideLabel(r.side, r.flags).text)}</td>` +
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
        `<thead><tr><th scope="col">Filed ▾</th><th scope="col">Asset</th><th scope="col">Side</th><th scope="col">Amount</th><th scope="col">Src</th></tr></thead>` +
        `<tbody>${recentRows}</tbody></table></div>` +
        `<div class="card-foot">ranked by disclosed LOWER bound, trailing 90 days by filed date${
          recent.unrankable > 0 ? ` · ${fmtInt(recent.unrankable)} rows with no lower bound cannot rank` : ""
        }</div>`;

  /* --- sector mix (B-5) --- */
  let sectorPanel: string;
  if (deps.resolveSector === null || deps.sectorMeta === null) {
    sectorPanel = absentPanel(
      "Sector mix",
      "Sector data is not in this build. It lands with the first build after the issuer-SIC ingest (B-5) — absence is stated, never estimated.",
    );
  } else {
    const mix = sectorMix(m.txns, deps.resolveSector);
    const mixRows = mix
      .map(
        (r) =>
          `<tr class="${r.bucket ? "mix-bucket" : ""}"><td>${esc(r.key)}${r.bucket ? ` <span class="mono-note">coverage bucket</span>` : ""}</td>` +
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
      `<thead><tr><th scope="col">Sector</th><th scope="col">Txns</th><th scope="col">Flow range</th></tr></thead>` +
      `<tbody>${mixRows}</tbody></table></div>` +
      `<div class="card-foot">sector via SEC EDGAR SIC through the owned taxonomy — coverage buckets are stated, never folded into a sector</div>` +
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
    // Review F8: an unmapped committee makes "no overlap" unanswerable — the
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
            `<thead><tr><th scope="col">Traded</th><th scope="col">Ticker</th><th scope="col">Sector</th><th scope="col">Committee</th><th scope="col">Src</th></tr></thead>` +
            `<tbody>${overlap.rows
              .slice(0, 12)
              .map(
                (r) =>
                  `<tr><td class="c-filed">${esc(r.txn.traded ?? "—")}</td>` +
                  `<td class="c-ticker">${esc(r.txn.ticker ?? "—")}</td>` +
                  `<td>${esc(r.sector)}</td>` +
                  `<td>${r.committees.map((c) => esc(c.name)).join(", ")}</td>` +
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

  return (
    `<div class="entity-grid">` +
    `<section class="panel" aria-label="Net disclosed flow by ticker">` +
    `<div class="panel-head"><h2 class="section-h">Net disclosed flow by ticker</h2>` +
    `<span class="panel-note">interval subtraction · open bounds propagate</span></div>` +
    netTable +
    `</section>` +
    `<section class="panel" aria-label="Largest recent disclosures">` +
    `<div class="panel-head"><h2 class="section-h">Largest recent disclosures</h2>` +
    `<span class="panel-note">trailing 90d · lower bound</span></div>` +
    recentPanel +
    `</section>` +
    `</div>` +
    `<div class="entity-grid">` +
    sectorPanel +
    committeePanel +
    `</div>`
  );
}

/* ================================================================================
   D-2 — /signals surfaces. Every signal renders its EXACT rule, its magnitude
   as an interval, its receipts, and the lag caveat; withheld kinds render as
   withheld with their typed reason — never silently empty (the F-26 lesson at
   the signal layer).
   ============================================================================ */

import type { Signal, SignalArtifact, WithheldKind } from "./signals.ts";

const SIGNAL_KIND_LABELS: Record<Signal["kind"], string> = {
  "s1-large": "S-1 · Large disclosure",
  "s2-first": "S-2 · First disclosure of a ticker by a member",
  "s3-cooccurrence": "S-3 · Co-occurrence",
  "s4-infrequent": "S-4 · Infrequent discloser, large purchase",
  "s5-jurisdiction": "S-5 · Committee-jurisdiction overlap",
  "s6-late-large": "S-6 · Late and large",
};

function magnitudeText(m: Signal["magnitude"]): string {
  if (m.low == null && m.high == null) return "not disclosed";
  if (m.low != null && m.high == null) return `Over ${fmtUsd(m.low)}`;
  if (m.low == null) return `Under ${fmtUsd(m.high!)}`;
  return `${fmtUsd(m.low)}–${fmtUsd(m.high!)}`;
}

export function signalRowHtml(s: Signal, ctx: RenderCtx): string {
  const who = s.entities.bioguide
    ? `<a href="${memberHrefFor(s.entities.bioguide, ctx)}">${esc(s.entities.memberName)}</a>`
    : esc(s.entities.memberName);
  const what = s.entities.ticker
    ? `<a class="mono-ticker" href="${tickerHrefFor(s.entities.ticker, ctx)}">${esc(s.entities.ticker)}</a>`
    : `<span class="none">—</span>`;
  const receipts = s.receipts
    .slice(0, 5)
    .map((doc) => srcLink(doc))
    .join(" ");
  const more = s.receipts.length > 5 ? ` <span class="mono-note">+${fmtInt(s.receipts.length - 5)} more filings</span>` : "";
  return (
    `<tr data-signal-id="${esc(s.id)}">` +
    `<td class="c-filed">${esc(s.occurrence.filedDate)}</td>` +
    `<td>${who}</td>` +
    `<td>${what}</td>` +
    `<td class="c-num">${esc(magnitudeText(s.magnitude))}</td>` +
    `<td class="c-filed">${esc(s.occurrence.tradeDate ?? "—")}</td>` +
    `<td class="c-src">${receipts}${more}</td></tr>`
  );
}

function withheldHtml(w: WithheldKind, carried: number): string {
  return (
    `<section class="panel" aria-label="${esc(SIGNAL_KIND_LABELS[w.kind])} — withheld">` +
    `<div class="panel-head"><h2 class="section-h">${esc(SIGNAL_KIND_LABELS[w.kind])}</h2>` +
    `<span class="badge-planned">WITHHELD · ${esc(w.reason)}</span></div>` +
    `<p class="section-note">${esc(w.detail)}</p>` +
    (carried > 0
      ? `<p class="section-note">${fmtInt(carried)} earlier ${carried === 1 ? "signal" : "signals"} of this kind ` +
        `${carried === 1 ? "is" : "are"} carried forward <strong>unevaluated</strong> — this build asked nothing of ` +
        `${carried === 1 ? "it" : "them"}, so ${carried === 1 ? "its" : "their"} absence from the active tables is ` +
        `not a retraction and not an amendment.</p>`
      : "") +
    `</section>`
  );
}

export function signalsBody(artifact: SignalArtifact, ctx: RenderCtx): string {
  // Review F3: tombstones are lifecycle HISTORY — they never sit in the
  // active tables or counts wearing an active face.
  const active = artifact.signals.filter((s) => s.status === "active");
  const superseded = artifact.signals.filter((s) => s.status === "superseded");
  // Review r3-F3: rows whose kind was WITHHELD this build were not evaluated —
  // they are neither active nor retracted, and are reported with the
  // withholding that caused it.
  const unevaluated = artifact.signals.filter((s) => s.status === "unevaluated");
  const byKind = new Map<Signal["kind"], Signal[]>();
  for (const s of active) {
    let list = byKind.get(s.kind);
    if (!list) {
      list = [];
      byKind.set(s.kind, list);
    }
    list.push(s);
  }
  const sections = [...byKind.entries()]
    .map(([kind, list]) => {
      const rule = list[0]!.rule;
      const rows = list.slice(0, 50).map((s) => signalRowHtml(s, ctx)).join("\n");
      return (
        `<section class="panel panel-wide" aria-label="${esc(SIGNAL_KIND_LABELS[kind])}">` +
        `<div class="panel-head"><h2 class="section-h">${esc(SIGNAL_KIND_LABELS[kind])}</h2>` +
        `<span class="panel-note">${fmtInt(list.length)} in window · threshold v${esc(artifact.thresholdVersion)}</span></div>` +
        `<p class="section-note signal-rule"><strong>Rule:</strong> ${esc(rule)}</p>` +
        `<div class="table-scroll"><table class="etable etable-compact">` +
        `<caption class="visually-hidden">${esc(SIGNAL_KIND_LABELS[kind])} signals</caption>` +
        `<thead><tr><th scope="col">Filed ▾</th><th scope="col">Member</th><th scope="col">Ticker</th>` +
        `<th scope="col">Magnitude</th><th scope="col">Traded</th><th scope="col">Receipts</th></tr></thead>` +
        `<tbody>${rows}</tbody></table></div>` +
        (list.length > 50
          ? terminusRow({
              author: "populus",
              html: `${fmtInt(list.length - 50)} further signals of this kind are in the artifact but not rendered here — a render bound; the artifact at <a href="/signals/data/signals.v1.json">signals.v1.json</a> is complete for the window.`,
            })
          : "") +
        `</section>`
      );
    })
    .join("\n");
  const withheld = artifact.withheld
    .map((w) => withheldHtml(w, unevaluated.filter((s) => s.kind === w.kind).length))
    .join("\n");
  const supersededSection =
    superseded.length === 0
      ? ""
      : `<section class="panel panel-wide" aria-label="Superseded signals">` +
        `<div class="panel-head"><h2 class="section-h">Superseded — no longer in the current view</h2>` +
        `<span class="panel-note">${fmtInt(superseded.length)} tombstones in window</span></div>` +
        `<p class="section-note">These signals appeared in an earlier build's artifact and left the ` +
        `retained view — their underlying filing was amended or superseded, or the rule no longer ` +
        `matches. The tombstone preserves when: each names the build that dropped it.</p>` +
        `<div class="table-scroll"><table class="etable etable-compact">` +
        `<caption class="visually-hidden">Superseded signals</caption>` +
        `<thead><tr><th scope="col">Kind</th><th scope="col">Filed</th><th scope="col">Member</th>` +
        `<th scope="col">Superseded in build</th><th scope="col">Src</th></tr></thead>` +
        `<tbody>${superseded
          .slice(0, 50)
          .map(
            (s) =>
              `<tr class="signal-superseded"><td>${esc(SIGNAL_KIND_LABELS[s.kind])}</td>` +
              `<td class="c-filed">${esc(s.occurrence.filedDate)}</td>` +
              `<td>${esc(s.entities.memberName)}</td>` +
              `<td class="mono-id">${esc(s.supersededInBuild ?? "—")}</td>` +
              `<td class="c-src">${srcLink(s.receipts[0] ?? "")}</td></tr>`,
          )
          .join("\n")}</tbody></table></div></section>`;
  return (
    `<div class="signals-meta caveat-line">` +
    esc(
      `coverage window ${artifact.coverageFrom} → ${artifact.coverageTo} (${artifact.retentionDays} days by filed date) · ` +
        `signals outside it are compacted out — a last-seen marker older than the window start is a coverage gap, stated, never a complete-looking list · ` +
        (artifact.dateAnomaliesExcluded > 0
          ? `${artifact.dateAnomaliesExcluded} date-anomaly rows excluded before any rule ran · `
          : "") +
        artifact.lagCaveat,
    ) +
    `</div>` +
    sections +
    supersededSection +
    withheld
  );
}

/** Per-entity signal section (D-2): the member page filters the build's
    artifact by bioguide. */
export function memberSignalsPanel(artifact: SignalArtifact, bioguide: string, ctx: RenderCtx): string {
  // Review F3: only ACTIVE signals in the member table; tombstones are noted
  // by count, never listed as if current.
  const all = artifact.signals.filter((s) => s.entities.bioguide === bioguide);
  const mine = all.filter((s) => s.status === "active");
  const tombs = all.filter((s) => s.status === "superseded").length;
  const unevaluated = all.filter((s) => s.status === "unevaluated").length;
  const lifecycleNote =
    (tombs > 0 ? ` · ${tombs} superseded in the window` : "") +
    (unevaluated > 0
      ? ` · ${unevaluated} carried forward unevaluated (their rule was withheld this build)`
      : "");
  // Review r3-F4: branch on ALL lifecycle rows — a member whose last active
  // signal became a tombstone still has history, and "no signals" would erase
  // exactly the supersession the lifecycle exists to preserve.
  if (all.length === 0) {
    return (
      `<section class="panel" aria-label="Signals">` +
      `<div class="panel-head"><h2 class="section-h">Signals</h2>` +
      `<span class="panel-note">window ${esc(artifact.coverageFrom)} → ${esc(artifact.coverageTo)}</span></div>` +
      `<p class="section-note">No signals for this member in the retained window — a computed answer over the rules on <a href="/signals/">/signals</a>, not an absence of coverage.</p></section>`
    );
  }
  if (mine.length === 0) {
    return (
      `<section class="panel" aria-label="Signals">` +
      `<div class="panel-head"><h2 class="section-h">Signals</h2>` +
      `<span class="panel-note">window ${esc(artifact.coverageFrom)} → ${esc(artifact.coverageTo)}</span></div>` +
      `<p class="section-note">No ACTIVE signals for this member in the retained window` +
      (tombs > 0
        ? ` — ${fmtInt(tombs)} earlier ${tombs === 1 ? "signal was" : "signals were"} superseded inside it ` +
          `(amended away or no longer matching)`
        : "") +
      (unevaluated > 0
        ? `${tombs > 0 ? ";" : " —"} ${fmtInt(unevaluated)} ${unevaluated === 1 ? "is" : "are"} carried forward ` +
          `unevaluated because their rule was withheld this build`
        : "") +
      `. See <a href="/signals/">/signals</a>.</p></section>`
    );
  }
  // Review F10 / D-2: EVERY surface renders the exact rule — the per-entity
  // section included, in the accessibility tree, not tooltip-only.
  const rows = mine
    .slice(0, 10)
    .map(
      (s) =>
        `<tr><td>${esc(SIGNAL_KIND_LABELS[s.kind])}<div class="signal-rule-inline">${esc(s.rule)}</div></td>` +
        `<td class="c-filed">${esc(s.occurrence.filedDate)}</td>` +
        `<td class="c-num">${esc(magnitudeText(s.magnitude))}</td>` +
        `<td class="c-src">${srcLink(s.receipts[0] ?? "")}</td></tr>`,
    )
    .join("\n");
  return (
    `<section class="panel" aria-label="Signals">` +
    `<div class="panel-head"><h2 class="section-h">Signals</h2>` +
    `<span class="panel-note"><a href="/signals/">all signals ↗</a></span></div>` +
    `<div class="table-scroll"><table class="etable etable-compact">` +
    `<caption class="visually-hidden">Signals for this member</caption>` +
    `<thead><tr><th scope="col">Kind</th><th scope="col">Filed</th><th scope="col">Magnitude</th><th scope="col">Src</th></tr></thead>` +
    `<tbody>${rows}</tbody></table></div>` +
    `<div class="card-foot">${esc(artifact.lagCaveat)}${esc(lifecycleNote)}</div></section>`
  );
}
