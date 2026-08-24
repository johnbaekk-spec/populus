/* RUN SURFACES-LEGIBILITY — the note primitive verified by a REAL browser.

   CODE-REVIEW F4. Every other test this run added can only see markup or CSS
   text, and a rule that EXISTS is not the claim being made. R2/R3/R4/R27/R28
   are all defined against rendered behaviour precisely because their failure
   modes are invisible to markup assertions: a panel can be in the DOM and
   unreachable, a print rule can exist and lay nothing out, an `@supports` block
   can be authored and never entered, and `initNotes()` can ship unimported —
   which it did, and unit tests could not see it.

   Chromium-only, like the rest of this harness. That is exactly why R27 exists:
   Chromium HAS `popover`, so `@supports not selector(:popover-open)` can never
   be entered here. `.force-note-fallback` is the seam, and a unit test asserts
   the seam's declarations are byte-identical to the real fallback's. */

import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { WIDTHS } from "../../playwright.config.ts";

/** A surface that renders notes and is cheap to load. */
const CONGRESS = "/congress/";
const HOLDERS_HINT = "/institutional/";

async function firstNote(page: Page) {
  const btn = page.locator(".note-btn").first();
  await expect(btn, "the page under test must render at least one note").toBeVisible();
  return btn;
}

test.describe("SL-R2/R3: the panel opens, and opens WITHOUT JavaScript", () => {
  test("scripted: activating a note opens its panel and anchors it near the button", async ({ page }) => {
    await page.goto(CONGRESS);
    const btn = await firstNote(page);
    const id = await btn.getAttribute("popovertarget");
    const pop = page.locator(`#${id}`);

    await btn.click();
    await expect(pop).toBeVisible();

    // Anchored, not parked at the CSS default. place() clears `translate` and
    // sets real coordinates; the default rule centres. Assert the panel is
    // vertically near its button rather than mid-viewport.
    const b = (await btn.boundingBox())!;
    const p = (await pop.boundingBox())!;
    const gap = Math.min(Math.abs(p.y - (b.y + b.height)), Math.abs(b.y - (p.y + p.height)));
    expect(gap, "an initialised panel sits beside its anchor, not at the viewport default").toBeLessThan(40);
  });

  test("SL-R2: with JavaScript DISABLED the button still opens the panel", async ({ browser }) => {
    // `popovertarget` is the declarative association. If this fails, the note
    // is a JS-only channel and every no-script reader loses the explanation —
    // the §7 failure the whole primitive exists to avoid.
    const ctx = await browser.newContext({ javaScriptEnabled: false });
    const page = await ctx.newPage();
    await page.goto(CONGRESS);
    const btn = page.locator(".note-btn").first();
    await expect(btn).toBeVisible();
    const id = await btn.getAttribute("popovertarget");
    await btn.click();
    await expect(page.locator(`#${id}`), "popovertarget must open the panel with no script running").toBeVisible();
    await ctx.close();
  });
});

/* CODE-REVIEW F4: the fallback's contract is `:hover` AND `:focus-within` —
   R3 names both, and they are two different CSS selectors in the same block.
   Testing hover alone leaves the keyboard channel unexercised on the very
   engine class that has no `popover` at all, which is the one place a reader
   cannot fall back to clicking. Both are asserted, in one no-script context,
   and each from a genuinely closed start state. */
for (const channel of ["hover", "focus"] as const) {
  test(`SL-R27: the forced fallback opens on ${channel}, with no script`, async ({ browser }) => {
    const ctx = await browser.newContext({ javaScriptEnabled: false });
    const page = await ctx.newPage();
    await page.goto(CONGRESS);
    // The seam stands in for an engine without `popover`; Chromium can never
    // enter the real @supports block. `evaluate` runs even with
    // `javaScriptEnabled: false` — it is injected by the driver, not the page.
    await page.evaluate(() => document.documentElement.classList.add("force-note-fallback"));
    const note = page.locator(".note").first();
    const pop = note.locator(".note-pop");
    await expect(pop, "the panel starts closed").toBeHidden();

    if (channel === "hover") {
      await note.hover();
    } else {
      // Keyboard only: move the pointer well away first, so a stray hover
      // cannot be what opens the panel and make this test a duplicate of the
      // one above.
      await page.mouse.move(0, 0);
      await note.locator(".note-btn").focus();
    }

    await expect(pop, `the CSS-only fallback opens on ${channel}`).toBeVisible();
    const box = await pop.boundingBox();
    expect(box, "and it lays out — a visible panel with no box is not a channel").not.toBeNull();
    expect(box!.height).toBeGreaterThan(0);
    await ctx.close();
  });
}

