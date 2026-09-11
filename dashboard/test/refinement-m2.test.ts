/* Refinement 20260910 — Milestone 2 unit pins (R11–R13 here; later R-ids
   append below as they land). Each test fails if its feature is removed. */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  COMPACT_ROWS,
  COMPACT_STEP,
  DESIGN_FEED_PAGE_SIZE,
  compactBoundCount,
  compactExpandLabel,
  mergeFeed,
  pageSlice,
  type TxnRow,
  type PaperRow,
  type RenderCtx,
} from "../src/lib/format.ts";
import {
  decodeFeedItem,
  decodeFeedPart,
  encodeFeedItem,
  pageSliceFrom,
  partsForPage,
  planFeedParts,
} from "../src/lib/feed-parts.ts";
import { SHARD_RESPONSE_CEILING_BYTES } from "../src/lib/shards.ts";
import { congressRankingSection, CONGRESS_ROOTS } from "../src/lib/ui/index.ts";
import { leadersRollup } from "../src/lib/derive.ts";

const SRC = path.resolve(import.meta.dirname, "..", "src");

function txn(over: Partial<TxnRow> = {}): TxnRow {
  return {
    kind: "txn",
    txnId: "t-1",
    asset: null,
    assetType: null,
    filed: "2026-08-01",
    traded: "2026-07-20",
    name: "A Member",
    bioguide: "A000001",
    party: "R",
    state: "OK",
    district: null,
    chamber: "senate",
    ticker: "WMB",
    side: "purchase",
    owner: "self",
    low: 1001,
    high: 15000,
    lag: 12,
    late: 0,
    flags: [],
    doc: "https://efdsearch.senate.gov/x",
    ...over,
  };
}
function paper(over: Partial<PaperRow> = {}): PaperRow {
  return {
    kind: "paper",
    filed: "2026-08-01",
    name: "P Member",
    bioguide: "P000001",
    party: "D",
    state: "CA",
    district: "12",
    chamber: "house",
    doc: "https://disclosures-clerk.house.gov/p",
    ...over,
  };
}

/* ---------- R11: Congress landing order ---------- */

test("R11: the Congress landing renders Leaders (full width) → Tickers → the feed; cards collapse below the feed", () => {
  const page = readFileSync(path.join(SRC, "pages", "congress", "index.astro"), "utf-8");
  const body = page.slice(page.indexOf("<Base"));
  const leaders = body.indexOf("set:html={membersHtml}");
  const tickers = body.indexOf("set:html={momentumHtml}");
  const feed = body.indexOf('id="feed-section"');
  const notes = body.indexOf('id="congress-notes"');
  assert.ok(leaders > 0 && tickers > leaders && feed > tickers && notes > feed, "order: leaders, tickers, feed, notes");
  assert.match(body.slice(leaders - 80, leaders), /design-rankings-single/, "Leaders take the full width");
  assert.match(body, /<details class="design-supplement" id="congress-notes"><summary>Notes on this data<\/summary>/);
  assert.match(page, /coverage-strip/, "the one-line strip replaces the ledger");
  assert.doesNotMatch(page, /disclosureLedger/, "the four-tile ledger is gone from the landing head");
  assert.match(page, /compact: COMPACT_ROWS,/, "Leaders and Tickers render the compact slice (10)");
  assert.doesNotMatch(page, /compact: 5,/);
});

test("R11/R13: a ranking section shows 10 rows and ships the next 50 hidden for a download-free 'Show 50 more'", () => {
  const rows = Array.from({ length: 80 }, (_, i) =>
    txn({ txnId: `t-${i}`, bioguide: `M${String(i).padStart(6, "0")}`, name: `Member ${i}`, low: 1000 * (i + 1), high: 2000 * (i + 1) }),
  );
  const ctx: RenderCtx = { watched: new Set(), referenceRankings: true };
  const html = congressRankingSection(
    "leaders",
    leadersRollup(rows, "2026-08-23", { range: "12m", basis: "traded" }),
    { buildId: "b", generatedAt: "2026-08-23 00:00 UTC", generatedAtDate: "2026-08-23" },
    ctx,
    { rootId: CONGRESS_ROOTS.membersRanked, undisclosedRootId: CONGRESS_ROOTS.membersUndisclosed, heading: "Leaders", sectionId: "members-section", compact: COMPACT_ROWS },
  );
  const tbody = html.slice(html.indexOf(`<tbody id="${CONGRESS_ROOTS.membersRanked}">`), html.indexOf("</tbody>"));
  const visible = (tbody.match(/<tr(?! hidden)\b/g) ?? []).length;
  const hidden = (tbody.match(/<tr hidden data-compact-hidden/g) ?? []).length;
  assert.equal(visible, COMPACT_ROWS, "ten rows visible");
  assert.equal(hidden, COMPACT_STEP, "fifty more ride hidden in the server bytes");
  assert.match(html, /data-compact-shown="10"/);
  assert.match(html, /70 more ranked members below\./, "the count is plain words");
  assert.match(html, />Show 50 more</, "the control offers the next fifty");
  assert.doesNotMatch(html, /render bound/i, "no pipeline vocabulary");
  assert.equal(compactExpandLabel(24, "tickers"), "Show all 24 tickers");
  assert.equal(compactExpandLabel(200, "tickers"), "Show 50 more");
  assert.doesNotMatch(compactBoundCount(5, "rows"), /render bound|data bound/);
});

/* ---------- R12: feed page size + LD7 parts ---------- */

test("R12: the feed pages 50 rows", () => {
  assert.equal(DESIGN_FEED_PAGE_SIZE, 50);
});

