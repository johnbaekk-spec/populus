/* Launch redesign M4a — the held-rows carrier (pagination-and-counts.md rule 8,
   LD26, R27).

   A held table keeps rows N+1.. out of the DOM; the client renders them from a
   JSON island through the SAME row function the server used. The property is
   byte parity: the server's first N rows followed by the binder's held rows
   equal the whole table rendered from independently recomputed inputs —
   including the inputs a client could NOT recompute from the held rows alone
   (the table-wide bar scale, an overlap with the last VISIBLE row, a budget-cut
   ticker's /e/ link). Each of those carries a re-planted control: drop the
   input from the island and the output must change, so the fixture provably
   exercises it. */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import {
  memberBody,
  memberNetRowHtml,
  memberHistoryRowHtml,
  MEMBER_NET_ROWS,
  MEMBER_HISTORY_ROWS,
  type BuildStamps,
} from "../src/lib/ui/index.ts";
import { heldTableParts, parseHeldIsland, type HeldIsland } from "../src/lib/held-rows.ts";
import { memberNetByTicker, rankNetRows, netOverlaps, type MemberEntity, type SumRanges } from "../src/lib/derive.ts";
import type { RenderCtx, TxnRow } from "../src/lib/format.ts";
import type { MemberNetRowIn, MemberNetShared } from "../src/lib/ui/congress.ts";
import { installDom } from "./lib/mini-dom.ts";
import { initDomDisclosures, registerHeldRows } from "../src/scripts/inst-index-client.ts";

const STAMPS: BuildStamps = { buildId: "t.1", generatedAt: "2026-08-12 00:00 UTC", generatedAtDate: "2026-08-12" };
const CUT = "T22";
const CTX: RenderCtx = { cutTickers: new Set([CUT]) };

function txn(i: number, over: Partial<TxnRow>): TxnRow {
  return {
    kind: "txn", txnId: `t-${i}`, asset: null, assetType: null,
    filed: `2026-07-${String(28 - (i % 28)).padStart(2, "0")}`, traded: "2026-06-24",
    name: "Heavy Member", bioguide: "H000001", party: "D", state: "NJ", district: "5",
    chamber: "house", ticker: null, side: "purchase", owner: "self",
    low: 1001, high: 15000, lag: 27, late: 0, flags: [],
    doc: `https://disclosures-clerk.house.gov/doc-${i % 15}.pdf`, ...over,
  };
}

/* 26 ranked tickers: T00 carries the table's largest provable minimum (so the
   bar scale is set by a VISIBLE row), T01..T25 share one bucket (so every net
   overlaps the row above it, across the 20-row boundary too); U1 and U2 have
   wholly-undisclosed purchases (the bucket, with its separator row); one row
   names no ticker. Fifteen distinct filings, so the history holds three. */
const TXNS: TxnRow[] = [
  txn(0, { ticker: "T00", low: 1_000_001, high: 5_000_000, asset: "T00 Holdings Inc - Common Stock", assetType: "ST" }),
  ...Array.from({ length: 25 }, (_, k) =>
    txn(k + 1, { ticker: `T${String(k + 1).padStart(2, "0")}`, asset: `Ticker ${k + 1} Corp [ST]`, assetType: "ST" }),
  ),
  txn(26, { ticker: "U1", low: null, high: null }),
  txn(27, { ticker: "U2", low: null, high: null }),
  txn(28, { ticker: null, asset: "A private fund" }),
].sort((a, b) => b.filed.localeCompare(a.filed));

const MEMBER: MemberEntity = {
  bioguide: "H000001", name: "Heavy Member", party: "D", state: "NJ", district: "5",
  chamber: "house", servingSince: "2017", filingCount: 15, txns: TXNS, paper: [],
};

const HTML = memberBody(MEMBER, STAMPS, CTX, 0);

