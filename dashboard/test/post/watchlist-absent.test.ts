/* signals-v3 M1 (LD12, success criterion 5): the BUILT site carries no
   watchlist.

   Over the real dist bytes: no `/watchlist/` route is emitted, and no built
   HTML or JavaScript file contains `watchlist`, `Watchlist` or `populus:watch`
   — except `theme-init.js`, whose one-time cleanup names the four legacy
   localStorage keys it removes (declared debt TD-1). The scan reads raw bytes
   (a NUL byte cannot hide a file), enumerates what it covered, and fails
   loudly when coverage is implausibly small: an empty hit list over a handful
   of files is the silent-grep failure shape, not a pass. */

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const DIST = path.join(process.cwd(), "dist");

/** The LD12 needles, exactly as the plan names them. */
const NEEDLES = ["watchlist", "Watchlist", "populus:watch"] as const;
/** The one file allowed to carry them: the legacy-key cleanup. */
const ALLOWED = new Set(["theme-init.js"]);
/** T1.6: the watch CONTROLS' own markup hooks — the member and ticker header
    star, the feed rows' star, the Signals watch band — which name no needle
    above. None may survive anywhere, the cleanup file included. */
const CONTROL_HOOKS = ["data-watch", "watch-btn", "star-btn", "reference-watch", "signal-watch"] as const;

function builtFiles(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...builtFiles(full));
    else if (e.name.endsWith(".html") || e.name.endsWith(".js")) out.push(full);
  }
  return out;
}

/** Each needle found in `bytes`, by raw byte search. */
export function needlesIn(bytes: Buffer, needles: readonly string[] = NEEDLES): string[] {
  return needles.filter((n) => bytes.includes(n));
}

test("LD12: the scanner finds each needle in raw bytes, NUL or not", () => {
  for (const n of NEEDLES) {
    assert.deepEqual(needlesIn(Buffer.from(`a\u0000b ${n} c`)), [n], `control: ${n}`);
  }
  assert.deepEqual(needlesIn(Buffer.from("watch list · Watch · populus:theme")), [], "control: near misses are not hits");
});

test("LD12: no /watchlist/ route is emitted; the site's 404 page is", () => {
  assert.ok(existsSync(DIST), "dist/ must exist — this suite runs post-build");
  assert.equal(existsSync(path.join(DIST, "watchlist")), false, "dist/watchlist/ was emitted");
  assert.ok(existsSync(path.join(DIST, "404.html")), "the 404 page a /watchlist/ request falls through to is built");
});

test("LD12: no built HTML or JS names the watchlist — only theme-init.js's cleanup does", () => {
  assert.ok(existsSync(DIST), "dist/ must exist — this suite runs post-build");
  const files = builtFiles(DIST);
  assert.ok(files.length >= 50, `only ${files.length} files covered — the scan is not seeing the site`);
  assert.ok(files.some((f) => f.endsWith(".js") && !f.endsWith("theme-init.js")), "no application JS covered — client-island copy is outside the scan");
  const hits: string[] = [];
  let allowedSeen = 0;
  for (const file of files) {
    const found = needlesIn(readFileSync(file));
    if (found.length === 0) continue;
    const rel = path.relative(DIST, file);
    if (ALLOWED.has(rel)) {
      allowedSeen++;
      continue;
    }
    hits.push(`${rel}: ${found.join(", ")}`);
  }
  assert.deepEqual(hits.slice(0, 20), [], `the watchlist survives in ${hits.length} built file(s)`);
  // the allowed file was scanned and does carry the cleanup — the allowance is
  // not covering for a file the walk never reached
  assert.equal(allowedSeen, 1, "theme-init.js was scanned and names the legacy keys");
  const cleanup = readFileSync(path.join(DIST, "theme-init.js"), "utf-8");
  for (const key of ["populus:watch:v2", "populus:watch:members", "populus:watch:v2.corrupt", "populus:watch:cursor:v1"]) {
    assert.ok(cleanup.includes(`localStorage.removeItem("${key}")`), `the shipped cleanup removes ${key}`);
  }
});

test("T1.6: no built page or script carries a watch control — member, ticker and feed stars and the Signals band are gone", () => {
  assert.ok(existsSync(DIST), "dist/ must exist — this suite runs post-build");
  const files = builtFiles(DIST);
  assert.ok(files.length >= 50, `only ${files.length} files covered — the scan is not seeing the site`);
  for (const page of ["congress/index.html", "signals/index.html", "index.html"]) {
    assert.ok(files.includes(path.join(DIST, page)), `${page} was scanned`);
  }
  assert.ok(files.some((f) => /\/congress\/members\/[^/]+\/index\.html$/.test(f)), "a member page was scanned");
  assert.ok(files.some((f) => /\/tickers\/[^/]+\/index\.html$/.test(f)), "a ticker page was scanned");
  const hits: string[] = [];
  for (const file of files) {
    const found = needlesIn(readFileSync(file), CONTROL_HOOKS);
    if (found.length > 0) hits.push(`${path.relative(DIST, file)}: ${found.join(", ")}`);
  }
  assert.deepEqual(hits.slice(0, 20), [], `a watch control survives in ${hits.length} built file(s)`);
  // control: the retired header star is seen
  assert.deepEqual(needlesIn(Buffer.from('<button class="watch-btn" data-watch-kind="member">'), CONTROL_HOOKS), ["data-watch", "watch-btn"]);
});
