/* R14 (SRC §6-i, §6-iii) — the notable-manager moves band and the consensus
   board on /institutional/, plus the per-period shard behind "Show 50 more".

   Population: the registry's `notable` managers, ONE closed quarter, kinds
   new / add / trim / exit — classified by SHARES (R8) — with the producer's
   `book_discontinuity` rows excluded (R6). Everything derives from the serving
   activity grain already loaded for the landing feed, so the band, the shard
   and the consensus board cannot disagree about a row.

   Pure: no Node APIs, no DOM. The routes, the page and the tests all call the
   same functions. */

/* This module is CLIENT-SAFE: it is reached from `ui/institutional.ts`
   (`positionAnchor`) and from the landing island, so it imports no Node-backed
   module. The derivation that reads the serving grain lives beside it in
   `notable-moves-derive.ts` (server only). */
import type { ManagerType } from "./manager-directory.ts";
import type { LedgerItem } from "./ui/shared.ts";
import { compactDisclosure, displayIssuerName, esc, fmtInt, fmtUsd, hangMark, kindWordHtml, note, rangeOfTotal, slug, thHtml } from "./format.ts";

export type MoveKind = "new" | "add" | "trim" | "exit";

/** One row of the band, as embedded and as served by the shard. */
export interface NotableMove {
  cik: string;
  /** curated display name (registry) */
  manager: string;
  principal: string | null;
  type: ManagerType;
  issuer: string;
  ticker: string | null;
  /** the mapping row's verified date, when a ticker is shown (LD6 ⓘ) */
  ticker_verified: string | null;
  kind: MoveKind;
  delta_shares: number | null;
  curr_value: number | null;
  delta_value: number | null;
  filed: string | null;
  doc: string | null;
  /** the position key, for the filer-page anchor (`#pos-<slug>`) */
  key: string;
  /** the producer's issuer key (grouping key of the consensus board); null = unkeyed */
  ikey: string | null;
}

export interface NotableMovesShard {
  v: 1;
  period: string;
  /** rows in the full population, before any byte bound */
  total: number;
  truncated: boolean;
  rows: NotableMove[];
}

/** New > Exit > Add > Trim (SRC §6-i). */
export const MOVE_KIND_PRIORITY: Record<MoveKind, number> = { new: 0, exit: 1, add: 2, trim: 3 };

/** Rows rendered on the server; the shard carries the rest. */
export const NOTABLE_MOVES_SSR_ROWS = 15;
export const NOTABLE_MOVES_STEP = 50;

export function notableMovesHref(period: string): string {
  return `/institutional/data/notable-moves/${encodeURIComponent(period)}.v1.json`;
}

/** The filer-page anchor of one position's change row (institutional.ts
    renders `id="pos-<slug(position_key)>"` on every changes row). */
export function positionAnchor(positionKey: string): string {
  return `pos-${slug(positionKey)}`;
}

export function classifyNotableMovesShard(body: unknown): NotableMovesShard | null {
  if (typeof body !== "object" || body === null) return null;
  const b = body as Record<string, unknown>;
  if (b.v !== 1 || typeof b.period !== "string" || !Array.isArray(b.rows)) return null;
  return { v: 1, period: b.period, total: Number(b.total), truncated: Boolean(b.truncated), rows: b.rows as NotableMove[] };
}

/* ---------- rendering ---------- */

function signedUsd(v: number | null): string {
  if (v == null) return "—";
  return v < 0 ? `−${fmtUsd(Math.abs(v))}` : `+${fmtUsd(v)}`;
}
function signedShares(v: number | null): string {
  if (v == null) return "—";
  return v < 0 ? `−${fmtInt(Math.abs(v))}` : `+${fmtInt(v)}`;
}

export interface MoveRowOpts {
  filerHref: (cik: string) => string;
}

