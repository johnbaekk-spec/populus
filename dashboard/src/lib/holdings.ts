/* RUN M2-8 T11/T12 (plan R11, R12, R16) — per-filer reported positions and the
   as-of-resolved holder list.

   PURE by construction: no `node:` imports and no DOM. The inline pager inside
   `components/HoldingsTable.astro` imports these same renderers, so the SSR page
   and every client-paged page come out of ONE function — the repo's SSR/client
   parity rule (`ui.ts` header). The artifact READ therefore lives in that
   component's frontmatter, not here.

   Contract: `src/populus/inst_serving.py` — three directional projections plus a
   `filings` dictionary. Grains are never flattened together:

     filer          one row per REPORTED HOLDING          `serving_filer_rows`
     issuer-holder  one row per (issuer, period, FILER)   `serving_issuer_holder_rows`

   The rows reach this module as plain records with a `filings` dictionary
   beside them, whether they were read from the serving artifact's tables (what
   ships today) or from an emitted JSON shard. The row SCHEMA is the contract;
   the transport is not.

   Three properties this module refuses to give up:

   1. **NULL-honest.** `value_usd` is legitimately NULL when the manager did not
      disclose a value. It renders as "undisclosed" and is excluded from sums,
      never as 0 and never silently dropped from a count.
   2. **`issuer_dedup_total_usd` is a different question.** It is the issuer's
      de-duplicated total across affiliated managers; the per-filer `value_usd`
      is what one filer reported. Adding them would double-count by
      construction, so no function here sums across the two.
   3. **Nothing honesty-bearing is optional.** The dual dates + reporting lag on
      every row, the unresolved counts beside the holder table, and the
      truncation terminus are rendered by the same functions that render the
      numbers — no caller can drop them. The §5 `data_note` sits beside them,
      rendered by the component from `activity.ts`'s canonical clauses. */

import {
  esc,
  fmtInt,
  fmtUsd,
  flagTags,
  universalFlags,
  universalFlagNote,
  intOrNull,
  jsonArrayOf,
  latestFiling,
  reportingLagDays,
  terminusRow,
  footnoteBlock,
  statTiles,
  srcLink,
  srcLinkDerived,
  type FootnoteEntry,
  type StatTile,
} from "./format.ts";
export { reportingLagDays };
import { edgarFilerUrl } from "./derive.ts";

/* ================================================================== contract */

/** One entry of a shard's filing dictionary — ONE per filing, not per row. */
export interface FilingRef {
  accession: string;
  submission_type: string;
  period_of_report: string;
  filed_date: string;
  doc_url: string | null;
  source: string;
}

/** `filing_key -> FilingRef`. Keys arrive as JSON object keys, so they are read
    as strings and normalized to strings on the row side too. */
export type FilingDict = Record<string, FilingRef>;

/** Filer projection: one row per REPORTED holding (`v_filer_reported_holdings`),
    so a position an affiliate also reported still appears on its own filer's
    page (plan §F / R8). Change fields never ride here — `position_key` is a
    REFERENCE to the `agg_qoq_deltas` record, never a copy of it (R7). */
export interface FilerHoldingRow {
  cik: string;
  period: string;
  filing_key: string | null;
  security_id: string | null;
  cusip: string | null;
  issuer_name: string;
  title_of_class: string | null;
  /** NULL = undisclosed. Never 0. */
  value_usd: number | null;
  shares: number | null;
  ssh_type: string | null;
  put_call: string | null;
  /** NULL = UNKEYABLE. `inst_agg._position_key()` returns NULL for a holding
      with neither a resolved security nor a reported CUSIP — a documented,
      RETAINED producer state (G3), excluded from QoQ because it has no stable
      cross-quarter handle. It must stay NULL here: coercing it to `""` made
      every unkeyable row share one identity, and the fold below then summed
      them into a single row under the FIRST row's issuer name. */
  position_key: string | null;
  /** The producer's OWN grain discriminators (`inst_agg._put_call_bucket` /
      `_unit_key`) — the tokens `agg_qoq_deltas` keys on. NULL when the shard
      predates them; `positionIdentity` then derives them, and the derivation is
      pinned against the Python rule by a test. */
  put_call_bucket: string | null;
  unit_key: string | null;
  flags: string[];
}

/** Issuer-holder projection: one row per (issuer, period, FILER). `filer_key` is
    MANDATORY — an issuer bucket holds many filers, so a row without it cannot
    say who holds what (plan R6). */
export interface IssuerHolderRow {
  issuer_key: string;
  issuer_key_source: string | null;
  issuer_name: string;
  period: string;
  filer_key: string;
  filer_name: string;
  affiliate_group_key: string | null;
  /** NULL = at least one component undisclosed. Never a partial sum. */
  value_usd: number | null;
  value_undisclosed_component: boolean;
  /** NULL only if the shard is not what the producer wrote (declared NOT NULL).
      Rendered as "—", never as a claim of zero securities. */
  security_count: number | null;
  filing_keys: string[];
  /** DISTINCT from `value_usd` — the issuer's de-duplicated total across
      affiliated managers. Never summed with the per-filer value. */
  issuer_dedup_total_usd: number | null;
  /** R22: top/tail budget state for the row's filer link, attached by the
      server-side reader (it is not an artifact column) and carried through the
      embedded payload so the client re-render links identically. Absent means
      unknown, which `filerLinkHtml` treats as tail — the reachable direction. */
  filer_tier?: FilerBudgetState;
}

/** A batch of rows plus the dictionary they resolve through — one table read
    from `inst_serving.db`, or one emitted JSON shard. Same schema either way. */
export interface FilerShard {
  filings: FilingDict;
  rows: FilerHoldingRow[];
}

export interface IssuerShard {
  filings: FilingDict;
  rows: IssuerHolderRow[];
}

/* ---------- the §5 structural caveat (R16) — non-removable ---------- */

/* MOVED here from `lib/activity.ts` in RUN M2-11 (plan R22): still the ONE
   canonical copy — activity.ts re-exports it — but it must live in a
   browser-safe module now, because the `/e/` driver's in-extract filer path
   renders the note on the client and activity.ts imports `node:sqlite`. */

/** M2-CONTRACT §5 / ARCHITECTURE §9.8, clause by clause so a fold test can name
    the missing one instead of failing on a blob.

    THE canonical §5 note for every dashboard surface, and the ONLY one. It is
    pinned clause-for-clause against `populus.normalize_inst.INST_DATA_NOTE` — the
    Python constant the MCP envelope and the ingest CLI carry — by
    `test/activity.test.ts`, so the two cannot drift.

    QA M2-8 M6: three divergent texts shipped, two of them on the SAME page. This
    list had silently dropped three substantive qualifiers present in the Python
    constant ("so managers below that threshold are absent entirely", "with
    unit_basis carried on every record", and the §5.2 citation) — restored above.
    The third text, a `.explainer` paragraph in `ui.ts` under the near-identical
    heading "What a 13F is — and is not.", rendered directly above this box on
    every filer page; it is now a pointer INTO this box rather than a fourth
    phrasing of it. */
export const INSTITUTIONAL_DATA_NOTE_CLAUSES: readonly { id: string; text: string }[] = [
  {
    id: "long-only",
    text:
      "13F reports cover LONG positions in Section 13(f) securities (US exchange-traded equities" +
      " plus reportable options, warrants, certain convertibles) held by managers with at least" +
      " $100M in such securities — so managers below that threshold are absent entirely. No short" +
      " positions, no cash, no non-13(f) assets — not a full portfolio, and not a census of" +
      " institutional ownership.",
  },
  {
    id: "snapshot-lag",
    text:
      "Positions are quarter-end snapshots filed up to 45 days late — not current holdings. A" +
      " position may have been changed or closed before you ever see it, and is older still by" +
      " however long ago that quarter ended.",
  },
  {
    id: "era-units",
    text:
      "Values are the manager's stated market value at quarter-end in era-dependent units (whole" +
      " dollars for form versions effective 2023-01-03 onward, thousands before), normalized here" +
      " to whole dollars with unit_basis carried on every record.",
  },
  {
    id: "affiliates",
    text:
      "Affiliated managers may report the same position (otherManager), so one position can appear" +
      " under more than one filer.",
  },
  {
    id: "confidential",
    text:
      "Positions under confidential treatment may be omitted until a later amendment discloses them.",
  },
  {
    id: "not-advice",
    text:
      "These are disclosures, not investment advice (ARCHITECTURE.md \u00a75.2 /" +
      " M2-CONTRACT \u00a75).",
  },
];

/**
 * The §5 structural caveat as markup. Non-removable: every clause is a
 * `.caveat-line`, which the fold guard and the print block both protect, and the
 * block carries `data-inst-data-note` so a test can find it on any surface.
 */
export function institutionalDataNoteHtml(): string {
  return (
    `<section class="caveat-box" id="inst-data-note" data-inst-data-note aria-label="What a 13F is and is not">` +
    `<div class="caveat-box-head">What a 13F is — and is not</div>` +
    `<div class="caveat-box-body">` +
    INSTITUTIONAL_DATA_NOTE_CLAUSES.map(
      (c) => `<p class="caveat-line" data-note-clause="${esc(c.id)}">${esc(c.text)}</p>`,
    ).join("") +
    `</div></section>`
  );
}

/* ================================================================== parsing */

function str(v: unknown): string {
  return String(v ?? "");
}

function strOrNull(v: unknown): string | null {
  return v == null ? null : String(v);
}

function flagsOf(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(String);
  if (typeof v === "string" && v.length > 0) {
    try {
      const parsed = JSON.parse(v);
      return Array.isArray(parsed) ? parsed.map(String) : [];
    } catch {
      return [];
    }
  }
  return [];
}

/** `filing_keys` is a canonical sorted JSON array in the serving artifact
    (`serving_issuer_holder_rows.filing_keys`, TEXT NOT NULL) and a real array in
    an emitted JSON shard. Both forms are the same list. */
