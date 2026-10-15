/* Pure page/section renderers. Every entity body is a string function called
   by the thin .astro page for SSR AND by the generic-route client driver —
   parity is by construction (one function, two callers). No Node APIs, no DOM.

   Honesty grammar: G1–G7 via the canonical format.ts components; charts
   zero-based, gaps stay gaps, no midpoints; NULL-honest institutional
   integers; the as-of time stamp every 13F table carries. */

/* ui/signals.ts — the /signals surfaces. One of the ui/ domain modules:
   consumers import from ./index.ts only, never from this file directly.

   signals-v3 M2 (R10–R14, LD7, LD9): the page is a triage. Its head carries
   three figures and a "How signals work" note that holds every caveat the
   page no longer prints inline (LD9); three lead cards; then one band — the
   "Filings to read" table in three tiers on the left, the hit rate by family
   (the hits filter) above a slim hits table on the right. The rule book, the
   lag distribution, the ranking rules and the committee direct table render
   on Methodology (`ruleBookHtml`, `lagBandHtml`, `signalsRankingHtml`,
   `committeeDirectHtml`), and the page links to each. Every number is
   computed from the artifact, the build's own rows and the triage
   (`signal-triage.ts`); nothing here is serialized. */

import {
  type RenderCtx,
  type TxnRow,
  esc,
  fmtInt,
  fmtUsd,
  note,
  noteFromHtml,
  srcLabel,
  srcLink,
  srcLinkInner,
  memberHrefFor,
  tickerHrefFor,
  cardFoot,
  rangeOfTotal,
  thHtml,
  presentColumns,
  dataColumnsAttr,
  tableFootReasonHtml,
  type PresentColumns,
  ASSET_TYPE_WORDS,
  displayAsset,
  isListedStock,
  amountText,
  sideLabel,
  partyClass,
} from "../format.ts";
import { affTextOf, sumRanges } from "../derive.ts";
import type { Signal, SignalArtifact, SignalKind, WithheldKind } from "../signals.ts";
import {
  BRACKET_LOWER_BOUNDS,
  LATE_BATCH_MIN_CLUSTERS,
  LEVEL_WORDS,
  LOOK_MIN_SUM,
  METER_KEYS,
  METER_LABELS,
  OTHERS_MEMBERS,
  PATTERN_GAP_DAYS,
  RECORD_MIN_LOW,
  RECORD_MIN_PRIOR,
  RECORD_MIN_SPAN_DAYS,
  SENTENCE_MAX,
  SIZE_LARGE_LOW,
  SIZE_LEVEL1_LOW,
  SIZE_LEVEL1_SHARE,
  SIZE_MIN_HISTORY,
  TIER_LABELS,
  TRIAGE_VERSION,
  compareLines,
  compareRows,
  daysBetween,
  type CardPick,
  type Level,
  type MeterKey,
  type Tier,
  type TriageResult,
  type TriageRow,
} from "../signal-triage.ts";
import { COMMITTEE_DIRECT_SOURCE, COMMITTEE_DIRECT_VERSION, DIRECT_COMMITTEE_NAMES, DIRECT_SIC, directRangesText } from "../committee-direct.ts";
import { SIGNAL_THRESHOLDS } from "../signal-thresholds.ts";
import { disclosureLedger, pairBandHtml } from "./shared.ts";

/* ================================================================================
   D-2 — /signals surfaces. Every signal renders its EXACT rule, its magnitude
   as an interval, its receipts, and the lag caveat; withheld kinds render as
   withheld with their typed reason — never silently empty (the F-26 lesson at
   the signal layer).
   ============================================================================ */

/** S-5's non-allegation caveat, the rule book's own wording, reused verbatim
    wherever a committee grade or overlap renders (R5, LD9). */
export const COMMITTEE_CAVEAT =
  "The overlap is context, never an allegation — it states a sector-to-committee fact and nothing about intent.";

const SIGNAL_KIND_LABELS: Record<Signal["kind"], string> = {
  "s1-large": "S-1 · Large disclosure",
  "s2-first": "S-2 · First disclosure of a ticker by a member",
  "s3-cooccurrence": "S-3 · Co-occurrence",
  "s4-infrequent": "S-4 · Infrequent discloser, large purchase",
  "s5-jurisdiction": "S-5 · Committee-jurisdiction overlap",
  "s6-late-large": "S-6 · Late and large",
};

/* The rule book. FAMILY groups kinds by what makes them informative; the
   short KIND token is the design's compact label; WHY is editorial context
   about the rule's information content — it never characterises a filer.
   The exact rule text comes from the artifact when a kind has emitted, and
   from this fallback only when it has not (a withheld kind still names its
   rule so nobody assumes it was forgotten). */
export type Family = "BEHAVIOUR" | "NOVELTY" | "STRUCTURE" | "COMPLIANCE" | "CONTEXT";

interface RuleBookEntry {
  kind: SignalKind;
  family: Family;
  short: string;
  fallbackRule: string;
  why: string;
}

const RULE_BOOK: readonly RuleBookEntry[] = [
  {
    kind: "s1-large",
    family: "BEHAVIOUR",
    short: "LARGE",
    fallbackRule: "amount lower bound ≥ $250K — the disclosed lower bound, never the upper",
    why: "Ranges are coarse, but the provable lower bound is a fact. A quarter-million-dollar floor is rare in a corpus where most rows sit in the $1K–$15K bracket.",
  },
  {
    kind: "s4-infrequent",
    family: "BEHAVIOUR",
    short: "INFREQUENT",
    fallbackRule: "a member with ≤10 prior disclosures in the corpus reported a purchase with lower bound ≥ $50K",
    why: "A large purchase from a member who rarely files is a different fact than the same row from a habitual filer. Per-member history, not an absolute threshold alone.",
  },
  {
    kind: "s3-cooccurrence",
    family: "STRUCTURE",
    short: "CO-OCCURRENCE",
    fallbackRule: "≥4 distinct members disclosed the same ticker, same side, within a 14-day trade-date window",
    why: "Several independent filers on one name, one side, inside two weeks is a density that coincidence rarely produces. The window is trade date, not filing date.",
  },
  {
    kind: "s2-first",
    family: "NOVELTY",
    short: "FIRST FILING",
    fallbackRule: "first disclosure of this ticker by this member within the corpus — era-scoped",
    why: "The purest new information in the record: a name this member had never disclosed before. Era-scoped, so an earlier first outside coverage is never claimed against.",
  },
  {
    kind: "s5-jurisdiction",
    family: "CONTEXT",
    short: "COMMITTEE",
    fallbackRule: "the issuer's sector falls within a committee the member sat on as of the trade date (SIC → committee map)",
    why: `Information asymmetry is structural here. ${COMMITTEE_CAVEAT}`,
  },
  {
    kind: "s6-late-large",
    family: "COMPLIANCE",
    short: "LATE",
    fallbackRule: "filed past the STOCK Act's 45-day window AND amount lower bound ≥ $100K",
    why: "Late disclosure is itself information about the filer, and it is the one rule with a statutory line behind it.",
  },
];

export const FAMILY_ORDER: readonly Family[] = ["BEHAVIOUR", "STRUCTURE", "NOVELTY", "CONTEXT", "COMPLIANCE"];
const FAMILY_LABEL: Record<Family, string> = {
  BEHAVIOUR: "Behaviour",
  STRUCTURE: "Structure",
  NOVELTY: "Novelty",
  CONTEXT: "Context",
  COMPLIANCE: "Compliance",
};

export function familyOf(kind: SignalKind): Family {
  return RULE_BOOK.find((r) => r.kind === kind)?.family ?? "BEHAVIOUR";
}
function shortOf(kind: SignalKind): string {
  return RULE_BOOK.find((r) => r.kind === kind)?.short ?? kind;
}

function magnitudeText(m: Signal["magnitude"]): string {
  if (m.low == null && m.high == null) return "not disclosed";
  if (m.low != null && m.high == null) return `Over ${fmtUsd(m.low)}`;
  if (m.low == null) return `Under ${fmtUsd(m.high!)}`;
  return `${fmtUsd(m.low)}–${fmtUsd(m.high!)}`;
}

/** "MM-DD → MM-DD" with the years available to assistive tech; the reference
    prints month-day pairs and the lag beside them. */
function whenText(s: Signal): string {
  const t = s.occurrence.tradeDate;
  const f = s.occurrence.filedDate;
  if (!t) return `<span class="visually-hidden">Filed </span><time datetime="${esc(f)}">${esc(f.slice(5))}</time>`;
  return (
    `<span class="visually-hidden">Traded </span><time datetime="${esc(t)}" aria-label="${esc(t)}">${esc(t.slice(5))}</time>` +
    ` → <span class="visually-hidden">Filed </span><time datetime="${esc(f)}" aria-label="${esc(f)}">${esc(f.slice(5))}</time>`
  );
}

function lagDays(s: Signal): number | null {
  const t = s.occurrence.tradeDate;
  if (!t) return null;
  const a = Date.UTC(+t.slice(0, 4), +t.slice(5, 7) - 1, +t.slice(8, 10));
  const f = s.occurrence.filedDate;
  const b = Date.UTC(+f.slice(0, 4), +f.slice(5, 7) - 1, +f.slice(8, 10));
  return Math.round((b - a) / 86_400_000);
}

/* ---------- R10 (SIGNALS-CLARITY M2): the WHAT sentence ----------

   Every hit says WHOSE transaction, WHICH side and WHICH asset, in words:
   "Spouse: Purchase of Not Fade Away LLC · Other", "4 members: purchases of
   NVDA". The words are the filing's own: the side is the filed side as a
   NOUN, the asset is `displayAsset` over the filed name, and the chip (shown
   only on a row that is NOT a listed stock — see `signalSentence`) is the
   filed type — a House Clerk code as its words from
   `ASSET_TYPE_WORDS`, a Senate eFD label verbatim. Nothing is inferred from an
   asset's name (plan F-6). A prior build's record, which predates these
   fields, says so ("asset not in this record") and is never counted as a
   listed stock. The rule restatement that used to fill this cell lives in the
   hit's evidence row. */

/* The side as a NOUN, never a verb (R10 as amended, plan deviation recorded in
   DEV-NOTES): the plan's past-tense sale verb is banned wording under the
   site-wide §0 gate (`BANNED_WORDING`, lib/activity.ts), which stays intact.
   The nouns are the feed's own side vocabulary, symmetric across sides. */
