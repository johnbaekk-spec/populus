/* F-28 unit tests: the scanner sees through NUL bytes (the failure plain grep
   has), enumerates coverage, and throws on unreadable files. The NUL fixture
   is the plan's required regression: it FAILS if the protection is removed
   (i.e. if the scanner ever starts binary-sniffing). */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

import { scanTree, BANNED_PATTERNS } from "./lib/banned-scan.ts";

function fixtureDir(): string {
  return mkdtempSync(path.join(tmpdir(), "banned-scan-"));
}

test("the NUL fixture: a banned word BEHIND a NUL byte is found (plain grep is blind here)", () => {
  const dir = fixtureDir();
  const withNul = Buffer.concat([
    Buffer.from("const key = `${cik}"),
    Buffer.from([0]),
    Buffer.from("${ticker}`;\n// the filer is bullish on this\n"),
  ]);
  writeFileSync(path.join(dir, "derive-like.ts"), withNul);
  // Prove the trap is real: plain grep classifies the file as binary and
  // reports no line matches (BSD prints "Binary file … matches" to stdout,
  // GNU exits 1) — either way, the LINE match is not delivered.
  let grepSawLine = false;
  try {
    const out = execFileSync("grep", ["bullish", path.join(dir, "derive-like.ts")], {
      encoding: "utf-8",
    });
    grepSawLine = out.includes("the filer is bullish");
  } catch {
    grepSawLine = false;
  }
  assert.equal(grepSawLine, false, "if plain grep sees through NUL now, revisit the rationale");

  const result = scanTree(dir, (n) => n.endsWith(".ts"));
  assert.deepEqual(result.covered, ["derive-like.ts"], "coverage is enumerated");
  assert.ok(
    result.hits.some((h) => h.pattern === "bullish"),
    "the scanner must find the banned word the NUL hid from grep",
  );

  // Review F11: the same protection over a client BUNDLE shape — banned
  // client-rendered copy behind a NUL in a .js file must be found too.
  const jsWithNul = Buffer.concat([
    Buffer.from('const k="a"'),
    Buffer.from([0]),
    Buffer.from(';el.innerHTML="the member is doubling down";'),
  ]);
  writeFileSync(path.join(dir, "island.js"), jsWithNul);
  const js = scanTree(dir, (n) => n.endsWith(".js"));
  assert.deepEqual(js.covered, ["island.js"]);
  assert.ok(js.hits.some((h) => h.pattern === "doubling down"));
});

test("word boundaries: 'Alphabet' and 'QoQ moves' are clean; whole words are not", () => {
  const dir = fixtureDir();
  writeFileSync(path.join(dir, "clean.html"), "Alphabet Inc · QoQ moves · removed · a better outcome");
  writeFileSync(path.join(dir, "dirty.html"), "the senator is buying more");
  const result = scanTree(dir, (n) => n.endsWith(".html"));
  assert.equal(result.covered.length, 2);
  // "is buying" legitimately matches both the "buying" and "is buying"
  // patterns — assert on the FILES flagged, not the hit count.
  assert.deepEqual([...new Set(result.hits.map((h) => h.file))], ["dirty.html"]);
});

test("an empty match set over zero covered files is a FAILURE signal, not a pass", () => {
  const dir = fixtureDir();
  mkdirSync(path.join(dir, "sub"));
  const result = scanTree(dir, (n) => n.endsWith(".html"));
  // The scanner itself reports coverage; the GATE asserts it is non-zero.
  // This test pins the contract the gate relies on.
  assert.equal(result.covered.length, 0);
  assert.equal(result.hits.length, 0);
});

test("every §1.1 banned string has a pattern", () => {
  const names = BANNED_PATTERNS.map((p) => p.name);
  for (const required of [
    "bet", "conviction", "high-conviction", "bullish", "bearish", "loading up",
    "piling in", "doubling down", "backs", "favors", "likes", "buying",
    "is buying", "just bought", "sold", "move (verb)",
  ]) {
    assert.ok(names.includes(required), `missing pattern for banned string: ${required}`);
  }
});