function keysOf(v: unknown): string[] {
  // ONE JSON-array reader (format.jsonArrayOf). The bare-scalar fallback this
  // used to carry was the inverse of activity.ts's, so a malformed column read
  // as one key on one surface and as none on the other.
  return jsonArrayOf(v)
    .filter((k) => k != null)
    .map(String);
}

function filingsOf(raw: unknown): FilingDict {
  const out: FilingDict = {};
  if (raw == null || typeof raw !== "object") return out;
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const v = (value ?? {}) as Record<string, unknown>;
    out[String(key)] = {
      accession: str(v.accession),
      submission_type: str(v.submission_type),
      period_of_report: str(v.period_of_report),
      filed_date: str(v.filed_date),
      doc_url: strOrNull(v.doc_url),
      source: str(v.source),
    };
  }
  return out;
}

function rowsOf(raw: Record<string, unknown>, ...names: string[]): Record<string, unknown>[] {
  for (const name of names) {
    const v = raw[name];
    if (Array.isArray(v)) return v as Record<string, unknown>[];
  }
  throw new Error(
    `shard carries no row array — expected one of ${names.join(", ")}; an unreadable ` +
      `shard is a hard failure, never an empty page that looks like "no holdings"`,
  );
}

/** Change fields belong to `agg_qoq_deltas`, at a different grain. A holding row
    carrying them means the producer flattened two grains, which would either
    duplicate a delta across composed rows or absorb rows into one — a hard
    failure, not something to render (plan §B, testing strategy). */
const CHANGE_FIELDS = [
  "change_kind",
  "delta_value_usd",
  "delta_shares",
  "prev_value_usd",
  "curr_value_usd",
] as const;

export function parseFilerShard(raw: unknown): FilerShard {
  const obj = (raw ?? {}) as Record<string, unknown>;
  const rows: FilerHoldingRow[] = rowsOf(obj, "filer_rows", "rows", "holdings").map((r, i) => {
    for (const field of CHANGE_FIELDS) {
      if (field in r) {
        throw new Error(
          `filer row ${i} carries the change field "${field}" — holding and change ` +
            `records keep separate grains, joined by position_key (plan Locked #5)`,
        );
      }
    }
    return {
      cik: str(r.cik),
      period: str(r.period ?? r.period_of_report),
      filing_key: strOrNull(r.filing_key),
      security_id: strOrNull(r.security_id),
      cusip: strOrNull(r.cusip),
      issuer_name: str(r.issuer_name),
      title_of_class: strOrNull(r.title_of_class),
      value_usd: intOrNull(r.value_usd),
      shares: intOrNull(r.shares ?? r.ssh_prnamt),
      ssh_type: strOrNull(r.ssh_type ?? r.ssh_prnamt_type),
      put_call: strOrNull(r.put_call),
      // strOrNull, NOT str: `str(null) === ""`, and an empty string is a
      // perfectly good Map key. That single coercion is what let three holdings
      // of three different issuers fold into one row carrying their summed value.
      position_key: strOrNull(r.position_key),
      put_call_bucket: strOrNull(r.put_call_bucket),
      unit_key: strOrNull(r.unit_key),
      flags: flagsOf(r.flags),
    };
  });
  return { filings: filingsOf(obj.filings), rows };
}

export function parseIssuerShard(raw: unknown): IssuerShard {
  const obj = (raw ?? {}) as Record<string, unknown>;
  const rows: IssuerHolderRow[] = rowsOf(obj, "issuer_holder_rows", "rows", "holders").map(
    (r, i) => {
      const filerKey = strOrNull(r.filer_key);
      if (!filerKey) {
        throw new Error(
          `issuer-holder row ${i} has no filer_key — an issuer bucket holds many ` +
            `filers, so a row without one cannot say who holds what (plan R6)`,
        );
      }
      return {
        issuer_key: str(r.issuer_key),
        issuer_key_source: strOrNull(r.issuer_key_source),
        issuer_name: str(r.issuer_name),
        period: str(r.period ?? r.period_of_report),
        filer_key: filerKey,
        filer_name: str(r.filer_name || filerKey),
        affiliate_group_key: strOrNull(r.affiliate_group_key),
        value_usd: intOrNull(r.value_usd),
        value_undisclosed_component: Boolean(r.value_undisclosed_component),
        // NOT `?? 0`: the producer declares this NOT NULL, so a NULL here means
        // the shard is not what the producer wrote — and 0 securities is a
        // claim, not a gap. Latent today; the coercion is the defect.
        security_count: intOrNull(r.security_count),
        filing_keys: keysOf(r.filing_keys),
        issuer_dedup_total_usd: intOrNull(r.issuer_dedup_total_usd),
      };
    },
  );
  return { filings: filingsOf(obj.filings), rows };
}

/* ============================================== provenance, dates, and lag */

export interface Provenance {
  periodOfReport: string | null;
  /** max filed_date over the composition — a position can be composed from a
      base 13F-HR plus NEW-HOLDINGS amendments (plan §B) */
  filedDate: string | null;
  lagDays: number | null;
  docUrl: string | null;
  accessions: string[];
  submissionTypes: string[];
  /** false when the shard's dictionary has no entry for a key the row cites */
  known: boolean;
  filingCount: number;
}


/** Elapsed reporting lag in whole days, quarter-end → filed. NULL when either
    date is missing: an unknown lag is stated, never printed as 0. */

/** Resolve a row's filing keys through the shard dictionary. `fallbackPeriod` is
    the row's own period so a dictionary miss still carries the quarter-end it
    was filed for — degraded, but never a blank date cell. */
export function provenanceOf(
  keys: readonly (string | null)[],
  filings: FilingDict,
  fallbackPeriod: string,
): Provenance {
  const refs: FilingRef[] = [];
  let missing = 0;
  for (const key of keys) {
    if (key == null) {
      missing++;
      continue;
    }
    const ref = filings[String(key)];
    if (ref) refs.push(ref);
    else missing++;
  }
  if (refs.length === 0) {
    return {
      periodOfReport: fallbackPeriod || null,
      filedDate: null,
      lagDays: null,
      docUrl: null,
      accessions: [],
      submissionTypes: [],
      known: false,
      filingCount: 0,
    };
  }
  // ONE filed-date rule, shared with the activity feed (format.latestFiling):
  // max filed_date, ties to the LARGEST accession — the same direction
  // views.sql's restatement-survivor predicate resolves a tie in.
  const ordered = [...refs].sort((a, b) =>
    a.filed_date === b.filed_date
      ? a.accession < b.accession
        ? -1
        : 1
      : a.filed_date < b.filed_date
        ? -1
        : 1,
  );
  const latest = latestFiling(ordered)!;
  const period = latest.period_of_report || fallbackPeriod || null;
  return {
    periodOfReport: period,
    filedDate: latest.filed_date || null,
    lagDays: reportingLagDays(period, latest.filed_date || null),
    docUrl: latest.doc_url,
    accessions: ordered.map((r) => r.accession),
    submissionTypes: ordered.map((r) => r.submission_type),
    known: missing === 0,
    filingCount: refs.length,
  };
}

/** DualDate for 13F (G2): quarter-end AND filed date AND the elapsed lag, all
    three in the accessibility tree at every breakpoint. No `.mobile-dates`
    swap here — that pattern hides one date per viewport, and a table that
    scrolls in-container does not need it. */
export function provenanceCellHtml(p: Provenance): string {
  const period = p.periodOfReport ?? "—";
  const filed = p.filedDate ?? "not in this build's filing dictionary";
  const lag =
    p.lagDays == null
      ? `<span class="lag" title="filed date unknown for this row, so the lag cannot be computed">lag —</span>`
      : p.lagDays < 0
        ? `<span class="lag lag-anomaly" title="filed before the quarter it reports">filed ${esc(
            String(Math.abs(p.lagDays)),
          )}d before quarter-end</span>`
        : `<span class="lag">+${esc(String(p.lagDays))}d</span>`;
  const composed =
    p.filingCount > 1
      ? `<span class="mono-note" title="${esc(
          `composed from ${p.filingCount} filings: ${p.accessions.join(", ")}`,
        )}">composed · ${esc(String(p.filingCount))} filings</span>`
      : "";
  const unknown = p.known
    ? ""
    : `<span class="flag dashed">filing not in dictionary</span>`;
  return (
    `<span class="mono-note"><span class="visually-hidden">quarter ended </span>${esc(period)}</span> ` +
    `<span class="mono-note"><span class="visually-hidden">filed </span>filed ${esc(filed)}</span> ` +
    lag +
    (composed ? ` ${composed}` : "") +
    (unknown ? ` ${unknown}` : "")
  );
}

/* ================================================================ page-level */

/** One page algorithm, two call sites (positions and changes). Deliberately not
    a second selection rule — `docs/pagination-and-counts.md` records three
    consecutive defects in this repo's other paginator, every one of them a
    function reasoning about WHERE rows sit from parameters describing only HOW
    MANY exist. The formula is safe here and NOT in the feed because this
    population is homogeneous: there is no second grain riding along whose
    position decides the page count. */
export const HOLDINGS_PAGE_SIZE = 100;

/** 0 for an empty set — never a padded blank page that a caller would render as
    "no positions" (invariant I2 of the pagination spec). */
export function holdingsPageCount(rowCount: number): number {
  if (!Number.isFinite(rowCount) || rowCount <= 0) return 0;
  return Math.ceil(rowCount / HOLDINGS_PAGE_SIZE);
}

export function holdingsPageSlice<T>(rows: readonly T[], page: number): T[] {
  if (!Number.isFinite(page) || page < 0) return [];
  const start = page * HOLDINGS_PAGE_SIZE;
  if (start >= rows.length) return [];
  return rows.slice(start, start + HOLDINGS_PAGE_SIZE);
}

/** The range line for the page it describes. `rowsOnPage` is page-local on
    purpose (invariant I5): deriving the high bound from `page × PAGE_SIZE`
    arithmetic is exactly what produced "51–50 of 50" in the feed. */
