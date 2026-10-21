import { briefingCards, disclosureLedger, pairBandHtml, unavailableDesignPanel } from "./shared.ts";
import { MANAGER_TYPE_LABELS, type ManagerTyping } from "../manager-directory.ts";
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
  changeEdgeAttr,
  kindWordHtml,
  fmtCik,
  fnMark,
  hangMark,
  noteBody,
  noteFromHtml,
  thHtml,
  rangeOfTotal,
  presentColumns,
  dataColumnsAttr,
  flagsColumnSpec,
  tableFootReasonHtml,
  type PresentColumns,
  esc,
  fmtInt,
  fmtUsd,
  amountText,
  sideLabel,
  ownerQualifiersHtml,
  flagTags,
  universalFlags,
  universalFlagNote,
  srcLink,
  srcLinkDerived,
  terminusRow,
  compactDisclosure,
  COMPACT_ROWS,
  memberHrefFor,
  tickerHrefFor,
  partyClass,
  cardFoot,
} from "../format.ts";
import {
  type FilingWindow,
  type NotableRecentResult,
  affTextOf,
  qoqPresentation,
  edgarFilerUrl,
} from "../derive.ts";
import {
  institutionalDataNoteHtml,
  filerHref,
  filerLinkHtml,
  holdingsPageCount,
  holdingsPageSlice,
  holdingsRangeText,
  sortQoqDeltas,
  type FilerBudgetState,
} from "../holdings.ts";
import { heldIslandHtml } from "../held-rows.ts";
import { positionAnchor } from "../notable-moves.ts";
import type { ConcentrationRow, QoqDeltaRow, TopHolderRow, TickerHolderRow, TickerTotalsRow } from "../inst.ts";
import type { ClusterBoardResult, ClusterRow } from "../activity.ts";
import type { ConcentrationBenchmark, NewPositionLeaders } from "../inst-analytics.ts";
import { HOLDER_COLUMNS, HOLDER_ZERO_CAVEAT, holderSortNote, orderRankedHolders, type HolderSortKey } from "../holders-sort.ts";
import { addsBoundHtml, addsRowHtml } from "../inst-adds-render.ts";
import {
  ADDS_MODES,
  addsBoundNoun,
  addsNoteHtml,
  addsPayloadHref,
  type AddsMode,
  type AddsPayload,
} from "../inst-adds.ts";
import { type CongressColumn } from "../congress-columns.ts";
import { quarterLabel } from "../congress-quarter.ts";
import { breadcrumb } from "./shared.ts";
import { s7Banner } from "./states.ts";

/** The institutional table time stamp. The published aggregate has
    no per-row filed date, so the honest form pairs the quarter-end with the
    module's build-wide filed-date watermark — never "current holdings". */
export function instStamp(period: string, latestFiled: string | null): string {
  // SRC §5: "Quarter ended {period}"; the newest-filing date moves to the ⓘ
  // (`instFiledNote`) beside the table it qualifies.
  return `<span class="inst-stamp"${latestFiled ? ` data-latest-filed="${esc(latestFiled)}"` : ""}>Quarter ended ${esc(period)}</span>`;
}

/** SRC §5: the ⓘ text for the quarter stamp. */
export function instFiledNote(latestFiled: string | null): string {
  return `${latestFiled ? `Newest filing in this build: ${latestFiled}. ` : ""}Per-row filing dates are on each receipt.`;
}

export const INST_STAMP_CAVEAT =
  "Per-row filing dates are on each receipt; the newest-filing date covers the whole build, not each row.";

/* ---------- 13F holders page body (build-time only) ---------- */

/* The two clauses `#holders-footnotes` published, each moved to the
   thing it qualifies — † to the issuer name in the lede (it is about the
   ticker→issuer mapping, not about a column), § to the Src column, which is
   where `srcLinkDerived` prints the marker. */
const HOLDERS_MAPPING_NOTE =
  `ticker→issuer via the SEC's present-day ticker list, matched only ` +
  `against entity-keyed issuers in the aggregate — a present-day mapping, not the name as of ` +
  `each filing`;
/* Architecture H (G-11): the holders surfaces read `agg_issuer_top_holders`
   (lib/inst.ts), which carries none of these fields; the table name and the
   design mockup are not reader vocabulary. */
const HOLDERS_DERIVED_NOTE =
  `derived by Public Filings from this build's published top-holders list; per-holder filed ` +
  `dates, lags, share counts and document links are not in that list and are not shown — the ` +
  `EDGAR link opens the filer's 13F filings`;

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
  const partialValue = active.some((h) => h.flags.includes("value_undisclosed_component"));
  /* DESIGN-POLISH M2 (R15): the page header's figures through the ONE ledger. */
  const ledger = disclosureLedger(
    [
      {
        label: `Top-${fmtInt(active.length)} value`,
        value: `${fmtUsd(totalValue)}${partialValue ? " · partial" : ""}`,
        detail: "",
        noteHtml: esc(`summed reported value of the ranked holders for ${period}; NULL-value positions are excluded from sums by the producer and surfaced beside them`),
      },
      { label: "Ranked holders", value: fmtInt(active.length), detail: "" },
    ],
    { scope: "holders-ledger", label: "Holder statistics" },
  );
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
    /* The issuer's name is FILED text: it stays inside its `filed-name`
       marker, and the mark trigger beside it is named in the site's own words
       — never by copying the filed name into an attribute, where the §0
       wording gate cannot see it is filed (review R-6; D17). */
    `<p class="entity-lede">Institutional holders of <span class="filed-name">${esc(issuerName)}</span>` +
    noteFromHtml(HOLDERS_MAPPING_NOTE, { scope: "holders-lede" }, "issuer-mapping", { trigger: "mark", textHtml: "†", name: "Issuer mapping" }) +
    ` per 13F filings for the quarter ended <strong>${esc(
      period,
    )}</strong>. Long positions only; managers under $100M in 13(f) securities do not file. The ranking below is a top-${fmtInt(
      topn,
    )} slice of the Public Filings aggregate — not a census.</p>` +
    `</div>` +
    ledger +
    `</header>` +
    (window?.open
      ? s7Banner(window)
      : "") +
    briefingCards([
      { tag: "Reported positions", title: "Quarter-end holdings as filed", body: "Explore the full published position list and its source filing. This record excludes the manager’s cash, shorts and non-13(f) assets." },
      { tag: "Share changes", title: "Compare consecutive quarters", body: "Position changes retain the producer’s classification and comparability flags. Share counts and reported values describe different changes." },
      { tag: "Coverage", title: "A snapshot, not current holdings", body: "Use the quarter selector to inspect available periods. Unknown values stay unknown and each table states its coverage." },
    ]) +
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
  /* R12 (DESIGN-POLISH M2): the columns over the period's FULL collection (every
     row any sort shows — a sort re-renders these same rows): Flags renders only
     when some row still shows a flag after hoisting. */
  const cols = presentColumns<TopHolderRow & { tier?: FilerBudgetState }>(rows, [
    ...HOLDER_COLUMNS.filter((c) => c.label !== "Flags").map((c) => ({ key: c.key ?? c.label, always: true })),
    flagsColumnSpec<TopHolderRow>((h) => h.flags, statedRanked),
  ]);
  const hasFlags = cols.columns.includes("flags");
  const { ranked, unranked } = orderRankedHolders(rows, sort.key, sort.dir);
  const rowHtml = (list: (TopHolderRow & { tier?: FilerBudgetState })[]): string =>
    list
    .map(
      (h) =>
        `<tr><td class="c-num c-muted has-marks">${fmtInt(h.rank)}</td>` +
        // ONE href primitive (filerHref): tier rides on the row through the SSR call
        // AND the embedded period payload, so both renders link identically.
        `<td class="c-filer c-flex"><a href="${esc(filerHref(h.cik, h.tier ?? "tail"))}">${esc(h.filer_name)}</a></td>` +
        `<td class="c-num c-strong has-marks">${esc(fmtUsd(h.value_usd))}${h.flags.includes("value_undisclosed_component") ? ' <span class="mono-note">partial</span>' : ""}</td>` +
        `<td class="c-num has-marks">${fmtInt(h.security_count)}</td>` +
        `<td class="c-keysrc c-secondary"><span class="mono-note">${esc(h.issuer_key_source)}</span></td>` +
        (hasFlags ? `<td class="c-flags">${flagTags(h.flags, undefined, { stated: statedRanked })}</td>` : "") +
        `<td class="c-src">${srcLinkDerived(null, edgarFilerUrl(h.cik))}</td></tr>`,
    )
    .join("\n");
  const body =
    rowHtml(ranked as (TopHolderRow & { tier?: FilerBudgetState })[]) +
    (unranked.length > 0
      ? `\n<tr class="unranked-sep"><td colspan="${cols.columns.length}">${fmtInt(unranked.length)} row${unranked.length === 1 ? "" : "s"} have no ` +
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
  const holderNote = (c: (typeof HOLDER_COLUMNS)[number]): string | null =>
    noteBody(c.why, c.label === "Src" ? HOLDERS_DERIVED_NOTE : null) || null;
  /* The ledger role of each holder column (DESIGN-POLISH M1, R2). */
  const HOLDER_CLASS: Record<string, string> = {
    rank: "c-num", filer: "c-filer c-flex", value: "c-num", securities: "c-num",
    keysrc: "c-secondary", Flags: "c-flags", Src: "c-src",
  };
  const heads = HOLDER_COLUMNS.filter((c) => hasFlags || c.label !== "Flags").map((c) =>
    thHtml({
      label: c.label,
      mark: null,
      cls: HOLDER_CLASS[c.key ?? c.label] ?? "",
      noteHtml: holderNote(c),
      notes: { scope: "holders-ranked" },
      noteKey: c.key ?? c.label,
      col: c.label === "Flags" ? "flags" : (c.key ?? c.label),
      sort:
        c.key === null
          ? null
          : { attr: "data-sort", key: c.key, state: c.key === sort.key ? (sort.dir === "desc" ? "descending" : "ascending") : "none" },
    }),
  ).join("");
  return (
    `<div class="panel panel-wide">` +
    `<div class="panel-head"><h2 class="section-h">Ranked holders — ${esc(period)}</h2>` +
    `<span class="panel-note">${instStamp(period, latestFiled)}</span></div>` +
    universalFlagNote(statedRanked) +
    `<div class="table-scroll"><table class="etable" data-sticky-first data-holders-table data-stated-flags="${esc(statedRanked.join(","))}"${dataColumnsAttr(cols)}>` +
    `<caption class="visually-hidden">Top institutional holders for quarter ${esc(period)}</caption>` +
    `<thead><tr>${heads}</tr></thead>` +
    `<tbody data-holders-body>${body}</tbody></table></div>` +
    tableFootReasonHtml(cols) +
    `<p class="section-note" data-holders-status role="status" aria-live="polite">${esc(holderSortNote(sort.key, sort.dir, unranked.length))}</p>` +
    terminusRow({
      author: "populus",
      html: `The aggregate publishes the top ${fmtInt(topn)} holders per issuer — a build parameter of the Public Filings aggregation. Rows beyond it exist in individual filings on EDGAR but are not ranked here. <a href="/methodology/#m2">methodology §13F ↗</a>`,
    }) +
    cardFoot({ short: "Quarter-end positions", full: INST_STAMP_CAVEAT, scope: "holders-foot", key: "stamp" }) +
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
          ? conc.null_value_positions > 0
            ? "concentration_unavailable: at least one position value is undisclosed, so the denominator is incomplete"
            : "concentration_unavailable: the period's disclosed total is 0 — the producer stores NULL, never a fabricated 0"
          : "share of the period's disclosed value held in the top-N positions; denominator is reported 13F value, not total assets",
    },
    {
      value: conc.hhi == null ? "n/a ·§" : fmtInt(conc.hhi),
      label: "HHI (bps) ·§",
      muted: conc.hhi == null,
      title:
        conc.hhi == null
          ? conc.null_value_positions > 0
            ? "concentration_unavailable: at least one position value is undisclosed, so the denominator is incomplete"
            : "concentration_unavailable: no disclosed denominator for this period"
          : "integer Herfindahl–Hirschman index in basis points over disclosed position values",
    },
    { value: fmtInt(deltaCount), label: "QoQ moves" },
  ];
}

