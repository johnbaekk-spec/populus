/* signals-v4 (T1.1, R23; M1's share of R5 and R8) — on the BUILT site.

   T1.1, the byte guard: `signals.v1.json` and every
   `institutional/data/notable-moves/<period>.v1.json` are byte-identical to
   the T0 baseline's for the same inputs, and the dist route set (every file
   outside `_astro/`) equals T0's. The baseline is the block between the
   `t0-baseline` markers in docs/frontend/signals-v4.md §Baseline (sha256 of
   each artifact; the sorted route list's count and sha256), recorded from
   the T0 run on clean `main`. It applies to the inputs it was measured on: a
   dist built from another data build states that and compares nothing.

   M1 on the page: every triage row renders once; the hits body holds
   min(lines, SIGNAL_HITS_DOM_ROWS) lines, the first ten visible and the rest
   `hidden`; the pane switch is server-hidden with every pane visible. */

import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const DIST = path.resolve(import.meta.dirname, "../../dist");
const DOC = path.resolve(import.meta.dirname, "../../../docs/frontend/signals-v4.md");

interface Baseline {
  buildId: string;
  routes: { count: number; sha256: string };
  artifacts: Map<string, string>;
}

/** The T0 block in signals-v4.md: `build_id`, `dist_routes`, then
    `sha256  path` lines, between the markers. */
export function parseBaseline(doc: string): Baseline {
  const m = /<!-- t0-baseline:begin -->([\s\S]*?)<!-- t0-baseline:end -->/.exec(doc);
  if (!m) throw new Error("signals-v4.md carries no t0-baseline block");
  const body = m[1]!;
  const buildId = /^build_id: (\S+)$/m.exec(body)?.[1];
  const routes = /^dist_routes: (\d+) files, sha256 ([0-9a-f]{64})$/m.exec(body);
  const artifacts = new Map([...body.matchAll(/^([0-9a-f]{64})\s{2}(\S+)$/gm)].map((x) => [x[2]!, x[1]!]));
  if (!buildId || !routes || artifacts.size === 0) throw new Error("the t0-baseline block is incomplete");
  return { buildId, routes: { count: Number(routes[1]), sha256: routes[2]! }, artifacts };
}

const sha = (buf: Buffer | string): string => createHash("sha256").update(buf).digest("hex");

/** Every file outside `_astro/`, as `./rel/path`, sorted — T0's `dist-files.txt` form. */
function routeList(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string, rel: string): void => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) {
        if (r === "_astro") continue;
        walk(path.join(dir, e.name), r);
      } else out.push(`./${r}`);
    }
  };
  walk(root, "");
  return out.sort();
}

function builtId(): string | null {
  const page = path.join(DIST, "signals", "index.html");
  if (!existsSync(page)) return null;
  return /<meta name="populus:build_id" content="([^"]+)"/.exec(readFileSync(page, "utf-8"))?.[1] ?? null;
}

test("T1.1 controls: the baseline parser reads the block and refuses an incomplete one", () => {
  const ok = parseBaseline(
    "x <!-- t0-baseline:begin -->\nbuild_id: 1\ndist_routes: 3 files, sha256 " + "a".repeat(64) + "\n" + "b".repeat(64) + "  signals/data/signals.v1.json\n<!-- t0-baseline:end -->",
  );
  assert.deepEqual([ok.buildId, ok.routes.count, ok.artifacts.get("signals/data/signals.v1.json")], ["1", 3, "b".repeat(64)]);
  assert.throws(() => parseBaseline("<!-- t0-baseline:begin -->\nbuild_id: 1\n<!-- t0-baseline:end -->"), /incomplete/);
  assert.throws(() => parseBaseline("no block"), /no t0-baseline block/);
});

test("T1.1 (R23): signals.v1.json and every notable-moves shard are byte-identical to T0's, and the dist route set equals T0's apart from _astro chunks", (t) => {
  assert.ok(existsSync(DIST), "dist/ must exist — this suite runs post-build");
  const base = parseBaseline(readFileSync(DOC, "utf-8"));
  const id = builtId();
  if (id !== base.buildId) {
    t.skip(`this dist was built from data build ${id ?? "(none)"}; the T0 baseline was measured on ${base.buildId}, so its bytes do not apply`);
    return;
  }
  const shards = readdirSync(path.join(DIST, "institutional", "data", "notable-moves")).filter((f) => f.endsWith(".v1.json")).map((f) => `institutional/data/notable-moves/${f}`);
  assert.deepEqual(
    [...base.artifacts.keys()].sort(),
    ["signals/data/signals.v1.json", ...shards].sort(),
    "the same artifact files as T0: no shard added or lost",
  );
  for (const [rel, want] of base.artifacts) {
    assert.equal(sha(readFileSync(path.join(DIST, rel))), want, `${rel} is byte-identical to T0`);
  }
  const routes = routeList(DIST);
  const listed = routes.join("\n") + "\n";
  assert.equal(routes.length, base.routes.count, "no route or public file added or removed");
  assert.equal(sha(listed), base.routes.sha256, "the route set is T0's, file for file");
});

test("signals-v4 M1 on the built page: every triage row once; the hits body holds min(lines, 40) lines with the first ten visible; the pane switch is server-hidden and every pane visible", () => {
  const html = readFileSync(path.join(DIST, "signals", "index.html"), "utf-8");
  const ranked = /of ([\d,]+) rows ranked/.exec(html);
  assert.ok(ranked, "the Stand out figure states the rows ranked");
  const rows = [...html.matchAll(/<article class="si-row" id="(si-row-[^"]+)"/g)].map((m) => m[1]!);
  assert.equal(rows.length, Number(ranked[1]!.replace(/,/g, "")), "every row renders exactly once");
  assert.equal(new Set(rows).size, rows.length, "row ids are unique");
  const hits = /<section class="panel si-hits" id="hits"[^>]*data-shown="(\d+)"[^>]*data-lines="(\d+)"[^>]*data-dom-rows="(\d+)"/.exec(html);
  assert.ok(hits, "the hits section states shown, lines and DOM rows");
  const [shown, lines, domRows] = [Number(hits[1]), Number(hits[2]), Number(hits[3])];
  const body = /<tbody id="signal-hits-body">([\s\S]*?)<\/tbody>/.exec(html)![1]!;
  const trs = [...body.matchAll(/<tr class="si-hit[^"]*"[^>]*>/g)].map((m) => m[0]);
  assert.equal(trs.length, Math.min(lines, domRows));
  assert.equal(trs.filter((x) => !/ hidden>$/.test(x)).length, Math.min(shown, lines), "the first ten visible");
  assert.ok(trs.slice(shown).every((x) => / hidden>$/.test(x)), "the rest hidden");
  assert.match(html, /<div class="seg pane-switch" role="group" aria-label="Show" data-pane-switch hidden>/);
  assert.doesNotMatch(html, /<section class="panel si-triage" id="triage"[^>]*\shidden/);
  assert.doesNotMatch(html, /<div class="si-side" id="signals-side"[^>]*\shidden/);
  // every row's receipt sits outside its summary
  for (const m of html.matchAll(/<summary class="si-row-sum">([\s\S]*?)<\/summary>/g)) assert.doesNotMatch(m[1]!, /<a\s|<button\s/, "no control in a row's summary");
});
