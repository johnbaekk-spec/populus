/* DESIGN-POLISH M2, T2.1 (R12, R32; Architecture D): column presence.

   A column renders only when at least one row of the table's FULL collection —
   every row any page, expansion or client re-render of that table can show —
   has a value. ONE pure function (`presentColumns`) decides it for server and
   client; the chosen set travels in `data-columns`. A kept column may be empty
   on the visible page and prints no reason; a column empty over the whole
   collection is REMOVED, and an honesty column (dates, amounts, receipts,
   owner or partial qualifiers, flags) prints its reason in the table foot.

   Each test below names the property it pins and carries a control that fails
   when the property breaks. */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  flagLabels,
  flagsColumnSpec,
  parseDataColumns,
  presentColumns,
  type ColumnSpec,
  type TxnRow,
  type RenderCtx,
} from "../src/lib/format.ts";
import { changesTableHtml, entityTxnRowsHtml, entityTxnTable } from "../src/lib/ui/index.ts";
import { memberTxnColumns } from "../src/lib/ui/congress.ts";
import type { QoqDeltaRow } from "../src/lib/inst.ts";
import { MiniElement } from "./lib/mini-dom.ts";
import { domOf, visibleText } from "./lib/ledger-dom.ts";

const CTX: RenderCtx = { watched: new Set() };

function txn(i: number, over: Partial<TxnRow> = {}): TxnRow {
  const day = new Date(Date.UTC(2026, 6, 30) - i * 86_400_000).toISOString().slice(0, 10);
  return {
    kind: "txn", txnId: `t-${i}`, asset: `Asset ${i}`, assetType: null,
    filed: day, traded: day, name: "Fixture Member", bioguide: "T000001", party: "R", state: "OK",
    district: null, chamber: "senate", ticker: "WMB", side: "purchase", owner: "self",
    low: 1001, high: 15000, lag: 0, late: 0, flags: [], doc: `https://efdsearch.senate.gov/x/${i}`,
    ...over,
  };
}

/** The table's own column set, its header keys, and each body row's cell count. */
function tableShape(html: string): { cols: string[]; heads: string[]; cells: number[]; reason: string | null; ownerCells: string[] } {
  const root = domOf(html);
  const table = root.querySelector("table[data-columns]")!;
  const heads = root.querySelectorAll("thead th").map((th) => th.getAttribute("data-col") ?? "");
  const rows = root.querySelectorAll("tbody tr");
  const reason = root.querySelector("p.table-foot-reason");
  return {
    cols: parseDataColumns(table.getAttribute("data-columns")) ?? [],
    heads,
    cells: rows.map((tr) => tr.children.length),
    reason: reason ? visibleText(reason).trim() : null,
    ownerCells: rows.map((tr) => tr.children.find((td) => td.classList.contains("c-owner"))).filter((td): td is MiniElement => !!td).map((td) => visibleText(td).trim()),
  };
}

/* ---------- a column empty on page 1 and filled on page 2 is KEPT on both ---------- */

test("T2.1: a column empty on page 1 and filled on page 2 is kept on both pages, listed in data-columns, with no reason printed", () => {
  // 60 rows, 50 per page, newest filed first: only the OLDEST row (page 2) carries an owner code.
  const rows = Array.from({ length: 60 }, (_, i) => txn(i, i === 59 ? { owner: "spouse" } : {}));
  const p1 = tableShape(entityTxnTable(rows, { kind: "member", caption: "c", page: 0, ctx: CTX }));
  const p2 = tableShape(entityTxnTable(rows, { kind: "member", caption: "c", page: 1, ctx: CTX }));
  for (const [name, p] of [["page 1", p1], ["page 2", p2]] as const) {
    assert.ok(p.cols.includes("owner"), `${name}: Owner is listed — a row of the collection carries a value`);
    assert.deepEqual(p.heads, p.cols, `${name}: every listed column has its header, in order`);
    assert.ok(p.cells.every((n) => n === p.cols.length), `${name}: every row has one cell per listed column`);
    assert.equal(p.reason, null, `${name}: a kept column prints no reason`);
  }
  assert.equal(p1.cells.length, 50);
  assert.ok(p1.ownerCells.every((t) => t === "—"), "page 1's Owner cells are all empty…");
  assert.ok(p2.ownerCells.some((t) => /SP/.test(t)), "…and page 2 shows the owner code");

  // the client pager renders page 2 through the SAME column set it reads back from data-columns
  const clientRows = entityTxnRowsHtml(rows.slice(50), "member", CTX, [], p1.cols);
  const clientCells = domOf(`<table><tbody>${clientRows}</tbody></table>`).querySelectorAll("tbody tr").map((tr) => tr.children.length);
  assert.ok(clientCells.every((n) => n === p1.cols.length), "the pager's rows match the server's header");

  // control: deciding columns over the VISIBLE page (the defect) would drop Owner on page 1
  assert.ok(!memberTxnColumns(rows.slice(0, 50)).columns.includes("owner"), "control: a page-scoped decision loses the column");
});

