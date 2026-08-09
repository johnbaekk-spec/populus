/* Pure-derivation tests: typed sumRanges (spec §2), quarterly flow (C1–C7),
   the QoQ presentation mapping (Locked #8 — every row of the spec table),
   S7 calendar, the generic-route key parser, the fetch-outcome classifier
   (every outcome in spec §3), the ticker→issuer mapping (Locked #18 — parity
   vs the committed pipeline fixture, ambiguity, rejection), the budget walk,
   and the search index/query. */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  sumRanges,
  sumRangesText,
  undisclosedPctText,
  quarterlyFlow,
  medianLag,
  lateCount,
  inTrailingMonths,
  topTickers,
  membersDisclosing,
  servingSince,
  qoqPresentation,
  filingWindow,
  parseEntityKey,
  tickerDataKey,
  memberDataPath,
  tickerDataPath,
  classifyResponse,
  parseTickerMap,
  resolveTicker,
  buildSearchIndex,
  searchQuery,
  searchIndexValid,
  budgetWalk,
  groupEntities,
  edgarFilerUrl,
  bioguideProfileUrl,
  pathSafeTicker,
} from "../src/lib/derive.ts";
import type { QoqDeltaRow } from "../src/lib/inst.ts";
import { DATASET_VERSION, type TxnRow, type PaperRow, tickerHrefFor } from "../src/lib/format.ts";

function txn(over: Partial<TxnRow> = {}): TxnRow {
  return {
    kind: "txn",
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
    doc: "https://efdsearch.senate.gov/search/view/ptr/abc/",
    ...over,
  };
}

function qoq(over: Partial<QoqDeltaRow> = {}): QoqDeltaRow {
  return {
    cik: "0001067983",
    position_key: "sid:sec:aapl",
    put_call: "LONG",
    curr_period: "2026-03-31",
    prev_period: "2025-12-31",
    change_kind: "add",
    prev_value_usd: 1000,
    curr_value_usd: 2000,
    delta_value_usd: 1000,
    prev_shares: 100,
    curr_shares: 150,
    delta_shares: 50,
    ssh_prnamt_type: "SH",
    flags: [],
    ...over,
  };
}

/* ---------- sumRanges (spec §2) ---------- */

test("sumRanges: empty / all-undisclosed / closed / open kinds", () => {
  assert.deepEqual(sumRanges([]), { kind: "empty" });

  const undisclosed = sumRanges([
    { low: null, high: null },
    { low: null, high: null },
  ]);
  assert.equal(undisclosed.kind, "undisclosed");
  assert.equal(sumRangesText(undisclosed), "not disclosed");
  assert.ok(
    !sumRangesText(undisclosed).includes("$0"),
    "an all-unparsed aggregate must never fabricate $0+",
  );

  const closed = sumRanges([
    { low: 1001, high: 15000 },
    { low: 15001, high: 50000 },
  ]);
  assert.deepEqual(closed, { kind: "closed", low: 16000, high: 65000, rows: 2, undisclosed: 0 });
  assert.equal(sumRangesText(closed), "$16K–$65K");

  const openCap = sumRanges([
    { low: 1_000_001, high: null },
    { low: 1001, high: 15000 },
  ]);
  assert.equal(openCap.kind, "open");
  assert.equal(sumRangesText(openCap), "Over $1M");

  const partial = sumRanges([
    { low: 1001, high: 15000 },
    { low: null, high: null },
  ]);
  assert.equal(partial.kind, "open", "an unparsed row voids the upper bound");
  if (partial.kind === "open") assert.equal(partial.undisclosed, 1);
});

test("sumRanges: a disclosed real zero prints 0, an 'Under $X' row keeps low honest", () => {
  const under = sumRanges([{ low: null, high: 15000 }]);
  assert.equal(under.kind, "closed");
  if (under.kind === "closed") {
    assert.equal(under.low, 0, "unknown floor contributes the minimum honest claim: zero");
    assert.equal(under.high, 15000);
  }
});

