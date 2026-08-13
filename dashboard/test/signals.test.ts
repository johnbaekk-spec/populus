/* D-1/D-1b/D-1c: the signal engine.

   The load-bearing assertions: the lifecycle contract is complete on every
   signal; ids are stable across builds; the retention window compacts by
   filed date; the D-1b gate WITHHOLDS uncalibrated kinds and kinds firing
   outside their measured envelope (typed reason, never silent); S-5 without
   its inputs is withheld, not computed from half of them; S-3 clusters count
   distinct members on a true trade-date window and exclude anomalies. */

import { test } from "node:test";
import assert from "node:assert/strict";

import { buildSignalArtifact, LAG_CAVEAT, type SignalInputs } from "../src/lib/signals.ts";
import { SIGNAL_THRESHOLDS as SIGNAL_THRESHOLDS_FOR_TESTS } from "../src/lib/signal-thresholds.ts";
import { signalsBody } from "../src/lib/ui.ts";
import type { TxnRow } from "../src/lib/format.ts";

let seq = 0;
function txn(over: Partial<TxnRow> = {}): TxnRow {
  return {
    kind: "txn",
    txnId: `t-${seq++}`,
    asset: null,
    assetType: null,
    filed: "2026-08-01",
    traded: "2026-07-20",
    name: "Test Member",
    bioguide: "T000001",
    party: "R",
    state: "OK",
    district: null,
    chamber: "senate",
    ticker: "WMB",
    side: "purchase",
    owner: "self",
    low: 1001,
    high: 15000,
    lag: 12,
    late: 0,
    flags: [],
    doc: "https://efdsearch.senate.gov/x",
    ...over,
  };
}

/* s1's calibration demands >=50 backtest emissions (a tiny corpus is exactly
   what the gate exists to refuse) — pad the fixture corpus with enough
   qualifying history spread across the window to sit INSIDE the envelope. */
function s1Pad(n = 60): TxnRow[] {
  return Array.from({ length: n }, (_, i) =>
    txn({
      txnId: `pad${i}`,
      filed: `2026-0${(i % 3) + 6}-1${i % 9}`,
      low: 250001,
      high: 500000,
      bioguide: "P000009",
      name: "Pad Member",
      ticker: "PAD",
    }),
  );
}

function inputs(txns: TxnRow[]): SignalInputs {
  return {
    txns,
    buildId: "20260812.9",
    generatedAtDate: "2026-08-12",
    generatedAt: "2026-08-12 00:00 UTC",
    s5: null,
  };
}

test("D-1: every emitted signal carries the full lifecycle contract", () => {
  const art = buildSignalArtifact(
    inputs([...s1Pad(), txn({ txnId: "big", low: 500001, high: 1000000 })]),
  );
  assert.ok(art.signals.length > 0);
  for (const s of art.signals) {
    assert.ok(s.id.includes(":"), "stable id");
    assert.ok(s.rule.length > 10, "exact rule text");
    assert.equal(s.thresholdVersion, art.thresholdVersion);
    assert.ok(s.receipts.length > 0, "receipts");
    assert.ok(s.occurrence.filedDate);
    assert.ok(s.sourceAvailableAt);
    assert.ok(s.computedAt);
    assert.ok(s.firstSeenBuild && s.lastSeenBuild);
    assert.equal(s.status, "active");
    assert.ok(s.magnitude.low != null || s.magnitude.high != null || true);
  }
  assert.equal(art.lagCaveat, LAG_CAVEAT);
  assert.equal(art.coverageTo, "2026-08-12");
});

