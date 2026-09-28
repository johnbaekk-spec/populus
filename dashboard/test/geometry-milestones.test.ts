/* DESIGN-POLISH T1.4/T1.10 — the geometry milestone map, pinned without a
   browser.

   Three properties:
   1. G2's M1 exemption list is EXACTLY the three containers M2 removes — no
      fourth selector can slip in, none can drop out, no duplicate can pad it
      (T1.4: "the milestone map's M1 exemption list is pinned to exactly those
      three selectors (control: a fourth selector fails the pin)"), and from
      M2 on nothing is exempt (T2.5) — including at the milestone this tree
      implements, so the gate itself runs with no exemption.
   2. Every check G1–G12 (and the four extra T1.2/T1.6 checks) has a
      milestone, so no check can be silently left out of the gate.
   3. The pending set at each milestone is pinned EXACTLY (M1 review Q-7): in
      M2 — this tree — no check is pending, so every check runs per route and
      must be green; the M1 slot keeps its record (G6 and G9 pending there).

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

test("from M2 on, G2 exempts nothing (T2.5) — and this tree's gate runs with no exemption", () => {
  for (const m of MILESTONE_ORDER) {
    if (m === "m1") continue;
    assert.deepEqual([...G2_EXEMPT[m]], [], `${m} must exempt nothing`);
  }
  assert.deepEqual([...g2Exemptions("m2")], []);
  assert.deepEqual([...g2Exemptions("m1")], [...G2_EXEMPT_M1]);
  /* the default the gate reads is the CURRENT milestone's list: T2.5 deleted
     the three boxes, so the gate must see any box that comes back */
  assert.deepEqual([...g2Exemptions()], [], "the current milestone exempts nothing");
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
  assert.equal(isPending("G9", "m2"), false);
  assert.equal(isPending("G1", "m1"), false);
  assert.ok(MILESTONE_ORDER.includes(CURRENT_MILESTONE));
});

/* M1 review Q-7: the pending set is pinned EXACTLY. A check moved to a later
   milestone in the map would otherwise leave the per-route gate silently (it
   becomes one test.fail() across routes) with every other test still green.
   DESIGN-POLISH M2 (T2.1–T2.6 land G6 and G9): the property is now "in M2 no
   check is pending" — the whole gate runs per route. The M1 slot keeps its own
   pin, so the record of what M1 deferred cannot be rewritten after the fact. */
type M = "m1" | "m2" | "m3" | "m4" | "m5";
function pendingSet(map: Readonly<Record<CheckId, string>>, current: M): string[] {
  const order = ["m1", "m2", "m3", "m4", "m5"];
  return (Object.keys(map) as CheckId[]).filter((c) => order.indexOf(map[c]!) > order.indexOf(current)).sort();
}

/* DESIGN-POLISH M3: the tree implements M3 (the kind vocabulary lands, so the
   canvas allowances scoped `until: "m3"` expire — CD-4); M3 adds no geometry
   check and defers none, so the pending set stays empty at m2 AND at m3. */
/* DESIGN-POLISH M3: the tree implements M3 (the kind vocabulary lands, so the
   canvas allowances scoped `until: "m3"` expire — CD-4); M3 adds no geometry
   check and defers none, so the pending set stays empty at m2 AND at m3.
   M4 changes which rows appear, not how they look: it adds no geometry
   check, and the design-reference spec pins the milestone at m3. */
test("Q-7 (M3): this tree implements M3, and no check is pending (at m2, m3 or m4)", () => {
  assert.equal(CURRENT_MILESTONE, "m3");
  assert.deepEqual(pendingSet(CHECK_MILESTONE, "m2"), [], "no check may wait for a later milestone");
  assert.deepEqual(pendingSet(CHECK_MILESTONE, "m3"), [], "…and none at m3");
  assert.deepEqual(pendingSet(CHECK_MILESTONE, "m4"), [], "…and none at m4");
  const all: CheckId[] = [...GEOMETRY_CHECKS, ...EXTRA_CHECKS];
  assert.deepEqual(all.filter((c) => isPending(c)), [], "isPending (at the current milestone) agrees with the map");
});

test("Q-7 (M2) control: a check moved to a later milestone is caught as pending", () => {
  assert.deepEqual(pendingSet({ ...CHECK_MILESTONE, G12: "m3" }, "m2"), ["G12"], "one planted pending check is caught");
  assert.deepEqual(
    pendingSet({ ...CHECK_MILESTONE, G12: "m3", G6: "m4", headFont: "m5" }, "m2"),
    ["G12", "G6", "headFont"],
    "a pending third check is caught too — the pin is on the whole set",
  );
  assert.deepEqual(
    pendingSet({ ...CHECK_MILESTONE, G9: "m3" }, "m2"),
    ["G9"],
    "G9 pushed back to M3 would leave the per-route gate: the pin sees it",
  );
});

test("the M1 slot stays pinned: in M1 exactly G6 and G9 were pending — nothing else", () => {
  assert.deepEqual(pendingSet(CHECK_MILESTONE, "m1"), ["G6", "G9"]);
  const all: CheckId[] = [...GEOMETRY_CHECKS, ...EXTRA_CHECKS];
  assert.deepEqual(all.filter((c) => isPending(c, "m1")).sort(), ["G6", "G9"], "isPending agrees with the map at m1");
  assert.deepEqual(pendingSet({ ...CHECK_MILESTONE, G12: "m2" }, "m1"), ["G12", "G6", "G9"], "control: a third M1-pending check is caught");
});
