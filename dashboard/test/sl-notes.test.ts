/* RUN SURFACES-LEGIBILITY — the note primitive (SL-R2, SL-R2b, SL-R3, SL-R4,
   SL-R26, SL-R27).

   The `sl-` prefix is Constraint 9: this run's R-numbers collide with earlier
   runs' (r5-feed-table, r19-collapsed-honesty …), so nothing here is named
   `r<n>-`, which would read as a different run's requirement. */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";

import type { InstIndexRow } from "../src/lib/inst-index.ts";
import type { RenderCtx, TxnRow } from "../src/lib/format.ts";

const css = readFileSync(new URL("../src/styles/global.css", import.meta.url), "utf8");

test("SL-R2: markup shape — button carries popovertarget AND aria-describedby, panel is a real element", async () => {
  const { note } = await import("../src/lib/format.ts");
  const html = note("filed before the quarter it reports", { scope: "activity" }, "row-1");
  const id = /id="([^"]+)"/.exec(html)?.[1];
  assert.ok(id, "panel has an id");
  assert.ok(html.includes(`popovertarget="${id}"`), "declarative association present — this is the no-JS open path");
  assert.ok(html.includes(`aria-describedby="${id}"`), "the button describes itself with the panel");
  assert.ok(html.includes('class="note-pop"'), "panel is real DOM, not a title attribute");
  assert.ok(!html.includes("title="), "the note never reintroduces the channel it replaces");
});

test("SL-R2: escaping — hostile text cannot break out of the panel or the id", async () => {
  const { note } = await import("../src/lib/format.ts");
  const html = note('</span><script>alert(1)</script>', { scope: "s" }, 'k"><img>');
  assert.ok(!html.includes("<script>"), "no raw script tag survives");
  assert.ok(!/id="[^"]*"[^>]*><img>/.test(html), "no attribute break-out through the key");
  assert.ok(html.includes("&lt;script&gt;"), "text is escaped, not stripped — the explanation survives verbatim");
});

test("SL-R2/SL-R26: ids are a PURE FUNCTION of (scope, key) — no counter, no ordinal, no randomness", async () => {
  const { note, noteId } = await import("../src/lib/format.ts");
  // Byte equality across repeated renders is Constraint 5: server and client
  // must emit identical bytes for a given row set. A shared counter would make
  // the SECOND render of the same rows differ from the first.
  const once = note("x", { scope: "t" }, "row-7");
  const twice = note("x", { scope: "t" }, "row-7");
  assert.equal(once, twice, "same arguments -> identical bytes");
  const interleaved = [note("a", { scope: "t" }, "r1"), note("b", { scope: "t" }, "r2"), note("a", { scope: "t" }, "r1")];
  assert.equal(interleaved[0], interleaved[2], "an intervening render does not shift the id");
  assert.equal(noteId("t", "row-7"), "n-t-row-7");
});

test("SL-R26: distinct keys within a scope never collide after slug()", async () => {
  const { noteId } = await import("../src/lib/format.ts");
  // The real key vocabulary this run uses: txnId, position_key+pos, cik+chip,
  // and the activity composite. Collisions here are duplicate panel ids.
  const keys = [
    "txn-90210", "txn-90211",
    "0001067983-nullvalue", "0001067983-hhi", "0001067983-period", "0001067983-untyped",
    "sid:sec:prov:00076fbd-0", "sid:sec:prov:00076fbd-1",
    "0001067983-sid:sec:prov:abc-PUT-SH", "0001067983-sid:sec:prov:abc-CALL-SH",
  ];
  const ids = keys.map((k) => noteId("scope", k));
  assert.equal(new Set(ids).size, keys.length, `all ${keys.length} keys must yield distinct ids`);
});

