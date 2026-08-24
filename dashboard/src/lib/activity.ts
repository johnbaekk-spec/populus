/* RUN M2-8 T13 (plan R13, R16) — the cross-filer ACTIVITY FEED.

   The third directional projection (plan §B). Its grain is one QoQ POSITION
   CHANGE, not a holding: a position composed from several reported rows (a base
   13F-HR plus NEW-HOLDINGS amendments) yields exactly one change record, so the
   feed can neither duplicate a delta nor absorb source rows.

   Three properties this module exists to hold:

   1. ONE byte-aware pagination rule (R13, review r5 F5 / r6 F5). A page closes at
      whichever binds first — PAGE_RECORD_LIMIT records or PAGE_BYTE_LIMIT bytes of
      SERIALIZED output. There is no second page-size rule; `{500, 1000, 2000}` was
      a contradictory alternative and is deleted. Bytes are MEASURED on the JSON
      that is actually emitted (`Buffer.byteLength` of the body string), never
      estimated from a row count. Beyond ACTIVITY_SHARDS_MAX shards the remainder
      is TRUNCATED, and the truncation is stated — in every shard body, in the
      stats fragment, and on the page. Never a silent cut.

   2. Every feed row carries the issuer, `period_of_report`, `filed_date` and the
      elapsed reporting lag. `agg_qoq_deltas` holds none of the display fields or
      filed dates, so `filed_date` is RESOLVED here from `filing_keys[]` through the
      shard's `filings` dictionary (`src/populus/inst_serving.py`), by the plan's
      rule: the MAX filed_date over the current-period composition, ties broken by
      accession ascending. An exit has no current-period holding, so its dates come
      from `current_filing_keys[]` — the composition the security is absent from.
      A composition that cannot be resolved yields NULL and renders as unresolved;
      it is never back-filled from a watermark or another row.

   3. NULL-honest throughout. `delta_value_usd` may legitimately be null (an
      undisclosed value on one side of the comparison). It renders as *undisclosed*,
      never as 0, and sorts LAST — a null is not a small number.

   Wording ban (R16, `docs/build/M2-8-outsized-position-spec.md` §1.1): a 13F is a
   quarter-end snapshot filed up to 45 days late, so at render time the position may
   not exist. No present-tense trading verb may appear on this surface. The ban is
   testable — `BANNED_WORDING` + `scanBannedWording()` — and asserted, not trusted.

   Server-only (node:sqlite, node:fs) — this module never ships to the client. */

import { existsSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { filerLinkHtml, type FilerBudgetState } from "./holdings.ts";
import { fillShardsByBytes, type ShardableItem } from "./shards.ts";
import {
  esc,
  flagTags,
  universalFlags,
  universalFlagNote,
  fmtInt,
  fmtUsd,
  fnMark,
  identityChipHtml,
  note,
  noteBody,
  noteFromHtml,
  intOrNull,
  jsonArrayOf,
  latestFiling,
  reportingLagDays,
  terminusRow,
  COMPACT_ROWS,
  compactDisclosure,
} from "./format.ts";
export { reportingLagDays };

/* ---------- constants MIRRORED from src/populus/inst_budget.py ----------
   These are not independent numbers. `test/activity.test.ts` parses the Python
   module and fails if this mirror drifts, so the producer and the dashboard
   cannot disagree about where a page ends. */

/** Records per shard. Binds when it binds before the byte ceiling. */
export const PAGE_RECORD_LIMIT = 2_000;
/** 2 MiB of SERIALIZED bytes, measured on the emitted body. */
export const PAGE_BYTE_LIMIT = 2 * 1024 * 1024;
/** Hard shard cap. Beyond it the remainder is truncated and stated. */
export const ACTIVITY_SHARDS_MAX = 64;

/** Payload version of an activity shard. */
export const ACTIVITY_SHARD_VERSION = 1;

/** 13F is due 45 days after quarter end — the lag past which a filing is late. */
export const STATUTORY_LAG_DAYS = 45;

/** Rows rendered inline on /institutional. The rest are served from the shards;
    the count and the shard base are stated on the page (G3 never-drop). */
export const FEED_ROWS_ON_PAGE = 50;

/** The total order, verbatim, carried in every shard so a consumer can verify
    the sequence it received rather than trusting it. */
export const ACTIVITY_ORDERING = [
  "abs(delta_value_usd) desc",
  "delta_value_usd null last",
  "cik asc",
  "position_key asc",
  "put_call asc",
  "ssh_prnamt_type asc",
] as const;

/** Tables the serving artifact must expose for this feed. Declared as constants
    because the producer (T7/T8, `src/populus/`) and this consumer are written by
    different hands: if the names diverge the feed degrades to a STATED absence,
    never to a half-populated table. */
export const ACTIVITY_TABLE = "serving_activity";
export const FILINGS_TABLE = "serving_filings";

/* ---------- types ---------- */

export type ChangeKind = "new" | "add" | "trim" | "exit" | "unclassified";

/** One entry of a shard's filing dictionary — mirrors `FilingRef.as_dict()` in
    `src/populus/inst_serving.py`. One per FILING, not per row (R5). */
export interface FilingRef {
  accession: string;
  submission_type: string;
  period_of_report: string;
  filed_date: string;
  doc_url: string | null;
  source: string;
}

/** `String(filing_key) -> FilingRef`. */
export type FilingDictionary = Record<string, FilingRef>;

/** The activity grain as the producer emits it (plan §B). */
export interface ActivityRecord {
  cik: string;
  filer_name: string | null;
  issuer_key: string | null;
  issuer_name: string | null;
  position_key: string;
  put_call: string;
  ssh_prnamt_type: string;
  change_kind: ChangeKind;
  curr_period: string;
  prev_period: string | null;
  prev_value_usd: number | null;
  curr_value_usd: number | null;
  /** May be null — an undisclosed value on either side. Never rendered as 0. */
  delta_value_usd: number | null;
  prev_shares: number | null;
  curr_shares: number | null;
  delta_shares: number | null;
  /** The current-period composition (ordered set, not a scalar). */
  filing_keys: number[];
  /** Exits only: the composition that established the position last period. */
  prior_filing_keys: number[];
  /** Exits only: the current composition the security is ABSENT from. */
  current_filing_keys: number[];
  flags: string[];
}

/** Where a row's `filed_date` came from — stated, so an unresolved date can
    never be mistaken for a resolved one. */
export type FiledDateSource = "current-composition" | "absence-composition" | "unresolved";

/** The emitted row: the producer's record plus the provenance this module
    resolves. Both are shipped — the keys stay for audit, the resolved fields
    stop every consumer from re-implementing the max-filed-date rule. */
export interface ActivityFeedRecord extends ActivityRecord {
  filed_date: string | null;
  filed_accession: string | null;
  filed_from: FiledDateSource;
  reporting_lag_days: number | null;
}

/** The five components of the total order, as applied. */
export interface ActivitySortKey {
  delta_value_usd: number | null;
  abs_delta_value_usd: number | null;
  cik: string;
  position_key: string;
  put_call: string;
  ssh_prnamt_type: string;
}

export interface ActivityTruncation {
  /** How many ordered records did not fit inside ACTIVITY_SHARDS_MAX shards. */
  dropped_records: number;
  /** The sort key of the FIRST DROPPED record — the exact boundary of the cut. */
  boundary_sort_key: ActivitySortKey;
}

export interface ActivityPage {
  page: number;
  records: ActivityFeedRecord[];
  /** Filing-dictionary keys carried by this shard (ascending). */
  filing_keys: number[];
  /** The JSON actually emitted for this shard. */
  body: string;
  /** MEASURED byte length of `body` — not an estimate. */
  bytes: number;
}

export interface ActivityPagination {
  pages: ActivityPage[];
  truncation: ActivityTruncation | null;
  /** Records in the ordered input. */
  total_records: number;
  /** Records actually emitted across the shards. */
  emitted_records: number;
  limits: PaginationLimits;
}

export interface PaginationLimits {
  recordLimit: number;
  byteLimit: number;
  shardLimit: number;
}

export type ActivityAbsenceReason =
  /** the build's manifest declares no inst module */
  | "module-absent"
  /** no serving-artifact path is resolvable in this environment */
  | "serving-artifact-unlocatable"
  /** a path resolved but no file is there */
  | "serving-artifact-missing"
  /** the artifact exists but does not expose the activity grain */
  | "activity-grain-unavailable";

export interface ActivityFeed {
  present: boolean;
  reason: ActivityAbsenceReason | null;
  filings: FilingDictionary;
  pagination: ActivityPagination;
}

/* ---------- the total order (R13 step 1) ---------- */

/** Codepoint comparison — deliberately NOT localeCompare, whose result depends
    on the host's ICU data. Two builds of one corpus must order identically. */
function cmpStr(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * `ABS(delta_value_usd) DESC, cik ASC, position_key ASC, put_call ASC,
 * ssh_prnamt_type ASC`, with NULL deltas ordered LAST.
 *
 * A null delta is an UNDISCLOSED value, not a zero-sized change, so it cannot be
 * ranked against a number. It sorts to the end of the ordered set and keeps its
 * own deterministic order there.
 */
export function compareActivity(a: ActivityRecord, b: ActivityRecord): number {
  const aNull = a.delta_value_usd == null;
  const bNull = b.delta_value_usd == null;
  if (aNull !== bNull) return aNull ? 1 : -1;
  if (!aNull && !bNull) {
    const av = Math.abs(a.delta_value_usd as number);
    const bv = Math.abs(b.delta_value_usd as number);
    if (av !== bv) return av > bv ? -1 : 1;
  }
  return (
    cmpStr(a.cik, b.cik) ||
    cmpStr(a.position_key, b.position_key) ||
    cmpStr(a.put_call, b.put_call) ||
    cmpStr(a.ssh_prnamt_type, b.ssh_prnamt_type)
  );
}

/** Non-mutating sort into the total order. */
export function sortActivity<T extends ActivityRecord>(records: readonly T[]): T[] {
  return [...records].sort(compareActivity);
}

export function sortKeyOf(r: ActivityRecord): ActivitySortKey {
  return {
    delta_value_usd: r.delta_value_usd,
    abs_delta_value_usd: r.delta_value_usd == null ? null : Math.abs(r.delta_value_usd),
    cik: r.cik,
    position_key: r.position_key,
    put_call: r.put_call,
    ssh_prnamt_type: r.ssh_prnamt_type,
  };
}

/* ---------- provenance resolution (R13: issuer + both dates + lag) ---------- */

/** Every filing this row's evidence draws on: the current composition, and for
    an exit also the prior composition that established the position. All of them
    ship in the shard's dictionary — an exit's evidence is incomplete without the
    prior side. */
export function referencedFilingKeys(r: ActivityRecord): number[] {
  const keys = new Set<number>();
  for (const list of [r.filing_keys, r.prior_filing_keys, r.current_filing_keys]) {
    for (const k of list) keys.add(k);
  }
  return [...keys].sort((a, b) => a - b);
}

/**
 * `filed_date` = MAX filed_date over the current-period composition, ties broken
 * by accession ascending (the same tie-break the rest of the codebase uses).
 *
 * An exit resolves against `current_filing_keys[]` — the composition in which the
 * security does NOT appear — because that is the filing set whose absence is the
 * evidence. No cross-fallback between the two compositions: mixing them would put
 * a date on a row that the cited documents do not support.
 */
export function resolveFiledDate(
  r: ActivityRecord,
  filings: FilingDictionary,
): { filed_date: string | null; filed_accession: string | null; filed_from: FiledDateSource } {
  const exit = r.change_kind === "exit";
  const keys = exit ? r.current_filing_keys : r.filing_keys;
  // ONE filed-date rule (format.latestFiling), shared with the filer page. This
  // loop used `ref.accession < best.accession` — the OPPOSITE direction from
  // `holdings.provenanceOf`, under a comment claiming the same rule — so on two
  // same-day amendments the feed and the filer page cited different documents
  // for the same composition.
  const candidates: FilingRef[] = [];
  for (const k of keys) {
    const ref = filings[String(k)];
    if (ref) candidates.push(ref);
  }
  const best = latestFiling(candidates);
  if (best === null) {
    return { filed_date: null, filed_accession: null, filed_from: "unresolved" };
  }
  return {
    filed_date: best.filed_date,
    filed_accession: best.accession,
    filed_from: exit ? "absence-composition" : "current-composition",
  };
}


/** Attach resolved provenance to a producer record. */
export function resolveActivityRecord(
  r: ActivityRecord,
  filings: FilingDictionary,
): ActivityFeedRecord {
  const resolved = resolveFiledDate(r, filings);
  return {
    ...r,
    filed_date: resolved.filed_date,
    filed_accession: resolved.filed_accession,
    filed_from: resolved.filed_from,
    reporting_lag_days: reportingLagDays(r.curr_period, resolved.filed_date),
  };
}

/* ---------- serialization (the bytes the byte rule measures) ---------- */

/** Fixed key order: two builds of one corpus must produce byte-identical shards. */
export function serializeFeedRecord(r: ActivityFeedRecord): string {
  return JSON.stringify({
    cik: r.cik,
    filer_name: r.filer_name,
    issuer_key: r.issuer_key,
    issuer_name: r.issuer_name,
    position_key: r.position_key,
    put_call: r.put_call,
    ssh_prnamt_type: r.ssh_prnamt_type,
    change_kind: r.change_kind,
    period_of_report: r.curr_period,
    prev_period: r.prev_period,
    filed_date: r.filed_date,
    filed_accession: r.filed_accession,
    filed_from: r.filed_from,
    reporting_lag_days: r.reporting_lag_days,
    prev_value_usd: r.prev_value_usd,
    curr_value_usd: r.curr_value_usd,
    delta_value_usd: r.delta_value_usd,
    prev_shares: r.prev_shares,
    curr_shares: r.curr_shares,
    delta_shares: r.delta_shares,
    filing_keys: r.filing_keys,
    prior_filing_keys: r.prior_filing_keys,
    current_filing_keys: r.current_filing_keys,
    flags: r.flags,
  });
}

function serializeFilingEntry(key: number, ref: FilingRef): string {
  return (
    JSON.stringify(String(key)) +
    ":" +
    JSON.stringify({
      accession: ref.accession,
      submission_type: ref.submission_type,
      period_of_report: ref.period_of_report,
      filed_date: ref.filed_date,
      doc_url: ref.doc_url,
      source: ref.source,
    })
  );
}

interface PageMeta {
  page: number;
  page_count: number;
  record_count: number;
  total_records: number;
  emitted_records: number;
  truncated: boolean;
  truncation: ActivityTruncation | null;
  /** The named absence when there is nothing to serve — a client must never
      have to infer "empty" from a zero count. */
  absent: ActivityAbsenceReason | null;
}

/** The emitted shard body. Written as an explicit concatenation, not an object
    literal, because the byte rule accounts for it term by term: the overhead is
    this template with empty collections, and every entry costs exactly its own
    serialized bytes plus one separator. */
function serializePageBody(meta: PageMeta, filingEntries: string[], recordJsons: string[]): string {
  return (
    `{"version":${ACTIVITY_SHARD_VERSION}` +
    `,"page":${meta.page}` +
    `,"page_count":${meta.page_count}` +
    `,"record_count":${meta.record_count}` +
    `,"total_records":${meta.total_records}` +
    `,"emitted_records":${meta.emitted_records}` +
    `,"truncated":${meta.truncated ? "true" : "false"}` +
    `,"truncation":${meta.truncation === null ? "null" : JSON.stringify(meta.truncation)}` +
    `,"absent":${meta.absent === null ? "null" : JSON.stringify(meta.absent)}` +
    `,"ordering":${JSON.stringify(ACTIVITY_ORDERING)}` +
    `,"filings":{${filingEntries.join(",")}}` +
    `,"records":[${recordJsons.join(",")}]}`
  );
}

/* ---------- pagination: ONE byte-aware rule (R13) ---------- */

export interface ActivityPaginateOptions extends Partial<PaginationLimits> {
  /** Stated in every shard body when the projection is absent. */
  absent?: ActivityAbsenceReason | null;
}

function limitsOf(opts: ActivityPaginateOptions | undefined): PaginationLimits {
  return {
    recordLimit: opts?.recordLimit ?? PAGE_RECORD_LIMIT,
    byteLimit: opts?.byteLimit ?? PAGE_BYTE_LIMIT,
    shardLimit: opts?.shardLimit ?? ACTIVITY_SHARDS_MAX,
  };
}

/**
 * The envelope is RESERVED at its worst case before any record is placed.
 *
 * The final envelope carries `page_count`, `truncated` and the truncation object,
 * none of which are known while the pages are being filled. Reserving an upper
 * bound — the widest sort key in the corpus, the largest counts, and `false`
 * (which is one byte longer than `true`) — makes the emitted body provably no
 * larger than the projection, so the measured length can only come in UNDER the
 * ceiling. A combination that cannot occur in reality is exactly what an upper
 * bound is for.
 */
function reservedOverhead(
  records: readonly ActivityRecord[],
  limits: PaginationLimits,
  absent: ActivityAbsenceReason | null,
): number {
  let widest: ActivitySortKey = {
    delta_value_usd: null,
    abs_delta_value_usd: null,
    cik: "",
    position_key: "",
    put_call: "",
    ssh_prnamt_type: "",
  };
  let widestBytes = Buffer.byteLength(JSON.stringify(widest));
  for (const r of records) {
    const key = sortKeyOf(r);
    const bytes = Buffer.byteLength(JSON.stringify(key));
    if (bytes > widestBytes) {
      widest = key;
      widestBytes = bytes;
    }
  }
  const meta: PageMeta = {
    page: Math.max(0, limits.shardLimit - 1),
    page_count: limits.shardLimit,
    record_count: limits.recordLimit,
    total_records: records.length,
    emitted_records: records.length,
    truncated: false, // "false" is longer than "true" — the upper bound
    truncation: { dropped_records: records.length, boundary_sort_key: widest },
    absent, // identical in the reservation and in the emitted body
  };
  return Buffer.byteLength(serializePageBody(meta, [], []));
}

interface FilledPage {
  records: ActivityFeedRecord[];
  recordJsons: string[];
  filingKeys: number[];
  projectedBytes: number;
}

/**
 * Fill ordered records into shards. A page closes when the NEXT record would
 * carry it past the byte ceiling, or when the record limit is reached —
 * whichever binds first.
 *
 * There is no no-candidate case (plan R13 step 4): a page always accepts its
 * first record, so a single record larger than the whole ceiling occupies its own
 * page rather than blocking the walk. That is asserted in the tests, not assumed.
 *
 * RUN M2-11 (plan R22): the fill algorithm itself now lives in `lib/shards.ts`
 * — ONE byte-bounded rule shared with the filer shard family. This wrapper
 * keeps activity's observable behaviour bit-for-bit: truncate-and-state past
 * the shard cap, and an over-ceiling record owns its page. The filer family
 * configures the SAME core to fail instead (LD-10).
 */
function fillPages(
  ordered: ActivityFeedRecord[],
  filings: FilingDictionary,
  limits: PaginationLimits,
  overhead: number,
): { pages: FilledPage[]; dropped: ActivityFeedRecord[] } {
  const items: ShardableItem[] = ordered.map((record, index) => ({
    key: String(index),
    json: serializeFeedRecord(record),
    // An unresolvable key is a provenance GAP, recorded on the row as an
    // unresolved filed date — it is not a reason to drop the row (G3).
    deps: referencedFilingKeys(record).flatMap((k) => {
      const ref = filings[String(k)];
      return ref ? [{ key: String(k), serialized: serializeFilingEntry(k, ref) }] : [];
    }),
  }));
  const { shards } = fillShardsByBytes(
    items,
    {
      ceilingBytes: limits.byteLimit,
      overheadBytes: overhead,
      itemLimit: limits.recordLimit,
      shardLimit: limits.shardLimit,
    },
    { onOverflow: "truncate", onOversizedItem: "own-shard", itemNoun: "activity record" },
  );
  let offset = 0;
  const pages: FilledPage[] = shards.map((shard) => {
    const count = shard.itemKeys.length;
    const page: FilledPage = {
      records: ordered.slice(offset, offset + count),
      recordJsons: shard.itemJsons,
      filingKeys: shard.depKeys.map(Number).sort((a, b) => a - b),
      projectedBytes: shard.projectedBytes,
    };
    offset += count;
    return page;
  });
  return { pages, dropped: ordered.slice(offset) };
}

/**
 * Order → resolve provenance → paginate → state any truncation.
 *
 * Always returns at least one page: with no records that page says so, which is
 * an answer. A 404 would not be.
 */
export function paginateActivity(
  records: readonly ActivityRecord[],
  filings: FilingDictionary,
  opts?: ActivityPaginateOptions,
): ActivityPagination {
  const limits = limitsOf(opts);
  const absent = opts?.absent ?? null;
  const ordered = sortActivity(records).map((r) => resolveActivityRecord(r, filings));
  const overhead = reservedOverhead(ordered, limits, absent);
  const { pages, dropped } = fillPages(ordered, filings, limits, overhead);
  if (pages.length === 0) {
    pages.push({ records: [], recordJsons: [], filingKeys: [], projectedBytes: overhead });
  }

  const truncation: ActivityTruncation | null =
    dropped.length > 0
      ? { dropped_records: dropped.length, boundary_sort_key: sortKeyOf(dropped[0]!) }
      : null;
  const emitted = pages.reduce((n, p) => n + p.records.length, 0);

  const out: ActivityPage[] = pages.map((p, index) => {
    const meta: PageMeta = {
      page: index,
      page_count: pages.length,
      record_count: p.records.length,
      total_records: ordered.length,
      emitted_records: emitted,
      truncated: truncation !== null,
      truncation,
      absent,
    };
    const entries = p.filingKeys.map((k) => serializeFilingEntry(k, filings[String(k)]!));
    const body = serializePageBody(meta, entries, p.recordJsons);
    const bytes = Buffer.byteLength(body);
    if (bytes > limits.byteLimit && p.records.length > 1) {
      // Unreachable by construction (the reservation is an upper bound). Fail
      // closed rather than publish a shard over the ceiling.
      throw new Error(
        `activity shard ${index} measured ${bytes} bytes, over the ${limits.byteLimit}-byte ceiling`,
      );
    }
    return { page: index, records: p.records, filing_keys: p.filingKeys, body, bytes };
  });

  return {
    pages: out,
    truncation,
    total_records: ordered.length,
    emitted_records: emitted,
    limits,
  };
}

/**
 * The fragment the producer copies into `stats.json` (plan R13 step 3). The
 * dropped count and the boundary sort key are published data, not a log line —
 * a reader must be able to see exactly where the cut fell.
 */
export function activityStatsFragment(p: ActivityPagination): Record<string, unknown> {
  return {
    activity_shards: p.pages.length,
    activity_shards_max: p.limits.shardLimit,
    activity_records_total: p.total_records,
    activity_records_emitted: p.emitted_records,
    activity_max_shard_bytes: p.pages.reduce((m, page) => Math.max(m, page.bytes), 0),
    activity_page_byte_limit: p.limits.byteLimit,
    activity_page_record_limit: p.limits.recordLimit,
    activity_truncated: p.truncation !== null,
    activity_dropped_records: p.truncation?.dropped_records ?? 0,
    activity_boundary_sort_key: p.truncation?.boundary_sort_key ?? null,
  };
}

/* ---------- R16: the wording ban, testable ---------- */

/**
 * Banned on this surface (`M2-8-outsized-position-spec.md` §1.1). A 13F is a
 * quarter-end snapshot filed up to 45 days late; at render time the position may
 * not exist, so any present-tense trading verb asserts something the document
 * cannot support. The past-tense claims are banned for the same reason — the
 * filing records a position, never a transaction.
 */
export const BANNED_WORDING: readonly { readonly label: string; readonly pattern: RegExp }[] = [
  { label: "bet", pattern: /\bbets?\b/i },
  { label: "conviction", pattern: /\b(?:high-)?conviction\b/i },
  { label: "high-conviction", pattern: /\bhigh-conviction\b/i },
  { label: "bullish", pattern: /\bbullish\b/i },
  { label: "bearish", pattern: /\bbearish\b/i },
  { label: "loading up", pattern: /\bloading up\b/i },
  { label: "piling in", pattern: /\bpiling in\b/i },
  { label: "doubling down", pattern: /\bdoubling down\b/i },
  // The EDITORIALISING family (spec §1.1). These were the five terms missing
  // while the guard asserted `BANNED_WORDING.length >= 10` — which passed at
  // exactly 10 while its message claimed the list was complete. They are the
  // ones that would appear in precisely the headline the ban exists to prevent:
  // "Berkshire backs Apple", "the fund likes it".
  { label: "backs", pattern: /\bbacks\b/i },
  { label: "favors", pattern: /\bfavou?rs?\b/i },
  // `likes`, NOT `like`: the banned term is the third-person verb ("the fund
  // likes it"). "looks like" is a simile in live copy and is not a claim about
  // anyone's intent.
  { label: "likes", pattern: /\blikes\b/i },
  // Present-tense `buying` in any construction, not only "is/are buying".
  { label: "buying", pattern: /\bbuying\b/i },
  { label: "is buying", pattern: /\b(?:is|are)\s+buying\b/i },
  { label: "just bought", pattern: /\bjust bought\b/i },
  { label: "sold", pattern: /\bsold\b/i },
  // `move` AS A VERB — a filer moving into or out of a position. Deliberately
  // NOT a bare /\bmoves?\b/: "QoQ moves" is live, honest, descriptive copy in
  // three places (it names position changes, not intent), and banning the noun
  // would delete accurate labelling in order to enforce a rule about verbs.
  { label: "move (as a verb)", pattern: /\bmoved?s?\s+(?:in|into|out\s+of|on)\b/i },
];

/** Text a reader or a screen reader actually receives: element text plus the
    attribute channels that are spoken (`title`, `aria-label`, `alt`). */
function visibleTextOf(html: string): string {
  const attrs: string[] = [];
  const re = /(?:title|aria-label|alt)="([^"]*)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) attrs.push(m[1]!);
  return html.replace(/<[^>]*>/g, " ") + " " + attrs.join(" ");
}

