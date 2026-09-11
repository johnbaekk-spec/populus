/* Refinement 20260910 — Codex code review round 1 (F1 … F10) regressions.
   Each test fails on the code the review found and passes on the fix:
   F1 member net flow is purchases minus sales · F2 tail holdings keep reviewed
   tickers · F3 the tail payload carries kinds / discontinuity / typing ·
   F4 /e/ re-binds the changes disclosure · F5 a stale part response never
   overwrites a filtered view · F7 the ranked holder list is the capped prefix ·
   F8 the overlap timeline orders by 13F FILED date · F9 filer pages open on the
   landing's closed quarter · F10 the comparison follows the selected quarter. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { memberBody } from "../src/lib/ui/index.ts";
import { netFlow, netIntervalText, sumRanges, type MemberEntity } from "../src/lib/derive.ts";
import {
  DATASET_VERSION,
  PAPER_COLS,
  TXN_COLS,
  mergeFeed,
  txnToArray,
  type RenderCtx,
  type TxnRow,
} from "../src/lib/format.ts";
import {
  assembleFilerPayload,
  fragmentFilerPayload,
  parseFilerPayload,
  readServingFilings,
  reassembleFilerFragments,
  type FilerAggregateInputs,
} from "../src/lib/filer-payload.ts";
import { TICKER_HOLDERS_RANK_CAP, loadTickerHolders, rankedTickerHolders, type InstData, type TickerHolderRow } from "../src/lib/inst.ts";
import { overlapBand } from "../src/lib/overlap.ts";
import { filerDefaultPeriod } from "../src/lib/data.ts";
import { priorPeriodOf, surfaceHtml } from "../src/lib/holdings.ts";
import type { QoqDeltaRow } from "../src/lib/inst.ts";
import { filerPayload, nRows } from "./fixtures/institutional.ts";
import { makeDom } from "./lib/fake-dom.ts";

const DASH = path.resolve(import.meta.dirname, "..");
const REPO_ROOT = path.resolve(DASH, "..");
const SRC = path.join(DASH, "src");
const src = (rel: string): string => readFileSync(path.join(SRC, rel), "utf-8");

function txn(over: Partial<TxnRow> = {}): TxnRow {
  return {
    kind: "txn", txnId: "t-1", asset: null, assetType: null,
    filed: "2026-07-21", traded: "2026-06-24", name: "Test Member",
    bioguide: "T000001", party: "R", state: "OK", district: null,
    chamber: "senate", ticker: "WMB", side: "purchase", owner: "self",
    low: 1001, high: 15000, lag: 27, late: 0, flags: [],
    doc: "https://efdsearch.senate.gov/x", ...over,
  };
}

/* ---------- F1: the member "Net flow · 12m" stat nets sales against purchases ---------- */

const STAMPS = { buildId: "t.1", generatedAt: "2026-08-12 00:00 UTC", generatedAtDate: "2026-08-12" };
const CTX: RenderCtx = { watched: new Set() };

function member(txns: TxnRow[]): MemberEntity {
  return {
    bioguide: "T000001", name: "Test Member", party: "R", state: "OK",
    district: null, chamber: "senate", servingSince: "2015", filingCount: 1, txns, paper: [],
  };
}

function netTile(html: string): string {
  const m = /<dt>Net flow · 12m<\/dt><dd>([^<]*)<\/dd>/.exec(html);
  assert.ok(m, "the member page states a Net flow · 12m stat");
  return m![1]!;
}

test("F1: a sale-only member's Net flow is negative — never the gross sum of the sale", () => {
  const sale = txn({ txnId: "s", side: "sale", low: 15001, high: 50000 });
  const dd = netTile(memberBody(member([sale]), STAMPS, CTX, 0));
  assert.equal(dd, netIntervalText(netFlow(sumRanges([]), sumRanges([sale]))), "the ONE net arithmetic");
  assert.match(dd, /−/, "a disposal reads negative");
  assert.notEqual(dd, "$15K–$50K", "the old tile summed the sale as a positive flow");
});

test("F1: mixed purchases and sales net as [pL−sU, pU−sL]", () => {
  const buy = txn({ txnId: "b", side: "purchase", low: 1001, high: 15000 });
  const sell = txn({ txnId: "s", side: "sale_partial", low: 15001, high: 50000 });
  const dd = netTile(memberBody(member([buy, sell]), STAMPS, CTX, 0));
  assert.equal(dd, netIntervalText(netFlow(sumRanges([buy]), sumRanges([sell]))));
});

