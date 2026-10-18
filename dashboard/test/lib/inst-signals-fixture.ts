/* signals-v4 M2: ONE fixture for the Signals Institutional tab — the unit
   tests, the css-fold corpus, the parity capture and the geometry spec all
   render the same model, so a class or a rule one of them reads is a class
   the others see.

   The bounded owner-tier build (20260817.1) carries no notable-manager
   registry (0 of its filers are typed), so it has no move to render; this
   fixture is where the tab's populated state is exercised. It is synthetic
   and deterministic:

   - 200 moves by 40 notable managers over every kind and every chip type
     (and banks, reached only through "any"), in the population order
     (`cmpMoves`: New › Exit › Add › Trim, then the larger |Δ $|), on names
     with and without a reviewed ticker, keyed and unkeyed;
   - the quarter's Congress lines (Q1 2026): purchases and sales on NVDA,
     AAPL and BRK.B (filed with a dot, joined to the SEC's BRK-B), a broad
     account with 26 names, a member with no bioguide, and the lines the join
     must refuse — an exchange, an option, a date anomaly, an untyped row and
     a trade one day past the quarter;
   - three new-position leaders, one whose largest position the aggregate
     does not name. */

import type { TxnRow } from "../../src/lib/format.ts";
import type { NotableMove, MoveKind } from "../../src/lib/notable-moves.ts";
import { MOVE_KIND_PRIORITY } from "../../src/lib/notable-moves.ts";
import type { ManagerType } from "../../src/lib/manager-directory.ts";
import type { NewPositionLeaders } from "../../src/lib/inst-analytics.ts";
import { buildSignalsInstitutional, type SignalsInstitutional } from "../../src/lib/ui/signals-institutional.ts";

export const FIXTURE_PERIOD = "2026-03-31";

const KINDS: MoveKind[] = ["new", "exit", "add", "trim"];
const TYPES: ManagerType[] = ["hedge_fund", "family_office", "asset_manager", "insurer", "alt_manager", "bank"];
/** [ticker, issuer, issuer key]: reviewed names, a dotted share class, and names no reviewed ticker maps. */
const NAMES: [string | null, string, string | null][] = [
  ["NVDA", "NVIDIA CORP", "cusip6:67066g"],
  ["AAPL", "APPLE INC", "cusip6:037833"],
  ["BRK-B", "BERKSHIRE HATHAWAY INC DEL", "cusip6:084670"],
  ["MSFT", "MICROSOFT CORP", "cusip6:594918"],
  ["TSM", "TAIWAN SEMICONDUCTOR MFG LTD", "cusip6:874039"],
  [null, "PRIVATE HOLDINGS LP", "name:private holdings lp"],
  ["GOOGL", "ALPHABET INC", "cusip6:02079k"],
  [null, "UNKEYED ISSUER CO", null],
];

/** Population order, as `notable-moves-derive.ts` `cmpMoves` sorts it. */
function cmp(a: NotableMove, b: NotableMove): number {
  const k = MOVE_KIND_PRIORITY[a.kind] - MOVE_KIND_PRIORITY[b.kind];
  if (k !== 0) return k;
  const av = a.delta_value == null ? null : Math.abs(a.delta_value);
  const bv = b.delta_value == null ? null : Math.abs(b.delta_value);
  if (av !== bv) {
    if (av == null) return 1;
    if (bv == null) return -1;
    return bv - av;
  }
  if (a.cik !== b.cik) return a.cik < b.cik ? -1 : 1;
  return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
}

/** `n` moves in population order. `consensusNames` (default 0, which leaves
    the fixture as every other consumer reads it) adds that many keyed names,
    each opened by three further notable managers, so the board runs past its
    ten compact rows (the geometry spec's "Show all"). `broadOnly` (default
    0) adds that many notable managers' new stakes in ZZ01 — a name whose
    only Congress trader in the quarter is the 26-name broad account (codex
    M2 round 2, F2): with ten it is Consensus row 1 and the Consensus card. */