/** The banned labels present in `html`. Empty is the only passing result. */
export function scanBannedWording(html: string): string[] {
  const text = visibleTextOf(html);
  return BANNED_WORDING.filter((b) => b.pattern.test(text)).map((b) => b.label);
}

/* ---------- R16: the §5 data_note, non-removable ---------- */

/* Still ONE canonical copy. RUN M2-11 (plan R22): the clauses and the markup
   moved to `lib/holdings.ts` — which is browser-safe — because the `/e/`
   driver's in-extract filer path renders the note on the client, and this
   module's `node:sqlite`/`node:fs` imports cannot ship in the browser bundle.
   Re-exported here so every existing import site (the component, the tests,
   the pages) keeps reading it from this module unchanged. */
export { INSTITUTIONAL_DATA_NOTE_CLAUSES, institutionalDataNoteHtml } from "./holdings.ts";
import { institutionalDataNoteHtml } from "./holdings.ts";

/* ---------- rendering ---------- */

const CHANGE_LABEL: Record<ChangeKind, { chip: string; cls: string; spoken: string }> = {
  new: { chip: "new", cls: "qoq-new", spoken: "newly reported this quarter" },
  add: { chip: "add", cls: "qoq-add", spoken: "reported larger than last quarter" },
  trim: { chip: "trim", cls: "qoq-trim", spoken: "reported smaller than last quarter" },
  exit: { chip: "exit", cls: "qoq-exit", spoken: "no longer reported this quarter" },
  unclassified: { chip: "n/c", cls: "qoq-nc", spoken: "not classifiable from the filings" },
};