export function notableMoveRowHtml(m: NotableMove, opts: MoveRowOpts): string {
  const href = `${opts.filerHref(m.cik)}#${positionAnchor(m.key)}`;
  const who = `<a href="${esc(href)}">${esc(m.manager)}</a>${m.principal ? ` <span class="c-muted">(${esc(m.principal)})</span>` : ""}`;
  // LD6: a Tier C ticker always carries its verification note — the ticker
  // itself is the trigger (DESIGN-POLISH M1, R6: the label form).
  const tick = m.ticker
    ? note(`ticker verified against the SEC company list${m.ticker_verified ? ` on ${m.ticker_verified}` : ""}`, { scope: "notable-moves" }, `${m.cik}-${m.key}`, {
        trigger: "label",
        textHtml: `<span class="mono-ticker">${esc(m.ticker)}</span>`,
        name: m.ticker,
      }) + " "
    : "";
  const dir = m.delta_value == null ? "c-muted" : m.delta_value < 0 ? "c-sell" : "c-buy";
  return (
    `<tr data-mv-kind="${m.kind}" data-mv-type="${esc(m.type)}" data-mv-cik="${esc(m.cik)}" data-edge="${m.kind}">` +
    `<td class="c-filer">${who}</td>` +
    `<td class="c-issuer c-flex">${tick}<span class="filed-name">${esc(m.issuer)}</span></td>` +
    `<td class="c-chip c-kind">${kindWordHtml(m.kind)}</td>` +
    `<td class="c-num">${esc(signedShares(m.delta_shares))}</td>` +
    `<td class="c-num">${m.curr_value == null ? "—" : esc(fmtUsd(m.curr_value))}</td>` +
    `<td class="c-num ${dir}">${esc(signedUsd(m.delta_value))}</td>` +
    `<td class="c-filed c-num">${esc(m.filed ?? "—")}</td>` +
    `<td class="c-src">${m.doc ? `<a href="${esc(m.doc)}" rel="noopener" target="_blank">EDGAR ↗</a>` : "—"}</td></tr>`
  );
}

export const NOTABLE_MOVES_COLUMNS = ["Manager", "Ticker · Issuer", "Change", "Δ shares", "Now $", "Δ $", "Filed", "Src"] as const;
/** The ledger role of each column above (DESIGN-POLISH M1, R2). */
const NOTABLE_MOVES_CLASSES = ["c-filer", "c-issuer c-flex", "c-chip c-kind", "c-num", "c-num", "c-num", "c-num", "c-src"] as const;

/** The band's count — the range grammar (R8): "1–15 of 40 moves". The server
    and the island both build it here. */
export function notableMovesCountText(shown: number, total: number): string {
  return rangeOfTotal(1, shown, total, "moves");
}

export interface NotableMovesBandOpts extends MoveRowOpts {
  /** closed periods offered by the selector, newest first */
  periods: readonly string[];
  period: string | null;
  /** SSR rows (defaults to NOTABLE_MOVES_SSR_ROWS) */
  ssrRows?: number;
}