export const BROAD_ONLY_KEY = "cusip6:zz0001";
export function fixtureMoves(n = 200, opts: { consensusNames?: number; broadOnly?: number } = {}): NotableMove[] {
  const out: NotableMove[] = [];
  for (let j = 0; j < (opts.broadOnly ?? 0); j++) {
    const cik = String(3000 + j).padStart(10, "0");
    out.push({
      cik, manager: `ZZ Manager ${j}`, principal: null, type: TYPES[j % TYPES.length]!,
      issuer: "ZZ01 HOLDINGS INC", ticker: "ZZ01", ticker_verified: "2026-09-10", kind: "new",
      delta_shares: 700 + j, curr_value: 6_000_000 - j * 1_000, delta_value: 5_900_000 - j * 1_000,
      filed: "2026-05-12", doc: `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/fixture-zz-${j}.xml`,
      key: `sid:sec:zz:${j}`, ikey: BROAD_ONLY_KEY,
    });
  }
  for (let k = 0; k < (opts.consensusNames ?? 0); k++) {
    for (let j = 0; j < 3; j++) {
      const cik = String(2000 + k * 3 + j).padStart(10, "0");
      out.push({
        cik, manager: `Consensus Manager ${k * 3 + j}`, principal: null, type: TYPES[(k + j) % TYPES.length]!,
        issuer: `CONSENSUS NAME ${k}`, ticker: null, ticker_verified: null, kind: "new",
        delta_shares: 500 + k, curr_value: 900_000 - k * 1_000, delta_value: 800_000 - k * 1_000 - j,
        filed: "2026-05-10", doc: `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/fixture-c${k}-${j}.xml`,
        key: `sid:sec:c${k}:${j}`, ikey: `cusip6:c${k}`,
      });
    }
  }
  for (let i = 0; i < n; i++) {
    /* name and kind vary independently, so every name gets every kind */
    const kind = KINDS[(i + Math.floor(i / NAMES.length)) % 4]!;
    const [ticker, issuer, ikey] = NAMES[i % NAMES.length]!;
    const cik = String(1000 + (i % 40)).padStart(10, "0");
    const size = 5_000_000 - i * 17_000;
    const sign = kind === "trim" || kind === "exit" ? -1 : 1;
    out.push({
      cik,
      manager: `Manager ${i % 40}`,
      principal: i % 5 === 0 ? `Principal ${i % 40}` : null,
      type: TYPES[i % TYPES.length]!,
      issuer,
      ticker,
      ticker_verified: ticker ? "2026-09-10" : null,
      kind,
      delta_shares: sign * (1000 + i),
      curr_value: kind === "exit" ? 0 : size + 100_000,
      delta_value: i % 37 === 36 ? null : sign * size,
      filed: `2026-05-${String(1 + (i % 15)).padStart(2, "0")}`,
      doc: `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/fixture-${i}.xml`,
      key: `sid:sec:${i}`,
      ikey,
    });
  }
  return out.sort(cmp);
}

function txn(over: Partial<TxnRow>): TxnRow {
  return {
    kind: "txn", txnId: "t", asset: "A", assetType: "ST", filed: "2026-04-15", traded: "2026-02-10",
    name: "Member A", bioguide: "A000001", party: "D", state: "CA", district: "12", chamber: "house",
    ticker: "NVDA", side: "purchase", owner: "spouse", low: 1001, high: 15000, lag: 64, late: 1, flags: [],
    doc: "https://disclosures-clerk.house.gov/public_disc/ptr-pdfs/2026/20020001.pdf", exchangedTicker: null,
    ...over,
  };
}

