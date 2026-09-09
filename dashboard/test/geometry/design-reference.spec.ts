import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";

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
      await expect(page.locator('.design-briefing .design-story')).toHaveCount(3);
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
        for (const title of ["Cluster board", "Recent activity", "Conviction leaders", "Sector rotation", "Filer directory"]) {
          await expect(page.getByRole('heading', {name:title, exact:true})).toBeVisible();
        }
      }
      if (route.includes('/members/')) {
        for (const title of ['Holdings from annual disclosure', 'Reconciliation', 'Trading profile', 'Filing history', 'Institutional overlap']) {
          await expect(page.getByRole('heading', {name:title, exact:true})).toBeVisible();
        }
        await expect(page.locator('[data-entity-table] thead th')).toHaveCount(8);
      }
      if (route === '/signals/') {
        for (const title of ['Rule book', 'Hits', 'Lag distribution', 'Hit rate by family', 'Watchlist']) {
          await expect(page.getByRole('heading', {name:title, exact:true})).toBeVisible();
        }
        await expect(page.locator('#signal-rulebook tbody tr')).toHaveCount(7);
        await expect(page.locator('#signal-hits thead th')).toHaveCount(7);
        // the family filter hides rows without fetching; the status line announces the count
        const all = await page.locator('#signal-hits-body tr.si-hit').count();
        const families = page.locator('.si-hit-filter button[data-family]');
        if (await families.count() > 1) {
          await families.nth(1).click();
          const fam = await families.nth(1).getAttribute('data-family');
          const visible = await page.locator(`#signal-hits-body tr.si-hit[data-family="${fam}"]`).count();
          await expect(page.locator('#signal-hits-body tr.si-hit:visible')).toHaveCount(visible);
          expect(visible).toBeLessThanOrEqual(all);
          await families.first().click();
          await expect(page.locator('#signal-hits-body tr.si-hit:visible')).toHaveCount(all);
        }
        // every rendered hit carries its receipt link
        expect(await page.locator('#signal-hits-body tr.si-hit td.c-src a').count()).toBe(all);
        if (width === 1440) {
          const hits = await page.locator('#signal-hits').boundingBox();
          const lag = await page.locator('.si-lagband').boundingBox();
          expect(Math.abs(hits!.y - lag!.y), 'hits and lag distribution share a band').toBeLessThanOrEqual(2);
        }
      }
      if (route === '/congress/') {
        await expect(page.locator('.reference-feed thead th')).toHaveCount(8);
        await expect(page.locator('.reference-feed .reference-row').first().locator('td')).toHaveCount(8);
        const scroll = await page.locator('.reference-feed-scroll').evaluate(el => ({height:el.clientHeight, contents:el.scrollHeight}));
        expect(scroll.height).toBeLessThanOrEqual(width === 1440 ? 310 : 440);
        await expect(page.locator('.reference-feed .reference-row')).toHaveCount(8);
        if (width === 1440) {
          const rows = await page.locator('.reference-feed .reference-row').evaluateAll(els => els.map(el => el.getBoundingClientRect().height));
          expect(rows.every(height => Math.abs(height - 31) <= 1)).toBe(true);
          const bars = await page.locator('.reference-feed .band-fill').evaluateAll(els => els.map(el => ({height:el.getBoundingClientRect().height,width:el.getBoundingClientRect().width})));
          expect(bars.every(bar => bar.height >= 3 && bar.width > 0), 'interval fills must actually paint inside their tracks').toBe(true);
          await expect(page.locator('#momentum-section thead th')).toHaveCount(6);
          const memberHead = await page.locator('#members-section thead').first().boundingBox();
          const tickerHead = await page.locator('#momentum-section thead').first().boundingBox();
          expect(Math.abs(memberHead!.y - tickerHead!.y), 'paired ranking tables must begin on the same baseline').toBeLessThanOrEqual(1);
          const header = await page.locator('#feed-section > .panel-head').boundingBox();
          const filters = await page.locator('#feed-section .filter-controls').boundingBox();
          expect(Math.abs(header!.y - filters!.y)).toBeLessThan(2);
        }
      }
      if (width === 1440 && route.includes('/filers/')) {
        await expect(page.locator('[data-sticky-issuer] thead th')).toHaveCount(9);
        const holdings = await page.locator('[data-holdings-surface="filer"]').boundingBox();
        const shape = await page.locator('.design-book-shape').boundingBox();
        expect(holdings).not.toBeNull(); expect(shape).not.toBeNull();
        expect(Math.abs(holdings!.y - shape!.y), 'holdings and book shape must start in the same band').toBeLessThanOrEqual(2);
        expect(holdings!.x + holdings!.width).toBeLessThanOrEqual(shape!.x + 2);
        const record = page.locator('[data-sticky-issuer] tbody .note-btn').first();
        await record.click();
        const recordPanel = page.locator(`#${await record.getAttribute('popovertarget')}`);
        await expect(recordPanel).toBeVisible();
        await expect(recordPanel).toContainText('filed');
        await page.keyboard.press('Escape');
        const chips = page.locator('[data-period-chips] [data-period]');
        expect(await chips.count()).toBeGreaterThan(1);
        const original = await page.locator('[data-period-chips] [aria-pressed="true"]').getAttribute('data-period');
        const prior = await chips.first().getAttribute('data-period');
        await chips.first().click();
        await expect(page.locator('[data-holdings-surface] h2').first()).toContainText(prior!);
        await expect(page.locator('.design-book-shape > .panel-head')).toContainText(prior!);
        await page.locator(`[data-period-chips] [data-period="${original}"]`).click();
        await expect(page.locator('[data-holdings-surface] h2').first()).toContainText(original!);

      }
      const pageBottom = await page.evaluate(() => ({height:document.documentElement.scrollHeight,footer:document.querySelector('footer')!.getBoundingClientRect().bottom + scrollY,viewport:innerHeight}));
      expect(pageBottom.height, 'clipped table content must not create blank space below the footer').toBeLessThanOrEqual(Math.max(pageBottom.footer,pageBottom.viewport) + 2);
      await page.screenshot({ path: info.outputPath(`${file}-${width}.png`), fullPage: true });
      await info.attach('design-source', { body: source, contentType: 'text/html' });
    });
  }
}

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
  await expect(page.locator('#filter-count-line')).toContainText('9–16');
  await expect(page.locator('.reference-row')).toHaveCount(8);
  expect(await page.locator('.reference-row').first().textContent()).not.toBe(first);
  await page.locator('#pager-newer').click();
  await expect(page.locator('#filter-count-line')).toContainText('1–8');
  const flag = page.locator('.reference-flags .note-btn').first();
  await flag.click();
  await expect(page.locator(`#${await flag.getAttribute('popovertarget')}`)).toBeVisible();
});
