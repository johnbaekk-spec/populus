/* Refinement 20260910 — fix round (D1 … D6) unit checks.
   D1 ticker cell covers every reviewed spelling · D2 `no_prior` is never a new
   stake · D3 issuer groups by group total · D4 tickers rank by disclosures ·
   D5 Position changes kind chips · D6 a visible /watchlist/ link. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { loadTickerHolders, type QoqDeltaRow } from "../src/lib/inst.ts";
import { tierCKey } from "../src/lib/format.ts";
import { qoqPresentation } from "../src/lib/derive.ts";
import { FEED_MOVE_KINDS } from "../src/lib/activity.ts";
import { groupHoldingsByIssuer, type FilerHoldingRow } from "../src/lib/holdings.ts";
import { congressTickersRollup } from "../src/lib/derive.ts";
import {
  changesTableHtml,
  congressRankingSection,
  defaultRankingSortKey,
  CONGRESS_ROOTS,
  type BuildStamps,
} from "../src/lib/ui/index.ts";
import type { TxnRow, RenderCtx } from "../src/lib/format.ts";
import { dispatchEntityClick, type DriverHandle } from "../src/scripts/entity-client.ts";

const SRC = path.resolve(import.meta.dirname, "..", "src");

/* ---------- D1: every reviewed spelling resolves the TICKER cell ---------- */