/** The band. Fifteen rows SSR; the chips and "Show 50 more" run on the shard. */
export function notableMovesBandHtml(rows: readonly NotableMove[], opts: NotableMovesBandOpts): string {
  const ssr = opts.ssrRows ?? NOTABLE_MOVES_SSR_ROWS;
  const shown = rows.slice(0, ssr);
  const periodChips = opts.periods
    .map((p) => `<button type="button" class="mgr-chip" data-moves-period="${esc(p)}" aria-pressed="${p === opts.period}">${esc(p)}</button>`)
    .join("");
  const kindChips = (["new", "exit", "add", "trim"] as MoveKind[])
    .map((k) => `<button type="button" class="mgr-chip" data-moves-kind="${k}" aria-pressed="false">${k === "new" ? "New stakes" : k === "exit" ? "Exits" : k === "add" ? "Adds" : "Trims"}</button>`)
    .join("");
  const typeChips = `<button type="button" class="mgr-chip" data-moves-type="hedge_fund" aria-pressed="false">Hedge funds</button>` +
    `<button type="button" class="mgr-chip" data-moves-type="family_office" aria-pressed="false">Family offices</button>`;
  const body = shown.length === 0
    ? `<tr><td colspan="${NOTABLE_MOVES_COLUMNS.length}" class="design-unavailable-message">${opts.period ? `No notable-manager moves are on record for the quarter ended ${esc(opts.period)}.` : "No closed quarter is available yet."}</td></tr>`
    : shown.map((m) => notableMoveRowHtml(m, opts)).join("\n");
  return (
    `<section class="panel panel-wide design-notable-moves" id="inst-notable-moves" aria-label="Notable managers — latest named moves"` +
    ` data-moves-period="${esc(opts.period ?? "")}" data-moves-total="${rows.length}" data-moves-shown="${shown.length}">` +
    `<div class="panel-head"><h2 class="section-h">Notable managers — latest named moves</h2>` +
    `<span class="panel-note" id="inst-notable-moves-window">${opts.period ? `quarter ended ${esc(opts.period)}` : "no closed quarter"} · by shares · largest $ change first within New › Exit › Add › Trim</span></div>` +
    `<div class="range-control control-row">` +
    `<div class="filter-group" role="group" aria-label="Reporting quarter"><span class="filter-label">Quarter</span><div class="chips">${periodChips}</div></div>` +
    `<div class="filter-group" role="group" aria-label="Kind of change"><span class="filter-label">Change</span><div class="chips">${kindChips}</div></div>` +
    `<div class="filter-group" role="group" aria-label="Manager type"><span class="filter-label">Type</span><div class="chips">${typeChips}</div></div>` +
    `</div>` +
    `<div class="table-scroll"><table class="etable" data-sticky-first><caption class="visually-hidden">Notable managers' position changes${opts.period ? ` into the quarter ended ${esc(opts.period)}` : ""}</caption>` +
    `<thead><tr>${NOTABLE_MOVES_COLUMNS.map((c, i) => thHtml({ label: c, cls: NOTABLE_MOVES_CLASSES[i] })).join("")}</tr></thead>` +
    `<tbody id="inst-notable-moves-tbody">${body}</tbody></table></div>` +
    `<p class="section-note" id="inst-notable-moves-count">${rows.length === 0 ? "" : esc(notableMovesCountText(shown.length, rows.length))}` +
    (rows.length > shown.length ? ` · <button type="button" class="linklike" id="inst-notable-moves-more">Show ${fmtInt(NOTABLE_MOVES_STEP)} more</button>` : "") +
    (opts.period ? ` · <a href="${esc(notableMovesHref(opts.period))}">every row for this quarter (JSON)</a>` : "") + `</p>` +
    `<p class="caveat-line" id="inst-notable-moves-status" role="status" aria-live="polite"></p>` +
    `<p class="section-note">Moves are classified by share count between the two quarters; a dollar change alone is not a position change. ` +
    `Exit is inferred from absence in the next filing. Tickers appear only where the reviewed mapping names one.</p>` +
    `</section>`
  );
}

/* ---------- the consensus board (SRC §6-iii) ---------- */

export interface ConsensusRow {
  issuerKey: string;
  issuer: string;
  ticker: string | null;
  newStakes: number;
  adds: number;
  trims: number;
  exits: number;
  /** distinct notable filers with any move in the name */
  filers: number;
  netDeltaUsd: number | null;
  netDeltaPartial: boolean;
  topMover: { manager: string; kind: MoveKind; cik: string } | null;
}

/** The /institutional/ header's "Consensus add" figure (R15, DESIGN-POLISH
    M2 review R2-3). The value is the name's reviewed TICKER; a name no
    reviewed ticker maps has the count of notable managers who opened it as its
    value — a figure, never "—", which on this ledger reads as "no consensus
    add" on a quarter that has one. The issuer's filed name leads the sub
    either way (R15, long names; a name that would wrap the sub to a third
    line makes the figure wide — `ledgerFigureWide`), and only a quarter with
    no qualifying name shows "—". */
export function consensusAddLedgerItem(consensus: ConsensusRow | null, period: string | null): LedgerItem {
  if (!consensus) {
    return {
      label: "Consensus add",
      value: "—",
      /* the closed quarter is stated beside it (the provenance strip and the
         other figures' subs), so the absence fits two lines */
      detail: period ? "no name moved by ≥3 notable managers" : "no closed quarter yet",
      subKind: "absence",
      tone: "blue",
    };
  }
  const n = consensus.newStakes;
  const managers = `${fmtInt(n)} ${n === 1 ? "manager" : "managers"}`;
  return {
    label: "Consensus add",
    value: consensus.ticker ?? managers,
    detail: consensus.ticker ? `${consensus.issuer} · ${fmtInt(n)} notable ${n === 1 ? "manager" : "managers"} opened it` : `${consensus.issuer} · no reviewed ticker`,
    subKind: consensus.ticker ? "count" : "absence",
    tone: "blue",
    noteHtml:
      `The issuer the most notable managers opened a new stake in during the closed quarter ${esc(period ?? "")}` +
      (consensus.ticker ? "" : `; no reviewed ticker maps it, so the figure is the number of notable managers who opened it`) +
      `. Ranked in Consensus below.`,
  };
}

