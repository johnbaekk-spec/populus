/* signals-v3 M1 (R1, R2, R3; LD11) — the watchlist is removed from the site.

   Each test below pins one half of the removal and FAILS if that half comes
   back: the route, the nav link, any watch code or copy in the source tree,
   the watch markup on the rendered surfaces, and the one-time legacy-key
   cleanup in `public/theme-init.js` (declared debt TD-1, removable on or after
   2027-01-31). Every scanner here carries a control proving it can see a
   planted hit, so an empty result is a checked answer, not a blind one. */

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";

import { feedHeadHtml, feedItemHtml, type PaperRow, type TxnRow } from "../src/lib/format.ts";
import { memberBody, signalsBody, tickerUnifiedBody } from "../src/lib/ui/index.ts";
import { renderPreQuery } from "../src/scripts/search-client.ts";

const DASH = path.resolve(import.meta.dirname, "..");
const SRC = path.join(DASH, "src");
const PUBLIC = path.join(DASH, "public");
const THEME_INIT = path.join(PUBLIC, "theme-init.js");

/** Exactly the four localStorage keys the removed feature wrote: the v2 store,
    its legacy bare-array mirror, the corrupt-store quarantine
    (`entity-client.ts` on origin/main 631a0aa) and the last-seen cursor
    (`lib/watchlist.ts` on the same commit). */
const LEGACY_KEYS = [
  "populus:watch:v2",
  "populus:watch:members",
  "populus:watch:v2.corrupt",
  "populus:watch:cursor:v1",
] as const;

function filesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...filesUnder(full));
    else out.push(full);
  }
  return out;
}

/** Every watch trace a file can carry: the feature's name, its storage keys,
    its markup hooks and classes, its store and renderers, its filter field. */
const WATCH_TRACE =
  /watchlist|populus:watch|data-watch|watch-btn|star-btn|reference-watch|loadWatchStore|watchStarHtml|starHtml|initWatch|signal-watch|si-watch|watchedOnly|watched/i;

/** `file: line` for each line of each file that carries a watch trace. */
function watchTraces(files: readonly { file: string; text: string }[]): string[] {
  const hits: string[] = [];
  for (const { file, text } of files) {
    text.split("\n").forEach((line, i) => {
      if (WATCH_TRACE.test(line)) hits.push(`${file}:${i + 1}`);
    });
  }
  return hits;
}

const read = (file: string): { file: string; text: string } => ({
  file: path.relative(DASH, file),
  text: readFileSync(file, "latin1"),
});

test("R1: no /watchlist/ route — the page directory and any watchlist route file are gone", () => {
  assert.equal(existsSync(path.join(SRC, "pages", "watchlist")), false, "src/pages/watchlist/ is back");
  const routes = filesUnder(path.join(SRC, "pages")).map((f) => path.relative(SRC, f));
  assert.deepEqual(routes.filter((r) => /watch/i.test(r)), [], "a watch route file exists");
  assert.ok(routes.includes(path.join("pages", "signals", "index.astro")), "control: the route walk sees the pages");
});

test("R1/R2: the site nav carries no /watchlist/ link and the layout's `active` union no watchlist member", () => {
  const base = readFileSync(path.join(SRC, "layouts", "Base.astro"), "utf-8");
  assert.doesNotMatch(base, /href="\/watchlist\/"/, "a link to /watchlist/ is back");
  const active = /active\?:\s*([^;]+);/.exec(base)?.[1] ?? "";
  assert.ok(active.includes('"signals"'), "control: the union was found");
  assert.doesNotMatch(active, /"watchlist"/, "the active union names the watchlist again");
});

test("R2: no source file under src/ carries a watch trace; under public/, only theme-init.js does", () => {
  const src = filesUnder(SRC).map(read);
  assert.ok(src.length > 50, `only ${src.length} source files scanned — the walk is not seeing src/`);
  assert.deepEqual(watchTraces(src), [], "watch code, markup or copy is back in src/");

  const pub = filesUnder(PUBLIC).filter((f) => /\.(js|html|txt|json|md)$/.test(f)).map(read);
  const traced = new Set(watchTraces(pub).map((h) => h.slice(0, h.lastIndexOf(":"))));
  assert.deepEqual([...traced], [path.relative(DASH, THEME_INIT)], "only the legacy-key cleanup may name the feature");

  // controls: the scanner sees a planted trace of each kind
  for (const planted of ['<a href="/watchlist/">', "localStorage.getItem(\"populus:watch:v2\")", 'class="star-btn"', "watchedOnly: false"]) {
    assert.equal(watchTraces([{ file: "x.ts", text: `const a = 1;\n${planted}\n` }]).length, 1, `control: ${planted}`);
  }
});