test("undisclosedPctText: count-based, not value-based (R15)", () => {
  const s = sumRanges([
    { low: 1001, high: 15000 },
    { low: 1001, high: 15000 },
    { low: null, high: null },
  ]);
  assert.equal(undisclosedPctText(s), "33%", "1 of 3 rows unparsed → 33%");
  assert.equal(undisclosedPctText(sumRanges([{ low: null, high: null }])), "100%");
  assert.equal(undisclosedPctText(sumRanges([{ low: 1001, high: 15000 }])), null);
});

/* ---------- quarterly flow (C1–C7) ---------- */

test("quarterlyFlow: gaps stay gaps, undated rows are excluded and counted", () => {
  const rows = [
    txn({ traded: "2026-06-01", side: "purchase" }),
    txn({ traded: "2025-11-15", side: "sale" }),
    txn({ traded: null, side: "purchase" }), // no trade date → excluded, counted
    txn({ traded: "2026-05-02", side: "exchange" }), // excluded side, counted
  ];
  const flow = quarterlyFlow(rows, "2026-07-24", 8);
  assert.equal(flow.quarters.length, 8);
  assert.equal(flow.undated, 1);
  assert.equal(flow.excludedSides, 1);
  const q2 = flow.quarters.find((q) => q.quarterEnd === "2026-06-30")!;
  assert.equal(q2.buy.kind, "closed");
  const gap = flow.quarters.find((q) => q.quarterEnd === "2026-03-31")!;
  assert.equal(gap.buy.kind, "empty", "a quarter with no rows is an empty (gap), never interpolated");
  assert.equal(gap.sell.kind, "empty");
  const q4 = flow.quarters.find((q) => q.quarterEnd === "2025-12-31")!;
  assert.equal(q4.sell.kind, "closed");
});

test("quarterlyFlow: window ends at the build's quarter, oldest first", () => {
  const flow = quarterlyFlow([], "2026-07-24", 4);
  assert.deepEqual(
    flow.quarters.map((q) => q.quarterEnd),
    ["2025-12-31", "2026-03-31", "2026-06-30", "2026-09-30"],
  );
  assert.deepEqual(flow.quarters.map((q) => q.q), ["25Q4", "26Q1", "26Q2", "26Q3"]);
});

/* ---------- medians, windows, rollups ---------- */

test("medianLag / lateCount / inTrailingMonths", () => {
  assert.equal(medianLag([]), null);
  assert.equal(medianLag([{ lag: 5 }, { lag: null }, { lag: 9 }]), 7);
  assert.equal(medianLag([{ lag: 5 }, { lag: 9 }, { lag: 30 }]), 9);
  assert.equal(lateCount([{ late: 1 }, { late: 0 }, { late: null }, { late: 1 }]), 2);
  assert.ok(inTrailingMonths({ traded: "2026-01-15", filed: "2026-02-01" }, "2026-07-24", 12));
  assert.ok(!inTrailingMonths({ traded: "2025-01-15", filed: "2025-02-01" }, "2026-07-24", 12));
  assert.ok(
    inTrailingMonths({ traded: null, filed: "2026-07-01" }, "2026-07-24", 12),
    "a dateless trade falls back to its filing date",
  );
});

test("topTickers: trailing 24m, count-ranked, flow as ranges", () => {
  const rows = [
    txn({ ticker: "AAA", traded: "2026-06-01" }),
    txn({ ticker: "AAA", traded: "2026-05-01" }),
    txn({ ticker: "BBB", traded: "2026-04-01" }),
    txn({ ticker: "OLD", traded: "2020-01-01" }), // outside the window
  ];
  const top = topTickers(rows, "2026-07-24", 24, 6);
  assert.deepEqual(top.map((t) => t.ticker), ["AAA", "BBB"]);
  assert.equal(top[0]!.n, 2);
  assert.equal(top[0]!.last, "2026-06");
  assert.equal(top[0]!.flow.kind, "closed");
});

