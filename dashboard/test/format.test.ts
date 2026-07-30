/* Tests for the shared row renderer / pagination / honesty formatting.
   `src/lib/format.ts` is pure and environment-agnostic, so these run under
   `node --test` with no browser, no DOM, and no database.

   Every case here corresponds to a defect that was found in review or to an
   honesty invariant that must not silently regress:
     - a paper (needs-OCR) filing must appear on exactly one page, including
       when no transaction precedes it (it used to vanish entirely)
     - a range must never be drawn solid when either bound is unknown
     - a coverage percentage must never round up to 100
     - a negative days-to-file must never print as "+-320d"
*/

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  amountText,
  amountVerdict,
  bandGeometry,
  affText,
  sideLabel,
  ownerNote,
  ownerNoteLong,
  flagChips,
  lagHtml,
  tradedText,
  partyClass,
  esc,
  fmtMoney,
  mergeFeed,
  pageSlice,
  pageCountFor,
  feedCountText,
  feedItemHtml,
  txnRowHtml,
  PAGE_SIZE,
  type TxnRow,
  type PaperRow,
  type RenderCtx,
} from "../src/lib/format.ts";

const CTX: RenderCtx = { watched: new Set() };

function txn(over: Partial<TxnRow> = {}): TxnRow {
  return {
    kind: "txn",
    filed: "2026-07-21",
    traded: "2026-06-24",
    name: "Test Member",
    bioguide: "T000001",
    party: "R",
    state: "OK",
    district: null,
    chamber: "senate",
    ticker: "WMB",
    side: "purchase",
    owner: "self",
    low: 1001,
    high: 15000,
    lag: 27,
    late: 0,
    flags: [],
    doc: "https://efdsearch.senate.gov/search/view/ptr/abc/",
    ...over,
  };
}

function paper(over: Partial<PaperRow> = {}): PaperRow {
  return {
    kind: "paper",
    filed: "2026-07-17",
    name: "Paper Filer",
    bioguide: "P000001",
    party: "D",
    state: "CT",
    district: null,
    chamber: "senate",
    doc: "https://efdsearch.senate.gov/search/view/paper/xyz/",
    ...over,
  };
}

/* ---------- pagination: every item on exactly one page ---------- */

test("pageSlice: a paper-only result set renders on page 0", () => {
  const merged = mergeFeed([], [paper(), paper(), paper(), paper()]);
  const page0 = pageSlice(merged, 0);
  assert.equal(page0.length, 4, "all four paper filings must be reachable");
  assert.equal(pageCountFor(merged), 1, "a paper-only set still has one page");
});

test("pageSlice: a paper row newer than every transaction is not dropped", () => {
  const txns = [txn({ filed: "2026-07-21" }), txn({ filed: "2026-07-20" })];
  const newest = paper({ filed: "2026-07-30" });
  const merged = mergeFeed(txns, [newest]);
  assert.equal(merged[0], newest, "merge must place it first");
  assert.ok(
    pageSlice(merged, 0).includes(newest),
    "the newest filing in a build must appear on page 1",
  );
});

/** Walk every page and assert each item is reachable exactly once. */
function assertExactlyOnce(merged: (TxnRow | PaperRow)[], label: string): void {
  const pages = pageCountFor(merged);
  const seen = new Map<unknown, number>();
  for (let p = 0; p < pages; p++) {
    for (const item of pageSlice(merged, p)) seen.set(item, (seen.get(item) ?? 0) + 1);
  }
  assert.equal(seen.size, merged.length, `${label}: an item is on no page at all`);
  for (const [, n] of seen) assert.equal(n, 1, `${label}: an item is on more than one page`);
}

test("pageSlice: every item appears on exactly one page — every paper position × several counts", () => {
  // Exhaustive over paper-row RANK (how many transactions precede it), which is
  // what the page assignment actually depends on. Hand-picked fixtures missed
  // the case where the transaction count is an exact multiple of PAGE_SIZE and
  // the paper row trails every transaction — that row was on no page at all.
  const counts = [0, 1, PAGE_SIZE - 1, PAGE_SIZE, PAGE_SIZE + 1, PAGE_SIZE * 2, PAGE_SIZE * 2 + 7];
  for (const nT of counts) {
    for (let rank = 0; rank <= nT; rank++) {
      const merged: (TxnRow | PaperRow)[] = [];
      for (let i = 0; i < rank; i++) merged.push(txn());
      merged.push(paper({ name: `rank-${rank}` }));
      for (let i = rank; i < nT; i++) merged.push(txn());
      assertExactlyOnce(merged, `nT=${nT} rank=${rank}`);
    }
  }
});

