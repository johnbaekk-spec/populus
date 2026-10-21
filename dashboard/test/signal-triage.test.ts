/* signals-v3 M2 (T2.3–T2.5; R6–R9, R11, R25; LD3–LD6): the Signals triage.

   Every LD3/LD4 rule has a test here that FAILS if the rule is removed: the
   meter boundaries, point in time (a row filed after the cutoff never changes
   a meter), the delayed-member regression, the per-grouping cutoffs, each
   grouping rule, the tier, lead line and sort, the sentence templates and the
   card rankings. The golden cases of PLAN.md success criterion 2 run over a
   fixture cut from PUBLIC rows of live build 20261013.1; where the locked
   rule disagrees with the plan's expectation, the RULE wins and the case is
   asserted as computed, with the plan's text beside it (DEV-NOTES lists them). */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  BRACKET_LOWER_BOUNDS,
  LEVEL_WORDS,
  METER_KEYS,
  SENTENCE_MAX,
  TIER_LABELS,
  TRIAGE_VERSION,
  bracketOf,
  buildTriage,
  combineMeters,
  committeeFact,
  compareRows,
  daysBetween,
  monthYear,
  pickLead,
  rowSentence,
  sentenceClauses,
  tierOf,
  type LineScore,
  type Meters,
  type TriageCommitteeInputs,
  type TriageResult,
  type TriageRow,
} from "../src/lib/signal-triage.ts";
import type { Signal, SignalArtifact, SignalKind, WithheldKind } from "../src/lib/signals.ts";
import type { TxnRow } from "../src/lib/format.ts";
import { BANNED_WORDING, scanBannedWording } from "../src/lib/activity.ts";
import { BANNED_PATTERNS } from "./lib/banned-scan.ts";
import { loadTriageFixture } from "./lib/triage-fixture.ts";
import { triageRowHtml } from "../src/lib/ui/index.ts";
import { MiniElement } from "./lib/mini-dom.ts";

/* ================================================================ synthetic builders */

const COV_FROM = "2026-07-15";
const COV_TO = "2026-10-13";
let seq = 0;
const docOf = (name: string): string => `https://disclosures-clerk.house.gov/public_disc/ptr-pdfs/2026/${name}.pdf`;

function row(over: Partial<TxnRow> = {}): TxnRow {
  seq++;
  return {
    kind: "txn",
    txnId: `t${seq}`,
    filed: "2026-09-01",
    traded: "2026-08-20",
    name: "Member A",
    bioguide: "A000001",
    party: "D",
    state: "CA",
    district: "1",
    chamber: "house",
    ticker: "AAA",
    side: "purchase",
    owner: "self",
    low: 1001,
    high: 15000,
    lag: 12,
    late: 0,
    flags: [],
    doc: docOf("F"),
    asset: "Aaa Inc (AAA) [ST]",
    assetType: "ST",
    ...over,
  };
}

/** A per-row signal whose identity line is `r` (id `${kind}:${txnId}`). */
function sigOf(kind: Exclude<SignalKind, "s3-cooccurrence">, r: TxnRow): Signal {
  return {
    id: `${kind}:${r.txnId}`,
    kind,
    rule: `${kind} rule`,
    thresholdVersion: "1.0.0",
    entities: { bioguide: r.bioguide, memberName: r.name, ticker: r.ticker },
    magnitude: { low: r.low, high: r.high },
    receipts: [r.doc],
    occurrence: { tradeDate: r.traded, filedDate: r.filed },
    sourceAvailableAt: r.filed,
    computedAt: "2026-10-13 00:00 UTC",
    firstSeenBuild: "b",
    lastSeenBuild: "b",
    status: "active",
    cohort: r.chamber,
    asset: r.asset,
    assetType: r.assetType,
    side: r.side,
    owner: r.owner,
    listedStock: r.assetType === "ST" || r.assetType === "Stock",
  };
}

/** An active S-3 over `ticker`/`side` from `start`, as the artifact records it. */
function s3Sig(ticker: string, side: "purchase" | "sale", start: string, filedDate: string, members: number): Signal {
  return {
    id: `s3-cooccurrence:${ticker}-${side}-${start}`,
    kind: "s3-cooccurrence",
    rule: "s3 rule",
    thresholdVersion: "1.0.0",
    entities: { bioguide: null, memberName: `${members} members`, ticker },
    magnitude: { low: 0, high: null },
    receipts: [docOf("s3")],
    occurrence: { tradeDate: start, filedDate },
    sourceAvailableAt: filedDate,
    computedAt: "2026-10-13 00:00 UTC",
    firstSeenBuild: "b",
    lastSeenBuild: "b",
    status: "active",
    cohort: "house",
    side,
    listedStock: true,
  };
}

function artifact(signals: Signal[], withheld: WithheldKind[] = []): SignalArtifact {
  return {
    v: 1, buildId: "b", computedAt: "2026-10-13 00:00 UTC", thresholdVersion: "1.0.0", retentionDays: 90,
    coverageFrom: COV_FROM, coverageTo: COV_TO, lifecycleNote: "n", compaction: "c", dateAnomaliesExcluded: 0,
    signals, withheld, lagCaveat: "lag",
  };
}

const ID = (s: Signal): string => s.id.slice(s.id.indexOf(":") + 1);

function triage(rows: TxnRow[], signals: Signal[], opts: { committee?: TriageCommitteeInputs | null; withheld?: WithheldKind[] } = {}): TriageResult {
  return buildTriage(artifact(signals, opts.withheld ?? []), rows, { committee: opts.committee ?? null, identityOf: ID });
}

function lineOf(t: TriageResult, txnId: string): LineScore {
  const l = t.rows.flatMap((r) => r.lines).find((x) => x.txn.txnId === txnId);
  assert.ok(l, `line ${txnId} is ranked`);
  return l!;
}

/** `n` prior rows of member A, each in its own filing, filed and traded before the line. */
function history(n: number, low: number | ((i: number) => number), over: Partial<TxnRow> = {}): TxnRow[] {
  return Array.from({ length: n }, (_, i) =>
    row({ doc: docOf(`H${seq}-${i}`), traded: `2025-0${(i % 9) + 1}-10`, filed: `2025-0${(i % 9) + 1}-20`, low: typeof low === "number" ? low : low(i), ...over }),
  );
}

/* ================================================================ brackets */

test("LD3: the bracket lower bounds are normalize.py's _AMOUNT_BUCKETS", () => {
  const py = readFileSync(path.resolve(import.meta.dirname, "..", "..", "src", "populus", "normalize.py"), "utf-8");
  const block = py.slice(py.indexOf("_AMOUNT_BUCKETS"), py.indexOf("}", py.indexOf("_AMOUNT_BUCKETS")));
  const lows = [...block.matchAll(/\((\d[\d_]*),\s*(?:\d[\d_]*|None)\)/g)].map((m) => Number(m[1]!.replace(/_/g, "")));
  assert.equal(lows.length, 10, "the parser read all ten buckets (control)");
  assert.deepEqual([...BRACKET_LOWER_BOUNDS], lows);
  assert.equal(bracketOf(1001), 0);
  assert.equal(bracketOf(15000), 0);
  assert.equal(bracketOf(15001), 1);
  assert.equal(bracketOf(50000), 1);
  assert.equal(bracketOf(50001), 2);
  assert.equal(bracketOf(50000001), 9);
  assert.equal(bracketOf(0), -1, "below the first bucket");
});

