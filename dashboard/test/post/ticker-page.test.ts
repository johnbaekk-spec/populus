/* signals-v3 M3 (R16–R21, PLAN success criterion 4): the BUILT ticker pages.

   Over the real dist bytes, every `/tickers/<T>/` page:
   - carries ONE `role="tablist"` of exactly two tabs, Congress and
     Institutional, over two tab panels `#congress` and `#institutional`,
     neither hidden in the HTML (without JavaScript both show);
   - renders no Financials, Macro or section-index markup, no lede and no
     story cards;
   - renders `#on-signals` exactly when the build's own artifact
     (`signals/data/signals.v1.json`) holds an active hit on its ticker;
   - pins at most five rows, first, each carrying `data-txn` and the On
     Signals marker, in a preview of at most ten rows;
   - carries no PLANNED markup anywhere in the page (criterion 4; Codex code
     round 1 F1: the overlap band's "Notable managers PLANNED" badge reached
     every ticker page while the tab reading passed it).

   Every reading is scoped to the page's `<main>`, and the sweep states its
   coverage: an empty finding over a handful of pages is the silent-scan
   failure shape, not a pass. */

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { overlapBand, overlapBandHtml, tickerOverlapHtml } from "../../src/lib/overlap.ts";

const DIST = path.join(process.cwd(), "dist");

interface Page {
  ticker: string;
  main: string;
  /** the whole page, for readings that are not scoped to `<main>` */
  html: string;
}

/** Every built ticker page: its ticker (the page's own `data-entity-key`)
    and its `<main>`. */
function tickerPages(): Page[] {
  const dir = path.join(DIST, "tickers");
  assert.ok(existsSync(dir), "dist/tickers/ must exist — this suite runs post-build");
  const out: Page[] = [];
  for (const d of readdirSync(dir)) {
    const f = path.join(dir, d, "index.html");
    if (!existsSync(f)) continue;
    const html = readFileSync(f, "utf-8");
    const m = /<main class="shell page entity-page" data-entity-kind="t" data-entity-key="([^"]*)">([\s\S]*?)<\/main>/.exec(html);
    assert.ok(m, `${d}: a ticker page's <main>`);
    out.push({ ticker: m![1]!.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">"), main: m![2]!, html });
  }
  return out;
}

/** The pinned and preview rows of a page's disclosures preview. */
function previewRows(main: string): string[] {
  const at = main.indexOf('aria-label="Congressional disclosures"');
  assert.ok(at >= 0, "the disclosures panel");
  const body = /<tbody>([\s\S]*?)<\/tbody>/.exec(main.slice(at));
  return body ? body[1]!.match(/<tr[^>]*>/g) ?? [] : [];
}

export function tabProblems(main: string): string[] {
  const out: string[] = [];
  const lists = main.match(/role="tablist"/g) ?? [];
  if (lists.length !== 1) out.push(`${lists.length} tab lists`);
  const tabs = [...main.matchAll(/<a class="tk-tab" role="tab" id="([^"]+)" href="([^"]+)" aria-controls="([^"]+)">/g)].map((m) => `${m[2]}>${m[3]}`);
  if (tabs.join(",") !== "#congress>congress,#institutional>institutional") out.push(`tabs ${tabs.join(",")}`);
  const panels = [...main.matchAll(/<section class="tk-panel" role="tabpanel" id="([^"]+)"([^>]*)>/g)];
  if (panels.map((p) => p[1]).join(",") !== "congress,institutional") out.push(`panels ${panels.map((p) => p[1]).join(",")}`);
  if (panels.some((p) => /\shidden\b/.test(p[2]!))) out.push("a panel is hidden in the HTML");
  for (const gone of ["Financials", "Macro", "section-index", "badge-soon", "entity-lede", "design-story", "planned-card"]) {
    if (main.includes(gone)) out.push(`carries ${gone}`);
  }
  return out;
}

/** Criterion 4: the PLANNED markup a ticker page must not carry, read over
    the WHOLE page (head, chrome and `<main>`): the badge word, case-sensitive,
    and the classes that only ever wrap it. */
export function plannedProblems(html: string): string[] {
  return ["PLANNED", "badge-planned", "overlap-planned", "planned-line"].filter((s) => html.includes(s)).map((s) => `carries ${s}`);
}

test("the PLANNED reading catches the overlap band's badge branch and passes the ticker page's absence statement", () => {
  const band = overlapBand({
    ticker: "ZZZZ", txns: [], generatedAtDate: "2026-06-01", inst: { present: false, reason: "module-absent" },
    typingByCik: new Map(), period: null, ctx: {}, filerHref: (c) => `/f/${c}`,
  });
  // negative control: the band in its badge mode (the holders page's default)
  assert.deepEqual(plannedProblems(overlapBandHtml(band, {}, (c) => `/f/${c}`)), ["carries PLANNED", "carries badge-planned", "carries overlap-planned"]);
  // a synthetic page with the badge outside <main> is caught too
  assert.ok(plannedProblems(`<header><span class="badge-planned">PLANNED</span></header><main></main>`).length > 0, "control: outside main");
  // the ticker route's rendering passes, and still states the absence
  const statement = tickerOverlapHtml(band, {}, (c) => `/f/${c}`);
  assert.deepEqual(plannedProblems(statement), []);
  assert.match(statement, /data-absent="module-absent"><h3 class="section-h">Notable managers<\/h3><p class="section-note">Not available for ZZZZ: /);
});

