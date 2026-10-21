/* PRE-LAUNCH DEFECTS (2026-10-20) — six reader-facing defects verified on the
   live site (build 20261020.2), each pinned here as a PROPERTY of what the
   reader sees, with a control that re-plants the defect and must be caught.

   1. The holders page shows members' trades under the 13F footer, so the
      Congress rows carry their own §13107(c) line.
   2. No internal identifier in reader copy (tips included).
   3. No internal codename ("Populus") in reader copy.
   4. A count agrees with its noun ("1 filing", never "1 filings").
   5. No word joins a tag across a template line break (Astro's HTML
      compression drops that whitespace: "fromstats.json", "Attribution.Data").
   6. No figure contradicts the rows beside it (ticker holder count, the
      directory count, the member's reporting window). */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, globSync } from "node:fs";
import path from "node:path";

import { CONGRESS_USE_NOTICE, overlapBand, overlapBandHtml, tickerOverlapHtml } from "../src/lib/overlap.ts";
import { addsNoteHtml } from "../src/lib/inst-adds.ts";
import { AMENDMENT_PENDING_NOTE, type RenderCtx, type TxnRow } from "../src/lib/format.ts";
import { congressTickerBody, memberBody, tickerUnifiedBody } from "../src/lib/ui/index.ts";
import { instIndexBodyHtml } from "../src/lib/inst-index.ts";
import { PLAYBOOKS } from "../src/lib/playbooks.ts";
import { renderParitySurfaces } from "./lib/ui-parity-surfaces.ts";
import { domOf, ledgerFigures, visibleText } from "./lib/ledger-dom.ts";

const SRC = path.resolve(import.meta.dirname, "..", "src");
const read = (rel: string): string => readFileSync(path.join(SRC, rel), "utf-8");
const CTX: RenderCtx = {};
const STAMPS = { buildId: "b", generatedAt: "2026-07-24 06:56 UTC", generatedAtDate: "2026-07-24" };
const HREF = (cik: string): string => `/institutional/filers/${cik}/`;

/** Every word a reader can reach: tags and attributes stripped, entities
    decoded, popover tips INCLUDED (a tip is still reader copy). */
function readerText(html: string): string {
  return html
    .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");
}

function txn(over: Partial<TxnRow> = {}): TxnRow {
  return {
    kind: "txn", txnId: "t-1", asset: null, assetType: null, filed: "2026-07-21", traded: "2026-06-24", name: "Fixture Member",
    bioguide: "F000001", party: "R", state: "OH", district: "4", chamber: "house", ticker: "CBSI", side: "sale", owner: "spouse",
    low: 50001, high: 100000, lag: 27, late: 0, flags: [], doc: "https://disclosures-clerk.house.gov/x.pdf",
    ...over,
  } as TxnRow;
}

/* ---------------- 1. the §13107(c) line travels with Congress rows ---------------- */

test("1: the overlap band's Congress notice is the standard footer's §13107(c) sentence, word for word", () => {
  const base = read("layouts/Base.astro");
  const m = /const FOOTER_NOTICE = (\{[\s\S]*?\}) as const;/.exec(base);
  assert.ok(m, "Base.astro declares FOOTER_NOTICE");
  const standard = (new Function(`return (${m[1]});`)() as { standard: string }).standard;
  assert.ok(standard.endsWith(CONGRESS_USE_NOTICE), `the footer's sentence ends with the band's notice: ${standard}`);
  assert.match(CONGRESS_USE_NOTICE, /5 U\.S\.C\. §13107\(c\)/);
});

