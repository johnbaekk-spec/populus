/* signals-v4 M3: ONE fixture for the Overlap tab — the unit tests, the parity
   capture, the css-fold corpus and the geometry spec render the same rows.

   The owner-tier build (20260817.1) types no notable manager, so its Overlap
   is the stated absence; this fixture is where the populated tab is
   exercised. Synthetic and deterministic, over Q1 2026:

   - 42 names on both sides with known relations: 14 unanimous same-buy
     (T01–T14), 4 same-buy names split on the Congress side (T15–T18), 6
     same-sell (T19–T24), 12 opposite (T25–T36), 4 mixed (T37–T40), and two
     whose relation the broad account changes (T41 same-buy, T42 same-sell,
     both mixed with Broad accounts on);
   - four names only the broad account traded (B01–B04): absent from the
     default view, present with Broad accounts on;
   - the broad account trades 26 more filler names (so its breadth is 30, past
     `BROAD_ACCOUNT_NAMES`), and the lines the join must refuse (an exchange,
     an option, a trade a day past the quarter) on T01;
   - each Congress member trades one name (breadth 1); notable managers are
     reused across names. */

import type { TxnRow } from "../../src/lib/format.ts";
import type { NotableMove, MoveKind } from "../../src/lib/notable-moves.ts";
import { congressQuarter } from "../../src/lib/congress-quarter.ts";
import { buildOverlap, type Overlap } from "../../src/lib/ui/signals-overlap.ts";

export const OVERLAP_PERIOD = "2026-03-31";

interface Spec {
  t: string;
  cb: number;
  cs: number;
  gb: number;
  gs: number;
  broadBuy?: boolean;
  broadSell?: boolean;
}

const pad = (n: number): string => String(n).padStart(2, "0");

export function overlapSpecs(): Spec[] {
  const out: Spec[] = [];
  for (let i = 1; i <= 14; i++) out.push({ t: `T${pad(i)}`, cb: 1 + (i % 3), cs: 0, gb: 1 + (i % 4), gs: 0 });
  for (let i = 15; i <= 18; i++) out.push({ t: `T${pad(i)}`, cb: 3, cs: 1, gb: 2, gs: 0 });
  for (let i = 19; i <= 24; i++) out.push({ t: `T${pad(i)}`, cb: 0, cs: 1 + (i % 2), gb: 0, gs: 2 });
  for (let i = 25; i <= 36; i++) out.push({ t: `T${pad(i)}`, cb: 2, cs: 0, gb: 0, gs: 1 + (i % 3) });
  for (let i = 37; i <= 40; i++) out.push({ t: `T${pad(i)}`, cb: 1, cs: 1, gb: 2, gs: 1 });
  out.push({ t: "T41", cb: 1, cs: 0, gb: 1, gs: 0, broadSell: true });
  out.push({ t: "T42", cb: 0, cs: 1, gb: 0, gs: 1, broadBuy: true });
  for (let i = 1; i <= 4; i++) out.push({ t: `B${pad(i)}`, cb: 0, cs: 0, gb: 1, gs: 0, broadBuy: true });
  return out;
}

function txn(over: Partial<TxnRow>): TxnRow {
  return {
    kind: "txn", txnId: "t", asset: "A", assetType: "ST", filed: "2026-04-15", traded: "2026-02-10",
    name: "Member", bioguide: "M000001", party: "D", state: "CA", district: "12", chamber: "house",
    ticker: "T01", side: "purchase", owner: "self", low: 1001, high: 15000, lag: 64, late: 1, flags: [],
    doc: "https://disclosures-clerk.house.gov/public_disc/ptr-pdfs/2026/20030001.pdf", exchangedTicker: null,
    ...over,
  };
}

