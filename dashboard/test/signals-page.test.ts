/* The /signals composition (Signals.dc.html): rule book, hits, lag, rates,
   watchlist — every number from the artifact and the page's own rows. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { signalsBody } from "../src/lib/ui/index.ts";
import type { Signal, SignalArtifact } from "../src/lib/signals.ts";
import { scanBannedWording } from "../src/lib/activity.ts";
import { MiniElement } from "./lib/mini-dom.ts";
import { syncScrollRegion, type ScrollRegionNode } from "../src/scripts/signals-client.ts";

function domOf(html: string): MiniElement {
  const root = new MiniElement("body");
  root.innerHTML = html;
  return root;
}
/** Visible text: note panels and visually hidden text excluded. */
function ownText(el: MiniElement): string {
  return el.nodes
    .map((n) => (typeof n === "string" ? n : n.classList.contains("note-pop") || n.classList.contains("visually-hidden") ? "" : ownText(n)))
    .join("");
}

function sig(over: Partial<Signal> & { kind: Signal["kind"] }): Signal {
  return {
    id: `${over.kind}:${Math.random().toString(16).slice(2)}`,
    rule: "rule text",
    thresholdVersion: "1.0.0",
    entities: { bioguide: "A000001", memberName: "Test <Member>", ticker: "ABC" },
    magnitude: { low: 250001, high: 500000 },
    receipts: ["https://efdsearch.senate.gov/x"],
    occurrence: { tradeDate: "2026-03-01", filedDate: "2026-06-01" },
    sourceAvailableAt: "2026-06-01",
    computedAt: "2026-08-02 07:27 UTC",
    firstSeenBuild: "b",
    lastSeenBuild: "b",
    status: "active",
    cohort: "senate",
    // R8 (SIGNALS-CLARITY M2): a newly emitted per-row signal, filed as listed stock
    asset: "ABC Holdings Inc (ABC)",
    assetType: "Stock",
    side: "purchase",
    owner: "self",
    listedStock: true,
    ...over,
  };
}
const ART: SignalArtifact = {
  v: 1, buildId: "b", computedAt: "2026-08-02 07:27 UTC", thresholdVersion: "1.0.0", retentionDays: 90,
  coverageFrom: "2026-05-04", coverageTo: "2026-08-02", lifecycleNote: "cold start", compaction: "none",
  dateAnomaliesExcluded: 3, lagCaveat: "PTRs are filed up to 45 days after the trade", withheld: [
    { kind: "s5-jurisdiction", reason: "inputs-not-in-build", detail: "committee data absent" },
  ],
  signals: [
    sig({ kind: "s1-large" }),
    sig({ kind: "s6-late-large", occurrence: { tradeDate: "2026-01-01", filedDate: "2026-06-01" } }),
    sig({ kind: "s2-first", magnitude: { low: 1001, high: 15000 } }),
    sig({ kind: "s1-large", status: "superseded", supersededInBuild: "c" }),
  ],
};
const CTX = { watched: new Set<string>() };

test("rule book lists every kind with its exact rule, active hit counts and the withheld kinds by reason", () => {
  const html = signalsBody(ART, CTX);
  /* DOM parse (DESIGN-POLISH M1, T1.9): the kind cell now carries its ledger
     role too (`si-kind c-kind`), so the kinds are read from the rule book's
     kind cells rather than matched against one class string. */
  const book = domOf(html).querySelector("#signal-rulebook")!;
  const kinds = book.querySelectorAll("td.si-kind").map((td) => ownText(td).trim());
  for (const k of ["LARGE", "INFREQUENT", "CO-OCCURRENCE", "FIRST FILING", "COMMITTEE", "LATE", "RETURN"]) assert.ok(kinds.includes(k), k);
  assert.match(html, /<td class="c-num si-hits">1<\/td>/, "S-1 counts ONE active — the tombstone is history");
  assert.match(html, /<td class="c-num si-hits c-muted">0<\/td>/, "a zero is printed, never blank");
  // DESIGN-POLISH M1 (R6): the word WITHHELD is its reason's label trigger.
  const withheld = book.querySelectorAll("td.si-status-withheld").map((td) => ownText(td).trim());
  assert.ok(withheld.includes("WITHHELD"));
  assert.ok(book.querySelector("td.si-status-withheld .note-btn.note-label"), "the reason is one interaction from the word");
  assert.match(html, /BY DESIGN/);
  // R17: the tombstone table left the page; the footnote links the artifact.
  assert.doesNotMatch(html, /Superseded in build/);
  assert.match(html, /id="signal-changes-foot"[^>]*>1 signal from an earlier build left the retained view/);
  assert.match(html, /<a href="\/signals\/data\/signals\.v1\.json">changes since last build<\/a>/);
  /* The rule book sits BELOW the hits. DESIGN-POLISH M2 (T2.6, L14): it is
     now EXPANDED — every rule published in the page, no <details> fold; the
     expanded-band properties are pinned in the T2.6 test below. */
  assert.ok(html.indexOf('id="signal-hits"') < html.indexOf('id="signal-rulebook"'), "hits first, rule book after");
});

/* ---------- T2.6 (DESIGN-POLISH M2, D3 / L14): the Signals composition ---------- */

/** The rule book's composition problems: an enclosing <details> (the rule
    book is expanded, L14), a row count other than seven (six kinds + RETURN),
    a table that is not the declared prose table, or a prose column missing. */
