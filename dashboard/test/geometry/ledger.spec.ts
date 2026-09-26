/* DESIGN-POLISH T1.10 / R29 / R35 — the ledger geometry gate, G1–G12.

   Runs every check from `geometry.ts` (ONE in-page probe, `window.__ledger`)
   on the five design routes and the shared routes, at 1440×900 and 390×844,
   in the theme named by POPULUS_THEME (`dark`, the default, or `light`).
   Under the `touch` project (hasTouch, isMobile) the same checks run on a
   coarse pointer.

   Harness rules (plan, Tasks and Verification, "Harness rules"):
   - every route answers HTTP 200 and renders a minimum number of tables and
     columns BEFORE anything is measured (a failure there fails every check
     of that route, it never silently measures an empty page);
   - the theme is seeded by an init script and the body background is
     asserted — rgb(4, 7, 13) dark, rgb(250, 249, 245) light — so neither
     pass can stand in for the other;
   - the touch project first asserts `(any-pointer: coarse)` (the
     `touch-preflight` project, which `touch` depends on, and again per route);
   - a check whose fix lands in a later milestone runs as ONE `test.fail()`
     across its routes, from the milestone map in `milestones.ts`; G2 instead
     exempts, by selector, the three containers M2 removes;
   - a skip fails the run when POPULUS_BUILD_DIR is set (the owner-tier
     build), because there a skipped check is an unrun check;
   - every check reports how many things it measured, and measuring nothing
     fails: a pass over nothing is not a pass.

   The full result of every check is written to the test's output directory
   (PW_OUTPUT_DIR) as JSON, so the evidence survives the run. */

import { test, expect, type Browser, type BrowserContext, type Page, type TestInfo } from "@playwright/test";
import { existsSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  installProbe,
  themeBackgroundProblem,
  formatResult,
  skipDecision,
  type LedgerResult,
  type Theme,
} from "./geometry.ts";
import {
  CHECK_MILESTONE,
  CURRENT_MILESTONE,
  EXTRA_CHECKS,
  GEOMETRY_CHECKS,
  g2Exemptions,
  isPending,
  type CheckId,
} from "./milestones.ts";

/* ---------------------------------------------------------------- inputs */

function parseTheme(v: string | undefined): Theme {
  const t = (v ?? "dark").trim();
  if (t !== "dark" && t !== "light") {
    throw new Error(`POPULUS_THEME must be "dark" or "light", got ${JSON.stringify(v)}`);
  }
  return t;
}
const THEME: Theme = parseTheme(process.env.POPULUS_THEME);

/* 768 runs G3 alone, on the document (M1 review C-3): the segmented group
   that could not wrap pushed /institutional/ sideways between 721 and 920px,
   a band neither 1440 nor 390 sees. A wide table may still scroll inside its
   own container there, as at the fold. */
const WIDTHS = [1440, 768, 390] as const;
type Width = (typeof WIDTHS)[number];
const HEIGHT: Record<Width, number> = { 1440: 900, 768: 1024, 390: 844 };

/** The seeded watchlist for `/watchlist/` (the `populus:watch:v2` shape
    `loadWatchStore` accepts: `v: 2`, bioguide members, tickers). */
const WATCH_SEED = JSON.stringify({ v: 2, members: ["M001193"], tickers: ["NVDA", "AAPL"] });

interface Route {
  id: string;
  /** a path, or a discovery run against the served build (null: none built) */
  path: string | ((ctx: BrowserContext) => Promise<string | null>);
  /** visible tables with at least one visible body row, and their columns */
  minTables: number;
  minColumns: number;
  /** a design route: G9 runs here with this many expected pairs (T-4) */
  pairs?: number;
  seedWatch?: boolean;
  /** Checks that may measure nothing on this route, keyed `check` or
      `check@width`, each with the reason. A zero there passes WITH an
      annotation naming the reason; anywhere else measuring nothing fails. */
  allowZero?: Partial<Record<string, string>>;
  /** The least G10's parts must measure here, keyed `part` or `part@width`
      (M1 review Q-12): a page that carries kind rows must measure their edge
      colours, one with a band-head control must measure its centring. */
  g10Min?: Partial<Record<string, number>>;
}

/** A page with no segmented control and no sort button has nothing for
    controlHeights to size (M1 review Q-10: the allowance is these routes'
    own, never a default). */
const NO_CONTROLS_ZERO = { controlHeights: "no segmented control or sort button on this page" };

/** The classic `/watchlist/` feed keeps its classic rules (declared debt,
    A-4): the ledger-construction checks have nothing to measure there, and
    its rows are measured at the fold (T-9). */
