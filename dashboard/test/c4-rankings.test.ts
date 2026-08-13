/* C-4 rankings: rollup semantics (grouping, unjoined filers, exact counts
   with denominators, date-anomaly exclusion) and the ranking body (structural
   undisclosed bucket AFTER ranked rows, overlap marker, strict-sign direction
   words, terminus naming the render bound, no-ticker disclosure). */

import { test } from "node:test";
import assert from "node:assert/strict";

import { leadersRollup, congressTickersRollup } from "../src/lib/derive.ts";
import { congressRankingBody, congressTabs, type BuildStamps } from "../src/lib/ui.ts";
import type { TxnRow, RenderCtx } from "../src/lib/format.ts";

const NOW = "2026-08-12";
const stamps: BuildStamps = { buildId: "t.1", generatedAt: "2026-08-12 00:00 UTC", generatedAtDate: NOW };
const ctx: RenderCtx = { watched: new Set() };

function txn(over: Partial<TxnRow> = {}): TxnRow {
  return {
    kind: "txn",
    txnId: "t-test",
    asset: null,
    assetType: null,
    filed: "2026-07-21",
    traded: "2026-06-24",
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
    lag: 27,
    late: 0,
    flags: [],
    doc: "https://efdsearch.senate.gov/x",
    ...over,
  };
}

test("leadersRollup: groups by member, keeps unjoined filers, counts carry denominators", () => {
  const rows = [
    txn(),
    txn({ side: "sale", late: 1 }),
    txn({ side: "exchange", late: null }),
    txn({ bioguide: null, name: "Printed Name" }),
    // outside the 12m trade-date window — excluded
    txn({ filed: "2020-01-01", traded: "2020-01-01" }),
    // date anomaly — excluded before windowing
    txn({ traded: "3031-04-30", flags: ["date_anomaly"] }),
  ];
  const rollup = leadersRollup(rows, NOW, 12);
  assert.equal(rollup.dateAnomalies, 1);
  assert.equal(rollup.rows.length, 2);
  const member = rollup.rows.find((r) => r.id === "T000001")!;
  assert.equal(member.txns, 3);
  assert.equal(member.buys, 1);
  assert.equal(member.sells, 1);
  assert.equal(member.excludedSides, 1); // the exchange row: counted, not summed
  assert.equal(member.late, 1);
  assert.equal(member.lateDenom, 2); // the exchange row has late: null — out of the denominator
  const raw = rollup.rows.find((r) => r.id === "raw:Printed Name");
  assert.ok(raw, "unjoined filers are grouped by printed name, never dropped");
});

test("congressTickersRollup: no-ticker rows are counted and stated, never silently dropped", () => {
  const rows = [txn(), txn({ ticker: null }), txn({ ticker: null })];
  const rollup = congressTickersRollup(rows, NOW, 12);
  assert.equal(rollup.noTickerRows, 2);
  assert.deepEqual(rollup.rows.map((r) => r.id), ["WMB"]);
});

test("ranking body: undisclosed bucket renders labeled and AFTER the ranked table", () => {
  const rows = [
    txn({ bioguide: "A000001", name: "Alpha" }),
    txn({ bioguide: "B000002", name: "Beta", low: null, high: null }), // wholly undisclosed
  ];
  const html = congressRankingBody("leaders", leadersRollup(rows, NOW, 12), stamps, ctx);
  const bucketAt = html.indexOf("Not rankable — amounts wholly undisclosed");
  const rankedAt = html.indexOf("Alpha");
  assert.ok(bucketAt > -1, "the bucket must exist");
  assert.ok(rankedAt > -1 && rankedAt < bucketAt, "bucket renders after ranked rows");
  assert.match(html, /never sorted\s+to the bottom as if small/);
});

test("ranking body: direction words only on a strict sign", () => {
  const acc = [txn({ bioguide: "A000001", name: "Alpha", low: 1001, high: 15000 })];
  const htmlAcc = congressRankingBody("leaders", leadersRollup(acc, NOW, 12), stamps, ctx);
  assert.match(htmlAcc, /net accumulation/); // net = [1000, 15000], l > 0

  // Purchases [0,15000] (an "Under $15K" capped row): net touches zero → no word.
  const touching = [txn({ bioguide: "A000001", name: "Alpha", low: null, high: 15000 })];
  const htmlTouch = congressRankingBody("leaders", leadersRollup(touching, NOW, 12), stamps, ctx);
  assert.doesNotMatch(htmlTouch, /net accumulation|net disposal/);
});

test("ranking body: overlap marker when adjacent ranked intervals overlap", () => {
  const rows = [
    txn({ bioguide: "A000001", name: "Alpha", low: 1001, high: 50000 }),
    txn({ bioguide: "B000002", name: "Beta", low: 1001, high: 15000 }),
  ];
  const html = congressRankingBody("leaders", leadersRollup(rows, NOW, 12), stamps, ctx);
  assert.match(html, /aria-label="footnote: overlapping intervals are incomparable"/);
  assert.match(html, /incomparable<\/strong>, not tied/);
});

test("ranking body: the render bound names its author (terminus), counts survive", () => {
  const rows = [
    txn({ bioguide: "A000001", name: "Alpha", ticker: "AAA" }),
    txn({ bioguide: "B000002", name: "Beta", ticker: "BBB", low: 15001, high: 50000 }),
  ];
  const html = congressRankingBody("tickers", congressTickersRollup(rows, NOW, 12), stamps, ctx, { limit: 1 });
  assert.match(html, /Truncated by Public Filings\./);
  assert.match(html, /1 further ranked\s+tickers/);
});

test("congress tabs: active tab is not a link; others are", () => {
  const html = congressTabs("leaders");
  assert.match(html, /<span class="ctab ctab-active" aria-current="page">Leaders<\/span>/);
  assert.match(html, /<a class="ctab" href="\/congress\/">Feed<\/a>/);
  assert.match(html, /<a class="ctab" href="\/congress\/tickers\/">Tickers<\/a>/);
});
