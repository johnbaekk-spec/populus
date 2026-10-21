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
import {
  sortInstIndexRows,
  filterInstIndexRows,
  planDirectoryShards,
  INST_INDEX_HEADS,
  type InstIndexRow,
} from "../src/lib/inst-index.ts";
import { fillShardsByBytes } from "../src/lib/shards.ts";

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
  // F20: derived from INST_INDEX_HEADS, not a literal — the table grew to
  // eight columns and a hard-coded 6 stopped spanning it.
  assert.ok(html.includes(`colspan="${INST_INDEX_HEADS.length}"`));
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
  assert.equal(note, "4 of 4 managers · sorted by value desc · filtered on this device");
  const filtered = instIndexBodyHtml(rows, "bravo", "value", "desc");
  assert.equal(filtered.note, "1 of 4 managers · sorted by value desc · filtered on this device");
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

/* Launch M7b (R32, LD28): the rows are no longer an inline island. The page
   inlines the shard LIST (`#inst-index-shards`) and the island fetches the
   family on the first search, chip or sort. The mount builds that list and a
   fetch double from the SAME planner the build uses, and counts each fetch, so
   these tests also prove WHEN the rows load. */
const flush = async (): Promise<void> => {
  for (let i = 0; i < 12; i++) await Promise.resolve();
};

function mountIndex(payload: InstIndexRow[], opts: { pressedTypes?: string[]; failFetch?: boolean; list?: string } = {}) {
  const family = planDirectoryShards(payload, fillShardsByBytes);
  const els: Record<string, ReturnType<typeof fakeEl>> = {
    "inst-index-shards": fakeEl({ textContent: opts.list ?? family.listJson }),
    "inst-managers-tbody": fakeEl(),
    "inst-index-q": fakeEl({ value: "" }),
    "inst-index-count": fakeEl(),
    "inst-index-status": fakeEl(),
    "inst-index-load": fakeEl({ hidden: true }),
  };
  const fetched: string[] = [];
  const g = globalThis as unknown as { fetch: unknown };
  g.fetch = (href: string) => {
    fetched.push(href);
    if (opts.failFetch) return Promise.resolve({ ok: false, status: 503, json: () => Promise.reject(new Error("503")) });
    const i = Number(/\/(\d+)\.v1\.json$/.exec(href)?.[1] ?? -1);
    const shard = family.shards[i];
    return shard
      ? Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(JSON.parse(shard.body)) })
      : Promise.resolve({ ok: false, status: 404, json: () => Promise.reject(new Error("404")) });
  };
  const ths = (["name", "value", "positions", "hhi"] as const).map((k) => {
    const th = fakeEl();
    (th as unknown as { dataset: Record<string, string> }).dataset = { instSort: k };
    // the server's markup: `thHtml` renders the value column descending
    th.setAttribute("aria-sort", k === "value" ? "descending" : "none");
    return th;
  });
  // STRICT on purpose (code review F2): an `includes()` match would let a
  // malformed production selector still find the headers, so a broken selector
  // would pass this test. Only the exact selector the island is specified to
  // use resolves; anything else returns nothing and the assertions fail.
  const SELECTOR = "[data-inst-sort]";
  /* the server's pressed manager-type chips (R14), when a test supplies them */
  const PRESSED = '#mgr-chips [data-mgr-type][aria-pressed="true"]';
  const pressed = (opts.pressedTypes ?? []).map((t) => {
    const chip = fakeEl();
    (chip as unknown as { dataset: Record<string, string> }).dataset = { mgrType: t };
    chip.setAttribute("aria-pressed", "true");
    return chip;
  });
  const asked: string[] = [];
  (globalThis as unknown as { document: unknown }).document = {
    getElementById: (id: string) => els[id] ?? null,
    // The island now also looks up its compact-disclosure control. Returning
    // null models the honest case where the table is under the compact size
    // and therefore renders no control at all (R7's omission rule).
    querySelector: (sel: string) => {
      asked.push(sel);
      return null;
    },
    querySelectorAll: (sel: string) => {
      asked.push(sel);
      return sel === SELECTOR ? ths : sel === PRESSED ? pressed : [];
    },
  };
  return { els, ths, asked, pressed, fetched, family };
}

