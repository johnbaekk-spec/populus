/* A-2 institutional index: period-correct value sourcing, the HHI partial-
   denominator withholding rule (constraint 5), the no-sentinel sort bucket,
   and the naming rule (constraint 3 — never "AUM"/"fund size"). */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildInstIndexRow,
  sortInstIndexRows,
  filterInstIndexRows,
  instIndexRowHtml,
  INST_INDEX_HEADS,
  type InstIndexRow,
} from "../src/lib/inst-index.ts";

const filer = { cik: "0000102909", filer_name: "Vanguard Group Inc", latest_period: "2026-06-30" };

function conc(over: Partial<{ total_value_usd: number; position_count: number; null_value_positions: number; hhi: number | null }> = {}) {
  return { total_value_usd: 1_000_000, position_count: 10, null_value_positions: 0, hhi: 1200, ...over };
}

test("constraint 5: HHI is withheld when the denominator is partial", () => {
  const clean = buildInstIndexRow(filer, conc(), "top");
  assert.equal(clean.hhi, 1200);

  const partial = buildInstIndexRow(filer, conc({ null_value_positions: 3 }), "top");
  assert.equal(partial.hhi, null, "any NULL-valued position voids HHI");
  assert.match(partial.hhiNote, /partial denominator/);

  // HHI = 10,000 on a COMPLETE single-position book is correct, not a bug.
  const single = buildInstIndexRow(filer, conc({ position_count: 1, hhi: 10000 }), "top");
  assert.equal(single.hhi, 10000);

  const missing = buildInstIndexRow(filer, null, "tail");
  assert.equal(missing.value, null);
  assert.equal(missing.hhi, null);
});

test("no-sentinel sort: null-key rows go to a trailing bucket, never interleaved", () => {
  const a = buildInstIndexRow({ ...filer, cik: "0000000001", filer_name: "A" }, conc({ total_value_usd: 5 }), "top");
  const b = buildInstIndexRow({ ...filer, cik: "0000000002", filer_name: "B" }, null, "tail");
  const c = buildInstIndexRow({ ...filer, cik: "0000000003", filer_name: "C" }, conc({ total_value_usd: 9 }), "top");
  const { ranked, unranked } = sortInstIndexRows([a, b, c], "value", "desc");
  assert.deepEqual(ranked.map((r) => r.name), ["C", "A"]);
  assert.deepEqual(unranked.map((r) => r.name), ["B"]);
  // HHI sort: the partial-denominator row is unranked too.
  const partial = buildInstIndexRow({ ...filer, cik: "0000000004", filer_name: "D" }, conc({ null_value_positions: 1 }), "top");
  const hhiSort = sortInstIndexRows([a, partial], "hhi", "desc");
  assert.deepEqual(hhiSort.unranked.map((r) => r.name), ["D"]);
});

test("search: name substring and bare-CIK prefix", () => {
  const rows: InstIndexRow[] = [
    buildInstIndexRow(filer, conc(), "top"),
    buildInstIndexRow({ cik: "0001067983", filer_name: "Other Filer", latest_period: "2026-06-30" }, conc(), "tail"),
  ];
  assert.equal(filterInstIndexRows(rows, "vanguard").length, 1);
  assert.equal(filterInstIndexRows(rows, "1067983").length, 1);
  assert.equal(filterInstIndexRows(rows, "").length, 2);
});

test("constraint 3: the surface never says AUM or fund size", () => {
  const html =
    INST_INDEX_HEADS.map((h) => h.label).join(" ") +
    instIndexRowHtml(buildInstIndexRow(filer, conc(), "top"), () => "/x/");
  assert.doesNotMatch(html.toLowerCase(), /\baum\b|fund size/);
  assert.match(INST_INDEX_HEADS.map((h) => h.label).join(" "), /Reported 13\(f\) long value/);
});

test("row html: null value renders as labeled n/a, never $0; null-value positions surface", () => {
  const missing = instIndexRowHtml(buildInstIndexRow(filer, null, "tail"), () => "/x/");
  assert.match(missing, /n\/a ·§/);
  assert.doesNotMatch(missing, /\$0</);
  const withNulls = instIndexRowHtml(
    buildInstIndexRow(filer, conc({ null_value_positions: 4 }), "top"),
    () => "/x/",
  );
  assert.match(withNulls, /\+4 null/);
});
