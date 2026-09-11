/* Refinement 20260910 — post-build checks over the REAL dist bytes (M1).

   R2: every `/institutional/tickers/…` href in dist resolves to a built file.
   R1: on the filer page for CIK 1067983 (when built) every Position-changes
       row leads with an issuer name and no first cell is a bare `sid:` key —
       asserted only when the serving artifact the build read carries the R1
       display relation, so a baseline-artifact (rollback) build is not blamed
       for names it could not have.
   R8: no visible add/trim chip sits on a row whose Δ shares is exactly 0.
   R9: no issuer label on the institutional landing's cluster / consensus
       board starts with a digit or is a 9-character CUSIP-shaped token. */

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { resolveServingDbPath } from "../../src/lib/activity.ts";

const DIST = path.join(process.cwd(), "dist");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (name.endsWith(".html")) out.push(p);
  }
  return out;
}

function cells(html: string, cls: string): string[] {
  const out: string[] = [];
  const re = new RegExp(`<td class="${cls}[^"]*">([\\s\\S]*?)</td>`, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) out.push(m[1]!);
  return out;
}

const text = (s: string): string => s.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();

test("POST-BUILD R2: every /institutional/tickers/… href resolves to a built file", () => {
  assert.ok(existsSync(DIST), "dist/ must exist — this suite runs post-build");
  const hrefs = new Set<string>();
  for (const file of walk(DIST)) {
    const html = readFileSync(file, "utf-8");
    for (const m of html.matchAll(/href="(\/institutional\/tickers\/[^"#?]+)/g)) hrefs.add(m[1]!);
  }
  const dead = [...hrefs].filter((h) => {
    const rel = decodeURIComponent(h).replace(/^\//, "").replace(/\/$/, "");
    return !existsSync(path.join(DIST, rel, "index.html")) && !existsSync(path.join(DIST, rel));
  });
  assert.deepEqual(dead, [], `dead institutional ticker hrefs: ${dead.slice(0, 10).join(", ")}`);
});

test("POST-BUILD R1/R8: filer 1067983 changes rows are named, never a bare sid: cell; no add/trim with Δshares 0", () => {
  const page = path.join(DIST, "institutional", "filers", "1067983", "index.html");
  if (!existsSync(page)) {
    // The dev extract does not carry this filer; the real-data build does.
    return;
  }
  const html = readFileSync(page, "utf-8");
  const servingPath = resolveServingDbPath();
  let hasDisplay = false;
  if (servingPath && existsSync(servingPath)) {
    const db = new DatabaseSync(servingPath, { readOnly: true });
    try {
      hasDisplay =
        (db.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name='serving_position_display'`).get() as unknown) != null;
    } finally {
      db.close();
    }
  }
  const posCells = cells(html, "c-pos");
  assert.ok(posCells.length > 0, "the filer page renders Position-changes rows");
  if (hasDisplay) {
    const bare = posCells.filter((c) => /^<span class="mono-note">sid:/.test(c.trim()) || /^sid:/.test(text(c)));
    assert.equal(bare.length, 0, `${bare.length} bare sid: cells of ${posCells.length}`);
    const unnamed = posCells.filter((c) => !c.includes('class="filed-name"'));
    assert.equal(unnamed.length, 0, `${unnamed.length} unnamed change rows of ${posCells.length}`);
  }
  // R8 — over every change row on the page: an add/trim chip never sits on a
  // row whose Δ shares cell is exactly "0".
  const rows = html.match(/<tr>(?:(?!<\/tr>)[\s\S])*?qoq-chip qoq-(?:add|trim)[\s\S]*?<\/tr>/g) ?? [];
  const valueOnly = rows.filter((r) => {
    const nums = cells(r, "c-num").map(text);
    return nums[1] === "0";
  });
  assert.equal(valueOnly.length, 0, `${valueOnly.length} add/trim rows with Δ shares 0`);
});

test("POST-BUILD R9: no numeric or CUSIP-shaped issuer label on the institutional landing boards", () => {
  const page = path.join(DIST, "institutional", "index.html");
  if (!existsSync(page)) return;
  const html = readFileSync(page, "utf-8");
  const labels = [...cells(html, "c-issuer"), ...html.match(/class="tile-value">[^<]*/g)?.map((s) => s.slice(19)) ?? []].map(text);
  const bad = labels.filter((l) => /^\d/.test(l) || /^[A-Z0-9]{9}$/.test(l));
  assert.deepEqual(bad, [], `numeric / CUSIP-shaped issuer labels: ${bad.slice(0, 10).join(", ")}`);
});