test("membersDisclosing: counts are filed transactions, never netted", () => {
  const rows = [
    txn({ bioguide: "A000001", name: "A", side: "purchase", traded: "2026-06-01" }),
    txn({ bioguide: "A000001", name: "A", side: "sale", traded: "2026-05-01" }),
    txn({ bioguide: "B000002", name: "B", side: "sale_partial", traded: "2026-05-02" }),
  ];
  const m = membersDisclosing(rows, "2026-07-24", 12, 7);
  assert.equal(m[0]!.bioguide, "A000001");
  assert.equal(m[0]!.buys, 1);
  assert.equal(m[0]!.sells, 1);
  assert.equal(m[1]!.sells, 1, "sale_partial counts as a sale");
});

test("servingSince: earliest term start; malformed terms yield null, never a guess", () => {
  assert.equal(
    servingSince('[{"start":"1987-01-06","end":"1989-01-03"},{"start":"1991-01-03"}]'),
    "1987",
  );
  assert.equal(servingSince(null), null);
  assert.equal(servingSince("not json"), null);
  assert.equal(servingSince('{"start":"1987-01-06"}'), null, "non-array shape");
  assert.equal(servingSince('[{"start":"87-1-6"}]'), null, "malformed dates are skipped");
});

/* ---------- QoQ presentation mapping (Locked #8 — the full table) ---------- */

test("qoqPresentation: chip per change_kind; unknown kind fails closed to n/c", () => {
  assert.equal(qoqPresentation(qoq({ change_kind: "new" })).chipText, "new");
  assert.equal(qoqPresentation(qoq({ change_kind: "add" })).chipCls, "qoq-add");
  assert.equal(qoqPresentation(qoq({ change_kind: "trim" })).chipCls, "qoq-trim");
  const exit = qoqPresentation(qoq({ change_kind: "exit" }));
  assert.equal(exit.chipCls, "qoq-exit");
  assert.ok(exit.chipMarkers.includes("‡e"), "exit chip carries the exit-semantics marker");
  const un = qoqPresentation(qoq({ change_kind: "unclassified", flags: ["change_kind_undeterminable"] }));
  assert.equal(un.chipText, "n/c");
  assert.equal(un.chipCls, "qoq-nc");
  const unknown = qoqPresentation(qoq({ change_kind: "someday-new-kind" as never }));
  assert.equal(unknown.chipText, "n/c", "an unknown kind is NEVER guessed into a direction");
});

test("qoqPresentation: value_undisclosed_one_side → hatched n/c value delta, never $0", () => {
  const p = qoqPresentation(
    qoq({ delta_value_usd: null, prev_value_usd: null, flags: ["value_undisclosed_one_side"] }),
  );
  assert.deepEqual(p.valueDelta, { kind: "nc" });
  const plainNull = qoqPresentation(qoq({ delta_value_usd: null, flags: [] }));
  assert.deepEqual(plainNull.valueDelta, { kind: "dash" }, "NULL without the flag is an em-dash");
});

test("qoqPresentation: shares_unit_mismatch → em-dash shares + ‡u; classified_by_value → †v; reconciled → ‡r", () => {
  const p = qoqPresentation(
    qoq({
      delta_shares: null,
      flags: ["classified_by_value", "shares_unit_mismatch"],
    }),
  );
  assert.equal(p.sharesDeltaText, "—", "NULL Δshares is an em-dash, never 0");
  assert.ok(p.chipMarkers.includes("‡u"));
  assert.ok(p.chipMarkers.includes("†v"));
  const rec = qoqPresentation(qoq({ flags: ["identity_reconciled_by_cusip"] }));
  assert.deepEqual(rec.positionMarkers, ["‡r"]);
});

