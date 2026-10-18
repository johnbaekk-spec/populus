/* signals-v4 M1 — the Congress surface, measured in a real engine on the
   built page (T1.2, T1.4, T1.5, T1.6, T1.7; success criteria 3 and 4).

   Every alignment reads ONE endpoint, the content bottom: the largest bottom
   among an element's visible in-flow children (scripts/column-fit.ts, LD6) —
   never a grid cell's box. `.si-side` (the hits' column) is measured against
   `#triage` (Filings to read). Each check carries a control that fails it. */

import { test, expect, type Browser, type Page, type TestInfo } from "@playwright/test";
import { hitMisses } from "./geometry.ts";

const PHONES = [320, 360, 375, 390, 414, 430] as const;
/** codex M1 round 1, F1: R2 holds at EVERY width above the fold — the
    stacked band (721, 900), the split band's narrowest width (1081), an
    intermediate desktop (1200) and the comfortable one (1440). */
const DESKTOPS = [721, 900, 1081, 1200, 1440] as const;
/** The three tiers whose rows are read (Routine is opened first). */
const TIERS = "#stands article.si-row, #look article.si-row, #routine article.si-row";

async function open(browser: Browser, testInfo: TestInfo, width: number, opts: { js?: boolean } = {}) {
  const ctx = await browser.newContext({
    baseURL: testInfo.project.use.baseURL,
    viewport: { width, height: width > 720 ? 900 : 844 },
    javaScriptEnabled: opts.js !== false,
  });
  await ctx.route(/cloudflareinsights\.com/, (r) => r.abort());
  const page = await ctx.newPage();
  expect((await page.goto("/signals/", { waitUntil: "load" }))?.status()).toBe(200);
  await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => undefined);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(150);
  return { ctx, page };
}

test.beforeEach(({}, testInfo) => {
  test.skip(!!testInfo.project.use.hasTouch, "fine-pointer layout properties");
});

/* ---------------------------------------------------------------- LD6: the fit */

interface FitState {
  refEnd: number;
  colEnd: number;
  shown: number;
  held: number;
  lines: number;
  /** the column's content bottom with the NEXT matching row revealed, or null when none is held */
  nextEnd: number | null;
  rowH: number;
}

/** The fit's state, read with the page's own contentBottom definition. */
function fitState(page: Page): Promise<FitState> {
  return page.evaluate(() => {
    const cb = (el: Element): number => {
      let m = -Infinity;
      for (const c of Array.from(el.children)) {
        /* the production contentBottom's own test (column-fit.ts): display,
           not visibility — a visibility:hidden child still takes its space */
        if ((c as HTMLElement).hidden || !c.checkVisibility()) continue;
        const p = getComputedStyle(c).position;
        if (p === "absolute" || p === "fixed") continue;
        m = Math.max(m, c.getBoundingClientRect().bottom);
      }
      return m;
    };
    const ref = document.getElementById("triage")!;
    const col = document.getElementById("signals-side")!;
    const rows = Array.from(document.querySelectorAll<HTMLElement>("#signal-hits-body > tr.si-hit"));
    const shown = rows.filter((r) => !r.hidden).length;
    const next = rows[shown] ?? null;
    let nextEnd: number | null = null;
    if (next) {
      next.hidden = false;
      nextEnd = cb(col);
      next.hidden = true;
    }
    const vis = rows.filter((r) => !r.hidden).slice(0, 8).map((r) => r.getBoundingClientRect().height).sort((a, b) => a - b);
    return {
      refEnd: cb(ref),
      colEnd: cb(col),
      shown,
      held: rows.length,
      lines: Number(document.getElementById("hits")!.getAttribute("data-lines")),
      nextEnd,
      rowH: vis[Math.floor(vis.length / 2)] ?? 0,
    };
  });
}

/** Success criterion 3: the column ends at or above the reference (+1px), and
    revealing one more matching row would pass it — or the stated exception
    (the list at its minimum because the reference is shorter). */
