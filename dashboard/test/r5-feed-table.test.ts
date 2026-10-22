/* R5/R18 — the disclosure feed is a real table with one named render root, and
   its sort lives in column headers rather than a <select>.

   The structural half matters as much as the behavioural half: a <tr> may
   contain only cells, and a browser HOISTS an illegal child out of the table
   instead of erroring. That failure is silent and it would take the mobile
   fold with it, so it is asserted rather than eyeballed.

   signals-v3 M1: the feed has ONE rendering now — the ledger composition
   /congress/ shows. The classic nine-cell rendering, its column list
   (`FEED_COLUMNS`) and its unsortable head served only /watchlist/, and were
   deleted with that page; the cases that pinned them are restated here
   against the rendering that remains. */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import {
  feedHeadHtml,
  feedItemHtml,
  txnRowHtml,
  paperRowHtml,
  type TxnRow,
  type PaperRow,
  type RenderCtx,
} from "../src/lib/format.ts";

const CTX: RenderCtx = {};
const HEAD = feedHeadHtml({ activeKey: "filed", activeDir: "desc", notes: { scope: "congress-feed" } });

function txn(over: Partial<TxnRow> = {}): TxnRow {
  return {
    kind: "txn", txnId: "t-1", asset: null, assetType: null,
    filed: "2026-08-01", traded: "2026-07-20", name: "A Member", bioguide: "A000001",
    party: "R", state: "OK", district: null, chamber: "senate", ticker: "WMB",
    side: "purchase", owner: "self", low: 1001, high: 15000, lag: 12, late: 0,
    flags: [], doc: "https://efdsearch.senate.gov/x", ...over,
  };
}
function paper(over: Partial<PaperRow> = {}): PaperRow {
  return {
    kind: "paper", filed: "2026-08-05", name: "A Member", bioguide: "A000001",
    party: "R", state: "OK", district: null, chamber: "senate",
    doc: "https://efdsearch.senate.gov/p", ...over,
  };
}

/** Direct children of a <tr>, by tag. */
function rowChildren(html: string): string[] {
  const inner = html.slice(html.indexOf(">") + 1, html.lastIndexOf("</tr>"));
  const out: string[] = [];
  let depth = 0;
  for (const m of inner.matchAll(/<(\/?)([a-zA-Z]+)\b[^>]*?(\/?)>/g)) {
    const [, close, tag, selfClose] = m;
    if (close) { depth--; continue; }
    if (depth === 0) out.push(tag!.toLowerCase());
    if (!selfClose && !["br", "img", "input"].includes(tag!.toLowerCase())) depth++;
  }
  return out;
}

test("R18: a transaction row is a <tr> whose every direct child is a cell", () => {
  const html = txnRowHtml(txn(), CTX);
  assert.ok(html.startsWith("<tr "), "the feed row is a table row");
  const kids = rowChildren(html);
  assert.ok(kids.length > 0, "the row has cells");
  assert.deepEqual(
    [...new Set(kids)],
    ["td"],
    `a <tr> may hold only cells; the browser would hoist anything else out of the table: ${kids.join(", ")}`,
  );
});

test("R18: a paper row is a <tr> whose every direct child is a cell", () => {
  const kids = rowChildren(paperRowHtml(paper(), CTX));
  assert.deepEqual([...new Set(kids)], ["td"]);
});

test("R18: the wrapper divs the old fold used are gone from the markup entirely", () => {
  // They are illegal inside a table AND they no longer have a purpose: the
  // fold is grid areas on the row now.
  for (const html of [txnRowHtml(txn(), CTX), paperRowHtml(paper(), CTX)]) {
    assert.ok(!html.includes("row-line1"), "row-line1 must not be emitted");
    assert.ok(!html.includes("row-line2"), "row-line2 must not be emitted");
  }
});

test("R4 / F7: the cells are emitted in the head's column order, role for role", () => {
  /* R4's ticker-before-member order belonged to the classic rendering; the
     ledger composition orders Kind · Member · Ticker (DESIGN-POLISH M1). What
     must hold for any order is that each cell sits under its own column. */
  const roles = (html: string, tag: "td" | "th"): string[] =>
    [...html.matchAll(new RegExp(`<${tag}\\b[^>]*class="([^"]*)"`, "g"))].map((m) => m[1]!.split(" ").find((c) => c.startsWith("c-"))!);
  assert.deepEqual(roles(txnRowHtml(txn(), CTX), "td"), roles(HEAD, "th"));
  assert.deepEqual(roles(HEAD, "th"), ["c-kind", "c-member", "c-ticker", "c-secondary", "c-num", "c-bar", "c-num", "c-src"]);
});

