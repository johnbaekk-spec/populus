/* launch M1a (T1.2) → M1c (T1.14): the phone harness.

   The seventeen audited views (docs/design/launch-redesign-mock/data/mobile/,
   measured on live build 20261020.2), plus /e/, a Congress ticker page and the
   two redirect stubs, at 360, 390 and 430 px wide on a touch, iPhone-agent
   context, through the predicates in `geometry.ts` (`phoneAuditInPage`). The
   same spec runs against the local preview (playwright.config.ts) and against
   the live domain (playwright.production.config.ts), so the gate and the live
   probe are one ruler.

   Entity routes: fixed ids live; on a local build a fixed id the dist does not
   hold is replaced by one discovered from the dist (the heaviest, the
   lightest and a middle member page; the first filer, holders and ticker
   page), and the substitution is recorded in the result.

   Mode. M1a measured every predicate and gated nothing. From M1c the phone
   predicates GATE (R4, R5, R6, R7, R10, R13, plus R40's roles); the DOM
   budget (R35, ≤3,000 elements) gates on every LD31 route (dom-budget.ts),
   and /signals/ is measured and recorded under D6, never gated. Every result is written to the test's output
   directory as JSON (the measure-mode report, and the font map for the T0
   diff), so the evidence survives the run.

   Controls (`phone predicate controls`) plant each defect the predicates exist
   to catch into a page of their own and require the predicate to fail. */

