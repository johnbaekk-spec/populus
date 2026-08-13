/* A-1 feed sorting — the F-16 four-state ordering rule, as a pure function:
   closed and upper-open rows rank on the LOWER bound; a capped "Under $X"
   row ranks at 0 (its true lower bound, not an imputation); a wholly-unknown
   row is unrankable and bucketed, never coerced; ties break on filed desc
   then load order, so the order is reproducible per build. */

import { test } from "node:test";
import assert from "node:assert/strict";

import { amountSortKey, amountOrder } from "../src/scripts/feed-client.ts";
import type { TxnRow } from "../src/lib/format.ts";

function txn(over: Partial<TxnRow> = {}): TxnRow {
  return {
    kind: "txn",
    txnId: "t-test",
    asset: null,
    assetType: null,
    filed: "2026-07-21",
    traded: "2026-06-24",
    name: "M",
    bioguide: "T000001",
    party: "R",
    state: "OK",
    district: null,
    chamber: "senate",
    ticker: "WMB",
    side: "purchase",
    owner: "self",
    low: 1001,
    high: 15000,
    lag: 27,
    late: 0,
    flags: [],
    doc: "https://efdsearch.senate.gov/x",
    ...over,
  };
}

test("F-16 key: four amount states, four verdicts", () => {
  assert.equal(amountSortKey({ low: 1001, high: 15000 }), 1001); // closed
  assert.equal(amountSortKey({ low: 1000001, high: null }), 1000001); // upper-open participates normally
  assert.equal(amountSortKey({ low: null, high: 15000 }), 0); // capped → [0,X], sorts at 0, never bucketed
  assert.equal(amountSortKey({ low: null, high: null }), null); // wholly unknown → no key
});

test("amountOrder: desc ranks upper-open by its lower bound; capped at 0; unknown bucketed", () => {
  const openBig = txn({ low: 1000001, high: null, name: "open" });
  const closed = txn({ low: 15001, high: 50000, name: "closed" });
  const capped = txn({ low: null, high: 15000, name: "capped" });
  const unknown = txn({ low: null, high: null, name: "unknown" });
  const idx = new Map<TxnRow, number>([[openBig, 0], [closed, 1], [capped, 2], [unknown, 3]]);
  const { ranked, unranked } = amountOrder([capped, unknown, closed, openBig], "amount-desc", idx);
  assert.deepEqual(ranked.map((r) => r.name), ["open", "closed", "capped"]);
  assert.deepEqual(unranked.map((r) => r.name), ["unknown"]);
});

test("amountOrder: ties break on filed desc, then build load order — reproducible", () => {
  const a = txn({ low: 1001, filed: "2026-07-01", name: "older" });
  const b = txn({ low: 1001, filed: "2026-07-21", name: "newer" });
  const c = txn({ low: 1001, filed: "2026-07-21", name: "same-day-later-load" });
  const idx = new Map<TxnRow, number>([[b, 0], [c, 1], [a, 2]]);
  const { ranked } = amountOrder([a, c, b], "amount-asc", idx);
  assert.deepEqual(ranked.map((r) => r.name), ["newer", "same-day-later-load", "older"]);
});
