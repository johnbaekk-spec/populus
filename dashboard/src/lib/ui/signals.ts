/* Pure page/section renderers. Every entity body is a string function called
   by the thin .astro page for SSR AND by the generic-route client driver —
   parity is by construction (one function, two callers). No Node APIs, no DOM.

   Honesty grammar: G1–G7 via the canonical format.ts components; charts
   zero-based, gaps stay gaps, no midpoints; NULL-honest institutional
   integers; the as-of time stamp every 13F table carries. */

/* ui/signals.ts — the /signals surfaces. One of the ui/ domain modules:
   consumers import from ./index.ts only, never from this file directly.

   Composition follows docs/design/reference/Signals.dc.html band for band:
   identity + ledger, provenance strip, three summaries, the RULE BOOK (every
   kind, its exact rule, why it carries information, hits, status), the HITS
   table beside the lag distribution and the hit rate by family, and the
   device-local WATCHLIST band. Every number is computed from the artifact
   and the build's own rows; the reference's illustrative 13F-side examples
   are NOT reproduced — those kinds render as withheld with their reason. */

import {
  type RenderCtx,
  type TxnRow,
  esc,
  fmtInt,
  fmtUsd,
  note,
  srcLabel,
  srcLink,
  srcLinkInner,
  memberHrefFor,
  tickerHrefFor,
  cardFoot,
  rangeOfTotal,
  thHtml,
  compactDisclosure,
  presentColumns,
  dataColumnsAttr,
  tableFootReasonHtml,
  type PresentColumns,
  ASSET_TYPE_WORDS,
  displayAsset,
  isListedStock,
} from "../format.ts";
import { sumRanges } from "../derive.ts";
import type { Signal, SignalArtifact, SignalKind, WithheldKind } from "../signals.ts";
import { briefingCards, disclosureLedger, pairBandHtml } from "./shared.ts";
import { serializeInlineJson } from "../inline-json.ts";

/* ================================================================================
   D-2 — /signals surfaces. Every signal renders its EXACT rule, its magnitude
   as an interval, its receipts, and the lag caveat; withheld kinds render as
   withheld with their typed reason — never silently empty (the F-26 lesson at
   the signal layer).
   ============================================================================ */

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
type Family = "BEHAVIOUR" | "NOVELTY" | "STRUCTURE" | "COMPLIANCE" | "CONTEXT";

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
    why: "Information asymmetry is structural here. The overlap is context, never an allegation — it states a sector-to-committee fact and nothing about intent.",
  },
  {
    kind: "s6-late-large",
    family: "COMPLIANCE",
    short: "LATE",
    fallbackRule: "filed past the STOCK Act's 45-day window AND amount lower bound ≥ $100K",
    why: "Late disclosure is itself information about the filer, and it is the one rule with a statutory line behind it.",
  },
];

const FAMILY_ORDER: readonly Family[] = ["BEHAVIOUR", "STRUCTURE", "NOVELTY", "CONTEXT", "COMPLIANCE"];
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

/** The rule's own terms restated with the row's facts, never an
    interpretation of the filer. SIGNALS-CLARITY M2 (R10): it opens in the
    hit's evidence row; the one-line summary is the WHAT sentence. */
