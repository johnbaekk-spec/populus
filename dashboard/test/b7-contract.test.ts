/* B-7 (ALPHA-UX): the client wire contract now carries asset_name/asset_type,
   the dataset version is bumped so a stale cached dataset is refused, the
   parser-side ticker gate strips outer whitespace, and date_anomaly rows are
   excluded from every date-windowed aggregate (constraint 9).

   Removal tests: each assertion fails if the corresponding feature is deleted
   — dropping the columns breaks the round-trip, reverting DATASET_VERSION
   breaks the version pin, removing normalizeTicker breaks the hygiene cases,
   and re-admitting date_anomaly rows breaks the window exclusions. */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  classifyDataset,
  DATASET_VERSION,
  PAPER_COLS,
  TXN_COLS,
  txnToArray,
  txnFromArray,
  normalizeTicker,
  assetNameCell,
  type TxnRow,
} from "../src/lib/format.ts";
import {
  excludeDateAnomalies,
  quarterlyFlow,
  topTickers,
  membersDisclosing,
  classifyResponse,
} from "../src/lib/derive.ts";

function txn(over: Partial<TxnRow> = {}): TxnRow {
  return {
    kind: "txn",
    txnId: "t-test",
    asset: null,
    assetType: null,
    filed: "2026-07-21",
    traded: "2026-06-24",
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
    lag: 27,
    late: 0,
    flags: [],
    doc: "https://efdsearch.senate.gov/x",
    ...over,
  };
}

test("B-7: TXN_COLS carries asset + assetType and round-trips them", () => {
  assert.ok((TXN_COLS as readonly string[]).includes("asset"));
  assert.ok((TXN_COLS as readonly string[]).includes("assetType"));
  const row = txn({ ticker: null, asset: "US Treasury Note 4.25% 2031", assetType: "GS" });
  const back = txnFromArray(txnToArray(row));
  assert.equal(back.asset, "US Treasury Note 4.25% 2031");
  assert.equal(back.assetType, "GS");
  assert.equal(back.ticker, null);
});

test("B-7: DATASET_VERSION is 2 and version mismatch is refused", () => {
  assert.equal(DATASET_VERSION, 2);
  // A v1 (pre-B-7) payload must be refused, never half-read with missing cols.
  const stale = { v: 1, kind: "m", t: [], p: [], meta: {} };
  assert.equal(classifyResponse(200, stale).outcome, "version_mismatch");
});

test("B-7/F-5: normalizeTicker strips outer whitespace only", () => {
  assert.equal(normalizeTicker("\n   AMCR"), "AMCR"); // the real F-5 specimen shape
  assert.equal(normalizeTicker("  WMB  "), "WMB");
  assert.equal(normalizeTicker("   \n "), null); // pure-whitespace ticker is no ticker
  assert.equal(normalizeTicker(null), null);
  // Interior whitespace is NOT repaired — the value is not invented into a
  // listed symbol; pathSafeTicker routes it to /e/ at render time.
  assert.equal(normalizeTicker("AB CD"), "AB CD");
});

test("B-7/F-6: no-ticker rows render the asset name as filed, never invent a type", () => {
  const withAsset = assetNameCell({ asset: "Jefferson Parish Muni Bond", assetType: "Municipal Security" });
  assert.match(withAsset, /Jefferson Parish Muni Bond/);
  assert.match(withAsset, /asset type as filed: Municipal Security/);
  const bare = assetNameCell({ asset: null, assetType: null });
  assert.match(bare, /no ticker disclosed/);
  // No classification: an unknown type value passes through verbatim.
  const verbatim = assetNameCell({ asset: "X", assetType: "OT" });
  assert.match(verbatim, /asset type as filed: OT/);
});

test("constraint 9: date_anomaly rows are excluded from every date-windowed aggregate", () => {
  const anomaly = txn({ traded: "3031-04-30", filed: "2026-07-21", flags: ["date_anomaly"], ticker: "SPCX" });
  const normal = txn({ ticker: "SPCX" });

  const { rows, excluded } = excludeDateAnomalies([anomaly, normal]);
  assert.equal(excluded, 1);
  assert.equal(rows.length, 1);

  // quarterlyFlow: the anomalous row lands in no quarter and the count is disclosed.
  const flow = quarterlyFlow([anomaly, normal], "2026-08-12", 8);
  assert.equal(flow.dateAnomalies, 1);
  const totalRows = flow.quarters.reduce(
    (n, q) =>
      n +
      (q.buy.kind === "empty" ? 0 : (q.buy as { rows: number }).rows) +
      (q.sell.kind === "empty" ? 0 : (q.sell as { rows: number }).rows),
    0,
  );
  assert.equal(totalRows, 1);

  // topTickers / membersDisclosing: the anomalous row never reaches the window.
  const top = topTickers([anomaly], "2026-08-12", 24, 6);
  assert.equal(top.length, 0);
  const md = membersDisclosing([anomaly], "2026-08-12", 12, 7);
  assert.equal(md.length, 0);
});

test("review F3: the full-feed dataset classifier refuses stale or malformed bodies", () => {
  const good = {
    dataset_version: DATASET_VERSION,
    txn_cols: [...TXN_COLS],
    paper_cols: [...PAPER_COLS],
    txns: [txnToArray(txn())],
    paper: [],
  };
  assert.equal(classifyDataset(good).outcome, "ok");
  // A cached v1 body must be REFUSED, never decoded with v2 offsets.
  assert.equal(classifyDataset({ ...good, dataset_version: 1 }).outcome, "version_mismatch");
  // Wrong column list = wrong offsets = corruption; refused.
  assert.equal(
    classifyDataset({ ...good, txn_cols: [...TXN_COLS].reverse() }).outcome,
    "bad_payload",
  );
  // A short row (v1-width data under a v2 header) is refused by width.
  assert.equal(
    classifyDataset({ ...good, txns: [txnToArray(txn()).slice(0, 17)] }).outcome,
    "bad_payload",
  );
  assert.equal(classifyDataset(null).outcome, "bad_payload");
});
