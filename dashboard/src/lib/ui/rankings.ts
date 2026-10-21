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
  fmtUsd,
  note,
  noteFromHtml,
  memberHrefFor,
  tickerHrefFor,
  partyClass,
  compactDisclosure,
  COMPACT_ROWS,
  COMPACT_STEP,
  hangMark,
  thHtml,
  DATE_ANOMALY_NOTE,
} from "../format.ts";
import {
  type NetInterval,
  netIntervalText,
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
  medianLag,
  sumRangesText,
  type SumRanges,
} from "../derive.ts";
import {
  congressRankingColumns,
  overlapFlags,
  sortRankingRows,
  type CongressColumn,
  type CongressSortKey,
} from "../congress-columns.ts";
import { type BuildStamps, type LedgerItem, netCellHtml } from "./shared.ts";
import { flowCellHtml } from "./congress.ts";

/** The reference displays a provable bound, never a fabricated point estimate. */
function referenceNetHtml(net: NetInterval, overlaps: boolean): string {
  const parts = referenceNetParts(net);
  if (parts === null) return netCellHtml(net, overlaps);
  return parts + (overlaps ? hangMark("≈") : "");
}

/** The board's visible bound ("≥ $X" / "≤ −$X", the full interval kept for
    assistive technology), or null when the interval is not one-signed. */
function referenceNetParts(net: NetInterval): string | null {
  // Rounding away from zero would overstate a guaranteed bound. Truncate at
  // the display formatter's precision, preserving a conservative guarantee.
  const boundText = (value: number): string => {
    const magnitude = Math.abs(value);
    const unit = [1e12, 1e9, 1e6, 1e3].find(unit => magnitude >= unit) ?? 1;
    const step = unit === 1 ? 1 : unit * (magnitude / unit >= 100 ? 1 : 0.1);
    return fmtUsd(Math.trunc(value / step) * step);
  };
  let bound: string | null = null;
  if ((net.kind === "finite" || net.kind === "upper-open") && net.low > 0) bound = `≥ ${boundText(net.low)}`;
  else if ((net.kind === "finite" || net.kind === "lower-open") && net.high < 0) bound = `≤ ${boundText(net.high)}`;
  if (bound === null) return null;
  return `<span class="reference-net-bound ${bound.startsWith("≥") ? "positive" : "negative"}" aria-hidden="true">${esc(bound)}</span><span class="visually-hidden">${esc(netIntervalText(net))}</span>`;
}

/** A gross side for the board's Net note: the summed range, "none" when the
    side has no rows, "not disclosed" when every amount failed to parse. */
function grossText(s: SumRanges): string {
  return s.kind === "empty" ? "none" : sumRangesText(s);
}

/** Launch M3b (LD19): the members board's Net cell. The gross purchase and sale
    ranges left the board as columns; they are this cell's note, opened from the
    visible net (a label trigger), so every row still states both sides. The ≈
    stays outside the trigger, hung in the cell's mark slot. */
function boardNetCellHtml(r: LeaderRow, overlaps: boolean): string {
  const visible = referenceNetParts(r.net) ?? esc(netIntervalText(r.net));
  const body =
    `Purchases ${esc(grossText(r.purchases))} · sales ${esc(grossText(r.sales))} · ` +
    `net ${esc(netIntervalText(r.net))}, summed from the ranges as filed — no midpoints.`;
  return (
    noteFromHtml(body, { scope: "board-net" }, r.id, {
      trigger: "label",
      textHtml: visible,
      name: `Net ${netIntervalText(r.net)}`,
    }) + (overlaps ? hangMark("≈") : "")
  );
}

/** The ledger ROLE classes of one ranking column, header and cells alike
    (DESIGN-POLISH M1, R1/R2): numbers right-aligned; the identity column (the
    member name, or the ticker's bar in the ticker ranking, which has no name)
    takes the table's slack; a sortable or marked number reserves the mark slot. */
