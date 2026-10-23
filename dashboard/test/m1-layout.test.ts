/* M1 layout defects (plan R4, R5) — the CSS and markup halves.

   The geometry itself is asserted by the R35 Playwright harness against a real
   `dist` at five widths, because a rule that exists is not the same claim as a
   box that does not intersect. What lives HERE is the part a browser cannot
   tell you: that the rule is still in the stylesheet at all, and that the
   accessible name still carries what the pixels drop. Both defects were
   originally invisible to every markup test in the suite. */

import { test } from "node:test";
import assert from "node:assert/strict";
import { baseStylesheet } from "./lib/styles.ts";
import { readFileSync } from "node:fs";
import path from "node:path";

import { assetNameCell, txnRowHtml } from "../src/lib/format.ts";
import { changesTableHtml } from "../src/lib/ui/index.ts";
import { MiniElement } from "./lib/mini-dom.ts";

const DASH = path.resolve(import.meta.dirname, "..");
/* `grep -a` discipline, in Node form: read as bytes-to-text and never assume
   the file is clean UTF-8 text (derive.ts carries a deliberate NUL). */
const css = baseStylesheet();
const base = readFileSync(path.join(DASH, "src", "layouts", "Base.astro"), "utf-8");

/* ---------------- R4: the masthead ---------------- */

/** The body of the `@media` block whose text matches `needle`, by brace
    matching — NOT a slice to end-of-file.

    A slice cannot express "these two rules live in the SAME breakpoint", which
    is the only thing that makes the dual-date invariant hold: one block must
    both hide the desktop date and reveal the combined one. Split them across
    two blocks and the dates double up in the gap between them. */
function mediaBlockContaining(source: string, needle: RegExp): string | null {
  const re = /@media[^{]*\{/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    let depth = 1;
    let i = m.index + m[0].length;
    const start = i;
    while (i < source.length && depth > 0) {
      const ch = source[i];
      if (ch === "{") depth++;
      else if (ch === "}") depth--;
      i++;
    }
    const body = source.slice(start, i - 1);
    if (needle.test(body)) return body;
  }
  return null;
}

test("R4: the build watermark is rendered once site-wide, on /methodology — never the masthead or the footer", () => {
  /* The property this pins has not changed since the original R4: a reader sees
     the build identity in exactly ONE place, and deploy verification reads the
     <meta> markers, never visible text. `Base.astro` once printed the id twice
     (`.masthead-meta` and `.footer-build`); R4 deleted the masthead copy. The
     SIGNALS-CLARITY M1 reversal (docs/design/SIGNALS-CLARITY-DECISIONS.md)
     moved the one remaining copy from the footer to /methodology as
     `build <id> · code <sha7>`. Sharper than before: the layout may reference
     the build only inside the two <meta> markers, so neither the masthead nor
     the footer can print it again under any spelling. */
  assert.ok(
    !base.includes("masthead-meta"),
    "the masthead watermark is back — /methodology prints the identifiers",
  );
  assert.ok(
    !css.includes(".masthead-meta"),
    "the .masthead-meta rule outlived its markup — dead CSS reads as accounted-for",
  );
  const refs = [...base.matchAll(/[^\n]*\bbuild\.(buildId|codeSha)\b[^\n]*/g)].map((m) => m[0]!.trim());
  assert.deepEqual(
    refs,
    [
      '<meta name="populus:build_id" content={build.buildId} />',
      '<meta name="populus:code_sha" content={build.codeSha} />',
    ],
    "Base.astro may read the build only into the two <meta> markers (deploy verification parses them, unchanged)",
  );
  const footer = base.slice(base.indexOf("<footer"), base.indexOf("</footer>"));
  assert.ok(footer.length > 0, "the footer was found");
  assert.ok(!/\bbuild\b|\bcode\b/i.test(footer.replace(/\{\/\*[\s\S]*?\*\/\}/g, "")), "the footer prints no build or code text");

  const methodology = readFileSync(path.join(DASH, "src", "pages", "methodology", "index.astro"), "utf-8");
  const stamps = methodology.match(/build \{build\.buildId\} · code \{build\.codeSha\.slice\(0, 7\)\}/g) ?? [];
  assert.equal(stamps.length, 1, `/methodology prints the watermark ${stamps.length} times; exactly once`);
  assert.equal((methodology.match(/build\.codeSha/g) ?? []).length, 1, "the code sha appears on /methodology only in the watermark");
});

test("R4: the masthead has an intermediate breakpoint between the fold and desktop", () => {
  /* The masthead had exactly two states — the desktop bar and the 720px burger
     fold — and nothing between them. The shell offers 1000px of usable width at
     a 1080px viewport against a cluster needing ~1028px, so nav, search and
     brand collided across the entire 721-1080px band. */
  assert.match(
    css,
    /@media \(min-width: 721px\) and \(max-width: 1080px\)/,
    "the 721-1080px masthead band is gone; that is the collision band",
  );
});

test("R4: the masthead reflows instead of overlapping, at any width", () => {
  /* A breakpoint fixes the widths someone thought to test. `flex-wrap` fixes
     the rest: a cluster wider than its shell reflows rather than painting over
     its neighbour. The fixed `height` had to go with it, or wrapped content
     just overflows a 60px box instead. */
  const inner = /\.masthead-inner \{([^}]*)\}/.exec(css);
  assert.ok(inner, ".masthead-inner rule exists");
  assert.match(inner![1]!, /flex-wrap:\s*wrap/, ".masthead-inner must be able to wrap");
  assert.match(inner![1]!, /min-height:\s*60px/, "a fixed height re-creates the overflow");
  assert.ok(
    !/\.masthead-inner \{[^}]*[^-]height:\s*60px/.test(css),
    ".masthead-inner must not pin a fixed height",
  );
  const left = /\.masthead-left \{([^}]*)\}/.exec(css);
  assert.ok(left, ".masthead-left rule exists");
  assert.match(left![1]!, /flex-wrap:\s*wrap/, "brand and nav must reflow, not intersect");
});