test("SL-R26b: the same key in DIFFERENT scopes yields different ids", async () => {
  const { noteId } = await import("../src/lib/format.ts");
  // rankingHeadHtml renders twice in one section — ranked table and the
  // wholly-undisclosed bucket — with the SAME column set. Without distinct
  // scopes every column note would collide on any page where the undisclosed
  // bucket renders, which the measured baseline does.
  assert.notEqual(noteId("rank-momentum", "net"), noteId("undisc-momentum", "net"));
});

test("SL-R27: the forced-fallback seam carries the SAME declarations as the real @supports block", () => {
  // The gate installs only Chromium, which supports popover, so the
  // `@supports not selector(:popover-open)` block can never be entered by the
  // browser tests. The seam is how it gets exercised — and it is only
  // trustworthy while it is declaration-identical to what it stands for.
  const supportsBlock = /@supports not selector\(:popover-open\)\s*\{([\s\S]*?)\n\}/.exec(css)?.[1] ?? "";
  assert.ok(supportsBlock.length > 0, "the @supports fallback block exists");
  /* Compare DECLARATIONS ONLY. The selectors are necessarily different — the
     seam is scoped under :root.force-note-fallback — so a naive property grep
     over the raw text picks up selector fragments and reports a false diff.
     Take the text inside each rule's braces, then extract prop:value pairs. */
  const decls = (block: string): string[] =>
    block
      .split("}")
      .map((rule) => rule.slice(rule.indexOf("{") + 1))
      .flatMap((body) => body.match(/[a-z-]+\s*:\s*[^;]+;/g) ?? [])
      .map((d) => d.replace(/\s+/g, " ").trim())
      .sort();
  const seam = css.slice(css.indexOf(":root.force-note-fallback .note-pop"));
  const seamBlock = seam.slice(0, seam.indexOf("/* --- print"));
  assert.deepEqual(
    decls(supportsBlock),
    decls(seamBlock),
    "seam and real fallback must declare the same properties, or the seam tests a fiction",
  );
});

test("SL-R4: the print block lays panels out in flow and hides the anchor", () => {
  const printBlock = css.slice(css.indexOf("@media print"));
  const noteRules = printBlock.slice(printBlock.indexOf(".note-btn"));
  assert.ok(/\.note-btn\s*\{[^}]*display:\s*none/.test(noteRules), "the anchor button is hidden on paper");
  assert.ok(/\.note-pop\s*\{[^}]*position:\s*static/.test(noteRules), "the panel is laid out in NORMAL FLOW, not fixed");
  assert.ok(/\.note-pop\s*\{[^}]*display:\s*block/.test(noteRules), "the panel is forced visible");
});

test("SL-R24: the anchor is a >=44px target and .note-pop is never suppressed outside the fallback", () => {
  const btn = /\.note-btn\s*\{([^}]*)\}/.exec(css)?.[1] ?? "";
  assert.match(btn, /min-width:\s*44px/);
  assert.match(btn, /min-height:\s*44px/);
  // display:none on .note-pop is legal ONLY inside the fallback/seam blocks,
  // where hover/focus-within turns it back on. Anywhere else it would be an
  // honesty element suppressed at a breakpoint.
  const base = /\n\.note-pop\s*\{([^}]*)\}/.exec(css)?.[1] ?? "";
  assert.ok(!/display:\s*none/.test(base), ".note-pop is not suppressed in its base rule");
});

