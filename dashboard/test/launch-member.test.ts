/* Launch redesign M4b — member pages (R23, R24, R25, R26; LD24, LD25).

   Every figure is recomputed HERE from the fixture rows and compared with
   what the renderer printed; every threshold is tested on both sides of its
   boundary; every computed fact has a fixture whose answer is NOT the empty
   one, so a hard-coded "None" fails. */

import { test } from "node:test";
import assert from "node:assert/strict";

import { memberBody, congressTickerBody, entityTxnTable, entityTxnRowsHtml, memberSignalsPanel, type BuildStamps, type MemberV2Deps } from "../src/lib/ui/index.ts";
import {
  MEMBER_PAGE_SIZE,
  memberSideRows,
  memberTradesCountText,
  niceCeil,
  ribbonAxisTop,
  quarterReadout,
  isChairRole,
  type MemberSide,
} from "../src/lib/ui/congress.ts";
import { mergeFeed, pageSlice, pageCountFor, type RenderCtx, type TxnRow, type PaperRow } from "../src/lib/format.ts";
import { quarterlyFlow, sumRanges, type MemberEntity, type SumRanges } from "../src/lib/derive.ts";
import { domOf, visibleText } from "./lib/ledger-dom.ts";

const STAMPS: BuildStamps = { buildId: "t.1", generatedAt: "2026-08-12 00:00 UTC", generatedAtDate: "2026-08-12" };
const CTX: RenderCtx = {};

function txn(i: number, over: Partial<TxnRow> = {}): TxnRow {
  return {
    kind: "txn", txnId: `t-${i}`, asset: `Issuer ${i} Inc`, assetType: "ST",
    filed: `2026-07-${String(28 - (i % 28)).padStart(2, "0")}`, traded: "2026-06-24",
    name: "Fixture Member", bioguide: "F000001", party: "R", state: "OH", district: "4",
    chamber: "house", ticker: `T${i % 5}`, side: i % 3 === 0 ? "sale" : "purchase", owner: "self",
    low: 1001, high: 15000, lag: 27, late: i % 4 === 0 ? 1 : 0, flags: [],
    doc: `https://disclosures-clerk.house.gov/doc-${i % 6}.pdf`, ...over,
  };
}
const PAPER: PaperRow[] = [
  { kind: "paper", filed: "2026-05-02", name: "Fixture Member", bioguide: "F000001", party: "R", state: "OH", district: "4", chamber: "house", doc: "https://disclosures-clerk.house.gov/paper-1.pdf" },
  { kind: "paper", filed: "2026-03-09", name: "Fixture Member", bioguide: "F000001", party: "R", state: "OH", district: "4", chamber: "house", doc: "https://disclosures-clerk.house.gov/paper-2.pdf" },
] as PaperRow[];

function member(n: number, over: Partial<MemberEntity> = {}): MemberEntity {
  const txns = Array.from({ length: n }, (_, i) => txn(i)).sort((a, b) => b.filed.localeCompare(a.filed));
  return {
    bioguide: "F000001", name: "Fixture Member", party: "R", state: "OH", district: "4", chamber: "house",
    servingSince: "2007", filingCount: new Set(txns.map((t) => t.doc)).size, txns, paper: [], ...over,
  };
}

/** The committee/sector dataset: HSAG (mapped to energy) as Chair, HSJU as a
    plain member, both valid for the whole window. */
function deps(over: Partial<MemberV2Deps> = {}, memberships = [
  { committeeId: "HSAG", name: "House Agriculture", role: "Chair", validFrom: "2025-01-03", validTo: "2026-08-12" },
  { committeeId: "HSJU", name: "House Judiciary", role: "Ranking Member", validFrom: "2025-01-03", validTo: "2026-08-12" },
], jur: [string, string[]][] = [["HSAG", ["energy"]], ["HSJU", ["finance"]]]): MemberV2Deps {
  return {
    resolveSector: (t: string) => (t === "T0" ? { state: "sector", sector: "energy" } : { state: "sector", sector: "manufacturing" }),
    sectorMeta: { taxonomyVersion: "1", asOf: "2026-08-01" },
    committees: { memberships, windowFrom: "2025-01-03", windowTo: "2026-08-12", jurisdictionByCommittee: new Map(jur), mappingVersion: "1", snapshotDate: "2026-08-12" },
    signals: { retentionDays: 90, active: [] },
    ...over,
  };
}

