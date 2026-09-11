/* R19 (SRC §6-ii) — the Congress → 13F overlap band for one ticker, on
   /tickers/{T}/ and on the holders page. ONE derivation, ONE renderer.

   Congress half: members who disclosed the ticker in the LAST 90 DAYS by
   filed date — buyers beside sellers, each name linked, totals as statutory
   ranges (interval sums, never points).
   13F half: the registry's `notable` managers adding (new · add) or trimming
   (trim · exit) the ticker in the CLOSED quarter, read from the class-grain
   `agg_ticker_holders` (R3 tickers). Dollar figures on that side are the
   managers' REPORTED value now — a Δ$ per holder is not published at that
   grain, so none is invented. When R3 has not mapped the ticker the 13F half
   is a `Planned` badge and the Congress half still ships.
   Below both: a merged timeline, 20 rows, newest first. */

import { esc, fmtInt, fmtUsd, memberHrefFor, sideLabel, amountText, utcDayNumber, type RenderCtx, type TxnRow } from "./format.ts";
import { sumRanges, sumRangesText, excludeDateAnomalies, affTextOf } from "./derive.ts";
import { type InstData, type TickerHolderRow, tickerHoldersFor, tickerTotalsFor } from "./inst.ts";
import type { ManagerTyping } from "./manager-directory.ts";
import { partyClass } from "./format.ts";

export const OVERLAP_CONGRESS_DAYS = 90;
export const OVERLAP_TIMELINE_ROWS = 20;

export interface OverlapMember {
  key: string;
  name: string;
  bioguide: string | null;
  party: string;
  rows: TxnRow[];
}

export interface OverlapManager {
  cik: string;
  name: string;
  kind: TickerHolderRow["change_kind"];
  value_usd: number | null;
  delta_shares: number | null;
}

export interface OverlapTimelineRow {
  date: string;
  actor: string;
  href: string | null;
  move: string;
  cls: string;
  side: "congress" | "13f";
  amount: string;
}

export interface OverlapBand {
  ticker: string;
  window: { start: string; end: string };
  buyers: OverlapMember[];
  sellers: OverlapMember[];
  buyTotal: string;
  sellTotal: string;
  /** null = the ticker is not mapped (R3), so the 13F half is Planned */
  inst: null | {
    period: string;
    issuer: string;
    adding: OverlapManager[];
    trimming: OverlapManager[];
    addingValue: number;
    trimmingValue: number;
  };
  timeline: OverlapTimelineRow[];
}

function dayShift(iso: string, days: number): string {
  const n = utcDayNumber(iso);
  if (n === null) return iso;
  return new Date((n + days) * 86_400_000).toISOString().slice(0, 10);
}

export interface OverlapInputs {
  ticker: string;
  txns: readonly TxnRow[];
  generatedAtDate: string;
  inst: InstData;
  /** curated typing by CIK; only `notable` rows count on the 13F side */
  typingByCik: ReadonlyMap<string, ManagerTyping>;
  /** the closed quarter; null = none closed yet */
  period: string | null;
  ctx: RenderCtx;
  filerHref: (cik: string) => string;
}

/** The band's data. Pure; the Congress window is exactly the last 90 days by
    filed date, inclusive of the build date and of the day 90 days before it. */
