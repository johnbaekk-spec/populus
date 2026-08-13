/* C-4 net-interval algebra: the EXHAUSTIVE 5×5 state-pair truth table from
   the plan (§4 C-4), source normalization (constraint 7), the strict-sign
   direction rule, overlap non-transitivity, and the total display rank key
   over every kind pair including exact-key collisions (constraint 8).

   These are table-driven by design: a sampled test would let a mutation of
   one cell survive. Every cell of the plan's table is asserted. */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  sumRanges,
  toNetInterval,
  subNet,
  netFlow,
  netDirection,
  netIntervalText,
  netOverlaps,
  compareNet,
  rankNetRows,
  type NetInterval,
} from "../src/lib/derive.ts";

/* Representative operands per state. L (lower-open) is constructed directly:
   no SOURCE state produces it — it exists only as a net result. */
const OPERANDS: Record<string, NetInterval> = {
  E: { kind: "empty" },
  D: { kind: "undisclosed" },
  F: { kind: "finite", low: 1000, high: 15000 },
  L: { kind: "lower-open", high: 5000 },
  U: { kind: "upper-open", low: 50000 },
};

test("C-4: the complete 5×5 state-pair table (rows = purchases, cols = sales)", () => {
  // Plan table, verbatim: rows Ø D F L U × cols Ø D F L U.
  const TABLE: Record<string, Record<string, NetInterval["kind"]>> = {
    E: { E: "finite", D: "undisclosed", F: "finite", L: "upper-open", U: "lower-open" },
    D: { E: "undisclosed", D: "undisclosed", F: "undisclosed", L: "undisclosed", U: "undisclosed" },
    F: { E: "finite", D: "undisclosed", F: "finite", L: "upper-open", U: "lower-open" },
    L: { E: "lower-open", D: "undisclosed", F: "lower-open", L: "unbounded", U: "lower-open" },
    U: { E: "upper-open", D: "undisclosed", F: "upper-open", L: "upper-open", U: "unbounded" },
  };
  for (const p of Object.keys(TABLE)) {
    for (const s of Object.keys(TABLE[p]!)) {
      const got = subNet(OPERANDS[p]!, OPERANDS[s]!);
      assert.equal(got.kind, TABLE[p]![s], `${p} − ${s}: expected ${TABLE[p]![s]}, got ${got.kind}`);
    }
  }
  // Ø − Ø is not merely finite — it is EXACTLY the identity [0,0]: a member
  // with no rows on either side has summed zero, which is a fact.
  const zz = subNet(OPERANDS.E!, OPERANDS.E!);
  assert.deepEqual(zz, { kind: "finite", low: 0, high: 0 });
  // Endpoint arithmetic, not just kinds: F − F = [pL−sU, pU−sL].
  const ff = subNet(OPERANDS.F!, OPERANDS.F!);
  assert.deepEqual(ff, { kind: "finite", low: 1000 - 15000, high: 15000 - 1000 });
});

test("constraint 7: an 'Under $X' source row normalizes to finite [0,X], and Ø − Under$X = [−X, 0]", () => {
  // The live contract: a null low contributes 0 → closed [0,X]. NOT lower-open.
  const under = sumRanges([{ low: null, high: 15000 }]);
  assert.equal(under.kind, "closed");
  const normalized = toNetInterval(under);
  assert.deepEqual(normalized, { kind: "finite", low: 0, high: 15000 });
  // The plan's regression case: Ø − Under$X is a FINITE interval [−X, 0].
  const net = netFlow(sumRanges([]), under);
  assert.deepEqual(net, { kind: "finite", low: -15000, high: 0 });
});

test("source normalization: every SumRanges kind maps with no lower-open case", () => {
  assert.equal(toNetInterval(sumRanges([])).kind, "empty");
  assert.equal(toNetInterval(sumRanges([{ low: null, high: null }])).kind, "undisclosed");
  assert.equal(toNetInterval(sumRanges([{ low: 1001, high: 15000 }])).kind, "finite");
  assert.equal(toNetInterval(sumRanges([{ low: 1000001, high: null }])).kind, "upper-open");
});

test("undisclosed poisons: any D operand yields D, never a zero", () => {
  for (const other of Object.values(OPERANDS)) {
    assert.equal(subNet(OPERANDS.D!, other).kind, "undisclosed");
    assert.equal(subNet(other, OPERANDS.D!).kind, "undisclosed");
  }
});

