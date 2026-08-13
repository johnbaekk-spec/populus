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

const css = readFileSync(
  path.join(process.cwd(), "src", "styles", "global.css"),
  "utf-8",
);

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

test("A-5: sticky column headers inside scrolling table containers", () => {
  const rule = /\.etable thead th \{[^}]*position:\s*sticky/ms;
  assert.match(css, rule, "the sticky-header rule was removed");
  assert.match(css, /\.table-scroll \{[^}]*overflow-y:\s*auto/ms);
});

test("A-5: filter chips wrap on mobile instead of clipping", () => {
  assert.match(css, /\.filter-controls \{ flex-wrap: wrap;/);
  assert.match(css, /\.chips \{ flex-wrap: wrap;/);
});
