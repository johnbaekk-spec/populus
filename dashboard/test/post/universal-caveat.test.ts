/* R10 #12, enforced across EVERY built consumer rather than per renderer.

   Cycle 2 round 3 found the hoist wired into exactly one table renderer while
   four others repeated the same flag on every row: 1,004 pages carried a table
   whose every row read "security not in mapping" with no caveat above it. Unit
   tests could not see that — they exercise the helpers, not the set of callers.

   This asserts the PROPERTY over the whole dist: no table may repeat one flag on
   every one of its rows without stating it once. A new flag-bearing table that
   forgets to wire the hoist fails here, by name. */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { globSync } from "node:fs";
import path from "node:path";

const DIST = path.resolve(import.meta.dirname, "../../dist");

test("R10: no built table repeats one flag on EVERY row without a table-level caveat", () => {
  const pages = globSync("**/*.html", { cwd: DIST });
  assert.ok(pages.length > 1000, `dist looks unbuilt: ${pages.length} pages`);

  const offenders: string[] = [];
  for (const rel of pages) {
    const html = readFileSync(path.join(DIST, rel), "utf-8");
    if (html.includes("table-caveat")) continue; // this page states its caveat
    const paged = /data-entity-older|data-changes-older|older →/.test(html);
    for (const m of html.matchAll(/<tbody[^>]*>([\s\S]*?)<\/tbody>/g)) {
      const rows = [...m[1]!.matchAll(/<tr>[\s\S]*?<\/tr>/g)].map((r) => r[0]);
      if (rows.length < 2) continue;
      /* PAGED tables are exempt, and the reason is the hoist's own contract: the
         note is computed over every row the table can page through, not the
         page on screen, because the client re-renders rows and a per-page set
         would let page 2 contradict page 1's note. A paged table whose FIRST
         page happens to be uniform therefore proves nothing — the rest of its
         rows are not in this HTML to check. Measured: 8 member pages are
         exactly that case, and hoisting them would print a note that is false
         on page 2. Unpaged tables have no such excuse and are held to it. */
      if (paged) continue;
      const perRow = rows.map(
        (r) => new Set([...r.matchAll(/<span class="flag [a-z ]*?">([^<]*)<\/span>/g)].map((x) => x[1]!)),
      );
      if (perRow.some((s) => s.size === 0)) continue; // some row has no flag → not universal
      const common = perRow.reduce((a, b) => new Set([...a].filter((x) => b.has(x))));
      if (common.size > 0) {
        offenders.push(`${rel}: every one of ${rows.length} rows repeats ${[...common].join(", ")}`);
        break;
      }
    }
  }
  assert.deepEqual(
    offenders.slice(0, 10),
    [],
    `${offenders.length} table(s) repeat a universal flag with no caveat — R10 #12 is unwired for that renderer`,
  );
});