/* ---------- an honesty column empty over the full collection is REMOVED, with its reason ---------- */

test("T2.1: an honesty column empty over the full collection is removed and prints its reason", () => {
  const rows = Array.from({ length: 3 }, (_, i) => txn(i));
  const t = tableShape(entityTxnTable(rows, { kind: "member", caption: "c", page: 0, ctx: CTX }));
  assert.ok(!t.cols.includes("owner"), "Owner is not listed");
  assert.ok(!t.heads.includes("owner"), "…not rendered");
  assert.equal(t.ownerCells.length, 0, "…and no row carries an Owner cell");
  assert.equal(t.reason, "Owner: no row carries a partial-sale qualifier or a spouse (SP), dependent (DC) or joint (JT) owner code.");

  // control: an honesty spec cannot be declared without its reason — the renderer refuses it
  const noReason: ColumnSpec<TxnRow> = { key: "owner", honesty: true, hasValue: (r) => r.owner === "spouse" };
  assert.throws(() => presentColumns(rows, [noReason]), /honesty column owner needs an emptyReason/);
  // …and a removed honesty column's reason is returned for the foot, never dropped
  const p = presentColumns(rows, [{ ...noReason, emptyReason: "Owner: none." }]);
  assert.deepEqual(p.emptied, [{ key: "owner", reason: "Owner: none." }]);
});

/* ---------- "partial" alone keeps the Owner column ---------- */

test("T2.1: a table whose only owner-cell content is the partial-sale qualifier keeps the Owner column", () => {
  // no owner code anywhere; one partial sale — ownerNote prints "partial" in the Owner cell (H-18)
  const rows = [txn(0), txn(1, { side: "sale_partial" }), txn(2)];
  const t = tableShape(entityTxnTable(rows, { kind: "member", caption: "c", page: 0, ctx: CTX }));
  assert.ok(t.cols.includes("owner"), "the partial qualifier is Owner content");
  assert.ok(t.ownerCells.some((c) => /partial/.test(c)), "and the cell shows it");
  assert.equal(t.reason, null);

  // control: a hasValue that checks owner codes only drops the column — and with it the qualifier
  const codesOnly: ColumnSpec<TxnRow> = {
    key: "owner", honesty: true, emptyReason: "x",
    hasValue: (r) => r.owner === "spouse" || r.owner === "child" || r.owner === "joint",
  };
  assert.ok(!presentColumns(rows, [codesOnly]).columns.includes("owner"), "control: owner codes only would lose it");
});

/* ---------- a flags column emptied by hoisting names the hoisted flags ---------- */

function delta(i: number, flags: string[]): QoqDeltaRow {
  return {
    cik: "0001067983", position_key: `sid:sec:${i}`, put_call: "LONG", curr_period: "2026-03-31", prev_period: "2025-12-31",
    change_kind: "add", prev_value_usd: 1000, curr_value_usd: 2000 + i, delta_value_usd: 1000 + i, prev_shares: 10, curr_shares: 20,
    delta_shares: 10, ssh_prnamt_type: "SH", flags, issuer_name: `ISSUER ${i}`, title_of_class: "COM",
  };
}

