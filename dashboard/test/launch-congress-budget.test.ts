/* Launch F2 — /congress/ inside its budgets (PLAN.md R35, SC5; LD26, LD31;
   pagination-and-counts.md rule 8).

   R35: the page's first load is at most 3,000 elements at 390 with
   JavaScript on. The boards' next step (fifty rows each) and Monthly flow's
   three hidden views (Dollars on listed stocks, both views of All assets)
   were in the DOM, hidden — no reader could see them, and a reader without
   JavaScript could never reach them. They now ride in the one held-rows
   island and are drawn, through the binder's one render path, when the
   reader asks.

   SC5: the page reads at most 240 words on the served HTML (the audit's rule,
   `lib/served-words.ts`). The count is stated once on screen (the count line;
   the pager keeps the same string for assistive technology, copy item
   congress-23's pager), the quick filters carry no visible label (the approved
   mock), and every caveat the plan names stays visible.

   The page is measured WHOLE on a production-shaped fixture (`lib/congress-
   page.ts`: the real Base layout and page template, the page's renderers).
   Both rulers reproduce the live T0 page exactly — 5,344 first-load elements
   (the phone audit's DOM count at 390, live 20261020.2) and 633 served words
   (the audit's words_visible_before) — evidence in DEV-NOTES (launch F2).
   Each gate carries a control that re-plants what it guards against. */

import { test } from "node:test";
import assert from "node:assert/strict";

import { firstLoadElements } from "./lib/astro-template.ts";
import { congressPageFixture } from "./lib/congress-page.ts";
import { drawnMonthlyFlow } from "./lib/held-views.ts";
import { outline, servedWords, wordsOfOutline } from "./lib/served-words.ts";
import { installDom } from "./lib/mini-dom.ts";
import { leadersRollup, rankNetRows, type LeaderRow } from "../src/lib/derive.ts";
import { sortRankingRows } from "../src/lib/congress-columns.ts";
import { COMPACT_ROWS, COMPACT_STEP, noteId, withTableRoles, type RenderCtx, type TxnRow } from "../src/lib/format.ts";
import { parseHeldIsland } from "../src/lib/held-rows.ts";
import { CONGRESS_ROOTS, congressRankingSection, type BuildStamps } from "../src/lib/ui/index.ts";
import { RANKING_HELD_ROWS, rankingHeldRowHtml, rankingRowsHtml, type RankingHeldRow, type RankingHeldShared } from "../src/lib/ui/rankings.ts";
import { initCongressSections } from "../src/scripts/congress-sections.ts";
import { heldRowsHtml } from "../src/scripts/inst-index-client.ts";

const DOM_BUDGET = 3_000;
const WORD_GATE = 240;

let page: ReturnType<typeof congressPageFixture> | null = null;
const served = (): ReturnType<typeof congressPageFixture> => (page ??= congressPageFixture());

/** Every held island in a document: its root, renderer and parsed body. */
function islands(html: string): { root: string; render: string; rows: unknown[]; offset: number; shared: unknown }[] {
  return [...html.matchAll(/<script type="application\/json" data-held-for="([^"]+)" data-held-render="([^"]+)">([\s\S]*?)<\/script>/g)].map((m) => {
    const body = parseHeldIsland(m[3]!)!;
    return { root: m[1]!, render: m[2]!, rows: body.rows, offset: body.offset, shared: body.shared };
  });
}

/** The page as it was before launch F2: each board's next step back in its
    tbody as hidden rows, and every Monthly flow view drawn in place. */
function replanted(html: string): string {
  let out = html;
  for (const isl of islands(html).filter((i) => i.render === RANKING_HELD_ROWS)) {
    const rows = (isl.rows as RankingHeldRow[]).map((r, j) => rankingHeldRowHtml(r, isl.offset + j, isl.shared as RankingHeldShared).replace(/^<tr\b/, "<tr hidden data-compact-hidden"));
    const open = out.indexOf(`<tbody id="${isl.root}"`);
    const close = out.indexOf("</tbody>", open);
    out = out.slice(0, close) + "\n" + withTableRoles(rows.join("\n")) + out.slice(close);
  }
  const at = out.indexOf('<section class="panel panel-wide" id="monthly-flow-section"');
  const end = out.indexOf("</section>", out.indexOf('id="mf-all"')) + "</section>".length;
  return out.slice(0, at) + drawnMonthlyFlow(out.slice(at, end)).innerHTML + out.slice(end);
}

/* ------------------------------------------------------------------ R35 */

