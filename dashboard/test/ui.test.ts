/* Renderer semantics: state blocks S1–S7 with their exact honest copy, the
   flow ribbon's C1–C7 obligations, table semantics (caption + th scope), the
   Locked #20 institutional stamp + caveat, terminus attribution, NULL-vs-0
   for every institutional integer, XSS-escape under hostile fixtures. */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  flowRibbon,
  entityTxnTable,
  memberStatTiles,
  memberPaperBlock,
  instStamp,
  INST_STAMP_CAVEAT,
  s1ModuleAbsent,
  s2OutOfExtract,
  s4Skeleton,
  s4Error,
  s7Banner,
  specimenCard,
  pickSpecimen,
  moduleCard,
  holdersTableHtml,
  changesTableHtml,
  qoqChipHtml,
  flowCellHtml,
  breadcrumb,
  QOQ_FOOTNOTES,
  type BuildStamps,
} from "../src/lib/ui.ts";
import { quarterlyFlow, sumRanges } from "../src/lib/derive.ts";
import type { MemberEntity } from "../src/lib/derive.ts";
import type { QoqDeltaRow, TopHolderRow } from "../src/lib/inst.ts";
import { type TxnRow, type RenderCtx } from "../src/lib/format.ts";

const CTX: RenderCtx = { watched: new Set() };
const STAMPS: BuildStamps = {
  buildId: "20260724.3",
  generatedAt: "2026-07-24 06:56 UTC",
  generatedAtDate: "2026-07-24",
};

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

function holder(over: Partial<TopHolderRow> = {}): TopHolderRow {
  return {
    issuer_key: "entity:cik:0000320193",
    period_of_report: "2026-03-31",
    rank: 1,
    cik: "0001067983",
    filer_name: "BERKSHIRE HATHAWAY INC",
    issuer_name: "APPLE INC",
    issuer_key_source: "entity",
    value_usd: 2000,
    security_count: 1,
    flags: [],
    ...over,
  };
}

function qoq(over: Partial<QoqDeltaRow> = {}): QoqDeltaRow {
  return {
    cik: "0001067983",
    position_key: "sid:sec:aapl",
    put_call: "LONG",
    curr_period: "2026-03-31",
    prev_period: "2025-12-31",
    change_kind: "add",
    prev_value_usd: 1000,
    curr_value_usd: 2000,
    delta_value_usd: 1000,
    prev_shares: 100,
    curr_shares: 150,
    delta_shares: 50,
    ssh_prnamt_type: "SH",
    flags: [],
    ...over,
  };
}

/* ---------- flow ribbon (C1–C7) ---------- */

test("flowRibbon: zero-based bars, gaps stay gaps, sr-only summary, hatch caption", () => {
  const flow = quarterlyFlow(
    [
      txn({ traded: "2026-06-01" }),
      txn({ traded: "2026-05-01", low: null, high: null }), // unparsed → hatch
      txn({ traded: "2025-11-01", side: "sale" }),
    ],
    "2026-07-24",
    8,
  );
  const html = flowRibbon(flow, { twoSided: false, sourceLine: "source: test" });
  assert.ok(html.includes("rb-hatch"), "unparsed amounts hatch, never a solid bar");
  assert.ok(html.includes("50%"), "count-based hatch caption: 1 of 2 rows unparsed");
  assert.ok(html.includes("gaps are gaps"), "no interpolation is stated");
  assert.ok(html.includes("y from $0"), "zero-based axis is stated");
  assert.ok(html.includes("visually-hidden"), "sr-only summary exists");
  assert.ok(html.includes("purchases"), "summary names both sides");
  assert.ok(html.includes("no midpoints"), "the caption states the no-midpoints rule");
  const two = flowRibbon(flow, { twoSided: true, sourceLine: "source: test" });
  assert.ok(two.includes("ribbon-two"), "two-sided variant for the deep ticker view");
  assert.ok(two.includes("rb-axis"));
});

test("flowRibbon: an all-unparsed quarter hatches full-height, never $0+", () => {
  const flow = quarterlyFlow([txn({ traded: "2026-06-01", low: null, high: null })], "2026-07-24", 4);
  const html = flowRibbon(flow, { twoSided: false, sourceLine: "s" });
  assert.ok(html.includes('height:100%"'), "undisclosed quarter renders the full-height hatch");
  assert.ok(!html.includes("$0+"), "no fabricated $0+ bound in the ribbon");
  assert.ok(!html.includes("Over $0,"), "no fabricated open-zero range in the summary");
});

