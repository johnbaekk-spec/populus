/* R35 — the geometry harness. Chromium only, and deliberately NOT part of the
   browserless lanes: it needs a real engine against real `dist` bytes, so it
   joins `test:post`, the only stage where a built tree exists. It therefore
   runs locally and never in CI (standing constraint 3). */
import { defineConfig, devices } from "@playwright/test";

/** The five widths the plan fixes. They are not round numbers for their own
    sake: 360 is the narrow phone, 720 the fold boundary, 964 and 1080 the band
    where the masthead used to collide, 1440 the comfortable desktop. */
export const WIDTHS = [360, 720, 964, 1080, 1440] as const;

export default defineConfig({
  testDir: "./test/geometry",
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: { ...devices["Desktop Chrome"], baseURL: "http://localhost:4321" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "npx astro preview --port 4321",
    url: "http://localhost:4321/",
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
