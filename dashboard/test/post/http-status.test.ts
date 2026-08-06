/* Post-build suite, part 1 (runs via `npm run test:post` strictly AFTER
   `astro build` in `npm run gates` — never against a stale dist/):

   - the served HTTP-status contract (Locked #3): /e/ answers 200, a canonical
     entity page answers 200, a garbage entity URL answers 404;
   - the REAL search index obeys its field allowlist and ≤128 KiB budget;
   - dist hygiene: no absolute build-machine paths, no obvious secret shapes,
     and no institutional fixture routes leak into the production dist. */

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

import { searchIndexValid } from "../../src/lib/derive.ts";
import { statsSourcePath } from "../../src/lib/data.ts";

const DASH = path.resolve(import.meta.dirname, "..", "..");
const DIST = path.join(DASH, "dist");
const PORT = 4873;
const BASE = `http://localhost:${PORT}`;

let preview: ChildProcess | null = null;

async function waitForServer(url: string, tries = 60): Promise<void> {
  for (let i = 0; i < tries; i++) {
    try {
      await fetch(url);
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  throw new Error(`astro preview did not come up at ${url}`);
}

before(async () => {
  assert.ok(
    existsSync(path.join(DIST, "index.html")),
    "dist/ must exist — test:post runs after `astro build` (gates ordering)",
  );
  preview = spawn("npx", ["astro", "preview", "--port", String(PORT)], {
    cwd: DASH,
    stdio: "ignore",
  });
  await waitForServer(`${BASE}/`);
});

after(() => {
  preview?.kill();
});

function firstMemberBioguide(): string {
  const dirs = readdirSync(path.join(DIST, "congress", "members"));
  assert.ok(dirs.length > 0, "member pages were emitted");
  return dirs[0]!;
}

test("status contract: /e/ 200 · canonical 200 · garbage 404 (Locked #3)", async () => {
  const e = await fetch(`${BASE}/e/?k=m:Z000099`);
  assert.equal(e.status, 200, "/e/ is a prerendered page served 200");
  const canonical = await fetch(`${BASE}/congress/members/${firstMemberBioguide()}/`);
  assert.equal(canonical.status, 200);
  const home = await fetch(`${BASE}/`);
  assert.equal(home.status, 200, "the root serves the Home page, not a redirect");
  const garbage = await fetch(`${BASE}/congress/members/ZZZZZZZ/`);
  assert.equal(garbage.status, 404, "a genuinely absent page is a real 404");
  const nowhere = await fetch(`${BASE}/no/such/route/`);
  assert.equal(nowhere.status, 404);
});

test("nav routes all resolve: /institutional /methodology /financials /macro", async () => {
  for (const route of ["/institutional/", "/methodology/", "/financials/", "/macro/", "/congress/"]) {
    const r = await fetch(`${BASE}${route}`);
    assert.equal(r.status, 200, `${route} must not 404 from the masthead`);
  }
});

test("real search index: allowlist shape + ≤128 KiB budget (R11)", async () => {
  const r = await fetch(`${BASE}/search/index.v1.json`);
  assert.equal(r.status, 200);
  const bytes = Buffer.from(await r.arrayBuffer());
  assert.ok(
    bytes.length <= 128 * 1024,
    `search index is ${bytes.length} bytes — over the 128 KiB budget`,
  );
  const index = JSON.parse(bytes.toString("utf-8"));
  assert.ok(searchIndexValid(index));
  for (const t of index.tickers) {
    assert.equal(t.length, 3);
    assert.equal(typeof t[0], "string");
    assert.equal(typeof t[1], "string");
    assert.equal(typeof t[2], "number");
  }
  for (const m of index.members) {
    assert.equal(m.length, 4);
  }
  for (const f of index.filers) {
    assert.equal(f.length, 2);
  }
});

/* ---------- R24: the dist/stats.json copy ---------- */

test("stats.json: emitted, served, and BYTE-equal to the canonical build copy (R24)", async () => {
  const canonical = readFileSync(statsSourcePath());
  const emitted = readFileSync(path.join(DIST, "stats.json"));
  assert.deepEqual(
    emitted,
    canonical,
    "dist/stats.json must be the canonical bytes verbatim — the producer renders" +
      " them with json.dumps(ensure_ascii=False, indent=2, sort_keys=True) + newline," +
      " which no JS re-serialization reproduces",
  );
  const r = await fetch(`${BASE}/stats.json`);
  assert.equal(r.status, 200, "/stats.json is served, not a 404");
  const served = Buffer.from(await r.arrayBuffer());
  assert.deepEqual(served, canonical, "the SERVED bytes equal the canonical copy too");
  // Byte-equality with an empty file would be vacuous; the count key is the
  // field the deploy gate patches into both copies.
  assert.ok(canonical.length > 0, "the canonical copy is not empty");
  JSON.parse(served.toString("utf-8"));
});

/* ---------- R19: machine-readable markers, and no digest anywhere ---------- */

test("every page carries both build markers, identical across the dist (R19)", () => {
  const pages = walkFiles(DIST, [".html"]);
  assert.ok(pages.length > 1000, "the full page set is under test");
  const reBuild = /<meta name="populus:build_id" content="([^"]*)"/;
  const reSha = /<meta name="populus:code_sha" content="([^"]*)"/;
  let buildId: string | null = null;
  let codeSha: string | null = null;
  for (const f of pages) {
    const text = readFileSync(f, "utf-8");
    const rel = path.relative(DIST, f);
    const b = reBuild.exec(text);
    const s = reSha.exec(text);
    assert.ok(b, `${rel} carries no populus:build_id marker`);
    assert.ok(s, `${rel} carries no populus:code_sha marker`);
    assert.ok(b[1], `${rel} has an EMPTY build_id marker — an exact comparison would pass on ""`);
    assert.ok(s[1], `${rel} has an EMPTY code_sha marker`);
    buildId ??= b[1];
    codeSha ??= s[1];
    assert.equal(b[1], buildId, `${rel} disagrees with the rest of the dist about build_id`);
    assert.equal(s[1], codeSha, `${rel} disagrees with the rest of the dist about code_sha`);
  }
  assert.match(buildId!, /^\d{8}\.\d+$/, "the marker carries a real build id");
});

