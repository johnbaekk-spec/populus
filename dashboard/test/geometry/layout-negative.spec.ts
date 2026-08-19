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
  CONGRESS_TILE_LABELS,
  FORCE_TABLE_OVERFLOW,
  WORST_CASE_MEMBER,
  intrinsicWidth,
  plantMemberName,
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
  expect(
    Math.max(...clean),
    "baseline rows must ALL be packed, or this control proves nothing",
  ).toBeLessThanOrEqual(PACKED_TRAILING_PX);

  /* exactly the pre-fix rule: tiles pinned at content width, so a row stops
     where its last tile happens to end and the strip paints rule colour across
     the remainder */
  await page.addStyleTag({ content: ".tile{flex:0 0 auto}" });
  const broken = await strip.evaluate(stripRowTrailing);
  expect(
    Math.max(...broken),
    "the geometry gate did NOT notice a row reserving width it does not use — it has stopped working",
  ).toBeGreaterThan(PACKED_TRAILING_PX);
});

test("a ragged FINAL row is DETECTED too", async ({ page }) => {
  /* F2 (codex round 2). The packing assertion used to exclude the last row, so
     this is the control for the hole that exclusion left: a mutation that leaves
     every earlier row perfectly packed and ONLY the final row short. Under the
     old rule it passed while painting a rule-coloured slab across the bottom of
     the strip; it must now fail. */
  await page.setViewportSize({ width: 720, height: 900 });
  await page.goto("/congress/");
  const strip = page.locator(".tiles").first();

  const clean = await strip.evaluate(stripRowTrailing);
  expect(clean.length, "the strip must wrap, or this control proves nothing").toBeGreaterThan(1);
  expect(Math.max(...clean), "baseline must be fully packed").toBeLessThanOrEqual(PACKED_TRAILING_PX);

  await page.addStyleTag({ content: ".tiles .tile:last-child{flex:0 0 auto}" });
  const broken = await strip.evaluate(stripRowTrailing);
  expect(
    broken.slice(0, -1).length && Math.max(...broken.slice(0, -1)),
    "the mutation must leave the EARLIER rows packed, or it is not testing the final-row hole",
  ).toBeLessThanOrEqual(PACKED_TRAILING_PX);
  expect(
    broken[broken.length - 1]!,
    "the geometry gate did NOT notice a ragged FINAL row — the old rule's blind spot is back",
  ).toBeGreaterThan(PACKED_TRAILING_PX);
});

test("removing the R6 scroll cue is DETECTED", async ({ page }) => {
  /* R35's matrix row names two reintroductions: an overlap AND a removed cue.
     The overlap half was covered; this is the other half. */
  await page.setViewportSize({ width: 964, height: 900 });
  await page.goto("/institutional/filers/1067983/");
  const scroller = page.locator(".table-scroll").first();
  /* Same instrument as the suite, so the control cannot pass against an easier
     condition than the assertion it protects. */
  await page.addStyleTag({ content: FORCE_TABLE_OVERFLOW });

  const clean = await scroller.evaluate((el) => getComputedStyle(el).backgroundImage);
  expect(clean, "baseline must carry the cue, or this control proves nothing").toContain("gradient");

  /* The control asserts what the SUITE asserts — paint, not declaration.
     A control that checks a weaker property than the test it protects would
     stay green through exactly the regression the test exists to catch. */
  const box = (await scroller.boundingBox())!;
  const clip = { x: box.x + box.width - 20, y: box.y + 40, width: 20, height: 120 };
  const withCue = await page.screenshot({ clip });

  await page.addStyleTag({ content: ".table-scroll{background-image:none}" });
  const stripped = await scroller.evaluate((el) => getComputedStyle(el).backgroundImage);
  expect(
    stripped,
    "the geometry gate did NOT notice the scroll cue being removed — it has stopped working",
  ).not.toContain("gradient");
  const withoutCue = await page.screenshot({ clip });
  expect(
    withCue.equals(withoutCue),
    "removing the cue changed NO pixels — the suite's paint assertion cannot be detecting it",
  ).toBe(false);
});

test("a stat tile hidden by CSS is DETECTED as a missing tile", async ({ page }) => {
  /* F3 (codex round 2) asked for count-and-identity parity with the data. The
     hazard that answer creates is a tile that still EXISTS in the DOM while the
     reader cannot see it: `querySelectorAll` would happily count it and the
     strip would report full coverage while the fold quietly dropped a figure.
     That is §8's media-query-hidden prohibition, so it gets a control. */
  await page.setViewportSize({ width: 360, height: 900 });
  await page.goto("/congress/");
  const strip = page.locator(".tiles").first();

  const countVisible = () =>
    strip.evaluate(
      (el) =>
        [...el.querySelectorAll(".tile")].filter((t) => {
          const r = t.getBoundingClientRect();
          return r.width > 0 && r.height > 0;
        }).length,
    );

  expect(await countVisible(), "baseline must render every data-backed tile").toBe(
    CONGRESS_TILE_LABELS.length,
  );

  await page.addStyleTag({ content: ".tiles .tile:nth-child(2){display:none}" });
  expect(
    await countVisible(),
    "the geometry gate did NOT notice a stat tile hidden by CSS — a strip can now drop a " +
      "coverage figure and still report full data parity",
  ).toBe(CONGRESS_TILE_LABELS.length - 1);
});

test("reintroducing the single-line feed grid is DETECTED as a truncated member name", async ({
  page,
}) => {
  /* R7's control. The fix is a LAYOUT change — the row folds to two lines from
     1080px down — so the thing that must fail on reintroduction is the
     single-line grid it replaced, not a width constant. Measured before the
     fix: nine columns needing 1,033px in 854px of space, with the member track
     (`1fr`, whatever the 786px of fixed columns left over) collapsing to 68px. */
  await page.setViewportSize({ width: 964, height: 900 });
  await page.goto("/congress/");
  const cell = page.locator(".feed-row .cell-member").first();

  /* the SAME planting helper the suite uses, asserted to have landed — a
     control that plants differently is not protecting the assertion it claims */
  await cell.evaluate(plantMemberName, WORST_CASE_MEMBER);
  const visible = (await cell.locator("a").first().textContent())?.trim();
  expect(visible, "the fixture must reach the VISIBLE member link").toBe(WORST_CASE_MEMBER);

  const need = await cell.evaluate(intrinsicWidth);
  const baseline = await cell.evaluate((el) => el.clientWidth);
  expect(
    baseline,
    `baseline must already fit a 20-character name (needs ${need}px), or this control proves nothing`,
  ).toBeGreaterThanOrEqual(need);

  /* exactly the pre-fix layout: the two line wrappers dissolve and the row
     becomes the nine-track single-line grid again */
  await page.addStyleTag({
    content:
      ".row-line1,.row-line2{display:contents}" +
      ".feed-row{display:grid;grid-template-columns:26px 92px 1fr 66px 118px 118px 100px 210px 56px}",
  });

  const broken = await cell.evaluate((el) => el.clientWidth);
  expect(
    broken,
    `the geometry gate did NOT notice the member column collapsing back to ${broken}px ` +
      `against a ${need}px name — R7's defect could return unseen`,
  ).toBeLessThan(need);
});