function expectAligned(s: FitState, label: string): boolean {
  if (s.shown <= 10 && s.colEnd > s.refEnd + 1) {
    // the stated exception: the reference is shorter than the minimum list (10 hits) — no alignment claimed
    test.info().annotations.push({ type: "LD6", description: `${label}: the reference is shorter than the minimum list` });
    return false;
  }
  expect(s.colEnd, `${label}: the hits column ends at or above Filings to read (+1px)`).toBeLessThanOrEqual(s.refEnd + 1);
  if (s.shown < s.lines) {
    expect(s.nextEnd, `${label}: the next matching row is held, so its effect is measured`).not.toBeNull();
    expect(s.nextEnd!, `${label}: revealing one more row would pass the reference`).toBeGreaterThan(s.refEnd + 1);
  }
  if (s.shown < s.lines) expect(s.refEnd - s.colEnd, `${label}: the gap is under one row`).toBeLessThan(Math.max(s.rowH, 1) + 1);
  return true;
}

test("T1.6 (LD6, criterion 3) @1440: the hits fill to the height of Filings to read — at load, after a row opens, after Routine opens, after a family filter; Show 10 more extends by 10 and the next filter change restores the fit; a stretched band changes nothing", async ({ browser }, testInfo) => {
  const { ctx, page } = await open(browser, testInfo, 1440);
  try {
    const load = await fitState(page);
    const claimed: boolean[] = [expectAligned(load, "at load")];
    // control: one extra row breaks the claim
    await page.evaluate(() => {
      const rows = Array.from(document.querySelectorAll<HTMLElement>("#signal-hits-body > tr.si-hit"));
      rows.find((r) => r.hidden)!.hidden = false;
    });
    const over = await fitState(page);
    expect(over.colEnd, "control: one more row ends past the reference").toBeGreaterThan(over.refEnd + 1);
    await page.reload();
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(150);
    // a row opens (the 3rd)
    await page.locator("#triage summary.si-row-sum").nth(2).click();
    await page.waitForTimeout(150);
    claimed.push(expectAligned(await fitState(page), "after the 3rd row opens"));
    // Routine opens
    await page.locator("#routine > summary").click();
    await page.waitForTimeout(400);
    const routine = await fitState(page);
    claimed.push(expectAligned(routine, "after Routine opens"));
    expect(routine.shown, "with Routine open the fit reveals more than the server's ten").toBeGreaterThan(10);
    // a family filter whose matching lines exceed the base
    const fam = await page.evaluate(() => {
      const shown = document.querySelectorAll("#signal-hits-body > tr.si-hit:not([hidden])").length;
      const btns = Array.from(document.querySelectorAll<HTMLButtonElement>("#families button[data-family]"));
      const hits = (b: HTMLElement) => Number((b.querySelector(".si-rate-val .visually-hidden")?.textContent ?? "").replace(/[^\d]/g, ""));
      return btns.map((b) => ({ f: b.dataset.family!, n: hits(b) })).sort((a, b) => b.n - a.n).find((x) => x.n > shown + 5)?.f ?? null;
    });
    expect(fam, "a family whose hits exceed the fitted base").not.toBeNull();
    await page.locator(`#families button[data-family="${fam}"]`).click();
    await page.waitForFunction(() => document.getElementById("signal-family-pill-row")!.hidden === false);
    await page.waitForTimeout(400);
    const filtered = await fitState(page);
    expect(filtered.lines, "the filter's matching lines exceed the base").toBeGreaterThan(filtered.shown);
    claimed.push(expectAligned(filtered, "after a family filter"));
    // Show 10 more: base + 10, past the reference by design
    await page.locator("#signal-hits-more").click();
    await page.waitForTimeout(400);
    const more = await fitState(page);
    expect(more.shown, "Show 10 more extends the fitted base by 10").toBe(Math.min(filtered.shown + 10, filtered.lines));
    // the next filter change drops the extension and restores the fit
    await page.locator("#signal-family-pill").click();
    await page.waitForTimeout(500);
    claimed.push(expectAligned(await fitState(page), "after the next filter change"));
    // the control the plan names: re-plant align-items: stretch — the fit and the assertion are unchanged
    const before = await fitState(page);
    await page.addStyleTag({ content: ".design-signals-band { align-items: stretch !important; }" });
    await page.waitForTimeout(400);
    const stretched = await fitState(page);
    expect(stretched.shown, "a stretched band does not change the fit").toBe(before.shown);
    claimed.push(expectAligned(stretched, "with the band's cells stretched"));
    expect(claimed.filter(Boolean).length, "the alignment is claimed (and held) in most states, never vacuously").toBeGreaterThanOrEqual(3);
  } finally {
    await ctx.close();
  }
});