const CLASSIC_FEED_ZERO = {
  "G1@390": "the classic feed renders no header row at the fold, so no header edge exists to align to",
  "G6@390": "the classic feed renders no header row at the fold, so it has no columns to name",
  G7: "the classic feed marks no c-num cells (classic rules, A-4)",
  "G8@1440": "classic feed rows are measured at the fold only (T-9)",
  G10: "the classic feed is not a ledger table (A-4)",
  headFont: "the classic feed keeps its classic header (A-4)",
  oneFlex: "the classic feed is exempt from c-flex (A-4)",
  metaTruncation: "the page has no band head",
};

/** A tail filer the `/e/` driver resolves through the routing index — read
    from the served build, never hard-coded, so it exists in whatever build
    is under test. */
async function discoverTailFiler(ctx: BrowserContext): Promise<string | null> {
  const res = await ctx.request.get("/institutional/data/filers/index.v4.json");
  if (!res.ok()) return null;
  const body = (await res.json()) as { routes?: Record<string, unknown> };
  const cik = Object.keys(body.routes ?? {}).sort()[0];
  return cik ? `/e/?k=f:${String(Number(cik))}` : null;
}

/** A holders page, if the build has one: first from the link the ticker
    pages print when the page is built (works against any served build,
    production included), then from the dist on disk. The bounded local
    build generates none, so this may legitimately find nothing there. */
/** Set when discovery PROVED the served build has no holders page: the ticker
    pages link none and the dist on disk holds no `holders/index.html`. The
    bounded build emits none by construction, and the holders route has its own
    lane (`playwright.holders.config.ts`, a fixture page), so a proven absence is
    a stated skip even on the owner tier — unlike an unproven one, which stays a
    failure there. */
let holdersProvenAbsent = false;
async function discoverHolders(ctx: BrowserContext): Promise<string | null> {
  const page = await ctx.newPage();
  try {
    for (const p of ["/tickers/AAPL/", "/congress/tickers/NVDA/", "/tickers/NVDA/"]) {
      const r = await page.goto(p).catch(() => null);
      if (!r || r.status() !== 200) continue;
      const href = await page.evaluate(
        () => document.querySelector('a[href^="/institutional/tickers/"][href$="/holders/"]')?.getAttribute("href") ?? null,
      );
      if (href) return href;
    }
  } finally {
    await page.close();
  }
  const dist = process.env.POPULUS_DIST_DIR ?? path.resolve(import.meta.dirname, "..", "..", "dist");
  const dir = path.join(dist, "institutional", "tickers");
  if (existsSync(dir)) {
    for (const t of readdirSync(dir).sort()) {
      if (existsSync(path.join(dir, t, "holders", "index.html"))) return `/institutional/tickers/${t}/holders/`;
    }
    holdersProvenAbsent = true;
  } else if (existsSync(path.join(dist, "institutional", "index.html"))) {
    // a built dist with an institutional tree and no tickers directory at all
    holdersProvenAbsent = true;
  }
  return null;
}

/** The route cannot be served: a stated skip when its absence is proven (the
    holders route on the bounded build), otherwise the owner-tier skip rule. */
function routeAbsent(route: Route, reason: string): { skip: string } | { fail: string } {
  if (route.id === "holders" && holdersProvenAbsent) {
    return { skip: `${reason} — proven: the served build links no holders page and its dist holds none (the bounded build emits none; the holders-browser lane measures a fixture page)` };
  }
  return skipDecision(process.env, reason);
}

/* The minimums are floors that catch an empty or half-rendered page, set
   under what the baseline build renders (measured 2026-09-25 on the bounded
   build: Congress 3 tables × 23 columns, Member 3 × 20, Institutional 2 × 13
   — its directory and activity bodies render empty in the bounded build —,
   Filer 3 × 20, Signals 2 × 13, AAPL 4 × 18, NVDA 2 × 11, home 2 × 9,
   /e/ member 3 × 20, /e/ tail filer 3 × 20). */
const ROUTES: Route[] = [
  { id: "congress", path: "/congress/", minTables: 3, minColumns: 16, pairs: 1, g10Min: { colours: 1 } },
  { id: "member", path: "/congress/members/M001193/", minTables: 3, minColumns: 12, pairs: 2, g10Min: { colours: 1 } },
  { id: "institutional", path: "/institutional/", minTables: 2, minColumns: 8, pairs: 1 },
  { id: "filer", path: "/institutional/filers/1135730/", minTables: 3, minColumns: 12, pairs: 1, g10Min: { colours: 1 } },
  { id: "signals", path: "/signals/", minTables: 2, minColumns: 8, pairs: 1, g10Min: { colours: 1, "centring@1440": 1 } },
  { id: "ticker", path: "/tickers/AAPL/", minTables: 3, minColumns: 10, allowZero: NO_CONTROLS_ZERO, g10Min: { colours: 1 } },
  { id: "congress-ticker", path: "/congress/tickers/NVDA/", minTables: 2, minColumns: 8, g10Min: { colours: 1 } },
  { id: "watchlist", path: "/watchlist/", minTables: 1, minColumns: 6, seedWatch: true, allowZero: CLASSIC_FEED_ZERO },
  { id: "home", path: "/", minTables: 2, minColumns: 6, allowZero: NO_CONTROLS_ZERO, g10Min: { colours: 1 } },
  { id: "e-member", path: "/e/?k=m:M001193", minTables: 3, minColumns: 12, g10Min: { colours: 1 } },
  { id: "e-filer", path: discoverTailFiler, minTables: 2, minColumns: 8, g10Min: { colours: 1 } },
  { id: "holders", path: discoverHolders, minTables: 1, minColumns: 4 },
];