test("qoqPresentation: a disclosed zero delta prints 0; grain is disclosed", () => {
  const zero = qoqPresentation(qoq({ delta_shares: 0 }));
  assert.equal(zero.sharesDeltaText, "0", "a real zero is a disclosure and prints 0");
  const put = qoqPresentation(qoq({ put_call: "PUT", ssh_prnamt_type: "PRN" }));
  assert.equal(put.grainNote, "PUT · PRN");
  const unk = qoqPresentation(qoq({ ssh_prnamt_type: "UNKNOWN" }));
  assert.equal(unk.grainNote, "unit —");
  assert.equal(qoqPresentation(qoq()).grainNote, "", "LONG · SH is the quiet default grain");
});

/* ---------- S7 calendar (Locked #17) ---------- */

test("filingWindow: open within quarter-end + 45d, closed after", () => {
  const open = filingWindow("2026-07-24");
  assert.equal(open.quarterEnd, "2026-06-30");
  assert.equal(open.deadline, "2026-08-14");
  assert.equal(open.open, true);

  const closed = filingWindow("2026-08-20");
  assert.equal(closed.quarterEnd, "2026-06-30");
  assert.equal(closed.open, false);

  const q4 = filingWindow("2026-01-10");
  assert.equal(q4.quarterEnd, "2025-12-31");
  assert.equal(q4.deadline, "2026-02-14");
  assert.equal(q4.open, true);

  const exactly = filingWindow("2026-08-14");
  assert.equal(exactly.open, true, "the deadline day is still inside the window");
});

/* ---------- generic-route key parser ---------- */

test("parseEntityKey: strict shapes; ticker keys keep colon charset; CIKs pad", () => {
  assert.deepEqual(parseEntityKey("m:P000197"), { ok: true, kind: "m", key: "P000197" });
  assert.deepEqual(parseEntityKey("t:oust"), { ok: true, kind: "t", key: "OUST" });
  assert.deepEqual(parseEntityKey("t:CRYPTO:BTC"), { ok: true, kind: "t", key: "CRYPTO:BTC" });
  assert.deepEqual(parseEntityKey("f:1067983"), { ok: true, kind: "f", key: "0001067983" });
  assert.deepEqual(parseEntityKey(null), { ok: false, reason: "missing" });
  assert.deepEqual(parseEntityKey("m:notbioguide"), { ok: false, reason: "malformed" });
  assert.deepEqual(parseEntityKey("x:ZZZ"), { ok: false, reason: "malformed" });
  assert.deepEqual(parseEntityKey("t:<script>"), { ok: false, reason: "malformed" });
  assert.deepEqual(parseEntityKey("f:12345678901"), { ok: false, reason: "malformed" });
});

test("tickerDataKey: escaped endpoint names, collision-free", () => {
  // AMENDED with the encoding change, reason recorded (reversing-a-reviewed-
  // decision): the bare ':'→'~' scheme could not represent tickers with raw
  // whitespace — the first full Senate corpus contains one with a literal
  // newline, and the CI build died on the route's own emitted key. The escape
  // form is now ~XX per UTF-8 byte for every unsafe char, ':' and '$'
  // included; the escape char itself is escaped, which the old scheme never
  // did (BRK:B and a literal BRK~B collided). The PROPERTY (collision-free,
  // path-safe, payload carries the real ticker) is unchanged; only the byte
  // mechanism moved. Keys are per-build — nothing durable pins the old form.
  assert.equal(tickerDataKey("CRYPTO:BTC"), "CRYPTO~3ABTC");
  assert.equal(tickerDataKey("CADE$A"), "CADE~24A");
  assert.equal(memberDataPath("P000197"), "/congress/data/members/P000197.v1.json");
  assert.equal(tickerDataPath("CRYPTO:BTC"), "/congress/data/tickers/CRYPTO~3ABTC.v1.json");
});

/* ---------- fetch-outcome classifier (spec §3, every outcome) ---------- */

