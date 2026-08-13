import type { APIRoute } from "astro";
import { filerTailShards, getBuildData } from "../../../../lib/data";

/* ACTIVE tail index, URL family v3: CIK -> [first shard, last shard, exact
   fragments]. The `.v3.json` in the path is the TRANSPORT version (bumped by
   M2-12 when `deltaTotalsByPeriod` became required); the fragment envelopes it
   routes to still carry their own `v: 2` schema discriminator. Two different
   version numbers, deliberately — `index.v2.json` beside this file is now a
   tombstone, not a route. */
export const GET: APIRoute = () =>
  new Response(filerTailShards(getBuildData()).indexBody, {
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
