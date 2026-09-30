/* SIGNALS-CLARITY M1 — the minimal footer (PLAN.md R1–R4, T1, T2).

   The footer is one row (brand, three links, the theme toggle) plus one notice
   sentence. Everything the former five-block footer carried moved to
   /methodology, and this file proves both halves: that the footer no longer
   carries each moved item, and that /methodology does. The rendered pages are
   checked again after the build (test/post/http-status.test.ts: one
   `.footer-notice` per page, the 13F sentence on the 13F pages) and in the
   browser (test/geometry/layout.spec.ts: height and one line). The decision
   record is docs/design/SIGNALS-CLARITY-DECISIONS.md. */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, globSync } from "node:fs";
import path from "node:path";

const SRC = path.resolve(import.meta.dirname, "..", "src");
const base = readFileSync(path.join(SRC, "layouts", "Base.astro"), "utf-8");
const methodology = readFileSync(path.join(SRC, "pages", "methodology", "index.astro"), "utf-8");

/** Astro/JSX comments are not rendered; strip them before asserting on markup. */
const uncommented = (s: string): string => s.replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
const flat = (s: string): string => s.replace(/\s+/g, " ");

const footer = uncommented(base.slice(base.indexOf('<footer class="site-footer">'), base.indexOf("</footer>")));

/** The sentences exactly as the plan fixes them (R2, R3). */
const STANDARD =
  "Not financial advice. Use of congressional disclosure reports for commercial purposes, " +
  "credit decisions or solicitation is restricted by 5 U.S.C. §13107(c).";
const INST13F =
  "13F: quarter-end long positions in Section 13(f) securities only, filed up to 45 days late; " +
  "managers under $100M do not file. Not current holdings, not a census, not financial advice.";

/** Base.astro's FOOTER_NOTICE object, evaluated from its own source, so the test
    reads what the layout renders rather than a copy of it. */
function footerNotice(): Record<"standard" | "inst13f", string> {
  const m = /const FOOTER_NOTICE = (\{[\s\S]*?\}) as const;/.exec(base);
  assert.ok(m, "Base.astro declares FOOTER_NOTICE");
  return new Function(`return (${m[1]});`)() as Record<"standard" | "inst13f", string>;
}

/** The three pages that pass footer="inst13f" (PLAN.md Current State). */
const INST13F_PAGES = [
  "pages/institutional/index.astro",
  "pages/institutional/filers/[cik].astro",
  "pages/institutional/tickers/[t]/holders.astro",
];

/** The footer variant a page's source passes to Base (default "standard"). */
function variantOf(rel: string): "standard" | "inst13f" {
  const src = readFileSync(path.join(SRC, rel), "utf-8");
  const m = /\bfooter="([^"]+)"/.exec(src);
  if (!m) return "standard";
  assert.ok(m[1] === "standard" || m[1] === "inst13f", `${rel} passes an unknown footer variant ${m[1]}`);
  return m[1];
}

/* ---------------- R1: one row ---------------- */

test("R1: the footer row is the brand, three links to /methodology, and the theme toggle", () => {
  const row = /<div class="footer-row">([\s\S]*?)<\/div>/.exec(footer);
  assert.ok(row, "the footer has one .footer-row");
  const r = row[1]!;
  assert.match(r, /<span class="footer-brand">Public Filings<\/span>/);
  const links = [...r.matchAll(/<a href="([^"]+)"[^>]*>([^<]+)<\/a>/g)].map((m) => [m[1], m[2]]);
  assert.deepEqual(links, [
    ["/methodology/", "Methodology"],
    ["/methodology/#sources", "Sources &amp; licenses"],
    ["/methodology/#notices", "Legal"],
  ]);
  assert.match(r, /<button class="theme-toggle"[^>]*>/, "the existing theme toggle stays in the row");
  // The toggle's script binds `.theme-toggle` and must still find exactly one.
  assert.equal((base.match(/class="theme-toggle"/g) ?? []).length, 1, "one theme toggle in the layout");
  assert.ok(base.includes('document.querySelector<HTMLButtonElement>(".theme-toggle")'), "the toggle is still bound");
  assert.equal((footer.match(/<a /g) ?? []).length, 3, "no other link in the footer");
});

test("R1: every footer link target exists on /methodology, exactly once", () => {
  for (const id of ["sources", "notices"]) {
    assert.equal((methodology.match(new RegExp(`id="${id}"`, "g")) ?? []).length, 1, `/methodology has one id="${id}"`);
  }
});

/* ---------------- R2 / R3: one notice sentence per variant ---------------- */

test("R2/R3: the footer renders exactly one .footer-notice, and it is the variant's sentence", () => {
  assert.equal((footer.match(/class="footer-notice"/g) ?? []).length, 1);
  assert.match(footer, /<p class="footer-notice">\{FOOTER_NOTICE\[footer\]\}<\/p>/);
  const notice = footerNotice();
  assert.deepEqual(Object.keys(notice).sort(), ["inst13f", "standard"], "one sentence per footer variant");
  assert.equal(notice.standard, STANDARD);
  assert.equal(notice.inst13f, INST13F);
});