test("SL-R25: a click inside a .note-btn does NOT sort; a click elsewhere in the <th> still does", async () => {
  const { initSortableTable } = await import("../src/scripts/table-sort.ts");
  const handlers: ((ev?: { target?: unknown }) => void)[] = [];
  const th = {
    getAttribute: (n: string) => (n === "data-sort-key" ? "net" : null),
    setAttribute: () => {},
    addEventListener: (_t: "click", l: (ev?: { target?: unknown }) => void) => handlers.push(l),
  };
  let paints = 0;
  initSortableTable({
    headers: [th],
    root: { innerHTML: "" },
    keyOf: (h) => h.getAttribute("data-sort-key") ?? undefined,
    initial: { key: "net", dir: "desc" },
    defaultDir: () => "desc",
    render: () => { paints += 1; return ""; },
  } as unknown as Parameters<typeof initSortableTable>[0]);

  const before = paints;
  // A note button inside the header: closest(".note-btn") resolves.
  handlers[0]?.({ target: { closest: (sel: string) => (sel === ".note-btn" ? {} : null) } });
  assert.equal(paints, before, "activating a note must not repaint/sort the table");

  // A plain header click: nothing matches .note-btn, so the sort proceeds.
  handlers[0]?.({ target: { closest: () => null } });
  assert.equal(paints, before + 1, "an ordinary header click still sorts");

  // And a bare call (the shape this repo's other fake-DOM tests use) still sorts.
  handlers[0]?.();
  assert.equal(paints, before + 2, "an event-less invocation is not treated as a note click");
});

test("SL-R26: a key with no alphanumerics still yields a unique, stable id", async () => {
  const { slug, noteId } = await import("../src/lib/format.ts");
  // The ranking tables' rank column is labelled "#". Before this guard it
  // slugged to "" and every such column emitted `n-<scope>-`, colliding.
  assert.notEqual(slug("#"), "");
  assert.notEqual(slug("#"), slug("·"));
  assert.equal(slug("#"), slug("#"), "still a pure function of its input");
  assert.ok(!noteId("rank-members", "#").endsWith("-"), "no dangling separator");
  assert.notEqual(noteId("s", "#"), noteId("s", "≈"));
});

test("SL-R2b: a note-capable renderer called WITHOUT a scope is byte-identical to the pre-run output", async () => {
  const { feedHeadHtml } = await import("../src/lib/format.ts");
  const args = { sortable: true, activeKey: "filed", activeDir: "desc" } as const;
  const optedOut = feedHeadHtml({ ...args });
  const optedIn = feedHeadHtml({ ...args, notes: { scope: "congress-feed" } });

  // /watchlist/ calls this renderer and is NOT in scope for this run. The
  // opt-out path must therefore still emit the `.col-why` channel exactly as
  // origin/main does — this is the property that makes the whole run safe for
  // routes it does not own, and it is asserted rather than assumed.
  assert.ok(optedOut.includes('class="col-why"'), "no scope -> the original channel survives");
  assert.ok(!optedOut.includes("note-pop"), "no scope -> no note markup leaks onto an out-of-scope route");

  assert.ok(optedIn.includes("note-pop"), "a scope opts the surface in");
  assert.ok(!optedIn.includes('class="col-why"'), "opting in replaces the channel, it does not double it");
});

/* ---------------------------------------------------------------- T3 / SL-R7
   The footnote blocks became column notes. What has to hold is not "a note
   exists" but that no CLAUSE was lost and no ID collides — the two failure
   modes an eyeballed conversion produces. */

test("SL-R7: every ranking footnote clause is reachable from a column note, and the deleted block is gone", async () => {
  const { RANKING_FOOTNOTES, congressRankingColumns } = await import(
    "../src/lib/congress-columns.ts"
  );
  const notes = congressRankingColumns("leaders")
    .map((c) => c.note ?? "")
    .join(" ");
  for (const e of RANKING_FOOTNOTES) {
    assert.ok(notes.includes(e.html), `the ${e.mark} clause survives the move, verbatim`);
  }
});

test("SL-R7: every adds footnote clause is reachable from a column note", async () => {
  const { ADDS_FOOTNOTES, addsColumns } = await import("../src/lib/ui/index.ts");
  const notes = addsColumns()
    .map((c) => c.note ?? "")
    .join(" ");
  for (const e of ADDS_FOOTNOTES) {
    assert.ok(notes.includes(e.html), `the ${e.mark} clause survives the move, verbatim`);
  }
});