/** The rows the server put in a tbody, split the way the renderer joined them. */
function tbodyRows(html: string, id: string): string[] {
  const m = new RegExp(`<tbody id="${id}"[^>]*>([\\s\\S]*?)</tbody>`).exec(html);
  assert.ok(m, `no tbody #${id}`);
  return m![1]!.split("\n").filter(Boolean);
}

function islandOf<R, S>(html: string, id: string): { render: string; data: HeldIsland<R, S> } {
  const m = new RegExp(`<script type="application/json" data-held-for="${id}" data-held-render="([^"]+)">([\\s\\S]*?)</script>`).exec(html);
  assert.ok(m, `no island for #${id}`);
  const data = parseHeldIsland(m![2]!);
  assert.ok(data, "the island parses");
  return { render: m![1]!, data: data as HeldIsland<R, S> };
}

/** The whole Top tickers table (all history) rendered from inputs
    recomputed HERE, from the rows — the reference the two carriers together
    must reproduce. */
function referenceNetRows(): string[] {
  const { rows } = memberNetByTicker(TXNS);
  const { ranked, undisclosedBucket } = rankNetRows(rows, (r) => r.net, (r) => r.ticker);
  const low = (s: SumRanges): number => (s.kind === "closed" || s.kind === "open" ? s.low : 0);
  const shared: MemberNetShared = { scale: Math.max(1, ...rows.flatMap((r) => [low(r.purchases), low(r.sales)])), cols: 4 };
  const input = (r: (typeof rows)[number], overlapsPrev: boolean): MemberNetRowIn => ({
    ticker: r.ticker, cut: r.ticker === CUT, purchases: r.purchases, sales: r.sales,
    buys: r.buys, sells: r.sells, net: r.net, overlapsPrev,
  });
  const all: MemberNetRowIn[] = [
    ...ranked.map((r, i) => input(r, i > 0 && netOverlaps(r.net, ranked[i - 1]!.net) === true)),
    { ...input(undisclosedBucket[0]!, false), sep: undisclosedBucket.length },
    ...undisclosedBucket.map((r) => input(r, false)),
  ];
  return all.map((r, i) => memberNetRowHtml(r, i, shared));
}

const ROOT = "member-top-all-tbody";

test("R27: Top tickers ships 8 tickers per window in the DOM and the rest in an island, with the count exact", () => {
  for (const root of ["member-top-24m-tbody", ROOT]) {
    const dom = tbodyRows(HTML, root);
    assert.equal(dom.length, 8, `${root}: 8 ticker rows in the DOM (the separator sits past them)`);
    const { render, data } = islandOf<MemberNetRowIn, MemberNetShared>(HTML, root);
    assert.equal(render, MEMBER_NET_ROWS);
    assert.equal(data.offset, 8);
    assert.equal(data.rows.length, 18 + 1 + 2, "T08..T25, the separator, U1 and U2");
    assert.match(HTML, new RegExp(`<tbody id="${root}" role="rowgroup" data-collapsed="true" data-held="json">`));
    assert.match(HTML, new RegExp(`data-compact-for="${root}" data-compact-total="28" data-compact-shown="8"`));
  }
  assert.ok(!HTML.includes("data-compact-extra"), "no held row is in the DOM");
  assert.match(HTML, /1–8 of 28 tickers/, "the count is rule 6's grammar over every ticker");
});

test("R27: DOM rows + island rows = the whole table from independently recomputed inputs, byte for byte", () => {
  const dom = tbodyRows(HTML, ROOT);
  const { data } = islandOf<MemberNetRowIn, MemberNetShared>(HTML, ROOT);
  const held = data.rows.map((r, j) => memberNetRowHtml(r, data.offset + j, data.shared));
  assert.deepEqual([...dom, ...held], referenceNetRows());
});

