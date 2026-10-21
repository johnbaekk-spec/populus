/* Launch redesign M5 (R28, R2, R29, R40) and M7a (R31): Signals.

   M5 — Playbooks: the list stays anchors with one article shown by script
   (never a tablist); rule, horizon and each study's venue and sample are
   tips; "Triggers now" is a table with its own dates and receipt columns and
   explicit table roles; and the served-HTML word gate — the tab at most 680
   words and each article at most round(its T0 count × 240/334) — measured by
   the copy audit's own ruler (test/lib/served-words.ts), with planted
   controls proving the ruler counts what it should and nothing else. */

import { test } from "node:test";
import assert from "node:assert/strict";

import { CONGRESS_PLAYBOOKS, PLAYBOOKS, playbookTriggers, type PlaybookHit } from "../src/lib/playbooks.ts";
import { signalsBody, signalsPlaybooksHtml } from "../src/lib/ui/index.ts";
import type { PlaybooksModel } from "../src/lib/ui/signals-playbooks.ts";
import { buildTriage, type TriageResult } from "../src/lib/signal-triage.ts";
import { loadTriageFixture } from "./lib/triage-fixture.ts";
import { fixtureInstitutional } from "./lib/inst-signals-fixture.ts";
import { fixtureOverlap } from "./lib/overlap-fixture.ts";
import { MiniElement } from "./lib/mini-dom.ts";
import { outline, playbookArticles, servedWords, splitTab, wordsOfOutline } from "./lib/served-words.ts";

const CTX = {};
const text = (el: MiniElement | null | undefined): string => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
function domOf(html: string): MiniElement {
  const root = new MiniElement("body");
  root.innerHTML = html;
  return root;
}

/* ---------------------------------------------------------------- the ruler */

test("SC5 ruler: planted controls — visible copy counts, tip / screen-reader / hidden / closed-details / table-body text does not, marks are not words", () => {
  const W = Array.from({ length: 12 }, (_, i) => `word${i}`).join(" ");
  const base = `<main><h2>Two words</h2><p>Three more words.</p></main>`;
  assert.equal(servedWords(base), 5);
  const plant = (html: string) => servedWords(base.replace("</main>", `${html}</main>`)) - 5;
  assert.equal(plant(`<p>${W}</p>`), 12, "visible copy counts");
  assert.equal(plant(`<p>Label<span class="note"><button class="note-btn">ⓘ</button><span class="note-pop" popover>${W}</span></span></p>`), 1, "a tip's text does not");
  assert.equal(plant(`<p><span class="visually-hidden">${W}</span></p>`), 0, "screen-reader text does not");
  assert.equal(plant(`<div hidden><p>${W}</p></div>`), 0, "a hidden subtree does not");
  assert.equal(plant(`<details><summary>Open</summary><p>${W}</p></details>`), 1, "a closed details body does not; its summary does");
  assert.equal(plant(`<details open><summary>Open</summary><p>${W}</p></details>`), 13, "an open details body does");
  assert.equal(plant(`<table><thead><tr><th>Head</th></tr></thead><tbody><tr><td>${W}</td></tr></tbody></table>`), 1, "a column head counts; a data cell does not");
  assert.equal(plant(`<p>a · b ↗ ⓘ → c</p>`), 3, "marks are not words");
  assert.equal(plant(`<script type="application/json">{"x":"${W}"}</script><noscript><p>${W}</p></noscript>`), 0, "script and noscript text does not");
  assert.equal(plant(`<ul><li class="cl-line">${W}</li></ul>`), 0, "an audit data-row class does not");
});

test("SC5 ruler: a tab is split the audit's way — every other tabpanel removed, the shared head kept", () => {
  const html =
    `<div class="page-head"><h1>Head</h1></div>` +
    `<section class="tk-panel" role="tabpanel" id="a"><p>alpha one</p><section><p>nested two words</p></section></section>` +
    `<section class="tk-panel" role="tabpanel" id="b"><p>beta</p></section>`;
  assert.equal(servedWords(splitTab(html, "a")), 6);
  assert.equal(servedWords(splitTab(html, "b")), 2);
});

/* ---------------------------------------------------------------- M5: the word gate */

