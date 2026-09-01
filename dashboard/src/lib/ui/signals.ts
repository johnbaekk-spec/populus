/* Pure page/section renderers. Every entity body is a string function called
   by the thin .astro page for SSR AND by the generic-route client driver —
   parity is by construction (one function, two callers). No Node APIs, no DOM.

   Honesty grammar: G1–G7 via the canonical format.ts components; charts
   zero-based, gaps stay gaps, no midpoints; NULL-honest institutional
   integers; the as-of time stamp every 13F table carries. */

/* ui/signals.ts — the /signals surfaces. One of the ui/ domain modules:
   consumers import from ./index.ts only, never from this file directly. */

import {
  type RenderCtx,
  esc,
  fmtInt,
  fmtUsd,
  note,
  srcLink,
  memberHrefFor,
  tickerHrefFor,
  terminusRow,
} from "../format.ts";
import type { Signal, SignalArtifact, WithheldKind } from "../signals.ts";

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

function magnitudeText(m: Signal["magnitude"]): string {
  if (m.low == null && m.high == null) return "not disclosed";
  if (m.low != null && m.high == null) return `Over ${fmtUsd(m.low)}`;
  if (m.low == null) return `Under ${fmtUsd(m.high!)}`;
  return `${fmtUsd(m.low)}–${fmtUsd(m.high!)}`;
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

export function signalsBody(artifact: SignalArtifact, ctx: RenderCtx): string {
  // Tombstones are lifecycle HISTORY — they never sit in the
  // active tables or counts wearing an active face.
  const active = artifact.signals.filter((s) => s.status === "active");
  const superseded = artifact.signals.filter((s) => s.status === "superseded");
  // Rows whose kind was WITHHELD this build were not evaluated —
  // they are neither active nor retracted, and are reported with the
  // withholding that caused it.
  const unevaluated = artifact.signals.filter((s) => s.status === "unevaluated");
  const byKind = new Map<Signal["kind"], Signal[]>();
  for (const s of active) {
    let list = byKind.get(s.kind);
    if (!list) {
      list = [];
      byKind.set(s.kind, list);
    }
    list.push(s);
  }
  const sections = [...byKind.entries()]
    .map(([kind, list]) => {
      const rule = list[0]!.rule;
      const rows = list.slice(0, 50).map((s) => signalRowHtml(s, ctx)).join("\n");
      return (
        `<section class="panel panel-wide" aria-label="${esc(SIGNAL_KIND_LABELS[kind])}">` +
        `<div class="panel-head"><h2 class="section-h">${esc(SIGNAL_KIND_LABELS[kind])}</h2>` +
        `<span class="panel-note">${fmtInt(list.length)} in window · threshold v${esc(artifact.thresholdVersion)}</span></div>` +
        `<p class="section-note signal-rule"><strong>Rule:</strong> ${esc(rule)}</p>` +
        `<div class="table-scroll"><table class="etable etable-compact">` +
        `<caption class="visually-hidden">${esc(SIGNAL_KIND_LABELS[kind])} signals</caption>` +
        `<thead><tr><th scope="col">Filed ▾</th><th scope="col">Member</th><th scope="col">Ticker</th>` +
        `<th scope="col">Magnitude</th><th scope="col">Traded</th><th scope="col">Receipts</th></tr></thead>` +
        `<tbody>${rows}</tbody></table></div>` +
        (list.length > 50
          ? terminusRow({
              author: "populus",
              html: `${fmtInt(list.length - 50)} further signals of this kind are in the artifact but not rendered here — a render bound; the artifact at <a href="/signals/data/signals.v1.json">signals.v1.json</a> is complete for the window.`,
            })
          : "") +
        `</section>`
      );
    })
    .join("\n");
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
    `<div class="signals-meta caveat-line">` +
    esc(
      `coverage window ${artifact.coverageFrom} → ${artifact.coverageTo} (${artifact.retentionDays} days by filed date) · ` +
        `signals outside it are compacted out — a last-seen marker older than the window start is a coverage gap, stated, never a complete-looking list · ` +
        (artifact.dateAnomaliesExcluded > 0
          ? `${artifact.dateAnomaliesExcluded} date-anomaly rows excluded before any rule ran · `
          : "") +
        artifact.lagCaveat,
    ) +
    `</div>` +
    sections +
    supersededSection +
    withheld
  );
}

/** Per-entity signal section (D-2): the member page filters the build's
    artifact by bioguide. */
export function memberSignalsPanel(artifact: SignalArtifact, bioguide: string, ctx: RenderCtx): string {
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
