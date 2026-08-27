/* RUN M2-8 T13 (plan R13, R16) — the activity feed's contract.

   What this file pins, in order of what would hurt most if it broke:

   1. ONE byte-aware pagination rule, with the page boundaries asserted EXACTLY:
      at the record limit, at the byte ceiling, and at the 64-shard cap. Byte
      counts are read off the body that is actually emitted — the estimate/measure
      gap is the whole point of the rule, so no test may accept an estimate.
   2. No record is ever lost or duplicated across the whole ordered set, and the
      ordering itself is the deterministic total order with NULL deltas LAST.
   3. Every emitted row carries issuer, period_of_report, filed_date and the
      elapsed lag — resolved through the filings dictionary, never invented.
   4. Truncation is stated: dropped count + the boundary record's sort key, in
      every shard body and in the stats fragment.
   5. NULL-honesty and the R16 wording ban, both asserted rather than trusted. */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import {
  ACTIVITY_SHARDS_MAX,
  ACTIVITY_TABLE,
  BANNED_WORDING,
  FILINGS_TABLE,
  INSTITUTIONAL_DATA_NOTE_CLAUSES,
  PAGE_BYTE_LIMIT,
  PAGE_RECORD_LIMIT,
  activityFeedHtml,
  activityStatsFragment,
  compareActivity,
  institutionalDataNoteHtml,
  loadActivityFeed,
  paginateActivity,
  reportingLagDays,
  resolveActivityRecord,
  resolveFiledDate,
  scanBannedWording,
  serializeFeedRecord,
  sortActivity,
  sortKeyOf,
  type ActivityFeed,
  type ActivityRecord,
  type FilingDictionary,
} from "../src/lib/activity.ts";
import { provenanceOf } from "../src/lib/holdings.ts";

const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..");

/* ---------- fixtures ---------- */

const FILINGS: FilingDictionary = {
  "1": {
    accession: "0000000000-26-000001",
    submission_type: "13F-HR",
    period_of_report: "2026-03-31",
    filed_date: "2026-05-10",
    doc_url: "https://www.sec.gov/Archives/1",
    source: "sec-edgar",
  },
  "2": {
    accession: "0000000000-26-000002",
    submission_type: "13F-HR/A",
    period_of_report: "2026-03-31",
    filed_date: "2026-05-20",
    doc_url: "https://www.sec.gov/Archives/2",
    source: "sec-edgar",
  },
  "3": {
    // same filed_date as 2 — the accession-ascending tie-break decides the cite
    accession: "0000000000-26-000000",
    submission_type: "13F-HR/A",
    period_of_report: "2026-03-31",
    filed_date: "2026-05-20",
    doc_url: null,
    source: "sec-edgar",
  },
  "4": {
    accession: "0000000000-25-000004",
    submission_type: "13F-HR",
    period_of_report: "2025-12-31",
    filed_date: "2026-08-01",
    doc_url: null,
    source: "sec-edgar",
  },
};

function rec(over: Partial<ActivityRecord> = {}): ActivityRecord {
  return {
    cik: "0001067983",
    filer_name: "FIXTURE HOLDINGS LLC",
    issuer_key: "entity:cik:0000320193",
    issuer_name: "APPLE INC",
    position_key: "sid:aapl",
    put_call: "LONG",
    ssh_prnamt_type: "SH",
    change_kind: "add",
    curr_period: "2026-03-31",
    prev_period: "2025-12-31",
    prev_value_usd: 1_000,
    curr_value_usd: 3_000,
    delta_value_usd: 2_000,
    prev_shares: 10,
    curr_shares: 30,
    delta_shares: 20,
    filing_keys: [1],
    prior_filing_keys: [],
    current_filing_keys: [],
    flags: [],
    ...over,
  };
}

/** n records that differ only in the sort key's tail, so the ordering is
    predictable and every one is distinguishable. */
function series(n: number, over: Partial<ActivityRecord> = {}): ActivityRecord[] {
  return Array.from({ length: n }, (_, i) =>
    rec({
      cik: `000${String(1_000_000 + i)}`,
      position_key: `sid:${String(i).padStart(6, "0")}`,
      delta_value_usd: 1_000_000 - i,
      ...over,
    }),
  );
}

function idOf(r: ActivityRecord): string {
  return `${r.cik}|${r.position_key}|${r.put_call}|${r.ssh_prnamt_type}`;
}

/* ---------- 1. the mirrored constants ---------- */

/** Evaluate the trivial integer expressions inst_budget.py uses (`2_000`,
    `2 * 1024 * 1024`). Not a Python evaluator — a two-operator arithmetic reader
    that refuses anything else rather than guessing. */
function pyInt(source: string, name: string): number {
  const m = new RegExp(`^${name}\\s*=\\s*([^#\\n]+)`, "m").exec(source);
  assert.ok(m, `${name} is defined in inst_budget.py`);
  const rhs = m![1]!.replace(/[_\s]/g, "");
  assert.match(rhs, /^[0-9*+]+$/, `${name} is a plain integer expression`);
  return rhs
    .split("+")
    .map((term) => term.split("*").reduce((a, b) => a * Number(b), 1))
    .reduce((a, b) => a + b, 0);
}