/* ---------------------------------------------------------------- R2 / R3: rows */

/** Line boxes per collapsed row: the distinct vertical bands the summary's
    visible text runs occupy (the meters, whose label rides above its bars on
    a phone, are read as one box). */
function rowLines(page: Page, sel: string): Promise<{ id: string; lines: number; whoLines: number; amtLines: number; who: string }[]> {
  return page.evaluate((s) => {
    const out: { id: string; lines: number; whoLines: number; amtLines: number; who: string }[] = [];
    const bands = (boxes: { t: number; b: number }[]): number => {
      boxes.sort((x, y) => x.t - y.t);
      let n = 0;
      let bottom = -Infinity;
      for (const bx of boxes) {
        if (bx.t >= bottom - 3) {
          n++;
          bottom = bx.b;
        } else bottom = Math.max(bottom, bx.b);
      }
      return n;
    };
    for (const a of Array.from(document.querySelectorAll<HTMLElement>(s))) {
      if (!a.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) continue;
      const sum = a.querySelector("summary")!;
      const textBoxes = (root: Element): { t: number; b: number }[] => {
        const boxes: { t: number; b: number }[] = [];
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        for (let n = walker.nextNode(); n; n = walker.nextNode()) {
          const p = n.parentElement!;
          if (!n.textContent!.trim() || p.closest(".si-meters, .visually-hidden, [aria-hidden=true]")) continue;
          const r = document.createRange();
          r.selectNodeContents(n);
          for (const q of Array.from(r.getClientRects())) if (q.width > 0 && q.height > 0) boxes.push({ t: q.top, b: q.bottom });
        }
        return boxes;
      };
      const boxes = textBoxes(sum);
      const m = sum.querySelector(".si-meters")!.getBoundingClientRect();
      boxes.push({ t: m.top, b: m.bottom });
      const who = sum.querySelector(".si-row-who") as HTMLElement;
      const amt = sum.querySelector(".si-row-amt") as HTMLElement;
      out.push({ id: a.id, lines: bands(boxes), whoLines: bands(textBoxes(who)), amtLines: bands(textBoxes(amt)), who: who.innerText.replace(/\s+/g, " ").trim() });
    }
    return out;
  }, sel);
}

interface RowCheck {
  /** article.si-row rendered in the tiers read */
  expected: number;
  /** rows actually inspected (each must be rendered: a hidden row is a problem, never a skip) */
  checked: number;
  problems: string[];
}

/** Every collapsed row of the three tiers, inspected — never sampled:
    - the row itself is rendered (a hidden row is reported, never skipped);
    - each honesty field — the filed and traded dates, the lag, the owner, the
      range, the receipt, every LATE tag — and the filer cell's other fixed
      parts (party and state, the group tag, ×N, a cluster's member count) is
      rendered, CSS-visible (`checkVisibility` with `checkVisibilityCSS` and
      `checkOpacity`, computed `visibility` not hidden, `opacity` > 0), on
      screen, not cut by its own box and not clipped by any ancestor;
    - with `lines` (above the fold, R2): the summary is exactly two line boxes,
      read twice — the distinct bands its visible text runs occupy, and its
      height against two of its tallest line heights plus the row gap and
      padding — and a filer's name keeps at least a few letters. */
