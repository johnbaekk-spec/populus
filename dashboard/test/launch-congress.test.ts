/* Launch redesign — the Congress tab (milestones M3a and M3b of PLAN.md).

   M3a, the feed mechanism (R20, R2, R30; pagination-and-counts.md I7 and rules
   1a, 2a, 2b): the default "With ticker" view, 20 rows a page in both views,
   the one count string stating what the default view hides in every sink, the
   device line and its reset kept on the count line, the server's default page
   equal to the client's default render, and paging that fetches only the part
   or parts holding the requested page.

   Each property test carries a control that re-plants the defect it guards. */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  DESIGN_FEED_PAGE_SIZE,
  feedCountText,
  feedItemHtml,
  mergeFeed,
  pageSlice,
  type PaperRow,
  type RenderCtx,
  type TxnRow,
} from "../src/lib/format.ts";
import {
  classifyTickerOffsets,
  feedItemHasTicker,
  feedPageCount,
  feedPartHref,
  planFeedParts,
  planTickerOffsets,
  tickerPartsForPage,
} from "../src/lib/feed-parts.ts";
import { makeDom, makeElement, type FakeElement } from "./lib/fake-dom.ts";

const PAGE_SRC = readFileSync(
  path.resolve(import.meta.dirname, "..", "src", "pages", "congress", "index.astro"),
  "utf-8",
);

function txn(over: Partial<TxnRow> = {}): TxnRow {
  return {
    kind: "txn", txnId: "t", asset: null, assetType: null,
    filed: "2026-08-01", traded: "2026-07-20", name: "A Member", bioguide: "A000001",
    party: "R", state: "OK", district: null, chamber: "senate", ticker: "WMB",
    side: "purchase", owner: "self", low: 1001, high: 15000, lag: 12, late: 0,
    flags: [], doc: "https://efdsearch.senate.gov/x", ...over,
  };
}
function paper(over: Partial<PaperRow> = {}): PaperRow {
  return {
    kind: "paper", filed: "2026-08-01", name: "Paper Member", bioguide: "P000001",
    party: "D", state: "CT", district: null, chamber: "house",
    doc: "https://disclosures-clerk.house.gov/p", ...over,
  };
}

/** A mixed corpus in feed order: ticker rows, runs of no-ticker rows, paper
    filings, sales and purchases, both chambers — across several filed days. */
function corpus(): { merged: ReturnType<typeof mergeFeed>; txns: TxnRow[]; papers: PaperRow[] } {
  const txns: TxnRow[] = [];
  const papers: PaperRow[] = [];
  for (let i = 0; i < 150; i++) {
    const day = String(28 - Math.floor(i / 8)).padStart(2, "0");
    const noTicker = i % 6 === 2 || (i >= 40 && i < 70);
    txns.push(txn({
      txnId: `t${String(i).padStart(3, "0")}`,
      filed: `2026-07-${day}`,
      ticker: noTicker ? null : `T${i}X`,
      side: i % 3 === 0 ? "sale" : "purchase",
      chamber: i % 2 === 0 ? "house" : "senate",
      name: `Member ${i}`,
      bioguide: `M${String(i).padStart(6, "0")}`,
    }));
    if (i % 17 === 4) papers.push(paper({ filed: `2026-07-${day}`, doc: `https://disclosures-clerk.house.gov/p${i}` }));
  }
  return { merged: mergeFeed(txns, papers), txns, papers };
}

const FEED_IDS = [
  "congress-feed", "feed-tbody", "feed-section", "feed-loading", "feed-empty", "feed-empty-detail",
  "feed-empty-suggestions", "filter-count-line", "pager-range", "feed-status", "filter-reset",
  "filter-reset-wrap", "pager-newer", "pager-older", "feed-parts-index", "feed-ticker-offsets", "filter-q",
];

function segButton(group: string, value: string, pressed: boolean): FakeElement {
  const b = makeElement();
  b.dataset = { group, value };
  b.setAttribute("aria-pressed", String(pressed));
  return b;
}

interface Harness {
  dom: ReturnType<typeof makeDom>;
  buttons: Record<string, FakeElement>;
  received: () => boolean;
  restore: () => void;
}

