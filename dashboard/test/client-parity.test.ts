/* DESIGN-POLISH M1 (T1.4, R8): the server and the client state the SAME count.

   Every count a client restates after load is built by the function the
   server used, from the same inputs — so a sort, a filter or a re-render can
   change the rows but never the grammar or the meaning of the count.

   M1 review Q-4: the first version of this file re-derived `definite` itself
   and only GREPPED the islands, so it passed while the directory island
   (`inst-index-client.ts`) restated a definite count without its "the". The
   islands are now RUN: each is mounted over the SERVER's own markup (parsed by
   `mini-dom`, which can only find what the bytes hold), made to restate its
   count the way it does in the browser, and its words compared to the
   server's — for a plain total and for a definite one. */

import { test } from "node:test";
import assert from "node:assert/strict";
import { installDom, MiniElement } from "./lib/mini-dom.ts";
import {
  COMPACT_ROWS,
  compactBoundCount,
  compactDisclosure,
  syncCompactDisclosure,
  type CompactDisclosureNode,
  type RenderCtx,
  type TxnRow,
} from "../src/lib/format.ts";
import { type ConsensusBoard, type NotableMove } from "../src/lib/notable-moves.ts";
/* signals-v4 M2: the board and the Named moves render on /signals/#institutional */
import { buildSignalsInstitutional, consensusPanelHtml, namedMovesRangeText, signalsInstitutionalHtml } from "../src/lib/ui/signals-institutional.ts";
import { initNamedMoves } from "../src/scripts/signals-client.ts";
import { CONGRESS_ROOTS, congressRankingSection, hitsRangeText, SIGNAL_HITS_PAGE_SIZE, addsSectionHtml, type BuildStamps } from "../src/lib/ui/index.ts";
import { holdingsRangeText, HOLDINGS_PAGE_SIZE } from "../src/lib/holdings.ts";
import { congressTickersRollup } from "../src/lib/derive.ts";
import { initCongressSections } from "../src/scripts/congress-sections.ts";
import { initAddsControls, initInstIndex, instIndexBodyHtml } from "../src/scripts/inst-index-client.ts";
import { DESIGN_INST_INDEX_HEADS, planDirectoryShards, type InstIndexRow } from "../src/lib/inst-index.ts";
import { fillShardsByBytes } from "../src/lib/shards.ts";
import type { AddsPayload, AddsRow } from "../src/lib/inst-adds.ts";
import { stripTableRoles } from "./lib/table-roles.ts";

function parse(html: string): MiniElement {
  const root = new MiniElement("body");
  root.innerHTML = html;
  return root;
}
const countOf = (root: { querySelector(s: string): MiniElement | null }, rootId: string): string =>
  root.querySelector(`.compact-disclosure[data-compact-for="${rootId}"] .compact-bound-count`)?.textContent ?? "(none)";
/** Overwrite the mounted count with a sentinel, so a later equality with the
    server's words proves the ISLAND wrote them — not that nothing ran. */
function plantSentinel(root: { querySelector(s: string): MiniElement | null }, rootId: string): void {
  const el = root.querySelector(`.compact-disclosure[data-compact-for="${rootId}"] .compact-bound-count`);
  assert.ok(el, `#${rootId} has a count to restate`);
  el!.textContent = "SENTINEL";
}

/** Replace the server's disclosure for `rootId` with the one the SAME server
    function renders for a definite total — a server state the island must
    restate word for word. */
function withDefiniteDisclosure(html: string, rootId: string, o: { total: number; noun: string; boundNoun: string; extra?: string }): string {
  const re = new RegExp(`<div class="compact-disclosure"[^>]*data-compact-for="${rootId}"[\\s\\S]*?</button></div>`);
  assert.ok(re.test(html), `the server rendered a disclosure for #${rootId}`);
  return html.replace(re, compactDisclosure({ rootId, total: o.total, shown: COMPACT_ROWS, noun: o.noun, boundNoun: o.boundNoun, definite: true, bound: o.extra }));
}

/* ---------------------------------------------------- the congress island */

