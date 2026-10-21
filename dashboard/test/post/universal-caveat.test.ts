/* R10 #12, enforced across EVERY built consumer rather than per renderer.

   The history matters, because this gate has been wrong three times and each
   wrongness was invisible:

   1. Cycle 2 round 3 — the hoist was wired into ONE renderer while five others
      repeated a flag on every row. 1,004 pages. Unit tests could not see it:
      they exercise the helpers, not the set of callers.
   2. Cycle 3 round 1 — the gate exempted a whole PAGE once any table on it had
      a caveat, so a correctly wired table masked its unwired sibling.
   3. Cycle 3 round 2 — the gate counted the `<thead>` row as a data row. A
      header row carries no flags, so "some row has no flag → not universal"
      skipped EVERY production table. It was inert, and its own synthetic test
      passed because the fixture had no `<thead>`.

   So: data rows come from `<tbody>` only; a single-row table counts; a flag is
   either a `<span class="flag">` chip or a `<details class="flag">` disclosure;
   and a wired renderer PROVES it evaluated universality by emitting
   `data-stated-flags` on the table, which replaces the proximity guess about
   pagers entirely. "Evaluated and found nothing universal" and "never wired"
   are different claims and the markup now distinguishes them. */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, globSync } from "node:fs";
import path from "node:path";

const DIST = path.resolve(import.meta.dirname, "../../dist");

/** Flags a row shows: registry chips AND unknown-condition disclosures. */
function flagsOf(row: string): Set<string> {
  const chips = [...row.matchAll(/<span class="flag [a-z ]*?">([^<]*)<\/span>/g)].map((m) => m[1]!);
  const disclosures = [...row.matchAll(/<details class="flag[^"]*"[^>]*><summary>([^<]*)<\/summary>/g)].map(
    (m) => m[1]!,
  );
  return new Set([...chips, ...disclosures]);
}

/** Tables repeating one flag on EVERY data row without their renderer having
    evaluated universality. Exported so the detector is proven, not assumed. */
export function offendingTables(html: string): { rows: number; common: string[] }[] {
  const out: { rows: number; common: string[] }[] = [];
  let prevEnd = 0;
  for (const t of html.matchAll(/<table([^>]*)>([\s\S]*?)<\/table>/g)) {
    const [whole, attrs, inner] = [t[0]!, t[1]!, t[2]!];
    const region = html.slice(prevEnd, t.index!); // this table's own preceding markup
    prevEnd = t.index! + whole.length;

    /* DATA rows only. Counting the header row is what made this gate inert. */
    const tbody = inner.match(/<tbody[^>]*>([\s\S]*?)<\/tbody>/);
    const scope = tbody ? tbody[1]! : inner.replace(/<thead[\s\S]*?<\/thead>/g, "");
    const rows = [...scope.matchAll(/<tr[^>]*>[\s\S]*?<\/tr>/g)].map((r) => r[0]);
    if (rows.length === 0) continue;

    const perRow = rows.map(flagsOf);
    if (perRow.some((s) => s.size === 0)) continue; // a row with no flag → not universal
    const common = perRow.reduce((a, b) => new Set([...a].filter((x) => b.has(x))));
    if (common.size === 0) continue;

    /* B35: the ONLY exemption is `data-paged`, and it is narrow on purpose.
       Treating `data-stated-flags` as proof validated the marker's PRESENCE
       rather than its meaning — an empty marker on a table visibly repeating a
       badge passed, which is exactly how B34's provenance and diff-note badges
       slipped through while this gate stayed green.

       A PAGED table is the one case HTML cannot settle: its visible page may be
       uniform while the full collection it judged is not. Everything else must
       either carry a caveat or not be uniform, whatever it claims about itself. */
    if (/\bdata-paged=/.test(attrs)) continue;
    if (/table-caveat/.test(region)) continue;

    out.push({ rows: rows.length, common: [...common] });
  }
  return out;
}

/* production-shaped: a <thead> whose header row carries no flags */
const HEAD = `<thead><tr><th scope="col">Position</th><th scope="col">Flags</th></tr></thead>`;
const row = (f: string) => `<tr><td>x</td><td class="c-flags"><span class="flag solid">${f}</span></td></tr>`;
const uniform = (n: number, attrs = "") =>
  `<table class="etable"${attrs}>${HEAD}<tbody>${row("no ticker").repeat(n)}</tbody></table>`;

