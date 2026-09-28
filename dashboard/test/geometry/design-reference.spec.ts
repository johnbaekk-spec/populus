import { test, expect, type Browser, type Page } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  ALLOWED_DEVIATIONS,
  allowedAt,
  compareBands,
  formatFindings,
  kindDictionary,
  measurePage,
  openCanvas,
  segTokenFindings,
  unrecorded,
  type BandMap,
  type Finding,
  type KindDictionary,
  type MeasureArg,
  type PageMeasure,
  type TableCoverage,
} from "./canvas-compare.ts";
import { CURRENT_MILESTONE, milestoneIndex, type Milestone } from "./milestones.ts";

// The supplied files are the authority, not newly blessed app screenshots.
// These checks enforce shared tokens and responsive safety. Attached screenshots
// still require panel-by-panel comparison; this suite does not certify full parity.
const references = [
  ["Congress.dc.html", "/congress/"],
  ["Institutional.dc.html", "/institutional/"],
  ["Congress Member.dc.html", "/congress/members/M001193/"],
  ["Institutional Filer.dc.html", "/institutional/filers/1067983/"],
  ["Signals.dc.html", "/signals/"],
] as const;

/* DESIGN-POLISH T2.10 (:27), L13 — where each route's three data-derived
   summary cards live. Property: §7's cards are on every design page except
   /institutional/ (its one method line), and where L13 collapses them they are
   in a CLOSED disclosure, so the default view carries no card band:
   - /congress/: inside the "Notes on this data" disclosure that directly
     follows the provenance strip (D2), closed by default;
   - member and filer pages: inside a collapsed context disclosure;
   - /signals/: visible, on the card spec;
   - /institutional/: none. */
const CARDS: Record<(typeof references)[number][1], { count: number; where: "notes" | "context" | "visible" | "none" }> = {
  "/congress/": { count: 3, where: "notes" },
  "/institutional/": { count: 0, where: "none" },
  "/congress/members/M001193/": { count: 3, where: "context" },
  "/institutional/filers/1067983/": { count: 3, where: "context" },
  "/signals/": { count: 3, where: "visible" },
};

async function expectCardPlacement(page: Page, route: (typeof references)[number][1]): Promise<void> {
  const want = CARDS[route];
  await expect(page.locator(".design-briefing .design-story")).toHaveCount(want.count);
  if (!want.count) return;
  const placement = await page.evaluate(() =>
    Array.from(document.querySelectorAll(".design-briefing .design-story")).map((card) => {
      const d = card.closest("details");
      return {
        inDetails: !!d,
        open: !!d?.open,
        detailsId: d?.id ?? "",
        afterProvenance: !!d && d.previousElementSibling?.classList.contains("design-provenance") === true,
        summary: d?.querySelector(":scope > summary")?.textContent?.replace(/\s+/g, " ").trim() ?? "",
        visible: card.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }),
      };
    }),
  );
  for (const [i, p] of placement.entries()) {
    if (want.where === "visible") {
      expect(p.inDetails, `card ${i + 1} sits on the page, not in a disclosure (L13: /signals/ shows its cards)`).toBe(false);
      expect(p.visible, `card ${i + 1} is visible`).toBe(true);
    } else {
      expect(p.inDetails, `card ${i + 1} sits in a disclosure (L13)`).toBe(true);
      expect(p.open, `card ${i + 1}'s disclosure is closed by default (L13)`).toBe(false);
      if (want.where === "notes") {
        expect(p.detailsId, "the Congress cards sit in the notes disclosure (D2)").toBe("congress-notes");
        expect(p.afterProvenance, "the notes disclosure directly follows the provenance strip (D2)").toBe(true);
        expect(p.summary).toBe("Notes on this data");
      }
    }
  }
}

/** The column set a table carries (R12): its `data-columns`, and its head in
    that order. */
async function expectHeadFollowsColumns(page: Page, table: string, what: string): Promise<void> {
  const t = page.locator(table).first();
  const cols = ((await t.getAttribute("data-columns")) ?? "").split(",").map((c) => c.trim()).filter(Boolean);
  expect(cols.length, `${what} carries its column set in data-columns`).toBeGreaterThan(0);
  await expect(t.locator("thead th")).toHaveCount(cols.length);
  expect(await t.locator("thead th").evaluateAll((ths) => ths.map((th) => th.getAttribute("data-col"))), `${what}: one head per column, in data-columns order`).toEqual(cols);
}