test("1: congressNotice prints the line under the Congress half; the ticker page (standard footer) does not repeat it", () => {
  const band = overlapBand({
    ticker: "AAPL", txns: [txn({ ticker: "AAPL", filed: "2026-07-10" })], generatedAtDate: "2026-07-24",
    inst: { present: false, reason: "module-absent" }, typingByCik: new Map(), period: null, ctx: CTX, filerHref: HREF,
  });
  const holders = overlapBandHtml(band, CTX, HREF, { congressNotice: true });
  const congressHalf = /<div class="overlap-half overlap-congress">([\s\S]*?)<\/div><div class="overlap-half/.exec(holders)?.[1] ?? "";
  assert.ok(congressHalf.includes(CONGRESS_USE_NOTICE), "the notice sits inside the Congress half, beside the rows it governs");
  // control: the default and the ticker-page renderer carry no second copy
  assert.ok(!overlapBandHtml(band, CTX, HREF).includes(CONGRESS_USE_NOTICE), "off by default");
  assert.ok(!tickerOverlapHtml(band, CTX, HREF).includes("13107"), "the ticker page's footer already states it once");
});

test("1: every 13F-footer page that renders the overlap band opts into the notice", () => {
  const pages = globSync("pages/**/*.astro", { cwd: SRC }).filter((rel) => /\bfooter="inst13f"/.test(read(rel)));
  assert.ok(pages.includes("pages/institutional/tickers/[t]/holders.astro"), "the holders page uses the 13F footer");
  const missing = (src: string): boolean => /overlapBandHtml\(/.test(src) && !/congressNotice:\s*true/.test(src);
  for (const rel of pages) assert.equal(missing(read(rel)), false, `${rel} renders Congress rows without the §13107(c) line`);
  // control: the same reading flags the page as it shipped
  const shipped = read("pages/institutional/tickers/[t]/holders.astro").replace(/congressNotice:\s*true/, "");
  assert.equal(missing(shipped), true, "the check catches a holders page without the flag");
});

/* ---------------- 2 + 3. no internal identifier or codename in reader copy ---------------- */

const LEAKS: readonly [string, RegExp][] = [
  ["codename", /\bPopulus\b/],
  ["issuer/entity key", /\b(?:iss|entity|sid|pos):[A-Za-z0-9]/],
  ["flag name", /\bamount_spouse_cap\b/],
  ["SQL view", /\bv_default_transactions\b/],
  ["SQL predicate", /\bbioguide_id\b/],
  ["table name", /\bagg_[a-z_]+\b/],
  ["SEC file name", /\bcompany_tickers\.json\b/],
];
const leaksIn = (text: string): string[] => LEAKS.filter(([, re]) => re.test(text)).map(([what]) => what);

/** The two places a published key is the point, not a leak: a position row's
    identity cell (no name to show, so the key is the row's name) and an
    identity chip's tip that labels it "key as published". The live defect was
    a key dropped into a sentence; these are exempt by construction. */
function withoutDeclaredKeys(html: string): string {
  return html
    .replace(/<td class="c-pos[^"]*">[\s\S]*?<\/td>/g, "<td></td>")
    .replace(/key as published: [^<\s]+/g, "key as published: ‹key›");
}

test("2/3: no rendered surface carries an internal identifier or the codename, tips included", async () => {
  const surfaces = await renderParitySurfaces();
  assert.ok(Object.keys(surfaces).length >= 40, "the full surface set rendered");
  for (const [key, html] of Object.entries(surfaces)) {
    assert.deepEqual(leaksIn(readerText(withoutDeclaredKeys(html))), [], `surface ${key} leaks an internal name`);
  }
  // control: the exemption is narrow — a key in a sentence beside an exempt cell is still caught
  assert.deepEqual(leaksIn(readerText(withoutDeclaredKeys('<td class="c-pos c-flex"><span class="mono-note">sid:77</span></td><p>had $187M across 139 managers (iss:396).</p>'))), ["issuer/entity key"]);
  // control: each pattern catches the string that shipped
  for (const planted of ["Populus uses no prices", "139 managers (iss:396)", "<code>amount_spouse_cap</code>", "(v_default_transactions)", "bioguide_id = null", "agg_filer_registry", "ticker file (company_tickers.json)"]) {
    assert.ok(leaksIn(readerText(planted)).length === 1, `the sweep catches "${planted}"`);
  }
});

test("2: the leaderboard bound keeps its exact issuer key, on the element, not in the words", () => {
  const html = addsNoteHtml({ truncated: true, truncation_boundary: [187_000_000, 139, "iss:396"], ambiguous_identity_exclusion_count: 0 });
  assert.deepEqual(leaksIn(readerText(html)), [], "no key in the reader's words");
  assert.match(html, /data-boundary-key="iss:396"/, "the exact boundary is still recorded");
  assert.match(readerText(html), /\$187M across 139 managers/, "the value and manager count still name the cut");
});

test("2: the methodology and Congress templates, the ledger subs and the amendment note name no internal object", () => {
  const template = (rel: string): string =>
    read(rel).replace(/^---\n[\s\S]*?\n---\n/, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
  assert.deepEqual(leaksIn(template("pages/methodology/index.astro")), [], "methodology markup");
  assert.ok(!read("pages/congress/index.astro").includes("<code>amount_spouse_cap</code>"), "the feed footnote names no flag");
  const subs = [...read("lib/data.ts").matchAll(/^\s+sub: ([`"])(.*?)\1,$/gm)].map((m) => m[2]!);
  assert.ok(subs.length >= 4, "the methodology ledger subs were read");
  assert.deepEqual(subs.flatMap(leaksIn), [], `ledger subs: ${subs.join(" | ")}`);
  assert.deepEqual(leaksIn(AMENDMENT_PENDING_NOTE), [], "the amendment note (a row tip and a methodology line)");
  assert.deepEqual(PLAYBOOKS.flatMap((p) => leaksIn(`${p.verdict} ${p.pattern}`)), [], "playbook copy");
});

/* ---------------- 4 + 6. counts agree; figures agree with their rows ---------------- */

const ONE_TRADE = {
  bioguide: "F000001", name: "Fixture Member", party: "R", state: "OH", district: "4", chamber: "house", servingSince: "2007",
  filingCount: 1, txns: [txn()], paper: [],
} as unknown as Parameters<typeof memberBody>[0];

test("4: a one-trade member reads 1 filing, 1 row, 1 reported transaction", () => {
  const text = visibleText(domOf(memberBody(ONE_TRADE, STAMPS, CTX, 0)));
  for (const ok of ["1 filing ·", "1 row ·", "1 reported transaction"]) assert.ok(text.includes(ok), `"${ok}" is on the page`);
  assert.doesNotMatch(text, /\b1 (?:filings|rows|reported transactions)\b/, "no singular count carries a plural noun");
  // control: a three-trade member keeps the plural
  const three = { ...ONE_TRADE, filingCount: 3, txns: [txn(), txn({ txnId: "t-2" }), txn({ txnId: "t-3" })] } as typeof ONE_TRADE;
  assert.match(visibleText(domOf(memberBody(three, STAMPS, CTX, 0))), /3 filings · .*3 rows · /s);
});

test("4: a ticker with one disclosure reads 1 row", () => {
  const html = congressTickerBody({ ticker: "CBSI", txns: [txn()] } as Parameters<typeof congressTickerBody>[0], STAMPS, CTX);
  const text = visibleText(domOf(html));
  assert.ok(text.includes("1 row · filed date desc"), "one disclosure, one row");
  assert.doesNotMatch(text, /\b1 rows\b|disclosures1 rows/, "control: no plural noun on a count of one");
});

test("6: the member's reporting window is its own filing span, never the site's publish date", () => {
  const one = memberBody(ONE_TRADE, STAMPS, CTX, 0);
  assert.match(one, /Reporting window<\/div>\s*<h2>Filed 2026-07-21<\/h2>/, "one filing: its date");
  assert.ok(!one.includes(`Published ${STAMPS.generatedAtDate}`), "control: the publish date no longer poses as the window");
  const paper = { kind: "paper", filed: "2025-11-03", name: "Fixture Member", bioguide: "F000001", party: "R", state: "OH", district: "4", chamber: "house", doc: "d" };
  const span = memberBody({ ...ONE_TRADE, filingCount: 2, paper: [paper] } as typeof ONE_TRADE, STAMPS, CTX, 0);
  assert.match(span, /<h2>Filed 2025-11-03 → 2026-07-21<\/h2>/, "a paper filing counts toward the span");
});

test("6: the ticker ledger's 13F holders figure is the full count, with the listed slice as its sub", () => {
  const holder = (rank: number) => ({ rank, cik: `000000000${rank}`, name: `FILER ${rank}`, value: 1000 - rank, securities: 1, flags: [], tier: "top" as const });
  const section = (holderCount: number | null) => ({
    state: "data" as const, name: "APPLE INC", period: "2026-03-31", latestFiled: "2026-05-15", topn: 500,
    holders: [holder(1), holder(2), holder(3)],
    ...(holderCount === null ? {} : { mapped: { issuer: "APPLE INC", titleOfClass: "COM", holderCount } }),
  });
  const fig = (holderCount: number | null) =>
    ledgerFigures(tickerUnifiedBody({ ticker: "AAPL", txns: [txn({ ticker: "AAPL" })] }, section(holderCount) as never, STAMPS, CTX, { fullTable: false }))
      .find((f) => f.label === "13F holders")!;
  assert.deepEqual([fig(5662).value, fig(5662).sub], ["5,662", "top 3 listed · 2026-03-31"], "the count beside 'the 3 largest of the 5,662'");
  assert.deepEqual([fig(3).value, fig(3).sub], ["3", "all listed · 2026-03-31"], "every holder listed");
  assert.deepEqual([fig(null).value, fig(null).sub], ["3", "top-500 slice · 2026-03-31"], "no reviewed total: the slice, labelled as one");
});

test("6: the directory's server count is the client's note, from the same call that drew the rows", () => {
  const src = read("pages/institutional/index.astro");
  assert.match(src, /<span id="inst-index-count">\$\{esc\(directory\.note\)\}<\/span>/, "the server prints the renderer's note");
  assert.doesNotMatch(src, /\$\{fmtInt\(indexRows\.length\)\} filers · sorted by/, "control: the bare total above a filtered list is gone");
  const row = (cik: string, type: string) => ({
    cik, name: `FILER ${cik}`, period: "2026-03-31", value: 1, positions: 1, nullValuePositions: 0, hhi: 1000, hhiNote: "", tier: "top",
    typing: { cik, display_name: `Filer ${cik}`, person: null, manager_type: type, notable: false }, changeHtml: "",
  }) as never;
  const out = instIndexBodyHtml([row("1", "hedge_fund"), row("2", "bank")], "", "value", "desc", { types: new Set(["hedge_fund"]), notableOnly: false });
  assert.match(out.note, /^1 of 2 managers · /, "the note states the filtered share of the whole");
});

/* ---------------- 5. no word joins a tag across a template line break ---------------- */

const INLINE = "(?:a|span|strong|em|code|b|i|time|abbr|kbd|small|sup|sub)";
/** Whitespace that holds a line break, between running text and an inline
    tag, is dropped by Astro's HTML compression, so the two words touch. */
function joinedAcrossBreaks(astro: string): string[] {
  const body = astro
    .replace(/^---\n[\s\S]*?\n---\n/, "")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/<(script|style)\b[\s\S]*?<\/\1>/g, " ");
  const hits = [
    ...body.matchAll(new RegExp(`[A-Za-z0-9.,;:)\\]][ \\t]*\\n[ \\t]*<${INLINE}\\b`, "g")),
    ...body.matchAll(new RegExp(`</${INLINE}>[ \\t]*\\n[ \\t]*[A-Za-z0-9(]`, "g")),
  ];
  return hits.map((m) => m[0].replace(/\s+/g, " "));
}

test("5: no template joins a word to an inline tag across a line break", () => {
  for (const rel of globSync("**/*.astro", { cwd: SRC })) {
    assert.deepEqual(joinedAcrossBreaks(read(rel)), [], `${rel} would render a joined word`);
  }
  // control: the two shipped shapes are both caught
  assert.equal(joinedAcrossBreaks("<p>regenerated from\n      <span class=\"mono-id\">stats.json</span></p>").length, 1, "text then tag");
  assert.equal(joinedAcrossBreaks("<p><strong>Attribution.</strong>\n   Data remain</p>").length, 1, "tag then text");
  assert.equal(joinedAcrossBreaks("<p>plain words\n   that wrap</p>").length, 0, "a break between words keeps its space");
});
