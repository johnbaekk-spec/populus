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
  srcLink,
  memberHrefFor,
  tickerHrefFor,
  terminusRow,
} from "../format.ts";
import type { Signal, SignalArtifact, SignalKind, WithheldKind } from "../signals.ts";
import { briefingCards, disclosureLedger } from "./shared.ts";
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

function familyOf(kind: SignalKind): Family {
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

/** One-line evidence for a hit: the rule's own terms restated with the row's
    facts, never an interpretation of the filer. */
function evidenceText(s: Signal): string {
  const lag = lagDays(s);
  switch (s.kind) {
    case "s1-large":
      return `disclosed lower bound ${s.magnitude.low == null ? "—" : fmtUsd(s.magnitude.low)} · ≥ $250K rule`;
    case "s2-first":
      return `first disclosure of ${s.entities.ticker ?? "this ticker"} by this member in the corpus`;
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

export function signalRowHtml(s: Signal, ctx: RenderCtx): string {
  const who = s.entities.bioguide
    ? `<a href="${memberHrefFor(s.entities.bioguide, ctx)}">${esc(s.entities.memberName)}</a>`
    : esc(s.entities.memberName);
  const what = s.entities.ticker
    ? `<a class="mono-ticker" href="${tickerHrefFor(s.entities.ticker, ctx)}">${esc(s.entities.ticker)}</a>`
    : `<span class="none">—</span>`;
  const receipts = s.receipts
    .slice(0, 5)
    .map((doc) => srcLink(doc))
    .join(" ");
  const more = s.receipts.length > 5 ? ` <span class="mono-note">+${fmtInt(s.receipts.length - 5)} more filings</span>` : "";
  return (
    `<tr data-signal-id="${esc(s.id)}">` +
    `<td class="c-filed">${esc(s.occurrence.filedDate)}</td>` +
    `<td>${who}</td>` +
    `<td>${what}</td>` +
    `<td class="c-num">${esc(magnitudeText(s.magnitude))}</td>` +
    `<td class="c-filed">${esc(s.occurrence.tradeDate ?? "—")}</td>` +
    `<td class="c-src">${receipts}${more}</td></tr>`
  );
}

/* ---------- the reference HIT row: kind · subject · evidence · src · magnitude · when · rcpt ---------- */

function hitRowHtml(s: Signal, ctx: RenderCtx, extraAttrs = ""): string {
  const family = familyOf(s.kind);
  const subject = s.entities.bioguide
    ? `<a href="${memberHrefFor(s.entities.bioguide, ctx)}">${esc(s.entities.memberName)}</a>`
    : esc(s.entities.memberName);
  const ticker = s.entities.ticker
    ? ` <a class="si-ticker" href="${tickerHrefFor(s.entities.ticker, ctx)}">${esc(s.entities.ticker)}</a>`
    : "";
  const receipt = s.receipts[0] ?? "";
  const lag = lagDays(s);
  return (
    `<tr class="si-hit si-family-${family.toLowerCase()} si-kind-${esc(s.kind)}" data-signal-id="${esc(s.id)}" data-family="${family}"` +
    ` data-kind="${esc(s.kind)}" data-bioguide="${esc(s.entities.bioguide ?? "")}" data-ticker="${esc(s.entities.ticker ?? "")}"` +
    ` data-filed="${esc(s.occurrence.filedDate)}"${extraAttrs}>` +
    `<td class="si-kind">${esc(shortOf(s.kind))}${note(s.rule, { scope: "signal-hits" }, s.id)}</td>` +
    `<td class="si-subject">${subject}${ticker}</td>` +
    `<td class="si-evidence">${esc(evidenceText(s))}</td>` +
    `<td class="si-src"><span class="si-stamp">${esc(s.cohort === "senate" ? "eFD" : "PTR")}</span></td>` +
    `<td class="c-num si-mag">${esc(magnitudeText(s.magnitude))}</td>` +
    `<td class="c-filed si-when">${whenText(s)}${lag != null ? ` <span class="${lag > 45 ? "si-late" : "si-lag"}">+${fmtInt(lag)}d</span>` : ""}</td>` +
    `<td class="c-src">${receipt ? srcLink(receipt) : "—"}${s.receipts.length > 1 ? `<span class="mono-note"> +${fmtInt(s.receipts.length - 1)}</span>` : ""}</td>` +
    `</tr>`
  );
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
  /** how many hits to render on the server; the artifact link carries the rest */
  renderCap?: number;
}

const HITS_RENDER_CAP = 60;
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
      `<tr class="si-rule si-family-${r.family.toLowerCase()}${withheld ? " si-withheld" : ""}">` +
      `<td class="si-family">${esc(FAMILY_LABEL[r.family])}</td>` +
      `<td class="si-kind">${esc(r.short)}<span class="visually-hidden"> — ${esc(SIGNAL_KIND_LABELS[r.kind])}</span></td>` +
      `<td class="si-rule-text">${esc(rule)}</td>` +
      `<td class="si-why">${esc(r.why)}</td>` +
      `<td class="c-num si-hits${list.length === 0 ? " c-muted" : ""}">${withheld ? "—" : fmtInt(list.length)}</td>` +
      `<td class="c-num si-status si-status-${status}">${withheld ? `WITHHELD${note(withheld.detail, { scope: "signal-rules" }, r.kind)}` : "ACTIVE"}</td>` +
      `</tr>`
    );
  });
  // The one kind withheld BY DESIGN: a point return from a range-bounded
  // disclosure would be invented. Named so nobody assumes it was forgotten.
  rows.push(
    `<tr class="si-rule si-family-withheld si-withheld">` +
      `<td class="si-family">Withheld</td>` +
      `<td class="si-kind">RETURN</td>` +
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
    `<div class="table-scroll"><table class="etable etable-compact si-table">` +
    `<caption class="visually-hidden">Signal rules — family, kind, exact rule, why it is informative, hits in the retained window, status</caption>` +
    `<thead><tr><th scope="col">Family</th><th scope="col">Kind</th><th scope="col">Rule</th><th scope="col">Why it's informative</th><th scope="col" class="num">Hits</th><th scope="col" class="num">Status</th></tr></thead>` +
    `<tbody>${rows.join("\n")}</tbody></table></div>` +
    `<p class="section-note">Thresholds are calibrated per kind and versioned; a kind whose measured volume falls outside its declared bounds is <span class="si-late">WITHHELD</span> with a typed reason, never emitted anyway. ` +
    `Institutional kinds wait on closed 13F periods and are not simulated. <a href="/methodology/#signals">methodology §signals ↗</a></p>` +
    `</section>`
  );
}