test("SL-R4: under PRINT media every panel lays out with a real box and the anchor is hidden", async ({ page }) => {
  await page.goto(CONGRESS);
  await page.emulateMedia({ media: "print" });
  const pop = page.locator(".note-pop").first();
  const box = await pop.boundingBox();
  expect(box, "a print panel must have a layout box, not merely a CSS rule").not.toBeNull();
  expect(box!.height, "and a non-zero one — hover-only text must reach paper").toBeGreaterThan(0);
  const btnDisplay = await page.locator(".note-btn").first().evaluate((el) => getComputedStyle(el).display);
  expect(btnDisplay, "the anchor button does not print").toBe("none");
});

/* SL-R24 / T12. A representative anchor PER SURFACE, at EVERY swept width —
   plan-v1 measured 375px on one page, and 375px is not even one of the five
   widths this harness sweeps.

   WHAT THIS LANE CAN AND CANNOT REACH, stated rather than papered over. The
   member and filer routes are not in the bounded `dist` at all, and
   `/institutional/` renders `s1ModuleAbsent` — the stated-absence page, with no
   tables and therefore no notes — whenever the build carries no institutional
   aggregate, which is the case in a data-free checkout. The holders route has
   its own lane and its own touch-target check.

   `/congress/` is therefore swept unconditionally and `/institutional/` when
   its module is present. That is not as weak as it sounds: `.note-btn` has ONE
   rule in one stylesheet, so a width at which it shrank would shrink it on
   every surface at once. What a second surface adds is proof that no LOCAL rule
   overrides it, and the sweep takes it whenever the build offers it. */
for (const surface of [CONGRESS, HOLDERS_HINT] as const) {
  test(`SL-R24: the anchor on ${surface} is a >=44px target at EVERY swept width`, async ({ page }) => {
    await page.goto(surface);
    if ((await page.locator(".s1-block").count()) > 0) {
      test.skip(true, `${surface} renders the stated-absence page in this build — no table, no note`);
    }
    for (const w of WIDTHS) {
      await page.setViewportSize({ width: w, height: 900 });
      await page.goto(surface);
      const btn = page.locator(".note-btn").first();
      expect(await btn.count(), `${surface} must render a note anchor to measure`).toBeGreaterThan(0);
      const box = (await btn.boundingBox())!;
      expect(Math.min(box.width, box.height), `44px target at ${w}px on ${surface}`).toBeGreaterThanOrEqual(44);
    }
  });
}

test("SL-R24: under 720px the panel takes the width it needs and is never clipped away", async ({ page }) => {
  // The narrow viewport is where a panel that tries to sit beside its anchor has
  // nowhere to go. Measured, not read off the stylesheet: a rule that exists and
  // a panel that fits are different claims.
  await page.setViewportSize({ width: 360, height: 900 });
  await page.goto(CONGRESS);
  const btn = page.locator(".note-btn").first();
  await btn.click();
  const pop = page.locator(`#${await btn.getAttribute("popovertarget")}`);
  await expect(pop).toBeVisible();
  const box = (await pop.boundingBox())!;
  expect(box.width, "the panel uses the narrow viewport rather than shrinking into a column").toBeGreaterThan(240);
  expect(box.x, "…and starts on screen").toBeGreaterThanOrEqual(0);
  expect(box.x + box.width, "…and ends on screen").toBeLessThanOrEqual(360);
});

test("SL-R28: a note created by a LATER innerHTML replacement still opens", async ({ page }) => {
  // Binding is delegated on `document` precisely because five roots replace
  // their contents after page setup. A per-element binder passes every unit
  // test and dies on the first sort.
  await page.goto(CONGRESS);
  const th = page.locator("th [data-congress-sort], th.th-sort, th button.th-sort").first();
  if ((await th.count()) === 0) test.skip(true, "no sortable header on this surface");
  await th.click(); // repaints the tbody, and any notes inside it
  const btn = page.locator(".note-btn").first();
  const id = await btn.getAttribute("popovertarget");
  await btn.click();
  await expect(page.locator(`#${id}`), "a note must still open after its root was replaced").toBeVisible();
});

test("SL-R28: /institutional/ initialises notes too — placement works on a built page", async ({ page }) => {
  await page.goto(HOLDERS_HINT);
  const btn = page.locator(".note-btn").first();
  if ((await btn.count()) === 0) test.skip(true, "no note on this surface");
  const id = await btn.getAttribute("popovertarget");
  await btn.click();
  const pop = page.locator(`#${id}`);
  await expect(pop).toBeVisible();
  const translate = await pop.evaluate((el) => getComputedStyle(el).translate);
  expect(translate, "an initialised page clears the centring default").not.toContain("-50%");
});

