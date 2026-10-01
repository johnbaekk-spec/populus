/* SIGNALS-CLARITY M3 — the /congress "Monthly flow" panel (R16, R17, R18, R19;
   T15, T16, T17, T18).

   Read from the RENDERED BYTES by DOM parse (`mini-dom`), so a class, bar or
   caption the renderer stops emitting is one these tests cannot find. The pure
   derivations (`monthlyFlow`, `lagCdf`, `estimatedCompleteness`) are pinned in
   derive.test.ts; this file pins what the reader is shown. */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import { monthlyFlowPanel } from "../src/lib/ui/index.ts";
import {
  lagCdf,
  lagCdfPointsText,
  monthlyFlow,
  netFlow,
  netIntervalText,
  estimatedCompleteness,
  completenessLabel,
} from "../src/lib/derive.ts";
import type { TxnRow } from "../src/lib/format.ts";
import { domOf, visibleText } from "./lib/ledger-dom.ts";
import { installDom, type MiniElement } from "./lib/mini-dom.ts";
import { initMonthlyFlowToggle } from "../src/scripts/congress-sections.ts";

const SRC = path.resolve(import.meta.dirname, "..", "src");
const BUILD = "2026-08-17";

function txn(over: Partial<TxnRow> = {}): TxnRow {
  return {
    kind: "txn", txnId: "t", asset: "Widget Co", assetType: "ST", filed: "2026-08-01", traded: "2026-07-10",
    name: "A Member", bioguide: "A000001", party: "R", state: "OK", district: null, chamber: "house",
    ticker: "WMB", side: "purchase", owner: "self", low: 1001, high: 15000, lag: 22, late: 0, flags: [],
    doc: "https://disclosures-clerk.house.gov/x", ...over,
  };
}

/* The fixture: a mature lag sample (100 rows traded 2022-12-01 — inside the
   13–48-month sample, outside the 36-month chart — lags 0..99 days, so
   CDF(d) = (d + 1) / 100), plus one of every exclusion the caption must state,
   inside the 36-month window. */
const SAMPLE = Array.from({ length: 100 }, (_, i) => txn({ txnId: `lag${i}`, traded: "2022-12-01", filed: "2023-03-01", lag: i }));
const ROWS: TxnRow[] = [
  ...SAMPLE,
  txn({ txnId: "buy-jul", traded: "2026-07-10" }),
  txn({ txnId: "sale-jul", traded: "2026-07-11", side: "sale", bioguide: "B000002", name: "B Member", low: 15001, high: 50000 }),
  txn({ txnId: "part-jul", traded: "2026-07-12", side: "sale_partial", bioguide: "C000003", name: "C Member", low: 1001, high: 15000 }),
  txn({ txnId: "open-jun", traded: "2026-06-03", low: 1000001, high: null }),
  txn({ txnId: "exch", traded: "2026-07-13", side: "exchange" }),
  txn({ txnId: "undated-1", traded: null, lag: null }),
  txn({ txnId: "undated-2", traded: null, lag: null }),
  txn({ txnId: "anomaly", traded: "2026-07-14", flags: ["date_anomaly"] }),
  txn({ txnId: "untyped-1", traded: "2026-07-15", assetType: null, asset: "US Treasury Bill" }),
  txn({ txnId: "untyped-2", traded: "2026-05-15", assetType: null, side: "sale" }),
  txn({ txnId: "cs", traded: "2026-07-16", assetType: "CS", asset: "Municipal bond" }),
];

const HTML = monthlyFlowPanel(ROWS, BUILD);
const ROOT = domOf(HTML);
const variant = (v: "stocks" | "all"): MiniElement => ROOT.querySelector(`.mf-variant[data-flow-variant="${v}"]`)!;
const text = (el: MiniElement | null): string => (el ? visibleText(el).replace(/\s+/g, " ").trim() : "");

