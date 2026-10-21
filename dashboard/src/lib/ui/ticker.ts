/* Pure page/section renderers. Every entity body is a string function called
   by the thin .astro page for SSR AND by the generic-route client driver —
   parity is by construction (one function, two callers). No Node APIs, no DOM.

   Honesty grammar: G1–G7 via the canonical format.ts components; charts
   zero-based, gaps stay gaps, no midpoints; NULL-honest institutional
   integers; the as-of time stamp every 13F table carries. */

/* ui/ticker.ts — the unified /tickers/* page body. One of the ui/ domain
   modules: consumers import from ./index.ts only, never from this file
   directly.

   signals-v3 M3 (R16–R21, LD8): the head (title, the five-figure ledger, the
   provenance line that carries each section's own clock), the server-rendered
   "On Signals" block, then two REAL tabs — Congress and Institutional — on a
   sticky tab bar. Both panels are in the HTML and both show without
   JavaScript; `scripts/tabs.ts` hides the inactive one only once it runs. */

import {
  type RenderCtx,
  type TxnRow,
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
  memberHrefFor,
  congressTickerHref,
  partyClass,
  presentColumns,
  dataColumnsAttr,
  tableFootReasonHtml,
} from "../format.ts";
import {
  type TickerEntity,
  type CommitteeMembership,
  type MembershipSnapshot,
  membersDisclosing,
  memberNetByTicker,
  membershipAsOf,
  netDirection,
  netIntervalText,
  legacyTrailingMonthsBounds,
  windowMembership,
  excludeDateAnomalies,
  affTextOf,
  edgarFilerUrl,
  edgarTickerUrl,
} from "../derive.ts";
import type { TriageResult } from "../signal-triage.ts";
import type { TickerCrowding } from "../inst-analytics.ts";
import { unavailableDesignPanel } from "./shared.ts";
import { filerHref } from "../holdings.ts";
import type { TickerInstSection } from "../data.ts";
import { type BuildStamps, disclosureLedger } from "./shared.ts";
import { fmtCik, note, noteFromHtml, rangeOfTotal, thHtml } from "../format.ts";
import type { FilerBudgetState } from "../holdings.ts";
import { onSignalsLines, tickerOnSignalsHtml } from "./signals.ts";
import { entityTxnRowsHtml, entityTxnTable } from "./congress.ts";
import { HOLDERS_VISIBLE, heldHoldersHtml, instStamp, instFiledNote } from "./institutional.ts";

/* ---------- unified ticker page body ---------- */

export interface TickerHeaderInfo {
  ticker: string;
  /** present-day mapped issuer name (G14, †) or null when unresolved */
  mappedName: string | null;
}

/** G14: what the † beside a mapped issuer name says. Launch copy audit
    ticker-02: it is the mark's own tip, where it is read, not a footnote at the
    foot of the page (the SEC's file name stays out of reader copy). */
const TICKER_MAPPED_NAME_NOTE =
  "Today's name, from the SEC's present-day ticker list — a present-day mapping, not the name as of each filing.";

function tickerTitleHtml(info: TickerHeaderInfo): string {
  const name = info.mappedName
    ? ` — ${esc(info.mappedName)}` +
      noteFromHtml(esc(TICKER_MAPPED_NAME_NOTE), { scope: "ticker-head" }, "mapped-name", {
        trigger: "mark",
        textHtml: "†",
        name: "Present-day name",
      })
    : "";
  return `<span class="mono-ticker">${esc(info.ticker)}</span>${name}`;
}

/** R21 → launch M7b (R33, LD30): the holders the Institutional tab shows
    before its "Show all N holders" disclosure. Holders 26..N are held — an
    island the binder draws 25 at a time, and a `<noscript>` second table
    inside the disclosure for readers without JavaScript. */
export const TICKER_HOLDERS_VISIBLE = HOLDERS_VISIBLE;
/** R20: the rows the Congress tab's disclosures preview shows in total,
    pinned rows included; the rest are one link away. */
export const TICKER_PREVIEW_ROWS = 10;

