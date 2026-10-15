/* The /signals composition — signals-v3 M2 (R10–R13, LD6, LD7, LD9).

   The page is a triage: the head with exactly three figures and the "How
   signals work" note, the three lead cards with their CSS-only ranking
   control, then one band — "Filings to read" in three tiers beside the hit
   rate by family (the hits filter) and the slim hits table. The rule book and
   the lag distribution render on Methodology now (`pages-render.test.ts`).
   Every number is computed from the artifact, the build's rows and the
   triage. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import { signalsBody, triageRowHtml, lagBandHtml, groupHits, hitMatches, hitsView, hitsHiddenText, signalSentence, memberSignalsPanel, signalsTileHtml, hitsBodyHtml, sortHits, type HitFilter } from "../src/lib/ui/index.ts";
import { COMMITTEE_CAVEAT, DEFAULT_HIT_FILTER, leadCardsHtml, memberLastName, SIGNAL_HITS_COMPACT_ROWS, SIGNAL_HITS_PAGE_SIZE } from "../src/lib/ui/signals.ts";
import type { Signal, SignalArtifact } from "../src/lib/signals.ts";
import type { TxnRow } from "../src/lib/format.ts";
import { buildTriage, daysBetween, type TriageResult } from "../src/lib/signal-triage.ts";
import { scanBannedWording } from "../src/lib/activity.ts";
import { MiniElement } from "./lib/mini-dom.ts";
import { syncScrollRegion, type ScrollRegionNode } from "../src/scripts/signals-client.ts";
import { loadTriageFixture } from "./lib/triage-fixture.ts";
import { baseStylesheet } from "./lib/styles.ts";

function domOf(html: string): MiniElement {
  const root = new MiniElement("body");
  root.innerHTML = html;
  return root;
}
/** Visible text: note panels and visually hidden text excluded. */
function ownText(el: MiniElement): string {
  return el.nodes
    .map((n) => (typeof n === "string" ? n : n.classList.contains("note-pop") || n.classList.contains("visually-hidden") ? "" : ownText(n)))
    .join("");
}

function sig(over: Partial<Signal> & { kind: Signal["kind"] }): Signal {
  return {
    id: `${over.kind}:${Math.random().toString(16).slice(2)}`,
    rule: "rule text",
    thresholdVersion: "1.0.0",
    entities: { bioguide: "A000001", memberName: "Test <Member>", ticker: "ABC" },
    magnitude: { low: 250001, high: 500000 },
    receipts: ["https://efdsearch.senate.gov/x"],
    occurrence: { tradeDate: "2026-03-01", filedDate: "2026-06-01" },
    sourceAvailableAt: "2026-06-01",
    computedAt: "2026-08-02 07:27 UTC",
    firstSeenBuild: "b",
    lastSeenBuild: "b",
    status: "active",
    cohort: "senate",
    // R8 (SIGNALS-CLARITY M2): a newly emitted per-row signal, filed as listed stock
    asset: "ABC Holdings Inc (ABC)",
    assetType: "Stock",
    side: "purchase",
    owner: "self",
    listedStock: true,
    ...over,
  };
}
const ART: SignalArtifact = {
  v: 1, buildId: "b", computedAt: "2026-08-02 07:27 UTC", thresholdVersion: "1.0.0", retentionDays: 90,
  coverageFrom: "2026-05-04", coverageTo: "2026-08-02", lifecycleNote: "cold start", compaction: "none",
  dateAnomaliesExcluded: 3, lagCaveat: "PTRs are filed up to 45 days after the trade", withheld: [
    { kind: "s5-jurisdiction", reason: "inputs-not-in-build", detail: "committee data absent" },
  ],
  signals: [
    sig({ kind: "s1-large" }),
    sig({ kind: "s6-late-large", occurrence: { tradeDate: "2026-01-01", filedDate: "2026-06-01" } }),
    sig({ kind: "s2-first", magnitude: { low: 1001, high: 15000 } }),
    sig({ kind: "s1-large", status: "superseded", supersededInBuild: "c" }),
  ],
};
const CTX = {};

/** The golden fixture's triage — real public rows — rendered through the page. */
let golden: { art: SignalArtifact; t: TriageResult; html: string } | null = null;
function goldenPage(): { art: SignalArtifact; t: TriageResult; html: string } {
  if (golden) return golden;
  const f = loadTriageFixture();
  const t = buildTriage(f.artifact, f.rows, { committee: f.committee, identityOf: f.identityOf });
  golden = { art: f.artifact, t, html: signalsBody(f.artifact, CTX, { rowsEvaluated: 2051, triage: t }) };
  return golden;
}
/** The same rows with the committee inputs NOT in the build (the owner-tier T0 build's state). */
function withheldPage(): { t: TriageResult; html: string } {
  const f = loadTriageFixture();
  const art: SignalArtifact = {
    ...f.artifact,
    signals: f.artifact.signals.filter((s) => s.kind !== "s5-jurisdiction"),
    withheld: [{ kind: "s5-jurisdiction", reason: "inputs-not-in-build", detail: "committee membership and/or issuer-sector data are not in this build — the jurisdiction join is unanswerable, so the kind is withheld rather than computed from half its inputs" }],
  };
  const t = buildTriage(art, f.rows, { committee: null, identityOf: f.identityOf });
  return { t, html: signalsBody(art, CTX, { rowsEvaluated: 2051, triage: t }) };
}

/* ================================================================ composition (success criterion 1) */

