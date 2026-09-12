/* Post-build suite — the PACKAGING seam, run locally instead of 2.6 hours into
   `publish.yml`.

   Why this file exists. Milestone 1 of the 20260910 refinement shipped a
   Cloudflare `_redirects` file to retire ~3,850 stub pages. Every local gate
   was green, because `populus snapshot-site` — the step that builds the §12.1
   upload envelope and self-validates it as an exact inventory v2 — ran ONLY
   inside publish. The dispatched run reached step 23 after 2h39m and refused
   the tree:

     '_redirects' is a prohibited Cloudflare Pages provider control; this
     deployment ships exactly one control, the root '_headers'

   Nothing deployed. The rule was never in doubt (`FORBIDDEN_CONTROL_PATHS`,
   `src/populus/publish/inventory.py`); the gap was that nothing local ever
   asked it about the real `dist/`.

   So this gate invokes the REAL code path — the same `populus snapshot-site`
   CLI publish runs — rather than restating its rules in TypeScript. A
   reimplementation would be a second, drifting copy of the exact thing that
   went undetected. Both tests write to a fresh mkdtemp and never into `dist/`.

   The second test is the killing mutant for the first: without it, a
   `snapshot-site` that could not fail (a missing `uv`, a silently skipped
   walk) would read as a pass. It plants `_redirects` in a three-file synthetic
   tree and requires the refusal, by message. */

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const DASH = path.resolve(import.meta.dirname, "..", "..");
const REPO_ROOT = path.resolve(DASH, "..");
const DIST = path.join(DASH, "dist");

/** Run `populus snapshot-site` over *source*. Returns the exit status and the
    combined output, never throwing — a refusal is the subject under test, not
    an accident. */
function snapshotSite(source: string): { code: number; output: string } {
  const dest = path.join(mkdtempSync(path.join(tmpdir(), "populus-envelope-")), "envelope");
  try {
    const output = execFileSync(
      "uv",
      ["run", "populus", "snapshot-site", "--source", source, "--dest", dest],
      { cwd: REPO_ROOT, encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] },
    );
    const inventory = path.join(dest, "inventory.json");
    assert.ok(existsSync(inventory), "the envelope carries a sibling inventory.json");
    return { code: 0, output: output + readFileSync(inventory, "utf-8") };
  } catch (err) {
    const e = err as { status?: number; stdout?: string; stderr?: string; message?: string };
    return {
      code: typeof e.status === "number" ? e.status : 1,
      output: `${e.stdout ?? ""}${e.stderr ?? ""}${e.stdout || e.stderr ? "" : (e.message ?? "")}`,
    };
  } finally {
    rmSync(path.dirname(dest), { recursive: true, force: true });
  }
}

test("POST-BUILD packaging: dist/ freezes into an exact inventory v2 with the one '_headers' control", () => {
  assert.ok(existsSync(DIST), "dist/ must exist — this suite runs post-build");
  const { code, output } = snapshotSite(DIST);
  assert.equal(code, 0, `populus snapshot-site refused the built tree:\n${output}`);

  // The inventory is appended to `output` on success; assert the shape publish
  // depends on, so an inexact envelope fails here rather than at step 23.
  const doc = JSON.parse(output.slice(output.indexOf("{")));
  assert.equal(doc.inventory_version, "2");
  assert.deepEqual(
    doc.controls.map((c: { path: string }) => c.path),
    ["_headers"],
    "exactly one provider control ships, the root '_headers'",
  );
  const served = new Set(doc.files.map((f: { path: string }) => f.path));
  for (const forbidden of ["_redirects", "_worker.js"]) {
    assert.ok(!served.has(forbidden), `${forbidden} must not appear under 'files'`);
  }
  assert.ok(
    ![...served].some((p) => (p as string).startsWith("functions/")),
    "no Cloudflare Pages Functions artifact ships",
  );
});

test("POST-BUILD packaging: the gate REFUSES a planted provider control", () => {
  for (const forbidden of ["_redirects", "_worker.js", "functions/api.js"]) {
    const tree = mkdtempSync(path.join(tmpdir(), "populus-planted-"));
    try {
      writeFileSync(path.join(tree, "_headers"), "/*\n  X-Frame-Options: DENY\n");
      writeFileSync(path.join(tree, "index.html"), "<!doctype html><title>t</title>\n");
      mkdirSync(path.dirname(path.join(tree, forbidden)), { recursive: true });
      writeFileSync(path.join(tree, forbidden), "/a /b 301\n");

      const { code, output } = snapshotSite(tree);
      assert.notEqual(code, 0, `a planted ${forbidden} was accepted:\n${output}`);
      assert.match(output, new RegExp(`'${forbidden.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}'`));
      assert.match(output, /prohibited Cloudflare Pages provider control|Functions artifact/);
    } finally {
      rmSync(tree, { recursive: true, force: true });
    }
  }
});
