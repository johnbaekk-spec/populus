/* Refinement 20260910 — Milestone 3 (Polish): R21 … R27 unit checks.
   Post-build checks over the real dist live in test/post/ (R23 strings, R27 gate). */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import { cardFoot, thLabelHtml, HEADER_ABBREVIATIONS } from "../src/lib/format.ts";
import { DESIGN_INST_INDEX_HEADS } from "../src/lib/inst-index.ts";
import { unavailableDesignPanel, plannedLine } from "../src/lib/ui/shared.ts";
import { instStamp, instFiledNote, INST_STAMP_CAVEAT } from "../src/lib/ui/institutional.ts";
import { RULE3_PATTERNS, visibleText } from "./lib/banned-scan.ts";

const SRC = path.resolve(import.meta.dirname, "..", "src");

/* ---------- R21 cardFoot ---------- */

test("R21: cardFoot — a short line with the full text behind an ⓘ when it has ≤2 clauses", () => {
  const html = cardFoot({ short: "Counts of filed transactions", full: "Counts are filed transactions; ranges cannot be netted.", scope: "t", key: "k" });
  assert.match(html, /^<div class="card-foot"><span>Counts of filed transactions<\/span>/);
  assert.ok(html.includes('class="note-btn"'), "the full text sits behind an ⓘ");
  assert.ok(html.includes("ranges cannot be netted"), "the full text is in the DOM, never dropped");
  assert.ok(!html.includes("<details"), "two clauses do not need a disclosure");
});

test("R21: cardFoot — more than two clauses become a 'How this is computed' disclosure", () => {
  const html = cardFoot({ short: "Sector", full: "one · two · three", scope: "t", key: "k", extraHtml: '<a href="/x/">all ↗</a>' });
  assert.ok(html.includes("<details class=\"card-foot-more\"><summary>How this is computed</summary><p>one · two · three</p></details>"));
  assert.ok(html.includes('<a href="/x/">all ↗</a>'), "a caller's link is kept");
  assert.ok(!html.includes('class="note-btn"'));
});

test("R21: the six footers are converted — no raw card-foot literal is left in their renderers", () => {
  for (const f of ["lib/ui/congress.ts", "lib/ui/ticker.ts", "lib/ui/signals.ts"]) {
    const src = readFileSync(path.join(SRC, f), "utf-8");
    assert.ok(!src.includes('`<div class="card-foot">'), `${f} still renders a raw card-foot`);
    assert.ok(src.includes("cardFoot({"), `${f} uses cardFoot`);
  }
  const inst = readFileSync(path.join(SRC, "lib/ui/institutional.ts"), "utf-8");
  assert.ok(!inst.includes("caveat-inline\">${esc(INST_STAMP_CAVEAT)}"), "the INST_STAMP_CAVEAT lines go through cardFoot");
});

/* ---------- R22 header labels ---------- */

test("R22: abbreviated headers read in full words; the abbreviation is narrow-only and hidden from AT", () => {
  assert.deepEqual(
    Object.fromEntries(["Source", "Trades", "Position change", "Amount range", "Gross bought ·§"].map((k) => [k, HEADER_ABBREVIATIONS[k]])),
    { Source: "Rcpt", Trades: "Txns", "Position change": "Δ Pos", "Amount range": "Interval", "Gross bought ·§": "Gross purch ·§" },
  );
  const html = thLabelHtml("Source");
  assert.equal(html, '<span class="th-full">Source</span><span class="th-abbr" aria-hidden="true">Rcpt</span>');
  assert.equal(thLabelHtml("Member"), "Member", "a label with no abbreviation is plain text");
  const css = readFileSync(path.join(SRC, "styles/late-additions.css"), "utf-8");
  assert.match(css, /\.th-abbr \{ display: none; \}/);
  assert.match(css, /@media \(max-width: 899px\)[\s\S]*\.th-abbr \{ display: inline; \}/);
  for (const f of ["lib/format.ts", "lib/congress-columns.ts", "lib/ui/rankings.ts", "lib/ui/congress.ts", "lib/holdings.ts", "lib/activity.ts"]) {
    // the abbreviation map itself names the abbreviations; everything else must not
    const src = readFileSync(path.join(SRC, f), "utf-8").replace(/export const HEADER_ABBREVIATIONS[\s\S]*?\n\};/, "");
    for (const abbr of ['"Rcpt"', '"Txns †"', '"Txns†"', '"Δ Pos"', '"Gross purch ·§"', '"Interval · log $1K–$50M+"', ">Txns<"]) {
      assert.ok(!src.includes(abbr), `${f} still labels a header ${abbr}`);
    }
  }
});

