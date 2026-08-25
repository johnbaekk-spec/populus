/* RUN SURFACES-LEGIBILITY — the surface-level changes (SL-R1, SL-R9, SL-R10,
import { readFileSync } from "node:fs";
   SL-R11, SL-R12, SL-R13, SL-R14, SL-R15, SL-R29).

   `sl-` prefix per Constraint 9: this run's R-numbers collide with earlier
   runs', so nothing here may be named `r<n>-`. */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import type { TxnRow } from "../src/lib/format.ts";

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

   R10 was BLOCKED TWICE, and these tests are what blocked it. It asked for five
   `terminusRow` call sites to be deleted because "an adjacent compactDisclosure
   states the same count" — and the control stated that count in exactly one
   state, the one where a script had already revealed it. Three states left it
   silent, and the terminus was the only channel correct in all three:

     (b) scripting OFF — `compactDisclosure` emitted `hidden` in both branches,
         and only `initDomDisclosures` / `syncDisclosure` removed it;
     (c) scripting ON, before the island syncs — the congress ranking waits for
         a 22 MB feed (F25) and the directory waits for a sort, so on three of
         the five surfaces nothing revealed the control at load;
     (d) scripting ON, island loaded and returned early — F1 is a shipped
         instance of exactly that, and `<noscript>` does not render for it.

   An owner-directed `<noscript>` attempt closed (b) alone and was reverted.
   What unblocked R10 was fixing the root cause instead: the bound is now a real
   element inside the control, emitted VISIBLE by the server, with only the
   BUTTON waiting for a script. All three states are closed by construction —
   none of them can hide a `<span>` the server rendered without `hidden`.

   These tests are the replacement for the blockers, and they carry the same
   burden: they must fail loudly if anyone makes the bound script-dependent
   again. Two are behavioural — the island is really initialised over
   server-rendered rows, and `initDomDisclosures` is really run — because
   states (c) and (d) are about what an island does, not about what markup
   says. */

/** Every surface whose terminus R10 deleted, rendered as the server ships it. */
async function boundedSurfaces(): Promise<{ name: string; html: string }[]> {
  const { congressRankingSection, addsSectionHtml, CONGRESS_ROOTS } = await import("../src/lib/ui.ts");
  const { leadersRollup, congressTickersRollup } = await import("../src/lib/derive.ts");
  const { activityFeedHtml, paginateActivity } = await import("../src/lib/activity.ts");

  const rows = rankingRows(24);
  const stamps = {
    buildId: "b", generatedAt: "2026-08-12 00:00 UTC", generatedAtDate: "2026-08-12",
  } as never;
  const ctx = { watched: new Set() } as never;
  return [
    {
      name: "congress ranking (members)",
      html: congressRankingSection(
        "leaders",
        leadersRollup(rows, "2026-08-12", { range: "12m", basis: "traded" }),
        stamps, ctx,
        {
          rootId: CONGRESS_ROOTS.membersRanked,
          heading: "Member net disclosed flow",
          sectionId: "members-section",
          undisclosedRootId: CONGRESS_ROOTS.membersUndisclosed,
        } as never,
      ),
    },
    {
      name: "congress ranking (tickers)",
      html: congressRankingSection(
        "tickers",
        congressTickersRollup(rows, "2026-08-12", { range: "12m", basis: "traded" }),
        stamps, ctx,
        { rootId: CONGRESS_ROOTS.momentum, heading: "Ticker momentum", sectionId: "momentum-section" } as never,
      ),
    },
    {
      name: "institutional adds leaderboard",
      html: addsSectionHtml(
        {
          period: "2026-03-31", generated_at: "2026-08-12",
          rows: Array.from({ length: 25 }, (_, i) => addsRow({ issuer_key: `e${i}`, delta_value_usd: 1000 - i })),
          truncated: false, truncation_boundary: null, ambiguous_identity_exclusion_count: 0,
        } as never,
        { period: "2026-03-31", mode: "all", periods: ["2026-03-31"], buildId: "b" } as never,
      ),
    },
    {
      name: "institutional activity feed",
      html: activityFeedHtml(
        { present: true, reason: null, filings: FILINGS, pagination: paginateActivity(activityRecords(30), FILINGS) } as never,
        { rowLimit: 50 },
      ),
    },
  ];
}

