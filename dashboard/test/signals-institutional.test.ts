/* signals-v4 M2 (R11–R16, R24, LD6, LD10–LD13; T2.3, T2.4): the Institutional
   tab of /signals/ — its model (the DOM set, the slice totals, the card
   picks), its rendering (every move's receipt, the Congress column against
   an independent recount, the Congress lines' honesty fields, Consensus,
   the leaders) and its client (the chips, the name filter, the count and the
   page's bound, the fit contract, and `revealTarget`).

   The client runs over the server's own markup (`mini-dom`), so it can only
   find what the page holds. The model is the shared fixture
   (`test/lib/inst-signals-fixture.ts`): the owner-tier build carries no
   notable-manager registry, so its tab is the stated zero. */

import { test } from "node:test";
import assert from "node:assert/strict";

import { signalsBody } from "../src/lib/ui/index.ts";
import {
  CONSENSUS_COMPACT_ROWS,
  buildSignalsInstitutional,
  convictionLeadersHtml,
  moveRowFrom,
  moveRowHtml,
  namedMoveIds,
  namedMovesBoundText,
  namedMovesRangeText,
  parseNamedMovesTotals,
  signalsInstitutionalHtml,
  type HeldMoves,
} from "../src/lib/ui/signals-institutional.ts";
import { congressLineHtml } from "../src/lib/ui/signals.ts";
import {
  NAMED_MOVES_MIN,
  NAMED_MOVES_SLICE_ROWS,
  NAMED_MOVE_KINDS,
  NAMED_MOVE_TYPES,
  instLeadCards,
  moveNameKey,
  namedMovesDomSet,
  namedMovesSliceKey,
  namedMovesSliceTotals,
  type NotableMove,
} from "../src/lib/notable-moves.ts";
import { BROAD_ACCOUNT_NAMES, moveSide, quarterMembers } from "../src/lib/congress-quarter.ts";
import { normalizeTicker13f, type TxnRow } from "../src/lib/format.ts";
import { boundNamedMoves, initNamedMoves, initPaneSwitches, initSignalsPage, revealHash, revealTarget, STACKED_QUERY } from "../src/scripts/signals-client.ts";
import type { TabsEnv } from "../src/scripts/tabs.ts";
import { BROAD_ONLY_KEY, FIXTURE_PERIOD, fixtureInstitutional, fixtureLeaders, fixtureMoves, fixtureTxns } from "./lib/inst-signals-fixture.ts";
import { initDomDisclosures } from "../src/scripts/inst-index-client.ts";
import { compactCollapseLabel, compactShowAllLabel } from "../src/lib/format.ts";
import { installDom, MiniElement } from "./lib/mini-dom.ts";

const CTX = {};
function domOf(html: string): MiniElement {
  const root = new MiniElement("body");
  root.innerHTML = html;
  return root;
}
const text = (el: MiniElement | null | undefined): string => (el?.textContent ?? "").replace(/\s+/g, " ").trim();

/* ---------------------------------------------------------------- T2.3: the model */

/** LD11, recomputed independently: for each of the 30 slices its first N in
    population order, plus every move on a named key — in population order. */
function unionRule(moves: readonly NotableMove[], keys: ReadonlySet<string>, n: number): NotableMove[] {
  const kinds = [null, "new", "exit", "add", "trim"];
  const types = [null, "hedge_fund", "family_office", "asset_manager", "insurer", "alt_manager"];
  const keep = new Set<NotableMove>();
  for (const k of kinds) for (const t of types) moves.filter((m) => (k === null || m.kind === k) && (t === null || m.type === t)).slice(0, n).forEach((m) => keep.add(m));
  for (const m of moves) if (keys.has(m.ikey ?? `pos:${m.key}`)) keep.add(m);
  return moves.filter((m) => keep.has(m));
}

test("T2.3 (LD11): the DOM set is the union rule — 30 slices' first 30 plus every move on a named key — in population order; the 30 slice totals equal recounts", () => {
  const moves = fixtureMoves(200);
  const model = fixtureInstitutional({ moves });
  const keys = new Set<string>(model.board!.rows.map((r) => r.issuerKey));
  for (const m of [model.cards.newStake, model.cards.exit]) if (m) keys.add(moveNameKey(m));
  assert.equal(NAMED_MOVES_SLICE_ROWS, 30);
  const expected = unionRule(moves, keys, 30);
  assert.equal(model.domSet.length, expected.length, "size");
  assert.deepEqual(model.domSet.map((m) => m.key), expected.map((m) => m.key), "order: the population's");
  assert.ok(model.domSet.length < moves.length, "the fixture exercises the bound");
  // the slices: 5 kinds × 6 types
  assert.deepEqual(NAMED_MOVE_KINDS, ["new", "exit", "add", "trim"]);
  assert.deepEqual(NAMED_MOVE_TYPES, ["hedge_fund", "family_office", "asset_manager", "insurer", "alt_manager"]);
  const totals = namedMovesSliceTotals(moves);
  assert.equal(Object.keys(totals).length, 30);
  for (const k of [null, ...NAMED_MOVE_KINDS]) {
    for (const t of [null, ...NAMED_MOVE_TYPES]) {
      const recount = moves.filter((m) => (k === null || m.kind === k) && (t === null || m.type === t)).length;
      assert.equal(totals[namedMovesSliceKey(k, t)], recount, `${k ?? "any"}|${t ?? "any"}`);
    }
  }
  assert.equal(totals["any|any"], 200, "the whole population, banks included");
  // every move on a Consensus key or a card's name is in the set — a name filter lists all of them
  for (const key of keys) {
    const all = moves.filter((m) => moveNameKey(m) === key).length;
    assert.equal(model.domSet.filter((m) => moveNameKey(m) === key).length, all, key);
  }
  // control: a smaller per-slice bound gives a smaller set, by the same rule
  assert.deepEqual(namedMovesDomSet(moves, keys, 20).map((m) => m.key), unionRule(moves, keys, 20).map((m) => m.key));
  assert.ok(namedMovesDomSet(moves, new Set(), 5).length < namedMovesDomSet(moves, new Set(), 30).length);
  // the totals ride on the section as a quote-free list the client reads back exactly
  const section = domOf(signalsInstitutionalHtml(model, CTX)).querySelector("#named-moves")!;
  assert.deepEqual(parseNamedMovesTotals(section.getAttribute("data-mv-totals")), totals);
});

