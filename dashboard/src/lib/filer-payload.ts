/* RUN M2-11 T5 (plan R22) — the composite FilerPayloadV1 contract.

   ONE server-side assembler (extracted from `components/HoldingsTable.astro`,
   which now imports it — no duplicated SQL) and ONE strict client validator.
   The payload serves BOTH renderers: the aggregate filer body (`ui.filerBody`
   inputs) and the holdings surface (`holdings.FilerSurfacePayload` fields are a
   structural subset), so a tail filer rendered through the `/e/` driver and a
   pre-rendered top filer draw from the same field set.

   Browser-safe by construction: the assembler takes its `node:sqlite`
   connection as a PARAMETER under a type-only import, so this module carries no
   runtime server dependency — the same split `holdings.ts` (pure) keeps from
   `HoldingsTable.astro` (the reader). The validator ships in the `/e/` bundle.

   NULL-honest: every nullable field is exactly the source contract's
   (`ConcentrationRow`, `QoqDeltaRow`, `FilingWindow`, `FilingDict`,
   `FilerHoldingRow` are reused byte-for-byte, never re-shaped) and the
   validator REJECTS a malformed payload rather than defaulting a field — a
   fabricated zero is a claim, not a repair. */

import type { DatabaseSync } from "node:sqlite";
import {
  capRows,
  parseFilerShard,
  sortHoldingRows,
  type FilerHoldingRow,
  type FilingDict,
  type FilingRef,
} from "./holdings.ts";
import type { ConcentrationRow, QoqDeltaRow } from "./inst.ts";
import type { FilingWindow } from "./derive.ts";

/** Version discriminator — strict-checked by `parseFilerPayload`. */
const FILER_PAYLOAD_VERSION = 1;

/** The routing index the `/e/` driver resolves tail CIKs through (LD-9).
    Defined here — the browser-safe module — because the driver ships these to
    the client while the shard planner (`data.ts`, server-only) emits them. */
export const FILER_INDEX_PATH = "/institutional/data/filers/index.v1.json";

export function filerShardPath(shard: string): string {
  return `/institutional/data/filers/${encodeURIComponent(shard)}.v1.json`;
}

/** The R22 contract, literally (plan revision 6). */
export interface FilerPayloadV1 {
  v: 1;                                   // version discriminator, strict-checked
  kind: "filer";
  cik: string;
  filerName: string;
  latestPeriod: string;
  periods: string[];                      // published periods, ascending
  current: string;
  prior: string | null;
  filings: FilingDict;                    // referenced-only entries
  rowsByPeriod: Record<string, FilerHoldingRow[]>;   // display-ordered, embed-capped
  totalsByPeriod: Record<string, number>;            // pre-cap true totals
  // aggregate body inputs (ui.ts filerBody signature — verified):
  concByPeriod: Record<string, ConcentrationRow | null>;  // topn_share_bps: number|null
  deltasByPeriod: Record<string, QoqDeltaRow[]>;          // nullable prev/curr/delta fields
  latestFiled: string | null;
  topn: number;                           // the N of top-N — SEPARATE from topn_share_bps
  window: FilingWindow | null;            // { open, quarterEnd, deadline }
}

/* ================================================================ assembler */

/** The aggregate half of the payload — computed by the caller from the
    published aggregate (`inst.ts` accessors), exactly the `ui.filerBody`
    inputs the pre-rendered page uses. */
export interface FilerAggregateInputs {
  concByPeriod: Record<string, ConcentrationRow | null>;
  deltasByPeriod: Record<string, QoqDeltaRow[]>;
  latestFiled: string | null;
  topn: number;
  window: FilingWindow | null;
}

interface AssembleFilerArgs {
  cik: string;
  filerName: string;
  latestPeriod: string;
  /** The period the caller wants current; falls back to the latest published
      serving period when the projection does not carry it. */
  requestedPeriod: string;
  /** The build's FULL filing dictionary. The payload carries only the entries
      the included rows reference (R22: referenced-only). */
  filings: FilingDict;
  agg: FilerAggregateInputs;
}

/** Read the `serving_filings` dictionary once per artifact — shared by the
    component and the shard planner so there is one reader, not two. */
