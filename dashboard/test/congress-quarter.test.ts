/* signals-v4 M2 (R13, LD10; T2.1): the Congress-quarter join, pinned at every
   boundary. Each test names its boundary and carries a mutation control: the
   join is re-run with that boundary changed and the test's reading must move. */

import { test } from "node:test";
import assert from "node:assert/strict";

import type { TxnRow } from "../src/lib/format.ts";
import {
  BROAD_ACCOUNT_NAMES,
  CONGRESS_DETAIL_LINES,
  QUARTER_ENDS_TEXT,
  congressCount,
  congressQuarter,
  moveSide,
  quarterBounds,
  quarterLabel,
  quarterMembers,
  quarterSideOf,
} from "../src/lib/congress-quarter.ts";

function txn(over: Partial<TxnRow>): TxnRow {
  return {
    kind: "txn", txnId: "t", asset: "A", assetType: "ST", filed: "2026-04-10", traded: "2026-02-10",
    name: "Member A", bioguide: "A000001", party: "D", state: "CA", district: "12", chamber: "house",
    ticker: "NVDA", side: "purchase", owner: "self", low: 1001, high: 15000, lag: 59, late: 1, flags: [],
    doc: "https://disclosures-clerk.house.gov/x.pdf", exchangedTicker: null, ...over,
  };
}
const Q = "2026-03-31";
/** The members counted on `ticker`'s `side`, by name. */
const names = (rows: TxnRow[], ticker: string, side: "buy" | "sell", includeBroad = false): string[] =>
  quarterMembers(congressQuarter(rows, Q), ticker, side, { includeBroad }).map((m) => m.name);

test("LD10: the quarter is a calendar quarter end, bounds inclusive; any other period joins nothing", () => {
  assert.deepEqual(quarterBounds("2026-03-31"), { start: "2026-01-01", end: "2026-03-31" });
  assert.deepEqual(quarterBounds("2025-06-30"), { start: "2025-04-01", end: "2025-06-30" });
  assert.deepEqual(quarterBounds("2025-09-30"), { start: "2025-07-01", end: "2025-09-30" });
  assert.deepEqual(quarterBounds("2025-12-31"), { start: "2025-10-01", end: "2025-12-31" });
  for (const bad of ["2026-03-30", "2026-04-30", "2026-03", "", null, undefined]) assert.equal(quarterBounds(bad), null, String(bad));
  assert.equal(congressQuarter([txn({})], "2026-02-28"), null, "a non-quarter period gives null");
  assert.equal(quarterLabel("2026-03-31"), "Q1 2026");
  assert.equal(quarterLabel("2025-12-31"), "Q4 2025");
  assert.equal(quarterLabel("2026-03-30"), null);
  assert.match(QUARTER_ENDS_TEXT, /March 31.*June 30.*September 30.*December 31/);

  const edge = [
    txn({ txnId: "in-first", name: "First Day", bioguide: "F1", traded: "2026-01-01" }),
    txn({ txnId: "in-last", name: "Last Day", bioguide: "L1", traded: "2026-03-31" }),
    txn({ txnId: "out-after", name: "Day After", bioguide: "D1", traded: "2026-04-01" }),
    txn({ txnId: "out-before", name: "Year Before", bioguide: "Y1", traded: "2025-12-31" }),
  ];
  assert.deepEqual(names(edge, "NVDA", "buy").sort(), ["First Day", "Last Day"], "03-31 and 01-01 in; 04-01 and the prior 12-31 out");
  // mutation control: EXCLUSIVE bounds would drop both quarter edges
  const exclusive = edge.filter((t) => t.traded! > "2026-01-01" && t.traded! < "2026-03-31");
  assert.deepEqual(exclusive.map((t) => t.name), [], "control: exclusive bounds lose the two edge trades, which the join keeps");
});

test("LD10: listed stock only (ST / Stock as filed); option, untyped and other types out; a date anomaly out; exchange and other out; sale_partial is a sale", () => {
  const rows = [
    txn({ txnId: "st", name: "House Stock", bioguide: "H1", assetType: "ST" }),
    txn({ txnId: "stock", name: "Senate Stock", bioguide: "S1", assetType: "Stock", chamber: "senate" }),
    txn({ txnId: "op", name: "Option", bioguide: "O1", assetType: "OP" }),
    txn({ txnId: "untyped", name: "Untyped", bioguide: "U1", assetType: null }),
    txn({ txnId: "sopt", name: "Stock Option", bioguide: "SO1", assetType: "Stock Option" }),
    txn({ txnId: "anom", name: "Anomaly", bioguide: "AN1", flags: ["date_anomaly"] }),
    txn({ txnId: "exch", name: "Exchange", bioguide: "E1", side: "exchange" }),
    txn({ txnId: "oth", name: "Other", bioguide: "OT1", side: "other" }),
    txn({ txnId: "part", name: "Partial", bioguide: "P1", side: "sale_partial" }),
    txn({ txnId: "sale", name: "Sale", bioguide: "SA1", side: "sale" }),
    txn({ txnId: "noticker", name: "No Ticker", bioguide: "N1", ticker: null }),
  ];
  assert.deepEqual(names(rows, "NVDA", "buy").sort(), ["House Stock", "Senate Stock"]);
  assert.deepEqual(names(rows, "NVDA", "sell").sort(), ["Partial", "Sale"]);
  const q = congressQuarter(rows, Q)!;
  assert.equal(q.lines, 4, "only the four joinable lines count");
  assert.equal(quarterSideOf("sale_partial"), "sell");
  assert.equal(quarterSideOf("exchange"), null);
  assert.equal(moveSide("new"), "buy");
  assert.equal(moveSide("add"), "buy");
  assert.equal(moveSide("trim"), "sell");
  assert.equal(moveSide("exit"), "sell");
  // mutation control: dropping `isListedStock` admits the option, untyped and option-stock rows
  const unfiltered = rows.filter((t) => !t.flags.includes("date_anomaly") && t.ticker && t.side === "purchase").map((t) => t.name);
  assert.ok(unfiltered.includes("Option") && unfiltered.includes("Untyped"), "control: without the listed-stock rule they would be counted");
  assert.ok(!names(rows, "NVDA", "buy").includes("Option"));
});

