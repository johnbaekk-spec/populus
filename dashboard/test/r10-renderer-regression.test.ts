/* R10 #12 — removal-failing coverage for the PRODUCTION renderers.

   Cycle 4's F1: the whole-dist gate exempted every `data-paged` table
   unconditionally, and both B34 renderers page — so removing either integration
   left the gate green. Two defences follow from that:

   1. `data-paged` now means "this HTML shows only PART of the collection", so a
      single-page table is judged like any other. That is fixed in the renderers.
   2. These tests invoke the renderers THEMSELVES and assert the caveat appears
      and the row badges do not. They fail if the integration is removed, which
      the helper-level tests could not.

   Fixtures are two rows carrying the same condition — the shape the reviewer
   used to demonstrate the defect. */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  holdersFullTableHtml,
  holdingsTableHtml,
  positionDiffHtml,
} from "../src/lib/holdings.ts";
import type {
  FilerHoldingRow,
  FoldedPosition,
  IssuerHolderRow,
  PositionDiff,
} from "../src/lib/holdings.ts";

const holding = (i: number): FilerHoldingRow => ({
  cik: "0001",
  period: "2026-06-30",
  filing_key: `k${i}`,
  security_id: null,
  cusip: `00000000${i}`,
  issuer_name: `Issuer ${i}`,
  title_of_class: "COM",
  value_usd: 1000 + i,
  shares: 10 + i,
  ssh_type: "SH",
  put_call: null,
  position_key: `p${i}`,
  put_call_bucket: null,
  unit_key: null,
  flags: [],
});


const folded = (identity: string): FoldedPosition => ({
  identity,
  position_key: identity,
  put_call: null,
  ssh_type: "SH",
  issuer_name: `Issuer ${identity}`,
  title_of_class: "COM",
  cusip: null,
  value_usd: null,
  value_undisclosed_component: true,
  shares: null,
  shares_undisclosed_component: true,
});

const badgeCount = (html: string, label: string): number =>
  html.split(`<span class="flag dashed">${label}</span>`).length - 1;

test("B34/B35: holdings — a provenance miss on EVERY row is stated once, not per row", () => {
  /* An empty FilingDict means no row resolves, so every row renders the
     "filing not in dictionary" badge — the universal case. */
  const html = holdingsTableHtml({
    cik: "0001",
    filerName: "Test Filer",
    period: "2026-06-30",
    rows: [holding(1), holding(2)],
    filings: {} as never,
    page: 0,
  });

  assert.ok(html.includes("table-caveat"), "the table states the condition once");
  assert.ok(
    html.includes("filing not in dictionary"),
    "and names it — hoisting must not delete the fact",
  );
  assert.equal(
    badgeCount(html, "filing not in dictionary"),
    0,
    "and no row repeats the badge",
  );
  assert.ok(
    !/\bdata-paged=/.test(html),
    "a single-page table is NOT exempt from the whole-dist gate — cycle 4 F1",
  );
});

test("B34/B35: position diff — a note on EVERY row is stated once, not per row", () => {
  const NOTE = "value undisclosed both sides";
  const row = (identity: string) => ({
    identity,
    kind: "unclassified" as const,
    current: null,
    prior: folded(identity),
    deltaValueUsd: null,
    deltaShares: null,
    notes: [NOTE],
  });
  const diff: PositionDiff = {
    current: "2026-06-30",
    prior: "2026-03-31",
    rows: [row("a"), row("b")],
    counts: { added: 0, removed: 0, increased: 0, decreased: 0, unchanged: 0, unclassified: 2 },
    unkeyableRows: 0,
  };

  const html = positionDiffHtml(diff, 0);
  assert.ok(html.includes("table-caveat"), "the table states the note once");
  assert.ok(html.includes(NOTE), "and names it verbatim — it is the producer's own text");
  assert.equal(badgeCount(html, NOTE), 0, "and no row repeats the badge");
  assert.ok(!/\bdata-paged=/.test(html), "single page ⇒ not exempt");
});

test("B34: a note on only SOME rows still renders per row", () => {
  /* The other direction: hoisting must not swallow a condition that
     distinguishes rows, because then the rows that differ lose their marker. */
  const diff: PositionDiff = {
    current: "2026-06-30",
    prior: "2026-03-31",
    rows: [
      { identity: "a", kind: "unclassified" as const, current: null, prior: folded("a"),
        deltaValueUsd: null, deltaShares: null, notes: ["only this row"] },
      { identity: "b", kind: "unclassified" as const, current: null, prior: folded("b"),
        deltaValueUsd: null, deltaShares: null, notes: [] },
    ],
    counts: { added: 0, removed: 0, increased: 0, decreased: 0, unchanged: 0, unclassified: 2 },
    unkeyableRows: 0,
  };
  const html = positionDiffHtml(diff, 0);
  assert.ok(!html.includes("table-caveat"), "not universal, so no table caveat");
  assert.equal(badgeCount(html, "only this row"), 1, "the distinguishing badge stays on its row");
});

const holder = (i: number): IssuerHolderRow => ({
  issuer_key: "ik",
  issuer_key_source: "cusip",
  issuer_name: "Issuer",
  period: "2026-06-30",
  filer_key: `f${i}`,
  filer_name: `Filer ${i}`,
  affiliate_group_key: null,
  value_usd: 1000 + i,
  value_undisclosed_component: false,
  security_count: 1,
  filing_keys: [`k${i}`],
  issuer_dedup_total_usd: null,
});

test("B34: holdersFullTableHtml — the THIRD provenanceCellHtml consumer", () => {
  /* Cycle 4 round 2: this table was still repeating the badge. It is the reason
     the fix had to be "every consumer of the badge source", not "the two the
     finding named" — and an IssuerHolderRow has no `flags`, so the provenance
     miss is its ONLY badge source. */
  const single = holdersFullTableHtml({
    issuerName: "Apple Inc",
    ticker: "AAPL",
    period: "2026-06-30",
    rows: [holder(1), holder(2)],
    filings: {} as never,
    page: 0,
  });
  assert.ok(single.includes("table-caveat"), "stated once");
  assert.ok(single.includes("filing not in dictionary"), "and named");
  assert.equal(badgeCount(single, "filing not in dictionary"), 0, "no row repeats it");
  assert.ok(!/\bdata-paged=/.test(single), "one page ⇒ not exempt from the gate");

  /* the partial-page case the finding also asked for */
  const many = holdersFullTableHtml({
    issuerName: "Apple Inc",
    ticker: "AAPL",
    period: "2026-06-30",
    rows: Array.from({ length: 101 }, (_, i) => holder(i)),
    filings: {} as never,
    page: 0,
  });
  assert.ok(many.includes("table-caveat"), "stated once across a paged table too");
  assert.equal(badgeCount(many, "filing not in dictionary"), 0, "and no row repeats it");
  assert.ok(/\bdata-paged="1"/.test(many), "a genuinely partial page IS marked");
});