/** Δ value cell. A null delta is UNDISCLOSED, never 0 and never an em-dash that
    could read as "nothing changed". */
function deltaCell(r: ActivityFeedRecord): string {
  if (r.delta_value_usd == null) {
    return (
      `<span class="nc-chip">undisclosed</span>` +
      `<span class="visually-hidden"> — value undisclosed on at least one side of the comparison;` +
      ` this is not zero</span>`
    );
  }
  const sign = r.delta_value_usd > 0 ? "+" : "";
  return `${esc(sign)}${esc(fmtUsd(r.delta_value_usd))}`;
}

/** Elapsed reporting lag, named honestly at both ends: past the 45-day deadline
    is LATE; a filing dated before quarter end is an anomaly, not a negative lag
    printed as if it were normal. */
function lagCell(r: ActivityFeedRecord): string {
  const lag = r.reporting_lag_days;
  /* SL-R8 Class B / SL-R8e / SL-R26. The key is the repository's OWN declared
     row identity (`ActivitySortKey`), which `lagCell` already receives whole —
     that is why these two are Class B rather than Class C, and why no
     signature changes. `position_key` alone is insufficient:
     `activity.test.ts:172` holds same-CIK, same-`position_key` rows separated
     only by PUT/CALL, so a bare key would emit duplicate panel ids. */
  const nctx = { scope: "activity-lag" };
  const rowKey = `${r.cik}-${r.position_key}-${r.put_call}-${r.ssh_prnamt_type}`;
  if (lag == null) {
    /* SL-R8e: this was nearly a §7 violation. The attribute carried the CAUSE
       ("not resolvable from this build's filing dictionary") while the
       `.visually-hidden` sibling carries only the EFFECT ("reporting lag not
       resolvable"). Deleting it as a Class-A duplicate would have removed the
       filing-dictionary explanation with no replacement channel while the
       exact inventory gate passed green. The cause moves into the note; the
       sibling is preserved BYTE-IDENTICAL below. */
    return (
      `<span class="lag">—<span class="visually-hidden"> reporting lag not resolvable</span></span>` +
      note("filed date not resolvable from this build's filing dictionary", nctx, `${rowKey}-lagcause`)
    );
  }
  if (lag < 0) {
    return (
      `<span class="lag lag-anomaly">filed ${esc(String(Math.abs(lag)))}d before quarter end</span>` +
      note("filed before the quarter it reports ended", nctx, `${rowKey}-laganomaly`)
    );
  }
  if (lag > STATUTORY_LAG_DAYS) {
    return `<span class="lag-late">LATE·${esc(String(lag))}d</span><span class="visually-hidden"> — filed ${esc(
      String(lag),
    )} days after quarter end, past the 45-day deadline</span>`;
  }
  return `<span class="lag">+${esc(String(lag))}d<span class="visually-hidden"> after quarter end</span></span>`;
}

