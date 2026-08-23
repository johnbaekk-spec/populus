/* R20/R21/R22 — closed periods, the endpoint's bounds and note, and the rule
   that no rendered value carries a sign the underlying delta does not. */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  ADDS_PERIOD_COUNT,
  addsNoteHtml,
  addsPayloadBytes,
  boundAdds,
  closedPeriods,
  compareAddsRows,
  filingDeadline,
  isClosedPeriod,
  type AddsRow,
} from "../src/lib/inst-adds.ts";
import {
  biggestChange,
  biggestChangeCellHtml,
  matchesDirectoryFilter,
  type ManagerTyping,
} from "../src/lib/manager-directory.ts";
import type { QoqDeltaRow } from "../src/lib/inst.ts";

/* ---------- R20: only closed periods ---------- */

test("R20: a period is closed only STRICTLY after its deadline", () => {
  assert.equal(filingDeadline("2026-03-31"), "2026-05-15");
  // the day before, the day of, the day after
  assert.equal(isClosedPeriod("2026-03-31", "2026-05-14"), false);
  assert.equal(
    isClosedPeriod("2026-03-31", "2026-05-15"),
    false,
    "on the deadline day filings are still arriving — the quarter is not closed",
  );
  assert.equal(isClosedPeriod("2026-03-31", "2026-05-16"), true);
});

test("R20: an open period is never OFFERED at all, not offered-and-disabled", () => {
  const all = ["2025-06-30", "2025-09-30", "2025-12-31", "2026-03-31"];
  // build date sits inside 2026-03-31's filing window
  const offered = closedPeriods(all, "2026-05-01");
  assert.ok(!offered.includes("2026-03-31"), "the open quarter must not be selectable");
  assert.deepEqual(offered, ["2025-12-31", "2025-09-30", "2025-06-30"]);
});

test("R20: exactly three closed periods are offered when three exist", () => {
  const all = ["2024-12-31", "2025-03-31", "2025-06-30", "2025-09-30", "2025-12-31"];
  const offered = closedPeriods(all, "2026-08-12");
  assert.equal(offered.length, ADDS_PERIOD_COUNT);
  assert.deepEqual(offered, ["2025-12-31", "2025-09-30", "2025-06-30"], "newest first");
});

test("R20: fewer than three closed periods yields what exists, never a padded list", () => {
  assert.deepEqual(closedPeriods(["2025-12-31"], "2026-08-12"), ["2025-12-31"]);
  assert.deepEqual(closedPeriods([], "2026-08-12"), []);
});

/* ---------- R21: total order and bounds ---------- */

function addsRow(over: Partial<AddsRow> = {}): AddsRow {
  return {
    issuer_key: "entity:1",
    issuer_key_source: "entity",
    issuer_name: "Issuer",
    manager_count: 1,
    new_position_count: 0,
    delta_value_usd: 100,
    delta_value_is_partial: false,
    top_adder_cik: 1,
    top_adder_name: "M",
    ...over,
  };
}

test("R21: total order is value DESC, NULLS LAST, then managers, then issuer_key", () => {
  const rows = [
    addsRow({ issuer_key: "entity:null", delta_value_usd: null }),
    addsRow({ issuer_key: "entity:b", delta_value_usd: 10 }),
    addsRow({ issuer_key: "entity:a", delta_value_usd: 50 }),
  ].sort(compareAddsRows);
  assert.deepEqual(rows.map((r) => r.issuer_key), ["entity:a", "entity:b", "entity:null"]);
});

test("R21: a null value never ranks as zero and never ranks as largest", () => {
  const rows = [
    addsRow({ issuer_key: "n", delta_value_usd: null }),
    addsRow({ issuer_key: "neg", delta_value_usd: -500 }),
  ].sort(compareAddsRows);
  assert.deepEqual(rows.map((r) => r.issuer_key), ["neg", "n"],
    "an undisclosed issuer sorts after even a NEGATIVE disclosed one");
});

test("R21: equal value falls to manager_count DESC, then issuer_key ASC", () => {
  const rows = [
    addsRow({ issuer_key: "z", manager_count: 2 }),
    addsRow({ issuer_key: "a", manager_count: 2 }),
    addsRow({ issuer_key: "m", manager_count: 9 }),
  ].sort(compareAddsRows);
  assert.deepEqual(rows.map((r) => r.issuer_key), ["m", "a", "z"]);
});

test("R21: the record cap binds and records the EXACT truncation boundary", () => {
  const rows = [
    addsRow({ issuer_key: "a", delta_value_usd: 300, manager_count: 3 }),
    addsRow({ issuer_key: "b", delta_value_usd: 200, manager_count: 2 }),
    addsRow({ issuer_key: "c", delta_value_usd: 100, manager_count: 1 }),
  ];
  const out = boundAdds(rows, { recordLimit: 2 });
  assert.equal(out.rows.length, 2);
  assert.equal(out.truncated, true);
  assert.deepEqual(out.truncation_boundary, [100, 1, "c"],
    "the boundary is the omitted row's sort tuple — WHERE the cut fell, not how many");
});