/** T0 (M0, served HTML of live build 20261020.2, the Playbooks tab split the
    audit's way): the tab read 946 words; each article as below; the Base
    chrome outside the page body (masthead 2, nav 1, footer 2 + 2 + 21) read
    28 of them. Evidence: docs/design/launch-redesign-run/M0/
    t04-controls-live-20261020.2/ (main checkout); the port of the ruler
    reproduces every figure (DEV-NOTES, launch M5). */
const T0_TAB = 946;
const T0_CHROME = 28;
const T0_ARTICLES: Readonly<Record<string, number>> = {
  "pb-opp-buy": 209, "pb-leader": 82, "pb-cmte": 110, "pb-best-ideas": 105, "pb-consensus": 108, "pb-overlap": 54, "pb-insider-opp": 137,
};
/** R28: the approved mock's cut, 334 → 240 visible words (−28%), carried
    into served-HTML units. */
const CUT = 240 / 334;
const TAB_GATE = Math.round(T0_TAB * CUT);

let golden: TriageResult | null = null;
function triage(): TriageResult {
  const f = loadTriageFixture();
  golden ??= buildTriage(f.artifact, f.rows, { committee: f.committee, identityOf: f.identityOf });
  return golden;
}
/** The most words the tab can carry on these rows: every Congress playbook
    lists its five rows AND states "All n" past them, the panels qualify. */
function stressModel(over: Partial<PlaybooksModel> = {}): PlaybooksModel {
  const tr = triage();
  const real = playbookTriggers(tr, loadTriageFixture().rows);
  const byRow = new Map<string, PlaybookHit[]>();
  for (const [k, hs] of real.byRow) byRow.set(k, [...hs]);
  for (const id of CONGRESS_PLAYBOOKS) {
    for (const r of tr.rows.slice(0, 7)) {
      const hs = byRow.get(r.key) ?? [];
      if (!hs.some((h) => h.id === id)) byRow.set(r.key, [...hs, { id, why: "fixture" }]);
    }
  }
  const counts = { "opp-buy": 0, leader: 0, cmte: 0 };
  for (const hs of byRow.values()) for (const h of hs) counts[h.id]++;
  return { triggers: { byRow, counts, cmteAvailable: true, cmp: new Map() }, triage: tr, bestIdeas: 1356, consensus: 1356, cmteUnavailableReason: null, ...over };
}
function pageBody(m: PlaybooksModel): string {
  const f = loadTriageFixture();
  return signalsBody(f.artifact, CTX, { rowsEvaluated: 2051, triage: m.triage, institutional: fixtureInstitutional(), overlap: fixtureOverlap(), playbooks: m });
}

test("R28 / SC5: on the served HTML the Playbooks tab is at most 680 words (round(946 × 240/334)) and each article at most round(its T0 count × 240/334)", () => {
  assert.equal(TAB_GATE, 680);
  const m = stressModel();
  for (const id of CONGRESS_PLAYBOOKS) assert.ok(m.triggers.counts[id] > 5, `${id}: the stress model lists five rows and "All n"`);
  const tab = splitTab(pageBody(m), "playbooks");
  const words = servedWords(tab) + T0_CHROME;
  assert.ok(words <= TAB_GATE, `the tab reads ${words} words; the gate is ${TAB_GATE}`);
  const arts = playbookArticles(tab);
  assert.deepEqual([...arts.keys()], PLAYBOOKS.map((p) => `pb-${p.id}`), "every article is counted");
  for (const [id, html] of arts) {
    const gate = Math.round(T0_ARTICLES[id]! * CUT);
    const n = servedWords(html);
    assert.ok(n <= gate, `${id} reads ${n} words; its gate is ${gate} (T0 ${T0_ARTICLES[id]})`);
  }
  // the one-article view the script shows is reported, not gated (R28). A
  // build without the committee inputs states why its committee playbook
  // cannot trigger — a degraded state the production gate never sees — and
  // still reads no more than the T0 article did
  const off = playbookArticles(splitTab(pageBody(stressModel({ triggers: { ...stressModel().triggers, cmteAvailable: false }, cmteUnavailableReason: "inputs-not-in-build" })), "playbooks"));
  assert.ok(servedWords(off.get("pb-cmte")!) <= T0_ARTICLES["pb-cmte"]!);
});