/* SL-R17. Every row printed its raw 32-character `position_key`
   (`sid:sec:prov:00076fbdb7a2ddaf78c0e89001ecf4f7`) as visible text beside the
   issuer name — machine spill a reader cannot act on. It becomes a chip that
   says what the key is, with the key itself in the chip's note and in
   `data-identity-key`, so it stays readable and copyable.

   The note key is the FULL activity composite, never the bare `position_key`:
   `activity.test.ts:172` holds same-CIK, same-`position_key` rows separated
   only by PUT/CALL, so a bare key would emit duplicate panel ids and ambiguous
   `aria-describedby` targets (SL-R26). */
function issuerCell(r: ActivityFeedRecord): string {
  const chip = identityChipHtml(
    r.position_key,
    { scope: "activity-identity" },
    `${r.cik}-${r.position_key}-${r.put_call}-${r.ssh_prnamt_type}-identity`,
  );
  if (r.issuer_name && r.issuer_name.trim() !== "") {
    /* filed verbatim off the 13F — see `filed-name` in holdings.ts */
    return `<span class="filed-name">${esc(r.issuer_name)}</span>${chip}`;
  }
  return `<span class="none">issuer not identified in this build</span>${chip}`;
}

function filedCell(r: ActivityFeedRecord): string {
  if (r.filed_date == null) {
    return `<span class="none">not resolvable<span class="visually-hidden"> — this row's filing composition is not in this build's filing dictionary</span></span>`;
  }
  const source =
    r.filed_from === "absence-composition"
      ? "the current-period composition this security is absent from"
      : "the current-period composition";
  return (
    `<span class="mono-id">${esc(r.filed_date)}</span>` +
    `<span class="visually-hidden"> — latest filed date over ${esc(source)}${
      r.filed_accession ? `, accession ${esc(r.filed_accession)}` : ""
    }</span>`
  );
}

export function activityRowHtml(
  r: ActivityFeedRecord,
  tier: FilerBudgetState = "tail",
  stated: readonly string[] = [],
): string {
  const label = CHANGE_LABEL[r.change_kind] ?? CHANGE_LABEL.unclassified;
  const filerName = r.filer_name && r.filer_name.trim() !== "" ? r.filer_name : `CIK ${r.cik}`;
  return (
    `<tr>` +
    // ONE filer-link rule (holdings.filerLinkHtml), which routes through the
    // ONE href primitive (R22): the caller supplies the top/tail budget state;
    // the default is tail — the reachable direction, never a dressed 404.
    // R10: ISSUER FIRST. The feed answers "what is being accumulated", so the
    // issuer is the anchor and the manager is the qualifier. Ordering and the
    // change-kind filters are untouched — only the reading order changed.
    `<td class="c-issuer">${issuerCell(r)}</td>` +
    `<td class="c-filer c-secondary">${filerLinkHtml(r.cik, filerName, tier)}</td>` +
    `<td><span class="qoq-chip ${esc(label.cls)}">${esc(label.chip)}</span>` +
    `<span class="visually-hidden"> ${esc(label.spoken)}</span>` +
    `${fnMark("§")}</td>` +
    `<td class="c-num">${deltaCell(r)}</td>` +
    `<td class="c-num mono-id">${esc(r.curr_period)}</td>` +
    `<td class="c-num">${filedCell(r)}</td>` +
    `<td class="c-num">${lagCell(r)}</td>` +
    `<td class="c-flags">${flagTags(r.flags, undefined, { stated })}</td>` +
    `</tr>`
  );
}

/** The truncation statement (R13 step 3). Stated on the page, in the reader's
    words, with the boundary the cut fell on — never a silent cut. */