/** The consensus board's count noun: its rows are the highest-ranked
    `limit` of the qualifying issuers, so when more qualify than it lists the
    count names that bound (review R-4). */
export function consensusBoundNoun(board: Pick<ConsensusBoard, "qualifying" | "rows">): { boundNoun: string; definite: boolean } {
  return board.qualifying > board.rows.length
    ? { boundNoun: "highest-ranked issuers", definite: true }
    : { boundNoun: "issuers", definite: false };
}

export interface ConsensusBoard {
  period: string;
  minFilers: number;
  rows: ConsensusRow[];
  qualifying: number;
}

/** Issuers ≥ `minFilers` DISTINCT notable filers moved in the quarter, ranked
    by new-stake count then net $. Built from the same moves as the band. */
export function consensusBoard(period: string, moves: readonly NotableMove[], opts: { minFilers?: number; limit?: number } = {}): ConsensusBoard {
  const issuerKeyOf = (m: NotableMove): string | null => m.ikey;
  const minFilers = opts.minFilers ?? 3;
  const limit = opts.limit ?? 50;
  interface Acc { names: string[]; tickers: Map<string, number>; byKind: Record<MoveKind, Set<string>>; filers: Set<string>; net: number; any: boolean; partial: boolean; top: NotableMove | null }
  const groups = new Map<string, Acc>();
  for (const m of moves) {
    const key = issuerKeyOf(m);
    if (!key) continue;
    let g = groups.get(key);
    if (!g) {
      g = { names: [], tickers: new Map(), byKind: { new: new Set(), add: new Set(), trim: new Set(), exit: new Set() }, filers: new Set(), net: 0, any: false, partial: false, top: null };
      groups.set(key, g);
    }
    g.names.push(m.issuer);
    if (m.ticker) g.tickers.set(m.ticker, (g.tickers.get(m.ticker) ?? 0) + 1);
    g.byKind[m.kind].add(m.cik);
    g.filers.add(m.cik);
    if (m.delta_value == null) g.partial = true;
    else { g.net += m.delta_value; g.any = true; }
    if (g.top === null || Math.abs(m.delta_value ?? -1) > Math.abs(g.top.delta_value ?? -1)) g.top = m;
  }
  const rows: ConsensusRow[] = [];
  for (const [key, g] of groups) {
    if (g.filers.size < minFilers) continue;
    const ticker = [...g.tickers.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0]?.[0] ?? null;
    rows.push({
      issuerKey: key,
      issuer: displayIssuerName(g.names) ?? key,
      ticker,
      newStakes: g.byKind.new.size,
      adds: g.byKind.add.size,
      trims: g.byKind.trim.size,
      exits: g.byKind.exit.size,
      filers: g.filers.size,
      netDeltaUsd: g.any ? g.net : null,
      netDeltaPartial: g.partial,
      topMover: g.top ? { manager: g.top.manager, kind: g.top.kind, cik: g.top.cik } : null,
    });
  }
  rows.sort((a, b) =>
    b.newStakes - a.newStakes ||
    ((b.netDeltaUsd ?? Number.NEGATIVE_INFINITY) - (a.netDeltaUsd ?? Number.NEGATIVE_INFINITY)) ||
    (a.issuerKey < b.issuerKey ? -1 : 1),
  );
  return { period, minFilers, rows: rows.slice(0, limit), qualifying: rows.length };
}

/** Band I1 (DESIGN-POLISH M2, R10; coordinator decision CD-5): Consensus is
    the PRIMARY cell (1.3fr) beside Conviction leaders (1fr, the side panel),
    and shows a FIXED 10 rows — the approved preview's board — whatever its
    partner holds. No row count here depends on the other cell (the paired-rows
    estimate of M2F-D1 is withdrawn). The rest stay in the DOM behind the named
    binder, one Show-all away. */
export const CONSENSUS_COMPACT_ROWS = 10;

