/* C-4 rankings: rollup semantics (grouping, unjoined filers, exact counts
   with denominators, date-anomaly exclusion) and the ranking body (structural
   undisclosed bucket AFTER ranked rows, overlap marker, strict-sign direction
   words, terminus naming the render bound, no-ticker disclosure). */

import { test } from "node:test";
import assert from "node:assert/strict";

import { leadersRollup, congressTickersRollup } from "../src/lib/derive.ts";
import { congressRankingSection, CONGRESS_ROOTS, type BuildStamps } from "../src/lib/ui.ts";
import type { TxnRow, RenderCtx } from "../src/lib/format.ts";

const NOW = "2026-08-12";
const stamps: BuildStamps = { buildId: "t.1", generatedAt: "2026-08-12 00:00 UTC", generatedAtDate: NOW };
const ctx: RenderCtx = { watched: new Set() };

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

test("leadersRollup: groups by member, keeps unjoined filers, counts carry denominators", () => {
  const rows = [
    txn(),
    txn({ side: "sale", late: 1 }),
    txn({ side: "exchange", late: null }),
    txn({ bioguide: null, name: "Printed Name" }),
    // outside the 12m trade-date window — excluded
    txn({ filed: "2020-01-01", traded: "2020-01-01" }),
    // date anomaly — excluded before windowing
    txn({ traded: "3031-04-30", flags: ["date_anomaly"] }),
  ];
  const rollup = leadersRollup(rows, NOW, { range: "12m", basis: "traded" });
  assert.equal(rollup.dateAnomalies, 1);
  assert.equal(rollup.rows.length, 2);
  const member = rollup.rows.find((r) => r.id === "T000001")!;
  assert.equal(member.txns, 3);
  assert.equal(member.buys, 1);
  assert.equal(member.sells, 1);
  assert.equal(member.excludedSides, 1); // the exchange row: counted, not summed
  assert.equal(member.late, 1);
  assert.equal(member.lateDenom, 2); // the exchange row has late: null — out of the denominator
  const raw = rollup.rows.find((r) => r.id === "raw:Printed Name");
  assert.ok(raw, "unjoined filers are grouped by printed name, never dropped");
});

test("congressTickersRollup: no-ticker rows are counted and stated, never silently dropped", () => {
  const rows = [txn(), txn({ ticker: null }), txn({ ticker: null })];
  const rollup = congressTickersRollup(rows, NOW, { range: "12m", basis: "traded" });
  assert.equal(rollup.noTickerRows, 2);
  assert.deepEqual(rollup.rows.map((r) => r.id), ["WMB"]);
});

/** The member net-flow section as /congress/ renders it: two roots, compact
    slice, sortable headers. `compact` is passed explicitly so a fixture-sized
    table is not silently governed by the production slice. */
function section(
  kind: "leaders" | "tickers",
  rollup: Parameters<typeof congressRankingSection>[1],
  opts: Partial<Parameters<typeof congressRankingSection>[4]> = {},
): string {
  return congressRankingSection(kind, rollup, stamps, ctx, {
    rootId: kind === "leaders" ? CONGRESS_ROOTS.membersRanked : CONGRESS_ROOTS.momentum,
    undisclosedRootId: kind === "leaders" ? CONGRESS_ROOTS.membersUndisclosed : undefined,
    heading: kind === "leaders" ? "Member net disclosed flow" : "Ticker momentum",
    sectionId: kind === "leaders" ? "members-section" : "momentum-section",
    ...opts,
  });
}

test("ranking body: undisclosed bucket renders labeled and AFTER the ranked table", () => {
  const rows = [
    txn({ bioguide: "A000001", name: "Alpha" }),
    txn({ bioguide: "B000002", name: "Beta", low: null, high: null }), // wholly undisclosed
  ];
  const html = section("leaders", leadersRollup(rows, NOW, { range: "12m", basis: "traded" }));
  const bucketAt = html.indexOf("Not rankable — amounts wholly undisclosed");
  const rankedAt = html.indexOf("Alpha");
  assert.ok(bucketAt > -1, "the bucket must exist");
  assert.ok(rankedAt > -1 && rankedAt < bucketAt, "bucket renders after ranked rows");
  assert.match(html, /never sorted\s+to the bottom as if small/);
});

test("ranking body: direction words only on a strict sign", () => {
  const acc = [txn({ bioguide: "A000001", name: "Alpha", low: 1001, high: 15000 })];
  const htmlAcc = section("leaders", leadersRollup(acc, NOW, { range: "12m", basis: "traded" }));
  assert.match(htmlAcc, /net accumulation/); // net = [1000, 15000], l > 0

  // Purchases [0,15000] (an "Under $15K" capped row): net touches zero → no word.
  const touching = [txn({ bioguide: "A000001", name: "Alpha", low: null, high: 15000 })];
  const htmlTouch = section("leaders", leadersRollup(touching, NOW, { range: "12m", basis: "traded" }));
  assert.doesNotMatch(htmlTouch, /net accumulation|net disposal/);
});