test("T2.1: a Flags column emptied because every flag was hoisted names the hoisted flags", () => {
  const html = changesTableHtml([delta(1, ["shares_unit_mismatch"]), delta(2, ["shares_unit_mismatch"])], "2026-03-31", null);
  const t = tableShape(html);
  assert.ok(!t.cols.includes("flags"), "every row's only flag is hoisted, so no row shows one");
  const label = flagLabels(["shares_unit_mismatch"])[0]!;
  assert.equal(t.reason, `Flags: every row carries ${label}, stated once above the table.`);
  assert.match(html, /class="caveat-line table-caveat"/, "…and the hoisted flag is stated above the table");

  // a table with NO flag at all says that instead — the two reasons are different facts
  assert.equal(tableShape(changesTableHtml([delta(1, []), delta(2, [])], "2026-03-31", null)).reason, "Flags: no row carries a flag.");
  // control: one row keeping a flag after hoisting keeps the column and prints no reason
  const kept = tableShape(changesTableHtml([delta(1, ["shares_unit_mismatch"]), delta(2, [])], "2026-03-31", null));
  assert.ok(kept.cols.includes("flags"));
  assert.equal(kept.reason, null);
  // the spec itself: hoisted flags never count as a value
  const spec = flagsColumnSpec<{ f: string[] }>((r) => r.f, ["a"]);
  assert.equal(spec.hasValue!({ f: ["a"] }), false);
  assert.equal(spec.hasValue!({ f: ["a", "b"] }), true);
});

/* ---------- presentColumns rejects degenerate input ---------- */

test("T2.1: presentColumns rejects degenerate input rather than guessing", () => {
  const rows = [{ v: 1 }];
  assert.throws(() => presentColumns(rows, []), /no column specs/);
  assert.throws(() => presentColumns(rows, [{ key: "a" }]), /has no hasValue/);
  assert.throws(() => presentColumns(rows, [{ key: "", always: true }]), /without a key/);
  assert.throws(() => presentColumns(rows, [{ key: "a", always: true }, { key: "a", always: true }]), /duplicate column key a/);
  assert.throws(() => presentColumns(rows, [{ key: "a", honesty: true, hasValue: () => false }]), /needs an emptyReason/);
  // the well-formed cases: an always column stays with no rows; an empty non-honesty column is removed with no reason
  assert.deepEqual(presentColumns([], [{ key: "a", always: true }, { key: "b", hasValue: () => true }]), {
    columns: ["a"],
    proven: [],
    emptied: [{ key: "b", reason: null }],
  });
});

/* ---------- review Q2-5: value-proven keys travel apart from `always` keys ---------- */

/* The property: G6 may excuse an all-empty visible column only when a VALUE
   elsewhere in the collection proved it. An `always` column is kept without a
   value check, so it is never "proven" — kept by fiat, it must still show a
   value on the page. `data-columns-proven` carries exactly the value-proven
   keys; the geometry control (layout-negative) blanks an always column and
   requires G6 to fail. */
test("Q2-5: presentColumns separates value-proven columns from always columns, and the table carries both sets", async () => {
  const { dataColumnsAttr } = await import("../src/lib/format.ts");
  const rows = [{ a: 1, b: null }, { a: null, b: null }];
  const p = presentColumns(rows, [
    { key: "id", always: true },
    { key: "a", hasValue: (r) => r.a != null },
    { key: "b", hasValue: (r) => r.b != null, always: true },
    { key: "c", hasValue: () => false },
  ]);
  assert.deepEqual(p.columns, ["id", "a", "b"], "always columns are kept");
  assert.deepEqual(p.proven, ["a"], "only a column a value proved is proven — never an always column without one");
  assert.equal(dataColumnsAttr(p), ' data-columns="id,a,b" data-columns-proven="a"');
  // control: an always column WITH a value is proven by that value, not by `always`
  assert.deepEqual(presentColumns([{ b: 1 }], [{ key: "b", hasValue: (r) => r.b != null, always: true }]).proven, ["b"]);
  // every table built through the one function carries the proven set (the signals hits: only ticker is value-checked)
  const { signalsBody } = await import("../src/lib/ui/index.ts");
  const hits = /<table class="etable etable-compact si-table"([^>]*)>/.exec(signalsBody({ v: 1, buildId: "b", computedAt: "c", thresholdVersion: "1", retentionDays: 90, coverageFrom: "2026-05-04", coverageTo: "2026-08-02", lifecycleNote: "n", compaction: "none", dateAnomaliesExcluded: 0, lagCaveat: "l", withheld: [], signals: [] } as never, CTX))?.[1] ?? "";
  assert.match(hits, /data-columns-proven="[^"]*"/);
});

