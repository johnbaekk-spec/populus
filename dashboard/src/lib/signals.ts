/* D-1 / D-1a / D-1b / D-1c (ALPHA-UX): the congressional signal engine.

   CONGRESSIONAL ONLY (S-1…S-6). Institutional signals (S-7…S-11) need B-1's
   closed periods and the D-1a suppression rule over adjacent
   authoritative-full quarters; the artifact schema is ready for them but this
   module never fabricates their inputs. S-12 is counsel-gated and absent.

   D-1: every signal carries the full temporal/lifecycle contract — stable
   identity, kind, entity refs, magnitude interval, receipts, threshold
   version, occurrence dates, source-availability time, computed time, build
   ids, status, and the artifact-level coverage window.

   D-1b: no threshold ships uncalibrated. Thresholds live in the versioned
   signal-thresholds.json with their backtest record; at build time the
   engine measures each kind's actual emission volume and WITHHOLDS (typed
   reason) any kind whose calibration block is absent or whose volume falls
   outside its declared bounds. A withheld kind renders as withheld — never
   silently empty.

   D-1c: the artifact declares its retention window (signals whose filed date
   falls inside `retention_days` of the build date). Identities are stable
   deterministic hashes, so the same signal has the same id in every build
   that retains it; a device cursor older than `coverage_from` is a coverage
   gap the UI states (shared classifyCursor rule). Lifecycle CHAINS across
   builds: the publisher supplies the previously deployed artifact
   (POPULUS_PRIOR_SIGNALS, wired in the site-build workflow), first-seen
   builds carry forward by stable id, and a previously-active signal that
   leaves the retained view gains a supersession tombstone preserved
   UNCHANGED by every later build until compaction. Cold start (no prior
   artifact) is the genuine-first-build case only, and says so. */

import { SIGNAL_THRESHOLDS } from "./signal-thresholds.ts";
import type { TxnRow } from "./format.ts";
import {
  excludeDateAnomalies,
  fnv1a64,
  jurisdictionOverlap,
  type CommitteeMembership,
  type SectorResolution,
} from "./derive.ts";

export type SignalKind =
  | "s1-large"
  | "s2-first"
  | "s3-cooccurrence"
  | "s4-infrequent"
  | "s5-jurisdiction"
  | "s6-late-large";

export interface Signal {
  id: string; // stable across builds: hash of kind + dedupe identity
  kind: SignalKind;
  rule: string; // the exact rule, rendered verbatim on every surface
  thresholdVersion: string;
  entities: { bioguide: string | null; memberName: string; ticker: string | null };
  /** magnitude as a disclosed interval — null bound stays null */
  magnitude: { low: number | null; high: number | null };
  receipts: string[]; // government source-document URLs
  occurrence: { tradeDate: string | null; filedDate: string };
  sourceAvailableAt: string; // when the source published (filed date)
  computedAt: string; // this build's generated_at
  firstSeenBuild: string; // carried forward from the prior artifact when one is chained (D-1c)
  lastSeenBuild: string;
  /** `active` — evaluated and emitted by THIS build.
      `superseded` — was active, the kind WAS evaluated, and it no longer
        appears: amended/superseded filing, or the rule stopped matching.
      `unevaluated` — its kind was WITHHELD this build, so nothing was asked
        of it. Review r3-F3: withholding means "not evaluated"; stamping these
        superseded would record missing inputs as a retraction. */
  status: "active" | "superseded" | "unevaluated";
  /** set on tombstones: the build whose artifact no longer carries the signal */
  supersededInBuild?: string;
  /** set when a kind's withholding first left this signal unevaluated */
  unevaluatedInBuild?: string;
  /** volume cohort (D-1b: measured volume bounds BY COHORT) */
  cohort: "house" | "senate";
}

export interface WithheldKind {
  kind: SignalKind;
  reason:
    | "uncalibrated"
    | "volume-out-of-bounds"
    | "inputs-not-in-build"
    | "insufficient-history";
  detail: string;
}

export interface SignalArtifact {
  v: 1;
  buildId: string;
  computedAt: string;
  thresholdVersion: string;
  retentionDays: number;
  coverageFrom: string; // filed-date window start — the D-1c boundary
  coverageTo: string;
  lifecycleNote: string;
  compaction: string;
  /** constraint 9: date_anomaly rows removed before ANY kind computed (disclosed) */
  dateAnomaliesExcluded: number;
  signals: Signal[];
  withheld: WithheldKind[];
  /** the lag caveat every surface renders with every signal */
  lagCaveat: string;
}