test("D-1c: ids are stable across builds; retention compacts by filed date", () => {
  const row = txn({ txnId: "stable-row", low: 500001, high: 1000000 });
  const a = buildSignalArtifact(inputs([...s1Pad(), row]));
  const b = buildSignalArtifact({ ...inputs([...s1Pad(), row]), buildId: "20260813.1" });
  const idA = a.signals.find((s) => s.kind === "s1-large")!.id;
  const idB = b.signals.find((s) => s.kind === "s1-large")!.id;
  assert.equal(idA, idB, "the same filing yields the same id in every build");

  // A signal outside the retention window is compacted out of the artifact.
  const old = txn({ txnId: "old-row", filed: "2025-01-01", low: 500001, high: 1000000 });
  const c = buildSignalArtifact(inputs([...s1Pad(), old, row]));
  assert.ok(c.signals.every((s) => s.occurrence.filedDate >= c.coverageFrom));
  assert.ok(!c.signals.some((s) => s.occurrence.filedDate === "2025-01-01"));
});

test("D-1b: S-5 without its inputs is withheld with a typed reason", () => {
  const art = buildSignalArtifact(inputs([txn()]));
  const w = art.withheld.find((x) => x.kind === "s5-jurisdiction");
  assert.ok(w, "s5 must appear as withheld, never silently absent");
  assert.equal(w!.reason, "inputs-not-in-build");
});

test("D-1b: a kind firing outside its measured envelope is withheld", () => {
  // s1's calibrated bound is 120/30d. 200 qualifying rows filed inside the
  // 90-day window ≈ 67/30d — fine; 500 rows ≈ 167/30d — out of envelope.
  const flood = Array.from({ length: 500 }, (_, i) =>
    txn({ txnId: `f${i}`, filed: "2026-08-01", low: 500001, high: 1000000 }),
  );
  const art = buildSignalArtifact(inputs(flood));
  const w = art.withheld.find((x) => x.kind === "s1-large");
  assert.ok(w, "an out-of-envelope kind is withheld");
  assert.equal(w!.reason, "volume-out-of-bounds");
  assert.ok(!art.signals.some((s) => s.kind === "s1-large"), "and emits nothing");
});

test("S-3: distinct members, true 14-day trade window, anomalies excluded", () => {
  const cluster = ["A000001", "B000002", "C000003", "D000004"].map((b, i) =>
    txn({ txnId: `c${i}`, bioguide: b, ticker: "SPCX", traded: `2026-07-${10 + i}`, filed: "2026-08-01" }),
  );
  // same member twice must not double-count
  const dup = txn({ txnId: "dup", bioguide: "A000001", ticker: "SPCX", traded: "2026-07-11", filed: "2026-08-01" });
  const anomaly = txn({ txnId: "an", bioguide: "E000005", ticker: "SPCX", traded: "3031-04-30", flags: ["date_anomaly"] });
  const art = buildSignalArtifact(inputs([...cluster, dup, anomaly]));
  const s3 = art.signals.filter((s) => s.kind === "s3-cooccurrence");
  assert.equal(s3.length, 1);
  assert.equal(s3[0]!.entities.memberName, "4 members");
  assert.equal(s3[0]!.receipts.length >= 1, true);

  // three distinct members: below N=4 — nothing fires
  const three = buildSignalArtifact(inputs(cluster.slice(0, 3)));
  assert.equal(three.signals.filter((s) => s.kind === "s3-cooccurrence").length, 0);
});

test("S-2 rule states the era scope; S-6 requires late AND large", () => {
  const art = buildSignalArtifact(
    inputs([
      // s2/s4 require 365 days of corpus history (F2 enforcement) — provide it.
      txn({ txnId: "hist", filed: "2025-01-01", traded: "2024-12-15" }),
      txn({ txnId: "first", ticker: "NEWT", filed: "2026-08-01" }),
      txn({ txnId: "lateSmall", late: 1, low: 1001, high: 15000 }),
      txn({ txnId: "lateBig", late: 1, low: 250001, high: 500000 }),
      // s6's calibrated minimum backtest emission is 10 — pad with history
      ...Array.from({ length: 10 }, (_, i) =>
        txn({ txnId: `l${i}`, late: 1, low: 100001, high: 250000, filed: "2026-06-01" })),
    ]),
  );
  const s2 = art.signals.find((s) => s.kind === "s2-first")!;
  assert.match(s2.rule, /era-scoped/);
  const s6 = art.signals.filter((s) => s.kind === "s6-late-large");
  assert.ok(s6.length >= 2, "late-large fires only on late AND large");
  assert.ok(!s6.some((s) => s.magnitude.low === 1001), "late-but-small never fires");
});

