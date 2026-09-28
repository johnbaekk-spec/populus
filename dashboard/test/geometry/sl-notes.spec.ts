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
import { baseStylesheet } from "../lib/styles.ts";
import { readFileSync } from "node:fs";
import { WIDTHS } from "../../playwright.config.ts";
import { stripTypeScriptTypes } from "node:module";
import { hitMisses } from "./geometry.ts";

/* Wrapped in a function scope: `setContent` keeps the window, so a second
   injection of top-level `const`s into the same page threw "already declared"
   and the clip silently did not run at any width after the first. */
const HIT_AREAS_JS =
  "(function () {\n" +
  stripTypeScriptTypes(readFileSync(new URL("../../src/scripts/hit-areas.ts", import.meta.url), "utf8")).replace(/^export /gm, "") +
  "\ninitHitAreas();\n})();";

/** A surface that renders notes and is cheap to load. */
const CONGRESS = "/congress/";
const HOLDERS_HINT = "/institutional/";

/* L9 (DESIGN-POLISH M1; record in design-principles §7). The hit-test the
   unit tests cannot do: the --hit-min square centred on the trigger — 44px
   under a coarse pointer or at/below 720px, 24px otherwise — clipped at the
   header row's bottom and at the midpoint to any neighbouring control, must
   return the trigger at all four corners (1px inside). At a fine pointer above
   the fold the trigger's own box is at most its text's height + 2px, so the
   hit area never inflates the row it sits in. `hitMisses` is the ONE audit
   G12 runs (geometry.ts; M1 review Q-11), not a copy of it. */

