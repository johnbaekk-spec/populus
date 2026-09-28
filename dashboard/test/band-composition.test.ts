/* DESIGN-POLISH M2 — band composition and the one header ledger (R10, R13–R15;
   Architecture E/F; tasks T2.3, T2.4, T2.8 and the band balance of D-8).

   Every test names its property and carries a control that fails when the
   property breaks. Geometry (the cells ending within 96px, value tops within
   ±1px) is measured in test/geometry/; these are the unit halves. */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { type TxnRow } from "../src/lib/format.ts";
import { quarterlyFlow, type QuarterlyFlowResult } from "../src/lib/derive.ts";
import {
  consensusConvictionBandHtml,
  filerLedgerHtml,
  flowRibbon,
  newPositionLeadersHtml,
  SIGNAL_HITS_COMPACT_ROWS,
  SIGNAL_HITS_PAGE_SIZE,
} from "../src/lib/ui/index.ts";
import { consensusBoardHtml, CONSENSUS_COMPACT_ROWS } from "../src/lib/notable-moves.ts";
import {
  disclosureLedger,
  ledgerItemProblem,
  LEDGER_PLAIN_SUB_MAX,
  LEDGER_TONES,
  markPairPrimary,
  pairBandHtml,
  type LedgerItem,
} from "../src/lib/ui/shared.ts";
import { renderParitySurfaces } from "./lib/ui-parity-surfaces.ts";
import { baseStylesheet } from "./lib/styles.ts";
import { MiniElement } from "./lib/mini-dom.ts";
import { domOf, figuresOf, ledgerFigures, ledgers, ledgerStructureProblems, visibleText } from "./lib/ledger-dom.ts";
import { compareBands, type BandMap, type PageMeasure } from "./geometry/canvas-compare.ts";

const SRC = path.resolve(import.meta.dirname, "..", "src");

function txn(over: Partial<TxnRow> = {}): TxnRow {
  return {
    kind: "txn", txnId: "t", asset: "A", assetType: null, filed: "2024-02-01", traded: "2024-01-02",
    name: "M", bioguide: "M000001", party: "R", state: "OK", district: null, chamber: "senate",
    ticker: "WMB", side: "purchase", owner: "self", low: 1001, high: 15000, lag: 30, late: 0, flags: [],
    doc: "https://efdsearch.senate.gov/x", ...over,
  };
}

/* ======================================================================
   T2.3 — the member chart's empty window (R13)
   ====================================================================== */

/** The empty-window contract, as ONE predicate its controls run through: the
    chart collapses to its one line EXACTLY when every quarter is empty and no
    side was excluded; otherwise the plot renders. */
function emptyWindowProblems(flow: QuarterlyFlowResult, html: string): string[] {
  const root = domOf(html);
  const line = root.querySelector("p.flow-window-empty");
  const track = root.querySelector(".rb-track");
  const shouldCollapse = flow.excludedSides === 0 && flow.quarters.every((q) => q.buy.kind === "empty" && q.sell.kind === "empty");
  const out: string[] = [];
  if (shouldCollapse && (!line || track)) out.push("an empty window renders its line and no plot");
  if (!shouldCollapse && (line || !track)) out.push("a window with anything to show (or an excluded side) renders the plot");
  return out;
}

test("T2.3: an empty window is ONE line — the window, the last trade date, the non-zero undated/anomaly counts — and no .rb-track", () => {
  // every row outside the 8-quarter window, one undated row, one date anomaly; nothing excluded by side
  const rows = [
    txn({ txnId: "old", traded: "2019-03-04", filed: "2019-04-01" }),
    txn({ txnId: "undated", traded: null, filed: "2026-07-01" }),
    txn({ txnId: "anomaly", traded: "2026-06-01", filed: "2026-06-02", flags: ["date_anomaly"] }),
  ];
  const flow = quarterlyFlow(rows, "2026-07-24", 8);
  assert.equal(flow.excludedSides, 0);
  assert.equal(flow.undated, 1);
  assert.equal(flow.dateAnomalies, 1);
  const html = flowRibbon(flow, { twoSided: false, sourceLine: "s", notes: { scope: "member-chart" }, emptyWindow: { latestTraded: "2019-03-04" } });
  assert.deepEqual(emptyWindowProblems(flow, html), []);
  const line = visibleText(domOf(html).querySelector("p.flow-window-empty")!);
  const first = flow.quarters[0]!, last = flow.quarters[flow.quarters.length - 1]!;
  assert.ok(line.includes(`${first.q}–${last.q}`), "the window's quarters");
  assert.ok(line.includes(last.quarterEnd), "the window's end date");
  assert.ok(line.includes("2019-03-04"), "the member's last disclosed trade date");
  assert.match(line, /1 row has no parseable trade date/, "the non-zero undated count");
  assert.match(line, /1 date-anomaly row is excluded/, "the non-zero anomaly count");
  assert.equal(domOf(html).querySelectorAll("p.flow-window-empty").length, 1, "exactly one line");
  assert.ok(domOf(html).querySelector(".rb-caption"), "the chart's method note stays");

  // zero counts are not printed
  const clean = quarterlyFlow([txn({ traded: "2019-03-04" })], "2026-07-24", 8);
  const cleanLine = visibleText(domOf(flowRibbon(clean, { twoSided: false, sourceLine: "s", emptyWindow: { latestTraded: "2019-03-04" } })).querySelector("p.flow-window-empty")!);
  assert.doesNotMatch(cleanLine, /parseable|anomaly/);
});

test("T2.3 (review R2-4): an empty window whose final quarter has not closed ends at the build date, never a future quarter end", () => {
  const flow = quarterlyFlow([txn({ traded: "2019-03-04" })], "2026-07-24", 8);
  const last = flow.quarters[flow.quarters.length - 1]!;
  assert.ok(last.quarterEnd > "2026-07-24", `the fixture's final quarter is still open (${last.quarterEnd})`);
  const line = (asOf?: string): string =>
    visibleText(domOf(flowRibbon(flow, { twoSided: false, sourceLine: "s", emptyWindow: { latestTraded: "2019-03-04", ...(asOf ? { asOf } : {}) } })).querySelector("p.flow-window-empty")!);
  const bounded = line("2026-07-24");
  assert.match(bounded, /through 2026-07-24, the build date\)/);
  assert.ok(!bounded.includes(last.quarterEnd), "no future quarter end is stated as known-empty");
  // a closed final quarter keeps its own end date
  const closed = quarterlyFlow([txn({ traded: "2019-03-04" })], "2026-06-30", 8);
  const closedLast = closed.quarters[closed.quarters.length - 1]!;
  const closedLine = visibleText(domOf(flowRibbon(closed, { twoSided: false, sourceLine: "s", emptyWindow: { latestTraded: "2019-03-04", asOf: "2026-06-30" } })).querySelector("p.flow-window-empty")!);
  assert.ok(closedLine.includes(`to ${closedLast.quarterEnd}`), closedLine);
  // control: without the build date the open quarter's future end is printed — the defect
  assert.ok(line().includes(last.quarterEnd), "control: the pre-fix line states the future quarter end");
});