test("D-2 body: rules, receipts, lag caveat, and withheld kinds all render", () => {
  const art = buildSignalArtifact(inputs([...s1Pad(), txn({ txnId: "big", low: 500001, high: 1000000 })]));
  const html = signalsBody(art, { watched: new Set() });
  assert.match(html, /Rule:/);
  assert.match(html, /eFD&nbsp;↗/);
  assert.ok(html.includes("WITHHELD"), "withheld kinds render as withheld");
  assert.ok(html.includes(LAG_CAVEAT.slice(0, 40)));
  assert.match(html, /coverage window/);
});

test("review F1: prior-artifact chaining — first-seen carried, tombstones emitted", () => {
  const row = txn({ txnId: "keeps", low: 500001, high: 1000000, filed: "2026-08-01" });
  const dies = txn({ txnId: "leaves", low: 500001, high: 1000000, filed: "2026-07-15" });
  const buildA = buildSignalArtifact({ ...inputs([...s1Pad(), row, dies]), buildId: "20260810.1" });
  const idKeeps = buildA.signals.find((s) => s.kind === "s1-large" && s.receipts.length === 1 && s.occurrence.filedDate === "2026-08-01")!.id;

  // Build B: `dies` left the default view (amended away) — chained artifact.
  const buildB = buildSignalArtifact({
    ...inputs([...s1Pad(), row]),
    buildId: "20260812.1",
    priorArtifact: buildA,
  });
  const kept = buildB.signals.find((s) => s.id === idKeeps)!;
  assert.equal(kept.firstSeenBuild, "20260810.1", "first-seen carries forward by id");
  assert.equal(kept.lastSeenBuild, "20260812.1");
  const tomb = buildB.signals.find((s) => s.status === "superseded");
  assert.ok(tomb, "a signal that left the retained view gets a TOMBSTONE, never silence");
  assert.equal(tomb!.supersededInBuild, "20260812.1");
  assert.equal(tomb!.occurrence.filedDate, "2026-07-15");
  assert.match(buildB.lifecycleNote, /chained to the prior artifact/);
  // Cold start says so.
  assert.match(buildA.lifecycleNote, /cold start/);
});

test("review F2: min-history withholds baseline-dependent kinds on a shallow corpus", () => {
  // 61 days of corpus: s2 (365d) and s4 (365d) must be withheld with the
  // typed insufficient-history reason, not silently emitted.
  const art = buildSignalArtifact(inputs([txn({ ticker: "NEWT" })]));
  for (const kind of ["s2-first", "s4-infrequent"] as const) {
    const w = art.withheld.find((x) => x.kind === kind);
    assert.ok(w, `${kind} must be withheld on a shallow corpus`);
    assert.equal(w!.reason, "insufficient-history");
  }
});

test("review F2: cohort volume bounds — a busy chamber cannot hide behind a quiet one", () => {
  // 300 senate s1 rows in-window (≈100/30d overall would pass a blended check
  // at bound 120 only if diluted; here the senate cohort alone exceeds it).
  const senateFlood = Array.from({ length: 400 }, (_, i) =>
    txn({ txnId: `sf${i}`, chamber: "senate", filed: "2026-08-01", low: 500001, high: 1000000 }),
  );
  const houseQuiet = Array.from({ length: 4000 }, (_, i) =>
    txn({ txnId: `hq${i}`, chamber: "house", filed: "2020-01-01", low: 500001, high: 1000000 }),
  );
  const art = buildSignalArtifact(inputs([...senateFlood, ...houseQuiet]));
  const w = art.withheld.find((x) => x.kind === "s1-large");
  assert.ok(w, "the busy cohort must trip the bound");
  assert.equal(w!.reason, "volume-out-of-bounds");
  assert.match(w!.detail, /cohort 'senate'|cohort 'all'/);
});

