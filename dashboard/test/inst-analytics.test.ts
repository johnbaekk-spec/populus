/* The four-screen analytics: every number is computed over ONE closed period
   and withheld — never zero-filled — whenever its denominator is incomplete. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  chamberBenchmark,
  concentrationPeriods,
  concentrationBenchmark,
  memberProfileStats,
  newPositionLeaders,
  trackedValueFor,
} from "../src/lib/inst-analytics.ts";
import { loadClusterBoard } from "../src/lib/activity.ts";
import { clusterBoardHtml, newPositionLeadersHtml } from "../src/lib/ui/index.ts";
import type { InstData, QoqDeltaRow, ConcentrationRow } from "../src/lib/inst.ts";
import type { TxnRow } from "../src/lib/format.ts";

const P = "2026-03-31";
function conc(cik: string, total: number, nulls = 0, share: number | null = 5000, hhi: number | null = 1200): ConcentrationRow {
  return { cik, period_of_report: P, position_count: 10, total_value_usd: total, null_value_positions: nulls, topn_value_usd: total / 2, topn_share_bps: share, hhi, flags: [] };
}
function delta(cik: string, key: string, kind: QoqDeltaRow["change_kind"], curr: number | null): QoqDeltaRow {
  return { cik, position_key: key, put_call: "LONG", curr_period: P, prev_period: "2025-12-31", change_kind: kind, prev_value_usd: null, curr_value_usd: curr, delta_value_usd: curr, prev_shares: null, curr_shares: 1, delta_shares: 1, ssh_prnamt_type: "SH", flags: [] };
}
function inst(filers: { cik: string; conc: ConcentrationRow[]; deltas: QoqDeltaRow[] }[]): InstData {
  return {
    present: true,
    watermarks: { latest_period_of_report: P, latest_filed_date: "2026-05-15" },
    topn: 25,
    filers: filers.map((f) => ({ cik: f.cik, filer_name: `Filer ${f.cik}`, latest_period: P, position_count: 10, total_value_usd: 0, null_value_positions: 0, unkeyed_positions: 0 })),
    deltasByCik: new Map(filers.map((f) => [f.cik, f.deltas])),
    concentrationByCik: new Map(filers.map((f) => [f.cik, f.conc])),
    holdersByIssuer: new Map(),
    addsByPeriodMode: new Map(),
    addsExclusions: new Map(),
    addsPeriods: [P],
    typingByCik: new Map(),
  };
}

test("new-position leaders: weight over a COMPLETE book only; incomplete books are counted, never ranked", () => {
  const data = inst([
    { cik: "1", conc: [conc("1", 1_000)], deltas: [delta("1", "a", "new", 50), delta("1", "b", "new", 10)] }, // 5% and 1%
    { cik: "2", conc: [conc("2", 1_000, 1)], deltas: [delta("2", "a", "new", 300)] }, // NULL-valued position in book
    { cik: "3", conc: [conc("3", 1_000)], deltas: [delta("3", "a", "new", null)] }, // undisclosed new value
    { cik: "4", conc: [conc("4", 1_000)], deltas: [delta("4", "a", "add", 900)] }, // not a NEW position
    { cik: "5", conc: [conc("5", 1_000)], deltas: [delta("5", "a", "new", 15)] }, // below 2%
  ]);
  const l = newPositionLeaders(data, P)!;
  assert.deepEqual(l.rows.map((r) => [r.cik, r.maxWeightBps, r.atThreshold, r.newPositions]), [["1", 500, 1, 2]]);
  assert.equal(l.incompleteBooks, 2, "the NULL-book filer and the undisclosed-value filer are stated, not zero-filled");
  assert.equal(l.evaluated, 4);
  const html = newPositionLeadersHtml(l, () => "top", P);
  assert.match(html, /Conviction leaders/);
  assert.match(html, /5\.0%/);
  assert.match(html, /2 were not rankable/);
  assert.doesNotMatch(html, /Filer 2/);
});

test("tracked value: one closed period, partial books flagged as a lower bound", () => {
  const data = inst([
    { cik: "1", conc: [conc("1", 100)], deltas: [] },
    { cik: "2", conc: [conc("2", 250, 2)], deltas: [] },
    { cik: "3", conc: [{ ...conc("3", 999), period_of_report: "2025-12-31" }], deltas: [] },
  ]);
  assert.deepEqual(trackedValueFor(data, P), { period: P, filers: 2, totalValueUsd: 350, partialBooks: 1 });
  assert.equal(trackedValueFor(data, "2019-03-31"), null);
});

test("concentration benchmark: medians per statistic over the filers that define it; HHI over complete books only", () => {
  const data = inst([
    { cik: "1", conc: [conc("1", 100, 0, 3000, 900)], deltas: [] },
    { cik: "2", conc: [conc("2", 100, 0, 5000, 1500)], deltas: [] },
    { cik: "3", conc: [conc("3", 100, 1, 8000, 4000)], deltas: [] }, // incomplete → excluded from HHI
    { cik: "4", conc: [conc("4", 0, 0, null, null)], deltas: [] }, // undefined share → excluded from share
  ]);
  const b = concentrationBenchmark(data, P)!;
  assert.equal(b.population, 4);
  assert.deepEqual(b.topnShareBps, { median: 5000, n: 3 });
  assert.deepEqual(b.hhi, { median: 1200, n: 2 });
  assert.deepEqual(b.positions, { median: 10, n: 4 });
});

function txn(over: Partial<TxnRow>): TxnRow {
  return { kind: "txn", txnId: "x", bioguide: "B", name: "M", party: "R", state: "TX", district: null, chamber: "house", ticker: "T", asset: "T", assetType: null, side: "purchase", owner: null, low: 1001, high: 15000, traded: "2026-01-01", filed: "2026-01-20", lag: 19, late: 0, flags: [], doc: "d1", ...over } as TxnRow;
}

test("member profile + chamber benchmark: one observation per member, medians never dominated by volume", () => {
  const big = { chamber: "house" as const, txns: Array.from({ length: 400 }, (_, i) => txn({ lag: 100, doc: `d${i % 4}`, owner: "spouse", side: "sale", high: 50000 })) };
  const a = { chamber: "house" as const, txns: [txn({ lag: 10 }), txn({ lag: 12, doc: "d2" })] };
  const c = { chamber: "house" as const, txns: [txn({ lag: 8 })] };
  const senate = { chamber: "senate" as const, txns: [txn({ lag: 60 })] };
  const bench = chamberBenchmark([big, a, c, senate], "house")!;
  assert.equal(bench.members, 3);
  assert.equal(bench.medianLag, 11, "median of [100, 11, 8] — the 400-row filer is one observation");
  assert.equal(bench.buyShare, 1, "median of [0, 1, 1]");
  assert.equal(bench.selfOwnedShare, 1);
  assert.equal(chamberBenchmark([senate], "house"), null);
  const st = memberProfileStats(big.txns);
  assert.equal(st.rowsPerFiling, 100);
  assert.equal(st.shareSmallBracket, 0);
  assert.equal(st.selfOwnedShare, 0);
});

test("cluster board: grouped over the serving activity grain, distinct filers, partial sums flagged, unkeyed rows counted", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "cluster-"));
  const dbPath = path.join(dir, "inst_serving.db");
  const db = new DatabaseSync(dbPath);
  db.exec(`CREATE TABLE serving_activity (row_id INTEGER PRIMARY KEY, cik TEXT, filer_name TEXT, issuer_key TEXT, issuer_name TEXT, position_key TEXT, put_call TEXT, ssh_prnamt_type TEXT, change_kind TEXT, curr_period TEXT, prev_period TEXT, prev_value_usd INTEGER, curr_value_usd INTEGER, delta_value_usd INTEGER, prev_shares INTEGER, curr_shares INTEGER, delta_shares INTEGER, filing_keys TEXT, prior_filing_keys TEXT, current_filing_keys TEXT, flags TEXT)`);
  const ins = db.prepare(`INSERT INTO serving_activity (cik, issuer_key, issuer_name, position_key, put_call, ssh_prnamt_type, change_kind, curr_period, delta_value_usd, filing_keys, prior_filing_keys, current_filing_keys, flags) VALUES (?,?,?,?,'LONG','SH',?,?,?,'[]','[]','[]','[]')`);
  const rows: [string, string | null, string | null, string, number | null][] = [
    ["1", "cusip6:AAA", "Alpha", "new", 10], ["2", "cusip6:AAA", "Alpha", "new", 10], ["3", "cusip6:AAA", "Alpha", "trim", -5],
    ["3", "cusip6:AAA", "Alpha", "trim", null], // same filer twice → still ONE cutter; null → partial
    ["1", "cusip6:BBB", "Beta", "add", 1], ["2", "cusip6:BBB", "Beta", "add", 1], // only two filers → below the bar
    ["1", null, null, "new", 7], // unkeyed
    ["1", "cusip6:AAA", "Alpha", "new", 99], // other period → ignored
  ];
  rows.forEach(([cik, key, name, kind, d], i) => ins.run(cik, key, name, `sid:${i}`, kind, i === rows.length - 1 ? "2025-12-31" : P, d));
  db.close();
  const res = loadClusterBoard({ instPresent: true, dbPath, period: P });
  assert.ok(res.present);
  const b = res.board;
  assert.equal(b.qualifying, 1);
  assert.deepEqual(b.rows.map((r) => [r.issuerName, r.filers, r.adders, r.cutters, r.newPositions, r.netDeltaUsd, r.netDeltaPartial]), [["Alpha", 3, 2, 1, 2, 15, true]]);
  assert.equal(b.unkeyedRows, 1);
  const html = clusterBoardHtml(res, P);
  assert.match(html, /Alpha/);
  assert.match(html, /1 change rows carry no issuer identity/);
  assert.match(html, /≈/);
  // absence states are typed, never a blank table
  assert.match(clusterBoardHtml(loadClusterBoard({ instPresent: true, dbPath, period: "2030-03-31" }), "2030-03-31"), /Not available in this build/);
  assert.match(clusterBoardHtml(loadClusterBoard({ instPresent: false, dbPath, period: P }), P), /institutional module/);
  writeFileSync(path.join(dir, "keep"), "");
});

test("analytics periods come from the concentration table, so an aggregate without the adds table still has a closed quarter", () => {
  const data = inst([
    { cik: "1", conc: [conc("1", 100), { ...conc("1", 90), period_of_report: "2025-12-31" }], deltas: [] },
    { cik: "2", conc: [{ ...conc("2", 50), period_of_report: "2025-09-30" }], deltas: [] },
  ]);
  assert.deepEqual(data.addsPeriods.length === 1 ? concentrationPeriods({ ...data, addsPeriods: [] }) : [], ["2025-09-30", "2025-12-31", P]);
});

test("chamber medians stay fractional for an even population — two members at 50% is a 50% median, not 100%", () => {
  const half = (bioguide: string) => ({ chamber: "house" as const, txns: [txn({ bioguide, side: "purchase", owner: null, high: 15000, lag: 10 }), txn({ bioguide, side: "sale", owner: "spouse", high: 50000, lag: 20, doc: "d2" })] });
  const bench = chamberBenchmark([half("A"), half("B")], "house")!;
  assert.equal(bench.buyShare, 0.5);
  assert.equal(bench.shareSmallBracket, 0.5);
  assert.equal(bench.selfOwnedShare, 0.5);
  assert.equal(bench.medianLag, 15, "median of two members each at median lag 15");
  const uneven = chamberBenchmark([half("A"), { chamber: "house", txns: [txn({ lag: 11 })] }], "house")!;
  assert.equal(uneven.medianLag, 13, "mean of the two middle values (15 and 11), not a rounded neighbour");
  const b = concentrationBenchmark(inst([
    { cik: "1", conc: [conc("1", 100, 0, 3000, 900)], deltas: [] },
    { cik: "2", conc: [conc("2", 100, 0, 3001, 901)], deltas: [] },
  ]), P)!;
  assert.equal(b.topnShareBps!.median, 3000.5);
});
