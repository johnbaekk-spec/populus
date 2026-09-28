/* Gated browser regression for the holders route (code review cycle 5, F1).

   What this lane may honestly claim, given the producer-backed seed: the page
   serves two ranked AAPL holders for 2026-03-31 (BERKSHIRE HATHAWAY 2000,
   OTHER CAPITAL 800) and one for 2025-12-31 (BERKSHIRE 1000). That is enough
   to pin WIRING — real node replacement, event rebinding after a period swap,
   `aria-sort` movement, the live region, touch geometry — plus exactly one
   observable REORDER: value ascending puts OTHER CAPITAL (800) above
   BERKSHIRE (2000), the reverse of the value-descending default. The full
   ordering contract (case-insensitive filer collation, null bucketing,
   tie-breaks) is NOT provable from two rows and stays with the unit tests
   over `orderRankedHolders`; do not widen the claims here without enriching
   the seed in make-inst-preview.py first. */
import { test, expect, type Page } from "@playwright/test";
import { hitMisses, probe, formatResult, type PredicateName } from "../geometry/geometry.ts";
import { g2Exemptions, isPending, type CheckId } from "../geometry/milestones.ts";

const ROUTE = "/institutional/tickers/AAPL/holders/";

/* The target hit-test is the ONE audit the ledger gate's G12 runs
   (test/geometry/geometry.ts, M1 review Q-11): the lanes serve different
   builds, but a hit square is measured one way. */

function filerCells(page: Page) {
  return page.locator("[data-holders-body] td.c-filer");
}

async function activeSortHeaders(page: Page) {
  return page.locator('th[data-sort]:not([aria-sort="none"])').count();
}

test("default render: value descending, one active aria-sort, both rows present", async ({ page }) => {
  await page.goto(ROUTE);
  await expect(page.locator('th[data-sort="value"]')).toHaveAttribute("aria-sort", "descending");
  expect(await activeSortHeaders(page)).toBe(1);
  await expect(filerCells(page)).toHaveText([/BERKSHIRE HATHAWAY/, /OTHER CAPITAL/]);
  // Every sortable header declares aria-sort; absent reads as "not sortable" (F4).
  for (const th of await page.locator("th[data-sort]").all()) {
    expect(await th.getAttribute("aria-sort")).not.toBeNull();
  }
});

test("clicking the active value header reverses the rows — a real browser reorder", async ({ page }) => {
  await page.goto(ROUTE);
  await page.locator('th[data-sort="value"] button').click();
  await expect(page.locator('th[data-sort="value"]')).toHaveAttribute("aria-sort", "ascending");
  await expect(filerCells(page)).toHaveText([/OTHER CAPITAL/, /BERKSHIRE HATHAWAY/]);
  expect(await activeSortHeaders(page)).toBe(1);
});

test("switching column moves aria-sort and updates the live region", async ({ page }) => {
  await page.goto(ROUTE);
  await page.locator('th[data-sort="filer"] button').click();
  await expect(page.locator('th[data-sort="filer"]')).toHaveAttribute("aria-sort", "ascending");
  await expect(page.locator('th[data-sort="value"]')).toHaveAttribute("aria-sort", "none");
  expect(await activeSortHeaders(page)).toBe(1);
  const status = page.locator("[data-holders-status]");
  await expect(status).toHaveAttribute("aria-live", "polite");
  await expect(status).toContainText("sorted by filer ascending");
});

test("period swap replaces the table AND the sort rebinds to the new nodes", async ({ page }) => {
  await page.goto(ROUTE);
  await page.locator('[data-period="2025-12-31"]').click();
  // The older quarter has exactly one ranked holder in the seed.
  await expect(filerCells(page)).toHaveText([/BERKSHIRE HATHAWAY/]);
  await expect(page.locator('[data-period="2025-12-31"]')).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator('[data-period="2026-03-31"]')).toHaveAttribute("aria-pressed", "false");
  // Sorting on the REPLACED table must work: the pre-fix bug bound detached nodes.
  await page.locator('th[data-sort="filer"] button').click();
  await expect(page.locator('th[data-sort="filer"]')).toHaveAttribute("aria-sort", "ascending");
  await expect(page.locator("[data-holders-status]")).toContainText("sorted by filer ascending");
});

/* L9 (DESIGN-POLISH M1; record in design-principles §7): the sort button
   reaches --hit-min (44px coarse or at/below 720px, 24px otherwise) through a
   layout-neutral ::before. Hit-tested at the four corners of the square, at a
   phone width and at 1440, where the button's own box must also stay its
   text's height (it never inflates the header row). */
test("L9: the sort button hit-tests to --hit-min in a real layout, without inflating its header", async ({ page }) => {
  for (const w of [390, 1440]) {
    await page.setViewportSize({ width: w, height: 900 });
    await page.goto(ROUTE);
    expect(await hitMisses(page, 'th[data-sort] .th-sort'), `at ${w}px`).toEqual([]);
  }
});

