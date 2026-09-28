/* Pure page/section renderers. Every entity body is a string function called
   by the thin .astro page for SSR AND by the generic-route client driver —
   parity is by construction (one function, two callers). No Node APIs, no DOM.

   Honesty grammar: G1–G7 via the canonical format.ts components; charts
   zero-based, gaps stay gaps, no midpoints; NULL-honest institutional
   integers; the as-of time stamp every 13F table carries. */

/* ui/shared.ts — pieces shared across the ui/ domain modules.
   `asOfNote` and `netCellHtml` are SHARED-PRIVATE: exported here for the
   sibling domain modules only, deliberately NOT re-exported by ui/index.ts. */

import { esc, hangMark, noteFromHtml } from "../format.ts";
import { type NetInterval, netDirection, netIntervalText } from "../derive.ts";

export interface BuildStamps {
  buildId: string;
  generatedAt: string; // "YYYY-MM-DD HH:MM UTC"
  generatedAtDate: string; // "YYYY-MM-DD"
}

/* ---------- small shared pieces ---------- */

export function breadcrumb(parts: { text: string; href?: string }[]): string {
  return (
    `<nav class="crumb" aria-label="Breadcrumb">` +
    parts
      .map((p) =>
        p.href ? `<a href="${esc(p.href)}">${esc(p.text)}</a>` : `<span>${esc(p.text)}</span>`,
      )
      .join(" / ") +
    `</nav>`
  );
}

/* The build id is OUT of this stamp. It is not a fact about the window
   the panel rendered, it is a fact about the deploy, and `Base.astro`'s footer
   already prints it once per page — `m1-layout.test.ts:52` pins exactly that
   "rendered once, in the footer" rule. Repeating it beside every window
   statement spent characters on the least reader-relevant token in the line.
   The one caller that is NOT a `.panel-note` — the signals page's `.si-asof`,
   out of scope for this run — appends it explicitly, so that surface's bytes
   are unchanged. */
export function asOfNote(stamps: BuildStamps): string {
  return `as of ${esc(stamps.generatedAt)}`;
}

/** Sector keys as words (DESIGN-POLISH M3, R22, T3.6). The keys are the site's
    own taxonomy (`src/populus/sic_taxonomy.yaml`, taxonomy v1); the words are
    the SIC Manual's (1987) division titles, as published by OSHA
    (https://www.osha.gov/data/sic-manual, read 2026-09-26: "Division A:
    Agriculture, Forestry, And Fishing" … "Division J: Public Administration").
    `nonclassifiable` is the manual's Major Group 99 title; `unknown` is the
    taxonomy's declared bucket (no SIC, a malformed one, or one outside every
    range) and says so. A test fails when the taxonomy gains a key this table
    does not label. */
export const SECTOR_LABELS: Readonly<Record<string, string>> = {
  agriculture: "Agriculture, Forestry, and Fishing",
  mining: "Mining",
  construction: "Construction",
  manufacturing: "Manufacturing",
  "transport-utilities": "Transportation, Communications, Electric, Gas, and Sanitary Services",
  wholesale: "Wholesale Trade",
  retail: "Retail Trade",
  "finance-insurance-realestate": "Finance, Insurance, and Real Estate",
  services: "Services",
  "public-administration": "Public Administration",
  nonclassifiable: "Nonclassifiable Establishments",
  unknown: "Unknown (no SIC division on record)",
};

/** The words for a sector key; a key the table does not know prints as itself
    (never guessed into a division). */
export function sectorLabel(key: string): string {
  return Object.hasOwn(SECTOR_LABELS, key) ? SECTOR_LABELS[key]! : key;
}

/** The smallest statutory amount bucket's upper bound ($1,001–$15,000): a net
    range inside ±this cannot tell a flat position from one small trade. */
export const FLAT_NET_BOUND = 15_000;

/** The member flows' Net kind word (DESIGN-POLISH M3, R18, D-15): NET BUY when
    the whole net range is above zero, NET SELL when it is below, FLAT when it
    is BOUNDED on both sides, spans zero, and stays inside the smallest bucket
    (both bounds within ±$15,000 — W-10, coordinator ruling on the M3 review),
    "±" when a bounded range spans zero more widely (−$15K to +$1.05M is not
    "flat"), and "—" when no direction can be stated — an undisclosed side, or
    an open bound whose range still reaches across zero. `why` says so for
    assistive technology; the Net range cell beside it prints the range itself
    ("not disclosed", "unbounded", "at least …"). */
