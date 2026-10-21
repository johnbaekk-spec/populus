/* launch M2 — Home A (owner decision D1; R14–R17, R2, R3, R40; LD14–LD17).

   Each property here is pinned against an INDEPENDENT recompute or a planted
   control, never against the renderer's own output read back:

   - R14 structure: the body's sections in order, six rows per table, the
     Modules grid, the Signals tile and any sign-up band gone, the page's
     composition order (hero copy, ledger, body).
   - R15 figures: each ledger figure equals a recompute from fixture build data
     — an unjoined filer is counted in the trades, never as a member; the
     Signals label reads the artifact's own window; Updated is the build date
     with each chamber's filed-through date.
   - R16 cards: the triage's committee card and largest purchase and sale by
     the filer's own record, through the Signals tab's own card renderer, each
     opening its row on /signals/, the committee caveat kept, empty states
     stated.
   - R17 copy and chips: no cadence claim, accurate sources, the chips equal
     the search panel's ranking, the launcher targets the one combobox.
   - R40 table roles, R2 honesty fields, the banned wording, R3 literals. */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  HOME_CLAIM,
  HOME_KICKER,
  HOME_LEDE,
  HOME_TILE_ROWS,
  HOME_LEAD_CARDS,
  congressTileHtml,
  homeFigures,
  homeHeroCopyHtml,
  homeLeadHtml,
  homeLedgerHtml,
  homeSectionsHtml,
  homeTrustHtml,
  homeTryChips,
  homeTryChipsHtml,
  largestNotableFiler,
  movesTileHtml,
  unjoinedFilerNames,
  type HomeFigureInputs,
} from "../src/lib/ui/home.ts";
import { COMMITTEE_CAVEAT, leadCardBodyHtml, triageRowId } from "../src/lib/ui/signals.ts";
import { buildSearchIndex, groupEntities, type SearchIndex } from "../src/lib/derive.ts";
import { launchSearch, renderPreQuery } from "../src/scripts/search-client.ts";
import { scanBannedWording } from "../src/lib/activity.ts";
import { BANNED_PATTERNS } from "./lib/banned-scan.ts";
import { buildTriage, type TriageResult } from "../src/lib/signal-triage.ts";
import type { PaperRow, TxnRow } from "../src/lib/format.ts";
import type { InstData } from "../src/lib/inst.ts";
import type { NotableMove } from "../src/lib/notable-moves.ts";
import { loadTriageFixture } from "./lib/triage-fixture.ts";
import { domOf, ledgerFigures, visibleText } from "./lib/ledger-dom.ts";
import type { MiniElement } from "./lib/mini-dom.ts";

const SRC = path.resolve(import.meta.dirname, "..", "src");
const PAGE = readFileSync(path.join(SRC, "pages", "index.astro"), "utf-8");
/** The page's template — what it renders — without the frontmatter's code comments. */
const TEMPLATE = PAGE.slice(PAGE.indexOf("---", 3) + 3);
const HOME_SRC = readFileSync(path.join(SRC, "lib", "ui", "home.ts"), "utf-8");

function txn(over: Partial<TxnRow> = {}): TxnRow {
  return {
    kind: "txn", txnId: "t0", asset: "Williams Companies Inc", assetType: "ST", filed: "2026-07-21", traded: "2026-06-24",
    name: "Member A", bioguide: "A000001", party: "R", state: "OK", district: null, chamber: "senate", ticker: "WMB",
    side: "purchase", owner: null, low: 1001, high: 15000, lag: 27, late: 0, flags: [],
    doc: "https://efdsearch.senate.gov/search/view/ptr/abc/", ...over,
  } as TxnRow;
}
function paper(over: Partial<PaperRow> = {}): PaperRow {
  return { kind: "paper", filed: "2026-06-01", name: "Member B", bioguide: "B000002", party: "D", state: "CA", district: "12", chamber: "house", doc: "https://disclosures-clerk.house.gov/x.pdf", ...over } as PaperRow;
}
function move(i: number, over: Partial<NotableMove> = {}): NotableMove {
  return { cik: String(1000 + i).padStart(10, "0"), manager: `Manager ${i}`, principal: null, type: "hedge_fund", issuer: `Issuer ${i}`, ticker: `T${i}`, ticker_verified: null, kind: "new", delta_shares: 10, curr_value: 1_000_000 - i, delta_value: 1_000_000 - i, filed: "2026-05-15", doc: null, key: `k${i}`, ikey: null, ...over };
}