test("R35 ruler: first-load elements count every start tag, never a script's or a noscript's body (inert text with scripting on)", () => {
  assert.equal(firstLoadElements(`<main><p>a <b>b</b></p><script type="application/json">{"x":"<b>"}</script><noscript><table><tr><td>x</td></tr></table></noscript><!-- <i> --></main>`), 5);
  // control: the same markup with the noscript's table parsed as elements reads more
  assert.equal(firstLoadElements(`<main><p>a <b>b</b></p><table><tr><td>x</td></tr></table></main>`), 6);
});

test("R35 (LD31): /congress/ loads at most 3,000 elements on the fixture; re-planting the held board rows and Monthly flow views breaks the budget", (t) => {
  const { html } = served();
  const now = firstLoadElements(html);
  const before = firstLoadElements(replanted(html));
  t.diagnostic(`fixture /congress/: ${now} first-load elements (budget ${DOM_BUDGET}); with the held content re-planted: ${before}`);
  assert.ok(now <= DOM_BUDGET, `the page loads ${now} elements; the budget is ${DOM_BUDGET}`);
  // control: the pre-F2 composition — the same page with its held content in the DOM — is over budget
  assert.ok(before > DOM_BUDGET, `re-planted, the page loads ${before} elements, over the budget`);
  // and what moved is exactly the held content: two board steps and three views
  const held = islands(html);
  assert.deepEqual(held.map((i) => `${i.root}:${i.render}`).sort(), [
    "members-ranked-tbody:congress-ranking",
    "mf-all:monthly-variant",
    "mf-stocks-dollars:monthly-dollars",
    "momentum-tbody:congress-ranking",
  ]);
  for (const i of held.filter((x) => x.render === RANKING_HELD_ROWS)) assert.equal(i.rows.length, COMPACT_STEP, `${i.root}: one step of ${COMPACT_STEP} rows`);
  assert.doesNotMatch(html, /<tr hidden/, "no held board row is in the DOM");
  assert.doesNotMatch(html, /class="rb-col/, "no Dollars bar is in the DOM");
});

/* ------------------------------------------------------------------ SC5 */

test("SC5: /congress/ reads at most 240 words on the served HTML; re-planting the pager's visible count breaks the gate", (t) => {
  const { html } = served();
  const words = servedWords(html);
  t.diagnostic(`fixture /congress/: ${words} served words (gate ${WORD_GATE})`);
  assert.ok(words <= WORD_GATE, `the page reads ${words} words; the gate is ${WORD_GATE}`);
  // control: the count said twice on screen again (the pager's range visible) is over the gate
  const twice = html.replace('class="pager-range visually-hidden"', 'class="pager-range"');
  assert.notEqual(twice, html);
  assert.ok(servedWords(twice) > WORD_GATE, `with the pager's count visible again the page reads ${servedWords(twice)} words`);
});

test("SC5 / R2: every caveat the plan keeps visible is counted as visible copy — the hidden rows, the device line, both dates, late, the estimate", () => {
  const { html } = served();
  const lines = wordsOfOutline(outline(html)).rows.map((r) => `${r.tag} ${r.text}`);
  const has = (re: RegExp, what: string): void => assert.ok(lines.some((l) => re.test(l)), `${what} is visible copy`);
  has(/^div\.filter-count .*transactions with a ticker [\d,]+ without a ticker and [\d,]+ paper filings are in All rows filtered on this device$/, "the With-ticker view's hidden rows and the device line");
  has(/^th\.c-num Traded filed$/, "both dates (the feed's dates column)");
  has(/^dd\.ledger-sub [\d.]+% filed late$/, "the late share");
  has(/^div\.mf-fill Filling in \(est\.\)$/, "the Filling in zone, labelled an estimate");
  has(/^p\.mf-readout\S* .*≈\d+% filed \(est\.\)$/, "the newest month's readout and its estimate");
  has(/^div\.mf-notes Shaded months are still filling in \(est\.\)$/, "the shading label");
  has(/^h2\.section-h \d+ months by trade date [\d,]+ excluded$/, "a board's excluded-row count");
  has(/^summary \d+ unrankable$/, "the not-rankable count");
  // the feed rows keep both dates and the LATE flag on the served page
  const feed = html.slice(html.indexOf('<tbody id="feed-tbody"'), html.indexOf("</tbody>", html.indexOf('<tbody id="feed-tbody"')));
  assert.equal((feed.match(/<tr\b/g) ?? []).length, (feed.match(/class="cell cell-traded\b/g) ?? []).length, "both dates on every feed row");
  assert.match(feed, /\blate\b/i, "a late row is flagged");
  // control: a caveat moved into a tip is not visible copy
  const tipped = html.replace(" · filtered on this device", '<span class="note-pop"> · filtered on this device</span>');
  assert.ok(!wordsOfOutline(outline(tipped)).rows.some((r) => /filtered on this device/.test(r.text)), "control: tip text is not counted");
});

/* ------------------------------------------------------------- the boards */

const BUILD = "2026-10-19";
const STAMPS: BuildStamps = { buildId: "b", generatedAt: `${BUILD} 12:00 UTC`, generatedAtDate: BUILD };

/** 80 members whose net intervals overlap their neighbours' (so every row
    after the first carries ≈), one of them budget-cut, inside the window. */
function boardRows(): TxnRow[] {
  return Array.from({ length: 80 }, (_, i): TxnRow => ({
    kind: "txn", txnId: `t${i}`, asset: "Widget Co", assetType: "ST", filed: "2026-09-01", traded: "2026-08-20",
    name: `Member ${i}`, bioguide: `M${String(i).padStart(6, "0")}`, party: "R", state: "OK", district: null, chamber: "house",
    ticker: `T${i}`, side: "purchase", owner: "self", low: 1001 + i * 1000, high: 15000 + i * 1000, lag: 12, late: i % 5 === 0 ? 1 : 0,
    flags: [], doc: "https://disclosures-clerk.house.gov/x", exchangedTicker: null,
  }));
}
const CUT = "M000030"; // a held row (rank 50 of 80 by net)
const CTX: RenderCtx = { referenceRankings: true, cutMembers: new Set([CUT]) };

function membersBoard(): { html: string; ranked: LeaderRow[] } {
  const rollup = leadersRollup(boardRows(), BUILD, { range: "12m", basis: "traded" });
  const html = congressRankingSection("leaders", rollup, STAMPS, CTX, {
    rootId: CONGRESS_ROOTS.membersRanked, undisclosedRootId: CONGRESS_ROOTS.membersUndisclosed, heading: "Members", sectionId: "members-section", compact: COMPACT_ROWS,
  });
  const ranked = sortRankingRows(rankNetRows(rollup.rows, (r) => r.net, (r) => r.id).ranked, "net", "desc").ranked;
  return { html, ranked };
}

test("rule 8 (launch F2): a board's next step rides in the island, in order, each once, and renders byte for byte the rows the server would have served — the ≈ of the first held row and a budget-cut link included", () => {
  const { html, ranked } = membersBoard();
  const [isl] = islands(html);
  assert.ok(isl && isl.root === CONGRESS_ROOTS.membersRanked && isl.render === RANKING_HELD_ROWS);
  assert.equal(isl.offset, COMPACT_ROWS, "the island continues after the ten shown rows");
  const rows = isl.rows as RankingHeldRow[];
  assert.deepEqual(rows.map((r) => r.r.id), ranked.slice(COMPACT_ROWS, COMPACT_ROWS + COMPACT_STEP).map((r) => r.id), "the next fifty, in the board's order");
  // the server's own rows for the first sixty, through the same row renderer
  const expected = rankingRowsHtml(ranked.slice(0, COMPACT_ROWS + COMPACT_STEP), "leaders", CTX).split(/\n(?=<tr\b)/);
  rows.forEach((r, j) => assert.equal(rankingHeldRowHtml(r, isl.offset + j, isl.shared as RankingHeldShared), expected[COMPACT_ROWS + j], `held row ${j + 1} is the served row`));
  assert.ok(rows[0]!.o, "the first held row overlaps the last shown one, so it carries ≈");
  const cut = rows.find((r) => r.r.bioguide === CUT)!;
  assert.equal(cut.c, 1, "the cut member's flag travels with its row");
  assert.match(rankingHeldRowHtml(cut, isl.offset + rows.indexOf(cut), isl.shared as RankingHeldShared), /href="\/e\/\?k=m(?::|%3A)M000030"/, "and its link goes to the generic route");
  // no-JS: the rows were never reachable without a script, so no noscript copy; the bound is stated
  assert.doesNotMatch(html, /<noscript><table/);
  assert.match(html, /<span class="compact-bound-count">1–10 of 80 ranked members<\/span>/);
  // controls: an overlap flag recomputed over the held rows alone, or a dropped cut flag, renders other bytes
  assert.notEqual(rankingHeldRowHtml({ ...rows[0]!, o: false }, isl.offset, isl.shared as RankingHeldShared), expected[COMPACT_ROWS]);
  const { c: _drop, ...uncut } = cut;
  assert.notEqual(rankingHeldRowHtml(uncut, isl.offset + rows.indexOf(cut), isl.shared as RankingHeldShared), expected[COMPACT_ROWS + rows.indexOf(cut)]);
});

/** The board in a page the island binds to (the page root the island reads its window from). */
function mountBoard(hash = ""): { doc: ReturnType<typeof installDom>["doc"]; restore(): void; sections: ReturnType<typeof initCongressSections>; asked: () => number } {
  const g = globalThis as unknown as Record<string, unknown>;
  const prevLoc = g.location;
  const { doc, restore } = installDom(
    `<main class="shell page" id="congress-page" data-generated-at-date="${BUILD}" data-range="12m" data-basis="traded">${withTableRoles(membersBoard().html)}</main>`,
  );
  g.location = { hash };
  let asked = 0;
  const sections = initCongressSections({ requestRows: () => void asked++ });
  return {
    doc,
    sections,
    asked: () => asked,
    restore: () => {
      restore();
      g.location = prevLoc;
    },
  };
}

test("rule 8 (launch F2): the first \"Show 50 more\" draws the held step through the binder's one render path — the served rows with the table's roles — and a collapse hides them again", () => {
  const m = mountBoard();
  try {
    const root = m.doc.getElementById(CONGRESS_ROOTS.membersRanked)!;
    const shown = (): number => root.querySelectorAll("tr").filter((tr) => !tr.hidden).length;
    const served = heldRowsHtml(CONGRESS_ROOTS.membersRanked, Array.from({ length: COMPACT_STEP }, (_, i) => i))!;
    const { ranked } = membersBoard();
    // what the binder inserts IS the served page's rows: the same function, then the layout's roles and card labels
    const page = withTableRoles(membersBoard().html.replace("</tbody>", "\n" + rankingRowsHtml(ranked.slice(0, COMPACT_ROWS + COMPACT_STEP), "leaders", CTX).split(/\n(?=<tr\b)/).slice(COMPACT_ROWS).join("\n") + "</tbody>"));
    const tbody = page.slice(page.indexOf(`<tbody id="${CONGRESS_ROOTS.membersRanked}"`), page.indexOf("</tbody>", page.indexOf(`<tbody id="${CONGRESS_ROOTS.membersRanked}"`)));
    assert.ok(tbody.endsWith(served), "the drawn rows equal the served rows byte for byte");
    assert.equal(shown(), COMPACT_ROWS);
    const btn = m.doc.querySelector(`.compact-disclosure[data-compact-for=${CONGRESS_ROOTS.membersRanked}] button`)!;
    btn.click();
    assert.equal(shown(), COMPACT_ROWS + COMPACT_STEP, "one press reveals the step");
    assert.match(m.doc.querySelector(`.compact-disclosure[data-compact-for=${CONGRESS_ROOTS.membersRanked}] .compact-bound-count`)!.textContent, /^1–60 of 80 /);
    assert.ok(m.asked() > 0, "and asks for the dataset, for the press after it");
    btn.click(); // the next step needs the dataset: it waits
    m.sections.receiveRows(boardRows());
    assert.equal(shown(), 80, "delivery lands the waiting step: every row");
    // sorting still works: a header press repaints from the delivered rows, each row once
    m.doc.querySelector('th[data-congress-sort="name"]')!.click();
    const names = root.querySelectorAll("tr").filter((tr) => !tr.hidden).map((tr) => tr.querySelector("a")?.textContent ?? "");
    assert.equal(names.length, 80);
    assert.equal(new Set(names).size, 80, "no row twice");
    assert.deepEqual(names, [...names].sort((a, b) => (a.toLowerCase() < b.toLowerCase() ? -1 : 1)), "ordered by name");
    btn.click();
    assert.equal(shown(), COMPACT_ROWS, "and a collapse returns to the first ten");
  } finally {
    m.restore();
  }
});

test("rule 8 (launch F2): a deep link to an element only a held board row carries opens its step and lands on it; a link to nothing held changes nothing", () => {
  const { ranked } = membersBoard();
  const target = noteId("board-net", ranked[COMPACT_ROWS + 7]!.id);
  const m = mountBoard(`#${target}`);
  try {
    const el = m.doc.getElementById(target);
    assert.ok(el, "the held row that carries the target is drawn");
    assert.equal(el!.closest("tr")!.hidden, false, "and showing");
    assert.match(m.doc.querySelector(`.compact-disclosure[data-compact-for=${CONGRESS_ROOTS.membersRanked}] .compact-bound-count`)!.textContent, /^1–60 of 80 /, "the count states the rows on screen");
  } finally {
    m.restore();
  }
  // controls: an id no row carries, and one a shown row already carries, open nothing
  for (const hash of ["#n-board-net-nowhere", `#${noteId("board-net", ranked[2]!.id)}`]) {
    const c = mountBoard(hash);
    try {
      const root = c.doc.getElementById(CONGRESS_ROOTS.membersRanked)!;
      assert.equal(root.querySelectorAll("tr").filter((tr) => !tr.hidden).length, COMPACT_ROWS, `${hash}: the board stays at its first ten`);
    } finally {
      c.restore();
    }
  }
});