test("the pagination constants MIRROR src/populus/inst_budget.py — no second source", () => {
  const py = readFileSync(path.join(REPO_ROOT, "src", "populus", "inst_budget.py"), "utf-8");
  assert.equal(PAGE_RECORD_LIMIT, pyInt(py, "PAGE_RECORD_LIMIT"));
  assert.equal(PAGE_BYTE_LIMIT, pyInt(py, "PAGE_BYTE_LIMIT"));
  assert.equal(ACTIVITY_SHARDS_MAX, pyInt(py, "ACTIVITY_SHARDS_MAX"));
  // and the values the plan states, so a coordinated drift is caught too
  assert.equal(PAGE_RECORD_LIMIT, 2_000);
  assert.equal(PAGE_BYTE_LIMIT, 2 * 1024 * 1024);
  assert.equal(ACTIVITY_SHARDS_MAX, 64);
});

/* ---------- 2. the total order ---------- */

test("total order: abs(delta) desc, NULL deltas LAST, then cik/position/put_call/unit", () => {
  const input: ActivityRecord[] = [
    rec({ cik: "0000000002", position_key: "sid:b", delta_value_usd: null }),
    rec({ cik: "0000000001", position_key: "sid:a", delta_value_usd: 5 }),
    rec({ cik: "0000000001", position_key: "sid:a", delta_value_usd: null }),
    rec({ cik: "0000000003", position_key: "sid:c", delta_value_usd: -900 }),
    rec({ cik: "0000000004", position_key: "sid:d", delta_value_usd: 900 }),
    rec({ cik: "0000000001", position_key: "sid:e", delta_value_usd: 900 }),
    // full-key ties: same |delta| and cik, split by position, put_call, unit
    rec({ cik: "0000000005", position_key: "sid:z", put_call: "PUT", delta_value_usd: 10 }),
    rec({ cik: "0000000005", position_key: "sid:z", put_call: "CALL", delta_value_usd: 10 }),
    rec({
      cik: "0000000005",
      position_key: "sid:z",
      put_call: "CALL",
      ssh_prnamt_type: "PRN",
      delta_value_usd: 10,
    }),
  ];
  const ordered = sortActivity(input).map((r) => [r.cik, r.position_key, r.put_call, r.ssh_prnamt_type, r.delta_value_usd]);
  assert.deepEqual(ordered, [
    // |−900| ranks with |900|; cik breaks the three-way tie
    ["0000000001", "sid:e", "LONG", "SH", 900],
    ["0000000003", "sid:c", "LONG", "SH", -900],
    ["0000000004", "sid:d", "LONG", "SH", 900],
    ["0000000005", "sid:z", "CALL", "PRN", 10],
    ["0000000005", "sid:z", "CALL", "SH", 10],
    ["0000000005", "sid:z", "PUT", "SH", 10],
    ["0000000001", "sid:a", "LONG", "SH", 5],
    // NULL deltas last, still deterministically ordered among themselves
    ["0000000001", "sid:a", "LONG", "SH", null],
    ["0000000002", "sid:b", "LONG", "SH", null],
  ]);
});

test("a NULL delta never outranks a number, however small the number", () => {
  const nul = rec({ cik: "0000000001", delta_value_usd: null });
  const one = rec({ cik: "0000000009", delta_value_usd: 1 });
  assert.ok(compareActivity(nul, one) > 0, "null sorts after 1");
  assert.ok(compareActivity(one, nul) < 0, "and the comparison is antisymmetric");
});

test("sorting is deterministic and does not mutate its input", () => {
  const input = series(200);
  const shuffled = [...input].sort(() => (Math.random() < 0.5 ? -1 : 1));
  const a = sortActivity(shuffled).map(idOf);
  const b = sortActivity([...shuffled].reverse()).map(idOf);
  assert.deepEqual(a, b, "two orderings of one set agree");
  assert.equal(shuffled.length, input.length, "input untouched");
});

/* ---------- 3. page boundaries ---------- */

function parseBody(body: string): Record<string, any> {
  return JSON.parse(body) as Record<string, any>;
}

test("the RECORD limit binds at exactly 2,000 — pages are [2000, 2000, 1]", () => {
  const records = series(4_001);
  const p = paginateActivity(records, FILINGS);
  assert.deepEqual(
    p.pages.map((page) => page.records.length),
    [PAGE_RECORD_LIMIT, PAGE_RECORD_LIMIT, 1],
  );
  // the record rule bound here, not the byte rule
  for (const page of p.pages) {
    assert.ok(page.bytes < PAGE_BYTE_LIMIT, `page ${page.page} stayed under the byte ceiling`);
  }
  // no record lost, none duplicated, order preserved across the page seam
  const flat = p.pages.flatMap((page) => page.records.map(idOf));
  assert.deepEqual(flat, sortActivity(records).map(idOf));
  assert.equal(new Set(flat).size, records.length);
  assert.equal(p.emitted_records, records.length);
  assert.equal(p.truncation, null);
});

