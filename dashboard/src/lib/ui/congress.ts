/* Pure page/section renderers. Every entity body is a string function called
   by the thin .astro page for SSR AND by the generic-route client driver —
   parity is by construction (one function, two callers). No Node APIs, no DOM.

   Honesty grammar: G1–G7 via the canonical format.ts components; charts
   zero-based, gaps stay gaps, no midpoints; NULL-honest institutional
   integers; the as-of time stamp every 13F table carries. */

/* ui/congress.ts — congressional member/ticker bodies, the entity transaction
   table, and the member-v2 sections (Slice 6 split). */

import {
  type TxnRow,
  type RenderCtx,
  type StatTile,
  type NoteCtx,
  assetNameCell,
  fnMark,
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
  statTiles,
  watchStarHtml,
  memberHrefFor,
  tickerHrefFor,
  partyClass,
  mergeFeed,
  pageSlice,
  pageCountFor,
  feedCountText,
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
export function flowRibbon(
  flow: QuarterlyFlowResult,
  /* `notes` is OPTIONAL and only the member page passes one.
     The other caller is the deep ticker page (`ui.ts` `tickerUnifiedBody`),
     which this run does not own, so without a scope this renderer emits the
     visible `.rb-caption` byte-for-byte as before. */
  opts: { twoSided: boolean; sourceLine: string; notes?: NoteCtx },
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
    /* The caption is a DEFINITION — how the chart is drawn, what the
       hatching means, what is excluded — so it moves into a note anchored on
       the chart, with the marker left visible as its cue (LD3). The
       accessibility summary below is untouched: it is the chart's data, not its
       method, and it was never the channel this requirement moves. */
    (opts.notes
      ? `<div class="rb-caption rb-caption-note"><span class="src-derived">how this chart is drawn&nbsp;·§</span>` +
        note(caption, opts.notes, "chart-method") +
        `</div>`
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
  /* Universal-flag hoisting runs over EVERY row the table can page through, not this page —
     the client re-renders rows on paging, and a per-page set would let page 2
     contradict the note page 1 left above it. The set travels to the client in
     `data-stated-flags` so both sides suppress identically. */
  const stated = universalFlags(txns.map(effectiveFlagKeys));
  const heads =
    opts.kind === "member"
      ? ["Filed ▾", "Ticker", "Side · Owner", "Traded · Lag", "Amount", "Range · Flags", "Src"]
      : ["Filed ▾", "Member", "Side · Owner", "Traded · Lag", "Amount", "Range · Flags", "Src"];
  /* Only `Side · Owner` carries a note, and only when a scope is
     passed. Deliberately not every column: this run moves the strings that WERE
     on the page, and inventing an explanation for six columns that never had
     one would be new copy, not a relocation. */
  const headNote = (label: string): string =>
    opts.notes && label === "Side · Owner"
      ? noteFromHtml(OWNER_CODE_NOTE, opts.notes, "side-owner")
      : "";
  const count = entityTableCountText(opts.page, pageRows.length, txns.length);
  return (
    universalFlagNote(stated) +
    `<div class="table-scroll"><table class="etable" data-entity-table data-kind="${opts.kind}"` +
    /* `data-paged` is the ONLY thing that exempts a table from the
       whole-distribution hoisting gate, and only these two renderers page. A visible page of a
       paged table can be uniform while its full collection is not, which is the
       one case the gate cannot judge from HTML. */
    `${pages > 1 ? ' data-paged="1"' : ""} data-stated-flags="${esc(stated.join(","))}">` +
    `<caption class="visually-hidden">${esc(opts.caption)}</caption>` +
    `<thead><tr>${heads
      .map((h) => `<th scope="col">${esc(h)}${headNote(h)}</th>`)
      .join("")}</tr></thead>` +
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

/* The single clause `#member-footnotes` published. It is referenced from
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
        /* `member-footnotes` had ONE mark, §, and it qualifies this
           column. The descriptor rule applies — this `<thead>` is a literal
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
    } · <span class="mono-id">bioguide ${esc(m.bioguide)}</span>` +
    /* The identity `.entity-lede` paragraph is gone from the page
       surface and its two claims are notes on the things they are about.

       The RANGES claim is a property of every total on this page, so it
       anchors on the stamp line beside the identity it qualifies. The
       OWNER-CODE claim is a property of one column, so it anchors on that
       column's header (see `entityTxnTable`) — anchoring both here would put an
       explanation of the `SP` badge three panels above the badge.

       Neither is softened and neither is lost: both open declaratively with no
       JavaScript, both print, and the owner-code text additionally has its own
       methodology anchor, which T1 populated by moving it off this page. */
    noteFromHtml(
      `Amounts are statutory ranges; totals on this page are therefore ranges too. ` +
        `<a href="/methodology/#amount-ranges">Amount ranges ↗</a>`,
      { scope: "member-stamp" },
      "statutory-ranges",
    ) +
    `</div>` +
    `</div>` +
    statTiles(memberStatTiles(m, stamps), {
      label: "Member disclosure statistics",
      compact: true,
      // The tile LABEL is the key — one tile per label here.
      notes: { scope: "member-tiles" },
    }) +
    `</header>` +
    `<div class="entity-grid">` +
    `<section class="panel" aria-labelledby="flow-h">` +
    `<div class="panel-head"><h2 id="flow-h" class="section-h">Disclosed flow by quarter</h2>` +
    `<span class="panel-note">bar = [min, max] of bucket sums · <span class="src-derived">derived&nbsp;·§</span>` +
    noteFromHtml(MEMBER_FLOW_NOTE, { scope: "member-flow" }, "derived") + `</span></div>` +
    // The chart's `.rb-caption` becomes a note on the chart.
    flowRibbon(flow, {
      twoSided: false,
      sourceLine: "source: House Clerk + Senate eFD",
      notes: { scope: "member-chart" },
    }) +
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
      // The owner-code half of the deleted `.entity-lede`, on the
      // column it is about. The two `/tickers/*` callers pass nothing.
      notes: { scope: "member-txns" },
    }) +
    `</section>` +
    memberPaperBlock(m)
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
        /* This table hand-rolls its `<thead>` — it never
           went through `rankingHeadHtml`, so the header conversion missed it while the
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
        "";
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
    // The card-foot's text, anchored on the panel it qualifies.
    `<span class="panel-note"><span class="src-derived">flows, not holdings&nbsp;·§</span>` +
    note(netFootNote, { scope: "member-netflow" }, "scope") +
    `</span>` +
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
