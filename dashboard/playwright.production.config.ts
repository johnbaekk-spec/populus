/* DESIGN-POLISH R35 / T5.8 — production verification after a deploy.

   Runs the SAME G1–G12 predicates (`test/geometry/geometry.ts`, through
   `ledger.spec.ts`) against https://publicfilings.org. No web server: it
   measures what the domain serves. The prototype's `measure.mjs` is never
   used for this (T-3). `ledger.spec.ts` carries T5.8's control — the same
   G1 predicate against a known-misaligned page served through `page.route`
   must fail — so this config proves its detector on every run.

   Run by the owner after a deploy, never by CI:
     PW_OUTPUT_DIR=<evidence dir> POPULUS_THEME=dark \
       npx playwright test -c playwright.production.config.ts
   (then again with POPULUS_THEME=light). */
import { defineConfig, devices } from "@playwright/test";

const PREFLIGHT = /@touch-preflight/;
const TOUCH_USE = { ...devices["Desktop Chrome"], hasTouch: true, isMobile: true };

export default defineConfig({
  testDir: "./test/geometry",
  testMatch: /ledger\.spec\.ts$/,
  ...(process.env.PW_OUTPUT_DIR ? { outputDir: process.env.PW_OUTPUT_DIR } : {}),
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: { ...devices["Desktop Chrome"], baseURL: "https://publicfilings.org" },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"], baseURL: "https://publicfilings.org" }, grepInvert: PREFLIGHT },
    { name: "touch-preflight", use: { ...TOUCH_USE, baseURL: "https://publicfilings.org" }, grep: PREFLIGHT },
    {
      name: "touch",
      use: { ...TOUCH_USE, baseURL: "https://publicfilings.org" },
      grepInvert: PREFLIGHT,
      dependencies: ["touch-preflight"],
    },
  ],
});