for (const [file, route] of references) {
  for (const width of [390, 1440]) {
    test(`design reference ${file} at ${width}px`, async ({ page }, info) => {
      const source = readFileSync(path.resolve(import.meta.dirname, "../../../docs/design/reference", file), "utf8");
      expect(source).toContain('font-family:"IBM Plex Sans"');
      expect(source).toContain('font-family:"JetBrains Mono"');
      await page.setViewportSize({ width, height: 1000 });
      const response = await page.goto(route);
      expect(response?.status(), `${route} must be a real page in the QA build`).toBe(200);
      await expect(page.locator('main h1')).toBeVisible();
      // T2.10 (:27), L13: the cards' count and placement per route.
      await expectCardPlacement(page, route);
      const metrics = await page.evaluate(() => ({
        font: getComputedStyle(document.body).fontFamily,
        paper: getComputedStyle(document.documentElement).getPropertyValue('--paper').trim(),
        width: document.documentElement.scrollWidth,
        viewport: innerWidth,
      }));
      expect(metrics.font).toContain('IBM Plex Sans');
      await page.evaluate(() => document.fonts.ready);
      const loadedFonts = await page.evaluate(() => Array.from(document.fonts).filter(face => face.status === 'loaded').map(face => face.family));
      expect(loadedFonts.join(' ')).toContain('IBM Plex Sans');
      expect(loadedFonts.join(' ')).toContain('JetBrains Mono');
      expect(source.toLowerCase()).toContain(`background:${metrics.paper.toLowerCase()}`);
      expect(metrics.width).toBeLessThanOrEqual(metrics.viewport + 1);
      if (route === "/institutional/") {
        // R14: named moves lead; the cluster board became the consensus board.
        for (const title of ["Notable managers — latest named moves", "Filer directory", "Consensus", "Conviction leaders", "Recent activity"]) {
          await expect(page.getByRole('heading', {name:title, exact:true})).toBeVisible();
        }
      }
      if (route.includes('/members/')) {
        // R16: the empty annual/overlap frames are one planned line.
        for (const title of ['Disclosed flow by quarter', 'Net disclosed flow by ticker', 'Trading profile', 'Filing history']) {
          await expect(page.getByRole('heading', {name:title, exact:true})).toBeVisible();
        }
        /* T2.10 (:52), R12: the transactions head follows the table's column
           set (presentColumns: Owner and Ticker by presence), not a fixed 8. */
        await expectHeadFollowsColumns(page, '[data-entity-table]', 'the member transactions table');
      }
      if (route === '/signals/') {
        // R17: the hits table leads.
        for (const title of ['Hits', 'Lag distribution', 'Hit rate by family', 'Watchlist']) {
          await expect(page.getByRole('heading', {name:title, exact:true})).toBeVisible();
        }
        /* T2.10 (:58-62), D3/L14: the rule book is EXPANDED — no enclosing
           disclosure, its seven rules on the page — and the hits head carries
           seven columns with Kind first (T2.6). */
        await expect(page.locator('#signal-rulebook-wrap')).toHaveCount(0);
        expect(await page.locator('#signal-rulebook').evaluate(el => !!el.closest('details')), 'no disclosure encloses the rule book').toBe(false);
        await expect(page.locator('#signal-rulebook tbody tr')).toHaveCount(7);
        await expect(page.locator('#signal-rulebook tbody tr').first()).toBeVisible();
        await expect(page.locator('#signal-hits thead th')).toHaveCount(7);
        await expect(page.locator('#signal-hits thead th').first()).toHaveText(/^\s*kind\s*$/i);
        const all = await page.locator('#signal-hits-body tr.si-hit').count();
        expect(all).toBeLessThanOrEqual(50);
        // the rule filter re-renders from the complete artifact; the status line announces the count
        const kinds = page.locator('.si-hit-filter button[data-kind]');
        if (await kinds.count() > 1) {
          await kinds.nth(1).click();
          const kind = await kinds.nth(1).getAttribute('data-kind');
          await expect(page.locator('#signal-hits-body tr.si-hit').first()).toHaveAttribute('data-kind', kind!);
          // retrying: the filter repaints after one artifact fetch, and the server's
          // first row may already be of this kind
          await expect(page.locator(`#signal-hits-body tr.si-hit:not([data-kind="${kind}"])`)).toHaveCount(0);
          await kinds.first().click();
          await expect(page.locator('#signal-hits-body tr.si-hit')).toHaveCount(all);
        }
        // every rendered hit carries its receipt link
        expect(await page.locator('#signal-hits-body tr.si-hit td.c-src a').count()).toBe(all);
        /* DESIGN-POLISH M2 (T2.6, R36): the hits page shows a compact bound
           WITHIN its 50-row page — "1–K of the 50 hits on this page", a
           definite bound noun, never the collection's size — and Show all
           reveals the rest of THAT page (the pager still pages 50). */
        /* review Q2-9: unconditional — under CD-1 the page shows its FIXED
           twelve of the fifty, on every build with more than twelve hits (the
           gate's has 50 on its first page) */
        const compact = page.locator('#signal-hits .compact-disclosure');
        expect(all, 'the gate build pages more than twelve hits').toBeGreaterThan(12);
        await expect(compact).toHaveCount(1);
        const shown = await page.locator('#signal-hits-body tr.si-hit').evaluateAll(rows => rows.filter(r => r.checkVisibility()).length);
        expect(shown, 'the fixed default: twelve hits of the page (CD-1)').toBe(12);
        await expect(compact.locator('.compact-bound')).toHaveText(new RegExp(`^1–${shown} of the ${all} hits on this page$`));
        await compact.locator('.compact-toggle').click();
        await expect.poll(() => page.locator('#signal-hits-body tr.si-hit').evaluateAll(rows => rows.filter(r => r.checkVisibility()).length), { message: 'Show all reveals every hit on the page' }).toBe(all);
        // the pager pages the artifact: 50 per page, in the range grammar
        // (DESIGN-POLISH M1, R8): "1–50 of N hits"
        const total = Number(await page.locator('#signal-hits').getAttribute('data-total'));
        if (total > 50) {
          await expect(page.locator('#signal-hits-range')).toHaveText(new RegExp(`^1–50 of ${total.toLocaleString('en-US')} hits$`));
          await page.locator('#signal-hits-next').click();
          await expect(page.locator('#signal-hits-range')).toHaveText(new RegExp(`^51–\\d[\\d,]* of ${total.toLocaleString('en-US')} hits$`));
          await page.locator('#signal-hits-prev').click();
          await expect(page.locator('#signal-hits-range')).toHaveText(new RegExp(`^1–50 of ${total.toLocaleString('en-US')} hits$`));
        }
      }
      if (route === '/congress/') {
        await expect(page.locator('.reference-feed thead th')).toHaveCount(8);
        await expect(page.locator('.reference-feed .reference-row').first().locator('td')).toHaveCount(8);
        // R12: fifty rows per page. DESIGN-POLISH M1 (R3, L8): the feed is
        // never an inner scroll box at any width — its rows flow on the page.
        const scroll = await page.locator('.reference-feed-scroll').evaluate(el => {
          const cs = getComputedStyle(el);
          return { height: el.clientHeight, contents: el.scrollHeight, overflowY: cs.overflowY, maxHeight: cs.maxHeight };
        });
        expect(['auto', 'scroll']).not.toContain(scroll.overflowY);
        expect(scroll.maxHeight).toBe('none');
        expect(scroll.contents - scroll.height, 'no rows hidden inside a box').toBeLessThanOrEqual(1);
        await expect(page.locator('.reference-feed .reference-row')).toHaveCount(50);
        if (width === 1440) {
          // DESIGN-POLISH M1: the ledger's 30px feed row (±1) — EVERY row on
          // the page, the rows carrying visible flag chips (and their
          // definition triggers) included; no row is exempt (M1 review Q-5).
          const rows = await page.locator('.reference-feed .reference-row').evaluateAll(els => els.map((el, i) => ({
            i, height: Math.round(el.getBoundingClientRect().height * 10) / 10, chips: el.querySelectorAll('.cell-range .flag').length,
          })));
          expect(rows.filter(r => Math.abs(r.height - 30) > 1), 'every feed row is 30±1px').toEqual([]);
          expect(rows.some(r => r.chips >= 1), 'the page carries flagged rows, so the pin measures chip rows too').toBe(true);
          const bars = await page.locator('.reference-feed .band-fill').evaluateAll(els => els.map(el => ({height:el.getBoundingClientRect().height,width:el.getBoundingClientRect().width})));
          expect(bars.every(bar => bar.height >= 3 && bar.width > 0), 'interval fills must actually paint inside their tracks').toBe(true);
          await expect(page.locator('#momentum-section thead th')).toHaveCount(6);
          /* T2.10 (:102-105), L10 / D1: Leaders and Tickers are PAIRED in one
             band C1 (Leaders-first order kept, only the stacking reversed):
             both in one .design-rankings, their band heads on one line ±2,
             Leaders on the left. */
          const pair = await page.evaluate(() => {
            const m = document.querySelector('#members-section'), t = document.querySelector('#momentum-section');
            const band = m?.closest('.design-rankings') ?? null;
            const box = (el: Element | null | undefined) => { const r = el!.getBoundingClientRect(); return { x: r.left, y: r.top, right: r.right }; };
            return { oneBand: !!band && band === t?.closest('.design-rankings'), mh: box(m?.querySelector('.panel-head')), th: box(t?.querySelector('.panel-head')), m: box(m), t: box(t) };
          });
          expect(pair.oneBand, 'Leaders and Tickers share one .design-rankings band').toBe(true);
          expect(Math.abs(pair.mh.y - pair.th.y), 'the Leaders and Tickers heads sit on one line').toBeLessThanOrEqual(2);
          expect(pair.m.right, 'Leaders is the left cell').toBeLessThanOrEqual(pair.t.x + 1);
          const header = await page.locator('#feed-section > .panel-head').boundingBox();
          const filters = await page.locator('#feed-section .filter-controls').boundingBox();
          expect(Math.abs(header!.y - filters!.y)).toBeLessThan(2);
        }
      }
      if (width === 1440 && route.includes('/filers/')) {
        /* T2.10 (:112), R12: the reported-positions head follows the table's
           column set (Kind, Position change and Congress are gone; Ticker,
           Weight and Wt by presence), not a fixed nine. */
        await expectHeadFollowsColumns(page, '[data-sticky-issuer]', 'the reported positions table');
        /* T2.5 (F, band F1): the holdings and the book shape start in the SAME
           band, side by side — their two cells' tops ±2, holdings on the left. */
        const f1 = await page.evaluate(() => {
          const h = document.querySelector('[data-holdings-surface="filer"]'), s = document.querySelector('.design-book-shape');
          const band = h?.closest('.design-filer-band') ?? null;
          const cellOf = (el: Element | null): Element | null => { for (let e = el; e && e.parentElement; e = e.parentElement) if (e.parentElement === band) return e; return null; };
          const hc = cellOf(h), sc = cellOf(s);
          const r = (e: Element | null) => e ? e.getBoundingClientRect() : null;
          return { band: !!band, sameBand: !!hc && !!sc && hc !== sc, h: r(hc) && { y: r(hc)!.top, right: r(hc)!.right }, s: r(sc) && { y: r(sc)!.top, x: r(sc)!.left } };
        });
        expect(f1.band && f1.sameBand, 'holdings and book shape are the two cells of band F1').toBe(true);
        expect(Math.abs(f1.h!.y - f1.s!.y), 'holdings and book shape must start in the same band').toBeLessThanOrEqual(2);
        expect(f1.h!.right).toBeLessThanOrEqual(f1.s!.x + 2);
        /* the record note still opens. Reported positions is compact (R36):
           a position's record may sit among the held rows, which the table's
           own Show all reveals — the reader's one interaction to reach it. */
        let record = page.locator('[data-sticky-issuer] tbody .note-btn:visible').first();
        if (!(await record.count())) {
          await page.locator('[data-holdings-surface="filer"] .compact-toggle').click();
          record = page.locator('[data-sticky-issuer] tbody .note-btn:visible').first();
        }
        await record.click();
        const recordPanel = page.locator(`#${await record.getAttribute('popovertarget')}`);
        await expect(recordPanel).toBeVisible();
        await expect(recordPanel).toContainText('filed');
        await page.keyboard.press('Escape');
        /* T2.5: the period chips live in the Position changes band head. The
           local data build carries one period, so this is the baseline's first
           failing assertion there; the switch below runs on a two-period build. */
        const chips = page.locator('[data-period-chips] [data-period]');
        expect(await chips.count()).toBeGreaterThan(1);
        const original = await page.locator('[data-period-chips] [aria-pressed="true"]').getAttribute('data-period');
        const prior = await chips.first().getAttribute('data-period');
        const roots = async () => page.evaluate(() => ['[data-filer-ledger]', '[data-filer-root]', '[data-filer-bookshape]'].map(s => document.querySelector(s)?.textContent?.replace(/\s+/g, ' ').trim() ?? ''));
        const before = await roots();
        await chips.first().click();
        await expect(page.locator('[data-filer-ledger] dl.design-ledger')).toHaveAttribute('aria-label', `Period statistics for ${prior}`);
        await expect(page.locator('[data-filer-root] .design-changes > .panel-head h2')).toContainText(prior!);
        const after = await roots();
        expect(after.map((t, i) => t !== before[i]), 'the ledger, the changes and the book shape all re-render for the period').toEqual([true, true, true]);
        await page.locator(`[data-period-chips] [data-period="${original}"]`).click();
        await expect(page.locator('[data-filer-root] .design-changes > .panel-head h2')).toContainText(original!);
        expect(await roots(), 'switching back restores the server-rendered parts').toEqual(before);
      }
      const pageBottom = await page.evaluate(() => ({height:document.documentElement.scrollHeight,footer:document.querySelector('footer')!.getBoundingClientRect().bottom + scrollY,viewport:innerHeight}));
      expect(pageBottom.height, 'clipped table content must not create blank space below the footer').toBeLessThanOrEqual(Math.max(pageBottom.footer,pageBottom.viewport) + 2);
      await page.screenshot({ path: info.outputPath(`${file}-${width}.png`), fullPage: true });
      await info.attach('design-source', { body: source, contentType: 'text/html' });
    });
  }
}