export function netKindWord(net: NetInterval): { word: "NET BUY" | "NET SELL" | "FLAT" | "±" | "—"; why: string | null } {
  const dir = netDirection(net);
  if (dir === "accumulation") return { word: "NET BUY", why: null };
  if (dir === "disposal") return { word: "NET SELL", why: null };
  if (net.kind === "empty") return { word: "FLAT", why: "the net range spans zero" };
  if (net.kind === "finite") {
    return Math.abs(net.low) <= FLAT_NET_BOUND && Math.abs(net.high) <= FLAT_NET_BOUND
      ? { word: "FLAT", why: "the net range spans zero" }
      : { word: "±", why: "net range spans zero" };
  }
  return {
    word: "—",
    why: net.kind === "undisclosed" ? "no direction: a side of the net range was not disclosed" : "no direction: the net range is open and reaches across zero",
  };
}

/* K-10 (M3 review): this note sat above `SECTOR_LABELS`; it is about the
   Net column's ≈ marker, so it lives here.

   `footnotesId` is gone from this path. It existed ONLY so the ≈
   marker could point at whichever of /congress/'s two ranking footnote blocks
   belonged to its section. Both blocks are deleted and their text moves onto the
   Net column's header note, so there is no id left to thread — and threading a
   dangling one would be the broken internal link the link-integrity check forbids. The
   marker itself stays visible (LD3); only its href is gone. */
export function netCellHtml(net: NetInterval, overlapsPrev: boolean): string {
  const dir = netDirection(net);
  const dirHtml =
    dir === "accumulation"
      ? `<span class="net-dir net-acc"> net accumulation</span>`
      : dir === "disposal"
        ? `<span class="net-dir net-dis"> net disposal</span>`
        : "";
  // The separating space lives INSIDE the direction span: where the words are
  // hidden, a space left outside it would push the digits off the column edge.
  // The ≈ hangs past the digits (zero advance) — its column reserves the slot.
  const overlap = overlapsPrev ? hangMark("≈") : "";
  return `${esc(netIntervalText(net))}${dirHtml}${overlap}`;
}

/** A summary card's tag colour, by MEANING (D-12): blue, gold, green, or the
    SELL text colour. */
export type StoryTone = "blue" | "gold" | "green" | "sell";
/** The design's positional default (blue, gold, sell) for a page that names none. */
const STORY_TONES_DEFAULT: readonly StoryTone[] = ["blue", "gold", "sell"];

/** Reference briefing band. Text is data-derived by callers and escaped here. */
export function briefingCards(cards: readonly { tag: string; title: string; body: string; tone?: StoryTone }[]): string {
  return `<section class="design-briefing" aria-label="Disclosure summary">${cards.map((card, i) =>
    `<article class="design-story" data-tone="${card.tone ?? STORY_TONES_DEFAULT[i % STORY_TONES_DEFAULT.length]}"><div class="design-story-tag">${esc(card.tag)}</div>` +
    `<h2>${esc(card.title)}</h2><p>${esc(card.body)}</p></article>`
  ).join("")}</section>`;
}

/* ---------- the ONE page-header ledger (DESIGN-POLISH M2, R15 / T2.8) ----------

   Every page header renders its figures here: the four design routes, the
   member and filer pages, the Congress ticker page and both holders headers.
   (`statTiles` stays only for the holdings identity-coverage strip, which is
   not a page header — declared debt.)

   Markup is a VALID description list: each figure is one `<div>` group holding
   its `<dt>` label, the value as a `<dd>`, and the sub as a SECOND `<dd>`
   (a `<small>` directly inside the group was invalid content, A12).

   The SUB RULE (H-4): a value stays on one line; a sub is one line when it
   fits and wraps to at most two, never cut. A sub that is NOT a count, a ≥ or
   estimate qualifier, a date basis or an absence statement, and runs past 32
   characters, must put its extra detail in the figure's note — the
   renderer REFUSES such a sub rather than print it (a shared renderer rejects
   degenerate input; the caller fixes it). Counts, qualifiers, date bases and
   absence statements always stay visible in the sub. */

export type LedgerTone = "ink" | "blue" | "gold" | "green";
export const LEDGER_TONES: readonly LedgerTone[] = ["ink", "blue", "gold", "green"];
/** What a sub states. Every kind but `plain` is honesty text that must stay
    visible whatever its length. */
export type LedgerSubKind = "count" | "qualifier" | "date" | "absence" | "plain";
/** The longest a `plain` sub may run before its detail belongs in the note. */
export const LEDGER_PLAIN_SUB_MAX = 32;
/** The most characters a value holds in a NARROW figure: 150px at the value's
    26px mono (≈15.1px a character) and the half column of the two-column
    ledger at 360px. A longer value — a member's net-flow range, "−$250K to
    −$75.0K" — is WIDE (`data-wide`): the figure takes the value's width above
    the fold and a full row of the ledger at it, so the value is never cut and
    never runs into the next figure (DESIGN-POLISH M2 review C2-2). */