const SIDE_NOUN: Readonly<Record<NonNullable<Signal["side"]>, string>> = {
  purchase: "Purchase of",
  sale: "Sale of",
  sale_partial: "Partial sale of",
  exchange: "Exchange of",
  other: "Transaction in",
};
/** S-3's side, plural: a cluster is several members' transactions. */
const S3_SIDE_NOUN: Readonly<Record<"purchase" | "sale", string>> = { purchase: "purchases of", sale: "sales of" };
const OWNER_QUALIFIER: Readonly<Record<string, string>> = { spouse: "Spouse", child: "Child", joint: "Joint" };
/** The WHAT text of a record that predates the R8 fields. */
export const ASSET_NOT_IN_RECORD = "asset not in this record";

/** The per-row R8 fields are all present (a newly emitted per-row signal). */
function hasRowFields(s: Pick<Signal, "asset" | "assetType" | "side" | "owner">): boolean {
  return s.asset !== undefined && s.assetType !== undefined && s.side !== undefined && s.owner !== undefined;
}

/** The asset-type chip's words: a House Clerk code as its words, any other
    filed label verbatim, and an untyped row says it is untyped. */
function assetTypeChip(assetType: string | null): string {
  const t = (assetType ?? "").trim();
  if (t === "") return "type not stated";
  const up = t.toUpperCase();
  return Object.hasOwn(ASSET_TYPE_WORDS, up) ? ASSET_TYPE_WORDS[up]! : t;
}

export interface SignalSentence {
  /** the sentence: "{Owner: }{Side noun} {asset}", or S-3's "{n} members: {purchases|sales} of {ticker}" */
  text: string;
  /** the asset-type chip, or null (a listed stock, S-3, a record without the fields, or a type the text already names) */
  chip: string | null;
  /** false for a record that predates the R8 fields */
  recorded: boolean;
}

type SentenceInput = Pick<Signal, "kind" | "entities" | "asset" | "assetType" | "side" | "owner" | "listedStock">;

/** R10: the ONE sentence every signal-row renderer prints (hit rows, the home
    tile, the member panel). Plain text; callers escape. */
export function signalSentence(s: SentenceInput): SignalSentence {
  if (s.kind === "s3-cooccurrence") {
    if (s.side !== "purchase" && s.side !== "sale") return { text: ASSET_NOT_IN_RECORD, chip: null, recorded: false };
    return { text: `${s.entities.memberName}: ${S3_SIDE_NOUN[s.side]} ${s.entities.ticker ?? "one ticker"}`, chip: null, recorded: true };
  }
  if (!hasRowFields(s)) return { text: ASSET_NOT_IN_RECORD, chip: null, recorded: false };
  const d = displayAsset({ asset: s.asset!, assetType: s.assetType!, ticker: s.entities.ticker });
  const side = SIDE_NOUN[s.side!] ?? SIDE_NOUN.other;
  const owner = s.owner ? OWNER_QUALIFIER[s.owner] : undefined;
  const text = `${owner ? `${owner}: ` : ""}${side} ${d.text}`;
  /* The chip follows `displayAsset`'s own rule (format.ts): "only a stock code
     that is the row's own type goes silent: every other known code is
     information the reader needs". A listed stock (House `ST`, Senate `Stock`)
     carries NO chip — on the default listed-stocks view it repeated on every
     row and was cut by the cell (R10 deviation, DEV-NOTES D-3). Any other
     type is shown, and an untyped row says "type not stated", so the reader
     can see why it is hidden under "Listed stocks only". */
  if (signalIsListedStock(s)) return { text, chip: null, recorded: true };
  const chip = assetTypeChip(s.assetType!);
  /* a filed code the asset text already renders as words ("… · Other") is
     not printed twice */
  return { text, chip: d.text.endsWith(` · ${chip}`) ? null : chip, recorded: true };
}

/** The sentence as markup: the text, then — for a row that is not a listed
    stock — its type chip. */
export function signalSentenceHtml(s: SentenceInput): string {
  const x = signalSentence(s);
  return (
    `<span class="si-sentence${x.recorded ? "" : " c-muted"}">${esc(x.text)}</span>` +
    (x.chip ? ` <span class="si-asset-chip">${esc(x.chip)}</span>` : "")
  );
}

/* ---------- R9 / R12: the listed-stock view ---------- */

/** R9 / L7: listed stock through the ONE predicate (`isListedStock`, over the
    filed type) for a per-row signal; S-3 is an aggregate, so it reads the
    engine's all-rows verdict (`listedStock`). A record without the R8 fields
    is never a listed stock. */
export function signalIsListedStock(s: Pick<Signal, "kind" | "asset" | "assetType" | "side" | "owner" | "listedStock">): boolean {
  if (s.kind === "s3-cooccurrence") return s.listedStock === true;
  return hasRowFields(s) && isListedStock(s.assetType);
}

/* ---------- R13: the family filter ---------- */

/** The hits table's filters (signals-v3 M2, R13): the FAMILY — set from the
    "Hit rate by family" rows, which double as the filter — and listed stocks
    only, checked by default, never persisted. The kind chips are gone. */
export interface HitFilter {
  /** "all", or one of FAMILY_ORDER */
  family: string;
  stocksOnly: boolean;
}
export const DEFAULT_HIT_FILTER: HitFilter = {
  family: "all",
  stocksOnly: true,
};

/** Every filter except listed stocks. */
function matchesOthers(s: Signal, f: HitFilter): boolean {
  return f.family === "all" || familyOf(s.kind) === f.family;
}

/** The ONE filter predicate the server page and the client pager share. */
export function hitMatches(s: Signal, f: HitFilter): boolean {
  return matchesOthers(s, f) && (!f.stocksOnly || signalIsListedStock(s));
}

/* ---------- R11: repeated rows collapse to one line ---------- */

/** The kinds that describe ONE row. S-3 is an aggregate and never groups. */
const GROUPABLE_KINDS: ReadonlySet<SignalKind> = new Set(["s1-large", "s2-first", "s4-infrequent", "s5-jurisdiction", "s6-late-large"]);

/** One line of the hits table: a hit, or a group of hits that are exact
    repeats within one filing. The artifact keeps every id; grouping is
    presentation only, so no id is ever superseded by it. */
export interface HitLine {
  lead: Signal;
  members: Signal[];
}

/** The grouping key, or null for a signal that never groups (S-3, or a record
    lacking any R8 field). */
function groupKey(s: Signal): string | null {
  if (!GROUPABLE_KINDS.has(s.kind) || !hasRowFields(s)) return null;
  return JSON.stringify([
    s.kind, s.receipts, s.entities.bioguide, s.entities.ticker, s.asset, s.assetType, s.side, s.owner,
    s.magnitude.low, s.magnitude.high, s.occurrence.tradeDate, s.occurrence.filedDate,
  ]);
}

/** Group hits already in page order; a group sits where its first member sat. */
export function groupHits(sorted: readonly Signal[]): HitLine[] {
  const lines: HitLine[] = [];
  const byKey = new Map<string, HitLine>();
  for (const s of sorted) {
    const key = groupKey(s);
    const line = key === null ? undefined : byKey.get(key);
    if (line) {
      line.members.push(s);
      continue;
    }
    const fresh: HitLine = { lead: s, members: [s] };
    lines.push(fresh);
    if (key !== null) byKey.set(key, fresh);
  }
  return lines;
}

/** A group's size: `sumRanges` over its members — an open bound stays open,
    and a group whose members disclose no lower bound keeps none. */
function groupMagnitude(members: readonly Signal[]): Signal["magnitude"] {
  const r = sumRanges(members.map((m) => m.magnitude));
  const noLow = members.every((m) => m.magnitude.low == null);
  switch (r.kind) {
    case "closed":
      return { low: noLow ? null : r.low, high: r.high };
    case "open":
      return { low: noLow ? null : r.low, high: null };
    default:
      return { low: null, high: null };
  }
}

/** The filtered view: its lines, how many hits they hold, and how many hits
    the listed-stock filter hides under the OTHER active filters (R12). */
export function hitsView(sorted: readonly Signal[], f: HitFilter): { lines: HitLine[]; hits: number; hidden: number } {
  const others = sorted.filter((s) => matchesOthers(s, f));
  const shown = f.stocksOnly ? others.filter(signalIsListedStock) : others;
  return { lines: groupHits(shown), hits: shown.length, hidden: others.length - shown.length };
}

/** "12 hits on other asset types hidden" — the reader's cue that the default
    view is filtered (plan L8). */
export function hitsHiddenText(hidden: number, stocksOnly: boolean): string {
  if (!stocksOnly) return "all asset types shown";
  return `${fmtInt(hidden)} ${hidden === 1 ? "hit" : "hits"} on other asset types hidden`;
}

/* ---------- R13: the slim HIT row — Kind · Ticker · Who · Traded → Filed · Size · Src ---------- */

/** Lines the server renders, and the step of "Show 10 more" (LD7). */
export const SIGNAL_HITS_COMPACT_ROWS = 10;
export const SIGNAL_HITS_PAGE_SIZE = 10;
/** The hits wrapper's accessible name while it scrolls sideways (R-8). */
export const SIGNAL_HITS_REGION_NAME = "Signal hits · scroll sideways for more columns";

/** The slim hit columns (R13). The per-hit evidence row is gone: the exact
    rule opens from the kind word, and both dates sit in their own column. */
export const SIGNAL_HIT_COLUMNS = ["Kind", "Ticker", "Who", "Traded → Filed", "Size", "Src"] as const;
type HitColumn = (typeof SIGNAL_HIT_COLUMNS)[number];
/** Each column's key in the table's `data-columns` set. */
export const SIGNAL_HIT_COLUMN_KEYS: Readonly<Record<HitColumn, string>> = {
  Kind: "kind",
  Ticker: "ticker",
  Who: "who",
  "Traded → Filed": "when",
  Size: "size",
  Src: "src",
};
/** The ledger role of each hit column, header and cell alike. The member
    takes the band's slack (the one flexible column). */
export const SIGNAL_HIT_COLUMN_CLASSES: Readonly<Record<HitColumn, string>> = {
  Kind: "c-kind",
  Ticker: "c-ticker",
  Who: "c-member c-flex",
  "Traded → Filed": "c-num",
  Size: "c-num",
  Src: "c-src",
};

/** Newest filed first, then the larger lower bound — the ONE order the server
    page and the client pager share. */
export function sortHits(active: readonly Signal[]): Signal[] {
  return [...active].sort((a, b) =>
    a.occurrence.filedDate === b.occurrence.filedDate
      ? (b.magnitude.low ?? -1) - (a.magnitude.low ?? -1)
      : a.occurrence.filedDate < b.occurrence.filedDate ? 1 : -1,
  );
}

/** R12 (DESIGN-POLISH M2): the hits table's columns over its FULL collection —
    every active hit the pager or a filter can show. A Ticker column no hit
    fills is not rendered; every other column always carries a value. */