/** Mount the REAL feed island over a fake DOM carrying the page's islands. */
async function mount(opts: { ceilingBytes?: number; offsets?: unknown } = {}): Promise<Harness & ReturnType<typeof corpus> & { plan: ReturnType<typeof planFeedParts> }> {
  const c = corpus();
  const plan = planFeedParts(c.merged, { build_id: "b", generated_at: null }, opts.ceilingBytes ? { ceilingBytes: opts.ceilingBytes } : {});
  const buttons: Record<string, FakeElement> = {
    "view:ticker": segButton("view", "ticker", true),
    "view:all": segButton("view", "all", false),
    "side:all": segButton("side", "all", true),
    "side:buy": segButton("side", "buy", false),
    "side:sell": segButton("side", "sell", false),
    "side:exch": segButton("side", "exch", false),
    "chamber:all": segButton("chamber", "all", true),
    "chamber:house": segButton("chamber", "house", false),
  };
  const all = Object.values(buttons);
  const selectors: Record<string, FakeElement[]> = { ".seg button[data-group]": all };
  for (const g of ["view", "side", "chamber"]) {
    selectors[`.seg button[data-group="${g}"]`] = all.filter((b) => b.dataset.group === g);
  }
  const dom = makeDom(FEED_IDS, selectors);
  dom.elements.get("congress-feed")!.dataset = { txnCount: String(c.txns.length) };
  dom.elements.get("feed-parts-index")!.textContent = JSON.stringify(plan.index);
  dom.elements.get("feed-ticker-offsets")!.textContent = JSON.stringify(opts.offsets ?? planTickerOffsets(c.merged, plan.index));
  const byHref = new Map<string, unknown>();
  for (const [part, body] of plan.bodies) byHref.set(feedPartHref(part), JSON.parse(body));
  const restoreFetch = dom.install((url: string) => byHref.get(url) ?? plan.index);
  const g = globalThis as Record<string, unknown>;
  const prior = { HTMLElement: g.HTMLElement, HTMLButtonElement: g.HTMLButtonElement };
  g.HTMLElement = class {};
  g.HTMLButtonElement = class {};
  const { initFeed } = await import("../src/scripts/feed-client.ts");
  let got = false;
  initFeed({ onRows: () => { got = true; } });
  return {
    ...c, plan, dom, buttons,
    received: () => got,
    restore: () => {
      g.HTMLElement = prior.HTMLElement;
      g.HTMLButtonElement = prior.HTMLButtonElement;
      restoreFetch();
    },
  };
}

async function settle(dom: ReturnType<typeof makeDom>): Promise<void> {
  for (let i = 0; i < 4; i++) await dom.flush();
}

function sinks(dom: ReturnType<typeof makeDom>): string[] {
  return ["filter-count-line", "pager-range", "feed-status"].map((id) => dom.elements.get(id)!.textContent);
}

/** The server's default page and count, through the SAME expressions the page
    evaluates (asserted against the page source below). */
function serverDefault(merged: ReturnType<typeof mergeFeed>, offsets: ReturnType<typeof planTickerOffsets>): { rows: string; count: string } {
  const ssrCtx: RenderCtx = { cutMembers: new Set(), cutTickers: new Set() };
  const tickerView = merged.filter(feedItemHasTicker);
  const pageOne = pageSlice(tickerView, 0, DESIGN_FEED_PAGE_SIZE);
  return {
    rows: pageOne.map((item) => feedItemHtml(item, ssrCtx)).join("\n"),
    count: feedCountText({
      page: 0,
      pageSize: DESIGN_FEED_PAGE_SIZE,
      txnMatched: offsets.ticker_total,
      paperMatched: 0,
      txnOnPage: pageOne.filter((i) => i.kind === "txn").length,
      paperOnPage: 0,
      txnTotal: offsets.ticker_total,
      indeterminate: 0,
      view: { noun: "transactions with a ticker", hiddenNoTicker: offsets.no_ticker_total, hiddenPaper: offsets.paper_total },
    }),
  };
}

/* ===================================================== M3a — the feed */

test("R20: the page renders the default view through the expressions this suite replays", () => {
  assert.match(PAGE_SRC, /const tickerOffsets = planTickerOffsets\(build\.merged, partsIndex\);/);
  assert.match(PAGE_SRC, /const tickerView = build\.merged\.filter\(feedItemHasTicker\);/);
  assert.match(PAGE_SRC, /const pageOne = pageSlice\(tickerView, 0, DESIGN_FEED_PAGE_SIZE\);/);
  assert.match(PAGE_SRC, /txnMatched: tickerOffsets\.ticker_total,/);
  assert.match(PAGE_SRC, /hiddenNoTicker: tickerOffsets\.no_ticker_total,\s*hiddenPaper: tickerOffsets\.paper_total,/);
  assert.match(PAGE_SRC, /noun: TICKER_VIEW_NOUN,/);
  assert.match(PAGE_SRC, /<script is:inline type="application\/json" id="feed-ticker-offsets" set:html=\{tickerOffsetsJson\} \/>/);
  assert.equal(DESIGN_FEED_PAGE_SIZE, 20, "20 rows a page (LD20)");
});

