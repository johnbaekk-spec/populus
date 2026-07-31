import type { APIRoute, GetStaticPaths } from "astro";
import { getBuildData, memberPayloadJson } from "../../../../lib/data";

// One columnar endpoint per member in the extract — EVERY member, including
// budget-cut ones: the endpoint is how /e/ serves a cut entity (Locked #13).
export const getStaticPaths: GetStaticPaths = () =>
  getBuildData().members.map((m) => ({ params: { bioguide: m.bioguide } }));

export const GET: APIRoute = ({ params }) => {
  const body = memberPayloadJson(getBuildData(), params.bioguide!);
  return new Response(body, {
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
};