function corpus(): { merged: ReturnType<typeof mergeFeed>; txns: TxnRow[]; papers: PaperRow[] } {
  // Three years, paper rows interleaved, one trailing paper row: 2026 gets
  // 140 txns (spanning three pages), 2025 gets 70, 2024 gets 30.
  const txns: TxnRow[] = [];
  const papers: PaperRow[] = [];
  const years: [number, number][] = [[2026, 140], [2025, 70], [2024, 30]];
  for (const [year, n] of years) {
    for (let i = 0; i < n; i++) {
      const day = String(28 - (i % 28)).padStart(2, "0");
      const month = String(12 - Math.floor(i / 28)).padStart(2, "0");
      txns.push(txn({ txnId: `${year}-${i}`, filed: `${year}-${month}-${day}`, name: `Member ${year}-${i}` }));
      if (i % 25 === 3) papers.push(paper({ filed: `${year}-${month}-${day}`, doc: `https://p/${year}/${i}` }));
    }
  }
  papers.push(paper({ filed: "2024-01-01", doc: "https://p/trailing" }));
  const desc = (a: { filed: string }, b: { filed: string }): number => (a.filed < b.filed ? 1 : a.filed > b.filed ? -1 : 0);
  txns.sort(desc);
  papers.sort(desc);
  return { merged: mergeFeed(txns, papers), txns, papers };
}

test("LD7: an oversized year splits into ≥2 parts, every part ≤ the ceiling, parts stay within one year", () => {
  const { merged } = corpus();
  const ceiling = 8_000; // small, so every year overflows
  const plan = planFeedParts(merged, { build_id: "b", generated_at: "2026-08-23T00:00:00Z" }, { ceilingBytes: ceiling });
  const byYear = new Map<number, number>();
  for (const p of plan.index.parts) byYear.set(p.year, (byYear.get(p.year) ?? 0) + 1);
  assert.ok((byYear.get(2026) ?? 0) >= 2, "2026 needs more than one part");
  for (const p of plan.index.parts) {
    const body = plan.bodies.get(p.part)!;
    assert.ok(Buffer.byteLength(body) <= ceiling, `${p.part} is ${Buffer.byteLength(body)} B`);
    assert.equal(Buffer.byteLength(body), p.bytes, "the index records the measured bytes");
    const decoded = decodeFeedPart(JSON.parse(body))!;
    assert.equal(decoded.items.length, p.rows);
    assert.ok(decoded.items.every((it) => it.filed.startsWith(String(p.year))), "a part never crosses a year");
    assert.match(p.part, new RegExp(`^${p.year}-\\d+$`));
  }
  assert.equal(plan.index.ceiling_bytes, ceiling);
  // the default ceiling is the LD-10 client-response ceiling
  const dflt = planFeedParts(merged, { build_id: "b", generated_at: null });
  assert.equal(dflt.index.ceiling_bytes, SHARD_RESPONSE_CEILING_BYTES);
});

test("LD7: concatenating every part equals the full feed row for row — no duplicates, no omissions", () => {
  const { merged } = corpus();
  const plan = planFeedParts(merged, { build_id: "b", generated_at: null }, { ceilingBytes: 8_000 });
  const all = plan.index.parts.flatMap((p) => decodeFeedPart(JSON.parse(plan.bodies.get(p.part)!))!.items);
  assert.deepEqual(all, merged);
  assert.equal(plan.index.item_total, merged.length);
  assert.equal(plan.index.txn_total, merged.filter((i) => i.kind === "txn").length);
  assert.equal(plan.index.paper_total, merged.filter((i) => i.kind === "paper").length);
  // offsets are consistent
  let off = 0;
  let toff = 0;
  for (const p of plan.index.parts) {
    assert.equal(p.offset, off);
    assert.equal(p.txn_offset, toff);
    off += p.rows;
    toff += p.txn_rows;
  }
});

test("LD7: every page — including one that crosses a part boundary — equals pageSlice over the full feed", () => {
  const { merged } = corpus();
  const plan = planFeedParts(merged, { build_id: "b", generated_at: null }, { ceilingBytes: 8_000 });
  const bodies = new Map([...plan.bodies].map(([k, v]) => [k, decodeFeedPart(JSON.parse(v))!.items]));
  let crossed = 0;
  for (let page = 0; page < plan.index.page_count; page++) {
    const parts = partsForPage(plan.index, page, DESIGN_FEED_PAGE_SIZE);
    assert.ok(parts.length >= 1, `page ${page} maps to at least one part`);
    if (parts.length > 1) crossed++;
    const items = parts.flatMap((p) => bodies.get(p.part)!);
    const got = pageSliceFrom(items, parts[0]!.txn_offset, page, DESIGN_FEED_PAGE_SIZE);
    assert.deepEqual(got, pageSlice(merged, page, DESIGN_FEED_PAGE_SIZE), `page ${page}`);
  }
  assert.ok(crossed > 0, "the fixture exercises a page that spans two parts");
});

test("LD7: the wire encoding round-trips both row kinds and refuses a foreign shape", () => {
  const t = txn({ txnId: "x" });
  const p = paper({ doc: "https://p/x" });
  assert.deepEqual(decodeFeedItem(encodeFeedItem(t)), t);
  assert.deepEqual(decodeFeedItem(encodeFeedItem(p)), p);
  assert.equal(decodeFeedItem(["z", 1]), null);
  assert.equal(decodeFeedItem(["t", 1]), null);
  assert.equal(decodeFeedPart({ dataset_version: 1, rows: [] }), null);
});