function tickerDb(withKeys: boolean): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE agg_ticker_holder_totals (ticker TEXT, period_of_report TEXT, prev_period TEXT,
             issuer_name TEXT, title_of_class TEXT, holder_count INTEGER, value_usd INTEGER, adds INTEGER, exits INTEGER);
           CREATE TABLE agg_ticker_holders (ticker TEXT, period_of_report TEXT, rank INTEGER, cik TEXT, filer_name TEXT,
             value_usd INTEGER, shares INTEGER, prev_shares INTEGER, delta_shares INTEGER, change_kind TEXT,
             method TEXT, verified_date TEXT);
           INSERT INTO agg_ticker_holder_totals VALUES ('AAPL','2026-03-31','2025-12-31','APPLE INC','CMN',2,100,1,0);
           INSERT INTO agg_ticker_holders VALUES ('AAPL','2026-03-31',1,'0001067983','BERKSHIRE',100,10,10,0,'held','exact-name','2026-09-10');`);
  if (withKeys) {
    db.exec(`CREATE TABLE agg_ticker_keys (issuer_name TEXT, title_of_class TEXT, ticker TEXT, method TEXT, verified_date TEXT);
             INSERT INTO agg_ticker_keys VALUES ('APPLE INC','CMN','AAPL','exact-name','2026-09-10');
             INSERT INTO agg_ticker_keys VALUES ('APPLE INC','COM','AAPL','exact-name','2026-09-10');
             INSERT INTO agg_ticker_keys VALUES ('OCCIDENTAL PETE CORP','COM','OXY','manual','2026-09-10');`);
  }
  return db;
}

test("D1: tickerByKey covers EVERY reviewed (name, class) row, not only the totals' one spelling", () => {
  const { tickerByKey } = loadTickerHolders(tickerDb(true));
  assert.equal(tickerByKey.get(tierCKey("APPLE INC", "CMN"))?.ticker, "AAPL");
  assert.equal(tickerByKey.get(tierCKey("APPLE INC", "COM"))?.ticker, "AAPL", "Berkshire's filed spelling resolves");
  assert.equal(tickerByKey.get(tierCKey("OCCIDENTAL PETE CORP", "COM"))?.ticker, "OXY", "a reviewed row with no totals row still resolves");
  assert.equal(tickerByKey.get(tierCKey("APPLE INC", "COM"))?.verified_date, "2026-09-10", "the ⓘ keeps its verification date");
  assert.equal(tickerByKey.get(tierCKey("APPLE INC", "CL B")), undefined, "an unreviewed class shows no ticker (G14)");
});

test("D1: an older aggregate without agg_ticker_keys falls back to the totals' spelling", () => {
  const { tickerByKey } = loadTickerHolders(tickerDb(false));
  assert.equal(tickerByKey.get(tierCKey("APPLE INC", "CMN"))?.ticker, "AAPL");
  assert.equal(tickerByKey.get(tierCKey("APPLE INC", "COM")), undefined);
});

/* ---------- D2: `no_prior` is never a new stake ---------- */

function delta(over: Partial<QoqDeltaRow>): QoqDeltaRow {
  return {
    cik: "0000200217", position_key: "cusip:111111111", put_call: "LONG", curr_period: "2026-03-31",
    prev_period: "2025-12-31", change_kind: "new", prev_value_usd: 0, curr_value_usd: 1_000,
    delta_value_usd: 1_000, prev_shares: null, curr_shares: 10, delta_shares: 10, ssh_prnamt_type: "SH",
    flags: [], issuer_name: "X CO", title_of_class: "COM",
    ...over,
  } as QoqDeltaRow;
}

test("D2: a no_prior row presents as 'no prior', never as new, and no feed treats it as a move", () => {
  const p = qoqPresentation(delta({ change_kind: "no_prior", prev_value_usd: null, delta_value_usd: null, delta_shares: null }));
  assert.equal(p.chipText, "no prior");
  assert.notEqual(p.chipCls, "qoq-new");
  assert.equal(FEED_MOVE_KINDS.has("no_prior"), false, "landing, notable-moves and consensus feeds skip it");
});

test("D2: the filer changes table moves no_prior rows into their own collapsed group", () => {
  const rows = [
    delta({ position_key: "cusip:A", change_kind: "add", prev_value_usd: 500, delta_value_usd: 500 }),
    delta({ position_key: "cusip:B", change_kind: "no_prior", prev_value_usd: null, delta_value_usd: null, delta_shares: null }),
    delta({ position_key: "cusip:C", change_kind: "no_prior", prev_value_usd: null, delta_value_usd: null, delta_shares: null }),
  ];
  const html = changesTableHtml(rows, "2026-03-31", null, { total: 3 });
  const main = html.slice(html.indexOf('<tbody id="filer-changes-tbody"'), html.indexOf("</tbody>"));
  assert.ok(main.includes("pos-cusip-A") || main.includes("cusip:A"), "the add stays in the changes table");
  assert.ok(!main.includes("no prior"), "no no_prior row is in the paged changes table");
  assert.match(html, /<details class="qoq-held-group" data-qoq-no-prior><summary>No prior quarter to compare · 2<\/summary>/);
  assert.ok(html.includes("not new stakes"), "the group says why");
});

/* ---------- D3: issuer groups rank by the GROUP total ---------- */

function holding(over: Partial<FilerHoldingRow>): FilerHoldingRow {
  return {
    cik: "0001067983", period: "2026-03-31", filing_key: "1", security_id: null, cusip: "025816109",
    issuer_name: "AMERICAN EXPRESS CO", title_of_class: "COM", value_usd: 45_900, shares: 1, ssh_type: "SH",
    put_call: null, position_key: "cusip:025816109", put_call_bucket: "LONG", unit_key: "SH", flags: [],
    ...over,
  };
}

test("D3: a group whose first row is small still leads when its TOTAL is the largest", () => {
  const rows = [
    holding({}), // American Express, one row, 45.9
    holding({ cusip: "037833100", position_key: "cusip:037833100#1", issuer_name: "APPLE INC", value_usd: 30_000 }),
    holding({ cusip: "037833100", position_key: "cusip:037833100#2", issuer_name: "APPLE INC", value_usd: 27_800 }),
  ];
  const groups = groupHoldingsByIssuer(rows);
  assert.deepEqual(groups.map((g) => g.value_usd), [57_800, 45_900]);
  assert.equal(groups[0]!.rows[0]!.issuer_name, "APPLE INC");
});

test("D3: an undisclosed group total sorts after every stated total; ties keep first appearance", () => {
  const rows = [
    holding({ cusip: "111111111", position_key: "cusip:1", value_usd: null }),
    holding({ cusip: "222222222", position_key: "cusip:2", value_usd: 10 }),
    holding({ cusip: "333333333", position_key: "cusip:3", value_usd: 10 }),
  ];
  const groups = groupHoldingsByIssuer(rows);
  assert.deepEqual(groups.map((g) => g.key), ["cusip6:222222", "cusip6:333333", "cusip6:111111"]);
});

/* ---------- D4: "Tickers · most disclosed" ranks by disclosures ---------- */

const NOW = "2026-08-12";
const stamps: BuildStamps = { buildId: "t.1", generatedAt: "2026-08-12 00:00 UTC", generatedAtDate: NOW };
const ctx: RenderCtx = { watched: new Set() };
function txn(over: Partial<TxnRow>): TxnRow {
  return {
    kind: "txn", txnId: "t", asset: null, assetType: null, filed: "2026-07-21", traded: "2026-06-24",
    name: "M", bioguide: "T000001", party: "R", state: "OK", district: null, chamber: "senate",
    ticker: "WMB", side: "purchase", owner: "self", low: 1001, high: 15000, lag: 27, late: 0, flags: [],
    doc: "https://efdsearch.senate.gov/x", ...over,
  };
}

test("D4: the tickers section's default order is by number of disclosures, net flow one click away", () => {
  assert.equal(defaultRankingSortKey("tickers"), "txns");
  assert.equal(defaultRankingSortKey("leaders"), "net", "the member section keeps net flow");
  // WMB: one large purchase (largest net). NVDA: three small sales (most disclosures).
  const rows = [
    txn({ ticker: "WMB", low: 1_000_001, high: 5_000_000 }),
    txn({ ticker: "NVDA", side: "sale" }),
    txn({ ticker: "NVDA", side: "sale" }),
    txn({ ticker: "NVDA", side: "sale" }),
  ];
  const html = congressRankingSection("tickers", congressTickersRollup(rows, NOW, { range: "12m", basis: "traded" }), stamps, ctx, {
    rootId: CONGRESS_ROOTS.momentum, heading: "Tickers · most disclosed", sectionId: "momentum-section",
  });
  const body = html.slice(html.indexOf(`id="${CONGRESS_ROOTS.momentum}"`));
  assert.ok(body.indexOf("/tickers/NVDA/") < body.indexOf("/tickers/WMB/"), "NVDA (3 disclosures) ranks above WMB (1)");
  assert.match(html, /data-congress-sort="txns" data-congress-dir="desc" aria-sort="descending"/);
  assert.match(html, /data-congress-sort="net" data-congress-dir="desc" aria-sort="none"/);
  assert.ok(html.includes("Tickers ranked by number of disclosures"));
});

test("D4: the client binding reads the same default key as the server", () => {
  const src = readFileSync(path.join(SRC, "scripts", "congress-sections.ts"), "utf-8");
  assert.ok(src.includes('bindRoot(CONGRESS_ROOTS.momentum, "tickers", { key: defaultRankingSortKey("tickers"), dir: "desc" });'));
});

/* ---------- D5: Position changes kind chips ---------- */

test("D5: the changes table carries New stakes / Adds / Trims / Exits chips and filters by kind", () => {
  const rows = [
    delta({ position_key: "cusip:N", change_kind: "new" }),
    delta({ position_key: "cusip:A", change_kind: "add", prev_value_usd: 500, delta_value_usd: 500 }),
    delta({ position_key: "cusip:T", change_kind: "trim", prev_value_usd: 2_000, delta_value_usd: -1_000 }),
  ];
  const all = changesTableHtml(rows, "2026-03-31", null, { total: 3 });
  for (const label of ["All", "New stakes", "Adds", "Trims", "Exits"]) assert.ok(all.includes(`>${label}</button>`), label);
  assert.ok(all.includes('data-changes-kind="all" aria-pressed="true"'), "All is pressed by default");
  const adds = changesTableHtml(rows, "2026-03-31", null, { total: 3, kind: "add" });
  const tbody = adds.slice(adds.indexOf('<tbody id="filer-changes-tbody"'), adds.indexOf("</tbody>"));
  assert.equal((tbody.match(/<tr /g) ?? []).length, 1, "only the add remains");
  assert.ok(adds.includes('data-changes-kind="add" aria-pressed="true"'));
  const exits = changesTableHtml(rows, "2026-03-31", null, { total: 3, kind: "exit" });
  assert.ok(exits.includes("data-changes-kind-empty"), "an empty filter says so");
});

test("D5: the /e/ route dispatches a kind chip to the driver", () => {
  const calls: (string | null)[] = [];
  const handle = { changesKind: (k: string | null) => calls.push(k) } as unknown as DriverHandle;
  const chip = (kind: string) =>
    ({ closest: (sel: string) => (sel === "[data-changes-kind]" ? { dataset: { changesKind: kind } } : null) }) as unknown as Element;
  dispatchEntityClick(chip("new"), handle);
  dispatchEntityClick(chip("all"), handle);
  assert.deepEqual(calls, ["new", null]);
});

/* ---------- D6: a visible link to /watchlist/ ---------- */

test("D6: the site nav links to /watchlist/ and the watchlist page marks it current", () => {
  const base = readFileSync(path.join(SRC, "layouts", "Base.astro"), "utf-8");
  const nav = base.slice(base.indexOf('<nav class="site-nav"'), base.indexOf("</nav>", base.indexOf('<nav class="site-nav"')));
  assert.ok(nav.includes('<a href="/watchlist/" aria-current={active === "watchlist" ? "page" : undefined}>Watchlist</a>'));
  const page = readFileSync(path.join(SRC, "pages", "watchlist", "index.astro"), "utf-8");
  assert.ok(page.includes('active="watchlist"'));
});