/* ======================================================================
   DESIGN-POLISH M2 compositions (T2.2–T2.6), at the design's 1440 screen.
   Each names the property it pins; the band order is the Decision log's
   (plan, Architecture F). DOM order must equal visual order, so a band moved
   by CSS alone (the retired `order` rules) fails.
   ====================================================================== */

/** The tops of `selectors`' first matches, and whether their DOM order is the
    listed order. */
async function partsInOrder(page: Page, selectors: string[]): Promise<{ missing: string[]; domOrder: boolean; tops: number[] }> {
  return page.evaluate((sels) => {
    const els = sels.map((s) => document.querySelector(s));
    const missing = sels.filter((_, i) => !els[i]);
    let domOrder = !missing.length;
    for (let i = 1; domOrder && i < els.length; i++) {
      domOrder = !!(els[i - 1]!.compareDocumentPosition(els[i]!) & Node.DOCUMENT_POSITION_FOLLOWING);
    }
    return { missing, domOrder, tops: els.map((e) => (e ? Math.round(e.getBoundingClientRect().top + scrollY) : NaN)) };
  }, selectors);
}
function expectVisualOrder(tops: number[], what: string): void {
  for (let i = 1; i < tops.length; i++) expect(tops[i]!, `${what}: part ${i + 1} sits below part ${i}`).toBeGreaterThan(tops[i - 1]!);
}

test('Congress composition at 1440 (T2.2): the D2 ledger, the closed notes line, band C1', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  expect((await page.goto('/congress/'))?.status()).toBe(200);
  /* D2 (L15): the four ledger labels, in order, uppercased by CSS — the
     source is a figure name, "parse" is never reader prose in caps */
  const labels = await page.locator('main dl.design-ledger > .ledger-fig > dt').evaluateAll((dts) => dts.map((dt) => {
    const trigger = dt.querySelector('.note-label') ?? dt;
    const own = Array.from(trigger.childNodes).filter((n) => n.nodeType === Node.TEXT_NODE).map((n) => n.textContent).join('').trim();
    return { rendered: (dt as HTMLElement).innerText.replace(/\s+/g, ' ').trim(), source: own, transform: getComputedStyle(trigger).textTransform };
  }));
  expect(labels.map((l) => l.rendered)).toEqual(['TRANSACTIONS', 'HOUSE PARSE', 'SENATE PARSE', 'PAPER']);
  for (const l of labels) {
    expect(l.transform, `${l.rendered}: the caps are CSS caps`).toBe('uppercase');
    expect(l.source, `${l.rendered}: the source label is not typed in caps`).not.toBe(l.source.toUpperCase());
  }
  /* D2: "Notes on this data" is ONE closed line directly after the provenance strip */
  const notes = await page.evaluate(() => {
    const p = document.querySelector('main .design-provenance');
    const n = p?.nextElementSibling ?? null;
    return { tag: n?.tagName ?? '', id: n?.id ?? '', open: n instanceof HTMLDetailsElement ? n.open : null, summary: n?.querySelector(':scope > summary')?.textContent?.replace(/\s+/g, ' ').trim() ?? '' };
  });
  expect(notes).toEqual({ tag: 'DETAILS', id: 'congress-notes', open: false, summary: 'Notes on this data' });
  /* the line holds the three cards, hidden until it is opened */
  await expect(page.locator('#congress-notes .design-briefing .design-story')).toHaveCount(3);
  expect(await page.locator('#congress-notes .design-story').first().isVisible(), 'closed: the cards are not shown').toBe(false);
  await page.locator('#congress-notes > summary').click();
  await expect(page.locator('#congress-notes .design-story').first(), 'opened: the cards show').toBeVisible();
  /* band C1 (D1): Leaders │ Tickers, one band, heads on one line, before the feed */
  const c1 = await partsInOrder(page, ['#congress-leaders-band', '#feed-section']);
  expect(c1.missing).toEqual([]);
  expect(c1.domOrder, 'C1 precedes the feed (Leaders first, data first)').toBe(true);
  expectVisualOrder(c1.tops, 'C1 then the feed');
  await expect(page.locator('#congress-leaders-band.design-rankings > #members-section + #momentum-section')).toHaveCount(1);
});

test('Member composition at 1440 (T2.3): chart, M1, transactions, M2, Planned line, context', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  expect((await page.goto('/congress/members/M001193/'))?.status()).toBe(200);
  const order = await partsInOrder(page, [
    'main .design-member-chart',
    'main .design-flow-band',
    'main section:has([data-entity-table])',
    'main .design-member-history-band',
    'main > p.planned-line',
    'main > p.planned-line ~ details.design-supplement',
  ]);
  expect(order.missing).toEqual([]);
  expect(order.domOrder, 'chart → M1 → transactions → M2 → Planned line → context disclosures, in the DOM').toBe(true);
  expectVisualOrder(order.tops, 'the member page');
  /* the context disclosures are the page's foot: collapsed, after the Planned line */
  const context = await page.locator('main > p.planned-line ~ details.design-supplement').evaluateAll((ds) => ds.map((d) => (d as HTMLDetailsElement).open));
  expect(context.length).toBeGreaterThan(0);
  expect(context.every((open) => !open), 'the context disclosures are collapsed').toBe(true);
  /* M1: Net flow (left) │ Trading profile + sector (right), side by side */
  const m1 = await page.evaluate(() => {
    const band = document.querySelector('.design-flow-band')!;
    const cells = Array.from(band.children).filter((c) => c.checkVisibility());
    return cells.map((c) => ({ top: Math.round(c.getBoundingClientRect().top), left: c.getBoundingClientRect().left, right: c.getBoundingClientRect().right, heads: Array.from(c.querySelectorAll('h2')).map((h) => h.textContent!.trim()), text: c.textContent!.replace(/\s+/g, ' ') }));
  });
  expect(m1.length, 'band M1 is a pair').toBe(2);
  expect(m1[0]!.heads).toContain('Net disclosed flow by ticker');
  expect(m1[1]!.heads).toContain('Trading profile');
  expect(m1[1]!.text, 'the sector mix (or its one unavailable line) sits under the profile').toMatch(/sector/i);
  expect(Math.abs(m1[0]!.top - m1[1]!.top)).toBeLessThanOrEqual(2);
  expect(m1[0]!.right).toBeLessThanOrEqual(m1[1]!.left + 1);
  /* M2: Filing history │ Signals — a two-column .design-pair, or collapsed
     under the empty-state rule with the Signals line under the history (D-8) */
  const m2 = await page.evaluate(() => {
    const band = document.querySelector('.design-member-history-band')!;
    const cells = Array.from(band.children).filter((c) => c.checkVisibility());
    return { pair: band.classList.contains('design-pair'), collapsed: band.getAttribute('data-collapsed'), cells: cells.map((c) => ({ label: c.getAttribute('aria-label'), top: c.getBoundingClientRect().top, bottom: c.getBoundingClientRect().bottom, left: c.getBoundingClientRect().left, right: c.getBoundingClientRect().right, width: c.getBoundingClientRect().width, empty: c.hasAttribute('data-empty-state') })) };
  });
  expect(m2.pair, 'band M2 is a .design-pair').toBe(true);
  expect(m2.cells.map((c) => c.label)).toEqual(['Filing history', 'Signals']);
  const [history, signals] = m2.cells as [(typeof m2.cells)[number], (typeof m2.cells)[number]];
  if (m2.collapsed === 'empty-state') {
    expect(signals.empty, 'the pair collapses only because Signals holds only its empty-state line').toBe(true);
    expect(signals.top, 'the Signals line sits under the history').toBeGreaterThanOrEqual(history.bottom - 1);
    /* CD-2: the lone three-column history keeps the design's cell width — half
       the band — and the Signals line runs the band's full width under it */
    expect(Math.abs(history.width - signals.width / 2), 'the history at half the band (CD-2)').toBeLessThanOrEqual(1);
    expect(Math.abs(history.left - signals.left), 'both start on the band edge').toBeLessThanOrEqual(1);
  } else {
    expect(m2.collapsed).toBeNull();
    expect(Math.abs(history.top - signals.top), 'history and signals side by side').toBeLessThanOrEqual(2);
    expect(history.right).toBeLessThanOrEqual(signals.left + 1);
  }
  /* R13: a quarterly chart whose window holds no trade is ONE line — the
     window and the last trade date — and no empty plot (.rb-track) */
  const chart = await page.evaluate(() => {
    const c = document.querySelector('.design-member-chart')!;
    const line = c.querySelector('[data-flow-empty]');
    return { line: line?.textContent?.replace(/\s+/g, ' ').trim() ?? null, tracks: c.querySelectorAll('.rb-track').length };
  });
  if (chart.line !== null) {
    expect(chart.tracks, 'an empty window draws no plot').toBe(0);
    /* review R2-4: a window whose last quarter is still open ends at the build date */
    expect(chart.line, 'the line names the window').toMatch(/\d{2}Q\d–\d{2}Q\d \(\d{4}-\d{2}-\d{2} (?:to \d{4}-\d{2}-\d{2}|through \d{4}-\d{2}-\d{2}, the build date)\)/);
    expect(chart.line, 'the line names the most recent trade date').toMatch(/Most recent disclosed trade: \d{4}-\d{2}-\d{2}/);
  } else {
    expect(chart.tracks, 'a window with trades draws its plot').toBeGreaterThan(0);
  }
  test.info().annotations.push({ type: 'chart', description: chart.line === null ? 'the window holds trades: plot drawn' : `empty window: ${chart.line}` });
});

