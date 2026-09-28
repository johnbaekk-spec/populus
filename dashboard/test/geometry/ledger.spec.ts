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
     across its routes, from the milestone map in `milestones.ts` (in M2 —
     this tree — none is pending: G6 and G9 run per route); G2 exempted, by
     selector, the three containers M2 removed, and from M2 on exempts nothing;
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
/* the real renderers, for the one T2.8 fixture figure (the M2 delta review) */
import { consensusAddLedgerItem } from "../../src/lib/notable-moves.ts";
import { disclosureLedger } from "../../src/lib/ui/shared.ts";

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
          /* G9 runs under a coarse pointer too (review Q2-4): the primary
             tables show FIXED defaults (coordinator decision CD-1), never an N
             tuned for the 30px fine row, and the rule is asymmetric — taller
             44px rows lengthen the primary, which a void under the side allows. */
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

/** A fine-pointer page for the route properties below, in the pass's theme
    (asserted), optionally with an init script that runs before the page's
    own scripts (the T2.11 control stubs a listener that way). */
async function open(
  browser: Browser,
  testInfo: TestInfo,
  width: number,
  url: string,
  seedWatch = false,
  init?: () => void,
): Promise<{ ctx: BrowserContext; page: Page }> {
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
  if (init) await ctx.addInitScript(init);
  const page = await ctx.newPage();
  const resp = await page.goto(url, { waitUntil: "load" });
  expect(resp?.status(), `${url} must answer 200`).toBe(200);
  expect(await themeBackgroundProblem(page, THEME), `${url}: the ${THEME} pass paints the ${THEME} background`).toBeNull();
  await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => undefined);
  await page.evaluate(() => document.fonts.ready);
  return { ctx, page };
}