test("R21/F11: the byte cap is measured on the SERIALIZED payload, in UTF-8 bytes", () => {
  // The cap bounds the RESPONSE, so it is measured on the response — envelope
  // included — not on the sum of row fragments. And it counts UTF-8 bytes:
  // `String.length` counts UTF-16 code units, which undercounts every
  // non-ASCII issuer name, and issuer names are filed text.
  const rows = [addsRow({ issuer_key: "a" }), addsRow({ issuer_key: "b" })];
  const generous = boundAdds(rows, { byteLimit: 10_000 });
  assert.equal(generous.rows.length, 2);
  assert.ok(
    addsPayloadBytes({
      period: "2026-03-31", generated_at: "2026-08-22", truncated: false,
      truncation_boundary: null, ambiguous_identity_exclusion_count: 0,
      rows: generous.rows,
    }) <= 10_000,
  );
});

test("R21/F11: a row that alone exceeds the cap is REPORTED, never over-served", () => {
  // Admitting it "so something renders" would serve more than the declared
  // bound, which is the one thing a byte cap exists to prevent.
  const out = boundAdds([addsRow({ issuer_key: "a" })], { byteLimit: 10 });
  assert.equal(out.rows.length, 0, "the cap is honoured");
  assert.equal(out.truncated, true, "and the omission is stated");
  assert.ok(out.oversizedRow, "the oversized row is surfaced to the caller");
});

test("R21/F11: a non-ASCII issuer name is counted at its real byte cost", () => {
  const ascii = addsRow({ issuer_key: "a", issuer_name: "AAAAAAAA" });
  const wide = addsRow({ issuer_key: "a", issuer_name: "日本電信電話" });
  const env = {
    period: "2026-03-31", generated_at: "2026-08-22", truncated: false,
    truncation_boundary: null, ambiguous_identity_exclusion_count: 0,
  };
  assert.ok(
    addsPayloadBytes({ ...env, rows: [wide] }) > addsPayloadBytes({ ...env, rows: [ascii] }),
    "a UTF-16 length would have called these nearly equal",
  );
});

test("R21: an unbounded result records NO boundary", () => {
  const out = boundAdds([addsRow()], { recordLimit: 10 });
  assert.equal(out.truncated, false);
  assert.equal(out.truncation_boundary, null);
});

/* ---------- R14/R21: all four crossed states of the note truth table ------- */

test("R21 note: not truncated + zero exclusions renders NO note", () => {
  assert.equal(
    addsNoteHtml({ truncated: false, truncation_boundary: null, ambiguous_identity_exclusion_count: 0 }),
    "",
  );
});

test("R21 note: truncated + ZERO exclusions still renders the truncation clause", () => {
  // The states are independent: a zero exclusion count must never suppress an
  // independently required truncation notice.
  const html = addsNoteHtml({
    truncated: true,
    truncation_boundary: [1234, 2, "entity:x"],
    ambiguous_identity_exclusion_count: 0,
  });
  assert.match(html, /bounded by Public Filings/);
  assert.match(html, /entity:x/, "the exact boundary is named");
  assert.doesNotMatch(html, /could not be attributed/);
});

test("R21 note: not truncated + non-zero exclusions renders the exclusion clause", () => {
  const html = addsNoteHtml({
    truncated: false,
    truncation_boundary: null,
    ambiguous_identity_exclusion_count: 3,
  });
  assert.doesNotMatch(html, /bounded by Public Filings/);
  assert.match(html, /3 position grains could not be attributed/);
});

test("R21 note: truncated + non-zero exclusions renders BOTH, truncation first", () => {
  const html = addsNoteHtml({
    truncated: true,
    truncation_boundary: [null, 1, "entity:y"],
    ambiguous_identity_exclusion_count: 2,
  });
  assert.ok(
    html.indexOf("bounded by Public Filings") < html.indexOf("could not be attributed"),
    "truncation clause first",
  );
  assert.match(html, /no disclosed value/, "a null boundary value says so, never $0");
});

/* ---------- R22: no fabricated sign ---------- */

function delta(over: Partial<QoqDeltaRow> = {}): QoqDeltaRow {
  return {
    cik: "0000000001",
    position_key: "sid:a",
    put_call: "LONG",
    curr_period: "2026-03-31",
    prev_period: "2025-12-31",
    change_kind: "add",
    prev_value_usd: 100,
    curr_value_usd: 90,
    delta_value_usd: -10,
    prev_shares: 100,
    curr_shares: 120,
    delta_shares: 20,
    ssh_prnamt_type: "SH",
    flags: [],
    ...over,
  };
}

test("R22: shares UP with value DOWN renders `add` beside a NEGATIVE dollar delta", () => {
  // The producer classifies from SHARES. More shares at a lower price is an
  // add whose dollar delta is negative — the case that makes a fabricated
  // sign possible, and the reason R22 exists.
  const res = biggestChange([delta()], "2026-03-31");
  const html = biggestChangeCellHtml(res);
  assert.match(html, /qoq-add/, "the position direction is add");
  assert.match(html, /−/, "and the dollar figure carries its own MINUS sign");
  assert.doesNotMatch(html, /\+/, "no positive sign is inferred from the change kind");
});