test("R27 controls: the island carries the inputs a client could not recompute from the held rows alone", () => {
  const { data } = islandOf<MemberNetRowIn, MemberNetShared>(HTML, ROOT);
  const ref = referenceNetRows().slice(data.offset);
  const render = (rows: MemberNetRowIn[], shared: MemberNetShared): string[] =>
    rows.map((r, j) => memberNetRowHtml(r, data.offset + j, shared));
  assert.deepEqual(render(data.rows, data.shared), ref, "the island as shipped reproduces the reference");

  // (1) the scale recomputed from the held rows alone — T00, which sets it, is a visible row
  const low = (s: SumRanges): number => (s.kind === "closed" || s.kind === "open" ? s.low : 0);
  const localScale = Math.max(1, ...data.rows.flatMap((r) => [low(r.purchases), low(r.sales)]));
  assert.notDeepEqual(render(data.rows, { ...data.shared, scale: localScale }), ref, "control: a held-rows-only scale changes the bars");

  // (2) overlapsPrev recomputed inside the island — the first held row overlaps the last VISIBLE row
  assert.equal(data.rows[0]!.overlapsPrev, true, "the boundary row carries its overlap with the row above");
  const noBoundary = data.rows.map((r, j) => (j === 0 ? { ...r, overlapsPrev: false } : r));
  assert.notDeepEqual(render(noBoundary, data.shared), ref, "control: losing the boundary overlap changes the net cell");

  // (3) the budget-cut flag — the cut ticker's link goes to /e/
  const cutRow = data.rows.find((r) => r.ticker === CUT);
  assert.ok(cutRow && cutRow.cut, "the cut ticker is a held row and says so");
  assert.ok(render(data.rows, data.shared).some((h) => h.includes(`href="/e/?k=t:${CUT}"`)), "its held row links /e/");
  const uncut = data.rows.map((r) => ({ ...r, cut: false }));
  assert.notDeepEqual(render(uncut, data.shared), ref, "control: without the flag the link would go to a page that was not built");
});

test("R27: the filing history holds filings 13..15 in its island, rendered by the same row function", () => {
  const dom = tbodyRows(HTML, "member-history-tbody");
  assert.equal(dom.length, 12);
  const { render, data } = islandOf<{ filed: string; doc: string; count: number }, null>(HTML, "member-history-tbody");
  assert.equal(render, MEMBER_HISTORY_ROWS);
  assert.equal(data.rows.length, 3);
  const held = data.rows.map((r, j) => memberHistoryRowHtml(r, data.offset + j, data.shared));
  /* reference: one row per distinct filing, newest filed first, recomputed here */
  const byDoc = new Map<string, { filed: string; doc: string; count: number }>();
  for (const t of TXNS) byDoc.set(t.doc, { filed: t.filed, doc: t.doc, count: (byDoc.get(t.doc)?.count ?? 0) + 1 });
  const ref = [...byDoc.values()].sort((a, b) => b.filed.localeCompare(a.filed)).map((r) => memberHistoryRowHtml(r));
  assert.deepEqual([...dom, ...held], ref);
  assert.match(HTML, /1–12 of 15 filings/);
});

test("R27 / rule 8: a member page's held rows ship no <noscript> copy — no-JS readers cannot open them today", () => {
  /* The member page's Show-all needs a script (the button is `hidden` until a
     script reveals it), so rule 8 ships the island alone here. */
  assert.ok(!HTML.includes("<noscript"), "no noscript second table on the member page");
});