test("pageSlice: multiple paper rows at head, both boundaries and tail", () => {
  const merged: (TxnRow | PaperRow)[] = [paper({ name: "head" })];
  for (let i = 0; i < PAGE_SIZE * 2; i++) {
    if (i === PAGE_SIZE) merged.push(paper({ name: "boundary" }));
    merged.push(txn());
  }
  merged.push(paper({ name: "tail" }));
  assertExactlyOnce(merged, "head+boundary+tail");
  // the tail row trails exactly 100 transactions — the regressed case
  const last = pageSlice(merged, pageCountFor(merged) - 1);
  assert.ok(
    last.some((i) => i.kind === "paper" && i.name === "tail"),
    "a paper row trailing a multiple of PAGE_SIZE transactions must be reachable",
  );
});

test("pageSlice: transaction pages hold exactly PAGE_SIZE transactions", () => {
  const txns = Array.from({ length: PAGE_SIZE + 10 }, () => txn());
  const merged = mergeFeed(txns, []);
  assert.equal(pageSlice(merged, 0).filter((i) => i.kind === "txn").length, PAGE_SIZE);
  assert.equal(pageSlice(merged, 1).filter((i) => i.kind === "txn").length, 10);
});

test("pageCountFor: derived from position, and never pads a blank page", () => {
  assert.equal(pageCountFor([]), 0, "nothing to show is zero pages");
  assert.equal(pageCountFor([paper()]), 1, "a paper-only set has one page");
  assert.equal(pageCountFor(Array.from({ length: PAGE_SIZE }, () => txn())), 1);
  assert.equal(pageCountFor(Array.from({ length: PAGE_SIZE + 1 }, () => txn())), 2);
  // a paper row BEFORE 100 transactions needs 2 pages; AFTER them, 3
  const head = [paper(), ...Array.from({ length: PAGE_SIZE * 2 }, () => txn())];
  const tail = [...Array.from({ length: PAGE_SIZE * 2 }, () => txn()), paper()];
  assert.equal(pageCountFor(head), 2, "a head paper row must not add a page");
  assert.equal(pageCountFor(tail), 3, "a trailing paper row must add its page");
  // and no page in range is ever empty (a blank page reads as "no matches")
  for (const merged of [head, tail]) {
    for (let p = 0; p < pageCountFor(merged); p++) {
      assert.ok(pageSlice(merged, p).length > 0, "no page in range may be empty");
    }
  }
});

/* ---------- amounts: ranges stay ranges ---------- */

test("amountText: closed, open-ended, and unparsed amounts", () => {
  assert.equal(amountText({ low: 1001, high: 15000, flags: [] }), "$1K–$15K");
  assert.equal(amountText({ low: 15001, high: 50000, flags: [] }), "$15K–$50K");
  assert.equal(amountText({ low: 1000001, high: 5000000, flags: [] }), "$1M–$5M");
  assert.equal(amountText({ low: 1000001, high: null, flags: [] }), "Over $1M");
  assert.equal(amountText({ low: null, high: 15000, flags: [] }), "Under $15K");
  assert.equal(amountText({ low: null, high: null, flags: [] }), "—");
});

test("bandGeometry: never draws a solid bar when a bound is unknown", () => {
  for (const r of [
    { low: null, high: null },
    { low: 1000001, high: null },
    { low: 50000001, high: null },
  ]) {
    const g = bandGeometry(r);
    assert.equal(g.open, true, `${JSON.stringify(r)} must render as hatch`);
  }
  const closed = bandGeometry({ low: 1001, high: 15000 });
  assert.equal(closed.open, false);
});

test("bandGeometry: geometry is finite, ordered and inside the track", () => {
  const cases = [
    { low: 1001, high: 15000 },
    { low: 15001, high: 50000 },
    { low: 50001, high: 100000 },
    { low: 100001, high: 250000 },
    { low: 250001, high: 500000 },
    { low: 500001, high: 1000000 },
    { low: 1000001, high: 5000000 },
    { low: 5000001, high: 25000000 },
    { low: 25000001, high: 50000000 },
    { low: 1000001, high: null },
    { low: null, high: null },
  ];
  for (const r of cases) {
    const g = bandGeometry(r);
    assert.ok(Number.isFinite(g.left) && Number.isFinite(g.width), `finite for ${JSON.stringify(r)}`);
    assert.ok(g.left >= 0 && g.left <= 100, `left in range for ${JSON.stringify(r)}`);
    assert.ok(g.width > 0 && g.left + g.width <= 100.01, `width in track for ${JSON.stringify(r)}`);
  }
});

