import type { APIRoute } from "astro";
import { getBuildData, feedPartsPlan } from "../../../../lib/data";

/* R12 / LD7: the part index — every part with its row counts, first/last
   row keys and transaction offsets, so a page can be located without a row. */
export const GET: APIRoute = () =>
  new Response(JSON.stringify(feedPartsPlan(getBuildData()).index), {
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
