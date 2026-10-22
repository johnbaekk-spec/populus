/* Senate exchange legs (congress schema 1.1, dataset v3).

   A Senate eFD exchange row prints two legs in its ticker cell: the exchanged
   security (or `--` when eFD links none), a <br/>, then the received one. The
   producer stores the received leg as `ticker` and the given-up leg as
   `exchanged_ticker`; the client carries it as `exchangedTicker`, appended to
   TXN_COLS. These tests pin the wire contract and the one place the leg is
   shown — the row's asset line — and each fails if its feature is removed:
   dropping the column breaks the round trip, reverting DATASET_VERSION lets a
   v2 payload through, and deleting the asset-line element drops the leg. */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  assetLineHtml,
  classifyDataset,
  DATASET_VERSION,
  PAPER_COLS,
  TXN_COLS,
  txnFromArray,
  txnRowHtml,
  txnToArray,
  type RenderCtx,
  type TxnRow,
} from "../src/lib/format.ts";
import { DatabaseSync } from "node:sqlite";
import { exchangedTickerSelect } from "../src/lib/data.ts";
import { entityTxnRowsHtml } from "../src/lib/ui/index.ts";
import { congressTileHtml } from "../src/lib/ui/home.ts";

const CTX: RenderCtx = {};

function txn(over: Partial<TxnRow> = {}): TxnRow {
  return {
    kind: "txn",
    txnId: "senate:f60cfac8-0389-4a5e-8619-095312492adc:83bf53e4538a1119b5d7208946b733d0",
    filed: "2025-08-11",
    traded: "2024-07-22",
    name: "Bill Hagerty",
    bioguide: "H000601",
    party: "R",
    state: "TN",
    district: null,
    chamber: "senate",
    ticker: "EQT",
    exchangedTicker: "ETRN",
    side: "exchange",
    owner: "self",
    low: 15001,
    high: 50000,
    lag: 385,
    late: 1,
    flags: [],
    doc: "https://efdsearch.senate.gov/search/view/ptr/f60cfac8-0389-4a5e-8619-095312492adc/",
    asset: "Equitrans Midstream Corp (Exchanged) Eqt Corp (Received)",
    assetType: "Stock",
    ...over,
  };
}

const LEG = '<span class="exchanged-leg">exchanged <span class="mono-ticker">ETRN</span></span>';

/* ---------- the wire contract ---------- */

test("v3: exchangedTicker is appended LAST, so no existing column index moves", () => {
  assert.equal(DATASET_VERSION, 3);
  assert.equal(TXN_COLS.at(-1), "exchangedTicker");
  assert.equal(TXN_COLS.indexOf("txnId"), 19, "txnId keeps its v2 index");
  assert.equal(TXN_COLS.length, 21);
});

test("v3: both legs round-trip through the columnar codec, and a null leg stays null", () => {
  for (const row of [txn(), txn({ exchangedTicker: null, ticker: "AMCR" })]) {
    const back = txnFromArray(txnToArray(row));
    assert.equal(back.ticker, row.ticker);
    assert.equal(back.exchangedTicker, row.exchangedTicker);
    assert.deepEqual(back, row);
  }
});

test("v3: a v2 dataset is refused as a version mismatch, and 20-column rows as a bad payload", () => {
  const good = {
    dataset_version: DATASET_VERSION,
    txn_cols: [...TXN_COLS],
    paper_cols: [...PAPER_COLS],
    txns: [txnToArray(txn())],
    paper: [],
  };
  assert.equal(classifyDataset(good).outcome, "ok");
  assert.equal(classifyDataset({ ...good, dataset_version: 2 }).outcome, "version_mismatch");
  // a v2 column list under a v3 number cannot be half-read either
  assert.equal(classifyDataset({ ...good, txn_cols: TXN_COLS.slice(0, 20) }).outcome, "bad_payload");
  assert.equal(classifyDataset({ ...good, txns: [txnToArray(txn()).slice(0, 20)] }).outcome, "bad_payload");
});

/* ---------- where the leg is shown ---------- */

test("the feed ledger row shows the exchanged leg on its asset line, outside the ellipsis", () => {
  const html = txnRowHtml(txn(), CTX);
  // the ticker cell carries ONLY the canonical received leg
  assert.match(html, /<td class="cell cell-ticker c-ticker"[^>]*><a href="[^"]*\/EQT\/">EQT<\/a><\/td>/);
  assert.ok(!/cell-ticker[^]*ETRN[^]*cell-asset/.test(html), "the exchanged leg is not in the ticker cell");
  // the leg is a sibling of the truncating .asset-text, after exactly one separator
  assert.ok(html.includes(`</span><span class="asset-sep">·</span>${LEG}`), html);
  // plain text, never a link: the row is listed under `ticker` only
  assert.ok(!/href="[^"]*ETRN/.test(html), "the leg is not linked anywhere on the row");
});

