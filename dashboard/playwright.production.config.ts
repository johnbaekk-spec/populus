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
   (then again with POPULUS_THEME=light).

   launch M1a (T1.2): the phone harness (`phone.spec.ts`) runs here too, in the
   chromium project only (it builds its own touch, iPhone-agent contexts at
   360/390/430), so the live probe and the local gate are one ruler. */
import { defineConfig, devices } from "@playwright/test";

const PREFLIGHT = /@touch-preflight/;
const TOUCH_USE = { ...devices["Desktop Chrome"], hasTouch: true, isMobile: true };

export default defineConfig({
  testDir: "./test/geometry",
  testMatch: [/ledger\.spec\.ts$/, /phone\.spec\.ts$/],
  ...(process.env.PW_OUTPUT_DIR ? { outputDir: process.env.PW_OUTPUT_DIR } : {}),
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: { ...devices["Desktop Chrome"], baseURL: "https://publicfilings.org" },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"], baseURL: "https://publicfilings.org" }, grepInvert: PREFLIGHT },
    { name: "touch-preflight", use: { ...TOUCH_USE, baseURL: "https://publicfilings.org" }, testMatch: /ledger\.spec\.ts$/, grep: PREFLIGHT },
    {
      name: "touch",
      use: { ...TOUCH_USE, baseURL: "https://publicfilings.org" },
      testMatch: /ledger\.spec\.ts$/,
      grepInvert: PREFLIGHT,
      dependencies: ["touch-preflight"],
    },
  ],
});