function ruleBookProblems(html: string): string[] {
  const out: string[] = [];
  const book = domOf(html).querySelector("#signal-rulebook");
  if (!book) return ["no rule book"];
  for (let a = book.parent; a; a = a.parent) if (a.tagName === "details") out.push("the rule book sits inside a <details>");
  const table = book.querySelector("table")!;
  if (!table.hasAttribute("data-multiline")) out.push("the rule book is not the declared prose table (data-multiline)");
  const rows = table.querySelectorAll("tbody tr");
  if (rows.length !== 7) out.push(`the rule book has ${rows.length} rows, not seven`);
  if (rows.some((tr) => !tr.querySelector("td.si-rule-text") || !tr.querySelector("td.si-why"))) out.push("a row lacks its prose columns (rule, why)");
  const heads = table.querySelectorAll("thead th").map((th) => ownText(th).trim());
  if (JSON.stringify(heads) !== JSON.stringify(["Family", "Kind", "Rule", "Why it's informative", "Hits", "Status"])) out.push(`rule book head ${JSON.stringify(heads)}`);
  return out;
}

test("T2.6: the rule book is expanded (no <details>), seven rows, the prose columns on the declared prose table", () => {
  const html = signalsBody(ART, CTX, { rowsEvaluated: 1000, latestBatch: [], latestBatchFiled: null });
  assert.deepEqual(ruleBookProblems(html), []);
  // controls: the pre-M2 fold, a lost row, and a lost prose declaration each fail
  const folded = html.replace('<section class="panel panel-wide si-rulebook"', '<details class="design-supplement" id="signal-rulebook-wrap"><summary>Rule book</summary><section class="panel panel-wide si-rulebook"').replace(/(id="signal-rulebook"[\s\S]*?<\/section>)/, "$1</details>");
  assert.ok(ruleBookProblems(folded).some((p) => /inside a <details>/.test(p)), "control: the rule book folded in a <details> fails");
  assert.ok(ruleBookProblems(html.replace(/<tr class="si-rule si-family-withheld si-withheld"[\s\S]*?<\/tr>/, "")).some((p) => /not seven/.test(p)), "control: six rows fail");
  assert.ok(ruleBookProblems(html.replace(" data-multiline>", ">")).some((p) => /prose table/.test(p)), "control: no data-multiline fails");
});

test("T2.6: band S1 holds the hits and the side cell (lag distribution + hit rate); the hits head has seven columns, Kind first", () => {
  const html = signalsBody(ART, CTX, { rowsEvaluated: 1000, latestBatch: [], latestBatchFiled: null });
  const band = domOf(html).querySelector(".design-signals-band")!;
  assert.deepEqual(band.children.map((c) => c.id || c.getAttribute("class")), ["signal-hits", "si-side"]);
  const side = band.children[1]!;
  assert.deepEqual(side.children.map((c) => c.getAttribute("aria-label")), ["Lag distribution", "Hit rate by family"]);
  const heads = domOf(html).querySelectorAll("#signal-hits thead th").map((th) => ownText(th).trim());
  assert.equal(heads.length, 7);
  assert.deepEqual(heads, ["Kind", "Ticker", "Who", "What", "Filed", "Size", "Src"]);
  // the rule book follows band S1, outside it
  const bookAt = html.indexOf('id="signal-rulebook"');
  assert.ok(bookAt > html.indexOf('<div class="si-side">'), "the rule book comes after band S1");
  assert.equal(band.querySelector("#signal-rulebook"), null, "…and is not inside it");
});

/* R17 → DESIGN-POLISH M2 (T2.6 / T2.7). The property: every hit states its
   kind, ticker, subject, one-line evidence, dates, size and receipt, paged 50
   with a real pager, and the evidence's full text (the exact rule and every
   receipt) is one interaction away — never deleted. M2 gives the KIND its own
   first column (it was a word inside the What cell) and lays the opened
   evidence on its own full-width row (`.si-evidence-row`), so a one-line row
   can never clip its receipts. */