/* ================================================================ Size (LD3) */

function sizeOf(lineLow: number, hist: TxnRow[], over: Partial<TxnRow> = {}): LineScore {
  const L = row({ doc: docOf(`L${seq}`), low: lineLow, high: null, ...over });
  return lineOf(triage([...hist, L], [sigOf("s1-large", L)]), L.txnId);
}

test("Size: b ≥ 1 with low ≥ 50,001 is 3; at 50,000 the bracket does not rise (b = 0) and the 90% rule gives 1", () => {
  assert.equal(sizeOf(50001, history(5, 15001)).meters.size, 3);
  assert.equal(sizeOf(50000, history(5, 15001)).meters.size, 1);
  assert.equal(sizeOf(50001, history(5, 15001)).bracketDelta, 1);
  assert.equal(sizeOf(50000, history(5, 15001)).bracketDelta, 0);
});

test("Size: 2 for b ≥ 1 below 50,001, and for b = 0 at or above 50,001", () => {
  assert.equal(sizeOf(15001, history(5, 1001)).meters.size, 2, "b = 1, low 15,001");
  assert.equal(sizeOf(50001, history(5, 50001)).meters.size, 2, "b = 0, low 50,001");
  assert.equal(sizeOf(50001, history(5, (i) => (i === 0 ? 100001 : 1001))).meters.size, 0, "b = -1 and 4 of 5 below (80%): 0");
});

test("Size: 1 needs low ≥ 15,001 and at least 90% of the prior lower bounds below it", () => {
  // b = 0 in both: the prior max sits in the line's bracket
  assert.equal(sizeOf(15001, history(10, (i) => (i === 0 ? 15001 : 1001))).meters.size, 1, "9 of 10 below = 90%");
  assert.equal(sizeOf(15001, history(10, (i) => (i < 2 ? 15001 : 1001))).meters.size, 0, "8 of 10 below = 80%");
  assert.equal(sizeOf(15000, history(10, 1001)).meters.size, 0, "below 15,001 never reaches 1 (b = 0)");
});

test("Size: fewer than 5 prior rows with a lower bound is -1 (unknown)", () => {
  assert.equal(sizeOf(50001, history(4, 15001)).meters.size, -1);
  assert.equal(sizeOf(50001, history(5, 15001)).meters.size, 3);
  // rows without a lower bound do not count toward the five
  assert.equal(sizeOf(50001, [...history(4, 15001), ...history(3, 0, { low: null })]).meters.size, -1);
});

test("Size, point in time: a prior row filed AFTER the cutoff, traded after the line, or in the same filing never counts", () => {
  const hist = history(4, 15001);
  const late = row({ doc: docOf("late"), traded: "2025-01-05", filed: "2026-09-02", low: 15001 }); // filed after C = 2026-09-01
  assert.equal(sizeOf(50001, [...hist, late]).meters.size, -1, "a 5th row filed after the cutoff is invisible");
  assert.equal(sizeOf(50001, [...hist, { ...late, filed: "2026-09-01" }]).meters.size, 3, "control: filed ON the cutoff it counts");
  const after = row({ doc: docOf("after"), traded: "2026-08-25", filed: "2026-08-30", low: 15001 }); // traded after L (08-20)
  assert.equal(sizeOf(50001, [...hist, after]).meters.size, -1, "a row traded after the line is not prior");
  const big = row({ doc: docOf("big"), traded: "2025-02-01", filed: "2026-09-05", low: 5000001 });
  assert.equal(sizeOf(50001, [...history(5, 15001), big]).meters.size, 3, "a larger row filed after the cutoff never lowers the line's Size");
  // the same filing's own rows are not history
  const L = row({ doc: docOf("same"), low: 50001, high: null });
  const sib = Array.from({ length: 5 }, (_, i) => row({ doc: docOf("same"), traded: `2025-0${i + 1}-01`, low: 15001 }));
  assert.equal(lineOf(triage([L, ...sib], [sigOf("s1-large", L)]), L.txnId).meters.size, -1);
});

/* ================================================================ Pattern (LD3) */

function patternAtGap(gapDays: number | null, over: Partial<TxnRow> = {}): LineScore {
  const t0 = "2026-08-20";
  const prior =
    gapDays === null
      ? []
      : [row({ doc: docOf(`P${seq}`), traded: new Date(Date.parse(t0) - gapDays * 86_400_000).toISOString().slice(0, 10), filed: "2026-01-01", ...over })];
  const L = row({ doc: docOf(`L${seq}`), traded: t0 });
  return lineOf(triage([...prior, L], [sigOf("s2-first", L)]), L.txnId);
}

test("Pattern: 730/729, 365/364 and 180/179 day boundaries; the first filing on record is 3", () => {
  const cases: [number | null, number][] = [[730, 3], [729, 2], [365, 2], [364, 1], [180, 1], [179, 0], [1, 0], [null, 3]];
  for (const [gap, level] of cases) assert.equal(patternAtGap(gap).meters.pattern, level, `gap ${gap}`);
  assert.equal(patternAtGap(0).meters.pattern, 3, "a trade ON t0 is not prior (traded < t0): still the first on record");
  const first = patternAtGap(null);
  assert.equal(first.pattern.firstOnRecord, true);
  assert.equal(patternAtGap(400).pattern.lastPrior, "2025-07-16");
  assert.equal(patternAtGap(400).pattern.gapDays, 400);
});

test("Pattern, point in time: a prior trade FILED after the cutoff is invisible — the filing is still the first on record", () => {
  const p = patternAtGap(100, { filed: "2026-09-02" }); // C = 2026-09-01
  assert.equal(p.meters.pattern, 3);
  assert.equal(p.pattern.firstOnRecord, true);
  assert.equal(patternAtGap(100, { filed: "2026-09-01" }).meters.pattern, 0, "control: filed on the cutoff, it is seen");
});

test("Pattern is per filing: t0 is the filing's EARLIEST trade, so every line of the filing shares it", () => {
  const prior = row({ doc: docOf("prior"), traded: "2025-01-01", filed: "2025-02-01" });
  const a = row({ doc: docOf("F2"), traded: "2026-08-20", ticker: "AAA" });
  const b = row({ doc: docOf("F2"), traded: "2025-07-01", ticker: "BBB" }); // the filing's t0
  const t = triage([prior, a, b], [sigOf("s2-first", a), sigOf("s2-first", b)]);
  // gap 2025-01-01 → 2025-07-01 = 181 days → 1, for BOTH lines
  assert.equal(lineOf(t, a.txnId).meters.pattern, 1);
  assert.equal(lineOf(t, b.txnId).meters.pattern, 1);
});

/* ================================================================ Others (LD3) */

/** An S-3 window ZZZ purchase from 2026-08-01 with `filedBy` members filed by
    2026-08-20 and the rest later; member M1's line is the one scored. */
function othersCase(filedBy: number, total: number): { rows: TxnRow[]; s3: Signal; line: TxnRow } {
  const rows: TxnRow[] = [];
  let line: TxnRow | null = null;
  for (let i = 1; i <= total; i++) {
    const r = row({
      doc: docOf(`Z${seq}-${i}`),
      bioguide: `M00000${i}`,
      name: `Member ${i}`,
      ticker: "ZZZ",
      traded: `2026-08-0${i}`,
      filed: i <= filedBy ? "2026-08-20" : "2026-09-10",
      low: 1001,
    });
    rows.push(r);
    if (i === 1) line = r;
  }
  return { rows, s3: s3Sig("ZZZ", "purchase", "2026-08-01", "2026-09-10", total), line: line! };
}

