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
  intOrNull,
  jsonArrayOf,
  latestFiling,
  reportingLagDays,
  utcDayNumber,
  affText,
  sideLabel,
  ownerNote,
  ownerNoteLong,
  flagChips,
  lagHtml,
  tradedText,
  partyClass,
  esc,
  fmtInt,
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

/** Assert the pagination invariants from docs/pagination-and-counts.md over one
    merged feed: I1 exactly-once, I2 no empty page in range, I3 order preserved,
    and I5 no count fragment that inverts. */
function assertPageInvariants(merged: (TxnRow | PaperRow)[], label: string): void {
  const pages = pageCountFor(merged);
  const seen = new Map<unknown, number>();
  const concatenated: (TxnRow | PaperRow)[] = [];
  const txnTotal = merged.filter((i) => i.kind === "txn").length;
  const paperTotal = merged.length - txnTotal;

  for (let p = 0; p < pages; p++) {
    const items = pageSlice(merged, p);
    // I2 — an empty page in range renders as "no disclosures match", which
    // would be a false statement about the filter.
    assert.ok(items.length > 0, `${label}: page ${p} of ${pages} is empty`);
    for (const item of items) {
      seen.set(item, (seen.get(item) ?? 0) + 1);
      concatenated.push(item);
    }
    // I5 — the count text for this page must never invert its range.
    const text = feedCountText({
      page: p,
      txnMatched: txnTotal,
      paperMatched: paperTotal,
      txnOnPage: items.filter((i) => i.kind === "txn").length,
      paperOnPage: items.filter((i) => i.kind === "paper").length,
      txnTotal,
      indeterminate: 0,
    });
    const range = /^(\d[\d,]*)–(\d[\d,]*) of/.exec(text);
    if (range) {
      const lo = Number(range[1]!.replaceAll(",", ""));
      const hi = Number(range[2]!.replaceAll(",", ""));
      assert.ok(lo <= hi, `${label}: page ${p} rendered an inverted range "${text}"`);
    }
  }

  // I1 — exactly once.
  assert.equal(seen.size, merged.length, `${label}: an item is on no page at all`);
  for (const [, n] of seen) assert.equal(n, 1, `${label}: an item is on more than one page`);
  // I3 — pages concatenate to the merged feed, in order.
  assert.deepEqual(concatenated, merged, `${label}: pagination changed the feed order`);
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
      assertPageInvariants(merged, `nT=${nT} rank=${rank}`);
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
  assertPageInvariants(merged, "head+boundary+tail");
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
    feedCountText({ page: 0, txnMatched: 3911, paperMatched: 37, txnOnPage: 50, paperOnPage: 2, txnTotal: 3911, indeterminate: 0 }),
    "1–50 of 3,911 transactions · 37 paper filings (2 here)",
  );
  assert.equal(
    feedCountText({ page: 1, txnMatched: 3911, paperMatched: 0, txnOnPage: 50, paperOnPage: 0, txnTotal: 3911, indeterminate: 0 }),
    "51–100 of 3,911 transactions",
  );
});

test("feedCountText: never reports a bare zero while paper filings match", () => {
  const s = feedCountText({ page: 0, txnMatched: 0, paperMatched: 4, txnOnPage: 0, paperOnPage: 4, txnTotal: 3911, indeterminate: 0 });
  assert.equal(s, "0 of 3,911 transactions · 4 paper filings (4 here)");
  assert.ok(s.includes("4 paper filings"), "the rendered filings must be counted");
});

test("feedCountText: the indeterminate-amount disclosure is part of the ONE string", () => {
  // This fragment once reached only a desktop-visible element; every sink now
  // receives the same string, so it cannot be dropped per-viewport (I6).
  const s = feedCountText({ page: 0, txnMatched: 11, paperMatched: 0, txnOnPage: 11, paperOnPage: 0, txnTotal: 3911, indeterminate: 73 });
  assert.equal(s, "1–11 of 11 transactions · 73 amount not comparable");
});