function evidenceText(s: Signal): string {
  const lag = lagDays(s);
  switch (s.kind) {
    case "s1-large":
      return `disclosed lower bound ${s.magnitude.low == null ? "—" : fmtUsd(s.magnitude.low)} · ≥ $250K rule`;
    case "s2-first":
      return `First ${s.entities.ticker ?? "ticker"} disclosure by this member`;
    case "s3-cooccurrence":
      return `${s.receipts.length} filings · same ticker, same side, 14-day trade window`;
    case "s4-infrequent":
      return `purchase with lower bound ≥ $50K from a member with ≤10 prior disclosures`;
    case "s5-jurisdiction":
      return `issuer sector within a committee jurisdiction as of the trade date`;
    case "s6-late-large":
      return `filed ${lag == null ? "late" : `+${fmtInt(lag)}d after trade`} · ${lag == null ? "" : `${fmtInt(lag - 45)}d over `}the 45-day window`;
  }
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

/** R10: the ONE sentence every signal-row renderer prints (hit rows, the watch
    band, the home tile, the member panel). Plain text; callers escape. */
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

/** The hits table's filters (R12): the rule, the device-local watchlist, and
    listed stocks only — checked by default, never persisted. */
export interface HitFilter {
  kind: string;
  watchedOnly: boolean;
  stocksOnly: boolean;
  watchedMembers: ReadonlySet<string>;
  watchedTickers: ReadonlySet<string>;
}
export const DEFAULT_HIT_FILTER: HitFilter = {
  kind: "all",
  watchedOnly: false,
  stocksOnly: true,
  watchedMembers: new Set(),
  watchedTickers: new Set(),
};

/** Every filter except listed stocks. */
function matchesOthers(s: Signal, f: HitFilter): boolean {
  if (f.kind !== "all" && s.kind !== f.kind) return false;
  if (f.watchedOnly && !((s.entities.bioguide && f.watchedMembers.has(s.entities.bioguide)) || (s.entities.ticker && f.watchedTickers.has(s.entities.ticker)))) return false;
  return true;
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

/* ---------- R17: the HIT row — Ticker · Who · What · Filed · Size · Src ---------- */

/** Hits per page; the pager runs over the complete artifact. */
export const SIGNAL_HITS_PAGE_SIZE = 50;
/** The hits wrapper's accessible name while it scrolls sideways (R-8). */
export const SIGNAL_HITS_REGION_NAME = "Signal hits · scroll sideways for more columns";

/** The hit columns (DESIGN-POLISH M2, T2.6): the KIND is its own column, first,
    as the design draws it — it was a word inside the evidence cell. */
export const SIGNAL_HIT_COLUMNS = ["Kind", "Ticker", "Who", "What", "Filed", "Size", "Src"] as const;
/** The watch band's columns and their ledger roles; the client's empty row
    takes its colspan from here, never a literal. */
export const SIGNAL_WATCH_COLUMNS: readonly (readonly [string, string])[] = [
  ["Kind", "c-kind"],
  ["Watched subject", "c-member"],
  ["What happened", "c-secondary c-flex"],
  ["Magnitude", "c-num"],
  ["When", "c-num"],
  ["Seen", "c-num"],
  ["Source", "c-src"],
];
/** The ledger role of each hit column (DESIGN-POLISH M1, R2), header and cell
    alike. The evidence line (What) takes the band's slack, as the approved
    preview draws it; the member name is capped (recorded in DEV-NOTES). */
export const SIGNAL_HIT_COLUMN_CLASSES: Readonly<Record<(typeof SIGNAL_HIT_COLUMNS)[number], string>> = {
  Kind: "c-kind",
  Ticker: "c-ticker",
  Who: "c-member",
  What: "c-secondary c-flex",
  Filed: "c-num",
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
      : { key: c.toLowerCase(), always: true },
  ));
}

/** A signal's receipt cell — ONE rule for every surface that prints one
    (K-7, M3 review; R23). The link names its regime ("PTR ↗", "eFD ↗"), so
    the stamp is not repeated beside it; where the link CANNOT name it (a
    receipt URL that is neither the House Clerk's nor the Senate's, which
    `srcLabel` reads as "src") and where there is no usable receipt, the
    regime stamp states it: "PTR src ↗", "PTR —". The watch band's client
    (`signals-client.ts`) applies the same rule to the same fields. */
export function signalReceiptHtml(receipt: string | null | undefined, cohort: Signal["cohort"]): string {
  const stamp = `<span class="si-stamp">${cohort === "senate" ? "eFD" : "PTR"}</span>`;
  if (!receipt || !receipt.startsWith("https://")) return `${stamp} —`;
  if (srcLabel(receipt) === "src") return `<div class="cell cell-src">${stamp} ${srcLinkInner(receipt)}</div>`;
  return srcLink(receipt);
}

/** One hits-table line. `group` is the line's members when it collapses exact
    repeats (R11): the line then states `×n`, its size is the members'
    `sumRanges`, and its evidence row lists every member id and receipt. */
