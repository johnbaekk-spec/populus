/* R36 — "no absolute denial remains anywhere in copy."

   The plan names two copy files. The tree had FIVE. `Base.astro`'s footer
   ("no cookies · no account required · no tracking") ships on every page, and
   `index.astro` and `watchlist/index.astro` carried their own versions. A
   line-oriented grep found only some of them, because the prose wraps — so this
   flattens whitespace before matching. A newline-insensitive sweep is the only
   kind that can make a claim about wrapped copy. */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, globSync } from "node:fs";
import path from "node:path";

const SRC = path.resolve(import.meta.dirname, "../src");

/** Unqualified denials of analytics/tracking. `no cross-site tracking` and
    `no cookies` are NOT here: both remain true — Cloudflare Web Analytics is
    cookieless and sets no cross-site identifier — and narrowing a claim to what
    survives is the point, not deleting it. */
const ABSOLUTE_DENIAL =
  /no\s+analytics\s+of\s+any\s+kind|no\s+tracking(?!\s*[·,]?\s*(?:no\s+)?cross-site)|never\s+tracked|no\s+telemetry|does\s+not\s+track/gi;

function flattened(file: string): string {
  return readFileSync(file, "utf8").replace(/\s+/g, " ");
}

test("no absolute analytics denial survives anywhere in shipped copy", () => {
  const offenders: string[] = [];
  for (const rel of globSync("**/*.{astro,ts,tsx,md}", { cwd: SRC })) {
    const flat = flattened(path.join(SRC, rel));
    for (const m of flat.matchAll(ABSOLUTE_DENIAL)) {
      offenders.push(`${rel}: …${flat.slice(Math.max(0, m.index - 60), m.index + 60)}…`);
    }
  }
  assert.deepEqual(offenders, [], "copy denies analytics the site now performs");
});

test("POSITIVE CONTROL: the sweep detects a denial split across lines", () => {
  // Proves the matcher is newline-insensitive and can fire at all. Without
  // this, an empty offender list is indistinguishable from a broken regex.
  const wrapped = "No tracking, no cookies, no fingerprinting, no analytics of any\n  kind, and no account";
  assert.match(wrapped.replace(/\s+/g, " "), ABSOLUTE_DENIAL);
});

test("the methodology page states the locked retention, attributed and dated", () => {
  const flat = flattened(path.join(SRC, "pages/methodology/index.astro"));
  for (const required of [
    "Cloudflare Web Analytics",
    "7 days",
    "10%",
    "six months",
    "2026-08-15",
  ]) {
    assert.ok(flat.includes(required), `methodology copy is missing: ${required}`);
  }
});
