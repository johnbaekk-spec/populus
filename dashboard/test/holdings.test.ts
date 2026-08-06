/* RUN M2-8 T11/T12 (plan R11, R12, R16) — the holdings and holder surfaces.

   The pagination block is deliberately the longest thing here. This repository
   produced THREE consecutive defects in its other paginator
   (`dashboard/docs/pagination-and-counts.md`), every one of them at or beside a
   PAGE_SIZE multiple, and two of the three were found only by exhaustive
   sweeps — hand-picked fixtures passed all of them. So the boundaries are
   asserted by name (exact multiple, one under, one over, the last page, one
   past the last page) AND swept exhaustively for the partition invariants.

   Everything else pins a property the surfaces are not allowed to lose:
   NULL-honest values, the prior quarter being browsable, the unresolved counts
   beside the holder table, the ban on an unqualified "all", the non-removable
   §5 data_note, and dual dates + lag on every row. */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import path from "node:path";

import {
  HOLDINGS_PAGE_SIZE,
  capRows,
  coverageFromCounters,
  coveragePctText,
  coveragePanelHtml,
  derivePutCallBucket,
  deriveUnitKey,
  diffPeriods,
  filerLinkHtml,
  foldPositions,
  holderCoverage,
  holdingsPageCount,
  holdingsPageSlice,
  holdingsRangeText,
  holdingsFootnotesHtml,
  holdingsTableHtml,
  isAsOfResolved,
  parseFilerShard,
  positionIdentity,
  parseIssuerShard,
  positionDiffHtml,
  projectionAbsentHtml,
  provenanceOf,
  reportingLagDays,
  compareHoldingRows,
  compareHolderRows,
  sortHoldingRows,
  sortHolderRows,
  sumDisclosedValue,
  surfaceHtml,
  unqualifiedAllClaims,
  type FilerHoldingRow,
  type FilerSurfacePayload,
  type FilingDict,
  type HoldersSurfacePayload,
  type IssuerHolderRow,
} from "../src/lib/holdings.ts";
import {
  INSTITUTIONAL_DATA_NOTE_CLAUSES,
  institutionalDataNoteHtml,
  scanBannedWording,
} from "../src/lib/activity.ts";

const PAGE = HOLDINGS_PAGE_SIZE;

/* ---------- fixtures ---------- */

/* Fixtures live in `./fixtures/institutional.ts` — importing them from a test
   file (as css-fold.test.ts used to) registers that file's tests a second time
   in the importing process. */
import {
  FILINGS,
  filerRow,
  filerPayload,
  holdersPayload,
  issuerRow,
  nRows,
} from "./fixtures/institutional.ts";

/* ================================================================ pagination
   Boundaries first, by name. `docs/pagination-and-counts.md`: "PAGE_SIZE
   multiples are the recurring blind spot, because that is where 'page of the
   last row' and 'page after the last row' diverge." */

test("pageCount at the named boundaries: exact multiple, one under, one over", () => {
  assert.equal(holdingsPageCount(0), 0, "empty is 0 pages — never a padded blank page");
  assert.equal(holdingsPageCount(1), 1);
  assert.equal(holdingsPageCount(PAGE - 1), 1, "one under a multiple");
  assert.equal(holdingsPageCount(PAGE), 1, "EXACT multiple is 1 page, not 2");
  assert.equal(holdingsPageCount(PAGE + 1), 2, "one over a multiple");
  assert.equal(holdingsPageCount(2 * PAGE - 1), 2);
  assert.equal(holdingsPageCount(2 * PAGE), 2, "EXACT multiple is 2 pages, not 3");
  assert.equal(holdingsPageCount(2 * PAGE + 1), 3);
});

test("the last page holds the remainder — exactly, at every boundary shape", () => {
  const cases: [number, number][] = [
    [PAGE - 1, PAGE - 1],
    [PAGE, PAGE],
    [PAGE + 1, 1],
    [2 * PAGE - 1, PAGE - 1],
    [2 * PAGE, PAGE],
    [2 * PAGE + 1, 1],
  ];
  for (const [n, lastPageSize] of cases) {
    const rows = nRows(n);
    const last = holdingsPageCount(n) - 1;
    assert.equal(
      holdingsPageSlice(rows, last).length,
      lastPageSize,
      `${n} rows: last page should hold ${lastPageSize}`,
    );
    assert.deepEqual(
      holdingsPageSlice(rows, last + 1),
      [],
      `${n} rows: the page AFTER the last one must be empty, not a wrapped slice`,
    );
  }
});

test("exhaustive sweep: every row on exactly one page, pages concatenate, none empty", () => {
  // Hand-picked fixtures passed all three of the earlier paginator's defects.
  // The sweep spans three multiples plus their neighbours.
  for (let n = 0; n <= 3 * PAGE + 2; n++) {
    const rows = nRows(n);
    const count = holdingsPageCount(n);
    const seen: FilerHoldingRow[] = [];
    for (let page = 0; page < count; page++) {
      const slice = holdingsPageSlice(rows, page);
      assert.ok(slice.length > 0, `n=${n}: page ${page} is inside the range and must not be empty`);
      assert.ok(slice.length <= PAGE, `n=${n}: page ${page} exceeds PAGE_SIZE`);
      seen.push(...slice);
    }
    assert.equal(seen.length, n, `n=${n}: pages reach every row exactly once`);
    assert.deepEqual(
      seen.map((r) => r.position_key),
      rows.map((r) => r.position_key),
      `n=${n}: pages concatenate to the input, in order`,
    );
    assert.equal(count, n === 0 ? 0 : Math.ceil(n / PAGE), `n=${n}: page count`);
  }
});

test("a negative or fractional page index yields nothing, never a wrapped slice", () => {
  const rows = nRows(PAGE + 5);
  assert.deepEqual(holdingsPageSlice(rows, -1), []);
  assert.deepEqual(holdingsPageSlice(rows, Number.NaN), []);
});

test("range text is page-local and never inverts at a multiple", () => {
  assert.equal(holdingsRangeText({ page: 0, rowsOnPage: 0, matched: 0 }), "0 positions");
  assert.equal(
    holdingsRangeText({ page: 0, rowsOnPage: PAGE, matched: 2 * PAGE }),
    `1–${PAGE} of ${(2 * PAGE).toLocaleString("en-US")} positions`,
  );
  assert.equal(
    holdingsRangeText({ page: 1, rowsOnPage: PAGE, matched: 2 * PAGE }),
    `${(PAGE + 1).toLocaleString("en-US")}–${(2 * PAGE).toLocaleString("en-US")} of ${(2 * PAGE).toLocaleString("en-US")} positions`,
    "the exact-multiple last page must read 101–200 of 200, never 201–200",
  );
  assert.equal(
    holdingsRangeText({ page: 2, rowsOnPage: 0, matched: 2 * PAGE }),
    `no positions on this page of ${(2 * PAGE).toLocaleString("en-US")}`,
    "a page past the end describes itself instead of inverting a range",
  );
  // the invariant, swept: hi never precedes lo and never exceeds the total
  for (let n = 0; n <= 2 * PAGE + 1; n++) {
    for (let page = 0; page <= holdingsPageCount(n); page++) {
      const rowsOnPage = holdingsPageSlice(nRows(n), page).length;
      const text = holdingsRangeText({ page, rowsOnPage, matched: n });
      const m = text.match(/^([\d,]+)–([\d,]+) of ([\d,]+)/);
      if (!m) continue;
      const lo = Number(m[1]!.replaceAll(",", ""));
      const hi = Number(m[2]!.replaceAll(",", ""));
      const total = Number(m[3]!.replaceAll(",", ""));
      assert.ok(hi >= lo, `n=${n} page=${page}: "${text}" inverts`);
      assert.ok(hi <= total, `n=${n} page=${page}: "${text}" overruns the total`);
    }
  }
});