export function hitRowHtml(s: Signal, ctx: RenderCtx, extraAttrs = "", columns: readonly string[] | null = null, group: readonly Signal[] | null = null): string {
  const members = group !== null && group.length > 1 ? group : [s];
  const grouped = members.length > 1;
  const magnitude = grouped ? groupMagnitude(members) : s.magnitude;
  const family = familyOf(s.kind);
  const subject = s.entities.bioguide
    ? `<a href="${memberHrefFor(s.entities.bioguide, ctx)}">${esc(s.entities.memberName)}</a>`
    : esc(s.entities.memberName);
  const ticker = s.entities.ticker
    ? `<a class="si-ticker mono-ticker" href="${tickerHrefFor(s.entities.ticker, ctx)}">${esc(s.entities.ticker)}</a>`
    : `<span class="none">—</span>`;
  const receipt = s.receipts[0] ?? "";
  const lag = lagDays(s);
  /* The evidence is ONE line; its expand carries the full text — the exact
     rule and every receipt — so nothing is deleted, only folded. Opened, the
     evidence lays out at the FULL table width on its own row (R11, H-14): the
     body is the next row (`.si-evidence-row`), shown while this row's
     disclosure is open, so a one-line row can never clip its receipts. */
  /* The summary names the row it opens (`aria-controls`, review R2-8): the
     evidence is the NEXT row, not the <details> body, so the relation is
     stated rather than implied by position. */
  const evidenceId = `si-evidence-${s.id}`;
  /* R10: the one-line summary is the sentence (who did what to which asset);
     the rule's own terms, restated with the row's facts, open below it. */
  const groupMark = grouped ? ` <span class="si-group-n">×${fmtInt(members.length)}<span class="visually-hidden"> identical rows in one filing</span></span>` : "";
  const expand = `<details class="si-expand"><summary aria-controls="${esc(evidenceId)}">${signalSentenceHtml(s)}${groupMark}</summary></details>`;
  const assetFiled =
    s.kind !== "s3-cooccurrence" && hasRowFields(s)
      ? `<p><strong>Asset as filed:</strong> <span class="filed-name">${esc(s.asset ?? "not named")}</span> · type ${s.assetType == null ? "not stated" : `<span class="mono-id">${esc(s.assetType)}</span>`}` +
        `${signalIsListedStock(s) ? " · listed stock" : " · not a listed stock"}</p>`
      : "";
  const groupList = grouped
    ? `<div class="si-group-members"><strong>${fmtInt(members.length)} hits, identical within one filing — one line, every id kept:</strong><ul>` +
      members.map((m) => `<li><span class="mono-id">${esc(m.id)}</span> ${m.receipts.map((r) => srcLink(r)).join(" ") || "—"}</li>`).join("") +
      `</ul></div>`
    : "";
  /* The receipts are block cells (`srcLink` is a <div>), so they sit in a
     <div>, never a <p> — a <div> inside a <p> is invalid and the parser closed
     the paragraph early (review C2-6). */
  const evidenceRow =
    `<tr class="si-evidence-row" id="${esc(evidenceId)}" data-evidence-for="${esc(s.id)}"><td colspan="${columns === null ? SIGNAL_HIT_COLUMNS.length : columns.length}">` +
    `<div class="si-expand-body"><p class="si-evidence-line">${esc(evidenceText(s))}</p>` +
    `<p><strong>Rule:</strong> ${esc(s.rule)}</p>` +
    assetFiled +
    groupList +
    `<div class="si-receipts"><strong>Receipts:</strong> ${s.receipts.map((r) => srcLink(r)).join(" ") || "—"}</div>` +
    `<p class="mono-note">${esc(SIGNAL_KIND_LABELS[s.kind])} · thresholds v${esc(String(s.thresholdVersion ?? ""))} · computed ${esc(String(s.computedAt ?? ""))}</p></div></td></tr>`;
  /* The family drives the row's 3px edge (`data-edge`); `data-kind` stays the
     signal kind the filter reads (G-6). The kind WORD, in its own column, is
     the rule's label trigger — the exact rule opens from it, no glyph. */
  return (
    `<tr class="si-hit si-family-${family.toLowerCase()} si-kind-${esc(s.kind)}" data-signal-id="${esc(s.id)}" data-family="${family}"` +
    ` data-kind="${esc(s.kind)}" data-edge="family-${family.toLowerCase()}" data-bioguide="${esc(s.entities.bioguide ?? "")}" data-ticker="${esc(s.entities.ticker ?? "")}"` +
    ` data-filed="${esc(s.occurrence.filedDate)}"${grouped ? ` data-group-size="${members.length}"` : ""}${extraAttrs}>` +
    `<td class="c-kind si-kind">${note(s.rule, { scope: "signal-hits" }, s.id, { trigger: "label", textHtml: esc(shortOf(s.kind)) })}</td>` +
    (columns === null || columns.includes("ticker") ? `<td class="c-ticker si-ticker-cell">${ticker}</td>` : "") +
    `<td class="c-member si-subject">${subject}</td>` +
    `<td class="c-secondary c-flex si-what">${expand}</td>` +
    `<td class="c-num si-when">${whenText(s)}${lag != null ? ` <span class="${lag > 45 ? "si-late" : "si-lag"}">+${fmtInt(lag)}d</span>` : ""}</td>` +
    `<td class="c-num si-mag">${esc(magnitudeText(magnitude))}${grouped ? `<span class="visually-hidden">, summed over ${fmtInt(members.length)} rows</span>` : ""}</td>` +
    /* R23 (DESIGN-POLISH M3, T3.7): the receipt prints its regime ONCE —
       the link reads "PTR ↗" or "eFD ↗", so the stamp before it printed
       "PTR PTR". Only a row with no receipt link keeps the stamp, so its
       source regime is still stated. The regime legend stays in the foot. */
    `<td class="c-src">${signalReceiptHtml(receipt, s.cohort)}${s.receipts.length > 1 ? `<span class="mono-note"> +${fmtInt(s.receipts.length - 1)}</span>` : ""}</td>` +
    `</tr>` +
    evidenceRow
  );
}