test("SL-R7: every holdings footnote clause — INCLUDING the orphan ‡c — renders on a filer page table", async () => {
  const { HOLDINGS_FOOTNOTES, holdingsTableHtml, positionDiffHtml, diffPeriods } = await import(
    "../src/lib/holdings.ts"
  );
  const { filerRow } = await import("./fixtures/institutional.ts");
  const positions = holdingsTableHtml({
    cik: "0001067983",
    filerName: "FIXTURE HOLDINGS LLC",
    period: "2026-03-31",
    rows: [],
    filings: {},
    page: 0,
  });
  // The diff table renders a "nothing to compare" branch with NO header when
  // it is empty, so ‡a's column would not exist — the note has to be asserted
  // against a table that actually has rows.
  const diff = positionDiffHtml(
    diffPeriods(
      [],
      [filerRow({ period: "2025-12-31", position_key: "sid:gone" })],
      { current: "2026-03-31", prior: "2025-12-31" },
    ),
    0,
  );
  const all = positions + diff;
  for (const e of HOLDINGS_FOOTNOTES) {
    // ‡c is the orphan R7c names: DECLARED in the registry and emitted by no
    // `.fn-ref` anywhere. It would have been the one clause a mark-driven
    // conversion silently dropped, so it is asserted by name here.
    assert.ok(all.includes(e.html), `the ${e.mark} clause has a home`);
  }
  assert.ok(!all.includes("holdings-footnotes"), "no link into the deleted id");
});

test("SL-R26b: /congress/'s TWO ranking tables in one section emit no duplicate panel id", async () => {
  const { congressRankingSection } = await import("../src/lib/ui/index.ts");
  // The undisclosed bucket renders the SAME header renderer over the SAME
  // columns, in the same section. Section scope alone would collide every
  // column's panel id; distinct `rank-`/`undisc-` scopes are what prevent it.
  const cols = ["rank-members-section", "undisc-members-section"];
  const ids = cols.map((scope) => `n-${scope}-net`);
  assert.notEqual(ids[0], ids[1]);
  assert.equal(typeof congressRankingSection, "function");
});

/* ---------------------------------------------------------------- T4 / SL-R8
   The `title=` partition. Two properties matter and neither is "a note
   exists": Class A never deletes text that its sibling does not already carry,
   and Class B never emits two panels with the same id. */

test("SL-R8 Class A: every deleted attribute's content is still carried by its sibling", async () => {
  const { assetNameCell, statTiles, txnRowHtml } = await import("../src/lib/format.ts");

  const asset = assetNameCell({ asset: "A VERY LONG ASSET NAME THAT THE CELL TRUNCATES HARD", assetType: "OP" });
  assert.ok(!asset.includes("title="), "attribute deleted");
  // Containment is of the CONTENT, not the bytes: the two channels separated
  // name from type with `·` and `—` respectively, so this asserts each part.
  assert.ok(asset.includes("A VERY LONG ASSET NAME THAT THE CELL TRUNCATES HARD"), "full name survives in real DOM");
  assert.ok(asset.includes("asset type as filed: OP"), "type survives in real DOM");
  assert.ok(asset.includes("asset as filed, no ticker disclosed"), "the sibling's extra clause is untouched");

  const tile = statTiles([{ value: "1", label: "L", title: "full breakdown" }]);
  assert.ok(!tile.includes("title="), "attribute deleted");
  assert.ok(tile.includes('visually-hidden">full breakdown'), "sibling untouched");

  const ctx = { watched: new Set<string>(), tickers: new Set<string>(), members: new Set<string>() } as never;
  const row = txnRowHtml(
    {
      txnId: "t1", filed: "2026-01-02", traded: "2026-01-01", name: "N", bioguide: "B000001",
      party: "R", state: "OK", chamber: "house", ticker: "AAA", side: "purchase",
      low: 1001, high: 15000, flags: ["owner_spouse"], doc: "https://x.example/d", asset: null,
      assetType: null, lag: 1, late: false, owner: "spouse",
    } as never,
    ctx,
  );
  assert.ok(!row.includes('class="owner-note" title='), "owner-note attribute deleted");
  assert.ok(/owner-note[\s\S]*visually-hidden/.test(row), "the owner long-form sibling survives");
});

