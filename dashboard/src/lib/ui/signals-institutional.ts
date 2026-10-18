/* ui/signals-institutional.ts — the Institutional tab of /signals/ (signals-v4
   M2: R11–R16, LD1, LD6, LD7, LD11–LD13, LD19, LD20). One of the ui/ domain
   modules: consumers import from ./index.ts only.

   The tab reads ONE closed 13F quarter — the newest whose 45-day filing
   window the corpus has seen (`closedPeriods` over `corpusAsOf`) — and the
   FULL in-build population of the notable managers' moves for it
   (`notableMovesFor`), never the published shard, which is cut at 1 MiB:

   - a provenance line: the quarter, and the newest filing the build holds
     (amber), with the 13F snapshot caveats in its tip (R16);
   - three lead cards (LD13): Consensus row 1, the largest new stake and the
     largest exit, each stating its quarter, the two single-filing cards with
     their 13F receipt; a card filters the Named moves to its name;
   - one band (LD6): Named moves │ Consensus above the new-position leaders
     (the owner's reference label, LD20), the Named moves filled to the side
     column's height by `scripts/column-fit.ts`; where the band stacks a
     three-pane switch picks one (LD7);
   - the Congress column on every move and Consensus row: distinct members of
     Congress on the same side of the same ticker, traded inside the quarter,
     broad accounts excluded (LD10, `congress-quarter.ts`), every listed line
     through the one `congressLineHtml`.

   The model (`buildSignalsInstitutional`) is pure and computed once per build
   in memory (`getSignalsInstitutional`, data.ts); nothing here is serialized
   but rendered HTML and the slice totals the Named moves carry on their own
   section as a string attribute (R23). */

import {
  type RenderCtx,
  type TxnRow,
  compactDisclosure,
  esc,
  fmtInt,
  fmtUsd,
  kindWord,
  kindWordHtml,
  note,
  noteFromHtml,
  normalizeTicker13f,
  rangeOfTotal,
  slug,
  tickerHrefFor,
} from "../format.ts";
import { filerLinkHtml, institutionalDataNoteHtml, type FilerBudgetState } from "../holdings.ts";
import { MANAGER_TYPE_LABELS, type ManagerType } from "../manager-directory.ts";
import {
  type ConsensusBoard,
  type ConsensusRow,
  type InstLeadCards,
  type NotableMove,
  NAMED_MOVES_MIN,
  NAMED_MOVES_SLICE_ROWS,
  NAMED_MOVES_STEP,
  NAMED_MOVE_KINDS,
  NAMED_MOVE_TYPES,
  consensusAddLedgerItem,
  consensusBoard,
  consensusBoundNoun,
  consensusExclusionText,
  consensusRowLabel,
  instLeadCards,
  moveNameKey,
  namedMovesDomSet,
  namedMovesSliceTotals,
  positionAnchor,
  signedShares,
  signedUsd,
} from "../notable-moves.ts";
import {
  BROAD_ACCOUNT_NAMES,
  CONGRESS_DETAIL_LINES,
  congressQuarter,
  moveSide,
  quarterLabel,
  quarterMembers,
  type CongressQuarter,
  type MemberLines,
  type QuarterSide,
} from "../congress-quarter.ts";
import type { NewPositionLeaders } from "../inst-analytics.ts";
import { convictionCountsText, convictionRuleText } from "./institutional.ts";
import { disclosureLedger, pairBandHtml, type LedgerItem } from "./shared.ts";
import { congressLineHtml, paneSwitchHtml } from "./signals.ts";

/** LD20: the owner's reference label for the new-position leaders. Outside
    the exempt heading, ARIA and caption forms it renders only through this
    markup, which the wording scan strips — free text never carries the word. */
export const CONVICTION_LABEL_HTML = `<span class="ref-label">Conviction leaders</span>`;
/** LD20: the phone pane switch's short form of the same label. */
export const CONVICTION_SHORT_LABEL_HTML = `<span class="ref-label">Conviction</span>`;

/** Consensus rows shown before "Show all" (LD12). */
export const CONSENSUS_COMPACT_ROWS = 10;

/* ---------------------------------------------------------------- the model */

export interface SignalsInstitutionalInput {
  /** the 13F module is in this build */
  present: boolean;
  /** its typed reason when it is not */
  absentReason?: string | null;
  /** the closed quarter, or null when none has closed */
  period: string | null;
  /** the newest filing date the build holds */
  latestFiled: string | null;
  /** `instFreshnessText` for the build */
  freshness: string;
  /** notable managers on the curated registry */
  notableManagers: number;
  /** the FULL in-build population for `period`, in `cmpMoves` order */
  moves: readonly NotableMove[];
  leaders: NewPositionLeaders | null;
  /** the build's Congress rows (the quarter join reads them) */
  txns: readonly TxnRow[];
  filerHref: (cik: string) => string;
  filerTier: (cik: string) => FilerBudgetState;
  /** LD11's per-slice bound (the locked fallback is 20) */
  sliceRows?: number;
}

export interface SignalsInstitutional {
  present: boolean;
  absentReason: string | null;
  period: string | null;
  latestFiled: string | null;
  freshness: string;
  notableManagers: number;
  moves: readonly NotableMove[];
  board: ConsensusBoard | null;
  leaders: NewPositionLeaders | null;
  quarter: CongressQuarter | null;
  cards: InstLeadCards;
  /** LD11: the moves the page carries, in population order */
  domSet: readonly NotableMove[];
  /** LD11: the 30 slice totals over the full population */
  totals: Record<string, number>;
  sliceRows: number;
  filerHref: (cik: string) => string;
  filerTier: (cik: string) => FilerBudgetState;
}

/** LD1: everything the tab renders, from the build's inputs. Pure. */
export function buildSignalsInstitutional(i: SignalsInstitutionalInput): SignalsInstitutional {
  const sliceRows = i.sliceRows ?? NAMED_MOVES_SLICE_ROWS;
  const board = i.present && i.period !== null ? consensusBoard(i.period, i.moves, { minFilers: 3, limit: 50 }) : null;
  const cards = instLeadCards(board, i.moves);
  /* every move on a listed Consensus row's key or a card's name is carried,
     so a name filter lists every move on its key (success criterion 5) */
  const nameKeys = new Set<string>(board?.rows.map((r) => r.issuerKey) ?? []);
  if (cards.newStake) nameKeys.add(moveNameKey(cards.newStake));
  if (cards.exit) nameKeys.add(moveNameKey(cards.exit));
  return {
    present: i.present,
    absentReason: i.absentReason ?? null,
    period: i.present ? i.period : null,
    latestFiled: i.latestFiled,
    freshness: i.freshness,
    notableManagers: i.notableManagers,
    moves: i.moves,
    board,
    leaders: i.leaders,
    quarter: i.present ? congressQuarter(i.txns, i.period) : null,
    cards,
    domSet: namedMovesDomSet(i.moves, nameKeys, sliceRows),
    totals: namedMovesSliceTotals(i.moves),
    sliceRows,
    filerHref: i.filerHref,
    filerTier: i.filerTier,
  };
}

