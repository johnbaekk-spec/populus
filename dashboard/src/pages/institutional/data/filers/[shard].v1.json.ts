import type { APIRoute, GetStaticPaths } from "astro";
import { filerTailShards, getBuildData } from "../../../../lib/data";

/* RUN M2-11 T5 (plan R22, LD-10) — the filer tail shard family.

   One file per shard of `FilerPayloadV1` entries, cut by the generalized
   byte-bounded paginator (`lib/shards.ts`) under the 1 MiB client-response
   ceiling. The family FAILS the build rather than truncating or widening: a
   published tail filer is in exactly one shard, addressed by the routing
   index beside this route, or there is no build.

   `getStaticPaths` and every `GET` read the same memoized family, so the
   routes Astro enumerates and the bytes they serve cannot disagree. */

function family() {
  return filerTailShards(getBuildData());
}

export const getStaticPaths: GetStaticPaths = () =>
  family().shards.map((s) => ({ params: { shard: s.name } }));

export const GET: APIRoute = ({ params }) => {
  const shard = family().shards.find((s) => s.name === params.shard);
  if (!shard) {
    return new Response(JSON.stringify({ error: "no such filer shard" }), {
      status: 404,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  }
  return new Response(shard.body, {
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
};