export const LEDGER_VALUE_NARROW_MAX = 10;
/** The characters one line of a NARROW figure's sub holds: the figure's 150px
    floor at the sub's 10.5px mono, 6.3px a character (the fold's half column is
    wider: 156px at 360). A sub that would take a THIRD line there — a long
    issuer name in the /institutional/ "Consensus add", "MICROSOFT CORP · 8
    notable managers opened it" — makes the figure WIDE too (DESIGN-POLISH M2
    delta review), the C2-2 mechanism: its sub sizes the figure above the fold
    and it takes a full row at it, so the sub keeps the two-line rule. */
export const LEDGER_SUB_NARROW_CHARS = 23;

/** The lines `text` takes at `chars` characters a line — a deterministic
    character count, never a measurement. Words break only at spaces (greedy,
    as the browser fills a line), and a word longer than a line breaks every
    `chars` characters (the sub wraps anywhere). A flat length would not do:
    the 45-character Microsoft sub fits 2 × 23 characters and still wraps to
    three lines, because a line cannot end mid-word. */
export function ledgerSubLines(text: string, chars = LEDGER_SUB_NARROW_CHARS): number {
  let lines = 0;
  let used = 0;
  for (const word of text.split(/\s+/).filter(Boolean)) {
    let w = [...word].length;
    if (used > 0 && used + 1 + w <= chars) {
      used += 1 + w;
      continue;
    }
    lines += Math.ceil(w / chars);
    w %= chars;
    used = w === 0 ? chars : w;
  }
  return lines;
}

/** A figure is WIDE when its value holds more characters than a narrow figure
    (C2-2) OR its sub would take more than two lines in one (the M2 delta
    review). One predicate, shared by the renderer and its test. */
export function ledgerFigureWide(item: Pick<LedgerItem, "value" | "detail">): boolean {
  return [...item.value].length > LEDGER_VALUE_NARROW_MAX || ledgerSubLines(item.detail) > 2;
}

export interface LedgerItem {
  label: string;
  value: string;
  /** the sub line under the value; "" renders no sub */
  detail: string;
  /** what the sub states (default `plain`, the kind the 32-character rule binds) */
  subKind?: LedgerSubKind;
  /** the figure's colour (default ink), per the design's per-figure tones */
  tone?: LedgerTone;
  /** pre-escaped html: the figure's explanation, opened from its LABEL (a
      label trigger — no glyph beside it) */
  noteHtml?: string;
}

export interface LedgerOpts {
  /** the note scope; required when any item carries a note */
  scope?: string;
  /** an accessible name for the list (the filer ledger keeps "Period
      statistics for {period}") */
  label?: string;
}

/** Throws on a figure the rules above refuse. Exported so the rule is one
    predicate its test and the renderer share. */
export function ledgerItemProblem(item: LedgerItem): string | null {
  if (!LEDGER_TONES.includes(item.tone ?? "ink")) return `tone ${String(item.tone)} is not one of ${LEDGER_TONES.join(", ")}`;
  const kind = item.subKind ?? "plain";
  if (kind === "plain" && item.detail.length > LEDGER_PLAIN_SUB_MAX) {
    return `the plain sub "${item.detail}" runs ${item.detail.length} characters (at most ${LEDGER_PLAIN_SUB_MAX}); put its detail in the figure's note, or declare it a count, qualifier, date basis or absence statement`;
  }
  return null;
}

export function disclosureLedger(items: readonly LedgerItem[], opts: LedgerOpts = {}): string {
  if (items.length === 0) throw new Error("disclosureLedger: a ledger needs at least one figure");
  return (
    `<dl class="design-ledger"${opts.label ? ` aria-label="${esc(opts.label)}"` : ""}>` +
    items
      .map((item) => {
        const problem = ledgerItemProblem(item);
        if (problem) throw new Error(`disclosureLedger (${item.label}): ${problem}`);
        if (item.noteHtml && !opts.scope) throw new Error(`disclosureLedger (${item.label}): a figure note needs a scope`);
        const label = item.noteHtml
          ? noteFromHtml(item.noteHtml, { scope: opts.scope! }, item.label, { trigger: "label", textHtml: esc(item.label), name: item.label })
          : esc(item.label);
        return (
          `<div class="ledger-fig" data-tone="${item.tone ?? "ink"}"${ledgerFigureWide(item) ? " data-wide" : ""}>` +
          `<dt>${label}</dt>` +
          `<dd class="ledger-value">${esc(item.value)}</dd>` +
          (item.detail ? `<dd class="ledger-sub">${esc(item.detail)}</dd>` : "") +
          `</div>`
        );
      })
      .join("") +
    `</dl>`
  );
}

/** R24: a surface with no data in this build renders ONE line — its name and
    the reason — never an empty frame with a table skeleton. The reason is
    kept verbatim (absence is stated, never simulated); `context` and
    `columns` are still accepted from callers but no longer drawn. */