test("T2.3: with an excluded side the plot renders (the line would hide that exclusion)", () => {
  // an exchange row traded INSIDE the window: every quarter's buy/sell is empty, but a side was excluded
  const rows = [txn({ side: "exchange", traded: "2026-06-01", filed: "2026-06-20" })];
  const flow = quarterlyFlow(rows, "2026-07-24", 8);
  assert.equal(flow.excludedSides, 1);
  assert.ok(flow.quarters.every((q) => q.buy.kind === "empty" && q.sell.kind === "empty"));
  const html = flowRibbon(flow, { twoSided: false, sourceLine: "s", emptyWindow: { latestTraded: "2026-06-01" } });
  assert.deepEqual(emptyWindowProblems(flow, html), []);
  assert.match(html, /1 exchange\/unparsed-side rows excluded/, "the exclusion is stated with the plot");
  // control: collapsing this window to its line (the renderer's output for the same
  // quarters with the excluded side ignored) fails the contract
  const collapsed = flowRibbon({ ...flow, excludedSides: 0 }, { twoSided: false, sourceLine: "s", emptyWindow: { latestTraded: "2026-06-01" } });
  assert.ok(emptyWindowProblems(flow, collapsed).length > 0, "control: collapsing with an excluded side fails");
  // and without the member's opt-in the chart never collapses (the ticker page's ribbon is unchanged)
  assert.ok(domOf(flowRibbon({ ...flow, excludedSides: 0 }, { twoSided: true, sourceLine: "s" })).querySelector(".rb-track"));
});

/* ======================================================================
   R10 — a band never holds an empty-state cell uncollapsed (T2.3, T2.4)
   ====================================================================== */

/** A cell that is ONLY its empty-state line: a one-line unavailable panel, a
    section marked `data-empty-state`, or a section that holds a head and one
    note and nothing else (no table, no list). */
function isEmptyStateCell(cell: MiniElement): boolean {
  if (cell.classList.contains("design-unavailable-line") || cell.hasAttribute("data-empty-state")) return true;
  if (cell.tagName !== "section") return false;
  const body = cell.children.filter((c) => !c.classList.contains("panel-head"));
  return body.length === 1 && body[0]!.tagName === "p" && body[0]!.classList.contains("section-note");
}
/** R10: a band holding an empty-state cell must say it collapsed; a band that
    says so must hold one; a collapsed band's empty line comes AFTER the other
    cell (a band whose cells are ALL lines has no other cell to sit under —
    M2F-D2). */
function bandCollapseProblems(band: MiniElement): string[] {
  const out: string[] = [];
  const empties = band.children.filter(isEmptyStateCell);
  const collapsed = band.getAttribute("data-collapsed") === "empty-state";
  if (empties.length > 0 && !collapsed) out.push("a band holds an empty-state cell uncollapsed");
  if (collapsed && empties.length === 0) out.push("a band claims an empty-state collapse without an empty-state cell");
  if (collapsed && empties.length > 0 && empties.length < band.children.length && band.children.indexOf(empties[0]!) === 0) out.push("the empty line leads instead of sitting under the other cell");
  return out;
}

const LEADERS_NONE = { period: "2026-03-31", thresholdBps: 200, rows: [], incompleteBooks: 2, evaluated: 40 };
const LEADERS_SOME = {
  period: "2026-03-31", thresholdBps: 200, incompleteBooks: 0, evaluated: 40,
  rows: [{ cik: "0000000001", filerName: "A Filer", maxWeightBps: 450, atThreshold: 1, newPositions: 3 }],
};
const BOARD = {
  period: "2026-03-31", minFilers: 3, qualifying: 1,
  rows: [{ issuerKey: "k", issuer: "Nvidia Corp", ticker: "NVDA", newStakes: 3, adds: 0, trims: 0, exits: 0, filers: 3, netDeltaUsd: 100, netDeltaPartial: false, topMover: null }],
};

const LEADERS_FIVE = {
  period: "2026-03-31", thresholdBps: 200, incompleteBooks: 0, evaluated: 40,
  rows: Array.from({ length: 5 }, (_, i) => ({ cik: `000000000${i + 1}`, filerName: `Filer ${i + 1}`, maxWeightBps: 450 - i * 10, atThreshold: 1, newPositions: 3 })),
};
const filerHref = (c: string): string => `/f/${c}`;
/** The I1 grid declaration: [primary fraction, side fraction], or null. */
function i1Fractions(css: string): [number, number] | null {
  const m = /\.design-institutional-band \{ grid-template-columns:minmax\(0,([\d.]+)fr\) minmax\(0,([\d.]+)fr\); \}/.exec(css);
  return m ? [Number(m[1]), Number(m[2])] : null;
}
/** Coordinator decision CD-5, as ONE predicate: a paired band I1 is Consensus
    │ Conviction leaders in that order, Consensus is its ONE primary cell, and
    the grid gives the primary the wider fraction — 1.3fr │ 1fr, the approved
    preview's composition. */
function i1CompositionProblems(band: MiniElement, css: string): string[] {
  const out: string[] = [];
  if (band.getAttribute("data-collapsed") !== "empty-state") {
    const labels = band.children.map((c) => c.getAttribute("aria-label") ?? "?");
    if (labels.join(" │ ") !== "Consensus │ Conviction leaders") out.push(`cells ${labels.join(" │ ")} (Consensus │ Conviction leaders)`);
    const primaries = band.children.filter((c) => c.hasAttribute("data-pair-primary")).map((c) => c.getAttribute("aria-label"));
    if (primaries.length !== 1 || primaries[0] !== "Consensus") out.push(`primary: ${primaries.join(", ") || "none"} (Consensus)`);
  }
  const fr = i1Fractions(css);
  if (!fr) out.push("no I1 grid declaration");
  else if (fr[0] !== 1.3 || fr[1] !== 1) out.push(`I1 grid ${fr[0]}fr │ ${fr[1]}fr (1.3fr │ 1fr, the primary first)`);
  return out;
}

