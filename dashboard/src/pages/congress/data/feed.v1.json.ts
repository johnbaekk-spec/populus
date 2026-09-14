import type { APIRoute } from "astro";

/* RETIREMENT TOMBSTONE — R19. This path used to serve the whole congress
   corpus as one asset. On 2026-09-13 it measured 22,382,648 B: 85.4% of
   Cloudflare Pages' hard 25 MiB per-asset limit, which is identical on the
   free and paid plans, so there was no upgrade out of it. At the measured
   9,287 disclosures a year and ~310 B each, the remaining margin was about
   sixteen months — after which every deploy would have been rejected outright.

   The data did not go anywhere. It is published under `/congress/data/feed/`
   as per-year parts, each bounded by `SHARD_RESPONSE_CEILING_BYTES` (1 MiB),
   listed by `/congress/data/feed/index.v1.json` and described for a human
   reader — no JavaScript required — at `/congress/data/`. Concatenating the
   parts the index names reproduces exactly the rows this path served, in
   exactly the order it served them.

   Published artifacts are the API, so the path stays and states its own
   retirement rather than 404-ing. The body is deliberately one a cached
   client REFUSES: `dataset_version: 0` can never be a real dataset version, so
   `classifyDataset` returns `version_mismatch` and the stale island renders
   its "couldn't load the full dataset" state over the still-correct
   server-rendered page — fail-closed, never a partial corpus painted as a
   whole one. This is the precedent the `institutional/data/filers/index.v*`
   tombstones set. */

const BODY = JSON.stringify({
  dataset_version: 0,
  kind: "congress-feed-retired",
  reason:
    "the single-asset congress feed is retired: it reached 85% of the 25 MiB " +
    "per-asset provider limit. The same rows are published as byte-bounded parts.",
  parts_index: "/congress/data/feed/index.v1.json",
  human_readable: "/congress/data/",
});

export const GET: APIRoute = () =>
  new Response(BODY, {
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