export function overlapBand(i: OverlapInputs): OverlapBand {
  const start = dayShift(i.generatedAtDate, -OVERLAP_CONGRESS_DAYS);
  const end = i.generatedAtDate;
  const recent = excludeDateAnomalies(i.txns).rows.filter((r) => r.filed >= start && r.filed <= end);
  const group = (rows: TxnRow[]): OverlapMember[] => {
    const by = new Map<string, OverlapMember>();
    for (const r of rows) {
      const key = r.bioguide ?? `raw:${r.name}`;
      const m = by.get(key);
      if (m) m.rows.push(r);
      else by.set(key, { key, name: r.name, bioguide: r.bioguide, party: r.party, rows: [r] });
    }
    return [...by.values()].sort((a, b) => b.rows.length - a.rows.length || (a.name < b.name ? -1 : 1));
  };
  const buys = recent.filter((r) => r.side === "purchase");
  const sells = recent.filter((r) => r.side === "sale" || r.side === "sale_partial");
  const buyers = group(buys);
  const sellers = group(sells);

  let inst: OverlapBand["inst"] = null;
  const totals = tickerTotalsFor(i.inst, i.ticker);
  if (totals && i.period) {
    const rows = tickerHoldersFor(i.inst, i.ticker).filter((h) => h.period_of_report === i.period && i.typingByCik.get(h.cik)?.notable === true);
    const toMgr = (h: TickerHolderRow): OverlapManager => ({
      cik: h.cik,
      name: i.typingByCik.get(h.cik)?.display_name ?? h.filer_name,
      kind: h.change_kind,
      value_usd: h.value_usd,
      delta_shares: h.delta_shares,
    });
    const adding = rows.filter((h) => h.change_kind === "new" || h.change_kind === "add").map(toMgr);
    const trimming = rows.filter((h) => h.change_kind === "trim" || h.change_kind === "exit").map(toMgr);
    const byValue = (a: OverlapManager, b: OverlapManager): number => (b.value_usd ?? -1) - (a.value_usd ?? -1) || (a.cik < b.cik ? -1 : 1);
    adding.sort(byValue);
    trimming.sort(byValue);
    inst = {
      period: i.period,
      issuer: totals.issuer_name,
      adding,
      trimming,
      addingValue: adding.reduce((s, m) => s + (m.value_usd ?? 0), 0),
      trimmingValue: trimming.reduce((s, m) => s + (m.value_usd ?? 0), 0),
    };
  }

  const timeline: OverlapTimelineRow[] = [];
  for (const r of recent) {
    const side = sideLabel(r.side, r.flags);
    timeline.push({
      date: r.filed,
      actor: r.name,
      href: r.bioguide ? memberHrefFor(r.bioguide, i.ctx) : null,
      move: side.text,
      cls: side.cls,
      side: "congress",
      amount: amountText(r),
    });
  }
  if (inst) {
    for (const m of [...inst.adding, ...inst.trimming]) {
      timeline.push({
        date: inst.period,
        actor: m.name,
        href: i.filerHref(m.cik),
        move: m.kind,
        cls: m.kind === "new" || m.kind === "add" ? "c-buy" : "c-sell",
        side: "13f",
        amount: m.delta_shares == null ? "—" : `${m.delta_shares < 0 ? "−" : "+"}${fmtInt(Math.abs(m.delta_shares))} sh`,
      });
    }
  }
  timeline.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.side === b.side ? 0 : a.side === "congress" ? -1 : 1));

  return {
    ticker: i.ticker,
    window: { start, end },
    buyers,
    sellers,
    buyTotal: sumRangesText(sumRanges(buys)),
    sellTotal: sumRangesText(sumRanges(sells)),
    inst,
    timeline: timeline.slice(0, OVERLAP_TIMELINE_ROWS),
  };
}

function memberList(ms: readonly OverlapMember[], ctx: RenderCtx): string {
  if (ms.length === 0) return `<span class="none">—</span>`;
  return ms
    .slice(0, 8)
    .map((m) => (m.bioguide ? `<a href="${memberHrefFor(m.bioguide, ctx)}">${esc(m.name)}</a>` : esc(m.name)) + ` <span class="aff ${partyClass(m.party)}">${esc(affTextOf(m.rows[0]!))}</span>`)
    .join(", ") + (ms.length > 8 ? ` <span class="mono-note">+${fmtInt(ms.length - 8)}</span>` : "");
}

function managerList(ms: readonly OverlapManager[], filerHref: (cik: string) => string): string {
  if (ms.length === 0) return `<span class="none">—</span>`;
  return ms
    .slice(0, 8)
    .map((m) => `<a href="${esc(filerHref(m.cik))}">${esc(m.name)}</a>`)
    .join(", ") + (ms.length > 8 ? ` <span class="mono-note">+${fmtInt(ms.length - 8)}</span>` : "");
}

