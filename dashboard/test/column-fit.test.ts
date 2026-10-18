/* signals-v4 M1 (R6, LD6, T1.6): the column fit.

   `fitCount` is the estimate; `bindFit` applies it and corrects it against the
   live layout, reading `contentBottom` only — never a grid cell's box. The
   binder runs here over a small layout model: a reference column whose
   content ends at `refEnd`, and a filled column holding 240px of content
   above its list, the list (rows of known heights, no chrome unless asked)
   and 60px below it (the pager and the notes). Both columns' CELLS can be
   stretched to any height; the model's `contentBottom` reads children, the
   way the page's does. The contract — visible = min(matching, base + extra),
   extra resets on a filter change, a short filter shows every matching row —
   is pinned on the real hits pager, mounted over the server's markup. */

import { test } from "node:test";
import assert from "node:assert/strict";

import { bindFit, contentBottom, fitCount, isInFlowVisible, medianRowHeight, type FitElement, type FitTarget } from "../src/scripts/column-fit.ts";
import { installDom, MiniElement } from "./lib/mini-dom.ts";

/* ---------------------------------------------------------------- the layout model */

interface Box extends FitElement {
  children: Box[];
}
function box(rect: () => { top: number; bottom: number }, children: Box[] = [], hidden = (): boolean => false): Box {
  return {
    children,
    get hidden() {
      return hidden();
    },
    getBoundingClientRect: () => ({ ...rect(), left: 0, right: 600 }),
  };
}

/** A two-column band: the reference ends at `refEnd()`; the filled column is
    240px above + its list + 60px below, starting at `top`. `rows` are the
    row heights; `n` of them are visible. `cellHeight` stretches both cells. */
function band(opts: { rows: number[]; refEnd: () => number; top?: number; chrome?: number; cellHeight?: () => number | null; extra?: () => number; floor?: () => number }) {
  const top = opts.top ?? 0;
  const chrome = opts.chrome ?? 0;
  let visible = 10;
  let applied: number[] = [];
  const rowTop = (i: number): number => top + 240 + chrome + opts.rows.slice(0, i).reduce((s, h, k) => (k < visible ? s + h : s), 0);
  const rowBoxes = opts.rows.map((h, i) => box(() => ({ top: rowTop(i), bottom: rowTop(i) + (i < visible ? h : 0) }), [], () => i >= visible));
  const listHeight = (): number => chrome + opts.rows.slice(0, visible).reduce((s, h) => s + h, 0);
  const list = box(() => ({ top: top + 240, bottom: top + 240 + listHeight() }), rowBoxes);
  const above = box(() => ({ top, bottom: top + 240 }));
  const below = box(() => ({ top: top + 240 + listHeight(), bottom: top + 240 + listHeight() + 60 }));
  const stretched = (content: number): number => {
    const h = opts.cellHeight?.();
    return h == null ? content : Math.max(content, top + h);
  };
  const col = box(() => ({ top, bottom: stretched(top + 300 + listHeight()) }), [above, list, below]);
  const refContent = box(() => ({ top, bottom: opts.refEnd() }));
  const ref = box(() => ({ top, bottom: stretched(opts.refEnd()) }), [refContent]);
  const extra = opts.extra ?? (() => 0);
  const target: FitTarget = {
    list: () => list,
    rows: () => rowBoxes,
    matching: () => opts.rows.length,
    visible: () => visible,
    extra,
    apply: (n: number) => {
      applied.push(n);
      visible = Math.min(opts.rows.length, n + extra());
    },
    ...(opts.floor ? { floor: opts.floor } : {}),
  };
  return {
    ref,
    col,
    target,
    visible: () => visible,
    colEnd: () => contentBottom(col),
    applied: () => applied,
    reset: () => {
      applied = [];
    },
  };
}

const uniform = (n: number, h = 20): number[] => Array.from({ length: n }, () => h);

/* ---------------------------------------------------------------- fitCount */

test("LD6 fitCount: the rows that fill what the column has left — the content above AND below the list subtracted, the list's chrome subtracted, never fewer than min", () => {
  // the plan's fixture: 240 above, 60 below, 10 rows of 20px (200, no chrome), reference ends at 900
  const base = { refEnd: 900, colTop: 0, colEnd: 500, listHeight: 200, rows: 10, rowHeight: 20, min: 10 };
  assert.equal(fitCount(base), 30, "other = 300; (900 − 300) / 20");
  // the content below the list counts: drop it and the fit grows by 60 / 20
  assert.equal(fitCount({ ...base, colEnd: 440 }), 33);
  // the list's own chrome (a 30px head) is subtracted
  assert.equal(fitCount({ ...base, colEnd: 530, listHeight: 230 }), 28, "extra = 230 − 10 × 20 = 30; (900 − 270 − 30) / 20 = 30 … less the head: 28.5 → 28");
  // the floor
  assert.equal(fitCount({ ...base, refEnd: 400 }), 10, "a reference shorter than 10 rows' worth: min");
  assert.equal(fitCount({ ...base, rowHeight: 0 }), 10, "no measurable row: min");
  // a column that starts lower (its own offset) is measured from its top
  assert.equal(fitCount({ ...base, refEnd: 1000, colTop: 100, colEnd: 600 }), 30);
});