test("CODE-REVIEW F1: a CANCELLED press does not disable hover and focus page-wide", async ({ page }) => {
  // `pointerActive` stands the hover/focus channels down between pointerdown
  // and click so `popovertarget`'s toggle owns the transition. Cleared only on
  // a completed note click, a press that never became one — drag away, scroll,
  // cancelled touch — left it set for the page's lifetime and killed both
  // channels on every note. A latch that only opens on the happy path is a
  // latch that stays shut.
  await page.goto(CONGRESS);
  const btn = await firstNote(page);
  const box = (await btn.boundingBox())!;

  // Press on the note, then release far away: no click lands on the button.
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + 400, box.y + 400);
  await page.mouse.up();

  // Hover must still work afterwards.
  const id = await btn.getAttribute("popovertarget");
  await btn.hover();
  await expect(
    page.locator(`#${id}`),
    "hover must survive an abandoned press — the latch has to release on pointerup too",
  ).toBeVisible();
});

/* SL-R10, put to a real browser. The requirement asked for five terminus rows
   to be deleted because "an adjacent compactDisclosure states the same count",
   and that claim was FALSE in three states — scripting off, scripting on before
   the island syncs, and scripting on with an island that returned early. It was
   blocked twice on exactly that, and unblocked by making the claim true: the
   bound is now a server-rendered visible element inside the control, and only
   the button waits for a script.

   These are the proofs of the fixed property, in the only place that can give
   them. `hidden` is an attribute a unit test can read, but what matters is that
   the reader is SHOWN the bound and not shown an inert button, and only an
   engine can say that. */
test("SL-R10: with JavaScript disabled the bound is STATED and the button is invisible", async ({
  browser,
}) => {
  const ctx = await browser.newContext({ javaScriptEnabled: false });
  const page = await ctx.newPage();

  /* Both in-scope surfaces are visited, and each is asserted only if this
     build actually ships it: `build:bounded` may render `/institutional/` as a
     stated absence ("the institutional 13F module is not in this build"), which
     is itself honest and has no compact table to bound. Skipping a surface that
     is not there is right; skipping one that IS there would hide the failure
     this spec exists to catch, so the presence check is per surface and the
     congress page — always present — is asserted unconditionally. */
  let asserted = 0;
  for (const url of [CONGRESS, HOLDERS_HINT]) {
    await page.goto(url);

    const controls = page.locator(".compact-disclosure");
    const n = await controls.count();
    if (n === 0) {
      expect(url, "the congress page always ships compact tables").not.toBe(CONGRESS);
      continue;
    }
    asserted++;

    // Not one expand button may be visible: with no script running it cannot
    // work, and a control that cannot work must not be presented as one.
    for (let i = 0; i < (await page.locator(".compact-toggle").count()); i++) {
      await expect(
        page.locator(".compact-toggle").nth(i),
        "an inert control is worse than no control",
      ).toBeHidden();
    }

    // …and the bound is on the page anyway, in real text, rendered by the
    // server. This is the assertion the deletion had to earn.
    const stated = page.locator(".compact-bound-count:not([hidden])");
    expect(
      await stated.count(),
      `${url}: no bound is stated to a reader with scripting off — this is the ` +
        `omission the deleted terminus rows existed to prevent`,
    ).toBeGreaterThan(0);
    await expect(stated.first()).toBeVisible();
    await expect(stated.first()).toContainText(/not rendered above|Showing the first/);
    await expect(stated.first()).toContainText(/Public Filings render bound/);
  }
  expect(asserted, "at least one in-scope surface was actually measured").toBeGreaterThan(0);

  await ctx.close();
});

test("SL-R10: with JavaScript ON, the bound stands BEFORE the feed arrives", async ({ page }) => {
  /* State (c), the one that survived the `<noscript>` attempt. `syncDisclosure`
     deliberately waits for `feed.v1.json` (F25) — 22 MB in production — so for
     the whole duration of that download nothing reveals the ranking control. A
     `<noscript>` block does not render for this reader either.

     The wait is made deterministic by never answering the request, which is
     also a faithful stand-in for state (d): an island that loaded and did not
     finish. Either way the reader must be told what is held back. */
  await page.route("**/congress/data/feed.v1.json", (route) => route.abort());
  await page.goto(CONGRESS);

  const stated = page.locator(".compact-bound-count:not([hidden])").first();
  await expect(
    stated,
    "scripting is on, the island has run, the dataset has not arrived — and the reader is still told",
  ).toBeVisible();
  await expect(stated).toContainText(/further ranked .* are not rendered above/);

  // The button is what waits, and it is still waiting.
  await expect(
    page.locator(".compact-toggle").first(),
    "nothing has revealed the control yet, which is exactly why the statement may not live on it",
  ).toBeHidden();

  // The remainder — the route to the rows being held back — is stated too.
  await expect(
    page.locator('.compact-bound-extra a[href="/congress/data/feed.v1.json"]').first(),
  ).toBeVisible();
});