/* ── CODE-REVIEW F4 ──────────────────────────────────────────────────────────
   SL-R28 requires the holders page to be tested BEFORE and AFTER a period
   replacement, because `initHoldersPeriods` repaints the whole root and a note
   created by that repaint must still open. The geometry lane cannot carry this
   test: it previews `dist`, which builds no holders route under
   `/institutional/tickers/` at all — this lane's producer-backed fixture envelope is the only
   served build where the route exists. Recorded as a deviation from the plan's
   placement, not as a silent move.

   Delegation is the mechanism: `initNotes()` binds one listener set on
   `document`, so a note in a root replaced afterwards is live with no rebind.
   A per-element binder passes every unit test in the suite and dies here. */

async function openFirstNote(page: Page) {
  const btn = page.locator(".note-btn").first();
  await expect(btn, "the holders page must render at least one note").toBeVisible();
  const id = await btn.getAttribute("popovertarget");
  expect(id, "a note button must address a panel").toBeTruthy();
  await btn.click();
  const pop = page.locator(`#${id}`);
  await expect(pop).toBeVisible();
  return pop;
}

test("SL-R28/F4: a note opens BEFORE the period swap, and again from the REPLACED root", async ({ page }) => {
  await page.goto(ROUTE);

  // Before: the server-rendered root's notes work.
  const before = await openFirstNote(page);
  await expect(before).toContainText(/\S/, "an empty panel is not a channel");
  await page.keyboard.press("Escape");

  // Swap the period. `initHoldersPeriods` replaces the root's innerHTML, so
  // every note node the first assertion touched is now detached.
  await page.locator('[data-period="2025-12-31"]').click();
  await expect(page.locator('[data-period="2025-12-31"]')).toHaveAttribute("aria-pressed", "true");
  await expect(filerCells(page)).toHaveText([/BERKSHIRE HATHAWAY/]);

  // After: a note from the NEW root must open. This is the assertion that
  // fails if binding ever moves from `document` to the elements themselves.
  const after = await openFirstNote(page);
  await expect(after).toContainText(/\S/, "the replaced root's note carries its explanation too");
});

test("SL-R24/T12 / L9: the holders page's note anchors hit-test to --hit-min at every swept width", async ({ page }) => {
  /* The third in-scope surface a browser can reach in this repository. The
     geometry lane previews the bounded `dist`, which builds no holders route,
     so R24's "a representative anchor per surface" is only satisfiable for this
     one here. Same five widths the geometry harness sweeps, restated rather
     than imported: the two lanes serve different builds and must not share a
     config that implies otherwise. */
  for (const w of [360, 720, 964, 1080, 1440]) {
    await page.setViewportSize({ width: w, height: 900 });
    await page.goto(ROUTE);
    expect(await page.locator(".note-btn").count(), `the holders page must render a note anchor at ${w}px`).toBeGreaterThan(0);
    // L9: the --hit-min square, hit-tested (not the button's own box)
    expect(await hitMisses(page, ".note-btn"), `at ${w}px`).toEqual([]);
  }
});

/* M1 review Q-1. The ledger gate (`ledger.spec.ts`) previews the bounded
   `dist`, which builds no holders page, so its holders route was 56 stated
   skips and the route was never MEASURED by G1–G11. This lane serves the
   holders page, so the same probe runs here: every ledger check that applies
   (the pending G6 and the design-route G9 excepted, G3 at 1440 only), at 1440
   and 390, each required to measure something and to find nothing. */
const HOLDERS_CHECKS: { id: CheckId; fn: PredicateName; arg?: unknown; widths?: number[] }[] = [
  { id: "G1", fn: "g1" },
  { id: "G2", fn: "g2", arg: { exempt: [...g2Exemptions()] } },
  { id: "G3", fn: "g3", widths: [1440] },
  { id: "G4", fn: "g4" },
  { id: "G5", fn: "g5" },
  { id: "G7", fn: "g7" },
  { id: "G8", fn: "g8" },
  { id: "G10", fn: "g10" },
  { id: "G11", fn: "g11" },
  { id: "G11b", fn: "g11b" },
  { id: "headFont", fn: "headFont" },
  { id: "oneFlex", fn: "oneFlex" },
];

for (const width of [1440, 390]) {
  for (const c of HOLDERS_CHECKS) {
    if (isPending(c.id) || (c.widths && !c.widths.includes(width))) continue;
    test(`Q-1: ledger ${c.id} measures the holders page @${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: width > 720 ? 900 : 844 });
      await page.goto(ROUTE);
      await page.evaluate(() => document.fonts.ready);
      await expect(filerCells(page).first()).toBeVisible();
      const r = await probe(page, c.fn, c.arg);
      expect(r.measured, `${c.id} measured nothing on the holders page @${width}: a check that ran on nothing has not passed\n${formatResult(r)}`).toBeGreaterThan(0);
      expect(r.failureCount, `holders @${width}\n${formatResult(r)}`).toBe(0);
    });
  }
}
