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
/* DESIGN-POLISH T1.10: the ledger probe (G1–G12), its synthetic self-tests
   and its route negative controls, appended below the original controls. */
import {
  installProbe,
  probe,
  formatResult,
  skipDecision,
  themeBackgroundProblem,
  type LedgerResult,
  type LedgerFinding,
} from "./geometry.ts";
import { g2Exemptions } from "./milestones.ts";
import { baseStylesheet } from "../lib/styles.ts";
import type { Page } from "@playwright/test";

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
  const scroller = page.locator("[data-holdings-surface] .table-scroll").first();
  /* Same instrument as the suite, so the control cannot pass against an easier
     condition than the assertion it protects. */
  await page.addStyleTag({ content: FORCE_TABLE_OVERFLOW });
      await scroller.scrollIntoViewIfNeeded();

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
      ".reference-feed .reference-row{display:grid;grid-template-areas:none;" +
      "grid-template-columns:26px 92px 1fr 66px 118px 118px 100px 210px 56px}" +
      ".reference-feed .reference-row > .cell{grid-area:auto}",
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

/* =============================================================================
   DESIGN-POLISH T1.10 — SELF-TESTS of the ledger probe on synthetic markup.

   Each predicate is proved on a page that owes nothing to any build: the
   whole-tree stylesheet (`baseStylesheet()`, the real cascade) plus a fixture
   stylesheet scoped to `#fx` that PINS every property the predicate reads —
   so the self-test measures the detector, not the state of a stylesheet
   another agent is editing. Every predicate must both PASS a correct fixture
   and FAIL the defect it guards (criterion 13): a detector that only ever
   passes, or only ever fails, is not a measurement.
   ========================================================================== */

const SITE_CSS = baseStylesheet();

/** The fixture ledger, pinned. ID specificity beats every class rule in the
    site stylesheets; pseudo-elements are cleared so none of the site's
    carets or hit squares leak into a fixture that did not ask for them. */
const FIXTURE_CSS = `
:root{--fs-label:9.5px;--fs-meta:10px;--fs-control:10.5px;--fs-note:11px;--fs-cell:11.5px;--fs-small:12px;
--fs-name:12.5px;--fs-body:13px;--fs-title:13.5px;--fs-brand:14px;--fs-lede:15px;--fs-heading:20px;--fs-display:26px;
--fs-hero:40px;--hit-min:24px;--gutter:32px;--kind-buy-edge:#2774AE;--kind-sell-edge:#F07A66}
@media (max-width:720px){:root{--fs-display:22px;--fs-hero:28px;--gutter:16px}}
@media (any-pointer:coarse),(max-width:720px){:root{--hit-min:44px}}
html,body{margin:0;padding:0;background:#04070d;color:#e9f0f7;font:500 13px/1.4 monospace}
#fx{display:block;padding:24px 32px;margin:0;max-width:none;width:auto}
#fx *,#fx *::before,#fx *::after{box-sizing:border-box}
#fx *::before,#fx *::after{content:none;inset:auto;width:auto;height:auto;margin:0;transform:none;clip-path:none}
#fx p{margin:0;font-size:13px}
#fx .panel{display:block;padding:0 32px;margin:0 0 24px;border:0;background:none;max-width:none}
#fx .table-scroll{display:block;margin:0 -32px;overflow-x:auto;overflow-y:visible;max-height:none;background:none;height:auto;
--gutter-l:var(--gutter);--gutter-r:var(--gutter)}
#fx table{width:100%;border-collapse:collapse;table-layout:auto;margin:0;background:none}
#fx th,#fx td{padding:7.5px 6px;font:500 11.5px/1.2 monospace;white-space:nowrap;text-align:left;vertical-align:middle;
border:0;border-bottom:1px solid #0e1520;height:auto;min-width:0;max-width:none;letter-spacing:0;text-transform:none;
color:#e9f0f7;background:none;box-shadow:none;position:static;width:auto;overflow:visible}
#fx th{font:600 9.5px/1 "JetBrains Mono",monospace;letter-spacing:.12em;text-transform:uppercase;padding:8px 6px 6px;
color:#8494a8;vertical-align:bottom}
#fx tr > :first-child{padding-left:32px}
#fx tr > :last-child{padding-right:32px}
#fx .c-num{text-align:right}
#fx :is(th,td).c-num:not(:first-child){padding-left:16px}
#fx .etable-compact :is(th,td).c-num:not(:first-child){padding-left:10px}
#fx th.c-flex{width:100%}
#fx td.c-flex{max-width:0;overflow:hidden;text-overflow:ellipsis}
#fx :is(th,td).has-marks{padding-right:20px;position:relative}
#fx .hang{position:absolute;right:6px;top:50%;transform:translateY(-50%);display:inline;width:auto;text-indent:0;overflow:visible}
#fx th .hang{top:auto;bottom:6px;transform:none}
#fx button{all:unset;box-sizing:border-box;display:inline-block;position:relative;font:inherit;color:inherit;cursor:pointer}
#fx .th-sort{font:inherit;letter-spacing:inherit;text-transform:inherit;position:static}
#fx .sort-caret{position:absolute;right:6px;bottom:6px;font:600 9.5px/1 monospace;display:inline;width:auto;text-indent:0}
#fx th[aria-sort="descending"] .sort-caret::after{content:"▾"}
#fx .note-pop{display:none}
#fx .visually-hidden{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
#fx tr[data-edge="buy"] > :first-child{box-shadow:inset 3px 0 0 var(--kind-buy-edge)}
#fx tr[data-edge="sell"] > :first-child{box-shadow:inset 3px 0 0 var(--kind-sell-edge)}
#fx .panel-head{display:flex;align-items:baseline;gap:10px;padding:0 0 4px;margin:0;border:0}
#fx .section-h{font:600 13px/1 sans-serif;margin:0;padding:0;letter-spacing:0;text-transform:none}
#fx .panel-note{font:500 10px/1.4 monospace;margin:0;padding:0;color:#7b8b9f;white-space:normal;overflow:visible;text-overflow:clip}
#fx .seg{display:inline-flex;border:1px solid #1b2735;margin-left:auto}
#fx .seg > button{height:25px;padding:0 12px;font:500 10.5px/25px monospace;color:#8fa0b3;background:#04070d}
#fx .seg > button[aria-pressed="true"]{background:#0f1b2a;color:#eaf4fc;box-shadow:inset 0 -2px 0 #69b4ec}
#fx .book-track{display:inline-block;width:150px;height:6px;background:#10161f;vertical-align:middle}
#fx .book-track > span{display:block;height:6px;width:60%;background:#9e4e41}
#fx a{color:#a9d2f2}
#fx a:focus-visible,#fx button:focus-visible{outline:1px solid #a9d2f2;outline-offset:2px}
`;

async function fixture(page: Page, body: string, css = "", width = 1440): Promise<void> {
  await page.setViewportSize({ width, height: width > 720 ? 900 : 844 });
  await page.setContent(
    `<!doctype html><html><head><meta charset="utf-8"><style>${SITE_CSS}</style>` +
      `<style>${FIXTURE_CSS}</style><style>${css}</style></head><body><main id="fx">${body}</main></body></html>`,
  );
  await installProbe(page);
}

/** A ledger band: a panel, its head, and a table in a band-width scroller. */
function band(table: string, head = ""): string {
  return `<section class="panel">${head}<div class="table-scroll">${table}</div></section>`;
}
const has = (r: LedgerResult, pred: (f: LedgerFinding) => boolean): boolean => r.failures.some(pred);