/** The band. */
export function overlapBandHtml(b: OverlapBand, ctx: RenderCtx, filerHref: (cik: string) => string): string {
  const congress =
    `<div class="overlap-half overlap-congress"><h3 class="section-h">Congress · last ${OVERLAP_CONGRESS_DAYS} days</h3>` +
    `<dl class="overlap-rows">` +
    `<div><dt>Buyers</dt><dd><span class="overlap-n c-buy">${fmtInt(b.buyers.length)}</span> ${memberList(b.buyers, ctx)} <span class="overlap-total c-num">${esc(b.buyTotal)}</span></dd></div>` +
    `<div><dt>Sellers</dt><dd><span class="overlap-n c-sell">${fmtInt(b.sellers.length)}</span> ${memberList(b.sellers, ctx)} <span class="overlap-total c-num">${esc(b.sellTotal)}</span></dd></div>` +
    `</dl><p class="section-note">filed ${esc(b.window.start)} → ${esc(b.window.end)} · totals are statutory ranges</p></div>`;
  const inst = b.inst
    ? `<div class="overlap-half overlap-inst"><h3 class="section-h">Notable managers · quarter ended ${esc(b.inst.period)}</h3>` +
      `<dl class="overlap-rows">` +
      `<div><dt>Adding</dt><dd><span class="overlap-n c-buy">${fmtInt(b.inst.adding.length)}</span> ${managerList(b.inst.adding, filerHref)} <span class="overlap-total c-num">${esc(fmtUsd(b.inst.addingValue))} held</span></dd></div>` +
      `<div><dt>Trimming</dt><dd><span class="overlap-n c-sell">${fmtInt(b.inst.trimming.length)}</span> ${managerList(b.inst.trimming, filerHref)} <span class="overlap-total c-num">${esc(fmtUsd(b.inst.trimmingValue))} held</span></dd></div>` +
      `</dl><p class="section-note">new + add vs trim + exit, by shares · $ = reported value now, not the change · <span class="filed-name">${esc(b.inst.issuer)}</span></p></div>`
    : `<div class="overlap-half overlap-inst overlap-planned"><h3 class="section-h">Notable managers <span class="badge-planned">PLANNED</span></h3>` +
      `<p class="section-note">Ticker not yet mapped — the 13F side needs a reviewed name-and-class mapping row for ${esc(b.ticker)}. <a href="/methodology/#ticker-mapping">how tickers are mapped ↗</a></p></div>`;
  const rows = b.timeline
    .map(
      (r) =>
        `<tr><td class="c-filed">${esc(r.date)}</td>` +
        `<td>${r.href ? `<a href="${esc(r.href)}">${esc(r.actor)}</a>` : esc(r.actor)} <span class="mono-note">${r.side === "congress" ? "Congress" : "13F"}</span></td>` +
        `<td class="${esc(r.cls)}">${esc(r.move)}</td><td class="c-num">${esc(r.amount)}</td></tr>`,
    )
    .join("\n");
  return (
    `<section class="panel panel-wide design-overlap" id="overlap" aria-label="Congress and notable managers on ${esc(b.ticker)}">` +
    `<div class="panel-head"><h2 class="section-h">Congress ↔ notable managers · ${esc(b.ticker)}</h2>` +
    `<span class="panel-note">who in Congress disclosed purchases or sales beside which notable managers added or trimmed</span></div>` +
    `<div class="overlap-halves">${congress}${inst}</div>` +
    (b.timeline.length === 0
      ? `<p class="section-note">No moves on either side in the window.</p>`
      : `<div class="table-scroll"><table class="etable etable-compact"><caption class="visually-hidden">Merged timeline of congressional filings and notable-manager moves on ${esc(b.ticker)}</caption>` +
        `<thead><tr><th scope="col">Date</th><th scope="col">Who</th><th scope="col">Change</th><th scope="col" class="num">Size</th></tr></thead>` +
        `<tbody>${rows}</tbody></table></div>` +
        `<p class="section-note">${fmtInt(b.timeline.length)} newest rows · Congress rows date by filing, 13F rows by quarter end · a 13F row is a quarter-end snapshot, not a trade</p>`) +
    `</section>`
  );
}
