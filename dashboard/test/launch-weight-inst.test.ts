/* Launch redesign M7b (R32, R33, R34): the /institutional/ weight, the holders
   lists held past 25, and the Methodology fold. Named apart from M4a's
   `launch-weight.test.ts` (built in parallel) so the two land without an
   add/add conflict; the integrator may fold them into one file.

   Every property here has a re-planted control: a test that only ever sees a
   passing input cannot tell a working mechanism from a missing one. */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import { installDom, toggleDetails, type MiniElement } from "./lib/mini-dom.ts";
import {
  directoryColumns,
  expandDirectoryRow,
  instIndexRowHtml,
  planDirectoryShards,
  parseDirectoryShard,
  parseDirectoryShardList,
  slimDirectoryRow,
  INST_DIRECTORY_SHARDS_MAX,
  type InstIndexRow,
} from "../src/lib/inst-index.ts";
import { fillShardsByBytes } from "../src/lib/shards.ts";
import { filerHref } from "../src/lib/holdings.ts";
import {
  HOLDERS_PAGE_HELD,
  HOLDERS_VISIBLE,
  holdersPageRowHtml,
  tickerHoldersBody,
  type HoldersPageRow,
} from "../src/lib/ui/institutional.ts";
import { TICKER_HOLDER_HELD, tickerInstSectionHtml } from "../src/lib/ui/ticker.ts";
import { heldCountText, heldStepLabel, initDomDisclosures, registerHeldRows } from "../src/scripts/inst-index-client.ts";
import type { TickerHolderRow, TickerTotalsRow } from "../src/lib/inst.ts";

const SRC = path.resolve(import.meta.dirname, "..", "src");

/* ------------------------------------------------ R32: the directory shards */

function dirRow(i: number, over: Partial<InstIndexRow> = {}): InstIndexRow {
  return {
    reference: true,
    cik: String(1_000_000 + i).padStart(10, "0"),
    name: `FILER ${i} <&> "LLC"`,
    period: "2026-03-31",
    value: i % 7 === 0 ? null : 1_000_000_000 - i,
    positions: i % 7 === 0 ? null : 40 + (i % 5),
    nullValuePositions: i % 7 === 0 ? null : i % 11 === 0 ? 3 : 0,
    hhi: i % 7 === 0 || i % 11 === 0 || i % 13 === 0 ? null : 900 + i,
    hhiNote: "",
    tier: i % 2 === 0 ? "top" : "tail",
    typing: i % 3 === 0 ? { cik: String(1_000_000 + i).padStart(10, "0"), display_name: `Fund ${i}`, person: i % 6 === 0 ? `Person ${i}` : null, manager_type: "hedge_fund", notable: i % 9 === 0 } : null,
    changeHtml: i % 4 === 0 ? `<span class="none">—</span>` : `<span class="qoq-chip k-add">ADD</span> <span class="filed-name">ISSUER ${i}</span> <span class="c-buy">$1.2M</span>`,
    ...over,
  } as InstIndexRow;
}
/** The HHI note exactly as `buildInstIndexRow` derives it, set on the fixture
    so the round trip is compared against a well-formed row. */
function withNote(r: InstIndexRow): InstIndexRow {
  const note =
    r.positions === null
      ? "no concentration row for this filer's latest period"
      : (r.nullValuePositions ?? 0) > 0
        ? `${r.nullValuePositions} of ${r.positions} positions carry a NULL value — HHI over a partial denominator is not comparable and is withheld`
        : r.hhi === null
          ? "concentration_unavailable: the producer stores NULL, never a fabricated 0"
          : "";
  return { ...r, hhiNote: note };
}
const DIR = Array.from({ length: 60 }, (_, i) => withNote(dirRow(i + 1)));
const href = (r: InstIndexRow): string => filerHref(r.cik, r.tier);