export function signalHitColumns(active: readonly Signal[]): PresentColumns {
  return presentColumns(active, SIGNAL_HIT_COLUMNS.map((c) =>
    c === "Ticker"
      ? { key: "ticker", hasValue: (s: Signal) => s.entities.ticker != null, emptyReason: "Ticker: no hit in the window names a ticker." }
      : { key: SIGNAL_HIT_COLUMN_KEYS[c], always: true },
  ));
}

/** A signal's receipt cell — ONE rule for every surface that prints one
    (K-7, M3 review; R23). The link names its regime ("PTR ↗", "eFD ↗"), so
    the stamp is not repeated beside it; where the link CANNOT name it (a
    receipt URL that is neither the House Clerk's nor the Senate's, which
    `srcLabel` reads as "src") and where there is no usable receipt, the
    regime stamp states it: "PTR src ↗", "PTR —". */
export function signalReceiptHtml(receipt: string | null | undefined, cohort: Signal["cohort"]): string {
  const stamp = `<span class="si-stamp">${cohort === "senate" ? "eFD" : "PTR"}</span>`;
  if (!receipt || !receipt.startsWith("https://")) return `${stamp} —`;
  if (srcLabel(receipt) === "src") return `<div class="cell cell-src">${stamp} ${srcLinkInner(receipt)}</div>`;
  return srcLink(receipt);
}

/** A member's last name for the slim Who column ("Cory A. Booker" →
    "Booker", "Thomas H. Kean, Jr." → "Kean"): the generational suffix and
    the given names drop; the full name stays in the link's name and title. */
export function memberLastName(full: string): string {
  const base = full.replace(/,?\s+(?:Jr\.?|Sr\.?|II|III|IV|V)$/i, "").trim();
  const parts = base.split(/\s+/).filter(Boolean);
  return parts.length ? parts[parts.length - 1]! : full;
}

/** The asset-type chip of a hit that is NOT a listed stock (R10/R12): the
    slim table drops the WHAT column, so with "Listed stocks only" unticked a
    non-stock hit still says what it is — the filed type's words, "type not
    stated", a cluster that is not all listed stock, or a prior build's record
    without the field. A listed stock carries none. */
function hitAssetChip(s: Signal): string | null {
  if (signalIsListedStock(s)) return null;
  if (s.kind === "s3-cooccurrence") return "not all listed stock";
  if (!hasRowFields(s)) return ASSET_NOT_IN_RECORD;
  return assetTypeChip(s.assetType ?? null);
}

/** One slim hits-table line. `group` is the line's members when it collapses
    exact repeats (R11): the size is then their `sumRanges` and the cell says
    `×n`. */
export function hitRowHtml(s: Signal, ctx: RenderCtx, columns: readonly string[] | null = null, group: readonly Signal[] | null = null): string {
  const members = group !== null && group.length > 1 ? group : [s];
  const grouped = members.length > 1;
  const magnitude = grouped ? groupMagnitude(members) : s.magnitude;
  const family = familyOf(s.kind);
  const full = s.entities.memberName;
  const who = s.entities.bioguide
    ? `<a href="${memberHrefFor(s.entities.bioguide, ctx)}" title="${esc(full)}" aria-label="${esc(full)}">${esc(memberLastName(full))}</a>`
    : esc(full);
  const ticker = s.entities.ticker
    ? `<a class="si-ticker mono-ticker" href="${tickerHrefFor(s.entities.ticker, ctx)}">${esc(s.entities.ticker)}</a>`
    : `<span class="none">—</span>`;
  const receipt = s.receipts[0] ?? "";
  const lag = lagDays(s);
  const chip = hitAssetChip(s);
  const groupMark = grouped ? ` <span class="si-group-n">×${fmtInt(members.length)}<span class="visually-hidden"> identical rows in one filing, sizes summed</span></span>` : "";
  return (
    `<tr class="si-hit si-family-${family.toLowerCase()} si-kind-${esc(s.kind)}" data-signal-id="${esc(s.id)}" data-family="${family}"` +
    ` data-kind="${esc(s.kind)}" data-edge="family-${family.toLowerCase()}" data-bioguide="${esc(s.entities.bioguide ?? "")}" data-ticker="${esc(s.entities.ticker ?? "")}"` +
    ` data-filed="${esc(s.occurrence.filedDate)}"${grouped ? ` data-group-size="${members.length}"` : ""}>` +
    /* The kind WORD is the exact rule's label trigger (R13, LD9). */
    `<td class="c-kind si-kind">${note(s.rule, { scope: "signal-hits" }, s.id, { trigger: "label", textHtml: esc(shortOf(s.kind)) })}</td>` +
    (columns === null || columns.includes("ticker") ? `<td class="c-ticker si-ticker-cell">${ticker}</td>` : "") +
    `<td class="c-member c-flex si-subject">${who}${chip ? ` <span class="si-asset-chip">${esc(chip)}</span>` : ""}</td>` +
    `<td class="c-num si-when">${whenText(s)}${lag != null ? ` <span class="${lag > 45 ? "si-late" : "si-lag"}">+${fmtInt(lag)}d</span>` : ""}</td>` +
    `<td class="c-num si-mag">${esc(magnitudeText(magnitude))}${groupMark}</td>` +
    `<td class="c-src">${signalReceiptHtml(receipt, s.cohort)}${s.receipts.length > 1 ? `<span class="mono-note"> +${fmtInt(s.receipts.length - 1)}</span>` : ""}</td>` +
    `</tr>`
  );
}

/** The hits body for the lines shown — the ONE body renderer the server page
    and the client pager share, so a repaint is the server's markup (R13). */
export function hitsBodyHtml(lines: readonly HitLine[], ctx: RenderCtx, columns: readonly string[] | null = null): string {
  return lines.map((line) => hitRowHtml(line.lead, ctx, columns, line.members)).join("\n");
}

/** "1–10 of 663 lines · 693 hits" — the ONE range string the server and the
    pager share, built by the site's one range grammar (`rangeOfTotal`). The
    pager moves by LINES (R11: repeats within one filing are one line); the
    hit count beside it is every signal those lines hold. */
export function hitsRangeText(page: number, onPage: number, lines: number, hits: number, pageSize = SIGNAL_HITS_PAGE_SIZE): string {
  if (lines === 0) return "0 hits";
  const lo = page * pageSize + 1;
  return `${rangeOfTotal(lo, lo + onPage - 1, lines, lines === 1 ? "line" : "lines")} · ${fmtInt(hits)} ${hits === 1 ? "hit" : "hits"}`;
}

function withheldHtml(w: WithheldKind, carried: number): string {
  return (
    `<section class="panel" aria-label="${esc(SIGNAL_KIND_LABELS[w.kind])} — withheld">` +
    `<div class="panel-head"><h2 class="section-h">${esc(SIGNAL_KIND_LABELS[w.kind])}</h2>` +
    `<span class="badge-planned">WITHHELD · ${esc(w.reason)}</span></div>` +
    `<p class="section-note">${esc(w.detail)}</p>` +
    (carried > 0
      ? `<p class="section-note">${fmtInt(carried)} earlier ${carried === 1 ? "signal" : "signals"} of this kind ` +
        `${carried === 1 ? "is" : "are"} carried forward <strong>unevaluated</strong> — this build asked nothing of ` +
        `${carried === 1 ? "it" : "them"}, so ${carried === 1 ? "its" : "their"} absence from the active tables is ` +
        `not a retraction and not an amendment.</p>`
      : "") +
    `</section>`
  );
}

/* ---------- page-level inputs the artifact alone cannot supply ---------- */

export interface SignalsPageDeps {
  /** rows filed inside the artifact's coverage window — the denominator of the
      hit rate. Null → the rate is withheld, never guessed. */
  rowsEvaluated: number | null;
  /** the build's triage (`getTriage()`); absent or null → the page states
      that this view does not carry it, never an empty table */
  triage?: TriageResult | null;
}

/** Inputs of the lag distribution (Methodology `#signal-lag`). */
export interface LagBandDeps {
  /** the newest filed batch of transactions (one filed date). Empty → the band states so. */
  latestBatch: readonly Pick<TxnRow, "name" | "bioguide" | "party" | "traded" | "filed" | "lag" | "late">[];
  /** the batch's filed date, printed as the band's period label */
  latestBatchFiled: string | null;
}

/** The rule book (R14: on Methodology `#signal-rules`, moved from /signals/). */
export function ruleBookHtml(artifact: SignalArtifact): string {
  const active = artifact.signals.filter((s) => s.status === "active");
  const byKind = new Map<SignalKind, Signal[]>();
  for (const s of active) byKind.set(s.kind, [...(byKind.get(s.kind) ?? []), s]);
  const withheldByKind = new Map(artifact.withheld.map((w) => [w.kind, w]));
  const rows = RULE_BOOK.map((r) => {
    const list = byKind.get(r.kind) ?? [];
    const withheld = withheldByKind.get(r.kind);
    const rule = list[0]?.rule ?? r.fallbackRule;
    const status = withheld ? "withheld" : "active";
    return (
      `<tr class="si-rule si-family-${r.family.toLowerCase()}${withheld ? " si-withheld" : ""}" data-edge="${withheld ? "family-withheld" : `family-${r.family.toLowerCase()}`}">` +
      `<td class="si-family">${esc(FAMILY_LABEL[r.family])}</td>` +
      `<td class="si-kind c-kind">${esc(r.short)}<span class="visually-hidden"> — ${esc(SIGNAL_KIND_LABELS[r.kind])}</span></td>` +
      `<td class="si-rule-text">${esc(rule)}</td>` +
      `<td class="si-why">${esc(r.why)}</td>` +
      `<td class="c-num si-hits${list.length === 0 ? " c-muted" : ""}">${withheld ? "—" : fmtInt(list.length)}</td>` +
      `<td class="c-num si-status si-status-${status}">${withheld ? note(withheld.detail, { scope: "signal-rules" }, r.kind, { trigger: "label", textHtml: "WITHHELD" }) : "ACTIVE"}</td>` +
      `</tr>`
    );
  });
  // The one kind withheld BY DESIGN: a point return from a range-bounded
  // disclosure would be invented. Named so nobody assumes it was forgotten.
  rows.push(
    `<tr class="si-rule si-family-withheld si-withheld" data-edge="family-withheld">` +
      `<td class="si-family">Withheld</td>` +
      `<td class="si-kind c-kind">RETURN</td>` +
      `<td class="si-rule-text">not computed — a point return from a range-bounded disclosure would be invented</td>` +
      `<td class="si-why">Every tracker that publishes returns on statutory ranges is guessing. The refusal is named here rather than left implicit.</td>` +
      `<td class="c-num si-hits c-muted">—</td>` +
      `<td class="c-num si-status si-status-withheld">BY DESIGN</td>` +
      `</tr>`,
  );
  return (
    `<section class="panel panel-wide si-rulebook" id="signal-rules" aria-label="Rule book">` +
    `<div class="panel-head"><h3 class="section-h">Signal rule book</h3>` +
    `<span class="panel-note">EVERY KIND · ITS EXACT RULE · WHY IT CARRIES INFORMATION · HITS THIS BUILD · STATUS · THRESHOLDS v${esc(artifact.thresholdVersion)}</span></div>` +
    /* A DECLARED PROSE TABLE (`data-multiline`, D-5): each row is a grid with
       the design's tracks, its rule and why text wrap, and it carries no
       flexible column. */
    `<div class="table-scroll"><table class="etable etable-compact si-table" data-multiline>` +
    `<caption class="visually-hidden">Signal rules — family, kind, exact rule, why it is informative, hits in the retained window, status</caption>` +
    `<thead><tr><th scope="col">Family</th><th scope="col" class="c-kind">Kind</th><th scope="col">Rule</th><th scope="col">Why it's informative</th><th scope="col" class="c-num">Hits</th><th scope="col" class="c-num">Status</th></tr></thead>` +
    `<tbody>${rows.join("\n")}</tbody></table></div>` +
    `<p class="section-note">Thresholds are calibrated per kind and versioned; a kind whose measured volume falls outside its declared bounds is <span class="si-late">WITHHELD</span> with a typed reason, never emitted anyway. ` +
    `Institutional kinds wait on closed 13F periods and are not simulated. Every hit on <a href="/signals/">/signals</a> opens its rule from its kind word.</p>` +
    `</section>`
  );
}