test("the rendered table paginates: different rows per page, honest pager state", () => {
  const rows = nRows(2 * PAGE); // exact multiple — the defect-prone shape
  const opts = { cik: "0001067983", filerName: "F", period: "2026-03-31", rows, filings: FILINGS };
  const first = holdingsTableHtml({ ...opts, page: 0 });
  const last = holdingsTableHtml({ ...opts, page: 1 });
  assert.ok(first.includes("FIXTURE ISSUER 00000"));
  assert.ok(!first.includes("FIXTURE ISSUER 00100"), "page 1 stops at the page size");
  assert.ok(last.includes("FIXTURE ISSUER 00100"), "page 2 starts where page 1 stopped");
  assert.ok(last.includes(`page 2 of 2`), "the pager states the true page count");
  assert.ok(
    last.includes('id="holdings-next" data-holdings-page="next" aria-disabled="true"') ||
      /holdings-next[^>]*aria-disabled="true"/.test(last),
    "the last page marks 'next' unavailable rather than offering a blank page",
  );
  assert.ok(/holdings-prev[^>]*aria-disabled="false"/.test(last));
  assert.ok(/holdings-prev[^>]*aria-disabled="true"/.test(first), "page 1 has no previous");
});

test("the diff grain uses the PRODUCER's tokens, and the fallback matches inst_agg", () => {
  /* `serving_filer_rows.put_call_bucket` and `.unit_key` are `TEXT NOT NULL`
     grain discriminators that `agg_qoq_deltas` keys on. They were produced and
     read by NOTHING while this module recomputed the same discriminators
     independently — so a normalization change on the producer side would have
     desynchronized this table's diff grain from the aggregate it references,
     with nothing to notice.

     Mutation guard part 1: ignoring the producer's tokens makes the first case
     fold two rows the producer keeps apart.
     Mutation guard part 2: changing the fallback away from the Python rule
     fails the parsed-source comparison below. */
  const a = filerRow({ position_key: "sid:x", put_call: "PUT", ssh_type: "SH", put_call_bucket: "PUT", unit_key: "SH" });
  const b = filerRow({ position_key: "sid:x", put_call: "PUT", ssh_type: "SH", put_call_bucket: "LONG", unit_key: "SH" });
  assert.notEqual(
    positionIdentity(a),
    positionIdentity(b),
    "the producer says these are different grains; the consumer merged them",
  );

  // The fallback (a shard without the columns) must reproduce inst_agg's rule.
  const py = readFileSync(path.join(REPO_ROOT, "src", "populus", "inst_agg.py"), "utf-8");
  assert.ok(
    /return put_call if put_call in \("PUT", "CALL"\) else "LONG"/.test(py),
    "inst_agg._put_call_bucket changed — re-derive derivePutCallBucket",
  );
  assert.ok(
    /return ssh_prnamt_type if ssh_prnamt_type in \("SH", "PRN"\) else "UNKNOWN"/.test(py),
    "inst_agg._unit_key changed — re-derive deriveUnitKey",
  );
  for (const [input, expected] of [["PUT", "PUT"], ["CALL", "CALL"], ["LONG", "LONG"], [null, "LONG"], ["junk", "LONG"]] as const) {
    assert.equal(derivePutCallBucket(input), expected);
  }
  for (const [input, expected] of [["SH", "SH"], ["PRN", "PRN"], [null, "UNKNOWN"], ["junk", "UNKNOWN"]] as const) {
    assert.equal(deriveUnitKey(input), expected);
  }
});

test("a non-numeric filer key renders as text, never as a link to /filers/NaN/", () => {
  /* `String(Number(key))` renders "NaN" for a non-numeric key, producing
     `/institutional/filers/NaN/` — a URL `getStaticPaths` never emits, i.e. a
     404 dressed as a link. Both surfaces now use one rule.

     Mutation guard: reverting either call site to `String(Number(...))` fails. */
  assert.match(filerLinkHtml("0001067983", "BERKSHIRE"), /href="\/institutional\/filers\/1067983\/"/);
  for (const bad of ["not-a-cik", "", "12abc", " "]) {
    const html = filerLinkHtml(bad, "SOME FILER");
    assert.ok(!html.includes("NaN"), `NaN reached a URL for key ${JSON.stringify(bad)}`);
    assert.ok(!html.includes("<a "), `a broken link was emitted for key ${JSON.stringify(bad)}`);
    assert.ok(html.includes("SOME FILER"), "the filer name must still render (G3)");
  }
});

test("the unqualified-'all' ban reads attribute channels, like its sibling scanner", () => {
  /* A `title=` is spoken by a screen reader and shown on hover, so an
     unqualified "all" inside one is exactly as much of a claim as one in the
     body. This scanner stripped tags FIRST, deleting those channels along with
     the markup, while `activity.scanBannedWording` already read them. Zero live
     hits today — the asymmetry was the defect.

     Mutation guard: removing the attribute pass fails the first case. */
  assert.ok(
    unqualifiedAllClaims(`<p title="all holders of this issuer">x</p>`).length > 0,
    "an unqualified 'all' inside a title= evaded the R12 ban",
  );
  assert.deepEqual(unqualifiedAllClaims(`<p title="all resolved holders">x</p>`), []);
  assert.deepEqual(unqualifiedAllClaims(`<p>all disclosed positions</p>`), []);
});

test("a NULL position_key never folds unrelated holdings into a fabricated total", () => {
  /* QA M2-8 C6 — a published false claim.

     `inst_agg._position_key()` returns NULL for an UNKEYABLE holding (neither a
     resolved security nor a reported CUSIP) — a documented, RETAINED producer
     state (G3), and `inst_serving.py` appends those rows unconditionally, so
     NULLs reach the artifact. The consumer coerced with `str(r.position_key)`,
     and `String(null) === ""`, so every unkeyable row shared the identity
     `"|LONG|SH"`. `foldPositions` keys its map on that identity, KEEPS the first
     row's issuer_name/cusip and SUMS every later row's value into it.

     Measured on the real module: three holdings across three distinct issuers
     folded into one row labelled ISSUER A carrying $750, and the period diff
     reported `increased, deltaValueUsd: +700`. The filer page rendered a dollar
     figure no filer reported, attributed to a named institution and a named
     issuer.

     Mutation guard: restoring `str(r.position_key)` in `parseFilerShard`, or
     removing the unkeyable branch from `positionIdentity`, fails here. */
  const unkeyable = [
    filerRow({ position_key: null, security_id: null, cusip: null, issuer_name: "ISSUER A", value_usd: 100, shares: 1 }),
    filerRow({ position_key: null, security_id: null, cusip: null, issuer_name: "ISSUER B", value_usd: 250, shares: 2 }),
    filerRow({ position_key: null, security_id: null, cusip: null, issuer_name: "ISSUER C", value_usd: 400, shares: 3 }),
  ];
  const folded = foldPositions(unkeyable);

  assert.equal(folded.length, 3, "unkeyable holdings were folded into one position");
  assert.deepEqual(
    folded.map((f) => f.issuer_name).sort(),
    ["ISSUER A", "ISSUER B", "ISSUER C"],
    "an issuer name was lost to another row's identity",
  );
  assert.deepEqual(
    folded.map((f) => f.value_usd).sort((a, b) => (a ?? 0) - (b ?? 0)),
    [100, 250, 400],
    "a value was summed across issuers — a dollar figure no filer reported",
  );
  for (const f of folded) assert.equal(f.rowCount, 1, "a position absorbed another row");
});