export function readServingFilings(db: DatabaseSync): FilingDict {
  const out: FilingDict = {};
  const rows = db
    .prepare(
      `SELECT filing_key, accession, submission_type, period_of_report, filed_date,
              doc_url, source
         FROM serving_filings ORDER BY filing_key`,
    )
    .all() as Record<string, unknown>[];
  for (const row of rows) {
    out[String(row.filing_key)] = {
      accession: String(row.accession ?? ""),
      submission_type: String(row.submission_type ?? ""),
      period_of_report: String(row.period_of_report ?? ""),
      filed_date: String(row.filed_date ?? ""),
      doc_url: row.doc_url == null ? null : String(row.doc_url),
      source: String(row.source ?? ""),
    };
  }
  return out;
}

/**
 * THE server-side assembler (R22) — the SQL and the period/cap/sort logic that
 * used to live inline in `HoldingsTable.astro`, verbatim: rows read per entity
 * through the artifact's own index, normalized by the same `parseFilerShard`
 * guards a JSON shard gets, display-ordered, embed-capped, with pre-cap true
 * totals kept beside the capped rows (G3).
 *
 * A filer with NO serving rows still assembles (empty `periods`/`rowsByPeriod`)
 * so a published tail filer is never silently dropped from its shard; the
 * component treats the empty-periods case as the honest-absence state, exactly
 * as it treated zero rows before the extraction.
 */
export function assembleFilerPayload(db: DatabaseSync, args: AssembleFilerArgs): FilerPayloadV1 {
  const raw = db
    .prepare(
      // `put_call_bucket` / `unit_key` are the PRODUCER's grain discriminators —
      // read rather than recomputed (see the component's original comment).
      `SELECT cik, period, filing_key, security_id, cusip, issuer_name, title_of_class,
              value_usd, shares, ssh_type, put_call, position_key,
              put_call_bucket, unit_key, flags
         FROM serving_filer_rows WHERE cik = ? ORDER BY period, rowid`,
    )
    .all(args.cik) as Record<string, unknown>[];
  // Same normaliser and same hard-failure guards as a JSON shard would get.
  // The dictionary is passed separately — parsing the full build dictionary
  // once per filer would be quadratic over the corpus.
  const rows = parseFilerShard({ filings: {}, rows: raw }).rows;

  const periods = [...new Set(rows.map((r) => r.period))].sort();
  // OD-5: the selected quarter and the one before it, both browsable.
  const current =
    periods.length === 0
      ? args.requestedPeriod
      : periods.includes(args.requestedPeriod)
        ? args.requestedPeriod
        : periods[periods.length - 1]!;
  const earlier = periods.filter((p) => p < current);
  const prior = earlier.length > 0 ? earlier[earlier.length - 1]! : null;

  const rowsByPeriod: Record<string, FilerHoldingRow[]> = {};
  const totalsByPeriod: Record<string, number> = {};
  if (periods.length > 0) {
    for (const period of prior ? [prior, current] : [current]) {
      const capped = capRows(sortHoldingRows(rows.filter((r) => r.period === period)));
      rowsByPeriod[period] = capped.rows;
      totalsByPeriod[period] = capped.total;
    }
  }

  // R22: referenced-only filing entries — the keys the included rows cite,
  // resolved through the build dictionary. A key the dictionary does not carry
  // stays absent and renders as the stated "filing not in dictionary" state.
  const filings: FilingDict = {};
  for (const list of Object.values(rowsByPeriod)) {
    for (const row of list) {
      if (row.filing_key == null) continue;
      const ref = args.filings[row.filing_key];
      if (ref) filings[row.filing_key] = ref;
    }
  }

  return {
    v: 1,
    kind: "filer",
    cik: args.cik,
    filerName: args.filerName,
    latestPeriod: args.latestPeriod,
    periods,
    current,
    prior,
    filings,
    rowsByPeriod,
    totalsByPeriod,
    concByPeriod: args.agg.concByPeriod,
    deltasByPeriod: args.agg.deltasByPeriod,
    latestFiled: args.agg.latestFiled,
    topn: args.agg.topn,
    window: args.agg.window,
  };
}

/* ================================================================ validator */

/** Thrown by `parseFilerPayload`. `code` maps onto the driver's existing error
    taxonomy: "version" → version_mismatch, "bad_payload" → bad_payload. */
export class FilerPayloadError extends Error {
  readonly code: "version" | "bad_payload";
  readonly got: unknown;
  constructor(code: "version" | "bad_payload", message: string, got?: unknown) {
    super(message);
    this.name = "FilerPayloadError";
    this.code = code;
    this.got = got;
  }
}