test('Institutional composition at 1440 (T2.4): heading order, Recent activity full width, collapsed adds, the Consensus-add figure', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  expect((await page.goto('/institutional/'))?.status()).toBe(200);
  /* the approved preview's order: notable managers → directory → Consensus │
     Conviction → Recent activity (the pair's cells in either order) */
  const heads = await page.locator('main h2.section-h').evaluateAll((hs) => hs.filter((h) => h.checkVisibility()).map((h) => ({ text: h.textContent!.replace(/\s+/g, ' ').trim(), top: Math.round(h.getBoundingClientRect().top + scrollY) })));
  const at = (re: RegExp): number => heads.findIndex((h) => re.test(h.text));
  const notable = at(/^Notable managers/), directory = at(/^Filer directory$/), consensus = at(/^Consensus$/), conviction = at(/^Conviction leaders$/), activity = at(/^Recent activity$/);
  expect([notable, directory, consensus, conviction, activity].every((i) => i >= 0), `every band heading is present: ${heads.map((h) => h.text).join(' | ')}`).toBe(true);
  expect(notable).toBeLessThan(directory);
  expect(directory).toBeLessThan(Math.min(consensus, conviction));
  expect(Math.max(consensus, conviction)).toBeLessThan(activity);
  expect(heads[directory]!.top).toBeLessThan(Math.min(heads[consensus]!.top, heads[conviction]!.top));
  expect(Math.max(heads[consensus]!.top, heads[conviction]!.top)).toBeLessThan(heads[activity]!.top);
  /* Recent activity is full width, in no pair */
  const activityBand = await page.locator('main section', { has: page.locator('h2.section-h', { hasText: /^Recent activity$/ }) }).first().evaluate((s) => ({ inPair: !!s.closest('.design-band, .design-pair'), width: s.getBoundingClientRect().width, main: document.querySelector('main')!.getBoundingClientRect().width }));
  expect(activityBand.inPair, 'Recent activity is not inside a .design-band or .design-pair').toBe(false);
  /* "Recently added issuers" stays in its collapsed disclosure */
  const adds = await page.locator('#inst-adds-section').evaluate((s) => { const d = s.closest('details'); return { inDetails: !!d, open: !!d?.open }; });
  expect(adds).toEqual({ inDetails: true, open: false });
  /* band I1 (CD-5): Consensus (1.3fr, the primary) │ Conviction leaders (1fr),
     or collapsed (D-8) with the empty line under the other cell, which is
     then the primary — no primary when both cells are lines (M2F-D2) */
  const i1 = await page.evaluate(() => {
    const band = document.querySelector('.design-consensus-band')!;
    const cells = Array.from(band.children).filter((c) => c.checkVisibility()).map((c) => ({
      h: c.querySelector('h2')?.textContent?.trim(), top: c.getBoundingClientRect().top, bottom: c.getBoundingClientRect().bottom,
      width: c.getBoundingClientRect().width, primary: c.hasAttribute('data-pair-primary'),
      line: c.hasAttribute('data-empty-state') || c.classList.contains('design-unavailable-line'),
    }));
    return { collapsed: band.getAttribute('data-collapsed'), cells };
  });
  expect(i1.cells.map((c) => c.h).sort()).toEqual(['Consensus', 'Conviction leaders']);
  if (i1.collapsed === 'empty-state') {
    expect(i1.cells[1]!.top, 'the empty cell sits under the other').toBeGreaterThanOrEqual(i1.cells[0]!.bottom - 1);
    expect(i1.cells.map((c) => c.primary), 'the content cell is the primary (none when both are lines)').toEqual(i1.cells.every((c) => c.line) ? [false, false] : [true, false]);
    test.info().annotations.push({ type: 'band I1', description: `collapsed: ${i1.cells.map((c) => `${c.h}${c.line ? ' (line)' : ''}`).join(' over ')}` });
  } else {
    expect(Math.abs(i1.cells[0]!.top - i1.cells[1]!.top)).toBeLessThanOrEqual(2);
    expect(i1.cells.map((c) => c.h), 'Consensus leads').toEqual(['Consensus', 'Conviction leaders']);
    expect(i1.cells.map((c) => c.primary), 'Consensus is the primary').toEqual([true, false]);
    expect(i1.cells[0]!.width / i1.cells[1]!.width, '1.3fr │ 1fr').toBeCloseTo(1.3, 1);
  }
  /* the ledger: every value on one line (R15), and the Consensus-add value is
     the TICKER with the issuer in its sub — or, with no qualifying name, "—"
     with an absence statement */
  const figs = await page.locator('main dl.design-ledger > .ledger-fig').evaluateAll((fs) => fs.map((f) => {
    const v = f.querySelector('.ledger-value')!;
    const rg = document.createRange();
    rg.selectNodeContents(v);
    const lines = new Set(Array.from(rg.getClientRects()).filter((q) => q.width > 0).map((q) => Math.round(q.top)));
    return { label: (f.querySelector('dt') as HTMLElement).innerText.trim(), value: v.textContent!.trim(), sub: f.querySelector('.ledger-sub')?.textContent?.trim() ?? '', lines: lines.size };
  }));
  for (const f of figs) expect(f.lines, `${f.label}: the value is one line`).toBe(1);
  const add = figs.find((f) => f.label === 'CONSENSUS ADD');
  expect(add, 'the ledger carries the Consensus add figure').toBeTruthy();
  if (add!.value === '—') {
    expect(add!.sub, 'no qualifying name: the sub states the absence').toMatch(/^no\b/i);
    test.info().annotations.push({ type: 'consensus-add', description: `the board is empty on this build: "—" / "${add!.sub}"` });
  } else {
    expect(add!.value, 'the value is a ticker, never the issuer name').toMatch(/^[A-Z][A-Z0-9.\-]{0,9}$/);
    expect(add!.sub.length, 'the issuer name leads the sub').toBeGreaterThan(add!.value.length);
    expect(add!.sub.startsWith(add!.value), 'the sub is the issuer, not the ticker again').toBe(false);
  }
  /* control for the one-line rule: a forced two-line value is caught */
  await page.addStyleTag({ content: '.ledger-value { white-space: normal !important; word-break: break-all !important; width: 1ch !important; }' });
  const forced = await page.locator('main dl.design-ledger .ledger-value').first().evaluate((v) => { const rg = document.createRange(); rg.selectNodeContents(v); return new Set(Array.from(rg.getClientRects()).filter((q) => q.width > 0).map((q) => Math.round(q.top))).size; });
  expect(forced, 'control: a wrapped value measures more than one line').toBeGreaterThan(1);
});

