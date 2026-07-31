import type { APIRoute, GetStaticPaths } from "astro";
import { getBuildData, tickerPayloadJson, tickerDataKeys } from "../../../../lib/data";

// One columnar endpoint per ticker — EVERY ticker, including budget-cut ones
// (Locked #13). The [key] param is the colon-safe filename form (`:` → `~`,
// see derive.tickerDataKey); the payload carries the real ticker in meta.
export const getStaticPaths: GetStaticPaths = () =>
  tickerDataKeys(getBuildData()).map(({ key, ticker }) => ({
    params: { key },
    props: { ticker },
  }));

export const GET: APIRoute = ({ props }) => {
  const body = tickerPayloadJson(getBuildData(), (props as { ticker: string }).ticker);
  return new Response(body, {
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
};
