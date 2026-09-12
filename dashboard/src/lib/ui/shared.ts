/* Pure page/section renderers. Every entity body is a string function called
   by the thin .astro page for SSR AND by the generic-route client driver —
   parity is by construction (one function, two callers). No Node APIs, no DOM.

   Honesty grammar: G1–G7 via the canonical format.ts components; charts
   zero-based, gaps stay gaps, no midpoints; NULL-honest institutional
   integers; the as-of time stamp every 13F table carries. */

/* ui/shared.ts — pieces shared across the ui/ domain modules.
   `asOfNote` and `netCellHtml` are SHARED-PRIVATE: exported here for the
   sibling domain modules only, deliberately NOT re-exported by ui/index.ts. */

import { esc, fnMark } from "../format.ts";
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

/* `footnotesId` is gone from this path. It existed ONLY so the ≈
   marker could point at whichever of /congress/'s two ranking footnote blocks
   belonged to its section. Both blocks are deleted and their text moves onto the
   Net column's header note, so there is no id left to thread — and threading a
   dangling one would be the broken internal link the link-integrity check forbids. The
   marker itself stays visible (LD3); only its href is gone. */
export function netCellHtml(net: NetInterval, overlapsPrev: boolean): string {
  const dir = netDirection(net);
  const dirHtml =
    dir === "accumulation"
      ? ` <span class="net-dir net-acc">net accumulation</span>`
      : dir === "disposal"
        ? ` <span class="net-dir net-dis">net disposal</span>`
        : "";
  const overlap = overlapsPrev ? fnMark("≈") : "";
  return `${esc(netIntervalText(net))}${dirHtml}${overlap}`;
}

/** Reference briefing band. Text is data-derived by callers and escaped here. */
export function briefingCards(cards: readonly { tag: string; title: string; body: string }[]): string {
  return `<section class="design-briefing" aria-label="Disclosure summary">${cards.map(card =>
    `<article class="design-story"><div class="design-story-tag">${esc(card.tag)}</div>` +
    `<h2>${esc(card.title)}</h2><p>${esc(card.body)}</p></article>`
  ).join("")}</section>`;
}

/** Compact reference ledger, including visible denominators and period labels. */
export function disclosureLedger(items: readonly { label: string; value: string; detail: string }[]): string {
  return `<dl class="design-ledger">${items.map(item =>
    `<div><dt>${esc(item.label)}</dt><dd>${esc(item.value)}</dd><small>${esc(item.detail)}</small></div>`
  ).join("")}</dl>`;
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
