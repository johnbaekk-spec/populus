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

import { scanVisibleRule3 } from "../lib/banned-scan.ts";

test("R27: no pipeline vocabulary (SRC §1 rule 3) in any page's visible text; coverage enumerated", () => {
  assert.ok(existsSync(DIST), "dist/ must exist — this suite runs post-build");
  const result = scanVisibleRule3(DIST);
  assert.ok(result.covered.length >= 50, `only ${result.covered.length} pages covered — the gate is not seeing the site`);
  const byPattern = new Map<string, number>();
  for (const h of result.hits) byPattern.set(h.pattern, (byPattern.get(h.pattern) ?? 0) + 1);
  const report = result.hits.slice(0, 15).map((h) => `${h.file}: [${h.pattern}] …${h.excerpt}…`).join("\n");
  assert.equal(result.hits.length, 0, `rule-3 vocabulary on ${result.hits.length} page(s) ${JSON.stringify(Object.fromEntries(byPattern))}:\n${report}`);
});

/* ---------- T3 (2026-09-13): the gate must be able to FAIL ----------

   A wording gate that has never been seen to reject anything is
   indistinguishable from one whose patterns no longer match. These tests plant
   each required term in a scratch copy of the real dist and assert the scanner
   rejects it, then assert the same scanner stays silent on the three surfaces
   it must never police: source comments, test fixtures, and the transition
   tombstone ROUTES (`index.v*.json.ts`), whose whole purpose is to be named
   that. */

import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";

import { RULE3_PATTERNS, T3_REQUIRED_PATTERNS, visibleText } from "../lib/banned-scan.ts";

/** A scratch dist carrying one real page plus one planted page. */
function plantedDist(body: string): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "banned-plant-"));
  // 50 innocuous pages so the coverage floor the gate asserts is satisfied and
  // the planted hit is what fails, never the floor.
  for (let i = 0; i < 50; i += 1) {
    writeFileSync(path.join(dir, `filler-${i}.html`), "<p>Filings, as filed.</p>");
  }
  writeFileSync(path.join(dir, "planted.html"), body);
  return dir;
}

test("T3: every required term is a live pattern, and each one rejects a planted page", () => {
  const names = new Set(RULE3_PATTERNS.map((p) => p.name));
  for (const required of T3_REQUIRED_PATTERNS) {
    assert.ok(names.has(required), `pattern "${required}" is no longer in RULE3_PATTERNS`);
  }

  // One planted page per term, each in ordinary visible copy.
  const phrases: Record<(typeof T3_REQUIRED_PATTERNS)[number], string> = {
    tombstone: "signals that left carry supersession tombstones naming the build.",
    "render bound": "this table is cut at the render bound for the page.",
    shard: "the remaining filers are served from a shard budget of 2,672 files.",
    projection: "the serving projection carries the newest two periods.",
    "coverage bucket": "each member falls in a coverage bucket by filing count.",
    "gold tick": "the gold tick names the build this page was rendered from.",
    "classified by value": "this position was classified by value, not shares.",
  };
  for (const term of T3_REQUIRED_PATTERNS) {
    const dir = plantedDist(`<main><p>${phrases[term]}</p></main>`);
    try {
      const result = scanVisibleRule3(dir);
      assert.ok(result.covered.length >= 50, "the planted tree must clear the coverage floor");
      const hit = result.hits.find((h) => h.pattern === term);
      assert.ok(
        hit,
        `planting "${phrases[term]}" did not fail the gate — pattern "${term}" matches nothing`,
      );
      assert.equal(hit!.file, "planted.html");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

test("T3: the gate stays off source comments, test fixtures and tombstone routes", () => {
  // (a) A SOURCE comment and a <script> body are machine surface, not copy.
  const withSource =
    `<main><p>Filings, as filed.</p></main>` +
    `<!-- the tombstone route emits a projection for each shard -->` +
    `<script>const tombstone = { projection: "shard", coverageBucket: 1 };</script>` +
    `<template><p>a coverage bucket and a gold tick</p></template>`;
  assert.equal(
    RULE3_PATTERNS.filter((p) => p.re.test(visibleText(withSource))).length,
    0,
    "the scanner read markup it must treat as machine surface",
  );

  // (b) The real tombstone ROUTES are TypeScript under src/, never scanned:
  //     the gate walks dist/ and reads only .html. Assert both halves — that
  //     the routes really do carry the word, and that they are outside the
  //     scanned tree — so this cannot pass by the files having been renamed.
  const routes = path.join(process.cwd(), "src", "pages", "institutional", "data", "filers");
  const route = path.join(routes, "index.v3.json.ts");
  assert.ok(existsSync(route), "the v3 tombstone route moved; re-point this test");
  assert.match(readFileSync(route, "utf-8"), /tombstone/i, "the route no longer says it");
  assert.ok(!route.startsWith(DIST + path.sep), "a source route is inside the scanned tree");

  // (c) What those routes EMIT into dist is .json, which the rule-3 scan does
  //     not read — it is a machine payload, not a page.
  const emitted = path.join(DIST, "institutional", "data", "filers", "index.v3.json");
  if (existsSync(emitted)) {
    const result = scanVisibleRule3(DIST);
    assert.ok(
      !result.covered.some((f) => f.endsWith(".json")),
      "the rule-3 scan reached a machine payload",
    );
  }
});