export function truncationNoticeHtml(t: ActivityTruncation | null, shards: number): string {
  if (t === null) return "";
  const k = t.boundary_sort_key;
  const boundary =
    k.abs_delta_value_usd == null
      ? "an undisclosed delta"
      : `a reported change of ${esc(fmtUsd(k.abs_delta_value_usd))} in absolute value`;
  return terminusRow({
    author: "populus",
    html:
      `The ordered set does not fit in this build's ${fmtInt(shards)}-shard budget: ` +
      `<strong>${fmtInt(t.dropped_records)}</strong> further records are not published here. ` +
      /* CODE-REVIEW F7: the boundary's `position_key` may be a provisional
         `sid:sec:prov:<hash>`, and this prose is VISIBLE on /institutional/ —
         so printing it raw violates SL-R17 and success criterion 4 on a surface
         this run owns. The publication bound is the honesty content here and it
         is unchanged; only the identity's CHANNEL moves. The readable chip
         states how strong the identity is, its note carries the exact key, and
         the raw value stays machine-reachable in a `data-` attribute — the same
         treatment R17 applies everywhere else a weak key surfaces. */
      `The cut falls at ${boundary} — filer CIK ${esc(k.cik)}, position ` +
      `${identityChipHtml(k.position_key, { scope: "activity-cut" }, "boundary")}, ` +
      `${esc(k.put_call)} · ${esc(k.ssh_prnamt_type)}. Everything below that boundary is absent ` +
      `from these shards and remains in the filings on EDGAR.`,
  });
}

const ACTIVITY_FOOTNOTES = [
  {
    mark: "§",
    html:
      `Labels describe what the DOCUMENTS say between two quarter-end snapshots, not trading` +
      ` activity: <strong>new</strong> = first reported this quarter · <strong>add</strong> =` +
      ` reported larger than last quarter · <strong>trim</strong> = reported smaller ·` +
      ` <strong>exit</strong> = absent from this quarter's composition (disposed, delisted, under` +
      ` confidential treatment, or reported instead by an affiliated manager — the filing does not` +
      ` say which) · <strong>n/c</strong> = not classifiable from the filings`,
  },
  {
    mark: "‡",
    html:
      `Δ value is the difference between two quarter-end reported values; where either side is` +
      ` undisclosed the delta is <em>undisclosed</em> and sorts last — it is never zero`,
  },
  {
    mark: "†",
    html:
      `Filed date is the latest filing date over the position's current-period composition (a base` +
      ` 13F-HR plus any NEW-HOLDINGS amendments); the lag is that date minus the quarter end, and` +
      ` a lag over 45 days is past the statutory deadline`,
  },
];

const ACTIVITY_FN = new Map(ACTIVITY_FOOTNOTES.map((e) => [e.mark, e.html]));

/** SL-R7b: the activity table's column descriptors — key, label, and the
    stated non-sortability reason that used to render as visible `.col-why`. */
const ACTIVITY_COLS: readonly (readonly [string, string, string])[] = [
  ["issuer-position", "Issuer · position", "this view is the largest reported changes, cut at a shard bound — re-ordering the slice by issuer would present a partial list as a complete one"],
  ["filer", "Filer", "same bound: the managers leading a filer ordering may be in shards this page never loaded. The manager directory below sorts its complete set"],
  ["change", "Change ·§", "change kind is a category, not an order — the filters above select one"],
  ["delta-value", "Δ value ·‡", "the rows are ALREADY ordered by absolute reported change; that is the ordering this slice was cut on"],
  ["quarter-ended", "Quarter ended", "every row here shares the reporting period the feed was built for"],
  ["filed", "Filed ·†", "a filed-date ordering over a value-cut slice would rank the wrong rows first"],
  ["lag", "Lag", "as above — lag orders the slice, not the corpus"],
  ["flags", "Flags", "flags are a set per row, with no order over them"],
];

/** SL-R7c: mark → column, read off the emitter. */
const ACTIVITY_COL_FN: Record<string, string | undefined> = {
  change: ACTIVITY_FN.get("§"),
  "delta-value": ACTIVITY_FN.get("‡"),
  filed: ACTIVITY_FN.get("†"),
};

export interface ActivityFeedOptions {
  /** Rows rendered inline; the remainder is served from the shards. */
  rowLimit?: number;
  /** Same-origin shard base, stated on the page so the full set is reachable. */
  shardBase?: string;
  /** R22: top/tail budget state per filer CIK, from the LD-7 selection. Rows
      render tail links when omitted — reachable through /e/, never a 404. */
  tierOf?: (cik: string) => FilerBudgetState;
}

/** The absent state: stated, never simulated. */
export function activityAbsentHtml(reason: ActivityAbsenceReason): string {
  const detail: Record<ActivityAbsenceReason, string> = {
    "module-absent":
      "This build does not include the institutional module, so there is no activity to order.",
    "serving-artifact-unlocatable":
      "No serving artifact is addressable in this environment, so the feed holds back rather than" +
      " rendering a partial ordering.",
    "serving-artifact-missing":
      "This build declares the institutional module, but its serving artifact is not present here," +
      " so no ordering can be published.",
    "activity-grain-unavailable":
      // The catch-all reason: this is reached from ANY read failure — a missing
      // activity table, but equally a corrupt file, SQLITE_BUSY, or a
      // permissions error. It used to end "Per-filer and per-issuer surfaces are
      // unaffected", which the code cannot support: those surfaces read the SAME
      // artifact, so whatever broke this read may well have broken them. Stating
      // an unknown as an unknown is the whole point of this block.
      "This build's serving artifact could not supply the activity projection, so the ordered" +
      " feed cannot be built from it. Whether the per-filer and per-issuer surfaces are affected" +
      " depends on the cause, which is not knowable from here — check them directly.",
  };
  return (
    `<section class="panel panel-wide" aria-label="Cross-filer activity">` +
    `<div class="panel-head"><h2 class="section-h">Largest reported quarter-over-quarter changes</h2></div>` +
    `<div class="absent-block">` +
    `<h3 class="absent-h">The activity feed is not in this build.</h3>` +
    `<p>${esc(detail[reason])} Absence is stated here instead of simulated.</p>` +
    `</div></section>`
  );
}

/** The feed section: ordered rows, the byte/shard budget in words, the truncation
    statement when there is one, and the footnotes every marker resolves to. */