test("R28 / SC5 (control): a planted 40-word paragraph in an article, or in the tab, fails the gate", () => {
  const m = stressModel();
  const tab = splitTab(pageBody(m), "playbooks");
  const plant = `<p class="pb-p">${Array.from({ length: 40 }, (_, i) => `w${i}`).join(" ")}</p>`;
  const art = playbookArticles(tab).get("pb-leader")!;
  const planted = art.replace("</article>", `${plant}</article>`);
  assert.ok(servedWords(planted) > Math.round(T0_ARTICLES["pb-leader"]! * CUT), "the article gate catches it");
  assert.ok(servedWords(tab.replace(art, planted)) + T0_CHROME > TAB_GATE, "the tab gate catches it");
  // and what the ruler counts in an article is copy, row by row
  const rows = wordsOfOutline(outline(art)).rows.map((r) => r.tag);
  assert.ok(rows.some((t) => t.startsWith("p.pb-verdict")) && rows.some((t) => t.startsWith("li.ev")), "the verdict and the evidence are counted");
});

/* ---------------------------------------------------------------- M5: structure */

test("R28 (DV16): the list stays anchors — no tablist, tab or tabpanel role inside the Playbooks section; every article is in the served HTML", () => {
  const root = domOf(signalsPlaybooksHtml(stressModel(), CTX));
  const sec = root.querySelector("#pb-section")!;
  assert.equal(sec.querySelectorAll('[role="tablist"], [role="tab"], [role="tabpanel"]').length, 0);
  const links = sec.querySelectorAll("nav.pb-nav a.pbi");
  assert.deepEqual(links.map((a) => a.getAttribute("href")), PLAYBOOKS.map((p) => `#pb-${p.id}`));
  assert.ok(links.every((a) => a.getAttribute("aria-selected") === null), "a link, not a tab");
  assert.deepEqual(sec.querySelectorAll("article.pb-main").map((a) => a.getAttribute("id")), PLAYBOOKS.map((p) => `pb-${p.id}`));
  assert.ok(sec.querySelectorAll("article.pb-main").every((a) => !a.hasAttribute("hidden")), "without script every article shows");
});

test("R28: the rule, the horizon and each study's venue and sample open as tips; the finding and its link stay on the line", () => {
  const root = domOf(signalsPlaybooksHtml(stressModel(), CTX));
  for (const p of PLAYBOOKS) {
    const a = root.querySelector(`#pb-${p.id}`)!;
    const metas = a.querySelectorAll(".pb-h .pb-meta");
    assert.deepEqual(metas.map((m) => text(m).replace(/ⓘ[\s\S]*$/, "").trim()), ["Rule", "Horizon"]);
    assert.ok(metas.every((m) => m.querySelector(".note-pop")), `${p.id}: rule and horizon are tips`);
    assert.ok(text(metas[0]!.querySelector(".note-pop")).length > 0 && text(metas[1]!.querySelector(".note-pop")).length > 0);
    const ev = a.querySelectorAll("li.ev");
    assert.equal(ev.length, p.evidence.length);
    p.evidence.forEach((e, i) => {
      const tip = ev[i]!.querySelector(".ev-c .note-pop");
      assert.equal(text(tip), `${e.venue} · ${e.sample}`, `${p.id} ${e.cite}: the study tip`);
      assert.ok(ev[i]!.querySelectorAll(".ev-v").every((v) => v.closest(".note-pop") !== null), "venue and sample no longer sit on the line");
      assert.equal(text(ev[i]!.querySelector(".ev-f")), e.finding, "the finding stays visible");
      assert.equal(ev[i]!.querySelector("a.ev-src")!.getAttribute("href"), e.url, "the link stays");
    });
  }
});

test("R2 / R28: 'Not advice' stays visible above the list, and the Signals head keeps 'no price data' visible (copy item signals-01, adapted to the approved board's crumb)", () => {
  const m = stressModel();
  const body = pageBody(m);
  const tab = splitTab(body, "playbooks");
  const disc = outline(tab).find((l) => l.startsWith("[p.pb-disc]"))!;
  assert.match(disc, /^\[p\.pb-disc\] Published research on the patterns these rows show\. Not advice\./, "visible, outside the tip");
  const head = domOf(body).querySelector(".page-head .kicker")!;
  assert.equal(text(head), "Rule-based · no price data");
  // control: the old kicker's place words are gone (the nav and h1 say them)
  assert.doesNotMatch(body, /Public record \/ Signals/);
});