const SIGNAL_KINDS: ReadonlySet<string> = new Set([
  "s1-large", "s2-first", "s3-cooccurrence", "s4-infrequent", "s5-jurisdiction", "s6-late-large",
]);
const SIGNAL_STATUSES: ReadonlySet<string> = new Set(["active", "superseded", "unevaluated"]);
const WITHHELD_REASONS: ReadonlySet<string> = new Set([
  "uncalibrated", "volume-out-of-bounds", "inputs-not-in-build", "insufficient-history",
]);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Strict schema validation of a PRIOR artifact before it is chained
    (review r3-F2). `v === 1` alone let a structurally invalid document pass
    as history — which would silently erase lifecycle continuity while the new
    artifact claimed to have preserved it. Returns every defect; a non-empty
    return means the document is not usable as lifecycle state. */
export function validateSignalArtifact(doc: unknown): string[] {
  const errors: string[] = [];
  if (typeof doc !== "object" || doc === null) return ["artifact is not an object"];
  const a = doc as Record<string, unknown>;
  if (a.v !== 1) errors.push(`artifact version must be 1 (got ${JSON.stringify(a.v)})`);
  const str = (k: string): void => {
    if (typeof a[k] !== "string" || (a[k] as string) === "") errors.push(`${k} must be a non-empty string`);
  };
  for (const k of ["buildId", "computedAt", "thresholdVersion", "lifecycleNote", "compaction", "lagCaveat"]) str(k);
  for (const k of ["coverageFrom", "coverageTo"]) {
    if (typeof a[k] !== "string" || !DATE_RE.test(a[k] as string)) errors.push(`${k} must be YYYY-MM-DD`);
  }
  for (const k of ["retentionDays", "dateAnomaliesExcluded"]) {
    if (typeof a[k] !== "number" || !Number.isFinite(a[k] as number)) errors.push(`${k} must be a number`);
  }
  if (!Array.isArray(a.withheld)) errors.push("withheld must be an array");
  else {
    a.withheld.forEach((w, i) => {
      const x = w as Record<string, unknown>;
      if (typeof x !== "object" || x === null) return void errors.push(`withheld[${i}] is not an object`);
      if (!SIGNAL_KINDS.has(String(x.kind))) errors.push(`withheld[${i}].kind is unknown: ${String(x.kind)}`);
      if (!WITHHELD_REASONS.has(String(x.reason))) errors.push(`withheld[${i}].reason is unknown: ${String(x.reason)}`);
      if (typeof x.detail !== "string" || x.detail === "") errors.push(`withheld[${i}].detail must be a non-empty string`);
    });
  }
  if (!Array.isArray(a.signals)) return errors.concat("signals must be an array");
  // Review c2-F1: identity must be UNIQUE. Two rows on one id collapse two
  // histories into one — and the chaining loop keys on id, so the collision
  // silently decides which lifecycle survives.
  const seenIds = new Set<string>();
  a.signals.forEach((raw, i) => {
    const id = (raw as Record<string, unknown> | null)?.id;
    if (typeof id === "string") {
      if (seenIds.has(id)) errors.push(`signals[${i}]: duplicate signal id ${id}`);
      seenIds.add(id);
    }
  });
  a.signals.forEach((raw, i) => {
    const at = (m: string): void => void errors.push(`signals[${i}]: ${m}`);
    if (typeof raw !== "object" || raw === null) return at("not an object");
    const g = raw as Record<string, unknown>;
    for (const k of ["id", "rule", "thresholdVersion", "sourceAvailableAt", "computedAt", "firstSeenBuild", "lastSeenBuild"]) {
      if (typeof g[k] !== "string" || g[k] === "") at(`${k} must be a non-empty string`);
    }
    if (!SIGNAL_KINDS.has(String(g.kind))) at(`kind is unknown: ${String(g.kind)}`);
    if (!SIGNAL_STATUSES.has(String(g.status))) at(`status is unknown: ${String(g.status)}`);
    if (g.cohort !== "house" && g.cohort !== "senate") at(`cohort must be house|senate (got ${String(g.cohort)})`);
    /* Review c2-F1: status-specific lifecycle fields. The legal shapes are
       exactly:
         active       → neither stamp (it is emitted by THIS build)
         unevaluated  → unevaluatedInBuild, and no supersession stamp
         superseded   → supersededInBuild; an unevaluatedInBuild MAY also be
                        present, because "went unevaluated in B, superseded in
                        C" is real history, not a contradiction. */
    const hasSuperseded = typeof g.supersededInBuild === "string" && g.supersededInBuild !== "";
    const hasUnevaluated = typeof g.unevaluatedInBuild === "string" && g.unevaluatedInBuild !== "";
    if (g.supersededInBuild !== undefined && !hasSuperseded) at("supersededInBuild must be a non-empty string when present");
    if (g.unevaluatedInBuild !== undefined && !hasUnevaluated) at("unevaluatedInBuild must be a non-empty string when present");
    if (g.status === "superseded" && !hasSuperseded) {
      at("a superseded signal must name the build that superseded it");
    }
    if (g.status === "unevaluated") {
      if (!hasUnevaluated) at("an unevaluated signal must name the build in which evaluation stopped");
      if (hasSuperseded) at("an unevaluated signal cannot also carry a supersession stamp");
    }
    if (g.status === "active" && (hasSuperseded || hasUnevaluated)) {
      at("an active signal carries no supersession or unevaluated stamp");
    }
    const ent = g.entities as Record<string, unknown> | undefined;
    if (typeof ent !== "object" || ent === null) at("entities must be an object");
    else {
      if (ent.bioguide !== null && typeof ent.bioguide !== "string") at("entities.bioguide must be string|null");
      if (ent.ticker !== null && typeof ent.ticker !== "string") at("entities.ticker must be string|null");
      if (typeof ent.memberName !== "string") at("entities.memberName must be a string");
    }
    const mag = g.magnitude as Record<string, unknown> | undefined;
    if (typeof mag !== "object" || mag === null) at("magnitude must be an object");
    else {
      for (const k of ["low", "high"]) {
        if (mag[k] !== null && typeof mag[k] !== "number") at(`magnitude.${k} must be number|null`);
      }
    }
    const occ = g.occurrence as Record<string, unknown> | undefined;
    if (typeof occ !== "object" || occ === null) at("occurrence must be an object");
    else {
      if (typeof occ.filedDate !== "string" || !DATE_RE.test(occ.filedDate)) at("occurrence.filedDate must be YYYY-MM-DD");
      if (occ.tradeDate !== null && (typeof occ.tradeDate !== "string" || !DATE_RE.test(occ.tradeDate))) {
        at("occurrence.tradeDate must be YYYY-MM-DD|null");
      }
    }
    if (!Array.isArray(g.receipts) || g.receipts.length === 0 || g.receipts.some((r) => typeof r !== "string")) {
      at("receipts must be a non-empty array of strings");
    }
  });
  return errors;
}