const GENERATED_AT = "2026-08-12";
const CTX: RenderCtx = {};
const STAMPS: BuildStamps = { buildId: "b", generatedAt: "2026-08-12 00:00 UTC", generatedAtDate: GENERATED_AT };
function txn(i: number): TxnRow {
  return {
    kind: "txn", txnId: `t${i}`, asset: null, assetType: null, filed: "2026-07-21", traded: "2026-08-01",
    name: `Member ${i}`, bioguide: `M${i}`, party: "R", state: "OK", district: null, chamber: "senate",
    ticker: `T${String(i).padStart(2, "0")}`, side: "purchase", owner: "self", low: 1001 + i * 1000,
    high: 15000 + i * 1000, lag: 27, late: 0, flags: [], doc: "https://efdsearch.senate.gov/x",
  };
}
const CONGRESS_ROWS = Array.from({ length: 24 }, (_, i) => txn(i));
function congressPage(): string {
  const momentum = congressRankingSection(
    "tickers",
    congressTickersRollup(CONGRESS_ROWS, GENERATED_AT, { range: "12m", basis: "traded" }),
    STAMPS,
    CTX,
    { rootId: CONGRESS_ROOTS.momentum, heading: "Ticker momentum", sectionId: "momentum-section", controls: true },
  );
  return `<main class="shell page" id="congress-page" data-generated-at-date="${GENERATED_AT}" data-range="12m" data-basis="traded">${momentum}</main>`;
}
/** Mount the page, deliver the rows (the island re-renders and restates its
    count), and return the server's and the island's words. */
function congressRestatement(html: string): [string, string] {
  const server = countOf(parse(html), CONGRESS_ROOTS.momentum);
  const { doc, restore } = installDom(html);
  try {
    const sections = initCongressSections();
    plantSentinel(doc, CONGRESS_ROOTS.momentum);
    sections.receiveRows(CONGRESS_ROWS);
    return [server, countOf(doc, CONGRESS_ROOTS.momentum)];
  } finally {
    restore();
  }
}

test("Q-4: the congress island restates the server's count word for word (plain and definite totals)", () => {
  const [server, client] = congressRestatement(congressPage());
  assert.equal(server, "1–10 of 24 ranked tickers");
  assert.equal(client, server);
  const definite = withDefiniteDisclosure(congressPage(), CONGRESS_ROOTS.momentum, { total: 24, noun: "tickers", boundNoun: "tickers in this window" });
  const [s2, c2] = congressRestatement(definite);
  assert.equal(s2, "1–10 of the 24 tickers in this window");
  assert.equal(c2, s2, "the island keeps the server's definite bound");
});

/* --------------------------------------------------- the directory island */

function indexRow(i: number): InstIndexRow {
  return {
    cik: String(1000 + i), name: `FILER ${String(i).padStart(2, "0")}`, period: "2026-03-31", value: 10_000 - i,
    positions: 5 + i, nullValuePositions: 0, hhi: 1000, hhiNote: "", tier: "top",
  } as InstIndexRow;
}
const INDEX_ROWS = Array.from({ length: 23 }, (_, i) => indexRow(i));
function directoryPage(definite = false): string {
  const body = instIndexBodyHtml(INDEX_ROWS, "", "value", "desc", undefined, COMPACT_ROWS);
  const heads = DESIGN_INST_INDEX_HEADS.map((h) => (h.key ? `<th scope="col" data-inst-sort="${h.key}"><button class="th-sort" type="button">${h.label}</button></th>` : `<th scope="col">${h.label}</th>`)).join("");
  return (
    `<section id="inst-managers-section"><input id="inst-index-q" /><span id="inst-index-count">${body.note}</span>` +
    `<table class="etable"><thead><tr>${heads}</tr></thead><tbody id="inst-managers-tbody">${body.html}</tbody></table>` +
    compactDisclosure({
      rootId: "inst-managers-tbody", total: INDEX_ROWS.length, shown: COMPACT_ROWS, noun: "managers",
      ...(definite ? { boundNoun: "managers in this build's directory", definite: true } : {}),
      bound: "Every filer has its own page.",
    }) +
    /* launch M7b (R32, LD28): the page inlines the shard LIST, never the rows */
    `<p id="inst-index-status"></p><script type="application/json" id="inst-index-shards">${DIRECTORY_FAMILY.listJson}</script></section>`
  );
}
const DIRECTORY_FAMILY = planDirectoryShards(INDEX_ROWS, fillShardsByBytes);
/** Mount the directory and make the island restate its count (a header
    click fetches the shard family, re-renders and re-syncs the disclosure,
    as in the browser). */