test("classifyResponse: 404 / 5xx / bad payload / version mismatch / ok", () => {
  assert.equal(classifyResponse(404, null).outcome, "not_found");
  assert.equal(classifyResponse(500, null).outcome, "server_error");
  assert.equal(classifyResponse(503, {}).outcome, "server_error");
  assert.equal(classifyResponse(200, null).outcome, "bad_payload");
  assert.equal(classifyResponse(200, "nope").outcome, "bad_payload");
  assert.equal(classifyResponse(200, { v: "1" }).outcome, "bad_payload");
  assert.equal(
    classifyResponse(200, { v: 999, kind: "m", t: [], p: [], meta: {} }).outcome,
    "version_mismatch",
  );
  assert.equal(
    classifyResponse(200, { v: DATASET_VERSION, kind: "x", t: [], p: [], meta: {} }).outcome,
    "bad_payload",
  );
  assert.equal(
    classifyResponse(200, { v: DATASET_VERSION, kind: "m", t: {}, p: [], meta: {} }).outcome,
    "bad_payload",
  );
  const ok = classifyResponse(200, { v: DATASET_VERSION, kind: "t", t: [], p: [], meta: {} });
  assert.equal(ok.outcome, "ok");
});

/* ---------- ticker→issuer mapping (Locked #18, spec §4) ---------- */

const FIXTURE_MAP_PATH = path.resolve(
  import.meta.dirname,
  "..",
  "..",
  "tests",
  "fixtures",
  "inst",
  "mcp",
  "company_tickers.json",
);

test("parseTickerMap: parity against the committed pipeline fixture", () => {
  const map = parseTickerMap(JSON.parse(readFileSync(FIXTURE_MAP_PATH, "utf-8")));
  assert.equal(map.read, 5);
  assert.equal(map.malformed, 0);
  const aapl = resolveTicker(map, "AAPL");
  assert.equal(aapl.state, "resolved");
  if (aapl.state === "resolved") {
    assert.equal(aapl.cik, "0000320193", "CIK normalizes to 10 digits per identity/registry.py");
    assert.equal(aapl.issuerKey, "entity:cik:0000320193");
    assert.equal(aapl.name, "Apple Inc.");
  }
  const brkb = resolveTicker(map, "BRK-B");
  assert.equal(brkb.state, "resolved", "share classes are ordinary one-to-many data");
  if (brkb.state === "resolved") assert.equal(brkb.cik, "0001067983");
  assert.equal(resolveTicker(map, "ZZZZ").state, "unmapped");
  assert.equal(resolveTicker(null, "AAPL").state, "no-map");
  assert.equal(resolveTicker(map, "aapl").state, "resolved", "lookup normalizes case");
});

test("parseTickerMap: one ticker naming two CIKs is AMBIGUOUS — rejected, never picked", () => {
  const map = parseTickerMap([
    { cik_str: 1, ticker: "DUP", title: "One Corp" },
    { cik_str: 2, ticker: "DUP", title: "Two Corp" },
  ]);
  assert.equal(resolveTicker(map, "DUP").state, "ambiguous");
});

test("parseTickerMap: DC1 title conflict rejects ALL of a CIK's rows", () => {
  const map = parseTickerMap([
    { cik_str: 7, ticker: "AAA", title: "Name One" },
    { cik_str: 7, ticker: "BBB", title: "Name Two" },
  ]);
  assert.equal(map.titleConflict, 2);
  assert.equal(resolveTicker(map, "AAA").state, "unmapped");
  assert.equal(resolveTicker(map, "BBB").state, "unmapped");
});

test("parseTickerMap: malformed rows and duplicates are counted and dropped", () => {
  const map = parseTickerMap([
    { cik_str: "12345678901", ticker: "BIG", title: "Too Big" }, // >10 digits
    { cik_str: 5, ticker: "bad ticker", title: "Spaces" },
    "not an object",
    { cik_str: 9, ticker: "OK", title: "Fine Corp" },
    { cik_str: 9, ticker: "OK", title: "Fine Corp" }, // duplicate pair
  ]);
  assert.equal(map.malformed, 3);
  assert.equal(map.duplicate, 1);
  assert.equal(resolveTicker(map, "OK").state, "resolved");
});

/* ---------- search index ---------- */