/** The lag distribution's rows: one per (member, lag), at most 8. */
function lagRows(deps: LagBandDeps): { name: string; party: string; lag: number; n: number; traded: string | null; filed: string }[] {
  // One row per (member, lag): a bulk filing of forty identical rows is one
  // fact about lag, not forty — the multiplicity is printed, never hidden.
  const grouped = new Map<string, { name: string; party: string; lag: number; n: number; traded: string | null; filed: string }>();
  for (const r of deps.latestBatch) {
    if (r.lag == null) continue;
    const key = `${r.bioguide ?? r.name}|${r.lag}`;
    const g = grouped.get(key);
    if (g) g.n++;
    else grouped.set(key, { name: r.name, party: r.party, lag: r.lag, n: 1, traded: r.traded, filed: r.filed });
  }
  return [...grouped.values()].sort((a, b) => b.lag - a.lag).slice(0, 8);
}

/** The lag distribution (R14: on Methodology `#signal-lag`, moved from /signals/). */
export function lagBandHtml(deps: LagBandDeps): string {
  const rows = lagRows(deps);
  const scale = Math.max(112, ...rows.map((r) => r.lag));
  const tick = (45 / scale) * 100;
  const body =
    rows.length === 0
      ? `<p class="section-note">No rows with both dates in the latest filed batch.</p>`
      : `<ol class="si-lags">` +
        rows
          .map(
            (r) =>
              `<li><span class="si-lag-name">${esc(r.name)}${r.party ? ` <span class="si-party ${r.party === "R" ? "c-sell" : r.party === "D" ? "c-dem" : "c-muted"}">${esc(r.party)}</span>` : ""}${r.n > 1 ? ` <span class="si-lag-n">×${fmtInt(r.n)}</span>` : ""}</span>` +
              `<span class="si-bar" aria-hidden="true"><span class="si-bar-tick" style="left:${tick.toFixed(1)}%"></span><span class="si-bar-fill${r.lag > 45 ? " si-bar-late" : ""}" style="width:${((r.lag / scale) * 100).toFixed(1)}%"></span></span>` +
              `<span class="si-lag-val${r.lag > 45 ? " si-late" : ""}">+${fmtInt(r.lag)}d<span class="visually-hidden"> from trade ${esc(r.traded ?? "unknown")} to filing ${esc(r.filed)}${r.n > 1 ? `, ${fmtInt(r.n)} rows` : ""}</span></span></li>`,
          )
          .join("") +
        `</ol>`;
  return (
    `<section class="panel si-lagband" id="signal-lag" aria-label="Lag distribution">` +
    `<div class="panel-head"><h3 class="section-h">Lag distribution</h3>` +
    `<span class="panel-note">TRADE → FILING · LATEST BATCH${deps.latestBatchFiled ? ` FILED ${esc(deps.latestBatchFiled)}` : ""} · TICK = 45 DAYS</span></div>` +
    body +
    `</section>`
  );
}

/* ---------- R13: Hit rate by family — the hits filter ---------- */

function familiesHtml(deps: SignalsPageDeps, active: Signal[], artifact: SignalArtifact): string {
  const n = deps.rowsEvaluated;
  const perFamily = FAMILY_ORDER.map((f) => ({
    family: f,
    hits: active.filter((s) => familyOf(s.kind) === f).length,
    withheld: artifact.withheld.some((w) => familyOf(w.kind) === f),
  }));
  const rates = perFamily.map((p) => ({ ...p, rate: n && n > 0 ? (p.hits / n) * 1000 : null }));
  const max = Math.max(1, ...rates.map((r) => r.rate ?? 0));
  const rateText = (r: (typeof rates)[number]): string =>
    r.withheld ? "withheld" : r.rate == null ? "—" : r.rate < 0.1 && r.hits > 0 ? "<0.1 ‰" : `${r.rate.toFixed(1)} ‰`;
  return (
    `<section class="panel si-families" id="families" aria-labelledby="families-h">` +
    `<div class="panel-head"><h2 class="section-h" id="families-h">Hit rate by family</h2>` +
    `<span class="panel-note">HITS PER 1,000 ROWS FILED IN THE WINDOW · ALL ASSET TYPES · A ROW FILTERS THE HITS</span></div>` +
    (n == null ? `<p class="section-note">The evaluated-row count is not available, so no rate is stated; the rows still filter the hits.</p>` : "") +
    `<div class="si-family-list" role="group" aria-label="Filter hits by family">` +
    rates
      .map(
        (r) =>
          `<button type="button" class="si-rate-row${r.withheld ? " si-withheld" : ""}" data-family="${r.family}" aria-pressed="false">` +
          `<span class="si-family-name">${esc(FAMILY_LABEL[r.family])}</span>` +
          `<span class="si-bar" aria-hidden="true"><span class="si-bar-fill si-fill-${r.family.toLowerCase()}" style="width:${r.rate == null ? 0 : ((r.rate / max) * 100).toFixed(1)}%"></span></span>` +
          `<span class="si-rate-val">${esc(rateText(r))}<span class="visually-hidden"> — ${fmtInt(r.hits)} ${r.hits === 1 ? "hit" : "hits"}</span></span></button>`,
      )
      .join("") +
    `</div>` +
    /* The active family filter, removable (R13). The client shows it on the
       first filter; with no script there is no filter to remove. */
    `<p class="si-pill-row" id="signal-family-pill-row" hidden><button type="button" class="si-pill" id="signal-family-pill">Family: <span id="signal-family-pill-name"></span> <span aria-hidden="true">×</span><span class="visually-hidden">, remove the family filter</span></button></p>` +
    (n == null
      ? ""
      : `<p class="section-note">${fmtInt(n)} rows filed inside the window` +
        (artifact.dateAnomaliesExcluded > 0 ? ` · ${fmtInt(artifact.dateAnomaliesExcluded)} date-anomaly rows excluded before any rule ran` : "") +
        `. A rule that fires on 5% of rows is a filter; one that fires on 0.1% is a signal. Rates are published so "unusual" can be calibrated.</p>`) +
    `</section>`
  );
}

/* ---------- R13: the slim hits panel ---------- */

function hitsHtml(active: Signal[], ctx: RenderCtx): string {
  const sorted = sortHits(active);
  /* The first view is the DEFAULT — every family, listed stocks only, exact
     repeats collapsed to one line — through the same `hitsView` the client
     repaints with, so the two cannot disagree. */
  const view = hitsView(sorted, DEFAULT_HIT_FILTER);
  const shown = view.lines.slice(0, SIGNAL_HITS_COMPACT_ROWS);
  const cols = signalHitColumns(active);
  const more = view.lines.length > shown.length;
  const body = sorted.length === 0
    ? `<tr><td colspan="${cols.columns.length}" class="si-empty">Zero hits in the retained window — a computed answer over every rule, not missing coverage.</td></tr>`
    : shown.length === 0
      ? `<tr><td colspan="${cols.columns.length}" class="si-empty">No hits match this view — a computed answer over every rule, not missing coverage.</td></tr>`
      : hitsBodyHtml(shown, ctx, cols.columns);
  const range = hitsRangeText(0, shown.length, view.lines.length, view.hits, SIGNAL_HITS_PAGE_SIZE);
  return (
    `<section class="panel si-hits" id="hits" aria-labelledby="hits-h" data-step="${SIGNAL_HITS_PAGE_SIZE}" data-shown="${shown.length}" data-total="${sorted.length}" data-lines="${view.lines.length}">` +
    `<div class="panel-head"><h2 class="section-h" id="hits-h">Hits</h2>` +
    `<span class="panel-note">NEWEST FILED FIRST · EVERY HIT CARRIES ITS RECEIPT</span>` +
    /* R12: checked by default and never persisted (`autocomplete="off"` stops
       a browser restoring it; the island also resets it on load). The hidden
       count beside it is the reader's cue that the view is filtered. */
    `<label class="filter-check" for="signal-stocks-only"><input type="checkbox" id="signal-stocks-only" checked autocomplete="off" /> Listed stocks only</label>` +
    `<span class="si-hidden-count" id="signal-hidden-count" data-hidden="${view.hidden}">${esc(hitsHiddenText(view.hidden, true))}</span></div>` +
    /* No fixed-height box: the page scrolls, never the table. The wrapper is a
       focusable, named "scroll sideways" region ONLY while the table overflows
       it (review R-8). */
    `<div class="table-scroll si-hits-scroll" data-scroll-region="${esc(SIGNAL_HITS_REGION_NAME)}"><table class="etable etable-compact si-table"${dataColumnsAttr(cols)}>` +
    `<caption class="visually-hidden">Signal hits, newest filed first</caption>` +
    `<thead><tr>${SIGNAL_HIT_COLUMNS.filter((c) => cols.columns.includes(SIGNAL_HIT_COLUMN_KEYS[c])).map((c) => thHtml({ label: c, mark: null, cls: SIGNAL_HIT_COLUMN_CLASSES[c], col: SIGNAL_HIT_COLUMN_KEYS[c] })).join("")}</tr></thead>` +
    `<tbody id="signal-hits-body">${body}</tbody></table></div>` +
    tableFootReasonHtml(cols) +
    `<div class="feed-foot"><div class="pager">` +
    `<span class="pager-range" id="signal-hits-range" tabindex="-1">${esc(range)}</span>` +
    `<button type="button" class="pager-btn${more ? "" : " is-unavailable"}" id="signal-hits-more" aria-disabled="${more ? "false" : "true"}">Show ${fmtInt(SIGNAL_HITS_PAGE_SIZE)} more</button>` +
    `</div></div>` +
    `<p class="section-note" id="signal-hits-count" data-total="${active.length}">` +
    `<span class="si-stamp">PTR</span> / <span class="si-stamp">eFD</span> = the source regime of the underlying row · ` +
    `sizes are the row's statutory range, never narrowed · each kind word opens its exact rule · ${fmtInt(active.length)} ${active.length === 1 ? "hit" : "hits"} in the window · ` +
    `the complete artifact: <a href="/signals/data/signals.v1.json">signals.v1.json</a>.</p>` +
    `<p class="visually-hidden" id="signal-hits-status" role="status" aria-live="polite"></p>` +
    `<noscript><p class="section-note">Filtering and "Show more" need JavaScript; the newest ${fmtInt(SIGNAL_HITS_COMPACT_ROWS)} lines of listed-stock hits are listed above regardless, and the artifact holds every hit.</p></noscript>` +
    `</section>`
  );
}

