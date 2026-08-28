import type { APIRoute } from "astro";
import { getBuildData } from "../../lib/data";

// The prebuilt search index: tickers · members · filers from THIS build,
// fetched same-origin on first focus. The payload's field allowlist and
// serialized-size budget are asserted by test/search.test.ts.
export const GET: APIRoute = () =>
  new Response(getBuildData().searchIndexJson, {
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
