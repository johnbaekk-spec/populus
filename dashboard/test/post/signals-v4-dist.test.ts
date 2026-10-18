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

/* ======================================================================
   signals-v4 M2 (T2.9; R12, R13, R14, R23; success criteria 5 and 6) — the
   Institutional tab on the BUILT page, recomputed from the build's own rows
   by this test's own join (never congress-quarter.ts), and the page budget.
   ====================================================================== */

import { getBuildData, getSignalsInstitutional, notableMovesFor } from "../../src/lib/data.ts";
import { SIGNALS_PAGE_BYTES, moveNameKey } from "../../src/lib/notable-moves.ts";
import type { TxnRow } from "../../src/lib/format.ts";

/** LD10 restated independently: the members of Congress on `side` of
    `ticker` with a listed-stock line traded inside the quarter ending
    `period`, broad accounts (more than 25 names in the quarter) excluded. */
export function independentCongressCounts(txns: readonly TxnRow[], period: string): (ticker: string, side: "buy" | "sell") => number {
  const m = /^(\d{4})-(03-31|06-30|09-30|12-31)$/.exec(period);
  if (!m) return () => 0;
  const start = `${m[1]}-${{ "03-31": "01", "06-30": "04", "09-30": "07", "12-31": "10" }[m[2]!]}-01`;
  const norm = (t: string): string => t.trim().toUpperCase().replace(/\./g, "-");
  const sideOf = (s: TxnRow["side"]): "buy" | "sell" | null => (s === "purchase" ? "buy" : s === "sale" || s === "sale_partial" ? "sell" : null);
  const lines = txns.filter((t) => !t.flags.includes("date_anomaly") && t.traded !== null && t.traded >= start && t.traded <= period && (t.assetType === "ST" || t.assetType === "Stock") && !!t.ticker && sideOf(t.side) !== null);
  const who = (t: TxnRow): string => t.bioguide ?? `raw:${t.name}`;
  const breadth = new Map<string, Set<string>>();
  for (const t of lines) breadth.set(who(t), (breadth.get(who(t)) ?? new Set()).add(norm(t.ticker!)));
  const members = new Map<string, Set<string>>();
  for (const t of lines) {
    if (breadth.get(who(t))!.size > 25) continue;
    const k = `${norm(t.ticker!)}|${sideOf(t.side)}`;
    members.set(k, (members.get(k) ?? new Set()).add(who(t)));
  }
  return (ticker, side) => members.get(`${norm(ticker)}|${side}`)?.size ?? 0;
}

