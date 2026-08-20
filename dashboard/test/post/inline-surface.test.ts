/* R36 — the CSP drift guard, over the WHOLE built tree.

   The locked policy in `public/_headers` pins `script-src` to exactly two
   inline script hashes. This recomputes the emitted set and asserts SET
   EQUALITY with that pair, so it fails three ways: a changed pre-paint script,
   a changed toggle module, and any unapproved NEW inline surface.

   B31 — the trap this gate exists to survive. The plan's census ("exactly TWO
   distinct inline script modules") was taken over 3,668 pages. The tree is now
   ~9,660, and the institutional embeds brought thousands of
   `<script type="application/json">` data islands with them, up to 2.4 MB each.
   A sweep that matched `<script>` without inspecting `type` counts ~2,955
   distinct bodies rather than 2. The obvious reaction — add the missing hashes —
   is exactly backwards: `type="application/json"` NEVER EXECUTES, `script-src`
   does not govern it, and hashing it would pin the CSP to the CORPUS, so every
   data refresh would break the deploy.

   So only executable bodies count: `type` absent, `module`, `text/javascript`,
   or `application/javascript`. */

import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, globSync } from "node:fs";
import path from "node:path";

const DIST = path.resolve(import.meta.dirname, "../../dist");
const HEADERS = path.resolve(import.meta.dirname, "../../public/_headers");

/** `type` values the browser EXECUTES. Anything else is inert data. */
const EXECUTABLE = new Set(["", "module", "text/javascript", "application/javascript"]);

/** sha256-<base64> over the exact inline body bytes, as CSP computes it. */
function cspHash(body: string): string {
  return "sha256-" + createHash("sha256").update(body, "utf8").digest("base64");
}

/** Distinct hashes of EXECUTABLE inline scripts in one HTML document.
    Exported so the detector itself can be proven rather than assumed. */
export function inlineScriptHashes(html: string): Set<string> {
  const out = new Set<string>();
  for (const m of html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)) {
    const attrs = m[1]!;
    const body = m[2]!;
    if (/\ssrc\s*=/.test(attrs)) continue; // external: governed by URL, not hash
    if (body === "") continue;
    const typeMatch = attrs.match(/\stype\s*=\s*["']([^"']*)["']/i);
    const type = (typeMatch?.[1] ?? "").trim().toLowerCase();
    if (!EXECUTABLE.has(type)) continue; // B31: JSON islands never execute
    out.add(cspHash(body));
  }
  return out;
}

/** The hashes the shipped policy pins, read from the file that ships. */
function lockedHashes(): Set<string> {
  const policy = readFileSync(HEADERS, "utf8");
  const scriptSrc = policy.split("script-src")[1]!.split(";")[0]!;
  return new Set([...scriptSrc.matchAll(/'(sha256-[^']+)'/g)].map((m) => m[1]!));
}

// --- POSITIVE CONTROL: the detector must be able to FIND things -------------
// Without this, "the emitted set equals the locked pair" is indistinguishable
// from "the regex matched nothing at all" — failure shape #3 from the handoff.

test("the detector distinguishes executable inline scripts from JSON islands", () => {
  const html = `
    <script>var a=1</script>
    <script type="module">var b=2</script>
    <script type="application/json">{"huge":"island"}</script>
    <script type="application/ld+json">{"schema":"org"}</script>
    <script src="/x.js"></script>
    <script type="text/javascript">var a=1</script>
  `;
  const found = inlineScriptHashes(html);
  // `var a=1` appears twice with different `type` spellings — both executable,
  // one hash. The two JSON bodies and the external script contribute nothing.
  assert.equal(found.size, 2, "expected exactly the two distinct executable bodies");
  assert.ok(found.has(cspHash("var a=1")));
  assert.ok(found.has(cspHash("var b=2")));
  assert.ok(!found.has(cspHash('{"huge":"island"}')), "a JSON island must never be hashed");
});

// --- THE GATE ---------------------------------------------------------------

test("the emitted inline-script hash set EQUALS the locked pair", () => {
  const locked = lockedHashes();
  assert.equal(locked.size, 2, "the policy must pin exactly two script hashes");

  const pages = globSync("**/*.html", { cwd: DIST });
  assert.ok(pages.length > 0, "no built pages — the sweep would pass vacuously");

  const emitted = new Set<string>();
  const firstSeen = new Map<string, string>();
  for (const rel of pages) {
    for (const h of inlineScriptHashes(readFileSync(path.join(DIST, rel), "utf8"))) {
      if (!emitted.has(h)) firstSeen.set(h, rel);
      emitted.add(h);
    }
  }

  const unpinned = [...emitted].filter((h) => !locked.has(h));
  const unused = [...locked].filter((h) => !emitted.has(h));
  assert.deepEqual(
    unpinned.map((h) => `${h} (first at ${firstSeen.get(h)})`),
    [],
    "an inline script the CSP does not admit — it will be BLOCKED in production",
  );
  assert.deepEqual(unused, [], "the policy pins a hash nothing emits — stale lock");
  assert.equal(emitted.size, 2, `expected 2 distinct executable inline bodies, got ${emitted.size}`);
});

test("R28: the beacon is on every built page, and adds no inline surface", () => {
  const pages = globSync("**/*.html", { cwd: DIST });
  assert.ok(pages.length > 0, "no built pages — this would pass vacuously");
  const missing: string[] = [];
  for (const rel of pages) {
    const html = readFileSync(path.join(DIST, rel), "utf8");
    if (!html.includes("static.cloudflareinsights.com/beacon.min.js")) missing.push(rel);
  }
  assert.deepEqual(missing.slice(0, 5), [], `beacon absent on ${missing.length} page(s)`);
});