function rowHonesty(page: Page, opts: { lines?: boolean } = {}): Promise<RowCheck> {
  return page.evaluate(({ tiers, lines }) => {
    const problems: string[] = [];
    const vw = innerWidth;
    const VIS = { checkOpacity: true, checkVisibilityCSS: true } as const;
    const hiddenWhy = (e: Element): string | null => {
      const q = e.getBoundingClientRect();
      if (q.width < 1 || q.height < 1 || !e.checkVisibility(VIS)) return "not rendered";
      const cs = getComputedStyle(e);
      if (cs.visibility === "hidden" || cs.visibility === "collapse") return `visibility: ${cs.visibility}`;
      if (!(Number(cs.opacity) > 0)) return "opacity 0";
      return null;
    };
    const clipped = (e: Element): string | null => {
      const h = hiddenWhy(e);
      if (h) return h;
      const q = e.getBoundingClientRect();
      if (q.left < -0.5 || q.right > vw + 0.5) return "off screen";
      const own = getComputedStyle(e);
      if (own.display !== "inline" && (own.overflowX !== "visible" || own.overflowY !== "visible") && (e.scrollWidth > e.clientWidth + 1 || e.scrollHeight > e.clientHeight + 1)) return "cut by its own box";
      for (let p = e.parentElement; p && p !== document.body; p = p.parentElement) {
        const cs = getComputedStyle(p);
        if (cs.overflowX === "visible" && cs.overflowY === "visible") continue;
        const b = p.getBoundingClientRect();
        if (q.left < b.left - 0.5 || q.right > b.right + 0.5 || q.top < b.top - 0.5 || q.bottom > b.bottom + 0.5) return `clipped by ${p.className || p.tagName}`;
      }
      return null;
    };
    const bands = (boxes: { t: number; b: number }[]): number => {
      boxes.sort((x, y) => x.t - y.t);
      let n = 0;
      let bottom = -Infinity;
      for (const bx of boxes) {
        if (bx.t >= bottom - 3) {
          n++;
          bottom = bx.b;
        } else bottom = Math.max(bottom, bx.b);
      }
      return n;
    };
    const px = (v: string, font: number): number => (v === "normal" ? font * 1.2 : parseFloat(v));
    const rows = Array.from(document.querySelectorAll<HTMLElement>(tiers));
    let checked = 0;
    for (const a of rows) {
      const why = hiddenWhy(a);
      if (why) {
        problems.push(`${a.id}: the row is ${why}`);
        continue;
      }
      checked++;
      const sum = a.querySelector("summary")!;
      const fields: [string, Element | null][] = [
        ["filed", sum.querySelector(".si-row-filed time")],
        ["traded", sum.querySelector(".si-row-traded time") ?? sum.querySelector(".si-row-traded")],
        ["owner", sum.querySelector(".owner-note")],
        ["range", sum.querySelector(".si-row-amt")],
        ["receipt", a.querySelector(".si-row-src a, .si-row-src .si-stamp")],
      ];
      for (const e of Array.from(sum.querySelectorAll(".si-row-traded .si-lag, .si-row-traded .si-late"))) fields.push(["lag", e]);
      for (const e of Array.from(sum.querySelectorAll(".si-late-tag"))) fields.push(["LATE tag", e]);
      for (const e of Array.from(sum.querySelectorAll(".si-row-who .aff"))) fields.push(["party and state", e]);
      for (const e of Array.from(sum.querySelectorAll(".si-row-who .si-group-tag"))) fields.push(["group tag", e]);
      for (const e of Array.from(sum.querySelectorAll(".si-row-who .si-row-n > [aria-hidden=true]"))) fields.push(["×N", e]);
      if (a.dataset.grouping === "cluster") fields.push(["member count", sum.querySelector(".si-row-member")]);
      for (const [k, e] of fields) {
        if (!e) problems.push(`${a.id}: no ${k}`);
        else {
          const c = clipped(e);
          if (c) problems.push(`${a.id}: ${k} ${c}`);
        }
      }
      // the receipt never overlaps the filed date
      const rc = a.querySelector(".si-row-src")!.getBoundingClientRect();
      const fl = sum.querySelector(".si-row-filed")!.getBoundingClientRect();
      if (rc.left < fl.right - 0.5 && rc.right > fl.left + 0.5 && rc.top < fl.bottom - 0.5 && rc.bottom > fl.top + 0.5) problems.push(`${a.id}: the receipt overlaps the filed date`);
      if (!lines) continue;
      // R2: two line boxes — by the text runs' bands …
      const boxes: { t: number; b: number }[] = [];
      const walker = document.createTreeWalker(sum, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const p = n.parentElement!;
        if (!n.textContent!.trim() || p.closest(".si-meters, .visually-hidden")) continue;
        const r = document.createRange();
        r.selectNodeContents(n);
        for (const q of Array.from(r.getClientRects())) if (q.width > 0 && q.height > 0) boxes.push({ t: q.top, b: q.bottom });
      }
      const m = sum.querySelector(".si-meters")!.getBoundingClientRect();
      boxes.push({ t: m.top, b: m.bottom });
      const n = bands(boxes);
      if (n !== 2) problems.push(`${a.id}: ${n} lines, not 2 (${(sum.querySelector(".si-row-who") as HTMLElement).innerText.replace(/\s+/g, " ").trim()})`);
      // … and by the summary's height: two of its tallest lines, the row gap and the padding
      const cs = getComputedStyle(sum);
      let lh = 0;
      for (const c of Array.from(sum.children)) {
        const ccs = getComputedStyle(c);
        if (ccs.position !== "absolute") lh = Math.max(lh, px(ccs.lineHeight, parseFloat(ccs.fontSize)));
      }
      const h = sum.getBoundingClientRect().height;
      const limit = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom) + px(cs.rowGap, 0) + 2 * lh + 1;
      if (h > limit) problems.push(`${a.id}: the summary is ${h.toFixed(1)}px, over two lines' ${limit.toFixed(1)}px`);
      // the name gives way, never to nothing
      if (a.dataset.grouping !== "cluster") {
        const nm = sum.querySelector(".si-row-member")!.getBoundingClientRect();
        if (nm.width < 24) problems.push(`${a.id}: the filer's name is ${nm.width.toFixed(1)}px wide`);
      }
    }
    return { expected: rows.length, checked, problems };
  }, { tiers: TIERS, lines: !!opts.lines });
}

