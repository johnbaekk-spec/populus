/* Premarketing follow-ups: the filer page's first-load headroom, and the
   Signals summary name links out of the phone tab order.

   (a) PR #172's Ticker column took the live Berkshire filer page from 2,765
   to 2,985 first-load elements against the 3,000 budget (R35, LD31): each
   mapped change row gained a ticker note (td, note, button, ticker, panel —
   five elements). The page wins that back without changing what a reader
   sees: the changes rows past the compact twenty are HELD — island data the
   "Show all" draws through the same row function, the rule-8 carrier the
   member page's Filing history uses — instead of hidden rows in the DOM, and
   the issuer label carries its filed-name marker on its own span.

   (b) premarketing C's overlay name links collapse to a 1×1 box at ≤720px,
   where the row tap opens the row; they are not rendered there (display:none),
   so they leave the tab order, while above the fold they stay focusable. Every
   opened row links the same page, so nothing becomes unreachable.

   Each property has a re-planted control. */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import { withTableRoles } from "../src/lib/format.ts";
import { CHANGES_COMPACT_ROWS, changesTableHtml, FILER_CHANGES_ROWS, filerChangeRowHtml, filerChangesHtml, type FilerChangeRowIn, type FilerChangeShared } from "../src/lib/ui/institutional.ts";
import { triageRowHtml } from "../src/lib/ui/signals.ts";
import { moveRowFrom, moveRowData, moveSection } from "../src/lib/ui/signals-institutional.ts";
import { overlapItemHtml } from "../src/lib/ui/signals-overlap.ts";
import { buildTriage } from "../src/lib/signal-triage.ts";
import type { QoqDeltaRow } from "../src/lib/inst.ts";
import { firstLoadElements } from "./lib/astro-template.ts";
import { parseHeldIsland } from "../src/lib/held-rows.ts";
import { loadTriageFixture } from "./lib/triage-fixture.ts";
import { fixtureInstitutional, fixtureMoves } from "./lib/inst-signals-fixture.ts";
import { fixtureOverlap } from "./lib/overlap-fixture.ts";
import { MiniElement } from "./lib/mini-dom.ts";
import { parseRules, winning, type El } from "./lib/cascade.ts";

/* ------------------------------------------------ (a) the filer headroom */

const KINDS = ["trim", "add", "new", "exit"] as const;
function delta(i: number, over: Partial<QoqDeltaRow> = {}): QoqDeltaRow {
  const kind = KINDS[i % KINDS.length]!;
  return {
    cik: "0001067983",
    position_key: `pos:${1000 + i}`,
    issuer_key: `iss:${200 + i}`,
    put_call: "LONG",
    curr_period: "2026-03-31",
    prev_period: "2025-12-31",
    change_kind: kind,
    prev_value_usd: kind === "new" ? null : 9_000_000_000 - i * 1_000_000,
    curr_value_usd: kind === "exit" ? null : 8_000_000_000 - i * 1_000_000,
    delta_value_usd: -1_000_000_000 + i,
    prev_shares: kind === "new" ? null : 500_000_000 - i,
    curr_shares: kind === "exit" ? null : 490_000_000 - i,
    delta_shares: kind === "add" || kind === "new" ? 10_000 + i : -(10_000 + i),
    ssh_prnamt_type: "SH",
    flags: [],
    issuer_name: `ISSUER ${i} CORP`,
    title_of_class: "COM",
    ...over,
  } as QoqDeltaRow;
}
/** Berkshire's shape on the live page (CIK 1067983, 2026-03-31): 29 position
    changes, 16 mark-to-market rows, 41 of the 45 mapped to a reviewed ticker,
    one issuer filed in two share classes. */
function berkshireShaped(): { deltas: QoqDeltaRow[]; tickers: Record<string, string> } {
  const deltas: QoqDeltaRow[] = [
    ...Array.from({ length: 29 }, (_, i) => delta(i)),
    ...Array.from({ length: 16 }, (_, i) => delta(29 + i, { change_kind: "held", delta_shares: 0, prev_shares: 1000, curr_shares: 1000 })),
  ];
  deltas[3] = { ...deltas[3]!, issuer_name: "ISSUER 2 CORP", title_of_class: "CL A" };
  const tickers: Record<string, string> = {};
  deltas.forEach((d, i) => {
    if (i % 11 !== 10) tickers[d.position_key] = `T${i}`;
  });
  return { deltas, tickers };
}
const ISLAND_RE = /<script type="application\/json" data-held-for="filer-changes-tbody" data-held-render="filer-changes">([\s\S]*?)<\/script>/;
function served(): string {
  const { deltas, tickers } = berkshireShaped();
  /* as the page serves it: Base's withTableRoles over the page body */
  return withTableRoles(filerChangesHtml(["2026-03-31"], "2026-03-31", null, deltas, "2026-05-15", 25, { total: deltas.length, tickers }));
}
/** The composition before this change: the held rows back in the tbody as
    hidden `data-compact-extra` rows, and the issuer label's two spans. */