test("R22: shares DOWN with value UP renders `trim` beside a POSITIVE dollar delta", () => {
  const res = biggestChange(
    [delta({ change_kind: "trim", delta_shares: -20, delta_value_usd: 40 })],
    "2026-03-31",
  );
  const html = biggestChangeCellHtml(res);
  assert.match(html, /qoq-trim/);
  assert.doesNotMatch(html, /−/, "a positive delta must not be painted negative");
});

test("R22: a value-classified change DISCLOSES that basis", () => {
  const res = biggestChange(
    [delta({ flags: ["classified_by_value"], delta_shares: null })],
    "2026-03-31",
  );
  assert.equal(res.best!.classifiedByValue, true);
  assert.match(biggestChangeCellHtml(res), /by value/);
});

test("R22: no rankable row renders an em dash and the COUNT, never a pick", () => {
  const res = biggestChange(
    [delta({ delta_value_usd: null }), delta({ position_key: "sid:b", delta_value_usd: null })],
    "2026-03-31",
  );
  assert.equal(res.best, null);
  assert.equal(res.unrankable, 2);
  const html = biggestChangeCellHtml(res);
  assert.match(html, /—/);
  assert.match(html, /2 unpriced/);
  assert.doesNotMatch(html, /\$0/, "never a zero standing in for undisclosed");
});

test("R22: ranking is by ABSOLUTE value, so a large SALE can be the biggest change", () => {
  const res = biggestChange(
    [
      delta({ position_key: "sid:small", delta_value_usd: 10 }),
      delta({ position_key: "sid:big", change_kind: "trim", delta_value_usd: -900 }),
    ],
    "2026-03-31",
  );
  assert.equal(res.best!.row.position_key, "sid:big");
  assert.equal(res.best!.delta_value_usd, -900, "and it keeps its own sign");
});

test("R22: the tie-break is the FULL grain — position_key alone is not a total order", () => {
  // The same position key legitimately yields distinct SH/PRN and LONG/PUT
  // rows; the producer's own tests pin that.
  const rows = [
    delta({ position_key: "sid:a", put_call: "PUT", ssh_prnamt_type: "PRN", delta_value_usd: 100, delta_shares: 5 }),
    delta({ position_key: "sid:a", put_call: "LONG", ssh_prnamt_type: "SH", delta_value_usd: 100, delta_shares: 5 }),
  ];
  const a = biggestChange(rows, "2026-03-31").best!.row;
  const b = biggestChange([...rows].reverse(), "2026-03-31").best!.row;
  assert.equal(a.put_call, b.put_call, "the order must not depend on input order");
  assert.equal(a.put_call, "LONG", "put_call ASC: LONG before PUT");
});

test("R22: NULL delta_shares orders LAST among equal absolute values", () => {
  const rows = [
    delta({ position_key: "sid:nullshares", delta_value_usd: 100, delta_shares: null }),
    delta({ position_key: "sid:hasshares", delta_value_usd: 100, delta_shares: 3 }),
  ];
  assert.equal(biggestChange(rows, "2026-03-31").best!.row.position_key, "sid:hasshares");
});

test("R22: only the selected period's changes are candidates", () => {
  const res = biggestChange(
    [delta({ curr_period: "2025-12-31", delta_value_usd: 9_999 }), delta({ delta_value_usd: 5 })],
    "2026-03-31",
  );
  assert.equal(res.best!.delta_value_usd, 5);
});

/* ---------- R11: notable is ORTHOGONAL to type ---------- */

function typing(over: Partial<ManagerTyping> = {}): ManagerTyping {
  return {
    cik: "0000000001",
    display_name: "A Fund",
    person: null,
    manager_type: "hedge_fund",
    notable: true,
    ...over,
  };
}

test("R11: a notable hedge fund satisfies the Notable chip AND the Hedge funds chip", () => {
  const t = typing();
  assert.ok(matchesDirectoryFilter(t, { types: new Set(), notableOnly: true }));
  assert.ok(matchesDirectoryFilter(t, { types: new Set(["hedge_fund"]), notableOnly: false }));
  assert.ok(
    matchesDirectoryFilter(t, { types: new Set(["hedge_fund"]), notableOnly: true }),
    "selecting both must still show it — notable is not a ninth type",
  );
});

test("R11: a non-notable hedge fund is hidden by Notable but shown by its type", () => {
  const t = typing({ notable: false });
  assert.equal(matchesDirectoryFilter(t, { types: new Set(), notableOnly: true }), false);
  assert.ok(matchesDirectoryFilter(t, { types: new Set(["hedge_fund"]), notableOnly: false }));
});

test("R11: an untyped filer passes an unfiltered view and fails every chip", () => {
  assert.ok(matchesDirectoryFilter(null, { types: new Set(), notableOnly: false }));
  assert.equal(matchesDirectoryFilter(null, { types: new Set(["bank"]), notableOnly: false }), false);
  assert.equal(matchesDirectoryFilter(null, { types: new Set(), notableOnly: true }), false);
});
