/* DESIGN-POLISH M3 — content hygiene (R17–R25; Tasks T3.1–T3.9; the carried
   items CD-3 and M2V-D2).

   Every test here pins a PROPERTY of what the reader sees, over the real
   renderers, and each one carries a control that re-plants the defect and
   must be caught — a check that cannot fail proves nothing. The post-build
   dist scan (`test/post/refinement-dist.test.ts`) runs the same predicates
   (`test/lib/content-scan.ts`) over every built page; their detection is
   proved here, in the contributor tier. */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  ASSET_TYPE_WORDS,
  CHANGE_KIND_WORDS,
  assetLineHtml,
  displayAsset,
  fmtCik,
  joinQualifiers,
  kindWord,
  sideLabel,
  txnRowHtml,
  type RenderCtx,
  type TxnRow,
} from "../src/lib/format.ts";
import { qoqPresentation } from "../src/lib/derive.ts";
import {
  changesTableHtml,
  entityTxnRowsHtml,
  filerEdgarBlock,
  hitRowHtml,
  memberV2Sections,
  qoqChipHtml,
  sectorLabel,
  SECTOR_LABELS,
  tickerHoldersBody,
} from "../src/lib/ui/index.ts";
import { netKindWord } from "../src/lib/ui/shared.ts";
import {
  activityFeedHtml,
  activityBoundHtml,
  paginateActivity,
  truncationNoticeHtml,
  type ActivityFeed,
  type ActivityRecord,
  type FilingDictionary,
} from "../src/lib/activity.ts";
import { biggestChangeCellHtml } from "../src/lib/manager-directory.ts";
import { notableMovesBandHtml, type NotableMove } from "../src/lib/notable-moves.ts";
import {
  diffPeriods,
  holdingsCaveatHtml,
  holdingsTableHtml,
  positionDiffHtml,
  presentedHoldingFlags,
  projectionAbsentHtml,
  type FilerHoldingRow,
} from "../src/lib/holdings.ts";
import { directoryEmptyText, instIndexBodyHtml, type InstIndexRow } from "../src/lib/inst-index.ts";
import { instFreshnessText } from "../src/lib/inst-adds.ts";
import type { QoqDeltaRow } from "../src/lib/inst.ts";
import type { Signal } from "../src/lib/signals.ts";
import { domOf, visibleText } from "./lib/ledger-dom.ts";
import { contentHits } from "./lib/content-scan.ts";
import { addTrimRows } from "./lib/kind-rows.ts";
import { FILINGS } from "./fixtures/institutional.ts";

const SRC = path.resolve(import.meta.dirname, "..", "src");
const REPO = path.resolve(import.meta.dirname, "..", "..");
const CTX: RenderCtx = { watched: new Set() };

function txn(over: Partial<TxnRow> = {}): TxnRow {
  return {
    kind: "txn", filed: "2026-05-01", traded: "2026-03-16", name: "Jane Doe", bioguide: "D000001", party: "D",
    state: "CA", district: "11", chamber: "house", ticker: "AAPL", side: "purchase", owner: null,
    low: 1001, high: 15000, lag: 46, late: 0, flags: [], doc: "https://disclosures-clerk.house.gov/x.pdf",
    asset: "Apple Inc. - Common Stock (AAPL) [ST]", assetType: "ST", txnId: "t-1",
    ...over,
  };
}

/* ======================================================= T3.1 kind words */

test("T3.1 (R19): every 13F surface reads the ONE caps vocabulary; unknown kinds fail closed to n/c", () => {
  const expected: Record<string, string> = { new: "NEW", add: "ADD", trim: "TRIM", exit: "EXIT", held: "NO CHANGE", no_prior: "NO PRIOR", unclassified: "n/c" };
  for (const [k, w] of Object.entries(expected)) assert.equal(kindWord(k).word, w, k);
  assert.equal(kindWord("someday").word, "n/c", "an unknown kind is never guessed");
  assert.equal(kindWord("toString").word, "n/c", "no prototype key reads as a kind");
  assert.deepEqual(Object.keys(CHANGE_KIND_WORDS).sort(), Object.keys(expected).sort());
  const q = (kind: string): QoqDeltaRow => ({
    cik: "0001", position_key: "sid:a", put_call: "LONG", curr_period: "2026-03-31", prev_period: "2025-12-31",
    change_kind: kind as QoqDeltaRow["change_kind"], prev_value_usd: 1, curr_value_usd: 2, delta_value_usd: 1,
    prev_shares: 1, curr_shares: 2, delta_shares: 1, ssh_prnamt_type: "SH", flags: [],
  });
  // the changes table's chip, with the exit marker kept
  const exit = qoqChipHtml(q("exit"));
  assert.match(exit, /<span class="qoq-chip qoq-exit">EXIT<\/span><span class="fn-ref">‡e<\/span>/);
  assert.equal(qoqPresentation(q("no_prior")).chipText, "NO PRIOR");
  // the directory's change line leads with the word
  const cell = biggestChangeCellHtml({ best: { row: { ...q("trim"), issuer_name: "NVIDIA CORP" }, delta_value_usd: -5_000_000, classifiedByValue: false }, unrankable: 0 } as never);
  assert.match(visibleText(domOf(cell)), /^TRIM NVIDIA CORP −\$5\.0M/);
  // notable moves (band row) — the kind cell
  const move: NotableMove = { cik: "0000000001", manager: "M", principal: null, type: "hedge_fund", issuer: "I", ticker: null, ticker_verified: null, kind: "add", delta_shares: 1, curr_value: 1, delta_value: 1, filed: "2026-05-15", doc: null, key: "k", ikey: null } as never;
  const band = notableMovesBandHtml([move], { periods: ["2026-03-31"], period: "2026-03-31", filerHref: (c) => `/f/${c}` });
  const kinds = domOf(band).querySelectorAll("td.c-kind").map((td) => visibleText(td).trim());
  assert.deepEqual(kinds, ["ADD"]);
  // the activity feed (both row forms) — the word, never the pill
  const rec: ActivityRecord = {
    cik: "0001067983", filer_name: "F", issuer_key: "entity:1", issuer_name: "APPLE INC", position_key: "sid:a", put_call: "LONG", ssh_prnamt_type: "SH",
    change_kind: "trim", curr_period: "2026-03-31", prev_period: "2025-12-31", prev_value_usd: 2, curr_value_usd: 1, delta_value_usd: -1,
    prev_shares: 2, curr_shares: 1, delta_shares: -1, filing_keys: [1], prior_filing_keys: [], current_filing_keys: [], flags: [],
  };
  const feed: ActivityFeed = { present: true, reason: null, filings: FILINGS_ACT, pagination: paginateActivity([rec], FILINGS_ACT), records: [rec] } as ActivityFeed;
  for (const html of [activityFeedHtml(feed), activityFeedHtml(feed, { reference: true })]) {
    const cell = domOf(html).querySelectorAll("td.c-kind")[0]!;
    assert.equal(visibleText(cell).replace(/§/g, "").split(" ")[0]!.trim(), "TRIM");
  }
  // control: the retired lowercase pill is caught by the dist scan's predicate
  assert.ok(contentHits('<td class="c-kind"><span class="qoq-chip qoq-add">add</span></td>').some((h) => h.check === "a lowercase kind pill"));
  assert.equal(contentHits('<td class="c-kind"><span class="qoq-chip qoq-add">ADD</span></td>').length, 0);
});