export const LAG_CAVEAT =
  "PTRs are filed up to 45 days after the trade (later when late) — at read time the position " +
  "may have changed or closed; a signal describes a disclosure, never a current holding.";

type ThresholdsShape = {
  version: string;
  retention_days: number;
  kinds: Record<
    string,
    {
      params: Record<string, unknown>;
      dedupe_key: string;
      cooldown_days: number;
      min_history_days: number;
      calibration: {
        backtest_from: string;
        backtest_to: string;
        measured: string;
        volume_bounds: { max_per_30d: number; min_total_backtest: number };
      } | null;
    }
  >;
};
/* Module-level default. Per-kind PARAMS are read here by the compute
   functions; the gate (history/dedupe/cooldown/volume) reads the possibly
   overridden copy passed to buildSignalArtifact — the override exists so
   tests can mutate gate configuration and prove enforcement. */
const T = SIGNAL_THRESHOLDS as unknown as ThresholdsShape;

function signalId(kind: SignalKind, identity: string): string {
  return `${kind}:${fnv1a64(identity)}`;
}

/* The raw identity a compute function minted this signal from. Symbol-keyed
   so it never serializes into the artifact, and read only by the gate when it
   re-derives the id from the DECLARED dedupe grammar (review r3-F5). */
const RAW_IDENTITY = Symbol("populus.signal.rawIdentity");