test("the BYTE ceiling binds first when rows are fat, and the page is filled to it", () => {
  // ~4 KB per record; one shared filing key so the page's only growth is records
  const fat = series(1_200, { issuer_name: "APPLE INC ".repeat(350) });
  const p = paginateActivity(fat, FILINGS);

  assert.ok(p.pages.length > 1, "the byte ceiling closed at least one page");
  for (const page of p.pages) {
    assert.ok(
      page.records.length < PAGE_RECORD_LIMIT,
      "the byte rule bound before the record rule",
    );
    assert.ok(page.bytes <= PAGE_BYTE_LIMIT, `page ${page.page} is within 2 MiB`);
  }

  // THE boundary assertion: the next record would not have fit. A page cut early
  // would still satisfy "<= 2 MiB" — this is what proves the cut is at the ceiling.
  for (let i = 0; i < p.pages.length - 1; i++) {
    const page = p.pages[i]!;
    const next = p.pages[i + 1]!.records[0]!;
    const wouldBe = page.bytes + 1 + Buffer.byteLength(serializeFeedRecord(next));
    assert.ok(
      wouldBe > PAGE_BYTE_LIMIT,
      `page ${i} closed at ${page.bytes} bytes but the next record (${wouldBe}) would have fit`,
    );
  }

  const flat = p.pages.flatMap((page) => page.records.map(idOf));
  assert.deepEqual(flat, sortActivity(fat).map(idOf), "no record lost at a byte boundary");
});

test("page bytes are MEASURED on the emitted body, never estimated", () => {
  const p = paginateActivity(series(50), FILINGS);
  for (const page of p.pages) {
    assert.equal(page.bytes, Buffer.byteLength(page.body), "bytes == byteLength(body)");
    const parsed = parseBody(page.body);
    assert.equal(parsed.record_count, page.records.length);
    assert.equal(parsed.records.length, page.records.length);
    assert.equal(parsed.page, page.page);
    assert.equal(parsed.page_count, p.pages.length);
  }
});

test("a single record larger than the whole ceiling occupies its own page (no no-candidate case)", () => {
  const records = series(5);
  const p = paginateActivity(records, FILINGS, { byteLimit: 10 });
  assert.equal(p.pages.length, 5);
  for (const page of p.pages) assert.equal(page.records.length, 1);
  assert.equal(p.emitted_records, 5, "nothing was dropped and the walk terminated");
  assert.equal(p.truncation, null);
});

test("an empty projection still emits page 0, and page 0 NAMES the absence", () => {
  const p = paginateActivity([], {}, { absent: "serving-artifact-missing" });
  assert.equal(p.pages.length, 1);
  const parsed = parseBody(p.pages[0]!.body);
  assert.equal(parsed.record_count, 0);
  assert.equal(parsed.absent, "serving-artifact-missing");
  assert.equal(parsed.truncated, false);
});

/* ---------- 4. truncation at the real 64-shard cap ---------- */

test("beyond 64 shards the remainder is TRUNCATED, with the dropped count and the boundary key", () => {
  const records = series(70);
  // one record per page (tiny byte ceiling) exercises the REAL shard cap cheaply
  const p = paginateActivity(records, FILINGS, { byteLimit: 10 });
  const ordered = sortActivity(records);

  assert.equal(p.pages.length, ACTIVITY_SHARDS_MAX, "the walk stopped at 64 shards");
  assert.equal(p.emitted_records, ACTIVITY_SHARDS_MAX);
  assert.equal(p.total_records, 70);
  assert.ok(p.truncation);
  assert.equal(p.truncation!.dropped_records, 70 - ACTIVITY_SHARDS_MAX);
  assert.deepEqual(
    p.truncation!.boundary_sort_key,
    sortKeyOf(ordered[ACTIVITY_SHARDS_MAX]!),
    "the boundary is the FIRST DROPPED record's sort key",
  );

  // stated in EVERY shard body — a reader who fetches shard 0 learns the set is cut
  for (const page of p.pages) {
    const parsed = parseBody(page.body);
    assert.equal(parsed.truncated, true);
    assert.equal(parsed.truncation.dropped_records, 6);
    assert.deepEqual(parsed.truncation.boundary_sort_key, p.truncation!.boundary_sort_key);
  }

  // and in the fragment the producer copies into stats.json
  const stats = activityStatsFragment(p);
  assert.equal(stats.activity_truncated, true);
  assert.equal(stats.activity_dropped_records, 6);
  assert.deepEqual(stats.activity_boundary_sort_key, p.truncation!.boundary_sort_key);
  assert.equal(stats.activity_shards, ACTIVITY_SHARDS_MAX);
  assert.equal(stats.activity_records_total, 70);
  assert.equal(stats.activity_records_emitted, 64);
});