export function overlapTxns(): TxnRow[] {
  const rows: TxnRow[] = [];
  let n = 0;
  const line = (ticker: string, side: TxnRow["side"], who: string, bioguide: string | null, party: string, day: number): void => {
    n++;
    rows.push(txn({
      txnId: `ov-${n}`, ticker, side, name: who, bioguide, party, state: party === "R" ? "TX" : "CA", district: String(1 + (n % 9)),
      traded: `2026-0${1 + (day % 3)}-${pad(1 + (day % 27))}`, filed: "2026-04-20", lag: 40 + (n % 30), late: 0,
      owner: n % 3 === 0 ? "spouse" : n % 3 === 1 ? "self" : null,
      doc: `https://disclosures-clerk.house.gov/public_disc/ptr-pdfs/2026/2003${String(n).padStart(4, "0")}.pdf`,
    }));
  };
  overlapSpecs().forEach((s, i) => {
    for (let j = 0; j < s.cb; j++) line(s.t, "purchase", `Buyer ${s.t}-${j}`, `B${String(i * 10 + j).padStart(6, "0")}`, j % 2 ? "R" : "D", i + j);
    for (let j = 0; j < s.cs; j++) line(s.t, j % 2 ? "sale_partial" : "sale", `Seller ${s.t}-${j}`, `S${String(i * 10 + j).padStart(6, "0")}`, j % 2 ? "D" : "R", i + j + 3);
    if (s.broadBuy) line(s.t, "purchase", "Broad Account", "Z000001", "D", i);
    if (s.broadSell) line(s.t, "sale", "Broad Account", "Z000001", "D", i);
  });
  for (let k = 1; k <= 26; k++) line(`ZF${pad(k)}`, "purchase", "Broad Account", "Z000001", "D", k);
  // the lines the join refuses
  rows.push(txn({ txnId: "ov-x-exch", ticker: "T01", side: "exchange", name: "Refused One", bioguide: "R000001" }));
  rows.push(txn({ txnId: "ov-x-op", ticker: "T01", assetType: "OP", name: "Refused Two", bioguide: "R000002" }));
  rows.push(txn({ txnId: "ov-x-late", ticker: "T01", traded: "2026-04-01", name: "Refused Three", bioguide: "R000003" }));
  return rows;
}

export function overlapMoves(): NotableMove[] {
  const out: NotableMove[] = [];
  let k = 0;
  /* manager `slot` of a name: distinct a side (the buy and sell slots never meet), reused across names */
  const move = (ticker: string, kind: MoveKind, slot: number): void => {
    k++;
    const cik = String(5000 + (slot % 40)).padStart(10, "0");
    const sign = kind === "trim" || kind === "exit" ? -1 : 1;
    out.push({
      cik, manager: `Notable Manager ${Number(cik) - 5000}`, principal: null, type: "hedge_fund",
      issuer: `${ticker} HOLDINGS INC`, ticker, ticker_verified: "2026-09-10", kind,
      delta_shares: sign * (100 + k), curr_value: kind === "exit" ? 0 : 2_000_000 + k * 1_000, delta_value: sign * (1_000_000 + k * 1_000),
      filed: "2026-05-12", doc: `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/ov-${k}.xml`,
      key: `sid:sec:ov:${k}`, ikey: `cusip6:ov${ticker.toLowerCase()}`,
    });
  };
  overlapSpecs().forEach((s, i) => {
    for (let j = 0; j < s.gb; j++) move(s.t, j % 2 ? "add" : "new", i * 3 + j);
    for (let j = 0; j < s.gs; j++) move(s.t, j % 2 ? "exit" : "trim", i * 3 + j + 20);
  });
  return out;
}

/** The Overlap model over the fixture, at `sliceRows` (default the page's). */
export function fixtureOverlap(opts: { sliceRows?: number } = {}): Overlap {
  return buildOverlap(congressQuarter(overlapTxns(), OVERLAP_PERIOD), overlapMoves(), opts);
}