/* ---------------- R5: the feed cells ---------------- */

test("R5: the ticker cell is geometrically contained", () => {
  /* `.cell-ticker` is a fixed grid column. In the classic feed it rendered a
     full asset name whenever no ticker was disclosed — ~300px of 12.5px mono
     for a 40-char name, painted straight over `.cell-side`. That feed was
     removed in signals-v3 M1; the one feed left keeps the column to the ticker
     (an em dash when none was disclosed) and still contains whatever lands in
     it, exactly as `.cell-member` is contained. */
  const rule = /\.reference-feed \.cell-ticker \{([^}]*)\}/.exec(css);
  assert.ok(rule, "the feed's .cell-ticker rule exists");
  assert.match(rule![1]!, /overflow:\s*(?:hidden|clip)/, ".cell-ticker must clip");
  assert.match(rule![1]!, /text-overflow:\s*ellipsis/, ".cell-ticker must mark the clip");
  assert.match(rule![1]!, /white-space:\s*nowrap/, "wrapping would overflow the row instead");
});

test("R5: clipping the pixels does not remove the asset from the record", () => {
  /* The visible string is truncated twice — 40 characters in markup, then the
     cell's ellipsis. So the FULL name has to be real text in the accessibility
     tree: `title` alone would make the identity of the traded asset
     tooltip-only, which the plan forbids for anything honesty-bearing. */
  const long = "BLACKROCK LIQUIDITY FUNDS TREASURY TRUST FUND INSTITUTIONAL SHARES";
  const html = assetNameCell({ asset: long, assetType: "Mutual Fund" });
  assert.ok(html.includes('class="visually-hidden"'), "an accessible copy must exist");
  const hidden = /<span class="visually-hidden">([^<]*)<\/span>/.exec(html);
  assert.ok(hidden, "the visually-hidden span is present");
  assert.ok(
    hidden![1]!.includes(long),
    `the accessible copy must carry the WHOLE name, got: ${hidden![1]}`,
  );
  assert.match(html, /<span aria-hidden="true">/, "the truncated visible span is aria-hidden");
  assert.ok(
    html.includes("…"),
    "the visible string is still truncated — this test must not pass by un-truncating it",
  );
});

