/* RUN SURFACES-LEGIBILITY — T11, the filer page (SL-R22).

   `sl-` prefix per Constraint 9.

   R22 is mostly a set of things that must NOT happen — the §5 box is not
   relocated, the raw `position_key` cells are not touched, the truncation
   terminus and the pager survive — so most of this file asserts survival. A
   requirement whose content is "leave this alone" is exactly the kind that
   rots silently, which is why it is pinned rather than trusted. */

import { test } from "node:test";
import assert from "node:assert/strict";

import { readFileSync } from "node:fs";
import path from "node:path";

import { filerBody, filerFootHtml, filerTiles } from "../src/lib/ui/index.ts";
import { noteId, esc } from "../src/lib/format.ts";
import { INSTITUTIONAL_DATA_NOTE_CLAUSES, institutionalDataNoteHtml } from "../src/lib/holdings.ts";

const SRC = path.resolve(import.meta.dirname, "..", "src");
import type { ConcentrationRow, QoqDeltaRow } from "../src/lib/inst.ts";

const FILER = { cik: "0001067983", name: "FIXTURE HOLDINGS LLC", latestPeriod: "2026-03-31" };
const PERIODS = ["2025-12-31", "2026-03-31"];
const CONC: ConcentrationRow = {
  cik: "0001067983",
  period_of_report: "2026-03-31",
  position_count: 2,
  total_value_usd: 2300,
  null_value_positions: 3,
  topn_value_usd: 2300,
  topn_share_bps: 10000,
  hhi: 7500,
  flags: [],
};

function delta(over: Partial<QoqDeltaRow> = {}): QoqDeltaRow {
  return {
    cik: "0001067983",
    position_key: "sid:sec:prov:00076fbdb7a2ddaf78c0e89001ecf4f7",
    put_call: "LONG",
    curr_period: "2026-03-31",
    prev_period: "2025-12-31",
    change_kind: "trim",
    prev_value_usd: 1_000_000,
    curr_value_usd: 400_000,
    delta_value_usd: -600_000,
    prev_shares: 100,
    curr_shares: 40,
    delta_shares: -60,
    ssh_prnamt_type: "SH",
    flags: [],
    ...over,
  };
}

function body(deltas: QoqDeltaRow[], conc: ConcentrationRow | null = CONC, opts = {}): string {
  return filerBody(FILER, PERIODS, "2026-03-31", conc, deltas, "2026-05-15", 25, null, opts);
}

function panelTextOf(html: string, id: string): string {
  const re = new RegExp(`<span class="note-pop" popover id="${id}"[^>]*>([\\s\\S]*?)</span>`);
  const m = re.exec(html);
  assert.ok(m, `no panel rendered for #${id}`);
  return m![1]!;
}

/* ------------------------------------------------- the six tiles (SL-R22) */

test("SL-R22/SL-R26: every filer tile with a breakdown carries it as a note keyed on its LABEL", () => {
  const html = body([delta()]);
  const tiles = filerTiles(CONC, 1);
  const withTitles = tiles.filter((t) => t.title);
  assert.ok(withTitles.length >= 5, "the populated branch has five tiles that explain themselves");

  for (const t of withTitles) {
    const id = noteId("filer-tiles", t.label);
    assert.equal(panelTextOf(html, id), esc(t.title!), `"${t.label}" carries its breakdown verbatim`);
  }
  // Keys are singular BY CONSTRUCTION here, and that is asserted rather than
  // reasoned about: a repeated label would emit a repeated id.
  const labels = tiles.map((t) => t.label);
  assert.equal(new Set(labels).size, labels.length, "tile labels are unique within the group");

  // …and the same holds on the null-concentration branch, which has its own,
  // shorter tile set and was never exercised by the populated fixture.
  const nullBranch = filerTiles(null, 0).map((t) => t.label);
  assert.equal(new Set(nullBranch).size, nullBranch.length, "…on the null branch too");
});

