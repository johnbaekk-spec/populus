import type { APIRoute, GetStaticPaths } from "astro";
import { getBuildData } from "../../../../lib/data";
import { activityFeed } from "../../../../lib/activity";

/* RUN M2-8 T13 (plan R13) — the activity shard family.
   Same-origin, build-scoped JSON (ARCHITECTURE §12.1, G7: no browser call ever
   reaches SEC). One file per page of the ONE byte-aware pagination rule in
   lib/activity.ts — a page closes at 2,000 records or 2 MiB of measured
   serialized bytes, whichever binds first, and the walk stops at 64 shards with
   any remainder stated as a truncation inside every body.

   `getStaticPaths` and every `GET` read the same memoized feed, so the routes
   Astro enumerates and the bytes they serve cannot disagree. A build with no
   activity projection still emits page 0 — its body names the absence, which a
   404 could not. */

function feed() {
  return activityFeed({ instPresent: getBuildData().inst.present });
}

export const getStaticPaths: GetStaticPaths = () =>
  feed().pagination.pages.map((p) => ({ params: { page: String(p.page) } }));

export const GET: APIRoute = ({ params }) => {
  const page = feed().pagination.pages.find((p) => String(p.page) === params.page);
  if (!page) {
    return new Response(JSON.stringify({ error: "no such activity page" }), {
      status: 404,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  }
  return new Response(page.body, {
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
};
