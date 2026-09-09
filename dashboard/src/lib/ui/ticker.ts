/* Pure page/section renderers. Every entity body is a string function called
   by the thin .astro page for SSR AND by the generic-route client driver —
   parity is by construction (one function, two callers). No Node APIs, no DOM.

   Honesty grammar: G1–G7 via the canonical format.ts components; charts
   zero-based, gaps stay gaps, no midpoints; NULL-honest institutional
   integers; the as-of time stamp every 13F table carries. */

/* ui/ticker.ts — the unified /tickers/* page body. One of the ui/ domain
   modules: consumers import from ./index.ts only, never from this file
   directly. */

import {
  type RenderCtx,
  type TxnRow,
  esc,
  fmtInt,
  fmtUsd,
  flagTags,
  universalFlags,
  effectiveFlagKeys,
  universalFlagNote,
  srcLinkDerived,
  terminusRow,
  footnoteBlock,
  watchStarHtml,
  memberHrefFor,
  congressTickerHref,
  partyClass,
  sideLabel,
} from "../format.ts";
import {
  type TickerEntity,
  type CommitteeMembership,
  type MembershipSnapshot,
  membersDisclosing,
  memberNetByTicker,
  membershipAsOf,
  netDirection,
  netIntervalText,
  legacyTrailingMonthsBounds,
  windowMembership,
  excludeDateAnomalies,
  affTextOf,
  edgarFilerUrl,
  edgarTickerUrl,
} from "../derive.ts";
import type { Signal } from "../signals.ts";
import type { TickerCrowding } from "../inst-analytics.ts";
import { unavailableDesignPanel } from "./shared.ts";
import { filerHref } from "../holdings.ts";
import type { TickerInstSection } from "../data.ts";
import { type BuildStamps, asOfNote, briefingCards, disclosureLedger } from "./shared.ts";
import { note } from "../format.ts";
import { entityTxnRowsHtml, entityTxnTable } from "./congress.ts";
import { instStamp, INST_STAMP_CAVEAT } from "./institutional.ts";

/* ---------- unified ticker page body ---------- */

export interface TickerHeaderInfo {
  ticker: string;
  /** present-day mapped issuer name (G14, †) or null when unresolved */
  mappedName: string | null;
}

function tickerTitleHtml(info: TickerHeaderInfo): string {
  const name = info.mappedName
    ? ` — ${esc(info.mappedName)}<a class="fn-ref" href="#ticker-footnotes" aria-label="footnote: present-day mapping">†</a>`
    : "";
  return `<span class="mono-ticker">${esc(info.ticker)}</span>${name}`;
}

