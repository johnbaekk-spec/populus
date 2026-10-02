/* DESIGN-POLISH M1 — the ledger table system, as one set of structural pins.

   T1.1 (R4, R5): the tokens live once in foundation.css, none under the 9.5px
   floor, every colour token in both themes, and the design's failing colours
   never used where the plan lifted them (T-17).
   T1.3 (R2, R32): role classes on headers and cells; no `class="num"`; no mark
   inside a label's text; `data-kind` on a row only as a signal kind.
   T1.4 (R8): one count grammar, `rangeOfTotal`; no hand-built count literal.
   T1.5 (R6): no trigger nested in a link or button; a label trigger's name
   contains its label; a feed row's flags are visible chips, never inside a
   note; a note hoists only when it holds on every row.
   T1.7 (R9): the ledger region is the single source of cell typography and
   padding, and its ≤1080px block precedes its ≤720px block.
   T1.8 (R4): every font size reads a token.

   Every check below carries a planted control that must fail it, so a check
   that silently matches nothing cannot pass. */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { baseStylesheet } from "./lib/styles.ts";
import { renderParitySurfaces } from "./lib/ui-parity-surfaces.ts";
import { MiniElement } from "./lib/mini-dom.ts";
import {
  rangeOfTotal,
  compactBoundCount,
  universalFlags,
  txnRowHtml,
  noteFromHtml,
  thLabelHtml,
  FEED_FLAG_DEFINITIONS,
  TICKER_ABSENT_NOTE,
  SPOUSE_CAP_NOTE,
  AMOUNT_UNPARSED_SPOKEN,
  AMENDMENT_PENDING_NOTE,
  DATE_ANOMALY_NOTE,
  DEFECT_FLAG_NOTE,
  flagChips,
  UNKNOWN_FLAG_LABEL,
} from "../src/lib/format.ts";
import { BANNED_PATTERNS, redactFiledNames } from "./lib/banned-scan.ts";

const DASHBOARD = path.resolve(import.meta.dirname, "..");
const SRC = path.join(DASHBOARD, "src");
const STYLES = path.join(SRC, "styles");

function stripComments(s: string): string {
  return s.replace(/\/\*[\s\S]*?\*\//g, "");
}

/* ------------------------------------------------------------ the region */

const BEGIN = "ledger:begin";
const END = "ledger:end";

/** The whole stylesheet split into the ledger region and everything else.
    Throws unless there is exactly one begin and one end marker, in order. */
function splitRegion(css: string): { region: string; outside: string } {
  const b = css.indexOf(BEGIN);
  const e = css.indexOf(END);
  if (b < 0 || e < 0 || css.indexOf(BEGIN, b + 1) >= 0 || css.indexOf(END, e + 1) >= 0 || e < b) {
    throw new Error("the ledger region needs exactly one begin and one end marker, in order");
  }
  const start = css.lastIndexOf("/*", b);
  const stop = css.indexOf("*/", e) + 2;
  return { region: css.slice(start, stop), outside: css.slice(0, start) + css.slice(stop) };
}

/** Innermost rules (selector, declarations); at-rule preludes are skipped. */
function rulesOf(css: string): { selector: string; decls: string }[] {
  const out: { selector: string; decls: string }[] = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  for (let m = re.exec(stripComments(css)); m; m = re.exec(stripComments(css))) {
    out.push({ selector: m[1]!.trim(), decls: m[2]! });
  }
  return out;
}

const CELL_PROPS = /(?:^|;)\s*(font|font-size|padding(?:-[a-z]+)?|letter-spacing|text-transform)\s*:/i;
/** The classic /watchlist/ feed keeps its own grid (A-4): its rules are scoped
    with zero specificity to the classic table and are the one allowed scope. */
const CLASSIC_SCOPE = /\.feed-table:not\(\.reference-feed\)/;
const SI_CELLS = /\.si-(?:kind|what|when|mag|ticker-cell|subject|evidence|family|rule-text|why|hits|status)\b/;

function rightmostCompound(selector: string): string {
  const parts = selector.trim().split(/\s*[>+~]\s*|\s+/);
  return parts[parts.length - 1] ?? "";
}

/** Selectors outside the region that set cell typography or padding on a
    ledger cell or a class-targeted cell role. */
function strayCellRules(outside: string): string[] {
  const stray: string[] = [];
  for (const r of rulesOf(outside)) {
    if (!CELL_PROPS.test(r.decls)) continue;
    for (const part of r.selector.split(",").map((s) => s.trim()).filter(Boolean)) {
      if (part.startsWith("@")) continue;
      if (CLASSIC_SCOPE.test(part)) continue;
      const rm = rightmostCompound(part);
      const tableCell = /(?:^|[^\w-])(?:th|td)(?![\w-])/.test(rm) && /\.etable|\.reference-feed|\.si-table|\btable\b/.test(part);
      const role =
        /\.c-[a-z]/.test(rm) ||
        (/\.reference-feed/.test(part) && /\.cell-/.test(rm)) ||
        SI_CELLS.test(rm) ||
        /\.design-[a-z-]*(?:cell|issuer|value)\b/.test(rm) ||
        /\.bar-list\b.*\.(?:value|v)\b/.test(part);
      if (tableCell || role) stray.push(part);
    }
  }
  return stray;
}

test("T1.7: the ledger region is the ONLY source of ledger cell typography and padding", () => {
  const { outside } = splitRegion(baseStylesheet());
  assert.deepEqual(strayCellRules(outside), [], "cell typography or padding declared outside the ledger region");
});

test("T1.7 controls: a planted feed-cell font size and a planted activity cell padding each fail", () => {
  const { outside } = splitRegion(baseStylesheet());
  for (const planted of [
    ".reference-feed .cell-member{font-size:13px}",
    ".design-activity .etable td{padding:9px}",
  ]) {
    assert.ok(strayCellRules(outside + "\n" + planted).length > 0, `control not caught: ${planted}`);
  }
  // …and the classic scope stays the one allowance.
  assert.equal(strayCellRules(":where(.feed-table:not(.reference-feed)) .cell-member{font-size:13px}").length, 0);
});

test("T1.7: the region's ≤1080px block precedes its ≤720px block, and the region is one contiguous block", () => {
  const { region } = splitRegion(baseStylesheet());
  const wide = region.indexOf("@media (max-width: 1080px)");
  const fold = region.indexOf("@media (max-width: 720px)");
  assert.ok(wide >= 0 && fold >= 0, "both blocks live in the region");
  assert.ok(wide < fold, "the ≤1080px block comes first, so the fold overrides it");
  const entities = readFileSync(path.join(STYLES, "entities.css"), "utf-8");
  assert.ok(entities.includes(BEGIN) && entities.includes(END), "the region lives in entities.css");
  assert.throws(() => splitRegion(baseStylesheet() + `/* ${BEGIN} */`), /exactly one/);
});

/* ------------------------------------------------------------ tokens (T1.1) */

function block(css: string, head: string): string {
  const i = css.indexOf(head);
  assert.ok(i >= 0, `no ${head} block`);
  const open = css.indexOf("{", i);
  const close = css.indexOf("}", open);
  return css.slice(open + 1, close);
}
function customProps(body: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of stripComments(body).matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) out.set(m[1]!, m[2]!.trim());
  return out;
}

test("T1.1: fourteen --fs-* tokens, none under the 9.5px floor at any width", () => {
  const foundation = readFileSync(path.join(STYLES, "foundation.css"), "utf-8");
  const dark = customProps(block(foundation, ':root, [data-theme="dark"]'));
  const fs = [...dark.entries()].filter(([k]) => k.startsWith("--fs-"));
  assert.equal(fs.length, 14, fs.map(([k]) => k).join(" "));
  const floorViolations = (css: string): string[] =>
    [...stripComments(css).matchAll(/(--fs-[\w-]+)\s*:\s*([\d.]+)px/g)]
      .filter((m) => Number(m[2]) < 9.5)
      .map((m) => `${m[1]}: ${m[2]}px`);
  assert.deepEqual(floorViolations(foundation), []);
  assert.ok(floorViolations(":root{--fs-label: 9px}").length === 1, "control: a 9px token fails the floor");
});