test("R12: the full dataset is loaded for a FILTER, never a part — filter results cover the whole corpus", async () => {
  const { makeDom, makeElement } = await import("./lib/fake-dom.ts");
  const { DATASET_VERSION, TXN_COLS, PAPER_COLS, txnToArray } = await import("../src/lib/format.ts");
  const rows = Array.from({ length: 120 }, (_, i) => txn({ txnId: `t-${i}`, ticker: `T${i}X`, late: i % 2 }));
  const plan = planFeedParts(mergeFeed(rows, []), { build_id: "b", generated_at: null });
  const lateChk = makeElement("filter-late");
  const ids = [
    "congress-feed", "feed-tbody", "feed", "feed-loading", "feed-empty", "feed-empty-detail",
    "feed-empty-suggestions", "filter-count-line", "pager-range", "feed-status", "filter-reset",
    "filter-reset-wrap", "pager-newer", "pager-older", "feed-parts-index",
  ];
  const dom = makeDom(ids);
  dom.elements.set("filter-late", lateChk);
  dom.elements.get("congress-feed")!.dataset = { txnCount: String(rows.length) };
  dom.elements.get("feed-parts-index")!.textContent = JSON.stringify(plan.index);
  const full = {
    dataset_version: DATASET_VERSION, build_id: "b", generated_at: null, data_note: "",
    txn_cols: TXN_COLS, paper_cols: PAPER_COLS, txns: rows.map(txnToArray), paper: [],
  };
  const restore = dom.install((url: string) => (url.includes("/feed/") ? JSON.parse(plan.bodies.get("2026-1")!) : full));
  try {
    const { initFeed } = await import("../src/scripts/feed-client.ts");
    initFeed();
    lateChk.checked = true;
    lateChk.listeners.get("change")!.forEach((fn) => fn({}));
    await dom.flush();
    await dom.flush();
    assert.deepEqual(dom.fetchCalls, ["/congress/data/feed.v1.json"], "a filter loads the whole corpus, once");
    assert.match(dom.elements.get("pager-range")!.textContent, /^1–50 of 60 transactions/, "60 late rows over the full corpus");
  } finally {
    restore();
  }
});

/* ======================================================================
   R14 — notable moves, shard, consensus board
   ====================================================================== */

import type { InstData, QoqDeltaRow } from "../src/lib/inst.ts";
import type { ActivityFeed, ActivityRecord } from "../src/lib/activity.ts";
import type { ManagerTyping } from "../src/lib/manager-directory.ts";
import {
  notableMovesBandHtml,
  consensusBoard,
  consensusBoardHtml,
  classifyNotableMovesShard,
  NOTABLE_MOVES_SSR_ROWS,
} from "../src/lib/notable-moves.ts";
import { notableMoves, notableMovesShard, offeredMovePeriods } from "../src/lib/notable-moves-derive.ts";
import { tierCKey } from "../src/lib/format.ts";

function typing(over: Partial<ManagerTyping> & { cik: string }): ManagerTyping {
  return { display_name: `Manager ${over.cik}`, person: null, manager_type: "hedge_fund", notable: true, ...over };
}

function instFixture(over: Partial<Extract<InstData, { present: true }>> = {}): Extract<InstData, { present: true }> {
  return {
    present: true,
    watermarks: { latest_period_of_report: "2026-06-30", latest_filed_date: "2026-07-31" },
    topn: 25,
    filers: [],
    deltasByCik: new Map(),
    concentrationByCik: new Map(),
    holdersByIssuer: new Map(),
    addsByPeriodMode: new Map(),
    addsExclusions: new Map(),
    addsPeriods: ["2025-12-31", "2026-03-31"],
    typingByCik: new Map([
      ["0000000001", typing({ cik: "0000000001", display_name: "Berkshire Hathaway", person: "Warren Buffett", manager_type: "asset_manager" })],
      ["0000000002", typing({ cik: "0000000002", display_name: "Duquesne Family Office", person: "Stanley Druckenmiller", manager_type: "family_office" })],
      ["0000000003", typing({ cik: "0000000003", display_name: "Renaissance", manager_type: "hedge_fund" })],
      ["0000000009", typing({ cik: "0000000009", display_name: "Ordinary Capital", notable: false })],
    ]),
    bookDiscontinuityByCik: new Map(),
    tickerHoldersByTicker: new Map(),
    tickerTotals: new Map(),
    tickerByKey: new Map([[tierCKey("APPLE INC", "COM"), { ticker: "AAPL", verified_date: "2026-09-10", method: "exact-name" }]]),
    ...over,
  };
}

function rec(over: Partial<ActivityRecord> = {}): ActivityRecord {
  return {
    cik: "0000000001",
    filer_name: "BERKSHIRE HATHAWAY INC",
    issuer_key: "cusip6:037833",
    issuer_name: "APPLE INC",
    position_key: "sid:sec:aapl",
    put_call: "LONG",
    ssh_prnamt_type: "SH",
    change_kind: "add",
    curr_period: "2026-03-31",
    prev_period: "2025-12-31",
    prev_value_usd: 1000,
    curr_value_usd: 2000,
    delta_value_usd: 1000,
    prev_shares: 10,
    curr_shares: 20,
    delta_shares: 10,
    filing_keys: [1],
    prior_filing_keys: [],
    current_filing_keys: [],
    flags: [],
    ...over,
  };
}

function feedOf(records: ActivityRecord[]): ActivityFeed {
  return {
    present: true,
    reason: null,
    filings: { "1": { accession: "0000000000-26-000001", submission_type: "13F-HR", period_of_report: "2026-03-31", filed_date: "2026-05-15", doc_url: "https://www.sec.gov/Archives/edgar/data/1/f1.xml", source: "sec-edgar" } },
    pagination: { pages: [], total_records: records.length, emitted_records: records.length, truncation: null } as unknown as ActivityFeed["pagination"],
    records,
  } as unknown as ActivityFeed;
}

