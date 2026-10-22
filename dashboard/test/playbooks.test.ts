/* signals-v4 M3 (R19, R20, R21, R25, LD15, LD16; T3.2, T3.4, T3.5): the seven
   playbooks — their content, word for word, and clean of the banned wording —
   the three Congress triggers at every boundary, and the surfaces: the
   Playbooks tab, a triggered row's chip and opened section, the Playbooks
   filter, the strips; then the client — one article at a time, the filter,
   and every in-page link through `revealTarget`. */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  CMP_YEARS,
  CONGRESS_PLAYBOOKS,
  OPP_BREADTH_DAYS,
  PLAYBOOKS,
  PLAYBOOK_TRIGGER_ROWS,
  cmpTest,
  playbookTriggers,
  type PlaybookHit,
  type PlaybookTriggers,
} from "../src/lib/playbooks.ts";
import { BROAD_ACCOUNT_NAMES } from "../src/lib/congress-quarter.ts";
import { scanBannedWording } from "../src/lib/activity.ts";
import { BANNED_PATTERNS, RULE3_PATTERNS, redactFiledNames, visibleText as visibleCopy } from "./lib/banned-scan.ts";
import { signalsBody, signalsOverlapHtml, signalsPlaybooksHtml, signalsPlaybooksMethodHtml, triageRowHtml } from "../src/lib/ui/index.ts";
import { fixtureOverlap } from "./lib/overlap-fixture.ts";
import { TRIGGER_COLUMNS, playbookFilterHtml, playbookTextHtml, triggerTableHtml, type PlaybooksModel } from "../src/lib/ui/signals-playbooks.ts";
import { signalsInstitutionalHtml } from "../src/lib/ui/signals-institutional.ts";
import { congressLineFields, congressLineHtml, triageRowId } from "../src/lib/ui/signals.ts";
import { buildTriage, type TriageResult, type TriageRow } from "../src/lib/signal-triage.ts";
import { rowLink, type TxnRow } from "../src/lib/format.ts";
import { ROSTER_CHECKED, ROSTER_VERSION } from "../src/lib/leadership-roster.ts";
import { loadTriageFixture } from "./lib/triage-fixture.ts";
import { fixtureInstitutional } from "./lib/inst-signals-fixture.ts";
import { installDom, MiniElement } from "./lib/mini-dom.ts";
import { initSignalsPage } from "../src/scripts/signals-client.ts";

const CTX = {};
const text = (el: MiniElement | null | undefined): string => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
function domOf(html: string): MiniElement {
  const root = new MiniElement("body");
  root.innerHTML = html;
  return root;
}

/* ---------------------------------------------------------------- T3.2: content */

test("T3.2 (LD15): six playbooks (launch polish: the Form 4 one, which had no data, is gone) — ids, sources, statuses and grades as LD15 lists them; every evidence entry complete with an https url", () => {
  assert.deepEqual(
    PLAYBOOKS.map((p) => [p.id, p.short, p.name, p.source, p.status, p.grade]),
    [
      ["opp-buy", "OPP. BUY", "Opportunistic member buy", "Congress", "live", "split"],
      ["leader", "LEADER", "Leadership trade", "Congress", "live", "one study"],
      ["cmte", "CMTE", "Committee-linked trade", "Congress", "live", "thin"],
      ["best-ideas", "BEST IDEA", "Best ideas", "Institutional", "live", "supportive"],
      ["consensus", "CONSENSUS", "Notable-manager consensus", "Institutional", "live", "weak"],
      ["overlap", "OVERLAP", "Congress and managers on one name", "Overlap", "descriptive", "no studies"],
    ],
  );
  assert.deepEqual([...CONGRESS_PLAYBOOKS], ["opp-buy", "leader", "cmte"]);
  assert.deepEqual(PLAYBOOKS.map((p) => p.evidence.length), [5, 1, 2, 1, 2, 0]);
  for (const p of PLAYBOOKS) {
    for (const e of p.evidence) {
      assert.ok(["supports", "against", "indirect"].includes(e.dir));
      for (const f of ["cite", "venue", "sample", "finding"] as const) assert.ok(e[f].length > 0, `${p.id} ${e.cite}: ${f}`);
      assert.match(e.url, /^https:\/\/[^\s]+$/, `${p.id} ${e.cite}: url`);
    }
  }
  assert.ok(PLAYBOOKS.every((p) => p.status === "live" || p.status === "descriptive"), "no playbook waits on data the site does not have");
});