/* ---------- R12: the "Filings to read" triage ---------- */

/** One meter (LD7): three bars of 5, 9 and 13 px; level 3 amber, 1–2 accent,
    -1 hatched. Its accessible name is "Size: strong"; the visible label rides
    inline and shows on phones (R23). */
export function meterHtml(key: MeterKey, level: Level): string {
  const label = METER_LABELS[key];
  return (
    `<span class="si-meter" data-meter="${key}" data-level="${level}" role="img" aria-label="${esc(`${label}: ${LEVEL_WORDS[level]}`)}">` +
    `<span class="si-meter-label">${esc(label)}</span>` +
    `<span class="si-meter-bars"><span class="si-mbar"></span><span class="si-mbar"></span><span class="si-mbar"></span></span>` +
    `</span>`
  );
}

function metersHtml(m: Record<MeterKey, Level>): string {
  return `<span class="si-meters">${METER_KEYS.map((k) => meterHtml(k, m[k])).join("")}</span>`;
}

/** The owner, in words (R12): the filing's own owner code, and a stated
    absence when it names none. */
const OWNER_WORDS: Readonly<Record<string, string>> = { self: "Self", spouse: "Spouse", child: "Child", joint: "Joint" };
function ownerWordHtml(owner: TxnRow["owner"]): string {
  return `<span class="owner-note">${esc(owner ? OWNER_WORDS[owner] ?? owner : "owner not stated")}</span>`;
}

function lagOf(r: TxnRow): number | null {
  if (r.lag != null) return r.lag;
  return r.traded ? daysBetween(r.traded, r.filed) : null;
}

/** The ticker-page link of a row's heading: the canonical page's
    `#on-signals` anchor, the /e/ route as the existing helper decides, and
    no link when the line names no ticker (LD7). */
function onSignalsHref(ticker: string | null, ctx: RenderCtx): string | null {
  if (!ticker) return null;
  const href = tickerHrefFor(ticker, ctx);
  return href.startsWith("/tickers/") ? `${href}#on-signals` : href;
}

/** The LATE tag: every line of a one-line filing, or "701 of 703 lines late". */
function lateTagHtml(late: number, total: number): string {
  if (late === 0) return "";
  return ` <span class="si-late si-late-tag">${total === 1 ? "LATE" : `${fmtInt(late)} of ${fmtInt(total)} lines late`}</span>`;
}

/** R12: one row of "Filings to read" — an `<article>` whose ticker-and-member
    heading is the stretched link to the ticker page; the receipt is a
    separate link above it. The ticker page's own block (M3, R18) renders the
    same row with `link: false`: the heading would only link to itself. */
export function triageRowHtml(row: TriageRow, ctx: RenderCtx, opts: { link?: boolean } = {}): string {
  const t = row.lead.txn;
  const href = opts.link === false ? null : onSignalsHref(t.ticker, ctx);
  const filers = [...new Map(row.filings.map((f) => [f.memberKey, f.rows[0]!])).values()];
  const who =
    row.grouping === "cluster" && row.cluster
      ? `${fmtInt(row.cluster.members)} members`
      : t.name;
  const suffix =
    row.grouping === "member-ticker" || row.grouping === "late-batch"
      ? ` · ${fmtInt(row.filings.length)} ${row.filings.length === 1 ? "filing" : "filings"}`
      : "";
  const headInner =
    `<span class="mono-ticker">${esc(t.ticker ?? "no ticker")}</span> ` +
    `<span class="si-row-member">${esc(who)}${esc(suffix)}</span>`;
  const head = href ? `<a class="si-row-link" href="${esc(href)}">${headInner}</a>` : headInner;
  const side = sideLabel(t.side, t.flags);
  const affs = (row.grouping === "cluster" ? filers : [t])
    .map((r) => `${row.grouping === "cluster" ? `${esc(r.name)} ` : ""}<span class="aff ${partyClass(r.party)}">${esc(affTextOf(r))}</span>`)
    .join(", ");
  const kindTag =
    row.grouping === "late-batch"
      ? ` <span class="si-group-tag">LATE BATCH</span>`
      : row.grouping === "cluster"
        ? ` <span class="si-group-tag">CLUSTER</span>`
        : "";
  /* The date block is the LEAD line's own chronology (D21): its filed date,
     its trade date, the lag between those two and its filing's receipt, so
     the four always correspond. A row that groups several filings names the
     group's latest filing separately, labelled as such — `row.filed` is that
     date and the sort key, never the lead line's filed date. */
  const lag = lagOf(t);
  const n = row.filings.length;
  const group =
    n > 1
      ? `<span class="mono-note"> +${fmtInt(n - 1)} ${n === 2 ? "filing" : "filings"} · latest of ${fmtInt(n)} filings: <time datetime="${esc(row.filed)}">${esc(row.filed)}</time></span>`
      : "";
  return (
    `<article class="si-row" data-tier="${row.tier}" data-grouping="${row.grouping}" data-ticker="${esc(t.ticker ?? "")}" data-row-key="${esc(row.key)}">` +
    `<div class="si-row-main">` +
    `<h4 class="si-row-h">${head}</h4>` +
    `<p class="si-row-what"><span class="si-chip si-side-${side.cls}">${esc(side.text)}</span> <span class="si-row-amt">${esc(amountText(t))}</span>${kindTag} · ${affs} · ${ownerWordHtml(t.owner)}${lateTagHtml(row.lateLines, row.totalLines)}</p>` +
    `<p class="si-row-why">${esc(row.sentence)}</p>` +
    `</div>` +
    metersHtml(row.meters) +
    `<div class="si-row-when">` +
    `<span class="si-row-filed">filed <time datetime="${esc(t.filed)}">${esc(t.filed)}</time></span>` +
    `<span class="si-row-traded">${t.traded ? `traded <time datetime="${esc(t.traded)}">${esc(t.traded)}</time>${lag != null ? ` · <span class="${lag > 45 ? "si-late" : "si-lag"}">${fmtInt(lag)}d</span>` : ""}` : "trade date not disclosed"}</span>` +
    `<span class="si-row-src">${signalReceiptHtml(row.lead.doc, t.chamber)}${group}</span>` +
    `</div>` +
    `</article>`
  );
}

/** The meter column labels over a tier's rows (R12); each meter also names
    itself, so this head is decoration for sighted readers at desktop width. */
const METER_HEAD = `<div class="si-meter-head" aria-hidden="true"><span></span><span class="si-meters">${METER_KEYS.map((k) => `<span class="si-meter-col">${esc(METER_LABELS[k])}</span>`).join("")}</span><span></span></div>`;

const TIER_EMPTY: Readonly<Record<Tier, string>> = {
  stands: "No filing in the window stands out — a computed answer over every ranked filing.",
  look: "No filing in the window is worth a look by these rules — a computed answer.",
  routine: "No routine filing in the window.",
};

function tierHtml(tier: Tier, rows: readonly TriageRow[], ctx: RenderCtx): string {
  const label = `${esc(TIER_LABELS[tier])} <span class="si-tier-n">${fmtInt(rows.length)}</span>`;
  const body = rows.length === 0 ? `<p class="section-note">${esc(TIER_EMPTY[tier])}</p>` : METER_HEAD + rows.map((r) => triageRowHtml(r, ctx)).join("\n");
  if (tier === "routine") {
    // the heading rides in the summary, so the tier keeps its place in the outline while closed
    return `<details class="si-tier" id="routine" data-tier="routine"><summary><h3 class="si-tier-h" id="routine-h">${label}</h3></summary>${body}</details>`;
  }
  return `<section class="si-tier" id="${tier}" data-tier="${tier}" aria-labelledby="${tier}-h"><h3 class="si-tier-h" id="${tier}-h">${label}</h3>${body}</section>`;
}

/** The meters' definitions, each interpolated from `signal-triage.ts`. */
function meterDefinitions(): Record<MeterKey, { short: string; full: string }> {
  return {
    size: {
      short: "the lower bound against the filer's prior disclosures",
      full:
        `Strong: at least one bracket above the largest of the filer's prior disclosures and a lower bound of $${fmtInt(SIZE_LARGE_LOW)} or more. ` +
        `Medium: a bracket above, or the same bracket at $${fmtInt(SIZE_LARGE_LOW)} or more. Low: at least $${fmtInt(SIZE_LEVEL1_LOW)} and above ${Math.round(SIZE_LEVEL1_SHARE * 100)}% of the prior lower bounds. ` +
        `Unknown with fewer than ${SIZE_MIN_HISTORY} prior disclosures that state one. Prior means traded earlier, in another filing, and filed by this row's cutoff.`,
    },
    pattern: {
      short: "the gap since the filer's previous trade",
      full:
        `Strong: the first filing on record, or ${fmtInt(PATTERN_GAP_DAYS[3])} days or more since the previous trade. Medium: ${fmtInt(PATTERN_GAP_DAYS[2])} days or more. Low: ${fmtInt(PATTERN_GAP_DAYS[1])} days or more. ` +
        `Measured from the filing's earliest trade date over rows filed by the cutoff.`,
    },
    others: {
      short: "members disclosing the same ticker and side in one co-occurrence window",
      full:
        `Strong: ${OTHERS_MEMBERS[3]} or more distinct members in the active co-occurrence window that holds the trade; medium: ${OTHERS_MEMBERS[2]}. ` +
        `Only filings filed by the cutoff are counted, so a member who filed later never raises an earlier filing.`,
    },
    cmte: {
      short: "the issuer inside a committee the member sat on at the trade date",
      full:
        `Medium: a direct match — the issuer's 4-digit SIC inside a direct range of a committee that matched (table v${COMMITTEE_DIRECT_VERSION} on Methodology). ` +
        `Low: a sector match only. None: no mapped committee matched. Unknown: the sector or the membership on that date is not on record, or the committee inputs are not in this build. ` +
        COMMITTEE_CAVEAT,
    },
  };
}