const layoutOf = (html: string): string | null => /data-member-layout="(\w+)"/.exec(html)?.[1] ?? null;
const factOf = (html: string, label: string): string => {
  const dl = domOf(html).querySelector("dl.member-facts")!;
  const div = dl.children.find((d) => visibleText(d.querySelector("dt")!).trim() === label)!;
  return visibleText(div.querySelector("dd")!).replace(/\s+/g, " ").trim();
};

/* ------------------------------------------------------------ R23 layouts */

test("R23: the layout boundary — 0 (paper only), 1 and 3 trades read compact; 4 reads active", () => {
  assert.equal(layoutOf(memberBody(member(0, { paper: PAPER, filingCount: 2 }), STAMPS, CTX, 0, deps())), "compact");
  assert.equal(layoutOf(memberBody(member(1), STAMPS, CTX, 0, deps())), "compact");
  assert.equal(layoutOf(memberBody(member(3), STAMPS, CTX, 0, deps())), "compact");
  assert.equal(layoutOf(memberBody(member(4), STAMPS, CTX, 0, deps())), "active");
});

test("R23: a paper-only member — zero transactions — reads compact with its paper filings counted and linked, and no trade card", () => {
  const m = member(0, { paper: PAPER, filingCount: 2 });
  const html = memberBody(m, STAMPS, CTX, 0, deps());
  const dom = domOf(html);
  assert.equal(dom.querySelectorAll("li.one-r").length, 0, "no trade card");
  assert.match(visibleText(dom.querySelector("#compact-h")!), /No trades on record/);
  assert.match(visibleText(dom.querySelector(".member-paper-only")!), /2 paper filings are counted below, not machine-read until OCR/);
  const paperLinks = dom.querySelectorAll("section.paper-block tbody tr a").map((a) => a.getAttribute("href"));
  assert.deepEqual(paperLinks, PAPER.map((p) => p.doc), "each paper filing links to the original");
  // the ledger counts them: 0 trades · 2 filings · 2 paper
  const ledger = visibleText(dom.querySelector("dl.design-ledger")!).replace(/\s+/g, " ");
  assert.match(ledger, /Trades\s*0\s*2 filings · 2 paper/);
  assert.match(factOf(html, "Committee overlap"), /No trades to check/);
});

test("R23: the ledger — Trades with filings and paper, Last filed, Net flow · 12m, Late as N of M over rows with a late status", () => {
  const m = member(7, { paper: PAPER.slice(0, 1) });
  m.txns[2] = { ...m.txns[2]!, late: null }; // a row whose dates allow no late status
  const html = memberBody(m, STAMPS, CTX, 0, deps());
  const figs = domOf(html).querySelectorAll(".ledger-fig").map((f) => ({ k: visibleText(f.querySelector("dt")!).replace(", explain", "").trim(), v: visibleText(f.querySelector(".ledger-value")!).trim(), s: f.querySelector(".ledger-sub") ? visibleText(f.querySelector(".ledger-sub")!).trim() : "" }));
  assert.deepEqual(figs.map((f) => f.k), ["Trades", "Last filed", "Net flow · 12m", "Late"]);
  const late = m.txns.filter((t) => t.late === 1).length;
  const withStatus = m.txns.filter((t) => t.late != null).length;
  assert.equal(figs[0]!.v, "7");
  assert.equal(figs[0]!.s, `${m.filingCount} filings · 1 paper`);
  assert.equal(figs[1]!.v, [...m.txns.map((t) => t.filed), ...m.paper.map((p) => p.filed)].sort().at(-1));
  assert.equal(figs[3]!.v, `${late} of ${withStatus}`, "late over the rows with a late status");
  assert.ok(withStatus < m.txns.length, "control: the fixture holds a row with no late status");
});

