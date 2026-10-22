/* signals-v3 M2 (R4, R6–R9, R11; LD1, LD3–LD6): the Signals triage.

   The single owner of how the filings that carry an active signal are
   grouped, scored against the filer's OWN record, tiered, sorted, described
   and picked for the lead cards. Pure: a function of the artifact, the
   build's rows and the committee inputs, so `/signals/`, Methodology (which
   interpolates the constants below) and, in M3, the ticker page read one
   computation (`getTriage()` memoises it per build in `data.ts`).

   Nothing here is serialized (R4): no field is added to a `Signal`, no route
   or file is written. Signals are read through `signalIdentity`, never
   mutated.

   Every computation is POINT IN TIME (R6). A line is scored at a cutoff date
   C and sees only rows FILED on or before C, so a filing reads exactly as it
   read the day it was filed — a member whose later filings arrive afterwards
   never raises an earlier filing's meters. C depends on the row's grouping
   (LD3 "Cutoff").

   A meter is a classification of one disclosure against the filer's own
   record and the record around it — never a prediction, a return or an
   intent (ARCHITECTURE §2.4). Prices and returns are never read. */

import type { Signal, SignalArtifact, SignalKind } from "./signals.ts";
import { s3MemberKey, s3SideClass, s3WindowEnd, s3WindowRows, signalIdentity } from "./signals.ts";
import { isListedStock, type TxnRow } from "./format.ts";
import {
  excludeDateAnomalies,
  fnv1a64,
  jurisdictionOverlap,
  membershipAsOf,
  type CommitteeMembership,
  type SectorResolution,
} from "./derive.ts";
import { COMMITTEE_DIRECT_VERSION, DIRECT_SIC, gradeOverlap, sicText } from "./committee-direct.ts";

/** Bumped on any change to a rule or a constant below. */
export const TRIAGE_VERSION = "1.0.0";

/* ================================================================ constants
   LD3 / LD4 / LD6, every one named once. Methodology `#signals-ranking`
   interpolates these values, so its prose cannot drift from the code. */

/** The statutory bracket lower bounds (`src/populus/normalize.py`
    `_AMOUNT_BUCKETS`; a test cross-checks them). */
export const BRACKET_LOWER_BOUNDS = [1_001, 15_001, 50_001, 100_001, 250_001, 500_001, 1_000_001, 5_000_001, 25_000_001, 50_000_001] as const;
/** Size is unknown (-1) below this many prior rows with a lower bound. */
export const SIZE_MIN_HISTORY = 5;
/** A disclosure at or above this lower bound is "large" for Size 3 and 2. */
export const SIZE_LARGE_LOW = 50_001;
/** Size 1's floor. */
export const SIZE_LEVEL1_LOW = 15_001;
/** Size 1: at least this share of the prior lower bounds sit below the line's. */
export const SIZE_LEVEL1_SHARE = 0.9;
/** Pattern: the gap since the member's last prior trade, in days, per level. */
export const PATTERN_GAP_DAYS: Readonly<Record<1 | 2 | 3, number>> = { 3: 730, 2: 365, 1: 180 };
/** Others: distinct members inside the line's co-occurrence window, per level. */
export const OTHERS_MEMBERS: Readonly<Record<2 | 3, number>> = { 3: 5, 2: 4 };
/** Worth a look: the sum of the non-negative meters at or above this. */
export const LOOK_MIN_SUM = 3;
/** A late batch completes at least this many clusters. */
export const LATE_BATCH_MIN_CLUSTERS = 2;
/** Own-record cards: the member has at least this many prior disclosures… */
export const RECORD_MIN_PRIOR = 20;
/** …spanning at least this many days… */
export const RECORD_MIN_SPAN_DAYS = 365;
/** …and the line's lower bound is at least this. */
export const RECORD_MIN_LOW = 50_001;
/** The reason sentence's ceiling (R9). */
export const SENTENCE_MAX = 160;

/* ================================================================ types */

export type Level = -1 | 0 | 1 | 2 | 3;
export const METER_KEYS = ["size", "pattern", "others", "cmte"] as const;
export type MeterKey = (typeof METER_KEYS)[number];
export type Meters = Record<MeterKey, Level>;
export type Tier = "stands" | "look" | "routine";
export type Grouping = "late-batch" | "cluster" | "member-ticker" | "single";

/** The meter names as the page prints them. */
export const METER_LABELS: Readonly<Record<MeterKey, string>> = { size: "Size", pattern: "Pattern", others: "Others", cmte: "Cmte" };
/** A level as words, for the meter's accessible name ("Size: strong"). */
export const LEVEL_WORDS: Readonly<Record<Level, string>> = { 3: "strong", 2: "medium", 1: "low", 0: "none", [-1]: "unknown" } as Record<Level, string>;
/** The tier names, exactly (R25). */
export const TIER_LABELS: Readonly<Record<Tier, string>> = { stands: "Stands out", look: "Worth a look", routine: "Routine" };

/** The committee inputs S-5 used (null → the committee meter is unknown). */
export interface TriageCommitteeInputs {
  membershipsByMember: ReadonlyMap<string, readonly CommitteeMembership[]>;
  windowFrom: string;
  windowTo: string;
  jurisdictionByCommittee: ReadonlyMap<string, readonly string[]>;
  resolveSector: (ticker: string) => SectorResolution;
  /** ticker → the issuer's 4-digit SIC, or null when unresolved */
  resolveSic: (ticker: string) => number | null;
}

