/* Entry-point tests for `initHoldersPeriods`.

   These exist because code review (cycle 2, F2) noticed the obvious gap: the
   wrong-period defect — the first header click serving one quarter's rows under
   another quarter's label — was FIXED with no regression test. The fix binds to
   the SSR-active chip instead of the first key of the payload object, and that
   distinction is exactly what the first test below pins.

   Selectors are matched STRICTLY. A permissive `includes()` fake would let a
   malformed production selector still resolve, so a broken binding could pass. */

import { test } from "node:test";
import assert from "node:assert/strict";

import { initHoldersPeriods } from "../src/scripts/entity-client.ts";
import type { TopHolderRow } from "../src/lib/inst.ts";

function holder(over: Partial<TopHolderRow> = {}): TopHolderRow {
  return {
    issuer_key: "entity:cik:0000320193",
    period_of_report: "2026-03-31",
    rank: 1,
    cik: "0001067983",
    filer_name: "BERKSHIRE HATHAWAY INC",
    issuer_name: "APPLE INC",
    issuer_key_source: "entity",
    value_usd: 2000,
    security_count: 1,
    flags: [],
    ...over,
  };
}

/** Payload whose FIRST key is deliberately not the active period. */
const PERIODS: Record<string, TopHolderRow[]> = {
  "2026-03-31": [holder({ filer_name: "NEWER QUARTER FUND", cik: "0000111" })],
  "2025-12-31": [holder({ filer_name: "OLDER QUARTER FUND", cik: "0000222" })],
};

function el(extra: Record<string, unknown> = {}) {
  const attrs = new Map<string, string>();
  const listeners: Record<string, ((ev: unknown) => void)[]> = {};
  return {
    innerHTML: "SSR",
    textContent: "" as string | null,
    attrs,
    ...extra,
    getAttribute: (n: string) => attrs.get(n) ?? null,
    setAttribute: (n: string, v: string) => void attrs.set(n, v),
    classList: { toggle: () => {} },
    addEventListener: (t: string, l: (ev: unknown) => void) => void ((listeners[t] ??= []).push(l)),
    fire: (t: string, ev: unknown) => (listeners[t] ?? []).forEach((l) => l(ev)),
  };
}

function chip(period: string, active: boolean) {
  const c = el();
  (c as unknown as { dataset: Record<string, string> }).dataset = { period };
  c.setAttribute("aria-pressed", String(active));
  return c;
}

/** Mount a document just rich enough for the island, with strict selectors. */
function mount(activePeriod: string | null) {
  const body = el();
  const status = el();
  const mkThs = () =>
    (["value", "filer"] as const).map((k) => {
      const th = el();
      (th as unknown as { dataset: Record<string, string> }).dataset = { sort: k };
      return th;
    });
  /* Production replaces the WHOLE table on a period swap (`root.innerHTML = …`),
     so the headers bound before a swap become detached nodes. Code review (F2,
     final round) noted the earlier harness returned the same objects forever,
     so a binding that cached detached headers would still pass. This models the
     replacement: assigning innerHTML mints a fresh generation, and only the
     current generation is discoverable. */
  let gen = {
    ths: mkThs(),
    body,
    status,
  };
  const mkTable = () => ({
    querySelectorAll: (sel: string) => (sel === "th[data-sort]" ? gen.ths : []),
    querySelector: (sel: string) => (sel === "[data-holders-body]" ? gen.body : null),
  });
  const root = {
    _html: "SSR",
    get innerHTML() {
      return this._html;
    },
    set innerHTML(v: string) {
      this._html = v;
      gen = { ths: mkThs(), body: el(), status: el() }; // fresh nodes, as the DOM would
    },
    querySelector: (sel: string) =>
      sel === "[data-holders-table]" ? mkTable() : sel === "[data-holders-status]" ? gen.status : null,
  };
  const chips = [chip("2026-03-31", activePeriod === "2026-03-31"), chip("2025-12-31", activePeriod === "2025-12-31")];
  const chipsEl = el({
    querySelector: (s: string) =>
      s === '[data-period][aria-pressed="true"]'
        ? (chips.find((c) => c.getAttribute("aria-pressed") === "true") ?? null)
        : s === "[data-period].chip-active"
          ? null
          : null,
    querySelectorAll: (s: string) => (s === "[data-period]" ? chips : []),
  });
  const data = el({ textContent: JSON.stringify({ latestFiled: "2026-05-15", topn: 25, periods: PERIODS }) });
  (globalThis as unknown as { document: unknown }).document = {
    getElementById: (id: string) => (id === "holders-period-data" ? data : null),
    querySelector: (s: string) =>
      s === "[data-holders-root]" ? root : s === "[data-period-chips]" ? chipsEl : null,
  };
  return { root, chips, chipsEl, current: () => gen };
}