/** The hits body for one page, compacted to its first `compactN` hits (each
    hit and its evidence row); the rest of the page stays in the DOM behind the
    named binder. The ONE body renderer the server page and the client pager
    share, so a repaint compacts exactly as the first render did. */
export function hitsBodyHtml(lines: readonly HitLine[], ctx: RenderCtx, compactN: number, columns: readonly string[] | null = null): string {
  return lines
    .map((line, i) => {
      const html = hitRowHtml(line.lead, ctx, "", columns, line.members);
      return i >= compactN ? html.replace(/<tr\b/g, "<tr data-compact-extra") : html;
    })
    .join("\n");
}

/** Hits the page shows before its "Show all 50 hits" (coordinator decision
    CD-1): a FIXED default, never tuned to one data build. The page still holds
    SIGNAL_HITS_PAGE_SIZE hits and the pager still moves by it; the rest of the
    page stays in the DOM behind the named binder. Band S1's hits are its
    PRIMARY cell, never cut to balance the lag and rate cell. */
export const SIGNAL_HITS_COMPACT_ROWS = 12;

/** "1–50 of 663 lines · 693 hits" — the ONE range string the server and the
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
        `not a retraction and not an amendment.</p>` +
        ``
      : "") +
    `</section>`
  );
}

/* ---------- page-level inputs the artifact alone cannot supply ---------- */

export interface SignalsPageDeps {
  /** rows filed inside the artifact's coverage window — the denominator of the
      hit rate. Null → the rate is withheld, never guessed. */
  rowsEvaluated: number | null;
  /** the newest filed batch of transactions (one filed date), for the lag
      distribution. Empty → the band states so. */
  latestBatch: readonly Pick<TxnRow, "name" | "bioguide" | "party" | "traded" | "filed" | "lag" | "late">[];
  /** the batch's filed date, printed as the band's period label */
  latestBatchFiled: string | null;
  /** hits per page (defaults to SIGNAL_HITS_PAGE_SIZE); the pager covers the rest */
  renderCap?: number;
}

/** the device-local watchlist band reads this many newest active hits */
const WATCH_EMBED_CAP = 400;

function ruleBookHtml(artifact: SignalArtifact, active: Signal[]): string {
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
    `<section class="panel panel-wide si-rulebook" id="signal-rulebook" aria-label="Rule book">` +
    `<div class="panel-head"><h2 class="section-h">Rule book</h2>` +
    `<span class="panel-note">EVERY KIND · ITS EXACT RULE · WHY IT CARRIES INFORMATION · HITS THIS BUILD · STATUS · THRESHOLDS v${esc(artifact.thresholdVersion)}</span></div>` +
    /* A DECLARED PROSE TABLE (`data-multiline`, D-5): each row is a grid with
       the design's tracks, its rule and why text wrap, and it carries no
       flexible column. */
    `<div class="table-scroll"><table class="etable etable-compact si-table" data-multiline>` +
    `<caption class="visually-hidden">Signal rules — family, kind, exact rule, why it is informative, hits in the retained window, status</caption>` +
    `<thead><tr><th scope="col">Family</th><th scope="col" class="c-kind">Kind</th><th scope="col">Rule</th><th scope="col">Why it's informative</th><th scope="col" class="c-num">Hits</th><th scope="col" class="c-num">Status</th></tr></thead>` +
    `<tbody>${rows.join("\n")}</tbody></table></div>` +
    `<p class="section-note">Thresholds are calibrated per kind and versioned; a kind whose measured volume falls outside its declared bounds is <span class="si-late">WITHHELD</span> with a typed reason, never emitted anyway. ` +
    `Institutional kinds wait on closed 13F periods and are not simulated. <a href="/methodology/#signals">methodology §signals ↗</a></p>` +
    `</section>`
  );
}