async function directoryRestatement(html: string): Promise<[string, string]> {
  const server = countOf(parse(html), "inst-managers-tbody");
  const { doc, restore } = installDom(html);
  const g = globalThis as unknown as Record<string, unknown>;
  const priorFetch = g.fetch;
  g.fetch = (href: string) => {
    const shard = DIRECTORY_FAMILY.shards[Number(/\/(\d+)\.v1\.json$/.exec(href)?.[1] ?? -1)]!;
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(JSON.parse(shard.body)) });
  };
  try {
    initInstIndex();
    plantSentinel(doc, "inst-managers-tbody");
    doc.querySelector('th[data-inst-sort="positions"]')!.click();
    for (let i = 0; i < 12; i++) await Promise.resolve();
    return [server, countOf(doc, "inst-managers-tbody")];
  } finally {
    g.fetch = priorFetch;
    restore();
  }
}

test("Q-4: the directory island restates the server's count word for word (plain and definite totals)", async () => {
  const [server, client] = await directoryRestatement(directoryPage());
  assert.equal(server, "1–10 of 23 managers");
  assert.equal(client, server);
  const [s2, c2] = await directoryRestatement(directoryPage(true));
  assert.equal(s2, "1–10 of the 23 managers in this build's directory");
  assert.equal(c2, s2, "the island keeps the server's definite bound (it dropped it before the fix)");
  // control: the restatement the unfixed island produced differs
  assert.notEqual(compactBoundCount(10, 23, "managers in this build's directory"), s2, "control");
});

/* ------------------------------------------------------- the adds island */

function addsRow(i: number): AddsRow {
  return {
    issuer_key: `k${i}`, issuer_key_source: "entity", issuer_name: `ISSUER ${i}`, manager_count: 3,
    new_position_count: 1, delta_value_usd: 10_000 - i, delta_value_is_partial: false, top_adder_cik: 1, top_adder_name: "A",
  };
}
function addsPayload(n: number, truncated: boolean, period = "2026-03-31"): AddsPayload {
  return {
    period, generated_at: "2026-08-12", rows: Array.from({ length: n }, (_, i) => addsRow(i)), truncated,
    truncation_boundary: truncated ? [1, 3, "k-next"] : null, ambiguous_identity_exclusion_count: 0,
  };
}
const ADDS_OPTS = { period: "2026-03-31", mode: "all" as const, periods: ["2026-03-31", "2025-12-31"], buildId: "b" };

test("Q-4/R-4: the adds island restates the server's count, and moves the bound noun with each quarter", async () => {
  // a truncated payload: the total is the leaderboard's bound
  const html = addsSectionHtml(addsPayload(30, true), ADDS_OPTS);
  const server = countOf(parse(html), "inst-adds-tbody");
  assert.equal(server, "1–10 of the 30 issuers on this bounded leaderboard");
  const { doc, restore } = installDom(html);
  const g = globalThis as unknown as Record<string, unknown>;
  const priorFetch = g.fetch;
  try {
    /* launch M7b (R32, LD28): no rows travel in the page; the island's first
       restatement follows its first fetch of THIS quarter's payload (on the
       drawer's first open in the browser, or the first control that needs
       rows — a header press here). */
    const fetched: string[] = [];
    g.fetch = (href: string) => {
      fetched.push(href);
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(addsPayload(30, true)) });
    };
    plantSentinel(doc, "inst-adds-tbody");
    initAddsControls();
    assert.deepEqual(fetched, [], "nothing is fetched at init");
    assert.equal(countOf(doc, "inst-adds-tbody"), "SENTINEL", "and nothing is restated before the rows exist");
    doc.querySelector('[data-adds-sort="managers"]')!.click();
    for (let i = 0; i < 8; i++) await Promise.resolve();
    assert.deepEqual(fetched, ["/institutional/data/adds/2026-03-31.all.v1.json"], "the shown quarter's own published payload");
    assert.equal(countOf(doc, "inst-adds-tbody"), server, "the island's first restatement is the server's");
    // the next quarter's payload is complete: the island's words must be the
    // server's words for THAT payload
    const next = addsPayload(14, false, "2025-12-31");
    g.fetch = () => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(next) });
    plantSentinel(doc, "inst-adds-tbody");
    doc.querySelector('[data-adds-period="2025-12-31"]')!.click();
    for (let i = 0; i < 8; i++) await Promise.resolve();
    const serverNext = countOf(parse(addsSectionHtml(next, { ...ADDS_OPTS, period: "2025-12-31" })), "inst-adds-tbody");
    assert.equal(serverNext, "1–10 of 14 issuers");
    assert.equal(countOf(doc, "inst-adds-tbody"), serverNext, "a complete quarter drops the bound noun");
  } finally {
    g.fetch = priorFetch;
    restore();
  }
});