/* ---------- tables (R16) ---------- */

test("entityTxnTable: real table semantics — caption, th scope, honesty cells", () => {
  const html = entityTxnTable([txn(), txn({ late: 1, lag: 55 })], {
    kind: "member",
    caption: "All disclosed transactions for Test",
    page: 0,
    ctx: CTX,
  });
  assert.ok(html.includes("<caption"), "caption present");
  assert.ok(html.includes('<th scope="col">'), "th scope present");
  assert.ok(html.includes("Traded · Lag"));
  assert.ok(html.includes("LATE·55d"), "LATE chip past 45d");
  assert.ok(html.includes("visually-hidden"), "dual dates keep the a11y-tree text");
  assert.ok(html.includes("mobile-dates"), "fold string present in markup at every viewport");
  assert.ok(html.includes("v_default_transactions"), "exclusions footnote names the view");
  assert.ok(html.includes("aria-live"), "count changes announce");
});

test("entityTxnTable: ticker variant carries member identity + affiliation words", () => {
  const html = entityTxnTable([txn({ party: "D", state: "CA", district: "11", chamber: "house" })], {
    kind: "ticker",
    caption: "x",
    page: 0,
    ctx: CTX,
  });
  assert.ok(html.includes("D–CA-11"), "party is word-accompanied, never color alone");
});

/* ---------- member pieces ---------- */

function member(over: Partial<MemberEntity> = {}): MemberEntity {
  return {
    bioguide: "T000001",
    name: "Test Member",
    party: "R",
    state: "OK",
    district: null,
    chamber: "senate",
    servingSince: "1987",
    filingCount: 5,
    txns: [txn(), txn({ low: 1_000_001, high: null, flags: ["amount_spouse_cap"] })],
    paper: [],
    ...over,
  };
}

test("memberStatTiles: T12M flow is a RANGE; median lag; late count", () => {
  const tiles = memberStatTiles(member(), STAMPS);
  const flow = tiles.find((t) => t.label.includes("disclosed flow"))!;
  assert.ok(flow.value.startsWith("Over $"), "open cap keeps the sum an open range");
  assert.ok(tiles.find((t) => t.label === "median lag")!.value.startsWith("+"));
  assert.equal(tiles.find((t) => t.label === "filings incl. 0 paper")!.value, "5");
});

test("memberPaperBlock (S5): retained-and-counted copy + table semantics; absent when no paper", () => {
  const withPaper = memberPaperBlock(
    member({
      paper: [
        {
          kind: "paper",
          filed: "2026-07-17",
          name: "Test Member",
          bioguide: "T000001",
          party: "R",
          state: "OK",
          district: null,
          chamber: "senate",
          doc: "https://efdsearch.senate.gov/search/view/paper/xyz/",
        },
      ],
    }),
  );
  assert.ok(withPaper.includes("retained and counted"));
  assert.ok(withPaper.includes("needs OCR"));
  assert.ok(withPaper.includes("<caption"));
  assert.equal(memberPaperBlock(member()), "", "no block when the member has no paper filings");
});

/* ---------- institutional stamp (Locked #20) ---------- */

test("instStamp: quarter-end + build filed-date watermark; caveat text is fixed", () => {
  const html = instStamp("2026-03-31", "2026-05-15");
  assert.ok(html.includes("quarter-end 2026-03-31"));
  assert.ok(html.includes("latest filing in build filed 2026-05-15"));
  assert.ok(!html.toLowerCase().includes("current holdings"));
  const noWm = instStamp("2026-03-31", null);
  assert.ok(noWm.includes("not recorded"), "a null watermark states itself");
  assert.ok(INST_STAMP_CAVEAT.includes("not in the published aggregate"));
});

/* ---------- holders table (R6) ---------- */