test("feedCountText: no page ever renders an inverted transaction range", () => {
  // I5: a page can legitimately hold only trailing paper filings. Describing it
  // with page × PAGE_SIZE arithmetic produced "51–50 of 50 transactions".
  for (const txnMatched of [PAGE_SIZE, PAGE_SIZE * 2, PAGE_SIZE * 3]) {
    const page = txnMatched / PAGE_SIZE; // the page past the last transaction
    const s = feedCountText({
      page, txnMatched, paperMatched: 1, txnOnPage: 0, paperOnPage: 1,
      txnTotal: txnMatched, indeterminate: 0,
    });
    assert.ok(!/^\d[\d,]*–/.test(s), `must not print a range for a paper-only page: "${s}"`);
    assert.equal(s, `no transactions on this page of ${fmtInt(txnMatched)} · 1 paper filing (1 here)`);
  }
});

test("feedCountText: the range reflects what the page holds, not the page index", () => {
  // a short final page must not claim a full PAGE_SIZE span
  assert.equal(
    feedCountText({ page: 2, txnMatched: 107, paperMatched: 0, txnOnPage: 7, paperOnPage: 0, txnTotal: 107, indeterminate: 0 }),
    "101–107 of 107 transactions",
  );
});

test("feedCountText: singular and plural agree", () => {
  const one = feedCountText({ page: 0, txnMatched: 1, paperMatched: 1, txnOnPage: 1, paperOnPage: 1, txnTotal: 1, indeterminate: 0 });
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

/* ---------- RUN P3-2: the seven canonical components (R1) ---------- */

test("rangeBand + dualDate: the feed row is COMPOSED of the canonical components", async () => {
  const { rangeBand, dualDate } = await import("../src/lib/format.ts");
  const r = txn({ low: 1001, high: 15000, traded: "2026-06-24", filed: "2026-07-21", lag: 27 });
  const row = txnRowHtml(r, CTX);
  assert.ok(row.includes(rangeBand(r)), "the row's band is byte-identically the component");
  assert.ok(row.includes(dualDate(r)), "the row's date cell is byte-identically the component");
  const open = rangeBand(txn({ low: 1_000_001, high: null }));
  assert.ok(open.includes("open"), "open cap hatches");
});

test("flagTags: registry chips + FAIL-VISIBLE unknown flags as raw dashed tags", async () => {
  const { flagTags } = await import("../src/lib/format.ts");
  const known = flagTags(["amount_spouse_cap"]);
  assert.ok(known.includes("spouse cap"));
  const unknown = flagTags(["a_flag_from_the_future"]);
  assert.ok(unknown.includes("a_flag_from_the_future"), "unknown flags never silently vanish");
  assert.ok(unknown.includes("flag-raw"));
  assert.ok(unknown.includes("dashed"));
  const inst = flagTags(["shares_unit_mismatch", "value_undisclosed_one_side"]);
  assert.ok(inst.includes("unit mismatch"));
  assert.ok(inst.includes("value undisclosed one side"));
});

test("terminusRow: names its author — the source or Populus, never a bare more", async () => {
  const { terminusRow } = await import("../src/lib/format.ts");
  const src = terminusRow({ author: "source", html: "only 25 published" });
  assert.ok(src.includes("Truncated by the source."));
  const us = terminusRow({ author: "populus", html: "budget cut" });
  assert.ok(us.includes("Truncated by Populus."));
  assert.ok(us.includes('data-terminus-author="populus"'));
});

test("footnoteBlock: inline (feed) and stacked layouts; marks render", async () => {
  const { footnoteBlock } = await import("../src/lib/format.ts");
  const inline = footnoteBlock(
    [
      { mark: "†", html: "one" },
      { mark: "‡", html: "two" },
    ],
    { id: "feed-footnote", layout: "inline" },
  );
  assert.ok(inline.includes('id="feed-footnote"'));
  assert.ok(inline.includes("†"));
  assert.ok(inline.includes("&nbsp;&nbsp;"));
  const stacked = footnoteBlock([{ mark: "§", html: "derived" }]);
  assert.ok(stacked.includes("footnotes-stacked"));
  assert.ok(stacked.includes("footnote-line"));
  assert.equal(footnoteBlock([]), "", "no entries, no block");
});

test("statTiles: value/unit/label/title with a screen-reader copy of the breakdown", async () => {
  const { statTiles } = await import("../src/lib/format.ts");
  const html = statTiles(
    [{ value: "97.5", unit: "%", label: "House parse", title: "full breakdown", muted: false }],
    { label: "Data coverage" },
  );
  assert.ok(html.includes('aria-label="Data coverage"'));
  assert.ok(html.includes("97.5"));
  assert.ok(html.includes('<span class="unit">%</span>'));
  assert.ok(html.includes('title="full breakdown"'));
  assert.ok(html.includes('visually-hidden">full breakdown'), "tooltip is never the only channel");
});

test("srcLink is the exported canonical G7 renderer; srcLinkDerived carries derived ·§", async () => {
  const { srcLink, srcLinkDerived } = await import("../src/lib/format.ts");
  const linked = srcLink("https://efdsearch.senate.gov/x/");
  assert.ok(linked.includes("eFD"));
  const unlinked = srcLink("http://insecure.example/");
  assert.ok(unlinked.includes("src-missing"), "non-https stays unlinked");
  const derived = srcLinkDerived("#f", "https://www.sec.gov/cgi-bin/browse-edgar?x=1");
  assert.ok(derived.includes("derived&nbsp;·§"));
  assert.ok(derived.includes("EDGAR"));
  const noEdgar = srcLinkDerived("#f", null);
  assert.ok(noEdgar.includes("derived&nbsp;·§"));
  assert.ok(!noEdgar.includes("EDGAR"));
});

test("fmtUsd: K/M/B/T scales, negatives use the minus sign, sub-$1K exact", async () => {
  const { fmtUsd } = await import("../src/lib/format.ts");
  assert.equal(fmtUsd(950), "$950");
  assert.equal(fmtUsd(1500), "$1.5K");
  assert.equal(fmtUsd(2_300_000), "$2.3M");
  assert.equal(fmtUsd(75_100_000_000), "$75.1B");
  assert.equal(fmtUsd(1_420_000_000_000), "$1.4T");
  assert.equal(fmtUsd(-117_400_000), "−$117M");
  assert.equal(fmtUsd(0), "$0");
});

test("tickerHref targets the unified page; cut entities route to /e/ (Locked #4/#13)", async () => {
  const { tickerHref, congressTickerHref, memberHrefFor, tickerHrefFor } = await import(
    "../src/lib/format.ts"
  );
  assert.equal(tickerHref("NVDA"), "/tickers/NVDA/");
  assert.equal(congressTickerHref("NVDA"), "/congress/tickers/NVDA/");
  const ctx = { watched: new Set<string>(), cutMembers: new Set(["Z000009"]), cutTickers: new Set(["OUST"]) };
  assert.equal(memberHrefFor("T000001", ctx), "/congress/members/T000001/");
  assert.equal(memberHrefFor("Z000009", ctx), "/e/?k=m:Z000009");
  assert.equal(tickerHrefFor("NVDA", ctx), "/tickers/NVDA/");
  assert.equal(tickerHrefFor("OUST", ctx), "/e/?k=t:OUST");
  const row = txnRowHtml(txn({ ticker: "OUST" }), ctx);
  assert.ok(row.includes("/e/?k=t:OUST"), "listing surfaces link cut entities to /e/");
});

test("watchStarHtml: v2-store wiring attributes and storage-locality copy", async () => {
  const { watchStarHtml } = await import("../src/lib/format.ts");
  const off = watchStarHtml("ticker", "NVDA", "NVDA", false);
  assert.ok(off.includes('data-watch-kind="ticker"'));
  assert.ok(off.includes('data-watch-key="NVDA"'));
  assert.ok(off.includes('aria-pressed="false"'));
  assert.ok(off.includes("saved in this browser only"));
  const on = watchStarHtml("member", "P000001", "Name", true);
  assert.ok(on.includes("watching · saved on this device"));
  assert.ok(on.includes("★"));
});

test("R1: each canonical component has exactly ONE implementation site", async () => {
  const { readFileSync, readdirSync, statSync } = await import("node:fs");
  const path = await import("node:path");
  const root = path.resolve(import.meta.dirname, "..", "src");
  const files: string[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const p = path.join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (name.endsWith(".ts") || name.endsWith(".astro")) files.push(p);
    }
  };
  walk(root);
  for (const name of [
    "function rangeBand",
    "function dualDate",
    "function terminusRow",
    "function flagTags",
    "function footnoteBlock",
    "function srcLink",
    "function statTiles",
  ]) {
    const definers = files.filter((f) => readFileSync(f, "utf-8").includes(`export ${name}(`));
    assert.deepEqual(
      definers.map((f) => path.relative(root, f)),
      ["lib/format.ts"],
      `${name} must exist exactly once, in format.ts`,
    );
  }
});

/* ---------- institutional shared primitives (QA M2-8 M7) ----------

   Three agents wrote holdings.ts and activity.ts in parallel and produced six
   duplicated helper pairs, two of which contradicted each other under comments
   claiming the same rule. These pin the ONE definition each now has. */

test("intOrNull: an empty cell is ABSENT, not zero", () => {
  // `Number("") === 0` and 0 is finite, so BOTH previous copies reported a
  // fabricated 0 for an empty string — in modules whose headers forbid exactly
  // that. Mutation guard: deleting the empty-string branch fails here.
  assert.equal(intOrNull(""), null);
  assert.equal(intOrNull("   "), null);
  assert.equal(intOrNull(null), null);
  assert.equal(intOrNull(undefined), null);
  // and an unreadable value is NULL, never NaN reaching fmtUsd as "$NaN"
  assert.equal(intOrNull("not a number"), null);
  assert.equal(intOrNull(NaN), null);
  assert.equal(intOrNull(Infinity), null);
  // real values survive, including a legitimate zero
  assert.equal(intOrNull(0), 0);
  assert.equal(intOrNull("0"), 0);
  assert.equal(intOrNull("1234"), 1234);
  assert.equal(intOrNull(-5), -5);
});

test("jsonArrayOf: a JSON array column, and nothing guessed", () => {
  assert.deepEqual(jsonArrayOf("[1,2,3]"), [1, 2, 3]);
  assert.deepEqual(jsonArrayOf([1, 2]), [1, 2]);
  assert.deepEqual(jsonArrayOf(null), []);
  assert.deepEqual(jsonArrayOf(""), []);
  assert.deepEqual(jsonArrayOf("{}"), []);
  assert.deepEqual(jsonArrayOf("[malformed"), []);
  // The two previous copies had INVERSE asymmetries here: one treated a bare
  // scalar as a one-element list, the other refused it. `filing_keys` is a
  // canonical JSON array by producer contract, so a scalar is a shape defect.
  assert.deepEqual(jsonArrayOf("7"), []);
});

test("utcDayNumber is anchored to the WHOLE string, not a prefix", () => {
  // The two copies anchored differently (`/^\d{4}-\d{2}-\d{2}/` vs `$`), so a
  // timestamp parsed on one surface and was NULL on the next.
  assert.equal(utcDayNumber("2026-03-31"), Date.UTC(2026, 2, 31) / 86_400_000);
  assert.equal(utcDayNumber("2026-03-31T00:00:00Z"), null);
  assert.equal(utcDayNumber("2026-3-1"), null);
  assert.equal(utcDayNumber(null), null);
});

test("reportingLagDays: NULL in, NULL out — never a zero standing in for unknown", () => {
  assert.equal(reportingLagDays("2026-03-31", "2026-05-15"), 45);
  assert.equal(reportingLagDays("2026-03-31", null), null);
  assert.equal(reportingLagDays(null, "2026-05-15"), null);
  assert.equal(reportingLagDays("2026-03-31", "garbage"), null);
  // a filing on the period end is a real 0-day lag, distinct from unknown
  assert.equal(reportingLagDays("2026-03-31", "2026-03-31"), 0);
});

test("latestFiling: max filed_date, ties to the LARGER accession", () => {
  // ONE tie-break. The two copies ran in OPPOSITE directions under comments
  // claiming the same rule; largest-wins matches views.sql's restatement-
  // survivor predicate (`r.accession > f.accession`).
  const refs = [
    { filed_date: "2026-05-10", accession: "A-1" },
    { filed_date: "2026-05-20", accession: "A-2" },
    { filed_date: "2026-05-20", accession: "A-0" },
  ];
  assert.equal(latestFiling(refs)!.accession, "A-2");
  assert.equal(latestFiling([...refs].reverse())!.accession, "A-2", "order-dependent");
  assert.equal(latestFiling([]), null);
  // a ref with no usable filed_date cannot be "latest"
  assert.equal(latestFiling([{ filed_date: "", accession: "Z-9" }]), null);
});