function bad(detail: string): never {
  throw new FilerPayloadError("bad_payload", detail);
}

/** R22 STRICT validation is two-sided: missing fields reject (below), and so
    does any field the contract does not declare — a payload with an extra key
    is not this contract, and silently stripping it would let a producer drift
    ship as a "valid" parse. The error names the offending key path. */
function onlyKeys(v: Record<string, unknown>, allowed: readonly string[], path: string): void {
  for (const key of Object.keys(v)) {
    if (!allowed.includes(key)) {
      bad(`unknown key at ${path ? `${path}.` : ""}${key} — not a declared field (strict R22)`);
    }
  }
}

const PAYLOAD_KEYS = [
  "v", "kind", "cik", "filerName", "latestPeriod", "periods", "current", "prior",
  "filings", "rowsByPeriod", "totalsByPeriod", "concByPeriod", "deltasByPeriod",
  "latestFiled", "topn", "window",
] as const;

const FILING_REF_KEYS = [
  "accession", "submission_type", "period_of_report", "filed_date", "doc_url", "source",
] as const;

const CONCENTRATION_KEYS = [
  "cik", "period_of_report", "position_count", "total_value_usd", "null_value_positions",
  "topn_value_usd", "topn_share_bps", "hhi", "flags",
] as const;

const DELTA_KEYS = [
  "cik", "position_key", "put_call", "curr_period", "prev_period", "change_kind",
  "prev_value_usd", "curr_value_usd", "delta_value_usd", "prev_shares", "curr_shares",
  "delta_shares", "ssh_prnamt_type", "flags",
] as const;

const WINDOW_KEYS = ["open", "quarterEnd", "deadline"] as const;

/** The canonical serialized `FilerHoldingRow` field set (the assembler always
    emits this exact shape). The change fields are DELIBERATELY appended: they
    must fall through to `parseFilerShard`'s grain-ban so the payload rejects
    them with the named change-field defect, not a generic unknown-key one. */
const HOLDING_ROW_KEYS = [
  "cik", "period", "filing_key", "security_id", "cusip", "issuer_name", "title_of_class",
  "value_usd", "shares", "ssh_type", "put_call", "position_key", "put_call_bucket",
  "unit_key", "flags",
  "change_kind", "delta_value_usd", "delta_shares", "prev_value_usd", "curr_value_usd",
] as const;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Codex F4: `undefined` here means the property is ABSENT (JSON has no
    undefined), and an absent property must never default — NULL-honest means
    an explicit null on the wire, never a hole a validator papers over. The
    error names the field path. */
function missing(field: string): never {
  bad(`${field} is missing — required properties must be present (nullable fields carry explicit null, never absence)`);
}

function reqString(v: unknown, field: string): string {
  if (v === undefined) missing(field);
  if (typeof v !== "string") bad(`${field} is not a string`);
  return v;
}

function stringOrNull(v: unknown, field: string): string | null {
  if (v === undefined) missing(field);
  if (v === null) return null;
  if (typeof v !== "string") bad(`${field} is neither a string nor null`);
  return v;
}

function reqNumber(v: unknown, field: string): number {
  if (v === undefined) missing(field);
  if (typeof v !== "number" || !Number.isFinite(v)) bad(`${field} is not a finite number`);
  return v;
}

function numberOrNull(v: unknown, field: string): number | null {
  if (v === undefined) missing(field);
  if (v === null) return null;
  if (typeof v !== "number" || !Number.isFinite(v)) bad(`${field} is neither a number nor null`);
  return v;
}

function stringArray(v: unknown, field: string): string[] {
  if (v === undefined) missing(field);
  if (!Array.isArray(v)) bad(`${field} is not an array`);
  return v.map((item, i) => reqString(item, `${field}[${i}]`));
}

function filingRefOf(v: unknown, field: string): FilingRef {
  if (!isRecord(v)) bad(`${field} is not an object`);
  onlyKeys(v, FILING_REF_KEYS, field);
  return {
    accession: reqString(v.accession, `${field}.accession`),
    submission_type: reqString(v.submission_type, `${field}.submission_type`),
    period_of_report: reqString(v.period_of_report, `${field}.period_of_report`),
    filed_date: reqString(v.filed_date, `${field}.filed_date`),
    doc_url: stringOrNull(v.doc_url, `${field}.doc_url`),
    source: reqString(v.source, `${field}.source`),
  };
}