export function holdingsRangeText(opts: {
  page: number;
  rowsOnPage: number;
  matched: number;
  noun?: string;
}): string {
  const noun = opts.noun ?? "positions";
  if (opts.matched === 0) return `0 ${noun}`;
  if (opts.rowsOnPage === 0) return `no ${noun} on this page of ${fmtInt(opts.matched)}`;
  const lo = opts.page * HOLDINGS_PAGE_SIZE + 1;
  const hi = Math.min(lo + opts.rowsOnPage - 1, opts.matched);
  return `${fmtInt(lo)}–${fmtInt(hi)} of ${fmtInt(opts.matched)} ${noun}`;
}

/** Page bytes are a published budget too (§12.1): the whole list is embedded for
    client paging, so an outlier book — the measured 37,140-position filer — must
    not turn one page into megabytes. Rows past the cap are NOT dropped quietly:
    `holdingsTableHtml` prints a terminus row naming the exact number withheld
    and where the rest live (G3). */
export const HOLDINGS_EMBED_ROW_CAP = 20_000;

/** The embedded payload's byte ceiling, MEASURED in UTF-8 BYTES on the serialized JSON.

    QA M2-8 M8: the row cap alone was byte-unaware while its own comment
    justified it as "the page byte budget caps the embed". At a measured
    316 B/row, 20,000 rows is ~6.0 MiB — applied per period for two periods, that
    is ~12.1 MiB of inline JSON in a single filer page, for the named
    37,140-position outlier. Meanwhile the sibling module in this same increment
    refuses to exceed 2 MiB per shard and states that bytes are "MEASURED …
    never estimated from a row count". Two page-budget philosophies in one
    increment; this is the one that measures.

    2 MiB per period matches `inst_budget.PAGE_BYTE_LIMIT` — the same ceiling the
    activity shards use, for the same reason. */
export const HOLDINGS_EMBED_BYTE_CAP = 2 * 1024 * 1024;

/** Cap an embedded row list by BOTH row count and serialized bytes, whichever
    binds first — and report which one did, so the terminus row can say why.

    Rows past the cap are NOT dropped quietly: `holdingsTableHtml` prints a
    terminus row naming the exact number withheld and where the rest live (G3).

    Bytes are measured by filling: rows are added until the next one would not
    fit, exactly as `activity.paginateActivity` does. Measuring the whole list
    and slicing proportionally would be an estimate again. */
/** UTF-8 byte length of an already-serialized row.

    Codex F5: the fill below measured `encoded.length` — UTF-16 CODE UNITS —
    while `HOLDINGS_EMBED_BYTE_CAP` is declared and documented as a BYTE
    ceiling. Every non-ASCII character in an issuer name (13F filers hold
    plenty of foreign issuers) costs 2–3 UTF-8 bytes but counts as one unit,
    so the embed could exceed its own declared budget while the cap reported
    itself satisfied. The ASCII fast path keeps the common case allocation-free;
    only a row that actually contains non-ASCII pays for the encode. */
const UTF8 = new TextEncoder();
export function utf8ByteLength(text: string): number {
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) > 0x7f) return UTF8.encode(text).byteLength;
  }
  return text.length;
}

export function capRows<T>(
  rows: readonly T[],
  cap = HOLDINGS_EMBED_ROW_CAP,
  byteCap = HOLDINGS_EMBED_BYTE_CAP,
): { rows: T[]; total: number; bytes: number; boundBy: "rows" | "bytes" | null } {
  const limit = Math.min(cap, rows.length);
  const out: T[] = [];
  // 2 for the enclosing `[]`; each subsequent element adds its own separator.
  let bytes = 2;
  let boundBy: "rows" | "bytes" | null = null;
  for (let i = 0; i < limit; i++) {
    const encoded = JSON.stringify(rows[i]);
    const next =
      bytes + (encoded === undefined ? 4 : utf8ByteLength(encoded)) + (out.length ? 1 : 0);
    if (next > byteCap && out.length > 0) {
      boundBy = "bytes";
      break;
    }
    out.push(rows[i]!);
    bytes = next;
  }
  if (boundBy === null && out.length < rows.length) boundBy = "rows";
  return { rows: out, total: rows.length, bytes, boundBy };
}

/** Deterministic display order: disclosed value descending, undisclosed values
    LAST (they are not "smallest" — they are unknown), then a stable key. Two
    builds of one corpus must paginate identically. */
/** Exported so the ANTISYMMETRY property can be asserted on the comparator itself.
    Routing that assertion through `sort` does not work: V8 binary-insertion-sorts
    short arrays and happens to preserve input order even when the comparator
    answers 1 to both cmp(a,b) and cmp(b,a), so a sort-level test passes under the
    defect (measured — the mutation survived it). The invariant is a property of
    this function, and that is where it is now pinned. */
export function compareHoldingRows(a: FilerHoldingRow, b: FilerHoldingRow): number {
  {
    if (a.value_usd == null && b.value_usd != null) return 1;
    if (b.value_usd == null && a.value_usd != null) return -1;
    if (a.value_usd != null && b.value_usd != null && a.value_usd !== b.value_usd) {
      return b.value_usd - a.value_usd;
    }
    if (a.issuer_name !== b.issuer_name) return a.issuer_name < b.issuer_name ? -1 : 1;
    const ia = positionIdentity(a);
    const ib = positionIdentity(b);
    // Equal identities MUST tie. `positionIdentity` is called here without a
    // rowIndex, so two unkeyable rows of one period and grain both render
    // `unkeyable:<period>:?|<grain>` — identical. Returning 1 for that pair made
    // cmp(a,b) === cmp(b,a) === 1, a non-antisymmetric comparator whose result is
    // implementation-defined. Tying instead defers to Array#sort's guaranteed
    // stability (ES2019), which preserves the artifact's own `ORDER BY period,
    // rowid` — so "two builds paginate identically" holds by construction rather
    // than by luck of the engine's sort.
    if (ia === ib) return 0;
    return ia < ib ? -1 : 1;
  }
}

export function sortHoldingRows(rows: readonly FilerHoldingRow[]): FilerHoldingRow[] {
  return [...rows].sort(compareHoldingRows);
}

/** See `compareHoldingRows` for why this is exported rather than inlined. */
export function compareHolderRows(a: IssuerHolderRow, b: IssuerHolderRow): number {
  {
    if (a.value_usd == null && b.value_usd != null) return 1;
    if (b.value_usd == null && a.value_usd != null) return -1;
    if (a.value_usd != null && b.value_usd != null && a.value_usd !== b.value_usd) {
      return b.value_usd - a.value_usd;
    }
    if (a.filer_name !== b.filer_name) return a.filer_name < b.filer_name ? -1 : 1;
    // Same antisymmetry rule as `sortHoldingRows`. Two rows sharing a filer_key
    // are not expected on one issuer-period — the producer's grain is one row per
    // issuer x period x filer — but "not expected" is not "cannot", and an
    // unexpected duplicate must not silently make display order engine-dependent.
    if (a.filer_key === b.filer_key) return 0;
    return a.filer_key < b.filer_key ? -1 : 1;
  }
}

export function sortHolderRows(rows: readonly IssuerHolderRow[]): IssuerHolderRow[] {
  return [...rows].sort(compareHolderRows);
}

export function pagerHtml(opts: {
  page: number;
  pageCount: number;
  rangeText: string;
  idPrefix: string;
}): string {
  const hasPrev = opts.page > 0;
  const hasNext = opts.page + 1 < opts.pageCount;
  const btn = (id: string, label: string, live: boolean): string =>
    `<button class="pager-btn${live ? "" : " is-unavailable"}" id="${esc(id)}"` +
    ` data-holdings-page="${id.endsWith("prev") ? "prev" : "next"}"` +
    ` aria-disabled="${live ? "false" : "true"}">${label}</button>`;
  return (
    `<div class="pager">` +
    `<span class="pager-range" id="${esc(opts.idPrefix)}-range" tabindex="-1">${esc(
      opts.rangeText,
    )} · page ${fmtInt(opts.page + 1)} of ${fmtInt(Math.max(opts.pageCount, 1))}</span>` +
    btn(`${opts.idPrefix}-prev`, "← previous", hasPrev) +
    btn(`${opts.idPrefix}-next`, "next →", hasNext) +
    `</div>`
  );
}

/* ====================================================== positions and diffs */

/** Grain of a position within one period: the reference into `agg_qoq_deltas` is
    `(cik, position_key, put_call, ssh_prnamt_type, period)`, so the identity a
    diff may key on is exactly that tuple minus cik/period. */
/** The producer's grain tokens, mirrored from `inst_agg._put_call_bucket` /
    `_unit_key`. Used ONLY when a shard does not carry them; the artifact does. */
export function derivePutCallBucket(putCall: string | null): string {
  return putCall === "PUT" || putCall === "CALL" ? putCall : "LONG";
}

export function deriveUnitKey(sshType: string | null): string {
  return sshType === "SH" || sshType === "PRN" ? sshType : "UNKNOWN";
}

export function positionIdentity(
  row: Pick<FilerHoldingRow, "position_key" | "put_call" | "ssh_type"> & {
    period?: string;
    put_call_bucket?: string | null;
    unit_key?: string | null;
  },
  /** index within the row list — used ONLY to give an unkeyable row a private
      identity, so it can never collide with another row */
  rowIndex?: number,
): string {
  if (row.position_key == null) {
    // An unkeyable holding has no cross-quarter handle, so it has no shared
    // identity either. Giving it a synthetic per-row identity keeps it VISIBLE
    // in the table (G3 — nothing is dropped) while making it impossible to fold
    // with anything else or to match across periods. `unkeyable:` is not a
    // position_key namespace the producer emits, so it cannot collide with one.
    //
    // The PERIOD is part of the synthetic key because `foldPositions` runs once
    // per side of the diff and each side indexes from 0: without it, the first
    // unkeyable row of the current quarter and the first of the prior quarter
    // both keyed `unkeyable:0` and were matched to each other — reintroducing
    // the same fold across quarters that this branch exists to prevent.
    return `unkeyable:${row.period ?? "?"}:${rowIndex ?? "?"}|${grainOf(row)}`;
  }
  return `${row.position_key}|${grainOf(row)}`;
}

