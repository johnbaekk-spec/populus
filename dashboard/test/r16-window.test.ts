/* R16 — the shared congress window predicate, tested as the correctness oracle
   the surfaces depend on. Every range crossed with every basis, both exact
   boundaries, rows with no trade date, date-anomaly rows, month and leap-year
   transitions, and empty results.

   These fixtures are deterministic dates, never `new Date()`: a window test
   that reads the clock passes on the day it is written and fails later. */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  congressRangeBounds,
  legacyTrailingMonthsBounds,
  partitionByWindow,
  rangeLabelOf,
  basisLabelOf,
  windowStatement,
  windowMembership,
  type CongressBasis,
  type CongressRange,
} from "../src/lib/derive.ts";
import type { TxnRow } from "../src/lib/format.ts";

const RANGES: CongressRange[] = ["7d", "30d", "90d", "12m"];
const BASES: CongressBasis[] = ["traded", "filed"];

function row(over: Partial<TxnRow> = {}): TxnRow {
  return {
    kind: "txn",
    filed: "2026-08-21",
    traded: "2026-08-21",
    name: "A Member",
    bioguide: "M000001",
    party: "D",
    state: "CA",
    district: null,
    chamber: "house",
    ticker: "AAPL",
    side: "purchase",
    owner: "self",
    low: 1001,
    high: 15000,
    lag: 1,
    late: 0,
    flags: [],
    doc: "https://example.gov/doc",
    asset: null,
    assetType: null,
    txnId: "t1",
    ...over,
  };
}

/* ---------- bounds arithmetic (locked decisions) ---------- */

test("R16 bounds: a day range spans EXACTLY N calendar days including `end`", () => {
  // start = end - (N - 1). A 7d window is 7 days, not 8 — the off-by-one the
  // locked decision exists to prevent.
  assert.deepEqual(congressRangeBounds("7d", "2026-08-21"), {
    start: "2026-08-15",
    end: "2026-08-21",
  });
  assert.deepEqual(congressRangeBounds("30d", "2026-08-21"), {
    start: "2026-07-23",
    end: "2026-08-21",
  });
  assert.deepEqual(congressRangeBounds("90d", "2026-08-21"), {
    start: "2026-05-24",
    end: "2026-08-21",
  });
});

test("R16 bounds: every day range contains exactly N distinct dates", () => {
  const dayCount = (a: string, b: string): number =>
    (Date.UTC(+b.slice(0, 4), +b.slice(5, 7) - 1, +b.slice(8, 10)) -
      Date.UTC(+a.slice(0, 4), +a.slice(5, 7) - 1, +a.slice(8, 10))) /
      86_400_000 +
    1;
  for (const [range, n] of [
    ["7d", 7],
    ["30d", 30],
    ["90d", 90],
  ] as const) {
    const w = congressRangeBounds(range, "2026-08-21");
    assert.equal(dayCount(w.start, w.end), n, `${range} must span ${n} days inclusive`);
  }
});

test("R16 bounds: 12m is one calendar year back plus one day, so `end` is not double-counted", () => {
  assert.deepEqual(congressRangeBounds("12m", "2026-08-21"), {
    start: "2025-08-22",
    end: "2026-08-21",
  });
});

test("R16 bounds: 12m clamps Feb 29 to Feb 28 in a non-leap target year", () => {
  // 2024-02-29 minus one year is not a real date. Clamp to 2023-02-28, then
  // add the day: 2023-03-01. Never an invalid 2023-02-29.
  assert.deepEqual(congressRangeBounds("12m", "2024-02-29"), {
    start: "2023-03-01",
    end: "2024-02-29",
  });
  // A leap target year keeps Feb 29 and simply advances a day.
  assert.deepEqual(congressRangeBounds("12m", "2025-02-28"), {
    start: "2024-02-29",
    end: "2025-02-28",
  });
});

test("R16 bounds: day ranges cross month and year boundaries correctly", () => {
  assert.deepEqual(congressRangeBounds("7d", "2026-01-03"), {
    start: "2025-12-28",
    end: "2026-01-03",
  });
  // Through a leap day: 2024-03-01 back 7 days lands on 2024-02-24 because
  // February 2024 has 29 days.
  assert.deepEqual(congressRangeBounds("7d", "2024-03-01"), {
    start: "2024-02-24",
    end: "2024-03-01",
  });
});