export interface TriageContext {
  committee: TriageCommitteeInputs | null;
  /** How a signal's raw identity is read. Defaults to `signalIdentity`; a
      test over a JSON artifact passes identities it has verified against the
      ids' own hashes. */
  identityOf?: (sig: Signal) => string | null;
}

/** One line (a disclosed row) scored at a cutoff. */
export interface LineScore {
  txn: TxnRow;
  /** the filing the line belongs to */
  doc: string;
  cutoff: string;
  meters: Meters;
  /** History E at the cutoff (LD3) */
  history: {
    rows: number;
    withLow: number;
    maxLow: number | null;
    /** days between E's earliest and latest trade; null when E is empty */
    spanDays: number | null;
  };
  /** bracket(L.low) − bracket(max E.low); null when either side has no bound */
  bracketDelta: number | null;
  /** the line's bracket is above every other row of the member filed by the cutoff */
  largestOnRecord: boolean;
  /** Pattern facts, per filing */
  pattern: { firstOnRecord: boolean; lastPrior: string | null; gapDays: number | null };
  /** Others facts */
  others: { s3: Signal | null; members: number; tradedFrom: string | null; tradedTo: string | null };
  /** Cmte facts (grade null: the line is not an S-5 hit) */
  cmte: { grade: "direct" | "broad" | null; committees: { committeeId: string; name: string }[]; sector: string | null; sic: number | null };
  /** the active signals this line carries */
  signals: Signal[];
}

/** A filing of the ranked universe. */
export interface TriageFiling {
  doc: string;
  filed: string;
  memberKey: string;
  /** every row of the filing */
  rows: TxnRow[];
  /** its ranked lines: hit lines that are listed stock */
  ranked: TxnRow[];
}

export interface TriageRow {
  /** stable within a build: grouping + the filings' receipts */
  key: string;
  grouping: Grouping;
  tier: Tier;
  meters: Meters;
  lead: LineScore;
  lines: LineScore[];
  filings: TriageFiling[];
  /** the latest filed among the row's filings: the sort key, and the date a
      grouped row labels as its latest filing. The date block's "filed" is the
      lead line's own (`lead.txn.filed`), never this (D21). */
  filed: string;
  /** the cutoff the row was scored at (a same-member-and-ticker row scores
      each filing at its own filed date: null) */
  cutoff: string | null;
  totalLines: number;
  lateLines: number;
  cluster: { s3: Signal; members: number; tradedFrom: string | null; tradedTo: string | null } | null;
  batch: { clusters: Signal[]; years: string; lateFilings: number } | null;
  sentence: string;
  /** every active signal the row's lines carry (deduplicated, by id) */
  signals: Signal[];
}

export interface CardPick {
  line: LineScore;
  row: TriageRow;
  /** the fact the card states, from the line's own numbers */
  fact: string;
}

export interface TriageCards {
  committee: CardPick | null;
  buyRecord: CardPick | null;
  buyAbsolute: CardPick | null;
  sellRecord: CardPick | null;
  sellAbsolute: CardPick | null;
}

export interface TriageResult {
  rows: TriageRow[];
  counts: { stands: number; look: number; routine: number };
  byTicker: Map<string, TriageRow[]>;
  hitsByTicker: Map<string, Signal[]>;
  cards: TriageCards;
  version: string;
  /** false when the committee meter cannot be computed: the inputs are not
      in this build, or S-5 was withheld */
  cmteAvailable: boolean;
  /** why it cannot, when it cannot (the withholding's detail, or "inputs not in build") */
  cmteUnavailableReason: string | null;
  /** active per-row signals whose triggering line could not be located (0 in
      a build: every active signal carries its identity) */
  unlocated: number;
  /** signals-v3 M3 (R19): each active signal's lines, as LD3 "Lines" reads
      them — signal id → the txnIds the engine marked hit for it (the identity
      line of S-1/S-4/S-5/S-6, the matching rows of S-2's filing, every row of
      S-3's window). The ticker page pins these; build memory only (R4). */
  hitLines: Map<string, string[]>;
}

/* ================================================================ helpers */

/** The bracket index of a lower bound (0 = $1,001–$15,000); -1 below the first. */
export function bracketOf(low: number): number {
  let i = -1;
  for (const b of BRACKET_LOWER_BOUNDS) if (low >= b) i++;
  return i;
}

function dayNum(iso: string): number {
  return Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10))) / 86_400_000;
}

/** Whole days from `a` to `b`. */
export function daysBetween(a: string, b: string): number {
  return Math.round(dayNum(b) - dayNum(a));
}

function memberKeyOf(r: Pick<TxnRow, "bioguide" | "name">): string {
  return s3MemberKey(r);
}

const lvl = (n: number): Level => n as Level;

