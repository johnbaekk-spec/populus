/* senate-freshness.ts — the one statement a DEGRADED build makes about its
   Senate data (PLAN: Senate eFD degraded publish, R7).

   When the Senate eFD site refuses the nightly handshake, the publish carries
   the previous release's Senate rows forward and `stats.json` says so in
   `freshness.senate_degraded` (src/populus/stats.py, `senate_degraded_state`).
   Every surface that shows Senate data prints this sentence, from this one
   function, and only when that key is a non-null object. Pure and
   dependency-free so the client entity route can share it with the server.

   "Has not allowed" is deliberate: it is true for a 403, a re-rendered
   agreement form and an unreachable site alike, where "blocked" would claim a
   cause the pipeline cannot always prove. */

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function isoDate(v: unknown): string | null {
  return typeof v === "string" && ISO_DATE.test(v) ? v : null;
}

export interface SenateDegraded {
  /** newest Senate filed date in this build (`senate_db_max_filed_date`) */
  filedThrough: string | null;
  /** date the first refused Senate run after the last good one started */
  blockedSince: string | null;
}

/** The degraded state, or null when the build's Senate data is current (the
    key is null, or absent in a build that predates it). */
export function senateDegraded(stats: unknown): SenateDegraded | null {
  const freshness = (stats as { freshness?: Record<string, unknown> } | null | undefined)?.freshness;
  const state = freshness?.senate_degraded;
  if (state === null || typeof state !== "object") return null;
  return {
    filedThrough: isoDate(freshness?.senate_db_max_filed_date),
    blockedSince: isoDate((state as Record<string, unknown>).blocked_since),
  };
}

/** "Senate filings through 2026-10-22; the Senate site has not
    allowed automated access since 2026-10-23." — or null when not degraded. */
export function senateStalenessSentence(stats: unknown): string | null {
  const d = senateDegraded(stats);
  if (d === null) return null;
  return (
    `Senate filings through ${d.filedThrough ?? "a date not stated"}; ` +
    `the Senate site has not allowed automated access since ${d.blockedSince ?? "a date not stated"}.`
  );
}

/** The member payload's meta addition: `{ senateNotice }` in a degraded build,
    `{}` otherwise, so a current build's endpoint bytes do not change. The
    client entity route reads it back into `BuildStamps.senateNotice`. */
export function senateNoticeMeta(stats: unknown): { senateNotice?: string } {
  const sentence = senateStalenessSentence(stats);
  return sentence === null ? {} : { senateNotice: sentence };
}