test("truncation is STATED on the page — never a silent cut", () => {
  const records = series(70);
  const p = paginateActivity(records, FILINGS, { byteLimit: 10 });
  const html = activityFeedHtml({ present: true, reason: null, filings: FILINGS, pagination: p });
  assert.match(html, /Truncated by Public Filings\./);
  assert.match(html, /6<\/strong> further records are not published here/);
  assert.match(html, /The cut falls at/);
  assert.match(html, /64-shard budget/);
});

/* ---------- 5. every row carries issuer, period, filed date, lag ---------- */

test("every emitted record carries issuer, period_of_report, filed_date and the lag", () => {
  const p = paginateActivity(series(10), FILINGS);
  const rows = parseBody(p.pages[0]!.body).records as Record<string, unknown>[];
  assert.equal(rows.length, 10);
  for (const row of rows) {
    assert.ok("issuer_name" in row && "issuer_key" in row, "issuer display fields");
    assert.equal(row.period_of_report, "2026-03-31");
    assert.equal(row.filed_date, "2026-05-10");
    assert.equal(row.reporting_lag_days, 40);
    assert.equal(row.filed_from, "current-composition");
    assert.ok(Array.isArray(row.filing_keys), "the audit keys ship alongside the resolved date");
  }
  // the referenced filing itself travels in the shard's dictionary (R5)
  assert.deepEqual(Object.keys(parseBody(p.pages[0]!.body).filings), ["1"]);
});

test("filed_date is the MAX over the current composition; a tie goes to the LARGER accession", () => {
  const composed = rec({ filing_keys: [1, 2, 3] });
  const resolved = resolveFiledDate(composed, FILINGS);
  assert.equal(resolved.filed_date, "2026-05-20", "the latest filing in the composition");
  assert.equal(
    resolved.filed_accession,
    "0000000000-26-000002",
    "the larger accession wins the same-date tie — the direction views.sql's " +
      "restatement-survivor predicate resolves a tie in (r.accession > f.accession), " +
      "so the cited document is the one the composition rules treat as authoritative",
  );
  assert.equal(resolved.filed_from, "current-composition");
});

test("the filer page and the activity feed cite the SAME document for one composition", () => {
  /* QA M2-8 M7 — the sharpest of six duplicated helper pairs. `holdings.ts` sorted
     ascending and took the last (largest accession); `activity.ts` kept
     `ref.accession < best.accession` (smallest). Both carried a comment claiming
     "ties broken by accession ascending", and on two same-day amendments the two
     surfaces cited DIFFERENT filings for the identical composition.

     Neither suite could see it: `holdings.test.ts` used distinct filed dates, so
     inverting either comparator broke nothing. This drives BOTH modules from ONE
     fixture, which is the only shape that can detect a divergence.

     Mutation guard: flipping `>` to `<` in `format.latestFiling` fails here. */
  const composed = rec({ filing_keys: [1, 2, 3] });
  const feed = resolveFiledDate(composed, FILINGS);
  const page = provenanceOf(
    ["1", "2", "3"],
    Object.fromEntries(
      Object.entries(FILINGS).map(([k, v]) => [k, { ...v, doc_url: v.doc_url ?? null }]),
    ),
    "2026-03-31",
  );
  assert.equal(page.filedDate, feed.filed_date, "the two surfaces disagree on the filed date");
  assert.equal(
    page.accessions[page.accessions.length - 1],
    feed.filed_accession,
    "the two surfaces cite different documents for one composition",
  );
});

test("an exit dates from the ABSENCE composition, never from the prior one", () => {
  // the prior composition is deliberately the LATER filing: using it would be
  // both wrong and undetectable without this fixture
  const exit = rec({
    change_kind: "exit",
    filing_keys: [],
    prior_filing_keys: [4],
    current_filing_keys: [1],
    delta_value_usd: null,
  });
  const resolved = resolveFiledDate(exit, FILINGS);
  assert.equal(resolved.filed_date, "2026-05-10", "resolved from current_filing_keys");
  assert.equal(resolved.filed_from, "absence-composition");
  // both sides still ship in the shard: absence is only evidence with both
  const p = paginateActivity([exit], FILINGS);
  assert.deepEqual(Object.keys(parseBody(p.pages[0]!.body).filings).sort(), ["1", "4"]);
});

test("an unresolvable composition yields NULL and renders as unresolved — never invented", () => {
  const orphan = rec({ filing_keys: [999] });
  const resolved = resolveActivityRecord(orphan, FILINGS);
  assert.equal(resolved.filed_date, null);
  assert.equal(resolved.filed_accession, null);
  assert.equal(resolved.filed_from, "unresolved");
  assert.equal(resolved.reporting_lag_days, null);

  const p = paginateActivity([orphan], FILINGS);
  const html = activityFeedHtml({ present: true, reason: null, filings: FILINGS, pagination: p });
  assert.match(html, /not resolvable/);
  assert.equal(p.pages[0]!.records.length, 1, "the row is kept, not dropped (G3)");
});