const MOVES_RECORDS = [
  rec({ cik: "0000000001", position_key: "sid:sec:aapl", change_kind: "trim", delta_shares: -100, delta_value_usd: -5000 }),
  rec({ cik: "0000000001", position_key: "sid:sec:ko", issuer_name: "COCA COLA CO", issuer_key: "cusip6:191216", change_kind: "held", delta_shares: 0, delta_value_usd: 300 }),
  rec({ cik: "0000000002", position_key: "sid:sec:nvda", issuer_name: "NVIDIA CORP", issuer_key: "cusip6:67066g", change_kind: "new", delta_shares: 50, delta_value_usd: 900 }),
  rec({ cik: "0000000003", position_key: "sid:sec:nvda", issuer_name: "NVIDIA CORP", issuer_key: "cusip6:67066g", change_kind: "new", delta_shares: 5, delta_value_usd: 9000 }),
  rec({ cik: "0000000003", position_key: "sid:sec:aapl", change_kind: "exit", delta_shares: -20, delta_value_usd: -1500 }),
  rec({ cik: "0000000009", position_key: "sid:sec:nvda", issuer_name: "NVIDIA CORP", issuer_key: "cusip6:67066g", change_kind: "new", delta_shares: 5, delta_value_usd: 99999 }),
  rec({ cik: "0000000002", position_key: "sid:sec:gone", issuer_name: "GONE CORP", change_kind: "exit", delta_shares: -1, delta_value_usd: -1, flags: ["book_discontinuity"] }),
  rec({ cik: "0000000001", position_key: "sid:sec:old", issuer_name: "OLD CORP", change_kind: "add", curr_period: "2025-12-31", prev_period: "2025-09-30" }),
  rec({ cik: "0000000001", position_key: "sid:sec:nvda", issuer_name: "NVIDIA CORP", issuer_key: "cusip6:67066g", change_kind: "add", delta_shares: 1, delta_value_usd: null }),
];

test("R14: the band is notable-only, one closed quarter, moves by shares, discontinuity excluded, New › Exit › Add › Trim then |Δ$|", () => {
  const inst = instFixture({
    deltasByCik: new Map([["0000000001", [{ cik: "0000000001", position_key: "sid:sec:aapl", curr_period: "2026-03-31", title_of_class: "COM", issuer_name: "APPLE INC" } as QoqDeltaRow]]]),
  });
  const moves = notableMoves({ feed: feedOf(MOVES_RECORDS), inst, period: "2026-03-31" });
  assert.deepEqual(
    moves.map((m) => [m.cik, m.kind, m.delta_value]),
    [
      ["0000000003", "new", 9000],
      ["0000000002", "new", 900],
      ["0000000003", "exit", -1500],
      ["0000000001", "add", null],
      ["0000000001", "trim", -5000],
    ],
  );
  assert.ok(moves.every((m) => m.cik !== "0000000009"), "a non-notable filer never appears");
  assert.ok(moves.every((m) => m.kind !== ("held" as never)), "held rows are not moves");
  assert.ok(!moves.some((m) => m.issuer === "GONE CORP"), "book_discontinuity rows are excluded");
  assert.ok(!moves.some((m) => m.issuer === "OLD CORP"), "one closed quarter only");
  const aapl = moves.find((m) => m.kind === "trim")!;
  assert.equal(aapl.ticker, "AAPL", "the R3 ticker resolves through the class-grain key");
  assert.equal(aapl.ticker_verified, "2026-09-10");
  assert.equal(aapl.manager, "Berkshire Hathaway");
  assert.equal(aapl.principal, "Warren Buffett");
  assert.equal(aapl.filed, "2026-05-15");
  assert.equal(aapl.doc, "https://www.sec.gov/Archives/edgar/data/1/f1.xml");
  assert.equal(moves.find((m) => m.kind === "new" && m.cik === "0000000002")!.ticker, null, "an unmapped issuer shows no ticker");
});

test("R14/R4: the quarter chips offer only periods with moves; with none, the newest closed quarter stays", () => {
  const counts: Record<string, number> = { "2026-03-31": 10073, "2025-12-31": 0, "2025-09-30": 0 };
  assert.deepEqual(offeredMovePeriods(["2026-03-31", "2025-12-31", "2025-09-30"], (p) => counts[p] ?? 0), ["2026-03-31"]);
  assert.deepEqual(offeredMovePeriods(["2026-03-31", "2025-12-31"], (p) => (p === "2025-12-31" ? 4 : 0)), ["2025-12-31"]);
  assert.deepEqual(offeredMovePeriods(["2026-03-31", "2025-12-31"], () => 0), ["2026-03-31"], "absence is stated for the newest closed quarter");
  assert.deepEqual(offeredMovePeriods([], () => 1), []);
});

test("R14: the shard is ≤ the 1 MiB ceiling, states its truncation, and round-trips", () => {
  const inst = instFixture();
  const moves = notableMoves({ feed: feedOf(MOVES_RECORDS), inst, period: "2026-03-31" });
  const { body, shard } = notableMovesShard("2026-03-31", moves);
  assert.ok(Buffer.byteLength(body) <= SHARD_RESPONSE_CEILING_BYTES);
  assert.equal(shard.truncated, false);
  assert.equal(classifyNotableMovesShard(JSON.parse(body))!.rows.length, moves.length);
  const tight = notableMovesShard("2026-03-31", moves, 700);
  assert.ok(Buffer.byteLength(tight.body) <= 700, `${Buffer.byteLength(tight.body)} B`);
  assert.equal(tight.shard.truncated, true);
  assert.ok(tight.shard.rows.length < moves.length);
  assert.match(tight.body, /"truncated":true/);
  assert.equal(JSON.parse(tight.body).total, moves.length, "the full population is stated");
  assert.equal(classifyNotableMovesShard({ v: 2, period: "x", rows: [] }), null);
});