let golden: { triage: TriageResult; rows: TxnRow[]; retentionDays: number } | null = null;
function goldenTriage(): { triage: TriageResult; rows: TxnRow[]; retentionDays: number } {
  if (golden) return golden;
  const f = loadTriageFixture();
  golden = { triage: buildTriage(f.artifact, f.rows, { committee: f.committee, identityOf: f.identityOf }), rows: f.rows as TxnRow[], retentionDays: f.artifact.retentionDays };
  return golden;
}

/** The fixture build: three joined members (one paper-only), one unjoined
    filer with two rows, and stats.json's freshness. */
function fixtureBuild() {
  const txns = [
    txn({ txnId: "a1" }),
    txn({ txnId: "a2", side: "sale_partial", owner: "spouse", late: 1, lag: 60, filed: "2026-07-20" }),
    txn({ txnId: "c1", name: "Member C", bioguide: "C000003", filed: "2026-07-19" }),
    txn({ txnId: "u1", name: "Filer, Unjoined", bioguide: null, party: "", filed: "2026-07-18" }),
    txn({ txnId: "u2", name: "Filer, Unjoined", bioguide: null, party: "", filed: "2026-07-17" }),
  ];
  const papers = [paper(), paper({ name: "Paper, Unjoined", bioguide: null, party: "" })];
  const groups = groupEntities(txns, papers);
  const members = [...groups.members.keys()];
  return { txns, papers, members };
}

function inputs(over: Partial<HomeFigureInputs> = {}): HomeFigureInputs {
  const b = fixtureBuild();
  return {
    txns: b.txns, paper: b.papers, members: b.members, filedFrom: "2014",
    stats: { freshness: { house_db_max_filed_date: "2026-10-15", senate_db_max_filed_date: "2026-10-07" } },
    coverage: { housePct: "93.9", senatePct: "100", needsOcr: 2 },
    inst: { present: true, filers: 4321, closedQuarter: "2026-03-31", filingsThrough: "2026-07-31" },
    signals: { active: 77, retentionDays: 45, coverageFrom: "2026-09-04", coverageTo: "2026-10-19" },
    triage: { stands: 12, ranked: 345 },
    generatedAtDate: "2026-10-19",
    ...over,
  };
}

function fullHome(): string {
  const g = goldenTriage();
  return (
    homeHeroCopyHtml(homeTryChips(buildSearchIndex([{ bioguide: "A000001", name: "Member A", aff: "R–OK", rows: 3 }], [{ ticker: "WMB", name: "", rows: 3 }], []), { name: "Filer F", href: "/institutional/filers/0000000001/" }, {})) +
    homeLedgerHtml(homeFigures(inputs())) +
    homeSectionsHtml({
      lead: homeLeadHtml(g.triage, {}, g.retentionDays),
      congress: congressTileHtml(fixtureBuild().txns, {}),
      moves: movesTileHtml(Array.from({ length: 9 }, (_, i) => move(i)), "2026-03-31", (cik) => `/f/${cik}/`, { filingsThrough: "2026-07-31" }),
      trust: homeTrustHtml({ default: { source_mix: { kadoa_count: 250 } } }),
    })
  );
}

/* ---------------------------------------------------------------- R14 */

