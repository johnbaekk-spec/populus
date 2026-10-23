/* Premarketing A — institutional tables. Each test fails if its change is
   reverted: the filer changes table leads with Ticker · Issuer like Reported
   positions; the 13F class title leaves the visible row but never the
   distinction between two share classes; the top adder links its filer page;
   the filer crumb names the fund; reader copy uses plain words. */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  changesTableHtml,
  changesTickersFromHoldings,
  filerHeadHtml,
  filerTiles,
  sanitizeChangesTickers,
} from "../src/lib/ui/institutional.ts";
import { addsRowHtml } from "../src/lib/inst-adds-render.ts";
import { withAdderTiers, type QoqDeltaRow } from "../src/lib/inst.ts";
import type { AddsRow } from "../src/lib/inst-adds.ts";
import { hhiNoteFor } from "../src/lib/inst-index.ts";
import { domOf, visibleText } from "./lib/ledger-dom.ts";

function qoq(over: Partial<QoqDeltaRow> = {}): QoqDeltaRow {
  return {
    cik: "0001067983",
    position_key: "pos:1",
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
    issuer_name: "APPLE INC",
    title_of_class: "COM",
    ...over,
  };
}

const headers = (html: string): string[] =>
  domOf(html).querySelectorAll("table")[0]!.querySelectorAll("thead th").map((th) => visibleText(th).trim());

test("the changes table leads with Ticker · Issuer, the Reported positions identity columns", () => {
  const rows = [qoq(), qoq({ position_key: "pos:2", issuer_name: "CHEVRON CORP", curr_value_usd: 1500 })];
  const html = changesTableHtml(rows, "2026-03-31", null, { total: 2, tickers: { "pos:1": "AAPL" } });
  assert.deepEqual(headers(html).slice(0, 3), ["Ticker", "Issuer", "Change"]);
  const doc = domOf(html);
  const first = doc.querySelectorAll("tbody tr")[0]!;
  const cells = first.querySelectorAll("td");
  assert.equal(cells[0]!.getAttribute("class"), "c-ticker", "the Reported positions ticker cell class");
  assert.match(cells[0]!.innerHTML, /<span class="mono-ticker">AAPL<\/span>/);
  assert.match(cells[1]!.getAttribute("class")!, /\bc-pos c-flex\b/, "the Reported positions issuer cell class");
  // an unmapped row shows the honest dash, never a guessed symbol
  assert.equal(visibleText(doc.querySelectorAll("tbody tr")[1]!.querySelectorAll("td")[0]!).trim(), "—");
  // with a Ticker column first, the issuer is the sticky identity column (as on Reported positions)
  assert.match(html, /<table class="etable" data-sticky-issuer/);
});

test("no ticker map (or none mapping) → no Ticker column, the issuer stays the sticky first column", () => {
  const none = changesTableHtml([qoq()], "2026-03-31", null, { total: 1 });
  assert.equal(headers(none)[0], "Issuer");
  assert.match(none, /<table class="etable" data-sticky-first/);
  assert.ok(!none.includes("Ticker: no position"), "no removal reason without a map");
  const unmapped = changesTableHtml([qoq()], "2026-03-31", null, { total: 1, tickers: {} });
  assert.equal(headers(unmapped)[0], "Issuer");
  assert.ok(unmapped.includes("Ticker: no position here maps to a reviewed ticker."), "the removal names itself, as Reported positions does");
});

test("the 13F class title leaves the visible row and rides in the issuer's note", () => {
  const html = changesTableHtml([qoq({ title_of_class: "COM CL A" })], "2026-03-31", null, { total: 1, tickers: { "pos:1": "AAPL" } });
  const row = domOf(html).querySelectorAll("tbody tr")[0]!;
  assert.ok(!visibleText(row).includes("COM CL A"), "no visible class title");
  assert.match(html, /share class as filed: <span class="filed-name">COM CL A<\/span>/, "the class is one tap away");
  assert.ok(!/aria-hidden="true">ⓘ</.test(html), "an unambiguous row shows no extra glyph");
});

test("two share classes of one issuer stay distinguishable: by ticker, else by a visible ⓘ", () => {
  const a = qoq({ position_key: "pos:a", issuer_name: "BERKSHIRE HATHAWAY INC DEL", title_of_class: "CL A" });
  const b = qoq({ position_key: "pos:b", issuer_name: "BERKSHIRE HATHAWAY INC DEL", title_of_class: "CL B NEW", curr_value_usd: 1500 });
  // distinct reviewed tickers carry the distinction
  const tickered = changesTableHtml([a, b], "2026-03-31", null, { total: 2, tickers: { "pos:a": "BRK-A", "pos:b": "BRK-B" } });
  assert.ok(tickered.includes(">BRK-A<") && tickered.includes(">BRK-B<"));
  assert.ok(!/aria-hidden="true">ⓘ</.test(tickered), "the ticker tells them apart; no glyph needed");
  // without tickers the issuer trigger shows its ⓘ — the class is in that note
  const bare = changesTableHtml([a, b], "2026-03-31", null, { total: 2 });
  assert.equal((bare.match(/<span class="mono-note" aria-hidden="true">ⓘ<\/span>/g) ?? []).length, 2);
  assert.ok(bare.includes("share class as filed: <span class=\"filed-name\">CL A</span>"));
  assert.ok(bare.includes("share class as filed: <span class=\"filed-name\">CL B NEW</span>"));
});