test("the shard parser keeps a NULL position_key as NULL", () => {
  const shard = parseFilerShard({
    filings: FILINGS,
    filer_rows: [{ ...filerRow(), position_key: null }],
  });
  assert.equal(shard.rows[0]!.position_key, null, "NULL was coerced to a groupable value");
});

test("unkeyable rows are reported as not-comparable, never as added or absent", () => {
  /* The diff's half of C6. An unkeyable row cannot be matched across quarters,
     so presenting it as "added" (or "absent") would assert a change from the
     mere absence of an identifier. It must surface, with the reason. */
  const current = [
    filerRow({ position_key: null, security_id: null, cusip: null, issuer_name: "ISSUER A", value_usd: 100 }),
    filerRow({ position_key: "sid:sec:keyed", issuer_name: "KEYED CO", value_usd: 500 }),
  ];
  const prior = [
    filerRow({ period: "2025-12-31", position_key: null, security_id: null, cusip: null, issuer_name: "ISSUER A", value_usd: 100 }),
    filerRow({ period: "2025-12-31", position_key: "sid:sec:keyed", issuer_name: "KEYED CO", value_usd: 400 }),
  ];
  const diff = diffPeriods(current, prior, { current: "2026-03-31", prior: "2025-12-31" });

  assert.equal(diff.unkeyableRows, 2, "the unkeyable rows are counted");
  assert.equal(diff.counts.added, 0, "an unkeyable row was reported as an addition");
  assert.equal(diff.counts.removed, 0, "an unkeyable row was reported as an absence");
  assert.equal(diff.counts.increased, 1, "the KEYED position must still diff normally");

  const unkeyed = diff.rows.filter((r) => r.kind === "unclassified");
  assert.equal(unkeyed.length, 2);
  for (const r of unkeyed) {
    assert.equal(r.deltaValueUsd, null, "a delta was computed for an unmatchable row");
    assert.ok(
      r.notes.some((n) => n.includes("cannot be matched across quarters")),
      "the reason must be printed, not left blank",
    );
  }

  const html = positionDiffHtml(diff, 0);
  assert.ok(
    html.includes("cannot be matched across quarters"),
    "the page must state the excluded rows, not silently drop them",
  );
});

test("an unresolved value of 0 from undisclosed rows is stated, never printed as $0", () => {
  /* QA M2-8 M13. `unresolvedValueUsd` sums DISCLOSED values only. With unresolved
     rows that all carry `value_usd IS NULL` the sum is 0, and the tile printed
     "$0" beside a non-zero unresolved-row count — reading as "those rows carry
     no value", which is a claim made from the filings' silence. The honest
     counter (`unresolvedUndisclosedRows`) was computed, populated by both the
     row walk and the SQL, asserted in tests — and rendered by nothing.

     Mutation guard: reverting the tile to a bare `fmtUsd(...)` fails here. */
  const rows = [
    issuerRow({ issuer_key: "entity:cik:0000320193", issuer_key_source: "entity", value_usd: 1_000 }),
    issuerRow({ issuer_key: "cusip6:037833", issuer_key_source: "cusip6", value_usd: null, filer_key: "0000000002" }),
    issuerRow({ issuer_key: "name:UNKNOWN CO", issuer_key_source: "name", value_usd: null, filer_key: "0000000003" }),
  ];
  const coverage = holderCoverage(rows, "2026-03-31");
  assert.equal(coverage.unresolvedRows, 2);
  assert.equal(coverage.unresolvedValueUsd, 0, "the fixture must reach the $0 case");
  assert.equal(coverage.unresolvedUndisclosedRows, 2);

  const html = coveragePanelHtml(coverage, {
    ticker: "AAPL",
    issuerName: "APPLE INC",
    dedupTotalUsd: 1_000,
    shownRows: 1,
  });
  // Assert on the rendered TILE VALUE, not on any "$0" in the page: the honest
  // explanation itself says "this is not $0", and a bare substring test would
  // fail on the fix.
  const tileValues = [...html.matchAll(/<div class="tile-value[^"]*">([^<]*)</g)].map(
    (m) => m[1]!,
  );
  assert.ok(tileValues.length > 0, "no tile values were parsed — the assertion is vacuous");
  assert.ok(
    !tileValues.includes("$0"),
    `a fabricated $0 was printed as a tile value: ${JSON.stringify(tileValues)}`,
  );
  assert.ok(html.includes("not disclosed"), "the tile must say the value is not disclosed");
  assert.ok(
    html.includes("no disclosed value"),
    "the unresolved-undisclosed count must be stated in prose, like its resolved sibling",
  );
});

test("the embed cap MEASURES bytes; it does not estimate them from a row count", () => {
  /* QA M2-8 M8. `HOLDINGS_EMBED_ROW_CAP = 20_000` was justified in its own
     comment as "the page byte budget caps the embed" while never measuring a
     byte. At a measured 316 B/row that is ~6.0 MiB per period and ~12.1 MiB of
     inline JSON in one filer page for the named 37,140-position outlier — in the
     same increment whose sibling module states that bytes are "MEASURED …
     never estimated from a row count" and refuses to exceed 2 MiB.

     Mutation guard: deleting the byte branch from `capRows` fails here, because
     the row cap alone admits all 400 rows. */
  const rows = nRows(400);
  const oneRow = JSON.stringify(rows[0]).length;
  // A byte cap that binds well before the row cap does.
  const byteCap = oneRow * 10 + 2;
  const capped = capRows(rows, 20_000, byteCap);

  assert.equal(capped.total, 400, "the TRUE total survives the cap (G3)");
  assert.ok(capped.rows.length < 400, "the byte cap did not bind at all");
  assert.equal(capped.boundBy, "bytes", "the cap must say which limit bound");
  assert.ok(capped.bytes <= byteCap, `emitted ${capped.bytes} B over a ${byteCap} B cap`);

  // The assertion that separates "cut at the ceiling" from "cut early": the
  // NEXT record must not have fit.
  const nextRow = rows[capped.rows.length]!;
  assert.ok(
    capped.bytes + JSON.stringify(nextRow).length + 1 > byteCap,
    "the cut was early — another row would still have fit inside the byte cap",
  );
});

test("the row cap still binds when it binds first, and says so", () => {
  const capped = capRows(nRows(250), 100, 64 * 1024 * 1024);
  assert.equal(capped.rows.length, 100);
  assert.equal(capped.boundBy, "rows");
});