test("REGRESSION: binds to the SSR-ACTIVE period, not the first key of the payload", () => {
  // The active chip is the SECOND key. The pre-fix code took Object.keys()[0]
  // and would render the NEWER quarter's rows while the control said older.
  const m = mount("2025-12-31");
  initHoldersPeriods();
  m.current().ths[0].fire("click", {}); // sort by value -> forces a re-render
  assert.ok(
    m.current().body.innerHTML.includes("OLDER QUARTER FUND"),
    "rows must come from the period the page actually rendered",
  );
  assert.ok(
    !m.current().body.innerHTML.includes("NEWER QUARTER FUND"),
    "serving another quarter's rows under this quarter's label is the defect this pins",
  );
});

test("REGRESSION: refuses to bind at all when no active period can be identified", () => {
  const m = mount(null);
  initHoldersPeriods();
  m.current().ths[0].fire("click", {});
  assert.equal(m.current().body.innerHTML, "SSR", "guessing a period is worse than doing nothing");
});

test("sorting is REBOUND after a period swap, against the new period's rows", () => {
  const m = mount("2025-12-31");
  initHoldersPeriods();
  const stale = m.current().ths[0]; // will be detached by the swap
  m.chipsEl.fire("click", { target: { closest: (s: string) => (s === "[data-period]" ? m.chips[0] : null) } });
  const fresh = m.current();
  assert.notEqual(fresh.ths[0], stale, "the swap really replaced the header nodes");

  // The DETACHED header must be inert — a binding that cached it would sort here.
  stale.fire("click", {});
  assert.equal(fresh.body.innerHTML, "SSR", "a stale header must not drive the live table");

  // The REPLACEMENT header must be bound.
  fresh.ths[0].fire("click", {});
  assert.ok(
    fresh.body.innerHTML.includes("NEWER QUARTER FUND"),
    "after a swap the sort must act on the newly shown quarter, via the new nodes",
  );
});

test("a malformed embedded payload leaves the SSR table alone", () => {
  const m = mount("2025-12-31");
  (document as unknown as { getElementById: (i: string) => { textContent: string } }).getElementById(
    "holders-period-data",
  ).textContent = "{not json";
  initHoldersPeriods();
  m.current().ths[0].fire("click", {});
  assert.equal(m.current().body.innerHTML, "SSR");
});

test("a syntactically VALID but wrong-shaped payload must not crash the island", () => {
  // Code review (cycle 5, F3): the malformed-payload test only covered invalid
  // JSON. `{}` parses fine and then blows up on `data.periods`, which is a real
  // crash path — an embed that loses a key takes the whole island down instead
  // of degrading to the SSR table.
  const m = mount("2025-12-31");
  (document as unknown as { getElementById: (i: string) => { textContent: string } }).getElementById(
    "holders-period-data",
  ).textContent = "{}";
  assert.doesNotThrow(() => initHoldersPeriods(), "a shape mismatch must degrade, not throw");
  assert.equal(m.current().body.innerHTML, "SSR", "and the server-rendered table survives");
});

test("a payload whose periods is the wrong TYPE also degrades", () => {
  const m = mount("2025-12-31");
  (document as unknown as { getElementById: (i: string) => { textContent: string } }).getElementById(
    "holders-period-data",
  ).textContent = JSON.stringify({ latestFiled: null, topn: 25, periods: "not-an-object" });
  assert.doesNotThrow(() => initHoldersPeriods());
  assert.equal(m.current().body.innerHTML, "SSR");
});

test("a period whose value is not an array also degrades, rather than crashing on sort", () => {
  // Code review (cycle 5, F3, second pass): validating only the `periods`
  // container let `{periods: {"2026-03-31": "nope"}}` through, and it crashed
  // once sorting began.
  const m = mount("2025-12-31");
  (document as unknown as { getElementById: (i: string) => { textContent: string } }).getElementById(
    "holders-period-data",
  ).textContent = JSON.stringify({ latestFiled: null, topn: 25, periods: { "2025-12-31": "nope" } });
  assert.doesNotThrow(() => initHoldersPeriods());
  assert.equal(m.current().body.innerHTML, "SSR");
});