function rawIdentityOf(sig: Signal): string {
  return (sig as unknown as Record<symbol, string>)[RAW_IDENTITY] ?? sig.id;
}

function addDaysIso(dateIso: string, days: number): string {
  const t = Date.UTC(
    Number(dateIso.slice(0, 4)),
    Number(dateIso.slice(5, 7)) - 1,
    Number(dateIso.slice(8, 10)),
  );
  return new Date(t + days * 86_400_000).toISOString().slice(0, 10);
}

interface EmitCtx {
  buildId: string;
  computedAt: string;
  coverageFrom: string;
  coverageTo: string;
}

function baseSignal(kind: SignalKind, identity: string, rule: string, r: TxnRow, ctx: EmitCtx): Signal {
  const sig: Signal = {
    id: signalId(kind, identity),
    kind,
    rule,
    thresholdVersion: T.version,
    entities: { bioguide: r.bioguide, memberName: r.name, ticker: r.ticker },
    magnitude: { low: r.low, high: r.high },
    receipts: [r.doc],
    occurrence: { tradeDate: r.traded, filedDate: r.filed },
    sourceAvailableAt: r.filed,
    computedAt: ctx.computedAt,
    firstSeenBuild: ctx.buildId,
    lastSeenBuild: ctx.buildId,
    status: "active",
    cohort: r.chamber,
  };
  Object.defineProperty(sig, RAW_IDENTITY, { value: identity, enumerable: false });
  return sig;
}

/** Lower-bound key with the F-16 capped rule (a null low with a known high is 0). */
function lowerBound(r: Pick<TxnRow, "low" | "high">): number | null {
  if (r.low != null) return r.low;
  if (r.high != null) return 0;
  return null;
}

/* ---------- per-kind computation over the FULL corpus (backtest = emission
   over all history; the artifact then retains the coverage window) ---------- */

function computeS1(txns: readonly TxnRow[], ctx: EmitCtx): Signal[] {
  const min = Number(T.kinds["s1-large"]!.params.min_lower_bound_usd);
  const rule = `amount lower bound ≥ $${(min / 1000).toFixed(0)}K — the disclosed lower bound, never the upper`;
  return txns
    .filter((r) => (lowerBound(r) ?? -1) >= min)
    .map((r) => baseSignal("s1-large", r.txnId, rule, r, ctx));
}

function computeS2(txns: readonly TxnRow[], ctx: EmitCtx, corpusFrom: string): Signal[] {
  const rule =
    `first disclosure of this ticker by this member within the corpus — era-scoped: coverage ` +
    `begins ${corpusFrom}, so an earlier first disclosure cannot be seen and is not claimed against`;
  const firstByPair = new Map<string, TxnRow>();
  for (const r of txns) {
    if (!r.bioguide || !r.ticker) continue;
    const key = `${r.bioguide} ${r.ticker}`;
    const prior = firstByPair.get(key);
    const dateOf = (x: TxnRow): string => x.traded ?? x.filed;
    if (!prior || dateOf(r) < dateOf(prior)) firstByPair.set(key, r);
  }
  return [...firstByPair.entries()].map(([key, r]) =>
    baseSignal("s2-first", key, rule, r, ctx),
  );
}