test("the detector FIRES on production-shaped markup, not just headerless fixtures", () => {
  /* Every assertion here is one the previous version got wrong. */
  assert.deepEqual(offendingTables(uniform(2)), [{ rows: 2, common: ["no ticker"] }], "with a <thead>");
  assert.deepEqual(offendingTables(uniform(1)), [{ rows: 1, common: ["no ticker"] }], "one-row table");

  /* B35, and this is the assertion the previous version had backwards: an
     empty marker on a table that visibly repeats a badge is a VIOLATION, not a
     pass. Claiming to have evaluated is not evidence of having evaluated
     correctly. */
  assert.deepEqual(
    offendingTables(uniform(2, ' data-stated-flags=""')),
    [{ rows: 2, common: ["no ticker"] }],
    "an empty marker does not excuse a visibly uniform table",
  );
  assert.deepEqual(
    offendingTables(uniform(2, ' data-paged="1" data-stated-flags=""')),
    [],
    "only a PAGED table is exempt — its full collection is not in this HTML",
  );
  assert.deepEqual(
    offendingTables(`<div class="table-caveat">stated once</div>${uniform(2)}`),
    [],
    "a caveat immediately before the table clears it",
  );
  assert.equal(
    offendingTables(`<div class="table-caveat">for the FIRST</div>${uniform(2)}${uniform(2)}`).length,
    1,
    "a caveat on one table does NOT clear its unwired sibling",
  );
  assert.deepEqual(
    offendingTables(`${uniform(2)}<button data-entity-older>older →</button>`),
    [{ rows: 2, common: ["no ticker"] }],
    "a trailing pager in the MARKUP no longer exempts anything — only the attribute does",
  );

  /* unknown conditions render as a disclosure, not a chip */
  const disc = `<tr><td>x</td><td class="c-flags"><details class="flag dashed flag-provenance"><summary>unrecognised source condition</summary><span class="flag-raw">t</span></details></td></tr>`;
  assert.equal(
    offendingTables(`<table>${HEAD}<tbody>${disc}${disc}</tbody></table>`).length,
    1,
    "an unknown-condition disclosure counts as a flag",
  );
});

/* signals-v3 M3 (R19, R21, LD8): the ticker page now holds two shapes this
   gate reads. The disclosures preview pins the On Signals rows above the
   newest ones in ONE table, so its hoist runs over every shown row, pinned
   ones included (pinned in `pages-render.test.ts`). The holders list spans
   TWO tables (rows 1–10, and 11..N inside "Show all N holders"); its hoist is
   computed over all N, so each part is a part of the collection it judged —
   `data-paged`, the one exemption, and exactly its meaning. Driven through
   the real renderer here, with the control that an unmarked part is caught. */
test("signals-v3 M3 → launch M7b: the split holders tables — a flag on every holder is stated once; one only the first 25 carry stays on their rows, in a part marked data-paged", async () => {
  /* launch M7b (R33): the list opens at 25 and holds 26..N; the parts in the
     HTML are the visible table, the empty held table the binder fills, and
     the no-JS second table inside <noscript> — every one marked data-paged. */
  const { tickerInstSectionHtml } = await import("../../src/lib/ui/index.ts");
  const holders = (flagged: (i: number) => boolean) =>
    Array.from({ length: 40 }, (_, i) => ({ rank: i + 1, cik: String(i + 1).padStart(10, "0"), name: `H${i + 1}`, value: 1000 - i, securities: 1, keySource: "entity", flags: flagged(i + 1) ? ["security_not_in_mapping"] : [] }));
  const render = (flagged: (i: number) => boolean) =>
    tickerInstSectionHtml({ state: "data", name: "X", cik: "0000000001", period: "2026-03-31", latestFiled: null, topn: 25, holders: holders(flagged) } as never, "XYZ");
  assert.deepEqual(offendingTables(render(() => true)), [], "every holder: stated once, above the first part");
  const topOnly = render((i) => i <= 25);
  assert.deepEqual(offendingTables(topOnly), [], "the first 25 only: each part is a marked part of the judged collection");
  assert.equal((topOnly.match(/data-paged="1"/g) ?? []).length, 3, "every part is marked (visible, held, no-JS copy)");
  // control: the same parts, unmarked, are caught — the gate still reads them
  assert.equal(offendingTables(topOnly.replace(/ data-paged="1"/g, "")).length, 1, "control: an unmarked uniform part fails");
});

test("R10: no built table repeats one flag on EVERY row without its renderer evaluating it", () => {
  const pages = globSync("**/*.html", { cwd: DIST });
  assert.ok(pages.length > 1000, `dist looks unbuilt: ${pages.length} pages`);

  const offenders: string[] = [];
  let dataTables = 0;
  for (const rel of pages) {
    const html = readFileSync(path.join(DIST, rel), "utf-8");
    dataTables += [...html.matchAll(/<tbody[^>]*>/g)].length;
    for (const bad of offendingTables(html)) {
      offenders.push(`${rel}: every one of ${bad.rows} rows repeats ${bad.common.join(", ")}`);
    }
  }
  /* Liveness proves the sweep can PARSE. An earlier version asserted that some
     UNIFORM table exists — but once the hoist works none does, so "found none"
     stopped being distinguishable from "the regex is broken". */
  assert.ok(dataTables > 100, `the sweep parsed only ${dataTables} tbody elements — it is not looking`);
  assert.deepEqual(offenders.slice(0, 10), [], `${offenders.length} table(s) violate R10 #12`);
});
