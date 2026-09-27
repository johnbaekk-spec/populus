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
  assert.match(html, /id="signal-hits-range"[^>]*>1–2 of 3 hits</, "the pager states the page");
  assert.match(html, /id="signal-hits-next" aria-disabled="false"/);
  assert.match(html, /data-family="COMPLIANCE"/);
  /* the summary names the evidence row it opens (DESIGN-POLISH M2 review R2-8) */
  assert.match(html, /<details class="si-expand"><summary aria-controls="si-evidence-s1-large:[0-9a-f]+">disclosed lower bound \$250K · ≥ \$250K rule<\/summary>/, "one-line evidence");
  assert.match(html, /<strong>Rule:<\/strong> rule text/, "full text in the expand");
  assert.doesNotMatch(html, /render bound/);
  const full = signalsBody(ART, CTX, { rowsEvaluated: 1000, latestBatch: [], latestBatchFiled: null });
  assert.match(full, /data-page-size="50"/);
  assert.match(full, /id="signal-hits-range"[^>]*>1–3 of 3 hits</);
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