function concentrationOf(v: unknown, field: string): ConcentrationRow | null {
  if (v === null) return null;
  if (!isRecord(v)) bad(`${field} is neither an object nor null`);
  onlyKeys(v, CONCENTRATION_KEYS, field);
  return {
    cik: reqString(v.cik, `${field}.cik`),
    period_of_report: reqString(v.period_of_report, `${field}.period_of_report`),
    position_count: reqNumber(v.position_count, `${field}.position_count`),
    total_value_usd: reqNumber(v.total_value_usd, `${field}.total_value_usd`),
    null_value_positions: reqNumber(v.null_value_positions, `${field}.null_value_positions`),
    topn_value_usd: reqNumber(v.topn_value_usd, `${field}.topn_value_usd`),
    // NULL-honest: NULL means concentration_unavailable, never a fabricated 0.
    topn_share_bps: numberOrNull(v.topn_share_bps, `${field}.topn_share_bps`),
    hhi: numberOrNull(v.hhi, `${field}.hhi`),
    flags: stringArray(v.flags, `${field}.flags`),
  };
}

const PUT_CALLS = new Set(["LONG", "PUT", "CALL"]);
const CHANGE_KINDS = new Set(["new", "add", "trim", "exit", "unclassified"]);
const UNIT_TYPES = new Set(["SH", "PRN", "UNKNOWN"]);

function deltaOf(v: unknown, field: string): QoqDeltaRow {
  if (!isRecord(v)) bad(`${field} is not an object`);
  onlyKeys(v, DELTA_KEYS, field);
  const putCall = reqString(v.put_call, `${field}.put_call`);
  if (!PUT_CALLS.has(putCall)) bad(`${field}.put_call is not a known grain token`);
  const changeKind = reqString(v.change_kind, `${field}.change_kind`);
  if (!CHANGE_KINDS.has(changeKind)) bad(`${field}.change_kind is not a producer classification`);
  const unit = reqString(v.ssh_prnamt_type, `${field}.ssh_prnamt_type`);
  if (!UNIT_TYPES.has(unit)) bad(`${field}.ssh_prnamt_type is not a known unit`);
  return {
    cik: reqString(v.cik, `${field}.cik`),
    position_key: reqString(v.position_key, `${field}.position_key`),
    put_call: putCall as QoqDeltaRow["put_call"],
    curr_period: reqString(v.curr_period, `${field}.curr_period`),
    prev_period: reqString(v.prev_period, `${field}.prev_period`),
    change_kind: changeKind as QoqDeltaRow["change_kind"],
    prev_value_usd: numberOrNull(v.prev_value_usd, `${field}.prev_value_usd`),
    curr_value_usd: numberOrNull(v.curr_value_usd, `${field}.curr_value_usd`),
    delta_value_usd: numberOrNull(v.delta_value_usd, `${field}.delta_value_usd`),
    prev_shares: numberOrNull(v.prev_shares, `${field}.prev_shares`),
    curr_shares: numberOrNull(v.curr_shares, `${field}.curr_shares`),
    delta_shares: numberOrNull(v.delta_shares, `${field}.delta_shares`),
    ssh_prnamt_type: unit as QoqDeltaRow["ssh_prnamt_type"],
    flags: stringArray(v.flags, `${field}.flags`),
  };
}

/** Codex F4: `parseFilerShard` NORMALIZES — `str`/`strOrNull`/`intOrNull`/
    `flagsOf` default an absent or oddly-typed field. That is acceptable for the
    server reading its own artifact, but the client validator must check the
    PRESENCE and TYPE of every `FilerHoldingRow` property BEFORE that
    normalization runs: a shard row carrying only `period` must reject naming
    its first missing field, never parse into a row of defaulted empty strings
    and nulls. The banned change fields are deliberately NOT listed here — they
    fall through to `parseFilerShard`'s grain ban and its named defect. */
