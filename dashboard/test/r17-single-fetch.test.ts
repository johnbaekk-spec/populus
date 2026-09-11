/* R17 — the feed island is the SINGLE fetch and decode owner of the congress
   dataset, and a failed fetch leaves the server-rendered views standing.

   Both halves matter and neither implies the other. A page could fetch once
   and still decode twice; a page could recover from failure by blanking the
   section it cannot fill, which is worse than doing nothing. */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { makeDom } from "./lib/fake-dom.ts";
import {
  DATASET_VERSION,
  TXN_COLS,
  PAPER_COLS,
  txnToArray,
  type TxnRow,
} from "../src/lib/format.ts";

function txn(over: Partial<TxnRow> = {}): TxnRow {
  return {
    kind: "txn",
    txnId: "t-1",
    asset: null,
    assetType: null,
    filed: "2026-08-01",
    traded: "2026-07-20",
    name: "A Member",
    bioguide: "A000001",
    party: "R",
    state: "OK",
    district: null,
    chamber: "senate",
    ticker: "WMB",
    side: "purchase",
    owner: "self",
    low: 1001,
    high: 15000,
    lag: 12,
    late: 0,
    flags: [],
    doc: "https://efdsearch.senate.gov/x",
    ...over,
  };
}

function dataset(txns: TxnRow[]): unknown {
  return {
    dataset_version: DATASET_VERSION,
    build_id: "b",
    generated_at: "2026-08-12 00:00 UTC",
    data_note: "",
    txn_cols: TXN_COLS,
    paper_cols: PAPER_COLS,
    txns: txns.map(txnToArray),
    paper: [],
  };
}

const FEED_IDS = [
  "congress-feed", "feed-tbody", "feed", "feed-loading", "feed-empty",
  "feed-empty-detail", "feed-empty-suggestions", "filter-count-line",
  "pager-range", "feed-status", "filter-reset", "filter-reset-wrap",
  "pager-newer", "pager-older",
];

test("R17/R12: load fetches NOTHING; the first request for rows is exactly ONE fetch of the dataset", async () => {
  const dom = makeDom(FEED_IDS);
  dom.elements.get("congress-feed")!.dataset = { txnCount: "1" };
  const restore = dom.install(dataset([txn()]));
  try {
    const { initFeed } = await import("../src/scripts/feed-client.ts");
    let received: readonly TxnRow[] | null = null;
    const feed = initFeed({ onRows: (rows) => { received = rows; } });
    await dom.flush();
    assert.equal(dom.fetchCalls.length, 0, `page 1 is server-rendered; nothing downloads at load, saw ${dom.fetchCalls.join(", ")}`);
    await feed.loadAll();
    await dom.flush();
    assert.equal(dom.fetchCalls.length, 1, `expected one fetch, saw ${dom.fetchCalls.join(", ")}`);
    assert.equal(dom.fetchCalls[0], "/congress/data/feed.v1.json");
    assert.ok(received, "the momentum section consumes the feed island's parsed rows");
    assert.equal(received!.length, 1);
  } finally {
    restore();
  }
});

test("R17: onRows fires EXACTLY once — one decode, not one per consumer or per request", async () => {
  const dom = makeDom(FEED_IDS);
  dom.elements.get("congress-feed")!.dataset = { txnCount: "2" };
  const restore = dom.install(dataset([txn(), txn({ txnId: "t-2", ticker: "AAPL" })]));
  try {
    const { initFeed } = await import("../src/scripts/feed-client.ts");
    let calls = 0;
    const feed = initFeed({ onRows: () => { calls++; } });
    await Promise.all([feed.loadAll(), feed.loadAll()]);
    await dom.flush();
    await feed.loadAll();
    await dom.flush();
    assert.equal(calls, 1, "a second call would mean a second decode of the same bytes");
    assert.equal(dom.fetchCalls.length, 1, "three requests, one download");
  } finally {
    restore();
  }
});

test("R12/LD7: page 2 costs exactly ONE part fetch and never the full dataset", async () => {
  const { planFeedParts, feedPartHref } = await import("../src/lib/feed-parts.ts");
  const { mergeFeed } = await import("../src/lib/format.ts");
  // One filed date: the feed order is then the load order, so page 2 is
  // rows 50–99 exactly.
  const rows = Array.from({ length: 120 }, (_, i) => txn({ txnId: `t-${i}`, ticker: `T${i}X`, filed: "2026-08-01" }));
  const plan = planFeedParts(mergeFeed(rows, []), { build_id: "b", generated_at: null });
  const dom = makeDom([...FEED_IDS, "feed-parts-index"]);
  dom.elements.get("congress-feed")!.dataset = { txnCount: String(rows.length) };
  dom.elements.get("feed-parts-index")!.textContent = JSON.stringify(plan.index);
  const restore = dom.install((url: string) => {
    const m = /\/congress\/data\/feed\/(.+)\.v1\.json$/.exec(url);
    if (m) return JSON.parse(plan.bodies.get(decodeURIComponent(m[1]!))!);
    return dataset(rows);
  });
  // The pager's focus handling narrows with `instanceof HTMLElement`, which
  // node does not define; a bare class stands in so the click path runs.
  const g = globalThis as Record<string, unknown>;
  const priorEls = { HTMLElement: g.HTMLElement, HTMLButtonElement: g.HTMLButtonElement };
  g.HTMLElement = class {};
  g.HTMLButtonElement = class {};
  try {
    const { initFeed } = await import("../src/scripts/feed-client.ts");
    let received = false;
    initFeed({ onRows: () => { received = true; } });
    dom.elements.get("pager-older")!.click();
    await dom.flush();
    await dom.flush();
    assert.deepEqual(dom.fetchCalls, [feedPartHref(plan.index.parts[0]!.part)], "one part, and only a part");
    assert.equal(received, false, "paging never decodes the full dataset");
    const body = dom.elements.get("feed-tbody")!.innerHTML;
    assert.equal((body.match(/<tr\b/g) ?? []).length, 50, "page 2 holds the next fifty rows");
    assert.match(body, />T50X</);
    assert.match(body, />T99X</);
    assert.doesNotMatch(body, />T49X</);
    assert.doesNotMatch(body, />T100X</);
    assert.match(dom.elements.get("pager-range")!.textContent, /^51–100 of 120 transactions/);
  } finally {
    g.HTMLElement = priorEls.HTMLElement;
    g.HTMLButtonElement = priorEls.HTMLButtonElement;
    restore();
  }
});