test("ENTRY POINT: initInstIndex binds headers, fetches nothing and repaints nothing on load", async () => {
  const { els, ths, fetched } = mountIndex(rows);
  initInstIndex();
  await flush();
  assert.equal(els["inst-managers-tbody"].innerHTML, "SSR", "the SSR body is trusted on load");
  assert.equal(ths[1].getAttribute("aria-sort"), "descending", "the server's sort stays on the headers");
  assert.equal(ths[0].getAttribute("aria-sort"), "none");
  assert.deepEqual(fetched, [], "no shard is fetched until the reader asks for something the server did not render");
});

test("ENTRY POINT: a header click re-renders the body and moves aria-sort", async () => {
  const { els, ths, fetched, family } = mountIndex(rows);
  initInstIndex();
  ths[0].fire("click"); // Filer / name
  assert.equal(els["inst-managers-tbody"].innerHTML, "SSR", "nothing changes before the rows arrive");
  assert.equal(ths[0].getAttribute("aria-sort"), "none", "no header claims an order the rows do not show yet");
  await flush();
  assert.deepEqual(fetched, family.shards.map((_, i) => `/institutional/data/directory/${i}.v1.json`), "every shard, once");
  assert.notEqual(els["inst-managers-tbody"].innerHTML, "SSR", "body was re-rendered");
  assert.ok(els["inst-managers-tbody"].innerHTML.includes("/institutional/filers/"), "real rows rendered");
  assert.equal(ths[0].getAttribute("aria-sort"), "ascending");
  assert.equal(ths[1].getAttribute("aria-sort"), "none", "only one column stays marked");
  assert.ok(String(els["inst-index-status"].textContent).includes("sorted by name asc"));
  assert.ok(String(els["inst-index-count"].textContent).includes("of 4 managers"));
});

test("ENTRY POINT: clicking the active column toggles direction", async () => {
  const { ths, fetched } = mountIndex(rows);
  initInstIndex();
  ths[1].fire("click"); // value is already active -> toggles to asc
  await flush();
  assert.equal(ths[1].getAttribute("aria-sort"), "ascending");
  ths[1].fire("click");
  assert.equal(ths[1].getAttribute("aria-sort"), "descending");
  assert.equal(fetched.length, 1, "the rows are fetched once; later sorts are local");
});

test("ENTRY POINT: typing in search re-renders at the current sort", async () => {
  const { els, ths } = mountIndex(rows);
  initInstIndex();
  ths[0].fire("click");
  await flush();
  els["inst-index-q"].value = "bravo";
  els["inst-index-q"].fire("input");
  assert.ok(String(els["inst-index-count"].textContent).includes("1 of 4 managers"));
  assert.ok(String(els["inst-index-count"].textContent).includes("sorted by name asc"), "sort survives a search");
});

test("ENTRY POINT: a malformed shard list leaves the SSR table alone and fetches nothing", async () => {
  const { els, ths, fetched } = mountIndex(rows, { list: "{not json" });
  initInstIndex();
  ths[0].fire("click");
  await flush();
  assert.equal(els["inst-managers-tbody"].innerHTML, "SSR", "the island is a convenience, never load-bearing");
  assert.deepEqual(fetched, []);
});