test("Others: 5 members filed by the cutoff is 3, 4 is 2, 3 is 0; no active window is 0", () => {
  for (const [n, level] of [[5, 3], [4, 2], [3, 0]] as const) {
    const c = othersCase(n, n);
    const t = triage(c.rows, [c.s3, sigOf("s2-first", c.line)]);
    assert.equal(lineOf(t, c.line.txnId).meters.others, level, `${n} members`);
    assert.equal(lineOf(t, c.line.txnId).others.members, n);
  }
  const lone = row({ doc: docOf("lone"), ticker: "QQQ" });
  assert.equal(lineOf(triage([lone], [sigOf("s2-first", lone)]), lone.txnId).meters.others, 0);
});

test("Others: a sale clusters with a partial sale (S-3's side class), never with a purchase", () => {
  const rows = [1, 2, 3, 4, 5].map((i) => row({ doc: docOf(`S${i}`), bioguide: `S00000${i}`, ticker: "SSS", side: i % 2 ? "sale" : "sale_partial", traded: `2026-08-0${i}`, filed: "2026-08-20" }));
  const buy = row({ doc: docOf("Sbuy"), bioguide: "S000009", ticker: "SSS", side: "purchase", traded: "2026-08-03", filed: "2026-08-20" });
  const t = triage([...rows, buy], [s3Sig("SSS", "sale", "2026-08-01", "2026-08-20", 5), sigOf("s2-first", rows[1]!), sigOf("s2-first", buy)]);
  assert.equal(lineOf(t, rows[1]!.txnId).meters.others, 3, "a partial sale counts in the sale window");
  assert.equal(lineOf(t, buy.txnId).meters.others, 0, "a purchase is outside the sale window");
});

test("T2.3 delayed-member regression: an earlier filing keeps Others at its at-cutoff level; the cluster row, cut off at its latest absorbed filing, reaches 3", () => {
  // S-3 ZZZ purchases from 2026-08-01, five members; the 4th and 5th file on 2026-09-10.
  const c = othersCase(3, 5);
  // Member 1's filing F is ALSO a bigger line in another ticker, which leads it,
  // so F is a single-filing row with one line inside the window.
  const big = row({ doc: c.line.doc, bioguide: "M000001", name: "Member 1", ticker: "BIG", traded: "2026-08-02", filed: "2026-08-20", low: 250001, high: 500000 });
  const t = triage([...c.rows, big], [c.s3, sigOf("s1-large", big), sigOf("s2-first", c.line), ...c.rows.slice(3).map((r) => sigOf("s2-first", r))]);
  const fRow = t.rows.find((r) => r.filings.some((f) => f.doc === c.line.doc))!;
  assert.equal(fRow.grouping, "single", "F's lead line is BIG, so the cluster does not absorb it");
  assert.equal(fRow.lead.txn.ticker, "BIG");
  const zzz = fRow.lines.find((l) => l.txn.txnId === c.line.txnId)!;
  assert.equal(zzz.others.members, 3, "three members had filed by F's cutoff");
  assert.equal(zzz.meters.others, 0, "…so Others stays at its at-cutoff level, 0");
  const cluster = t.rows.find((r) => r.grouping === "cluster")!;
  assert.ok(cluster, "the cluster row exists");
  assert.equal(cluster.cutoff, "2026-09-10", "cut off at its latest absorbed filing");
  assert.equal(cluster.cluster!.members, 5);
  assert.equal(cluster.meters.others, 3);
  assert.ok(!cluster.filings.some((f) => f.doc === c.line.doc), "F is not absorbed");
  // Others never reads the S-3's final count: the artifact says 5 members, F still reads 3.
  assert.equal(c.s3.entities.memberName, "5 members");
});

/* ================================================================ Cmte (LD3) */

const CMTE: TriageCommitteeInputs = {
  membershipsByMember: new Map([
    ["A000001", [{ committeeId: "HSBA", name: "House Committee on Financial Services", role: null, validFrom: "2025-01-03", validTo: "2026-09-09" }]],
  ]),
  windowFrom: "2025-01-03",
  windowTo: "2026-09-09",
  jurisdictionByCommittee: new Map([["HSBA", ["finance-insurance-realestate"]]]),
  resolveSector: (t) =>
    ["CB", "FNB"].includes(t) ? { state: "sector", sector: "finance-insurance-realestate" } : t === "NKE" ? { state: "sector", sector: "manufacturing" } : { state: "unresolved-ticker" },
  resolveSic: (t) => ({ CB: 6331, NKE: 3021 } as Record<string, number>)[t] ?? null,
};

test("Cmte: 2 for an S-5 hit graded direct, 1 graded broad, 0 known with no hit, -1 unknown (sector or membership)", () => {
  const cb = row({ doc: docOf("C1"), ticker: "CB", traded: "2026-08-19" });
  const fnb = row({ doc: docOf("C2"), ticker: "FNB", traded: "2026-08-19" }); // finance, no SIC on record → broad
  const nke = row({ doc: docOf("C3"), ticker: "NKE", traded: "2026-08-19" });
  const xyz = row({ doc: docOf("C4"), ticker: "XYZ", traded: "2026-08-19" });
  const nkeLate = row({ doc: docOf("C5"), ticker: "NKE", traded: "2026-09-20", filed: "2026-09-25" }); // outside the snapshot window
  const sigs = [sigOf("s5-jurisdiction", cb), sigOf("s5-jurisdiction", fnb), sigOf("s2-first", nke), sigOf("s2-first", xyz), sigOf("s1-large", nkeLate)];
  const t = triage([cb, fnb, nke, xyz, nkeLate], sigs, { committee: CMTE });
  assert.equal(t.cmteAvailable, true);
  assert.equal(lineOf(t, cb.txnId).meters.cmte, 2);
  assert.equal(lineOf(t, cb.txnId).cmte.grade, "direct");
  assert.deepEqual(lineOf(t, cb.txnId).cmte.committees.map((c) => c.committeeId), ["HSBA"]);
  assert.equal(lineOf(t, fnb.txnId).meters.cmte, 1);
  assert.equal(lineOf(t, fnb.txnId).cmte.grade, "broad");
  assert.equal(lineOf(t, nke.txnId).meters.cmte, 0);
  assert.equal(lineOf(t, xyz.txnId).meters.cmte, -1, "an unresolved sector is unknown");
  assert.equal(lineOf(t, nkeLate.txnId).meters.cmte, -1, "a trade outside the membership snapshot is unknown");
});

test("Cmte withheld: no committee inputs, or S-5 withheld, reads -1 on EVERY line and says why", () => {
  const cb = row({ doc: docOf("W1"), ticker: "CB", traded: "2026-08-19" });
  const none = triage([cb], [sigOf("s1-large", cb)], { committee: null });
  assert.equal(none.cmteAvailable, false);
  assert.equal(none.cmteUnavailableReason, "inputs-not-in-build");
  assert.equal(lineOf(none, cb.txnId).meters.cmte, -1);
  const withheld = triage([cb], [sigOf("s1-large", cb)], {
    committee: CMTE,
    withheld: [{ kind: "s5-jurisdiction", reason: "inputs-not-in-build", detail: "committee membership and/or issuer-sector data are not in this build" }],
  });
  assert.equal(withheld.cmteAvailable, false, "an S-5 that did not run is never read as a computed 0");
  assert.match(withheld.cmteUnavailableReason!, /^inputs-not-in-build: committee membership/);
  assert.equal(lineOf(withheld, cb.txnId).meters.cmte, -1);
  assert.equal(withheld.cards.committee, null, "no committee card is picked");
});