test("R17: a FAILED fetch never hands out rows, so the server-rendered view stands", async () => {
  const dom = makeDom(FEED_IDS);
  dom.elements.get("congress-feed")!.dataset = { txnCount: "1" };
  // The server-rendered momentum rows are already on the page.
  const ssr = "<tr><td>server rendered</td></tr>";
  const momentum = dom.document.createElement("tbody");
  momentum.innerHTML = ssr;
  dom.elements.set("momentum-tbody", momentum);
  const restore = dom.install(dataset([txn()]), { fetchOk: false });
  try {
    const { initFeed } = await import("../src/scripts/feed-client.ts");
    let received = false;
    initFeed({ onRows: () => { received = true; } });
    await dom.flush();
    await dom.flush();
    assert.equal(received, false, "a failed decode must not hand out rows");
    assert.equal(
      momentum.innerHTML,
      ssr,
      "the server-rendered momentum view is left exactly as it was — never emptied",
    );
  } finally {
    restore();
  }
});

test("R17: a consumer that throws does not take the feed island down with it", async () => {
  const dom = makeDom(FEED_IDS);
  dom.elements.get("congress-feed")!.dataset = { txnCount: "1" };
  const restore = dom.install(dataset([txn()]));
  const priorError = console.error;
  console.error = () => {};
  try {
    const { initFeed } = await import("../src/scripts/feed-client.ts");
    initFeed({ onRows: () => { throw new Error("consumer blew up"); } });
    await dom.flush();
    await dom.flush();
    // The consumer's throw must not be mistaken for a dataset failure. The
    // feed deliberately does NOT repaint on load — the server-rendered page 1
    // is already correct — so the observable is that the load-failure state
    // was never entered.
    assert.doesNotMatch(
      dom.elements.get("feed-empty-detail")!.textContent,
      /failed to download/,
      "the dataset arrived and decoded — only the consumer failed",
    );
    assert.doesNotMatch(
      dom.elements.get("filter-count-line")!.textContent,
      /full dataset unavailable/,
      "a consumer throwing must never be reported to the reader as a dataset failure",
    );
  } finally {
    console.error = priorError;
    restore();
  }
});

/* ---------- the structural half: no SECOND owner exists ---------- */

test("R17: the momentum island contains no fetch and no decode of its own", () => {
  // `grep -a` discipline in Node form — read bytes to text, never assume the
  // file is clean UTF-8 (two lib modules carry deliberate NULs).
  const src = readFileSync(
    path.resolve(import.meta.dirname, "..", "src", "scripts", "congress-sections.ts"),
    "latin1",
  );
  for (const forbidden of ["fetch(", "classifyDataset", "txnFromArray", "paperFromArray"]) {
    // Comments naming the rule are allowed; a CALL is not. Strip line comments
    // and block comments before looking.
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    assert.ok(
      !code.includes(forbidden),
      `congress-sections.ts must not ${forbidden} — the feed island is the one owner`,
    );
  }
});

test("R17: the congress page loads exactly ONE module that fetches the dataset", () => {
  const dir = path.resolve(import.meta.dirname, "..", "src");
  const owners: string[] = [];
  const walk = (d: string): void => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) walk(full);
      else if (/\.(ts|astro)$/.test(e.name)) {
        if (readFileSync(full, "latin1").includes('fetch("/congress/data/feed.v1.json")')) {
          owners.push(path.relative(dir, full));
        }
      }
    }
  };
  walk(dir);
  // `watchlist-client.ts` also reads this dataset, and that is NOT a violation:
  // it is the single owner on /watchlist/, a different page, and the two are
  // never loaded together. R17 forbids ONE PAGE fetching the dataset twice.
  // Pinning the exact set here means a third owner — or the watchlist island
  // being pulled onto /congress/ — reddens this test rather than passing.
  assert.deepEqual(
    owners.sort(),
    ["scripts/feed-client.ts", "scripts/watchlist-client.ts"],
    "a new fetch owner of the congress dataset appeared",
  );

  const congressPage = readFileSync(
    path.join(dir, "pages", "congress", "index.astro"),
    "latin1",
  );
  assert.ok(congressPage.includes("scripts/feed-client"), "the feed island is loaded");
  assert.ok(
    !congressPage.includes("watchlist-client"),
    "the other owner must never be loaded onto the congress page",
  );
});
