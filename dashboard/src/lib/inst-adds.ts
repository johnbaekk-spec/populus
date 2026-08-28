/* The recently-added-issuers leaderboard: closed-period
   selection, the endpoint payload shape, and the section note.

   Pure. Shared by the endpoint, the SSR page and the client island, so all
   three agree by construction rather than by three careful implementations. */

import { esc, fmtInt, fmtUsd } from "./format.ts";

/** Days after a period end by which a 13F must be filed. */
export const FILING_DEADLINE_DAYS = 45;

/** Exactly this many closed periods are offered. */
export const ADDS_PERIOD_COUNT = 3;

export const ADDS_RECORD_LIMIT = 2_000;
export const ADDS_BYTE_LIMIT = 2 * 1024 * 1024;

export type AddsMode = "all" | "new";
export const ADDS_MODES: readonly AddsMode[] = ["all", "new"];

function addDays(dateIso: string, days: number): string {
  const t = Date.UTC(
    Number(dateIso.slice(0, 4)),
    Number(dateIso.slice(5, 7)) - 1,
    Number(dateIso.slice(8, 10)),
  );
  return new Date(t + days * 86_400_000).toISOString().slice(0, 10);
}

/** The filing deadline for a period: period end plus 45 days. */
export function filingDeadline(periodEnd: string): string {
  return addDays(periodEnd, FILING_DEADLINE_DAYS);
}

/** A period is CLOSED when the build date is STRICTLY AFTER its deadline.

    Strictly after, not on-or-after: on the deadline day filings are still
    arriving, and a quarter measured mid-deadline is materially undercounted —
    an open quarter has been measured at roughly a quarter of its eventual
    filer count. A leaderboard built on one would rank managers by who filed
    early, which is not the question it claims to answer. */
export function isClosedPeriod(periodEnd: string, buildDate: string): boolean {
  return buildDate > filingDeadline(periodEnd);
}

/** The latest `ADDS_PERIOD_COUNT` closed periods, newest first.

    A period still open for filing is NEVER selectable — it is not returned at
    all, rather than returned and disabled, so no code path downstream can
    accidentally offer it. */
export function closedPeriods(
  allPeriods: readonly string[],
  buildDate: string,
  limit = ADDS_PERIOD_COUNT,
): string[] {
  return [...new Set(allPeriods)]
    .filter((p) => isClosedPeriod(p, buildDate))
    .sort()
    .reverse()
    .slice(0, limit);
}

/** The published payload for one period and mode. ONE definition, used by the
    client island's fetch and by the no-JS link the section renders, so the
    route the reader is sent to is by construction the route the island uses. */
export function addsPayloadHref(period: string, mode: AddsMode): string {
  return `/institutional/data/adds/${period}.${mode}.v1.json`;
}

/* ---------- the endpoint payload ---------- */

export interface AddsRow {
  issuer_key: string;
  issuer_key_source: "entity" | "cusip6" | "name";
  issuer_name: string | null;
  manager_count: number;
  new_position_count: number;
  /** integer USD, or null when every contributing delta was undisclosed */
  delta_value_usd: number | null;
  /** the sum omitted at least one undisclosed component */
  delta_value_is_partial: boolean;
  top_adder_cik: number | null;
  top_adder_name: string | null;
}

export interface AddsPayload {
  period: string;
  generated_at: string;
  rows: AddsRow[];
  truncated: boolean;
  /** the sort tuple of the first omitted row; null when not truncated */
  truncation_boundary: [number | null, number, string] | null;
  /** grains whose issuer identity was ambiguous, per period AND per mode */
  ambiguous_identity_exclusion_count: number;
}

/** The locked total order: value DESC NULLS LAST, manager_count DESC,
    issuer_key ASC. A null value sorts LAST rather than as zero — an issuer
    whose adds were all undisclosed is not the smallest, it is unmeasured. */