test("T2.3 (LD13): the cards — Consensus row 1, the new stake with the largest Δ $, the exit with the most negative; ties by population order; empty states", () => {
  const mv = (key: string, kind: NotableMove["kind"], dv: number | null): NotableMove =>
    ({ cik: key, manager: key, principal: null, type: "hedge_fund", issuer: key, ticker: null, ticker_verified: null, kind, delta_shares: 1, curr_value: 1, delta_value: dv, filed: "2026-05-01", doc: "https://www.sec.gov/x", key, ikey: key }) as NotableMove;
  // population order: the tie at 900 is won by the first in the list
  const moves = [mv("n1", "new", 500), mv("n2", "new", 900), mv("n3", "new", 900), mv("n4", "new", null), mv("x1", "exit", -100), mv("x2", "exit", -700), mv("x3", "exit", -700), mv("a1", "add", 5000)];
  const picks = instLeadCards({ rows: [] }, moves);
  assert.equal(picks.newStake?.key, "n2", "max Δ $; the tie goes to the first in population order");
  assert.equal(picks.exit?.key, "x2", "min Δ $; the tie goes to the first");
  assert.equal(picks.consensus, null);
  // an undisclosed Δ $ is never a pick; no exit → null
  assert.equal(instLeadCards(null, [mv("n4", "new", null)]).newStake, null);
  assert.equal(instLeadCards(null, [mv("a1", "add", 5)]).exit, null);
  // the fixture's cards and the board
  const model = fixtureInstitutional();
  assert.equal(model.cards.consensus?.issuerKey, model.board!.rows[0]!.issuerKey);
  const news = model.moves.filter((m) => m.kind === "new" && m.delta_value != null);
  assert.equal(model.cards.newStake!.delta_value, Math.max(...news.map((m) => m.delta_value!)));
  // empty states render, stated by kind and quarter (no banned bare "move")
  const empty = buildSignalsInstitutional({ present: true, period: FIXTURE_PERIOD, latestFiled: "2026-07-31", freshness: "f", notableManagers: 1, moves: [mv("a1", "add", 5)], leaders: null, txns: [], filerHref: (c) => `/f/${c}`, filerTier: () => "top" });
  const cards = domOf(signalsInstitutionalHtml(empty, CTX));
  assert.equal(text(cards.querySelector('[data-card="new"] [data-empty-state]')), `— no new stake in the quarter ended ${FIXTURE_PERIOD}.`);
  assert.equal(text(cards.querySelector('[data-card="exit"] [data-empty-state]')), `— no exit in the quarter ended ${FIXTURE_PERIOD}.`);
  assert.match(text(cards.querySelector('[data-card="consensus"] [data-empty-state]')), /^— no issuer was moved by 3 or more notable managers in the quarter ended 2026-03-31\.$/);
  // the Consensus card's "{n} filings" counts distinct managers' filings, not kind
  // counts summed: one manager with a new stake AND an add on the name is ONE filing
  const two = { ...mv("m1-b", "add", 50), cik: "m1", manager: "m1", issuer: "K", ikey: "K" } as NotableMove;
  const onK = ["m1", "m2", "m3"].map((c) => ({ ...mv(`${c}-a`, "new", 100), cik: c, manager: c, issuer: "K", ikey: "K" }) as NotableMove);
  const kModel = buildSignalsInstitutional({ present: true, period: FIXTURE_PERIOD, latestFiled: "2026-07-31", freshness: "f", notableManagers: 3, moves: [...onK, two], leaders: null, txns: [], filerHref: (c) => `/f/${c}`, filerTier: () => "top" });
  const row = kModel.board!.rows[0]!;
  assert.equal(row.newStakes + row.adds, 4, "four kind counts");
  assert.equal(row.filers, 3, "three managers");
  assert.equal(text(domOf(signalsInstitutionalHtml(kModel, CTX)).querySelector('[data-card="consensus"] .si-card-src')), "3 filings — see the moves");
});

/* ---------------------------------------------------------------- T2.4: the rendering */

/** The Named moves as a reader with script has them once every row has been
    opened: the client renders each held row's body (LD11) from the row's own
    data. Returns the rows, still mounted, and the restore. */
function openedRows(model: ReturnType<typeof fixtureInstitutional>, opts: { bank?: boolean } = {}): { rows: MiniElement[]; restore(): void } {
  const { doc, restore } = installDom(signalsInstitutionalHtml(model, CTX));
  // without the bank, an opened body is the renderer's alone (no Congress lines copied in)
  if (opts.bank === false) doc.getElementById("mv-bank")!.innerHTML = "";
  const pager = initNamedMoves()!;
  /* launch M7a (D5): the rows past the first fifteen render from the island
     on demand; a reader who reveals them all has every row */
  const ids = namedMoveIds(model);
  if (ids.length > NAMED_MOVES_MIN) assert.ok(pager.materialize(ids.at(-1)!), "the island renders the last held row");
  const rows = doc.querySelectorAll("#mv-list article.mv-item");
  for (const r of rows) pager.fill(r.querySelector("details")!);
  return { rows, restore };
}

