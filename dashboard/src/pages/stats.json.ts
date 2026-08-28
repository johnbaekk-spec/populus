import type { APIRoute } from "astro";
import { getBuildData } from "../lib/data";

// The published `stats.json`, served at the site root (ARCHITECTURE §12.1
// requires the count to live "in the one stats.json in *both* places
// identically", and the deploy gate asserts the two copies are byte-equal).
//
// This passes through the RAW canonical bytes read from
// `builds/<id>/congress/stats.json`. It must never parse-and-re-serialize: the
// producer renders that file as
// `json.dumps(…, ensure_ascii=False, indent=2, sort_keys=True) + "\n"`
// (`src/populus/stats.py`), and `JSON.stringify` reproduces neither the key
// order, the indentation, the non-ASCII escaping, nor the trailing newline.
// Byte-equality is pinned by `test/post/http-status.test.ts`.
export const GET: APIRoute = () =>
  new Response(getBuildData().statsJson, {
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