test("CODE-REVIEW F8: a header note WRAPS and stays inside its panel at every width", async ({ page }) => {
  // The panel is written inside a <th>, and CSS inheritance follows the DOM
  // tree — so it inherited `.etable th`'s nowrap/uppercase/letter-spacing and
  // long footnote prose ran off one line. Visibility and anchor-distance are
  // both TRUE of an overflowing line, which is why the earlier specs passed.
  for (const w of WIDTHS) {
    await page.setViewportSize({ width: w, height: 900 });
    await page.goto(CONGRESS);
    const btn = page.locator("th .note-btn").first();
    if ((await btn.count()) === 0) continue;
    const id = await btn.getAttribute("popovertarget");
    await btn.click();
    const pop = page.locator(`#${id}`);
    await expect(pop).toBeVisible();

    const m = await pop.evaluate((el) => {
      const cs = getComputedStyle(el);
      return {
        whiteSpace: cs.whiteSpace,
        transform: cs.textTransform,
        scrollW: el.scrollWidth,
        clientW: el.clientWidth,
        right: el.getBoundingClientRect().right,
        left: el.getBoundingClientRect().left,
      };
    });
    expect(m.whiteSpace, `wraps at ${w}px`).not.toBe("nowrap");
    expect(m.transform, `not uppercased at ${w}px`).toBe("none");
    expect(m.scrollW, `no horizontal overflow inside the panel at ${w}px`).toBeLessThanOrEqual(m.clientW + 1);
    expect(m.left, `panel starts inside the viewport at ${w}px`).toBeGreaterThanOrEqual(0);
    expect(m.right, `panel ends inside the viewport at ${w}px`).toBeLessThanOrEqual(w);
  }
});

/* ── CODE-REVIEW cycle-2 F9 ──────────────────────────────────────────────────
   R24 wants a representative anchor on EACH in-scope surface swept at every
   width. The review asked for served member and filer routes; measured, the
   bounded build emits neither — `dist` contains exactly one page carrying a
   note (`/congress/index.html`). Member, filer and holders routes are absent
   from it entirely, so that lane cannot reach them and pretending otherwise
   would be a green test measuring nothing.

   What CAN be closed is the stated RISK: "a page-local rule or layout context
   can shrink note targets on member or filer pages". Two assertions do that
   together — one static, one rendered. Recorded here rather than skipped
   silently, because a skipped requirement that looks covered is worse than an
   uncovered one that says so. */

test("CODE-REVIEW F9: no page-local rule can shrink a note target on ANY in-scope surface", async ({ page }) => {
  // (1) Static: note sizing exists in exactly one stylesheet, and none of the
  // five surfaces adds a page-local <style>. A page-local override is the
  // mechanism the finding names, so its absence is the thing to assert.
  const roots = [
    "../../src/pages/congress/index.astro",
    "../../src/pages/congress/members/[bioguide].astro",
    "../../src/pages/institutional/index.astro",
    "../../src/pages/institutional/filers/[cik].astro",
    "../../src/pages/institutional/tickers/[t]/holders.astro",
  ];
  for (const rel of roots) {
    const src = readFileSync(new URL(rel, import.meta.url), "utf8");
    /* A page-local <style> is legitimate — /congress/ has one. What must not
       exist is a page-local rule touching the NOTE, since that is the only way
       a surface-specific override could shrink the target below 44px. So scan
       the style blocks themselves rather than banning them. */
    for (const block of src.match(/<style\b[\s\S]*?<\/style>/g) ?? []) {
      expect(block, `${rel} must not restyle the note anchor or panel`).not.toMatch(/\.note-btn|\.note-pop|\.note\b/);
    }
  }

  // (2) Rendered: the shared rule really does yield >=44px for the markup those
  // surfaces emit, at every swept width — measured in a real engine against the
  // real stylesheet, not inferred from the CSS text.
  const css = readFileSync(new URL("../../src/styles/global.css", import.meta.url), "utf8");
  const markup = `<table class="etable"><thead><tr><th scope="col">Net disclosed flow
      <span class="note"><button type="button" class="note-btn" popovertarget="p" aria-label="explain">i</button>
      <span class="note-pop" popover id="p">clause</span></span></th></tr></thead></table>`;
  for (const w of WIDTHS) {
    await page.setViewportSize({ width: w, height: 900 });
    await page.setContent(`<style>${css}</style><body>${markup}</body>`);
    const box = (await page.locator(".note-btn").boundingBox())!;
    expect(Math.min(box.width, box.height), `44px target at ${w}px on member/filer header markup`).toBeGreaterThanOrEqual(44);
  }
});