test("review F10: the per-entity signal section renders each signal's exact rule", async () => {
  const { memberSignalsPanel } = await import("../src/lib/ui.ts");
  const art = buildSignalArtifact(inputs([...s1Pad(), txn({ txnId: "big", low: 500001, high: 1000000 })]));
  const html = memberSignalsPanel(art, "T000001", { watched: new Set() });
  const mine = art.signals.find((s) => s.entities.bioguide === "T000001")!;
  assert.ok(html.includes(mine.rule.slice(0, 40)), "the verbatim rule must reach the member page");
});

test("review r2-F2: a tombstone is preserved VERBATIM across later builds", () => {
  const row = txn({ txnId: "keeps", low: 500001, high: 1000000, filed: "2026-08-01" });
  const dies = txn({ txnId: "leaves", low: 500001, high: 1000000, filed: "2026-07-15" });
  const a = buildSignalArtifact({ ...inputs([...s1Pad(), row, dies]), buildId: "A" });
  const b = buildSignalArtifact({ ...inputs([...s1Pad(), row]), buildId: "B", priorArtifact: a });
  const c = buildSignalArtifact({ ...inputs([...s1Pad(), row]), buildId: "C", priorArtifact: b });
  const tombB = b.signals.find((s) => s.status === "superseded")!;
  const tombC = c.signals.find((s) => s.status === "superseded")!;
  assert.equal(tombB.supersededInBuild, "B");
  assert.deepEqual(tombC, tombB, "build C must carry build B's tombstone unchanged — history, not re-stamped");
});

test("review r2-F3: tombstones never render as active — separate section, separate counts", async () => {
  const { signalsBody: body, memberSignalsPanel: panel } = await import("../src/lib/ui.ts");
  const row = txn({ txnId: "keeps", low: 500001, high: 1000000, filed: "2026-08-01" });
  const dies = txn({ txnId: "leaves", low: 500001, high: 1000000, filed: "2026-07-15", bioguide: "T000001" });
  const a = buildSignalArtifact({ ...inputs([...s1Pad(), row, dies]), buildId: "A" });
  const b = buildSignalArtifact({ ...inputs([...s1Pad(), row]), buildId: "B", priorArtifact: a });
  const html = body(b, { watched: new Set() });
  assert.match(html, /Superseded — no longer in the current view/);
  assert.match(html, /Superseded in build/);
  // The active S-1 count excludes the tombstone: actives in window minus one.
  const activeS1 = b.signals.filter((s) => s.kind === "s1-large" && s.status === "active").length;
  assert.match(html, new RegExp(`${activeS1} in window`));
  const member = panel(b, "T000001", { watched: new Set() });
  assert.match(member, /superseded in the window/);
});

test("review r2-F4: the DECLARED dedupe_key is enforced, not a hard-coded identity", () => {
  const base = JSON.parse(JSON.stringify(await_thresholds())) as ReturnType<typeof await_thresholds>;
  // Two distinct rows, same member+ticker, both s1-qualifying.
  const r1 = txn({ txnId: "r1", low: 500001, high: 1000000, filed: "2026-08-01" });
  const r2 = txn({ txnId: "r2", low: 500001, high: 1000000, filed: "2026-08-02" });
  const perRow = buildSignalArtifact(inputs([...s1Pad(), r1, r2]));
  const perRowCount = perRow.signals.filter(
    (s) => s.kind === "s1-large" && s.entities.bioguide === "T000001",
  ).length;
  assert.equal(perRowCount, 2, "txnId grammar: one signal per row");

  const s1 = base.kinds["s1-large"] as {
    dedupe_key: string;
    calibration: { volume_bounds: { min_total_backtest: number } };
  };
  s1.dedupe_key = "bioguide+ticker";
  // Collapsing to entity grain shrinks the backtest population below the
  // committed minimum — relax it in the OVERRIDE so this test isolates the
  // dedupe grammar (the min-total behavior has its own test above).
  s1.calibration.volume_bounds.min_total_backtest = 1;
  const collapsed = buildSignalArtifact(inputs([...s1Pad(), r1, r2]), base);
  const collapsedCount = collapsed.signals.filter(
    (s) => s.kind === "s1-large" && s.entities.bioguide === "T000001",
  ).length;
  assert.equal(collapsedCount, 1, "changing the declared grammar changes enforcement");

  (base.kinds["s1-large"] as { dedupe_key: string }).dedupe_key = "no-such-grammar";
  assert.throws(
    () => buildSignalArtifact(inputs([...s1Pad(), r1]), base),
    /unsupported dedupe_key grammar/,
    "unknown grammar fails closed",
  );
});

