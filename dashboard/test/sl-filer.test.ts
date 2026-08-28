/* RUN SURFACES-LEGIBILITY — T11, the filer page (SL-R22).

   `sl-` prefix per Constraint 9.

   R22 is mostly a set of things that must NOT happen — the §5 box is not
   relocated, the raw `position_key` cells are not touched, the truncation
   terminus and the pager survive — so most of this file asserts survival. A
   requirement whose content is "leave this alone" is exactly the kind that
   rots silently, which is why it is pinned rather than trusted. */

import { test } from "node:test";
import assert from "node:assert/strict";

import { filerBody, filerTiles } from "../src/lib/ui/index.ts";
import { noteId, esc } from "../src/lib/format.ts";
import { INSTITUTIONAL_DATA_NOTE_CLAUSES } from "../src/lib/holdings.ts";
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

test("SL-R22: the §5 box is NOT relocated into filerBody — exactly ONE id and ONE of each clause", () => {
  /* Moving it here would emit a duplicate `id="inst-data-note"` on the filer
     page, because `HoldingsTable.astro` and `entity-client.ts` each already
     render it for their route. `pages-render.test.ts` guards the header against
     a second PHRASING; this guards the page against a second INSTANCE. */
  const html = body([delta()]);
  assert.equal(
    (html.match(/id="inst-data-note"/g) ?? []).length,
    0,
    "filerBody renders no copy of the box at all — its two owners are elsewhere",
  );
  for (const clause of INSTITUTIONAL_DATA_NOTE_CLAUSES) {
    assert.equal(
      (html.match(new RegExp(escapeRe(esc(clause.text)), "g")) ?? []).length,
      0,
      `filerBody must not restate the §5 clause "${clause.id}"`,
    );
  }
  // …and it still POINTS at the canonical box, with its methodology deep link.
  assert.match(html, /href="#inst-data-note"/, "the explainer keeps its pointer");
  assert.match(html, /href="\/methodology\/#m2"/, "and its methodology deep link");
  assert.match(html, /not current holdings/, "and the one claim the header itself must carry");
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
  assert.match(
    html,
    /Changes derive from the aggregate's top-25 slices and keyable positions only/,
    "…stating exactly what it stated",
  );
  assert.match(html, /methodology\/#m2/, "with its methodology link intact");
});

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
