/* R10 #12, enforced across EVERY built consumer rather than per renderer.

   Cycle 2 round 3 found the hoist wired into one table renderer while five
   others repeated the same flag on every row: 1,004 pages carried a table whose
   every row read "security not in mapping" with no caveat above it. Unit tests
   could not see that — they exercise the helpers, not the set of callers.

   Cycle 3 round 1 then found this GATE was the reason a sixth renderer
   (institutional activity) stayed hidden: it skipped the whole PAGE as soon as
   any table on it carried a caveat, so one correctly wired table masked its
   unwired sibling. Scope is per TABLE now — a caveat must precede the table it
   describes, and a pager must belong to that table's own container. */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, globSync } from "node:fs";
import path from "node:path";

const DIST = path.resolve(import.meta.dirname, "../../dist");

/** Tables in `html` that repeat one flag on EVERY row without a caveat of their
    own. Exported shape so the detector can be proven against synthetic markup —
    a whole-dist sweep that happens to find nothing is indistinguishable from one
    that cannot look, and this engagement has shipped that mistake twice. */
export function offendingTables(html: string): { rows: number; common: string[] }[] {
  const out: { rows: number; common: string[] }[] = [];
  let prevEnd = 0;
  for (const t of html.matchAll(/<table[^>]*>[\s\S]*?<\/table>/g)) {
    const table = t[0]!;
    /* A caveat or a pager ANYWHERE ELSE on the page says nothing about THIS
       table — the page-wide exemption is what let a sixth renderer hide behind
       a correctly wired sibling (cycle 3, F3). */
    const region = html.slice(prevEnd, t.index!);
    prevEnd = t.index! + table.length;

    const rows = [...table.matchAll(/<tr>[\s\S]*?<\/tr>/g)].map((r) => r[0]);
    if (rows.length < 2) continue;
    const perRow = rows.map(
      (r) => new Set([...r.matchAll(/<span class="flag [a-z ]*?">([^<]*)<\/span>/g)].map((x) => x[1]!)),
    );
    if (perRow.some((s) => s.size === 0)) continue; // some row carries no flag → not universal
    const common = perRow.reduce((a, b) => new Set([...a].filter((x) => b.has(x))));
    if (common.size === 0) continue;
    if (/table-caveat/.test(region)) continue;
    const trailing = html.slice(prevEnd, prevEnd + 1200);
    if (/data-entity-older|data-changes-older|older →/.test(trailing)) continue;
    out.push({ rows: rows.length, common: [...common] });
  }
  return out;
}

const UNIFORM_TABLE =
  `<table><tr><td><span class="flag solid">no ticker</span></td></tr>` +
  `<tr><td><span class="flag solid">no ticker</span></td></tr></table>`;

test("the detector FIRES on a table that repeats one flag on every row", () => {
  /* Proof the sweep below can fail. Once the hoist works no real table is
     uniform, so "found nothing" stops being evidence — the detector has to be
     shown catching a known violation. */
  assert.deepEqual(offendingTables(UNIFORM_TABLE), [{ rows: 2, common: ["no ticker"] }]);

  assert.deepEqual(
    offendingTables(`<div class="table-caveat">stated once</div>${UNIFORM_TABLE}`),
    [],
    "a caveat immediately before the table clears it",
  );
  assert.deepEqual(
    offendingTables(`${UNIFORM_TABLE}<button data-entity-older>older →</button>`),
    [],
    "a pager on that table's own container exempts it",
  );
  assert.deepEqual(
    offendingTables(
      `<div class="table-caveat">for the FIRST table</div>${UNIFORM_TABLE}${UNIFORM_TABLE}`,
    ).length,
    1,
    "a caveat on one table does NOT clear its unwired sibling — cycle 3 F3",
  );
});

test("R10: no built table repeats one flag on EVERY row without its own caveat", () => {
  const pages = globSync("**/*.html", { cwd: DIST });
  assert.ok(pages.length > 1000, `dist looks unbuilt: ${pages.length} pages`);

  const offenders: string[] = [];
  let multiRowTables = 0; // parser liveness, NOT a count of violations
  let uniformTables = 0;

  for (const rel of pages) {
    const html = readFileSync(path.join(DIST, rel), "utf-8");
    multiRowTables += [...html.matchAll(/<table[^>]*>[\s\S]*?<\/table>/g)].filter(
      (t) => [...t[0]!.matchAll(/<tr>/g)].length >= 2,
    ).length;
    for (const bad of offendingTables(html)) {
      uniformTables++;
      offenders.push(`${rel}: every one of ${bad.rows} rows repeats ${bad.common.join(", ")}`);
    }
  }

  assert.ok(
    multiRowTables > 100,
    `the sweep parsed only ${multiRowTables} multi-row tables — it is not looking`,
  );
  assert.deepEqual(
    offenders.slice(0, 10),
    [],
    `${offenders.length} of ${uniformTables} uniform-flag table(s) repeat it with no caveat ` +
      `of their own — R10 #12 is unwired for that renderer`,
  );
});
