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

const ROUTE = "/institutional/tickers/AAPL/holders/";

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

test("sort buttons meet the 44px touch target in a real layout", async ({ page }) => {
  await page.goto(ROUTE);
  const box = await page.locator('th[data-sort="value"] button').boundingBox();
  expect(box).not.toBeNull();
  expect(box!.width).toBeGreaterThanOrEqual(44);
  expect(box!.height).toBeGreaterThanOrEqual(44);
});