/* ---------------------------------------------------------------- the Congress side (LD10) */

const SIDE_NOUN: Readonly<Record<QuarterSide, string>> = { buy: "purchase", sell: "sale" };
const SIDE_ARROW: Readonly<Record<QuarterSide, string>> = { buy: "▲", sell: "▼" };

function plural(n: number, one: string, many: string): string {
  return `${fmtInt(n)} ${n === 1 ? one : many}`;
}

/** What a Congress count of zero means (R13, R24) — the ONE reading every
    Congress-count surface states (a move row's cell and its opened body, a
    Consensus row, the Consensus card, a name's detail): no reviewed ticker;
    no calendar quarter to join; no member at all; or members who are all
    broad accounts (traded more than `BROAD_ACCOUNT_NAMES` names), who are
    named and not counted. `null` when a member is counted on `sides`. A
    surface never says "no member" while a broad account traded the name
    (codex M2 round 2, F2). */
export type CongressAbsence =
  | { kind: "no-ticker" }
  | { kind: "no-quarter" }
  | { kind: "none" }
  | { kind: "broad-only"; broad: readonly MemberLines[] };

export function congressAbsence(q: CongressQuarter | null, ticker: string | null, sides: readonly QuarterSide[]): CongressAbsence | null {
  if (!ticker) return { kind: "no-ticker" };
  if (!q) return { kind: "no-quarter" };
  if (sides.some((side) => quarterMembers(q, ticker, side).length > 0)) return null;
  const broad = new Map<string, MemberLines>();
  for (const side of sides) for (const m of quarterMembers(q, ticker, side, { includeBroad: true })) if (!broad.has(m.key)) broad.set(m.key, m);
  return broad.size > 0 ? { kind: "broad-only", broad: [...broad.values()] } : { kind: "none" };
}

/** The broad accounts as every surface names them: "Name (26 names), …". */
export function broadAccountsText(broad: readonly MemberLines[]): string {
  return broad.map((m) => `${m.name} (${fmtInt(m.breadth)} names)`).join(", ");
}

/** The absence's words for assistive technology beside a "—": `side` for one
    side of a move row, `name` for a name's both sides (a Consensus row). */
export function congressAbsenceText(a: CongressAbsence, scope: "side" | "name"): string {
  switch (a.kind) {
    case "no-ticker":
      return "no reviewed ticker, so no Congress match";
    case "no-quarter":
      return "the quarter is not a calendar quarter, so no Congress line is joined";
    case "none":
      return scope === "side" ? "Congress: none on this side" : "no member of Congress traded it in the quarter";
    case "broad-only":
      return scope === "side"
        ? "Congress: only broad accounts on this side, not counted"
        : `Congress: only broad accounts (${fmtInt(a.broad.length)}) traded it in the quarter, not counted`;
  }
}

/** A zero count's cell: the "—" and its reason. */
function congressAbsenceCellHtml(a: CongressAbsence, scope: "side" | "name"): string {
  return `<span aria-hidden="true">—</span><span class="visually-hidden">${esc(congressAbsenceText(a, scope))}</span>`;
}

/** The Congress column's cell for one side: "▲3" with its words for
    assistive technology, or "—" with the reason (`congressAbsence`). */
function congressCellHtml(q: CongressQuarter | null, ticker: string | null, side: QuarterSide): string {
  /* the words name the column for assistive technology (its head is
     aria-hidden); the quarter is the column tip's, so they do not repeat it */
  const a = congressAbsence(q, ticker, [side]);
  if (a) return congressAbsenceCellHtml(a, "side");
  const n = quarterMembers(q, ticker, side).length;
  return (
    `<span class="cg-on" aria-hidden="true">${SIDE_ARROW[side]}${fmtInt(n)}</span>` +
    `<span class="visually-hidden">Congress: ${plural(n, "member", "members")} with a ${SIDE_NOUN[side]}</span>`
  );
}

/** The bank key of one (ticker, side) — the Congress side a move row or a
    name filter shows. */
function congKey(ticker: string, side: QuarterSide): string {
  return `${normalizeTicker13f(ticker)}|${side}`;
}
function congId(ticker: string, side: QuarterSide): string {
  return `mvc-${slug(normalizeTicker13f(ticker))}-${side}`;
}

/** The broad-only statement of one side — members of Congress traded it, but
    only broad accounts — or null when that is not the side's case. It names
    the accounts, so it is the one Congress side only the server can say. */
function congressBroadHtml(q: CongressQuarter | null, ticker: string | null, side: QuarterSide): string | null {
  const a = congressAbsence(q, ticker, [side]);
  if (!q || !ticker || a?.kind !== "broad-only") return null;
  return (
    `<div class="mv-cong"><p class="mv-cong-none">Only broad accounts — members who traded more than ${fmtInt(BROAD_ACCOUNT_NAMES)} names in ${esc(quarterLabel(q.period) ?? q.period)} — reported a ${SIDE_NOUN[side]} of ${esc(ticker)} traded in the quarter: ` +
    `${esc(broadAccountsText(a.broad))}. They are not counted.</p></div>`
  );
}

/** One side of a move row or a name filter (LD10) from what the row itself
    says — its ticker, its side, the quarter's label and the counted members
    — so the server and the client render it with this one function: the
    stated absence, or the count and a pointer to the side's lines in the
    bank. The client copies the bank's lines in when the row opens (or the
    name applies), so the opened row lists them; without script the pointer
    leads to them. Each (ticker, side) is rendered ONCE, in the bank: a
    popular name's twelve lines are never repeated on each of its moves. */
export function congressSideFor(ticker: string | null, side: QuarterSide, quarter: string | null, n: number): string {
  if (!ticker) return `<div class="mv-cong"><p class="mv-cong-none">No reviewed ticker, so no Congress match.</p></div>`;
  if (quarter === null) return `<div class="mv-cong"><p class="mv-cong-none">The quarter is not a calendar quarter, so no Congress line is joined.</p></div>`;
  if (n === 0) return `<div class="mv-cong"><p class="mv-cong-none">None: no member of Congress reported a listed-stock ${SIDE_NOUN[side]} of ${esc(ticker)} traded in ${esc(quarter)}.</p></div>`;
  return (
    `<div class="mv-cong" data-cong="${esc(congKey(ticker, side))}">` +
    congressHeadHtml(n, ticker, side, quarter) +
    `<p class="mv-cong-link"><a href="#${esc(congId(ticker, side))}">Their lines — range, both dates, receipt — are under “Congress lines behind the counts” ↓</a></p>` +
    `</div>`
  );
}

/** The head line of one side with members: "Congress · 3 members with a
    purchase of NVDA traded in Q1 2026". */
function congressHeadHtml(n: number, ticker: string, side: QuarterSide, quarter: string): string {
  return `<p class="mv-cong-h">Congress · ${plural(n, "member", "members")} with a ${SIDE_NOUN[side]} of ${esc(ticker)} traded in ${esc(quarter)}</p>`;
}