const HOLDING_ROW_SHAPE: readonly (readonly [
  field: string,
  shape: "string" | "stringOrNull" | "numberOrNull" | "flags",
])[] = [
  ["cik", "string"],
  ["period", "string"],
  ["filing_key", "stringOrNull"],
  ["security_id", "stringOrNull"],
  ["cusip", "stringOrNull"],
  ["issuer_name", "string"],
  ["title_of_class", "stringOrNull"],
  ["value_usd", "numberOrNull"],
  ["shares", "numberOrNull"],
  ["ssh_type", "stringOrNull"],
  ["put_call", "stringOrNull"],
  ["position_key", "stringOrNull"],
  ["put_call_bucket", "stringOrNull"],
  ["unit_key", "stringOrNull"],
  ["flags", "flags"],
] as const;

function holdingRowShapeOf(row: Record<string, unknown>, at: string): void {
  for (const [field, shape] of HOLDING_ROW_SHAPE) {
    // A change field present here is caught by parseFilerShard's grain ban;
    // required fields are checked first only among the CONTRACT fields.
    const v = row[field];
    const path = `${at}.${field}`;
    if (v === undefined) missing(path);
    switch (shape) {
      case "string":
        reqString(v, path);
        break;
      case "stringOrNull":
        stringOrNull(v, path);
        break;
      case "numberOrNull":
        numberOrNull(v, path);
        break;
      case "flags":
        stringArray(v, path);
        break;
    }
  }
}

function windowOf(v: unknown): FilingWindow | null {
  if (v === null) return null;
  if (!isRecord(v)) bad(`window is neither an object nor null`);
  onlyKeys(v, WINDOW_KEYS, "window");
  if (v.open === undefined) missing("window.open");
  if (typeof v.open !== "boolean") bad(`window.open is not a boolean`);
  return {
    open: v.open,
    quarterEnd: reqString(v.quarterEnd, "window.quarterEnd"),
    deadline: reqString(v.deadline, "window.deadline"),
  };
}

/**
 * The strict client validator (R22). Checks the version discriminator first,
 * then every required field — REJECTING rather than defaulting: a payload that
 * fails here is `bad_payload` in the driver's existing taxonomy, never a
 * silently repaired render. Row lists re-run the `parseFilerShard` guards, so
 * the change-field grain ban holds on the client exactly as it does on the
 * server.
 */