test("R28 / R40: 'Triggers now' carries explicit table roles and the ledger role classes on every cell; a planted role-less row is caught", () => {
  const root = domOf(signalsPlaybooksHtml(stressModel(), CTX));
  const tables = root.querySelectorAll("table.pb-tg");
  assert.equal(tables.length, CONGRESS_PLAYBOOKS.length, "one per Congress playbook with rows");
  const problems = (t: MiniElement): string[] => {
    const out: string[] = [];
    if (t.getAttribute("role") !== "table") out.push("table");
    if (!t.getAttribute("data-card")) out.push("data-card");
    for (const g of t.querySelectorAll("thead, tbody")) if (g.getAttribute("role") !== "rowgroup") out.push("rowgroup");
    for (const tr of t.querySelectorAll("tr")) if (tr.getAttribute("role") !== "row") out.push("row");
    for (const th of t.querySelectorAll("th")) if (th.getAttribute("role") !== "columnheader") out.push("columnheader");
    for (const td of t.querySelectorAll("td")) {
      if (td.getAttribute("role") !== "cell") out.push("cell");
      if (!/\bc-(ticker|flex|kind|num|filed|src)\b/.test(td.getAttribute("class") ?? "")) out.push("role class");
    }
    return out;
  };
  for (const t of tables) assert.deepEqual(problems(t), []);
  const planted = domOf(tables[0]!.outerHTML.replace(/<tr class="pb-row" role="row">/, '<tr class="pb-row">'));
  assert.ok(problems(planted.querySelector("table")!).includes("row"), "control: a role-less row");
});

/* ---------------------------------------------------------------- M7a: the weight (D5, D6) */

import { NAMED_MOVES_MIN } from "../src/lib/notable-moves.ts";
import { moveRowFrom, namedMoveIds, signalsInstitutionalHtml, type HeldMoves } from "../src/lib/ui/signals-institutional.ts";
import { fixtureMoves } from "./lib/inst-signals-fixture.ts";
import { installDom } from "./lib/mini-dom.ts";
import { initNamedMoves } from "../src/scripts/signals-client.ts";

/** A held list's island — the site's one held-rows carrier (lib/held-rows.ts,
    launch integration): `{ v, offset, shared, rows }`, the row function named
    in `data-held-render`. */
function island<T>(html: string, listId: string): T | null {
  const m = new RegExp(`<script type="application/json" data-held-for="${listId}" data-held-render="[a-z-]+">([\\s\\S]*?)</script>`).exec(html);
  return m ? (JSON.parse(m[1]!) as T) : null;
}
/** Elements at first load, as a browser parses the served HTML: every start
    tag outside a script element (an island's JSON is text, not elements). */
function elementCount(html: string): number {
  return (html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "<script></script>").match(/<[a-zA-Z][\w-]*[\s>/]/g) ?? []).length;
}

test("R31 (D5, LD27): the Named moves' first load carries the first fifteen rows; the rest of the page's set ships in the island as data, in order, each once; without script the first rows and a stated count remain", () => {
  const model = fixtureInstitutional({ moves: fixtureMoves(200, { broadOnly: 10 }) });
  const html = signalsInstitutionalHtml(model, CTX);
  const dom = [...html.matchAll(/<article class="mv-item" id="([^"]+)"/g)].map((m) => m[1]!);
  const held = island<HeldMoves>(html, "mv-list")!;
  assert.equal(dom.length, NAMED_MOVES_MIN, "fifteen rows in the page");
  assert.deepEqual([...dom, ...held.rows.map((r) => r.id)], namedMoveIds(model), "the page's set, in its order, each once");
  assert.ok(!/<article class="mv-item"[^>]*\shidden/.test(html), "no held row in the DOM");
  const ns = /<noscript><p class="section-note">([^<]*)<\/p><\/noscript>\s*<\/section>/.exec(html.slice(html.indexOf('id="named-moves"')))![1]!;
  assert.equal(ns, `Filtering and paging need JavaScript: the first ${NAMED_MOVES_MIN} of ${model.moves.length} changes in this quarter are listed; filer pages list every change.`);
  /* launch final pass: "every change", never "every move" — post/banned-wording §0 reads \bmove\b in every built HTML and JS file */
  assert.doesNotMatch(html, /\bmove\b/i, "no bare 'move' anywhere in the tab's markup");
  // a field carrying markup stays text when the client renders its row
  const hostile = moveRowFrom({ ...held.rows[0]!, manager: "<b>x</b>", issuer: "</script>" }, held.shared.sec, true, held.shared.tv);
  assert.doesNotMatch(hostile, /<b>x|<\/script>/);
  assert.match(hostile, /&lt;b&gt;x&lt;\/b&gt;/);
});

