/* launch review fix round (phone / CSS / a11y): every phone surface, laid out
   by a real engine.

   B1 reached the integrated tree past two proxies. The only R4 test below the
   owner tier read the effective overflow-x of the table wrappers
   (launch-phone-css.test.ts) while three table min-widths made the PAGE
   scroll sideways on every phone; and the owner tier's own predicate
   (`phoneAuditInPage`) compared scrollWidth with `innerWidth`, which a mobile
   context grows to the content — it now reads the layout viewport
   (`clientWidth`; phone.spec.ts carries the control). This suite measures the
   properties themselves. It renders every surface the parity harness covers
   (test/lib/ui-parity-surfaces.ts), plus the page compositions that harness
   does not reproduce (the /congress/ boards as congress/index.astro composes
   them; a filer's reported positions as its holdings surface paints them),
   inside its page's own <main>, through `withTableRoles` (as Base.astro
   renders every body), with the nine real stylesheets linked in Base.astro's
   import order (test/lib/styles.ts) and the real fonts, in headless Chromium
   at 360, 390 and 430px wide with touch (the phone harness's context,
   geometry/phone.spec.ts). At each width:

   - the page's scrollWidth never exceeds the viewport (B1, R4);
   - no honesty selector is hidden, clipped, clamped or cut — the phone
     harness's own R5 predicate (`phoneAuditInPage`, geometry/geometry.ts) —
     except an element a 1440px reader does not see either (a radio's
     unselected variant): no width may lose a caveat the desktop shows;
   - a card's tap target is its main link (the first link of its main cell),
     which its renderer marks `data-row-link`, and never a receipt; a signal
     card's is its `.si-card-open`, and a Named-moves receipt stays on its
     row (M1, M2, R7) — `phoneCardAuditInPage`;
   - every `.c-num` cell of a card prints its column's label (M4, R2).

   Each property carries a re-planted control on a real surface that must
   fail it (the `controls:` tests).

   The engine: the Playwright installed in dashboard/node_modules. The CI
   runner installs no browser (`npm ci` only), so there — and only where
   `CI` is set — the suite skips with its reason; anywhere else a Chromium that
   does not launch FAILS the suite (`npm run geometry:install`), so a local
   `npm test` can never pass it without measuring. */

