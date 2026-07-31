/* The coverage percentage must never overstate itself. Split from
   format.test.ts because it imports from the build-time data module. */

import { test } from "node:test";
import assert from "node:assert/strict";

import { pct } from "../src/lib/data.ts";

test("pct: prints '100' only when the numerator equals the denominator", () => {
  assert.equal(pct(49, 49), "100");
  assert.equal(pct(2499, 2500), "99.9", "one unparsed filing must not read as complete");
  assert.equal(pct(9995, 10000), "99.9", "five unparsed filings must not read as complete");
  assert.equal(pct(0, 0), "—", "no denominator is stated, not shown as a percentage");
});

test("pct: floors rather than rounds, so coverage is never inflated", () => {
  assert.equal(pct(267, 279), "95.6", "95.69… floors to 95.6");
  assert.equal(pct(1, 3), "33.3");
  assert.equal(pct(2, 3), "66.6", "66.66… floors to 66.6");
  assert.equal(pct(0, 100), "0.0");
});

test("pct: never exceeds the true value for any ratio", () => {
  for (let den = 1; den <= 400; den++) {
    for (const num of [0, 1, den - 1, den]) {
      if (num < 0) continue;
      const printed = pct(num, den);
      if (printed === "—") continue;
      const truth = (num / den) * 100;
      assert.ok(
        Number(printed) <= truth + 1e-9,
        `pct(${num},${den}) printed ${printed} above the true ${truth}`,
      );
      if (num === den) assert.equal(printed, "100");
      else assert.notEqual(printed, "100", `pct(${num},${den}) must not read as complete`);
    }
  }
});
