/* DESIGN-POLISH M3 — the review remediation (ledger
   docs/design/polish-preview/M3-REVIEW-LEDGER.md: W-*, K-*, P-*, CD3-4).

   One test per finding that has no home in an existing file, each pinning the
   PROPERTY the finding named and each carrying a control that re-plants the
   defect and must be caught. The Rule 0-3 deadline (W-1) lives with the other
   closed-period tests (`r20-r22-institutional.test.ts`, `derive.test.ts`,
   `activity.test.ts`); the changes terminus (W-4) in `inst-changes-bound.test.ts`;
   the net-flow Issuer cell (W-9, CD3-4) in `content-hygiene.test.ts`. */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  assetColumnNote,
  assetLineHtml,
  assetNameCell,
  displayAsset,
  feedHeadHtml,
  tickerNoteKey,
  txnRowHtml,
  type RenderCtx,
  type TxnRow,
} from "../src/lib/format.ts";
import {
  QOQ_FOOTNOTES,
  hitRowHtml,
  memberV2Sections,
  notableRailHtml,
  tickerInstSectionHtml,
} from "../src/lib/ui/index.ts";
import { FLAT_NET_BOUND, netKindWord } from "../src/lib/ui/shared.ts";
import { signalReceiptHtml } from "../src/lib/ui/signals.ts";
import { entityTxnTable } from "../src/lib/ui/congress.ts";
import { overlapBand, overlapBandHtml } from "../src/lib/overlap.ts";
import { holdingsTableHtml, type FilerHoldingRow } from "../src/lib/holdings.ts";
import { activityFeedHtml, paginateActivity, type ActivityFeed, type ActivityRecord, type FilingDictionary } from "../src/lib/activity.ts";
import * as notableMoves from "../src/lib/notable-moves.ts";
import type { InstData, TickerHolderRow } from "../src/lib/inst.ts";
import type { Signal } from "../src/lib/signals.ts";
import { domOf, visibleText } from "./lib/ledger-dom.ts";
import { contentHits } from "./lib/content-scan.ts";
import { qoqViewPredatesR8, r8Violations, type KindRow } from "./lib/kind-rows.ts";
import { FILINGS } from "./fixtures/institutional.ts";

const SRC = path.resolve(import.meta.dirname, "..", "src");
const REPO = path.resolve(import.meta.dirname, "..", "..");
const CTX: RenderCtx = { watched: new Set() };

function txn(over: Partial<TxnRow> = {}): TxnRow {
  return {
    kind: "txn", filed: "2026-05-01", traded: "2026-03-16", name: "Jane Doe", bioguide: "D000001", party: "D",
    state: "CA", district: "11", chamber: "house", ticker: "AAPL", side: "purchase", owner: null,
    low: 1001, high: 15000, lag: 46, late: 0, flags: [], doc: "https://disclosures-clerk.house.gov/x.pdf",
    asset: "Apple Inc. (AAPL) [ST]", assetType: "ST", txnId: "t-1",
    ...over,
  };
}

function holder(over: Partial<TickerHolderRow> = {}): TickerHolderRow {
  return {
    ticker: "NVDA", period_of_report: "2026-03-31", rank: 1, cik: "0000000001", filer_name: "ALPHA CAPITAL", value_usd: 1_000_000,
    shares: 100, prev_shares: 50, delta_shares: 50, change_kind: "add", method: "exact-name", verified_date: "2026-09-10", filed_date: "2026-05-15",
    ...over,
  };
}