function computeS3(txns: readonly TxnRow[], ctx: EmitCtx): Signal[] {
  const p = T.kinds["s3-cooccurrence"]!.params as { min_members: number; window_days: number };
  const rule =
    `≥${p.min_members} distinct members disclosed the same ticker, same side, within a ` +
    `${p.window_days}-day trade-date window`;
  const dated = excludeDateAnomalies(txns).rows.filter(
    (r) => r.traded != null && r.ticker != null && (r.side === "purchase" || r.side === "sale" || r.side === "sale_partial"),
  );
  const groups = new Map<string, TxnRow[]>();
  for (const r of dated) {
    const side = r.side === "purchase" ? "purchase" : "sale";
    const key = `${r.ticker} ${side}`;
    let list = groups.get(key);
    if (!list) {
      list = [];
      groups.set(key, list);
    }
    list.push(r);
  }
  const out: Signal[] = [];
  for (const [key, list] of groups) {
    list.sort((a, b) => (a.traded! < b.traded! ? -1 : 1));
    let cooldownUntil = "";
    for (let i = 0; i < list.length; i++) {
      const start = list[i]!.traded!;
      if (start <= cooldownUntil) continue;
      const end = addDaysIso(start, p.window_days);
      const window = list.filter((r) => r.traded! >= start && r.traded! <= end);
      const members = new Set(window.map((r) => r.bioguide ?? `raw:${r.name}`));
      if (members.size >= p.min_members) {
        const first = window[0]!;
        const sig = baseSignal("s3-cooccurrence", `${key} ${start}`, rule, first, ctx);
        sig.entities = { bioguide: null, memberName: `${members.size} members`, ticker: first.ticker };
        sig.receipts = [...new Set(window.map((r) => r.doc))];
        // magnitude: sum of disclosed lower bounds (conservative), upper open
        // if any row is open — but a cluster magnitude as one interval over
        // many rows: [sum lows, sum highs or null].
        const lows = window.map((r) => r.low ?? 0).reduce((a, b) => a + b, 0);
        const anyOpen = window.some((r) => r.high == null);
        const highs = anyOpen ? null : window.map((r) => r.high!).reduce((a, b) => a + b, 0);
        sig.magnitude = { low: lows, high: highs };
        sig.occurrence = { tradeDate: start, filedDate: window.map((r) => r.filed).sort().at(-1)! };
        sig.sourceAvailableAt = sig.occurrence.filedDate;
        out.push(sig);
        cooldownUntil = addDaysIso(start, T.kinds["s3-cooccurrence"]!.cooldown_days);
      }
    }
  }
  return out;
}

function computeS4(txns: readonly TxnRow[], ctx: EmitCtx): Signal[] {
  const p = T.kinds["s4-infrequent"]!.params as {
    max_prior_disclosures: number;
    min_lower_bound_usd: number;
  };
  const rule =
    `a member with ≤${p.max_prior_disclosures} prior disclosures in the corpus reported a ` +
    `purchase with lower bound ≥ $${(p.min_lower_bound_usd / 1000).toFixed(0)}K`;
  // prior-count by filed order — deterministic: sort by filed asc, txnId asc
  const ordered = [...txns].sort((a, b) =>
    a.filed !== b.filed ? (a.filed < b.filed ? -1 : 1) : a.txnId < b.txnId ? -1 : 1,
  );
  const seen = new Map<string, number>();
  const out: Signal[] = [];
  for (const r of ordered) {
    const key = r.bioguide ?? `raw:${r.name}`;
    const prior = seen.get(key) ?? 0;
    if (
      r.side === "purchase" &&
      (lowerBound(r) ?? -1) >= p.min_lower_bound_usd &&
      prior <= p.max_prior_disclosures
    ) {
      out.push(baseSignal("s4-infrequent", r.txnId, rule, r, ctx));
    }
    seen.set(key, prior + 1);
  }
  return out;
}

function computeS6(txns: readonly TxnRow[], ctx: EmitCtx): Signal[] {
  const min = Number(T.kinds["s6-late-large"]!.params.min_lower_bound_usd);
  const rule = `filed past the STOCK Act's 45-day window AND amount lower bound ≥ $${(min / 1000).toFixed(0)}K`;
  return txns
    .filter((r) => r.late === 1 && (lowerBound(r) ?? -1) >= min)
    .map((r) => baseSignal("s6-late-large", r.txnId, rule, r, ctx));
}

/* ---------- the D-1b gate + artifact assembly ---------- */

export interface SignalInputs {
  txns: readonly TxnRow[];
  buildId: string;
  generatedAtDate: string; // YYYY-MM-DD
  generatedAt: string; // display stamp
  /** The PREVIOUS build's published artifact, when the publisher supplies it
      (D-1c/review F1): first-seen carries forward by id, and signals that left
      the window's view get supersession tombstones instead of silent absence.
      null = cold start, stated in the lifecycle note. */
  priorArtifact?: SignalArtifact | null;
  /** S-5 inputs; null → that kind is withheld with `inputs-not-in-build` */
  s5:
    | {
        membershipsByMember: ReadonlyMap<string, CommitteeMembership[]>;
        /** snapshot-wide validity bounds (review F7) */
        windowFrom: string;
        windowTo: string;
        jurisdictionByCommittee: ReadonlyMap<string, readonly string[]>;
        resolveSector: (ticker: string) => SectorResolution;
      }
    | null;
}