test("the leg and the owner qualifiers each get exactly one separator, in that order", () => {
  const line = assetLineHtml(txn({ owner: "spouse" }), { qualifiers: true });
  assert.ok(
    line.includes(`Eqt Corp (Received)</span></span><span class="asset-sep">·</span>${LEG}<span class="asset-sep">·</span><span class="owner-note">`),
    line,
  );
  assert.equal((line.match(/class="asset-sep"/g) ?? []).length, 2);
  assert.ok(!line.includes("··") && !/asset-sep">·<\/span><span class="asset-sep/.test(line), "never a doubled separator");
});

test("the member-page disclosure table shows the leg on the asset line", () => {
  const html = entityTxnRowsHtml([txn()], "member", CTX);
  assert.ok(html.includes(LEG), html);
});

/* Captured from the v2 renderer (origin/main 8b429c0 `assetLineHtml`, this row,
   owner spouse, qualifiers on) — the exact bytes a row without a leg must keep. */
const V2_ASSET_LINE =
  '<span class="asset-line"><span class="asset-text"><span class="filed-name">Equitrans Midstream Corp (Exchanged) Eqt Corp (Received)</span></span>' +
  '<span class="asset-sep">·</span><span class="owner-note">SP<span class="visually-hidden"> (spouse-owned)</span></span></span>';

test("a row without an exchanged leg renders byte-identically to the v2 markup", () => {
  for (const exchangedTicker of [null, undefined]) {
    const row = txn({ exchangedTicker, owner: "spouse" });
    assert.equal(assetLineHtml(row, { qualifiers: true }), V2_ASSET_LINE);
  }
  // a row that never had the key (a pre-v3 object) renders the same as null
  const { exchangedTicker: _drop, ...legacy } = txn({ exchangedTicker: null });
  assert.equal(txnRowHtml(txn({ exchangedTicker: null }), CTX), txnRowHtml(legacy as TxnRow, CTX));
  assert.equal(
    entityTxnRowsHtml([txn({ exchangedTicker: null })], "member", CTX),
    entityTxnRowsHtml([legacy as TxnRow], "member", CTX),
  );
});

test("aggregate and compact surfaces carry no leg: nameOnly asset lines, the home tile, ticker-page rows", () => {
  assert.ok(!assetLineHtml(txn(), { nameOnly: true }).includes("exchanged-leg"));
  assert.ok(!congressTileHtml([txn()], CTX).includes("ETRN"));
  // the ticker page lists the row under its received leg, with no asset column
  assert.ok(!entityTxnRowsHtml([txn()], "ticker", CTX).includes("ETRN"));
});

/** The property the feed-row test asserts: the leg sits on the asset line,
    after the truncating text, and nowhere in the ticker cell. */
function legOnAssetLine(html: string): boolean {
  const ticker = html.slice(html.indexOf("cell-ticker"), html.indexOf("cell-asset"));
  return html.includes(`</span><span class="asset-sep">·</span>${LEG}`) && !ticker.includes("ETRN");
}

test("control: the predicate rejects a missing leg and a leg moved into the ticker cell", () => {
  const html = txnRowHtml(txn(), CTX);
  assert.equal(legOnAssetLine(html), true);
  assert.equal(legOnAssetLine(html.replace(`<span class="asset-sep">·</span>${LEG}`, "")), false);
  assert.equal(legOnAssetLine(html.replace(">EQT</a>", ">ETRN → EQT</a>")), false);
});

/* ---------- reading a same-MAJOR 1.0 store ---------- */

test("a 1.1 store's leg is read; a 1.0 store (no column) reads every leg as NULL", () => {
  for (const [ddl, expected] of [
    ["CREATE TABLE transactions (txn_id TEXT PRIMARY KEY, ticker TEXT, exchanged_ticker TEXT)", "ETRN"],
    ["CREATE TABLE transactions (txn_id TEXT PRIMARY KEY, ticker TEXT)", null],
  ] as const) {
    const db = new DatabaseSync(":memory:");
    try {
      db.exec(ddl);
      db.exec(
        ddl.includes("exchanged_ticker")
          ? "INSERT INTO transactions VALUES ('t1', 'EQT', 'ETRN')"
          : "INSERT INTO transactions VALUES ('t1', 'EQT')",
      );
      const row = db.prepare(`SELECT t.ticker, ${exchangedTickerSelect(db)} FROM transactions t`).get() as Record<string, unknown>;
      assert.deepEqual({ ...row }, { ticker: "EQT", exchanged_ticker: expected });
    } finally {
      db.close();
    }
  }
});