import { test, before, after, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { chromium, type Browser } from "@playwright/test";

import { withTableRoles } from "../src/lib/format.ts";
import { HONESTY_SELECTORS } from "./lib/honesty-selectors.ts";
import { baseStyleImports } from "./lib/styles.ts";
import { renderParitySurfaces } from "./lib/ui-parity-surfaces.ts";
import { phoneAuditInPage, phoneCardAuditInPage, type PhoneAudit, type PhoneAuditArg, type PhoneCardArg, type PhoneCardAudit } from "./geometry/geometry.ts";

const DASHBOARD = path.resolve(import.meta.dirname, "..");
const WIDTHS = [360, 390, 430] as const;
const HEIGHT = 844;
/** the phone harness's agent (geometry/phone.spec.ts) */
const IPHONE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1 PublicFilingsPhoneHarness";
const ORIGIN = "http://phone-surfaces.test";
/** tabs measured at once per width */
const TABS = 4;

/** Only the honesty predicate of the phone audit is read here (R4 is read off
    its page width); the scroller allowlist stays the phone harness's job. */
const AUDIT_ARG: PhoneAuditArg = { honesty: HONESTY_SELECTORS, scrollerAllow: [], swipe: [], minTap: 44, minFont: 11 };
const CARD_ARG: PhoneCardArg = {
  mainTiers: [".c-member", ".c-filer, .c-pos, .c-issuer", ".c-ticker"],
  receipt: ".cell-src, .c-src",
  rowLinkAttr: "data-row-link",
  hit: 44,
};

/* ------------------------------------------------------------ the pages */

type PageKind = "entity" | "filer" | "signals" | "congress" | "institutional" | "methodology" | "home-hero" | "home-ledger" | "home";

/** Each page's own wrapper around its body (src/pages/**). */
const PAGES: Readonly<Record<PageKind, readonly [string, string]>> = {
  entity: ['<main class="shell page entity-page">', "</main>"],
  filer: ['<main class="shell page entity-page filer-page">', "</main>"],
  signals: ['<main class="shell page design-page" id="signals-page">', "</main>"],
  congress: ['<main class="shell page design-page" id="congress-page">', "</main>"],
  institutional: ['<main class="shell page design-page" id="institutional-page">', "</main>"],
  methodology: ['<main class="shell page methodology"><section class="metho-section" id="signals-method">', "</section></main>"],
  "home-hero": ['<main><section class="hero-band" aria-labelledby="home-claim"><div class="shell hero"><div class="home-hero-copy">', "</div></div></section></main>"],
  "home-ledger": ['<main><section class="hero-band"><div class="shell hero">', "</div></section></main>"],
  home: ['<main><div class="shell page home-page">', "</div></main>"],
};

/** Where each parity surface lives. Every surface the harness renders must
    be placed here (the first test pins the key sets), so a new surface is
    measured on a phone from the day it joins the harness. */
const SURFACE_PAGE: Readonly<Record<string, PageKind>> = {
  addsSectionHtml: "institutional",
  breadcrumb: "entity",
  changesTableHtml: "filer",
  committeeDirectHtml: "methodology",
  "congressRankingSection.leaders": "congress",
  "congressRankingSection.tickers": "congress",
  congressTickerBody: "entity",
  emptyWindowHtml: "congress",
  filerBody: "filer",
  filerEdgarBlock: "filer",
  "flowCellHtml.undisclosed": "congress",
  holdersBody: "entity",
  holdersTableHtml: "entity",
  homeHeroCopyHtml: "home-hero",
  "homeLeadHtml.empty": "home",
  homeLedgerHtml: "home-ledger",
  homeSectionsHtml: "home",
  instStamp: "institutional",
  lagBandHtml: "methodology",
  memberBody: "entity",
  "memberBody.active": "entity",
  "memberBody.paper-only": "entity",
  memberPaperBlock: "entity",
  memberSignalsPanel: "entity",
  "memberSignalsPanel.empty": "entity",
  "memberV2Sections.absent-deps": "entity",
  notableRailHtml: "entity",
  ruleBookHtml: "methodology",
  s1ModuleAbsent: "institutional",
  s2OutOfExtract: "entity",
  s4Error: "entity",
  s4Skeleton: "entity",
  s7Banner: "institutional",
  s7CopyHtml: "institutional",
  signalsBody: "signals",
  "signalsBody.institutional": "signals",
  "signalsBody.triage": "signals",
  signalsCongressColumnHtml: "methodology",
  signalsInstitutionalHtml: "signals",
  signalsOverlapHtml: "signals",
  signalsOverlapMethodHtml: "methodology",
  signalsPlaybooksHtml: "signals",
  signalsPlaybooksMethodHtml: "methodology",
  signalsRankingHtml: "methodology",
  specimenCard: "home",
  "tickerUnifiedBody.data": "entity",
  "tickerUnifiedBody.module-absent": "entity",
  triageRowHtml: "signals",
  "triageRowHtml.playbooks": "signals",
};

/** The page compositions the parity harness does not reproduce: the
    /congress/ boards as congress/index.astro composes them — the reference
    rankings at the page's defaults, the Members board marked as the pair's
    primary, both inside `.design-rankings` — and the filer page's reported
    positions as its holdings surface paints them (`holdingsTableHtml` in
    reference mode: one row per issuer, an issuer reported on two rows grouped,
    each position's receipt inside its position cell). */
async function compositions(): Promise<Record<string, Surface>> {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const ui: any = await import("../src/lib/ui/index.ts");
  const { leadersRollup, congressTickersRollup } = await import("../src/lib/derive.ts");
  const { COMPACT_ROWS } = await import("../src/lib/format.ts");
  const { fixtureTxns } = await import("./lib/inst-signals-fixture.ts");
  const txns = fixtureTxns();
  const date = "2026-07-24";
  const stamps = { buildId: "20260724.3", generatedAt: "2026-07-24 06:56 UTC", generatedAtDate: date };
  const ctx = { referenceRankings: true };
  const momentum = ui.congressRankingSection("tickers", congressTickersRollup(txns, date, { range: "12m", basis: "traded" }), stamps, ctx, {
    rootId: ui.CONGRESS_ROOTS.momentum,
    heading: "Tickers",
    sectionId: "momentum-section",
    controls: true,
    compact: COMPACT_ROWS,
    alternatives: ui.rankingAlternatives(txns, date, "tickers", "12m", "traded"),
  });
  const members = ui.congressRankingSection("leaders", leadersRollup(txns, date, { range: "12m", basis: "traded" }), stamps, ctx, {
    rootId: ui.CONGRESS_ROOTS.membersRanked,
    undisclosedRootId: ui.CONGRESS_ROOTS.membersUndisclosed,
    heading: "Members",
    sectionId: "members-section",
    compact: COMPACT_ROWS,
  });
  const { holdingsTableHtml } = await import("../src/lib/holdings.ts");
  const { FILINGS } = await import("./fixtures/institutional.ts");
  const row = (over: Record<string, unknown>): any => ({
    cik: "0000102909", period: "2026-03-31", filing_key: "1", security_id: null, cusip: "037833100",
    issuer_name: "APPLE INC", title_of_class: "COM", value_usd: 100_000_000, shares: 10_000, ssh_type: "SH",
    put_call: null, position_key: "cusip:037833100", put_call_bucket: "LONG", unit_key: "SH", flags: [],
    ticker: "AAPL", ticker_verified_date: "2026-09-10", ...over,
  });
  const holdings = holdingsTableHtml({
    reference: true, cik: "0000102909", filerName: "Fixture Advisors LLC", period: "2026-03-31", filings: FILINGS, page: 0,
    rows: [
      row({}),
      row({ cusip: "594918104", issuer_name: "MICROSOFT CORP", position_key: "cusip:594918104", value_usd: 90_000_000, ticker: "MSFT" }),
      row({ cusip: "594918104", issuer_name: "MICROSOFT CORP", title_of_class: "CALL", put_call: "CALL", put_call_bucket: "CALL", position_key: "cusip:594918104:CALL", value_usd: 5_000_000, ticker: "MSFT" }),
    ],
  });
  return {
    "congress.boards": { page: "congress", html: `<div class="design-rankings" id="congress-leaders-band">${ui.markPairPrimary(members)}${momentum}</div>` },
    "filer.holdings": { page: "filer", html: `<section class="panel panel-wide" aria-label="Reported positions">${holdings}</section>` },
  };
}

interface Surface {
  page: PageKind;
  html: string;
}

let surfacesMemo: Promise<{ parity: Record<string, string>; all: Record<string, Surface> }> | null = null;
function surfaces(): Promise<{ parity: Record<string, string>; all: Record<string, Surface> }> {
  surfacesMemo ??= (async () => {
    const parity = await renderParitySurfaces();
    const all: Record<string, Surface> = {};
    for (const [name, html] of Object.entries(parity)) {
      const page = SURFACE_PAGE[name];
      if (page) all[name] = { page, html };
    }
    for (const [name, s] of Object.entries(await compositions())) all[name] = s;
    return { parity, all };
  })();
  return surfacesMemo;
}

/** The real assets: the nine stylesheets (fetched in Base.astro's order by
    the page's links) and the fonts their @font-face rules point at. */
const ASSETS = new Map<string, { type: string; body: Buffer }>();
for (const name of baseStyleImports()) {
  ASSETS.set(`/styles/${name}`, { type: "text/css; charset=utf-8", body: readFileSync(path.join(DASHBOARD, "src", "styles", name)) });
}
for (const name of readdirSync(path.join(DASHBOARD, "src", "assets", "fonts"))) {
  ASSETS.set(`/assets/fonts/${name}`, { type: "font/woff2", body: readFileSync(path.join(DASHBOARD, "src", "assets", "fonts", name)) });
}

function documentHtml(body: string, plantedCss: string): string {
  const links = baseStyleImports()
    .map((n) => `<link rel="stylesheet" href="/styles/${n}">`)
    .join("");
  return (
    `<!doctype html><html lang="en"><head><meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">` +
    `${links}${plantedCss ? `<style>${plantedCss}</style>` : ""}</head><body>${body}</body></html>`
  );
}

/* ---------------------------------------------------------- the engine */

let browser: Browser | null = null;
let launchError = "";
before(async () => {
  try {
    browser = await chromium.launch();
  } catch (e) {
    launchError = String(e instanceof Error ? e.message : e).split("\n")[0] ?? "";
  }
});
after(async () => {
  await browser?.close();
});

function engine(t: TestContext): Browser | null {
  if (browser) return browser;
  if (process.env.CI) {
    t.skip(`no Chromium on this CI runner (${launchError}); npm ci installs no browser, and every local npm test runs this suite`);
    return null;
  }
  throw new Error(`Chromium did not launch (${launchError}). Install it with \`npm run geometry:install\`: this suite measures the phone layouts in a real engine and never passes without one.`);
}

interface Measured {
  surface: string;
  audit: PhoneAudit;
  cards: PhoneCardAudit;
}

interface MeasureOpts {
  /** the 1440px fine-pointer reference instead of a phone */
  desktop?: boolean;
  /** CSS appended after the nine sheets (a control's re-planted rule) */
  css?: string;
  /** measure only these surfaces */
  only?: readonly string[];
  /** rewrite a surface's raw markup before the layout's roles pass */
  mutate?: (name: string, html: string) => string;
}

async function measure(b: Browser, width: number, opts: MeasureOpts = {}): Promise<Measured[]> {
  const { all } = await surfaces();
  const names = opts.only ?? Object.keys(all).sort();
  const pages = new Map<string, string>();
  for (const name of names) {
    const s = all[name];
    assert.ok(s, `no surface named ${name}`);
    const [open, close] = PAGES[s.page];
    const raw = opts.mutate ? opts.mutate(name, s.html) : s.html;
    pages.set(`/s/${encodeURIComponent(name)}.html`, documentHtml(withTableRoles(open + raw + close), opts.css ?? ""));
  }
  const ctx = await b.newContext(
    opts.desktop
      ? { viewport: { width, height: 900 }, deviceScaleFactor: 1 }
      : { viewport: { width, height: HEIGHT }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: IPHONE_UA },
  );
  try {
    await ctx.route("**/*", async (route) => {
      const url = new URL(route.request().url());
      if (url.origin !== ORIGIN) return route.abort();
      const html = pages.get(url.pathname);
      if (html !== undefined) return route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: html });
      const asset = ASSETS.get(url.pathname);
      if (asset) return route.fulfill({ status: 200, contentType: asset.type, headers: { "cache-control": "max-age=3600" }, body: asset.body });
      return route.fulfill({ status: 404, body: "" });
    });
    /* a few tabs at once: each has its own viewport, scroll and hit tests */
    const out: Measured[] = new Array(names.length);
    let next = 0;
    const worker = async (): Promise<void> => {
      const page = await ctx.newPage();
      for (let i = next++; i < names.length; i = next++) {
        const name = names[i]!;
        await page.goto(`${ORIGIN}/s/${encodeURIComponent(name)}.html`, { waitUntil: "load" });
        await page.evaluate(async () => {
          await document.fonts.ready;
          await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        });
        assert.equal(await page.evaluate(() => matchMedia("(any-pointer: coarse)").matches), !opts.desktop, "a phone context is a coarse pointer; the reference is not");
        const audit = await page.evaluate(phoneAuditInPage, AUDIT_ARG);
        const cards = await page.evaluate(phoneCardAuditInPage, CARD_ARG);
        out[i] = { surface: name, audit, cards };
      }
    };
    await Promise.all(Array.from({ length: Math.min(TABS, names.length) }, worker));
    return out;
  } finally {
    await ctx.close();
  }
}