function volumePer30d(signals: readonly Signal[], coverageFrom: string, coverageTo: string): number {
  const days = Math.max(
    1,
    Math.round(
      (Date.parse(coverageTo) - Date.parse(coverageFrom)) / 86_400_000,
    ),
  );
  const inWindow = signals.filter((s) => s.occurrence.filedDate >= coverageFrom).length;
  return (inWindow / days) * 30;
}

/** Generalized cooldown (review F2): within one dedupe scope (entity or
    ticker), at most one signal per `days` by filed date. S-3 additionally
    applies its trade-date cooldown inside its own window scan. */
function applyCooldown(signals: Signal[], days: number, dedupeKey: string): Signal[] {
  if (days <= 0) return signals;
  const byScope = new Map<string, Signal[]>();
  for (const sig of signals) {
    // Cooldown scope derives from the DECLARED identity grammar too — but a
    // per-row key ("txnId") would make every signal its own scope and void
    // the cooldown, so cooldown always groups at entity grain.
    const scope =
      dedupeKey === "txnId"
        ? `${sig.kind}:${sig.entities.bioguide ?? ""}:${sig.entities.ticker ?? ""}`
        : `${sig.kind}|${canonicalIdentity(sig, dedupeKey)}`;
    let list = byScope.get(scope);
    if (!list) {
      list = [];
      byScope.set(scope, list);
    }
    list.push(sig);
  }
  const kept: Signal[] = [];
  for (const list of byScope.values()) {
    list.sort((a, b) => (a.occurrence.filedDate < b.occurrence.filedDate ? -1 : 1));
    let until = "";
    for (const sig of list) {
      if (sig.occurrence.filedDate <= until) continue;
      kept.push(sig);
      until = addDaysIso(sig.occurrence.filedDate, days);
    }
  }
  return kept;
}

function historyDays(from: string, to: string): number {
  return Math.max(0, Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000));
}

/** The dedupe-identity grammar (review F4): the DECLARED `dedupe_key` is what
    the gate enforces — a configuration claiming one identity contract while
    the artifact enforces another is exactly the drift D-1b forbids. Unknown
    grammar fails closed (the kind is unshippable, loudly). */
function canonicalIdentity(sig: Signal, key: string): string {
  switch (key) {
    case "txnId":
      // the row identity the compute function used (a txn id, or S-2's
      // member+ticker pair) — one signal per source row
      return rawIdentityOf(sig);
    case "bioguide+ticker":
      return `${sig.entities.bioguide ?? ""}|${sig.entities.ticker ?? ""}`;
    case "ticker+side+windowStart":
      // S-3's cluster identity is exactly this triple
      return rawIdentityOf(sig);
    default:
      throw new Error(`unsupported dedupe_key grammar: ${key} — the gate cannot enforce what it cannot parse`);
  }
}