/* ================================================================ tier, lead, sort (LD4) */

const M = (size: number, pattern: number, others: number, cmte: number): Meters => ({ size, pattern, others, cmte }) as Meters;
const leadOf = (side: TxnRow["side"]) => ({ txn: row({ side }) });

test("LD4 tier: any 3 stands out; any 2, or a non-negative sum ≥ 3, is worth a look; the rest are routine; an exchange lead is always routine", () => {
  assert.equal(tierOf(M(3, 0, 0, 0), leadOf("purchase")), "stands");
  assert.equal(tierOf(M(-1, 3, -1, -1), leadOf("sale")), "stands");
  assert.equal(tierOf(M(2, 0, 0, 0), leadOf("purchase")), "look");
  assert.equal(tierOf(M(1, 1, 1, 0), leadOf("purchase")), "look", "sum 3");
  assert.equal(tierOf(M(1, 1, 0, -1), leadOf("purchase")), "routine", "sum 2");
  assert.equal(tierOf(M(1, 1, 1, -1), leadOf("purchase")), "look", "-1 adds nothing, sum 3");
  assert.equal(tierOf(M(-1, -1, -1, -1), leadOf("purchase")), "routine");
  assert.equal(tierOf(M(3, 3, 3, 2), leadOf("exchange")), "routine", "an exchange lead is Routine whatever its meters");
});

test("LD4 exchange rule, end to end: an exchange-led filing with a strong meter is Routine", () => {
  const ex = row({ doc: docOf("EX"), side: "exchange", low: 500001, high: 1000000 }); // first on record → Pattern 3
  const t = triage([ex], [sigOf("s1-large", ex)]);
  assert.equal(t.rows[0]!.meters.pattern, 3);
  assert.equal(t.rows[0]!.tier, "routine");
  assert.deepEqual(t.counts, { stands: 0, look: 0, routine: 1 });
});

test("LD4 lead line: highest max meter, then highest sum, then not an exchange, then highest low", () => {
  const L = (m: Meters, side: TxnRow["side"], low: number) => ({ meters: m, txn: row({ side, low }) });
  const a = L(M(3, 0, 0, 0), "purchase", 1001);
  const b = L(M(2, 2, 2, 2), "purchase", 5000001);
  assert.equal(pickLead([b, a]), a, "max meter first");
  const c = L(M(2, 2, 0, 0), "purchase", 1001);
  const d = L(M(2, 1, 0, 0), "purchase", 5000001);
  assert.equal(pickLead([d, c]), c, "then the sum");
  const e = L(M(2, 1, 0, 0), "exchange", 5000001);
  const f = L(M(2, 1, 0, 0), "sale", 1001);
  assert.equal(pickLead([e, f]), f, "then not an exchange");
  const g = L(M(2, 1, 0, 0), "sale", 15001);
  assert.equal(pickLead([f, g]), g, "then the highest low");
});

test("LD3 combining: a row's meter is the maximum over its lines, -1 below 0", () => {
  assert.deepEqual(combineMeters([{ meters: M(-1, 3, 0, -1) }, { meters: M(0, 1, -1, -1) }]), M(0, 3, 0, -1));
});

test("LD4 sort: stands/look by count of 3s, then sum, then lead low, then filed (desc); routine by filed", () => {
  const mk = (key: string, tier: TriageRow["tier"], m: Meters, low: number, filed: string): TriageRow =>
    ({ key, tier, meters: m, lead: { txn: row({ low }) }, filed }) as unknown as TriageRow;
  const rows = [
    mk("a", "stands", M(3, 0, 0, 0), 1001, "2026-09-01"),
    mk("b", "stands", M(3, 3, 0, 0), 1001, "2026-08-01"),
    mk("c", "stands", M(3, 2, 0, 0), 1001, "2026-08-01"),
    mk("d", "stands", M(3, 2, 0, 0), 50001, "2026-08-01"),
    mk("e", "stands", M(3, 2, 0, 0), 50001, "2026-09-01"),
  ];
  assert.deepEqual([...rows].sort(compareRows).map((r) => r.key), ["b", "e", "d", "c", "a"]);
  const routine = [mk("x", "routine", M(2, 2, 0, 0), 99, "2026-08-01"), mk("y", "routine", M(0, 0, 0, 0), 1, "2026-09-01")];
  assert.deepEqual([...routine].sort(compareRows).map((r) => r.key), ["y", "x"], "Routine ignores the meters: filed only");
});

/* ================================================================ grouping and the universe (LD3, R6) */

test("R6 universe: only filings filed in the window with a hit on a listed-stock line; an options-only hit is not ranked", () => {
  const inWin = row({ doc: docOf("U1") });
  const before = row({ doc: docOf("U2"), filed: "2026-07-14" });
  const opt = row({ doc: docOf("U3"), assetType: "OP", ticker: "OPT" });
  const notHit = row({ doc: docOf("U4") });
  const t = triage([inWin, before, opt, notHit], [sigOf("s1-large", inWin), sigOf("s1-large", before), sigOf("s1-large", opt)]);
  assert.deepEqual(t.rows.map((r) => r.filings[0]!.doc), [docOf("U1")]);
  assert.equal(t.unlocated, 0);
});

test("LD3 same member and ticker: one row of N filings, each constituent scored at its OWN filed date", () => {
  // F1 (2026-08-10) and F2 (2026-09-10), both led by AAA. F2 discloses an
  // older trade that, seen from F1, would end F1's "first on record" and add a
  // fifth prior lower bound.
  const prior = history(4, 1001, { ticker: "OLD", traded: "2024-01-01", filed: "2026-08-01" });
  const f1 = row({ doc: docOf("MT1"), ticker: "AAA", traded: "2026-08-01", filed: "2026-08-10", low: 50001, high: null });
  const f2older = row({ doc: docOf("MT2"), ticker: "OLDER", traded: "2023-01-01", filed: "2026-09-10", low: 1001 });
  const f2 = row({ doc: docOf("MT2"), ticker: "AAA", traded: "2026-09-01", filed: "2026-09-10", low: 1001 });
  const t = triage([...prior, f1, f2older, f2], [sigOf("s2-first", f1), sigOf("s1-large", f2)]);
  const r = t.rows.find((x) => x.grouping === "member-ticker")!;
  assert.ok(r, "the two filings collapse into one row");
  assert.equal(r.filings.length, 2);
  assert.equal(r.cutoff, null, "no single cutoff: each constituent has its own");
  const l1 = r.lines.find((l) => l.txn.txnId === f1.txnId)!;
  assert.equal(l1.cutoff, "2026-08-10");
  assert.equal(l1.meters.size, -1, "F2's older row (filed later) never makes F1's fifth prior bound");
  assert.equal(l1.history.withLow, 4);
  assert.equal(l1.pattern.lastPrior, "2024-01-01", "F2's 2023 trade is invisible at F1's cutoff");
  assert.equal(r.lines.find((l) => l.txn.txnId === f2.txnId)!.cutoff, "2026-09-10");
  // another member on the same ticker is a separate row
  const other = row({ doc: docOf("MT3"), bioguide: "B000002", name: "Member B", ticker: "AAA" });
  const t2 = triage([...prior, f1, f2older, f2, other], [sigOf("s2-first", f1), sigOf("s1-large", f2), sigOf("s2-first", other)]);
  assert.equal(t2.rows.filter((x) => x.lead.txn.ticker === "AAA").length, 2);
});

