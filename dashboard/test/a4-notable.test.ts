/* A-4 homepage rail: lower-bound ranking (never the upper bound), the 7-day
   filed window, unrankable disclosure, anomaly exclusion, and receipts on
   every rendered row. */

import { test } from "node:test";
import assert from "node:assert/strict";

import { notableRecent } from "../src/lib/derive.ts";
import { notableRailHtml } from "../src/lib/ui.ts";
import type { TxnRow, RenderCtx } from "../src/lib/format.ts";

const NOW = "2026-08-12";
const ctx: RenderCtx = { watched: new Set() };

function txn(over: Partial<TxnRow> = {}): TxnRow {
  return {
    kind: "txn",
    txnId: "t-test",
    asset: null,
    assetType: null,
    filed: "2026-08-10",
    traded: "2026-08-01",
    name: "Test Member",
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
    lag: 9,
    late: 0,
    flags: [],
    doc: "https://efdsearch.senate.gov/x",
    ...over,
  };
}

test("notableRecent: ranks by LOWER bound, not upper; window is filed-date based", () => {
  const bigUpper = txn({ name: "BigUpper", low: 1001, high: 5_000_000 });
  const bigLower = txn({ name: "BigLower", low: 1_000_001, high: 5_000_000 });
  const open = txn({ name: "Open", low: 250_001, high: null }); // upper-open ranks on its lower bound
  const old = txn({ name: "Old", filed: "2026-07-01", low: 25_000_001 }); // outside 7 days
  const res = notableRecent([bigUpper, bigLower, open, old], NOW, 7, 5);
  assert.deepEqual(res.rows.map((r) => r.name), ["BigLower", "Open", "BigUpper"]);
  assert.equal(res.windowFrom, "2026-08-05");
});

test("notableRecent: no-lower-bound rows are counted out, anomalies excluded", () => {
  const unknown = txn({ name: "Unknown", low: null, high: null });
  const capped = txn({ name: "Capped", low: null, high: 15000 }); // lower bound 0 — ranks (last)
  const anomaly = txn({ name: "Anom", flags: ["date_anomaly"] });
  const res = notableRecent([unknown, capped, anomaly], NOW, 7, 5);
  assert.equal(res.unrankable, 1);
  assert.equal(res.dateAnomalies, 1);
  assert.deepEqual(res.rows.map((r) => r.name), ["Capped"]);
});

test("rail html: every row carries its receipt; caption states formula and window", () => {
  const res = notableRecent([txn()], NOW, 7, 5);
  const html = notableRailHtml(res, ctx);
  assert.match(html, /eFD&nbsp;↗/); // the srcLink receipt
  assert.match(html, /ranked by the disclosed LOWER bound/);
  assert.match(html, /filings from 2026-08-05 onward/);
  assert.match(html, /full rankings ↗/);
});