test("R2/R20: the count line keeps \"filtered on this device\" and its reset control, beside the one count", () => {
  assert.match(
    PAGE_SRC,
    /<span id="filter-count-line">\{rangeText\}<\/span>\{" · filtered on this device"\}<span\s+id="filter-reset-wrap"\s+hidden>\{" · "\}<button class="linklike" id="filter-reset">reset<\/button><\/span>/,
  );
  /* launch F2 (SC5, congress-23's pager): the pager sink keeps the same
     string for assistive technology and paging focus, visually hidden — the
     count line above the table states it once on screen */
  assert.match(PAGE_SRC, /<span class="pager-range visually-hidden" id="pager-range" tabindex="-1">\{rangeText\}<\/span>/, "the pager sink starts on the same string");
  assert.match(PAGE_SRC, /id="feed-status" role="status" aria-live="polite"/, "the live region is the third sink");
  // control: a page that dropped the device line would fail the first assertion
  assert.doesNotMatch(PAGE_SRC.replace(" · filtered on this device", ""), /filtered on this device/);
});

test("R20: views and quick filters — With ticker / All rows, Buys / Sells, Both / House / Senate; the text filter on its own row; the rest under More filters", () => {
  const bar = PAGE_SRC.slice(PAGE_SRC.indexOf('<div class="filterbar"'), PAGE_SRC.indexOf('<div class="filter-count">'));
  const quick = bar.slice(bar.indexOf('<div class="filter-quick">'), bar.indexOf('<div class="filter-group filter-search">'));
  for (const [g, v, label] of [["view", "ticker", "With ticker"], ["view", "all", "All rows"], ["side", "all", "All"], ["side", "buy", "Buys"], ["side", "sell", "Sells"], ["chamber", "all", "Both"], ["chamber", "house", "House"], ["chamber", "senate", "Senate"]]) {
    assert.match(quick, new RegExp(`data-group="${g}" data-value="${v}"[^>]*>${label}<`), `${g}:${v} is a quick control`);
  }
  assert.match(quick, /data-value="ticker" aria-pressed="true"/, "With ticker is the default");
  const more = bar.slice(bar.indexOf('<details class="advanced-filters"'));
  for (const id of ["filter-amount", "filter-owner", "filter-late", "filter-date-basis", "filter-date-from", "filter-date-to"]) {
    assert.ok(more.includes(`id="${id}"`), `${id} stays under More filters`);
  }
  assert.match(more, /data-group="party"/, "Party stays under More filters (DV17)");
  assert.match(more, /data-group="side" data-value="exch"[^>]*>EXCHANGE</, "the EXCHANGE side stays under More filters (DV17)");
  const search = bar.slice(bar.indexOf('<div class="filter-group filter-search">'), bar.indexOf('<details class="advanced-filters"'));
  assert.match(search, /id="filter-q"/, "the text filter stands on its own row, outside More filters");
  assert.ok(!more.includes('id="filter-q"'));
});

test("I7 + R20: the server's default page equals the client's default render, and the one count reaches all three sinks", async () => {
  const h = await mount();
  try {
    const offsets = planTickerOffsets(h.merged, h.plan.index);
    const server = serverDefault(h.merged, offsets);
    assert.ok(offsets.no_ticker_total > 0 && offsets.paper_total > 0, "the fixture hides both populations");
    assert.match(server.count, /^1–20 of [\d,]+ transactions with a ticker · [\d,]+ without a ticker and \d+ paper filings are in All rows$/);
    // page 2, then back to page 1 — the client's own default render
    h.dom.elements.get("pager-older")!.click();
    await settle(h.dom);
    h.dom.elements.get("pager-newer")!.click();
    await settle(h.dom);
    assert.equal(h.dom.elements.get("feed-tbody")!.innerHTML, server.rows, "byte-identical rows");
    assert.deepEqual(sinks(h.dom), [server.count, server.count, server.count], "one string, every sink (I6, I7)");
    assert.equal(h.received(), false, "default paging never decodes the full corpus");
    // control: the All-rows first page is a different page — parity is not vacuous
    const allRows = pageSlice(h.merged, 0, 20).map((i) => feedItemHtml(i, {})).join("\n");
    assert.notEqual(allRows, server.rows);
  } finally {
    h.restore();
  }
});

test("rule 2b: paging the default view fetches ONLY the part or parts holding each page — a fetch spy", async () => {
  const h = await mount({ ceilingBytes: 3_000 });
  try {
    const offsets = planTickerOffsets(h.merged, h.plan.index);
    assert.ok(h.plan.index.parts.length >= 8, "many parts");
    const expected = new Set<string>();
    let spanned = 0;
    for (let page = 1; page <= 2; page++) {
      h.dom.elements.get("pager-older")!.click();
      await settle(h.dom);
      const holding = tickerPartsForPage(offsets, page, 20);
      if (holding.length > 1) spanned++;
      for (const p of holding) expected.add(feedPartHref(p.part));
      assert.deepEqual(new Set(h.dom.fetchCalls), expected, `after page ${page + 1}, exactly the holding parts were fetched`);
      const body = h.dom.elements.get("feed-tbody")!.innerHTML;
      assert.equal((body.match(/<tr\b/g) ?? []).length, 20, `page ${page + 1} holds twenty rows`);
      assert.doesNotMatch(body, /reference-paper/, "no paper filing in the With ticker view");
      assert.doesNotMatch(body, /<span class="none">—<\/span>/, "no ticker-less row in the With ticker view");
    }
    assert.ok(spanned > 0, "a page spanning two parts was exercised");
    assert.ok(h.dom.fetchCalls.length < h.plan.index.parts.length, `never the whole corpus (${h.dom.fetchCalls.length} of ${h.plan.index.parts.length} parts)`);
    assert.equal(h.received(), false);
  } finally {
    h.restore();
  }
});