export function compareAddsRows(a: AddsRow, b: AddsRow): number {
  const an = a.delta_value_usd == null;
  const bn = b.delta_value_usd == null;
  if (an !== bn) return an ? 1 : -1;
  if (!an && !bn && a.delta_value_usd !== b.delta_value_usd) {
    return a.delta_value_usd! > b.delta_value_usd! ? -1 : 1;
  }
  if (a.manager_count !== b.manager_count) return b.manager_count - a.manager_count;
  return a.issuer_key < b.issuer_key ? -1 : a.issuer_key > b.issuer_key ? 1 : 0;
}

/** UTF-8 byte length. `String.length` counts UTF-16 code units, which
    UNDERCOUNTS every non-ASCII issuer name — and issuer names are filed text
    that routinely carries accents and non-Latin scripts. A cap measured in
    code units is not the cap that was declared. */
function utf8Bytes(s: string): number {
  return new TextEncoder().encode(s).length;
}

/** The bytes a payload actually serializes to, envelope included. The cap is a
    bound on the RESPONSE, so it is measured on the response, not on the sum of
    its row fragments. */
export function addsPayloadBytes(p: Omit<AddsPayload, "rows"> & { rows: readonly AddsRow[] }): number {
  return utf8Bytes(JSON.stringify(p));
}

export interface BoundedAdds {
  rows: AddsRow[];
  truncated: boolean;
  truncation_boundary: AddsPayload["truncation_boundary"];
  /** a single row that alone exceeds the byte cap — reported, never silently
      dropped and never silently over-served */
  oversizedRow: AddsRow | null;
}

/** Bound the payload by BOTH caps, whichever binds first, and record the exact
    boundary. The boundary is the omitted row's sort tuple, not a row count:
    a count says how many are missing, the tuple says WHERE the cut fell.

    BOUND EXACTLY ONCE. Bounding an already-bounded set reports
    `truncated: false`, because the omitted rows are no longer there to be
    omitted — which silently erased the truncation notice on the SSR view. The
    renderer therefore consumes a payload rather than re-bounding one, and this
    is the single place the cut is made. */
export function boundAdds(
  rows: readonly AddsRow[],
  opts: { recordLimit?: number; byteLimit?: number; envelope?: Omit<AddsPayload, "rows"> } = {},
): BoundedAdds {
  const recordLimit = opts.recordLimit ?? ADDS_RECORD_LIMIT;
  const byteLimit = opts.byteLimit ?? ADDS_BYTE_LIMIT;
  const sorted = [...rows].sort(compareAddsRows);
  const base: Omit<AddsPayload, "rows"> = opts.envelope ?? {
    period: "",
    generated_at: "",
    truncated: false,
    truncation_boundary: null,
    ambiguous_identity_exclusion_count: 0,
  };

  /** The payload that keeping exactly `n` rows would actually serialize to —
      including the REAL boundary tuple of the row that would be cut.

      The boundary is part of the response, and its `issuer_key` is
      unbounded text. Measuring with a placeholder key under-measured the
      response, so a near-cap dataset passed bounding and then threw at
      serialization instead of simply keeping one fewer row. */
  const bytesFor = (n: number): number => {
    const cut = sorted[n];
    return addsPayloadBytes({
      ...base,
      truncated: n < sorted.length,
      truncation_boundary: cut
        ? [cut.delta_value_usd, cut.manager_count, cut.issuer_key]
        : null,
      rows: sorted.slice(0, n),
    });
  };

  // Walk DOWN from the record cap to the largest n whose real payload fits.
  // Monotone in n, so the first fit is the answer; starting from the cap keeps
  // the common case (everything fits) at one measurement.
  let n = Math.min(sorted.length, recordLimit);
  while (n > 0 && bytesFor(n) > byteLimit) n--;

  const oversizedRow = n === 0 && sorted.length > 0 ? sorted[0]! : null;
  const cut = sorted[n];
  return {
    rows: sorted.slice(0, n),
    truncated: n < sorted.length,
    truncation_boundary: cut
      ? [cut.delta_value_usd, cut.manager_count, cut.issuer_key]
      : null,
    oversizedRow,
  };
}

/* ---------- the section note truth table ---------- */