test("no page renders a digest the site cannot know (Locked #6 / R19)", () => {
  // The manifest is re-assembled AFTER this build, so any 64-hex digest on a
  // page is stale by construction — footer, methodology command, anywhere.
  const hex64 = /[0-9a-f]{64}/;
  for (const f of walkFiles(DIST, [".html"])) {
    const text = readFileSync(f, "utf-8");
    assert.ok(
      !hex64.test(text),
      `${path.relative(DIST, f)} renders a 64-hex digest — the site cannot know one`,
    );
    assert.ok(
      !text.includes("--manifest sha256:"),
      `${path.relative(DIST, f)} tells readers a verify command carrying a stale digest`,
    );
  }
});

/* ---------- dist hygiene ---------- */

function walkFiles(dir: string, exts: string[]): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walkFiles(p, exts));
    else if (exts.some((e) => name.endsWith(e))) out.push(p);
  }
  return out;
}

test("dist hygiene: no absolute build paths, no secret shapes, no env leakage", () => {
  const files = walkFiles(DIST, [".html", ".js", ".json"]);
  assert.ok(files.length > 1000, "the full dist is under test");
  const secretShapes = [/AKIA[0-9A-Z]{16}/, /BEGIN [A-Z]* ?PRIVATE KEY/, /ghp_[A-Za-z0-9]{30,}/];
  for (const f of files) {
    const text = readFileSync(f, "utf-8");
    assert.ok(
      !text.includes("/Users/") && !text.includes("/home/"),
      `${path.relative(DIST, f)} leaks an absolute build-machine path`,
    );
    for (const shape of secretShapes) {
      assert.ok(!shape.test(text), `${path.relative(DIST, f)} matches a secret shape ${shape}`);
    }
  }
});

test("production dist has NO institutional fixture routes (Locked #19 leakage check)", () => {
  // The dev build publishes no inst module, so a filers/holders page in the
  // production dist could only have come from fixture contamination.
  assert.ok(!existsSync(path.join(DIST, "institutional", "filers")), "no filer pages leak");
  assert.ok(!existsSync(path.join(DIST, "institutional", "tickers")), "no holders pages leak");
  const instIndex = readFileSync(path.join(DIST, "institutional", "index.html"), "utf-8");
  assert.ok(
    instIndex.includes("withheld the institutional module — deliberately"),
    "/institutional renders the S1 absence state under the dev build",
  );
});

test("S3 stays live on the feed (verify-only per R10)", () => {
  const feed = readFileSync(path.join(DIST, "congress", "index.html"), "utf-8");
  assert.ok(feed.includes("No disclosures match — and that's an answer, not an error."));
  assert.ok(feed.includes("feed-empty"));
});