export function tickerInstSectionHtml(inst: TickerInstSection, ticker: string): string {
  const head = (note: string): string =>
    `<div class="section-head"><h2 class="section-h2">Institutional holders <span class="section-note-inline">· 13F${note}</span></h2></div>`;
  if (inst.state === "module-absent") {
    return (
      `<section class="page-section" id="institutional">` +
      head("") +
      `<div class="absent-block">` +
      `<h3 class="absent-h">The institutional module is not in this build.</h3>` +
      `<p>13F holdings for ${esc(ticker)} will render here when a build publishes the institutional aggregate. Nothing is shown rather than something unverified. <a href="/methodology/#m2">methodology §13F ↗</a></p>` +
      `<p class="mono-note"><a href="${esc(edgarTickerUrl(ticker))}" rel="noopener" target="_blank">search ${esc(ticker)} on SEC EDGAR ↗</a></p>` +
      `</div></section>`
    );
  }
  if (inst.state === "no-map" || inst.state === "unmapped" || inst.state === "ambiguous") {
    const reason =
      inst.state === "ambiguous"
        ? `This ticker names more than one issuer in the SEC's present-day ticker file, so Public Filings refuses to pick one.`
        : inst.state === "no-map"
          ? `This build carries no ticker→issuer mapping input, so the join is not attempted.`
          : `This ticker is not in the SEC's present-day ticker file.`;
    return (
      `<section class="page-section" id="institutional">` +
      head("") +
      `<div class="absent-block">` +
      `<h3 class="absent-h">Not resolved to an issuer — deliberately.</h3>` +
      `<p>${reason} Issuer rankings are keyed by registry identity, and Public Filings does not guess identity from names. Filer pages list holdings by issuer name as filed, or check the primary source: <a href="${esc(
        edgarTickerUrl(ticker),
      )}" rel="noopener" target="_blank">${esc(ticker)} on SEC EDGAR ↗</a></p>` +
      `</div></section>`
    );
  }
  if (inst.state === "resolved-no-data") {
    return (
      `<section class="page-section" id="institutional">` +
      head("") +
      `<div class="absent-block">` +
      `<h3 class="absent-h">Mapped, but not in the published aggregate.</h3>` +
      `<p>${esc(ticker)} resolves to ${esc(inst.name ?? "an issuer")} (CIK ${esc(
        inst.cik ?? "",
      )}), but this build's aggregate holds no entity-keyed top-holder rows for it. <a href="${esc(
        edgarTickerUrl(ticker),
      )}" rel="noopener" target="_blank">${esc(ticker)} on SEC EDGAR ↗</a></p>` +
      `</div></section>`
    );
  }
  // data
  const holders = inst.holders ?? [];
  /* Universal-flag hoisting applies to EVERY flag-bearing table, not only the entity txn one.
     Measured before wiring these: 1,004 pages carried a table whose every row
     read `security not in mapping`, with no caveat line above it. */
  const statedHolders = universalFlags(holders.map((h) => h.flags));
  const rows = holders
    .map(
      (h) =>
        `<tr><td class="c-num c-muted">${fmtInt(h.rank)}</td>` +
        // ONE href primitive (filerHref): the payload carries the top/tail target.
        `<td class="c-filer"><a href="${esc(filerHref(h.cik, h.tier ?? "tail"))}">${esc(h.name)}</a></td>` +
        `<td class="c-num c-strong">${esc(fmtUsd(h.value))}</td>` +
        `<td class="c-num">${fmtInt(h.securities)}</td>` +
        `<td class="c-flags">${flagTags(h.flags, undefined, { stated: statedHolders })}</td>` +
        `<td class="c-src">${srcLinkDerived("#ticker-inst-footnotes", edgarFilerUrl(h.cik))}</td></tr>`,
    )
    .join("\n");
  return (
    `<section class="page-section" id="institutional">` +
    `<div class="section-head"><h2 class="section-h2">Institutional holders <span class="section-note-inline">· 13F · ${instStamp(
      inst.period!,
      inst.latestFiled ?? null,
    )} · longs only</span></h2>` +
    `<a class="section-link" href="/institutional/tickers/${esc(encodeURIComponent(ticker))}/holders/">full holders view ↗</a></div>` +
    universalFlagNote(statedHolders) +
    `<div class="table-scroll"><table class="etable" data-sticky-first data-stated-flags="${esc(statedHolders.join(","))}">` +
    `<caption class="visually-hidden">Top institutional holders of ${esc(ticker)} for quarter ${esc(inst.period!)}</caption>` +
    `<thead><tr><th scope="col">#</th><th scope="col">Filer</th><th scope="col">Value ▾</th><th scope="col">Securities</th><th scope="col">Flags</th><th scope="col">Src</th></tr></thead>` +
    `<tbody>${rows}</tbody></table></div>` +
    terminusRow({
      author: "populus",
      html: `The published aggregate ranks the top ${fmtInt(inst.topn ?? 25)} holders per issuer — a build parameter of the Public Filings aggregation, not a census. Rows beyond it exist in individual filings on EDGAR. <a href="/methodology/#m2">methodology §13F ↗</a>`,
    }) +
    footnoteBlock(
      [
        {
          mark: "§",
          html: `derived by Public Filings from the published aggregate (agg_issuer_top_holders); per-filer filed dates, share counts and document links are not in the published aggregate — the EDGAR link opens the filer's 13F list`,
        },
        { mark: "n/c", html: `${esc(INST_STAMP_CAVEAT)}` },
      ],
      { id: "ticker-inst-footnotes" },
    ) +
    `</section>`
  );
}

/** SSR-only inputs for the Ticker.dc.html bands; the generic /e/ route passes
    none and every dependent band renders its stated unavailable state. */
export interface TickerPageDeps {
  /** active signals whose subject ticker is this one */
  signals: readonly Signal[];
  /** crowding percentiles when the ticker resolves to an issuer with holder rows */
  crowding: TickerCrowding | null;
  /** committee memberships keyed by bioguide (dating contract applied per trade) */
  committees: { byMember: ReadonlyMap<string, CommitteeMembership[]>; windowFrom: string; windowTo: string; snapshotDate: string } | null;
}