test("LD6 medianRowHeight: the median of the first 8 VISIBLE rows; hidden rows never count", () => {
  const r = (h: number, hidden = false): Box => box(() => ({ top: 0, bottom: h }), [], () => hidden);
  assert.equal(medianRowHeight([r(20), r(20), r(40), r(20), r(20), r(20), r(20), r(20), r(90)]), 20, "the 9th row is not read");
  assert.equal(medianRowHeight([r(10), r(30)]), 20, "an even count averages the two middles");
  assert.equal(medianRowHeight([r(20), r(99, true), r(22), r(24)]), 22, "a hidden row is skipped");
  assert.equal(medianRowHeight([]), 0);
});

test("LD6 contentBottom: the largest bottom among VISIBLE in-flow children — never the element's own (stretched) box", () => {
  const cell = box(() => ({ top: 0, bottom: 1200 }), [box(() => ({ top: 0, bottom: 300 })), box(() => ({ top: 300, bottom: 640 })), box(() => ({ top: 640, bottom: 9999 }), [], () => true)]);
  assert.equal(contentBottom(cell), 640, "the hidden child and the cell's own 1,200px box are not read");
  assert.equal(contentBottom(box(() => ({ top: 50, bottom: 900 }))), 50, "no visible child: the top");
  assert.equal(isInFlowVisible({ ...box(() => ({ top: 0, bottom: 1 })), checkVisibility: () => false }), false, "checkVisibility() false is not in flow");
});

/* ---------------------------------------------------------------- bindFit, exact correction */

test("LD6 bindFit (T1.6 fixture): fits n = 30 and the column's CONTENT then ends at the reference — 240 + 600 + 60 = 900px", async () => {
  const b = band({ rows: uniform(40), refEnd: () => 900 });
  await bindFit(b.ref, b.col, b.target, { min: 10, observe: false }).refit();
  assert.equal(b.visible(), 30);
  assert.equal(b.colEnd(), 900, "the endpoint is the column's content bottom — the pager and notes below the list included");
  // the next row would pass the reference
  assert.ok(b.colEnd() + 20 > 900 + 1);
});

test("LD6 bindFit: uneven rows — the estimate overshoots and the correction lands on n = 28, the column ending at 900px; the 29th row (ending at 920) stays hidden", async () => {
  const rows = uniform(40);
  rows[11] = 40; // row 12
  rows[19] = 40; // row 20
  const b = band({ rows, refEnd: () => 900 });
  await bindFit(b.ref, b.col, b.target, { min: 10, observe: false }).refit();
  assert.equal(b.applied()[0], 30, "the estimate from the median (20px)");
  assert.equal(b.visible(), 28);
  assert.equal(b.colEnd(), 900);
  assert.equal(b.applied().at(-1), 28, "the 29th row was revealed, measured past the reference, and hidden again");
  assert.ok(b.applied().includes(29));
});

test("LD6 bindFit: a reference shorter than 10 rows' worth keeps the minimum (no alignment claimed)", async () => {
  const b = band({ rows: uniform(40), refEnd: () => 420 });
  await bindFit(b.ref, b.col, b.target, { min: 10, observe: false }).refit();
  assert.equal(b.visible(), 10);
  assert.ok(b.colEnd() > 421, "the column ends past the reference: the third stated no-alignment case");
});

test("LD6 bindFit: when the reference's content grows by 200px, n becomes 40 and the column ends at 1,100px", async () => {
  let refEnd = 900;
  const b = band({ rows: uniform(40), refEnd: () => refEnd });
  const fit = bindFit(b.ref, b.col, b.target, { min: 10, observe: false });
  await fit.refit();
  assert.equal(b.visible(), 30);
  refEnd = 1100;
  await fit.refit();
  assert.equal(b.visible(), 40);
  assert.equal(b.colEnd(), 1100);
});