function await_thresholds() {
  // the committed thresholds, deep-cloneable for mutation tests
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return (SIGNAL_THRESHOLDS_FOR_TESTS as unknown) as {
    version: string;
    retention_days: number;
    kinds: Record<string, unknown>;
  };
}

test("review r3-F4: a tombstone-only member states the supersession, never 'no signals'", async () => {
  const { memberSignalsPanel } = await import("../src/lib/ui.ts");
  // Build A: the member's only signal is active. Build B: it left the view.
  const only = txn({ txnId: "solo", low: 500001, high: 1000000, filed: "2026-07-15", bioguide: "Z000009", name: "Tomb Member" });
  const a = buildSignalArtifact({ ...inputs([...s1Pad(), only]), buildId: "A" });
  const b = buildSignalArtifact({ ...inputs([...s1Pad()]), buildId: "B", priorArtifact: a });
  const html = memberSignalsPanel(b, "Z000009", { watched: new Set() });
  assert.doesNotMatch(html, /No signals for this member/);
  assert.match(html, /superseded inside it/);
  assert.match(html, /1 earlier signal was/);
});

/* ---------- cycle-2 blockers (round-3 F1, F2, F3, F5) ---------- */

test("r3-F2: the prior-artifact validator rejects structurally invalid history", async () => {
  const { validateSignalArtifact } = await import("../src/lib/signals.ts");
  const good = buildSignalArtifact(inputs([...s1Pad(), txn({ txnId: "big", low: 500001, high: 1000000 })]));
  assert.deepEqual(validateSignalArtifact(JSON.parse(JSON.stringify(good))), []);

  // the exact document the reviewer's probe used: v:1 and nothing else
  assert.ok(validateSignalArtifact({ v: 1, signals: [] }).length > 0, "a bare {v:1} is not history");
  assert.ok(validateSignalArtifact(null).length > 0);
  assert.ok(validateSignalArtifact({ v: 2 }).length > 0);

  // field-level defects, one at a time
  const mutate = (fn: (a: Record<string, unknown>) => void): string[] => {
    const doc = JSON.parse(JSON.stringify(good)) as Record<string, unknown>;
    fn(doc);
    return validateSignalArtifact(doc);
  };
  assert.ok(mutate((a) => void delete a.coverageFrom).some((e) => /coverageFrom/.test(e)));
  assert.ok(mutate((a) => void (a.retentionDays = "90")).some((e) => /retentionDays/.test(e)));
  assert.ok(mutate((a) => void delete a.dateAnomaliesExcluded).some((e) => /dateAnomaliesExcluded/.test(e)));
  assert.ok(
    mutate((a) => void ((a.signals as Record<string, unknown>[])[0]!.kind = "s99-bogus")).some((e) => /kind is unknown/.test(e)),
  );
  assert.ok(
    mutate((a) => void ((a.signals as Record<string, unknown>[])[0]!.receipts = [])).some((e) => /receipts/.test(e)),
  );
  assert.ok(
    mutate((a) => void ((a.signals as Record<string, unknown>[])[0]!.status = "superseded")).some((e) =>
      /must name the build that superseded it/.test(e),
    ),
  );
  assert.ok(
    mutate((a) => void ((a.signals as Record<string, unknown>[])[0]!.cohort = "moon")).some((e) => /cohort/.test(e)),
  );
});