test("T15/R16: the panel is 'Monthly flow', 36 month columns per variant, purchases above the axis and sales below", () => {
  const section = ROOT.querySelector("section#monthly-flow-section")!;
  assert.ok(section, "the panel renders");
  assert.equal(text(section.querySelector("h2")), "Monthly flow");
  for (const v of ["stocks", "all"] as const) {
    const cols = variant(v).querySelectorAll(".rb-track .rb-col");
    assert.equal(cols.length, 36, `${v}: 36 month columns`);
    for (const c of cols) {
      assert.ok(c.querySelector(".rb-up") && c.querySelector(".rb-axis") && c.querySelector(".rb-down"), "each column has an up half, the axis and a down half");
    }
    // one breadth column per month, too
    assert.equal(variant(v).querySelectorAll(".mf-breadth .mf-bcol").length, 36);
  }
  const jul = variant("stocks").querySelectorAll(".rb-track .rb-col")[34]!;
  assert.ok(jul.querySelector(".rb-up .rb-buy"), "July's purchases sit above the axis");
  assert.ok(jul.querySelector(".rb-down .rb-sell"), "July's sales sit below it");
  assert.ok(!jul.querySelector(".rb-up .rb-sell") && !jul.querySelector(".rb-down .rb-buy"), "never the other way round");
});

test("T15/R16: zero-based — a bar spans exactly [low, high] of the axis; sales hang from the axis (top-anchored)", () => {
  // the stocks axis max is June's open lower bound, $1,000,000 (the largest bound drawn)
  const flow = monthlyFlow(ROWS, BUILD, 36, { listedStockOnly: true });
  const jul = flow.months[34]!;
  assert.equal(jul.month, "2026-07");
  const cols = variant("stocks").querySelectorAll(".rb-track .rb-col");
  const buy = cols[34]!.querySelector(".rb-up .rb-bar")!.getAttribute("style")!;
  // July purchases [1000, 15000] of 1,000,000: from 0.10% to 1.50% — its true span, no minimum height
  assert.equal(buy, "bottom:0.10%;height:1.40%");
  const sell = cols[34]!.querySelector(".rb-down .rb-bar")!.getAttribute("style")!;
  // July sales: sale [15000, 50000] + partial sale [1000, 15000] = [16000, 65000]: from 1.60% to 6.50% below the axis
  assert.equal(sell, "top:1.60%;height:4.90%", "a sale bar is measured from the axis downwards");
  assert.ok(!/bottom:/.test(sell), "a hanging bar never carries a bottom offset (the stylesheet pins top)");
  // a month with no rows is a gap, never a zero bar
  assert.ok(cols[0]!.querySelector(".rb-up .rb-gap") && cols[0]!.querySelector(".rb-down .rb-gap"));
});

/** A drawn bar's ends in DOLLARS, from the style the renderer emitted. */
function drawnDollars(bar: MiniElement, axisMax: number): { low: number; high: number } {
  const m = /^(?:bottom|top):([\d.]+)%;height:([\d.]+)%$/.exec(bar.getAttribute("style") ?? "");
  assert.ok(m, `a dollar-scaled bar states an offset and a height: ${bar.getAttribute("style")}`);
  const base = Number(m![1]);
  return { low: (base / 100) * axisMax, high: ((base + Number(m![2])) / 100) * axisMax };
}