async function firstNote(page: Page) {
  const btn = page.locator(".note-btn:visible").first();
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
    const btn = page.locator(".note-btn:visible").first();
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

/* H-5 (DESIGN-POLISH M1): on paper a mark trigger prints its mark in place
   and a label trigger its label text; only the legacy glyph is hidden; panels
   print in flow. The control injects `.note-mark{display:none}` for print and
   must be caught. */
test("SL-R4 / H-5: under PRINT media panels lay out, marks and labels print, only the glyph is hidden", async ({ page }) => {
  await page.goto(CONGRESS);
  await page.emulateMedia({ media: "print" });
  const pop = page.locator(".note-pop").first();
  const box = await pop.boundingBox();
  expect(box, "a print panel must have a layout box, not merely a CSS rule").not.toBeNull();
  expect(box!.height, "and a non-zero one — hover-only text must reach paper").toBeGreaterThan(0);
  const printState = () =>
    page.evaluate(() => {
      const shown = (sel: string) => Array.from(document.querySelectorAll(sel)).map((el) => getComputedStyle(el).display !== "none");
      return { glyph: shown(".note-btn:not(.note-label):not(.note-mark)"), label: shown(".note-label"), mark: shown(".note-mark") };
    });
  const st = await printState();
  expect(st.label.length + st.mark.length, "the page renders label or mark triggers to print").toBeGreaterThan(0);
  expect(st.glyph.every((v) => !v), "the glyph button does not print").toBe(true);
  expect(st.label.every(Boolean), "a label trigger prints as its text").toBe(true);
  expect(st.mark.every(Boolean), "a mark trigger prints its mark").toBe(true);
  // control: a print rule hiding the mark is caught
  await page.addStyleTag({ content: "@media print { .note-mark, .note-label { display: none !important; } }" });
  const broken = await printState();
  expect([...broken.label, ...broken.mark].some((v) => !v), "control: hidden marks/labels are detected").toBe(true);
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
  test(`SL-R24 / L9: the note triggers on ${surface} hit-test to --hit-min at EVERY swept width`, async ({ page }) => {
    await page.goto(surface);
    if ((await page.locator(".s1-block").count()) > 0) {
      test.skip(true, `${surface} renders the stated-absence page in this build — no table, no note`);
    }
    for (const w of WIDTHS) {
      await page.setViewportSize({ width: w, height: 900 });
      await page.goto(surface);
      expect(await hitMisses(page, ".note-btn"), `${surface} at ${w}px`).toEqual([]);
    }
  });
}

test("SL-R24: under 720px the panel takes the width it needs and is never clipped away", async ({ page }) => {
  // The narrow viewport is where a panel that tries to sit beside its anchor has
  // nowhere to go. Measured, not read off the stylesheet: a rule that exists and
  // a panel that fits are different claims.
  await page.setViewportSize({ width: 360, height: 900 });
  await page.goto(CONGRESS);
  const btn = page.locator(".design-rankings .note-btn").first();
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
  const btn = page.locator(".note-btn:visible").first();
  const id = await btn.getAttribute("popovertarget");
  await btn.click();
  await expect(page.locator(`#${id}`), "a note must still open after its root was replaced").toBeVisible();
});

test("SL-R28: /institutional/ initialises notes too — placement works on a built page", async ({ page }) => {
  await page.goto(HOLDERS_HINT);
  const btn = page.locator(".note-btn:visible").first();
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

    // A small fixture may contain fewer rows than the compact limit. Verify
    // that case explicitly: it must not claim that any rows were withheld.
    let withheld = false;
    for (let i = 0; i < n; i++) {
      const control = controls.nth(i);
      const total = Number(await control.getAttribute("data-compact-total"));
      const shown = Number(await control.getAttribute("data-compact-shown"));
      expect(Number.isFinite(total) && Number.isFinite(shown)).toBe(true);
      if (total > shown) withheld = true;
      else await expect(control.locator(".compact-bound-count")).toBeHidden();
    }

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
    if (!withheld) {
      expect(url, "Congress must exercise the nonempty withheld-row branch").not.toBe(CONGRESS);
      await expect(stated).toHaveCount(0);
      continue;
    }
    expect(
      await stated.count(),
      `${url}: no bound is stated to a reader with scripting off — this is the ` +
        `omission the deleted terminus rows existed to prevent`,
    ).toBeGreaterThan(0);
    await expect(stated.first()).toBeVisible();
    // DESIGN-POLISH M1 (R8): the range grammar, "1–10 of 608 tickers".
    await expect(stated.first()).toHaveText(/^1–\d[\d,]* of (?:the )?\d[\d,]* \S/);
    // R13: the bound is stated in plain words; pipeline vocabulary never reaches the reader.
    await expect(stated.first()).not.toContainText(/render bound/);
  }
  expect(asserted, "at least one in-scope surface was actually measured").toBeGreaterThan(0);

  await ctx.close();
});

test("SL-R10: with JavaScript ON, the bound stands BEFORE the feed arrives", async ({ page }) => {
  /* State (c), the one that survived the `<noscript>` attempt. `syncDisclosure`
     deliberately waits for the full corpus, so for the whole duration of that
     download nothing reveals the ranking control. A `<noscript>` block does not
     render for this reader either.

     R19: the corpus is now the byte-bounded PARTS — `feed.v1.json` is a
     retirement tombstone — so the parts are what must be blocked. Aborting the
     old single asset would abort nothing and this test would pass vacuously
     against a feed that had in fact arrived.

     The wait is made deterministic by never answering the request, which is
     also a faithful stand-in for state (d): an island that loaded and did not
     finish. Either way the reader must be told what is held back. */
  await page.route("**/congress/data/feed/*.v1.json", (route) => route.abort());
  await page.goto(CONGRESS);

  const stated = page.locator(".compact-bound-count:not([hidden])").first();
  await expect(
    stated,
    "scripting is on, the island has run, the dataset has not arrived — and the reader is still told",
  ).toBeVisible();
  // DESIGN-POLISH M1 (R8): the range grammar, in the server's bound noun.
  await expect(stated).toHaveText(/^1–\d[\d,]* of \d[\d,]* ranked \S/);

  /* DESIGN-POLISH M2 (R36, T2.11) changed only the button half: the island
     now syncs at load from the SERVER's total (never the empty row set that
     once retracted the statement), so the control is offered even while the
     dataset never arrives — and its first press reveals exactly the rows the
     server prefetched into the page (R13's first step), with nothing
     downloaded. The statement above still stands on its own. */
  const toggle = page.locator(".compact-toggle").first();
  await expect(toggle, "after load the control is offered, dataset or not (R36)").toBeVisible();
  const table = page.locator(".design-rankings tbody").first();
  const shownBefore = await table.locator("tr:not([hidden]):not(.unranked-sep)").count();
  const prefetched = await table.locator("tr[data-compact-hidden]").count();
  await toggle.click();
  await expect(table.locator("tr:not([hidden]):not(.unranked-sep)")).toHaveCount(shownBefore + prefetched);

  // The remainder — the route to the rows being held back — is stated too.
  await expect(
    page.locator('.compact-bound-extra a[href="/congress/data/"]').first(),
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
    const btn = page.locator(".design-rankings th .note-btn").first();
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

test("CODE-REVIEW F9 / L9: REAL member and filer renderer output hit-tests to --hit-min at every swept width", async ({ page }) => {
  /* Cycle-3 F9. The previous version swept a hand-written table header, which
     the review rightly rejected: a generic fixture cannot see a surface's own
     ancestor styles, button rules, transforms or layout constraints. This
     renders the ACTUAL renderers and sweeps their real anchors.

     It does not serve the routes, because measured, `build:bounded` emits
     exactly one page carrying a note — member and filer are absent from `dist`
     entirely. Renderer-backed fixture pages give the real markup and the real
     stylesheet without expanding the production build, which is what the
     finding asked for. */
  const { filerBody, memberV2Sections } = await import("../../src/lib/ui/index.ts");
  const css = baseStylesheet();

  const CONC = {
    cik: "0001067983", period_of_report: "2026-03-31", position_count: 2,
    total_value_usd: 2300, null_value_positions: 3, topn_value_usd: 2300,
    topn_share_bps: 10000, hhi: 7500, flags: [],
  };
  const DELTA = {
    cik: "0001067983", position_key: "sid:sec:prov:00076fbdb7a2ddaf78c0e89001ecf4f7",
    put_call: "LONG", curr_period: "2026-03-31", prev_period: "2025-12-31",
    change_kind: "trim", prev_value_usd: 1_000_000, curr_value_usd: 400_000,
    delta_value_usd: -600_000, prev_shares: 10, curr_shares: 4, delta_shares: -6,
    ssh_prnamt_type: "SH", flags: [],
  };

  const surfaces: { name: string; html: string }[] = [
    {
      name: "filer",
      html: filerBody(
        { cik: "0001067983", name: "FIXTURE HOLDINGS LLC", latestPeriod: "2026-03-31" } as never,
        ["2025-12-31", "2026-03-31"], "2026-03-31",
        CONC as never, [DELTA] as never, "2026-05-15", 25, null,
      ),
    },
    {
      name: "member",
      html: memberV2Sections(
        {
          name: "Test Member", bioguide: "T000001", party: "R", state: "OK",
          district: "1", chamber: "house", servingSince: "2019-01-03", filingCount: 1, paper: [],
          txns: [{
            txnId: "T-1", bioguide: "T000001", name: "Test Member", party: "R", state: "OK",
            district: "1", chamber: "house", ticker: "AGRO", asset: "Agro Corp", assetType: "ST",
            side: "purchase", traded: "2026-01-15", filed: "2026-02-01", lag: 17, late: false,
            low: 1000, high: 15000, owner: "SP", flags: [], src: null,
          }],
        } as never,
        { buildId: "t.1", generatedAtDate: "2026-08-24" } as never,
        {} as never,
        {
          resolveSector: () => ({ state: "sector", sector: "agriculture" }),
          sectorMeta: { taxonomyVersion: "1", asOf: "2026-08-12" },
          committees: {
            memberships: [], windowFrom: "2025-01-03", windowTo: "2026-08-12",
            jurisdictionByCommittee: new Map(), mappingVersion: "1", snapshotDate: "2026-08-12",
          },
        } as never,
      ),
    },
  ];

  for (const s of surfaces) {
    expect(s.html, `${s.name}: fixture must actually render a note`).toContain("note-btn");
    for (const w of WIDTHS) {
      await page.setViewportSize({ width: w, height: 900 });
      /* The fixture carries the page's midpoint clip (scripts/hit-areas.ts,
         types stripped), room above its first row and the 16px side gutter
         every page has (a control flush with the viewport edge exists on no
         page, and half its square would be off screen). */
      await page.setContent(`<style>${css}</style><body style="padding:48px 16px">${s.html}</body>`);
      await page.addScriptTag({ content: HIT_AREAS_JS });
      const n = await page.locator(".note-btn").count();
      expect(n, `${s.name}: at least one real anchor at ${w}px`).toBeGreaterThan(0);
      // L9: the --hit-min square, hit-tested (hidden anchors inside a closed
      // <details> are skipped by the helper; the print/fold specs cover them).
      expect(await hitMisses(page, ".note-btn"), `${s.name} at ${w}px`).toEqual([]);
    }
  }

  // Static half retained: note sizing lives in ONE stylesheet and no in-scope
  // page restyles it, so no surface-local rule can undercut the sweep above.
  for (const rel of [
    "../../src/pages/congress/index.astro",
    "../../src/pages/congress/members/[bioguide].astro",
    "../../src/pages/institutional/index.astro",
    "../../src/pages/institutional/filers/[cik].astro",
    "../../src/pages/institutional/tickers/[t]/holders.astro",
  ]) {
    const src = readFileSync(new URL(rel, import.meta.url), "utf8");
    for (const block of src.match(/<style\b[\s\S]*?<\/style>/g) ?? []) {
      expect(block, `${rel} must not restyle the note anchor or panel`).not.toMatch(/\.note-btn|\.note-pop|\.note\b/);
    }
  }
});

/* M1 review R-2/C-2. On screen a mark trigger's `.note` wrapper and a hung
   mark are zero-width boxes in the column's slot. In print the panel was laid
   out INSIDE that wrapper, so the zero-width box set it one character per
   line. Property: under print media every mark trigger's panel spans its
   cell's whole content box — at least 200px wherever the cell gives it 200px
   (a narrow numeric header on paper is narrower than that, and the panel then
   takes all of it). Control: the zero-width wrapper restored for print is
   caught. */
test("R-2/C-2: under PRINT media a mark trigger's panel spans its cell (≥ 200px where the cell allows)", async ({ page }) => {
  const squeezed = () =>
    page.evaluate(() =>
      Array.from(document.querySelectorAll(".note:has(> .note-mark) > .note-pop"))
        .map((p) => {
          const cell = p.closest("th, td")!;
          const cs = getComputedStyle(cell);
          const room = cell.getBoundingClientRect().width - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
          return { w: p.getBoundingClientRect().width, want: Math.min(200, room) };
        })
        .filter((x) => x.w > 0)
        .map((x) => ({ w: Math.round(x.w), want: Math.round(x.want), ok: x.w >= x.want - 1 })),
    );
  let wide = 0;
  for (const surface of [HOLDERS_HINT, CONGRESS]) {
    await page.emulateMedia({ media: "screen" });
    await page.goto(surface);
    await page.emulateMedia({ media: "print" });
    const ok = await squeezed();
    expect(ok.length, `${surface} prints mark-trigger panels`).toBeGreaterThan(0);
    expect(ok.filter((x) => !x.ok), `${surface}: every printed mark panel spans its cell (to 200px)`).toEqual([]);
    wide += ok.filter((x) => x.want === 200).length;
  }
  expect(wide, "a mark panel in a cell of 200px or more is measured at 200px").toBeGreaterThan(0);
  // control (on /congress/): the screen's zero-width slot box, forced into print
  await page.addStyleTag({ content: "@media print { :is(th, td) .note:has(> .note-mark), .hang { display: inline-block !important; width: 0 !important; } }" });
  expect((await squeezed()).filter((x) => !x.ok).length, "control: a zero-width wrapper squeezes the panel").toBeGreaterThan(0);
});

/* M1 review R-1. The midpoint clip measured `--hit-min` by appending a probe
   box to <body>; the body's MutationObserver saw the append, scheduled another
   clip, and the page re-measured itself on every animation frame forever.
   Property: once a page settles, the clip schedules no further frames. It is
   measured on a renderer-backed fixture that runs the module's own source, so
   the frames counted are the clip's; the control runs the pre-fix probe (and
   no record-draining) and must keep scheduling. */
test("R-1: an idle page schedules no further clip frames once it settles", async ({ page }) => {
  const { filerBody } = await import("../../src/lib/ui/index.ts");
  const html = filerBody(
    { cik: "0001067983", name: "FIXTURE HOLDINGS LLC", latestPeriod: "2026-03-31" } as never,
    ["2025-12-31", "2026-03-31"], "2026-03-31",
    { cik: "0001067983", period_of_report: "2026-03-31", position_count: 2, total_value_usd: 2300, null_value_positions: 0, topn_value_usd: 2300, topn_share_bps: 10000, hhi: 7500, flags: [] } as never,
    [] as never, "2026-05-15", 25, null,
  );
  /** Frames whose callback runs the clip, counted over two settled seconds. */
  const clipFrames = async (source: string): Promise<[number, number]> => {
    await page.setContent(`<style>${baseStylesheet()}</style><body style="padding:48px 16px">${html}</body>`);
    await page.evaluate(() => {
      const w = window as unknown as { __clipFrames: number };
      w.__clipFrames = 0;
      const raf = window.requestAnimationFrame.bind(window);
      window.requestAnimationFrame = (f: FrameRequestCallback) => {
        if (/clipHitAreas|run\(\)/.test(String(f))) w.__clipFrames++;
        return raf(f);
      };
    });
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.addScriptTag({ content: source });
    await page.waitForTimeout(1000);
    expect(errors, "the injected clip runs without error").toEqual([]);
    const a = await page.evaluate(() => (window as unknown as { __clipFrames: number }).__clipFrames);
    await page.waitForTimeout(1000);
    const b = await page.evaluate(() => (window as unknown as { __clipFrames: number }).__clipFrames);
    return [a, b];
  };
  const [a, b] = await clipFrames(HIT_AREAS_JS);
  expect(a, "the counter sees the clip's own frames (fonts, load)").toBeGreaterThan(0);
  expect(b - a, `after settling, the clip scheduled ${b - a} more frames in a second`).toBe(0);
  // control: the pre-fix probe, with the run's own records left to fire
  const PRE_FIX = HIT_AREAS_JS
    .replace(/function hitMin\(\)[\s\S]*?\n}\n/, `function hitMin() {
  const probe = document.createElement("div");
  probe.style.cssText = "position:absolute;visibility:hidden;pointer-events:none;width:var(--hit-min);height:0";
  document.body.append(probe);
  const w = probe.getBoundingClientRect().width;
  probe.remove();
  return w > 0 ? w : 24;
}
`)
    .replace("observer?.takeRecords();", "");
  expect(PRE_FIX, "the control really swapped the probe in").toContain("document.body.append(probe)");
  const [c, d] = await clipFrames(PRE_FIX);
  expect(d - c, "control: the pre-fix clip keeps re-running every frame").toBeGreaterThan(10);
});