function legendHtml(): string {
  const defs = meterDefinitions();
  const levels = ([3, 2, 1, 0, -1] as const)
    .map(
      (l) =>
        `<span class="si-legend-level"><span class="si-meter" data-level="${l}" aria-hidden="true"><span class="si-meter-bars"><span class="si-mbar"></span><span class="si-mbar"></span><span class="si-mbar"></span></span></span>` +
        `<span class="si-legend-word">${esc(LEVEL_WORDS[l])}${l === -1 ? " (hatched)" : ""}</span></span>`,
    )
    .join("");
  return (
    `<div class="si-legend" aria-label="Meter legend" role="group">` +
    `<p class="si-legend-levels"><span class="si-legend-h">Levels</span> ${levels}</p>` +
    `<dl class="si-legend-meters">` +
    METER_KEYS.map(
      (k) =>
        `<div><dt>${note(defs[k].full, { scope: "signals-legend" }, k, { trigger: "label", textHtml: esc(METER_LABELS[k]) })}</dt>` +
        `<dd>${esc(defs[k].short)}${k === "cmte" ? ` — <span class="si-cmte-context">context, never an allegation</span>` : ""}</dd></div>`,
    ).join("") +
    `</dl>` +
    `</div>`
  );
}

function triageHtml(triage: TriageResult | null, artifact: SignalArtifact, ctx: RenderCtx): string {
  const head =
    `<div class="panel-head"><h2 class="section-h" id="triage-h">Filings to read</h2>` +
    `<span class="panel-note">${triage ? `${fmtInt(triage.rows.length)} ${triage.rows.length === 1 ? "ROW" : "ROWS"} RANKED · ` : ""}FILED ${esc(artifact.coverageFrom)} → ${esc(artifact.coverageTo)} · EACH AGAINST THE FILER'S OWN RECORD, AS OF ITS FILING</span></div>`;
  if (triage === null) {
    return (
      `<section class="panel si-triage" id="triage" aria-labelledby="triage-h">` +
      head +
      `<p class="section-note">The filings table is computed on the server from the build's rows; this view carries the artifact only. Every hit is in the hits table and in <a href="/signals/data/signals.v1.json">signals.v1.json</a>.</p>` +
      `</section>`
    );
  }
  const by = (t: Tier) => triage.rows.filter((r) => r.tier === t);
  return (
    `<section class="panel si-triage" id="triage" aria-labelledby="triage-h">` +
    head +
    legendHtml() +
    (triage.cmteAvailable ? "" : `<p class="section-note">Cmte reads unknown on every row: committee data is not in this build (${esc(triage.cmteUnavailableReason ?? "inputs-not-in-build")}).</p>`) +
    tierHtml("stands", by("stands"), ctx) +
    tierHtml("look", by("look"), ctx) +
    tierHtml("routine", by("routine"), ctx) +
    `</section>`
  );
}

/* ---------- R11: the lead cards ---------- */

function cardFactsHtml(p: CardPick, ctx: RenderCtx): string {
  const t = p.line.txn;
  const side = sideLabel(t.side, t.flags);
  const href = onSignalsHref(t.ticker, ctx);
  const ticker = `<span class="mono-ticker">${esc(t.ticker ?? "no ticker")}</span>`;
  const lag = lagOf(t);
  return (
    `<h3 class="si-card-h">${href ? `<a href="${esc(href)}">${ticker}</a>` : ticker} <span class="si-chip si-side-${side.cls}">${esc(side.text)}</span> <span class="si-card-amt">${esc(amountText(t))}</span></h3>` +
    `<p class="si-card-who">${t.bioguide ? `<a href="${memberHrefFor(t.bioguide, ctx)}">${esc(t.name)}</a>` : esc(t.name)} <span class="aff ${partyClass(t.party)}">${esc(affTextOf(t))}</span> · ${ownerWordHtml(t.owner)}</p>` +
    `<p class="si-card-dates">traded ${t.traded ? `<time datetime="${esc(t.traded)}">${esc(t.traded)}</time>` : "date not disclosed"} · filed <time datetime="${esc(t.filed)}">${esc(t.filed)}</time>${lag != null ? ` · <span class="${lag > 45 ? "si-late" : "si-lag"}">${fmtInt(lag)}d</span>` : ""}</p>` +
    `<p class="si-card-fact">${esc(p.fact)}</p>` +
    `<div class="si-card-src">${signalReceiptHtml(p.line.doc, t.chamber)}</div>`
  );
}

function emptyCardHtml(text: string): string {
  return `<p class="section-note" data-empty-state>— ${esc(text)}</p>`;
}

/** R11 / LD6: three cards — the highest-confidence committee trade, the
    largest buy and the largest sell — with ONE segmented control ranking the
    buy and sell cards by the filer's own record or by absolute dollars. The
    control is two radio inputs and CSS (`:checked ~`): no script. Without CSS
    both variants show. */
export function leadCardsHtml(triage: TriageResult | null, ctx: RenderCtx): string {
  const c = triage?.cards ?? null;
  const committeeBody =
    triage === null
      ? emptyCardHtml("not computed in this view.")
      : !triage.cmteAvailable
        ? `<p class="section-note" data-empty-state>Committee data is not in this build (${esc(triage.cmteUnavailableReason ?? "inputs-not-in-build")}), so no committee grade is stated.</p>`
        : c?.committee
          ? cardFactsHtml(c.committee, ctx)
          : emptyCardHtml("no ranked listed-stock line carries a committee overlap in the window.");
  // The tag names a grade only when a graded line is shown — never on an empty card.
  const committeeTag =
    triage !== null && triage.cmteAvailable && c?.committee
      ? c.committee.line.cmte.grade === "broad"
        ? "Committee · broad match"
        : "Committee · direct match"
      : "Committee";
  /* The card names are R11's ("Largest buy", "Largest sell"); the copy uses
     the side NOUNS (R25). */
  const variant = (rank: "record" | "absolute", pick: CardPick | null, card: "buy" | "sell"): string => {
    const noun = card === "buy" ? "purchase" : "sale";
    return (
      `<div class="si-variant" data-rank="${rank}">` +
      `<div class="si-card-tag">${esc(`Largest ${card} · ${rank === "record" ? "own record" : "absolute $"}`)}</div>` +
      (triage === null
        ? emptyCardHtml("not computed in this view.")
        : pick
          ? cardFactsHtml(pick, ctx)
          : emptyCardHtml(
              rank === "record"
                ? `no listed-stock ${noun} of at least $${fmtInt(RECORD_MIN_LOW)} from a filer with at least ${RECORD_MIN_PRIOR} prior disclosures spanning ${RECORD_MIN_SPAN_DAYS} days or more.`
                : `no listed-stock ${noun} with a lower bound in the window.`,
            )) +
      `</div>`
    );
  };
  return (
    `<section class="si-lead" id="lead-cards" aria-labelledby="lead-cards-h">` +
    `<input type="radio" name="rank" id="si-rank-record" class="si-rank-input" value="record" checked autocomplete="off" />` +
    `<input type="radio" name="rank" id="si-rank-absolute" class="si-rank-input" value="absolute" autocomplete="off" />` +
    `<div class="panel-head si-lead-head"><h2 class="section-h" id="lead-cards-h">Lead cards</h2>` +
    `<span class="panel-note">LISTED-STOCK LINES OF THE FILINGS TO READ · BOTH DATES · EVERY RECEIPT</span>` +
    `<div class="seg si-rank-seg" role="group" aria-label="Rank the largest buy and sell by"><label for="si-rank-record">Own record</label><label for="si-rank-absolute">Absolute $</label></div></div>` +
    `<div class="si-cards">` +
    `<article class="si-card" data-card="committee" data-tone="amber"><div class="si-card-tag">${esc(committeeTag)}</div>${committeeBody}` +
    `<p class="si-card-context">${esc(COMMITTEE_CAVEAT)}</p></article>` +
    `<article class="si-card" data-card="buy" data-tone="green">${variant("record", c?.buyRecord ?? null, "buy")}${variant("absolute", c?.buyAbsolute ?? null, "buy")}</article>` +
    `<article class="si-card" data-card="sell" data-tone="red">${variant("record", c?.sellRecord ?? null, "sell")}${variant("absolute", c?.sellAbsolute ?? null, "sell")}</article>` +
    `</div>` +
    `</section>`
  );
}

/* ---------- R10: the head and its "How signals work" note (LD9) ---------- */

function howSignalsWorkHtml(artifact: SignalArtifact, superseded: number, unevaluated: number): string {
  const withheld = artifact.withheld;
  const parts = [
    "A signal is a fact about a filing, not a forecast: no returns are computed. Never used: prices, returns, intent.",
    "Recomputed every build from the same rows you can audit; zero hits is a computed answer, not missing coverage.",
    `The coverage window is ${artifact.coverageFrom} → ${artifact.coverageTo} (${artifact.retentionDays} days by filed date).`,
    artifact.lagCaveat,
    `Lifecycle: ${artifact.lifecycleNote}`,
    withheld.length === 0
      ? "No kind was withheld this build."
      : `${withheld.length} ${withheld.length === 1 ? "kind was" : "kinds were"} withheld this build: ${withheld.map((w) => `${SIGNAL_KIND_LABELS[w.kind]} (${w.reason})`).join("; ")}.`,
    `${superseded} ${superseded === 1 ? "signal" : "signals"} from an earlier build left the window; ${unevaluated} ${unevaluated === 1 ? "is" : "are"} carried forward unevaluated.`,
    artifact.dateAnomaliesExcluded > 0 ? `${artifact.dateAnomaliesExcluded} date-anomaly rows were excluded before any rule ran.` : "No date-anomaly row was excluded.",
    "Filings to read ranks each filing against the filer's own record as it stood on the filing's date; the tiers, meters and cards are defined on Methodology.",
  ];
  return parts.map((p) => esc(p)).join(" ") + ` <a href="/methodology/#signals-ranking">How rows are ranked ↗</a>`;
}

/* ---------- the page body ---------- */

