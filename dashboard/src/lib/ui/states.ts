/* Pure page/section renderers. Every entity body is a string function called
   by the thin .astro page for SSR AND by the generic-route client driver —
   parity is by construction (one function, two callers). No Node APIs, no DOM.

   Honesty grammar: G1–G7 via the canonical format.ts components; charts
   zero-based, gaps stay gaps, no midpoints; NULL-honest institutional
   integers; the as-of time stamp every 13F table carries. */

/* ui/states.ts — the S1/S2/S4/S7 state blocks (Slice 6 split). */

import { esc } from "../format.ts";
import {
  type FilingWindow,
  bioguideProfileUrl,
  edgarFilerUrl,
  edgarTickerUrl,
} from "../derive.ts";

/* ---------- states S1/S2/S4/S7 ---------- */

export function s1ModuleAbsent(reason: "module-absent" | "artifact-missing"): string {
  const detail =
    reason === "artifact-missing"
      ? `This build's manifest declares the institutional module, but its aggregate artifact is not readable here — so the pages hold back rather than render unverified numbers.`
      : `This build does not include the institutional module. When a build passes the module's publication gates, filer and holder pages render here from its published aggregate — until then, absence is stated instead of simulated.`;
  return (
    `<div class="s1-block">` +
    `<div class="s1-mark" aria-hidden="true"></div>` +
    `<h1 class="s1-h">This build withheld the institutional module — deliberately.</h1>` +
    `<p class="s1-detail">${detail}</p>` +
    `<p class="mono-note">module presence is read from the build manifest · <a href="/methodology/#m2">methodology §13F ↗</a></p>` +
    `</div>`
  );
}

export function s2OutOfExtract(kind: "m" | "t" | "f", key: string): string {
  const noun = kind === "m" ? "member" : kind === "t" ? "ticker" : "filer";
  const source =
    kind === "m"
      ? { label: "Open this member's official bioguide profile ↗", href: bioguideProfileUrl(key) }
      : kind === "f"
        ? { label: "Open this filer on SEC EDGAR ↗", href: edgarFilerUrl(key) }
        : { label: `Search ${key} on SEC EDGAR ↗`, href: edgarTickerUrl(key) };
  return (
    `<div class="s2-block">` +
    `<div class="crumb">/e/ · ${esc(kind)}:${esc(key)}</div>` +
    `<h1 class="s1-h">We don't render a page for this ${noun}.</h1>` +
    `<p class="s1-detail">It falls outside the published extract for this build. Rendering it here would mean showing numbers that haven't been through the pipeline's checks — so instead, here is the primary source itself:</p>` +
    `<a class="cta" href="${esc(source.href)}" rel="noopener" target="_blank">${esc(source.label)}</a>` +
    `<p class="mono-note">the extract boundary is a published budget, not a paywall</p>` +
    `</div>`
  );
}

export function s4Skeleton(endpoint: string, keyLabel: string): string {
  return (
    `<div class="s4-shell">` +
    `<div class="crumb">${esc(keyLabel)}</div>` +
    `<p class="s4-note">long-tail entity — rendered on your device from the same published extract <span class="mono-note">${esc(
      endpoint,
    )}</span></p>` +
    `<div class="feed-loading" aria-hidden="true">` +
    `<div class="bar" style="width:88%"></div><div class="bar" style="width:76%"></div>` +
    `<div class="bar" style="width:82%"></div><div class="bar" style="width:64%"></div></div>` +
    `<p class="mono-note">same-origin fetch · no external calls · identical template to pre-rendered pages</p>` +
    `<p class="visually-hidden" role="status">Loading the published record for this page.</p>` +
    `</div>`
  );
}

export type S4ErrorKind =
  | "server_error"
  | "network_error"
  | "bad_payload"
  | "version_mismatch"
  | "render_error"
  | "timeout"
  | "key_error";

export function s4Error(kind: S4ErrorKind, endpoint: string, detail: string, retryable: boolean): string {
  const heads: Record<S4ErrorKind, string> = {
    server_error: "The extract endpoint answered with an error.",
    network_error: "The request did not complete.",
    bad_payload: "The endpoint answered, but not with a usable record.",
    version_mismatch: "This page's code and the published data disagree on version.",
    render_error: "The record loaded but this page failed to draw it.",
    timeout: "This is taking too long.",
    key_error: "This is not a valid entity address.",
  };
  return (
    `<div class="s4-error" data-error-kind="${esc(kind)}">` +
    `<h1 class="s1-h">${esc(heads[kind])}</h1>` +
    `<p class="s1-detail">${esc(detail)} Nothing shown here is stale or invented — the published extract is still the record.</p>` +
    `<div class="s4-actions">` +
    (retryable ? `<button class="cta" data-retry>Try again</button>` : "") +
    (kind !== "key_error"
      ? `<a class="plain-link" href="${esc(endpoint)}">open the raw endpoint ↗</a>`
      : `<a class="plain-link" href="/congress/">back to the feed ↗</a>`) +
    `</div></div>`
  );
}

export function s7Banner(window: FilingWindow): string {
  return (
    `<div class="s7-banner" role="note">` +
    `<span class="s7-chip">FILING WINDOW OPEN</span>` +
    `<div class="s7-copy">Quarter <strong>${esc(window.quarterEnd)}</strong>: the 13F window is open until <strong>${esc(
      window.deadline,
    )}</strong>. Rankings and QoQ moves that touch this quarter are <strong>provisional by construction</strong> — filers who have not yet reported are not zeros.</div>` +
    `</div>`
  );
}