test.describe("ledger probe self-tests (synthetic fixtures)", () => {
  /* ---------------------------------------------------------------- G1 */
  const numRows = (n: number, cls = "c-num"): string =>
    Array.from({ length: n }, (_, i) =>
      `<tr><td class="c-flex">Member ${i}</td><td class="${cls}">${(i + 1) * 1371}` +
      `<span class="visually-hidden"> exactly ${(i + 1) * 1371} dollars across both filings</span></td>` +
      `<td class="c-num has-marks">${i * 7}.5M${i % 7 === 3 ? '<span class="hang">‡</span>' : ""}</td></tr>`).join("");
  /* A short header label, so its alignment is visible: a label as wide as
     the widest number sits on the digit edge whichever way it is aligned. */
  const g1Table = (head2 = "Amt", rows = 50): string =>
    band(
      `<table class="etable" id="t1"><thead><tr><th class="c-flex">Member</th><th class="c-num" id="h-amt">${head2}</th>` +
        `<th class="c-num has-marks" aria-sort="descending" id="h-net"><button class="th-sort">Net<span class="sort-caret" aria-hidden="true"></span></button>` +
        /* a hung mark whose glyph is not one of § † ‡ ≈ (so only the .hang
           exclusion keeps it off the edge) and a legacy glyph trigger hung
           in the slot (only the trigger exclusion keeps it off) */
        `<span class="hang">*</span><span class="note"><button class="note-btn" style="position:absolute;right:1px;top:2px">i</button></span></th>` +
        `</tr></thead><tbody>${numRows(rows)}</tbody></table>`,
    );

  test("G1 passes an aligned ledger — hung marks, the caret and screen-reader text are not the edge", async ({ page }) => {
    await fixture(page, g1Table());
    const r = await probe(page, "g1");
    expect(r.measured, "50 rows × 2 numeric columns").toBe(100);
    expect(r.failureCount, formatResult(r)).toBe(0);
  });

  test("G1 control: th.c-num{text-align:left} is DETECTED", async ({ page }) => {
    await fixture(page, g1Table(), "#fx th.c-num{text-align:left}");
    const r = await probe(page, "g1");
    expect(has(r, (f) => f.columnIndex === 1), formatResult(r)).toBe(true);
  });

  test("G1 control: ONE misaligned cell in row 30 of 50 is reported, and only it (per cell, not a sample)", async ({ page }) => {
    await fixture(page, g1Table(), "#fx #t1 tbody tr:nth-child(30) td:nth-child(2){padding-right:11px}");
    const r = await probe(page, "g1");
    expect(r.failures.map((f) => [f.columnIndex, f.row]), formatResult(r)).toEqual([[1, 29]]);
  });

  test("G1 control: an inline trailing ≈ in a header label is DETECTED", async ({ page }) => {
    await fixture(page, g1Table("Amt≈"));
    const r = await probe(page, "g1");
    expect(has(r, (f) => f.columnIndex === 1), formatResult(r)).toBe(true);
  });

  test("G1 control: a .sort-caret moved inline after the label is DETECTED", async ({ page }) => {
    await fixture(page, g1Table());
    expect((await probe(page, "g1")).failureCount).toBe(0);
    /* "moved inline": the caret takes inline advance after the label,
       however the ledger hangs it (absolute here; a zero-width inline box in
       the M1 region) */
    await page.addStyleTag({ content: "#fx .sort-caret{position:static;display:inline;width:auto}" });
    const r = await probe(page, "g1");
    expect(has(r, (f) => f.columnIndex === 2), formatResult(r)).toBe(true);
  });

  test("G1 control: a label trigger with visibility:hidden reads as UNMEASURED, never aligned", async ({ page }) => {
    const table = band(
      `<table class="etable"><thead><tr><th class="c-flex">Member</th><th class="c-num" id="h-lab">` +
        `<button class="note-btn note-label" id="lab">Value</button></th></tr></thead>` +
        `<tbody><tr><td class="c-flex">A</td><td class="c-num">1,234</td></tr><tr><td class="c-flex">B</td><td class="c-num">98</td></tr></tbody></table>`,
    );
    await fixture(page, table);
    const ok = await probe(page, "g1");
    expect(ok.failureCount, `the visible label trigger IS the header text\n${formatResult(ok)}`).toBe(0);
    expect(ok.measured).toBe(2);
    await page.addStyleTag({ content: "#fx #lab{visibility:hidden}" });
    const r = await probe(page, "g1");
    expect(r.unmeasured.some((f) => f.columnIndex === 1), formatResult(r)).toBe(true);
    expect(r.measured, "no cell of that column may count as measured against a hidden label").toBe(0);
    expect(r.ok, "a hidden label must not pass").toBe(false);
  });

  test("G1: generated ::after text in a header is visible text; the .sort-caret's is not", async ({ page }) => {
    await fixture(page, g1Table(), '#fx #h-amt::after{content:"x"}');
    const r = await probe(page, "g1");
    /* the generated "x" is the header's right-most visible text, so the label
       ends at the content edge: still aligned with the digits */
    expect(r.failureCount, formatResult(r)).toBe(0);
  });

  /* ---------------------------------------------------------------- G2 */
  const tall = band(`<table class="etable"><thead><tr><th class="c-flex">Member</th><th class="c-num">N</th></tr></thead><tbody>${numRows(20).replace(/<td class="c-num has-marks">.*?<\/td>/g, "")}</tbody></table>`);

  test("G2 passes a table with no inner scroll, fails a scroll box and a 'scroll for more rows' name", async ({ page }) => {
    await fixture(page, tall);
    const ok = await probe(page, "g2", { exempt: [] });
    expect(ok.measured).toBe(1);
    expect(ok.failureCount, formatResult(ok)).toBe(0);
    await page.addStyleTag({ content: "#fx .table-scroll{max-height:200px;overflow-y:auto}" });
    const boxed = await probe(page, "g2", { exempt: [] });
    expect(boxed.failureCount, formatResult(boxed)).toBe(1);
    const exempt = await probe(page, "g2", { exempt: [".panel > .table-scroll"] });
    expect(exempt.failureCount, "an exempt selector moves the finding to `excluded`").toBe(0);
    expect(exempt.excludedCount).toBe(1);
    await page.evaluate(() => document.querySelector("#fx .table-scroll")!.setAttribute("aria-label", "Feed · Scroll for more rows"));
    const named = await probe(page, "g2", { exempt: [".panel > .table-scroll"] });
    expect(has(named, (f) => /scroll for more rows/i.test(f.detail)), formatResult(named)).toBe(true);
  });

  /* ---------------------------------------------------------------- G3 */
  test("G3 passes a fitting table, fails a table wider than its container", async ({ page }) => {
    await fixture(page, g1Table("Amount", 5));
    expect((await probe(page, "g3")).failureCount).toBe(0);
    await page.addStyleTag({ content: "#fx #t1{min-width:3000px}" });
    const r = await probe(page, "g3");
    expect(has(r, (f) => f.tableIndex === 0), formatResult(r)).toBe(true);
  });

  /* ------------------------------------------------------------- G4/G5 */
  test("G4/G5 pass token-sized text; 8px and 10.2px text, and an 8px generated ::after, are DETECTED", async ({ page }) => {
    await fixture(page, g1Table("Amount", 5));
    const g4 = await probe(page, "g4");
    const g5 = await probe(page, "g5");
    expect(g4.failureCount, formatResult(g4)).toBe(0);
    expect(g5.failureCount, formatResult(g5)).toBe(0);
    expect(g4.measured).toBeGreaterThan(20);
    await page.evaluate(() => {
      document.getElementById("fx")!.insertAdjacentHTML(
        "beforeend",
        '<p><span id="tiny8" style="font-size:8px">tiny</span> <span id="odd102" style="font-size:10.2px">odd</span></p>',
      );
    });
    const g4b = await probe(page, "g4");
    expect(has(g4b, (f) => (f.el ?? "").includes("#tiny8")), formatResult(g4b)).toBe(true);
    expect(has(g4b, (f) => (f.el ?? "").includes("#odd102")), "10.2px is above the floor").toBe(false);
    const g5b = await probe(page, "g5");
    expect(has(g5b, (f) => (f.el ?? "").includes("#odd102")), formatResult(g5b)).toBe(true);
    await page.addStyleTag({ content: '#fx th::after{content:"x";font-size:8px}' });
    const g4c = await probe(page, "g4");
    expect(has(g4c, (f) => /^th.*::after$/.test(f.el ?? "")), formatResult(g4c)).toBe(true);
  });

  test("G4 ignores text inside a CLOSED <details> (its summary excepted), and measures it once opened", async ({ page }) => {
    await fixture(page, '<details id="d1"><summary>Notes on this data</summary><p><span id="tinyd" style="font-size:8px">tiny</span></p></details>');
    const closed = await probe(page, "g4");
    expect(closed.failureCount, formatResult(closed)).toBe(0);
    expect(closed.measured, "the summary is measured").toBe(1);
    await page.evaluate(() => ((document.getElementById("d1") as HTMLDetailsElement).open = true));
    expect(has(await probe(page, "g4"), (f) => (f.el ?? "").includes("#tinyd"))).toBe(true);
  });

  test("G5 fails when fewer than 14 --fs-* tokens resolve, and when a page renders more than 14 sizes", async ({ page }) => {
    await fixture(page, "<p>one line</p>", ":root{--fs-hero:initial}");
    const few = await probe(page, "g5");
    expect(has(few, (f) => /only 13 --fs-\* tokens/.test(f.detail)), formatResult(few)).toBe(true);
    const sizes = [9.5, 10, 10.5, 11, 11.5, 12, 12.5, 13, 13.5, 14, 15, 17, 20, 26, 40];
    await fixture(
      page,
      `<p>${sizes.map((s) => `<span style="font-size:${s}px">x</span>`).join(" ")}</p>`,
      ":root{--fs-extra:17px}",
    );
    const many = await probe(page, "g5");
    expect(has(many, (f) => /15 distinct rendered sizes/.test(f.detail)), formatResult(many)).toBe(true);
    expect(has(many, (f) => /not a type token/.test(f.detail)), "every size there is a token").toBe(false);
  });

  /* ---------------------------------------------------------------- G6 */
  const g6Table = (listed: string | null): string =>
    band(
      `<table class="etable"${listed === null ? "" : ` data-columns="${listed}"`}><thead><tr><th class="c-flex" data-col="member">Member</th>` +
        `<th data-col="owner">Owner</th><th data-col="bar">Book</th><th class="c-num" data-col="amount">Amount</th></tr></thead><tbody>` +
        Array.from({ length: 6 }, (_, i) =>
          `<tr><td class="c-flex">M${i}</td><td>${i % 2 ? "—" : "-"}<span class="visually-hidden">owner not stated</span></td>` +
          `<td><span class="book-track"><span style="width:${10 * i + 5}%"></span></span></td><td class="c-num">${i}</td></tr>`).join("") +
        `</tbody></table>`,
    );

  test("G6 fails an all-dash column data-columns does not list, and passes it once listed", async ({ page }) => {
    await fixture(page, g6Table(null));
    const r = await probe(page, "g6");
    expect(r.failures.map((f) => f.columnIndex), formatResult(r)).toEqual([1]);
    await fixture(page, g6Table("member,owner,amount"));
    const listed = await probe(page, "g6");
    expect(listed.failureCount, formatResult(listed)).toBe(0);
    expect(listed.excluded.some((f) => f.columnIndex === 1), "the exemption comes from data-columns").toBe(true);
    await fixture(page, g6Table("member,amount"));
    expect((await probe(page, "g6")).failures.map((f) => f.columnIndex), "listing another key exempts nothing").toEqual([1]);
  });

  /* ---------------------------------------------------------------- G7 */
  test("G7 passes whole numbers; a number clipped by an inner box or by its cell is DETECTED", async ({ page }) => {
    await fixture(page, g1Table("Amount", 6));
    const ok = await probe(page, "g7");
    expect(ok.measured).toBe(12);
    expect(ok.failureCount, formatResult(ok)).toBe(0);
    await page.evaluate(() => {
      const td = document.querySelector("#t1 tbody tr:nth-child(3) td:nth-child(2)")!;
      td.innerHTML = `<span style="display:inline-block;max-width:10px;overflow:hidden;vertical-align:bottom">${td.firstChild!.textContent}</span>`;
    });
    const inner = await probe(page, "g7");
    expect(inner.failures.map((f) => [f.columnIndex, f.row]), formatResult(inner)).toEqual([[1, 2]]);
    /* the whole column squeezed (a lone cell's max-width does not size a
       table column): every number is wider than its content box */
    await page.addStyleTag({ content: "#fx #t1 tr > :nth-child(3){max-width:0;overflow:hidden}" });
    const cell = await probe(page, "g7");
    expect(cell.failures.filter((f) => f.columnIndex === 2 && /wide in a/.test(f.detail)).length, formatResult(cell)).toBe(6);
  });

  /* ---------------------------------------------------------------- G8 */
  test("G8 passes 30px single-line rows at 1440 fine, fails a 12px cell padding", async ({ page }) => {
    await fixture(page, g1Table("Amount", 8));
    const ok = await probe(page, "g8");
    expect(ok.measured).toBe(8);
    expect(ok.failureCount, formatResult(ok)).toBe(0);
    await page.addStyleTag({ content: "#fx td{padding-top:12px;padding-bottom:12px}" });
    const r = await probe(page, "g8");
    expect(r.failureCount, formatResult(r)).toBe(8);
  });

  test("G8 at 390: single-line rows are 44±1, and the feed's fold rows must be uniform", async ({ page }) => {
    const feed =
      `<table class="feed-table reference-feed"><thead><tr><th>Kind</th><th>Member</th></tr></thead><tbody>` +
      Array.from({ length: 6 }, (_, i) => `<tr class="reference-row"><td>BUY</td><td>Member ${i}<br>second line</td></tr>`).join("") +
      `</tbody></table>`;
    await fixture(page, g1Table("Amount", 4) + band(feed), "#fx .etable td{padding-top:14.5px;padding-bottom:14.5px}", 390);
    const ok = await probe(page, "g8");
    expect(ok.failureCount, formatResult(ok)).toBe(0);
    expect(ok.measured, "4 ledger rows + 6 fold rows").toBe(10);
    await page.addStyleTag({ content: "#fx .reference-feed tbody tr:nth-child(3) td{padding-bottom:9px}" });
    const r = await probe(page, "g8");
    expect(has(r, (f) => /not uniform/.test(f.detail)), formatResult(r)).toBe(true);
    await page.addStyleTag({ content: "#fx .etable td{padding-top:7.5px;padding-bottom:7.5px}" });
    const short = await probe(page, "g8");
    expect(has(short, (f) => /expected 44±1/.test(f.detail)), formatResult(short)).toBe(true);
  });

  /* ---------------------------------------------------------------- G9 */
  const pair = (id: string, extra = ""): string =>
    `<div class="design-band" id="${id}"${extra} style="display:grid;grid-template-columns:1fr 1fr;gap:0">` +
    `<section class="panel"><p>Leaders</p><p>row</p><p>row</p></section>` +
    `<section class="panel"><p>Tickers</p><p>row</p><p>row</p></section>` +
    `<p class="planned-line">PLANNED more</p></div>`;

  test("G9 passes a balanced pair, fails 300px appended to one cell and a lost pair", async ({ page }) => {
    await fixture(page, pair("b1"));
    const ok = await probe(page, "g9", { expectedPairs: 1 });
    expect(ok.measured).toBe(1);
    expect(ok.failureCount, formatResult(ok)).toBe(0);
    expect((await probe(page, "g9", { expectedPairs: 2 })).failureCount, "a lost pair fails the count").toBe(1);
    await page.evaluate(() => {
      document.querySelector("#b1 > section")!.insertAdjacentHTML("beforeend", '<p style="padding-top:300px">tail</p>');
    });
    const r = await probe(page, "g9", { expectedPairs: 1 });
    expect(has(r, (f) => (f.delta ?? 0) > 96), formatResult(r)).toBe(true);
  });

  test("G9 measures VISIBLE content: rows scrolled out of an inner box do not count as the cell's bottom", async ({ page }) => {
    const lines = Array.from({ length: 30 }, (_, i) => `<p>row ${i}</p>`).join("");
    await fixture(
      page,
      `<div class="design-band" id="b3" style="display:grid;grid-template-columns:1fr 1fr">` +
        `<section class="panel"><p>Flows</p><div style="max-height:60px;overflow-y:auto">${lines}</div></section>` +
        `<section class="panel"><p>Profile</p><p>row</p><p>row</p><p>row</p></section></div>`,
    );
    const r = await probe(page, "g9", { expectedPairs: 1 });
    expect(r.failureCount, formatResult(r)).toBe(0);
  });

  test("G9: a pair collapsed by the empty-state rule is subtracted from the expected count", async ({ page }) => {
    await fixture(page, pair("b1") + pair("b2", ' data-collapsed="empty-state"'));
    const r = await probe(page, "g9", { expectedPairs: 2 });
    expect(r.failureCount, formatResult(r)).toBe(0);
  });

  /* --------------------------------------------------------------- G10 */
  const g10Table = (flex = true): string =>
    band(
      `<table class="etable" id="t10"><thead><tr><th${flex ? ' class="c-flex"' : ""}>Member</th><th class="c-num">Trades</th>` +
        `<th class="c-num has-marks">Net<span class="hang">†</span></th><th class="c-kind">Kind</th></tr></thead><tbody>` +
        `<tr data-edge="buy"><td${flex ? ' class="c-flex"' : ""}>Alice Adams</td><td class="c-num">12</td><td class="c-num has-marks">$1.2M</td><td class="c-kind">BUY</td></tr>` +
        `<tr data-edge="sell"><td${flex ? ' class="c-flex"' : ""}>Bob Brown</td><td class="c-num">7</td><td class="c-num has-marks">−$30K<span class="hang">‡</span></td><td class="c-kind">SELL</td></tr>` +
        `</tbody></table>`,
      `<div class="panel-head"><h2 class="section-h">Leaders</h2><span class="panel-note">TRAILING 12 MONTHS · BY FLOW</span></div>`,
    ) +
    `<section class="panel"><div class="panel-head" id="ctl-head" style="align-items:center"><h2 class="section-h">Feed</h2>` +
    `<div class="seg"><button aria-pressed="true">All</button><button aria-pressed="false">House</button></div></div></section>`;

  test("G10 passes the ledger spacing, slack, edges, baselines, centring and edge colours", async ({ page }) => {
    await fixture(page, g10Table());
    const r = await probe(page, "g10");
    expect(r.failureCount, formatResult(r)).toBe(0);
    expect(r.notes.join(" "), "every sub-check measured something").toMatch(/gaps [1-9]\d*, slack [1-9]\d*, edges [1-9]\d*, colours [1-9]\d*, baselines [1-9]\d*, centring [1-9]\d*/);
  });

  test("G10 controls: a 24px numeric padding, a missing c-flex, a mis-painted edge, a shifted control and meta, a gutter off", async ({ page }) => {
    await fixture(page, g10Table(), "#fx td.c-num:not(:first-child){padding-left:24px}");
    expect(has(await probe(page, "g10"), (f) => /gap before this column/.test(f.detail)), "numeric padding-left 24px").toBe(true);

    await fixture(page, g10Table(false));
    expect(has(await probe(page, "g10"), (f) => /slack outside the c-flex column/.test(f.detail)), "no c-flex: slack spreads").toBe(true);

    await fixture(page, g10Table());
    await page.evaluate(() => {
      (document.querySelector('#t10 tr[data-edge="buy"] > td') as HTMLElement).style.boxShadow = "inset 3px 0 0 var(--kind-sell-edge)";
    });
    expect(has(await probe(page, "g10"), (f) => /data-edge="buy" edge is/.test(f.detail)), "BUY painted with the sell edge").toBe(true);

    await fixture(page, g10Table(), "#fx #ctl-head .seg{position:relative;top:3px}");
    expect(has(await probe(page, "g10"), (f) => /centre is/.test(f.detail)), "control 3px down").toBe(true);

    await fixture(page, g10Table(), "#fx .panel-note{position:relative;top:3px}");
    expect(has(await probe(page, "g10"), (f) => /meta baseline/.test(f.detail)), "meta off the title baseline").toBe(true);

    await fixture(page, g10Table(), "#fx #t10 tr > :first-child{padding-left:20px}");
    expect(has(await probe(page, "g10"), (f) => /first text x/.test(f.detail)), "first text off the gutter").toBe(true);

    await fixture(page, g10Table(), "#fx #t10 tr > :last-child{padding-right:28px}");
    expect(has(await probe(page, "g10"), (f) => /last text right/.test(f.detail)), "last text off band right − gutter").toBe(true);

    /* a per-side gutter (a pair's 28px inner edge, D-11) is read per side */
    await fixture(page, g10Table(), "#fx .table-scroll{--gutter-r:28px}#fx #t10 tr > :last-child{padding-right:28px}");
    expect((await probe(page, "g10")).failures.filter((f) => /last text right/.test(f.detail)), "--gutter-r 28px with a 28px last padding is on the gutter").toEqual([]);

  });

  test("G10 control: a kind row with no data-edge is DETECTED", async ({ page }) => {
    await fixture(page, g10Table().replace('<tr data-edge="sell">', "<tr>"));
    expect(has(await probe(page, "g10"), (f) => /carries no data-edge/.test(f.detail))).toBe(true);
  });

  /* --------------------------------------------------------------- G11 */
  test("G11 passes readable text; #3a4a5e on dark and #bbb on light are DETECTED; a gradient is unmeasured", async ({ page }) => {
    await fixture(page, g1Table("Amount", 3));
    const ok = await probe(page, "g11");
    expect(ok.failureCount, formatResult(ok)).toBe(0);
    expect(ok.measured).toBeGreaterThan(10);
    await page.evaluate(() => document.getElementById("fx")!.insertAdjacentHTML("beforeend", '<p id="dim" style="color:#3a4a5e">dim note</p>'));
    expect(has(await probe(page, "g11"), (f) => (f.el ?? "").includes("#dim"))).toBe(true);
    await fixture(page, g1Table("Amount", 3), "html,body{background:#faf9f5}#fx th{color:#bbb}#fx td{color:#262319}");
    const light = await probe(page, "g11");
    expect(has(light, (f) => /#bbbbbb/.test(f.detail)), formatResult(light)).toBe(true);
    await fixture(page, '<p id="grad" style="background:linear-gradient(#000,#fff)">on a gradient</p>');
    const g = await probe(page, "g11");
    expect(g.unmeasured.some((f) => (f.el ?? "").includes("#grad")), "a gradient is counted unmeasurable, not guessed").toBe(true);
    expect(has(g, (f) => (f.el ?? "").includes("#grad"))).toBe(false);
  });

  /* -------------------------------------------------------------- G11b */
  const segAndBars =
    `<div class="seg"><button aria-pressed="true" id="on">All</button><button aria-pressed="false">House</button></div>` +
    `<p><a href="#x" id="lnk">a link</a> <span class="book-track"><span id="bar"></span></span></p>`;

  test("G11b passes the cue, bars and focus ring; removing the cue, a dark bar and a dim ring are DETECTED", async ({ page }) => {
    await fixture(page, segAndBars);
    const ok = await probe(page, "g11b");
    expect(ok.measured, "one active item and one bar").toBe(2);
    expect(ok.failureCount, formatResult(ok)).toBe(0);
    await page.keyboard.press("Tab");
    const ring = await probe(page, "focusRing");
    expect(ring.measured, formatResult(ring)).toBeGreaterThan(0);
    expect(ring.failureCount, formatResult(ring)).toBe(0);

    await page.addStyleTag({ content: '#fx .seg > button[aria-pressed="true"]{box-shadow:none}' });
    expect(has(await probe(page, "g11b"), (f) => /no inset cue/.test(f.detail)), "cue removed").toBe(true);

    await fixture(page, segAndBars, "#fx .book-track > span{background:#5a2e28}");
    const dark = await probe(page, "g11b");
    expect(has(dark, (f) => /on its track/.test(f.detail)) && has(dark, (f) => /on the page/.test(f.detail)), formatResult(dark)).toBe(true);

    await fixture(page, segAndBars, "#fx a:focus-visible,#fx button:focus-visible{outline:1px solid #1a2533}");
    await page.keyboard.press("Tab");
    expect(has(await probe(page, "focusRing"), (f) => /focus outline/.test(f.detail)), "dim focus ring").toBe(true);
  });

  /* --------------------------------------------------------------- G12 */
  /* A sort label (24×12 at x 100–124) and a mark trigger (8×12 at x
     126–134): closer than --hit-min, so each hit square is clipped at x 125,
     the midpoint of the facing edges (H-16). The squares are written out in
     px per width, so the fixture is exact. Unclipped at 44px, the mark's
     square (108–152) covers the label's centre (112): the defect T1.5's
     control reintroduces. */
  const G12_BODY =
    `<div id="g12" style="position:relative;height:140px">` +
    `<button class="th-sort" id="s1" style="position:absolute;left:100px;top:50px;width:24px;height:12px;font:500 10px/12px monospace">NET</button>` +
    `<button class="note-btn note-mark" id="m1" style="position:absolute;left:126px;top:50px;width:8px;height:12px;font:500 10px/12px monospace">§</button></div>`;
  const G12_CLIPPED =
    `#fx #g12 button::before{content:"";position:absolute}` +
    `@media (min-width:721px){#fx #s1::before{left:0;right:0;top:-6px;bottom:-6px}#fx #m1::before{left:-1px;right:-8px;top:-6px;bottom:-6px}}` +
    `@media (max-width:720px){#fx #s1::before{left:-10px;right:-1px;top:-16px;bottom:-16px}#fx #m1::before{left:-1px;right:-18px;top:-16px;bottom:-16px}}`;
  const G12_UNCLIPPED =
    `@media (max-width:720px){#fx #s1::before{left:-10px;right:-10px}#fx #m1::before{left:-18px;right:-18px}}` +
    `@media (min-width:721px){#fx #m1::before{left:-8px;right:-8px}}`;

  for (const width of [1440, 390] as const) {
    test(`G12 @${width}: midpoint-clipped hit squares pass`, async ({ page }) => {
      await fixture(page, G12_BODY, G12_CLIPPED, width);
      const r = await probe(page, "g12");
      expect(r.measured).toBe(2);
      expect(r.failureCount, formatResult(r)).toBe(0);
    });
  }

  test("G12 @390 control: removing the midpoint clip makes the neighbour's centre hit the trigger", async ({ page }) => {
    await fixture(page, G12_BODY, G12_CLIPPED + G12_UNCLIPPED, 390);
    const r = await probe(page, "g12");
    expect(has(r, (f) => /neighbour button#s1\.th-sort's centre .* returns button#m1/.test(f.detail)), formatResult(r)).toBe(true);
  });

  test("G12 @1440 control: without the clip the trigger's square takes the neighbour's corner", async ({ page }) => {
    await fixture(page, G12_BODY, G12_CLIPPED + G12_UNCLIPPED, 1440);
    const r = await probe(page, "g12");
    expect(has(r, (f) => /corners miss/.test(f.detail)), formatResult(r)).toBe(true);
  });

  test("G12 @390 control: removing the ::before hit square is DETECTED", async ({ page }) => {
    await fixture(page, G12_BODY, "", 390);
    const r = await probe(page, "g12");
    expect(r.failures.filter((f) => /corners miss/.test(f.detail)).length, formatResult(r)).toBe(2);
  });

  test("G12 @390: a header control's square is bottom-anchored to the header row, never into the first body row", async ({ page }) => {
    /* The header row is tall enough that the clamped square stays inside the
       table (a .table-scroll clips vertically too, overflow-x being auto). */
    const table = band(
      `<table class="etable" id="t12"><thead><tr><th class="c-num" aria-sort="none"><button class="th-sort" id="hs">Net</button></th></tr></thead>` +
        `<tbody><tr><td class="c-num">1,234</td></tr></tbody></table>`,
    );
    const css =
      "#fx #t12 th{padding:26px 6px 6px}#fx #hs{position:relative}" +
      '#fx #hs::before{content:"";position:absolute;left:50%;width:44px;margin-left:-22px;height:44px;bottom:-7px}';
    await fixture(page, table, css, 390);
    const ok = await probe(page, "g12");
    expect(ok.measured).toBe(1);
    expect(ok.failureCount, formatResult(ok)).toBe(0);
    /* the same square centred on the button instead reaches into the first
       body row: a header hit area there would swallow a click on the row */
    await page.addStyleTag({ content: "#fx #hs::before{bottom:auto;top:50%;margin-top:-22px}" });
    const r = await probe(page, "g12");
    expect(has(r, (f) => /reaches into the first body row/.test(f.detail)), formatResult(r)).toBe(true);
  });

  test("G12: a --hit-min that computes to the wrong size for the pointer is DETECTED", async ({ page }) => {
    await fixture(page, G12_BODY, G12_CLIPPED + "@media (max-width:720px){:root{--hit-min:24px}}", 390);
    expect(has(await probe(page, "g12"), (f) => /--hit-min computes to 24px/.test(f.detail))).toBe(true);
  });

  /* ------------------------------------------------ T1.2 / T1.6 checks */
  test("headFont passes the header spec, fails a 9px header", async ({ page }) => {
    await fixture(page, g1Table("Amount", 2));
    const ok = await probe(page, "headFont");
    expect(ok.failureCount, formatResult(ok)).toBe(0);
    expect(ok.measured).toBeGreaterThan(0);
    await page.addStyleTag({ content: "#fx th{font-size:9px}" });
    expect(has(await probe(page, "headFont"), (f) => /size 9px/.test(f.detail))).toBe(true);
  });

  test("oneFlex passes one c-flex, fails a second, and fails a filing history whose flex column is not first", async ({ page }) => {
    await fixture(page, g1Table("Amount", 2));
    expect((await probe(page, "oneFlex")).failureCount).toBe(0);
    await page.evaluate(() => document.querySelectorAll("#t1 tr > :nth-child(2)").forEach((c) => c.classList.add("c-flex")));
    expect(has(await probe(page, "oneFlex"), (f) => /2 c-flex columns/.test(f.detail))).toBe(true);
    await fixture(
      page,
      `<section class="panel"><div class="table-scroll design-history"><table class="etable"><thead><tr><th>Filed</th><th class="c-flex">Receipt</th></tr></thead>` +
        `<tbody><tr><td>2026-01-02</td><td class="c-flex">PTR</td></tr></tbody></table></div></section>`,
    );
    expect(has(await probe(page, "oneFlex"), (f) => /filing history/.test(f.detail))).toBe(true);
  });

  test("metaTruncation passes a wrapping meta, fails an ellipsized one", async ({ page }) => {
    await fixture(page, band("<table class=\"etable\"><tbody><tr><td>x</td></tr></tbody></table>", `<div class="panel-head"><h2 class="section-h">T</h2><span class="panel-note">WINDOW 2025-09 → 2026-09 · AS OF 2026-09-25</span></div>`));
    expect((await probe(page, "metaTruncation")).failureCount).toBe(0);
    await page.addStyleTag({ content: "#fx .panel-note{text-overflow:ellipsis;overflow:hidden;white-space:nowrap}" });
    expect((await probe(page, "metaTruncation")).failureCount).toBe(1);
  });

  test("controlHeights passes 25px segments and a tight sort button, fails min-height 44 and a padded sort button", async ({ page }) => {
    const body = `<div class="seg"><button aria-pressed="true">All</button><button>House</button></div>` +
      band(`<table class="etable"><thead><tr><th class="c-num" aria-sort="none"><button class="th-sort">Net</button></th></tr></thead><tbody><tr><td class="c-num">1</td></tr></tbody></table>`);
    await fixture(page, body);
    const ok = await probe(page, "controlHeights");
    expect(ok.measured).toBe(3);
    expect(ok.failureCount, formatResult(ok)).toBe(0);
    await page.addStyleTag({ content: "#fx .seg > button{min-height:44px}" });
    expect((await probe(page, "controlHeights")).failures.filter((f) => /24–26/.test(f.detail)).length).toBe(2);
    await fixture(page, body, "#fx .th-sort{padding:6px 0}");
    expect(has(await probe(page, "controlHeights"), (f) => /sort button/.test(f.detail))).toBe(true);
  });

  /* --------------------------------------------- M1 code-review fixes */
  test("Q-3 G1: a numeric (c-num) column that loses its right alignment FAILS — it is never skipped", async ({ page }) => {
    await fixture(page, g1Table(), "#fx :is(th,td).c-num{text-align:left}");
    const r = await probe(page, "g1");
    expect(r.failures.filter((f) => /not right-aligned/.test(f.detail)).map((f) => f.columnIndex).sort(), formatResult(r)).toEqual([1, 2]);
    // a declared identity first column (c-flex) is excluded, not failed
    await fixture(page, band(`<table class="etable"><thead><tr><th class="c-flex c-num">Filed</th><th class="c-num">Rows</th></tr></thead>` +
      `<tbody><tr><td class="c-flex c-num" style="text-align:left">2026-05-15</td><td class="c-num">12</td></tr></tbody></table>`));
    const id = await probe(page, "g1");
    expect(id.failureCount, formatResult(id)).toBe(0);
    expect(id.excluded.some((f) => /identity first column/.test(f.detail))).toBe(true);
  });

  test("Q-8 G8 @390: two-line rows are measured — uniform passes; an uneven row and a row under 44px are DETECTED", async ({ page }) => {
    const twoLine = g1Table("Amount", 6).replace(/<td class="c-flex">Member (\d+)<\/td>/g, '<td class="c-flex">Member $1<br>since 2019</td>');
    await fixture(page, twoLine, "#fx .etable td{padding-top:14.5px;padding-bottom:14.5px}#fx td.c-flex{max-width:none}", 390);
    const ok = await probe(page, "g8");
    expect(ok.measured, "six two-line rows are measured, not skipped").toBe(6);
    expect(ok.failureCount, formatResult(ok)).toBe(0);
    await page.addStyleTag({ content: "#fx .etable tbody tr:nth-child(4) td{padding-bottom:20px}" });
    expect(has(await probe(page, "g8"), (f) => /2-line rows are not uniform/.test(f.detail))).toBe(true);
    await page.addStyleTag({ content: "#fx .etable td{padding-top:0 !important;padding-bottom:0 !important}" });
    expect(has(await probe(page, "g8"), (f) => /under the 44px hit square/.test(f.detail))).toBe(true);
  });

  test("Q-9 G11b: a bar on an image track is measured against the page, never skipped", async ({ page }) => {
    const imageTrack = `<p><span class="book-track" style="background-image:repeating-linear-gradient(90deg,#22303f 0 1px,#10161f 1px 20%)"><span id="bar"></span></span></p>`;
    await fixture(page, imageTrack);
    const ok = await probe(page, "g11b");
    expect(ok.measured, "the bar is measured").toBe(1);
    expect(ok.failureCount, formatResult(ok)).toBe(0);
    await fixture(page, imageTrack, "#fx .book-track > span{background:#3a2420}");
    expect(has(await probe(page, "g11b"), (f) => /on the page/.test(f.detail)), "a dark fill on an image track is caught").toBe(true);
  });

  test("Q-12 G10: a part that measures less than the page's floor FAILS", async ({ page }) => {
    await fixture(page, g10Table());
    const ok = await probe(page, "g10", { min: { colours: 1, centring: 1 } });
    expect(ok.failureCount, formatResult(ok)).toBe(0);
    expect(ok.sub?.colours, "the fixture's kind rows are measured").toBeGreaterThan(0);
    expect(ok.sub?.centring, "the fixture's band-head control is measured").toBeGreaterThan(0);
    const r = await probe(page, "g10", { min: { colours: 999, centring: 999 } });
    expect(r.failures.filter((f) => /this page must give it at least 999/.test(f.detail)).length, formatResult(r)).toBe(2);
  });

  /* ------------------------------------------------------ harness rules */
  test("harness: a skip is a failure when POPULUS_BUILD_DIR is set", () => {
    expect(skipDecision({}, "no page")).toEqual({ skip: "no page" });
    expect(skipDecision({ POPULUS_BUILD_DIR: "" }, "no page")).toEqual({ skip: "no page" });
    const d = skipDecision({ POPULUS_BUILD_DIR: "/build" }, "no page");
    expect("fail" in d && /POPULUS_BUILD_DIR/.test(d.fail)).toBe(true);
  });
});

/* =============================================================================
   DESIGN-POLISH T1.10 — ROUTE negative controls, on the served build.

   Each control follows one pattern, so it proves detection and nothing
   weaker: find a TARGET the predicate currently passes (a clean column, table,
   row or control), inject exactly the defect the plan names, and require the
   SAME predicate to now report that target. A control whose page already
   fails the check everywhere has no clean target and says so: it proves
   nothing there, which is a failure, not a pass. So most of these are green
   only on the M1 tree (the baseline fails the checks they target); the ones
   whose targets exist on any build (G3, G4/G5, G6, G7, G9, meta truncation,
   the theme assertions) run green on the baseline too.
   ========================================================================== */

async function openRoute(page: Page, route: string, width = 1440, theme?: "light" | "dark"): Promise<void> {
  await page.route(/cloudflareinsights\.com/, (r) => r.abort());
  if (theme) {
    await page.addInitScript((t: string) => {
      try { localStorage.setItem("populus:theme", t); } catch { /* the assertion reports it */ }
    }, theme);
  }
  await page.setViewportSize({ width, height: width > 720 ? 900 : 844 });
  const resp = await page.goto(route);
  expect(resp?.status(), `${route} must answer 200`).toBe(200);
  await page.waitForLoadState("networkidle").catch(() => undefined);
  await page.evaluate(() => document.fonts.ready);
  await installProbe(page);
}

/** The findings of `after` that `before` did not have, by `key`. Refuses a
    truncated `before` (it cannot prove a target was clean). */
function newFindings(before: LedgerResult, after: LedgerResult, key: (f: LedgerFinding) => string): LedgerFinding[] {
  const listed = before.failures.reduce((n, f) => n + (f.count ?? 1), 0);
  expect(
    listed,
    `the page already fails ${before.check} past the reporting cap (${before.failureCount}): no target can be proven clean — needs the M1 build`,
  ).toBe(before.failureCount);
  const had = new Set(before.failures.map(key));
  return after.failures.filter((f) => !had.has(key(f)));
}
const colKey = (f: LedgerFinding): string => `${f.tableIndex}|${f.columnIndex}`;
const elKey = (f: LedgerFinding): string => `${f.el}|${f.detail.replace(/[-\d.]+/g, "#")}`;

/** Numeric header columns in the page, as the probe numbers them. */
async function numericHeaders(page: Page, filter: "any" | "sortable" | "label" = "any") {
  return page.evaluate((mode) => {
    const all = Array.from(document.querySelectorAll("table"));
    const out: { tableIndex: number; columnIndex: number; spare: number }[] = [];
    all.forEach((t, tableIndex) => {
      if (!t.checkVisibility() || t.parentElement?.closest("table")) return;
      const rows = t.tHead?.rows;
      const hr = rows && rows.length ? rows[rows.length - 1] : null;
      if (!hr || !hr.checkVisibility()) return;
      let c = 0;
      for (const th of Array.from(hr.cells)) {
        const span = Math.max(1, th.colSpan || 1);
        const ok = span === 1 && th.classList.contains("c-num") && c > 0 && th.checkVisibility() &&
          (mode === "any" || (mode === "sortable" ? !!th.querySelector(".th-sort .sort-caret, .sort-caret") : !!th.querySelector(".note-label")));
        if (ok) {
          const cs = getComputedStyle(th);
          const cw = th.getBoundingClientRect().width - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
          const r = document.createRange();
          r.selectNodeContents(th.querySelector(".th-sort, .note-label") ?? th);
          const lw = r.getBoundingClientRect().width;
          out.push({ tableIndex, columnIndex: c, spare: cw - lw });
        }
        c += span;
      }
    });
    return out;
  }, filter);
}

test.describe("route negative controls (clean target → injected defect → same predicate reports it)", () => {
  test.describe.configure({ timeout: 120_000 });

  /* ---------------------------------------------------------- T1.3 G1 */
  test("T1.3 G1 @1440: th.c-num{text-align:left} is DETECTED on a column G1 passes", async ({ page }) => {
    await openRoute(page, "/congress/");
    const before = await probe(page, "g1");
    const failing = new Set(before.failures.map(colKey));
    const targets = (await numericHeaders(page)).filter((h) => h.spare > 3 && !failing.has(`${h.tableIndex}|${h.columnIndex}`));
    expect(targets.length, `no clean numeric column with room to move\n${formatResult(before, 5)}`).toBeGreaterThan(0);
    await page.addStyleTag({ content: "th.c-num{text-align:left !important}" });
    const fresh = newFindings(before, await probe(page, "g1"), colKey);
    expect(fresh.some((f) => targets.some((t) => t.tableIndex === f.tableIndex && t.columnIndex === f.columnIndex))).toBe(true);
  });

  test("Q-3 G1 @1440: :is(th,td).c-num{text-align:left} FAILS the numeric columns, never skips them", async ({ page }) => {
    await openRoute(page, "/congress/");
    const before = await probe(page, "g1");
    const numeric = await numericHeaders(page);
    expect(numeric.length, "the page has numeric columns").toBeGreaterThan(0);
    await page.addStyleTag({ content: ":is(th,td).c-num{text-align:left !important}" });
    const after = await probe(page, "g1");
    const flagged = new Set(after.failures.filter((f) => /not right-aligned/.test(f.detail)).map(colKey));
    const missed = numeric.filter((h) => !flagged.has(`${h.tableIndex}|${h.columnIndex}`));
    expect(missed, `every numeric column fails once it is not right-aligned\n${formatResult(after, 8)}`).toEqual([]);
    expect(before.failures.filter((f) => /not right-aligned/.test(f.detail)), "and none did before").toEqual([]);
  });

  test("T1.3 G1 @1440: an inline trailing ≈ in a header label is DETECTED", async ({ page }) => {
    await openRoute(page, "/congress/");
    const before = await probe(page, "g1");
    const failing = new Set(before.failures.map(colKey));
    const t = (await numericHeaders(page)).find((h) => !failing.has(`${h.tableIndex}|${h.columnIndex}`));
    expect(t, `no clean numeric column\n${formatResult(before, 5)}`).toBeTruthy();
    await page.evaluate(({ tableIndex, columnIndex }) => {
      const table = document.querySelectorAll("table")[tableIndex]!;
      const hr = table.tHead!.rows[table.tHead!.rows.length - 1]!;
      let c = 0;
      for (const th of Array.from(hr.cells)) {
        if (c === columnIndex) {
          const w = document.createTreeWalker(th, NodeFilter.SHOW_TEXT);
          let last: Text | null = null;
          for (let n = w.nextNode(); n; n = w.nextNode()) {
            const p = n.parentElement!;
            if (!n.nodeValue!.trim() || p.closest(".visually-hidden, .note-pop, .hang, .sort-caret") || (p.closest(".note-btn") && !p.closest(".note-label"))) continue;
            // a label's unrendered twin (the narrow-width abbreviation) is not its label
            if (!p.checkVisibility()) continue;
            last = n as Text;
          }
          last!.appendData("≈");
        }
        c += Math.max(1, th.colSpan || 1);
      }
    }, t!);
    const fresh = newFindings(before, await probe(page, "g1"), colKey);
    expect(fresh.some((f) => f.tableIndex === t!.tableIndex && f.columnIndex === t!.columnIndex), "the ≈ must move the measured label edge").toBe(true);
  });

  test("T1.3 G1 @1440: a .sort-caret moved inline after the label is DETECTED", async ({ page }) => {
    await openRoute(page, "/congress/");
    const cands = await numericHeaders(page, "sortable");
    expect(cands.length, "a sortable numeric header with a .sort-caret").toBeGreaterThan(0);
    /* show the caret's glyph on every candidate first, then require clean */
    await page.evaluate((cs) => {
      for (const { tableIndex, columnIndex } of cs) {
        const hr = document.querySelectorAll("table")[tableIndex]!.tHead!;
        const row = hr.rows[hr.rows.length - 1]!;
        let c = 0;
        for (const th of Array.from(row.cells)) {
          if (c === columnIndex) th.setAttribute("aria-sort", "descending");
          c += Math.max(1, th.colSpan || 1);
        }
      }
    }, cands);
    const before = await probe(page, "g1");
    const failing = new Set(before.failures.map(colKey));
    const clean = cands.filter((h) => !failing.has(`${h.tableIndex}|${h.columnIndex}`));
    expect(clean.length, `no sortable numeric column G1 passes\n${formatResult(before, 5)}`).toBeGreaterThan(0);
    await page.addStyleTag({ content: ".sort-caret{position:static !important;display:inline !important;width:auto !important}" });
    const fresh = newFindings(before, await probe(page, "g1"), colKey);
    expect(fresh.some((f) => clean.some((t) => t.tableIndex === f.tableIndex && t.columnIndex === f.columnIndex))).toBe(true);
  });

  test("T1.3 G1 @1440: ONE misaligned cell in row 30 of a 50-row table is reported, and only that cell", async ({ page }) => {
    let found: { tableIndex: number; columnIndex: number } | null = null;
    for (const route of ["/congress/", "/congress/members/M001193/", "/signals/"]) {
      await openRoute(page, route);
      const before = await probe(page, "g1");
      if (before.failures.length !== before.failureCount) continue;
      const failing = new Set(before.failures.map(colKey));
      found = await page.evaluate((failingKeys) => {
        const tables = Array.from(document.querySelectorAll("table"));
        for (let ti = 0; ti < tables.length; ti++) {
          const t = tables[ti]!;
          if (!t.checkVisibility() || !t.tHead) continue;
          const rows = Array.from(t.tBodies).flatMap((b) => Array.from(b.rows)).filter((r) => r.checkVisibility() && r.getBoundingClientRect().height > 0);
          if (rows.length < 50) continue;
          const cells = rows[29]!.cells;
          for (let c = 1; c < cells.length; c++) {
            const cell = cells[c]!;
            if (cell.colSpan !== 1 || !/right|end/.test(getComputedStyle(cell).textAlign) || !cell.textContent!.trim()) continue;
            if (failingKeys.includes(`${ti}|${c}`)) continue;
            cell.style.position = "relative";
            cell.style.left = "-5px";
            return { tableIndex: ti, columnIndex: c };
          }
        }
        return null;
      }, [...failing]);
      if (found) {
        const after = await probe(page, "g1");
        const mine = after.failures.filter((f) => f.tableIndex === found!.tableIndex && f.columnIndex === found!.columnIndex);
        expect(mine.map((f) => f.row), formatResult(after, 5)).toEqual([29]);
        return;
      }
    }
    expect(found, "no 50-row table with a right-aligned column G1 passes on /congress/, the member or /signals/").not.toBeNull();
  });

  test("T1.3 G1 @1440: a label trigger with visibility:hidden reads as UNMEASURED, not aligned", async ({ page }) => {
    for (const route of ["/congress/", "/institutional/filers/1135730/", "/signals/", "/institutional/", "/congress/members/M001193/"]) {
      await openRoute(page, route);
      const before = await probe(page, "g1");
      const failing = new Set(before.failures.map(colKey));
      const t = (await numericHeaders(page, "label")).find((h) => !failing.has(`${h.tableIndex}|${h.columnIndex}`));
      if (!t) continue;
      await page.evaluate(({ tableIndex, columnIndex }) => {
        const hr = document.querySelectorAll("table")[tableIndex]!.tHead!;
        const row = hr.rows[hr.rows.length - 1]!;
        let c = 0;
        for (const th of Array.from(row.cells)) {
          if (c === columnIndex) (th.querySelector(".note-label") as HTMLElement).style.visibility = "hidden";
          c += Math.max(1, th.colSpan || 1);
        }
      }, t);
      const after = await probe(page, "g1");
      const k = `${t.tableIndex}|${t.columnIndex}`;
      expect(after.unmeasured.some((f) => colKey(f) === k), formatResult(after, 5)).toBe(true);
      expect(after.failures.some((f) => colKey(f) === k && /UNMEASURED/.test(f.detail)), "a hidden label fails, it is never 'aligned'").toBe(true);
      return;
    }
    throw new Error("no clean right-aligned header with a .note-label on the five routes (label triggers land in M1)");
  });

  /* ---------------------------------------------------------- T1.4 G2 */
  test("T1.4 G2 @1440: .table-scroll{max-height:200px;overflow-y:auto} is DETECTED", async ({ page }) => {
    await openRoute(page, "/congress/");
    const exempt = [...g2Exemptions()];
    const before = await probe(page, "g2", { exempt });
    await page.addStyleTag({ content: ".table-scroll{max-height:200px !important;overflow-y:auto !important}" });
    const fresh = newFindings(before, await probe(page, "g2", { exempt }), (f) => `${f.tableIndex}|${f.el}`);
    expect(fresh.length, "a newly boxed table must be reported").toBeGreaterThan(0);
  });

  test("T1.4 G2 @1440: restoring a 'scroll for more rows' name is DETECTED", async ({ page }) => {
    await openRoute(page, "/congress/");
    const exempt = [...g2Exemptions()];
    const before = await probe(page, "g2", { exempt });
    expect(before.failures.some((f) => /scroll for more rows/i.test(f.detail)), "the M1 page carries no such name").toBe(false);
    await page.evaluate(() => document.querySelector(".table-scroll, table")!.setAttribute("aria-label", "Disclosure feed · scroll for more rows"));
    expect((await probe(page, "g2", { exempt })).failures.some((f) => /scroll for more rows/i.test(f.detail))).toBe(true);
  });

  /* ----------------------------------------------------- T1.5/T1.6 G12 */
  const HIT_CONTROLS = ":is(.note-btn,.th-sort,.seg > button,.chips > button,.mgr-chips > button,.pager-btn,.compact-toggle)";

  test("T1.5 G12 @390: removing the midpoint clip makes a neighbour's centre hit the trigger", async ({ page }) => {
    for (const route of ["/congress/", "/signals/", "/institutional/filers/1135730/", "/institutional/"]) {
      await openRoute(page, route, 390);
      const before = await probe(page, "g12");
      if (before.failures.length !== before.failureCount) continue;
      /* every control's square back to the centred, UNclipped max(box, hit-min) */
      await page.addStyleTag({
        content:
          `${HIT_CONTROLS}{position:relative !important}` +
          `${HIT_CONTROLS}::before{content:"" !important;display:block !important;position:absolute !important;` +
          "left:50% !important;top:50% !important;right:auto !important;bottom:auto !important;margin:0 !important;" +
          "width:max(100%, var(--hit-min)) !important;height:max(100%, var(--hit-min)) !important;" +
          "transform:translate(-50%, -50%) !important;clip-path:none !important}",
      });
      const fresh = newFindings(before, await probe(page, "g12"), elKey);
      if (fresh.some((f) => /neighbour .* centre/.test(f.detail))) return;
    }
    throw new Error("no route where the unclipped squares make a neighbour's centre hit another control (needs M1 hit squares on neighbours closer than 44px)");
  });

  test("T1.6 G12 @390: removing the ::before hit square is DETECTED", async ({ page }) => {
    await openRoute(page, "/congress/", 390);
    const before = await probe(page, "g12");
    await page.addStyleTag({ content: `${HIT_CONTROLS}::before{display:none !important}` });
    const fresh = newFindings(before, await probe(page, "g12"), elKey);
    expect(fresh.some((f) => /corners miss/.test(f.detail)), "a control smaller than 44px loses its target").toBe(true);
  });

  test("T1.6 controlHeights @1440: .seg button{min-height:44px} is DETECTED", async ({ page }) => {
    await openRoute(page, "/congress/");
    const before = await probe(page, "controlHeights");
    expect(before.measured, "the page has segmented items").toBeGreaterThan(0);
    await page.addStyleTag({ content: ".seg button{min-height:44px !important}" });
    const fresh = newFindings(before, await probe(page, "controlHeights"), elKey);
    expect(fresh.some((f) => /24–26/.test(f.detail))).toBe(true);
  });

  /* ------------------------------------------------------------ T1.8 */
  test("T1.8 G4/G5 @1440: injected 8px and 10.2px text, and th::after{content:'x';font-size:8px}, are DETECTED", async ({ page }) => {
    await openRoute(page, "/congress/");
    await page.evaluate(() => document.querySelector("main")!.insertAdjacentHTML(
      "beforeend", '<p><span id="ctl-8" style="font-size:8px">tiny</span> <span id="ctl-102" style="font-size:10.2px">odd</span></p>'));
    const g4 = await probe(page, "g4");
    expect(g4.failures.some((f) => (f.el ?? "").includes("#ctl-8")), "8px under the floor").toBe(true);
    const g5 = await probe(page, "g5");
    expect(g5.failures.some((f) => (f.el ?? "").includes("#ctl-102")), "10.2px is no token").toBe(true);
    const before = await probe(page, "g4");
    await page.addStyleTag({ content: 'th::after{content:"x" !important;font-size:8px !important;display:inline !important}' });
    const fresh = newFindings(before, await probe(page, "g4"), elKey);
    expect(fresh.some((f) => /^th.*::after$/.test(f.el ?? "")), "generated header text under the floor").toBe(true);
  });

  /* ------------------------------------------------------ T1.2 checks */
  test("T1.2 G8 and headFont @1440: a 12px td padding and a 9px th are DETECTED", async ({ page }) => {
    await openRoute(page, "/congress/");
    const g8 = await probe(page, "g8");
    const hf = await probe(page, "headFont");
    await page.addStyleTag({ content: "table td{padding-top:12px !important;padding-bottom:12px !important}th{font-size:9px !important}" });
    expect(newFindings(g8, await probe(page, "g8"), (f) => `${f.tableIndex}|${f.row}`).length, "taller rows").toBeGreaterThan(0);
    expect(newFindings(hf, await probe(page, "headFont"), (f) => `${f.tableIndex}|${f.columnIndex}|${f.detail}`).some((f) => /size 9px/.test(f.detail))).toBe(true);
  });

  test("T1.2 oneFlex @1440: a second c-flex column is DETECTED", async ({ page }) => {
    await openRoute(page, "/congress/");
    const before = await probe(page, "oneFlex");
    const failing = new Set(before.failures.map((f) => f.tableIndex));
    const ti = await page.evaluate((bad) => {
      const tables = Array.from(document.querySelectorAll("table"));
      for (let i = 0; i < tables.length; i++) {
        const t = tables[i]!;
        if (bad.includes(i) || !t.checkVisibility() || !t.matches(".etable, .si-table") || !t.querySelector(".c-flex")) continue;
        const flexCol = Array.from(t.rows[0]!.cells).findIndex((c) => c.classList.contains("c-flex"));
        const other = flexCol === 0 ? 1 : 0;
        for (const r of Array.from(t.rows)) r.cells[other]?.classList.add("c-flex");
        return i;
      }
      return -1;
    }, [...failing].filter((x): x is number => x !== undefined));
    expect(ti, `no table passes oneFlex\n${formatResult(before, 5)}`).toBeGreaterThanOrEqual(0);
    expect((await probe(page, "oneFlex")).failures.some((f) => f.tableIndex === ti && /2 c-flex/.test(f.detail))).toBe(true);
  });

  test("T1.2 G10 @1440: removing c-flex from the filer directory fails the slack check", async ({ page }) => {
    await openRoute(page, "/institutional/");
    const ti = await page.evaluate(() => Array.from(document.querySelectorAll("table")).indexOf(document.querySelector("#inst-managers-section table") as HTMLTableElement));
    expect(ti, "the filer directory table").toBeGreaterThanOrEqual(0);
    const before = await probe(page, "g10");
    expect(before.failures.some((f) => f.tableIndex === ti && /slack/.test(f.detail)), `the directory must pass the slack check first\n${formatResult(before, 5)}`).toBe(false);
    await page.evaluate(() => document.querySelectorAll("#inst-managers-section table .c-flex").forEach((c) => c.classList.remove("c-flex")));
    expect((await probe(page, "g10")).failures.some((f) => f.tableIndex === ti && /slack/.test(f.detail))).toBe(true);
  });

  test("T1.2 G10 @1440: a numeric cell's padding-left:24px fails the gap check", async ({ page }) => {
    await openRoute(page, "/congress/");
    const before = await probe(page, "g10");
    await page.addStyleTag({ content: "td.c-num:not(:first-child){padding-left:24px !important}" });
    const fresh = newFindings(before, await probe(page, "g10"), (f) => `${f.tableIndex}|${f.columnIndex}|${f.detail.slice(0, 20)}`);
    expect(fresh.some((f) => /gap before this column/.test(f.detail))).toBe(true);
  });

  test("T1.2 G10 @1440: a BUY row's edge painted --kind-sell-edge fails the colour check", async ({ page }) => {
    for (const route of ["/congress/", "/congress/members/M001193/", "/congress/tickers/NVDA/"]) {
      await openRoute(page, route);
      const before = await probe(page, "g10");
      const target = await page.evaluate(() => {
        const tr = document.querySelector('tr[data-edge="buy"]') as HTMLTableRowElement | null;
        if (!tr || !tr.checkVisibility()) return null;
        (tr.cells[0] as HTMLElement).style.boxShadow = "inset 3px 0 0 var(--kind-sell-edge)";
        return Array.from(document.querySelectorAll("table")).indexOf(tr.closest("table")!);
      });
      if (target === null) continue;
      const fresh = newFindings(before, await probe(page, "g10"), (f) => `${f.tableIndex}|${f.row}|${f.detail.slice(0, 30)}`);
      expect(fresh.some((f) => f.tableIndex === target && /data-edge="buy" edge is/.test(f.detail)), formatResult(before, 3)).toBe(true);
      return;
    }
    throw new Error('no visible tr[data-edge="buy"] (data-edge lands in M1)');
  });

  test("T1.2 G10 @1440: a band-head control moved 3px down fails the centring check", async ({ page }) => {
    /* /signals/: its Hits band head carries the rule filter, a segmented
       control IN the head (the Congress feed's filters sit in their own strip) */
    await openRoute(page, "/signals/");
    const before = await probe(page, "g10");
    expect(before.notes.join(" "), "a band head with a segmented control is measured").toMatch(/centring [1-9]/);
    await page.addStyleTag({ content: ".panel-head :is(.seg, .chips, .mgr-chips){position:relative !important;top:3px !important}" });
    const fresh = newFindings(before, await probe(page, "g10"), elKey);
    expect(fresh.some((f) => /centre is/.test(f.detail))).toBe(true);
  });

  test("T1.2 metaTruncation @1440: an ellipsized band-head meta is DETECTED", async ({ page }) => {
    await openRoute(page, "/congress/");
    const before = await probe(page, "metaTruncation");
    expect(before.failureCount, formatResult(before)).toBe(0);
    expect(before.measured).toBeGreaterThan(0);
    await page.addStyleTag({ content: ".panel-note{text-overflow:ellipsis;overflow:hidden;white-space:nowrap}" });
    expect((await probe(page, "metaTruncation")).failureCount).toBe(before.measured);
  });

  /* ---------------------------------------------------- G3, G6, G7, G9 */
  test("C-3 G3 @768: a segmented group that cannot wrap pushes /institutional/ sideways, and is DETECTED", async ({ page }) => {
    await openRoute(page, "/institutional/", 768);
    const clean = await probe(page, "g3", { documentOnly: true });
    expect(clean.failureCount, formatResult(clean)).toBe(0);
    await page.addStyleTag({ content: ".mgr-chips{flex-wrap:nowrap !important}" });
    const r = await probe(page, "g3", { documentOnly: true });
    expect(has(r, (f) => f.el === "document"), formatResult(r)).toBe(true);
  });

  test("G3 @1440: FORCE_TABLE_OVERFLOW is DETECTED", async ({ page }) => {
    await openRoute(page, "/institutional/filers/1067983/");
    const before = await probe(page, "g3");
    await page.addStyleTag({ content: FORCE_TABLE_OVERFLOW });
    const fresh = newFindings(before, await probe(page, "g3"), (f) => `${f.el}|${f.tableIndex}`);
    expect(fresh.length, "a container that fit must now report its overflow").toBeGreaterThan(0);
  });

  test("G7 @1440: a c-num cell's text in span{display:inline-block;max-width:10px;overflow:hidden} is DETECTED", async ({ page }) => {
    await openRoute(page, "/congress/");
    const before = await probe(page, "g7");
    const t = await page.evaluate(() => {
      const tables = Array.from(document.querySelectorAll("table"));
      for (const td of Array.from(document.querySelectorAll("td.c-num"))) {
        if (!td.checkVisibility() || !(td.textContent ?? "").trim()) continue;
        const w = document.createTreeWalker(td, NodeFilter.SHOW_TEXT);
        for (let n = w.nextNode(); n; n = w.nextNode()) {
          if (!n.nodeValue!.trim() || n.parentElement!.closest(".visually-hidden, .hang, .note-btn")) continue;
          const span = document.createElement("span");
          span.style.cssText = "display:inline-block;max-width:10px;overflow:hidden;vertical-align:bottom";
          n.parentNode!.insertBefore(span, n);
          span.appendChild(n);
          return tables.indexOf(td.closest("table")!);
        }
      }
      return -1;
    });
    expect(t).toBeGreaterThanOrEqual(0);
    const fresh = newFindings(before, await probe(page, "g7"), (f) => `${f.tableIndex}|${f.columnIndex}|${f.row}`);
    expect(fresh.some((f) => f.tableIndex === t && /clipped by span/.test(f.detail))).toBe(true);
  });

  test("G6 @1440: an all-dash column not listed in data-columns fails; the same column passes once listed", async ({ page }) => {
    await openRoute(page, "/congress/members/M001193/");
    const before = await probe(page, "g6");
    const target = await page.evaluate((bad) => {
      const tables = Array.from(document.querySelectorAll("table"));
      for (let ti = 0; ti < tables.length; ti++) {
        const t = tables[ti]!;
        if (!t.checkVisibility() || !t.tHead || t.tBodies[0]?.rows.length === 0) continue;
        const hr = t.tHead.rows[t.tHead.rows.length - 1]!;
        for (let c = 1; c < hr.cells.length; c++) {
          if (bad.includes(`${ti}|${c}`) || hr.cells[c]!.colSpan !== 1) continue;
          hr.cells[c]!.setAttribute("data-col", "ctl-empty");
          for (const b of Array.from(t.tBodies)) for (const r of Array.from(b.rows)) if (r.cells[c] && r.cells.length === hr.cells.length) r.cells[c]!.textContent = "—";
          return { tableIndex: ti, columnIndex: c };
        }
      }
      return null;
    }, before.failures.map(colKey));
    expect(target).not.toBeNull();
    const after = await probe(page, "g6");
    expect(after.failures.some((f) => colKey(f) === `${target!.tableIndex}|${target!.columnIndex}`), formatResult(after, 5)).toBe(true);
    await page.evaluate(({ tableIndex }) => {
      const t = document.querySelectorAll("table")[tableIndex]!;
      const cur = (t.getAttribute("data-columns") ?? "").split(",").filter(Boolean);
      t.setAttribute("data-columns", [...cur, "ctl-empty"].join(","));
    }, target!);
    const listed = await probe(page, "g6");
    expect(listed.failures.some((f) => colKey(f) === `${target!.tableIndex}|${target!.columnIndex}`), "listed in data-columns, it passes").toBe(false);
    expect(listed.excluded.some((f) => colKey(f) === `${target!.tableIndex}|${target!.columnIndex}`)).toBe(true);
  });

  test("G9 @1440: 300px appended to one cell of a pair is DETECTED", async ({ page }) => {
    await openRoute(page, "/congress/members/M001193/");
    const before = await probe(page, "g9", { expectedPairs: null });
    expect(before.measured, "the member page has a two-cell band").toBeGreaterThan(0);
    const was = new Map(before.failures.map((f) => [f.el, f.delta ?? 0]));
    /* 300px under ONE cell must open the gap by ~300px whichever way the pair
       leans: try the first cell, then the second (grid cells stretch to one
       height, so their boxes cannot say which content ends lower) */
    for (const which of [0, 1]) {
      await page.evaluate((w) => {
        document.getElementById("ctl-g9")?.remove();
        for (const el of Array.from(document.querySelectorAll(".design-band, .design-rankings, .design-pair"))) {
          const cells = Array.from(el.children).filter((c) => c.checkVisibility() && c.getBoundingClientRect().height > 0 && !c.matches(".planned-line"));
          if (cells.length !== 2) continue;
          cells[w]!.insertAdjacentHTML("beforeend", '<p id="ctl-g9" style="margin:0;padding-top:300px">tail</p>');
          return;
        }
      }, which);
      const after = await probe(page, "g9", { expectedPairs: null });
      if (after.failures.some((f) => (f.delta ?? 0) > 96 && (f.delta ?? 0) >= (was.get(f.el) ?? 0) + 290)) return;
    }
    throw new Error(`300px under either cell of the pair did not register\n${formatResult(before)}`);
  });

  /* ------------------------------------------------ T5.2 G11, G11b cue */
  test("T5.2 G11 (light): --ink-label:#bbb is DETECTED on header text", async ({ page }) => {
    await openRoute(page, "/congress/", 1440, "light");
    expect(await themeBackgroundProblem(page, "light")).toBeNull();
    const before = await probe(page, "g11");
    await page.addStyleTag({ content: ':root, [data-theme="light"], html[data-theme="light"]{--ink-label:#bbb !important}' });
    const fresh = newFindings(before, await probe(page, "g11"), elKey);
    expect(fresh.some((f) => /#bbbbbb/.test(f.detail)), "header labels on --ink-label must now fail 4.5:1").toBe(true);
  });

  test("T1.6 G11b: removing the segmented control's active cue is DETECTED", async ({ page }) => {
    await openRoute(page, "/congress/");
    const before = await probe(page, "g11b");
    expect(before.failures.some((f) => /no inset cue/.test(f.detail)), `the active items carry the cue first\n${formatResult(before, 5)}`).toBe(false);
    await page.addStyleTag({ content: ":is(.seg, .chips, .mgr-chips) > *{box-shadow:none !important}" });
    expect((await probe(page, "g11b")).failures.some((f) => /no inset cue/.test(f.detail))).toBe(true);
  });

  /* ------------------------------------------------ T1.10 theme passes */
  test("T1.10: without the init script the LIGHT assertion fails; a light seed fails the DARK one", async ({ browser }, testInfo) => {
    const base = testInfo.project.use.baseURL;
    const bare = await browser.newContext({ baseURL: base });
    const p1 = await bare.newPage();
    await p1.route(/cloudflareinsights\.com/, (r) => r.abort());
    await p1.goto("/");
    expect(await themeBackgroundProblem(p1, "dark"), "the unseeded default is dark").toBeNull();
    expect(await themeBackgroundProblem(p1, "light"), "omitting the init script must FAIL the light assertion").not.toBeNull();
    await bare.close();
    const seeded = await browser.newContext({ baseURL: base });
    await seeded.addInitScript(() => localStorage.setItem("populus:theme", "light"));
    const p2 = await seeded.newPage();
    await p2.route(/cloudflareinsights\.com/, (r) => r.abort());
    await p2.goto("/");
    expect(await themeBackgroundProblem(p2, "light"), "the light seed paints the light page").toBeNull();
    expect(await themeBackgroundProblem(p2, "dark"), "a light seed in a dark pass must FAIL the dark assertion").not.toBeNull();
    await seeded.close();
  });
});