/** The server's side: the broad-only statement where it applies, else the
    shared form over the quarter's counted members. */
function congressSideHtml(q: CongressQuarter | null, ticker: string | null, side: QuarterSide): string {
  return (
    congressBroadHtml(q, ticker, side) ??
    congressSideFor(ticker, side, q ? (quarterLabel(q.period) ?? q.period) : null, ticker && q ? quarterMembers(q, ticker, side).length : 0)
  );
}

/** LD10: the bank — each (ticker, side) the page's moves and names show, with
    members of Congress on it, ONCE: the count, up to `CONGRESS_DETAIL_LINES`
    lines through `congressLineHtml`, the rest on the ticker page, and the
    broad accounts not counted. A closed disclosure at the Named moves' foot,
    reachable without script. */
function congressBankHtml(q: CongressQuarter | null, keys: readonly { ticker: string; side: QuarterSide }[], ctx: RenderCtx): string {
  if (!q) return "";
  const blocks: string[] = [];
  const seen = new Set<string>();
  for (const { ticker, side } of keys) {
    const k = congKey(ticker, side);
    if (seen.has(k)) continue;
    seen.add(k);
    const members = quarterMembers(q, ticker, side);
    if (members.length === 0) continue;
    const broad = quarterMembers(q, ticker, side, { includeBroad: true }).filter((m) => !members.includes(m));
    const rows: TxnRow[] = members.flatMap((m: MemberLines) => m.rows);
    const shown = rows.slice(0, CONGRESS_DETAIL_LINES);
    const more = rows.length - shown.length;
    const href = tickerHrefFor(shown[0]!.ticker ?? ticker, ctx);
    blocks.push(
      `<section class="mv-cong" id="${esc(congId(ticker, side))}" data-cong="${esc(k)}">` +
        congressHeadHtml(members.length, ticker, side, quarterLabel(q.period) ?? q.period) +
        `<ul class="cl-list">${shown.map((t) => congressLineHtml(t, ctx)).join("")}</ul>` +
        (more > 0 ? `<p class="mv-cong-more"><a href="${esc(href)}">${plural(more, "more line", "more lines")} on the ticker page ↗</a></p>` : "") +
        (broad.length > 0 ? `<p class="mv-cong-none">Not counted, broad accounts: ${esc(broadAccountsText(broad))}.</p>` : "") +
        `</section>`,
    );
  }
  if (blocks.length === 0) return "";
  return (
    `<details class="mv-bank" id="mv-bank"><summary>Congress lines behind the counts · ${plural(blocks.length, "name and side", "names and sides")}</summary>` +
    blocks.join("") +
    `</details>`
  );
}

/* ---------------------------------------------------------------- Named moves (LD11) */

/** A move row's anchor: `mv-{n}`, `n` its place in the build's population —
    unique, and the same on every render of one build. */
function moveIds(model: Pick<SignalsInstitutional, "moves" | "domSet">): string[] {
  const at = new Map<NotableMove, number>();
  model.moves.forEach((m, i) => at.set(m, i));
  return model.domSet.map((m, i) => `mv-${at.get(m) ?? `d${i}`}`);
}

const TYPE_ONE: Readonly<Record<ManagerType, string>> = {
  hedge_fund: "Hedge fund",
  asset_manager: "Asset manager",
  pension_swf: "Pension / SWF",
  bank: "Bank",
  alt_manager: "Alternatives",
  insurer: "Insurer",
  family_office: "Family office",
  foundation: "Foundation",
};

/** What an opened move row says beyond its summary (LD11, LD22-9) — the
    manager type, the filing and the quarter, the ticker's verification, the
    filer page, the Congress side — as data the row and its section carry. */
export interface MoveDetail {
  type: string;
  kind: NotableMove["kind"];
  filed: string | null;
  /** the quarter end */
  period: string;
  /** "Q1 2026", or null when the period is not a calendar quarter */
  quarter: string | null;
  ticker: string | null;
  verified: string | null;
  filerPage: string;
  /** members of Congress counted on the row's side */
  congress: number;
}

/** The opened row's body from `MoveDetail`. ONE renderer: the server renders
    the first `NAMED_MOVES_MIN` rows' (all a reader without script can show
    and open), and the client renders a held row's on its first opening, from
    the row's own data (LD11's byte budget: a held row carries its filer page
    and, where they differ from the section's, its verification date and
    Congress count, never the body's sentences). */
export function moveDetailHtml(d: MoveDetail): string {
  return moveFactsHtml(d) + congressSideFor(d.ticker, moveSide(d.kind), d.quarter, d.congress);
}

/** The body's facts: everything but its Congress side. */
function moveFactsHtml(d: MoveDetail): string {
  return (
    `<div class="mv-facts">` +
    `<p>${esc(TYPE_ONE[d.type as ManagerType] ?? d.type)} · filed ${d.filed ? `<time datetime="${esc(d.filed)}">${esc(d.filed)}</time>` : "date not stated"} · quarter ended ${esc(d.period)}${d.kind === "exit" ? " · exit inferred from absence" : ""}</p>` +
    (d.ticker ? `<p><span class="mono-ticker">${esc(d.ticker)}</span> — verified against the SEC company list${d.verified ? ` on ${esc(d.verified)}` : ""}</p>` : "") +
    `<p><a href="${esc(d.filerPage)}">This position on the filer page ↗</a></p>` +
    `</div>`
  );
}

/** LD11: one Named move — a `<details>` whose summary is the row (manager,
    ticker and issuer, kind, Δ shares, now $, Δ $, Congress, filed) and whose
    body is `moveDetailHtml`. The 13F receipt is outside the summary, laid over
    its reserved cell (as LD4's row). A HELD row (`hidden`, past the first
    `NAMED_MOVES_MIN`) renders its body empty, with `data-fp` (the filer page),
    `data-tv` (its verification date, only where it is not the section's
    `data-mv-tv`) and `data-cg` (its counted Congress members, only when some
    are): the client fills the body from them on the row's first opening. A
    held row whose side only broad accounts traded keeps its body, since that
    statement names the accounts. */