test("a malformed ROW inside a valid period array also degrades", () => {
  // Third pass at this validation (code review cycle 5, F3): container checked,
  // then value-is-array checked, and a junk row still reached the renderer.
  const m = mount("2025-12-31");
  (document as unknown as { getElementById: (i: string) => { textContent: string } }).getElementById(
    "holders-period-data",
  ).textContent = JSON.stringify({
    latestFiled: null,
    topn: 25,
    periods: { "2025-12-31": [{ filer_name: "OK", cik: "1", value_usd: "not-a-number", rank: 1 }] },
  });
  assert.doesNotThrow(() => initHoldersPeriods());
  assert.equal(m.current().body.innerHTML, "SSR");
});

test("a NULL row inside a valid period array degrades — the reviewer's exact repro", () => {
  // Cycle 5 round 3, F3: `periods: {"2025-12-31": [null]}` passed the container
  // and array checks and then threw `Cannot read properties of null (reading
  // 'flags')` at interaction time, because the renderer maps `.flags` over
  // every row before sorting.
  const m = mount("2025-12-31");
  (document as unknown as { getElementById: (i: string) => { textContent: string } }).getElementById(
    "holders-period-data",
  ).textContent = JSON.stringify({ latestFiled: null, topn: 25, periods: { "2025-12-31": [null] } });
  assert.doesNotThrow(() => initHoldersPeriods());
  m.current().ths[0].fire("click", {});
  assert.equal(m.current().body.innerHTML, "SSR", "a null row must never reach the renderer");
});

test("a row MISSING a renderer-read field (flags) degrades", () => {
  // `flags` is read by the renderer (flagTags / universalFlags) but was not in
  // the validated field set, so a row without it crashed on `.map` at render.
  const m = mount("2025-12-31");
  const row = { ...holder() } as Record<string, unknown>;
  delete row.flags;
  (document as unknown as { getElementById: (i: string) => { textContent: string } }).getElementById(
    "holders-period-data",
  ).textContent = JSON.stringify({ latestFiled: null, topn: 25, periods: { "2025-12-31": [row] } });
  assert.doesNotThrow(() => initHoldersPeriods());
  m.current().ths[0].fire("click", {});
  assert.equal(m.current().body.innerHTML, "SSR");
});

test("a row with a wrong-typed security_count degrades", () => {
  const m = mount("2025-12-31");
  (document as unknown as { getElementById: (i: string) => { textContent: string } }).getElementById(
    "holders-period-data",
  ).textContent = JSON.stringify({
    latestFiled: null,
    topn: 25,
    periods: { "2025-12-31": [holder({ security_count: "three" as unknown as number })] },
  });
  assert.doesNotThrow(() => initHoldersPeriods());
  m.current().ths[0].fire("click", {});
  assert.equal(m.current().body.innerHTML, "SSR");
});

test("a row whose flags array holds a non-string degrades", () => {
  const m = mount("2025-12-31");
  (document as unknown as { getElementById: (i: string) => { textContent: string } }).getElementById(
    "holders-period-data",
  ).textContent = JSON.stringify({
    latestFiled: null,
    topn: 25,
    periods: { "2025-12-31": [holder({ flags: [42] as unknown as string[] })] },
  });
  assert.doesNotThrow(() => initHoldersPeriods());
  m.current().ths[0].fire("click", {});
  assert.equal(m.current().body.innerHTML, "SSR");
});

test("wrong-typed USED top-level scalars (topn, latestFiled) degrade", () => {
  // The renderer formats `topn` with fmtInt and interpolates `latestFiled`;
  // both are part of the validated contract, not just the rows.
  for (const top of [
    { latestFiled: null, topn: "25", periods: PERIODS },
    { latestFiled: 20260515, topn: 25, periods: PERIODS },
  ]) {
    const m = mount("2025-12-31");
    (document as unknown as { getElementById: (i: string) => { textContent: string } }).getElementById(
      "holders-period-data",
    ).textContent = JSON.stringify(top);
    assert.doesNotThrow(() => initHoldersPeriods());
    m.current().ths[0].fire("click", {});
    assert.equal(m.current().body.innerHTML, "SSR");
  }
});

test("POSITIVE CONTROL: a fully valid payload still binds after the validators", () => {
  // The guard must fail only on genuinely malformed embeds — a validation that
  // rejects the real shape would silently disable sorting everywhere.
  const m = mount("2025-12-31");
  initHoldersPeriods();
  m.current().ths[0].fire("click", {});
  assert.ok(m.current().body.innerHTML.includes("OLDER QUARTER FUND"), "valid payloads must bind");
});