test("R17 (M2): hits are Kind · Ticker · Who · What · Filed · Size · Src, paged 50 with a real pager; evidence is one line with the full text on its own row", () => {
  const html = signalsBody(ART, CTX, { rowsEvaluated: 1000, latestBatch: [], latestBatchFiled: null, renderCap: 2 });
  assert.match(html, /Test &lt;Member&gt;/);
  assert.match(html, /\$250K–\$500K/);
  assert.match(html, /datetime="2026-01-01"/);
  assert.match(html, /\+151d/);
  assert.match(html, /si-stamp">eFD/);
  // DESIGN-POLISH M1 (R2) + M2 (T2.6): seven columns, Kind first, each with its ledger role.
  const hits = domOf(html).querySelector("#signal-hits")!;
  assert.deepEqual(
    hits.querySelectorAll("thead th").map((th) => [ownText(th).trim(), th.getAttribute("class")]),
    [["Kind", "c-kind"], ["Ticker", "c-ticker"], ["Who", "c-member"], ["What", "c-secondary c-flex"], ["Filed", "c-num"], ["Size", "c-num"], ["Src", "c-src"]],
  );
  const firstRow = hits.querySelectorAll("tbody tr.si-hit")[0]!;
  const kindCell = firstRow.children[0]!;
  assert.ok(kindCell.classList.contains("c-kind") && kindCell.classList.contains("si-kind"), "the kind is the first cell");
  assert.ok(kindCell.querySelector(".note-btn.note-label"), "the kind word is its rule's label trigger");
  assert.equal(ownText(kindCell).trim(), "LARGE");
  const tickerCell = firstRow.children[1]!;
  assert.ok(tickerCell.classList.contains("si-ticker-cell") && tickerCell.classList.contains("c-ticker"));
  assert.equal(tickerCell.querySelector("a.si-ticker")?.getAttribute("href"), "/tickers/ABC/", "the ticker is the second cell");
  assert.equal(firstRow.children.length, 7, "one cell per column");
  // the evidence body is the NEXT row, spanning the full table width
  const evidence = hits.querySelectorAll("tbody tr")[1]!;
  assert.ok(evidence.classList.contains("si-evidence-row"));
  assert.equal(evidence.getAttribute("data-evidence-for"), firstRow.getAttribute("data-signal-id"));
  assert.equal(evidence.children.length, 1);
  assert.equal(evidence.children[0]!.getAttribute("colspan"), "7", "the evidence spans every column");
  assert.ok(evidence.querySelector(".si-expand-body a[href=\"https://efdsearch.senate.gov/x\"]"), "every receipt rides in the evidence row");
  assert.equal(firstRow.querySelector(".si-expand-body"), null, "the What cell holds only the one-line summary");
  // DESIGN-POLISH M1 (R8): the range grammar.
  assert.match(html, /id="signal-hits-range"[^>]*>1–2 of 3 lines · 3 hits</, "the pager states the page");
  assert.match(html, /id="signal-hits-next" aria-disabled="false"/);
  assert.match(html, /data-family="COMPLIANCE"/);
  /* the summary names the evidence row it opens (DESIGN-POLISH M2 review R2-8).
     SIGNALS-CLARITY M2 (R10): the one line is now the SENTENCE — who did what
     to which asset — and the rule's own terms restated with the row's facts
     moved into the evidence row. The property kept: every hit states its rule. */
  assert.match(html, /<details class="si-expand"><summary aria-controls="si-evidence-s1-large:[0-9a-f]+"><span class="si-sentence">Purchase of ABC Holdings Inc<\/span><\/summary>/, "one-line sentence — a listed stock carries no type chip");
  const firstEvidence = hits.querySelectorAll("tbody tr.si-evidence-row")[0]!;
  assert.match(ownText(firstEvidence.querySelector("p.si-evidence-line")!), /^disclosed lower bound \$250K · ≥ \$250K rule$/, "the rule restatement is in the evidence row");
  assert.match(html, /<strong>Rule:<\/strong> rule text/, "full text in the expand");
  assert.doesNotMatch(html, /render bound/);
  const full = signalsBody(ART, CTX, { rowsEvaluated: 1000, latestBatch: [], latestBatchFiled: null });
  assert.match(full, /data-page-size="50"/);
  assert.match(full, /id="signal-hits-range"[^>]*>1–3 of 3 lines · 3 hits</);
  assert.match(full, /id="signal-hits-next" aria-disabled="true"/);
  assert.match(full, /button" data-kind="s1-large"/, "filter by rule");
  assert.match(full, /id="signal-watched-only"/, "filter by watchlist");
});

test("hit rate is per 1,000 rows filed in the window and withheld without a denominator", () => {
  const withRate = signalsBody(ART, CTX, { rowsEvaluated: 1000, latestBatch: [], latestBatchFiled: null });
  assert.match(withRate, /1\.0 ‰/, "one hit per family over 1,000 rows");
  const noRate = signalsBody(ART, CTX);
  assert.match(noRate, /evaluated-row count is not available, so no rate is stated/);
});

test("lag distribution groups identical (member, lag) rows and marks the 45-day line", () => {
  const row = { name: "Bulk Filer", bioguide: "B1", party: "D", traded: "2026-01-01", filed: "2026-05-01", lag: 120, late: 1 };
  const html = signalsBody(ART, CTX, { rowsEvaluated: 10, latestBatch: [row, row, { ...row, lag: 5, late: 0 }], latestBatchFiled: "2026-05-01" });
  assert.match(html, /×2/);
  assert.match(html, /si-late">\+120d/);
  assert.match(html, /si-bar-tick/);
  assert.match(html, /LATEST BATCH FILED 2026-05-01/);
});

test("the watch band embeds a </script>-safe payload and the whole page passes the wording scan", () => {
  const html = signalsBody({ ...ART, signals: [sig({ kind: "s1-large", entities: { bioguide: null, memberName: "</script><b>x", ticker: null } })] }, CTX);
  assert.doesNotMatch(html, /<\/script><b>/);
  assert.match(html, /id="signal-watch-data"/);
  assert.deepEqual(scanBannedWording(signalsBody(ART, CTX, { rowsEvaluated: 100, latestBatch: [], latestBatchFiled: null })), []);
});

test("a withheld LATE kind renders as unevaluated in the compliance summary, never as a computed zero", () => {
  const withheld: SignalArtifact = { ...ART, signals: ART.signals.filter((s) => s.kind !== "s6-late-large"), withheld: [...ART.withheld, { kind: "s6-late-large", reason: "volume-out-of-bounds", detail: "measured volume outside its declared bounds" }] };
  const html = signalsBody(withheld, CTX);
  assert.match(html, /LATE rule was withheld this build/);
  assert.match(html, /volume-out-of-bounds/);
  assert.doesNotMatch(html, /No late-and-large disclosures in the window/);
  assert.doesNotMatch(html, /Zero hits is the computed answer for the LATE rule/);
  // the non-withheld artifact with zero LATE hits still states the computed zero
  const zero = signalsBody({ ...ART, signals: ART.signals.filter((s) => s.kind !== "s6-late-large") }, CTX);
  assert.match(zero, /No late-and-large disclosures in the window/);
});

/* DESIGN-POLISH M1 review R-8. The hits wrapper was a focusable region named
   "scroll sideways for more columns" at EVERY width — a tab stop announcing a
   scroll that at 1440px does not exist. The server renders a plain box that
   carries the name in `data-scroll-region`; the island makes it a named,
   focusable region exactly while the table overflows it. */

function regionBox(scrollWidth: number, clientWidth: number, name: string | undefined): ScrollRegionNode & { attrs: Map<string, string> } {
  const attrs = new Map<string, string>();
  return {
    scrollWidth,
    clientWidth,
    dataset: { scrollRegion: name },
    attrs,
    setAttribute: (k, v) => void attrs.set(k, v),
    removeAttribute: (k) => void attrs.delete(k),
  };
}

test("R-8: the hits wrapper is a named, focusable region only while its table overflows it", () => {
  const html = signalsBody(ART, CTX);
  const wrap = domOf(html).querySelector(".si-hits-scroll")!;
  assert.ok(wrap, "the hits wrapper renders");
  for (const a of ["tabindex", "role", "aria-label"]) assert.equal(wrap.getAttribute(a), null, `the server renders no ${a}`);
  const name = wrap.getAttribute("data-scroll-region")!;
  assert.match(name, /scroll sideways/);

  const narrow = regionBox(900, 358, name);
  assert.equal(syncScrollRegion(narrow), true);
  assert.deepEqual(Object.fromEntries(narrow.attrs), { tabindex: "0", role: "region", "aria-label": name });
  // …and the attributes go when the viewport grows past the table
  narrow.scrollWidth = 1200;
  narrow.clientWidth = 1200;
  assert.equal(syncScrollRegion(narrow), false);
  assert.deepEqual(Object.fromEntries(narrow.attrs), {}, "no tab stop, no role, no name once nothing scrolls");
  // control: the pre-fix wrapper, always a region, fails the property at 1440
  const pre = regionBox(1200, 1200, name);
  pre.attrs.set("tabindex", "0");
  assert.notDeepEqual(Object.fromEntries(pre.attrs), {}, "control");
});

/* DESIGN-POLISH M2 review R2-8 and C2-6: each hit's evidence row is NAMED by
   the summary that opens it (`aria-controls` → the row's id), and its receipts
   sit in valid markup — no block element inside a <p>, which the HTML parser
   "repairs" by closing the paragraph early (the receipts then stood outside
   the sentence that labels them). */
const BLOCK = new Set(["div", "p", "section", "table", "ul", "ol", "dl", "details", "header", "footer", "article"]);
/** Every <p> that holds a block element (invalid content). */
function blocksInsideP(root: MiniElement): string[] {
  const out: string[] = [];
  const walk = (el: MiniElement, inP: boolean): void => {
    for (const c of el.children) {
      if (inP && BLOCK.has(c.tagName)) out.push(`<${c.tagName}${c.getAttribute("class") ? ` class="${c.getAttribute("class")}"` : ""}> inside <p>`);
      walk(c, inP || c.tagName === "p");
    }
  };
  walk(root, false);
  return out;
}

test("R2-8 / C2-6: each summary controls its own evidence row by id; the evidence markup is valid (no block inside a <p>)", () => {
  const root = domOf(signalsBody(ART, CTX, { rowsEvaluated: 1000, latestBatch: [], latestBatchFiled: null }));
  const hits = root.querySelectorAll("#signal-hits-body tr.si-hit");
  assert.ok(hits.length >= 2);
  for (const hit of hits) {
    const summary = hit.querySelector("details.si-expand summary")!;
    const target = summary.getAttribute("aria-controls");
    assert.ok(target, "the summary names what it opens");
    const row = root.querySelectorAll("tr").find((r) => r.id === target) ?? null;
    assert.ok(row && row.classList.contains("si-evidence-row"), `${target} is an evidence row`);
    assert.equal(row!.getAttribute("data-evidence-for"), hit.getAttribute("data-signal-id"), "the named row is THIS hit's evidence");
    assert.equal(hit.parent!.children[hit.parent!.children.indexOf(hit) + 1], row, "and it is the row right after the hit");
  }
  const ids = root.querySelectorAll("tr.si-evidence-row").map((r) => r.id);
  assert.equal(new Set(ids).size, ids.length, "evidence ids are unique");
  assert.deepEqual(blocksInsideP(root.querySelector("#signal-hits")!), [], "no block element inside a paragraph");
  // control: the pre-fix receipts line — a <div> cell inside the <p> — is caught
  const preFix = domOf('<div class="si-expand-body"><p><strong>Receipts:</strong> <div class="cell cell-src"><a href="https://x">eFD</a></div></p></div>');
  assert.deepEqual(blocksInsideP(preFix), ['<div class="cell cell-src"> inside <p>']);
});

/* ======================================================================
   SIGNALS-CLARITY M2 — Congress signals, what was traded, listed stocks
   ====================================================================== */

import { readFileSync } from "node:fs";
import path from "node:path";
import { groupHits, hitMatches, hitsView, hitsHiddenText, signalSentence, memberSignalsPanel, signalsTileHtml, type HitFilter } from "../src/lib/ui/index.ts";

const PAGE_SRC = path.resolve(import.meta.dirname, "..", "src", "pages", "signals", "index.astro");
/** a per-row hit that is NOT listed stock (House "OT", as the live Not Fade Away row) */
const other = (over: Partial<Signal> = {}): Signal =>
  sig({ kind: "s1-large", asset: "Not Fade Away LLC [OT]", assetType: "OT", owner: "spouse", listedStock: false, entities: { bioguide: "B000002", memberName: "Other Member", ticker: null }, ...over });
/** a record from a build that predates the R8 fields */
function priorRecord(over: Partial<Signal> & { kind: Signal["kind"] }): Signal {
  const s = sig(over);
  delete s.asset;
  delete s.assetType;
  delete s.side;
  delete s.owner;
  delete s.listedStock;
  return s;
}
const hitRows = (html: string) => domOf(html).querySelectorAll("#signal-hits-body tr.si-hit");
const FILTER = (over: Partial<HitFilter> = {}): HitFilter => ({ kind: "all", watchedOnly: false, stocksOnly: true, watchedMembers: new Set(), watchedTickers: new Set(), ...over });

test("R7 / T8: the page is Congress signals (title, h1, description); the 13F and cross-regime tiles are gone; the institutional rule-book sentence stays", () => {
  const html = signalsBody(ART, CTX);
  assert.match(html, /<h1 class="page-title">Congress signals<\/h1>/);
  const ledger = domOf(html).querySelector(".design-ledger")!;
  const labels = ledger.querySelectorAll("dt").map((dt) => ownText(dt).trim());
  assert.deepEqual(labels, ["Active kinds", "Hits · Congress"]);
  assert.doesNotMatch(html, /Hits · 13F|Cross-regime|CROSS-REGIME/);
  assert.match(html, /Institutional kinds wait on closed 13F periods and are not simulated\./);
  const page = readFileSync(PAGE_SRC, "utf-8");
  assert.match(page, /<Base title="Congress signals — Public Filings"/);
  assert.match(page, /"Congress signals: /, "the meta description names the page");
  assert.match(page, /active="signals"/, "the masthead nav entry is unchanged");
});

test("R10 / T9: the WHAT sentence — owner, verb, asset, chip; S-3 names its members and side; a prior record says the asset is not in it", () => {
  const spouse = signalSentence(other());
  assert.equal(spouse.text, "Spouse: Purchase of Not Fade Away LLC · Other", "the plan's live example, in the amended side-noun wording");
  assert.equal(spouse.chip, null, "a code the asset text already renders is not printed twice");
  /* R10 as amended (plan deviation, DEV-NOTES D-1): the side is a NOUN, symmetric
     across sides — the plan's past-tense sale verb is banned wording (§0). */
  const sides: [Signal["side"], string][] = [["purchase", "Purchase of"], ["sale", "Sale of"], ["sale_partial", "Partial sale of"], ["exchange", "Exchange of"], ["other", "Transaction in"]];
  for (const [side, noun] of sides) assert.equal(signalSentence(sig({ kind: "s1-large", side })).text, `${noun} ABC Holdings Inc`, side);
  for (const [owner, word] of [["child", "Child"], ["joint", "Joint"], ["spouse", "Spouse"]] as const) {
    assert.equal(signalSentence(sig({ kind: "s1-large", owner, side: "sale_partial" })).text, `${word}: Partial sale of ABC Holdings Inc`);
  }
  assert.equal(signalSentence(sig({ kind: "s1-large", owner: null })).text, "Purchase of ABC Holdings Inc", "an unstated owner adds no qualifier");
  assert.equal(signalSentence(sig({ kind: "s1-large", owner: "self" })).text, "Purchase of ABC Holdings Inc", "self has no prefix");
  /* The chip (R10 deviation D-3): a LISTED STOCK carries none — `displayAsset`'s
     own rule, "only a stock code that is the row's own type goes silent". Every
     other type is shown: a House code as the Clerk's words, a Senate label
     verbatim, and an untyped row says so. */
  assert.equal(signalSentence(sig({ kind: "s1-large", asset: "Apple Inc (AAPL)", assetType: "ST" })).chip, null, "House ST: no chip");
  assert.equal(signalSentence(sig({ kind: "s1-large", assetType: "Stock" })).chip, null, "Senate Stock: no chip");
  assert.equal(signalSentence(sig({ kind: "s1-large", assetType: "Other", listedStock: false })).chip, "Other");
  assert.equal(signalSentence(sig({ kind: "s1-large", assetType: "CS", listedStock: false })).chip, "Corporate Securities (Bonds and Notes)");
  assert.equal(signalSentence(sig({ kind: "s1-large", assetType: "Municipal Security", listedStock: false })).chip, "Municipal Security");
  assert.equal(signalSentence(sig({ kind: "s1-large", assetType: "PS", listedStock: false })).chip, "Stock (Not Publicly Traded)", "equity that is not LISTED stock keeps its chip");
  assert.equal(signalSentence(sig({ kind: "s1-large", assetType: null, listedStock: false })).chip, "type not stated");
  assert.equal(signalSentence(sig({ kind: "s1-large", asset: null })).text, "Purchase of Asset not named");
  // S-3: "{n} members: {purchases|sales} of {ticker}"
  const s3 = (side: "purchase" | "sale") => sig({ kind: "s3-cooccurrence", side, entities: { bioguide: null, memberName: "4 members", ticker: "NVDA" } });
  assert.equal(signalSentence(s3("purchase")).text, "4 members: purchases of NVDA");
  assert.equal(signalSentence(s3("sale")).text, "4 members: sales of NVDA");
  assert.equal(signalSentence(s3("sale")).chip, null);
  // the amended wording passes the site's banned-wording scan on every side, owner and S-3 form
  for (const [side] of sides) for (const owner of ["self", "spouse", "child", "joint", null] as const) {
    assert.deepEqual(scanBannedWording(signalSentence(sig({ kind: "s1-large", side, owner })).text), [], `${side}/${owner}`);
  }
  for (const side of ["purchase", "sale"] as const) assert.deepEqual(scanBannedWording(signalSentence(s3(side)).text), []);
  assert.ok(scanBannedWording("Spouse sold Walt Disney Company").length > 0, "control: the plan's original verb is what the gate rejects");
  // a record without the fields
  for (const kind of ["s1-large", "s3-cooccurrence"] as const) {
    const x = signalSentence(priorRecord({ kind }));
    assert.deepEqual([x.text, x.chip, x.recorded], ["asset not in this record", null, false], kind);
  }
});

test("R10 / T9: every signal-row renderer prints the sentence — hit rows, watch band payload, home tile, member panel; the legacy renderer is gone", async () => {
  const art: SignalArtifact = { ...ART, signals: [other({ entities: { bioguide: "A000001", memberName: "Test <Member>", ticker: null } }), sig({ kind: "s2-first" })] };
  const html = signalsBody(art, CTX);
  assert.match(ownText(hitRows(html)[0]!.querySelector("td.si-what")!), /^Purchase of ABC Holdings Inc$/, "hit row: a listed stock, so no chip");
  assert.equal(hitRows(html)[0]!.querySelector(".si-asset-chip"), null);
  // unfiltered, a non-stock hit row carries its type chip
  const municipal = signalsBody({ ...ART, signals: [sig({ kind: "s1-large", assetType: "Municipal Security", listedStock: false })] }, CTX);
  assert.match(municipal, /"Municipal Security"/, "the type rides in the watch payload");
  const { hitRowHtml } = await import("../src/lib/ui/index.ts");
  const muniRow = domOf(`<table><tbody>${hitRowHtml(sig({ kind: "s1-large", assetType: "Municipal Security", listedStock: false }), CTX)}</tbody></table>`);
  assert.equal(ownText(muniRow.querySelector("td.si-what .si-asset-chip")!), "Municipal Security");
  // the watch band embeds the fields its client builds the same sentence from
  const payload = JSON.parse(domOf(html).querySelector("#signal-watch-data")!.textContent) as { cols: string[]; rows: unknown[][] };
  assert.deepEqual(payload.cols.slice(-5), ["side", "asset", "assetType", "owner", "stk"]);
  const row = payload.rows.find((r) => r[1] === "s1-large")!;
  assert.deepEqual(row.slice(-5), ["purchase", "Not Fade Away LLC [OT]", "OT", "spouse", false]);
  const client = readFileSync(path.resolve(import.meta.dirname, "..", "src", "scripts", "signals-client.ts"), "utf-8");
  assert.match(client, /signalSentence\(\{/, "the watch band's client prints the shared sentence");
  // home tile
  const tile = signalsTileHtml(art.signals, CTX, () => "LARGE");
  assert.match(ownText(domOf(tile).querySelector("tbody td.c-flex")!), /Purchase of ABC Holdings Inc/);
  // member panel (unfiltered: the non-stock hit is listed too)
  const panel = memberSignalsPanel(art, "A000001", CTX);
  const whats = domOf(panel).querySelectorAll("tbody td.si-what").map((td) => ownText(td).trim());
  assert.ok(whats.includes("Spouse: Purchase of Not Fade Away LLC · Other"), whats.join(" | "));
  assert.ok(whats.includes("Purchase of ABC Holdings Inc"), "the member panel's stock row has no chip either");
  // the member panel is unfiltered, so an untyped row shows there with its chip
  const untyped = memberSignalsPanel({ ...ART, signals: [sig({ kind: "s1-large", assetType: null, listedStock: false })] }, "A000001", CTX);
  assert.equal(ownText(domOf(untyped).querySelector("tbody td.si-what")!).trim(), "Purchase of ABC Holdings Inc type not stated");
  // no orphan legacy renderer
  const ui = readFileSync(path.resolve(import.meta.dirname, "..", "src", "lib", "ui", "signals.ts"), "utf-8");
  assert.doesNotMatch(ui, /signalRowHtml/);
});

test("R11 / T10: exact repeats within one filing collapse to one line ×n; size is sumRanges; the evidence lists every id; the artifact keeps both", () => {
  const a = sig({ kind: "s1-large", id: "s1-large:aaaa", receipts: ["https://efdsearch.senate.gov/r1"] });
  const b = sig({ kind: "s1-large", id: "s1-large:bbbb", receipts: ["https://efdsearch.senate.gov/r1"] });
  const art: SignalArtifact = { ...ART, signals: [a, b] };
  const html = signalsBody(art, CTX);
  const rows = hitRows(html);
  assert.equal(rows.length, 1, "two identical hits are one line");
  assert.equal(rows[0]!.getAttribute("data-group-size"), "2");
  assert.match(ownText(rows[0]!.querySelector("td.si-what")!), /×2$/);
  assert.equal(ownText(rows[0]!.querySelector("td.si-mag")!), "$500K–$1.0M", "sumRanges: 250,001 + 250,001 → $500K floor; 500K + 500K high");
  const evidence = domOf(html).querySelector("#signal-hits-body tr.si-evidence-row")!;
  const ids = evidence.querySelectorAll(".si-group-members li .mono-id").map((x) => ownText(x));
  assert.deepEqual(ids, ["s1-large:aaaa", "s1-large:bbbb"]);
  assert.match(html, /id="signal-hits-range"[^>]*>1–1 of 1 line · 2 hits</, "the counter reads lines · hits");
  assert.equal(art.signals.length, 2, "grouping is presentation only");
  // an open member keeps the group open
  const open = groupHits([sig({ kind: "s1-large", magnitude: { low: 1000001, high: null } }), sig({ kind: "s1-large", magnitude: { low: 1000001, high: null } })]);
  assert.equal(open.length, 1);
  const openHtml = signalsBody({ ...ART, signals: open[0]!.members }, CTX);
  assert.equal(ownText(hitRows(openHtml)[0]!.querySelector("td.si-mag")!), "Over $2.0M", "an open bound stays open");
});

test("R11 / T10 negatives: S-3 never groups; a different ticker never groups; a prior record never groups", () => {
  const s3 = (ticker: string) => sig({ kind: "s3-cooccurrence", side: "purchase", entities: { bioguide: null, memberName: "4 members", ticker }, receipts: ["https://efdsearch.senate.gov/a", "https://efdsearch.senate.gov/b"] });
  assert.equal(groupHits([s3("NVDA"), s3("AMD")]).length, 2, "two S-3 signals with identical receipts, dates and magnitude but different tickers stay two lines");
  assert.equal(groupHits([s3("NVDA"), s3("NVDA")]).length, 2, "S-3 is an aggregate — never grouped, even when identical");
  const t = (ticker: string) => sig({ kind: "s1-large", entities: { bioguide: "A000001", memberName: "A", ticker } });
  assert.equal(groupHits([t("ABC"), t("XYZ")]).length, 2, "per-row signals differing only in ticker stay two lines");
  assert.equal(groupHits([t("ABC"), t("ABC")]).length, 1, "control: the same pair with one ticker groups");
  assert.equal(groupHits([priorRecord({ kind: "s1-large" }), priorRecord({ kind: "s1-large" })]).length, 2, "a record lacking the R8 fields is never grouped");
  // every key field separates: flip each one and the pair stays two lines
  const flips: Partial<Signal>[] = [
    { kind: "s6-late-large" }, { receipts: ["https://efdsearch.senate.gov/other"] }, { entities: { bioguide: "Z000009", memberName: "Test <Member>", ticker: "ABC" } },
    { asset: "Other Name" }, { assetType: "ST" }, { side: "sale" }, { owner: "spouse" }, { magnitude: { low: 250001, high: 1000000 } },
    { occurrence: { tradeDate: "2026-03-02", filedDate: "2026-06-01" } }, { occurrence: { tradeDate: "2026-03-01", filedDate: "2026-06-02" } },
  ];
  for (const f of flips) assert.equal(groupHits([sig({ kind: "s1-large" }), sig({ kind: "s1-large", ...f })]).length, 2, JSON.stringify(f));
});

test("R12 / T11: listed stocks only by default — SSR hides non-stock hits and states the count; unchecked shows every row", () => {
  const art: SignalArtifact = { ...ART, signals: [sig({ kind: "s1-large" }), other(), other({ kind: "s6-late-large" }), priorRecord({ kind: "s2-first" })] };
  const html = signalsBody(art, CTX);
  const box = domOf(html).querySelector("#signal-stocks-only")!;
  assert.ok(box.hasAttribute("checked"), "checked by default");
  assert.equal(box.getAttribute("autocomplete"), "off", "never restored by the browser");
  assert.equal(hitRows(html).length, 1, "only the listed-stock hit");
  assert.equal(ownText(domOf(html).querySelector("#signal-hidden-count")!), "3 hits on other asset types hidden", "the prior record counts as not listed");
  // the unchecked state (the same view function the client repaints through)
  const sorted = art.signals.filter((s) => s.status === "active");
  const all = hitsView(sorted, FILTER({ stocksOnly: false }));
  assert.equal(all.lines.length, 4);
  assert.equal(all.hidden, 0);
  assert.equal(hitsHiddenText(all.hidden, false), "all asset types shown");
  const client = readFileSync(path.resolve(import.meta.dirname, "..", "src", "scripts", "signals-client.ts"), "utf-8");
  assert.match(client, /let stocksOnly = true;\s*if \(stocksChk\) stocksChk\.checked = true;/, "every load starts at the default");
  assert.match(client, /hitsView\(hits, filter\(\)\)/, "the pager repaints through the shared view");
});

test("R12 / T11: kind × watched × stocks — the hidden count is the total minus shown under every combination", () => {
  const hits = [
    sig({ kind: "s1-large", entities: { bioguide: "A000001", memberName: "A", ticker: "ABC" } }),
    sig({ kind: "s1-large", entities: { bioguide: "B000002", memberName: "B", ticker: "XYZ" }, assetType: "OT", listedStock: false }),
    sig({ kind: "s6-late-large", entities: { bioguide: "A000001", memberName: "A", ticker: null }, assetType: null, listedStock: false }),
    sig({ kind: "s6-late-large", entities: { bioguide: "C000003", memberName: "C", ticker: "QQQ" } }),
    sig({ kind: "s3-cooccurrence", side: "sale", listedStock: false, entities: { bioguide: null, memberName: "4 members", ticker: "XYZ" } }),
  ];
  for (const kind of ["all", "s1-large", "s6-late-large", "s3-cooccurrence"]) {
    for (const watchedOnly of [false, true]) {
      for (const stocksOnly of [false, true]) {
        const f = FILTER({ kind, watchedOnly, stocksOnly, watchedMembers: new Set(["A000001"]), watchedTickers: new Set(["XYZ"]) });
        const others = hits.filter((s) => hitMatches(s, { ...f, stocksOnly: false }));
        const shown = hits.filter((s) => hitMatches(s, f));
        const v = hitsView(hits, f);
        assert.equal(v.hits, shown.length, `${kind}/${watchedOnly}/${stocksOnly}`);
        assert.equal(v.hidden, others.length - shown.length, `${kind}/${watchedOnly}/${stocksOnly}: hidden = total minus shown`);
        if (stocksOnly) assert.ok(shown.every((s) => s.listedStock === true), "only listed stocks show");
        if (kind !== "all") assert.ok(shown.every((s) => s.kind === kind));
        if (watchedOnly) assert.ok(shown.every((s) => s.entities.bioguide === "A000001" || s.entities.ticker === "XYZ"));
      }
    }
  }
  // spot values: watched + stocks + all kinds → A's ABC hit only; the untyped LATE and the S-3 on XYZ are hidden
  const v = hitsView(hits, FILTER({ watchedOnly: true, watchedMembers: new Set(["A000001"]), watchedTickers: new Set(["XYZ"]) }));
  assert.deepEqual([v.hits, v.hidden], [1, 3]);
});

test("R12: the home tile takes the same default and states its hidden count", () => {
  const tile = signalsTileHtml([other(), sig({ kind: "s1-large" }), other()], CTX, () => "LARGE");
  assert.equal(domOf(tile).querySelectorAll("tbody tr").length, 1);
  assert.match(tile, /<span class="si-hidden-count">2 hits on other asset types hidden<\/span>/);
});

test("R13 / T12: LARGEST prefers a listed-stock hit over a larger non-stock one; COMPLIANCE counts listed stocks and adds the rest; RAREST and rates read every type", () => {
  const art: SignalArtifact = {
    ...ART,
    signals: [
      sig({ kind: "s1-large", magnitude: { low: 250001, high: 500000 }, entities: { bioguide: "A000001", memberName: "Stock Holder", ticker: "ABC" } }),
      other({ magnitude: { low: 5000001, high: 25000000 }, entities: { bioguide: "B000002", memberName: "Big Other", ticker: null } }),
      sig({ kind: "s6-late-large", occurrence: { tradeDate: "2026-01-01", filedDate: "2026-06-01" } }),
      other({ kind: "s6-late-large", occurrence: { tradeDate: "2025-06-01", filedDate: "2026-06-01" } }),
      other({ kind: "s6-late-large", occurrence: { tradeDate: "2025-06-01", filedDate: "2026-06-01" } }),
    ],
  };
  const html = signalsBody(art, CTX, { rowsEvaluated: 1000, latestBatch: [], latestBatchFiled: null });
  const stories = domOf(html).querySelectorAll(".design-story");
  assert.match(ownText(stories[0]!), /Largest lower bound this window · listed stocks/);
  assert.match(ownText(stories[0]!), /Stock Holder · \$250K–\$500K/, "the stock hit, not the $5M non-stock one");
  assert.doesNotMatch(ownText(stories[0]!), /Big Other/);
  assert.match(ownText(stories[1]!), /1 disclosure in listed stocks filed past the 45-day window with a lower bound ≥ \$100K · \+2 on other asset types/);
  assert.match(ownText(stories[1]!), /longest listed-stock one ran \+151 days/, "the max lag reads listed stocks (the non-stock ones ran 365)");
  assert.match(ownText(stories[2]!), /Rarest · highest signal · all asset types/);
  assert.match(html, /ALL ASSET TYPES · RARER = MORE INFORMATIVE/);
  const ledger = domOf(html).querySelector(".design-ledger")!;
  assert.match(ownText(ledger), /Hits · Congress5.*2 in listed stocks/, "the Congress tile states the total and the listed-stock count");
  // listed zero, others present: the count is stated, never a computed zero for the rule
  const onlyOther = signalsBody({ ...ART, signals: [other({ kind: "s6-late-large" })] }, CTX);
  assert.match(onlyOther, /No late-and-large disclosures in listed stocks in the window · \+1 on other asset types/);
  assert.doesNotMatch(onlyOther, /Zero hits is the computed answer for the LATE rule/);
});