test("an uncapped list reports no binding limit", () => {
  const capped = capRows(nRows(5), 100, 64 * 1024 * 1024);
  assert.equal(capped.rows.length, 5);
  assert.equal(capped.boundBy, null, "nothing was withheld, so nothing bound");
});

test("an embed cap withholds rows loudly: exact count named, total still true (G3)", () => {
  const rows = nRows(250);
  const capped = capRows(rows, 100);
  assert.equal(capped.rows.length, 100);
  assert.equal(capped.total, 250);
  const html = holdingsTableHtml({
    cik: "0001067983",
    filerName: "F",
    period: "2026-03-31",
    rows: capped.rows,
    filings: FILINGS,
    page: 0,
    totalRows: capped.total,
  });
  assert.ok(html.includes("Truncated by Populus."), "a cut list ends in a named terminus");
  assert.ok(html.includes("150 of this filer's 250 reported rows"), "the exact withheld count");
  const uncapped = holdingsTableHtml({
    cik: "0001067983",
    filerName: "F",
    period: "2026-03-31",
    rows,
    filings: FILINGS,
    page: 0,
  });
  assert.ok(!uncapped.includes("Truncated by Populus."), "no terminus when nothing was cut");
});

/* =========================================================== R11: the filer */

test("both quarters are browsable and the view switch renders the prior one (OD-5)", () => {
  const payload = filerPayload();
  const current = surfaceHtml(payload, { view: "current", page: 0, period: "2026-03-31" });
  const prior = surfaceHtml(payload, { view: "prior", page: 0, period: "2025-12-31" });
  assert.ok(current.includes("Reported positions — 2026-03-31"));
  assert.ok(prior.includes("Reported positions — 2025-12-31"));
  assert.notEqual(current, prior, "the prior quarter is its own render, not the same bytes");
  assert.ok(current.includes('data-holdings-view="prior"'), "the prior quarter is reachable");
  assert.ok(current.includes('data-holdings-view="diff"'), "the comparison is reachable");
});

test("one published quarter offers no prior-quarter view and says why", () => {
  const only = filerPayload({
    periods: ["2026-03-31"],
    prior: null,
    rowsByPeriod: { "2026-03-31": nRows(2) },
    totalsByPeriod: { "2026-03-31": 2 },
  });
  const html = surfaceHtml(only, { view: "current", page: 0, period: "2026-03-31" });
  assert.ok(!html.includes('data-holdings-view="prior"'));
  assert.ok(html.includes("no prior quarter to browse or compare against"));
  const diff = surfaceHtml(only, { view: "diff", page: 0, period: "2026-03-31" });
  assert.ok(diff.includes("nothing to compare it against"), "a comparison needs both sides");
});

test("a quarter the projection does not publish is named, never silently substituted", () => {
  const payload = filerPayload();
  const html = surfaceHtml(payload, { view: "current", page: 0, period: "2024-06-30" });
  assert.ok(html.includes("Positions — 2024-06-30"));
  assert.ok(html.includes("not in this build's holdings projection"));
  assert.ok(html.includes("2025-12-31, 2026-03-31"), "it names what IS published");
  assert.ok(!html.includes("<tbody>"), "no table is drawn under the wrong quarter's heading");
});

test("added / absent / changed classifies each direction against the prior quarter", () => {
  const prior = [
    filerRow({ period: "2025-12-31", position_key: "sid:a", value_usd: 100, shares: 10 }),
    filerRow({ period: "2025-12-31", position_key: "sid:b", value_usd: 200, shares: 20 }),
    filerRow({ period: "2025-12-31", position_key: "sid:c", value_usd: 300, shares: 30 }),
    filerRow({ period: "2025-12-31", position_key: "sid:d", value_usd: 400, shares: 40 }),
  ];
  const current = [
    filerRow({ position_key: "sid:a", value_usd: 150, shares: 15 }), // increased
    filerRow({ position_key: "sid:b", value_usd: 50, shares: 5 }), // decreased
    filerRow({ position_key: "sid:c", value_usd: 300, shares: 30 }), // unchanged
    filerRow({ position_key: "sid:e", value_usd: 500, shares: 50 }), // added
  ]; // sid:d is absent
  const diff = diffPeriods(current, prior, { current: "2026-03-31", prior: "2025-12-31" });
  const byKey = new Map(diff.rows.map((r) => [r.identity.split("|")[0], r]));
  assert.equal(byKey.get("sid:a")!.kind, "increased");
  assert.equal(byKey.get("sid:a")!.deltaValueUsd, 50);
  assert.equal(byKey.get("sid:b")!.kind, "decreased");
  assert.equal(byKey.get("sid:b")!.deltaValueUsd, -150);
  assert.equal(byKey.get("sid:c")!.kind, "unchanged");
  assert.equal(byKey.get("sid:d")!.kind, "removed");
  assert.equal(byKey.get("sid:e")!.kind, "added");
  assert.deepEqual(diff.counts, {
    added: 1,
    removed: 1,
    increased: 1,
    decreased: 1,
    unchanged: 1,
    unclassified: 0,
  });
});

test('"absent" describes two reported lists — no banned trading verb on any surface', () => {
  const diff = diffPeriods(
    [],
    [filerRow({ period: "2025-12-31", position_key: "sid:gone" })],
    { current: "2026-03-31", prior: "2025-12-31" },
  );
  assert.equal(diff.rows[0]!.kind, "removed");
  // The ban itself is `lib/activity.ts`'s (M2-8-outsized-position-spec.md §1.1),
  // imported rather than restated — one list, every institutional surface. A 13F
  // records a position, never a transaction, so even a DENIAL that a position was
  // traded is written without the verb.
  for (const [name, html] of [
    ["filer positions", surfaceHtml(filerPayload(), { view: "current", page: 0, period: "2026-03-31" })],
    ["added/absent/changed", surfaceHtml(filerPayload(), { view: "diff", page: 0, period: "2026-03-31" })],
    ["holders", surfaceHtml(holdersPayload([issuerRow()]), { view: "current", page: 0, period: "2026-03-31" })],
    ["footnotes", holdingsFootnotesHtml()],
  ] as const) {
    assert.deepEqual(scanBannedWording(html), [], `${name} carries banned wording`);
  }
  const diffHtml = surfaceHtml(filerPayload(), { view: "diff", page: 0, period: "2026-03-31" });
  assert.ok(diffHtml.includes("added, absent, changed"));
  assert.ok(
    diffHtml.includes('"absent" describes the two reported lists, never a transaction'),
    "the surface says what absence is, and what it is not",
  );
});

test("a value undisclosed on one side yields NO delta — never a delta against 0", () => {
  const prior = [filerRow({ period: "2025-12-31", position_key: "sid:x", value_usd: 500, shares: 5 })];
  const current = [filerRow({ position_key: "sid:x", value_usd: null, shares: 5 })];
  const diff = diffPeriods(current, prior, { current: "2026-03-31", prior: "2025-12-31" });
  const row = diff.rows[0]!;
  assert.equal(row.deltaValueUsd, null, "no arithmetic against an undisclosed value");
  assert.notEqual(row.kind, "decreased", "an undisclosed value is not a fall to zero");
  assert.ok(row.notes.some((n) => n.includes("value undisclosed on one side")));
});