const ALL_CHECKS: CheckId[] = [...GEOMETRY_CHECKS, ...EXTRA_CHECKS];

/** Where each check runs. G3 is a 1440 and 768 property (a table scrolls
    sideways inside its container at 390 by design; 768 runs nothing else); G9
    is measured on the five design routes at 1440 (criterion 7); every other
    check runs at 1440 and 390. */
function applies(check: CheckId, route: Route, width: Width): boolean {
  if (width === 768) return check === "G3";
  if (check === "G3") return width === 1440;
  if (check === "G9") return width === 1440 && route.pairs !== undefined;
  if (check === "controlHeights") return width === 1440;
  return true;
}

/* ----------------------------------------------------------- the harness */


async function newLedgerContext(
  browser: Browser,
  testInfo: TestInfo,
  width: Width,
  route?: Route,
): Promise<BrowserContext> {
  const use = testInfo.project.use;
  const ctx = await browser.newContext({
    baseURL: use.baseURL,
    viewport: { width, height: HEIGHT[width] },
    hasTouch: use.hasTouch,
    isMobile: use.isMobile,
    deviceScaleFactor: use.deviceScaleFactor,
    userAgent: use.userAgent,
  });
  /* The analytics beacon is the one third-party request a page makes. A
     measurement run is not a visit: it neither waits on it nor counts in the
     owner's analytics (this config also runs against production, R35). */
  await ctx.route(/cloudflareinsights\.com/, (r) => r.abort());
  await ctx.addInitScript((t: string) => {
    try {
      localStorage.setItem("populus:theme", t);
    } catch {
      /* storage blocked: the background assertion below then fails loudly */
    }
  }, THEME);
  if (route?.seedWatch) {
    await ctx.addInitScript((seed: string) => {
      try {
        localStorage.setItem("populus:watch:v2", seed);
      } catch {
        /* as above */
      }
    }, WATCH_SEED);
  }
  return ctx;
}

async function resolvePath(ctx: BrowserContext, route: Route): Promise<string | null> {
  return typeof route.path === "string" ? route.path : route.path(ctx);
}

/** Load a route and assert every harness precondition before measuring. */
async function loadRoute(page: Page, route: Route, url: string, testInfo: TestInfo): Promise<void> {
  const resp = await page.goto(url, { waitUntil: "load" });
  expect(resp, `${url}: no response`).not.toBeNull();
  expect(resp!.status(), `${url} must answer HTTP 200 before anything on it is measured`).toBe(200);
  expect(
    await themeBackgroundProblem(page, THEME),
    `${url}: the ${THEME} pass must paint the ${THEME} background (POPULUS_THEME=${THEME})`,
  ).toBeNull();
  if (testInfo.project.use.hasTouch) {
    expect(
      await page.evaluate(() => matchMedia("(any-pointer: coarse)").matches),
      "the touch project must run on a coarse pointer, or its 44px arm measures nothing",
    ).toBe(true);
  }
  await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => undefined);
  await page.evaluate(() => document.fonts.ready);
  await installProbe(page);
  const census = async () => page.evaluate(() => window.__ledger!.census());
  await expect
    .poll(async () => (await census()).tables, {
      message: `${url}: fewer than ${route.minTables} rendered tables with rows`,
      timeout: 20_000,
    })
    .toBeGreaterThanOrEqual(route.minTables);
  const c = await census();
  expect(
    c.columns,
    `${url}: ${c.columns} rendered columns, expected at least ${route.minColumns}\n${c.detail.join("\n")}`,
  ).toBeGreaterThanOrEqual(route.minColumns);
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(() => window.scrollTo(0, 0));
}

function mergeResults(check: string, parts: LedgerResult[]): LedgerResult {
  return {
    check,
    ok: parts.every((p) => p.ok),
    applicable: parts.some((p) => p.applicable),
    measured: parts.reduce((n, p) => n + p.measured, 0),
    failures: parts.flatMap((p) => p.failures),
    failureCount: parts.reduce((n, p) => n + p.failureCount, 0),
    unmeasured: parts.flatMap((p) => p.unmeasured),
    unmeasuredCount: parts.reduce((n, p) => n + p.unmeasuredCount, 0),
    excluded: parts.flatMap((p) => p.excluded),
    excludedCount: parts.reduce((n, p) => n + p.excludedCount, 0),
    notes: parts.flatMap((p) => p.notes.map((x) => `${p.check}: ${x}`)),
  };
}

