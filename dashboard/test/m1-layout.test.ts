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

import { assetNameCell } from "../src/lib/format.ts";
import { changesTableHtml } from "../src/lib/ui/index.ts";

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

test("R4: the build watermark is rendered once, in the footer, not the masthead", () => {
  /* `Base.astro` printed the build id twice: once in `.masthead-meta` and once
     in `.footer-build`. The plan calls this a DELETION rather than a
     relocation precisely because the footer copy already existed. */
  assert.ok(
    !base.includes("masthead-meta"),
    "the masthead watermark is back — the footer already prints the identifiers",
  );
  assert.ok(
    !css.includes(".masthead-meta"),
    "the .masthead-meta rule outlived its markup — dead CSS reads as accounted-for",
  );
  const buildIdRenders = base.match(/build \{build\.buildId\}/g) ?? [];
  assert.equal(
    buildIdRenders.length,
    1,
    `the build id renders ${buildIdRenders.length} times in Base.astro; exactly one, in the footer`,
  );
  assert.ok(
    base.indexOf("build {build.buildId}") > base.indexOf("<footer"),
    "the surviving watermark must be the footer one",
  );
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
  /* `.cell-ticker` is a 66px grid column that renders a full asset name
     whenever no ticker was disclosed — ~300px of 12.5px mono for a 40-char
     name, painted straight over `.cell-side`. `.cell-member` already had this
     exact treatment, which is what made the omission easy to miss. */
  const rule = /\.cell-ticker \{([^}]*)\}/.exec(css);
  assert.ok(rule, ".cell-ticker rule exists");
  assert.match(rule![1]!, /overflow:\s*hidden/, ".cell-ticker must clip");
  assert.match(rule![1]!, /text-overflow:\s*ellipsis/, ".cell-ticker must mark the clip");
  assert.match(rule![1]!, /white-space:\s*nowrap/, "wrapping would overflow the 38px row instead");
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
  /* `dualDate` emits the traded date twice — once as `.traded-date` and again
     inside the combined `.mobile-dates` string — and relies on the two never
     being visible together. That is a real invariant, so it is asserted rather
     than assumed: `.mobile-dates` is display:none by default, and the fold
     hides `.traded-date` in the same breakpoint that reveals it. */
  assert.match(
    css,
    /\.mobile-dates \{\s*display:\s*none;\s*\}/,
    ".mobile-dates must be hidden outside the fold or the date renders twice",
  );
  /* The invariant is that ONE breakpoint both hides the desktop traded-date and
     reveals the combined string. Two earlier versions of this test could not see
     that:

       `css.slice(indexOf("@media (max-width: 720px)"))` — R7 moved the fold
         structure to ≤1080px, which sits EARLIER in the file, so the slice
         stopped containing the rules entirely.
       `css.slice(min(...foldStarts))` — the fix for that, and codex round 1's F3
         killed it: slicing to end-of-file lets the two regexes match in
         DIFFERENT blocks. Moving only the hiding rule back to ≤720px would leave
         both dates visible from 721–1080px with this test still green.

     So the governing block is extracted by brace matching and both rules are
     asserted INSIDE it. */
  const foldBlock = mediaBlockContaining(css, /\.feed-row \.mobile-dates \{\s*display:\s*inline/);
  assert.ok(
    foldBlock,
    "some @media block must reveal .feed-row .mobile-dates, or the fold is gone",
  );
  const fold = foldBlock!;
  assert.match(
    fold,
    /\.feed-row \.cell-traded \.traded-date/,
    "the fold must hide the desktop traded-date when it reveals .mobile-dates",
  );
  assert.match(
    fold,
    /\.feed-row \.mobile-dates \{\s*display:\s*inline/,
    ".mobile-dates is revealed only inside the fold, and only for .feed-row",
  );
});

/* ---------------- R6: the changes table ---------------- */

test("R6: the decisive column is asserted, and it comes before the raw levels", () => {
  /* The table exists to answer "added or trimmed?". That answer lived in the
     EIGHTH of nine columns, behind six numeric ones, so every viewport under
     ~1024px pushed it off the right edge — the one column the surface is for
     was the one you had to scroll to find.

     The order is pinned here because it is a CONTRACT, not a preference: the
     header and the body cells are twin code paths, and moving one without the
     other mislabels every column while still rendering a plausible table. */
  const html = changesTableHtml(
    [
      {
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
        flags: [],
      },
    ],
    "2026-06-30",
    "2026-08-14",
  );
  /* RETARGETED — RUN SURFACES-LEGIBILITY, SL-R7 (LD6).
     The header cells now carry a note after the label, so `[^<]*` no longer
     reaches the closing tag. The note markup is stripped before the ORIGINAL
     assertion runs — the column contract this test pins is unchanged and is
     still asserted exactly, rather than the pattern being widened to tolerate
     whatever the header happens to contain. */
  const bare = html.replace(/<span class="note">.*?<\/span><\/span>/gs, "");
  const headers = [...bare.matchAll(/<th scope="col">([^<]*)<\/th>/g)].map((m) => m[1]!);
  assert.deepEqual(
    headers,
    [
      "Position · grain",
      "Change",
      "Δ value",
      "Δ shares",
      "Prev value",
      "Curr value",
      "Prev shares",
      "Curr shares",
      "Flags",
    ],
    "the change verdict and its two deltas must precede the four raw levels",
  );
  assert.ok(headers.indexOf("Change") < headers.indexOf("Prev value"), "verdict before levels");
  assert.ok(headers.indexOf("Change") <= 1, "the verdict sits beside the identity");

  /* the body's cell classes must line up with those headers, in that order */
  const row = /<tr><td class="c-pos">[\s\S]*?<\/tr>/.exec(html);
  assert.ok(row, "a data row rendered");
  const classes = [...row![0]!.matchAll(/<td class="(c-[a-z]+)[^"]*"/g)].map((m) => m[1]!);
  assert.deepEqual(
    classes,
    ["c-pos", "c-chip", "c-num", "c-num", "c-num", "c-num", "c-num", "c-num", "c-flags"],
    "the body cells drifted from the header order — the twin path was not moved",
  );
  assert.equal(headers.length, classes.length, "every header has exactly one cell");
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
