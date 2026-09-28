/* R35 — the geometry harness. Chromium only, and deliberately NOT part of the
   browserless lanes: it needs a real engine against real `dist` bytes, so it
   joins `test:post`, the only stage where a built tree exists. It therefore
   runs locally and never in CI (standing constraint 3).

   DESIGN-POLISH T1.10 adds:
   - `outputDir` from PW_OUTPUT_DIR, set by the gate script per run and per
     config, so neither Playwright config wipes the other's output and no
     later run wipes an earlier one (R30, T-16, V2 NEW-4). Unset, Playwright's
     default (`test-results/`) applies;
   - the `touch` project (hasTouch, isMobile): the coarse-pointer arm of
     `ledger.spec.ts` and `sl-notes.spec.ts`. It depends on `touch-preflight`,
     which asserts `(any-pointer: coarse)` matches and FAILS the run when it
     does not — a touch project on a fine pointer would measure the 24px arm
     and report it as the 44px one;
   - `ledger.spec.ts` reads POPULUS_THEME (`dark` default, or `light`). */
import { defineConfig, devices } from "@playwright/test";

/** The five widths the plan fixes. They are not round numbers for their own
    sake: 360 is the narrow phone, 720 the fold boundary, 964 and 1080 the band
    where the masthead used to collide, 1440 the comfortable desktop. */
export const WIDTHS = [360, 720, 964, 1080, 1440] as const;

/** The coarse-pointer context: Desktop Chrome metrics (deviceScaleFactor 1,
    so geometry reads the same CSS pixels as the fine project) with touch
    input and mobile viewport handling. */
export const TOUCH_USE = { ...devices["Desktop Chrome"], hasTouch: true, isMobile: true };

const PREFLIGHT = /@touch-preflight/;

export default defineConfig({
  testDir: "./test/geometry",
  ...(process.env.PW_OUTPUT_DIR ? { outputDir: process.env.PW_OUTPUT_DIR } : {}),
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: { ...devices["Desktop Chrome"], baseURL: "http://localhost:4321" },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] }, grepInvert: PREFLIGHT },
    { name: "touch-preflight", use: TOUCH_USE, testMatch: /ledger\.spec\.ts$/, grep: PREFLIGHT },
    {
      name: "touch",
      use: TOUCH_USE,
      testMatch: [/ledger\.spec\.ts$/, /sl-notes\.spec\.ts$/],
      grepInvert: PREFLIGHT,
      dependencies: ["touch-preflight"],
    },
  ],
  webServer: {
    command: "npx astro preview --port 4321",
    url: "http://localhost:4321/",
    /* F7 (codex round 1): NEVER reuse. A preview server left running from an
       earlier build serves that build's bytes, so the gate would measure a tree
       that is not the one under review and report green for it. Freshness is
       the whole point of a post-build gate. */
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