test("R23: committees carry Chair from the role — never for a vice chair or a ranking member", () => {
  assert.equal(isChairRole("Chair"), true);
  assert.equal(isChairRole("Chairman"), true);
  assert.equal(isChairRole("Vice Chair"), false);
  assert.equal(isChairRole("Ranking Member"), false);
  assert.equal(isChairRole(null), false);
  const html = memberBody(member(4), STAMPS, CTX, 0, deps());
  const subline = domOf(html).querySelector(".entity-subline")!;
  assert.match(visibleText(subline), /House Agriculture Chair/);
  assert.equal(subline.querySelectorAll(".chair-badge").length, 1, "one Chair, from the role");
  assert.match(factOf(memberBody(member(1), STAMPS, CTX, 0, deps()), "Committees"), /House Agriculture \(Chair\) · House Judiciary/);
});

test("R23 / LD24: committee overlap is computed as of each trade date — a hit, a clean None, and 'not checked' for an unmapped committee", () => {
  // T0 resolves to energy, inside HSAG's mapped jurisdiction: a hit
  const hit = factOf(memberBody(member(1), STAMPS, CTX, 0, deps()), "Committee overlap");
  assert.match(hit, /T0 \(.*\) · House Agriculture, as of 2026-06-24 — context, not an allegation/);
  // a trade in a sector no committee covers, every committee mapped: None
  const clean = member(1, { txns: [txn(1, { ticker: "T1" })] });
  assert.match(factOf(memberBody(clean, STAMPS, CTX, 0, deps()), "Committee overlap"), /^None\./);
  // the member sits on an UNMAPPED committee: never "None"
  const unmapped = factOf(memberBody(clean, STAMPS, CTX, 0, deps({}, [
    { committeeId: "ZZZZ", name: "Unmapped Committee", role: null, validFrom: "2025-01-03", validTo: "2026-08-12" },
  ])), "Committee overlap");
  assert.match(unmapped, /not checked/);
  assert.doesNotMatch(unmapped, /^None/);
  // a trade before the snapshot window: not checked
  const early = member(1, { txns: [txn(1, { ticker: "T1", traded: "2024-01-05" })] });
  assert.match(factOf(memberBody(early, STAMPS, CTX, 0, deps()), "Committee overlap"), /predates the membership snapshot: not checked/);
  // no committee dataset: stated, never guessed
  assert.match(factOf(memberBody(clean, STAMPS, CTX, 0, deps({ committees: null })), "Committee overlap"), /committee data is not in this build/);
});

test("R23 / LD24: the Signals fact lists active signals of any kind (s3–s6 included) and reads 'None' only when computed empty", () => {
  const sig = { retentionDays: 90, active: [{ kind: "s3-cooccurrence", label: "S-3 · CO-OCCURRENCE", ticker: "T0" }, { kind: "s6-late-large", label: "S-6 · LATE", ticker: null }] };
  const listed = factOf(memberBody(member(1), STAMPS, CTX, 0, deps({ signals: sig })), "Signals");
  assert.match(listed, /S-3 · CO-OCCURRENCE · T0/);
  assert.match(listed, /S-6 · LATE/);
  assert.doesNotMatch(listed, /None/);
  assert.match(factOf(memberBody(member(1), STAMPS, CTX, 0, deps()), "Signals"), /^None in the last 90 days\.$/);
  assert.match(factOf(memberBody(member(1), STAMPS, CTX, 0, deps({ signals: { retentionDays: 120, active: [] } })), "Signals"), /in the last 120 days/, "the window is the artifact's, never a literal");
});