test("holdersTableHtml: exactly the published columns — no Shares/Filed/Lag/doc-link", () => {
  const html = holdersTableHtml([holder()], "2026-03-31", "2026-05-15", 25);
  assert.ok(html.includes(">Filer<"));
  assert.ok(html.includes(">Value ▾<"));
  assert.ok(html.includes(">Securities<"));
  assert.ok(html.includes(">Issuer key<"));
  assert.ok(!html.includes(">Shares<"), "per-holder shares are not in the published aggregate");
  assert.ok(!/<th[^>]*>Filed<\/th>/.test(html), "per-holder filed dates are not published");
  assert.ok(!/<th[^>]*>Lag<\/th>/.test(html), "per-holder lags are not published");
  assert.ok(html.includes("derived&nbsp;·§"), "aggregate rows carry the derived receipt");
  assert.ok(html.includes("EDGAR"), "and the real primary-source link");
  assert.ok(html.includes('data-terminus-author="populus"'), "top-N cut attributed to Populus");
  assert.ok(html.includes("quarter-end 2026-03-31"));
  assert.ok(html.includes(INST_STAMP_CAVEAT));
  assert.ok(html.includes(">entity<"), "issuer_key_source disclosed per row");
  assert.ok(html.includes("/institutional/filers/1067983/"), "filer links use the unpadded CIK route");
});

/* ---------- changes table (R7 / Locked #8) ---------- */

test("changesTableHtml: NULL renders em-dash never 0; undisclosed side renders hatched n/c; 0 prints 0", () => {
  const rows = [
    qoq({
      position_key: "cusip:123456789",
      prev_value_usd: null,
      curr_value_usd: 2000,
      delta_value_usd: null,
      prev_shares: null,
      curr_shares: null,
      delta_shares: null,
      flags: ["value_undisclosed_one_side"],
    }),
    qoq({ position_key: "sid:sec:zero", delta_shares: 0, delta_value_usd: 0 }),
  ];
  const html = changesTableHtml(rows, "2026-03-31", "2026-05-15");
  assert.ok(html.includes(">—</td>"), "NULL integer renders an em-dash");
  assert.ok(html.includes('class="nc-chip"'), "undisclosed side renders the hatched n/c");
  assert.ok(html.includes(">0</td>"), "a disclosed zero prints 0");
  assert.ok(html.includes("value undisclosed one side"), "producer flag renders as a tag");
  assert.ok(html.includes("<caption"));
  assert.ok(html.includes(INST_STAMP_CAVEAT));
});

test("qoqChipHtml: markers link to the footnote block; every marker has a printed line", () => {
  const html = qoqChipHtml(qoq({ change_kind: "exit", flags: ["classified_by_value"] }));
  assert.ok(html.includes("‡e"));
  assert.ok(html.includes("†v"));
  assert.ok(html.includes("#filer-footnotes"));
  const marks = new Set(QOQ_FOOTNOTES.map((f) => f.mark));
  for (const m of ["†v", "‡u", "‡r", "‡e", "n/c", "§"]) {
    assert.ok(marks.has(m), `marker ${m} resolves to a printed footnote line`);
  }
});

test("flowCellHtml: undisclosed aggregate renders the hatched chip, not $0+", () => {
  const s = sumRanges([{ low: null, high: null }]);
  const html = flowCellHtml(s);
  assert.ok(html.includes("nc-chip"));
  assert.ok(html.includes("not disclosed"));
});

/* ---------- states ---------- */

test("S1: absent vs withheld-artifact copy; both name the manifest as authority", () => {
  const absent = s1ModuleAbsent("module-absent");
  assert.ok(absent.includes("withheld the institutional module — deliberately"));
  assert.ok(absent.includes("absence is stated instead of simulated"));
  const missing = s1ModuleAbsent("artifact-missing");
  assert.ok(missing.includes("aggregate artifact is not readable"));
  assert.ok(missing.includes("manifest"));
});

test("S2: primary-source CTA per kind — bioguide for members, EDGAR for tickers/filers", () => {
  const m = s2OutOfExtract("m", "Z000001");
  assert.ok(m.includes("bioguide.congress.gov"));
  assert.ok(m.includes("We don't render a page for this member."));
  const t = s2OutOfExtract("t", "ZZZZ");
  assert.ok(t.includes("sec.gov"));
  const f = s2OutOfExtract("f", "0001999999");
  assert.ok(f.includes("sec.gov"));
  assert.ok(f.includes("13F"));
  for (const html of [m, t, f]) {
    assert.ok(html.includes("published budget, not a paywall"));
  }
});

