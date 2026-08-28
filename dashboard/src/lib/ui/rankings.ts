/* Pure page/section renderers. Every entity body is a string function called
   by the thin .astro page for SSR AND by the generic-route client driver —
   parity is by construction (one function, two callers). No Node APIs, no DOM.

   Honesty grammar: G1–G7 via the canonical format.ts components; charts
   zero-based, gaps stay gaps, no midpoints; NULL-honest institutional
   integers; the as-of time stamp every 13F table carries. */

/* ================================================================================
   C-4 — Congress rankings (ALPHA-UX): /congress gains Feed · Leaders · Tickers.
   Metric definitions are the C-4 contract in derive.ts (six-state net algebra,
   total display key, structural undisclosed bucket, strict-sign direction).
   ============================================================================ */

/** The /congress surface tabs. Feed is the existing index; Leaders and
    Tickers are build-time ranking tables. */
/* `congressTabs` is DELETED. The sub-tab nav is the navigation the single
   /congress/ page exists to remove — comparing the three views was the thing
   that required leaving the page. Its two retired routes are static stubs,
   and its CSS is removed with it rather than left as a dead selector. */

import {
  type TxnRow,
  type RenderCtx,
  type NoteCtx,
  esc,
  fmtInt,
  note,
  noteFromHtml,
  colWhyHtml,
  memberHrefFor,
  tickerHrefFor,
  partyClass,
  compactDisclosure,
  COMPACT_ROWS,
} from "../format.ts";
import {
  type CongressBasis,
  type CongressRange,
  type CongressRollup,
  type LeaderRow,
  congressRangeBounds,
  congressTickersRollup,
  leadersRollup,
  windowStatement,
  rankNetRows,
  affTextOf,
} from "../derive.ts";
import {
  congressRankingColumns,
  overlapFlags,
  sortRankingRows,
  type CongressColumn,
  type CongressSortKey,
} from "../congress-columns.ts";
import { type BuildStamps, netCellHtml } from "./shared.ts";
import { flowCellHtml } from "./congress.ts";

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

/* ---------- the congress ranking sections ---------------------------------

   ONE renderer serves BOTH ranking sections: the ticker momentum section that
   leads /congress/ and the member net-flow section that closes it. They order
   the same `LeaderRow` shape through the same contract, so a second renderer
   would be two copies of one set of honesty rules.

   RENDER ROOTS ARE EXPLICIT AND SINGLY OWNED. Each `tbody` carries an id,
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
  /** What the SAME corpus holds on the other basis and at the next
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
      /* A SORTABLE column can carry a note too — the ranking footnotes
         qualified Txns, Late and the three flow columns, all of which sort. The
         key is `c.key`, non-null on this branch by the type. The note
         button's click is kept out of the sort handler. */
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
    the SSR/client parity test compares, and it is why no second row renderer exists. */