test("review F1: under an outlier scale a small closed range is drawn to its TRUE high — never above it — in BOTH variants", () => {
  /* One month carries $50M; August's sales are $25K–$200K (two rows), as on
     data build 20260817.1 where the old 1.5% floor drew them to about $1.2M.
     A non-stock outlier makes the all-types axis differ from the stocks axis. */
  const rows = [
    txn({ txnId: "big", traded: "2025-12-10", side: "sale", low: 25000001, high: 50000000 }),
    txn({ txnId: "big-other", traded: "2025-11-10", side: "sale", assetType: "OT", low: 50000001, high: 100000000 }),
    txn({ txnId: "aug-1", traded: "2026-08-03", side: "sale", low: 15001, high: 50000 }),
    txn({ txnId: "aug-2", traded: "2026-08-04", side: "sale", low: 10001, high: 150000, bioguide: "B000002", name: "B Member" }),
    txn({ txnId: "aug-buy", traded: "2026-08-05", low: 1001, high: 15000 }),
    txn({ txnId: "mid", traded: "2026-05-05", low: 1000001, high: 5000000 }),
  ];
  const root = domOf(monthlyFlowPanel(rows, BUILD));
  const EPS = 1e-6;
  for (const [v, axisMax] of [["stocks", 50_000_000], ["all", 100_000_000]] as const) {
    const el = root.querySelector(`.mf-variant[data-flow-variant="${v}"]`)!;
    assert.ok(text(el.querySelector(".rb-caption")).includes(`y from $0 to $${axisMax / 1e6}M`), `${v}: the axis the test assumes`);
    const cols = el.querySelectorAll(".rb-track .rb-col");
    const precision = (0.01 / 100) * axisMax; // the two decimals of a percent the renderer emits
    // August sales: $25,000–$200,000
    const sale = cols[35]!.querySelectorAll(".rb-down .rb-bar");
    const drawn = drawnDollars(sale[0]!, axisMax);
    assert.ok(drawn.high <= 200_000 + EPS, `${v}: the bar's top (${drawn.high}) is never above the true high, $200,000`);
    assert.ok(drawn.high > 200_000 - precision - EPS, `${v}: and is the true high to the emitted precision (drew ${drawn.high})`);
    assert.ok(drawn.low <= 25_000 + EPS && drawn.low > 25_000 - precision - EPS, `${v}: its bottom is the true low, $25,000 (drew ${drawn.low})`);
    // too small to see at its true height → the separate, non-dollar tick at the bar's position
    assert.equal(sale.length, 2, `${v}: the bar, then its tick`);
    assert.ok(sale[1]!.classList.contains("mf-tick"));
    assert.match(sale[1]!.getAttribute("style")!, /^top:[\d.]+%$/, "the tick carries a position and NO height — it is not dollar-scaled");
    assert.equal(sale[1]!.getAttribute("style"), sale[0]!.getAttribute("style")!.replace(/;height:.*$/, ""), "the tick sits at the bar's own position");
    // August purchases, $1,000–$15,000: the same property on the other side of the axis
    const buy = cols[35]!.querySelectorAll(".rb-up .rb-bar");
    const drawnBuy = drawnDollars(buy[0]!, axisMax);
    assert.ok(drawnBuy.high <= 15_000 + EPS && drawnBuy.low <= 1_000 + EPS, `${v}: purchases are never drawn past $15,000 (drew ${drawnBuy.high})`);
    assert.ok(buy[1]!.classList.contains("mf-tick"));
    // a range large enough to see is drawn as itself, with no tick: May, $1M–$5M
    const mid = cols[32]!.querySelectorAll(".rb-up .rb-bar");
    const drawnMid = drawnDollars(mid[0]!, axisMax);
    assert.ok(Math.abs(drawnMid.high - 5_000_000) <= precision + EPS && Math.abs(drawnMid.low - 1_000_000) <= precision + EPS);
    assert.equal(mid.length, 1, `${v}: a visible range needs no tick`);
    // no dollar-scaled bar anywhere in the variant is drawn above its month's true bound
    const flow = monthlyFlow(rows, BUILD, 36, { listedStockOnly: v === "stocks" });
    let checked = 0;
    for (const [i, m] of flow.months.entries()) {
      for (const [half, sum] of [[".rb-up", m.buy], [".rb-down", m.sell]] as const) {
        if (sum.kind !== "closed") continue;
        const d = drawnDollars(cols[i]!.querySelector(`${half} .rb-bar`)!, axisMax);
        assert.ok(d.high <= sum.high + EPS && d.high > sum.high - precision - EPS, `${v} ${m.month} ${half}: top ${d.high} vs true ${sum.high}`);
        checked++;
      }
    }
    assert.equal(checked, v === "stocks" ? 4 : 5, `${v}: every closed bar was checked`);
    assert.match(text(el.querySelector(".rb-caption")), /a thin tick marks a month whose range is too small to draw at this scale — the tick is a marker, not a dollar amount/);
  }
  // the tick is one fixed CSS height; a monthly bar has no border, so no pixel of it is undisclosed dollars
  const css = readFileSync(path.join(SRC, "styles", "entities.css"), "utf-8");
  assert.match(css, /\.ribbon-monthly \.mf-tick \{ height: [12]px;/, "a fixed 1–2px mark");
  assert.match(css, /\.ribbon-monthly \.rb-bar \{[^}]*border: 0; \}/, "no border inflates a monthly bar");
  // a window whose ranges are all visible draws no tick and explains none
  const plain = domOf(monthlyFlowPanel([txn({ traded: "2026-07-10" })], BUILD));
  assert.equal(plain.querySelectorAll(".mf-tick").length, 0);
  assert.ok(!/thin tick/.test(text(plain.querySelector(".rb-caption"))));
});