const memo = new Map<number, Promise<Measured[]>>();
/** PHONE_SURFACES_OUT=<dir> keeps each width's measurements as JSON evidence. */
async function measured(t: TestContext, width: number): Promise<Measured[] | null> {
  const b = engine(t);
  if (!b) return null;
  /* the first call starts every width (and the desktop reference) at once */
  if (memo.size === 0) {
    void desktopReference(b);
    for (const w of WIDTHS) {
      const run = measure(b, w).then((all) => {
        const dir = process.env.PHONE_SURFACES_OUT;
        if (dir) {
          mkdirSync(dir, { recursive: true });
          writeFileSync(path.join(dir, `phone-surfaces-${w}.json`), JSON.stringify(all, null, 1));
        }
        return all;
      });
      run.catch(() => undefined); // awaited by its own tests; never an unhandled rejection
      memo.set(w, run);
    }
  }
  return memo.get(width)!;
}

const sideways = (m: Measured): boolean => m.audit.pageW > m.audit.vw;

/** The 1440px fine-pointer reference, measured once: what a desktop reader
    sees of each surface. */
let desktopMemo: Promise<Measured[]> | null = null;
function desktopReference(b: Browser): Promise<Measured[]> {
  if (!desktopMemo) {
    desktopMemo = measure(b, 1440, { desktop: true });
    desktopMemo.catch(() => undefined); // awaited by the honesty tests
  }
  return desktopMemo;
}