export const QOQ_FOOTNOTES: FootnoteEntry[] = [
  {
    mark: "†v",
    // Was "direction classified from reported value, not shares" — a
    // description of what R8 REMOVED. A value-only move is not a trade now; it
    // is `held`. The fact is kept (the pair's share counts are equal), the
    // retired mechanism is named as retired rather than stated as current, and
    // the producer slug stays so an older aggregate remains decodable.
    /* W-7 (M3 review): the marker appears ONLY on a row the producer
       classified by value — an ADD or TRIM word on an unchanged share count —
       so "reads as held" beside that word was false. It says what this
       build's data did, and what builds after R8 do instead. */
    /* Launch copy audit filer-05: the producer slug (`classified_by_value`)
       left the reader copy, as the other codes below did; the flag itself and
       its decoding are untouched. */
    html: `the reported share count is unchanged across the pair; this build's data classified the change from its reported value; builds from 2026-09-10 on read it as NO CHANGE`,
  },
  {
    mark: "‡u",
    html: `reported unit changed across the pair (SH↔PRN); the share delta is withheld rather than fabricated`,
  },
  {
    mark: "‡r",
    html: `position matched across quarters by exact reported CUSIP over a registry gap — never a name match`,
  },
  {
    mark: "‡e",
    html: `EXIT = absent this quarter (disposed, delisted, confidential, or reported by an affiliate) — the filing does not say which`,
  },
  {
    mark: "n/c",
    html: `n/c = not classifiable: value undisclosed on one side of the pair, or neither shares nor value can classify it`,
  },
  {
    mark: "§",
    html: `derived by Public Filings from the published aggregate; NULL means the source did not disclose a usable value — never zero`,
  },
  {
    mark: "held",
    html: `NO CHANGE = same shares; the value moved with price, so never an ADD or a TRIM`,
  },
  {
    mark: "np",
    html: `NO PRIOR = no comparable prior quarter on record (a first filing, or a quarter filed inside an affiliate's report), so not called a new stake`,
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
  /* launch copy audit filer-05: the kinds first, then each marker's meaning,
     every clause kept (158 words became about 90) */
  change: noteBody(
    "NEW / ADD / TRIM / EXIT by share count",
    QOQ_FN.get("held"),
    QOQ_FN.get("‡e"),
    QOQ_FN.get("np"),
    QOQ_FN.get("n/c"),
    `†v: ${QOQ_FN.get("†v")}`,
  ),
  "delta-value": QOQ_FN.get("§"),
  "delta-shares": QOQ_FN.get("‡u"),
};
/** The ledger role of each change column (DESIGN-POLISH M1, R2). */
const QOQ_COL_CLASS: Record<string, string> = {
  "position-grain": "c-pos c-flex",
  change: "c-chip c-kind",
  "delta-value": "c-num",
  "delta-shares": "c-num",
  "prev-value": "c-num",
  "curr-value": "c-num",
  "prev-shares": "c-num",
  "curr-shares": "c-num",
  flags: "c-flags",
};
const QOQ_COLS: readonly (readonly [string, string])[] = [
  ["position-grain", "Position"],
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

/** R15: rows of the changes table shown before "Show more". */
export const CHANGES_COMPACT_ROWS = 20;

/** The changes table's compact bound is one PAGE of the filer's changes: its
    count names that bound (review R-3), beside the pager's whole-set range. */
export const CHANGES_PAGE_BOUND = { boundNoun: "changes on this page", definite: true } as const;

/** D5: the filer page's Position changes filter — the landing band's chip
    pattern (`mgr-chip`, `aria-pressed`), one kind at a time, "All" clears it. */
export type ChangesKindFilter = "new" | "add" | "trim" | "exit";
const CHANGES_KIND_CHIPS: readonly (readonly [ChangesKindFilter | null, string])[] = [
  [null, "All"],
  ["new", "New stakes"],
  ["add", "Adds"],
  ["trim", "Trims"],
  ["exit", "Exits"],
];

export function changesKindChipsHtml(active: ChangesKindFilter | null): string {
  return (
    `<div class="chips changes-kind-chips" role="group" aria-label="Filter position changes by kind" data-changes-kinds>` +
    CHANGES_KIND_CHIPS.map(
      ([k, label]) =>
        `<button type="button" class="mgr-chip" data-changes-kind="${k ?? "all"}" aria-pressed="${(active ?? null) === k}">${esc(label)}</button>`,
    ).join("") +
    `</div>`
  );
}

export function changesTableHtml(
  deltas: QoqDeltaRow[],
  period: string,
  /* kept in the signature its callers share: the quarter stamp and its
     newest-filing ⓘ moved to the band head (launch copy audit filer-06) */
  _latestFiled: string | null,
  opts: { total?: number; page?: number; compact?: number; kind?: ChangesKindFilter | null; chips?: boolean } = {},
): string {
  /* `deltas` arrives already ordered and bounded by `holdings.boundQoqDeltas`;
     re-ordering here is idempotent and keeps this function correct for a caller
     that hands it a raw list. `total` is the count BEFORE the bound — it is
     what every printed count uses, so a capped page never understates the
     filer's activity while looking complete. */
  const orderedAll = sortQoqDeltas(deltas);
  /* R8: `held` rows (Δshares 0 — mark-to-market only) are not position
     changes. They leave the paged table and render once, below it, in a
     collapsed group, so a value-only row never reads as an add or a trim. */
  const held = orderedAll.filter((d) => d.change_kind === "held");
  /* D2: `no_prior` rows (no comparable prior-quarter list) are not position
     changes either — they would otherwise read as a wall of new stakes. They
     render once, below the table, in their own collapsed group. */
  const noPrior = orderedAll.filter((d) => d.change_kind === "no_prior");
  const kindFilter = opts.kind ?? null;
  const ordered = orderedAll.filter(
    (d) => d.change_kind !== "held" && d.change_kind !== "no_prior" && (kindFilter === null || d.change_kind === kindFilter),
  );
  const total = opts.total ?? orderedAll.length;
  const page = opts.page ?? 0;
  const embedded = orderedAll.length;
  const pageRows = holdingsPageSlice(ordered, page);
  const pageCount = holdingsPageCount(ordered.length);
  /* Over every row of EACH table — the paged changes table and the held
     group are two tables with two stated sets (R10 #12: a flag every row of a
     table repeats is hoisted once for THAT table) — never `pageRows`. See the
     note in `holdings.ts`: a per-page set makes the caveat flicker between
     pages of one table. */
  const statedDeltas = universalFlags(ordered.map((d) => d.flags));
  const statedHeld = universalFlags(held.map((d) => d.flags));
  const statedNoPrior = universalFlags(noPrior.map((d) => d.flags));
  /* R12: each of the three tables decides its own columns over its own
     collection (the same rows its hoisting runs over): the Flags column renders
     only when some row still shows a flag after hoisting. */
  const colsFor = (rows: readonly QoqDeltaRow[], stated: readonly string[]): PresentColumns =>
    presentColumns(rows, [
      ...QOQ_COLS.filter(([key]) => key !== "flags").map(([key]) => ({ key, always: true })),
      flagsColumnSpec<QoqDeltaRow>((d) => d.flags, stated),
    ]);
  const colsDeltas = colsFor(ordered, statedDeltas);
  const colsHeld = colsFor(held, statedHeld);
  const colsNoPrior = colsFor(noPrior, statedNoPrior);
  let rowSeq = 0;
  const rowHtml = (d: QoqDeltaRow, stated: readonly string[] = statedDeltas, cols: PresentColumns = colsDeltas): string => {
    /* R1: the issuer NAME leads the row; the class is secondary ink; the raw
       position key (sid:/cusip:) moves inside the row's ⓘ. A row the serving
       artifact could not name (an older artifact, an unkeyed position) still
       shows its key — never an invented name. */
    const noteId = `${page}-${rowSeq++}`;
    const keyNote = (labelHtml: string, name: string): string =>
      noteFromHtml(
        `position key <code>${esc(d.position_key)}</code>${d.issuer_key ? ` · issuer key <code>${esc(d.issuer_key)}</code>` : ""}`,
        { scope: "filer-change-key" },
        noteId,
        { trigger: "label", textHtml: labelHtml, name },
      );
    /* The issuer NAME is the key note's LABEL trigger (no glyph beside it). */
    const identity = d.issuer_name
      ? keyNote(`<span class="filed-name">${esc(d.issuer_name)}</span>`, d.issuer_name) +
        // The class is FILED text (a fund can be named "BULLISH FD"): it rides
        // inside the filed-name marker the banned-wording scan exempts.
        (d.title_of_class ? ` <span class="mono-note c-secondary"><span class="filed-name">${esc(d.title_of_class)}</span></span>` : "")
      : `<span class="mono-note">${esc(d.position_key)}</span>`;
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
        /* R14: the landing's notable-moves rows link here, anchored at the
           position (`#pos-<slug(position_key)>`). */
        `<tr id="${esc(positionAnchor(d.position_key))}"${changeEdgeAttr(d.change_kind)}><td class="c-pos c-flex${posMarkers ? " reconciled" : ""}">${identity}${posMarkers}${grain}</td>` +
        `<td class="c-chip c-kind">${qoqChipHtml(d)}</td>` +
        `<td class="c-num">${valueDelta}</td>` +
        `<td class="c-num">${esc(p.sharesDeltaText)}</td>` +
        `<td class="c-num">${cell(d.prev_value_usd)}</td>` +
        `<td class="c-num">${cell(d.curr_value_usd)}</td>` +
        `<td class="c-num">${shareCell(d.prev_shares)}</td>` +
        `<td class="c-num">${shareCell(d.curr_shares)}</td>` +
        (cols.columns.includes("flags") ? `<td class="c-flags">${flagTags(d.flags, undefined, { stated })}</td>` : "") +
        `</tr>`
      );
  };
  /* R15: twenty rows lead; the rest of this page ride hidden behind a real
     "Show N more" (DOM-backed disclosure) — no download, no second render. */
  const compact = opts.compact ?? CHANGES_COMPACT_ROWS;
  const rows = pageRows
    .map((d, i) => {
      const html = rowHtml(d);
      return i >= compact ? html.replace(/^<tr\b/, "<tr data-compact-extra") : html;
    })
    .join("\n");
  const collapsed = pageRows.length > compact;
  const headFor = (cols: PresentColumns): string =>
    `<thead><tr>` +
    QOQ_COLS.filter(([key]) => cols.columns.includes(key)).map(([key, label]) =>
      thHtml({ label, mark: null, cls: QOQ_COL_CLASS[key] ?? "", noteHtml: QOQ_COL_NOTES[key] ?? null, notes: { scope: "filer-changes" }, noteKey: key, col: key }),
    ).join("") +
    `</tr></thead>`;
  const headHtml = headFor(colsDeltas);
  const heldGroup =
    held.length === 0
      ? ""
      : `<details class="qoq-held-group" data-qoq-held><summary>Mark-to-market only (no share change) · ${fmtInt(held.length)}</summary>` +
        `<p class="section-note">Positions whose share count is identical in both quarters; the value changed with price, not with a decision.</p>` +
        universalFlagNote(statedHeld) +
        `<div class="table-scroll"><table class="etable" data-sticky-first data-stated-flags="${esc(statedHeld.join(","))}"${dataColumnsAttr(colsHeld)}>` +
        `<caption class="visually-hidden">Positions held with no share change into quarter ${esc(period)}</caption>` +
        headFor(colsHeld).replace(/ popovertarget="n-filer-changes-/g, ' popovertarget="n-filer-held-').replace(/ aria-describedby="n-filer-changes-/g, ' aria-describedby="n-filer-held-').replace(/ id="n-filer-changes-/g, ' id="n-filer-held-') +
        `<tbody>${held.map((d) => rowHtml(d, statedHeld, colsHeld)).join("\n")}</tbody></table></div>` +
        tableFootReasonHtml(colsHeld) +
        `</details>`;
  const noPriorGroup =
    noPrior.length === 0
      ? ""
      : `<details class="qoq-held-group" data-qoq-no-prior><summary>No prior quarter to compare · ${fmtInt(noPrior.length)}</summary>` +
        `<p class="section-note">This filer has no comparable holdings list for the previous quarter on record — a first filing under this registration, or a quarter reported inside an affiliated manager's filing. These positions are not new stakes; there is nothing to compare them against.</p>` +
        universalFlagNote(statedNoPrior) +
        `<div class="table-scroll"><table class="etable" data-sticky-first data-stated-flags="${esc(statedNoPrior.join(","))}"${dataColumnsAttr(colsNoPrior)}>` +
        `<caption class="visually-hidden">Positions with no prior quarter to compare into quarter ${esc(period)}</caption>` +
        headFor(colsNoPrior).replace(/ popovertarget="n-filer-changes-/g, ' popovertarget="n-filer-noprior-').replace(/ aria-describedby="n-filer-changes-/g, ' aria-describedby="n-filer-noprior-').replace(/ id="n-filer-changes-/g, ' id="n-filer-noprior-') +
        `<tbody>${noPrior.map((d) => rowHtml(d, statedNoPrior, colsNoPrior)).join("\n")}</tbody></table></div>` +
        tableFootReasonHtml(colsNoPrior) +
        `</details>`;
  const kindLabel = CHANGES_KIND_CHIPS.find(([k]) => k === kindFilter)?.[1] ?? "";
  return (
    /* the filer page draws the kind segments on its band head (M2, F.3) */
    (opts.chips === false ? "" : changesKindChipsHtml(kindFilter)) +
    (kindFilter !== null && ordered.length === 0
      ? `<p class="section-note" data-changes-kind-empty>No ${esc(kindLabel.toLowerCase())} among this page's embedded changes for ${esc(period)}.</p>`
      : "") +
    universalFlagNote(statedDeltas) +
    `<div class="table-scroll"><table class="etable" data-sticky-first${
      pageCount > 1 ? ' data-paged="1"' : ""
    } data-stated-flags="${esc(statedDeltas.join(","))}"${dataColumnsAttr(colsDeltas)}>` +
    `<caption class="visually-hidden">Position changes into quarter ${esc(period)}</caption>` +
    headHtml +
    `<tbody id="filer-changes-tbody"${collapsed ? ' data-collapsed="true"' : ""}>${rows}</tbody></table></div>` +
    tableFootReasonHtml(colsDeltas) +
    /* The compact bound counts THIS PAGE's rows, not the filer's changes: the
       pager beside it states the whole ("101–200 of 250 changes"), so the bound
       is definite and its noun names it — "1–20 of the 100 changes on this
       page" — never "1–20 of 100 changes" (review R-3). */
    (collapsed
      ? compactDisclosure({
          rootId: "filer-changes-tbody",
          total: pageRows.length,
          shown: compact,
          noun: "changes",
          ...CHANGES_PAGE_BOUND,
          domBacked: true,
        })
      : "") +
    changesPagerHtml(page, pageRows.length, ordered.length, pageCount) +
    heldGroup +
    noPriorGroup +
    /* The bound names itself, with the TRUE total — the grammar the holdings
       surface below already uses (G3). An uncapped period must render nothing
       here: a terminus on a complete list would claim a withholding that never
       happened, which is the same lie in the other direction. */
    (total > embedded
      ? terminusRow({
          author: "populus",
          html:
            /* Architecture H (H-18): the counts are `total - embedded` and
               `total`; "derivable from" is kept because a change is computed
               from two filings, not printed in either. W-4 (M3 review): the
               embed keeps rows in `compareQoqDeltas` order — the position's
               reported value (this quarter's, else last quarter's), NOT the
               size of the change — so "keeps the largest" was false. */
            `${fmtInt(total - embedded)} of this filer's ${fmtInt(total)} quarter-over-quarter ` +
            `changes for ${esc(period)} are not included on this page, which keeps the changes on ` +
            `its largest positions by reported value (this quarter's, or last quarter's where this ` +
            `quarter has none, as for an exit) to stay within its size budget. The rest are in this build's published data and ` +
            `derivable from the filings themselves. ` +
            `<a href="/methodology/#m2">methodology §13F ↗</a>`,
        })
      : "")
    /* The "Quarter ended …" stamp and its newest-filing ⓘ moved to the band
       head's quarter label (launch copy audit filer-06; `filerPeriodSectionHtml`,
       this table's only caller). */
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

/** Period-driven concentration panel shared by static and fallback filer views.
    A filer PART (M2, F): the server, the /e/ driver and the period switch all
    render the Book shape cell through this one function. */
export function filerBookShapeHtml(
  conc: ConcentrationRow | null,
  topn: number,
  period: string,
  total: number,
  benchmark: ConcentrationBenchmark | null = null,
): string {
  /* Each metric is a bar over a fixed 0–100 scale with the tracked-population
     MEDIAN as a gold tick — the design's "vs tracked median". The tick is only
     drawn when the benchmark carries that statistic for THIS period; the
     comparison note names the population it was measured over. */
  /* Launch copy audit filer-10: the summary line under the bars repeated them
     (top-N share, HHI, null-value count), so each tile's breakdown moved onto
     the bar it explains — still a note keyed on the TILE's label (SL-R26), so
     the ids and texts are the ones the tiles always carried. */
  const tiles = new Map(filerTiles(conc, total).map((t) => [t.label, t]));
  const dtHtml = (label: string, tileLabel: string): string => {
    const tile = tiles.get(tileLabel);
    return tile?.title
      ? noteFromHtml(esc(tile.title), { scope: "filer-tiles" }, tile.label, { trigger: "label", textHtml: esc(label), name: label })
      : esc(label);
  };
  const metric = (label: string, value: number | null, text: string, med: number | null, medText: string | null, tileLabel = ""): string =>
    `<div class="book-metric"><dt>${dtHtml(label, tileLabel)}</dt><dd>` +
    `<span class="book-track" aria-hidden="true">${med === null ? "" : `<i class="book-median" style="left:${Math.max(0, Math.min(100, med))}%"></i>`}${value === null ? "" : `<span style="width:${Math.max(0, Math.min(100, value))}%"></span>`}</span>` +
    `<span>${esc(text)}</span>` +
    `<span class="book-compare${value !== null && med !== null ? (value > med ? " book-above" : value < med ? " book-below" : "") : ""}">${medText === null ? "" : esc(medText)}</span></dd></div>`;
  const share = conc?.topn_share_bps == null ? null : conc.topn_share_bps / 100;
  const hhi = conc?.null_value_positions === 0 ? conc.hhi : null;
  const known = conc && conc.position_count > 0
    ? (conc.position_count - conc.null_value_positions) / conc.position_count * 100 : null;
  const b = benchmark && benchmark.period === period ? benchmark : null;
  const medShare = b?.topnShareBps ? b.topnShareBps.median / 100 : null;
  const medHhi = b?.hhi ? b.hhi.median : null;
  const compare = (v: number | null, m: number | null, unit: string): string | null => {
    if (m === null) return null;
    if (v === null) return `median ${m.toFixed(unit === "%" ? 1 : 0)}${unit}`;
    const word = v > m ? "above" : v < m ? "below" : "at";
    return `${word} median ${m.toFixed(unit === "%" ? 1 : 0)}${unit}`;
  };
  /* Launch copy audit filer-10: the method paragraph is the head note's tip —
     the same three facts (the population the median is over, the 13F-value
     denominator, the withheld index), stated once. */
  const method =
    (b
      ? `Tick = median of the ${fmtInt(b.population)} tracked filers with a ${period} book` +
        (b.hhi ? ` (the index median: the ${fmtInt(b.hhi.n)} with a complete book)` : "") + `. `
      : `No tracked-median comparison is published for ${period}. `) +
    `Concentration uses reported 13F long value, not total assets; the index is withheld when any position lacks a value.`;
  const headNote = noteFromHtml(esc(method), { scope: "filer-bookshape" }, "median", {
    trigger: "label",
    textHtml: esc(b ? "vs median" : "no tracked median"),
  });
  return `<section class="panel design-book-shape" aria-label="Book shape">` +
    `<div class="panel-head"><h2 class="section-h">Book shape</h2><span class="panel-note">${headNote}</span></div>` +
    `<dl>${metric(`Top-${topn} concentration`, share, share === null ? "—" : `${share.toFixed(1)}%`, medShare, compare(share, medShare, "%"), "top-N share ·§")}` +
    `${metric("Concentration index", hhi === null ? null : hhi / 100, hhi === null ? "—" : `${fmtInt(hhi)} bps`, medHhi === null ? null : medHhi / 100, compare(hhi, medHhi, " bps"), "HHI (bps) ·§")}` +
    `${metric("Positions with value", known, known === null ? "—" : `${conc!.position_count - conc!.null_value_positions} / ${conc!.position_count}`, null, b?.positions ? `median book ${fmtInt(b.positions.median)} positions` : null, "null-value positions")}</dl>` +
    /* the QoQ row count, in the unit it counts: rows compared across the
       quarter pair, NO CHANGE and NO PRIOR rows included — not "changes" (R8) */
    `<p class="section-note book-source">${fmtInt(total)} quarter-over-quarter ${total === 1 ? "row" : "rows"}</p></section>`;
}

export function filerPeriodSectionHtml(
  /* kept in the signature its callers share; the concentration figures moved
     to the ledger and Book shape parts (M2), which take it themselves */
  _conc: ConcentrationRow | null,
  deltas: QoqDeltaRow[],
  period: string,
  latestFiled: string | null,
  /* kept in the signature its callers share: the changes terminus no longer
     names the top-N slice, because changes are not drawn from it (H-3) */
  _topn: number,
  opts: FilerPeriodOpts = {},
): string {
  /* R6: the producer flagged this filer-period as a BOOK DISCONTINUITY —
     ≥95% of its changes read as exits with no registry successor. It is kept
     on the page and named; the landing feeds exclude it. */
  const discontinuityBanner = opts.discontinuity
    ? `<div class="s7-banner" role="note" data-book-discontinuity><span class="s7-chip">BOOK DISCONTINUITY</span><div class="s7-copy">Into <strong>${esc(period)}</strong> almost this entire book reads as <strong>exit</strong>. That pattern is a filing-record artifact — a manager that stopped filing under this CIK, a notice-only quarter, or a registry gap — not a wave of selling. These rows are kept here and excluded from the landing feeds.</div></div>`
    : "";
  /* `total` is the count before the embed bound. Every count MUST report it: a
     capped page that counted `deltas.length` would state fewer moves than the
     filer actually made, with nothing on the page saying so. */
  const total = opts.total ?? deltas.length;
  const changes =
    total === 0
      ? `<p class="section-note">No quarter-over-quarter rows land in ${esc(
          period,
        )} — either this filer's first period on record, or neither quarter has a position with a security identifier.</p>`
      : changesTableHtml(deltas, period, latestFiled, { total, page: opts.page, kind: opts.kind ?? null, chips: false });
  /* DESIGN-POLISH M2 (F.3): the period and kind segments sit on this band's
     head. The period chips re-render with the section (their clicks are
     delegated), so the head always names the quarter it shows. */
  const periods = opts.periods ?? [];
  const periodChips =
    periods.length === 0
      ? ""
      : `<div class="head-control period-control"><span class="filter-label">Period</span><div class="chips" data-period-chips role="group" aria-label="Quarter">` +
        periods
          .map((p) => `<button type="button" class="chip${p === period ? " chip-active" : ""}" data-period="${esc(p)}" aria-pressed="${p === period}">${esc(p)}</button>`)
          .join("") +
        `</div><noscript><span class="period-note">period switching needs JavaScript; showing ${esc(period)}</span></noscript></div>`;
  /* Launch copy audit filer-04 / filer-06: the quarter heads the band ("Changes ·
     Q1 2026") and the table-foot "Quarter ended …" line folds into it. The
     stamp's content is unchanged and travels with it: the quarter end and the
     build's newest-filing date (`instFiledNote`) are the quarter label's ⓘ, so
     the filings-through date stays one tap from the table it qualifies. */
  const quarter = quarterLabel(period) ?? period;
  const quarterStamp = noteFromHtml(esc(`Quarter ended ${period}. ${instFiledNote(latestFiled)}`), { scope: "filer-changes" }, "quarter", {
    trigger: "label",
    textHtml: esc(quarter),
    name: quarter,
  });
  return (
    discontinuityBanner +
    `<section class="panel panel-wide design-changes" aria-label="Position changes">` +
    `<div class="panel-head"><h2 class="section-h">Changes · ${quarterStamp}</h2>` +
    `<span class="panel-note">by shares · <a href="/methodology/#position-grain">How classified ↗</a></span>` +
    `<div class="head-controls">` + periodChips + (total === 0 ? "" : changesKindChipsHtml(opts.kind ?? null)) + `</div></div>` +
    changes +
    /* Architecture H (H-3): QoQ pairs EVERY default position keyed by security
       id or CUSIP (inst_agg.py:83-94, :669-683, :898-965), calls the unmatched
       ones new (or no prior) and exit (:940-944), and counts a keyless holding
       in the registry (`unkeyed_positions`, :1173-1174); `topn` bounds only top
       holders and concentration. Launch copy audit filer-07: nothing is
       truncated here, so the line is a caveat, not a terminus — and it keeps the
       comparability gap. */
    `<div class="caveat-line">Holdings without a security ID are counted, not compared. <a href="/methodology/#m2">Method ↗</a></div>` +
    `</section>`
  );
}

/** Filer part: the Position changes band inside its period root
    (`[data-filer-root]`), which the period switch repaints with
    `filerPeriodSectionHtml` — the same function this wraps. */
export function filerChangesHtml(
  periods: string[],
  period: string,
  conc: ConcentrationRow | null,
  deltas: QoqDeltaRow[],
  latestFiled: string | null,
  topn: number,
  opts: FilerPeriodOpts = {},
): string {
  return `<div data-filer-root>` + filerPeriodSectionHtml(conc, deltas, period, latestFiled, topn, { ...opts, periods }) + `</div>`;
}

/** The filer's period ledger (M2, R15, A-9): Reported value, Positions, New
    stakes and Exits through the ONE header ledger. It is period-dependent, so
    it lives in its own root (`[data-filer-ledger]`) that the period switch
    repaints with this same function, and it keeps the accessible name
    "Period statistics for {period}". The kind counts are over the WHOLE
    period's changes, never the embedded slice; absent, the figure says so. */
export function filerLedgerHtml(
  conc: ConcentrationRow | null,
  period: string,
  total: number,
  kinds: { new: number; exit: number } | null,
): string {
  const [value, positions] = filerTiles(conc, total);
  return disclosureLedger(
    [
      { label: "Reported value", value: value!.value, detail: "", noteHtml: value!.title ? esc(value!.title) : undefined },
      { label: "Positions", value: positions!.value, detail: "", noteHtml: positions!.title ? esc(positions!.title) : undefined },
      {
        label: "New stakes",
        value: kinds ? fmtInt(kinds.new) : "—",
        detail: "",
        noteHtml: esc(kinds ? `positions with no comparable holding in the prior quarter (kind new), ${period}` : "new-stake count not supplied for this period"),
      },
      {
        label: "Exits",
        value: kinds ? fmtInt(kinds.exit) : "—",
        detail: "",
        noteHtml: esc(kinds ? `positions absent from this quarter's filing after being held last quarter (kind exit), ${period} — inferred from absence, not a sale record` : "exit count not supplied for this period"),
      },
    ],
    { scope: "filer-tiles", label: `Period statistics for ${period}` },
  );
}

/** Filer part: the crumb, the identity head beside the period ledger root, and
    the provenance strip (it replaces the explainer paragraph and keeps its
    links, outside the head block so the ledger's bottom meets the H1's). */
export function filerHeadHtml(
  filer: { cik: string; name: string; latestPeriod: string },
  /* kept in the signature its callers share: the reported value left the
     subline for the ledger's first figure (launch copy audit filer-01) */
  _conc: ConcentrationRow | null,
  typing: ManagerTyping | null,
  window: FilingWindow | null,
  ledgerHtml: string,
): string {
  /* Launch copy audit filer-01: the filed name, when the curated name differs,
     is the H1's tip — still inside its `filed-name` marker, so the wording gate
     reads it as filed text. */
  const filedAs =
    typing && typing.display_name !== filer.name
      ? " " +
        noteFromHtml(`Filed as <span class="filed-name">${esc(filer.name)}</span>.`, { scope: "filer-head" }, "filed-as", {
          trigger: "mark",
          textHtml: "ⓘ",
          name: "Filed name",
        })
      : "";
  return (
    breadcrumb([
      { text: "/institutional", href: "/institutional/" },
      { text: "filers" },
      { text: `CIK ${fmtCik(filer.cik)}` },
    ]) +
    `<header class="entity-head">` +
    `<div class="entity-head-copy">` +
    `<h1 class="entity-title">${esc(typing?.display_name ?? filer.name)}${filedAs}</h1>` +
    /* R15, trimmed by the launch copy audit (filer-01): identity = name ·
       principal · type · CIK · EDGAR. The reported value is the ledger's first
       figure and the quarter heads Position changes, so neither repeats here. */
    `<div class="entity-subline">` +
    (typing?.person ? `<span class="mgr-person">${esc(typing.person)}</span> · ` : "") +
    (typing ? `${esc(MANAGER_TYPE_LABELS[typing.manager_type] ?? typing.manager_type)} · ` : "") +
    `<span class="mono-id">CIK ${esc(fmtCik(filer.cik))}</span> · <a class="mono-note" href="${esc(
      edgarFilerUrl(filer.cik),
    )}" rel="noopener" target="_blank">EDGAR ↗</a></div>` +
    `</div>` +
    `<div class="filer-ledger-root" data-filer-ledger>${ledgerHtml}</div>` +
    `</header>` +
    /* QA M2-8 M6: this states the one claim the header must carry and POINTS at
       the canonical §5 box at the page foot rather than restating it. Launch
       copy audit filer-02: the same caveat in half the words, one link. */
    `<div class="design-provenance filer-provenance"><span>Quarter-end snapshot, filed up to 45 days later — ` +
    `<strong>not current holdings</strong>.</span> ` +
    `<a href="#inst-data-note">What a 13F covers ↓</a></div>` +
    (window?.open ? s7Banner(window) : "")
  );
}

/** Filer part: the Filing history, under the Book shape in band F1's right
    cell. Every available quarter, no box: the page scrolls, never the table. */
export function filerHistoryHtml(cik: string, periods: readonly string[]): string {
  return (
    /* launch copy audit filer-06: the "AVAILABLE QUARTERS" meta restated the heading */
    `<section class="panel design-filer-history" aria-label="Filing history"><div class="panel-head"><h2 class="section-h">Filing history</h2></div>` +
    `<div class="table-scroll"><table class="etable"><caption class="visually-hidden">Available filing periods</caption>` +
    `<thead><tr><th scope="col" class="c-flex">Period</th><th scope="col" class="c-src">Source</th></tr></thead>` +
    `<tbody>${periods.map((p) => `<tr><td class="c-flex">${esc(p)}</td><td class="c-src"><a href="${esc(edgarFilerUrl(cik))}" rel="noopener" target="_blank">EDGAR ↗</a></td></tr>`).join("")}</tbody></table></div>` +
    `</section>`
  );
}

/** Filer part: band F1 — Reported positions (1.7fr, the PRIMARY cell,
    compact at its fixed 20: coordinator decision CD-1) │ Book shape + Filing
    history (1fr). The holdings surface is the left cell (the page places
    `<HoldingsTable pairPrimary>` there; the /e/ driver passes the same
    surface); the Book shape has its own root the period switch repaints. */
export function filerBandHtml(holdingsCellHtml: string, bookShapeHtml: string, historyHtml: string): string {
  const side = `<div class="design-filer-side"><div class="filer-bookshape-root" data-filer-bookshape>${bookShapeHtml}</div>${historyHtml}</div>`;
  // A caller with no holdings surface (a unit fixture) gets the side cell alone: no pair to balance.
  if (!holdingsCellHtml) return `<div class="design-band design-filer-band">${side}</div>`;
  return pairBandHtml("design-filer-band", holdingsCellHtml, side, { primary: "left" });
}

/** Filer part: the EDGAR disclosure and the §5 data note as the page's
    full-width foot, rendered once (it moved out of the holdings surface).
    Launch copy audit filer-06 / filer-11: the PLANNED line (a roadmap) and the
    "Notes on this data" cards (generic restatements of the caveats the
    provenance line and the §5 box already carry) are gone. */
export function filerFootHtml(cik: string, filerName: string): string {
  return filerEdgarBlock(cik, filerName) + `<div class="filer-data-note">${institutionalDataNoteHtml()}</div>`;
}

export interface FilerPeriodOpts {
  /** the quarters the period segments offer (the changes band head) */
  periods?: string[];
  total?: number;
  page?: number;
  benchmark?: ConcentrationBenchmark | null;
  discontinuity?: boolean;
  /** R15: kind counts over the WHOLE period's changes */
  kinds?: { new: number; exit: number } | null;
  /** D5: the Position changes kind filter (null = all kinds) */
  kind?: ChangesKindFilter | null;
}

export function filerEdgarBlock(cik: string, filerName: string): string {
  return (
    `<details class="edgar-block design-supplement" aria-label="Full holdings on EDGAR"><summary>Complete source filings on SEC EDGAR</summary>` +
    /* Launch copy audit filer-11: the receipt link stays and the record is
       named as the record; the internal decision log (the 2026-08-01 serving
       decision, docs/architecture/decisions/holdings-publication.md) left the
       reader copy. The completeness claim lives on the list, whose terminus
       states any cap, so this block makes none. */
    `<p>The filing on EDGAR is the record, including any filed after this build.</p>` +
    `<a class="cta" href="${esc(edgarFilerUrl(cik))}" rel="noopener" target="_blank">Open ${esc(
      filerName,
    )}'s 13F filings on SEC EDGAR ↗</a>` +
    `</details>`
  );
}

/** The whole filer body, in DOM order = visual order (M2, F; A-9): head and
    ledger, provenance, Position changes, band F1, the foot. The pre-rendered
    page emits the same parts itself (it places `<HoldingsTable>` in band F1);
    the /e/ driver calls this with the holdings surface it rendered. */
export function filerBody(
  filer: { cik: string; name: string; latestPeriod: string },
  periods: string[],
  period: string,
  conc: ConcentrationRow | null,
  deltas: QoqDeltaRow[],
  latestFiled: string | null,
  topn: number,
  window: FilingWindow | null,
  opts: FilerPeriodOpts & { typing?: ManagerTyping | null; holdingsHtml?: string } = {},
): string {
  const typing = opts.typing ?? null;
  const total = opts.total ?? deltas.length;
  return (
    filerHeadHtml(filer, conc, typing, window, filerLedgerHtml(conc, period, total, opts.kinds ?? null)) +
    filerChangesHtml(periods, period, conc, deltas, latestFiled, topn, opts) +
    filerBandHtml(
      opts.holdingsHtml ?? "",
      filerBookShapeHtml(conc, topn, period, total, opts.benchmark ?? null),
      filerHistoryHtml(filer.cik, periods),
    ) +
    filerFootHtml(filer.cik, filer.name)
  );
}

/* ---------- the cluster board (Institutional.dc.html, left of activity) ---------- */

function clusterRowHtml(r: ClusterRow, max: number): string {
  const total = Math.max(1, r.adders + r.cutters);
  const aw = (r.adders / total) * 100;
  const cw = (r.cutters / total) * 100;
  const delta =
    r.netDeltaUsd == null
      ? `<span class="none">—</span>`
      : `<span class="${r.netDeltaUsd >= 0 ? "c-buy" : "c-sell"}">${r.netDeltaUsd >= 0 ? "+" : "−"}${fmtUsd(Math.abs(r.netDeltaUsd))}</span>${r.netDeltaPartial ? hangMark("≈") : ""}`;
  return (
    `<tr class="design-cluster-row">` +
    `<td class="c-issuer c-flex"><span class="filed-name">${esc(r.issuerName)}</span></td>` +
    `<td class="c-bar"><span class="design-diverging design-cluster-bar" aria-hidden="true"><span style="width:${aw.toFixed(1)}%"></span><span class="sale" style="width:${cw.toFixed(1)}%"></span></span>` +
    `<span class="visually-hidden">${fmtInt(r.adders)} filers added, ${fmtInt(r.cutters)} trimmed or exited</span></td>` +
    `<td class="c-num">${fmtInt(r.filers)}</td>` +
    `<td class="c-num c-buy">${fmtInt(r.newPositions)}</td>` +
    `<td class="c-num has-marks">${delta}</td>` +
    `<td class="c-num c-muted"><span class="visually-hidden">share of the board's largest count </span>${Math.round((r.newPositions / Math.max(1, max)) * 100)}%</td>` +
    `</tr>`
  );
}

/** The cluster board: issuers that at least `minFilers` tracked filers changed
    in the same closed quarter, ranked by filers opening a NEW position. Named
    from the serving artifact, never from the aggregate's opaque keys. */
export function clusterBoardHtml(result: ClusterBoardResult, period: string | null): string {
  const columns = ["Issuer", "Add ◂ ▸ Trim", "Filers", "New", "Net $Δ", "vs top"];
  if (!result.present) {
    const reason: Record<typeof result.reason, string> = {
      "module-absent": "This build does not include the institutional module.",
      "serving-artifact-unlocatable": "No serving artifact is addressable in this environment, so no cross-filer grouping can be published.",
      "serving-artifact-missing": "This build declares the institutional module, but its serving artifact is not present here.",
      "activity-grain-unavailable": "The serving artifact could not supply the activity projection this board groups over.",
      "no-rows-for-period": period
        ? `No issuer was changed by three or more filers in ${period} — or the activity grain carries no rows for that quarter. Absence is stated, never simulated.`
        : "No closed quarter is available to group over yet.",
    };
    return unavailableDesignPanel("Cluster board", period ? `≥3 filers changed the same name · ${period}` : "≥3 filers changed the same name", columns, reason[result.reason], "design-clusters");
  }
  const b = result.board;
  const max = Math.max(1, ...b.rows.map((r) => r.newPositions));
  return (
    `<section class="panel design-clusters" aria-label="Cluster board">` +
    `<div class="panel-head"><h2 class="section-h">Cluster board</h2>` +
    `<span class="panel-note">≥${fmtInt(b.minFilers)} FILERS CHANGED THE SAME NAME · ${esc(b.period)} · RANKED BY NEW POSITIONS</span></div>` +
    `<div class="table-scroll"><table class="etable etable-compact"><caption class="visually-hidden">Issuers changed by ${fmtInt(b.minFilers)} or more filers in ${esc(b.period)}</caption>` +
    `<thead><tr>${columns.map((c, i) => thHtml({ label: c, mark: i === 4 ? "≈" : null, cls: i === 0 ? "c-issuer c-flex" : i === 1 ? "c-bar" : "c-num" })).join("")}</tr></thead>` +
    `<tbody>${b.rows.map((r) => clusterRowHtml(r, max)).join("\n")}</tbody></table></div>` +
    `<p class="section-note">${esc(rangeOfTotal(1, b.rows.length, b.qualifying, "qualifying issuers"))} rendered — a render bound, not a data bound · ` +
    `bars = filers adding vs trimming or exiting · NEW = filers with no position last quarter · ` +
    `${fnMark("≈")} = a contributing row disclosed no value, so the sum is partial` +
    (b.unkeyedRows > 0 ? ` · ${fmtInt(b.unkeyedRows)} change rows carry no issuer identity and are outside this board` : "") +
    ` · EXIT is inferred from absence, not a sale record.</p>` +
    `</section>`
  );
}

/* ---------- new-position leaders (the owner's reference label, signals-v4 LD20) ----------
   Their panel renders on /signals/#institutional (`ui/signals-institutional.ts`
   `convictionLeadersHtml`); the rule and count sentences stay here, beside
   the analytics they state. */

/** R26: the eligibility rule, in words — stated in the band note and in its
    computed-zero line alike. */
export function convictionRuleText(l: Pick<NewPositionLeaders, "thresholdBps" | "minBookPositions">): string {
  return (
    `Ranked: notable managers whose complete 13F long book has at least ${fmtInt(l.minBookPositions)} positions, every one with a value, ` +
    `by their largest new position's share of that book (${(l.thresholdBps / 100).toFixed(0)}% or more)`
  );
}

/** R26: the evaluated and qualifying counts and each exclusion by reason. */
export function convictionCountsText(l: NewPositionLeaders): string {
  const e = l.excluded;
  const plural = (n: number, one: string, many: string): string => `${fmtInt(n)} ${n === 1 ? one : many}`;
  return (
    `${plural(l.evaluated, "filer", "filers")} opened positions in ${l.period}; ${fmtInt(l.qualifying)} ${l.qualifying === 1 ? "qualifies" : "qualify"}. ` +
    `Excluded: ${fmtInt(e.notNotable)} not notable · ${fmtInt(e.smallBook)} book under ${fmtInt(l.minBookPositions)} positions · ` +
    `${fmtInt(e.missingValue)} a position without a value · ${fmtInt(e.belowThreshold)} no new position at ${(l.thresholdBps / 100).toFixed(0)}% or more`
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
  /* Ledger roles (DESIGN-POLISH M1, R2): the issuer takes the slack, the top
     adder is secondary text, every count and value is numeric. */
  const role = (c: CongressColumn): string =>
    c.key === ("issuer" as never) ? "c-issuer c-flex" : c.key === ("adder" as never) ? "c-filer c-secondary" : c.numeric ? "c-num" : "";
  return cols
    .map((c) => {
      if (!c.sortable) {
        return thHtml({
          label: c.label,
          cls: role(c),
          noteHtml: c.why ? esc(c.why) : null,
          notes,
          noteKey: String(c.key ?? c.label),
        });
      }
      // Same rule as the ranking head — Issuer, Δ value and Top adder are
      // sortable AND carry a mark, so the mark is the note's trigger.
      return thHtml({
        label: c.label,
        cls: role(c),
        noteHtml: c.note ?? null,
        notes,
        noteKey: String(c.key),
        sort: {
          attr: "data-adds-sort",
          key: String(c.key),
          state: c.key === active ? (dir === "desc" ? "descending" : "ascending") : "none",
          extra: ` data-adds-dir="${c.defaultDir}"`,
        },
      });
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
    /* Launch M7b (copy item inst-09): the ~100-word intro becomes its one
       load-bearing clause — closed quarters only, because an open quarter
       undercounts. */
    `<p class="section-note">Closed quarters only — an open quarter undercounts.` +
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
      /* a truncated payload's total is the leaderboard's bound, not the
         quarter's count of issuers (review R-4); the island restates it from
         the same function for every quarter it loads */
      ...addsBoundNoun(payload.truncated),
      bound: addsBoundHtml(addsPayloadHref(opts.period, opts.mode)),
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
    /* Launch M7b (R32, LD28): the bounded rows no longer travel inside the
       page (≈510 KB on /institutional/). The client fetches this quarter's
       published payload — the file the bound above links — the first time
       the drawer opens, so the compact slice is never a one-way door with
       scripting on, and the link is the route without it. */
    `</section>`
  );
}

/* ---------- A-4: homepage "notable this week" rail ---------- */

export function notableRailHtml(res: NotableRecentResult, ctx: RenderCtx): string {
  if (res.rows.length === 0 && res.unrankable === 0) return "";
  const rows = res.rows
    .map((r) => {
      const side = sideLabel(r.side, r.flags);
      const owner = ownerQualifiersHtml(r);
      const who = r.bioguide
        ? `<a href="${memberHrefFor(r.bioguide, ctx)}">${esc(r.name)}</a>`
        : esc(r.name);
      /* K-3 (M3 review): a no-ticker asset is a label trigger whose note
         gives it as filed */
      const what = r.ticker
        ? `<a class="mono-ticker" href="${tickerHrefFor(r.ticker, ctx)}">${esc(r.ticker)}</a>`
        : assetNameCell(r, { scope: "rail-asset" });
      return (
        `<div class="rail-row" role="listitem">` +
        `<span class="rail-who">${who} <span class="aff ${partyClass(r.party)}">${esc(affTextOf(r))}</span></span>` +
        `<span class="rail-what">${what}</span>` +
        `<span class="rail-side ${side.cls}">${esc(side.text)}${owner ? ` ${owner}` : ""}</span>` +
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

/* ---------- launch M7b (R33, LD26, LD30): holders held past the first 25 ----------

   A holders list opens at its first 25 rows; rows 26..N are NOT in the DOM.
   They travel ONCE in the site's one held-rows island (`heldIslandHtml`,
   lib/held-rows.ts), which the one binder (scripts/inst-index-client.ts:
   `registerHeldRows`, then `initDomDisclosures`) draws in steps of 25 through
   the SAME row function the server uses — registered by name — with a local
   search over those rows. Readers without JavaScript keep every holder: a
   `<noscript>` inside the "Show all N holders" disclosure holds a SECOND
   table of rows 26..N, never inside a `tbody` (the parser would hoist it
   out). With scripting on, that copy is inert raw text with no DOM cost.
   `beforeprint` draws every held row, so paper still lists every holder. */

/** Holders a list shows before its "Show all N holders" disclosure. */
export const HOLDERS_VISIBLE = 25;
/** Rows one "Show 25 more" press adds. */
export const HOLDERS_STEP = 25;

/** The list-wide inputs a held list's island carries in `shared`: the row
    function's own (`ctx`) and the stepped view's — rows per step, the whole
    collection's size N and its noun. The island's `offset` is the 25 shown. */
export interface HeldListShared<C = unknown> {
  ctx: C;
  step: number;
  total: number;
  noun: string;
}

export interface HeldHoldersOpts<R> {
  /** id of the held tbody the binder fills (also keys every control) */
  rootId: string;
  /** the registered renderer name the page script binds */
  render: string;
  /** every holder, in rank order; rows past `HOLDERS_VISIBLE` are held */
  rows: readonly R[];
  rowHtml: (r: R) => string;
  ctx: unknown;
  /** the table around a body: `(bodyHtml, caption, tbodyId)` — called for
      the no-JS copy and the held table, never as the primary table, so a
      header note the primary table carries is not emitted twice */
  table: (bodyHtml: string, caption: string, tbodyId: string | null) => string;
  caption: string;
  /** the whole collection's size N (the summary's count) */
  total?: number;
}

/** The held part of a holders list: the disclosure, its no-JS second table,
    the empty table the binder fills, the step control, the search, and the
    island. "" when nothing is held. */
export function heldHoldersHtml<R>(o: HeldHoldersOpts<R>): string {
  const held = o.rows.slice(HOLDERS_VISIBLE);
  if (held.length === 0) return "";
  const total = o.total ?? o.rows.length;
  const first = HOLDERS_VISIBLE + 1;
  return (
    `<details class="tk-holders-more" data-held-more="${esc(o.rootId)}">` +
    `<summary>Show all ${fmtInt(total)} holders</summary>` +
    `<div class="held-tools" data-held-tools="${esc(o.rootId)}" hidden>` +
    `<input class="filter-select filter-text" type="search" data-held-search="${esc(o.rootId)}" placeholder="filer name" ` +
    `aria-label="filter holders ${fmtInt(first)} to ${fmtInt(total)} by filer name — on this device" /></div>` +
    `<noscript>${o.table(held.map((r) => o.rowHtml(r)).join("\n"), `${o.caption}, ${rangeOfTotal(first, total, total, "holders")}`, null)}</noscript>` +
    `<div class="held-wrap" data-held-wrap="${esc(o.rootId)}" hidden>${o.table("", `${o.caption}, holders ${fmtInt(first)} to ${fmtInt(total)}`, o.rootId)}</div>` +
    `<p class="held-count" data-held-count="${esc(o.rootId)}" role="status" aria-live="polite" hidden></p>` +
    `<button class="linklike compact-toggle" type="button" data-held-step="${esc(o.rootId)}" aria-controls="${esc(o.rootId)}" hidden></button>` +
    `</details>` +
    heldIslandHtml<R, HeldListShared>({ rootId: o.rootId, render: o.render, offset: HOLDERS_VISIBLE, shared: { ctx: o.ctx, step: HOLDERS_STEP, total, noun: "holders" }, rows: held })
  );
}

/** One holders-page row's inputs (mapped path) — exactly what
    `holdersPageRowHtml` reads, so the island carries nothing else. */
export interface HoldersPageRow {
  rank: number;
  cik: string;
  name: string;
  value: number | null;
  shares: number | null;
  delta: number | null;
  kind: QoqDeltaRow["change_kind"];
  tier: FilerBudgetState;
}

/** One row of the holders page's ranked table (server, no-JS copy and the
    binder alike). Explicit table roles (R40) ride every row and cell. */
export function holdersPageRowHtml(h: HoldersPageRow): string {
  const deltaCls = h.delta == null ? "c-muted" : h.delta < 0 ? "c-sell" : h.delta > 0 ? "c-buy" : "";
  return (
    `<tr role="row"${changeEdgeAttr(h.kind)}><td role="cell" class="c-rank c-num">${fmtInt(h.rank)}</td>` +
    `<td role="cell" class="c-filer c-flex">${filerLinkHtml(h.cik, h.name, h.tier)}</td>` +
    `<td role="cell" class="c-num">${h.value == null ? "—" : esc(fmtUsd(h.value))}</td>` +
    `<td role="cell" class="c-num">${h.shares == null ? "—" : fmtInt(h.shares)}</td>` +
    `<td role="cell" class="c-num ${deltaCls}">${h.delta == null ? "—" : `${h.delta < 0 ? "−" : h.delta > 0 ? "+" : ""}${fmtInt(Math.abs(h.delta))}`}</td>` +
    `<td role="cell" class="c-chip c-kind">${kindWordHtml(h.kind)}</td></tr>`
  );
}

/** The holders page's held-rows renderer and its search text, registered by
    the page script (`registerHeldRows("holders-page", row, { text })`). */
export const HOLDERS_PAGE_HELD = {
  render: "holders-page",
  row: (r: unknown, _index: number, _shared: unknown): string => holdersPageRowHtml(r as HoldersPageRow),
  text: (r: unknown): string => (r as HoldersPageRow).name,
};

/** A present-day 13F class code a reader can say in words (copy item
    holders-01: "CMN" is a code, not reader copy). Anything else is shown
    exactly as filed. */
const CLASS_WORDS: Record<string, string> = { CMN: "common stock", COM: "common stock", COMMON: "common stock", "COMMON STOCK": "common stock" };

/* ---------- R20: the holders page for a REVIEWED (Tier C) ticker ---------- */

export interface TickerHoldersPageInputs {
  ticker: string;
  totals: TickerTotalsRow;
  holders: readonly TickerHolderRow[];
  tierOf: (cik: string) => FilerBudgetState;
  latestFiled: string | null;
  /** the rendered R19 overlap band */
  overlapHtml: string;
  /** members who disclosed this ticker (Congress page link), or null when no Congress page exists */
  congress: { members: number; href: string } | null;
  window: FilingWindow | null;
}

/** Identity → 4 stats (holders · combined value · adds · exits) → holders
    ranked by value with Δ shares and kind → the overlap band → the Congress
    link. Everything from the class-grain `agg_ticker_holders` family; the
    ticker's ⓘ names the mapping's verification. */
export function tickerHoldersBody(i: TickerHoldersPageInputs): string {
  const t = i.totals;
  const verified = i.holders[0]?.verified_date ?? "";
  /* DESIGN-POLISH M2 (R15): the page header's figures through the ONE ledger;
     each tile's breakdown is its figure's note, opened from the label. */
  const ledger = disclosureLedger(
    [
      { label: "Holders", value: fmtInt(t.holder_count), detail: "", noteHtml: esc(`13F filers reporting this class for the quarter ended ${t.period_of_report}${i.holders.length < t.holder_count ? `; ${rangeOfTotal(1, i.holders.length, t.holder_count, "holders")} are listed, largest first` : ""}`) },
      { label: "Combined value", value: fmtUsd(t.value_usd), detail: "", noteHtml: esc("sum of the reported values across every holder; NULL values are excluded, never zero-filled") },
      { label: "Adds", value: fmtInt(t.adds), detail: "", noteHtml: esc("holders whose share count rose or who opened the position (new + add), by shares") },
      { label: "Exits", value: fmtInt(t.exits), detail: "", noteHtml: esc("holders absent this quarter after holding last quarter — inferred from absence, not a sale record") },
    ],
    { scope: "holders-tiles", label: "Holder statistics" },
  );
  /* Launch M7b (R33): the first 25 holders render; 26..N are held (island +
     no-JS second table) through `heldHoldersHtml`, every row through the one
     `holdersPageRowHtml`. */
  const list: HoldersPageRow[] = i.holders.map((h) => ({
    rank: h.rank,
    cik: h.cik,
    name: h.filer_name,
    value: h.value_usd,
    shares: h.shares,
    delta: h.delta_shares,
    kind: h.change_kind,
    tier: i.tierOf(h.cik),
  }));
  const caption = `13F holders of ${i.ticker} ranked by reported value`;
  const paged = list.length > HOLDERS_VISIBLE;
  const table = (bodyHtml: string, cap: string, tbodyId: string | null): string =>
    `<div class="table-scroll"><table class="etable" role="table" data-card="holders" data-sticky-first${paged ? ' data-paged="1"' : ""}><caption class="visually-hidden">${esc(cap)}</caption>` +
    `<thead role="rowgroup"><tr role="row">` +
    thHtml({ label: "#", cls: "c-num" }) +
    thHtml({ label: "Filer", cls: "c-filer c-flex" }) +
    thHtml({ label: "Reported value", cls: "c-num" }) +
    thHtml({ label: "Shares", cls: "c-num" }) +
    thHtml({ label: "Δ shares", cls: "c-num" }) +
    thHtml({ label: "Change", cls: "c-chip c-kind" }) +
    `</tr></thead>` +
    `<tbody role="rowgroup"${tbodyId ? ` id="${esc(tbodyId)}"` : ""}>${bodyHtml}</tbody></table></div>`;
  const classText = CLASS_WORDS[t.title_of_class.trim().toUpperCase()];
  return (
    breadcrumb([
      { text: "/institutional", href: "/institutional/" },
      { text: "tickers" },
      { text: i.ticker },
      { text: "holders" },
    ]) +
    `<header class="entity-head"><div class="entity-head-copy">` +
    `<h1 class="entity-title">Who holds ` +
    noteFromHtml(`ticker verified against the SEC company list${verified ? ` on ${esc(verified)}` : ""} — a reviewed name-and-class mapping row, never an inferred symbol. <a href="/methodology/#ticker-mapping">how tickers are mapped ↗</a>`, { scope: "holders-ticker" }, "verified", { trigger: "label", textHtml: `<span class="mono-ticker">${esc(i.ticker)}</span>`, name: i.ticker }) +
    `</h1>` +
    /* holders-01: the class code reads as words where it is a known code
       (the code as filed stays in the accessible name), the quarter as its
       label */
    `<div class="entity-subline"><span class="filed-name">${esc(t.issuer_name)}</span> · ` +
    (classText
      ? `${esc(classText)}<span class="visually-hidden"> (filed as ${esc(t.title_of_class)})</span>`
      : `<span class="filed-name">${esc(t.title_of_class)}</span>`) +
    ` · <span class="mono-id">${esc(quarterLabel(t.period_of_report) ?? `quarter ended ${t.period_of_report}`)}</span>` +
    (i.congress ? ` · <a href="${esc(i.congress.href)}">${fmtInt(i.congress.members)} ${i.congress.members === 1 ? "member" : "members"} disclosed ${esc(i.ticker)} ↗</a>` : "") +
    `</div></div>` +
    ledger +
    `</header>` +
    (i.window?.open ? s7Banner(i.window) : "") +
    `<section class="panel panel-wide" id="ticker-holders" aria-label="Holders ranked by value">` +
    `<div class="panel-head"><h2 class="section-h">Holders — quarter ended ${esc(t.period_of_report)}</h2>` +
    `<span class="panel-note">ranked by reported value · Δ shares vs ${esc(t.prev_period ?? "the prior quarter")} · kind by shares</span></div>` +
    table(list.slice(0, HOLDERS_VISIBLE).map(holdersPageRowHtml).join("\n"), paged ? `${caption}, ${rangeOfTotal(1, HOLDERS_VISIBLE, list.length, "holders")}` : caption, "ticker-holders-rows") +
    heldHoldersHtml({ rootId: "ticker-holders-held", render: HOLDERS_PAGE_HELD.render, rows: list, rowHtml: holdersPageRowHtml, ctx: null, table, caption }) +
    cardFoot({ short: `Quarter ended ${t.period_of_report}`, full: instFiledNote(i.latestFiled), scope: "ticker-holders-foot", key: "stamp" }) +
    `</section>` +
    i.overlapHtml +
    /* holders-01: the bottom line repeated the subline's Congress link */
    /* CD-3 (DESIGN-POLISH M3, carried): the reviewed-mapping holders path is
       an institutional surface like every other, so the §5 data note ships
       with its body by construction — the entity path gets it from
       HoldingsTable; this path rendered none. */
    institutionalDataNoteHtml()
  );
}