function hitsHtml(artifact: SignalArtifact, active: Signal[], ctx: RenderCtx, pageSize: number, compactN: number): string {
  const sorted = sortHits(active);
  /* R11/R12: the first page is the DEFAULT view — listed stocks only, exact
     repeats collapsed to one line — the same `hitsView` the pager repaints
     through, so the server and the client cannot disagree about it. */
  const view = hitsView(sorted, DEFAULT_HIT_FILTER);
  const shown = view.lines.slice(0, pageSize);
  const collapsed = shown.length > compactN;
  const cols = signalHitColumns(active);
  const pageCount = Math.max(1, Math.ceil(view.lines.length / pageSize));
  const kinds = RULE_BOOK.filter((r) => active.some((s) => s.kind === r.kind));
  /* R17: filter by RULE (kind) and by the device-local watchlist; the family
     stays on the row as data so a family view can still be composed. */
  const seg =
    `<div class="seg si-hit-filter" role="group" aria-label="Filter hits by rule">` +
    `<button type="button" data-kind="all" aria-pressed="true">All</button>` +
    kinds.map((r) => `<button type="button" data-kind="${esc(r.kind)}" aria-pressed="false">${esc(r.short)}</button>`).join("") +
    `</div>` +
    `<label class="filter-check" for="signal-watched-only"><input type="checkbox" id="signal-watched-only" aria-label="watched members and tickers only — stored in this browser" /> watched only</label>` +
    /* R12: checked by default and never persisted (`autocomplete="off"` stops
       a browser restoring it; the island also resets it on load). The hidden
       count beside it is the reader's cue that the view is filtered. */
    `<label class="filter-check" for="signal-stocks-only"><input type="checkbox" id="signal-stocks-only" checked autocomplete="off" /> Listed stocks only</label>` +
    `<span class="si-hidden-count" id="signal-hidden-count" data-hidden="${view.hidden}">${esc(hitsHiddenText(view.hidden, true))}</span>`;
  const body = sorted.length === 0
    ? `<tr><td colspan="${cols.columns.length}" class="si-empty">Zero hits in the retained window — a computed answer over every rule, not missing coverage.</td></tr>`
    : shown.length === 0
      ? `<tr><td colspan="${cols.columns.length}" class="si-empty">No hits match this view — a computed answer over every rule, not missing coverage.</td></tr>`
      : hitsBodyHtml(shown, ctx, compactN, cols.columns);
  const range = hitsRangeText(0, shown.length, view.lines.length, view.hits, pageSize);
  return (
    `<section class="panel panel-wide si-hits" id="signal-hits" aria-label="Hits" data-page-size="${pageSize}" data-compact-rows="${compactN}" data-total="${sorted.length}" data-lines="${view.lines.length}">` +
    `<div class="panel-head"><h2 class="section-h">Hits</h2>` +
    `<span class="panel-note">RETAINED WINDOW ${esc(artifact.coverageFrom)} → ${esc(artifact.coverageTo)} · NEWEST FIRST · EVERY HIT CARRIES ITS RECEIPT</span>` +
    seg + `</div>` +
    /* No fixed-height box: the page scrolls, never the table. The wrapper is a
       focusable, named "scroll sideways" region ONLY while the table overflows
       it (review R-8): at a width where nothing scrolls, a tab stop that
       announces sideways scrolling is a false statement. The signals island
       sets and clears the three attributes from the measured overflow; the
       name it uses rides here. */
    `<div class="table-scroll si-hits-scroll" data-scroll-region="${esc(SIGNAL_HITS_REGION_NAME)}"><table class="etable etable-compact si-table"${dataColumnsAttr(cols)}>` +
    `<caption class="visually-hidden">Signal hits, newest filed first</caption>` +
    `<thead><tr>${SIGNAL_HIT_COLUMNS.filter((c) => cols.columns.includes(c.toLowerCase())).map((c) => thHtml({ label: c, mark: null, cls: SIGNAL_HIT_COLUMN_CLASSES[c], col: c.toLowerCase() })).join("")}</tr></thead>` +
    `<tbody id="signal-hits-body"${collapsed ? ' data-collapsed="true"' : ""}>${body}</tbody></table></div>` +
    tableFootReasonHtml(cols) +
    /* The page's compact bound names itself — "1–7 of the 50 hits on this
       page" — beside the pager's whole-set range (the changes-table grammar). */
    compactDisclosure({
      rootId: "signal-hits-body",
      total: shown.length,
      shown: Math.min(compactN, shown.length),
      noun: "lines",
      boundNoun: "lines on this page",
      definite: true,
      domBacked: true,
    }) +
    `<div class="feed-foot"><div class="pager">` +
    `<span class="pager-range" id="signal-hits-range" tabindex="-1">${esc(range)}</span>` +
    `<button class="pager-btn is-unavailable" id="signal-hits-prev" aria-disabled="true">← Prev</button>` +
    `<button class="pager-btn${pageCount > 1 ? "" : " is-unavailable"}" id="signal-hits-next" aria-disabled="${pageCount > 1 ? "false" : "true"}">Next →</button>` +
    `</div></div>` +
    `<p class="section-note" id="signal-hits-count" data-total="${active.length}" data-shown="${shown.length}">` +
    `<span class="si-stamp">PTR</span> / <span class="si-stamp">eFD</span> = the source regime of the underlying row · ` +
    `magnitudes are the row's statutory range, never narrowed · ${fmtInt(active.length)} ${active.length === 1 ? "hit" : "hits"} in the window · ` +
    `the complete artifact: <a href="/signals/data/signals.v1.json">signals.v1.json</a>.</p>` +
    `<p class="visually-hidden" id="signal-hits-status" role="status" aria-live="polite"></p>` +
    `<noscript><p class="section-note">Paging and filtering need JavaScript; the first ${fmtInt(pageSize)} lines of listed-stock hits are listed above regardless, and the artifact holds every hit.</p></noscript>` +
    `</section>`
  );
}