/* ---------- membership: boundaries are inclusive at BOTH ends ---------- */

test("R16 membership: both boundary days are IN, the days either side are OUT", () => {
  for (const range of RANGES) {
    for (const basis of BASES) {
      const w = congressRangeBounds(range, "2026-08-21");
      const at = (d: string): TxnRow => row({ traded: d, filed: d });
      assert.equal(windowMembership(at(w.start), w, basis), "in", `${range}/${basis} start`);
      assert.equal(windowMembership(at(w.end), w, basis), "in", `${range}/${basis} end`);
      assert.equal(
        windowMembership(at(dayShift(w.start, -1)), w, basis),
        "out",
        `${range}/${basis} day before start`,
      );
      assert.equal(
        windowMembership(at(dayShift(w.end, 1)), w, basis),
        "out",
        `${range}/${basis} day after end`,
      );
    }
  }
});

function dayShift(d: string, n: number): string {
  const t = Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10));
  return new Date(t + n * 86_400_000).toISOString().slice(0, 10);
}

/* ---------- basis-specific exclusion policy (locked decision) ---------- */

test("R16 basis: the traded basis EXCLUDES undated rows; the filed basis INCLUDES them", () => {
  const w = congressRangeBounds("30d", "2026-08-21");
  const undated = row({ traded: null, filed: "2026-08-10" });
  assert.equal(windowMembership(undated, w, "traded"), "undated");
  assert.equal(windowMembership(undated, w, "filed"), "in");
});

test("R16 basis: date anomalies are excluded on TRADED and ignored on FILED", () => {
  // A single cross-basis exclusion rule was explicitly rejected: applying the
  // anomaly filter on the filed basis would silently change feed results for a
  // date that is not in doubt.
  const w = congressRangeBounds("30d", "2026-08-21");
  const anomalous = row({ traded: "3031-04-30", filed: "2026-08-10", flags: ["date_anomaly"] });
  assert.equal(windowMembership(anomalous, w, "traded"), "anomaly");
  assert.equal(
    windowMembership(anomalous, w, "filed"),
    "in",
    "the filed date is well-defined and is not in doubt because the trade date is",
  );
});

test("R16 basis: an anomaly verdict wins over an out-of-window trade date", () => {
  // The row is excluded because its date is impossible, not because it missed
  // the window — the two are different facts and the surface states one.
  const w = congressRangeBounds("7d", "2026-08-21");
  const anomalous = row({ traded: "2202-09-19", filed: "2026-08-20", flags: ["date_anomaly"] });
  assert.equal(windowMembership(anomalous, w, "traded"), "anomaly");
});

/* ---------- partition counts every exclusion ---------- */

test("R16 partition: anomalies and undated rows are counted SEPARATELY, never merged", () => {
  const w = congressRangeBounds("30d", "2026-08-21");
  const rows = [
    row({ txnId: "in", traded: "2026-08-01", filed: "2026-08-02" }),
    row({ txnId: "old", traded: "2020-01-01", filed: "2020-01-02" }),
    row({ txnId: "undated", traded: null, filed: "2026-08-05" }),
    row({ txnId: "anom", traded: "3031-04-30", filed: "2026-08-06", flags: ["date_anomaly"] }),
  ];
  const traded = partitionByWindow(rows, w, "traded");
  assert.deepEqual(traded.rows.map((r) => r.txnId), ["in"]);
  assert.equal(traded.dateAnomalies, 1);
  assert.equal(traded.undated, 1);

  const filed = partitionByWindow(rows, w, "filed");
  assert.deepEqual(filed.rows.map((r) => r.txnId).sort(), ["anom", "in", "undated"]);
  assert.equal(filed.dateAnomalies, 0, "no anomaly exclusion applies on the filed basis");
  assert.equal(filed.undated, 0, "a filed date is always well-defined");
});

test("R16 partition: an empty input yields empty rows and zero exclusions on every range/basis", () => {
  for (const range of RANGES) {
    for (const basis of BASES) {
      const p = partitionByWindow([], congressRangeBounds(range, "2026-08-21"), basis);
      assert.deepEqual(p, { rows: [], dateAnomalies: 0, undated: 0 });
    }
  }
});

