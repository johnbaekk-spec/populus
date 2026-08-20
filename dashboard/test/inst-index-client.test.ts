/* Characterization tests for the institutional index island.

   These exist for one reason: external code review (F3) held that refactoring
   that island onto the shared sort helper was unproven, because nothing pinned
   its behaviour. This file is that pin. It captures the island's ordering,
   bucketing, tie-break and status text INDEPENDENTLY of the helper, by calling
   the extracted `instIndexBodyHtml` directly.

   If the shared plumbing ever starts influencing ordering — the exact failure
   plan review warned about — these fail. */

import { test } from "node:test";
import assert from "node:assert/strict";

import { initInstIndex, instIndexBodyHtml, instDefaultDir } from "../src/scripts/inst-index-client.ts";
import { sortInstIndexRows, filterInstIndexRows, type InstIndexRow } from "../src/lib/inst-index.ts";

function row(over: Partial<InstIndexRow> = {}): InstIndexRow {
  return {
    cik: "0000001",
    name: "ALPHA CAPITAL",
    period: "2026-03-31",
    value: 100,
    positions: 5,
    nullValuePositions: 0,
    hhi: 1000,
    hhiNote: "",
    tier: "top",
    ...over,
  } as InstIndexRow;
}

const rows: InstIndexRow[] = [
  row({ cik: "0000001", name: "ALPHA CAPITAL", value: 100, positions: 5, hhi: 1000 }),
  row({ cik: "0000002", name: "bravo partners", value: 300, positions: 2, hhi: 3000 }),
  row({ cik: "0000003", name: "Charlie LLC", value: 200, positions: 9, hhi: 2000 }),
  // hhiNote is NOT nullable: when hhi is null it must say why. Getting this
  // wrong in the fixture is itself instructive — the renderer escapes it.
  row({
    cik: "0000004",
    name: "DELTA FUND",
    value: null,
    positions: null,
    hhi: null,
    hhiNote: "no concentration row for this period",
  }),
];