test("R5/R19: honesty content survives the conversion — both dates, lag, flags, provenance", () => {
  const html = txnRowHtml(txn({ flags: ["amount_spouse_cap"], late: 1, lag: 60 }), CTX);
  assert.match(html, /class="cell cell-traded c-num"/, "the dates are a cell");
  assert.match(html, /<time datetime="2026-08-01"/, "the filed date is present in full");
  assert.match(html, /<time datetime="2026-07-20"/, "the trade date is present in full");
  assert.match(html, /07-20<\/time> → <span class="visually-hidden">Filed <\/span>/, "traded → filed, in that order");
  assert.match(html, /LATE·60d/, "the filing lag survives");
  /* DESIGN-POLISH M3 (L4, T3.10): a late row keeps its SIDE word — the kind
     cell reads BUY, never LATE; lateness is the gold edge and the unchanged
     LATE·Nd. */
  assert.match(html, /data-edge="late"/);
  assert.match(html, /<td class="cell cell-side c-kind buy" role="cell">BUY<\/td>/, "the late row reads its side, and nothing else sits in the cell");
  assert.doesNotMatch(html, /c-kind buy">LATE/, "control: LATE never replaces the side");
  assert.match(html, /class="flag solid"><span class="note"><button[^>]*>spouse cap</, "the flag chip survives, as its definition's trigger");
  assert.match(html, /class="cell cell-src c-src"/, "the provenance link is a cell");
  assert.match(html, /visually-hidden">Filed /, "the filed date keeps its accessible label");
  assert.match(html, /visually-hidden">Traded /, "the trade date keeps its accessible label");
});

test("R5: the row's classes are its own — no caller can hang a marker on it", () => {
  /* The one caller that marked rows (/watchlist/'s "new since" class) was
     removed in signals-v3 M1, and the row-class parameter with it. The
     property it guarded — no marker as a wrapping element, which a table
     would hoist away — holds by construction: the row is the outermost tag. */
  assert.equal(feedItemHtml.length, 2, "feedItemHtml takes the item and the context only");
  assert.equal(txnRowHtml.length, 2);
  assert.equal(paperRowHtml.length, 2);
  /* Launch M3a (R40): the row's only additions are its explicit table role —
     still the outermost tag, still no caller-supplied marker class. */
  assert.match(feedItemHtml(txn(), CTX), /^<tr class="feed-row feed-grid-cols reference-row buy" data-edge="buy" role="row">/);
  assert.match(feedItemHtml(paper(), CTX), /^<tr class="feed-row paper reference-paper" role="row">/);
});

/* ---------- the page contract ---------- */

const page = readFileSync(
  path.resolve(import.meta.dirname, "..", "src", "pages", "congress", "index.astro"),
  "latin1",
);

test("R5: the sort <select> is gone and the two orderable columns are headers", () => {
  assert.ok(!page.includes('id="filter-sort"'), "the sort select is removed");
  // F7: the header markup is ONE shared contract. The page must still be the
  // thing that renders it — asserting only on the library would prove nothing
  // about this page, which is exactly how the missing `#feed` id survived
  // every test (F1).
  assert.match(page, /feedHeadHtml\(\{ activeKey: "filed", activeDir: "desc", notes: \{ scope: "congress-feed" \} \}\)/, "the page renders the shared head");
  assert.match(HEAD, /data-feed-sort="filed"[^>]*aria-sort="descending"/);
  assert.match(HEAD, /data-feed-sort="amount"[^>]*aria-sort="none"/);
});

test("R5: every non-sortable feed column states WHY — its label opens the reason", () => {
  // Six of the eight columns carry no well-defined order; each must say so
  // rather than sit mute. The reason is the note its label opens (SL), never a
  // tooltip.
  const reasons = HEAD.match(/<span class="note-pop" popover id="n-congress-feed-/g) ?? [];
  assert.equal(reasons.length, 6, `expected a stated reason per unsortable column, saw ${reasons.length}`);
  assert.equal((HEAD.match(/data-feed-sort="/g) ?? []).length, 2, "the other two are sort controls");
  assert.ok(!HEAD.includes("title="), "the reason is never a tooltip");
  assert.ok(!HEAD.includes('class="col-why"'), "nor the retired visible span");
});

test("F7 (signals-v3 M1): one page and its island render the feed contract — nothing else", () => {
  /* The second renderer of this contract — /watchlist/, with its unsortable
     head and nine-cell rows — was removed. Any new caller of the head or the
     rows outside /congress/ and its feed island reddens this. */
  const src = path.resolve(import.meta.dirname, "..", "src");
  const callers: string[] = [];
  const walk = (d: string): void => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) walk(full);
      else if (/\.(ts|astro)$/.test(e.name) && full !== path.join(src, "lib", "format.ts")) {
        if (/\b(?:feedHeadHtml|feedItemHtml|txnRowHtml|paperRowHtml)\(/.test(readFileSync(full, "latin1"))) callers.push(path.relative(src, full));
      }
    }
  };
  walk(src);
  assert.deepEqual(callers.sort(), ["pages/congress/index.astro", "scripts/feed-client.ts"]);
});

test("F7: the header count matches the number of cells feedItemHtml emits", () => {
  // The real invariant behind F7: every cell needs a column. A column added
  // to the row renderer without one here re-creates the defect one cell at a
  // time. A paper row spans the columns it cannot fill.
  const cells = (feedItemHtml(txn(), CTX).match(/<td\b/g) ?? []).length;
  const heads = (HEAD.match(/<th\b/g) ?? []).length;
  assert.equal(heads, cells, "every emitted cell must have a column to belong to");
  assert.equal(heads, 8);
  const paperRow = feedItemHtml(paper(), CTX);
  const spans = [...paperRow.matchAll(/<td\b([^>]*)>/g)].reduce((n, m) => n + Number(/colspan="(\d+)"/.exec(m[1]!)?.[1] ?? 1), 0);
  assert.equal(spans, heads, "a paper row spans exactly the head's columns");
});

test("R18: the feed's render root is named exactly once, and it is a tbody", () => {
  assert.match(page, /<tbody id="feed-tbody"/);
  assert.equal((page.match(/id="feed-tbody"/g) ?? []).length, 1, "one root, one owner");
  assert.ok(!page.includes('id="feed-body"'), "the old div root is gone");
});

test("R18: the table's direct children are only caption, thead and tbody", () => {
  // The property is unchanged; only where the <thead> is authored moved (F7).
  // It is asserted in two halves: the page holds exactly caption, the head
  // fragment and the tbody, and the fragment expands to exactly one <thead>
  // holding exactly one <tr>. A stray element in either half is hoisted out of
  // the table by the browser, silently.
  for (const [file, seg] of [
    ["congress", tableSegment(page)],
  ] as const) {
    const kids = [...seg.matchAll(/^\s{8}<(\w+)/gm)].map((m) => m[1]);
    assert.deepEqual(
      [...new Set(kids)].sort(),
      ["Fragment", "caption", "tbody"],
      `${file}: a stray element between the head and the tbody is hoisted out silently`,
    );
  }
  for (const head of [HEAD]) {
    assert.match(head, /^<thead role="rowgroup"><tr class="feed-head feed-grid-cols reference-head" role="row">/);
    assert.match(head, /<\/tr><\/thead>$/);
    assert.equal((head.match(/<tr\b/g) ?? []).length, 1, "one header row");
    // nothing but cells directly inside the row
    const inner = head.slice(head.indexOf(">", head.indexOf("<tr")) + 1, head.indexOf("</tr>"));
    assert.ok(!/^<(?!th\b)/.test(inner.trim()), "the row holds only cells");
  }
});

/** The `<table class="feed-table">` … `</table>` slice of a page source. */
function tableSegment(src: string): string {
  const i = src.search(/<table class="feed-table(?: reference-feed)?"[^>]*>/);
  assert.ok(i >= 0, "the page renders a feed table");
  return src.slice(i, src.indexOf("</table>", i));
}