test("SL-R22: the tile scope does NOT move with the period — server and client must agree (Constraint 5)", () => {
  /* `entity-client.ts` re-renders this whole section on a period change. An id
     derived from the period would make the same tile carry a different id on
     the two sides of that swap, which is the parity contract Constraint 5
     pins. Same tiles, two periods, identical ids. */
  const a = filerBody(FILER, PERIODS, "2026-03-31", CONC, [delta()], "2026-05-15", 25, null);
  const b = filerBody(
    FILER, PERIODS, "2025-12-31",
    { ...CONC, period_of_report: "2025-12-31" },
    [delta({ curr_period: "2025-12-31", prev_period: "2025-09-30" })],
    "2026-05-15", 25, null,
  );
  const idsOf = (h: string): string[] =>
    [...h.matchAll(/popover id="(n-filer-tiles-[^"]+)"/g)].map((m) => m[1]!).sort();
  assert.deepEqual(idsOf(a), idsOf(b), "a period switch must not renumber a single note");
  assert.ok(idsOf(a).length > 0, "…and the fixture actually renders tile notes");
});

/* ------------------------------ what R22 forbids moving, asserted as such */

/* SL-R22, rewritten in DESIGN-POLISH M2 (T2.5, F). The property R22 pinned is
   "exactly ONE §5 box per filer page, with ONE of each clause" — a second
   instance would emit a duplicate `id="inst-data-note"` and a reader would
   meet the same caveat twice. The owner moved: the box is no longer rendered
   beside the holdings surface (HoldingsTable renders none when the filer page
   passes `dataNote={false}`), it is the page's full-width FOOT, rendered once
   through `filerFootHtml` — the part both the pre-rendered page and the /e/
   driver (via `filerBody`) emit. The header still POINTS at it. */
function s5Boxes(html: string): number {
  return (html.match(/id="inst-data-note"/g) ?? []).length;
}

