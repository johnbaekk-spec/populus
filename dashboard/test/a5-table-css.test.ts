/* A-5 table mechanics, pinned against the stylesheet (the same mechanism the
   existing css-fold suite uses: these behaviors live in CSS, so the test that
   fails when the feature is removed is a structural read of the stylesheet).

   F-21: the mobile combined "traded → filed" string must be SCOPED to
   .feed-row. The unscoped rule turned it on inside entity-table dual-date
   cells too, rendering the trade date twice ("03-3003-30 → 07-21"). */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { baseStylesheet } from "./lib/styles.ts";

const css = baseStylesheet();

test("F-21: .mobile-dates is only ever displayed under a .feed-row scope", () => {
  // The base rule hides it everywhere…
  assert.match(css, /\.mobile-dates \{\s*display: none;/);
  // …and every rule that turns it on is scoped to the feed rows.
  const enabling = [...css.matchAll(/^[^{}\n]*\.mobile-dates[^{}\n]*\{[^}]*display:\s*inline/gms)].map(
    (m) => m[0],
  );
  assert.ok(enabling.length > 0, "the mobile combined-date rule must exist");
  for (const rule of enabling) {
    assert.match(
      rule,
      /\.feed-row \.mobile-dates/,
      `an unscoped .mobile-dates display rule re-introduces the F-21 double date:\n${rule}`,
    );
  }
});

/* L8 (DESIGN-POLISH M1, staged; record in design-principles §7). The property
   A-5 protected — a long table stays readable — moves from "scroll inside a
   box under a sticky header" to "rows flow on the page" (R3). M1 removes eight
   of the eleven boxes; exactly the three M2 recomposes (member flows, member
   and filer filing history, the filer's reported positions) keep their box
   until T2.5, and the sticky .etable header those three still need stays with
   them. A fourth box, or a box on any other selector, fails here. */
const M2_BOXES = [
  ".design-flow-band > .panel > .table-scroll",
  ".design-history",
  '[data-holdings-surface="filer"] .table-scroll',
];

/** Selectors that give an element a bounded scroll box (a max-height with an
    overflow that scrolls), outside print and the search panel's own list. */
function boxSelectors(source: string): string[] {
  const out: string[] = [];
  const text = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/@media print\s*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, "");
  for (const m of text.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const decls = m[2]!;
    const bounded = /max-height\s*:\s*(?!none)[^;]+/.test(decls);
    const scrolls = /overflow(?:-y)?\s*:\s*(?:auto|scroll)/.test(decls);
    if (bounded && scrolls) out.push(...m[1]!.split(",").map((s) => s.trim()).filter(Boolean));
  }
  return out;
}

test("A-5 / L8: a scroll box lives on exactly the three M2 containers; their sticky header stays", () => {
  const boxes = boxSelectors(css).filter((s) => !/search|suggest|\.nav-|menu/.test(s));
  assert.deepEqual([...new Set(boxes)].sort(), [...M2_BOXES].sort());
  /* …and those three boxes keep a sticky header. The head ROW sticks (a
     sticky cell is its own stacking context and would take the hit area of
     the control in the cell beside it, G12), and only inside the three boxes. */
  const sticky = [...css.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter((m) => /position:\s*sticky/.test(m[2]!) && /\.etable thead\b/.test(m[1]!))
    .map((m) => m[1]!.trim());
  assert.equal(sticky.length, 1, sticky.join(" | "));
  for (const box of M2_BOXES) assert.ok(sticky[0]!.includes(box), `the sticky head is scoped to ${box}`);
  assert.doesNotMatch(sticky[0]!, /thead th/, "the row sticks, not each cell");
  // controls: a fourth box, and a box put back on the generic container, each fail
  assert.notDeepEqual(
    [...new Set(boxSelectors(css + "\n.design-rankings .table-scroll { max-height:200px; overflow-y:auto; }"))].filter((s) => !/search|suggest|\.nav-|menu/.test(s)).sort(),
    [...M2_BOXES].sort(),
  );
  assert.ok(boxSelectors(".table-scroll{max-height:200px;overflow-y:auto}").includes(".table-scroll"));
});

test("A-5: filter chips wrap on mobile instead of clipping", () => {
  assert.match(css, /\.filter-controls \{ flex-wrap: wrap;/);
  /* DESIGN-POLISH M1 (review C-3/C-6): `.chips` is the ledger's segmented
     group, and the group wraps at EVERY width — a stronger pin than the
     fold-only `.chips { flex-wrap: wrap }` it replaced, which the group rule
     out-ranked anyway. The group's own rule carries the wrap. */
  const group = /:is\(\.seg, \.chips:not\([^)]*\), \.mgr-chips\) \{([^}]*)\}/.exec(css);
  assert.ok(group, "the segmented group rule exists");
  assert.match(group![1]!, /flex-wrap: wrap;/);
  assert.doesNotMatch(group![1]!, /flex-wrap: nowrap/);
});