/** The honesty problems a PHONE adds. An element no reader sees at 1440 either
    — the variant a radio has not selected (`.si-variant`), a closed panel —
    is a structural hide, not the fold's: a "not rendered" or "has no box"
    finding that the desktop reference makes for the same element (the same
    message, counted) is dropped. Every clip, clamp, ellipsis and escape stays,
    and so does every element the desktop renders and the phone does not —
    the R2/R5 property: no width loses a caveat. */
export function phoneOnlyHonesty(phone: readonly string[], desktop: readonly string[]): string[] {
  const structural = /(?:is not rendered|has no box)$/;
  const left = new Map<string, number>();
  for (const p of desktop) if (structural.test(p)) left.set(p, (left.get(p) ?? 0) + 1);
  return phone.filter((p) => {
    const n = left.get(p) ?? 0;
    if (n === 0) return true;
    left.set(p, n - 1);
    return false;
  });
}

/* ------------------------------------------------------------ the suite */

test("every parity surface is placed on its page, and the composed /congress/ boards and filer positions are measured too", async () => {
  const { parity, all } = await surfaces();
  assert.deepEqual(Object.keys(SURFACE_PAGE).sort(), Object.keys(parity).sort(), "SURFACE_PAGE places exactly the surfaces the parity harness renders");
  assert.ok(all["congress.boards"]?.html.includes('class="design-rankings"'), "the composed boards sit in .design-rankings");
  assert.match(all["congress.boards"]!.html, /id="momentum-section"[\s\S]*reference-ranking|reference-ranking[\s\S]*id="momentum-section"/, "the composed boards are the reference rankings");
  assert.match(all["filer.holdings"]!.html, /<td class="c-pos[^"]*">[\s\S]*?class="cell cell-src"><a /, "the composed holdings carry a receipt inside a position cell");
});