/** The grain half of a position identity, PREFERRING the producer's own tokens.

    `serving_filer_rows.put_call_bucket` and `.unit_key` were produced and read
    by nothing while this file recomputed the same discriminators independently
    — so a normalization change on the producer side would have desynchronized
    this table's diff grain from `agg_qoq_deltas`'s, silently. Reading them is
    what makes the two one rule. */
function grainOf(row: {
  put_call?: string | null;
  ssh_type?: string | null;
  put_call_bucket?: string | null;
  unit_key?: string | null;
}): string {
  const bucket = row.put_call_bucket ?? derivePutCallBucket(row.put_call ?? null);
  const unit = row.unit_key ?? deriveUnitKey(row.ssh_type ?? null);
  return `${bucket}|${unit}`;
}

/** Whether a folded position came from rows the producer could not key. */
export function isUnkeyable(identity: string): boolean {
  return identity.startsWith("unkeyable:");
}

export interface FoldedPosition {
  identity: string;
  /** NULL for an unkeyable holding — see `positionIdentity`. */
  position_key: string | null;
  put_call: string | null;
  ssh_type: string | null;
  issuer_name: string;
  title_of_class: string | null;
  cusip: string | null;
  /** NULL when ANY component row was undisclosed — a partial sum presented as a
      total would read as the whole position (mirrors `inst_serving.py`). */
  value_usd: number | null;
  value_undisclosed_component: boolean;
  shares: number | null;
  shares_undisclosed_component: boolean;
  rowCount: number;
  filing_keys: string[];
  flags: string[];
}

/** Fold REPORTED ROWS into POSITIONS. A position composed from a base filing
    plus NEW-HOLDINGS amendments occupies several reported rows; the table shows
    every one of them (completeness, R8) while the diff compares positions. */
export function foldPositions(rows: readonly FilerHoldingRow[]): FoldedPosition[] {
  const out = new Map<string, FoldedPosition>();
  let index = 0;
  for (const row of rows) {
    const identity = positionIdentity(row, index++);
    let pos = out.get(identity);
    if (!pos) {
      pos = {
        identity,
        position_key: row.position_key,
        put_call: row.put_call,
        ssh_type: row.ssh_type,
        issuer_name: row.issuer_name,
        title_of_class: row.title_of_class,
        cusip: row.cusip,
        value_usd: 0,
        value_undisclosed_component: false,
        shares: 0,
        shares_undisclosed_component: false,
        rowCount: 0,
        filing_keys: [],
        flags: [],
      };
      out.set(identity, pos);
    }
    pos.rowCount++;
    if (row.value_usd == null) pos.value_undisclosed_component = true;
    else if (pos.value_usd != null) pos.value_usd += row.value_usd;
    if (row.shares == null) pos.shares_undisclosed_component = true;
    else if (pos.shares != null) pos.shares += row.shares;
    if (row.filing_key != null && !pos.filing_keys.includes(row.filing_key)) {
      pos.filing_keys.push(row.filing_key);
    }
    for (const f of row.flags) if (!pos.flags.includes(f)) pos.flags.push(f);
  }
  for (const pos of out.values()) {
    if (pos.value_undisclosed_component) pos.value_usd = null;
    if (pos.shares_undisclosed_component) pos.shares = null;
    pos.filing_keys.sort();
    pos.flags.sort();
  }
  return [...out.values()];
}

export type DiffKind = "added" | "removed" | "increased" | "decreased" | "unchanged" | "unclassified";

export interface PositionDiffRow {
  identity: string;
  kind: DiffKind;
  current: FoldedPosition | null;
  prior: FoldedPosition | null;
  /** NULL when either side is undisclosed — never a delta against an assumed 0 */
  deltaValueUsd: number | null;
  deltaShares: number | null;
  /** why a delta is absent, printed rather than left blank */
  notes: string[];
}

export interface PositionDiff {
  current: string;
  prior: string;
  rows: PositionDiffRow[];
  counts: Record<DiffKind, number>;
  /** Rows the producer could not key, and which therefore CANNOT be compared
      across quarters. Counted and stated on the page, never folded into another
      row and never presented as an addition or a removal. */
  unkeyableRows: number;
}

/** Compare the selected period against the one before it (OD-5).

    What "removed" means here is stated exactly, because the honest claim is
    narrow: the position is present in the prior period's reported rows and
    ABSENT from the selected period's reported rows. That is not the same as an
    exit — absence is only assertable from an authoritative-full composition
    (plan §B), which is the activity projection's job, not this table's. The
    footnote says so on the page. */
export function diffPeriods(
  currentRows: readonly FilerHoldingRow[],
  priorRows: readonly FilerHoldingRow[],
  periods: { current: string; prior: string },
): PositionDiff {
  const current = new Map(foldPositions(currentRows).map((p) => [p.identity, p]));
  const prior = new Map(foldPositions(priorRows).map((p) => [p.identity, p]));
  const identities = [...new Set([...current.keys(), ...prior.keys()])].sort();
  const counts: Record<DiffKind, number> = {
    added: 0,
    removed: 0,
    increased: 0,
    decreased: 0,
    unchanged: 0,
    unclassified: 0,
  };
  const rows: PositionDiffRow[] = identities.map((identity) => {
    const c = current.get(identity) ?? null;
    const p = prior.get(identity) ?? null;
    const notes: string[] = [];
    let deltaValueUsd: number | null = null;
    let deltaShares: number | null = null;
    let kind: DiffKind;

    if (isUnkeyable(identity)) {
      // Neither a resolved security nor a reported CUSIP, so there is no handle
      // to match on across quarters. Its private identity means it can only ever
      // appear on one side — reporting that as "added" or "absent" would assert
      // a change from the absence of an identifier.
      kind = "unclassified";
      notes.push(
        "the filing carries neither a resolved security nor a CUSIP for this row," +
          " so it cannot be matched across quarters",
      );
    } else if (c && !p) {
      kind = "added";
      if (c.value_usd == null) notes.push("value undisclosed this quarter");
    } else if (!c && p) {
      kind = "removed";
      if (p.value_usd == null) notes.push("value undisclosed in the prior quarter");
    } else if (c && p) {
      if (c.value_usd != null && p.value_usd != null) deltaValueUsd = c.value_usd - p.value_usd;
      else notes.push("value undisclosed on one side of the pair");
      if (c.shares != null && p.shares != null) deltaShares = c.shares - p.shares;
      else notes.push("shares undisclosed on one side of the pair");
      if (c.ssh_type !== p.ssh_type) {
        // SH↔PRN is a unit change, not a size change; a share delta across it
        // would be arithmetic on two different units.
        deltaShares = null;
        notes.push("reported unit changed across the pair — the share delta is withheld");
      }
      if (deltaValueUsd != null && deltaValueUsd > 0) kind = "increased";
      else if (deltaValueUsd != null && deltaValueUsd < 0) kind = "decreased";
      else if (deltaValueUsd === 0 && (deltaShares == null || deltaShares === 0)) kind = "unchanged";
      else if (deltaValueUsd === 0 && deltaShares != null && deltaShares !== 0) {
        kind = deltaShares > 0 ? "increased" : "decreased";
      } else if (deltaShares != null && deltaShares !== 0) {
        kind = deltaShares > 0 ? "increased" : "decreased";
      } else kind = "unclassified";
    } else {
      kind = "unclassified";
    }
    counts[kind]++;
    return { identity, kind, current: c, prior: p, deltaValueUsd, deltaShares, notes };
  });
  return {
    current: periods.current,
    prior: periods.prior,
    rows,
    counts,
    unkeyableRows: identities.filter(isUnkeyable).length,
  };
}

/* ========================================================= value accounting */

export interface ValueTotals {
  /** sum over DISCLOSED values only */
  disclosedUsd: number;
  disclosedRows: number;
  /** rows whose value the manager did not disclose — counted, never zero-filled */
  undisclosedRows: number;
  rows: number;
}

/** Sums `value_usd` and nothing else. `issuer_dedup_total_usd` answers a
    different question and is never added here — see the module header. */
export function sumDisclosedValue(rows: readonly { value_usd: number | null }[]): ValueTotals {
  let disclosedUsd = 0;
  let disclosedRows = 0;
  let undisclosedRows = 0;
  for (const r of rows) {
    if (r.value_usd == null) undisclosedRows++;
    else {
      disclosedUsd += r.value_usd;
      disclosedRows++;
    }
  }
  return { disclosedUsd, disclosedRows, undisclosedRows, rows: rows.length };
}

/* ================================================ holders: resolution + copy */

/** As-of resolution: the row's issuer key came from an ENTITY link, i.e. the
    security resolved to an issuer identity valid AS OF the reporting period
    (G14 — no CUSIP→current-ticker time travel). `cusip6:` and `name:` keys are
    weaker claims: they group rows that probably belong to one issuer without
    asserting it, so they are counted beside the table, never inside it. */
export function isAsOfResolved(row: Pick<IssuerHolderRow, "issuer_key" | "issuer_key_source">): boolean {
  if (row.issuer_key_source) return row.issuer_key_source === "entity";
  return row.issuer_key.startsWith("entity:");
}

export interface CoverageCounters {
  resolvedRows: number;
  resolvedValueUsd: number;
  resolvedUndisclosedRows: number;
  unresolvedRows: number;
  unresolvedValueUsd: number;
  unresolvedUndisclosedRows: number;
}

export interface HolderCoverage extends CoverageCounters {
  period: string;
  /** integer basis points of DISCLOSED value that resolved to an issuer
      identity; NULL when there is no disclosed value to divide by — never a
      fabricated 100% (the same rule as `topn_share_bps`) */
  coverageBps: number | null;
}

