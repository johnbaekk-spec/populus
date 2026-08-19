/* R35's mandated negative control — the harness must FAIL on a reintroduced
   defect (codex round 1, F3).

   The suite next door passes. That is not evidence it can fail: this repository
   has already shipped a gate whose every comparison was `value > value`, and in
   this very branch an R9 assertion loaded a page with no `.tiles` and skipped on
   every run while reading as covered. So the detector is pointed at a DELIBERATE
   reintroduction of each defect it is supposed to catch, and is required to
   report it. If any expectation here fails, the geometry gate has stopped
   detecting the thing it exists for. */

import { test, expect } from "@playwright/test";
import {
  overlap,
  horizontalOverflow,
  stripRowTrailing,
  PACKED_TRAILING_PX,
  type Box,
} from "./geometry.ts";

test("the overlap predicate itself reports intersecting boxes", () => {
  /* Pure arithmetic, no browser: the cheapest possible proof that the helper
     the whole suite leans on does not always return 0. */
  const a: Box = { x: 0, y: 0, width: 10, height: 10 };
  expect(overlap(a, { x: 5, y: 5, width: 10, height: 10 })).toBe(25);
  expect(overlap(a, { x: 20, y: 0, width: 10, height: 10 })).toBe(0);
  expect(overlap(a, { x: 10, y: 0, width: 10, height: 10 }), "touching is not overlapping").toBe(0);
});

test("reintroducing the R9 stat-strip defect is DETECTED as document overflow", async ({ page }) => {
  await page.setViewportSize({ width: 964, height: 900 });
  await page.goto("/congress/");
  const clean = await page.evaluate(horizontalOverflow);
  expect(clean, "baseline must be clean, or this control proves nothing").toBeLessThanOrEqual(1);

  /* exactly the pre-fix CSS: the strip could not wrap, and its parent row would
     not wrap either, so the title pushed it past the viewport */
  await page.addStyleTag({
    content: ".page-head{flex-wrap:nowrap}.tiles{flex-wrap:nowrap;min-width:auto;max-width:none}",
  });
  const broken = await page.evaluate(horizontalOverflow);
  expect(
    broken,
    "the geometry gate did NOT notice the reintroduced stat-strip overflow — it has stopped working",
  ).toBeGreaterThan(1);
});

test("reintroducing a masthead collision is DETECTED as intersection", async ({ page }) => {
  await page.setViewportSize({ width: 964, height: 900 });
  await page.goto("/");
  const read = async (): Promise<{ brand: Box | null; nav: Box | null }> => ({
    brand: await page.locator(".brand").first().boundingBox(),
    nav: await page.locator(".site-nav").first().boundingBox(),
  });

  const before = await read();
  if (!before.brand || !before.nav) test.skip();
  expect(overlap(before.brand!, before.nav!), "baseline masthead must be clean").toBe(0);

  /* drag the nav back over the brand, which is what the missing intermediate
     breakpoint used to do on its own */
  await page.addStyleTag({
    content: ".site-nav{position:absolute;left:0;top:0;width:300px;height:40px}",
  });
  const after = await read();
  expect(
    overlap(after.brand!, after.nav!),
    "the geometry gate did NOT notice a masthead collision — it has stopped working",
  ).toBeGreaterThan(0);
});

test("reintroducing content-width tiles is DETECTED as unused trailing area", async ({ page }) => {
  /* The R9 packing rule went green by a CSS change (`.tile { flex: 1 1 auto }`),
     so it needs the same treatment as the overlap rule: proof that it still
     fails when the defect comes back. Without this the constant could be raised
     until anything passed and nothing would go red. */
  await page.setViewportSize({ width: 720, height: 900 });
  await page.goto("/congress/");
  const strip = page.locator(".tiles").first();

  const clean = await strip.evaluate(stripRowTrailing);
  expect(
    clean.length,
    "the strip must wrap into more than one row at 720px, or a packing control proves nothing",
  ).toBeGreaterThan(1);
  const worstClean = Math.max(...clean.slice(0, -1));
  expect(worstClean, "baseline rows must be packed, or this control proves nothing").toBeLessThanOrEqual(
    PACKED_TRAILING_PX,
  );

  /* exactly the pre-fix rule: tiles pinned at content width, so a row stops
     where its last tile happens to end and the strip paints rule colour across
     the remainder */
  await page.addStyleTag({ content: ".tile{flex:0 0 auto}" });
  const broken = await strip.evaluate(stripRowTrailing);
  expect(
    Math.max(...broken.slice(0, -1)),
    "the geometry gate did NOT notice a row reserving width it does not use — it has stopped working",
  ).toBeGreaterThan(PACKED_TRAILING_PX);
});

test("removing the R6 scroll cue is DETECTED", async ({ page }) => {
  /* R35's matrix row names two reintroductions: an overlap AND a removed cue.
     The overlap half was covered; this is the other half. */
  await page.setViewportSize({ width: 964, height: 900 });
  await page.goto("/institutional/filers/1067983/");
  const scroller = page.locator(".table-scroll").first();

  const clean = await scroller.evaluate((el) => getComputedStyle(el).backgroundImage);
  expect(clean, "baseline must carry the cue, or this control proves nothing").toContain("gradient");

  await page.addStyleTag({ content: ".table-scroll{background-image:none}" });
  const stripped = await scroller.evaluate((el) => getComputedStyle(el).backgroundImage);
  expect(
    stripped,
    "the geometry gate did NOT notice the scroll cue being removed — it has stopped working",
  ).not.toContain("gradient");
});
