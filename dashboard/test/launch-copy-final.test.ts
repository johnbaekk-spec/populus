/* launch final copy pass (R29, R2, LD32): the copy items the area milestones
   left open — inst-04 (activity half), inst-06, inst-07, inst-08,
   signals-10, signals-11, signals-14, ticker-12, ticker-13 — each applied or
   adapted so that every honesty qualifier keeps a home. Each test asserts
   the shipped text, the replaced text gone, and the qualifier's home, with a
   control showing the check sees a qualifier that goes missing. The ledger
   entries (test/fixtures/launch-copy-ledger.json) carry the dispositions and
   reason codes; signals-02's pin is in signals-page.test.ts. */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  activityFeedHtml,
  activitySectionHtml,
  INSTITUTIONAL_DATA_NOTE_CLAUSES,
  paginateActivity,
  type ActivityFeed,
  type ActivityRecord,
  type FilingDictionary,
} from "../src/lib/activity.ts";
import { directoryColumns } from "../src/lib/inst-index.ts";
import { overlapBandHtml, type OverlapBand } from "../src/lib/overlap.ts";
import { moveRowHtml, namedMoveIds, signalsInstitutionalHtml } from "../src/lib/ui/signals-institutional.ts";
import { signalsBody, signalsOverlapHtml, tickerUnifiedBody } from "../src/lib/ui/index.ts";
import { buildTriage } from "../src/lib/signal-triage.ts";
import { loadTriageFixture } from "./lib/triage-fixture.ts";
import { domOf, visibleText } from "./lib/ledger-dom.ts";
import { fixtureInstitutional } from "./lib/inst-signals-fixture.ts";
import { fixtureOverlap } from "./lib/overlap-fixture.ts";
import type { MiniElement } from "./lib/mini-dom.ts";

const CTX = {};
const text = (el: MiniElement | null | undefined): string => (el ? visibleText(el) : "").replace(/\s+/g, " ").trim();
/** The text a reader can reach: tags out, entities decoded (tips included). */
const reach = (html: string): string =>
  html.replace(/<[^>]*>/g, " ").replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/\s+/g, " ");

/* ---------------------------------------------------------------- /institutional/ activity */

const FILINGS: FilingDictionary = {
  "1": { accession: "0000000000-26-000001", submission_type: "13F-HR", period_of_report: "2026-03-31", filed_date: "2026-05-10", doc_url: "https://www.sec.gov/Archives/1", source: "sec-edgar" },
};

function activity(): { feed: ActivityFeed; ciks: Set<string> } {
  const rec = (i: number): ActivityRecord => ({
    cik: `000000010${i % 6}`, filer_name: `Notable ${i % 6}`, issuer_key: `entity:${i}`, issuer_name: `ISSUER ${i}`, position_key: `sid:p${i}`, put_call: "LONG", ssh_prnamt_type: "SH",
    change_kind: i % 2 ? "add" : "trim", curr_period: "2026-03-31", prev_period: "2025-12-31", prev_value_usd: 10, curr_value_usd: 20 + i, delta_value_usd: 10 + i,
    prev_shares: 1, curr_shares: 2, delta_shares: 1, filing_keys: [1], prior_filing_keys: [], current_filing_keys: [], flags: [],
  });
  const records = Array.from({ length: 12 }, (_, i) => rec(i));
  const ciks = new Set(records.map((r) => r.cik));
  return { feed: { present: true, reason: null, filings: FILINGS, pagination: paginateActivity(records, FILINGS), records } as ActivityFeed, ciks };
}

/** Each qualifier the cut caveat line carried, and where it lives now. */
function activityQualifierProblems(section: string): string[] {
  const root = domOf(section);
  const kindTip = text(root.querySelector('.note-pop[id="n-inst-activity-kind"]'));
  const summary = text(root.querySelector("#inst-data-note summary"));
  const out: string[] = [];
  if (!/between two quarter-end snapshots/.test(kindTip)) out.push("Kind tip: between two quarter-end snapshots");
  if (!/not a record of transactions/.test(kindTip)) out.push("Kind tip: not a record of transactions");
  if (!/not current holdings/.test(summary)) out.push("13F box: not current holdings");
  return out;
}