for (const width of WIDTHS) {
  test(`phone surfaces @${width}: the page never scrolls sideways (B1, R4)`, async (t) => {
    const all = await measured(t, width);
    if (!all) return;
    assert.ok(all.length > 40, "the suite measured the surfaces");
    const bad = all.filter(sideways).map((m) => `${m.surface}: ${m.audit.pageW}px wide at ${m.audit.vw}px — ${m.cards.overflow.join("; ") || "no unclipped box past the edge"}`);
    assert.deepEqual(bad, []);
  });

  test(`phone surfaces @${width}: no honesty element is hidden, clipped, clamped or cut (R2, R5)`, async (t) => {
    const all = await measured(t, width);
    if (!all) return;
    const desk = new Map((await desktopReference(engine(t)!)).map((m) => [m.surface, m.audit.honestyProblems]));
    assert.ok(all.reduce((n, m) => n + m.audit.honestyChecked, 0) > 800, "the honesty predicate checked the surfaces' honesty elements");
    assert.deepEqual(
      all.flatMap((m) => phoneOnlyHonesty(m.audit.honestyProblems, desk.get(m.surface) ?? []).map((p) => `${m.surface}: ${p}`)),
      [],
    );
  });

  test(`phone surfaces @${width}: a card's tap target is its main link, never a receipt (M1, M2, R7)`, async (t) => {
    const all = await measured(t, width);
    if (!all) return;
    assert.ok(all.reduce((n, m) => n + m.cards.tapChecked, 0) > 80, "card taps were checked");
    assert.ok(all.reduce((n, m) => n + m.cards.siCards, 0) > 0, "signal cards were checked");
    assert.ok(all.reduce((n, m) => n + m.cards.receipts, 0) > 0, "Named-moves receipts were checked");
    assert.deepEqual(
      all.flatMap((m) => [...m.cards.tapProblems, ...m.cards.siCardProblems, ...m.cards.receiptProblems].map((p) => `${m.surface}: ${p}`)),
      [],
    );
  });

  test(`phone surfaces @${width}: every number on a card prints its column's label (M4, R2)`, async (t) => {
    const all = await measured(t, width);
    if (!all) return;
    assert.ok(all.reduce((n, m) => n + m.cards.numCells, 0) > 200, "card numbers were checked");
    assert.deepEqual(
      all.flatMap((m) => m.cards.labelProblems.map((p) => `${m.surface}: ${p}`)),
      [],
    );
  });
}

