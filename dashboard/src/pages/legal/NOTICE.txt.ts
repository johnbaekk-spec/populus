import type { APIRoute } from "astro";
import { getBuildData } from "../../lib/data";

// Required attributions, shipped verbatim from the published data build (§15.1).
export const GET: APIRoute = () =>
  new Response(getBuildData().noticeTxt, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