/** The quarter's Congress lines and the ones the join must refuse. */
export function fixtureTxns(): TxnRow[] {
  const rows: TxnRow[] = [
    txn({ txnId: "a-nvda", traded: "2026-01-01", filed: "2026-02-10", lag: 40, late: 0 }), // the first day of the quarter: in
    txn({ txnId: "a-aapl", ticker: "AAPL", traded: "2026-03-31", filed: "2026-04-20", lag: 20, late: 0, owner: null }), // the last day: in
    txn({ txnId: "b-nvda", name: "Member B", bioguide: "B000002", party: "R", state: "TX", district: "7", ticker: "NVDA", side: "sale", traded: "2026-02-03", filed: "2026-03-01", lag: 26, late: 0, owner: "self", chamber: "house" }),
    txn({ txnId: "e-brk", name: "Member E", bioguide: "E000005", party: "R", state: "OK", district: null, chamber: "senate", ticker: "BRK.B", side: "sale_partial", traded: "2026-03-02", filed: "2026-03-20", lag: 18, late: 0, owner: "joint", assetType: "Stock", doc: "https://efdsearch.senate.gov/search/view/ptr/fixture-e/" }),
    txn({ txnId: "d-aapl", name: "Unjoined Filer", bioguide: null, party: "", state: null, district: null, ticker: "AAPL", traded: "2026-02-20", filed: "2026-03-10", lag: 18, late: 0 }),
    // refused: an exchange, an option, a date anomaly, an untyped row, a trade past the quarter
    txn({ txnId: "x-exch", ticker: "NVDA", side: "exchange", traded: "2026-02-11" }),
    txn({ txnId: "x-op", ticker: "NVDA", assetType: "OP", traded: "2026-02-12" }),
    txn({ txnId: "x-anom", ticker: "NVDA", traded: "2026-02-13", flags: ["date_anomaly"] }),
    txn({ txnId: "x-null", ticker: "NVDA", assetType: null, traded: "2026-02-14" }),
    txn({ txnId: "x-late", ticker: "NVDA", traded: "2026-04-01", filed: "2026-04-15" }),
  ];
  // a frequent filer: 13 NVDA purchases, so the buy side lists 12 lines and points to the rest
  for (let i = 0; i < 13; i++) {
    rows.push(txn({
      txnId: `f-${i}`, name: "Member F", bioguide: "F000006", party: "I", state: "VT", district: null, chamber: "senate", assetType: "Stock",
      traded: `2026-03-${String(1 + i).padStart(2, "0")}`, filed: "2026-03-28", lag: 27 - i, late: 0, owner: "self",
      doc: `https://efdsearch.senate.gov/search/view/ptr/fixture-f-${i}/`,
    }));
  }
  // a broad account: 26 names in the quarter, NVDA among them
  for (let i = 0; i < 26; i++) {
    rows.push(txn({
      txnId: `c-${i}`, name: "Broad Member", bioguide: "C000003", party: "D", state: "NY", district: "3",
      ticker: i === 0 ? "NVDA" : `ZZ${String(i).padStart(2, "0")}`, traded: `2026-01-${String(2 + (i % 27)).padStart(2, "0")}`, filed: "2026-02-28", lag: 40, late: 0,
    }));
  }
  return rows;
}

export function fixtureLeaders(): NewPositionLeaders {
  return {
    period: FIXTURE_PERIOD,
    thresholdBps: 200,
    minBookPositions: 20,
    qualifying: 3,
    evaluated: 12,
    excluded: { notNotable: 5, smallBook: 2, missingValue: 1, belowThreshold: 1 },
    notableManagers: 40,
    rows: [
      { cik: "0000001001", filerName: "Leader One", period: FIXTURE_PERIOD, maxWeightBps: 640, atThreshold: 2, newPositions: 5, bookValueUsd: 9_000_000_000, largest: { issuer: "NVIDIA CORP", ticker: "NVDA", valueUsd: 576_000_000, weightBps: 640, positionKey: "sid:sec:1" } },
      { cik: "0000001002", filerName: "Leader Two", period: FIXTURE_PERIOD, maxWeightBps: 410, atThreshold: 1, newPositions: 3, bookValueUsd: 2_000_000_000, largest: { issuer: "PRIVATE HOLDINGS LP", ticker: null, valueUsd: 82_000_000, weightBps: 410, positionKey: "sid:sec:2" } },
      { cik: "0000001003", filerName: "Leader Three", period: FIXTURE_PERIOD, maxWeightBps: 230, atThreshold: 1, newPositions: 9, bookValueUsd: 1_000_000_000, largest: { issuer: null, ticker: null, valueUsd: 23_000_000, weightBps: 230, positionKey: "sid:x" } },
    ],
  };
}

/** The populated tab. */
export function fixtureInstitutional(over: { moves?: NotableMove[]; sliceRows?: number; txns?: TxnRow[] } = {}): SignalsInstitutional {
  return buildSignalsInstitutional({
    present: true,
    period: FIXTURE_PERIOD,
    latestFiled: "2026-07-31",
    freshness: "13F data in this build runs through filings received 2026-07-31. The filing deadline for the quarter ended 2026-06-30 is 2026-08-14, so that quarter is incomplete here.",
    notableManagers: 40,
    moves: over.moves ?? fixtureMoves(),
    leaders: fixtureLeaders(),
    txns: over.txns ?? fixtureTxns(),
    filerHref: (cik) => `/institutional/filers/${Number(cik)}/`,
    filerTier: () => "top",
    ...(over.sliceRows !== undefined ? { sliceRows: over.sliceRows } : {}),
  });
}