test("LD3 cluster: one row per active S-3, absorbing the in-window filings whose lead line is that ticker and side; cut off at the latest absorbed filing", () => {
  const c = othersCase(3, 5);
  // every member files in the coverage window: members 1–3 on 08-20, 4–5 on 09-10
  const t = triage(c.rows, [c.s3, ...c.rows.map((r) => sigOf("s2-first", r))]);
  const clusters = t.rows.filter((r) => r.grouping === "cluster");
  assert.equal(clusters.length, 1);
  assert.equal(clusters[0]!.filings.length, 5);
  assert.equal(clusters[0]!.cutoff, "2026-09-10");
  assert.ok(clusters[0]!.lines.every((l) => l.cutoff === "2026-09-10"), "every absorbed line is scored at the cluster cutoff");
  assert.equal(t.rows.length, 1, "nothing is left over");
  assert.equal(clusters[0]!.sentence.startsWith("5 members disclosed ZZZ purchases traded 2026-08-01 to 2026-08-05."), true);
});

test("LD3 late batch: one member's filings on one date completing ≥ 2 clusters whose windows ended before the window form ONE row at the batch date", () => {
  const D = "2026-08-05";
  const mk = (ticker: string, start: string) => {
    const others = [2, 3, 4].map((i) => row({ doc: docOf(`${ticker}-o${i}`), bioguide: `O00000${i}`, ticker, side: "sale", traded: start, filed: "2025-06-01" }));
    return { others, s3: s3Sig(ticker, "sale", start, D, 4) };
  };
  const a = mk("AA", "2025-04-07");
  const b = mk("BB", "2025-05-01");
  const fa = row({ doc: docOf("LB1"), ticker: "AA", side: "sale", traded: "2025-04-08", filed: D, late: 1 });
  const fb = row({ doc: docOf("LB2"), ticker: "BB", side: "sale", traded: "2025-05-02", filed: D, late: 1 });
  const fc = row({ doc: docOf("LB3"), ticker: "CC", side: "purchase", traded: "2026-07-20", filed: D, low: 250001, high: 500000 });
  const rows = [...a.others, ...b.others, fa, fb, fc];
  const t = triage(rows, [a.s3, b.s3, sigOf("s1-large", fc)]);
  assert.equal(t.rows.length, 1);
  const r = t.rows[0]!;
  assert.equal(r.grouping, "late-batch");
  assert.equal(r.cutoff, D);
  assert.deepEqual(r.filings.map((f) => f.doc).sort(), [docOf("LB1"), docOf("LB2"), docOf("LB3")], "every filing of the member on that date");
  assert.equal(r.batch!.clusters.length, 2);
  assert.equal(r.batch!.years, "2025");
  assert.equal(r.batch!.lateFilings, 2);
  assert.match(r.sentence, /^2 late filings on 2026-08-05 completed 2 clusters from 2025\./);
  // control: ONE completed cluster is not a late batch — it is a cluster row, and the rest stand alone
  const one = triage([...a.others, fa, fc], [a.s3, sigOf("s1-large", fc)]);
  assert.ok(!one.rows.some((x) => x.grouping === "late-batch"));
  assert.deepEqual(one.rows.map((x) => x.grouping).sort(), ["cluster", "single"]);
  // control: a cluster whose window ends inside the coverage window is not "late"
  const fresh = mk("DD", "2026-07-10"); // ends 07-24 ≥ coverage start
  const fd = row({ doc: docOf("LB4"), ticker: "DD", side: "sale", traded: "2026-07-11", filed: D });
  const t3 = triage([...a.others, fa, ...fresh.others, fd], [a.s3, fresh.s3]);
  assert.ok(!t3.rows.some((x) => x.grouping === "late-batch"));
});

/* ================================================================ sentences (LD5, R9, R25) */

const PRONOUNS = /\b(he|she|his|her|him)\b/i;

function sentenceProblems(s: string): string[] {
  const out: string[] = [];
  if ([...s].length > SENTENCE_MAX) out.push(`over ${SENTENCE_MAX}: ${s}`);
  if (PRONOUNS.test(s)) out.push(`pronoun: ${s}`);
  if (scanBannedWording(s).length > 0) out.push(`BANNED_WORDING: ${s}`);
  for (const p of BANNED_PATTERNS) if (p.re.test(s)) out.push(`banned-scan ${p.name}: ${s}`);
  if (/\b(?:bought|sold|buying)\b/i.test(s)) out.push(`side verb: ${s}`);
  return out;
}

test("LD5 templates: the fixed sentences, joined by a space, at most 160 characters", () => {
  assert.equal(monthYear("2024-04-08"), "Apr 2024");
  const base = { grouping: "single", cluster: null, batch: null, filed: "2026-09-09" } as const;
  const line = (over: Partial<LineScore>): LineScore =>
    ({
      txn: row({ ticker: "BAC" }),
      doc: docOf("S"),
      cutoff: "2026-09-09",
      meters: M(0, 0, 0, 0),
      history: { rows: 0, withLow: 0, maxLow: null, spanDays: null },
      bracketDelta: null,
      largestOnRecord: false,
      pattern: { firstOnRecord: false, lastPrior: null, gapDays: null },
      others: { s3: null, members: 0, tradedFrom: null, tradedTo: null },
      cmte: { grade: null, committees: [], sector: null, sic: null },
      signals: [],
      ...over,
    }) as LineScore;
  const filing = (n: number) => ({ doc: docOf("S"), filed: "2026-09-09", memberKey: "A000001", rows: Array.from({ length: n }, () => row()), ranked: [] });
  const one = (l: LineScore, n = 3) => rowSentence({ ...base, lines: [l], lead: l, filings: [filing(n)] });
  assert.equal(one(line({ meters: M(-1, 3, 0, 0), pattern: { firstOnRecord: true, lastPrior: null, gapDays: null } }), 703), "First filing on record: 703 lines.");
  assert.equal(one(line({ meters: M(-1, 3, 0, 0), pattern: { firstOnRecord: true, lastPrior: null, gapDays: null } }), 1), "First disclosure on record — a one-line filing.");
  assert.equal(one(line({ meters: M(0, 3, 0, 0), pattern: { firstOnRecord: false, lastPrior: "2023-02-14", gapDays: 900 } })), "First trades since Feb 2023.");
  assert.equal(one(line({ meters: M(3, 0, 0, 0), bracketDelta: 1, largestOnRecord: true, history: { rows: 9, withLow: 9, maxLow: 15001, spanDays: 400 } })), "The largest disclosure on the member's record.");
  assert.equal(one(line({ meters: M(3, 0, 0, 0), bracketDelta: 3, history: { rows: 408, withLow: 408, maxLow: 50001, spanDays: 900 } })), "3 brackets above anything in 408 prior disclosures.");
  assert.equal(one(line({ meters: M(2, 0, 0, 0), bracketDelta: 1, history: { rows: 6, withLow: 6, maxLow: 1001, spanDays: 90 } })), "1 bracket above anything in 6 prior disclosures.");
  assert.equal(
    one(line({ meters: M(0, 0, 0, 2), cmte: { grade: "direct", committees: [{ committeeId: "HSBA", name: "House Committee on Financial Services" }], sector: "finance-insurance-realestate", sic: 6021 } })),
    "BAC sits inside House Committee on Financial Services, where the member serves.",
  );
  assert.equal(one(line({ meters: M(0, 0, 0, 1), cmte: { grade: "broad", committees: [{ committeeId: "HSBA", name: "x" }], sector: "s", sic: null } })), "No rule named.", "a broad grade has no sentence of its own");
  // strongest first, and a clause that would pass 160 is dropped, never cut
  const both = line({ meters: M(3, 3, 0, 2), pattern: { firstOnRecord: false, lastPrior: "2023-02-14", gapDays: 900 }, bracketDelta: 2, history: { rows: 12, withLow: 12, maxLow: 1001, spanDays: 900 }, cmte: { grade: "direct", committees: [{ committeeId: "X", name: "A Committee With A Long Name ".repeat(3).trim() }], sector: "s", sic: 1 } });
  const clauses = sentenceClauses({ ...base, lines: [both], lead: both, filings: [filing(3)] });
  assert.equal(clauses.length, 3);
  const s = rowSentence({ ...base, lines: [both], lead: both, filings: [filing(3)] });
  assert.ok([...s].length <= SENTENCE_MAX);
  assert.equal(s, `${clauses[0]} ${clauses[1]}`, "the third clause would pass 160 and is dropped whole");
});