export function activityFeedHtml(feed: ActivityFeed, opts: ActivityFeedOptions = {}): string {
  if (!feed.present) return activityAbsentHtml(feed.reason ?? "activity-grain-unavailable");

  const rowLimit = opts.rowLimit ?? FEED_ROWS_ON_PAGE;
  const shardBase = opts.shardBase ?? "/institutional/data/activity";
  const first = feed.pagination.pages[0];
  const rows = (first?.records ?? []).slice(0, rowLimit);
  const total = feed.pagination.total_records;
  const emitted = feed.pagination.emitted_records;

  if (total === 0) {
    return (
      `<section class="panel panel-wide" aria-label="Cross-filer activity">` +
      `<div class="panel-head"><h2 class="section-h">Largest reported quarter-over-quarter changes</h2></div>` +
      `<p class="section-note">No quarter-over-quarter change records land in this build — either` +
      ` one period only, or nothing keyable on both sides. That is the state of the data, not a` +
      ` rendering failure.</p></section>`
    );
  }

  /* R10 #12: activity is the SIXTH flag-bearing renderer, and the one the
     whole-dist gate failed to name because that gate exempted a whole PAGE once
     any table on it carried a caveat. Over the rows this table actually shows —
     it renders `first.records` sliced to `rowLimit` and does not page. */
  const statedActivity = universalFlags(rows.map((r) => r.flags));
  /* R7/F2: compact by default AND expandable in place.

     Every row this section holds is rendered into the DOM; the rows past the
     compact slice carry `data-compact-extra` and are hidden by the CSS the
     disclosure toggles. That is the one case where hiding is right: these are
     DATA ROWS, which R19 explicitly permits a collapsed table to omit — and
     unlike the earlier server-side slice, the reader can actually get them
     back. Slicing them away with no client owner made them unreachable, which
     is the opposite of a disclosure. */
  const body = rows
    .map((r, i) => {
      const html = activityRowHtml(r, opts.tierOf?.(r.cik) ?? "tail", statedActivity);
      return i < COMPACT_ROWS ? html : html.replace("<tr", "<tr data-compact-extra");
    })
    .join("\n");
  /* F2: the COLLAPSED STATE IS SERVER-RENDERED.

     `data-collapsed` used to be set by `initDomDisclosures`, so the emitted
     page showed every shard row visibly and only became compact once
     JavaScript ran. That is not "compact by default" — it is compact once
     scripted, and the initial and no-JavaScript page was the one view of this
     table that ignored the amended R7 entirely.

     The attribute is now part of the SSR bytes, under the same condition the
     island would have used, so the first paint and the scripted state agree.
     The island still sets it, idempotently, because an island that depends on
     the server having done it is an island with a second precondition.

     The no-JavaScript reader keeps a route to the remainder: the terminus
     below LINKS the first shard rather than only naming the path. */
  const collapsed = rows.length > COMPACT_ROWS;
  const firstShard = `${shardBase}/${feed.pagination.pages[0]?.page ?? 0}.v1.json`;
  return (
    `<section class="panel panel-wide" aria-label="Cross-filer activity">` +
    `<div class="panel-head"><h2 class="section-h">Largest reported quarter-over-quarter changes, by issuer</h2>` +
    `<span class="panel-note">ordered by absolute reported change · undisclosed deltas last</span></div>` +
    universalFlagNote(statedActivity) +
    `<div class="table-scroll"><table class="etable" data-sticky-first data-stated-flags="${esc(statedActivity.join(","))}">` +
    `<caption class="visually-hidden">Quarter-over-quarter position changes by issuer, ordered by absolute reported change</caption>` +
    /* F23: every column states WHY it is not sortable, in visible text.

       This table is a BOUNDED SLICE of an ordered set — the largest reported
       changes, cut at a shard limit. Re-sorting the slice client-side would
       reorder the top-N-by-value BY SOME OTHER KEY and present the result as
       the top N by that key, which it is not: the rows that would actually
       lead a filed-date or lag ordering are in shards this page never loaded.
       That is not a missing feature, it is an ordering the data on this page
       cannot support, so the reason is printed rather than a control offered.

       The two surfaces that DO sort — the congress rankings and the manager
       directory — hold their complete row set, which is exactly what makes
       sorting honest there. */
    /* SL-R5/R7: this mapper is the fourth `.col-why` site — the plan's inventory
       said three. Each column's stated reason becomes its note, and the three
       marks `#activity-footnotes` published join the columns that emit them:
       § on the change chip (`activityRowHtml`), ‡ on Δ value, † on Filed.
       R7b's descriptor rule applies: the `<thead>` is a literal with no sort
       key, so the keys are supplied here rather than invented at render time. */
    `<thead><tr>` +
    ACTIVITY_COLS.map(([key, label, why]) => {
      const body = noteBody(why, ACTIVITY_COL_FN[key]);
      return (
        `<th scope="col">${esc(label)}` +
        (body ? noteFromHtml(body, { scope: "inst-activity" }, key) : "") +
        `</th>`
      );
    }).join("") +
    `</tr></thead>` +
    // R18/F4: the LOCKED render root. It was an anonymous <tbody>, which meant
    // no sort or expansion could be scoped to it and no root-integrity test
    // could enforce single ownership.
    `<tbody id="inst-activity-tbody"${collapsed ? ' data-collapsed="true"' : ""}>${body}</tbody></table></div>` +

    /* F2: this sentence now states BOTH bounds, because there are two and the
       reader is inside the tighter one. The compact slice is a render bound
       this page applies; the shard budget is a publication bound the build
       applies. Naming only the second while silently applying the first is the
       unstated omission R14 forbids. The shard is a LINK, not a path in a
       code span: with scripting off the expand control cannot appear, so the
       link is the only route to the rows below the slice. */
    terminusRow({
      author: "populus",
      html:
        (collapsed
          ? `Showing the first ${fmtInt(COMPACT_ROWS)} of the ${fmtInt(rows.length)} rows` +
            ` rendered here — a Public Filings render bound, lifted by the control below or by` +
            ` reading <a href="${esc(firstShard)}">the published shard</a> directly. `
          : `Showing the ${fmtInt(rows.length)} largest change records rendered here. `) +
        `Those are the largest of ${fmtInt(emitted)} ordered change records` +
        ` published in this build${
          emitted === total ? "" : ` (of ${fmtInt(total)} in the ordered set)`
        }. The complete ordered set is served as ${fmtInt(feed.pagination.pages.length)} same-origin shard${
          feed.pagination.pages.length === 1 ? "" : "s"
        } under <span class="mono-note">${esc(shardBase)}/&lt;page&gt;.v1.json</span>,` +
        ` each closed at whichever binds first — ${fmtInt(
          feed.pagination.limits.recordLimit,
        )} records or ${fmtInt(feed.pagination.limits.byteLimit)} bytes of serialized JSON.`,
    }) +
    /* F15: the terminus precedes its control, matching every other compact
       table on the site — and matching what the sentence says. It used to be
       emitted AFTER the control while telling the reader the control was
       "below" it. The order is also what `syncTerminusFor` assumes
       (`previousElementSibling`), so a later owner wiring this disclosure to the
       shared updater finds the terminus where the other three tables keep it. */
    compactDisclosure({
      rootId: "inst-activity-tbody",
      total: rows.length,
      shown: Math.min(rows.length, COMPACT_ROWS),
      noun: "changes",
      domBacked: true,
    }) +
    truncationNoticeHtml(feed.pagination.truncation, feed.pagination.limits.shardLimit) +
    `<div class="caveat-line">Quarter-over-quarter comparisons are between two quarter-end` +
    ` snapshots of what was reported — not a record of transactions, and not a claim about what` +
    ` any manager holds now.</div>` +
    `</section>`
  );
}

