/* R35 — layout defects verified by REAL browser geometry, at five widths.

   Every other test in this repo can only see markup or CSS text. A rule that
   exists is not the claim being made here; the claim is that two boxes do not
   occupy the same pixels. R4, R5, R7 and R9 are all defined against rendered
   geometry precisely because their defects were invisible to markup tests —
   the masthead collided for months while every DOM assertion passed.

   These must FAIL on a reintroduced overlap. `layout-negative.spec.ts` proves
   that by injecting one. */

import { test, expect, type Page, type Locator } from "@playwright/test";
import { WIDTHS } from "../../playwright.config.ts";

interface Box { x: number; y: number; width: number; height: number }

const overlap = (a: Box, b: Box): number => {
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
};

/** Visible boxes only — a `display:none` burger has no geometry to protect. */
async function boxesOf(page: Page, selectors: string[]): Promise<{ sel: string; box: Box }[]> {
  const out: { sel: string; box: Box }[] = [];
  for (const sel of selectors) {
    const el: Locator = page.locator(sel).first();
    if ((await el.count()) === 0) continue;
    if (!(await el.isVisible())) continue;
    const box = await el.boundingBox();
    if (box && box.width > 0 && box.height > 0) out.push({ sel, box });
  }
  return out;
}

for (const width of WIDTHS) {
  test.describe(`@${width}px`, () => {
    test.beforeEach(async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
    });

    test("R4: no two masthead elements occupy the same pixels", async ({ page }) => {
      await page.goto("/");
      const parts = await boxesOf(page, [
        ".brand",
        ".site-nav",
        ".site-search",
        ".theme-toggle",
        ".nav-burger",
        ".search-toggle",
      ]);
      expect(parts.length, "the masthead rendered something to measure").toBeGreaterThan(1);
      for (let i = 0; i < parts.length; i++) {
        for (let j = i + 1; j < parts.length; j++) {
          const a = parts[i]!, b = parts[j]!;
          expect(
            overlap(a.box, b.box),
            `${a.sel} and ${b.sel} intersect at ${width}px — the masthead is painting over itself`,
          ).toBe(0);
        }
      }
    });

    test("R4: exactly one build watermark, and it is in the footer", async ({ page }) => {
      await page.goto("/");
      const body = (await page.locator("body").innerText()).replace(/\s+/g, " ");
      const ids = body.match(/build \d{8}\.\d+/g) ?? [];
      expect(ids.length, `build id renders ${ids.length} times, expected 1`).toBe(1);
      const inFooter = await page.locator("footer").innerText();
      expect(inFooter).toContain(ids[0]!);
    });

    test("nothing overflows the page horizontally", async ({ page }) => {
      await page.goto("/congress/");
      /* Name the culprit. "The page is 200px too wide" sends the reader
         hunting; "this element's right edge is at 1164" does not. */
      const diag = await page.evaluate(() => {
        const limit = window.innerWidth;
        let worst: { sel: string; right: number } | null = null;
        for (const el of Array.from(document.querySelectorAll<HTMLElement>("body *"))) {
          const r = el.getBoundingClientRect();
          if (r.width === 0 || r.height === 0) continue;
          const cs = getComputedStyle(el);
          if (cs.position === "fixed") continue;
          const right = r.right + window.scrollX;
          if (right > limit + 1 && (!worst || right > worst.right)) {
            const id = el.id ? `#${el.id}` : "";
            const cls = el.className && typeof el.className === "string"
              ? "." + el.className.trim().split(/\s+/).slice(0, 3).join(".")
              : "";
            worst = { sel: `${el.tagName.toLowerCase()}${id}${cls}`, right: Math.round(right) };
          }
        }
        return { over: document.documentElement.scrollWidth - limit, limit, worst };
      });
      expect(
        diag.over,
        `the page scrolls sideways by ${diag.over}px at ${width}px — widest offender: ` +
          `${diag.worst?.sel ?? "unknown"} reaching x=${diag.worst?.right} against a ${diag.limit}px viewport`,
      ).toBeLessThanOrEqual(1);
    });

    test("R5: no feed cell paints over its neighbour", async ({ page }) => {
      await page.goto("/congress/");
      const rows = page.locator(".feed-row");
      const n = Math.min(await rows.count(), 12);
      expect(n, "the feed rendered rows to measure").toBeGreaterThan(0);
      for (let r = 0; r < n; r++) {
        const cells = rows.nth(r).locator(".cell");
        const boxes: { i: number; box: Box }[] = [];
        for (let c = 0; c < (await cells.count()); c++) {
          const el = cells.nth(c);
          if (!(await el.isVisible())) continue;
          /* Out-of-flow cells are EXCLUDED, and this is not a loophole. The
             mobile fold lifts `.cell-star` out of the grid and parks it in the
             row's top-right corner, clearing the text with `padding-right` on
             `.row-line1`. Its box legitimately overlaps its neighbours' boxes
             while no glyph ever does. Comparing it would report a collision
             that does not exist, and a check that cries wolf gets muted. */
          const flow = await el.evaluate((n) => getComputedStyle(n).position);
          if (flow === "absolute" || flow === "fixed") continue;
          const box = await el.boundingBox();
          if (box && box.width > 0) boxes.push({ i: c, box });
        }
        for (let i = 0; i < boxes.length; i++) {
          for (let j = i + 1; j < boxes.length; j++) {
            expect(
              overlap(boxes[i]!.box, boxes[j]!.box),
              `row ${r}: cells ${boxes[i]!.i} and ${boxes[j]!.i} intersect at ${width}px`,
            ).toBe(0);
          }
        }
      }
    });

    test("R9: the stat strip leaves no unoccupied trailing area", async ({ page }) => {
      /* `/congress/`, NOT `/` — there is no `.tiles` on the home page, so this
         test skipped on every run while appearing to cover R9. A skipped test
         proves nothing, and this one hid the strip's real defect for two whole
         fix attempts. */
      await page.goto("/congress/");
      const strip = page.locator(".tiles").first();
      if ((await strip.count()) === 0 || !(await strip.isVisible())) test.skip();
      const stripBox = (await strip.boundingBox())!;
      const tiles = strip.locator(".tile");
      const count = await tiles.count();
      expect(count, "a rendered strip must hold tiles").toBeGreaterThan(0);
      /* Trailing space is only meaningful on a SINGLE row. Once the strip
         wraps (R9), space after the last tile is the normal ragged end of a
         wrapped line, not the strip reserving room for data it does not have —
         asserting on it would fail a correct layout. */
      const boxes = [];
      for (let i = 0; i < count; i++) boxes.push((await tiles.nth(i).boundingBox())!);
      const rows = new Set(boxes.map((b) => Math.round(b.y)));
      if (rows.size > 1) test.skip();
      const last = boxes[count - 1]!;
      const trailing = stripBox.x + stripBox.width - (last.x + last.width);
      /* The strip is a bordered flex box; leftover space inside it reads as an
         empty tile the data does not support. A couple of px is the border. */
      expect(
        trailing,
        `${Math.round(trailing)}px of empty strip trails the last tile at ${width}px — ` +
          `the strip is claiming room for data it does not have`,
      ).toBeLessThanOrEqual(4);
    });
  });
}

test("R6: a scrollable table announces itself and pins its identity column", async ({ page }) => {
  await page.setViewportSize({ width: 964, height: 900 });
  await page.goto("/institutional/filers/1067983/");
  const scroller = page.locator(".table-scroll").first();
  if ((await scroller.count()) === 0) test.skip();
  const state = await scroller.evaluate((el) => ({
    scrollable: el.scrollWidth > el.clientWidth,
    background: getComputedStyle(el).backgroundImage,
  }));
  if (!state.scrollable) test.skip();
  expect(
    state.background,
    "a table that scrolls sideways with no cue hides its columns as surely as deleting them",
  ).toContain("gradient");
  const firstCell = page.locator(".etable[data-sticky-first] td:first-child").first();
  if ((await firstCell.count()) > 0) {
    expect(await firstCell.evaluate((el) => getComputedStyle(el).position)).toBe("sticky");
  }
});