/** The fixtures the surfaces above need, kept local to this file rather than
    shared: a fixture two files apart is a fixture that drifts. */
const FILINGS = {
  "1": {
    accession: "0000000000-26-000001", submission_type: "13F-HR",
    period_of_report: "2026-03-31", filed_date: "2026-05-10",
    doc_url: "https://www.sec.gov/Archives/1", source: "sec-edgar",
  },
} as never;

function activityRecords(n: number): never[] {
  return Array.from({ length: n }, (_, i) => ({
    cik: `000${String(1_000_000 + i)}`, filer_name: "FIXTURE HOLDINGS LLC",
    issuer_key: "entity:cik:0000320193", issuer_name: "APPLE INC",
    position_key: `sid:${String(i).padStart(6, "0")}`, put_call: "LONG",
    ssh_prnamt_type: "SH", change_kind: "add", curr_period: "2026-03-31",
    prev_period: "2025-12-31", prev_value_usd: 1_000, curr_value_usd: 3_000,
    delta_value_usd: 1_000_000 - i, prev_shares: 10, curr_shares: 30,
    delta_shares: 20, filing_keys: [1], prior_filing_keys: [],
    current_filing_keys: [], flags: [],
  })) as never[];
}

function addsRow(over: Record<string, unknown> = {}): never {
  return {
    issuer_key: "entity:1", issuer_key_source: "entity", issuer_name: "I",
    manager_count: 1, new_position_count: 0, delta_value_usd: 100,
    delta_value_is_partial: false, top_adder_cik: 1, top_adder_name: "M", ...over,
  } as never;
}

function rankingRows(n: number): TxnRow[] {
  return Array.from({ length: n }, (_, i) => ({
    kind: "txn", txnId: `t${i}`, asset: null, assetType: null,
    filed: "2026-07-21", traded: "2026-08-01", name: `M${i}`, bioguide: `B${i}`,
    party: "R", state: "OK", district: null, chamber: "senate", ticker: `T${i}`,
    side: "purchase", owner: "self", low: 1001 + i * 1000, high: 15000 + i * 1000,
    lag: 27, late: 0, flags: [], doc: "https://example.invalid/d",
  })) as unknown as TxnRow[];
}

test("SL-R10 (b): every bounded surface STATES its bound in server bytes, with no script", async () => {
  /* State (b), asserted where it is decided: in the emitted markup. The button
     is `hidden` in every branch — a control that cannot work without JavaScript
     must not be presented as though it can — and the sentence beside it is
     `hidden` in none, because it is the reader's only notice otherwise. */
  const { compactDisclosure } = await import("../src/lib/format.ts");

  const live = compactDisclosure({ rootId: "t", total: 25, shown: 10, noun: "rows" });
  assert.doesNotMatch(live, /class="compact-disclosure"[^>]*\shidden>/, "the wrapper is NOT hidden");
  assert.match(
    live,
    /<span class="compact-bound-count">15 further rows are not rendered above/,
    "the count is real text, reachable with scripting off",
  );
  assert.match(live, /class="linklike compact-toggle"[^>]*\shidden>/, "the BUTTON is what waits for a script");

  // F16's shell survives unchanged: nothing to disclose, nothing shown, and an
  // element a client can fill in later.
  const shell = compactDisclosure({ rootId: "t", total: 10, shown: 10, noun: "rows" });
  assert.match(shell, /class="compact-disclosure"[^>]*\shidden>/, "the nothing-held-back shell is hidden");
  assert.match(shell, /<span class="compact-bound-count" hidden><\/span>/, "…and claims no count");

  for (const { name, html } of await boundedSurfaces()) {
    const bounds = [...html.matchAll(/<p class="compact-bound">([\s\S]*?)<\/p>/g)].map((m) => m[1]!);
    assert.ok(bounds.length > 0, `${name}: renders no bound statement at all`);
    const stated = bounds.filter((b) => !/^<span class="compact-bound-count" hidden>/.test(b));
    assert.ok(stated.length > 0, `${name}: every bound it renders is hidden — state (b) is back`);
    for (const b of stated) {
      assert.doesNotMatch(
        b.slice(0, b.indexOf("</span>")),
        /hidden/,
        `${name}: the count clause ships hidden, so no-JS readers are told nothing`,
      );
    }
  }
});