test("T2.4 (R12, LD11) + launch M7a (D5, LD27): the first 15 rows are in the page with their opened body; every row past them ships in the island as data, and the client renders it byte-for-byte as the server renders that held row", () => {
  const model = fixtureInstitutional();
  const html = signalsInstitutionalHtml(model, CTX);
  const root = domOf(html);
  const rows = root.querySelectorAll("article.mv-item");
  const ids = namedMoveIds(model);
  assert.equal(rows.length, NAMED_MOVES_MIN, "only the first fifteen rows are in the page");
  rows.forEach((r) => {
    assert.ok(r.querySelector(".mv-det")!.innerHTML.length > 0, "a server-visible row's body is rendered (a reader without script can open it)");
    assert.equal(r.getAttribute("data-fp"), null);
  });
  const raw = /<script type="application\/json" data-held-for="mv-list">([\s\S]*?)<\/script>/.exec(html)![1]!;
  assert.doesNotMatch(raw, /</, "the island is inert: no tag can open in it");
  const island = JSON.parse(raw) as HeldMoves;
  assert.doesNotMatch(JSON.stringify(island), /<\/?[a-z]/i, "data, never markup");
  assert.equal(island.rows.length, model.domSet.length - NAMED_MOVES_MIN, "every carried row past the fifteen");
  let held = 0;
  island.rows.forEach((r, k) => {
    const i = NAMED_MOVES_MIN + k;
    const client = moveRowFrom(r, island.sec, true, island.tv);
    assert.equal(client, moveRowHtml(model.domSet[i]!, ids[i]!, model, true, island.tv), `${ids[i]}: the client's held row is the server's`);
    const el = domOf(client).querySelector("article.mv-item")!;
    if (el.querySelector(".mv-det")!.innerHTML === "") {
      held++;
      assert.match(el.getAttribute("data-fp")!, /^\/institutional\/filers\/\d+\/#pos-/, "a held row carries its filer page");
    }
  });
  assert.ok(held > 0, "the fixture holds lean rows");
  // control: the row function reads the data — a changed count changes the row
  const r0 = island.rows[0]!;
  assert.notEqual(moveRowFrom({ ...r0, counted: r0.counted + 1 }, island.sec, true, island.tv), moveRowFrom(r0, island.sec, true, island.tv));
  const { rows: opened, restore } = openedRows(model, { bank: false });
  try {
    opened.forEach((r, i) => {
      // the server's body for the same move, rendered as a visible row
      const want = domOf(moveRowHtml(model.domSet[i]!, ids[i]!, model, false)).querySelector(".mv-det")!.innerHTML;
      assert.equal(r.querySelector(".mv-det")!.innerHTML, want, `${ids[i]}: the opened body`);
    });
    // control: a held row's data changed (its verification date) changes its body
    const lean = opened.find((r) => r.hasAttribute("data-fp") && r.querySelector(".mv-tk .mono-ticker"))!;
    lean.querySelector(".mv-det")!.innerHTML = "";
    lean.setAttribute("data-tv", "1999-01-01");
    initNamedMoves()!.fill(lean.querySelector("details")!);
    assert.match(text(lean.querySelector(".mv-facts")), /verified against the SEC company list on 1999-01-01/, "control: the body reads the row's data");
  } finally {
    restore();
  }
});

test("T2.4 (R12, LD11): every move row has its 13F receipt outside its summary; a ticker carries its verification; 15 rows show, the rest are held", () => {
  const model = fixtureInstitutional();
  const root = domOf(signalsInstitutionalHtml(model, CTX));
  assert.equal(root.querySelectorAll("article.mv-item").filter((r) => !r.hasAttribute("hidden")).length, NAMED_MOVES_MIN, "15 visible");
  const { rows, restore } = openedRows(model);
  try {
  assert.equal(rows.length, model.domSet.length);
  assert.deepEqual(rows.map((r) => r.getAttribute("id")), namedMoveIds(model), "anchors in DOM-set order");
  assert.equal(new Set(rows.map((r) => r.getAttribute("id"))).size, rows.length, "unique anchors");
  rows.forEach((r, i) => {
    const m = model.domSet[i]!;
    const src = r.querySelector("a.mv-src");
    assert.equal(src?.getAttribute("href"), m.doc, `${m.key}: the receipt`);
    assert.equal(src?.closest("summary"), null, "the receipt is never inside the disclosure button");
    assert.equal(r.querySelector("details.mv-row")?.getAttribute("name"), "mv-rows", "one open at a time");
    assert.equal(r.getAttribute("data-kind"), m.kind);
    assert.equal(r.getAttribute("data-type"), m.type);
    assert.equal(r.getAttribute("data-ikey"), moveNameKey(m));
    assert.equal(r.querySelector(".mv-fil time")?.getAttribute("datetime"), m.filed, "the filed date");
    if (m.ticker) assert.match(text(r.querySelector(".mv-facts")), new RegExp(`${m.ticker} — verified against the SEC company list on ${m.ticker_verified}`));
    else assert.equal(text(r.querySelector(".mv-cong")), "No reviewed ticker, so no Congress match.", "a name no reviewed ticker maps says so");
    assert.match(r.querySelector(".mv-facts a")!.getAttribute("href")!, /^\/institutional\/filers\/\d+\/#pos-/, "the filer-page anchor");
  });
  } finally {
    restore();
  }
});

/** The Congress count a move's row should state, recomputed from the rows
    without the join module: distinct non-broad members, listed stock, the
    quarter's trade dates, the move's side. */
function recount(txns: readonly TxnRow[], ticker: string, side: "buy" | "sell"): number {
  const lines = txns.filter((t) => !t.flags.includes("date_anomaly") && t.traded && t.traded >= "2026-01-01" && t.traded <= FIXTURE_PERIOD && (t.assetType === "ST" || t.assetType === "Stock") && t.ticker);
  const breadth = new Map<string, Set<string>>();
  for (const t of lines.filter((l) => ["purchase", "sale", "sale_partial"].includes(l.side))) {
    const k = t.bioguide ?? `raw:${t.name}`;
    breadth.set(k, (breadth.get(k) ?? new Set()).add(normalizeTicker13f(t.ticker!)));
  }
  const want = side === "buy" ? ["purchase"] : ["sale", "sale_partial"];
  return new Set(lines.filter((t) => normalizeTicker13f(t.ticker!) === normalizeTicker13f(ticker) && want.includes(t.side) && breadth.get(t.bioguide ?? `raw:${t.name}`)!.size <= BROAD_ACCOUNT_NAMES).map((t) => t.bioguide ?? `raw:${t.name}`)).size;
}

test("T2.4 (R13, LD10): the Congress column equals an independent recount; no ticker and only-broad-accounts are stated", () => {
  const model = fixtureInstitutional();
  const txns = fixtureTxns();
  const root = domOf(signalsInstitutionalHtml(model, CTX));
  const opened = openedRows(model);
  const rows = opened.rows;
  opened.restore();
  let nonZero = 0;
  rows.forEach((r, i) => {
    const m = model.domSet[i]!;
    const cell = text(r.querySelector(".mv-cg [aria-hidden]"));
    if (!m.ticker) {
      assert.equal(cell, "—");
      assert.match(text(r.querySelector(".mv-cg .visually-hidden")), /no reviewed ticker, so no Congress match/);
      assert.equal(text(r.querySelector(".mv-cong")), "No reviewed ticker, so no Congress match.");
      return;
    }
    const n = recount(txns, m.ticker, moveSide(m.kind));
    assert.equal(cell, n > 0 ? `${moveSide(m.kind) === "buy" ? "▲" : "▼"}${n}` : "—", `${m.ticker} ${m.kind}`);
    if (n > 0) nonZero++;
  });
  assert.ok(nonZero > 0, "the fixture has moves with Congress members");
  // NVDA's buy side: the broad account (26 names) is named, not counted
  const nvdaBuy = quarterMembers(model.quarter, "NVDA", "buy");
  assert.ok(nvdaBuy.every((x) => x.breadth <= BROAD_ACCOUNT_NAMES));
  assert.ok(quarterMembers(model.quarter, "NVDA", "buy", { includeBroad: true }).some((x) => x.name === "Broad Member"));
  const bank = root.querySelector('#mv-bank [data-cong="NVDA|buy"]')!;
  assert.match(text(bank), /Not counted, broad accounts: Broad Member \(26 names\)\./);
  // a name only broad accounts traded: say so
  const onlyBroad = buildSignalsInstitutional({
    present: true, period: FIXTURE_PERIOD, latestFiled: "2026-07-31", freshness: "f", notableManagers: 1,
    moves: [{ ...fixtureMoves(1)[0]!, ticker: "ZZ01", kind: "new" }], leaders: null, txns, filerHref: (c) => `/f/${c}`, filerTier: () => "top",
  });
  const only = domOf(signalsInstitutionalHtml(onlyBroad, CTX));
  assert.match(text(only.querySelector("article.mv-item .mv-cong")), /^Only broad accounts — members who traded more than 25 names in Q1 2026 — reported a purchase of ZZ01 traded in the quarter: Broad Member \(26 names\)\. They are not counted\.$/);
  assert.match(text(only.querySelector(".mv-cg .visually-hidden")), /only broad accounts/);
  // a HELD row whose side only broad accounts traded keeps its server body (the statement names them; the client cannot)
  const manyBroad = buildSignalsInstitutional({
    present: true, period: FIXTURE_PERIOD, latestFiled: "2026-07-31", freshness: "f", notableManagers: 1,
    moves: fixtureMoves(20).map((m) => ({ ...m, ticker: "ZZ01", kind: "new" as const })), leaders: null, txns, filerHref: (c) => `/f/${c}`, filerTier: () => "top",
  });
  const mb = installDom(signalsInstitutionalHtml(manyBroad, CTX));
  try {
    const heldBroad = initNamedMoves()!.materialize(namedMoveIds(manyBroad)[NAMED_MOVES_MIN]!)! as unknown as MiniElement;
    assert.ok(heldBroad.hasAttribute("hidden"), "a held row");
    assert.equal(heldBroad.getAttribute("data-fp"), null, "with no lean data");
    assert.match(text(heldBroad.querySelector(".mv-det .mv-cong")), /^Only broad accounts — .* Broad Member \(26 names\)\. They are not counted\.$/);
  } finally {
    mb.restore();
  }
});

/** The honesty fields one Congress line must carry (LD10). */
function lineProblems(li: MiniElement, t: TxnRow): string[] {
  const out: string[] = [];
  if (!li.querySelector(".cl-who a") && t.bioguide) out.push("member link");
  if (!text(li.querySelector(".cl-who")).includes(t.name)) out.push("member");
  if (!li.querySelector(".cl-who .aff")) out.push("party and state");
  if (!li.querySelector(".owner-note")) out.push("owner");
  if (!/^(BUY|SELL)$/.test(text(li.querySelector(".si-chip")))) out.push("side");
  if (!text(li.querySelector(".cl-amt"))) out.push("range");
  if (li.querySelector(".si-row-traded time")?.getAttribute("datetime") !== t.traded) out.push("traded");
  if (li.querySelector(".si-row-filed time")?.getAttribute("datetime") !== t.filed) out.push("filed");
  if (li.querySelector(".si-row-src a")?.getAttribute("href") !== t.doc) out.push("receipt");
  return out;
}

test("T2.4 (R13, R24, LD10): an opened move row lists its side's Congress lines through the one line renderer — member, party and state, owner, side, range, both dates, receipt; removing any fails", () => {
  const model = fixtureInstitutional();
  const html = signalsInstitutionalHtml(model, CTX);
  const { doc, restore } = installDom(html);
  try {
    const pager = initNamedMoves()!;
    const m = model.domSet.find((x) => x.ticker === "AAPL" && moveSide(x.kind) === "buy")!;
    const row = doc.querySelectorAll("article.mv-item")[model.domSet.indexOf(m)]!;
    // server: the count and a pointer to the bank (each (ticker, side) is rendered once)
    assert.match(text(row.querySelector(".mv-cong-h")), /^Congress · 2 members with a purchase of AAPL traded in Q1 2026$/);
    assert.equal(row.querySelector(".mv-cong-link a")!.getAttribute("href"), "#mvc-aapl-buy");
    assert.ok(doc.getElementById("mvc-aapl-buy"), "the pointer's target is in the page, without script");
    // opened: the lines are copied in
    row.querySelector("details")!.setAttribute("open", "");
    pager.fill(row);
    const lines = row.querySelectorAll(".mv-cong .cl-line");
    const members = quarterMembers(model.quarter, "AAPL", "buy").flatMap((x) => x.rows);
    assert.equal(lines.length, members.length);
    lines.forEach((li, i) => assert.deepEqual(lineProblems(li, members[i]!), [], members[i]!.txnId));
    assert.equal(row.querySelector(".mv-cong-link"), null, "the pointer gives way to the lines");
    // a member with no page is named, unlinked; the owner unstated is stated
    const unjoined = lines.find((li) => text(li).includes("Unjoined Filer"))!;
    assert.equal(unjoined.querySelector(".cl-who a"), null);
    assert.match(text(lines.find((li) => text(li).includes("Member A"))!.querySelector(".owner-note")), /^owner not stated$/);
    // NVDA's buy side has 13 + 1 lines: twelve listed, the rest on the ticker page
    const nvda = doc.querySelectorAll("article.mv-item")[model.domSet.findIndex((x) => x.ticker === "NVDA" && moveSide(x.kind) === "buy")]!;
    pager.fill(nvda);
    assert.equal(nvda.querySelectorAll(".cl-line").length, 12);
    assert.match(text(nvda.querySelector(".mv-cong-more")), /^2 more lines on the ticker page ↗$/);
  } finally {
    restore();
  }
  // removal controls: deleting the owner, either date or the receipt from the renderer fails the reading
  const t = fixtureTxns()[0]!;
  const one = congressLineHtml(t, CTX);
  const li = (h: string) => domOf(`<ul>${h}</ul>`).querySelector("li")!;
  assert.deepEqual(lineProblems(li(one), t), []);
  const cut = (re: RegExp): string[] => {
    const h = one.replace(re, "");
    assert.notEqual(h, one, `control ${re} found`);
    return lineProblems(li(h), t);
  };
  assert.deepEqual(cut(/<span class="owner-note">[^<]*<\/span>/), ["owner"]);
  assert.deepEqual(cut(/<span class="si-row-traded">.*?<\/span>/), ["traded"]);
  assert.deepEqual(cut(/<span class="si-row-filed">.*?<\/span>/), ["filed"]);
  assert.deepEqual(cut(/<span class="si-row-src cl-src">.*<\/span><\/li>$/), ["receipt"]);
  assert.deepEqual(cut(/<span class="cl-amt">[^<]*<\/span>/), ["range"]);
});

test("T2.4 (R14, LD12): Consensus shows 10 rows, holds the rest behind a DOM-backed Show all, and each row is a pressed-state button over its cells with a Congress count", () => {
  const moves: NotableMove[] = [];
  // 14 names, each opened by 3 notable managers: a board of 14
  for (let k = 0; k < 14; k++) for (let i = 0; i < 3; i++) moves.push({ ...fixtureMoves(1)[0]!, cik: String(5000 + k * 3 + i).padStart(10, "0"), key: `sid:c${k}:${i}`, ikey: `cusip6:c${k}`, issuer: `NAME ${k}`, ticker: k === 0 ? "NVDA" : null, kind: "new", delta_value: 1000 - k });
  const model = buildSignalsInstitutional({ present: true, period: FIXTURE_PERIOD, latestFiled: "2026-07-31", freshness: "f", notableManagers: 42, moves, leaders: null, txns: fixtureTxns(), filerHref: (c) => `/f/${c}`, filerTier: () => "top" });
  const root = domOf(signalsInstitutionalHtml(model, CTX));
  const list = root.querySelector("#consensus-list")!;
  const rows = list.querySelectorAll(".cs-row");
  assert.equal(CONSENSUS_COMPACT_ROWS, 10);
  assert.equal(rows.length, 14);
  assert.equal(rows.filter((r) => !r.hasAttribute("data-compact-extra")).length, 10);
  assert.equal(list.getAttribute("data-collapsed"), "true");
  const disc = root.querySelector('.compact-disclosure[data-compact-for="consensus-list"]')!;
  assert.ok(disc.hasAttribute("data-compact-dom"), "DOM-backed");
  assert.equal(text(disc.querySelector(".compact-bound-count")), "1–10 of 14 issuers");
  for (const r of rows) {
    const b = r.querySelector("button.cs-pick")!;
    assert.equal(b.getAttribute("aria-pressed"), "false");
    assert.equal(b.getAttribute("data-mv-name"), r.getAttribute("data-ikey"));
    // its accessible name is the row's own text, never a filed name copied into an attribute
    assert.equal(b.getAttribute("aria-label"), null);
    const ids = b.getAttribute("aria-labelledby")!.split(" ");
    assert.match(text(root.querySelector(`#${ids.at(-1)!}`)), /: 3 new stakes\. Filter the moves to it\.$/);
  }
  // the Congress count on NVDA's row: both sides, recounted
  const nv = rows[0]!;
  assert.equal(text(nv.querySelector(".cs-cg [aria-hidden]")), `▲${recount(fixtureTxns(), "NVDA", "buy")} ▼${recount(fixtureTxns(), "NVDA", "sell")}`);
  assert.match(text(rows[1]!.querySelector(".cs-cg .visually-hidden")), /no reviewed ticker, so no Congress match/);
  // the count stays visible; the exclusions are the tip
  assert.equal(text(root.querySelector("p.cs-count")), "14 issuers qualify");
});

test("T2.4 (R15, LD12): each leader names its largest new position — or states that the aggregate does not; the rule and counts are the tip, the count visible", () => {
  const html = convictionLeadersHtml(fixtureLeaders(), () => "top", FIXTURE_PERIOD);
  const root = domOf(html);
  const tops = root.querySelectorAll("li.cv-row .cv-top").map((e) => text(e));
  assert.deepEqual(tops, [
    "Largest new: NVDA NVIDIA CORP · $576M · 6.4% of book",
    "Largest new: PRIVATE HOLDINGS LP · $82.0M · 4.1% of book",
    "Largest new position not named in this aggregate",
  ]);
  assert.equal(text(root.querySelector("p.cv-count")), "New stakes ≥2% of book · 2026-03-31 · 3 filers qualify");
  assert.match(text(root.querySelector(".note-pop")), /notable managers whose complete 13F long book has at least 20 positions/);
  assert.equal(root.querySelector("h2")!.innerHTML, '<span class="ref-label">Conviction leaders</span>', "the owner's label, markup-bound (LD20)");
});

test("T2.4 (R16, LD9): the tab states its quarter and the newest filing; every hidden-ledger value is stated inside its panel; absences are stated, never simulated", () => {
  const model = fixtureInstitutional();
  const html = signalsBody({ v: 1, buildId: "b", computedAt: "2026-07-24", thresholdVersion: "1", retentionDays: 90, coverageFrom: "2026-04-25", coverageTo: "2026-07-24", lifecycleNote: "n", compaction: "none", dateAnomaliesExcluded: 0, lagCaveat: "c", withheld: [], signals: [] } as never, CTX, { rowsEvaluated: 0, triage: null, institutional: model });
  const root = domOf(html);
  const panel = root.querySelector("#institutional")!;
  assert.equal(panel.getAttribute("data-quarter"), FIXTURE_PERIOD);
  const chips = panel.querySelectorAll(".sig-prov .sig-pchip").map((c) => text(c));
  assert.deepEqual(chips, ["13F · Q1 2026 · quarter ended 2026-03-31", "Filings through 2026-07-31"]);
  assert.ok(panel.querySelector(".sig-pchip-warn"), "the newest filing in amber");
  assert.match(text(panel.querySelector(".sig-prov .note-pop")), /snapshot of the quarter ended 2026-03-31: positions at quarter end, long only, filed up to 45 days after the quarter — never current holdings\. An exit is inferred from absence in the next filing\./);
  // the hidden ledger group's values are each in the panel's own text
  const group = root.querySelector('.page-head [data-tab-for="institutional"]')!;
  assert.ok(group.hasAttribute("hidden"), "hidden without script");
  const values = group.querySelectorAll(".ledger-value").map((v) => text(v));
  assert.equal(values.length, 3);
  for (const v of values) assert.ok(text(panel).includes(v), `"${v}" is stated in the panel`);
  // the §5 note ships with the 13F data
  assert.ok(panel.querySelector("#inst-data-note"), "the §5 data note");
  // absences: no module, no closed quarter, the artifact-only view
  const absent = buildSignalsInstitutional({ present: false, absentReason: "module-absent", period: null, latestFiled: null, freshness: "", notableManagers: 0, moves: [], leaders: null, txns: [], filerHref: () => "", filerTier: () => "tail" });
  assert.match(signalsInstitutionalHtml(absent, CTX), /not in this build \(module-absent\) — absence is stated, not simulated/);
  const noQuarter = buildSignalsInstitutional({ present: true, period: null, latestFiled: "2026-07-31", freshness: "f", notableManagers: 0, moves: [], leaders: null, txns: [], filerHref: () => "", filerTier: () => "tail" });
  assert.match(signalsInstitutionalHtml(noQuarter, CTX), /no closed quarter to read\. That is a statement about the calendar, not an absence of data\./);
  assert.match(signalsInstitutionalHtml(null, CTX), /this view carries the Congress artifact only/);
});

/* ---------------------------------------------------------------- T2.4: the client */

interface Mount {
  doc: ReturnType<typeof installDom>["doc"];
  win: { matches: boolean; listeners: Map<string, (() => void)[]>; mq: (() => void)[] };
  env: TabsEnv & { location: { hash: string }; replaced: string[]; fire(hash: string): void };
  scrolled: string[];
  restore(): void;
}
/** The whole page (both tabs), a window whose `(max-width: 1080px)` answer
    is `stacked`, and an address bar. */
function mount(stacked: boolean, hash = "", model: ReturnType<typeof fixtureInstitutional> = fixtureInstitutional()): Mount {
  const art = { v: 1, buildId: "b", computedAt: "2026-07-24", thresholdVersion: "1", retentionDays: 90, coverageFrom: "2026-04-25", coverageTo: "2026-07-24", lifecycleNote: "n", compaction: "none", dateAnomaliesExcluded: 0, lagCaveat: "c", withheld: [], signals: [] } as never;
  const dom = installDom(signalsBody(art, CTX, { rowsEvaluated: 0, triage: null, institutional: model }));
  const g = globalThis as unknown as Record<string, unknown>;
  const prev = { window: g.window, location: g.location, history: g.history };
  const win: Mount["win"] = { matches: stacked, listeners: new Map(), mq: [] };
  g.window = {
    matchMedia: (q: string) => ({
      get matches() {
        return q === STACKED_QUERY ? win.matches : false;
      },
      addEventListener: (_t: string, fn: () => void) => void win.mq.push(fn),
    }),
    addEventListener: (t: string, fn: () => void) => void win.listeners.set(t, [...(win.listeners.get(t) ?? []), fn]),
  };
  const loc = { hash };
  g.location = loc;
  g.history = { pushState: (_s: unknown, _t: string, url: string) => void (loc.hash = url) };
  let onHash: (() => void) | null = null;
  const replaced: string[] = [];
  const env = {
    location: loc,
    replaced,
    history: { replaceState: (_d: unknown, _u: string, url?: string) => void replaced.push(url ?? "") },
    getElementById: (id: string) => dom.doc.getElementById(id) as unknown as Element | null,
    onHashChange: (fn: () => void) => void (onHash = fn),
    fire(h: string) {
      loc.hash = h;
      onHash?.();
      for (const fn of win.listeners.get("hashchange") ?? []) fn();
    },
  };
  const scrolled: string[] = [];
  const proto = MiniElement.prototype as unknown as { scrollIntoView?: () => void };
  proto.scrollIntoView = function (this: MiniElement) {
    scrolled.push(this.getAttribute("id") ?? this.tagName);
  };
  return {
    doc: dom.doc,
    win,
    env,
    scrolled,
    restore() {
      delete proto.scrollIntoView;
      dom.restore();
      g.window = prev.window;
      g.location = prev.location;
      g.history = prev.history;
    },
  };
}
const visibleRows = (doc: Mount["doc"]): MiniElement[] => doc.querySelectorAll("#mv-list article.mv-item").filter((r) => !r.hasAttribute("hidden"));

test("T2.4 (R12, LD6, LD11): a kind chip shows only that kind; the count is the slice total; the page's bound appears where the DOM runs out; a filter change drops the extension", () => {
  const m = mount(false);
  try {
    const model = fixtureInstitutional();
    const pager = initNamedMoves()!;
    const doc = m.doc;
    const range = () => text(doc.getElementById("mv-range"));
    assert.equal(range(), namedMovesRangeText(15, 200), "load: 1–15 of the whole population");
    // a kind chip: only exits, the exit slice's true total
    const exitChip = doc.querySelector('button[data-mv-kind="exit"]')!;
    exitChip.bubbleClick();
    assert.equal(exitChip.getAttribute("aria-pressed"), "true");
    assert.ok(visibleRows(doc).length > 0 && visibleRows(doc).every((r) => r.getAttribute("data-kind") === "exit"));
    const exitTotal = model.totals["exit|any"]!;
    assert.equal(range(), namedMovesRangeText(Math.min(15, visibleRows(doc).length), exitTotal));
    // a type chip refines within it (single-select per group)
    doc.querySelector('button[data-mv-type="insurer"]')!.bubbleClick();
    assert.ok(visibleRows(doc).every((r) => r.getAttribute("data-kind") === "exit" && r.getAttribute("data-type") === "insurer"));
    /* launch M7a: the rows the page carries are the DOM's and the island's (the DOM set) */
    const held = model.domSet.filter((x) => x.kind === "exit" && x.type === "insurer").length;
    const sliceTotal = model.totals["exit|insurer"]!;
    // the count is the slice's TRUE total; the bound shows only once the shown rows exhaust the held ones short of it
    const shownNow = Math.min(15, held);
    assert.equal(range(), namedMovesRangeText(shownNow, sliceTotal));
    assert.equal(doc.getElementById("mv-bound")!.hasAttribute("hidden"), !(shownNow === held && held < sliceTotal));
    // pressing it again toggles it off
    doc.querySelector('button[data-mv-type="insurer"]')!.bubbleClick();
    exitChip.bubbleClick();
    assert.equal(range(), namedMovesRangeText(15, 200), "back to every move");
    // "Show 15 more" extends past the base until the DOM runs out; then the bound is stated
    const more = doc.getElementById("mv-more")!;
    for (let i = 0; i < 40 && more.getAttribute("aria-disabled") !== "true"; i++) more.click();
    const dom = doc.querySelectorAll("#mv-list article.mv-item").length;
    assert.equal(visibleRows(doc).length, dom, "every held row shows");
    assert.equal(range(), namedMovesRangeText(dom, 200));
    assert.equal(doc.getElementById("mv-bound")!.hasAttribute("hidden"), false, "the DOM ran out before the total: the bound is stated");
    assert.equal(text(doc.getElementById("mv-bound")), namedMovesBoundText(dom));
    assert.ok(pager.state().extra > 0);
    // a filter change drops the extension (LD6's contract)
    doc.querySelector('button[data-mv-kind="new"]')!.bubbleClick();
    assert.equal(pager.state().extra, 0);
    assert.equal(visibleRows(doc).length, Math.min(15, doc.querySelectorAll('#mv-list article.mv-item[data-kind="new"]').length));
    // the fit's view of the list: matching rows, visible rows, extra
    const ft = pager.fitTarget;
    assert.equal(ft.matching(), doc.querySelectorAll('#mv-list article.mv-item[data-kind="new"]').length);
    ft.apply(20);
    assert.equal(ft.visible(), Math.min(20, ft.matching()));
    assert.equal(pager.state().base, 20);
  } finally {
    m.restore();
  }
});

test("T2.4 (R11, R14): a name filter lists EVERY move on its key and clears the chips; the pill clears it; the Consensus row shows pressed and the name's Congress detail shows", () => {
  const m = mount(false);
  try {
    const model = fixtureInstitutional();
    initNamedMoves();
    const doc = m.doc;
    doc.querySelector('button[data-mv-kind="trim"]')!.bubbleClick();
    /* a Consensus name members of Congress traded (both sides), so its detail lists lines */
    const top = model.board!.rows.find((r) => r.ticker === "NVDA")!;
    assert.ok(top, "precondition: NVDA is on the board");
    const key = top.issuerKey;
    const pager = initNamedMoves()!; // a second binder over the same rows: it reads the DOM, never a cache
    pager.setName(key);
    const all = model.moves.filter((x) => moveNameKey(x) === key).length;
    const vis = () => visibleRows(m.doc);
    assert.ok(all > 15, "the fixture's top name has more moves than the base");
    /* launch M7a: the page carries every move on the key — in the DOM or its island */
    assert.equal(model.domSet.filter((x) => moveNameKey(x) === key).length, all, "the page carries every move on the key");
    assert.equal(doc.querySelectorAll(`#mv-list article.mv-item[data-ikey="${key}"]`).filter((r) => !r.hasAttribute("hidden")).length, Math.min(15, all), "the first fifteen show, rendered from the island where needed");
    assert.ok(vis().every((r) => r.getAttribute("data-ikey") === key));
    assert.equal(text(doc.getElementById("mv-range")), namedMovesRangeText(Math.min(15, all), all), "the total is the DOM's own count, complete for the key");
    assert.ok(doc.querySelectorAll("button[data-mv-kind], button[data-mv-type]").every((b) => b.getAttribute("aria-pressed") === "false"), "the name clears the chips");
    assert.equal(doc.getElementById("mv-name-row")!.hasAttribute("hidden"), false);
    assert.ok(text(doc.getElementById("mv-name-label")).includes(top.issuer), "the pill names it, read off its rows");
    assert.equal(doc.querySelector(`button.cs-pick[data-mv-name="${key}"]`)!.getAttribute("aria-pressed"), "true");
    const detail = doc.querySelector(`[data-mv-detail-for="${key}"]`)!;
    assert.equal(detail.hasAttribute("hidden"), false, "the name's Congress detail shows");
    assert.equal(detail.querySelectorAll(".cl-line").length, 12 + quarterMembers(model.quarter, "NVDA", "sell").flatMap((x) => x.rows).length, "both sides' lines are filled from the bank (twelve on the buy side, the rest on the ticker page)");
    // the chips refine within the name
    doc.querySelector('button[data-mv-kind="new"]')!.bubbleClick();
    assert.ok(vis().every((r) => r.getAttribute("data-ikey") === key && r.getAttribute("data-kind") === "new"));
    // the pill clears it
    doc.getElementById("mv-name-pill")!.click();
    assert.equal(pager.state().name, null);
    assert.equal(doc.getElementById("mv-name-row")!.hasAttribute("hidden"), true);
    assert.equal(detail.hasAttribute("hidden"), true);
  } finally {
    m.restore();
  }
});

test("T2.4 (R9, LD7, LD8): revealTarget — on a phone a Consensus row selects the Moves pane, applies the name and scrolls to the moves; a card does the same from the leaders' pane; a hash to #consensus selects its pane; a hash to a held move clears the filter and shows it", () => {
  const m = mount(true);
  try {
    const model = fixtureInstitutional();
    initSignalsPage({ tabsEnv: m.env });
    const doc = m.doc;
    const pane = (id: string) => doc.getElementById(id)!.hasAttribute("hidden");
    const sw = doc.querySelectorAll("[data-pane-switch]")[1]!;
    assert.deepEqual(sw.querySelectorAll("button").map((b) => b.getAttribute("aria-controls")), ["named-moves", "consensus", "new-position-leaders"]);
    assert.equal(sw.hasAttribute("hidden"), false, "stacked: the Institutional switch shows");
    // select Consensus, then click a Consensus row
    (sw.querySelectorAll("button")[1] as MiniElement).click();
    assert.equal(pane("named-moves"), true, "precondition: the moves are the hidden pane");
    const key = model.board!.rows[1]!.issuerKey;
    doc.querySelector(`button.cs-pick[data-mv-name="${key}"]`)!.click();
    assert.equal(pane("named-moves"), false, "the Moves pane is selected");
    assert.equal(pane("consensus"), true);
    assert.ok(visibleRows(doc).every((r) => r.getAttribute("data-ikey") === key), "the name filter applies");
    assert.equal(m.scrolled.at(-1), "named-moves", "and the moves scroll into view");
    assert.equal(doc.getElementById("tab-institutional")!.getAttribute("aria-selected"), "true", "its tab is selected");
    // the same from the leaders' pane through a lead card
    (sw.querySelectorAll("button")[2] as MiniElement).click();
    assert.equal(pane("named-moves"), true);
    const card = doc.querySelector('[data-card="new"] a.si-card-open')!;
    card.click();
    assert.equal(pane("named-moves"), false);
    assert.ok(visibleRows(doc).every((r) => r.getAttribute("data-ikey") === card.getAttribute("data-mv-name")));
    // a hash naming #consensus while the moves are shown selects the Consensus pane
    m.env.fire("#consensus");
    assert.equal(pane("consensus"), false, "#consensus selects its pane");
    assert.equal(pane("named-moves"), true);
    // a hash to a move held back by a kind filter: the filter clears and the row shows, opened
    doc.getElementById("mv-name-pill")!.click();
    doc.querySelector('button[data-mv-kind="new"]')!.bubbleClick();
    /* launch M7a: a held trim row still in the island — the hash renders it, then reveals it */
    const allIds = namedMoveIds(fixtureInstitutional());
    const heldId = fixtureInstitutional().domSet.map((x, i) => ({ x, id: allIds[i]! })).filter(({ x, id }) => x.kind === "trim" && !doc.getElementById(id)).at(-1)!.id;
    assert.equal(doc.getElementById(heldId), null, "precondition: held in the island");
    m.env.fire(`#${heldId}`);
    const target = doc.getElementById(heldId)!;
    assert.ok(target, "rendered from its island");
    assert.equal(target.hasAttribute("hidden"), false, "the row shows");
    assert.ok(doc.querySelectorAll("button[data-mv-kind]").every((b) => b.getAttribute("aria-pressed") === "false"), "the filter cleared");
    assert.ok(target.querySelector("details")!.hasAttribute("open"), "and it opens");
    assert.equal(pane("named-moves"), false, "its pane is selected");
    // the Congress tab: a hash to the institutional panel from the Congress tab selects it
    m.env.fire("#congress");
    assert.equal(doc.getElementById("institutional")!.hasAttribute("hidden"), true);
    assert.equal(revealHash("#named-moves")?.getAttribute("id"), "named-moves");
    assert.equal(doc.getElementById("institutional")!.hasAttribute("hidden"), false, "a target inside a panel selects its tab");
    assert.equal(doc.getElementById("congress")!.hasAttribute("hidden"), true);
    // a target that is not in the page: nothing
    assert.equal(revealTarget(null), null);
  } finally {
    m.restore();
  }
});

test("T2.4 (R7, LD7): side by side, every pane shows and the switch hides; without script every pane is visible", () => {
  const html = signalsInstitutionalHtml(fixtureInstitutional(), CTX);
  const root = domOf(html);
  const sw = root.querySelector("[data-pane-switch]")!;
  assert.ok(sw.hasAttribute("hidden"), "server: hidden");
  for (const id of ["named-moves", "consensus", "new-position-leaders"]) assert.ok(!root.querySelector(`#${id}`)!.hasAttribute("hidden"), `server: #${id} visible`);
  assert.equal(sw.querySelectorAll("button")[2]!.innerHTML, '<span class="ref-label">Conviction</span>', "the short reference label, markup-bound (LD20)");
  const m = mount(false);
  try {
    initPaneSwitches();
    const s = m.doc.querySelectorAll("[data-pane-switch]")[1]!;
    assert.ok(s.hasAttribute("hidden"));
    for (const id of ["named-moves", "consensus", "new-position-leaders"]) assert.ok(!m.doc.getElementById(id)!.hasAttribute("hidden"));
  } finally {
    m.restore();
  }
});

/* ---------------------------------------------------------------- codex M2 round 2 */

test("T2.4 (R13, R24; codex M2 r2 F2): a Consensus name only broad accounts traded says so on its row, its name detail, the Consensus card and its moves — never 'no member'; without that broad line each says none", () => {
  const model = fixtureInstitutional({ moves: fixtureMoves(200, { broadOnly: 10 }) });
  assert.equal(quarterMembers(model.quarter, "ZZ01", "buy").length, 0, "precondition: no counted member");
  assert.deepEqual(quarterMembers(model.quarter, "ZZ01", "buy", { includeBroad: true }).map((x) => x.name), ["Broad Member"], "precondition: the broad account bought it");
  assert.equal(quarterMembers(model.quarter, "ZZ01", "sell", { includeBroad: true }).length, 0, "precondition: nobody sold it");
  assert.equal(model.board!.rows[0]!.issuerKey, BROAD_ONLY_KEY, "precondition: ZZ01 is Consensus row 1, so the Consensus card");
  const read = (mdl: ReturnType<typeof fixtureInstitutional>) => {
    const root = domOf(signalsInstitutionalHtml(mdl, CTX));
    const cs = root.querySelector(`#consensus-list .cs-row[data-ikey="${BROAD_ONLY_KEY}"]`)!;
    const mv = root.querySelector(`#mv-list article.mv-item[data-ikey="${BROAD_ONLY_KEY}"]`)!;
    return {
      row: text(cs.querySelector(".cs-cg .visually-hidden")),
      rowGlyph: text(cs.querySelector(".cs-cg [aria-hidden]")),
      detail: text(root.querySelector(`[data-mv-detail-for="${BROAD_ONLY_KEY}"]`)),
      card: text(root.querySelector('[data-card="consensus"] .si-card-dates')),
      move: text(mv.querySelector(".mv-cg .visually-hidden")),
      body: text(mv.querySelector(".mv-det .mv-cong")),
    };
  };
  const r = read(model);
  assert.equal(r.row, "Congress: only broad accounts (1) traded it in the quarter, not counted", "the Consensus row");
  assert.equal(r.rowGlyph, "—");
  assert.match(r.detail, /Only broad accounts — members who traded more than 25 names in Q1 2026 — reported a purchase of ZZ01 traded in the quarter: Broad Member \(26 names\)\. They are not counted\./, "the name's detail: the purchase side names the account");
  assert.match(r.detail, /None: no member of Congress reported a listed-stock sale of ZZ01 traded in Q1 2026\./, "the name's detail: the sale side — nobody, broad or not");
  assert.match(r.card, /Congress same quarter ▲0 ▼0.* · only broad accounts traded it, not counted: Broad Member \(26 names\)$/, "the Consensus card");
  assert.equal(r.move, "Congress: only broad accounts on this side, not counted", "a move row's cell");
  assert.match(r.body, /^Only broad accounts — .*Broad Member \(26 names\)\. They are not counted\.$/, "a move row's opened body");
  for (const [k, v] of Object.entries(r)) assert.doesNotMatch(v, /no member of Congress traded it|Congress: none/, `${k}: never the generic zero`);
  // control: without the broad account's ZZ01 line, every one of them says none
  const none = read(fixtureInstitutional({ moves: fixtureMoves(200, { broadOnly: 10 }), txns: fixtureTxns().filter((t) => t.ticker !== "ZZ01") }));
  assert.equal(none.row, "no member of Congress traded it in the quarter");
  assert.equal(none.move, "Congress: none on this side");
  assert.doesNotMatch(none.card, /broad/);
  assert.match(none.card, /Congress same quarter ▲0 ▼0/);
  assert.match(none.detail, /None: no member of Congress reported a listed-stock purchase of ZZ01/);
  assert.doesNotMatch(none.detail + none.body, /broad/i);
});

test("T2.4 (R12, R13, LD11, D11; codex M2 r2 F3): a HELD row a reader pages to and opens — a summary click, then the browser's toggle — gets its body: filer page, verification, filed date and quarter, and its side's Congress lines with range, both dates, owner and receipt", () => {
  const m = mount(false);
  try {
    const model = fixtureInstitutional();
    initSignalsPage({ tabsEnv: m.env });
    const doc = m.doc;
    const lean = () => visibleRows(doc).find((r) => r.hasAttribute("data-fp") && r.hasAttribute("data-cg") && r.querySelector(".mv-det")!.innerHTML === "");
    const more = doc.getElementById("mv-more")!;
    assert.equal(lean(), undefined, "precondition: at load no held row shows");
    for (let i = 0; i < 20 && !lean(); i++) more.click();
    const row = lean()!;
    assert.ok(row, "paging shows a held row whose side has counted members");
    const mv = model.domSet[doc.querySelectorAll("#mv-list article.mv-item").indexOf(row)]!;
    const side = moveSide(mv.kind);
    const summary = row.querySelector("summary")!;
    summary.activate();
    assert.ok(row.querySelector("details.mv-row")!.hasAttribute("open"), "the reader's click opened it");
    const facts = text(row.querySelector(".mv-facts"));
    assert.match(facts, new RegExp(` · filed ${mv.filed} · quarter ended ${FIXTURE_PERIOD}`), "the filed date and the quarter");
    assert.match(facts, new RegExp(`${mv.ticker} — verified against the SEC company list on ${mv.ticker_verified}`), "the verification statement");
    assert.equal(row.querySelector(".mv-facts a")!.getAttribute("href"), row.getAttribute("data-fp"), "the filer-page link");
    assert.match(text(row.querySelector(".mv-cong-h")), new RegExp(`^Congress · \\d+ members? with a ${side === "buy" ? "purchase" : "sale"} of ${mv.ticker} traded in Q1 2026$`));
    const want = quarterMembers(model.quarter, mv.ticker, side).flatMap((x) => x.rows).slice(0, 12);
    const lines = row.querySelectorAll(".mv-cong .cl-line");
    assert.ok(want.length > 0);
    assert.equal(lines.length, want.length, "its side's Congress lines, copied in");
    lines.forEach((li, k) => assert.deepEqual(lineProblems(li, want[k]!), [], want[k]!.txnId));
    // closed and opened again: one body, never two
    summary.activate();
    assert.equal(row.querySelector("details.mv-row")!.hasAttribute("open"), false);
    summary.activate();
    assert.equal(row.querySelectorAll(".mv-facts").length, 1);
    assert.equal(row.querySelectorAll(".mv-cong .cl-line").length, want.length);
  } finally {
    m.restore();
  }
});

test("T2.4 (R6, LD6; codex M2 r2 F1): a move row or the Congress-lines bank opening or closing asks the fit to re-run exactly once per toggle; a tip's popover does not", () => {
  const m = mount(false);
  try {
    const pager = initNamedMoves()!;
    let asked = 0;
    pager.onLayout = () => void asked++;
    const doc = m.doc;
    const rows = visibleRows(doc);
    rows[2]!.querySelector("summary")!.activate();
    assert.equal(asked, 1, "opened: one request");
    rows[2]!.querySelector("summary")!.activate();
    assert.equal(asked, 2, "closed: one more");
    // a second row opened while one is open: the browser closes the first (one name group) — two toggles, two requests
    rows[3]!.querySelector("summary")!.activate();
    rows[4]!.querySelector("summary")!.activate();
    assert.equal(rows[3]!.querySelector("details")!.hasAttribute("open"), false, "the exclusive group closed the first");
    assert.equal(asked, 5);
    doc.getElementById("mv-bank")!.children.find((c) => c.tagName === "summary")!.activate();
    assert.equal(asked, 6, "the bank opening changes the column's height too");
    // a tip's popover fires `toggle` as well, from the top layer: no height change, no request
    const pop = doc.querySelector("#named-moves .note-pop")!;
    const path: MiniElement[] = [];
    for (let n = pop.parent; n; n = n.parent) path.unshift(n);
    for (const n of path) n.deliver("toggle", { type: "toggle", target: pop, newState: "open" }, "capture");
    assert.equal(asked, 6, "a popover is not a <details>");
  } finally {
    m.restore();
  }
});

test("T2.4 (R6, LD6; codex M2 r2 F1): on the page, a toggle re-runs the Named moves' fit — which never hides an OPEN row: the fitted count is at least the open row's place + 1", async () => {
  const m = mount(false);
  try {
    initSignalsPage({ tabsEnv: m.env });
    const pager = boundNamedMoves()!;
    const doc = m.doc;
    const tick = () => new Promise((r) => setTimeout(r, 0));
    // a fitted base of 25 (as a measured fit would leave it); this mount has no layout, so a refit takes the floor
    pager.fitTarget.apply(25);
    assert.equal(visibleRows(doc).length, 25);
    visibleRows(doc)[3]!.querySelector("summary")!.activate();
    await tick();
    assert.equal(visibleRows(doc).length, NAMED_MOVES_MIN, "the toggle re-ran the fit (here: the minimum, with row 4 open)");
    // a row far down the list open: the refit keeps it
    pager.fitTarget.apply(25);
    const deep = visibleRows(doc)[20]!;
    deep.querySelector("summary")!.activate();
    await tick();
    assert.ok(deep.querySelector("details")!.hasAttribute("open"));
    assert.equal(deep.hasAttribute("hidden"), false, "the open row stays visible");
    assert.equal(visibleRows(doc).length, 21, "the floor: the open row's place + 1");
    assert.equal(pager.fitTarget.floor!(), 21);
    // with a "Show more" extension the floor is less the extension (visible = base + extra)
    doc.getElementById("mv-more")!.click();
    assert.ok(pager.state().extra > 0);
    assert.equal(pager.fitTarget.floor!(), Math.max(0, 21 - pager.state().extra));
    assert.equal(deep.hasAttribute("hidden"), false);
    // closed: nothing pins the list
    deep.querySelector("summary")!.activate();
    await tick();
    assert.equal(pager.fitTarget.floor!(), 0);
  } finally {
    m.restore();
  }
});

test("T2.4 (R9, LD8; codex M2 r2 F4): a hash naming an element inside a HELD Consensus row (past ten) — on load and on a hashchange — expands Consensus through its Show all state, so the row shows and the control says so; a hash into the closed Congress-lines bank opens it", () => {
  const model = fixtureInstitutional({ moves: fixtureMoves(200, { consensusNames: 14 }) });
  assert.ok(model.board!.rows.length > 12, "precondition: a board past ten");
  const m = mount(false, "#cs-11-l", model);
  try {
    initSignalsPage({ tabsEnv: m.env });
    initDomDisclosures();
    const doc = m.doc;
    const list = doc.getElementById("consensus-list")!;
    const wrap = doc.querySelector('.compact-disclosure[data-compact-for="consensus-list"]')!;
    const btn = wrap.querySelector("button")!;
    const held = (id: string) => doc.getElementById(id)!.closest(".cs-row")!;
    assert.ok(held("cs-11-l").hasAttribute("data-compact-extra"), "precondition: row 11 is held back");
    const expanded = (label: string) => {
      assert.equal(list.getAttribute("data-collapsed"), "false", `${label}: the held rows show`);
      assert.equal(wrap.getAttribute("data-compact-expanded"), "1", `${label}: the disclosure's state`);
      assert.equal(btn.getAttribute("aria-expanded"), "true", `${label}: the control says so`);
      assert.equal(btn.hasAttribute("hidden"), false);
      assert.equal(text(btn), compactCollapseLabel("issuers", CONSENSUS_COMPACT_ROWS), `${label}: and offers to collapse`);
    };
    expanded("on load");
    assert.equal(doc.getElementById("tab-institutional")!.getAttribute("aria-selected"), "true", "its tab is selected");
    // the button and the rows still move together
    btn.click();
    assert.equal(list.getAttribute("data-collapsed"), "true");
    assert.equal(btn.getAttribute("aria-expanded"), "false");
    assert.equal(text(btn), compactShowAllLabel(model.board!.rows.length, "issuers"));
    // a hashchange to another held row expands it again
    m.env.fire("#cs-12-l");
    expanded("on a hashchange");
    // a hash to a row Consensus already shows changes nothing
    btn.click();
    m.env.fire("#cs-2-l");
    assert.equal(list.getAttribute("data-collapsed"), "true", "a shown row needs no expansion");
    // sibling: a hash into the closed "Congress lines behind the counts" bank opens it
    const bank = doc.getElementById("mv-bank")!;
    assert.equal(bank.hasAttribute("open"), false, "precondition: the bank is closed");
    m.env.fire("#mvc-aapl-buy");
    assert.equal(bank.hasAttribute("open"), true, "the bank opens around its target");
    assert.equal(m.scrolled.at(-1), "mvc-aapl-buy");
  } finally {
    m.restore();
  }
});
