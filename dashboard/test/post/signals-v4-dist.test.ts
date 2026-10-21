/* signals-v4 (T1.1, R23; M1's share of R5 and R8) — on the BUILT site.

   T1.1, the byte guard: `signals.v1.json` and every
   `institutional/data/notable-moves/<period>.v1.json` are byte-identical to
   the T0 baseline's for the same inputs, and the dist route set (every file
   outside `_astro/`) equals T0's. The baseline is the block between the
   `t0-baseline` markers in docs/frontend/signals-v4.md §Baseline (sha256 of
   each artifact; the sorted route list's count and sha256), recorded from
   the T0 run on clean `main`. It applies to the inputs it was measured on: a
   dist built from another data build states that and compares nothing.

   M1 on the page: every triage row renders once; the page carries
   min(lines, SIGNAL_HITS_DOM_ROWS) hit lines — launch M7a (D5): the first
   ten in the DOM, visible, the rest in the JSON island; the Named moves'
   rows are counted across the DOM and their island; the pane switch is
   server-hidden with every pane visible. */

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

/** launch M7a (D5, LD27): a held list's island on the built page, parsed. */
function heldIsland<T>(html: string, listId: string): T | null {
  const m = new RegExp(`<script type="application/json" data-held-for="${listId}">([\\s\\S]*?)</script>`).exec(html);
  return m ? (JSON.parse(m[1]!) as T) : null;
}