/* codex M3 round 1, F5 (R18, LD14): the repeated case. The shared fixture
   above gives every manager one change a name and every member one line, so
   a count of changes or of lines equals the count of managers or members and
   a rule that counts rows passes it. Here one manager holds several position
   keys on a name and one member files several lines on it, so a count of
   rows changes the numbers, the directions, the relation and the order:

   - D1: member A buys it three times, B and C sell it once each (cb 1, cs 2:
     sell; lines 3 against 2 would read buy); manager X opens it and adds
     twice under three position keys, Y trims and Z exits (gb 1, gs 2: sell;
     changes 3 against 2 would read buy; Y trims under two keys, so a count
     of sell changes reads 3) — SAME · SELL SIDE, not unanimous.
     With Broad accounts on, the broad account's two purchases make cb 2: mixed.
   - D2: member D buys it three times and E once (cb 2); manager W opens it
     under four position keys (gb 1) — same buy, unanimous, score 3.
   - D3: member F buys it once (cb 1); managers V, U and T open it (gb 3) —
     same buy, unanimous, score 4, so it comes before D2 (a row count would
     put D2 first).
   - D4: member G buys it once (cb 1); managers S and R open it (gb 2), Q
     trims it under three position keys (gs 1) — same buy, not unanimous,
     score 3 (a count of sell changes, 3 against 2, would read sell:
     opposite). */
export const DUP_PERIOD = OVERLAP_PERIOD;
export function overlapDupCase(): { txns: TxnRow[]; moves: NotableMove[] } {
  const txns: TxnRow[] = [];
  let n = 0;
  const line = (ticker: string, side: TxnRow["side"], who: string, bioguide: string): void => {
    n++;
    txns.push(txn({
      txnId: `dup-${n}`, ticker, side, name: who, bioguide, traded: `2026-02-${pad(1 + n)}`, filed: "2026-03-20", lag: 20, late: 0,
      doc: `https://disclosures-clerk.house.gov/public_disc/ptr-pdfs/2026/2009${String(n).padStart(4, "0")}.pdf`,
    }));
  };
  for (let i = 0; i < 3; i++) line("D1", "purchase", "Member A", "A000101");
  line("D1", "sale", "Member B", "B000102");
  line("D1", "sale_partial", "Member C", "C000103");
  for (let i = 0; i < 3; i++) line("D2", "purchase", "Member D", "D000104");
  line("D2", "purchase", "Member E", "E000105");
  line("D3", "purchase", "Member F", "F000106");
  line("D4", "purchase", "Member G", "G000107");
  // the broad account: D1 twice, and 26 filler names
  line("D1", "purchase", "Broad Account", "Z000101");
  line("D1", "purchase", "Broad Account", "Z000101");
  for (let k = 1; k <= 26; k++) line(`DF${pad(k)}`, "purchase", "Broad Account", "Z000101");
  const moves: NotableMove[] = [];
  let k = 0;
  const move = (ticker: string, kind: MoveKind, cik: number, dv: number): void => {
    k++;
    moves.push({
      cik: String(cik).padStart(10, "0"), manager: `Dup Manager ${cik}`, principal: null, type: "hedge_fund",
      issuer: `${ticker} HOLDINGS INC`, ticker, ticker_verified: "2026-09-10", kind,
      delta_shares: Math.sign(dv) * (10 + k), curr_value: kind === "exit" ? 0 : Math.abs(dv) + 1, delta_value: dv,
      filed: "2026-05-12", doc: `https://www.sec.gov/Archives/edgar/data/${cik}/dup-${k}.xml`,
      key: `sid:sec:dup:${k}`, ikey: `cusip6:dup${ticker.toLowerCase()}`,
    });
  };
  move("D1", "new", 7001, 300_000);
  move("D1", "add", 7001, 200_000);
  move("D1", "add", 7001, 100_000);
  move("D1", "trim", 7002, -50_000);
  move("D1", "trim", 7002, -40_000);
  move("D1", "exit", 7003, -60_000);
  for (let i = 0; i < 4; i++) move("D2", "new", 7004, 90_000 - i * 1_000);
  move("D3", "new", 7005, 80_000);
  move("D3", "new", 7006, 70_000);
  move("D3", "new", 7007, 60_000);
  move("D4", "new", 7008, 55_000);
  move("D4", "new", 7009, 54_000);
  for (let i = 0; i < 3; i++) move("D4", "trim", 7010, -30_000 + i * 1_000);
  return { txns, moves };
}
