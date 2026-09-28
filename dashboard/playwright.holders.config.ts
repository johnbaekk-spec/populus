/* Holders-route browser regression (code review cycle 5, F1).

   A SEPARATE Playwright config, not part of the R35 geometry lane, because the
   two lanes serve different bytes: geometry previews the real `dist` build,
   while this lane serves the PRODUCER-BACKED fixture envelope through
   `test/fixtures/holders-preview.sh` — the same published command a human
   reviewer runs — so the automated evidence and the manual evidence come from
   one path, not two. */
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./test/holders-browser",
  /* DESIGN-POLISH T1.10: the gate script sets PW_OUTPUT_DIR per run and per
     config, so this lane and the geometry lane never wipe each other's
     output (R30, T-16, V2 NEW-4). Unset, Playwright's default applies. */
  ...(process.env.PW_OUTPUT_DIR ? { outputDir: process.env.PW_OUTPUT_DIR } : {}),
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: { ...devices["Desktop Chrome"], baseURL: "http://localhost:4416" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "bash test/fixtures/holders-preview.sh /tmp/holders-e2e 4416",
    url: "http://localhost:4416/institutional/tickers/AAPL/holders/",
    /* Same rule as the geometry lane (its F7): never reuse a server from an
       earlier run — it would serve another tree's bytes and pass for them. */
    reuseExistingServer: false,
    timeout: 180_000,
  },
});
