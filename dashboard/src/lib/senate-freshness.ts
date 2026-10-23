/* senate-freshness.ts — the one statement a DEGRADED build makes about its
   Senate data (PLAN: Senate eFD degraded publish, R7).

   When the Senate eFD site refuses the nightly handshake, the publish carries
   the previous release's Senate rows forward and `stats.json` says so in
   `freshness.senate_degraded` (src/populus/stats.py, `senate_degraded_state`).
   Every surface that shows Senate data prints this statement, from this one
   module, and only when that key is a non-null object. Pure (it imports only
   the client-safe format.ts) so the client entity route shares it with the
   server.

   The date it names is the LAST SUCCESSFUL Senate check (`last_good_ingest_at`,
   the staleness anchor the CLI enforced), never `blocked_since`: blocked runs
   from publishes that failed are never persisted, so the first recorded block
   can be later than the real one. "Has not allowed" is deliberate: it is true
   for a 403, a 429 and an unreachable site alike, where "blocked" would claim
   a cause the pipeline cannot always prove. */

import { esc, note } from "./format.ts";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function isoDate(v: unknown): string | null {
  return typeof v === "string" && ISO_DATE.test(v) ? v : null;
}

/** The UTC date of an ISO timestamp the pipeline wrote with an explicit UTC
    offset (`…+00:00` or `…Z`), or null. */
function utcDateOf(v: unknown): string | null {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]00:?00)$/.test(v)) return null;
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : new Date(t).toISOString().slice(0, 10);
}

export interface SenateDegraded {
  /** newest Senate filed date in this build (`senate_db_max_filed_date`) */
  filedThrough: string | null;
  /** UTC date of the last successful Senate check (`last_good_ingest_at`) */
  lastGood: string | null;
}

/** The degraded state, or null when the build's Senate data is current (the
    key is null, or absent in a build that predates it). */
export function senateDegraded(stats: unknown): SenateDegraded | null {
  const freshness = (stats as { freshness?: Record<string, unknown> } | null | undefined)?.freshness;
  const state = freshness?.senate_degraded;
  if (state === null || typeof state !== "object") return null;
  return {
    filedThrough: isoDate(freshness?.senate_db_max_filed_date),
    lastGood: utcDateOf((state as Record<string, unknown>).last_good_ingest_at),
  };
}

const UNSTATED = "a date not stated";

/** "Senate filings through 2026-10-22 (the last successful Senate check,
    2026-10-23); the Senate site has not allowed automated access since
    then." — or null when not degraded. */
export function senateStalenessSentence(stats: unknown): string | null {
  const d = senateDegraded(stats);
  if (d === null) return null;
  return (
    `Senate filings through ${d.filedThrough ?? UNSTATED} (the last successful Senate check, ${d.lastGood ?? UNSTATED}); ` +
    `the Senate site has not allowed automated access since then.`
  );
}

/** The visible short form for the one surface under a word gate (/congress/,
    SC5 240 words): "Senate filings through 2026-10-22, not updated since
    2026-10-23." The full sentence rides in its tip. */
export function senateStalenessShort(stats: unknown): string | null {
  const d = senateDegraded(stats);
  if (d === null) return null;
  return `Senate filings through ${d.filedThrough ?? UNSTATED}, not updated since ${d.lastGood ?? UNSTATED}.`;
}

/** /congress/'s degraded line: the short form visible, the full sentence in
    its ⓘ tip (a tip is not visible copy under SC5). "" when not degraded. */
export function senateStaleLineHtml(stats: unknown): string {
  const full = senateStalenessSentence(stats);
  if (full === null) return "";
  return (
    esc(senateStalenessShort(stats) ?? "") +
    " " +
    note(full, { scope: "congress-head" }, "senate-stale", { trigger: "mark", textHtml: "ⓘ", name: "About the Senate data" })
  );
}

/** The member payload's meta addition: `{ senateNotice }` in a degraded build,
    `{}` otherwise, so a current build's endpoint bytes do not change. The
    client entity route reads it back into `BuildStamps.senateNotice`. */
export function senateNoticeMeta(stats: unknown): { senateNotice?: string } {
  const sentence = senateStalenessSentence(stats);
  return sentence === null ? {} : { senateNotice: sentence };
}
