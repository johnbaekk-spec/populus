/* signals-v3 M3, success criterion 4 (Codex code round 1, F1): a ticker page
   renders no PLANNED markup. The Congress ↔ notable-managers overlap band,
   which moved into the Institutional tab, used to carry a "Notable managers
   PLANNED" badge whenever its 13F half could not be read. On the ticker page
   that half now states the absence and its reason in plain words; the
   holders page keeps the badge (the renderer's default).

   Every reading is over the bytes the ticker route composes: `overlapBand` →
   `tickerOverlapHtml` → `tickerUnifiedBody` (deps.overlap), exactly as
   `src/pages/tickers/[ticker].astro` does. */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import { overlapBand, overlapBandHtml, overlapAbsenceText, tickerOverlapHtml, type OverlapInstAbsence } from "../src/lib/overlap.ts";
import { tickerUnifiedBody } from "../src/lib/ui/index.ts";
import type { InstData, TickerHolderRow } from "../src/lib/inst.ts";
import type { RenderCtx, TxnRow } from "../src/lib/format.ts";
import type { TickerInstSection } from "../src/lib/data.ts";

const CTX: RenderCtx = {};
const NOW = "2026-06-01";
const STAMPS = { buildId: "b", generatedAt: "2026-06-01 06:00 UTC", generatedAtDate: NOW };
const HREF = (cik: string): string => `/f/${cik}`;

const ROW: TxnRow = {
  kind: "txn", txnId: "t-1", asset: null, assetType: null, filed: "2026-05-20", traded: "2026-05-01", name: "Fixture Member",
  bioguide: "F000001", party: "D", state: "CA", district: "11", chamber: "house", ticker: "ZZZZ", side: "purchase", owner: null,
  low: 1001, high: 15000, lag: 19, late: 0, flags: [], doc: "https://disclosures-clerk.house.gov/x.pdf",
};

function holder(over: Partial<TickerHolderRow> = {}): TickerHolderRow {
  return {
    ticker: "NVDA", period_of_report: "2026-03-31", rank: 1, cik: "0000000001", filer_name: "ALPHA CAPITAL", value_usd: 1_000_000,
    shares: 100, prev_shares: 50, delta_shares: 50, change_kind: "add", method: "exact-name", verified_date: "2026-09-10", filed_date: "2026-05-15",
    ...over,
  };
}

/** A present module whose reviewed mapping names NVDA only. */
function instPresent(): Extract<InstData, { present: true }> {
  return {
    present: true,
    watermarks: { latest_period_of_report: "2026-03-31", latest_filed_date: "2026-05-20" },
    topn: 25, filers: [], deltasByCik: new Map(), concentrationByCik: new Map(), holdersByIssuer: new Map(),
    addsByPeriodMode: new Map(), addsExclusions: new Map(), addsPeriods: [],
    typingByCik: new Map([["0000000001", { cik: "0000000001", display_name: "Alpha Capital", person: null, manager_type: "hedge_fund", notable: true }]]),
    bookDiscontinuityByCik: new Map(),
    tickerTotals: new Map([["NVDA", { ticker: "NVDA", period_of_report: "2026-03-31", prev_period: "2025-12-31", issuer_name: "NVIDIA CORP", title_of_class: "COM", holder_count: 1, value_usd: 1, adds: 1, exits: 0 }]]),
    tickerHoldersByTicker: new Map([["NVDA", [holder()]]]),
    tickerByKey: new Map(),
  } as unknown as Extract<InstData, { present: true }>;
}

interface Case {
  why: OverlapInstAbsence;
  ticker: string;
  inst: InstData;
  period: string | null;
}

const CASES: Case[] = [
  { why: "unmapped", ticker: "ZZZZ", inst: instPresent(), period: "2026-03-31" },
  { why: "no-closed-quarter", ticker: "NVDA", inst: instPresent(), period: null },
  { why: "module-absent", ticker: "ZZZZ", inst: { present: false, reason: "module-absent" }, period: null },
  { why: "artifact-missing", ticker: "ZZZZ", inst: { present: false, reason: "artifact-missing" }, period: null },
];

function bandOf(c: Case) {
  return overlapBand({
    ticker: c.ticker, txns: [{ ...ROW, ticker: c.ticker }], generatedAtDate: NOW, inst: c.inst,
    typingByCik: c.inst.present ? c.inst.typingByCik : new Map(), period: c.period, ctx: CTX, filerHref: HREF,
  });
}

/** The ticker body exactly as the route composes it. */
function tickerBody(c: Case, overlapHtml: string, section: TickerInstSection = { state: "unmapped" }): string {
  return tickerUnifiedBody({ ticker: c.ticker, txns: [{ ...ROW, ticker: c.ticker }] }, section, STAMPS, CTX, { fullTable: false }, { overlap: overlapHtml, crowding: null, committees: null });
}