test("R9 / R25: every generated sentence is pronoun-free, within 160 characters and passes BANNED_WORDING and the banned-scan patterns", () => {
  assert.ok(BANNED_WORDING.length >= 10 && BANNED_PATTERNS.length >= 10, "the gates are loaded (control)");
  assert.ok(sentenceProblems("Spouse sold it; he likes it.").length >= 3, "control: the check catches a pronoun, a side verb and banned wording");
  const f = loadTriageFixture();
  const t = buildTriage(f.artifact, f.rows, { committee: f.committee, identityOf: f.identityOf });
  const sentences = t.rows.map((r) => r.sentence);
  assert.ok(sentences.length > 10);
  assert.deepEqual(sentences.flatMap(sentenceProblems), []);
  // and every clause each template can produce, standalone
  const facts = [
    "First filing on record: 703 lines.", "First disclosure on record — a one-line filing.", "First trades since Apr 2024.",
    "The largest disclosure on the member's record.", "3 brackets above anything in 408 prior disclosures.",
    "6 members disclosed SPCX purchases traded 2026-06-12 to 2026-06-18.", "4 members disclosed CVX sales traded 2025-12-16 to 2025-12-24.",
    "8 late filings on 2026-08-05 completed 10 clusters from 2024–2025.", "BAC sits inside House Committee on Financial Services, where the member serves.",
    "Large disclosure, first disclosure of the ticker, co-occurrence, infrequent discloser, committee overlap, late and large.",
  ];
  assert.deepEqual(facts.flatMap(sentenceProblems), []);
});

/* ================================================================ the golden cases (success criterion 2) */

function goldenTriage(): { t: TriageResult; f: ReturnType<typeof loadTriageFixture> } {
  const f = loadTriageFixture();
  return { t: buildTriage(f.artifact, f.rows, { committee: f.committee, identityOf: f.identityOf }), f };
}
const rowsOf = (t: TriageResult, bioguide: string, filed?: string) =>
  t.rows.filter((r) => r.filings.some((x) => x.rows[0]!.bioguide === bioguide && (filed === undefined || x.filed === filed)));

test("golden fixture: cut from public rows, identities verified, every active per-row signal located", () => {
  const f = loadTriageFixture();
  for (const k of ["rows", "signals", "committees", "issuers"]) assert.ok(f.raw.provenance[k]?.source, `${k} provenance`);
  assert.match(f.raw.provenance.committees!.source, /^data-20260802\.2 congress\.db/);
  assert.match(f.raw.provenance.issuers!.source, /^data-20260802\.2 congress\.db issuer_sic/);
  assert.equal(f.artifact.buildId, "20261013.1");
  // every identity reproduces its id (the loader throws otherwise)
  for (const s of f.artifact.signals) if (s.kind !== "s2-first" && s.kind !== "s3-cooccurrence") assert.ok(f.identityOf(s), s.id);
  const { t } = goldenTriage();
  assert.equal(t.unlocated, 0);
  assert.equal(t.version, TRIAGE_VERSION);
  // the sourced inputs the cases read
  assert.equal(f.raw.issuers.CB!.sic, "6331");
  assert.equal(f.raw.issuers.BAC!.sic, "6021");
  assert.ok(f.raw.committees.memberships.some((m) => m.bioguide_id === "S000168" && m.committee_id === "HSBA"));
  assert.ok(f.raw.committees.memberships.some((m) => m.bioguide_id === "H001047" && m.committee_id === "HSBA"));
});

test("golden: Cory A. Booker, filed 2026-09-09 — Stands out, Pattern 3 (rule wins: Size 0, led by NVDA; the AMZN line carries no signal)", () => {
  const { t } = goldenTriage();
  const rs = rowsOf(t, "B001288", "2026-09-09");
  assert.equal(rs.length, 1);
  const r = rs[0]!;
  assert.equal(r.tier, "stands");
  assert.equal(r.meters.pattern, 3);
  // Plan: "Size 3". The rule ranks HIT lines only; AMZN ($100,001–$250,000) has
  // no active signal (Booker disclosed AMZN in 2014, so no first disclosure;
  // below S-1's $250K floor), so it is not a ranked line.
  assert.equal(r.meters.size, 0);
  assert.ok(!r.lines.some((l) => l.txn.ticker === "AMZN"), "AMZN is not ranked");
  assert.ok(r.filings[0]!.rows.some((x) => x.ticker === "AMZN"), "…though the filing carries it");
  assert.equal(r.lead.txn.ticker, "NVDA");
  assert.equal(r.sentence, "First trades since Aug 2014.");
});

test("golden: April McClain Delaney, MLM, filed 2026-09-09 — Stands out, Size 3", () => {
  const { t } = goldenTriage();
  const r = rowsOf(t, "M001232", "2026-09-09")[0]!;
  assert.equal(r.lead.txn.ticker, "MLM");
  assert.equal(r.tier, "stands");
  assert.equal(r.meters.size, 3);
  assert.equal(r.sentence, "3 brackets above anything in 408 prior disclosures.");
});

test("golden: Alan Armstrong, filed 2026-07-21 (703 lines) — exactly one row, led by WMB; Stands out; Size -1; Pattern 3; 701 of 703 lines late", () => {
  const { t } = goldenTriage();
  const rs = rowsOf(t, "A000383", "2026-07-21");
  assert.equal(rs.length, 1, "exactly one row");
  const r = rs[0]!;
  assert.equal(r.lead.txn.ticker, "WMB");
  assert.equal(r.tier, "stands");
  assert.equal(r.meters.size, -1);
  assert.equal(r.meters.pattern, 3);
  assert.deepEqual([r.lateLines, r.totalLines], [701, 703]);
  assert.equal(r.sentence, "First filing on record: 703 lines.");
});

