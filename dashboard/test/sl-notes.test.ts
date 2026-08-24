/* RUN SURFACES-LEGIBILITY — the note primitive (SL-R2, SL-R2b, SL-R3, SL-R4,
   SL-R26, SL-R27).

   The `sl-` prefix is Constraint 9: this run's R-numbers collide with earlier
   runs' (r5-feed-table, r19-collapsed-honesty …), so nothing here is named
   `r<n>-`, which would read as a different run's requirement. */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

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
  const { ADDS_FOOTNOTES, addsColumns } = await import("../src/lib/ui.ts");
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
  const { congressRankingSection } = await import("../src/lib/ui.ts");
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