export function tickerInstSectionHtml(inst: TickerInstSection, ticker: string): string {
  /* The tab panel is `#institutional` (R16); the holders section it holds
     keeps its own anchor. */
  const head = (note: string): string =>
    `<div class="section-head"><h2 class="section-h2">Institutional holders <span class="section-note-inline">· 13F${note}</span></h2></div>`;
  if (inst.state === "module-absent") {
    return (
      `<section class="page-section" id="ticker-holders">` +
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
      `<section class="page-section" id="ticker-holders">` +
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
      `<section class="page-section" id="ticker-holders">` +
      head("") +
      `<div class="absent-block">` +
      `<h3 class="absent-h">Mapped, but not in the published aggregate.</h3>` +
      `<p>${esc(ticker)} resolves to ${esc(inst.name ?? "an issuer")} (CIK ${esc(
        fmtCik(inst.cik ?? ""),
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
     read `security not in mapping`, with no caveat line above it.
     signals-v3 M3 (LD8) → launch M7b (R33): computed over ALL N holders — the
     25 shown and the held rest alike — so a flag is stated once only when
     every holder carries it. The held rows' renderer receives the same set. */
  const statedHolders = universalFlags(holders.map((h) => h.flags));
  const rows: TickerHolderRow[] = holders.map((h) => ({ rank: h.rank, cik: h.cik, name: h.name, value: h.value, securities: h.securities, flags: h.flags, tier: h.tier }));
  const ctx: TickerHolderCtx = { stated: statedHolders };
  const held = holders.length > TICKER_HOLDERS_VISIBLE;
  /* With holders 26..N held, the list spans more than one table. Each is a
     part of the collection the hoist judged — the meaning `data-paged`
     carries ("this HTML shows only PART of the collection"): a flag every row
     of one part shows, but not every holder carries, stays on its rows. */
  /* ticker-11 (launch M7b): the § and n/c footnotes became tips — § on the
     Src column it explains, the newest-filing note on the quarter stamp —
     with every clause kept, including the W-3 mapped/entity distinction. */
  // pre-escaped html: literal copy, no data interpolated
  const srcNote = inst.mapped
    ? `derived by Public Filings from this build's reviewed ticker-mapping holders list for this share class; that list carries each holder's share count, share change and filed date${inst.holdersPage ? " (the full holders view shows them)" : ", which this table does not show"}, but no document links — the EDGAR link opens the filer's 13F list`
    : `derived by Public Filings from this build's published top-holders list; per-filer filed dates, share counts and document links are not in that list — the EDGAR link opens the filer's 13F list`;
  /* Only the PRIMARY table (the first 25) carries the Src tip: the held
     table and the no-JS copy repeat the header without it, so no note id is
     emitted twice. */
  const tableHtml = (bodyHtml: string, caption: string, tbodyId: string | null, primary = false): string =>
    `<div class="table-scroll"><table class="etable" role="table" data-card="holders" data-sticky-first${held ? ' data-paged="1"' : ""} data-stated-flags="${esc(statedHolders.join(","))}">` +
    `<caption class="visually-hidden">${esc(caption)}</caption>` +
    `<thead role="rowgroup"><tr role="row">${thHtml({ label: "#", cls: "c-num" })}${thHtml({ label: "Filer", cls: "c-filer c-flex" })}${thHtml({ label: "Value", cls: "c-num", order: "descending" })}${thHtml({ label: "Securities", cls: "c-num" })}${thHtml({ label: "Flags", cls: "c-flags" })}${thHtml(primary ? { label: "Src", cls: "c-src", mark: "·§", noteHtml: srcNote, notes: { scope: "ticker-inst" }, noteKey: "src" } : { label: "Src", cls: "c-src", mark: "·§" })}</tr></thead>` +
    `<tbody role="rowgroup"${tbodyId ? ` id="${esc(tbodyId)}"` : ""}>${bodyHtml}</tbody></table></div>`;
  const caption = `Top institutional holders of ${ticker} for quarter ${inst.period!}`;
  const shown = rows.slice(0, TICKER_HOLDERS_VISIBLE);
  return (
    `<section class="page-section" id="ticker-holders">` +
    /* ticker-09 (launch M7b): "13F holders" and "All holders ↗"; the quarter
       stamp and "longs only" stay — this tab carries no 13F caveat box, so
       the header is where long-only is said. */
    `<div class="section-head"><h2 class="section-h2">13F holders <span class="section-note-inline">· ${instStamp(
      inst.period!,
      inst.latestFiled ?? null,
    )}${noteFromHtml(esc(instFiledNote(inst.latestFiled ?? null)), { scope: "ticker-inst" }, "stamp", { trigger: "mark", name: "Newest filing" })} · longs only</span></h2>` +
    // R2: link the holders view only when that page is built — never a dressed 404.
    (inst.holdersPage
      ? `<a class="section-link" href="/institutional/tickers/${esc(encodeURIComponent(ticker))}/holders/">All holders ↗</a>`
      : "") +
    `</div>` +
    universalFlagNote(statedHolders) +
    tableHtml(shown.map((r) => tickerHolderRowHtml(r, ctx)).join("\n"), held ? `${caption}, ${rangeOfTotal(1, shown.length, holders.length, "holders")}` : caption, held ? "ticker-holders-top" : null, true) +
    heldHoldersHtml({ rootId: "ticker-holders-held", render: "ticker-holder", rows, rowHtml: (r) => tickerHolderRowHtml(r, ctx), ctx, table: tableHtml, caption }) +
    /* The anchor `#ticker-inst-footnotes` (linked from older pages and read by
       the tab binder's hash routing) now marks the table's truncation line. */
    `<div id="ticker-inst-footnotes">` +
    terminusRow({
      author: "populus",
      /* W-3 (M3 review): the two sources differ, so the terminus branches on
         them. The reviewed-mapping list (share-class grain) keeps the largest
         holders up to its rank cap and states the true holder count; the
         entity-keyed top-holders list is cut at the build's top-N parameter.
         Both count ALL N holders, shown or held. ticker-10 (launch M7b): one
         line, both numbers kept. */
      html: inst.mapped
        ? (holders.length >= inst.mapped.holderCount
            ? `All ${fmtInt(inst.mapped.holderCount)} 13F filers reporting this share class are listed.`
            : `Top ${fmtInt(holders.length)} of ${fmtInt(inst.mapped.holderCount)} holders shown; the rest are on EDGAR.`) +
          ` <a href="/methodology/#m2">Method ↗</a>`
        : `Top ${fmtInt(inst.topn ?? 25)} holders per issuer, set by the site — not a census; the rest are on EDGAR. <a href="/methodology/#m2">Method ↗</a>`,
    }) +
    `</div>` +
    `</section>`
  );
}

/** One ticker-tab holder row's inputs — exactly what `tickerHolderRowHtml`
    reads, so the held island carries nothing else (launch M7b, R33). */
export interface TickerHolderRow {
  rank: number;
  cik: string;
  name: string;
  value: number | null;
  securities: number;
  flags: string[];
  tier: FilerBudgetState;
}

/** The inputs every row shares: the flags hoisted over ALL N holders. */
export interface TickerHolderCtx {
  stated: readonly string[];
}

/** One row of the ticker tab's holders table — the server's first 25, the
    no-JS second table and the binder's held rows alike. Explicit table roles
    (R40) ride every row and cell. */
export function tickerHolderRowHtml(h: TickerHolderRow, ctx: TickerHolderCtx): string {
  return (
    `<tr role="row"><td role="cell" class="c-num c-muted">${fmtInt(h.rank)}</td>` +
    // ONE href primitive (filerHref): the payload carries the top/tail target.
    `<td role="cell" class="c-filer c-flex"><a href="${esc(filerHref(h.cik, h.tier ?? "tail"))}">${esc(h.name)}</a></td>` +
    `<td role="cell" class="c-num c-strong has-marks">${h.value == null ? `—<span class="visually-hidden"> value not disclosed</span>` : esc(fmtUsd(h.value))}</td>` +
    `<td role="cell" class="c-num">${fmtInt(h.securities)}</td>` +
    `<td role="cell" class="c-flags">${flagTags(h.flags, undefined, { stated: ctx.stated })}</td>` +
    `<td role="cell" class="c-src">${srcLinkDerived(null, edgarFilerUrl(h.cik))}</td></tr>`
  );
}

/** The ticker tab's registered held-rows renderer (`initHeldRows`). */
export const TICKER_HOLDER_HELD = {
  row: (r: unknown, ctx: unknown): string => tickerHolderRowHtml(r as TickerHolderRow, ctx as TickerHolderCtx),
  text: (r: unknown): string => (r as TickerHolderRow).name,
};

/** SSR-only inputs for the Ticker.dc.html bands; the generic /e/ route passes
    none and every dependent band renders its stated unavailable state. */
export interface TickerPageDeps {
  /** signals-v3 M3 (R18, R19): the build's triage (`getTriage()`), read for
      this ticker's rows and active hits — the "On Signals" block and the rows
      it pins. Absent → no block and no pinned row (as on `/e/`). */
  triage?: TriageResult | null;
  /** crowding percentiles when the ticker resolves to an issuer with holder rows */
  crowding: TickerCrowding | null;
  /** committee memberships keyed by bioguide (dating contract applied per trade) */
  committees: { byMember: ReadonlyMap<string, CommitteeMembership[]>; windowFrom: string; windowTo: string; snapshotDate: string } | null;
  /** R19 (refinement 20260910): the rendered Congress ↔ notable-managers overlap band (server only) */
  overlap?: string;
}

export function tickerUnifiedBody(
  t: TickerEntity,
  inst: TickerInstSection,
  stamps: BuildStamps,
  ctx: RenderCtx,
  opts: { fullTable: boolean; page?: number },
  deps: TickerPageDeps | null = null,
): string {
  const info: TickerHeaderInfo = {
    ticker: t.ticker,
    mappedName: inst.name ?? null,
  };
  const latestFiled = t.txns[0]?.filed ?? null;

  /* R18 / R19: the "On Signals" block and the rows it pins, from the build's
     triage. `/e/` passes no deps: no block, no pinned row. */
  const triage = deps?.triage ?? null;
  const signalRows = triage?.byTicker.get(t.ticker) ?? [];
  const signalHits = triage?.hitsByTicker.get(t.ticker) ?? [];
  const onSignals = triage ? tickerOnSignalsHtml(signalRows, signalHits, ctx) : "";
  const pinned = triage ? onSignalsLines(signalRows, signalHits, triage.hitLines, t.txns) : [];
  const pinnedIds = new Set(pinned.map((r) => r.txnId));

  /* R20: the preview is the pinned rows, then the newest rows, ten in total.
     It is NOT paged, so its rows ARE the whole set it speaks for — a flag
     universal among them, pinned rows included, is universal, full stop (the
     whole-dist assertion in `test/post/universal-caveat.test.ts` reads every
     built table). With pinned rows on top the table is no longer in filed
     order, so its Filed header claims no sort; the panel note says the order. */
  const previewRows = [...pinned, ...t.txns.filter((r) => !pinnedIds.has(r.txnId)).slice(0, Math.max(0, TICKER_PREVIEW_ROWS - pinned.length))];
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
      )}${pinned.length > 0 ? `, the rows on Signals first` : ""}</caption>` +
      `<thead><tr>${
        pinned.length > 0
          ? thHtml({ label: "Filed", mark: null, cls: "c-num has-marks" })
          : thHtml({ label: "Filed", cls: "c-num", order: "descending" })
      }${(
        [["Member", "c-member c-flex"], ["Side · Owner", "c-kind"], ["Traded · Lag", "c-num"], ["Amount", "c-num"], ["Range · Flags", "c-bar"], ["Src", "c-src"]] as const
      ).map(([label, cls]) => thHtml({ label, mark: null, cls })).join("")}</tr></thead>` +
      `<tbody>${entityTxnRowsHtml(previewRows, "ticker", ctx, statedPreview, null, { dataTxn: true, pinned: pinnedIds })}</tbody></table></div>`;

  /* R17: the five-figure ledger. Every figure is computed from this page's
     own rows. Totals are over the FULL qualifying population; `disclosing`
     was the five-row display slice of the members table and must never be the
     population a total describes (Codex round 1, F2). */
  const population = membersDisclosing(t.txns, stamps.generatedAtDate, 12, Number.MAX_SAFE_INTEGER);
  const members12 = population.length;
  const buys12 = population.reduce((n, m) => n + m.buys, 0);
  const sells12 = population.reduce((n, m) => n + m.sells, 0);
  // Timeliness has THREE states: late, inside the window, and unknown (no
  // trade date, so no lag). The universal statement is reserved for a
  // non-empty population whose timeliness is fully known (Codex round 1, F4).
  const late = t.txns.filter((r) => r.late === 1).length;
  const unknownTimeliness = t.txns.filter((r) => r.lag == null).length;
  const holders = inst.state === "data" ? inst.holders?.length ?? 0 : null;
  /* The figure is the full holder count when the reviewed mapping knows it;
     the table lists the top slice of it, and the sub-line says so. A bare
     "500" beside "the 500 largest of the 5,662" read as two answers. */
  const holdersAll = inst.state === "data" && inst.mapped ? Math.max(inst.mapped.holderCount, holders ?? 0) : null;
  /* LD9: "unknown timeliness" moved from the retired summary card into the
     Filed late figure's sub-line; its explanation is the figure's note. */
  const lateSub =
    t.txns.length === 0
      ? { detail: "no rows on record", subKind: "absence" as const }
      : unknownTimeliness > 0
        ? { detail: `${fmtInt(unknownTimeliness)} of ${fmtInt(t.txns.length)} undated: timeliness unknown`, subKind: "count" as const }
        : late > 0
          ? /* launch copy audit ticker-03: the label, the SELL tone and the
               figure's note ("past the STOCK Act's 45-day window") say it */
            { detail: "", subKind: "qualifier" as const }
          : { detail: "every row filed inside 45 days", subKind: "qualifier" as const };
  const ledger = disclosureLedger(
    [
      /* Launch copy audit ticker-03: #163 settled the 13F figure (the holder
         count with "top N listed"); the remainder is the PTR jargon in the
         other labels. */
      { label: "Congress trades", value: fmtInt(t.txns.length), detail: "all time", subKind: "count" },
      { label: "Members · 12m", value: fmtInt(members12), detail: `${fmtInt(buys12)} buys · ${fmtInt(sells12)} sells · by trade date`, subKind: "count" },
      { label: "Latest filing", value: latestFiled ? latestFiled.slice(5) : "—", detail: latestFiled ?? "no filing on record", subKind: latestFiled ? "date" : "absence" },
      {
        label: "Filed late",
        value: fmtInt(late),
        ...lateSub,
        tone: late > 0 ? "sell" : "ink",
        noteHtml: esc(
          `Rows filed past the STOCK Act's 45-day window, stated on the row, never editorialised; both dates and the receipt stay on every row.` +
            (unknownTimeliness > 0
              ? ` ${fmtInt(unknownTimeliness)} ${unknownTimeliness === 1 ? "row discloses" : "rows disclose"} no trade date: the lag is unknown there, not zero, so the timeliness of ${unknownTimeliness === 1 ? "that row" : "those rows"} is unknown.`
              : ""),
        ),
      },
      {
        label: "13F holders",
        value: holders === null ? "—" : fmtInt(holdersAll ?? holders),
        detail:
          inst.state === "data"
            ? holdersAll !== null
              ? `${holdersAll > (holders ?? 0) ? `top ${fmtInt(holders ?? 0)} listed` : "all listed"} · ${inst.period ?? ""}`
              : `top-${fmtInt(inst.topn ?? 25)} slice · ${inst.period ?? ""}`
            : inst.state === "module-absent"
              ? "13F module not in build"
              : "ticker not resolved to an issuer",
        subKind: inst.state === "data" ? "qualifier" : "absence",
      },
    ],
    { scope: "ticker-ledger" },
  );

  /* R16: two real tabs. Server HTML shows both panels, stacked; the binder
     (`scripts/tabs.ts`) sets aria-selected and the roving tabindex, and hides
     the inactive panel only once it runs. */
  const tabs =
    `<div class="tk-tabs" role="tablist" aria-label="Sections">` +
    `<a class="tk-tab" role="tab" id="tab-congress" href="#congress" aria-controls="congress">Congress <span class="tk-tab-n">${fmtInt(t.txns.length)}</span></a>` +
    `<a class="tk-tab" role="tab" id="tab-institutional" href="#institutional" aria-controls="institutional">Institutional${
      inst.state === "data" ? ` <span class="tk-tab-n">${fmtInt(inst.holders?.length ?? 0)}</span>` : ""
    }</a>` +
    `</div>`;

  return (
    `<div class="page-head">` +
    `<div class="page-head-copy">` +
    /* launch copy audit ticker-01: the "Public record / Tickers / X" kicker repeated the H1 */
    `<h1 class="entity-title">${tickerTitleHtml(info)}</h1>` +
    `</div>` +
    ledger +
    `</div>` +
    /* R17 / LD9: the provenance line carries each section's own clock (it was
       the lede's sentence). Launch copy audit ticker-04: each regime's clock
       stated once — Congress in statutory ranges on the 45-day filing clock,
       13F as quarter-end snapshots filed up to 45 days later — without the
       sentence that restated them. */
    `<div class="design-provenance"><span class="tk-clock">Congress: statutory ranges, filed up to 45 days after the trade · 13F: quarter-end snapshots, filed up to 45 days later</span>` +
    `<span class="stamp-line">as of ${esc(stamps.generatedAtDate)}</span></div>` +
    onSignals +
    tabs +
    /* PANEL 1 — Congress: the timeline beside the members active, then the
       disclosures (R20) */
    `<section class="tk-panel" role="tabpanel" id="congress" aria-labelledby="tab-congress">` +
    `<div class="design-band design-ticker-band design-ticker-time">` +
    timelineHtml(t, stamps, pinnedIds) +
    membersActiveHtml(t, stamps, ctx, deps) +
    `</div>` +
    `<div class="design-band design-ticker-band design-ticker-congress">` +
    `<section class="panel" aria-label="Congressional disclosures">` +
    `<div class="panel-head"><h2 class="section-h">Congressional disclosures</h2>` +
    /* Launch copy audit ticker-08: the order in a few words and one link to
       every row; the ranges and the filing clock are the provenance line's, and
       both dates show on every row. */
    `<span class="panel-note">${pinned.length > 0 && !opts.fullTable ? "Signals rows first, then newest" : "Newest filed first"}</span>` +
    (opts.fullTable ? "" : `<a class="section-link" href="${congressTickerHref(t.ticker)}">All ${fmtInt(t.txns.length)} ${t.txns.length === 1 ? "row" : "rows"} ↗</a>`) +
    `</div>` +
    recent +
    `</section>` +
    `</div>` +
    `</section>` +
    /* PANEL 2 — Institutional (R21): who holds (with crowding), then the
       Congress ↔ notable-managers overlap, then "Do the two regimes agree?" */
    `<section class="tk-panel" role="tabpanel" id="institutional" aria-labelledby="tab-institutional">` +
    `<div class="design-band design-ticker-band design-ticker-holders">` +
    `<div>` + tickerInstSectionHtml(inst, t.ticker) + `</div>` +
    crowdingHtml(deps?.crowding ?? null, inst) +
    `</div>` +
    (deps?.overlap ?? "") +
    `<div class="design-band design-ticker-band design-ticker-agree">` +
    agreementHtml(t, stamps, inst) +
    `</div>` +
    `</section>`
  );
}