/* The dist check's reader (R8, rewritten M3): an ADD or TRIM on an unchanged
   share count is allowed only when the row itself discloses the pre-R8 value
   classification (†v); the controls are the post-build test's own. */
test("T3.1 (R8 reader): ADD/TRIM rows are read by DOM parse, with their Δ shares and their †v disclosure", () => {
  const page = (kindCell: string, delta: string): string =>
    `<table class="etable"><thead><tr><th>Position</th><th class="c-kind">Change</th><th>Δ value</th><th>Δ shares</th></tr></thead>` +
    `<tbody id="filer-changes-tbody"><tr id="pos-x" data-edge="add"><td class="c-pos">X</td><td class="c-chip c-kind">${kindCell}</td><td class="c-num">+$1K</td><td class="c-num">${delta}</td></tr></tbody></table>`;
  assert.deepEqual(addTrimRows(page('<span class="qoq-chip qoq-add">ADD</span>', "+10")), [{ kind: "ADD", deltaShares: "+10", valueClassified: false }]);
  assert.deepEqual(addTrimRows(page('<span class="qoq-chip qoq-add">ADD</span><span class="fn-ref">†v</span>', "0")), [{ kind: "ADD", deltaShares: "0", valueClassified: true }]);
  assert.deepEqual(addTrimRows(page('<span class="qoq-chip qoq-new">NEW</span>', "+5")), [], "a NEW row is not collected");
  assert.equal(addTrimRows("<p>no table</p>"), null);
  assert.throws(() => addTrimRows(page("ADD", "0").replace("<th>Δ shares</th>", "<th>Shares</th>")), /no "Δ shares" column/, "a table without the column cannot pass silently");
});

test("T3.1: the two-period comparison keeps its OWN words (ADDED / ABSENT …), because it is not a QoQ classification", () => {
  /* one position per class: added, absent (present before, missing now),
     increased, decreased and unchanged — so every word is exercised, and an
     absence called EXIT would be seen (the mutation check found the old
     fixture had no absent row, so that control passed on nothing) */
  const row = (period: string, key: string, value: number): FilerHoldingRow => ({
    cik: "0001067983", period, filing_key: "1", security_id: null, cusip: key, issuer_name: `CO ${key}`, title_of_class: "COM",
    value_usd: value, shares: value, ssh_type: "SH", put_call: null, position_key: `cusip:${key}`, put_call_bucket: "LONG", unit_key: "SH", flags: [],
  } as FilerHoldingRow);
  const prior = [row("2025-12-31", "111111111", 10), row("2025-12-31", "222222222", 10), row("2025-12-31", "333333333", 10), row("2025-12-31", "444444444", 10)];
  const current = [row("2026-03-31", "222222222", 20), row("2026-03-31", "333333333", 5), row("2026-03-31", "444444444", 10), row("2026-03-31", "555555555", 7)];
  const html = positionDiffHtml(diffPeriods(current, prior, { current: "2026-03-31", prior: "2025-12-31" }), 0);
  const words = domOf(html).querySelectorAll("td.c-kind").map((td) => visibleText(td).replace(/‡a/g, "").trim()).sort();
  assert.deepEqual(words, ["ABSENT", "ADDED", "DECREASED", "INCREASED", "UNCHANGED"]);
  assert.ok(!words.some((w) => ["NEW", "EXIT", "ADD", "TRIM"].includes(w)), "control: absence is never called an EXIT here");
});

const FILINGS_ACT: FilingDictionary = {
  "1": { accession: "0000000000-26-000001", submission_type: "13F-HR", period_of_report: "2026-03-31", filed_date: "2026-05-10", doc_url: "https://www.sec.gov/Archives/1", source: "sec-edgar" },
  "2": { accession: "0000000000-26-000002", submission_type: "13F-HR", period_of_report: "2026-03-31", filed_date: "2026-05-01", doc_url: "https://www.sec.gov/Archives/2", source: "sec-edgar" },
};