function hitsHtml(artifact: SignalArtifact, active: Signal[], ctx: RenderCtx, cap: number): string {
  const sorted = [...active].sort((a, b) =>
    a.occurrence.filedDate === b.occurrence.filedDate
      ? (b.magnitude.low ?? -1) - (a.magnitude.low ?? -1)
      : a.occurrence.filedDate < b.occurrence.filedDate ? 1 : -1,
  );
  const shown = sorted.slice(0, cap);
  const families = FAMILY_ORDER.filter((f) => active.some((s) => familyOf(s.kind) === f));
  const seg =
    `<div class="seg si-hit-filter" role="group" aria-label="Filter hits by family">` +
    `<button type="button" data-family="all" aria-pressed="true">All</button>` +
    families.map((f) => `<button type="button" data-family="${f}" aria-pressed="false">${esc(FAMILY_LABEL[f])}</button>`).join("") +
    `</div>`;
  const body = shown.length === 0
    ? `<tr><td colspan="7" class="si-empty">Zero hits in the retained window — a computed answer over every rule above, not missing coverage.</td></tr>`
    : shown.map((s) => hitRowHtml(s, ctx)).join("\n");
  return (
    `<section class="panel si-hits" id="signal-hits" aria-label="Hits">` +
    `<div class="panel-head"><h2 class="section-h">Hits</h2>` +
    `<span class="panel-note">RETAINED WINDOW ${esc(artifact.coverageFrom)} → ${esc(artifact.coverageTo)} · NEWEST FIRST · EVERY HIT CARRIES ITS RECEIPT</span>` +
    seg + `</div>` +
    `<div class="table-scroll si-hits-scroll" tabindex="0" role="region" aria-label="Signal hits · scroll for more rows"><table class="etable etable-compact si-table">` +
    `<caption class="visually-hidden">Signal hits, newest filed first</caption>` +
    `<thead><tr><th scope="col">Kind</th><th scope="col">Subject</th><th scope="col">Evidence</th><th scope="col">Src</th><th scope="col" class="num">Magnitude</th><th scope="col" class="num">When</th><th scope="col" class="num">Rcpt</th></tr></thead>` +
    `<tbody id="signal-hits-body">${body}</tbody></table></div>` +
    `<p class="section-note" id="signal-hits-count" data-total="${active.length}" data-shown="${shown.length}">` +
    `<span class="si-stamp">PTR</span> / <span class="si-stamp">eFD</span> = the source regime of the underlying row · ` +
    `magnitudes are the row's statutory range, never narrowed · ${fmtInt(active.length)} ${active.length === 1 ? "hit" : "hits"} in the window.</p>` +
    (active.length > shown.length
      ? terminusRow({
          author: "populus",
          html: `${fmtInt(active.length - shown.length)} further hits are in the artifact but not rendered here — a render bound, not a data bound; the artifact at <a href="/signals/data/signals.v1.json">signals.v1.json</a> is complete for the window.`,
        })
      : "") +
    `<p class="visually-hidden" id="signal-hits-status" role="status" aria-live="polite"></p>` +
    `<noscript><p class="section-note">Family filtering needs JavaScript; every rendered hit is listed above regardless.</p></noscript>` +
    `</section>`
  );
}