export function consensusBoardHtml(board: ConsensusBoard | null, opts: MoveRowOpts): string {
  const compact = CONSENSUS_COMPACT_ROWS;
  const columns = ["Ticker · Issuer", "New stakes", "Adds", "Trims", "Exits", "Net $", "Top mover"];
  const head = `<div class="panel-head"><h2 class="section-h">Consensus</h2><span class="panel-note">${board ? `≥${fmtInt(board.minFilers)} notable managers moved the same name · ${esc(board.period)} · ranked by new stakes` : "notable managers · no closed quarter"}</span></div>`;
  if (board === null || board.rows.length === 0) {
    return (
      /* `data-empty-state`: the board is ONE stated line, so band I1
         collapses rather than pairing it with the Conviction table (R10). */
      `<section class="panel design-consensus" id="inst-consensus" aria-label="Consensus" data-empty-state>${head}` +
      `<p class="section-note">${board ? `No issuer was moved by ${fmtInt(board.minFilers)} or more notable managers in the quarter ended ${esc(board.period)}. Absence is stated, never simulated.` : "No closed quarter is available to group over yet."}</p></section>`
    );
  }
  const rows = board.rows
    .map((r, i) =>
      `<tr${i >= compact ? " data-compact-extra" : ""}>` +
      `<td class="c-issuer c-flex">${r.ticker ? `<span class="mono-ticker">${esc(r.ticker)}</span> ` : ""}<span class="filed-name">${esc(r.issuer)}</span></td>` +
      `<td class="c-num c-strong">${fmtInt(r.newStakes)}</td><td class="c-num">${fmtInt(r.adds)}</td><td class="c-num">${fmtInt(r.trims)}</td><td class="c-num">${fmtInt(r.exits)}</td>` +
      `<td class="c-num has-marks ${r.netDeltaUsd == null ? "c-muted" : r.netDeltaUsd < 0 ? "c-sell" : "c-buy"}">${esc(signedUsd(r.netDeltaUsd))}${r.netDeltaPartial ? hangMark("≈") : ""}</td>` +
      `<td class="c-filer c-secondary">${r.topMover ? `<a href="${esc(opts.filerHref(r.topMover.cik))}">${esc(r.topMover.manager)}</a> ${kindWordHtml(r.topMover.kind)}` : "—"}</td></tr>`,
    )
    .join("\n");
  const collapsed = board.rows.length > compact;
  return (
    `<section class="panel design-consensus" id="inst-consensus" aria-label="Consensus">${head}` +
    `<div class="table-scroll"><table class="etable etable-compact" data-sticky-first><caption class="visually-hidden">Issuers moved by ${fmtInt(board.minFilers)} or more notable managers in ${esc(board.period)}</caption>` +
    `<thead><tr>${columns.map((c, i) => thHtml({ label: c, cls: i === 0 ? "c-issuer c-flex" : i === 6 ? "c-filer c-secondary" : i === 5 ? "c-num has-marks" : "c-num" })).join("")}</tr></thead>` +
    `<tbody id="inst-consensus-tbody"${collapsed ? ' data-collapsed="true"' : ""}>${rows}</tbody></table></div>` +
    `<p class="section-note">${fmtInt(board.qualifying)} issuers qualify · counts are distinct notable managers · ≈ = a contributing change disclosed no value, so the sum is partial.` +
    (board.qualifying > board.rows.length ? ` The ${fmtInt(board.rows.length)} highest-ranked are listed.` : "") + `</p>` +
    /* The one disclosure primitive and its range count (R8) — it was hand-built
       here with a second grammar, a bare count of the held-back rows. A board
       holding nothing back renders its hidden SHELL, so the table always
       carries its own count (`data-compact-total` ≤ `data-compact-shown`):
       G9 reads it to know a short primary is COMPLETE, not cut (M2 delta
       review). */
    compactDisclosure({
      rootId: "inst-consensus-tbody",
      total: board.rows.length,
      shown: Math.min(compact, board.rows.length),
      noun: "issuers",
      /* when more issuers qualify than the board lists, its total is the
         board's own bound — "1–10 of the 50 highest-ranked issuers" — never
         the count of qualifying issuers (review R-4) */
      ...consensusBoundNoun(board),
      domBacked: true,
    }) +
    `</section>`
  );
}