test.describe("M1 review: route properties", () => {
  test.beforeEach(({}, testInfo) => {
    test.skip(!!testInfo.project.use.hasTouch, "fine-pointer route properties; the touch project runs the probe checks");
  });

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

/* ------------------------------------------------ M2 route properties */
/* DESIGN-POLISH M2 (T2.5, T2.7, T2.8, T2.11). Each names its task and carries
   a control — the defect re-planted on the served page — that must fail it.
   Fine pointer only: none is a pointer property. */

/** The two filer pages: the SSR page the gate measures, and an `/e/` tail
    filer, which renders the same part markup from shards (T2.5). */
const FILER_PAGES: { id: string; path: Route["path"] }[] = [
  { id: "filer", path: "/institutional/filers/1135730/" },
  { id: "e-filer", path: discoverTailFiler },
];

/** Resolve a route path in a throwaway context (the `/e/` tail filer is
    discovered from the served build). */
async function pathFor(browser: Browser, testInfo: TestInfo, p: Route["path"]): Promise<string | null> {
  if (typeof p === "string") return p;
  const ctx = await browser.newContext({ baseURL: testInfo.project.use.baseURL });
  try {
    return await p(ctx);
  } finally {
    await ctx.close();
  }
}

test.describe("M2: route properties", () => {
  test.beforeEach(({}, testInfo) => {
    test.skip(!!testInfo.project.use.hasTouch, "fine-pointer route properties; the touch project runs the probe checks");
  });

  /* ---------------------------------------------------------------- T2.5
     The filer page's `order` rules are DELETED (plan G, T2.5): DOM order is
     visual order, so the page reads top to bottom in the order it is written.
     This replaces the M1 C-1 test ("the bands stack in their declared order"),
     whose declared order WAS a list of `order` values; the property it guarded
     — no band is placed out of its reading order — is kept, measured now
     against the DOM itself. Reading the headings in DOM order never goes back
     up the page: two consecutive headings in different bands have the later
     band starting below the earlier band, and two in one band have the later
     one below the earlier or in a column to its right (a paired band reads
     left cell, then right cell). */
  async function readingOrder(page: Page): Promise<{ headings: string[]; problems: string[] }> {
    return page.evaluate(() => {
      const hs = Array.from(document.querySelectorAll<HTMLElement>("main :is(h1, h2)")).filter((h) => {
        const r = h.getBoundingClientRect();
        return h.checkVisibility() && r.height > 2 && r.width > 2; // a visually-hidden heading is not read on screen
      });
      let lca: Element | null = hs[0]?.parentElement ?? null;
      while (lca && !hs.every((h) => lca!.contains(h))) lca = lca.parentElement;
      const bandOf = (h: Element): Element => {
        let e = h;
        while (e.parentElement && e.parentElement !== lca) e = e.parentElement;
        return e;
      };
      const name = (h: Element): string => `"${(h.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 36)}"`;
      const r0 = (n: number): number => Math.round(n);
      const problems: string[] = [];
      for (let i = 1; i < hs.length; i++) {
        const a = hs[i - 1]!, b = hs[i]!;
        const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
        const ba = bandOf(a), bb = bandOf(b);
        if (ba !== bb) {
          const qa = ba.getBoundingClientRect(), qb = bb.getBoundingClientRect();
          if (qb.top < qa.bottom - 1) {
            problems.push(`${name(b)} reads after ${name(a)}, but its band (top ${r0(qb.top + scrollY)}) is not below that band (bottom ${r0(qa.bottom + scrollY)})`);
          }
        } else if (!(rb.top >= ra.bottom - 1 || rb.left >= ra.right - 1)) {
          problems.push(`${name(b)} reads after ${name(a)} in one band, but is neither below it nor in a column to its right`);
        }
      }
      return { headings: hs.map(name), problems };
    });
  }
  for (const fp of FILER_PAGES) {
    test(`T2.5: the ${fp.id} page reads in DOM order — its band headings stack in their visual order at 1440`, async ({ browser }, testInfo) => {
      const url = await pathFor(browser, testInfo, fp.path);
      if (!url) {
        const d = skipDecision(process.env, `${fp.id}: no such page in this build`);
        if ("fail" in d) throw new Error(d.fail);
        test.skip(true, d.skip);
        return;
      }
      const { ctx, page } = await open(browser, testInfo, 1440, url);
      try {
        const clean = await readingOrder(page);
        expect(clean.headings.length, `the filer page's headings: ${clean.headings.join(", ")}`).toBeGreaterThanOrEqual(4);
        expect(clean.problems, clean.headings.join(" → ")).toEqual([]);
        // control 1: ONE order rule re-added, re-stacking the paired band above the changes
        const tag = await page.addStyleTag({ content: "main { display: flex !important; flex-direction: column !important; } .design-filer-band { order: -1 !important; }" });
        expect((await readingOrder(page)).problems.length, "control: a band moved by `order` is caught").toBeGreaterThan(0);
        await tag.evaluate((el) => el.remove());
        expect((await readingOrder(page)).problems, "the page reads in order again once the rule is gone").toEqual([]);
        // control 2: the band's side cell ordered first inside its grid
        await page.addStyleTag({ content: ".design-filer-band > .design-filer-side { order: -1 !important; }" });
        expect((await readingOrder(page)).problems.length, "control: a cell moved by `order` inside the band is caught").toBeGreaterThan(0);
      } finally {
        await ctx.close();
      }
    });
  }

  /* ---------------------------------------------------------------- T2.8
     One header ledger on every route that has one:
     - its value tops agree within ±1px (REPORTED VALUE aligned with the other
       figures, T2.5), each value is ONE line (T2.4) and each sub is at most TWO
       lines (the H-4 sub rule) — lines counted on the rendered text,
       visually-hidden text excluded;
     - no value runs past its own figure, no two figures overlap, and the page
       never scrolls sideways (review C2-2: a member's net-flow range at 390, and
       the unbounded wording at 1440, wrote over the next figure);
     - above the fold the ledger is bottom-aligned with the H1 block: its bottom
       is the copy's bottom ±1px (R15, D-14; review C2-4 — the Signals head
       centred it); at the fold the head stacks and the ledger takes the head's
       full width (review C2-3 — it shrank to 207px beside a 151px gap).
     Measured at 1440 and 390, on every ledger route and on the two members
     whose values are ranges: A000148 ("−$250K to −$75.0K") and P000608 (an
     unbounded interval). */
  const LEDGER_ROUTES: { id: string; path: Route["path"] }[] = [
    ...ROUTES.filter((r) => ["congress", "member", "institutional", "filer", "signals", "ticker", "congress-ticker", "e-member"].includes(r.id)),
    { id: "e-filer", path: discoverTailFiler },
    { id: "member-range", path: "/congress/members/A000148/" },
    { id: "member-unbounded", path: "/congress/members/P000608/" },
  ];
  async function ledgerProblems(page: Page): Promise<{ figures: number; problems: string[] }> {
    return page.evaluate(() => {
      const hiddenText = (n: Node, stop: Element): boolean => {
        for (let e = n.parentElement; e && e !== stop.parentElement; e = e.parentElement) {
          const cs = getComputedStyle(e);
          const r = e.getBoundingClientRect();
          if (cs.position === "absolute" && (r.width <= 1 || r.height <= 1)) return true; // visually hidden
          if (cs.display === "none" || cs.visibility === "hidden") return true;
        }
        return false;
      };
      const textRects = (el: Element): DOMRect[] => {
        const rects: DOMRect[] = [];
        const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
        for (let n = w.nextNode(); n; n = w.nextNode()) {
          if (!(n.nodeValue ?? "").trim() || hiddenText(n, el)) continue;
          const r = document.createRange();
          r.selectNodeContents(n);
          rects.push(...Array.from(r.getClientRects()).filter((q) => q.width > 0.5 && q.height > 0.5));
        }
        return rects;
      };
      const lines = (el: Element): number => {
        const rects = textRects(el);
        /* one line per band of vertical CENTRES: a text rect is its font's
           content area, taller than a tight line box (line-height 1 on the
           value), so the rects of two stacked lines overlap by their tops and
           bottoms — but their centres sit a whole line apart */
        const mid = (q: DOMRect): number => (q.top + q.bottom) / 2;
        rects.sort((a, b) => mid(a) - mid(b));
        const ls: { mid: number; h: number }[] = [];
        for (const q of rects) {
          const last = ls[ls.length - 1];
          if (last && mid(q) - last.mid < 0.5 * Math.min(q.height, last.h)) continue;
          ls.push({ mid: mid(q), h: q.height });
        }
        return ls.length;
      };
      const txt = (e: Element): string => `"${(e.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 28)}"`;
      const problems: string[] = [];
      let figures = 0;
      const fold = window.innerWidth <= 720;
      const root = document.documentElement;
      if (root.scrollWidth > root.clientWidth + 1) problems.push(`the page scrolls sideways: ${root.scrollWidth}px of content in a ${root.clientWidth}px viewport`);
      for (const dl of Array.from(document.querySelectorAll("main dl.design-ledger"))) {
        if (!dl.checkVisibility()) continue;
        const figs = Array.from(dl.querySelectorAll(".ledger-fig")).filter((f) => f.checkVisibility());
        const values = Array.from(dl.querySelectorAll(".ledger-fig .ledger-value")).filter((v) => v.checkVisibility());
        figures += values.length;
        const tops = values.map((v) => v.getBoundingClientRect().top);
        /* at the fold the figures sit in a two-column grid, so only the figures
           of one ROW share a top */
        const rows = new Map<number, number[]>();
        values.forEach((v, i) => {
          const row = Math.round((v.closest(".ledger-fig") as HTMLElement).getBoundingClientRect().top);
          rows.set(row, [...(rows.get(row) ?? []), tops[i]!]);
        });
        for (const ts of fold ? rows.values() : [tops]) {
          if (ts.length && Math.max(...ts) - Math.min(...ts) > 1) {
            problems.push(`value tops differ by ${(Math.max(...ts) - Math.min(...ts)).toFixed(1)}px (±1): ${values.map((v, i) => `${txt(v)}@${tops[i]!.toFixed(1)}`).join(" ")}`);
          }
        }
        for (const v of values) {
          const n = lines(v);
          if (n !== 1) problems.push(`value ${txt(v)} renders on ${n} lines (one line)`);
          const fig = (v.closest(".ledger-fig") as HTMLElement).getBoundingClientRect();
          const rs = textRects(v);
          if (rs.length) {
            const L = Math.min(...rs.map((q) => q.left)), R = Math.max(...rs.map((q) => q.right));
            if (L < fig.left - 0.5 || R > fig.right + 0.5) problems.push(`value ${txt(v)} runs ${(R - L).toFixed(1)}px in its ${fig.width.toFixed(1)}px figure (it overflows)`);
          }
        }
        for (const s of Array.from(dl.querySelectorAll(".ledger-fig .ledger-sub")).filter((x) => x.checkVisibility())) {
          const n = lines(s);
          if (n > 2) problems.push(`sub ${txt(s)} renders on ${n} lines (at most two)`);
        }
        for (let i = 0; i < figs.length; i++) {
          for (let j = i + 1; j < figs.length; j++) {
            const a = figs[i]!.getBoundingClientRect(), b = figs[j]!.getBoundingClientRect();
            if (a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5) {
              problems.push(`figures ${txt(figs[i]!.querySelector("dt")!)} and ${txt(figs[j]!.querySelector("dt")!)} overlap`);
            }
          }
        }
        const head = dl.closest(".page-head, .entity-head");
        const copy = head ? Array.from(head.children).find((c) => c.matches(".page-head-copy, .entity-head-copy")) : null;
        if (!head || !copy) { problems.push("the ledger sits in no head beside a head copy"); continue; }
        const lb = dl.getBoundingClientRect(), cb = copy.getBoundingClientRect();
        if (fold) {
          const hs = getComputedStyle(head);
          const hb = head.getBoundingClientRect();
          const left = hb.left + parseFloat(hs.paddingLeft) + parseFloat(hs.borderLeftWidth);
          const width = head.clientWidth - parseFloat(hs.paddingLeft) - parseFloat(hs.paddingRight);
          if (Math.abs(lb.left - left) > 1 || Math.abs(lb.width - width) > 1) {
            problems.push(`at the fold the ledger is ${lb.width.toFixed(1)}px from x=${lb.left.toFixed(1)}; the head's content is ${width.toFixed(1)}px from x=${left.toFixed(1)} (it stretches)`);
          }
        } else if (lb.top < cb.bottom) {
          // beside the copy (one row): bottom-aligned with the H1 block
          if (Math.abs(lb.bottom - cb.bottom) > 1) problems.push(`the ledger's bottom ${lb.bottom.toFixed(1)} ≠ the head copy's bottom ${cb.bottom.toFixed(1)} (±1: bottom-aligned)`);
        }
      }
      return { figures, problems };
    });
  }
  for (const lr of LEDGER_ROUTES) {
    for (const width of [1440, 390] as const) {
      test(`T2.8: the ${lr.id} header ledger — tops, one-line values that fit their figures, two-line subs, head alignment @${width}`, async ({ browser }, testInfo) => {
        const url = await pathFor(browser, testInfo, lr.path);
        if (!url) {
          const d = skipDecision(process.env, `${lr.id}: no such page in this build`);
          if ("fail" in d) throw new Error(d.fail);
          test.skip(true, d.skip);
          return;
        }
        const { ctx, page } = await open(browser, testInfo, width, url);
        try {
          await expect(page.locator("main dl.design-ledger").first()).toBeVisible({ timeout: 20_000 });
          const r = await ledgerProblems(page);
          expect(r.figures, `${url}: the header ledger's figures`).toBeGreaterThanOrEqual(2);
          expect(r.problems, `${url} @${width}`).toEqual([]);
        } finally {
          await ctx.close();
        }
      });
    }
  }
  test("T2.8: the range-valued members carry the values the checks are about (A000148 a range, P000608 unbounded)", async ({ browser }, testInfo) => {
    for (const [url, want] of [["/congress/members/A000148/", /^−?\$[\d.]+[KMB]? to −?\$[\d.]+[KMB]?$/], ["/congress/members/P000608/", /^unbounded$/]] as const) {
      const { ctx, page } = await open(browser, testInfo, 1440, url);
      try {
        const v = await page.evaluate(() => {
          const fig = Array.from(document.querySelectorAll("main dl.design-ledger .ledger-fig")).find((f) => /Net flow/.test(f.querySelector("dt")?.textContent ?? ""));
          return fig ? { value: (fig.querySelector(".ledger-value")?.textContent ?? "").trim(), wide: fig.hasAttribute("data-wide"), sub: (fig.querySelector(".ledger-sub")?.textContent ?? "").trim() } : null;
        });
        expect(v, `${url}: the Net flow figure`).not.toBeNull();
        expect(v!.value, url).toMatch(want);
        if (url.includes("A000148")) expect(v!.wide, "a range is a WIDE value").toBe(true);
        else expect(v!.sub, "the unbounded wording is the sub").toBe("open on both sides · an interval");
      } finally {
        await ctx.close();
      }
    }
  });
  test("T2.8 controls on /congress/: a sub forced to three lines, a two-line value and a value 3px low are each caught @1440", async ({ browser }, testInfo) => {
    const { ctx, page } = await open(browser, testInfo, 1440, "/congress/");
    try {
      expect((await ledgerProblems(page)).problems).toEqual([]);
      // a narrow figure: its sub wraps to three lines or more
      const sub = await page.evaluate(() => {
        const s = Array.from(document.querySelectorAll<HTMLElement>("main dl.design-ledger .ledger-sub")).find((x) => x.checkVisibility() && (x.textContent ?? "").trim().length > 20);
        if (!s) return null;
        const fig = s.closest(".ledger-fig") as HTMLElement;
        fig.style.setProperty("min-width", "0px", "important"); // the figure's own 150px floor would win over a max-width
        fig.style.setProperty("max-width", "64px", "important");
        return s.textContent;
      });
      expect(sub, "a ledger sub long enough to wrap").not.toBeNull();
      expect((await ledgerProblems(page)).problems.some((p) => /^sub .* lines \(at most two\)/.test(p)), "control: a three-line sub").toBe(true);
      await page.evaluate(() => document.querySelectorAll<HTMLElement>("main dl.design-ledger .ledger-fig").forEach((f) => { f.style.removeProperty("max-width"); f.style.removeProperty("min-width"); }));
      expect((await ledgerProblems(page)).problems, "clean again once the figure is back").toEqual([]);
      // a value forced onto two lines
      await page.evaluate(() => {
        const v = document.querySelector<HTMLElement>("main dl.design-ledger .ledger-value")!;
        v.style.cssText += ";max-width:2ch !important;white-space:normal !important;word-break:break-all !important";
      });
      const two = (await ledgerProblems(page)).problems;
      expect(two.some((p) => /^value .* renders on [2-9]\d* lines/.test(p)), `control: a two-line value\n${two.join("\n")}`).toBe(true);
      await page.evaluate(() => { document.querySelector<HTMLElement>("main dl.design-ledger .ledger-value")!.style.cssText = ""; });
      // a value 3px lower than its neighbours
      await page.evaluate(() => { document.querySelectorAll<HTMLElement>("main dl.design-ledger .ledger-value")[1]!.style.transform = "translateY(3px)"; });
      expect((await ledgerProblems(page)).problems.some((p) => /^value tops differ/.test(p)), "control: a misaligned value top").toBe(true);
    } finally {
      await ctx.close();
    }
  });
  test("T2.8 control on /signals/ @1440: the pre-fix centred head (review C2-4) is caught", async ({ browser }, testInfo) => {
    const { ctx, page } = await open(browser, testInfo, 1440, "/signals/");
    try {
      expect((await ledgerProblems(page)).problems).toEqual([]);
      // the rule the fix deleted, re-planted: the Signals head centres its ledger
      const tag = await page.addStyleTag({ content: "#signals-page .page-head { align-items: center !important; }" });
      const centred = (await ledgerProblems(page)).problems;
      expect(centred.some((p) => /bottom-aligned/.test(p)), `control: a centred ledger\n${centred.join("\n")}`).toBe(true);
      await tag.evaluate((el) => el.remove());
      expect((await ledgerProblems(page)).problems).toEqual([]);
    } finally {
      await ctx.close();
    }
  });
  test("T2.8 controls @390: a ledger that does not stretch at the fold, and a wide value without its full row, are each caught", async ({ browser }, testInfo) => {
    const { ctx, page } = await open(browser, testInfo, 390, "/congress/members/A000148/");
    try {
      expect((await ledgerProblems(page)).problems).toEqual([]);
      // review C2-3: the pre-fix fold head — the ledger shrunk to its content and pushed right
      const shrink = await page.addStyleTag({ content: ".design-ledger { align-self: flex-end !important; }" });
      const s = (await ledgerProblems(page)).problems;
      expect(s.some((p) => /at the fold the ledger is .* \(it stretches\)/.test(p)), `control: a shrunk fold ledger\n${s.join("\n")}`).toBe(true);
      await shrink.evaluate((el) => el.remove());
      // review C2-2: the range value in a half column (no data-wide row)
      await page.evaluate(() => document.querySelectorAll("main dl.design-ledger .ledger-fig[data-wide]").forEach((f) => f.removeAttribute("data-wide")));
      const w = (await ledgerProblems(page)).problems;
      expect(w.some((p) => /overflows|overlap|scrolls sideways/.test(p)), `control: a range value in a half column\n${w.join("\n")}`).toBe(true);
    } finally {
      await ctx.close();
    }
  });
  /* M2 delta review: the /institutional/ "Consensus add" sub carries the
     issuer's filed name, and a real one wraps to three lines in a 150px
     figure. The renderer marks such a figure `data-wide` (a character count,
     `ledgerFigureWide`); marked, its sub stays within two lines at 1440 and at
     390. The bounded build has no consensus issuer, so the page's own figure
     is replaced by the REAL renderer's figure over fixture rows — the served
     page's head, stylesheet and fold. */
  const LONG_ADDS: { issuer: string; ticker: string; n: number }[] = [
    { issuer: "MICROSOFT CORP", ticker: "MSFT", n: 8 },
    { issuer: "BERKSHIRE HATHAWAY INC DEL", ticker: "BRK.B", n: 12 },
  ];
  const consensusAddFigure = (a: (typeof LONG_ADDS)[number]): string =>
    disclosureLedger([consensusAddLedgerItem({
      issuerKey: "k", issuer: a.issuer, ticker: a.ticker, newStakes: a.n, adds: 0, trims: 0, exits: 0, filers: a.n,
      netDeltaUsd: 1, netDeltaPartial: false, topMover: null,
    }, "2026-03-31")], { scope: "inst-ledger" }).replace(/^<dl[^>]*>|<\/dl>$/g, "");
  for (const width of [1440, 390] as const) {
    test(`T2.8 (M2 delta): a long Consensus-add sub stays within two lines — the renderer marks its figure wide @${width}; control: unmarked, it wraps to three`, async ({ browser }, testInfo) => {
      const { ctx, page } = await open(browser, testInfo, width, "/institutional/");
      try {
        await expect(page.locator("main dl.design-ledger").first()).toBeVisible({ timeout: 20_000 });
        expect((await ledgerProblems(page)).problems, "the page's own ledger").toEqual([]);
        const unmarkedCaught: string[] = [];
        for (const a of LONG_ADDS) {
          const html = consensusAddFigure(a);
          expect(html, `${a.issuer}: the renderer marks the figure wide`).toMatch(/^<div class="ledger-fig" data-tone="blue" data-wide>/);
          const swapped = await page.evaluate((h) => {
            const fig = Array.from(document.querySelectorAll("main dl.design-ledger .ledger-fig")).find((f) => /Consensus add/.test(f.querySelector("dt")?.textContent ?? ""));
            if (!fig) return null;
            fig.outerHTML = h;
            return (document.querySelector("main dl.design-ledger .ledger-fig[data-tone=blue] .ledger-sub")?.textContent ?? "").trim();
          }, html);
          expect(swapped, `${a.issuer}: the page's Consensus add figure`).toBe(`${a.issuer} · ${a.n} notable managers opened it`);
          const marked = await ledgerProblems(page);
          expect(marked.problems, `${a.issuer} @${width}, marked wide`).toEqual([]);
          // control: the same figure WITHOUT data-wide (the pre-fix renderer)
          await page.evaluate(() => document.querySelector("main dl.design-ledger .ledger-fig[data-tone=blue]")!.removeAttribute("data-wide"));
          const unmarked = (await ledgerProblems(page)).problems;
          if (unmarked.some((p) => /^sub .* renders on [3-9] lines \(at most two\)/.test(p))) unmarkedCaught.push(a.issuer);
          await page.evaluate(() => document.querySelector("main dl.design-ledger .ledger-fig[data-tone=blue]")!.setAttribute("data-wide", ""));
          expect((await ledgerProblems(page)).problems, `${a.issuer}: clean again once marked`).toEqual([]);
        }
        /* at 1440 both names wrap to three lines unmarked (a 150px figure); at
           390 the half column is 171px, so the Microsoft sub fits two lines there
           and the longer name is the control */
        expect(unmarkedCaught, `@${width}: the unmarked figures whose sub wraps to three lines`).toEqual(width === 1440 ? LONG_ADDS.map((a) => a.issuer) : ["BERKSHIRE HATHAWAY INC DEL"]);
      } finally {
        await ctx.close();
      }
    });
  }
  test("T2.8 control @1440: the unbounded interval's phrase as the VALUE (the pre-fix member ledger) is caught", async ({ browser }, testInfo) => {
    const { ctx, page } = await open(browser, testInfo, 1440, "/congress/members/P000608/");
    try {
      expect((await ledgerProblems(page)).problems).toEqual([]);
      await page.evaluate(() => {
        const fig = Array.from(document.querySelectorAll("main dl.design-ledger .ledger-fig")).find((f) => /Net flow/.test(f.querySelector("dt")?.textContent ?? ""))!;
        fig.removeAttribute("data-wide");
        fig.querySelector(".ledger-value")!.textContent = "unbounded — open bounds on both sides";
      });
      const p = (await ledgerProblems(page)).problems;
      expect(p.some((x) => /overflows|overlap/.test(x)), `control: the pre-fix value\n${p.join("\n")}`).toBe(true);
    } finally {
      await ctx.close();
    }
  });

  /* --------------------------------------------------------------- T2.11
     The binder (R36): on every route, after load and after every action that
     re-renders a compact table, each `.compact-disclosure` holding rows back
     (total > shown) has a VISIBLE toggle that agrees with its rows, and one
     press reveals EXACTLY the held rows (the toggle's second press hides them
     again). Its count restates the server: after load it equals the text the
     server rendered for it (read from the raw HTML, so the activity count's
     "of the 50 newest …" and a capped count's noun survive the client), and
     after EVERY action it still reads in the server's words — the count for
     the same `data-compact-for`, digits masked, so a re-render cannot restate
     "of the 50 hits on this page" as "of 50 hits" (review Q2-1); the /e/ member
     is held to the SSR member page's words the same way. It is also the range
     grammar over the element's own attributes (`1–N of [the] T noun`).
     Every collapsed tbody holding rows back has a disclosure naming it
     (review Q2-7), and the primary tables hold their FIXED defaults
     (coordinator decision CD-1: member flows 20, filing history 12, the
     filer's reported positions 20, the signal hits 12, and — CD-5 — the
     Consensus board 10). The signal hits'
     evidence rows show only when opened, so they are not counted as rows. */
  type SsrCounts = Record<string, { text: string; total: number; shown: number }>;
  /** A count's words with its digits masked ("1–20 of 608 tickers" → "#–# of # tickers"). */
  const maskDigits = (t: string): string => t.replace(/\d[\d,]*/g, "#");
  /** The SSR page whose counts an /e/ route's must read like (review Q2-1). */
  const SSR_TWIN: Record<string, string> = { "e-member": "/congress/members/M001193/" };
  /** The fixed default rows per route (CD-1). `hold`: the gate route's data
      holds rows back there, so the table must be compact at exactly `n`. */
  const DEFAULT_ROWS: Record<string, { id: string; n: number; hold: boolean }[]> = {
    member: [{ id: "member-flows-tbody", n: 20, hold: true }, { id: "member-history-tbody", n: 12, hold: true }],
    "e-member": [{ id: "member-flows-tbody", n: 20, hold: true }, { id: "member-history-tbody", n: 12, hold: true }],
    filer: [{ id: "filer-holdings-tbody", n: 20, hold: true }],
    "e-filer": [{ id: "filer-holdings-tbody", n: 20, hold: false }],
    signals: [{ id: "signal-hits-body", n: 12, hold: true }],
    /* CD-5: the Consensus board, I1's primary, shows a fixed 10 (the bounded
       build has no qualifying issuer, so nothing is held back there) */
    institutional: [{ id: "inst-consensus-tbody", n: 10, hold: false }],
  };
  /** Each fixed default that is not what the page shows. */
  async function defaultRowProblems(page: Page, routeId: string): Promise<string[]> {
    const want = DEFAULT_ROWS[routeId] ?? [];
    return page.evaluate((w) => {
      const out: string[] = [];
      for (const d of w) {
        const wrap = document.querySelector<HTMLElement>(`.compact-disclosure[data-compact-for="${d.id}"]`);
        if (!wrap) { if (d.hold) out.push(`${d.id}: no compact disclosure (the default ${d.n} holds rows back on this route)`); continue; }
        const total = Number(wrap.dataset.compactTotal), shown = Number(wrap.dataset.compactShown);
        if (shown !== Math.min(d.n, total)) out.push(`${d.id}: shows ${shown} of ${total} by default (the fixed default is ${d.n})`);
        if (d.hold && !(total > shown)) out.push(`${d.id}: holds nothing back (${shown} of ${total})`);
      }
      return out;
    }, want);
  }
  async function ssrCounts(page: Page, url: string): Promise<SsrCounts> {
    const res = await page.request.get(url);
    expect(res.status(), `${url}: the raw HTML`).toBe(200);
    const html = await res.text();
    return page.evaluate((h) => {
      const doc = new DOMParser().parseFromString(h, "text/html");
      const out: Record<string, { text: string; total: number; shown: number }> = {};
      for (const w of Array.from(doc.querySelectorAll<HTMLElement>(".compact-disclosure"))) {
        const c = w.querySelector(".compact-bound-count");
        if (!c || c.hasAttribute("hidden")) continue;
        out[w.dataset.compactFor ?? ""] = { text: c.textContent ?? "", total: Number(w.dataset.compactTotal), shown: Number(w.dataset.compactShown) };
      }
      return out;
    }, html);
  }
  /** `at`: the rows the table shows while not expanded — its slice, or, after
      a step-paged "Show 50 more", the slice plus whole steps. */
  interface HeldState { id: string; dom: boolean; total: number; shown: number; at: number; toggle: boolean }
  /** Every held disclosure's state, and what disagrees in it. `exact`: after
      load on the SSR page itself, a count with the server's total and slice
      must be its text exactly; otherwise (after an action, or on an /e/ twin)
      it must read in the server's words, digits masked. `stepped`: after an
      action, a step-paged table may show its slice plus whole steps of 50 —
      its count then states those rows ("1–60 of 993 …") and still reads in
      the server's words; after load it may not. */
  async function disclosureState(page: Page, ssr: SsrCounts | null, exact = true, stepped = false): Promise<{ held: HeldState[]; problems: string[]; ssrCompared: number }> {
    return page.evaluate(([ssrIn, exactIn, steppedIn]) => {
      const mask = (t: string): string => t.replace(/\d[\d,]*/g, "#");
      const fmt = (n: number): string => n.toLocaleString("en-US");
      const rowsOf = (root: Element): HTMLElement[] =>
        Array.from(root.querySelectorAll<HTMLElement>(":scope > tr")).filter((tr) => !tr.classList.contains("si-evidence-row"));
      const vis = (e: Element | null): boolean => !!e && e.checkVisibility() && e.getBoundingClientRect().height > 0;
      const held: { id: string; dom: boolean; total: number; shown: number; at: number; toggle: boolean }[] = [];
      const problems: string[] = [];
      let ssrCompared = 0;
      for (const w of Array.from(document.querySelectorAll<HTMLElement>(".compact-disclosure"))) {
        const id = w.dataset.compactFor ?? "";
        const total = Number(w.dataset.compactTotal), shown = Number(w.dataset.compactShown);
        if (!(total > shown)) continue;
        const root = document.getElementById(id);
        if (!root) { problems.push(`${id}: the disclosure controls no element`); continue; }
        // a table folded inside a closed <details> holds its rows behind that fold, not behind this toggle
        if (!vis(root.closest("table") ?? root)) continue;
        const dom = w.hasAttribute("data-compact-dom");
        const noun = w.dataset.compactNoun ?? "rows";
        const boundNoun = w.dataset.compactBoundNoun ?? noun;
        const definite = w.dataset.compactDefinite === "1";
        const btn = w.querySelector<HTMLElement>("button");
        const count = w.querySelector<HTMLElement>(".compact-bound-count");
        const rows = rowsOf(root);
        const visible = rows.filter((r) => vis(r)).length;
        const toggle = vis(btn) && !!(btn!.textContent ?? "").trim();
        const expanded = toggle && btn!.getAttribute("aria-expanded") === "true";
        /* a step-paged table part-way through its steps (R13): the slice plus
           whole steps, never all of it */
        const at = steppedIn && !dom && !expanded && visible > shown && visible < total && (visible - shown) % 50 === 0 ? visible : shown;
        held.push({ id, dom, total, shown, at, toggle });
        if (!toggle) problems.push(`${id}: ${total - shown} rows held back (${shown} of ${total}) but no visible toggle`);
        const label = toggle ? (btn!.textContent ?? "").trim() : "";
        if (expanded) {
          if (visible !== total) problems.push(`${id}: the toggle says expanded, but ${visible} of ${total} rows show`);
          if (label !== `Show only the first ${fmt(shown)} ${noun}`) problems.push(`${id}: expanded, the toggle reads "${label}"`);
          if (vis(count)) problems.push(`${id}: expanded, the count still shows "${count!.textContent}"`);
          continue;
        }
        if (visible !== at) problems.push(`${id}: collapsed, ${visible} rows show (the element says ${shown})`);
        const wantLabel = dom || total - at <= 50 ? `Show all ${fmt(total)} ${noun}` : "Show 50 more";
        if (toggle && label !== wantLabel) problems.push(`${id}: collapsed, the toggle reads "${label}" (want "${wantLabel}")`);
        if (!vis(count)) { problems.push(`${id}: collapsed with rows held back, but no count shows`); continue; }
        const text = count!.textContent ?? "";
        const grammar = `1–${fmt(at)} of ${definite ? "the " : ""}${fmt(total)} ${boundNoun}`;
        if (text !== grammar) problems.push(`${id}: the count reads "${text}", its element states "${grammar}"`);
        const s = ssrIn?.[id];
        if (s && exactIn && s.total === total && s.shown === at) {
          ssrCompared++;
          if (text !== s.text) problems.push(`${id}: the count reads "${text}", the server rendered "${s.text}"`);
        } else if (s) {
          ssrCompared++;
          if (mask(text) !== mask(s.text)) problems.push(`${id}: the count reads "${text}", not in the server's words "${s.text}" (digits masked)`);
        }
      }
      /* review Q2-7: every collapsed tbody holding rows back is NAMED by a
         disclosure that holds them — a table compact with no control is a
         table whose rows are unreachable. */
      for (const tb of Array.from(document.querySelectorAll<HTMLElement>('tbody[data-collapsed="true"]'))) {
        const extra = Array.from(tb.querySelectorAll(":scope > tr[data-compact-extra]")).length;
        if (!extra || !vis(tb.closest("table"))) continue;
        const wrap = tb.id ? document.querySelector<HTMLElement>(`.compact-disclosure[data-compact-for="${tb.id}"]`) : null;
        if (!wrap) problems.push(`${tb.id || "(a tbody with no id)"}: collapsed with ${extra} rows held back, and no disclosure names it`);
        else if (!(Number(wrap.dataset.compactTotal) > Number(wrap.dataset.compactShown))) problems.push(`${tb.id}: collapsed with ${extra} rows held back, but its disclosure holds none`);
      }
      return { held, problems, ssrCompared };
    }, [ssr, exact, stepped] as const);
  }
  /** Press each held disclosure's toggle: from collapsed it must reveal
      exactly the held rows (a step-paged one, "Show 50 more", exactly the next
      step, then each further step), and the press after the last reveal must
      hide them again. */
  async function revealProblems(page: Page, held: HeldState[]): Promise<string[]> {
    const out: string[] = [];
    const count = (id: string) =>
      page.evaluate((i) => {
        const root = document.getElementById(i)!;
        return Array.from(root.querySelectorAll<HTMLElement>(":scope > tr"))
          .filter((tr) => !tr.classList.contains("si-evidence-row") && tr.checkVisibility() && tr.getBoundingClientRect().height > 0).length;
      }, id);
    for (const h of held.filter((x) => x.toggle)) {
      const btn = page.locator(`.compact-disclosure[data-compact-for="${h.id}"] button`).first();
      if ((await btn.getAttribute("aria-expanded")) === "true") {
        await btn.click();
        await page.waitForTimeout(50);
      }
      const before = await count(h.id);
      await btn.click();
      const want = h.dom ? h.total : Math.min(h.total, h.at + 50);
      await expect.poll(() => count(h.id), { timeout: 10_000 }).toBe(want).catch(() => undefined);
      const after = await count(h.id);
      if (before !== h.at || after !== want) out.push(`${h.id}: ${before} rows before the press, ${after} after (want ${h.at} → ${want}: the ${want - h.at} held rows)`);
      /* A step-paged control (R13, "Show 50 more") keeps stepping until every
         row shows — each press exactly one more step — and only then does its
         next press collapse. */
      for (let step = 0; !h.dom && step < 100 && (await btn.getAttribute("aria-expanded")) !== "true"; step++) {
        const at = await count(h.id);
        const next = Math.min(h.total, at + 50);
        await btn.click();
        await expect.poll(() => count(h.id), { timeout: 10_000 }).toBe(next).catch(() => undefined);
        const got = await count(h.id);
        if (got !== next) { out.push(`${h.id}: a further "Show 50 more" took ${at} rows to ${got} (want ${next})`); break; }
      }
      await btn.click();
      await expect.poll(() => count(h.id), { timeout: 10_000 }).toBe(h.shown).catch(() => undefined);
      const back = await count(h.id);
      if (back !== h.shown) out.push(`${h.id}: the second press leaves ${back} rows (want ${h.shown})`);
    }
    return out;
  }
  /** Expand every visible held table, so an action's re-render has to re-sync
      an EXPANDED control against the collapsed rows it paints. */
  async function expandAll(page: Page): Promise<void> {
    for (const b of await page.locator('.compact-disclosure button[aria-expanded="false"]').all()) {
      if (await b.isVisible()) await b.click();
    }
  }
  /** The re-rendering actions per route. `expand: false`: the action is
      itself a press of a held table's control, taken from its collapsed state
      (every other action first expands every held table, so its re-render has
      to re-sync an expanded control). */
  const T211_ACTIONS: Record<string, { name: string; sel: string; expand?: boolean }[]> = {
    filer: [
      { name: "kind chip", sel: '[data-changes-kinds] button[aria-pressed="false"]' },
      { name: "kind chip back to All", sel: '[data-changes-kinds] button[data-changes-kind="all"][aria-pressed="false"]' },
      { name: "period chip", sel: '[data-period-chips] button[aria-pressed="false"]' },
      { name: "changes pager", sel: '[data-changes-pager] [data-changes-page="next"]:not([aria-disabled="true"])' },
      { name: "holdings pager", sel: '#holdings-next:not([aria-disabled="true"])' },
      { name: "holdings view", sel: '[data-holdings-views] button[aria-pressed="false"]' },
    ],
    signals: [
      { name: "hits pager", sel: '#signal-hits-next:not([aria-disabled="true"])' },
      { name: "rule filter", sel: '.si-hit-filter button[aria-pressed="false"]' },
    ],
    member: [{ name: "transactions pager", sel: '[data-entity-older]:not([aria-disabled="true"])' }],
    /* the M2 delta review: a step-paged ranking's "Show 50 more" (R13), then
       its restated count — "1–60 of 993 ranked tickers" — against the server's
       words */
    congress: [{ name: "Show 50 more", sel: '.compact-disclosure button.compact-toggle:text-is("Show 50 more")', expand: false }],
  };
  T211_ACTIONS["e-filer"] = T211_ACTIONS.filer!;
  T211_ACTIONS["e-member"] = T211_ACTIONS.member!;

  for (const route of ROUTES) {
    test(`T2.11: ${route.id} — every held compact table has a working toggle and its server's count, after load and after each action @1440`, async ({ browser }, testInfo) => {
      const url = await pathFor(browser, testInfo, route.path);
      if (!url) {
        const d = routeAbsent(route, `${route.id}: no such page in this build`);
        if ("fail" in d) throw new Error(d.fail);
        test.skip(true, d.skip);
        return;
      }
      const { ctx, page } = await open(browser, testInfo, 1440, url, route.seedWatch);
      try {
        const twin = SSR_TWIN[route.id];
        const ssr = url.startsWith("/e/") ? (twin ? await ssrCounts(page, twin) : null) : await ssrCounts(page, url);
        const load = await disclosureState(page, ssr, !url.startsWith("/e/"));
        const log: string[] = [`after load: ${load.held.length} held table(s), ${load.ssrCompared} count(s) compared with the server's`];
        const problems = load.problems.map((p) => `after load: ${p}`);
        problems.push(...(await defaultRowProblems(page, route.id)).map((p) => `after load: ${p}`));
        problems.push(...(await revealProblems(page, load.held)).map((p) => `after load: ${p}`));
        if (twin) {
          /* review Q2-1: the /e/ member restates the SSR member page's counts */
          const heldIds = new Set(load.held.map((h) => h.id));
          const want = Object.keys(ssr ?? {}).filter((id) => heldIds.has(id)).length;
          if (!want || load.ssrCompared < want) problems.push(`after load: ${load.ssrCompared} of ${want} held counts compared with ${twin}`);
        } else if (ssr) {
          /* every held count the server rendered is compared after load — a
             client that changed a count's total or slice on load is caught here */
          const heldIds = new Set(load.held.map((h) => h.id));
          const want = Object.entries(ssr).filter(([id, s]) => s.total > s.shown && heldIds.has(id)).length;
          if (load.ssrCompared !== want) problems.push(`after load: ${load.ssrCompared} of ${want} held counts still carry the server's total and slice`);
        }
        let ran = 0;
        let comparedAfter = 0;
        for (const a of T211_ACTIONS[route.id] ?? []) {
          const ctl = page.locator(a.sel).first();
          if (!(await ctl.count()) || !(await ctl.isVisible())) {
            log.push(`${a.name}: not offered on this page`);
            continue;
          }
          if (a.expand !== false) await expandAll(page);
          await ctl.click();
          await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => undefined);
          await page.waitForTimeout(300);
          ran++;
          // review Q2-1: after every action the counts still read in the server's words
          const st = await disclosureState(page, ssr, false, true);
          comparedAfter += st.ssrCompared;
          log.push(`after ${a.name}: ${st.held.length} held table(s) (${st.held.filter((h) => h.at > h.shown).map((h) => `${h.id} at ${h.at} of ${h.total}`).join(", ") || "none stepped"}), ${st.ssrCompared} compared with the server's words`);
          problems.push(...st.problems.map((p) => `after ${a.name}: ${p}`));
          problems.push(...(await revealProblems(page, st.held)).map((p) => `after ${a.name}: ${p}`));
        }
        testInfo.annotations.push({ type: "T2.11", description: log.join("; ") });
        expect(problems, log.join("\n")).toEqual([]);
        if (T211_ACTIONS[route.id]) {
          expect(ran, `${route.id}: at least one re-rendering action ran\n${log.join("\n")}`).toBeGreaterThan(0);
          /* M2 delta review: the after-action comparison compared SOMETHING —
             a comparison that matched no count is not a comparison. A route
             whose counts have no server text (the tail filer: no SSR page, no
             twin) states it instead. */
          if (ssr) expect(comparedAfter, `${route.id}: counts compared with the server's words after an action\n${log.join("\n")}`).toBeGreaterThan(0);
          else testInfo.annotations.push({ type: "T2.11", description: `${route.id}: no server text to compare after an action (no SSR page, no twin)` });
        }
      } finally {
        await ctx.close();
      }
    });
  }

  test("T2.11 control: with the populus:rerender listener removed, a hits pager click leaves the control disagreeing with its rows @1440", async ({ browser }, testInfo) => {
    /* the stub runs before the page's scripts: the binder (and every other
       listener) cannot hear the re-render any more */
    const { ctx, page } = await open(browser, testInfo, 1440, "/signals/", false, () => {
      const add = EventTarget.prototype.addEventListener;
      document.addEventListener = function (this: Document, type: string, ...rest: unknown[]) {
        if (type === "populus:rerender") return;
        return (add as (...a: unknown[]) => void).call(this, type, ...rest);
      } as typeof document.addEventListener;
    });
    try {
      const load = await disclosureState(page, await ssrCounts(page, "/signals/"));
      expect(load.problems, "after load the binder still works (it binds on init)").toEqual([]);
      expect(load.held.some((h) => h.id === "signal-hits-body"), "the hits table holds rows back").toBe(true);
      await expandAll(page);
      await page.locator("#signal-hits-next").click();
      await page.waitForLoadState("networkidle").catch(() => undefined);
      await page.waitForTimeout(300);
      const after = await disclosureState(page, null);
      testInfo.annotations.push({ type: "control caught", description: after.problems.join("; ") });
      /* review Q2-11: the disagreement caught is the hits table's own — its
         control says one thing and its re-rendered rows another — never some
         unrelated problem elsewhere on the page */
      expect(
        after.problems.some((p) => /^signal-hits-body: (?:the toggle says expanded, but \d+ of \d+ rows show|expanded, the (?:toggle reads|count still shows)|collapsed, \d+ rows show|collapsed, the toggle reads)/.test(p)),
        `control: the hits control disagrees with its rows\n${JSON.stringify(after, null, 1)}`,
      ).toBe(true);
    } finally {
      await ctx.close();
    }
  });

  test("T2.11 control: dropping data-compact-definite makes a restated count differ from the server's @1440", async ({ browser }, testInfo) => {
    const { ctx, page } = await open(browser, testInfo, 1440, "/institutional/filers/1135730/");
    try {
      const ssr = await ssrCounts(page, "/institutional/filers/1135730/");
      const load = await disclosureState(page, ssr);
      expect(load.problems).toEqual([]);
      const definite = await page.evaluate(() => {
        const w = document.querySelector<HTMLElement>('.compact-disclosure[data-compact-definite="1"]');
        if (!w) return null;
        w.removeAttribute("data-compact-definite");
        document.dispatchEvent(new CustomEvent("populus:rerender", { detail: { root: "control" } }));
        return w.dataset.compactFor ?? "";
      });
      expect(definite, "the filer page carries a definite (bounded) count").not.toBeNull();
      await page.waitForTimeout(100);
      const after = await disclosureState(page, ssr);
      expect(after.problems.some((p) => p.startsWith(`${definite}: the count reads`) && /server rendered/.test(p)), `control\n${after.problems.join("\n")}`).toBe(true);
    } finally {
      await ctx.close();
    }
  });

  test("T2.11 control (M2 delta): after a Congress \"Show 50 more\", a stepped count in other words is caught, and the step is allowed only after an action @1440", async ({ browser }, testInfo) => {
    const { ctx, page } = await open(browser, testInfo, 1440, "/congress/");
    try {
      const ssr = await ssrCounts(page, "/congress/");
      await page.locator('.compact-disclosure button.compact-toggle:text-is("Show 50 more")').first().click();
      await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => undefined);
      await page.waitForTimeout(300);
      const st = await disclosureState(page, ssr, false, true);
      expect(st.problems).toEqual([]);
      const stepped = st.held.find((h) => h.at > h.shown);
      expect(stepped, `a ranking stepped past its slice\n${JSON.stringify(st.held)}`).toBeDefined();
      expect(stepped!.at, "one step of 50").toBe(stepped!.shown + 50);
      expect(st.ssrCompared, "the stepped count was compared with the server's words").toBeGreaterThan(0);
      // control: read as after load, the stepped rows disagree with the element's slice
      const asLoad = await disclosureState(page, ssr, false, false);
      expect(asLoad.problems.some((p) => p.startsWith(`${stepped!.id}: collapsed, ${stepped!.at} rows show`)), asLoad.problems.join("\n")).toBe(true);
      // control: the stepped count restated without its bound noun's "ranked"
      await page.evaluate((id) => {
        const c = document.querySelector(`.compact-disclosure[data-compact-for="${id}"] .compact-bound-count`)!;
        c.textContent = (c.textContent ?? "").replace("ranked ", "");
      }, stepped!.id);
      const words = await disclosureState(page, ssr, false, true);
      expect(words.problems.some((p) => p.startsWith(`${stepped!.id}: the count reads`) && /server's words/.test(p)), words.problems.join("\n")).toBe(true);
    } finally {
      await ctx.close();
    }
  });

  /* ---------------------------------------------------------------- T2.7
     An opened hit's evidence lays out on its own row across the table's full
     width (R11, H-14): the row follows its hit, its one cell spans every
     column, the row is the table's width ±1px and its body fills the cell;
     and every receipt link in it is fully visible — inside its row, inside
     the viewport, and clipped by no ancestor (the G7 walk). */
  async function evidenceProblems(page: Page): Promise<{ links: number; problems: string[] }> {
    return page.evaluate(() => {
      const problems: string[] = [];
      const hit = Array.from(document.querySelectorAll("#signal-hits-body > tr.si-hit")).find((tr) => tr.querySelector("details.si-expand[open]"));
      if (!hit) return { links: 0, problems: ["no hit's evidence is open"] };
      const row = hit.nextElementSibling as HTMLTableRowElement | null;
      if (!row || !row.matches("tr.si-evidence-row")) return { links: 0, problems: ["the opened hit is not followed by its evidence row"] };
      const table = hit.closest("table")!;
      const rr = row.getBoundingClientRect();
      if (!row.checkVisibility() || rr.height < 1) return { links: 0, problems: ["the evidence row is not displayed"] };
      const head = table.tHead?.rows[table.tHead.rows.length - 1];
      const cols = head ? Array.from(head.cells).reduce((n, c) => n + Math.max(1, c.colSpan), 0) : 0;
      const td = row.cells[0];
      if (row.cells.length !== 1 || !td || td.colSpan !== cols) problems.push(`the evidence row has ${row.cells.length} cell(s) spanning ${td?.colSpan ?? 0} of ${cols} columns`);
      const tr = table.getBoundingClientRect();
      if (Math.abs(rr.width - tr.width) > 1) problems.push(`the evidence row is ${rr.width.toFixed(1)}px wide, the table ${tr.width.toFixed(1)}px`);
      const body = td?.querySelector(".si-expand-body");
      if (td && body) {
        const cs = getComputedStyle(td);
        const inner = td.getBoundingClientRect().width - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
        const bw = body.getBoundingClientRect().width;
        if (Math.abs(bw - inner) > 1) problems.push(`the evidence body is ${bw.toFixed(1)}px wide in a ${inner.toFixed(1)}px cell`);
      } else problems.push("the evidence row has no evidence body");
      const links = Array.from(row.querySelectorAll<HTMLElement>("a[href]"));
      if (!links.length) problems.push("the evidence carries no receipt link");
      for (const a of links) {
        const label = `receipt "${(a.textContent ?? "").trim().slice(0, 24)}"`;
        const rects = Array.from(a.getClientRects()).filter((q) => q.width > 0 && q.height > 0);
        if (!a.checkVisibility() || !rects.length) { problems.push(`${label} does not render`); continue; }
        for (const q of rects) {
          if (q.left < rr.left - 0.5 || q.right > rr.right + 0.5 || q.top < rr.top - 0.5 || q.bottom > rr.bottom + 0.5) problems.push(`${label} reaches outside its row`);
          if (q.left < -0.5 || q.right > document.documentElement.clientWidth + 0.5) problems.push(`${label} reaches outside the viewport`);
          for (let e = a.parentElement; e && e !== document.body; e = e.parentElement) {
            const cs = getComputedStyle(e);
            if (cs.overflowX === "visible" && cs.overflowY === "visible") continue;
            const b = e.getBoundingClientRect();
            const l = b.left + e.clientLeft, t = b.top + e.clientTop;
            if (q.left < l - 0.5 || q.right > l + e.clientWidth + 0.5 || q.top < t - 0.5 || q.bottom > t + e.clientHeight + 0.5) {
              problems.push(`${label} is clipped by ${e.tagName.toLowerCase()}.${String(e.className).split(/\s+/)[0] ?? ""}`);
              break;
            }
          }
        }
      }
      return { links: links.length, problems };
    });
  }
  test("T2.7: an opened hit's evidence spans the table and every receipt in it is fully visible @1440", async ({ browser }, testInfo) => {
    const { ctx, page } = await open(browser, testInfo, 1440, "/signals/");
    try {
      await page.locator("#signal-hits-body > tr.si-hit details.si-expand > summary").first().click();
      await expect(page.locator("#signal-hits-body > tr.si-evidence-row").first()).toBeVisible();
      const r = await evidenceProblems(page);
      expect(r.links, "the opened evidence carries receipt links").toBeGreaterThan(0);
      expect(r.problems).toEqual([]);
      // control 1: the evidence body boxed and clipped
      const tag = await page.addStyleTag({ content: ".si-expand-body { max-width: 300px !important; overflow: hidden !important; }" });
      expect((await evidenceProblems(page)).problems.length, "control: a clipped evidence body is caught").toBeGreaterThan(0);
      await tag.evaluate((el) => el.remove());
      expect((await evidenceProblems(page)).problems).toEqual([]);
      // control 2: the evidence row never displayed
      await page.addStyleTag({ content: ".si-table > tbody > tr.si-evidence-row { display: none !important; }" });
      expect((await evidenceProblems(page)).problems, "control: an evidence row that never shows is caught").toEqual(["the evidence row is not displayed"]);
    } finally {
      await ctx.close();
    }
  });

  /* Review R2-2 / C2-1: a HELD hit's evidence never shows. Opened while the
     table was expanded, then collapsed, the held hit is hidden — and its
     evidence row must be hidden with it, or its receipts read as belonging to
     the last visible hit. The predicate: every displayed evidence row directly
     follows a displayed hit, and names that hit. */
  async function strayEvidence(page: Page): Promise<string[]> {
    return page.evaluate(() => {
      const shown = (e: Element | null): boolean => !!e && e.checkVisibility() && e.getBoundingClientRect().height > 0;
      const out: string[] = [];
      for (const row of Array.from(document.querySelectorAll<HTMLElement>("#signal-hits-body > tr.si-evidence-row"))) {
        if (!shown(row)) continue;
        const hit = row.previousElementSibling as HTMLElement | null;
        if (!hit || !hit.matches("tr.si-hit") || !shown(hit)) out.push(`the evidence of ${row.dataset.evidenceFor} shows under no visible hit of its own`);
        else if (hit.dataset.signalId !== row.dataset.evidenceFor) out.push(`the evidence of ${row.dataset.evidenceFor} sits under ${hit.dataset.signalId}`);
      }
      return out;
    });
  }
  test("R2-2: a held hit's opened evidence is hidden with it when the table collapses — no receipts under the wrong hit @1440", async ({ browser }, testInfo) => {
    const { ctx, page } = await open(browser, testInfo, 1440, "/signals/");
    try {
      const btn = page.locator('.compact-disclosure[data-compact-for="signal-hits-body"] button');
      await expect(btn).toBeVisible();
      await btn.click(); // expand: every hit on the page
      const held = page.locator("#signal-hits-body > tr.si-hit[data-compact-extra]").first();
      await expect(held).toBeVisible();
      await held.locator("details.si-expand > summary").click();
      await expect(page.locator("#signal-hits-body > tr.si-evidence-row[data-compact-extra]").first()).toBeVisible();
      expect(await strayEvidence(page), "expanded: the opened evidence sits under its own hit").toEqual([]);
      await btn.click(); // collapse
      await expect(held).toBeHidden();
      expect(await strayEvidence(page)).toEqual([]);
      expect(await page.locator("#signal-hits-body > tr.si-evidence-row[data-compact-extra]").evaluateAll((rs) => rs.filter((r) => r.checkVisibility()).length), "no held evidence row displays").toBe(0);
      /* control: the pre-fix stylesheet (the show rule outranking the compact
         hide) with the held evidence left open — the stray receipts are caught */
      await page.addStyleTag({ content: ".si-table > tbody > tr.si-hit:has(details.si-expand[open]) + tr.si-evidence-row { display: table-row !important; }" });
      await held.evaluate((tr) => tr.querySelector("details.si-expand")!.setAttribute("open", ""));
      const stray = await strayEvidence(page);
      expect(stray.length, `control: the stray evidence is caught\n${stray.join("\n")}`).toBeGreaterThan(0);
    } finally {
      await ctx.close();
    }
  });
});

/* ======================================================================
   DESIGN-POLISH M3 — content hygiene, the one geometric property (T3.3, R17):
   in a TRUNCATED asset cell the partial and owner qualifiers are fully
   visible. The qualifiers are the asset line's own flex item, outside the
   ellipsis box, so a long asset name gives way and the qualifiers never do.
   The route is /congress/ (the reference feed puts the qualifiers in its
   asset cell); one qualified row's asset text is lengthened so it MUST
   truncate, and the measurement requires it to have truncated — a check over
   rows that happen to fit would prove nothing. Control: the pre-fix
   structure — the qualifiers inside the truncating text — is caught.
   ====================================================================== */
test.describe("M3: route properties", () => {
  test.beforeEach(({}, testInfo) => {
    test.skip(!!testInfo.project.use.hasTouch, "fine-pointer route properties; the touch project runs the probe checks");
  });

  async function qualifierProblems(page: Page, plantInside = false): Promise<{ truncated: boolean; problems: string[] }> {
    return page.evaluate((inside) => {
      const line = [...document.querySelectorAll<HTMLElement>("#feed-section .asset-line")].find((l) => l.querySelector(":scope > .owner-note") && l.checkVisibility());
      if (!line) return { truncated: false, problems: ["no qualified asset line on the page"] };
      line.scrollIntoView({ block: "center" });
      const text = line.querySelector<HTMLElement>(":scope > .asset-text")!;
      const box = text.querySelector<HTMLElement>(".note-label") ?? text;
      const label = box.querySelector(".filed-name") ?? box;
      label.textContent = `${label.textContent} ${"Very Long Issuer Name Corporation ".repeat(8)}`.trim();
      const q = line.querySelector<HTMLElement>(":scope > .owner-note")!;
      /* the pre-fix structure: the qualifiers in the SAME truncating inline
         run as the asset text */
      if (inside) box.append(" ", q);
      const cell = line.closest("td")!;
      const cr = cell.getBoundingClientRect();
      const qr = q.getBoundingClientRect();
      const problems: string[] = [];
      const truncated = box.scrollWidth > box.clientWidth + 1;
      if (qr.width === 0) problems.push("the qualifiers have no box");
      if (qr.left < cr.left - 0.5 || qr.right > cr.right + 0.5) problems.push(`the qualifiers (${qr.left.toFixed(1)}–${qr.right.toFixed(1)}) reach past their cell (${cr.left.toFixed(1)}–${cr.right.toFixed(1)})`);
      const tr = text.getBoundingClientRect();
      if (!inside && qr.left < tr.right - 0.5) problems.push("the qualifiers overlap the truncating text");
      for (const [x, where] of [[qr.left + 1, "start"], [qr.right - 1, "end"]] as const) {
        const e = document.elementFromPoint(x, qr.top + qr.height / 2);
        if (!e || !(e === q || q.contains(e))) problems.push(`the qualifiers' ${where} is clipped or covered (${e ? e.tagName.toLowerCase() + "." + [...e.classList].join(".") : "nothing"})`);
      }
      return { truncated, problems };
    }, plantInside);
  }

  for (const width of [1440, 390] as const) {
    test(`T3.3: in a truncated asset cell the partial and owner qualifiers are fully visible @${width}`, async ({ browser }, testInfo) => {
      const { ctx, page } = await open(browser, testInfo, width, "/congress/");
      try {
        await expect(page.locator("#feed-section .asset-line").first()).toBeAttached({ timeout: 20_000 });
        const r = await qualifierProblems(page);
        expect(r.truncated, "the planted asset text truncates (the check measures a truncated cell)").toBe(true);
        expect(r.problems, `/congress/ @${width}`).toEqual([]);
      } finally {
        await ctx.close();
      }
    });
  }

  test("T3.3 control: the qualifiers inside the truncating text (the pre-fix structure) are caught @1440", async ({ browser }, testInfo) => {
    const { ctx, page } = await open(browser, testInfo, 1440, "/congress/");
    try {
      await expect(page.locator("#feed-section .asset-line").first()).toBeAttached({ timeout: 20_000 });
      const r = await qualifierProblems(page, true);
      expect(r.problems.length, "control: qualifiers inside the ellipsis are clipped").toBeGreaterThan(0);
    } finally {
      await ctx.close();
    }
  });
});