test("T15/R16: an open sum is solid to its provable minimum, then a FIXED-height hatched cap — never hatch to the axis top", () => {
  // stocks fixture: June's purchases are one open row, minimum $1,000,000 (the axis max)
  const jun = variant("stocks").querySelectorAll(".rb-track .rb-col")[33]!;
  const bars = jun.querySelectorAll(".rb-up .rb-bar");
  assert.equal(bars.length, 2, "solid + cap");
  assert.ok(!bars[0]!.classList.contains("rb-hatch") && !bars[0]!.classList.contains("mf-cap"));
  assert.equal(bars[0]!.getAttribute("style"), "bottom:0;height:100.00%", "solid from the axis to the provable minimum");
  assert.ok(bars[1]!.classList.contains("mf-cap") && bars[1]!.classList.contains("rb-hatch"), "above the minimum is the hatched cap");
  assert.equal(bars[1]!.getAttribute("style"), "bottom:100.00%", "the cap sits on the minimum and carries NO height of its own");

  // an open sum well under the axis top: the cap stays a cap (the old grammar hatched 93.3% of the column)
  const html = monthlyFlowPanel(
    [
      txn({ txnId: "closed", traded: "2026-07-10", low: 1001, high: 15000 }),
      txn({ txnId: "open-buy", traded: "2026-06-10", low: 1001, high: null }),
      txn({ txnId: "open-sell", traded: "2026-05-10", side: "sale", low: 1001, high: null }),
      txn({ txnId: "unparsed-buy", traded: "2026-04-10", low: null, high: null }),
      txn({ txnId: "unparsed-sell", traded: "2026-03-10", side: "sale", low: null, high: null }),
    ],
    BUILD,
  );
  const cols = domOf(html).querySelector('.mf-variant[data-flow-variant="stocks"]')!.querySelectorAll(".rb-track .rb-col");
  const styles = (col: MiniElement, half: string) => col.querySelectorAll(`${half} .rb-bar`).map((b) => `${b.getAttribute("class")} | ${b.getAttribute("style") ?? ""}`);
  // axis max = the closed high, $15,000; an open minimum of $1,000 is 6.66% of it (floored, never past the bound)
  assert.deepEqual(styles(cols[33]!, ".rb-up"), ["rb-bar rb-buy | bottom:0;height:6.66%", "rb-bar rb-buy rb-hatch mf-cap | bottom:6.66%"]);
  assert.deepEqual(styles(cols[32]!, ".rb-down"), ["rb-bar rb-sell | top:0;height:6.66%", "rb-bar rb-sell rb-hatch mf-cap | top:6.66%"], "a sale cap hangs below its minimum");
  // an all-unparsed sum: a hatched stub AT the axis, on its own side, and no solid bar — never $0, never full height
  assert.deepEqual(styles(cols[31]!, ".rb-up"), ["rb-bar rb-buy rb-hatch mf-stub | bottom:0"]);
  assert.deepEqual(styles(cols[30]!, ".rb-down"), ["rb-bar rb-sell rb-hatch mf-stub | top:0"]);
  // a closed sum has neither mark, and no hatch at all
  assert.deepEqual(styles(cols[34]!, ".rb-up"), ["rb-bar rb-buy | bottom:6.66%;height:93.34%"]);
  // no bar in the monthly ribbon is hatched by a percentage of the axis
  for (const b of domOf(html).querySelectorAll(".rb-hatch")) assert.ok(!/height/.test(b.getAttribute("style") ?? ""), "a hatch never has a dollar height");
  for (const b of ROOT.querySelectorAll(".rb-hatch")) assert.ok(!/height/.test(b.getAttribute("style") ?? ""));

  // the cap and the stub are ONE fixed CSS height, with no closing edge on the far side
  const css = readFileSync(path.join(SRC, "styles", "entities.css"), "utf-8");
  assert.match(css, /\.ribbon-monthly :is\(\.mf-cap, \.mf-stub\) \{ height: 1[0-2]px; \}/, "a 10–12px constant, not a proportion");
  assert.match(css, /\.ribbon-monthly \.rb-bar \{[^}]*border: 0; \}/, "no closing edge: a monthly bar, cap or stub has no border at all");
  assert.match(css, /\.ribbon-monthly \.rb-down \{ flex: 1; \}/, "purchases and sales share one scale");

  // the caption says what each mark means, in plain words, only where the mark is drawn
  const cap = text(domOf(html).querySelector('.mf-variant[data-flow-variant="stocks"] .rb-caption'));
  assert.match(cap, /a hatched cap means no upper bound is disclosed \(an open-ended or unparsed amount\) — the bar shows the provable minimum only, and the cap's height is not a dollar amount/);
  assert.match(cap, /a hatched stub at the axis means amounts were filed but none parsed — never counted as \$0/);
  assert.ok(!/then hatched/.test(cap), "the hatch-to-the-top wording is gone");
  const fixtureCap = text(variant("stocks").querySelector(".rb-caption"));
  assert.match(fixtureCap, /a hatched cap means/);
  assert.ok(!/hatched stub/.test(fixtureCap), "no stub is drawn in this fixture, so none is explained");
  const closedOnly = text(domOf(monthlyFlowPanel([txn({ traded: "2026-07-10" })], BUILD)).querySelector(".rb-caption"));
  assert.ok(!/hatched/.test(closedOnly), "a window with only closed sums explains no hatch");

  // the assistive-technology table says the state in words
  const rows = domOf(html).querySelector('.mf-variant[data-flow-variant="stocks"] table.mf-table')!.querySelectorAll("tbody tr");
  const cells = (i: number) => rows[i]!.querySelectorAll("td").map((c) => text(c));
  assert.equal(cells(33)[0], "Over $1K (open — no upper bound disclosed)");
  assert.equal(cells(32)[1], "Over $1K (open — no upper bound disclosed)");
  assert.equal(cells(31)[0], "undisclosed — amounts filed but none parsed");
  assert.equal(cells(30)[1], "undisclosed — amounts filed but none parsed");
  assert.equal(cells(34)[0], "$1K–$15K");
});

