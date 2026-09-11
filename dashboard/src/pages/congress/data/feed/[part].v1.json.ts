import type { APIRoute } from "astro";
import { getBuildData, feedPartsPlan } from "../../../../lib/data";

/* R12 / LD7: one byte-bounded per-year part of the congress feed
   (`/congress/data/feed/{year}-{n}.v1.json`), each ≤ SHARD_RESPONSE_CEILING_BYTES.
   The full `feed.v1.json` stays published beside these; the feed island reads
   the parts for first paint and paging and the full dataset for filtering. */
export function getStaticPaths(): { params: { part: string } }[] {
  return feedPartsPlan(getBuildData()).index.parts.map((p) => ({ params: { part: p.part } }));
}

export const GET: APIRoute = ({ params }) => {
  const body = feedPartsPlan(getBuildData()).bodies.get(String(params.part));
  if (body === undefined) throw new Error(`feed part ${String(params.part)} is not in the plan`);
  return new Response(body, { headers: { "Content-Type": "application/json; charset=utf-8" } });
};