test("R31 (D5, LD27): a held move row a hash names renders from the island in place, in the page's order, and a second binder never renders it twice", () => {
  const model = fixtureInstitutional({ moves: fixtureMoves(200, { broadOnly: 10 }) });
  const { doc, restore } = installDom(signalsInstitutionalHtml(model, CTX));
  try {
    const ids = namedMoveIds(model);
    const a = initNamedMoves()!;
    const target = ids[NAMED_MOVES_MIN + 7]!;
    assert.equal(doc.getElementById(target), null);
    assert.ok(a.materialize(target));
    const order = doc.querySelectorAll("#mv-list article.mv-item").map((r) => r.getAttribute("id"));
    assert.deepEqual(order, ids.slice(0, NAMED_MOVES_MIN + 8), "the next contiguous run, in the page's order");
    const b = initNamedMoves()!;
    b.materialize(ids[NAMED_MOVES_MIN + 9]!);
    const after = doc.querySelectorAll("#mv-list article.mv-item").map((r) => r.getAttribute("id"));
    assert.equal(new Set(after).size, after.length, "no row twice");
    assert.deepEqual(after, ids.slice(0, NAMED_MOVES_MIN + 10));
    assert.equal(a.materialize("mv-nowhere"), null, "an id no row has renders nothing");
  } finally {
    restore();
  }
});