/** The lag distribution's rows: one per (member, lag), at most 8. */
function lagRows(deps: SignalsPageDeps): { name: string; party: string; lag: number; n: number; traded: string | null; filed: string }[] {
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
function lagBandHtml(deps: SignalsPageDeps): string {
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
    `<section class="panel si-lagband" aria-label="Lag distribution">` +
    `<div class="panel-head"><h2 class="section-h">Lag distribution</h2>` +
    `<span class="panel-note">TRADE → FILING · LATEST BATCH${deps.latestBatchFiled ? ` FILED ${esc(deps.latestBatchFiled)}` : ""} · TICK = 45 DAYS</span></div>` +
    body +
    `</section>`
  );
}

function rateBandHtml(deps: SignalsPageDeps, active: Signal[], artifact: SignalArtifact): string {
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
    `<section class="panel si-rateband" aria-label="Hit rate by family">` +
    `<div class="panel-head"><h2 class="section-h">Hit rate by family</h2>` +
    `<span class="panel-note">HITS PER 1,000 ROWS FILED IN THE WINDOW · ALL ASSET TYPES · RARER = MORE INFORMATIVE</span></div>` +
    (n == null
      ? `<p class="section-note">The evaluated-row count is not available, so no rate is stated.</p>`
      : `<dl class="si-rates">` +
        rates
          .map(
            (r) =>
              `<div class="si-rate${r.withheld ? " si-withheld" : ""}"><dt>${esc(FAMILY_LABEL[r.family])}</dt><dd>` +
              `<span class="si-bar" aria-hidden="true"><span class="si-bar-fill si-fill-${r.family.toLowerCase()}" style="width:${r.rate == null ? 0 : ((r.rate / max) * 100).toFixed(1)}%"></span></span>` +
              `<span class="si-rate-val">${esc(rateText(r))}<span class="visually-hidden"> — ${fmtInt(r.hits)} hits</span></span></dd></div>`,
          )
          .join("") +
        `</dl>` +
        `<p class="section-note">${fmtInt(n)} rows filed inside the window` +
        (artifact.dateAnomaliesExcluded > 0 ? ` · ${fmtInt(artifact.dateAnomaliesExcluded)} date-anomaly rows excluded before any rule ran` : "") +
        `. A rule that fires on 5% of rows is a filter; one that fires on 0.1% is a signal. Rates are published so "unusual" can be calibrated.</p>`) +
    `</section>`
  );
}

