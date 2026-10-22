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
  PAGE_SIZE,
  compactBoundCount,
  compactExpandLabel,
  mergeFeed,
  pageCountFor,
  pageSlice,
  type TxnRow,
  type PaperRow,
  type RenderCtx,
} from "../src/lib/format.ts";
import {
  decodeFeedItem,
  decodeFeedPart,
  encodeFeedItem,
  feedPageCount,
  pageSliceFrom,
  partsForPage,
  planFeedParts,
} from "../src/lib/feed-parts.ts";
import { SHARD_RESPONSE_CEILING_BYTES } from "../src/lib/shards.ts";
import { congressRankingSection, CONGRESS_ROOTS } from "../src/lib/ui/index.ts";
import { leadersRollup } from "../src/lib/derive.ts";
import { MiniElement } from "./lib/mini-dom.ts";
import { figuresOf, ledgerFigures } from "./lib/ledger-dom.ts";

/* DESIGN-POLISH M1 (T1.9): tiles and tables are read by DOM parse. A tile label
   is now its note's LABEL trigger (the text is the button) and a row carries
   its ledger roles and edge, so string-shape regexes over `<div
   class="tile-label">text<` or `<tr><td>` no longer describe the markup. The
   properties are unchanged: the labels, in order; the row counts. */
function domOf(html: string): MiniElement {
  const root = new MiniElement("body");
  root.innerHTML = html;
  return root;
}
function visibleText(el: MiniElement): string {
  return el.nodes.map((n) => (typeof n === "string" ? n : n.classList.contains("note-pop") ? "" : visibleText(n))).join("");
}
function bodyRows(html: string): MiniElement[] {
  return domOf(html).querySelectorAll("tbody tr");
}

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
    exchangedTicker: null,
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

/* ---------- R11 → D1/D2: Congress landing composition ---------- */

/* R11 rewritten in DESIGN-POLISH M2 (T2.2 / T2.10; records L10 and D1/D2 in
   the plan's Decision log). The property R11 guarded is kept — the landing
   leads with its data (the rankings) before the feed, and the context cards
   are folded out of the reader's way, never deleted. The mechanism changed:
   Leaders and Tickers are PAIRED in one `.design-rankings` band (Leaders
   first) instead of stacked full width, and the cards collapse as ONE "Notes
   on this data" line directly after the provenance strip instead of below the
   feed. Read from the parsed template (the page's own element order), not
   from string offsets. */
/* REVERSED IN PART by launch M3b (R19, R21, R22; the approved Congress board).
   The property kept: the landing leads with its data — the Members and Tickers
   boards paired in ONE band, Members first — before the feed. What changed:
   the "Notes on this data" drawer and its briefing cards are retired (their
   facts live in the ledger, the feed and the provenance line), so the band
   sits directly after the provenance strip; and Monthly flow closes the page,
   after the feed. */
function congressCompositionProblems(main: MiniElement): string[] {
  const out: string[] = [];
  const kids = main.children.filter((c) => c.tagName !== "script");
  const at = (pred: (c: MiniElement) => boolean): number => kids.findIndex(pred);
  const head = at((c) => c.classList.contains("page-head"));
  const prov = at((c) => c.classList.contains("design-provenance"));
  const band = at((c) => c.id === "congress-leaders-band");
  const feed = at((c) => c.id === "feed-section");
  const flow = at((c) => c.tagName === "fragment" && c.getAttribute("set:html") === "{monthlyFlowHtml}");
  if ([head, prov, band, feed, flow].some((i) => i < 0)) return ["a landing part is missing"];
  if (!(head < prov)) out.push("the provenance strip follows the head");
  if (band !== prov + 1) out.push("the boards band sits directly after the provenance strip");
  if (!(feed > band)) out.push("the rankings band precedes the feed");
  if (flow !== kids.length - 1 || !(flow > feed)) out.push("Monthly flow closes the page, after the feed");
  if (at((c) => c.id === "congress-notes") >= 0) out.push("the retired notes drawer is gone");
  const cells = kids[band]!.children;
  if (!kids[band]!.classList.contains("design-rankings")) out.push("the rankings are one .design-rankings band");
  /* DESIGN-POLISH M2 (CD-1): the Leaders cell is marked the band's primary
     (`markPairPrimary`); the fragments and their order are unchanged. */
  const html = cells.map((c) => c.getAttribute("set:html"));
  if (JSON.stringify(html) !== JSON.stringify(["{markPairPrimary(membersHtml)}", "{momentumHtml}"])) {
    out.push(`the band pairs Leaders then Tickers (got ${JSON.stringify(html)})`);
  }
  return out;
}
function congressMain(page: string): MiniElement {
  const main = page.slice(page.indexOf("<main"), page.indexOf("</main>") + "</main>".length);
  let text = main;
  for (let prev = ""; prev !== text; ) { prev = text; text = text.replace(/<!--[\s\S]*?-->/g, ""); }
  return domOf(text).querySelector("main")!;
}