function instWith(holders: TickerHolderRow[], holderCount = holders.length): Extract<InstData, { present: true }> {
  return {
    present: true,
    watermarks: { latest_period_of_report: "2026-03-31", latest_filed_date: "2026-05-20" },
    topn: 25, filers: [], deltasByCik: new Map(), concentrationByCik: new Map(), holdersByIssuer: new Map(),
    addsByPeriodMode: new Map(), addsExclusions: new Map(), addsPeriods: [],
    typingByCik: new Map([
      ["0000000001", { cik: "0000000001", display_name: "Alpha Capital", person: null, manager_type: "hedge_fund", notable: true }],
      ["0000000002", { cik: "0000000002", display_name: "Beta Capital", person: null, manager_type: "hedge_fund", notable: true }],
    ]),
    bookDiscontinuityByCik: new Map(),
    tickerTotals: new Map([["NVDA", { ticker: "NVDA", period_of_report: "2026-03-31", prev_period: "2025-12-31", issuer_name: "NVIDIA CORP", title_of_class: "COM", holder_count: holderCount, value_usd: 1, adds: 1, exits: 1 }]]),
    tickerHoldersByTicker: new Map([["NVDA", holders]]),
    tickerByKey: new Map(),
  } as unknown as Extract<InstData, { present: true }>;
}

/* ===================================================== W-2 / K-2 overlap */

test("W-2 / K-2: the overlap timeline's 13F rows read the caps kind word; the raw kind rides on the row edge only", () => {
  const inst = instWith([
    holder({ cik: "0000000001", change_kind: "add", filed_date: "2026-05-10" }),
    holder({ rank: 2, cik: "0000000002", change_kind: "exit", value_usd: null, filed_date: "2026-05-12" }),
  ]);
  const band = overlapBand({ ticker: "NVDA", txns: [], generatedAtDate: "2026-06-01", inst, typingByCik: inst.typingByCik, period: "2026-03-31", ctx: CTX, filerHref: (c) => `/f/${c}` });
  const html = overlapBandHtml(band, CTX, (c) => `/f/${c}`);
  const rows = domOf(html).querySelectorAll("tbody tr");
  assert.deepEqual(rows.map((tr) => [tr.getAttribute("data-edge"), visibleText(tr.querySelector("td.c-kind")!).trim()]), [["exit", "EXIT"], ["add", "ADD"]]);
  assert.deepEqual(contentHits(html).filter((h) => /raw producer kind/.test(h.check)), []);
  // the section notes say what the rows are: the kind words, and every row dates by filing
  assert.match(html, /NEW \+ ADD vs TRIM \+ EXIT, by shares/);
  assert.match(html, /every row dates by its filing date/);
  assert.doesNotMatch(html, /13F rows by quarter end/, "control: the note's retired claim (13F rows date by their FILED date since T20)");
  // control: the retired cell — the raw producer kind — is caught by the dist scan's predicate
  assert.ok(contentHits('<table><tr data-edge="add"><td class="c-kind c-buy">add</td></tr></table>').some((h) => /raw producer kind/.test(h.check)));
});

/* ===================================================== W-3 + the "$0" */

