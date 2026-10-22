/* Pure page/section renderers. Every entity body is a string function called
   by the thin .astro page for SSR AND by the generic-route client driver —
   parity is by construction (one function, two callers). No Node APIs, no DOM.

   Honesty grammar: G1–G7 via the canonical format.ts components; charts
   zero-based, gaps stay gaps, no midpoints; NULL-honest institutional
   integers; the as-of time stamp every 13F table carries. */

/* ui/home.ts — Home page pieces. One of the ui/ domain modules: consumers
   import from ./index.ts only, never from this file directly.

   launch M2 (owner decision D1, Home A "Signals first"; R14–R17, LD14–LD17):
   the hero (the claim, a launcher into the ONE masthead search combobox, and
   "Try" chips from the build), the four-figure ledger, "What stands out" (the
   triage's three lead cards, rendered by the Signals tab's own card
   renderer), "Latest from Congress" and "Notable managers" side by side, and
   the trust strip. The Modules grid, its card renderer and the Signals tile
   are gone (R14). Every figure is computed from build inputs by
   `homeFigures`; nothing here is a literal number or name (R3). */

import {
  type TxnRow,
  type PaperRow,
  type RenderCtx,
  esc,
  amountText,
  sideLabel,
  ownerQualifiersHtml,
  rangeBand,
  srcLink,
  memberHrefFor,
  partyClass,
  fmtInt,
  tickerHrefFor,
  note,
  noteFromHtml,
  thHtml,
  txnEdge,
  presentColumns,
  dataColumnsAttr,
  tableFootReasonHtml,
  kindWordHtml,
} from "../format.ts";
import { affTextOf, searchStarters, type SearchIndex } from "../derive.ts";
import type { InstData } from "../inst.ts";
import { signedUsd, type NotableMove } from "../notable-moves.ts";
import type { TriageResult } from "../signal-triage.ts";
import { quarterLabel } from "../congress-quarter.ts";
import { disclosureLedger, type LedgerItem } from "./shared.ts";
import { COMMITTEE_CAVEAT, leadCardBodyHtml, leadCardTag, type LeadCard } from "./signals.ts";

/* ---------- Home pieces (the specimen comes from a real row) ---------- */

export function pickSpecimen(txns: readonly TxnRow[]): TxnRow | null {
  return (
    txns.find(
      (t) => t.ticker != null && t.traded != null && t.low != null && t.high != null,
    ) ?? null
  );
}