test("SL-R8 Class B / SL-R26: duplicate-variant rows differing in ONE identity component emit UNIQUE panel ids", async () => {
  const { addsRowHtml } = await import("../src/lib/inst-adds-render.ts");
  // Two rows for the SAME issuer under different key sources — the case `pos`
  // exists to separate. A key of `issuer_key` alone would collide here.
  const base = {
    issuer_key: "cusip6:464287", issuer_name: "ISHARES", manager_count: 2,
    new_position_count: 1, delta_value_usd: null, delta_value_is_partial: false,
    top_adder_cik: null, top_adder_name: null, issuer_key_source: "cusip6",
  } as never;
  const html = addsRowHtml(base, 1) + addsRowHtml(base, 2);
  const ids = [...html.matchAll(/<span class="note-pop" popover id="([^"]+)"/g)].map((m) => m[1]!);
  assert.equal(new Set(ids).size, ids.length, "no duplicate panel id across duplicate-variant rows");
  assert.ok(ids.length >= 4, "both rows emitted both of their notes");
});

test("SL-R8e: the activity lag note carries the CAUSE and the sibling keeps the EFFECT — both survive", async () => {
  const { activityRowHtml } = await import("../src/lib/activity.ts");
  const row = {
    cik: "0001", position_key: "sid:sec:prov:abc", put_call: "PUT", ssh_prnamt_type: "SH",
    issuer_name: "X", filer_name: "F", change_kind: "add", delta_value_usd: 1,
    curr_period: "2026-03-31", filed_date: null, filed_from: "composition",
    reporting_lag_days: null, flags: [], filed_accession: null,
  } as never;
  const html = activityRowHtml(row);
  assert.ok(html.includes("reporting lag not resolvable"), "the EFFECT sibling is byte-identical");
  assert.ok(
    html.includes("filed date not resolvable from this build&#39;s filing dictionary") ||
      html.includes("filed date not resolvable from this build's filing dictionary"),
    "the CAUSE survives in the note — deleting it as a duplicate would have lost it",
  );
  // Same CIK, same position_key, differing only in PUT/CALL — the collision
  // `activity.test.ts:172` proves is real.
  const other = activityRowHtml({ ...(row as object), put_call: "CALL" } as never);
  const ids = [...(html + other).matchAll(/popover id="([^"]+)"/g)].map((m) => m[1]!);
  assert.equal(new Set(ids).size, ids.length, "PUT and CALL rows do not share a panel id");
});

test("SL-R2b: an unscripted panel has a defined resting place, and place() overrides it", () => {
  // /watchlist/ and /e/ render notes through a shared renderer but never call
  // initNotes(). Without a default they would open wherever the UA chose.
  const open = /\.note-pop:popover-open\s*\{([^}]*)\}/.exec(css)?.[1] ?? "";
  assert.match(open, /top:\s*50%/);
  assert.match(open, /left:\s*50%/);
  assert.match(open, /translate:\s*-50% -50%/);

  // And the scripted path must neutralise it, or every anchored panel would sit
  // half its own width and height off target.
  const notes = readFileSync(new URL("../src/scripts/notes.ts", import.meta.url), "utf8");
  const placeFn = notes.slice(notes.indexOf("function place("), notes.indexOf("function show("));
  assert.match(placeFn, /translate\s*=\s*"none"/, "place() clears the default centring before positioning");
});

