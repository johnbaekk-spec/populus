/* RUN SURFACES-LEGIBILITY — the surface-level changes (SL-R1, SL-R9, SL-R10,
   SL-R11, SL-R12, SL-R13, SL-R14, SL-R15, SL-R29).

   `sl-` prefix per Constraint 9: this run's R-numbers collide with earlier
   runs', so nothing here may be named `r<n>-`. */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const congressPage = readFileSync(
  new URL("../src/pages/congress/index.astro", import.meta.url),
  "utf8",
);
const methodology = readFileSync(
  new URL("../src/pages/methodology/index.astro", import.meta.url),
  "utf8",
);

test("SL-R1: the /congress/ head drops its caveat line for a stamp plus FOUR deep methodology links", () => {
  assert.ok(!congressPage.includes('id="congress-caveat"'), "the caveat line is gone");
  assert.ok(congressPage.includes('id="congress-stamp"'), "the stamp line replaces it");

  const links = [...congressPage.matchAll(/href="\/methodology\/#([a-z0-9-]+)"/g)].map((m) => m[1]!);
  const wanted = ["coverage", "amount-ranges", "filing-lag", "owner-codes"];
  for (const id of wanted) {
    assert.ok(links.includes(id), `the head links /methodology/#${id}`);
    // The check that would have caught `#coverage`: the link must resolve to an
    // id that EXISTS. It did not, on origin/main, and resolved to the top of
    // the page instead.
    assert.ok(methodology.includes(`id="${id}"`), `/methodology/#${id} exists`);
  }
});

test("SL-R1: neither claim the caveat line carried depends on following a link", () => {
  // §7: text may change channel, never disappear. Both sentences are still in
  // the lede paragraph above the stamp, so a reader who follows nothing still
  // reads them.
  assert.ok(congressPage.includes("statutory ranges"), "the range claim is still on the page");
  assert.ok(congressPage.includes("45 days after the trade"), "the lag claim is still on the page");
});

test("SL-R9: no `.panel-note` prints a build id, and the footer copy is untouched", async () => {
  const { congressRankingSection, addsSectionHtml } = await import("../src/lib/ui.ts");
  assert.equal(typeof congressRankingSection, "function");
  assert.equal(typeof addsSectionHtml, "function");

  const ui = readFileSync(new URL("../src/lib/ui.ts", import.meta.url), "utf8");
  // Every remaining `· build ` in this module must be OUTSIDE a `.panel-note`.
  // There is exactly one, the signals page's `.si-asof`, which this run does
  // not own and whose bytes are therefore unchanged.
  const buildStamps = [...ui.matchAll(/[^\n]*· build [^\n]*/g)].map((m) => m[0]!);
  assert.equal(buildStamps.length, 1, "one build stamp left in ui.ts");
  assert.ok(buildStamps[0]!.includes("si-asof"), "and it is the out-of-scope signals stamp");
});

test("SL-R9: the client no longer reconstructs a build id out of rendered text", () => {
  for (const f of ["../src/scripts/congress-sections.ts", "../src/scripts/inst-index-client.ts"]) {
    const src = readFileSync(new URL(f, import.meta.url), "utf8");
    assert.ok(
      !src.includes('split(" · build ")'),
      `${f}: parsing a stamp back out of textContent to re-append it is gone`,
    );
  }
});

/* ---------------------------------------------------------------- T6 / SL-R10
   R10 is BLOCKED, and this is the measurement that blocks it. Recorded as a
   test rather than as a comment so a later attempt fails immediately instead of
   rediscovering it after the deletion has landed. */

test("SL-R10 BLOCKER: `.compact-disclosure` ships HIDDEN, so a terminus is the only no-JS statement of a bound", async () => {
  const { compactDisclosure, terminusRow } = await import("../src/lib/format.ts");

  /* R10 would delete the five terminus rows that "sit beside a
     compactDisclosure stating the same count". Measured: the control states
     NOTHING to a reader with scripting off — `compactDisclosure` emits the
     `hidden` attribute in BOTH of its branches, and `initDomDisclosures` /
     `syncDisclosure` are what remove it. So the count is not duplicated at all
     in the no-JavaScript view; it is stated exactly once, by the terminus.
     Deleting the terminus removes the reader's only statement of what is being
     held back, which is DESIGN-BRIEF §7 (Constraint 1) and success criterion 2,
     not a de-duplication. */
  const live = compactDisclosure({ rootId: "t", total: 25, shown: 10, noun: "rows" });
  assert.match(live, /class="compact-disclosure"[^>]*hidden>/, "the control ships hidden");
  assert.match(live, /Show all 25 rows \(15 more\)/, "its count is reachable ONLY once JS unhides it");

  const shell = compactDisclosure({ rootId: "t", total: 10, shown: 10, noun: "rows" });
  assert.match(shell, /hidden>/, "and the nothing-held-back shell too");

  // The terminus, by contrast, is visible as rendered.
  const t = terminusRow({ author: "populus", html: "15 further rows are not rendered above." });
  assert.doesNotMatch(t, /<div class="terminus"[^>]*\shidden/, "the terminus is the visible channel");

  for (const f of ["../src/scripts/inst-index-client.ts", "../src/scripts/congress-sections.ts"]) {
    const src = readFileSync(new URL(f, import.meta.url), "utf8");
    assert.ok(
      /removeAttribute\("hidden"\)|\.hidden = false/.test(src),
      `${f}: the control is revealed by script, which is what makes it a JS-only channel`,
    );
  }
});

