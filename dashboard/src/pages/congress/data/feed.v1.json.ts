import type { APIRoute } from "astro";
import { getBuildData } from "../../../lib/data";

// The full default-view dataset, deployed with the build (same-origin,
// build-scoped — ARCHITECTURE §12.1). Fetched lazily by the feed's
// client-side filter island; never fetched cross-origin.
export const GET: APIRoute = () =>
  new Response(getBuildData().dataset, {
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
