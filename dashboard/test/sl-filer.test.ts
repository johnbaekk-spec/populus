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
  // the header still POINTS at the canonical box, with its methodology deep link
  assert.ok(html.indexOf('href="#inst-data-note"') >= 0 && html.indexOf('href="#inst-data-note"') < html.indexOf('id="inst-data-note"'), "the head's pointer leads to the box below it");
  assert.match(html, /href="\/methodology\/#m2"/, "and its methodology deep link");
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
  /* DESIGN-POLISH M3 (Architecture H, H-3; T3.10): the terminus now states
     what is TRUE of the rows — QoQ compares every position with a security
     identifier (new and exited included) and counts the keyless ones; the old
     "top-25 slices" sentence was false (changes are not drawn from the top-N). */
  assert.match(
    html,
    /Changes compare every position with a security identifier, new and exited included; holdings without one are counted, not compared\./,
    "…stating what is true of the rows",
  );
  assert.doesNotMatch(html, /top-25 slices|keyable|differenced/, "control: the false sentence and its pipeline words are gone");
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
