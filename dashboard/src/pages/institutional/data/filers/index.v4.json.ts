import type { APIRoute } from "astro";
import { filerTailShards, getBuildData } from "../../../../lib/data";

/* ACTIVE tail index, URL family v4: CIK -> [first shard, last shard, exact
   fragments]. The `.v4.json` in the path is the TRANSPORT version (bumped by
   M2-12 when `deltaTotalsByPeriod` became required, and again by the
   refinement review's F3 when `kindsByPeriod`, `discontinuityPeriods` and
   `typing` did); the fragment envelopes it routes to still carry their own
   `v: 2` schema discriminator. Two different version numbers, deliberately —
   `index.v2.json` and `index.v3.json` beside this file are tombstones. */
export const GET: APIRoute = () =>
  new Response(filerTailShards(getBuildData()).indexBody, {
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