/** The rendered Named moves rows: anchor, kind, name key and the Congress cell's visible text. */
function renderedMoves(html: string): { id: string; kind: string; ikey: string; cg: string; tk: string | null }[] {
  const out: { id: string; kind: string; ikey: string; cg: string; tk: string | null }[] = [];
  for (const a of html.matchAll(/<article class="mv-item" id="([^"]+)" data-kind="([^"]+)" data-type="[^"]*" data-ikey="([^"]*)"[^>]*>([\s\S]*?)<\/article>/g)) {
    const cg = /<span class="mv-cg">(?:<span class="cg-on" aria-hidden="true">([^<]*)<\/span>|<span aria-hidden="true">([^<]*)<\/span>)/.exec(a[4]!);
    const tk = /<span class="mv-tk"><span class="mono-ticker">([^<]+)<\/span>/.exec(a[4]!)?.[1] ?? null;
    out.push({ id: a[1]!, kind: a[2]!, ikey: a[3]!.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'"), cg: cg?.[1] ?? cg?.[2] ?? "?", tk });
  }
  return out;
}

test("signals-v4 T2.9 (R12, R13, R14): the built Institutional tab — the Congress column recomputed independently on every move and Consensus row; every Consensus and card name lists all its in-build moves", (t) => {
  const page = path.join(DIST, "signals", "index.html");
  assert.ok(existsSync(page), "dist/signals/index.html exists");
  const html = readFileSync(page, "utf-8");
  const quarter = /<section class="tk-panel sig-panel" role="tabpanel" id="institutional" aria-labelledby="tab-institutional" data-quarter="([^"]*)">/.exec(html)?.[1];
  assert.ok(quarter !== undefined, "the Institutional panel states its quarter (data-quarter)");
  const build = getBuildData();
  const model = getSignalsInstitutional();
  assert.equal(quarter, model.period ?? "", "the built panel names the build's closed quarter");
  if (!build.inst.present || model.period === null) {
    assert.match(html, /not in this build|no closed quarter to read/, "the absence is stated");
    t.diagnostic("no 13F module or no closed quarter in this build: nothing to recompute");
    return;
  }
  const moves = notableMovesFor(build, model.period);
  const rows = renderedMoves(html);
  t.diagnostic(`in-build moves ${moves.length}; rendered rows ${rows.length}; notable managers ${model.notableManagers}`);
  if (moves.length === 0) {
    assert.equal(rows.length, 0);
    assert.match(html, /<section class="panel sig-moves" id="named-moves" aria-labelledby="named-moves-h" data-empty-state>/, "the Named moves state their zero");
    assert.match(html, /Zero is the computed answer/);
    t.diagnostic("this build's registry marks no notable manager: the Named moves are the stated zero");
  }
  const count = independentCongressCounts(build.txns, model.period);
  let nonZero = 0;
  const byKey = new Map(moves.map((m) => [m, moveNameKey(m)]));
  for (const r of rows) {
    if (!r.tk) {
      assert.equal(r.cg, "—", `${r.id}: no ticker, no count`);
      continue;
    }
    const n = count(r.tk, r.kind === "new" || r.kind === "add" ? "buy" : "sell");
    assert.equal(r.cg, n > 0 ? `${r.kind === "new" || r.kind === "add" ? "▲" : "▼"}${n}` : "—", `${r.id} ${r.tk} ${r.kind}`);
    if (n > 0) nonZero++;
  }
  // Consensus rows: both sides
  let csNonZero = 0;
  for (const c of html.matchAll(/<div class="cs-row" data-ikey="([^"]+)"[^>]*>[\s\S]*?<span class="cs-tk mono-ticker"[^>]*>([^<]*)<\/span>[\s\S]*?<span class="cs-cg">(?:<span class="cg-on" aria-hidden="true">([^<]*)<\/span>|<span aria-hidden="true">([^<]*)<\/span>)/g)) {
    const tk = c[2]!;
    const cell = c[3] ?? c[4] ?? "?";
    if (tk === "—") {
      assert.equal(cell, "—");
      continue;
    }
    const b = count(tk, "buy");
    const s = count(tk, "sell");
    const want = b + s === 0 ? "—" : `${b > 0 ? `▲${b}` : ""}${b > 0 && s > 0 ? " " : ""}${s > 0 ? `▼${s}` : ""}`;
    assert.equal(cell, want, `Consensus ${tk}`);
    if (b + s > 0) csNonZero++;
  }
  t.diagnostic(`Congress column non-zero: ${nonZero} of ${rows.length} move rows; ${csNonZero} Consensus rows`);
  // success criterion 5: every Consensus and card name lists every in-build move on it
  const names = new Set<string>([...html.matchAll(/<button type="button" class="cs-pick" data-mv-name="([^"]+)"/g)].map((m) => m[1]!));
  for (const m of html.matchAll(/<a class="si-card-open" href="#named-moves" data-mv-name="([^"]+)"/g)) names.add(m[1]!);
  for (const key of names) {
    const want = moves.filter((m) => byKey.get(m) === key).length;
    assert.equal(rows.filter((r) => r.ikey === key).length, want, `${key}: every in-build move is on the page`);
    assert.ok(want > 0, `${key}: a name with moves`);
  }
  // the receipt never sits in a move's summary
  for (const s of html.matchAll(/<summary class="mv-sum">([\s\S]*?)<\/summary>/g)) assert.doesNotMatch(s[1]!, /<a\s|<button\s/, "no control in a move's summary");
});

test("signals-v4 T2.9 (LD11): dist/signals/index.html stays within the 1.5 MiB budget", (t) => {
  const page = path.join(DIST, "signals", "index.html");
  assert.ok(existsSync(page));
  const bytes = readFileSync(page).length;
  t.diagnostic(`dist/signals/index.html: ${bytes} bytes of ${SIGNALS_PAGE_BYTES}`);
  assert.ok(bytes <= SIGNALS_PAGE_BYTES, `${bytes} B exceeds the ${SIGNALS_PAGE_BYTES} B budget`);
  assert.equal(SIGNALS_PAGE_BYTES, 1_572_864);
});

test("signals-v4 T2.9 controls: the independent recount reads the quarter, listed stock, the sides and the broad rule", () => {
  const row = (over: Partial<TxnRow>): TxnRow => ({
    kind: "txn", txnId: "t", asset: "A", assetType: "ST", filed: "2026-04-10", traded: "2026-02-10", name: "M", bioguide: "M1", party: "D", state: "CA", district: null,
    chamber: "house", ticker: "NVDA", side: "purchase", owner: null, low: 1, high: 2, lag: 1, late: 0, flags: [], doc: "https://x", exchangedTicker: null, ...over,
  });
  const c = independentCongressCounts([row({}), row({ bioguide: "M2", side: "sale_partial", ticker: "nvda" }), row({ bioguide: "M3", traded: "2026-04-01" }), row({ bioguide: "M4", assetType: "OP" })], "2026-03-31");
  assert.deepEqual([c("NVDA", "buy"), c("NVDA", "sell")], [1, 1]);
  const broad = [...Array.from({ length: 26 }, (_, i) => row({ bioguide: "B", ticker: i === 0 ? "NVDA" : `X${i}` })), row({})];
  assert.equal(independentCongressCounts(broad, "2026-03-31")("NVDA", "buy"), 1, "the 26-name member is not counted");
  assert.equal(independentCongressCounts([row({})], "2026-02-28")("NVDA", "buy"), 0, "no calendar quarter, no join");
});