import { test, expect, type Browser, type BrowserContext, type Page, type TestInfo } from "@playwright/test";
import { existsSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { HONESTY_SELECTORS } from "../lib/honesty-selectors.ts";
import { phoneAuditInPage, servedWordsInPage, skipDecision, type PhoneAudit, type PhoneAuditArg } from "./geometry.ts";
import { DOM_D6_MEASURED, domBudgetProblem } from "./dom-budget.ts";

const WIDTHS = [360, 390, 430] as const;
type Width = (typeof WIDTHS)[number];
const HEIGHT = 844;
const IPHONE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1 PublicFilingsPhoneHarness";

const THEME = (process.env.POPULUS_THEME ?? "dark").trim() === "light" ? "light" : "dark";

/** R10's allowlist: tab bars, chip and tool rows, swipe strips — and (launch
    integration, M7b R34/LD30) Methodology's sticky contents menu, a nav row
    named by its own `aria-label="Sections"` that scrolls sideways at ≤720px. */
export const SCROLLER_ALLOW: readonly string[] = [".sig-tabs-scroll", ".tk-tabs", ".si-pb-chips", ".ov-tools", ".mv-chips", ".si-cards", ".metho-toc", "[data-scroll-region]"];
/** The swipe strips among them (LD11: x mandatory snap): the signal cards
    (home and Signals), the playbook list, and any strip a renderer marks. */
export const SWIPE_STRIPS: readonly string[] = [".pb-list", ".si-cards", "[data-swipe]"];

const ARG: PhoneAuditArg = { honesty: HONESTY_SELECTORS, scrollerAllow: SCROLLER_ALLOW, swipe: SWIPE_STRIPS, minTap: 44, minFont: 11 };

/** T1.14 (M1c): the phone predicates GATE (M1a measured them only). */
const GATED = {
  sideways: true, // R4
  honesty: true, // R5 (R2 on cards)
  text: true, // R6
  taps: true, // R7
  covered: true, // R7
  scrollers: true, // R10
  gutters: true, // R13
  roles: true, // R40
} as const;
/* LD31 / D6: which views the ≤3,000-element budget gates lives in one map,
   `dom-budget.ts` (pinned by test/launch-dom-budget.test.ts): every LD31
   route gates now that its milestone is integrated; /signals/ is D6's
   measured exception; the Congress ticker page and the stubs are measured. */

interface View {
  id: string;
  /** a path, or the kind of entity page to discover from a local dist */
  path: string;
  discover?: "member-heavy" | "member-sparse" | "member-active" | "filer" | "holders" | "ticker" | "congress-ticker";
  /** the expected HTTP status (the 404 view answers 404) */
  status?: number;
  /** strip the meta refresh, so the stub itself is audited */
  stub?: boolean;
}

export const VIEWS: readonly View[] = [
  { id: "home", path: "/" },
  { id: "congress", path: "/congress/" },
  { id: "member-active", path: "/congress/members/P000197/", discover: "member-active" },
  { id: "member-sparse", path: "/congress/members/J000289/", discover: "member-sparse" },
  { id: "member-heavy", path: "/congress/members/G000583/", discover: "member-heavy" },
  { id: "ticker", path: "/tickers/AAPL/#congress", discover: "ticker" },
  { id: "ticker-inst", path: "/tickers/AAPL/#institutional", discover: "ticker" },
  { id: "signals", path: "/signals/" },
  { id: "signals-inst", path: "/signals/#institutional" },
  { id: "signals-overlap", path: "/signals/#overlap" },
  { id: "signals-playbooks", path: "/signals/#playbooks" },
  { id: "institutional", path: "/institutional/" },
  { id: "filer", path: "/institutional/filers/1067983/", discover: "filer" },
  { id: "holders", path: "/institutional/tickers/AAPL/holders/", discover: "holders" },
  { id: "methodology", path: "/methodology/" },
  { id: "congress-data", path: "/congress/data/" },
  { id: "not-found", path: "/no-such-page/", status: 404 },
  { id: "e-member", path: "/e/?k=m:M001193" },
  { id: "congress-ticker", path: "/congress/tickers/NVDA/", discover: "congress-ticker" },
  { id: "stub-leaders", path: "/congress/leaders/", stub: true },
  { id: "stub-tickers", path: "/congress/tickers/", stub: true },
];

/* --------------------------------------------------------- route discovery */

const LIVE = (base: string | undefined): boolean => !!base && !/localhost|127\.0\.0\.1/.test(base);
const DIST = process.env.POPULUS_DIST_DIR ?? path.resolve(import.meta.dirname, "..", "..", "dist");

function distHas(p: string): boolean {
  const clean = p.split(/[?#]/)[0]!;
  return existsSync(path.join(DIST, clean, "index.html"));
}
function pagesUnder(rel: string, leaf = "index.html"): { dir: string; size: number }[] {
  const root = path.join(DIST, rel);
  if (!existsSync(root)) return [];
  return readdirSync(root)
    .sort()
    .map((d) => ({ dir: d, file: path.join(root, d, leaf) }))
    .filter((x) => existsSync(x.file))
    .map((x) => ({ dir: x.dir, size: statSync(x.file).size }));
}

/** The view's path on this server, and whether it replaced a fixed id. */
function resolveView(view: View, baseURL: string | undefined): { path: string; substituted: boolean } | null {
  if (LIVE(baseURL) || !view.discover || distHas(view.path)) return { path: view.path, substituted: false };
  const hash = view.path.includes("#") ? view.path.slice(view.path.indexOf("#")) : "";
  const pick = (rel: string, mode: "max" | "min" | "mid" | "first", leaf?: string): string | null => {
    const pages = pagesUnder(rel, leaf);
    if (pages.length === 0) return null;
    const bySize = [...pages].sort((a, b) => a.size - b.size || (a.dir < b.dir ? -1 : 1));
    const p = mode === "max" ? bySize.at(-1)! : mode === "min" ? bySize[0]! : mode === "mid" ? bySize[Math.floor(bySize.length / 2)]! : pages[0]!;
    return p.dir;
  };
  let found: string | null = null;
  switch (view.discover) {
    case "member-heavy":
      found = pick("congress/members", "max");
      break;
    case "member-sparse":
      found = pick("congress/members", "min");
      break;
    case "member-active":
      found = pick("congress/members", "mid");
      break;
    case "filer":
      found = pick("institutional/filers", "first");
      break;
    case "holders": {
      const t = pick("institutional/tickers", "first", path.join("holders", "index.html"));
      return t ? { path: `/institutional/tickers/${t}/holders/`, substituted: true } : null;
    }
    case "ticker":
      found = pick("tickers", "first");
      break;
    case "congress-ticker":
      found = pick("congress/tickers", "first");
      break;
  }
  if (!found) return null;
  const prefix = { "member-heavy": "/congress/members/", "member-sparse": "/congress/members/", "member-active": "/congress/members/", filer: "/institutional/filers/", ticker: "/tickers/", "congress-ticker": "/congress/tickers/" }[view.discover as Exclude<View["discover"], "holders" | undefined>];
  return { path: `${prefix}${found}/${hash}`, substituted: true };
}

/* ------------------------------------------------------------- the harness */

async function phoneContext(browser: Browser, baseURL: string | undefined, width: Width, js = true): Promise<BrowserContext> {
  const ctx = await browser.newContext({
    baseURL,
    viewport: { width, height: HEIGHT },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    userAgent: IPHONE_UA,
    javaScriptEnabled: js,
  });
  await ctx.route(/cloudflareinsights\.com/, (r) => r.abort());
  await ctx.addInitScript((t: string) => {
    try {
      localStorage.setItem("populus:theme", t);
    } catch {
      /* storage blocked */
    }
  }, THEME);
  return ctx;
}

/** Serve a stub without its meta refresh, so the stub page itself is measured. */
async function stripRefresh(page: Page, url: string): Promise<void> {
  await page.route(url, async (route) => {
    const resp = await route.fetch({ maxRedirects: 0 });
    const body = (await resp.text()).replace(/<meta\s+http-equiv=["']?refresh["']?[^>]*>/gi, "");
    await route.fulfill({ response: resp, body });
  });
}

async function settle(page: Page): Promise<void> {
  await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => undefined);
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  });
}

interface PhoneResult {
  view: string;
  path: string;
  substituted: boolean;
  width: Width;
  theme: string;
  audit: PhoneAudit;
  servedWords: number;
  axRows: number;
}

function record(testInfo: TestInfo, r: PhoneResult): void {
  writeFileSync(testInfo.outputPath(`phone-${r.view}-${r.width}.json`), JSON.stringify(r, null, 1));
}

const list = (xs: readonly string[], max = 20): string => (xs.length === 0 ? "none" : xs.slice(0, max).join("\n  ") + (xs.length > max ? `\n  … ${xs.length - max} more` : ""));

for (const view of VIEWS) {
  for (const width of WIDTHS) {
    test(`phone ${view.id} @${width}`, async ({ browser }, testInfo) => {
      test.setTimeout(240_000);
      const baseURL = testInfo.project.use.baseURL;
      const resolved = resolveView(view, baseURL);
      if (!resolved) {
        const d = skipDecision(process.env, `${view.id}: the served build holds no ${view.discover} page`);
        if ("skip" in d) test.skip(true, d.skip);
        else throw new Error(d.fail);
        return;
      }
      const ctx = await phoneContext(browser, baseURL, width);
      try {
        const page = await ctx.newPage();
        if (view.stub) await stripRefresh(page, new URL(resolved.path, baseURL).toString());
        const resp = await page.goto(resolved.path, { waitUntil: "load" });
        expect(resp, `${resolved.path}: no response`).not.toBeNull();
        expect(resp!.status(), `${resolved.path} must answer ${view.status ?? 200} before anything is measured`).toBe(view.status ?? 200);
        expect(await page.evaluate(() => matchMedia("(any-pointer: coarse)").matches), "a phone context is a coarse pointer").toBe(true);
        await settle(page);
        const audit = await page.evaluate(phoneAuditInPage, ARG);
        const axRows = await page.locator("table[data-card]").first().getByRole("row").count().catch(() => 0);

        /* SC5's ruler: the served HTML, JavaScript off, no redirect followed */
        const off = await phoneContext(browser, baseURL, width, false);
        let servedWords = -1;
        try {
          const p2 = await off.newPage();
          await stripRefresh(p2, new URL(resolved.path, baseURL).toString());
          await p2.goto(resolved.path, { waitUntil: "load" });
          servedWords = await p2.evaluate(servedWordsInPage, "body");
        } finally {
          await off.close();
        }

        const result: PhoneResult = { view: view.id, path: resolved.path, substituted: resolved.substituted, width, theme: THEME, audit, servedWords, axRows };
        record(testInfo, result);

        expect(audit.textChars, "the page rendered text to measure").toBeGreaterThan(0);
        expect(audit.taps, "the page rendered tap targets to measure").toBeGreaterThan(0);
        if (audit.cardTables > 0) expect(axRows, "a card table keeps its rows in the accessibility tree (R40)").toBeGreaterThan(0);

        const problems: string[] = [];
        if (GATED.sideways && audit.sidewaysTables.length) problems.push(`R4 sideways tables:\n  ${list(audit.sidewaysTables)}`);
        if (GATED.honesty && audit.honestyProblems.length) problems.push(`R5 honesty fields hidden, clipped or clamped:\n  ${list(audit.honestyProblems)}`);
        if (GATED.text && audit.smallText.length) problems.push(`R6 text under ${ARG.minFont}px:\n  ${list(audit.smallText)}`);
        if (GATED.taps && audit.smallTaps.length) problems.push(`R7 taps under ${ARG.minTap}px:\n  ${list(audit.smallTaps)}`);
        if (GATED.covered && audit.coveredTaps.length) problems.push(`R7 covered taps:\n  ${list(audit.coveredTaps)}`);
        if (GATED.scrollers && audit.scrollerProblems.length) problems.push(`R10 sideways scrollers:\n  ${list(audit.scrollerProblems)}`);
        if (GATED.gutters && audit.gutterL !== null && (Math.abs(audit.gutterL - 16) > 1 || Math.abs((audit.gutterR ?? 16) - 16) > 1)) {
          problems.push(`R13 side gutters ${audit.gutterL}/${audit.gutterR}px, want 16 ±1`);
        }
        if (GATED.roles && audit.roleProblems.length) problems.push(`R40 table roles:\n  ${list(audit.roleProblems)}`);
        const dom = domBudgetProblem(view.id, audit.dom);
        if (dom) problems.push(dom);
        if (DOM_D6_MEASURED.has(view.id)) testInfo.annotations.push({ type: "D6 measured", description: `${view.id} @${width}: ${audit.dom} elements at first load (recorded, not gated)` });
        expect(problems, `${view.id} @${width} (${resolved.path})`).toEqual([]);
      } finally {
        await ctx.close();
      }
    });
  }
}

/* ------------------------------------------------------------ the controls */

const CONTROL_CSS = `body{margin:0;font:14px/1.4 sans-serif}.shell{padding:0 16px}a{display:inline-block;min-height:44px;min-width:44px}
  .visually-hidden{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}`;
const COMPLIANT =
  `<div class="shell"><table data-card="generic" role="table"><thead role="rowgroup"><tr role="row"><th role="columnheader" scope="col">Name</th></tr></thead>` +
  `<tbody role="rowgroup"><tr role="row" style="display:block;position:relative"><td role="cell" style="display:block"><a href="/m/" class="main">Member</a> ` +
  `<span class="owner-note">owner not stated</span> <span class="cell-filed">2026-10-01</span> <a href="/src/" class="cell-src" style="position:relative;z-index:2">PTR</a></td></tr></tbody></table></div>`;

async function controlAudit(browser: Browser, html: string): Promise<PhoneAudit> {
  const ctx = await browser.newContext({ viewport: { width: 390, height: HEIGHT }, isMobile: true, hasTouch: true, userAgent: IPHONE_UA });
  try {
    const page = await ctx.newPage();
    await page.setContent(`<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>${CONTROL_CSS}</style></head><body>${html}</body></html>`);
    return await page.evaluate(phoneAuditInPage, ARG);
  } finally {
    await ctx.close();
  }
}

test.describe("phone predicate controls", () => {
  test("a compliant card table passes every predicate (positive control)", async ({ browser }) => {
    const a = await controlAudit(browser, COMPLIANT);
    expect([a.sidewaysTables, a.honestyProblems, a.smallText, a.smallTaps, a.coveredTaps, a.scrollerProblems, a.roleProblems]).toEqual([[], [], [], [], [], [], []]);
    expect(a.cardTables).toBe(1);
    expect(a.honestyChecked).toBeGreaterThan(0);
    expect(a.gutterL).toBe(16);
  });
  test("a planted scrolling wide table fails R4 and R10", async ({ browser }) => {
    const a = await controlAudit(browser, `<div class="shell"><div class="table-scroll" style="overflow-x:auto"><table data-card="generic" role="table"><tbody role="rowgroup"><tr role="row"><td role="cell" style="white-space:nowrap">${"wide ".repeat(80)}</td></tr></tbody></table></div></div>`);
    expect(a.sidewaysTables.length).toBeGreaterThan(0);
    expect(a.scrollerProblems.some((p) => /table inside/.test(p))).toBe(true);
  });
  test("a planted 720px table in a visible wrapper makes the document scroll sideways, and R4 says so (launch review B1: innerWidth grows with the page in a mobile context, so the predicate reads clientWidth)", async ({ browser }) => {
    const a = await controlAudit(browser, `<div class="shell"><div class="table-scroll" style="overflow-x:visible"><table data-card="generic" role="table" style="display:block;min-width:720px"><tbody role="rowgroup"><tr role="row"><td role="cell">wide</td></tr></tbody></table></div></div>`);
    expect(a.vw, "the predicate reads the 390px layout viewport, not the grown innerWidth").toBe(390);
    expect(a.sidewaysTables.some((p) => /document scrolls sideways/.test(p))).toBe(true);
  });
  test("a planted 10px label fails R6", async ({ browser }) => {
    const a = await controlAudit(browser, `${COMPLIANT}<p><span style="font-size:10px">tiny label</span></p>`);
    expect(a.smallText.length).toBeGreaterThan(0);
  });
  test("a planted 30px link fails R7", async ({ browser }) => {
    const a = await controlAudit(browser, `${COMPLIANT}<div><a href="/r/" style="display:inline-block;min-height:0;min-width:0;height:30px;width:30px">r</a></div>`);
    expect(a.smallTaps.some((t) => /30x30/.test(t))).toBe(true);
  });
  test("a planted stretched link above a receipt fails R7's cover check", async ({ browser }) => {
    const html = COMPLIANT.replace('class="main"', 'class="main" style="position:static"').replace(
      "</tr></tbody>",
      "</tr></tbody>",
    ).replace('<tr role="row" style="display:block;position:relative">', '<tr role="row" style="display:block;position:relative"><style>.main::after{content:"";position:absolute;inset:0;z-index:5}</style>');
    const a = await controlAudit(browser, html);
    expect(a.coveredTaps.some((t) => /cell-src/.test(t))).toBe(true);
  });
  test("a planted display:none on .cell-filed fails R5", async ({ browser }) => {
    const a = await controlAudit(browser, COMPLIANT.replace('<span class="cell-filed">', '<span class="cell-filed" style="display:none">'));
    expect(a.honestyProblems.some((p) => /\.cell-filed/.test(p))).toBe(true);
  });
  test("a planted clamp on .owner-note fails R5", async ({ browser }) => {
    const a = await controlAudit(
      browser,
      COMPLIANT.replace('<span class="owner-note">owner not stated</span>', `<span class="owner-note" style="display:-webkit-box;-webkit-line-clamp:1;-webkit-box-orient:vertical;overflow:hidden;width:60px">${"owner not stated ".repeat(6)}</span>`),
    );
    expect(a.honestyProblems.some((p) => /\.owner-note/.test(p) && /clamp|clipped|ellipsis/.test(p))).toBe(true);
  });
  test("a planted role-less card row fails R40", async ({ browser }) => {
    const a = await controlAudit(browser, COMPLIANT.replace('<tbody role="rowgroup">', '<tbody role="rowgroup"><tr><td>no roles</td></tr>'));
    expect(a.roleProblems.length).toBeGreaterThanOrEqual(2);
  });
  test("a planted unnamed, unsnapped swipe strip fails R10", async ({ browser }) => {
    const a = await controlAudit(browser, `${COMPLIANT}<div class="pb-list" style="display:flex;overflow-x:auto;width:200px">${'<a href="/x/" style="flex:0 0 150px">item</a>'.repeat(4)}</div>`);
    expect(a.scrollerProblems.some((p) => /unnamed/.test(p))).toBe(true);
    expect(a.scrollerProblems.some((p) => /snap/.test(p))).toBe(true);
    expect(a.scrollerProblems.some((p) => /not an allowed scroller/.test(p))).toBe(true);
  });
});