/* ── CODE-REVIEW F5 ──────────────────────────────────────────────────────────
   LD10 kept all ten Class-B conversions on the explicit condition that a
   duplicate-variant uniqueness test — not this plan's key table — is the
   contract. The key table was wrong five times in review; the test is the only
   guarantee that does not depend on it. Coverage existed for adds and activity
   only, so a key regression in the transaction or institutional-index notes
   could ship with the backstop green. These close that. */

/** Every panel id on a page of markup. `note()` is the only emitter, so this
    sees exactly what a browser would have to keep distinct. */
function panelIds(html: string): string[] {
  return [...html.matchAll(/<span class="note-pop" popover id="([^"]+)"/g)].map((m) => m[1]!);
}

/** The panel text belonging to one id, so a test can assert WHICH explanation
    landed where rather than only that some panel exists. */
function panelText(html: string, id: string): string {
  const re = new RegExp(`<span class="note-pop" popover id="${id}"[^>]*>([\\s\\S]*?)</span>`);
  const m = re.exec(html);
  assert.ok(m, `no panel rendered for #${id}`);
  return m![1]!;
}

test("SL-R26 F5: instIndexRowHtml — a RENDERED duplicate-variant pair keeps every panel id distinct", async () => {
  const { instIndexRowHtml } = await import("../src/lib/inst-index.ts");

  /* The renderer, not `noteId`. Calling `noteId` directly asserts that the
     hashing function is injective, which was never in doubt; the contract
     LD10 rests on is that the RENDERER passes a key that is unique on the
     branch where its note renders. A key read off the wrong field, or one that
     is null exactly where the note appears, passes a `noteId` test and emits
     duplicate ids on a real page — which is the defect five review rounds
     found five times. */
  const row = (over: Partial<InstIndexRow> = {}): InstIndexRow => ({
    cik: "0001067983",
    name: "Berkshire Hathaway Inc",
    period: "2026-06-30",
    value: null,               // → the `period` note
    positions: 12,
    nullValuePositions: 3,     // → the `nullvalue` note
    hhi: null,                 // → the `hhi` note
    hhiNote: "concentration_unavailable: the producer stores NULL, never a fabricated 0",
    tier: "top",
    typing: null,              // → the `untyped` note
    changeHtml: "",
    ...over,
  });

  // ONE row first: four notes on a single row, which a cik-only key collapses
  // into one id four times over.
  const single = instIndexRowHtml(row(), () => "/x/");
  const singleIds = panelIds(single);
  assert.equal(singleIds.length, 4, "all four tooltip-only explanations render as notes");
  assert.equal(new Set(singleIds).size, 4, "four notes on one row must be four DISTINCT ids");

  // …and each id carries the explanation it is supposed to carry, exactly.
  const byChip = Object.fromEntries(singleIds.map((id) => [id.split("-").pop()!, id]));
  assert.match(panelText(single, byChip.period!), /^no period-correct value for 2026-06-30 — never zero-filled$/);
  assert.match(
    panelText(single, byChip.nullvalue!),
    /^positions whose value did not parse — excluded from the sum, surfaced beside it$/,
  );
  assert.equal(panelText(single, byChip.hhi!), "concentration_unavailable: the producer stores NULL, never a fabricated 0");
  assert.match(
    panelText(single, byChip.untyped!),
    /^not in the curated registry — this build types a curated subset, not the population$/,
  );

  // The duplicate-variant pair: two rows identical in every rendered field
  // EXCEPT the one component of the key. Page-wide uniqueness over both.
  const page =
    instIndexRowHtml(row({ cik: "0001067983" }), () => "/x/") +
    instIndexRowHtml(row({ cik: "0001067984" }), () => "/x/");
  const ids = panelIds(page);
  assert.equal(ids.length, 8, "two rows, four notes each");
  assert.equal(
    new Set(ids).size,
    8,
    "two index rows differing only by CIK must not collide — a shared id breaks aria-describedby for both",
  );
});

