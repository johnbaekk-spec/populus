/* signals-v4 M3 (R18, R21, R24, R25, LD8, LD14; T3.3): the Overlap tab — the
   rows recomputed independently in both variants (broad accounts not
   counted, and counted), their order and labels, the opened row's lines
   through the one Congress-line renderer, the co-occurrence wording, the
   page's own bound; then the client — Same / Opposite / All, Broad accounts,
   "Show 12 more" — and every reveal into it (a hash past the first page, a
   relation that excludes the row, a row only Broad accounts lists, a move's
   "See {TICKER} in Overlap →"). */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  OVERLAP_DETAIL_MANAGERS,
  OVERLAP_FALLBACK_ROWS,
  OVERLAP_SLICE_ROWS,
  OVERLAP_STEP,
  buildOverlap,
  largestPerManager,
  overlapBoundText,
  overlapCarried,
  overlapCounts,
  overlapRangeText,
  overlapItemHtml,
  overlapRowId,
  type HeldOverlap,
  type Overlap,
  type OverlapRow,
} from "../src/lib/ui/signals-overlap.ts";
import { signalsBody, signalsOverlapHtml, signalsOverlapMethodHtml } from "../src/lib/ui/index.ts";
import { moveRowHtml, namedMoveIds, signalsInstitutionalHtml } from "../src/lib/ui/signals-institutional.ts";
import { congressLineHtml, ctxOfCut } from "../src/lib/ui/signals.ts";
import { BROAD_ACCOUNT_NAMES, CONGRESS_DETAIL_LINES, congressQuarter } from "../src/lib/congress-quarter.ts";
import { scanBannedWording } from "../src/lib/activity.ts";
import { BANNED_PATTERNS, redactFiledNames } from "./lib/banned-scan.ts";
import type { TxnRow } from "../src/lib/format.ts";
import { signedUsd, type NotableMove } from "../src/lib/notable-moves.ts";
import { DUP_PERIOD, OVERLAP_PERIOD, fixtureOverlap, overlapDupCase, overlapMoves, overlapSpecs, overlapTxns } from "./lib/overlap-fixture.ts";
import { fixtureMoves, fixtureTxns } from "./lib/inst-signals-fixture.ts";
import { quarterMembers } from "../src/lib/congress-quarter.ts";
import { independentOverlap, independentOverlapRows, type RecountRow } from "./lib/overlap-recount.ts";
import { fixtureInstitutional } from "./lib/inst-signals-fixture.ts";
import { installDom, MiniElement } from "./lib/mini-dom.ts";
import { initNamedMoves, initSignalsPage } from "../src/scripts/signals-client.ts";

const CTX = {};
const text = (el: MiniElement | null | undefined): string => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
function domOf(html: string): MiniElement {
  const root = new MiniElement("body");
  root.innerHTML = html;
  return root;
}

/** The move's own side's counted Congress members (the round-1 rule's gate). */
function congressQuarterCount(inst: { quarter: Parameters<typeof quarterMembers>[0] | null }, mv: NotableMove): number {
  return mv.ticker && inst.quarter ? quarterMembers(inst.quarter, mv.ticker, mv.kind === "new" || mv.kind === "add" ? "buy" : "sell").length : 0;
}

const keyOf = (rows: readonly OverlapRow[]): string[] => rows.map((r) => `${r.ticker}:${r.rel}`);

test("T3.3 (LD14): both variants equal an independent recomputation — relation, order, the broad-only names absent from the default view", () => {
  const o = fixtureOverlap();
  const want = independentOverlap(overlapTxns(), overlapMoves(), OVERLAP_PERIOD);
  assert.deepEqual(keyOf(o.core), want.core);
  assert.deepEqual(keyOf(o.all), want.all);
  assert.deepEqual(overlapCounts(o.core), { same: 26, opposite: 12, mixed: 4, all: 42 });
  assert.deepEqual(overlapCounts(o.all), { same: 28, opposite: 12, mixed: 6, all: 46 });
  // a name only broad accounts traded is absent from core, present in all
  for (const t of ["B01", "B02", "B03", "B04"]) {
    assert.ok(!o.core.some((r) => r.ticker === t), `${t}: not in the default view`);
    assert.equal(o.all.find((r) => r.ticker === t)?.cb, 1, `${t}: the broad account counts with Broad accounts on`);
  }
  // the broad account turns two same-side names mixed
  assert.equal(o.core.find((r) => r.ticker === "T41")!.rel, "same");
  assert.equal(o.all.find((r) => r.ticker === "T41")!.rel, "mixed");
  assert.equal(o.core.find((r) => r.ticker === "T42")!.cdir, "sell");
  assert.deepEqual(o.broad.map((b) => [b.name, b.breadth]), [["Broad Account", 32]]);
  assert.ok(o.broad[0]!.breadth > BROAD_ACCOUNT_NAMES);
  // unanimous first within a relation; the refused lines (exchange, option, a day past the quarter) are not counted
  const same = o.core.filter((r) => r.rel === "same");
  assert.ok(same.findIndex((r) => !r.unanimous) > same.findLastIndex((r) => r.unanimous), "unanimous names first");
  assert.equal(o.core.find((r) => r.ticker === "T01")!.cb, 2, "T01: its two buyers, not the refused lines");
  // the rule's own fields
  const t15 = o.core.find((r) => r.ticker === "T15")!;
  assert.deepEqual([t15.cb, t15.cs, t15.gb, t15.gs, t15.cdir, t15.gdir, t15.rel, t15.unanimous, t15.score], [3, 1, 2, 0, "buy", "buy", "same", false, 5]);
  const t25 = o.core.find((r) => r.ticker === "T25")!;
  assert.deepEqual([t25.cdir, t25.gdir, t25.rel], ["buy", "sell", "opposite"]);
  // a mutation that sorts by score before unanimity changes the order (the test reads it)
  const mutated = [...o.core].sort((a, b) => (a.rel === b.rel ? b.score - a.score : 0));
  assert.notDeepEqual(keyOf(mutated), keyOf(o.core), "control: the order is pinned");
});