test("buildSearchIndex: exact tuple-arity allowlist; searchIndexValid guards shape", () => {
  const index = buildSearchIndex(
    [{ bioguide: "P000197", name: "Test Person", aff: "D–CA-11", rows: 12 }],
    [{ ticker: "NVDA", name: "NVIDIA Corp", rows: 35 }],
    [{ cik: "0001067983", name: "BERKSHIRE HATHAWAY INC", top: true }],
  );
  assert.equal(index.v, 1);
  assert.deepEqual(index.tickers, [["NVDA", "NVIDIA Corp", 35]]);
  assert.deepEqual(index.members, [["P000197", "Test Person", "D–CA-11", 12]]);
  // R22: the third scalar is the top/tail tier flag — a client hit must know
  // whether the pre-rendered route exists for this filer.
  assert.deepEqual(index.filers, [["1067983", "BERKSHIRE HATHAWAY INC", 1]], "CIK serialized unpadded");
  assert.ok(searchIndexValid(index));
  assert.ok(!searchIndexValid({ v: 2 }));
  // The allowlist is the tuple arity itself: every entry is exactly the
  // documented scalars, nothing extra can ride along unnoticed.
  for (const t of index.tickers) assert.equal(t.length, 3);
  for (const m of index.members) assert.equal(m.length, 4);
  for (const f of index.filers) assert.equal(f.length, 3);
});

test("searchQuery: ticker prefix, name substring, grouped, capped", () => {
  const index = buildSearchIndex(
    [
      { bioguide: "P000197", name: "Ann Alpha", aff: "D–CA-11", rows: 12 },
      { bioguide: "Q000001", name: "Bob Beta", aff: "R–TX-1", rows: 3 },
    ],
    [
      { ticker: "NVDA", name: "NVIDIA Corp", rows: 35 },
      { ticker: "NVCR", name: "", rows: 2 },
    ],
    [
      { cik: "0001067983", name: "Berkshire Hathaway Inc", top: true },
      { cik: "0000000042", name: "Berkshire Tail Capital", top: false },
    ],
  );
  const nv = searchQuery(index, "nv");
  assert.deepEqual(nv.filter((h) => h.kind === "ticker").map((h) => h.key), ["NVDA", "NVCR"]);
  const alpha = searchQuery(index, "alpha");
  assert.equal(alpha[0]!.kind, "member");
  assert.equal(alpha[0]!.href, "/congress/members/P000197/");
  const berk = searchQuery(index, "berkshire");
  assert.equal(berk[0]!.kind, "filer");
  assert.equal(berk[0]!.href, "/institutional/filers/1067983/");
  // R22: a tail filer hit routes through /e/ — the pre-rendered route does not
  // exist past the LD-7 cut, so linking it would be a dressed 404.
  assert.equal(berk[1]!.kind, "filer");
  assert.equal(berk[1]!.href, "/e/?k=f:42");
  assert.deepEqual(searchQuery(index, "  "), [], "blank query returns nothing");
});

/* ---------- budget walk (Locked #13) ---------- */

test("budgetWalk: deterministic rank-cut, members 1 page, tickers 2", () => {
  const members = [
    { bioguide: "A000001", rows: 10 },
    { bioguide: "B000002", rows: 30 },
    { bioguide: "C000003", rows: 20 },
  ];
  const tickers = [
    { ticker: "AAA", rows: 5 },
    { ticker: "BBB", rows: 9 },
  ];
  const cut = budgetWalk(members, tickers, 4);
  // ranked members: B(30), C(20), A(10) → 3 pages; remaining 1 < 2 → both tickers cut
  assert.deepEqual([...cut.cutMembers], []);
  assert.deepEqual([...cut.cutTickers].sort(), ["AAA", "BBB"]);
  const tight = budgetWalk(members, tickers, 2);
  assert.deepEqual([...tight.cutMembers], ["A000001"], "lowest-ranked member is cut");
  const roomy = budgetWalk(members, tickers, 100);
  assert.equal(roomy.cutMembers.size + roomy.cutTickers.size, 0);
});