test("T2.4: no qualifying conviction filer collapses band I1 — one column, the empty line after Consensus", () => {
  const consensus = consensusBoardHtml(BOARD as never, { filerHref: (c) => `/f/${c}` });
  const conviction = newPositionLeadersHtml(LEADERS_NONE as never, () => "top", "2026-03-31");
  const band = domOf(consensusConvictionBandHtml(consensus, conviction)).children[0]!;
  assert.ok(band.classList.contains("design-band") && band.classList.contains("design-consensus-band"));
  assert.equal(band.getAttribute("data-collapsed"), "empty-state");
  assert.deepEqual(band.children.map((c) => c.getAttribute("aria-label") ?? c.getAttribute("class")), ["Consensus", "design-unavailable-line design-newpositions"]);
  assert.match(visibleText(band.children[1]!), /Zero is the computed answer/, "the computed zero is stated, not a placeholder");
  assert.deepEqual(bandCollapseProblems(band), []);
  // the collapse is ONE column in CSS, and it outranks each pair's own two-column rule
  const css = baseStylesheet().replace(/\/\*[\s\S]*?\*\//g, "");
  assert.match(css, /\.design-band\[data-collapsed="empty-state"\] \{ grid-template-columns:minmax\(0,1fr\); \}/);

  // an empty CONSENSUS cell (its renderer marks it `data-empty-state`) goes under the Conviction table, never above it
  const emptyBoard = consensusBoardHtml({ ...BOARD, rows: [], qualifying: 0 } as never, { filerHref: (c) => `/f/${c}` });
  assert.match(emptyBoard, /^<section\b[^>]*\bdata-empty-state\b/, "the empty board carries its empty-state marker");
  const flipped = domOf(consensusConvictionBandHtml(emptyBoard, newPositionLeadersHtml(LEADERS_SOME as never, () => "top", "2026-03-31"))).children[0]!;
  assert.deepEqual(flipped.children.map((c) => c.getAttribute("aria-label")), ["Conviction leaders", "Consensus"]);
  assert.deepEqual(bandCollapseProblems(flipped), []);

  // both cells with rows: a real pair, no collapse — Consensus the primary (CD-5)
  const paired = domOf(consensusConvictionBandHtml(consensus, newPositionLeadersHtml(LEADERS_SOME as never, () => "top", "2026-03-31"))).children[0]!;
  assert.equal(paired.getAttribute("data-collapsed"), null);
  assert.deepEqual(bandCollapseProblems(paired), []);
  assert.deepEqual(primaryProblems(paired), []);
  assert.deepEqual(i1CompositionProblems(paired, css), []);
  // a collapse makes the remaining content cell the primary, whichever it is
  assert.deepEqual(primaryProblems(band), []);
  assert.deepEqual(primaryProblems(flipped), []);

  // control: a band holding the empty line WITHOUT data-collapsed fails R10
  const lost = domOf(consensusConvictionBandHtml(consensus, conviction).replace(' data-collapsed="empty-state"', "")).children[0]!;
  assert.deepEqual(bandCollapseProblems(lost), ["a band holds an empty-state cell uncollapsed"]);
  // control: a collapse claimed over two full cells fails too
  const liar = domOf(pairBandHtml("design-pair", consensus, newPositionLeadersHtml(LEADERS_SOME as never, () => "top", "2026-03-31"), { primary: "right" }).replace('class="design-band design-pair"', 'class="design-band design-pair" data-collapsed="empty-state"')).children[0]!;
  assert.ok(bandCollapseProblems(liar).length > 0);
  // control (review Q2-3): the empty board WITHOUT its marker is not collapsed —
  // the band reads the collapse off the cell, never off a flag the page computes
  const unmarked = domOf(consensusConvictionBandHtml(emptyBoard.replace(" data-empty-state", ""), newPositionLeadersHtml(LEADERS_SOME as never, () => "top", "2026-03-31"))).children[0]!;
  assert.equal(unmarked.getAttribute("data-collapsed"), null);
  assert.deepEqual(bandCollapseProblems(unmarked), ["a band holds an empty-state cell uncollapsed"], "control: the section-shaped empty board is still caught by the predicate");
});

/* ======================================================================
   CD-1 / Q2-2 — every pair names ONE primary cell
   ====================================================================== */

/** The primary rule, as ONE predicate: a real pair has exactly one
    `data-pair-primary` cell; a collapsed pair's primary is its content cell,
    which leads, with the empty line last; a band of empty-state lines only
    names NO primary — it is not a pair to measure (M2F-D2). */
function primaryProblems(band: MiniElement): string[] {
  const primaries = band.children.filter((c) => c.hasAttribute("data-pair-primary"));
  const out: string[] = [];
  if (band.getAttribute("data-collapsed") === "empty-state") {
    const allEmpty = band.children.every((c) => isEmptyStateCell(c));
    if (allEmpty && primaries.length > 0) out.push("a band of empty-state lines names a primary (it is not a pair to measure)");
    if (!allEmpty && (primaries.length !== 1 || band.children[0] !== primaries[0])) out.push("a collapsed pair's content cell is its one primary and leads");
    return out;
  }
  if (primaries.length !== 1) out.push(`${primaries.length} primary cells (exactly one)`);
  return out;
}

test("CD-1 (Q2-2): pairBandHtml marks exactly one primary cell, on either side; a collapse makes the content cell the primary", () => {
  const left = '<section class="panel" aria-label="A"><table><thead><tr><th>a</th></tr></thead></table></section>';
  const right = '<div class="side"><p>side</p></div>';
  const l = domOf(pairBandHtml("design-pair", left, right, { primary: "left" })).children[0]!;
  assert.deepEqual(l.children.map((c) => c.hasAttribute("data-pair-primary")), [true, false]);
  assert.deepEqual(primaryProblems(l), []);
  const r = domOf(pairBandHtml("design-pair", left, right, { primary: "right" })).children[0]!;
  assert.deepEqual(r.children.map((c) => c.hasAttribute("data-pair-primary")), [false, true], "the primary may be the RIGHT cell");
  assert.deepEqual(primaryProblems(r), []);
  // the side cell is the empty one: collapsed, content first and primary
  const line = '<section class="panel" aria-label="S" data-empty-state><p class="section-note">none</p></section>';
  const c = domOf(pairBandHtml("design-pair", line, left, { primary: "left" })).children[0]!;
  assert.equal(c.getAttribute("data-collapsed"), "empty-state");
  assert.deepEqual(c.children.map((x) => x.getAttribute("aria-label")), ["A", "S"]);
  assert.deepEqual(primaryProblems(c), []);
  // controls: two primaries, and none, are each caught
  const two = domOf(pairBandHtml("design-pair", left, right, { primary: "left" }).replace('<div class="side"', '<div data-pair-primary class="side"')).children[0]!;
  assert.deepEqual(primaryProblems(two), ["2 primary cells (exactly one)"]);
  const none = domOf(pairBandHtml("design-pair", left, right, { primary: "left" }).replace(" data-pair-primary", "")).children[0]!;
  assert.deepEqual(primaryProblems(none), ["0 primary cells (exactly one)"]);
  // a cell that is not one element is refused (each top-level element is its own grid cell)
  assert.throws(() => pairBandHtml("design-pair", "text", right, { primary: "left" }), /one element/);
  assert.throws(() => markPairPrimary("  "), /one root element/);
});

test("CD-2: a lone table of at most three columns left by a collapse is marked narrow and capped at half the band", () => {
  const line = '<section class="panel" aria-label="S" data-empty-state><p class="section-note">none</p></section>';
  const table = (n: number): string =>
    `<section class="panel" aria-label="T"><div class="table-scroll"><table class="etable"><thead><tr>${"<th>h</th>".repeat(n)}</tr></thead><tbody></tbody></table></div></section>`;
  const narrow = domOf(pairBandHtml("design-pair", table(3), line, { primary: "left" })).children[0]!;
  assert.ok(narrow.children[0]!.hasAttribute("data-pair-narrow"), "three columns: capped");
  const wide = domOf(pairBandHtml("design-pair", table(4), line, { primary: "left" })).children[0]!;
  assert.equal(wide.children[0]!.hasAttribute("data-pair-narrow"), false, "control: four columns keep the band width");
  const paired = domOf(pairBandHtml("design-pair", table(3), table(3), { primary: "left" })).children[0]!;
  assert.equal(paired.children.some((c) => c.hasAttribute("data-pair-narrow")), false, "control: a real pair is never capped");
  // the member's collapsed Filing history (three columns) takes the cap
  const css = baseStylesheet().replace(/\/\*[\s\S]*?\*\//g, "");
  assert.match(css, /@media \(min-width: 1081px\) \{\s*\.design-band\[data-collapsed="empty-state"\] > \[data-pair-narrow\] \{ width:50%; \}/);
});

/* ======================================================================
   CD-1 — the primary tables' FIXED defaults (review Q2-10)
   ====================================================================== */

/** The fixed-default rule, as ONE predicate over the default N a primary table
    shows beside each of several partner cells: the same N whatever the
    partner, and exactly the approved default. */
function fixedDefaultProblems(shownByPartner: readonly number[], want: number): string[] {
  const out: string[] = [];
  if (new Set(shownByPartner).size !== 1) out.push(`the default N follows its partner: ${shownByPartner.join(", ")}`);
  if (shownByPartner.some((n) => n !== want)) out.push(`the default N is not the fixed ${want}: ${shownByPartner.join(", ")}`);
  return out;
}
const shownOf = (html: string, rootId: string): number =>
  Number(new RegExp(`data-compact-for="${rootId}"[^>]*data-compact-shown="(\\d+)"`).exec(html)?.[1] ?? Number.NaN);
/** The WITHDRAWN model (M2-D1, M2F-D1) — a default N estimated from the
    partner cell's height — kept here only as the controls' defect: the
    production helper (`balancedCompactRows`) is deleted. */
function partnerTunedRows(o: { partnerPx: number; chromePx: number; max: number; rowPx?: number }): number {
  return Math.max(Math.min(3, o.max), Math.min(o.max, Math.round((o.partnerPx - o.chromePx) / (o.rowPx ?? 30))));
}

test("CD-1 (Q2-10): member flows show 20 and the filing history 12 whatever the side cell holds; a partner-tuned N fails", async () => {
  const { memberBody, memberSignalsPanel } = await import("../src/lib/ui/index.ts");
  const stamps = { buildId: "b", generatedAt: "2026-07-24 06:56 UTC", generatedAtDate: "2026-07-24" };
  const ctx = { watched: new Set<string>() };
  // 30 tickers and 30 filings, so both compact tables hold rows back
  const rows = Array.from({ length: 30 }, (_, i) => txn({ txnId: `t${i}`, ticker: `T${String(i).padStart(2, "0")}`, bioguide: "T000001", traded: "2026-06-24", filed: `2026-${String(1 + (i % 6)).padStart(2, "0")}-${String(1 + i).padStart(2, "0")}`, doc: `https://efdsearch.senate.gov/x/${i}` }));
  const member = { bioguide: "T000001", name: "Fixture", party: "R", state: "OK", district: null, chamber: "senate", servingSince: "1999", filingCount: 30, txns: rows, paper: [] } as never;
  const noSector = { resolveSector: null, sectorMeta: null, committees: null };
  const sectors = { resolveSector: (t: string) => ({ state: "sector" as const, sector: `S${t.slice(-1)}` }), sectorMeta: { taxonomyVersion: "1", asOf: "2026-01-01" }, committees: null };
  const artifact = { v: 1, buildId: "b", computedAt: "2026-07-24", thresholdVersion: "1", retentionDays: 90, coverageFrom: "2026-04-25", coverageTo: "2026-07-24", lifecycleNote: "n", compaction: "none", dateAnomaliesExcluded: 0, lagCaveat: "c", withheld: [],
    signals: Array.from({ length: 8 }, (_, i) => ({ id: `s1-large:${i}`, kind: "s1-large", rule: "r", thresholdVersion: "1", entities: { bioguide: "T000001", memberName: "Fixture", ticker: "WMB" }, magnitude: { low: 250001, high: 500000 }, receipts: ["https://efdsearch.senate.gov/x"], occurrence: { tradeDate: "2026-06-24", filedDate: "2026-07-11" }, sourceAvailableAt: "2026-07-11", computedAt: "2026-07-24", firstSeenBuild: "b", lastSeenBuild: "b", status: "active", cohort: "senate" })) } as never;
  const signals = [memberSignalsPanel(artifact, "T000001", ctx), memberSignalsPanel(artifact, "Z999999", ctx), ""];
  const flows: number[] = [], history: number[] = [];
  for (const deps of [noSector, sectors]) {
    for (const sig of signals) {
      const html = memberBody(member, stamps, ctx, 0, deps, sig);
      flows.push(shownOf(html, "member-flows-tbody"));
      history.push(shownOf(html, "member-history-tbody"));
    }
  }
  assert.deepEqual(fixedDefaultProblems(flows, 20), [], "member flows: 20, fixed");
  assert.deepEqual(fixedDefaultProblems(history, 12), [], "filing history: 12, fixed");
  /* control: the M2-D1 model — N tuned to the partner cell by a height
     estimate (the no-sector profile, then a 14-row sector mix beside it) —
     fails the fixed-default rule */
  const tuned = [250 + 44, 250 + 95 + 14 * 30].map((partnerPx) => partnerTunedRows({ partnerPx, chromePx: 98, max: 20 }));
  assert.ok(fixedDefaultProblems(tuned, 20).length > 0, `control: a partner-tuned N (${tuned.join(", ")}) fails`);
});

test("CD-1 (Q2-10): the filer's reported positions show 20 and the signal hits 12, fixed; the hits page still holds 50", async () => {
  const { holdingsTableHtml, HOLDINGS_COMPACT_ROWS } = await import("../src/lib/holdings.ts");
  const row = (i: number) => ({ cik: "1", period: "2026-03-31", filing_key: null, security_id: null, cusip: null, issuer_name: `Issuer ${i}`, title_of_class: null, value_usd: 1000 + i, shares: 10, ssh_type: "SH", put_call: null, position_key: `k${i}`, flags: [] }) as never;
  const html = holdingsTableHtml({ cik: "1", filerName: "F", period: "2026-03-31", rows: Array.from({ length: 60 }, (_, i) => row(i)), filings: {}, page: 0, reference: true });
  assert.equal(HOLDINGS_COMPACT_ROWS, 20);
  assert.deepEqual(fixedDefaultProblems([shownOf(html, "filer-holdings-tbody")], 20), []);
  assert.equal(SIGNAL_HITS_COMPACT_ROWS, 12);
  assert.equal(SIGNAL_HITS_PAGE_SIZE, 50, "the pager still moves by 50");
  // the renderers take no partner input any more: the signature is the pin
  assert.doesNotMatch(readFileSync(path.join(SRC, "lib", "holdings.ts"), "utf-8"), /pairPx/, "no partner height reaches the holdings renderer");
  assert.doesNotMatch(readFileSync(path.join(SRC, "lib", "ui", "signals.ts"), "utf-8"), /signalHitsCompactRows/, "no partner height reaches the hits renderer");
  // control: a tuned hits N beside a two-row lag list fails the pin
  const tunedHits = [2, 8].map((lag) => partnerTunedRows({ partnerPx: 10 + 47 + lag * 35 + 285, chromePx: 239, max: 50 }));
  assert.ok(fixedDefaultProblems(tunedHits, 12).length > 0, `control: ${tunedHits.join(", ")}`);
});

/* ======================================================================
   CD-5 — band I1: Consensus (primary, a fixed 10) │ Conviction leaders
   ====================================================================== */

/** Every production source file (every .ts and .astro under src) — the sweep
    for a row count derived from a height. */
function productionSources(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rel of readdirSync(SRC, { recursive: true }) as string[]) {
    if (/\.(ts|astro)$/.test(rel)) out[rel.split(path.sep).join("/")] = readFileSync(path.join(SRC, rel), "latin1");
  }
  return out;
}
/** A row count derived from a cell's or its partner's height: the withdrawn
    estimators and their pixel inputs, by name. */
const HEIGHT_DERIVED = /\b(?:balancedCompactRows|consensusPairedRows|signalHitsCompactRows|filerSideCellPx|memberProfileCellPx|memberSignalsCellPx|LEDGER_ROW_PX|partnerPx|chromePx|pairPx)\b/;
function heightDerivedCountProblems(sources: Record<string, string>): string[] {
  return Object.entries(sources).filter(([, src]) => HEIGHT_DERIVED.test(src)).map(([rel, src]) => `${rel}: ${HEIGHT_DERIVED.exec(src)![0]}`);
}

test("CD-5: Consensus shows a FIXED 10 beside any Conviction list (or none); no row count anywhere depends on the partner cell; a partner-dependent count fails", () => {
  // 30 qualifying issuers, so the board holds rows back whatever its partner
  const board = { ...BOARD, qualifying: 30, rows: Array.from({ length: 30 }, (_, i) => ({ ...BOARD.rows[0]!, issuerKey: `k${i}`, issuer: `Issuer ${i}`, ticker: null })) };
  const shown: number[] = [];
  for (const leaders of [LEADERS_NONE, LEADERS_SOME, LEADERS_FIVE]) {
    const html = consensusConvictionBandHtml(consensusBoardHtml(board as never, { filerHref }), newPositionLeadersHtml(leaders as never, () => "top", "2026-03-31"));
    shown.push(shownOf(html, "inst-consensus-tbody"));
  }
  assert.equal(CONSENSUS_COMPACT_ROWS, 10);
  assert.deepEqual(fixedDefaultProblems(shown, 10), [], `Consensus: 10, fixed (${shown.join(", ")})`);
  /* control: the M2F-D1 model — Consensus limited to the rows that end with
     Conviction's (its chrome 184px, Conviction's 109px + 30px a row) — fails */
  const tuned = [0, 1, 5, 12].map((r) => partnerTunedRows({ partnerPx: 109 + r * 30, chromePx: 184, max: 10 }));
  assert.ok(fixedDefaultProblems(tuned, 10).length > 0, `control: a partner-dependent Consensus N (${tuned.join(", ")}) fails`);

  // the page composes the board from its own options only — no partner input
  const read = (rel: string): string => readFileSync(path.join(SRC, rel), "utf-8");
  const page = read("pages/institutional/index.astro");
  const call = /consensusBoardHtml\(board, (\{[^}]*\})\)/.exec(page)?.[1];
  assert.equal(call, "{ filerHref: hrefOf }", "the page passes the board no row count");
  // and no band source derives a row count from a height (the sweep)
  const sources = productionSources();
  assert.ok(Object.keys(sources).length > 50 && "pages/institutional/index.astro" in sources && "lib/notable-moves.ts" in sources, "the sweep reads the whole source tree");
  assert.deepEqual(heightDerivedCountProblems(sources), []);
  // control: the withdrawn page line, re-planted, is caught by the sweep
  const planted = { ...sources, "pages/institutional/index.astro": page.replace("{ filerHref: hrefOf }", "{ filerHref: hrefOf, compact: consensusPairedRows(leaders.rows.length) }") };
  assert.deepEqual(heightDerivedCountProblems(planted), ["pages/institutional/index.astro: consensusPairedRows"]);
});

test("CD-5: band I1 is Consensus (1.3fr, the primary) │ Conviction leaders (1fr); the M2 composition (Conviction primary, 1fr │ 1.3fr) fails", () => {
  const css = baseStylesheet().replace(/\/\*[\s\S]*?\*\//g, "");
  const conviction = newPositionLeadersHtml(LEADERS_FIVE as never, () => "top", "2026-03-31");
  const consensus = consensusBoardHtml(BOARD as never, { filerHref });
  const band = domOf(consensusConvictionBandHtml(consensus, conviction)).children[0]!;
  assert.deepEqual(i1CompositionProblems(band, css), []);
  assert.deepEqual(primaryProblems(band), []);
  const fr = i1Fractions(css)!;
  assert.ok(fr[0] > fr[1], "the primary (first) cell takes the wider fraction, which G9 requires at 1440");
  // control: the M2 composition — Conviction the primary on the right …
  const m2 = domOf(pairBandHtml("design-institutional-band design-consensus-band", consensus, conviction, { primary: "right" })).children[0]!;
  assert.deepEqual(i1CompositionProblems(m2, css), ["primary: Conviction leaders (Consensus)"]);
  // … and its grid, 1fr │ 1.3fr, are each caught
  const m2Css = css.replace("grid-template-columns:minmax(0,1.3fr) minmax(0,1fr)", "grid-template-columns:minmax(0,1fr) minmax(0,1.3fr)");
  assert.notEqual(m2Css, css, "the control replaced the I1 grid");
  assert.deepEqual(i1CompositionProblems(band, m2Css), ["I1 grid 1fr │ 1.3fr (1.3fr │ 1fr, the primary first)"]);
});

/* M2 delta review: G9 exempts a COMPLETE primary (a Consensus board of one to
   three issuers ends early because it has no more rows), and reads that off
   the table's OWN count — so a complete board must carry it. */
test("M2 delta (G9): every Consensus board carries its own count — a complete one a hidden shell (total ≤ shown, every row in its tbody), one holding rows back its bound — and the shell adds no visible word", () => {
  const board = (n: number) => ({ ...BOARD, qualifying: n, rows: Array.from({ length: n }, (_, i) => ({ ...BOARD.rows[0]!, issuerKey: `k${i}`, issuer: `Issuer ${i}` })) });
  const countOf = (n: number) => {
    const root = domOf(consensusBoardHtml(board(n) as never, { filerHref }));
    const w = root.querySelector('.compact-disclosure[data-compact-for="inst-consensus-tbody"]');
    const tbody = root.querySelector("#inst-consensus-tbody")!;
    return {
      root,
      count: w ? { total: Number(w.getAttribute("data-compact-total")), shown: Number(w.getAttribute("data-compact-shown")), hidden: w.hasAttribute("hidden") } : null,
      rows: tbody.children.length,
      held: tbody.children.filter((r) => r.hasAttribute("data-compact-extra")).length,
    };
  };
  for (const n of [1, 3, 10]) {
    const c = countOf(n);
    assert.deepEqual(c.count, { total: n, shown: n, hidden: true }, `${n} issuers: the complete board's count, a hidden shell`);
    assert.deepEqual([c.rows, c.held], [n, 0], `${n} issuers: every row in the tbody, none held`);
  }
  const cut = countOf(18);
  assert.deepEqual(cut.count, { total: 18, shown: 10, hidden: false }, "18 issuers: 10 shown, 8 held back");
  assert.deepEqual([cut.rows, cut.held], [18, 8]);
  // the shell states nothing (the omission rule): no visible word is added
  const three = countOf(3).root;
  const shell = /<div class="compact-disclosure"[^>]*hidden>[\s\S]*?<\/button><\/div>/;
  const html = consensusBoardHtml(board(3) as never, { filerHref });
  assert.match(html, shell);
  assert.equal(visibleText(three).replace(/\s+/g, " "), visibleText(domOf(html.replace(shell, ""))).replace(/\s+/g, " "), "the shell adds no visible word");
  // control: the M2 board (no shell when nothing is held) carried no count G9 could read
  assert.equal(domOf(html.replace(shell, "")).querySelector(".compact-disclosure"), null, "control: without the shell a complete board has no count");
});

test("CD-5 (T2.9): the canvas comparison holds I1's two heads to one line, as the preview draws them — never to the canvas's two separate bands", () => {
  const role = { family: "sans", weight: 600, size: 13, tracking: 0, caps: false };
  const head = (title: string, titleBaseline: number) => ({
    title, titleRole: role, metaRole: null, metaColor: null, baselineDelta: null, metaWrapped: false, controlOffset: null, titleBaseline, top: titleBaseline - 12, collapsed: false,
  });
  const measure = (heads: ReturnType<typeof head>[]): PageMeasure => ({ ink: "", bands: [], ledger: [], cards: [], heads, tables: [], segs: [], tokens: {} }) as never;
  // the canvas: the Cluster board heads one band, Conviction leaders the band 320px below
  const canvas = measure([head("Cluster board", 100), head("Conviction leaders", 420)]);
  const route = (apart: number) => measure([head("Consensus", 100), head("Conviction leaders", 100 + apart)]);
  const map = (preview?: string): BandMap => ({
    tables: [], heads: [], segs: [], ledger: false, cards: false,
    pairs: [{ canvas: ["Cluster board", "Conviction leaders"], route: ["Consensus", "Conviction leaders"], ...(preview ? { preview } : {}) }],
  });
  const dict = { words: {}, families: {}, role: null, background: "" };
  const pairFindings = (m: BandMap, apart: number) => compareBands(canvas, route(apart), m, dict).filter((f) => f.band.startsWith("pair ") && f.record === null);
  assert.deepEqual(pairFindings(map("CD-5"), 0), [], "the two heads on one line pass");
  assert.equal(pairFindings(map("CD-5"), 40).length, 1, "heads 40px apart are caught against the preview");
  // control: the M2 mapping (the canvas's own gap) excuses heads 40px apart — the check measured nothing
  assert.deepEqual(pairFindings(map(), 40), [], "control: the canvas's 320px gap excuses a broken pair");
});

/* ======================================================================
   M2F-D2 — a band whose cells are BOTH empty-state lines
   ====================================================================== */

/** A band of empty-state lines only (M2F-D2), as ONE predicate: it renders
    every line it was given, in order; it is collapsed; and it is no pair to
    measure — no primary, no narrow cap. */
function allLinesBandProblems(band: MiniElement, want: readonly string[]): string[] {
  const out: string[] = [];
  const got = band.children.map((c) => c.getAttribute("aria-label") ?? c.getAttribute("class") ?? "?");
  if (got.join(" | ") !== want.join(" | ")) out.push(`renders ${got.join(" | ") || "nothing"} (every line: ${want.join(" | ")})`);
  if (!band.children.every(isEmptyStateCell)) out.push("a cell is not an empty-state line");
  if (band.getAttribute("data-collapsed") !== "empty-state") out.push("not collapsed");
  if (band.children.some((c) => c.hasAttribute("data-pair-primary") || c.hasAttribute("data-pair-narrow"))) out.push("marked as a measured pair (a primary or a narrow cap)");
  return out;
}

test("M2F-D2: a band whose cells are BOTH empty-state lines renders both lines, collapsed, and is no measured pair", () => {
  const emptyBoard = consensusBoardHtml({ ...BOARD, rows: [], qualifying: 0 } as never, { filerHref });
  const none = newPositionLeadersHtml(LEADERS_NONE as never, () => "top", "2026-03-31");
  const want = ["Consensus", "design-unavailable-line design-newpositions"];
  const html = consensusConvictionBandHtml(emptyBoard, none);
  const band = domOf(html).children[0]!;
  assert.deepEqual(allLinesBandProblems(band, want), []);
  assert.deepEqual(bandCollapseProblems(band), []);
  assert.deepEqual(primaryProblems(band), []);
  assert.match(visibleText(band), /No issuer was moved by 3 or more notable managers/, "the Consensus line is stated");
  assert.match(visibleText(band), /Zero is the computed answer/, "the Conviction line is stated");
  // the same through the primitive with the primary on either side
  for (const primary of ["left", "right"] as const) {
    assert.deepEqual(allLinesBandProblems(domOf(pairBandHtml("design-pair", emptyBoard, none, { primary })).children[0]!, want), [], primary);
  }
  // controls: each way the band could go wrong is caught
  const uncollapsed = domOf(html.replace(' data-collapsed="empty-state"', "")).children[0]!;
  assert.deepEqual(allLinesBandProblems(uncollapsed, want), ["not collapsed"], "control: the lines left as an uncollapsed pair");
  assert.deepEqual(bandCollapseProblems(uncollapsed), ["a band holds an empty-state cell uncollapsed"]);
  const dropped = domOf(html.replace(none, "")).children[0]!;
  assert.deepEqual(allLinesBandProblems(dropped, want), ["renders Consensus (every line: Consensus | design-unavailable-line design-newpositions)"], "control: one line dropped");
  // the pre-fix shape: the second line promoted to a primary content cell, the first under it
  const measured = domOf(`<div class="design-band design-pair" data-collapsed="empty-state">${markPairPrimary(none)}${emptyBoard}</div>`).children[0]!;
  assert.deepEqual(allLinesBandProblems(measured, want), [
    "renders design-unavailable-line design-newpositions | Consensus (every line: Consensus | design-unavailable-line design-newpositions)",
    "marked as a measured pair (a primary or a narrow cap)",
  ], "control: treated as a measured pair");
  assert.deepEqual(primaryProblems(measured), ["a band of empty-state lines names a primary (it is not a pair to measure)"]);
});

/* ======================================================================
   T2.8 — the ONE header ledger
   ====================================================================== */

const item = (over: Partial<LedgerItem>): LedgerItem => ({ label: "L", value: "1", detail: "", ...over });

test("T2.8: ledger groups hold only dt and dd, on every rendered header", async () => {
  const surfaces = await renderParitySurfaces();
  const sources = [
    ...Object.values(surfaces),
    filerLedgerHtml(null, "2026-03-31", 0, null),
    disclosureLedger([item({ label: "A", detail: "x" }), item({ label: "B", noteHtml: "why" })], { scope: "s" }),
  ];
  let seen = 0;
  for (const html of sources) {
    for (const dl of ledgers(html)) {
      seen++;
      assert.deepEqual(ledgerStructureProblems(dl), [], dl.outerHTML.slice(0, 160));
    }
  }
  assert.ok(seen >= 5, `the sweep read real ledgers (${seen})`);
  // controls: the pre-M2 `<small>` sub, and a stray element in the list, are each caught
  const small = domOf('<dl class="design-ledger"><div class="ledger-fig"><dt>L</dt><dd class="ledger-value">1</dd><small>sub</small></div></dl>').children[0]!;
  assert.deepEqual(ledgerStructureProblems(small), ["a group holds <small> — only dt and dd are valid"]);
  const stray = domOf('<dl class="design-ledger"><p>x</p></dl>').children[0]!;
  assert.ok(ledgerStructureProblems(stray).length > 0);
});

test("T2.8: every figure's tone is one of the four; an unknown tone is refused", async () => {
  const surfaces = await renderParitySurfaces();
  const tones = Object.values(surfaces).flatMap((h) => ledgers(h).flatMap((dl) => figuresOf(dl).map((f) => f.tone)));
  assert.ok(tones.length > 0);
  for (const t of tones) assert.ok((LEDGER_TONES as readonly (string | null)[]).includes(t), `tone ${t}`);
  assert.deepEqual([...LEDGER_TONES], ["ink", "blue", "gold", "green"]);
  // control: the renderer refuses a fifth tone rather than print it
  assert.match(ledgerItemProblem(item({ tone: "red" as never }))!, /tone red is not one of ink, blue, gold, green/);
  assert.throws(() => disclosureLedger([item({ tone: "red" as never })]), /tone red/);
});

test("T2.8 (H-4): a 40-character PLAIN sub is refused; a 40-character count, qualifier, date or absence sub renders", () => {
  const forty = "x".repeat(40);
  assert.equal(forty.length > LEDGER_PLAIN_SUB_MAX, true);
  // control: the plain sub over 32 characters throws — its detail belongs in the note
  assert.throws(() => disclosureLedger([item({ detail: forty })]), /runs 40 characters \(at most 32\)/);
  assert.throws(() => disclosureLedger([item({ detail: forty, subKind: "plain" })]), /at most 32/);
  // honesty subs stay visible whatever their length
  for (const subKind of ["count", "qualifier", "date", "absence"] as const) {
    const [fig] = ledgerFigures(disclosureLedger([item({ detail: forty, subKind })]));
    assert.equal(fig!.sub, forty, `${subKind} sub renders in full`);
  }
  // the boundary: exactly 32 plain characters render
  assert.equal(ledgerFigures(disclosureLedger([item({ detail: "y".repeat(32) })]))[0]!.sub, "y".repeat(32));
  // a note needs a scope, and the note opens from the LABEL (no glyph)
  assert.throws(() => disclosureLedger([item({ noteHtml: "why" })]), /needs a scope/);
  const noted = domOf(disclosureLedger([item({ label: "Paper", noteHtml: "why" })], { scope: "s" }));
  assert.equal(noted.querySelector("dt .note-btn.note-label")?.textContent, "Paper");
});

/** The figures a page passes to `disclosureLedger` in its frontmatter, read
    from the source: each item's label and tone (default ink), in order. */
function sourceLedgerItems(page: string): { label: string; tone: string }[] {
  const at = page.indexOf("disclosureLedger(");
  assert.ok(at >= 0, "the page calls the one ledger");
  const open = page.indexOf("[", at);
  let depth = 0, end = open;
  for (let i = open; i < page.length; i++) {
    if (page[i] === "[") depth++;
    if (page[i] === "]" && --depth === 0) { end = i; break; }
  }
  const body = page.slice(open + 1, end);
  const objects: string[] = [];
  let d = 0, start = -1;
  for (let i = 0; i < body.length; i++) {
    if (body[i] === "{") { if (d === 0) start = i; d++; }
    if (body[i] === "}") { d--; if (d === 0) objects.push(body.slice(start, i + 1)); }
  }
  return objects.map((o) => ({
    label: /^\s*\{\s*label:\s*"([^"]+)"|\n\s*label:\s*"([^"]+)"/.exec(o)?.slice(1).find(Boolean) ?? "?",
    tone: /\btone:\s*"([^"]+)"/.exec(o)?.[1] ?? "ink",
  }));
}

test("T2.8 (D2): the Congress ledger carries the four D2 figures in order, tones ink / ink / blue / gold", () => {
  const page = readFileSync(path.join(SRC, "pages", "congress", "index.astro"), "utf-8");
  assert.deepEqual(sourceLedgerItems(page), [
    { label: "Transactions", tone: "ink" },
    { label: "House parse", tone: "ink" },
    { label: "Senate parse", tone: "blue" },
    { label: "Paper", tone: "gold" },
  ]);
  // the ledger renders in the page head (`ledgerHtml`), replacing the coverage strip
  assert.match(page, /<div class="page-head">[\s\S]*?<Fragment set:html=\{ledgerHtml\} \/>[\s\S]*?<\/div>\s*<div class="design-provenance">/);
  // control: the reader sees a swapped tone
  assert.notDeepEqual(sourceLedgerItems(page.replace('tone: "blue"', 'tone: "gold"')).map((i) => i.tone), ["ink", "ink", "blue", "gold"]);
});

test("T2.8: the filer ledger keeps its accessible name, Period statistics for P", () => {
  const html = filerLedgerHtml(null, "2025-12-31", 0, null);
  const dl = ledgers(html)[0]!;
  assert.equal(dl.getAttribute("aria-label"), "Period statistics for 2025-12-31");
  // the absent branch states its absence rather than printing a zero
  assert.deepEqual(figuresOf(dl).map((f) => [f.label, f.value]), [["Reported value", "—"], ["Positions", "—"], ["New stakes", "—"], ["Exits", "—"]]);
});

test("T2.8: every page header renders its figures through the ONE ledger; statTiles is left only in the holdings coverage strip", () => {
  const read = (rel: string): string => readFileSync(path.join(SRC, rel), "utf-8");
  for (const rel of ["pages/congress/index.astro", "pages/institutional/index.astro"]) assert.match(read(rel), /disclosureLedger\(/, rel);
  for (const [rel, fn] of [
    ["lib/ui/signals.ts", "signalsBody"],
    ["lib/ui/congress.ts", "memberBody"],
    ["lib/ui/congress.ts", "congressTickerBody"],
    ["lib/ui/institutional.ts", "filerLedgerHtml"],
    ["lib/ui/institutional.ts", "holdersBody"],
    ["lib/ui/institutional.ts", "tickerHoldersBody"],
    ["lib/ui/ticker.ts", "tickerUnifiedBody"],
  ] as const) {
    const src = read(rel);
    const start = src.indexOf(`export function ${fn}(`);
    assert.ok(start >= 0, `${fn} exists`);
    const next = src.indexOf("\nexport function ", start + 1);
    const body = src.slice(start, next < 0 ? undefined : next);
    assert.match(body, /disclosureLedger\(/, `${fn} renders its header through disclosureLedger`);
    assert.doesNotMatch(body, /statTiles\(/, `${fn} renders no statTiles header`);
  }
  // declared debt: the holdings identity-coverage strip is the ONE statTiles caller left
  const callers = ["lib/holdings.ts", "lib/ui/congress.ts", "lib/ui/institutional.ts", "lib/ui/signals.ts", "lib/ui/ticker.ts", "lib/ui/home.ts", "pages/congress/index.astro", "pages/institutional/index.astro"]
    .filter((rel) => /\bstatTiles\(/.test(read(rel)));
  assert.deepEqual(callers, ["lib/holdings.ts"]);
});

/* ---------- review C2-2: a WIDE value takes its own width ---------- */

test("C2-2: a value longer than a narrow figure holds is marked data-wide; the unbounded interval's wording is a sub, never a value", async () => {
  const { LEDGER_VALUE_NARROW_MAX } = await import("../src/lib/ui/shared.ts");
  const figs = domOf(disclosureLedger([item({ value: "−$250K to −$75.0K" }), item({ label: "B", value: "$4.6B" }), item({ label: "C", value: "x".repeat(LEDGER_VALUE_NARROW_MAX) })])).querySelectorAll(".ledger-fig");
  assert.deepEqual(figs.map((f) => f.hasAttribute("data-wide")), [true, false, false], "a range is wide; a short figure and the boundary are not");
  // the stylesheet lets a wide figure take its value's width above the fold and a full row at it
  const css = baseStylesheet().replace(/\/\*[\s\S]*?\*\//g, "");
  assert.match(css, /\.ledger-fig\[data-wide\] \{ max-width: none; flex-shrink: 1; \}/);
  assert.match(css, /\.ledger-fig\[data-wide\] \{ grid-column: 1 \/ -1; \}/, "a full row of the two-column fold ledger (measured at 390 by T2.8)");
  // the member ledger: an unbounded net flow's value is one word, its wording the sub
  const { memberBody } = await import("../src/lib/ui/index.ts");
  const stamps = { buildId: "b", generatedAt: "2026-07-24 06:56 UTC", generatedAtDate: "2026-07-24" };
  // an open purchase and an open sale in the window: (−∞, +∞)
  const rows = [
    txn({ txnId: "p", side: "purchase", low: 50_000_001, high: null, traded: "2026-06-01", filed: "2026-06-10" }),
    txn({ txnId: "s", side: "sale", low: 50_000_001, high: null, traded: "2026-06-02", filed: "2026-06-11" }),
  ];
  const member = { bioguide: "M000001", name: "M", party: "R", state: "OK", district: null, chamber: "senate", servingSince: "1999", filingCount: 2, txns: rows, paper: [] } as never;
  const net = ledgerFigures(memberBody(member, stamps, { watched: new Set() }, 0)).find((f) => f.label === "Net flow · 12m")!;
  assert.equal(net.value, "unbounded");
  assert.equal(net.sub, "open on both sides · an interval");
  // control: the pre-fix value (the 37-character phrase) is wide far past any figure
  assert.ok("unbounded — open bounds on both sides".length > 2 * LEDGER_VALUE_NARROW_MAX, "control: the phrase the value used to carry");
});

/* ---------- review R2-3: the Consensus add figure never reads as absence ---------- */

test("R2-3: a consensus add with no reviewed ticker shows its manager count, never \"—\"; only a quarter with none shows \"—\"", async () => {
  const { consensusAddLedgerItem } = await import("../src/lib/notable-moves.ts");
  const row = BOARD.rows[0]!;
  const withTicker = consensusAddLedgerItem(row as never, "2026-03-31");
  assert.equal(withTicker.value, "NVDA");
  assert.match(withTicker.detail, /^Nvidia Corp · 3 notable managers opened it$/);
  const noTicker = consensusAddLedgerItem({ ...row, ticker: null } as never, "2026-03-31");
  assert.equal(noTicker.value, "3 managers", "a figure, not the absence dash");
  assert.match(noTicker.detail, /^Nvidia Corp · no reviewed ticker$/, "the filed name still leads the sub");
  assert.match(noTicker.noteHtml!, /no reviewed ticker maps it, so the figure is the number of notable managers who opened it/);
  const none = consensusAddLedgerItem(null, "2026-03-31");
  assert.equal(none.value, "—");
  assert.equal(none.subKind, "absence");
  // every one renders through the one ledger (its sub rules hold)
  for (const it of [withTicker, noTicker, none]) assert.equal(ledgerItemProblem(it), null);
  // control: the pre-fix value for a ticker-less name was the absence dash
  assert.notEqual(noTicker.value, none.value, "control: a name that qualified never reads like a quarter with none");
});

/* ---------- M2 delta review: a long Consensus-add sub makes its figure wide ---------- */

test("M2 delta (ledger sub): a Consensus add whose issuer name would wrap its sub to three lines in a narrow figure is data-wide; a sub that fits two stays narrow", async () => {
  const { consensusAddLedgerItem } = await import("../src/lib/notable-moves.ts");
  const { ledgerSubLines, ledgerFigureWide, LEDGER_SUB_NARROW_CHARS } = await import("../src/lib/ui/shared.ts");
  const row = BOARD.rows[0]!;
  const add = (issuer: string, newStakes: number): LedgerItem => consensusAddLedgerItem({ ...row, issuer, newStakes } as never, "2026-03-31");
  const figOf = (it: LedgerItem) => domOf(disclosureLedger([it], { scope: "t" })).querySelectorAll(".ledger-fig")[0]!;
  // the reported name, and a longer real one
  for (const [issuer, n] of [["MICROSOFT CORP", 8], ["BERKSHIRE HATHAWAY INC DEL", 12]] as const) {
    const it = add(issuer, n);
    assert.equal(it.value.length <= 10, true, `${issuer}: a short ticker value — only the sub can make it wide`);
    assert.ok(ledgerSubLines(it.detail) > 2, `${issuer}: "${it.detail}" takes ${ledgerSubLines(it.detail)} lines of ${LEDGER_SUB_NARROW_CHARS} characters`);
    assert.equal(figOf(it).hasAttribute("data-wide"), true, `${issuer}: the renderer marks the figure wide`);
  }
  // the character-count rule: greedy, breaking at spaces — the Microsoft sub
  // is 45 characters, within a flat 2 × 23, and still takes three lines
  const msft = add("MICROSOFT CORP", 8).detail;
  assert.equal(msft, "MICROSOFT CORP · 8 notable managers opened it");
  assert.ok([...msft].length <= 2 * LEDGER_SUB_NARROW_CHARS, "control: a flat length rule would call it narrow");
  assert.equal(ledgerSubLines(msft), 3);
  assert.equal(ledgerSubLines("x".repeat(50)), 3, "a word longer than a line breaks every 23 characters");
  assert.equal(ledgerSubLines(""), 0);
  // controls: a sub that fits two lines stays NARROW — a short issuer, the
  // absence line, and the longest sub a route renders on the 20260817.1 build
  assert.equal(figOf(add("NVIDIA CORP", 3)).hasAttribute("data-wide"), false, "NVIDIA CORP · 3 notable managers opened it: two lines");
  assert.equal(figOf(consensusAddLedgerItem(null, "2026-03-31")).hasAttribute("data-wide"), false, "the absence sub fits two lines");
  for (const sub of ["await closed 13F periods · not simulated", "open on both sides · an interval", "1 withheld this build · 1 by design"]) {
    assert.equal(ledgerFigureWide({ value: "—", detail: sub }), false, sub);
  }
  // the stylesheet: a wide figure's sub is uncontained, so it sizes its figure above the fold
  const css = baseStylesheet().replace(/\/\*[\s\S]*?\*\//g, "");
  assert.match(css, /\.ledger-fig\[data-wide\] > \.ledger-sub \{ contain: none; \}/);
  assert.match(css, /\.ledger-fig > \.ledger-sub \{[^}]*contain: inline-size;/, "a narrow figure's sub never widens it");
});
