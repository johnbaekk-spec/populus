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
  srcLink,
  srcLinkDerived,
  terminusRow,
  footnoteBlock,
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
  sumRanges,
  sumRangesText,
  undisclosedPctText,
  quarterlyFlow,
  topTickers,
  membersDisclosing,
  medianLag,
  lateCount,
  inTrailingMonths,
  affTextOf,
  partyLabel,
  qoqPresentation,
  edgarFilerUrl,
  edgarTickerUrl,
  bioguideProfileUrl,
} from "./derive.ts";
import { filerHref, type FilerBudgetState } from "./holdings.ts";
import type { ConcentrationRow, QoqDeltaRow, TopHolderRow } from "./inst.ts";
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

function asOfNote(stamps: BuildStamps): string {
  return `as of ${esc(stamps.generatedAt)} · build ${esc(stamps.buildId)}`;
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

function txnCellsMember(r: TxnRow, ctx: RenderCtx): string {
  const side = sideLabel(r.side, r.flags);
  const owner = ownerNote(r);
  const ownerLong = ownerNoteLong(r);
  const amountUnknown = r.low == null && r.high == null;
  const tickerCell = r.ticker
    ? `<a href="${tickerHrefFor(r.ticker, ctx)}">${esc(r.ticker)}</a>`
    : `<span class="none">—<span class="visually-hidden"> no ticker disclosed</span></span>`;
  return (
    `<td class="c-filed">${esc(r.filed)}</td>` +
    `<td class="c-ticker">${tickerCell}</td>` +
    `<td class="c-side ${side.cls}">${esc(side.text)}${
      owner
        ? ` <span class="owner-note" title="${esc(ownerLong)}">${esc(owner)}<span class="visually-hidden"> (${esc(ownerLong)})</span></span>`
        : ""
    }</td>` +
    `<td class="c-traded">${dualDate(r)}</td>` +
    `<td class="c-amount${amountUnknown ? " unknown" : ""}">${esc(amountText(r))}</td>` +
    `<td class="c-range">${rangeBand(r)}${flagTags(r.flags, r)}</td>` +
    `<td class="c-src">${srcLink(r.doc)}</td>`
  );
}

function txnCellsTicker(r: TxnRow, ctx: RenderCtx): string {
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
        ? ` <span class="owner-note" title="${esc(ownerLong)}">${esc(owner)}<span class="visually-hidden"> (${esc(ownerLong)})</span></span>`
        : ""
    }</td>` +
    `<td class="c-traded">${dualDate(r)}</td>` +
    `<td class="c-amount${amountUnknown ? " unknown" : ""}">${esc(amountText(r))}</td>` +
    `<td class="c-range">${rangeBand(r)}${flagTags(r.flags, r)}</td>` +
    `<td class="c-src">${srcLink(r.doc)}</td>`
  );
}

export function entityTxnRowsHtml(rows: TxnRow[], kind: "member" | "ticker", ctx: RenderCtx): string {
  const cells = kind === "member" ? txnCellsMember : txnCellsTicker;
  return rows.map((r) => `<tr>${cells(r, ctx)}</tr>`).join("\n");
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
  const heads =
    opts.kind === "member"
      ? ["Filed ▾", "Ticker", "Side · Owner", "Traded · Lag", "Amount", "Range · Flags", "Src"]
      : ["Filed ▾", "Member", "Side · Owner", "Traded · Lag", "Amount", "Range · Flags", "Src"];
  const count = entityTableCountText(opts.page, pageRows.length, txns.length);
  return (
    `<div class="table-scroll"><table class="etable" data-entity-table data-kind="${opts.kind}">` +
    `<caption class="visually-hidden">${esc(opts.caption)}</caption>` +
    `<thead><tr>${heads.map((h) => `<th scope="col">${esc(h)}</th>`).join("")}</tr></thead>` +
    `<tbody data-entity-rows>${entityTxnRowsHtml(pageRows, opts.kind, opts.ctx)}</tbody>` +
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
  const flow12 = sumRanges(m.txns.filter((t) => inTrailingMonths(t, stamps.generatedAtDate, 12)));
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
        `<td class="c-num">${flowCellHtml(t.flow)}<a class="fn-ref" href="#member-footnotes" aria-label="footnote §">§</a></td>` +
        `<td class="c-num c-muted">${esc(t.last)}</td></tr>`,
    )
    .join("\n");
  const topTable =
    top.length === 0
      ? `<p class="section-note">No tickers disclosed in the trailing 24 months.</p>`
      : `<div class="table-scroll"><table class="etable etable-compact"><caption class="visually-hidden">Most-disclosed tickers, trailing 24 months</caption>` +
        `<thead><tr><th scope="col">Ticker</th><th scope="col">Txns</th><th scope="col">Flow range ·§</th><th scope="col">Last</th></tr></thead>` +
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
    `<span class="panel-note">bar = [min, max] of bucket sums · <a class="fn-ref" href="#member-footnotes">derived ·§</a></span></div>` +
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
    footnoteBlock(
      [
        {
          mark: "§",
          html: `flow range = sum of statutory bucket bounds — an interval, not an estimate of value; derived by Public Filings from the disclosed ranges`,
        },
      ],
      { id: "member-footnotes" },
    ) +
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
  const rows = holders
    .map(
      (h) =>
        `<tr><td class="c-num c-muted">${fmtInt(h.rank)}</td>` +
        // ONE href primitive (R22): the payload carries the top/tail target.
        `<td class="c-filer"><a href="${esc(filerHref(h.cik, h.tier ?? "tail"))}">${esc(h.name)}</a></td>` +
        `<td class="c-num c-strong">${esc(fmtUsd(h.value))}</td>` +
        `<td class="c-num">${fmtInt(h.securities)}</td>` +
        `<td class="c-flags">${flagTags(h.flags)}</td>` +
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
    `<div class="table-scroll"><table class="etable" data-sticky-first>` +
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

  const recent = opts.fullTable
    ? entityTxnTable(t.txns, {
        kind: "ticker",
        caption: `All congressional disclosures mentioning ${t.ticker}`,
        page: opts.page ?? 0,
        ctx,
      })
    : `<div class="table-scroll"><table class="etable etable-compact"><caption class="visually-hidden">Latest congressional filings mentioning ${esc(
        t.ticker,
      )}</caption>` +
      `<thead><tr><th scope="col">Filed ▾</th><th scope="col">Member</th><th scope="col">Side · Owner</th><th scope="col">Traded · Lag</th><th scope="col">Amount</th><th scope="col">Range · Flags</th><th scope="col">Src</th></tr></thead>` +
      `<tbody>${entityTxnRowsHtml(t.txns.slice(0, 5), "ticker", ctx)}</tbody></table></div>` +
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
    `<span class="si-asof">${asOfNote(stamps)}</span>` +
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
  const flow12 = sumRanges(t.txns.filter((r) => inTrailingMonths(r, stamps.generatedAtDate, 12)));
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
    `<p class="entity-lede">Institutional holders of ${esc(issuerName)}<a class="fn-ref" href="#holders-footnotes" aria-label="footnote: present-day mapping">†</a> per 13F filings for the quarter ended <strong>${esc(
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
    `</div>` +
    footnoteBlock(
      [
        {
          mark: "†",
          html: `ticker→issuer via the SEC's present-day ticker file (company_tickers.json), matched only against entity-keyed issuers in the aggregate — a present-day mapping, not the name as of each filing`,
        },
        {
          mark: "§",
          html: `derived by Public Filings from the published aggregate (agg_issuer_top_holders); the mockup's per-holder filed dates, lags, share counts and document links are not in the published aggregate and are not shown — the EDGAR link opens the filer's 13F filings`,
        },
      ],
      { id: "holders-footnotes" },
    )
  );
}

export function holdersTableHtml(
  rows: (TopHolderRow & { tier?: FilerBudgetState })[],
  period: string,
  latestFiled: string | null,
  topn: number,
): string {
  const body = rows
    .map(
      (h) =>
        `<tr><td class="c-num c-muted">${fmtInt(h.rank)}</td>` +
        // ONE href primitive (R22): tier rides on the row through the SSR call
        // AND the embedded period payload, so both renders link identically.
        `<td class="c-filer"><a href="${esc(filerHref(h.cik, h.tier ?? "tail"))}">${esc(h.filer_name)}</a></td>` +
        `<td class="c-num c-strong">${esc(fmtUsd(h.value_usd))}</td>` +
        `<td class="c-num">${fmtInt(h.security_count)}</td>` +
        `<td class="c-keysrc"><span class="mono-note">${esc(h.issuer_key_source)}</span></td>` +
        `<td class="c-flags">${flagTags(h.flags)}</td>` +
        `<td class="c-src">${srcLinkDerived("#holders-footnotes", edgarFilerUrl(h.cik))}</td></tr>`,
    )
    .join("\n");
  return (
    `<div class="panel panel-wide">` +
    `<div class="panel-head"><h2 class="section-h">Ranked holders — ${esc(period)}</h2>` +
    `<span class="panel-note">${instStamp(period, latestFiled)}</span></div>` +
    `<div class="table-scroll"><table class="etable" data-sticky-first>` +
    `<caption class="visually-hidden">Top institutional holders for quarter ${esc(period)}</caption>` +
    `<thead><tr><th scope="col">#</th><th scope="col">Filer</th><th scope="col">Value ▾</th><th scope="col">Securities</th><th scope="col">Issuer key</th><th scope="col">Flags</th><th scope="col">Src</th></tr></thead>` +
    `<tbody>${body}</tbody></table></div>` +
    terminusRow({
      author: "populus",
      html: `The aggregate publishes the top ${fmtInt(topn)} holders per issuer — a build parameter of the Public Filings aggregation. Rows beyond it exist in individual filings on EDGAR but are not ranked here. <a href="/methodology/#m2">methodology §13F ↗</a>`,
    }) +
    `<div class="caveat-line">${esc(INST_STAMP_CAVEAT)}</div>` +
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

export function qoqChipHtml(row: QoqDeltaRow): string {
  const p = qoqPresentation(row);
  const markers = p.chipMarkers
    .map((m) => `<a class="fn-ref" href="#filer-footnotes" aria-label="footnote ${esc(m)}">${esc(m)}</a>`)
    .join("");
  return `<span class="qoq-chip ${p.chipCls}">${esc(p.chipText)}</span>${markers}`;
}

export function changesTableHtml(deltas: QoqDeltaRow[], period: string, latestFiled: string | null): string {
  const ordered = [...deltas].sort((a, b) => {
    const av = a.curr_value_usd ?? a.prev_value_usd ?? -1;
    const bv = b.curr_value_usd ?? b.prev_value_usd ?? -1;
    return bv - av || (a.position_key < b.position_key ? -1 : 1);
  });
  const rows = ordered
    .map((d) => {
      const p = qoqPresentation(d);
      const grain = p.grainNote ? ` <span class="mono-note">${esc(p.grainNote)}</span>` : "";
      const posMarkers = p.positionMarkers
        .map((m) => `<a class="fn-ref" href="#filer-footnotes" aria-label="footnote ${esc(m)}">${esc(m)}</a>`)
        .join("");
      const valueDelta =
        p.valueDelta.kind === "num"
          ? esc(p.valueDelta.text)
          : p.valueDelta.kind === "nc"
            ? `<span class="nc-chip">n/c</span>`
            : "—";
      const cell = (v: number | null): string => (v == null ? "—" : esc(fmtUsd(v)));
      const shareCell = (v: number | null): string => (v == null ? "—" : fmtInt(v));
      return (
        `<tr><td class="c-pos"><span class="mono-note${posMarkers ? " reconciled" : ""}">${esc(d.position_key)}</span>${posMarkers}${grain}</td>` +
        `<td class="c-num">${cell(d.prev_value_usd)}</td>` +
        `<td class="c-num">${cell(d.curr_value_usd)}</td>` +
        `<td class="c-num">${valueDelta}</td>` +
        `<td class="c-num">${shareCell(d.prev_shares)}</td>` +
        `<td class="c-num">${shareCell(d.curr_shares)}</td>` +
        `<td class="c-num">${esc(p.sharesDeltaText)}</td>` +
        `<td class="c-chip">${qoqChipHtml(d)}</td>` +
        `<td class="c-flags">${flagTags(d.flags)}</td></tr>`
      );
    })
    .join("\n");
  return (
    `<div class="table-scroll"><table class="etable" data-sticky-first>` +
    `<caption class="visually-hidden">Position changes into quarter ${esc(period)}</caption>` +
    `<thead><tr><th scope="col">Position · grain</th><th scope="col">Prev value</th><th scope="col">Curr value</th><th scope="col">Δ value</th><th scope="col">Prev shares</th><th scope="col">Curr shares</th><th scope="col">Δ shares</th><th scope="col">Change</th><th scope="col">Flags</th></tr></thead>` +
    `<tbody>${rows}</tbody></table></div>` +
    `<div class="panel-note table-stamp">${instStamp(period, latestFiled)} · <span class="caveat-inline">${esc(
      INST_STAMP_CAVEAT,
    )}</span></div>`
  );
}

export function filerPeriodSectionHtml(
  conc: ConcentrationRow | null,
  deltas: QoqDeltaRow[],
  period: string,
  latestFiled: string | null,
  topn: number,
): string {
  const changes =
    deltas.length === 0
      ? `<p class="section-note">No quarter-over-quarter rows land in ${esc(
          period,
        )} — either the first period on record for this filer, or nothing keyable on either side.</p>`
      : changesTableHtml(deltas, period, latestFiled);
  return (
    statTiles(filerTiles(conc, deltas.length), { label: `Period statistics for ${period}`, compact: true }) +
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
    filerPeriodSectionHtml(conc, deltas, period, latestFiled, topn) +
    `</div>` +
    filerEdgarBlock(filer.cik, filer.name) +
    footnoteBlock(QOQ_FOOTNOTES, { id: "filer-footnotes" })
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