test("SL-R10: the five deleted termini took NOTHING with them — every clause still ships", async () => {
  /* Requirement 3, asserted clause by clause. Four of the five terminus rows
     carried more than a count, and each of those facts is stated nowhere else:
     the feed dataset link, this quarter-and-mode's payload link, that every
     filer has a page, and the activity feed's PUBLICATION bound — which is a
     different fact from a render bound. If a later refactor drops one, this
     fails; that is the whole point of writing them out. */
  const surfaces = new Map((await boundedSurfaces()).map((s) => [s.name, s.html]));

  const ranking = surfaces.get("congress ranking (tickers)")!;
  assert.match(ranking, /Every row remains in the <a href="\/congress\/data\/feed\.v1\.json">published dataset<\/a>\./);

  const adds = surfaces.get("institutional adds leaderboard")!;
  assert.match(adds, /Every issuer in this quarter's bounded payload remains in /);
  assert.match(adds, /<a href="\/institutional\/data\/adds\/2026-03-31\.all\.v1\.json">the published JSON<\/a>/);

  const feed = surfaces.get("institutional activity feed")!;
  assert.match(feed, /ordered change records published in this build/, "the publication bound");
  assert.match(feed, /same-origin shard/, "…its shard count");
  assert.match(feed, /institutional\/data\/activity\/&lt;page&gt;\.v1\.json/, "…the shard base path");
  assert.match(feed, /records or [\d,]+ bytes of serialized JSON/, "…and the per-shard limits");

  // The directory's clause is on an Astro page, so it is read from source.
  const page = readFileSync(new URL("../src/pages/institutional/index.astro", import.meta.url), "utf8");
  assert.match(page, /Every filer in this build has its own page/);
  assert.ok(
    page.indexOf("Every filer in this build has its own page") >
      page.indexOf("compactDisclosure({"),
    "…and it travels INSIDE the control, which is what makes it survive with no script",
  );
});

test("SL-R10 (5): the bound is stated ONCE — the button carries the total, not the held-back count", async () => {
  /* The de-duplication R10 actually asked for. With scripting on and the
     control revealed, the reader must not meet the same number twice, two
     elements apart — which is what the terminus row and the old
     "(15 more)" label did. */
  const { compactDisclosure } = await import("../src/lib/format.ts");
  const html = compactDisclosure({ rootId: "t", total: 25, shown: 10, noun: "rows" });
  const label = html.slice(html.indexOf("aria-controls"));
  assert.match(label, />Show all 25 rows</, "the button states the TOTAL");
  assert.doesNotMatch(label, /15/, "…and never repeats the count the sentence above it carries");

  for (const { name, html: surface } of await boundedSurfaces()) {
    assert.ok(!/class="terminus"/.test(surface.slice(surface.indexOf('<p class="compact-bound">'))),
      `${name}: a terminus row still stands beside the control that states the same bound`);
  }
});

test("SL-R10 (c): the ranking bound is stated BEFORE the 22 MB feed arrives, scripting ON", async () => {
  /* State (c), behavioural — the exact scenario that blocked R10, inverted.
     `syncDisclosure` deliberately does not run at bind time (F25), so the
     button is still hidden after the island has initialised over the
     server-rendered rows. The bound has to be stated anyway, and by the server,
     because nothing else is going to state it in this window. */
  const { installDom } = await import("./lib/mini-dom.ts");
  const { CONGRESS_ROOTS } = await import("../src/lib/ui.ts");
  const { initCongressSections } = await import("../src/scripts/congress-sections.ts");

  const section = (await boundedSurfaces()).find((s) => s.name === "congress ranking (members)")!.html;
  const { doc, restore } = installDom(
    `<main class="shell page" id="congress-page" data-generated-at-date="2026-08-12" ` +
      `data-range="12m" data-basis="traded">${section}</main>`,
  );
  try {
    initCongressSections(); // the island initialises; the dataset has NOT arrived

    const control = doc.querySelector(
      `.compact-disclosure[data-compact-for=${CONGRESS_ROOTS.membersRanked}]`,
    );
    assert.ok(control, "the section renders a disclosure control");
    assert.equal(
      control!.querySelector("button")!.hidden,
      true,
      "the button is still hidden — nothing reveals it until rows arrive (F25)",
    );
    const bound = control!.querySelector(".compact-bound-count")!;
    assert.equal(
      bound.hidden,
      false,
      "…and the bound is stated regardless. A bound that lived on the button was " +
        "stated to nobody for the whole duration of a 22 MB download.",
    );
    assert.match(bound.textContent, /further ranked members are not rendered above/);
    assert.match(control!.textContent, /published dataset/, "and the route to the withheld rows");
  } finally {
    restore();
  }
});

test("SL-R10 (c): `initDomDisclosures` reveals only DOM-backed BUTTONS — never a bound", async () => {
  /* The other half of state (c). The manager directory's control is not
     DOM-backed: its rows live in an embedded JSON payload and its
     `syncDisclosure` runs only from a RENDER, which `initSortableTable`
     deliberately does not perform at init. So on page load, with scripting on,
     nothing reveals its button — and its bound is stated anyway, by the server,
     exactly like the DOM-backed one's. */
  const { installDom } = await import("./lib/mini-dom.ts");
  const { compactDisclosure } = await import("../src/lib/format.ts");
  const { initDomDisclosures } = await import("../src/scripts/inst-index-client.ts");

  const html =
    `<div><tbody id="plain-tbody"></tbody>` +
    compactDisclosure({ rootId: "plain-tbody", total: 25, shown: 10, noun: "managers" }) +
    `<tbody id="dom-tbody"></tbody>` +
    compactDisclosure({ rootId: "dom-tbody", total: 25, shown: 10, noun: "changes", domBacked: true }) +
    `</div>`;
  const { doc, restore } = installDom(html);
  try {
    initDomDisclosures();
    const plain = doc.querySelector('.compact-disclosure[data-compact-for=plain-tbody]')!;
    const dom = doc.querySelector('.compact-disclosure[data-compact-for=dom-tbody]')!;
    assert.equal(
      plain.querySelector("button")!.hidden,
      true,
      "a non-DOM-backed button is still hidden after every load-time reveal path has run",
    );
    assert.equal(
      dom.querySelector("button")!.hidden,
      false,
      "…while the DOM-backed one IS revealed, which is what makes the difference measurable",
    );
    // The difference the reveal makes is to the BUTTON and to nothing else.
    for (const wrap of [plain, dom]) {
      assert.equal(wrap.hidden, false);
      assert.equal(wrap.querySelector(".compact-bound-count")!.hidden, false);
      assert.match(wrap.querySelector(".compact-bound-count")!.textContent, /are not rendered above/);
    }
  } finally {
    restore();
  }
});

test("SL-R10 (d): an island that returns early cannot take the bound with it", async () => {
  /* State (d) — the one `<noscript>` does not cover, and the one this
     repository has actually shipped: F1 records the feed island returning
     before it fetched anything because the page had lost an id, with scripting
     enabled the whole time and invisible to every test for a review cycle.

     Simulated the way it really happened: the root the island requires is
     absent, so `initCongressSections` returns before it binds anything. The
     bound must be exactly as the server published it. */
  const { installDom } = await import("./lib/mini-dom.ts");
  const { initCongressSections } = await import("../src/scripts/congress-sections.ts");

  const section = (await boundedSurfaces()).find((s) => s.name === "congress ranking (members)")!.html;
  // No `#congress-page`: the island finds nothing to bind and returns early.
  const { doc, restore } = installDom(`<main class="shell page">${section}</main>`);
  try {
    initCongressSections();
    const bound = doc.querySelector(".compact-bound-count");
    assert.ok(bound, "the statement is in the server's bytes, not produced by the island");
    assert.equal(bound!.hidden, false, "an island that never ran cannot retract it");
    assert.match(bound!.textContent, /further ranked members are not rendered above/);
  } finally {
    restore();
  }
});

test("SL-R10: the terminus inventory partitions EXACTLY — five deleted, eight kept, updater gone", async () => {
  /* The DoD gate. Measured in this tree rather than remembered: `terminusRow`
     has 13 production call sites, the five beside a `compactDisclosure` are
     gone, the eight standalone ones stand, `terminusRow` itself stays, and
     `syncTerminusFor` has no callers and no definition. */
  const files = {
    "../src/lib/ui.ts": 5,
    "../src/lib/activity.ts": 1,
    "../src/lib/holdings.ts": 2,
    "../src/pages/institutional/index.astro": 0,
  } as const;
  let total = 0;
  for (const [f, want] of Object.entries(files)) {
    const src = readFileSync(new URL(f, import.meta.url), "utf8");
    const calls = (src.match(/terminusRow\(\{/g) ?? []).length;
    assert.equal(calls, want, `${f}: ${calls} terminusRow call sites, expected ${want}`);
    total += calls;
    assert.ok(!/syncTerminusFor/.test(src.replace(/\/\*[\s\S]*?\*\//g, "")), `${f} still calls syncTerminusFor`);
  }
  assert.equal(total, 8, "eight standalone terminus rows are KEPT — R10 deletes only the five duplicates");

  const fmt = readFileSync(new URL("../src/lib/format.ts", import.meta.url), "utf8");
  assert.match(fmt, /export function terminusRow\(/, "the primitive itself stays");
  assert.ok(
    !/export function syncTerminusFor/.test(fmt),
    "its client updater loses all three callers with the five deletions and is deleted",
  );
  assert.match(fmt, /export function syncCompactDisclosure\(/, "one updater, beside the renderer it serves");
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


/* ── CODE-REVIEW F2 ──────────────────────────────────────────────────────────
   The sweep above proves the EMPTY corpus case, which `rankingAlternatives`
   would satisfy no matter which length it counted: an empty rollup has
   `rows.length === 0` AND `ranked.length === 0`, so reverting the fix leaves
   it green. The fixture that can tell the two apart is a rollup that is
   NON-EMPTY and entirely UNRANKABLE — rows whose amounts are wholly
   undisclosed, which `rankNetRows` moves into the undisclosed bucket with its
   own root, unreachable by any sort of the ranked table (Constraint 4).

   Counting `rows.length` there makes the empty-window block offer a switch
   that resolves to another empty ranked table: it spends the reader's trust as
   well as their click, which R14 forbids. Both kinds are covered because the
   two rollups group differently — tickers by `ticker`, leaders by
   `bioguide` — so a fix applied to one derivation is not evidence about the
   other. */

/** A transaction whose amount is wholly undisclosed and whose two dates are
    BOTH the window end, so it is inside every range on both bases. It is
    therefore in every alternative rollup and rankable in none of them. */
function undisclosedTxn(over: Partial<TxnRow> = {}): TxnRow {
  return {
    kind: "txn",
    txnId: "u-1",
    asset: null,
    assetType: null,
    filed: "2026-08-23",
    traded: "2026-08-23",
    name: "Undisclosed Member",
    bioguide: "U000001",
    party: "R",
    state: "OK",
    district: null,
    chamber: "senate",
    ticker: "UND",
    side: "purchase",
    owner: "self",
    low: null,
    high: null,
    lag: 0,
    late: 0,
    flags: [],
    doc: "https://example.invalid/doc",
    ...over,
  };
}

test("SL-R14 F2: an alternative that is NON-EMPTY but wholly unrankable counts 0, on BOTH kinds", async () => {
  const { rankingAlternatives, CONGRESS_RANGES, emptyWindowHtml } = await import("../src/lib/ui.ts");
  const { congressTickersRollup, leadersRollup } = await import("../src/lib/derive.ts");

  // Two members, two tickers — so neither rollup is a single-group special
  // case — and every row wholly undisclosed.
  const rows: TxnRow[] = [
    undisclosedTxn({ txnId: "u-1", ticker: "UND", bioguide: "U000001", name: "A" }),
    undisclosedTxn({ txnId: "u-2", ticker: "DER", bioguide: "U000002", name: "B" }),
  ];

  // The fixture's own premise, asserted rather than assumed: the rollups DO
  // hold rows. If this ever stops being true the test below degrades silently
  // into the empty-corpus case it was written to replace.
  for (const range of CONGRESS_RANGES) {
    for (const basis of ["traded", "filed"] as const) {
      assert.equal(
        congressTickersRollup(rows, "2026-08-23", { range, basis }).rows.length,
        2,
        `tickers rollup is non-empty at ${range}/${basis}`,
      );
      assert.equal(
        leadersRollup(rows, "2026-08-23", { range, basis }).rows.length,
        2,
        `leaders rollup is non-empty at ${range}/${basis}`,
      );
    }
  }

  for (const range of CONGRESS_RANGES) {
    for (const basis of ["traded", "filed"] as const) {
      for (const kind of ["tickers", "leaders"] as const) {
        const alt = rankingAlternatives(rows, "2026-08-23", kind, range, basis);
        assert.equal(
          alt.otherBasis,
          0,
          `${kind} ${range}/${basis}: two rollup rows, ZERO of them able to enter the ranked table`,
        );
        if (alt.wider !== null) {
          assert.equal(alt.wider.n, 0, `${kind} ${range}/${basis}: the wider range is unrankable too`);
        }
        // …and therefore no control is offered. This is the reader-visible
        // consequence, and the assertion a `rows.length` revert fails.
        const html = emptyWindowHtml(range, basis, alt, kind === "tickers" ? "tickers" : "members");
        assert.doesNotMatch(
          html,
          /<button/,
          `${kind} ${range}/${basis}: an offer that resolves to another empty table is never rendered`,
        );
        assert.match(html, /on either basis/, "the block states the doubly-empty fact instead");
      }
    }
  }
});

test("SL-R14 F2: the same fixture WITH one rankable row does offer the switch — the fixture is not inert", async () => {
  const { rankingAlternatives, emptyWindowHtml } = await import("../src/lib/ui.ts");
  // A control: one disclosed row, filed inside the window but traded outside
  // it, so the `filed` basis can rank it and the `traded` basis cannot. If the
  // negative test above passed because the fixture reaches nothing at all,
  // this one fails.
  const rows: TxnRow[] = [
    undisclosedTxn({ txnId: "u-1", ticker: "UND", bioguide: "U000001", name: "A" }),
    undisclosedTxn({
      txnId: "d-1",
      ticker: "DIS",
      bioguide: "D000001",
      name: "C",
      traded: "2020-01-01",
      filed: "2026-08-23",
      low: 1001,
      high: 15000,
    }),
  ];
  const alt = rankingAlternatives(rows, "2026-08-23", "tickers", "7d", "traded");
  assert.equal(alt.otherBasis, 1, "exactly the ONE disclosed row is rankable on the filing basis");
  const html = emptyWindowHtml("7d", "traded", alt, "tickers");
  assert.match(html, /data-basis="filed"[^>]*>1 by filing date/, "and it IS offered");
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

/* ------------------------------------------------------------- SL-R28 */

test("SL-R28: every surface that passes a note scope calls initNotes(), and Base.astro does not", () => {
  /* The gap this catches is the one R28 names: `notes.ts` can exist, be
     correct, be unit-tested, and be called by NO page — in which case every
     note on the site loses placement, hover, Escape and outside-click while
     every test stays green. It was exactly that state when T3–T9 landed their
     notes, which is why this assertion exists at all. */
  const surfaces = [
    "../src/pages/congress/index.astro",
    "../src/pages/institutional/index.astro",
    "../src/pages/congress/members/[bioguide].astro",
    "../src/pages/institutional/filers/[cik].astro",
    "../src/pages/institutional/tickers/[t]/holders.astro",
  ];
  for (const f of surfaces) {
    const src = readFileSync(new URL(f, import.meta.url), "utf8");
    assert.match(src, /import \{ initNotes \}/, `${f} imports initNotes`);
    assert.match(src, /^\s*initNotes\(\);/m, `${f} calls it`);
  }
  // NOT in Base.astro: that would load the module on every page in the site,
  // including the six this run does not touch, for no benefit.
  const base = readFileSync(new URL("../src/layouts/Base.astro", import.meta.url), "utf8");
  assert.ok(!base.includes("initNotes"), "Base.astro must not load it site-wide");
});

/* ── CODE-REVIEW F3 ──────────────────────────────────────────────────────────
   This was a `readFileSync` of `feed-client.ts` asserting that the string
   `settled = false` appears inside `loadData()`. That is not the claim. The
   claim is that a reader who presses a control, fails, retries and fails again
   is told so BOTH times — and a source grep cannot distinguish a re-arm that
   runs from one that is unreachable, mis-ordered, or shadowed.

   So this drives the real `initFeed` over a stubbed FAILING fetch, presses the
   real "Try again" button `renderLoadFailure` renders, fails again, and
   asserts settlement happened on each attempt. The pending indicator is the
   REAL one: `initCongressSections`'s `feedSettled`, reading the real
   `#momentum-section-pending` element, driven by a real control click. */

const FEED_IDS = [
  "congress-feed", "feed-tbody", "feed", "feed-loading", "feed-empty",
  "feed-empty-detail", "feed-empty-suggestions", "filter-count-line",
  "pager-range", "feed-status", "filter-reset", "filter-reset-wrap",
  "pager-newer", "pager-older",
];

/** The congress page's own root plus the momentum section's pending node, so
    the consumer under test is the shipped one rather than a stand-in. */
const SECTION_IDS = ["congress-page", "momentum-section-pending"];

async function mountFeedAndSections() {
  const { makeDom, makeElement } = await import("./lib/fake-dom.ts");
  const rangeBtn = makeElement("btn-30d");
  rangeBtn.dataset = { range: "30d" };
  const basisBtn = makeElement("btn-filed");
  basisBtn.dataset = { basis: "filed" };
  const dom = makeDom([...FEED_IDS, ...SECTION_IDS], {
    "#momentum-controls [data-range]": [rangeBtn],
    "#momentum-controls [data-basis]": [basisBtn],
  });
  dom.elements.get("congress-feed")!.dataset = { txnCount: "1" };
  dom.elements.get("congress-page")!.dataset = {
    generatedAtDate: "2026-08-23",
    range: "12m",
    basis: "traded",
  };
  // The pending node ships hidden in the SSR bytes, exactly as `ui.ts` emits it.
  dom.elements.get("momentum-section-pending")!.setAttribute("hidden", "");

  const restore = dom.install(null, { fetchOk: false });
  const { initCongressSections } = await import("../src/scripts/congress-sections.ts");
  const sections = initCongressSections();
  const settlements: boolean[] = [];
  const { initFeed } = await import("../src/scripts/feed-client.ts");
  initFeed({
    onRows: sections.receiveRows,
    onSettled: (ok) => {
      settlements.push(ok);
      sections.feedSettled(ok);
    },
  });
  const pending = dom.elements.get("momentum-section-pending")!;
  return { dom, restore, settlements, pending, rangeBtn, basisBtn };
}

/** The retry control `renderLoadFailure` appends — found by its label, not by
    its index, so a second child cannot make this test press the wrong thing. */
function retryButton(dom: Awaited<ReturnType<typeof mountFeedAndSections>>["dom"]) {
  const kids = dom.elements.get("feed-empty-suggestions")!.children;
  const btn = kids.find((k) => k.textContent === "Try again");
  assert.ok(btn, "a failed load must render a Try again control");
  return btn!;
}

test("CODE-REVIEW F3: failure, retry, failure — BOTH attempts settle, and the indicator resolves each time", async () => {
  const { dom, restore, settlements, pending, rangeBtn } = await mountFeedAndSections();
  try {
    // A control pressed before the dataset arrives: the real handler paints the
    // button pressed and states that it is applying a window it has not shown.
    rangeBtn.click();
    assert.equal(pending.hidden, false, "the pending indicator is showing at click time");
    assert.match(pending.textContent, /^Applying /, "…and it says the selection is being applied");

    // ── attempt 1: the fetch fails ──────────────────────────────────────────
    await dom.flush();
    assert.deepEqual(settlements, [false], "the failure path settles, which `onRows` can never do");
    assert.doesNotMatch(
      pending.textContent,
      /^Applying /,
      "the false 'Applying …' claim is gone once the attempt has settled",
    );
    assert.match(
      pending.textContent,
      /could not be applied: the full dataset did not load/,
      "and it is replaced by WHY, not merely blanked",
    );

    // ── attempt 2: the reader presses Try again, and it fails again ─────────
    const fetchesBefore = dom.fetchCalls.length;
    rangeBtn.click(); // the reader re-states the selection…
    assert.match(pending.textContent, /^Applying /, "…which arms the indicator again");
    retryButton(dom).click();
    await dom.flush();

    assert.ok(dom.fetchCalls.length > fetchesBefore, "the retry actually refetched — the memoised promise was released");
    assert.deepEqual(
      settlements,
      [false, false],
      "the SECOND failure settles too; an initFeed-lifetime latch stops at one",
    );
    assert.doesNotMatch(
      pending.textContent,
      /^Applying /,
      "a reader who fails twice is not left sitting on 'Applying …' forever",
    );
  } finally {
    restore();
  }
});

test("CODE-REVIEW F3: on the SUCCESS path the indicator is cleared outright, not restated", async () => {
  const { makeDom, makeElement } = await import("./lib/fake-dom.ts");
  const { DATASET_VERSION, TXN_COLS, PAPER_COLS } = await import("../src/lib/format.ts");
  const rangeBtn = makeElement("btn-30d");
  rangeBtn.dataset = { range: "30d" };
  const dom = makeDom([...FEED_IDS, ...SECTION_IDS], {
    "#momentum-controls [data-range]": [rangeBtn],
  });
  dom.elements.get("congress-feed")!.dataset = { txnCount: "0" };
  dom.elements.get("congress-page")!.dataset = {
    generatedAtDate: "2026-08-23", range: "12m", basis: "traded",
  };
  dom.elements.get("momentum-section-pending")!.setAttribute("hidden", "");
  const restore = dom.install({
    dataset_version: DATASET_VERSION,
    txn_cols: [...TXN_COLS],
    paper_cols: [...PAPER_COLS],
    txns: [],
    paper: [],
  });
  try {
    const { initCongressSections } = await import("../src/scripts/congress-sections.ts");
    const sections = initCongressSections();
    const settlements: boolean[] = [];
    const { initFeed } = await import("../src/scripts/feed-client.ts");
    initFeed({
      onRows: sections.receiveRows,
      onSettled: (ok) => {
        settlements.push(ok);
        sections.feedSettled(ok);
      },
    });
    const pending = dom.elements.get("momentum-section-pending")!;
    rangeBtn.click();
    assert.equal(pending.hidden, false);
    await dom.flush();
    assert.deepEqual(settlements, [true], "a decoded dataset settles once, with ok = true");
    assert.equal(pending.hidden, true, "the rows are painted, so the indicator is HIDDEN, not restated");
    assert.equal(pending.textContent, "", "and carries no stale sentence");
  } finally {
    restore();
  }
});

test("CODE-REVIEW F7: the activity truncation notice never prints a raw provisional key", async () => {
  const { truncationNoticeHtml } = await import("../src/lib/activity.ts");
  const html = truncationNoticeHtml(
    {
      dropped_records: 12,
      boundary_sort_key: {
        cik: "0001067983",
        position_key: "sid:sec:prov:00076fbdb7a2ddaf78c0e89001ecf4f7",
        put_call: "CALL",
        ssh_prnamt_type: "SH",
        delta_value_usd: null,
        abs_delta_value_usd: null,
      },
    },
    4,
  ) as string;
  // The publication bound is honesty content and must survive verbatim.
  assert.match(html, /further records are not published here/);
  /* SL-R17 permits the raw key in exactly two channels — a note panel and a
     `data-` attribute — and forbids it as page prose. So strip the ALLOWED
     channels first, then assert on what a reader actually sees unaided. An
     assertion that simply banned the substring would have failed on a correct
     implementation, which is a test bug, not a finding. */
  const prose = html
    .replace(/<span class="note-pop"[^>]*>[\s\S]*?<\/span>/g, " ")
    .replace(/\sdata-[a-z-]+="[^"]*"/g, " ")
    .replace(/<[^>]*>/g, " ");
  assert.ok(
    !prose.includes("sid:sec:prov:"),
    "a provisional key must not render as visible prose on a surface this run owns",
  );
  // It stays reachable: a data- attribute and/or the chip's own note.
  assert.ok(html.includes("sid:sec:prov:"), "and it is still present in an allowed channel");
});
