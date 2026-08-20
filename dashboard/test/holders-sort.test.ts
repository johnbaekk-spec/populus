/* R48 ordering semantics for the holders table.

   The no-sentinel rule — "did not report" and "reported zero" are different
   claims — is enforced where it CAN be. For this table it largely cannot be,
   because the producer coalesces an all-undisclosed bucket to a real 0 before
   this layer sees it (external code review, F1). So the bucket is a schema-drift
   guard, the zero ambiguity is disclosed in the rendered caveat, and the tests
   below say which is which instead of implying a guarantee that does not hold. */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  HOLDER_COLUMNS,
  HOLDER_ZERO_CAVEAT,
  holderDefaultDir,
  holderSortNote,
  orderRankedHolders,
} from "../src/lib/holders-sort.ts";
import type { TopHolderRow } from "../src/lib/inst.ts";

function holder(over: Partial<TopHolderRow> = {}): TopHolderRow {
  return {
    issuer_key: "entity:cik:0000320193",
    period_of_report: "2026-03-31",
    rank: 1,
    cik: "0001067983",
    filer_name: "BERKSHIRE HATHAWAY INC",
    issuer_name: "APPLE INC",
    issuer_key_source: "entity",
    value_usd: 2000,
    security_count: 1,
    flags: [],
    ...over,
  };
}

const rows: TopHolderRow[] = [
  holder({ rank: 1, cik: "0000001", filer_name: "CHARLIE CAP", value_usd: 300, security_count: 3 }),
  holder({ rank: 2, cik: "0000002", filer_name: "alpha advisors", value_usd: 100, security_count: 9 }),
  holder({ rank: 3, cik: "0000003", filer_name: "Bravo Bank", value_usd: 200, security_count: 5 }),
];

test("default sort is value descending", () => {
  const { ranked, unranked } = orderRankedHolders(rows, "value", "desc");
  assert.deepEqual(ranked.map((r) => r.value_usd), [300, 200, 100]);
  assert.equal(unranked.length, 0);
});

test("direction toggles the order exactly", () => {
  const asc = orderRankedHolders(rows, "value", "asc").ranked.map((r) => r.value_usd);
  assert.deepEqual(asc, [100, 200, 300]);
});

test("filer sort is case-insensitive so 'alpha' does not sort after 'Bravo'", () => {
  const { ranked } = orderRankedHolders(rows, "filer", "asc");
  assert.deepEqual(ranked.map((r) => r.filer_name), ["alpha advisors", "Bravo Bank", "CHARLIE CAP"]);
});

test("the unranked bucket is UNREACHABLE for this table, and that is the finding", () => {
  // Code review (cycle 4, F4) caught this test asserting a state the data cannot
  // reach — the same mistake as the earlier NaN fixture, in a new costume.
  //
  // The loader is `value_usd: Number(r.value_usd)` (inst.ts). `Number(null)` is
  // 0, so even a NULL in the database arrives here as a real zero. Injecting
  // `null` straight into a fixture bypasses that coercion and proves nothing
  // about production.
  //
  // What is true, and what this test now pins: the bucket cannot fire for this
  // table, so the no-sentinel guarantee CANNOT be enforced at this layer. A real
  // guarantee would have to live in the loader (preserve NULL) or the producer
  // (do not COALESCE). Both are recorded as open work.
  // NOTE (cycle 4 F7): this line mimics the loader; it does not PROVE it. The
  // proof lives in `inst-loader-coercion.test.ts`, which builds a real SQLite
  // database with a genuine NULL and calls `loadInstitutional`. This test only
  // documents the downstream consequence, and says so rather than overclaiming.
  const coerced = Number(null as unknown as number); // mirrors the loader; see the real proof
  assert.equal(coerced, 0, "mirrors the loader's coercion — the loader itself is pinned elsewhere");

  const asLoaded = [...rows, holder({ rank: 9, cik: "0000009", filer_name: "NO VALUE LLC", value_usd: coerced })];
  const { ranked, unranked } = orderRankedHolders(asLoaded, "value", "asc");
  assert.equal(unranked.length, 0, "nothing can land in the bucket once the loader has run");
  assert.equal(ranked[0].filer_name, "NO VALUE LLC", "it sorts as the zero it became — indistinguishable");

  // The bucket code itself still behaves correctly if ever handed a null; that
  // is a property of the pure function, NOT a schema guard, and is labelled so.
  const direct = orderRankedHolders(
    [...rows, holder({ rank: 9, cik: "0000009", filer_name: "DIRECT NULL", value_usd: null as unknown as number })],
    "value",
    "asc",
  );
  assert.equal(direct.unranked.length, 1, "pure-function behaviour, unreachable through the loader");
});