/* ------------------------------------------------------------ the controls */

test("controls: the boards' re-planted min-widths make the page scroll sideways (B1)", async (t) => {
  const b = engine(t);
  if (!b) return;
  for (const [rule, width] of [
    [".design-rankings .reference-ranking .etable { min-width: 680px; }", 430],
    ["#momentum-section.reference-ranking .etable { min-width: 440px; }", 360],
  ] as const) {
    const [boards] = await measure(b, width, { only: ["congress.boards"], css: `@media (max-width: 1080px) { ${rule} }` });
    assert.ok(sideways(boards!), `${rule} re-planted at ≤1080px must scroll the page sideways at ${width} (page ${boards!.audit.pageW}px)`);
    assert.ok(boards!.cards.overflow.some((o) => /table|tbody|tr/.test(o)), "the overflow names the table");
  }
  /* the card's min-width:0 backstop outweighs a plain table rule at the fold
     (the old .si-table one), and a heavier one is still measured */
  const [backstopped] = await measure(b, 390, { only: ["signalsBody"], css: "@media (max-width: 720px) { .si-table { min-width: 720px; } }" });
  assert.ok(!sideways(backstopped!), `the backstop holds .si-table{min-width:720px} to the card (page ${backstopped!.audit.pageW}px)`);
  const [heavy] = await measure(b, 390, { only: ["signalsBody"], css: "@media (max-width: 720px) { #signals-page .si-table { min-width: 720px; } }" });
  assert.ok(sideways(heavy!), `#signals-page .si-table{min-width:720px} must scroll sideways (page ${heavy!.audit.pageW}px)`);
});

test("controls: a re-planted ellipsis or fold hide on an honesty field is caught, and the desktop reference never excuses it (R5)", async (t) => {
  const b = engine(t);
  if (!b) return;
  const [cut] = await measure(b, 390, {
    only: ["memberBody.active"],
    css: "@media (max-width: 720px) { .lag { display: inline-block; max-width: 8px; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; } }",
  });
  assert.ok(cut!.audit.honestyProblems.some((p) => /^\.lag: .*ellipsis/.test(p)), `caught: ${cut!.audit.honestyProblems.slice(0, 3).join(" | ")}`);
  const [hid] = await measure(b, 390, { only: ["memberBody.active"], css: "@media (max-width: 720px) { .owner-note { display: none; } }" });
  const desk = (await desktopReference(b)).find((m) => m.surface === "memberBody.active")!.audit.honestyProblems;
  const phoneOnly = phoneOnlyHonesty(hid!.audit.honestyProblems, desk);
  assert.ok(phoneOnly.some((p) => /^\.owner-note: .*is not rendered$/.test(p)), `a fold hide survives the desktop reference: ${phoneOnly.slice(0, 3).join(" | ")}`);
  /* and the reference drops only what the desktop also hides */
  assert.deepEqual(phoneOnlyHonesty([".x: a is not rendered", ".x: a is not rendered", ".y: b is clipped by c"], [".x: a is not rendered", ".y: b is clipped by c"]), [".x: a is not rendered", ".y: b is clipped by c"]);
});