test("LD6 bindFit: both cells stretched to 1,200px — the fit is still 30, because it reads content, never the cell box (with a mutation control)", async () => {
  const b = band({ rows: uniform(40), refEnd: () => 900, cellHeight: () => 1200 });
  assert.equal(b.ref.getBoundingClientRect().bottom, 1200, "precondition: the reference CELL is stretched");
  await bindFit(b.ref, b.col, b.target, { min: 10, observe: false }).refit();
  assert.equal(b.visible(), 30);
  assert.equal(b.colEnd(), 900);
  // the mutation the plan names: a binder that measures the CELL box instead of contentBottom
  // (each column made to report its own box as its only child) fits a different count there
  const asCell = (el: Box): Box => ({ ...el, children: [box(() => el.getBoundingClientRect())], getBoundingClientRect: () => el.getBoundingClientRect() });
  const m = band({ rows: uniform(60), refEnd: () => 900, cellHeight: () => 1200 });
  await bindFit(asCell(m.ref), asCell(m.col), m.target, { min: 10, observe: false }).refit();
  assert.notEqual(m.visible(), 30, `control: the cell-box binder shows ${m.visible()} rows`);
  assert.ok(m.colEnd() > 901, "and its column's content runs past the reference's");
});

test("LD6 bindFit: stacked columns (tops more than 2px apart) take the minimum", async () => {
  const b = band({ rows: uniform(40), refEnd: () => 900 });
  const lower = { ...b.col, getBoundingClientRect: () => ({ top: 1500, bottom: 2000, left: 0, right: 600 }) };
  await bindFit(b.ref, lower, b.target, { min: 10, observe: false }).refit();
  assert.deepEqual(b.applied(), [10]);
});

test("LD6 bindFit: a 'Show more' extension is kept, and no exact correction claims alignment while it stands", async () => {
  let extra = 10;
  const b = band({ rows: uniform(60), refEnd: () => 900, extra: () => extra });
  await bindFit(b.ref, b.col, b.target, { min: 10, observe: false }).refit();
  assert.equal(b.visible(), 30 + 10, "visible = base + extra");
  assert.deepEqual(b.applied(), [30], "the estimate only: no correction pass with extra > 0");
  extra = 0;
  b.reset();
  await bindFit(b.ref, b.col, b.target, { min: 10, observe: false }).refit();
  assert.equal(b.visible(), 30, "extra back to 0: the fitted base");
});

test("LD6 bindFit: a newer run cancels an older one still waiting on a repaint (the token guard)", async () => {
  const rows = uniform(40);
  rows[11] = 40;
  rows[19] = 40;
  const b = band({ rows, refEnd: () => 900 });
  const pending: (() => void)[] = [];
  /* every apply is a repaint that resolves only when released */
  const slow: FitTarget = { ...b.target, apply: (n) => new Promise<void>((r) => pending.push(() => { b.target.apply(n); r(); })) };
  const fit = bindFit(b.ref, b.col, slow, { min: 10, observe: false });
  const first = fit.refit();
  const second = fit.refit();
  while (pending.length) {
    pending.shift()!();
    await new Promise((r) => setTimeout(r, 0));
  }
  await Promise.all([first, second]);
  /* the first run's estimate lands (its repaint was in flight), then it stops:
     only the second run corrects */
  assert.deepEqual(b.applied(), [30, 30, 29, 28, 29, 28], "both estimates land; ONE correction runs — the cancelled run stops after its repaint");
  assert.equal(b.visible(), 28, "the second run's result stands");
});

test("LD6 bindFit (codex M2 r2 F1): an OPEN row is never hidden — the fit stays at its place + 1 (exception 4: no alignment past it); an open row above the cut that grows the column refits it back to the reference", async () => {
  // row 35 open (the floor 35): the fit would show 30, it shows 35, and the column ends past the reference
  const b = band({ rows: uniform(40), refEnd: () => 900, floor: () => 35 });
  await bindFit(b.ref, b.col, b.target, { min: 10, observe: false }).refit();
  assert.equal(b.visible(), 35, "the open row stays visible");
  assert.ok(b.colEnd() > 901, "exception 4: the column ends past the reference, and no alignment is claimed");
  // control: the same fit without the floor hides it
  const c = band({ rows: uniform(40), refEnd: () => 900 });
  await bindFit(c.ref, c.col, c.target, { min: 10, observe: false }).refit();
  assert.equal(c.visible(), 30, "control: without the floor row 35 is hidden");
  // row 6 opened to 400px (above the cut): the refit drops rows below it until the column ends at the reference again
  const rows = uniform(40);
  const fit = band({ rows, refEnd: () => 900, floor: () => 6 });
  const binding = bindFit(fit.ref, fit.col, fit.target, { min: 10, observe: false });
  await binding.refit();
  assert.equal(fit.visible(), 30);
  rows[5] = 400;
  assert.ok(fit.colEnd() > 901, "precondition: the opened row pushed the column past the reference");
  await binding.refit();
  assert.equal(fit.visible(), 11, "240 + (10 × 20 + 400) + 60 = 900");
  assert.equal(fit.colEnd(), 900, "re-aligned");
  // closed: the refit grows back
  rows[5] = 20;
  await binding.refit();
  assert.equal(fit.visible(), 30);
  assert.equal(fit.colEnd(), 900);
  // stacked columns take the floor, not the minimum
  const s = band({ rows: uniform(40), refEnd: () => 900, floor: () => 22 });
  const lower = { ...s.col, getBoundingClientRect: () => ({ top: 1500, bottom: 2000, left: 0, right: 600 }) };
  await bindFit(s.ref, lower, s.target, { min: 10, observe: false }).refit();
  assert.deepEqual(s.applied(), [22]);
});

