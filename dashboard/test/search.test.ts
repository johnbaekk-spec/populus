/* Search client pure functions (results/pre-query renderers, combobox option
   semantics). The watchlist v2 store this file also covered (Locked #16) was
   removed with the watchlist in signals-v3 M1; the pre-query state no longer
   reads the device at all. */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { renderResults, renderPreQuery, optionId } from "../src/scripts/search-client.ts";
import { buildSearchIndex, searchQuery } from "../src/lib/derive.ts";

const INDEX = buildSearchIndex(
  [
    { bioguide: "P000001", name: "Busy Member", aff: "D–CA-11", rows: 40 },
    { bioguide: "Q000002", name: "Quiet Member", aff: "R–TX-1", rows: 2 },
  ],
  [
    { ticker: "NVDA", name: "NVIDIA Corp", rows: 35 },
    { ticker: "AAPL", name: "Apple Inc.", rows: 20 },
  ],
  [{ cik: "0001067983", name: "Berkshire Hathaway Inc", top: true }],
);

/* ---------- results rendering ---------- */

test("renderResults: grouped, combobox options with ids and aria-selected", () => {
  const hits = searchQuery(INDEX, "n");
  const html = renderResults(hits, 0);
  assert.ok(html.includes('aria-label="Tickers"'));
  assert.ok(html.includes('role="option"'));
  assert.ok(html.includes(`id="${optionId(0)}"`));
  assert.ok(html.includes('aria-selected="true"'));
  assert.ok(!html.includes("<script"));
});

test("renderResults: an empty result set states scope, never a bare empty", () => {
  const html = renderResults([], -1);
  assert.ok(html.includes("Nothing in this build matches"));
  assert.ok(html.includes("every ticker, member, and filer"));
});

/* ---------- pre-query (S6): how the search matches, and starters ---------- */

test("pre-query (S6): the matching rule, the on-device statement and the most-active starters, with no watch copy", () => {
  const html = renderPreQuery(INDEX);
  assert.ok(html.includes("Search this build"));
  assert.ok(html.includes("Tickers match by prefix, names by substring."), "the same rule the empty result states");
  assert.ok(html.includes("never leaves your device"), "the methodology's search statement");
  assert.ok(html.includes("most-active in this build"), "starter caption is build-derived (Locked #5)");
  const starters = [...html.matchAll(/<a class="quick-link" href="([^"]+)">([^<]+)<\/a>/g)].map((m) => [m[1], m[2]]);
  assert.deepEqual(starters, [
    ["/tickers/NVDA/", "NVDA"],
    ["/tickers/AAPL/", "AAPL"],
    ["/congress/members/P000001/", "Busy Member"],
    ["/congress/members/Q000002/", "Quiet Member"],
  ], "the top two tickers and members by rows, plain links");
  assert.ok(!html.includes("most-viewed"), "no view analytics exist to rank by");
  /* signals-v3 M1 (R1): no star glyph and no watch copy remain */
  assert.doesNotMatch(html, /☆|★|[Ww]atch|saved on this device/);
});

test("pre-query (S6): before the index loads, the rule still renders and no starter is invented", () => {
  const html = renderPreQuery(null);
  assert.ok(html.includes("Tickers match by prefix, names by substring."));
  assert.doesNotMatch(html, /quick-link|most-active/);
});

test("signals-v3 M1: the search island reads nothing from the device's storage", () => {
  const src = readFileSync(new URL("../src/scripts/search-client.ts", import.meta.url), "utf-8");
  assert.doesNotMatch(src, /localStorage|sessionStorage|loadWatchStore|entity-client/);
  assert.equal(renderPreQuery.length, 1, "the pre-query renderer takes the index alone");
});

/* ---------- R10 (refinement 20260910): principals, notable-first, clean keys ---------- */

const R10_INDEX = buildSearchIndex(
  [],
  [
    { ticker: " nvda ", name: "NVIDIA Corp", rows: 35 },
    { ticker: "BRK.B", name: "Berkshire Hathaway Inc", rows: 9 },
    { ticker: "BAD TICKER", name: "", rows: 1 },
    { ticker: "TOOLONGX", name: "", rows: 1 },
  ],
  [
    // Indexed by row count, largest first — exactly how data.ts orders them.
    { cik: "0001423053", name: "Citadel Advisors", principal: "Ken Griffin", notable: false, top: true },
    { cik: "0001067983", name: "Berkshire Hathaway", principal: "Warren Buffett", notable: true, top: true },
    { cik: "0000000005", name: "Berkshire Partners LLC", principal: "", notable: false, top: false },
    { cik: "0001536411", name: "Duquesne Family Office", principal: "Stanley Druckenmiller", notable: true, top: true },
  ],
);

test("R10: 'Druckenmiller' resolves to Duquesne Family Office first, as one result", () => {
  const hits = searchQuery(R10_INDEX, "Druckenmiller").filter((h) => h.kind === "filer");
  assert.equal(hits.length, 1);
  assert.equal(hits[0]!.label, "Duquesne Family Office · Stanley Druckenmiller");
  assert.equal(hits[0]!.key, "1536411");
});

test("R10: 'Berkshire' ranks the notable manager first and names Warren Buffett", () => {
  const hits = searchQuery(R10_INDEX, "Berkshire").filter((h) => h.kind === "filer");
  assert.equal(hits[0]!.label, "Berkshire Hathaway · Warren Buffett");
  assert.equal(hits[1]!.label, "Berkshire Partners LLC");
});

test("R10: a principal renders with its manager as ONE result, never a second entry", () => {
  const hits = searchQuery(R10_INDEX, "griffin").filter((h) => h.kind === "filer");
  assert.deepEqual(hits.map((h) => h.label), ["Citadel Advisors · Ken Griffin"]);
});

test("R10: ticker keys are trimmed/normalized and every key matches /^[A-Z.\\-]{1,6}$/; no key carries whitespace", () => {
  const keys = R10_INDEX.tickers.map((t) => t[0]);
  assert.deepEqual(keys, ["NVDA", "BRK.B"]);
  for (const k of keys) assert.match(k, /^[A-Z.\-]{1,6}$/);
  for (const row of [...R10_INDEX.tickers, ...R10_INDEX.filers]) {
    for (const cell of row) if (typeof cell === "string") assert.ok(!/^\s|\s$/.test(cell), JSON.stringify(cell));
  }
});