/** The coverage RULE, in exactly one place.

    Two things feed it: the row walk below (small inputs, tests) and a GROUP BY
    over `serving_issuer_holder_rows` (a full-universe corpus is millions of
    rows and must not be pulled into memory to be counted). Both hand their
    counters here, so the corpus path can never grow a second, untested version
    of the ratio, the rounding, or the NULL rule. */
export function coverageFromCounters(c: CoverageCounters, period: string): HolderCoverage {
  const denom = c.resolvedValueUsd + c.unresolvedValueUsd;
  return {
    period,
    ...c,
    coverageBps: denom > 0 ? Math.round((c.resolvedValueUsd * 10_000) / denom) : null,
  };
}

/** Coverage is computed over EVERY holder row in the build for the period, not
    over the issuer's own rows: an unresolved row is by definition not attached
    to an issuer, so it can only be counted corpus-wide. That is the honest
    denominator for "is this list a census?" — and the answer is no. */
export function holderCoverage(rows: readonly IssuerHolderRow[], period: string): HolderCoverage {
  const inPeriod = rows.filter((r) => r.period === period);
  const resolved = inPeriod.filter(isAsOfResolved);
  const unresolved = inPeriod.filter((r) => !isAsOfResolved(r));
  const r = sumDisclosedValue(resolved);
  const u = sumDisclosedValue(unresolved);
  return coverageFromCounters(
    {
      resolvedRows: resolved.length,
      resolvedValueUsd: r.disclosedUsd,
      resolvedUndisclosedRows: r.undisclosedRows,
      unresolvedRows: unresolved.length,
      unresolvedValueUsd: u.disclosedUsd,
      unresolvedUndisclosedRows: u.undisclosedRows,
    },
    period,
  );
}

export function coveragePctText(bps: number | null): string {
  return bps == null ? "n/a" : `${(bps / 100).toFixed(2)}%`;
}

/* ---------- the unqualified-"all" ban (R12) ---------- */

/** Identity coverage is high and NOT 100%, so "all holders" is a false claim on
    every surface built from it. This is the mechanism, not a style note: the
    word may appear only inside an explicitly qualified phrase.

    Returns each offending occurrence with context so a failure names the copy
    that broke the rule. Tags are stripped first — a class name containing "all"
    is not a claim to a reader. */
const ALL_QUALIFIERS = ["as-of-resolved", "resolved", "disclosed", "reported"];

export function unqualifiedAllClaims(html: string): string[] {
  // Attribute channels are read too — `title` / `aria-label` / `alt` are spoken
  // to a screen reader and shown on hover, so an unqualified "all" inside one is
  // exactly as much of a claim as one in the body. The sibling scanner in
  // `activity.ts` already did this; stripping tags first (as this did) deleted
  // those channels along with the markup. Zero live hits today — the asymmetry
  // was the defect, not a current violation.
  const attrs = [...html.matchAll(/(?:title|aria-label|alt)="([^"]*)"/g)]
    .map((m) => m[1]!)
    .join(" ");
  const text = (html + " " + attrs)
    .replace(/<[^>]*>/g, " ")
    .replace(/&[a-z]+;/gi, " ")
    .replace(/\s+/g, " ");
  const out: string[] = [];
  const re = /\ball\b/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const rest = text.slice(m.index + m[0].length);
    // "all-in", "all-time": a hyphenated compound is a different word, not a
    // claim about coverage.
    if (rest.startsWith("-")) continue;
    const after = rest.slice(0, 40).trimStart().toLowerCase();
    if (ALL_QUALIFIERS.some((q) => after.startsWith(q))) continue;
    out.push(text.slice(Math.max(0, m.index - 30), m.index + 50).trim());
  }
  return out;
}

/* ================================================================ renderers */

export const HOLDINGS_FOOTNOTES: FootnoteEntry[] = [
  {
    mark: "§",
    html:
      `served from this build's published holdings projection (derived from the filer's own ` +
      `reported rows); every row resolves to a filing through the shard's filing dictionary`,
  },
  {
    mark: "†u",
    html: `value undisclosed on the filing: retained and counted, excluded from sums, never shown as $0`,
  },
  {
    mark: "‡a",
    html:
      `"absent" means the position is in the prior quarter's reported rows and not in the ` +
      `selected quarter's. The filings do not say why: the manager may no longer hold it, the ` +
      `position may now sit in an affiliated manager's report, or it may be under confidential ` +
      `treatment until a later amendment discloses it`,
  },
  {
    mark: "‡c",
    html: `a position composed from a base filing plus NEW-HOLDINGS amendments keeps every source row here; the composition's latest filed date is the one shown`,
  },
];

function valueCell(value: number | null, undisclosedNote = "value not disclosed on the filing"): string {
  if (value == null) {
    return (
      `<span class="mono-note" title="${esc(undisclosedNote)}">undisclosed</span>` +
      `<a class="fn-ref" href="#holdings-footnotes" aria-label="footnote †u">†u</a>`
    );
  }
  return esc(fmtUsd(value));
}

function sharesCell(shares: number | null, unit: string | null): string {
  const unitNote =
    unit === "PRN" ? " PRN" : unit === "SH" || unit == null ? "" : ` ${esc(String(unit))}`;
  if (shares == null) {
    return `<span class="mono-note" title="share/principal amount not disclosed or not parseable">—</span>`;
  }
  return `${fmtInt(shares)}<span class="mono-note">${unitNote}</span>`;
}

/* ------------------- the filer budget + the ONE href primitive (R22) ------ */

/** Where a filer's page lives under the LD-7 budget: "top" = one of the 1,500
    pre-rendered pages; "tail" = addressable through the `/e/` driver via the
    routing index + shard family. Carried on payload seams so a client renderer
    can produce the same href the SSR did. */
export type FilerBudgetState = "top" | "tail";

/** LD-7: the pre-rendered filer page budget. A hard contract number, mirrored
    by `inst_budget.M2_FILER_PAGES` — the projection and the route must agree. */
export const FILER_PAGE_BUDGET = 1_500;

export interface FilerSelectionInput {
  cik: string;
  /** The filer's LATEST-PERIOD reported total value (LD-7 — from the period
      concentration row, NOT the registry's cumulative all-period total). NULL
      when the period has no concentration row; nulls sort after every number,
      because an unknown total is not a small one. */
  latestPeriodValueUsd: number | null;
}

/** LD-7, in exactly one place: descending latest-period reported total value,
    ties broken by ASCENDING CIK, cut at the budget. Used by BOTH the
    `[cik].astro` route's `getStaticPaths` and the link-producer seam
    (`data.ts` tiers), so the pages that exist and the links that point at them
    cannot disagree. Deterministic: two builds of one corpus select the same
    1,500. Exported so the determinism and the boundary (rank 1,500 vs 1,501)
    are pinned by tests. */
export function selectTopFilers(
  rows: readonly FilerSelectionInput[],
  budget = FILER_PAGE_BUDGET,
): string[] {
  const ordered = [...rows].sort((a, b) => {
    const av = a.latestPeriodValueUsd;
    const bv = b.latestPeriodValueUsd;
    if (av == null && bv != null) return 1;
    if (bv == null && av != null) return -1;
    if (av != null && bv != null && av !== bv) return bv - av;
    return a.cik < b.cik ? -1 : a.cik > b.cik ? 1 : 0;
  });
  return ordered.slice(0, budget).map((r) => r.cik);
}

/** THE filer-href decision primitive (R22): CIK + budget state → the canonical
    page href (top) or the `/e/` driver href (tail). Every link producer routes
    through here — a sweep test fails any unconditional
    `/institutional/filers/` literal outside this module. The tail href uses
    the `f:` entity key `derive.parseEntityKey` already accepts (it pads the
    CIK itself), so the driver and this primitive speak the same key. */
export function filerHref(cik: string, state: FilerBudgetState): string {
  const unpadded = String(Number(cik));
  if (state === "top") return `/institutional/filers/${unpadded}/`;
  return `/e/?k=f:${unpadded}`;
}

/** A link to a filer surface, or plain text when the key cannot address one.

    `String(Number(key))` renders "NaN" for a non-numeric key, producing
    `/institutional/filers/NaN/` — a URL `getStaticPaths` never emits, i.e. a 404
    dressed as a link. `filer_key` is a zero-padded CIK by producer contract and
    the route is the unpadded integer, so the coercion is right for every key the
    producer writes; this makes the failure mode visible instead of linking into
    nothing. Exported so the activity feed uses the same rule.

    `tier` decides top vs tail through `filerHref` (R22). It defaults to "tail"
    deliberately: the `/e/` shell is prerendered and never 404s, so an unknown
    tier degrades to a reachable page — the safe direction — while a "top"
    default would dress a 404 as a link for every tail filer. */
export function filerLinkHtml(
  filerKey: string,
  filerName: string,
  tier: FilerBudgetState = "tail",
): string {
  const cik = Number(filerKey);
  if (!Number.isFinite(cik) || !/^\d+$/.test(filerKey.trim())) {
    return (
      `<span title="this row's filer key is not a CIK, so it addresses no filer page">` +
      `${esc(filerName)}</span>`
    );
  }
  return `<a href="${esc(filerHref(filerKey, tier))}">${esc(filerName)}</a>`;
}

function positionCell(row: {
  issuer_name: string;
  title_of_class: string | null;
  cusip: string | null;
  put_call: string | null;
  position_key: string | null;
}): string {
  const grain = row.put_call && row.put_call !== "LONG" ? ` · ${esc(row.put_call)}` : "";
  /* `filed-name` marks a string that came VERBATIM off a filing. It is not
     styling — the §0 banned-wording scan redacts these before matching, because
     the ban exists to stop THIS SITE adopting a market-narrative voice and a
     security lawfully named "Bullish" is not this site's voice. Marking it at
     the render site keeps the exemption auditable: the scanner never has to
     guess which strings are ours. */
  const cls = row.title_of_class
    ? ` · <span class="filed-name">${esc(row.title_of_class)}</span>`
    : "";
  const cusip = row.cusip
    ? `<span class="mono-note">CUSIP ${esc(row.cusip)}</span>`
    : `<span class="mono-note" title="no CUSIP on the reported row">CUSIP —</span>`;
  return (
    (row.issuer_name
      ? `<span class="filed-name">${esc(row.issuer_name)}</span>`
      /* our own fallback copy is NOT filed text and stays scannable */
      : `<span>(issuer name not on the filing)</span>`) +
    `<span class="mono-note">${cls}${grain}</span> ${cusip}`
  );
}