export function specimenCard(r: TxnRow, ctx: RenderCtx): string {
  const side = sideLabel(r.side, r.flags);
  const owner = ownerQualifiersHtml(r);
  const lagText = r.lag == null ? "" : ` <span class="spec-lag">+${r.lag}d</span>`;
  return (
    `<aside class="specimen" aria-label="What a number looks like here">` +
    `<div class="spec-head">what a number looks like here</div>` +
    `<div class="spec-body">` +
    `<div class="spec-row1"><span class="spec-name">${
      r.bioguide ? `<a href="${memberHrefFor(r.bioguide, ctx)}">${esc(r.name)}</a>` : esc(r.name)
    } <span class="aff ${partyClass(r.party)}">${esc(affTextOf(r))}</span></span>${srcLink(r.doc)}</div>` +
    `<div class="spec-row2"><span class="mono-ticker">${esc(r.ticker ?? "—")}</span>` +
    `<span class="spec-side ${side.cls}">${esc(side.text)}${owner ? ` ${owner}` : ""}</span>` +
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

/* ---------- the hero (R14, R17, LD17) ---------- */

/** The ONE masthead claim — twelve words or fewer (R14): the owner's approved
    headline (LD17, DV7). Every count and label under it says "13F filers". */
export const HOME_CLAIM = "What Congress and the big funds are trading.";

/** The hero kicker. No cadence claim: design-principles §8 replaces cadence
    claims with the build stamp, which the ledger's "Updated" figure carries
    (DV13 — the mock's "updated daily" is dropped). */
export const HOME_KICKER = "Free · primary sources";

/** The hero lede — copy item home-01, as proposed. */
export const HOME_LEDE = "Congressional trades and 13F holdings — free, with receipts.";

/** The launcher's words: the field's placeholder (copy item home-02, adapted
    to the launcher that replaced the button; DV7: "13F filer", not "fund"). */
export const HOME_SEARCH_TEXT = "Search a member, ticker or 13F filer";

/** One "Try" chip: a link to an entity the build ranks first. */
export interface HomeChip {
  kind: "ticker" | "member" | "filer";
  label: string;
  href: string;
}

/** LD17: the "Try" chips — the search index's two most active tickers and two
    most active members (`searchStarters`, the ranking the search panel's own
    starters use) and the notable 13F filer reporting the largest value. Each
    is a link computed from the build, never a literal (R3, R17). */
export function homeTryChips(
  index: SearchIndex | null,
  filer: { name: string; href: string } | null,
  ctx: RenderCtx,
): HomeChip[] {
  const chips: HomeChip[] = [];
  if (index) {
    const { tickers, members } = searchStarters(index);
    for (const [t] of tickers) chips.push({ kind: "ticker", label: t, href: tickerHrefFor(t, ctx) });
    for (const [b, name] of members) chips.push({ kind: "member", label: name, href: memberHrefFor(b, ctx) });
  }
  if (filer) chips.push({ kind: "filer", label: filer.name, href: filer.href });
  return chips;
}

/** The notable filer (the registry's editorial flag) reporting the largest
    13F value for `period` — its concentration row's total — ties broken by
    CIK; null with no 13F module, no period, or no notable filer reporting. */
export function largestNotableFiler(inst: InstData, period: string | null): { cik: string; name: string } | null {
  if (!inst.present || period === null) return null;
  let best: { cik: string; name: string; value: number } | null = null;
  for (const t of inst.typingByCik.values()) {
    if (!t.notable) continue;
    const row = (inst.concentrationByCik.get(t.cik) ?? []).find((r) => r.period_of_report === period);
    if (!row) continue;
    const value = row.total_value_usd;
    if (best === null || value > best.value || (value === best.value && t.cik < best.cik)) {
      best = { cik: t.cik, name: t.display_name, value };
    }
  }
  return best && { cik: best.cik, name: best.name };
}

/** The chips row. The group's name says what the chips are; the visible
    "Try" is its label. Phones swipe the row (R10: a named quick-picks strip
    on a role-less wrapper, so the group keeps its own role and name). */
export function homeTryChipsHtml(chips: readonly HomeChip[]): string {
  if (chips.length === 0) return "";
  const filer = chips.some((c) => c.kind === "filer");
  const name = `Try: the most active tickers and members in this build${filer ? ", and the notable 13F filer reporting the largest value" : ""}`;
  return (
    `<div class="home-try-strip" data-scroll-region="Try · swipe for more">` +
    `<div class="home-try" role="group" aria-label="${esc(name)}"><span class="home-try-k" aria-hidden="true">Try</span>` +
    chips.map((c) => `<a class="home-chip" data-kind="${c.kind}" href="${esc(c.href)}">${esc(c.label)}</a>`).join("") +
    `</div></div>`
  );
}

/** LD17, DV14: the hero search is a LAUNCHER styled as the field — a link to
    the one masthead combobox (`#site-search`) that `search-client.ts` turns
    into a focus (and, on phones, opens the masthead's search sheet). No
    second input and no second combobox: the masthead search is the search. */
export function homeSearchLauncherHtml(): string {
  return (
    `<a class="home-search" href="#site-search" data-search-launcher>` +
    `<span class="home-search-g" aria-hidden="true">⌕</span>` +
    `<span class="home-search-t">${esc(HOME_SEARCH_TEXT)}</span>` +
    `<kbd class="home-search-kbd" aria-hidden="true">/</kbd></a>`
  );
}

/** The hero's copy under the kicker (the kicker carries the Astro mark): the
    claim, the lede with its Principles link, the launcher and the chips. */
export function homeHeroCopyHtml(chips: readonly HomeChip[]): string {
  return (
    `<h1 class="hero-title" id="home-claim">${esc(HOME_CLAIM)}</h1>` +
    `<p class="hero-lede">${esc(HOME_LEDE)} <a href="/methodology/#principles">Principles ↗</a></p>` +
    homeSearchLauncherHtml() +
    homeTryChipsHtml(chips)
  );
}

/* ---------- the four-figure ledger (R15, LD14) ---------- */

/** Every input a home figure reads, straight from the build. */
export interface HomeFigureInputs {
  /** the build's rows (`build.txns`, `build.paper`) */
  txns: readonly Pick<TxnRow, "bioguide" | "name">[];
  paper: readonly Pick<PaperRow, "bioguide" | "name">[];
  /** `build.members`: joined members with a transaction or a paper filing */
  members: readonly unknown[];
  /** `build.filedFrom`, the earliest filing year */
  filedFrom: string;
  /** the parsed congress/stats.json */
  stats: Record<string, any>;
  /** per-chamber e-file parse coverage (`coverageSummary(build.stats)`) */
  coverage: { housePct: string; senatePct: string; needsOcr: number };
  /** the 13F module (every filer on record, the newest closed quarter and the
      filings-through date), or its absence */
  inst: { present: true; filers: number; closedQuarter: string | null; filingsThrough: string | null } | { present: false };
  /** the signal artifact's active hits and retention window */
  signals: { active: number; retentionDays: number; coverageFrom: string; coverageTo: string };
  /** the triage's own unit, or null where the triage is not computed */
  triage: { stands: number; ranked: number } | null;
  /** `build.generatedAtDate` */
  generatedAtDate: string;
}

export interface HomeFigures {
  /** the default view's transaction count */
  trades: number;
  filedFrom: string;
  /** joined members (never an unjoined filer name) */
  members: number;
  /** distinct filer names that join no member record, stated in the tip */
  unjoinedNames: number;
  coverage: HomeFigureInputs["coverage"];
  inst: HomeFigureInputs["inst"];
  signals: HomeFigureInputs["signals"];
  triage: HomeFigureInputs["triage"];
  /** the build date and each chamber's newest filed date (stats.json `freshness`) */
  updated: { date: string; house: string | null; senate: string | null };
}

/** Distinct filer names on rows that join no member record — counted, never
    turned into members (LD14). */
export function unjoinedFilerNames(rows: Iterable<Pick<TxnRow, "bioguide" | "name">>): number {
  const names = new Set<string>();
  for (const r of rows) if (!r.bioguide) names.add(r.name);
  return names.size;
}

function dateOrNull(v: unknown): string | null {
  return typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
}

/** The home figures (LD14), each in its own unit: trades = the default view's
    transactions; members = `build.members` (joined members only); 13F filers
    on record = the registry across every period, with the newest closed
    quarter and its filings-through date beside it, never as that quarter's
    count; hits = active signals in the retention window, with the triage's
    "stand out of N rows ranked"; Updated = the build date with each
    chamber's filed-through date. */
export function homeFigures(i: HomeFigureInputs): HomeFigures {
  const freshness = i.stats?.freshness ?? {};
  return {
    trades: i.txns.length,
    filedFrom: i.filedFrom,
    members: i.members.length,
    unjoinedNames: unjoinedFilerNames([...i.txns, ...i.paper]),
    coverage: i.coverage,
    inst: i.inst,
    signals: i.signals,
    triage: i.triage,
    updated: {
      date: i.generatedAtDate,
      house: dateOrNull(freshness.house_db_max_filed_date),
      senate: dateOrNull(freshness.senate_db_max_filed_date),
    },
  };
}

/** "1 member", "2 members": a count and its noun, agreed. */
function countOf(n: number, one: string, many: string): string {
  return `${fmtInt(n)} ${n === 1 ? one : many}`;
}

function parsedText(chamber: string, p: string): string {
  return p === "—" ? `${chamber}: no e-filings` : `${chamber} ${p}% parsed`;
}

/** The ledger: four figures, each with its tip. No "Today", no live dot (DV5):
    "Updated" is the build date. */
export function homeLedgerHtml(f: HomeFigures): string {
  const u = f.unjoinedNames;
  const tradesNote =
    `Transactions in House and Senate periodic transaction reports filed since ${f.filedFrom}. ` +
    `${countOf(f.members, "member of Congress has", "members of Congress have")} a transaction or a paper filing here; ` +
    (u === 0
      ? "every filer name joins a member record. "
      : `${fmtInt(u)} filer ${u === 1 ? "name joins" : "names join"} no member record, so ${u === 1 ? "it is" : "they are"} not counted as members (${u === 1 ? "its" : "their"} trades are). `) +
    `${parsedText("House", f.coverage.housePct)} · ${parsedText("Senate", f.coverage.senatePct)} · ${countOf(f.coverage.needsOcr, "paper filing", "paper filings")} counted, not machine-read.`;
  const q = f.inst.present && f.inst.closedQuarter ? (quarterLabel(f.inst.closedQuarter) ?? f.inst.closedQuarter) : null;
  const instItem: LedgerItem = f.inst.present
    ? {
        label: "13F filers on record",
        value: fmtInt(f.inst.filers),
        detail: q ? `newest closed quarter ${q} · filings through ${f.inst.filingsThrough ?? "—"}` : "no quarter closed for filing yet",
        subKind: q ? "date" : "absence",
        noteHtml: esc(
          "Every 13F filer in this build, across every period it keeps — not one quarter's count. " +
            (q
              ? `The newest quarter closed for filing is ${q} (quarter ended ${f.inst.closedQuarter}); 13F filings received through ${f.inst.filingsThrough ?? "a date not stated"} are in this build.`
              : "No quarter in this build has passed its filing deadline yet."),
        ),
      }
    : { label: "13F filers on record", value: "—", detail: "not in this build", subKind: "absence" };
  const s = f.signals;
  const signalsItem: LedgerItem = {
    label: `Signals · ${s.retentionDays} days`,
    value: fmtInt(s.active),
    detail: f.triage
      ? `${fmtInt(f.triage.stands)} ${f.triage.stands === 1 ? "stands" : "stand"} out of ${countOf(f.triage.ranked, "row", "rows")} ranked`
      : "ranking not computed in this view",
    subKind: f.triage ? "count" : "absence",
    tone: "gold",
    noteHtml: esc(
      `Active signal hits on filings from ${s.coverageFrom} to ${s.coverageTo}, the last ${s.retentionDays} days: facts about filings, never forecasts.` +
        (f.triage
          ? ` On Signals, ${fmtInt(f.triage.stands)} of ${countOf(f.triage.ranked, "ranked row", "ranked rows")} ${f.triage.stands === 1 ? "stands" : "stand"} out against the filer's own record.`
          : ""),
    ),
  };
  const up = f.updated;
  const updatedItem: LedgerItem = {
    label: "Updated",
    value: up.date || "—",
    detail: `House to ${up.house ?? "—"} · Senate to ${up.senate ?? "—"}`,
    subKind: "date",
    noteHtml: esc(
      `The date this build was made. Its newest House filing was filed ${up.house ?? "on a date not stated"}, and its newest Senate filing ${up.senate ?? "on a date not stated"}.`,
    ),
  };
  return (
    `<div class="home-ledger">` +
    disclosureLedger(
      [
        { label: "Congress trades", value: fmtInt(f.trades), detail: `since ${f.filedFrom} · ${countOf(f.members, "member", "members")}`, subKind: "count", noteHtml: esc(tradesNote) },
        instItem,
        signalsItem,
        updatedItem,
      ],
      { scope: "home-ledger", label: "The record in this build" },
    ) +
    `</div>`
  );
}

/* ---------- R16 / LD15: "What stands out" — the triage's three cards ---------- */

/** The three cards, in order: the committee card, then the largest purchase
    and the largest sale, both ranked by the filer's own record. */
export const HOME_LEAD_CARDS: readonly { card: LeadCard; tone: string }[] = [
  { card: "committee", tone: "amber" },
  { card: "buy", tone: "green" },
  { card: "sell", tone: "red" },
];

/** R16, LD15: the triage's committee card and its largest purchase and sale
    by the filer's own record, through the Signals tab's own card renderer
    (`leadCardBodyHtml`, one function, two callers). Each opens its row on
    /signals/; each shows the asset as filed; the committee card keeps the
    committee caveat (DV1: the mock dropped it); a null triage or pick states
    the Signals tab's own empty-card sentence. */
export function homeLeadHtml(triage: TriageResult | null, ctx: RenderCtx, retentionDays: number): string {
  const tip = note(
    "A signal is a fact about a filing, never a forecast: each filing is ranked against the filer's own record. No prices, no returns. " +
      "These are the listed-stock lines of the Filings to read on Signals: the committee card, then the largest purchase and the largest sale by the filer's own record. Choose a card to open its row there.",
    { scope: "home-lead" },
    "about",
    { trigger: "mark", name: "About these cards" },
  );
  const cards = HOME_LEAD_CARDS.map(
    ({ card, tone }) =>
      `<article class="si-card home-card" data-card="${card}" data-tone="${tone}">` +
      `<div class="si-card-tag">${esc(leadCardTag(triage, card))}</div>` +
      leadCardBodyHtml(triage, card, "record", ctx, { rowHref: "/signals/", asset: true }) +
      (card === "committee" ? `<p class="si-card-context">${esc(COMMITTEE_CAVEAT)}</p>` : "") +
      `</article>`,
  ).join("");
  return (
    `<section class="home-lead" id="home-lead" aria-labelledby="home-lead-h">` +
    `<div class="panel-head"><h2 class="section-h" id="home-lead-h">What stands out</h2>` +
    `<span class="panel-note">Last ${fmtInt(retentionDays)} days · <span class="caveat-inline">not a forecast</span></span>${tip}` +
    `<span class="panel-note home-sec-link"><a class="section-link" href="/signals/">All signals →</a></span></div>` +
    `<div class="si-cards" data-scroll-region="What stands out · swipe for more">${cards}</div>` +
    `</section>`
  );
}

/* ---------- R14 / LD16: Latest from Congress and Notable managers ---------- */

/** Rows per table: six each (R14; the live tiles held five). */
export const HOME_TILE_ROWS = { congress: 6, moves: 6 } as const;

/** R40 (launch M1a's contract, LD37): every table here carries explicit
    roles, so a card table keeps its semantics when its display changes. A
    head cell gets its role unless its builder already wrote one. */
function roleTh(th: string): string {
  return /^<th\b[^>]*\brole="/.test(th) ? th : th.replace(/^<th\b/, '<th role="columnheader"');
}

function tableOpen(cls: string, caption: string, extraAttrs = ""): string {
  return (
    `<div class="table-scroll"><table class="${cls}" role="table" data-card="generic"${extraAttrs}>` +
    `<caption class="visually-hidden">${esc(caption)}</caption>`
  );
}

/** "Latest from Congress" (LD16): the six newest transactions — Side, Member,
    Ticker, Range, Filed. A late row keeps the gold edge and says "filed late"
    to assistive technology; a partial sale and the owner code ride on the
    member's line. The range caveat is the Range header's tip (copy item
    home-03): the trade's dates and receipt are on Congress. */
export function congressTileHtml(rows: readonly TxnRow[], ctx: RenderCtx): string {
  const shown = rows.slice(0, HOME_TILE_ROWS.congress);
  /* R12 (DESIGN-POLISH M2): the table's collection is exactly the rows it
     shows; a Ticker column no row fills is not rendered, and says so. */
  const cols = presentColumns(shown, [
    { key: "side", always: true },
    { key: "member", always: true },
    { key: "ticker", hasValue: (r) => r.ticker != null, emptyReason: "Ticker: none of these filings names a ticker; each row's member and filing link stay." },
    { key: "range", always: true },
    { key: "filed", always: true },
  ]);
  const hasTicker = cols.columns.includes("ticker");
  const body = shown
    .map((r) => {
      const side = sideLabel(r.side, r.flags);
      const quals = ownerQualifiersHtml(r);
      /* the row's main link (launch review M2): the member, else the ticker */
      const member = r.bioguide ? `<a data-row-link href="${memberHrefFor(r.bioguide, ctx)}">${esc(r.name)}</a>` : esc(r.name);
      const edge = txnEdge(r);
      return (
        `<tr role="row"${edge ? ` data-edge="${edge}"` : ""}>` +
        `<td class="c-kind ${side.cls}" role="cell">${esc(side.text)}</td>` +
        `<td class="c-member c-flex" role="cell">${member} <span class="aff ${partyClass(r.party)}">${esc(affTextOf(r))}</span>${quals ? ` · ${quals}` : ""}</td>` +
        (hasTicker
          ? `<td class="c-ticker" role="cell">${r.ticker ? `<a class="mono-ticker"${r.bioguide ? "" : " data-row-link"} href="${tickerHrefFor(r.ticker, ctx)}">${esc(r.ticker)}</a>` : `<span class="none">—</span>`}</td>`
          : "") +
        `<td class="c-num" role="cell">${esc(amountText(r))}</td>` +
        `<td class="c-filed c-num" role="cell">${esc(r.filed)}${r.late === 1 ? `<span class="visually-hidden"> · filed late</span>` : ""}</td></tr>`
      );
    })
    .join("\n");
  const rangeNote =
    `Statutory range as filed — never an exact amount. Each trade's traded date, filed date and receipt are on Congress. ` +
    `<a href="/methodology/#ranges">Why ranges ↗</a>`;
  const heads = [
    thHtml({ label: "Side", cls: "c-kind", col: "side" }),
    thHtml({ label: "Member", cls: "c-member c-flex", col: "member" }),
    hasTicker ? thHtml({ label: "Ticker", cls: "c-ticker", col: "ticker" }) : "",
    thHtml({ label: "Range", cls: "c-num", col: "range", noteHtml: rangeNote, notes: { scope: "home-congress" }, noteKey: "range" }),
    thHtml({ label: "Filed", cls: "c-filed c-num", col: "filed" }),
  ]
    .filter(Boolean)
    .map(roleTh)
    .join("");
  const tip = note(
    "The newest filings in this build. Members have up to 45 days to file, so a new filing is often an older trade; a gold edge marks a filing past that window.",
    { scope: "home-congress" },
    "about",
    { trigger: "mark", name: "About these rows" },
  );
  return (
    `<section class="panel home-tile" id="home-congress" aria-labelledby="home-congress-h">` +
    `<div class="panel-head"><h2 class="section-h" id="home-congress-h">Latest from Congress</h2>${tip}` +
    `<span class="panel-note home-sec-link"><a class="section-link" href="/congress/">All filings →</a></span></div>` +
    (shown.length === 0
      ? `<p class="section-note">No disclosures in this build.</p>`
      : tableOpen("etable etable-compact", "The newest congressional filings in this build", dataColumnsAttr(cols)) +
        `<thead role="rowgroup"><tr role="row">${heads}</tr></thead>` +
        `<tbody role="rowgroup">${body}</tbody></table></div>` +
        tableFootReasonHtml(cols)) +
    `</section>`
  );
}

/** "Notable managers" (LD16): the quarter's largest NEW stakes by notable
    managers (an add is not a new stake), six rows — Manager, Ticker, Change,
    Δ $, Filed (DV2: the mock dropped Filed). The header word is "Change",
    never the banned verb. The 13F snapshot caveat stays visible (copy item
    home-05); the quarter end and the filings-through date are in its tip. */
export function movesTileHtml(
  moves: readonly NotableMove[],
  period: string | null,
  filerHref: (cik: string) => string,
  opts: { filingsThrough?: string | null; instPresent?: boolean } = {},
): string {
  const instPresent = opts.instPresent ?? true;
  const stakes = moves.filter((m) => m.kind === "new");
  const shown = stakes.slice(0, HOME_TILE_ROWS.moves);
  const q = period ? (quarterLabel(period) ?? period) : null;
  const body = shown
    .map(
      (m) =>
        `<tr role="row" data-edge="new">` +
        `<td class="c-filer c-flex" role="cell"><a data-row-link href="${esc(filerHref(m.cik))}">${esc(m.manager)}</a></td>` +
        `<td class="c-ticker" role="cell">${m.ticker ? `<span class="mono-ticker">${esc(m.ticker)}</span>` : `<span class="filed-name">${esc(m.issuer)}</span>`}</td>` +
        `<td class="c-chip c-kind" role="cell">${kindWordHtml(m.kind)}</td>` +
        `<td class="c-num ${m.delta_value == null ? "c-muted" : m.delta_value < 0 ? "c-sell" : "c-buy"}" role="cell">${esc(signedUsd(m.delta_value))}</td>` +
        `<td class="c-filed c-num" role="cell">${esc(m.filed ?? "—")}</td></tr>`,
    )
    .join("\n");
  const heads = [
    thHtml({ label: "Manager", cls: "c-filer c-flex" }),
    thHtml({ label: "Ticker", cls: "c-ticker" }),
    thHtml({ label: "Change", cls: "c-chip c-kind" }),
    thHtml({ label: "Δ $", cls: "c-num" }),
    thHtml({ label: "Filed", cls: "c-filed c-num" }),
  ]
    .map(roleTh)
    .join("");
  const snapshot = period
    ? noteFromHtml(
        esc(
          `13F positions as of quarter end (${period}), filed up to 45 days later; 13F filings received through ${opts.filingsThrough ?? "a date not stated"} are in this build. ` +
            "Changes are classified by share count: a new stake is a position the manager did not report the quarter before.",
        ),
        { scope: "home-moves" },
        "snapshot",
        { trigger: "mark", name: "About 13F snapshots" },
      )
    : "";
  const empty = !instPresent
    ? "13F data is not in this build."
    : period === null
      ? "No closed quarter is available yet — 13F filings arrive up to 45 days after quarter end."
      : `No new stakes by notable managers are on record for ${q}.`;
  return (
    `<section class="panel home-tile" id="home-moves" aria-labelledby="home-moves-h">` +
    `<div class="panel-head"><h2 class="section-h" id="home-moves-h">Notable managers</h2>` +
    (q ? `<span class="panel-note">${esc(q)} · largest new stakes</span>` : "") +
    `<span class="panel-note home-sec-link"><a class="section-link" href="/signals/#institutional">All moves →</a></span></div>` +
    (shown.length === 0
      ? `<p class="section-note">${esc(empty)}</p>`
      : tableOpen("etable etable-compact", `Largest new stakes by notable managers${q ? `, ${q}` : ""}`) +
        `<thead role="rowgroup"><tr role="row">${heads}</tr></thead>` +
        `<tbody role="rowgroup">${body}</tbody></table></div>`) +
    (instPresent ? `<p class="caveat-line home-13f-note">Quarter-end snapshot · not current holdings${snapshot ? ` ${snapshot}` : ""}</p>` : "") +
    `</section>`
  );
}

/* ---------- R17 / LD17: the trust strip ---------- */

/** The trust strip, worded to say nothing inaccurate (R17, DV4): "Nothing
    secondhand" is gone — members and committees come from the CC0
    congress-legislators project, the jurisdiction map is the site's own, and
    any rows from the backfill seed are stated with their count — and the site
    is rebuilt on each publish, not on a cadence it cannot promise (§8). */
export function homeTrustHtml(stats: Record<string, any>): string {
  const seed = Number(stats?.default?.source_mix?.kadoa_count ?? 0);
  const tip = note(
    "Members and committees come from the CC0 congress-legislators project, and the committee jurisdiction map is this site's own." +
      (seed > 0 ? ` ${fmtInt(seed)} older ${seed === 1 ? "row comes" : "rows come"} from an MIT-licensed backfill seed, retired row by row as primary filings replace ${seed === 1 ? "it" : "them"}.` : ""),
    { scope: "home-trust" },
    "sources",
    { trigger: "mark", name: "About the sources" },
  );
  const item = (k: string, v: string, sHtml: string): string =>
    `<div><dt class="home-trust-k">${esc(k)}</dt><dd class="home-trust-v">${esc(v)}</dd><dd class="home-trust-s">${sHtml}</dd></div>`;
  return (
    `<dl class="home-trust" id="home-trust" aria-label="About this record">` +
    item("Primary sources", "House Clerk · Senate eFD · SEC EDGAR", `Rebuilt from them on each publish. ${tip}`) +
    item("Receipts", "Every row links to its filing", "One click to the source document.") +
    item("As filed", "Ranges, both dates, late flags", "A range is never turned into a guess.") +
    item("Free", "Read it, cite it, link to it", `<a href="/methodology/#sources">Sources &amp; licenses ↗</a>`) +
    `</dl>`
  );
}

/* ---------- the page body under the hero (R14 order) ---------- */

/** Everything under the hero, in R14's order: "What stands out", then
    "Latest from Congress" and "Notable managers" side by side, then the trust
    strip. No sign-up band (D2). */
export function homeSectionsHtml(parts: { lead: string; congress: string; moves: string; trust: string }): string {
  return parts.lead + `<div class="home-pair">${parts.congress}${parts.moves}</div>` + parts.trust;
}