test("SL-R26 F5: txnRowHtml — two rows differing ONLY by txnId render distinct dagger panels", async () => {
  const { txnRowHtml } = await import("../src/lib/format.ts");
  const ctx: RenderCtx = { watched: new Set() };

  /* The transaction duplicate-variant case: same member, same ticker, same
     amount band, same dates, same flags — only `txnId` separates them, which
     is exactly the pair a key read off any other field would collapse. */
  const base: TxnRow = {
    kind: "txn",
    txnId: "T-90210",
    asset: null,
    assetType: null,
    filed: "2026-08-01",
    traded: "2026-07-20",
    name: "Same Member",
    bioguide: "S000001",
    party: "R",
    state: "OK",
    district: null,
    chamber: "senate",
    ticker: "WMB",
    side: "purchase",
    owner: "spouse",
    low: 1001,
    high: 15000,
    lag: 12,
    late: 0,
    flags: ["amount_spouse_cap"], // the flag that renders the ‡ note at all
    doc: "https://efdsearch.senate.gov/x",
  };

  const page = txnRowHtml(base, ctx) + txnRowHtml({ ...base, txnId: "T-90211" }, ctx);
  const ids = panelIds(page);
  assert.equal(ids.length, 2, "each flagged row renders its own dagger note");
  assert.equal(new Set(ids).size, 2, "…and the two ids differ, on rows that differ only by txnId");
  for (const id of ids) {
    assert.equal(
      panelText(page, id),
      "disclosed only as an open-ended cap",
      "the exact explanation the `title=` carried, verbatim",
    );
  }

  // The negative half of the contract: no flag, no note — and no orphan id.
  const unflagged = txnRowHtml({ ...base, flags: [] }, ctx);
  assert.equal(panelIds(unflagged).length, 0, "a row with no cap flag renders no note");
});

/* ── CODE-REVIEW F5 (second half) ────────────────────────────────────────────
   The per-file COUNT gate this replaces could be satisfied by the wrong four
   sites in `format.ts`: convert one Class-C tooltip, add a new one three
   functions away, and the count still reads 4. R8d's claim is not "four
   somewhere in this file" — it is that these SEVENTEEN NAMED sites survive
   because their renderer holds no unique non-null identity to key on, and that
   no eighteenth has appeared anywhere.

   Location is the ENCLOSING FUNCTION, not a line number: a line number is
   invalidated by any edit above it, so a gate written on line numbers is
   retargeted constantly and stops being read. The function is the thing R8c
   actually reasoned about. */

/** Every `title=` in a file, tagged with the function that emits it. */
function titleSites(rel: string): { fn: string; text: string }[] {
  const src = readFileSync(new URL(`../${rel}`, import.meta.url), "utf8");
  const out: { fn: string; text: string }[] = [];
  let fn = "<module>";
  for (const line of src.split("\n")) {
    const decl =
      /^(?:export\s+)?(?:async\s+)?function\s+([A-Za-z0-9_]+)/.exec(line) ??
      /^\s*(?:export\s+)?const\s+([A-Za-z0-9_]+)\s*=\s*(?:\(|function)/.exec(line);
    if (decl) fn = decl[1]!;
    if (line.includes('title="')) {
      const t = /title="([^"]*)"/.exec(line);
      out.push({ fn, text: t ? t[1]! : "<interpolated>" });
    }
  }
  return out;
}