test("a SH→PRN unit change withholds the share delta rather than subtracting units", () => {
  const prior = [
    filerRow({ period: "2025-12-31", position_key: "sid:u", ssh_type: "SH", shares: 100, value_usd: 10 }),
  ];
  const current = [filerRow({ position_key: "sid:u", ssh_type: "PRN", shares: 100, value_usd: 20 })];
  const diff = diffPeriods(current, prior, { current: "2026-03-31", prior: "2025-12-31" });
  // Different units are different positions by grain, so this is an add + an absence,
  // and neither side may be differenced against the other.
  assert.equal(diff.rows.length, 2);
  assert.deepEqual(
    diff.rows.map((r) => r.kind).sort(),
    ["added", "removed"],
    "grain includes the unit — a cross-unit pair is never subtracted",
  );
  assert.equal(diff.counts.increased + diff.counts.decreased, 0);
});

test("a composed position folds to ONE compared position and loses no reported row (R7/R8)", () => {
  // base filing + NEW-HOLDINGS amendment both report the same position
  const rows = [
    filerRow({ filing_key: "1", value_usd: 600, shares: 6 }),
    filerRow({ filing_key: "2", value_usd: 400, shares: 4 }),
  ];
  const folded = foldPositions(rows);
  assert.equal(folded.length, 1, "one position");
  assert.equal(folded[0]!.rowCount, 2, "composed from two reported rows");
  assert.equal(folded[0]!.value_usd, 1000);
  assert.deepEqual(folded[0]!.filing_keys, ["1", "2"]);
  const html = holdingsTableHtml({
    cik: "0001067983",
    filerName: "F",
    period: "2026-03-31",
    rows,
    filings: FILINGS,
    page: 0,
  });
  const tbody = html.slice(html.indexOf("<tbody>"), html.indexOf("</table>"));
  assert.equal(tbody.match(/<tr>/g)!.length, 2, "the table still shows BOTH reported rows");
});

test("a folded position with any undisclosed component is NULL, not a partial sum", () => {
  const folded = foldPositions([
    filerRow({ filing_key: "1", value_usd: 600 }),
    filerRow({ filing_key: "2", value_usd: null }),
  ]);
  assert.equal(folded[0]!.value_usd, null);
  assert.equal(folded[0]!.value_undisclosed_component, true);
});

test("an undisclosed value renders as undisclosed — never $0", () => {
  const html = holdingsTableHtml({
    cik: "0001067983",
    filerName: "F",
    period: "2026-03-31",
    rows: [filerRow({ value_usd: null, shares: null })],
    filings: FILINGS,
    page: 0,
  });
  const tbody = html.slice(html.indexOf("<tbody>"), html.indexOf("</table>"));
  assert.ok(tbody.includes("undisclosed"));
  assert.ok(!tbody.includes("$0"), "an undisclosed value is never a fabricated zero");
  assert.ok(
    html.includes("no disclosed value in these rows"),
    "a sum over zero disclosed values is stated as an absence, not printed as $0",
  );
  const totals = sumDisclosedValue([filerRow({ value_usd: null }), filerRow({ value_usd: 5 })]);
  assert.equal(totals.disclosedUsd, 5);
  assert.equal(totals.undisclosedRows, 1, "undisclosed rows are counted, not dropped");
});

/* ========================================================== R12: the holders */

test("coverage counts unresolved rows and value, and never fabricates 100%", () => {
  const all = [
    issuerRow({ value_usd: 1_000 }),
    issuerRow({ filer_key: "0000000002", value_usd: 3_000 }),
    issuerRow({ issuer_key: "cusip6:037833", issuer_key_source: "cusip6", value_usd: 40 }),
    issuerRow({ issuer_key: "name:acme", issuer_key_source: "name", value_usd: null }),
  ];
  const cov = holderCoverage(all, "2026-03-31");
  assert.equal(cov.resolvedRows, 2);
  assert.equal(cov.resolvedValueUsd, 4_000);
  assert.equal(cov.unresolvedRows, 2, "cusip6- and name-keyed rows are not as-of-resolved");
  assert.equal(cov.unresolvedValueUsd, 40);
  assert.equal(cov.unresolvedUndisclosedRows, 1);
  assert.equal(cov.coverageBps, Math.round((4000 * 10000) / 4040));
  assert.equal(coveragePctText(cov.coverageBps), "99.01%");
  const noValue = holderCoverage([issuerRow({ value_usd: null })], "2026-03-31");
  assert.equal(noValue.coverageBps, null, "no disclosed denominator ⇒ no ratio, never 100%");
  assert.equal(coveragePctText(null), "n/a");
});

test("as-of resolution reads the entity link, falling back to the key prefix", () => {
  assert.equal(isAsOfResolved({ issuer_key: "entity:cik:1", issuer_key_source: "entity" }), true);
  assert.equal(isAsOfResolved({ issuer_key: "cusip6:037833", issuer_key_source: "cusip6" }), false);
  assert.equal(isAsOfResolved({ issuer_key: "entity:cik:1", issuer_key_source: null }), true);
  assert.equal(isAsOfResolved({ issuer_key: "name:acme", issuer_key_source: null }), false);
});

test("unresolved row count, unresolved value and coverage render BESIDE the table", () => {
  const shown = [issuerRow(), issuerRow({ filer_key: "0000000002", filer_name: "SECOND LLC" })];
  const all = [...shown, issuerRow({ issuer_key: "name:acme", issuer_key_source: "name", value_usd: 7_777 })];
  const html = surfaceHtml(holdersPayload(shown, all), {
    view: "current",
    page: 0,
    period: "2026-03-31",
  });
  assert.ok(html.includes("As-of-resolved holders — 2026-03-31"));
  assert.ok(html.includes("What this list leaves out"));
  assert.ok(html.includes("unresolved rows (build-wide)"), "the unresolved ROW COUNT is a tile");
  assert.ok(html.includes("unresolved value"), "the unresolved VALUE is a tile");
  assert.ok(html.includes("value coverage"), "coverage is a tile");
  assert.ok(html.includes("$7.8K"), "the unresolved value is a real number from the corpus");
  // "beside", not "behind": both live in one grid, and the aside is a sibling
  // of the table's section — no disclosure widget, no second page.
  const gridIdx = html.indexOf('class="entity-grid"');
  assert.ok(gridIdx >= 0 && gridIdx < html.indexOf("What this list leaves out"));
  assert.ok(html.indexOf("<aside") > html.indexOf("<table"));
});

test('the word "all" never appears unqualified on either surface', () => {
  const shown = [issuerRow(), issuerRow({ filer_key: "0000000002", value_usd: null, value_undisclosed_component: true })];
  const holders = surfaceHtml(holdersPayload(shown), { view: "current", page: 0, period: "2026-03-31" });
  const filer = surfaceHtml(filerPayload(), { view: "current", page: 0, period: "2026-03-31" });
  const diff = surfaceHtml(filerPayload(), { view: "diff", page: 0, period: "2026-03-31" });
  for (const [name, html] of [
    ["holders", holders],
    ["filer", filer],
    ["diff", diff],
    ["data note", institutionalDataNoteHtml()],
    ["absent state", projectionAbsentHtml("holders", null)],
  ] as const) {
    assert.deepEqual(
      unqualifiedAllClaims(html),
      [],
      `${name} surface makes an unqualified "all" claim`,
    );
  }
  // the detector is not vacuous: the claim it exists to stop is caught
  assert.ok(unqualifiedAllClaims("<p>Showing all holders of FIXT.</p>").length > 0);
  assert.ok(unqualifiedAllClaims("<p>all institutions that hold it</p>").length > 0);
  assert.deepEqual(unqualifiedAllClaims("<p>all as-of-resolved holders</p>"), []);
  assert.deepEqual(unqualifiedAllClaims("<p>a smaller, all-in metric</p>").length, 0);
});

