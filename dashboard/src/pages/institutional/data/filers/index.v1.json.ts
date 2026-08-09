import type { APIRoute } from "astro";
import { filerTailShards, getBuildData } from "../../../../lib/data";

/* RUN M2-11 T5 (plan R22, LD-9) — the filer routing index.

   Maps every published TAIL filer's zero-padded CIK to its shard file name.
   The index exists because a client holding only a CIK cannot compute a
   byte-spilled shard address (LD-9): shard membership is data-dependent, so
   only an index generated from the SAME projection that selected the top
   1,500 can be both bounded and complete — and `filerTailShards` fails the
   build if any published tail filer is missing from it.

   Same-origin, build-scoped JSON (G7: no browser call ever reaches SEC). A
   build without the module still emits the index with a NAMED absence — the
   `/e/` driver then answers S2, which a 404 could not distinguish from a
   deploy defect. */

export const GET: APIRoute = () => {
  return new Response(filerTailShards(getBuildData()).indexBody, {
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
};
