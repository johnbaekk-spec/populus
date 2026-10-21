/* Launch review (weight item 3; R35, LD31, D6): the phone harness's DOM
   budget gates every route LD31 hands to an integrated milestone, records
   /signals/ under D6 instead of gating it, and partitions the harness's
   views exactly — no view is silently ungated. The map is
   test/geometry/dom-budget.ts; the views are read from phone.spec.ts's own
   VIEWS block (the spec cannot be imported under node --test). */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import { DOM_BUDGET, DOM_D6_MEASURED, DOM_GATED, DOM_MEASURED_ONLY, domBudgetProblem } from "./geometry/dom-budget.ts";

const SPEC = readFileSync(path.resolve(import.meta.dirname, "geometry", "phone.spec.ts"), "utf-8");
const DOC = readFileSync(path.resolve(import.meta.dirname, "..", "..", "docs", "frontend", "launch-redesign.md"), "utf-8");

function viewIds(spec: string): string[] {
  const block = /export const VIEWS: readonly View\[\] = \[([\s\S]*?)\n\];/.exec(spec)?.[1];
  if (!block) throw new Error("phone.spec.ts carries no VIEWS block");
  return [...block.matchAll(/\{ id: "([^"]+)"/g)].map((m) => m[1]!);
}

test("R35 / LD31: every phone view is gated, D6-measured or measured-only — exactly one", () => {
  const ids = viewIds(SPEC);
  assert.equal(ids.length, 21, "the harness's 21 views");
  for (const id of ids) {
    const n = [DOM_GATED, DOM_D6_MEASURED, DOM_MEASURED_ONLY].filter((s) => s.has(id)).length;
    assert.equal(n, 1, `${id}: in exactly one set`);
  }
  const all = new Set([...DOM_GATED, ...DOM_D6_MEASURED, ...DOM_MEASURED_ONLY]);
  assert.deepEqual([...all].filter((id) => !ids.includes(id)), [], "no set names a view the harness lacks");
});

test("R35 / LD31: the reshaped routes gate — home, /congress/, member pages, /e/, ticker (both tabs), holders, /institutional/, Methodology — plus M1c's three", () => {
  for (const id of ["home", "congress", "member-active", "member-sparse", "member-heavy", "e-member", "ticker", "ticker-inst", "holders", "institutional", "methodology", "filer", "congress-data", "not-found"]) {
    assert.ok(DOM_GATED.has(id), `${id} gates`);
  }
  assert.equal(DOM_BUDGET, 3000);
});

test("D6: every /signals/ tab is a measured exception, never gated, and the decision record states the overage", () => {
  for (const id of ["signals", "signals-inst", "signals-overlap", "signals-playbooks"]) {
    assert.ok(DOM_D6_MEASURED.has(id) && !DOM_GATED.has(id), `${id}: D6`);
    assert.equal(domBudgetProblem(id, 35_446), null, `${id}: over budget is recorded, not a failure`);
  }
  assert.match(DOC, /## D6 — \/signals\/ first-load DOM/, "the decision record carries the D6 section");
  assert.match(DOC, /35,446/, "with the T0 measurement");
});

test("R35 controls: the gate fails one element over the budget on a gated view, passes at the budget, and ignores a measured-only view", () => {
  assert.equal(domBudgetProblem("home", DOM_BUDGET), null);
  assert.equal(domBudgetProblem("home", DOM_BUDGET + 1), `R35 DOM 3001 elements, budget 3000 (LD31)`);
  assert.equal(domBudgetProblem("congress", 5341), `R35 DOM 5341 elements, budget 3000 (LD31)`, "/congress/ gates at its T0 count");
  assert.equal(domBudgetProblem("stub-leaders", 9999), null);
  // re-planted control: the view parser reads the spec's own ids, and an unknown id is in no set
  assert.deepEqual(viewIds(`export const VIEWS: readonly View[] = [\n  { id: "a", path: "/" },\n  { id: "b", path: "/b/" },\n];`), ["a", "b"]);
  assert.ok(![DOM_GATED, DOM_D6_MEASURED, DOM_MEASURED_ONLY].some((s) => s.has("a")));
});