test("rule 8: a <noscript> copy is a SECOND table after the first, never inside a tbody, rows from the same function", () => {
  const rows = Array.from({ length: 7 }, (_, i) => ({ n: i }));
  const fn = (r: { n: number }, i: number, s: { tag: string }): string => `<tr role="row"><td role="cell">${s.tag}${r.n}@${i}</td></tr>`;
  const parts = heldTableParts({
    rootId: "x-tbody", render: "x", rowFn: fn, rows, shown: 3, shared: { tag: "r" },
    noscript: { tableOpen: `<table class="etable" role="table">`, caption: "Rows 4–7 of 7", thead: `<thead role="rowgroup"><tr role="row"><th role="columnheader">N</th></tr></thead>` },
  });
  const page = `<table class="etable" role="table"><tbody id="x-tbody" data-held="json">${parts.bodyRows}</tbody></table>${parts.island}${parts.noscript}`;
  assert.equal(parts.bodyRows.split("\n").length, 3);
  // never inside a tbody
  for (const m of page.matchAll(/<tbody[^>]*>([\s\S]*?)<\/tbody>/g)) assert.ok(!m[1]!.includes("<noscript"), "no noscript inside any tbody");
  // after the first table, holding its own table
  assert.ok(page.indexOf("<noscript>") > page.indexOf("</table>"), "the noscript follows the first table");
  assert.match(parts.noscript, /^<noscript><table class="etable" role="table"><caption>Rows 4–7 of 7<\/caption><thead/);
  assert.equal(parts.noscript, `<noscript><table class="etable" role="table"><caption>Rows 4–7 of 7</caption><thead role="rowgroup"><tr role="row"><th role="columnheader">N</th></tr></thead><tbody role="rowgroup">${[3, 4, 5, 6].map((n) => fn({ n }, n, { tag: "r" })).join("\n")}</tbody></table></noscript>`);
  // and the island carries the same rows
  const island = parseHeldIsland(/<script[^>]*>([\s\S]*?)<\/script>/.exec(parts.island)![1]);
  assert.deepEqual(island, { v: 1, offset: 3, shared: { tag: "r" }, rows: rows.slice(3) });
  // nothing held: no island, no noscript
  const none = heldTableParts({ rootId: "y", render: "x", rowFn: fn, rows: rows.slice(0, 2), shown: 3, shared: { tag: "r" }, noscript: { tableOpen: "<table>", caption: "c", thead: "" } });
  assert.equal(none.island + none.noscript, "");
});

test("rule 8: the island never closes its script element, whatever a name contains", () => {
  const parts = heldTableParts({ rootId: "z", render: "x", rowFn: () => "", rows: [{ a: 1 }, { a: "</script><b>" }], shown: 1, shared: null });
  assert.ok(!/<\/script>[\s\S]*<\/script>/.test(parts.island), "exactly one closing tag");
  assert.deepEqual(parseHeldIsland(/<script[^>]*>([\s\S]*?)<\/script>/.exec(parts.island)![1])!.rows, [{ a: "</script><b>" }]);
});

test("R27: the binder renders the held rows through the registered function, once, and print shows them", () => {
  const { doc, restore } = installDom(HTML);
  const g = globalThis as unknown as Record<string, unknown>;
  const winListeners = new Map<string, (() => void)[]>();
  const prevWin = g.window;
  g.window = { addEventListener: (t: string, fn: () => void) => winListeners.set(t, [...(winListeners.get(t) ?? []), fn]) };
  try {
    registerHeldRows(MEMBER_NET_ROWS, memberNetRowHtml);
    registerHeldRows(MEMBER_HISTORY_ROWS, memberHistoryRowHtml);
    initDomDisclosures();
    const tbody = doc.getElementById(ROOT)!;
    const wrap = doc.querySelector(`.compact-disclosure[data-compact-for="${ROOT}"]`)!;
    const btn = wrap.querySelector("button")!;
    assert.equal(tbody.children.length, 8);
    assert.equal(btn.hidden, false, "the binder reveals the control");
    assert.equal(btn.textContent, "Show all 28 tickers");

    // print first: beforeprint renders and reveals, afterprint restores
    winListeners.get("beforeprint")!.forEach((fn) => fn());
    assert.equal(tbody.getAttribute("data-collapsed"), "false", "print shows every held row");
    assert.equal(doc.getElementById("member-history-tbody")!.getAttribute("data-collapsed"), "false", "the history's too");
    assert.equal(tbody.children.length, 29, "8 + T08..T25, the separator, U1, U2");
    winListeners.get("afterprint")!.forEach((fn) => fn());
    assert.equal(tbody.getAttribute("data-collapsed"), "true", "afterprint collapses what it opened");

    // a reader's press expands without rendering the rows a second time
    btn.bubbleClick();
    assert.equal(tbody.getAttribute("data-collapsed"), "false");
    assert.equal(tbody.children.length, 29, "rendered once — no duplicate rows");
    const tickers = tbody.querySelectorAll("td.c-ticker a").map((a) => a.textContent);
    assert.deepEqual(tickers.slice(6, 10), ["T06", "T07", "T08", "T09"], "held rows continue the order");
    assert.equal(tbody.children.slice(8).every((tr) => tr.hasAttribute("data-compact-extra")), true, "held rows are marked held");
    assert.equal(tbody.children.slice(0, 8).some((tr) => tr.hasAttribute("data-compact-extra")), false);
    assert.equal(btn.textContent, "Show only the first 8 tickers");
    btn.bubbleClick();
    assert.equal(tbody.getAttribute("data-collapsed"), "true");
  } finally {
    g.window = prevWin;
    restore();
  }
});