test("R5: a row renders its traded date exactly once", () => {
  /* `dualDate` in its short form emits the traded date twice — once as
     `.traded-date` and again inside the combined `.mobile-dates` string — and
     relies on the two never being visible together. The classic feed's fold
     revealed `.mobile-dates` while hiding `.traded-date`; that feed was removed
     in signals-v3 M1. The short form survives only in entity-table date cells,
     where `.mobile-dates` must stay hidden at every width, and the feed renders
     the COMPLETE form, which prints each date once. Both halves are asserted. */
  assert.match(
    css,
    /\.mobile-dates \{\s*display:\s*none;\s*\}/,
    ".mobile-dates must be hidden or the date renders twice",
  );
  assert.equal(
    mediaBlockContaining(css, /\.mobile-dates[^{]*\{[^}]*display:\s*inline/),
    null,
    "no breakpoint reveals .mobile-dates, so no width shows the trade date twice",
  );
  const row = txnRowHtml(
    {
      kind: "txn", txnId: "t-r5", asset: null, assetType: null, filed: "2026-07-21", traded: "2026-06-24",
      name: "N", bioguide: "T000001", party: "R", state: "OK", district: null, chamber: "senate",
      ticker: "WMB", side: "purchase", owner: null, low: 1001, high: 15000, lag: 27, late: 0, flags: [],
      doc: "https://efdsearch.senate.gov/x",
    },
    {},
  );
  assert.doesNotMatch(row, /mobile-dates|traded-date/, "the feed row carries no second copy of a date");
  assert.equal((row.match(/<time datetime="2026-06-24"/g) ?? []).length, 1, "the traded date, once");
  assert.equal((row.match(/<time datetime="2026-07-21"/g) ?? []).length, 1, "the filed date, once");
});

/* ---------------- R6: the changes table ---------------- */

const R6_ROW = {
  cik: "0001067983",
  position_key: "cusip:037833100",
  put_call: "LONG",
  curr_period: "2026-06-30",
  prev_period: "2026-03-31",
  change_kind: "trim",
  prev_value_usd: 1_000_000,
  curr_value_usd: 400_000,
  delta_value_usd: -600_000,
  prev_shares: 1_000,
  curr_shares: 400,
  delta_shares: -600,
  ssh_prnamt_type: "SH",
  flags: [] as string[],
} as const;

test("R6: the decisive column is asserted, and it comes before the raw levels", () => {
  /* The table exists to answer "added or trimmed?". That answer lived in the
     EIGHTH of nine columns, behind six numeric ones, so every viewport under
     ~1024px pushed it off the right edge — the one column the surface is for
     was the one you had to scroll to find.

     The order is pinned here because it is a CONTRACT, not a preference: the
     header and the body cells are twin code paths, and moving one without the
     other mislabels every column while still rendering a plausible table.

     DESIGN-POLISH M2 (T2.1, R12; milestone map `m1-layout.test.ts:224-252`):
     the Flags column renders BY PRESENCE — only when some row of the table's
     collection still shows a flag after hoisting — so the column set is read
     from the table's own `data-columns`, and the order contract is asserted
     over the columns it lists. Both cases are rendered: a collection with a
     flagged row (Flags present, on every row), and one without (Flags removed,
     its reason printed in the table foot). */
  const flagged = { ...R6_ROW, position_key: "cusip:594918104", flags: ["shares_unit_mismatch"] };
  for (const [rows, expectFlags] of [
    [[R6_ROW, flagged], true],
    [[R6_ROW], false],
  ] as const) {
    const html = changesTableHtml(rows as never, "2026-06-30", "2026-08-14");
    const root = new MiniElement("body");
    root.innerHTML = html;
    const visible = (el: MiniElement): string =>
      el.nodes
        .map((n) => (typeof n === "string" ? n : n.classList.contains("note-pop") ? "" : visible(n)))
        .join("");
    const table = root.querySelector("table[data-columns]")!;
    const listed = table.getAttribute("data-columns")!.split(",");
    assert.equal(listed.includes("flags"), expectFlags, `Flags is listed only when a row carries a flag (${expectFlags})`);
    const ths = root.querySelectorAll("thead th");
    assert.deepEqual(ths.map((th) => th.getAttribute("data-col")), listed, "every header is a listed column, in order");
    const headers = ths.map((th) => visible(th).trim());
    assert.deepEqual(
      headers,
      [
        // R1 (refinement 20260910): the issuer name leads the cell; the grain
        // note stays on the row. Premarketing: the header reads "Issuer", as
        // Reported positions' does (no Ticker column: no ticker map here).
        "Issuer",
        "Change",
        "Δ value",
        "Δ shares",
        "Prev value",
        "Curr value",
        "Prev shares",
        "Curr shares",
        ...(expectFlags ? ["Flags"] : []),
      ],
      "the change verdict and its two deltas must precede the four raw levels",
    );
    assert.ok(headers.indexOf("Change") < headers.indexOf("Prev value"), "verdict before levels");
    assert.ok(headers.indexOf("Change") <= 1, "the verdict sits beside the identity");

    /* the body's cell classes must line up with those headers, in that order,
       on EVERY row — the unflagged row keeps its (empty) Flags cell */
    const dataRows = root.querySelectorAll("tbody tr").filter((tr) => tr.children[0]?.classList.contains("c-pos"));
    assert.equal(dataRows.length, rows.length, "every row rendered");
    const role = (el: MiniElement): string =>
      (el.getAttribute("class") ?? "").split(/\s+/).filter((c) => /^c-(?:num|pos|chip|kind|flex|flags)$/.test(c)).sort().join(" ");
    for (const row of dataRows) {
      const classes = row.children.map((td) => (td.getAttribute("class") ?? "").split(/\s+/)[0]!);
      assert.deepEqual(
        classes,
        ["c-pos", "c-chip", "c-num", "c-num", "c-num", "c-num", "c-num", "c-num", ...(expectFlags ? ["c-flags"] : [])],
        "the body cells drifted from the header order — the twin path was not moved",
      );
      assert.equal(headers.length, classes.length, "every header has exactly one cell");
      assert.deepEqual(ths.map(role), row.children.map(role), "each header carries its column's role");
    }
    const reason = root.querySelector("p.table-foot-reason");
    if (expectFlags) assert.equal(reason, null, "a kept column prints no reason");
    else assert.equal(visible(reason!).trim(), "Flags: no row carries a flag.", "the removed honesty column states why");
  }
});

test("R6: the scroll cue exists at every width, not only inside the fold", () => {
  /* A container that scrolls without saying so hides the columns past its edge
     as completely as deleting them. The fold already carried a cue; the wider
     viewports carried none, which is where the decisive column went missing. */
  const base = css.slice(0, css.indexOf("@media (max-width: 720px)"));
  const rule = /\.table-scroll \{([^}]*)\}/.exec(base);
  assert.ok(rule, ".table-scroll must be styled OUTSIDE the fold");
  assert.match(rule![1]!, /overflow-x:\s*auto/, "it still scrolls in-container");
  assert.match(
    rule![1]!,
    /background:/,
    "no scroll cue outside the fold — that is the R6 defect",
  );
  assert.match(
    rule![1]!,
    /local/,
    "the cue must be scroll-position aware, or it announces overflow that is not there",
  );
  assert.ok(
    /\.etable\[data-sticky-first\] th:first-child/.test(base),
    "the identity column must stay put at every width, not only at the fold",
  );
});