export function tickerUnifiedBody(
  t: TickerEntity,
  inst: TickerInstSection,
  stamps: BuildStamps,
  ctx: RenderCtx,
  opts: { fullTable: boolean; page?: number },
  deps: TickerPageDeps | null = null,
): string {
  const info: TickerHeaderInfo = {
    ticker: t.ticker,
    mappedName: inst.name ?? null,
  };
  const watched = ctx.watchedTickers?.has(t.ticker) ?? false;
  const disclosing = membersDisclosing(t.txns, stamps.generatedAtDate, 12, 5);
  const latestFiled = t.txns[0]?.filed ?? null;
  /* The compact preview is NOT paged, so its five rows ARE the whole
     set it speaks for — a flag universal among them is universal, full stop.
     This was the fifth flag-bearing renderer and the last one still repeating a
     caveat on every row; the whole-dist assertion in
     `test/post/universal-caveat.test.ts` is what named it. */
  const previewRows = t.txns.slice(0, 5);
  const statedPreview = universalFlags(previewRows.map(effectiveFlagKeys));
  const recent = opts.fullTable
    ? entityTxnTable(t.txns, {
        kind: "ticker",
        caption: `All congressional disclosures mentioning ${t.ticker}`,
        page: opts.page ?? 0,
        ctx,
      })
    : universalFlagNote(statedPreview) +
      `<div class="table-scroll"><table class="etable etable-compact" data-stated-flags="${esc(statedPreview.join(","))}"><caption class="visually-hidden">Latest congressional filings mentioning ${esc(
        t.ticker,
      )}</caption>` +
      `<thead><tr><th scope="col">Filed ▾</th><th scope="col">Member</th><th scope="col">Side · Owner</th><th scope="col">Traded · Lag</th><th scope="col">Amount</th><th scope="col">Range · Flags</th><th scope="col">Src</th></tr></thead>` +
      `<tbody>${entityTxnRowsHtml(previewRows, "ticker", ctx, statedPreview)}</tbody></table></div>` +
      `<div class="card-foot"><span>traded → filed dual dates on every row</span><a href="${congressTickerHref(
        t.ticker,
      )}">all ${fmtInt(t.txns.length)} ↗</a></div>`;

  /* Ticker.dc.html: kicker → mono ticker + mapped name + watch → lede, with the
     four-figure ledger on the right, then the provenance strip and three
     data-derived summaries. Every figure below is computed from this page's
     own rows; the reference's illustrative 13F-side values are not reproduced. */
  // Totals are over the FULL qualifying population; `disclosing` is the
  // five-row display slice and must never be the population a total describes
  // (Codex round 1, F2).
  const population = membersDisclosing(t.txns, stamps.generatedAtDate, 12, Number.MAX_SAFE_INTEGER);
  const members12 = population.length;
  const buys12 = population.reduce((n, m) => n + m.buys, 0);
  const sells12 = population.reduce((n, m) => n + m.sells, 0);
  const largest = t.txns.filter((r) => r.low != null).sort((a, b) => (b.low ?? 0) - (a.low ?? 0))[0];
  // Timeliness has THREE states: late, inside the window, and unknown (no
  // trade date, so no lag). The universal statement is reserved for a
  // non-empty population whose timeliness is fully known (Codex round 1, F4).
  const late = t.txns.filter((r) => r.late === 1).length;
  const unknownTimeliness = t.txns.filter((r) => r.lag == null).length;
  const timelyKnown = t.txns.length > 0 && unknownTimeliness === 0;
  const holders = inst.state === "data" ? inst.holders?.length ?? 0 : null;
  const ledger = disclosureLedger([
    { label: "Congress txns", value: fmtInt(t.txns.length), detail: `all PTR rows naming ${t.ticker}` },
    { label: "Members · 12m", value: fmtInt(members12), detail: `${fmtInt(buys12)} buys · ${fmtInt(sells12)} sells · by trade date` },
    { label: "Latest PTR", value: latestFiled ? latestFiled.slice(5) : "—", detail: latestFiled ? `filed ${latestFiled}` : "no filing on record" },
    {
      label: "13F holders",
      value: holders === null ? "—" : fmtInt(holders),
      detail:
        inst.state === "data"
          ? `top-${fmtInt(inst.topn ?? 25)} slice · ${inst.period ?? ""}`
          : inst.state === "module-absent"
            ? "13F module not in build"
            : "ticker not resolved to an issuer",
    },
  ]);
  const stories = briefingCards([
    {
      tag: "Largest disclosed lower bound",
      title: largest ? `${largest.name} · ${largest.low != null ? fmtUsd(largest.low) : "—"}${largest.high != null ? `–${fmtUsd(largest.high)}` : "+"}` : "No row discloses a lower bound",
      body: largest
        ? `${sideLabel(largest.side, largest.flags).text} · traded ${largest.traded ?? "date not disclosed"} → filed ${largest.filed}. Ranked over every ${t.ticker} row by the provable lower bound, never a point estimate.`
        : `Every ${t.ticker} row is a range with no usable floor; nothing can be ranked.`,
    },
    {
      tag: "Congress · trailing 12 months",
      title: disclosing.length === 0 ? `No member disclosed ${t.ticker} in the trailing 12 months` : `${fmtInt(members12)} ${members12 === 1 ? "member" : "members"} · ${fmtInt(buys12)} buys / ${fmtInt(sells12)} sells`,
      body: "Counts of disclosures by trade date, not dollars — ranges cannot be netted across members. Flow ranges per member are in the table below.",
    },
    {
      tag: late > 0 ? "Late filings" : "Timeliness",
      title: late > 0
        ? `${fmtInt(late)} ${late === 1 ? "row" : "rows"} filed past the 45-day window`
        : timelyKnown
          ? "Every row filed inside the 45-day window"
          : t.txns.length === 0
            ? "No rows on record"
            : `No row is flagged late · ${fmtInt(unknownTimeliness)} of ${fmtInt(t.txns.length)} carry no trade date, so their timeliness is unknown`,
      body:
        (unknownTimeliness > 0
          ? `${fmtInt(unknownTimeliness)} ${unknownTimeliness === 1 ? "row discloses" : "rows disclose"} no trade date; lag is unknown there, not zero. `
          : "") +
        "Late disclosure is stated on the row, never editorialised. Both dates and the receipt stay on every row.",
    },
  ]);
  return (
    `<div class="page-head">` +
    `<div class="page-head-copy">` +
    `<div class="kicker">Public record / Tickers / ${esc(t.ticker)}</div>` +
    `<h1 class="entity-title">${tickerTitleHtml(info)} ${watchStarHtml("ticker", t.ticker, t.ticker, watched)}</h1>` +
    `<p class="entity-lede">Both disclosure regimes on one name: who in Congress filed about ${esc(
      t.ticker,
    )}, which institutions reported holding it. Each section keeps its own clock — congressional trades on the 45-day PTR clock, 13F holdings as quarter-end snapshots.</p>` +
    `</div>` +
    ledger +
    `</div>` +
    `<div class="design-provenance"><span>Congress = transactions in statutory ranges, 45-day lag · Institutions = quarter-end positions, 45-day lag</span>` +
    `<span class="stamp-line">${asOfNote(stamps)}</span>` +
    `<span>no price data — a disclosure record, not a chart</span></div>` +
    stories +
    `<nav class="section-index" aria-label="Sections">` +
    `<a href="#congress" class="si-active">Congress <span class="si-n">${fmtInt(t.txns.length)}</span></a>` +
    `<a href="#institutional">Institutional${
      inst.state === "data" ? ` <span class="si-n">top ${fmtInt(inst.topn ?? 25)}</span>` : ""
    }</a>` +
    `<span class="si-soon">Financials <span class="badge-soon">SOON</span></span>` +
    `<span class="si-soon">Macro <span class="badge-soon">SOON</span></span>` +
    `<span class="si-asof">${asOfNote(stamps)} · build ${esc(stamps.buildId)}</span>` +
    `</nav>` +
    /* BAND 1 — the two regimes over time */
    `<div class="design-band design-ticker-band design-ticker-time">` +
    timelineHtml(t, stamps) +
    unavailableDesignPanel("Institutions · holder flow", "TRACKED FILERS · 6Q · NEW+ADD ▲ · TRIM+EXIT ▼", ["Quarter", "New + add", "Trim + exit"], instAbsenceReason(inst, "no holder flow can be grouped", "Per-issuer quarter-over-quarter holder actions need the issuer-keyed activity join, which this build's aggregate does not publish."), "design-holderflow") +
    `</div>` +
    /* BAND 2 — Congress rows (wide) + members active */
    `<section class="page-section" id="congress">` +
    `<div class="design-band design-ticker-band design-ticker-congress">` +
    `<section class="panel" aria-label="Congressional disclosures">` +
    `<div class="panel-head"><h2 class="section-h">Congressional disclosures</h2>` +
    `<span class="panel-note">ALL PTR ROWS NAMING ${esc(t.ticker)} · SORTED FILED ↓ · STATUTORY RANGES · FILED ≤45D LATE</span>` +
    (opts.fullTable ? "" : `<a class="section-link" href="${congressTickerHref(t.ticker)}">full congressional view ↗</a>`) +
    `</div>` +
    recent +
    `</section>` +
    membersActiveHtml(t, stamps, ctx, deps) +
    `</div>` +
    `</section>` +
    /* BAND 3 — who holds (wide) + crowding */
    `<div class="design-band design-ticker-band design-ticker-holders">` +
    `<div>` + tickerInstSectionHtml(inst, t.ticker) + `</div>` +
    crowdingHtml(deps?.crowding ?? null, inst) +
    `</div>` +
    /* BAND 4 — agreement + signals */
    `<div class="design-band design-ticker-band design-ticker-agree">` +
    agreementHtml(t, stamps, inst) +
    tickerSignalsHtml(t.ticker, deps?.signals ?? null) +
    `</div>` +
    `<details class="design-supplement"><summary>Planned modules for ${esc(t.ticker)} · financials and macro</summary>` +
    `<section class="page-section planned-grid" aria-label="Planned sections">` +
    `<div class="planned-card"><h2 class="section-h">Financials — as filed <span class="badge-soon">PLANNED</span></h2>` +
    `<p>${esc(t.ticker)}'s as-reported XBRL fundamentals will appear here when the financials module passes its gates. Until then: <a href="${esc(
      edgarTickerUrl(t.ticker),
    )}" rel="noopener" target="_blank">${esc(t.ticker)} on EDGAR ↗</a></p></div>` +
    `<div class="planned-card"><h2 class="section-h">Macro context <span class="badge-soon">PLANNED</span></h2>` +
    `<p>Rates, inflation, and positioning series land here with the macro module — vintage-aware, never nowcast.</p></div>` +
    `</section></details>` +
    footnoteBlock(
      info.mappedName
        ? [
            {
              mark: "†",
              html: `issuer name from the SEC's present-day ticker file (company_tickers.json) — a present-day mapping, not the name as of each filing`,
            },
          ]
        : [],
      { id: "ticker-footnotes" },
    )
  );
}


