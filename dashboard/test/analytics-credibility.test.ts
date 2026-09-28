/* DESIGN-POLISH M4 — analytics credibility (R26, R27, R28; T4.1–T4.3).

   Every rule here is pinned by a PROPERTY predicate that runs on the real
   output and on a mutant that drops the rule; the mutant must fail the
   predicate, so a test that only asserted an end state cannot pass a tree
   that lost the rule. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { MIN_BOOK_POSITIONS, newPositionLeaders, type NewPositionLeaders } from "../src/lib/inst-analytics.ts";
import { newPositionLeadersHtml } from "../src/lib/ui/institutional.ts";
import { unavailableDesignPanel } from "../src/lib/ui/shared.ts";
import { activityFeedHtml, notableActivity, scanBannedWording, NOTABLE_FEED_PER_FILER, type ActivityFeed, type ActivityFeedRecord, type ActivityRecord } from "../src/lib/activity.ts";
import {
  consensusAddLedgerItem,
  consensusBoard,
  consensusBoardHtml,
  consensusRowLabel,
  FUND_WRAPPER_ISSUERS,
  normalizedIssuerName,
  staleFundWrapperEntries,
  type ConsensusBoard,
  type FundWrapperEntry,
  type NotableMove,
} from "../src/lib/notable-moves.ts";
import type { ConcentrationRow, InstData, QoqDeltaRow } from "../src/lib/inst.ts";
import { domOf, visibleText } from "./lib/ledger-dom.ts";

const P = "2026-06-30";
const SRC = path.resolve(import.meta.dirname, "..", "src");

/* ============================================================ R26 conviction */

function conc(cik: string, positions: number, total: number, nulls = 0): ConcentrationRow {
  return { cik, period_of_report: P, position_count: positions, total_value_usd: total, null_value_positions: nulls, topn_value_usd: total / 2, topn_share_bps: 5000, hhi: 1200, flags: [] };
}
function newPos(cik: string, key: string, curr: number | null): QoqDeltaRow {
  return { cik, position_key: key, put_call: "LONG", curr_period: P, prev_period: "2026-03-31", change_kind: "new", prev_value_usd: null, curr_value_usd: curr, delta_value_usd: curr, prev_shares: null, curr_shares: 1, delta_shares: 1, ssh_prnamt_type: "SH", flags: [] };
}
function instOf(filers: { cik: string; conc: ConcentrationRow; deltas: QoqDeltaRow[] }[]): InstData {
  return {
    present: true,
    watermarks: { latest_period_of_report: P, latest_filed_date: "2026-08-14" },
    topn: 25,
    filers: filers.map((f) => ({ cik: f.cik, filer_name: `Filer ${f.cik}`, latest_period: P, position_count: f.conc.position_count, total_value_usd: f.conc.total_value_usd, null_value_positions: 0, unkeyed_positions: 0 })),
    deltasByCik: new Map(filers.map((f) => [f.cik, f.deltas])),
    concentrationByCik: new Map(filers.map((f) => [f.cik, [f.conc]])),
    holdersByIssuer: new Map(),
    addsByPeriodMode: new Map(),
    addsExclusions: new Map(),
    addsPeriods: [P],
    typingByCik: new Map(),
  } as InstData;
}

/* A: not notable, one position at 100% (the "BASS SID R at 100.0%" shape).
   B: notable, 19 positions — under the book floor.
   C: notable, 25 positions, one without a value.
   D: notable, 25 positions, largest new position 1%.
   E: notable, 25 positions, a new position at 5% — the one qualifier. */
const FILERS = [
  { cik: "A", conc: conc("A", 1, 1_000), deltas: [newPos("A", "a", 1_000)] },
  { cik: "B", conc: conc("B", 19, 1_000), deltas: [newPos("B", "a", 100)] },
  { cik: "C", conc: conc("C", 25, 1_000, 1), deltas: [newPos("C", "a", 300)] },
  { cik: "D", conc: conc("D", 25, 1_000), deltas: [newPos("D", "a", 10)] },
  { cik: "E", conc: conc("E", 25, 1_000), deltas: [newPos("E", "a", 50), newPos("E", "b", 5)] },
];
const NOTABLE = new Set(["B", "C", "D", "E"]);

/** R26 as a property of a result: every ranked filer is notable, its book
    has at least MIN_BOOK_POSITIONS positions and every value, and the counts
    account for every evaluated filer. */