/** The page's sections in source order, and what must NOT be there. */
function compositionProblems(html: string): string[] {
  const out: string[] = [];
  const at = (needle: string): number => html.indexOf(needle);
  const order = ['class="page-head"', 'id="lead-cards"', 'id="triage"', 'id="stands"', 'id="look"', 'id="routine"', 'id="families"', 'id="hits"'];
  for (const n of order) if (at(n) < 0) out.push(`missing ${n}`);
  for (let i = 1; i < order.length; i++) if (at(order[i - 1]!) >= at(order[i]!)) out.push(`${order[i - 1]} is not before ${order[i]}`);
  const root = domOf(html);
  const triage = root.querySelector("#triage");
  for (const id of ["stands", "look", "routine"]) if (!triage?.querySelector(`#${id}`)) out.push(`#${id} is not inside #triage`);
  const figs = root.querySelectorAll(".page-head .ledger-fig").length;
  if (figs !== 3) out.push(`${figs} ledger figures, not 3`);
  const cards = root.querySelectorAll("#lead-cards .si-card").length;
  if (cards !== 3) out.push(`${cards} lead cards, not 3`);
  // absent
  if (/si-hit-filter|data-kind="all"/.test(html)) out.push("the rule chips render");
  if (/watched only|signal-watched-only/i.test(html)) out.push("the watched-only control renders");
  if (/si-watchband|id="signal-watch/.test(html)) out.push("the watch band renders");
  if (/id="signal-rules"|id="signal-rulebook"|>Rule book</.test(html)) out.push("the rule book renders");
  if (/id="signal-lag"|class="si-lags"/.test(html)) out.push("the lag distribution renders");
  if (/si-evidence-row|si-expand-body/.test(html)) out.push("the per-hit evidence rows render");
  return out;
}

test("success criterion 1: head (3 figures) → #lead-cards (3) → #triage (#stands, #look, #routine) → #families → #hits; no chips, watch, rule book, lag or evidence rows", () => {
  const { html } = goldenPage();
  assert.deepEqual(compositionProblems(html), []);
  // controls: each removal and each reorder is caught
  assert.ok(compositionProblems(html.replace('id="look"', 'id="lookx"')).some((p) => /missing id="look"/.test(p)));
  assert.ok(compositionProblems(html.replace(/<section class="panel si-families"[\s\S]*?<\/section>/, "") + '<section id="families"></section>').some((p) => /is not before id="hits"/.test(p)));
  assert.ok(compositionProblems(html + '<tr class="si-evidence-row"></tr>').some((p) => /evidence/.test(p)));
  assert.ok(compositionProblems(html + '<section id="signal-rules">Rule book</section>').some((p) => /rule book/.test(p)));
  // the artifact-only view (no triage) keeps the order and says what it lacks
  const plain = signalsBody(ART, CTX);
  assert.match(plain, /The filings table is computed on the server from the build's rows; this view carries the artifact only\./);
  assert.ok(plain.indexOf('id="lead-cards"') < plain.indexOf('id="triage"') && plain.indexOf('id="triage"') < plain.indexOf('id="families"'));
});

test("R10: exactly three figures — Hits (with listed stocks), Stand out (of N rows ranked), Window 90d (with dates)", () => {
  const { html, t, art } = goldenPage();
  const figs = domOf(html).querySelectorAll(".page-head .ledger-fig").map((f) => ({
    label: ownText(f.querySelector("dt")!).trim(),
    value: ownText(f.querySelector(".ledger-value")!).trim(),
    sub: ownText(f.querySelector(".ledger-sub")!).trim(),
  }));
  const active = art.signals.filter((s) => s.status === "active");
  assert.deepEqual(figs.map((f) => f.label), ["Hits", "Stand out", "Window"]);
  assert.equal(figs[0]!.value, active.length.toLocaleString("en-US"));
  assert.match(figs[0]!.sub, /^\d[\d,]* in listed stocks$/);
  assert.equal(figs[1]!.value, String(t.counts.stands));
  assert.equal(figs[1]!.sub, `of ${t.rows.length} rows ranked`);
  assert.equal(figs[2]!.value, "90d");
  assert.equal(figs[2]!.sub, `${art.coverageFrom} → ${art.coverageTo}`);
  // without a triage the figure states its absence, never a computed zero
  const plain = domOf(signalsBody(ART, CTX)).querySelectorAll(".page-head .ledger-fig")[1]!;
  assert.equal(ownText(plain.querySelector(".ledger-value")!).trim(), "—");
  assert.equal(ownText(plain.querySelector(".ledger-sub")!).trim(), "not computed in this view");
});

/* ================================================================ LD9: every caveat lands */

test("LD9: every caveat that left the visible page is in its new home", () => {
  const { html, art } = goldenPage();
  const root = domOf(html);
  const how = root.querySelector(".page-head .note-pop")!;
  assert.ok(how, "the head's How signals work note");
  const howText = how.textContent;
  for (const needle of [
    "A signal is a fact about a filing, not a forecast: no returns are computed.",
    "Never used: prices, returns, intent.",
    "Recomputed every build from the same rows you can audit; zero hits is a computed answer, not missing coverage.",
    art.lagCaveat,
    "No kind was withheld this build.",
    "date-anomaly rows were excluded before any rule ran",
  ]) assert.ok(howText.includes(needle), `How signals work carries: ${needle}`);
  assert.match(howText, /\d+ signals? from an earlier build left the window; \d+ (?:is|are) carried forward unevaluated\./);
  assert.match(how.querySelector('a[href="/methodology/#signals-ranking"]')!.textContent, /How rows are ranked/);
  // the trigger is the label "How signals work", inside the lede
  assert.equal(root.querySelector(".page-lede .note-btn")!.getAttribute("aria-label"), "How signals work, explain");
  // the coverage window → the Window figure (asserted above); the committee caveat → card foot and legend
  assert.equal(ownText(root.querySelector("#lead-cards .si-card-context")!).trim(), COMMITTEE_CAVEAT);
  assert.ok(ownText(root.querySelector("#triage .si-legend")!).includes("context, never an allegation"), "the Cmte legend");
  assert.ok(root.querySelector('#triage .si-legend .note-pop[id="n-signals-legend-cmte"]')!.textContent.includes(COMMITTEE_CAVEAT));
  // the per-kind exact rule → each hit's kind word
  const kindNote = root.querySelector("#hits tbody td.c-kind .note-pop")!;
  assert.ok(art.signals.some((s) => s.rule === kindNote.textContent), "the hit's kind opens its exact rule");
  // per-hit evidence (dual dates, lag) → the traded → filed column
  const when = root.querySelector("#hits tbody td.si-when")!;
  assert.equal(when.querySelectorAll("time").length, 2);
  assert.match(ownText(when), /\+\d+d/);
  // a withheld kind states itself in the note and in its panel
  const w = withheldPage().html;
  assert.match(w, /1 kind was withheld this build: S-5 · Committee-jurisdiction overlap \(inputs-not-in-build\)\./);
  assert.match(w, /WITHHELD · inputs-not-in-build/);
});

test("signals-v3 M1: the page embeds no watch band and no data island; hostile names escape; the whole page passes the wording scan", () => {
  const html = signalsBody({ ...ART, signals: [sig({ kind: "s1-large", entities: { bioguide: null, memberName: "</script><b>x", ticker: null } })] }, CTX);
  assert.doesNotMatch(html, /<\/script><b>/);
  assert.match(html, /&lt;\/script&gt;&lt;b&gt;x/, "the hostile name renders as text in its hit row");
  assert.doesNotMatch(html, /<script\b/i, "no script element, inert or not");
  assert.doesNotMatch(html, /id="signal-watch|si-watchband|aria-label="Watchlist"/, "no watch band");
  assert.deepEqual(scanBannedWording(goldenPage().html), []);
  assert.doesNotMatch(goldenPage().html, /<script\b/i, "the ranking control is CSS: no script anywhere on the page");
});

/* ================================================================ R12: the triage rows */

test("R12: every triage row is an <article> with a ticker link to #on-signals, a separate receipt, owner, both dates and four labelled meters", () => {
  const { html, t } = goldenPage();
  const rows = domOf(html).querySelectorAll("#triage article.si-row");
  assert.equal(rows.length, t.rows.length);
  for (const a of rows) {
    const key = a.getAttribute("data-row-key")!;
    const row = t.rows.find((r) => r.key === key)!;
    const link = a.querySelector("h4 a.si-row-link");
    if (row.lead.txn.ticker) {
      assert.ok(link, `${key}: the heading is the link`);
      assert.match(link!.getAttribute("href")!, new RegExp(`^/tickers/[^/]+/#on-signals$|^/e/\\?k=t:`));
    } else assert.equal(link, null, `${key}: no ticker, no link`);
    const receipt = a.querySelector(".si-row-src a");
    assert.ok(receipt, `${key}: a receipt link of its own`);
    assert.notEqual(receipt!.parent, link, "the receipt is not inside the heading link");
    assert.equal(receipt!.getAttribute("href"), row.lead.doc);
    assert.ok(a.querySelector(".owner-note"), `${key}: the owner`);
    assert.ok(a.querySelector(".si-row-filed time"), `${key}: filed`);
    assert.ok(a.querySelector(".si-row-traded time") || /trade date not disclosed/.test(a.textContent), `${key}: traded`);
    const meters = a.querySelectorAll(".si-meter[role]");
    assert.equal(meters.length, 4);
    assert.deepEqual(meters.map((m) => m.getAttribute("aria-label")!.split(":")[0]), ["Size", "Pattern", "Others", "Cmte"]);
    for (const m of meters) {
      assert.match(m.getAttribute("aria-label")!, /^(Size|Pattern|Others|Cmte): (strong|medium|low|none|unknown)$/);
      assert.equal(m.querySelectorAll(".si-mbar").length, 3, "three bars");
      assert.ok(m.querySelector(".si-meter-label"), "the inline label (shown on phones)");
    }
    assert.ok(ownText(a.querySelector(".si-row-why")!).trim().length > 0, `${key}: a reason sentence`);
  }
  // the stretched link and the receipt above it
  const css = baseStylesheet();
  assert.match(css, /\.si-row-link::after \{ content: ""; position: absolute; inset: 0; \}/);
  assert.match(css, /\.si-row-src, \.si-row a:not\(\.si-row-link\), \.si-row \.note \{ position: relative; z-index: 1; \}/);
});

test("R12: tiers in order, Routine a CLOSED <details>, each with its count; a legend defines the levels and the four meters", () => {
  const { html, t } = goldenPage();
  const root = domOf(html);
  const stands = root.querySelector("#stands")!;
  assert.equal(stands.tagName, "section");
  assert.equal(stands.querySelectorAll("article").length, t.counts.stands);
  assert.match(ownText(stands.querySelector(".si-tier-h")!), new RegExp(`^Stands out ${t.counts.stands}$`));
  assert.match(ownText(root.querySelector("#look .si-tier-h")!), new RegExp(`^Worth a look ${t.counts.look}$`));
  const routine = root.querySelector("#routine")!;
  assert.equal(routine.tagName, "details");
  assert.equal(routine.hasAttribute("open"), false, "Routine is closed");
  assert.match(ownText(routine.querySelector("summary h3.si-tier-h")!), new RegExp(`^Routine ${t.counts.routine}$`), "the tier heading rides in the summary");
  assert.ok(stands.querySelectorAll("article").every((a) => a.getAttribute("data-tier") === "stands"));
  const legend = root.querySelector("#triage .si-legend")!;
  assert.deepEqual(legend.querySelectorAll(".si-legend-word").map((w) => ownText(w)), ["strong", "medium", "low", "none", "unknown (hatched)"]);
  assert.deepEqual(legend.querySelectorAll("dt").map((d) => ownText(d).trim()), ["Size", "Pattern", "Others", "Cmte"]);
  for (const d of legend.querySelectorAll("dd")) assert.ok(ownText(d).trim().length > 20, "each meter is defined");
  // the meter column labels over a tier
  assert.deepEqual(stands.querySelectorAll(".si-meter-head .si-meter-col").map((c) => c.textContent), ["Size", "Pattern", "Others", "Cmte"]);
  // an empty tier states itself
  const none = signalsBody(ART, CTX, { rowsEvaluated: 1, triage: { ...goldenPage().t, rows: [], counts: { stands: 0, look: 0, routine: 0 } } });
  assert.match(none, /No filing in the window stands out — a computed answer over every ranked filing\./);
});

test("R12 golden render: Armstrong's row tags 701 of 703 lines late; a cluster row names its members; a late batch says so", () => {
  const { t } = goldenPage();
  const arm = t.rows.find((r) => r.lead.txn.bioguide === "A000383" && r.filed === "2026-07-21")!;
  const a = domOf(triageRowHtml(arm, CTX));
  assert.equal(ownText(a.querySelector(".si-late-tag")!), "701 of 703 lines late");
  assert.equal(a.querySelector("a.si-row-link")!.getAttribute("href"), "/tickers/WMB/#on-signals");
  assert.match(ownText(a.querySelector("h4")!), /^WMB\s*Alan Armstrong$/);
  const spcx = t.rows.find((r) => r.grouping === "cluster")!;
  const c = domOf(triageRowHtml(spcx, CTX));
  assert.match(ownText(c.querySelector("h4")!), /^SPCX\s*6 members$/);
  assert.match(ownText(c.querySelector(".si-row-what")!), /CLUSTER/);
  assert.match(ownText(c.querySelector(".si-row-what")!), /Jared Moskowitz/);
  const batch = t.rows.find((r) => r.grouping === "late-batch")!;
  const b = domOf(triageRowHtml(batch, CTX));
  assert.match(ownText(b.querySelector("h4")!), /Tommy Tuberville · 8 filings$/);
  assert.match(ownText(b.querySelector(".si-row-what")!), /LATE BATCH/);
  assert.match(ownText(b.querySelector(".si-row-src")!), /\+7 filings/);
  // sides read BUY / SELL, never a verb
  assert.ok(t.rows.every((r) => !/\b(?:bought|sold|buying)\b/i.test(triageRowHtml(r, CTX))));
});

/** D21 (code review round 1, F1): a row's date block is the LEAD line's own
    chronology — its filed date, its trade date, the lag between the two and
    its filing's receipt — and a grouped row names its latest filing apart. */
function assertLeadChronology(row: TriageResult["rows"][number], html: string): void {
  const t = row.lead.txn;
  const a = domOf(html);
  assert.equal(a.querySelector(".si-row-filed time")!.getAttribute("datetime"), t.filed, "filed is the lead line's own");
  assert.equal(ownText(a.querySelector(".si-row-filed")!), `filed ${t.filed}`);
  assert.equal(a.querySelector(".si-row-traded time")!.getAttribute("datetime"), t.traded);
  const lagText = ownText(a.querySelector(".si-row-traded")!).match(/· (\d+)d$/)![1];
  assert.equal(Number(lagText), daysBetween(t.traded!, t.filed), "the lag runs from the lead's trade to the lead's filing");
  assert.equal(a.querySelector(".si-row-src a")!.getAttribute("href"), row.lead.doc, "the receipt is the lead line's filing");
  assert.ok(row.filings.some((f) => f.doc === row.lead.doc && f.filed === t.filed), "the receipt's filing carries the filed date shown");
  const n = row.filings.length;
  assert.equal(
    ownText(a.querySelector(".si-row-src .mono-note")!),
    ` +${n - 1} ${n === 2 ? "filing" : "filings"} · latest of ${n} filings: ${row.filed}`,
    "the group's latest filing is labelled apart",
  );
  assert.equal(a.querySelector(".si-row-src .mono-note time")!.getAttribute("datetime"), row.filed);
}

test("D21 golden: Salazar's CB row prints the lead line's own filed date, lag and receipt; the group's latest filing is labelled apart", () => {
  const { t } = goldenPage();
  const cb = t.rows.find((r) => r.grouping === "member-ticker" && r.lead.txn.ticker === "CB" && r.lead.txn.bioguide === "S000168")!;
  // control: the case the review found — the lead's filing is NOT the group's latest
  assert.deepEqual([cb.lead.txn.traded, cb.lead.txn.filed, cb.filed, cb.filings.length], ["2026-07-01", "2026-08-07", "2026-09-09", 2]);
  const html = triageRowHtml(cb, CTX);
  assertLeadChronology(cb, html);
  const a = domOf(html);
  assert.equal(ownText(a.querySelector(".si-row-filed")!), "filed 2026-08-07");
  assert.match(ownText(a.querySelector(".si-row-traded")!), /^traded 2026-07-01 · 37d$/);
  assert.doesNotMatch(ownText(a.querySelector(".si-row-filed")!), /2026-09-09/, "the latest filing never sits beside the lead's trade date");
  // a single-filing row carries no group label
  const single = t.rows.find((r) => r.filings.length === 1 && r.lead.txn.traded)!;
  assert.equal(domOf(triageRowHtml(single, CTX)).querySelector(".si-row-src .mono-note"), null);
  // every grouped golden row holds the rule
  for (const r of t.rows.filter((x) => x.filings.length > 1 && x.lead.txn.traded)) assertLeadChronology(r, triageRowHtml(r, CTX));
});

test("R12: a row whose lead names no ticker renders its heading as plain text; a cut ticker links through /e/", () => {
  const { t } = goldenPage();
  const row = t.rows.find((r) => r.lead.txn.ticker === "WMB")!;
  const noTicker = { ...row, lead: { ...row.lead, txn: { ...row.lead.txn, ticker: null } } };
  const h = domOf(triageRowHtml(noTicker, CTX)).querySelector("h4")!;
  assert.equal(h.querySelector("a"), null);
  assert.match(ownText(h), /^no ticker/);
  const cut = domOf(triageRowHtml(row, { cutTickers: new Set(["WMB"]) })).querySelector("a.si-row-link")!;
  assert.equal(cut.getAttribute("href"), "/e/?k=t:WMB", "the /e/ route carries no #on-signals block");
});

/* ================================================================ R11: the lead cards */

test("R11: three cards — the committee card and four buy/sell variants, server-rendered; two radios; dual dates and a ticker link on every card", () => {
  const { html, t } = goldenPage();
  const lead = domOf(html).querySelector("#lead-cards")!;
  const radios = lead.querySelectorAll('input[type="radio"]');
  assert.deepEqual(radios.map((r) => [r.getAttribute("name"), r.getAttribute("value"), r.hasAttribute("checked")]), [["rank", "record", true], ["rank", "absolute", false]]);
  assert.deepEqual(lead.querySelectorAll(".si-rank-seg label").map((l) => [l.getAttribute("for"), ownText(l)]), [["si-rank-record", "Own record"], ["si-rank-absolute", "Absolute $"]]);
  const cards = lead.querySelectorAll(".si-card");
  assert.deepEqual(cards.map((c) => [c.getAttribute("data-card"), c.getAttribute("data-tone")]), [["committee", "amber"], ["buy", "green"], ["sell", "red"]]);
  assert.match(ownText(cards[0]!.querySelector(".si-card-tag")!), /^Committee · direct match$/);
  const variants = lead.querySelectorAll(".si-variant");
  assert.deepEqual(variants.map((v) => v.getAttribute("data-rank")), ["record", "absolute", "record", "absolute"]);
  assert.deepEqual(variants.map((v) => ownText(v.querySelector(".si-card-tag")!)), ["Largest buy · own record", "Largest buy · absolute $", "Largest sell · own record", "Largest sell · absolute $"]);
  for (const block of [cards[0]!, ...variants]) {
    assert.equal(block.querySelectorAll(".si-card-dates time").length, 2, "traded and filed");
    assert.match(block.querySelector(".si-card-h a")!.getAttribute("href")!, /^\/tickers\/[A-Z]+\/#on-signals$/);
    assert.ok(block.querySelector(".si-card-src a"), "its receipt");
  }
  assert.match(ownText(cards[0]!), /CB\s*SELL\s*\$15K–\$50K/);
  assert.match(ownText(cards[0]!), /traded 2026-08-19 · filed 2026-09-09/);
  assert.match(ownText(variants[0]!), /BE\s*BUY\s*\$1M–\$5M/);
  assert.match(ownText(variants[1]!), /BE\s*BUY\s*\$1M–\$5M/);
  assert.match(ownText(variants[2]!), /MLM\s*SELL/);
  assert.match(ownText(variants[3]!), /WMB\s*SELL\s*\$5M–\$25M/);
  assert.equal(t.cards.sellRecord!.line.txn.ticker, "MLM");
  assert.doesNotMatch(lead.textContent, /<script/);
});

test("R11: the ranking control is CSS only — one variant shows per checked radio, through :checked ~ rules", () => {
  const css = baseStylesheet();
  assert.match(css, /\.si-variant\[data-rank="absolute"\] \{ display: none; \}/, "absolute hidden by default (record is checked)");
  assert.match(css, /#si-rank-absolute:checked ~ \.si-cards \.si-variant\[data-rank="record"\] \{ display: none; \}/);
  assert.match(css, /#si-rank-absolute:checked ~ \.si-cards \.si-variant\[data-rank="absolute"\] \{ display: block; \}/);
  assert.match(css, /#si-rank-record:checked ~ \.si-lead-head label\[for="si-rank-record"\]/, "the checked label is the active segment");
  assert.match(css, /\.si-rank-input \{ position: absolute; width: 1px; height: 1px;/, "the radios are clipped, never removed — the keyboard reaches them");
  // the inputs precede the head and the cards, so `~` can reach both
  const lead = leadCardsHtml(goldenPage().t, CTX);
  assert.ok(lead.indexOf('id="si-rank-absolute"') < lead.indexOf('class="panel-head si-lead-head"') && lead.indexOf('class="panel-head si-lead-head"') < lead.indexOf('class="si-cards"'));
  // no script toggles it
  const client = readFileSync(path.resolve(import.meta.dirname, "..", "src", "scripts", "signals-client.ts"), "utf-8");
  assert.doesNotMatch(client, /si-rank|si-variant/, "the island never touches the ranking control");
});

test("committee data NOT in this build (the owner-tier T0 state): Cmte is unknown (hatched) on every row, and the committee card states the absence", () => {
  const { html, t } = withheldPage();
  assert.equal(t.cmteAvailable, false);
  const root = domOf(html);
  const cmte = root.querySelectorAll('#triage .si-meter[data-meter="cmte"]');
  assert.ok(cmte.length > 0);
  assert.ok(cmte.every((m) => m.getAttribute("data-level") === "-1" && m.getAttribute("aria-label") === "Cmte: unknown"), "every Cmte meter is unknown");
  assert.match(html, /Cmte reads unknown on every row: committee data is not in this build \(inputs-not-in-build: committee membership/);
  const card = root.querySelector('#lead-cards .si-card[data-card="committee"]')!;
  assert.match(ownText(card), /Committee data is not in this build \(inputs-not-in-build: /);
  assert.equal(ownText(card.querySelector(".si-card-tag")!), "Committee", "the tag claims no grade");
  assert.equal(card.querySelector(".si-card-h"), null, "no grade, no pick");
  assert.ok(card.querySelector("[data-empty-state]"), "a stated empty state, never an empty card");
  assert.doesNotMatch(ownText(card), /direct match|broad match/i, "no fake grade");
  // control: with the inputs in the build the same card names its grade
  assert.match(ownText(domOf(goldenPage().html).querySelector('#lead-cards .si-card[data-card="committee"] .si-card-tag')!), /^Committee · direct match$/);
  // the hatched level is a CSS fill, not a missing element
  assert.match(baseStylesheet(), /\.si-meter\[data-level="-1"\] \.si-mbar \{ background: var\(--hatch\); \}/);
});

/* ================================================================ R13: families and the slim hits */

test("R13: Hit rate by family is the filter — <button aria-pressed> rows with a removable pill; per 1,000 rows filed; withheld says so", () => {
  const html = signalsBody(ART, CTX, { rowsEvaluated: 1000 });
  const fam = domOf(html).querySelector("#families")!;
  const btns = fam.querySelectorAll("button[data-family]");
  assert.deepEqual(btns.map((b) => b.getAttribute("data-family")), ["BEHAVIOUR", "STRUCTURE", "NOVELTY", "CONTEXT", "COMPLIANCE"]);
  assert.ok(btns.every((b) => b.getAttribute("aria-pressed") === "false"));
  assert.equal(fam.querySelector('[role="group"]')!.getAttribute("aria-label"), "Filter hits by family");
  assert.match(ownText(btns[0]!), /^Behaviour1\.0 ‰$/, "one hit per 1,000 rows");
  assert.match(ownText(btns[3]!), /withheld$/, "CONTEXT (S-5) is withheld, never a zero");
  const pill = fam.querySelector("#signal-family-pill-row")!;
  assert.ok(pill.hidden, "the pill shows only once a family is chosen");
  assert.ok(pill.querySelector("button#signal-family-pill"));
  assert.match(html, /3 date-anomaly rows excluded before any rule ran/);
  const noRate = signalsBody(ART, CTX);
  assert.match(noRate, /The evaluated-row count is not available, so no rate is stated/);
});

test("R13: the slim hits — Kind · Ticker · Who · Traded → Filed · Size · Src, 10 server lines, Show 10 more, no chips and no evidence rows", () => {
  const many: Signal[] = Array.from({ length: 25 }, (_, i) =>
    sig({ kind: "s1-large", id: `s1-large:${i}`, entities: { bioguide: `B${String(i).padStart(6, "0")}`, memberName: "Cory A. Booker", ticker: "ABC" }, occurrence: { tradeDate: "2026-03-01", filedDate: `2026-06-${String(i + 1).padStart(2, "0")}` } }),
  );
  const html = signalsBody({ ...ART, signals: many }, CTX, { rowsEvaluated: 1000 });
  const hits = domOf(html).querySelector("#hits")!;
  assert.deepEqual(
    hits.querySelectorAll("thead th").map((th) => [ownText(th).trim(), th.getAttribute("class")]),
    [["Kind", "c-kind"], ["Ticker", "c-ticker"], ["Who", "c-member c-flex"], ["Traded → Filed", "c-num"], ["Size", "c-num"], ["Src", "c-src"]],
  );
  const rows = hits.querySelectorAll("tbody tr.si-hit");
  assert.equal(rows.length, 10);
  assert.equal(SIGNAL_HITS_COMPACT_ROWS, 10);
  assert.equal(SIGNAL_HITS_PAGE_SIZE, 10);
  assert.equal(rows[0]!.children.length, 6);
  // kind: the rule's label trigger
  assert.ok(rows[0]!.children[0]!.querySelector(".note-btn.note-label"));
  assert.equal(ownText(rows[0]!.children[0]!).trim(), "LARGE");
  // who: the last name, the full name in the link's name and title
  const who = rows[0]!.querySelector("td.si-subject a")!;
  assert.equal(ownText(who), "Booker");
  assert.equal(who.getAttribute("title"), "Cory A. Booker");
  assert.equal(who.getAttribute("aria-label"), "Cory A. Booker");
  // both dates and the lag in one column
  assert.match(ownText(rows[0]!.children[3]!), /^03-01 → 06-25 \+116d$/);
  assert.equal(rows[0]!.children[3]!.querySelectorAll("time").map((t) => t.getAttribute("datetime")).join(" "), "2026-03-01 2026-06-25");
  assert.equal(ownText(rows[0]!.children[4]!), "$250K–$500K");
  assert.match(ownText(rows[0]!.children[5]!), /eFD/);
  assert.match(ownText(hits.querySelector("#signal-hits-range")!), /^1–10 of 25 lines · 25 hits$/);
  const more = hits.querySelector("#signal-hits-more")!;
  assert.equal(ownText(more), "Show 10 more");
  assert.equal(more.getAttribute("aria-disabled"), "false");
  assert.equal(hits.getAttribute("data-step"), "10");
  assert.doesNotMatch(html, /si-hit-filter|button[^>]*data-kind=/, "no kind chips");
  assert.doesNotMatch(html, /si-evidence-row|si-expand/, "no evidence rows");
  assert.match(html, /id="signal-stocks-only"/, "Listed stocks only stays");
  // with ≤ 10 lines there is nothing more to show
  const few = domOf(signalsBody(ART, CTX)).querySelector("#signal-hits-more")!;
  assert.equal(few.getAttribute("aria-disabled"), "true");
});

test("memberLastName: generational suffixes and given names drop", () => {
  assert.equal(memberLastName("Cory A. Booker"), "Booker");
  assert.equal(memberLastName("Thomas H. Kean, Jr."), "Kean");
  assert.equal(memberLastName("Gilbert Ray Cisneros, Jr."), "Cisneros");
  assert.equal(memberLastName("William R. Timmons IV"), "Timmons");
  assert.equal(memberLastName("John J. McGuire III"), "McGuire");
  assert.equal(memberLastName("Pelosi"), "Pelosi");
});

/* ---------- R-8: the scroll region ---------- */

function regionBox(scrollWidth: number, clientWidth: number, name: string | undefined): ScrollRegionNode & { attrs: Map<string, string> } {
  const attrs = new Map<string, string>();
  return {
    scrollWidth,
    clientWidth,
    dataset: { scrollRegion: name },
    attrs,
    setAttribute: (k, v) => void attrs.set(k, v),
    removeAttribute: (k) => void attrs.delete(k),
  };
}

test("R-8: the hits wrapper is a named, focusable region only while its table overflows it", () => {
  const html = signalsBody(ART, CTX);
  const wrap = domOf(html).querySelector(".si-hits-scroll")!;
  assert.ok(wrap, "the hits wrapper renders");
  for (const a of ["tabindex", "role", "aria-label"]) assert.equal(wrap.getAttribute(a), null, `the server renders no ${a}`);
  const name = wrap.getAttribute("data-scroll-region")!;
  assert.match(name, /scroll sideways/);
  const narrow = regionBox(900, 358, name);
  assert.equal(syncScrollRegion(narrow), true);
  assert.deepEqual(Object.fromEntries(narrow.attrs), { tabindex: "0", role: "region", "aria-label": name });
  narrow.scrollWidth = 1200;
  narrow.clientWidth = 1200;
  assert.equal(syncScrollRegion(narrow), false);
  assert.deepEqual(Object.fromEntries(narrow.attrs), {}, "no tab stop, no role, no name once nothing scrolls");
});

/* ---------- valid markup: no block inside a <p> (review C2-6) ---------- */

const BLOCK = new Set(["div", "p", "section", "table", "ul", "ol", "dl", "details", "header", "footer", "article", "h3", "h4"]);
function blocksInsideP(root: MiniElement): string[] {
  const out: string[] = [];
  const walk = (el: MiniElement, inP: boolean): void => {
    for (const c of el.children) {
      if (inP && BLOCK.has(c.tagName)) out.push(`<${c.tagName}${c.getAttribute("class") ? ` class="${c.getAttribute("class")}"` : ""}> inside <p>`);
      walk(c, inP || c.tagName === "p");
    }
  };
  walk(root, false);
  return out;
}

test("C2-6: the page's markup is valid — no block element inside a paragraph (cards, rows, hits)", () => {
  const root = domOf(goldenPage().html);
  for (const sel of ["#lead-cards", "#triage", "#families", "#hits"]) assert.deepEqual(blocksInsideP(root.querySelector(sel)!), [], sel);
  const preFix = domOf('<div><p><strong>Receipts:</strong> <div class="cell cell-src"><a href="https://x">eFD</a></div></p></div>');
  assert.deepEqual(blocksInsideP(preFix), ['<div class="cell cell-src"> inside <p>'], "control");
});

/* ======================================================================
   SIGNALS-CLARITY M2 — Congress signals, what was traded, listed stocks
   ====================================================================== */

const PAGE_SRC = path.resolve(import.meta.dirname, "..", "src", "pages", "signals", "index.astro");
/** a per-row hit that is NOT listed stock (House "OT", as the live Not Fade Away row) */
const other = (over: Partial<Signal> = {}): Signal =>
  sig({ kind: "s1-large", asset: "Not Fade Away LLC [OT]", assetType: "OT", owner: "spouse", listedStock: false, entities: { bioguide: "B000002", memberName: "Other Member", ticker: null }, ...over });
/** a record from a build that predates the R8 fields */
function priorRecord(over: Partial<Signal> & { kind: Signal["kind"] }): Signal {
  const s = sig(over);
  delete s.asset;
  delete s.assetType;
  delete s.side;
  delete s.owner;
  delete s.listedStock;
  return s;
}
const hitRows = (html: string) => domOf(html).querySelectorAll("#signal-hits-body tr.si-hit");
const FILTER = (over: Partial<HitFilter> = {}): HitFilter => ({ family: "all", stocksOnly: true, ...over });

test("R7 / T8: the page is Congress signals (title, h1, description); the 13F and cross-regime tiles stay gone", () => {
  const html = signalsBody(ART, CTX);
  assert.match(html, /<h1 class="page-title">Congress signals<\/h1>/);
  assert.doesNotMatch(html, /Hits · 13F|Cross-regime|CROSS-REGIME/);
  const page = readFileSync(PAGE_SRC, "utf-8");
  assert.match(page, /<Base title="Congress signals — Public Filings"/);
  assert.match(page, /"Congress signals: /, "the meta description names the page");
  assert.match(page, /active="signals"/, "the masthead nav entry is unchanged");
  assert.match(page, /triage: getTriage\(\)/, "the page reads the build's one memoised triage");
});

test("R10 / T9: the WHAT sentence — owner, verb, asset, chip; S-3 names its members and side; a prior record says the asset is not in it", () => {
  const spouse = signalSentence(other());
  assert.equal(spouse.text, "Spouse: Purchase of Not Fade Away LLC · Other", "the plan's live example, in the amended side-noun wording");
  assert.equal(spouse.chip, null, "a code the asset text already renders is not printed twice");
  const sides: [Signal["side"], string][] = [["purchase", "Purchase of"], ["sale", "Sale of"], ["sale_partial", "Partial sale of"], ["exchange", "Exchange of"], ["other", "Transaction in"]];
  for (const [side, noun] of sides) assert.equal(signalSentence(sig({ kind: "s1-large", side })).text, `${noun} ABC Holdings Inc`, side);
  for (const [owner, word] of [["child", "Child"], ["joint", "Joint"], ["spouse", "Spouse"]] as const) {
    assert.equal(signalSentence(sig({ kind: "s1-large", owner, side: "sale_partial" })).text, `${word}: Partial sale of ABC Holdings Inc`);
  }
  assert.equal(signalSentence(sig({ kind: "s1-large", owner: null })).text, "Purchase of ABC Holdings Inc", "an unstated owner adds no qualifier");
  assert.equal(signalSentence(sig({ kind: "s1-large", asset: "Apple Inc (AAPL)", assetType: "ST" })).chip, null, "House ST: no chip");
  assert.equal(signalSentence(sig({ kind: "s1-large", assetType: "Municipal Security", listedStock: false })).chip, "Municipal Security");
  assert.equal(signalSentence(sig({ kind: "s1-large", assetType: null, listedStock: false })).chip, "type not stated");
  const s3 = (side: "purchase" | "sale") => sig({ kind: "s3-cooccurrence", side, entities: { bioguide: null, memberName: "4 members", ticker: "NVDA" } });
  assert.equal(signalSentence(s3("purchase")).text, "4 members: purchases of NVDA");
  assert.equal(signalSentence(s3("sale")).text, "4 members: sales of NVDA");
  for (const [side] of sides) for (const owner of ["self", "spouse", "child", "joint", null] as const) {
    assert.deepEqual(scanBannedWording(signalSentence(sig({ kind: "s1-large", side, owner })).text), [], `${side}/${owner}`);
  }
  for (const kind of ["s1-large", "s3-cooccurrence"] as const) {
    const x = signalSentence(priorRecord({ kind }));
    assert.deepEqual([x.text, x.chip, x.recorded], ["asset not in this record", null, false], kind);
  }
});

test("R10 / T9: the home tile and member panel keep their sentence; the island repaints only through the server's renderer", () => {
  const art: SignalArtifact = { ...ART, signals: [other({ entities: { bioguide: "A000001", memberName: "Test <Member>", ticker: null } }), sig({ kind: "s2-first" })] };
  const client = readFileSync(path.resolve(import.meta.dirname, "..", "src", "scripts", "signals-client.ts"), "utf-8");
  assert.match(client, /\bhitsBodyHtml\(/, "the island repaints through the server's row renderer");
  assert.doesNotMatch(client, /signalSentence/, "the island composes no sentence of its own");
  const tile = signalsTileHtml(art.signals, CTX, () => "LARGE");
  assert.match(ownText(domOf(tile).querySelector("tbody td.c-flex")!), /Purchase of ABC Holdings Inc/);
  const panel = memberSignalsPanel(art, "A000001", CTX);
  const whats = domOf(panel).querySelectorAll("tbody td.si-what").map((td) => ownText(td).trim());
  assert.ok(whats.includes("Spouse: Purchase of Not Fade Away LLC · Other"), whats.join(" | "));
  assert.ok(whats.includes("Purchase of ABC Holdings Inc"));
});

test("R11 / T10: exact repeats within one filing collapse to one line ×n; size is sumRanges; the artifact keeps both", () => {
  const a = sig({ kind: "s1-large", id: "s1-large:aaaa", receipts: ["https://efdsearch.senate.gov/r1"] });
  const b = sig({ kind: "s1-large", id: "s1-large:bbbb", receipts: ["https://efdsearch.senate.gov/r1"] });
  const art: SignalArtifact = { ...ART, signals: [a, b] };
  const html = signalsBody(art, CTX);
  const rows = hitRows(html);
  assert.equal(rows.length, 1, "two identical hits are one line");
  assert.equal(rows[0]!.getAttribute("data-group-size"), "2");
  assert.equal(ownText(rows[0]!.querySelector("td.si-mag")!), "$500K–$1.0M ×2", "sumRanges: 250,001 + 250,001 → $500K floor; 500K + 500K high");
  assert.match(rows[0]!.querySelector("td.si-mag .si-group-n .visually-hidden")!.textContent, /identical rows in one filing, sizes summed/);
  assert.match(html, /id="signal-hits-range"[^>]*>1–1 of 1 line · 2 hits</, "the counter reads lines · hits");
  assert.equal(art.signals.length, 2, "grouping is presentation only");
  const open = groupHits([sig({ kind: "s1-large", magnitude: { low: 1000001, high: null } }), sig({ kind: "s1-large", magnitude: { low: 1000001, high: null } })]);
  assert.equal(open.length, 1);
  assert.equal(ownText(hitRows(signalsBody({ ...ART, signals: open[0]!.members }, CTX))[0]!.querySelector("td.si-mag")!), "Over $2.0M ×2", "an open bound stays open");
  // negatives
  const s3 = (ticker: string) => sig({ kind: "s3-cooccurrence", side: "purchase", entities: { bioguide: null, memberName: "4 members", ticker }, receipts: ["https://efdsearch.senate.gov/a"] });
  assert.equal(groupHits([s3("NVDA"), s3("NVDA")]).length, 2, "S-3 is an aggregate — never grouped");
  assert.equal(groupHits([priorRecord({ kind: "s1-large" }), priorRecord({ kind: "s1-large" })]).length, 2, "a record lacking the R8 fields is never grouped");
});

test("R12 / T11: listed stocks only by default — SSR hides non-stock hits and states the count; unchecked shows every row", () => {
  const art: SignalArtifact = { ...ART, signals: [sig({ kind: "s1-large" }), other(), other({ kind: "s6-late-large" }), priorRecord({ kind: "s2-first" })] };
  const html = signalsBody(art, CTX);
  const box = domOf(html).querySelector("#signal-stocks-only")!;
  assert.ok(box.hasAttribute("checked"), "checked by default");
  assert.equal(box.getAttribute("autocomplete"), "off", "never restored by the browser");
  assert.equal(hitRows(html).length, 1, "only the listed-stock hit");
  assert.equal(ownText(domOf(html).querySelector("#signal-hidden-count")!), "3 hits on other asset types hidden", "the prior record counts as not listed");
  const all = hitsView(art.signals.filter((s) => s.status === "active"), FILTER({ stocksOnly: false }));
  assert.equal(all.lines.length, 4);
  assert.equal(all.hidden, 0);
  assert.equal(hitsHiddenText(all.hidden, false), "all asset types shown");
  const client = readFileSync(path.resolve(import.meta.dirname, "..", "src", "scripts", "signals-client.ts"), "utf-8");
  assert.match(client, /let stocksOnly = true;\s*if \(stocksChk\) stocksChk\.checked = true;/, "every load starts at the default");
  assert.match(client, /hitsRepaint\(hits, filter\(\), shown, ctx/, "the pager repaints through the shared view");
});

test("R13 / T2.7: family × stocks — the hidden count is the total minus shown under every combination", () => {
  const hits = [
    sig({ kind: "s1-large", entities: { bioguide: "A000001", memberName: "A", ticker: "ABC" } }),
    sig({ kind: "s1-large", entities: { bioguide: "B000002", memberName: "B", ticker: "XYZ" }, assetType: "OT", listedStock: false }),
    sig({ kind: "s6-late-large", entities: { bioguide: "A000001", memberName: "A", ticker: null }, assetType: null, listedStock: false }),
    sig({ kind: "s6-late-large", entities: { bioguide: "C000003", memberName: "C", ticker: "QQQ" } }),
    sig({ kind: "s3-cooccurrence", side: "sale", listedStock: false, entities: { bioguide: null, memberName: "4 members", ticker: "XYZ" } }),
    sig({ kind: "s4-infrequent", entities: { bioguide: "D000004", memberName: "D", ticker: "DDD" } }),
  ];
  for (const family of ["all", "BEHAVIOUR", "COMPLIANCE", "STRUCTURE", "NOVELTY"]) {
    for (const stocksOnly of [false, true]) {
      const f = FILTER({ family, stocksOnly });
      const others = hits.filter((s) => hitMatches(s, { ...f, stocksOnly: false }));
      const shown = hits.filter((s) => hitMatches(s, f));
      const v = hitsView(hits, f);
      assert.equal(v.hits, shown.length, `${family}/${stocksOnly}`);
      assert.equal(v.hidden, others.length - shown.length, `${family}/${stocksOnly}: hidden = total minus shown`);
      if (stocksOnly) assert.ok(shown.every((s) => s.listedStock === true), "only listed stocks show");
    }
  }
  // BEHAVIOUR is S-1 and S-4: the ABC, XYZ (OT) and DDD hits
  assert.deepEqual([hitsView(hits, FILTER({ family: "BEHAVIOUR" })).hits, hitsView(hits, FILTER({ family: "BEHAVIOUR" })).hidden], [2, 1]);
  assert.deepEqual([hitsView(hits, FILTER({ family: "COMPLIANCE" })).hits, hitsView(hits, FILTER({ family: "COMPLIANCE" })).hidden], [1, 1]);
  assert.deepEqual(Object.keys(DEFAULT_HIT_FILTER).sort(), ["family", "stocksOnly"], "no kind, no watched-only field");
});

test("R12: the home tile takes the same default and states its hidden count", () => {
  const tile = signalsTileHtml([other(), sig({ kind: "s1-large" }), other()], CTX, () => "LARGE");
  assert.equal(domOf(tile).querySelectorAll("tbody tr").length, 1);
  assert.match(tile, /<span class="si-hidden-count">2 hits on other asset types hidden<\/span>/);
});

test("R14: the lag distribution renders on Methodology through lagBandHtml — identical (member, lag) rows group and the 45-day line is marked", () => {
  const row = { name: "Bulk Filer", bioguide: "B1", party: "D", traded: "2026-01-01", filed: "2026-05-01", lag: 120, late: 1 } as Pick<TxnRow, "name" | "bioguide" | "party" | "traded" | "filed" | "lag" | "late">;
  const html = lagBandHtml({ latestBatch: [row, row, { ...row, lag: 5, late: 0 }], latestBatchFiled: "2026-05-01" });
  assert.match(html, /id="signal-lag"/);
  assert.match(html, /×2/);
  assert.match(html, /si-late">\+120d/);
  assert.match(html, /si-bar-tick/);
  assert.match(html, /LATEST BATCH FILED 2026-05-01/);
  assert.match(lagBandHtml({ latestBatch: [], latestBatchFiled: null }), /No rows with both dates in the latest filed batch\./);
});

test("R13: hitsBodyHtml is the ONE body renderer (server lines = the shared view's first 10)", () => {
  const { html, art } = goldenPage();
  const active = art.signals.filter((s) => s.status === "active");
  const cols = domOf(html).querySelector("#hits table")!.getAttribute("data-columns")!.split(",");
  const view = hitsView(sortHits(active), DEFAULT_HIT_FILTER);
  const body = /<tbody id="signal-hits-body">([\s\S]*?)<\/tbody>/.exec(html)![1]!;
  assert.equal(body, hitsBodyHtml(view.lines.slice(0, 10), CTX, cols));
});