test("the /e/ route's ticker map comes from the payload's reviewed holdings tickers; embeds are shape-checked", () => {
  const map = changesTickersFromHoldings({
    "2026-03-31": [
      { position_key: "pos:1", ticker: "AAPL" },
      { position_key: "pos:2" },
      { position_key: null, ticker: "MSFT" },
      { position_key: "pos:3", ticker: "<b>" },
    ],
    "2025-12-31": [{ position_key: "pos:9", ticker: "BRK-B" }],
  });
  assert.deepEqual(map, { "pos:1": "AAPL", "pos:9": "BRK-B" });
  assert.deepEqual(sanitizeChangesTickers({ "pos:1": "AAPL", "pos:2": 3, "pos:3": "<img>" }), { "pos:1": "AAPL" });
  assert.equal(sanitizeChangesTickers("AAPL"), null);
  assert.equal(sanitizeChangesTickers([]), null);
});

test("the top adder links its filer page — canonical when pre-rendered, /e/ otherwise, plain without a tier", () => {
  const row: AddsRow = {
    issuer_key: "iss:1", issuer_key_source: "cusip6", issuer_name: "APPLE INC", manager_count: 3,
    new_position_count: 1, delta_value_usd: 5000, delta_value_is_partial: false,
    top_adder_cik: 1067983, top_adder_name: "BERKSHIRE HATHAWAY INC",
  };
  const [top] = withAdderTiers([row], new Set(["0001067983"]));
  assert.match(addsRowHtml(top!, 1), /<a data-row-link href="\/institutional\/filers\/1067983\/">BERKSHIRE HATHAWAY INC<\/a>/);
  const [tail] = withAdderTiers([row], new Set());
  assert.match(addsRowHtml(tail!, 1), /<a data-row-link href="\/e\/\?k=f:1067983">BERKSHIRE HATHAWAY INC<\/a>/);
  // an older payload (no tier) is never guessed into a link
  assert.ok(!addsRowHtml(row, 1).includes("<a "), "no tier → plain text");
  // no adder → no tier, no link
  const [none] = withAdderTiers([{ ...row, top_adder_cik: null, top_adder_name: null }], new Set(["0001067983"]));
  assert.equal(none!.top_adder_tier, undefined);
  // one link per row: the adder is the row's main link
  assert.equal((addsRowHtml(top!, 1).match(/data-row-link/g) ?? []).length, 1);
});

test("the filer crumb names the fund and keeps the CIK as secondary mono text", () => {
  const typed = filerHeadHtml(
    { cik: "0001067983", name: "BERKSHIRE HATHAWAY INC", latestPeriod: "2026-03-31" },
    null,
    { cik: "0001067983", display_name: "Berkshire Hathaway", person: "Warren Buffett", manager_type: "holding_company" as never, notable: true },
    null,
    "",
  );
  const crumb = /<nav class="crumb"[^]*?<\/nav>/.exec(typed)![0];
  assert.match(crumb, /\/ <span>Berkshire Hathaway <span class="crumb-cik">CIK 1067983<\/span><\/span><\/nav>$/);
  const filed = filerHeadHtml({ cik: "0001067983", name: "BULLISH FD", latestPeriod: "2026-03-31" }, null, null, null, "");
  assert.match(filed, /<span><span class="filed-name">BULLISH FD<\/span> <span class="crumb-cik">CIK 1067983<\/span><\/span><\/nav>/, "a filed name stays inside its marker");
});

test("reader copy: no `concentration_unavailable` identifier and no NULL in the filer tiles and index note", () => {
  const tiles = filerTiles(
    { cik: "x", period_of_report: "2026-03-31", position_count: 2, total_value_usd: 0, null_value_positions: 0, topn_value_usd: 0, topn_share_bps: null, hhi: null, flags: [] },
    0,
  );
  const text = tiles.map((t) => t.title ?? "").join(" | ");
  assert.doesNotMatch(text, /concentration_unavailable|NULL|fabricated/);
  assert.match(text, /Concentration not computed: the quarter's disclosed total is zero/);
  assert.doesNotMatch(hhiNoteFor(10, 3, null) + hhiNoteFor(10, 0, null), /NULL|concentration_unavailable|denominator/);
});