/** Run one check on the loaded page through the shared probe. */
async function runCheck(page: Page, check: CheckId, route: Route): Promise<LedgerResult> {
  await installProbe(page);
  switch (check) {
    case "G1": return page.evaluate(() => window.__ledger!.g1());
    case "G2": return page.evaluate((exempt) => window.__ledger!.g2({ exempt }), [...g2Exemptions()]);
    /* between the fold and 1440 (768) a wide table may scroll inside its
       own container; the PAGE never scrolls sideways (C-3) */
    case "G3": return page.evaluate((documentOnly) => window.__ledger!.g3({ documentOnly }), page.viewportSize()?.width === 768);
    case "G4": return page.evaluate(() => window.__ledger!.g4());
    case "G5": return page.evaluate(() => window.__ledger!.g5());
    case "G6": return page.evaluate(() => window.__ledger!.g6());
    case "G7": return page.evaluate(() => window.__ledger!.g7());
    case "G8": return page.evaluate(() => window.__ledger!.g8());
    case "G9": return page.evaluate((n) => window.__ledger!.g9({ expectedPairs: n }), route.pairs ?? null);
    case "G10": {
      /* the route's floor for each part at this width (Q-12) */
      const min: Record<string, number> = {};
      for (const [k, n] of Object.entries(route.g10Min ?? {})) {
        const [part, at] = k.split("@");
        if (n !== undefined && (!at || Number(at) === page.viewportSize()?.width)) min[part!] = n;
      }
      return page.evaluate((m) => window.__ledger!.g10({ min: m }), min);
    }
    case "G11": return page.evaluate(() => window.__ledger!.g11());
    case "G11b": {
      const bars = await page.evaluate(() => window.__ledger!.g11b());
      /* One real key press first: programmatic focus then inherits keyboard
         modality, so :focus-visible (the thing being measured) applies. */
      await page.keyboard.press("Tab");
      const focus = await page.evaluate(() => window.__ledger!.focusRing());
      await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
      return mergeResults("G11b", [bars, focus]);
    }
    case "G12": return page.evaluate(() => window.__ledger!.g12());
    case "headFont": return page.evaluate(() => window.__ledger!.headFont());
    case "oneFlex": return page.evaluate(() => window.__ledger!.oneFlex());
    case "metaTruncation": return page.evaluate(() => window.__ledger!.metaTruncation());
    case "controlHeights": return page.evaluate(() => window.__ledger!.controlHeights());
  }
}

function keep(testInfo: TestInfo, name: string, r: LedgerResult): void {
  const file = testInfo.outputPath(`${name}.json`);
  writeFileSync(file, JSON.stringify(r, null, 1));
}

/* ------------------------------------------------------------ preflight */

test("@touch-preflight the touch project runs on a coarse pointer", async ({ page }) => {
  await page.goto("/");
  expect(
    await page.evaluate(() => matchMedia("(any-pointer: coarse)").matches),
    "(any-pointer: coarse) does not match: the touch project would measure the fine arm and call it coarse",
  ).toBe(true);
});

test("harness: the skip rule — a skip is a failure when POPULUS_BUILD_DIR is set", () => {
  expect(skipDecision({}, "x")).toEqual({ skip: "x" });
  expect("fail" in skipDecision({ POPULUS_BUILD_DIR: "/b" }, "x")).toBe(true);
});

/** T5.8's control, carried by every config that runs this file (production
    included): the same G1 predicate, against a known-misaligned page served
    through `page.route`, must fail. */
test("harness control: G1 fails on a known-misaligned fixture served through page.route", async ({ browser }, testInfo) => {
  const ctx = await newLedgerContext(browser, testInfo, 1440);
  const page = await ctx.newPage();
  const rows = Array.from({ length: 12 }, (_, i) =>
    `<tr><td>Row ${i}</td><td class="c-num"${i === 7 ? ' style="padding-right:19px"' : ""}>${(i + 1) * 1234}</td></tr>`).join("");
  await page.route("**/__ledger-control__/", (r) =>
    r.fulfill({
      status: 200,
      contentType: "text/html",
      body:
        "<!doctype html><style>body{margin:0;font:13px monospace;background:#04070d;color:#e9f0f7}" +
        "table{border-collapse:collapse}th,td{padding:7px 6px;white-space:nowrap;text-align:left}" +
        ".c-num{text-align:right}</style><main><table class=\"etable\"><thead><tr><th>Name</th>" +
        `<th class="c-num">Amount</th></tr></thead><tbody>${rows}</tbody></table></main>`,
    }),
  );
  const resp = await page.goto("/__ledger-control__/");
  expect(resp?.status()).toBe(200);
  await installProbe(page);
  const r = await page.evaluate(() => window.__ledger!.g1());
  expect(r.measured, "the fixture's 12 numeric cells are measured").toBe(12);
  expect(r.failures.map((f) => f.row), formatResult(r)).toEqual([7]);
  await ctx.close();
});