export function unavailableDesignPanel(title: string, _context: string, _columns: readonly string[], reason: string, cls = ""): string {
  return `<p class="design-unavailable-line ${esc(cls)}"><strong>${esc(title)}</strong> — not available in this build. ${esc(reason)}</p>`;
}

/** R24: the ONE "Planned:" line a page carries in place of empty panels — a
    frame with nothing but a paragraph in it is removed, and what it would have
    held is named here once. */
export function plannedLine(items: readonly string[]): string {
  return `<p class="planned-line"><span class="badge-planned">PLANNED</span> ${items.map((i) => esc(i)).join(" · ")}</p>`;
}

/** The opening tag of a cell's ROOT element, or null when the cell does not
    start with one. A band cell is exactly one element: each top-level element
    of a grid band is its own grid cell. */
function cellRootTag(html: string): string | null {
  return /^\s*<[a-zA-Z][\w-]*\b[^>]*>/.exec(html)?.[0] ?? null;
}

/** An EMPTY-STATE cell (R10): its root is the one stated line a surface
    renders when it has nothing to show — marked `data-empty-state` by its
    renderer, or the `.design-unavailable-line` of `unavailableDesignPanel`.
    The collapse is derived from this marker, never from a flag a page
    computes beside the renderer (DESIGN-POLISH M2 review Q2-3). */
export function isEmptyStateCell(html: string): boolean {
  const tag = cellRootTag(html);
  return !!tag && (/\sdata-empty-state(?=[\s=>])/.test(tag) || /\sclass="[^"]*\bdesign-unavailable-line\b/.test(tag));
}

/** Mark a band cell as the pair's PRIMARY cell (`data-pair-primary`): the
    wider cell the reader came for, which a side cell never truncates
    (coordinator decision CD-1). Throws on a cell that is not one element. */
export function markPairPrimary(html: string): string {
  const tag = cellRootTag(html);
  if (!tag) throw new Error("markPairPrimary: a band cell must start with its one root element");
  return html.replace(/^(\s*<[a-zA-Z][\w-]*)/, "$1 data-pair-primary");
}

/** The number of header cells of a cell's ONE table, or null when the cell
    holds no table or more than one. */
function loneTableColumns(html: string): number | null {
  if ((html.match(/<table\b/g) ?? []).length !== 1) return null;
  const head = /<thead\b[^>]*>([\s\S]*?)<\/thead>/.exec(html)?.[1];
  return head ? (head.match(/<th\b/g) ?? []).length : null;
}

/** The widest a table may be and still be capped at the half-band width when
    it stands alone in a collapsed pair (coordinator decision CD-2). */
export const PAIR_NARROW_TABLE_COLUMNS = 3;

/** A paired band (DESIGN-POLISH M2, R10): two cells on the design's grid
    fractions with a 1px seam, one of them the PRIMARY cell
    (`data-pair-primary`, CD-1): the band-balance check requires the primary to
    end no higher than 96px above the side cell, never the reverse.

    A pair whose one cell is an empty-state line (`isEmptyStateCell`) COLLAPSES
    to one full-width column: the content cell first (it becomes the primary),
    the line under it as the band's LAST child, and `data-collapsed="empty-state"`
    on the band — derived here from the cells themselves, so no page can claim a
    collapse its cells do not show (review Q2-3). A content cell that is then a
    lone table of at most three columns carries `data-pair-narrow`, which caps it
    at the half-band width, the design's cell width (CD-2). Never an empty or
    placeholder cell. */
export function pairBandHtml(cls: string, left: string, right: string, opts: { primary: "left" | "right"; id?: string }): string {
  if (!cellRootTag(left) || !cellRootTag(right)) throw new Error("pairBandHtml: each cell must be one element");
  const emptyLeft = isEmptyStateCell(left), emptyRight = isEmptyStateCell(right);
  const collapsed = emptyLeft !== emptyRight || (emptyLeft && emptyRight);
  let cells: [string, string];
  if (!collapsed) {
    cells = opts.primary === "left" ? [markPairPrimary(left), right] : [left, markPairPrimary(right)];
  } else if (emptyLeft && emptyRight) {
    // both surfaces state their absence: two lines, nothing to measure against
    cells = [left, right];
  } else {
    const content = emptyLeft ? right : left;
    const line = emptyLeft ? left : right;
    const cols = loneTableColumns(content);
    const narrow = cols !== null && cols <= PAIR_NARROW_TABLE_COLUMNS;
    cells = [markPairPrimary(content).replace(/^(\s*<[a-zA-Z][\w-]*)/, narrow ? "$1 data-pair-narrow" : "$1"), line];
  }
  return (
    `<div class="design-band ${cls}"${opts.id ? ` id="${esc(opts.id)}"` : ""}${collapsed ? ' data-collapsed="empty-state"' : ""}>` +
    cells[0] +
    cells[1] +
    `</div>`
  );
}
