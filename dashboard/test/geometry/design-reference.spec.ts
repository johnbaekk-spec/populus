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
import { CURRENT_MILESTONE, type Milestone } from "./milestones.ts";

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
   - /congress/: none since launch M3b (R22) — the briefing cards and their
     "Notes on this data" drawer are retired; their facts live in the ledger,
     the feed and the provenance line;
   - member and filer pages: none since the launch redesign — the member
     page's context disclosure keeps its recent disclosures and committee
     context but no summary cards (M4b, R23/R26), and the filer's "Notes on
     this data" cards are retired (M6, copy item filer-11);
   - /signals/: none since signals-v3 M2 — its three summary cards became the
     lead cards (record SV3-M2), asserted in the route block below;
   - /institutional/: none. */
const CARDS: Record<(typeof references)[number][1], { count: number; where: "notes" | "context" | "visible" | "none" }> = {
  "/congress/": { count: 0, where: "none" },
  "/institutional/": { count: 0, where: "none" },
  "/congress/members/M001193/": { count: 0, where: "none" },
  "/institutional/filers/1067983/": { count: 0, where: "none" },
  "/signals/": { count: 0, where: "none" },
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
        /* signals-v4 R17 (LD18): the named moves, Consensus and the leaders
           moved to /signals/#institutional; the landing keeps the directory
           and Recent activity, and points to the moved sections. */
        for (const title of ["Filer directory", "Recent activity"]) {
          await expect(page.getByRole('heading', {name:title, exact:true})).toBeVisible();
        }
        for (const gone of ["Notable managers — latest named moves", "Consensus", "Conviction leaders"]) {
          await expect(page.getByRole('heading', {name:gone, exact:true})).toHaveCount(0);
        }
        await expect(page.locator('p.inst-moved a[href="/signals/#institutional"]')).toBeVisible();
      }
      if (route.includes('/members/')) {
        /* R16: the empty annual/overlap frames are one planned line. launch
           M4b (R23, LD24): the active layout names its sections Quarterly flow
           and Trades (main), Top tickers and Profile (side), then the filing
           history — the same four facts, retitled with the approved board */
        for (const title of ['Quarterly flow', 'Trades', 'Top tickers', 'Profile', 'Filing history']) {
          await expect(page.getByRole('heading', {name:title, exact:true})).toBeVisible();
        }
        /* T2.10 (:52), R12: the transactions head follows the table's column
           set (presentColumns: Owner and Ticker by presence), not a fixed 8. */
        await expectHeadFollowsColumns(page, '[data-entity-table]', 'the member transactions table');
      }
      if (route === '/signals/') {
        /* signals-v3 M2 (R10–R13, LD7): the triage page — the head, the lead
           cards, then Filings to read │ Hit rate by family above the slim hits.
           signals-v4 M1 (R7, LD7): where the band stacks (≤1080px) the pane
           switch shows Filings first; the hits are one tap away. */
        for (const title of ['Lead cards', 'Filings to read']) {
          await expect(page.getByRole('heading', {name:title, exact:true})).toBeVisible();
        }
        /* signals-v4 M2: the Institutional tab has its own three-pane switch;
           this one is the Congress panel's (Filings │ Hits) */
        const paneSwitch = page.locator('#congress [data-pane-switch]');
        expect(await paneSwitch.isVisible(), 'the pane switch shows exactly where the band stacks').toBe(width <= 1080);
        if (width <= 1080) await paneSwitch.locator('button[aria-controls="signals-side"]').click();
        for (const title of ['Hit rate by family', 'Hits']) {
          await expect(page.getByRole('heading', {name:title, exact:true})).toBeVisible();
        }
        // the rule book and the lag distribution moved to Methodology; the watch band left in M1
        for (const gone of ['Lag distribution', 'Rule book', 'Signal rule book', 'Watchlist']) {
          await expect(page.getByRole('heading', {name:gone, exact:true})).toHaveCount(0);
        }
        await expect(page.locator('#signal-watch, #signal-rules, #signal-rulebook, #signal-lag, .si-evidence-row, .si-hit-filter')).toHaveCount(0);
        /* signals-v4 LD9: one ledger group per tab; Congress's shows */
        await expect(page.locator('main .page-head [data-tab-for="congress"] .ledger-fig')).toHaveCount(3);
        for (const f of await page.locator('main .page-head [data-tab-for="congress"] .ledger-fig').all()) await expect(f).toBeVisible();
        await expect(page.locator('main .page-head [data-tab-for="institutional"]')).toBeHidden();
        // the three lead cards show on the page, each with both dates
        const cards = page.locator('#lead-cards .si-card');
        await expect(cards).toHaveCount(3);
        for (const c of await cards.all()) await expect(c).toBeVisible();
        // the tiers: Stands out and Worth a look open, Routine a CLOSED disclosure
        expect(await page.locator('#triage > #stands, #triage > #look').count()).toBe(2);
        if (width <= 1080) await paneSwitch.locator('button[aria-controls="triage"]').click();
        expect(await page.locator('#routine').evaluate((d) => d.tagName === 'DETAILS' && !(d as HTMLDetailsElement).open), 'Routine is closed').toBe(true);
        // every triage row shows its four meters, both dates and its receipt
        const rows = page.locator('#stands article.si-row, #look article.si-row');
        const n = await rows.count();
        for (let i = 0; i < Math.min(n, 5); i++) {
          const r = rows.nth(i);
          await expect(r.locator('.si-meter[role="img"]')).toHaveCount(4);
          await expect(r.locator('.si-row-filed time')).toBeVisible();
          await expect(r.locator('.si-row-src a')).toBeVisible();
        }
        if (width <= 1080) await paneSwitch.locator('button[aria-controls="signals-side"]').click();
        /* the slim hits: six columns, Kind first; the server holds at most
           SIGNAL_HITS_DOM_ROWS (40) lines, each with its receipt, and the fit
           (signals-v4 LD6) shows at least ten of them — exactly ten where the
           band stacks */
        await expect(page.locator('#hits thead th')).toHaveCount(6);
        await expect(page.locator('#hits thead th').first()).toHaveText(/^\s*kind\s*$/i);
        const all = await page.locator('#signal-hits-body tr.si-hit').count();
        expect(all).toBeLessThanOrEqual(40);
        expect(await page.locator('#signal-hits-body tr.si-hit td.c-src a').count()).toBe(all);
        const VIS = '#signal-hits-body tr.si-hit:not([hidden])';
        const lines = Number(await page.locator('#hits').getAttribute('data-lines'));
        const shown = await page.locator(VIS).count();
        expect(shown).toBeGreaterThanOrEqual(Math.min(10, lines));
        if (width <= 1080) expect(shown, 'stacked: the minimum').toBe(Math.min(10, lines));
        // "Show 10 more" grows the view by ten, in the range grammar
        const L = lines.toLocaleString('en-US');
        await expect(page.locator('#signal-hits-range')).toHaveText(new RegExp(`^1–${shown} of ${L} lines? · \\d[\\d,]* hits?$`));
        if (lines > shown) {
          await page.locator('#signal-hits-more').click();
          await expect(page.locator(VIS)).toHaveCount(Math.min(shown + 10, lines));
          await expect(page.locator('#signal-hits-range')).toHaveText(new RegExp(`^1–${Math.min(shown + 10, lines)} of ${L} lines · \\d[\\d,]* hits$`));
        }
        // a family row filters the hits and shows the removable pill; the pill clears it
        const fam = page.locator('#families button[data-family="BEHAVIOUR"]');
        await fam.click();
        await expect(fam).toHaveAttribute('aria-pressed', 'true');
        await expect(page.locator('#signal-family-pill-row')).toBeVisible();
        await expect(page.locator('#signal-hits-body tr.si-hit:not([data-family="BEHAVIOUR"])')).toHaveCount(0);
        await page.locator('#signal-family-pill').click();
        await expect(fam).toHaveAttribute('aria-pressed', 'false');
        await expect(page.locator('#signal-family-pill-row')).toBeHidden();
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
        // launch M3a (LD20): twenty rows a page, in the default "With ticker" view
        await expect(page.locator('.reference-feed .reference-row')).toHaveCount(20);
        if (width === 1440) {
          // DESIGN-POLISH M1: the ledger's 30px feed row (±1) — EVERY row on
          // the page, the rows carrying visible flag chips (and their
          // definition triggers) included; no row is exempt (M1 review Q-5).
          const rows = await page.locator('.reference-feed .reference-row').evaluateAll(els => els.map((el, i) => ({
            i, height: Math.round(el.getBoundingClientRect().height * 10) / 10, chips: el.querySelectorAll('.cell-range .flag').length,
          })));
          expect(rows.filter(r => Math.abs(r.height - 30) > 1), 'every feed row is 30±1px').toEqual([]);
          /* launch M3a (R20): the default "With ticker" page may carry no flag
             (20261019.2: none), so the chip rows are pinned on the "All rows"
             page, whose rows a flag marks most ("no ticker") */
          await page.locator('#feed-section button[data-group="view"][data-value="all"]').click();
          await expect(page.locator('.reference-feed .reference-row .cell-range .flag').first()).toBeVisible();
          const allRows = await page.locator('.reference-feed .reference-row').evaluateAll(els => els.map((el, i) => ({
            i, height: Math.round(el.getBoundingClientRect().height * 10) / 10, chips: el.querySelectorAll('.cell-range .flag').length,
          })));
          expect(allRows.filter(r => Math.abs(r.height - 30) > 1), 'every All rows feed row, the chip rows included, is 30±1px').toEqual([]);
          expect(allRows.some(r => r.chips >= 1), 'the page carries flagged rows, so the pin measures chip rows too').toBe(true);
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
        /* scoped to the holdings surface: the changes table above it is also
           `data-sticky-issuer` once it carries a Ticker column (premarketing) */
        await expectHeadFollowsColumns(page, '[data-holdings-surface="filer"] [data-sticky-issuer]', 'the reported positions table');
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
        let record = page.locator('[data-holdings-surface="filer"] [data-sticky-issuer] tbody .note-btn:visible').first();
        if (!(await record.count())) {
          await page.locator('[data-holdings-surface="filer"] .compact-toggle').click();
          record = page.locator('[data-holdings-surface="filer"] [data-sticky-issuer] tbody .note-btn:visible').first();
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

test('Congress composition at 1440 (T2.2 → launch M3b): the R18 ledger, band C1 after the provenance, the feed, Monthly flow last', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  expect((await page.goto('/congress/'))?.status()).toBe(200);
  /* D2 (L15): the four ledger labels, in order, uppercased by CSS — the
     source is a figure name, "parse" is never reader prose in caps */
  const labels = await page.locator('main dl.design-ledger > .ledger-fig > dt').evaluateAll((dts) => dts.map((dt) => {
    const trigger = dt.querySelector('.note-label') ?? dt;
    const own = Array.from(trigger.childNodes).filter((n) => n.nodeType === Node.TEXT_NODE).map((n) => n.textContent).join('').trim();
    return { rendered: (dt as HTMLElement).innerText.replace(/\s+/g, ' ').trim(), source: own, transform: getComputedStyle(trigger).textTransform };
  }));
  // launch M3b (R18): Trades, Last 30 days, Median lag, E-filings read
  expect(labels.map((l) => l.rendered)).toEqual(['TRADES', 'LAST 30 DAYS', 'MEDIAN LAG', 'E-FILINGS READ']);
  for (const l of labels) {
    expect(l.transform, `${l.rendered}: the caps are CSS caps`).toBe('uppercase');
    expect(l.source, `${l.rendered}: the source label is not typed in caps`).not.toBe(l.source.toUpperCase());
  }
  /* launch M3b (R19, R22): the boards band directly follows the provenance
     strip — the notes drawer and its briefing cards are retired */
  const after = await page.evaluate(() => document.querySelector('main .design-provenance')?.nextElementSibling?.id ?? '');
  expect(after).toBe('congress-leaders-band');
  await expect(page.locator('#congress-notes')).toHaveCount(0);
  await expect(page.locator('main .design-briefing')).toHaveCount(0);
  /* band C1: Members │ Tickers, one band, before the feed; Monthly flow last (R21) */
  const c1 = await partsInOrder(page, ['#congress-leaders-band', '#feed-section', '#monthly-flow-section']);
  expect(c1.missing).toEqual([]);
  expect(c1.domOrder, 'C1, then the feed, then Monthly flow').toBe(true);
  expectVisualOrder(c1.tops, 'C1, the feed, Monthly flow');
  await expect(page.locator('#congress-leaders-band.design-rankings > #members-section + #momentum-section')).toHaveCount(1);
});

/* launch M4b (R23, LD24, D-decision record "member layout pins"): the member
   page's bands M1 (Net flow │ Profile) and M2 (Filing history │ Signals) and
   its PLANNED strip are retired. Properties kept, mechanisms replaced: the
   parts' DOM order is their visual order; the page reads as two columns at
   1440 — main (Quarterly flow, then Trades) beside the side column (Top
   tickers, Profile at 10+ trades, Sectors, Signals, in that order) — with the
   filing history standing alone after them and the context disclosures
   collapsed at the foot; a member with three or fewer trades reads the
   compact layout (cards, then the three computed facts) and no chart. The
   empty-window chart rule (R13) is unchanged. */
test('Member composition at 1440 (T2.3 → launch M4b R23/LD24): main (chart → trades) │ side (Top tickers → Profile → Sectors → Signals), then filing history, then the collapsed context', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  expect((await page.goto('/congress/members/M001193/'))?.status()).toBe(200);
  const layout = await page.evaluate(() => document.querySelector('[data-member-layout]')?.getAttribute('data-member-layout') ?? null);
  expect(['active', 'compact'], 'the page states its layout').toContain(layout);
  test.info().annotations.push({ type: 'layout', description: String(layout) });
  if (layout === 'compact') {
    /* LD24: three or fewer trades — the cards (or the paper-only line), then
       the three computed facts; no chart and no side column */
    const order = await partsInOrder(page, ['main header.member-head', 'main .member-compact', 'main .member-compact dl.member-facts']);
    expect(order.missing).toEqual([]);
    expect(order.domOrder, 'head → cards → facts, in the DOM').toBe(true);
    expectVisualOrder(order.tops, 'the compact member page');
    await expect(page.locator('main .member-grid, main .design-member-chart')).toHaveCount(0);
    return;
  }
  /* the main column, in order */
  const mainOrder = await partsInOrder(page, ['main header.member-head', 'main .member-main > .design-member-chart', 'main .member-main > section.member-trades']);
  expect(mainOrder.missing).toEqual([]);
  expect(mainOrder.domOrder, 'head → Quarterly flow → Trades, in the DOM').toBe(true);
  expectVisualOrder(mainOrder.tops, 'the main column');
  /* main │ side, side by side at 1440 (LD24: the active layout's two columns) */
  const cols = await page.evaluate(() => {
    const box = (sel: string) => {
      const r = document.querySelector(sel)!.getBoundingClientRect();
      return { top: Math.round(r.top + scrollY), left: r.left, right: r.right, width: r.width };
    };
    return { main: box('main .member-grid > .member-main'), side: box('main .member-grid > .member-side') };
  });
  expect(Math.abs(cols.main.top - cols.side.top), 'the two columns start together').toBeLessThanOrEqual(2);
  expect(cols.main.right, 'the side column sits to the right of main').toBeLessThanOrEqual(cols.side.left + 1);
  expect(cols.main.width, 'main is the wider column').toBeGreaterThan(cols.side.width);
  /* the side column: Top tickers, Profile (10+ trades), Sectors (2+ sectors, or its one unavailable line), Signals — DOM order = visual order */
  const side = await page.locator('main .member-side > section').evaluateAll((ss) =>
    ss.filter((s) => s.checkVisibility()).map((s) => ({ label: s.getAttribute('aria-label') ?? '', top: Math.round(s.getBoundingClientRect().top + scrollY) })),
  );
  const labels = side.map((s) => s.label);
  expect(labels[0], 'Top tickers leads the side column').toBe('Top tickers');
  expect(labels[labels.length - 1], 'Signals closes it').toBe('Signals');
  const known = ['Top tickers', 'Profile', 'Sectors', 'Signals'];
  expect(labels.filter((l) => known.includes(l)), 'in the layout order').toEqual(known.filter((k) => labels.includes(k)));
  expectVisualOrder(side.map((s) => s.top), 'the side column');
  /* the filing history stands alone after the two columns (R23: no longer
     paired with Signals), and the context disclosures close the page, collapsed */
  const foot = await page.evaluate(() => {
    const grid = document.querySelector('main .member-grid')!;
    const g = grid.getBoundingClientRect();
    const hist = document.querySelector('main section.design-member-history');
    const h = hist?.getBoundingClientRect() ?? null;
    const ctx = Array.from(document.querySelectorAll<HTMLDetailsElement>('main > details.design-supplement'));
    return {
      history: hist ? { after: !!(grid.compareDocumentPosition(hist) & Node.DOCUMENT_POSITION_FOLLOWING), inGrid: grid.contains(hist), top: h!.top, gridBottom: g.bottom, left: h!.left, gridLeft: g.left } : null,
      context: ctx.map((d) => ({ open: d.open, after: !!(grid.compareDocumentPosition(d) & Node.DOCUMENT_POSITION_FOLLOWING) })),
    };
  });
  if (foot.history) {
    expect(foot.history.inGrid, 'the history is not inside the two columns').toBe(false);
    expect(foot.history.after, 'it follows them in the DOM').toBe(true);
    expect(foot.history.top, 'and below them on screen').toBeGreaterThanOrEqual(foot.history.gridBottom - 1);
    expect(Math.abs(foot.history.left - foot.history.gridLeft), 'on the page edge, unpaired').toBeLessThanOrEqual(1);
  }
  test.info().annotations.push({ type: 'history', description: foot.history ? 'filing history present' : 'one filing: no history table (LD24, 2+ filings)' });
  expect(foot.context.length, 'the context disclosures are present').toBeGreaterThan(0);
  expect(foot.context.every((c) => c.after && !c.open), 'after the columns, collapsed').toBe(true);
  await expect(page.locator('main p.planned-line'), 'the PLANNED strip is retired (member-18)').toHaveCount(0);
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

test('Institutional composition at 1440 (T2.4 → signals-v4 R17, LD18): the pointer, then the directory, then Recent activity full width; collapsed adds; three one-line figures; no band I1', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  expect((await page.goto('/institutional/'))?.status()).toBe(200);
  const heads = await page.locator('main h2.section-h').evaluateAll((hs) => hs.filter((h) => h.checkVisibility()).map((h) => ({ text: h.textContent!.replace(/\s+/g, ' ').trim(), top: Math.round(h.getBoundingClientRect().top + scrollY) })));
  const at = (re: RegExp): number => heads.findIndex((h) => re.test(h.text));
  const directory = at(/^Filer directory$/), activity = at(/^Recent activity$/);
  expect([directory, activity].every((i) => i >= 0), `every band heading is present: ${heads.map((h) => h.text).join(' | ')}`).toBe(true);
  expect(directory).toBeLessThan(activity);
  expect(heads[directory]!.top).toBeLessThan(heads[activity]!.top);
  for (const re of [/^Notable managers/, /^Consensus$/, /^Conviction leaders$/]) expect(at(re), `${re} moved to /signals/#institutional`).toBe(-1);
  /* the one-line pointer sits between the provenance line and the directory */
  const order = await page.evaluate(() => {
    const top = (sel: string) => document.querySelector(sel)?.getBoundingClientRect().top ?? null;
    return { prov: top('.design-provenance'), moved: top('p.inst-moved'), dir: top('#inst-managers-section') };
  });
  expect(order.prov !== null && order.moved !== null && order.dir !== null && order.prov < order.moved && order.moved < order.dir, JSON.stringify(order)).toBe(true);
  await expect(page.locator('.design-consensus-band, #inst-consensus, #inst-notable-moves, .planned-line')).toHaveCount(0);
  /* Recent activity is full width, in no pair */
  const activityBand = await page.locator('main section', { has: page.locator('h2.section-h', { hasText: /^Recent activity$/ }) }).first().evaluate((s) => ({ inPair: !!s.closest('.design-band, .design-pair'), width: s.getBoundingClientRect().width, main: document.querySelector('main')!.getBoundingClientRect().width }));
  expect(activityBand.inPair, 'Recent activity is not inside a .design-band or .design-pair').toBe(false);
  /* "Recently added issuers" stays in its collapsed disclosure */
  const adds = await page.locator('#inst-adds-section').evaluate((s) => { const d = s.closest('details'); return { inDetails: !!d, open: !!d?.open }; });
  expect(adds).toEqual({ inDetails: true, open: false });
  /* the ledger: three figures, every value on one line (R15) */
  const figs = await page.locator('main dl.design-ledger > .ledger-fig').evaluateAll((fs) => fs.map((f) => {
    const v = f.querySelector('.ledger-value')!;
    const rg = document.createRange();
    rg.selectNodeContents(v);
    const lines = new Set(Array.from(rg.getClientRects()).filter((q) => q.width > 0).map((q) => Math.round(q.top)));
    return { label: (f.querySelector('dt') as HTMLElement).innerText.trim(), value: v.textContent!.trim(), sub: f.querySelector('.ledger-sub')?.textContent?.trim() ?? '', lines: lines.size };
  }));
  expect(figs.map((f) => f.label)).toEqual(['FILERS TRACKED', 'TRACKED VALUE', 'NOTABLE MANAGERS']);
  for (const f of figs) expect(f.lines, `${f.label}: the value is one line`).toBe(1);
  /* control for the one-line rule: a forced two-line value is caught */
  await page.addStyleTag({ content: '.ledger-value { white-space: normal !important; word-break: break-all !important; width: 1ch !important; }' });
  const forced = await page.locator('main dl.design-ledger .ledger-value').first().evaluate((v) => { const rg = document.createRange(); rg.selectNodeContents(v); return new Set(Array.from(rg.getClientRects()).filter((q) => q.width > 0).map((q) => Math.round(q.top))).size; });
  expect(forced, 'control: a wrapped value measures more than one line').toBeGreaterThan(1);
});
test('signals-v4 T2.4 / T2.6: /signals/#institutional at 1440 — the tab selected, its three one-line figures (the Top add a ticker, a count, or a stated absence), the band Named moves │ Consensus above the leaders, or collapsed to the side column with the stated zero under it', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  expect((await page.goto('/signals/#institutional'))?.status()).toBe(200);
  await expect(page.locator('#tab-institutional')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#institutional')).toBeVisible();
  await expect(page.locator('#congress')).toBeHidden();
  for (const title of ['Lead cards', 'Named moves', 'Consensus', 'Conviction leaders']) {
    await expect(page.locator('#institutional').getByRole('heading', { name: title, exact: true })).toBeVisible();
  }
  const figs = await page.locator('main [data-tab-for="institutional"] .ledger-fig').evaluateAll((fs) => fs.map((f) => {
    const v = f.querySelector('.ledger-value')!;
    const rg = document.createRange();
    rg.selectNodeContents(v);
    const lines = new Set(Array.from(rg.getClientRects()).filter((q) => q.width > 0).map((q) => Math.round(q.top)));
    return { label: (f.querySelector('dt') as HTMLElement).innerText.trim(), value: v.textContent!.trim(), sub: f.querySelector('.ledger-sub')?.textContent?.trim() ?? '', lines: lines.size, visible: f.checkVisibility() };
  }));
  expect(figs.map((f) => f.label)).toEqual(['MOVES', 'TOP ADD', 'QUARTER']);
  for (const f of figs) {
    expect(f.visible, `${f.label} shows on its tab`).toBe(true);
    expect(f.lines, `${f.label}: the value is one line`).toBe(1);
  }
  const add = figs[1]!;
  if (add.value === '—') {
    expect(add.sub, 'no qualifying name: the sub states the absence').toMatch(/^no\b/i);
    test.info().annotations.push({ type: 'top-add', description: `no Consensus on this build: "—" / "${add.sub}"` });
  } else if (/ managers?$/.test(add.value)) {
    expect(add.sub, 'a name no reviewed ticker maps: its filed name leads the sub').toMatch(/ · no reviewed ticker$/);
  } else {
    expect(add.value, 'the value is a ticker, never the issuer name').toMatch(/^[A-Z][A-Z0-9.\-]{0,9}$/);
    expect(add.sub).toMatch(/^\d[\d,]* notable managers? opened it$/);
  }
  /* the band (LD6): a pair, Named moves the wider primary on the left — or,
     where the Named moves are their one stated line (this build's registry
     marks no notable manager), collapsed with the line under the side column */
  const band = await page.evaluate(() => {
    const b = document.querySelector('#institutional .sig-inst-band')!;
    const cells = Array.from(b.children).filter((c) => c.checkVisibility()).map((c) => ({
      id: c.id, top: c.getBoundingClientRect().top, bottom: c.getBoundingClientRect().bottom, width: c.getBoundingClientRect().width, left: c.getBoundingClientRect().left,
      primary: c.hasAttribute('data-pair-primary'), line: c.hasAttribute('data-empty-state'),
    }));
    return { collapsed: b.getAttribute('data-collapsed'), cells, align: getComputedStyle(b).alignItems };
  });
  expect(band.align, 'the cells do not stretch (LD6)').toBe('start');
  if (band.collapsed === 'empty-state') {
    expect(band.cells.map((c) => c.id)).toEqual(['inst-side', 'named-moves']);
    expect(band.cells[1]!.top, 'the stated zero sits under the side column').toBeGreaterThanOrEqual(band.cells[0]!.bottom - 1);
    expect(band.cells.map((c) => c.primary)).toEqual([true, false]);
    test.info().annotations.push({ type: 'institutional band', description: 'collapsed: the Named moves are the stated zero on this build' });
  } else {
    expect(band.cells.map((c) => c.id)).toEqual(['named-moves', 'inst-side']);
    expect(Math.abs(band.cells[0]!.top - band.cells[1]!.top), 'side by side').toBeLessThanOrEqual(2);
    expect(band.cells[0]!.width, 'the Named moves are the wider primary').toBeGreaterThan(band.cells[1]!.width);
    expect(band.cells.map((c) => c.primary)).toEqual([true, false]);
  }
  /* every move row carries its 13F receipt outside its summary, and its filed date */
  const rows = await page.locator('#mv-list article.mv-item').evaluateAll((as) => as.map((a) => ({ src: !!a.querySelector(':scope > a.mv-src, :scope > .mv-src.c-muted'), inSummary: !!a.querySelector('summary a, summary button'), filed: !!a.querySelector('.mv-fil time') })));
  expect(rows.every((r) => r.src && !r.inSummary && r.filed), 'receipt beside, never inside, the summary; the filed date on every row').toBe(true);
  /* the §5 note ships with the tab's 13F data */
  await expect(page.locator('#institutional #inst-data-note')).toHaveCount(1);
});


test('Filer composition at 1440 (T2.5): parts in DOM order = visual order; the period roots', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  expect((await page.goto('/institutional/filers/1067983/'))?.status()).toBe(200);
  /* head → changes → band F1 → EDGAR → the §5 note (launch copy audit
     filer-06 / filer-11: the Planned line and the "Notes on this data" cards
     left the foot) */
  const parts = ['main header.entity-head', 'main [data-filer-root]', 'main .design-filer-band', 'main details.edgar-block', 'main .filer-data-note'];
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

test('Signals composition at 1440 (signals-v3 M2, LD7): head → lead cards → S1 (Filings to read │ families above hits) → the Methodology links; no rule book, lag or watch band', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  expect((await page.goto('/signals/'))?.status()).toBe(200);
  const s1 = await page.evaluate(() => {
    const band = document.querySelector('.design-signals-band')!;
    const cells = Array.from(band.children).filter((c) => c.checkVisibility());
    return cells.map((c) => ({ id: c.id, cls: c.getAttribute('class'), primary: c.hasAttribute('data-pair-primary'), top: c.getBoundingClientRect().top, left: c.getBoundingClientRect().left, right: c.getBoundingClientRect().right, heads: Array.from(c.querySelectorAll('h2')).map((h) => h.textContent!.trim()) }));
  });
  expect(s1.length, 'S1 is a pair').toBe(2);
  expect([s1[0]!.id, s1[0]!.primary], 'Filings to read is the left, primary cell').toEqual(['triage', true]);
  expect(s1[1]!.cls, 'the right cell is the side cell').toBe('si-side');
  expect(s1[1]!.heads, 'the right cell holds Hit rate by family, then Hits').toEqual(['Hit rate by family', 'Hits']);
  expect(Math.abs(s1[0]!.top - s1[1]!.top), 'the two cells start at one top').toBeLessThanOrEqual(2);
  expect(s1[0]!.right).toBeLessThanOrEqual(s1[1]!.left + 1);
  const order = await partsInOrder(page, ['main .page-head', 'main #lead-cards', 'main .design-signals-band', 'main #signal-method-links']);
  expect(order.missing).toEqual([]);
  expect(order.domOrder, 'head → lead cards → S1 → Methodology links').toBe(true);
  expectVisualOrder(order.tops, 'the signals page');
  await expect(page.locator('main #signal-watch, main #signal-rules, main #signal-rulebook, main #signal-lag'), 'the watch band left in M1; the rule book and lag moved to Methodology').toHaveCount(0);
  // the moved sections are on Methodology, the rule book still expanded with its seven rules
  expect((await page.goto('/methodology/'))?.status()).toBe(200);
  for (const id of ['signal-rules', 'signal-lag', 'signals-ranking', 'committee-direct']) await expect(page.locator(`#${id}`)).toBeVisible();
  /* launch M7b (R34, LD30): every Methodology section ships <details open>
     (closed by script at ≤720px only), so the rule book sits in an OPEN fold
     at 1440 — expanded, as before, and still never a closed disclosure */
  const rb = await page.locator('#signal-rules').evaluate((s) => { const d = s.closest('details'); return { details: !!d, open: !d || d.open, fold: !!d?.hasAttribute('data-metho-fold'), multiline: s.querySelector('table')!.hasAttribute('data-multiline'), rows: s.querySelectorAll('tbody tr').length }; });
  expect(rb).toEqual({ details: true, open: true, fold: true, multiline: true, rows: 7 });
});

/* signals-v3 M2 (R11, LD6): the ranking control works with JavaScript OFF —
   it is two radio inputs and CSS. Choosing "Absolute $" shows the absolute
   variants of both cards and hides the own-record ones; choosing "Own
   record" restores them. */
test('Signals lead cards (R11): the Own record │ Absolute $ control works with JavaScript disabled', async ({ browser }, info) => {
  const ctx = await browser.newContext({ baseURL: info.project.use.baseURL, javaScriptEnabled: false, viewport: { width: 1440, height: 1000 } });
  try {
    const page = await ctx.newPage();
    expect((await page.goto('/signals/'))?.status()).toBe(200);
    const shown = (rank: string) => page.locator(`#lead-cards .si-variant[data-rank="${rank}"]`).evaluateAll((vs) => vs.filter((v) => v.checkVisibility()).length);
    expect([await shown('record'), await shown('absolute')], 'own record by default').toEqual([2, 0]);
    await page.locator('#lead-cards label[for="si-rank-absolute"]').click();
    expect([await shown('record'), await shown('absolute')], 'absolute $ after its label is chosen').toEqual([0, 2]);
    await page.locator('#lead-cards label[for="si-rank-record"]').click();
    expect([await shown('record'), await shown('absolute')]).toEqual([2, 0]);
    // and the keyboard reaches the radios (clipped, never removed)
    expect(await page.locator('#si-rank-record').evaluate((el) => getComputedStyle(el).display !== 'none' && getComputedStyle(el).visibility !== 'hidden')).toBe(true);
  } finally {
    await ctx.close();
  }
});

/* signals-v3 M2 (R23): at 390 and 360 px /signals/ never scrolls sideways, a
   triage row's meters name themselves, and its dates, owner, LATE tags and
   receipt stay rendered; each lead card keeps both dates. signals-v4 M1 (R3,
   LD4): the meter's short name (Size, Patt, Oth, Cmte — the desktop column
   head's) sits over its bars on a phone, so four labelled meters share the
   row's second line with the filer. */
for (const width of [390, 360]) {
  test(`Signals at ${width}px (R23): no sideways scroll; each meter labelled over its bars; dates, owner and receipts kept`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    expect((await page.goto('/signals/'))?.status()).toBe(200);
    const m = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, vw: innerWidth }));
    expect(m.sw, 'the page never scrolls sideways').toBeLessThanOrEqual(m.vw + 1);
    const row = page.locator('#stands article.si-row, #look article.si-row').first();
    await row.scrollIntoViewIfNeeded();
    const facts = await row.evaluate((a) => {
      const vis = (sel: string) => Array.from(a.querySelectorAll(sel)).filter((e) => (e as HTMLElement).checkVisibility() && e.getBoundingClientRect().width > 1);
      const labels = Array.from(a.querySelectorAll<HTMLElement>('.si-meter')).map((meter) => {
        const label = meter.querySelector<HTMLElement>('.si-meter-label')!;
        const bars = meter.querySelector<HTMLElement>('.si-meter-bars')!;
        const lr = label.getBoundingClientRect(), br = bars.getBoundingClientRect();
        return { w: lr.width, over: lr.bottom <= br.top + 1, centred: Math.abs((lr.left + lr.right) / 2 - (br.left + br.right) / 2) <= 1.5, text: label.textContent };
      });
      const right = a.getBoundingClientRect().right;
      return {
        labels,
        filed: vis('.si-row-filed time').length,
        traded: vis('.si-row-traded').length,
        owner: vis('.owner-note').length,
        receipt: vis('.si-row-src a').length,
        /* text clipped to 1px for assistive technology (`.visually-hidden`) runs nowhere on screen */
        overflow: Array.from(a.querySelectorAll('*')).filter((e) => !e.closest('.visually-hidden') && e.getBoundingClientRect().right > right + 1).map((e) => e.className).slice(0, 3),
      };
    });
    expect(facts.labels.map((l) => l.text)).toEqual(['Size', 'Patt', 'Oth', 'Cmte']);
    for (const l of facts.labels) {
      expect(l.w, `the ${l.text} label is rendered at ${width}`).toBeGreaterThan(8);
      expect(l.over && l.centred, `the ${l.text} label sits over its bars, centred`).toBe(true);
    }
    expect([facts.filed, facts.traded, facts.owner, facts.receipt], 'filed, traded, owner and receipt are rendered').toEqual([1, 1, 1, 1]);
    expect(facts.overflow, 'nothing in the row runs past it').toEqual([]);
    /* every card that shows a pick shows both dates and its receipt; a card
       with no pick (the committee card on a build without committee data)
       shows its stated empty line instead */
    const cards = await page.locator('#lead-cards .si-card').evaluateAll((cs) => cs.map((c) => {
      const shown = Array.from(c.querySelectorAll<HTMLElement>('.si-card-h')).filter((h) => h.checkVisibility());
      return {
        card: c.getAttribute('data-card'),
        picks: shown.length,
        dated: shown.filter((h) => { const b = h.parentElement!; const d = b.querySelector<HTMLElement>('.si-card-dates'); return !!d && d.checkVisibility() && d.querySelectorAll('time').length === 2 && !!b.querySelector('.si-card-src a, .si-card-src .si-stamp'); }).length,
        empty: Array.from(c.querySelectorAll<HTMLElement>('[data-empty-state]')).filter((e) => e.checkVisibility()).length,
      };
    }));
    expect(cards.map((c) => c.card)).toEqual(['committee', 'buy', 'sell']);
    for (const c of cards) {
      expect(c.picks + c.empty, `the ${c.card} card shows a pick or its stated empty line`).toBeGreaterThan(0);
      expect(c.dated, `every ${c.card} pick shows both dates and its receipt at ${width}`).toBe(c.picks);
    }
  });
}

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
  netbar: "the member ranking's NET FLOW cell is its interval bar with the range as screen-reader text (M1 C-4): no visible text run has a role",
} as const;
/* Launch M3b (LD33, T3.8): the September Congress board leaves this
   comparison — the approved launch Congress board supersedes it (recorded in
   docs/design/reference/README.md); its structural comparison joins with the
   launch-board opener. Launch M4b (LD33; integration): so does the September
   Congress Member board — the active and compact member layouts (R23, LD24)
   supersede its paired bands, recorded in the same README. The cases are
   looked up by file below, never by position. */