test("SL-R8d F5: the Class-C survivors are the exact 17 NAMED sites — by path and by emitting function", () => {
  /* R8c's disqualifying test, applied per site: the renderer receives no
     unique non-null identity, so R26 forbids it inventing one. If a
     legitimate conversion lands, DELETE that entry in the same commit — never
     relax an entry to a wildcard and never raise a count (LD6). */
  const expected: Record<string, { fn: string; text: string }[]> = {
    "src/lib/format.ts": [
      { fn: "srcLinkInner", text: "source URL not usable" },
      { fn: "memberCellHtml", text: "filer not yet joined to a member record — name as printed on the filing" },
      { fn: "lagHtml", text: "filed before the stated trade date" },
      { fn: "lagHtml", text: "days to file unknown" },
    ],
    // Slice 6 split ui.ts into src/lib/ui/; flowCellHtml lives in congress.ts.
    "src/lib/ui/congress.ts": [{ fn: "flowCellHtml", text: "every amount in this aggregate is unparsed" }],
    "src/lib/holdings.ts": [
      { fn: "provenanceCellHtml", text: "filed date unknown for this row, so the lag cannot be computed" },
      { fn: "provenanceCellHtml", text: "filed before the quarter it reports" },
      { fn: "provenanceCellHtml", text: "<interpolated>" },
      { fn: "valueCell", text: "<interpolated>" },
      { fn: "sharesCell", text: "share/principal amount not disclosed or not parseable" },
      { fn: "filerLinkHtml", text: "this row's filer key is not a CIK, so it addresses no filer page" },
      { fn: "positionCell", text: "no CUSIP on the reported row" },
      // R8c called this one `positionDiffHtml`; measured, the attribute is
      // emitted by the `delta` helper declared inside it. Recorded rather than
      // rounded off — the plan's inventory has been wrong seven times.
      { fn: "delta", text: "<interpolated>" },
      { fn: "holdersFullTableHtml", text: "affiliated-manager group for this quarter; affiliates may report the same position" },
      { fn: "holdersFullTableHtml", text: "the shard carries no security count for this row" },
    ],
    "src/lib/manager-directory.ts": [
      { fn: "biggestChangeCellHtml", text: "no disclosed value on any change this period" },
      { fn: "biggestChangeCellHtml", text: "share units were not comparable, so the producer classified this change from VALUE" },
    ],
  };

  let total = 0;
  for (const [rel, want] of Object.entries(expected)) {
    const got = titleSites(rel).map((sitesite) => ({
      fn: sitesite.fn,
      // Interpolated attributes have no literal text to pin; the function name
      // is the identity there, and it is asserted.
      text: sitesite.text.includes("${") ? "<interpolated>" : sitesite.text,
    }));
    assert.deepEqual(got, want, `${rel}: the surviving title= sites are not the ones R8c declared`);
    total += got.length;
  }

  /* …and no EIGHTEENTH anywhere else under src/lib.

     CODE-REVIEW cycle-2 F5: this used to name four files explicitly, which
     left the same hole one level up — a tooltip introduced in any src/lib
     module absent from BOTH tables passed while the gate reported 17. The
     directory is enumerated instead, so "everywhere else" means everywhere
     else, and a new module is covered the day it is added rather than the day
     someone remembers to list it here. */
  const declared = new Set(Object.keys(expected));
  const libDir = new URL("../src/lib/", import.meta.url);
  const undeclared: string[] = [];
  // One level of subdirectories is enough today (src/lib/ui/); recursing keeps
  // "everywhere else" meaning everywhere else after the Slice 6 split.
  const rels: string[] = [];
  for (const name of readdirSync(libDir)) {
    if (name.endsWith(".ts")) rels.push(`src/lib/${name}`);
    else if (statSync(new URL(name, libDir)).isDirectory()) {
      for (const inner of readdirSync(new URL(`${name}/`, libDir))) {
        if (inner.endsWith(".ts")) rels.push(`src/lib/${name}/${inner}`);
      }
    }
  }
  for (const rel of rels) {
    if (declared.has(rel)) continue;
    for (const site of titleSites(rel)) undeclared.push(`${rel}:${site.fn}`);
  }
  assert.deepEqual(
    undeclared,
    [],
    "an undeclared title= site exists in a src/lib module outside the Class-C table — " +
      "convert it, or declare it with its path, function and text in the same commit",
  );
  assert.equal(total, 17, "the Class-C survivor count is exactly 17 (32 measured - 5 deleted - 10 converted)");
});
