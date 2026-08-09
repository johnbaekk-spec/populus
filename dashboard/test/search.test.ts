/* Search client pure functions (results/pre-query renderers, combobox option
   semantics) and the watchlist v2 store (Locked #16): migration from the
   legacy bare array, corrupt-storage quarantine, legacy write-through, and
   validation that drops junk without destroying the rest. */

import { test } from "node:test";
import assert from "node:assert/strict";

import { renderResults, renderPreQuery, optionId } from "../src/scripts/search-client.ts";
import {
  loadWatchStore,
  WATCH_V2_KEY,
  WATCH_LEGACY_KEY,
  WATCH_QUARANTINE_KEY,
  type StorageLike,
} from "../src/scripts/entity-client.ts";
import { buildSearchIndex, searchQuery } from "../src/lib/derive.ts";

function fakeStorage(seed: Record<string, string> = {}): StorageLike & { data: Map<string, string> } {
  const data = new Map(Object.entries(seed));
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
  };
}

const INDEX = buildSearchIndex(
  [
    { bioguide: "P000001", name: "Busy Member", aff: "D–CA-11", rows: 40 },
    { bioguide: "Q000002", name: "Quiet Member", aff: "R–TX-1", rows: 2 },
  ],
  [
    { ticker: "NVDA", name: "NVIDIA Corp", rows: 35 },
    { ticker: "AAPL", name: "Apple Inc.", rows: 20 },
  ],
  [{ cik: "0001067983", name: "Berkshire Hathaway Inc", top: true }],
);

/* ---------- results rendering ---------- */

test("renderResults: grouped, combobox options with ids and aria-selected", () => {
  const hits = searchQuery(INDEX, "n");
  const html = renderResults(hits, 0);
  assert.ok(html.includes('aria-label="Tickers"'));
  assert.ok(html.includes('role="option"'));
  assert.ok(html.includes(`id="${optionId(0)}"`));
  assert.ok(html.includes('aria-selected="true"'));
  assert.ok(!html.includes("<script"));
});

test("renderResults: an empty result set states scope, never a bare empty", () => {
  const html = renderResults([], -1);
  assert.ok(html.includes("Nothing in this build matches"));
  assert.ok(html.includes("every ticker, member, and filer"));
});

/* ---------- pre-query: watchlist quick links vs S6 ---------- */

test("pre-query with watches: quick links to watched entities, names from the index", () => {
  const storage = fakeStorage({
    [WATCH_V2_KEY]: JSON.stringify({ v: 2, members: ["P000001"], tickers: ["NVDA"] }),
  });
  const store = loadWatchStore(storage);
  const html = renderPreQuery(store, INDEX);
  assert.ok(html.includes("★ NVDA"));
  assert.ok(html.includes("★ Busy Member"), "member names resolve through the index");
  assert.ok(html.includes("saved on this device"));
});

test("pre-query empty (S6): browser-only copy + most-active starters", () => {
  const store = loadWatchStore(fakeStorage());
  const html = renderPreQuery(store, INDEX);
  assert.ok(html.includes("Nothing watched yet"));
  assert.ok(html.includes("this browser only"));
  assert.ok(html.includes("no account is required"));
  assert.ok(html.includes("most-active in this build"), "starter caption is build-derived (Locked #5)");
  assert.ok(html.includes("☆ NVDA"), "top ticker by rows is a starter");
  assert.ok(html.includes("☆ Busy Member"), "top member by rows is a starter");
  assert.ok(!html.includes("most-viewed"), "no view analytics exist to rank by");
});

/* ---------- watchlist v2 store (Locked #16) ---------- */

test("fresh storage: v2 written, legacy write-through mirror", () => {
  const storage = fakeStorage();
  const store = loadWatchStore(storage);
  assert.deepEqual(JSON.parse(storage.data.get(WATCH_V2_KEY)!), { v: 2, members: [], tickers: [] });
  store.toggle("member", "P000001");
  store.toggle("ticker", "NVDA");
  assert.deepEqual(JSON.parse(storage.data.get(WATCH_V2_KEY)!), {
    v: 2,
    members: ["P000001"],
    tickers: ["NVDA"],
  });
  assert.deepEqual(
    JSON.parse(storage.data.get(WATCH_LEGACY_KEY)!),
    ["P000001"],
    "the legacy bare array keeps receiving member ids until the reconciliation merge",
  );
  store.toggle("member", "P000001");
  assert.deepEqual(JSON.parse(storage.data.get(WATCH_LEGACY_KEY)!), []);
});

test("legacy migration: bare array becomes v2.members; junk entries dropped", () => {
  const storage = fakeStorage({
    [WATCH_LEGACY_KEY]: JSON.stringify(["P000001", "not-a-bioguide", "Q000002"]),
  });
  const store = loadWatchStore(storage);
  assert.deepEqual([...store.members].sort(), ["P000001", "Q000002"]);
  assert.equal(store.tickers.size, 0);
  const v2 = JSON.parse(storage.data.get(WATCH_V2_KEY)!);
  assert.equal(v2.v, 2);
});

test("corrupt v2 storage is QUARANTINED verbatim, then migration re-runs", () => {
  const storage = fakeStorage({
    [WATCH_V2_KEY]: "{corrupt json!!",
    [WATCH_LEGACY_KEY]: JSON.stringify(["P000001"]),
  });
  const store = loadWatchStore(storage);
  assert.equal(storage.data.get(WATCH_QUARANTINE_KEY), "{corrupt json!!", "moved aside, not destroyed");
  assert.deepEqual([...store.members], ["P000001"], "legacy data survives the corruption");
});

test("wrong-shape v2 (right JSON, wrong fields) also quarantines", () => {
  const storage = fakeStorage({
    [WATCH_V2_KEY]: JSON.stringify({ v: 2, members: "not-an-array", tickers: [] }),
  });
  loadWatchStore(storage);
  assert.ok(storage.data.has(WATCH_QUARANTINE_KEY));
  assert.deepEqual(JSON.parse(storage.data.get(WATCH_V2_KEY)!), { v: 2, members: [], tickers: [] });
});

test("valid v2 round-trips untouched; has()/toggle() agree", () => {
  const storage = fakeStorage({
    [WATCH_V2_KEY]: JSON.stringify({ v: 2, members: ["P000001"], tickers: ["AAPL", "NVDA"] }),
  });
  const store = loadWatchStore(storage);
  assert.ok(store.has("member", "P000001"));
  assert.ok(store.has("ticker", "AAPL"));
  assert.ok(!store.has("ticker", "ZZZZ"));
  assert.equal(store.toggle("ticker", "ZZZZ"), true);
  assert.equal(store.toggle("ticker", "ZZZZ"), false);
  assert.ok(!storage.data.has(WATCH_QUARANTINE_KEY));
});