export function signalsBody(artifact: SignalArtifact, ctx: RenderCtx, deps?: SignalsPageDeps): string {
  const d: SignalsPageDeps = deps ?? { rowsEvaluated: null, triage: null };
  // Tombstones are lifecycle HISTORY — they never sit in the
  // active tables or counts wearing an active face.
  const active = artifact.signals.filter((s) => s.status === "active");
  const superseded = artifact.signals.filter((s) => s.status === "superseded");
  // Rows whose kind was WITHHELD this build were not evaluated —
  // they are neither active nor retracted, and are reported with the
  // withholding that caused it.
  const unevaluated = artifact.signals.filter((s) => s.status === "unevaluated");
  /* R13: the listed-stock hits, the population the page's trade rows describe */
  const listed = active.filter(signalIsListedStock);
  const triage = d.triage ?? null;

  /* --- R10: exactly three figures --- */
  const ledger = disclosureLedger([
    { label: "Hits", value: fmtInt(active.length), detail: `${fmtInt(listed.length)} in listed stocks`, subKind: "count", tone: "green" },
    triage
      ? { label: "Stand out", value: fmtInt(triage.counts.stands), detail: `of ${fmtInt(triage.rows.length)} rows ranked`, subKind: "count", tone: "gold" }
      : { label: "Stand out", value: "—", detail: "not computed in this view", subKind: "absence", tone: "gold" },
    { label: "Window", value: `${artifact.retentionDays}d`, detail: `${artifact.coverageFrom} → ${artifact.coverageTo}`, subKind: "date" },
  ]);

  const withheld = artifact.withheld
    .map((w) => withheldHtml(w, unevaluated.filter((s) => s.kind === w.kind).length))
    .join("\n");
  /* R17: the superseded rows leave the page. They stay in the artifact and
     are linked from the footnote as the changes since the last build. */
  const supersededFoot =
    superseded.length === 0
      ? ""
      : `<p class="section-note" id="signal-changes-foot">${fmtInt(superseded.length)} ${superseded.length === 1 ? "signal" : "signals"} from an earlier build left the retained view ` +
        `(amended away or no longer matching) — <a href="/signals/data/signals.v1.json">changes since last build</a>, in the artifact.</p>`;

  return (
    `<div class="page-head">` +
    `<div class="page-head-copy"><div class="kicker">Public record / Signals · rule-based · no price data</div>` +
    `<h1 class="page-title">Congress signals</h1>` +
    `<p class="page-lede">Filings to read first, each measured against the filer's own record, with every receipt. ` +
    noteFromHtml(howSignalsWorkHtml(artifact, superseded.length, unevaluated.length), { scope: "signals-head" }, "how", { trigger: "label", textHtml: "How signals work" }) +
    `</p></div>` +
    ledger +
    `</div>` +
    leadCardsHtml(triage, ctx) +
    /* LD7: one band — the triage (the primary cell) │ families above the hits. */
    pairBandHtml(
      "design-signals-band",
      triageHtml(triage, artifact, ctx),
      `<div class="si-side">` + familiesHtml(d, active, artifact) + hitsHtml(active, ctx) + `</div>`,
      { primary: "left" },
    ) +
    `<p class="section-note" id="signal-method-links">On Methodology: <a href="/methodology/#signal-rules">the rule book</a> · ` +
    `<a href="/methodology/#signal-lag">the lag distribution</a> · <a href="/methodology/#signals-ranking">how rows are ranked</a> · ` +
    `<a href="/methodology/#committee-direct">the committee direct-match table</a>. The raw artifact: <a href="/signals/data/signals.v1.json">signals.v1.json</a>.</p>` +
    supersededFoot +
    withheld
  );
}

/* ---------- R14: Methodology's ranking and committee sections ---------- */

/** Methodology `#signals-ranking` (R14): the tiers, meters, grouping and
    cards, every constant read from `signal-triage.ts`. */
export function signalsRankingHtml(): string {
  const defs = meterDefinitions();
  const li = (s: string): string => `<li>${s}</li>`;
  return (
    `<section class="si-method" id="signals-ranking" aria-labelledby="signals-ranking-h">` +
    `<h3 class="section-h" id="signals-ranking-h">How signal rows are ranked (triage v${esc(TRIAGE_VERSION)})</h3>` +
    `<p class="metho-body">A signal is a fact about a filing, not a forecast: no returns are computed, and no price, return or intent is read. ` +
    `"Filings to read" on <a href="/signals/">/signals</a> classifies each filing that carries an active signal against the filer's own record, by published rules; it does not predict anything.</p>` +
    `<ul class="si-method-list">` +
    li(`<strong>Rows.</strong> Filings filed inside the ${fmtInt(SIGNAL_THRESHOLDS.retention_days)}-day window that carry at least one active signal on a listed-stock line (options excluded). Grouped in this order: a <em>late batch</em> (one member's filings on one date that complete ${LATE_BATCH_MIN_CLUSTERS} or more co-occurrence clusters whose windows ended before the window opened); a <em>cluster</em> (an active co-occurrence, absorbing every filing in its window whose lead line is that ticker and side); <em>same member and ticker</em> (filings whose lead lines share a ticker, as "N filings"); and the single filing.`) +
    li(`<strong>Point in time.</strong> Every meter is computed at a cutoff and sees only rows filed on or before it: a single filing at its filed date; each filing of a same-member-and-ticker row at its own filed date; a cluster at its latest absorbed filing; a late batch at its date.`) +
    METER_KEYS.map((k) => li(`<strong>${esc(METER_LABELS[k])}</strong> — ${esc(defs[k].short)}. ${esc(defs[k].full)}`)).join("") +
    li(`<strong>Brackets.</strong> The floors of the statutory ranges: ${BRACKET_LOWER_BOUNDS.map((b) => `$${fmtInt(b)}`).join(", ")}.`) +
    li(`<strong>Tiers.</strong> A row led by an exchange is ${esc(TIER_LABELS.routine)}. Otherwise any meter at strong is ${esc(TIER_LABELS.stands)}; any at medium, or a sum of ${LOOK_MIN_SUM} or more over the meters that are known, is ${esc(TIER_LABELS.look)}; the rest are ${esc(TIER_LABELS.routine)}. Lateness is a tag, never a ranking input.`) +
    li(`<strong>Lead line and order.</strong> A row's meter is the strongest over its lines. Its lead line has the strongest meter, then the highest sum, then is not an exchange, then has the highest lower bound. ${esc(TIER_LABELS.stands)} and ${esc(TIER_LABELS.look)} sort by the count of strong meters, the sum, the lead lower bound and the filed date; ${esc(TIER_LABELS.routine)} by filed date.`) +
    li(`<strong>Reason sentence.</strong> Generated from the row's facts by fixed templates, without pronouns, at most ${SENTENCE_MAX} characters.`) +
    li(`<strong>Lead cards.</strong> From the ranked listed-stock lines. Committee: direct matches before broad, then the lower bound, then the filed date. Largest buy and sell, own record: filers with at least ${RECORD_MIN_PRIOR} prior disclosures spanning ${RECORD_MIN_SPAN_DAYS} days or more, lines of at least $${fmtInt(RECORD_MIN_LOW)}, ranked by brackets above the filer's largest prior disclosure; absolute: by lower bound, then filed date.`) +
    `</ul>` +
    `</section>`
  );
}

/** Methodology `#committee-direct` (R5, R14): the LD2 table rendered from
    `DIRECT_SIC`, its version, source and the non-allegation caveat. */
export function committeeDirectHtml(): string {
  const rows = Object.entries(DIRECT_SIC)
    .map(
      ([id, ranges]) =>
        `<tr data-committee="${esc(id)}"><td class="c-ticker"><span class="mono-id">${esc(id)}</span></td>` +
        `<td class="c-secondary c-flex">${esc(DIRECT_COMMITTEE_NAMES[id] ?? id)}</td>` +
        `<td class="c-num si-direct-ranges">${esc(directRangesText(ranges))}</td></tr>`,
    )
    .join("");
  return (
    `<section class="si-method" id="committee-direct" aria-labelledby="committee-direct-h">` +
    `<h3 class="section-h" id="committee-direct-h">Committee direct matches (table v${COMMITTEE_DIRECT_VERSION})</h3>` +
    `<p class="metho-body">Every committee-overlap hit is graded <em>direct</em> when the issuer's 4-digit SIC falls inside a range below for a committee that matched it, and <em>broad</em> otherwise — including an issuer whose SIC is not on record and a committee this table does not list. ` +
    `Each range lies inside that committee's mapped sectors, so a direct grade only refines an existing hit. Source: ${esc(COMMITTEE_DIRECT_SOURCE)}. Memberships are committee-level: a subcommittee seat counts for its parent.</p>` +
    `<p class="metho-body si-cmte-context">${esc(COMMITTEE_CAVEAT)}</p>` +
    `<div class="table-scroll"><table class="etable etable-compact si-direct-table">` +
    `<caption class="visually-hidden">Committee direct-match SIC ranges, version ${COMMITTEE_DIRECT_VERSION}</caption>` +
    `<thead><tr><th scope="col" class="c-ticker">Committee</th><th scope="col" class="c-secondary c-flex">Name</th><th scope="col" class="c-num">Direct SIC ranges</th></tr></thead>` +
    `<tbody>${rows}</tbody></table></div>` +
    `</section>`
  );
}

/* ---------- signals-v3 M3 (R18, R19, LD8): the ticker page's "On Signals" block ----------

   Beside `memberSignalsPanel`, the other per-entity signal surface, so it
   prints a row and a hit through the SAME renderers `/signals/` uses
   (`triageRowHtml`, `hitRowHtml`) — one function, two callers. Static and
   server-only: the ticker page passes the build's triage, `/e/` passes none
   and renders no block (R18). */

/** The most triggering lines the ticker page pins above its newest rows (R19). */
export const ON_SIGNALS_MAX_PINNED = 5;
/** The most hit lines the compact block lists (R18). */
export const ON_SIGNALS_COMPACT_LINES = 5;

type OnSignalsView =
  | { kind: "full"; row: TriageRow; rows: number }
  | { kind: "compact"; lines: HitLine[]; allLines: number; hits: number }
  | null;

const TIER_ORDER: readonly Tier[] = ["stands", "look", "routine"];

/** Which block a ticker gets: the FULL block for its strongest Stands-out or
    Worth-a-look row, else the COMPACT block over its active hits, else none. */
function onSignalsView(rows: readonly TriageRow[], hits: readonly Signal[]): OnSignalsView {
  const ranked = rows.filter((r) => r.tier !== "routine").sort((a, b) => TIER_ORDER.indexOf(a.tier) - TIER_ORDER.indexOf(b.tier) || compareRows(a, b));
  if (ranked[0]) return { kind: "full", row: ranked[0], rows: rows.length };
  if (hits.length === 0) return null;
  const lines = groupHits(sortHits(hits));
  return { kind: "compact", lines: lines.slice(0, ON_SIGNALS_COMPACT_LINES), allLines: lines.length, hits: hits.length };
}

const BACK_TO_SIGNALS = `<a class="section-link tk-onsig-back" href="/signals/">← Back to Signals</a>`;