test("reporting lag: past 45 days is LATE, before quarter end is an anomaly, missing is not zero", () => {
  assert.equal(reportingLagDays("2026-03-31", "2026-05-10"), 40);
  assert.equal(reportingLagDays("2026-03-31", "2026-08-01"), 123);
  assert.equal(reportingLagDays("2026-03-31", "2026-03-01"), -30);
  assert.equal(reportingLagDays("2026-03-31", null), null);
  assert.equal(reportingLagDays(null, "2026-05-10"), null);
  assert.equal(reportingLagDays("2026-03-31", "not-a-date"), null);

  const late = paginateActivity([rec({ filing_keys: [4], curr_period: "2026-03-31" })], FILINGS);
  const lateHtml = activityFeedHtml({ present: true, reason: null, filings: FILINGS, pagination: late });
  assert.match(lateHtml, /LATE·123d/);
  assert.match(lateHtml, /past the 45-day deadline/);

  const early = paginateActivity(
    [rec({ curr_period: "2026-06-30", filing_keys: [1] })],
    FILINGS,
  );
  const earlyHtml = activityFeedHtml({ present: true, reason: null, filings: FILINGS, pagination: early });
  assert.match(earlyHtml, /filed 51d before quarter end/);
  assert.match(earlyHtml, /lag-anomaly/);
});

/* ---------- 6. NULL honesty + the wording ban ---------- */

test("a NULL delta renders UNDISCLOSED — never 0, never a bare dash", () => {
  const p = paginateActivity([rec({ delta_value_usd: null, flags: ["value_undisclosed_one_side"] })], FILINGS);
  const html = activityFeedHtml({ present: true, reason: null, filings: FILINGS, pagination: p });
  assert.match(html, /undisclosed/);
  assert.match(html, /this is not zero/);
  assert.ok(!/>\$0</.test(html), "no fabricated zero");
  assert.ok(!/\+\$0/.test(html), "no fabricated signed zero");
  // and the emitted record keeps the null rather than coercing it
  assert.equal(parseBody(p.pages[0]!.body).records[0].delta_value_usd, null);
});

test("R16: no banned trading verb on the rendered feed, in any change kind", () => {
  const kinds = (["new", "add", "trim", "exit", "unclassified"] as const).map((k, i) =>
    rec({
      change_kind: k,
      cik: `000000000${i}`,
      position_key: `sid:${k}`,
      delta_value_usd: k === "unclassified" ? null : 1_000 - i,
      filing_keys: k === "exit" ? [] : [1],
      current_filing_keys: k === "exit" ? [1] : [],
      prior_filing_keys: k === "exit" ? [4] : [],
      flags: ["value_undisclosed_one_side"],
    }),
  );
  const p = paginateActivity(kinds, FILINGS, { byteLimit: 4_000 });
  const html =
    activityFeedHtml({ present: true, reason: null, filings: FILINGS, pagination: p }) +
    institutionalDataNoteHtml();
  assert.deepEqual(scanBannedWording(html), [], "banned wording on the activity surface");
});

test("the wording scanner reads attribute channels too, and does not fire on substrings", () => {
  assert.ok(scanBannedWording(`<p title="a high-conviction call">x</p>`).includes("conviction"));
  assert.deepEqual(scanBannedWording(`<p aria-label="just bought more">x</p>`), ["just bought"]);
  assert.deepEqual(scanBannedWording(`<p>between the quarters, unsolicited</p>`), []);
  assert.deepEqual(scanBannedWording(`<p>the position was sold</p>`), ["sold"]);
});

/** A sentence exercising one spec §1.1 term the way a headline would use it.
    Terms the spec qualifies ("present tense", "as a verb") need a construction,
    not a bare token — a scanner that only matched the isolated word would pass
    while the banned USAGE sailed through. */
const SPEC_TERM_SENTENCES: Record<string, string> = {
  bet: "a big bet on the issuer",
  conviction: "a conviction position",
  "high-conviction": "a high-conviction position",
  bullish: "the manager turned bullish",
  bearish: "the manager turned bearish",
  "loading up": "the fund is loading up here",
  "piling in": "managers are piling in",
  "doubling down": "the fund is doubling down",
  backs: "the filer backs the issuer",
  favors: "the manager favors it",
  likes: "the fund likes it",
  buying: "buying more this quarter",
  "is buying": "the fund is buying more",
  "just bought": "the fund just bought in",
  sold: "the fund sold out",
  move: "a big move into it",
};

