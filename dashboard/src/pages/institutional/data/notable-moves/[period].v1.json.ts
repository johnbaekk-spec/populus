import type { APIRoute } from "astro";
import { getBuildData, notableMovesFor, notableMovesPeriods } from "../../../../lib/data";
import { notableMovesShard } from "../../../../lib/notable-moves-derive";

/* R14: the notable-manager moves for one CLOSED quarter, ordered as the band
   orders them, cut at the 1 MiB client-response ceiling with the truncation
   stated. The band's "Show 50 more" and its chips read this. */
export function getStaticPaths(): { params: { period: string } }[] {
  return notableMovesPeriods(getBuildData()).map((period) => ({ params: { period } }));
}

export const GET: APIRoute = ({ params }) => {
  const build = getBuildData();
  const period = String(params.period);
  const { body } = notableMovesShard(period, notableMovesFor(build, period));
  return new Response(body, { headers: { "Content-Type": "application/json; charset=utf-8" } });
};