const CANVAS_CASES: CanvasCase[] = [
  {
    file: "Institutional.dc.html", route: "/institutional/", release: '#mgr-chips [data-mgr-type][aria-pressed="true"]',
    tables: [
      { label: "Recent activity", selector: ".design-activity table.etable" },
      { label: "Filer directory", selector: "#inst-managers-section table.etable" },
    ],
    map: {
      ledger: true, cards: false,
      tables: [
        {
          canvas: "Recent activity", route: "Recent activity", columns: { "Δ VALUE": "VALUE", "POSITION CHANGE": "Δ POS" },
          empty: "the notable feed lists the curated managers' changes, and the bounded build carries no manager registry (0 of 9,451 filers typed): its one row is the stated empty line",
        },
        { canvas: "Filer directory", route: "Filer directory", roleDeviation: { VALUE: "table.role.number", "LATEST NOTABLE": "table.role.notable.m3" } },
        /* signals-v4 M2 (R17): the canvas's Cluster board and Conviction
           leaders bands have no twin on this route any more — Consensus and
           the leaders moved to /signals/#institutional, where they follow the
           approved Signals v4 mock, not this canvas — so they are not
           compared here, never faked. */
      ],
      heads: [{ canvas: "Recent activity", route: "Recent activity" }],
      pairs: [],
      segs: [{ canvas: "All|Tech|L/S|Multi|Value", route: "notable|…" }],
    },
  },
  {
    /* launch copy audit filer-11: the route's "Notes on this data" cards are
       retired (generic restatements of the provenance line and the §5 box), so
       the canvas's three summary cards have no route twin and are not compared
       (never faked); the ledger, heads, tables and segments still are. */
    file: "Institutional Filer.dc.html", route: "/institutional/filers/1067983/",
    tables: [
      { label: "Position changes", selector: ".design-changes table.etable" },
      { label: "Reported positions", selector: '[data-holdings-surface="filer"] table.etable' },
      { label: "Filing history", selector: ".design-filer-history table.etable" },
    ],
    map: {
      ledger: true, cards: false,
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
      heads: [{ canvas: "Holdings", route: "Changes · …" }, { canvas: "Holdings", route: "Reported positions — …" }, { canvas: "Book shape", route: "Book shape" }, { canvas: "Filing history", route: "Filing history" }],
      pairs: [{ canvas: ["Holdings", "Book shape"], route: ["Reported positions — …", "Book shape"] }],
      segs: [{ canvas: "All|Changed|New|Congress overlap", route: "All|New stakes|…" }],
    },
  },
  {
    file: "Signals.dc.html", route: "/signals/",
    /* signals-v3 M1 (R1): the canvas's "◆ Watchlist" band has no route twin
       any more — the watchlist was removed — so it is not compared (a band
       the route does not have is never faked). */
    /* signals-v3 M2 (record SV3-M2): the owner-approved v3 mock supersedes
       this canvas's composition. The rule book and the lag distribution are on
       /methodology/, the summary cards became the lead cards and the kind
       chips left, so those bands have no route twin here and are not compared
       (never faked); the slim hits table and the band heads that remain are
       still held to the canvas's ledger, header and head roles. */
    tables: [
      { label: "Hits", selector: "#hits table.si-table" },
    ],
    map: {
      ledger: true, cards: false,
      tables: [
        /* R23 (DESIGN-POLISH M3, T3.7): the route's SRC cell is the receipt
           ONCE — its "PTR ↗" link — which is the canvas's RCPT column; the
           slim table's both-dates column answers the canvas's WHEN */
        { canvas: "Hits", route: "Hits", columns: { WHO: "SUBJECT", "TRADED → FILED": "WHEN", SIZE: "MAGNITUDE", SRC: "RCPT" }, unmatched: { TICKER: WHY.ticker }, roleDeviation: { WHO: "table.role.member" } },
      ],
      heads: [{ canvas: "Hits", route: "Hits" }, { canvas: "Hit rate by family", route: "Hit rate by family" }],
      pairs: [],
      segs: [],
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
  await page.setViewportSize({ width: 1440, height: 1000 });
  expect((await page.goto(c.route))?.status(), `${c.route} answers 200`).toBe(200);
  expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor), "the canvas is dark; so is the route").toBe("rgb(4, 7, 13)");
  await page.evaluate(() => document.fonts.ready);
  if (c.open) await page.evaluate((sel) => document.querySelectorAll<HTMLDetailsElement>(sel).forEach((d) => { d.open = true; }), c.open);
  if (c.release) {
    for (const chip of await page.locator(c.release).all()) await chip.click();
    await page.waitForTimeout(300);
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
/* launch M3b/M4b (LD33): the controls ran on the September Congress board,
   which left the comparison; each now runs on a route whose canvas still
   governs it — the filer's ledger, segmented control and tables — looked up
   by file, so removing a case can never shift a control onto another route. */
const canvasCase = (file: string): CanvasCase => {
  const c = CANVAS_CASES.find((x) => x.file === file);
  if (!c) throw new Error(`no canvas case for ${file}`);
  return c;
};
const FILER = canvasCase("Institutional Filer.dc.html");
const hasFinding = (fs: Finding[], band: RegExp, check: RegExp): boolean => fs.some((f) => f.record === null && band.test(f.band) && check.test(f.check));

test('T2.9 control: the header ledger — tone, value letter-spacing, label-to-value gap', async ({ page, browser }) => {
  await openRoute(page, FILER);
  const clean = unrecorded((await compareRoute(page, browser, FILER)).findings).filter((f) => f.band.startsWith("ledger"));
  expect(clean, `the ledger matches the canvas before any defect is planted:\n${formatFindings(clean)}`).toEqual([]);
  /* a figure in the wrong tone (the renderer picks the wrong tone) */
  const fig = await page.evaluate(() => {
    const f = document.querySelector<HTMLElement>("dl.design-ledger > .ledger-fig[data-tone]");
    if (!f) return null;
    const tone = f.getAttribute("data-tone")!;
    f.setAttribute("data-tone", tone === "ink" ? "blue" : "ink");
    return { tone, other: tone === "ink" ? "blue" : "ink" };
  });
  expect(fig, "a toned ledger figure to plant on").not.toBeNull();
  let fs = (await compareRoute(page, browser, FILER)).findings;
  expect(hasFinding(fs, /^ledger /, /^tone \(the canvas's figure\)$/), "control: a figure in the wrong tone fails").toBe(true);
  await openRoute(page, FILER);
  /* the same defect by CSS: the value leaves its figure's own token */
  await page.addStyleTag({ content: `.ledger-fig[data-tone="${fig!.tone}"] > .ledger-value { color: var(--tone-${fig!.other}) !important; }` });
  fs = (await compareRoute(page, browser, FILER)).findings;
  expect(hasFinding(fs, /^ledger /, new RegExp(`^value colour is --tone-${fig!.tone}$`)), "control: a value painted off its tone token fails").toBe(true);
  await openRoute(page, FILER);
  await page.addStyleTag({ content: ".ledger-value { letter-spacing: 0 !important; }" });
  fs = (await compareRoute(page, browser, FILER)).findings;
  expect(hasFinding(fs, /^ledger /, /^value role \(letter-spacing\)$/), "control: letter-spacing:0 fails").toBe(true);
  await openRoute(page, FILER);
  await page.addStyleTag({ content: ".ledger-fig > dt { margin-bottom: 8px !important; }" });
  fs = (await compareRoute(page, browser, FILER)).findings;
  expect(hasFinding(fs, /^ledger /, /^label-to-value gap$/), "control: an 8px label-to-value gap fails").toBe(true);
});

test('T2.9 control: the segmented control — outline, dividers, active state', async ({ page, browser }) => {
  await openRoute(page, FILER);
  const clean = (await compareRoute(page, browser, FILER)).seg;
  expect(clean, `the groups meet the tokens before any defect is planted:\n${formatFindings(clean)}`).toEqual([]);
  await page.addStyleTag({ content: ":is(.seg, .chips, .mgr-chips) > * { border-left-width: 0 !important; }" });
  let seg = (await compareRoute(page, browser, FILER)).seg;
  expect(hasFinding(seg, /^control /, /^divider width$/), "control: dividers removed fails").toBe(true);
  await openRoute(page, FILER);
  await page.addStyleTag({ content: ':is(.seg, .chips, .mgr-chips) > [aria-pressed="true"] { color: var(--seg-text) !important; }' });
  seg = (await compareRoute(page, browser, FILER)).seg;
  expect(hasFinding(seg, /^control /, /^active text --seg-text-active$/), "control: an active item in --seg-text fails").toBe(true);
});

/* signals-v3 M2 moved the card control to /congress/'s "Notes on this data"
   cards. The launch redesign retired the summary cards on every compared
   route — /congress/ (M3b, R22), the member page (M4b, R23) and the filer
   (M6, filer-11) — so no canvas case maps cards and a planted card body has
   nothing to be compared against. The control becomes a tripwire: a case
   that maps cards again must bring its card control back. */
test('T2.9 control: the summary card — retired with the cards on every compared route (launch M3b R22, M4b R23, M6 filer-11)', () => {
  expect(CANVAS_CASES.filter((c) => c.map.cards).map((c) => c.file), "no compared route maps summary cards").toEqual([]);
});

test('T2.9 control: an unrecorded difference fails', async ({ page, browser }) => {
  await openRoute(page, FILER);
  const changes = (fs: Finding[]): Finding[] => unrecorded(fs).filter((f) => /^table Holdings → Position changes/.test(f.band) && /^header /.test(f.check));
  expect(changes((await compareRoute(page, browser, FILER)).findings), "the Position changes header matches the canvas before the plant").toEqual([]);
  /* a 13px header on ONE band, in no record */
  await page.addStyleTag({ content: ".design-changes th { font-size: 13px !important; }" });
  const planted = changes((await compareRoute(page, browser, FILER)).findings);
  expect(planted.some((f) => /role \([^)]*size/.test(f.check)), "control: a planted 13px header size fails T2.9").toBe(true);
});

/* The M3 kind-vocabulary allowances were milestone-scoped: they held while the
   tree was before m3 and EXPIRED at m3 (coordinator decision CD-4), when the
   same routes must show the canvas's words (T3.1, T3.2) and the directory's
   change line its mono role (M2F-D4). This tree is m3, so they answer nothing:
   the per-route canvas tests above pass WITHOUT them. The entries stay in the
   list only as the record of what M2 allowed (the comparison refuses an id it
   does not know). Controls: a retired word, planted back on the page, is
   caught as UNRECORDED. Each plant is asserted to have HAPPENED (P-9, M3
   review): a control that found nothing to plant on used to skip its
   assertion and pass on nothing.
   Launch M3b/M4b (LD33): the member transaction, member net-flow and Congress
   late-row plants ran against the September Congress and Member boards,
   which left the comparison; the control now plants on the filer's Position
   changes, whose canvas still governs its kind words (the expired
   kind.qoq.chip.m3 allowance covered them). */
test('T2.9 (M3): the M3-scoped allowances have expired, and the routes pass without them', async ({ page, browser }) => {
  const scoped = ALLOWED_DEVIATIONS.filter((d) => d.until);
  expect(scoped.map((d) => d.id).sort()).toEqual(["kind.late.word.m3", "kind.netflow.word.m3", "kind.qoq.chip.m3", "kind.side.word.m3", "table.role.notable.m3"]);
  expect(scoped.every((d) => d.until === "m3")).toBe(true);
  expect(CURRENT_MILESTONE, "this tree is m3").toBe("m3");
  for (const d of scoped) expect(allowedAt(CURRENT_MILESTONE).some((x) => x.id === d.id), `${d.id} has expired`).toBe(false);

  await openRoute(page, FILER);
  const words = (fs: Finding[]): Finding[] => unrecorded(fs).filter((f) => /^table Holdings → Position changes/.test(f.band) && /kind word/.test(f.check));
  const now = words((await compareRoute(page, browser, FILER)).findings);
  expect(now, `the filer's change words match the canvas with no allowance:\n${formatFindings(now)}`).toEqual([]);
  /* control: a retired side word planted on a change row's kind cell */
  const planted = await page.evaluate(() => {
    const cell = document.querySelector<HTMLElement>(".design-changes tbody tr[data-edge] td.c-kind");
    if (!cell) return false;
    const chip = cell.querySelector<HTMLElement>(".qoq-chip") ?? cell;
    chip.textContent = "PURCHASE";
    return true;
  });
  expect(planted, "a change row was found to plant on").toBe(true);
  expect(words((await compareRoute(page, browser, FILER)).findings).length, "control: PURCHASE on a change row is unrecorded at m3").toBeGreaterThan(0);
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
  // launch M3a (LD20): twenty rows a page in the default "With ticker" view
  await expect(page.locator('#filter-count-line')).toContainText('21–40');
  await expect(page.locator('.reference-row')).toHaveCount(20);
  expect(await page.locator('.reference-row').first().textContent()).not.toBe(first);
  await page.locator('#pager-newer').click();
  await expect(page.locator('#filter-count-line')).toContainText('1–20');
  await expect(page.locator('#filter-count-line')).toContainText('without a ticker');
  /* launch M3a (R20): the default "With ticker" page may carry no flag
     (20261019.2: none); the "All rows" page carries the rows a flag marks most */
  await page.locator('#feed-section button[data-group="view"][data-value="all"]').click();
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

/* ======================================================================
   SIGNALS-CLARITY M3 (R16, R18, R19; T15, T17, T18): /congress's Monthly
   flow panel at the phone (375) and the design screen (1440). Properties:
   it sits directly before band C1 (Leaders first); the 36 months fit their
   track with no horizontal scroll at either width; every honesty line (the
   caption, the exclusion counts, the shading labels, the completeness method)
   is on screen at both widths; the month table is visually hidden, never
   removed; the toggle swaps the two server-rendered variants.
   ====================================================================== */
for (const width of [375, 1440]) {
  test(`Monthly flow panel at ${width}px (SIGNALS-CLARITY M3)`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 1000 });
    expect((await page.goto('/congress/'))?.status()).toBe(200);
    // launch M3b (R21): the panel closes the page, after the feed
    expect(await page.evaluate(() => {
      const kids = Array.from(document.querySelector('main')!.children).filter((el) => el.tagName !== 'SCRIPT');
      return kids[kids.length - 1]?.id ?? '';
    }), 'Monthly flow is the last section of the page').toBe('monthly-flow-section');
    await expect(page.locator('#monthly-flow-section h2')).toHaveText('Monthly flow');
    /* R11/R21: the default Members view — a labelled y-axis, x labels, the
       zone labelled an estimate and a readout, all on screen at this width */
    const members = await page.evaluate(() => {
      const v = Array.from(document.querySelectorAll<HTMLElement>('#monthly-flow-section .mf-variant')).find((x) => !x.hidden)!;
      const m = v.querySelector<HTMLElement>('.mf-measure[data-flow-measure="members"]')!;
      const on = (el: Element | null) => !!el && el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) && el.getBoundingClientRect().width > 0;
      const labels = (sel: string) => Array.from(m.querySelectorAll(sel)).map((t) => ({ on: on(t), r: t.getBoundingClientRect() }));
      return {
        shown: !m.hidden,
        y: labels('.mf-ytick'),
        x: labels('.mf-x'),
        zone: on(m.querySelector('.mf-fill span')),
        readout: (m.querySelector('.mf-readout')?.textContent ?? '').trim(),
        readoutOn: on(m.querySelector('.mf-readout')),
        tips: Array.from(v.querySelectorAll('.mf-notes .note-label')).map((b) => on(b)),
      };
    });
    expect(members.shown, 'Members is the default measure').toBe(true);
    expect(members.y.length).toBeGreaterThanOrEqual(2);
    expect(members.y.every((t) => t.on), 'every y tick is labelled and on screen').toBe(true);
    expect(members.x.length).toBeGreaterThanOrEqual(6);
    expect(members.x.every((t) => t.on && t.r.right <= width + 1), 'every x label is on screen').toBe(true);
    expect(members.zone, 'the Filling in zone is labelled').toBe(true);
    expect(members.readoutOn && /with a purchase/.test(members.readout), 'the readout states the month').toBe(true);
    expect(members.tips, 'the three method tips are on screen').toEqual([true, true, true]);
    // the readout follows a tap on the plot (one control, LD13)
    const plot = page.locator('#monthly-flow-section .mf-variant:not([hidden]) .mf-measure[data-flow-measure="members"] .mf-plot');
    /* launch M3b (R21): the panel closes the page, below the fold — a pointer
       reaches the plot once it is scrolled to (a raw click off screen lands nowhere) */
    await plot.scrollIntoViewIfNeeded();
    const box = (await plot.boundingBox())!;
    await page.mouse.click(box.x + 4, box.y + box.height / 2);
    await expect(page.locator('#monthly-flow-section .mf-variant:not([hidden]) .mf-measure[data-flow-measure="members"] .mf-readout')).not.toHaveText(members.readout);
    // the Dollars view keeps the bar grammar measured below
    await page.locator('#monthly-flow-section [data-flow-measure-toggle="dollars"]').click();
    const g = await page.evaluate(() => {
      const panel = document.querySelector('#monthly-flow-section')!;
      const shown = Array.from(panel.querySelectorAll<HTMLElement>('.mf-variant')).filter((v) => !v.hidden);
      const v = shown[0]!;
      const track = v.querySelector('.rb-track')!;
      const tr = track.getBoundingClientRect();
      const cols = Array.from(track.querySelectorAll('.rb-col')).map((c) => c.getBoundingClientRect());
      const vis = (sel: string) => {
        const el = v.querySelector(sel);
        if (!el) return { present: false, visible: false, h: 0, right: 0 };
        const r = el.getBoundingClientRect();
        return { present: true, visible: el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) && r.height > 0 && r.width > 0, h: r.height, right: r.right };
      };
      const table = v.querySelector('table.mf-table')!;
      const cs = getComputedStyle(table.closest('.visually-hidden') ?? table);
      return {
        shown: shown.map((s) => s.dataset.flowVariant),
        page: { scroll: document.documentElement.scrollWidth, viewport: innerWidth },
        panelRight: panel.getBoundingClientRect().right,
        track: { left: tr.left, right: tr.right, scroll: track.scrollWidth, client: track.clientWidth },
        cols: cols.length,
        colsInside: cols.every((c) => c.left >= tr.left - 0.5 && c.right <= tr.right + 0.5 && c.width > 0),
        minColWidth: Math.min(...cols.map((c) => c.width)),
        // R21: these lines are tips now; their labels are measured above and
        // their bodies are opened below
        caption: { present: !!v.querySelector('.rb-caption'), visible: true, h: 0, right: 0 },
        exclusions: { present: !!v.querySelector('.mf-exclusions'), visible: true, h: 0, right: 0 },
        shade: { present: !!v.querySelector('.mf-shade-labels'), visible: true, h: 0, right: 0 },
        completeness: { present: !!v.querySelector('.mf-completeness'), visible: true, h: 0, right: 0 },
        /* the open-bound caps and all-unparsed stubs of BOTH variants' markup
           are fixed-height marks; here, the visible variant's */
        marks: Array.from(v.querySelectorAll('.mf-cap, .mf-stub')).map((m) => {
          const r = m.getBoundingClientRect(), t = track.getBoundingClientRect();
          return { h: Math.round(r.height * 10) / 10, inTrack: r.top >= t.top - 0.5 && r.bottom <= t.bottom + 0.5 };
        }),
        /* review F1: every dollar-scaled (solid, un-hatched) bar is drawn at
           EXACTLY the height its style states — no minimum height, no border —
           and the too-small-to-draw tick is a fixed mark */
        solid: Array.from(v.querySelectorAll('.rb-up .rb-bar, .rb-down .rb-bar')).filter((b) => !b.matches('.rb-gap, .rb-hatch, .mf-tick')).map((b) => {
          const half = b.parentElement!.getBoundingClientRect().height;
          const pct = Number(/height:([\d.]+)%/.exec(b.getAttribute('style') ?? '')?.[1] ?? NaN);
          return { px: b.getBoundingClientRect().height, want: (pct / 100) * half };
        }),
        ticks: Array.from(v.querySelectorAll('.mf-tick')).map((t) => Math.round(t.getBoundingClientRect().height * 10) / 10),
        halves: (() => { const c = track.querySelector('.rb-col')!; return { up: c.querySelector('.rb-up')!.getBoundingClientRect().height, down: c.querySelector('.rb-down')!.getBoundingClientRect().height }; })(),
        tallestHatch: Math.max(0, ...Array.from(v.querySelectorAll('.rb-hatch')).map((m) => m.getBoundingClientRect().height)),
        table: { display: getComputedStyle(table).display, wrapDisplay: cs.display, clipped: /rect\(0(px)?,? 0(px)?,? 0(px)?,? 0(px)?\)/.test(cs.clip) || cs.clipPath === 'inset(50%)', rows: table.querySelectorAll('tbody tr').length, box: table.getBoundingClientRect().width },
      };
    });
    expect(g.shown, 'exactly one variant is visible: Stocks, the default').toEqual(['stocks']);
    expect(g.page.scroll, 'no horizontal page scroll').toBeLessThanOrEqual(g.page.viewport + 1);
    expect(g.panelRight).toBeLessThanOrEqual(g.page.viewport + 1);
    expect(g.cols, '36 trade months').toBe(36);
    expect(g.track.scroll, 'the 36 months fit their track').toBeLessThanOrEqual(g.track.client + 1);
    expect(g.colsInside, 'every month column lies inside the track').toBe(true);
    expect(g.minColWidth, 'every month column has room for a bar').toBeGreaterThanOrEqual(4);
    for (const [name, v] of Object.entries({ caption: g.caption, exclusions: g.exclusions, 'shading labels': g.shade, completeness: g.completeness })) {
      expect(v.present, `the ${name} line is emitted (in its tip) at ${width}px`).toBe(true);
    }
    // each tip opens to its honesty line, inside the viewport
    for (const [label, sel] of [['Excluded rows', '.mf-exclusions'], ['Shaded months are still filling in (est.)', '.mf-completeness'], ['How it’s drawn', '.rb-caption']] as const) {
      await page.locator('#monthly-flow-section .mf-variant:not([hidden]) .mf-notes .note-label', { hasText: label }).click();
      const body = page.locator(`#monthly-flow-section .mf-variant:not([hidden]) ${sel}`);
      await expect(body, `${label}: its line shows`).toBeVisible();
      expect(((await body.boundingBox())?.x ?? 0) + ((await body.boundingBox())?.width ?? 0), `${label}: inside the viewport`).toBeLessThanOrEqual(width + 1);
      await page.keyboard.press('Escape');
    }
    /* readability change: an open sum's hatch is a fixed cap (and an all-unparsed
       sum a fixed stub), never a pillar to the axis top */
    expect(g.marks.length, 'this build draws open-bound caps').toBeGreaterThan(0);
    expect(g.marks.filter((m) => m.h < 10 || m.h > 12), 'every cap and stub is the one fixed 10–12px height').toEqual([]);
    expect(g.marks.every((m) => m.inTrack), 'a cap on a bar at the axis top still sits inside the track').toBe(true);
    expect(g.tallestHatch, 'no hatch is taller than a cap').toBeLessThanOrEqual(12);
    expect(Math.abs(g.halves.up - g.halves.down), 'purchases and sales are drawn on one scale').toBeLessThanOrEqual(1);
    expect(g.solid.length, 'the visible variant draws dollar-scaled bars').toBeGreaterThan(20);
    expect(g.solid.filter((b) => !(Math.abs(b.px - b.want) <= 0.25)), 'no solid bar is taller than its stated share of the axis (no minimum height, no border)').toEqual([]);
    expect(g.ticks.length, 'this build has months too small to draw at the outlier scale').toBeGreaterThan(0);
    expect(g.ticks.filter((h) => h < 1 || h > 2), 'every tick is the one fixed 1–2px height').toEqual([]);
    expect(g.table.display, 'the month table is never display:none').not.toBe('none');
    expect(g.table.wrapDisplay, 'nor is its visually-hidden wrapper').not.toBe('none');
    expect(g.table.clipped, 'the month table is visually hidden by the clip pattern').toBe(true);
    expect(g.table.rows).toBe(36);
    await page.locator('#monthly-flow-section').screenshot({ path: info.outputPath(`monthly-flow-${width}.png`) });
    // the toggle swaps the server-rendered variants
    await page.locator('#monthly-flow-section [data-flow-toggle="all"]').click();
    await expect(page.locator('#monthly-flow-section .mf-variant[data-flow-variant="all"]')).toBeVisible();
    await expect(page.locator('#monthly-flow-section .mf-variant[data-flow-variant="stocks"]')).toBeHidden();
    await expect(page.locator('#monthly-flow-section [data-flow-toggle="all"]')).toHaveAttribute('aria-pressed', 'true');
    expect(await page.evaluate(() => document.documentElement.scrollWidth), 'no horizontal scroll with all asset types').toBeLessThanOrEqual(width + 1);
    await page.locator('#monthly-flow-section').screenshot({ path: info.outputPath(`monthly-flow-all-${width}.png`) });
    await page.locator('#monthly-flow-section [data-flow-toggle="stocks"]').click();
    await expect(page.locator('#monthly-flow-section .mf-variant[data-flow-variant="stocks"]')).toBeVisible();
  });
}