/* ------------------------------------------------------ T7 / SL-R11 R12 LD4 */

test("SL-R11/LD4: the visible suffix is the SUMMED ROW TOTAL, never a count of categories", async () => {
  const { rankingWindowHtml, rankingExclusions, rankingExcludedRows } = await import("../src/lib/ui.ts");
  const rollup = {
    range: "12m", basis: "traded", rows: [],
    dateAnomalies: 72, undated: 212, noTickerRows: 1412,
  } as never;

  const html = rankingWindowHtml("12 months to 2026-08-23 by trade date", rollup, "tickers", "momentum-section");
  // 72 + 212 + 1,412 = 1,696 — the live figure from Current State.
  assert.equal(rankingExcludedRows(rollup, "tickers"), 1696);
  assert.match(html, /· 1,696 rows excluded/, "the SIZE of what the reader cannot see is on the page");
  assert.doesNotMatch(html, /3 exclusions/, "never a count of categories — the round-1 objection LD4 accepted");

  // …and the three per-category counts are in the note body, not lost.
  for (const clause of rankingExclusions(rollup, "tickers")) {
    assert.ok(html.includes(clause.replace(/&/g, "&amp;")), "each clause is reachable in the note");
  }
});

test("SL-R11/R12: the suffix total and the note body are produced by ONE pass and cannot disagree", async () => {
  const { rankingWindowHtml, rankingExclusions, rankingExcludedRows } = await import("../src/lib/ui.ts");
  // Every combination of present/absent categories, on both kinds. A stale
  // count inside a hover is worse than one on the page: nobody sees it go
  // wrong, so the agreement is asserted rather than reasoned about.
  for (const dateAnomalies of [0, 1, 72]) {
    for (const undated of [0, 1, 212]) {
      for (const noTickerRows of [0, 1, 1412]) {
        for (const kind of ["tickers", "leaders"] as const) {
          const rollup = { range: "12m", basis: "traded", rows: [], dateAnomalies, undated, noTickerRows } as never;
          const clauses = rankingExclusions(rollup, kind);
          const total = rankingExcludedRows(rollup, kind);
          const html = rankingWindowHtml("W", rollup, kind, "s");
          if (clauses.length === 0) {
            assert.equal(total, 0);
            assert.equal(html, "W", "no exclusions -> no suffix and no note");
            continue;
          }
          const expected = dateAnomalies + undated + (kind === "tickers" ? noTickerRows : 0);
          assert.equal(total, expected, `${kind} ${dateAnomalies}/${undated}/${noTickerRows}`);
          assert.ok(
            html.includes(`· ${total.toLocaleString("en-US")} ${total === 1 ? "row" : "rows"} excluded`),
            "the visible suffix IS the sum of the clauses it anchors",
          );
        }
      }
    }
  }
});

test("SL-R11: the deleted caveat root is gone from BOTH the renderer and its client", async () => {
  const ui = readFileSync(new URL("../src/lib/ui.ts", import.meta.url), "utf8");
  const client = readFileSync(new URL("../src/scripts/congress-sections.ts", import.meta.url), "utf8");
  assert.ok(!ui.includes("-caveat\">"), "no `#<sectionId>-caveat` root is rendered");
  assert.ok(!ui.includes("rankingCaveatHtml"), "the retired renderer has no definition left");
  assert.ok(!client.includes("rankingCaveatHtml"), "and no caller");
  assert.ok(client.includes("rankingWindowHtml"), "the client rewrites through the SAME function the server used");
});

/* --------------------------------------------- T8 / SL-R13 R14 R29 */