test("T15/R16: each column's accessible summary gives the month's net as an interval, never a point", () => {
  const flow = monthlyFlow(ROWS, BUILD, 36, { listedStockOnly: true });
  const cols = variant("stocks").querySelectorAll(".rb-track .rb-col");
  for (const [i, c] of cols.entries()) {
    const m = flow.months[i]!;
    const label = c.getAttribute("aria-label")!;
    assert.equal(c.getAttribute("role"), "img");
    assert.ok(label.startsWith(`${m.month}: `), `${m.month}'s summary names its month`);
    assert.ok(label.includes(`net ${netIntervalText(netFlow(m.buy, m.sell))}`), `${m.month}: net interval in the summary`);
  }
  const jul = cols[34]!.getAttribute("aria-label")!;
  assert.match(jul, /net −\$64\.0K to −\$1\.0K/, "July's net is [1K − 65K, 15K − 16K]: purchases − sales as an interval");
  assert.match(jul, /1 member with a purchase, 2 with a sale/, "breadth is in the summary");
});

test("T15/R16: the caption states every exclusion count and the source line", () => {
  const stocks = text(variant("stocks").querySelector(".mf-exclusions"));
  assert.match(stocks, /3 in-window rows excluded as not listed stock \(2 untyped — the filing states no asset type; 1 another asset type\)/);
  assert.match(stocks, /1 in-window exchange\/unparsed-side row excluded/);
  assert.match(stocks, /2 rows with no parseable trade date excluded/);
  assert.match(stocks, /1 date-anomaly row excluded \(impossible trade dates\)/);
  const all = text(variant("all").querySelector(".mf-exclusions"));
  assert.ok(!/not listed stock/.test(all), "the all-types variant excludes nothing by type");
  assert.match(all, /1 in-window exchange\/unparsed-side row excluded · 2 rows with no parseable trade date excluded · 1 date-anomaly row excluded/);
  for (const v of ["stocks", "all"] as const) {
    const cap = text(variant(v).querySelector(".rb-caption"));
    assert.match(cap, /source: House Clerk \+ Senate eFD/);
    assert.match(cap, /y from \$0 to \$1M/, "the axis is zero-based and its top is stated");
    assert.match(cap, /gaps are gaps — no interpolation/);
    assert.match(cap, /trade months 2023-09 to 2026-08 \(through 2026-08-17, the build date\)/);
  }
  assert.match(text(variant("stocks").querySelector(".rb-caption")), /listed stocks: rows whose filed asset type is ST \(House Clerk code\) or Stock \(Senate eFD label\)/);
});