export interface HoldingsTableOpts {
  cik: string;
  filerName: string;
  period: string;
  rows: readonly FilerHoldingRow[];
  filings: FilingDict;
  page: number;
  /** total reported rows for the period BEFORE any embed cap, so a capped page
      still states the true total (G3) */
  totalRows?: number;
}

/** The filer's reported position list for one period, paginated. */
export function holdingsTableHtml(opts: HoldingsTableOpts): string {
  const matched = opts.rows.length;
  const total = opts.totalRows ?? matched;
  const pageRows = holdingsPageSlice(opts.rows, opts.page);
  const pageCount = holdingsPageCount(matched);
  const totals = sumDisclosedValue(opts.rows);
  /* Over `opts.rows` — the FULL bounded set — not `pageRows`. Computing from the
     visible page lets the caveat appear on page 0 and vanish on page 1 for the
     same table, which is precisely the contradiction the entity table's version
     was written to avoid; wiring these later, I reintroduced it. */
  const statedHoldings = universalFlags(opts.rows.map((r) => r.flags));
  const body = pageRows
    .map((row) => {
      const prov = provenanceOf([row.filing_key], opts.filings, row.period);
      const src = prov.docUrl
        ? srcLink(prov.docUrl)
        : srcLinkDerived("#holdings-footnotes", edgarFilerUrl(opts.cik));
      return (
        `<tr>` +
        `<td class="c-pos">${positionCell(row)}</td>` +
        `<td class="c-num c-strong">${valueCell(row.value_usd)}</td>` +
        `<td class="c-num">${sharesCell(row.shares, row.ssh_type)}</td>` +
        `<td class="c-dates">${provenanceCellHtml(prov)}</td>` +
        `<td class="c-flags">${flagTags(row.flags, undefined, { stated: statedHoldings })}</td>` +
        `<td class="c-src">${src}</td>` +
        `</tr>`
      );
    })
    .join("\n");

  const rangeText = holdingsRangeText({ page: opts.page, rowsOnPage: pageRows.length, matched });
  const emptyNote =
    matched === 0
      ? `<p class="section-note">This build's holdings projection carries no reported rows for ` +
        `${esc(opts.period)}. That is a statement about this build, not about the filer.</p>`
      : "";
  const truncation =
    total > matched
      ? terminusRow({
          author: "populus",
          html:
            `${fmtInt(total - matched)} of this filer's ${fmtInt(total)} reported rows for ` +
            `${esc(opts.period)} are not embedded in this page — the page byte budget caps the ` +
            `embed. The rows exist in the published projection and in the filer's own filings; ` +
            `the EDGAR link beside each row opens the source document.`,
        })
      : "";

  // A sum over zero disclosed values is not "$0 of holdings" — that reads as a
  // number the filer reported. It is the absence of any disclosed value.
  const valueNote =
    totals.disclosedRows === 0
      ? "no disclosed value in these rows"
      : `${fmtUsd(totals.disclosedUsd)} disclosed value over ${fmtInt(totals.disclosedRows)} ${
          totals.disclosedRows === 1 ? "row" : "rows"
        }`;
  return (
    `<div class="panel-head">` +
    `<h2 class="section-h">Reported positions — ${esc(opts.period)}</h2>` +
    `<span class="panel-note">${esc(rangeText)} · ${esc(valueNote)} · ${fmtInt(
      totals.undisclosedRows,
    )} undisclosed-value ${totals.undisclosedRows === 1 ? "row" : "rows"}</span></div>` +
    emptyNote +
    universalFlagNote(statedHoldings) +
    `<div class="table-scroll"><table class="etable" data-sticky-first data-stated-flags="${esc(statedHoldings.join(","))}">` +
    `<caption class="visually-hidden">Positions ${esc(opts.filerName)} reported for the quarter ended ${esc(
      opts.period,
    )}, as that filer reported them</caption>` +
    `<thead><tr><th scope="col">Issuer · class · CUSIP</th><th scope="col">Value</th>` +
    `<th scope="col">Shares · unit</th><th scope="col">Quarter-end · filed · lag</th>` +
    `<th scope="col">Flags</th><th scope="col">Src</th></tr></thead>` +
    `<tbody>${body}</tbody></table></div>` +
    truncation +
    pagerHtml({ page: opts.page, pageCount, rangeText, idPrefix: "holdings" }) +
    `<div class="caveat-line">every row this filer reported for the quarter, as it reported ` +
    `it — cross-filer de-duplication is applied to issuer totals elsewhere and never deletes ` +
    `a row here (plan R8)</div>`
  );
}

function diffChip(kind: DiffKind): string {
  const map: Record<DiffKind, { text: string; cls: string; marker?: string }> = {
    added: { text: "added", cls: "qoq-new" },
    removed: { text: "absent", cls: "qoq-exit", marker: "‡a" },
    increased: { text: "increased", cls: "qoq-add" },
    decreased: { text: "decreased", cls: "qoq-trim" },
    unchanged: { text: "unchanged", cls: "qoq-nc" },
    unclassified: { text: "n/c", cls: "qoq-nc" },
  };
  const m = map[kind];
  const marker = m.marker
    ? `<a class="fn-ref" href="#holdings-footnotes" aria-label="footnote ${esc(m.marker)}">${esc(
        m.marker,
      )}</a>`
    : "";
  return `<span class="qoq-chip ${m.cls}">${esc(m.text)}</span>${marker}`;
}

/** The explicit added / absent / changed view between the two browsable
    periods (OD-5). Paginated by the SAME algorithm as the position table. */
export function positionDiffHtml(diff: PositionDiff, page: number): string {
  const matched = diff.rows.length;
  const pageRows = holdingsPageSlice(diff.rows, page);
  const pageCount = holdingsPageCount(matched);
  const num = (v: number | null): string =>
    v == null ? `<span class="mono-note">—</span>` : esc(fmtUsd(v));
  const delta = (v: number | null, notes: string[]): string => {
    if (v == null) {
      return notes.length > 0
        ? `<span class="nc-chip" title="${esc(notes.join("; "))}">n/c</span>`
        : `<span class="mono-note">—</span>`;
    }
    return esc(`${v > 0 ? "+" : ""}${fmtUsd(v)}`);
  };
  const body = pageRows
    .map((r) => {
      const shown = r.current ?? r.prior!;
      const shares = (p: FoldedPosition | null): string =>
        p == null ? `<span class="mono-note">—</span>` : sharesCell(p.shares, p.ssh_type);
      return (
        `<tr>` +
        `<td class="c-pos">${positionCell(shown)}</td>` +
        `<td class="c-num">${num(r.prior?.value_usd ?? null)}</td>` +
        `<td class="c-num">${num(r.current?.value_usd ?? null)}</td>` +
        `<td class="c-num">${delta(r.deltaValueUsd, r.notes)}</td>` +
        `<td class="c-num">${shares(r.prior)}</td>` +
        `<td class="c-num">${shares(r.current)}</td>` +
        `<td class="c-chip">${diffChip(r.kind)}</td>` +
        `<td class="c-flags">${
          r.notes.length === 0
            ? ""
            : r.notes.map((n) => `<span class="flag dashed">${esc(n)}</span>`).join("")
        }</td>` +
        `</tr>`
      );
    })
    .join("\n");
  const rangeText = holdingsRangeText({
    page,
    rowsOnPage: pageRows.length,
    matched,
    noun: "compared positions",
  });
  return (
    `<div class="panel-head">` +
    `<h2 class="section-h">${esc(diff.prior)} → ${esc(diff.current)} — added, absent, changed</h2>` +
    `<span class="panel-note">${esc(rangeText)} · ${fmtInt(diff.counts.added)} added · ${fmtInt(
      diff.counts.removed,
    )} absent · ${fmtInt(diff.counts.increased)} increased · ${fmtInt(
      diff.counts.decreased,
    )} decreased · ${fmtInt(diff.counts.unchanged)} unchanged · ${fmtInt(
      diff.counts.unclassified,
    )} not classifiable</span></div>` +
    (matched === 0
      ? `<p class="section-note">No positions to compare: this build's projection carries rows ` +
        `for at most one of the two quarters.</p>`
      : `<div class="table-scroll"><table class="etable" data-sticky-first>` +
        `<caption class="visually-hidden">Positions compared between the quarters ended ${esc(
          diff.prior,
        )} and ${esc(diff.current)}</caption>` +
        `<thead><tr><th scope="col">Issuer · class · CUSIP</th>` +
        `<th scope="col">${esc(diff.prior)} value</th><th scope="col">${esc(diff.current)} value</th>` +
        `<th scope="col">Δ value</th><th scope="col">${esc(diff.prior)} shares</th>` +
        `<th scope="col">${esc(diff.current)} shares</th><th scope="col">Change</th>` +
        `<th scope="col">Why not quantified</th></tr></thead>` +
        `<tbody>${body}</tbody></table></div>`) +
    pagerHtml({ page, pageCount, rangeText, idPrefix: "holdings-diff" }) +
    (diff.unkeyableRows > 0
      ? `<p class="section-note">${fmtInt(diff.unkeyableRows)} reported ${
          diff.unkeyableRows === 1 ? "row carries" : "rows carry"
        } neither a resolved security nor a CUSIP, so ${
          diff.unkeyableRows === 1 ? "it cannot" : "they cannot"
        } be matched across quarters. ${
          diff.unkeyableRows === 1 ? "It is" : "They are"
        } listed as not quantified and excluded from every added/absent/changed ` +
        `count — never merged with another position.</p>`
      : "") +
    `<div class="caveat-line">both quarters are the filer's own reported rows; "absent" ` +
    `describes the two reported lists, never a transaction — see the ‡a footnote</div>`
  );
}