/** The markup criterion 4 forbids on a ticker page. */
function plannedMarkup(html: string): string[] {
  return ["PLANNED", "badge-planned", "overlap-planned", "planned-line"].filter((s) => html.includes(s));
}

test("F1: the band names WHY its 13F half cannot be read, one reason per state the code knows", () => {
  for (const c of CASES) {
    const band = bandOf(c);
    assert.equal(band.inst, null, `${c.why}: no 13F half`);
    assert.equal(band.instAbsence, c.why, `${c.why}: the reason`);
  }
  const mapped = bandOf({ why: "unmapped", ticker: "NVDA", inst: instPresent(), period: "2026-03-31" });
  assert.ok(mapped.inst, "a mapped ticker in a closed quarter reads its 13F half");
  assert.equal(mapped.instAbsence, null, "and states no absence");
});

test("F1 / criterion 4: on the ticker page the absent notable-manager side is a plain absence statement with its reason, and no PLANNED markup", () => {
  for (const c of CASES) {
    const html = tickerBody(c, tickerOverlapHtml(bandOf(c), CTX, HREF));
    assert.deepEqual(plannedMarkup(html), [], `${c.why}: no PLANNED markup on the ticker body`);
    // the absence is still stated — never dropped
    const statement = overlapAbsenceText(c.ticker, c.why);
    assert.ok(html.includes(statement.replace(/'/g, "&#39;")), `${c.why}: the statement "${statement}" is on the page`);
    assert.match(html, new RegExp(`<div class="overlap-half overlap-inst" data-absent="${c.why}"><h3 class="section-h">Notable managers</h3>`), `${c.why}: the half keeps its heading`);
    // the statement sits in the Institutional tab panel, with the Congress half beside it
    const panel = html.indexOf('id="institutional"');
    assert.ok(panel >= 0 && html.indexOf(`data-absent="${c.why}"`) > panel, `${c.why}: inside #institutional`);
    assert.match(html, /overlap-half overlap-congress/, `${c.why}: the Congress half still ships`);
    // the mapping link appears exactly when the reason is the mapping
    assert.equal(html.includes('href="/methodology/#ticker-mapping"'), c.why === "unmapped", `${c.why}: the mapping link`);
  }
});

test("F1: each reason reads as what the code knows — mapping, closed quarter, module, aggregate", () => {
  assert.match(overlapAbsenceText("ZZZZ", "unmapped"), /^Not available for ZZZZ: the reviewed 13F name-and-class mapping does not name this ticker yet/);
  assert.match(overlapAbsenceText("NVDA", "no-closed-quarter"), /no closed 13F quarter/);
  assert.match(overlapAbsenceText("ZZZZ", "module-absent"), /does not include the institutional \(13F\) module/);
  assert.match(overlapAbsenceText("ZZZZ", "artifact-missing"), /aggregate is missing/);
});

test("F1 control: the holders page's band carries no badge either, and the ticker-body reading catches a planted one", () => {
  const c = CASES[0]!;
  assert.deepEqual(plannedMarkup(overlapBandHtml(bandOf(c), CTX, HREF)), [], "launch polish: no PLANNED badge on any page");
  // plant the defect on the ticker body: the reading must flag it
  const badge = `<div class="overlap-half overlap-inst overlap-planned"><h3 class="section-h">Notable managers <span class="badge-planned">PLANNED</span></h3></div>`;
  assert.deepEqual(plannedMarkup(tickerBody(c, badge)), ["PLANNED", "badge-planned", "overlap-planned"]);
});

test("F1: the ticker route renders the band through tickerOverlapHtml, never the badge default", () => {
  const src = readFileSync(path.join(import.meta.dirname, "..", "src", "pages", "tickers", "[ticker].astro"), "utf-8");
  assert.match(src, /const overlapHtml = tickerOverlapHtml\(/);
  assert.doesNotMatch(src, /overlapBandHtml/, "the route does not call the badge-default renderer");
});

test("criterion 4: the ticker body carries no PLANNED markup in any institutional section state", () => {
  const states: TickerInstSection[] = [
    { state: "module-absent" }, { state: "no-map" }, { state: "unmapped" }, { state: "ambiguous" },
    { state: "resolved-no-data", name: "ZZZZ CORP", cik: "0000000099" },
  ];
  const c = CASES[0]!;
  for (const s of states) {
    assert.deepEqual(plannedMarkup(tickerBody(c, tickerOverlapHtml(bandOf(c), CTX, HREF), s)), [], s.state);
  }
});
