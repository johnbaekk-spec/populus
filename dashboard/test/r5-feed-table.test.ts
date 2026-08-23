/* R5/R18 — the disclosure feed is a real table with one named render root, and
   its sort lives in column headers rather than a <select>.

   The structural half matters as much as the behavioural half: a <tr> may
   contain only cells, and a browser HOISTS an illegal child out of the table
   instead of erroring. That failure is silent and it would take the mobile
   fold with it, so it is asserted rather than eyeballed. */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  FEED_COLUMNS,
  feedHeadHtml,
  feedItemHtml,
  txnRowHtml,
  paperRowHtml,
  type TxnRow,
  type PaperRow,
  type RenderCtx,
} from "../src/lib/format.ts";

const CTX: RenderCtx = { watched: new Set() };

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

test("R4: the cells are emitted ticker-before-member", () => {
  const html = txnRowHtml(txn(), CTX);
  assert.ok(
    html.indexOf("cell-ticker") < html.indexOf("cell-member"),
    "ticker is the row's anchor and must precede the member",
  );
});

test("R5/R19: honesty content survives the conversion — both dates, lag, flags, provenance", () => {
  const html = txnRowHtml(txn({ flags: ["amount_spouse_cap"], late: 1, lag: 60 }), CTX);
  assert.match(html, /class="cell cell-filed"/, "the filed date is a cell");
  assert.match(html, /class="cell cell-traded"/, "the trade date is a cell");
  assert.match(html, /2026-08-01/, "the filed date is present in full");
  // `tradedText` has always rendered the trade date as MM-DD beside the filed
  // date — that predates this change and is not what the conversion touched.
  assert.match(html, /class="traded-date">07-20</, "the trade date is present");
  assert.match(html, /07-20 → 08-01/, "the folded combined-date string survives");
  assert.match(html, /LATE·60d/, "the filing lag survives");
  assert.match(html, /class="flag solid">spouse cap</, "the flag chip survives");
  assert.match(html, /cell-src/, "the provenance link is a cell");
  assert.match(html, /visually-hidden">Filed /, "the filed date keeps its accessible label");
  assert.match(html, /visually-hidden">Traded /, "the trade date keeps its accessible label");
});

test("R5: a row class rides on the ROW, not on a wrapping element", () => {
  // /watchlist/ marks new-since rows. As a wrapping <div> that marker would be
  // hoisted out of the tbody and detached from every row it marked.
  const html = feedItemHtml(txn(), CTX, "watch-new");
  assert.match(html, /^<tr class="feed-row feed-grid-cols watch-new"/);
  assert.ok(!html.includes("<div class=\"watch-new\""), "never a wrapping div");
});

/* ---------- the page contract ---------- */

const page = readFileSync(
  path.resolve(import.meta.dirname, "..", "src", "pages", "congress", "index.astro"),
  "latin1",
);

test("R5: the sort <select> is gone and the two orderable columns are headers", () => {
  assert.ok(!page.includes('id="filter-sort"'), "the sort select is removed");
  // F7: the header markup moved into ONE shared contract because /watchlist/
  // renders the same nine cells. The page must still be the thing that renders
  // it — asserting only on the library would prove nothing about this page,
  // which is exactly how the missing `#feed` id survived every test (F1).
  assert.match(page, /feedHeadHtml\(\{ sortable: true/, "the page renders the shared head");
  const head = feedHeadHtml({ sortable: true, activeKey: "filed", activeDir: "desc" });
  assert.match(head, /data-feed-sort="filed"[^>]*aria-sort="descending"/);
  assert.match(head, /data-feed-sort="amount"[^>]*aria-sort="none"/);
});

test("R5: every non-sortable feed column states WHY, in visible text", () => {
  // Seven of the nine columns carry no well-defined order; each must say so
  // rather than sit mute. (The star column is labelled for screen readers and
  // heads no data.)
  const head = feedHeadHtml({ sortable: true, activeKey: "filed", activeDir: "desc" });
  const whys = head.match(/class="col-why"/g) ?? [];
  assert.ok(whys.length >= 6, `expected a stated reason per unsortable column, saw ${whys.length}`);
  assert.ok(!head.includes('title="the rank'), "the reason is visible text, never a tooltip");
});

test("F7: the watchlist renders the SAME contract, and its two orderable columns state why", () => {
  // Its nine cells had no <thead> at all, so none of them had a column.
  const wl = readFileSync(
    path.resolve(import.meta.dirname, "..", "src", "pages", "watchlist", "index.astro"),
    "latin1",
  );
  assert.match(wl, /feedHeadHtml\(\{\s*sortable: false/, "the watchlist renders the shared head");
  assert.match(wl, /<tbody id="watch-body">/);
  const head = feedHeadHtml({ sortable: false, whyUnsorted: "no sort control on this view" });
  assert.ok(!head.includes("data-feed-sort"), "no dead sort header on a surface with no control");
  assert.ok(!head.includes("th-sort"), "and no dead button");
  // every labelled column states a reason, including the two that ARE orderable
  // elsewhere — an orderable column silently losing its header would be the
  // same unlabelled-cell defect in a new place
  assert.equal((head.match(/class="col-why"/g) ?? []).length, FEED_COLUMNS.length - 1);
});

test("F7: the header count matches the number of cells feedItemHtml emits", () => {
  // The real invariant behind F7: nine cells need nine columns. A column added
  // to the row renderer without one here re-creates the defect one cell at a
  // time.
  const cells = (feedItemHtml(txn(), CTX).match(/<td\b/g) ?? []).length;
  const heads = (feedHeadHtml({ sortable: true }).match(/<th\b/g) ?? []).length;
  assert.equal(heads, cells, "every emitted cell must have a column to belong to");
  assert.equal(heads, FEED_COLUMNS.length);
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
    ["watchlist", tableSegment(watchlistPage)],
  ] as const) {
    const kids = [...seg.matchAll(/^\s{8}<(\w+)/gm)].map((m) => m[1]);
    assert.deepEqual(
      [...new Set(kids)].sort(),
      ["Fragment", "caption", "tbody"],
      `${file}: a stray element between the head and the tbody is hoisted out silently`,
    );
  }
  for (const head of [
    feedHeadHtml({ sortable: true }),
    feedHeadHtml({ sortable: false, whyUnsorted: "x" }),
  ]) {
    assert.match(head, /^<thead><tr class="feed-head feed-grid-cols">/);
    assert.match(head, /<\/tr><\/thead>$/);
    assert.equal((head.match(/<tr\b/g) ?? []).length, 1, "one header row");
    // nothing but cells directly inside the row
    const inner = head.slice(head.indexOf(">", head.indexOf("<tr")) + 1, head.indexOf("</tr>"));
    assert.ok(!/^<(?!th\b)/.test(inner.trim()), "the row holds only cells");
  }
});

/** The `<table class="feed-table">` … `</table>` slice of a page source. */
function tableSegment(src: string): string {
  const i = src.indexOf('<table class="feed-table">');
  assert.ok(i >= 0, "the page renders a feed table");
  return src.slice(i, src.indexOf("</table>", i));
}

const watchlistPage = readFileSync(
  path.resolve(import.meta.dirname, "..", "src", "pages", "watchlist", "index.astro"),
  "latin1",
);