/* ---------------------------------------------------------------- the contract, on the real pager */

test("LD6 contract on the hits pager: visible = min(matching, base + extra); Show more extends; a filter change resets the extension; a short filter shows every matching row and its count says so", async () => {
  const { signalsBody } = await import("../src/lib/ui/index.ts");
  const { initHitPager } = await import("../src/scripts/signals-client.ts");
  const mk = (i: number, kind: "s1-large" | "s6-late-large"): Record<string, unknown> => ({
    id: `${kind}:${i}`, kind, rule: "r", thresholdVersion: "1.0.0",
    entities: { bioguide: `B${String(i).padStart(6, "0")}`, memberName: `M ${i}`, ticker: `T${i}` },
    magnitude: { low: 250001, high: 500000 }, receipts: [`https://efdsearch.senate.gov/${i}`],
    occurrence: { tradeDate: "2026-03-01", filedDate: `2026-06-${String((i % 28) + 1).padStart(2, "0")}` }, sourceAvailableAt: "2026-06-01",
    computedAt: "c", firstSeenBuild: "b", lastSeenBuild: "b", status: "active", cohort: "senate",
    asset: `T${i} Inc`, assetType: "Stock", side: "purchase", owner: "self", listedStock: true,
  });
  const artifact = {
    v: 1, buildId: "b", computedAt: "c", thresholdVersion: "1.0.0", retentionDays: 90, coverageFrom: "2026-05-04", coverageTo: "2026-08-02",
    lifecycleNote: "n", compaction: "c", dateAnomaliesExcluded: 0, lagCaveat: "l", withheld: [],
    signals: [...Array.from({ length: 50 }, (_, i) => mk(i, "s1-large")), ...Array.from({ length: 6 }, (_, i) => mk(100 + i, "s6-late-large"))],
  } as never;
  const { doc, restore } = installDom(signalsBody(artifact, {}, { rowsEvaluated: 1000 }));
  const g = globalThis as unknown as Record<string, unknown>;
  const prevFetch = g.fetch;
  g.fetch = async () => ({ ok: true, json: async () => JSON.parse(JSON.stringify(artifact)) });
  const tick = async () => { for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0)); };
  const shown = () => doc.querySelectorAll("#signal-hits-body tr.si-hit").filter((r) => !r.hasAttribute("hidden")).length;
  const range = () => doc.getElementById("signal-hits-range")!.textContent;
  try {
    const pager = initHitPager()!;
    let refits = 0;
    pager.onFilter = () => void refits++;
    await pager.setBase(28);
    assert.equal(shown(), 28, "base 28, extra 0");
    (doc.getElementById("signal-hits-more") as unknown as MiniElement).click();
    await tick();
    assert.equal(shown(), 38, "Show 10 more: base + 10");
    assert.equal(pager.fitTarget.extra(), 10);
    await pager.setBase(30);
    assert.equal(shown(), 40, "a refit keeps the extension on top of the new base");
    // a filter change drops the extension (and asks the fit to run again)
    (doc.querySelector('#families button[data-family="COMPLIANCE"]') as unknown as MiniElement).bubbleClick();
    await tick();
    assert.equal(pager.fitTarget.extra(), 0, "extra resets on a filter change");
    assert.equal(refits, 1, "the fit re-runs after the filter repaints");
    // a short filter: 6 matching lines, base 30 → every one shows, and the count says so
    assert.equal(pager.fitTarget.matching(), 6);
    assert.equal(shown(), 6, "visible = min(matching, base + extra)");
    assert.equal(range(), "1–6 of 6 lines · 6 hits");
    assert.equal(doc.getElementById("signal-hits-more")!.getAttribute("aria-disabled"), "true");
  } finally {
    restore();
    g.fetch = prevFetch;
  }
});
