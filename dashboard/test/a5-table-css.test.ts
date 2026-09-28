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

/* L8 (completed in DESIGN-POLISH M2, T2.5/T2.10; record L8 in
   docs/frontend/design-principles.md §7). The property A-5 protected — the
   reader never loses a long table's column names inside a trapped scroll — is
   now held by construction: no table sits in a fixed-height scroll box and no
   table head sticks inside one; the page scrolls, never the table. M1 removed
   eight of the eleven boxes and staged the last three (member flows, the
   filing histories, the filer's reported positions) with the sticky `.etable`
   head they used; M2 removed those three and the head, so the M1 allowlist is
   EMPTIED here. The sticky IDENTITY column for sideways scroll is a different
   property (a column that sticks left, never a head that sticks top) and is
   kept — the detector below tells the two apart, with a control each way. */

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

/** Table-scroll boxes: every bounded scroll box except the search panel's
    suggestion list and the mobile nav menu, which hold no table. */
function tableBoxes(source: string): string[] {
  return [...new Set(boxSelectors(source).filter((s) => !/search|suggest|\.nav-|menu/.test(s)))].sort();
}

/** In-table sticky HEADS: a sticky rule on a table part (table, .etable,
    thead, tr, th) that sticks VERTICALLY (a top/bottom/inset-block offset).
    A sticky identity column sticks left only, and is not a head. */
function inTableStickyHeads(source: string): string[] {
  const text = source.replace(/\/\*[\s\S]*?\*\//g, "");
  const out: string[] = [];
  for (const m of text.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const decls = m[2]!;
    if (!/position\s*:\s*sticky/.test(decls)) continue;
    if (!/(?:^|;)\s*(?:top|bottom|inset-block(?:-start|-end)?|inset)\s*:/.test(decls)) continue;
    const sels = m[1]!.split(",").map((s) => s.trim()).filter(Boolean);
    for (const sel of sels) if (/(?:\bthead\b|\bth\b|\btr\b|\btable\b|\.etable\b)/.test(sel)) out.push(sel);
  }
  return out;
}

test("A-5 / L8: no table sits in a max-height scroll box and no table head sticks — the page scrolls, never the table", () => {
  assert.deepEqual(tableBoxes(css), [], "no max-height table container anywhere (M2 emptied the M1 allowlist)");
  assert.deepEqual(inTableStickyHeads(css), [], "no in-table sticky head anywhere");

  // controls: each of the removed M2 boxes, planted back, is found…
  assert.deepEqual(tableBoxes(css + "\n.design-history{max-height:210px;overflow:auto}"), [".design-history"]);
  assert.deepEqual(
    tableBoxes(css + '\n[data-holdings-surface="filer"] .table-scroll { max-height: 70vh; overflow-y: auto; }'),
    ['[data-holdings-surface="filer"] .table-scroll'],
  );
  assert.deepEqual(tableBoxes(".table-scroll{max-height:200px;overflow-y:scroll}"), [".table-scroll"], "the generic container too");
  // …and so is the sticky head the three boxes used, in either the old form or a bare one
  assert.deepEqual(
    inTableStickyHeads(":is(.design-flow-band > .panel > .table-scroll, .design-history) .etable thead { position: sticky; top: 0; z-index: 3; }"),
    [":is(.design-flow-band > .panel > .table-scroll", ".design-history) .etable thead"],
  );
  assert.equal(inTableStickyHeads(".etable thead th{position:sticky;top:0}").length, 1);
  // the kept sticky IDENTITY column is not a head: the detector does not flag it
  assert.match(css, /\.etable\[data-sticky-issuer\] > \* > tr > \.c-pos \{ position: sticky; left: 0;/, "the identity column is kept");
  assert.deepEqual(inTableStickyHeads(".etable[data-sticky-issuer] > * > tr > .c-pos { position: sticky; left: 0; z-index: 2; }"), []);
});

test("A-5: filter chips wrap on mobile instead of clipping", () => {
  assert.match(css, /\.filter-controls \{ flex-wrap: wrap;/);
  /* DESIGN-POLISH M1 (review C-3/C-6): `.chips` is the ledger's segmented
     group, and the group wraps at EVERY width — a stronger pin than the
     fold-only `.chips { flex-wrap: wrap }` it replaced, which the group rule
     out-ranked anyway. The group's own rule carries the wrap. */
  const group = /:is\(\.seg, \.chips, \.mgr-chips\):where\(:not\([^)]*\)\) \{([^}]*)\}/.exec(css);
  assert.ok(group, "the segmented group rule exists");
  assert.match(group![1]!, /flex-wrap: wrap;/);
  assert.doesNotMatch(group![1]!, /flex-wrap: nowrap/);
});