export function rankingColumnClass(c: CongressColumn, kind: "leaders" | "tickers", cols: readonly CongressColumn[] = []): string {
  if (c.numeric) return c.sortable || c.mark ? "c-num has-marks" : "c-num";
  // One flexible column per table (D-1): the bar when the table has one, else
  // the name — a ticker table without its bar gives the slack to the ticker.
  const hasBar = cols.some((o) => !o.numeric && o.key !== "name");
  if (c.key === "name") return kind === "tickers" ? (hasBar ? "c-ticker" : "c-ticker c-flex") : "c-member c-flex";
  return "c-bar c-flex";
}

function rankingRowHtml(
  r: LeaderRow,
  pos: number | null,
  overlapsPrev: boolean,
  kind: "leaders" | "tickers",
  ctx: RenderCtx,
): string {
  const cols = visualColumns(kind, ctx.referenceRankings);
  /* R40 (launch M1 contract, emitted here by M3): every cell carries its
     explicit role at every width, beside its ledger role class. */
  const cls = (i: number, extra = ""): string =>
    ` class="${[rankingColumnClass(cols[i]!, kind, cols), extra].filter(Boolean).join(" ")}" role="cell"`;
  const who =
    kind === "tickers"
      ? `<a href="${tickerHrefFor(r.id, ctx)}">${esc(r.id)}</a>`
      : r.bioguide
        ? `<a href="${memberHrefFor(r.bioguide, ctx)}">${esc(r.name)}</a> <span class="aff ${partyClass(r.party)}">${esc(
            affTextOf(r),
          )}</span>`
        : `<span class="unjoined-name">${esc(r.name)}</span> <span class="aff ${partyClass(r.party)}">${esc(affTextOf(r))}</span>`;
  if (kind === "tickers" && ctx.referenceRankings) {
    const scale = Math.max(r.buys, r.sells, 1);
    return `<tr role="row"><td${cls(0, "c-muted")}>${pos ?? ""}</td><td${cls(1)}>${who}</td>` +
      `<td${cls(2)}><span class="design-diverging" aria-hidden="true"><span style="right:50%;width:${r.buys / scale * 50}%"></span><span class="sale" style="left:50%;width:${r.sells / scale * 50}%"></span></span><span class="visually-hidden">${fmtInt(r.buys)} buys; ${fmtInt(r.sells)} sells</span></td>` +
      `<td${cls(3)}>${fmtInt(r.txns)}</td><td${cls(4)}>${r.memberCount == null ? "—" : fmtInt(r.memberCount)}</td>` +
      `<td${cls(5, "c-net")}>${ctx.referenceRankings ? referenceNetHtml(r.net, overlapsPrev) : netCellHtml(r.net, overlapsPrev)}</td></tr>`;
  }
  const lateCell =
    r.lateDenom === 0
      ? `<span class="none">—</span>`
      : `${fmtInt(r.late)} of ${fmtInt(r.lateDenom)}`;
  if (ctx.referenceRankings) {
    /* Launch M3b (LD19): # · Member · Trades · Buys · Sells · Net · Late — the
       gross ranges are the Net cell's note; Late keeps "N of M". */
    return (
      `<tr role="row"><td${cls(0, "c-muted")}>${pos == null ? "" : fmtInt(pos)}</td>` +
      `<td${cls(1)}>${who}</td>` +
      `<td${cls(2)}>${fmtInt(r.txns)}</td>` +
      `<td${cls(3, "c-buy")}>${fmtInt(r.buys)}</td>` +
      `<td${cls(4, "c-sell")}>${fmtInt(r.sells)}</td>` +
      `<td${cls(5, "c-net")}>${boardNetCellHtml(r, overlapsPrev)}</td>` +
      `<td${cls(6)}>${lateCell}</td></tr>`
    );
  }
  return (
    `<tr role="row"><td${cls(0, "c-muted")}>${pos == null ? "" : fmtInt(pos)}</td>` +
    `<td${cls(1)}>${who}</td>` +
    `<td${cls(2)}>${fmtInt(r.txns)}</td>` +
    `<td${cls(3, "c-buy")}>${fmtInt(r.buys)}</td>` +
    `<td${cls(4, "c-sell")}>${fmtInt(r.sells)}</td>` +
    `<td${cls(5)}>${flowCellHtml(r.purchases)}</td>` +
    `<td${cls(6)}>${flowCellHtml(r.sales)}</td>` +
    `<td${cls(7, "c-net")}>${ctx.referenceRankings ? referenceNetHtml(r.net, overlapsPrev) : netCellHtml(r.net, overlapsPrev)}</td>` +
    `<td${cls(8)}>${lateCell}</td></tr>`
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

/** Launch M3b (copy item congress-19): the boards' ONE Net tip, replacing the
    three near-identical interval tips — the interval rule, the net formula,
    the ≈ rule and where unrankable rows go, each kept. */
export const BOARD_NET_NOTE =
  `Summed statutory ranges, shown as intervals — no midpoints. Net = purchases' bounds minus sales' bounds; ` +
  `≥ is the amount it is at least, shown only when the interval is one-signed. ` +
  `≈ = overlaps the row above, so it is not ranked against it — overlapping intervals are incomparable. ` +
  `Rows with wholly undisclosed amounts are listed separately.`;

/** A board column: the contract column, optionally rendered with no note
    (the "#" head, whose reason copy item congress-18 cut from the board). */
type BoardColumn = CongressColumn & { plain?: boolean };

/** The columns a ranking table renders — the board's set on /congress/
    (`reference`), the full contract elsewhere. Exported so the client
    announces a sort by the label the reader sees. */
export function visualColumns(kind: "leaders" | "tickers", reference = false): BoardColumn[] {
  const columns = congressRankingColumns(kind);
  if (!reference) return columns;
  /* Launch M3b (LD19, copy items congress-18/19/22): the boards' short,
     mark-free heads. Trades, Buys, Sells and Late lose their † tips; Net
     carries the one merged tip; "#" renders bare. */
  const bare = <C extends CongressColumn>(c: C): C => ({ ...c, mark: undefined, note: undefined });
  const rank: BoardColumn = { ...columns[0]!, plain: true };
  const net = { ...bare(columns[7]!), label: "Net", note: esc(BOARD_NET_NOTE) } as CongressColumn;
  if (kind === "tickers") return [rank, columns[1]!,
    { sortable: false, key: null, label: "Buys · Sells", numeric: false, why: "Transaction counts: purchases left, sales right; each row is scaled to its larger count." },
    { ...bare(columns[2]!), label: "Trades" }, { sortable: false, key: null, label: "Members", numeric: true, why: "Distinct joined members in the stated window. Unjoined filers are not inferred to be members." },
    net];
  return [
    rank,
    columns[1]!,
    { ...bare(columns[2]!), label: "Trades" },
    { ...bare(columns[3]!), label: "Buys" },
    { ...bare(columns[4]!), label: "Sells" },
    net,
    { ...bare(columns[8]!), label: "Late" },
  ];
}

/** The sortable header row. A sortable column carries its key and a real
    button; an unsortable one carries its stated reason as visible text, not a
    title attribute — a tooltip is not a channel this site treats as published.
    `aria-sort` starts on the column the server actually ordered by. */
function rankingHeadHtml(
  cols: BoardColumn[],
  active: CongressSortKey,
  dir: "asc" | "desc",
  notes: NoteCtx,
  kind: "leaders" | "tickers",
): string {
  return cols
    .map((c) => withColumnHeaderRole(headCellHtml(c)))
    .join("");
  function headCellHtml(c: BoardColumn): string {
      const cls = rankingColumnClass(c, kind, cols);
      if (c.plain) return thHtml({ label: c.label, cls });
      if (!c.sortable) {
        /* The stated reason is the header's LABEL trigger (no glyph beside it). */
        return thHtml({ label: c.label, mark: c.mark ?? null, cls, noteHtml: esc(c.why), notes, noteKey: c.key ?? c.label });
      }
      const state = c.key === active ? (dir === "desc" ? "descending" : "ascending") : "none";
      /* A SORTABLE column's note is a MARK trigger in the slot (a label
         trigger never sits inside a sort button). The key is `c.key`, non-null
         on this branch by the type; the note button's click is kept out of the
         sort handler. */
      return thHtml({
        label: c.label,
        mark: c.mark ?? null,
        cls,
        noteHtml: c.note ?? null,
        notes,
        noteKey: c.key,
        sort: { attr: "data-congress-sort", key: c.key, state, extra: ` data-congress-dir="${c.defaultDir}"` },
      });
  }
}

/** R40: the shared header builder emits a bare `<th`; the ranking tables add
    the explicit column-header role to each head they render. */
function withColumnHeaderRole(th: string): string {
  return th.replace(/^<th\b(?![^>]*\brole=)/, `<th role="columnheader"`);
}

/** The ranked rows for one root, at a given sort. Exported because the client
    island renders the SAME function over the SAME rows — that identity is what
    the SSR/client parity test compares, and it is why no second row renderer exists. */
export function rankingRowsHtml(
  rows: readonly LeaderRow[],
  kind: "leaders" | "tickers",
  ctx: RenderCtx,
  opts: { numbered?: boolean; startAt?: number; hiddenFrom?: number } = {},
): string {
  // The incomparability marker is recomputed from THIS order. Carrying a
  // marker over from a previous sort would claim an overlap against a row that
  // is no longer above it.
  const flags = overlapFlags(rows);
  const numbered = opts.numbered ?? true;
  const start = opts.startAt ?? 1;
  /* R13: rows at or past `hiddenFrom` ship in the server bytes but start
     `hidden` — the "Show 50 more" control reveals them without any download. */
  const hiddenFrom = opts.hiddenFrom ?? Number.MAX_SAFE_INTEGER;
  return rows
    .map((r, i) => {
      const html = rankingRowHtml(r, numbered ? start + i : null, flags[i]!, kind, ctx);
      return i >= hiddenFrom ? html.replace(/^<tr\b/, "<tr hidden data-compact-hidden") : html;
    })
    .join("\n");
}

/** The rows an interval sort could not rank, with their own stated separator.
    They are NOT the undisclosed bucket — see `sortRankingRows`. */
function unrankableSeparatorHtml(n: number, colspan: number, columnLabel: string): string {
  return (
    `<tr class="unranked-sep" role="row"><td colspan="${colspan}" role="cell">${fmtInt(n)} ` +
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
  opts: { compact?: number; prefetch?: number } = {},
): { html: string; total: number; shown: number } {
  const cols = visualColumns(kind, ctx.referenceRankings);
  const { ranked, unrankable } = sortRankingRows(rows, key, dir);
  const total = ranked.length + unrankable.length;
  const limit = opts.compact ?? total;
  /* R13: `prefetch` more ranked rows ride along HIDDEN past the compact slice,
     so the expand control has real rows to reveal before (or without) the
     full dataset download. They are not counted as shown. */
  const prefetch = opts.compact === undefined ? 0 : (opts.prefetch ?? 0);
  const rankedShown = ranked.slice(0, limit + prefetch);
  // The compact slice is a bound on the WHOLE table, so it consumes the ranked
  // rows first and only then the unrankable tail — otherwise collapsing could
  // drop every ranked row and show only the tail.
  const unrankableShown = unrankable.slice(0, Math.max(0, limit - ranked.length));
  const activeLabel =
    cols.find((c) => c.sortable && c.key === key)?.label ?? key;
  return {
    html:
      rankingRowsHtml(rankedShown, kind, ctx, { hiddenFrom: limit }) +
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
    shown: Math.min(rankedShown.length, limit) + unrankableShown.length,
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
        } excluded from the trade-date window (${DATE_ANOMALY_NOTE})`,
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
        `the largest disclosers by flow can be entirely non-equity; the member ranking is keyed by member instead`,
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
  /** Launch M3b (copy item congress-17): the board's short statement — the
      range and basis visible, the exact window and every exclusion clause in
      the note, the summed excluded-row count still on the page. */
  board?: { range: CongressRange; basis: CongressBasis },
): string {
  const clauses = rankingExclusions(rollup, kind);
  if (board) {
    const short = boardWindowText(board.range, board.basis);
    const bounds = windowText.split(" · ").slice(1).join(" · ");
    const body = [`${bounds || windowText}.`, ...clauses].join(" ");
    const rows = rankingExcludedRows(rollup, kind);
    return (
      `${esc(short)} · ` +
      note(body, { scope: "window" }, sectionId, {
        trigger: "label",
        textHtml: rows > 0 ? `${fmtInt(rows)} excluded` : "window",
        name: rows > 0 ? `${fmtInt(rows)} excluded` : "window",
      })
    );
  }
  if (clauses.length === 0) return esc(windowText);
  const rows = rankingExcludedRows(rollup, kind);
  /* LD4, the mitigation the owner directed: the SIZE of what the reader cannot
     see stays on the page at every width, and is the note's anchor. The three
     per-category counts and their definitions live in the note body. */
  /* The excluded-row count is the note's LABEL trigger: the size stays on the
     page at every width, and the per-category clauses open from it. */
  return (
    `${esc(windowText)} · ` +
    note(clauses.join(" · "), { scope: "window" }, sectionId, {
      trigger: "label",
      textHtml: `${fmtInt(rows)} ${rows === 1 ? "row" : "rows"} excluded`,
    })
  );
}


/** The board's visible window: "12 months · by trade date". */
export function boardWindowText(range: CongressRange, basis: CongressBasis): string {
  const span = { "7d": "7 days", "30d": "30 days", "90d": "90 days", "12m": "12 months" }[range];
  return `${span} · by ${basis === "traded" ? "trade" : "filing"} date`;
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

/** D4: the default sort of a ranking section — disclosure count for tickers
    ("most disclosed"), net disclosed flow for members. ONE source, read by the
    server render and the client binding so the two cannot disagree. */
export function defaultRankingSortKey(kind: "leaders" | "tickers"): CongressSortKey {
  return kind === "tickers" ? "txns" : "net";
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
  const cols = visualColumns(kind, ctx.referenceRankings);
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

  /* D4: "Tickers · most disclosed" ranks by the NUMBER of disclosures (the
     section's name and SRC §2); net disclosed flow stays one header click
     away. The member section keeps net flow. */
  const defaultKey: CongressSortKey = defaultRankingSortKey(kind);
  const main = rankingRootHtml(ranked, defaultKey, "desc", kind, ctx, { compact, prefetch: COMPACT_STEP });
  const bucket = rankingRootHtml(undisclosedBucket, "name", "asc", kind, ctx, { compact });

  const caption =
    kind === "leaders"
      ? `Members ranked by net disclosed flow, ${windowText}`
      : `Tickers ranked by number of disclosures, ${windowText}`;
  const noun = kind === "leaders" ? "members" : "tickers";
  const board = ctx.referenceRankings ? { range: rollup.range, basis: rollup.basis } : undefined;
  return (
    `<section class="panel panel-wide${ctx.referenceRankings ? " reference-ranking" : ""}" id="${esc(opts.sectionId)}" aria-label="${esc(caption)}">` +
    `<div class="panel-head"><h2 class="section-h">${esc(opts.heading)}</h2>` +
    `<span class="panel-note" id="${esc(opts.sectionId)}-window">` +
    rankingWindowHtml(windowText, rollup, kind, opts.sectionId, board) +
    `</span>` +
    /* The window control is the band head's own right-aligned control, on the
       head's baseline, with its own words ("Window & dates") — never an
       absolutely positioned "⋯" over the table. */
    (opts.controls && ctx.referenceRankings ? `<details class="ranking-options"><summary>Window &amp; dates</summary>${rangeControlHtml(rollup.range, rollup.basis)}</details>` : "") +
    `</div>` +
    (opts.controls && !ctx.referenceRankings ? rangeControlHtml(rollup.range, rollup.basis) : "") +
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
    `<p class="section-note"><noscript>${
      ctx.referenceRankings
        ? /* launch M3b: the boards' short form of the same statement */
          `Sorting needs JavaScript; ordered by ${kind === "tickers" ? "trades" : "net flow"}, largest first.`
        : `Sorting by column header needs JavaScript; the order below is by ${kind === "tickers" ? "number of disclosures" : "net disclosed flow"}, largest first.`
    }</noscript></p>` +
    /* Band C1 (DESIGN-POLISH M2): Tickers is the pair's 1fr cell, so its table
       is compact (the 10px numeric lead) — at the 16px lead its six columns
       ran 7px past the 553px cell at 1440 (G3). */
    `<div class="table-scroll"><table class="etable${kind === "tickers" && ctx.referenceRankings ? " etable-compact" : ""}" data-sticky-first role="table" data-card="ranking">` +
    `<caption class="visually-hidden">${esc(caption)}</caption>` +
    `<thead role="rowgroup"><tr role="row">${rankingHeadHtml(cols, defaultKey, "desc", { scope: `rank-${opts.sectionId}` }, kind)}</tr></thead>` +
    `<tbody id="${esc(opts.rootId)}" role="rowgroup">${main.html}</tbody></table></div>` +
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
      // SRC §5: the sentence moved to /methodology/#published-dataset; the link
      // stays — except on the boards, where copy item congress-20 leaves it to
      // Methodology and the count reads "1–10 of N ranked members".
      ...(ctx.referenceRankings ? {} : { bound: `All rows are in the <a href="/congress/data/">published dataset</a>.` }),
    }) +
    (undisclosedBucket.length > 0 && opts.undisclosedRootId
      ? (ctx.referenceRankings ? `<details class="unrankable-block design-supplement"><summary>${undisclosedBucket.length} not rankable · amounts wholly undisclosed</summary>` : `<div class="unrankable-block"><h3 class="section-h">Not rankable — amounts wholly undisclosed</h3>`) +
        (ctx.referenceRankings
          ? `<p class="section-note">Every amount on one side failed to parse, so these rows are not ranked.</p>`
          : `<p class="section-note">These rows include at least one side whose every amount failed to parse. ` +
            `They have no endpoints, so they hold no position in the ranking — listed after it, never sorted ` +
            `to the bottom as if small, and never merged into it by any sort.</p>`) +
        `<div class="table-scroll"><table class="etable" role="table" data-card="ranking">` +
        `<caption class="visually-hidden">Unrankable ${esc(noun)} — amounts wholly undisclosed</caption>` +
        `<thead role="rowgroup"><tr role="row">${rankingHeadHtml(cols, "name", "asc", { scope: `undisc-${opts.sectionId}` }, kind)}</tr></thead>` +
        `<tbody id="${esc(opts.undisclosedRootId)}" role="rowgroup">${bucket.html}</tbody></table></div>` +
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
        (ctx.referenceRankings ? `</details>` : `</div>`)
      : "") +
    /* The visible `.caveat-line` and its `#<sectionId>-caveat` root are
       DELETED. Unlike the terminus rows, nothing is lost to a reader with
       scripting off: the clauses moved into a note, which opens declaratively
       through `popovertarget` with no JavaScript at all, and their SUMMED ROW
       TOTAL stays visible on the window statement at every width (LD4). */
    `</section>`
  );
}

/* ---------- launch M3b: the Congress page ledger (R18, LD18) ----------

   Four figures, each computed from the build's rows and coverage, never a
   literal: Trades since the first filed year; Last 30 days (transaction rows
   filed in the 30 days ending on the build date, and the members who filed
   them); Median lag with the share filed late (late rows over rows with a late
   status, "N of M" in the tip); E-filings read (the floored percentage over
   House and Senate e-filings, each chamber and the paper count in the tip). */

export interface CongressCoverage {
  houseParsed: number;
  houseEfile: number;
  housePct: string;
  senateParsed: number;
  senateEfile: number;
  senatePct: string;
  needsOcr: number;
  /** `pct(houseParsed + senateParsed, houseEfile + senateEfile)` — floored */
  efilePct: string;
}

export interface CongressLedgerFigures {
  trades: number;
  filedFrom: string;
  last30: { rows: number; members: number; unjoined: number; from: string; to: string };
  lag: { median: number | null; withLag: number; late: number; withStatus: number };
}

/** The day `days` before an ISO date, as an ISO date (UTC calendar). */
function isoDaysBefore(date: string, days: number): string {
  const t = Date.parse(`${date}T00:00:00Z`) - days * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

export function congressLedgerFigures(
  txns: readonly TxnRow[],
  opts: { buildDate: string; filedFrom: string },
): CongressLedgerFigures {
  const from = isoDaysBefore(opts.buildDate, 29);
  const recent = txns.filter((r) => r.filed >= from && r.filed <= opts.buildDate);
  const members = new Set(recent.filter((r) => r.bioguide).map((r) => r.bioguide));
  const unjoined = new Set(recent.filter((r) => !r.bioguide).map((r) => r.name));
  const withStatus = txns.filter((r) => r.late === 0 || r.late === 1);
  return {
    trades: txns.length,
    filedFrom: opts.filedFrom,
    last30: { rows: recent.length, members: members.size, unjoined: unjoined.size, from, to: opts.buildDate },
    lag: {
      median: medianLag(txns),
      withLag: txns.filter((r) => r.lag != null).length,
      late: withStatus.filter((r) => r.late === 1).length,
      withStatus: withStatus.length,
    },
  };
}

/** `pct` is the site's ONE floored share (`lib/data.ts`, never rounded up to
    100), passed in because this module stays free of Node APIs for the client. */
export function congressLedgerItems(
  f: CongressLedgerFigures,
  c: CongressCoverage,
  pct: (num: number, den: number) => string,
): LedgerItem[] {
  const latePct = pct(f.lag.late, f.lag.withStatus);
  const members = `${fmtInt(f.last30.members)} ${f.last30.members === 1 ? "member" : "members"}`;
  return [
    {
      label: "Trades",
      value: fmtInt(f.trades),
      detail: `since ${f.filedFrom}`,
      subKind: "date",
      noteHtml:
        `Transactions in the default view, filed since ${esc(f.filedFrom)}: active filings minus the originals an amendment replaced. ` +
        `<a href="/methodology/#defaults">Default view ↗</a>`,
    },
    {
      label: "Last 30 days",
      value: fmtInt(f.last30.rows),
      detail: `${members} filed`,
      subKind: "count",
      tone: "blue",
      noteHtml:
        `Transaction rows filed ${esc(f.last30.from)} to ${esc(f.last30.to)} inclusive — the 30 days ending on the build date — by ${members}` +
        (f.last30.unjoined > 0
          ? ` and ${fmtInt(f.last30.unjoined)} ${f.last30.unjoined === 1 ? "filer" : "filers"} not yet matched to a member record.`
          : `.`),
    },
    {
      label: "Median lag",
      value: f.lag.median === null ? "—" : `${fmtInt(f.lag.median)} days`,
      detail: `${latePct}% filed late`,
      subKind: "count",
      noteHtml:
        (f.lag.median === null
          ? `No row discloses both dates, so no lag is measured. `
          : `Median days from trade to filing over the ${fmtInt(f.lag.withLag)} rows with both dates. `) +
        `Filed late: ${fmtInt(f.lag.late)} of ${fmtInt(f.lag.withStatus)} rows with a late status (${latePct}%), past the 45-day deadline. ` +
        `<a href="/methodology/#filing-lag">45-day lag ↗</a>`,
    },
    {
      label: "E-filings read",
      value: `${c.efilePct}%`,
      detail: `${fmtInt(c.needsOcr)} paper not yet read`,
      subKind: "count",
      tone: "gold",
      noteHtml:
        `House: ${fmtInt(c.houseParsed)} of ${fmtInt(c.houseEfile)} e-filings read (${esc(c.housePct)}%). ` +
        `Senate: ${fmtInt(c.senateParsed)} of ${fmtInt(c.senateEfile)} (${esc(c.senatePct)}%). ` +
        `${fmtInt(c.needsOcr)} paper ${c.needsOcr === 1 ? "filing is" : "filings are"} counted but not machine-read until OCR, so their trades are not in the rows below. ` +
        `<a href="/methodology/#coverage">Coverage ↗</a>`,
    },
  ];
}