test('Filer composition at 1440 (T2.5): parts in DOM order = visual order; the period roots', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  expect((await page.goto('/institutional/filers/1067983/'))?.status()).toBe(200);
  /* head → changes → band F1 → Planned line → EDGAR / notes → the §5 note */
  const parts = ['main header.entity-head', 'main [data-filer-root]', 'main .design-filer-band', 'main > p.planned-line', 'main details.edgar-block', 'main #filer-notes', 'main .filer-data-note'];
  const order = await partsInOrder(page, parts);
  expect(order.missing).toEqual([]);
  expect(order.domOrder, 'the parts are emitted in the Decision-log order').toBe(true);
  expectVisualOrder(order.tops, 'the filer page');
  /* the period-dependent roots, and the period chips in the changes head */
  const roots = await page.evaluate(() => ({
    ledger: document.querySelector('[data-filer-ledger] dl.design-ledger')?.getAttribute('aria-label') ?? null,
    changes: !!document.querySelector('[data-filer-root] section.design-changes'),
    bookshape: !!document.querySelector('.design-filer-band [data-filer-bookshape] .design-book-shape'),
    chipsInHead: Array.from(document.querySelectorAll('[data-period-chips]')).map((c) => !!c.closest('[data-filer-root] .design-changes > .panel-head')),
  }));
  expect(roots.ledger, 'the ledger root carries the period statistics').toMatch(/^Period statistics for \d{4}-\d{2}-\d{2}$/);
  expect(roots.changes).toBe(true);
  expect(roots.bookshape, 'the book shape root is in band F1').toBe(true);
  expect(roots.chipsInHead.length, 'the page carries period chips').toBeGreaterThan(0);
  expect(roots.chipsInHead.every(Boolean), 'the period chips sit in the Position changes band head').toBe(true);
  const chips = page.locator('[data-period-chips] [data-period]');
  const n = await chips.count();
  if (n > 1) {
    /* the switch re-renders the ledger, the changes and the book shape */
    const text = () => page.evaluate(() => ['[data-filer-ledger]', '[data-filer-root]', '[data-filer-bookshape]'].map((s) => document.querySelector(s)!.textContent!.replace(/\s+/g, ' ').trim()));
    const before = await text();
    const current = await page.locator('[data-period-chips] [aria-pressed="true"]').getAttribute('data-period');
    const other = (await chips.evaluateAll((cs, cur) => cs.map((c) => c.getAttribute('data-period')).find((p) => p !== cur), current))!;
    await page.locator(`[data-period-chips] [data-period="${other}"]`).click();
    await expect(page.locator('[data-filer-ledger] dl.design-ledger')).toHaveAttribute('aria-label', `Period statistics for ${other}`);
    const after = await text();
    expect(after.map((t, i) => t !== before[i]), 'ledger, changes and book shape follow the period').toEqual([true, true, true]);
    await page.locator(`[data-period-chips] [data-period="${current}"]`).click();
    await expect(page.locator('[data-filer-ledger] dl.design-ledger')).toHaveAttribute('aria-label', `Period statistics for ${current}`);
    expect(await text()).toEqual(before);
  } else {
    test.info().annotations.push({ type: 'period', description: 'one period in this build: the roots and the chip placement are asserted, the switch is not exercised' });
  }
});

test('Signals composition at 1440 (T2.6): S1 pairs Hits with Lag + Hit rate; the rule book between S1 and the watchlist', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  expect((await page.goto('/signals/'))?.status()).toBe(200);
  const s1 = await page.evaluate(() => {
    const band = document.querySelector('.design-signals-band')!;
    const cells = Array.from(band.children).filter((c) => c.checkVisibility());
    return cells.map((c) => ({ id: c.id, top: c.getBoundingClientRect().top, left: c.getBoundingClientRect().left, right: c.getBoundingClientRect().right, heads: Array.from(c.querySelectorAll('h2')).map((h) => h.textContent!.trim()) }));
  });
  expect(s1.length, 'S1 is a pair').toBe(2);
  expect(s1[0]!.id, 'Hits is the left cell').toBe('signal-hits');
  expect(s1[1]!.heads, 'the right cell holds Lag distribution, then Hit rate').toEqual(['Lag distribution', 'Hit rate by family']);
  expect(Math.abs(s1[0]!.top - s1[1]!.top), 'the two cells start at one top').toBeLessThanOrEqual(2);
  expect(s1[0]!.right).toBeLessThanOrEqual(s1[1]!.left + 1);
  const order = await partsInOrder(page, ['main .design-signals-band', 'main #signal-rulebook', 'main #signal-watch']);
  expect(order.missing).toEqual([]);
  expect(order.domOrder, 'S1 → rule book → watchlist (L14)').toBe(true);
  expectVisualOrder(order.tops, 'the signals page');
  const rb = await page.locator('#signal-rulebook').evaluate((s) => ({ details: !!s.closest('details'), multiline: s.querySelector('table')!.hasAttribute('data-multiline'), rows: s.querySelectorAll('tbody tr').length }));
  expect(rb).toEqual({ details: false, multiline: true, rows: 7 });
});

/* ======================================================================
   DESIGN-POLISH T2.9 (R29, R30) — every band against the design canvas.
   Each `.dc.html` is rendered through page.route and measured
   (canvas-compare.ts); the live route is measured the same way; every
   difference must be one of ALLOWED_DEVIATIONS (with its record id) or the
   test fails. The band maps below say which route band answers which canvas
   band — a band the route does not have (the member's Form A holdings, the
   canvases' sector rotation) is not compared, never faked.
   ====================================================================== */

interface CanvasCase {
  file: string;
  route: string;
  /** collapsed disclosures to open before measuring (the L13 card homes) */
  open?: string;
  /** a pressed default filter to release before measuring, so the table
      renders its rows (the directory's "Hedge funds" chip matches no filer on
      a build without the manager registry) */
  release?: string;
  /** seed the device-local watchlist, so the watch band renders rows */
  seedWatch?: boolean;
  tables: MeasureArg["tables"];
  map: BandMap;
}
/* Review Q2-8: the reasons a route column or kind is not compared with a
   canvas column, stated once and cited by the maps below. */