/** The whole /institutional activity surface: the feed plus the non-removable
    §5 data_note. The note ships with the feed by construction — a caller cannot
    render one without the other. */
export function activitySectionHtml(feed: ActivityFeed, opts: ActivityFeedOptions = {}): string {
  return activityFeedHtml(feed, opts) + institutionalDataNoteHtml();
}

/* ---------- loading the serving projection ---------- */

function intList(raw: unknown): number[] {
  return jsonArrayOf(raw)
    .map((v) => Number(v))
    .filter((n) => Number.isFinite(n));
}

function strList(raw: unknown): string[] {
  return jsonArrayOf(raw).map((v) => String(v));
}

function strOrNull(v: unknown): string | null {
  return v == null ? null : String(v);
}

const CHANGE_KINDS = new Set<string>(["new", "add", "trim", "exit", "unclassified"]);

/**
 * Where the serving artifact lives. `POPULUS_INST_SERVING_DB` wins; otherwise it
 * sits beside the aggregate the dashboard already reads, or in the explicitly
 * passed build directory. No "newest local build" guess is made here — resolving
 * a build is `data.ts`'s job, and a second resolver could silently serve a
 * different build than the rest of the page.
 */
export function resolveServingDbPath(): string | null {
  const explicit = process.env.POPULUS_INST_SERVING_DB;
  if (explicit) return explicit;
  const agg = process.env.POPULUS_INST_DB;
  if (agg) return path.join(path.dirname(agg), "inst_serving.db");
  const buildDir = process.env.POPULUS_BUILD_DIR;
  if (buildDir) return path.join(buildDir, "inst_serving.db");
  return null;
}

export interface LoadActivityOptions {
  /** False when the build's manifest declares no inst module. */
  instPresent: boolean;
  /** Explicit artifact path; omit to resolve from the environment. */
  dbPath?: string | null;
  /** Pagination overrides (tests only — production uses the mirrored constants). */
  limits?: Partial<PaginationLimits>;
}

function emptyFeed(reason: ActivityAbsenceReason, limits?: Partial<PaginationLimits>): ActivityFeed {
  return {
    present: false,
    reason,
    filings: {},
    pagination: paginateActivity([], {}, { ...limits, absent: reason }),
  };
}

/**
 * Read the activity grain from the serving artifact.
 *
 * Every failure mode degrades to a NAMED absence rather than a partial feed: a
 * missing module, an unlocatable path, a missing file, or an artifact without the
 * activity tables. The dashboard states which one — the three states are not
 * interchangeable, and a reader deserves to know whether data is missing or the
 * module simply is not here.
 */
export function loadActivityFeed(opts: LoadActivityOptions): ActivityFeed {
  if (!opts.instPresent) return emptyFeed("module-absent", opts.limits);
  const dbPath = opts.dbPath ?? resolveServingDbPath();
  if (!dbPath) return emptyFeed("serving-artifact-unlocatable", opts.limits);
  if (!existsSync(dbPath)) return emptyFeed("serving-artifact-missing", opts.limits);

  let db: DatabaseSync;
  try {
    db = new DatabaseSync(dbPath, { readOnly: true });
  } catch {
    return emptyFeed("serving-artifact-missing", opts.limits);
  }
  try {
    const filings: FilingDictionary = {};
    for (const row of db
      .prepare(
        `SELECT filing_key, accession, submission_type, period_of_report, filed_date,
                doc_url, source
           FROM ${FILINGS_TABLE} ORDER BY filing_key`,
      )
      .all() as Record<string, unknown>[]) {
      filings[String(row.filing_key)] = {
        accession: String(row.accession ?? ""),
        submission_type: String(row.submission_type ?? ""),
        period_of_report: String(row.period_of_report ?? ""),
        filed_date: String(row.filed_date ?? ""),
        doc_url: strOrNull(row.doc_url),
        source: String(row.source ?? ""),
      };
    }

    const records: ActivityRecord[] = (
      db
        .prepare(
          `SELECT cik, filer_name, issuer_key, issuer_name, position_key, put_call,
                  ssh_prnamt_type, change_kind, curr_period, prev_period,
                  prev_value_usd, curr_value_usd, delta_value_usd,
                  prev_shares, curr_shares, delta_shares,
                  filing_keys, prior_filing_keys, current_filing_keys, flags
             FROM ${ACTIVITY_TABLE}
            ORDER BY cik, curr_period, position_key, put_call, ssh_prnamt_type`,
        )
        .all() as Record<string, unknown>[]
    ).map((r) => {
      const kind = String(r.change_kind ?? "unclassified");
      return {
        cik: String(r.cik),
        filer_name: strOrNull(r.filer_name),
        issuer_key: strOrNull(r.issuer_key),
        issuer_name: strOrNull(r.issuer_name),
        position_key: String(r.position_key),
        put_call: String(r.put_call ?? ""),
        ssh_prnamt_type: String(r.ssh_prnamt_type ?? ""),
        // Fail-closed: an unrecognised classification presents as not-classifiable,
        // never as a guessed direction (the producer owns classification).
        change_kind: (CHANGE_KINDS.has(kind) ? kind : "unclassified") as ChangeKind,
        curr_period: String(r.curr_period),
        prev_period: strOrNull(r.prev_period),
        prev_value_usd: intOrNull(r.prev_value_usd),
        curr_value_usd: intOrNull(r.curr_value_usd),
        delta_value_usd: intOrNull(r.delta_value_usd),
        prev_shares: intOrNull(r.prev_shares),
        curr_shares: intOrNull(r.curr_shares),
        delta_shares: intOrNull(r.delta_shares),
        filing_keys: intList(r.filing_keys),
        prior_filing_keys: intList(r.prior_filing_keys),
        current_filing_keys: intList(r.current_filing_keys),
        flags: strList(r.flags),
      };
    });

    return {
      present: true,
      reason: null,
      filings,
      pagination: paginateActivity(records, filings, opts.limits),
    };
  } catch {
    // ANY failure lands here — a corrupt file, SQLITE_BUSY, a permissions error,
    // a producer rename. The copy this reason renders used to assert "per-filer
    // and per-issuer surfaces are unaffected", which the code cannot support:
    // `HoldingsTable.astro` reads the SAME file, so whatever broke this read most
    // likely broke those too. The reason is kept narrow and the claim removed.
    return emptyFeed("activity-grain-unavailable", opts.limits);
  } finally {
    db.close();
  }
}

/* ---------- one read per build process ---------- */

let cache: { key: string; feed: ActivityFeed } | null = null;

/** Memoized feed: `getStaticPaths` and every shard `GET` in one Astro build must
    see the same ordering, and re-reading per route would be both slow and a way
    for two routes to disagree. */
export function activityFeed(opts: LoadActivityOptions): ActivityFeed {
  const key = JSON.stringify([opts.instPresent, opts.dbPath ?? resolveServingDbPath(), opts.limits ?? null]);
  if (cache && cache.key === key) return cache.feed;
  const feed = loadActivityFeed(opts);
  cache = { key, feed };
  return feed;
}