test("SL-R29: `onSettled` fires on BOTH paths — the failure path is the one `onRows` cannot serve", () => {
  const src = readFileSync(new URL("../src/scripts/feed-client.ts", import.meta.url), "utf8");
  // `onRows` documents itself as firing on success alone, so an indicator
  // cleared only there reads "applying …" forever after a failed download — a
  // false statement about a view that will never be painted.
  assert.ok(/onSettled\?: \(ok: boolean\) => void/.test(src), "the callback takes the OUTCOME, not just a signal");
  assert.ok(/settle\(true\)/.test(src), "fired on the success path");
  assert.ok(/settle\(false\)/.test(src), "and on the failure path");
  // exactly once per load, and a throwing consumer cannot turn a good decode bad
  assert.ok(/if \(settled\) return;/.test(src), "once per load");
  assert.ok(/a feed-settled consumer failed/.test(src), "a consumer's throw is contained");
});

test("SL-R13: the pending indicator is an indicator, NOT a queue", async () => {
  const src = readFileSync(new URL("../src/scripts/congress-sections.ts", import.meta.url), "utf8");
  // R13's whole point: `range`/`basis` are module state and `receiveRows`
  // already reapplies them, so a pre-arrival click was never dropped. Nothing
  // may be buffered here.
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  assert.ok(!/pendingClicks|[Qq]ueue|deferred(Range|Basis)/.test(code), "no queue is introduced");
  assert.ok(/function markPendingIfUnpainted/.test(src));
  assert.ok(/if \(allRows\) return;/.test(src), "nothing is stated when the table CAN paint");
  assert.ok(/setPending\(null\)/.test(src), "and it is cleared when the rows land");
  assert.ok(/recomputeMomentumIfChanged\(\);/.test(src), "the existing apply mechanism is untouched");

  // The node ships in the SSR bytes: a client cannot reveal what was never rendered.
  const { congressRankingSection } = await import("../src/lib/ui.ts");
  assert.equal(typeof congressRankingSection, "function");
  const ui = readFileSync(new URL("../src/lib/ui.ts", import.meta.url), "utf8");
  assert.ok(/id="\$\{esc\(opts\.sectionId\)\}-pending" role="status" aria-live="polite" hidden/.test(ui));
});

test("SL-R14/LD2: a zero-rankable window states the lag and prices both switches", async () => {
  const { emptyWindowHtml } = await import("../src/lib/ui.ts");
  const html = emptyWindowHtml("7d", "traded", { otherBasis: 58, wider: { range: "30d", n: 123 } }, "tickers");
  assert.match(html, /No tickers disclose a trade date inside this 7d window/);
  assert.match(html, /45 days after the/, "the lag is NAMED, which is why the window is honestly empty");
  assert.match(html, /data-basis="filed"[^>]*>58 by filing date/, "the other basis, priced");
  assert.match(html, /data-range="30d"[^>]*>123 at 30d/, "the next wider range, priced");
});

test("SL-R14: the TERMINAL branches — no wider range, and doubly empty", async () => {
  const { emptyWindowHtml } = await import("../src/lib/ui.ts");

  // 12m: there is no wider range, so only the other basis is named.
  const atWidest = emptyWindowHtml("12m", "traded", { otherBasis: 7626, wider: null }, "members");
  assert.match(atWidest, /7,626 by filing date/);
  assert.doesNotMatch(atWidest, /data-range=/, "no wider range is invented");

  // …and when the other basis is ALSO zero, no switch at all.
  const doublyEmpty = emptyWindowHtml("12m", "traded", { otherBasis: 0, wider: null }, "members");
  assert.match(doublyEmpty, /no rankable members in this window on either basis/);
  assert.match(doublyEmpty, /no wider range to offer/);
  assert.doesNotMatch(doublyEmpty, /<button/, "a control that would change nothing is worse than none");

  // A wider range that is ALSO empty is not offered either.
  const emptyWider = emptyWindowHtml("7d", "filed", { otherBasis: 0, wider: { range: "30d", n: 0 } }, "tickers");
  assert.doesNotMatch(emptyWider, /<button/);
});

test("SL-R14: every range on both bases renders the block, and its counts come from the same rollups the control paints", async () => {
  const { rankingAlternatives, CONGRESS_RANGES, emptyWindowHtml } = await import("../src/lib/ui.ts");
  // Zero-result fixtures at EVERY range on BOTH bases, not only the
  // `7d · traded` specimen the plan measured.
  const rows: never[] = [];
  for (const range of CONGRESS_RANGES) {
    for (const basis of ["traded", "filed"] as const) {
      for (const kind of ["tickers", "leaders"] as const) {
        const alt = rankingAlternatives(rows, "2026-08-23", kind, range, basis);
        assert.equal(alt.otherBasis, 0);
        assert.equal(alt.wider === null, range === "12m", "only 12m is terminal");
        const html = emptyWindowHtml(range, basis, alt, kind === "tickers" ? "tickers" : "members");
        assert.match(html, /class="section-note empty-window"/);
        assert.doesNotMatch(html, /<button/, "an empty corpus offers nothing");
      }
    }
  }
});

