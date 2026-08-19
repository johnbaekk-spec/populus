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

import { overlap, stripRowTrailing, PACKED_TRAILING_PX, type Box } from "./geometry.ts";

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
      /* F9 (codex round 1). R5's matrix row names a 40-CHARACTER identity, and
         sampling whatever twelve rows today's corpus happens to put first does
         not exercise it — the worst case is only present by luck. Plant it. */
      const planted = await rows.first().evaluate((row) => {
        const cell = row.querySelector(".cell-ticker");
        if (!cell) return false;
        cell.innerHTML =
          '<span class="asset-name"><span aria-hidden="true">' +
          "BLACKROCK LIQUIDITY TREASURY TRUST FD" +
          '</span></span>';
        return true;
      });
      expect(planted, "row 0 must carry a ticker cell to plant the worst case in").toBe(true);
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

    test("R9: the stat strip fits, packs its rows, and shows only tiles it has data for", async ({ page }) => {
      await page.goto("/congress/");
      const strip = page.locator(".tiles").first();
      expect(await strip.count(), "the congress page renders a stat strip").toBeGreaterThan(0);
      const stripBox = (await strip.boundingBox())!;
      const tiles = strip.locator(".tile");
      const count = await tiles.count();
      expect(count, "a rendered strip must hold tiles").toBeGreaterThan(0);

      /* F4 (codex round 1). The old assertion skipped whenever the strip
         wrapped — which, after the R9 fix, is exactly the widths that used to
         overflow. It therefore ran only where nothing was ever broken. The
         invariant that holds at EVERY width: the strip stays inside its parent,
         and every row except the last is packed. Trailing space on the final
         row is a ragged line end; trailing space on an earlier row means the
         strip reserved width it did not use.

         This first ran RED at 360px (6.5px) and 720px (191px), and the CSS is
         what changed, not the number: `.tiles` paints `var(--rule2)` behind a
         1px gap grid, so an unpacked row renders that unused width as a visible
         rule-coloured slab inside the bordered strip — R9's "unoccupied trailing
         area", literally. `.tile` grows to consume it now. See
         `PACKED_TRAILING_PX` for why 6 is not a tuned threshold. */
      const parentBox = (await strip.evaluate((el) => {
        const r = el.parentElement!.getBoundingClientRect();
        return { x: r.x, width: r.width };
      }))!;
      expect(
        Math.round(stripBox.x + stripBox.width),
        `the strip overflows its parent at ${width}px`,
      ).toBeLessThanOrEqual(Math.round(parentBox.x + parentBox.width) + 1);

      const trailing = await strip.evaluate(stripRowTrailing);
      for (let r = 0; r < trailing.length - 1; r++) {
        expect(
          trailing[r]!,
          `row ${r} of the strip leaves ${Math.round(trailing[r]!)}px unused at ${width}px ` +
            `while a later row exists — the strip is reserving width it does not use`,
        ).toBeLessThanOrEqual(PACKED_TRAILING_PX);
      }

      /* F5 (codex round 1): the other half of R9's matrix row, previously
         unasserted — the strip renders exactly the tiles it HAS DATA for, so a
         tile with no value is a tile that should not have been emitted. */
      const empties = await strip.evaluate((el) =>
        [...el.querySelectorAll(".tile")].filter((t) => {
          const v = t.querySelector(".tile-value");
          return !v || v.textContent!.trim() === "";
        }).length,
      );
      expect(empties, `${empties} tile(s) render with no value at ${width}px`).toBe(0);
    });

    test("R6: a scrollable table announces itself and pins its identity column", async ({ page }) => {
      /* F6 (codex round 1): this was pinned at 964px and so tested one width of
         the five it is specified against. It lives in the width loop now. */
      await page.goto("/institutional/filers/1067983/");
      const scroller = page.locator(".table-scroll").first();
      /* No early `return`s here, deliberately. Three of them used to guard this
         test — missing scroller, not-scrollable, missing sticky cell — and each
         was a silent PASS that would read as coverage. Measured on the real
         page: the scroller exists at all five widths (2 of them), the cue is a
         base-rule scrolling shadow so it is present whether or not the table
         currently overflows (932/326 at 360px down to 1278/1278 at 1440px), and
         135 sticky first cells resolve to `position: sticky` at every width.
         Nothing here is conditional in reality, so nothing is conditional in
         the assertions. */
      expect(await scroller.count(), "the filer page renders a scroll container").toBeGreaterThan(0);
      const background = await scroller.evaluate((el) => getComputedStyle(el).backgroundImage);
      expect(
        background,
        `at ${width}px a table can scroll sideways with no cue — it hides its columns ` +
          `as surely as deleting them`,
      ).toContain("gradient");
      const firstCell = page.locator(".etable[data-sticky-first] td:first-child").first();
      expect(await firstCell.count(), "the changes table pins an identity column").toBeGreaterThan(0);
      expect(
        await firstCell.evaluate((el) => getComputedStyle(el).position),
        `at ${width}px the identity column scrolls away with the data it identifies`,
      ).toBe("sticky");
    });
  });
}