test("ordering is unchanged by the refactor: it still comes from sortInstIndexRows", () => {
  // The island must not reorder anything itself. Comparing against the domain
  // function directly is what proves the shared helper contributed no ordering.
  for (const key of ["value", "hhi", "name", "positions"] as const) {
    for (const dir of ["asc", "desc"] as const) {
      const expected = sortInstIndexRows(filterInstIndexRows(rows, ""), key, dir);
      const { html } = instIndexBodyHtml(rows, "", key, dir);
      const order = [...html.matchAll(/\/institutional\/filers\/(\d+)\//g)].map((m) => m[1]);
      const want = [...expected.ranked, ...expected.unranked].map((r) => String(Number(r.cik)));
      assert.deepEqual(order, want, `${key} ${dir}`);
    }
  }
});

test("the no-sentinel bucket and its exact wording survive", () => {
  const { html } = instIndexBodyHtml(rows, "", "value", "asc");
  assert.ok(html.includes("unranked-sep"));
  assert.ok(html.includes("never treated as zero"));
  assert.ok(html.includes('colspan="6"'));
  // The null-valued filer must NOT lead an ascending value sort — that is the
  // ordering where a zero substitute would surface first.
  const first = html.match(/\/institutional\/filers\/(\d+)\//)?.[1];
  assert.notEqual(first, "4", "the unranked filer must not sort as zero");
});

test("no bucket row is emitted when every row is rankable", () => {
  const { html } = instIndexBodyHtml(rows.slice(0, 3), "", "value", "desc");
  assert.ok(!html.includes("unranked-sep"));
});

test("the status note keeps its exact composition", () => {
  const { note } = instIndexBodyHtml(rows, "", "value", "desc");
  assert.equal(note, "4 of 4 filers · sorted by value desc · filtered on this device");
  const filtered = instIndexBodyHtml(rows, "bravo", "value", "desc");
  assert.equal(filtered.note, "1 of 4 filers · sorted by value desc · filtered on this device");
});

test("search still delegates to filterInstIndexRows, case-insensitively", () => {
  const { html } = instIndexBodyHtml(rows, "BRAVO", "value", "desc");
  const order = [...html.matchAll(/\/institutional\/filers\/(\d+)\//g)].map((m) => m[1]);
  assert.deepEqual(order, ["2"]);
});

test("default direction per column is unchanged: names ascend, numbers descend", () => {
  assert.equal(instDefaultDir("name"), "asc");
  assert.equal(instDefaultDir("value"), "desc");
  assert.equal(instDefaultDir("hhi"), "desc");
  assert.equal(instDefaultDir("positions"), "desc");
});

/* ── F2: exercise the ACTUAL DOM entry point ──────────────────────────────────
   The tests above call `instIndexBodyHtml`, which is extracted and pure. External
   code review (F2) correctly objected that this proves the extracted function
   works, not that `initInstIndex` — the thing the refactor changed — still
   behaves. These tests invoke the entry point itself against a minimal document,
   so a regression in the wiring (headers not bound, aria not synced, body not
   swapped, search not re-rendering) fails here. */

function fakeEl(props: Record<string, unknown> = {}) {
  const attrs = new Map<string, string>();
  const listeners: Record<string, (() => void)[]> = {};
  return {
    innerHTML: "SSR",
    textContent: "" as string | null,
    value: "",
    ...props,
    attrs,
    getAttribute: (n: string) => attrs.get(n) ?? null,
    setAttribute: (n: string, v: string) => void attrs.set(n, v),
    addEventListener: (t: string, l: () => void) => void ((listeners[t] ??= []).push(l)),
    fire: (t: string) => (listeners[t] ?? []).forEach((l) => l()),
  };
}

function mountIndex(payload: InstIndexRow[]) {
  const els: Record<string, ReturnType<typeof fakeEl>> = {
    "inst-index-data": fakeEl({ textContent: JSON.stringify(payload) }),
    "inst-index-body": fakeEl(),
    "inst-index-q": fakeEl({ value: "" }),
    "inst-index-count": fakeEl(),
    "inst-index-status": fakeEl(),
  };
  const ths = (["name", "value", "positions", "hhi"] as const).map((k) => {
    const th = fakeEl();
    (th as unknown as { dataset: Record<string, string> }).dataset = { instSort: k };
    return th;
  });
  // STRICT on purpose (code review F2): an `includes()` match would let a
  // malformed production selector still find the headers, so a broken selector
  // would pass this test. Only the exact selector the island is specified to
  // use resolves; anything else returns nothing and the assertions fail.
  const SELECTOR = "[data-inst-sort]";
  const asked: string[] = [];
  (globalThis as unknown as { document: unknown }).document = {
    getElementById: (id: string) => els[id] ?? null,
    querySelectorAll: (sel: string) => {
      asked.push(sel);
      return sel === SELECTOR ? ths : [];
    },
  };
  return { els, ths, asked };
}

test("ENTRY POINT: initInstIndex binds headers and syncs aria without repainting", () => {
  const { els, ths } = mountIndex(rows);
  initInstIndex();
  assert.equal(els["inst-index-body"].innerHTML, "SSR", "the SSR body is trusted on load");
  assert.equal(ths[1].getAttribute("aria-sort"), "descending", "value column marked from initial state");
  assert.equal(ths[0].getAttribute("aria-sort"), "none");
});

test("ENTRY POINT: a header click re-renders the body and moves aria-sort", () => {
  const { els, ths } = mountIndex(rows);
  initInstIndex();
  ths[0].fire("click"); // Filer / name
  assert.notEqual(els["inst-index-body"].innerHTML, "SSR", "body was re-rendered");
  assert.ok(els["inst-index-body"].innerHTML.includes("/institutional/filers/"), "real rows rendered");
  assert.equal(ths[0].getAttribute("aria-sort"), "ascending");
  assert.equal(ths[1].getAttribute("aria-sort"), "none", "only one column stays marked");
  assert.ok(String(els["inst-index-status"].textContent).includes("sorted by name asc"));
  assert.ok(String(els["inst-index-count"].textContent).includes("of 4 filers"));
});

test("ENTRY POINT: clicking the active column toggles direction", () => {
  const { ths } = mountIndex(rows);
  initInstIndex();
  ths[1].fire("click"); // value is already active -> toggles to asc
  assert.equal(ths[1].getAttribute("aria-sort"), "ascending");
  ths[1].fire("click");
  assert.equal(ths[1].getAttribute("aria-sort"), "descending");
});

test("ENTRY POINT: typing in search re-renders at the current sort", () => {
  const { els, ths } = mountIndex(rows);
  initInstIndex();
  ths[0].fire("click");
  els["inst-index-q"].value = "bravo";
  els["inst-index-q"].fire("input");
  assert.ok(String(els["inst-index-count"].textContent).includes("1 of 4 filers"));
  assert.ok(String(els["inst-index-count"].textContent).includes("sorted by name asc"), "sort survives a search");
});

test("ENTRY POINT: malformed embedded JSON leaves the SSR table alone", () => {
  const { els } = mountIndex(rows);
  els["inst-index-data"].textContent = "{not json";
  initInstIndex();
  assert.equal(els["inst-index-body"].innerHTML, "SSR", "the island is a convenience, never load-bearing");
});

test("the island queries EXACTLY the specified selector, not a near-miss", () => {
  const { asked } = mountIndex(rows);
  initInstIndex();
  assert.ok(asked.length > 0, "the island queried for headers at all");
  assert.ok(
    asked.every((s) => s === "[data-inst-sort]"),
    `unexpected selector(s): ${asked.filter((s) => s !== "[data-inst-sort]").join(", ")}`,
  );
});
