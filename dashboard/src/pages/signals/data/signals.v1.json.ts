// D-1: the per-build signal artifact, served verbatim. Discord (D-3, later)
// and the /signals page consume the SAME structure — no derivation logic in
// any consumer.
import type { APIRoute } from "astro";
import { getSignalArtifact } from "../../../lib/data";

export const GET: APIRoute = () =>
  new Response(JSON.stringify(getSignalArtifact()), {
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