/** `truncated` and the exclusion count are INDEPENDENT states, and the note is
    composed from BOTH. A bounded leaderboard can omit rows for either reason,
    and an unstated omission is exactly what the honesty rules forbid — so a zero exclusion
    count can never suppress an independently required truncation notice.

    | truncated | exclusions | note                                   |
    |-----------|------------|----------------------------------------|
    | false     | 0          | none                                   |
    | true      | 0          | truncation clause, naming the boundary |
    | false     | > 0        | exclusion clause, naming the count     |
    | true      | > 0        | both, truncation first                 | */
export function addsNoteHtml(payload: Pick<AddsPayload,
  "truncated" | "truncation_boundary" | "ambiguous_identity_exclusion_count">): string {
  const clauses: string[] = [];
  if (payload.truncated) {
    const b = payload.truncation_boundary;
    const at = b
      ? `the first omitted issuer had ${
          b[0] == null ? "no disclosed value" : esc(fmtUsd(b[0]))
        } across ${fmtInt(b[1])} ${b[1] === 1 ? "manager" : "managers"} (${esc(b[2])})`
      : "the exact boundary was not recorded";
    clauses.push(
      `This leaderboard is bounded by Public Filings, not by the data — ${at}. ` +
        `Every issuer remains in the published aggregate.`,
    );
  }
  const n = payload.ambiguous_identity_exclusion_count;
  if (n > 0) {
    clauses.push(
      `${fmtInt(n)} position ${n === 1 ? "grain" : "grains"} could not be attributed to a single ` +
        `issuer — the holdings behind ${n === 1 ? "it" : "them"} disagree on which issuer ${
          n === 1 ? "it names" : "they name"
        }, so ${n === 1 ? "it is" : "they are"} excluded rather than assigned to a guess.`,
    );
  }
  if (clauses.length === 0) return "";
  return `<div class="caveat-line" id="inst-adds-note">${clauses.join(" ")}</div>`;
}


/* ---------- caller-owned leaderboard comparators ---------- */

export type AddsSortKey = "issuer" | "managers" | "new" | "value" | "adder";

/** Order the leaderboard by one column.

    Comparators stay CALLER-OWNED: `initSortableTable` is plumbing that owns no
    ordering, and only this module knows that a null `delta_value_usd` means
    "undisclosed" rather than zero, or that a null top adder means no manager
    disclosed a value at all. Nulls sort LAST in every direction — reversing a
    sort must not promote unmeasured rows to the top. */
export function sortAddsRows(
  rows: readonly AddsRow[],
  key: AddsSortKey,
  dir: "asc" | "desc",
): AddsRow[] {
  const text = (v: string | null): string | null => (v == null || v === "" ? null : v.toLowerCase());
  const keyOf = (r: AddsRow): number | string | null => {
    switch (key) {
      case "issuer":
        return text(r.issuer_name) ?? r.issuer_key.toLowerCase();
      case "managers":
        return r.manager_count;
      case "new":
        return r.new_position_count;
      case "value":
        return r.delta_value_usd;
      case "adder":
        return text(r.top_adder_name);
    }
  };
  return [...rows].sort((a, b) => {
    const ka = keyOf(a);
    const kb = keyOf(b);
    // NULLS LAST in BOTH directions — an undisclosed value is not a small one.
    if (ka == null && kb == null) return a.issuer_key < b.issuer_key ? -1 : 1;
    if (ka == null) return 1;
    if (kb == null) return -1;
    // Text and numbers need OPPOSITE base directions, and conflating them
    // inverted both string columns — Issuer and Top adder displayed descending
    // under `aria-sort="ascending"`. Numbers: "desc" means largest first.
    // Text: "asc" means A first. Each is written out rather than derived from
    // the other by a sign trick, because that trick is what got it wrong.
    if (ka !== kb) {
      if (typeof ka === "number" && typeof kb === "number") {
        return dir === "desc" ? kb - ka : ka - kb;
      }
      return dir === "asc" ? (ka < kb ? -1 : 1) : ka < kb ? 1 : -1;
    }
    return a.issuer_key < b.issuer_key ? -1 : a.issuer_key > b.issuer_key ? 1 : 0;
  });
}