/* ---------- Ticker.dc.html bands ---------- */

/** The institutional side has FOUR distinct absence states and each band must
    name the one that applies rather than collapsing them into "not resolved". */
function instAbsenceReason(inst: TickerInstSection, consequence: string, whenData: string): string {
  switch (inst.state) {
    case "data":
      return whenData;
    case "resolved-no-data":
      return `The ticker resolves to ${inst.name ?? "an issuer"} (CIK ${inst.cik ?? "?"}), but this build's aggregate holds no entity-keyed holder rows for it — its 13F securities are provisional identities without a CUSIP→issuer bridge — so ${consequence}.`;
    case "module-absent":
      return `This build does not include the institutional module, so ${consequence}.`;
    case "no-map":
      return `This build carries no ticker→issuer mapping input, so ${consequence}.`;
    case "ambiguous":
      return `This ticker names more than one issuer in the SEC's present-day ticker file, so ${consequence}.`;
    default:
      return `This ticker is not in the SEC's present-day ticker file, so ${consequence}.`;
  }
}

const LOG_LO = 3;
const LOG_HI = Math.log10(50_000_000);
function logPos(usd: number): number {
  return Math.max(0, Math.min(100, ((Math.log10(Math.max(usd, 1000)) - LOG_LO) / (LOG_HI - LOG_LO)) * 100));
}
function dayNum(iso: string): number {
  return Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / 86_400_000;
}