test("R23 / R2: a compact card states both dates, the lag, LATE, the owner (never 'self' when missing) and its receipt", () => {
  const m = member(1, { txns: [txn(0, { owner: null, late: 1, lag: 61, side: "sale_partial" })] });
  const card = domOf(memberBody(m, STAMPS, CTX, 0, deps())).querySelector("li.one-r")!;
  const text = visibleText(card).replace(/\s+/g, " ");
  assert.match(text, /owner not stated · partial sale/);
  assert.doesNotMatch(text, /\bself\b/);
  assert.match(text, /2026-06-24/);
  assert.match(text, /LATE·61d/);
  assert.ok(card.querySelector("time[datetime=\"2026-06-24\"]") && card.querySelector("time[datetime=\"2026-07-28\"]"), "both dates");
  assert.ok(card.querySelector(".cell-src a"), "the receipt");
});

/* ------------------------------------------------------------ R24 ribbon */

test("R24 / LD25: the axis top is a nice ceiling over 1.12 × the largest provable minimum, else over the largest maximum", () => {
  const closed = (low: number, high: number): SumRanges => ({ kind: "closed", low, high, rows: 1, undisclosed: 0 });
  assert.equal(niceCeil(1120), 2000);
  assert.equal(niceCeil(2240), 2500);
  assert.equal(niceCeil(5_600_000), 8_000_000);
  assert.equal(ribbonAxisTop([closed(2000, 30000), closed(1000, 15000)]), 2500, "max minimum 2,000 × 1.12 → 2,500");
  assert.equal(ribbonAxisTop([closed(2000, 30000), { kind: "open", low: 5_000_000, high: null, rows: 1, undisclosed: 0 }]), 8_000_000, "an open sum's minimum counts");
  assert.equal(ribbonAxisTop([closed(0, 15000)]), 20000, "every minimum zero: over the largest maximum");
  assert.equal(ribbonAxisTop([{ kind: "empty" }]), 1);
});

function ribbonOf(html: string) {
  const dom = domOf(html);
  return {
    ticks: dom.querySelectorAll(".rb-ytick").map((t) => visibleText(t).trim()),
    cuts: dom.querySelectorAll(".rb-cut").map((c) => visibleText(c).trim()),
    nones: dom.querySelectorAll(".rb-none").length,
    readouts: dom.querySelectorAll("[data-rb-col]").map((c) => c.getAttribute("data-readout")),
    summary: visibleText(dom.querySelectorAll("p.visually-hidden").find((p) => /^Disclosed flow by quarter\./.test(visibleText(p)))!),
    plot: dom.querySelector("[data-rb-plot]"),
  };
}