test("R2: the standard sentence names the same prohibited uses as the former paragraph", () => {
  const s = footerNotice().standard;
  for (const clause of ["Not financial advice", "commercial purposes", "credit", "solicitation", "5 U.S.C. §13107(c)"]) {
    assert.ok(s.includes(clause), `standard notice is missing "${clause}"`);
  }
});

test("R3: every clause of the 13F caveat is on each of the three inst13f pages", () => {
  const notice = footerNotice();
  const clauses = [
    "quarter-end",
    "long positions",
    "Section 13(f) securities only",
    "up to 45 days late",
    "managers under $100M do not file",
    "Not current holdings",
    "not a census",
    "not financial advice",
  ];
  for (const rel of INST13F_PAGES) {
    const rendered = notice[variantOf(rel)];
    for (const clause of clauses) assert.ok(rendered.includes(clause), `${rel}: the footer notice is missing "${clause}"`);
  }
  // Control: the standard sentence carries none of the 13F-only clauses, so the
  // loop above cannot pass on the wrong variant.
  assert.ok(!notice.standard.includes("not a census"));
});

test("R3: exactly the three 13F pages use the inst13f footer; every other page is standard", () => {
  const withVariant = globSync("pages/**/*.astro", { cwd: SRC })
    .filter((rel) => variantOf(rel) === "inst13f")
    .sort();
  assert.deepEqual(withVariant, [...INST13F_PAGES].sort());
});

/* ---------------- R4: moved items — gone from the footer, present on /methodology ---------------- */

test("R4: the moved items are gone from the footer", () => {
  const f = flat(footer);
  const gone: [string, RegExp][] = [
    ["the prohibited-uses paragraph", /Prohibited uses\.|republishes/],
    ["the 13F caveat paragraph", /13F caveat\./],
    ["the source list", /Sources\.|House Clerk|Senate eFD|EDGAR|congress-legislators|kadoa/],
    ["the DATA-LICENSE / NOTICE links", /DATA-LICENSE|NOTICE\.txt|\/legal\//],
    ["the Financials / Macro SOON links", /\/financials\/|\/macro\/|SOON|nav-shell|badge-soon/],
    ["the build / code text", /\bbuild\b|\bcode\b|footer-build/],
    ["the no-cookies line", /cookie|no account required|cross-site/i],
  ];
  for (const [what, re] of gone) assert.ok(!re.test(f), `${what} is still in the footer`);
});

/** The markup from an element carrying `id="<id>"` to the end of its enclosing
    grid cell — enough to prove an item sits in that section, not merely on the page. */
function section(id: string): string {
  const at = methodology.indexOf(`id="${id}"`);
  assert.ok(at >= 0, `/methodology has id="${id}"`);
  const end = methodology.indexOf("\n        </div>", at);
  return flat(uncommented(methodology.slice(at, end)));
}

test("R4: every moved item has its home on /methodology", () => {
  const sources = section("sources");
  for (const source of ["House Clerk", "Senate eFD", "SEC EDGAR", "congress-legislators", "cc0", "kadoa", "MIT"]) {
    assert.ok(sources.includes(source), `the #sources list is missing ${source}`);
  }
  const notices = section("notices");
  for (const clause of ["13107(c)", "commercial purposes", "determining credit", "solicitation", "Not financial advice"]) {
    assert.ok(notices.includes(clause), `the #notices text is missing "${clause}"`);
  }
  assert.ok(notices.includes('<a href="/legal/DATA-LICENSE.md">DATA-LICENSE'), "#notices links DATA-LICENSE");
  assert.ok(notices.includes('<a href="/legal/NOTICE.txt">NOTICE'), "#notices links NOTICE");
  const page = flat(uncommented(methodology));
  assert.ok(page.includes("No cookies, no account required"), "the no-cookies line is on /methodology");
  assert.ok(flat(section("privacy")).includes("sets no cookie"), "the privacy section states no cookie");
  assert.ok(page.includes("cross-site identifier"), "the no-cross-site-tracking claim is on /methodology");
  assert.equal(
    (page.match(/build \{build\.buildId\} · code \{build\.codeSha\.slice\(0, 7\)\}/g) ?? []).length,
    1,
    "the build watermark is on /methodology exactly once",
  );
});

test("R4 control: the section reader sees only its own section", () => {
  // `#sources` ends before the known-gaps column; a reader that ran to the end
  // of the page would find the notices' words there and pass vacuously.
  assert.ok(!section("sources").includes("Required notices"), "#sources does not run into the notices");
  assert.ok(!section("notices").includes("House Clerk — PTR"), "#notices does not run back into the sources");
});
