import type { APIRoute } from "astro";

/* Transition tombstone only — RUN M2-12 (Codex F3).

   M2-12 made `deltaTotalsByPeriod` a REQUIRED key of the filer payload and its
   fragment metadata. That is a breaking change to a cached transport: a client
   holding the pre-change bundle would fetch the new shards and fail its strict
   validator with `bad_payload` (a RETRYABLE defect, so it would retry into the
   same wall), and a new client served a stale cached shard would fail the same
   way from the other side.

   Moving the data to `.v3.json` makes that impossible — neither version can
   receive the other's bytes — and this body converts the skew into the state it
   actually is. Cached v2 client code checks `v` before `kind`, so it reports
   `version_mismatch`, not a retry loop. Identical in shape and intent to the v1
   tombstone beside it, which is the precedent this follows. */

const BODY = '{"v":3,"kind":"filer-index-upgrade-required"}';

export const GET: APIRoute = () => {
  return new Response(BODY, {
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
};