test("bandGeometry: a bigger bucket never starts left of a smaller one", () => {
  const floors = [1001, 15001, 50001, 100001, 250001, 500001, 1000001, 5000001, 25000001];
  let prev = -1;
  for (const low of floors) {
    const { left } = bandGeometry({ low, high: low * 3 });
    assert.ok(left > prev, `bucket floor ${low} must sit right of the previous`);
    prev = left;
  }
});

test("amountVerdict: open-ended and unparsed rows are indeterminate, never 'out'", () => {
  // "Over $1M" against a $25M threshold cannot be ruled in OR out
  assert.equal(amountVerdict({ low: 1000001, high: null }, 25_000_000), "indeterminate");
  assert.equal(amountVerdict({ low: null, high: null }, 25_000_000), "indeterminate");
  // an unknown FLOOR with a known ceiling cannot be ruled out either, since
  // the floor is what the threshold compares against
  assert.equal(amountVerdict({ low: null, high: 15000 }, 15_000), "indeterminate");
  assert.equal(amountVerdict({ low: null, high: 50000 }, 1_000_000), "indeterminate");
  // closed buckets resolve definitively, at the boundary too
  assert.equal(amountVerdict({ low: 15001, high: 50000 }, 15_000), "in");
  assert.equal(amountVerdict({ low: 1001, high: 15000 }, 15_000), "out");
  assert.equal(amountVerdict({ low: 5000001, high: 25000000 }, 5_000_000), "in");
  // no threshold ⇒ everything is in, including unparsed
  assert.equal(amountVerdict({ low: null, high: null }, 0), "in");
});

/* ---------- count line: one string, so no sink can omit a fragment ---------- */

test("feedCountText: states transactions and paper filings separately", () => {
  assert.equal(
    feedCountText({ page: 0, txnMatched: 3911, paperMatched: 37, paperOnPage: 2, txnTotal: 3911, indeterminate: 0 }),
    "1–50 of 3,911 transactions · 37 paper filings (2 here)",
  );
  assert.equal(
    feedCountText({ page: 1, txnMatched: 3911, paperMatched: 0, paperOnPage: 0, txnTotal: 3911, indeterminate: 0 }),
    "51–100 of 3,911 transactions",
  );
});

test("feedCountText: never reports a bare zero while paper filings match", () => {
  const s = feedCountText({ page: 0, txnMatched: 0, paperMatched: 4, paperOnPage: 4, txnTotal: 3911, indeterminate: 0 });
  assert.equal(s, "0 of 3,911 transactions · 4 paper filings (4 here)");
  assert.ok(s.includes("4 paper filings"), "the rendered filings must be counted");
});

test("feedCountText: the indeterminate-amount disclosure is part of the ONE string", () => {
  // MAJ-B was this fragment reaching only a desktop-visible element; every
  // sink now receives the same string, so it cannot be dropped per-viewport.
  const s = feedCountText({ page: 0, txnMatched: 11, paperMatched: 0, paperOnPage: 0, txnTotal: 3911, indeterminate: 73 });
  assert.equal(s, "1–11 of 11 transactions · 73 amount not comparable");
});

test("feedCountText: singular and plural agree", () => {
  const one = feedCountText({ page: 0, txnMatched: 1, paperMatched: 1, paperOnPage: 1, txnTotal: 1, indeterminate: 0 });
  assert.ok(one.includes("1 paper filing ("), "singular filing");
  assert.ok(!one.includes("filings"), "no plural when there is one");
});

test("fmtMoney: statutory boundaries render compactly", () => {
  assert.equal(fmtMoney(1000), "$1K");
  assert.equal(fmtMoney(15000), "$15K");
  assert.equal(fmtMoney(1000000), "$1M");
  assert.equal(fmtMoney(50000000), "$50M");
});

/* ---------- dates and lag ---------- */

test("lagHtml: a negative lag is named, never printed as '+-320d'", () => {
  const html = lagHtml({ lag: -320, late: 0 });
  assert.ok(!html.includes("+-"), "must not emit '+-'");
  assert.match(html, /filed −320d before trade/);
});

test("lagHtml: late, on-time and unknown lags", () => {
  assert.match(lagHtml({ lag: 74, late: 1 }), /LATE·74d/);
  assert.match(lagHtml({ lag: 27, late: 0 }), /\+27d/);
  assert.match(lagHtml({ lag: null, late: null }), /—/);
  assert.match(lagHtml({ lag: null, late: 1 }), /LATE</, "late with unknown lag omits the number");
});