test("W-3: the ticker page's holders note and terminus are true of the mapped path (share counts, changes and filed dates ARE in that list)", () => {
  const holders = [
    { rank: 1, cik: "0000000001", name: "ALPHA CAPITAL", value: 1_000_000, securities: 1, keySource: "mapped", flags: [], tier: "top" as const },
    { rank: 2, cik: "0000000002", name: "BETA CAPITAL", value: null, securities: 1, keySource: "mapped", flags: [], tier: "top" as const },
  ];
  const mapped = tickerInstSectionHtml({ state: "data", name: "NVIDIA CORP", period: "2026-03-31", latestFiled: "2026-05-20", topn: 2, holdersPage: true, mapped: { issuer: "NVIDIA CORP", titleOfClass: "COM", holderCount: 700 }, holders }, "NVDA");
  assert.match(mapped, /that list carries each holder's share count, share change and filed date \(the full holders view shows them\), but no document links/);
  assert.doesNotMatch(mapped, /per-filer filed dates, share counts and document links are not in that list/, "control: the entity-path sentence, false here");
  assert.match(mapped, /The 2 largest of the 700 13F filers reporting this share class for the quarter are listed/);
  assert.doesNotMatch(mapped, /a build parameter of the Public Filings aggregation/, "control: the top-N claim, false on the mapped path");
  const complete = tickerInstSectionHtml({ state: "data", name: "NVIDIA CORP", period: "2026-03-31", latestFiled: "2026-05-20", topn: 2, holdersPage: false, mapped: { issuer: "NVIDIA CORP", titleOfClass: "COM", holderCount: 2 }, holders }, "NVDA");
  assert.match(complete, /Every one of the 2 13F filers reporting this share class for the quarter is listed\./);
  assert.match(complete, /share change and filed date, which this table does not show/);
  // the entity-keyed path keeps its own, true, sentences
  const entity = tickerInstSectionHtml({ state: "data", name: "NVIDIA CORP", period: "2026-03-31", latestFiled: "2026-05-20", topn: 25, holders: [holders[0]!] }, "NVDA");
  assert.match(entity, /per-filer filed dates, share counts and document links are not in that list/);
  assert.match(entity, /ranks the top 25 holders per issuer/);
});

test("honesty §3: an undisclosed mapped holder value is NULL and renders \"—\", never \"$0\"", async () => {
  const { tickerInstSection } = await import("../src/lib/data.ts");
  const inst = instWith([holder({ cik: "0000000001" }), holder({ rank: 2, cik: "0000000002", value_usd: null })]);
  const section = tickerInstSection({ inst, tickerMap: null, tickers: [] } as never, "NVDA");
  assert.equal(section.state, "data");
  assert.deepEqual(section.holders!.map((h) => h.value), [1_000_000, null], "NULL stays NULL (the retired `?? 0` made it 0)");
  const html = tickerInstSectionHtml(section, "NVDA");
  const values = domOf(html).querySelectorAll("tbody tr").map((tr) => visibleText(tr.querySelectorAll("td")[2]!).trim());
  assert.deepEqual(values, ["$1.0M", "— value not disclosed"]);
  // control: the retired zero would have printed as a disclosed "$0"
  assert.ok(!values.includes("$0"));
});

/* ===================================================== K-3 no-ticker cells */

test("K-3: a no-ticker asset is a label trigger whose note gives it as filed — on the classic feed, the member's largest recent and the rail", () => {
  const long = "BLACKROCK LIQUIDITY FUNDS TREASURY TRUST FUND INSTITUTIONAL SHARES";
  const cell = assetNameCell({ asset: long, assetType: "Mutual Fund", txnId: "t-9" }, { scope: "x" });
  const dom = domOf(cell);
  assert.equal(visibleText(dom.querySelectorAll(".note-pop")[0]!).trim(), `As filed: ${long} · asset type as filed: Mutual Fund`);
  assert.equal(dom.querySelectorAll(".note-pop")[0]!.getAttribute("id"), "n-x-t-9-asset");
  assert.ok(cell.includes(`<span class="visually-hidden">${long} — asset type as filed: Mutual Fund — asset as filed, no ticker disclosed</span>`), "the accessible name still carries the whole name");
  // nothing hidden, nothing to open
  assert.doesNotMatch(assetNameCell({ asset: "Jefferson Parish Bond", assetType: null, txnId: "t-8" }, { scope: "x" }), /note-pop/);
  // the three surfaces pass a scope keyed on the txn id
  const row = txn({ ticker: null, asset: long, assetType: "Mutual Fund", txnId: "t-7" });
  assert.match(txnRowHtml(row, CTX), /id="n-feed-noticker-t-7-asset"/, "the classic feed");
  assert.match(
    notableRailHtml({ rows: [row], windowFrom: "2026-01-01", unrankable: 0, dateAnomalies: 0 }, CTX),
    /id="n-rail-asset-t-7-asset"/,
    "the home rail",
  );
  const member = { bioguide: "D000001", name: "Jane Doe", party: "D", state: "CA", district: "11", chamber: "house", servingSince: "2019", filingCount: 1, txns: [{ ...row, filed: "2026-07-20", low: 250_001, high: 500_000 }], paper: [] };
  assert.match(
    memberV2Sections(member as never, { buildId: "b", generatedAt: "2026-07-24 06:56 UTC", generatedAtDate: "2026-07-24" }, CTX, { resolveSector: null, sectorMeta: null, committees: null }),
    /id="n-member-recent-asset-t-7-asset"/,
    "the member's largest recent disclosures",
  );
  // control: the retired cell had no trigger at all — the note is new reach
  assert.doesNotMatch(assetNameCell({ asset: long, assetType: "Mutual Fund" }), /note-pop/);
});

/* ===================================================== CD3-4 */

test("CD3-4 (b)/(c): the asset rule is stated ONCE on the column; a mechanical-only name carries no per-row note, any other difference keeps one", () => {
  const rule = assetColumnNote();
  for (const part of ["“(TICKER)”", "“[ST]”", "“Common Stock”", "“Ordinary Shares”", "Stocks (including ADRs)", "keeps its brackets", "its note gives the text as filed"]) {
    assert.ok(rule.includes(part), part);
  }
  // the member transactions' Asset header and the reference feed's Asset · Owner header carry it
  const table = entityTxnTable([txn()], { kind: "member", caption: "c", page: 0, ctx: CTX, notes: { scope: "member-txns" } });
  const assetHead = domOf(table).querySelectorAll("th").find((th) => /^Asset/.test(visibleText(th).trim()))!;
  assert.ok(visibleText(assetHead.querySelectorAll(".note-pop")[0]!).includes("without the parts that repeat the row"));
  assert.equal(assetHead.querySelectorAll(".note-pop")[0]!.getAttribute("id"), "n-member-txns-asset", "its own key, not the owner note's");
  const feedHead = feedHeadHtml({ referenceFeed: true, sortable: true, notes: { scope: "congress-feed" } });
  assert.ok(feedHead.includes("without the parts that repeat the row"));
  // mechanical-only: exact " (TICKER)", " [ST]" on an ST row, " Common Stock" / " - Common Stock"
  for (const asset of ["Apple Inc. (AAPL) [ST]", "Apple Inc. - Common Stock (AAPL) [ST]", "Apple Inc. Common Stock (AAPL) [ST]", "Apple Inc. (AAPL)"]) {
    const d = displayAsset({ asset, assetType: asset.includes("[ST]") ? "ST" : null, ticker: "AAPL" });
    assert.equal(d.text, "Apple Inc.", asset);
    assert.equal(d.mechanicalOnly, true, asset);
    assert.doesNotMatch(assetLineHtml(txn({ asset, assetType: asset.includes("[ST]") ? "ST" : null }), { notes: { scope: "t" } }), /note-pop/, asset);
  }
  // any other difference keeps its note: another code's words, a case-variant ticker, "[sT]", stray punctuation, an unknown code
  for (const [asset, type] of [["Netflix, Inc. (NFLX) [OP]", "OP"], ["Apple Inc. (AAPl) [ST]", "ST"], ["Apple Inc. (AAPL) [sT]", "ST"], ["Apple Inc., (AAPL) [ST]", "ST"]] as const) {
    const ticker = asset.startsWith("Netflix") ? "NFLX" : "AAPL";
    assert.equal(displayAsset({ asset, assetType: type, ticker }).mechanicalOnly, false, asset);
    assert.match(assetLineHtml(txn({ asset, assetType: type, ticker }), { notes: { scope: "t" } }), /note-pop/, asset);
  }
  const unknown = assetLineHtml(txn({ asset: "Mystery Holding [ZZ] (AAPl)", assetType: "ZZ" }), { notes: { scope: "t" } });
  assert.match(visibleText(domOf(unknown).querySelectorAll(".note-pop")[0]!), /type code ZZ: not in the House Clerk's code list/);
  // (b): the repeated stock-code line left the rows
  assert.doesNotMatch(unknown + assetLineHtml(txn({ asset: "Apple Inc. (AAPl) [ST]" }), { notes: { scope: "t" } }), /\(House Clerk code list\)/);
});

test("CD3-4 (a): the net-flow notes are keyed on the ticker, injectively, and every id on a member page is unique", () => {
  assert.equal(tickerNoteKey("AAPL"), "AAPL");
  assert.notEqual(tickerNoteKey("BRK.B"), tickerNoteKey("BRK-B"), "slug would fold both to brk-b");
  const tickers = ["BRK.B", "BRK-B", "BRK/B", "NFLX", "AAPL"];
  const m = {
    bioguide: "T000001", name: "Fixture Member", party: "R", state: "OK", district: null, chamber: "house", servingSince: "1999", filingCount: 1,
    txns: tickers.map((t, i) => txn({ ticker: t, asset: `Issuer ${i} Holdings (XYZ${i}) [OP]`, assetType: "OP", txnId: `t-${i}` })),
    paper: [],
  };
  const html = memberV2Sections(m as never, { buildId: "b", generatedAt: "2026-07-24 06:56 UTC", generatedAtDate: "2026-07-24" }, CTX, { resolveSector: null, sectorMeta: null, committees: null });
  const ids = [...html.matchAll(/ id="([^"]+)"/g)].map((x) => x[1]!);
  const mf = ids.filter((id) => id.startsWith("n-mf-"));
  assert.equal(mf.length, tickers.length, "one note per ticker row (each name differs non-mechanically)");
  assert.equal(new Set(ids).size, ids.length, `duplicate ids: ${ids.filter((id, i) => ids.indexOf(id) !== i).join(", ")}`);
  assert.ok(mf.every((id) => id.length <= 20), "short ids: the 75-character txn-keyed id is gone");
  // control: the slug of the plain ticker would collide
  assert.equal("BRK.B".toLowerCase().replace(/[^a-z0-9]+/g, "-"), "BRK-B".toLowerCase().replace(/[^a-z0-9]+/g, "-"));
});

/* ===================================================== K-4 … K-10 */

test("K-4: the ticker page's signals table speaks the rule book's short labels — no private copy", () => {
  const src = readFileSync(path.join(SRC, "lib", "ui", "ticker.ts"), "utf-8");
  assert.doesNotMatch(src, /"s1-large": "LARGE"/, "control: the private label map is gone");
  assert.match(src, /signalKindShort\(kind\)/);
  assert.match(src, /signalKindShort\(w\.kind\)/);
});

test("K-5: an activity row does not carry its kind's colour hook — only the word does", () => {
  const rec: ActivityRecord = {
    cik: "0001067983", filer_name: "F", issuer_key: "entity:1", issuer_name: "APPLE INC", position_key: "sid:a", put_call: "LONG", ssh_prnamt_type: "SH",
    change_kind: "add", curr_period: "2026-03-31", prev_period: "2025-12-31", prev_value_usd: 1, curr_value_usd: 2, delta_value_usd: 1,
    prev_shares: 1, curr_shares: 2, delta_shares: 1, filing_keys: [1], prior_filing_keys: [], current_filing_keys: [], flags: [],
  };
  const filings: FilingDictionary = { "1": { accession: "0000000000-26-000001", submission_type: "13F-HR", period_of_report: "2026-03-31", filed_date: "2026-05-10", doc_url: "https://www.sec.gov/x", source: "sec-edgar" } };
  const feed = { present: true, reason: null, filings, pagination: paginateActivity([rec], filings), records: [rec] } as ActivityFeed;
  const tr = domOf(activityFeedHtml(feed, { reference: true })).querySelectorAll("tr.design-activity-row")[0]!;
  const classes = (tr.getAttribute("class") ?? "").split(/\s+/);
  assert.ok(!classes.some((c) => c.startsWith("qoq-")), `row classes: ${classes.join(" ")}`);
  assert.equal(tr.getAttribute("data-edge"), "add", "the edge carries the kind");
  assert.ok(tr.querySelector("td.c-kind .qoq-chip.qoq-add"), "the word keeps its colour hook");
});

test("K-6: the dead MOVE_KIND_LABELS map is deleted", () => {
  assert.ok(!("MOVE_KIND_LABELS" in notableMoves), "control: a second kind-word map could drift from `kindWord`");
});

test("K-7: one receipt rule — the link names its regime; where it cannot, or there is none, the stamp does (hit rows, member panel, watch band)", () => {
  assert.equal(visibleText(domOf(signalReceiptHtml("https://disclosures-clerk.house.gov/p.pdf", "house"))).trim(), "PTR ↗");
  assert.equal(visibleText(domOf(signalReceiptHtml("https://efdsearch.senate.gov/x", "senate"))).trim(), "eFD ↗");
  assert.equal(visibleText(domOf(signalReceiptHtml("https://example.gov/doc", "senate"))).replace(/\s+/g, " ").trim(), "eFD src ↗", "a link that cannot name its regime keeps the stamp");
  assert.equal(visibleText(domOf(signalReceiptHtml(undefined, "house"))).trim(), "PTR —");
  assert.equal(visibleText(domOf(signalReceiptHtml("http://insecure.example/x", "house"))).trim(), "PTR —", "an unusable receipt is no receipt");
  const s = (receipts: string[]): Signal => ({
    id: "s1", kind: "s1-large", rule: "r", thresholdVersion: "1", entities: { bioguide: "A000001", memberName: "A", ticker: "ABC" },
    magnitude: { low: 250001, high: 500000 }, receipts, occurrence: { tradeDate: "2026-03-01", filedDate: "2026-06-01" }, sourceAvailableAt: "", computedAt: "",
    firstSeenBuild: "b", lastSeenBuild: "b", status: "active", cohort: "house",
  } as Signal);
  assert.match(visibleText(domOf(hitRowHtml(s(["https://example.gov/doc"]), CTX)).querySelectorAll("td.c-src")[0]!), /PTR src/);
  // the watch band's client applies the same rule to the same fields, with the cohort in its payload
  const client = readFileSync(path.join(SRC, "scripts", "signals-client.ts"), "utf-8");
  assert.match(client, /if \(label === "src"\) rcpt\.append\(stamp, " "\)/);
  assert.match(client, /else rcpt\.append\(stamp, " —"\)/);
  assert.doesNotMatch(client, /else rcpt\.textContent = "—"/, "control: the retired bare dash");
  const signals = readFileSync(path.join(SRC, "lib", "ui", "signals.ts"), "utf-8");
  // the cohort rides in the payload (SIGNALS-CLARITY M2 appends the R10 fields after it; no index moves)
  assert.match(signals, /cols: \["id", "kind", "bioguide", "name", "ticker", "low", "high", "traded", "filed", "receipt", "cohort"[,\]]/);
});

test("K-9: displayAsset strips to a fixpoint — the order of the parts does not matter; a counted suffix is not a type", () => {
  assert.equal(displayAsset({ asset: "Apple Inc. [ST] (AAPL)", assetType: "ST", ticker: "AAPL" }).text, "Apple Inc.");
  assert.equal(displayAsset({ asset: "Block, Inc. Class A Common Stock, (SQ) [ST]", assetType: "ST", ticker: "SQ" }).text, "Block, Inc. Class A");
  assert.equal(displayAsset({ asset: "Apple Inc. (AAPL) Common Stock [ST]", assetType: "ST", ticker: "AAPL" }).text, "Apple Inc.");
  /* measured on the 20260817.1 corpus: the suffix names what a unit
     REPRESENTS, and stripping it left "…each representing 3" */
  for (const asset of ["ARM Holdings plc - American Depositary Shares each representing 3 ordinary Shares (ARMH)", "Vodafone Group Plc - American Depositary Shares each representing ten Ordinary Shares (VOD) [ST]", "Units each consisting of one share of Common Stock"]) {
    assert.match(displayAsset({ asset, assetType: asset.includes("[ST]") ? "ST" : null, ticker: /\(([A-Z]+)\)/.exec(asset)?.[1] ?? null }).text, /(ordinary Shares|Ordinary Shares|Common Stock)$/, asset);
  }
  // control: a single pass in the retired order left the suffix in place
  assert.equal("Block, Inc. Class A Common Stock, (SQ) [ST]".replace(/\s*\[([A-Za-z0-9]{2})\]$/, "").replace(/\s*\(SQ\)$/, "").replace(/\s*(?:-\s*)?(?:Common Stock|Ordinary Shares)$/i, ""), "Block, Inc. Class A Common Stock,");
});

test("K-10: the ≈-marker note sits on the function it describes", () => {
  const src = readFileSync(path.join(SRC, "lib", "ui", "shared.ts"), "utf-8");
  const at = src.indexOf("`footnotesId` is gone from this path");
  assert.ok(at > 0);
  const next = src.slice(at).search(/\nexport (function|const) /);
  assert.match(src.slice(at + next, at + next + 40), /export function netCellHtml/);
});

/* ===================================================== W-5 … W-10 */

test("W-5: the methodology's cut statement covers BOTH boundary branches", () => {
  const astro = readFileSync(path.join(SRC, "pages", "methodology", "index.astro"), "utf-8");
  assert.match(astro, /If that change has a\s+disclosed value, none of the changes left out is larger in absolute value and every change\s+without a disclosed value is left out;/);
  assert.match(astro, /if the cut falls among the changes whose value was not\s+disclosed, every change with a disclosed value is published and only undisclosed ones are\s+left out\./);
  assert.doesNotMatch(astro, /stated change: none of the changes left out is larger in absolute value, every change without/, "control: the retired one-branch sentence");
});

test("W-6: an issuer line that shows a reviewed ticker does not also say 'ticker not yet mapped'", () => {
  const base = { cik: "0001067983", period: "2026-03-31", filing_key: "1", security_id: null, value_usd: 10, shares: 1, ssh_type: "SH", put_call_bucket: "LONG", unit_key: "SH" };
  const com = { ...base, cusip: "037833100", issuer_name: "APPLE INC", title_of_class: "COM", put_call: null, position_key: "cusip:037833100", ticker: "AAPL", ticker_verified_date: "2026-09-10", flags: [] } as FilerHoldingRow;
  const put = { ...base, cusip: "037833900", issuer_name: "APPLE INC", title_of_class: "PUT", put_call: "PUT", put_call_bucket: "PUT", position_key: "cusip:037833900", flags: ["missing_security"] } as FilerHoldingRow;
  const other = { ...base, cusip: "111111111", issuer_name: "OTHER CO", title_of_class: "COM", put_call: null, position_key: "cusip:111111111", flags: ["missing_security"] } as FilerHoldingRow;
  const html = holdingsTableHtml({ reference: true, cik: "0001067983", filerName: "F", period: "2026-03-31", rows: [com, put, other], filings: FILINGS, page: 0 });
  const groups = domOf(html).querySelectorAll("tr.design-holding-group");
  assert.equal(groups.length, 1, "the two Apple rows form one issuer line");
  assert.doesNotMatch(visibleText(groups[0]!), /ticker not yet mapped/, "the line shows AAPL");
  assert.equal((html.match(/ticker not yet mapped/g) ?? []).length, 1, "control: the unmapped issuer still says so");
});

test("W-7: the †v note says what this build's data did, and what builds from 2026-09-10 on do", () => {
  const tv = QOQ_FOOTNOTES.find((f) => f.mark === "†v")!.html;
  assert.equal(tv, "the reported share count is unchanged across the pair; this build's data classified the change from its reported value; builds from 2026-09-10 on read it as NO CHANGE <code>classified_by_value</code>");
  assert.doesNotMatch(tv, /reads as held/, "control: false beside the ADD or TRIM word this marker only ever sits next to");
});

test("W-8: the missing-date definition names the form the producer reads (M/D/YYYY)", async () => {
  const { flagTags } = await import("../src/lib/format.ts");
  const html = flagTags(["date_missing"], txn({ traded: null, flags: ["date_missing"] }), { definitions: { notes: { scope: "f" }, key: "t" } });
  assert.match(html, /no trade date in month\/day\/four-digit-year form that is a real calendar date/);
  // the producer's pattern is exactly that form
  assert.match(readFileSync(path.join(REPO, "src", "populus", "normalize.py"), "utf-8"), /_MDY = re\.compile\(r"\^\(\\d\{1,2\}\)\/\(\\d\{1,2\}\)\/\(\\d\{4\}\)\$"\)/);
});

test("W-10: FLAT only inside the smallest bucket; a wider zero-spanning range reads ± with its spoken reason", () => {
  assert.equal(FLAT_NET_BOUND, 15_000);
  assert.deepEqual(netKindWord({ kind: "finite", low: -15_000, high: 15_000 }), { word: "FLAT", why: "the net range spans zero" });
  assert.deepEqual(netKindWord({ kind: "finite", low: -15_000, high: 1_050_000 }), { word: "±", why: "net range spans zero" });
  assert.equal(netKindWord({ kind: "finite", low: -250_000, high: 5_000 }).word, "±");
  const m = {
    bioguide: "T000001", name: "Fixture Member", party: "R", state: "OK", district: null, chamber: "house", servingSince: "1999", filingCount: 2,
    txns: [
      txn({ ticker: "WIDE", asset: "Wide Corp (WIDE) [ST]", side: "purchase", low: 1_000_001, high: 5_000_000, txnId: "a" }),
      txn({ ticker: "WIDE", asset: "Wide Corp (WIDE) [ST]", side: "sale", low: 1_000_001, high: 5_000_000, txnId: "b" }),
    ],
    paper: [],
  };
  const html = memberV2Sections(m as never, { buildId: "b", generatedAt: "2026-07-24 06:56 UTC", generatedAtDate: "2026-07-24" }, CTX, { resolveSector: null, sectorMeta: null, committees: null });
  const kind = domOf(html).querySelectorAll("tr.design-net-row td.c-kind")[0]!;
  assert.equal(visibleText(kind).trim(), "± net range spans zero");
  // control: the retired rule called a range of millions either way "FLAT"
  assert.notEqual(visibleText(kind).trim().split(" ")[0], "FLAT");
});

/* ===================================================== P-5 */

test("P-5: the R8 predicate is exported and exempts †v ONLY on a pre-R8 aggregate, detected from the view's DDL", () => {
  const rows: KindRow[] = [
    { kind: "ADD", deltaShares: "0", valueClassified: true },
    { kind: "TRIM", deltaShares: "0", valueClassified: false },
    { kind: "ADD", deltaShares: "+10", valueClassified: false },
  ];
  assert.deepEqual(r8Violations(rows, true).map((r) => r.kind), ["TRIM"], "pre-R8: the disclosed row is exempt, the unmarked one is not");
  assert.deepEqual(r8Violations(rows, false).map((r) => r.kind), ["ADD", "TRIM"], "post-R8: no exemption at all");
  // the producer's CURRENT view names 'held', so a build of this tree is post-R8
  const ddl = readFileSync(path.join(REPO, "src", "populus", "inst_agg.sql"), "utf-8");
  const view = ddl.slice(ddl.indexOf("CREATE VIEW IF NOT EXISTS agg_qoq_deltas"));
  assert.equal(qoqViewPredatesR8(view.slice(0, view.indexOf(";"))), false);
  // the local data build 20260817.1's view (codes 0-3, else unclassified) predates it
  assert.equal(qoqViewPredatesR8("CASE q.change_kind_code WHEN 0 THEN 'new' WHEN 1 THEN 'add' WHEN 2 THEN 'trim' WHEN 3 THEN 'exit' ELSE 'unclassified' END"), true);
  assert.equal(qoqViewPredatesR8(null), null, "no DDL: the caller treats it as NOT pre-R8 (strict)");
});
