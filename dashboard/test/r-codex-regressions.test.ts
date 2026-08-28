/* Regressions for the defects the external code review found.

   Each test fails if its defect returns. They are grouped here rather than
   scattered so the remediation round is auditable against the findings list. */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { baseStylesheet } from "./lib/styles.ts";
import path from "node:path";

import {
  boundAdds,
  closedPeriods,
  type AddsRow,
} from "../src/lib/inst-adds.ts";
import {
  CONGRESS_ROOTS,
  addsSectionHtml,
  congressRankingSection,
  entityTxnTable,
  type BuildStamps,
} from "../src/lib/ui/index.ts";
import type { RenderCtx, TxnRow } from "../src/lib/format.ts";
import { leadersRollup } from "../src/lib/derive.ts";
import { instIndexBodyHtml } from "../src/scripts/inst-index-client.ts";
import { buildInstIndexRow, type InstIndexRow } from "../src/lib/inst-index.ts";

const CTX: RenderCtx = { watched: new Set() };
const stamps: BuildStamps = {
  buildId: "b",
  generatedAt: "2026-08-12 00:00 UTC",
  generatedAtDate: "2026-08-12",
};

function txn(over: Partial<TxnRow> = {}): TxnRow {
  return {
    kind: "txn", txnId: "t", asset: null, assetType: null,
    filed: "2026-07-21", traded: "2026-08-01", name: "M", bioguide: "T000001",
    party: "R", state: "OK", district: null, chamber: "senate", ticker: "WMB",
    side: "purchase", owner: "self", low: 1001, high: 15000, lag: 27, late: 0,
    flags: [], doc: "https://efdsearch.senate.gov/x", ...over,
  };
}

/* ---------- F1: no renderer may emit a cell inside a cell ---------- */

/** Direct children of every `<tr>` in a fragment, by tag. */
function rowChildTags(html: string): string[] {
  const out: string[] = [];
  for (const m of html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/g)) {
    let depth = 0;
    for (const t of m[1]!.matchAll(/<(\/?)(td|th|div|span|a|button|sup|table)\b[^>]*?(\/?)>/g)) {
      const [, close, tag, selfClose] = t;
      if (close) { depth--; continue; }
      if (depth === 0) out.push(tag!.toLowerCase());
      if (!selfClose) depth++;
    }
  }
  return out;
}

test("F1: the entity detail tables emit no cell nested inside a cell", () => {
  // `dualDate` briefly returned its own <td> while callers still wrapped it,
  // producing <td><td>…</td></td> on the per-member and per-ticker pages —
  // which the plan lists as explicit NON-GOALS. A browser REPAIRS nested cells
  // by splitting them, so the column moved instead of the page erroring.
  for (const kind of ["member", "ticker"] as const) {
    const html = entityTxnTable([txn()], { kind, caption: "c", page: 0, ctx: CTX });
    const kids = [...new Set(rowChildTags(html))];
    assert.deepEqual(
      kids.filter((t) => t !== "td" && t !== "th"),
      [],
      `${kind} table emits a non-cell direct child of <tr>: ${kids.join(", ")}`,
    );
    assert.ok(!/<td[^>]*>\s*<td\b/.test(html), `${kind} table nests a <td> inside a <td>`);
  }
});