/* ---------------------------------------------------- per-route checks */

test.describe.configure({ timeout: 240_000 });

for (const width of WIDTHS) {
  for (const route of ROUTES) {
    const checks = ALL_CHECKS.filter((c) => !isPending(c) && applies(c, route, width));
    test.describe(`${route.id} @${width} (${THEME})`, () => {
      let ctx: BrowserContext | undefined;
      let page: Page;
      let url: string | null = null;

      test.beforeAll(async ({ browser }, testInfo) => {
        ctx = await newLedgerContext(browser, testInfo, width, route);
        url = await resolvePath(ctx, route);
        if (!url) {
          await ctx.close();
          ctx = undefined;
          const d = routeAbsent(route, `${route.id}: this build serves no such page (discovery found none)`);
          if ("fail" in d) throw new Error(d.fail);
          test.skip(true, d.skip);
          return;
        }
        testInfo.annotations.push({ type: "route", description: `${route.id} → ${url}` });
        page = await ctx.newPage();
        await loadRoute(page, route, url, testInfo);
      });
      test.afterAll(async () => {
        await ctx?.close();
      });

      for (const check of checks) {
        test(`${check} ${route.id} @${width}`, async ({}, testInfo) => {
          testInfo.annotations.push({ type: "milestone", description: `${check} lands in ${CHECK_MILESTONE[check]} (tree: ${CURRENT_MILESTONE})` });
          const r = await runCheck(page, check, route);
          keep(testInfo, `${check}-${route.id}-${width}-${THEME}`, r);
          await page.evaluate(() => window.scrollTo(0, 0));
          if (!r.applicable && check === "controlHeights") {
            testInfo.annotations.push({ type: "not applicable", description: r.notes.join("; ") });
            return;
          }
          /* controlHeights measures the segmented items and sort buttons a
             page HAS; a page with none (the home tiles, the AAPL page) has
             nothing to size, which the annotation states. */
          const zero = route.allowZero?.[`${check}@${width}`] ?? route.allowZero?.[check];
          if (r.measured === 0 && zero) {
            testInfo.annotations.push({ type: "measured nothing (allowed)", description: zero });
            return;
          }
          expect(
            r.measured,
            `${check} measured nothing on ${url} @${width}: a check that ran on nothing has not passed\n${formatResult(r)}`,
          ).toBeGreaterThan(0);
          expect(r.failureCount, `${url} @${width} ${THEME}\n${formatResult(r)}`).toBe(0);
        });
      }
    });
  }
}

/* ------------------------------------------ pending checks (test.fail) */

for (const check of ALL_CHECKS.filter((c) => isPending(c))) {
  test(`${check} [pending: its fix lands in ${CHECK_MILESTONE[check]}] across every route it applies to`, async ({ browser }, testInfo) => {
    test.setTimeout(600_000);
    const found: string[] = [];
    for (const width of WIDTHS) {
      for (const route of ROUTES) {
        if (!applies(check, route, width)) continue;
        const ctx = await newLedgerContext(browser, testInfo, width, route);
        try {
          const url = await resolvePath(ctx, route);
          if (!url) {
            const d = routeAbsent(route, `${route.id}: no such page in this build`);
            if ("fail" in d) throw new Error(d.fail);
            testInfo.annotations.push({ type: "route skipped", description: d.skip });
            continue;
          }
          const page = await ctx.newPage();
          /* Harness failures here are REAL failures: test.fail() is declared
             only after every route loaded and measured something, so a pending
             check stays red for the right reason, never for a broken page. */
          await loadRoute(page, route, url, testInfo);
          const r = await runCheck(page, check, route);
          keep(testInfo, `${check}-${route.id}-${width}-${THEME}`, r);
          /* measuring nothing is a harness failure, unless the route declares
             why (allowZero) or the check reported findings anyway (a pair lost
             from a band is a finding with nothing left to measure) */
          const zero = route.allowZero?.[`${check}@${width}`] ?? route.allowZero?.[check];
          if (r.applicable && r.measured === 0 && r.failureCount === 0 && !zero) {
            throw new Error(`${check} measured nothing on ${url} @${width}\n${formatResult(r)}`);
          }
          if (r.failureCount) found.push(`${url} @${width}\n${formatResult(r, 6)}`);
        } finally {
          await ctx.close();
        }
      }
    }
    test.fail(true, `${check} is pending until ${CHECK_MILESTONE[check]}; an unexpected pass means the milestone map must advance`);
    expect(found, `${check} (pending ${CHECK_MILESTONE[check]}) findings:\n${found.join("\n")}`).toEqual([]);
  });
}