/* ---------- Ticker.dc.html bands ---------- */

/** The institutional side has FOUR distinct absence states and each band must
    name the one that applies rather than collapsing them into "not resolved". */
function instAbsenceReason(inst: TickerInstSection, consequence: string, whenData: string): string {
  switch (inst.state) {
    case "data":
      return whenData;
    case "resolved-no-data":
      return `The ticker resolves to ${esc(inst.name ?? "an issuer")} (CIK ${esc(inst.cik ? fmtCik(inst.cik) : "?")}), but this build's aggregate holds no entity-keyed holder rows for it — its 13F securities are provisional identities without a CUSIP→issuer bridge — so ${consequence}.`;
    case "module-absent":
      return `This build does not include the institutional module, so ${consequence}.`;
    case "no-map":
      return `This build carries no ticker→issuer mapping input, so ${consequence}.`;
    case "ambiguous":
      return `This ticker names more than one issuer in the SEC's present-day ticker file, so ${consequence}.`;
    default:
      return `This ticker is not in the SEC's present-day ticker file, so ${consequence}.`;
  }
}

const LOG_LO = 3;
const LOG_HI = Math.log10(50_000_000);
function logPos(usd: number): number {
  return Math.max(0, Math.min(100, ((Math.log10(Math.max(usd, 1000)) - LOG_LO) / (LOG_HI - LOG_LO)) * 100));
}
function dayNum(iso: string): number {
  return Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / 86_400_000;
}