/** Open Routine (as a reader does) so its rows are read too. */
async function openRoutine(page: Page): Promise<void> {
  if (!(await page.evaluate(() => (document.getElementById("routine") as HTMLDetailsElement).open))) {
    await page.locator("#routine > summary").click();
  }
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => (document.getElementById("routine") as HTMLDetailsElement).open), "Routine is open").toBe(true);
}

/** The population: every row of the triage is in a tier read, and there are some. */
async function expectPopulation(page: Page, r: RowCheck): Promise<void> {
  expect(r.expected, "rows to read").toBeGreaterThan(0);
  expect(r.expected, "the three tiers hold every row of Filings to read").toBe(await page.locator("#triage article.si-row").count());
  expect(r.checked, "every row was inspected — none hidden, none skipped").toBe(r.expected);
}

for (const width of DESKTOPS) {
  test(`T1.4 (R2, codex F1) @${width}: every collapsed row of the three tiers (Routine opened) is exactly two lines, and its owner, range, both dates, lag, receipt and every LATE tag are visible and unclipped`, async ({ browser }, testInfo) => {
    const { ctx, page } = await open(browser, testInfo, width);
    try {
      await openRoutine(page);
      const r = await rowHonesty(page, { lines: true });
      await expectPopulation(page, r);
      expect(r.problems).toEqual([]);
      if (width === 1081 || width === 1200) {
        /* negative controls (codex F1): the review's mutation — a filer cell
           squeezed to 80px between 1081 and 1200px — is caught (the fixed
           parts are clipped); its wrapping form is caught by the line count */
        await page.addStyleTag({ content: "@media (min-width: 1081px) and (max-width: 1200px) { .si-row-who { white-space: normal; max-width: 80px } }" });
        const squeezed = await rowHonesty(page, { lines: true });
        expect(squeezed.problems.length, "control: a squeezed filer cell is caught").toBeGreaterThan(0);
        await page.addStyleTag({ content: "@media (min-width: 1081px) and (max-width: 1200px) { .si-row-who { flex-wrap: wrap !important; overflow: visible !important } }" });
        const wrapped = await rowHonesty(page, { lines: true });
        expect(wrapped.problems.some((p) => / lines, not 2 /.test(p)), "control: a wrapping filer cell is counted as extra lines").toBe(true);
        expect(wrapped.problems.some((p) => /over two lines/.test(p)), "control: … and by the summary's height").toBe(true);
      }
      if (width === 1440) {
        // control (codex F3): a row hidden by CSS visibility cannot escape the sweep
        await page.evaluate(() => { document.querySelector<HTMLElement>("#stands article.si-row")!.style.visibility = "hidden"; });
        const hid = await rowHonesty(page, { lines: true });
        expect(hid.checked, "control: a hidden row is not counted as inspected").toBe(hid.expected - 1);
        expect(hid.problems.some((p) => /: the row is /.test(p)), "control: … and is reported").toBe(true);
      }
    } finally {
      await ctx.close();
    }
  });
}

