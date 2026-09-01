/* Pure page/section renderers. Every entity body is a string function called
   by the thin .astro page for SSR AND by the generic-route client driver —
   parity is by construction (one function, two callers). No Node APIs, no DOM.

   Honesty grammar: G1–G7 via the canonical format.ts components; charts
   zero-based, gaps stay gaps, no midpoints; NULL-honest institutional
   integers; the as-of time stamp every 13F table carries. */

/* ui/home.ts — Home page pieces. One of the ui/ domain modules: consumers
   import from ./index.ts only, never from this file directly. */

import {
  type TxnRow,
  type RenderCtx,
  esc,
  amountText,
  sideLabel,
  ownerNote,
  rangeBand,
  srcLink,
  memberHrefFor,
  partyClass,
} from "../format.ts";
import { affTextOf } from "../derive.ts";

/* ---------- Home pieces (the specimen comes from a real row) ---------- */

export function pickSpecimen(txns: readonly TxnRow[]): TxnRow | null {
  return (
    txns.find(
      (t) => t.ticker != null && t.traded != null && t.low != null && t.high != null,
    ) ?? null
  );
}

export function specimenCard(r: TxnRow, ctx: RenderCtx): string {
  const side = sideLabel(r.side, r.flags);
  const owner = ownerNote(r);
  const lagText = r.lag == null ? "" : ` <span class="spec-lag">+${r.lag}d</span>`;
  return (
    `<aside class="specimen" aria-label="What a number looks like here">` +
    `<div class="spec-head">what a number looks like here</div>` +
    `<div class="spec-body">` +
    `<div class="spec-row1"><span class="spec-name">${
      r.bioguide ? `<a href="${memberHrefFor(r.bioguide, ctx)}">${esc(r.name)}</a>` : esc(r.name)
    } <span class="aff ${partyClass(r.party)}">${esc(affTextOf(r))}</span></span>${srcLink(r.doc)}</div>` +
    `<div class="spec-row2"><span class="mono-ticker">${esc(r.ticker ?? "—")}</span>` +
    `<span class="spec-side ${side.cls}">${esc(side.text)}${owner ? ` <span class="owner-note">${esc(owner)}</span>` : ""}</span>` +
    `<span class="spec-amount">${esc(amountText(r))}</span></div>` +
    rangeBand(r) +
    `<div class="spec-scale" aria-hidden="true"><span>$1K</span><span>$1M</span><span>$50M+</span></div>` +
    `<div class="spec-dates">` +
    `<div><div class="spec-l">Traded</div><div class="spec-v">${esc(r.traded ?? "—")}</div></div>` +
    `<div><div class="spec-l">Filed</div><div class="spec-v">${esc(r.filed)}${lagText}</div></div>` +
    `<div><div class="spec-l">Amount</div><div class="spec-v">a range — an exact figure does not exist</div></div>` +
    `</div></div>` +
    `<div class="spec-foot">range · staleness · truncation · inference · receipt — <a href="/methodology/">the uncertainty grammar ↗</a></div>` +
    `</aside>`
  );
}

export interface ModuleCardStats {
  live: boolean;
  statLines: string[]; // mono stat lines, already true (build-derived)
}

export function moduleCard(
  name: string,
  href: string | null,
  desc: string,
  stats: ModuleCardStats,
): string {
  const badge = stats.live
    ? `<span class="badge-live">LIVE</span>`
    : `<span class="badge-planned">PLANNED</span>`;
  const inner =
    `<div class="mod-head"><span class="mod-name">${esc(name)}</span>${badge}</div>` +
    `<p class="mod-desc">${esc(desc)}</p>` +
    `<div class="mod-stats">${stats.statLines.map((l) => esc(l)).join("<br>")}</div>`;
  if (href && stats.live) {
    return `<a class="mod-card" href="${esc(href)}">${inner}</a>`;
  }
  return `<div class="mod-card mod-card-planned">${inner}</div>`;
}