test("R16 partition: a window that matches nothing excludes nothing — out is not an exclusion", () => {
  const w = congressRangeBounds("7d", "2026-08-21");
  const p = partitionByWindow([row({ traded: "2001-01-01", filed: "2001-01-02" })], w, "traded");
  assert.equal(p.rows.length, 0);
  assert.equal(p.dateAnomalies, 0);
  assert.equal(p.undated, 0);
});

/* ---------- unbounded sides (the feed's optional from/to inputs) ---------- */

test("R16 membership: an empty or null bound is unbounded on that side", () => {
  const r = row({ traded: "1990-01-01", filed: "1990-01-02" });
  assert.equal(windowMembership(r, { start: "", end: "" }, "filed"), "in");
  assert.equal(windowMembership(r, { start: null, end: null }, "filed"), "in");
  assert.equal(windowMembership(r, { start: "1990-01-02", end: "" }, "filed"), "in");
  assert.equal(windowMembership(r, { start: "1990-01-03", end: "" }, "filed"), "out");
  assert.equal(windowMembership(r, { start: "", end: "1990-01-01" }, "filed"), "out");
});

test("R16 membership: the traded basis still excludes an undated row under an OPEN bound", () => {
  // An open-ended trade window is still a trade window; an undated row cannot
  // be placed in it, and saying "out" would hide that.
  const r = row({ traded: null, filed: "2026-08-01" });
  assert.equal(windowMembership(r, { start: "2026-01-01", end: null }, "traded"), "undated");
});

/* ---------- labels are shared so SSR and client cannot drift (R3) ---------- */

test("R16 labels: every range and basis has exactly one reader-facing string", () => {
  assert.equal(rangeLabelOf("7d"), "7 days");
  assert.equal(rangeLabelOf("30d"), "30 days");
  assert.equal(rangeLabelOf("90d"), "90 days");
  assert.equal(rangeLabelOf("12m"), "12 months");
  assert.equal(basisLabelOf("traded"), "trade date");
  assert.equal(basisLabelOf("filed"), "filing date");
});

test("R16 labels: the window statement carries the exact bounds, not just the range name", () => {
  const w = congressRangeBounds("7d", "2026-08-21");
  assert.equal(
    windowStatement("7d", "traded", w),
    "trailing 7 days by trade date · 2026-08-15 to 2026-08-21 inclusive",
  );
});

/* ---------- the legacy mixed basis stays exactly what it was ---------- */

test("R16 legacy basis: trade date when present, filing date otherwise", () => {
  const w = legacyTrailingMonthsBounds("2026-07-24", 12);
  assert.deepEqual(w, { start: "2025-07-24", end: "2026-07-24" });
  assert.equal(
    windowMembership(row({ traded: null, filed: "2026-07-01" }), w, "traded_or_filed"),
    "in",
  );
  assert.equal(
    windowMembership(row({ traded: "2025-07-24", filed: "2026-01-01" }), w, "traded_or_filed"),
    "in",
    "the legacy window is inclusive at its start",
  );
  assert.equal(
    windowMembership(row({ traded: "2025-07-23", filed: "2026-01-01" }), w, "traded_or_filed"),
    "out",
  );
});

test("R16 legacy basis: it never reports an exclusion — it has no undated or anomaly state", () => {
  // The mixed basis always resolves a date, so a caller cannot be handed a
  // count it would have to explain. That is exactly why it is a WEAKER claim
  // and why new surfaces do not use it.
  const w = legacyTrailingMonthsBounds("2026-07-24", 12);
  const p = partitionByWindow(
    [
      row({ traded: null, filed: "2026-07-01" }),
      row({ traded: "3031-04-30", filed: "2026-07-01", flags: ["date_anomaly"] }),
    ],
    w,
    "traded_or_filed",
  );
  assert.equal(p.dateAnomalies, 0, "an anomalous row is merely out of window here, never an exclusion");
  assert.equal(p.undated, 0, "the undated row resolved to its filing date and is IN");
  assert.deepEqual(
    p.rows.map((r) => r.filed),
    ["2026-07-01"],
    "only the undated row survives — the 3031 trade date is far past the window end",
  );
});