const WHY = {
  bar: "a bar cell: no text in it has a role to compare (its fill is measured by G11b)",
  headerless: "the canvas draws this band as a header-less list: its rows are held to the table spec (body role, row height, gutters, gaps), not column by column",
  prior: "the canvas's one Holdings table has no prior-quarter column; the route splits it into Position changes and Reported positions (Architecture F, T2.5)",
  flags: "the canvas draws no flag column; Flags renders by presence (R12)",
  ticker: "the canvas's hit subject carries no ticker column; the route states the ticker in its own (R26, T2.6)",
  paper: "a paper filing's kind word: the canvas draws no paper row (M1: the feed keeps its paper rows, D1)",
  conviction: "the canvas draws Conviction leaders as a bar list, not a table: the route's table is held to band I1's table spec — the Cluster board's header, body, row and gap roles",
  i1: "coordinator decision CD-5: band I1 is Consensus (1.3fr, the primary) │ Conviction leaders (1fr) as the approved preview draws it; the canvas draws the Cluster board beside Recent activity and Conviction leaders beside Sector rotation, two bands, so its baseline gap between them measures nothing",
  netbar: "the member ranking's NET FLOW cell is its interval bar with the range as screen-reader text (M1 C-4): no visible text run has a role",
} as const;
const CANVAS_CASES: CanvasCase[] = [
  {
    file: "Congress.dc.html", route: "/congress/", open: "#congress-notes",
    tables: [
      { label: "Disclosure feed", selector: "#feed-section table.reference-feed" },
      { label: "Leaders", selector: "#members-section > .table-scroll table.etable" },
      { label: "Tickers", selector: "#momentum-section > .table-scroll table.etable" },
    ],
    map: {
      ledger: true, cards: true,
      tables: [
        { canvas: "Disclosure feed", route: "Disclosure feed", columns: { "AMOUNT RANGE": "INTERVAL LOG $1K→$50M+", SOURCE: "RCPT" }, unmatched: { "kind:PAPER": WHY.paper, "AMOUNT RANGE (canvas cell unmeasured)": WHY.bar } },
        { canvas: "Leaders · net disclosed flow", route: "Leaders", columns: { TRADES: "TXNS", "GROSS BOUGHT": "GROSS PURCH" }, unmatched: { "NET FLOW (route cell unmeasured)": WHY.netbar } },
        { canvas: "Tickers · most disclosed", route: "Tickers", columns: { TRADES: "TXNS", "NET FLOW": "NET LOWER BOUND" }, unmatched: { "BUY SELL COUNT (canvas cell unmeasured)": WHY.bar }, roleDeviation: { "NET FLOW": "table.role.number" } },
      ],
      heads: [{ canvas: "Disclosure feed", route: "Disclosure feed" }, { canvas: "Leaders · net disclosed flow", route: "Leaders · net disclosed flow" }, { canvas: "Tickers · most disclosed", route: "Tickers · most disclosed" }],
      pairs: [{ canvas: ["Leaders · net disclosed flow", "Tickers · most disclosed"], route: ["Leaders · net disclosed flow", "Tickers · most disclosed"] }],
      segs: [{ canvas: "All|House|Senate|D|R|Late", route: "All|House|Senate" }, { canvas: "All|House|Senate|D|R|Late", route: "All|D|R|I" }],
    },
  },
  {
    file: "Institutional.dc.html", route: "/institutional/", release: '#mgr-chips [data-mgr-type][aria-pressed="true"]',
    tables: [
      { label: "Recent activity", selector: ".design-activity table.etable" },
      { label: "Filer directory", selector: "#inst-managers-section table.etable" },
      { label: "Consensus", selector: "#inst-consensus table.etable" },
      { label: "Conviction leaders", selector: ".design-newpositions table.etable" },
    ],
    map: {
      ledger: true, cards: false,
      tables: [
        {
          canvas: "Recent activity", route: "Recent activity", columns: { "Δ VALUE": "VALUE", "POSITION CHANGE": "Δ POS" },
          empty: "the notable feed lists the curated managers' changes, and the bounded build carries no manager registry (0 of 9,451 filers typed): its one row is the stated empty line",
        },
        { canvas: "Filer directory", route: "Filer directory", roleDeviation: { VALUE: "table.role.number", "LATEST NOTABLE": "table.role.notable.m3" } },
        /* Consensus is I1's primary LEFT cell (CD-5), as the Cluster board is
           the canvas's left cell: its gutters compare (28px, D-11) */
        { canvas: "Cluster board", route: "Consensus", band: "design-consensus-band" },
        /* review Q2-8: the Conviction table is measured too, on I1's table spec */
        {
          canvas: "Cluster board", route: "Conviction leaders", band: "design-consensus-band", minCompared: 0,
          noGutters: "the Cluster board is the canvas's LEFT cell (28px, D-11); Conviction is I1's right side cell (1fr, CD-5), and full width when I1 collapses — its gutters are G10's (band edges ± --gutter)",
          unmatched: { "#": WHY.conviction, FILER: WHY.conviction, "": WHY.conviction, "LARGEST NEW": WHY.conviction, "≥2% / NEW": WHY.conviction, gutters: WHY.conviction },
        },
      ],
      heads: [{ canvas: "Recent activity", route: "Recent activity" }, { canvas: "Conviction leaders", route: "Conviction leaders" }, { canvas: "Cluster board", route: "Consensus" }],
      /* band I1 (review Q2-8, CD-5): its two heads on one line, as the preview
         draws them, unless the pair collapsed */
      pairs: [{ canvas: ["Cluster board", "Conviction leaders"], route: ["Consensus", "Conviction leaders"], preview: WHY.i1 }],
      segs: [{ canvas: "All|Tech|L/S|Multi|Value", route: "notable|…" }],
    },
  },
  {
    file: "Congress Member.dc.html", route: "/congress/members/M001193/", open: "main > details.design-supplement",
    tables: [
      { label: "Net flow", selector: ".design-flow-band table.etable" },
      { label: "Transactions", selector: "[data-entity-table]" },
      { label: "Filing history", selector: ".design-member-history table.etable" },
    ],
    map: {
      ledger: true, cards: true,
      tables: [
        { canvas: "Flows by ticker", route: "Net flow", columns: { "BUY SELL": "BUY SELL LOWER BOUNDS", "NET RANGE": "NET ≥" }, unmatched: { "BUY SELL (canvas cell unmeasured)": WHY.bar }, roleDeviation: { "NET RANGE": "table.role.number" } },
        { canvas: "All disclosed transactions", route: "Transactions", columns: { "AMOUNT RANGE": "INTERVAL LOG $1K→$50M+", SOURCE: "RCPT" }, unmatched: { "AMOUNT RANGE (canvas cell unmeasured)": WHY.bar } },
        { canvas: "Filing history", route: "Filing history", minCompared: 0, unmatched: { FILED: WHY.headerless, ROWS: WHY.headerless, RECEIPT: WHY.headerless } },
      ],
      heads: [{ canvas: "Flows by ticker", route: "Net disclosed flow by ticker" }, { canvas: "Trading profile", route: "Trading profile" }, { canvas: "All disclosed transactions", route: "All disclosed transactions" }, { canvas: "Filing history", route: "Filing history" }, { canvas: "Signals on this member", route: "Signals" }],
      pairs: [{ canvas: ["Flows by ticker", "Trading profile"], route: ["Net disclosed flow by ticker", "Trading profile"] }, { canvas: ["Filing history", "Signals on this member"], route: ["Filing history", "Signals"] }],
      segs: [],
    },
  },
  {
    file: "Institutional Filer.dc.html", route: "/institutional/filers/1067983/", open: "#filer-notes",
    tables: [
      { label: "Position changes", selector: ".design-changes table.etable" },
      { label: "Reported positions", selector: '[data-holdings-surface="filer"] table.etable' },
      { label: "Filing history", selector: ".design-filer-history table.etable" },
    ],
    map: {
      ledger: true, cards: true,
      /* review Q2-8: the measured Filing history is mapped to its canvas band */
      tables: [
        {
          canvas: "Holdings", route: "Position changes",
          columns: { CHANGE: "KIND", POSITION: "ISSUER", "Δ SHARES": "Δ POS", "CURR VALUE": "VALUE", "CURR SHARES": "SHARES" },
          unmatched: { "Δ VALUE": WHY.prior, "PREV VALUE": WHY.prior, "PREV SHARES": WHY.prior, FLAGS: WHY.flags },
          roleDeviation: { POSITION: "table.role.poskey", CHANGE: "kind.qoq.chip.m3" },
        },
        { canvas: "Holdings", route: "Reported positions", unmatched: { "WEIGHT (canvas cell unmeasured)": WHY.bar } },
        { canvas: "Filing history", route: "Filing history", minCompared: 0, unmatched: { PERIOD: WHY.headerless, SOURCE: WHY.headerless }, gutterDeviation: "table.gutter.d11" },
      ],
      heads: [{ canvas: "Holdings", route: "Position changes — …" }, { canvas: "Holdings", route: "Reported positions — …" }, { canvas: "Book shape", route: "Book shape" }, { canvas: "Filing history", route: "Filing history" }],
      pairs: [{ canvas: ["Holdings", "Book shape"], route: ["Reported positions — …", "Book shape"] }],
      segs: [{ canvas: "All|Changed|New|Congress overlap", route: "All|New stakes|…" }],
    },
  },
  {
    file: "Signals.dc.html", route: "/signals/", seedWatch: true,
    tables: [
      { label: "Rule book", selector: "#signal-rulebook table" },
      { label: "Hits", selector: "#signal-hits table.si-table" },
      { label: "Watchlist", selector: "#signal-watch-table" },
    ],
    map: {
      ledger: true, cards: true,
      tables: [
        { canvas: "Rule book", route: "Rule book" },
        { canvas: "Hits", route: "Hits", columns: { WHO: "SUBJECT", WHAT: "EVIDENCE", FILED: "WHEN", SIZE: "MAGNITUDE" }, unmatched: { TICKER: WHY.ticker }, roleDeviation: { WHO: "table.role.member" } },
        { canvas: "◆ Watchlist", route: "Watchlist", columns: { SOURCE: "RCPT" } },
      ],
      heads: [{ canvas: "Rule book", route: "Rule book" }, { canvas: "Hits", route: "Hits" }, { canvas: "Lag distribution", route: "Lag distribution" }, { canvas: "Hit rate by family", route: "Hit rate by family" }, { canvas: "◆ Watchlist", route: "Watchlist" }],
      pairs: [{ canvas: ["Hits", "Lag distribution"], route: ["Hits", "Lag distribution"] }],
      segs: [{ canvas: "All|Congress|13F|Cross", route: "All|…" }],
    },
  },
];

/** The five canvases, measured once per worker in their own context. */
let canvasMemo: Promise<Record<string, PageMeasure>> | null = null;
function canvases(browser: Browser): Promise<Record<string, PageMeasure>> {
  canvasMemo ??= (async () => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    const out: Record<string, PageMeasure> = {};
    for (const [file] of references) {
      await openCanvas(page, file);
      out[file] = await page.evaluate(measurePage, { kind: "canvas" } as MeasureArg);
    }
    await ctx.close();
    return out;
  })();
  return canvasMemo;
}