test("the de-duplicated issuer total is labelled apart and never summed into the column", () => {
  const shown = [issuerRow({ value_usd: 2_000_000 }), issuerRow({ filer_key: "0000000002", value_usd: 3_000_000 })];
  const html = surfaceHtml(holdersPayload(shown), { view: "current", page: 0, period: "2026-03-31" });
  assert.ok(html.includes("De-duplicated issuer total"));
  assert.ok(html.includes("$9.0M"), "the dedup total is printed as its own figure");
  assert.ok(html.includes("never added together"));
  // 2.0M + 3.0M + 9.0M = 14.0M would be the double-counted sum; it must not exist
  assert.ok(!html.includes("$14.0M"), "the two fields are never summed");
  const totals = sumDisclosedValue(shown);
  assert.equal(totals.disclosedUsd, 5_000_000, "sums cover value_usd only");
});

test("a holder row whose value has an undisclosed component shows no total", () => {
  const rows = [issuerRow({ value_usd: null, value_undisclosed_component: true })];
  const html = surfaceHtml(holdersPayload(rows), { view: "current", page: 0, period: "2026-03-31" });
  const tbody = html.slice(html.indexOf("<tbody>"), html.indexOf("</table>"));
  assert.ok(tbody.includes("undisclosed"));
  assert.ok(tbody.includes("no total is shown"));
  assert.ok(!tbody.includes("$0"), "the value cell never falls back to a zero");
});

/* ===================================================== R16: honesty survives */

test("the §5 data_note is the canonical one, with every clause intact", () => {
  // Not a second copy: `lib/activity.ts` owns the M2-CONTRACT §5 clauses and
  // their markup, and this surface renders THAT. A non-removable legal caveat
  // maintained in two files is the definition of drift.
  const note = institutionalDataNoteHtml();
  const required = [
    "LONG positions in Section 13(f) securities",
    "No short positions, no cash, no non-13(f) assets",
    "quarter-end snapshots filed up to 45 days late",
    "era-dependent units",
    "Affiliated managers may report the same position",
    "confidential treatment may be omitted",
  ];
  for (const needle of required) {
    assert.ok(note.includes(needle), `the §5 note lost: ${needle}`);
  }
  assert.equal(INSTITUTIONAL_DATA_NOTE_CLAUSES.length, 6, "every clause is addressable");
  for (const clause of INSTITUTIONAL_DATA_NOTE_CLAUSES) {
    assert.ok(note.includes(`data-note-clause="${clause.id}"`), `${clause.id} is not addressable`);
  }
  assert.ok(note.includes("data-inst-data-note"), "the note is findable on any surface");
});

test("the component renders the data_note on both surfaces and cannot be asked not to", () => {
  const src = readFileSync(
    path.resolve(import.meta.dirname, "..", "src", "components", "HoldingsTable.astro"),
    "utf-8",
  );
  // A CALL SITE in the template half, not a substring anywhere in the file: the
  // literal "institutionalDataNoteHtml()" also appears in a prose comment at the
  // top of this component, so `src.includes(...)` stayed true after the render
  // line was deleted — the deletion broke every institutional page and broke no
  // test. (Presence in the SHIPPED bytes is pinned in test/post/, over real
  // rendered HTML; this pins the source shape.)
  const template = src.split("---").slice(2).join("---");
  assert.match(
    template,
    /set:html=\{\s*institutionalDataNoteHtml\(\)\s*\}/,
    "the component must RENDER the canonical note — a mention in a comment is not a render",
  );
  assert.ok(
    !/data[_-]?note.*\?|hideNote|showNote/i.test(src),
    "no prop can switch the note off (checked over the WHOLE component: the note " +
      "renders in the template half, so scanning only the frontmatter missed it)",
  );
  for (const page of [
    "pages/institutional/filers/[cik].astro",
    "pages/institutional/tickers/[t]/holders.astro",
  ]) {
    const text = readFileSync(path.resolve(import.meta.dirname, "..", "src", page), "utf-8");
    assert.ok(text.includes("<HoldingsTable"), `${page} mounts the surface`);
  }
});

test("dual dates AND the elapsed lag ride on every rendered row", () => {
  const html = holdingsTableHtml({
    cik: "0001067983",
    filerName: "F",
    period: "2026-03-31",
    rows: [filerRow(), filerRow({ filing_key: "2", position_key: "sid:two" })],
    filings: FILINGS,
    page: 0,
  });
  const rows = html.split("<tr>").slice(2); // drop head + header row
  assert.equal(rows.length, 2);
  for (const row of rows) {
    assert.ok(/2026-03-31/.test(row), "period_of_report on the row");
    assert.ok(/filed 2026-0[56]-\d\d/.test(row), "filed_date on the row");
    assert.ok(/class="lag"/.test(row), "the elapsed reporting lag on the row");
  }
  assert.ok(html.includes("+45d"), "quarter-end 2026-03-31 → filed 2026-05-15 is 45 days");
  assert.ok(html.includes("+62d"), "the amendment's own lag, not the base filing's");
});

test("reporting lag is NULL-honest and names an anomaly instead of printing a negative", () => {
  assert.equal(reportingLagDays("2026-03-31", "2026-05-15"), 45);
  assert.equal(reportingLagDays("2026-03-31", null), null);
  assert.equal(reportingLagDays(null, "2026-05-15"), null);
  assert.equal(reportingLagDays("2026-03-31", "2026-03-01"), -30);
  const html = holdingsTableHtml({
    cik: "0001067983",
    filerName: "F",
    period: "2026-03-31",
    rows: [filerRow({ filing_key: "99" })], // key absent from the dictionary
    filings: FILINGS,
    page: 0,
  });
  assert.ok(html.includes("lag —"), "an unknown lag is stated, never printed as 0");
  assert.ok(html.includes("filing not in dictionary"), "a dictionary miss is visible");
  assert.ok(html.includes("2026-03-31"), "the row still carries the quarter it reports");
});

test("a composed position names its composition and uses the latest filed date", () => {
  const prov = provenanceOf(["1", "2"], FILINGS, "2026-03-31");
  assert.equal(prov.filedDate, "2026-06-01", "max filed_date over the composition");
  assert.equal(prov.lagDays, 62);
  assert.equal(prov.filingCount, 2);
  assert.deepEqual(prov.accessions, ["0000000000-26-000001", "0000000000-26-000002"]);
  assert.equal(prov.known, true);
});