test("R32: a slim directory row renders byte-identically to the full row it came from (both column sets)", () => {
  for (const top5 of [false, true]) {
    const rows = DIR.map((r, i) => (top5 ? { ...r, top5Share: i % 5 === 0 ? null : 1234 + i } : r));
    const cols = directoryColumns(rows, top5 ? 5 : 25).columns;
    for (const r of rows) {
      const back = expandDirectoryRow(JSON.parse(JSON.stringify(slimDirectoryRow(r))));
      assert.equal(instIndexRowHtml(back, href, cols), instIndexRowHtml(r, href, cols), `${r.cik} (top5 ${top5})`);
    }
  }
  // control: a slim row that dropped a rendered field no longer matches
  const r = DIR[2]!;
  const broken = slimDirectoryRow(r);
  broken[9] = "";
  assert.notEqual(instIndexRowHtml(expandDirectoryRow(broken), href, null), instIndexRowHtml(r, href, null), "control: the change cell is load-bearing");
});

test("R32: the family respects the 1 MiB ceiling and the 8-shard maximum, never truncates, and its list and envelopes agree", () => {
  const fam = planDirectoryShards(DIR, fillShardsByBytes, { ceilingBytes: 4_000, shardLimit: 8 });
  assert.ok(fam.shards.length > 1 && fam.shards.length <= 8, `${fam.shards.length} shards`);
  for (const s of fam.shards) assert.ok(Buffer.byteLength(s.body) <= 4_000, `shard ${s.name} is ${Buffer.byteLength(s.body)} B`);
  const list = parseDirectoryShardList(fam.listJson)!;
  assert.deepEqual(list.shards, fam.shards.map((_, i) => `/institutional/data/directory/${i}.v1.json`));
  const back = fam.shards.flatMap((s, i) => parseDirectoryShard(JSON.parse(s.body), i, fam.shards.length, list.total));
  assert.deepEqual(back.map((r) => r.cik), DIR.map((r) => r.cik), "every row once, in order");
  // over the shard maximum the walk FAILS rather than dropping filers
  assert.throws(() => planDirectoryShards(DIR, fillShardsByBytes, { ceilingBytes: 4_000, shardLimit: 2 }), /do not fit/);
  assert.equal(INST_DIRECTORY_SHARDS_MAX, 8);
  // an empty directory still publishes shard 0, stating its empty total
  const empty = planDirectoryShards([], fillShardsByBytes);
  assert.deepEqual(empty.shards.map((s) => JSON.parse(s.body).total), [0]);
});

test("R32: a shard is refused when its envelope disagrees with its place in the family", () => {
  const fam = planDirectoryShards(DIR, fillShardsByBytes, { ceilingBytes: 4_000 });
  const body = JSON.parse(fam.shards[1]!.body);
  assert.throws(() => parseDirectoryShard(body, 0, fam.shards.length, DIR.length), /does not match/);
  assert.throws(() => parseDirectoryShard({ ...body, v: 2 }, 1, fam.shards.length, DIR.length), /version/);
  assert.throws(() => parseDirectoryShard({ ...body, total: DIR.length + 1 }, 1, fam.shards.length, DIR.length), /does not match/);
  assert.equal(parseDirectoryShardList('{"v":1,"total":3,"shards":["https://evil.example/0.json"]}'), null, "a list naming a foreign path is refused");
});

