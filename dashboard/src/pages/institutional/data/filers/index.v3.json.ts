import type { APIRoute } from "astro";

/* Transition tombstone only (refinement 20260910, Codex review F3).

   The filer payload gained three REQUIRED keys — `kindsByPeriod`,
   `discontinuityPeriods` and `typing` — so the tail route (/e/) renders the same
   new-stake/exit stats, book-discontinuity banner and curated identity as the
   pre-rendered filer page. A cached v3 client would fail its strict validator on
   the new shards as a RETRYABLE `bad_payload`, so the data moved to `.v4.json`
   and this body converts the skew into `version_mismatch` — the precedent the
   v1 and v2 tombstones beside it set. */

const BODY = '{"v":4,"kind":"filer-index-upgrade-required"}';

export const GET: APIRoute = () => {
  return new Response(BODY, {
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
};
