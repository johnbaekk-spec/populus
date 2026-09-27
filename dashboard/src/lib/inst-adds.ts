/* The recently-added-issuers leaderboard: closed-period
   selection, the endpoint payload shape, and the section note.

   Pure. Shared by the endpoint, the SSR page and the client island, so all
   three agree by construction rather than by three careful implementations. */

import { esc, fmtInt, fmtUsd } from "./format.ts";

/** Days after a period end by which a 13F must be filed, before the Rule 0-3
    roll (`filingDeadline`). */
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

/* ---------- the 13F deadline calendar (Exchange Act Rule 0-3) ----------

   A Form 13F report is due 45 days after the end of the calendar quarter, and
   Exchange Act Rule 0-3(a) (17 CFR 240.0-3(a)) moves a deadline that falls on
   a weekend or holiday: "if the last day on which papers can be accepted as
   timely filed falls on a Saturday, Sunday or holiday, such papers may be
   filed on the first business day following". The SEC's Form 13F FAQ applies
   it to 13F ("your filing is due on the first business day thereafter").

   The holidays are the eleven legal public holidays of 5 U.S.C. 6103(a) on
   their OBSERVED dates: Saturday → the Friday before (5 U.S.C. 6103(b)(1)),
   Sunday → the Monday after (Executive Order 11582, s. 3(a)) — so New Year's
   Day on a Saturday is observed on 31 December of the year before. Juneteenth
   from 2021; the Martin Luther King, Jr. holiday from 1986. Not modelled: a
   one-off closure by executive order, and Inauguration Day (Washington-area
   only, 20 January, nowhere near a 13F deadline).

   ONE rule in two runtimes: `src/populus/filing_calendar.py` implements the
   same calendar for `inst_agg.closed_periods`, and both read the shared
   fixture `tests/fixtures/refinement/filing_deadline_cases.json`. */

function isoOf(y: number, m: number, d: number): string {
  return new Date(Date.UTC(y, m - 1, d)).toISOString().slice(0, 10);
}

function weekdayOf(dateIso: string): number {
  return new Date(`${dateIso}T00:00:00Z`).getUTCDay(); // 0 = Sunday
}

/** The n-th `weekday` (0 = Sunday) of a month; n = -1 is the last. */
function nthWeekday(y: number, m: number, weekday: number, n: number): string {
  if (n > 0) {
    const first = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
    return isoOf(y, m, 1 + ((weekday - first + 7) % 7) + 7 * (n - 1));
  }
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const last = new Date(Date.UTC(y, m - 1, lastDay)).getUTCDay();
  return isoOf(y, m, lastDay - ((last - weekday + 7) % 7));
}

/** A fixed-date holiday's observed day: Saturday → Friday, Sunday → Monday. */
function observed(y: number, m: number, d: number): string {
  const w = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return w === 6 ? isoOf(y, m, d - 1) : w === 0 ? isoOf(y, m, d + 1) : isoOf(y, m, d);
}

const HOLIDAYS = new Map<number, ReadonlySet<string>>();

/** The observed dates of the legal public holidays OF `year` (5 U.S.C.
    6103(a)); one may fall in the year before (New Year's Day on a Saturday). */
export function federalHolidays(year: number): ReadonlySet<string> {
  const hit = HOLIDAYS.get(year);
  if (hit) return hit;
  const days = new Set<string>([observed(year, 1, 1), observed(year, 7, 4), observed(year, 11, 11), observed(year, 12, 25)]);
  if (year >= 2021) days.add(observed(year, 6, 19));
  if (year >= 1986) days.add(nthWeekday(year, 1, 1, 3)); // Martin Luther King, Jr.
  days.add(nthWeekday(year, 2, 1, 3)); // Washington's Birthday
  days.add(nthWeekday(year, 5, 1, -1)); // Memorial Day
  days.add(nthWeekday(year, 9, 1, 1)); // Labor Day
  days.add(nthWeekday(year, 10, 1, 2)); // Columbus Day
  days.add(nthWeekday(year, 11, 4, 4)); // Thanksgiving Day
  HOLIDAYS.set(year, days);
  return days;
}

/** Neither a Saturday, a Sunday nor an observed federal holiday. */
export function isBusinessDay(dateIso: string): boolean {
  const w = weekdayOf(dateIso);
  if (w === 0 || w === 6) return false;
  const y = Number(dateIso.slice(0, 4));
  return !federalHolidays(y).has(dateIso) && !federalHolidays(y + 1).has(dateIso);
}

/** `dateIso` itself when it is a business day, else the first business day
    following (Rule 0-3(a)). */
export function rule03Roll(dateIso: string): string {
  let d = dateIso;
  while (!isBusinessDay(d)) d = addDays(d, 1);
  return d;
}

/** The last timely filing day of the 13F for the quarter ending `periodEnd`:
    45 days after it, rolled to the next business day by Rule 0-3. */
export function filingDeadline(periodEnd: string): string {
  return rule03Roll(addDays(periodEnd, FILING_DEADLINE_DAYS));
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

/** The Institutional freshness line (DESIGN-POLISH M3, R25, Architecture H
    H-7). It names the FILING DEADLINE, not the quarter, as the thing still
    open, and it says the quarter is incomplete ONLY while the corpus has not
    passed that deadline (`!isClosedPeriod(period, asOf)`, `asOf` =
    `corpusAsOf(build date, latest filed date)`): under that condition the
    corpus ends on or before the deadline, so filings are still due. Plain
    text; the caller escapes. */
export function instFreshnessText(latestFiled: string | null, latestPeriod: string | null, asOf: string): string {
  const first = latestFiled
    ? `13F data in this build runs through filings received ${latestFiled}.`
    : "The newest filing date in this build is not available.";
  if (latestPeriod === null || isClosedPeriod(latestPeriod, asOf)) return first;
  return `${first} The filing deadline for the quarter ended ${latestPeriod} is ${filingDeadline(latestPeriod)}, so that quarter is incomplete here.`;
}

/** R4 (refinement 20260910): the date a quarter's closedness is judged against.
    The build clock alone called 2026-06-30 "closed" on 2026-08-17 while the
    corpus's newest filing was dated 2026-07-31 — 3,660 of ~8,800 filers had
    reported. A quarter is closed only when the CORPUS has seen its deadline:
    the earlier of the build date and the newest filed date. This is the same
    rule `populus.inst_agg.closed_periods` applies to the ticker-holders
    aggregate, so the two runtimes name the same closed quarter. */
export function corpusAsOf(buildDate: string, latestFiledDate: string | null | undefined): string {
  if (!latestFiledDate) return buildDate;
  return latestFiledDate < buildDate ? latestFiledDate : buildDate;
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

/** The leaderboard's count noun (DESIGN-POLISH M1, R8; review R-4). The
    table's total is the size of this quarter's payload; when the endpoint
    TRUNCATED it, that total is the leaderboard's own bound, so the count reads
    "1–10 of the 2,000 issuers on this bounded leaderboard" and cannot pass for
    the quarter's count of issuers. The server and the island both take the
    noun from here, for every quarter and mode. */
export function addsBoundNoun(truncated: boolean): { boundNoun: string; definite: boolean } {
  return truncated
    ? { boundNoun: "issuers on this bounded leaderboard", definite: true }
    : { boundNoun: "issuers", definite: false };
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