function maxMeter(m: Meters): number {
  return Math.max(m.size, m.pattern, m.others, m.cmte);
}
/** The sum of the non-negative meters. */
export function meterSum(m: Meters): number {
  return METER_KEYS.reduce((s, k) => s + Math.max(0, m[k]), 0);
}
function count3(m: Meters): number {
  return METER_KEYS.filter((k) => m[k] === 3).length;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "Mon YYYY". */
export function monthYear(iso: string): string {
  return `${MONTHS[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`;
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/* ================================================================ scoring */

interface Engine {
  artifact: SignalArtifact;
  clean: TxnRow[];
  byMember: Map<string, TxnRow[]>;
  byDoc: Map<string, TxnRow[]>;
  activeS3: Signal[];
  s3Rows: Map<string, TxnRow[]>;
  hitSignals: Map<string, Signal[]>;
  s5Lines: Set<string>;
  committee: TriageCommitteeInputs | null;
  cmteAvailable: boolean;
  patternMemo: Map<string, LineScore["pattern"] & { level: Level }>;
}

/** Pattern of filing `doc` at cutoff C (per filing, LD3). */
function patternOf(e: Engine, doc: string, memberKey: string, cutoff: string): LineScore["pattern"] & { level: Level } {
  const memo = `${doc}|${cutoff}`;
  const hit = e.patternMemo.get(memo);
  if (hit) return hit;
  const own = excludeDateAnomalies(e.byDoc.get(doc) ?? []).rows.filter((r) => r.traded != null);
  let out: LineScore["pattern"] & { level: Level };
  if (own.length === 0) {
    out = { firstOnRecord: false, lastPrior: null, gapDays: null, level: -1 };
  } else {
    const t0 = own.reduce((m, r) => (r.traded! < m ? r.traded! : m), own[0]!.traded!);
    let last: string | null = null;
    for (const r of e.byMember.get(memberKey) ?? []) {
      if (r.doc === doc || r.traded == null || r.traded >= t0 || r.filed > cutoff) continue;
      if (last === null || r.traded > last) last = r.traded;
    }
    if (last === null) out = { firstOnRecord: true, lastPrior: null, gapDays: null, level: 3 };
    else {
      const gap = daysBetween(last, t0);
      const level = gap >= PATTERN_GAP_DAYS[3] ? 3 : gap >= PATTERN_GAP_DAYS[2] ? 2 : gap >= PATTERN_GAP_DAYS[1] ? 1 : 0;
      out = { firstOnRecord: false, lastPrior: last, gapDays: gap, level: lvl(level) };
    }
  }
  e.patternMemo.set(memo, out);
  return out;
}

/** The active S-3 whose window holds the line, or null. */
function s3For(e: Engine, r: TxnRow): Signal | null {
  const cls = s3SideClass(r.side);
  if (cls === null || r.ticker == null || r.traded == null || r.flags.includes("date_anomaly")) return null;
  for (const s of e.activeS3) {
    if (s.entities.ticker !== r.ticker || s.side !== cls) continue;
    const start = s.occurrence.tradeDate;
    if (start == null) continue;
    if (r.traded >= start && r.traded <= s3WindowEnd(start)) return s;
  }
  return null;
}

function cmteOf(e: Engine, r: TxnRow): { level: Level; facts: LineScore["cmte"] } {
  const none = { grade: null, committees: [], sector: null, sic: null };
  if (!e.cmteAvailable || e.committee === null) return { level: -1, facts: none };
  const c = e.committee;
  if (r.ticker == null || r.bioguide == null) return { level: -1, facts: none };
  const snapshot = { memberships: c.membershipsByMember.get(r.bioguide) ?? [], windowFrom: c.windowFrom, windowTo: c.windowTo };
  if (e.s5Lines.has(r.txnId)) {
    // The S-5 hit's own match, recomputed by the one join S-5 used.
    const o = jurisdictionOverlap([r], snapshot, c.jurisdictionByCommittee, c.resolveSector).rows[0];
    if (!o) {
      /* The hit cannot be re-derived from the inputs in hand (a committee
         snapshot that does not cover the trade date): unknown, never a guessed grade. */
      return { level: -1, facts: none };
    }
    const sic = c.resolveSic(r.ticker);
    const grade = gradeOverlap(sic, o.committees.map((x) => x.committeeId));
    return { level: grade === "direct" ? 2 : 1, facts: { grade, committees: o.committees, sector: o.sector, sic } };
  }
  const sector = c.resolveSector(r.ticker);
  if (sector.state !== "sector") return { level: -1, facts: none };
  if (membershipAsOf(snapshot, r.traded) === null) return { level: -1, facts: none };
  return { level: 0, facts: { ...none, sector: sector.sector } };
}

/** Score one line of filing `f` at cutoff C (LD3). */
function scoreLine(e: Engine, r: TxnRow, f: TriageFiling, cutoff: string): LineScore {
  // History E: the member's rows — not date anomalies, not in F, traded
  // before the line, FILED BY THE CUTOFF.
  const memberRows = e.byMember.get(f.memberKey) ?? [];
  const E =
    r.traded == null
      ? []
      : memberRows.filter((x) => x.doc !== f.doc && x.traded != null && x.traded < r.traded! && x.filed <= cutoff);
  const lows = E.filter((x) => x.low != null).map((x) => x.low!);
  const maxLow = lows.length ? Math.max(...lows) : null;
  const traded = E.map((x) => x.traded!).sort();
  const spanDays = traded.length ? daysBetween(traded[0]!, traded[traded.length - 1]!) : null;
  const bracketDelta = r.low != null && maxLow !== null ? bracketOf(r.low) - bracketOf(maxLow) : null;

  // Size
  let size: Level;
  if (r.traded == null || r.low == null || lows.length < SIZE_MIN_HISTORY) size = -1;
  else {
    const b = bracketDelta!;
    if (b >= 1 && r.low >= SIZE_LARGE_LOW) size = 3;
    else if (b >= 1 || (b === 0 && r.low >= SIZE_LARGE_LOW)) size = 2;
    else if (r.low >= SIZE_LEVEL1_LOW && lows.filter((v) => v < r.low!).length / lows.length >= SIZE_LEVEL1_SHARE) size = 1;
    else size = 0;
  }
  // "The largest disclosure on the member's record": strictly above every
  // other row of the member filed by the cutoff — earlier or later trades.
  const largestOnRecord =
    r.low != null &&
    memberRows.every((x) => x === r || x.txnId === r.txnId || x.filed > cutoff || x.low == null || bracketOf(x.low) < bracketOf(r.low!));

  // Pattern (per filing)
  const p = patternOf(e, f.doc, f.memberKey, cutoff);

  // Others
  const s3 = s3For(e, r);
  let othersLevel: Level = 0;
  let members = 0;
  let tradedFrom: string | null = null;
  let tradedTo: string | null = null;
  if (s3) {
    const rows = (e.s3Rows.get(s3.id) ?? []).filter((x) => x.filed <= cutoff);
    members = new Set(rows.map(memberKeyOf)).size;
    for (const x of rows) {
      if (tradedFrom === null || x.traded! < tradedFrom) tradedFrom = x.traded!;
      if (tradedTo === null || x.traded! > tradedTo) tradedTo = x.traded!;
    }
    othersLevel = members >= OTHERS_MEMBERS[3] ? 3 : members >= OTHERS_MEMBERS[2] ? 2 : 0;
  }

  const cm = cmteOf(e, r);
  return {
    txn: r,
    doc: f.doc,
    cutoff,
    meters: { size, pattern: p.level, others: othersLevel, cmte: cm.level },
    history: { rows: E.length, withLow: lows.length, maxLow, spanDays },
    bracketDelta,
    largestOnRecord,
    pattern: { firstOnRecord: p.firstOnRecord, lastPrior: p.lastPrior, gapDays: p.gapDays },
    others: { s3, members, tradedFrom, tradedTo },
    cmte: cm.facts,
    signals: e.hitSignals.get(r.txnId) ?? [],
  };
}

/** LD4's line order: the highest maximum meter, then the highest sum of the
    non-negative meters, then not an exchange, then the highest lower bound
    (then the row id, so the order is deterministic). The lead line is its
    first; the ticker page pins a row's lines in this order (M3, R19). */
export function compareLines(a: Pick<LineScore, "meters" | "txn">, b: Pick<LineScore, "meters" | "txn">): number {
  return (
    maxMeter(b.meters) - maxMeter(a.meters) ||
    meterSum(b.meters) - meterSum(a.meters) ||
    Number(a.txn.side === "exchange") - Number(b.txn.side === "exchange") ||
    (b.txn.low ?? -1) - (a.txn.low ?? -1) ||
    (a.txn.txnId < b.txn.txnId ? -1 : a.txn.txnId > b.txn.txnId ? 1 : 0)
  );
}

/** LD4's lead line: the first line in `compareLines` order. */
export function pickLead<T extends Pick<LineScore, "meters" | "txn">>(lines: readonly T[]): T {
  return [...lines].sort(compareLines)[0]!;
}

/** LD4's tier: an exchange-led row is Routine; otherwise any meter at 3 stands
    out; any at 2, or a non-negative sum of at least LOOK_MIN_SUM, is worth a look. */
export function tierOf(meters: Meters, lead: Pick<LineScore, "txn">): Tier {
  if (lead.txn.side === "exchange") return "routine";
  if (METER_KEYS.some((k) => meters[k] === 3)) return "stands";
  if (METER_KEYS.some((k) => meters[k] === 2) || meterSum(meters) >= LOOK_MIN_SUM) return "look";
  return "routine";
}

/** A row's meter: the maximum over its lines, -1 below 0 (LD3 "Combining"). */
export function combineMeters(lines: readonly Pick<LineScore, "meters">[]): Meters {
  const out: Meters = { size: -1, pattern: -1, others: -1, cmte: -1 };
  for (const l of lines) for (const k of METER_KEYS) if (l.meters[k] > out[k]) out[k] = l.meters[k];
  return out;
}

/** LD4's sort: Stands out and Worth a look by count of level-3 meters, then
    sum, then lead `low`, then `filed`; Routine by `filed`; all descending. */
export function compareRows(a: TriageRow, b: TriageRow): number {
  if (a.tier !== "routine" || b.tier !== "routine") {
    const d =
      count3(b.meters) - count3(a.meters) ||
      meterSum(b.meters) - meterSum(a.meters) ||
      (b.lead.txn.low ?? -1) - (a.lead.txn.low ?? -1);
    if (d !== 0) return d;
  }
  return a.filed !== b.filed ? (a.filed < b.filed ? 1 : -1) : a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
}

/* ================================================================ sentences (LD5) */

const SIDE_PLURAL: Readonly<Record<"purchase" | "sale", string>> = { purchase: "purchases", sale: "sales" };
const KIND_WORDS: Readonly<Record<SignalKind, string>> = {
  "s1-large": "large disclosure",
  "s2-first": "first disclosure of the ticker",
  "s3-cooccurrence": "co-occurrence",
  "s4-infrequent": "infrequent discloser",
  "s5-jurisdiction": "committee overlap",
  "s6-late-large": "late and large",
};
const KIND_ORDER: readonly SignalKind[] = ["s1-large", "s4-infrequent", "s3-cooccurrence", "s2-first", "s5-jurisdiction", "s6-late-large"];

function rangeText(from: string | null, to: string | null): string {
  if (from === null || to === null) return "in one window";
  return from === to ? from : `${from} to ${to}`;
}

/** The row's lines by one meter, strongest first; at equal levels the lead
    line first, so a clause names the row's own heading line whenever it can. */
function strongestBy(row: Pick<TriageRow, "lines" | "lead">, key: MeterKey): LineScore[] {
  return [...row.lines].sort(
    (a, b) => b.meters[key] - a.meters[key] || Number(b === row.lead) - Number(a === row.lead) || (b.txn.low ?? -1) - (a.txn.low ?? -1),
  );
}

/** The clauses LD5's templates produce for a row, strongest first. */
export function sentenceClauses(row: Pick<TriageRow, "grouping" | "lines" | "cluster" | "batch" | "filed" | "filings" | "lead">): string[] {
  const out: string[] = [];
  const lead = row.lead;
  // Late batch
  if (row.grouping === "late-batch" && row.batch && row.batch.lateFilings > 0) {
    out.push(
      `${plural(row.batch.lateFilings, "late filing", "late filings")} on ${row.filed} completed ${plural(row.batch.clusters.length, "cluster", "clusters")} from ${row.batch.years}.`,
    );
  }
  // Cluster (the cluster row's own count, or a line inside one)
  const clusterFacts =
    row.cluster ??
    (lead.others.s3 && lead.meters.others >= 2
      ? { s3: lead.others.s3, members: lead.others.members, tradedFrom: lead.others.tradedFrom, tradedTo: lead.others.tradedTo }
      : null);
  if (clusterFacts && clusterFacts.s3.side && (clusterFacts.s3.side === "purchase" || clusterFacts.s3.side === "sale")) {
    out.push(
      `${clusterFacts.members} members disclosed ${clusterFacts.s3.entities.ticker ?? "one ticker"} ${SIDE_PLURAL[clusterFacts.s3.side]} traded ${rangeText(clusterFacts.tradedFrom, clusterFacts.tradedTo)}.`,
    );
  }
  // Pattern
  const byPattern = strongestBy(row, "pattern")[0];
  if (byPattern && byPattern.meters.pattern === 3 && byPattern.pattern.firstOnRecord) {
    const n = row.filings.find((f) => f.doc === byPattern.doc)?.rows.length ?? 0;
    out.push(n === 1 ? "First disclosure on record — a one-line filing." : `First filing on record: ${n} lines.`);
  } else if (byPattern && byPattern.meters.pattern >= 1 && byPattern.pattern.lastPrior) {
    out.push(`First trades since ${monthYear(byPattern.pattern.lastPrior)}.`);
  }
  // Size
  const bySize = strongestBy(row, "size")[0];
  if (bySize && bySize.meters.size >= 2 && bySize.bracketDelta !== null && bySize.bracketDelta >= 1) {
    out.push(
      bySize.largestOnRecord
        ? "The largest disclosure on the member's record."
        : `${plural(bySize.bracketDelta, "bracket", "brackets")} above anything in ${bySize.history.withLow} prior disclosures.`,
    );
  }
  // Committee (direct)
  const direct = strongestBy(row, "cmte").find((l) => l.meters.cmte === 2 && l.cmte.grade === "direct");
  if (direct) {
    const name = direct.cmte.committees.find((c) => c.name)?.name ?? direct.cmte.committees[0]?.committeeId ?? "a committee";
    out.push(`${direct.txn.ticker ?? "The issuer"} sits inside ${name}, where the member serves.`);
  }
  if (out.length === 0) {
    // No template fires (no meter reaches a stated fact): the rules the row's
    // lines matched, in the rule book's order (plan deviation, DEV-NOTES).
    const kinds = new Set(row.lines.flatMap((l) => l.signals.map((s) => s.kind)));
    const words = KIND_ORDER.filter((k) => kinds.has(k)).map((k) => KIND_WORDS[k]);
    /* copy item signals-06 (launch M7a): the rule words alone, without the
       "Rules matched:" prefix every such row repeated */
    const said = words.join(", ");
    out.push(words.length ? `${said.charAt(0).toUpperCase()}${said.slice(1)}.` : "No rule named.");
  }
  return out;
}

/** The reason sentence: clauses joined with a space, strongest first, while
    the total stays within SENTENCE_MAX characters. */
export function rowSentence(row: Parameters<typeof sentenceClauses>[0]): string {
  let s = "";
  for (const c of sentenceClauses(row)) {
    const next = s === "" ? c : `${s} ${c}`;
    if ([...next].length > SENTENCE_MAX) continue;
    s = next;
  }
  return s;
}

/* ================================================================ cards (LD6) */

function cardOrderAbsolute(a: LineScore, b: LineScore): number {
  return (b.txn.low ?? -1) - (a.txn.low ?? -1) || (a.txn.filed < b.txn.filed ? 1 : a.txn.filed > b.txn.filed ? -1 : 0) || (a.txn.txnId < b.txn.txnId ? -1 : 1);
}

/** Own-record eligibility (LD6): at least RECORD_MIN_PRIOR prior disclosures
    spanning at least RECORD_MIN_SPAN_DAYS days, and a lower bound of at least
    RECORD_MIN_LOW. */
export function recordEligible(l: LineScore): boolean {
  return (
    l.history.rows >= RECORD_MIN_PRIOR &&
    (l.history.spanDays ?? -1) >= RECORD_MIN_SPAN_DAYS &&
    (l.txn.low ?? -1) >= RECORD_MIN_LOW &&
    l.bracketDelta !== null
  );
}

function recordFact(l: LineScore): string {
  const d = l.bracketDelta!;
  const n = l.history.withLow;
  if (d >= 1) return `${plural(d, "bracket", "brackets")} above anything in ${n} prior disclosures.`;
  if (d === 0) return `In the bracket of the largest of ${n} prior disclosures.`;
  return `${plural(-d, "bracket", "brackets")} below the largest of ${n} prior disclosures.`;
}

/** The committee card's fact (LD6), from the line's own grade facts. An
    unresolved SIC is stated as missing, never as a range result (D22): a
    broad grade with no SIC on record says so, and only a KNOWN SIC is said to
    sit outside the matched committees' direct ranges. */
export function committeeFact(l: Pick<LineScore, "cmte">): string {
  const cs = l.cmte.committees;
  const name = cs[0]?.name || cs[0]?.committeeId || "a committee";
  if (l.cmte.grade === "direct" && l.cmte.sic !== null) return `SIC ${sicText(l.cmte.sic)} sits inside a direct range of ${name}.`;
  if (l.cmte.sic === null) return `The issuer's sector sits inside ${name}; its 4-digit SIC is not on record, so the match is graded broad.`;
  if (!cs.some((c) => Object.hasOwn(DIRECT_SIC, c.committeeId))) {
    return `${cs.length > 1 ? `None of the ${cs.length} matched committees has a` : `${name} has no`} direct range in table v${COMMITTEE_DIRECT_VERSION}; the sector match is graded broad.`;
  }
  const whose = cs.length > 1 ? `the direct ranges of all ${cs.length} matched committees` : `the direct ranges of ${name}`;
  return `SIC ${sicText(l.cmte.sic)} is outside ${whose}; the sector match is graded broad.`;
}

export function pickCards(rows: readonly TriageRow[]): TriageCards {
  /* R11: every card links to its ticker page, so a listed-stock line with no
     parsed ticker (a Senate "Stock" line the filer named only in prose) can
     never be a card: it has no page to link to. */
  const pool: { line: LineScore; row: TriageRow }[] = [];
  for (const row of rows) for (const line of row.lines) if (isListedStock(line.txn.assetType) && line.txn.ticker != null) pool.push({ line, row });
  const pick = (cands: { line: LineScore; row: TriageRow }[], cmp: (a: LineScore, b: LineScore) => number, fact: (l: LineScore, n: number) => string): CardPick | null => {
    if (cands.length === 0) return null;
    const best = [...cands].sort((a, b) => cmp(a.line, b.line))[0]!;
    return { line: best.line, row: best.row, fact: fact(best.line, cands.length) };
  };
  const withLow = pool.filter((p) => p.line.txn.low != null);
  const buys = withLow.filter((p) => p.line.txn.side === "purchase");
  const sells = withLow.filter((p) => p.line.txn.side === "sale" || p.line.txn.side === "sale_partial");
  const byRecord = (a: LineScore, b: LineScore): number => b.bracketDelta! - a.bracketDelta! || cardOrderAbsolute(a, b);
  /* copy item signals-04: the same fact, the method words left to Methodology */
  /* copy item signals-04, adapted (launch review H7, orchestrator decision):
     the shortened fact keeps its scope qualifier — listed-stock lines, in the
     window — so the bound is never read as one over every trade */
  const absFact = (noun: string) => (_l: LineScore, n: number) => `Largest lower bound of ${plural(n, `listed-stock ${noun}`, `listed-stock ${noun}s`)} in the window.`;
  const s5 = pool.filter((p) => p.line.cmte.grade !== null);
  const committee = pick(
    s5,
    (a, b) => Number(b.cmte.grade === "direct") - Number(a.cmte.grade === "direct") || cardOrderAbsolute(a, b),
    (l) => committeeFact(l),
  );
  return {
    committee,
    buyRecord: pick(buys.filter((p) => recordEligible(p.line)), byRecord, recordFact),
    buyAbsolute: pick(buys, cardOrderAbsolute, absFact("purchase")),
    sellRecord: pick(sells.filter((p) => recordEligible(p.line)), byRecord, recordFact),
    sellAbsolute: pick(sells, cardOrderAbsolute, absFact("sale")),
  };
}

/* ================================================================ build */

/** LD1: the triage of one build. */
export function buildTriage(artifact: SignalArtifact, txns: readonly TxnRow[], ctx: TriageContext): TriageResult {
  const identityOf = ctx.identityOf ?? signalIdentity;
  const clean = excludeDateAnomalies(txns).rows;
  const byMember = new Map<string, TxnRow[]>();
  for (const r of clean) {
    const k = memberKeyOf(r);
    let l = byMember.get(k);
    if (!l) byMember.set(k, (l = []));
    l.push(r);
  }
  const byDoc = new Map<string, TxnRow[]>();
  const byTxn = new Map<string, TxnRow>();
  for (const r of txns) {
    let l = byDoc.get(r.doc);
    if (!l) byDoc.set(r.doc, (l = []));
    l.push(r);
    byTxn.set(r.txnId, r);
  }
  const active = artifact.signals.filter((s) => s.status === "active");
  const s5w = artifact.withheld.find((w) => w.kind === "s5-jurisdiction") ?? null;
  const cmteAvailable = ctx.committee !== null && s5w === null;
  const cmteUnavailableReason = cmteAvailable ? null : s5w ? `${s5w.reason}: ${s5w.detail}` : "inputs-not-in-build";

  /* ---- hit lines (LD3 "Lines") ---- */
  const hitSignals = new Map<string, Signal[]>();
  const hitLines = new Map<string, string[]>();
  const mark = (r: TxnRow, s: Signal): void => {
    let l = hitSignals.get(r.txnId);
    if (!l) hitSignals.set(r.txnId, (l = []));
    if (!l.includes(s)) l.push(s);
    let ids = hitLines.get(s.id);
    if (!ids) hitLines.set(s.id, (ids = []));
    if (!ids.includes(r.txnId)) ids.push(r.txnId);
  };
  const s5Lines = new Set<string>();
  const activeS3: Signal[] = [];
  const s3Rows = new Map<string, TxnRow[]>();
  let unlocated = 0;
  for (const s of active) {
    if (s.kind === "s3-cooccurrence") {
      const start = s.occurrence.tradeDate;
      const side = s.side === "purchase" || s.side === "sale" ? s.side : null;
      if (!start || !side || !s.entities.ticker) {
        unlocated++;
        continue;
      }
      const rows = s3WindowRows(clean, s.entities.ticker, side, start);
      activeS3.push(s);
      s3Rows.set(s.id, rows);
      for (const r of rows) mark(r, s);
    } else if (s.kind === "s2-first") {
      const doc = s.receipts[0];
      const rows = (doc ? byDoc.get(doc) ?? [] : []).filter((r) => r.bioguide === s.entities.bioguide && r.ticker === s.entities.ticker);
      if (rows.length === 0) unlocated++;
      for (const r of rows) mark(r, s);
    } else {
      const id = identityOf(s);
      const r = id === null ? undefined : byTxn.get(id);
      if (!r) {
        unlocated++;
        continue;
      }
      mark(r, s);
      if (s.kind === "s5-jurisdiction") s5Lines.add(r.txnId);
    }
  }
  activeS3.sort((a, b) => (a.occurrence.tradeDate! < b.occurrence.tradeDate! ? -1 : a.occurrence.tradeDate! > b.occurrence.tradeDate! ? 1 : a.id < b.id ? -1 : 1));

  const e: Engine = { artifact, clean, byMember, byDoc, activeS3, s3Rows, hitSignals, s5Lines, committee: ctx.committee, cmteAvailable, patternMemo: new Map() };

  /* ---- the ranked universe (R6): filings filed in the window with at least
     one ranked line ---- */
  const filings: TriageFiling[] = [];
  for (const [doc, rows] of byDoc) {
    const filed = rows.reduce((m, r) => (r.filed > m ? r.filed : m), rows[0]!.filed);
    if (filed < artifact.coverageFrom || filed > artifact.coverageTo) continue;
    const ranked = rows.filter((r) => hitSignals.has(r.txnId) && isListedStock(r.assetType));
    if (ranked.length === 0) continue;
    filings.push({ doc, filed, memberKey: memberKeyOf(rows[0]!), rows, ranked });
  }
  filings.sort((a, b) => (a.filed < b.filed ? -1 : a.filed > b.filed ? 1 : a.doc < b.doc ? -1 : 1));

  // Each filing scored as a single filing (C = its own filed): its lead line
  // decides the cluster and same-ticker groupings.
  const single = new Map<string, LineScore[]>();
  const singleLead = new Map<string, LineScore>();
  for (const f of filings) {
    const lines = f.ranked.map((r) => scoreLine(e, r, f, f.filed));
    single.set(f.doc, lines);
    singleLead.set(f.doc, pickLead(lines));
  }

  const rows: TriageRow[] = [];
  const taken = new Set<string>();
  const makeRow = (
    grouping: Grouping,
    fs: TriageFiling[],
    lines: LineScore[],
    cutoff: string | null,
    extra: Pick<TriageRow, "cluster" | "batch">,
  ): void => {
    for (const f of fs) taken.add(f.doc);
    const meters = combineMeters(lines);
    const lead = pickLead(lines);
    const allRows = fs.flatMap((f) => f.rows);
    const row: TriageRow = {
      key: `${grouping}:${fnv1a64(fs.map((f) => f.doc).sort().join("\n"))}`,
      grouping,
      tier: tierOf(meters, lead),
      meters,
      lead,
      lines,
      filings: fs,
      filed: fs.reduce((m, f) => (f.filed > m ? f.filed : m), fs[0]!.filed),
      cutoff,
      totalLines: allRows.length,
      lateLines: allRows.filter((r) => r.late === 1).length,
      ...extra,
      sentence: "",
      signals: [...new Map(lines.flatMap((l) => l.signals).map((s) => [s.id, s])).values()],
    };
    row.sentence = rowSentence(row);
    rows.push(row);
  };

  /* ---- 1. late batch ---- */
  const consumed = new Set<string>();
  const byMemberDate = new Map<string, TriageFiling[]>();
  for (const f of filings) {
    const k = `${f.memberKey}\u0001${f.filed}`;
    let l = byMemberDate.get(k);
    if (!l) byMemberDate.set(k, (l = []));
    l.push(f);
  }
  for (const fs of byMemberDate.values()) {
    const filed = fs[0]!.filed;
    const docs = new Set(fs.map((f) => f.doc));
    const completed = activeS3.filter(
      (s) =>
        s.occurrence.filedDate === filed &&
        s3WindowEnd(s.occurrence.tradeDate!) < artifact.coverageFrom &&
        (s3Rows.get(s.id) ?? []).some((r) => docs.has(r.doc)),
    );
    if (completed.length < LATE_BATCH_MIN_CLUSTERS) continue;
    for (const s of completed) consumed.add(s.id);
    const years = [...new Set(completed.map((s) => s.occurrence.tradeDate!.slice(0, 4)))].sort();
    const lines = fs.flatMap((f) => f.ranked.map((r) => scoreLine(e, r, f, filed)));
    makeRow("late-batch", fs, lines, filed, {
      cluster: null,
      batch: {
        clusters: completed,
        years: years.length === 1 ? years[0]! : `${years[0]}–${years[years.length - 1]}`,
        lateFilings: fs.filter((f) => f.rows.some((r) => r.late === 1)).length,
      },
    });
  }

  /* ---- 2. cluster ---- */
  for (const s of activeS3) {
    if (consumed.has(s.id)) continue;
    const windowDocs = new Set((s3Rows.get(s.id) ?? []).map((r) => r.doc));
    const absorbed = filings.filter((f) => {
      if (taken.has(f.doc) || !windowDocs.has(f.doc)) return false;
      const lead = singleLead.get(f.doc)!;
      return lead.txn.ticker === s.entities.ticker && s3SideClass(lead.txn.side) === s.side;
    });
    if (absorbed.length === 0) continue;
    const cutoff = absorbed.reduce((m, f) => (f.filed > m ? f.filed : m), absorbed[0]!.filed);
    const lines = absorbed.flatMap((f) => f.ranked.map((r) => scoreLine(e, r, f, cutoff)));
    const counted = (s3Rows.get(s.id) ?? []).filter((r) => r.filed <= cutoff);
    const traded = counted.map((r) => r.traded!).sort();
    makeRow("cluster", absorbed, lines, cutoff, {
      cluster: { s3: s, members: new Set(counted.map(memberKeyOf)).size, tradedFrom: traded[0] ?? null, tradedTo: traded[traded.length - 1] ?? null },
      batch: null,
    });
  }

  /* ---- 3. same member and ticker ---- */
  const byMemberTicker = new Map<string, TriageFiling[]>();
  for (const f of filings) {
    if (taken.has(f.doc)) continue;
    const t = singleLead.get(f.doc)!.txn.ticker;
    if (t == null) continue;
    const k = `${f.memberKey}\u0001${t}`;
    let l = byMemberTicker.get(k);
    if (!l) byMemberTicker.set(k, (l = []));
    l.push(f);
  }
  for (const fs of byMemberTicker.values()) {
    if (fs.length < 2) continue;
    // each constituent at its OWN filed date — no sibling filed after it is seen
    makeRow("member-ticker", fs, fs.flatMap((f) => single.get(f.doc)!), null, { cluster: null, batch: null });
  }

  /* ---- 4. single filing ---- */
  for (const f of filings) {
    if (taken.has(f.doc)) continue;
    makeRow("single", [f], single.get(f.doc)!, f.filed, { cluster: null, batch: null });
  }

  const order: Tier[] = ["stands", "look", "routine"];
  rows.sort((a, b) => order.indexOf(a.tier) - order.indexOf(b.tier) || compareRows(a, b));
  const counts = { stands: 0, look: 0, routine: 0 };
  for (const r of rows) counts[r.tier]++;
  const byTicker = new Map<string, TriageRow[]>();
  for (const r of rows) {
    const t = r.lead.txn.ticker;
    if (t == null) continue;
    let l = byTicker.get(t);
    if (!l) byTicker.set(t, (l = []));
    l.push(r);
  }
  const hitsByTicker = new Map<string, Signal[]>();
  for (const s of active) {
    const t = s.entities.ticker;
    if (t == null) continue;
    let l = hitsByTicker.get(t);
    if (!l) hitsByTicker.set(t, (l = []));
    l.push(s);
  }
  return {
    rows,
    counts,
    byTicker,
    hitsByTicker,
    cards: pickCards(rows),
    version: TRIAGE_VERSION,
    cmteAvailable,
    cmteUnavailableReason,
    unlocated,
    hitLines,
  };
}