test("R14: the band renders 15 rows SSR with the period, kind and type chips, a Show 50 more and the JSON link; rows anchor into the filer page", () => {
  const inst = instFixture();
  const many = Array.from({ length: 40 }, (_, i) => rec({ cik: "0000000003", position_key: `sid:sec:${i}`, issuer_name: `ISSUER ${i}`, change_kind: "add", delta_shares: 1, delta_value_usd: 1000 - i }));
  const moves = notableMoves({ feed: feedOf(many), inst, period: "2026-03-31" });
  const html = notableMovesBandHtml(moves, { periods: ["2026-03-31", "2025-12-31"], period: "2026-03-31", filerHref: (cik) => `/institutional/filers/${Number(cik)}/` });
  assert.equal((html.match(/<tr data-mv-kind=/g) ?? []).length, NOTABLE_MOVES_SSR_ROWS);
  assert.match(html, /data-moves-period="2025-12-31" aria-pressed="false"/);
  assert.match(html, /data-moves-period="2026-03-31" aria-pressed="true"/);
  for (const k of ["new", "exit", "add", "trim"]) assert.match(html, new RegExp(`data-moves-kind="${k}"`));
  assert.match(html, /data-moves-type="hedge_fund"/);
  assert.match(html, /data-moves-type="family_office"/);
  assert.match(html, /id="inst-notable-moves-more">Show 50 more</);
  assert.match(html, /href="\/institutional\/data\/notable-moves\/2026-03-31\.v1\.json"/);
  assert.match(html, /href="\/institutional\/filers\/3\/#pos-sid-sec-0"/, "row click lands on the issuer's change row");
  assert.match(html, /Showing 15 of 40 moves/);
  assert.doesNotMatch(html, /render bound/);
});