test("R11 → D1/D2 (L10) → launch M3b: the Congress landing pairs Members │ Tickers in ONE band, Members first, right after the provenance strip; the feed follows; Monthly flow closes the page", () => {
  const page = readFileSync(path.join(SRC, "pages", "congress", "index.astro"), "utf-8");
  assert.deepEqual(congressCompositionProblems(congressMain(page)), []);
  // the two fragments are the Leaders and Tickers sections, by kind
  assert.match(page, /const membersHtml = congressRankingSection\(\s*"leaders",/);
  assert.match(page, /const momentumHtml = congressRankingSection\(\s*"tickers",/);
  // launch M3b (R22): the briefing cards and their notes drawer are retired
  assert.doesNotMatch(page, /briefingCards|briefingHtml|id="congress-notes"/);
  // the four-figure ledger replaced the one-line strip, in the page head
  assert.ok(congressMain(page).querySelector(".page-head")!.querySelectorAll("fragment").some((f) => f.getAttribute("set:html") === "{ledgerHtml}"));
  assert.doesNotMatch(page, /coverage-strip|design-rankings-single/, "no strip, no single-cell rankings band");
  assert.match(page, /compact: COMPACT_ROWS,/, "Leaders and Tickers render the compact slice (10)");
  assert.doesNotMatch(page, /compact: 5,/);

  // controls: each broken composition is caught by the same predicate
  const swap = page.replace("<Fragment set:html={markPairPrimary(membersHtml)} /><Fragment set:html={momentumHtml} />", "<Fragment set:html={momentumHtml} /><Fragment set:html={markPairPrimary(membersHtml)} />");
  assert.notEqual(swap, page, "control fixture applies");
  assert.ok(congressCompositionProblems(congressMain(swap)).some((p) => /Leaders then Tickers/.test(p)), "control: Tickers first fails");
  const stacked = page.replace(
    '<div class="design-rankings" id="congress-leaders-band"><Fragment set:html={markPairPrimary(membersHtml)} /><Fragment set:html={momentumHtml} /></div>',
    '<div class="design-rankings" id="congress-leaders-band"><Fragment set:html={markPairPrimary(membersHtml)} /></div><div class="design-rankings"><Fragment set:html={momentumHtml} /></div>',
  );
  assert.notEqual(stacked, page, "control fixture applies");
  assert.ok(congressCompositionProblems(congressMain(stacked)).length > 0, "control: stacked (unpaired) rankings fail");
  const flowFirst = page
    .replace("<Fragment set:html={monthlyFlowHtml} />", "")
    .replace('<div class="design-rankings" id="congress-leaders-band">', '<Fragment set:html={monthlyFlowHtml} /><div class="design-rankings" id="congress-leaders-band">');
  assert.notEqual(flowFirst, page, "control fixture applies");
  assert.ok(congressCompositionProblems(congressMain(flowFirst)).some((p) => /closes the page|directly after the provenance/.test(p)), "control: Monthly flow before the boards fails");
});

/* launch F2 (R35, LD26/LD31): the property is unchanged — the next fifty
   ride in the page for a download-free "Show 50 more" — and the mechanism
   moved: they are island data (rule 8), drawn by the board's pager through
   the binder, not hidden rows in the DOM. */
test("R11/R13: a ranking section shows 10 rows and ships the next 50 in the page for a download-free 'Show 50 more'", () => {
  const rows = Array.from({ length: 80 }, (_, i) =>
    txn({ txnId: `t-${i}`, bioguide: `M${String(i).padStart(6, "0")}`, name: `Member ${i}`, low: 1000 * (i + 1), high: 2000 * (i + 1) }),
  );
  const ctx: RenderCtx = { referenceRankings: true };
  const html = congressRankingSection(
    "leaders",
    leadersRollup(rows, "2026-08-23", { range: "12m", basis: "traded" }),
    { buildId: "b", generatedAt: "2026-08-23 00:00 UTC", generatedAtDate: "2026-08-23" },
    ctx,
    { rootId: CONGRESS_ROOTS.membersRanked, undisclosedRootId: CONGRESS_ROOTS.membersUndisclosed, heading: "Leaders", sectionId: "members-section", compact: COMPACT_ROWS },
  );
  const tbody = html.slice(html.indexOf(`<tbody id="${CONGRESS_ROOTS.membersRanked}" role="rowgroup">`), html.indexOf("</tbody>"));
  const visible = (tbody.match(/<tr(?! hidden)\b/g) ?? []).length;
  const hidden = (tbody.match(/<tr hidden/g) ?? []).length;
  const island = /<script type="application\/json" data-held-for="members-ranked-tbody" data-held-render="congress-ranking">([\s\S]*?)<\/script>/.exec(html);
  assert.equal(visible, COMPACT_ROWS, "ten rows visible");
  assert.equal(hidden, 0, "no held row is in the DOM");
  assert.equal((JSON.parse(island![1]!) as { offset: number; rows: unknown[] }).rows.length, COMPACT_STEP, "fifty more ride in the server bytes, as island data");
  assert.match(html, /data-compact-shown="10"/);
  // DESIGN-POLISH M1 (R8): the range grammar, still plain words.
  assert.match(html, /<span class="compact-bound-count">1–10 of 80 ranked members<\/span>/, "the count is plain words");
  assert.match(html, />Show 50 more</, "the control offers the next fifty");
  assert.doesNotMatch(html, /render bound/i, "no pipeline vocabulary");
  assert.equal(compactExpandLabel(24, "tickers"), "Show all 24 tickers");
  assert.equal(compactExpandLabel(200, "tickers"), "Show 50 more");
  assert.doesNotMatch(compactBoundCount(5, 12, "rows"), /render bound|data bound/);
  assert.equal(compactBoundCount(5, 12, "rows"), "1–5 of 12 rows", "the new signature: shown, total, noun");
});

/* ---------- R12: feed page size + LD7 parts ---------- */

// REVERSED by launch M3a (LD20, pagination-and-counts.md rule 1a): the feed
// pages 20 rows; the published part index keeps page_size 50 byte-for-byte.
test("R12 / launch M3a: the feed pages 20 rows; the published index keeps 50", () => {
  assert.equal(DESIGN_FEED_PAGE_SIZE, 20);
  assert.equal(PAGE_SIZE, 50, "the transport page size the published index carries");
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
  // Launch M3a (rule 2a): the 20-row page count comes from part metadata, not
  // the index's 50-row page_count — every 20-row page is swept.
  const pages = feedPageCount(plan.index, DESIGN_FEED_PAGE_SIZE);
  assert.equal(pages, pageCountFor(merged, DESIGN_FEED_PAGE_SIZE), "the position-derived count equals the walk");
  for (let page = 0; page < pages; page++) {
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

test("R12/R19: a FILTER loads the WHOLE corpus — every part, once — never a single part and never the retired asset", async () => {
  const { makeDom, makeElement } = await import("./lib/fake-dom.ts");
  const { feedPartHref } = await import("../src/lib/feed-parts.ts");
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
  const byHref = new Map<string, unknown>();
  for (const [part, body] of plan.bodies) byHref.set(feedPartHref(part), JSON.parse(body));
  const restore = dom.install((url: string) => byHref.get(url) ?? plan.index);
  try {
    const { initFeed } = await import("../src/scripts/feed-client.ts");
    initFeed();
    lateChk.checked = true;
    lateChk.listeners.get("change")!.forEach((fn) => fn({}));
    await dom.flush();
    await dom.flush();
    assert.deepEqual(
      [...dom.fetchCalls].sort(),
      [...byHref.keys()].sort(),
      "a filter loads the whole corpus as its parts, each exactly once",
    );
    assert.ok(
      !dom.fetchCalls.some((u) => u.includes("feed.v1.json")),
      "the retired single-asset feed must never be fetched",
    );
    // Launch M3a: 20 rows a page, in the default "With ticker" view (every
    // fixture row carries a ticker, so nothing is hidden and nothing is stated).
    assert.match(dom.elements.get("pager-range")!.textContent, /^1–20 of 60 transactions with a ticker$/, "60 late rows over the full corpus");
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
import { consensusBoard, NAMED_MOVES_MIN } from "../src/lib/notable-moves.ts";
/* signals-v4 M2 (R12, R14, LD11, LD12): the band and the board render on
   /signals/#institutional; their R14 properties are pinned here on the new
   renderers */
import { buildSignalsInstitutional, consensusPanelHtml, signalsInstitutionalHtml } from "../src/lib/ui/signals-institutional.ts";
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
  assert.equal((JSON.parse(body) as { v: number; rows: unknown[] }).v, 1);
  assert.equal((JSON.parse(body) as { rows: unknown[] }).rows.length, moves.length, "the body round-trips every row");
  const tight = notableMovesShard("2026-03-31", moves, 700);
  assert.ok(Buffer.byteLength(tight.body) <= 700, `${Buffer.byteLength(tight.body)} B`);
  assert.equal(tight.shard.truncated, true);
  assert.ok(tight.shard.rows.length < moves.length);
  assert.match(tight.body, /"truncated":true/);
  assert.equal(JSON.parse(tight.body).total, moves.length, "the full population is stated");
});

test("R14 → signals-v4 LD11: the Named moves show 15 rows with the kind and type chips and a Show 15 more; rows anchor into the filer page; the count is the range grammar", () => {
  const inst = instFixture();
  const many = Array.from({ length: 40 }, (_, i) => rec({ cik: "0000000003", position_key: `sid:sec:${i}`, issuer_name: `ISSUER ${i}`, change_kind: "add", delta_shares: 1, delta_value_usd: 1000 - i }));
  const moves = notableMoves({ feed: feedOf(many), inst, period: "2026-03-31" });
  const model = buildSignalsInstitutional({
    present: true, period: "2026-03-31", latestFiled: "2026-07-31", freshness: "f", notableManagers: 3, moves, leaders: null, txns: [],
    filerHref: (cik) => `/institutional/filers/${Number(cik)}/`, filerTier: () => "top",
  });
  const html = signalsInstitutionalHtml(model, {});
  /* launch M7a (D5): the DOM set is still the slice's first 30 — 15 in the page, the rest in the island */
  const island = JSON.parse(/<script type="application\/json" data-held-for="mv-list" data-held-render="named-moves">([\s\S]*?)<\/script>/.exec(html)![1]!) as { rows: unknown[] };
  assert.equal((html.match(/<article class="mv-item"/g) ?? []).length + island.rows.length, 30, "the DOM set: the slice's first 30 (LD11)");
  assert.equal((html.match(/<article class="mv-item"(?![^>]*\shidden)[^>]*>/g) ?? []).length, NAMED_MOVES_MIN, "15 show");
  assert.doesNotMatch(html, /data-moves-period=/, "no quarter selector on Signals (plan non-goal)");
  for (const k of ["new", "exit", "add", "trim"]) assert.match(html, new RegExp(`data-mv-kind="${k}"`));
  for (const t of ["hedge_fund", "family_office", "asset_manager", "insurer", "alt_manager"]) assert.match(html, new RegExp(`data-mv-type="${t}"`));
  assert.match(html, /id="mv-more"[^>]*>Show 15 more</);
  assert.doesNotMatch(html, /notable-moves\/2026-03-31\.v1\.json/, "the truncated shard is not offered as every row (debt TD-3)");
  assert.match(html, /href="\/institutional\/filers\/3\/#pos-sid-sec-0"/, "a row lands on the issuer's change row");
  assert.match(html, /id="mv-range"[^>]*>1–15 of 40 moves</, "DESIGN-POLISH M1 (R8): the range grammar");
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
  /* DESIGN-POLISH M3 (R21, D4 (a); T3.10): the issuer reads as FILED —
     "NVIDIA CORP", never the retired title-case "Nvidia Corp". */
  assert.deepEqual(board.rows.map((r) => [r.issuer, r.newStakes, r.filers]), [["NVIDIA CORP", 3, 3], ["MICROSOFT CORP", 0, 3]]);
  assert.equal(board.qualifying, 2, "APPLE INC has two notable filers (the ordinary one does not count) and does not qualify");
  assert.equal(board.rows[0]!.netDeltaUsd, 400);
  assert.equal(board.rows[0]!.topMover!.kind, "new");
  const html = consensusPanelHtml(board, null);
  // signals-v4 LD12: the board's columns, the issuer takes the slack, the counts are numeric
  assert.match(html, /<div class="cs-head" aria-hidden="true"><span>Ticker<\/span><span>Issuer<\/span><span class="cs-hr">New<\/span>/);
  assert.match(html, /NVIDIA CORP/);
  assert.doesNotMatch(html, /Nvidia Corp/, "no title-cased filed name");
  assert.doesNotMatch(html, /render bound/);
  /* signals-v4 M2 (LD9, LD12, LD13): the Top add figure and the Consensus
     card are row 1 of this board, built on Signals from the same moves with
     the same rule */
  const model = buildSignalsInstitutional({
    present: true, period: "2026-03-31", latestFiled: "2026-07-31", freshness: "f", notableManagers: 3, moves, leaders: null, txns: [],
    filerHref: (cik) => `/f/${cik}`, filerTier: () => "top",
  });
  assert.deepEqual(model.board?.rows.map((r) => r.issuerKey), board.rows.map((r) => r.issuerKey), "the Signals board is consensusBoard(…, { minFilers: 3, limit: 50 })");
  assert.equal(model.cards.consensus?.issuerKey, board.rows[0]!.issuerKey);
  const page = readFileSync(path.join(SRC, "pages", "institutional", "index.astro"), "utf-8");
  assert.match(page, /DEFAULT_TYPES = new Set<string>\(\["hedge_fund"\]\)/, "Hedge funds selected by default");
  /* signals-v4 R17 (LD18): the band, the board and the leaders left
     /institutional/; the pointer leads to them, before the directory, then
     recent activity */
  for (const gone of ["notableMovesBandHtml(", "consensusBoardHtml(", "consensusConvictionBandHtml(", "newPositionLeadersHtml(", "consensusAddLedgerItem(", "plannedLine("]) {
    assert.ok(!page.includes(gone), `${gone} is gone from the page`);
  }
  assert.ok(page.indexOf('href="/signals/#institutional"') < page.indexOf('id="inst-managers-section"'), "the pointer before the directory");
  assert.ok(page.indexOf('id="inst-managers-section"') < page.indexOf("activitySectionHtml("), "recent activity below the directory");
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

/* R15, rewritten in DESIGN-POLISH M2 (T2.5 / T2.8 / T2.10; A-9). The
   property is unchanged — the filer page reads identity → the period's four
   figures → Position changes (20 rows + a real show-more) → holdings and book
   shape → ONE Planned line — and is now held by DOM ORDER, which is the visual
   order (no `:has()`/`order` rule re-stacks the page). The four figures moved
   from `statTiles` to the ONE header ledger (read from its <dl>), and the parts
   are: head (+ ledger root) → changes root → band F1 [holdings │ book shape +
   filing history] → Planned line → EDGAR / notes → the §5 note at the foot. */
function filerReadingOrder(html: string): string[] {
  const root = domOf(html);
  const mark = (el: MiniElement): string | null =>
    el.classList.contains("entity-head") ? "head"
      : el.hasAttribute("data-filer-root") ? "changes"
        : el.classList.contains("design-filer-band") ? "band"
          : el.classList.contains("planned-line") ? "planned"
            : el.classList.contains("edgar-block") ? "edgar"
              : el.id === "filer-notes" ? "notes"
                : el.classList.contains("filer-data-note") ? "data-note"
                  : null;
  return root.children.map(mark).filter((m): m is string => m !== null);
}

/* Launch copy audit filer-01 / filer-06 / filer-11 (reversal record,
   docs/frontend/launch-redesign.md): the Planned line (a roadmap) and the
   "Notes on this data" cards (generic restatements of caveats the provenance
   line and the §5 box carry) left the foot, and the reported value left the
   subline for the ledger. The reading order is otherwise unchanged and still
   held by DOM order. */
test("R15 (M2): the filer page reads head + ledger → changes → band F1 [holdings │ book shape + history] → EDGAR → §5 note, in DOM order", () => {
  const holdingsHtml = '<section class="panel panel-wide" aria-label="Reported holdings" data-holdings-surface="filer"><div data-holdings-body></div></section>';
  const html = filerBody(
    { cik: "0001067983", name: "BERKSHIRE HATHAWAY INC", latestPeriod: "2026-03-31" },
    ["2025-12-31", "2026-03-31"],
    "2026-03-31",
    { cik: "0001067983", period_of_report: "2026-03-31", position_count: 40, total_value_usd: 2_500_000_000, null_value_positions: 0, topn_value_usd: 1, topn_share_bps: 5000, hhi: 900, flags: [] },
    Array.from({ length: 35 }, (_, i) => qoq(i, i % 7 === 0 ? "new" : i % 5 === 0 ? "exit" : "add")),
    "2026-05-15",
    25,
    null,
    { total: 35, kinds: { new: 5, exit: 6 }, typing: typing({ cik: "0001067983", display_name: "Berkshire Hathaway", person: "Warren Buffett", manager_type: "asset_manager" }), holdingsHtml },
  );
  const subline = html.slice(html.indexOf('class="entity-subline"'), html.indexOf("</div>", html.indexOf('class="entity-subline"')));
  assert.match(subline, /Warren Buffett/);
  assert.match(subline, /Asset managers/);
  assert.doesNotMatch(subline, /reported 13\(f\) long value|latest quarter|notable/, "the value is the ledger's, the quarter the band head's (filer-01)");
  assert.match(subline, /CIK 1067983/);

  // the reading order IS the DOM order
  assert.deepEqual(filerReadingOrder(html), ["head", "changes", "band", "edgar", "data-note"]);
  // control: the pre-M2 order (the holdings band before the changes) is caught
  const bandAt = html.indexOf('<div class="design-band design-filer-band">');
  const changesAt = html.indexOf("<div data-filer-root>");
  const edgarAt = html.indexOf('<details class="edgar-block');
  const swapped = html.slice(0, changesAt) + html.slice(bandAt, edgarAt) + html.slice(changesAt, bandAt) + html.slice(edgarAt);
  assert.notDeepEqual(filerReadingOrder(swapped), filerReadingOrder(html), "control: a band moved above the changes changes the order");

  // the four period figures, from the ledger inside the head's ledger root
  const head = domOf(html).querySelector("header.entity-head")!;
  const ledger = head.querySelector("[data-filer-ledger]")!.querySelector("dl.design-ledger")!;
  assert.equal(ledger.getAttribute("aria-label"), "Period statistics for 2026-03-31");
  const figs = figuresOf(ledger);
  assert.deepEqual(figs.map((f) => f.label), ["Reported value", "Positions", "New stakes", "Exits"]);
  assert.deepEqual(figs.map((f) => f.value), ["$2.5B", "40", "5", "6"], "the kind counts are the WHOLE period's, not the embedded slice's");

  // band F1: the holdings surface is the left cell; book shape then filing history on the right
  const band = domOf(html).querySelector(".design-filer-band")!;
  assert.equal(band.children.length, 2);
  assert.equal(band.children[0]!.getAttribute("data-holdings-surface"), "filer");
  const side = band.children[1]!;
  assert.ok(side.classList.contains("design-filer-side"));
  assert.deepEqual(side.children.map((c) => (c.hasAttribute("data-filer-bookshape") ? "bookshape" : c.getAttribute("aria-label"))), ["bookshape", "Filing history"]);
  assert.ok(side.children[0]!.querySelector("section.design-book-shape"), "the book shape sits in its repaintable root");

  // the changes: open (never folded), 20 rows visible, the rest behind a real show-more
  assert.doesNotMatch(html, /<details class="panel panel-wide design-supplement" aria-label="Position changes"/, "changes are open, not folded");
  const posRows = bodyRows(html).filter((tr) => (tr.getAttribute("id") ?? "").startsWith("pos-") && tr.children[0]?.classList.contains("c-pos"));
  assert.equal(posRows.filter((tr) => !tr.hasAttribute("data-compact-extra")).length, CHANGES_COMPACT_ROWS);
  assert.equal(posRows.filter((tr) => tr.hasAttribute("data-compact-extra")).length, 15);
  assert.match(html, /data-compact-for="filer-changes-tbody" data-compact-total="35" data-compact-shown="20"/);
  assert.doesNotMatch(html, /aria-label="Congress overlap"|aria-label="Signals for this filer"|aria-label="Sector rotation"/, "empty frames are gone");
  assert.equal((html.match(/class="planned-line"/g) ?? []).length, 0, "no roadmap line (filer-06)");
  assert.doesNotMatch(html, /PLANNED|sector rotation/);
  assert.doesNotMatch(html, /id="filer-notes"|Notes on this data/, "the generic explainer cards are gone (filer-11)");
  assert.equal((html.match(/id="inst-data-note"/g) ?? []).length, 1, "the §5 note renders once, at the foot");
  assert.doesNotMatch(html, /producer-classified \(change_kind\)/);
});

test("R15: changesTableHtml with fewer rows than the compact slice renders no disclosure", () => {
  const html = changesTableHtml([qoq(1), qoq(2)], "2026-03-31", "2026-05-15", { total: 2 });
  assert.doesNotMatch(html, /compact-disclosure/);
  assert.doesNotMatch(html, /data-collapsed/);
});

/* ======================================================================
   R18 — home (amended by launch M2, Home A, owner decision D1)

   The property kept: one claim of twelve words or fewer, live tables whose
   rows come from the build, the range caveat on the amount column, and the
   philosophy relocated to /methodology/#principles, not cut. The mechanism
   replaced (R14): the three tiles (5 / 5 / 3 rows, the Signals tile among
   them) became "Latest from Congress" and "Notable managers" at six rows
   each beside the triage's lead cards; the hero's claim and lede render
   through `homeHeroCopyHtml`. test/launch-home.test.ts pins the new layout,
   its figures and its copy; this test keeps R18's own properties.
   ====================================================================== */

import { HOME_CLAIM, HOME_TILE_ROWS, congressTileHtml, movesTileHtml, homeHeroCopyHtml } from "../src/lib/ui/home.ts";

test("R18 (launch M2): the claim is twelve words or fewer; Latest from Congress and Notable managers carry six rows each", () => {
  assert.ok(HOME_CLAIM.split(/\s+/).length <= 12, HOME_CLAIM);
  assert.deepEqual(HOME_TILE_ROWS, { congress: 6, moves: 6 });
  const ctx: RenderCtx = {};
  const rows = Array.from({ length: 9 }, (_, i) => txn({ txnId: `t${i}`, name: `Member ${i}` }));
  const congress = congressTileHtml(rows, ctx);
  assert.equal(bodyRows(congress).length, HOME_TILE_ROWS.congress);
  assert.deepEqual(
    domOf(congress).querySelectorAll("thead th").map((th) => [visibleText(th).trim(), th.getAttribute("class")]),
    [["Side", "c-kind"], ["Member", "c-member c-flex"], ["Ticker", "c-ticker"], ["Range", "c-num"], ["Filed", "c-filed c-num"]],
  );
  // DESIGN-POLISH M1 (R6) → copy item home-03: the range caveat is the Range header's own note
  const rangeHead = domOf(congress).querySelectorAll("thead th")[3]!;
  assert.ok(rangeHead.querySelector(".note-btn.note-label"), "the range caveat hangs off the Range header");
  const moves = Array.from({ length: 8 }, (_, i) => ({ cik: `${i}`, manager: `M${i}`, principal: null, type: "hedge_fund" as const, issuer: `I${i}`, ticker: null, ticker_verified: null, kind: "new" as const, delta_shares: 1, curr_value: 1, delta_value: 1, filed: "2026-05-15", doc: null, key: `k${i}`, ikey: null }));
  const movesHtml = movesTileHtml(moves, "2026-03-31", (cik) => `/f/${cik}`);
  assert.equal(bodyRows(movesHtml).length, HOME_TILE_ROWS.moves);
  const hero = homeHeroCopyHtml([]);
  assert.match(hero, new RegExp(`<h1 class="hero-title" id="home-claim">${HOME_CLAIM.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}</h1>`));
  assert.match(hero, /\/methodology\/#principles/, "the philosophy is relocated, not cut");
  const page = readFileSync(path.join(SRC, "pages", "index.astro"), "utf-8");
  assert.match(page, /homeHeroCopyHtml\(/, "the page renders the claim through the hero renderer");
  assert.doesNotMatch(page + hero, /returned to the people/, "…and its full text left the home page");
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
  const ctx: RenderCtx = {};
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
  const ctx: RenderCtx = {};
  const band = overlapBand({ ticker: "ZZZZ", txns: overlapTxns(), generatedAtDate: NOW, inst: overlapInst(), typingByCik: overlapInst().typingByCik, period: "2026-03-31", ctx, filerHref: (cik) => `/f/${cik}` });
  assert.equal(band.inst, null);
  assert.ok(band.buyers.length > 0);
  const html = overlapBandHtml(band, ctx, () => "/");
  assert.match(html, /overlap-planned/);
  assert.match(html, /badge-planned">PLANNED/);
  assert.match(html, /Seller One/);
});

test("R19/R20: the band renders on BOTH routes — the unified ticker page (via deps) and the reviewed-ticker holders page", () => {
  const ctx: RenderCtx = {};
  const inst = overlapInst();
  const band = overlapBand({ ticker: "NVDA", txns: overlapTxns(), generatedAtDate: NOW, inst, typingByCik: inst.typingByCik, period: "2026-03-31", ctx, filerHref: (cik) => `/f/${cik}` });
  const overlapHtml = overlapBandHtml(band, ctx, (cik) => `/f/${cik}`);
  const ticker = tickerUnifiedBody(
    { ticker: "NVDA", txns: overlapTxns(), paper: [] } as never,
    { state: "data", name: "NVIDIA CORP", period: "2026-03-31", latestFiled: null, topn: 4, holders: [] },
    { buildId: "b", generatedAt: "2026-08-23 00:00 UTC", generatedAtDate: NOW },
    ctx,
    { fullTable: false },
    { crowding: null, committees: null, overlap: overlapHtml },
  );
  assert.match(ticker, /id="overlap"/);
  /* signals-v3 M3 (R21, LD8): the band moved INTO the Institutional tab
     panel, after the holders and before the agreement — the Congress panel
     comes first and closes before the Institutional panel opens. Read by DOM
     parse: the band's nearest tab panel is #institutional. */
  const dom = domOf(ticker);
  const overlapEl = dom.querySelector("#overlap")!;
  assert.equal(overlapEl.closest('[role="tabpanel"]')?.getAttribute("id"), "institutional", "the overlap band sits in the Institutional panel");
  assert.ok(ticker.indexOf('id="congress"') < ticker.indexOf('id="institutional"'), "Congress, then Institutional");
  const instPanel = ticker.slice(ticker.indexOf('id="institutional"'));
  assert.ok(instPanel.indexOf('id="ticker-holders"') < instPanel.indexOf('id="overlap"') && instPanel.indexOf('id="overlap"') < instPanel.indexOf('class="panel design-agree"'), "holders, then the overlap band, then the agreement (launch ticker-13: its head reads 'Congress vs filers')");
  // control: the pre-M3 order (the band between the two sections, outside both) fails the panel reading
  assert.notEqual(domOf(`<section role="tabpanel" id="congress"></section>${overlapHtml}<section role="tabpanel" id="institutional"></section>`).querySelector("#overlap")!.closest('[role="tabpanel"]')?.getAttribute("id"), "institutional");
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
  /* DESIGN-POLISH M2 (T2.8, milestone map `refinement-m2.test.ts:638-640`):
     the holders header's four figures moved from `statTiles` to the ONE
     header ledger; the property — holders · combined value · adds · exits, in
     order, with their values — is read from the ledger's <dl> by DOM parse. */
  const holderFigs = ledgerFigures(holders);
  assert.deepEqual(holderFigs.map((f) => f.label), ["Holders", "Combined value", "Adds", "Exits"]);
  assert.deepEqual(holderFigs.map((f) => f.value), ["4", "$3.0M", "2", "1"]);
  assert.equal(domOf(holders).querySelector("dl.design-ledger")!.getAttribute("aria-label"), "Holder statistics");
  assert.equal(bodyRows(holders).filter((tr) => tr.children[0]?.classList.contains("c-rank")).length, 4, "holders ranked");
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