/* ---------- holders surface (T12) ---------- */

export interface HoldersTableOpts {
  issuerName: string;
  ticker: string;
  period: string;
  rows: readonly IssuerHolderRow[];
  filings: FilingDict;
  page: number;
  totalRows?: number;
}

export function holdersFullTableHtml(opts: HoldersTableOpts): string {
  const matched = opts.rows.length;
  const total = opts.totalRows ?? matched;
  const pageRows = holdingsPageSlice(opts.rows, opts.page);
  const pageCount = holdingsPageCount(matched);
  const body = pageRows
    .map((row) => {
      const prov = provenanceOf(row.filing_keys, opts.filings, row.period);
      const src = prov.docUrl
        ? srcLink(prov.docUrl)
        : srcLinkDerived("#holdings-footnotes", edgarFilerUrl(row.filer_key));
      const affiliate =
        row.affiliate_group_key && row.affiliate_group_key !== row.filer_key
          ? `<span class="mono-note" title="affiliated-manager group for this quarter; affiliates may report the same position">group ${esc(
              row.affiliate_group_key,
            )}</span>`
          : "";
      return (
        `<tr>` +
        `<td class="c-filer">${filerLinkHtml(row.filer_key, row.filer_name, row.filer_tier ?? "tail")} ${affiliate}</td>` +
        `<td class="c-num c-strong">${valueCell(
          row.value_usd,
          row.value_undisclosed_component
            ? "at least one of this filer's positions in the issuer carries no disclosed value, so no total is shown"
            : "value not disclosed on the filing",
        )}</td>` +
        `<td class="c-num">${
          row.security_count == null
            ? `<span class="mono-note" title="the shard carries no security count for this row">—</span>`
            : fmtInt(row.security_count)
        }</td>` +
        `<td class="c-dates">${provenanceCellHtml(prov)}</td>` +
        `<td class="c-src">${src}</td>` +
        `</tr>`
      );
    })
    .join("\n");
  const rangeText = holdingsRangeText({
    page: opts.page,
    rowsOnPage: pageRows.length,
    matched,
    noun: "as-of-resolved holders",
  });
  const truncation =
    total > matched
      ? terminusRow({
          author: "populus",
          html:
            `${fmtInt(total - matched)} of the ${fmtInt(total)} as-of-resolved holder rows for ` +
            `this quarter are not embedded in this page — the page byte budget caps the embed. ` +
            `They exist in the published projection.`,
        })
      : "";
  return (
    `<div class="panel-head">` +
    `<h2 class="section-h">As-of-resolved holders — ${esc(opts.period)}</h2>` +
    `<span class="panel-note">${esc(rangeText)}</span></div>` +
    (matched === 0
      ? `<p class="section-note">This build's projection carries no resolved holder rows for ` +
        `${esc(opts.ticker)} in ${esc(opts.period)}.</p>`
      : `<div class="table-scroll"><table class="etable" data-sticky-first>` +
        `<caption class="visually-hidden">Institutions whose reported 13F holdings resolved to ${esc(
          opts.issuerName,
        )} for the quarter ended ${esc(opts.period)}</caption>` +
        `<thead><tr><th scope="col">Filer</th><th scope="col">Reported value</th>` +
        `<th scope="col">Securities</th><th scope="col">Quarter-end · filed · lag</th>` +
        `<th scope="col">Src</th></tr></thead>` +
        `<tbody>${body}</tbody></table></div>`) +
    truncation +
    pagerHtml({ page: opts.page, pageCount, rangeText, idPrefix: "holders" }) +
    `<div class="caveat-line">one row per (issuer, quarter, filer); values are what each ` +
    `manager reported and are not de-duplicated across affiliates — the de-duplicated issuer ` +
    `total is stated separately beside this table and the two are never added together</div>`
  );
}

/** The unresolved counts and coverage that sit BESIDE the holder table (R12).
    `dedupTotalUsd` is printed in its own labelled line precisely because it must
    never be read as part of the summed column. */
export function coveragePanelHtml(
  coverage: HolderCoverage,
  opts: { ticker: string; issuerName: string; dedupTotalUsd: number | null; shownRows: number },
): string {
  const tiles: StatTile[] = [
    {
      value: fmtInt(opts.shownRows),
      label: "resolved holders listed",
      title: `filers whose reported holdings resolved to this issuer as of ${coverage.period}`,
    },
    {
      value: fmtInt(coverage.unresolvedRows),
      label: "unresolved rows (build-wide)",
      title:
        "holder rows in this quarter whose security identity did not resolve to an issuer as of" +
        " the period; any of them could belong to this issuer, so the list beside them is not a census",
    },
    {
      // QA M2-8 M13: `unresolvedValueUsd` sums DISCLOSED values only. When every
      // unresolved row carries `value_usd IS NULL` the sum is 0, and printing
      // "$0" beside a non-zero unresolved-row count reads as "those rows carry
      // no value" — a claim about the filings, made from their silence. The
      // honest counter was already computed and asserted, and rendered nowhere.
      value:
        coverage.unresolvedValueUsd === 0 && coverage.unresolvedUndisclosedRows > 0
          ? "not disclosed"
          : fmtUsd(coverage.unresolvedValueUsd),
      label: "unresolved value",
      muted: coverage.unresolvedValueUsd === 0 && coverage.unresolvedUndisclosedRows > 0,
      title:
        coverage.unresolvedValueUsd === 0 && coverage.unresolvedUndisclosedRows > 0
          ? "every unresolved row in this quarter carries no disclosed value, so there is no" +
            " sum to state — this is not $0"
          : "reported value carried by those unresolved rows, excluded from the list beside them",
    },
    {
      value: coveragePctText(coverage.coverageBps),
      label: "value coverage",
      muted: coverage.coverageBps == null,
      title:
        coverage.coverageBps == null
          ? "no disclosed value in this quarter to divide by — the producer stores no ratio rather than a fabricated 100%"
          : "share of this quarter's disclosed holder value whose security identity resolved to an issuer as of the period",
    },
  ];
  const dedup =
    opts.dedupTotalUsd == null
      ? `<p class="section-note">De-duplicated issuer total for ${esc(coverage.period)}: ` +
        `<strong>not available</strong> — at least one component value is undisclosed, so no ` +
        `total is asserted rather than a partial sum presented as one.</p>`
      : `<p class="section-note">De-duplicated issuer total for ${esc(coverage.period)}: ` +
        `<strong>${esc(fmtUsd(opts.dedupTotalUsd))}</strong> — the issuer's value counted ONCE ` +
        `across affiliated managers. It answers a different question from the per-filer column ` +
        `beside it, and the two are never added together.</p>`;
  return (
    `<div class="panel-head"><h2 class="section-h">What this list leaves out</h2>` +
    `<span class="panel-note">stated beside the table, not behind it</span></div>` +
    statTiles(tiles, { label: `Identity coverage for ${coverage.period}`, compact: true }) +
    `<p class="section-note">This is every holder of ${esc(opts.issuerName)} that Public Filings could ` +
    `resolve to an issuer identity as of ${esc(coverage.period)} — not a census. ` +
    `${fmtInt(coverage.unresolvedRows)} holder ${
      coverage.unresolvedRows === 1 ? "row" : "rows"
    } in this quarter carry a security whose identity did not resolve as of the period ` +
    `(${
      coverage.unresolvedValueUsd === 0 && coverage.unresolvedUndisclosedRows > 0
        ? "no disclosed value in any of them"
        : esc(fmtUsd(coverage.unresolvedValueUsd)) + " of reported value"
    }); any of them could belong ` +
    `here. Coverage is ${esc(coveragePctText(coverage.coverageBps))} of disclosed value — high, ` +
    `and not 100%.</p>` +
    (coverage.resolvedUndisclosedRows > 0
      ? `<p class="section-note">${fmtInt(coverage.resolvedUndisclosedRows)} listed ${
          coverage.resolvedUndisclosedRows === 1 ? "row carries" : "rows carry"
        } no disclosed value; they are counted here and excluded from every sum, never zero-filled.</p>`
      : "") +
    // The unresolved side's mirror. It was computed (`unresolvedUndisclosedRows`),
    // populated by both the row walk and the SQL, asserted in the tests — and
    // printed by no renderer, while its `resolved` sibling above was.
    (coverage.unresolvedUndisclosedRows > 0
      ? `<p class="section-note">${fmtInt(coverage.unresolvedUndisclosedRows)} unresolved ${
          coverage.unresolvedUndisclosedRows === 1 ? "row carries" : "rows carry"
        } no disclosed value either, so the unresolved value beside them is a partial figure ` +
        `over the rest — not a statement that those rows are worth nothing.</p>`
      : "") +
    dedup +
    `<div class="caveat-line">managers under $100M in 13(f) securities never file, so they ` +
    `cannot appear in any 13F-derived list</div>`
  );
}

/** Header copy for the holders surface. Kept here rather than in the page so
    the unqualified-"all" ban is enforced over the same string the reader sees. */
export function holdersIntroHtml(issuerName: string, period: string): string {
  return (
    `<p class="section-note">Every institution Public Filings could resolve as a holder of ${esc(
      issuerName,
    )} for the quarter ended <strong>${esc(period)}</strong>, from 13F filings — ` +
    `as-of-resolved holders only, with the unresolved remainder counted beside the table. ` +
    `Long positions in Section 13(f) securities; managers under $100M in them never file; ` +
    `quarter-end snapshots, never current holdings.</p>`
  );
}

export function holdingsFootnotesHtml(): string {
  return footnoteBlock(HOLDINGS_FOOTNOTES, { id: "holdings-footnotes" });
}