test("R14: the body reads What stands out → Latest from Congress │ Notable managers → the trust strip, and the page composes hero copy, ledger, body", () => {
  const body = domOf(fullHome());
  const order = body.querySelectorAll("[id]").map((e) => e.getAttribute("id")!).filter((id) => ["home-claim", "home-lead", "home-congress", "home-moves", "home-trust"].includes(id));
  assert.deepEqual(order, ["home-claim", "home-lead", "home-congress", "home-moves", "home-trust"]);
  const pair = body.querySelector(".home-pair")!;
  assert.deepEqual(pair.children.map((c) => c.getAttribute("id")), ["home-congress", "home-moves"], "the two tables sit side by side in one pair");
  // the page: the kicker and the hero copy, then the ledger, then the body
  const at = (s: string): number => PAGE.indexOf(s);
  assert.ok(at("{HOME_KICKER}") > 0 && at("{HOME_KICKER}") < at("set:html={heroCopy}") && at("set:html={heroCopy}") < at("set:html={ledger}") && at("set:html={ledger}") < at("set:html={sections}"), "kicker, hero copy, ledger, body");
  assert.match(PAGE, /homeSectionsHtml\(\{\s*lead: homeLeadHtml/, "the body goes through the one order function");
});

test("R14: six rows per table; the Modules grid, the Signals tile and any sign-up band are gone", () => {
  const rows = Array.from({ length: 10 }, (_, i) => txn({ txnId: `r${i}` }));
  assert.equal(domOf(congressTileHtml(rows, {})).querySelectorAll("tbody tr").length, HOME_TILE_ROWS.congress);
  assert.equal(HOME_TILE_ROWS.congress, 6);
  const moves = movesTileHtml(Array.from({ length: 10 }, (_, i) => move(i)), "2026-03-31", (c) => c);
  assert.equal(domOf(moves).querySelectorAll("tbody tr").length, HOME_TILE_ROWS.moves);
  assert.equal(HOME_TILE_ROWS.moves, 6);
  const html = fullHome() + TEMPLATE;
  for (const gone of ["mod-grid", "mod-card", "modules-head", "badge-live", "home-tiles", "home-signals", "hero-ctas", "moduleCard", "signalsTileHtml"]) {
    assert.doesNotMatch(html, new RegExp(gone), `${gone} is gone`);
  }
  // D2: no account surface of any kind
  assert.doesNotMatch(html, /sign[ -]?up|sign[ -]?in|watchlist|follow\b|Everything here is free/i);
  // control: the absence check sees a planted Modules card
  assert.match(html + '<a class="mod-card">', /mod-card/);
});

test("R14 (LD16): Notable managers lists NEW stakes only — an add is never a new stake — in the moves' own order", () => {
  const mixed = [move(1, { kind: "add" }), move(2), move(3, { kind: "trim", delta_value: -5 }), move(4), move(5, { kind: "add" }), move(6)];
  const rows = domOf(movesTileHtml(mixed, "2026-03-31", (c) => `/f/${c}/`)).querySelectorAll("tbody tr");
  assert.deepEqual(rows.map((tr) => visibleText(tr.children[0]!).trim()), ["Manager 2", "Manager 4", "Manager 6"]);
  for (const tr of rows) assert.equal(visibleText(tr.children[2]!).trim(), "NEW");
  const heads = domOf(movesTileHtml(mixed, "2026-03-31", (c) => c)).querySelectorAll("thead th").map((th) => visibleText(th).trim());
  assert.deepEqual(heads, ["Manager", "Ticker", "Change", "Δ $", "Filed"], "DV2: Filed kept; the header word is Change");
  // the stated absences
  assert.match(movesTileHtml([move(1, { kind: "add" })], "2026-03-31", (c) => c), /No new stakes by notable managers are on record for Q1 2026\./);
  assert.match(movesTileHtml([], null, (c) => c), /No closed quarter is available yet/);
  assert.match(movesTileHtml([], null, (c) => c, { instPresent: false }), /13F data is not in this build\./);
  assert.doesNotMatch(movesTileHtml([], null, (c) => c, { instPresent: false }), /not current holdings/, "no 13F caveat without 13F data");
});

/* ---------------------------------------------------------------- R15 */

test("R15: every ledger figure equals an independent recompute from the fixture build, in its own unit", () => {
  const i = inputs();
  const figs = ledgerFigures(homeLedgerHtml(homeFigures(i)));
  assert.deepEqual(figs.map((f) => f.label), ["Congress trades", "13F filers on record", "Signals · 45 days", "Updated"]);
  // independent recomputes
  const b = fixtureBuild();
  const joined = new Set([...b.txns, ...b.papers].map((r) => r.bioguide).filter((x): x is string => x !== null));
  const unjoined = new Set([...b.txns, ...b.papers].filter((r) => r.bioguide === null).map((r) => r.name));
  assert.equal(joined.size, 3);
  assert.equal(unjoined.size, 2);
  const [trades, filers, signals, updated] = figs;
  assert.equal(trades!.value, String(b.txns.length), "trades = the default view's transactions, the unjoined filer's two rows included");
  assert.equal(trades!.sub, `since 2014 · ${joined.size} members`, "members = joined members only");
  const tradesNote = trades!.group.querySelector(".note-pop")!.textContent;
  assert.match(tradesNote, new RegExp(`${unjoined.size} filer names join no member record, so they are not counted as members`));
  assert.match(tradesNote, /House 93\.9% parsed · Senate 100% parsed · 2 paper filings counted, not machine-read/);
  assert.equal(filers!.value, "4,321");
  assert.equal(filers!.sub, "newest closed quarter Q1 2026 · filings through 2026-07-31", "the registry count is never read as the quarter's count");
  assert.match(filers!.group.querySelector(".note-pop")!.textContent, /not one quarter's count/);
  assert.equal(signals!.value, "77");
  assert.equal(signals!.sub, "12 stand out of 345 rows ranked", "the triage's own unit, as on /signals/");
  assert.equal(signals!.tone, "gold");
  assert.equal(updated!.value, "2026-10-19");
  assert.equal(updated!.sub, "House to 2026-10-15 · Senate to 2026-10-07");
  // control: counting the unjoined filer as a member changes the figure
  assert.notEqual(new Set([...b.txns, ...b.papers].map((r) => r.bioguide ?? r.name)).size, joined.size);
  assert.equal(unjoinedFilerNames([...b.txns, ...b.papers]), unjoined.size);
});

test("R15: the Signals label reads the artifact's window, never a literal; absences are stated", () => {
  for (const days of [30, 90, 120]) {
    const f = ledgerFigures(homeLedgerHtml(homeFigures(inputs({ signals: { active: 1, retentionDays: days, coverageFrom: "a", coverageTo: "b" } }))));
    assert.equal(f[2]!.label, `Signals · ${days} days`);
  }
  const none = ledgerFigures(homeLedgerHtml(homeFigures(inputs({ inst: { present: false }, triage: null, stats: {} }))));
  assert.deepEqual([none[1]!.value, none[1]!.sub], ["—", "not in this build"]);
  assert.equal(none[2]!.sub, "ranking not computed in this view");
  assert.equal(none[3]!.sub, "House to — · Senate to —", "a missing freshness date is stated, never invented");
  const one = ledgerFigures(homeLedgerHtml(homeFigures(inputs({ triage: { stands: 1, ranked: 1 }, members: ["A000001"] }))));
  assert.equal(one[2]!.sub, "1 stands out of 1 row ranked");
  assert.match(one[0]!.sub!, /· 1 member$/);
  // DV5: no "Today" and no live dot
  const html = homeLedgerHtml(homeFigures(inputs()));
  assert.doesNotMatch(html, /Today|live-dot/);
});

test("R15: largestNotableFiler picks the notable filer reporting the largest value for the quarter (ties by CIK)", () => {
  const conc = (cik: string, period: string, v: number) => ({ cik, period_of_report: period, position_count: 1, total_value_usd: v, null_value_positions: 0, topn_value_usd: v, topn_share_bps: null, hhi: null, flags: [] });
  const typing = (cik: string, name: string, notable: boolean) => ({ cik, display_name: name, person: null, manager_type: "hedge_fund" as const, notable });
  const inst = {
    present: true,
    typingByCik: new Map([
      ["0000000001", typing("0000000001", "Small Notable", true)],
      ["0000000002", typing("0000000002", "Big Plain", false)],
      ["0000000003", typing("0000000003", "Big Notable", true)],
      ["0000000004", typing("0000000004", "Tied Notable", true)],
    ]),
    concentrationByCik: new Map([
      ["0000000001", [conc("0000000001", "2026-03-31", 10)]],
      ["0000000002", [conc("0000000002", "2026-03-31", 999)]],
      ["0000000003", [conc("0000000003", "2026-03-31", 500), conc("0000000003", "2025-12-31", 1)]],
      ["0000000004", [conc("0000000004", "2026-03-31", 500)]],
    ]),
  } as unknown as InstData;
  assert.deepEqual(largestNotableFiler(inst, "2026-03-31"), { cik: "0000000003", name: "Big Notable" }, "a non-notable filer is never picked; the tie goes to the smaller CIK");
  assert.deepEqual(largestNotableFiler(inst, "2025-12-31"), { cik: "0000000003", name: "Big Notable" });
  assert.equal(largestNotableFiler(inst, "2024-12-31"), null);
  assert.equal(largestNotableFiler(inst, null), null);
  assert.equal(largestNotableFiler({ present: false, reason: "module-absent" }, "2026-03-31"), null);
});

/* ---------------------------------------------------------------- R16 */

function cards(html: string): MiniElement[] {
  return domOf(html).querySelectorAll("article.si-card");
}

test("R16: the triage's committee card, largest purchase and largest sale, each opening its row on /signals/, with every field", () => {
  const { triage } = goldenTriage();
  const html = homeLeadHtml(triage, {}, 90);
  const arts = cards(html);
  assert.deepEqual(arts.map((a) => a.getAttribute("data-card")), HOME_LEAD_CARDS.map((c) => c.card));
  assert.deepEqual(arts.map((a) => a.getAttribute("data-card")), ["committee", "buy", "sell"]);
  const picks = [triage.cards.committee, triage.cards.buyRecord, triage.cards.sellRecord];
  arts.forEach((a, i) => {
    const pick = picks[i];
    if (!pick) {
      assert.ok(a.querySelector("[data-empty-state]"), `card ${i}: an absent pick states its absence`);
      return;
    }
    const open = a.querySelector("a.si-card-open")!;
    assert.equal(open.getAttribute("href"), `/signals/#${triageRowId(pick.row)}`, "the card opens its row on /signals/");
    const t = pick.line.txn;
    assert.equal(visibleText(a.querySelector(".si-card-h .mono-ticker")!), t.ticker ?? "no ticker");
    assert.ok(a.querySelector(".si-card-h .si-chip"), "side");
    assert.ok(visibleText(a.querySelector(".si-card-amt")!).length > 0, "range");
    assert.ok(a.querySelector(".si-card-iss .asset-line"), "the asset as filed");
    assert.ok(a.querySelector(".si-card-who .aff"), "member with party and state");
    assert.ok(a.querySelector(".si-card-who .owner-note"), "the owner word");
    const dates = visibleText(a.querySelector(".si-card-dates")!);
    assert.match(dates, /traded .* · filed \d{4}-\d{2}-\d{2}/, "both dates");
    assert.equal(visibleText(a.querySelector(".si-card-fact")!), pick.fact);
    assert.ok(a.querySelector(".si-card-src"), "the receipt");
  });
  assert.equal(visibleText(arts[0]!.querySelector(".si-card-context")!), COMMITTEE_CAVEAT, "DV1: the committee caveat stays");
  assert.match(visibleText(domOf(html).querySelector(".panel-head")!), /not a forecast/, "R2: signals are facts, not forecasts");
});

test("R16 (LD15): one card renderer, two callers — the home body is the Signals body plus the /signals/ prefix and the asset line", () => {
  const { triage } = goldenTriage();
  for (const card of ["committee", "buy", "sell"] as const) {
    const signals = leadCardBodyHtml(triage, card, "record", {});
    const home = leadCardBodyHtml(triage, card, "record", {}, { rowHref: "/signals/", asset: true });
    const back = home.replace(/href="\/signals\/#/g, 'href="#').replace(/<p class="si-card-iss">[\s\S]*?<\/p>/, "");
    assert.equal(back, signals, card);
    assert.ok(homeLeadHtml(triage, {}, 90).includes(home), `${card}: the home renders that body`);
  }
});

test("R16: a null triage states each card's absence and keeps the committee caveat", () => {
  const arts = cards(homeLeadHtml(null, {}, 90));
  assert.equal(arts.length, 3);
  for (const a of arts) assert.match(visibleText(a), /not computed in this view/);
  assert.ok(arts[0]!.querySelector(".si-card-context"));
  assert.equal(domOf(homeLeadHtml(null, {}, 90)).querySelectorAll("a.si-card-open").length, 0);
});

/* ---------------------------------------------------------------- R17 */

test("R17: no cadence claim and no inaccurate source claim; the sources are named", () => {
  const hero = homeHeroCopyHtml([]) + HOME_KICKER;
  const trust = homeTrustHtml({ default: { source_mix: { kadoa_count: 250 } } });
  for (const text of [hero, trust, homeLedgerHtml(homeFigures(inputs()))]) {
    assert.doesNotMatch(text, /daily|every day|Rebuilt every|Nothing secondhand|secondhand|never sold/i);
  }
  assert.ok(HOME_CLAIM.split(/\s+/).length <= 12);
  assert.equal(HOME_KICKER, "Free · primary sources");
  assert.match(HOME_LEDE, /13F holdings/);
  for (const name of ["House Clerk", "Senate eFD", "SEC EDGAR", "congress-legislators", "CC0", "on each publish", "jurisdiction map is this site"]) {
    assert.ok(trust.includes(name), name);
  }
  assert.match(trust, /250 older rows come from an MIT-licensed backfill seed/, "the secondhand seed is stated with its count");
  assert.doesNotMatch(homeTrustHtml({}), /backfill seed/, "…and only when the build carries it");
  assert.match(trust, /<a href="\/methodology\/#sources">Sources &amp; licenses ↗<\/a>/);
});

test("R17 (LD17): the chips equal the search panel's own ranking, plus the largest notable filer; never literals", () => {
  const members = [
    { bioguide: "M000001", name: "Quiet Member", aff: "D–VT", rows: 2 },
    { bioguide: "M000002", name: "Busy Member", aff: "R–TX", rows: 40 },
    { bioguide: "M000003", name: "Tied Member", aff: "D–NY", rows: 40 },
    { bioguide: "M000004", name: "Mid Member", aff: "R–FL", rows: 9 },
  ];
  const tickers = [
    { ticker: "AAA", name: "", rows: 3 },
    { ticker: "BBB", name: "", rows: 50 },
    { ticker: "CCC", name: "", rows: 12 },
    { ticker: "bad ticker", name: "", rows: 999 },
  ];
  const index: SearchIndex = buildSearchIndex(members, tickers, []);
  const chips = homeTryChips(index, { name: "Notable Filer", href: "/institutional/filers/0000000009/" }, {});
  // independent recompute: rows desc, ties in index order; the index refuses an unclean ticker
  assert.deepEqual(chips.map((c) => [c.kind, c.label]), [
    ["ticker", "BBB"], ["ticker", "CCC"], ["member", "Busy Member"], ["member", "Tied Member"], ["filer", "Notable Filer"],
  ]);
  assert.deepEqual(chips.slice(0, 4).map((c) => c.href), ["/tickers/BBB/", "/tickers/CCC/", "/congress/members/M000002/", "/congress/members/M000003/"]);
  // the search panel's starters name the same four, in the same order
  const starters = [...renderPreQuery(index).matchAll(/class="quick-link" href="([^"]+)">([^<]+)</g)].map((m) => [m[1], m[2]]);
  assert.deepEqual(starters, chips.slice(0, 4).map((c) => [c.href, c.label]));
  // a budget-cut entity's chip follows its /e/ route
  assert.match(homeTryChips(index, null, { cutTickers: new Set(["BBB"]) })[0]!.href, /^\/e\//);
  const html = homeTryChipsHtml(chips);
  assert.match(html, /aria-label="Try: the most active tickers and members in this build, and the notable 13F filer reporting the largest value"/);
  assert.match(html, /data-scroll-region="Try · swipe for more"/, "R10: a named quick-picks strip");
  assert.equal(homeTryChipsHtml([]), "", "no chips, no row");
  assert.doesNotMatch(homeTryChipsHtml(chips.slice(0, 4)), /13F filer reporting/, "the name says only what the chips are");
});

test("R17 (LD17, DV14): the hero search is a launcher into #site-search; no second combobox or input exists", () => {
  const hero = domOf(homeHeroCopyHtml([]));
  const launcher = hero.querySelector("a.home-search")!;
  assert.equal(launcher.getAttribute("href"), "#site-search");
  assert.ok(launcher.hasAttribute("data-search-launcher"));
  const all = fullHome() + PAGE;
  assert.doesNotMatch(all, /role="combobox"|<input\b|<form\b/, "the masthead combobox is the only search");
  const client = readFileSync(path.join(SRC, "scripts", "search-client.ts"), "utf-8");
  assert.match(client, /initSearchLaunchers\(\);/, "initSearch binds the launchers");
  assert.match(client, /closest\("#site-search-box, \[data-search-launcher\]"\)/, "a launcher press is not an outside click");
});

test("R17: launchSearch focuses the combobox, or opens the folded masthead search through its own toggle", () => {
  const calls: string[] = [];
  const input = (rects: number) => ({ focus: () => calls.push("focus"), getClientRects: () => ({ length: rects }) });
  const box = (open: boolean) => ({ classList: { contains: (t: string) => t === "open" && open } });
  const toggle = { click: () => calls.push("toggle") };
  assert.equal(launchSearch({ input: input(1), box: box(false), toggle }), "focused");
  assert.deepEqual(calls.splice(0), ["focus"]);
  assert.equal(launchSearch({ input: input(0), box: box(false), toggle }), "opened", "phones: the sheet opens through the masthead toggle");
  assert.deepEqual(calls.splice(0), ["toggle"]);
  assert.equal(launchSearch({ input: input(0), box: box(true), toggle }), "focused", "an open sheet is focused, never toggled shut");
  assert.deepEqual(calls.splice(0), ["focus"]);
  assert.equal(launchSearch({ input: null, box: null, toggle: null }), "none");
});

/* ---------------------------------------------------------------- R2, R40, wording, R3 */

test("R2: the tables keep their honesty fields — late, partial and owner, the range caveat, the 13F snapshot", () => {
  const congress = domOf(congressTileHtml(fixtureBuild().txns, {}));
  const late = congress.querySelectorAll("tbody tr").find((tr) => tr.getAttribute("data-edge") === "late")!;
  assert.match(late.textContent, /filed late/, "a late row says so to assistive technology");
  assert.match(visibleText(late.children[1]!), /partial · SP/, "a partial sale and its owner ride on the member's line");
  assert.match(congress.querySelectorAll("thead th")[3]!.querySelector(".note-pop")!.textContent, /Statutory range as filed — never an exact amount/);
  const moves = movesTileHtml([move(1)], "2026-03-31", (c) => c, { filingsThrough: "2026-07-31" });
  assert.match(moves, /<p class="caveat-line home-13f-note">Quarter-end snapshot · not current holdings/);
  assert.match(moves, /quarter end \(2026-03-31\), filed up to 45 days later; 13F filings received through 2026-07-31 are in this build/);
});

/** R40: a table without its explicit roles, by part. */
function roleProblems(html: string): string[] {
  const out: string[] = [];
  for (const t of domOf(html).querySelectorAll("table")) {
    if (t.getAttribute("role") !== "table") out.push("table");
    if (!t.hasAttribute("data-card")) out.push("data-card");
    for (const g of [...t.querySelectorAll("thead"), ...t.querySelectorAll("tbody")]) if (g.getAttribute("role") !== "rowgroup") out.push(g.tagName);
    for (const tr of t.querySelectorAll("tr")) if (tr.getAttribute("role") !== "row") out.push("tr");
    for (const th of t.querySelectorAll("th")) if (th.getAttribute("role") !== "columnheader") out.push("th");
    for (const td of t.querySelectorAll("td")) if (td.getAttribute("role") !== "cell") out.push("td");
  }
  return out;
}

test("R40: every home table carries its explicit roles and data-card (a planted role-less row fails)", () => {
  const html = fullHome();
  assert.equal(domOf(html).querySelectorAll("table").length, 2);
  assert.deepEqual(roleProblems(html), []);
  assert.deepEqual(roleProblems('<table role="table" data-card="generic"><tbody role="rowgroup"><tr><td role="cell">x</td></tr></tbody></table>'), ["tr"], "control");
  // each role appears once per element, even if a shared builder adds it later
  assert.doesNotMatch(html, /role="columnheader"[^>]*role="columnheader"/);
});

test("the home passes the banned-wording list and carries no launch-mock literal in its source", () => {
  const html = fullHome();
  assert.deepEqual(scanBannedWording(html), []);
  const text = html.replace(/<[^>]*>/g, " ");
  for (const p of BANNED_PATTERNS) assert.doesNotMatch(text, p.re, p.name);
  /* R3: the mock's numbers and names never appear in the home's SOURCE (the
     golden triage fixture is real public data, so a real name may render) */
  for (const literal of ["Jim Jordan", "Tommy Tuberville", "Berkshire Hathaway", "Bloom Energy", "72,409", "59,844", "9,451", "95.4%", "12:07 UTC", "Nancy Pelosi"]) {
    assert.ok(!PAGE.includes(literal) && !HOME_SRC.includes(literal), literal);
  }
});