test("T3.2 (LD15) + launch M5 (R28): the texts are pinned word for word — the launch mock's cut of the v4 texts, the † edits and the build's two kept", () => {
  /* Reversal record (launch M5, R28): this test pinned the signals-v4 mock's
     playbooks.py texts verbatim. The approved launch mock cut the tab's
     visible words by 28%, so the pinned texts are now that cut (lib/
     playbooks.ts). Property kept: every text is pinned word for word, and the
     research qualifiers ("we found", "average", "abnormal") and the † edits
     survive; the citations, samples, numbers and links are pinned by the
     content test above and the evidence test below. */
  const by = Object.fromEntries(PLAYBOOKS.map((p) => [p.id, p]));
  assert.equal(by["opp-buy"]!.pattern, "Set aside members who trade in the same month every year; the rest may carry information.");
  assert.equal(by["opp-buy"]!.trigger, "A listed-stock purchase in Filings to read by a member who traded in each of the 3 prior years but never in one fixed month each year (the Cohen–Malloy–Pomorski routine test, adapted from corporate insiders). Members with under 3 years of history are unclassified. Broad accounts (more than 25 names in the 90 days before the trade) are left out.");
  assert.equal(by["opp-buy"]!.verdict, "Split: proven for corporate insiders, untested on Congress; studies since the STOCK Act find no average edge.");
  assert.equal(by["opp-buy"]!.evidence[0]!.finding, "Opportunistic trades earned abnormal returns of 82 bp a month value-weighted (180 bp equal-weighted); routine ones, about zero.");
  assert.equal(by["opp-buy"]!.evidence[4]!.finding, "No outperformance in aggregate; over six months, House members’ purchases underperformed by 26 bp.");
  assert.equal(by["leader"]!.evidence[0]!.finding, "Level with matched peers before the post; 47 percentage points a year ahead of them after.");
  assert.equal(by["leader"]!.evidence[0]!.url, "https://www.nber.org/papers/w34524");
  assert.equal(by["cmte"]!.trigger, "Cmte reads medium: a direct match in the committee table (v1). Context, never an allegation.");
  assert.equal(by["cmte"]!.verdict, "Thin: no study we found tests a jurisdiction match like this one.");
  assert.equal(by["consensus"]!.verdict, "Weak: no study we found shows such names outperform.");
  assert.equal(by["overlap"]!.verdict, "Descriptive only: the site uses no prices to test it.");
  // the research's qualifiers survive the cut
  assert.match(by["opp-buy"]!.verdict, /no average edge/);
  assert.match(by["opp-buy"]!.evidence[0]!.finding, /abnormal returns/);
  for (const id of ["cmte", "consensus"]) assert.match(by[id]!.verdict, /no study we found/, `${id}: "we found" stays`);
  // † edits
  assert.equal(by["best-ideas"]!.pattern, "A manager’s biggest tilt from market weight.");
  assert.doesNotMatch(PLAYBOOKS.map((p) => `${p.pattern} ${p.verdict} ${p.trigger}`).join(" "), /highest-conviction/);
  assert.match(playbookTextHtml(by["best-ideas"]!.trigger), /\(<span class="ref-label">Conviction leaders<\/span>\)\.$/, "the section is named through the markup-bound label");
  assert.match(playbookTextHtml(by["best-ideas"]!.verdict), /; <span class="ref-label">Conviction leaders<\/span> ranks by raw share of book\.$/);
  // the build's two: the leadership roster is no longer a draft, and the Overlap rule is not one
  assert.match(by["leader"]!.trigger, /^Any trade by a member holding one of the 12 leadership posts the study uses: the Speaker, and the floor leaders, whips and conference or caucus chairs in both chambers\. Matched by congressional identifier against a dated roster from 2023-01-03 \(roster v1/);
  assert.doesNotMatch(by["leader"]!.trigger, /draft|bioguide|119th Congress/);
  assert.match(by["overlap"]!.trigger, /^The Overlap tab’s rule: .*a co-occurrence in public filings, never coordination\.$/);
  assert.doesNotMatch(by["overlap"]!.trigger, /draft/);
});

test("T3.2 (R25): every playbook text, rendered, passes BANNED_WORDING, the raw-bytes banned scan and the visible-copy terms; a planted word is caught", () => {
  const all = PLAYBOOKS.flatMap((p) => [p.name, p.pattern, p.trigger, p.horizon, p.verdict, ...p.evidence.flatMap((e) => [e.cite, e.venue, e.sample, e.finding])])
    .map((t) => `<p>${playbookTextHtml(t)}</p>`)
    .join("");
  assert.deepEqual(scanBannedWording(all), []);
  assert.deepEqual(BANNED_PATTERNS.filter(({ re }) => re.test(redactFiledNames(all))).map((p) => p.name), []);
  const copy = visibleCopy(all);
  assert.deepEqual(RULE3_PATTERNS.filter(({ re }) => re.test(copy)).map((p) => p.name), [], "no pipeline vocabulary (e.g. the identifier's internal name)");
  // controls
  assert.ok(scanBannedWording(all + "<p>a highest-conviction position</p>").includes("conviction"));
  assert.ok(scanBannedWording(all + "<p>Opportunistic insider buying</p>").includes("buying"));
  assert.ok(RULE3_PATTERNS.some(({ re }) => re.test("matched by bioguide")), "control: the visible-copy term the leader trigger dropped");
});

/* ---------------------------------------------------------------- T3.2: the triggers */

function txn(over: Partial<TxnRow>): TxnRow {
  return {
    kind: "txn", txnId: "t", asset: "A", assetType: "ST", filed: "2026-03-20", traded: "2026-03-10", name: "Member M", bioguide: "M000001", party: "D", state: "CA",
    district: "1", chamber: "house", ticker: "LEAD", side: "purchase", owner: "self", low: 15001, high: 50000, lag: 10, late: 0, flags: [],
    doc: "https://disclosures-clerk.house.gov/public_disc/ptr-pdfs/2026/20040001.pdf", exchangedTicker: null, ...over,
  };
}
let seq = 0;
/** A triage row as the triggers read it: grouping, lead line and cutoff, ranked lines, meters. */
function row(lead: TxnRow, over: { grouping?: TriageRow["grouping"]; cutoff?: string; lines?: TxnRow[]; cmte?: number; tier?: TriageRow["tier"] } = {}): TriageRow {
  seq++;
  return {
    key: `single:${seq}`, grouping: over.grouping ?? "single", tier: over.tier ?? "look",
    meters: { size: 0, pattern: 0, others: 0, cmte: (over.cmte ?? -1) as never },
    lead: { txn: lead, cutoff: over.cutoff ?? lead.filed } as never,
    lines: (over.lines ?? [lead]).map((t) => ({ txn: t })) as never,
  } as unknown as TriageRow;
}
const triage = (rows: TriageRow[], cmteAvailable = true): TriageResult => ({ rows, cmteAvailable, cmteUnavailableReason: cmteAvailable ? null : "inputs-not-in-build" }) as unknown as TriageResult;
/** History rows in (year, month) with the default member, filed by 2026-01-31. */
const hist = (ym: [number, number][], over: Partial<TxnRow> = {}): TxnRow[] =>
  ym.map(([y, m], i) => txn({ txnId: `h-${y}-${m}-${i}`, traded: `${y}-${String(m).padStart(2, "0")}-15`, filed: `${y}-${String(m).padStart(2, "0")}-28`, ticker: `H${i}`, assetType: i % 2 ? "OP" : "ST", side: i % 3 ? "sale" : "purchase", ...over }));
const ids = (t: PlaybookTriggers, r: TriageRow): string[] => (t.byRow.get(r.key) ?? []).map((h) => h.id);

test("T3.2 (LD16): the CMP test — routine when one calendar month recurs in each of the 3 prior years, opportunistic when none does, unclassified with a year missing", () => {
  const lead = txn({ txnId: "lead" });
  assert.equal(CMP_YEARS, 3);
  const routine = cmpTest(hist([[2023, 3], [2024, 3], [2025, 3], [2025, 7]]), lead, "2026-03-20");
  assert.deepEqual([routine.cls, routine.years, routine.common], ["routine", [2025, 2024, 2023], ["03"]]);
  const opp = cmpTest(hist([[2023, 1], [2024, 2], [2025, 3], [2024, 9]]), lead, "2026-03-20");
  assert.deepEqual([opp.cls, opp.common], ["opportunistic", []]);
  const missing = cmpTest(hist([[2024, 2], [2025, 3]]), lead, "2026-03-20");
  assert.equal(missing.cls, "unclassified", "no trade in Y−3: unclassified (a 2-year test would call it opportunistic)");
  // history is the years BEFORE the lead's: a same-year trade never classifies
  assert.equal(cmpTest(hist([[2024, 2], [2025, 3], [2026, 1]]), lead, "2026-03-20").cls, "unclassified");
  // a row filed after the cutoff never counts toward history
  const lateFiled = [...hist([[2023, 1], [2025, 3]]), txn({ txnId: "late", traded: "2024-02-15", filed: "2026-05-01", ticker: "LF" })];
  assert.equal(cmpTest(lateFiled, lead, "2026-03-20").cls, "unclassified", "filed after C: not history");
  assert.equal(cmpTest(lateFiled, lead, "2026-06-01").cls, "opportunistic", "control: filed by a later cutoff, it counts");
});

test("T3.2 (LD16): opp-buy triggers on an opportunistic, non-broad, non-cluster listed-stock purchase; breadth 25 triggers and 26 does not; the 90-day window's bounds", () => {
  const base = hist([[2023, 1], [2024, 2], [2025, 3]]);
  const lead = txn({ txnId: "lead", traded: "2026-03-10", filed: "2026-03-20" });
  /* n distinct names traded in [lead − 90d, lead), filed by the cutoff */
  const breadth = (n: number): TxnRow[] => Array.from({ length: n }, (_, i) => txn({ txnId: `b${i}`, ticker: `BR${i}`, traded: "2026-02-01", filed: "2026-02-20" }));
  const at = (rows: TxnRow[], over: Parameters<typeof row>[1] = {}): string[] => {
    const r = row(lead, over);
    return ids(playbookTriggers(triage([r]), [...rows, lead]), r);
  };
  assert.deepEqual(at(base), ["opp-buy"]);
  assert.equal(OPP_BREADTH_DAYS, 90);
  assert.equal(BROAD_ACCOUNT_NAMES, 25);
  assert.deepEqual(at([...base, ...breadth(24)]), ["opp-buy"], "24 names before the trade, plus the history's own: under the bound");
  // breadth counts every ticker in the window: the history rows are older, so the window holds exactly the planted names
  const r25 = row(lead);
  const t25 = playbookTriggers(triage([r25]), [...base, ...breadth(25), lead]);
  assert.equal(t25.cmp.get(r25.key)!.breadth, 25);
  assert.deepEqual(ids(t25, r25), ["opp-buy"], "25 names: not broad, triggers");
  const r26 = row(lead);
  const t26 = playbookTriggers(triage([r26]), [...base, ...breadth(26), lead]);
  assert.equal(t26.cmp.get(r26.key)!.breadth, 26);
  assert.deepEqual(ids(t26, r26), [], "26 names: a broad account, left out");
  // the window: lead − 90 days is in, lead − 91 is out, the lead's own date is out, and a row filed after the cutoff is out
  const edge = (traded: string, filed = "2026-02-20"): number => {
    const r = row(lead);
    return playbookTriggers(triage([r]), [...base, txn({ txnId: `e-${traded}`, ticker: "EDGE", traded, filed }), lead]).cmp.get(r.key)!.breadth;
  };
  assert.equal(edge("2025-12-10"), 1, "lead − 90 days: in");
  assert.equal(edge("2025-12-09"), 0, "lead − 91 days: out");
  assert.equal(edge("2026-03-10", "2026-03-15"), 0, "the lead's own date: out");
  assert.equal(edge("2026-02-01", "2026-04-01"), 0, "filed after the cutoff: out");
  // a cluster never gets opp-buy; a sale, an option or a line with no trade date neither
  assert.deepEqual(at(base, { grouping: "cluster" }), []);
  for (const over of [{ side: "sale" as const }, { assetType: "OP" }, { traded: null }, { ticker: null }]) {
    const l = txn({ ...over, txnId: `x-${JSON.stringify(over)}` });
    const r = row(l);
    assert.deepEqual(ids(playbookTriggers(triage([r]), [...base, l]), r), [], JSON.stringify(over));
  }
  // routine and unclassified rows do not trigger
  assert.deepEqual(at(hist([[2023, 3], [2024, 3], [2025, 3]])), []);
  assert.deepEqual(at(hist([[2024, 3], [2025, 3]])), []);
  // the reason names the years and the breadth, from the row's own facts
  const r = row(lead);
  const why = playbookTriggers(triage([r]), [...base, ...breadth(2), lead]).byRow.get(r.key)![0]!.why;
  assert.equal(why, "Not routine by the CMP test: traded in each of 2023–2025, but no calendar month recurs in all three. 2 names traded in the 90 days before, so not a broad account.");
});

/* codex M3 round 1, F4 (R20, LD16): history and breadth are the LEAD
   MEMBER's own rows. Each case plants another member whose rows, pooled with
   the lead's, would change the answer; each row is pinned on its own. */
test("codex M3 r1 F4 (LD16): another member never supplies the lead member's missing history year, recurring month or breadth — each classification and breadth pinned per member", () => {
  const other = { name: "Member O", bioguide: "O000001" };
  const lead = txn({ txnId: "lead", traded: "2026-03-10", filed: "2026-03-20" });
  const run = (rows: TxnRow[], extra: TriageRow[] = []) => {
    const r = row(lead);
    const t = playbookTriggers(triage([r, ...extra]), [...rows, lead]);
    return { t, r, res: t.cmp.get(r.key)! };
  };
  // 1. the missing year: the lead member has 2024 and 2025 only; Member O traded in 2023
  {
    const { t, r, res } = run([...hist([[2024, 2], [2025, 3]]), ...hist([[2023, 1]], other)]);
    assert.deepEqual([res.cls, res.common, res.breadth], ["unclassified", [], 0], "no 2023 of its own: unclassified (pooled, O's 2023 would make it opportunistic)");
    assert.deepEqual(ids(t, r), []);
  }
  // 2. the recurring month: the lead member's months never recur; Member O traded in January of each year
  {
    const oLead = txn({ txnId: "o-lead", ...other, ticker: "OLD", traded: "2026-03-11", filed: "2026-03-21" });
    const oRow = row(oLead);
    const { t, r, res } = run([...hist([[2023, 1], [2024, 2], [2025, 3]]), ...hist([[2023, 1], [2024, 1], [2025, 1]], other), oLead], [oRow]);
    assert.deepEqual([res.cls, res.common], ["opportunistic", []], "its own months: opportunistic (pooled, January recurs: routine)");
    assert.deepEqual(ids(t, r), ["opp-buy"]);
    const oRes = t.cmp.get(oRow.key)!;
    assert.deepEqual([oRes.cls, oRes.common], ["routine", ["01"]], "Member O's own row is routine on its own history");
    assert.deepEqual(ids(t, oRow), []);
  }
  // 3. the breadth: the lead member traded 20 names in the window, Member O 10 more
  {
    const mine = Array.from({ length: 20 }, (_, i) => txn({ txnId: `m${i}`, ticker: `MB${i}`, traded: "2026-02-01", filed: "2026-02-20" }));
    const theirs = Array.from({ length: 10 }, (_, i) => txn({ txnId: `o${i}`, ...other, ticker: `OB${i}`, traded: "2026-02-01", filed: "2026-02-20" }));
    const { t, r, res } = run([...hist([[2023, 1], [2024, 2], [2025, 3]]), ...mine, ...theirs]);
    assert.deepEqual([res.cls, res.breadth], ["opportunistic", 20], "20 names of its own (pooled: 30, a broad account)");
    assert.deepEqual(ids(t, r), ["opp-buy"]);
    assert.match(t.byRow.get(r.key)![0]!.why, / 20 names traded in the 90 days before, so not a broad account\.$/);
  }
  // the member key: a filer with no bioguide is keyed by its filed name, never pooled with another unkeyed filer
  {
    const raw = (name: string, ym: [number, number][]) => hist(ym, { name, bioguide: null });
    const rLead = txn({ txnId: "raw-lead", name: "Raw One", bioguide: null, traded: "2026-03-10", filed: "2026-03-20" });
    const rr = row(rLead);
    const t = playbookTriggers(triage([rr]), [...raw("Raw One", [[2024, 2], [2025, 3]]), ...raw("Raw Two", [[2023, 1]]), rLead]);
    assert.equal(t.cmp.get(rr.key)!.cls, "unclassified", "Raw Two's 2023 is not Raw One's");
  }
});

test("codex M3 r1 F4 sibling (LD16, LD17): leader counts only the line's own member's tenure — a non-leader's line on a date a leader held a post never triggers", () => {
  const plain = row(txn({ txnId: "plain-2024", name: "Member M", bioguide: "M000001", traded: "2024-05-01" }));
  const scalise = row(txn({ txnId: "sc-2024", name: "Steve Scalise", bioguide: "S001176", traded: "2024-05-01" }));
  const t = playbookTriggers(triage([plain, scalise]), [plain.lead.txn, scalise.lead.txn]);
  assert.deepEqual([ids(t, plain), ids(t, scalise)], [[], ["leader"]], "same day: only the post holder's own line");
  // a cluster of non-leaders traded the day a leader did: none of its lines is a post holder's
  const a = txn({ txnId: "cl-a", name: "Member A", bioguide: "A000009", traded: "2024-05-01" });
  const b = txn({ txnId: "cl-b", name: "Member B", bioguide: "B000009", traded: "2024-05-02" });
  const cl = row(a, { grouping: "cluster", lines: [a, b] });
  assert.deepEqual(ids(playbookTriggers(triage([cl, scalise]), [a, b, scalise.lead.txn]), cl), []);
  // a line with no bioguide is never a post holder's, whatever its name
  const unkeyed = row(txn({ txnId: "nk", name: "Steve Scalise", bioguide: null, traded: "2024-05-01" }));
  assert.deepEqual(ids(playbookTriggers(triage([unkeyed]), [unkeyed.lead.txn]), unkeyed), []);
});

test("T3.2 (LD16, LD17): leader triggers on any ranked line by a member who held a post on its trade date — the tenure's bounds, a cluster's non-lead line, never before the roster", () => {
  const scalise = (traded: string) => txn({ txnId: `s-${traded}`, name: "Steve Scalise", bioguide: "S001176", traded });
  const r1 = row(scalise("2024-05-01"));
  const t = playbookTriggers(triage([r1]), [r1.lead.txn]);
  assert.deepEqual(ids(t, r1), ["leader"]);
  assert.equal(t.byRow.get(r1.key)![0]!.why, `Steve Scalise was the House Republican floor leader on the trade date (roster v${ROSTER_VERSION}, checked ${ROSTER_CHECKED}).`);
  const before = row(scalise("2022-12-30"));
  assert.deepEqual(ids(playbookTriggers(triage([before]), [before.lead.txn]), before), [], "before 2023-01-03: never classified");
  // McCarthy: in on the day he was elected, out on the day he was removed
  const mc = (traded: string) => row(txn({ txnId: `m-${traded}`, name: "Kevin McCarthy", bioguide: "M001165", traded }));
  for (const [d, want] of [["2023-01-07", ["leader"]], ["2023-01-06", []], ["2023-10-02", ["leader"]], ["2023-10-03", []]] as const) {
    const r = mc(d);
    assert.deepEqual(ids(playbookTriggers(triage([r]), [r.lead.txn]), r), [...want], `McCarthy ${d}`);
  }
  // a cluster whose LEAD is not a leader still triggers on its leader's line, and the reason names who
  const other = txn({ txnId: "c-lead", name: "Member Q", bioguide: "Q000001", traded: "2024-05-02" });
  const cl = row(other, { grouping: "cluster", lines: [other, scalise("2024-05-03")] });
  const tc = playbookTriggers(triage([cl]), [other]);
  assert.deepEqual(ids(tc, cl), ["leader"]);
  assert.match(tc.byRow.get(cl.key)![0]!.why, /^Steve Scalise was the House Republican floor leader on the trade date/);
});

test("T3.2 (LD16): cmte triggers at Cmte medium (a direct match), not at low; with the committee inputs absent it has zero rows and says so", () => {
  const l = txn({ txnId: "cm", ticker: "CM", side: "sale" });
  const r2 = row(l, { cmte: 2 });
  const r1 = row({ ...l, txnId: "cm1" }, { cmte: 1 });
  const t = playbookTriggers(triage([r2, r1]), [l]);
  assert.deepEqual([ids(t, r2), ids(t, r1)], [["cmte"], []]);
  assert.equal(t.counts.cmte, 1);
  assert.equal(t.byRow.get(r2.key)![0]!.why, "Cmte reads medium: the issuer’s SIC sits inside a direct range of a committee the member sat on at the trade date.");
  const off = playbookTriggers(triage([row(l, { cmte: -1 })], false), [l]);
  assert.equal(off.cmteAvailable, false);
  assert.equal(off.counts.cmte, 0);
});

test("T3.2: on the golden public rows (live build 20261013.1) the triggers run end to end: counts equal the rows carrying each hit", () => {
  const f = loadTriageFixture();
  const tr = buildTriage(f.artifact, f.rows, { committee: f.committee, identityOf: f.identityOf });
  const t = playbookTriggers(tr, f.rows);
  for (const id of CONGRESS_PLAYBOOKS) assert.equal(t.counts[id], [...t.byRow.values()].filter((hs) => hs.some((h) => h.id === id)).length, id);
  assert.ok(t.counts.cmte > 0, "the golden rows carry direct committee matches");
  assert.ok([...t.byRow.keys()].every((k) => tr.rows.some((r) => r.key === k)), "every hit names a triage row");
});

/* ---------------------------------------------------------------- T3.4 / T3.5: the surfaces */

let goldenTr: TriageResult | null = null;
function golden(): { tr: TriageResult; artifact: ReturnType<typeof loadTriageFixture>["artifact"] } {
  const f = loadTriageFixture();
  goldenTr ??= buildTriage(f.artifact, f.rows, { committee: f.committee, identityOf: f.identityOf });
  return { tr: goldenTr, artifact: f.artifact };
}
/** Fabricated hits over the golden rows: opp-buy on seven (so "Triggers now"
    lists five and links the rest), leader on a Routine row, cmte as computed. */
function model(over: Partial<PlaybooksModel> = {}): PlaybooksModel {
  const { tr } = golden();
  const real = playbookTriggers(tr, loadTriageFixture().rows);
  const byRow = new Map<string, PlaybookHit[]>();
  const add = (key: string, h: PlaybookHit) => byRow.set(key, [...(byRow.get(key) ?? []), h]);
  for (const [k, hs] of real.byRow) for (const h of hs) add(k, h);
  tr.rows.filter((r) => r.tier !== "routine").slice(0, 7).forEach((r) => add(r.key, { id: "opp-buy", why: "Not routine by the CMP test: fixture." }));
  const routine = tr.rows.find((r) => r.tier === "routine")!;
  add(routine.key, { id: "leader", why: "Fixture Leader was Speaker of the House on the trade date (roster v1, checked 2026-10-18)." });
  const order = (hs: PlaybookHit[]) => [...hs].sort((a, b) => CONGRESS_PLAYBOOKS.indexOf(a.id) - CONGRESS_PLAYBOOKS.indexOf(b.id));
  for (const [k, hs] of byRow) byRow.set(k, order(hs));
  const counts = { "opp-buy": 0, leader: 0, cmte: 0 };
  for (const hs of byRow.values()) for (const h of hs) counts[h.id]++;
  return { triggers: { byRow, counts, cmteAvailable: tr.cmteAvailable, cmp: new Map() }, triage: tr, bestIdeas: 3, consensus: 7, cmteUnavailableReason: null, ...over };
}
/** A golden triage row whose lead line was filed more than 45 days after
    its trade, or null. */
function triageLateRow(m: PlaybooksModel): TriageRow | null {
  return m.triage.rows.find((r) => r.lead.txn.traded !== null && (r.lead.txn.lag ?? 0) > 45) ?? null;
}
function page(m: PlaybooksModel | null = model()): string {
  const { tr, artifact } = golden();
  return signalsBody(artifact, CTX, { rowsEvaluated: 2051, triage: tr, institutional: fixtureInstitutional(), playbooks: m });
}

/** A "Triggers now" table row's honesty fields (R28, from LD10's line):
    ticker, member, party and state, owner, side, range, traded and filed
    dates in their own column, receipt in its own column. */
function triggerRowProblems(tr: MiniElement): string[] {
  const out: string[] = [];
  const cell = (cls: string) => tr.querySelectorAll("td").find((td) => (td.getAttribute("class") ?? "").split(" ").includes(cls)) ?? null;
  if (!cell("c-ticker")?.querySelector(".cl-tk")) out.push("ticker");
  if (!cell("c-member")?.querySelector(".cl-who")) out.push("member");
  if (!cell("c-member")?.querySelector(".aff")) out.push("party and state");
  if (!cell("c-member")?.querySelector(".owner-note")) out.push("owner");
  if (!cell("c-kind")?.querySelector(".si-chip")) out.push("side");
  if (!cell("cl-amt") || !/\$/.test(text(cell("cl-amt")))) out.push("range");
  const dates = cell("cl-dates");
  if (!dates?.querySelector(".si-row-filed time")) out.push("filed date");
  if (!dates?.querySelector(".si-row-traded time") && !/trade date not disclosed/.test(text(dates?.querySelector(".si-row-traded")))) out.push("traded date");
  if (!cell("si-row-src")?.querySelector("a")) out.push("receipt");
  if (tr.getAttribute("role") !== "row" || tr.querySelectorAll("td").some((td) => td.getAttribute("role") !== "cell")) out.push("roles");
  return out;
}

/** A Congress line's honesty fields (LD10): ticker, member, party and state,
    owner, side, range, traded and filed dates, receipt. */
function lineProblems(li: MiniElement): string[] {
  const out: string[] = [];
  if (!li.querySelector(".cl-tk")) out.push("ticker");
  if (!li.querySelector(".cl-who")) out.push("member");
  if (!li.querySelector(".aff")) out.push("party and state");
  if (!li.querySelector(".owner-note")) out.push("owner");
  if (!li.querySelector(".si-chip")) out.push("side");
  if (!li.querySelector(".cl-amt") || !/\$/.test(text(li.querySelector(".cl-amt")))) out.push("range");
  if (!li.querySelector(".si-row-filed time")) out.push("filed date");
  if (!li.querySelector(".si-row-traded time") && !/trade date not disclosed/.test(text(li.querySelector(".si-row-traded")))) out.push("traded date");
  if (!li.querySelector(".si-row-src a, .si-row-src")) out.push("receipt");
  return out;
}

test("T3.4 (R19): the Playbooks tab — the visible 'Not advice' line, six articles with every citation and link, the list as anchors, the statuses", () => {
  const root = domOf(signalsPlaybooksHtml(model(), CTX));
  const disc = root.querySelector(".pb-disc")!;
  assert.match(text(disc).replace(/How to read a playbook.*$/, ""), /^Published research on the patterns these rows show\. Not advice\./);
  assert.equal(disc.querySelector(".note-pop") !== null, true, "and its tip");
  assert.doesNotMatch(text(root.querySelector(".pb-disc .note-pop")), /^Published research/, "the line itself is outside the tip");
  const arts = root.querySelectorAll("article.pb-main");
  assert.deepEqual(arts.map((a) => a.getAttribute("id")), PLAYBOOKS.map((p) => `pb-${p.id}`));
  assert.ok(arts.every((a) => !a.hasAttribute("hidden")), "without script every article shows");
  assert.deepEqual(root.querySelectorAll("a.pbi").map((a) => a.getAttribute("href")), PLAYBOOKS.map((p) => `#pb-${p.id}`), "the list is anchors");
  for (const p of PLAYBOOKS) {
    const a = root.querySelector(`#pb-${p.id}`)!;
    assert.equal(text(a.querySelector(".pb-name")), p.name);
    assert.ok(text(a.querySelector(".pb-verdict")).length > 0);
    const ev = a.querySelectorAll("li.ev");
    assert.equal(ev.length, p.evidence.length, `${p.id}: every evidence entry`);
    p.evidence.forEach((e, i) => {
      assert.equal(ev[i]!.querySelector("a.ev-src")!.getAttribute("href"), e.url);
      assert.equal(text(ev[i]!.querySelector(".ev-f")), e.finding);
      /* R28: venue and sample open as the citation's "Study details" tip */
      assert.equal(text(ev[i]!.querySelector(".ev-c .note-pop .ev-v")), `${e.venue} · ${e.sample}`);
      assert.equal(ev[i]!.querySelector(".ev-c .note-btn")!.getAttribute("aria-label"), "Study details, explain");
    });
    if (p.evidence.length === 0) assert.match(text(a), /No published study found\./);
    assert.ok(a.querySelectorAll(".pb-meta .note-btn").length === 2, `${p.id}: the rule and horizon tips`);
  }
  // statuses: rows, panels, unavailable, descriptive — the
  // list carries each count; an article states its status word (R28: the
  // count is said once, in the list and the article's "Triggers now")
  const st = (id: string) => text(root.querySelector(`a.pbi[data-pb-pick="${id}"] .pb-st`));
  assert.equal(st("opp-buy"), "Live · 7 rows");
  assert.equal(st("best-ideas"), "Live · 3 managers qualify");
  assert.equal(st("consensus"), "Live · 7 names qualify");
  assert.equal(st("overlap"), "Descriptive");
  const ast = (id: string) => text(root.querySelector(`#pb-${id} .pb-st`));
  assert.deepEqual(PLAYBOOKS.map((p) => ast(p.id)), ["Live", "Live", "Live", "Live", "Live", "Descriptive"]);
  assert.equal(root.querySelectorAll(".pb-needs").length, 0, "nothing on the tab says what it still needs");
  // copy item signals-16
  assert.match(text(root.querySelector(".pb-count")), /^6 playbooks · 5 live · \d+ Congress rows trigger one$/);
  // the committee playbook unavailable this build: the list and the article say so
  const off = domOf(signalsPlaybooksHtml(model({ triggers: { ...model().triggers, cmteAvailable: false }, cmteUnavailableReason: "inputs-not-in-build" }), CTX));
  assert.equal(text(off.querySelector('a.pbi[data-pb-pick="cmte"] .pb-st')), "Live · unavailable this build");
  assert.equal(text(off.querySelector("#pb-cmte .pb-st")), "Live · unavailable this build");
  assert.match(text(off.querySelector("#pb-cmte")), /Committee data is not in this build \(inputs-not-in-build\), so no row reads Cmte medium\./);
  // the artifact-only view states the tab is computed on the server, keeping "Not advice" and the way to the research
  const none = domOf(signalsPlaybooksHtml(null, CTX));
  assert.equal(none.querySelectorAll("article.pb-main").length, 0);
  assert.equal(text(none.querySelector(".pb-disc")), "Published research on the patterns these rows show. Not advice.");
  assert.match(text(none), /The Playbooks tab is computed on the server from the build's triage; this view carries the Congress artifact only\./);
  assert.ok(none.querySelector('a[href="/methodology/#signals-playbooks"]'));
});

test("T3.4 (R19, LD16) + launch M5 (R28): 'Triggers now' is a table of up to five rows — the row's lead line's fields as cells, its own dates and receipt columns, a link to its row, and 'All n' past five; a removal control fails", () => {
  const m = model();
  const root = domOf(signalsPlaybooksHtml(m, CTX));
  const table = root.querySelector("#pb-opp-buy table.pb-tg")!;
  assert.ok(table, "a table, not a list");
  assert.equal(table.getAttribute("role"), "table");
  assert.equal(table.getAttribute("data-card"), "generic");
  assert.deepEqual(table.querySelectorAll("thead th").map((th) => [th.getAttribute("role"), text(th)]), TRIGGER_COLUMNS.map((c) => ["columnheader", c]));
  assert.ok(table.querySelectorAll("thead th").every((th) => th.querySelector(".visually-hidden")), "the heads fold through the clip pattern, still announced");
  const rows = table.querySelectorAll("tbody tr.pb-row");
  assert.equal(rows.length, PLAYBOOK_TRIGGER_ROWS);
  const triggered = m.triage.rows.filter((r) => m.triggers.byRow.get(r.key)?.some((h) => h.id === "opp-buy"));
  rows.forEach((r, i) => {
    assert.deepEqual(triggerRowProblems(r), [], `row ${i}`);
    assert.equal(r.querySelector("a.pb-row-open")!.getAttribute("href"), `#${triageRowId(triggered[i]!)}`);
    assert.match(text(r.querySelector("a.pb-row-open")), /, show the row in Filings to read$/, "the ticker link names where it goes");
  });
  assert.equal(root.querySelector("#pb-opp-buy a.pb-all")!.getAttribute("href"), "#triage");
  assert.match(text(root.querySelector("#pb-opp-buy a.pb-all")), /^All 7 rows in Filings to read →$/);
  // the cells are the one Congress line's fields — the same source as congressLineHtml
  const f = congressLineFields(triggered[0]!.lead.txn, CTX);
  const cells = rows[0]!.querySelectorAll("td");
  /* launch review M2: the member's field, its link marked as the row's main link */
  assert.equal(cells[1]!.querySelector(".cl-who")!.innerHTML, rowLink(f.who));
  assert.equal(rows[0]!.querySelectorAll("a[data-row-link]").length, f.who.includes("<a ") ? 1 : 0, "one main link, the member's");
  assert.equal(cells[2]!.innerHTML, f.side);
  assert.equal(cells[3]!.innerHTML, f.amt);
  assert.ok(cells[4]!.innerHTML.startsWith(f.dates), "its own dates column");
  assert.equal(cells[5]!.innerHTML, f.src, "its own receipt column");
  assert.equal(congressLineHtml(triggered[0]!.lead.txn, CTX, { ticker: true }), `<li class="cl-line"><span class="mono-ticker cl-tk">${f.ticker}</span><span class="cl-who">${f.who}</span>${f.side}<span class="cl-amt">${f.amt}</span><span class="cl-dates">${f.dates}</span><span class="si-row-src cl-src">${f.src}</span></li>`);
  // late in amber, and in words for assistive technology
  const late = triageLateRow(m);
  assert.ok(late, "the golden rows carry a lead line filed past 45 days");
  const lt = domOf(triggerTableHtml(PLAYBOOKS[0]!, [late!], CTX)).querySelector("tr.pb-row")!;
  assert.ok(lt.querySelector("td.c-filed .si-late"), "the lag in amber past 45 days");
  assert.match(text(lt.querySelector("td.c-filed")), /, late$/);
  assert.doesNotMatch(text(rows.find((r) => !r.querySelector(".si-late"))?.querySelector("td.c-filed")), /, late$/, "an on-time row says nothing");
  // removal controls: a row without its owner, dates or receipt is caught
  for (const [cut, want] of [[/<span class="owner-note">[^<]*<\/span>/, "owner"], [/<span class="si-row-filed">[\s\S]*?<\/time><\/span>/, "filed date"], [/<td class="c-src si-row-src" role="cell">[\s\S]*?<\/td>/, "receipt"]] as const) {
    const planted = domOf(`<table><tbody>${rows[0]!.outerHTML.replace(cut, "")}</tbody></table>`);
    assert.ok(triggerRowProblems(planted.querySelector("tr")!).includes(want), `control: ${want}`);
  }
  // panel playbooks state their count and link their panel; overlap links its tab
  assert.match(text(root.querySelector("#pb-best-ideas .pb-sec")), /3 managers qualify this quarter\./);
  assert.ok(root.querySelector('#pb-best-ideas a[href="#new-position-leaders"] .ref-label'), "the leaders' label through its markup");
  assert.ok(root.querySelector('#pb-consensus a[href="#consensus"]'));
  assert.ok(root.querySelector('#pb-overlap a[href="#overlap"]'));
  // a live Congress playbook with no row this build says so
  const empty = domOf(signalsPlaybooksHtml(model({ triggers: { byRow: new Map(), counts: { "opp-buy": 0, leader: 0, cmte: 0 }, cmteAvailable: true, cmp: new Map() } }), CTX));
  /* copy item signals-12: the empty state is one short computed line */
  assert.match(text(empty.querySelector("#pb-leader")), /Triggers nowNo ranked row triggers it\./);
  assert.equal(empty.querySelectorAll("#pb-leader table").length, 0, "no empty table");
});

test("T3.5 (R21): a triggered row carries data-pb tokens and a dashed chip per playbook leading line 2's reason (never beside the filer's name), and opened, each playbook's name, verdict, why and link; an untriggered row carries none", () => {
  const { tr } = golden();
  const r = tr.rows[0]!;
  const hits: PlaybookHit[] = [{ id: "opp-buy", why: "why one" }, { id: "leader", why: "why two" }];
  const el = domOf(triageRowHtml(r, CTX, { playbooks: hits })).querySelector("article.si-row")!;
  assert.equal(el.getAttribute("data-pb"), "opp-buy leader");
  const chips = el.querySelectorAll("summary .si-row-why .si-row-tags .pb-chip");
  assert.equal(el.querySelectorAll("summary .si-row-who .pb-chip").length, 0, "no chip beside the name: it squeezed the name on production data");
  assert.deepEqual(chips.map((c) => text(c)), ["OPP. BUY, triggers the Opportunistic member buy playbook", "LEADER, triggers the Leadership trade playbook"]);
  const sec = el.querySelectorAll(".si-row-det .si-row-pb-one");
  assert.equal(sec.length, 2);
  assert.equal(text(sec[0]!.querySelector(".si-row-pb-h")), "OPP. BUY Opportunistic member buy Playbook →");
  assert.equal(text(sec[0]!.querySelector(".si-row-pb-v")), PLAYBOOKS[0]!.verdict);
  assert.equal(text(sec[0]!.querySelector(".si-mw-def")), "why one");
  assert.equal(sec[1]!.querySelector("a")!.getAttribute("href"), "#pb-leader");
  assert.doesNotMatch(el.querySelector("summary")!.innerHTML, /<a\s|<button\s/, "no control in the summary");
  const plain = domOf(triageRowHtml(r, CTX)).querySelector("article.si-row")!;
  assert.equal(plain.getAttribute("data-pb"), null);
  assert.equal(plain.querySelectorAll(".pb-chip").length, 0);
  assert.equal(triageRowHtml(r, CTX), triageRowHtml(r, CTX, { playbooks: [] }), "no hits: the v4 M1 row, byte for byte");
});

test("T3.5 (R21): the Playbooks filter above Filings to read counts the triggered rows; the committee chip says 'unavailable this build' when it is; the page's rows carry the tokens the counts count", () => {
  const m = model();
  const root = domOf(page(m));
  const triageEl = root.querySelector("#triage")!;
  const filter = triageEl.querySelector(".si-pb-filter")!;
  assert.ok(filter, "inside Filings to read, above the rows");
  const chips = filter.querySelectorAll("button[data-pb-filter]");
  assert.deepEqual(chips.map((c) => c.getAttribute("data-pb-filter")), ["opp-buy", "leader", "cmte"]);
  for (const c of chips) {
    const id = c.getAttribute("data-pb-filter")!;
    const n = triageEl.querySelectorAll("article.si-row").filter((r) => (r.getAttribute("data-pb") ?? "").split(" ").includes(id)).length;
    assert.equal(text(c.querySelector(".tk-tab-n")), String(n), `${id}: the count is the rows carrying its token`);
    assert.equal(n, m.triggers.counts[id as "opp-buy"]);
  }
  const off = domOf(playbookFilterHtml(model({ triggers: { ...m.triggers, cmteAvailable: false } })));
  const cm = off.querySelector('button[data-pb-filter="cmte"]')!;
  assert.equal(cm.getAttribute("aria-disabled"), "true");
  assert.equal(text(cm.querySelector(".tk-tab-n")), "unavailable this build");
  // no playbooks dep: no filter, no chip, no token
  const bare = domOf(page(null));
  assert.equal(bare.querySelectorAll("#congress .si-pb-filter, #congress .pb-chip, #congress article.si-row[data-pb]").length, 0);
});

test("T3.5 (R21): the strips — Consensus and the leaders link their playbooks, Overlap its own; only where the page renders the Playbooks tab", () => {
  const inst = signalsInstitutionalHtml(fixtureInstitutional(), CTX, { playbooks: true });
  const root = domOf(inst);
  assert.equal(root.querySelector("#consensus .panel-head a.pb-strip")!.getAttribute("href"), "#pb-consensus");
  assert.match(text(root.querySelector("#consensus a.pb-strip")), /^CONSENSUS weak — the Notable-manager consensus playbook$/);
  assert.equal(root.querySelector("#new-position-leaders .panel-head a.pb-strip")!.getAttribute("href"), "#pb-best-ideas");
  assert.equal(signalsInstitutionalHtml(fixtureInstitutional(), CTX), signalsInstitutionalHtml(fixtureInstitutional(), CTX, {}), "without the Playbooks tab: M2's markup, byte for byte");
  assert.doesNotMatch(signalsInstitutionalHtml(fixtureInstitutional(), CTX), /pb-strip/);
  const full = domOf(page());
  assert.equal(full.querySelector("#overlap a.pb-strip")!.getAttribute("href"), "#pb-overlap");
  for (const a of full.querySelectorAll("a.pb-strip")) assert.ok(full.querySelector(a.getAttribute("href")!), `${a.getAttribute("href")} exists on the page`);
  // Overlap alone, or a page without the Playbooks tab: no strip, so no link to a playbook the page does not carry
  assert.doesNotMatch(signalsOverlapHtml(fixtureOverlap(), CTX), /pb-strip/);
  assert.match(signalsOverlapHtml(fixtureOverlap(), CTX, { playbooks: true }), /<a class="pb-strip" href="#pb-overlap">/);
  assert.doesNotMatch(page(null).replace(/[\s\S]*?<section class="tk-panel sig-panel" role="tabpanel" id="overlap"/, ""), /pb-strip/);
});

test("T3.6 (R27): Methodology #signals-playbooks — the seven rules with every citation and link, the CMP adaptation with its constants, and the roster table equal to ROSTER", async () => {
  const { ROSTER } = await import("../src/lib/leadership-roster.ts");
  const root = domOf(signalsPlaybooksMethodHtml());
  const sec = root.querySelector("section#signals-playbooks")!;
  const t = text(sec);
  assert.match(t, /adapts it to members of Congress/);
  assert.match(t, new RegExp(`each of the ${CMP_YEARS} prior calendar years`));
  assert.match(t, new RegExp(`at most ${BROAD_ACCOUNT_NAMES} distinct tickers in the ${OPP_BREADTH_DAYS} days before the trade`));
  assert.match(t, /The roster \(v1\) starts 2023-01-03: a trade before it is never classified\./);
  for (const p of PLAYBOOKS) for (const e of p.evidence) assert.ok(sec.querySelector(`a[href="${e.url}"]`), `${p.id}: ${e.url}`);
  const trs = sec.querySelectorAll("tbody tr");
  assert.equal(trs.length, ROSTER.length);
  ROSTER.forEach((r, i) => {
    const cells = trs[i]!.querySelectorAll("td").map((c) => text(c));
    assert.ok(cells[1]!.includes(r.name) && cells[1]!.includes(r.bioguide));
    assert.ok(cells[2]!.startsWith(r.from));
    assert.equal(cells[3], r.to ?? "current");
    assert.equal(trs[i]!.querySelector("a")!.getAttribute("href"), r.source);
    assert.ok(cells[5]!.endsWith(`checked ${r.checked}`));
  });
  assert.deepEqual(scanBannedWording(sec.innerHTML), []);
  assert.deepEqual(RULE3_PATTERNS.filter(({ re }) => re.test(visibleCopy(sec.innerHTML))).map((p) => p.name), []);
});

/* ---------------------------------------------------------------- the client */

interface Mount {
  doc: ReturnType<typeof installDom>["doc"];
  loc: { hash: string };
  fire(hash: string): void;
  restore(): void;
}
function mount(html: string, hash = ""): Mount {
  const dom = installDom(html);
  const g = globalThis as unknown as Record<string, unknown>;
  const prev = { window: g.window, location: g.location, history: g.history };
  const listeners = new Map<string, (() => void)[]>();
  g.window = { matchMedia: () => ({ matches: false, addEventListener() {} }), addEventListener: (t: string, fn: () => void) => void listeners.set(t, [...(listeners.get(t) ?? []), fn]) };
  const loc = { hash };
  g.location = loc;
  g.history = { pushState: (_s: unknown, _t: string, url: string) => void (loc.hash = url), replaceState: (_s: unknown, _t: string, url: string) => void (loc.hash = url) };
  let onHash: (() => void) | null = null;
  const env = { location: loc, history: { replaceState: (_d: unknown, _u: string, url?: string) => void (loc.hash = url ?? loc.hash) }, getElementById: (id: string) => dom.doc.getElementById(id) as unknown as Element | null, onHashChange: (fn: () => void) => void (onHash = fn) };
  const proto = MiniElement.prototype as unknown as { scrollIntoView?: () => void };
  proto.scrollIntoView = function () {};
  initSignalsPage({ tabsEnv: env });
  return {
    doc: dom.doc,
    loc,
    fire(h: string) {
      loc.hash = h;
      onHash?.();
      for (const fn of listeners.get("hashchange") ?? []) fn();
    },
    restore() {
      delete proto.scrollIntoView;
      dom.restore();
      g.window = prev.window;
      g.location = prev.location;
      g.history = prev.history;
    },
  };
}
const shownArticles = (doc: Mount["doc"]): string[] => doc.querySelectorAll("article.pb-main").filter((a) => !a.hasAttribute("hidden")).map((a) => a.getAttribute("id")!);

test("T3.4 (R19, LD8): with script one article shows — the first; a list link, a strip and a row's 'Playbook →' each select theirs through revealTarget (the tab, the article, the hash)", () => {
  const m = mount(page());
  try {
    const doc = m.doc;
    assert.deepEqual(shownArticles(doc), ["pb-opp-buy"]);
    assert.equal(doc.querySelector('a[data-pb-pick="opp-buy"]')!.getAttribute("aria-current"), "true");
    // a list link
    doc.querySelector('a[data-pb-pick="cmte"]')!.bubbleClick();
    assert.deepEqual(shownArticles(doc), ["pb-cmte"]);
    assert.equal(doc.querySelector('a[data-pb-pick="cmte"]')!.getAttribute("aria-current"), "true");
    assert.equal(doc.querySelector('a[data-pb-pick="opp-buy"]')!.getAttribute("aria-current"), null);
    assert.equal(m.loc.hash, "#pb-cmte");
    assert.equal(doc.getElementById("tab-playbooks")!.getAttribute("aria-selected"), "true");
    // a strip on the Institutional tab selects the Playbooks tab and its playbook
    doc.getElementById("tab-institutional")!.click();
    doc.querySelector('#consensus a.pb-strip')!.bubbleClick();
    assert.equal(doc.getElementById("tab-playbooks")!.getAttribute("aria-selected"), "true");
    assert.equal(doc.getElementById("playbooks")!.hasAttribute("hidden"), false);
    assert.deepEqual(shownArticles(doc), ["pb-consensus"]);
    // a row's "Playbook →"
    doc.getElementById("tab-congress")!.click();
    const link = doc.querySelector('article.si-row[data-pb] .si-row-pb a[href="#pb-leader"]')!;
    link.bubbleClick();
    assert.deepEqual(shownArticles(doc), ["pb-leader"]);
    // a hash on hashchange
    m.fire("#pb-best-ideas");
    assert.deepEqual(shownArticles(doc), ["pb-best-ideas"]);
  } finally {
    m.restore();
  }
  // a hash on load
  const l = mount(page(), "#pb-overlap");
  try {
    assert.deepEqual(shownArticles(l.doc), ["pb-overlap"]);
    assert.equal(l.doc.getElementById("tab-playbooks")!.getAttribute("aria-selected"), "true");
  } finally {
    l.restore();
  }
});

test("T3.5 (R21): the filter shows only the rows that trigger the playbook, opens Routine when one matches there, says how many; pressing it again shows every row; a disabled chip does nothing", () => {
  const m = mount(page());
  try {
    const doc = m.doc;
    const rows = () => doc.querySelectorAll("#triage article.si-row");
    const shown = () => rows().filter((r) => !r.hasAttribute("hidden"));
    const all = rows().length;
    const routine = doc.getElementById("routine")!;
    assert.equal(routine.hasAttribute("open"), false, "Routine starts closed");
    doc.querySelector('button[data-pb-filter="leader"]')!.click();
    assert.ok(shown().length > 0 && shown().every((r) => (r.getAttribute("data-pb") ?? "").split(" ").includes("leader")));
    assert.equal(shown().length, model().triggers.counts.leader);
    assert.equal(routine.hasAttribute("open"), true, "the leader row is in Routine: it opens");
    assert.equal(doc.querySelector('button[data-pb-filter="leader"]')!.getAttribute("aria-pressed"), "true");
    assert.match(text(doc.getElementById("si-pb-status")), /^1 row triggers Leadership trade\. Choose it again to show every row\.$/);
    // a tier with no match states it
    assert.equal(doc.querySelector("#stands .si-pb-none")!.hasAttribute("hidden"), false);
    doc.querySelector('button[data-pb-filter="opp-buy"]')!.click();
    assert.equal(shown().length, 7);
    assert.equal(doc.querySelector("#stands .si-pb-none")!.hasAttribute("hidden"), true);
    doc.querySelector('button[data-pb-filter="opp-buy"]')!.click();
    assert.equal(shown().length, all, "pressed again: every row");
    assert.equal(doc.getElementById("si-pb-status")!.hasAttribute("hidden"), true);
  } finally {
    m.restore();
  }
  const off = mount(page(model({ triggers: { ...model().triggers, cmteAvailable: false } })));
  try {
    const before = off.doc.querySelectorAll("#triage article.si-row[hidden]").length;
    off.doc.querySelector('button[data-pb-filter="cmte"]')!.click();
    assert.equal(off.doc.querySelectorAll("#triage article.si-row[hidden]").length, before, "an unavailable playbook filters nothing");
    assert.equal(off.doc.querySelector('button[data-pb-filter="cmte"]')!.getAttribute("aria-pressed"), "false");
  } finally {
    off.restore();
  }
});

test("T3.4 (LD8): a 'Triggers now' row link to a row the filter excludes, or in closed Routine, clears the filter or opens Routine, then opens the row; 'All n' sets the filter and goes to Filings to read", () => {
  const m = mount(page());
  try {
    const doc = m.doc;
    const tr = model().triage;
    const routineRow = tr.rows.find((r) => r.tier === "routine")!;
    // the filter set to opp-buy hides the Routine leader row
    doc.querySelector('button[data-pb-filter="opp-buy"]')!.click();
    const target = doc.getElementById(triageRowId(routineRow))!;
    assert.equal(target.hasAttribute("hidden"), true);
    doc.getElementById("tab-playbooks")!.click();
    doc.querySelector(`#pb-leader a.pb-row-open[href="#${triageRowId(routineRow)}"]`)!.bubbleClick();
    assert.equal(doc.getElementById("tab-congress")!.getAttribute("aria-selected"), "true");
    assert.equal(target.hasAttribute("hidden"), false, "the filter that hid it is cleared");
    assert.equal(doc.querySelector('button[data-pb-filter="opp-buy"]')!.getAttribute("aria-pressed"), "false");
    assert.equal(doc.getElementById("routine")!.hasAttribute("open"), true, "closed Routine opens");
    assert.equal(target.querySelector("details")!.hasAttribute("open"), true, "the row opens");
    // "All 7 in Filings to read" sets the filter and reveals the triage
    doc.getElementById("tab-playbooks")!.click();
    doc.querySelector("#pb-opp-buy a.pb-all")!.bubbleClick();
    assert.equal(doc.querySelector('button[data-pb-filter="opp-buy"]')!.getAttribute("aria-pressed"), "true");
    assert.equal(doc.getElementById("tab-congress")!.getAttribute("aria-selected"), "true");
    assert.equal(doc.querySelectorAll("#triage article.si-row").filter((r) => !r.hasAttribute("hidden")).length, 7);
  } finally {
    m.restore();
  }
});