/* ======================================================= T3.2 trade words */

test("T3.2 (R18): BUY / SELL / EXCHANGE / — everywhere; a late row keeps its side and its LATE·Nd", () => {
  assert.deepEqual(
    (["purchase", "sale", "sale_partial", "exchange"] as const).map((s) => sideLabel(s).text),
    ["BUY", "SELL", "SELL", "EXCHANGE"],
  );
  assert.equal(sideLabel("other", ["side_unparsed"]).text, "—");
  const late = txnRowHtml(txn({ side: "sale", late: 1, lag: 46 }), { ...CTX, referenceFeed: true });
  const row = domOf(late).querySelectorAll("tr")[0]!;
  assert.equal(row.getAttribute("data-edge"), "late", "lateness is the gold edge");
  const kind = row.querySelector("td.c-kind")!;
  assert.match(visibleText(kind), /^SELL/, "the late row keeps its side word (L4)");
  assert.ok(late.includes("LATE·46d"), "the dates cell keeps LATE·Nd, format unchanged");
  /* control (P-10, M3 review — the old control matched a string literal
     against itself): the retired rendering, the late row's kind cell reading
     LATE, planted into the real row, fails the same side-word check */
  const retired = domOf(late.replace(/(<td class="cell cell-side c-kind [^"]*">)SELL/, "$1LATE"));
  assert.doesNotMatch(visibleText(retired.querySelectorAll("tr")[0]!.querySelector("td.c-kind")!), /^SELL/, "control: a LATE kind cell is caught");
  // the member flows' Net words
  assert.equal(netKindWord({ kind: "finite", low: 5000, high: 15000 }).word, "NET BUY");
  assert.equal(netKindWord({ kind: "finite", low: -15000, high: -1000 }).word, "NET SELL");
  assert.equal(netKindWord({ kind: "finite", low: -15000, high: 5000 }).word, "FLAT", "bounded, spanning zero");
  assert.equal(netKindWord({ kind: "empty" }).word, "FLAT", "a summed zero is bounded [0, 0]");
  assert.equal(netKindWord({ kind: "undisclosed" }).word, "—", "an undisclosed side states no direction");
  assert.equal(netKindWord({ kind: "unbounded" }).word, "—");
  assert.equal(netKindWord({ kind: "upper-open", low: -1000 }).word, "—", "open above and reaching below zero");
  assert.equal(netKindWord({ kind: "upper-open", low: 1000 }).word, "NET BUY", "open above but provably positive");
  assert.equal(netKindWord({ kind: "lower-open", high: -1000 }).word, "NET SELL");
  assert.ok(netKindWord({ kind: "undisclosed" }).why, "the '—' says why");
  // control: FLAT for an undisclosed side would be a claim with no range under it
  assert.notEqual(netKindWord({ kind: "undisclosed" }).word, "FLAT");
  // the watch band speaks the rule book's words — its private map is gone
  const client = readFileSync(path.join(SRC, "scripts", "signals-client.ts"), "latin1");
  assert.doesNotMatch(client, /const SHORT\b/);
  assert.match(client, /signalKindShort\(/);
  // the side filter's segments
  const congress = readFileSync(path.join(SRC, "pages", "congress", "index.astro"), "utf-8");
  assert.match(congress, /data-value="buy"[^>]*>BUY</);
  assert.match(congress, /data-value="sell"[^>]*>SELL</);
  assert.match(congress, /data-value="exch"[^>]*>EXCHANGE</);
  // control: the dist predicate catches a retired side word in a cell
  assert.ok(contentHits("<td class=\"c-kind\">Purchase</td>").some((h) => h.check === "a cell reads the retired side word"));
  assert.equal(contentHits("<td class=\"c-kind\">BUY</td>").length, 0);
});

/* ================================================== T3.3 asset and owner */

test("T3.3 (R17): one qualifier join — no '· ·', no cell opening with a separator", () => {
  const rows = [
    txn({ side: "sale_partial", owner: "spouse" }),
    txn({ side: "purchase", owner: "joint", txnId: "t-2" }),
    txn({ side: "sale", owner: null, txnId: "t-3" }),
  ];
  const html = [
    ...rows.map((r) => txnRowHtml(r, { ...CTX, referenceFeed: true })),
    ...rows.map((r) => txnRowHtml(r, CTX)),
    entityTxnRowsHtml(rows, "member", CTX),
    entityTxnRowsHtml(rows, "ticker", CTX),
  ].join("\n");
  assert.deepEqual(contentHits(`<table><tbody>${html}</tbody></table>`).filter((h) => /separator/.test(h.check)), []);
  assert.ok(html.includes('<span class="owner-note">partial · SP'), "partial first, then the owner, one separator");
  assert.equal(joinQualifiers(["Apple Inc.", null, "", "partial"]), "Apple Inc. · partial");
  // controls: the old doubled join, and an owner cell that opens with "·", are both caught
  assert.ok(contentHits('<td class="cell-asset">Apple Inc. <span class="owner-note">· · partial</span></td>').some((h) => h.check === "doubled separator"));
  assert.ok(contentHits('<td class="c-owner">· SP</td>').some((h) => h.check === "cell begins with a separator"));
});

test("T3.3 (R17): the default asset text drops [ST], the ticker and 'Common Stock'; other codes become the House Clerk's words; unknown codes keep their bracket", () => {
  assert.equal(displayAsset({ asset: "Apple Inc. - Common Stock (AAPL) [ST]", assetType: "ST", ticker: "AAPL" }).text, "Apple Inc.");
  assert.equal(displayAsset({ asset: "Medtronic plc. - Ordinary Shares (MDT) [ST]", assetType: "ST", ticker: "MDT" }).text, "Medtronic plc.");
  assert.equal(displayAsset({ asset: "Netflix, Inc. (NFLX) [OP]", assetType: "OP", ticker: "NFLX" }).text, "Netflix, Inc. · Options");
  assert.equal(displayAsset({ asset: "U.S. Treasury Note [GS]", assetType: "GS", ticker: null }).text, "U.S. Treasury Note · Government Securities and Agency Debt");
  assert.equal(displayAsset({ asset: "Mystery Holding [ZZ]", assetType: "ZZ", ticker: null }).text, "Mystery Holding [ZZ]", "an unknown code keeps its bracket");
  assert.equal(displayAsset({ asset: "Alphabet Inc. - Class A Common Stock (GOOGL) [ST]", assetType: "ST", ticker: "GOOGL" }).text, "Alphabet Inc. - Class A", "the share class is never dropped");
  assert.equal(displayAsset({ asset: "Acme Corp (OTHER) [ST]", assetType: "ST", ticker: "ACME" }).text, "Acme Corp (OTHER)", "a parenthesis that is not the row's ticker stays");
  assert.equal(displayAsset({ asset: "Common Stock (AAPL) [ST]", assetType: "ST", ticker: "AAPL" }).text, "Common Stock (AAPL) [ST]", "a name that is only the stripped parts keeps its filed form");
  assert.equal(displayAsset({ asset: null, assetType: null, ticker: null }).text, "Asset not named");
  // the table is the Clerk's 48 codes, with the ones this corpus carries
  assert.equal(Object.keys(ASSET_TYPE_WORDS).length, 48);
  for (const c of ["ST", "OP", "GS", "CS", "OT", "HN", "PS", "OI", "VA", "CT", "AB", "OL", "ET", "SA", "RS"]) assert.ok(ASSET_TYPE_WORDS[c], `code ${c}`);
  /* the as-filed string is the label trigger's note, and it is in the DOM (it
     prints) — on a row whose name differs from the filing in more than the
     column note's mechanical parts (CD3-4 (c), M3 review; rewritten
     property-first: the Apple row this used to read now carries no per-row
     note, by design) */
  const line = assetLineHtml(txn({ asset: "Netflix, Inc. (NFLX) [OP]", assetType: "OP", ticker: "NFLX", side: "sale_partial", owner: "spouse" }), { notes: { scope: "t" }, qualifiers: true });
  const dom = domOf(line);
  const pop = dom.querySelectorAll(".note-pop")[0]!;
  assert.equal(visibleText(pop).trim(), "As filed: Netflix, Inc. (NFLX) [OP]", "the code's words are in the cell, so the note does not repeat them (CD3-4 (b))");
  assert.equal(visibleText(dom.querySelectorAll(".note-label")[0]!).replace(", explain", "").trim(), "Netflix, Inc. · Options");
  // the qualifiers sit OUTSIDE the ellipsis box, never inside it
  const text = dom.querySelectorAll(".asset-text")[0]!;
  assert.ok(!visibleText(text).includes("SP"), "the qualifiers are not inside the truncating asset text");
  const quals = dom.querySelectorAll(".asset-line .owner-note");
  assert.equal(quals.length, 1);
  assert.ok(quals[0]!.parent?.classList.contains("asset-line"), "they are the asset line's own flex item");
  // control: an unchanged name carries no note (nothing is hidden)
  assert.doesNotMatch(assetLineHtml(txn({ asset: "Home Depot, Inc.", assetType: "ST" }), { notes: { scope: "t" } }), /note-pop/);
  // print: the asset line's panel lays out in flow and wraps (the rule exists)
  const late = readFileSync(path.join(SRC, "styles", "late-additions.css"), "utf-8");
  const print = late.slice(late.indexOf("@media print"));
  assert.match(print, /\.asset-line > \.asset-text,[\s\S]*?white-space: normal/);
});

test("T3.3 (R17; W-9, CD3-4): the member's net-flow Issuer cell shows the NAME, its note keyed on the ticker, only when more than the mechanical parts differ", () => {
  const m = {
    bioguide: "T000001", name: "Fixture Member", party: "R", state: "OK", district: null, chamber: "senate", servingSince: "1999", filingCount: 1,
    txns: [
      txn({ ticker: "CVX", asset: "Chevron Corporation (CVX) [ST]", assetType: "ST", side: "purchase", txnId: "t-cvx" }),
      txn({ ticker: "NFLX", asset: "Netflix, Inc. (NFLX) [OP]", assetType: "OP", side: "purchase", txnId: "t-nflx" }),
    ],
    paper: [],
  };
  const html = memberV2Sections(m as never, { buildId: "b", generatedAt: "2026-07-24 06:56 UTC", generatedAtDate: "2026-07-24" }, CTX, { resolveSector: null, sectorMeta: null, committees: null });
  const dom = domOf(html);
  const cellOf = (ticker: string) =>
    dom.querySelectorAll("tr.design-net-row").find((tr) => visibleText(tr.querySelector("td.c-ticker")!).trim() === ticker)!.querySelector("td.design-issuer")!;
  // a mechanical-only row: the name, and NO per-row note (the header states the rule)
  const cvx = cellOf("CVX");
  assert.equal(visibleText(cvx).trim(), "Chevron Corporation");
  assert.equal(cvx.querySelectorAll(".note-pop").length, 0, "CD3-4 (c): no per-row note for a mechanical-only difference");
  // a row whose newest trade is an option: the NAME only (W-9), the note gives the filing and the code
  const nflx = cellOf("NFLX");
  assert.equal(visibleText(nflx.querySelectorAll(".note-label")[0]!).replace(", explain", "").trim(), "Netflix, Inc.", "W-9: no type words on a row that nets every trade");
  assert.equal(visibleText(nflx.querySelectorAll(".note-pop")[0]!).trim(), "As filed: Netflix, Inc. (NFLX) [OP] · type code OP: Options");
  assert.equal(nflx.querySelectorAll(".note-pop")[0]!.getAttribute("id"), "n-mf-nflx", "CD3-4 (a): keyed on the ticker");
  // the Issuer header carries the rule once
  const issuerHead = dom.querySelectorAll("th").find((th) => /^Issuer/.test(visibleText(th).trim()))!;
  assert.match(visibleText(issuerHead.querySelectorAll(".note-pop")[0]!), /a trailing “\(TICKER\)” that is the row's ticker, the stock code “\[ST\]”/);
  // controls: the retired forms — the type words in the label, a txn-keyed id
  assert.doesNotMatch(visibleText(nflx), /· Options/);
  assert.doesNotMatch(html, /n-member-flow-asset-/);
});

/* ======================================================= T3.4 CIKs */

test("T3.4 (R20): fmtCik drops leading zeros for the reader and keeps the machine form elsewhere", () => {
  assert.equal(fmtCik("0001135730"), "1135730");
  assert.equal(fmtCik("1067983"), "1067983");
  assert.equal(fmtCik(92230), "92230");
  assert.equal(fmtCik("0000000000"), "0");
  assert.ok(contentHits("<p>filer CIK 0001135730</p>").some((h) => h.check === "zero-padded CIK"), "control: a padded CIK is caught");
  assert.ok(contentHits('<table><tr><td class="c-num c-muted">0001135730</td></tr></table>', "institutional/index.html").some((h) => /directory CIK/.test(h.check)));
  assert.equal(contentHits('<table><tr><td class="c-num c-muted">1135730</td></tr></table>', "institutional/index.html").length, 0);
  const row: InstIndexRow = { reference: true, cik: "0001135730", name: "COATUE", period: "2026-03-31", value: 1, positions: 1, nullValuePositions: 0, hhi: 1, hhiNote: "", tier: "top", typing: null, changeHtml: null } as never;
  const body = instIndexBodyHtml([row], "", "value", "desc", { types: new Set(), notableOnly: false }, undefined, ["filer", "cik", "value", "positions", "latest-notable"]);
  assert.match(body.html, /<td class="c-num c-muted">1135730<\/td>/);
  /* P-10 (M3 review): each machine field pinned on its own — the route keeps
     its own path form, and the padded CIK survives in the machine attributes
     (the note ids), never in the text a reader sees */
  assert.match(body.html, /href="\/institutional\/filers\/1135730\/"/, "the route's own path form");
  assert.match(body.html, /popovertarget="n-inst-index-row-0001135730-/, "the padded CIK stays in the machine fields");
  assert.doesNotMatch(visibleText(domOf(body.html)), /0001135730/, "…and never in the reader's text");
});

/* ======================================================= T3.6 sectors */

test("T3.6 (R22): every sector key in sic_taxonomy.yaml, and the unknown bucket, has a label", () => {
  const yaml = readFileSync(path.join(REPO, "src", "populus", "sic_taxonomy.yaml"), "utf-8");
  const keys = [...new Set([...yaml.matchAll(/sector:\s*([a-z-]+)/g)].map((m) => m[1]!))];
  const unknown = /unknown_bucket:\s*([a-z-]+)/.exec(yaml)![1]!;
  assert.ok(keys.length >= 10, "the taxonomy's keys were read");
  const unlabeled = (labels: Readonly<Record<string, string>>): string[] => [...keys, unknown].filter((k) => !Object.hasOwn(labels, k));
  assert.deepEqual(unlabeled(SECTOR_LABELS), []);
  assert.equal(sectorLabel("finance-insurance-realestate"), "Finance, Insurance, and Real Estate");
  assert.match(sectorLabel("unknown"), /^Unknown/);
  // control: a key added to the taxonomy with no label fails
  const { manufacturing: _drop, ...missing } = SECTOR_LABELS;
  assert.deepEqual(unlabeled(missing), ["manufacturing"]);
});

/* ======================================================= T3.7 receipts */

test("T3.7 (R23): the Signals source cell prints its regime once", () => {
  const s = (over: Partial<Signal>): Signal => ({
    id: "s1", kind: "s1-large", rule: "r", thresholdVersion: "1", entities: { bioguide: "A000001", memberName: "A", ticker: "ABC" },
    magnitude: { low: 250001, high: 500000 }, receipts: ["https://disclosures-clerk.house.gov/public_disc/ptr-pdfs/2026/1.pdf"],
    occurrence: { tradeDate: "2026-03-01", filedDate: "2026-06-01" }, sourceAvailableAt: "", computedAt: "", firstSeenBuild: "b", lastSeenBuild: "b",
    status: "active", cohort: "house", ...over,
  } as Signal);
  const house = hitRowHtml(s({}), CTX);
  const src = domOf(house).querySelectorAll("td.c-src")[0]!;
  assert.equal((visibleText(src).match(/PTR/g) ?? []).length, 1, "PTR once");
  const senate = hitRowHtml(s({ cohort: "senate", receipts: ["https://efdsearch.senate.gov/x"] }), CTX);
  assert.equal((visibleText(domOf(senate).querySelectorAll("td.c-src")[0]!).match(/eFD/g) ?? []).length, 1, "eFD once");
  // a row with no receipt still states its regime (the stamp alone)
  const none = hitRowHtml(s({ receipts: [] }), CTX);
  assert.match(visibleText(domOf(none).querySelectorAll("td.c-src")[0]!), /PTR —/);
  // control: the doubled receipt is caught by the dist predicate
  assert.ok(contentHits('<td class="c-src"><span class="si-stamp">PTR</span> <a>PTR ↗</a></td>').some((h) => h.check === "doubled receipt"));
});

/* ============================================ T3.8 the copy of section H */

function notableFeed(): { feed: ActivityFeed; ciks: Set<string> } {
  const r = (o: Partial<ActivityRecord>): ActivityRecord => ({
    cik: "0001067983", filer_name: "Notable", issuer_key: "entity:1", issuer_name: "APPLE INC", position_key: "sid:a", put_call: "LONG", ssh_prnamt_type: "SH",
    change_kind: "add", curr_period: "2026-03-31", prev_period: "2025-12-31", prev_value_usd: 1, curr_value_usd: 2, delta_value_usd: 1,
    prev_shares: 1, curr_shares: 2, delta_shares: 1, filing_keys: [1], prior_filing_keys: [], current_filing_keys: [], flags: [], ...o,
  });
  // the NEWEST notable row is NOT the largest: the order must be newest first
  const records = [
    r({ position_key: "sid:big-older", delta_value_usd: 9_000, filing_keys: [2] }),
    r({ position_key: "sid:small-newest", delta_value_usd: 5, filing_keys: [1] }),
    ...Array.from({ length: 12 }, (_, i) => r({ position_key: `sid:n${i}`, delta_value_usd: 100 + i, filing_keys: [1] })),
  ];
  return { feed: { present: true, reason: null, filings: FILINGS_ACT, pagination: paginateActivity(records, FILINGS_ACT), records } as ActivityFeed, ciks: new Set(["0001067983"]) };
}

test("T3.8 (H-1, V1 NEW-2, V1 NEW-3): over notable rows the bound, the caption and the count all say newest-first", () => {
  const { feed, ciks } = notableFeed();
  const html = activityFeedHtml(feed, { reference: true, notableCiks: ciks });
  const extra = html.slice(html.indexOf('<span class="compact-bound-extra">'));
  assert.match(extra, /^<span class="compact-bound-extra"> These rows are notable managers' new, added, trimmed and exited positions, newest filing first, then largest change\. This build publishes all 14 of its changes, ranked by size of change with undisclosed values last, as 1 file of at most 2,000 changes or 2,097,152 bytes each\. <a href="[^"]+">Open the first file ↗<\/a>/);
  assert.match(html, /<caption class="visually-hidden">Quarter-over-quarter position changes by notable managers, newest filing first, then largest change<\/caption>/);
  assert.match(html, /1–10 of the 14 newest changes by notable managers shown here/);
  // controls: the old sentences over these rows are false and absent
  assert.doesNotMatch(html, /These rows are the largest of/, "control: the 'largest' bound over newest-first rows");
  assert.doesNotMatch(html, /ordered by absolute reported change<\/caption>/, "control: the literal caption over notable rows");
  assert.doesNotMatch(html, /1–10 of 14 changes/, "control: the bare count");
  // over the first file's rows the caption keeps its size order
  const first = activityFeedHtml(feed, { reference: true });
  assert.match(first, /ordered by absolute reported change<\/caption>/);
  assert.match(first, /These rows are the largest of the 14 changes this build publishes, ranked by size of change/);
  // every number the bound prints comes from its fields
  assert.match(activityBoundHtml({ notable: true, emitted: 128_000, total: 3_567_905, files: 64, recordLimit: 2_000, byteLimit: 2_097_152, firstShard: "/x/0.v1.json" }), /the first 128,000 of its 3,567,905 changes, ranked by size of change with undisclosed values last, as 64 files of at most 2,000 changes or 2,097,152 bytes each/);
});

test("T3.8 (H-2, V1 NEW-5): the truncation states the exact boundary, and the rest 'can be derived from' EDGAR", () => {
  const key = { cik: "0001759654", position_key: "sid:sec:prov:abc", put_call: "LONG", ssh_prnamt_type: "SH", delta_value_usd: -18_213_456, abs_delta_value_usd: 18_213_456 };
  const disclosed = truncationNoticeHtml({ dropped_records: 3_439_905, boundary_sort_key: key as never }, 64);
  assert.match(disclosed, /This list stops at 64 files: <strong>3,439,905<\/strong> further changes are not published here — none larger than /);
  assert.match(disclosed, />\$18,213,456<\/button>/, "exact, never fmtUsd's $18.2M");
  assert.match(disclosed, /The first change left out: filer CIK 1759654, position provisional position id \(key as published: <code>sid:sec:prov:abc<\/code>\) · LONG · SH\./);
  assert.match(disclosed, /They can be derived from the filings on EDGAR\./);
  const undisclosed = truncationNoticeHtml({ dropped_records: 3_439_905, boundary_sort_key: { ...key, delta_value_usd: null, abs_delta_value_usd: null } as never }, 64);
  assert.match(undisclosed, /every change with a disclosed value is published, and <strong>3,439,905<\/strong> changes whose value was/);
  assert.match(undisclosed, />not disclosed<\/button>/, "the null branch's label trigger");
  assert.match(undisclosed, /They can be derived from the filings on EDGAR\./);
  for (const html of [disclosed, undisclosed]) {
    assert.doesNotMatch(html, /remains? in the filings/, "control: 'remain in' — no filing prints a change");
    assert.doesNotMatch(html, /publication limit|ordered set/);
  }
});

test("T3.8 (G-11, V1 NEW-4): the empty-activity sentence is true of what QoQ emits", () => {
  const empty: ActivityFeed = { present: true, reason: null, filings: {}, pagination: paginateActivity([], {}) } as ActivityFeed;
  const html = activityFeedHtml(empty);
  assert.match(html, /either this build holds one period only, or neither quarter has a position with a security identifier/);
  assert.doesNotMatch(html, /appears in both quarters|nothing keyable/, "control: the false and the pipeline wordings");
});

test("T3.8 (V1 NEW-1): the EDGAR block and the holdings-absent sentence state the 2026-08-01 decision, never a served-since claim", () => {
  const edgar = filerEdgarBlock("0001067983", "F");
  const absent = projectionAbsentHtml("filer", "https://www.sec.gov/x");
  for (const html of [edgar, absent]) {
    assert.match(html, /Public Filings decided on 2026-08-01 to serve this list from its published build/);
    assert.doesNotMatch(html, /has served|has published [^.]* since/, "control: a served-since claim");
    assert.doesNotMatch(html, /2026-08-02/, "control: the parameter-lock date");
    assert.doesNotMatch(html, /M2-CONTRACT §3/);
  }
  assert.match(edgar, /where the page cannot embed every reported row, the list says how many it leaves out/);
});

test("T3.8 (H-8): the Reported positions caveat is true of the rows — complete vs size-capped, grouped vs as filed", () => {
  const rows: FilerHoldingRow[] = [
    { cik: "0001067983", period: "2026-03-31", filing_key: "1", security_id: null, cusip: "037833100", issuer_name: "APPLE INC", title_of_class: "COM", value_usd: 100, shares: 10, ssh_type: "SH", put_call: null, position_key: "cusip:037833100", put_call_bucket: "LONG", unit_key: "SH", flags: [] } as FilerHoldingRow,
    { cik: "0001067983", period: "2026-03-31", filing_key: "1", security_id: null, cusip: null, issuer_name: "NO KEY CO", title_of_class: "COM", value_usd: 50, shares: 5, ssh_type: "SH", put_call: null, position_key: null, put_call_bucket: "LONG", unit_key: "SH", flags: [] } as FilerHoldingRow,
  ];
  const complete = holdingsTableHtml({ reference: true, cik: "0001067983", filerName: "F", period: "2026-03-31", rows, filings: FILINGS, page: 0 });
  const capped = holdingsTableHtml({ reference: true, cik: "0001067983", filerName: "F", period: "2026-03-31", rows, filings: FILINGS, page: 0, totalRows: 40 });
  const caveat = (html: string): string => visibleText(domOf(html).querySelectorAll(".caveat-line").at(-1)!);
  assert.match(caveat(complete), /^One line per issuer, largest first; a row with no issuer key stands on its own line\. Open a line for its rows as this filer reported them\. The list holds every row this filer reported for the quarter\. Issuer totals on the holders pages count each manager's own report once; that never removes a row here\./);
  assert.doesNotMatch(caveat(capped), /every row this filer reported/, "control: no completeness sentence over a size-capped page");
  assert.match(capped, /38 of this filer's 40 reported rows for 2026-03-31 are not embedded in this page/, "…whose terminus states the count");
  // a row with no issuer key stands on its own line
  const names = domOf(complete).querySelectorAll("tr.design-holding-row .filed-name").map((n) => visibleText(n));
  assert.ok(names.includes("NO KEY CO") && names.includes("APPLE INC"));
  assert.match(holdingsCaveatHtml(false, 3, 3), /Each row as this filer reported it\. The list holds every row/);
  assert.doesNotMatch(holdingsCaveatHtml(true, 5, 3), /every row this filer reported/);
});

test("T3.8 (H-18, H-3, G-11): the filer terminus, the empty-changes sentence and the holders footnote in plain words", () => {
  const d = (i: number): QoqDeltaRow => ({
    cik: "0001", position_key: `sid:${i}`, put_call: "LONG", curr_period: "2026-06-30", prev_period: "2026-03-31", change_kind: "add",
    prev_value_usd: 1, curr_value_usd: 2, delta_value_usd: 1, prev_shares: 1, curr_shares: 2, delta_shares: 1, ssh_prnamt_type: "SH", flags: [],
  });
  const html = changesTableHtml([d(1), d(2)], "2026-06-30", "2026-08-01", { total: 15_885 });
  assert.match(html, /15,883 of this filer's 15,885 quarter-over-quarter changes for 2026-06-30 are not included on this page, which keeps the changes on its largest positions by reported value \(this quarter's, or last quarter's where this quarter has none, as for an exit\) to stay within its size budget\. The rest are in this build's published data and derivable from the filings themselves\./);
  const holders = tickerHoldersBody({
    ticker: "AAPL", totals: { ticker: "AAPL", period_of_report: "2026-03-31", prev_period: "2025-12-31", issuer_name: "APPLE INC", title_of_class: "COM", holder_count: 1, value_usd: 1, adds: 0, exits: 0 },
    holders: [], tierOf: () => "top", latestFiled: "2026-05-15", overlapHtml: "", congress: null, window: null,
  });
  /* CD-3: the reviewed-mapping holders path carries the §5 data note box */
  assert.equal((holders.match(/data-inst-data-note/g) ?? []).length, 1, "the §5 box ships with the body");
  assert.match(holders, /\(ARCHITECTURE\.md §5\.2 \/ M2-CONTRACT §5\)/, "…with its contract qualifier unchanged (L18)");
});

/* =============================================== T3.9 presented flags */

test("T3.9 (R25): 'ticker not yet mapped' is presented only where no reviewed ticker is shown, and the hoist reads presented flags", () => {
  const base = { cik: "0001067983", period: "2026-03-31", filing_key: "1", security_id: null, title_of_class: "COM", value_usd: 1, shares: 1, ssh_type: "SH", put_call: null, put_call_bucket: "LONG", unit_key: "SH" };
  const mapped = { ...base, cusip: "037833100", issuer_name: "APPLE INC", position_key: "cusip:037833100", ticker: "AAPL", ticker_verified_date: "2026-09-10", flags: ["missing_security"] } as FilerHoldingRow;
  const unmapped = { ...base, cusip: "111111111", issuer_name: "OTHER CO", position_key: "cusip:111111111", flags: ["missing_security"] } as FilerHoldingRow;
  assert.deepEqual(presentedHoldingFlags(mapped), []);
  assert.deepEqual(presentedHoldingFlags(unmapped), ["missing_security"]);
  const mixed = holdingsTableHtml({ reference: true, cik: "0001067983", filerName: "F", period: "2026-03-31", rows: [mapped, unmapped], filings: FILINGS, page: 0 });
  assert.doesNotMatch(mixed, /Every row below carries <strong>ticker not yet mapped/, "no hoisted caveat over a table where one row shows a ticker");
  assert.equal((mixed.match(/ticker not yet mapped/g) ?? []).length, 1, "one chip, on the unmapped row");
  const all = holdingsTableHtml({ reference: true, cik: "0001067983", filerName: "F", period: "2026-03-31", rows: [unmapped, { ...unmapped, cusip: "222222222", position_key: "cusip:222222222", issuer_name: "THIRD CO" }], filings: FILINGS, page: 0 });
  assert.match(all, /Every row below carries <strong>ticker not yet mapped/, "an all-unmapped table hoists");
});

test("T3.9 (R25, H-7): the freshness line names the deadline, and says 'incomplete' only before it", () => {
  const open = instFreshnessText("2026-07-31", "2026-06-30", "2026-07-31");
  assert.equal(open, "13F data in this build runs through filings received 2026-07-31. The filing deadline for the quarter ended 2026-06-30 is 2026-08-14, so that quarter is incomplete here.");
  assert.match(instFreshnessText("2026-08-14", "2026-06-30", "2026-08-14"), /is incomplete here/, "on the deadline day filings are still due");
  const closed = instFreshnessText("2026-08-20", "2026-06-30", "2026-08-20");
  assert.equal(closed, "13F data in this build runs through filings received 2026-08-20.");
  // control: the incompleteness sentence for a closed period would be false
  assert.doesNotMatch(closed, /incomplete/);
  assert.doesNotMatch(open, /still arriving|window open/);
});

/* ============================================ CD-3 the directory's zero rows */

test("CD-3: a directory chip that leaves no row states why in one line, true of the collection", () => {
  const row = (cik: string, typed: boolean): InstIndexRow => ({
    reference: true, cik, name: `F${cik}`, period: "2026-03-31", value: 1, positions: 1, nullValuePositions: 0, hhi: 1, hhiNote: "", tier: "top",
    typing: typed ? { cik, display_name: "D", person: null, manager_type: "family_office", notable: false } : null, changeHtml: "—",
  } as InstIndexRow);
  const untyped = [row("0000000001", false), row("0000000002", false)];
  const chips = { types: new Set(["hedge_fund"]), notableOnly: false };
  assert.equal(directoryEmptyText(untyped, "", chips), "No filer in this build is of the type Hedge funds: this build's manager-type registry types none of its 2 filers.");
  const body = instIndexBodyHtml(untyped, "", "value", "desc", chips, undefined, ["filer", "cik", "value", "positions", "latest-notable"]);
  assert.match(body.html, /<tr class="directory-empty"><td colspan="5" data-empty-state>No filer in this build is of the type Hedge funds/);
  // a typed build with no match does NOT claim the registry is missing
  const typed = [row("0000000001", true)];
  assert.equal(directoryEmptyText(typed, "", chips), "No filer in this build is of the type Hedge funds.");
  assert.match(directoryEmptyText(typed, "zzz", { types: new Set(), notableOnly: false }), /^No filer matches "zzz"\.$/);
  // control: rows that DO match render no empty line
  assert.doesNotMatch(instIndexBodyHtml(typed, "", "value", "desc", { types: new Set(["family_office"]), notableOnly: false }).html, /directory-empty/);
});

/* =========================================== M2V-D2 the holdings shell */

test("M2V-D2: a grouped holdings table showing its whole collection carries its own count; a capped or paged one does not claim to", () => {
  const rows = Array.from({ length: 3 }, (_, i) => ({
    cik: "0001067983", period: "2026-03-31", filing_key: "1", security_id: null, cusip: `${i}1111111${i}`, issuer_name: `CO ${i}`, title_of_class: "COM",
    value_usd: 100 - i, shares: 1, ssh_type: "SH", put_call: null, position_key: `cusip:${i}1111111${i}`, put_call_bucket: "LONG", unit_key: "SH", flags: [],
  }) as FilerHoldingRow);
  const complete = holdingsTableHtml({ reference: true, cik: "0001067983", filerName: "F", period: "2026-03-31", rows, filings: FILINGS, page: 0 });
  assert.match(complete, /<tbody id="filer-holdings-tbody">/);
  assert.match(complete, /class="compact-disclosure" data-compact-dom data-compact-for="filer-holdings-tbody" data-compact-total="3" data-compact-shown="3"[^>]*hidden>/, "the hidden shell states 3 of 3");
  const capped = holdingsTableHtml({ reference: true, cik: "0001067983", filerName: "F", period: "2026-03-31", rows, filings: FILINGS, page: 0, totalRows: 30 });
  assert.doesNotMatch(capped, /data-compact-for="filer-holdings-tbody"/, "control: a size-capped page never reads as complete");
  assert.doesNotMatch(capped, /<tbody id=/);
});
