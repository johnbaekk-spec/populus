import type { APIRoute, GetStaticPaths } from "astro";
import { getBuildData, instDirectoryFamily } from "../../../../lib/data";

/* The /institutional/ filer directory shard family (launch redesign M7b; R32,
   LD28). Same-origin, build-scoped JSON: the directory's slim rows cut at the
   1 MiB client-response ceiling into at most `INST_DIRECTORY_SHARDS_MAX`
   files (`src/populus/inst_budget.py`, summed in both file projections). The
   page inlines the list of these paths and fetches them on the first search,
   chip or sort; its server-rendered first rows never depend on them.

   `getStaticPaths` and every `GET` read the same memoized plan, so the routes
   Astro enumerates and the bytes they serve cannot disagree. A build without
   the module still emits shard 0, whose body states an empty total. */

function family() {
  return instDirectoryFamily(getBuildData());
}

export const getStaticPaths: GetStaticPaths = () =>
  family().shards.map((shard) => ({ params: { shard: shard.name } }));

export const GET: APIRoute = ({ params }) => {
  const shard = family().shards.find((candidate) => candidate.name === params.shard);
  if (!shard) {
    return new Response(JSON.stringify({ error: "no such directory shard" }), {
      status: 404,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  }
  return new Response(shard.body, {
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
};
