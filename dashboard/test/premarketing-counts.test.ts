/* Pre-marketing (owner, 2026-10-22): the counts a reader sees twice agree.
   - A ticker page's 12 months are the /congress/ boards' 12 months: by trade
     date, ending today, the anniversary day counted once (AAPL read 33 sells
     on the ticker page and 32 on /congress/ — one Pelosi sale on 2025-10-22).
   - Methodology's "unjoined" figure is the unjoined filer names, not the
     amendment-pair count that used to sit under that label (177 vs 77). */

import { test } from "node:test";
import assert from "node:assert/strict";

import { membersDisclosing, type TxnRow } from "../src/lib/derive.ts";
import { methodologyM1Tiles } from "../src/lib/data.ts";

const ROW: TxnRow = {
  kind: "txn", txnId: "t-1", asset: null, assetType: null, filed: "2026-10-01", traded: "2026-09-01", name: "Fixture Member",
  bioguide: "T000001", party: "R", state: "OK", district: null, chamber: "senate", ticker: "AAPL", side: "sale", owner: "joint",
  low: 1001, high: 15000, lag: 30, late: 0, flags: [], doc: "https://efdsearch.senate.gov/search/view/ptr/abc/",
} as TxnRow;

test("membersDisclosing: 12 months by trade date, the anniversary day out, as the /congress/ boards count", () => {
  const rows: TxnRow[] = [
    { ...ROW, txnId: "in-start", traded: "2025-10-23", filed: "2025-10-25" },
    { ...ROW, txnId: "anniversary", traded: "2025-10-22", filed: "2025-10-24", bioguide: "T000002", name: "Second" },
    { ...ROW, txnId: "undated", traded: null, filed: "2026-10-01", bioguide: "T000003", name: "Third" },
    { ...ROW, txnId: "today", traded: "2026-10-22", filed: "2026-10-22" },
  ];
  const got = membersDisclosing(rows, "2026-10-22", 12, 10);
  assert.deepEqual(got.map((m) => [m.bioguide, m.sells]), [["T000001", 2]], "the anniversary row and the undated row are outside the window");
});

test("Methodology's unjoined tile counts unjoined filer names, not amendment pairs", () => {
  const stats = {
    default: { row_count: 10, late_filing: { overall: { median_days_to_file: 30, late_count: 1, rows_with_late_status: 10 } } },
    totals: { unresolved_pair_count: 177, parse_coverage_primary_by_chamber_year_including_excluded: {}, needs_ocr_filing_count_including_excluded: 3061 },
    unresolved_names: [{ name: "A" }, { name: "B" }],
  };
  const tiles = methodologyM1Tiles(stats, "2012-01-01");
  assert.equal(tiles.find((x) => /paper filings/.test(x.label))!.value, "3,061", "counts read with thousands separators");
  const t = tiles.find((x) => /unjoined/.test(x.label))!;
  assert.equal(t.value, "2");
  assert.deepEqual(t.statsKeys, ["unresolved_names"]);
  assert.doesNotMatch(t.label, /pair/);
});