function convictionProblems(l: NewPositionLeaders, inst: InstData, notable: ReadonlySet<string>): string[] {
  const out: string[] = [];
  for (const r of l.rows) {
    const c = inst.present ? inst.concentrationByCik.get(r.cik)?.find((x) => x.period_of_report === l.period) : undefined;
    if (!notable.has(r.cik)) out.push(`${r.cik}: not notable`);
    if (!c || c.position_count < MIN_BOOK_POSITIONS) out.push(`${r.cik}: book under ${MIN_BOOK_POSITIONS}`);
    if (!c || c.null_value_positions > 0) out.push(`${r.cik}: a position without a value`);
  }
  const e = l.excluded;
  if (l.qualifying + e.notNotable + e.smallBook + e.missingValue + e.belowThreshold !== l.evaluated) out.push("the counts do not account for every evaluated filer");
  return out;
}

test("T4.1 (R26): notable managers only, a complete book of at least 20 positions; every exclusion counted under its reason", () => {
  assert.equal(MIN_BOOK_POSITIONS, 20);
  const inst = instOf(FILERS);
  const l = newPositionLeaders(inst, P, NOTABLE)!;
  assert.deepEqual(l.rows.map((r) => [r.cik, r.maxWeightBps]), [["E", 500]]);
  assert.equal(l.evaluated, 5);
  assert.equal(l.qualifying, 1);
  assert.deepEqual(l.excluded, { notNotable: 1, smallBook: 1, missingValue: 1, belowThreshold: 1 }, "A not notable · B under the floor · C a missing value · D below 2%");
  assert.deepEqual(convictionProblems(l, inst, NOTABLE), []);

  // the note states the rule, the evaluated and qualifying counts and each exclusion
  const note = visibleText(domOf(newPositionLeadersHtml(l, () => "top", P)).querySelectorAll("p.section-note")[0]!);
  assert.match(note, /notable managers whose complete 13F long book has at least 20 positions, every one with a value/);
  assert.match(note, /5 filers opened positions in 2026-06-30; 1 qualifies\./);
  assert.match(note, /Excluded: 1 not notable · 1 book under 20 positions · 1 a position without a value · 1 no new position at 2% or more/);

  // fewer than five qualify: the band lists only those
  assert.equal((newPositionLeadersHtml(l, () => "top", P).match(/<tr><td class="c-rank/g) ?? []).length, 1);

  // control: DROPPING THE NOTABLE FILTER ranks A (one position, 100%) first and fails the property
  const everyone = new Set(FILERS.map((f) => f.cik));
  const dropped = newPositionLeaders(inst, P, everyone)!;
  assert.equal(dropped.rows[0]?.cik, "E", "A is still held out — by the book floor");
  const noFloor = newPositionLeaders(inst, P, everyone, { minBookPositions: 0 })!;
  assert.equal(noFloor.rows[0]?.cik, "A", "control: with neither rule the one-position book leads at 100%");
  assert.ok(convictionProblems(noFloor, inst, NOTABLE).some((p) => p === "A: not notable"), "control: the notable property catches it");
  // control: dropping the BOOK FLOOR ranks B and fails the property
  const floorless = newPositionLeaders(inst, P, NOTABLE, { minBookPositions: 0 })!;
  assert.ok(floorless.rows.some((r) => r.cik === "B"));
  assert.ok(convictionProblems(floorless, inst, NOTABLE).includes("B: book under 20"));
});

/** A computed zero is an answer; the unavailable surface is for missing inputs. */
function computedZeroProblems(html: string): string[] {
  const out: string[] = [];
  if (/not available in this build/i.test(html)) out.push("a computed zero rendered as 'not available in this build'");
  if (!/data-empty-state/.test(html)) out.push("no empty-state marker (band I1 cannot collapse)");
  if (!/Zero is the computed answer/.test(html)) out.push("the zero is not stated as computed");
  if (!/at least 20 positions/.test(html)) out.push("the rule is not stated");
  if (!/Excluded: /.test(html)) out.push("the exclusions are not stated");
  return out;
}

test("T4.1 (R26): zero qualifying renders the computed-zero line with the rule and counts — never 'not available in this build'", () => {
  const inst = instOf(FILERS.filter((f) => f.cik !== "E"));
  const l = newPositionLeaders(inst, P, NOTABLE)!;
  assert.equal(l.rows.length, 0);
  const html = newPositionLeadersHtml(l, () => "top", P);
  assert.deepEqual(computedZeroProblems(html), []);
  // the line carries the band's fixed heading, and that UI name passes the wording scan
  assert.match(html, /^<section class="panel design-newpositions" aria-label="Conviction leaders" data-empty-state><div class="panel-head"><h2 class="section-h">Conviction leaders<\/h2>/);
  assert.deepEqual(scanBannedWording(html), []);
  assert.deepEqual(scanBannedWording(html.replace("Zero is the computed answer", "a high-conviction answer")), ["conviction", "high-conviction"], "control: the word outside the UI name is still caught");
  // a registry that marks no notable manager is stated
  assert.doesNotMatch(html, /marks no notable manager/);
  const noRegistry = newPositionLeadersHtml(newPositionLeaders(inst, P, new Set())!, () => "top", P);
  assert.match(noRegistry, /This build's manager registry marks no notable manager, so no filer is eligible\./);
  assert.match(visibleText(domOf(html)), /4 filers opened positions in 2026-06-30; 0 qualify\. Excluded: 1 not notable · 1 book under 20 positions · 1 a position without a value · 1 no new position at 2% or more/);
  // the unavailable surface stays for a MISSING input
  assert.match(newPositionLeadersHtml(null, () => "top", null), /not available in this build/);
  // control: the pre-M4 rendering of a computed zero fails
  const old = unavailableDesignPanel("Conviction leaders", "", [], "No filer opened a position at 2% or more of a complete, fully valued book in 2026-06-30. Zero is the computed answer.", "design-newpositions");
  assert.ok(computedZeroProblems(old).includes("a computed zero rendered as 'not available in this build'"));
});

/* ======================================================= R27 recent activity */

const FILINGS = {
  "1": { accession: "0001-1", submission_type: "13F-HR", period_of_report: P, filed_date: "2026-08-14", doc_url: null, source: "s" },
  "2": { accession: "0001-2", submission_type: "13F-HR", period_of_report: P, filed_date: "2026-08-01", doc_url: null, source: "s" },
};
function rec(over: Partial<ActivityRecord>): ActivityRecord {
  return {
    cik: "000000000A", filer_name: "A", issuer_key: "iss:1", issuer_name: "ISSUER", position_key: "sid:a", put_call: "LONG", ssh_prnamt_type: "SH",
    change_kind: "add", curr_period: P, prev_period: "2026-03-31", prev_value_usd: 1, curr_value_usd: 2, delta_value_usd: 1,
    prev_shares: 1, curr_shares: 2, delta_shares: 1, filing_keys: [1], prior_filing_keys: [], current_filing_keys: [], flags: [], ...over,
  } as ActivityRecord;
}
/* 12 rows from filer A, all filed on the newest day; 3 from B, C, D, older */
const RECORDS = [
  ...Array.from({ length: 12 }, (_, i) => rec({ position_key: `sid:a${i}`, delta_value_usd: 1_000 + i })),
  rec({ cik: "000000000B", filer_name: "B", position_key: "sid:b", filing_keys: [2], delta_value_usd: 50 }),
  rec({ cik: "000000000C", filer_name: "C", position_key: "sid:c", filing_keys: [2], delta_value_usd: 40 }),
  rec({ cik: "000000000D", filer_name: "D", position_key: "sid:d", filing_keys: [2], delta_value_usd: 30 }),
];
const FEED = {
  present: true, reason: null, filings: FILINGS, records: RECORDS,
  pagination: { pages: [{ page: 0, records: [] }], truncation: null, total_records: RECORDS.length, emitted_records: RECORDS.length, limits: { byteLimit: 2_097_152, recordLimit: 2_000, shardLimit: 64 } },
} as unknown as ActivityFeed;
const FEED_NOTABLE = new Set(["000000000A", "000000000B", "000000000C", "000000000D"]);

function perFilerProblems(rows: readonly ActivityFeedRecord[]): string[] {
  const n = new Map<string, number>();
  for (const r of rows) n.set(r.cik, (n.get(r.cik) ?? 0) + 1);
  return [...n].filter(([, k]) => k > NOTABLE_FEED_PER_FILER).map(([cik, k]) => `${cik}: ${k} rows`);
}

test("T4.2 (R27): at most two rows per filer across the WHOLE list; the count is the capped list; newest filed first; deterministic", () => {
  assert.equal(NOTABLE_FEED_PER_FILER, 2);
  const rows = notableActivity(FEED, FEED_NOTABLE, 50);
  assert.deepEqual(perFilerProblems(rows), []);
  assert.deepEqual(rows.map((r) => r.position_key), ["sid:a11", "sid:a10", "sid:b", "sid:c", "sid:d"], "newest filed first, then largest change; A's two largest");
  assert.ok(new Set(rows.map((r) => r.cik)).size >= 4, "every filer that exists reaches the list");
  assert.deepEqual(notableActivity(FEED, FEED_NOTABLE, 50), rows, "identical output across two runs");

  const html = activityFeedHtml(FEED, { reference: true, notableCiks: FEED_NOTABLE });
  const tbody = /<tbody id="inst-activity-tbody"[^>]*>([\s\S]*?)<\/tbody>/.exec(html)![1]!;
  assert.equal((tbody.match(/<tr/g) ?? []).length, 5);
  assert.match(html, /data-compact-total="5"/, "the count's total is the capped list's length");
  assert.match(html, /at most two per manager/, "the band states the cap");
  assert.match(html, /each manager's full list is on its filer page/);

  // control: a cap applied only to the first ten rows gives the wrong total
  const uncapped = [...RECORDS].sort((a, b) => (a.filing_keys[0]! - b.filing_keys[0]!) || (b.delta_value_usd! - a.delta_value_usd!));
  const firstTen = uncapped.slice(0, 10);
  const seen = new Map<string, number>();
  const cappedFirstTen = firstTen.filter((r) => { const k = (seen.get(r.cik) ?? 0) + 1; seen.set(r.cik, k); return k <= 2; });
  assert.notEqual(cappedFirstTen.length, rows.length, "control: capping the default view only yields 2 rows, not 5");
  // control: the uncapped list fails the per-filer property
  assert.deepEqual(perFilerProblems(uncapped.slice(0, 10) as unknown as ActivityFeedRecord[]), ["000000000A: 10 rows"]);
});

/* ============================================================ R28 consensus */

function mv(cik: string, ikey: string | null, issuer: string, over: Partial<NotableMove> = {}): NotableMove {
  return {
    cik, manager: `M${cik}`, principal: null, type: "hedge_fund", issuer, ticker: null, ticker_verified: null, kind: "new",
    delta_shares: 1, curr_value: 100, delta_value: 100, filed: "2026-08-14", doc: null, key: `sid:${ikey}:${cik}`, ikey, ...over,
  } as NotableMove;
}
const three = (ikey: string | null, issuer: string, over: Partial<NotableMove> = {}, ciks = ["1", "2", "3"]): NotableMove[] => ciks.map((c) => mv(c, ikey, issuer, over));
const WRAPPERS: FundWrapperEntry[] = [{ key: "ISHARES TR", name: "iShares Trust", why: "ETF series registrant" }];
const MOVES: NotableMove[] = [
  ...three("iss:10", "ISHARES TR", {}, ["1", "2", "3", "4"]), // four new stakes — it would lead
  ...three("iss:11", "iShares  Tr"), // the same registrant, a second issuer key and a different spelling
  ...three("iss:20", "NVIDIA CORP", { ticker: "NVDA", ticker_verified: "2026-09-10" }),
  ...three("iss:31", "ACME HOLDINGS INC", { kind: "add" }),
  ...three("iss:30", "ACME HOLDINGS INC", { kind: "trim" }),
  mv("1", null, "UNKEYED CO"),
  mv("2", null, "UNKEYED CO"),
];

function labelProblems(b: ConsensusBoard): string[] {
  const seen = new Map<string, number>();
  for (const r of b.rows) seen.set(consensusRowLabel(r), (seen.get(consensusRowLabel(r)) ?? 0) + 1);
  return [...seen].filter(([, n]) => n > 1).map(([l, n]) => `${l} ×${n}`);
}

test("T4.3 (R28): reviewed fund wrappers are excluded and counted; operating issuers stay; unkeyed moves are stated", () => {
  const b = consensusBoard(P, MOVES, { minFilers: 3, wrappers: WRAPPERS });
  assert.ok(b.rows.every((r) => normalizedIssuerName(r.issuer) !== "ISHARES TR"), "both iShares keys are off the board");
  assert.equal(b.wrappersExcluded, 2, "two issuer keys named ISHARES TR, counted");
  assert.equal(b.rows[0]!.issuer, "NVIDIA CORP", "the operating issuer leads");
  assert.equal(b.unkeyedMoves, 2);
  const html = consensusBoardHtml(b, { filerHref: (c) => `/f/${c}` });
  assert.match(visibleText(domOf(html)), /2 fund-wrapper registrants on the reviewed list are excluded · 2 moves carry no issuer identity and are outside this board\./);

  // the header's "Consensus add" figure is row 1 of this board and states the exclusion
  const fig = consensusAddLedgerItem(b.rows[0]!, P, b.wrappersExcluded);
  assert.equal(fig.value, "NVDA");
  assert.match(fig.noteHtml ?? "", /2 fund-wrapper registrants on the reviewed list are excluded/);
  const page = readFileSync(path.join(SRC, "pages", "institutional", "index.astro"), "utf-8");
  assert.match(page, /consensusAddLedgerItem\(consensus, analyticsPeriod, board\?\.wrappersExcluded \?\? 0\)/, "the page passes the board's exclusion count to the figure");

  // control: without the list the wrapper leads the board and the figure
  const unfiltered = consensusBoard(P, MOVES, { minFilers: 3, wrappers: [] });
  assert.equal(unfiltered.rows[0]!.issuer, "ISHARES TR");
  assert.equal(unfiltered.wrappersExcluded, 0);
});

test("T4.3 (R28): no two rows share a label — a ticker tells keys apart, else the stable issuer key's ordinal", () => {
  const b = consensusBoard(P, MOVES, { minFilers: 3, wrappers: WRAPPERS });
  assert.deepEqual(labelProblems(b), []);
  const acme = b.rows.filter((r) => r.issuer === "ACME HOLDINGS INC").map((r) => [r.issuerKey, consensusRowLabel(r)]);
  assert.deepEqual(acme.sort(), [["iss:30", "ACME HOLDINGS INC #1"], ["iss:31", "ACME HOLDINGS INC #2"]], "ordinal in issuer-key order, whatever the rank");
  assert.equal(consensusRowLabel(b.rows.find((r) => r.issuerKey === "iss:20")!), "NVDA NVIDIA CORP", "a unique name carries no ordinal");
  // a shared name with distinct tickers is told apart by the ticker alone
  const tick = consensusBoard(P, [...three("iss:40", "TWIN CORP", { ticker: "TWA" }), ...three("iss:41", "TWIN CORP", { ticker: "TWB" })], { wrappers: [] });
  assert.deepEqual(tick.rows.map((r) => consensusRowLabel(r)).sort(), ["TWA TWIN CORP", "TWB TWIN CORP"]);
  assert.match(consensusBoardHtml(b, { filerHref: (c) => `/f/${c}` }), /#n tells apart issuers filed under one name/);
  // control: without the disambiguator the two ACME rows collide
  const stripped = { ...b, rows: b.rows.map((r) => ({ ...r, disambiguator: null })) };
  assert.deepEqual(labelProblems(stripped), ["ACME HOLDINGS INC ×2"]);
});

test("T4.3 (R28): the reviewed list is keyed on the normalized name; an entry matching no issuer in the quarter is stale", () => {
  assert.ok(FUND_WRAPPER_ISSUERS.length > 0, "the list is seeded");
  const keys = FUND_WRAPPER_ISSUERS.map((e) => e.key);
  assert.equal(new Set(keys).size, keys.length, "no duplicate entries");
  for (const e of FUND_WRAPPER_ISSUERS) {
    assert.equal(e.key, normalizedIssuerName(e.key), `${e.key}: the key is the normalized identity`);
    assert.ok(e.name.trim() && e.why.trim(), `${e.key}: carries its reviewed name and note`);
  }
  // the stale-entry control: an entry matching no issuer fails
  const list: FundWrapperEntry[] = [...WRAPPERS, { key: "GONE FUND TRUST", name: "Gone Fund Trust", why: "stale" }];
  const quarterNames = MOVES.map((m) => m.issuer);
  assert.deepEqual(staleFundWrapperEntries(quarterNames, list).map((e) => e.key), ["GONE FUND TRUST"]);
  assert.deepEqual(staleFundWrapperEntries(["iShares  Tr"], WRAPPERS), [], "a spelling variant still matches by normalized identity");
});
