import type { APIRoute, GetStaticPaths } from "astro";
import { getBuildData, tickerPayloadJson, tickerDataKeys } from "../../../../lib/data";

// One columnar endpoint per ticker — EVERY ticker, including budget-cut and
// path-hostile ones. The [key] param is derive.tickerDataKey's
// escaped form: safe bytes pass through, anything else (colons, whitespace —
// the Senate corpus contains a ticker with a literal newline) becomes ~XX per
// UTF-8 byte. The payload carries the real ticker in meta.
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