test("T1.1: every colour token is defined in both themes", () => {
  const foundation = readFileSync(path.join(STYLES, "foundation.css"), "utf-8");
  const dark = customProps(block(foundation, ':root, [data-theme="dark"]'));
  const light = customProps(block(foundation, '[data-theme="light"] {'));
  const colour = (v: string): boolean => /^#|^rgba?\(|^repeating-linear-gradient/.test(v);
  const missing = [...dark.entries()].filter(([k, v]) => colour(v) && !light.has(k)).map(([k]) => k);
  assert.deepEqual(missing, [], "colour tokens without a light value");
  for (const k of ["--ink-label", "--ink-meta", "--rule-head", "--rule-row", "--seg-cue", "--bar-sell", "--kind-late-edge"]) {
    assert.ok(dark.has(k) && light.has(k), k);
  }
});

/** The design's failing values, where the plan lifted them (T-17). */
function bannedColours(css: string): string[] {
  const hits: string[] = [];
  for (const r of rulesOf(css)) {
    for (const d of r.decls.split(";")) {
      const [prop, value] = d.split(":").map((s) => s?.trim().toLowerCase() ?? "");
      if (!prop || !value) continue;
      if (/(^|-)color$/.test(prop) && prop === "color" && /#(64748a|51617a|5b6c81|4f6075)\b/.test(value)) hits.push(`${r.selector} { ${d.trim()} }`);
      if (/#3a4a5e\b/.test(value) || /#5a2e28\b/.test(value)) hits.push(`${r.selector} { ${d.trim()} }`);
    }
  }
  return hits;
}

test("T1.1: the design's failing text, control and bar colours are not used", () => {
  assert.deepEqual(bannedColours(baseStylesheet()), []);
  const late = readFileSync(path.join(STYLES, "late-additions.css"), "utf-8");
  assert.ok(bannedColours(late + "\n.x{color:#64748A}").length > 0, "control: a planted #64748A text colour fails");
});

test("T1.8: every font size on the site reads a --fs-* token", () => {
  const offenders = (css: string): string[] => {
    const out: string[] = [];
    for (const r of rulesOf(css)) {
      for (const d of r.decls.split(";")) {
        const m = /^\s*(font-size|font)\s*:\s*(.+)$/i.exec(d);
        if (!m) continue;
        const value = m[2]!.trim();
        if (m[1]!.toLowerCase() === "font-size" ? !/^var\(--fs-[\w-]+\)$|^inherit$/.test(value) : !/^inherit$|var\(--fs-[\w-]+\)/.test(value)) {
          out.push(`${r.selector} { ${d.trim()} }`);
        }
      }
    }
    return out;
  };
  assert.deepEqual(offenders(baseStylesheet()), []);
  assert.ok(offenders(".x{font-size:10.2px}").length === 1, "control: a raw 10.2px size fails");
  assert.ok(offenders(".x{font:600 8px var(--mono)}").length === 1, "control: a raw size in the shorthand fails");
});

/* ------------------------------------------------------------ source scans */

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) out.push(...sourceFiles(p));
    else if (/\.(ts|astro|js|mjs)$/.test(name)) out.push(p);
  }
  return out;
}
/** `grep -a`: read as latin1 so derive.ts's NUL byte cannot hide a match. */
function scan(pattern: RegExp, extra: { name: string; text: string }[] = []): string[] {
  const hits: string[] = [];
  const files = sourceFiles(SRC).map((f) => ({ name: path.relative(DASHBOARD, f), text: readFileSync(f, "latin1") }));
  for (const f of [...files, ...extra]) {
    f.text.split("\n").forEach((line, i) => {
      if (pattern.test(line)) hits.push(`${f.name}:${i + 1}: ${line.trim().slice(0, 120)}`);
    });
  }
  return hits;
}

test("T1.3: no `class=\"num\"` remains — the numeric role is `c-num`", () => {
  const pattern = /class=\\?"num(?:\\?"|\s)/;
  assert.deepEqual(scan(pattern), []);
  assert.ok(scan(pattern, [{ name: "planted.ts", text: '`<th class="num">x</th>`' }]).length === 1, "control");
});