test("criterion 4 over the build: no ticker page carries PLANNED markup", () => {
  const pages = tickerPages();
  assert.ok(pages.length > 100, `only ${pages.length} ticker pages — the sweep is not seeing the build`);
  const bad = pages.map((p) => ({ t: p.ticker, problems: plannedProblems(p.html) })).filter((x) => x.problems.length > 0);
  assert.deepEqual(bad.slice(0, 5), [], `${bad.length} of ${pages.length} ticker pages`);
  // coverage: the overlap band renders on the pages, and where its 13F half
  // is absent the page states why
  const absent = pages.filter((p) => /<div class="overlap-half overlap-inst" data-absent="[a-z-]+"><h3 class="section-h">Notable managers<\/h3><p class="section-note">Not available for /.test(p.main)).length;
  const banded = pages.filter((p) => p.main.includes('id="overlap"')).length;
  assert.equal(banded, pages.length, "every ticker page carries the overlap band");
  assert.ok(absent > 0, `the sweep saw ${absent} absence statements`);
});

test("the tab reading catches a page without its tabs, with a hidden panel, or with the retired SOON tabs", () => {
  const good =
    `<div class="tk-tabs" role="tablist" aria-label="Sections"><a class="tk-tab" role="tab" id="tab-congress" href="#congress" aria-controls="congress">Congress</a><a class="tk-tab" role="tab" id="tab-institutional" href="#institutional" aria-controls="institutional">Institutional</a></div>` +
    `<section class="tk-panel" role="tabpanel" id="congress" aria-labelledby="tab-congress"></section><section class="tk-panel" role="tabpanel" id="institutional" aria-labelledby="tab-institutional"></section>`;
  assert.deepEqual(tabProblems(good), []);
  assert.ok(tabProblems(good.replace('id="institutional" aria-labelledby', 'id="institutional" hidden aria-labelledby')).length > 0, "control: a hidden panel");
  assert.ok(tabProblems(good + `<span class="si-soon">Financials <span class="badge-soon">SOON</span></span>`).length > 0, "control: the SOON tabs");
  assert.ok(tabProblems("<nav class=\"section-index\"></nav>").length > 0, "control: the old section index");
});

test("R16/R17 over the build: every ticker page is two tabs over two visible panels, with no Financials, Macro, lede or story cards", () => {
  const pages = tickerPages();
  assert.ok(pages.length > 100, `only ${pages.length} ticker pages — the sweep is not seeing the build`);
  const bad = pages.map((p) => ({ t: p.ticker, problems: tabProblems(p.main) })).filter((x) => x.problems.length > 0);
  assert.deepEqual(bad.slice(0, 5), [], `${bad.length} of ${pages.length} ticker pages`);
});

test("success criterion 4 over the build: #on-signals renders exactly on the ticker pages with an active hit in the build's own artifact; pinned rows come first, at most five, marked, with data-txn", () => {
  const art = JSON.parse(readFileSync(path.join(DIST, "signals", "data", "signals.v1.json"), "utf-8")) as { signals: { status: string; entities: { ticker: string | null } }[] };
  const active = new Set(art.signals.filter((s) => s.status === "active" && s.entities.ticker).map((s) => s.entities.ticker!));
  const pages = tickerPages();
  let withBlock = 0, pinnedPages = 0;
  const wrong: string[] = [];
  for (const p of pages) {
    const blocks = (p.main.match(/id="on-signals"/g) ?? []).length;
    if (blocks > 1) wrong.push(`${p.ticker}: ${blocks} blocks`);
    if ((blocks === 1) !== active.has(p.ticker)) wrong.push(`${p.ticker}: block ${blocks === 1}, active hit ${active.has(p.ticker)}`);
    if (blocks === 1) withBlock++;
    const rows = previewRows(p.main);
    if (rows.length > 10) wrong.push(`${p.ticker}: ${rows.length} preview rows`);
    const pinned = rows.map((r) => /\bclass="on-signals"/.test(r));
    const n = pinned.filter(Boolean).length;
    if (n > 5) wrong.push(`${p.ticker}: ${n} pinned`);
    if (pinned.some((x, i) => x && i > 0 && !pinned[i - 1])) wrong.push(`${p.ticker}: a pinned row after an unpinned one`);
    if (!rows.every((r) => /\sdata-txn="[^"]+"/.test(r))) wrong.push(`${p.ticker}: a preview row without data-txn`);
    if (n > 0) {
      pinnedPages++;
      if (blocks !== 1) wrong.push(`${p.ticker}: pinned rows without a block`);
      if ((p.main.match(/<span class="on-signals-mark">On Signals<\/span>/g) ?? []).length !== n) wrong.push(`${p.ticker}: ${n} pinned, marker count differs`);
    }
  }
  assert.deepEqual(wrong.slice(0, 10), [], `${wrong.length} findings`);
  // coverage: the build's active tickers that have a page, each carries the block
  const covered = pages.filter((p) => active.has(p.ticker)).length;
  assert.equal(withBlock, covered, "every active ticker with a page has the block");
  assert.ok(covered > 0 && pinnedPages > 0, `the sweep saw ${covered} blocks and ${pinnedPages} pages with pinned rows`);
});