test("R27 control: with no registered renderer the binder reveals nothing rather than claim rows it cannot show", async () => {
  const { heldTableParts: parts } = await import("../src/lib/held-rows.ts");
  const p = parts({ rootId: "q-tbody", render: "unregistered-name", rowFn: (r: { n: number }) => `<tr><td>${r.n}</td></tr>`, rows: [{ n: 1 }, { n: 2 }, { n: 3 }], shown: 1, shared: null });
  const html =
    `<table><tbody id="q-tbody" data-collapsed="true" data-held="json">${p.bodyRows}</tbody></table>${p.island}` +
    `<div class="compact-disclosure" data-compact-dom data-compact-for="q-tbody" data-compact-total="3" data-compact-shown="1" data-compact-noun="rows" data-compact-bound-noun="rows"><p class="compact-bound"><span class="compact-bound-count">1–1 of 3 rows</span></p><button class="linklike compact-toggle" type="button" aria-expanded="false" aria-controls="q-tbody" hidden></button></div>`;
  const { doc, restore } = installDom(html);
  try {
    initDomDisclosures();
    doc.querySelector(".compact-disclosure button")!.bubbleClick();
    assert.equal(doc.getElementById("q-tbody")!.getAttribute("data-collapsed"), "true", "stays collapsed");
    assert.equal(doc.getElementById("q-tbody")!.children.length, 1);
  } finally {
    restore();
  }
});

test("rule 8: the binder never reads a <noscript> and never moves DOM text into HTML", () => {
  const src = readFileSync(path.resolve(import.meta.dirname, "..", "src", "scripts", "inst-index-client.ts"), "utf-8");
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  assert.ok(!/noscript/i.test(code), "no code path touches a noscript");
  assert.ok(!/innerHTML\s*=\s*[^;]*textContent/.test(code), "no textContent → innerHTML");
  assert.ok(!/insertAdjacentHTML\([^)]*textContent/.test(code), "no textContent → insertAdjacentHTML");
});

/* ---------------------------------------------------------------------------
   Launch integration: ONE held-rows implementation (rule 8, "One island, one
   render path, several views"). The member tables (M4a), the Signals hits,
   Named moves, Congress-lines bank and Overlap names (M7a) and the holders
   lists (M7b) were built in parallel with three island shapes and three
   binders; they now share the one island `heldIslandHtml` writes and the one
   render path `heldRowsHtml` draws through (the registered row function, then
   the page's explicit table roles). */

import { withTableRoles } from "../src/lib/format.ts";
import { signalsBody, signalsInstitutionalHtml, signalsOverlapHtml } from "../src/lib/ui/index.ts";
import { tickerInstSectionHtml, TICKER_HOLDER_HELD } from "../src/lib/ui/ticker.ts";
import { fixtureInstitutional, fixtureMoves } from "./lib/inst-signals-fixture.ts";
import { fixtureOverlap } from "./lib/overlap-fixture.ts";
import { loadTriageFixture } from "./lib/triage-fixture.ts";
import { duplicateAttributeTags } from "./lib/table-roles.ts";