test("SL-R22 (M2): exactly ONE §5 box per filer page — at its foot, through filerFootHtml — and ONE of each clause", () => {
  const html = body([delta()]);
  assert.equal(s5Boxes(html), 1, "the filer body renders the box exactly once");
  for (const clause of INSTITUTIONAL_DATA_NOTE_CLAUSES) {
    assert.equal(
      (html.match(new RegExp(escapeRe(esc(clause.text)), "g")) ?? []).length,
      1,
      `the §5 clause "${clause.id}" is stated exactly once`,
    );
  }
  const foot = filerFootHtml(FILER.cik, FILER.name);
  assert.equal(s5Boxes(foot), 1, "the foot part owns the box");
  assert.ok(html.endsWith(foot), "…and the foot is the body's last part");
  // the header still POINTS at the canonical box; the methodology deep link now
  // sits on the comparability line (launch copy audit filer-02: one link)
  assert.ok(html.indexOf('href="#inst-data-note"') >= 0 && html.indexOf('href="#inst-data-note"') < html.indexOf('id="inst-data-note"'), "the head's pointer leads to the box below it");
  assert.match(html, /href="\/methodology\/#m2"/, "and the page keeps its methodology deep link");
  assert.match(html, /not current holdings/, "and the one claim the header itself must carry");

  // the pre-rendered page: the component renders NO box there, and the foot renders once
  const page = readFileSync(path.join(SRC, "pages", "institutional", "filers", "[cik].astro"), "utf-8");
  assert.match(page, /<HoldingsTable kind="filer"[^>]*\bdataNote=\{false\}/, "the filer page turns the component's copy off");
  assert.match(page, /const footHtml = filerFootHtml\(/);
  assert.equal((page.match(/set:html=\{footHtml\}/g) ?? []).length, 1, "…and renders the foot once");
  // the /e/ driver emits the box only through filerBody — no second render call
  assert.doesNotMatch(readFileSync(path.join(SRC, "scripts", "entity-client.ts"), "utf-8"), /institutionalDataNoteHtml\(/);

  // controls: a second instance (the component's copy left on) and a lost foot each break the count
  assert.equal(s5Boxes(html + institutionalDataNoteHtml()), 2, "control: a doubled box is counted");
  assert.equal(s5Boxes(html.replace(foot, "")), 0, "control: a lost foot is counted");
});

test("SL-R22 / R21-DEFERRED: the position-changes CELLS keep their raw key; the HEADERS carry notes", () => {
  /* The boundary is cells, not the table. R21 left this run, so resolving the
     32-character `position_key` to an issuer name is out of scope and the cell
     still prints it — a real, reader-hostile defect, deferred in the open. The
     headers are a different question and R7/R7b/R7c converted them. */
  const html = body([delta()]);
  assert.match(
    html,
    /sid:sec:prov:00076fbdb7a2ddaf78c0e89001ecf4f7/,
    "the raw key is still rendered — the deferral is visible, not quietly closed",
  );
  const headerNote = noteId("filer-changes", "position-grain");
  assert.ok(
    html.includes(`id="${headerNote}"`),
    "…while the position-grain HEADER explains itself through a note",
  );
});

test("SL-R22: the truncation terminus and the pager both survive", () => {
  /* Named in T11 because they are adjacent to everything this task touched and
     a terminus is exactly the kind of line that disappears in a refactor. */
  const html = body([delta()], CONC, { total: 5000, page: 0 });
  assert.match(html, /class="terminus" data-terminus-author="populus"/, "the changes terminus stands");
  /* DESIGN-POLISH M3 (Architecture H, H-3; T3.10): the band states what is
     TRUE of the rows — QoQ compares every position with a security identifier
     and counts the keyless ones; the old "top-25 slices" sentence was false.
     Launch copy audit filer-07: nothing is truncated there, so that sentence
     is a caveat line (not a terminus) and keeps the comparability gap. */
  const caveat = /<div class="caveat-line">Holdings without a security ID are counted, not compared\. <a href="\/methodology\/#m2">Method ↗<\/a><\/div>/;
  assert.match(html, caveat, "…stating what is true of the rows");
  assert.match(body([delta()]), caveat, "…on an uncapped period too, where no terminus renders");
  assert.doesNotMatch(body([delta()]), /data-terminus-author/, "control: an uncapped period renders no terminus at all");
  assert.doesNotMatch(html, /top-25 slices|keyable|differenced|Changes compare every position/, "control: the false sentence, its pipeline words and the retired wording are gone");
  assert.match(html, /methodology\/#m2/, "with its methodology link intact");
});

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/* ------------------------------ DESIGN-POLISH M2 review Q2-6: the period switch */

/* The property (T2.5, A-9): after a period switch, EVERY period-dependent root
   — the ledger (`[data-filer-ledger]`), the Position changes root
   (`[data-filer-root]`) and the Book shape (`[data-filer-bookshape]`) — holds
   exactly what the server renders for that period. The gate build carries one
   period, so the browser assertions behind `chips.count() > 1` never ran; this
   drives `initFilerPeriods` itself over two periods, on the markup the page
   emits, through the real delegated click. The control leaves one root
   unrepainted and must be caught. */
import {
  filerBookShapeHtml as bookShapeOf,
  filerChangesHtml as changesOf,
  filerHeadHtml as headOf,
  filerHistoryHtml as historyOf,
  filerLedgerHtml as ledgerOf,
} from "../src/lib/ui/index.ts";
import { installDom, MiniElement as MiniEl } from "./lib/mini-dom.ts";
import { initFilerPeriods } from "../src/scripts/entity-client.ts";
import { serializeInlineJson } from "../src/lib/inline-json.ts";

const Q = { a: "2025-12-31", b: "2026-03-31" };
const CONC_BY: Record<string, ConcentrationRow> = {
  [Q.a]: { ...CONC, period_of_report: Q.a, position_count: 5, total_value_usd: 9_900, topn_value_usd: 9_000, topn_share_bps: 9091, hhi: 4100 },
  [Q.b]: CONC,
};
const DELTAS_BY: Record<string, QoqDeltaRow[]> = {
  [Q.a]: [delta({ curr_period: Q.a, prev_period: "2025-09-30", change_kind: "new", prev_shares: null, delta_shares: 40, position_key: "sid:a1" })],
  [Q.b]: [delta(), delta({ change_kind: "exit", curr_shares: null, delta_shares: -100, position_key: "sid:b2" })],
};
const KINDS_BY: Record<string, { new: number; exit: number }> = { [Q.a]: { new: 1, exit: 0 }, [Q.b]: { new: 0, exit: 1 } };

/** The filer page at `period`, composed exactly as `[cik].astro` composes it. */
function filerPageAt(period: string): string {
  const periods = [Q.a, Q.b];
  const total = DELTAS_BY[period]!.length;
  const opts = { total, benchmark: null, discontinuity: false, kinds: KINDS_BY[period]! };
  const embed = serializeInlineJson({
    latestFiled: "2026-05-15",
    topn: 25,
    benchmarks: { [Q.a]: null, [Q.b]: null },
    periods: Object.fromEntries(periods.map((p) => [p, { conc: CONC_BY[p]!, deltas: DELTAS_BY[p]!, total: DELTAS_BY[p]!.length, discontinuity: false, kinds: KINDS_BY[p]! }])),
  });
  return (
    `<main class="shell page entity-page filer-page">` +
    headOf(FILER, CONC_BY[period]!, null, null, ledgerOf(CONC_BY[period]!, period, total, KINDS_BY[period]!)) +
    changesOf(periods, period, CONC_BY[period]!, DELTAS_BY[period]!, "2026-05-15", 25, opts) +
    `<div class="design-band design-filer-band"><section class="panel" data-pair-primary aria-label="Reported holdings"></section>` +
    `<div class="design-filer-side"><div class="filer-bookshape-root" data-filer-bookshape>${bookShapeOf(CONC_BY[period]!, 25, period, total, null)}</div>${historyOf(FILER.cik, periods)}</div></div>` +
    `<script type="application/json" id="filer-period-data">${embed}</script></main>`
  );
}

const ROOTS = ["[data-filer-ledger]", "[data-filer-root]", "[data-filer-bookshape]"] as const;
/** Each period root's markup, re-serialised by the same parser so both sides compare like for like. */
function rootsOf(doc: { querySelector(s: string): MiniEl | null }): Record<string, string> {
  return Object.fromEntries(ROOTS.map((r) => [r, doc.querySelector(r)?.innerHTML ?? "(missing)"]));
}
/** Every root that does not hold the server's markup for `period`. */
function periodRootProblems(got: Record<string, string>, period: string): string[] {
  const holder = new MiniEl("body");
  holder.innerHTML = filerPageAt(period);
  const want = rootsOf(holder);
  return ROOTS.filter((r) => got[r] !== want[r]).map((r) => `${r} does not hold the server's ${period} markup`);
}

test("Q2-6: a period switch repaints the ledger, the changes root and the book shape, each equal to the server's page for that period", () => {
  const { doc, restore } = installDom(filerPageAt(Q.b));
  try {
    initFilerPeriods();
    assert.deepEqual(periodRootProblems(rootsOf(doc), Q.b), [], "the first render is the server's");
    const chipFor = (p: string): MiniEl => doc.querySelector(`[data-period-chips] [data-period="${p}"]`)!;
    assert.ok(chipFor(Q.a), "the segments offer the other period");
    chipFor(Q.a).bubbleClick();
    assert.deepEqual(periodRootProblems(rootsOf(doc), Q.a), [], "after switching to the older period");
    assert.notDeepEqual(rootsOf(doc), (() => { const h = new MiniEl("body"); h.innerHTML = filerPageAt(Q.b); return rootsOf(h); })(), "the periods differ, so the comparison can fail");
    chipFor(Q.b).bubbleClick();
    assert.deepEqual(periodRootProblems(rootsOf(doc), Q.b), [], "and back");
  } finally {
    restore();
  }
});

test("Q2-6 control: a root the switch does not repaint is caught", () => {
  // the Book shape root without its hook: the switch cannot find it
  const { doc, restore } = installDom(filerPageAt(Q.b).replace(" data-filer-bookshape", " data-filer-bookshape-lost"));
  try {
    initFilerPeriods();
    doc.querySelector(`[data-period-chips] [data-period="${Q.a}"]`)!.bubbleClick();
    const got = rootsOf(doc);
    got["[data-filer-bookshape]"] = doc.querySelector("[data-filer-bookshape-lost]")!.innerHTML;
    assert.deepEqual(periodRootProblems(got, Q.a), [`[data-filer-bookshape] does not hold the server's ${Q.a} markup`]);
  } finally {
    restore();
  }
});

/* ------------------------------ launch redesign M6: the filer copy sweep */

/* Launch copy audit filer-01 … filer-11 (PLAN R29, R30, R2; LD3 gives M6 the
   filer page). Each applied item is pinned three ways: the shipped text is
   present, the text it replaced is gone, and every caveat the item touched is
   still on the page. The word budget per element is the audit's own
   `words_after` for that item, counted by the audit's rule: visible text only
   (a note's popover and screen-reader-only text excluded), a word being a
   whitespace token holding a letter or digit once the audit's symbols are
   spaced out. The page-level gate (filer ≤ 251 on the served HTML) is the
   post-build word predicate's, judged on the integrated build. */
import { BANNED_PATTERNS, redactFiledNames } from "./lib/banned-scan.ts";
import { domOf, visibleText } from "./lib/ledger-dom.ts";
import type { MiniElement } from "./lib/mini-dom.ts";
import { holdingsTableHtml, type FilerHoldingRow } from "../src/lib/holdings.ts";
import { FILINGS } from "./fixtures/institutional.ts";

function auditWords(el: MiniElement | null): number {
  if (!el) return 0;
  const text = (n: MiniElement): string =>
    n.nodes.map((c) => (typeof c === "string" ? c : c.classList.contains("visually-hidden") ? " " : c.classList.contains("note-pop") ? " " : text(c))).join("");
  return visibleText(domOf(el.outerHTML)) === "" ? 0 : text(el).replace(/&[a-z#0-9]+;/g, " ").replace(/[⏎↗↓→←▲▼◂▸ⓘ§†‡·|/⌕☰]/g, " ").split(/\s+/).filter((w) => /[A-Za-z0-9]/.test(w)).length;
}

function m6FilerPage(): string {
  const typing = { cik: "0001067983", display_name: "Fixture Capital", person: "Pat Example", manager_type: "insurer", notable: true } as never;
  const rows: FilerHoldingRow[] = Array.from({ length: 6 }, (_, i) => ({
    cik: "0001067983", period: "2026-03-31", filing_key: "1", security_id: null, cusip: `${String((i % 3) + 1).repeat(6)}10${i}`, issuer_name: `ISSUER ${i % 3}`, title_of_class: "COM",
    value_usd: 100 + i, shares: 10, ssh_type: "SH", put_call: null, position_key: `cusip:${String((i % 3) + 1).repeat(6)}10${i}`, put_call_bucket: "LONG", unit_key: "SH", flags: [],
  }) as unknown as FilerHoldingRow);
  const holdingsHtml = holdingsTableHtml({ reference: true, cik: "0001067983", filerName: "FIXTURE HOLDINGS LLC", period: "2026-03-31", rows, filings: FILINGS, page: 0 });
  const deltas = [delta(), delta({ position_key: "sid:held", change_kind: "held", delta_shares: 0, prev_shares: 40, curr_shares: 40 })];
  return filerBody(FILER, PERIODS, "2026-03-31", { ...CONC, null_value_positions: 0 }, deltas, "2026-07-31", 25, { open: true, quarterEnd: "2026-09-30", deadline: "2026-11-16" }, {
    total: 2,
    typing,
    benchmark: { period: "2026-03-31", population: 8748, topnShareBps: { median: 8000 }, hhi: { median: 446, n: 8662 }, positions: { median: 97.5 } } as never,
    holdingsHtml: `<section class="panel panel-wide" aria-label="Reported holdings" data-holdings-surface="filer">${holdingsHtml}</section>`,
  });
}

test("launch M6 (filer-01…11): the shipped copy, the replaced copy gone, every touched caveat kept", () => {
  const html = m6FilerPage();
  const dom = domOf(html);
  const one = (sel: string): MiniElement => {
    const el = dom.querySelector(sel);
    assert.ok(el, `${sel} renders`);
    return el!;
  };
  // filer-01: identity only; the filed name is the H1's tip, still marked as filed text
  assert.equal(visibleText(one(".entity-subline")), "Pat Example · Insurers · CIK 1067983 · EDGAR ↗");
  assert.match(one("h1.entity-title").outerHTML, /<span class="note-pop" popover id="n-filer-head-filed-as" role="note">Filed as <span class="filed-name">FIXTURE HOLDINGS LLC<\/span>\.<\/span>/);
  assert.ok(one(".entity-subline").querySelector(".mgr-person"), "the person behind the curated name stays (an honesty selector)");
  // filer-02: the same caveat in half the words, one link into the §5 box
  assert.equal(visibleText(one(".filer-provenance")), "Quarter-end snapshot, filed up to 45 days later — not current holdings. What a 13F covers ↓");
  // filer-03: calendar facts and incompleteness, in plain words
  assert.equal(visibleText(one(".s7-copy")), "Q3 2026 filings are due by 2026-11-16 — figures for that quarter will change; missing filers are not zeros.");
  // filer-04 + filer-06 (stamp): the quarter heads the band; its ⓘ keeps the quarter end and the filings-through date
  assert.equal(visibleText(one(".design-changes .panel-head h2")), "Changes · Q1 2026");
  assert.match(html, /role="note">Quarter ended 2026-03-31\. Newest filing in this build: 2026-07-31\. Per-row filing dates are on each receipt\.<\/span>/);
  assert.equal(visibleText(one(".design-changes .panel-head .panel-note")), "by shares · How classified ↗");
  // filer-05: the Change tip keeps every marker's meaning, without producer slugs
  const changeTip = visibleText(one("#n-filer-changes-change"));
  for (const clause of ["NEW / ADD / TRIM / EXIT by share count", "NO CHANGE = same shares", "EXIT = absent this quarter", "NO PRIOR = no comparable prior quarter", "n/c = not classifiable", "†v: the reported share count is unchanged"]) {
    assert.ok(changeTip.includes(clause), `the Change tip keeps "${clause}"`);
  }
  assert.doesNotMatch(html, /<code>(classified_by_value|shares_unit_mismatch|identity_reconciled_by_cusip)<\/code>/, "no producer slug in a reader tip");
  // filer-06: the absence statements kept where they are honesty (the Flags reason), the rest cut
  assert.match(html, /<p class="table-foot-reason">Flags: no row carries a flag\.<\/p>/, "not applied: the removed honesty column still states why (m1-layout.test.ts)");
  // filer-07: a caveat, not a terminus, and it keeps the comparability gap
  assert.equal(visibleText(dom.querySelectorAll(".design-changes .caveat-line").at(-1)!), "Holdings without a security ID are counted, not compared. Method ↗");
  // filer-08: the list's head counts issuers and rows; zero undisclosed rows print nothing
  assert.equal(visibleText(one('[data-holdings-surface="filer"] .panel-head .panel-note')), "3 issuers · 6 rows");
  // filer-09: one line, the grouping detail a link away
  assert.equal(visibleText(dom.querySelectorAll('[data-holdings-surface="filer"] .caveat-line').at(-1)!), "One line per issuer, largest first — open a line for its reported rows. Grouping ↗");
  // filer-10: the median and the method as the head's tip; the summary in its own unit
  assert.equal(visibleText(one(".design-book-shape .panel-head .panel-note")), "vs median");
  assert.match(visibleText(one("#n-filer-bookshape-median")), /^Tick = median of the 8,748 tracked filers with a 2026-03-31 book \(the index median: the 8,662 with a complete book\)\. Concentration uses reported 13F long value, not total assets; the index is withheld when any position lacks a value\.$/);
  assert.equal(visibleText(one(".book-source")), "2 quarter-over-quarter rows");
  // filer-11: the receipt stays; the decision log and the generic cards go
  assert.equal(visibleText(one("details.edgar-block p")), "The filing on EDGAR is the record, including any filed after this build.");

  // replaced copy: gone
  for (const gone of [
    "reported 13(f) long value", "latest quarter", "mgr-chip-notable", "A quarter-end snapshot.", "never a complete portfolio", "what a 13F is — and is not",
    "provisional by construction", "Position changes — into", "Δ value · filing link", "how changes are classified", "AVAILABLE QUARTERS", "planned-line",
    "Truncated by Public Filings. Changes compare", "disclosed value over", "undisclosed-value rows", "this build publishes the selected quarter",
    "Change kind and share change are in Position changes above", "a row with no issuer key stands on its own line", "Issuer totals on the holders pages",
    "vs tracked median", "tick = median", "null-value positions: ", "QoQ moves", "id=\"filer-notes\"", "Notes on this data", "provenance, not a substitute",
    "decided on 2026-08-01", "The complete filing on EDGAR.",
  ]) {
    assert.ok(!html.includes(gone), `replaced copy is gone: "${gone}"`);
  }
  // every caveat the items touched, still on the page (R2)
  for (const kept of ["not current holdings", "filed up to 45 days later", "missing filers are not zeros", "will change", "counted, not compared", "not total assets", "the index is withheld", "Newest filing in this build: 2026-07-31", 'id="inst-data-note"']) {
    assert.ok(html.includes(kept), `the caveat stays: "${kept}"`);
  }
  // R30: no banned wording in the copy (filed names redacted, as the gate does)
  const scanned = redactFiledNames(html);
  assert.deepEqual(BANNED_PATTERNS.filter((p) => p.re.test(scanned)).map((p) => p.name), []);
});

test("launch M6 (filer-01…10): each element within the audit's words_after, counted by the audit's rule", () => {
  const dom = domOf(m6FilerPage());
  const budget: [string, string, number][] = [
    ["filer-01", ".entity-subline", 6],
    ["filer-02", ".filer-provenance", 15],
    ["filer-03", ".s7-banner", 21],
    ["filer-04", ".design-changes .panel-head h2", 3],
    ["filer-04 meta", ".design-changes .panel-head .panel-note", 4],
    ["filer-08", '[data-holdings-surface="filer"] .panel-head .panel-note', 4],
    ["filer-10", ".design-book-shape .panel-head .panel-note", 6],
  ];
  for (const [id, sel, max] of budget) {
    const n = auditWords(dom.querySelector(sel));
    assert.ok(n > 0 && n <= max, `${id}: ${n} visible words (audit words_after ${max})`);
  }
  const comparability = dom.querySelectorAll(".design-changes .caveat-line").at(-1)!;
  assert.ok(auditWords(comparability) <= 10, `filer-07: ${auditWords(comparability)} visible words (audit words_after 10)`);
  const grouping = dom.querySelectorAll('[data-holdings-surface="filer"] .caveat-line').at(-1)!;
  assert.ok(auditWords(grouping) <= 14, `filer-09: ${auditWords(grouping)} visible words (audit words_after 14)`);
  // the counter's controls: a tip's words and screen-reader text are not counted; a visible word is
  assert.equal(auditWords(domOf('<p>Two words <span class="note"><button>ⓘ</button><span class="note-pop">ten hidden words in a tip are never counted here ok</span></span><span class="visually-hidden">sr only</span></p>').querySelector("p")), 2);
  assert.equal(auditWords(domOf("<p>45 days · 13F ↗ —</p>").querySelector("p")), 3, "figures count; symbols do not");
});