test("T16/R17: recent months are shaded by estimated completeness, labelled '≈p% filed (est.)', the 45-day window darker", () => {
  const cdf = lagCdf(ROWS, BUILD);
  assert.equal(cdf.n, 100, "the fixture's mature sample");
  const flow = monthlyFlow(ROWS, BUILD, 36, { listedStockOnly: true });
  const cols = variant("stocks").querySelectorAll(".rb-track .rb-col");
  const expected: string[] = [];
  for (const [i, m] of flow.months.entries()) {
    const c = estimatedCompleteness(cdf, m, BUILD);
    const col = cols[i]!;
    assert.equal(col.classList.contains("mf-window"), c.tone === "window", `${m.month} window tone`);
    assert.equal(col.classList.contains("mf-est"), c.tone === "est", `${m.month} est tone`);
    if (c.tone) expected.push(`${m.month} ${completenessLabel(c.est!)}${c.tone === "window" ? " · inside the 45-day window" : ""}`);
  }
  // CDF(d) = (d+1)/100: Aug (age 8) 9%, Jul (age 32) 33% — both inside the window — and Jun (age 63) 64% shaded
  assert.deepEqual(expected, [
    "2026-06 ≈64% filed (est.)",
    "2026-07 ≈33% filed (est.) · inside the 45-day window",
    "2026-08 ≈9% filed (est.) · inside the 45-day window",
  ]);
  const labels = variant("stocks").querySelectorAll(".mf-shade-labels li").map((li) => text(li));
  assert.deepEqual(labels, [...expected].reverse(), "one label per shaded month, newest first");
  assert.equal(cols.filter((c) => c.classList.contains("mf-est") || c.classList.contains("mf-window")).length, 3, "May (94%) and older are not shaded");
});

test("T16/R17: the caption prints the method, the measured CDF points, the sample and its bias", () => {
  const cdf = lagCdf(ROWS, BUILD);
  const line = text(variant("stocks").querySelector(".mf-completeness"));
  assert.ok(line.includes(`Filed within ${lagCdfPointsText(cdf)}.`), "the measured 45/90/180/365-day points");
  assert.equal(lagCdfPointsText(cdf), "≤45 d 46.0% · ≤90 d 91.0% · ≤180 d 100.0% · ≤365 d 100.0%");
  assert.match(line, /100 trades made 2022-08-17 to 2025-07-17 \(13–48 months before the build\), all asset types/);
  assert.match(line, /still unfiled are not observed yet, so the estimate slightly overstates completeness/, "the residual late-filing bias is stated beside the estimate");
  assert.match(line, /Shaded: under 90% filed \(est\.\); darker: the month ended fewer than 45 days before the build/);
  assert.ok(variant("stocks").querySelector('.mf-completeness a[href="/methodology/#monthly-flow"]'), "links the method");
  // with no mature sample the panel says so and labels nothing as an estimate
  const bare = domOf(monthlyFlowPanel(ROWS.filter((r) => !r.txnId.startsWith("lag")), BUILD));
  assert.match(text(bare.querySelector(".mf-completeness")), /Completeness is not estimated: no row traded 2022-08-17 to 2025-07-17 carries a filing lag/);
  assert.ok(!/≈\d+% filed/.test(text(bare.querySelector(".mf-shade-labels"))), "no estimate is printed from nothing");
  assert.match(text(bare.querySelector(".mf-shade-labels")), /2026-08 completeness not estimated · inside the 45-day window/);
});