function replanted(html: string): string {
  const m = ISLAND_RE.exec(html)!;
  const island = parseHeldIsland(m[1]!)! as { offset: number; shared: FilerChangeShared; rows: FilerChangeRowIn[] };
  const rows = island.rows.map((r, j) => filerChangeRowHtml(r, island.offset + j, island.shared).replace(/^<tr\b/, "<tr data-compact-extra")).join("\n");
  const close = html.indexOf("</tbody>", html.indexOf('<tbody id="filer-changes-tbody"'));
  return (html.slice(0, close) + "\n" + withTableRoles(rows) + html.slice(close))
    .replace(m[0], "")
    .replace(/<span class="design-holding-name filed-name">([^<]*)<\/span>/g, '<span class="design-holding-name"><span class="filed-name">$1</span></span>');
}

/** The ceiling: the fixture's changes band measured after this change (916
    first-load elements, against 1,163 re-planted — 247 fewer, more than the
    ~220 the Ticker column cost the live page). */
const CHANGES_BAND_CEILING = 916;

test("filer headroom (R35): the changes band's first load drops by more than the Ticker column's ~220 elements on a Berkshire-shaped fixture", (t) => {
  const html = served();
  const now = firstLoadElements(html);
  const before = firstLoadElements(replanted(html));
  t.diagnostic(`Berkshire-shaped changes band: ${now} first-load elements now, ${before} re-planted (saved ${before - now})`);
  assert.ok(now <= CHANGES_BAND_CEILING, `the band loads ${now} elements; the ceiling is ${CHANGES_BAND_CEILING}`);
  // control: the pre-change composition is the measured amount heavier
  assert.ok(before - now >= 220, `re-planted the band loads ${before} elements, ${before - now} more`);
  // nothing past the compact twenty is in the DOM; all of it is in the island, once, in order
  const tbody = /<tbody id="filer-changes-tbody"[^>]*>([\s\S]*?)<\/tbody>/.exec(html)!;
  assert.match(tbody[0], /^<tbody id="filer-changes-tbody" data-collapsed="true" data-held="json"/);
  assert.equal((tbody[1]!.match(/<tr /g) ?? []).length, CHANGES_COMPACT_ROWS);
  assert.doesNotMatch(html, /data-compact-extra/, "no hidden change row in the DOM");
  const island = parseHeldIsland(ISLAND_RE.exec(html)![1]!)!;
  assert.equal(island.offset, CHANGES_COMPACT_ROWS);
  assert.equal(island.rows.length, 29 - CHANGES_COMPACT_ROWS);
  assert.match(html, /data-compact-for="filer-changes-tbody" data-compact-total="29" data-compact-shown="20"/, "the show-all still counts the page's 29");
});

test("filer headroom: a held row renders byte for byte what the table renders when nothing is held — ticker note, class note, ids and all", () => {
  const { deltas, tickers } = berkshireShaped();
  const opts = { total: deltas.length, tickers };
  const held = changesTableHtml(deltas, "2026-03-31", null, opts);
  const island = parseHeldIsland(ISLAND_RE.exec(held)![1]!)! as { offset: number; shared: FilerChangeShared; rows: FilerChangeRowIn[] };
  const drawn = island.rows.map((r, j) => filerChangeRowHtml(r, island.offset + j, island.shared));
  /* the same table with no compact bound: every page row in the tbody */
  const open = changesTableHtml(deltas, "2026-03-31", null, { ...opts, compact: 1_000 });
  assert.doesNotMatch(open, ISLAND_RE, "nothing held, no island");
  const rows = /<tbody id="filer-changes-tbody">([\s\S]*?)<\/tbody>/.exec(open)![1]!.split("\n");
  assert.equal(rows.length, 29);
  assert.deepEqual(drawn, rows.slice(CHANGES_COMPACT_ROWS), "the island's rows are the unbounded table's rows 21..29, byte for byte");
  assert.equal(FILER_CHANGES_ROWS, "filer-changes");
  // control: the island's table-wide inputs are load-bearing
  const wrong = island.rows.map((r, j) => filerChangeRowHtml(r, island.offset + j, { ...island.shared, columns: island.shared.columns.filter((c) => c !== "ticker") }));
  assert.notDeepEqual(wrong, drawn, "control: the columns travel with the island");
  // every honesty field of a mapped row survives the hold
  const mapped = drawn.find((h) => h.includes('<td class="c-ticker"><span class="note">'))!;
  assert.match(mapped, /share class as filed: <span class="filed-name">COM<\/span> · position key <code>pos:\d+<\/code> · issuer key <code>iss:\d+<\/code>/);
  assert.match(mapped, /a reviewed mapping row for this filed issuer name and share class \(never inferred from the name\)/);
  // the issuer label keeps its filed-name marker, so the button is named by its content
  assert.match(mapped, /<button type="button" class="note-btn note-label" [^>]*><span class="design-holding-name filed-name">ISSUER \d+ CORP<\/span><span class="visually-hidden">, explain<\/span><\/button>/);
});