test("EVERY §1.1 term in the spec is caught — the list is derived, not counted", () => {
  /* QA M2-8 M5. The previous guard was `assert.ok(BANNED_WORDING.length >= 10,
     "the full §1.1 ban list is carried")` — it passed at exactly 10 while its
     own message asserted completeness, and five spec-banned constructions
     ("the filer backs the issuer", "the manager favors it", "the fund likes
     it", "buying more", "a big move into it") scanned clean.

     A count cannot express "complete". So the terms are READ OUT OF THE SPEC —
     the same trick already used on inst_budget.py — and each is asserted to be
     CAUGHT in the construction a headline would use it in. Adding a term to the
     spec now fails this test until the scanner implements it.

     Mutation guard: deleting any entry from BANNED_WORDING fails here by name. */
  const spec = readFileSync(
    path.join(REPO_ROOT, "docs", "architecture", "data-contracts", "outsized-positions.md"),
    "utf-8",
  );
  const section = /### 1\.1 Banned wording[^]*?\n\n([^]*?)\n\n/.exec(spec);
  assert.ok(section, "the spec still has a §1.1 Banned wording section");
  const listing = /\n\n(`[^]*?)\n\n/.exec(spec.slice(spec.indexOf("### 1.1 Banned wording")));
  assert.ok(listing, "the §1.1 term listing is still a backticked run");
  const terms = [...listing![1]!.matchAll(/`([^`]+)`/g)].map((m) => m[1]!);

  assert.ok(terms.length >= 16, `only ${terms.length} terms parsed from the spec`);
  const unmapped = terms.filter((term) => !(term in SPEC_TERM_SENTENCES));
  assert.deepEqual(
    unmapped,
    [],
    `the spec bans ${JSON.stringify(unmapped)} and this test has no sentence for ` +
      `them — add the sentence AND the scanner pattern, do not delete the term`,
  );

  const missed: string[] = [];
  for (const term of terms) {
    const sentence = SPEC_TERM_SENTENCES[term]!;
    if (scanBannedWording(`<p>${sentence}</p>`).length === 0) missed.push(`${term}: "${sentence}"`);
  }
  assert.deepEqual(missed, [], `spec-banned wording that the scanner does NOT catch: ${missed}`);
});

test("the ban does not fire on the honest copy the surfaces actually ship", () => {
  /* The other half of a wording ban: over-banning deletes accurate labelling.
     "QoQ moves" names position changes and is live copy in three places; the
     `move` rule targets the VERB ("moves into"), so the noun must survive. */
  for (const honest of [
    "QoQ moves",
    "Rankings and QoQ moves that touch this quarter are provisional by construction",
    "quarter-over-quarter moves from the published Public Filings aggregate",
    "What a number looks like here",
    "the feed holds back rather than inventing one",
  ]) {
    assert.deepEqual(
      scanBannedWording(`<p>${honest}</p>`),
      [],
      `the ban fires on honest copy: ${honest}`,
    );
  }
});

/* ---------- 7. the §5 data_note ---------- */

test("the §5 data_note is ONE text: every substantive qualifier in the Python constant is carried", () => {
  /* QA M2-8 M6. Three divergent §5 texts shipped:
       (1) `normalize_inst.INST_DATA_NOTE` — the MCP envelope and ingest CLI,
       (2) this clause list — every dashboard surface,
       (3) a `.explainer` paragraph in `ui.ts` under a near-identical heading,
           rendering on the SAME filer page as (2).
     (2) had quietly dropped three substantive qualifiers from (1), and nothing
     compared them. (3) is now a pointer into (2) rather than a fourth phrasing.

     This reads the PYTHON constant — the same trick already used on
     inst_budget.py — so a qualifier added or removed on the producer side fails
     here instead of drifting for a release.

     Mutation guard: deleting "so managers below that threshold are absent
     entirely" (or either other qualifier) from the clause list fails by name. */
  const py = readFileSync(
    path.join(REPO_ROOT, "src", "populus", "normalize_inst.py"),
    "utf-8",
  );
  const block = /INST_DATA_NOTE = \(([^]*?)\n\)/.exec(py);
  assert.ok(block, "INST_DATA_NOTE is still a parenthesised string constant");
  const pythonNote = [...block![1]!.matchAll(/"([^"]*)"/g)].map((m) => m[1]!).join("");
  assert.ok(pythonNote.length > 400, `the Python note parsed to only ${pythonNote.length} chars`);

  const dashboardNote = INSTITUTIONAL_DATA_NOTE_CLAUSES.map((c) => c.text).join(" ");
  const norm = (s: string): string => s.toLowerCase().replace(/[\s\u00a0]+/g, " ");
  const [pyN, tsN] = [norm(pythonNote), norm(dashboardNote)];

  /* The two are not byte-identical on purpose — one is a single paragraph for a
     tool envelope, the other is clause-tagged for the CSS-fold sweep. What must
     never differ is the SUBSTANCE, so each load-bearing qualifier is asserted
     present in both. */
  const qualifiers = [
    "long positions in section 13(f) securities",
    "at least $100m in such securities",
    "so managers below that threshold are absent entirely",
    "no short positions, no cash, no non-13(f) assets",
    "quarter-end snapshots",
    "45 days late",
    "not current holdings",
    "era-dependent units",
    "2023-01-03",
    "unit_basis carried on every record",
    "affiliated managers may report the same position",
    "confidential treatment",
    "disclosures, not investment advice",
    "architecture.md \u00a75.2 / m2-contract \u00a75",
  ];
  const missingFromDashboard = qualifiers.filter((q) => !tsN.includes(q));
  const missingFromPython = qualifiers.filter((q) => !pyN.includes(q));
  assert.deepEqual(
    missingFromDashboard,
    [],
    "the dashboard §5 note has dropped qualifiers the producer's note carries",
  );
  assert.deepEqual(
    missingFromPython,
    [],
    "the producer's §5 note has dropped qualifiers the dashboard's note carries",
  );
});

test("only ONE block on a filer page is titled with the §5 note's heading", () => {
  /* Two same-titled blocks with different wording on one page is the reader-
     facing form of M6: there is no way to tell which is authoritative. */
  const uiSrc = readFileSync(path.join(REPO_ROOT, "dashboard", "src", "lib", "ui.ts"), "utf-8");
  assert.ok(
    !/What a 13F is\s*\u2014\s*and is not\./.test(uiSrc),
    "ui.ts restates the §5 data_note heading — it must LINK to the canonical box",
  );
  assert.ok(
    uiSrc.includes('href="#inst-data-note"'),
    "ui.ts must point at the canonical §5 box",
  );
  assert.ok(
    institutionalDataNoteHtml().includes('id="inst-data-note"'),
    "the canonical box must carry the anchor ui.ts links to",
  );
});

test("the §5 data_note carries every clause, each as its own non-foldable caveat line", () => {
  const html = institutionalDataNoteHtml();
  for (const clause of INSTITUTIONAL_DATA_NOTE_CLAUSES) {
    assert.ok(
      html.includes(`data-note-clause="${clause.id}"`),
      `clause ${clause.id} renders`,
    );
  }
  assert.match(html, /LONG positions in Section 13\(f\) securities/);
  assert.match(html, /No short positions, no cash, no non-13\(f\) assets/);
  assert.match(html, /quarter-end snapshots filed up to 45 days late/);
  assert.match(html, /era-dependent units/);
  assert.match(html, /Affiliated managers may report the same position/);
  assert.match(html, /confidential treatment may be omitted/);
  // every clause is a .caveat-line — the class the fold guard and the print
  // block both protect
  const lines = html.match(/class="caveat-line"/g) ?? [];
  assert.equal(lines.length, INSTITUTIONAL_DATA_NOTE_CLAUSES.length);
  assert.match(html, /data-inst-data-note/);
});

/* ---------- 8. the surface states its own bounds ---------- */

test("the feed states how much of the ordered set it shows, and where the rest is", () => {
  const p = paginateActivity(series(300), FILINGS);
  const html = activityFeedHtml(
    { present: true, reason: null, filings: FILINGS, pagination: p },
    { rowLimit: 50 },
  );
  /* F2: BOTH bounds are stated — the compact render bound the reader is
     currently inside, and the shard budget the build published under.

     SL-R10 retarget: both used to live in a `terminusRow` above the control,
     which duplicated the control's count. The row is deleted and the two
     clauses moved INTO the control, which now states them visibly from the
     server. They are split along the line that decides whether expanding
     retracts them — the render bound is retractable, the publication bound
     never is — so this asserts each in its own element. */
  assert.match(
    html,
    /<span class="compact-bound-count">Showing the first 10 of the 50 rows rendered here/,
    "the render bound, visible, in the clause expanding is allowed to retract",
  );
  assert.match(html, /a Public Filings render bound, not a data bound/, "the author of the cut is named");
  assert.match(
    html,
    /<span class="compact-bound-extra">[^<]*These rows are the largest of 300 ordered change records/,
    "the PUBLICATION bound is in the clause expanding must never retract",
  );
  // and the no-JavaScript route out of the compact slice is a real link
  assert.match(html, /<a href="\/institutional\/data\/activity\/0\.v1\.json">/);
  assert.match(html, /institutional\/data\/activity\/&lt;page&gt;\.v1\.json/);
  assert.match(html, /2,000 records or 2,097,152 bytes of serialized JSON/);
  // …and none of it is behind a `hidden` the reader needs a script to lift.
  const bound = html.slice(html.indexOf('<p class="compact-bound">'));
  assert.match(bound.slice(0, bound.indexOf("</p>")), /^(?:(?!hidden).)*$/s,
    "no clause of the bound ships hidden — the button below it is the only hidden thing");
});

test("each absence state renders as itself — the reader learns WHICH one", () => {
  const reasons = [
    "module-absent",
    "serving-artifact-unlocatable",
    "serving-artifact-missing",
    "activity-grain-unavailable",
  ] as const;
  const seen = new Set<string>();
  for (const reason of reasons) {
    const feed: ActivityFeed = {
      present: false,
      reason,
      filings: {},
      pagination: paginateActivity([], {}, { absent: reason }),
    };
    const html = activityFeedHtml(feed);
    assert.match(html, /The activity feed is not in this build\./);
    assert.match(html, /Absence is stated here instead of simulated\./);
    seen.add(html);
  }
  assert.equal(seen.size, reasons.length, "the four states are not interchangeable copy");
});

/* ---------- 9. the loader contract ---------- */

/** The PRODUCER's own DDL, read from `src/populus/inst_serving.py`.

    QA M2-8 M10: this fixture used to hand-write its own `CREATE TABLE`
    statements, so the activity loader kept passing straight through a producer
    rename — asymmetric with the sibling suite, which already extracts
    `SERVING_SCHEMA` from the Python source and prepares the real `.astro`
    queries against it. Reading it here means a column the producer renames
    breaks the loader's SELECT in this test rather than in production. */
function servingSchemaSql(): string {
  const py = readFileSync(
    path.join(REPO_ROOT, "src", "populus", "inst_serving.py"),
    "utf-8",
  );
  const m = /^SERVING_SCHEMA = """([^]*?)"""/m.exec(py);
  assert.ok(m, "SERVING_SCHEMA is still a triple-quoted constant in inst_serving.py");
  const ddl = m![1]!;
  assert.ok(
    ddl.includes(`CREATE TABLE IF NOT EXISTS ${ACTIVITY_TABLE}`),
    `the producer no longer declares ${ACTIVITY_TABLE}`,
  );
  return ddl;
}

function writeServingDb(dir: string, opts: { withActivity: boolean }): string {
  const dbPath = path.join(dir, "inst_serving.db");
  const db = new DatabaseSync(dbPath);
  db.exec(servingSchemaSql());
  if (!opts.withActivity) db.exec(`DROP TABLE ${ACTIVITY_TABLE}`);
  db.exec(
    `INSERT INTO ${FILINGS_TABLE} (filing_key, accession, submission_type,
       period_of_report, filed_date, doc_url, source) VALUES
       (1, '0000000000-26-000001', '13F-HR', '2026-03-31', '2026-05-10',
        'https://www.sec.gov/Archives/1', 'sec-edgar')`,
  );
  if (opts.withActivity) {
    db.exec(
      `INSERT INTO ${ACTIVITY_TABLE} (row_id, cik, filer_name, issuer_key, issuer_name,
         position_key, put_call, ssh_prnamt_type, change_kind, curr_period, prev_period,
         prev_value_usd, curr_value_usd, delta_value_usd, prev_shares, curr_shares,
         delta_shares, filing_keys, prior_filing_keys, current_filing_keys, flags) VALUES
         (0, '0001067983', 'FIXTURE HOLDINGS LLC', 'entity:cik:0000320193', 'APPLE INC',
          'sid:aapl', 'LONG', 'SH', 'add', '2026-03-31', '2025-12-31',
          1000, 3000, 2000, 10, 30, 20, '[1]', '[]', '[]', '[]'),
         (1, '0001067983', 'FIXTURE HOLDINGS LLC', NULL, NULL,
          'cusip6:037833', 'PUT', 'PRN', 'wat', '2026-03-31', '2025-12-31',
          NULL, NULL, NULL, NULL, NULL, NULL, '[1]', '[]', '[]',
          '["value_undisclosed_one_side"]')`,
    );
  }
  db.close();
  return dbPath;
}

test("the loader round-trips the serving contract and fails CLOSED on an unknown change kind", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "populus-activity-"));
  try {
    const dbPath = writeServingDb(dir, { withActivity: true });
    const feed = loadActivityFeed({ instPresent: true, dbPath });
    assert.equal(feed.present, true);
    assert.equal(feed.pagination.total_records, 2);

    const rows = feed.pagination.pages[0]!.records;
    assert.equal(rows[0]!.delta_value_usd, 2_000, "the disclosed delta ranks first");
    assert.equal(rows[0]!.filed_date, "2026-05-10");
    assert.equal(rows[0]!.reporting_lag_days, 40);
    // NULL delta last, NULL value preserved (never coerced to 0)
    assert.equal(rows[1]!.delta_value_usd, null);
    assert.equal(rows[1]!.issuer_name, null);
    assert.equal(rows[1]!.change_kind, "unclassified", "'wat' is not a guessed direction");
    assert.deepEqual(rows[1]!.flags, ["value_undisclosed_one_side"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("every failure mode degrades to a NAMED absence, never a partial feed", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "populus-activity-"));
  try {
    assert.equal(
      loadActivityFeed({ instPresent: false, dbPath: "/nonexistent" }).reason,
      "module-absent",
    );
    assert.equal(loadActivityFeed({ instPresent: true, dbPath: null }).reason, resolvedAbsence());
    assert.equal(
      loadActivityFeed({ instPresent: true, dbPath: path.join(dir, "nope.db") }).reason,
      "serving-artifact-missing",
    );
    const noGrain = writeServingDb(dir, { withActivity: false });
    const feed = loadActivityFeed({ instPresent: true, dbPath: noGrain });
    assert.equal(feed.present, false);
    assert.equal(feed.reason, "activity-grain-unavailable");
    assert.equal(feed.pagination.pages.length, 1, "an absent feed still emits page 0");
    assert.equal(parseBody(feed.pagination.pages[0]!.body).absent, "activity-grain-unavailable");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

/** With no artifact env set, no path is resolvable; with one set, the path is
    resolvable but absent. Both are named absences — this keeps the assertion
    honest in either environment instead of pinning the test host's shell. */
function resolvedAbsence(): string {
  return process.env.POPULUS_INST_SERVING_DB ||
    process.env.POPULUS_INST_DB ||
    process.env.POPULUS_BUILD_DIR
    ? "serving-artifact-missing"
    : "serving-artifact-unlocatable";
}