test("T17/R18: both variants render at build time; exactly one is visible by default; the toggle flips `hidden`", () => {
  assert.equal(ROOT.querySelectorAll(".mf-variant").length, 2);
  assert.equal(variant("stocks").hidden, false, "Listed stocks is the default");
  assert.equal(variant("all").hidden, true);
  const { doc, restore } = installDom(`<main id="congress-page">${HTML}</main>`);
  try {
    assert.equal(initMonthlyFlowToggle(), true, "the toggle binds to the rendered panel");
    const btn = (v: string) => doc.querySelector(`[data-flow-toggle="${v}"]`)!;
    const shown = () => doc.querySelectorAll(".mf-variant").filter((el) => !el.hidden).map((el) => el.getAttribute("data-flow-variant"));
    assert.deepEqual(shown(), ["stocks"]);
    assert.equal(btn("stocks").getAttribute("aria-pressed"), "true");
    btn("all").click();
    assert.deepEqual(shown(), ["all"], "All asset types shows the other variant and hides the default");
    assert.equal(btn("all").getAttribute("aria-pressed"), "true");
    assert.equal(btn("stocks").getAttribute("aria-pressed"), "false");
    btn("stocks").click();
    assert.deepEqual(shown(), ["stocks"]);
  } finally {
    restore();
  }
  // absent panel: nothing binds, nothing throws
  const bare = installDom(`<main id="congress-page"></main>`);
  try {
    assert.equal(initMonthlyFlowToggle(), false);
  } finally {
    bare.restore();
  }
});

test("T17/R18: the toggle reads no rows and fetches nothing — the section module stays fetch-free", () => {
  const src = readFileSync(path.join(SRC, "scripts", "congress-sections.ts"), "utf-8");
  const body = src.slice(src.indexOf("export function initMonthlyFlowToggle"), src.indexOf("export function initCongressSections"));
  assert.ok(body.length > 0);
  for (const forbidden of ["fetch(", "requestRows", "receiveRows", "allRows"]) assert.ok(!body.includes(forbidden), `the toggle must not touch ${forbidden}`);
  assert.match(src, /if \(!page\) return \{ receiveRows: \(\) => \{\}, feedSettled: \(\) => \{\} \};\n  initMonthlyFlowToggle\(\);/, "the page's section island binds the toggle");
});

test("T17/R18: the stocks caption states the untyped count; all-types draws those rows", () => {
  assert.match(text(variant("stocks").querySelector(".mf-exclusions")), /2 untyped/);
  const stocks = monthlyFlow(ROWS, BUILD, 36, { listedStockOnly: true });
  const all = monthlyFlow(ROWS, BUILD, 36);
  const julRows = (f: typeof all) => { const m = f.months[34]!; return (m.buy.kind === "empty" ? 0 : m.buy.rows) + (m.sell.kind === "empty" ? 0 : m.sell.rows); };
  assert.equal(julRows(all) - julRows(stocks), 2, "July's untyped Treasury bill and the CS row are drawn only under All asset types");
});