test("rule 2a: All rows pages 20 rows from part metadata — every page reachable, paper filings shown and counted", async () => {
  const h = await mount({ ceilingBytes: 6_000 });
  try {
    h.buttons["view:all"]!.click();
    await settle(h.dom);
    assert.equal(h.buttons["view:all"]!.getAttribute("aria-pressed"), "true");
    const first = h.dom.elements.get("pager-range")!.textContent;
    assert.match(first, /^1–20 of 150 transactions · \d+ paper filings/, first);
    assert.doesNotMatch(first, /All rows/, "All rows hides nothing, so it states nothing hidden");
    const pages = feedPageCount(h.plan.index, 20);
    assert.ok(pages > Math.ceil(h.plan.index.item_total / 50), "more pages than the index's 50-row page_count");
    let reached = 1;
    while (h.dom.elements.get("pager-older")!.getAttribute("aria-disabled") !== "true" && reached < 50) {
      h.dom.elements.get("pager-older")!.click();
      await settle(h.dom);
      reached++;
    }
    assert.equal(reached, pages, "the last reachable page is the position-derived page count");
    assert.equal(h.received(), false, "unfiltered All rows paging never loads the corpus");
  } finally {
    h.restore();
  }
});

test("I7: a quick filter keeps the full-corpus path and states the hidden matches as whole-set figures", async () => {
  const h = await mount();
  try {
    h.buttons["side:buy"]!.click();
    await settle(h.dom);
    assert.equal(h.received(), true, "a quick filter loads the corpus (TD-L1)");
    const buys = h.txns.filter((r) => r.side === "purchase");
    const withTicker = buys.filter((r) => r.ticker).length;
    const without = buys.length - withTicker;
    const expected = `1–20 of ${withTicker} transactions with a ticker · ${without} without a ticker are in All rows`;
    assert.deepEqual(sinks(h.dom), [expected, expected, expected], "paper filings are not stated: All rows would hide them under a side filter too");
    // switching to All rows shows the purchases with and without a ticker
    h.buttons["view:all"]!.click();
    await settle(h.dom);
    assert.match(h.dom.elements.get("pager-range")!.textContent, new RegExp(`^1–20 of ${buys.length} transactions$`));
  } finally {
    h.restore();
  }
});

test("I7: reset returns to the default view, and the count states the hidden populations again", async () => {
  const h = await mount();
  try {
    h.buttons["view:all"]!.click();
    await settle(h.dom);
    h.buttons["chamber:house"]!.click();
    await settle(h.dom);
    h.dom.elements.get("filter-reset")!.click();
    await settle(h.dom);
    assert.equal(h.buttons["view:ticker"]!.getAttribute("aria-pressed"), "true", "the default view is pressed");
    assert.equal(h.buttons["view:all"]!.getAttribute("aria-pressed"), "false");
    assert.equal(h.buttons["chamber:all"]!.getAttribute("aria-pressed"), "true");
    assert.match(h.dom.elements.get("filter-count-line")!.textContent, /transactions with a ticker · \d+ without a ticker and \d+ paper filings are in All rows$/);
  } finally {
    h.restore();
  }
});

test("rule 2b: an offsets island that does not match the part index is refused, and the view pages from the corpus", async () => {
  const c = corpus();
  const plan = planFeedParts(c.merged, { build_id: "b", generated_at: null }, { ceilingBytes: 6_000 });
  const good = planTickerOffsets(c.merged, plan.index);
  assert.ok(classifyTickerOffsets(good, plan.index));
  const renamed = { ...good, parts: good.parts.map((p, i) => (i === 0 ? { ...p, part: "1999-1" } : p)) };
  assert.equal(classifyTickerOffsets(renamed, plan.index), null, "a part name out of step is refused");
  assert.equal(classifyTickerOffsets({ ...good, build_id: "other" }, plan.index), null, "another build's map is refused");
  assert.equal(classifyTickerOffsets({ ...good, parts: good.parts.slice(1) }, plan.index), null, "a short map is refused");
  const h = await mount({ ceilingBytes: 6_000, offsets: renamed });
  try {
    h.dom.elements.get("pager-older")!.click();
    await settle(h.dom);
    assert.equal(h.received(), true, "with no usable map, the view pages from the corpus");
    assert.match(h.dom.elements.get("pager-range")!.textContent, /^21–40 of \d+ transactions with a ticker · /);
  } finally {
    h.restore();
  }
});