/* ---------- R23 copy + methodology anchors ---------- */

test("R23: the search box and the methodology anchors", () => {
  const base = readFileSync(path.join(SRC, "layouts/Base.astro"), "utf-8");
  assert.ok(base.includes('placeholder="Search members, tickers, managers"'));
  const m = readFileSync(path.join(SRC, "pages/methodology/index.astro"), "utf-8");
  for (const id of ["published-dataset", "coverage", "13f-method", "ranges", "position-grain", "ticker-mapping", "site-weight", "principles"]) {
    assert.ok(m.includes(`id="${id}"`), `methodology lacks #${id}`);
  }
});

test("R23: the 13F quarter stamp reads 'Quarter ended …' and the newest filing moves to its ⓘ", () => {
  assert.equal(instStamp("2026-03-31", "2026-07-31"), '<span class="inst-stamp" data-latest-filed="2026-07-31">Quarter ended 2026-03-31</span>');
  assert.equal(instFiledNote("2026-07-31"), "Newest filing in this build: 2026-07-31. Per-row filing dates are on each receipt.");
  assert.ok(!/watermark|published aggregate/.test(INST_STAMP_CAVEAT));
});

/* ---------- R24 empty panels ---------- */

test("R24: an unavailable surface is one line — no frame, no empty table — and keeps its reason", () => {
  const html = unavailableDesignPanel("Crowding", "PCT-RANK", ["Measure", "Percentile"], "No holder rows for the selected period.");
  assert.ok(!html.includes("<table") && !html.includes("<section"), "no frame");
  assert.ok(html.includes("No holder rows for the selected period."), "the reason is kept");
  assert.match(plannedLine(["a", "b"]), /PLANNED<\/span> a · b/);
});

test("R24: the filer directory drops the Turnover and Congress overlap columns", () => {
  const labels = DESIGN_INST_INDEX_HEADS.map((h) => h.label);
  assert.ok(!labels.includes("Turnover") && !labels.includes("Congress overlap"), labels.join(", "));
  assert.deepEqual(labels, ["Filer", "CIK", "Value", "Pos", "Top-5", "Latest notable"]);
});

/* ---------- R27 banned-vocabulary gate ---------- */

test("R27: the visible-text gate catches a planted term and ignores machine surface", () => {
  const hit = (html: string): string[] => RULE3_PATTERNS.filter(({ re }) => re.test(visibleText(html))).map((p) => p.name);
  assert.deepEqual(hit("<p>every row resolves through the shard's dictionary</p>"), ["shard"], "a planted term fails the gate");
  assert.deepEqual(hit('<button aria-label="the projection">x</button>'), ["projection"], "aria-label is visible copy");
  assert.deepEqual(hit('<tr data-bioguide="W000805"><td>Mark R. Warner</td></tr>'), [], "an attribute value is not copy");
  assert.deepEqual(hit('<td><span class="filed-name">W.W. GRAINGER, INC.</span></td>'), [], "a filed name is not the site's voice");
  assert.deepEqual(hit('<script>const shard = 1; const bioguide = 2;</script><p>ok</p>'), [], "script is not copy");
  assert.deepEqual(hit("<p>value_undisclosed_one_side change_kind_undeterminable</p>"), ["change_kind"], "a raw flag key is caught");
});