/** R20: the timeline's dollar gridlines — the lower bounds of three
    statutory ranges ($15,001, $250,001, $5,000,001) — labelled by the round
    figure the ranges are known by. */
export const TIMELINE_GRIDLINES: readonly (readonly [number, string])[] = [
  [15_000, "$15K"],
  [250_000, "$250K"],
  [5_000_000, "$5M"],
];

/** Congress · disclosure timeline: one mark per dated row in the trailing 24
    months by TRADE date, x = position in the window, y = log lower bound,
    fill = side. Rows without a trade date cannot be placed and are counted.
    signals-v3 M3 (R19, R20): $15K / $250K / $5M gridlines, and a ring on each
    mark whose row is pinned from the "On Signals" block. */
function timelineHtml(t: TickerEntity, stamps: BuildStamps, pinned: ReadonlySet<string> = new Set()): string {
  const bounds = legacyTrailingMonthsBounds(stamps.generatedAtDate, 24);
  const rows = excludeDateAnomalies(t.txns).rows.filter((r) => windowMembership(r, bounds, "traded") === "in" && r.traded);
  const undated = t.txns.filter((r) => !r.traded).length;
  const span = Math.max(1, dayNum(bounds.end) - dayNum(bounds.start));
  const ringed = rows.filter((r) => pinned.has(r.txnId)).length;
  const marks = rows
    .map((r) => {
      const x = ((dayNum(r.traded!) - dayNum(bounds.start)) / span) * 100;
      const y = r.low == null ? 4 : logPos(r.low);
      const side = r.side === "purchase" ? "buy" : r.side === "sale" || r.side === "sale_partial" ? "sell" : "other";
      return `<i class="tl-mark tl-${side}${pinned.has(r.txnId) ? " tl-ring" : ""}" style="left:${x.toFixed(1)}%;bottom:${y.toFixed(1)}%"></i>`;
    })
    .join("");
  const grid = TIMELINE_GRIDLINES.map(
    ([usd, label]) => `<span class="tl-grid" style="bottom:${logPos(usd).toFixed(1)}%"><span class="tl-grid-label">${esc(label)}</span></span>`,
  ).join("");
  const ticks = [0, 6, 12, 18, 24].map((m) => {
    const d = new Date(Date.UTC(+bounds.start.slice(0, 4), +bounds.start.slice(5, 7) - 1 + m, 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  });
  /* Launch copy audit ticker-06: one meta line — the axis, the window, the
     rows placed, and (when any) the rows that cannot be placed — with the
     legend and the trade-date-not-filing-date note as its tip. */
  const legend =
    `▲ buy, ▼ sell; height = lower bound (log scale)${ringed > 0 ? "; ringed = on Signals" : ""}. ` +
    `Trade date, not filing date — the filing lag is in the table below.`;
  return (
    `<section class="panel design-timeline" aria-label="Congress disclosure timeline">` +
    `<div class="panel-head"><h2 class="section-h">Congress · disclosure timeline</h2>` +
    `<span class="panel-note">By trade date · 24 months · ${fmtInt(rows.length)} ${rows.length === 1 ? "row" : "rows"}` +
    (undated > 0 ? ` · ${fmtInt(undated)} undated, not placed` : "") +
    " " +
    noteFromHtml(esc(legend), { scope: "ticker-timeline" }, "legend", { trigger: "mark", name: "Timeline legend" }) +
    `</span></div>` +
    (rows.length === 0
      ? `<p class="section-note">No dated ${esc(t.ticker)} rows fall inside the trailing 24 months by trade date.</p>`
      : `<div class="tl-plot" aria-hidden="true">${grid}${marks}</div>` +
        `<div class="tl-axis" aria-hidden="true">${ticks.map((x) => `<span>${esc(x)}</span>`).join("")}</div>` +
        `<p class="visually-hidden">${fmtInt(rows.length)} dated disclosures in the window, placed by trade date; magnitudes are the disclosed lower bounds, against gridlines at ${TIMELINE_GRIDLINES.map(([, l]) => l).join(", ")}` +
        `${ringed > 0 ? `; ${fmtInt(ringed)} ringed ${ringed === 1 ? "mark is a row" : "marks are rows"} on Signals, pinned in the table below` : ""}` +
        `${undated > 0 ? `; ${fmtInt(undated)} ${undated === 1 ? "row discloses" : "rows disclose"} no trade date and cannot be placed` : ""}.</p>`) +
    `</section>`
  );
}

/** Members active: rows, net lower bound (interval subtraction, the same
    memberNetByTicker every member page uses), and committee membership as of
    the member's latest trade date when the build carries the roster. */
function membersActiveHtml(t: TickerEntity, stamps: BuildStamps, ctx: RenderCtx, deps: TickerPageDeps | null): string {
  const bounds = legacyTrailingMonthsBounds(stamps.generatedAtDate, 12);
  const byMember = new Map<string, TxnRow[]>();
  for (const r of excludeDateAnomalies(t.txns).rows) {
    if (windowMembership(r, bounds, "traded_or_filed") !== "in") continue;
    const key = r.bioguide ?? `raw:${r.name}`;
    byMember.set(key, [...(byMember.get(key) ?? []), r]);
  }
  const members = [...byMember.entries()]
    .map(([key, rows]) => {
      const first = rows[0]!;
      const net = memberNetByTicker(rows).rows[0]?.net ?? { kind: "empty" as const };
      const latest = rows.map((r) => r.traded).filter((d): d is string => !!d).sort().at(-1) ?? null;
      let committee: string | null = null;
      if (deps?.committees && first.bioguide) {
        const snap: MembershipSnapshot = { memberships: deps.committees.byMember.get(first.bioguide) ?? [], windowFrom: deps.committees.windowFrom, windowTo: deps.committees.windowTo };
        const asOf = membershipAsOf(snap, latest);
        committee = asOf === null ? "unanswerable" : asOf.length === 0 ? "—" : `${fmtInt(asOf.length)}`;
      }
      return { key, first, rows: rows.length, net, committee };
    })
    .sort((a, b) => b.rows - a.rows || (a.first.name < b.first.name ? -1 : 1))
    .slice(0, 8);
  /* R12 (DESIGN-POLISH M2): the Committees column renders only when some shown
     member carries a committee statement; without the roster it is removed and
     its absence stated in the foot. With the roster, a member whose rows carry
     no member ID cannot be matched to it at all — the reason says so rather
     than claiming that member sat on no committee (review R2-9). */
  const unmatchable = members.filter((m) => !m.first.bioguide).length;
  const committeesEmptyReason = !deps?.committees
    ? "Committees: committee membership data is not in this build; absence is stated rather than guessed from current rosters."
    : unmatchable === members.length
      ? "Committees: none of these members carries a member ID, so none can be matched to the committee roster — unanswerable, not cleared."
      : unmatchable > 0
        ? `Committees: no matched member sat on a committee as of their latest trade in the window; ${fmtInt(unmatchable)} ${unmatchable === 1 ? "member carries" : "members carry"} no member ID and cannot be matched to the roster — unanswerable, not cleared.`
        : "Committees: none of these members sat on a committee as of their latest trade in the window.";
  const cols = presentColumns(members, [
    { key: "member", always: true },
    { key: "rows", always: true },
    { key: "net", always: true },
    {
      key: "committees",
      hasValue: (m) => m.committee !== null && m.committee !== "—",
      emptyReason: committeesEmptyReason,
    },
  ]);
  const hasCommittees = cols.columns.includes("committees");
  const rowsHtml = members
    .map((m) => {
      const dir = netDirection(m.net);
      return (
        `<tr><td class="c-member c-flex">${m.first.bioguide ? `<a href="${memberHrefFor(m.first.bioguide, ctx)}">${esc(m.first.name)}</a>` : esc(m.first.name)} <span class="aff ${partyClass(m.first.party)}">${esc(affTextOf(m.first))}</span></td>` +
        `<td class="c-num">${fmtInt(m.rows)}</td>` +
        `<td class="c-num ${dir === "accumulation" ? "c-buy" : dir === "disposal" ? "c-sell" : "c-muted"}">${esc(netIntervalText(m.net))}</td>` +
        (hasCommittees ? `<td class="c-num ${m.committee && m.committee !== "—" && m.committee !== "unanswerable" ? "c-amber" : "c-muted"}">${m.committee === null ? "—" : esc(m.committee)}</td>` : "") +
        `</tr>`
      );
    })
    .join("\n");
  return (
    `<section class="panel design-members-active" aria-label="Members active">` +
    `<div class="panel-head"><h2 class="section-h">Members active in ${esc(t.ticker)}</h2>` +
    /* Launch copy audit ticker-07: the window and the order in a few words;
       the two method lines are its tip. (Without the roster, the table foot
       still states the Committees column's absence.) */
    `<span class="panel-note">12 months · most active first ` +
    noteFromHtml(
      esc(
        `Rows = number of disclosures, not dollars. Net = lower bound of the net range. ` +
          (deps?.committees
            ? `Committees as of each member's latest trade in the window (roster snapshot ${deps.committees.snapshotDate}).`
            : "The committee roster is not in this build."),
      ),
      { scope: "ticker-members" },
      "method",
      { trigger: "mark", name: "How this table counts" },
    ) +
    `</span></div>` +
    (members.length === 0
      ? `<p class="section-note">No member disclosed ${esc(t.ticker)} in the trailing 12 months.</p>`
      : `<div class="table-scroll"><table class="etable etable-compact"${dataColumnsAttr(cols)}><caption class="visually-hidden">Members disclosing ${esc(t.ticker)} in the trailing 12 months</caption>` +
        `<thead><tr>` +
        thHtml({ label: "Member", cls: "c-member c-flex", col: "member" }) +
        thHtml({ label: "Rows", cls: "c-num", col: "rows" }) +
        thHtml({ label: "Net", cls: "c-num", notes: { scope: "ticker-members" }, noteKey: "net", noteHtml: esc("Net disclosed flow for this ticker: purchases minus sales, computed as a net range on the disclosed amounts. A lower bound is provable, never a point."), col: "net" }) +
        (hasCommittees
          ? thHtml({ label: "Committees", cls: "c-num", notes: { scope: "ticker-members" }, noteKey: "committees", noteHtml: esc("Number of committees the member sat on as of their latest trade date in the window, from the cc0-legislators roster snapshot. Context, never an allegation; jurisdiction overlap needs the sector join."), col: "committees" })
          : "") +
        `</tr></thead>` +
        `<tbody>${rowsHtml}</tbody></table></div>` +
        tableFootReasonHtml(cols) +
        /* launch copy audit ticker-07: the range alone ("1–8 of 28"); the
           heading names the members and the meta the window */
        `<p class="section-note">${byMember.size > members.length ? esc(rangeOfTotal(1, members.length, byMember.size, "").trim()) : `${fmtInt(byMember.size)} ${byMember.size === 1 ? "member" : "members"}`}</p>`) +
    `</section>`
  );
}

function crowdingHtml(c: TickerCrowding | null, inst: TickerInstSection): string {
  if (c === null) {
    return unavailableDesignPanel("Crowding", "PCT-RANK VS TRACKED NAMES", ["Measure", "Percentile"], instAbsenceReason(inst, "it cannot be ranked among tracked names", "No holder rows for the selected period, so no percentile can be ranked."), "design-crowding");
  }
  const bar = (label: string, pct: number, text: string, hint: string): string =>
    `<div class="book-metric"><dt>${note(hint, { scope: "ticker-crowding" }, label, { trigger: "label", textHtml: esc(label) })}</dt><dd>` +
    `<span class="book-track" aria-hidden="true"><span class="${pct >= 85 ? "book-hot" : ""}" style="width:${pct}%"></span></span>` +
    `<span class="${pct >= 85 ? "c-amber" : ""}">${esc(text)}</span><span class="book-compare"></span></dd></div>`;
  const ord = (n: number): string => `${n}${n % 100 >= 11 && n % 100 <= 13 ? "th" : n % 10 === 1 ? "st" : n % 10 === 2 ? "nd" : n % 10 === 3 ? "rd" : "th"}`;
  return (
    `<section class="panel design-crowding" aria-label="Crowding">` +
    `<div class="panel-head"><h2 class="section-h">Crowding</h2><span class="panel-note">PCT-RANK VS ${fmtInt(c.issuers)} RANKED ISSUERS · ${esc(c.period)}</span></div>` +
    `<dl>` +
    bar("Holder count", c.holderCount.pct, ord(c.holderCount.pct), `${fmtInt(c.holderCount.value)} ranked holders in the top-N slice; percentile among every issuer with holder rows for the period.`) +
    (c.avgWeightBps
      ? bar("Avg weight", c.avgWeightBps.pct, ord(c.avgWeightBps.pct), `Mean weight of this issuer in its ranked holders' complete books (${fmtInt(c.avgWeightBps.holdersWithBook)} holders with a fully valued book): ${(c.avgWeightBps.value / 100).toFixed(2)}% of book.`)
      : `<div class="book-metric"><dt>Avg weight</dt><dd><span class="book-track" aria-hidden="true"></span><span class="c-muted">—</span><span class="book-compare">no complete holder book</span></dd></div>`) +
    bar("Composite", c.compositePct, ord(c.compositePct), "Mean of the available percentiles.") +
    `</dl>` +
    `<p class="section-note">A high percentile is a sizing warning, not a call — crowded names exit together. Ranks are over the aggregate's top-N holder slices, not a census.</p>` +
    `</section>`
  );
}

function agreementHtml(t: TickerEntity, stamps: BuildStamps, inst: TickerInstSection): string {
  const bounds = legacyTrailingMonthsBounds(stamps.generatedAtDate, 12);
  const rows = excludeDateAnomalies(t.txns).rows.filter((r) => windowMembership(r, bounds, "traded_or_filed") === "in");
  const buys = rows.filter((r) => r.side === "purchase").length;
  const sells = rows.filter((r) => r.side === "sale" || r.side === "sale_partial").length;
  const net = memberNetByTicker(rows).rows[0]?.net ?? { kind: "empty" as const };
  const dir = netDirection(net);
  const total = Math.max(1, buys + sells);
  const row = (k: string, left: number, right: number, text: string, cls: string): string =>
    `<div class="agree-row"><span class="agree-k">${esc(k)}</span><span class="design-diverging" aria-hidden="true"><span style="right:50%;width:${((left / total) * 50).toFixed(1)}%"></span><span class="sale" style="left:50%;width:${((right / total) * 50).toFixed(1)}%"></span></span><span class="agree-v ${cls}">${esc(text)}</span></div>`;
  return (
    `<section class="panel design-agree" aria-label="Do the two regimes agree">` +
    `<div class="panel-head"><h2 class="section-h">Do the two regimes agree?</h2><span class="panel-note">TRAILING 12M · CONGRESS vs FILERS NET</span></div>` +
    row("Congress net (rows)", buys, sells, rows.length === 0 ? "no rows" : `${fmtInt(buys)} buy / ${fmtInt(sells)} sell`, dir === "accumulation" ? "c-buy" : dir === "disposal" ? "c-sell" : "c-muted") +
    row("Congress net ($ bound)", dir === "accumulation" ? 1 : 0, dir === "disposal" ? 1 : 0, netIntervalText(net), dir === "accumulation" ? "c-buy" : dir === "disposal" ? "c-sell" : "c-muted") +
    `<div class="agree-row agree-unavailable"><span class="agree-k">Filers net (actions)</span><span class="design-diverging" aria-hidden="true"></span><span class="agree-v c-muted">not in build</span></div>` +
    `<div class="agree-row agree-unavailable"><span class="agree-k">Filers net ($ Q/Q)</span><span class="design-diverging" aria-hidden="true"></span><span class="agree-v c-muted">not in build</span></div>` +
    `<p class="section-note">${instAbsenceReason(inst, "the filer side cannot be computed", "The filer side needs per-issuer quarter-over-quarter actions, which the published aggregate does not carry for this issuer.")} Convergence and divergence are stated only when both sides are computed.</p>` +
    `</section>`
  );
}

