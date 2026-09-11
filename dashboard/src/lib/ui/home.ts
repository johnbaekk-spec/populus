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

/* ---------- R18: the three live tiles ---------- */

import { fmtInt, fmtUsd, tickerHrefFor, note } from "../format.ts";
import type { NotableMove } from "../notable-moves.ts";
import type { Signal } from "../signals.ts";
import { MOVE_KIND_LABELS } from "../notable-moves.ts";

/** The ONE masthead claim — twelve words or fewer (R18). */
export const HOME_CLAIM = "Who's trading, from the filings themselves.";

export const HOME_TILE_ROWS = { congress: 5, moves: 5, signals: 3 } as const;

/** Latest Congress disclosures: member · ticker · side · amount · filed. The
    first range amount carries the ⓘ the old "what a number looks like here"
    card explained — a range, never a point — with the methodology link. */
export function congressTileHtml(rows: readonly TxnRow[], ctx: RenderCtx): string {
  const shown = rows.slice(0, HOME_TILE_ROWS.congress);
  const body = shown
    .map((r, i) => {
      const side = sideLabel(r.side, r.flags);
      const amount = esc(amountText(r)) + (i === 0 ? note("Amounts are disclosed as statutory ranges, never exact figures; this is the range as filed. Traded and filed dates are both kept, and every row links to its filing.", { scope: "home-congress" }, "range") : "");
      return (
        `<tr><td>${r.bioguide ? `<a href="${memberHrefFor(r.bioguide, ctx)}">${esc(r.name)}</a>` : esc(r.name)} <span class="aff ${partyClass(r.party)}">${esc(affTextOf(r))}</span></td>` +
        `<td>${r.ticker ? `<a class="mono-ticker" href="${tickerHrefFor(r.ticker, ctx)}">${esc(r.ticker)}</a>` : `<span class="none">—</span>`}</td>` +
        `<td class="${side.cls}">${esc(side.text)}</td>` +
        `<td class="c-num">${amount}</td>` +
        `<td class="c-filed">${esc(r.filed)}</td></tr>`
      );
    })
    .join("\n");
  return (
    `<section class="panel home-tile" id="home-congress" aria-label="Latest Congress disclosures">` +
    `<div class="panel-head"><h2 class="section-h">Latest Congress disclosures</h2><span class="panel-note"><a class="section-link" href="/congress/">all disclosures ↗</a></span></div>` +
    (shown.length === 0
      ? `<p class="section-note">No disclosures in this build.</p>`
      : `<div class="table-scroll"><table class="etable etable-compact"><caption class="visually-hidden">The five newest congressional disclosures</caption>` +
        `<thead><tr><th scope="col">Member</th><th scope="col">Ticker</th><th scope="col">Side</th><th scope="col" class="num">Amount</th><th scope="col">Filed</th></tr></thead>` +
        `<tbody>${body}</tbody></table></div>`) +
    `<p class="section-note">Amounts are ranges as filed · <a href="/methodology/#ranges">why ranges ↗</a></p>` +
    `</section>`
  );
}

/** Notable-manager moves this quarter (R14 data). */
export function movesTileHtml(moves: readonly NotableMove[], period: string | null, filerHref: (cik: string) => string): string {
  const shown = moves.slice(0, HOME_TILE_ROWS.moves);
  const body = shown
    .map(
      (m) =>
        `<tr><td><a href="${esc(filerHref(m.cik))}">${esc(m.manager)}</a></td>` +
        `<td>${m.ticker ? `<span class="mono-ticker">${esc(m.ticker)}</span> ` : ""}<span class="filed-name">${esc(m.issuer)}</span></td>` +
        `<td><span class="qoq-chip qoq-${m.kind}">${MOVE_KIND_LABELS[m.kind]}</span></td>` +
        `<td class="c-num ${m.delta_value == null ? "c-muted" : m.delta_value < 0 ? "c-sell" : "c-buy"}">${m.delta_value == null ? "—" : (m.delta_value < 0 ? "−" : "+") + esc(fmtUsd(Math.abs(m.delta_value)))}</td>` +
        `<td class="c-filed">${esc(m.filed ?? "—")}</td></tr>`,
    )
    .join("\n");
  return (
    `<section class="panel home-tile" id="home-moves" aria-label="Notable-manager moves this quarter">` +
    `<div class="panel-head"><h2 class="section-h">Notable managers · ${period ? `quarter ended ${esc(period)}` : "this quarter"}</h2><span class="panel-note"><a class="section-link" href="/institutional/">all moves ↗</a></span></div>` +
    (shown.length === 0
      ? `<p class="section-note">${period ? "No notable-manager moves are on record for this quarter." : "No closed quarter is available yet — 13F filings arrive up to 45 days after quarter end."}</p>`
      : `<div class="table-scroll"><table class="etable etable-compact"><caption class="visually-hidden">Largest notable-manager position changes this quarter</caption>` +
        `<thead><tr><th scope="col">Manager</th><th scope="col">Ticker · Issuer</th><th scope="col">Change</th><th scope="col" class="num">Δ $</th><th scope="col">Filed</th></tr></thead>` +
        `<tbody>${body}</tbody></table></div>`) +
    `<p class="section-note">Quarter-end positions, by shares · never current holdings</p>` +
    `</section>`
  );
}

/** Top signals, ticker first. */
export function signalsTileHtml(signals: readonly Signal[], ctx: RenderCtx, labelOf: (kind: Signal["kind"]) => string): string {
  const shown = signals.slice(0, HOME_TILE_ROWS.signals);
  const body = shown
    .map(
      (s) =>
        `<tr><td>${s.entities.ticker ? `<a class="mono-ticker" href="${tickerHrefFor(s.entities.ticker, ctx)}">${esc(s.entities.ticker)}</a>` : `<span class="none">—</span>`}</td>` +
        `<td>${s.entities.bioguide ? `<a href="${memberHrefFor(s.entities.bioguide, ctx)}">${esc(s.entities.memberName)}</a>` : esc(s.entities.memberName)}</td>` +
        `<td><span class="si-kind">${esc(labelOf(s.kind))}</span></td>` +
        `<td class="c-filed">${esc(s.occurrence.filedDate)}</td></tr>`,
    )
    .join("\n");
  return (
    `<section class="panel home-tile" id="home-signals" aria-label="Top signals">` +
    `<div class="panel-head"><h2 class="section-h">Signals</h2><span class="panel-note"><a class="section-link" href="/signals/">every rule ↗</a></span></div>` +
    (shown.length === 0
      ? `<p class="section-note">Zero hits in the retained window — a computed answer, not missing coverage.</p>`
      : `<div class="table-scroll"><table class="etable etable-compact"><caption class="visually-hidden">Newest signal hits</caption>` +
        `<thead><tr><th scope="col">Ticker</th><th scope="col">Who</th><th scope="col">What</th><th scope="col">Filed</th></tr></thead>` +
        `<tbody>${body}</tbody></table></div>`) +
    `<p class="section-note">A signal is a fact about a filing, not a forecast · ${fmtInt(signals.length)} hits in the window</p>` +
    `</section>`
  );
}
