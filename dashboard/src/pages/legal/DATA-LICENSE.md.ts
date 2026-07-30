import type { APIRoute } from "astro";
import { getBuildData } from "../../lib/data";

// The per-source conditions register, shipped verbatim from the published
// data build (§15.1) — the footer's "DATA-LICENSE ↗" target.
export const GET: APIRoute = () =>
  new Response(getBuildData().dataLicenseMd, {
    headers: { "Content-Type": "text/markdown; charset=utf-8" },
  });