test("T3.3 (LD14): a tie on both sides is mixed, never same; a split side is not unanimous", () => {
  const base = overlapTxns()[0]!;
  const q = congressQuarter([
    { ...base, txnId: "m1", ticker: "TIE", side: "purchase", bioguide: "Q000001" },
    { ...base, txnId: "m2", ticker: "TIE", side: "sale", bioguide: "Q000002" },
  ], OVERLAP_PERIOD);
  const mv = overlapMoves()[0]!;
  const o = buildOverlap(q, [{ ...mv, ticker: "TIE", kind: "new", cik: "0000000001", key: "k1" }, { ...mv, ticker: "TIE", kind: "exit", cik: "0000000002", key: "k2" }]);
  assert.deepEqual(o.core.map((r) => [r.ticker, r.cdir, r.gdir, r.rel, r.unanimous]), [["TIE", "mixed", "mixed", "mixed", false]]);
});

test("T3.3 (LD14): no quarter, no moves — the stated absences; ticker spellings meet in the SEC form", () => {
  assert.equal(buildOverlap(null, overlapMoves()).period, null);
  assert.match(signalsOverlapHtml(buildOverlap(null, [], { absent: "no 13F quarter in this build has passed its 45-day filing deadline yet" }), CTX), /No Overlap: no 13F quarter in this build has passed its 45-day filing deadline yet\. Absence is stated, never simulated\./);
  const q = congressQuarter(overlapTxns(), OVERLAP_PERIOD);
  const empty = buildOverlap(q, [], { absent: "this build's manager registry marks no notable manager, so no 13F change is named" });
  assert.equal(empty.all.length, 0);
  assert.match(text(domOf(signalsOverlapHtml(empty, CTX))), /No name in Q1 2026 has both a member of Congress's listed-stock line and a notable manager's change: this build's manager registry marks no notable manager, so no 13F change is named\. Zero is the computed answer\./);
  assert.match(signalsOverlapHtml(null, CTX), /this view carries the Congress artifact only/);
  // BRK.B (Congress) meets BRK-B (13F)
  const brk = buildOverlap(congressQuarter([{ ...overlapTxns()[0]!, ticker: "BRK.B" }], OVERLAP_PERIOD), [{ ...overlapMoves()[0]!, ticker: "BRK-B" }]);
  assert.deepEqual(brk.core.map((r) => r.ticker), ["BRK-B"]);
  assert.equal(overlapRowId("BRK.B"), "ov-brk-b");
});

/** launch M7a (D5): the carried names — the page's and the island's, the
    island's rendered the client's way (through `overlapItemHtml`, held). */
function carriedItems(html: string): MiniElement[] {
  // launch integration: the site's one held-rows island (lib/held-rows.ts)
  const m = /<script type="application\/json" data-held-for="ov-list" data-held-render="overlap-names">([\s\S]*?)<\/script>/.exec(html);
  const held = m ? (JSON.parse(m[1]!) as HeldOverlap) : null;
  const island = held ? held.rows.map((it) => overlapItemHtml(it.core, it.all, it.ord, held.shared.q, ctxOfCut(held.shared.cut), false)).join("") : "";
  return [...domOf(html).querySelectorAll("article.ov-item"), ...domOf(island).querySelectorAll("article.ov-item")];
}

test("T3.3 (R18, LD14) + launch M7a (D5): one row per carried name — the first view's 12 in the page and showing, the rest in the island; both variants' relation and counts on it, the segment counts equal the rows per variant, the bound stated where a view runs out", () => {
  const o = fixtureOverlap();
  const html = signalsOverlapHtml(o, CTX);
  const root = domOf(html);
  assert.equal(root.querySelectorAll("article.ov-item").length, OVERLAP_STEP, "the first view's names are in the page");
  const items = carriedItems(html);
  const find = (id: string): MiniElement | null => items.find((i) => i.getAttribute("id") === id) ?? null;
  const carried = overlapCarried(o);
  assert.equal(items.length, carried.size);
  assert.deepEqual(new Set(items.map((i) => text(i.querySelector(".ov-tk")))), carried);
  assert.equal(new Set(items.map((i) => i.getAttribute("id"))).size, items.length, "unique anchors");
  const shown = items.filter((i) => !i.hasAttribute("hidden"));
  assert.deepEqual(shown.map((i) => text(i.querySelector(".ov-tk"))), o.core.slice(0, OVERLAP_STEP).map((r) => r.ticker), "the default view's first 12, in its order");
  // the segment control: the true totals, the default variant's visible
  const seg = (rel: string, v: string) => text(root.querySelector(`button[data-ov-rel="${rel}"] .ov-n${v === "" ? "" : `[data-v="${v}"]`}`));
  assert.equal(seg("same", "core"), "26");
  assert.equal(seg("same", "all"), "28");
  assert.equal(root.querySelector('button[data-ov-rel="same"] .ov-n[data-v="all"]')!.hasAttribute("hidden"), true);
  assert.equal(seg("opposite", ""), "12", "a count the variants share renders once");
  assert.equal(seg("all", "core"), "42");
  assert.equal(root.querySelector('button[data-ov-rel="all"]')!.getAttribute("aria-pressed"), "true", "All by default, with or without script");
  assert.equal(text(root.querySelector("#ov-range")), overlapRangeText(12, 42));
  // a row the broad account changes carries both variants; a broad-only row carries only the second, hidden
  const t41 = find("ov-t41");
  if (t41) {
    assert.deepEqual(t41.querySelectorAll(".ov-rl .ov-rel").map((r) => text(r)), ["SAME · BUY SIDE", "MIXED"]);
    assert.equal(t41.querySelector('.ov-rl[data-v="all"]')!.hasAttribute("hidden"), true);
  }
  const b01 = find("ov-b01")!;
  assert.equal(b01.getAttribute("data-core"), "");
  assert.equal(b01.hasAttribute("hidden"), true);
  // labels: the four relation words; the counts with their words for assistive technology
  const t11 = find("ov-t11")!;
  assert.equal(text(t11.querySelector(".ov-rel")), "SAME · BUY SIDE");
  assert.equal(text(t11.querySelector(".ov-cg")), "▲3 · ▼0Congress: 3 members with a purchase, 0 with a sale");
  assert.equal(text(t11.querySelector(".ov-mg")), "▲4 · ▼0Managers: 4 managers opened or added, 0 trimmed or exited");
  assert.equal(text(find("ov-t19")!.querySelector(".ov-rel")), "SAME · SELL SIDE");
  assert.equal(text(find("ov-t26")!.querySelector(".ov-rel")), "OPPOSITE");
  assert.equal(find("ov-t37"), null, "a mixed name past every view's carried run is not on the page");
  assert.equal(text(carriedItems(signalsOverlapHtml(fixtureOverlap({ sliceRows: 100 }), CTX)).find((i) => i.getAttribute("id") === "ov-t37")!.querySelector(".ov-rel")), "MIXED");
  // the bound: at 24 a view the core All view carries a 24-name run of 42
  assert.equal(root.querySelector("#ov-bound")!.hasAttribute("hidden"), true, "12 shown of a longer run: not yet");
  assert.match(text(root.querySelector("noscript")), /Filtering, Broad accounts and paging need JavaScript; 42 names are in this view, broad accounts not counted\./);
  assert.equal(OVERLAP_SLICE_ROWS, 24);
  assert.equal(OVERLAP_FALLBACK_ROWS, 12);
});

test("T3.3 (R18, R24, LD10, LD14): an opened row lists each member's newest line through congressLineHtml — owner, range, both dates, receipt — the broad accounts' apart, and each manager's change with its 13F receipt; a removal control fails", () => {
  const o = fixtureOverlap();
  const t15 = carriedItems(signalsOverlapHtml(o, CTX)).find((i) => i.getAttribute("id") === "ov-t15")!;
  const det = t15.querySelector(".ov-det")!;
  const lines = det.querySelectorAll("li.cl-line");
  const row = o.core.find((r) => r.ticker === "T15")!;
  assert.equal(lines.length, row.cb + row.cs, "one line a counted member");
  const want = [...row.buy, ...row.sell].map((m) => congressLineHtml(m.rows[0]!, CTX));
  assert.deepEqual(lines.map((l) => `<li class="cl-line">${l.innerHTML}</li>`), want, "the one renderer, each member's newest line");
  const problems = (li: MiniElement): string[] => {
    const out: string[] = [];
    if (!li.querySelector(".owner-note")) out.push("owner");
    if (!/\$/.test(text(li.querySelector(".cl-amt")))) out.push("range");
    if (!li.querySelector(".si-row-traded time")) out.push("traded");
    if (!li.querySelector(".si-row-filed time")) out.push("filed");
    if (!li.querySelector(".si-row-src a")) out.push("receipt");
    return out;
  };
  for (const li of lines) assert.deepEqual(problems(li), []);
  for (const [re, want] of [[/<span class="si-row-filed">[\s\S]*?<\/span>/, "filed"], [/<span class="owner-note">[\s\S]*?<\/span>/, "owner"], [/<span class="si-row-src cl-src">[\s\S]*?<\/span>/, "receipt"]] as const) {
    const cutLine = domOf(`<li class="cl-line">${lines[0]!.innerHTML}</li>`.replace(re, "")).querySelector("li")!;
    assert.ok(problems(cutLine).includes(want), `control: a line without its ${want} is caught`);
  }
  // managers: name, kind, Δ $, filed, 13F receipt
  const ml = det.querySelectorAll("li.ov-mline");
  assert.equal(ml.length, row.gb + row.gs);
  for (const li of ml) {
    assert.ok(li.querySelector(".ov-m") && li.querySelector(".qoq-chip") && li.querySelector(".mv-dv") && li.querySelector(".mv-fil time"));
    assert.match(li.querySelector("a.mv-src")!.getAttribute("href")!, /^https:\/\/www\.sec\.gov\//);
  }
  // the broad account's lines sit apart, named, counted only with Broad accounts on
  const byId = (html: string, id: string): MiniElement | null => carriedItems(html).find((i) => i.getAttribute("id") === id) ?? null;
  const t41 = byId(signalsOverlapHtml(o, CTX), "ov-t41") ?? byId(signalsOverlapHtml(buildOverlap(congressQuarter(overlapTxns(), OVERLAP_PERIOD), overlapMoves(), { sliceRows: 100 }), CTX), "ov-t41")!;
  assert.match(text(t41.querySelector(".ov-det")), /Broad accounts — more than 25 names in the quarter, counted only with Broad accounts on: Broad Account \(32 names\)\./);
  assert.equal(t41.querySelectorAll(".ov-det li.cl-line").length, 2, "its counted buyer and the broad account's sale");
  // no control in a summary; the quarter heading
  for (const it of carriedItems(signalsOverlapHtml(o, CTX))) for (const s of it.querySelectorAll("summary.ov-sum")) assert.doesNotMatch(s.innerHTML, /<a\s|<button\s/);
  assert.match(text(det.querySelector(".ov-det-h")), /^Congress · traded in Q1 2026 \(2026-01-01 → 2026-03-31\)$/);
  assert.equal(CONGRESS_DETAIL_LINES, 12);
});

test("T3.3 (R18, R25): the co-occurrence wording is visible and in the tip; no banned wording; a planted word is caught", () => {
  const html = signalsOverlapHtml(fixtureOverlap(), CTX);
  const root = domOf(html);
  /* copy item signals-15 (adapted around the "move" ban) */
  assert.match(text(root.querySelector(".ov-lede")), /^Names Congress traded and notable managers changed in Q1 2026 — co-occurrence, not coordination or intent\.$/);
  assert.match(text(root.querySelector("#ov-section .panel-head .note-pop")), /A co-occurrence in public filings — never coordination, never intent\./);
  assert.match(text(root.querySelector("#ov-section .ov-tools .note-pop")), /Broad Account \(32\)/, "the Broad accounts tip names the members");
  assert.deepEqual(scanBannedWording(html), []);
  assert.deepEqual(BANNED_PATTERNS.filter(({ re }) => re.test(redactFiledNames(html))).map((p) => p.name), []);
  assert.ok(scanBannedWording(html.replace("SAME · BUY SIDE", "Both sold")).includes("sold"), "control");
});

test("T3.6 (R27): Methodology #signals-overlap states the rule with its constants read from code", () => {
  const root = domOf(signalsOverlapMethodHtml());
  const t = text(root.querySelector("section#signals-overlap"));
  for (const w of [
    "never coordination, never intent",
    `more than ${BROAD_ACCOUNT_NAMES} distinct tickers in the quarter`,
    `at most ${CONGRESS_DETAIL_LINES} Congress lines a side`,
    /* codex M3 r1 F6: the manager cap is the renderer's own constant */
    `each manager's largest change on the name, at most ${OVERLAP_DETAIL_MANAGERS} managers a side`,
    `the first ${OVERLAP_SLICE_ROWS} names — ${OVERLAP_FALLBACK_ROWS} when the page would pass its byte budget`,
    `${OVERLAP_STEP} show before "Show ${OVERLAP_STEP} more"`,
    "same when the two directions agree",
  ]) assert.ok(t.includes(w), w);
});

/* ---------------------------------------------------------------- the client */

const ART = { v: 1, buildId: "b", computedAt: "2026-07-24", thresholdVersion: "1", retentionDays: 90, coverageFrom: "2026-04-25", coverageTo: "2026-07-24", lifecycleNote: "n", compaction: "none", dateAnomaliesExcluded: 0, lagCaveat: "c", withheld: [], signals: [] } as never;

interface Mount {
  doc: ReturnType<typeof installDom>["doc"];
  loc: { hash: string };
  fire(hash: string): void;
  restore(): void;
}
function mount(html: string, hash = ""): Mount {
  const dom = installDom(html);
  const g = globalThis as unknown as Record<string, unknown>;
  const prev = { window: g.window, location: g.location, history: g.history };
  const listeners = new Map<string, (() => void)[]>();
  g.window = { matchMedia: () => ({ matches: false, addEventListener() {} }), addEventListener: (t: string, fn: () => void) => void listeners.set(t, [...(listeners.get(t) ?? []), fn]) };
  const loc = { hash };
  g.location = loc;
  g.history = { pushState: (_s: unknown, _t: string, url: string) => void (loc.hash = url) };
  let onHash: (() => void) | null = null;
  const env = { location: loc, history: { replaceState: (_d: unknown, _u: string, url?: string) => void (loc.hash = url ?? loc.hash) }, getElementById: (id: string) => dom.doc.getElementById(id) as unknown as Element | null, onHashChange: (fn: () => void) => void (onHash = fn) };
  const proto = MiniElement.prototype as unknown as { scrollIntoView?: () => void };
  proto.scrollIntoView = function () {};
  initSignalsPage({ tabsEnv: env });
  return {
    doc: dom.doc,
    loc,
    fire(h: string) {
      loc.hash = h;
      onHash?.();
      for (const fn of listeners.get("hashchange") ?? []) fn();
    },
    restore() {
      delete proto.scrollIntoView;
      dom.restore();
      g.window = prev.window;
      g.location = prev.location;
      g.history = prev.history;
    },
  };
}
const page = (o: Overlap = fixtureOverlap()): string => signalsBody(ART, CTX, { rowsEvaluated: 0, triage: null, institutional: null, overlap: o });
const visible = (doc: Mount["doc"]): string[] => doc.querySelectorAll("#ov-list article.ov-item").filter((i) => !i.hasAttribute("hidden")).map((i) => text(i.querySelector(".ov-tk")));
const order = (doc: Mount["doc"]): string[] => doc.querySelectorAll("#ov-list article.ov-item").map((i) => text(i.querySelector(".ov-tk")));

test("T3.3 (R18): Same / Opposite / All filter the rows; Broad accounts swaps the variant — counts, relations, order; Show 12 more extends to the carried run, then the bound is stated; a change resets the extension", () => {
  const o = fixtureOverlap();
  const m = mount(page(o));
  try {
    const doc = m.doc;
    const range = () => text(doc.getElementById("ov-range"));
    assert.deepEqual(visible(doc), o.core.slice(0, 12).map((r) => r.ticker));
    doc.querySelector('button[data-ov-rel="opposite"]')!.bubbleClick();
    assert.deepEqual(visible(doc), o.core.filter((r) => r.rel === "opposite").map((r) => r.ticker), "all 12 opposite names, in order");
    assert.equal(range(), overlapRangeText(12, 12));
    doc.querySelector('button[data-ov-rel="same"]')!.bubbleClick();
    const same = o.core.filter((r) => r.rel === "same");
    assert.deepEqual(visible(doc), same.slice(0, 12).map((r) => r.ticker));
    assert.equal(range(), overlapRangeText(12, 26));
    // Show 12 more: the carried run of the same view is 24
    doc.getElementById("ov-more")!.bubbleClick();
    assert.deepEqual(visible(doc), same.slice(0, 24).map((r) => r.ticker));
    assert.equal(doc.getElementById("ov-more")!.getAttribute("aria-disabled"), "true");
    assert.equal(doc.getElementById("ov-bound")!.hasAttribute("hidden"), false, "the run ends before the 26: stated");
    assert.equal(text(doc.getElementById("ov-bound")), overlapBoundText(24));
    // Broad accounts: the all variant's counts, relations and order; the extension resets
    doc.getElementById("ov-broad")!.bubbleClick();
    assert.equal(doc.getElementById("ov-broad")!.getAttribute("aria-pressed"), "true");
    const allSame = o.all.filter((r) => r.rel === "same");
    assert.deepEqual(visible(doc), allSame.slice(0, 12).map((r) => r.ticker), "the broad-inclusive same view, from its first name");
    assert.equal(range(), overlapRangeText(12, 28));
    assert.equal(text(doc.querySelector('button[data-ov-rel="same"] .ov-n[data-v="all"]')), "28");
    assert.equal(doc.querySelector('button[data-ov-rel="same"] .ov-n[data-v="core"]')!.hasAttribute("hidden"), true);
    assert.deepEqual(order(doc).slice(0, 12), allSame.slice(0, 12).map((r) => r.ticker).filter((t) => order(doc).includes(t)).slice(0, 12), "the list is in the variant's order");
    const t41 = doc.getElementById("ov-t41");
    if (t41) {
      assert.equal(t41.hasAttribute("hidden"), true, "T41 is mixed with Broad accounts on: not in the same view");
      assert.equal(t41.querySelector('.ov-rl[data-v="all"]')!.hasAttribute("hidden"), false, "its broad-inclusive relation shows");
      assert.equal(t41.querySelector('.ov-rl[data-v="core"]')!.hasAttribute("hidden"), true);
      assert.equal(text(t41.querySelector('.ov-rl[data-v="all"]')), "MIXED");
    }
    // the variant's own order: two pages of its same view hold the broad-only names in their places
    doc.getElementById("ov-more")!.bubbleClick();
    assert.deepEqual(visible(doc), allSame.slice(0, 24).map((r) => r.ticker), "the broad-inclusive order, B01–B04 among the T names");
    assert.ok(allSame.slice(0, 24).some((r) => r.ticker.startsWith("B")), "precondition: a broad-only name in the run");
    // back
    doc.getElementById("ov-broad")!.bubbleClick();
    doc.querySelector('button[data-ov-rel="all"]')!.bubbleClick();
    assert.deepEqual(visible(doc), o.core.slice(0, 12).map((r) => r.ticker));
    assert.deepEqual(order(doc).slice(0, 12), o.core.slice(0, 12).map((r) => r.ticker), "the default order again");
  } finally {
    m.restore();
  }
});

test("T3.3 (LD8): revealTarget — a hash past the first page extends it; an opposite row while Same is selected sets All (or its own relation past All's run); a row only Broad accounts lists turns it on", () => {
  const o = fixtureOverlap();
  // a hash on load to a core row past the first 12 (the 20th of the default view)
  const deep = o.core[19]!;
  const a = mount(page(o), `#${overlapRowId(deep.ticker)}`);
  try {
    assert.equal(a.doc.getElementById("tab-overlap")!.getAttribute("aria-selected"), "true");
    const el = a.doc.getElementById(overlapRowId(deep.ticker))!;
    assert.equal(el.hasAttribute("hidden"), false, "the page extends until it shows");
    assert.equal(el.querySelector("details")!.hasAttribute("open"), true);
    assert.equal(visible(a.doc).length, 20);
  } finally {
    a.restore();
  }
  const b = mount(page(o));
  try {
    b.doc.querySelector('button[data-ov-rel="same"]')!.bubbleClick();
    const opp = o.core.find((r) => r.rel === "opposite")!;
    b.fire(`#${overlapRowId(opp.ticker)}`);
    const el = b.doc.getElementById(overlapRowId(opp.ticker))!;
    assert.equal(el.hasAttribute("hidden"), false);
    assert.equal(b.doc.querySelector('button[data-ov-rel="same"]')!.getAttribute("aria-pressed"), "false", "Same no longer applies");
    assert.ok(["all", "opposite"].includes(b.doc.querySelector('#ov-section button[data-ov-rel][aria-pressed="true"]')!.getAttribute("data-ov-rel")!));
    // a broad-only name: Broad accounts turns on
    b.fire("#ov-b01");
    assert.equal(b.doc.getElementById("ov-broad")!.getAttribute("aria-pressed"), "true");
    assert.equal(b.doc.getElementById("ov-b01")!.hasAttribute("hidden"), false);
  } finally {
    b.restore();
  }
});

test("T3.5 (R21, LD8): a move row's 'See {TICKER} in Overlap →' links the name's carried row (server and client bodies alike) and runs the same reveal", () => {
  const inst = fixtureInstitutional();
  const o = buildOverlap(inst.quarter, inst.moves);
  assert.ok(o.core.length > 0, "precondition: the Institutional fixture's names overlap");
  const html = signalsBody(ART, CTX, { rowsEvaluated: 0, triage: null, institutional: inst, overlap: o });
  const root = domOf(html);
  const links = root.querySelectorAll(".mv-ov-link a");
  assert.ok(links.length > 0, "visible rows with counted members carry it");
  for (const l of links) assert.ok(root.querySelector(l.getAttribute("href")!), `${l.getAttribute("href")} is on the page`);
  // a bounded Overlap: a link only where the page carries the name's row
  const tight = buildOverlap(inst.quarter, inst.moves, { sliceRows: 1 });
  const tightRoot = domOf(signalsBody(ART, CTX, { rowsEvaluated: 0, triage: null, institutional: inst, overlap: tight }));
  assert.ok(overlapCarried(tight).size < overlapCarried(o).size, "precondition: the bound drops a name");
  for (const l of tightRoot.querySelectorAll(".mv-ov-link a")) assert.ok(tightRoot.querySelector(l.getAttribute("href")!), `${l.getAttribute("href")} is carried`);
  /* every move's opened body, the held ones' included, rendered as the server renders a visible row */
  const tightIds = new Set([...overlapCarried(tight)].map(overlapRowId));
  const allIds = namedMoveIds(inst);
  let dropped = 0;
  inst.domSet.forEach((mv, i) => {
    const body = moveRowHtml(mv, allIds[i]!, inst, false, null, tightIds);
    for (const m of body.matchAll(/<p class="mv-ov-link"><a href="#([^"]+)">/g)) assert.ok(tightIds.has(m[1]!), `${allIds[i]}: links #${m[1]}, which the page carries`);
    if (mv.ticker && !tightIds.has(overlapRowId(mv.ticker)) && /Congress · \d+ members? with a/.test(body)) dropped++;
  });
  assert.ok(dropped > 0, "precondition: a move whose side has members but whose name the bound left out");
  // without the Overlap tab: no link (M2's markup)
  assert.doesNotMatch(signalsInstitutionalHtml(inst, CTX), /mv-ov-link/);
  // a held row's client-rendered body equals the server's for the same move, the link included
  const ids = namedMoveIds(inst);
  const overlapIds = new Set([...overlapCarried(o)].map(overlapRowId));
  const { doc, restore } = installDom(html);
  try {
    doc.getElementById("mv-bank")!.innerHTML = "";
    const pager = initNamedMoves()!;
    /* launch M7a (D5): render every held row from the island first */
    pager.materialize(ids.at(-1)!);
    const rows = doc.querySelectorAll("#mv-list article.mv-item");
    let linked = 0;
    rows.forEach((r, i) => {
      pager.fill(r.querySelector("details")!);
      const want = domOf(moveRowHtml(inst.domSet[i]!, ids[i]!, inst, false, null, overlapIds)).querySelector(".mv-det")!.innerHTML;
      assert.equal(r.querySelector(".mv-det")!.innerHTML, want, ids[i]!);
      if (/mv-ov-link/.test(want)) linked++;
    });
    assert.ok(linked > 15, "held rows carry the link too");
  } finally {
    restore();
  }
  // the click: the Overlap tab, the row shown and opened
  const m = mount(html);
  try {
    const link = m.doc.querySelector('.mv-ov-link a[href="#ov-nvda"]')!;
    link.bubbleClick();
    assert.equal(m.doc.getElementById("tab-overlap")!.getAttribute("aria-selected"), "true");
    const row = m.doc.getElementById("ov-nvda")!;
    assert.equal(row.hasAttribute("hidden"), false);
    assert.equal(row.querySelector("details")!.hasAttribute("open"), true);
    assert.equal(m.loc.hash, "#ov-nvda");
  } finally {
    m.restore();
  }
});

/* codex M3 round 1, F1 (R21, D8): the link's one condition is that the page
   carries the name's Overlap row — in either variant — never the move's own
   side's Congress count. Two names the round-1 rule dropped: OPPX, which a
   member SOLD while a manager opened it (an Opposite row; the move's buy side
   has no counted member), and ZZ01, which only the broad account bought (a
   row of the broad-inclusive variant only; the move's side is the broad-only
   statement). OPPX's move is a held row, so its body is the client's. */
function f1Case(): { inst: ReturnType<typeof fixtureInstitutional>; o: Overlap; ids: Set<string>; oppIdx: number } {
  const base = fixtureMoves(200, { broadOnly: 10 });
  const opp: NotableMove = {
    ...base.find((m) => m.ticker === "NVDA" && m.kind === "new")!,
    cik: "0000009001", manager: "Opp Manager", principal: null, issuer: "OPPX HOLDINGS INC", ticker: "OPPX", ikey: "cusip6:oppx01",
    delta_value: 4_000_000, curr_value: 4_100_000, delta_shares: 999, key: "sid:sec:oppx", doc: "https://www.sec.gov/Archives/edgar/data/9001/oppx.xml",
  };
  /* population order: kind first, then the larger |Δ $| */
  const at = base.findIndex((m) => m.kind === "new" && m.delta_value != null && Math.abs(m.delta_value) < 4_000_000);
  const moves = [...base.slice(0, at), opp, ...base.slice(at)];
  const sale = { ...fixtureTxns()[0]!, txnId: "oppx-sale", ticker: "OPPX", side: "sale" as const, name: "Opp Seller", bioguide: "O000009", traded: "2026-02-17", filed: "2026-03-02" };
  const inst = fixtureInstitutional({ moves, txns: [...fixtureTxns(), sale] });
  const o = buildOverlap(inst.quarter, inst.moves);
  return { inst, o, ids: new Set([...overlapCarried(o)].map(overlapRowId)), oppIdx: inst.domSet.findIndex((m) => m.ticker === "OPPX") };
}

test("codex M3 r1 F1 (R21, D8): a move with no counted member on its own side still links the name's carried Overlap row — an Opposite row and a broad-only row — in the server body and the held row's client body", () => {
  const { inst, o, ids, oppIdx } = f1Case();
  // preconditions: the two shapes the round-1 rule dropped
  const oppRow = o.core.find((r) => r.ticker === "OPPX")!;
  assert.deepEqual([oppRow.rel, oppRow.cb, oppRow.cs, oppRow.gb, oppRow.gs], ["opposite", 0, 1, 1, 0], "OPPX: a Congress sale beside a manager's new stake");
  assert.equal(o.core.some((r) => r.ticker === "ZZ01"), false, "ZZ01: not in the default variant");
  assert.equal(o.all.find((r) => r.ticker === "ZZ01")?.rel, "same", "ZZ01: in the broad-inclusive variant");
  assert.ok(ids.has("ov-oppx") && ids.has("ov-zz01"), "both rows are carried");
  assert.ok(oppIdx >= 15, "precondition: OPPX's move is a held row");
  const allIds = namedMoveIds(inst);
  const html = signalsBody(ART, CTX, { rowsEvaluated: 0, triage: null, institutional: inst, overlap: o });
  const root = domOf(html);
  // the server: a visible broad-only row's body, and every body as the server renders a visible row
  const zz = inst.domSet.findIndex((m) => m.ticker === "ZZ01");
  assert.ok(zz >= 0 && zz < 15, "precondition: a ZZ01 move shows");
  const zzBody = root.querySelector(`#${allIds[zz]!} .mv-det`)!;
  assert.match(text(zzBody), /Only broad accounts — members who traded more than 25 names/, "its side is the broad-only statement");
  assert.equal(zzBody.querySelector(".mv-ov-link a")?.getAttribute("href"), "#ov-zz01", "and it links the broad-only row");
  const oppServer = domOf(moveRowHtml(inst.domSet[oppIdx]!, allIds[oppIdx]!, inst, false, null, ids)).querySelector(".mv-det")!;
  assert.match(text(oppServer), /None: no member of Congress reported a listed-stock purchase of OPPX/, "its side states no counted member");
  assert.equal(oppServer.querySelector(".mv-ov-link a")?.getAttribute("href"), "#ov-oppx", "and it links the Opposite row");
  // every move whose name the page carries links it — and only those
  inst.domSet.forEach((mv, i) => {
    const body = moveRowHtml(mv, allIds[i]!, inst, false, null, ids);
    const want = mv.ticker && ids.has(overlapRowId(mv.ticker)) ? `#${overlapRowId(mv.ticker)}` : null;
    assert.equal(/<p class="mv-ov-link"><a href="(#[^"]+)">/.exec(body)?.[1] ?? null, want, allIds[i]!);
  });
  // the held row's client-rendered body equals the server's, the link included
  const { doc, restore } = installDom(html);
  try {
    /* launch M7a (D5): the held row ships in the island; it renders on demand as the server's held row */
    assert.equal(doc.getElementById(allIds[oppIdx]!), null, "precondition: held in the island");
    const pager = initNamedMoves()!;
    const row = pager.materialize(allIds[oppIdx]!)! as unknown as MiniElement;
    assert.ok(row.hasAttribute("hidden") && row.hasAttribute("data-fp") && text(row.querySelector(".mv-det")) === "", "precondition: held, its body empty");
    pager.fill(row.querySelector("details")!);
    assert.equal(row.querySelector(".mv-det")!.innerHTML, oppServer.innerHTML);
    assert.equal(row.querySelector(".mv-ov-link a")?.getAttribute("href"), "#ov-oppx");
  } finally {
    restore();
  }
});

test("codex M3 r1 F1 control: gating the link on the move's own side's Congress count (the round-1 rule) drops both rows, so the test above reads the property", () => {
  const { inst, ids } = f1Case();
  const allIds = namedMoveIds(inst);
  const gated = (i: number): string => {
    const mv = inst.domSet[i]!;
    const counted = mv.ticker && inst.quarter ? congressQuarterCount(inst, mv) : 0;
    return moveRowHtml(mv, allIds[i]!, inst, false, null, counted > 0 ? ids : new Set());
  };
  for (const t of ["OPPX", "ZZ01"]) {
    const i = inst.domSet.findIndex((m) => m.ticker === t);
    assert.doesNotMatch(gated(i), /mv-ov-link/, `${t}: the gated rule omits it`);
    assert.match(moveRowHtml(inst.domSet[i]!, allIds[i]!, inst, false, null, ids), /mv-ov-link/, `${t}: the carried rule links it`);
  }
});

/* codex M3 round 1, F5 (R18, LD14): counts are of DISTINCT members and
   managers. The repeated case (`overlapDupCase`): one manager under several
   position keys on a name, one member with several lines on it. */
test("codex M3 r1 F5 (R18, LD14): distinct members and managers, never lines or changes — numbers, directions, relation, unanimity and order pinned by hand and equal to the independent recount, in both variants", () => {
  const { txns, moves } = overlapDupCase();
  const o = buildOverlap(congressQuarter(txns, DUP_PERIOD), moves);
  const pick = (rows: readonly OverlapRow[]) => rows.map((r) => [r.ticker, r.cb, r.cs, r.gb, r.gs, r.cdir, r.gdir, r.rel, r.unanimous, r.score]);
  // pinned by hand (the fixture's comment); a count of rows reads D1 buy on both sides and puts D2 before D3
  assert.deepEqual(pick(o.core), [
    ["D3", 1, 0, 3, 0, "buy", "buy", "same", true, 4],
    ["D2", 2, 0, 1, 0, "buy", "buy", "same", true, 3],
    ["D1", 1, 2, 1, 2, "sell", "sell", "same", false, 4],
    ["D4", 1, 0, 2, 1, "buy", "buy", "same", false, 3],
  ]);
  assert.deepEqual(pick(o.all), [
    ["D3", 1, 0, 3, 0, "buy", "buy", "same", true, 4],
    ["D2", 2, 0, 1, 0, "buy", "buy", "same", true, 3],
    ["D4", 1, 0, 2, 1, "buy", "buy", "same", false, 3],
    ["D1", 2, 2, 1, 2, "mixed", "sell", "mixed", false, 4],
  ]);
  // preconditions: the case repeats what the rule must not count
  const d1 = o.core.find((r) => r.ticker === "D1")!;
  assert.deepEqual([d1.mBuy.length, d1.mSell.length, d1.buy[0]!.rows.length], [3, 3, 3], "one manager's three changes, another's two, one member's three lines");
  assert.equal(o.core.find((r) => r.ticker === "D2")!.mBuy.length, 4);
  assert.equal(o.core.find((r) => r.ticker === "D4")!.mSell.length, 3, "one manager's three trims");
  // the independent recount (its own Sets over the raw rows) agrees, number for number
  const re = independentOverlapRows(txns, moves, DUP_PERIOD);
  const rePick = (rows: readonly RecountRow[]) => rows.map((r) => [r.t, r.cb, r.cs, r.gb, r.gs, r.cdir, r.gdir, r.rel, r.un, r.score]);
  assert.deepEqual(pick(o.core), rePick(re.core));
  assert.deepEqual(pick(o.all), rePick(re.all));
  // the rendered labels, both variants
  const root = domOf(signalsOverlapHtml(o, CTX));
  const item = root.querySelector("#ov-d1")!;
  assert.deepEqual(item.querySelectorAll(".ov-rl .ov-rel").map((r) => text(r)), ["SAME · SELL SIDE", "MIXED"]);
  assert.deepEqual(item.querySelectorAll(".ov-cg").map((c) => text(c)), [
    "▲1 · ▼2Congress: 1 member with a purchase, 2 with a sale",
    "▲2 · ▼2Congress: 2 members with a purchase, 2 with a sale",
  ]);
  assert.equal(text(item.querySelector(".ov-mg")), "▲1 · ▼2Managers: 1 manager opened or added, 2 trimmed or exited");
  assert.equal(text(root.querySelector("#ov-d2 .ov-mg")), "▲1 · ▼0Managers: 1 manager opened or added, 0 trimmed or exited");
  assert.equal(text(root.querySelector("#ov-d2 .ov-cg")), "▲2 · ▼0Congress: 2 members with a purchase, 0 with a sale");
  assert.equal(text(root.querySelector("#ov-d4 .ov-mg")), "▲2 · ▼1Managers: 2 managers opened or added, 1 trimmed or exited");
  assert.equal(text(root.querySelector("#ov-d4 .ov-rel")), "SAME · BUY SIDE");
  assert.deepEqual(root.querySelectorAll("article.ov-item").map((i) => i.getAttribute("id")), ["ov-d3", "ov-d2", "ov-d1", "ov-d4"], "the order");
  assert.equal(text(root.querySelector('button[data-ov-rel="same"] .ov-n[data-v="core"]')), "4");
  assert.equal(text(root.querySelector('button[data-ov-rel="same"] .ov-n[data-v="all"]')), "3");
  assert.equal(text(root.querySelector('button[data-ov-rel="opposite"] .ov-n')), "0");
  // the opened row: one line a member, one change a manager
  assert.equal(item.querySelectorAll(".ov-det ul.cl-list")[0]!.querySelectorAll("li.cl-line").length, 1, "member A's newest line only");
  assert.equal(item.querySelectorAll(".ov-det ul.ov-mlist")[0]!.querySelectorAll("li.ov-mline").length, 1, "manager X once");
});

/* codex M3 round 1, F3 (R18, D3): the representative change is each
   manager's LARGEST on the name — never the population's first, which
   orders by kind before size. */
test("codex M3 r1 F3 (R18, D3): an opened Overlap row lists each manager's largest change — a $1,000,000 add over its own $1,000 new, a −$2,000,000 trim over its own exit — with that change's receipt; ties by |Δ shares|, then position key; no value last", () => {
  const q = congressQuarter([
    { ...overlapTxns()[0]!, txnId: "f3-b", ticker: "BIG", side: "purchase", bioguide: "Q000101" },
    { ...overlapTxns()[0]!, txnId: "f3-s", ticker: "BIG", side: "sale", bioguide: "Q000102" },
  ], OVERLAP_PERIOD);
  const base = overlapMoves()[0]!;
  const mv = (key: string, cik: string, kind: NotableMove["kind"], dv: number | null, ds: number): NotableMove => ({
    ...base, ticker: "BIG", issuer: `BIG ${key.toUpperCase()} INC`, cik, manager: `Manager ${cik}`, key: `sid:sec:${key}`, kind, delta_value: dv, delta_shares: ds,
    doc: `https://www.sec.gov/Archives/edgar/data/1/${key}.xml`,
  });
  /* population order: kind first (New › Exit › Add › Trim) */
  const moves = [
    mv("m1-new", "0000000001", "new", 1_000, 10),
    mv("m2-new", "0000000002", "new", 500_000, 50),
    mv("m1-exit", "0000000001", "exit", -500, -5),
    mv("m1-add", "0000000001", "add", 1_000_000, 100),
    mv("m3-add-a", "0000000003", "add", 200_000, 20),
    mv("m3-add-b", "0000000003", "add", 200_000, 30),
    mv("m4-add-null", "0000000004", "add", null, 900),
    mv("m4-add", "0000000004", "add", 10, 1),
    mv("m5-add", "0000000005", "add", 800_000, 80),
    mv("m1-trim", "0000000001", "trim", -2_000_000, -200),
  ];
  const o = buildOverlap(q, moves);
  const row = o.core.find((r) => r.ticker === "BIG")!;
  assert.equal(row.issuer, "BIG M1-TRIM INC", "the issuer as filed on its largest change");
  const det = domOf(signalsOverlapHtml(o, CTX)).querySelector("#ov-big .ov-det")!;
  const [buys, sells] = det.querySelectorAll("ul.ov-mlist");
  const lines = (ul: MiniElement) => ul.querySelectorAll("li.ov-mline").map((li) => [text(li.querySelector(".ov-m")), text(li.querySelector(".mv-dv")), li.querySelector("a.mv-src")!.getAttribute("href")]);
  assert.deepEqual(lines(buys!), [
    ["Manager 0000000001", signedUsd(1_000_000), "https://www.sec.gov/Archives/edgar/data/1/m1-add.xml"],
    ["Manager 0000000005", signedUsd(800_000), "https://www.sec.gov/Archives/edgar/data/1/m5-add.xml"],
    ["Manager 0000000002", signedUsd(500_000), "https://www.sec.gov/Archives/edgar/data/1/m2-new.xml"],
    ["Manager 0000000003", signedUsd(200_000), "https://www.sec.gov/Archives/edgar/data/1/m3-add-b.xml"],
    ["Manager 0000000004", signedUsd(10), "https://www.sec.gov/Archives/edgar/data/1/m4-add.xml"],
  ], "largest |Δ $| a manager, the managers by it (m5's only change, an add, before m2's new); a tie on Δ $ by |Δ shares|; a disclosed value before none");
  assert.equal(OVERLAP_DETAIL_MANAGERS, 5, "five managers: the side's cap is reached, nothing past it");
  assert.deepEqual(lines(sells!), [["Manager 0000000001", signedUsd(-2_000_000), "https://www.sec.gov/Archives/edgar/data/1/m1-trim.xml"]]);
  assert.doesNotMatch(det.innerHTML, /m1-new\.xml|m1-exit\.xml/, "the manager's smaller changes are not its line");
  // the comparator's rules, directly
  assert.deepEqual(largestPerManager(moves).map((m) => m.key.slice(8)), ["m1-trim", "m5-add", "m2-new", "m3-add-b", "m4-add"]);
  const tieKey = [mv("k-b", "0000000009", "add", 5, 5), mv("k-a", "0000000009", "add", 5, 5)];
  assert.equal(largestPerManager(tieKey)[0]!.key, "sid:sec:k-a", "a full tie: the lower position key");
  assert.equal(largestPerManager([mv("n1", "0000000008", "add", null, 50), mv("n2", "0000000008", "add", null, 70)])[0]!.key, "sid:sec:n2", "no value on either: |Δ shares|");
  // the collapsed row names the managers by the same pick (buy side first)
  assert.match(text(domOf(signalsOverlapHtml(o, CTX)).querySelector("#ov-big .ov-mw")), /^Manager 0000000001 ADD · Manager 0000000005 ADD · Manager 0000000002 NEW \+2$/);
});

test("T3.3: the overlap fixture's specs match its rows (a fixture that drifts fails here, not in the reader's tests)", () => {
  const o = fixtureOverlap({ sliceRows: 100 });
  for (const s of overlapSpecs().filter((x) => x.cb + x.cs > 0)) {
    const r = o.core.find((x) => x.ticker === s.t)!;
    assert.deepEqual([r.cb, r.cs, r.gb, r.gs], [s.cb, s.cs, s.gb, s.gs], s.t);
  }
  assert.equal(overlapCarried(o).size, 46, "at 100 a view every name is carried");
});
