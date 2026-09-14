/* Review F5: the client WIRING under test — not only the pure helpers.
   Removing classifyDataset from either consumer, dropping the paper merge,
   re-enabling pre-load mark-seen, or restoring the wall-clock fallback must
   each redden this file. Runs the real initWatchlist / initFeed against the
   fake-dom double. */

import { test } from "node:test";
import assert from "node:assert/strict";

import { makeDom } from "./lib/fake-dom.ts";
import {
  DATASET_VERSION,
  TXN_COLS,
  PAPER_COLS,
  mergeFeed,
  txnToArray,
  paperToArray,
  type TxnRow,
  type PaperRow,
} from "../src/lib/format.ts";
import {
  FEED_PARTS_INDEX_HREF,
  feedPartHref,
  planFeedParts,
} from "../src/lib/feed-parts.ts";
import { CURSOR_KEY } from "../src/lib/watchlist.ts";
import { WATCH_V2_KEY } from "../src/scripts/entity-client.ts";

function txn(over: Partial<TxnRow> = {}): TxnRow {
  return {
    kind: "txn",
    txnId: "t-1",
    asset: null,
    assetType: null,
    filed: "2026-08-01",
    traded: "2026-07-20",
    name: "Watched Member",
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

function paperRow(over: Partial<PaperRow> = {}): PaperRow {
  return {
    kind: "paper",
    filed: "2026-08-05",
    name: "Watched Member",
    bioguide: "A000001",
    party: "R",
    state: "OK",
    district: null,
    chamber: "senate",
    doc: "https://efdsearch.senate.gov/p",
    ...over,
  };
}

function dataset(txns: TxnRow[], paper: PaperRow[], version = DATASET_VERSION): unknown {
  return {
    dataset_version: version,
    txn_cols: [...TXN_COLS],
    paper_cols: [...PAPER_COLS],
    txns: txns.map(txnToArray),
    paper: paper.map(paperToArray),
  };
}

/* R19: /watchlist/ reads the byte-bounded PARTS, not the retired single asset.
   This serves the part index and each part, so the tests drive the real
   transport. `version` still forces the stale-body case: an index that is not
   this dataset version must be REFUSED, exactly as a stale monolith body was. */
function partsResponder(txns: TxnRow[], paper: PaperRow[], version = DATASET_VERSION) {
  const plan = planFeedParts(mergeFeed(txns, paper), { build_id: "b", generated_at: null });
  const byHref = new Map<string, unknown>();
  for (const [part, body] of plan.bodies) byHref.set(feedPartHref(part), JSON.parse(body));
  const index = version === DATASET_VERSION ? plan.index : { ...plan.index, dataset_version: version };
  return (url: string) => (url === FEED_PARTS_INDEX_HREF ? index : (byHref.get(url) ?? index));
}

const WATCHLIST_IDS = [
  "watchlist-root", "watch-chips", "watch-banner", "watch-body",
  "watch-count", "watch-empty", "watch-new-only", "watch-mark-seen",
];

async function runWatchlist(body: unknown, opts: { preClick?: boolean } = {}) {
  const dom = makeDom(WATCHLIST_IDS);
  dom.elements.get("watchlist-root")!.dataset = { buildId: "b.1", filedFrom: "2014-01-29" };
  dom.storage.map.set(WATCH_V2_KEY, JSON.stringify({ v: 2, members: ["A000001"], tickers: [] }));
  const restore = dom.install(body);
  const { initWatchlist } = await import("../src/scripts/watchlist-client.ts");
  initWatchlist();
  const markBtn = dom.elements.get("watch-mark-seen")!;
  if (opts.preClick) markBtn.click(); // BEFORE the dataset settles
  await dom.flush();
  // Globals stay installed so post-flush interactions (mark-seen clicks in the
  // tests) still see the fake localStorage; restore is the caller's duty.
  return { dom, markBtn, restore };
}

test("watchlist wiring: a stale v1 dataset is refused; mark-seen never enables", async () => {
  const { dom, markBtn, restore } = await runWatchlist(partsResponder([txn()], [], 1));
  try {
    assert.match(dom.elements.get("watch-banner")!.innerHTML, /dataset failed to download|cannot\s+render/);
    assert.equal(markBtn.disabled, true, "mark-seen must stay disabled after a refused dataset");
    assert.equal(dom.storage.map.has(CURSOR_KEY), false, "no cursor is ever written");
  } finally {
    restore();
  }
});

test("watchlist wiring: a pre-load click writes NO cursor (no wall-clock fallback)", async () => {
  const { dom, restore } = await runWatchlist(partsResponder([txn()], []), { preClick: true });
  try {
    assert.equal(dom.storage.map.has(CURSOR_KEY), false, "an early click must be a no-op");
  } finally {
    restore();
  }
});

test("watchlist wiring: paper-only watched member renders; mark-seen writes the dataset high-water incl. paper", async () => {
  const p = paperRow({ filed: "2026-08-09" });
  const { dom, markBtn, restore } = await runWatchlist(partsResponder([], [p]));
  try {
    assert.match(dom.elements.get("watch-body")!.innerHTML, /paper filing — needs OCR/);
    assert.match(dom.elements.get("watch-chips")!.innerHTML, /latest 2026-08-09/);
    assert.equal(markBtn.disabled, false, "enabled once a validated dataset loads");
    markBtn.click();
    const cursor = JSON.parse(dom.storage.map.get(CURSOR_KEY)!) as { lastSeenFiled: string };
    assert.equal(cursor.lastSeenFiled, "2026-08-09", "the PAPER filing is the high-water mark");
  } finally {
    restore();
  }
});

test("feed wiring: a stale v1 dataset surfaces the load-failure state, not v2-offset decoding", async () => {
  const FEED_IDS = [
    "congress-feed", "feed-tbody", "feed", "feed-loading", "feed-empty",
    "feed-empty-detail", "feed-empty-suggestions", "filter-count-line",
    "pager-range", "feed-status", "filter-reset", "filter-reset-wrap",
    "pager-newer", "pager-older",
  ];
  const dom = makeDom(FEED_IDS);
  dom.elements.get("congress-feed")!.dataset = { txnCount: "1" };
  const restore = dom.install(dataset([txn()], [], 1));
  try {
    const { initFeed } = await import("../src/scripts/feed-client.ts");
    // R12: the full dataset loads on demand; ask for it the way a filter does.
    void initFeed().loadAll();
    await dom.flush();
    // Force a client render so the pending-apply path resolves the failure.
    await dom.flush();
    assert.match(
      dom.elements.get("filter-count-line")!.textContent +
        dom.elements.get("feed-empty-detail")!.textContent,
      /full dataset unavailable|failed to/i,
    );
  } finally {
    restore();
  }
});