test("R31 / SC3 (D6 record): the first-load elements the islands save on the fixture page — measured, and the triage rows stay in the page", (t) => {
  const f = loadTriageFixture();
  const inst = fixtureInstitutional({ moves: fixtureMoves(200, { broadOnly: 10 }) });
  const tr = triage();
  const body = signalsBody(f.artifact, CTX, { rowsEvaluated: 2051, triage: tr, institutional: inst, overlap: fixtureOverlap(), playbooks: stressModel() });
  const moves = island<HeldMoves>(body, "mv-list")!;
  const savedMoves = moves.rows.reduce((n, r) => n + elementCount(moveRowFrom(r, moves.shared.sec, true, moves.shared.tv)), 0);
  const first = elementCount(body);
  t.diagnostic(`fixture /signals/ body: ${first} elements at first load; the Named moves island holds ${moves.rows.length} rows (${savedMoves} elements not built until revealed)`);
  assert.ok(savedMoves > 0 && moves.rows.length === inst.domSet.length - NAMED_MOVES_MIN);
  // D6: every triage row body stays in the page
  assert.equal([...body.matchAll(/<article class="si-row" id="/g)].length, tr.rows.length);
  assert.equal([...body.matchAll(/<div class="si-row-det">/g)].length, tr.rows.length, "every row's opened body is server-rendered");
});

/* Launch review weight item 9 (LD26): paper gets every held Signals row. */
import { initHitPager, initOverlap, signalsPrintAll } from "../src/scripts/signals-client.ts";

test("weight item 9 (LD26): beforeprint draws and shows every held hit line, move row and Overlap name; afterprint hides exactly what it showed", () => {
  const f = loadTriageFixture();
  const inst = fixtureInstitutional({ moves: fixtureMoves(200, { broadOnly: 10 }) });
  const body = signalsBody(f.artifact, CTX, { rowsEvaluated: 2051, triage: triage(), institutional: inst, overlap: fixtureOverlap(), playbooks: stressModel() });
  const lists = [
    ["signal-hits-body", "tr.si-hit"],
    ["mv-list", "article.mv-item"],
    ["ov-list", "article.ov-item"],
  ] as const;
  const carried = Object.fromEntries(lists.map(([id, sel]) => {
    const dom = (body.match(new RegExp(`<${sel.split(".")[0]} class="${sel.split(".")[1]}[ "]`, "g")) ?? []).length;
    return [id, dom + (island<{ rows: unknown[] }>(body, id)?.rows.length ?? 0)];
  }));
  const { doc, restore } = installDom(body);
  try {
    initHitPager();
    initNamedMoves();
    initOverlap();
    const visible = (id: string, sel: string): string[] => doc.getElementById(id)!.querySelectorAll(sel).filter((el) => !el.hidden).map((el, i) => el.getAttribute("id") ?? `#${i}`);
    const before = Object.fromEntries(lists.map(([id, sel]) => [id, visible(id, sel)]));
    // re-planted control: without the handler, each list shows fewer rows than it carries
    for (const [id] of lists) assert.ok(before[id]!.length < carried[id]!, `${id}: ${before[id]!.length} shown of ${carried[id]} carried before print`);
    const undo = signalsPrintAll();
    for (const [id, sel] of lists) {
      const all = doc.getElementById(id)!.querySelectorAll(sel);
      assert.equal(all.length, carried[id], `${id}: every carried row is in the DOM for paper`);
      assert.ok(all.every((el) => !el.hidden), `${id}: and every one is shown`);
    }
    undo();
    for (const [id, sel] of lists) assert.deepEqual(visible(id, sel), before[id], `${id}: afterprint restores the reader's view`);
    // a second print draws nothing twice
    signalsPrintAll()();
    for (const [id, sel] of lists) assert.equal(doc.getElementById(id)!.querySelectorAll(sel).length, carried[id], `${id}: no row twice`);
  } finally {
    restore();
  }
});

/* Launch review H5: a held Named-moves row keeps "See X in Overlap →" when
   the name's Overlap row is itself held in the Overlap island. */
import { overlapAnchorFor } from "../src/lib/ui/signals-institutional.ts";

test("H5: a held move row's opened body links its Overlap row from the server's answer (data-ov), even with that row absent from the DOM", () => {
  const model = fixtureInstitutional({ moves: fixtureMoves(200, { broadOnly: 10 }) });
  const tickers = [...new Set(model.domSet.map((m) => m.ticker).filter((t): t is string => !!t))];
  const overlapIds = new Set(tickers.map((t) => overlapAnchorFor(t)!).filter(Boolean));
  const html = signalsInstitutionalHtml(model, CTX, { overlapIds });
  const held = island<HeldMoves>(html, "mv-list")!;
  const at = held.rows.findIndex((r) => r.ov !== null && r.ticker);
  assert.ok(at >= 0, "precondition: a held row whose name is in the Overlap");
  const r = held.rows[at]!;
  assert.match(moveRowFrom(r, held.shared.sec, true, held.shared.tv), new RegExp(`data-ov="${r.ov}"`), "the lean row carries the server's anchor");
  for (const strip of [false, true]) {
    // the Overlap rows are not in this DOM at all: held in their island, as on a page with more names than the first view
    const { doc, restore } = installDom(html);
    try {
      const pager = initNamedMoves()!;
      const row = pager.materialize(r.id)!;
      assert.ok(row, "the held row renders");
      assert.equal(doc.getElementById(r.ov!), null, "its Overlap row is not in the DOM");
      if (strip) row.removeAttribute("data-ov");
      pager.fill(row);
      const link = row.querySelector(".mv-ov-link a");
      if (strip) assert.equal(link, null, "re-planted control: without data-ov the DOM-only check drops the link (the reviewed defect)");
      else assert.equal(link?.getAttribute("href"), `#${r.ov}`, "the opened body links the Overlap row");
    } finally {
      restore();
    }
  }
});

/* Launch review H6: the bank's count is of (ticker, side) blocks. */
test("H6: 'Congress lines · N names and sides' — the count equals the bank's blocks, in the page and in its island", () => {
  const model = fixtureInstitutional({ moves: fixtureMoves(200, { broadOnly: 10 }) });
  const html = signalsInstitutionalHtml(model, CTX);
  const m = /<summary>Congress lines · ([\d,]+) (names and sides|name and side)<\/summary>/.exec(html);
  assert.ok(m, "the bank names what it counts");
  const bank = html.slice(html.indexOf('id="mv-bank"'));
  const inPage = (bank.slice(0, bank.indexOf("</details>")).match(/data-cong="/g) ?? []).length;
  const held = island<{ rows: unknown[] }>(html, "mv-bank")?.rows.length ?? 0;
  assert.equal(Number(m[1]!.replace(/,/g, "")), inPage + held, `${inPage} in the page + ${held} held`);
  // re-planted control: the bare count the review found is gone
  assert.doesNotMatch(html, /<summary>Congress lines · [\d,]+<\/summary>/);
});
