/* Refinement 20260910 — Milestone 1 unit pins (R7, R8 render side).

   Each test fails if its feature is removed: the held group leaves the paged
   changes table; the notable feed filters, orders and prices as R7 says. */

import { test } from "node:test";
import assert from "node:assert/strict";

import { changesTableHtml } from "../src/lib/ui/institutional.ts";
import { notableActivity, type ActivityFeed, type ActivityRecord } from "../src/lib/activity.ts";
import type { QoqDeltaRow } from "../src/lib/inst.ts";

function qoq(over: Partial<QoqDeltaRow> = {}): QoqDeltaRow {
  return {
    cik: "0001067983",
    position_key: "sid:sec:aapl",
    put_call: "LONG",
    curr_period: "2026-03-31",
    prev_period: "2025-12-31",
    change_kind: "add",
    prev_value_usd: 1000,
    curr_value_usd: 2000,
    delta_value_usd: 1000,
    prev_shares: 100,
    curr_shares: 150,
    delta_shares: 50,
    ssh_prnamt_type: "SH",
    flags: [],
    ...over,
  };
}

test("R8: held rows leave the paged changes table and render once in the collapsed mark-to-market group", () => {
  const rows = [
    qoq({ position_key: "sid:sec:a", issuer_name: "APPLE INC", title_of_class: "COM" }),
    qoq({ position_key: "sid:sec:b", issuer_name: "MICROSOFT CORP", change_kind: "held", delta_shares: 0, curr_shares: 100, curr_value_usd: 1300, delta_value_usd: 300 }),
    qoq({ position_key: "sid:sec:c", issuer_name: "NVIDIA CORP", change_kind: "trim", delta_shares: -10, curr_shares: 90, curr_value_usd: 900, delta_value_usd: -100 }),
  ];
  const html = changesTableHtml(rows, "2026-03-31", "2026-05-15", { total: 3 });
  const [mainTable, heldPart] = html.split('<details class="qoq-held-group"');
  assert.ok(heldPart, "the held group renders");
  assert.ok(heldPart.includes("Mark-to-market only (no share change) · 1"));
  assert.ok(heldPart.includes("MICROSOFT CORP") && heldPart.includes('class="qoq-chip qoq-held">no change</span>'));
  assert.ok(!mainTable!.includes("MICROSOFT CORP"), "held row is not in the paged table");
  assert.ok(mainTable!.includes("APPLE INC") && mainTable!.includes("NVIDIA CORP"));
  // R1: the name leads, the class is secondary, the key is in the ⓘ — not a cell.
  assert.ok(mainTable!.includes('<span class="filed-name">APPLE INC</span> <span class="mono-note c-secondary"><span class="filed-name">COM</span></span>'));
  assert.ok(mainTable!.includes("position key <code>sid:sec:a</code>"));
  assert.ok(!/<td class="c-pos[^"]*"><span class="mono-note">sid:/.test(mainTable!), "no bare sid: cell when a name exists");
  // No held group when nothing is held.
  assert.ok(!changesTableHtml([rows[0]!], "2026-03-31", null, { total: 1 }).includes("qoq-held-group"));
});

test("R1: an unnamed row still shows its position key — never an invented name", () => {
  const html = changesTableHtml([qoq({ position_key: "cusip:037833100" })], "2026-03-31", null, { total: 1 });
  assert.ok(html.includes('<span class="mono-note">cusip:037833100</span>'));
});

function rec(over: Partial<ActivityRecord> = {}): ActivityRecord {
  return {
    cik: "0001067983",
    filer_name: "Berkshire",
    issuer_key: "entity:cik:1",
    issuer_name: "APPLE INC",
    position_key: "sid:a",
    put_call: "LONG",
    ssh_prnamt_type: "SH",
    change_kind: "add",
    curr_period: "2026-03-31",
    prev_period: "2025-12-31",
    prev_value_usd: 100,
    curr_value_usd: 200,
    delta_value_usd: 100,
    prev_shares: 10,
    curr_shares: 20,
    delta_shares: 10,
    filing_keys: [1],
    prior_filing_keys: [],
    current_filing_keys: [],
    flags: [],
    ...over,
  };
}

test("R7: the notable feed is notable-only, newest filed date first then |Δ value|, and excludes held / discontinuity rows", () => {
  const feed: ActivityFeed = {
    present: true,
    reason: null,
    filings: {
      "1": { accession: "0001-1", submission_type: "13F-HR", period_of_report: "2026-03-31", filed_date: "2026-05-15", doc_url: null, source: "s" },
      "2": { accession: "0001-2", submission_type: "13F-HR", period_of_report: "2026-03-31", filed_date: "2026-05-01", doc_url: null, source: "s" },
    },
    pagination: { pages: [], truncation: null, total_records: 0, emitted_records: 0, limits: { byteLimit: 1, recordLimit: 1, shardLimit: 1 } as never },
    records: [
      rec({ cik: "0000000009", filer_name: "Not Notable", delta_value_usd: 99999, filing_keys: [1] }),
      rec({ position_key: "sid:small-newest", delta_value_usd: 5, filing_keys: [1] }),
      rec({ position_key: "sid:big-older", delta_value_usd: 9000, filing_keys: [2] }),
      rec({ position_key: "sid:held", change_kind: "held", delta_shares: 0, delta_value_usd: 8000, filing_keys: [1] }),
      rec({ position_key: "sid:gone", change_kind: "exit", delta_value_usd: -7000, filing_keys: [1], flags: ["book_discontinuity"] }),
      rec({ position_key: "sid:big-newest", delta_value_usd: 500, filing_keys: [1] }),
    ],
  };
  const rows = notableActivity(feed, new Set(["0001067983"]), 50);
  assert.deepEqual(rows.map((r) => r.position_key), ["sid:big-newest", "sid:small-newest", "sid:big-older"]);
  assert.ok(rows.every((r) => r.cik === "0001067983"));
  assert.equal(notableActivity(feed, new Set(["0001067983"]), 1).length, 1);
  assert.deepEqual(notableActivity({ ...feed, present: false }, new Set(["0001067983"]), 5), []);
});

import { closedPeriods, corpusAsOf } from "../src/lib/inst-adds.ts";

test("R4: closedness is judged against the corpus watermark, never the build clock alone", () => {
  const periods = ["2025-12-31", "2026-03-31", "2026-06-30"];
  // Build on 2026-08-17, newest filing 2026-07-31: June is still open.
  assert.equal(corpusAsOf("2026-08-17", "2026-07-31"), "2026-07-31");
  assert.deepEqual(closedPeriods(periods, corpusAsOf("2026-08-17", "2026-07-31"), 1), ["2026-03-31"]);
  // Once the corpus has seen a filing PAST the deadline, June closes (the
  // deadline day itself is still open — deadline-exclusive, as always).
  assert.deepEqual(closedPeriods(periods, corpusAsOf("2026-08-17", "2026-08-14"), 1), ["2026-03-31"]);
  assert.deepEqual(closedPeriods(periods, corpusAsOf("2026-08-17", "2026-08-15"), 1), ["2026-06-30"]);
  // No watermark → the build date stands.
  assert.equal(corpusAsOf("2026-08-17", null), "2026-08-17");
});