test("controls: the old :first-of-type stretch of a position cell's receipt is caught (M2)", async (t) => {
  const b = engine(t);
  if (!b) return;
  const [m] = await measure(b, 390, {
    only: ["filer.holdings"],
    css:
      "@media (max-width: 720px) { table[data-card] > tbody > tr > .c-pos a:first-of-type { position: static !important; z-index: auto !important; }" +
      ' table[data-card] > tbody > tr > .c-pos a:first-of-type::after { content: ""; position: absolute; inset: 0; z-index: 1; } }',
  });
  assert.ok(m!.cards.tapProblems.some((p) => /opens the receipt/.test(p)), `caught: ${m!.cards.tapProblems.slice(0, 3).join(" | ")}`);
});

test("controls: a renderer that marks a receipt is caught, and the backstop keeps the receipt from taking the card (M2)", async (t) => {
  const b = engine(t);
  if (!b) return;
  const [m] = await measure(b, 390, { only: ["filer.holdings"], mutate: (_n, html) => html.replaceAll('<div class="cell cell-src"><a ', '<div class="cell cell-src"><a data-row-link ') });
  assert.ok(m!.cards.tapProblems.some((p) => /a receipt is marked as the row link/.test(p)), `caught: ${m!.cards.tapProblems.slice(0, 2).join(" | ")}`);
  assert.ok(!m!.cards.tapProblems.some((p) => /opens the receipt/.test(p)), "the :not(.cell-src a) backstop never stretches a marked receipt");
});

test("controls: a main link its renderer does not mark is caught (M2)", async (t) => {
  const b = engine(t);
  if (!b) return;
  const [m] = await measure(b, 390, { only: ["memberBody.active"], mutate: (_n, html) => html.replace(/ data-row-link/g, "") });
  assert.ok(m!.cards.tapProblems.some((p) => /is not the one marked row link \(marked: none\)/.test(p)), `caught: ${m!.cards.tapProblems.slice(0, 2).join(" | ")}`);
  assert.ok(m!.cards.tapProblems.some((p) => /a tap on the card lands on/.test(p)), "and the card's tap misses it");
});

test("controls: the link hit rule at its old weight takes the signal cards' whole-card tap and drops the 13F receipts (M1)", async (t) => {
  const b = engine(t);
  if (!b) return;
  const [m] = await measure(b, 390, {
    only: ["signalsBody.institutional"],
    css: "@media (any-pointer: coarse), (max-width: 720px) { a[href]:not(:is(p, li, dd, .note-pop, .footer-notice) a) { position: relative; } }",
  });
  assert.ok(m!.cards.siCards > 0 && m!.cards.receipts > 0, "the page holds signal cards and Named-moves receipts");
  assert.ok(m!.cards.siCardProblems.some((p) => /not a\.si-card-open/.test(p)), `caught (cards): ${m!.cards.siCardProblems.slice(0, 2).join(" | ")}`);
  assert.ok(m!.cards.receiptProblems.some((p) => /off its row's summary line/.test(p)), `caught (receipts): ${m!.cards.receiptProblems.slice(0, 2).join(" | ")}`);
});

test("controls: a column head without data-label leaves its numbers unlabelled (M4)", async (t) => {
  const b = engine(t);
  if (!b) return;
  const [m] = await measure(b, 390, { only: ["congressTickerBody"], mutate: (_n, html) => html.replace(/ data-label="[^"]*"/g, "") });
  assert.ok(m!.cards.labelProblems.some((p) => /names no column/.test(p)), `caught: ${m!.cards.labelProblems.slice(0, 2).join(" | ")}`);
});