test("no honesty content is hidden by the surface's own markup (the fold ban)", () => {
  const surfaces = [
    surfaceHtml(filerPayload(), { view: "current", page: 0, period: "2026-03-31" }),
    surfaceHtml(filerPayload(), { view: "diff", page: 0, period: "2026-03-31" }),
    surfaceHtml(holdersPayload([issuerRow()]), { view: "current", page: 0, period: "2026-03-31" }),
    institutionalDataNoteHtml(),
  ];
  for (const html of surfaces) {
    assert.ok(!/display\s*:\s*none/i.test(html), "no inline display:none");
    assert.ok(!/visibility\s*:\s*hidden/i.test(html), "no inline visibility:hidden");
    assert.ok(!/\shidden(\s|=|>)/.test(html), "no hidden attribute on rendered content");
    assert.ok(!/aria-hidden="true"[^>]*>\s*(filed|quarter|coverage)/i.test(html));
  }
  const component = readFileSync(
    path.resolve(import.meta.dirname, "..", "src", "components", "HoldingsTable.astro"),
    "utf-8",
  );
  assert.ok(!/display\s*:\s*none/i.test(component), "the component ships no display:none rule");
  assert.ok(!/@media/.test(component), "the component adds no breakpoint of its own");
});

test("provenance is a link to the document, and never a substitute for the row", () => {
  const html = holdingsTableHtml({
    cik: "0001067983",
    filerName: "F",
    period: "2026-03-31",
    rows: [filerRow()],
    filings: FILINGS,
    page: 0,
  });
  assert.ok(html.includes("https://www.sec.gov/Archives/edgar/data/1067983/f1.xml"));
  assert.ok(html.includes("<tbody>"), "the row itself is served here");
  const noDoc = holdingsTableHtml({
    cik: "0001067983",
    filerName: "F",
    period: "2026-03-31",
    rows: [filerRow({ filing_key: "4" })],
    filings: { "4": { ...FILINGS["1"]!, doc_url: null } },
    page: 0,
  });
  assert.ok(noDoc.includes("EDGAR"), "a row with no document URL still reaches the filer's filings");
});

/* =================================================== contract + fail-closed */

test("the shard row contract parses NULL-honestly", () => {
  const shard = parseFilerShard({
    filings: { "1": FILINGS["1"] },
    rows: [
      {
        cik: "0001067983",
        period: "2026-03-31",
        filing_key: 1,
        security_id: null,
        cusip: "037833100",
        issuer_name: "X",
        title_of_class: "COM",
        value_usd: null,
        shares: null,
        ssh_type: "SH",
        put_call: "LONG",
        position_key: "cusip:037833100",
        flags: ["issuer_from_cusip6"],
      },
    ],
  });
  assert.equal(shard.rows[0]!.value_usd, null, "NULL stays NULL");
  assert.equal(shard.rows[0]!.shares, null);
  assert.equal(shard.rows[0]!.filing_key, "1", "numeric filing keys normalise to the dict's keys");
  assert.deepEqual(shard.rows[0]!.flags, ["issuer_from_cusip6"]);
  assert.equal(shard.filings["1"]!.filed_date, "2026-05-15");
});

test("an issuer-holder row without filer_key is a HARD failure", () => {
  assert.throws(
    () => parseIssuerShard({ filings: {}, rows: [{ issuer_key: "entity:1", period: "2026-03-31" }] }),
    /filer_key/,
  );
});

test("a holding row carrying change fields is a HARD failure (grains stay separate)", () => {
  for (const field of ["change_kind", "delta_value_usd", "prev_value_usd"]) {
    assert.throws(
      () => parseFilerShard({ filings: {}, rows: [{ ...filerRow(), [field]: "add" }] }),
      new RegExp(field),
      `${field} must not ride on a holding row`,
    );
  }
});

test("a shard with no row array fails loudly instead of rendering an empty book", () => {
  assert.throws(() => parseFilerShard({ filings: {} }), /row array/);
  assert.throws(() => parseIssuerShard({ filings: {} }), /row array/);
});

test("the artifact's own storage forms normalise: INTEGER keys, JSON text, 0/1 booleans", () => {
  // What node:sqlite actually hands back from serving_* — not a hand-shaped object.
  const filer = parseFilerShard({
    filings: { "1": FILINGS["1"] },
    rows: [{ ...filerRow(), filing_key: 1, flags: '["issuer_from_cusip6"]' }],
  });
  assert.equal(filer.rows[0]!.filing_key, "1", "an INTEGER key still finds its dictionary entry");
  assert.deepEqual(filer.rows[0]!.flags, ["issuer_from_cusip6"], "canonical JSON flag text parses");
  const issuer = parseIssuerShard({
    filings: FILINGS,
    rows: [{ ...issuerRow(), filing_keys: "[1,2]", value_undisclosed_component: 0 }],
  });
  assert.deepEqual(issuer.rows[0]!.filing_keys, ["1", "2"], "canonical JSON key array parses");
  assert.equal(issuer.rows[0]!.value_undisclosed_component, false, "0 is false, not truthy text");
  assert.equal(
    provenanceOf(issuer.rows[0]!.filing_keys, FILINGS, "2026-03-31").filedDate,
    "2026-06-01",
    "the composed row resolves through the dictionary it was stored against",
  );
});

/* The producer's own words: "The table and column names here ARE the contract."
   So the queries this surface actually ships are prepared against the producer's
   actual DDL — a rename on either side fails here rather than in production. */

const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..");
const COMPONENT = path.resolve(import.meta.dirname, "..", "src", "components", "HoldingsTable.astro");

function servingSchema(): string {
  const py = readFileSync(path.join(REPO_ROOT, "src", "populus", "inst_serving.py"), "utf-8");
  const m = py.match(/SERVING_SCHEMA = """([\s\S]*?)"""/);
  assert.ok(m, "the producer's DDL is where the dashboard expects it");
  return m![1]!;
}

/** Every template literal in the component that is actually a query over the
    serving artifact — prose in the header quotes table names in backticks too. */
function componentQueries(): string[] {
  const src = readFileSync(COMPONENT, "utf-8");
  return [...src.matchAll(/`([^`]*\bserving_[^`]*)`/g)]
    .map((m) => m[1]!)
    .filter((sql) => /\bSELECT\b/i.test(sql) && /\bFROM\b/i.test(sql));
}

test("every query this surface ships prepares against the producer's real DDL", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(servingSchema());
    const queries = componentQueries();
    assert.ok(queries.length >= 4, `expected the filings, filer, issuer and coverage reads, got ${queries.length}`);
    for (const sql of queries) {
      assert.doesNotThrow(
        () => db.prepare(sql),
        `a column or table this surface reads is not in serving DDL:\n${sql}`,
      );
    }
  } finally {
    db.close();
  }
});