function watchBandHtml(active: Signal[], artifact: SignalArtifact): string {
  const newest = [...active]
    .sort((a, b) => (a.occurrence.filedDate < b.occurrence.filedDate ? 1 : a.occurrence.filedDate > b.occurrence.filedDate ? -1 : 0))
    .slice(0, WATCH_EMBED_CAP);
  // Compact, columnar embed: the client joins it against the device-local
  // watch store. Strings are JSON-escaped and the block is `</script>`-safe.
  const payload = serializeInlineJson({
    v: 1,
    cap: WATCH_EMBED_CAP,
    total: active.length,
    /* K-7 (M3 review): "cohort" rides along (appended, so no index moves)
       so the watch band can state the receipt's regime as the hit rows do */
    /* R10 (SIGNALS-CLARITY M2): what was traded rides along, appended (no
       index moves), so a watched hit prints the same sentence as the hit
       rows. A missing field embeds as null. */
    cols: ["id", "kind", "bioguide", "name", "ticker", "low", "high", "traded", "filed", "receipt", "cohort", "side", "asset", "assetType", "owner", "stk"],
    rows: newest.map((s) => [
      s.id,
      s.kind,
      s.entities.bioguide,
      s.entities.memberName,
      s.entities.ticker,
      s.magnitude.low,
      s.magnitude.high,
      s.occurrence.tradeDate,
      s.occurrence.filedDate,
      s.receipts[0] ?? "",
      s.cohort,
      s.side ?? null,
      s.asset ?? null,
      s.assetType ?? null,
      s.owner ?? null,
      signalIsListedStock(s),
    ]),
  });
  return (
    `<section class="panel panel-wide si-watchband" id="signal-watch" aria-label="Watchlist" data-build-id="${esc(artifact.buildId)}" data-coverage-from="${esc(artifact.coverageFrom)}">` +
    `<div class="panel-head"><h2 class="section-h"><span class="si-gold" aria-hidden="true">◆</span> Watchlist</h2>` +
    `<span class="panel-note">THIS BROWSER ONLY · NO ACCOUNT · NEW-SINCE-LAST-LOOK · SIGNALS ON WATCHED SUBJECTS SURFACE HERE</span>` +
    `<span class="si-watch-controls"><span class="chips si-watch-chips" id="signal-watch-chips"></span>` +
    `<button type="button" class="pager-btn" id="signal-watch-seen" disabled>Mark all seen</button></span></div>` +
    `<div class="table-scroll"><table class="etable etable-compact si-table" id="signal-watch-table">` +
    `<caption class="visually-hidden">Signal hits on watched members and tickers</caption>` +
    `<thead><tr>${SIGNAL_WATCH_COLUMNS.map(([label, cls]) => `<th scope="col" class="${cls}">${esc(label)}</th>`).join("")}</tr></thead>` +
    `<tbody id="signal-watch-body"><tr><td colspan="${SIGNAL_WATCH_COLUMNS.length}" class="si-empty" id="signal-watch-empty">Nothing watched on this device yet. Star a member on <a href="/congress/">the feed</a> or a ticker on its page; hits on watched subjects appear here.</td></tr></tbody></table></div>` +
    `<p class="section-note" id="signal-watch-note">Watch state lives in this browser's storage. Watching a member or ticker pins their signal hits here, and the last-seen marker separates what is new. ` +
    `<noscript>Reading the watchlist needs JavaScript; nothing is stored or sent without it.</noscript></p>` +
    `<script type="application/json" id="signal-watch-data">${payload}</script>` +
    `</section>`
  );
}

/* ---------- the page body ---------- */