/** Open a route at the canvas's 1440 screen in the canvas's (dark) theme. */
async function openRoute(page: Page, c: CanvasCase): Promise<void> {
  await page.addInitScript(() => { try { localStorage.setItem("populus:theme", "dark"); } catch { /* storage blocked */ } });
  if (c.seedWatch) {
    await page.addInitScript(() => {
      try { localStorage.setItem("populus:watch:v2", JSON.stringify({ v: 2, members: ["M001193"], tickers: ["NVDA", "AAPL"] })); } catch { /* as above */ }
    });
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  expect((await page.goto(c.route))?.status(), `${c.route} answers 200`).toBe(200);
  expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor), "the canvas is dark; so is the route").toBe("rgb(4, 7, 13)");
  await page.evaluate(() => document.fonts.ready);
  if (c.open) await page.evaluate((sel) => document.querySelectorAll<HTMLDetailsElement>(sel).forEach((d) => { d.open = true; }), c.open);
  if (c.release) {
    for (const chip of await page.locator(c.release).all()) await chip.click();
    await page.waitForTimeout(300);
  }
  if (c.seedWatch) {
    /* the SEEN column states NEW (the canvas's state) only against a seen
       marker: set one at the window's start, then reload */
    const seeded = await page.evaluate(() => {
      const root = document.querySelector<HTMLElement>("#signal-watch");
      if (!root?.dataset.coverageFrom) return false;
      localStorage.setItem("populus:watch:cursor:v1", JSON.stringify({ v: 1, lastSeenFiled: root.dataset.coverageFrom, buildId: root.dataset.buildId ?? "", at: new Date().toISOString() }));
      return true;
    });
    expect(seeded, "the watch band states its window, so a seen marker can be set").toBe(true);
    await page.reload();
    await page.evaluate(() => document.fonts.ready);
  }
}

async function compareRoute(page: Page, browser: Browser, c: CanvasCase, milestone: Milestone = CURRENT_MILESTONE): Promise<{ findings: Finding[]; seg: Finding[]; dict: KindDictionary; route: PageMeasure; coverage: TableCoverage[]; canvas: PageMeasure }> {
  const all = await canvases(browser);
  const dict = kindDictionary(Object.values(all));
  const route = await page.evaluate(measurePage, { kind: "route", tables: c.tables } as MeasureArg);
  const coverage: TableCoverage[] = [];
  return { findings: compareBands(all[c.file]!, route, c.map, dict, milestone, coverage), seg: segTokenFindings(route), dict, route, coverage, canvas: all[c.file]! };
}

/** Review Q2-8: nothing the comparison could not pair with the canvas is
    skipped silently. Each mapped table compared at least its minimum of
    columns, and every route column or kind with no canvas twin is listed, with
    its reason, in the map. */
function coverageProblems(c: CanvasCase, coverage: TableCoverage[]): string[] {
  const out: string[] = [];
  for (const cov of coverage) {
    const tm = c.map.tables.find((t) => t.canvas === cov.canvas && t.route === cov.route)!;
    if (cov.bodyless) {
      /* a table with no body cell compares its header only — allowed only
         where the map says why this build renders none (data-bound) */
      if (!tm.empty) out.push(`${cov.route}: no body cell was measured, and the map states no reason`);
      continue;
    }
    if (tm.empty) out.push(`${cov.route}: the map says it renders no body cell ("${tm.empty}"), but it does — measure it`);
    const min = Math.min(tm.minCompared ?? 2, cov.columns);
    if (cov.compared.length < min) out.push(`${cov.route}: ${cov.compared.length} column(s) compared with the canvas (at least ${min}): ${cov.compared.join(", ") || "none"}`);
    for (const u of [...new Set(cov.unmatched)]) {
      if (!tm.unmatched?.[u]) out.push(`${cov.route}: "${u}" was not compared with the canvas band "${cov.canvas}", and the map states no reason`);
    }
  }
  return out;
}

for (const c of CANVAS_CASES) {
  test(`canvas comparison ${c.file} at 1440 (T2.9)`, async ({ page, browser }, info) => {
    await openRoute(page, c);
    const { findings, seg, route, coverage, canvas } = await compareRoute(page, browser, c);
    /* both sides' table columns ride in the evidence, so an unmatched label can be read against the canvas's */
    const columnsOf = (m: PageMeasure) => m.tables.map((t) => ({ title: t.title, columns: t.columns.map((x) => x.label), kinds: [...new Set(t.kinds.map((k) => k.word))] }));
    const evidence = JSON.stringify({ route: c.route, milestone: CURRENT_MILESTONE, findings, segTokens: seg, coverage, tables: { canvas: columnsOf(canvas), route: columnsOf(route) }, allowed: allowedAt() }, null, 1);
    writeFileSync(info.outputPath("canvas-comparison.json"), evidence);
    await info.attach("canvas-comparison.json", { body: evidence, contentType: "application/json" });
    /* review Q2-8: every mapped table was compared, column by column */
    const gaps = coverageProblems(c, coverage);
    expect(gaps, `comparison coverage against ${c.file}:\n${gaps.join("\n")}`).toEqual([]);
    /* the comparison measured the bands it maps, not an empty page (a mapped
       table or head the route lacks is itself an unrecorded finding, unless
       its pair collapsed under the empty-state rule) */
    expect(route.ledger.length, "the route's header ledger was measured").toBeGreaterThan(0);
    expect(route.tables.length, "the route's mapped tables were measured").toBeGreaterThan(0);
    const bad = unrecorded(findings);
    expect(bad, `unrecorded differences from ${c.file} (every allowed one names its record):\n${formatFindings(bad)}`).toEqual([]);
    expect(seg, `segmented controls against the D-4 tokens:\n${formatFindings(seg)}`).toEqual([]);
  });
}

/* The T2.9 controls: each injects ONE defect and requires the comparison to
   report exactly that property — a check that cannot fail is not a check. */
const CONGRESS = CANVAS_CASES[0]!;
const SIGNALS = CANVAS_CASES[4]!;
const hasFinding = (fs: Finding[], band: RegExp, check: RegExp): boolean => fs.some((f) => f.record === null && band.test(f.band) && check.test(f.check));