for (const width of PHONES) {
  test(`T1.4 (R3, criterion 4) @${width}: no sideways scroll; every row keeps its range, both dates, lag, owner, LATE tags and receipt on screen, visible and unclipped; short filers stay on three lines`, async ({ browser }, testInfo) => {
    const { ctx, page } = await open(browser, testInfo, width);
    try {
      const m = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, vw: innerWidth }));
      expect(m.sw, "no horizontal document scroll").toBeLessThanOrEqual(m.vw + 1);
      // open Routine so every row is read
      await page.evaluate(() => document.getElementById("routine")!.setAttribute("open", ""));
      const r = await rowHonesty(page);
      await expectPopulation(page, r);
      expect(r.problems).toEqual([]);
      if (width >= 375 && width <= 414) {
        const rows = await rowLines(page, "#triage article.si-row");
        expect(rows.length, "the three-line reading covers every row").toBe(r.expected);
        for (const row of rows) {
          /* three lines; a cell whose own content needs more room (the filer,
             or the range beside a long ticker and side) wraps onto further
             lines rather than dropping a field — the layout adds none */
          expect(row.lines - (row.whoLines - 1) - (row.amtLines - 1), `${row.id} (${row.who}): three lines, plus only a cell's own wrap`).toBeLessThanOrEqual(3);
          if (row.who.length <= 24 && row.amtLines === 1) expect(row.lines, `${row.id} (${row.who}): a short filer cell keeps the row at three lines`).toBeLessThanOrEqual(3);
        }
        const short = rows.filter((row) => row.who.length <= 24 && row.amtLines === 1).length;
        expect(short, "the three-line claim is measured on real rows").toBeGreaterThan(0);
      }
      if (width === 320) {
        // control (codex F3): a range hidden by CSS visibility keeps its box, and is still caught
        await page.addStyleTag({ content: "@media (max-width:320px){ .si-row-amt { visibility:hidden } }" });
        const hid = await rowHonesty(page);
        expect(hid.problems.filter((p) => /: range /.test(p)).length, "control: every hidden range is caught").toBe(r.expected);
      }
      // control: a clipped receipt is caught
      await page.addStyleTag({ content: "#triage .si-row-src { overflow: hidden !important; width: 4px !important; }" });
      expect((await rowHonesty(page)).problems.some((p) => /receipt/.test(p)), "control: a clipped receipt is caught").toBe(true);
    } finally {
      await ctx.close();
    }
  });
}

/* ---------------------------------------------------------------- R4 / LD5: cards */

test("T1.5 (R4, LD5) @390: the lead cards swipe in their own strip (x mandatory); the document does not; a card opens its row", async ({ browser }, testInfo) => {
  const { ctx, page } = await open(browser, testInfo, 390);
  try {
    const s = await page.evaluate(() => {
      const c = document.querySelector<HTMLElement>("#lead-cards .si-cards")!;
      return { sw: c.scrollWidth, cw: c.clientWidth, snap: getComputedStyle(c).scrollSnapType, role: c.getAttribute("role"), doc: document.documentElement.scrollWidth, vw: innerWidth };
    });
    expect(s.sw, "the strip overflows").toBeGreaterThan(s.cw + 1);
    expect(s.snap).toBe("x mandatory");
    expect(s.role, "a named region while it overflows").toBe("region");
    expect(s.doc).toBeLessThanOrEqual(s.vw + 1);
    // a card opens its row (its stretched link sits under the card's own links)
    const href = await page.locator("#lead-cards a.si-card-open").first().getAttribute("href");
    await page.locator("#lead-cards .si-card .si-card-fact").first().click({ force: true });
    await page.waitForTimeout(200);
    const opened = await page.evaluate((h) => ({ hash: location.hash, open: !!document.querySelector(`${h} details.si-row-d[open]`), shown: document.querySelector(h!)!.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) }), href);
    expect(opened).toEqual({ hash: href, open: true, shown: true });
  } finally {
    await ctx.close();
  }
});

/* ---------------------------------------------------------------- R7 / LD7: the pane switch */

