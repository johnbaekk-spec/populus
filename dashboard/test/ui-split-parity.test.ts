/* T6.5 (REPOSITORY-PROFESSIONALIZATION Slice 6): rendered-output parity.

   The fixture file test/fixtures/ui-split-parity.json was CAPTURED on the
   unsplit tree (monolithic src/lib/ui.ts) by running this test once with
   UI_PARITY_CAPTURE=1. After the T6.2/T6.3 split into src/lib/ui/, every
   surface must render byte-identically. A legitimate future rendering change
   re-captures deliberately with the same env var — never by editing the JSON
   by hand. */

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { renderParitySurfaces } from "./lib/ui-parity-surfaces.ts";

const FIXTURE = path.resolve(import.meta.dirname, "fixtures", "ui-split-parity.json");

test("ui split: every rendered surface is byte-identical to the pre-split capture", async () => {
  const current = await renderParitySurfaces();
  if (process.env.UI_PARITY_CAPTURE === "1") {
    writeFileSync(FIXTURE, JSON.stringify(current, null, 2) + "\n");
    return;
  }
  assert.ok(existsSync(FIXTURE), "capture missing — run once with UI_PARITY_CAPTURE=1");
  const captured = JSON.parse(readFileSync(FIXTURE, "utf-8")) as Record<string, string>;
  assert.deepEqual(
    Object.keys(current).sort(),
    Object.keys(captured).sort(),
    "surface key sets differ",
  );
  for (const [key, html] of Object.entries(captured)) {
    assert.equal(current[key], html, `surface ${key} drifted from the pre-split capture`);
  }
});