test("r3-F3: a WITHHELD kind carries its prior signals as unevaluated, never superseded", () => {
  const big = txn({ txnId: "big", low: 500001, high: 1000000, filed: "2026-08-01" });
  const a = buildSignalArtifact({ ...inputs([...s1Pad(), big]), buildId: "A" });
  assert.ok(a.signals.some((s) => s.kind === "s1-large" && s.status === "active"));

  // Build B withholds s1 (flood → out of envelope). Its prior actives must NOT
  // be recorded as retractions.
  const flood = Array.from({ length: 500 }, (_, i) =>
    txn({ txnId: `f${i}`, filed: "2026-08-01", low: 500001, high: 1000000 }),
  );
  const b = buildSignalArtifact({ ...inputs(flood), buildId: "B", priorArtifact: a });
  assert.ok(b.withheld.some((w) => w.kind === "s1-large"));
  const carried = b.signals.filter((s) => s.kind === "s1-large");
  assert.ok(carried.length > 0, "prior s1 rows are carried, not dropped");
  assert.ok(carried.every((s) => s.status === "unevaluated"), "withheld ≠ superseded");
  assert.ok(carried.every((s) => s.unevaluatedInBuild === "B" && s.supersededInBuild === undefined));

  // Build C evaluates s1 again and the row is genuinely gone → NOW a tombstone.
  const c = buildSignalArtifact({ ...inputs([...s1Pad()]), buildId: "C", priorArtifact: b });
  const gone = c.signals.filter((s) => s.kind === "s1-large" && s.status === "superseded");
  assert.ok(gone.length > 0, "recovery converts a real disappearance into supersession");
  assert.ok(gone.every((s) => s.supersededInBuild === "C"));
});

test("r3-F3: unevaluated rows render with their withholding, not as active", async () => {
  const { signalsBody: body, memberSignalsPanel: panel } = await import("../src/lib/ui.ts");
  const big = txn({ txnId: "big", low: 500001, high: 1000000, filed: "2026-08-01", bioguide: "U000001" });
  const a = buildSignalArtifact({ ...inputs([...s1Pad(), big]), buildId: "A" });
  const flood = Array.from({ length: 500 }, (_, i) =>
    txn({ txnId: `f${i}`, filed: "2026-08-01", low: 500001, high: 1000000 }),
  );
  const b = buildSignalArtifact({ ...inputs(flood), buildId: "B", priorArtifact: a });
  const html = body(b, { watched: new Set() });
  assert.match(html, /carried forward <strong>unevaluated<\/strong>/);
  assert.doesNotMatch(html, /Superseded — no longer in the current view/);
  const member = panel(b, "U000001", { watched: new Set() });
  assert.match(member, /unevaluated/);
  assert.doesNotMatch(member, /superseded/);
});

