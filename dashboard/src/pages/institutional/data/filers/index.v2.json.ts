import type { APIRoute } from "astro";
import { filerTailShards, getBuildData } from "../../../../lib/data";

/* Active v2 tail index: CIK -> [first shard, last shard, exact fragments]. */
export const GET: APIRoute = () =>
  new Response(filerTailShards(getBuildData()).indexBody, {
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