test("R32: /institutional/ inlines only the shard list — the rows island and the adds island are gone", () => {
  const page = readFileSync(path.join(SRC, "pages", "institutional", "index.astro"), "utf-8");
  assert.match(page, /id="inst-index-shards"/);
  assert.doesNotMatch(page, /id="inst-index-data"/);
  assert.match(page, /id="inst-index-load"[^`]*role="status"/, "the visible load/failure line");
  const adds = readFileSync(path.join(SRC, "lib", "ui", "institutional.ts"), "utf-8");
  assert.doesNotMatch(adds, /id="inst-adds-data"/);
  const route = readFileSync(path.join(SRC, "pages", "institutional", "data", "directory", "[shard].v1.json.ts"), "utf-8");
  assert.match(route, /instDirectoryFamily\(getBuildData\(\)\)/, "the route serves the one memoized plan");
});

/* --------------------------------------- R33: holders held past the first 25 */

const tickerHolders = (n: number, flagged: (i: number) => boolean = () => false) =>
  Array.from({ length: n }, (_, i) => ({ rank: i + 1, cik: String(i + 1).padStart(10, "0"), name: `HOLDER <${i + 1}> & CO`, value: i === 30 ? null : 1_000_000 - i, securities: 1, keySource: "mapped", flags: flagged(i + 1) ? ["security_not_in_mapping"] : [], tier: (i % 2 ? "top" : "tail") as "top" | "tail" }));
const tab = (n: number, flagged?: (i: number) => boolean): string =>
  tickerInstSectionHtml({ state: "data", name: "X", cik: "0000000001", period: "2026-03-31", latestFiled: "2026-05-15", topn: n, holders: tickerHolders(n, flagged), holdersPage: true, mapped: { issuer: "X", titleOfClass: "COM", holderCount: 900 } } as never, "XYZ");

/** A holders list's island — since the integration, the site's one held-rows
    carrier (lib/held-rows.ts): `offset` is the 25 shown, `shared` carries the
    row function's ctx and the stepped view's step, total and noun. */
function islandOf(html: string, id: string): { offset: number; shared: { ctx: unknown; step: number; total: number; noun: string }; rows: unknown[] } {
  const m = new RegExp(`<script type="application/json" data-held-for="${id}" data-held-render="[a-z-]+">([\\s\\S]*?)</script>`).exec(html);
  assert.ok(m, `island for ${id}`);
  return JSON.parse(m![1]!);
}
function noscriptBody(html: string): string {
  const ns = /<noscript>([\s\S]*?)<\/noscript>/.exec(html.slice(html.indexOf("tk-holders-more")));
  assert.ok(ns, "a noscript copy");
  return /<tbody role="rowgroup">([\s\S]*?)<\/tbody>/.exec(ns![1]!)![1]!;
}

test("R33: the ticker tab's island rows render byte-identically to its no-JS second table (escaping, an undisclosed value, tiers, a flag)", () => {
  const html = tab(60, (i) => i % 4 === 0);
  const island = islandOf(html, "ticker-holders-held");
  assert.equal(island.rows.length, 35);
  assert.equal(island.rows.map((r, j) => TICKER_HOLDER_HELD.row(r, island.offset + j, island.shared)).join("\n"), noscriptBody(html));
  // control: the wrong hoisted set changes the bytes — the ctx is load-bearing
  const wrong = island.rows.map((r, j) => TICKER_HOLDER_HELD.row(r, island.offset + j, { ...island.shared, ctx: { stated: ["security_not_in_mapping"] } })).join("\n");
  assert.notEqual(wrong, noscriptBody(html), "control: the island must carry the all-N hoist");
});

const pageHolders = (n: number): TickerHolderRow[] =>
  Array.from({ length: n }, (_, i) => ({ ticker: "XYZ", period_of_report: "2026-03-31", rank: i + 1, cik: String(i + 1).padStart(10, "0"), filer_name: `FILER ${i + 1} & SONS`, value_usd: i === 27 ? null : 5_000_000 - i, shares: i === 28 ? null : 1000 + i, prev_shares: 900, delta_shares: i % 3 === 0 ? -(i + 1) : i % 3 === 1 ? i + 1 : 0, change_kind: (["add", "trim", "held", "new", "exit"] as const)[i % 5]!, method: "m", verified_date: "2026-09-01", filed_date: "2026-05-01" }));
const TOTALS: TickerTotalsRow = { ticker: "XYZ", period_of_report: "2026-03-31", prev_period: "2025-12-31", issuer_name: "XYZ CORP", title_of_class: "CMN", holder_count: 5662, value_usd: 1, adds: 1, exits: 1 };
const holdersPage = (n: number): string =>
  tickerHoldersBody({ ticker: "XYZ", totals: TOTALS, holders: pageHolders(n), tierOf: (cik) => (Number(cik) % 2 ? "top" : "tail"), latestFiled: "2026-07-31", overlapHtml: "", congress: { members: 3, href: "/congress/tickers/XYZ/" }, window: null });

test("R33: the holders page opens at 25; 26..N are held — island rows equal the no-JS rows byte for byte; nothing past 25 is in the DOM", () => {
  const html = holdersPage(70);
  const first = /<tbody role="rowgroup" id="ticker-holders-rows">([\s\S]*?)<\/tbody>/.exec(html)![1]!;
  assert.equal((first.match(/<tr role="row"/g) ?? []).length, HOLDERS_VISIBLE);
  const island = islandOf(html, "ticker-holders-held");
  assert.deepEqual([island.offset, island.shared.step, island.shared.total, island.rows.length], [25, 25, 70, 45]);
  assert.equal(island.rows.map((r, j) => HOLDERS_PAGE_HELD.row(r, island.offset + j, island.shared)).join("\n"), noscriptBody(html));
  assert.equal((island.rows as HoldersPageRow[])[2]!.value, null, "an undisclosed value travels as null and renders —");
  assert.match(holdersPageRowHtml((island.rows as HoldersPageRow[])[2]!), /<td role="cell" class="c-num">—<\/td>/);
  /* launch review H1: the list (70) is capped below the class's 5,662 holders, so it is "the top 70 of 5,662", never "all 70" */
  assert.match(html, /<summary>Show the top 70 of 5,662 holders<\/summary>/);
  assert.match(html, /Top 70 of 5,662 holders shown; the rest are on EDGAR\./);
  // holders-01: the class code reads as words; the code as filed stays in the accessible name; no duplicate link line
  assert.match(html, /common stock<span class="visually-hidden"> \(filed as CMN\)<\/span>/);
  assert.match(html, /Q1 2026/);
  assert.doesNotMatch(html, /the congressional view ↗/);
  // twenty-five or fewer: no disclosure, no island, no noscript copy
  const few = holdersPage(25);
  assert.ok(!few.includes("tk-holders-more") && !few.includes("data-held-for") && !few.includes("<noscript>"));
});

test("R33/LD26: no <noscript> copy ever opens inside a tbody (the parser would hoist it out)", () => {
  for (const html of [tab(60), holdersPage(70)]) {
    for (const m of html.matchAll(/<noscript>/g)) {
      const before = html.slice(0, m.index);
      assert.ok(before.lastIndexOf("<tbody") <= before.lastIndexOf("</tbody>"), "noscript outside every tbody");
    }
  }
  // control: the scan sees a noscript planted inside a tbody
  const planted = "<table><tbody><noscript><tr></tr></noscript></tbody></table>";
  const m = /<noscript>/.exec(planted)!;
  const before = planted.slice(0, m.index);
  assert.ok(!(before.lastIndexOf("<tbody") <= before.lastIndexOf("</tbody>")), "control: a planted one is caught");
});

/** Mount a server body and run the one binder over it — the page script's
    `registerHeldRows` then `initDomDisclosures` — with a `window` double
    that records the print listeners. */
function mount(html: string, held: typeof TICKER_HOLDER_HELD | null) {
  const { doc, restore } = installDom(html);
  const g = globalThis as unknown as Record<string, unknown>;
  const priorWin = g.window;
  const winListeners = new Map<string, (() => void)[]>();
  g.window = { addEventListener: (t: string, fn: () => void) => void winListeners.set(t, [...(winListeners.get(t) ?? []), fn]) };
  if (held) registerHeldRows(held.render, held.row, { text: held.text });
  initDomDisclosures();
  return {
    doc,
    fire: (t: string) => (winListeners.get(t) ?? []).forEach((fn) => fn()),
    restore() {
      g.window = priorWin;
      restore();
    },
  };
}
const rowsIn = (doc: { getElementById(id: string): MiniElement | null }, id: string): string[] =>
  doc.getElementById(id)!.querySelectorAll("tr").map((tr) => tr.querySelectorAll("td")[0]!.textContent!.trim());
const range = (a: number, b: number): string[] => Array.from({ length: b - a + 1 }, (_, i) => String(a + i));

test("R33: the binder draws 25 more on open, 25 more per press, searches the held rows by name, and prints every holder", () => {
  const m = mount(tab(80), TICKER_HOLDER_HELD);
  try {
    const { doc } = m;
    const id = "ticker-holders-held";
    assert.deepEqual(rowsIn(doc, id), [], "nothing held is drawn before the reader asks");
    assert.equal(doc.querySelector(`[data-held-tools="${id}"]`)!.hidden, false, "the search is revealed once the binder runs");
    toggleDetails(doc.querySelector("details.tk-holders-more")!);
    assert.deepEqual(rowsIn(doc, id), range(26, 50), "opening draws the first 25 held rows");
    const count = doc.querySelector(`[data-held-count="${id}"]`)!;
    /* launch review H1: the tab's mapped list (80) is capped below its 900 holders, so the count reads against 900 */
    assert.equal(count.textContent, "26–50 of 900 holders");
    const step = doc.querySelector(`[data-held-step="${id}"]`)!;
    assert.equal(step.textContent, "Show 25 more");
    step.click();
    assert.deepEqual(rowsIn(doc, id), range(26, 75));
    assert.equal(step.textContent, "Show the last 5");
    step.click();
    assert.deepEqual(rowsIn(doc, id), range(26, 80));
    assert.ok(step.hidden, "nothing left to show: the control hides");
    // search: by filer name, over the held rows, first 25 of the result
    const search = doc.querySelector(`[data-held-search="${id}"]`)! as unknown as MiniElement & { value: string };
    search.value = "<7";
    search.dispatch("input", {});
    assert.deepEqual(rowsIn(doc, id), ["70", "71", "72", "73", "74", "75", "76", "77", "78", "79"]);
    assert.match(count.textContent!, /^10 of holders 26–80 match "<7"$/);
    search.value = "nobody";
    search.dispatch("input", {});
    assert.deepEqual(rowsIn(doc, id), []);
    assert.match(count.textContent!, /No filer among holders 26–80 matches "nobody"\./);
    // paper: every held holder, whatever the search, then the reader's state back
    m.fire("beforeprint");
    assert.deepEqual(rowsIn(doc, id), range(26, 80), "beforeprint draws every held row");
    assert.ok(doc.querySelector("details.tk-holders-more")!.hasAttribute("open"));
    m.fire("afterprint");
    assert.deepEqual(rowsIn(doc, id), [], "afterprint restores the reader's search");
  } finally {
    m.restore();
  }
});

test("R33: the binder renders through the REGISTERED function only — an island with no registered renderer is left inert", () => {
  /* the registry is the page's (module-wide), so the control names a
     renderer no page registers */
  const m = mount(tab(40).replace('data-held-render="ticker-holder"', 'data-held-render="unregistered-holders"'), null);
  try {
    toggleDetails(m.doc.querySelector("details.tk-holders-more")!);
    assert.deepEqual(rowsIn(m.doc, "ticker-holders-held"), [], "no renderer, no rows");
    assert.equal(m.doc.querySelector('[data-held-tools="ticker-holders-held"]')!.hidden, true, "and its controls stay hidden");
  } finally {
    m.restore();
  }
});

test("R33: count and step grammar", () => {
  assert.equal(heldCountText({ shown: 25, total: 500, held: 475, rendered: 25, matches: null, query: "" }), "26–50 of 500 holders");
  assert.equal(heldCountText({ shown: 25, total: 500, held: 475, rendered: 0, matches: null, query: "" }), "");
  assert.equal(heldCountText({ shown: 25, total: 500, held: 475, rendered: 3, matches: 3, query: "x" }), '3 of holders 26–500 match "x"');
  assert.equal(heldCountText({ shown: 25, total: 500, held: 475, rendered: 25, matches: 40, query: "x" }), '40 of holders 26–500 match "x" · 25 shown');
  assert.equal(heldStepLabel(30, 25), "Show 25 more");
  assert.equal(heldStepLabel(25, 25), "Show the last 25");
  assert.equal(heldStepLabel(0, 25), "");
});

/* ------------------------------------------------- R34: the Methodology fold */

const METHODOLOGY = readFileSync(path.join(SRC, "pages", "methodology", "index.astro"), "utf-8");

test("R34: every long section is a <details open> fold; Required notices are never inside one", () => {
  const folds = [...METHODOLOGY.matchAll(/<section class="metho-section" id="([a-z0-9-]+)">\s*<details class="metho-fold" open data-metho-fold>/g)].map((m) => m[1]);
  assert.deepEqual(folds, ["m1", "signals-method", "m2", "principles", "publication", "privacy"]);
  assert.equal((METHODOLOGY.match(/<details class="metho-fold" open data-metho-fold>/g) ?? []).length, folds.length, "every fold ships open (no-JS unchanged)");
  const notices = METHODOLOGY.indexOf('id="notices"');
  const before = METHODOLOGY.slice(0, notices);
  assert.ok(before.lastIndexOf("<details") < before.lastIndexOf("</details>"), "#notices sits outside every fold");
  assert.match(METHODOLOGY, /<section class="metho-section metho-notices">/);
  // control: the same scan catches a notices heading planted inside a fold
  const planted = '<details class="metho-fold" open data-metho-fold><h2 id="notices">Required notices</h2></details>';
  const pb = planted.slice(0, planted.indexOf('id="notices"'));
  assert.ok(!(pb.lastIndexOf("<details") < pb.lastIndexOf("</details>")), "control");
});

test("R34: the script folds only at ≤720px, opens the target of an inbound anchor, and opens everything for print", () => {
  const script = METHODOLOGY.slice(METHODOLOGY.indexOf("<script>"));
  assert.match(script, /matchMedia\("\(max-width: 720px\)"\)/);
  assert.match(script, /addEventListener\("hashchange"/);
  assert.match(script, /if \(location\.hash\) reveal\(location\.hash, true\)/);
  assert.match(script, /addEventListener\("beforeprint"/);
  assert.match(script, /addEventListener\("afterprint"/);
  assert.doesNotMatch(script, /metho-notices|#notices/, "the script never touches Required notices");
});

test("R34: every /methodology/#anchor the site links resolves to an element on the page", () => {
  const ids = new Set([...METHODOLOGY.matchAll(/\bid="([A-Za-z0-9_-]+)"/g)].map((m) => m[1]!));
  /* the rendered sections the page includes from their owners */
  for (const m of readFileSync(path.join(SRC, "lib", "ui", "signals.ts"), "utf-8").matchAll(/\bid="([a-z0-9-]+)"/g)) ids.add(m[1]!);
  for (const f of ["signals-playbooks.ts", "signals-overlap.ts", "signals-institutional.ts"]) {
    for (const m of readFileSync(path.join(SRC, "lib", "ui", f), "utf-8").matchAll(/\bid="([a-z0-9-]+)"/g)) ids.add(m[1]!);
  }
  const linked = new Set<string>();
  const walk = (dir: string): void => {
    for (const ent of readdirSyncSafe(dir)) {
      const p = path.join(dir, ent.name);
      if (ent.isDirectory()) walk(p);
      else if (/\.(ts|astro)$/.test(ent.name)) for (const m of readFileSync(p, "utf-8").matchAll(/\/methodology\/#([A-Za-z0-9_-]+)/g)) linked.add(m[1]!);
    }
  };
  walk(SRC);
  assert.ok(linked.size >= 20, `the site links ${linked.size} distinct methodology anchors`);
  const missing = [...linked].filter((a) => !ids.has(a));
  assert.deepEqual(missing, [], "every inbound anchor has a target");
});

import { readdirSync, type Dirent } from "node:fs";
function readdirSyncSafe(dir: string): Dirent[] {
  return readdirSync(dir, { withFileTypes: true });
}