export function moveRowHtml(
  m: NotableMove,
  id: string,
  model: Pick<SignalsInstitutional, "period" | "quarter" | "filerHref">,
  hidden = false,
  tvDefault: string | null = null,
): string {
  const side = moveSide(m.kind);
  const dir = m.delta_value == null ? "c-muted" : m.delta_value < 0 ? "c-sell" : "c-buy";
  const filerPage = `${model.filerHref(m.cik)}#${positionAnchor(m.key)}`;
  const q = model.quarter;
  const counted = m.ticker && q ? quarterMembers(q, m.ticker, side).length : 0;
  const broad = congressBroadHtml(q, m.ticker, side);
  /* lean by design (LD11's byte budget): the receipt's cell is the grid's
     last track, left empty for the receipt laid over it; a name no reviewed
     ticker maps says so once, in its Congress side */
  const summary =
    `<summary class="mv-sum">` +
    `<span class="mv-mgr">${esc(m.manager)}${m.principal ? ` <span class="mv-p">(${esc(m.principal)})</span>` : ""}</span>` +
    `<span class="mv-tk">${m.ticker ? `<span class="mono-ticker">${esc(m.ticker)}</span> ` : ""}<span class="filed-name mv-iss">${esc(m.issuer)}</span></span>` +
    `<span class="mv-k qoq-chip ${kindWord(m.kind).cls}">${esc(kindWord(m.kind).word)}</span>` +
    `<span class="mv-dsh">${esc(signedShares(m.delta_shares))}<span class="visually-hidden"> shares</span></span>` +
    `<span class="mv-now">${m.curr_value == null ? "—" : esc(fmtUsd(m.curr_value))}<span class="visually-hidden"> now</span></span>` +
    `<span class="mv-dv ${dir}">${esc(signedUsd(m.delta_value))}</span>` +
    `<span class="mv-cg">${congressCellHtml(q, m.ticker, side)}</span>` +
    `<span class="mv-fil"><span class="visually-hidden">filed </span>${m.filed ? `<time datetime="${esc(m.filed)}">${esc(m.filed)}</time>` : "date not stated"}</span>` +
    `</summary>`;
  const lean = hidden && broad === null;
  const d: MoveDetail = {
    type: m.type, kind: m.kind, filed: m.filed, period: model.period ?? "—", quarter: q ? (quarterLabel(q.period) ?? q.period) : null,
    ticker: m.ticker, verified: m.ticker_verified, filerPage, congress: counted,
  };
  const detail = `<div class="mv-det">${lean ? "" : broad === null ? moveDetailHtml(d) : moveFactsHtml(d) + broad}</div>`;
  const held = lean
    ? ` data-fp="${esc(filerPage)}"${m.ticker && m.ticker_verified !== tvDefault ? ` data-tv="${esc(m.ticker_verified ?? "")}"` : ""}${counted > 0 ? ` data-cg="${counted}"` : ""}`
    : "";
  return (
    `<article class="mv-item" id="${esc(id)}" data-kind="${m.kind}" data-type="${esc(m.type)}" data-ikey="${esc(moveNameKey(m))}"${held}${hidden ? " hidden" : ""}>` +
    `<details class="mv-row" name="mv-rows">${summary}${detail}</details>` +
    (m.doc ? `<a class="mv-src" href="${esc(m.doc)}" rel="noopener" target="_blank">13F ↗</a>` : `<span class="mv-src c-muted">13F —</span>`) +
    `</article>`
  );
}

/** The verification date most of the carried rows share — the section's
    `data-mv-tv`, which a held row's `data-tv` overrides. */
function commonVerified(moves: readonly NotableMove[]): string | null {
  const n = new Map<string, number>();
  for (const m of moves) if (m.ticker && m.ticker_verified) n.set(m.ticker_verified, (n.get(m.ticker_verified) ?? 0) + 1);
  let best: string | null = null;
  for (const [v, c] of n) if (best === null || c > n.get(best)! || (c === n.get(best)! && v < best)) best = v;
  return best;
}

const KIND_CHIP: Readonly<Record<string, string>> = { new: "New", exit: "Exits", add: "Adds", trim: "Trims" };
const TYPE_CHIP: Readonly<Record<string, string>> = { hedge_fund: "Hedge funds", family_office: "Family offices", asset_manager: "Asset managers", insurer: "Insurers", alt_manager: "Alternatives" };

/** LD11: the 30 slice totals as the Named moves carry them — a flat
    "{kind}|{type}:{count}" list, one per slice, space-separated (no quotes,
    so the attribute needs no entity escaping to be read back). */
export function namedMovesTotalsAttr(totals: Readonly<Record<string, number>>): string {
  return Object.entries(totals)
    .map(([k, n]) => `${k}:${n}`)
    .join(" ");
}

/** The reader of `namedMovesTotalsAttr` (the client's, and the tests'). */
export function parseNamedMovesTotals(attr: string | null | undefined): Record<string, number> {
  const out: Record<string, number> = {};
  for (const part of String(attr ?? "").split(/\s+/)) {
    const at = part.lastIndexOf(":");
    if (at <= 0) continue;
    const n = Number(part.slice(at + 1));
    if (Number.isFinite(n)) out[part.slice(0, at)] = n;
  }
  return out;
}

/** The count line — `rangeOfTotal` over the TRUE in-build total for the
    filter (LD11). */
export function namedMovesRangeText(shown: number, total: number): string {
  return rangeOfTotal(1, shown, total, "moves");
}

/** LD11: the page's own bound, stated where the DOM runs out before the total. */
export function namedMovesBoundText(n: number): string {
  return `This page carries the first ${fmtInt(n)} for this filter; each manager's filer page lists all of its moves.`;
}

/** The detail a name filter shows above its moves (LD10's "Consensus
    detail"): both sides' Congress lines for that name. One per listed
    Consensus row and lead-card name with a ticker; `hidden` until the client
    applies that name. */
function nameDetailHtml(key: string, ticker: string | null, label: string, model: SignalsInstitutional): string {
  return (
    `<div class="mv-name-detail" data-mv-detail-for="${esc(key)}" hidden>` +
    `<p class="mv-cong-h">${esc(label)} — Congress in ${esc(quarterLabel(model.period) ?? model.period ?? "the quarter")}, both sides</p>` +
    `<div class="mv-name-sides">` +
    congressSideHtml(model.quarter, ticker, "buy") +
    congressSideHtml(model.quarter, ticker, "sell") +
    `</div></div>`
  );
}

