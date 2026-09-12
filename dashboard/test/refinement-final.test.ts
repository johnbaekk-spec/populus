/* Refinement 20260910 — final round.
   C1 the CUSIP of a reviewed-ticker security is withheld from published files
   (this file pins the RENDER side; the producer side is tests/test_inst_redaction.py)
   · C3 the ticker verification date is carried once per payload, not per row. */
import { test } from "node:test";
import assert from "node:assert/strict";

import { identityStrengthOf, identityChipHtml } from "../src/lib/format.ts";
import { holdingsTableHtml, type FilerHoldingRow } from "../src/lib/holdings.ts";

const ROW: FilerHoldingRow = {
  cik: "0001067983",
  period: "2026-03-31",
  filing_key: null,
  security_id: null,
  cusip: null,
  issuer_name: "APPLE INC",
  title_of_class: "CMN",
  value_usd: 1_000,
  shares: 10,
  ssh_type: "SH",
  put_call: null,
  position_key: "pos:41",
  put_call_bucket: "LONG",
  unit_key: "SH",
  flags: [],
  issuer_key: "iss:7",
  ticker: "AAPL",
};

/* ---------- C1: an opaque key reads as withheld, never as unrecognised ---- */

test("C1: the producer's opaque keys are named, not left as an unknown key", () => {
  assert.equal(identityStrengthOf("pos:41"), "withheld");
  assert.equal(identityStrengthOf("iss:7"), "withheld");
  // The keys that DO carry identity are untouched.
  assert.equal(identityStrengthOf("cusip6:037833"), "cusip6");
  assert.equal(identityStrengthOf("sid:sec:prov:00076fbdb7a2ddaf78c0e89001ecf4f7"), "provisional");
  const chip = identityChipHtml("iss:7", { scope: "test" }, "k");
  assert.match(chip, /CUSIP withheld/);
  assert.doesNotMatch(chip, /unrecognized/);
});

test("C1: a withheld row renders no CUSIP and still renders its ticker", () => {
  const html = holdingsTableHtml({
    reference: true,
    cik: "0001067983",
    filerName: "BERKSHIRE HATHAWAY INC",
    period: "2026-03-31",
    rows: [ROW],
    filings: {},
    page: 0,
    tickerDates: { AAPL: "2026-09-11" },
  });
  assert.match(html, /AAPL/);
  assert.doesNotMatch(html, /CUSIP [0-9A-Z]{9}/, "no CUSIP cell for a reviewed-ticker security");
});

/* ---------- C3: one date per payload, still stated on every row's ⓘ ------- */

test("C3: the ⓘ states the verification date from the payload map, not the row", () => {
  const html = holdingsTableHtml({
    reference: true,
    cik: "0001067983",
    filerName: "BERKSHIRE HATHAWAY INC",
    period: "2026-03-31",
    rows: [ROW],
    filings: {},
    page: 0,
    tickerDates: { AAPL: "2026-09-11" },
  });
  assert.match(html, /verified against the SEC company list on 2026-09-11/);
  assert.doesNotMatch(html, /on the recorded date/, "a mapped ticker never falls back");
});

test("C3: a row that still carries its own date (older payload) keeps rendering it", () => {
  const html = holdingsTableHtml({
    reference: true,
    cik: "0001067983",
    filerName: "BERKSHIRE HATHAWAY INC",
    period: "2026-03-31",
    rows: [{ ...ROW, ticker_verified_date: "2026-09-10" }],
    filings: {},
    page: 0,
  });
  assert.match(html, /verified against the SEC company list on 2026-09-10/);
});