test("golden: the SPCX purchase cluster, traded 2026-06-12 to 06-18 — one cluster row of 6 members, Others 3, absorbing Moskowitz's 2026-07-26 filing", () => {
  const { t } = goldenTriage();
  const cs = t.rows.filter((r) => r.grouping === "cluster" && r.cluster!.s3.entities.ticker === "SPCX");
  assert.equal(cs.length, 1);
  const r = cs[0]!;
  assert.equal(r.cluster!.members, 6);
  assert.equal(r.meters.others, 3);
  assert.deepEqual([r.cluster!.tradedFrom, r.cluster!.tradedTo], ["2026-06-12", "2026-06-18"]);
  assert.ok(r.filings.some((f) => f.rows[0]!.bioguide === "M001217" && f.filed === "2026-07-26"), "Moskowitz's filing is absorbed");
  assert.equal(r.tier, "stands");
  assert.equal(r.sentence, "6 members disclosed SPCX purchases traded 2026-06-12 to 2026-06-18.");
});

test("golden: James A. Himes, filed 2026-07-20 — Stands out, Pattern 3, Committee 2 (BAC ↔ House Financial Services, direct)", () => {
  const { t } = goldenTriage();
  const r = rowsOf(t, "H001047", "2026-07-20")[0]!;
  assert.equal(r.tier, "stands");
  assert.equal(r.meters.pattern, 3);
  assert.equal(r.meters.cmte, 2);
  const bac = r.lines.find((l) => l.txn.ticker === "BAC")!;
  assert.equal(bac.cmte.grade, "direct");
  assert.equal(bac.cmte.sic, 6021);
  assert.deepEqual(bac.cmte.committees.map((c) => c.committeeId), ["HSBA"]);
});

test("golden: Maria Elvira Salazar, CB — one row, Committee 2 (rule over the sourced snapshot: the 2026-10-07 filing stands apart)", () => {
  const { t, f } = goldenTriage();
  const cb = t.rows.filter((r) => r.lead.txn.ticker === "CB" && r.filings.some((x) => x.rows[0]!.bioguide === "S000168"));
  assert.equal(cb.length, 1, "one CB row");
  const r = cb[0]!;
  assert.equal(r.grouping, "member-ticker");
  assert.equal(r.meters.cmte, 2);
  // Plan: filings 2026-08-07, 09-09 AND 10-07. The fixture's committee snapshot
  // is the sourced data-20260802.2 table, valid 2025-01-03 → 2026-09-09; the
  // 10-07 filing's CB trade (2026-09-24) falls outside it, so its CB line reads
  // Cmte unknown, the filing's lead is SNOW, and it is not grouped with CB.
  assert.equal(f.raw.committees.window.valid_to, "2026-09-09");
  assert.deepEqual(r.filings.map((x) => x.filed).sort(), ["2026-08-07", "2026-09-09"]);
  const oct = rowsOf(t, "S000168", "2026-10-07");
  assert.equal(oct.length, 1);
  assert.equal(oct[0]!.lead.txn.ticker, "SNOW");
  assert.equal(oct[0]!.lines.find((l) => l.txn.ticker === "CB")!.meters.cmte, -1, "the CB trade on 2026-09-24 is outside the snapshot");
});

test("golden: Tommy Tuberville, eight filings on 2026-08-05 — one late-batch row", () => {
  const { t } = goldenTriage();
  const rs = rowsOf(t, "T000278", "2026-08-05");
  assert.equal(rs.length, 1);
  assert.equal(rs[0]!.grouping, "late-batch");
  assert.equal(rs[0]!.filings.length, 8);
  assert.equal(rs[0]!.batch!.clusters.length, 10);
});

test("golden: Kevin Hern, filed 2026-09-25, led by an exchange — Routine", () => {
  const { t } = goldenTriage();
  const r = rowsOf(t, "H001082", "2026-09-25")[0]!;
  assert.equal(r.lead.txn.side, "exchange");
  assert.equal(r.tier, "routine");
});

test("golden lead cards: Committee Salazar CB sale 2026-08-19; Buy Pelosi BE $1M–$5M on both rankings; Sell absolute Armstrong WMB; Sell own record Delaney MLM", () => {
  const { t } = goldenTriage();
  const c = t.cards;
  assert.deepEqual([c.committee!.line.txn.name, c.committee!.line.txn.ticker, c.committee!.line.txn.side, c.committee!.line.txn.traded], ["Maria Elvira Salazar", "CB", "sale", "2026-08-19"]);
  assert.equal(c.committee!.line.cmte.grade, "direct");
  for (const p of [c.buyRecord!, c.buyAbsolute!]) assert.deepEqual([p.line.txn.name, p.line.txn.ticker, p.line.txn.low, p.line.txn.high], ["Nancy Pelosi", "BE", 1000001, 5000000]);
  assert.deepEqual([c.sellAbsolute!.line.txn.name, c.sellAbsolute!.line.txn.ticker], ["Alan Armstrong", "WMB"]);
  assert.deepEqual([c.sellRecord!.line.txn.name, c.sellRecord!.line.txn.ticker], ["April McClain Delaney", "MLM"]);
  assert.equal(c.sellRecord!.fact, "3 brackets above anything in 408 prior disclosures.");
});

/* ================================================================ cards (LD6) */

test("LD6 committee card: direct before broad, then the lower bound, then filed", () => {
  const cbSmall = row({ doc: docOf("K1"), ticker: "CB", traded: "2026-08-19", low: 1001 });
  const fnbBig = row({ doc: docOf("K2"), ticker: "FNB", traded: "2026-08-19", low: 1000001, high: 5000000 });
  const t = triage([cbSmall, fnbBig], [sigOf("s5-jurisdiction", cbSmall), sigOf("s5-jurisdiction", fnbBig)], { committee: CMTE });
  assert.equal(t.cards.committee!.line.txn.txnId, cbSmall.txnId, "a direct $1K match outranks a broad $1M one");
  assert.match(t.cards.committee!.fact, /^SIC 6331 sits inside a direct range of House Committee on Financial Services\.$/);
});

test("D21 (code review round 1, F1): a cluster row's date block is its lead line's own filed date, trade date, lag and receipt; the latest absorbed filing is labelled apart", () => {
  // S-3 ZZZ purchases from 2026-08-01, five members; members 1–3 file on
  // 2026-08-20, members 4–5 on 2026-09-10. Member 1's larger line leads.
  const c = othersCase(3, 5);
  const rows = c.rows.map((r) => ({ ...r, lag: daysBetween(r.traded!, r.filed), ...(r === c.line ? { low: 50001, high: 100000 } : {}) }));
  const lead = rows[0]!;
  const t = triage(rows, [c.s3, ...rows.map((r) => sigOf("s2-first", r))]);
  const cl = t.rows.find((r) => r.grouping === "cluster")!;
  assert.equal(cl.filings.length, 5);
  assert.equal(cl.lead.txn.txnId, lead.txnId, "control: member 1's line leads");
  assert.deepEqual([cl.lead.txn.filed, cl.filed], ["2026-08-20", "2026-09-10"], "control: the lead's filing is not the row's latest");
  const root = new MiniElement("body");
  root.innerHTML = triageRowHtml(cl, {});
  const text = (sel: string): string => root.querySelector(sel)!.textContent.replace(/\u00a0/g, " ");
  assert.equal(root.querySelector(".si-row-filed time")!.getAttribute("datetime"), "2026-08-20");
  assert.equal(text(".si-row-filed"), "filed 2026-08-20");
  assert.equal(text(".si-row-traded"), `traded 2026-08-01 · ${daysBetween("2026-08-01", "2026-08-20")}d`);
  assert.equal(root.querySelector(".si-row-src a")!.getAttribute("href"), lead.doc, "the lead's own receipt");
  assert.equal(text(".si-row-src .mono-note"), " +4 filings · latest of 5 filings: 2026-09-10");
});

