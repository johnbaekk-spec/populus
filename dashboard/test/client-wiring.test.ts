/* Review F5: the client WIRING under test — not only the pure helpers.
   Accepting a stale dataset, dropping the part reassembly, or writing to the
   device's storage must each redden this file. Runs the real initFeed against
   the fake-dom double. (The second consumer this file once drove — the
   device-local watchlist island — was removed in signals-v3 M1; its transport
   cases are now driven through the feed, the one corpus owner left.) */

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

function txn(over: Partial<TxnRow> = {}): TxnRow {
  return {
    kind: "txn",
    txnId: "t-1",
    asset: null,
    assetType: null,
    filed: "2026-08-01",
    traded: "2026-07-20",
    name: "Fixture Member",
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
    name: "Fixture Member",
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

/* R19: the feed reads the byte-bounded PARTS, not the retired single asset.
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

const FEED_IDS = [
  "congress-feed", "feed-tbody", "feed", "feed-loading", "feed-empty",
  "feed-empty-detail", "feed-empty-suggestions", "filter-count-line",
  "pager-range", "feed-status", "filter-reset", "filter-reset-wrap",
  "pager-newer", "pager-older",
];

/** The real feed island over the parts transport, with no inlined part index
    (so it fetches the index first), observed through its own two callbacks. */
async function runFeedOverParts(responder: (url: string) => unknown) {
  const dom = makeDom(FEED_IDS);
  dom.elements.get("congress-feed")!.dataset = { txnCount: "2" };
  const seen: { rows: (readonly TxnRow[])[]; settled: boolean[] } = { rows: [], settled: [] };
  const restore = dom.install(responder);
  try {
    const { initFeed } = await import("../src/scripts/feed-client.ts");
    void initFeed({ onRows: (rows) => seen.rows.push(rows), onSettled: (ok) => seen.settled.push(ok) }).loadAll();
    for (let i = 0; i < 4; i++) await dom.flush();
  } finally {
    restore();
  }
  return { dom, seen };
}

test("feed wiring (R19 parts): a stale part index is refused — no rows are delivered and the failure is stated", async () => {
  const { dom, seen } = await runFeedOverParts(partsResponder([txn()], [], 1));
  assert.deepEqual(seen.rows, [], "onRows never fires for a refused index");
  assert.deepEqual(seen.settled, [false], "the attempt settles as a failure, once");
  assert.match(dom.elements.get("feed-empty-detail")!.textContent, /failed to download/);
  assert.equal(dom.storage.map.size, 0, "the island writes nothing to the device");
});

test("feed wiring (R19 parts): a corpus split across parts reassembles in feed order, paper merged out of the row set", async () => {
  const newer = txn({ txnId: "t-new", filed: "2026-08-01" });
  const older = txn({ txnId: "t-old", filed: "2025-03-01", traded: "2025-02-20" });
  const p = paperRow({ filed: "2026-08-05" });
  const { dom, seen } = await runFeedOverParts(partsResponder([newer, older], [p]));
  assert.ok(dom.fetchCalls.filter((u) => u !== FEED_PARTS_INDEX_HREF).length >= 2, "two calendar years are two parts");
  assert.deepEqual(seen.settled, [true]);
  assert.equal(seen.rows.length, 1, "onRows fires exactly once");
  assert.deepEqual(seen.rows[0]!.map((r) => r.txnId), ["t-new", "t-old"], "transactions only, newest filed first");
  assert.equal(dom.storage.map.size, 0, "the island writes nothing to the device");
});

test("feed wiring: a stale v1 dataset surfaces the load-failure state, not v2-offset decoding", async () => {
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