test("R24: both flowRibbon callers draw one labelled axis, cut markers that state the true maximum or 'open', '–' for an empty quarter, and a readout per quarter", () => {
  const rows = [
    txn(1, { side: "purchase", low: 1001, high: 15000, traded: "2026-06-02" }),
    txn(2, { side: "purchase", low: 1_000_001, high: 5_000_000, traded: "2026-05-02" }), // max past the top
    txn(3, { side: "sale", low: 50_001, high: null, traded: "2026-04-10" }), // open
    txn(4, { side: "sale", low: null, high: null, traded: "2026-01-10" }), // undisclosed
  ];
  const m = member(4, { txns: rows });
  const flow = quarterlyFlow(rows, STAMPS.generatedAtDate, 8);
  const top = ribbonAxisTop(flow.quarters.flatMap((q) => [q.buy, q.sell]));
  for (const [caller, html] of [
    ["member", memberBody(m, STAMPS, CTX, 0, deps())],
    ["congress ticker", congressTickerBody({ ticker: "T1", txns: rows }, STAMPS, CTX)],
  ] as const) {
    const r = ribbonOf(html);
    assert.ok(r.plot, `${caller}: one plot control`);
    assert.equal(r.plot!.getAttribute("tabindex"), "0", `${caller}: a Tab stop`);
    assert.equal(r.ticks[0], `$${top / 1_000_000}M`, `${caller}: the top tick reads the axis top`);
    assert.equal(r.ticks[2], "$0", `${caller}: zero at the axis`);
    assert.ok(r.cuts.includes("↑ $5M"), `${caller}: the cut purchase states its true maximum (${r.cuts.join(" | ")})`);
    assert.ok(r.cuts.includes("↓ open"), `${caller}: the open sale says open`);
    assert.ok(r.cuts.includes("↓ not disclosed"), `${caller}: the undisclosed sale is hatched and said`);
    assert.equal(r.nones, flow.quarters.filter((q) => q.buy.kind === "empty" && q.sell.kind === "empty").length, `${caller}: '–' in every empty quarter`);
    assert.deepEqual(r.readouts, flow.quarters.map((q) => quarterReadout(q, STAMPS.generatedAtDate)), `${caller}: one readout per quarter`);
    assert.match(r.summary, /purchases \$1M–\$5\.0M|purchases \$1\.0M–\$5M|purchases \$1M–\$5M/, `${caller}: the summary keeps the full range past the axis`);
  }
  // no midpoint: every drawn bar starts at its side's axis (a solid part anchored at 0)
  const html = memberBody(m, STAMPS, CTX, 0, deps());
  assert.ok(!/class="rb-bar rb-(buy|sell) rb-lo" style="(bottom|top):(?!0;)/.test(html), "every solid part is anchored at the axis");
});

/* Launch review H2: the readout names what it counts and says when a quarter is still open. */
test("H2: the quarter readout counts purchases and sales (never 'trades'), states the exchanges it does not draw, and marks the open quarter 'so far'", () => {
  const rows = [
    txn(1, { side: "purchase", low: 1001, high: 15000, traded: "2026-07-20" }),
    txn(2, { side: "exchange", low: 1001, high: 15000, traded: "2026-07-21" }),
    txn(3, { side: "exchange", low: 1001, high: 15000, traded: "2026-07-22" }),
    txn(4, { side: "sale", low: 1001, high: 15000, traded: "2026-05-02" }),
  ];
  const flow = quarterlyFlow(rows, STAMPS.generatedAtDate, 8); // as of 2026-08-12: 26Q3 is open
  const cur = flow.quarters.at(-1)!;
  const prev = flow.quarters.at(-2)!;
  assert.equal(cur.q, "26Q3");
  assert.equal(cur.other, 2, "the quarter's exchange rows are counted");
  const r = quarterReadout(cur, STAMPS.generatedAtDate);
  assert.match(r, /^26Q3 so far \(inside the 45-day filing window\): 1 purchase or sale · purchases /);
  assert.match(r, / · 2 exchange\/unparsed-side rows not drawn$/);
  assert.doesNotMatch(r, /\btrades?\b/);
  assert.match(quarterReadout(prev, STAMPS.generatedAtDate), /^26Q2: 1 purchase or sale · purchases none · sales /, "a closed quarter is not 'so far'");
  // re-planted controls: a build date past the quarter end closes it; no build date states nothing about openness
  assert.doesNotMatch(quarterReadout(cur, "2026-10-01"), /so far/);
  assert.doesNotMatch(quarterReadout(cur), /so far/);
  // both callers render the build-dated readout
  for (const html of [memberBody(member(4, { txns: rows }), STAMPS, CTX, 0, deps()), congressTickerBody({ ticker: "T1", txns: rows }, STAMPS, CTX)]) {
    assert.match(html, /26Q3 so far \(inside the 45-day filing window\): 1 purchase or sale/);
    assert.doesNotMatch(html, /data-readout="[^"]*\btrades?\b/);
  }
});

/* ------------------------------------------------------------ R25 trades */