export function parseFilerPayload(raw: unknown): FilerPayloadV1 {
  if (!isRecord(raw)) bad("payload is not a JSON object");
  if (typeof raw.v !== "number") bad("payload has no version field");
  if (raw.v !== FILER_PAYLOAD_VERSION) {
    throw new FilerPayloadError("version", `payload is version ${String(raw.v)}`, raw.v);
  }
  if (raw.kind !== "filer") bad("payload kind is not \"filer\"");
  onlyKeys(raw, PAYLOAD_KEYS, "");

  const cik = reqString(raw.cik, "cik");
  if (cik === "") bad("cik is empty");
  const filerName = reqString(raw.filerName, "filerName");
  const latestPeriod = reqString(raw.latestPeriod, "latestPeriod");
  const periods = stringArray(raw.periods, "periods");
  const current = reqString(raw.current, "current");
  const prior = stringOrNull(raw.prior, "prior");

  if (!isRecord(raw.filings)) bad("filings is not an object");
  const filings: FilingDict = {};
  for (const [key, value] of Object.entries(raw.filings)) {
    filings[key] = filingRefOf(value, `filings[${JSON.stringify(key)}]`);
  }

  if (!isRecord(raw.rowsByPeriod)) bad("rowsByPeriod is not an object");
  const rowsByPeriod: Record<string, FilerHoldingRow[]> = {};
  for (const [period, value] of Object.entries(raw.rowsByPeriod)) {
    if (!Array.isArray(value)) bad(`rowsByPeriod[${JSON.stringify(period)}] is not an array`);
    value.forEach((row, i) => {
      const at = `rowsByPeriod[${JSON.stringify(period)}][${i}]`;
      if (!isRecord(row)) bad(`${at} is not an object`);
      // HOLDING_ROW_KEYS includes the banned change fields so they reach
      // parseFilerShard's grain ban and reject under its NAMED defect.
      onlyKeys(row, HOLDING_ROW_KEYS, at);
      // Codex F4: presence AND type of every contract field, BEFORE the
      // normalizer below can default an absent one.
      holdingRowShapeOf(row, at);
    });
    try {
      rowsByPeriod[period] = parseFilerShard({ filings: {}, rows: value }).rows;
    } catch (err) {
      bad(`rowsByPeriod[${JSON.stringify(period)}]: ${(err as Error).message}`);
    }
  }

  if (!isRecord(raw.totalsByPeriod)) bad("totalsByPeriod is not an object");
  const totalsByPeriod: Record<string, number> = {};
  for (const [period, value] of Object.entries(raw.totalsByPeriod)) {
    totalsByPeriod[period] = reqNumber(value, `totalsByPeriod[${JSON.stringify(period)}]`);
  }

  if (!isRecord(raw.concByPeriod)) bad("concByPeriod is not an object");
  const concByPeriod: Record<string, ConcentrationRow | null> = {};
  for (const [period, value] of Object.entries(raw.concByPeriod)) {
    concByPeriod[period] = concentrationOf(value, `concByPeriod[${JSON.stringify(period)}]`);
  }

  if (!isRecord(raw.deltasByPeriod)) bad("deltasByPeriod is not an object");
  const deltasByPeriod: Record<string, QoqDeltaRow[]> = {};
  for (const [period, value] of Object.entries(raw.deltasByPeriod)) {
    if (!Array.isArray(value)) bad(`deltasByPeriod[${JSON.stringify(period)}] is not an array`);
    deltasByPeriod[period] = value.map((d, i) =>
      deltaOf(d, `deltasByPeriod[${JSON.stringify(period)}][${i}]`),
    );
  }

  // F3: every nested cik must agree with the payload's own — a shard whose row,
  // concentration, or delta rows carry another filer's CIK is corrupt, and
  // rendering it would attribute one manager's positions to another.
  //
  // Codex F3 (delta round): the SAME argument holds for the period. Each of
  // these maps is keyed by period AND its records carry their own period
  // field, so the two can disagree — and a disagreement renders one quarter's
  // positions under another quarter's heading, which is a false claim about
  // WHEN a manager held something. The record's own field differs by row type
  // and is validated per type, never assumed:
  //   FilerHoldingRow  -> period
  //   ConcentrationRow -> period_of_report
  //   QoqDeltaRow      -> curr_period   (prev_period is deliberately NOT
  //                       cross-checked: it names the comparison quarter, not
  //                       the map key's quarter)
  for (const [period, rows] of Object.entries(rowsByPeriod)) {
    for (const [i, row] of rows.entries()) {
      if (row.cik !== cik) {
        throw new FilerPayloadError(
          "bad_payload",
          `rowsByPeriod["${period}"][${i}].cik ${row.cik} != payload cik ${cik}`,
        );
      }
      if (row.period !== period) {
        throw new FilerPayloadError(
          "bad_payload",
          `rowsByPeriod["${period}"][${i}].period ${row.period} != map key ${period}`,
        );
      }
    }
  }
  for (const [period, conc] of Object.entries(concByPeriod)) {
    if (conc !== null && conc.cik !== cik) {
      throw new FilerPayloadError(
        "bad_payload",
        `concByPeriod["${period}"].cik ${conc.cik} != payload cik ${cik}`,
      );
    }
    if (conc !== null && conc.period_of_report !== period) {
      throw new FilerPayloadError(
        "bad_payload",
        `concByPeriod["${period}"].period_of_report ${conc.period_of_report} != map key ${period}`,
      );
    }
  }
  for (const [period, deltas] of Object.entries(deltasByPeriod)) {
    for (const [i, d] of deltas.entries()) {
      if (d.cik !== cik) {
        throw new FilerPayloadError(
          "bad_payload",
          `deltasByPeriod["${period}"][${i}].cik ${d.cik} != payload cik ${cik}`,
        );
      }
      if (d.curr_period !== period) {
        throw new FilerPayloadError(
          "bad_payload",
          `deltasByPeriod["${period}"][${i}].curr_period ${d.curr_period} != map key ${period}`,
        );
      }
    }
  }

  return {
    v: 1,
    kind: "filer",
    cik,
    filerName,
    latestPeriod,
    periods,
    current,
    prior,
    filings,
    rowsByPeriod,
    totalsByPeriod,
    concByPeriod,
    deltasByPeriod,
    latestFiled: stringOrNull(raw.latestFiled, "latestFiled"),
    topn: reqNumber(raw.topn, "topn"),
    // `undefined` (field missing) fails inside windowOf; null is a valid state.
    window: windowOf("window" in raw ? raw.window : bad("window is missing — pass null explicitly")),
  };
}