test("rule 2b: the offsets builder refuses a plan that does not cover the feed", () => {
  const c = corpus();
  const plan = planFeedParts(c.merged, { build_id: "b", generated_at: null }, { ceilingBytes: 6_000 });
  assert.throws(() => planTickerOffsets(c.merged.slice(1), plan.index), /does not match the merged feed/);
});

test("LD22 + R40: the feed head reads Side · Member · Ticker · Asset · owner · Range · Size · Traded → filed · Src, with explicit roles", async () => {
  const { feedHeadHtml, txnRowHtml, paperRowHtml } = await import("../src/lib/format.ts");
  const head = feedHeadHtml({ activeKey: "filed", activeDir: "desc", notes: { scope: "congress-feed" } });
  const labels = [...head.matchAll(/<th\b[^>]*>([\s\S]*?)<\/th>/g)].map((m) =>
    m[1]!.replace(/<span class="note-pop"[\s\S]*?<\/span><\/span>/g, "").replace(/<span class="th-abbr"[^>]*>[^<]*<\/span>/g, "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim(),
  );
  assert.deepEqual(labels.map((l) => l.replace(/\s*[▲▼↕].*$/, "")), ["Side", "Member", "Ticker", "Asset · owner", "Range", "Size", "Traded → filed", "Src"]);
  assert.equal((head.match(/role="columnheader"/g) ?? []).length, 8, "every column head carries its role");
  assert.match(head, /^<thead role="rowgroup"><tr [^>]*role="row">/);
  for (const html of [txnRowHtml(txn(), {}), paperRowHtml(paper(), {})]) {
    const cells = html.match(/<td\b[^>]*>/g) ?? [];
    assert.ok(cells.length > 0 && cells.every((c) => /role="cell"/.test(c)), "every cell carries role=cell");
    assert.match(html, /^<tr [^>]*role="row">/);
  }
  assert.match(PAGE_SRC, /<table class="feed-table reference-feed" role="table" data-card="feed">/);
  assert.match(PAGE_SRC, /<tbody id="feed-tbody" role="rowgroup"/);
  // the paper row keeps "Paper" in the Side column
  assert.match(paperRowHtml(paper(), {}), /c-kind" role="cell">Paper</);
  // control: a role-less row is caught by the same check
  const planted = txnRowHtml(txn(), {}).replace(/ role="cell"/, "");
  assert.ok(!(planted.match(/<td\b[^>]*>/g) ?? []).every((c) => /role="cell"/.test(c)));
});

/* ===================================================== M3b — the page */

import { pct } from "../src/lib/data.ts";
import { congressTickersRollup, leadersRollup } from "../src/lib/derive.ts";
import { congressRankingSection, CONGRESS_ROOTS, monthlyFlowPanel, type BuildStamps } from "../src/lib/ui/index.ts";
import { congressLedgerFigures, congressLedgerItems } from "../src/lib/ui/rankings.ts";
import { domOf, visibleText } from "./lib/ledger-dom.ts";

const BUILD_DATE = "2026-08-23";
const STAMPS: BuildStamps = { buildId: "b", generatedAt: "2026-08-23 06:00 UTC", generatedAtDate: BUILD_DATE };

function ledgerFixture(): TxnRow[] {
  return [
    txn({ txnId: "a", filed: "2026-08-23", bioguide: "A000001", lag: 10, late: 0 }),
    txn({ txnId: "b", filed: "2026-07-25", bioguide: "B000002", lag: 50, late: 1 }), // day 30 of the window: in
    txn({ txnId: "c", filed: "2026-07-24", bioguide: "C000003", lag: 20, late: 0 }), // 30 days before: out
    txn({ txnId: "d", filed: "2026-08-01", bioguide: "A000001", lag: 46, late: 1 }), // same member again
    txn({ txnId: "e", filed: "2026-08-10", bioguide: null, name: "Unjoined Filer", lag: null, late: null, side: "exchange" }),
    txn({ txnId: "f", filed: "2024-01-05", bioguide: "D000004", lag: 5, late: 0 }),
  ];
}

test("R18: every ledger figure equals an independent recomputation from the rows and coverage", () => {
  const rows = ledgerFixture();
  const fig = congressLedgerFigures(rows, { buildDate: BUILD_DATE, filedFrom: "2014" });
  // independent recompute
  const inWindow = rows.filter((r) => Date.parse(`${BUILD_DATE}T00:00:00Z`) - Date.parse(`${r.filed}T00:00:00Z`) < 30 * 86_400_000 && r.filed <= BUILD_DATE);
  assert.deepEqual(inWindow.map((r) => r.txnId).sort(), ["a", "b", "d", "e"], "the 30 days ending on the build date, inclusive");
  assert.equal(fig.trades, rows.length);
  assert.equal(fig.last30.rows, inWindow.length);
  assert.equal(fig.last30.members, new Set(inWindow.filter((r) => r.bioguide).map((r) => r.bioguide)).size, "joined members only");
  assert.equal(fig.last30.unjoined, 1, "the unjoined filer is stated, never counted as a member");
  assert.equal(fig.last30.from, "2026-07-25");
  const lags = rows.map((r) => r.lag).filter((l): l is number => l != null).sort((x, y) => x - y);
  assert.equal(fig.lag.median, lags.length % 2 ? lags[(lags.length - 1) / 2] : Math.round((lags[lags.length / 2 - 1]! + lags[lags.length / 2]!) / 2));
  assert.equal(fig.lag.late, rows.filter((r) => r.late === 1).length);
  assert.equal(fig.lag.withStatus, rows.filter((r) => r.late !== null).length, "rows with a late status — the exchange row has none");
  const coverage = { houseParsed: 5600, houseEfile: 5960, housePct: pct(5600, 5960), senateParsed: 1828, senateEfile: 1828, senatePct: pct(1828, 1828), needsOcr: 3061, efilePct: pct(5600 + 1828, 5960 + 1828) };
  assert.equal(coverage.efilePct, "95.3", "floored, never the mock's 95.4");
  const items = congressLedgerItems(fig, coverage, pct);
  assert.deepEqual(items.map((i) => [i.label, i.value, i.detail]), [
    ["Trades", "6", "since 2014"],
    ["Last 30 days", "4", "2 members filed"],
    ["Median lag", "20 days", `${pct(2, 5)}% filed late`],
    ["E-filings read", "95.3%", "3,061 paper not yet read"],
  ]);
  assert.match(items[2]!.noteHtml!, /Filed late: 2 of 5 rows with a late status \(40\.0%\)/, "N of M in the tip");
  /* launch review H8: the Trades figure counts every row, so its tip names All rows, never the default (With ticker) view */
  assert.equal(congressLedgerFigures([txn({ ticker: null }), txn({})], { buildDate: BUILD_DATE, filedFrom: "2014" }).trades, 2, "a row without a ticker counts in Trades");
  assert.match(items[0]!.noteHtml!, /^Transactions in All rows \(with or without a ticker; the default With ticker view shows only those with one\), filed since 2014:/);
  assert.doesNotMatch(items[0]!.noteHtml!, /in the default view/, "re-planted control: the reviewed wording is gone");
  assert.match(items[1]!.noteHtml!, /2026-07-25 to 2026-08-23 inclusive/);
  assert.match(items[1]!.noteHtml!, /and 1 filer not yet matched to a member record/);
  assert.match(items[3]!.noteHtml!, /House: 5,600 of 5,960 e-filings read \(93\.9%\)\. Senate: 1,828 of 1,828 \(100%\)\. 3,061 paper filings are counted but not machine-read until OCR/);
  // control: moving the boundary row one day earlier drops it from the window
  const shifted = congressLedgerFigures(rows.map((r) => (r.txnId === "b" ? { ...r, filed: "2026-07-24" } : r)), { buildDate: BUILD_DATE, filedFrom: "2014" });
  assert.equal(shifted.last30.rows, fig.last30.rows - 1);
});

test("R18: a build with no lag states its absence, never a zero", () => {
  const fig = congressLedgerFigures([txn({ lag: null, late: null })], { buildDate: BUILD_DATE, filedFrom: "2026" });
  const items = congressLedgerItems(fig, { houseParsed: 0, houseEfile: 0, housePct: "—", senateParsed: 0, senateEfile: 0, senatePct: "—", needsOcr: 0, efilePct: "—" }, pct);
  assert.equal(items[2]!.value, "—");
  assert.equal(items[2]!.detail, "—% filed late");
  assert.match(items[2]!.noteHtml!, /No row discloses both dates/);
});

function boardRows(): TxnRow[] {
  const rows: TxnRow[] = [];
  for (let i = 0; i < 70; i++) {
    rows.push(txn({ txnId: `p${i}`, bioguide: `M${String(i).padStart(6, "0")}`, name: `Member ${i}`, ticker: `T${i % 30}`, traded: "2026-06-01", filed: "2026-07-01", low: 1001 * (i + 1), high: 15000 * (i + 1), late: i % 4 === 0 ? 1 : 0 }));
    if (i % 3 === 0) rows.push(txn({ txnId: `s${i}`, bioguide: `M${String(i).padStart(6, "0")}`, name: `Member ${i}`, ticker: `T${i % 30}`, side: "sale", traded: "2026-06-02", filed: "2026-07-01", low: 1001, high: 15000, late: null }));
  }
  rows.push(txn({ txnId: "u", bioguide: "U000001", name: "Undisclosed", low: null, high: null, traded: "2026-06-03" }));
  rows.push(txn({ txnId: "nt", bioguide: "N000001", name: "No Ticker", ticker: null, traded: "2026-06-04" }));
  return rows;
}

function boards(): { members: string; tickers: string } {
  const ctx = { referenceRankings: true };
  const rows = boardRows();
  return {
    members: congressRankingSection("leaders", leadersRollup(rows, BUILD_DATE, { range: "12m", basis: "traded" }), STAMPS, ctx, {
      rootId: CONGRESS_ROOTS.membersRanked, undisclosedRootId: CONGRESS_ROOTS.membersUndisclosed, heading: "Members", sectionId: "members-section", compact: 10,
    }),
    tickers: congressRankingSection("tickers", congressTickersRollup(rows, BUILD_DATE, { range: "12m", basis: "traded" }), STAMPS, ctx, {
      rootId: CONGRESS_ROOTS.momentum, heading: "Tickers", sectionId: "momentum-section", controls: true, compact: 10,
    }),
  };
}

function headLabels(html: string): string[] {
  const at = html.indexOf("<thead");
  const head = domOf(html.slice(at, html.indexOf("</thead>", at) + 8));
  return head.querySelectorAll("th").map((th) => {
    const btn = th.querySelector(".th-sort") ?? th.querySelector(".note-label") ?? th;
    // the abbreviation twin (`.th-abbr`, shown only on narrow screens) is dropped
    const full = btn.querySelector(".th-full");
    return visibleText(full ?? btn).replace(/\s+/g, " ").trim();
  });
}

test("R19/LD19: the Members board reads # · Member · Trades · Buys · Sells · Net · Late, Late as \"N of M\", gross ranges in each Net note", () => {
  const { members } = boards();
  assert.deepEqual(headLabels(members), ["#", "Member", "Trades", "Buys", "Sells", "Net", "Late"]);
  const body = members.slice(members.indexOf(`<tbody id="${CONGRESS_ROOTS.membersRanked}"`), members.indexOf("</tbody>"));
  const first = body.split("</tr>")[0]!;
  assert.match(first, /<td class="c-num[^"]*" role="cell">\d+ of \d+<\/td>$/, "the last cell, Late, reads N of M");
  assert.equal((first.match(/<td\b/g) ?? []).length, 7, "seven cells");
  assert.match(first, /class="note-pop" popover id="n-board-net-[^"]+" role="note">Purchases \$[\d.,KM]+–\$[\d.,KM]+ · sales (?:none|\$[\d.,KM]+–\$[\d.,KM]+) · net /, "each row's Net opens its purchase and sale ranges");
  assert.doesNotMatch(members, />Gross bought<|>Gross sales<|Gross purch/, "no gross columns on the board");
  // the one merged Net tip keeps the interval, ≈ and unrankable rules
  assert.match(members, /Summed statutory ranges, shown as intervals — no midpoints\. Net = purchases&#39; bounds minus sales&#39; bounds|Summed statutory ranges, shown as intervals — no midpoints\. Net = purchases' bounds minus sales' bounds/);
  assert.match(members, /overlapping intervals are incomparable/);
  // the window: short and visible, the exact bounds and the exclusions in the note
  assert.match(members, /12 months · by trade date · <span class="note">/);
  assert.match(members, /2025-08-24 to 2026-08-23 inclusive\./);
  // the count line: ranked-row grammar, no dataset sentence (congress-20)
  assert.match(members, /<span class="compact-bound-count">1–10 of \d+ ranked members<\/span>/);
  assert.doesNotMatch(members, /published dataset/);
  assert.match(members, /Every amount on one side failed to parse, so these rows are not ranked\./);
  // Show 50 more is the in-place binder, never a link
  assert.match(members, /class="compact-disclosure" data-compact-for="members-ranked-tbody"/);
  /* launch F2 (R35, LD26/LD31): the next step rides in the one island for
     the in-place expansion — never as hidden rows in the DOM */
  assert.match(members, /<script type="application\/json" data-held-for="members-ranked-tbody" data-held-render="congress-ranking">/, "the next rows ride in the island");
  assert.doesNotMatch(members, /<tr hidden/, "no held row is in the DOM");
});

test("R19/LD19: the Tickers board reads # · Ticker · Buys · Sells · Trades · Members · Net", () => {
  const { tickers } = boards();
  assert.deepEqual(headLabels(tickers), ["#", "Ticker", "Buys · Sells", "Trades", "Members", "Net"]);
  assert.match(tickers, /\d+ buys; \d+ sells/, "the count bar states both counts");
  assert.match(tickers, /<span class="compact-bound-count">1–10 of \d+ ranked tickers<\/span>/);
  assert.match(tickers, /the member ranking is keyed by member instead/, "no claim that the member ranking is 'below'");
});

test("R19/R40: board tables carry explicit roles and the ranking card hook", () => {
  const { members, tickers } = boards();
  for (const html of [members, tickers]) {
    assert.match(html, /<table class="etable[^"]*" data-sticky-first role="table" data-card="ranking">/);
    assert.match(html, /<thead role="rowgroup"><tr role="row">/);
    const ths = html.match(/<th\b[^>]*>/g) ?? [];
    assert.ok(ths.length > 0 && ths.every((t) => /role="columnheader"/.test(t) || /scope="row"/.test(t)), "every column head carries its role");
    const tds = html.match(/<td\b[^>]*>/g) ?? [];
    assert.ok(tds.length > 0 && tds.every((t) => /role="cell"/.test(t)), "every cell carries its role");
  }
  // control: a planted role-less cell fails the same check
  const planted = members.replace(/ role="cell"/, "");
  assert.ok(!(planted.match(/<td\b[^>]*>/g) ?? []).every((t) => /role="cell"/.test(t)));
});

test("R19/R22: no link on /congress/ points at the /congress/leaders/ or /congress/tickers/ stubs", () => {
  const { members, tickers } = boards();
  for (const html of [PAGE_SRC, members, tickers, monthlyFlowPanel(boardRows(), BUILD_DATE)]) {
    assert.doesNotMatch(html, /href="\/congress\/(?:leaders|tickers)\/"/);
  }
  assert.doesNotMatch(PAGE_SRC, /All tickers →/, "the mock's All tickers link is not added (DV18)");
  // control: the check sees such a link
  assert.match('<a href="/congress/leaders/">x</a>', /href="\/congress\/(?:leaders|tickers)\/"/);
});

test("R22: the stub pages keep a visible working link to their section, with one line of copy", () => {
  for (const [file, target, label] of [["leaders", "/congress/#members-section", "Go to Members →"], ["tickers", "/congress/#momentum-section", "Go to Tickers →"]]) {
    const src = readFileSync(path.resolve(import.meta.dirname, "..", "src", "pages", "congress", file, "index.astro"), "utf-8");
    assert.match(src, new RegExp(`const target = "${target.replace(/[/#]/g, (c) => `\\${c}`)}";`));
    assert.match(src, new RegExp(`<a class="stub-link" href=\\{target\\}>${label}</a>`), `${file}: the visible link`);
    assert.match(src, /<meta http-equiv="refresh" content="0; url=\$\{target\}" \/>/, `${file}: the refresh still targets the section`);
    assert.doesNotMatch(src, /class="kicker"|caveat-line/, `${file}: kicker and caveat cut (stub-0x)`);
  }
});

test("R22: the briefing cards and the Notes drawer are retired; the method links are nouns", () => {
  assert.doesNotMatch(PAGE_SRC, /briefingCards\(|briefingHtml|<details class="design-supplement" id="congress-notes">/);
  const links = PAGE_SRC.slice(PAGE_SRC.indexOf('<details class="method-links"'), PAGE_SRC.indexOf("</details>", PAGE_SRC.indexOf('<details class="method-links"')));
  assert.match(links, /<summary>Method<\/summary>/);
  const labels = [...links.matchAll(/<a href="\/methodology\/#([a-z-]+)">([^<]+)<\/a>/g)].map((m) => [m[1], m[2]]);
  assert.deepEqual(labels, [["defaults", "Amendments ↗"], ["coverage", "Coverage ↗"], ["amount-ranges", "Ranges ↗"], ["filing-lag", "45-day lag ↗"], ["owner-codes", "Owner codes ↗"]]);
  assert.match(PAGE_SRC, /Filed up to 45 days after the trade · amounts are statutory ranges\n/, "the page's one home for the 45-day and ranges caveats");
  assert.match(PAGE_SRC, /As of \{build\.generatedAt\} · House Clerk \+ Senate eFD/);
  assert.doesNotMatch(PAGE_SRC, /class="kicker"/, "the kicker is cut (congress-01)");
  assert.match(PAGE_SRC, /Every trade members of Congress disclose, as filed\./);
});

test("§0/R30: the new Congress copy carries no banned word", async () => {
  const { BANNED_PATTERNS, redactFiledNames } = await import("./lib/banned-scan.ts");
  const { members, tickers } = boards();
  const { feedHeadHtml } = await import("../src/lib/format.ts");
  const items = congressLedgerItems(congressLedgerFigures(ledgerFixture(), { buildDate: BUILD_DATE, filedFrom: "2014" }), { houseParsed: 1, houseEfile: 2, housePct: "50.0", senateParsed: 1, senateEfile: 1, senatePct: "100", needsOcr: 1, efilePct: "66.6" }, pct);
  const copy = [
    members, tickers, monthlyFlowPanel(boardRows(), BUILD_DATE), feedHeadHtml({ notes: { scope: "congress-feed" } }),
    JSON.stringify(items),
    PAGE_SRC.slice(PAGE_SRC.indexOf("<Base"), PAGE_SRC.indexOf("<script>")),
  ];
  for (const html of copy) {
    for (const { name, re } of BANNED_PATTERNS) assert.ok(!re.test(redactFiledNames(html)), `banned wording "${name}"`);
  }
});