/* ---------- serving fixture shared by F2 / F3 ---------- */

const SCHEMA = (() => {
  const py = readFileSync(path.join(REPO_ROOT, "src", "populus", "inst_serving.py"), "utf-8");
  const m = py.match(/SERVING_SCHEMA = """([\s\S]*?)"""/);
  assert.ok(m, "the producer's DDL is where the dashboard expects it");
  return m![1]!;
})();

function servingDb(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec(SCHEMA);
  db.prepare(
    `INSERT INTO serving_filings (filing_key, accession, submission_type, period_of_report,
       filed_date, doc_url, source) VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(1, "0000000000-26-000001", "13F-HR", "2026-03-31", "2026-05-15", null, "sec-edgar");
  const row = db.prepare(
    `INSERT INTO serving_filer_rows (cik, period, filing_key, security_id, cusip, issuer_name,
       title_of_class, value_usd, shares, ssh_type, put_call, position_key,
       put_call_bucket, unit_key, flags)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  row.run("0001067983", "2026-03-31", 1, "sec:aapl", "037833100", "APPLE INC", "COM", 900, 5, "SH", "LONG", "sid:sec:aapl", "LONG", "SH", "[]");
  row.run("0001067983", "2026-03-31", 1, null, "594918104", "MICROSOFT CORP", "COM", 100, 1, "SH", "LONG", "cusip:594918104", "LONG", "SH", "[]");
  return db;
}

function delta(): QoqDeltaRow {
  return {
    cik: "0001067983", position_key: "sid:sec:aapl", put_call: "LONG",
    curr_period: "2026-03-31", prev_period: "2025-12-31", change_kind: "add",
    prev_value_usd: 700, curr_value_usd: 900, delta_value_usd: 200,
    prev_shares: 4, curr_shares: 5, delta_shares: 1, ssh_prnamt_type: "SH", flags: [],
  };
}

function agg(over: Partial<FilerAggregateInputs> = {}): FilerAggregateInputs {
  return {
    concByPeriod: { "2026-03-31": null },
    deltasByPeriod: { "2026-03-31": [delta()] },
    deltaTotalsByPeriod: { "2026-03-31": 5 },
    latestFiled: "2026-05-15",
    topn: 25,
    window: null,
    kindsByPeriod: { "2026-03-31": { new: 2, exit: 1 } },
    discontinuityPeriods: ["2026-03-31"],
    typing: {
      cik: "0001067983", display_name: "Berkshire Hathaway", person: "Warren Buffett",
      manager_type: "hedge_fund" as never, notable: true,
    },
    ...over,
  };
}

function assemble(withTicker: boolean, a: FilerAggregateInputs = agg()) {
  const db = servingDb();
  return assembleFilerPayload(db, {
    cik: "0001067983",
    filerName: "BERKSHIRE HATHAWAY INC",
    latestPeriod: "2026-03-31",
    requestedPeriod: "2026-03-31",
    filings: readServingFilings(db),
    agg: a,
    ...(withTicker
      ? { tickerFor: (n: string, c: string | null) => (n === "APPLE INC" && c === "COM" ? { ticker: "AAPL", verified_date: "2026-09-10" } : null) }
      : {}),
  });
}

/* ---------- F2: reviewed tickers survive the tail transport ---------- */

test("F2: a reviewed ticker survives fragmenting, reassembly and strict validation", () => {
  const payload = assemble(true);
  const back = reassembleFilerFragments(fragmentFilerPayload(payload), payload.cik);
  const rows = back.rowsByPeriod["2026-03-31"]!;
  const apple = rows.find((r) => r.issuer_name === "APPLE INC")!;
  assert.equal(apple.ticker, "AAPL");
  assert.equal(apple.ticker_verified_date, "2026-09-10", "the ⓘ keeps its verification date");
  assert.equal(rows.find((r) => r.issuer_name === "MICROSOFT CORP")!.ticker, undefined, "an unreviewed row ships no ticker");
  assert.deepEqual(parseFilerPayload(JSON.parse(JSON.stringify(payload))), back, "the JSON path agrees");
});

test("F2: the tail assembler is handed the SAME reviewed-ticker lookup as the pre-rendered page", () => {
  const data = src("lib/data.ts");
  const tail = data.slice(data.indexOf("for (const f of tail)"), data.indexOf("fragmentFilerPayload(payload)"));
  assert.match(tail, /tickerFor: \(name, cls\) => tickerFor\(build\.inst, name, cls\)/);
});

/* ---------- F3: kinds, discontinuity and typing ride the tail payload ---------- */

test("F3: kindsByPeriod, discontinuityPeriods and typing survive the v2 fragment transport", () => {
  const payload = assemble(false);
  const back = reassembleFilerFragments(fragmentFilerPayload(payload), payload.cik);
  assert.deepEqual(back.kindsByPeriod, { "2026-03-31": { new: 2, exit: 1 } }, "counts from BEFORE the bound");
  assert.deepEqual(back.discontinuityPeriods, ["2026-03-31"]);
  assert.equal(back.typing?.display_name, "Berkshire Hathaway");
  assert.equal(back.typing?.person, "Warren Buffett");
});

test("F3: the strict validator rejects contradictory or foreign stat inputs", () => {
  const good = JSON.parse(JSON.stringify(assemble(false))) as Record<string, unknown>;
  const over = structuredClone(good);
  (over.kindsByPeriod as Record<string, { new: number }>)["2026-03-31"]!.new = 10;
  assert.throws(() => parseFilerPayload(over), /kindsByPeriod.*more changes than deltaTotalsByPeriod/);
  const foreign = structuredClone(good);
  (foreign.typing as Record<string, unknown>).cik = "0000000042";
  assert.throws(() => parseFilerPayload(foreign), /typing\.cik/);
  const noTyping = structuredClone(good);
  delete noTyping.typing;
  assert.throws(() => parseFilerPayload(noTyping), /typing/);
});

test("F3: the /e/ driver passes the stat, banner and identity inputs; the producer counts before the bound", () => {
  const client = src("scripts/entity-client.ts");
  assert.match(client, /discontinuity: p\.discontinuityPeriods\.includes\(aggPeriod\)/);
  assert.match(client, /kinds: p\.kindsByPeriod\[aggPeriod\] \?\? null/);
  assert.match(client, /typing: p\.typing/);
  assert.match(src("lib/data.ts"), /kindsByPeriod: Object\.fromEntries\(\s*full\.map/, "counted over the UNBOUNDED changes");
});

/* ---------- F4: /e/ binds the Position changes disclosure after every render ---------- */

test("F4: the /e/ route wires the DOM-disclosure binder and the driver re-announces each render", () => {
  const page = src("pages/e/index.astro");
  assert.ok(page.indexOf("initDomDisclosures()") >= 0, "the /e/ page binds DOM-backed disclosures");
  assert.ok(page.indexOf("initDomDisclosures()") < page.indexOf("runGenericRoute()"), "bound before the first render");
  const client = src("scripts/entity-client.ts");
  const render = client.slice(client.indexOf("function renderFiler"), client.indexOf("function maxPage"));
  assert.match(render, /populus:rerender/, "renderFiler dispatches the re-bind event");
});

/* ---------- F5: a stale part response never overwrites a filtered view ---------- */

const FEED_IDS = [
  "congress-feed", "feed-tbody", "feed", "feed-loading", "feed-empty",
  "feed-empty-detail", "feed-empty-suggestions", "filter-count-line",
  "pager-range", "feed-status", "filter-reset", "filter-reset-wrap",
  "pager-newer", "pager-older", "feed-parts-index", "filter-q",
];

test("F5: switching to a filtered view invalidates a part request still in flight", async () => {
  const { planFeedParts, feedPartHref } = await import("../src/lib/feed-parts.ts");
  const rows = Array.from({ length: 120 }, (_, i) =>
    txn({ txnId: `t-${i}`, ticker: `T${i}X`, filed: "2026-08-01", name: i === 5 ? "Needle Member" : "Hay Member" }),
  );
  const plan = planFeedParts(mergeFeed(rows, []), { build_id: "b", generated_at: null });
  const dom = makeDom(FEED_IDS);
  dom.elements.get("congress-feed")!.dataset = { txnCount: String(rows.length) };
  dom.elements.get("feed-parts-index")!.textContent = JSON.stringify(plan.index);
  let releasePart!: () => void;
  const partGate = new Promise<void>((r) => (releasePart = r));
  const restore = dom.install((url: string) => {
    const m = /\/congress\/data\/feed\/(.+)\.v1\.json$/.exec(url);
    if (m) return partGate.then(() => JSON.parse(plan.bodies.get(decodeURIComponent(m[1]!))!));
    return {
      dataset_version: DATASET_VERSION, build_id: "b", generated_at: "2026-08-12 00:00 UTC", data_note: "",
      txn_cols: TXN_COLS, paper_cols: PAPER_COLS, txns: rows.map(txnToArray), paper: [],
    };
  });
  const g = globalThis as Record<string, unknown>;
  const priorEls = { HTMLElement: g.HTMLElement, HTMLButtonElement: g.HTMLButtonElement };
  g.HTMLElement = class {};
  g.HTMLButtonElement = class {};
  try {
    const { initFeed } = await import("../src/scripts/feed-client.ts");
    initFeed({ onRows: () => {} });
    dom.elements.get("pager-older")!.click(); // page 2: a part request, held open
    await dom.flush();
    assert.deepEqual(dom.fetchCalls, [feedPartHref(plan.index.parts[0]!.part)]);
    const q = dom.elements.get("filter-q")!;
    q.value = "Needle";
    for (const fn of q.listeners.get("input") ?? []) fn({ target: q });
    await dom.flush();
    await dom.flush();
    const filtered = dom.elements.get("feed-tbody")!.innerHTML;
    assert.equal((filtered.match(/<tr\b/g) ?? []).length, 1, "the filter matched one row");
    releasePart(); // the stale page-2 part now resolves
    await dom.flush();
    await dom.flush();
    const after = dom.elements.get("feed-tbody")!.innerHTML;
    assert.equal(after, filtered, "the late part response must not overwrite the filtered rows");
    assert.doesNotMatch(after, />T50X</, "page 2 of the unfiltered feed never lands");
  } finally {
    g.HTMLElement = priorEls.HTMLElement;
    g.HTMLButtonElement = priorEls.HTMLButtonElement;
    restore();
  }
});

/* ---------- F7 / F8: holder population and the overlap timeline ---------- */

function holder(over: Partial<TickerHolderRow> = {}): TickerHolderRow {
  return {
    ticker: "NVDA", period_of_report: "2026-03-31", rank: 1, cik: "0000000001", filer_name: "ALPHA",
    value_usd: 1_000, shares: 10, prev_shares: 5, delta_shares: 5, change_kind: "add",
    method: "exact-name", verified_date: "2026-09-10", filed_date: "2026-05-10", ...over,
  };
}

function instWith(holders: TickerHolderRow[]): InstData {
  return {
    present: true,
    tickerTotals: new Map([["NVDA", {
      ticker: "NVDA", period_of_report: "2026-03-31", prev_period: "2025-12-31", issuer_name: "NVIDIA CORP",
      title_of_class: "COM", holder_count: 700, value_usd: 1, adds: 1, exits: 1,
    }]]),
    tickerHoldersByTicker: new Map([["NVDA", holders]]),
  } as unknown as InstData;
}

test("F7: the ranked holder list is ranks 1..cap; notable rows past the cap stay out of it", () => {
  const inst = instWith([
    holder({ rank: 1, cik: "0000000001" }),
    holder({ rank: 2, cik: "0000000002" }),
    holder({ rank: 612, cik: "0000000003" }), // a notable manager kept past the cap
    holder({ rank: 1, cik: "0000000001", period_of_report: "2026-06-30" }),
  ]);
  assert.deepEqual(rankedTickerHolders(inst, "NVDA", "2026-03-31").map((h) => h.rank), [1, 2]);
});

test("F11: a notable manager kept at rank cap+1 is NOT in the ranked list, and IS in the overlap band", () => {
  // Ranks 1..cap fill the display list; the notable manager sits immediately
  // after it, so the ranks stay contiguous — continuity must not admit it.
  const full = Array.from({ length: TICKER_HOLDERS_RANK_CAP }, (_, i) =>
    holder({ rank: i + 1, cik: String(1000 + i).padStart(10, "0"), change_kind: "trim", delta_shares: -1 }),
  );
  const notableCik = "0000000777";
  const inst = instWith([...full, holder({ rank: TICKER_HOLDERS_RANK_CAP + 1, cik: notableCik, change_kind: "add", value_usd: 1 })]);
  const ranked = rankedTickerHolders(inst, "NVDA", "2026-03-31");
  assert.equal(ranked.length, TICKER_HOLDERS_RANK_CAP, "the display list stops at the cap");
  assert.ok(!ranked.some((h) => h.cik === notableCik), "the retained notable row is not rendered in the capped list");
  const band = overlapBand({
    ticker: "NVDA", txns: [], generatedAtDate: "2026-06-01", inst,
    typingByCik: new Map([[notableCik, { cik: notableCik, display_name: "Gamma Capital", person: null, manager_type: "hedge_fund" as never, notable: true }]]),
    period: "2026-03-31", ctx: CTX, filerHref: (cik) => `/f/${cik}`,
  });
  assert.deepEqual(band.inst!.adding.map((m) => m.cik), [notableCik], "the overlap band still counts it");
});

test("F11: the TS display cap MIRRORS inst_agg.py — no second source", () => {
  const py = readFileSync(path.join(REPO_ROOT, "src", "populus", "inst_agg.py"), "utf-8");
  const m = /^TICKER_HOLDERS_RANK_CAP = ([0-9_]+)$/m.exec(py);
  assert.ok(m, "the producer declares the cap");
  assert.equal(TICKER_HOLDERS_RANK_CAP, Number(m![1]!.replace(/_/g, "")));
});

test("F8: the overlap timeline dates a 13F move by its FILED date and orders it among Congress filings", () => {
  const typing = (cik: string, name: string) => ({ cik, display_name: name, person: null, manager_type: "hedge_fund" as never, notable: true });
  const inst = instWith([
    holder({ rank: 1, cik: "0000000001", change_kind: "add", filed_date: "2026-05-10" }),
    holder({ rank: 2, cik: "0000000002", change_kind: "exit", value_usd: null, filed_date: null }),
  ]);
  const band = overlapBand({
    ticker: "NVDA",
    txns: [
      txn({ txnId: "late", filed: "2026-05-12", side: "purchase", name: "Late Filer", bioguide: "L000001" }),
      txn({ txnId: "early", filed: "2026-05-01", side: "sale", name: "Early Filer", bioguide: "E000001" }),
    ],
    generatedAtDate: "2026-06-01",
    inst,
    typingByCik: new Map([["0000000001", typing("0000000001", "Alpha Capital")], ["0000000002", typing("0000000002", "Beta Capital")]]),
    period: "2026-03-31",
    ctx: CTX,
    filerHref: (cik) => `/f/${cik}`,
  });
  assert.deepEqual(band.timeline.map((r) => [r.date, r.side]), [
    ["2026-05-12", "congress"],
    ["2026-05-10", "13f"],
    ["2026-05-01", "congress"],
  ], "the 13F row sits at its filed date, not at the 2026-03-31 quarter end");
  assert.ok(!band.timeline.some((r) => r.date === "2026-03-31"), "no row is dated at quarter end");
  assert.ok(band.inst!.trimming.some((m) => m.cik === "0000000002"), "a mover with no filed date stays in the band");
});

test("F8: loadTickerHolders reads filed_date, and an older aggregate without the column reads null", () => {
  const make = (withCol: boolean): DatabaseSync => {
    const db = new DatabaseSync(":memory:");
    db.exec(`CREATE TABLE agg_ticker_holder_totals (ticker TEXT, period_of_report TEXT, prev_period TEXT,
               issuer_name TEXT, title_of_class TEXT, holder_count INTEGER, value_usd INTEGER, adds INTEGER, exits INTEGER);
             CREATE TABLE agg_ticker_holders (ticker TEXT, period_of_report TEXT, rank INTEGER, cik TEXT, filer_name TEXT,
               value_usd INTEGER, shares INTEGER, prev_shares INTEGER, delta_shares INTEGER, change_kind TEXT,
               method TEXT, verified_date TEXT${withCol ? ", filed_date TEXT" : ""});
             INSERT INTO agg_ticker_holder_totals VALUES ('AAPL','2026-03-31','2025-12-31','APPLE INC','COM',1,100,0,0);
             INSERT INTO agg_ticker_holders VALUES ('AAPL','2026-03-31',1,'0001067983','BERKSHIRE',100,10,10,0,'held','exact-name','2026-09-10'${withCol ? ",'2026-05-15'" : ""});`);
    return db;
  };
  assert.equal(loadTickerHolders(make(true)).tickerHoldersByTicker.get("AAPL")![0]!.filed_date, "2026-05-15");
  assert.equal(loadTickerHolders(make(false)).tickerHoldersByTicker.get("AAPL")![0]!.filed_date, null);
});

/* ---------- F9: a filer page opens on the landing's closed quarter ---------- */

function build(latestFiled: string): Parameters<typeof filerDefaultPeriod>[0] {
  return {
    generatedAtDate: "2026-09-11",
    inst: { present: true, watermarks: { latest_filed_date: latestFiled } },
  } as unknown as Parameters<typeof filerDefaultPeriod>[0];
}

test("F9: the default is the newest CLOSED quarter the filer has — never an open one", () => {
  const periods = ["2025-12-31", "2026-03-31", "2026-06-30"];
  // The corpus's newest filing is 2026-07-31: June's window (deadline 2026-08-14) is still open.
  assert.equal(filerDefaultPeriod(build("2026-07-31"), periods), "2026-03-31");
  assert.equal(filerDefaultPeriod(build("2026-08-20"), periods), "2026-06-30", "closed once the corpus passes the deadline");
  assert.equal(filerDefaultPeriod(build("2026-07-31"), ["2026-06-30"]), "2026-06-30", "no closed quarter: its newest period");
});

test("F9: both filer routes read the shared default", () => {
  assert.match(src("pages/institutional/filers/[cik].astro"), /const period = filerDefaultPeriod\(build, periods\)/);
  assert.match(src("lib/data.ts"), /requestedPeriod: filerDefaultPeriod\(build, filerPeriods\(inst, f\.cik\)\)/);
});

/* ---------- F10: the comparison follows the selected quarter ---------- */

function threeQuarters() {
  const rowsByPeriod = {
    "2025-09-30": nRows(1, "2025-09-30"),
    "2025-12-31": nRows(2, "2025-12-31"),
    "2026-03-31": nRows(3, "2026-03-31"),
  };
  return filerPayload({
    periods: ["2025-09-30", "2025-12-31", "2026-03-31"],
    rowsByPeriod,
    totalsByPeriod: { "2025-09-30": 1, "2025-12-31": 2, "2026-03-31": 3 },
  });
}

test("F10: priorPeriodOf is the immediate predecessor in the published list", () => {
  const periods = ["2025-09-30", "2025-12-31", "2026-03-31"];
  assert.equal(priorPeriodOf(periods, "2026-03-31"), "2025-12-31");
  assert.equal(priorPeriodOf(periods, "2025-12-31"), "2025-09-30");
  assert.equal(priorPeriodOf(periods, "2025-09-30"), null);
});

test("F10: selecting an older quarter compares it with ITS predecessor, not the load-time pair", () => {
  const html = surfaceHtml(threeQuarters(), { view: "diff", page: 0, period: "2025-12-31", selected: "2025-12-31" });
  assert.match(html, /positions 2025-12-31/, "the selected quarter leads the view chips");
  assert.match(html, /positions 2025-09-30/, "its predecessor is the comparison side");
  /* The <noscript> note deliberately names the load-time quarter: without JS the
     page shows exactly that. Everything else — chips, headings, the diff — must
     not involve it. */
  const rendered = html.replace(/<noscript>[\s\S]*?<\/noscript>/g, "");
  assert.doesNotMatch(rendered, /2026-03-31/, "the load-time current quarter is not part of this comparison");
  const prior = surfaceHtml(threeQuarters(), { view: "prior", page: 0, period: "2025-09-30", selected: "2025-12-31" });
  assert.match(prior, /2025-09-30/);
});

test("F10: both clients carry the selection into the view switch", () => {
  for (const rel of ["components/HoldingsTable.astro", "scripts/entity-client.ts"]) {
    assert.match(src(rel), /priorPeriodOf\(/, `${rel} resolves the predecessor of the selection`);
  }
});