/* ------------------------------------------- R-4: the consensus board bound */

test("R-4: the consensus board's count names its bound when more issuers qualify than it lists", () => {
  const row = (i: number) => ({
    issuerKey: `k${i}`, issuer: `ISSUER ${i}`, ticker: null, newStakes: 3, adds: 0, trims: 0, exits: 0, filers: 3,
    netDeltaUsd: 1000 - i, netDeltaPartial: false, topMover: null,
  });
  const board = (listed: number, qualifying: number): ConsensusBoard => ({ period: "2026-03-31", minFilers: 3, rows: Array.from({ length: listed }, (_, i) => row(i)), qualifying, wrappersExcluded: 0, unkeyedMoves: 0 });
  const count = (b: ConsensusBoard) => countOf(parse(consensusPanelHtml(b, null)), "consensus-list");
  assert.equal(count(board(50, 71)), "1–10 of the 50 highest-ranked issuers", "a bounded board names its bound");
  assert.equal(count(board(24, 24)), "1–10 of 24 issuers", "a complete board states its total");
  // control: the pre-fix wording reads as the count of qualifying issuers
  assert.notEqual(count(board(50, 71)), "1–10 of 50 issuers", "control");
});

/* ------------------------------------ R-9: the count is text in every sink */

test("R-9: the count clause is plain text; the server escapes it once, where it enters markup", () => {
  const noun = "S&P <index> names";
  assert.equal(compactBoundCount(10, 30, noun), "1–10 of 30 S&P <index> names", "plain text, never entities");
  const html = compactDisclosure({ rootId: "r", total: 30, shown: 10, noun, domBacked: true });
  assert.ok(html.includes("S&amp;P &lt;index&gt;"), "the server's html slot escapes it");
  const wrap = parse(html).querySelector(".compact-disclosure")!;
  const server = wrap.querySelector(".compact-bound-count")!.textContent;
  // a client writes it through textContent, as every island does
  syncCompactDisclosure(wrap as unknown as CompactDisclosureNode, { total: 30, hidden: 20, expanded: false, noun, count: { text: compactBoundCount(10, 30, noun) } });
  assert.equal(wrap.querySelector(".compact-bound-count")!.textContent, server, "the text sink shows the server's words");
  // control: an escaped string written as text prints its entities
  assert.notEqual("1–10 of 30 S&amp;P &lt;index&gt; names", server, "control");
});

/* ---------------------------------- the notable band, hits and holdings */

test("notable moves (signals-v4 LD11): the Named moves' server count equals the island's first restatement", () => {
  const move = (i: number): NotableMove => ({
    cik: `${i}`, manager: `M${i}`, principal: null, type: "hedge_fund", issuer: `I${i}`, ticker: null,
    ticker_verified: null, kind: "add", delta_shares: 1, curr_value: 1, delta_value: 1, filed: "2026-05-15",
    doc: null, key: `k${i}`, ikey: null,
  });
  const rows = Array.from({ length: 40 }, (_, i) => move(i));
  const model = buildSignalsInstitutional({
    present: true, period: "2026-03-31", latestFiled: "2026-07-31", freshness: "f", notableManagers: 40, moves: rows, leaders: null, txns: [],
    filerHref: (c) => `/f/${c}`, filerTier: () => "top",
  });
  const html = signalsInstitutionalHtml(model, {});
  const server = parse(html).querySelector("#mv-range")!.textContent;
  assert.equal(server, namedMovesRangeText(15, 40));
  assert.equal(server, "1–15 of 40 moves");
  // the island's first render restates it (a sentinel proves the island wrote it)
  const { doc, restore } = installDom(html);
  try {
    doc.getElementById("mv-range")!.textContent = "SENTINEL";
    initNamedMoves();
    assert.equal(doc.getElementById("mv-range")!.textContent, server);
  } finally {
    restore();
  }
});