test("R14: the consensus board counts DISTINCT notable filers per issuer, needs ≥3, ranks new stakes then net $, and feeds the hero tile", () => {
  const inst = instFixture();
  const rows = [
    ...["0000000001", "0000000002", "0000000003"].map((cik) => rec({ cik, position_key: "sid:sec:nvda", issuer_name: "NVIDIA CORP", issuer_key: "cusip6:67066g", change_kind: "new", delta_shares: 1, delta_value_usd: 100 })),
    rec({ cik: "0000000001", position_key: "sid:sec:nvda2", issuer_name: "NVIDIA CORP", issuer_key: "cusip6:67066g", change_kind: "new", delta_shares: 1, delta_value_usd: 100 }), // same filer twice: still ONE
    ...["0000000001", "0000000002"].map((cik) => rec({ cik, position_key: "sid:sec:aapl", change_kind: "add", delta_shares: 1, delta_value_usd: 5000 })),
    ...["0000000001", "0000000002", "0000000003"].map((cik) => rec({ cik, position_key: "sid:sec:msft", issuer_name: "MICROSOFT CORP", issuer_key: "cusip6:594918", change_kind: "trim", delta_shares: -1, delta_value_usd: -10 })),
    rec({ cik: "0000000009", position_key: "sid:sec:aapl", change_kind: "new", delta_shares: 1, delta_value_usd: 1 }),
  ];
  const moves = notableMoves({ feed: feedOf(rows), inst, period: "2026-03-31" });
  const board = consensusBoard("2026-03-31", moves, { minFilers: 3 });
  assert.deepEqual(board.rows.map((r) => [r.issuer, r.newStakes, r.filers]), [["Nvidia Corp", 3, 3], ["Microsoft Corp", 0, 3]]);
  assert.equal(board.qualifying, 2, "APPLE INC has two notable filers (the ordinary one does not count) and does not qualify");
  assert.equal(board.rows[0]!.netDeltaUsd, 400);
  assert.equal(board.rows[0]!.topMover!.kind, "new");
  const html = consensusBoardHtml(board, { filerHref: (cik) => `/f/${cik}` }, );
  assert.match(html, /<th scope="col">Ticker · Issuer<\/th><th scope="col" class="num">New stakes<\/th>/);
  assert.match(html, /Nvidia Corp/);
  assert.doesNotMatch(html, /render bound/);
  // the landing's hero tile is row 1 of this board
  const page = readFileSync(path.join(SRC, "pages", "institutional", "index.astro"), "utf-8");
  assert.match(page, /const consensus = board\?\.rows\[0\] \?\? null;/);
  assert.match(page, /consensusBoard\(analyticsPeriod, moves, \{ minFilers: 3, limit: 50 \}\)/);
  assert.match(page, /DEFAULT_TYPES = new Set<string>\(\["hedge_fund"\]\)/, "Hedge funds selected by default");
  assert.ok(page.indexOf("notableMovesBandHtml(") < page.indexOf('id="inst-managers-section"'), "band before directory");
  assert.ok(page.indexOf('id="inst-managers-section"') < page.indexOf("consensusBoardHtml("), "directory before consensus");
  assert.ok(page.indexOf("consensusBoardHtml(") < page.indexOf("activitySectionHtml("), "recent activity below the fold");
  assert.doesNotMatch(page, /Position discovery/, "the three cards are gone (one methodology footnote remains)");
  assert.match(page, /\/methodology\/#13f-method/);
});

/* ======================================================================
   R15 — filer page
   ====================================================================== */

import { filerBody, changesTableHtml, CHANGES_COMPACT_ROWS } from "../src/lib/ui/institutional.ts";

function qoq(i: number, kind: QoqDeltaRow["change_kind"] = "add"): QoqDeltaRow {
  return {
    cik: "0001067983", position_key: `sid:sec:${i}`, put_call: "LONG", curr_period: "2026-03-31", prev_period: "2025-12-31",
    change_kind: kind, prev_value_usd: 1000, curr_value_usd: 2000 + i, delta_value_usd: 1000 - i, prev_shares: 10, curr_shares: 20, delta_shares: 10,
    ssh_prnamt_type: "SH", flags: [], issuer_name: `ISSUER ${i}`, title_of_class: "COM",
  };
}

test("R15: the filer page reads identity → 4 stats → position changes (20 rows + real show-more) → holdings/book shape → one Planned line", () => {
  const html = filerBody(
    { cik: "0001067983", name: "BERKSHIRE HATHAWAY INC", latestPeriod: "2026-03-31" },
    ["2025-12-31", "2026-03-31"],
    "2026-03-31",
    { cik: "0001067983", period_of_report: "2026-03-31", position_count: 40, total_value_usd: 2_500_000_000, null_value_positions: 0, topn_value_usd: 1, topn_share_bps: 5000, hhi: 900, flags: [] },
    Array.from({ length: 35 }, (_, i) => qoq(i, i % 7 === 0 ? "new" : i % 5 === 0 ? "exit" : "add")),
    "2026-05-15",
    25,
    null,
    { total: 35, kinds: { new: 5, exit: 6 }, typing: typing({ cik: "0001067983", display_name: "Berkshire Hathaway", person: "Warren Buffett", manager_type: "asset_manager" }) },
  );
  const subline = html.slice(html.indexOf('class="entity-subline"'), html.indexOf("</div>", html.indexOf('class="entity-subline"')));
  assert.match(subline, /Warren Buffett/);
  assert.match(subline, /Asset managers/);
  assert.match(subline, /\$2\.5B reported 13\(f\) long value/);
  const labels = [...html.matchAll(/<div class="tile-label">([^<]+)</g)].map((m) => m[1]);
  assert.deepEqual(labels.slice(0, 4), ["reported value", "positions", "new stakes", "exits"]);
  assert.match(html, /<div class="tile-value">5<\/div><div class="tile-label">new stakes/);
  assert.match(html, /<div class="tile-value">6<\/div><div class="tile-label">exits/);
  const changes = html.indexOf('class="panel panel-wide design-changes"');
  const bookShape = html.indexOf('class="panel design-book-shape"');
  assert.ok(changes > 0 && changes < bookShape, "changes before the book shape");
  assert.doesNotMatch(html, /<details class="panel panel-wide design-supplement" aria-label="Position changes"/, "changes are open, not folded");
  const visible = (html.match(/<tr id="pos-[^"]*"><td class="c-pos"/g) ?? []).length;
  const hidden = (html.match(/<tr data-compact-extra id="pos-/g) ?? []).length;
  assert.equal(visible, CHANGES_COMPACT_ROWS);
  assert.equal(hidden, 15);
  assert.match(html, /data-compact-for="filer-changes-tbody" data-compact-total="35" data-compact-shown="20"/);
  assert.doesNotMatch(html, /aria-label="Congress overlap"|aria-label="Signals for this filer"|aria-label="Sector rotation"/, "empty frames are gone");
  assert.equal((html.match(/class="planned-line"/g) ?? []).length, 1);
  assert.match(html, /PLANNED<\/span> sector rotation · Congress overlap · signals for this filer/);
  assert.match(html, /id="filer-notes"/, "the explainer cards are folded, not deleted");
  assert.doesNotMatch(html, /producer-classified \(change_kind\)/);
});

test("R15: changesTableHtml with fewer rows than the compact slice renders no disclosure", () => {
  const html = changesTableHtml([qoq(1), qoq(2)], "2026-03-31", "2026-05-15", { total: 2 });
  assert.doesNotMatch(html, /compact-disclosure/);
  assert.doesNotMatch(html, /data-collapsed/);
});

/* ======================================================================
   R18 — home
   ====================================================================== */

import { HOME_CLAIM, HOME_TILE_ROWS, congressTileHtml, movesTileHtml, signalsTileHtml } from "../src/lib/ui/home.ts";
import type { Signal } from "../src/lib/signals.ts";

test("R18: the masthead claim is twelve words or fewer and the three tiles carry 5 / 5 / 3 rows", () => {
  assert.ok(HOME_CLAIM.split(/\s+/).length <= 12, HOME_CLAIM);
  const ctx: RenderCtx = { watched: new Set() };
  const rows = Array.from({ length: 9 }, (_, i) => txn({ txnId: `t${i}`, name: `Member ${i}` }));
  const congress = congressTileHtml(rows, ctx);
  assert.equal((congress.match(/<tr><td>/g) ?? []).length, HOME_TILE_ROWS.congress);
  assert.match(congress, /Member<\/th><th scope="col">Ticker<\/th><th scope="col">Side<\/th><th scope="col" class="num">Amount<\/th><th scope="col">Filed</);
  assert.match(congress, /class="note-btn"/, "the range caveat is a ⓘ on the first amount");
  const moves = Array.from({ length: 8 }, (_, i) => ({ cik: `${i}`, manager: `M${i}`, principal: null, type: "hedge_fund" as const, issuer: `I${i}`, ticker: null, ticker_verified: null, kind: "new" as const, delta_shares: 1, curr_value: 1, delta_value: 1, filed: "2026-05-15", doc: null, key: `k${i}`, ikey: null }));
  const movesHtml = movesTileHtml(moves, "2026-03-31", (cik) => `/f/${cik}`);
  assert.equal((movesHtml.match(/<tr><td>/g) ?? []).length, HOME_TILE_ROWS.moves);
  const sig = (i: number): Signal => ({ id: `s${i}`, kind: "s1-large", rule: "r", thresholdVersion: "1", entities: { bioguide: "A000001", memberName: "A", ticker: `T${i}` }, magnitude: { low: 1, high: 2 }, receipts: [], occurrence: { tradeDate: null, filedDate: "2026-08-01" }, sourceAvailableAt: "", computedAt: "", firstSeenBuild: "b", lastSeenBuild: "b", status: "active", cohort: "senate" });
  const signals = signalsTileHtml([sig(1), sig(2), sig(3), sig(4)], ctx, () => "LARGE");
  assert.equal((signals.match(/<tr><td>/g) ?? []).length, HOME_TILE_ROWS.signals);
  assert.match(signals, /<tr><td><a class="mono-ticker"/, "ticker first");
  const page = readFileSync(path.join(SRC, "pages", "index.astro"), "utf-8");
  assert.match(page, /\{HOME_CLAIM\}/);
  assert.match(page, /\/methodology\/#principles/, "the philosophy is relocated, not cut");
  assert.doesNotMatch(page, /returned to the people/, "…and its full text left the home page");
  const methodology = readFileSync(path.join(SRC, "pages", "methodology", "index.astro"), "utf-8");
  assert.match(methodology, /id="principles"/);
  assert.match(methodology, /returned to the people/);
});

/* ======================================================================
   R19 / R20 — overlap band and holders route
   ====================================================================== */

import { overlapBand, overlapBandHtml, OVERLAP_TIMELINE_ROWS } from "../src/lib/overlap.ts";
import { tickerHoldersBody } from "../src/lib/ui/institutional.ts";
import { tickerUnifiedBody } from "../src/lib/ui/ticker.ts";
import type { TickerHolderRow } from "../src/lib/inst.ts";

function holder(over: Partial<TickerHolderRow> = {}): TickerHolderRow {
  return { ticker: "NVDA", period_of_report: "2026-03-31", rank: 1, cik: "0000000001", filer_name: "BERKSHIRE HATHAWAY INC", value_usd: 1_000_000, shares: 100, prev_shares: 50, delta_shares: 50, change_kind: "add", method: "exact-name", verified_date: "2026-09-10", filed_date: "2026-05-15", ...over };
}

function overlapInst(): Extract<InstData, { present: true }> {
  return instFixture({
    tickerTotals: new Map([["NVDA", { ticker: "NVDA", period_of_report: "2026-03-31", prev_period: "2025-12-31", issuer_name: "NVIDIA CORP", title_of_class: "COM", holder_count: 4, value_usd: 3_000_000, adds: 2, exits: 1 }]]),
    tickerHoldersByTicker: new Map([[
      "NVDA",
      [
        holder({ rank: 1, cik: "0000000001", change_kind: "add" }),
        holder({ rank: 2, cik: "0000000002", filer_name: "DUQUESNE", change_kind: "new", value_usd: 500_000 }),
        holder({ rank: 3, cik: "0000000003", filer_name: "RENAISSANCE", change_kind: "trim", delta_shares: -10, value_usd: 400_000 }),
        holder({ rank: 4, cik: "0000000009", filer_name: "ORDINARY CAPITAL", change_kind: "new", value_usd: 300_000 }),
        holder({ rank: 1, cik: "0000000001", period_of_report: "2026-06-30", change_kind: "exit" }),
      ],
    ]]),
  });
}

const NOW = "2026-08-23";
function overlapTxns(): TxnRow[] {
  return [
    txn({ txnId: "in-90", filed: "2026-05-25", side: "purchase", name: "Buyer One", bioguide: "B000001", low: 1001, high: 15000 }), // 90 days before NOW: included
    txn({ txnId: "out-91", filed: "2026-05-24", side: "purchase", name: "Buyer Old", bioguide: "B000002" }), // 91 days: excluded
    txn({ txnId: "sell", filed: "2026-08-01", side: "sale", name: "Seller One", bioguide: "S000001", low: 15001, high: 50000 }),
    txn({ txnId: "anomaly", filed: "2026-08-02", side: "purchase", name: "Anomaly", bioguide: "A000009", flags: ["date_anomaly"] }),
    ...Array.from({ length: 25 }, (_, i) => txn({ txnId: `bulk-${i}`, filed: "2026-07-01", side: "purchase", name: `Bulk ${i}`, bioguide: `K${String(i).padStart(6, "0")}` })),
  ];
}

test("R19: the Congress half is exactly the last 90 days by filed date; the 13F half is notable filers in the closed quarter from agg_ticker_holders", () => {
  const ctx: RenderCtx = { watched: new Set() };
  const band = overlapBand({ ticker: "NVDA", txns: overlapTxns(), generatedAtDate: NOW, inst: overlapInst(), typingByCik: overlapInst().typingByCik, period: "2026-03-31", ctx, filerHref: (cik) => `/f/${cik}` });
  assert.equal(band.window.start, "2026-05-25");
  assert.ok(band.buyers.some((m) => m.name === "Buyer One"), "the 90-day-old trade is in");
  assert.ok(!band.buyers.some((m) => m.name === "Buyer Old"), "the 91-day-old trade is out");
  assert.ok(!band.buyers.some((m) => m.name === "Anomaly"), "date anomalies are excluded");
  assert.deepEqual(band.sellers.map((m) => m.name), ["Seller One"]);
  assert.equal(band.sellTotal, "$15K–$50K");
  assert.ok(band.inst, "the ticker is mapped");
  assert.deepEqual(band.inst!.adding.map((m) => m.name), ["Berkshire Hathaway", "Duquesne Family Office"], "notable adders only, by value");
  assert.deepEqual(band.inst!.trimming.map((m) => m.name), ["Renaissance"]);
  assert.ok(!band.inst!.adding.some((m) => m.cik === "0000000009"), "a non-notable holder is excluded");
  assert.ok(!band.timeline.some((r) => r.date === "2026-06-30"), "an open-quarter row is excluded");
  assert.equal(band.timeline.length, OVERLAP_TIMELINE_ROWS, "twenty rows");
  for (let i = 1; i < band.timeline.length; i++) assert.ok(band.timeline[i - 1]!.date >= band.timeline[i]!.date, "ordered newest first");
  const html = overlapBandHtml(band, ctx, (cik) => `/f/${cik}`);
  assert.match(html, /id="overlap"/);
  assert.match(html, /<a href="\/congress\/members\/S000001\/">Seller One<\/a>/, "each name linked");
  assert.match(html, /<span class="mono-note">\+18<\/span>/, "the long buyer list states its remainder");
  assert.match(html, /<a href="\/f\/0000000001">Berkshire Hathaway<\/a>/);
  assert.doesNotMatch(html, /PLANNED/);
});

test("R19: an unmapped ticker ships the Congress half and a Planned badge on the 13F half", () => {
  const ctx: RenderCtx = { watched: new Set() };
  const band = overlapBand({ ticker: "ZZZZ", txns: overlapTxns(), generatedAtDate: NOW, inst: overlapInst(), typingByCik: overlapInst().typingByCik, period: "2026-03-31", ctx, filerHref: (cik) => `/f/${cik}` });
  assert.equal(band.inst, null);
  assert.ok(band.buyers.length > 0);
  const html = overlapBandHtml(band, ctx, () => "/");
  assert.match(html, /overlap-planned/);
  assert.match(html, /badge-planned">PLANNED/);
  assert.match(html, /Seller One/);
});

test("R19/R20: the band renders on BOTH routes — the unified ticker page (via deps) and the reviewed-ticker holders page", () => {
  const ctx: RenderCtx = { watched: new Set() };
  const inst = overlapInst();
  const band = overlapBand({ ticker: "NVDA", txns: overlapTxns(), generatedAtDate: NOW, inst, typingByCik: inst.typingByCik, period: "2026-03-31", ctx, filerHref: (cik) => `/f/${cik}` });
  const overlapHtml = overlapBandHtml(band, ctx, (cik) => `/f/${cik}`);
  const ticker = tickerUnifiedBody(
    { ticker: "NVDA", txns: overlapTxns(), paper: [] } as never,
    { state: "data", name: "NVIDIA CORP", period: "2026-03-31", latestFiled: null, topn: 4, holders: [] },
    { buildId: "b", generatedAt: "2026-08-23 00:00 UTC", generatedAtDate: NOW },
    ctx,
    { fullTable: false },
    { signals: [], withheld: [], crowding: null, committees: null, overlap: overlapHtml },
  );
  assert.match(ticker, /id="overlap"/);
  assert.ok(ticker.indexOf('id="congress"') < ticker.indexOf('id="overlap"') && ticker.indexOf('id="overlap"') < ticker.indexOf('id="institutional"'), "between the Congress rows and the holders");
  const holders = tickerHoldersBody({
    ticker: "NVDA",
    totals: inst.tickerTotals.get("NVDA")!,
    holders: inst.tickerHoldersByTicker.get("NVDA")!.filter((h) => h.period_of_report === "2026-03-31"),
    tierOf: () => "top",
    latestFiled: "2026-07-31",
    overlapHtml,
    congress: { members: 27, href: "/congress/tickers/NVDA/" },
    window: null,
  });
  assert.match(holders, /id="overlap"/);
  const labels = [...holders.matchAll(/<div class="tile-label">([^<]+)</g)].map((m) => m[1]);
  assert.deepEqual(labels, ["holders", "combined value", "adds", "exits"]);
  assert.match(holders, /<div class="tile-value">4<\/div>/);
  assert.match(holders, /\$3\.0M/);
  assert.equal((holders.match(/<tr><td class="c-rank">/g) ?? []).length, 4, "holders ranked");
  assert.match(holders, /27 members disclosed NVDA/);
  assert.match(holders, /verified against the SEC company list on 2026-09-10/);
  assert.match(holders, /qoq-chip qoq-trim/);
});

test("R20: tickerInstSection resolves a reviewed ticker to the `data` state from the class-grain tables, with no entity gate", async () => {
  const { tickerInstSection } = await import("../src/lib/data.ts");
  const inst = overlapInst();
  const build = { inst, tickerMap: null, tickers: [] } as never;
  const section = tickerInstSection(build, "NVDA");
  assert.equal(section.state, "data");
  assert.equal(section.name, "NVIDIA CORP");
  assert.equal(section.period, "2026-03-31");
  assert.deepEqual(section.mapped, { issuer: "NVIDIA CORP", titleOfClass: "COM", holderCount: 4 });
  assert.equal(section.holders!.length, 4, "the closed quarter's holders, not the open one's");
  assert.equal(tickerInstSection(build, "ZZZZ").state, "no-map");
});
