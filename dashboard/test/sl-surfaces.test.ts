/* RUN SURFACES-LEGIBILITY — the surface-level changes (SL-R1, SL-R9, SL-R10,
   SL-R11, SL-R12, SL-R13, SL-R14, SL-R15, SL-R29).

   `sl-` prefix per Constraint 9: this run's R-numbers collide with earlier
   runs', so nothing here may be named `r<n>-`. */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const congressPage = readFileSync(
  new URL("../src/pages/congress/index.astro", import.meta.url),
  "utf8",
);
const methodology = readFileSync(
  new URL("../src/pages/methodology/index.astro", import.meta.url),
  "utf8",
);

test("SL-R1: the /congress/ head drops its caveat line for a stamp plus FOUR deep methodology links", () => {
  assert.ok(!congressPage.includes('id="congress-caveat"'), "the caveat line is gone");
  assert.ok(congressPage.includes('id="congress-stamp"'), "the stamp line replaces it");

  const links = [...congressPage.matchAll(/href="\/methodology\/#([a-z0-9-]+)"/g)].map((m) => m[1]!);
  const wanted = ["coverage", "amount-ranges", "filing-lag", "owner-codes"];
  for (const id of wanted) {
    assert.ok(links.includes(id), `the head links /methodology/#${id}`);
    // The check that would have caught `#coverage`: the link must resolve to an
    // id that EXISTS. It did not, on origin/main, and resolved to the top of
    // the page instead.
    assert.ok(methodology.includes(`id="${id}"`), `/methodology/#${id} exists`);
  }
});

test("SL-R1: neither claim the caveat line carried depends on following a link", () => {
  // §7: text may change channel, never disappear. Both sentences are still in
  // the lede paragraph above the stamp, so a reader who follows nothing still
  // reads them.
  assert.ok(congressPage.includes("statutory ranges"), "the range claim is still on the page");
  assert.ok(congressPage.includes("45 days after the trade"), "the lag claim is still on the page");
});

test("SL-R9: no `.panel-note` prints a build id, and the footer copy is untouched", async () => {
  const { congressRankingSection, addsSectionHtml } = await import("../src/lib/ui.ts");
  assert.equal(typeof congressRankingSection, "function");
  assert.equal(typeof addsSectionHtml, "function");

  const ui = readFileSync(new URL("../src/lib/ui.ts", import.meta.url), "utf8");
  // Every remaining `· build ` in this module must be OUTSIDE a `.panel-note`.
  // There is exactly one, the signals page's `.si-asof`, which this run does
  // not own and whose bytes are therefore unchanged.
  const buildStamps = [...ui.matchAll(/[^\n]*· build [^\n]*/g)].map((m) => m[0]!);
  assert.equal(buildStamps.length, 1, "one build stamp left in ui.ts");
  assert.ok(buildStamps[0]!.includes("si-asof"), "and it is the out-of-scope signals stamp");
});

test("SL-R9: the client no longer reconstructs a build id out of rendered text", () => {
  for (const f of ["../src/scripts/congress-sections.ts", "../src/scripts/inst-index-client.ts"]) {
    const src = readFileSync(new URL(f, import.meta.url), "utf8");
    assert.ok(
      !src.includes('split(" · build ")'),
      `${f}: parsing a stamp back out of textContent to re-append it is gone`,
    );
  }
});