test("signal hits and holdings: the range is one function on both sides", () => {
  /* SIGNALS-CLARITY M2 (R11): the count moves by LINES — repeats within one
     filing collapse — and states the hits those lines hold beside them.
     signals-v3 M2 (R13): the hits grow by "Show 10 more", so the range always
     starts at 1 and its end is the lines shown. */
  assert.equal(SIGNAL_HITS_PAGE_SIZE, 10);
  assert.equal(hitsRangeText(0, 10, 72, 80, SIGNAL_HITS_PAGE_SIZE), "1–10 of 72 lines · 80 hits");
  assert.equal(hitsRangeText(0, 20, 72, 80, SIGNAL_HITS_PAGE_SIZE), "1–20 of 72 lines · 80 hits");
  assert.equal(hitsRangeText(0, 1, 1, 1, SIGNAL_HITS_PAGE_SIZE), "1–1 of 1 line · 1 hit");
  assert.equal(hitsRangeText(0, 0, 0, 0, SIGNAL_HITS_PAGE_SIZE), "0 hits");
  assert.equal(holdingsRangeText({ page: 1, rowsOnPage: 20, matched: HOLDINGS_PAGE_SIZE + 20 }), `${HOLDINGS_PAGE_SIZE + 1}–${HOLDINGS_PAGE_SIZE + 20} of ${HOLDINGS_PAGE_SIZE + 20} positions`);
});

/* signals-v3 M2 (T2.7, R13): the signals island is RUN over the server's own
   /signals markup. Its first repaint under the server's filter is byte-equal
   to the server's body; "Show 10 more" keeps those ten lines and appends the
   next ten exactly as the server would render them; a family filter repaints
   through the same view, presses its row and shows the removable pill; the
   artifact is fetched ONCE.

   signals-v4 (R5, LD6, T1.6): the server body holds SIGNAL_HITS_DOM_ROWS (40)
   lines, the first 10 visible and 11–40 `hidden`; the client's repaint at
   shown = 10 is that body byte for byte; the fit's `setBase(25)` reveals
   lines 11–25 with NO fetch; `setBase(45)` needs lines the body does not hold
   and fetches exactly once. */