test("groupEntities: rows bucket by bioguide and ticker, order preserved", () => {
  const t1 = txn({ bioguide: "A000001", ticker: "AAA", filed: "2026-07-21" });
  const t2 = txn({ bioguide: "A000001", ticker: "BBB", filed: "2026-07-20" });
  const p1: PaperRow = {
    kind: "paper",
    filed: "2026-07-19",
    name: "A",
    bioguide: "A000001",
    party: "D",
    state: "CT",
    district: null,
    chamber: "senate",
    doc: "https://example.gov/x",
  };
  const groups = groupEntities([t1, t2], [p1]);
  assert.deepEqual(groups.members.get("A000001")!.txns, [t1, t2]);
  assert.deepEqual(groups.members.get("A000001")!.paper, [p1]);
  assert.deepEqual(groups.tickers.get("AAA"), [t1]);
});

/* ---------- primary-source URLs ---------- */

test("primary-source URLs are https and entity-scoped", () => {
  assert.ok(edgarFilerUrl("0001067983").startsWith("https://www.sec.gov/"));
  assert.ok(bioguideProfileUrl("P000197").includes("P000197"));
});

test("tickerDataKey survives the Senate corpus's path-hostile ticker", () => {
  // The first full Senate ingest delivered a "ticker" containing a literal
  // newline; Astro cannot round-trip a static param with raw whitespace and
  // the CI build died with NoMatchingStaticPathFound on the route's own key.
  const hostile = "--\n                    AM";
  const key = tickerDataKey(hostile);
  assert.match(key, /^[A-Za-z0-9._~-]+$/);
  assert.ok(!/\s/.test(key));
  // Injective across near-collisions: the escape char itself, the legacy colon
  // form, and lookalikes must map to distinct keys — a collision serves one
  // ticker's data as another's.
  const keys = ["BRK:B", "BRK~B", "BRK~3AB", "BRK B", hostile, "--AM"].map(tickerDataKey);
  assert.equal(new Set(keys).size, keys.length, `collision in ${keys}`);
  // Plain tickers pass through untouched.
  assert.equal(tickerDataKey("AAPL"), "AAPL");
  assert.equal(tickerDataKey("BRK.B"), "BRK.B");
});

test("path-hostile tickers ride the /e/ fallback, never a dead page", () => {
  const hostile = "--\n                    AM";
  assert.equal(pathSafeTicker(hostile), false);
  assert.equal(pathSafeTicker("AAPL"), true);
  // AMENDED, reason recorded: ':' is page-safe for the build and the URL, but
  // actions/upload-artifact refuses colon paths (Windows-invalid), and the
  // deploy travels as an artifact — proven on the runner with CRYPTO:BTC.
  assert.equal(pathSafeTicker("BRK:B"), false);
  const ctx = { cutTickers: new Set() };
  assert.ok(tickerHrefFor(hostile, ctx).startsWith("/e/?k=t:"));
  assert.ok(tickerHrefFor("AAPL", ctx).startsWith("/tickers/")); // Locked #4: canonical page
});

test("over-long hostile tickers cap under the filename limit, digest-tailed", () => {
  // The REAL corpus form: multiple newlines and ~40 spaces — the escaped key
  // tripled past 255 bytes and the runner died with ENAMETOOLONG.
  const monster = "--\n" + " ".repeat(40) + "\n" + " ".repeat(40) + "AM";
  const key = tickerDataKey(monster);
  assert.ok(key.length + ".v1.json".length <= 200, `key too long: ${key.length}`);
  assert.match(key, /^[A-Za-z0-9._~-]+$/);
  assert.ok(!/\s/.test(key));
  // Distinct monsters stay distinct (digest tail differs).
  const other = tickerDataKey(monster + "X");
  assert.notEqual(key, other);
  // Short keys are untouched by the cap.
  assert.equal(tickerDataKey("AAPL"), "AAPL");
});