test("inst-04 (activity half), inst-08: the static foot line and the QoQ caveat line are gone; each qualifier of the caveat has a home (control)", () => {
  const { feed, ciks } = activity();
  const section = activitySectionHtml(feed, { reference: true, notableCiks: ciks });
  assert.doesNotMatch(section, /Not shown: position weight/, "inst-04: a column removed by design gets no foot line");
  assert.doesNotMatch(section, /<p class="table-foot-reason">/);
  assert.doesNotMatch(section, /Quarter-over-quarter comparisons are between two quarter-end/, "inst-08: the caveat line merged");
  assert.deepEqual(activityQualifierProblems(section), []);
  // control: the Kind tip without the merged clause is caught
  const stripped = section.replace(" — not a record of transactions", "");
  assert.notEqual(stripped, section);
  assert.deepEqual(activityQualifierProblems(stripped), ["Kind tip: not a record of transactions"]);
  // the directory half of inst-04 stays: a column the DATA removes still says why (column-presence R2-6)
  const cut = directoryColumns([{ cik: "1", top5Share: 4200 } as never], 25);
  assert.match(cut.emptied[0]!.reason!, /^Not shown: the top-five share — this build's concentration slices hold the top 25 positions, not five\.$/);
});

test("inst-06, inst-07: the head meta is four words, its tip says what the rows are; the bound keeps the publication bound and the truncation link", () => {
  const { feed, ciks } = activity();
  const html = activityFeedHtml(feed, { reference: true, notableCiks: ciks });
  const root = domOf(html);
  const meta = text(root.querySelector(".panel-head .panel-note"));
  assert.equal(meta, "Notable managers · newest first");
  assert.equal(meta.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length, 4, "four words (the audit's rule: a token with a letter or digit)");
  const tip = text(root.querySelector(".panel-head .note-pop"));
  for (const q of ["New, added, trimmed and exited positions only", "at most two per manager", "newest filing first, then largest change", "each manager's full list is on its filer page"]) {
    assert.ok(tip.includes(q), `the meta's tip: ${q}`);
  }
  const extra = text(root.querySelector(".compact-bound-extra"));
  assert.match(extra, /^This build publishes all 12 of its changes, ranked by size of change with undisclosed values last, as 1 file of at most [\d,]+ changes or [\d,]+ bytes each\. Open the first file ↗ to reach every published change, with or without scripting\.$/);
  assert.match(text(root.querySelector(".compact-bound-count")), /^1–10 of the 12 newest changes by notable managers shown here$/, "the count still names its own bound");
  // control: the retired first sentence would be caught
  assert.match(reach(html + "<p>These rows are notable managers' new, added</p>"), /These rows are notable managers/);
  assert.doesNotMatch(reach(html), /These rows are notable managers/);
});

/* ---------------------------------------------------------------- signals-14: the 13F caveat box */

test("signals-14 (adapted): six clauses still render; the field name and the repeated staleness sentence are gone; the staleness qualifier stays", () => {
  assert.equal(INSTITUTIONAL_DATA_NOTE_CLAUSES.length, 6);
  const byId = new Map(INSTITUTIONAL_DATA_NOTE_CLAUSES.map((c) => [c.id, c.text]));
  assert.deepEqual([...byId.keys()], ["long-only", "snapshot-lag", "era-units", "affiliates", "confidential", "not-advice"], "clause ids unchanged");
  assert.equal(byId.get("snapshot-lag"), "Positions are quarter-end snapshots filed up to 45 days late — not current holdings: a position may have changed or closed since the quarter ended.");
  assert.equal(byId.get("affiliates"), "Affiliated managers may report the same position, so one position can appear under more than one filer.");
  const all = [...byId.values()].join(" ");
  assert.doesNotMatch(all, /\(otherManager\)|older still|before you ever see it/);
  // the qualifiers activity.test.ts pins against the producer survive here too (spot check; the full list is there)
  for (const q of ["so managers below that threshold are absent entirely", "unit_basis carried on every record", "ARCHITECTURE.md §5.2 / M2-CONTRACT §5"]) assert.ok(all.includes(q), q);
});

/* ---------------------------------------------------------------- ticker-12, ticker-13 */

function band(): OverlapBand {
  return {
    ticker: "NVDA",
    window: { start: "2026-04-01", end: "2026-06-29" },
    buyers: [],
    sellers: [],
    buyTotal: "—",
    sellTotal: "—",
    inst: { period: "2026-03-31", issuer: "NVIDIA CORP", adding: [{ cik: "0000000001", name: "Manager One", kind: "add", value_usd: 5_000_000, delta_shares: 10, filed_date: "2026-05-10" }], trimming: [], addingValue: 5_000_000, trimmingValue: 0 },
    timeline: [{ date: "2026-05-10", actor: "Manager One", href: "/f/1", move: "ADD", cls: "c-buy", side: "13f", kind: "add", amount: "$5.0M" }],
    instAbsence: null,
  };
}

test("ticker-12 (adapted): the meta that restated the heading is cut; ranges and the snapshot caveat stated once each; the kind words and $ in a tip; the filed issuer kept", () => {
  const html = overlapBandHtml(band(), CTX, (c) => `/f/${c}`);
  const root = domOf(html);
  assert.equal(root.querySelector(".panel-head .panel-note"), null, "no meta under the heading");
  assert.equal(text(root.querySelector(".overlap-congress .section-note")), "filed 2026-04-01 → 2026-06-29 · statutory ranges");
  const instNote = root.querySelector(".overlap-inst .section-note")!;
  assert.match(text(instNote), /^by shares · \$ = value held/);
  assert.equal(text(instNote.querySelector(".filed-name")), "NVIDIA CORP", "the issuer as filed stays");
  assert.equal(text(instNote.querySelector(".note-pop")), "NEW + ADD vs TRIM + EXIT, by share count. $ = reported value now, not the change.");
  assert.match(reach(html), /1 newest, by filing date · 13F rows are quarter-end snapshots, not trades/);
  for (const gone of ["who in Congress disclosed", "totals are statutory ranges", "every row dates by its filing date"]) assert.doesNotMatch(reach(html), new RegExp(gone), gone);
  assert.equal((reach(html).match(/statutory ranges/g) ?? []).length, 1, "ranges stated once");
  assert.equal((reach(html).match(/quarter-end snapshot/g) ?? []).length, 1, "the snapshot caveat stated once");
});

test("ticker-13 (adapted): one head and one line for the side the build cannot compute; the reason and the both-sides rule are its tip (control)", () => {
  const stamps = { buildId: "b", generatedAt: "2026-07-24 06:56 UTC", generatedAtDate: "2026-07-24" };
  const html = tickerUnifiedBody({ ticker: "WMB", txns: [] } as never, { state: "module-absent" } as never, stamps, CTX, { fullTable: false }, { crowding: null, committees: null } as never);
  const agreeHtml = /<section class="panel design-agree"[\s\S]*?<\/section>/.exec(html)![0];
  const agree = domOf(agreeHtml);
  assert.equal(text(agree.querySelector("h2")), "Congress vs filers");
  assert.equal(text(agree.querySelector(".panel-note")), "12 months");
  const filers = agree.querySelectorAll(".agree-unavailable");
  assert.equal(filers.length, 1, "one line for the filer side");
  assert.match(text(filers[0]!.querySelector(".agree-k")), /^Filers$/);
  const tip = text(filers[0]!.querySelector(".note-pop"));
  assert.equal(tip, "This build does not include the institutional module, so the filer side cannot be computed. Convergence and divergence are stated only when both sides are computed.");
  assert.doesNotMatch(reach(agreeHtml), /not in build|Do the two regimes agree|TRAILING 12M/);
  // control: the retired wording would be caught in this slice
  assert.match(reach(agreeHtml + "<span>not in build</span>"), /not in build/);
  // control: the Congress rows (data) are untouched
  assert.equal(agree.querySelectorAll(".agree-row").length, 3, "two Congress rows and the one filer line");
});

/* ---------------------------------------------------------------- signals-10, signals-11 */

test("signals-11 (adapted): an opened Named move says the manager type (and an inferred exit), its verified ticker and 'Filer page ↗' — not the row's date or the tab's quarter", () => {
  const model = fixtureInstitutional();
  const ids = namedMoveIds(model);
  /* every move rendered as a visible row (the server's one row function), so
     the exits past the first fifteen are read too */
  const root = domOf(model.domSet.map((m, i) => moveRowHtml(m, ids[i]!, model, false)).join(""));
  const rows = root.querySelectorAll("article.mv-item");
  assert.equal(rows.length, model.domSet.length);
  let exits = 0;
  for (const r of rows) {
    const facts = r.querySelector(".mv-facts")!;
    const first = text(facts.querySelector("p"));
    assert.doesNotMatch(first, / · filed | · quarter ended /, `${r.getAttribute("id")}: no repeated date or quarter`);
    if (r.getAttribute("data-kind") === "exit") {
      exits++;
      assert.match(first, / · exit inferred from absence$/, "an exit keeps its inference");
    }
    assert.equal(text(facts.querySelector("a")), "Filer page ↗");
    assert.ok(r.querySelector(".mv-fil time"), "the filed date is on the row itself");
  }
  assert.ok(exits > 0, "precondition: the fixture opens an exit");
});

test("signals-10 (adapted): the five header tips are shorter and keep every qualifier; the cut sentences are gone", () => {
  const model = fixtureInstitutional();
  const inst = reach(signalsInstitutionalHtml(model, CTX));
  for (const q of [
    "a dollar change alone is not a position change",
    "an exit is inferred from absence in the next filing",
    "Tickers appear only where the reviewed mapping names one",
    "Counts cover the build's whole population for each filter",
    "Filer pages list every move",
    "Broad accounts — members who traded more than",
    "A co-occurrence in public filings, never coordination",
    "broad accounts not counted (a name only they traded says so)",
    "positions at quarter end, long only, filed up to 45 days after the quarter — never current holdings",
  ]) assert.ok(inst.includes(q), `kept: ${q}`);
  for (const gone of ["Open a row for its Congress side", "The newest closed quarter is", "Choose a row to list every change", "so BRK.B meets BRK-B"]) {
    assert.ok(!inst.includes(gone), `cut: ${gone}`);
  }
  const ov = reach(signalsOverlapHtml(fixtureOverlap(), CTX));
  assert.ok(ov.includes("A co-occurrence in public filings — never coordination, never intent."), "the Overlap tip's caveat");
  assert.ok(ov.includes("never current holdings"), "the Overlap tip's 13F caveat");
  assert.ok(ov.includes("Unanimous names come first, then those with the most members and managers."));
  // control: the checker sees a dropped qualifier
  const dropped = inst.replace("a dollar change alone is not a position change", "");
  assert.ok(!dropped.includes("a dollar change alone is not a position change"));
});

/* ---------------------------------------------------------------- the ledger's patterns, on the rendered surfaces */

test("the ledger's patterns past M2: each shipped pattern is on its rendered surface and each replaced text is gone (control)", () => {
  const ledger = JSON.parse(readFileSync(path.resolve(import.meta.dirname, "fixtures", "launch-copy-ledger.json"), "utf-8")) as {
    items: { id: string; milestone: string; shipped: string | null; replaced: string | null }[];
  };
  const f = loadTriageFixture();
  const triage = buildTriage(f.artifact, f.rows, { committee: f.committee, identityOf: f.identityOf });
  const model = fixtureInstitutional();
  const ids = namedMoveIds(model);
  const { feed, ciks } = activity();
  const stamps = { buildId: "b", generatedAt: "2026-07-24 06:56 UTC", generatedAtDate: "2026-07-24" };
  const corpus = [
    signalsBody(f.artifact, CTX, { rowsEvaluated: f.rows.length, triage, institutional: model, overlap: fixtureOverlap() }),
    model.domSet.map((m, i) => moveRowHtml(m, ids[i]!, model, false)).join(""),
    activitySectionHtml(feed, { reference: true, notableCiks: ciks }),
    overlapBandHtml(band(), CTX, (c) => `/f/${c}`),
    tickerUnifiedBody({ ticker: "WMB", txns: [] } as never, { state: "module-absent" } as never, stamps, CTX, { fullTable: false }, { crowding: null, committees: null } as never),
  ]
    .map(reach)
    .join(" ");
  const checked = ledger.items.filter((e) => e.milestone !== "M2" && (e.shipped || e.replaced));
  assert.ok(checked.length >= 12, `the final pass's patterned entries (${checked.length})`);
  for (const e of checked) {
    if (e.shipped) assert.match(corpus, new RegExp(e.shipped), `${e.id}: /${e.shipped}/ ships`);
    if (e.replaced) assert.doesNotMatch(corpus, new RegExp(e.replaced), `${e.id}: /${e.replaced}/ is gone`);
  }
  // control: a replaced text that came back is caught
  const inst07 = checked.find((e) => e.id === "inst-07")!;
  assert.match(corpus + " These rows are notable managers' new, added, trimmed and exited positions", new RegExp(inst07.replaced!));
});