test("R2: fetchFeedCorpus — the watch page's one-call corpus loader — is deleted", () => {
  const corpus = readFileSync(path.join(SRC, "scripts", "feed-corpus.ts"), "utf-8");
  assert.doesNotMatch(corpus, /\bfetchFeedCorpus\b/);
  assert.match(corpus, /export async function loadFeedCorpus\(/, "control: the loader the feed uses stays");
});

test("R1: no rendered surface carries a watch control — member, ticker, Signals, feed rows and head, search", () => {
  const txn: TxnRow = {
    kind: "txn", txnId: "t-1", asset: "Williams Companies Inc", assetType: "ST", filed: "2026-07-21",
    traded: "2026-06-24", name: "Fixture Member", bioguide: "T000001", party: "R", state: "OK", district: null,
    chamber: "senate", ticker: "WMB", side: "purchase", owner: "joint", low: 1001, high: 15000, lag: 27, late: 0,
    flags: [], doc: "https://efdsearch.senate.gov/x",
  };
  const paper: PaperRow = {
    kind: "paper", filed: "2026-06-01", name: "Fixture Member", bioguide: "T000001", party: "R", state: "OK",
    district: null, chamber: "senate", doc: "https://efdsearch.senate.gov/p",
  };
  const stamps = { buildId: "b", generatedAt: "2026-07-24 06:56 UTC", generatedAtDate: "2026-07-24" };
  const member = {
    bioguide: "T000001", name: "Fixture Member", party: "R", state: "OK", district: null, chamber: "senate",
    servingSince: "1999", filingCount: 2, txns: [txn], paper: [paper],
  } as never;
  const artifact = {
    v: 1, buildId: "b", computedAt: "2026-07-24", thresholdVersion: "1", retentionDays: 90,
    coverageFrom: "2026-04-25", coverageTo: "2026-07-24", lifecycleNote: "n", compaction: "none",
    dateAnomaliesExcluded: 0, lagCaveat: "c", withheld: [],
    signals: [{
      id: "s1-large:a", kind: "s1-large", rule: "r", thresholdVersion: "1",
      entities: { bioguide: "T000001", memberName: "Fixture Member", ticker: "WMB" },
      magnitude: { low: 1000001, high: 5000000 }, receipts: ["https://efdsearch.senate.gov/x"],
      occurrence: { tradeDate: "2026-06-24", filedDate: "2026-07-21" }, sourceAvailableAt: "2026-07-21",
      computedAt: "2026-07-24", firstSeenBuild: "b", lastSeenBuild: "b", status: "active", cohort: "senate",
      asset: "Williams Companies Inc", assetType: "ST", side: "purchase", owner: "joint", listedStock: true,
    }],
  } as never;
  const surfaces: Record<string, string> = {
    memberBody: memberBody(member, stamps, {}),
    tickerUnifiedBody: tickerUnifiedBody({ ticker: "WMB", txns: [txn] }, { state: "module-absent" }, stamps, {}, { fullTable: false }),
    signalsBody: signalsBody(artifact, {}, { rowsEvaluated: 100, latestBatch: [], latestBatchFiled: null }),
    feedRows: feedItemHtml(txn, {}) + feedItemHtml(paper, {}),
    feedHead: feedHeadHtml({ notes: { scope: "congress-feed" } }),
    searchPreQuery: renderPreQuery(null),
  };
  const MARKUP = /data-watch|watch-btn|star-btn|reference-watch|signal-watch|si-watch|watched only|[Ww]atchlist|★|☆|saved (?:in this browser|on this device)/;
  for (const [name, html] of Object.entries(surfaces)) {
    assert.ok(html.length > 200, `${name}: the surface rendered`);
    assert.doesNotMatch(html, MARKUP, `${name} carries a watch control or its copy`);
  }
  // control: the retired header star would be caught
  assert.match(
    '<button class="watch-btn" data-watch-kind="member" data-watch-key="T000001">☆</button>',
    MARKUP,
    "control",
  );
});

/** Run `public/theme-init.js` exactly as a browser would, over a recording
    localStorage. `throwOnAccess` models a browser that denies storage. */
function runThemeInit(seed: Record<string, string>, throwOnAccess = false) {
  const store = new Map(Object.entries(seed));
  const removed: string[] = [];
  const themes: string[] = [];
  const storage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => {
      removed.push(k);
      store.delete(k);
    },
  };
  const sandbox: Record<string, unknown> = {
    document: { documentElement: { setAttribute: (_n: string, v: string) => void themes.push(v) } },
  };
  Object.defineProperty(sandbox, "localStorage", {
    get() {
      if (throwOnAccess) throw new Error("SecurityError: storage denied");
      return storage;
    },
  });
  vm.runInNewContext(readFileSync(THEME_INIT, "utf-8"), sandbox);
  return { store, removed, themes };
}

test("R3 / TD-1: theme-init.js removes exactly the four legacy watch keys, and nothing else", () => {
  const { store, removed, themes } = runThemeInit({
    "populus:theme": "dark",
    "populus:watch:v2": JSON.stringify({ v: 2, members: ["T000001"], tickers: ["WMB"] }),
    "populus:watch:members": "[\"T000001\"]",
    "populus:watch:v2.corrupt": "{corrupt",
    "populus:watch:cursor:v1": "{}",
    "populus:watchful": "not ours to delete",
  });
  assert.deepEqual([...removed].sort(), [...LEGACY_KEYS].sort(), "exactly the four keys are removed");
  assert.deepEqual([...store.keys()].sort(), ["populus:theme", "populus:watchful"], "every other key survives");
  assert.deepEqual(themes, ["dark"], "the theme preference is still applied");
  // one-time in effect: a second load finds nothing left to remove
  const again = runThemeInit({ "populus:theme": "light" });
  assert.deepEqual(again.store.get("populus:theme"), "light");
});

test("R3 / TD-1: the cleanup is best-effort — a browser that denies storage does not throw", () => {
  assert.doesNotThrow(() => runThemeInit({}, true));
  const src = readFileSync(THEME_INIT, "utf-8");
  const cleanup = src.slice(src.indexOf("removeItem") - 200);
  assert.match(cleanup, /try\s*\{[\s\S]*removeItem[\s\S]*\}\s*catch\s*\(e\)\s*\{\s*\}/, "the removeItem calls sit inside try/catch");
  assert.equal((src.match(/removeItem\(/g) ?? []).length, LEGACY_KEYS.length, "one call per legacy key");
  assert.match(src, /2027-01-31/, "the debt carries its removal date (TD-1)");
});
