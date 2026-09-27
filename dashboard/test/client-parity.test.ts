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
import { notableMovesBandHtml, notableMovesCountText, consensusBoardHtml, type ConsensusBoard, type NotableMove } from "../src/lib/notable-moves.ts";
import { CONGRESS_ROOTS, congressRankingSection, hitsRangeText, SIGNAL_HITS_PAGE_SIZE, addsSectionHtml, type BuildStamps } from "../src/lib/ui/index.ts";
import { holdingsRangeText, HOLDINGS_PAGE_SIZE } from "../src/lib/holdings.ts";
import { congressTickersRollup } from "../src/lib/derive.ts";
import { initCongressSections } from "../src/scripts/congress-sections.ts";
import { initAddsControls, initInstIndex, instIndexBodyHtml } from "../src/scripts/inst-index-client.ts";
import { DESIGN_INST_INDEX_HEADS, type InstIndexRow } from "../src/lib/inst-index.ts";
import type { AddsPayload, AddsRow } from "../src/lib/inst-adds.ts";

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
const CTX: RenderCtx = { watched: new Set() };
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
      bound: "Every filer in this build has its own page, linked from its row here.",
    }) +
    `<p id="inst-index-status"></p><script type="application/json" id="inst-index-data">${JSON.stringify(INDEX_ROWS)}</script></section>`
  );
}
/** Mount the directory and make the island restate its count (a header
    click re-renders and re-syncs the disclosure, as in the browser). */
function directoryRestatement(html: string): [string, string] {
  const server = countOf(parse(html), "inst-managers-tbody");
  const { doc, restore } = installDom(html);
  try {
    initInstIndex();
    plantSentinel(doc, "inst-managers-tbody");
    doc.querySelector('th[data-inst-sort="positions"]')!.click();
    return [server, countOf(doc, "inst-managers-tbody")];
  } finally {
    restore();
  }
}

test("Q-4: the directory island restates the server's count word for word (plain and definite totals)", () => {
  const [server, client] = directoryRestatement(directoryPage());
  assert.equal(server, "1–10 of 23 managers");
  assert.equal(client, server);
  const [s2, c2] = directoryRestatement(directoryPage(true));
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
    plantSentinel(doc, "inst-adds-tbody");
    initAddsControls(); // restates at init, from the embedded rows
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
  const count = (b: ConsensusBoard) => countOf(parse(consensusBoardHtml(b, { filerHref: (c) => `/f/${c}` })), "inst-consensus-tbody");
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

test("notable moves: the band's server count equals the island's first restatement", () => {
  const move = (i: number): NotableMove => ({
    cik: `${i}`, manager: `M${i}`, principal: null, type: "hedge_fund", issuer: `I${i}`, ticker: null,
    ticker_verified: null, kind: "add", delta_shares: 1, curr_value: 1, delta_value: 1, filed: "2026-05-15",
    doc: null, key: `k${i}`, ikey: null,
  });
  const rows = Array.from({ length: 40 }, (_, i) => move(i));
  const html = notableMovesBandHtml(rows, { periods: ["2026-03-31"], period: "2026-03-31", filerHref: (c) => `/f/${c}` });
  const server = parse(html).querySelector("#inst-notable-moves-count")!.nodes.filter((n) => typeof n === "string").join("").split(" · ")[0]!;
  assert.equal(server, notableMovesCountText(15, 40));
  assert.equal(server, "1–15 of 40 moves");
});

test("signal hits and holdings: the pager's range is one function on both sides", () => {
  assert.equal(hitsRangeText(0, 50, 72, SIGNAL_HITS_PAGE_SIZE), "1–50 of 72 hits");
  assert.equal(hitsRangeText(1, 22, 72, SIGNAL_HITS_PAGE_SIZE), "51–72 of 72 hits");
  assert.equal(holdingsRangeText({ page: 1, rowsOnPage: 20, matched: HOLDINGS_PAGE_SIZE + 20 }), `${HOLDINGS_PAGE_SIZE + 1}–${HOLDINGS_PAGE_SIZE + 20} of ${HOLDINGS_PAGE_SIZE + 20} positions`);
});