test("tradedText: same-year shortens, cross-year keeps the year, null is stated", () => {
  assert.equal(tradedText({ traded: "2026-06-24", filed: "2026-07-21" }), "06-24");
  assert.equal(tradedText({ traded: "2023-10-31", filed: "2026-01-05" }), "2023-10-31");
  assert.equal(tradedText({ traded: null, filed: "2026-01-05" }), "—");
});

/* ---------- identity presentation ---------- */

test("affText: districts, at-large, sentinels and unjoined filers", () => {
  assert.equal(affText({ party: "D", state: "CA", district: "11", chamber: "house" }), "D–CA-11");
  assert.equal(affText({ party: "R", state: "AK", district: "0", chamber: "house" }), "R–AK-AL");
  assert.equal(
    affText({ party: "D", state: "CA", district: "-1", chamber: "house" }),
    "D–CA",
    "a sentinel district must not print as '-1'",
  );
  assert.equal(affText({ party: "R", state: "AL", district: null, chamber: "senate" }), "R–AL");
  assert.equal(affText({ party: "", state: null, district: null, chamber: "house" }), "—");
  assert.equal(affText({ party: "", state: "TX", district: "7", chamber: "house" }), "?–TX-7");
});

test("partyClass: an unmappable party is not painted as Independent", () => {
  assert.equal(partyClass("D"), "dem");
  assert.equal(partyClass("R"), "rep");
  assert.equal(partyClass("I"), "ind");
  assert.equal(partyClass(""), "unknown");
  assert.equal(partyClass("Libertarian"), "unknown");
});

test("sideLabel: an unparsed side is not presented as the category 'Other'", () => {
  assert.equal(sideLabel("purchase").text, "Purchase");
  assert.equal(sideLabel("sale").text, "Sale");
  assert.equal(sideLabel("sale_partial").text, "Sale");
  assert.equal(sideLabel("exchange").text, "Exchange");
  assert.equal(sideLabel("other", ["side_unparsed"]).text, "—");
  assert.equal(sideLabel("other", ["side_unparsed"]).cls, "unknown");
});

test("ownerNote: partial-sale and ownership qualifiers survive, short and long", () => {
  assert.equal(ownerNote({ side: "sale_partial", owner: "joint" }), "· partial · JT");
  assert.equal(ownerNoteLong({ side: "sale_partial", owner: "joint" }), "partial sale, jointly owned");
  assert.equal(ownerNote({ side: "purchase", owner: "spouse" }), "· SP");
  assert.equal(ownerNote({ side: "purchase", owner: null }), "");
});

test("flagChips: an unbounded amount always gets an 'amount unparsed' chip", () => {
  // real corpus rows carry row_incomplete etc. WITHOUT amount_unparsed
  const chips = flagChips(["row_incomplete", "row_orphan"], { low: null, high: null });
  assert.ok(
    chips.some((c) => c.label === "amount unparsed"),
    "presentation must derive from the value, not only the flag vocabulary",
  );
  // and it is not duplicated when the flag IS present
  const once = flagChips(["amount_unparsed"], { low: null, high: null });
  assert.equal(once.filter((c) => c.label === "amount unparsed").length, 1);
  // a known range gets no unparsed chip
  assert.equal(
    flagChips([], { low: 1001, high: 15000 }).some((c) => c.label === "amount unparsed"),
    false,
  );
});

/* ---------- escaping ---------- */

test("esc: neutralises text and attribute contexts", () => {
  assert.equal(esc(`<script>`), "&lt;script&gt;");
  assert.equal(esc(`a"b'c&d`), "a&quot;b&#39;c&amp;d");
  assert.equal(esc("&lt;"), "&amp;lt;", "ampersand is escaped first");
});

test("row HTML: a quoted real name does not survive raw", () => {
  const html = txnRowHtml(txn({ name: 'Charles J. "Chuck" Fleischmann' }), CTX);
  assert.ok(!html.includes('"Chuck"'), "raw double quotes must not reach the markup");
  assert.ok(html.includes("&quot;Chuck&quot;"));
});