test("launch M7b (R32): a failed shard fetch is stated VISIBLY; the server rows, the chips and the headers stay as they were; the next press retries", async () => {
  const typing = { cik: "0000002", display_name: "Bravo Partners", person: null, manager_type: "pension", notable: false };
  const typed = [rows[0]!, { ...rows[1]!, typing } as InstIndexRow];
  const { els, ths, pressed, fetched } = mountIndex(typed, { failFetch: true, pressedTypes: ["hedge_fund"] });
  initInstIndex();
  ths[0].fire("click");
  await flush();
  assert.equal(els["inst-managers-tbody"].innerHTML, "SSR", "the server's rows stay");
  assert.equal(ths[0].getAttribute("aria-sort"), "none", "no header claims the order it could not draw");
  assert.equal(ths[1].getAttribute("aria-sort"), "descending");
  assert.equal(pressed[0]!.getAttribute("aria-pressed"), "true", "the chips are untouched");
  const load = els["inst-index-load"] as unknown as { hidden: boolean; textContent: string };
  assert.equal(load.hidden, false, "the failure line is visible");
  assert.match(String(load.textContent), /Couldn't load the full filer directory/);
  assert.match(String(load.textContent), /unchanged/);
  const before = fetched.length;
  ths[0].fire("click");
  await flush();
  assert.ok(fetched.length > before, "a later press retries");
});

test("launch M7b (R32): a shard whose envelope disagrees with the list fails closed — never a partial directory", async () => {
  const many = Array.from({ length: 3 }, (_, i) => row({ cik: String(i + 1).padStart(7, "0"), value: 100 + i }));
  const family = planDirectoryShards(many, fillShardsByBytes);
  const list = JSON.parse(family.listJson) as { v: number; total: number; shards: string[] };
  // the list claims one more filer than the family holds
  const { els, ths } = mountIndex(many, { list: JSON.stringify({ ...list, total: list.total + 1 }) });
  initInstIndex();
  ths[0].fire("click");
  await flush();
  assert.equal(els["inst-managers-tbody"].innerHTML, "SSR");
  assert.match(String((els["inst-index-load"] as unknown as { textContent: string }).textContent), /Couldn't load/);
});

test("the island queries EXACTLY the specified sort selector, not a near-miss", () => {
  const { asked } = mountIndex(rows);
  initInstIndex();
  assert.ok(asked.length > 0, "the island queried for headers at all");
  // The island owns three controls now — sortable headers, the compact
  // disclosure, and the manager chips — so the guard pins the EXACT selector
  // set rather than a single one. A near-miss in any of them still fails.
  const ALLOWED = new Set([
    "[data-inst-sort]",
    '.compact-disclosure[data-compact-for="inst-managers-tbody"]',
    "#mgr-chips [data-mgr-type],#mgr-chips [data-mgr-notable]",
    // R14: the island starts from the server's pressed default (Hedge funds),
    // for every visitor — it no longer clears it for a device with a watchlist
    // (signals-v3 M1), so it no longer asks for every chip to un-press.
    '#mgr-chips [data-mgr-type][aria-pressed="true"]',
  ]);
  assert.ok(
    asked.includes("[data-inst-sort]"),
    "the sortable-header selector must still be exactly this",
  );
  assert.ok(
    asked.every((s) => ALLOWED.has(s)),
    `unexpected selector(s): ${asked.filter((s) => !ALLOWED.has(s)).join(", ")}`,
  );
});

test("R14 (signals-v3 M1): Hedge funds is the default for EVERY visitor — legacy watch keys on the device change nothing, and the island reads no storage", async () => {
  const typing = (cik: string, display_name: string, manager_type: string) => ({ cik, display_name, person: null, manager_type, notable: false });
  const typed = [
    row({ cik: "0000001", name: "ALPHA CAPITAL", value: 100, typing: typing("0000001", "Alpha Capital", "hedge_fund") } as never),
    row({ cik: "0000002", name: "bravo partners", value: 300, typing: typing("0000002", "Bravo Partners", "pension") } as never),
  ];
  const reads: string[] = [];
  const g = globalThis as unknown as { localStorage?: unknown };
  const prior = g.localStorage;
  g.localStorage = {
    getItem: (k: string) => {
      reads.push(k);
      return k === "populus:watch:v2" ? JSON.stringify({ v: 2, members: ["A000001"], tickers: ["WMB"] }) : null;
    },
    setItem: () => undefined,
  };
  try {
    const { els, pressed } = mountIndex(typed, { pressedTypes: ["hedge_fund"] });
    initInstIndex();
    assert.equal(pressed[0]!.getAttribute("aria-pressed"), "true", "the server's default chip stays pressed");
    assert.deepEqual(reads, [], "the island reads nothing from the device");
    els["inst-index-q"].fire("input"); // a repaint at the default state
    await flush();
    const body = String(els["inst-managers-tbody"].innerHTML);
    assert.ok(body.includes("Alpha Capital"), "the hedge fund is listed");
    assert.ok(!body.includes("Bravo Partners"), "the pension filer is filtered out by the default chip");
    assert.match(String(els["inst-index-count"].textContent), /1 of 2 managers · .*1 filter active/, "the count states the default filter");
  } finally {
    g.localStorage = prior;
  }
});
