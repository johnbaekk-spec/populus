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

  /* Exactly the pre-fix layout: the row becomes the nine-track single-line
     grid again. The `.row-line1/.row-line2` wrappers this used to dissolve no
     longer exist — R5/R18 made the feed a real table, whose rows cannot hold
     them — so the plant is now just the single-line grid itself, which is the
     defect the control was always actually about. */
  await page.addStyleTag({
    content:
      ".feed-row{display:grid;grid-template-areas:none;" +
      "grid-template-columns:26px 92px 1fr 66px 118px 118px 100px 210px 56px}" +
      ".feed-row > *{grid-area:auto}",
  });

  const broken = await cell.evaluate((el) => el.clientWidth);
  expect(
    broken,
    `the geometry gate did NOT notice the member column collapsing back to ${broken}px ` +
      `against a ${need}px name — R7's defect could return unseen`,
  ).toBeLessThan(need);
});

test("B33: the unknown-flag token is one interaction away, and it PRINTS", async ({ page }) => {
  /* The unknown path fires on ZERO pages today — every flag the corpus ships is
     registered — so the disclosure is exercised against planted markup. That is
     the honest way to test a fallback: waiting for a real unknown flag means the
     first time this runs is the first time it is needed.

     Heights, not `checkVisibility`: a closed `<details>` hides its content via
     `::details-content`'s `content-visibility`, and a child inside that subtree
     still reports a stale `getBoundingClientRect`. Measuring the DETAILS box is
     the reliable signal — verified while building this, after the child-box
     reading claimed a working disclosure was broken. */
  await page.setViewportSize({ width: 1080, height: 900 });
  await page.goto("/congress/");
  await page.evaluate(() => {
    const host = document.querySelector(".cell-range");
    host!.insertAdjacentHTML(
      "beforeend",
      '<details class="flag dashed flag-provenance" id="b33">' +
        "<summary>unrecognised source condition</summary>" +
        '<span class="flag-raw">reported by the source as a_flag_from_the_future</span>' +
        "</details>",
    );
  });
  const box = () => page.locator("#b33").evaluate((el) => Math.round(el.getBoundingClientRect().height));
  const warningShown = () =>
    page.locator("#b33 > summary").evaluate((el) => Math.round(el.getBoundingClientRect().height) > 0);

  const closed = await box();
  expect(await warningShown(), "the warning shows with the disclosure closed").toBe(true);

  await page.click("#b33 > summary");
  const opened = await box();
  expect(
    opened,
    "clicking the warning must reveal the raw token — B33's whole point",
  ).toBeGreaterThan(closed);

  await page.click("#b33 > summary");
  expect(await box(), "and it closes again").toBe(closed);

  await page.emulateMedia({ media: "print" });
  expect(
    await box(),
    "on paper the token must be present WITHOUT the reader having opened it — " +
      "a disclosure nobody clicked is no provenance at all in print",
  ).toBeGreaterThan(closed);
  await page.emulateMedia({ media: "screen" });
});