const holdersTab = (n: number): string =>
  tickerInstSectionHtml(
    {
      state: "data", name: "X", cik: "0000000001", period: "2026-03-31", latestFiled: "2026-05-15", topn: n, holdersPage: true,
      holders: Array.from({ length: n }, (_, i) => ({ rank: i + 1, cik: String(i + 1).padStart(10, "0"), name: `HOLDER <${i + 1}> & CO`, value: i === 30 ? null : 1_000_000 - i, securities: 1, keySource: "mapped", flags: i % 4 === 0 ? ["security_not_in_mapping"] : [], tier: i % 2 ? "top" : "tail" })),
      mapped: { issuer: "X", titleOfClass: "COM", holderCount: 900 },
    } as never,
    "XYZ",
  );

/** Every island element in `html`: its attribute text and its parsed body. */
function islands(html: string): { attrs: string; body: HeldIsland | null; raw: string }[] {
  return [...html.matchAll(/<script\b([^>]*\bdata-held-for=[^>]*)>([\s\S]*?)<\/script>/g)].map((m) => ({ attrs: m[1]!, body: parseHeldIsland(m[2]!), raw: m[2]! }));
}

test("rule 8 (launch integration): every held list ships the ONE island — the member tables, the four Signals lists and the holders list alike", () => {
  const f = loadTriageFixture();
  const corpus: Record<string, string> = {
    member: HTML,
    hits: signalsBody(f.artifact, CTX, { rowsEvaluated: 2051 }),
    moves: signalsInstitutionalHtml(fixtureInstitutional({ moves: fixtureMoves(200, { broadOnly: 10 }) }), CTX),
    overlap: signalsOverlapHtml(fixtureOverlap(), CTX),
    holders: holdersTab(60),
  };
  const roots = new Set<string>();
  for (const [name, html] of Object.entries(corpus)) {
    const found = islands(html);
    assert.ok(found.length > 0, `${name}: the fixture holds rows back`);
    for (const { attrs, body, raw } of found) {
      assert.match(attrs, /^ type="application\/json" data-held-for="[a-z0-9-]+" data-held-render="[a-z-]+"$/, `${name}: the one island's attributes, nothing else`);
      assert.ok(body && body.v === 1 && Number.isInteger(body.offset) && body.offset >= 0 && body.rows.length > 0, `${name}: the one body, { v, offset, shared, rows }`);
      assert.doesNotMatch(raw, /</, `${name}: inert — no tag can open inside it`);
      roots.add(/data-held-for="([^"]+)"/.exec(attrs)![1]!);
    }
  }
  /* the bank's island ships only when a held row links a block no visible
     row does (none on these fixtures); its writer is the same call, and the
     source scan below proves there is no other */
  for (const id of ["member-top-all-tbody", "member-history-tbody", "signal-hits-body", "mv-list", "ov-list", "ticker-holders-held"]) assert.ok(roots.has(id), `${id} is a held list of the one carrier`);
  // control: the reading catches an island in another shape (the old Signals one)
  assert.equal(parseHeldIsland(JSON.stringify({ columns: [], lines: [], cut: {} })), null, "control: a second island shape does not parse as the one");
});

test("rule 8 (launch integration): the island is written in one module and read in one — no second implementation in the tree", () => {
  const SRC = path.resolve(import.meta.dirname, "..", "src");
  const files = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(path.join(dir, e.name)) : /\.(ts|astro)$/.test(e.name) ? [path.join(dir, e.name)] : []));
  const code = (f: string): string => readFileSync(f, "utf-8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
  const writers: string[] = [];
  const readers: string[] = [];
  for (const f of files(SRC)) {
    const c = code(f);
    const rel = path.relative(SRC, f);
    if (/data-held-for="\$\{/.test(c)) writers.push(rel);
    if (/\[data-held-for\]|data-held-for="\$\{[^}]*\}"\]/.test(c) || /JSON\.parse\([^)]*held/i.test(c)) readers.push(rel);
  }
  assert.deepEqual(writers, ["lib/held-rows.ts"], "one island writer");
  assert.deepEqual(readers, ["scripts/inst-index-client.ts"], "one island reader: the binder");
  // control: the scan sees a second writer and a second reader
  assert.ok(/data-held-for="\$\{/.test('`<script type="application/json" data-held-for="${id}">`'), "control: a template writer is seen");
  assert.ok(/\[data-held-for\]/.test('document.querySelector(`script[data-held-for]`)'), "control: a second reader is seen");
});

