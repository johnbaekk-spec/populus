import type { APIRoute } from "astro";

/* Transition tombstone only. Cached v1 client code treats an index 404 as
   honest out-of-extract, but checks `v` before `kind`; this exact payload makes
   rollout skew fail as version_mismatch without retaining any v1 data route. */

const BODY = '{"v":2,"kind":"filer-index-upgrade-required"}';

export const GET: APIRoute = () => {
  return new Response(BODY, {
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
};
