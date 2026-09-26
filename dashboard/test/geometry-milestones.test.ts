/* DESIGN-POLISH T1.4/T1.10 — the geometry milestone map, pinned without a
   browser.

   Two properties:
   1. G2's M1 exemption list is EXACTLY the three containers M2 removes — no
      fourth selector can slip in, none can drop out, no duplicate can pad it
      (T1.4: "the milestone map's M1 exemption list is pinned to exactly those
      three selectors (control: a fourth selector fails the pin)"), and from
      M2 on nothing is exempt (T2.5).
   2. Every check G1–G12 (and the four extra T1.2/T1.6 checks) has a
      milestone, so no check can be silently left out of the gate.

   The pin is a named predicate so its controls exercise the SAME comparison
   the real assertion uses: a control that re-implemented it would only prove
   the copy works. */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CHECK_MILESTONE,
  CURRENT_MILESTONE,
  EXTRA_CHECKS,
  G2_EXEMPT,
  G2_EXEMPT_M1,
  GEOMETRY_CHECKS,
  MILESTONE_ORDER,
  isPending,
  g2Exemptions,
  type CheckId,
} from "./geometry/milestones.ts";

/** The three containers the plan names (Tasks, G2; T1.4), written out here
    independently of the map so the pin compares two sources. */
const PLAN_M1_EXEMPT = [
  ".design-flow-band > .panel > .table-scroll",
  ".design-history",
  '[data-holdings-surface="filer"] .table-scroll',
];

/** Exact-set equality with no duplicates and no extras. */
function exactlyTheseSelectors(actual: readonly string[], expected: readonly string[]): boolean {
  if (actual.length !== expected.length) return false;
  if (new Set(actual).size !== actual.length) return false;
  const want = new Set(expected);
  return actual.every((s) => want.has(s));
}

test("G2's M1 exemption list is exactly the three containers M2 removes", () => {
  assert.equal(exactlyTheseSelectors(G2_EXEMPT_M1, PLAN_M1_EXEMPT), true, JSON.stringify(G2_EXEMPT_M1));
  assert.equal(exactlyTheseSelectors(G2_EXEMPT.m1, PLAN_M1_EXEMPT), true, "the m1 slot must be that list");
});

test("control: a fourth selector, a dropped selector or a duplicate each FAIL the pin", () => {
  const fourth = [...G2_EXEMPT_M1, ".si-hits-scroll"];
  assert.equal(exactlyTheseSelectors(fourth, PLAN_M1_EXEMPT), false, "a fourth selector must fail the pin");
  const dropped = G2_EXEMPT_M1.slice(0, 2);
  assert.equal(exactlyTheseSelectors(dropped, PLAN_M1_EXEMPT), false, "a missing selector must fail the pin");
  const duplicated = [G2_EXEMPT_M1[0]!, G2_EXEMPT_M1[0]!, G2_EXEMPT_M1[1]!];
  assert.equal(exactlyTheseSelectors(duplicated, PLAN_M1_EXEMPT), false, "a duplicate must not stand in for a selector");
  const widened = [G2_EXEMPT_M1[0]!, G2_EXEMPT_M1[1]!, ".table-scroll"];
  assert.equal(exactlyTheseSelectors(widened, PLAN_M1_EXEMPT), false, "a broader selector must fail the pin");
});

test("from M2 on, G2 exempts nothing (T2.5)", () => {
  for (const m of MILESTONE_ORDER) {
    if (m === "m1") continue;
    assert.deepEqual([...G2_EXEMPT[m]], [], `${m} must exempt nothing`);
  }
  assert.deepEqual([...g2Exemptions("m2")], []);
  assert.deepEqual([...g2Exemptions("m1")], [...G2_EXEMPT_M1]);
});

test("every check G1–G12 has a milestone, and nothing unnamed is mapped", () => {
  const expected = ["G1", "G2", "G3", "G4", "G5", "G6", "G7", "G8", "G9", "G10", "G11", "G11b", "G12"];
  assert.deepEqual([...GEOMETRY_CHECKS], expected, "the twelve plan checks (G11 has its b half)");
  const all: CheckId[] = [...GEOMETRY_CHECKS, ...EXTRA_CHECKS];
  for (const c of all) {
    assert.ok(MILESTONE_ORDER.includes(CHECK_MILESTONE[c]), `${c} has no valid milestone`);
  }
  assert.deepEqual(Object.keys(CHECK_MILESTONE).sort(), [...all].sort(), "the map names exactly the checks");
});

test("control: a check missing from the map is detected", () => {
  const partial: Partial<Record<CheckId, string>> = { ...CHECK_MILESTONE };
  delete partial.G7;
  const missing = [...GEOMETRY_CHECKS].filter((c) => !(c in partial));
  assert.deepEqual(missing, ["G7"]);
});

test("pending follows the map: G6 and G9 land in M2, so they are pending in M1 only", () => {
  assert.equal(CHECK_MILESTONE.G6, "m2");
  assert.equal(CHECK_MILESTONE.G9, "m2");
  assert.equal(isPending("G6", "m1"), true);
  assert.equal(isPending("G9", "m1"), true);
  assert.equal(isPending("G6", "m2"), false);
  assert.equal(isPending("G1", "m1"), false);
  assert.ok(MILESTONE_ORDER.includes(CURRENT_MILESTONE));
});

/* M1 review Q-7: the pending set is pinned EXACTLY. A check moved to a later
   milestone in the map would otherwise leave the per-route gate silently (it
   becomes one test.fail() across routes) with every other test still green. */
function pendingSet(map: Readonly<Record<CheckId, string>>, current: "m1" | "m2" | "m3" | "m4" | "m5" = "m1"): string[] {
  const order = ["m1", "m2", "m3", "m4", "m5"];
  return (Object.keys(map) as CheckId[]).filter((c) => order.indexOf(map[c]!) > order.indexOf(current)).sort();
}

test("Q-7: in M1 exactly G6 and G9 are pending — nothing else", () => {
  assert.equal(CURRENT_MILESTONE, "m1");
  assert.deepEqual(pendingSet(CHECK_MILESTONE), ["G6", "G9"]);
  const all: CheckId[] = [...GEOMETRY_CHECKS, ...EXTRA_CHECKS];
  assert.deepEqual(all.filter((c) => isPending(c)).sort(), ["G6", "G9"], "isPending agrees with the map");
  assert.deepEqual(pendingSet({ ...CHECK_MILESTONE, G12: "m2" }), ["G12", "G6", "G9"], "control: a third pending check is caught");
});