test("F1: no library renderer emits a nested cell anywhere in the tree", () => {
  // A grep-level backstop over the rendered corpus, so a NEW renderer with the
  // same mistake is caught without anyone remembering to add a test.
  const dir = path.resolve(import.meta.dirname, "..", "src", "lib");
  for (const f of readdirSync(dir).filter((n) => n.endsWith(".ts"))) {
    const src = readFileSync(path.join(dir, f), "latin1");
    assert.ok(
      !/<td[^>"']*>\$\{(dualDateCell|srcLinkCell)\(/.test(src),
      `${f} wraps a CELL renderer in another <td>`,
    );
  }
});

/* ---------- F5: a stated absence outlives the compact slice ---------- */

test("F5: the unrankable statement renders even when no unrankable row survives the slice", () => {
  const rows: TxnRow[] = [];
  for (let i = 0; i < 12; i++) {
    rows.push(txn({ txnId: `r${i}`, bioguide: `M${i}`, name: `M${i}`, low: 1001 + i, high: 9000 + i }));
  }
  // one member whose GROSS PURCHASES are wholly undisclosed but whose net is
  // rankable, so it lands in the per-column unrankable tail, not the bucket
  rows.push(txn({ txnId: "u", bioguide: "ZZZ", name: "Zed", low: null, high: null }));
  const html = congressRankingSection(
    "leaders",
    leadersRollup(rows, "2026-08-12", { range: "12m", basis: "traded" }),
    stamps,
    CTX,
    {
      rootId: CONGRESS_ROOTS.membersRanked,
      undisclosedRootId: CONGRESS_ROOTS.membersUndisclosed,
      heading: "Member net disclosed flow",
      sectionId: "members-section",
      compact: 3,
    },
  );
  assert.match(html, /Not rankable — amounts wholly undisclosed/,
    "the bucket's existence is stated regardless of the slice");
});

/* ---------- F10: bounding is done exactly once ---------- */

function addsRow(over: Partial<AddsRow> = {}): AddsRow {
  return {
    issuer_key: "entity:1", issuer_key_source: "entity", issuer_name: "I",
    manager_count: 1, new_position_count: 0, delta_value_usd: 100,
    delta_value_is_partial: false, top_adder_cik: 1, top_adder_name: "M", ...over,
  };
}

test("F10: the section states truncation from the payload it was GIVEN", () => {
  // The page bounds once and hands the result in. The renderer must not bound
  // again: a second pass sees no omitted rows and reports truncated:false,
  // which silently deleted the truncation notice from the no-JS view.
  const bounded = boundAdds(
    Array.from({ length: 5 }, (_, i) => addsRow({ issuer_key: `e${i}`, delta_value_usd: 100 - i })),
    { recordLimit: 3 },
  );
  assert.equal(bounded.truncated, true);
  const html = addsSectionHtml(
    {
      period: "2026-03-31",
      generated_at: "2026-08-12",
      rows: bounded.rows,
      truncated: bounded.truncated,
      truncation_boundary: bounded.truncation_boundary,
      ambiguous_identity_exclusion_count: 0,
    },
    { period: "2026-03-31", mode: "all", periods: ["2026-03-31"], buildId: "b" },
  );
  assert.match(html, /bounded by Public Filings/, "the truncation notice survives the render");
});

test("F12: the note container always exists, so a later period can gain a note", () => {
  const html = addsSectionHtml(
    {
      period: "2026-03-31", generated_at: "2026-08-12", rows: [addsRow()],
      truncated: false, truncation_boundary: null,
      ambiguous_identity_exclusion_count: 0,
    },
    { period: "2026-03-31", mode: "all", periods: ["2026-03-31"], buildId: "b" },
  );
  assert.match(html, /id="inst-adds-note"/,
    "an absent container cannot be filled by the client on a later selection");
});

/* ---------- F3: the leaderboard is sortable ---------- */

test("F3: every well-defined leaderboard column is sortable and the rest states why", () => {
  const html = addsSectionHtml(
    {
      period: "2026-03-31", generated_at: "2026-08-12", rows: [addsRow()],
      truncated: false, truncation_boundary: null, ambiguous_identity_exclusion_count: 0,
    },
    { period: "2026-03-31", mode: "all", periods: ["2026-03-31"], buildId: "b" },
  );
  for (const k of ["issuer", "managers", "new", "value", "adder"]) {
    assert.ok(html.includes(`data-adds-sort="${k}"`), `${k} must be sortable`);
  }
  /* RETARGETED by RUN SURFACES-LEGIBILITY (SL-R5/SL-R2b), same commit as the
     change that invalidated it. The property is UNCHANGED — an unsortable
     column must still state why it cannot be sorted — but the channel moved
     from a `.col-why` span to a note panel, which is reachable by touch,
     keyboard and print as the span was not. Asserting the TEXT, not the
     wrapper, is what keeps this a guard rather than a spelling check. */
  assert.match(html, /class="note-pop"[^>]*>the rank number is produced by the active sort/);
});

/* ---------- F13/F14: one pipeline, displayed-name ordering ---------- */

function idxRow(over: Partial<Parameters<typeof buildInstIndexRow>[0]> = {}, typing = null as never) {
  return buildInstIndexRow(
    { cik: "0000000001", filer_name: "ZZZ FILED LLP", latest_period: "2026-03-31", ...over },
    { total_value_usd: 10, position_count: 1, null_value_positions: 0, hhi: 1 },
    "top",
    typing,
    { best: null, unrankable: 0 },
  );
}

test("F13: a chip still filters after a sort, because both go through one render", () => {
  const typed = idxRow({ cik: "0000000001" }, {
    cik: "0000000001", display_name: "Alpha Capital", person: null,
    manager_type: "hedge_fund", notable: true,
  } as never);
  const untyped = idxRow({ cik: "0000000002", filer_name: "BETA LLP" });
  const rows: InstIndexRow[] = [typed, untyped];
  const out = instIndexBodyHtml(rows, "", "name", "asc", {
    types: new Set(["hedge_fund"]),
    notableOnly: false,
  });
  assert.ok(out.html.includes("Alpha Capital"), "the typed hedge fund survives its chip");
  assert.ok(!out.html.includes("BETA LLP"), "the untyped filer is filtered out BY THE RENDER");
  assert.match(out.note, /1 of 2 managers/);
  assert.match(out.note, /1 filter active/);
});

test("F14: the Manager column orders and searches the name the reader SEES", () => {
  // The curated display name is rendered as primary; ordering on the filed name
  // ordered the column by text that is not the column.
  const zedDisplay = idxRow({ cik: "0000000001", filer_name: "AAA FILED LLP" }, {
    cik: "0000000001", display_name: "Zed Capital", person: "Zed Person",
    manager_type: "bank", notable: false,
  } as never);
  const midDisplay = idxRow({ cik: "0000000002", filer_name: "ZZZ FILED LLP" }, {
    cik: "0000000002", display_name: "Mid Capital", person: null,
    manager_type: "bank", notable: false,
  } as never);
  const asc = instIndexBodyHtml([zedDisplay, midDisplay], "", "name", "asc");
  assert.ok(
    asc.html.indexOf("Mid Capital") < asc.html.indexOf("Zed Capital"),
    "ordering follows the DISPLAYED name, not the filed one",
  );
  // and searching finds the person the row prints
  const byPerson = instIndexBodyHtml([zedDisplay, midDisplay], "zed person", "name", "asc");
  assert.ok(byPerson.html.includes("Zed Capital"), "the named person is searchable");
  const byCurated = instIndexBodyHtml([zedDisplay, midDisplay], "mid capital", "name", "asc");
  assert.ok(byCurated.html.includes("Mid Capital"), "the curated name is searchable");
});

/* ---------- F15: periods come from the corpus, not from activity ---------- */

test("F15: a closed quarter with no leaderboard activity is still selectable", () => {
  // Period cardinality must depend on the period EXISTING and being closed,
  // never on whether anything happened to be added in it.
  const corpus = ["2025-06-30", "2025-09-30", "2025-12-31"];
  assert.deepEqual(
    closedPeriods(corpus, "2026-08-12"),
    ["2025-12-31", "2025-09-30", "2025-06-30"],
  );
});

/* ---------- F4: the locked activity root exists ---------- */

test("F4: the institutional activity renderer names its locked root", () => {
  const src = readFileSync(
    path.resolve(import.meta.dirname, "..", "src", "lib", "activity.ts"),
    "latin1",
  );
  assert.match(src, /<tbody id="inst-activity-tbody"/,
    "R18 locks this root; an anonymous tbody cannot be scoped to or asserted on");
});

/* ---------- F6: the feed uses the SHARED sort plumbing ---------- */

test("F6: the feed routes sorting through initSortableTable, not its own handlers", () => {
  const src = readFileSync(
    path.resolve(import.meta.dirname, "..", "src", "scripts", "feed-client.ts"),
    "latin1",
  );
  assert.match(src, /initSortableTable\(/, "R5 names the shared plumbing explicitly");
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  assert.ok(
    !/setAttribute\(\s*["']aria-sort["']/.test(code),
    "a second aria-sort owner is a second sort state machine, free to drift",
  );
});

/* ================= cycle 2 findings ================= */

import {
  sortAddsRows,
  addsPayloadBytes,
  addsPayloadHref,
  ADDS_BYTE_LIMIT,
} from "../src/lib/inst-adds.ts";
import {
  activityFeedHtml,
  paginateActivity,
  type ActivityRecord,
  type FilingDictionary,
} from "../src/lib/activity.ts";

/** A minimal ordered feed with more rows than the compact bound, so the section
    renders both a terminus and a control and their ORDER is observable. */
function activityFixture() {
  const filings: FilingDictionary = {
    "1": {
      accession: "0000000000-26-000001", submission_type: "13F-HR",
      period_of_report: "2026-03-31", filed_date: "2026-05-10",
      doc_url: "https://www.sec.gov/Archives/1", source: "sec-edgar",
    },
  };
  const records: ActivityRecord[] = Array.from({ length: 30 }, (_, i) => ({
    cik: `000${String(1_000_000 + i)}`, filer_name: "FIXTURE HOLDINGS LLC",
    issuer_key: "entity:cik:0000320193", issuer_name: "APPLE INC",
    position_key: `sid:${String(i).padStart(6, "0")}`, put_call: "LONG",
    ssh_prnamt_type: "SH", change_kind: "add", curr_period: "2026-03-31",
    prev_period: "2025-12-31", prev_value_usd: 1_000, curr_value_usd: 3_000,
    delta_value_usd: 1_000_000 - i, prev_shares: 10, curr_shares: 30,
    delta_shares: 20, filing_keys: [1], prior_filing_keys: [],
    current_filing_keys: [], flags: [],
  }));
  return {
    present: true as const,
    reason: null,
    filings,
    pagination: paginateActivity(records, filings),
  };
}

test("F3: leaderboard comparators exist, are caller-owned, and sort NULLS LAST both ways", () => {
  const rows = [
    addsRow({ issuer_key: "a", delta_value_usd: 10 }),
    addsRow({ issuer_key: "n", delta_value_usd: null }),
    addsRow({ issuer_key: "b", delta_value_usd: 50 }),
  ];
  const desc = sortAddsRows(rows, "value", "desc").map((r) => r.issuer_key);
  const asc = sortAddsRows(rows, "value", "asc").map((r) => r.issuer_key);
  assert.deepEqual(desc, ["b", "a", "n"]);
  assert.deepEqual(asc, ["a", "b", "n"], "reversing must not promote an undisclosed row");
});

test("F3: the leaderboard headers are WIRED, not just marked up", () => {
  const src = readFileSync(
    path.resolve(import.meta.dirname, "..", "src", "scripts", "inst-index-client.ts"),
    "latin1",
  );
  assert.match(src, /\[data-adds-sort\]/, "the island binds the sort headers");
  assert.match(src, /sortAddsRows\(/, "and orders through the caller-owned comparator");
});

test("F11: the byte cap is measured against the REAL envelope, not a blank one", () => {
  // A blank envelope under-measures: substituting the actual period, date,
  // truncation flag and boundary pushed a boundary-sized payload over the cap.
  const envelope = {
    period: "2026-03-31",
    generated_at: "2026-08-22",
    truncated: true,
    truncation_boundary: [Number.MIN_SAFE_INTEGER, 0, ""] as [number, number, string],
    ambiguous_identity_exclusion_count: 12345,
  };
  const rows = Array.from({ length: 50 }, (_, i) => addsRow({ issuer_key: `entity:${i}` }));
  const out = boundAdds(rows, { byteLimit: 900, envelope });
  const actual = addsPayloadBytes({ ...envelope, rows: out.rows });
  assert.ok(actual <= 900, `bounded payload is ${actual} bytes, over its own cap`);
  assert.ok(ADDS_BYTE_LIMIT === 2 * 1024 * 1024, "the declared cap is unchanged");
});

test("F12: the section renders the live-status node its failure handler targets", () => {
  const html = addsSectionHtml(
    {
      period: "2026-03-31", generated_at: "2026-08-12", rows: [addsRow()],
      truncated: false, truncation_boundary: null, ambiguous_identity_exclusion_count: 0,
    },
    { period: "2026-03-31", mode: "all", periods: ["2026-03-31"], buildId: "b" },
  );
  assert.match(html, /id="inst-adds-status"[^>]*role="status"/,
    "a failure that reaches only the console is invisible to the reader");
  assert.match(html, /id="inst-adds-data"/, "and the rows travel so expansion needs no fetch");
});

test("F2: the activity feed keeps every row in the DOM and marks the extras", () => {
  // Slicing them away server-side with no client owner made them unreachable —
  // a disclosure that discloses nothing. Asserted at the SOURCE level, because
  // the feed's fixture shape is owned by activity.test.ts.
  const src = readFileSync(
    path.resolve(import.meta.dirname, "..", "src", "lib", "activity.ts"),
    "latin1",
  );
  assert.match(src, /data-compact-extra/, "rows past the slice are marked, not deleted");
  assert.ok(
    !/\.slice\(0, COMPACT_ROWS\)/.test(src),
    "a server-side slice with no client owner makes those rows unreachable",
  );
  assert.match(src, /domBacked: true/, "a DOM-backed disclosure owns them");
  assert.match(src, /id="inst-activity-tbody"/);
});

test("F16: the disclosure label is derived from the LIMIT, never the shown count", () => {
  const src = readFileSync(
    path.resolve(import.meta.dirname, "..", "src", "scripts", "congress-sections.ts"),
    "latin1",
  );
  /* SL-R10 retarget: the collapse label moved into `compactCollapseLabel`
     (`format.ts`), which composes it from COMPACT_ROWS — the LIMIT — for every
     owner at once. The property is unchanged and now holds in one place
     instead of three, so this asserts the island reaches the shared updater
     and that the updater derives the label from the limit. */
  assert.match(src, /syncCompactDisclosure\(/,
    "the island commits its label through the shared updater");
  assert.match(src, /const hidden = Math\.max\(0, total - limit\)/,
    "…and the count it passes is derived from the LIMIT, not from the shown rows");
  const fmt = readFileSync(
    path.resolve(import.meta.dirname, "..", "src", "lib", "format.ts"),
    "latin1",
  );
  assert.match(fmt, /export function compactCollapseLabel[\s\S]{0,200}Show only the first \$\{fmtInt\(COMPACT_ROWS\)\}/,
    "an expanded control must not promise to keep every row it is about to collapse");
});

test("F11: bounding accounts for the REAL boundary tuple, including a long issuer key", () => {
  // The reviewer's fixture: a long omitted issuer_key makes the response bigger
  // than a placeholder-measured bound predicted, so the endpoint threw instead
  // of keeping one fewer row.
  const long = "entity:" + "x".repeat(60);
  const rows = [
    addsRow({ issuer_key: "entity:a", delta_value_usd: 100 }),
    addsRow({ issuer_key: long, delta_value_usd: 50 }),
    addsRow({ issuer_key: long + "2", delta_value_usd: 10 }),
  ];
  const envelope = {
    period: "2026-03-31", generated_at: "2026-08-22", truncated: true,
    truncation_boundary: null, ambiguous_identity_exclusion_count: 0,
  };
  for (const cap of [300, 380, 420, 450, 500, 600]) {
    const out = boundAdds(rows, { byteLimit: cap, envelope });
    const actual = addsPayloadBytes({
      ...envelope,
      truncated: out.truncated,
      truncation_boundary: out.truncation_boundary,
      rows: out.rows,
    });
    assert.ok(
      out.rows.length === 0 || actual <= cap,
      `cap ${cap}: bounded to ${out.rows.length} rows but the real payload is ${actual} bytes`,
    );
  }
});

test("F16: a table with nothing hidden still renders an inert control shell", () => {
  // So a later state that DOES hide rows has something to reveal them with.
  const html = congressRankingSection(
    "tickers",
    leadersRollup([txn()], "2026-08-12", { range: "12m", basis: "traded" }),
    stamps,
    CTX,
    { rootId: CONGRESS_ROOTS.momentum, heading: "Ticker momentum", sectionId: "momentum-section" },
  );
  assert.match(html, /class="compact-disclosure"/, "the shell exists");
  assert.match(html, /data-compact-for="momentum-tbody"[^>]*hidden|hidden>/, "and starts hidden");
});

test("F3: text columns ascend A-to-Z and numeric columns descend largest-first", () => {
  const mk = (k: string, n: string, a: string, v: number) => ({
    ...addsRow({ issuer_key: k, issuer_name: n, top_adder_name: a }), delta_value_usd: v,
  });
  const rows = [mk("b", "Beta", "Zulu", 10), mk("a", "Alpha", "Able", 50)];
  assert.deepEqual(sortAddsRows(rows, "issuer", "asc").map((r) => r.issuer_name), ["Alpha", "Beta"]);
  assert.deepEqual(sortAddsRows(rows, "issuer", "desc").map((r) => r.issuer_name), ["Beta", "Alpha"]);
  assert.deepEqual(sortAddsRows(rows, "adder", "asc").map((r) => r.top_adder_name), ["Able", "Zulu"]);
  assert.deepEqual(sortAddsRows(rows, "value", "desc").map((r) => r.delta_value_usd), [50, 10]);
  assert.deepEqual(sortAddsRows(rows, "value", "asc").map((r) => r.delta_value_usd), [10, 50]);
});


test("F27: the adds island uses the SHARED sort plumbing, not a second one", () => {
  const src = readFileSync(
    path.resolve(import.meta.dirname, "..", "src", "scripts", "inst-index-client.ts"),
    "latin1",
  );
  assert.match(src, /initSortableTable\(/);
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  assert.ok(
    !/setAttribute\(\s*["']aria-sort["']/.test(code),
    "one owner of aria-sort — a second one already drifted once (F3)",
  );
});

test("F16: a table with nothing hidden still renders an inert TERMINUS shell", () => {
  const html = congressRankingSection(
    "tickers",
    leadersRollup([txn()], "2026-08-12", { range: "12m", basis: "traded" }),
    stamps,
    CTX,
    { rootId: CONGRESS_ROOTS.momentum, heading: "Ticker momentum", sectionId: "momentum-section" },
  );
  /* Both the button AND the sentence must exist so a later range change can
     reveal them together — one without the other is the omission itself.

     SL-R10 retarget: they now live in ONE element, which is what makes "one
     without the other" structurally impossible rather than merely asserted.
     The count clause is the inert shell here: present, empty, hidden. */
  assert.match(html, /<span class="compact-bound-count" hidden><\/span>/,
    "the sentence shell exists and starts empty and hidden");
  assert.match(html, /class="linklike compact-toggle"[^>]*hidden><\/button>/,
    "as does the control, which no reader is offered");
});

/* ================= cycle 3 findings ================= */

test("F1: every id the feed island REQUIRES exists on the real congress page", () => {
  // The island silently returned on the real page because it required an id
  // the page had lost. The fake DOM hands out any id it is asked for, so no
  // unit test could see it. This reads the ACTUAL page source instead.
  const page = readFileSync(
    path.resolve(import.meta.dirname, "..", "src", "pages", "congress", "index.astro"),
    "latin1",
  );
  const island = readFileSync(
    path.resolve(import.meta.dirname, "..", "src", "scripts", "feed-client.ts"),
    "latin1",
  );
  // The ids inside the early-return guard are the REQUIRED ones.
  const guard = island.slice(island.indexOf("if (!rootEl"), island.indexOf("return;", island.indexOf("if (!rootEl")));
  const required = ["rootEl", "bodyEl", "countEl", "rangeEl"];
  const idFor: Record<string, string> = {
    rootEl: "congress-feed",
    bodyEl: "feed-tbody",
    countEl: "filter-count-line",
    rangeEl: "pager-range",
  };
  for (const name of required) {
    assert.ok(guard.includes(name), `${name} is expected in the guard`);
    assert.ok(
      page.includes(`id="${idFor[name]}"`),
      `the island requires #${idFor[name]} but the congress page does not render it — ` +
        `the island would return before fetching anything`,
    );
  }
});

test("F4: the feed's table header FOLDS by clipping, never by display:none", () => {
  // It carries every column name and every stated unsortable reason. Removing
  // it from layout removes all of that from the accessibility tree.
  const css = baseStylesheet();
  const narrow = css.slice(css.indexOf("@media (max-width: 1080px)"));
  const rule = narrow.slice(narrow.indexOf(".feed-head"), narrow.indexOf("}", narrow.indexOf(".feed-head")));
  assert.ok(!/display:\s*none/.test(rule), "the real <thead> must not be display:none'd");
  assert.ok(/clip:/.test(rule), "it folds through the sanctioned clip pattern");
});

/* ================= cycle 3, round 1 findings ================= */

test("F2: the activity feed's COLLAPSED state is server-rendered, not JS-only", () => {
  // `data-collapsed` was set by `initDomDisclosures`, so the emitted page showed
  // every shard row visibly and only became compact once JavaScript ran. The
  // initial and no-JS page was the one view of this table that ignored R7.
  const src = readFileSync(
    path.resolve(import.meta.dirname, "..", "src", "lib", "activity.ts"),
    "latin1",
  );
  assert.match(
    src,
    /<tbody id="inst-activity-tbody"\$\{collapsed \? ' data-collapsed="true"' : ""\}>/,
    "the collapsed state must travel in the SSR bytes",
  );
  /* And the no-JS reader keeps a route to the rows below the slice: with
     scripting off the expand button cannot appear at all.

     SL-R10 retarget: the link moved from the terminus row's collapsed-only
     clause into the control's state-independent remainder, so it now survives
     an EXPANSION too — the strictly stronger property. The assertion follows
     it, and reads the emitted markup rather than the source template. */
  assert.match(src, /<a href="\$\{esc\(firstShard\)\}">Read the first shard<\/a>/);
  const feedHtml = activityFeedHtml(activityFixture(), { rowLimit: 50 });
  const boundP = feedHtml.slice(feedHtml.indexOf('<p class="compact-bound">'));
  const extra = boundP.slice(boundP.indexOf('<span class="compact-bound-extra">'), boundP.indexOf("</p>"));
  assert.match(extra, /<a href="\/institutional\/data\/activity\/0\.v1\.json">/,
    "the shard link is in the clause no state change can retract");
});

test("F3: the directory applies ONE compact budget across ranked and unranked rows", () => {
  // The page sliced the ranked rows and then appended EVERY unranked row after
  // them, outside the budget: 10 announced, 10 + |unranked| rendered.
  const ranked = Array.from({ length: 6 }, (_, i) =>
    idxRow({ cik: `000000000${i}`, filer_name: `R${i}` }),
  );
  // rows with no value for the active sort key land in the unranked bucket
  const unranked = Array.from({ length: 20 }, (_, i) =>
    buildInstIndexRow(
      { cik: `000000${100 + i}`, filer_name: `U${i}`, latest_period: "2026-03-31" },
      { total_value_usd: null, position_count: 1, null_value_positions: 1, hhi: null },
      "top",
      null as never,
      { best: null, unrankable: 0 },
    ),
  );
  const out = instIndexBodyHtml([...ranked, ...unranked], "", "value", "desc", undefined, 10);
  const allRows = (out.html.match(/<tr\b/g) ?? []).length;
  const separators = (out.html.match(/<tr class="unranked-sep"/g) ?? []).length;
  const rendered = allRows - separators;
  assert.equal(out.total, 26);
  assert.equal(out.shown, 10, "the disclosure must report what was actually rendered");
  assert.equal(rendered, 10, "one budget, applied across BOTH buckets");
  // and the bucket is still stated even though only 4 of its 20 rows fit
  assert.match(out.html, /20 filers have no value for the active sort key/);
});

test("F3: the SSR page renders the directory through that one renderer", () => {
  // Asserted against the ACTUAL page source: the defect was that the page had
  // its own second renderer, and only the island's was correct.
  const page = readFileSync(
    path.resolve(import.meta.dirname, "..", "src", "pages", "institutional", "index.astro"),
    "latin1",
  );
  assert.match(page, /instIndexBodyHtml\(indexRows, "", "value", "desc", undefined, COMPACT_ROWS\)/);
  assert.ok(
    !/ranked\.slice\(0, COMPACT_ROWS\)/.test(page),
    "a second budget on this page is the defect itself",
  );
  assert.ok(
    !/unranked\.map\(/.test(page),
    "appending the unranked bucket outside the budget is the defect itself",
  );
});

test("F5: the leaderboard's no-JS text states its bound and routes to the full payload", () => {
  const rows = Array.from({ length: 25 }, (_, i) =>
    addsRow({ issuer_key: `e${i}`, delta_value_usd: 1000 - i }),
  );
  const html = addsSectionHtml(
    {
      period: "2026-03-31", generated_at: "2026-08-12", rows,
      truncated: false, truncation_boundary: null, ambiguous_identity_exclusion_count: 0,
    },
    { period: "2026-03-31", mode: "all", periods: ["2026-03-31"], buildId: "b" },
  );
  // The old sentence claimed "the quarter shown above is rendered in full
  // below" while the renderer sliced to ten — a direct falsehood to a reader
  // with scripting off.
  assert.ok(
    !html.includes("is rendered in full below"),
    "a completeness claim the renderer contradicts",
  );
  const noscript = html.slice(html.indexOf("<noscript>"), html.indexOf("</noscript>"));
  assert.match(noscript, /compact slice of this quarter — not the whole of it/);
  assert.match(noscript, /href="\/institutional\/data\/adds\/2026-03-31\.all\.v1\.json"/);
});

test("F6: the leaderboard and the directory carry a NAMED terminus beside the control", () => {
  const rows = Array.from({ length: 25 }, (_, i) =>
    addsRow({ issuer_key: `e${i}`, delta_value_usd: 1000 - i }),
  );
  const html = addsSectionHtml(
    {
      period: "2026-03-31", generated_at: "2026-08-12", rows,
      truncated: false, truncation_boundary: null, ambiguous_identity_exclusion_count: 0,
    },
    { period: "2026-03-31", mode: "all", periods: ["2026-03-31"], buildId: "b" },
  );
  /* R19's locked list: the bound and its NAMED author, beside every compact
     table. Both surfaces held rows back with no such statement.

     SL-R10 retarget: the statement is no longer a separate `terminusRow` above
     the control — it is the control's own first child, and it is VISIBLE from
     the server where the row's duplicate of it was. The author is named by the
     sentence ("a Public Filings render bound"), not by a `data-terminus-author`
     wrapper, so the assertion follows the text. */
  assert.match(html, /15 further issuers are not rendered above/);
  assert.match(html, /a Public Filings render bound, not a data bound/);
  // it precedes the button, which is what puts the STATED bound in front of the
  // reader before the offer to lift it
  assert.ok(
    html.indexOf('class="compact-bound"') < html.indexOf("compact-toggle"),
    "the statement must precede the control it belongs to",
  );
  assert.ok(
    !/<p class="compact-bound"[^>]*hidden/.test(html),
    "…and it is not hidden: nothing but a script reveals the button beside it",
  );

  const page = readFileSync(
    path.resolve(import.meta.dirname, "..", "src", "pages", "institutional", "index.astro"),
    "latin1",
  );
  assert.match(page, /compactDisclosure\(\{[\s\S]{0,400}Every filer in this build has its own page/,
    "the directory states its bound too, and keeps the fact its terminus carried");
});

test("F6: a table with nothing held back still renders the terminus SHELL", () => {
  // So a quarter with more issuers can reveal the sentence and the button
  // together — the F16 rule, applied to the two tables that lacked it.
  const html = addsSectionHtml(
    {
      period: "2026-03-31", generated_at: "2026-08-12", rows: [addsRow()],
      truncated: false, truncation_boundary: null, ambiguous_identity_exclusion_count: 0,
    },
    { period: "2026-03-31", mode: "all", periods: ["2026-03-31"], buildId: "b" },
  );
  assert.match(html, /<span class="compact-bound-count" hidden><\/span>/, "the sentence shell");
  assert.match(html, /class="linklike compact-toggle"[^>]*hidden><\/button>/, "and the button shell");
  /* SL-R10: the WRAPPER stays visible, because it also carries the link to this
     quarter's published payload — a fact that is true whether or not rows are
     held back, and one the deleted terminus row used to carry. */
  assert.match(html, /the published JSON<\/a>/, "the payload link is stated in every state");
});

test("F6: every client owner of a compact table syncs its terminus through ONE helper", () => {
  /* Three private copies of the update is three chances for one to drift out of
     step with the renderer. SL-R10: the helper is now `syncCompactDisclosure`,
     which lives beside `compactDisclosure` — the sentence moved INTO the
     control, so its updater moved with it. `syncTerminusFor` is gone, and its
     absence is asserted so a caller cannot be left pointing at it. */
  for (const f of ["congress-sections.ts", "inst-index-client.ts"]) {
    const src = readFileSync(
      path.resolve(import.meta.dirname, "..", "src", "scripts", f),
      "latin1",
    );
    assert.match(src, /syncCompactDisclosure\(/, `${f} must use the shared disclosure updater`);
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    assert.ok(
      !/syncTerminusFor/.test(code),
      `${f} calls a helper this run deleted`,
    );
    assert.ok(
      !/querySelector\(["']\.compact-bound/.test(code),
      `${f} re-implements the bound lookup instead of using the shared one`,
    );
  }
  const fmt = readFileSync(
    path.resolve(import.meta.dirname, "..", "src", "lib", "format.ts"),
    "latin1",
  );
  const fmtCode = fmt.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  assert.ok(!/syncTerminusFor/.test(fmtCode), "the retired updater is gone from the tree");
});

/* ================= cycle 3, round 2 findings ================= */

test("F14: the adds endpoint path has exactly ONE builder, and every consumer uses it", () => {
  // `addsPayloadHref` was introduced for F5's no-JS link, and Dev Notes claimed
  // it was the single authority — while the island's fetch still carried its own
  // template. The F5 test passed because it only ever checked the LINK, so the
  // claim was false and no test could see it. This one reads both consumers.
  assert.equal(addsPayloadHref("2026-03-31", "all"), "/institutional/data/adds/2026-03-31.all.v1.json");
  assert.equal(addsPayloadHref("2026-03-31", "new"), "/institutional/data/adds/2026-03-31.new.v1.json");

  const ROUTE = /["'`][^"'`]*institutional\/data\/adds\//;
  // Slice 6 split ui.ts into src/lib/ui/*.ts; the whole directory is scanned.
  const uiFiles = readdirSync(path.resolve(import.meta.dirname, "..", "src", "lib", "ui"))
    .filter((n) => n.endsWith(".ts"))
    .map((n) => ["lib/ui", n] as const);
  for (const [dir, file] of [["scripts", "inst-index-client.ts"] as const, ...uiFiles]) {
    const src = readFileSync(
      path.resolve(import.meta.dirname, "..", "src", dir, file),
      "latin1",
    );
    // strip comments: this test is about CODE, and the finding itself is
    // described in a comment beside the fix
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    assert.ok(
      !ROUTE.test(code),
      `${file} builds the adds route itself instead of calling addsPayloadHref — ` +
        `two definitions of one path drift silently, and only one of them is tested`,
    );
  }
  // and the definition itself lives in exactly one module
  const lib = readFileSync(
    path.resolve(import.meta.dirname, "..", "src", "lib", "inst-adds.ts"),
    "latin1",
  );
  assert.match(lib, /export function addsPayloadHref/);
});

test("F15: the terminus precedes the control it describes, on every compact table", () => {
  /* The activity feed emitted its control FIRST and then a sentence telling the
     reader the control was "below" it.

     SL-R10 retarget: sentence and control are now one element, so the ordering
     is between siblings inside it and cannot be got wrong per table. The
     property — the reader meets the STATED bound before the offer to lift it —
     is asserted on every compact surface at once. */
  const surfaces = [
    activityFeedHtml(activityFixture(), { rowLimit: 50 }),
    addsSectionHtml(
      {
        period: "2026-03-31", generated_at: "2026-08-12",
        rows: Array.from({ length: 25 }, (_, i) => addsRow({ issuer_key: `e${i}`, delta_value_usd: 1000 - i })),
        truncated: false, truncation_boundary: null, ambiguous_identity_exclusion_count: 0,
      },
      { period: "2026-03-31", mode: "all", periods: ["2026-03-31"], buildId: "b" },
    ),
  ];
  for (const html of surfaces) {
    const bound = html.indexOf('<p class="compact-bound">');
    const control = html.indexOf("compact-toggle");
    assert.ok(bound >= 0 && control >= 0, "the section renders both");
    assert.ok(bound < control, "the stated bound must precede the offer to lift it");
  }
});