test("signals-v4 M1 + launch M7a on the built page: every triage row once; the page carries min(lines, 40) hit lines — the first ten in the DOM, visible, the rest in the island; the pane switch is server-hidden and every pane visible", () => {
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
  assert.equal(trs.length, Math.min(lines, shown), "the first ten lines are in the DOM");
  assert.ok(trs.every((x) => !/ hidden>$/.test(x)), "and visible");
  const held = heldIsland<{ lines: unknown[] }>(html, "signal-hits-body");
  assert.equal(trs.length + (held?.lines.length ?? 0), Math.min(lines, domRows), "with the island, the page carries min(lines, 40) lines");
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

/** The rendered Named moves rows: anchor, kind, name key and the Congress cell's visible text.
    The attribute is decoded with `&amp;` LAST, so an escaped "&amp;quot;" never double-decodes. */
function renderedMoves(html: string): { id: string; kind: string; ikey: string; cg: string; tk: string | null }[] {
  const out: { id: string; kind: string; ikey: string; cg: string; tk: string | null }[] = [];
  /* launch M7a (D5, LD27): the rows past the first fifteen ship in the island; they count too */
  type IslandRow = { id: string; kind: string; ikey: string; ticker: string | null; cell: { absent: string } | { side: "buy" | "sell"; n: number } };
  for (const r of heldIsland<{ rows: IslandRow[] }>(html, "mv-list")?.rows ?? []) {
    out.push({ id: r.id, kind: r.kind, ikey: r.ikey, cg: "absent" in r.cell ? "—" : `${r.cell.side === "buy" ? "▲" : "▼"}${r.cell.n}`, tk: r.ticker });
  }
  for (const a of html.matchAll(/<article class="mv-item" id="([^"]+)" data-kind="([^"]+)" data-type="[^"]*" data-ikey="([^"]*)"[^>]*>([\s\S]*?)<\/article>/g)) {
    const cg = /<span class="mv-cg">(?:<span class="cg-on" aria-hidden="true">([^<]*)<\/span>|<span aria-hidden="true">([^<]*)<\/span>)/.exec(a[4]!);
    const tk = /<span class="mv-tk"><span class="mono-ticker">([^<]+)<\/span>/.exec(a[4]!)?.[1] ?? null;
    out.push({ id: a[1]!, kind: a[2]!, ikey: a[3]!.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&"), cg: cg?.[1] ?? cg?.[2] ?? "?", tk });
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
  assert.equal(new Set(rows.map((r) => r.id)).size, rows.length, "every carried move row once, across the DOM and the island");
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

test("signals-v4 T2.9 (LD11): dist/signals/index.html stays within the 2 MiB budget", (t) => {
  const page = path.join(DIST, "signals", "index.html");
  assert.ok(existsSync(page));
  const bytes = readFileSync(page).length;
  t.diagnostic(`dist/signals/index.html: ${bytes} bytes of ${SIGNALS_PAGE_BYTES}`);
  assert.ok(bytes <= SIGNALS_PAGE_BYTES, `${bytes} B exceeds the ${SIGNALS_PAGE_BYTES} B budget`);
  assert.equal(SIGNALS_PAGE_BYTES, 2_097_152);
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

/* ======================================================================
   signals-v4 M3 (T3.7; R18, R20, R22, R23; success criteria 6 and 7) — the
   Overlap tab recomputed independently from the build's rows in both
   variants, the playbook counts against the rows' tokens, the roster on
   Methodology. On the owner-tier build (no notable manager typed) Overlap is
   its stated absence and the recount checks that; the populated tab is
   exercised on the fixture in unit and geometry tests.
   ====================================================================== */

import { getOverlap, getPlaybookTriggers, getTriage } from "../../src/lib/data.ts";
import { ROSTER } from "../../src/lib/leadership-roster.ts";
import { independentOverlap } from "../lib/overlap-recount.ts";

test("signals-v4 T3.7 (R18, criterion 6): the built Overlap — every carried row and both variants' counts equal an independent recount; or, with no 13F change in the build, its absence is stated", (t) => {
  const html = readFileSync(path.join(DIST, "signals", "index.html"), "utf-8");
  const panel = /<section class="tk-panel sig-panel" role="tabpanel" id="overlap" aria-labelledby="tab-overlap">([\s\S]*?)<\/section><section class="tk-panel sig-panel" role="tabpanel" id="playbooks"/.exec(html)?.[1];
  assert.ok(panel !== undefined, "the built page carries the Overlap panel");
  const o = getOverlap();
  const model = getSignalsInstitutional();
  const build = getBuildData();
  if (o.period === null || o.all.length === 0) {
    assert.match(panel, /No Overlap: |No name in Q\d \d{4} has both a member of Congress's listed-stock line and a notable manager's change/, "the absence is stated");
    assert.doesNotMatch(panel, /<article class="ov-item"/);
    t.diagnostic(`Overlap: ${o.period === null ? "no quarter" : `quarter ${o.period}, 0 names`} — ${o.absent ?? "no name on both sides"}`);
    return;
  }
  const want = independentOverlap(build.txns, model.moves, o.period);
  assert.deepEqual(o.core.map((r) => `${r.ticker}:${r.rel}`), want.core, "core: the recount");
  assert.deepEqual(o.all.map((r) => `${r.ticker}:${r.rel}`), want.all, "all: the recount");
  const n = (re: RegExp): string => re.exec(panel)?.[1] ?? "";
  assert.equal(n(/data-ov-n="([^"]+)"/), `${want.core.length} ${want.all.length}`);
  for (const rel of ["same", "opposite"] as const) {
    const attr = rel === "same" ? "data-ov-same" : "data-ov-opp";
    assert.equal(n(new RegExp(`${attr}="([^"]+)"`)), `${want.core.filter((x) => x.endsWith(`:${rel}`)).length} ${want.all.filter((x) => x.endsWith(`:${rel}`)).length}`, rel);
  }
  const items = [...panel.matchAll(/<article class="ov-item" id="([^"]+)" data-core="([^"]*)" data-all="([^"]*)" data-oc="([^"]*)" data-oa="([^"]*)"/g)];
  for (const it of items) {
    const oa = Number(it[5]);
    assert.equal(`${want.all[oa]!.split(":")[1]}`, it[3], `${it[1]}: its broad-inclusive relation`);
    if (it[4] !== "") assert.equal(want.core[Number(it[4])]!.split(":")[1], it[2], `${it[1]}: its relation`);
  }
  t.diagnostic(`Overlap ${o.period}: core ${want.core.length}, all ${want.all.length}, carried ${items.length}`);
});

test("signals-v4 T3.7 (R20, R21, criterion 7): the Playbooks filter's counts equal the built rows carrying each token, and the triggers recomputed", (t) => {
  const html = readFileSync(path.join(DIST, "signals", "index.html"), "utf-8");
  const tokens = [...html.matchAll(/<article class="si-row" id="[^"]+"[^>]*?(?: data-pb="([^"]+)")?>/g)].map((m) => (m[1] ?? "").split(" ").filter(Boolean));
  const triage = getTriage();
  assert.equal(tokens.length, triage.rows.length, "every triage row, once");
  const trig = getPlaybookTriggers();
  for (const id of ["opp-buy", "leader", "cmte"] as const) {
    const carried = tokens.filter((x) => x.includes(id)).length;
    assert.equal(carried, trig.counts[id], `${id}: the rows carrying it are the triggers' count`);
    const chip = new RegExp(`<button type="button" class="si-pb-pick" data-pb-filter="${id}" aria-pressed="false"[^>]*>[^<]*<span class="tk-tab-n">([^<]+)</span>`).exec(html)?.[1];
    assert.ok(chip !== undefined, `${id}: its filter chip`);
    assert.equal(chip, id === "cmte" && !trig.cmteAvailable ? "unavailable this build" : String(carried), `${id}: the chip's count`);
  }
  const cls: Record<string, number> = {};
  for (const r of trig.cmp.values()) cls[r.cls] = (cls[r.cls] ?? 0) + 1;
  t.diagnostic(`triggers: opp-buy ${trig.counts["opp-buy"]}, leader ${trig.counts.leader}, cmte ${trig.counts.cmte}${trig.cmteAvailable ? "" : " (unavailable)"}; CMP over ${trig.cmp.size} rows: ${JSON.stringify(cls)}; rows ${triage.rows.length}`);
});

test("signals-v4 T3.7 (R22): Methodology carries the roster — every tenure with its source and checked date", () => {
  const html = readFileSync(path.join(DIST, "methodology", "index.html"), "utf-8");
  const sec = /<section class="si-method" id="signals-playbooks"[\s\S]*?<\/section>/.exec(html)?.[0];
  assert.ok(sec, "#signals-playbooks");
  const rows = [...sec.matchAll(/<tr><td class="c-secondary">[\s\S]*?<\/tr>/g)].map((m) => m[0]);
  assert.equal(rows.length, ROSTER.length);
  ROSTER.forEach((r, i) => {
    assert.ok(rows[i]!.includes(r.bioguide) && rows[i]!.includes(`href="${r.source}"`) && rows[i]!.includes(`checked ${r.checked}`), `${r.name}`);
  });
  assert.ok(/id="signals-overlap"/.test(html), "#signals-overlap");
});

/* codex M3 round 1, F2 (R9 / LD8, R24) on the BUILT site, in whatever data
   state the build is in: every in-page link on /signals/ reaches an id the
   page carries; every /methodology/#… link from it reaches an id Methodology
   carries; and the in-page links of Methodology's two M3 sections reach
   theirs. The unit test (`signals-anchors.test.ts`) walks the other states. */
test("signals-v4 codex M3 r1 F2: every in-page and Methodology anchor the built /signals/ links exists; so do the M3 Methodology sections' in-page links", () => {
  const ids = (html: string): Set<string> => new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]!));
  const sig = readFileSync(path.join(DIST, "signals", "index.html"), "utf-8");
  const met = readFileSync(path.join(DIST, "methodology", "index.html"), "utf-8");
  const sigIds = ids(sig);
  const metIds = ids(met);
  const inPage = [...new Set([...sig.matchAll(/\shref="#([^"]*)"/g)].map((m) => m[1]!))];
  assert.ok(inPage.length >= 4, "precondition: the page links in-page");
  assert.deepEqual(inPage.filter((id) => !sigIds.has(id)), [], "in-page targets on /signals/");
  const toMet = [...new Set([...sig.matchAll(/\shref="\/methodology\/#([^"]+)"/g)].map((m) => m[1]!))];
  assert.ok(toMet.length > 0, "precondition: /signals/ links Methodology");
  assert.deepEqual(toMet.filter((id) => !metIds.has(id)), [], "Methodology targets from /signals/");
  for (const sec of ["signals-overlap", "signals-playbooks"]) {
    const body = new RegExp(`<section class="si-method" id="${sec}"[\\s\\S]*?</section>`).exec(met)?.[0];
    assert.ok(body, `#${sec}`);
    const dangling = [...body.matchAll(/\shref="#([^"]*)"/g)].map((m) => m[1]!).filter((id) => !metIds.has(id));
    assert.deepEqual(dangling, [], `#${sec}: its in-page links`);
  }
  // control: the check reads ids, not hrefs
  assert.equal(ids(`<a href="#x">`).has("x"), false);
});