test("T18/R19: a visually-hidden (not display:none, not [hidden]) table lists every month for assistive technology", () => {
  for (const v of ["stocks", "all"] as const) {
    const table = variant(v).querySelector("table.mf-table")!;
    assert.ok(table, `${v}: the table exists`);
    assert.ok(table.closest(".visually-hidden"), "inside a clip-pattern visually-hidden block (a table ignores width:1px itself)");
    assert.equal(table.hasAttribute("hidden"), false);
    assert.equal(table.getAttribute("aria-hidden"), null);
    const heads = table.querySelectorAll("thead th").map((th) => text(th));
    assert.deepEqual(heads, ["Trade month", "Purchases", "Sales", "Net (interval)", "Members with a purchase", "Members with a sale", "Estimated completeness"]);
    const rows = table.querySelectorAll("tbody tr");
    assert.equal(rows.length, 36, "one row per month");
    const jul = rows[34]!.querySelectorAll("th, td").map((c) => text(c));
    assert.equal(jul[0], "2026-07");
    assert.equal(jul[3], netIntervalText(netFlow(monthlyFlow(ROWS, BUILD, 36, { listedStockOnly: v === "stocks" }).months[34]!.buy, monthlyFlow(ROWS, BUILD, 36, { listedStockOnly: v === "stocks" }).months[34]!.sell)));
    assert.match(jul[6]!, /^≈33% filed \(est\.\) · inside the 45-day window$/);
    assert.equal(text(rows[0]!.querySelector("td")), "none", "a gap month says none, never $0");
  }
  const css = readFileSync(path.join(SRC, "styles", "late-additions.css"), "utf-8") + readFileSync(path.join(SRC, "styles", "layout.css"), "utf-8") + readFileSync(path.join(SRC, "styles", "foundation.css"), "utf-8");
  assert.match(css, /\.visually-hidden\s*\{[^}]*clip/, "the visually-hidden class is the clip pattern");
});

test("T15/R16: the panel sits immediately before 'Leaders · net disclosed flow' on /congress, rendered from build.txns", () => {
  const page = readFileSync(path.join(SRC, "pages", "congress", "index.astro"), "utf-8");
  assert.match(page, /const monthlyFlowHtml = monthlyFlowPanel\(build\.txns, build\.generatedAtDate\);/);
  assert.match(page, /<Fragment set:html=\{monthlyFlowHtml\} \/>\s*<div class="design-rankings" id="congress-leaders-band">/, "directly before band C1, whose first cell is Leaders");
  const leaders = page.indexOf('heading: "Leaders · net disclosed flow"');
  assert.ok(leaders > 0);
});

test("T16/R17: /methodology prints the method and this build's CDF points from the same rows and date", () => {
  const src = readFileSync(path.join(SRC, "pages", "methodology", "index.astro"), "utf-8");
  assert.match(src, /const lagSample = lagCdf\(build\.txns, build\.generatedAtDate\);/);
  assert.match(src, /id="monthly-flow"/);
  assert.match(src, /This build: filed within \{lagCdfPointsText\(lagSample\)\}\./);
  assert.match(src, /mature, not closed/);
  assert.match(src, /slightly overstates completeness/);
});

test("§0: the panel's own copy carries no banned trading verb (the post-build gate scans the built page)", async () => {
  const { BANNED_PATTERNS } = await import("./lib/banned-scan.ts");
  for (const { name, re } of BANNED_PATTERNS) assert.ok(!re.test(HTML), `banned wording "${name}" in the Monthly flow panel`);
  // control: the scanner does see the word it bans
  assert.ok(BANNED_PATTERNS.some(({ re }) => re.test("17 members buying")), "control");
});

test("review F3: the panel never prints an impossible sample date", () => {
  for (const build of ["2026-03-29", "2026-03-30", "2026-03-31"]) {
    const line = text(domOf(monthlyFlowPanel(ROWS, build)).querySelector(".mf-completeness"));
    assert.ok(line.includes("2025-02-28"), `${build}: the sample ends on February's last day`);
    assert.ok(!/-02-(29|30|31)\b/.test(line), `${build}: no 2025-02-29/30/31 — ${line.slice(0, 200)}`);
  }
});

test("R17 (amended): the caption and /methodology state the midpoint rule in plain words, and agree", () => {
  const line = text(variant("stocks").querySelector(".mf-completeness"));
  assert.match(line, /the build date minus the month's midpoint; for the build's own month, the midpoint of the days elapsed so far/);
  const src = readFileSync(path.join(SRC, "pages", "methodology", "index.astro"), "utf-8").replace(/\s+/g, " ");
  assert.match(src, /a month that has ended is aged from the middle of the calendar month/);
  assert.match(src, /The build's own month is still in progress, so it is aged from the middle of the days elapsed so far — the 1st through the build date/);
});
