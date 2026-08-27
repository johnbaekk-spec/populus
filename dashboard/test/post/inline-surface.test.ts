/* R36 → RUN PUBLIC-SECURITY-HARDENING R12/LD13 — the inline-script gate, over
   the WHOLE built tree.

   The locked policy in `public/_headers` is now `script-src 'self'` with NO
   inline hashes: the pre-paint theme IIFE moved byte-for-byte to
   `public/theme-init.js`, and `vite.build.assetsInlineLimit: 0` keeps Astro
   from inlining small bundled modules. So the gate is stricter than its R36
   ancestor: the emitted executable-inline-script set must be EMPTY, and the
   policy must pin zero hashes. It fails three ways: a re-inlined pre-paint
   script, a bundler that starts inlining small modules again, and any
   unapproved NEW inline surface.

   B31 — the trap this gate exists to survive, unchanged. The institutional
   embeds ship thousands of `<script type="application/json">` data islands, up
   to 2.4 MB each. A sweep that matched `<script>` without inspecting `type`
   counts ~2,955 distinct bodies. `type="application/json"` NEVER EXECUTES and
   `script-src` does not govern it — only executable bodies count: `type`
   absent, `module`, `text/javascript`, or `application/javascript`. */

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
// Without this, "the emitted set is empty" is indistinguishable from "the
// regex matched nothing at all".

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

test("LD13: no executable inline script exists anywhere in the built tree", () => {
  const locked = lockedHashes();
  assert.equal(
    locked.size,
    0,
    "the policy must pin ZERO script hashes — `script-src 'self'` admits no inline body",
  );

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

  assert.deepEqual(
    [...emitted].map((h) => `${h} (first at ${firstSeen.get(h)})`),
    [],
    "an executable inline script exists — the LD13 CSP will BLOCK it in production",
  );
});

test("the pre-paint theme script is external, synchronous, and on every page", () => {
  const pages = globSync("**/*.html", { cwd: DIST });
  assert.ok(pages.length > 0, "no built pages — this would pass vacuously");
  const missing: string[] = [];
  const deferred: string[] = [];
  for (const rel of pages) {
    const html = readFileSync(path.join(DIST, rel), "utf8");
    const m = html.match(/<script([^>]*)\ssrc="\/theme-init\.js"([^>]*)><\/script>/);
    if (!m) {
      missing.push(rel);
      continue;
    }
    const attrs = `${m[1]} ${m[2]}`;
    // Synchronous is the point: a deferred pre-paint script repaints (FOUC).
    if (/\b(defer|async|type\s*=\s*["']module["'])\b/.test(attrs)) deferred.push(rel);
    // It must sit in <head>, before the body paints.
    const headEnd = html.indexOf("</head>");
    if (headEnd !== -1 && html.indexOf('src="/theme-init.js"') > headEnd) missing.push(rel);
  }
  assert.deepEqual(missing.slice(0, 5), [], `theme-init.js absent/after-head on ${missing.length} page(s)`);
  assert.deepEqual(deferred.slice(0, 5), [], "theme-init.js must load synchronously");
});

test("theme-init.js ships in dist and is byte-identical to the source file", () => {
  const shipped = readFileSync(path.join(DIST, "theme-init.js"), "utf8");
  const source = readFileSync(
    path.resolve(import.meta.dirname, "../../public/theme-init.js"),
    "utf8",
  );
  assert.equal(shipped, source, "dist/theme-init.js drifted from public/theme-init.js");
  assert.match(shipped, /populus:theme/, "the moved IIFE lost its localStorage key");
});

test("_headers ships in dist byte-identical, with the LD13 policy set", () => {
  const shipped = readFileSync(path.join(DIST, "_headers"), "utf8");
  const source = readFileSync(HEADERS, "utf8");
  assert.equal(shipped, source, "dist/_headers drifted from public/_headers");
  assert.match(shipped, /script-src 'self' https:\/\/static\.cloudflareinsights\.com;/);
  assert.ok(!shipped.includes("'sha256-"), "LD13: no inline-script hash survives");
  assert.ok(!shipped.includes("'unsafe-eval'"));
  assert.match(shipped, /Strict-Transport-Security: max-age=31536000$/m);
  assert.ok(!shipped.includes("includeSubDomains") && !shipped.includes("preload"));
  assert.match(shipped, /X-Content-Type-Options: nosniff$/m);
  assert.match(shipped, /Referrer-Policy: strict-origin-when-cross-origin$/m);
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