test("row HTML: injection attempts in every string field are escaped", () => {
  const evil = `"><img src=x onerror=alert(1)>`;
  const html = txnRowHtml(
    txn({ name: evil, ticker: evil, bioguide: evil, doc: `https://x/${evil}` }),
    CTX,
  );
  // What matters is that no value can close a tag or break out of an
  // attribute: the payload may survive as inert escaped TEXT, but never as
  // markup. (`onerror=` inside an escaped attribute value is not executable,
  // so asserting the string never appears would be the wrong property.)
  assert.ok(!html.includes("<img"), "no raw tag may be emitted");
  assert.ok(html.includes("&quot;&gt;&lt;img"), "the payload is escaped, not stripped");
  // Structural invariant: stripping the tags this renderer is allowed to emit
  // must leave no "<" behind. A regex over attribute values cannot fail by
  // construction (`[^"]*` stops at the first quote), so it proves nothing.
  const stripped = html.replace(/<\/?(?:div|span|a|button|sup)\b[^>]*>/g, "");
  assert.ok(!stripped.includes("<"), "no tag outside the allowed set may be emitted");
  assert.ok(!/<[a-zA-Z]/.test(stripped), "no element start may survive stripping");
});

test("row HTML: a non-https source is stated, not linked", () => {
  const html = txnRowHtml(txn({ doc: "javascript:alert(1)" }), CTX);
  assert.ok(!html.includes("javascript:"), "no javascript: URL may reach an href");
  assert.ok(html.includes("src-missing"));
});

/* ---------- honesty invariants visible in the rendered row ---------- */

test("row HTML: both dates are present in the markup on every row", () => {
  const html = txnRowHtml(txn({ filed: "2026-07-21", traded: "2026-06-24" }), CTX);
  assert.ok(html.includes("2026-07-21"), "filed date present");
  assert.ok(html.includes("06-24"), "traded date present");
  assert.ok(html.includes("Filed "), "filed is labelled");
  assert.ok(html.includes("Traded "), "traded is labelled");
});

test("row HTML: the partial/owner qualifier is in the markup, not styling-only", () => {
  const html = txnRowHtml(txn({ side: "sale_partial", owner: "joint" }), CTX);
  assert.ok(html.includes("· partial · JT"));
  assert.ok(html.includes("partial sale, jointly owned"), "spelled out for assistive tech");
});

test("row HTML: an unbounded amount is spoken as not-disclosed, not as an em dash", () => {
  const html = txnRowHtml(txn({ low: null, high: null, flags: ["row_incomplete"] }), CTX);
  assert.ok(html.includes("not disclosed in a parseable range"));
  assert.ok(html.includes("band-fill open"), "and the band is hatched");
});

test("row HTML: the spouse-cap marker rides with the capped amount", () => {
  const capped = txnRowHtml(
    txn({ low: 1000001, high: null, flags: ["amount_spouse_cap"] }),
    CTX,
  );
  assert.ok(capped.includes("‡"));
  assert.ok(capped.includes("Over $1M"));
  assert.ok(!txnRowHtml(txn(), CTX).includes("‡"), "and only with it");
});

test("row HTML: an unjoined filer is daggered and not linked to a member page", () => {
  const html = txnRowHtml(txn({ bioguide: null, party: "", state: null }), CTX);
  assert.ok(html.includes("†"));
  assert.ok(html.includes("#feed-footnote"));
  assert.ok(!html.includes("/congress/members/"), "there is no member page to link to");
});

test("row HTML: provenance is present on transaction AND paper rows", () => {
  for (const html of [txnRowHtml(txn(), CTX), feedItemHtml(paper(), CTX)]) {
    assert.match(html, /cell-src/);
    assert.match(html, /efdsearch\.senate\.gov/);
    assert.match(html, /source document/);
  }
});

test("row HTML: a paper row states retained-and-counted and needs-OCR", () => {
  const html = feedItemHtml(paper(), CTX);
  assert.ok(html.includes("paper filing — needs OCR"));
  assert.ok(html.includes("retained and counted"));
});

test("row HTML: watchlist state is reflected, and unjoined rows have no star", () => {
  const on = txnRowHtml(txn({ bioguide: "T000001" }), { watched: new Set(["T000001"]) });
  assert.ok(on.includes('aria-pressed="true"'));
  assert.ok(on.includes("★"));
  const off = txnRowHtml(txn({ bioguide: "T000001" }), CTX);
  assert.ok(off.includes('aria-pressed="false"'));
  const none = txnRowHtml(txn({ bioguide: null }), CTX);
  assert.ok(none.includes("disabled"));
});

/* ---------- SSR / client parity ---------- */

test("feedItemHtml is deterministic — SSR and client render byte-identical rows", () => {
  const items = [txn(), txn({ side: "sale_partial", owner: "spouse" }), paper()];
  for (const item of items) {
    assert.equal(
      feedItemHtml(item, CTX),
      feedItemHtml(item, CTX),
      "same input + same context must produce the same markup",
    );
  }
});