function lagBandHtml(deps: SignalsPageDeps): string {
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
  const rows = [...grouped.values()].sort((a, b) => b.lag - a.lag).slice(0, 8);
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
    `<span class="panel-note">TRADE → FILING · LATEST BATCH${deps.latestBatchFiled ? ` FILED ${esc(deps.latestBatchFiled)}` : ""} · GOLD TICK = 45D</span></div>` +
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
    `<span class="panel-note">HITS PER 1,000 ROWS FILED IN THE WINDOW · RARER = MORE INFORMATIVE</span></div>` +
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
    cols: ["id", "kind", "bioguide", "name", "ticker", "low", "high", "traded", "filed", "receipt"],
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
    `<thead><tr><th scope="col">Kind</th><th scope="col">Watched subject</th><th scope="col">What happened</th><th scope="col" class="num">Magnitude</th><th scope="col" class="num">When</th><th scope="col" class="num">Seen</th><th scope="col" class="num">Rcpt</th></tr></thead>` +
    `<tbody id="signal-watch-body"><tr><td colspan="7" class="si-empty" id="signal-watch-empty">Nothing watched on this device yet. Star a member on <a href="/congress/">the feed</a> or a ticker on its page; hits on watched subjects appear here.</td></tr></tbody></table></div>` +
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

  /* --- ledger --- */
  const ledger = disclosureLedger([
    { label: "Active kinds", value: fmtInt(evaluatedKinds), detail: `${fmtInt(withheldKinds)} withheld this build · 1 by design` },
    { label: "Hits · Congress", value: fmtInt(active.length), detail: `${fmtInt(activeKinds.size)} kinds fired · ${artifact.retentionDays}-day window` },
    { label: "Hits · 13F", value: "—", detail: "await closed 13F periods · not simulated" },
    { label: "Cross-regime", value: "—", detail: "needs the 13F join · not simulated" },
  ]);

  /* --- three summaries, every one data-derived --- */
  const largest = active
    .filter((s) => s.magnitude.low != null)
    .sort((a, b) => (b.magnitude.low ?? 0) - (a.magnitude.low ?? 0))[0];
  const late = active.filter((s) => s.kind === "s6-late-large");
  const lateMax = late.map((s) => lagDays(s) ?? 0).reduce((m, v) => Math.max(m, v), 0);
  const rarest = RULE_BOOK.filter((r) => !artifact.withheld.some((w) => w.kind === r.kind))
    .map((r) => ({ r, n: active.filter((s) => s.kind === r.kind).length }))
    .sort((a, b) => a.n - b.n)[0];
  const stories = briefingCards([
    {
      tag: "Largest lower bound this window",
      title: largest
        ? `${shortOf(largest.kind)}: ${largest.entities.memberName} · ${magnitudeText(largest.magnitude)}`
        : "No hit in the window discloses a lower bound",
      body: largest
        ? `${largest.entities.ticker ?? "no ticker disclosed"} · traded ${largest.occurrence.tradeDate ?? "date not disclosed"} → filed ${largest.occurrence.filedDate}. Ranked by the provable lower bound of the statutory range, never a point estimate.`
        : "Every rule ran over the retained window; ranking needs a disclosed lower bound.",
    },
    {
      tag: "Compliance",
      title: late.length === 0
        ? "No late-and-large disclosures in the window"
        : `${fmtInt(late.length)} ${late.length === 1 ? "disclosure" : "disclosures"} filed past the 45-day window with a lower bound ≥ $100K`,
      body: late.length === 0
        ? "Zero hits is the computed answer for the LATE rule, and the rule stays published."
        : `The longest ran +${fmtInt(lateMax)} days from trade to filing — ${fmtInt(Math.max(0, lateMax - 45))} over the STOCK Act window. Late disclosure is stated, not editorialised.`,
    },
    {
      tag: "Rarest · highest signal",
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
  const supersededSection =
    superseded.length === 0
      ? ""
      : `<section class="panel panel-wide" aria-label="Superseded signals">` +
        `<div class="panel-head"><h2 class="section-h">Superseded — no longer in the current view</h2>` +
        `<span class="panel-note">${fmtInt(superseded.length)} tombstones in window</span></div>` +
        `<p class="section-note">These signals appeared in an earlier build's artifact and left the ` +
        `retained view — their underlying filing was amended or superseded, or the rule no longer ` +
        `matches. The tombstone preserves when: each names the build that dropped it.</p>` +
        `<div class="table-scroll"><table class="etable etable-compact">` +
        `<caption class="visually-hidden">Superseded signals</caption>` +
        `<thead><tr><th scope="col">Kind</th><th scope="col">Filed</th><th scope="col">Member</th>` +
        `<th scope="col">Superseded in build</th><th scope="col">Src</th></tr></thead>` +
        `<tbody>${superseded
          .slice(0, 50)
          .map(
            (s) =>
              `<tr class="signal-superseded"><td>${esc(SIGNAL_KIND_LABELS[s.kind])}</td>` +
              `<td class="c-filed">${esc(s.occurrence.filedDate)}</td>` +
              `<td>${esc(s.entities.memberName)}</td>` +
              `<td class="mono-id">${esc(s.supersededInBuild ?? "—")}</td>` +
              `<td class="c-src">${srcLink(s.receipts[0] ?? "")}</td></tr>`,
          )
          .join("\n")}</tbody></table></div></section>`;

  return (
    `<div class="page-head">` +
    `<div class="page-head-copy"><div class="kicker">Public record / Signals · rule-based · no price data</div>` +
    `<h1 class="page-title">Signals</h1>` +
    `<p class="page-lede">Behaviour that is unusual for the filer, novel for the record, or late against the statute — each with its exact rule and every receipt. ` +
    `The raw artifact: <a href="/signals/data/signals.v1.json">signals.v1.json</a></p></div>` +
    ledger +
    `</div>` +
    `<div class="design-provenance signals-meta">` +
    `<span>a signal is a fact about a filing, not a forecast — no returns computed</span>` +
    `<span class="stamp-line">recomputed every build from the same rows you can audit · coverage window ${esc(artifact.coverageFrom)} → ${esc(artifact.coverageTo)} (${artifact.retentionDays} days by filed date)</span>` +
    `<span>zero hits is a computed answer, not missing coverage ${note(artifact.lagCaveat + " " + artifact.lifecycleNote, { scope: "signals-meta" }, "lag")}</span>` +
    `</div>` +
    stories +
    ruleBookHtml(artifact, active) +
    `<div class="design-band design-signals-band">` +
    hitsHtml(artifact, active, ctx, d.renderCap ?? HITS_RENDER_CAP) +
    `<div>` + lagBandHtml(d) + rateBandHtml(d, active, artifact) + `</div>` +
    `</div>` +
    watchBandHtml(active, artifact) +
    supersededSection +
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
  if (all.length === 0) {
    return (
      `<section class="panel" aria-label="Signals">` +
      `<div class="panel-head"><h2 class="section-h">Signals</h2>` +
      `<span class="panel-note">window ${esc(artifact.coverageFrom)} → ${esc(artifact.coverageTo)}</span></div>` +
      `<p class="section-note">No signals for this member in the retained window — a computed answer over the rules on <a href="/signals/">/signals</a>, not an absence of coverage.</p></section>`
    );
  }
  if (mine.length === 0) {
    return (
      `<section class="panel" aria-label="Signals">` +
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
        `<tr><td>${esc(SIGNAL_KIND_LABELS[s.kind])}${note(s.rule, { scope: "member-signals" }, s.id)}</td>` +
        `<td class="c-filed">${esc(s.occurrence.filedDate)}</td>` +
        `<td class="c-num">${esc(magnitudeText(s.magnitude))}</td>` +
        `<td class="c-src">${srcLink(s.receipts[0] ?? "")}</td></tr>`,
    )
    .join("\n");
  return (
    `<section class="panel" aria-label="Signals">` +
    `<div class="panel-head"><h2 class="section-h">Signals</h2>` +
    `<span class="panel-note"><a href="/signals/">all signals ↗</a></span></div>` +
    `<div class="table-scroll"><table class="etable etable-compact">` +
    `<caption class="visually-hidden">Signals for this member</caption>` +
    `<thead><tr><th scope="col">Kind</th><th scope="col">Filed</th><th scope="col">Magnitude</th><th scope="col">Src</th></tr></thead>` +
    `<tbody>${rows}</tbody></table></div>` +
    `<div class="card-foot">${esc(artifact.lagCaveat)}${esc(lifecycleNote)}</div></section>`
  );
}

/* exported for the watch band's client script — the label the row prints */
export function signalKindShort(kind: SignalKind): string {
  return shortOf(kind);
}
