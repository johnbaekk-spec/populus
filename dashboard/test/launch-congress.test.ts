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
  assert.match(PAGE_SRC, /noun: "transactions with a ticker"/);
  assert.match(PAGE_SRC, /<script is:inline type="application\/json" id="feed-ticker-offsets" set:html=\{tickerOffsetsJson\} \/>/);
  assert.equal(DESIGN_FEED_PAGE_SIZE, 20, "20 rows a page (LD20)");
});

test("R2/R20: the count line keeps \"filtered on this device\" and its reset control, beside the one count", () => {
  assert.match(
    PAGE_SRC,
    /<span id="filter-count-line">\{rangeText\}<\/span>\{" · filtered on this device"\}<span\s+id="filter-reset-wrap"\s+hidden>\{" · "\}<button class="linklike" id="filter-reset">reset<\/button><\/span>/,
  );
  assert.match(PAGE_SRC, /<span class="pager-range" id="pager-range" tabindex="-1">\{rangeText\}<\/span>/, "the pager sink starts on the same string");
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