/** Hand-built count grammars the range grammar replaced (R8). */
const COUNT_LITERAL = /Showing the first|Showing \$\{|Showing [0-9]|\bmore\b[^"`.\n]{0,40}\bbelow\b/;

test("T1.4: no hand-built count literal survives in dashboard/src — every count is rangeOfTotal's", () => {
  assert.deepEqual(scan(COUNT_LITERAL), []);
  assert.equal(
    scan(COUNT_LITERAL, [{ name: "planted.ts", text: "`${fmtInt(n)} more issuers below.`" }]).length,
    1,
    "control: a planted literal is found",
  );
});

test("T1.4: rangeOfTotal is the range grammar, and a definite total names the bound", () => {
  assert.equal(rangeOfTotal(1, 10, 608, "tickers"), "1–10 of 608 tickers");
  assert.equal(rangeOfTotal(51, 100, 72083, "transactions"), "51–100 of 72,083 transactions");
  assert.equal(rangeOfTotal(1, 10, 50, "newest changes by notable managers shown here", { definite: true }), "1–10 of the 50 newest changes by notable managers shown here");
  assert.equal(rangeOfTotal(1, 0, 0, "hits"), "0 hits");
  assert.equal(compactBoundCount(10, 608, "tickers"), "1–10 of 608 tickers");
  assert.equal(compactBoundCount(10, 50, "largest changes shown here", { definite: true }), "1–10 of the 50 largest changes shown here");
});

/* ------------------------------------------------------------ rendered DOM */

function parse(html: string): MiniElement {
  const root = new MiniElement("body");
  root.innerHTML = html;
  return root;
}
function* walk(el: MiniElement): Generator<MiniElement> {
  for (const c of el.children) {
    yield c;
    yield* walk(c);
  }
}
function cls(el: MiniElement): Set<string> {
  return new Set((el.getAttribute("class") ?? "").split(/\s+/).filter(Boolean));
}
/** Visible label text of a header: the cell minus its hung marks, carets,
    mark triggers, note panels and visually hidden text. */
function labelText(el: MiniElement): string {
  let out = "";
  for (const n of el.nodes) {
    if (typeof n === "string") out += n;
    else {
      const c = cls(n);
      if (c.has("hang") || c.has("sort-caret") || c.has("note-mark") || c.has("note-pop") || c.has("visually-hidden") || c.has("th-abbr")) continue;
      out += labelText(n);
    }
  }
  return out;
}
function rowsOf(table: MiniElement): { head: MiniElement[]; body: MiniElement[][] } {
  const thead = table.children.find((c) => c.tagName === "thead");
  const headRow = thead?.children.find((c) => c.tagName === "tr");
  const body: MiniElement[][] = [];
  for (const sec of table.children.filter((c) => c.tagName === "tbody")) {
    for (const tr of sec.children.filter((c) => c.tagName === "tr")) {
      const cells = tr.children.filter((c) => c.tagName === "td" || c.tagName === "th");
      if (cells.some((c) => c.hasAttribute("colspan"))) continue;
      body.push(cells);
    }
  }
  return { head: headRow ? headRow.children.filter((c) => c.tagName === "th") : [], body };
}

let SURFACES: Record<string, string> | null = null;
async function surfaces(): Promise<Record<string, string>> {
  SURFACES ??= await renderParitySurfaces();
  return SURFACES;
}

/** Columns whose every body cell is `c-num` but whose header is not. */
function numericHeadMismatches(html: string): string[] {
  const out: string[] = [];
  for (const table of [...walk(parse(html))].filter((e) => e.tagName === "table")) {
    if (table.hasAttribute("data-multiline")) continue;
    const { head, body } = rowsOf(table);
    if (head.length === 0 || body.length === 0) continue;
    head.forEach((th, i) => {
      const col = body.map((r) => r[i]).filter((c): c is MiniElement => !!c);
      if (col.length === body.length && col.every((c) => cls(c).has("c-num")) && !cls(th).has("c-num")) {
        out.push(`${labelText(th).trim() || `column ${i}`}`);
      }
    });
  }
  return out;
}

test("T1.3: every column whose cells are c-num has a c-num header (the parity surfaces)", async () => {
  for (const [name, html] of Object.entries(await surfaces())) {
    assert.deepEqual(numericHeadMismatches(html), [], name);
  }
  assert.deepEqual(
    numericHeadMismatches(`<table><thead><tr><th scope="col">Value</th></tr></thead><tbody><tr><td class="c-num">1</td></tr></tbody></table>`),
    ["Value"],
    "control: a numeric column under a text header is found",
  );
});

const MARKS = /[†‡§≈]/;
function markedLabels(html: string): string[] {
  return [...walk(parse(html))]
    .filter((e) => e.tagName === "th")
    .map((th) => labelText(th).replace(/\s+/g, " ").trim())
    .filter((t) => MARKS.test(t));
}

test("T1.3: no header label carries a mark in its text — marks hang in the slot", async () => {
  for (const [name, html] of Object.entries(await surfaces())) {
    assert.deepEqual(markedLabels(html), [], name);
  }
  assert.equal(markedLabels(`<table><thead><tr><th scope="col">Trades †</th></tr></thead></table>`).length, 1, "control");
  assert.equal(markedLabels(`<table><thead><tr><th scope="col">Trades<span class="hang">†</span></th></tr></thead></table>`).length, 0);
});

const SIGNAL_KIND = /^s[1-9]-[a-z-]+$/;
test("T1.3: `data-kind` sits on a row only as a signal kind", async () => {
  const bad = (html: string): string[] =>
    [...walk(parse(html))]
      .filter((e) => e.tagName === "tr" && e.hasAttribute("data-kind") && !SIGNAL_KIND.test(e.getAttribute("data-kind")!))
      .map((e) => e.getAttribute("data-kind")!);
  for (const [name, html] of Object.entries(await surfaces())) assert.deepEqual(bad(html), [], name);
  assert.deepEqual(bad(`<table><tbody><tr data-kind="buy"><td>x</td></tr></tbody></table>`), ["buy"], "control");
});

test("T1.2: every ledger table has exactly one c-flex column, except the feed and declared prose tables", async () => {
  const bad = (html: string): string[] =>
    [...walk(parse(html))]
      .filter((e) => e.tagName === "table" && !e.hasAttribute("data-multiline") && !cls(e).has("reference-feed") && !cls(e).has("feed-table"))
      .filter((t) => {
        const { head } = rowsOf(t);
        return head.length > 1 && head.filter((th) => cls(th).has("c-flex")).length !== 1;
      })
      .map((t) => (t.children.find((c) => c.tagName === "caption")?.textContent ?? "table").trim().slice(0, 60));
  for (const [name, html] of Object.entries(await surfaces())) assert.deepEqual(bad(html), [], name);
  assert.equal(bad(`<table><thead><tr><th class="c-flex">a</th><th class="c-flex">b</th></tr></thead></table>`).length, 1, "control: two");
  assert.equal(bad(`<table><thead><tr><th>a</th><th>b</th></tr></thead></table>`).length, 1, "control: none");
});

/* ------------------------------------------------------------ triggers (T1.5) */

function nestedTriggers(html: string): number {
  return [...walk(parse(html))].filter((e) => cls(e).has("note-btn") && (e.parent?.closest("a") || e.parent?.closest("button"))).length;
}
function namesWithoutLabel(html: string): string[] {
  return [...walk(parse(html))]
    .filter((e) => cls(e).has("note-label"))
    .filter((b) => {
      const visible = labelText(b).replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
      const name = b.getAttribute("aria-label") ?? "";
      // Label-in-name (WCAG 2.5.3) is about words a speech user can say; a
      // symbol-only label ("—") has none, and its name states the fact instead.
      return /[\p{L}\p{N}]/u.test(visible) && !name.replace(/\s+/g, " ").includes(visible.replace(/ ·?[§†‡¶≈]$/, "").trim());
    })
    .map((b) => b.getAttribute("aria-label") ?? "");
}

test("T1.5: no trigger sits inside a link or a button; a label trigger's name contains its label", async () => {
  for (const [name, html] of Object.entries(await surfaces())) {
    assert.equal(nestedTriggers(html), 0, name);
    assert.deepEqual(namesWithoutLabel(html), [], name);
  }
  assert.equal(nestedTriggers(`<a href="#"><span class="note"><button class="note-btn">i</button></span></a>`), 1, "control: nested");
  assert.equal(namesWithoutLabel(`<button class="note-btn note-label" aria-label="explain">Net range</button>`).length, 1, "control: name without label");
});

test("T1.5: a note hoists only when it holds on every row of the collection", () => {
  const rows50 = Array.from({ length: 50 }, () => ["amount_unparsed"]);
  assert.deepEqual(universalFlags(rows50), ["amount_unparsed"]);
  const rows49 = rows50.map((r, i) => (i === 49 ? [] : r));
  assert.deepEqual(universalFlags(rows49), [], "49 of 50 stays on its rows");
});

test("T1.5: a flagged reference feed row shows its flags as visible chips, outside any note panel", () => {
  const row = txnRowHtml(
    {
      kind: "txn", txnId: "t1", asset: "Widget Co", assetType: null, filed: "2026-07-21", traded: "2026-06-24",
      name: "Fixture Member", bioguide: "T000001", party: "R", state: "OK", district: null, chamber: "senate",
      ticker: "WMB", side: "purchase", owner: "joint", low: 1001, high: 15000, lag: 27, late: 0,
      flags: ["amendment_unresolved"], doc: "https://efdsearch.senate.gov/x", filingKey: "f1",
    } as never,
    { referenceFeed: true, watched: new Set<string>() },
  );
  const flagsOutsideNotes = (html: string): number =>
    [...walk(parse(html))].filter((e) => cls(e).has("flag") && !e.closest(".note-pop")).length;
  assert.ok(flagsOutsideNotes(row) > 0, "the row's flag chip is visible");
  assert.equal(flagsOutsideNotes(`<span class="note-pop"><span class="flag">x</span></span>`), 0, "control: a flag inside a note is not visible");
});

/* T1.5 (R6) with the §0 wording gate: a label trigger over FILED text keeps
   that text inside its `filed-name` marker. The gate redacts only inside the
   marker, so a filed name copied into an attribute (the aria-label a label
   trigger otherwise carries) fails §0 on every filer page that holds a fund
   filed as "BULLISH FD" — measured on build 20260817.1, five filer pages. */
test("a label trigger over a filed name keeps the name inside its marker, and is still named by it", () => {
  const filed = `<span class="filed-name">BULLISH FD</span>`;
  const html = noteFromHtml("position key", { scope: "t" }, "k", { trigger: "label", textHtml: filed, name: "BULLISH FD" });
  const hits = (h: string) => BANNED_PATTERNS.filter(({ re }) => re.test(redactFiledNames(h))).map((p) => p.name);
  assert.deepEqual(hits(html), [], "no banned word survives the redaction");
  assert.ok(!/aria-label=/.test(html.split("<span class=\"note-pop\"")[0]!), "the trigger carries no aria-label");
  const button = new MiniElement("body");
  button.innerHTML = html;
  assert.equal(button.querySelector("button")!.textContent.replace(/\s+/g, " "), "BULLISH FD, explain", "the accessible name is the content: the name, then explain");
  // control: the attribute form of the same trigger is a §0 hit
  const leaked = html.replace("<button ", `<button aria-label="BULLISH FD, explain" `);
  assert.notDeepEqual(hits(leaked), [], "the control is caught");
  // a label that is not filed text keeps its aria-label
  assert.match(noteFromHtml("x", { scope: "t" }, "k2", { trigger: "label", textHtml: "—", name: "no disclosed value" }), /aria-label="no disclosed value, explain"/);
});

/* =====================================================================
   M1 CODE-REVIEW FIXES (docs/design/polish-preview/M1-REVIEW-LEDGER.md).
   Each test names its ledger id and carries a control that fails it.
   ===================================================================== */

/** Selectors that continue across a line break (not after a comma), and
    unbalanced braces. A selector left with no block of its own joins the NEXT
    rule's selector as one descendant selector that matches nothing — the C-1
    defect, `:is(…M2 boxes…) ⏎ .entity-page… > .design-triptych { order:6 }`,
    which silently dropped the filer page's band order. The stylesheet writes
    every selector of a list on one line, so a line break inside one is the
    fingerprint of a lost block. */
function danglingSelectors(css: string): string[] {
  const src = css.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "));
  const out: string[] = [];
  let depth = 0;
  for (const ch of src) {
    if (ch === "{") depth++;
    else if (ch === "}" && --depth < 0) {
      out.push("an unbalanced }");
      depth = 0;
    }
  }
  if (depth !== 0) out.push(`${depth} unclosed {`);
  const re = /([^{};]+)\{/g;
  for (let m = re.exec(src); m; m = re.exec(src)) {
    const prelude = m[1]!.trim();
    if (!prelude || prelude.startsWith("@")) continue;
    let d = 0;
    let cur = "";
    const parts: string[] = [];
    for (const ch of prelude) {
      if (ch === "(" || ch === "[") d++;
      if (ch === ")" || ch === "]") d--;
      if (ch === "," && d === 0) {
        parts.push(cur);
        cur = "";
      } else cur += ch;
    }
    parts.push(cur);
    for (const p of parts) if (/\n/.test(p.trim())) out.push(p.trim().replace(/\s+/g, " "));
    /* M1 delta review, follow-up 4: a selector list that ENDS in a comma (or
       holds an empty item) is invalid CSS — the browser drops the WHOLE rule,
       every selector in it, silently. */
    if (parts.some((p) => p.trim() === "")) out.push(`an empty selector in the list "${prelude.replace(/\s+/g, " ")}"`);
  }
  return out;
}

test("C-1: every selector has its own declaration block — none swallows the next rule's selector", () => {
  assert.deepEqual(danglingSelectors(baseStylesheet()), []);
  const c1 =
    `:is(.design-flow-band > .panel > .table-scroll, .design-history) \n` +
    `.entity-page:has([data-holdings-surface="filer"]) > .design-triptych { order:6; }`;
  assert.equal(danglingSelectors(c1).length, 1, "control: the C-1 dangling selector is found");
  assert.ok(danglingSelectors(".a { color: red; ").length > 0, "control: an unclosed block is found");
  assert.deepEqual(danglingSelectors(".a,\n.b { color: red; }"), [], "a list broken after its comma is fine");
  // follow-up 4: a list ending in a comma drops the whole rule
  assert.equal(danglingSelectors(".a,\n.b, { color: red; }").length, 1, "control: a trailing comma is found");
  assert.equal(danglingSelectors(".a, , .b { color: red; }").length, 1, "control: an empty item is found");
  assert.equal(danglingSelectors(":is(.a, .b) { color: red; }").length, 0, "a comma inside :is() is not a list item");
});

/* C-1, rewritten in DESIGN-POLISH M2 (T2.5, A-9). The property the M1 pin
   guarded — the filer page's bands stack in their declared order — is now held
   by construction: DOM order IS visual order, and no `:has()`/`order` rule
   re-stacks the page (reading and tab order used to differ from what was
   shown, WCAG 1.3.2 / 2.4.3). The pin moves from "the order rule exists" to
   "no rule reorders a page's bands", with the DOM order pinned where the parts
   are composed (filerBody) and the visual order measured in ledger.spec.ts. */
function reorderingRules(css: string): string[] {
  return rulesOf(css)
    .filter((r) => /(?:^|;)\s*order\s*:/.test(r.decls) && /(?:\.entity-page|\.design-page|data-holdings-surface|data-filer-root|\.design-band|\.design-triptych)/.test(r.selector))
    .map((r) => r.selector);
}
test("C-1 (M2): no rule reorders a page's bands — the filer's reading order is its DOM order", () => {
  assert.deepEqual(reorderingRules(baseStylesheet()), []);
  assert.deepEqual(
    reorderingRules('.entity-page:has([data-holdings-surface="filer"]) > .design-filer-band { order: 6; }'),
    ['.entity-page:has([data-holdings-surface="filer"]) > .design-filer-band'],
    "control: a re-planted order rule is found",
  );
  assert.deepEqual(rulesOf(baseStylesheet()).filter((r) => r.selector.includes(':has([data-holdings-surface')).map((r) => r.selector), [], "no :has() composition rule survives");
});

/* ---- C-8: bar fills on the track reach 3:1 in both themes ---- */

function rgbOf(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const f = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  return [0, 2, 4].map((i) => parseInt(f.slice(i, i + 2), 16)) as [number, number, number];
}
function contrastOf(a: string, b: string): number {
  const lum = (c: [number, number, number]): number => {
    const ch = (v: number): number => {
      const s = v / 255;
      return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * ch(c[0]) + 0.7152 * ch(c[1]) + 0.0722 * ch(c[2]);
  };
  const x = lum(rgbOf(a));
  const y = lum(rgbOf(b));
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
/** Fills drawn on `--bar-track` (the book and signals bars) whose token is
    under 3:1 against the track in a theme. */
function weakTrackFills(css: string, themes: Map<string, string>[]): string[] {
  const out: string[] = [];
  for (const r of rulesOf(css)) {
    if (!/\.book-track\s*>|\.book-hot|\.si-bar-(?:fill|late)|\.si-fill-/.test(r.selector)) continue;
    const v = /background\s*:\s*var\((--[\w-]+)\)/.exec(r.decls)?.[1];
    if (!v) continue;
    for (const t of themes) {
      const fill = t.get(v);
      const track = t.get("--bar-track");
      if (!fill || !track || !fill.startsWith("#")) continue;
      if (contrastOf(fill, track) < 3) out.push(`${r.selector} ${v} ${fill} on ${track}`);
    }
  }
  return out;
}

test("C-8: every bar drawn on the track reaches 3:1 against it, in both themes (the hot and late bars are gold)", () => {
  const foundation = readFileSync(path.join(STYLES, "foundation.css"), "utf-8");
  const dark = customProps(block(foundation, ':root, [data-theme="dark"]'));
  const light = customProps(block(foundation, '[data-theme="light"] {'));
  assert.deepEqual(weakTrackFills(baseStylesheet(), [dark, light]), []);
  for (const sel of [".book-track > .book-hot", ".si-bar-late"]) {
    assert.ok(rulesOf(baseStylesheet()).some((r) => r.selector === sel && /var\(--bar-gold\)/.test(r.decls)), `${sel} reads --bar-gold`);
  }
  // control: the late EDGE token on the dark track, where these bars stood
  assert.ok(
    weakTrackFills(".si-bar-late { background: var(--kind-late-edge); }", [dark]).length === 1,
    "control: --kind-late-edge on the track (2.86:1) is caught",
  );
});

/* ---- C-9, C-10, C-3, C-4, C-6: the trigger underline and the groups ---- */

test("C-9: a label trigger's dotted underline is drawn in its full colour (the only cue it opens a note)", () => {
  const weak = (css: string): string[] =>
    rulesOf(css)
      .filter((r) => /\.note-label\b/.test(r.selector) && /text-decoration(?:-color)?\s*:[^;]*(?:color-mix|transparent|rgba)/.test(r.decls))
      .map((r) => r.selector);
  assert.deepEqual(weak(baseStylesheet()), []);
  assert.ok(
    rulesOf(baseStylesheet()).some((r) => r.selector === ".note-label" && /text-decoration-color\s*:\s*currentColor/.test(r.decls)),
    "the underline colour is currentColor",
  );
  assert.equal(weak(".note-label { text-decoration-color: color-mix(in oklab, currentColor 50%, transparent); }").length, 1, "control");
});

/* The group selector (M1 delta review, follow-up 2): its watch-list exclusion
   sits in `:where()`, so it weighs one class and a page's own placement of a
   group wins (it was (0,2,0) through `.chips:not(...)` inside `:is()`, which
   silently beat `.mgr-chips { margin }` and `.panel-head > .chips`). */
const GROUP = ':is(.seg, .chips, .mgr-chips):where(:not(.si-watch-chips, [id="watch-chips"]))';
test("C-3/C-10: the segmented group wraps at every width, and its items draw the focus ring inside themselves", () => {
  const rules = rulesOf(baseStylesheet());
  const group = rules.filter((r) => r.selector === GROUP);
  assert.equal(group.length, 1, "one group rule");
  assert.match(group[0]!.decls, /flex-wrap\s*:\s*wrap/);
  const nowrap = (rs: typeof rules): string[] =>
    rs.filter((r) => /(?:^|[\s,(])(?:\.seg|\.chips|\.mgr-chips)\b(?![\w-])(?![^,{]*[\s>]\S)/.test(r.selector) && /flex-wrap\s*:\s*nowrap/.test(r.decls)).map((r) => r.selector);
  assert.deepEqual(nowrap(rules), [], "no rule turns the group's wrap off");
  assert.equal(nowrap(rulesOf(".mgr-chips { flex-wrap: nowrap; }")).length, 1, "control: a nowrap group");
  const item = rules.find((r) => r.selector === `${GROUP} > :is(button, a)`);
  assert.ok(item && /outline-offset\s*:\s*-\d/.test(item.decls), "items offset the focus ring inward (the group hides its overflow)");
});

test("C-4: the two watch lists are not segmented groups — wrapping chips, each at least the hit square tall", () => {
  const rules = rulesOf(baseStylesheet());
  assert.ok(GROUP.includes(".si-watch-chips") && GROUP.includes('[id="watch-chips"]'), "both lists are excluded from the group");
  const list = rules.find((r) => r.selector === ':is(.si-watch-chips, [id="watch-chips"])');
  assert.ok(list && /display\s*:\s*flex/.test(list.decls) && /flex-wrap\s*:\s*wrap/.test(list.decls) && /gap\s*:/.test(list.decls), "a wrapping, spaced list");
  const chip = rules.find((r) => r.selector === ':is(.si-watch-chips, [id="watch-chips"]) > .chip');
  assert.ok(chip, "each chip is styled");
  assert.match(chip!.decls, /min-height\s*:\s*var\(--hit-min\)/);
  assert.match(chip!.decls, /padding\s*:/);
  // control: the pre-fix selector took #watch-chips into the group
  assert.ok(!':is(.seg, .chips:not(.si-watch-chips), .mgr-chips)'.includes('[id="watch-chips"]'), "control");
});

/** Selector specificity [ids, classes, types] for the forms the region uses:
    `:is()`/`:not()` take their heaviest argument, `:where()` weighs nothing. */
function specificity(sel: string): [number, number, number] {
  const add = (a: number[], b: number[]): number[] => a.map((x, i) => x + b[i]!);
  const max = (xs: number[][]): number[] => xs.reduce((m, x) => (x[0]! > m[0]! || (x[0] === m[0] && (x[1]! > m[1]! || (x[1] === m[1] && x[2]! > m[2]!))) ? x : m), [0, 0, 0]);
  const split = (inner: string): string[] => {
    const out: string[] = []; let depth = 0, cur = "";
    for (const ch of inner) { if (ch === "(") depth++; if (ch === ")") depth--; if (ch === "," && depth === 0) { out.push(cur); cur = ""; } else cur += ch; }
    return [...out, cur].map((x) => x.trim());
  };
  let total = [0, 0, 0];
  let i = 0;
  while (i < sel.length) {
    const m = /^:(is|not|where|has)\(/.exec(sel.slice(i));
    if (m) {
      let depth = 1, j = i + m[0].length;
      while (j < sel.length && depth > 0) { if (sel[j] === "(") depth++; if (sel[j] === ")") depth--; j++; }
      const inner = sel.slice(i + m[0].length, j - 1);
      if (m[1] !== "where") total = add(total, max(split(inner).map((x) => specificity(x) as number[])));
      i = j;
      continue;
    }
    const tok = /^(#[\w-]+|\.[\w-]+|\[[^\]]*\]|::?[\w-]+|[a-z][\w-]*|\*|[\s>+~]+)/i.exec(sel.slice(i));
    if (!tok) { i++; continue; }
    const t = tok[0];
    if (t.startsWith("#")) total = add(total, [1, 0, 0]);
    else if (t.startsWith(".") || t.startsWith("[") || (t.startsWith(":") && !t.startsWith("::"))) total = add(total, [0, 1, 0]);
    else if (/^[a-z]/i.test(t) || t.startsWith("::")) total = add(total, [0, 0, 1]);
    i += t.length;
  }
  return total as [number, number, number];
}

test("follow-up 2: the segmented group weighs one class, so a page's own group placement wins", () => {
  assert.deepEqual(specificity(GROUP), [0, 1, 0]);
  // control: the pre-fix selector weighed two classes and out-ranked `.mgr-chips { margin }`
  assert.deepEqual(specificity(':is(.seg, .chips:not(.si-watch-chips, [id="watch-chips"]), .mgr-chips)'), [0, 2, 0]);
  assert.deepEqual(specificity(".mgr-chips"), [0, 1, 0], "the late-additions spacing rule (later in the cascade) now wins");
  assert.deepEqual(specificity(".panel-head > :is(.seg, .chips, .mgr-chips, .ranking-options, .si-watch-controls, .head-controls)"), [0, 2, 0], "the band head's push-right out-ranks the group's margin");
  const rules = rulesOf(baseStylesheet());
  assert.ok(rules.some((r) => r.selector === ".mgr-chips" && /margin\s*:/.test(r.decls)), "the page's group spacing rule exists");
  // no other rule in the cascade re-heavies the group with the old exclusion form
  assert.deepEqual(rules.filter((r) => r.selector.includes(".chips:not(")).map((r) => r.selector), []);
});

/** Rules OUTSIDE the ledger region that lay out a `.chips` group itself. */
function strayGroupLayout(outside: string): string[] {
  return rulesOf(outside)
    .filter((r) => r.selector.split(",").some((s) => /\.chips\s*$/.test(s.trim())) && /(?:^|;)\s*(display|gap|row-gap|column-gap|flex-wrap)\s*:/.test(r.decls))
    .map((r) => r.selector);
}
test("C-6: only the ledger region lays out a segmented group (no `.control-row .chips` out-ranking it)", () => {
  const { outside } = splitRegion(baseStylesheet());
  assert.deepEqual(strayGroupLayout(outside), []);
  assert.deepEqual(strayGroupLayout(outside + "\n.control-row .chips { display: flex; gap: 6px; }"), [".control-row .chips"], "control: the C-6 rule");
});

/* ---- C-7: the rule book's cells take no ledger cell padding ---- */

test("C-7: every gutter, lead and slot padding rule on ledger cells skips the declared prose table", () => {
  const offenders = (css: string): string[] =>
    rulesOf(css)
      .filter((r) => /padding-(?:left|right)\s*:\s*(?:max\()?var\(--(?:gutter-[lr]|num-lead)|padding-right\s*:\s*(?:calc|max)\([^)]*--mark-slot/.test(r.decls))
      .filter((r) => /(?:table|\.etable)(?![\w-])/.test(r.selector) && !/:not\(\[data-multiline\]\)/.test(r.selector) && !/data-multiline/.test(r.selector))
      .map((r) => r.selector);
  assert.deepEqual(offenders(baseStylesheet()), []);
  assert.equal(
    offenders(".table-scroll > table > :is(thead, tbody, tfoot) > tr > :first-child { padding-left: var(--gutter-l); }").length,
    1,
    "control: the pre-fix gutter rule reaches the rule book's cells",
  );
});

/* ---- R-6: filed text never leaves its marker for a trigger's name ---- */

test("R-6: the holders lede keeps the issuer's filed name in its marker; its mark trigger is named in site words", async () => {
  const html = (await surfaces()).holdersBody!;
  const root = parse(html);
  const lede = [...walk(root)].find((e) => cls(e).has("entity-lede"))!;
  assert.ok(lede, "the holders lede renders");
  const filed = [...walk(lede)].find((e) => cls(e).has("filed-name"));
  assert.ok(filed && filed.textContent.trim().length > 0, "the issuer name sits in a filed-name span");
  const name = filed!.textContent.trim();
  const leaks = (h: string): string[] =>
    [...h.matchAll(/aria-label="([^"]*)"/g)].map((m) => m[1]!).filter((v) => v.includes(name));
  assert.deepEqual(leaks(html), [], "no aria-label carries the filed name");
  assert.equal(leaks(`<button aria-label="${name}, explain">†</button>`).length, 1, "control: the pre-fix trigger name");
});

/* ---- R-7: a label trigger's name holds its visible label at every width ---- */

/** The accessible name of a trigger: its aria-label, else its content with
    aria-hidden subtrees left out. */
function accessibleNameOf(el: MiniElement): string {
  const label = el.getAttribute("aria-label");
  if (label !== null) return label.replace(/\s+/g, " ").trim();
  const text = (n: MiniElement): string =>
    n.getAttribute("aria-hidden") === "true"
      ? ""
      : n.nodes.map((c) => (typeof c === "string" ? c.replace(/&nbsp;/g, " ").replace(/&amp;/g, "&") : text(c))).join("");
  return text(el).replace(/\s+/g, " ").trim();
}
/** What a sighted reader sees as the trigger's label: the full word above
    899px, the abbreviation (where there is one) at or below it. */
function visibleLabelsOf(el: MiniElement): string[] {
  const at = (narrow: boolean): string => {
    const text = (n: MiniElement): string =>
      n.nodes
        .map((c) => {
          if (typeof c === "string") return c.replace(/&nbsp;/g, " ").replace(/&amp;/g, "&");
          const k = cls(c);
          if (k.has("visually-hidden") || k.has("note-pop") || (narrow ? k.has("th-full") : k.has("th-abbr"))) return "";
          return text(c);
        })
        .join("");
    return text(el).replace(/\s+/g, " ").trim();
  };
  return [...new Set([at(false), at(true)])].filter((t) => /[\p{L}\p{N}]/u.test(t));
}
function labelNotInName(html: string): string[] {
  return [...walk(parse(html))]
    .filter((e) => cls(e).has("note-label"))
    .flatMap((b) => {
      const name = accessibleNameOf(b);
      return visibleLabelsOf(b)
        .filter((v) => !name.includes(v.replace(/ ·?[§†‡¶≈]$/, "").trim()))
        .map((v) => `"${v}" is not in the name "${name}"`);
    });
}

test("R-7: a label trigger over an abbreviated header names its visible label at both widths (WCAG 2.5.3)", async () => {
  for (const label of ["Amount range", "Source", "Position change", "Gross bought"]) {
    const html = noteFromHtml("why", { scope: "t" }, label, { trigger: "label", textHtml: thLabelHtml(label), name: label });
    assert.deepEqual(labelNotInName(html), [], label);
    assert.ok(!/aria-label=/.test(html.split('<span class="note-pop"')[0]!), `${label}: named by content, not an attribute`);
  }
  for (const [name, html] of Object.entries(await surfaces())) assert.deepEqual(labelNotInName(html), [], name);
  // control: the pre-fix trigger — aria-label the full word, abbreviation aria-hidden
  const pre =
    `<button class="note-btn note-label" aria-label="Gross bought, explain"><span class="th-full">Gross bought</span>` +
    `<span class="th-abbr" aria-hidden="true">Gross purch</span></button>`;
  assert.deepEqual(labelNotInName(pre), [`"Gross purch" is not in the name "Gross bought, explain"`], "control");
});

/* ---- the coordinator's ruling on D7: each feed flag chip opens its own
        definition, and every definition is copy the site already publishes ---- */

const FEED_ROW = {
  kind: "txn", txnId: "t9", asset: "Widget Co", assetType: null, filed: "2026-07-21", traded: "2026-06-24",
  name: "Fixture Member", bioguide: "T000001", party: "R", state: "OK", district: null, chamber: "senate",
  ticker: null, side: "purchase", owner: "joint", low: null, high: null, lag: 27, late: 0,
  flags: ["amendment_unresolved", "missing_ticker", "amount_spouse_cap", "date_anomaly", "row_orphan"],
  doc: "https://efdsearch.senate.gov/x", filingKey: "f1",
} as never;

/** Each visible chip in a reference row: its word, the id of the note it
    opens (or null), and that note's text. */
function chipNotes(html: string): { word: string; id: string | null; text: string | null }[] {
  const root = parse(html);
  return [...walk(root)]
    .filter((e) => cls(e).has("flag") && !e.closest(".note-pop"))
    .map((chip) => {
      const btn = [...walk(chip)].find((e) => cls(e).has("note-label"));
      const id = btn?.getAttribute("popovertarget") ?? null;
      const pop = id ? [...walk(root)].find((e) => e.getAttribute("id") === id) : undefined;
      return { word: (btn ?? chip).textContent.replace(/\s+/g, " ").trim(), id, text: pop ? pop.textContent.trim() : null };
    });
}

test("D7 ruling: every flag chip in a reference feed row opens its OWN definition", () => {
  const row = txnRowHtml(FEED_ROW, { referenceFeed: true, watched: new Set<string>() });
  const chips = chipNotes(row);
  assert.equal(chips.length, 6, "five flags plus the derived 'amount unparsed' chip");
  for (const c of chips) {
    assert.ok(c.id, `"${c.word}" opens a note`);
    assert.ok(c.text && c.text.length > 0, `"${c.word}" has a definition`);
  }
  assert.equal(new Set(chips.map((c) => c.id)).size, chips.length, "each chip opens its own panel");
  const byWord = new Map(chips.map((c) => [c.word, c.text]));
  assert.equal(byWord.get("no ticker"), TICKER_ABSENT_NOTE);
  assert.equal(byWord.get("spouse cap"), SPOUSE_CAP_NOTE);
  assert.equal(byWord.get("amount unparsed"), AMOUNT_UNPARSED_SPOKEN);
  assert.equal(byWord.get("amendment pending"), AMENDMENT_PENDING_NOTE);
  assert.equal(byWord.get("date anomaly"), DATE_ANOMALY_NOTE);
  /* DESIGN-POLISH M3 (carried F2): a defect flag now opens its OWN one-sentence
     definition, derived from the producer code that sets it, ending with the
     methodology's published defect line — no longer the shared line alone. */
  assert.match(byWord.get("row orphan") ?? "", /^On a House report, text that completed no row above it is kept as a row of its own rather than dropped; /);
  assert.ok((byWord.get("row orphan") ?? "").endsWith(`${DEFECT_FLAG_NOTE}.`));
  // every congress flag the feed can carry has a definition
  const congressFlags = ["amendment_unresolved", "missing_ticker", "amount_spouse_cap", "amount_unparsed", "date_missing",
    "date_anomaly", "side_unparsed", "asset_unparsed", "capgains_unparsed", "row_incomplete", "row_orphan", "owner_unparsed",
    "declared_total_mismatch", "declared_total_verified"];
  assert.deepEqual(flagChips(congressFlags).filter((c) => !FEED_FLAG_DEFINITIONS[c.key]).map((c) => c.key), []);
  // control: a chip with no trigger is caught
  assert.equal(chipNotes(`<span class="flag solid">no ticker</span>`)[0]!.id, null, "control");
});

/** Each definition must be published text the site already carries: the
    methodology page's own sentence, or the string at the one site that
    rendered it before the chips existed (now read from the same constant). */
function unpublishedDefinitions(defs: Readonly<Record<string, string>>): string[] {
  let methodology = readFileSync(path.join(SRC, "pages", "methodology", "index.astro"), "utf-8");
  for (let prev = ""; prev !== methodology; ) {
    prev = methodology;
    methodology = methodology.replace(/<[^>]+>/g, "");
  }
  methodology = methodology.replace(/\s+/g, " ");
  const format = readFileSync(path.join(SRC, "lib", "format.ts"), "latin1");
  const sites: Record<string, RegExp> = {
    [TICKER_ABSENT_NOTE]: /label: "Ticker", why: TICKER_ABSENT_NOTE/,
    [SPOUSE_CAP_NOTE]: /note\(SPOUSE_CAP_NOTE, \{ scope: "txn" \}/,
    [AMOUNT_UNPARSED_SPOKEN]: /amountUnknown \? AMOUNT_UNPARSED_SPOKEN/,
  };
  const congress = readFileSync(path.join(SRC, "lib", "ui", "congress.ts"), "utf-8");
  const out: string[] = [];
  for (const [flag, text] of Object.entries(defs)) {
    const published =
      methodology.includes(text) ||
      (sites[text] !== undefined && sites[text]!.test(format)) ||
      (text === DATE_ANOMALY_NOTE && congress.includes("rows excluded (${DATE_ANOMALY_NOTE})"));
    if (!published) out.push(`${flag}: "${text}"`);
  }
  return out;
}

/* The original seven defect definitions (DESIGN-POLISH M3) plus the declared
   total mismatch requested in audit Phase 2 F2: new copy is allowed ONLY where
   the sentence follows the producer code that sets the flag, with a citation. */
const DEFECT_FLAGS = ["date_missing", "side_unparsed", "asset_unparsed", "capgains_unparsed", "row_incomplete", "row_orphan", "owner_unparsed", "declared_total_mismatch"] as const;
/* Phase 2 F2 explicitly requests a definition for this source fact too; its
   producer citation and distinction from a defect are checked below. */
const NEW_SOURCE_FACT_FLAGS = ["declared_total_verified"] as const;

/** The producer file and line range `format.ts` cites for `flag`, or null. */
function citationOf(flag: string, format: string): { file: string; from: number; to: number } | null {
  const m = new RegExp(`- ${flag}: ((?:parse/|ingest/)?[a-z_]+\\.py):(\\d+)(?:-(\\d+))?`).exec(format);
  return m ? { file: m[1]!, from: Number(m[2]), to: Number(m[3] ?? m[2]) } : null;
}

test("D7 ruling: every flag definition is copy the site already publishes — no new wording", () => {
  /* Unchanged outside the explicitly authorized, source-cited definitions. */
  const newCopy: readonly string[] = [...DEFECT_FLAGS, ...NEW_SOURCE_FACT_FLAGS];
  const published = Object.fromEntries(Object.entries(FEED_FLAG_DEFINITIONS).filter(([k]) => !newCopy.includes(k)));
  assert.deepEqual(unpublishedDefinitions(published), []);
  assert.equal(
    unpublishedDefinitions({ missing_ticker: "a row whose filing could not be joined" }).length,
    1,
    "control: a newly written definition for a non-defect flag is caught",
  );
});

test("F2 (M3): each defect flag's definition is its own sentence, cites the producer line that sets the flag, and keeps the published defect line", () => {
  const format = readFileSync(path.join(SRC, "lib", "format.ts"), "utf-8");
  const repo = path.resolve(SRC, "..", "..");
  const texts = DEFECT_FLAGS.map((f) => FEED_FLAG_DEFINITIONS[f] ?? "");
  assert.equal(new Set(texts).size, DEFECT_FLAGS.length, "different definitions — none shares a line");
  for (const flag of DEFECT_FLAGS) {
    const text = FEED_FLAG_DEFINITIONS[flag]!;
    assert.notEqual(text, DEFECT_FLAG_NOTE, `${flag}: its own definition, not the shared line`);
    assert.ok(text.endsWith(`; ${DEFECT_FLAG_NOTE}.`), `${flag}: ends with the methodology's published defect line`);
    assert.equal(text.split(/[.;] (?=[A-Z])/).length, 1, `${flag}: one sentence`);
    /* the citation is VERIFIED, not trusted: the cited producer lines must
       contain the flag's own name */
    const cite = citationOf(flag, format);
    assert.ok(cite, `${flag}: format.ts cites the producer line that sets it`);
    const lines = readFileSync(path.join(repo, "src", "populus", cite!.file), "utf-8").split("\n").slice(cite!.from - 1, cite!.to);
    assert.ok(lines.some((l) => l.includes(flag)), `${flag}: ${cite!.file}:${cite!.from}-${cite!.to} does not mention the flag`);
  }
  // control: a citation to lines that never set the flag is caught
  const wrong = citationOf("side_unparsed", format.replace(/- side_unparsed: normalize\.py:96-102/, "- side_unparsed: normalize.py:1-5"));
  const wrongLines = readFileSync(path.join(repo, "src", "populus", wrong!.file), "utf-8").split("\n").slice(wrong!.from - 1, wrong!.to);
  assert.ok(!wrongLines.some((l) => l.includes("side_unparsed")), "control: a wrong citation fails the check");
});

/** Read the actual normalizer taxonomy, rather than maintain another Congress
    flag list in the dashboard. This parity check is scoped to Phase 2 F2. */
function producerFlagSet(source: string, name: string): Set<string> {
  const block = new RegExp(`\\b${name} = frozenset\\(\\s*\\{([\\s\\S]*?)\\}\\s*\\)`).exec(source);
  assert.ok(block, `${name}: the producer set was read`);
  return new Set([...block[1]!.matchAll(/"([a-z][a-z0-9_]*)"/g)].map((m) => m[1]!));
}

test("audit F2: declared-total flag presentation agrees with the normalizer's defect/source-fact vocabulary", () => {
  const repo = path.resolve(SRC, "..", "..");
  const source = readFileSync(path.join(repo, "src", "populus", "normalize.py"), "utf-8");
  const defects = producerFlagSet(source, "PARSE_DEFECT_FLAGS");
  const facts = producerFlagSet(source, "SOURCE_FACT_FLAGS");
  assert.ok(defects.has("declared_total_mismatch") && !facts.has("declared_total_mismatch"));
  assert.ok(facts.has("declared_total_verified") && !defects.has("declared_total_verified"));
  assert.deepEqual(flagChips(["declared_total_mismatch", "declared_total_verified"]), [
    { key: "declared_total_mismatch", label: "filing total mismatch", cls: "dashed" },
    { key: "declared_total_verified", label: "filing total verified", cls: "solid" },
  ]);
  for (const flag of ["declared_total_mismatch", "declared_total_verified"]) assert.ok(FEED_FLAG_DEFINITIONS[flag]);
  // Control: deleting a producer vocabulary member is observable by this read.
  const missing = source.replace('"declared_total_mismatch",', "");
  assert.ok(!producerFlagSet(missing, "PARSE_DEFECT_FLAGS").has("declared_total_mismatch"));
});

test("audit F2: declared-total chips open their own definitions and verified totals carry no defect warning", () => {
  const format = readFileSync(path.join(SRC, "lib", "format.ts"), "utf-8");
  const repo = path.resolve(SRC, "..", "..");
  for (const [flag, label, style] of [
    ["declared_total_mismatch", "filing total mismatch", "dashed"],
    ["declared_total_verified", "filing total verified", "solid"],
  ] as const) {
    const row = txnRowHtml({ ...FEED_ROW, flags: [flag], low: 1001, high: 15000 } as never,
      { referenceFeed: true, watched: new Set<string>() });
    const chips = chipNotes(row);
    assert.equal(chips.length, 1, `${flag}: one visible chip`);
    assert.equal(chips[0]!.word, label);
    assert.ok(chips[0]!.id, `${flag}: the visible label opens its definition`);
    assert.equal(chips[0]!.text, FEED_FLAG_DEFINITIONS[flag]);
    assert.ok([...walk(parse(row))].some((e) => cls(e).has("flag") && cls(e).has(style)), `${flag}: ${style} presentation`);
    assert.ok(!row.includes(UNKNOWN_FLAG_LABEL), `${flag}: no generic unknown warning`);
    const cite = citationOf(flag, format);
    assert.ok(cite, `${flag}: the new definition cites its producer`);
    const lines = readFileSync(path.join(repo, "src", "populus", cite!.file), "utf-8")
      .split("\n").slice(cite!.from - 1, cite!.to);
    assert.ok(lines.some((line) => line.includes(flag)), `${flag}: the citation names the flag`);
  }
  assert.match(FEED_FLAG_DEFINITIONS.declared_total_mismatch!, /printed transaction total differs from the number of extracted rows/);
  assert.ok(FEED_FLAG_DEFINITIONS.declared_total_mismatch!.endsWith(`; ${DEFECT_FLAG_NOTE}.`));
  assert.match(FEED_FLAG_DEFINITIONS.declared_total_verified!, /printed transaction total matches the number of extracted rows/);
  assert.match(FEED_FLAG_DEFINITIONS.declared_total_verified!, /cell defects remain flagged/);
  assert.ok(!FEED_FLAG_DEFINITIONS.declared_total_verified!.includes(DEFECT_FLAG_NOTE));
});

/* ---- C-13: the ledger region styles only what the renderers emit ---- */

/** Classes the ledger region's selectors name that no source file emits —
    literally, or through a `prefix-${…}` template (`si-fill-${family}`). */
function deadRegionClasses(region: string, source: string): string[] {
  const classes = [...new Set([...stripComments(region).matchAll(/\.([a-z][a-z0-9-]+)/g)].map((m) => m[1]!))];
  const templated = [...source.matchAll(/([a-z][a-z0-9-]*-)\$\{/g)].map((m) => m[1]!);
  return classes.filter(
    (c) => !new RegExp(`(?<![\\w-])${c}(?![\\w-])`).test(source) && !templated.some((p) => c.startsWith(p)),
  );
}
test("C-13: every class the ledger region styles is emitted by a renderer (no dead rules)", () => {
  const { region } = splitRegion(baseStylesheet());
  const source = sourceFilesAll().map((f) => readFileSync(f, "latin1")).join("\n");
  assert.deepEqual(deadRegionClasses(region, source), []);
  assert.deepEqual(
    deadRegionClasses(".design-holding-provenance { display: block; }", source),
    ["design-holding-provenance"],
    "control: the rule C-13 found is caught",
  );
});

function sourceFilesAll(): string[] {
  const out: string[] = [];
  const walkDir = (d: string): void => {
    for (const n of readdirSync(d)) {
      const p = path.join(d, n);
      if (statSync(p).isDirectory()) walkDir(p);
      else if (/\.(ts|astro)$/.test(n)) out.push(p);
    }
  };
  walkDir(SRC);
  return out;
}

/* DESIGN-POLISH M2 review C2-7 / C2-8. The property: a stylesheet rule says
   something no other rule already says — no declaration is repeated for the
   same selector in the same media context (a copy that drifts apart from its
   twin is how one of them silently becomes dead), and no rule styles a class
   no renderer emits. And the stacked summary cards at the fold are separated
   by the page rule, not the 1.1:1 column divider. */
/** Every (media context, selector, property, value) declared more than once in `css`. */
function repeatedDeclarations(css: string): string[] {
  const src = stripComments(css);
  const stack: string[] = [];
  const seen = new Map<string, number>();
  let i = 0;
  while (i < src.length) {
    const open = src.indexOf("{", i), close = src.indexOf("}", i);
    if (close < 0) break;
    if (open >= 0 && open < close) {
      const prelude = src.slice(i, open).trim();
      const next = src.indexOf("{", open + 1), end = src.indexOf("}", open + 1);
      if (prelude.startsWith("@") && next >= 0 && next < end) {
        stack.push(prelude.replace(/\s+/g, " "));
        i = open + 1;
        continue;
      }
      const decls = src.slice(open + 1, end);
      if (!prelude.startsWith("@")) {
        for (const sel of prelude.split(/,(?![^(]*\))/).map((s) => s.trim().replace(/\s+/g, " ")).filter(Boolean)) {
          for (const d of decls.split(";").map((x) => x.trim().replace(/\s+/g, " ")).filter(Boolean)) {
            const key = `${stack.join(" / ") || "(top)"} | ${sel} | ${d}`;
            seen.set(key, (seen.get(key) ?? 0) + 1);
          }
        }
      }
      i = end + 1;
    } else {
      stack.pop();
      i = close + 1;
    }
  }
  return [...seen].filter(([, n]) => n > 1).map(([k]) => k);
}

test("C2-7: late-additions.css repeats no declaration for the same selector in the same context, and styles no class no renderer emits", () => {
  const late = readFileSync(path.join(STYLES, "late-additions.css"), "utf-8");
  assert.deepEqual(repeatedDeclarations(late), []);
  // controls: the deleted duplicates, re-planted, are each caught
  assert.ok(repeatedDeclarations(late + "\n@media print {\n .design-supplement::details-content { content-visibility:visible; display:block; }\n}").length > 0, "control: the duplicate print block");
  assert.ok(repeatedDeclarations(late + "\n@media (max-width: 720px) {\n  .site-search { width: 100%; }\n}").length > 0, "control: the duplicate fold search width");
  assert.ok(repeatedDeclarations(late + "\n.design-institutional-band { grid-template-columns:minmax(0,1.3fr) minmax(0,1fr); }").length > 0, "control: the duplicate I1 grid");
  // no rule for a design class that no renderer or page emits (the retired reconciliation panel)
  const emitted = (cls: string): boolean => {
    const walk = (dir: string): boolean =>
      readdirSync(dir).some((f) => {
        const p = path.join(dir, f);
        if (statSync(p).isDirectory()) return f !== "styles" && walk(p);
        return /\.(ts|astro)$/.test(f) && readFileSync(p, "latin1").includes(cls);
      });
    return walk(SRC);
  };
  const designClasses = [...new Set([...stripComments(late).matchAll(/\.(design-[a-z0-9-]+)/g)].map((m) => m[1]!))];
  assert.ok(designClasses.length > 10, "the sweep reads the design classes");
  assert.deepEqual(designClasses.filter((c) => !emitted(c)), [], "every styled design class is emitted");
  assert.equal(emitted("design-reconciliation"), false, "control: the retired class is emitted nowhere, so a rule for it would be caught");
});

test("C2-8: at the fold, stacked summary cards are separated by the page rule, never the 1.1:1 column divider", () => {
  const late = stripComments(readFileSync(path.join(STYLES, "late-additions.css"), "utf-8"));
  const fold = [...late.matchAll(/@media \(max-width: 720px\) \{([\s\S]*?)\n\}/g)].map((m) => m[1]!).join("\n");
  const seam = rulesOf(fold).find((r) => r.selector === ".design-story + .design-story");
  assert.ok(seam, "the fold states the stacked seam");
  assert.match(seam!.decls, /border-top: 1px solid var\(--rule\)/);
  assert.doesNotMatch(seam!.decls, /--story-divider/, "the divider token is for side-by-side cards only");
  // control: the pre-fix seam is caught by the same reading
  const pre = rulesOf(".design-story + .design-story { border-left: 0; border-top: 1px solid var(--story-divider); }")[0]!;
  assert.match(pre.decls, /--story-divider/);
});