test("S4 skeleton names its endpoint; every error kind has its own honest heading", () => {
  const skel = s4Skeleton("/congress/data/tickers/OUST.v1.json", "/e/ · t:OUST");
  assert.ok(skel.includes("/congress/data/tickers/OUST.v1.json"));
  assert.ok(skel.includes("same-origin fetch · no external calls"));
  const kinds: [string, string, boolean][] = [
    ["server_error", "answered with an error", true],
    ["network_error", "did not complete", true],
    ["bad_payload", "not with a usable record", true],
    ["version_mismatch", "disagree on version", false],
    ["render_error", "failed to draw it", false],
    ["timeout", "taking too long", true],
    ["key_error", "not a valid entity address", false],
  ];
  for (const [kind, phrase, retryable] of kinds) {
    const html = s4Error(kind as never, "/x.json", "Detail.", retryable);
    assert.ok(html.includes(phrase), `${kind} heading`);
    assert.equal(html.includes("data-retry"), retryable, `${kind} retry affordance`);
    assert.ok(html.includes(`data-error-kind="${kind}"`));
    if (kind !== "key_error") assert.ok(html.includes("/x.json"), `${kind} raw endpoint link`);
  }
});

test("S7 banner: calendar facts + provisional-by-construction wording", () => {
  const html = s7Banner({ open: true, quarterEnd: "2026-06-30", deadline: "2026-08-14" });
  assert.ok(html.includes("FILING WINDOW OPEN"));
  assert.ok(html.includes("2026-06-30"));
  assert.ok(html.includes("2026-08-14"));
  assert.ok(html.includes("provisional by construction"));
  assert.ok(html.includes("not zeros"));
  assert.ok(!html.includes("%"), "no expected-filer coverage % — it has no published source");
});

/* ---------- Home pieces ---------- */

test("pickSpecimen + specimenCard: a real closed-range row, both dates, receipt", () => {
  const rows = [
    txn({ low: null, high: null }), // not specimen-worthy
    txn({ traded: "2025-11-22", filed: "2025-12-21", lag: 29, ticker: "NVDA", low: 1_000_001, high: 5_000_000 }),
  ];
  const pick = pickSpecimen(rows)!;
  assert.equal(pick.ticker, "NVDA");
  const html = specimenCard(pick, CTX);
  assert.ok(html.includes("what a number looks like here"));
  assert.ok(html.includes("2025-11-22"));
  assert.ok(html.includes("2025-12-21"));
  assert.ok(html.includes("+29d"));
  assert.ok(html.includes("a range — an exact figure does not exist"));
  assert.ok(html.includes("band-fill"), "the range band draws");
  assert.equal(pickSpecimen([txn({ low: null, high: null, traded: null })]), null);
});

test("moduleCard: live cards link, planned cards do not; stats are caller-derived", () => {
  const live = moduleCard("Congress", "/congress/", "desc", {
    live: true,
    statLines: ["3,911 rows · updated 2026-07-24"],
  });
  assert.ok(live.startsWith("<a"));
  assert.ok(live.includes("LIVE"));
  assert.ok(live.includes("3,911 rows"));
  const planned = moduleCard("Financials", null, "desc", {
    live: false,
    statLines: ["gates published before data"],
  });
  assert.ok(planned.startsWith("<div"));
  assert.ok(planned.includes("PLANNED"));
});

/* ---------- XSS ---------- */

test("hostile strings escape everywhere they can appear", () => {
  const hostile = `<img src=x onerror=alert(1)>"'&`;
  const html = entityTxnTable([txn({ name: hostile, ticker: null })], {
    kind: "ticker",
    caption: hostile,
    page: 0,
    ctx: CTX,
  });
  assert.ok(!html.includes("<img"), "names escape");
  const crumbs = breadcrumb([{ text: hostile }]);
  assert.ok(!crumbs.includes("<img"));
  const holderHtml = holdersTableHtml([holder({ filer_name: hostile })], "2026-03-31", null, 25);
  assert.ok(!holderHtml.includes("<img"));
  const s2 = s2OutOfExtract("t", "AAPL");
  assert.ok(!s2.includes("<script"));
});