test('T2.9 control: the header ledger — tone, value letter-spacing, label-to-value gap', async ({ page, browser }) => {
  await openRoute(page, CONGRESS);
  const clean = unrecorded((await compareRoute(page, browser, CONGRESS)).findings).filter((f) => f.band.startsWith("ledger"));
  expect(clean, `the ledger matches the canvas before any defect is planted:\n${formatFindings(clean)}`).toEqual([]);
  /* SENATE PARSE in --tone-ink (the renderer picks the wrong tone) */
  await page.evaluate(() => { document.querySelectorAll("dl.design-ledger > .ledger-fig").forEach((f) => { if (/senate parse/i.test(f.querySelector("dt")!.textContent!)) f.setAttribute("data-tone", "ink"); }); });
  let fs = (await compareRoute(page, browser, CONGRESS)).findings;
  expect(hasFinding(fs, /^ledger SENATE PARSE$/, /^tone \(the canvas's figure\)$/), "control: SENATE PARSE in --tone-ink fails").toBe(true);
  await openRoute(page, CONGRESS);
  /* the same defect by CSS: the value leaves its figure's own token */
  await page.addStyleTag({ content: '.ledger-fig[data-tone="blue"] > .ledger-value { color: var(--tone-ink) !important; }' });
  fs = (await compareRoute(page, browser, CONGRESS)).findings;
  expect(hasFinding(fs, /^ledger SENATE PARSE$/, /^value colour is --tone-blue$/), "control: a value painted off its tone token fails").toBe(true);
  await openRoute(page, CONGRESS);
  await page.addStyleTag({ content: ".ledger-value { letter-spacing: 0 !important; }" });
  fs = (await compareRoute(page, browser, CONGRESS)).findings;
  expect(hasFinding(fs, /^ledger /, /^value role \(letter-spacing\)$/), "control: letter-spacing:0 fails").toBe(true);
  await openRoute(page, CONGRESS);
  await page.addStyleTag({ content: ".ledger-fig > dt { margin-bottom: 8px !important; }" });
  fs = (await compareRoute(page, browser, CONGRESS)).findings;
  expect(hasFinding(fs, /^ledger /, /^label-to-value gap$/), "control: an 8px label-to-value gap fails").toBe(true);
});

test('T2.9 control: the segmented control — outline, dividers, active state', async ({ page, browser }) => {
  await openRoute(page, CONGRESS);
  const clean = (await compareRoute(page, browser, CONGRESS)).seg;
  expect(clean, `the groups meet the tokens before any defect is planted:\n${formatFindings(clean)}`).toEqual([]);
  await page.addStyleTag({ content: ":is(.seg, .chips, .mgr-chips) > * { border-left-width: 0 !important; }" });
  let seg = (await compareRoute(page, browser, CONGRESS)).seg;
  expect(hasFinding(seg, /^control /, /^divider width$/), "control: dividers removed fails").toBe(true);
  await openRoute(page, CONGRESS);
  await page.addStyleTag({ content: ':is(.seg, .chips, .mgr-chips) > [aria-pressed="true"] { color: var(--seg-text) !important; }' });
  seg = (await compareRoute(page, browser, CONGRESS)).seg;
  expect(hasFinding(seg, /^control /, /^active text --seg-text-active$/), "control: an active item in --seg-text fails").toBe(true);
});

test('T2.9 control: the summary card — body colour', async ({ page, browser }) => {
  await openRoute(page, SIGNALS);
  const bodyFindings = (fs: Finding[]): Finding[] => unrecorded(fs).filter((f) => /^cards$/.test(f.band) && /^body (colour|role)/.test(f.check));
  const clean = bodyFindings((await compareRoute(page, browser, SIGNALS)).findings);
  expect(clean, `the card bodies match before any defect is planted:\n${formatFindings(clean)}`).toEqual([]);
  await page.addStyleTag({ content: ".design-story p { color: var(--ink2) !important; }" });
  const fs = (await compareRoute(page, browser, SIGNALS)).findings;
  expect(hasFinding(fs, /^cards$/, /^body colour is --ink3$/), "control: a card body in --ink2 fails").toBe(true);
});

test('T2.9 control: an unrecorded difference fails', async ({ page, browser }) => {
  await openRoute(page, CONGRESS);
  const leaders = (fs: Finding[]): Finding[] => unrecorded(fs).filter((f) => /^table Leaders/.test(f.band) && /^header /.test(f.check));
  expect(leaders((await compareRoute(page, browser, CONGRESS)).findings), "the Leaders header matches the canvas before the plant").toEqual([]);
  /* a 13px header on ONE band, in no record */
  await page.addStyleTag({ content: "#members-section th { font-size: 13px !important; }" });
  const planted = leaders((await compareRoute(page, browser, CONGRESS)).findings);
  expect(planted.some((f) => /role \(size\)/.test(f.check)), "control: a planted 13px header size fails T2.9").toBe(true);
});

/* The M3 kind-vocabulary allowances are milestone-scoped: they hold while the
   tree is before m3 and expire by themselves at m3, when the same routes must
   show the canvas's words (T3.1, T3.2). Control: the comparison run as of m3
   reports the member's PURCHASE/SALE and net-flow words, and the feed's LATE
   word, as unrecorded. */
test('T2.9: the M3-scoped allowances expire at m3', async ({ page, browser }) => {
  const scoped = ALLOWED_DEVIATIONS.filter((d) => d.until);
  /* + table.role.notable.m3 (DESIGN-POLISH M2 review Q2-8: the directory's
     latest-notable role, surfaced once the directory was measured with rows) */
  expect(scoped.map((d) => d.id).sort()).toEqual(["kind.late.word.m3", "kind.netflow.word.m3", "kind.qoq.chip.m3", "kind.side.word.m3", "table.role.notable.m3"]);
  expect(scoped.every((d) => d.until === "m3")).toBe(true);
  expect(milestoneIndex(CURRENT_MILESTONE), "this tree is before m3, so they are in force").toBeLessThan(milestoneIndex("m3"));
  for (const d of scoped) {
    expect(allowedAt(CURRENT_MILESTONE).some((x) => x.id === d.id), `${d.id} in force now`).toBe(true);
    expect(allowedAt("m3").some((x) => x.id === d.id), `${d.id} expired at m3`).toBe(false);
  }
  const MEMBER = CANVAS_CASES[2]!;
  await openRoute(page, MEMBER);
  const now = unrecorded((await compareRoute(page, browser, MEMBER)).findings).filter((f) => / kind word$/.test(f.check));
  expect(now, `the member's kind words are answered now:\n${formatFindings(now)}`).toEqual([]);
  const atM3 = unrecorded((await compareRoute(page, browser, MEMBER, "m3")).findings);
  expect(hasFinding(atM3, /^table All disclosed transactions/, /^(buy|sell) kind word$/), "control: PURCHASE/SALE fails at m3").toBe(true);
  expect(hasFinding(atM3, /^table Flows by ticker/, /^net(buy|sell) kind word$|^flat kind word$/), "control: BUY/SELL/MIXED net-flow words fail at m3").toBe(true);
  await openRoute(page, CONGRESS);
  const feedLate = (fs: Finding[]): Finding[] => fs.filter((f) => /^table Disclosure feed/.test(f.band) && /^late row kind word/.test(f.check));
  const lateNow = feedLate((await compareRoute(page, browser, CONGRESS)).findings);
  if (lateNow.length) {
    expect(lateNow.every((f) => f.record !== null), "the feed's LATE word is answered now").toBe(true);
    expect(feedLate(unrecorded((await compareRoute(page, browser, CONGRESS, "m3")).findings)).length, "control: the feed's LATE word fails at m3").toBeGreaterThan(0);
  }
});

// Compare against the independent export's rendered row, not an app-generated golden.
test('Congress desktop row geometry matches the supplied design canvas', async ({page}, info) => {
  await page.setViewportSize({width:1520,height:1000});
  await page.route('http://design-reference.local/**', async route => {
    const requested = decodeURIComponent(new URL(route.request().url()).pathname).slice(1);
    const root = path.resolve(import.meta.dirname, '../../../docs/design/reference');
    const file = path.resolve(root, requested);
    if (!file.startsWith(root + path.sep)) return route.abort();
    await route.fulfill({path:file,contentType:requested.endsWith('.js') ? 'text/javascript' : requested.endsWith('.woff2') ? 'font/woff2' : 'text/html'});
  });
  await page.goto('http://design-reference.local/Congress.dc.html');
  const referenceRow = page.locator('div[style*="58px"][style*="grid-template-columns"][style*="align-items"]').first();
  await expect(referenceRow).toBeVisible();
  await page.evaluate(()=>document.fonts.ready);
  const expected = await referenceRow.evaluate(el=>({height:el.getBoundingClientRect().height,width:el.getBoundingClientRect().width,columns:getComputedStyle(el).gridTemplateColumns}));
  await page.screenshot({path:info.outputPath('congress-original.png'),fullPage:true});
  await page.setViewportSize({width:1440,height:1000});
  await page.goto('/congress/');
  await page.evaluate(()=>document.fonts.ready);
  const actual = await page.locator('.reference-row').first().evaluate(el=>({height:el.getBoundingClientRect().height,width:el.getBoundingClientRect().width,columns:getComputedStyle(el).gridTemplateColumns}));
  expect(Math.abs(actual.height-expected.height),'record density must match the independent design').toBeLessThanOrEqual(1);
  expect(actual.width).toBe(expected.width);
  const expectedColumns=expected.columns.split(' ').map(parseFloat);
  const actualColumns=actual.columns.split(' ').map(parseFloat);
  expect(actualColumns).toHaveLength(expectedColumns.length);
  actualColumns.forEach((width,i)=>expect(Math.abs(width-expectedColumns[i]!)).toBeLessThanOrEqual(1));
  await page.screenshot({path:info.outputPath('congress-implementation.png'),fullPage:true});
});

test('compact feed paging and row flags remain usable', async ({page}) => {
  await page.setViewportSize({width:1440,height:1000});
  await page.goto('/congress/');
  const first = await page.locator('.reference-row').first().textContent();
  await expect(page.locator('#pager-older')).toHaveAttribute('aria-disabled','false');
  await page.locator('#pager-older').click();
  await expect(page.locator('#filter-count-line')).toContainText('51–100');
  await expect(page.locator('.reference-row')).toHaveCount(50);
  expect(await page.locator('.reference-row').first().textContent()).not.toBe(first);
  await page.locator('#pager-newer').click();
  await expect(page.locator('#filter-count-line')).toContainText('1–50');
  /* DESIGN-POLISH M1 (H-17): a row's flags are VISIBLE chips in the range
     cell, never inside a note panel — and each chip OPENS ITS OWN definition,
     one interaction away, as the row's single flag note did before (M1 review,
     the coordinator's ruling on D7; the text is the site's existing copy). */
  const flag = page.locator('.reference-row .cell-range .flag').first();
  await expect(flag).toBeVisible();
  expect(await flag.evaluate(el => !el.closest('.note-pop'))).toBe(true);
  await expect(page.locator('.reference-flags')).toHaveCount(0);
  const chips = page.locator('.reference-row .cell-range .flag');
  const n = Math.min(await chips.count(), 8);
  expect(n, 'the first page carries flag chips').toBeGreaterThan(0);
  const opened = new Set<string>();
  for (let i = 0; i < n; i++) {
    const trigger = chips.nth(i).locator('.note-label');
    await expect(trigger, `chip ${i} is its definition's trigger`).toHaveCount(1);
    const id = (await trigger.getAttribute('popovertarget'))!;
    expect(opened.has(id), `chip ${i} opens its OWN panel, not another chip's`).toBe(false);
    opened.add(id);
    await trigger.click();
    const panel = page.locator(`[id="${id}"]`);
    await expect(panel, `chip ${i}'s definition opens`).toBeVisible();
    expect(((await panel.textContent()) ?? '').trim().length, `chip ${i}'s definition says something`).toBeGreaterThan(10);
    await page.keyboard.press('Escape');
  }
});