export function rankingRowsHtml(
  rows: readonly LeaderRow[],
  kind: "leaders" | "tickers",
  ctx: RenderCtx,
  opts: { numbered?: boolean; startAt?: number } = {},
): string {
  // The incomparability marker is recomputed from THIS order. Carrying a
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
      // The separator states that rows exist which this column CANNOT
      // rank. That is a stated absence, so it renders whenever the bucket is
      // non-empty — NOT only when a bucket row happens to survive the compact
      // slice. Ten ranked rows followed by unrankable ones used to hide the
      // fact that the unrankable ones existed at all, which is exactly the
      // omission the stated-absence rule forbids.
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

/** The range and basis control. Both are segmented buttons, matching the
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
/* The clauses and their SUMMED ROW TOTAL are produced by ONE
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

/** The SUMMED excluded-row magnitude — never a count of categories.
    Review objected that "· 3 exclusions" surfaces the number of
    CATEGORIES while burying the number of ROWS, which is the honesty-bearing
    figure. The owner accepted it. This is that figure. */
export function rankingExcludedRows(
  rollup: CongressRollup & { noTickerRows?: number },
  kind: "leaders" | "tickers",
): number {
  return exclusionParts(rollup, kind).reduce((sum, p) => sum + p.n, 0);
}

/** The window statement AND its excluded-row suffix AND the note
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


/* ---------------------------------------------------- the empty window -- */

/** The ordered range vocabulary, single-sourced from the control that offers
    it — so "the next wider range" cannot disagree with what is clickable. */
export const CONGRESS_RANGES: readonly CongressRange[] = ["7d", "30d", "90d", "12m"];

export interface RankingAlternatives {
  /** rankable rows this window holds on the OTHER date basis */
  otherBasis: number;
  /** the next wider range and what it holds, or null at the widest */
  wider: { range: CongressRange; n: number } | null;
}

/** Both alternatives are computed from the rows in hand, by the SAME
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
  /* Count the rows that can actually ENTER the ranked table,
     not every row in the rollup. `rankNetRows` moves a wholly-undisclosed row
     into its own bucket with its own root, unreachable by any sort of the
     ranked table — so a rollup of one undisclosed row has `rows.length === 1`
     and `ranked.length === 0`. Counting the former made the empty-window block
     offer "1 by filing date", and activating that control produced another
     empty ranked table. Forbidden exactly because an offer that resolves to
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

/** `7d` stays offered: an empty window is a true and interesting
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

  // The wholly-undisclosed bucket is fixed by the NET interval and
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
    /* The pending indicator. NOT a queue — `range` and `basis` are
       module state and `receiveRows` already reapplies them, so a pre-arrival
       click has always been applied. The defect is that `setSeg` paints the
       button pressed at click time, so between the click and the dataset's
       arrival the control asserts a window the table has not painted. This
       node lets it say so instead. It ships in the SSR bytes and starts hidden
       because a client cannot reveal an element that was never rendered. */
    (opts.controls
      ? `<p class="section-note pending-note" id="${esc(opts.sectionId)}-pending" role="status" aria-live="polite" hidden></p>`
      : "") +
    /* The three prose claims this paragraph carried are now notes on the
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
    /* A zero-rankable window STATES itself. The container ships
       in both states so the client can fill it when a range change empties the
       window — an element that was never rendered cannot be filled in later,
       which is the render-the-shell lesson applied to this block. */
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
    /* The bound and its control are ONE element now. The count clause
       this used to state from a separate `terminusRow` above is emitted by
       `compactDisclosure` itself, VISIBLE from the server — which is what the
       terminus was really for, since the control ships `hidden` and nothing
       reveals it here until the 22 MB feed lands. The link to the
       published dataset travels as the state-independent remainder: it is true
       whether the table is collapsed or expanded, so expanding retracts the
       count and leaves the link standing. */
    compactDisclosure({
      rootId: opts.rootId,
      total: main.total,
      shown: main.shown,
      noun,
      boundNoun: `ranked ${noun}`,
      bound: `Every row remains in the <a href="/congress/data/feed.v1.json">published dataset</a>.`,
    }) +
    (undisclosedBucket.length > 0 && opts.undisclosedRootId
      ? `<div class="unrankable-block"><h3 class="section-h">Not rankable — amounts wholly undisclosed</h3>` +
        `<p class="section-note">These rows include at least one side whose every amount failed to parse. ` +
        `They have no endpoints, so they hold no position in the ranking — listed after it, never sorted ` +
        `to the bottom as if small, and never merged into it by any sort.</p>` +
        `<div class="table-scroll"><table class="etable">` +
        `<caption class="visually-hidden">Unrankable ${esc(noun)} — amounts wholly undisclosed</caption>` +
        `<thead><tr>${rankingHeadHtml(cols, "name", "asc", { scope: `undisc-${opts.sectionId}` })}</tr></thead>` +
        `<tbody id="${esc(opts.undisclosedRootId)}">${bucket.html}</tbody></table></div>` +
        /* The one terminus of the five that was NOTHING but its count,
           so it is deleted outright rather than relocated — the control's own
           server-visible count clause is the same sentence. */
        compactDisclosure({
          rootId: opts.undisclosedRootId,
          total: bucket.total,
          shown: bucket.shown,
          noun,
          boundNoun: `wholly-undisclosed ${noun}`,
        }) +
        `</div>`
      : "") +
    /* The visible `.caveat-line` and its `#<sectionId>-caveat` root are
       DELETED. Unlike the terminus rows, nothing is lost to a reader with
       scripting off: the clauses moved into a note, which opens declaratively
       through `popovertarget` with no JavaScript at all, and their SUMMED ROW
       TOTAL stays visible on the window statement at every width (LD4). */
    `</section>`
  );
}