test("rule 8 + R40 (launch integration): a drawn held row is the SERVED page's row — the registered function, then the page's table roles and card labels", () => {
  /* The page as Base.astro serves it (withTableRoles over the body): the
     holders list's no-JS second table carries the roles and labels the
     layout added; the binder's rows, drawn into the held table, must equal
     them byte for byte. */
  const served = withTableRoles(holdersTab(60));
  const noscriptRows = /<noscript>[\s\S]*?<tbody role="rowgroup">([\s\S]*?)<\/tbody>[\s\S]*?<\/noscript>/.exec(served)![1]!;
  const { doc, restore } = installDom(served);
  const g = globalThis as unknown as Record<string, unknown>;
  const prevWin = g.window;
  const listeners = new Map<string, (() => void)[]>();
  g.window = { addEventListener: (t: string, fn: () => void) => void listeners.set(t, [...(listeners.get(t) ?? []), fn]) };
  try {
    registerHeldRows(TICKER_HOLDER_HELD.render, TICKER_HOLDER_HELD.row, { text: TICKER_HOLDER_HELD.text });
    initDomDisclosures();
    for (const fn of listeners.get("beforeprint") ?? []) fn(); // print draws every held row
    const drawn = doc.getElementById("ticker-holders-held")!.innerHTML;
    assert.equal(drawn, noscriptRows, "the binder's rows are the served rows, roles and labels included");
    assert.match(drawn, /<td role="cell" class="c-num c-muted" data-label="#">26<\/td>/, "a number cell prints its column label on a phone card");
    // control: the row function's raw output (no roles path) is NOT the served row
    const island = islands(served).find((i) => /ticker-holders-held/.test(i.attrs))!.body!;
    const raw = island.rows.map((r, j) => TICKER_HOLDER_HELD.row(r, island.offset + j, island.shared)).join("\n");
    assert.notEqual(raw, noscriptRows, "control: without the roles path the bytes differ");
    for (const fn of listeners.get("afterprint") ?? []) fn();
  } finally {
    g.window = prevWin;
    restore();
  }
});

test("rule 8 + R40 (launch integration): the member page's compact table draws its held rows through the same path — each row carries its card labels, none twice", () => {
  const served = withTableRoles(HTML);
  const { doc, restore } = installDom(served);
  try {
    registerHeldRows(MEMBER_NET_ROWS, memberNetRowHtml);
    registerHeldRows(MEMBER_HISTORY_ROWS, memberHistoryRowHtml);
    initDomDisclosures();
    doc.querySelector(`.compact-disclosure[data-compact-for="${ROOT}"] button`)!.bubbleClick();
    const tbody = doc.getElementById(ROOT)!;
    const rows = tbody.children;
    assert.equal(rows.length, 29, "8 served + 21 drawn");
    /* the served rows went through the layout's roles; the drawn ones through
       rolesFor — the same labels on the same cells */
    const labels = (tr: (typeof rows)[number]): (string | null)[] => tr.querySelectorAll("td").map((td) => td.getAttribute("data-label"));
    assert.deepEqual(labels(rows[9]!), labels(rows[1]!), "a drawn row's cells carry the served row's labels");
    assert.ok(labels(rows[9]!).some((l) => l !== null), "and there are labels to carry");
    assert.deepEqual(duplicateAttributeTags(tbody.innerHTML), [], "no element states a role or a label twice");
  } finally {
    restore();
  }
});