/** R18: the ticker's "On Signals" block (`#on-signals`), or "" when the
    ticker has no active signal.

    - FULL — the ticker leads a Stands-out or Worth-a-look row: the tier, then
      that row exactly as "Filings to read" prints it (the member with party
      and state, the side chip and range, the reason sentence, the four
      meters, and ONE line's own filed date, trade date, lag and receipt —
      the lead line's), the way back to `/signals/`, and the committee caveat
      whenever the Cmte meter shows committee context (level 1 or more).
    - COMPACT — active hits but no such row: up to five hit lines through the
      slim hits row (kind with its exact rule as a note, member, traded and
      filed dates, size, receipt), an honest count of the rest, and the
      committee caveat when a COMMITTEE hit is shown. */
export function tickerOnSignalsHtml(triageRows: readonly TriageRow[], hits: readonly Signal[], ctx: RenderCtx): string {
  const view = onSignalsView(triageRows, hits);
  if (view === null) return "";
  if (view.kind === "full") {
    const { row } = view;
    const ticker = row.lead.txn.ticker ?? "";
    const more = view.rows > 1 ? ` · THE STRONGEST OF ${fmtInt(view.rows)} ROWS LED BY ${esc(ticker)}` : "";
    return (
      `<section class="panel tk-onsig" id="on-signals" data-block="full" data-tier="${row.tier}" aria-labelledby="on-signals-h">` +
      `<div class="panel-head"><h2 class="section-h" id="on-signals-h">On Signals</h2>` +
      `<span class="panel-note">FILINGS TO READ · AGAINST THE FILER'S OWN RECORD, AS OF ITS FILING${more}</span>` +
      BACK_TO_SIGNALS +
      `</div>` +
      // the tier is the row's heading level above it, as in "Filings to read"
      `<h3 class="si-tier-h tk-onsig-tier">${esc(TIER_LABELS[row.tier])}</h3>` +
      METER_HEAD +
      triageRowHtml(row, ctx, { link: false }) +
      (row.meters.cmte >= 1 ? `<p class="section-note si-cmte-context">${esc(COMMITTEE_CAVEAT)}</p>` : "") +
      `</section>`
    );
  }
  const ticker = view.lines[0]?.lead.entities.ticker ?? "";
  const cols = SIGNAL_HIT_COLUMNS.filter((c) => c !== "Ticker");
  const committee = view.lines.some((l) => l.members.some((s) => s.kind === "s5-jurisdiction"));
  return (
    `<section class="panel tk-onsig" id="on-signals" data-block="compact" aria-labelledby="on-signals-h">` +
    `<div class="panel-head"><h2 class="section-h" id="on-signals-h">On Signals</h2>` +
    `<span class="panel-note">ACTIVE HITS NAMING ${esc(ticker)} · NEWEST FILED FIRST · EVERY HIT CARRIES ITS RECEIPT</span>` +
    BACK_TO_SIGNALS +
    `</div>` +
    `<div class="table-scroll"><table class="etable etable-compact si-table">` +
    `<caption class="visually-hidden">Active signal hits naming ${esc(ticker)}, newest filed first</caption>` +
    `<thead><tr>${cols.map((c) => thHtml({ label: c, mark: null, cls: SIGNAL_HIT_COLUMN_CLASSES[c], col: SIGNAL_HIT_COLUMN_KEYS[c] })).join("")}</tr></thead>` +
    `<tbody>${hitsBodyHtml(view.lines, ctx, cols.map((c) => SIGNAL_HIT_COLUMN_KEYS[c]))}</tbody></table></div>` +
    `<p class="section-note">${esc(hitsRangeText(0, view.lines.length, view.allLines, view.hits, ON_SIGNALS_COMPACT_LINES))} · each kind word opens its exact rule · every hit is in <a href="/signals/data/signals.v1.json">signals.v1.json</a>.</p>` +
    (committee ? `<p class="section-note si-cmte-context">COMMITTEE: ${esc(COMMITTEE_CAVEAT)}</p>` : "") +
    `</section>`
  );
}

/** R19: the rows the ticker page pins above its newest rows — the block's
    own triggering lines on THIS ticker, deduplicated, at most
    ON_SIGNALS_MAX_PINNED, in the block's order: the full block's row lines in
    LD4 line order (the lead line first), or the compact block's shown hits'
    lines (`hitLines`, the triage's own LD3 mapping) newest hit first. `txns`
    is the ticker's rows: a grouped row's line on another ticker is never
    pinned. No block, no pinned row. */
export function onSignalsLines(
  triageRows: readonly TriageRow[],
  hits: readonly Signal[],
  hitLines: ReadonlyMap<string, readonly string[]>,
  txns: readonly TxnRow[],
): TxnRow[] {
  const view = onSignalsView(triageRows, hits);
  if (view === null) return [];
  const byId = new Map(txns.map((r) => [r.txnId, r]));
  const ids =
    view.kind === "full"
      ? [...view.row.lines].sort(compareLines).map((l) => l.txn.txnId)
      : view.lines.flatMap((l) => l.members.flatMap((s) => hitLines.get(s.id) ?? []));
  const out: TxnRow[] = [];
  for (const id of ids) {
    const r = byId.get(id);
    if (r && !out.includes(r)) out.push(r);
    if (out.length === ON_SIGNALS_MAX_PINNED) break;
  }
  return out;
}

/** Per-entity signal section (D-2): the member page filters the build's
    artifact by bioguide. */
export function memberSignalsPanel(artifact: SignalArtifact, bioguide: string, _ctx: RenderCtx): string {
  // Only ACTIVE signals in the member table; tombstones are noted
  // by count, never listed as if current.
  const all = artifact.signals.filter((s) => s.entities.bioguide === bioguide);
  const mine = all.filter((s) => s.status === "active");
  const tombs = all.filter((s) => s.status === "superseded").length;
  const unevaluated = all.filter((s) => s.status === "unevaluated").length;
  const lifecycleNote =
    (tombs > 0 ? ` · ${tombs} superseded in the window` : "") +
    (unevaluated > 0
      ? ` · ${unevaluated} carried forward unevaluated (their rule was withheld this build)`
      : "");
  // Branch on ALL lifecycle rows — a member whose last active
  // signal became a tombstone still has history, and "no signals" would erase
  // exactly the supersession the lifecycle exists to preserve.
  /* `data-empty-state`: the cell is ONE stated line, so the member page's
     Filing history │ Signals pair collapses rather than pairing a table with a
     sentence (DESIGN-POLISH M2, R10). */
  if (all.length === 0) {
    return (
      `<section class="panel" aria-label="Signals" data-empty-state>` +
      `<div class="panel-head"><h2 class="section-h">Signals</h2>` +
      `<span class="panel-note">window ${esc(artifact.coverageFrom)} → ${esc(artifact.coverageTo)}</span></div>` +
      `<p class="section-note">No signals for this member in the retained window — a computed answer over the rules on <a href="/signals/">/signals</a>, not an absence of coverage.</p></section>`
    );
  }
  if (mine.length === 0) {
    return (
      `<section class="panel" aria-label="Signals" data-empty-state>` +
      `<div class="panel-head"><h2 class="section-h">Signals</h2>` +
      `<span class="panel-note">window ${esc(artifact.coverageFrom)} → ${esc(artifact.coverageTo)}</span></div>` +
      `<p class="section-note">No ACTIVE signals for this member in the retained window` +
      (tombs > 0
        ? ` — ${fmtInt(tombs)} earlier ${tombs === 1 ? "signal was" : "signals were"} superseded inside it ` +
          `(amended away or no longer matching)`
        : "") +
      (unevaluated > 0
        ? `${tombs > 0 ? ";" : " —"} ${fmtInt(unevaluated)} ${unevaluated === 1 ? "is" : "are"} carried forward ` +
          `unevaluated because their rule was withheld this build`
        : "") +
      `. See <a href="/signals/">/signals</a>.</p></section>`
    );
  }
  // D-2: EVERY surface renders the exact rule — the per-entity
  // section included, in the accessibility tree, not tooltip-only.
  const rows = mine
    .slice(0, 10)
    .map(
      (s) =>
        /* The EXACT rule moves from an inline block under the
           kind label into a note on the row's KIND CELL — per row, never one
           note on the shared Kind header, because `signals.ts` composes one
           rule per kind (`computeS1` … ) and this panel renders up to ten rows
           in which the same kind may appear several times; a single header note
           cannot carry several distinct rules at once.

           The key is `s.id` — the stable per-signal hash from
           `signalId(kind, identity)` (`signals.ts`) — and NEVER the kind, for
           the same reason: a kind-keyed id emits duplicate panel ids and
           `aria-describedby` targets that address the wrong rule. The rule is
           not softened, shrunk or lost: it is real DOM, it opens with no
           JavaScript, and it prints. */
        // R26: ticker first — the reader's question is "which stock". R10:
        // then what was traded, in words, unfiltered (member pages show
        // every asset type).
        `<tr data-edge="family-${familyOf(s.kind).toLowerCase()}"><td class="c-ticker">${s.entities.ticker ? `<span class="mono-ticker">${esc(s.entities.ticker)}</span>` : "—"}</td>` +
        `<td class="c-secondary c-flex si-what">${signalSentenceHtml(s)}</td>` +
        `<td class="c-kind">${note(s.rule, { scope: "member-signals" }, s.id, { trigger: "label", textHtml: esc(SIGNAL_KIND_LABELS[s.kind]) })}</td>` +
        `<td class="c-filed c-num">${esc(s.occurrence.filedDate)}</td>` +
        `<td class="c-num">${esc(magnitudeText(s.magnitude))}</td>` +
        `<td class="c-src">${signalReceiptHtml(s.receipts[0], s.cohort)}</td></tr>`,
    )
    .join("\n");
  return (
    `<section class="panel" aria-label="Signals">` +
    `<div class="panel-head"><h2 class="section-h">Signals</h2>` +
    `<span class="panel-note"><a href="/signals/">all signals ↗</a></span></div>` +
    `<div class="table-scroll"><table class="etable etable-compact">` +
    `<caption class="visually-hidden">Signals for this member</caption>` +
    `<thead><tr><th scope="col" class="c-ticker">Ticker</th><th scope="col" class="c-secondary c-flex">What</th><th scope="col" class="c-kind">Kind</th><th scope="col" class="c-num">Filed</th><th scope="col" class="c-num">Size</th><th scope="col" class="c-src">Src</th></tr></thead>` +
    `<tbody>${rows}</tbody></table></div>` +
    cardFoot({ short: "Filed dates lag the trades", full: `${artifact.lagCaveat}${lifecycleNote}`, scope: "member-signals-foot", key: "lag" }) +
    `</section>`
  );
}

/* exported for the home tile and the ticker page — the label a hit row prints */
export function signalKindShort(kind: SignalKind): string {
  return shortOf(kind);
}