test("a real zero sorts as a zero — and the table discloses what a zero can mean", () => {
  // The counterpart to the guard above: the producer coalesces an all-undisclosed
  // bucket to 0, so this layer CANNOT distinguish it from a reported zero and
  // must not pretend to. It sorts as the number it is, and the ambiguity is
  // disclosed in the rendered caveat instead of hidden behind a false guarantee.
  const withZero = [...rows, holder({ rank: 4, cik: "0000004", filer_name: "ZERO CO", value_usd: 0 })];
  const { ranked, unranked } = orderRankedHolders(withZero, "value", "asc");
  assert.equal(unranked.length, 0);
  assert.equal(ranked[0].filer_name, "ZERO CO");
  // The caveat must name BOTH readings; a caveat that mentions only one is the
  // kind of half-disclosure this product treats as worse than none.
  // Code review round 2 (F1): disclosing only the $0 case was a half-disclosure.
  // SUM omits undisclosed holdings, so `100, NULL` yields 100 — a partial total
  // that looks complete. The caveat must name the partial case, which is the
  // dangerous one, not just the visible zero.
  assert.ok(HOLDER_ZERO_CAVEAT.includes("partial"));
  assert.ok(HOLDER_ZERO_CAVEAT.includes("omitted from the sum"));
  assert.ok(HOLDER_ZERO_CAVEAT.includes("not necessarily a reported zero"));
});

test("ties break deterministically on rank then CIK, in both directions", () => {
  const tied = [
    holder({ rank: 5, cik: "0000bbb", value_usd: 100 }),
    holder({ rank: 2, cik: "0000aaa", value_usd: 100 }),
    holder({ rank: 2, cik: "0000zzz", value_usd: 100 }),
  ];
  for (const dir of ["asc", "desc"] as const) {
    const order = orderRankedHolders(tied, "value", dir).ranked.map((r) => `${r.rank}:${r.cik}`);
    assert.deepEqual(order, ["2:0000aaa", "2:0000zzz", "5:0000bbb"]);
  }
});

test("sorting does not mutate the caller's array", () => {
  const input = rows.slice();
  const before = input.map((r) => r.cik);
  orderRankedHolders(input, "value", "asc");
  assert.deepEqual(input.map((r) => r.cik), before);
});

test("rank, securities and issuer-key actually ORDER, not merely fail to throw", () => {
  // Code review (cycle 4, F2): the coverage claim rested on a doesNotThrow loop,
  // which asserts nothing about ordering. These assert the resulting order.
  const byRank = orderRankedHolders(rows, "rank", "asc").ranked.map((r) => r.rank);
  assert.deepEqual(byRank, [1, 2, 3], "rank ascends");
  assert.deepEqual(orderRankedHolders(rows, "rank", "desc").ranked.map((r) => r.rank), [3, 2, 1]);

  const bySec = orderRankedHolders(rows, "securities", "desc").ranked.map((r) => r.security_count);
  assert.deepEqual(bySec, [9, 5, 3], "securities descends");
  assert.deepEqual(orderRankedHolders(rows, "securities", "asc").ranked.map((r) => r.security_count), [3, 5, 9]);

  const mixed = [
    holder({ rank: 1, cik: "0000a", issuer_key_source: "name" }),
    holder({ rank: 2, cik: "0000b", issuer_key_source: "cusip6" }),
    holder({ rank: 3, cik: "0000c", issuer_key_source: "entity" }),
  ];
  assert.deepEqual(
    orderRankedHolders(mixed, "keysrc", "asc").ranked.map((r) => r.issuer_key_source),
    ["cusip6", "entity", "name"],
    "issuer key sorts lexically ascending",
  );
  assert.deepEqual(
    orderRankedHolders(mixed, "keysrc", "desc").ranked.map((r) => r.issuer_key_source),
    ["name", "entity", "cusip6"],
    "and descending — the resolution notes claimed both directions, so assert both",
  );
});

test("every column is either sortable or exempted WITH a written reason", () => {
  // The previous version of this test iterated only columns already marked
  // sortable, so a data column silently left unsortable could never fail it —
  // circular, and external code review (F1) caught it. This version asserts the
  // exemption set is explicit and justified, which is what the plan requires.
  const exempt = HOLDER_COLUMNS.filter((c) => c.key === null);
  assert.deepEqual(exempt.map((c) => c.label), ["Flags", "Src"], "the exemption set is exactly these two");
  for (const c of HOLDER_COLUMNS) {
    assert.ok(c.label.length > 0);
    if (c.key === null) {
      assert.ok(c.why && c.why.length > 20, `${c.label} is not sortable and must say why`);
    } else {
      assert.doesNotThrow(() => orderRankedHolders(rows, c.key!, "desc"));
    }
  }
});

test("default direction: text ascends, numbers descend", () => {
  assert.equal(holderDefaultDir("filer"), "asc");
  assert.equal(holderDefaultDir("keysrc"), "asc");
  assert.equal(holderDefaultDir("value"), "desc");
  assert.equal(holderDefaultDir("securities"), "desc");
});

test("the sort note states the unranked bucket rather than hiding it", () => {
  const none = holderSortNote("value", "desc", 0);
  assert.ok(none.includes("descending"));
  assert.ok(!none.includes("never treated as zero"));
  const some = holderSortNote("value", "desc", 2);
  assert.ok(some.includes("2 rows"));
  assert.ok(some.includes("never treated as zero"));
});
