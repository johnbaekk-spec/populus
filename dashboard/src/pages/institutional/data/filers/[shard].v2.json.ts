import type { APIRoute, GetStaticPaths } from "astro";
import { filerTailShards, getBuildData } from "../../../../lib/data";

function family() {
  return filerTailShards(getBuildData());
}

export const getStaticPaths: GetStaticPaths = () =>
  family().shards.map((shard) => ({ params: { shard: shard.name } }));

export const GET: APIRoute = ({ params }) => {
  const shard = family().shards.find((candidate) => candidate.name === params.shard);
  if (!shard) {
    return new Response(JSON.stringify({ error: "no such filer fragment shard" }), {
      status: 404,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  }
  return new Response(shard.body, {
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
};