/* ----------------------------------------- T9 / SL-R16 R17 R18 (LD8 in css-fold) */

test("SL-R16: the adds control is ONE labelled row, and the island's hooks are unchanged", async () => {
  const { addsSectionHtml } = await import("../src/lib/ui.ts");
  const html = addsSectionHtml(
    {
      period: "2026-03-31", generated_at: "2026-08-12", rows: [],
      truncated: false, truncation_boundary: null, ambiguous_identity_exclusion_count: 0,
    } as never,
    { period: "2026-03-31", mode: "all", periods: ["2026-03-31", "2025-12-31"], buildId: "b" },
  );
  // Two stacked `.mgr-chips` groups became one `.control-row`, reusing
  // `.range-control` rather than inventing a second control idiom.
  assert.equal((html.match(/class="mgr-chips"/g) ?? []).length, 0, "no stacked chip groups left");
  assert.match(html, /class="range-control control-row"/);
  // The labels are VISIBLE now, not only aria-labels — a sighted reader met two
  // unlabelled button rows and had to infer which axis each moved.
  assert.match(html, /class="filter-label">Quarter</);
  assert.match(html, /class="filter-label">Count</);
  // and the island binds exactly what it bound before
  assert.match(html, /id="inst-adds-controls"/);
  assert.match(html, /data-adds-period="2026-03-31"/);
  assert.match(html, /data-adds-mode="all"/);
});

test("SL-R17: raw issuer and position keys stop being visible text; `entity:` gets NO chip", async () => {
  const { identityChipHtml, identityStrengthOf } = await import("../src/lib/format.ts");
  const ctx = { scope: "t" };

  // A resolved entity is the ordinary case and the strong one — chipping it
  // would flag the absence of a problem.
  assert.equal(identityStrengthOf("entity:0000320193"), "entity");
  assert.equal(identityChipHtml("entity:0000320193", ctx, "k"), "", "no chip for a resolved entity");

  for (const [key, label] of [
    ["cusip6:464287", "issuer from CUSIP-6"],
    ["name:apple-inc", "issuer from name"],
    ["sid:sec:prov:00076fbdb7a2ddaf78c0e89001ecf4f7", "provisional position id"],
  ] as const) {
    const chip = identityChipHtml(key, ctx, `k-${key}`);
    assert.ok(chip.includes(label), `${key} renders a READABLE label`);
    // nothing is lost: the raw key survives in the note AND in a data attribute
    assert.ok(chip.includes(`data-identity-key="${key}"`), "the raw key persists as data");
    assert.ok(chip.includes(`key as published: ${key}`), "and is reachable in the note");
  }
});

test("SL-R17/SL-R26: the activity identity chip is keyed on the FULL composite, not the bare position_key", async () => {
  const { activityRowHtml } = await import("../src/lib/activity.ts");
  const base = {
    cik: "0001", position_key: "sid:sec:prov:abc", ssh_prnamt_type: "SH",
    issuer_name: "X", filer_name: "F", change_kind: "add", delta_value_usd: 1,
    curr_period: "2026-03-31", filed_date: "2026-05-01", filed_from: "composition",
    reporting_lag_days: 31, flags: [], filed_accession: null,
  };
  // `activity.test.ts:172` holds same-CIK, same-`position_key` rows separated
  // only by PUT/CALL. A bare-key id collides on exactly this pair.
  const html =
    activityRowHtml({ ...base, put_call: "PUT" } as never) +
    activityRowHtml({ ...base, put_call: "CALL" } as never);
  assert.ok(!html.includes("> sid:sec:prov:abc<"), "the raw key is not printed as visible text");
  const ids = [...html.matchAll(/popover id="([^"]+)"/g)].map((m) => m[1]!);
  assert.equal(new Set(ids).size, ids.length, "PUT and CALL rows emit distinct panel ids");
});

test("SL-R18: the curated-typing caveat is a Type-column note carrying its N of M count", () => {
  const page = readFileSync(new URL("../src/pages/institutional/index.astro", import.meta.url), "utf8");
  // The paragraph is gone from the page surface…
  assert.ok(
    !/class="caveat-line">Manager type and display name/.test(page),
    "the standalone caveat paragraph is gone",
  );
  // …and its text, WITH the live count, is the Type column's note.
  assert.match(page, /const typeNote =[\s\S]{0,400}curated registry covering/);
  assert.match(page, /fmtInt\(typedCount\)\} of \$\{fmtInt\(indexRows\.length\)\}/, "the N of M count travels with it");
  assert.match(page, /h\.label === "Type" \? typeNote : null/, "anchored on the column it is about");
  // the `<noscript>` stays VISIBLE: it is about scripting, not about a column
  assert.match(page, /<noscript>Filtering by chip needs JavaScript/);
});