export function signalsBody(artifact: SignalArtifact, ctx: RenderCtx, deps?: SignalsPageDeps): string {
  const d: SignalsPageDeps = deps ?? { rowsEvaluated: null, latestBatch: [], latestBatchFiled: null };
  // Tombstones are lifecycle HISTORY — they never sit in the
  // active tables or counts wearing an active face.
  const active = artifact.signals.filter((s) => s.status === "active");
  const superseded = artifact.signals.filter((s) => s.status === "superseded");
  // Rows whose kind was WITHHELD this build were not evaluated —
  // they are neither active nor retracted, and are reported with the
  // withholding that caused it.
  const unevaluated = artifact.signals.filter((s) => s.status === "unevaluated");
  const activeKinds = new Set(active.map((s) => s.kind));
  const withheldKinds = artifact.withheld.length;
  const evaluatedKinds = RULE_BOOK.filter((r) => !artifact.withheld.some((w) => w.kind === r.kind)).length;

  /* R13: the listed-stock hits, the population the page's trade summaries describe */
  const listed = active.filter(signalIsListedStock);

  /* --- ledger --- R7: Congress only; the two permanent "—" tiles (13F hits,
     cross-regime) are gone — the rule book still says why institutional kinds
     wait. R13: the Congress tile states the total and the listed-stock count. */
  const ledger = disclosureLedger([
    { label: "Active kinds", value: fmtInt(evaluatedKinds), detail: `${fmtInt(withheldKinds)} withheld this build · 1 by design`, subKind: "count" },
    { label: "Hits · Congress", value: fmtInt(active.length), detail: `${fmtInt(listed.length)} in listed stocks · ${fmtInt(activeKinds.size)} kinds fired · ${artifact.retentionDays}-day window`, subKind: "count", tone: "green" },
  ]);

  /* --- three summaries, every one data-derived. R13: LARGEST and COMPLIANCE
     describe trades, so they read listed stocks and say so; RAREST and the
     hit rates calibrate RULES, so they read every asset type and say so. --- */
  const largest = listed
    .filter((s) => s.magnitude.low != null)
    .sort((a, b) => (b.magnitude.low ?? 0) - (a.magnitude.low ?? 0))[0];
  const lateAll = active.filter((s) => s.kind === "s6-late-large");
  const late = lateAll.filter(signalIsListedStock);
  const lateOther = lateAll.length - late.length;
  const lateOtherText = lateOther > 0 ? ` · +${fmtInt(lateOther)} on other asset types` : "";
  const lateMax = late.map((s) => lagDays(s) ?? 0).reduce((m, v) => Math.max(m, v), 0);
  // A withheld LATE kind is an UNEVALUATED state, never a computed zero (Codex round 1, F3).
  const lateWithheld = artifact.withheld.find((w) => w.kind === "s6-late-large") ?? null;
  const rarest = RULE_BOOK.filter((r) => !artifact.withheld.some((w) => w.kind === r.kind))
    .map((r) => ({ r, n: active.filter((s) => s.kind === r.kind).length }))
    .sort((a, b) => a.n - b.n)[0];
  const stories = briefingCards([
    {
      tone: "gold",
      tag: "Largest lower bound this window · listed stocks",
      title: largest
        ? `${shortOf(largest.kind)}: ${largest.entities.memberName} · ${magnitudeText(largest.magnitude)}`
        : "No listed-stock hit in the window discloses a lower bound",
      body: largest
        ? `${signalSentence(largest).text} · ${largest.entities.ticker ?? "no ticker disclosed"} · traded ${largest.occurrence.tradeDate ?? "date not disclosed"} → filed ${largest.occurrence.filedDate}. Ranked over listed-stock hits by the provable lower bound of the statutory range, never a point estimate.`
        : "Every rule ran over the retained window; ranking needs a listed-stock hit with a disclosed lower bound.",
    },
    {
      tone: "green",
      tag: "Compliance",
      title: lateWithheld
        ? "The LATE rule was withheld this build — not evaluated"
        : lateAll.length === 0
          ? "No late-and-large disclosures in the window"
          : late.length === 0
            ? `No late-and-large disclosures in listed stocks in the window${lateOtherText}`
            : `${fmtInt(late.length)} ${late.length === 1 ? "disclosure" : "disclosures"} in listed stocks filed past the 45-day window with a lower bound ≥ $100K${lateOtherText}`,
      body: lateWithheld
        ? `Withheld (${lateWithheld.reason}): ${lateWithheld.detail} No count is stated for a rule that did not run.`
        : late.length === 0
          ? lateOther > 0
            ? `No listed-stock hit fired the LATE rule; the ${fmtInt(lateOther)} on other asset types show with "Listed stocks only" unticked.`
            : "Zero hits is the computed answer for the LATE rule, and the rule stays published."
          : `The longest listed-stock one ran +${fmtInt(lateMax)} days from trade to filing — ${fmtInt(Math.max(0, lateMax - 45))} over the STOCK Act window. Late disclosure is stated, not editorialised.`,
    },
    {
      tone: "sell",
      tag: "Rarest · highest signal · all asset types",
      title: rarest
        ? rarest.n === 0
          ? `${shortOf(rarest.r.kind)} fired zero times this window — the computed answer`
          : `${shortOf(rarest.r.kind)} is the rarest active kind: ${fmtInt(rarest.n)} ${rarest.n === 1 ? "hit" : "hits"}`
        : "No kind evaluated this build",
      body: rarest
        ? `${rarest.r.why} Rates are published beside the hits so "unusual" can be calibrated against the corpus.`
        : "Every kind was withheld with a typed reason; see the rule book.",
    },
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
    `<p class="page-lede">Behaviour that is unusual for the filer, novel for the record, or late against the statute — each with its exact rule and every receipt. ` +
    `The raw artifact: <a href="/signals/data/signals.v1.json">signals.v1.json</a></p></div>` +
    ledger +
    `</div>` +
    `<div class="design-provenance signals-meta">` +
    `<span>a signal is a fact about a filing, not a forecast — no returns computed</span>` +
    `<span class="stamp-line">recomputed every build from the same rows you can audit · coverage window ${esc(artifact.coverageFrom)} → ${esc(artifact.coverageTo)} (${artifact.retentionDays} days by filed date)</span>` +
    `<span>${note(artifact.lagCaveat + " " + artifact.lifecycleNote, { scope: "signals-meta" }, "lag", { trigger: "label", textHtml: "zero hits is a computed answer, not missing coverage" })}</span>` +
    `</div>` +
    stories +
    /* D3 (L14): band S1 — Hits (1.8fr) │ Lag distribution + Hit rate (1fr) —
       then the rule book as an EXPANDED full-width band (every rule published,
       seven rows), then the watchlist band. */
    pairBandHtml(
      "design-signals-band",
      hitsHtml(artifact, active, ctx, d.renderCap ?? SIGNAL_HITS_PAGE_SIZE, SIGNAL_HITS_COMPACT_ROWS),
      `<div class="si-side">` + lagBandHtml(d) + rateBandHtml(d, active, artifact) + `</div>`,
      { primary: "left" },
    ) +
    ruleBookHtml(artifact, active) +
    watchBandHtml(active, artifact) +
    supersededFoot +
    withheld
  );
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

/* exported for the watch band's client script — the label the row prints */
export function signalKindShort(kind: SignalKind): string {
  return shortOf(kind);
}