function namedMovesHtml(model: SignalsInstitutional, ctx: RenderCtx): string {
  const period = model.period;
  const tip = noteFromHtml(
    `<span class="si-tip-p">Notable managers' position changes in the quarter ended ${esc(period ?? "—")}, largest dollar change first within New › Exit › Add › Trim. ` +
      `Classified by share count between the two quarters; a dollar change alone is not a position change. Exit is inferred from absence in the next filing. ` +
      `Tickers appear only where the reviewed mapping names one.</span>` +
      `<span class="si-tip-p">Every count is the build's whole population for the filter (${plural(model.moves.length, "change", "changes")} this quarter). ` +
      `This page carries the first ${fmtInt(model.sliceRows)} for each filter and every change on a Consensus or lead-card name; each manager's filer page lists all of its moves.</span>` +
      `<span class="si-tip-p">Open a row for its Congress side and its filer page; choose a Consensus row or a card to list every change on that name.</span>`,
    { scope: "signals-inst-moves" },
    "about",
    { trigger: "mark", name: "About named moves" },
  );
  const head = `<div class="panel-head"><h2 class="section-h" id="named-moves-h">Named moves</h2>${tip}</div>`;
  if (model.moves.length === 0) {
    return (
      `<section class="panel sig-moves" id="named-moves" aria-labelledby="named-moves-h" data-empty-state>` +
      head +
      `<p class="section-note">${
        model.notableManagers === 0
          ? `This build's manager registry marks no notable manager, so no position change is named for the quarter ended ${esc(period ?? "—")}. Zero is the computed answer.`
          : `No notable-manager position change is on record for the quarter ended ${esc(period ?? "—")}. Zero is the computed answer.`
      }</p></section>`
    );
  }
  const ids = moveIds(model);
  const shown = Math.min(NAMED_MOVES_MIN, model.domSet.length);
  const total = model.moves.length;
  const tvDefault = commonVerified(model.domSet);
  const rows = model.domSet.map((m, i) => moveRowHtml(m, ids[i]!, model, i >= shown, tvDefault)).join("\n");
  const chip = (attr: string, value: string, label: string): string =>
    `<button type="button" ${attr}="${esc(value)}" aria-pressed="false">${esc(label)}</button>`;
  /* the name filter's Congress detail, one per name a control can apply */
  const named = new Map<string, { ticker: string | null; label: string }>();
  for (const r of model.board?.rows ?? []) named.set(r.issuerKey, { ticker: r.ticker, label: consensusRowLabel(r) });
  for (const m of [model.cards.newStake, model.cards.exit]) {
    if (m && !named.has(moveNameKey(m))) named.set(moveNameKey(m), { ticker: m.ticker, label: m.ticker ? `${m.ticker} ${m.issuer}` : m.issuer });
  }
  const withTicker = [...named].filter(([, v]) => v.ticker !== null);
  const details = withTicker.map(([k, v]) => nameDetailHtml(k, v.ticker, v.label, model)).join("");
  /* the bank: every (ticker, side) a row or a name shows, once */
  const bankKeys: { ticker: string; side: QuarterSide }[] = [];
  for (const m of model.domSet) if (m.ticker) bankKeys.push({ ticker: m.ticker, side: moveSide(m.kind) });
  for (const [, v] of withTicker) for (const side of ["buy", "sell"] as const) bankKeys.push({ ticker: v.ticker!, side });
  const bank = congressBankHtml(model.quarter, bankKeys, ctx);
  const cgTip = note(
    `Members of Congress with a listed-stock purchase (beside a new stake or an add) or sale (beside a trim or an exit) of the same ticker, ` +
      `traded inside the quarter${model.quarter ? ` (${model.quarter.start} → ${model.quarter.end})` : ""} and filed at any date, each counted once. ` +
      `Broad accounts — members who traded more than ${BROAD_ACCOUNT_NAMES} names in the quarter — are not counted` +
      (model.quarter && model.quarter.broad.length > 0 ? `: ${model.quarter.broad.map((b) => `${b.name} (${b.breadth})`).join(", ")}` : "") +
      `. Tickers compare in the SEC spelling, so BRK.B meets BRK-B. A co-occurrence in public filings, never coordination.`,
    { scope: "signals-inst-moves" },
    "congress",
    { trigger: "mark", name: "About the Congress column" },
  );
  const boundShown = shown === model.domSet.length && model.domSet.length < total;
  return (
    `<section class="panel sig-moves" id="named-moves" aria-labelledby="named-moves-h" data-mv-period="${esc(period ?? "")}"` +
    (model.quarter ? ` data-mv-q="${esc(quarterLabel(model.quarter.period) ?? model.quarter.period)}"` : "") +
    (tvDefault ? ` data-mv-tv="${esc(tvDefault)}"` : "") +
    ` data-mv-totals="${esc(namedMovesTotalsAttr(model.totals))}" data-mv-min="${NAMED_MOVES_MIN}" data-mv-step="${NAMED_MOVES_STEP}" data-mv-total="${total}">` +
    head +
    `<p class="si-pill-row" id="mv-name-row" hidden><button type="button" class="si-pill" id="mv-name-pill">Name: <span id="mv-name-label"></span> <span aria-hidden="true">×</span><span class="visually-hidden">, remove the name filter</span></button></p>` +
    details +
    /* the chip groups are the site's segmented groups (`.chips`: the G12 hit
       size comes with them); at the fold their row scrolls sideways inside
       its ROLE-LESS wrapper, a named region only while it overflows (LD8) */
    `<div class="mv-chips" data-scroll-region="Change filters · scroll sideways">` +
    `<div class="chips" role="group" aria-label="Kind of change">${NAMED_MOVE_KINDS.map((k) => chip("data-mv-kind", k, KIND_CHIP[k]!)).join("")}</div>` +
    `<div class="chips" role="group" aria-label="Manager type">${NAMED_MOVE_TYPES.map((t) => chip("data-mv-type", t, TYPE_CHIP[t] ?? MANAGER_TYPE_LABELS[t])).join("")}</div>` +
    `</div>` +
    `<div class="mv-head">` +
    `<span class="mv-hc" aria-hidden="true">Manager</span><span class="mv-hc" aria-hidden="true">Ticker · issuer</span><span class="mv-hc" aria-hidden="true">Change</span>` +
    `<span class="mv-hc mv-hc-r" aria-hidden="true">Δ shares</span><span class="mv-hc mv-hc-r" aria-hidden="true">Now</span><span class="mv-hc mv-hc-r" aria-hidden="true">Δ $</span>` +
    `<span class="mv-hc mv-hc-r mv-hc-cg"><span aria-hidden="true">Cong</span>${cgTip}</span>` +
    `<span class="mv-hc mv-hc-r" aria-hidden="true">Filed</span>` +
    `</div>` +
    `<div class="mv-list" id="mv-list">${rows}</div>` +
    `<p class="section-note" id="mv-empty" hidden>Nothing in this quarter matches this filter — a computed answer over the whole population.</p>` +
    `<div class="feed-foot"><div class="pager">` +
    `<span class="pager-range" id="mv-range" tabindex="-1">${esc(namedMovesRangeText(shown, total))}</span>` +
    `<button type="button" class="pager-btn${shown < model.domSet.length ? "" : " is-unavailable"}" id="mv-more" aria-disabled="${shown < model.domSet.length ? "false" : "true"}">Show ${fmtInt(NAMED_MOVES_STEP)} more</button>` +
    `</div></div>` +
    `<p class="section-note mv-bound" id="mv-bound"${boundShown ? "" : " hidden"}>${esc(namedMovesBoundText(model.domSet.length))}</p>` +
    bank +
    `<p class="visually-hidden" id="mv-status" role="status" aria-live="polite"></p>` +
    `<noscript><p class="section-note">Filtering and paging need JavaScript; ${plural(total, "change is", "changes are")} in this quarter.</p></noscript>` +
    `</section>`
  );
}

/* ---------------------------------------------------------------- Consensus (LD12) */

/** LD12: Consensus — the board's first `CONSENSUS_COMPACT_ROWS` rows, the rest
    one "Show all" away; each row a control that filters the Named moves to
    its issuer key; the Congress column on its second line. The count stays
    visible; the count note, the exclusions and "#n" are its tip. */
export function consensusPanelHtml(board: ConsensusBoard | null, q: CongressQuarter | null): string {
  const tipBody = board
    ? `<span class="si-tip-p">Issuers at least ${fmtInt(board.minFilers)} notable managers changed in the quarter ended ${esc(board.period)}, ranked by new stakes, then by net $. ` +
      `Counts are distinct notable managers · ≈ = a contributing change disclosed no value, so the sum is partial.` +
      (board.qualifying > board.rows.length ? ` The ${fmtInt(board.rows.length)} highest-ranked are listed.` : "") +
      (board.rows.some((r) => r.disambiguator) ? ` #n tells apart issuers filed under one name: the order of their stable issuer keys.` : "") +
      ` ${esc(consensusExclusionText(board))}</span>` +
      `<span class="si-tip-p">Choose a row to list every change on that name in the Named moves. ▲ / ▼ = members of Congress with a purchase / a sale of it traded in the quarter, broad accounts not counted; a name only broad accounts traded says so.</span>`
    : `<span class="si-tip-p">Issuers several notable managers changed in one closed quarter. This build has no closed quarter to group over.</span>`;
  const tip = noteFromHtml(tipBody, { scope: "signals-inst-consensus" }, "about", { trigger: "mark", name: "About consensus" });
  const head = `<div class="panel-head"><h2 class="section-h" id="consensus-h">Consensus</h2>${tip}</div>`;
  if (board === null || board.rows.length === 0) {
    return (
      `<section class="panel sig-cons" id="consensus" aria-labelledby="consensus-h" data-empty-state>` +
      head +
      `<p class="section-note">${
        board
          ? `No issuer was moved by ${fmtInt(board.minFilers)} or more notable managers in the quarter ended ${esc(board.period)}. Absence is stated, never simulated. ${esc(consensusExclusionText(board))}`
          : "No closed quarter is available to group over yet."
      }</p></section>`
    );
  }
  const rows = board.rows
    .map((r, i) => {
      const id = `cs-${i + 1}`;
      const b = quarterMembers(q, r.ticker, "buy").length;
      const s = quarterMembers(q, r.ticker, "sell").length;
      /* both sides; a zero states WHY (`congressAbsence`): never "no member"
         while a broad account traded it */
      const absent = congressAbsence(q, r.ticker, ["buy", "sell"]);
      const cg = absent
        ? congressAbsenceCellHtml(absent, "name")
        : `<span class="cg-on" aria-hidden="true">${b > 0 ? `▲${fmtInt(b)}` : ""}${b > 0 && s > 0 ? " " : ""}${s > 0 ? `▼${fmtInt(s)}` : ""}</span>` +
            `<span class="visually-hidden">Congress in the quarter: ${plural(b, "member", "members")} with a purchase, ${plural(s, "member", "members")} with a sale</span>`;
      const net = `${esc(signedUsd(r.netDeltaUsd))}${r.netDeltaPartial ? `<span class="hang">≈</span>` : ""}`;
      return (
        `<div class="cs-row" data-ikey="${esc(r.issuerKey)}"${i >= CONSENSUS_COMPACT_ROWS ? " data-compact-extra" : ""}>` +
        `<button type="button" class="cs-pick" data-mv-name="${esc(r.issuerKey)}" aria-pressed="false" aria-labelledby="${r.ticker ? `${id}-t ` : ""}${id}-l ${id}-h"></button>` +
        `<span class="cs-tk mono-ticker"${r.ticker ? ` id="${id}-t"` : ""}>${esc(r.ticker ?? "—")}</span>` +
        `<span class="cs-iss" id="${id}-l"><span class="filed-name">${esc(r.issuer)}</span>${r.disambiguator ? ` <span class="c-muted">${esc(r.disambiguator)}</span>` : ""}</span>` +
        `<span class="cs-n cs-strong">${fmtInt(r.newStakes)}</span><span class="cs-a">${fmtInt(r.adds)}</span><span class="cs-t">${fmtInt(r.trims)}</span><span class="cs-x">${fmtInt(r.exits)}</span>` +
        `<span class="cs-net ${r.netDeltaUsd == null ? "c-muted" : r.netDeltaUsd < 0 ? "c-sell" : "c-buy"}">${net}</span>` +
        `<span class="cs-top">${r.topMover ? `${esc(r.topMover.manager)} ${kindWordHtml(r.topMover.kind)}` : "—"}</span>` +
        `<span class="cs-cg">${cg}</span>` +
        `<span class="visually-hidden" id="${id}-h">: ${plural(r.newStakes, "new stake", "new stakes")}. Filter the moves to it.</span>` +
        `</div>`
      );
    })
    .join("\n");
  return (
    `<section class="panel sig-cons" id="consensus" aria-labelledby="consensus-h">` +
    head +
    `<p class="section-note cs-count">${plural(board.qualifying, "issuer qualifies", "issuers qualify")}</p>` +
    `<div class="cs-head" aria-hidden="true"><span>Ticker</span><span>Issuer</span><span class="cs-hr">New</span><span class="cs-hr">Add</span><span class="cs-hr">Trim</span><span class="cs-hr">Exit</span><span class="cs-hr">Net $</span><span class="cs-hr cs-hcg">Cong</span></div>` +
    `<div class="cs-list" id="consensus-list"${board.rows.length > CONSENSUS_COMPACT_ROWS ? ' data-collapsed="true"' : ""}>${rows}</div>` +
    compactDisclosure({
      rootId: "consensus-list",
      total: board.rows.length,
      shown: Math.min(CONSENSUS_COMPACT_ROWS, board.rows.length),
      noun: "issuers",
      ...consensusBoundNoun(board),
      domBacked: true,
    }) +
    `</section>`
  );
}

/* ---------------------------------------------------------------- the new-position leaders (LD12) */

/** LD12: the new-position leaders — each row's filer, its largest new
    position's weight and, on its second line, WHICH position that is:
    "Largest new: {TICKER} {issuer} · {value} · {pct}% of book", or the stated
    absence when the aggregate names no issuer for it. The rule and the counts
    are the tip; the qualifying count stays visible. */
export function convictionLeadersHtml(leaders: NewPositionLeaders | null, tierOf: (cik: string) => FilerBudgetState, period: string | null): string {
  const tip = noteFromHtml(
    leaders
      ? `<span class="si-tip-p">${esc(convictionRuleText(leaders))}.</span><span class="si-tip-p">${esc(convictionCountsText(leaders))}.</span>` +
          `<span class="si-tip-p">Each row names its largest new position. No returns are computed.</span>`
      : `<span class="si-tip-p">Notable managers ranked by their largest new position's share of a complete book. This needs the institutional module and a closed quarter.</span>`,
    { scope: "signals-inst-leaders" },
    "about",
    { trigger: "mark", name: "About new-position leaders" },
  );
  const context = `New stakes ≥${leaders ? (leaders.thresholdBps / 100).toFixed(0) : "2"}% of book${period ? ` · ${period}` : ""}`;
  /* the anchor is `#new-position-leaders`, never the label's word: the §0
     gate reads the page's raw bytes, ids and ARIA references included */
  const head = `<div class="panel-head"><h2 class="section-h" id="new-position-leaders-h">${CONVICTION_LABEL_HTML}</h2>${tip}</div>`;
  const open = (empty: boolean): string => `<section class="panel sig-conv" id="new-position-leaders" aria-labelledby="new-position-leaders-h"${empty ? " data-empty-state" : ""}>`;
  if (leaders === null) {
    return open(true) + head + `<p class="section-note">New-position weights are not available in this build: they need the institutional module and a closed quarter.</p></section>`;
  }
  if (leaders.rows.length === 0) {
    /* R26: a COMPUTED zero is an answer, never "not available in this build" */
    return (
      open(true) +
      head +
      `<p class="section-note">No filer qualifies in ${esc(leaders.period)}. ${esc(convictionRuleText(leaders))}. ${esc(convictionCountsText(leaders))}.` +
      (leaders.notableManagers === 0 ? ` This build's manager registry marks no notable manager, so no filer is eligible.` : "") +
      ` Zero is the computed answer.</p></section>`
    );
  }
  const max = Math.max(1, ...leaders.rows.map((r) => r.maxWeightBps));
  const rows = leaders.rows
    .map(
      (r, i) =>
        `<li class="cv-row">` +
        `<span class="cv-rk">${i + 1}</span>` +
        `<span class="cv-fl">${filerLinkHtml(r.cik, r.filerName, tierOf(r.cik))}</span>` +
        `<span class="cv-bar" aria-hidden="true"><span style="width:${((r.maxWeightBps / max) * 100).toFixed(1)}%"></span></span>` +
        `<span class="cv-pc">${(r.maxWeightBps / 100).toFixed(1)}%<span class="visually-hidden"> of book, the largest new position</span></span>` +
        `<span class="cv-top">${r.largest && r.largest.issuer !== null ? `Largest new: ${r.largest.ticker ? `<span class="mono-ticker">${esc(r.largest.ticker)}</span> ` : ""}<span class="filed-name">${esc(r.largest.issuer)}</span> · ${esc(fmtUsd(r.largest.valueUsd))} · ${(r.largest.weightBps / 100).toFixed(1)}% of book` : "Largest new position not named in this aggregate"}</span>` +
        `<span class="cv-rt">${fmtInt(r.atThreshold)}<span class="visually-hidden"> at or above ${(leaders.thresholdBps / 100).toFixed(0)}%</span> / ${fmtInt(r.newPositions)}<span class="visually-hidden"> new positions</span></span>` +
        `</li>`,
    )
    .join("");
  return (
    open(false) +
    head +
    `<p class="section-note cv-count">${esc(context)} · ${plural(leaders.qualifying, "filer qualifies", "filers qualify")}</p>` +
    `<ol class="cv-list">${rows}</ol>` +
    `</section>`
  );
}

/* ---------------------------------------------------------------- the lead cards (LD13) */

function cardOpenHtml(key: string, label: string): string {
  return `<a class="si-card-open" href="#named-moves" data-mv-name="${esc(key)}"><span class="visually-hidden">Filter the moves to ${esc(label)}</span></a>`;
}

function consensusCardHtml(r: ConsensusRow | null, model: SignalsInstitutional): string {
  const period = model.period ?? "—";
  if (!r) return `<p class="section-note" data-empty-state>— no issuer was moved by 3 or more notable managers in the quarter ended ${esc(period)}.</p>`;
  const b = quarterMembers(model.quarter, r.ticker, "buy").length;
  const s = quarterMembers(model.quarter, r.ticker, "sell").length;
  const absent = congressAbsence(model.quarter, r.ticker, ["buy", "sell"]);
  return (
    cardOpenHtml(r.issuerKey, consensusRowLabel(r)) +
    `<h3 class="si-card-h"><span class="mono-ticker">${esc(r.ticker ?? "no ticker")}</span> <span class="si-card-amt">${esc(signedUsd(r.netDeltaUsd))}${r.netDeltaPartial ? "≈" : ""}<span class="visually-hidden"> net</span></span></h3>` +
    `<p class="si-card-who"><span class="filed-name">${esc(r.issuer)}</span>${r.disambiguator ? ` ${esc(r.disambiguator)}` : ""}</p>` +
    `<p class="si-card-fact">${fmtInt(r.newStakes)} new · ${fmtInt(r.adds)} add · ${fmtInt(r.trims)} trim · ${fmtInt(r.exits)} exit</p>` +
    `<p class="si-card-dates">quarter ended ${esc(period)} · Congress same quarter ` +
    (absent === null || absent.kind === "none" || absent.kind === "broad-only"
      ? `<span aria-hidden="true">▲${fmtInt(b)} ▼${fmtInt(s)}</span><span class="visually-hidden">${plural(b, "member", "members")} with a purchase, ${plural(s, "member", "members")} with a sale</span>` +
        /* ▲0 ▼0 never reads as "none" when broad accounts traded it: they are named, not counted */
        (absent?.kind === "broad-only" ? ` · only broad accounts traded it, not counted: ${esc(broadAccountsText(absent.broad))}` : "")
      : congressAbsenceCellHtml(absent, "name")) +
    `</p>` +
    `<p class="si-card-src">${plural(r.filers, "filing", "filings")} — see the moves</p>`
  );
}

function moveCardHtml(m: NotableMove | null, kind: "new" | "exit", model: SignalsInstitutional): string {
  const period = model.period ?? "—";
  if (!m) return `<p class="section-note" data-empty-state>— no ${kind === "new" ? "new stake" : "exit"} in the quarter ended ${esc(period)}.</p>`;
  const label = m.ticker ? `${m.ticker} ${m.issuer}` : m.issuer;
  return (
    cardOpenHtml(moveNameKey(m), label) +
    `<h3 class="si-card-h"><span class="mono-ticker">${esc(m.ticker ?? "no ticker")}</span> ${kindWordHtml(m.kind)} <span class="si-card-amt">${esc(signedUsd(m.delta_value))}</span></h3>` +
    `<p class="si-card-who"><a href="${esc(`${model.filerHref(m.cik)}#${positionAnchor(m.key)}`)}">${esc(m.manager)}</a> · <span class="filed-name">${esc(m.issuer)}</span></p>` +
    `<p class="si-card-fact">${esc(signedShares(m.delta_shares))} shares · ${kind === "exit" ? "exit inferred from absence" : `now ${m.curr_value == null ? "—" : esc(fmtUsd(m.curr_value))}`}</p>` +
    `<p class="si-card-dates">${esc(TYPE_ONE[m.type] ?? m.type)} · filed ${m.filed ? `<time datetime="${esc(m.filed)}">${esc(m.filed)}</time>` : "date not stated"} · quarter ended ${esc(period)}</p>` +
    `<div class="si-card-src">${m.doc ? `<a href="${esc(m.doc)}" rel="noopener" target="_blank">13F ↗</a>` : `<span class="c-muted">13F —</span>`}</div>`
  );
}

function instCardsHtml(model: SignalsInstitutional): string {
  const tip = note(
    `Notable managers only (${fmtInt(model.notableManagers)}, a curated registry), quarter ended ${model.period ?? "—"}. ` +
      `The Consensus card is an aggregate of many filings, so it carries no single receipt; the new-stake and exit cards carry their 13F receipt. ` +
      `Choose a card to list every change on that name in the Named moves.`,
    { scope: "signals-inst-lead" },
    "about",
    { trigger: "mark", name: "About these cards" },
  );
  return (
    `<section class="si-lead" id="inst-lead-cards" aria-labelledby="inst-lead-cards-h">` +
    `<div class="panel-head si-lead-head"><h2 class="section-h" id="inst-lead-cards-h">Lead cards</h2>${tip}</div>` +
    `<div class="si-cards" data-scroll-region="Institutional lead cards · swipe for more">` +
    `<article class="si-card" data-card="consensus" data-tone="amber"><div class="si-card-tag">Consensus · most new stakes</div>${consensusCardHtml(model.cards.consensus, model)}</article>` +
    `<article class="si-card" data-card="new" data-tone="green"><div class="si-card-tag">Largest new stake</div>${moveCardHtml(model.cards.newStake, "new", model)}</article>` +
    `<article class="si-card" data-card="exit" data-tone="red"><div class="si-card-tag">Largest exit</div>${moveCardHtml(model.cards.exit, "exit", model)}</article>` +
    `</div>` +
    `</section>`
  );
}

/* ---------------------------------------------------------------- the provenance line (R16) */

/** R16: the closed quarter and the newest filing the build holds (amber),
    with every 13F snapshot caveat in its tip. */
function provenanceHtml(model: SignalsInstitutional): string {
  const label = quarterLabel(model.period);
  const tip = noteFromHtml(
    `<span class="si-tip-p">Every institutional figure on this tab is a snapshot of the quarter ended ${esc(model.period ?? "—")}: positions at quarter end, long only, ` +
      `filed up to 45 days after the quarter — never current holdings. An exit is inferred from absence in the next filing.</span>` +
      `<span class="si-tip-p">${esc(model.freshness)} The newest closed quarter is ${esc(model.period ?? "not yet available")}.</span>` +
      `<span class="si-tip-p">Notable managers only: ${fmtInt(model.notableManagers)} on a curated registry. <a href="/methodology/#13f-method">How 13F data is read ↗</a></span>`,
    { scope: "signals-inst-prov" },
    "about",
    { trigger: "mark", name: "About this 13F data" },
  );
  return (
    `<div class="sig-prov">` +
    `<span class="sig-pchip">13F · ${model.period ? `${esc(label ?? model.period)} · quarter ended ${esc(model.period)}` : "no closed quarter yet"}</span>` +
    `<span class="sig-pchip sig-pchip-warn">${model.latestFiled ? `Filings through ${esc(model.latestFiled)}` : "Newest filing date not available"}</span>` +
    tip +
    `</div>`
  );
}

/* ---------------------------------------------------------------- the ledger group (LD9) */

/** LD9: the Institutional tab's three figures — Moves, Top add, Quarter. */
export function institutionalLedgerItems(model: SignalsInstitutional | null): LedgerItem[] {
  if (model === null || !model.present) {
    const why = model === null ? "not computed in this view" : "13F module not in this build";
    return [
      { label: "Moves", value: "—", detail: why, subKind: "absence", tone: "blue" },
      { label: "Top add", value: "—", detail: why, subKind: "absence", tone: "blue" },
      { label: "Quarter", value: "—", detail: why, subKind: "absence" },
    ];
  }
  return [
    { label: "Moves", value: fmtInt(model.moves.length), detail: `${fmtInt(model.notableManagers)} notable managers`, subKind: "count", tone: "blue" },
    consensusAddLedgerItem(model.board?.rows[0] ?? null, model.period, model.board?.wrappersExcluded ?? 0),
    model.period
      ? { label: "Quarter", value: quarterLabel(model.period) ?? model.period, detail: `closed · filings to ${model.latestFiled ?? "—"}`, subKind: "date" }
      : { label: "Quarter", value: "—", detail: "no closed quarter yet", subKind: "absence" },
  ];
}

export function institutionalLedgerHtml(model: SignalsInstitutional | null): string {
  return disclosureLedger(institutionalLedgerItems(model), { scope: "signals-inst-ledger" });
}

/* ---------------------------------------------------------------- the panel */

/** The Institutional tabpanel's content (the panel element is the page's,
    `signalsBody`). `null` is the artifact-only view: the tab states that it
    is computed on the server. */
export function signalsInstitutionalHtml(model: SignalsInstitutional | null, ctx: RenderCtx): string {
  if (model === null) {
    return `<p class="section-note" data-empty-state>The Institutional tab is computed on the server from the build's 13F data; this view carries the Congress artifact only.</p>`;
  }
  if (!model.present) {
    return `<p class="section-note" data-empty-state>The institutional 13F module is not in this build (${esc(model.absentReason ?? "module-absent")}) — absence is stated, not simulated.</p>`;
  }
  if (model.period === null) {
    return (
      provenanceHtml(model) +
      `<p class="section-note" data-empty-state>No 13F quarter in this build has passed its 45-day filing deadline yet, so there is no closed quarter to read. That is a statement about the calendar, not an absence of data.</p>`
    );
  }
  const side =
    `<div class="sig-inst-side" id="inst-side">` +
    consensusPanelHtml(model.board, model.quarter) +
    convictionLeadersHtml(model.leaders, model.filerTier, model.period) +
    `</div>`;
  return (
    provenanceHtml(model) +
    instCardsHtml(model) +
    /* LD7: where the band stacks (≤1080px) the client shows ONE pane at a time */
    paneSwitchHtml([
      { id: "named-moves", label: "Moves", count: fmtInt(model.moves.length) },
      { id: "consensus", label: "Consensus", count: fmtInt(model.board?.qualifying ?? 0) },
      { id: "new-position-leaders", label: "New positions", labelHtml: CONVICTION_SHORT_LABEL_HTML },
    ]) +
    /* LD6: Named moves (the primary cell) │ Consensus above the leaders */
    pairBandHtml("sig-inst-band", namedMovesHtml(model, ctx), side, { primary: "left" }) +
    `<p class="si-foot" id="inst-method-links"><a href="/methodology/#13f-method">How 13F data is read ↗</a> <a href="/methodology/#signals-congress-column">The Congress column ↗</a> <a href="/institutional/">Filer directory ↗</a></p>` +
    /* the §5 data note ships with the 13F data on every institutional surface */
    institutionalDataNoteHtml()
  );
}

/** Exposed for the tests: the move rows' anchors in DOM-set order. */
export function namedMoveIds(model: Pick<SignalsInstitutional, "moves" | "domSet">): string[] {
  return moveIds(model);
}

