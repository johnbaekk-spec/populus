/* Launch review H10: the phone drawer's and the search sheet's 13F count is
   every filer in the build — "13F filers on record", the home ledger's label
   for the same number — never a bare "N 13F filers" that reads as a census of
   active filers. Base.astro computes both strings; this reads its source. */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const BASE = readFileSync(path.resolve(import.meta.dirname, "..", "src", "layouts", "Base.astro"), "utf-8");
const BARE = /\$\{fmtInt\(instFilers\)\} 13F filers(?! on record)/;

test("H10: the drawer count and the search hint both say '13F filers on record'", () => {
  assert.equal((BASE.match(/\$\{fmtInt\(instFilers\)\} 13F filers on record/g) ?? []).length, 2, "the drawer and the search hint");
  assert.doesNotMatch(BASE, BARE);
  // re-planted control: the reviewed wording is caught
  assert.match("institutional: `${fmtInt(instFilers)} 13F filers`", BARE);
});