test("filer headroom: the filer page and the /e/ route register the changes row function the island names", () => {
  for (const rel of [["pages", "institutional", "filers", "[cik].astro"], ["pages", "e", "index.astro"]]) {
    const src = readFileSync(path.resolve(import.meta.dirname, "..", "src", ...rel), "utf-8");
    assert.match(src, /registerHeldRows\(FILER_CHANGES_ROWS, filerChangeRowHtml\)/, rel.join("/"));
    assert.ok(src.indexOf("registerHeldRows(FILER_CHANGES_ROWS") < src.indexOf("initDomDisclosures()"), `${rel.join("/")}: registered before the binder runs`);
  }
});

/* ------------------------------------- (b) phone name links out of the tab order */

const LINKS = ["si-row-ml", "mv-mgr-a", "ov-who-a", "ov-mw-a"] as const;

test("premarketing C (phone): at ≤720px the summary name links are display:none — out of the tab order; above it they render and stay focusable", () => {
  const rules = parseRules(readFileSync(path.resolve(import.meta.dirname, "..", "src", "styles", "late-additions.css"), "utf-8"));
  const parent: Record<(typeof LINKS)[number], string> = { "si-row-ml": "si-row", "mv-mgr-a": "mv-item", "ov-who-a": "ov-item", "ov-mw-a": "ov-item" };
  for (const cls of LINKS) {
    const chain: El[] = [{ tag: "html" }, { tag: "body" }, { tag: "article", classes: [parent[cls]] }, { tag: "a", classes: [cls], attrs: { href: "/x/" } }];
    for (const width of [360, 390, 720]) assert.equal(winning(rules, chain, "display", { width })?.value, "none", `.${cls} @${width}px`);
    for (const width of [721, 1280]) assert.notEqual(winning(rules, chain, "display", { width })?.value ?? "inline", "none", `.${cls} @${width}px stays rendered`);
    // no tabindex removes it anywhere: above the fold it is a real link in the tab order
  }
  // control: the cascade reads a display:none planted for the desktop too
  const planted = parseRules(":is(.si-row-ml) { display: none; }");
  assert.equal(winning(planted, [{ tag: "a", classes: ["si-row-ml"] }], "display", { width: 1280 })?.value, "none");
});

const text = (el: MiniElement | null | undefined): string => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
function article(html: string): MiniElement {
  const root = new MiniElement("body");
  root.innerHTML = html;
  return root.querySelector("article")!;
}
const own = (a: MiniElement, cls: string): MiniElement[] => a.children.filter((c) => c.tagName === "a" && c.classList.contains(cls));
const bodyHrefs = (a: MiniElement): string[] => a.querySelector("details")!.querySelectorAll("a").map((l) => l.getAttribute("href") ?? "");

test("premarketing C (phone): every row whose summary name is linked links the same page in its opened body, so hiding the overlay at the fold loses nothing", () => {
  const CTX = {};
  // a Congress row: "Name ↗"
  const f = loadTriageFixture();
  const tr = buildTriage(f.artifact, f.rows, { committee: f.committee, identityOf: f.identityOf });
  let congress = 0;
  for (const row of tr.rows) {
    const a = article(triageRowHtml(row, CTX));
    for (const l of own(a, "si-row-ml")) {
      congress++;
      assert.ok(bodyHrefs(a).includes(l.getAttribute("href")!), `${text(l)}: the opened row links it`);
    }
  }
  assert.ok(congress > 0, "the fixture exercises the member link");
  // a named move: "Filer page ↗" (a lean held row fills the same body on open, from data-fp)
  const model = fixtureInstitutional({ moves: fixtureMoves(40) });
  const sec = moveSection(model);
  let moves = 0;
  for (const [i, m] of model.moves.entries()) {
    const r = moveRowData(m, `mv-${i}`, model);
    const a = article(moveRowFrom(r, sec));
    for (const l of own(a, "mv-mgr-a")) {
      moves++;
      assert.ok(bodyHrefs(a).includes(l.getAttribute("href")!), `${text(l)}: the opened row links it`);
    }
    const lean = article(moveRowFrom(r, sec, true));
    if (own(lean, "mv-mgr-a").length) assert.equal(lean.getAttribute("data-fp"), own(lean, "mv-mgr-a")[0]!.getAttribute("href"), "a lean row carries the same filer page for its body");
  }
  assert.ok(moves > 0, "the fixture exercises the manager link");
  // an Overlap row: the member and manager lines
  const o = fixtureOverlap();
  const fp = (cik: string): string => `/institutional/filers/${cik}/`;
  let overlap = 0;
  for (const row of o.all) {
    const a = article(overlapItemHtml(row, row, { core: 0, all: 0 }, o, CTX, true, fp));
    for (const cls of ["ov-who-a", "ov-mw-a"]) {
      for (const l of own(a, cls)) {
        overlap++;
        assert.ok(bodyHrefs(a).includes(l.getAttribute("href")!), `${text(l)}: the opened row links it`);
      }
    }
  }
  assert.ok(overlap > 0, "the fixture exercises the Overlap links");
});
