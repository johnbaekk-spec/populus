/* Pure page/section renderers. Every entity body is a string function called
   by the thin .astro page for SSR AND by the generic-route client driver —
   parity is by construction (one function, two callers). No Node APIs, no DOM.

   Honesty grammar: G1–G7 via the canonical format.ts components; charts
   zero-based, gaps stay gaps, no midpoints; NULL-honest institutional
   integers; the as-of time stamp every 13F table carries. */

/* ui/ticker.ts — the unified /tickers/* page body. One of the ui/ domain
   modules: consumers import from ./index.ts only, never from this file
   directly. */

import {
  type RenderCtx,
  type StatTile,
  esc,
  fmtInt,
  fmtUsd,
  flagTags,
  universalFlags,
  effectiveFlagKeys,
  universalFlagNote,
  srcLinkDerived,
  terminusRow,
  footnoteBlock,
  statTiles,
  watchStarHtml,
  memberHrefFor,
  congressTickerHref,
  partyClass,
} from "../format.ts";
import {
  type TickerEntity,
  membersDisclosing,
  affTextOf,
  edgarFilerUrl,
  edgarTickerUrl,
} from "../derive.ts";
import { filerHref } from "../holdings.ts";
import type { TickerInstSection } from "../data.ts";
import { type BuildStamps, asOfNote } from "./shared.ts";
import { flowCellHtml, entityTxnRowsHtml, entityTxnTable } from "./congress.ts";
import { instStamp, INST_STAMP_CAVEAT } from "./institutional.ts";

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
  /* Universal-flag hoisting applies to EVERY flag-bearing table, not only the entity txn one.
     Measured before wiring these: 1,004 pages carried a table whose every row
     read `security not in mapping`, with no caveat line above it. */
  const statedHolders = universalFlags(holders.map((h) => h.flags));
  const rows = holders
    .map(
      (h) =>
        `<tr><td class="c-num c-muted">${fmtInt(h.rank)}</td>` +
        // ONE href primitive (filerHref): the payload carries the top/tail target.
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

  /* The compact preview is NOT paged, so its five rows ARE the whole
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