/* ------------------------------------ M1 code-review route properties */
/* Each names its review-ledger id (docs/design/polish-preview/
   M1-REVIEW-LEDGER.md) and carries a control that fails it: the defect the
   review found, re-planted on the same page. Fine pointer only — none of these
   is a pointer property, and the touch project re-runs the probe checks. */

test.describe("M1 review: route properties", () => {
  test.beforeEach(({}, testInfo) => {
    test.skip(!!testInfo.project.use.hasTouch, "fine-pointer route properties; the touch project runs the probe checks");
  });

  async function open(browser: Browser, testInfo: TestInfo, width: number, url: string, seedWatch = false): Promise<{ ctx: BrowserContext; page: Page }> {
    const ctx = await browser.newContext({
      baseURL: testInfo.project.use.baseURL,
      viewport: { width, height: width > 720 ? 900 : 844 },
    });
    await ctx.route(/cloudflareinsights\.com/, (r) => r.abort());
    await ctx.addInitScript((t: string) => {
      try { localStorage.setItem("populus:theme", t); } catch { /* the background assertion reports it */ }
    }, THEME);
    if (seedWatch) {
      await ctx.addInitScript((seed: string) => {
        try { localStorage.setItem("populus:watch:v2", seed); } catch { /* as above */ }
      }, WATCH_SEED);
    }
    const page = await ctx.newPage();
    const resp = await page.goto(url, { waitUntil: "load" });
    expect(resp?.status(), `${url} must answer 200`).toBe(200);
    await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => undefined);
    await page.evaluate(() => document.fonts.ready);
    return { ctx, page };
  }

  /* R-1: the midpoint clip measured --hit-min by appending a probe to <body>,
     which its own MutationObserver saw — so the page re-measured every frame
     forever. An idle page schedules no frames at all. */
  for (const url of ["/congress/", "/congress/members/M001193/", "/institutional/", "/institutional/filers/1135730/", "/signals/"]) {
    test(`R-1: ${url} schedules no animation frames once it is idle`, async ({ browser }, testInfo) => {
      const ctx = await browser.newContext({ baseURL: testInfo.project.use.baseURL, viewport: { width: 1440, height: 900 } });
      await ctx.route(/cloudflareinsights\.com/, (r) => r.abort());
      await ctx.addInitScript(() => {
        const w = window as unknown as { __frames: number };
        w.__frames = 0;
        const raf = window.requestAnimationFrame.bind(window);
        window.requestAnimationFrame = (f: FrameRequestCallback) => { w.__frames++; return raf(f); };
      });
      const page = await ctx.newPage();
      await page.goto(url, { waitUntil: "load" });
      await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => undefined);
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(1500);
      const a = await page.evaluate(() => (window as unknown as { __frames: number }).__frames);
      await page.waitForTimeout(1000);
      const b = await page.evaluate(() => (window as unknown as { __frames: number }).__frames);
      await ctx.close();
      expect(b - a, `${url}: ${b - a} animation frames scheduled in one idle second`).toBe(0);
    });
  }

  /* C-1: a dangling selector swallowed the filer's `order:6` rule, so the
     Filing history band was auto-placed ABOVE the changes, the period chips
     and the holdings at ≥1081px. The bands stack in their declared order
     (R15: identity → changes → period → [holdings | book shape] → filing
     history → EDGAR → notes). */
  const FILER_BANDS = [".entity-head", "[data-filer-root] > .design-changes", ".period-row", "[data-holdings-surface]", ".design-triptych", ".edgar-block", ".filer-notes"];
  async function bandOrderProblems(page: Page): Promise<string[]> {
    return page.evaluate((sels) => {
      const boxes = sels.map((s) => {
        const el = document.querySelector(`.entity-page ${s}`) ?? document.querySelector(s);
        const r = el?.getBoundingClientRect();
        return { s, top: r ? r.top + scrollY : NaN, bottom: r ? r.bottom + scrollY : NaN };
      });
      const out: string[] = [];
      for (const b of boxes) if (Number.isNaN(b.top)) out.push(`${b.s} is not on the page`);
      for (let i = 1; i < boxes.length; i++) {
        const [p, q] = [boxes[i - 1]!, boxes[i]!];
        if (!(q.top >= p.bottom - 1)) out.push(`${q.s} (top ${Math.round(q.top)}) is not below ${p.s} (bottom ${Math.round(p.bottom)})`);
      }
      return out;
    }, FILER_BANDS);
  }
  test("C-1: the filer page's bands stack in their declared order at 1440", async ({ browser }, testInfo) => {
    const { ctx, page } = await open(browser, testInfo, 1440, "/institutional/filers/1135730/");
    try {
      expect(await bandOrderProblems(page)).toEqual([]);
      // control: the triptych back on order 0, as the swallowed rule left it
      await page.addStyleTag({ content: ".entity-page > .design-triptych { order: 0 !important; }" });
      expect((await bandOrderProblems(page)).length, "control: the auto-placed Filing history is caught").toBeGreaterThan(0);
    } finally {
      await ctx.close();
    }
  });

  /* C-11: at ≤1080px the feed rows carried the gutter while the feed sat
     inside the band's content box, so their text stood on a DOUBLE gutter.
     A feed row's first text is on the page's text column at every width. */
  async function feedGutterOffsets(page: Page): Promise<number[]> {
    return page.evaluate(() => {
      const col = document.querySelector("main h1")!.getBoundingClientRect().left;
      return Array.from(document.querySelectorAll(".reference-feed .reference-row")).slice(0, 10).map((row) => {
        const side = row.querySelector(".cell-side")!;
        const r = document.createRange();
        r.selectNodeContents(side.firstChild!);
        return Math.round((r.getBoundingClientRect().left - col) * 10) / 10;
      });
    });
  }
  for (const width of [1440, 1000, 390]) {
    test(`C-11: a feed row's text sits on the page's text column @${width}`, async ({ browser }, testInfo) => {
      const { ctx, page } = await open(browser, testInfo, width, "/congress/");
      try {
        const off = await feedGutterOffsets(page);
        expect(off.length).toBeGreaterThan(0);
        expect(off.filter((d) => Math.abs(d) > 1), `offsets from the text column: ${off.join(", ")}`).toEqual([]);
        if (width <= 1080) {
          // control: the feed left inside the band's content box
          await page.addStyleTag({ content: "#congress-feed { margin-left: 0 !important; margin-right: 0 !important; }" });
          expect((await feedGutterOffsets(page)).some((d) => Math.abs(d) > 1), "control: the double gutter is caught").toBe(true);
        }
      } finally {
        await ctx.close();
      }
    });
  }

  /* C-4: the watch lists lost every style when .chips became the segmented
     group: chips touching, no padding, no target. Each watch chip is at
     least the hit square tall and stands apart from its neighbours. */
  async function watchChipProblems(page: Page, sel: string, min: number): Promise<string[]> {
    return page.evaluate(({ sel, min }) => {
      const chips = Array.from(document.querySelectorAll(sel)).map((e) => e.getBoundingClientRect()).filter((r) => r.width > 0);
      const out: string[] = [];
      if (chips.length === 0) out.push(`no ${sel}`);
      chips.forEach((r, i) => {
        if (r.height < min - 0.5) out.push(`chip ${i} is ${Math.round(r.height)}px tall (< ${min})`);
        const n = chips[i + 1];
        if (n && Math.abs(n.top - r.top) < 2 && n.left - r.right < 4) out.push(`chips ${i} and ${i + 1} are ${Math.round(n.left - r.right)}px apart`);
      });
      return out;
    }, { sel, min });
  }
  for (const [url, sel] of [["/watchlist/", "#watch-chips > .chip"], ["/signals/", ".si-watch-chips > .chip"]] as const) {
    for (const width of [1440, 390]) {
      test(`C-4: ${url} watch chips are spaced targets @${width}`, async ({ browser }, testInfo) => {
        const { ctx, page } = await open(browser, testInfo, width, url, true);
        try {
          await expect(page.locator(sel).first()).toBeVisible({ timeout: 20_000 });
          const min = width > 720 ? 24 : 44;
          expect(await watchChipProblems(page, sel, min)).toEqual([]);
          // control: the unstyled list the review found
          await page.addStyleTag({ content: `${sel} { min-height: 0 !important; padding: 0 !important; border: 0 !important; } ${sel.split(" >")[0]} { gap: 0 !important; }` });
          expect((await watchChipProblems(page, sel, min)).length, "control").toBeGreaterThan(0);
        } finally {
          await ctx.close();
        }
      });
    }
  }

  /* C-5: the classic feed's range cell at ≤1080px was nowrap with ellipsized
     flags, so a flag's words were cut at 390 (§5: flags wrap). No flag is
     truncated. */
  async function truncatedFlags(page: Page): Promise<string[]> {
    return page.evaluate(() =>
      Array.from(document.querySelectorAll(".feed-table .flag"))
        .filter((f) => f.getBoundingClientRect().width > 0 && (f as HTMLElement).scrollWidth > (f as HTMLElement).clientWidth + 1)
        .map((f) => (f.textContent ?? "").trim()),
    );
  }
  test("C-5: no flag on /watchlist/ is truncated @390", async ({ browser }, testInfo) => {
    const { ctx, page } = await open(browser, testInfo, 390, "/watchlist/", true);
    try {
      await expect(page.locator(".feed-table .feed-row").first()).toBeVisible({ timeout: 20_000 });
      expect(await page.locator(".feed-table .flag").count(), "the seeded rows carry flags").toBeGreaterThan(0);
      expect(await truncatedFlags(page)).toEqual([]);
      // control: the pre-fix range cell
      await page.addStyleTag({ content: ".feed-row .cell-range { flex-wrap: nowrap !important; } .feed-row .cell-range .band { flex: 0 0 300px !important; } .feed-row .cell-range .flag { flex: 0 1 auto !important; white-space: nowrap !important; overflow: hidden !important; text-overflow: ellipsis !important; }" });
      expect((await truncatedFlags(page)).length, "control: a cut flag is caught").toBeGreaterThan(0);
    } finally {
      await ctx.close();
    }
  });

  /* C-7: the rule book is a declared prose table whose ROW carries the
     gutters; the ledger's gutter, lead and slot padding reached its cells and
     doubled them. Opened, its cells carry no side padding, its first and last
     text sit on the gutters, and its rows paint their kind edges (G10's edge
     and colour parts). Its gaps are not asserted here: the rule and why
     columns keep their 420/380px caps until M2 lays the rule book out on the
     prose-table spec (DEV-NOTES, debt). */
  async function ruleBookPadding(page: Page): Promise<string[]> {
    return page.evaluate(() =>
      Array.from(document.querySelectorAll("#signal-rulebook table > * > tr > :is(th, td)"))
        .map((c) => [c.className || c.tagName, getComputedStyle(c).paddingLeft, getComputedStyle(c).paddingRight] as const)
        .filter(([, l, r]) => l !== "0px" || r !== "0px")
        .map(([n, l, r]) => `${n}: padding ${l} / ${r}`),
    );
  }
  test("C-7: the opened rule book's cells take no ledger cell padding; its edges sit on the gutters", async ({ browser }, testInfo) => {
    const { ctx, page } = await open(browser, testInfo, 1440, "/signals/");
    try {
      await page.evaluate(() => {
        for (const d of Array.from(document.querySelectorAll<HTMLDetailsElement>("details"))) if (d.querySelector("#signal-rulebook")) d.open = true;
      });
      await installProbe(page);
      const ruleBook = await page.evaluate(() => Array.from(document.querySelectorAll("table")).findIndex((t) => t.matches("#signal-rulebook table")));
      expect(ruleBook, "the rule book table renders").toBeGreaterThanOrEqual(0);
      const edgeFindings = async () =>
        (await page.evaluate(() => window.__ledger!.g10())).failures
          .filter((f) => f.tableIndex === ruleBook && /first text x|last text right|edge/.test(f.detail))
          .map((f) => f.detail);
      expect(await ruleBookPadding(page), "no rule book cell carries side padding").toEqual([]);
      expect(await edgeFindings(), "G10's edge and colour parts on the rule book").toEqual([]);
      // control: the pre-fix gutter rule, reaching the prose table's cells
      await page.addStyleTag({ content: ".table-scroll > table > :is(thead, tbody, tfoot) > tr > :first-child { padding-left: var(--gutter-l); }" });
      expect((await ruleBookPadding(page)).length, "control: the doubled gutter is caught").toBeGreaterThan(0);
      expect((await edgeFindings()).length, "control: …and G10 sees the text off the gutter").toBeGreaterThan(0);
    } finally {
      await ctx.close();
    }
  });

  /* R-8: the hits wrapper announced "scroll sideways" as a tab stop at every
     width. It is a named region exactly while its table overflows it. */
  for (const width of [1440, 390]) {
    test(`R-8: the signal hits wrapper is a scroll region only while it scrolls @${width}`, async ({ browser }, testInfo) => {
      const { ctx, page } = await open(browser, testInfo, width, "/signals/");
      try {
        const st = await page.locator(".si-hits-scroll").evaluate((el) => ({
          scrolls: el.scrollWidth > el.clientWidth + 1,
          tabindex: el.getAttribute("tabindex"),
          role: el.getAttribute("role"),
          name: el.getAttribute("aria-label"),
        }));
        if (st.scrolls) expect([st.tabindex, st.role, st.name]).toEqual(["0", "region", expect.stringContaining("scroll sideways")]);
        else expect([st.tabindex, st.role, st.name], "no tab stop, role or name where nothing scrolls").toEqual([null, null, null]);
        if (width === 1440) expect(st.scrolls, "at 1440 the hits table fits").toBe(false);
      } finally {
        await ctx.close();
      }
    });
  }
});