test("T1.7 (R7, LD7) @390: one pane shows and the switch's buttons pass G12; with JavaScript off the switch is hidden and both panes show", async ({ browser }, testInfo) => {
  const { ctx, page } = await open(browser, testInfo, 390);
  try {
    const st = () => page.evaluate(() => ({ sw: document.querySelector<HTMLElement>("[data-pane-switch]")!.hidden, t: document.getElementById("triage")!.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }), s: document.getElementById("signals-side")!.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) }));
    expect(await st()).toEqual({ sw: false, t: true, s: false });
    expect(await hitMisses(page, ".pane-switch > button")).toEqual([]);
    // R26: every tip on the Filings pane reaches its 44px square at the fold
    expect(await hitMisses(page, "#triage .note-btn, #lead-cards .note-btn", 12)).toEqual([]);
    await page.locator('.pane-switch button[aria-controls="signals-side"]').click();
    expect(await st()).toEqual({ sw: false, t: false, s: true });
  } finally {
    await ctx.close();
  }
  const off = await open(browser, testInfo, 390, { js: false });
  try {
    const st = await off.page.evaluate(() => ({ sw: document.querySelector<HTMLElement>("[data-pane-switch]")!.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }), t: document.getElementById("triage")!.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }), s: document.getElementById("signals-side")!.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) }));
    expect(st, "no JavaScript: every pane shows").toEqual({ sw: false, t: true, s: true });
  } finally {
    await off.ctx.close();
  }
});

/* ---------------------------------------------------------------- R1 / LD3: the sheet */

async function sheetBox(page: Page) {
  return page.evaluate(() => {
    const p = Array.from(document.querySelectorAll<HTMLElement>(".note-pop")).find((x) => x.matches(":popover-open"));
    if (!p) return null;
    const r = p.getBoundingClientRect();
    return { pos: getComputedStyle(p).position, bottomGap: innerHeight - r.bottom, width: r.width, vw: innerWidth, close: !!p.querySelector(".note-close") };
  });
}

test("T1.2 (R1, LD3) @390: an open tip is a bottom sheet — fixed, within 12px of the viewport's bottom, the viewport's width less 24px — and Escape, the scrim and Close each dismiss it; with JavaScript off it still opens as a sheet", async ({ browser }, testInfo) => {
  const { ctx, page } = await open(browser, testInfo, 390);
  try {
    const btn = page.locator("#triage .panel-head .note-btn").first();
    await btn.click();
    const box = await sheetBox(page);
    expect(box).not.toBeNull();
    expect(box!.pos).toBe("fixed");
    expect(box!.bottomGap).toBeLessThanOrEqual(12);
    expect(box!.width).toBeGreaterThanOrEqual(box!.vw - 24);
    await expect.poll(async () => (await sheetBox(page))?.close, { message: "the script added its Close button" }).toBe(true);
    await page.keyboard.press("Escape");
    expect(await sheetBox(page), "Escape").toBeNull();
    await btn.click();
    await page.mouse.click(195, 60);
    expect(await sheetBox(page), "a tap on the scrim").toBeNull();
    await btn.click();
    await page.locator(".note-pop:popover-open .note-close").click();
    expect(await sheetBox(page), "Close").toBeNull();
  } finally {
    await ctx.close();
  }
  const off = await open(browser, testInfo, 390, { js: false });
  try {
    await off.page.locator("#triage .panel-head .note-btn").first().click();
    const box = await sheetBox(off.page);
    expect(box, "no JavaScript: popovertarget opens it").not.toBeNull();
    expect([box!.pos, box!.bottomGap <= 12, box!.width >= box!.vw - 24]).toEqual(["fixed", true, true]);
  } finally {
    await off.ctx.close();
  }
});

test("T1.2 (LD3) @1440: above the fold a tip is anchored beside its trigger, never a sheet", async ({ browser }, testInfo) => {
  const { ctx, page } = await open(browser, testInfo, 1440);
  try {
    const btn = page.locator("#triage .panel-head .note-btn").first();
    await btn.hover();
    await btn.click();
    const b = (await btn.boundingBox())!;
    const p = await page.evaluate(() => {
      const x = Array.from(document.querySelectorAll<HTMLElement>(".note-pop")).find((q) => q.matches(":popover-open"))!;
      const r = x.getBoundingClientRect();
      return { top: r.top, bottom: r.bottom, close: x.querySelector(".note-close")?.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) ?? false };
    });
    expect(Math.min(Math.abs(p.top - (b.y + b.height)), Math.abs(b.y - p.bottom)), "anchored").toBeLessThan(40);
    expect(p.close, "no Close button drawn above the fold").toBe(false);
  } finally {
    await ctx.close();
  }
});