/* ======================================================== the whole surface */

/** What the page embeds and what the client re-renders from. Both browsable
    periods remain one logical payload; long-tail delivery may reconstruct that
    value from several bounded fragment shards. */
export interface FilerSurfacePayload {
  kind: "filer";
  cik: string;
  filerName: string;
  /** periods the projection actually publishes for this filer, ascending */
  periods: string[];
  current: string;
  prior: string | null;
  filings: FilingDict;
  /** display-ordered and embed-capped */
  rowsByPeriod: Record<string, FilerHoldingRow[]>;
  /** pre-cap totals, so a capped page still states the true number */
  totalsByPeriod: Record<string, number>;
}

export interface HoldersSurfacePayload {
  kind: "holders";
  ticker: string;
  issuerName: string;
  periods: string[];
  current: string;
  filings: FilingDict;
  rowsByPeriod: Record<string, IssuerHolderRow[]>;
  totalsByPeriod: Record<string, number>;
  coverageByPeriod: Record<string, HolderCoverage>;
  /** the DISTINCT de-duplicated issuer total, kept in its own field so no
      renderer can add it to the per-filer column */
  dedupByPeriod: Record<string, number | null>;
}

export type SurfacePayload = FilerSurfacePayload | HoldersSurfacePayload;

export type SurfaceView = "current" | "prior" | "diff";

export interface SurfaceState {
  view: SurfaceView;
  page: number;
  period: string;
}

function viewChips(payload: SurfacePayload, state: SurfaceState): string {
  if (payload.kind !== "filer") return "";
  const chip = (view: SurfaceView, label: string): string =>
    `<button class="chip${state.view === view ? " chip-active" : ""}"` +
    ` data-holdings-view="${view}" aria-pressed="${state.view === view}">${esc(label)}</button>`;
  const prior = payload.prior;
  const hasPrior = prior != null && payload.rowsByPeriod[prior] != null;
  const note = hasPrior
    ? `<span class="period-note">the projection publishes the selected quarter and the one ` +
      `before it, so a displayed change can be inspected on both sides</span>`
    : `<span class="period-note">only ${esc(payload.current)} is in this build's projection for ` +
      `this filer, so there is no prior quarter to browse or compare against</span>`;
  return (
    `<div class="period-row"><span class="period-label">View</span><div class="chips" data-holdings-views>` +
    chip("current", `positions ${payload.current}`) +
    (hasPrior ? chip("prior", `positions ${prior}`) + chip("diff", "added · absent · changed") : "") +
    `</div>` +
    note +
    `<noscript><span class="period-note">switching views and pages needs JavaScript; showing ` +
    `${esc(payload.current)}, page 1</span></noscript></div>`
  );
}

function periodUnavailableHtml(payload: SurfacePayload, period: string): string {
  const published = payload.periods.length === 0 ? "no quarters" : payload.periods.join(", ");
  return (
    `<div class="panel-head"><h2 class="section-h">Positions — ${esc(period)}</h2>` +
    `<span class="panel-note">not in this build's holdings projection</span></div>` +
    `<p class="section-note">This build's holdings projection publishes ${esc(published)}. ` +
    `The aggregate tiles above cover more quarters than the position list does; rather than ` +
    `show one quarter's positions under another quarter's heading, the list stops here.</p>`
  );
}

/** ONE renderer for the SSR page and every client-paged page. The inline pager
    in `components/HoldingsTable.astro` calls exactly this function, so page 2
    cannot drift from page 1 (the repo's SSR/client parity rule). */
export function surfaceHtml(payload: SurfacePayload, state: SurfaceState): string {
  if (payload.kind === "filer") {
    if (state.view === "diff") {
      const prior = payload.prior;
      const priorRows = prior == null ? null : payload.rowsByPeriod[prior];
      const currentRows = payload.rowsByPeriod[payload.current];
      if (prior == null || priorRows == null || currentRows == null) {
        return (
          viewChips(payload, state) +
          `<div class="panel-head"><h2 class="section-h">Added · absent · changed</h2>` +
          `<span class="panel-note">needs two published quarters</span></div>` +
          `<p class="section-note">This build's projection carries one quarter for this filer, ` +
          `so there is nothing to compare it against. A comparison needs both sides.</p>`
        );
      }
      const diff = diffPeriods(currentRows, priorRows, {
        current: payload.current,
        prior,
      });
      return viewChips(payload, state) + positionDiffHtml(diff, state.page);
    }
    const period = state.view === "prior" && payload.prior ? payload.prior : state.period;
    const rows = payload.rowsByPeriod[period];
    if (rows == null) return viewChips(payload, state) + periodUnavailableHtml(payload, period);
    return (
      viewChips(payload, state) +
      holdingsTableHtml({
        cik: payload.cik,
        filerName: payload.filerName,
        period,
        rows,
        filings: payload.filings,
        page: state.page,
        totalRows: payload.totalsByPeriod[period] ?? rows.length,
      })
    );
  }

  const rows = payload.rowsByPeriod[state.period];
  if (rows == null) return periodUnavailableHtml(payload, state.period);
  const coverage =
    payload.coverageByPeriod[state.period] ??
    holderCoverage([], state.period);
  return (
    holdersIntroHtml(payload.issuerName, state.period) +
    `<div class="entity-grid">` +
    `<section class="panel" aria-label="As-of-resolved holders">` +
    holdersFullTableHtml({
      issuerName: payload.issuerName,
      ticker: payload.ticker,
      period: state.period,
      rows,
      filings: payload.filings,
      page: state.page,
      totalRows: payload.totalsByPeriod[state.period] ?? rows.length,
    }) +
    `</section>` +
    `<aside class="panel" aria-label="Identity coverage and what this list leaves out">` +
    coveragePanelHtml(coverage, {
      ticker: payload.ticker,
      issuerName: payload.issuerName,
      dedupTotalUsd: payload.dedupByPeriod[state.period] ?? null,
      shownRows: rows.length,
    }) +
    `</aside>` +
    `</div>`
  );
}

/** The honest state when this build ships no holdings projection at all — the
    surface says so instead of rendering an empty table that reads as "this
    filer reported nothing". */
export function projectionAbsentHtml(kind: "filer" | "holders", edgarUrl: string | null): string {
  const what =
    kind === "filer"
      ? "the per-filer position list"
      : "the resolved holder list";
  return (
    `<div class="panel-head"><h2 class="section-h">${
      kind === "filer" ? "Reported positions" : "Resolved holders"
    }</h2><span class="panel-note">not published in this build</span></div>` +
    `<p class="section-note">This build does not ship the holdings projection, so ${what} is ` +
    `not served here. M2-CONTRACT §3 was amended on 2026-08-02 to serve it; a build that has ` +
    `not published it says so rather than rendering an empty table. The primary source is the ` +
    `filing itself:</p>` +
    (edgarUrl
      ? `<p class="section-note"><a class="cta" href="${esc(
          edgarUrl,
        )}" rel="noopener" target="_blank">Open the 13F filings on SEC EDGAR ↗</a></p>`
      : "")
  );
}

/* ---------- quarter-over-quarter changes: one ordering, one bound ----------

   RUN M2-12. The changes surface had neither of the two bounds its sibling
   above has had since QA M2-8 M8, and the arithmetic is the same: at a measured
   ~373 B/row, the 15,885-row filer embeds 5.9 MiB for ONE period and 20.9 MiB
   across five — 29.1 MiB of page against a 25 MiB provider limit. The only
   tree that ever fitted was hand-edited after the build, with the quarter
   selector removed from exactly those pages; nothing in source produced it.

   The ordering lives here rather than inside `changesTableHtml` because the cap
   must be applied to the SAME order the table renders: capping first and
   sorting after would drop rows the reader most needs to see. One function
   orders, one bounds, and `changesTableHtml` renders what it is handed. */

/** The changes table's canonical ordering: largest current value first, falling
    back to the previous value for an exited position, ties by `position_key` so
    the order is total and a build is reproducible. */
/** The comparator itself, EXPORTED (Codex F3).

    It was inline, so the only way to test it was through `sortQoqDeltas`'s
    output — and a sorted list looks identical whether the tie-break returns 0 or
    1. Codex demonstrated exactly that: the first version of the F4 regression
    test passed against the non-reflexive comparator it claimed to pin. A
    property this subtle has to be asserted on the comparator, not inferred from
    what it sorted. */
export function compareQoqDeltas(a: QoqDeltaLike, b: QoqDeltaLike): number {
  const av = a.curr_value_usd ?? a.prev_value_usd ?? -1;
  const bv = b.curr_value_usd ?? b.prev_value_usd ?? -1;
  if (bv !== av) return bv - av;
  /* Codex F4: this returned 1 for EQUAL keys, so the comparator was not
     reflexive and therefore not a total order — the tie-break must return 0
     so the sort is stable and matches the Python reference exactly. */
  if (a.position_key === b.position_key) return 0;
  return a.position_key < b.position_key ? -1 : 1;
}

export function sortQoqDeltas<T extends QoqDeltaLike>(deltas: readonly T[]): T[] {
  return [...deltas].sort(compareQoqDeltas);
}

/** Structural minimum of `inst.QoqDeltaRow` this module needs. Declared rather
    than imported so `holdings.ts` stays browser-safe — `inst.ts` reaches for
    `node:sqlite`, and a value import of it could never reach the bundle. */
export interface QoqDeltaLike {
  position_key: string;
  curr_value_usd: number | null;
  prev_value_usd: number | null;
}

/** Order, then cap by the SAME published byte budget the holdings embed uses.
    `total` is the true count before the cap — every caller that prints a count
    must print this one, never `rows.length`, or the page understates the
    filer's activity while looking complete. */
export function boundQoqDeltas<T extends QoqDeltaLike>(
  deltas: readonly T[],
): { rows: T[]; total: number } {
  const capped = capRows(sortQoqDeltas(deltas));
  return { rows: capped.rows, total: capped.total };
}