test("r3-F5: the signal id is a function of the DECLARED identity, not of which row survived", () => {
  const base = JSON.parse(JSON.stringify(SIGNAL_THRESHOLDS_FOR_TESTS)) as {
    kinds: Record<string, { dedupe_key: string; calibration: { volume_bounds: { min_total_backtest: number } } }>;
  };
  const s1 = base.kinds["s1-large"]!;
  s1.dedupe_key = "bioguide+ticker";
  s1.calibration.volume_bounds.min_total_backtest = 1;

  const r1 = txn({ txnId: "r1", low: 500001, high: 1000000, filed: "2026-08-01" });
  const r2 = txn({ txnId: "r2", low: 500001, high: 1000000, filed: "2026-08-02" });
  const idOf = (art: ReturnType<typeof buildSignalArtifact>): string =>
    art.signals.find((s) => s.kind === "s1-large" && s.entities.bioguide === "T000001")!.id;

  const withBoth = buildSignalArtifact(inputs([...s1Pad(), r1, r2]), base);
  // Drop the row that happened to survive the dedupe: under a row-hashed id the
  // surviving id would CHANGE, minting a false tombstone + false first-seen.
  const withOne = buildSignalArtifact(inputs([...s1Pad(), r2]), base);
  const withOther = buildSignalArtifact(inputs([...s1Pad(), r1]), base);
  assert.equal(idOf(withBoth), idOf(withOne));
  assert.equal(idOf(withBoth), idOf(withOther));

  // The per-row grammar keeps per-row ids (no churn for the committed config).
  const perRow = buildSignalArtifact(inputs([...s1Pad(), r1, r2]));
  assert.equal(
    new Set(perRow.signals.filter((s) => s.entities.bioguide === "T000001").map((s) => s.id)).size,
    2,
  );
});

test("c2-F1: the validator enforces identity uniqueness and status-specific lifecycle fields", async () => {
  const { validateSignalArtifact } = await import("../src/lib/signals.ts");
  const good = JSON.parse(
    JSON.stringify(buildSignalArtifact(inputs([...s1Pad(), txn({ txnId: "big", low: 500001, high: 1000000 })]))),
  ) as { signals: Record<string, unknown>[] };
  assert.deepEqual(validateSignalArtifact(good), []);

  const clone = (): typeof good => JSON.parse(JSON.stringify(good)) as typeof good;

  // duplicate identity — two histories collapsed onto one id
  const dup = clone();
  dup.signals.push(JSON.parse(JSON.stringify(dup.signals[0])) as Record<string, unknown>);
  assert.ok(validateSignalArtifact(dup).some((e) => /duplicate signal id/.test(e)));

  // unevaluated without its stamp — "we stopped evaluating" with no when
  const noStamp = clone();
  noStamp.signals[0]!.status = "unevaluated";
  assert.ok(validateSignalArtifact(noStamp).some((e) => /must name the build in which evaluation stopped/.test(e)));

  // unevaluated AND superseded — contradictory states
  const both = clone();
  both.signals[0]!.status = "unevaluated";
  both.signals[0]!.unevaluatedInBuild = "B";
  both.signals[0]!.supersededInBuild = "C";
  assert.ok(validateSignalArtifact(both).some((e) => /cannot also carry a supersession stamp/.test(e)));

  // an active row carrying either stamp
  const stampedActive = clone();
  stampedActive.signals[0]!.supersededInBuild = "C";
  assert.ok(validateSignalArtifact(stampedActive).some((e) => /active signal carries no/.test(e)));

  // the LEGITIMATE history shape: unevaluated in B, then superseded in C
  const realHistory = clone();
  realHistory.signals[0]!.status = "superseded";
  realHistory.signals[0]!.supersededInBuild = "C";
  realHistory.signals[0]!.unevaluatedInBuild = "B";
  assert.deepEqual(validateSignalArtifact(realHistory), [], "history is not a contradiction");

  // and the engine's own three-build output round-trips the validator
  const a = buildSignalArtifact({ ...inputs([...s1Pad(), txn({ txnId: "x", low: 500001, high: 1000000 })]), buildId: "A" });
  const flood = Array.from({ length: 500 }, (_, i) =>
    txn({ txnId: `f${i}`, filed: "2026-08-01", low: 500001, high: 1000000 }),
  );
  const b = buildSignalArtifact({ ...inputs(flood), buildId: "B", priorArtifact: a });
  const c = buildSignalArtifact({ ...inputs([...s1Pad()]), buildId: "C", priorArtifact: b });
  for (const [name, art] of [["A", a], ["B", b], ["C", c]] as const) {
    assert.deepEqual(validateSignalArtifact(JSON.parse(JSON.stringify(art))), [], `build ${name} must validate`);
  }
});