test("ranking body: overlap marker when adjacent ranked intervals overlap", () => {
  const rows = [
    txn({ bioguide: "A000001", name: "Alpha", low: 1001, high: 50000 }),
    txn({ bioguide: "B000002", name: "Beta", low: 1001, high: 15000 }),
  ];
  const html = section("leaders", leadersRollup(rows, NOW, { range: "12m", basis: "traded" }));
  /* RETARGETED — RUN SURFACES-LEGIBILITY, SL-R7 (LD6).
     The ≈ marker used to be an <a> into `#<section>-footnotes`. R7 deletes that
     block and moves its text onto the Net column's header note, so the marker
     is now a plain span — a link into a removed id would be a broken internal
     link. The PROPERTY is unchanged and is asserted in both halves: the marker
     is still rendered on the overlapping row, and its text is still reachable
     in the same body. Only the wrapper moved. */
  assert.match(html, /<span class="fn-ref">≈<\/span>/);
  assert.match(html, /incomparable<\/strong>, not tied/);
});

test("ranking body: the render bound names its author (terminus), counts survive", () => {
  const rows = [
    txn({ bioguide: "A000001", name: "Alpha", ticker: "AAA" }),
    txn({ bioguide: "B000002", name: "Beta", ticker: "BBB", low: 15001, high: 50000 }),
  ];
  const html = section("tickers", congressTickersRollup(rows, NOW, { range: "12m", basis: "traded" }), {
    compact: 1,
  });
  assert.match(html, /Truncated by Public Filings\./);
  assert.match(html, /1 further ranked\s+tickers/);
  // R7: the bound is stated AND the control offering to lift it is present.
  assert.match(html, /Show all 2 tickers \(1 more\)/);
});

test("R7: the disclosure control is OMITTED when the table does not exceed the slice", () => {
  // An inert control that expands to the same rows would assert there is more
  // to see when there is not.
  const rows = [txn({ bioguide: "A000001", name: "Alpha", ticker: "AAA" })];
  const html = section("tickers", congressTickersRollup(rows, NOW, { range: "12m", basis: "traded" }), {
    compact: 10,
  });
  // F16: a hidden SHELL is rendered so a later state that DOES hide rows has
  // a control to reveal them. R7's omission rule is about what the READER
  // SEES, so the assertion is that nothing is offered — not that nothing exists.
  assert.match(html, /class="compact-disclosure"[^>]*hidden>/, "the shell is present but hidden");
  assert.doesNotMatch(html, /Show all/, "no offer is made to the reader");
  // F16: the terminus is a hidden SHELL now, for the same reason the control
  // is — so a later range change can reveal both together. The reader is shown
  // neither, which is what the omission rule is actually about.
  assert.match(html, /class="terminus"[^>]*hidden>/, "the terminus shell is present but hidden");
});

test("R18: the member ranking renders TWO tables with two distinct render roots", () => {
  const rows = [
    txn({ bioguide: "A000001", name: "Alpha" }),
    txn({ bioguide: "B000002", name: "Beta", low: null, high: null }),
  ];
  const html = section("leaders", leadersRollup(rows, NOW, { range: "12m", basis: "traded" }));
  assert.ok(html.includes(`id="${CONGRESS_ROOTS.membersRanked}"`), "the ranked root exists");
  assert.ok(
    html.includes(`id="${CONGRESS_ROOTS.membersUndisclosed}"`),
    "the wholly-undisclosed bucket has its OWN root, so no sort can reach it",
  );
  assert.equal((html.match(/<tbody /g) ?? []).length, 2, "exactly two roots, never one merged table");
});

test("R5: every sortable column carries a key and a button; the unsortable one states why", () => {
  const html = section("leaders", leadersRollup([txn()], NOW, { range: "12m", basis: "traded" }));
  for (const key of ["name", "txns", "buys", "sells", "purchases", "sales", "net", "late"]) {
    assert.ok(
      html.includes(`data-congress-sort="${key}"`),
      `${key} must be sortable through the header`,
    );
  }
  // The rank column is deliberately unsortable and says so in VISIBLE text,
  // not a title attribute.
  /* RETARGETED by RUN SURFACES-LEGIBILITY (SL-R5/SL-R2b), same commit as the
     change that invalidated it. The property is UNCHANGED — an unsortable
     column must still state why it cannot be sorted — but the channel moved
     from a `.col-why` span to a note panel, which is reachable by touch,
     keyboard and print as the span was not. Asserting the TEXT, not the
     wrapper, is what keeps this a guard rather than a spelling check. */
  assert.match(html, /class="note-pop"[^>]*>the rank number is produced by the active sort/);
  assert.doesNotMatch(html, /<select[^>]*id="filter-sort"/, "the sort select is gone");
});

test("R2: only the momentum section renders the range and basis control", () => {
  const rollup = congressTickersRollup([txn()], NOW, { range: "7d", basis: "traded" });
  const withControls = section("tickers", rollup, { controls: true });
  assert.match(withControls, /data-range="7d"[^>]*aria-pressed="true"/);
  assert.match(withControls, /data-basis="traded"[^>]*aria-pressed="true"/);
  // The window is STATED, not merely implied by the control position.
  assert.match(withControls, /trailing 7 days by trade date · 2026-08-06 to 2026-08-12 inclusive/);
  const without = section("leaders", leadersRollup([txn()], NOW, { range: "12m", basis: "traded" }));
  assert.doesNotMatch(without, /data-range=/);
});

/* R1: `congressTabs` is DELETED, not merely unused — the sub-tab nav is the
   navigation the single page exists to remove. `test/pages-render.test.ts`
   asserts no page emits `.ctabs` markup; asserting its absence from the module
   here would only restate the import error this file would already throw. */