/** Congress · disclosure timeline: one mark per dated row in the trailing 24
    months by TRADE date, x = position in the window, y = log lower bound,
    fill = side. Rows without a trade date cannot be placed and are counted. */
function timelineHtml(t: TickerEntity, stamps: BuildStamps): string {
  const bounds = legacyTrailingMonthsBounds(stamps.generatedAtDate, 24);
  const rows = excludeDateAnomalies(t.txns).rows.filter((r) => windowMembership(r, bounds, "traded") === "in" && r.traded);
  const undated = t.txns.filter((r) => !r.traded).length;
  const span = Math.max(1, dayNum(bounds.end) - dayNum(bounds.start));
  const marks = rows
    .map((r) => {
      const x = ((dayNum(r.traded!) - dayNum(bounds.start)) / span) * 100;
      const y = r.low == null ? 4 : logPos(r.low);
      const side = r.side === "purchase" ? "buy" : r.side === "sale" || r.side === "sale_partial" ? "sell" : "other";
      return `<i class="tl-mark tl-${side}" style="left:${x.toFixed(1)}%;bottom:${y.toFixed(1)}%"></i>`;
    })
    .join("");
  const ticks = [0, 6, 12, 18, 24].map((m) => {
    const d = new Date(Date.UTC(+bounds.start.slice(0, 4), +bounds.start.slice(5, 7) - 1 + m, 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  });
  return (
    `<section class="panel design-timeline" aria-label="Congress disclosure timeline">` +
    `<div class="panel-head"><h2 class="section-h">Congress · disclosure timeline</h2>` +
    `<span class="panel-note">TRADE DATES · 24M · ▲ BUY ▼ SELL · HEIGHT = LOG LOWER BOUND</span></div>` +
    (rows.length === 0
      ? `<p class="section-note">No dated ${esc(t.ticker)} rows fall inside the trailing 24 months by trade date.</p>`
      : `<div class="tl-plot" aria-hidden="true"><span class="tl-mid"></span>${marks}</div>` +
        `<div class="tl-axis" aria-hidden="true">${ticks.map((x) => `<span>${esc(x)}</span>`).join("")}</div>` +
        `<p class="visually-hidden">${fmtInt(rows.length)} dated disclosures in the window, placed by trade date; magnitudes are the disclosed lower bounds.</p>`) +
    `<p class="section-note">Trade date, not filing date — the lag lives in the table below. ${fmtInt(rows.length)} rows placed` +
    (undated > 0 ? ` · ${fmtInt(undated)} rows disclose no trade date and cannot be placed` : "") +
    `.</p></section>`
  );
}

/** Members active: rows, net lower bound (interval subtraction, the same
    memberNetByTicker every member page uses), and committee membership as of
    the member's latest trade date when the build carries the roster. */
function membersActiveHtml(t: TickerEntity, stamps: BuildStamps, ctx: RenderCtx, deps: TickerPageDeps | null): string {
  const bounds = legacyTrailingMonthsBounds(stamps.generatedAtDate, 12);
  const byMember = new Map<string, TxnRow[]>();
  for (const r of excludeDateAnomalies(t.txns).rows) {
    if (windowMembership(r, bounds, "traded_or_filed") !== "in") continue;
    const key = r.bioguide ?? `raw:${r.name}`;
    byMember.set(key, [...(byMember.get(key) ?? []), r]);
  }
  const members = [...byMember.entries()]
    .map(([key, rows]) => {
      const first = rows[0]!;
      const net = memberNetByTicker(rows).rows[0]?.net ?? { kind: "empty" as const };
      const latest = rows.map((r) => r.traded).filter((d): d is string => !!d).sort().at(-1) ?? null;
      let committee: string | null = null;
      if (deps?.committees && first.bioguide) {
        const snap: MembershipSnapshot = { memberships: deps.committees.byMember.get(first.bioguide) ?? [], windowFrom: deps.committees.windowFrom, windowTo: deps.committees.windowTo };
        const asOf = membershipAsOf(snap, latest);
        committee = asOf === null ? "unanswerable" : asOf.length === 0 ? "—" : `${fmtInt(asOf.length)}`;
      }
      return { key, first, rows: rows.length, net, committee };
    })
    .sort((a, b) => b.rows - a.rows || (a.first.name < b.first.name ? -1 : 1))
    .slice(0, 8);
  const rowsHtml = members
    .map((m) => {
      const dir = netDirection(m.net);
      return (
        `<tr><td class="c-member">${m.first.bioguide ? `<a href="${memberHrefFor(m.first.bioguide, ctx)}">${esc(m.first.name)}</a>` : esc(m.first.name)} <span class="aff ${partyClass(m.first.party)}">${esc(affTextOf(m.first))}</span></td>` +
        `<td class="c-num">${fmtInt(m.rows)}</td>` +
        `<td class="c-num ${dir === "accumulation" ? "c-buy" : dir === "disposal" ? "c-sell" : "c-muted"}">${esc(netIntervalText(m.net))}</td>` +
        `<td class="c-num ${m.committee && m.committee !== "—" && m.committee !== "unanswerable" ? "c-amber" : "c-muted"}">${m.committee === null ? "—" : esc(m.committee)}</td></tr>`
      );
    })
    .join("\n");
  return (
    `<section class="panel design-members-active" aria-label="Members active">` +
    `<div class="panel-head"><h2 class="section-h">Members active in ${esc(t.ticker)}</h2>` +
    `<span class="panel-note">12M · NET LOWER BOUND · ${deps?.committees ? `COMMITTEES AS OF TRADE DATE · SNAPSHOT ${esc(deps.committees.snapshotDate)}` : "COMMITTEE ROSTER NOT IN BUILD"}</span></div>` +
    (members.length === 0
      ? `<p class="section-note">No member disclosed ${esc(t.ticker)} in the trailing 12 months.</p>`
      : `<div class="table-scroll"><table class="etable etable-compact"><caption class="visually-hidden">Members disclosing ${esc(t.ticker)} in the trailing 12 months</caption>` +
        `<thead><tr><th scope="col">Member</th><th scope="col" class="num">Rows</th><th scope="col" class="num">Net${note("Net disclosed flow for this ticker: purchases minus sales as interval subtraction; open bounds propagate. A lower bound is provable, never a point.", { scope: "ticker-members" }, "net")}</th><th scope="col" class="num">Committees${note(deps?.committees ? "Number of committees the member sat on as of their latest trade date in the window, from the cc0-legislators roster snapshot. Context, never an allegation; jurisdiction overlap needs the sector join." : "Committee membership data is not in this build; the column states absence rather than guessing from current rosters.", { scope: "ticker-members" }, "committees")}</th></tr></thead>` +
        `<tbody>${rowsHtml}</tbody></table></div>` +
        `<p class="section-note">${fmtInt(byMember.size)} members in the window${byMember.size > members.length ? `; ${fmtInt(members.length)} rendered — a render bound` : ""} · counts of disclosures, not dollars.</p>`) +
    `</section>`
  );
}

function crowdingHtml(c: TickerCrowding | null, inst: TickerInstSection): string {
  if (c === null) {
    return unavailableDesignPanel("Crowding", "PCT-RANK VS TRACKED NAMES", ["Measure", "Percentile"], instAbsenceReason(inst, "it cannot be ranked among tracked names", "No holder rows for the selected period, so no percentile can be ranked."), "design-crowding");
  }
  const bar = (label: string, pct: number, text: string, hint: string): string =>
    `<div class="book-metric"><dt>${esc(label)}${note(hint, { scope: "ticker-crowding" }, label)}</dt><dd>` +
    `<span class="book-track" aria-hidden="true"><span class="${pct >= 85 ? "book-hot" : ""}" style="width:${pct}%"></span></span>` +
    `<span class="${pct >= 85 ? "c-amber" : ""}">${esc(text)}</span><span class="book-compare"></span></dd></div>`;
  const ord = (n: number): string => `${n}${n % 100 >= 11 && n % 100 <= 13 ? "th" : n % 10 === 1 ? "st" : n % 10 === 2 ? "nd" : n % 10 === 3 ? "rd" : "th"}`;
  return (
    `<section class="panel design-crowding" aria-label="Crowding">` +
    `<div class="panel-head"><h2 class="section-h">Crowding</h2><span class="panel-note">PCT-RANK VS ${fmtInt(c.issuers)} RANKED ISSUERS · ${esc(c.period)}</span></div>` +
    `<dl>` +
    bar("Holder count", c.holderCount.pct, ord(c.holderCount.pct), `${fmtInt(c.holderCount.value)} ranked holders in the top-N slice; percentile among every issuer with holder rows for the period.`) +
    (c.avgWeightBps
      ? bar("Avg weight", c.avgWeightBps.pct, ord(c.avgWeightBps.pct), `Mean weight of this issuer in its ranked holders' complete books (${fmtInt(c.avgWeightBps.holdersWithBook)} holders with a fully valued book): ${(c.avgWeightBps.value / 100).toFixed(2)}% of book.`)
      : `<div class="book-metric"><dt>Avg weight</dt><dd><span class="book-track" aria-hidden="true"></span><span class="c-muted">—</span><span class="book-compare">no complete holder book</span></dd></div>`) +
    bar("Composite", c.compositePct, ord(c.compositePct), "Mean of the available percentiles.") +
    `</dl>` +
    `<p class="section-note">A high percentile is a sizing warning, not a call — crowded names exit together. Ranks are over the aggregate's top-N holder slices, not a census.</p>` +
    `</section>`
  );
}

function agreementHtml(t: TickerEntity, stamps: BuildStamps, inst: TickerInstSection): string {
  const bounds = legacyTrailingMonthsBounds(stamps.generatedAtDate, 12);
  const rows = excludeDateAnomalies(t.txns).rows.filter((r) => windowMembership(r, bounds, "traded_or_filed") === "in");
  const buys = rows.filter((r) => r.side === "purchase").length;
  const sells = rows.filter((r) => r.side === "sale" || r.side === "sale_partial").length;
  const net = memberNetByTicker(rows).rows[0]?.net ?? { kind: "empty" as const };
  const dir = netDirection(net);
  const total = Math.max(1, buys + sells);
  const row = (k: string, left: number, right: number, text: string, cls: string): string =>
    `<div class="agree-row"><span class="agree-k">${esc(k)}</span><span class="design-diverging" aria-hidden="true"><span style="right:50%;width:${((left / total) * 50).toFixed(1)}%"></span><span class="sale" style="left:50%;width:${((right / total) * 50).toFixed(1)}%"></span></span><span class="agree-v ${cls}">${esc(text)}</span></div>`;
  return (
    `<section class="panel design-agree" aria-label="Do the two regimes agree">` +
    `<div class="panel-head"><h2 class="section-h">Do the two regimes agree?</h2><span class="panel-note">TRAILING 12M · CONGRESS vs FILERS NET</span></div>` +
    row("Congress net (rows)", buys, sells, rows.length === 0 ? "no rows" : `${fmtInt(buys)} buy / ${fmtInt(sells)} sell`, dir === "accumulation" ? "c-buy" : dir === "disposal" ? "c-sell" : "c-muted") +
    row("Congress net ($ bound)", dir === "accumulation" ? 1 : 0, dir === "disposal" ? 1 : 0, netIntervalText(net), dir === "accumulation" ? "c-buy" : dir === "disposal" ? "c-sell" : "c-muted") +
    `<div class="agree-row agree-unavailable"><span class="agree-k">Filers net (actions)</span><span class="design-diverging" aria-hidden="true"></span><span class="agree-v c-muted">not in build</span></div>` +
    `<div class="agree-row agree-unavailable"><span class="agree-k">Filers net ($ Q/Q)</span><span class="design-diverging" aria-hidden="true"></span><span class="agree-v c-muted">not in build</span></div>` +
    `<p class="section-note">${instAbsenceReason(inst, "the filer side cannot be computed", "The filer side needs per-issuer quarter-over-quarter actions, which the published aggregate does not carry for this issuer.")} Convergence and divergence are stated only when both sides are computed.</p>` +
    `</section>`
  );
}

function tickerSignalsHtml(ticker: string, signals: readonly Signal[] | null): string {
  if (signals === null) {
    return `<section class="panel design-ticker-signals" aria-label="Signals"><div class="panel-head"><h2 class="section-h">Signals on ${esc(ticker)}</h2><span class="panel-note">RETAINED WINDOW</span></div><p class="section-note">Signals are joined on the server; this view carries none. <a href="/signals/">Every rule, with its definition →</a></p></section>`;
  }
  const kinds = new Map<Signal["kind"], Signal[]>();
  for (const s of signals) kinds.set(s.kind, [...(kinds.get(s.kind) ?? []), s]);
  const labels: Record<Signal["kind"], string> = { "s1-large": "LARGE", "s2-first": "FIRST FILING", "s3-cooccurrence": "CO-OCCURRENCE", "s4-infrequent": "INFREQUENT", "s5-jurisdiction": "COMMITTEE", "s6-late-large": "LATE" };
  const rows = [...kinds.entries()]
    .map(([kind, list]) => `<tr><td class="si-kind">${esc(labels[kind])}</td><td class="si-evidence">${esc(list[0]!.rule)}</td><td class="c-num">${fmtInt(list.length)} ${list.length === 1 ? "hit" : "hits"}</td></tr>`)
    .join("\n");
  return (
    `<section class="panel design-ticker-signals" aria-label="Signals">` +
    `<div class="panel-head"><h2 class="section-h">Signals on ${esc(ticker)}</h2><span class="panel-note">RETAINED WINDOW · ACTIVE HITS</span></div>` +
    (signals.length === 0
      ? `<p class="section-note">Zero hits on ${esc(ticker)} in the retained window — a computed answer over every rule, not missing coverage.</p>`
      : `<div class="table-scroll"><table class="etable etable-compact si-table"><caption class="visually-hidden">Signal hits naming ${esc(ticker)}</caption><thead><tr><th scope="col">Kind</th><th scope="col">Rule</th><th scope="col" class="num">Hits</th></tr></thead><tbody>${rows}</tbody></table></div>`) +
    `<p class="section-note"><a href="/signals/">Every rule, with its definition →</a></p>` +
    `</section>`
  );
}
