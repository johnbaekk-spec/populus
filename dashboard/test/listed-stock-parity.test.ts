/* R9 / T6 (SIGNALS-CLARITY M2): the TypeScript listed-stock set is a SUBSET of
   the Python equity classifier.

   `LISTED_STOCK_TYPES` (dashboard/src/lib/format.ts) is narrower than Python's
   "equity" — `PS` (stock, not publicly traded) is equity but not LISTED stock —
   so the relation pinned here is one-way: every member of the TS set must map
   to "equity" in `EQUITY_CLASS_MAP` (src/populus/backfill.py). Adding a type to
   the TS set that Python does not call equity (a `CS` bond, an `OP` option)
   fails this test; that is the mutation it exists to catch (declared debt TD-2:
   two vocabularies until one cross-runtime file exists). */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import { LISTED_STOCK_TYPES, isListedStock } from "../src/lib/format.ts";

const BACKFILL = path.resolve(import.meta.dirname, "..", "..", "src", "populus", "backfill.py");

/** Parse `EQUITY_CLASS_MAP: dict[str, str] = { "KEY": "class", ... }` out of the
    Python source. Refuses (throws) rather than guessing when the block or an
    entry line does not have the expected shape. */
function parseEquityClassMap(src: string): Map<string, string> {
  const start = src.indexOf("EQUITY_CLASS_MAP: dict[str, str] = {");
  if (start < 0) throw new Error("EQUITY_CLASS_MAP not found in backfill.py");
  const end = src.indexOf("\n}", start);
  if (end < 0) throw new Error("EQUITY_CLASS_MAP has no closing brace");
  const out = new Map<string, string>();
  for (const raw of src.slice(src.indexOf("{", start) + 1, end).split("\n")) {
    const line = raw.replace(/#.*$/, "").trim();
    if (line === "") continue;
    const m = /^"([^"]+)":\s*"([^"]+)",?$/.exec(line);
    if (!m) throw new Error(`unparsed EQUITY_CLASS_MAP line: ${raw}`);
    if (out.has(m[1]!)) throw new Error(`duplicate EQUITY_CLASS_MAP key: ${m[1]}`);
    out.set(m[1]!, m[2]!);
  }
  if (out.size === 0) throw new Error("EQUITY_CLASS_MAP parsed empty");
  return out;
}

test("T6: every listed-stock type is 'equity' in Python's EQUITY_CLASS_MAP", () => {
  const map = parseEquityClassMap(readFileSync(BACKFILL, "utf-8"));
  assert.ok(map.size >= 10, `parsed ${map.size} entries`);
  assert.ok(LISTED_STOCK_TYPES.size > 0);
  for (const t of LISTED_STOCK_TYPES) assert.equal(map.get(t), "equity", `${t} must be equity in EQUITY_CLASS_MAP`);
  // the subset is strict and deliberate: PS is equity, but not publicly traded
  assert.equal(map.get("PS"), "equity");
  assert.equal(isListedStock("PS"), false);
});

test("T6 control: the parity check fails when a non-equity type joins the set", () => {
  const map = parseEquityClassMap(readFileSync(BACKFILL, "utf-8"));
  const mutated = new Set([...LISTED_STOCK_TYPES, "CS"]);
  const offenders = [...mutated].filter((t) => map.get(t) !== "equity");
  assert.deepEqual(offenders, ["CS"], "adding CS (corporate bonds) to the TS set is caught");
  // the parser refuses a malformed block instead of reading it as empty
  assert.throws(() => parseEquityClassMap('EQUITY_CLASS_MAP: dict[str, str] = {\n    ST: equity\n}'), /unparsed/);
  assert.throws(() => parseEquityClassMap("nothing here"), /not found/);
});
