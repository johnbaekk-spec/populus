/* Launch review (weight item 5; R33, LD26 "print renders every held row"):
   the holders print check, against the REAL dist.

   The holders-browser lane serves a two-holder seed, so no row is ever held
   there and its print check could not fail. This spec picks, from the built
   dist, a holders page whose list holds rows past the first 25 (an island
   for `ticker-holders-held`), and requires:
   - the re-planted control: print emulation ALONE (no `beforeprint`) shows
     only the server's rows — so a missing handler is caught;
   - with `beforeprint` dispatched first, paper shows the server's rows plus
     every held row the island carries. */

import { test, expect } from "@playwright/test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const DIST = process.env.POPULUS_DIST_DIR ?? path.resolve(import.meta.dirname, "..", "..", "dist");
const HELD = 'data-held-for="ticker-holders-held"';

/** The first holders page (sorted) whose list holds rows, or null. */
function heldHoldersRoute(): string | null {
  const root = path.join(DIST, "institutional", "tickers");
  if (!existsSync(root)) return null;
  for (const t of readdirSync(root).sort()) {
    const f = path.join(root, t, "holders", "index.html");
    if (existsSync(f) && readFileSync(f, "utf-8").includes(HELD)) return `/institutional/tickers/${t}/holders/`;
  }
  return null;
}

test("launch review (R33): print lists every holder of a real holders page with held rows — and print emulation alone does not", async ({ page }) => {
  const route = heldHoldersRoute();
  test.skip(route === null, "this dist has no holders page with more than 25 holders: nothing is held, so there is nothing to print-check");
  const resp = await page.goto(route!);
  expect(resp?.status(), `${route} answers 200`).toBe(200);
  const ROWS = "#ticker-holders-rows tr, #ticker-holders-held tr";
  const before = await page.evaluate(
    ({ sel, held }) => {
      const island = document.querySelector(`script[type="application/json"][${held}]`);
      const rows = (JSON.parse(island?.textContent || "{}") as { rows?: unknown[] }).rows ?? [];
      return { held: rows.length, inDom: document.querySelectorAll(sel).length };
    },
    { sel: ROWS, held: HELD },
  );
  expect(before.held, `${route}: the island holds rows`).toBeGreaterThan(0);
  expect(before.inDom, "the server's first rows are on the page").toBe(25);
  const printedRows = (): Promise<number> => page.locator(ROWS).evaluateAll((trs) => trs.filter((tr) => tr.getClientRects().length > 0).length);

  // re-planted control: emulation never fires beforeprint, so the held rows stay out
  await page.emulateMedia({ media: "print" });
  expect(await printedRows(), "control: print emulation alone prints the server's rows only").toBe(before.inDom);
  await page.emulateMedia({ media: "screen" });

  await page.evaluate(() => window.dispatchEvent(new Event("beforeprint")));
  await page.emulateMedia({ media: "print" });
  expect(await printedRows(), "every holder on paper: the server's rows plus every held row").toBe(before.inDom + before.held);
  await page.evaluate(() => window.dispatchEvent(new Event("afterprint")));
  await page.emulateMedia({ media: "screen" });
});