test("T2.7 / signals-v4 T1.6: the island's repaint equals the server body (40 held, 10 shown); setBase reveals held rows with no fetch and fetches once past them; Show 10 more and the family filter use the one fetch", async () => {
  const { signalsBody, sortHits, hitsView, hitsBodyHtml } = await import("../src/lib/ui/index.ts");
  const { SIGNAL_HITS_DOM_ROWS } = await import("../src/lib/ui/signals.ts");
  const { hitsRepaint, initHitPager, initSignalsPage } = await import("../src/scripts/signals-client.ts");
  const mk = (i: number, kind: "s1-large" | "s6-late-large"): Record<string, unknown> => ({
    id: `${kind}:${i}`, kind, rule: `${kind} rule`, thresholdVersion: "1.0.0",
    entities: { bioguide: `B${String(i).padStart(6, "0")}`, memberName: `Member ${i}`, ticker: `T${i}` },
    magnitude: { low: 250001, high: 500000 }, receipts: [`https://efdsearch.senate.gov/${i}`],
    occurrence: { tradeDate: "2026-03-01", filedDate: `2026-06-${String((i % 28) + 1).padStart(2, "0")}` }, sourceAvailableAt: "2026-06-01",
    computedAt: "c", firstSeenBuild: "b", lastSeenBuild: "b", status: "active", cohort: "senate",
    asset: `T${i} Inc`, assetType: "Stock", side: "purchase", owner: "self", listedStock: true,
  });
  const artifact = {
    v: 1, buildId: "b", computedAt: "c", thresholdVersion: "1.0.0", retentionDays: 90, coverageFrom: "2026-05-04", coverageTo: "2026-08-02",
    lifecycleNote: "n", compaction: "c", dateAnomaliesExcluded: 0, lagCaveat: "l", withheld: [],
    signals: [...Array.from({ length: 54 }, (_, i) => mk(i, "s1-large")), ...Array.from({ length: 6 }, (_, i) => mk(100 + i, "s6-late-large"))],
  } as never;
  const html = signalsBody(artifact, {}, { rowsEvaluated: 1000 });
  const serverBody = /<tbody id="signal-hits-body">([\s\S]*?)<\/tbody>/.exec(html)![1]!;
  const cols = /<table class="etable etable-compact si-table" data-columns="([^"]*)"/.exec(html)![1]!.split(",");
  const active = sortHits((artifact as { signals: never[] }).signals);
  const view = hitsView(active, { family: "all", stocksOnly: true });
  assert.equal(SIGNAL_HITS_DOM_ROWS, 40);
  /* Reversal record (launch M7a, D5/LD27): the page still carries 40 lines,
     but lines 11–40 ship in the island and render on reveal through the same
     body renderer. Property kept: the page's lines — the DOM's and the
     island's rendered the client's way — are the client's repaint, byte for
     byte, and a reveal inside them needs no fetch. */
  assert.equal((serverBody.match(/<tr class="si-hit/g) ?? []).length, 10, "the first ten lines are in the page");
  assert.equal((serverBody.match(/ hidden>/g) ?? []).length, 0);
  assert.equal(serverBody, hitsBodyHtml(view.lines.slice(0, 10), {}, cols, 10));
  const { ctxOfCut } = await import("../src/lib/ui/signals.ts");
  /* launch integration: the hits ship in the site's one held-rows island
     (lib/held-rows.ts: `{ v, offset, shared, rows }`, the row function named
     in `data-held-render`), drawn by the one binder */
  const island = JSON.parse(/<script type="application\/json" data-held-for="signal-hits-body" data-held-render="signal-hits">([\s\S]*?)<\/script>/.exec(html)![1]!);
  assert.equal(island.offset, 10, "the island's first line is line 11");
  assert.equal(island.rows.length, 30, "lines 11–40 wait in the island");
  const carried = serverBody + "\n" + hitsBodyHtml(island.rows, ctxOfCut(island.shared.cut), island.shared.columns, 0);
  // the pure composition the island paints with
  const first = hitsRepaint(active, { family: "all", stocksOnly: true }, 10, {}, cols, 40);
  assert.equal(first.body, carried, "the client's repaint at shown = 10 is the page's 40 lines, byte for byte");
  assert.equal(first.range, /id="signal-hits-range"[^>]*>([^<]*)</.exec(html)![1], "and the server's range");
  assert.equal(hitsRepaint(active, { family: "all", stocksOnly: true }, 45, {}, cols, 40).held, 60, "past the held rows the body holds the next multiple of 40 (here all 60 lines)");
  // the island itself, mounted over the server's bytes
  const { doc, restore } = installDom(html);
  const g = globalThis as unknown as Record<string, unknown>;
  const prevFetch = g.fetch, prevWindow = g.window;
  let fetches = 0;
  g.fetch = async () => (fetches++, { ok: true, json: async () => JSON.parse(JSON.stringify(artifact)) });
  g.window = { addEventListener() {} };
  const tick = async () => { for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0)); };
  const body = () => doc.getElementById("signal-hits-body")!.innerHTML;
  const visible = () => doc.querySelectorAll("#signal-hits-body tr.si-hit").filter((r) => !r.hasAttribute("hidden")).map((r) => r.getAttribute("data-signal-id"));
  try {
    // the fit's pager: setBase reveals held rows with no fetch
    const pager = initHitPager()!;
    assert.equal(body(), serverBody, "mounting changes nothing");
    await pager.setBase(25);
    assert.equal(fetches, 0, "setBase(25): no fetch — lines 11–25 render from the island");
    assert.deepEqual(visible(), view.lines.slice(0, 25).map((l) => l.lead.id));
    assert.equal(doc.getElementById("signal-hits-range")!.textContent, `1–25 of 60 lines · 60 hits`);
    assert.equal(doc.getElementById("hits")!.getAttribute("data-shown"), "25");
    await pager.setBase(45);
    await tick();
    assert.equal(fetches, 1, "setBase(45): one fetch — line 41 on is not held");
    assert.deepEqual(visible(), view.lines.slice(0, 45).map((l) => l.lead.id));
    await pager.setBase(10);
    assert.equal(fetches, 1, "back down: no fetch");
    assert.deepEqual(visible(), view.lines.slice(0, 10).map((l) => l.lead.id));
  } finally {
    restore();
    g.fetch = prevFetch;
    g.window = prevWindow;
  }
  // a fresh mount: Show 10 more, the family filter and the pill share ONE fetch
  const fresh = installDom(html);
  fetches = 0;
  g.fetch = async () => (fetches++, { ok: true, json: async () => JSON.parse(JSON.stringify(artifact)) });
  /* signals-v4 M2: the page binds its tabs first (`tabs.ts` reads the
     address bar and history), so the fake window carries them */
  g.window = { addEventListener() {}, location: { hash: "" }, history: null };
  const fbody = () => fresh.doc.getElementById("signal-hits-body")!.innerHTML;
  const fvisible = () => fresh.doc.querySelectorAll("#signal-hits-body tr.si-hit").filter((r) => !r.hasAttribute("hidden")).length;
  try {
    initSignalsPage();
    (fresh.doc.getElementById("signal-hits-more") as unknown as MiniElement).click();
    await tick();
    assert.equal(fetches, 0, "Show 10 more within the held lines: no fetch");
    assert.equal(fvisible(), 20, "Show 10 more: twenty lines");
    assert.ok(fbody().startsWith(serverBody.slice(0, serverBody.indexOf("<tr", 10))), "the first line is unchanged");
    assert.equal(fresh.doc.getElementById("signal-hits-range")!.textContent, "1–20 of 60 lines · 60 hits");
    // a family filter: COMPLIANCE is S-6 — a repaint through the server's renderer, extra reset
    (fresh.doc.querySelector('#families button[data-family="COMPLIANCE"]') as unknown as MiniElement).bubbleClick();
    await tick();
    const compliance = hitsView(active, { family: "COMPLIANCE", stocksOnly: true }).lines;
    // launch M1a (R40): the repaint carries the explicit table roles; the rows compared are unchanged
    assert.equal(stripTableRoles(fbody()), hitsBodyHtml(compliance.slice(0, 40), {}, cols, 10), "the server's renderer, the fit's base, no extension");
    assert.equal(fresh.doc.querySelector('#families button[data-family="COMPLIANCE"]')!.getAttribute("aria-pressed"), "true");
    assert.equal(fresh.doc.querySelector('#families button[data-family="BEHAVIOUR"]')!.getAttribute("aria-pressed"), "false");
    assert.equal(fresh.doc.getElementById("signal-family-pill-row")!.hidden, false, "the removable pill shows");
    assert.equal(fresh.doc.getElementById("signal-family-pill-name")!.textContent, "Compliance");
    assert.equal(fresh.doc.getElementById("signal-pane-hits-n")!.textContent, "6", "the pane switch's count follows the view");
    // the pill removes the filter
    (fresh.doc.getElementById("signal-family-pill") as unknown as MiniElement).click();
    await tick();
    // launch M1a (R40): the repaint carries the explicit table roles; stripped, the rows are unchanged
    assert.equal(stripTableRoles(fbody()), carried, "back to the page's view: its forty lines, the island's rendered the client's way");
    assert.equal(fresh.doc.getElementById("signal-family-pill-row")!.hidden, true);
    assert.equal(fetches, 1, "one lazy fetch, memoised");
  } finally {
    fresh.restore();
    g.fetch = prevFetch;
    g.window = prevWindow;
  }
});