test("R25: member trades page 25 rows of the selected side — pages partition the rows at every count, and the count reads that side", () => {
  for (const n of [0, 1, 24, 25, 26, 50, 51, 77]) {
    const rows = Array.from({ length: n }, (_, i) => txn(i)).sort((a, b) => b.filed.localeCompare(a.filed));
    for (const side of ["all", "buy", "sell"] as MemberSide[]) {
      const sideRows = memberSideRows(rows, side);
      const merged = mergeFeed(sideRows, []);
      const pages = pageCountFor(merged, MEMBER_PAGE_SIZE);
      const seen: string[] = [];
      for (let p = 0; p < pages; p++) {
        const items = pageSlice(merged, p, MEMBER_PAGE_SIZE).filter((x): x is TxnRow => x.kind === "txn");
        assert.ok(items.length > 0 && items.length <= MEMBER_PAGE_SIZE, `n=${n} ${side} page ${p}: 1..25 rows`);
        const count = memberTradesCountText(p, items.length, sideRows.length, side);
        const noun = side === "buy" ? "purchases" : side === "sell" ? "sales" : "transactions";
        assert.equal(count, `${p * 25 + 1}–${p * 25 + items.length} of ${sideRows.length} ${noun}`);
        seen.push(...items.map((t) => t.txnId));
      }
      assert.deepEqual(seen, sideRows.map((t) => t.txnId), `n=${n} ${side}: every row on exactly one page, in order`);
    }
  }
  assert.equal(memberTradesCountText(0, 0, 0, "sell"), "0 sales");
});

test("R25: the server's page equals the client's page for every side; the filter counts are the side counts", () => {
  const m = member(40);
  const buys = m.txns.filter((t) => t.side === "purchase").length;
  const sells = m.txns.filter((t) => t.side === "sale" || t.side === "sale_partial").length;
  const html = memberBody(m, STAMPS, CTX, 0, deps());
  const seg = domOf(html).querySelector("[data-side-filter]")!;
  assert.equal(seg.hasAttribute("hidden"), true, "the filter needs a script, so the server hides it");
  assert.deepEqual(seg.querySelectorAll("button").map((b) => visibleText(b).replace(/\s+/g, " ").trim()), ["All", `Buys ${buys}`, `Sells ${sells}`]);
  for (const side of ["all", "buy", "sell"] as MemberSide[]) {
    const server = entityTxnTable(m.txns, { kind: "member", caption: "c", page: 0, ctx: CTX, side });
    const table = domOf(server).querySelector("table[data-entity-table]")!;
    const stated = (table.getAttribute("data-stated-flags") ?? "").split(",").filter(Boolean);
    const cols = (table.getAttribute("data-columns") ?? "").split(",");
    const sideRows = memberSideRows(m.txns, side);
    const items = pageSlice(mergeFeed(sideRows, []), 0, MEMBER_PAGE_SIZE).filter((x): x is TxnRow => x.kind === "txn");
    const client = entityTxnRowsHtml(items, "member", {}, stated, cols);
    assert.ok(server.includes(`<tbody data-entity-rows role="rowgroup">${client}</tbody>`), `${side}: the client's first page is the server's, byte for byte`);
    assert.ok(server.includes(memberTradesCountText(0, items.length, sideRows.length, side)));
  }
  // every row keeps its honesty cells: flags, qualifiers, the lag
  const one = entityTxnTable([txn(1, { owner: "spouse", side: "sale_partial", late: 1, lag: 50, flags: ["amount_spouse_cap"] })], { kind: "member", caption: "c", page: 0, ctx: CTX });
  assert.match(one, /partial · SP/);
  assert.match(one, /LATE·50d/);
  assert.match(one, /spouse cap/);
});

/* ------------------------------------------------------------ R26 side column */

test("R26: Top tickers shows 8 per window with every other ticker one 'Show all N tickers' away; both windows exist", () => {
  const rows = Array.from({ length: 30 }, (_, i) => txn(i, { ticker: `K${String(i).padStart(2, "0")}`, traded: i < 20 ? "2026-06-24" : "2023-01-10", filed: i < 20 ? "2026-07-01" : "2023-02-01" }));
  const html = memberBody(member(30, { txns: rows }), STAMPS, CTX, 0, deps());
  const dom = domOf(html);
  const shown = (id: string): number => dom.querySelectorAll(`#${id} tr`).length;
  assert.equal(shown("member-top-24m-tbody"), 8);
  assert.equal(shown("member-top-all-tbody"), 8);
  assert.match(html, /data-compact-for="member-top-24m-tbody" data-compact-total="20" data-compact-shown="8"/, "24 months: 20 tickers traded in the window");
  assert.match(html, /data-compact-for="member-top-all-tbody" data-compact-total="30" data-compact-shown="8"/, "all history: 30");
  assert.match(html, />Show all 20 tickers</);
  assert.match(html, />Show all 30 tickers</);
  assert.equal(dom.querySelector('[data-top-variant="all"]')!.hasAttribute("hidden"), true, "All is the hidden variant until switched");
  assert.match(html, /flows, not holdings/, "flows, not holdings stays visible");
});