test("strict-sign direction: touching zero is indeterminate", () => {
  assert.equal(netDirection({ kind: "finite", low: 1, high: 500 }), "accumulation");
  assert.equal(netDirection({ kind: "finite", low: -500, high: -1 }), "disposal");
  assert.equal(netDirection({ kind: "finite", low: 0, high: 500 }), null); // [0,u] touches zero
  assert.equal(netDirection({ kind: "finite", low: -500, high: 0 }), null); // [l,0] touches zero
  assert.equal(netDirection({ kind: "finite", low: -5, high: 5 }), null); // spans zero
  assert.equal(netDirection({ kind: "upper-open", low: 100 }), "accumulation");
  assert.equal(netDirection({ kind: "upper-open", low: 0 }), null);
  assert.equal(netDirection({ kind: "lower-open", high: -100 }), "disposal");
  assert.equal(netDirection({ kind: "lower-open", high: 0 }), null);
  assert.equal(netDirection({ kind: "unbounded" }), null);
  assert.equal(netDirection({ kind: "undisclosed" }), null);
  assert.equal(netDirection({ kind: "empty" }), null);
});

test("overlap is non-transitive and undisclosed has no answer", () => {
  const a: NetInterval = { kind: "finite", low: 0, high: 10 };
  const b: NetInterval = { kind: "finite", low: 8, high: 20 };
  const c: NetInterval = { kind: "finite", low: 18, high: 30 };
  assert.equal(netOverlaps(a, b), true);
  assert.equal(netOverlaps(b, c), true);
  assert.equal(netOverlaps(a, c), false); // A~B, B~C, A≁C — not an equivalence
  assert.equal(netOverlaps(a, { kind: "undisclosed" }), null);
  assert.equal(netOverlaps({ kind: "unbounded" }, c), true); // unbounded overlaps everything
});

test("constraint 8: the display key is total over every orderable kind pair", () => {
  // Every orderable kind, with ids that force the identity tie-break.
  const kinds: [string, NetInterval][] = [
    ["E", { kind: "empty" }], // sorts at its identity value 0
    ["F", { kind: "finite", low: 1000, high: 15000 }],
    ["L", { kind: "lower-open", high: 5000 }],
    ["U", { kind: "upper-open", low: 50000 }],
    ["X", { kind: "unbounded" }],
  ];
  // Totality + antisymmetry over every pair.
  for (const [na, a] of kinds) {
    for (const [nb, b] of kinds) {
      const ab = compareNet(a, b, "aaa", "bbb");
      const ba = compareNet(b, a, "bbb", "aaa");
      assert.ok(Number.isFinite(ab), `${na} vs ${nb} must be finite`);
      assert.equal(Math.sign(ab), -Math.sign(ba), `${na}/${nb} antisymmetry`);
    }
  }
  // Ordering semantics: lower desc first — U (l=50000) before F (l=1000)
  // before E (0) before L/X (−∞); among −∞ lowers, upper desc — X (+∞)
  // before L (5000).
  const ordered = [...kinds].sort(([ia, a], [ib, b]) => compareNet(a, b, ia, ib)).map(([n]) => n);
  assert.deepEqual(ordered, ["U", "F", "E", "X", "L"]);
  // Exact-key collision: identical intervals fall back to identity asc.
  const same: NetInterval = { kind: "finite", low: 5, high: 9 };
  assert.ok(compareNet(same, same, "A000001", "B000001") < 0);
  assert.ok(compareNet(same, same, "B000001", "A000001") > 0);
  assert.equal(compareNet(same, same, "A000001", "A000001"), 0);
});

test("rankNetRows: undisclosed goes to a labeled structural bucket AFTER ranked rows, never a sentinel", () => {
  const rows = [
    { id: "b", net: { kind: "undisclosed" } as NetInterval },
    { id: "a", net: { kind: "finite", low: 1, high: 2 } as NetInterval },
    { id: "c", net: { kind: "upper-open", low: 100 } as NetInterval },
    { id: "d", net: { kind: "undisclosed" } as NetInterval },
  ];
  const { ranked, undisclosedBucket } = rankNetRows(rows, (r) => r.net, (r) => r.id);
  assert.deepEqual(ranked.map((r) => r.id), ["c", "a"]);
  assert.deepEqual(undisclosedBucket.map((r) => r.id), ["b", "d"]);
});

test("net interval text: absent bounds are said to be absent, never printed as numbers", () => {
  assert.equal(netIntervalText({ kind: "empty" }), "$0");
  assert.equal(netIntervalText({ kind: "undisclosed" }), "not disclosed");
  assert.match(netIntervalText({ kind: "lower-open", high: 5000 }), /^at most /);
  assert.match(netIntervalText({ kind: "upper-open", low: 5000 }), /^at least /);
  assert.match(netIntervalText({ kind: "unbounded" }), /open bounds on both sides/);
  assert.match(netIntervalText({ kind: "finite", low: -15000, high: 0 }), /−\$15\.0K to \$0/);
});