export function buildSignalArtifact(
  inputs: SignalInputs,
  thresholdsOverride?: ThresholdsShape,
): SignalArtifact {
  const T = thresholdsOverride ?? (SIGNAL_THRESHOLDS as unknown as ThresholdsShape);
  // Constraint 9 at the ENGINE boundary (review F6): rows with impossible
  // trade dates never reach any kind's computation — not only S-3's window.
  const { rows: cleanTxns, excluded: dateAnomaliesExcluded } = excludeDateAnomalies(inputs.txns);
  const retentionDays = T.retention_days;
  const coverageTo = inputs.generatedAtDate;
  const coverageFrom = addDaysIso(coverageTo, -retentionDays);
  const ctx: EmitCtx = {
    buildId: inputs.buildId,
    computedAt: inputs.generatedAt,
    coverageFrom,
    coverageTo,
  };
  const corpusFrom = cleanTxns.length
    ? cleanTxns.reduce((m, t) => (t.filed < m ? t.filed : m), cleanTxns[0]!.filed)
    : coverageTo;

  const computed = new Map<SignalKind, Signal[]>();
  computed.set("s1-large", computeS1(cleanTxns, ctx));
  computed.set("s2-first", computeS2(cleanTxns, ctx, corpusFrom));
  computed.set("s3-cooccurrence", computeS3(cleanTxns, ctx));
  computed.set("s4-infrequent", computeS4(cleanTxns, ctx));
  computed.set("s6-late-large", computeS6(cleanTxns, ctx));

  const withheld: WithheldKind[] = [];
  const signals: Signal[] = [];

  // S-5 needs the B-5+B-6 substrate.
  if (inputs.s5 === null) {
    withheld.push({
      kind: "s5-jurisdiction",
      reason: "inputs-not-in-build",
      detail:
        "committee membership and/or issuer-sector data are not in this build — the jurisdiction join is unanswerable, so the kind is withheld rather than computed from half its inputs",
    });
  } else if (T.kinds["s5-jurisdiction"]!.calibration === null) {
    withheld.push({
      kind: "s5-jurisdiction",
      reason: "uncalibrated",
      detail:
        "no D-1b calibration record exists for this kind — no threshold ships uncalibrated; the backtest must be run and recorded in signal-thresholds.json first",
    });
  } else {
    const rows: Signal[] = [];
    for (const [bioguide, memberships] of inputs.s5.membershipsByMember) {
      const memberTxns = cleanTxns.filter((t) => t.bioguide === bioguide);
      const overlap = jurisdictionOverlap(
        memberTxns,
        {
          memberships,
          windowFrom: inputs.s5.windowFrom,
          windowTo: inputs.s5.windowTo,
        },
        inputs.s5.jurisdictionByCommittee,
        inputs.s5.resolveSector,
      );
      for (const o of overlap.rows) {
        const sig = baseSignal(
          "s5-jurisdiction",
          o.txn.txnId,
          "a disclosed trade in an issuer whose sector falls within a committee the member sat on as of the trade date (versioned mapping; membership dated) — context only: no legal, ethical, or causal conflict is established or implied",
          o.txn,
          ctx,
        );
        rows.push(sig);
      }
    }
    computed.set("s5-jurisdiction", rows);
  }

  for (const [kind, allRaw] of computed) {
    const spec = T.kinds[kind]!;
    if (spec.calibration === null) {
      withheld.push({
        kind,
        reason: "uncalibrated",
        detail: "no D-1b calibration record — withheld until the backtest is recorded",
      });
      continue;
    }
    // Review F2, enforced in ONE gate, every declared field:
    // (1) minimum history — a kind needing a baseline cannot fire on a
    // shallow corpus; withheld with its own typed reason.
    if (spec.min_history_days > 0 && historyDays(corpusFrom, coverageTo) < spec.min_history_days) {
      withheld.push({
        kind,
        reason: "insufficient-history",
        detail: `the corpus spans ${historyDays(corpusFrom, coverageTo)} days but this kind requires ${spec.min_history_days} — a baseline-dependent rule cannot fire without its baseline`,
      });
      continue;
    }
    // (2) declared cooldown over the DECLARED dedupe scope, generalized
    // beyond S-3's internal window scan.
    const cooled = applyCooldown([...allRaw], spec.cooldown_days, spec.dedupe_key);
    // (3) dedupe on the DECLARED identity grammar (review F4) — first
    // occurrence wins deterministically (filed asc, id asc).
    const seenScopes = new Set<string>();
    const all = [...cooled]
      .sort((a, b) =>
        a.occurrence.filedDate !== b.occurrence.filedDate
          ? a.occurrence.filedDate < b.occurrence.filedDate
            ? -1
            : 1
          : a.id < b.id
            ? -1
            : 1,
      )
      .filter((sig) => {
        const scope = `${sig.kind}|${canonicalIdentity(sig, spec.dedupe_key)}`;
        if (seenScopes.has(scope)) return false;
        seenScopes.add(scope);
        return true;
      })
      // Review r3-F5: the surviving row's id is REDERIVED from the declared
      // identity, so it does not depend on WHICH row survived — otherwise
      // dropping one row inside a deduped group would mint a false tombstone
      // and a false first-seen on the next build.
      .map((sig) => {
        sig.id = signalId(sig.kind, canonicalIdentity(sig, spec.dedupe_key));
        return sig;
      });
    const retained = all.filter(
      (s) => s.occurrence.filedDate >= coverageFrom && s.occurrence.filedDate <= coverageTo,
    );
    if (all.length < spec.calibration.volume_bounds.min_total_backtest) {
      withheld.push({
        kind,
        reason: "volume-out-of-bounds",
        detail: `backtest emission ${all.length} is below the calibrated minimum ${spec.calibration.volume_bounds.min_total_backtest} — the threshold no longer matches the data it was calibrated on`,
      });
      continue;
    }
    // (4) volume bounds BY COHORT (chamber), not one blended global rate — a
    // busy cohort must not hide behind a quiet one.
    const cohorts: ("house" | "senate")[] = ["house", "senate"];
    const rates = [
      { name: "all", rate: volumePer30d(retained, coverageFrom, coverageTo) },
      ...cohorts.map((c) => ({
        name: c,
        rate: volumePer30d(retained.filter((s) => s.cohort === c), coverageFrom, coverageTo),
      })),
    ];
    const over = rates.find((r) => r.rate > spec.calibration!.volume_bounds.max_per_30d);
    if (over) {
      withheld.push({
        kind,
        reason: "volume-out-of-bounds",
        detail: `emission rate ${over.rate.toFixed(1)}/30d in cohort '${over.name}' exceeds the calibrated bound ${spec.calibration.volume_bounds.max_per_30d}/30d — firing outside the measured envelope; withheld pending recalibration`,
      });
      continue;
    }
    signals.push(...retained);
  }

  /* --- D-1c lifecycle chaining (review F1) --- */
  const prior = inputs.priorArtifact ?? null;
  if (prior !== null && prior.v === 1) {
    const withheldKinds = new Set(withheld.map((w) => w.kind));
    const currentIds = new Set(signals.map((sig) => sig.id));
    const priorById = new Map(prior.signals.map((sig) => [sig.id, sig]));
    for (const sig of signals) {
      const p = priorById.get(sig.id);
      if (p) sig.firstSeenBuild = p.firstSeenBuild; // continuity, not reset
    }
    for (const p of prior.signals) {
      if (currentIds.has(p.id)) continue;
      if (p.occurrence.filedDate < coverageFrom || p.occurrence.filedDate > coverageTo) continue;
      if (p.status === "superseded") {
        // Review r2-F2: a tombstone is FINAL history — carried verbatim, never
        // re-stamped, or every rebuild would falsify when supersession
        // happened. Compaction (the window filter above) is its only exit.
        signals.push(p);
      } else if (withheldKinds.has(p.kind)) {
        // Review r3-F3: this kind was NOT EVALUATED this build (missing
        // inputs, shallow history, calibration failure). Absence under an
        // unevaluated rule is not a disappearance — recording it as
        // supersession would claim an amendment or retraction that no source
        // performed. An already-unevaluated row keeps its original stamp.
        signals.push(
          p.status === "unevaluated"
            ? p
            : { ...p, status: "unevaluated", unevaluatedInBuild: inputs.buildId, computedAt: inputs.generatedAt },
        );
      } else {
        // The kind WAS evaluated and the signal is absent. For a previously
        // ACTIVE row that is a disappearance; for a previously UNEVALUATED row
        // this is the first build in which the disappearance is observable —
        // either way the tombstone is stamped HERE, truthfully, and any
        // earlier `unevaluatedInBuild` stays as the history it is.
        signals.push({
          ...p,
          status: "superseded",
          supersededInBuild: inputs.buildId,
          computedAt: inputs.generatedAt,
        });
      }
    }
  }

  signals.sort((a, b) =>
    a.occurrence.filedDate !== b.occurrence.filedDate
      ? a.occurrence.filedDate < b.occurrence.filedDate
        ? 1
        : -1
      : a.id < b.id
        ? -1
        : 1,
  );

  return {
    v: 1,
    buildId: inputs.buildId,
    computedAt: inputs.generatedAt,
    thresholdVersion: T.version,
    retentionDays,
    coverageFrom,
    coverageTo,
    lifecycleNote:
      prior !== null
        ? "chained to the prior artifact: first-seen builds carry forward by stable id; signals that left the retained view carry supersession tombstones (status: superseded) naming the build that dropped them."
        : "cold start: no prior artifact was supplied to this build, so first/last-seen name THIS build. Identities are deterministic hashes of (kind, dedupe key) — a consumer holding an older artifact can still chain by id.",
    compaction:
      `signals whose filed date predates the ${retentionDays}-day window are compacted out of ` +
      `the artifact entirely; a device cursor older than coverage_from is a coverage gap the UI must state`,
    dateAnomaliesExcluded,
    signals,
    withheld,
    lagCaveat: LAG_CAVEAT,
  };
}