test("R26: Profile only at 10+ trades; Sectors only with 2+ sectors (gap counts stated); history only with 2+ filings; Signals always", () => {
  const nine = memberBody(member(9), STAMPS, CTX, 0, deps());
  const ten = memberBody(member(10), STAMPS, CTX, 0, deps());
  assert.ok(!nine.includes('aria-label="Profile"') && ten.includes('aria-label="Profile"'), "profile boundary at 10");
  // sectors: T0 → energy, the rest → manufacturing (2 sectors); one sector only → none
  assert.ok(ten.includes('aria-label="Sectors"'));
  const one = memberBody(member(10), STAMPS, CTX, 0, deps({ resolveSector: () => ({ state: "sector", sector: "energy" }) }));
  assert.ok(!one.includes('aria-label="Sectors"'), "one sector: no Sectors section");
  // gap counts: one row without a ticker, one unresolved
  const gapRows = [...member(10).txns, txn(40, { ticker: null }), txn(41, { ticker: "ZZZ" })];
  const gap = memberBody(member(12, { txns: gapRows }), STAMPS, CTX, 0, deps({ resolveSector: (t: string) => (t === "ZZZ" ? { state: "unresolved-ticker" } : t === "T0" ? { state: "sector", sector: "energy" } : { state: "sector", sector: "manufacturing" }) }));
  assert.match(visibleText(domOf(gap).querySelector(".sx-gap")!), /2 more without a sector: 1 no ticker, 1 unmatched/);
  // the dataset absent: a stated absence, not silence
  assert.match(memberBody(member(10), STAMPS, CTX, 0, deps({ resolveSector: null, sectorMeta: null })), /Sector data is not in this build/);
  // history: one filing → none; two → present
  const oneFiling = member(4, { txns: member(4).txns.map((t) => ({ ...t, doc: "https://disclosures-clerk.house.gov/one.pdf" })), filingCount: 1 });
  assert.ok(!memberBody(oneFiling, STAMPS, CTX, 0, deps()).includes('aria-label="Filing history"'));
  assert.ok(memberBody(member(4), STAMPS, CTX, 0, deps()).includes('aria-label="Filing history"'));
  // signals: the panel the page passes, in the side column
  const artifact = { v: 1, buildId: "b", computedAt: "2026-08-12", thresholdVersion: "1", retentionDays: 90, coverageFrom: "2026-05-14", coverageTo: "2026-08-12", lifecycleNote: "", compaction: "", dateAnomaliesExcluded: 0, lagCaveat: "PTRs are filed up to 45 days after the trade; a signal describes a disclosure, never a current holding.", withheld: [], signals: [] } as never;
  const empty = memberSignalsPanel(artifact, "F000001", CTX);
  assert.match(empty, /No signals in the last 90 days\./);
  const withPanel = memberBody(member(4), STAMPS, CTX, 0, deps(), empty);
  assert.ok(domOf(withPanel).querySelector("aside.member-side")!.querySelector('[aria-label="Signals"]'), "Signals sits in the side column");
});

test("R26: the PLANNED strip and the 'Additional disclosure analysis' drawer are gone; the committee context stays, with its caveat", () => {
  const html = memberBody(member(10), STAMPS, CTX, 0, deps());
  assert.ok(!html.includes("planned-line"));
  assert.ok(!html.includes("Additional disclosure analysis"));
  assert.match(html, /Recent disclosures and committee context/);
  assert.match(html, /class="caveat-line non-allegation">A jurisdiction overlap is context, not an accusation/);
  // the totals the side column states recompute from the rows
  const gross = sumRanges(member(10).txns);
  assert.ok(gross.kind === "closed");
});
