/* Pure page/section renderers. Every entity body is a string function called
   by the thin .astro page for SSR AND by the generic-route client driver —
   parity is by construction (one function, two callers). No Node APIs, no DOM.

   Honesty grammar: G1–G7 via the canonical format.ts components; charts
   zero-based, gaps stay gaps, no midpoints; NULL-honest institutional
   integers; the as-of time stamp every 13F table carries. */

/* ui/institutional.ts — 13F holders, filer and adds surfaces plus the
   homepage notable rail. One of the ui/ domain modules: consumers import
   from ./index.ts only, never from this file directly. */

import {
  type RenderCtx,
  type StatTile,
  type FootnoteEntry,
  type NoteCtx,
  assetNameCell,
  colWhyHtml,
  fnMark,
  noteBody,
  noteFromHtml,
  esc,
  fmtInt,
  fmtUsd,
  amountText,
  sideLabel,
  ownerNote,
  flagTags,
  universalFlags,
  universalFlagNote,
  srcLink,
  srcLinkDerived,
  terminusRow,
  compactDisclosure,
  COMPACT_ROWS,
  statTiles,
  memberHrefFor,
  tickerHrefFor,
  partyClass,
} from "../format.ts";
import {
  type FilingWindow,
  type NotableRecentResult,
  affTextOf,
  qoqPresentation,
  edgarFilerUrl,
} from "../derive.ts";
import {
  filerHref,
  holdingsPageCount,
  holdingsPageSlice,
  holdingsRangeText,
  sortQoqDeltas,
  type FilerBudgetState,
} from "../holdings.ts";
import { serializeInlineJson } from "../inline-json.ts";
import type { ConcentrationRow, QoqDeltaRow, TopHolderRow } from "../inst.ts";
import { HOLDER_COLUMNS, HOLDER_ZERO_CAVEAT, holderSortNote, orderRankedHolders, type HolderSortKey } from "../holders-sort.ts";
import { addsRowHtml } from "../inst-adds-render.ts";
import {
  ADDS_MODES,
  addsNoteHtml,
  addsPayloadHref,
  type AddsMode,
  type AddsPayload,
} from "../inst-adds.ts";
import { type CongressColumn } from "../congress-columns.ts";
import { breadcrumb } from "./shared.ts";
import { s7Banner } from "./states.ts";

/** The institutional table time stamp. The published aggregate has
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

/* ---------- 13F holders page body (build-time only) ---------- */

/* The two clauses `#holders-footnotes` published, each moved to the
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
        // ONE href primitive (filerHref): tier rides on the row through the SSR call
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
  /* `HOLDER_COLUMNS.why` was declared REQUIRED for every unsortable
     column and then never rendered by this header — the reason a reader was
     promised existed only in the source. It renders now, as a note, together
     with the § clause that `#holders-footnotes` carried for the Src column.
     This table renders on `/institutional/tickers/[t]/holders/` only, which is
     in scope, so the scope is fixed here rather than threaded (opt-in threading
     is for renderers shared with routes this run does not own). */
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

/* The position-changes table's `<thead>` is a literal with no sort
   key, so the plan supplies the column descriptors and the emitter-verified
   mark→column mapping. Read off where each marker is actually RENDERED, not off
   the column names: `qoqPresentation.chipMarkers` prints †v/‡e/n-c on the Change
   chip, `positionMarkers` prints ‡r beside the position key, ‡u withholds the
   share delta, and § is this variant's derivation clause — this table renders no
   Src column, so it hangs on Δ value. */
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
        /* Column order is the answer to "added or trimmed?" arriving before
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
    /* The filer tiles' breakdowns become notes, keyed on each
       tile's LABEL — unique within a tile group by construction, in both the
       populated and the null-concentration branch. The scope is fixed rather
       than derived from the period: `entity-client.ts` re-renders this whole
       section on a period change, and an id that moved with the period would
       make the server's bytes and the client's differ for the same row set
       (Constraint 5). */
    statTiles(filerTiles(conc, total), {
      label: `Period statistics for ${period}`,
      compact: true,
      notes: { scope: "filer-tiles" },
    }) +
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

/* ---------- the recently-added-issuers leaderboard ---------- */

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

/** The leaderboard's column contract. Its orders are well-defined — every
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
    /* Each mark's text moves onto the column it qualified —
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
      // Same rule as the ranking head — Issuer, Δ value and Top adder
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
  /** every period the selector may offer — closed periods only */
  periods: readonly string[];
  buildId: string;
}

/** The leaderboard section: closed-period selector, new-only toggle, the note
    composed from BOTH independent omission states, and the bounded table. */
export function addsSectionHtml(payload: AddsPayload, opts: AddsSectionOpts): string {
  // The payload arrives ALREADY BOUNDED, from the endpoint or from the
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
    /* This sentence used to end "the quarter shown above is rendered in
       full below", which the renderer directly contradicts — it slices to the
       compact bound like every other table. A reader with scripting off was
       told the table was complete while issuers were being omitted, which is
       the precise failure the truncation machinery exists to prevent. It now
       states the bound AND gives a no-JS route to the whole bounded payload. */
    `<noscript> Changing the quarter or the mode needs JavaScript, and the table below is the ` +
    `compact slice of this quarter — not the whole of it. The complete bounded payload for this ` +
    `quarter is published as JSON at <a href="${esc(addsPayloadHref(opts.period, opts.mode))}">` +
    `${esc(addsPayloadHref(opts.period, opts.mode))}</a>.</noscript></p>` +
    /* Two sibling `.mgr-chips` groups STACKED, each with only an
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
    /* The NAMED bound, stated by the control itself and
       VISIBLE from the server. The leaderboard and the directory used to render
       a disclosure control with no statement of what it was holding back; the
       statement then lived in a separate terminus row above, which is the
       duplication the merged control removes. The link to THIS quarter-and-mode's published
       JSON is the state-independent remainder — the no-JS route to every row,
       true in both states, so expanding never takes it away.

       The note below reports the ENDPOINT's truncation, which is a
       different fact from this render bound and is stated separately. */
    compactDisclosure({
      rootId: "inst-adds-tbody",
      total,
      shown,
      noun: "issuers",
      bound:
        `Every issuer in this quarter's bounded payload remains in ` +
        `<a href="${esc(addsPayloadHref(opts.period, opts.mode))}">the published JSON</a>.`,
    }) +
    // The note container ALWAYS renders, even when empty: the client cannot
    // insert a container that was never there, so an initially-absent note
    // meant a later period's omission could not be stated at all.
    (addsNoteHtml(payload) || `<div class="caveat-line" id="inst-adds-note"></div>`) +
    // The live status node the period/mode control writes into. It was
    // targeted by the failure handler but never rendered, so a failed fetch
    // reached the console and nothing else — the reader saw the old quarter
    // with no indication their request had failed. It is `role="status"` so a
    // screen reader is told too, and it renders in EVERY state.
    `<p class="caveat-line" id="inst-adds-status" role="status" aria-live="polite"></p>` +
    // The bounded rows travel with the page so the island can sort and
    // expand them WITHOUT a fetch. Without this the compact slice was a
    // one-way door: rows past it were unreachable on the default view.
    `<script type="application/json" id="inst-adds-data">${serializeInlineJson(payload.rows)}</script>` +
    `</section>`
  );
}

/* ---------- A-4: homepage "notable this week" rail ---------- */

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