/* ---------- review R2-9: the Committees reason never over-claims ---------- */

test("R2-9: an emptied Committees column says unmatchable members could not be matched — never that they sat on no committee", async () => {
  const { tickerUnifiedBody } = await import("../src/lib/ui/index.ts");
  const stamps = { buildId: "b", generatedAt: "2026-07-24 06:56 UTC", generatedAtDate: "2026-07-24" };
  const committees = { byMember: new Map(), windowFrom: "2025-01-01", windowTo: "2026-07-24", snapshotDate: "2026-07-24" };
  const deps = { signals: [], crowding: null, committees };
  const reasonOf = (rows: TxnRow[]): string => {
    const html = tickerUnifiedBody({ ticker: "WMB", txns: rows }, { state: "module-absent" } as never, stamps, CTX, { fullTable: false }, deps as never);
    const section = /<section class="panel design-members-active"[\s\S]*?<\/section>/.exec(html)?.[0] ?? "";
    return visibleText(domOf(section).querySelector("p.table-foot-reason") ?? domOf("<p></p>")).trim();
  };
  const matched = txn(1, { traded: "2026-06-01", filed: "2026-06-20" });
  const unmatched = txn(2, { traded: "2026-06-02", filed: "2026-06-21", bioguide: null, name: "Paper Filer" });
  assert.match(reasonOf([matched]), /none of these members sat on a committee/, "every member matched: the roster answers");
  const mixed = reasonOf([matched, unmatched]);
  assert.match(mixed, /1 member carries no member ID and cannot be matched to the roster — unanswerable, not cleared/);
  assert.doesNotMatch(mixed, /none of these members sat on a committee/, "the mixed case does not claim every member sat on none");
  const none = reasonOf([unmatched]);
  assert.match(none, /none can be matched to the committee roster/);
  assert.doesNotMatch(none, /sat on a committee/, "control: an unmatchable member is never said to have sat on no committee");
});

/* ---------- review R2-6: the directory's Top-5 through the one function ---------- */

test("R2-6: the directory's Top-5 presence is decided by directoryColumns, and the client renders the columns data-columns names", async () => {
  const { directoryColumns, instIndexBodyHtml } = await import("../src/lib/inst-index.ts");
  const row = (cik: string, top5: number | null | undefined) => ({
    cik, name: `F ${cik}`, tier: "top", period: "2026-03-31", valueUsd: 1000, positions: 3, hhi: null, hhiNote: "n", nullValueCount: 0,
    typing: null, changeHtml: null, reference: true, ...(top5 === undefined ? {} : { top5Share: top5 }),
  }) as never;
  const withShare = [row("1", 4200), row("2", null)];
  assert.ok(directoryColumns(withShare, 5).columns.includes("top5"), "topn 5 and a share: kept");
  assert.deepEqual(directoryColumns(withShare, 5).proven, ["top5"], "and proven by that share");
  const cut = directoryColumns(withShare, 10);
  assert.ok(!cut.columns.includes("top5"), "slices of ten: removed");
  assert.match(cut.emptied[0]!.reason!, /hold the top 10 positions, not five/);
  assert.ok(!directoryColumns([row("1", null)], 5).columns.includes("top5"), "no filer carries a share: removed");
  // the client renders exactly the columns its table names — even over rows that still carry the field
  const cols = (html: string): number => (/<tr\b[^>]*>([\s\S]*?)<\/tr>/.exec(html)?.[1]!.match(/<td\b/g) ?? []).length;
  const keep = instIndexBodyHtml(withShare, "", "value", "desc", undefined, undefined, directoryColumns(withShare, 5).columns).html;
  const drop = instIndexBodyHtml(withShare, "", "value", "desc", undefined, undefined, cut.columns).html;
  assert.equal(cols(keep), 6);
  assert.equal(cols(drop), 5, "data-columns without top5: no Top-5 cell, though the rows carry the field");
  // control: without the column set the row falls back to the field, and renders the cell the table dropped
  assert.equal(cols(instIndexBodyHtml(withShare, "", "value", "desc").html), 6, "control: the field alone would put the cell back");
});