test("D22 (code review round 1, F2): the committee card states a missing SIC as missing, and only a KNOWN SIC as outside the direct ranges", () => {
  // FNB: finance sector inside HSBA, no SIC on record → broad
  const fnb = row({ doc: docOf("K3"), ticker: "FNB", traded: "2026-08-19", low: 50001, high: 100000 });
  const t1 = triage([fnb], [sigOf("s5-jurisdiction", fnb)], { committee: CMTE });
  assert.equal(t1.cards.committee!.line.cmte.grade, "broad");
  assert.equal(t1.cards.committee!.line.cmte.sic, null);
  assert.equal(t1.cards.committee!.fact, "The issuer's sector sits inside House Committee on Financial Services; its 4-digit SIC is not on record, so the match is graded broad.");
  assert.doesNotMatch(t1.cards.committee!.fact, /outside/, "a missing SIC is never a range result");
  // ZZF: finance sector, a KNOWN SIC (7372) outside HSBA's 6000–6799 → broad
  const known: TriageCommitteeInputs = {
    ...CMTE,
    resolveSector: (tk) => (tk === "ZZF" ? { state: "sector", sector: "finance-insurance-realestate" } : CMTE.resolveSector(tk)),
    resolveSic: (tk) => (tk === "ZZF" ? 7372 : CMTE.resolveSic(tk)),
  };
  const zzf = row({ doc: docOf("K4"), ticker: "ZZF", traded: "2026-08-19", low: 50001, high: 100000 });
  const t2 = triage([zzf], [sigOf("s5-jurisdiction", zzf)], { committee: known });
  assert.equal(t2.cards.committee!.line.cmte.grade, "broad");
  assert.equal(t2.cards.committee!.fact, "SIC 7372 is outside the direct ranges of House Committee on Financial Services; the sector match is graded broad.");
  // a committee the table does not map has no direct range at all — stated as such
  const unmapped = { cmte: { grade: "broad" as const, committees: [{ committeeId: "HSXX", name: "House Unmapped" }], sector: "s", sic: 7372 } };
  assert.equal(committeeFact(unmapped), "House Unmapped has no direct range in table v1; the sector match is graded broad.");
  assert.equal(
    committeeFact({ cmte: { ...unmapped.cmte, committees: [...unmapped.cmte.committees, { committeeId: "SSXX", name: "Senate Unmapped" }] } }),
    "None of the 2 matched committees has a direct range in table v1; the sector match is graded broad.",
  );
  // the direct case names the SIC it matched, four digits
  assert.equal(committeeFact({ cmte: { grade: "direct", committees: [{ committeeId: "HSAG", name: "House Agriculture" }], sector: "s", sic: 100 } }), "SIC 0100 sits inside a direct range of House Agriculture.");
});

test("LD6 own record: ≥ 20 prior disclosures spanning ≥ 365 days, low ≥ 50,001; ranked by brackets above the record", () => {
  // span: traded 2024-01-01 … 2024-12-31 (365 days); lows 1001
  const priors = (n: number, spanEnd: string) => Array.from({ length: n }, (_, i) => row({ doc: docOf(`R${seq}-${i}`), traded: i === n - 1 ? spanEnd : "2024-01-01", filed: "2025-02-01", low: 1001 }));
  const line = (low: number) => row({ doc: docOf(`RL${seq}`), low, high: null });
  const pick = (hist: TxnRow[], L: TxnRow) => triage([...hist, L], [sigOf("s1-large", L)]).cards.buyRecord;
  assert.ok(pick(priors(20, "2024-12-31"), line(50001)), "20 priors over 365 days at $50,001");
  assert.equal(pick(priors(19, "2024-12-31"), line(50001)), null, "19 priors");
  assert.equal(pick(priors(20, "2024-12-30"), line(50001)), null, "364 days");
  assert.equal(pick(priors(20, "2024-12-31"), line(50000)), null, "$50,000");
  // absolute picks the larger line regardless of the record
  const big = row({ doc: docOf("AB"), bioguide: "Z000001", name: "Other", low: 5000001, high: 25000000 });
  const small = line(50001);
  const t = triage([...priors(20, "2024-12-31"), small, big], [sigOf("s1-large", small), sigOf("s1-large", big)]);
  assert.equal(t.cards.buyAbsolute!.line.txn.txnId, big.txnId);
  assert.equal(t.cards.buyRecord!.line.txn.txnId, small.txnId, "the newcomer has no record, so own record keeps the small line");
  assert.equal(t.cards.buyRecord!.fact, "2 brackets above anything in 20 prior disclosures.");
});

test("R11: a listed-stock line with no ticker never reaches a card (a card must link to its ticker page)", () => {
  const untickered = row({ doc: docOf("NT"), bioguide: "N000001", name: "No Ticker", chamber: "senate", ticker: null, assetType: "Stock", asset: "Some Company Stock", low: 250001, high: 500000 });
  const tickered = row({ doc: docOf("TK"), bioguide: "T000001", name: "Has Ticker", low: 50001, high: 100000 });
  const t = triage([untickered, tickered], [sigOf("s1-large", untickered), sigOf("s1-large", tickered)]);
  assert.ok(t.rows.some((r) => r.lines.some((l) => l.txn.txnId === untickered.txnId)), "the untickered line is still ranked in a row");
  assert.equal(t.cards.buyAbsolute!.line.txn.txnId, tickered.txnId, "the larger untickered line is not the card");
  for (const c of [t.cards.committee, t.cards.buyRecord, t.cards.buyAbsolute, t.cards.sellRecord, t.cards.sellAbsolute]) {
    if (c) assert.notEqual(c.line.txn.ticker, null, "every card carries a ticker");
  }
});

test("LD6: options never reach a card; sells take sales and partial sales", () => {
  const opt = row({ doc: docOf("O1"), assetType: "OP", low: 50000001, high: null, side: "sale" });
  const part = row({ doc: docOf("O2"), side: "sale_partial", low: 15001 });
  const t = triage([opt, part], [sigOf("s1-large", opt), sigOf("s1-large", part)]);
  assert.equal(t.cards.sellAbsolute!.line.txn.txnId, part.txnId);
  assert.equal(t.cards.buyAbsolute, null, "no purchase line: no card");
});

test("level words and tier labels are exactly the published ones (R25)", () => {
  assert.deepEqual(TIER_LABELS, { stands: "Stands out", look: "Worth a look", routine: "Routine" });
  assert.deepEqual(METER_KEYS, ["size", "pattern", "others", "cmte"]);
  assert.deepEqual([3, 2, 1, 0, -1].map((l) => LEVEL_WORDS[l as -1]), ["strong", "medium", "low", "none", "unknown"]);
});