test("LD10: tickers compare in the SEC spelling — BRK.B and BRK-B both meet BRK-B; GOOG is not GOOGL; a null ticker joins nothing", () => {
  const rows = [
    txn({ txnId: "dot", name: "Dot", bioguide: "D1", ticker: "BRK.B" }),
    txn({ txnId: "dash", name: "Dash", bioguide: "D2", ticker: "brk-b" }),
    txn({ txnId: "goog", name: "Goog", bioguide: "G1", ticker: "GOOG" }),
  ];
  assert.deepEqual(names(rows, "BRK-B", "buy").sort(), ["Dash", "Dot"]);
  assert.deepEqual(names(rows, "BRK.B", "buy").sort(), ["Dash", "Dot"], "either spelling on the 13F side too");
  assert.deepEqual(names(rows, "GOOGL", "buy"), [], "GOOG is not GOOGL");
  assert.deepEqual(names(rows, "GOOG", "buy"), ["Goog"]);
  assert.equal(congressCount(congressQuarter(rows, Q), null, "buy"), 0);
});

test("LD10: a member is counted once, by bioguide, else by the filed name; newest trade first", () => {
  const rows = [
    txn({ txnId: "a1", traded: "2026-01-05" }),
    txn({ txnId: "a2", traded: "2026-03-05" }),
    txn({ txnId: "r1", name: "Unjoined Filer", bioguide: null, traded: "2026-02-01" }),
    txn({ txnId: "r2", name: "Unjoined Filer", bioguide: null, traded: "2026-02-02" }),
  ];
  const members = quarterMembers(congressQuarter(rows, Q), "NVDA", "buy");
  assert.deepEqual(members.map((m) => [m.key, m.rows.length]), [["A000001", 2], ["raw:Unjoined Filer", 2]], "two members, two lines each; the newer trade first");
  assert.deepEqual(members[0]!.rows.map((r) => r.txnId), ["a2", "a1"]);
  assert.equal(congressCount(congressQuarter(rows, Q), "NVDA", "buy"), 2);
});

test(`LD10: a broad account (breadth > ${BROAD_ACCOUNT_NAMES}) is excluded from the count but listed; breadth 25 is not broad, 26 is`, () => {
  assert.equal(BROAD_ACCOUNT_NAMES, 25);
  assert.equal(CONGRESS_DETAIL_LINES, 12);
  const member = (bioguide: string, name: string, n: number): TxnRow[] =>
    Array.from({ length: n }, (_, i) => txn({ txnId: `${bioguide}-${i}`, bioguide, name, ticker: i === 0 ? "NVDA" : `T${bioguide}${i}` }));
  const rows = [...member("W25", "Twenty Five", 25), ...member("W26", "Twenty Six", 26)];
  const q = congressQuarter(rows, Q)!;
  assert.deepEqual(names(rows, "NVDA", "buy"), ["Twenty Five"], "25 names: counted; 26: a broad account, not counted");
  assert.deepEqual(names(rows, "NVDA", "buy", true).sort(), ["Twenty Five", "Twenty Six"], "the all view includes it");
  assert.deepEqual(q.broad, [{ memberKey: "W26", name: "Twenty Six", breadth: 26 }], "and the quarter names it with its breadth");
  assert.equal(q.members, 2);
  // breadth counts DISTINCT tickers in the member's quarter lines (a repeat is not a new name; BRK.B = BRK-B)
  const repeats = [...member("R1", "Repeats", 25), txn({ txnId: "dup", bioguide: "R1", name: "Repeats", ticker: "NVDA" }), txn({ txnId: "brk1", bioguide: "R1", name: "Repeats", ticker: "BRK.B" }), txn({ txnId: "brk2", bioguide: "R1", name: "Repeats", ticker: "BRK-B" })];
  assert.equal(congressQuarter(repeats, Q)!.broad.length, 1, "25 + BRK-B = 26 distinct: broad");
  assert.equal(quarterMembers(congressQuarter(repeats, Q), "NVDA", "buy", { includeBroad: true })[0]!.breadth, 26);
  // mutation control: `>=` would make the 25-name member broad as well
  const geq = [...new Set(rows.map((r) => r.bioguide))].filter((b) => new Set(rows.filter((r) => r.bioguide === b).map((r) => r.ticker)).size >= BROAD_ACCOUNT_NAMES);
  assert.deepEqual(geq.sort(), ["W25", "W26"], "control: with >= both would be broad");
  assert.deepEqual(q.broad.map((b) => b.memberKey), ["W26"], "the join uses > (strictly more than 25)");
});