test("the corpus coverage SQL and the row walk agree — one rule, two feeders", () => {
  const rows = [
    issuerRow({ value_usd: 1_000 }),
    issuerRow({ filer_key: "0000000002", value_usd: 3_000 }),
    issuerRow({ filer_key: "0000000003", value_usd: null, value_undisclosed_component: true }),
    issuerRow({ issuer_key: "cusip6:037833", issuer_key_source: "cusip6", value_usd: 40 }),
    issuerRow({ issuer_key: "name:acme", issuer_key_source: "name", value_usd: null }),
    issuerRow({ period: "2025-12-31", value_usd: 999_999 }), // another quarter, excluded
  ];
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(servingSchema());
    const insert = db.prepare(
      `INSERT INTO serving_issuer_holder_rows (issuer_key, issuer_key_source, issuer_name,
         period, filer_key, filer_name, affiliate_group_key, value_usd,
         value_undisclosed_component, security_count, filing_keys, issuer_dedup_total_usd)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const r of rows) {
      insert.run(
        r.issuer_key,
        r.issuer_key_source!,
        r.issuer_name,
        r.period,
        r.filer_key,
        r.filer_name,
        r.affiliate_group_key!,
        r.value_usd,
        r.value_undisclosed_component ? 1 : 0,
        r.security_count,
        JSON.stringify(r.filing_keys),
        r.issuer_dedup_total_usd,
      );
    }
    const sql = componentQueries().find((q) => q.includes("resolved_rows"));
    assert.ok(sql, "the coverage query is still identifiable in the component");
    const c = db.prepare(sql!).get("2026-03-31") as Record<string, unknown>;
    const fromSql = coverageFromCounters(
      {
        resolvedRows: Number(c.resolved_rows ?? 0),
        resolvedValueUsd: Number(c.resolved_value ?? 0),
        resolvedUndisclosedRows: Number(c.resolved_undisclosed ?? 0),
        unresolvedRows: Number(c.unresolved_rows ?? 0),
        unresolvedValueUsd: Number(c.unresolved_value ?? 0),
        unresolvedUndisclosedRows: Number(c.unresolved_undisclosed ?? 0),
      },
      "2026-03-31",
    );
    assert.deepEqual(
      fromSql,
      holderCoverage(rows, "2026-03-31"),
      "the SQL counters and the row walk must describe the same quarter identically",
    );
    assert.equal(fromSql.unresolvedRows, 2);
    assert.equal(fromSql.resolvedUndisclosedRows, 1, "an undisclosed value is counted, not summed");
  } finally {
    db.close();
  }
});

test("coverageFromCounters holds the ratio rule: integer bps, NULL over nothing", () => {
  const c = coverageFromCounters(
    {
      resolvedRows: 2,
      resolvedValueUsd: 9_986,
      resolvedUndisclosedRows: 0,
      unresolvedRows: 1,
      unresolvedValueUsd: 14,
      unresolvedUndisclosedRows: 0,
    },
    "2026-03-31",
  );
  assert.equal(c.coverageBps, 9986, "exact integer basis points, no float in the figure");
  assert.equal(coveragePctText(c.coverageBps), "99.86%");
  assert.equal(
    coverageFromCounters(
      {
        resolvedRows: 3,
        resolvedValueUsd: 0,
        resolvedUndisclosedRows: 3,
        unresolvedRows: 0,
        unresolvedValueUsd: 0,
        unresolvedUndisclosedRows: 0,
      },
      "2026-03-31",
    ).coverageBps,
    null,
    "nothing disclosed to divide by ⇒ no ratio, never a fabricated 100%",
  );
});

test("no projection in this build is an honest absence, not an empty table", () => {
  const html = projectionAbsentHtml("filer", "https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany");
  assert.ok(html.includes("not published in this build"));
  assert.ok(html.includes("SEC EDGAR"));
  assert.ok(!html.includes("<table"), "an absent projection never draws a table");
  assert.ok(!html.includes("reported nothing"));
});

test("display order is deterministic and puts undisclosed values last, not lowest", () => {
  const rows = sortHoldingRows([
    filerRow({ position_key: "sid:1", value_usd: null }),
    filerRow({ position_key: "sid:2", value_usd: 10 }),
    filerRow({ position_key: "sid:3", value_usd: 30 }),
  ]);
  assert.deepEqual(
    rows.map((r) => r.value_usd),
    [30, 10, null],
  );
});

test("the holdings comparator is ANTISYMMETRIC where two identities collide", () => {
  // The previous test here re-sorted an ALREADY-SORTED list and called the
  // unchanged result "stable" — an assertion that cannot fail, because sorting a
  // sorted list is a no-op under any comparator, consistent or not. It therefore
  // never reached the one case that matters (QA M2-8 N6).
  //
  // `sortHoldingRows` calls `positionIdentity` WITHOUT a rowIndex, so two
  // unkeyable rows of one period and grain collapse to the same identity string.
  // The old tail `return positionIdentity(a) < positionIdentity(b) ? -1 : 1`
  // then answered 1 to BOTH cmp(a,b) and cmp(b,a) — the comparator asserting
  // a-after-b and b-after-a at once, leaving the order up to the engine.
  const a = filerRow({ position_key: null, value_usd: 100 });
  const b = filerRow({ position_key: null, value_usd: 100 });
  assert.equal(
    positionIdentity(a),
    positionIdentity(b),
    "fixture is VACUOUS unless the two identities actually collide",
  );

  // Assert on the COMPARATOR, not through `sort`. A first version of this test
  // went through `sortHoldingRows` and the mutation SURVIVED it: V8 binary-
  // insertion-sorts short arrays and preserved input order anyway, so the sort
  // was blind to a comparator claiming a-after-b and b-after-a at once.
  assert.equal(
    Math.sign(compareHoldingRows(a, b)) + Math.sign(compareHoldingRows(b, a)),
    0,
    "cmp(a,b) must be the negation of cmp(b,a) — the sum form avoids -0 !== 0",
  );
  assert.equal(compareHoldingRows(a, b), 0, "colliding identities tie");

  // Stability then carries the artifact's own `ORDER BY period, rowid` through,
  // which is what makes "two builds paginate identically" true.
  assert.equal(sortHoldingRows([a, b])[0], a);
});

test("the holders comparator is ANTISYMMETRIC where two filer keys collide", () => {
  // Same defect, same line shape, in `sortHolderRows` — not named by QA, found
  // by reading the sibling. One row per issuer x period x filer means a duplicate
  // filer_key is unexpected, not impossible, and an unexpected duplicate must not
  // make display order engine-dependent.
  const a = issuerRow({ filer_key: "dup", value_usd: 100 });
  const b = issuerRow({ filer_key: "dup", value_usd: 100 });
  assert.equal(a.filer_name, b.filer_name, "fixture is VACUOUS unless it reaches the key tail");
  assert.equal(
    Math.sign(compareHolderRows(a, b)) + Math.sign(compareHolderRows(b, a)),
    0,
  );
  assert.equal(compareHolderRows(a, b), 0, "colliding filer keys tie");
});

test("both comparators are antisymmetric across every ordered pair of a mixed set", () => {
  // The pairwise sweep the two cases above cannot give: NULL vs disclosed, equal
  // values with different issuers, equal issuers with different keys, and the
  // colliding-identity tail — every ordered pair, both directions.
  const rows = [
    filerRow({ position_key: "sid:1", value_usd: 30 }),
    filerRow({ position_key: "sid:2", value_usd: 10 }),
    filerRow({ position_key: "sid:3", value_usd: null }),
    filerRow({ position_key: "sid:4", value_usd: null }),
    filerRow({ position_key: null, value_usd: 10 }),
    filerRow({ position_key: null, value_usd: 10 }),
    filerRow({ position_key: "sid:5", value_usd: 10, issuer_name: "OTHER CO" }),
  ];
  for (const x of rows) {
    for (const y of rows) {
      assert.equal(
        Math.sign(compareHoldingRows(x, y)) + Math.sign(compareHoldingRows(y, x)),
        0,
        `antisymmetry broken: ${x.position_key}/${x.value_usd} vs ${y.position_key}/${y.value_usd}`,
      );
    }
  }
});
