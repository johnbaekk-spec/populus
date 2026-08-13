/* The §0 banned-wording gate (F-28-hardened), over the REAL dist bytes.

   Not grep: the scanner reads raw bytes (a NUL byte cannot hide a file),
   enumerates every covered file, and this gate FAILS LOUDLY when coverage is
   implausibly small — a pass is a checked-empty match set over a named file
   list, never an inference from silence. */

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";

import { scanTree } from "../lib/banned-scan.ts";

const DIST = path.join(process.cwd(), "dist");

test("§0: no banned wording on any built surface; coverage enumerated and non-trivial", () => {
  assert.ok(existsSync(DIST), "dist/ must exist — this suite runs post-build");
  // Review F11: application JavaScript renders client-side copy (feed,
  // watchlist, institutional index islands) — HTML alone is not the surface.
  const result = scanTree(DIST, (name) => name.endsWith(".html") || name.endsWith(".js"));
  // Fail loudly if the gate covered (almost) nothing: an empty covered list
  // with an empty hit list is the silent-grep failure shape, not a pass.
  assert.ok(
    result.covered.length >= 50,
    `only ${result.covered.length} files covered — the gate is not seeing the site`,
  );
  assert.ok(
    result.covered.some((f) => f.endsWith(".js")),
    "no JS bundles covered — client-island copy is outside the gate",
  );
  const report = result.hits
    .slice(0, 20)
    .map((h) => `${h.file}: [${h.pattern}] …${h.excerpt}…`)
    .join("\n");
  assert.equal(
    result.hits.length,
    0,
    `banned wording on ${result.hits.length} surface(s):\n${report}`,
  );
});
