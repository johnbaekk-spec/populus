/* DESIGN-POLISH M4 (R28, T4.3): the reviewed fund-wrapper list against the
   BUILT closed quarter. Every entry must match an issuer name filed in that
   quarter — any filer's position, from the serving artifact the build read —
   so a stale entry fails here instead of accumulating. The quarter is the one
   the built /institutional/ page names. Runs after a data build. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { resolveServingDbPath } from "../../src/lib/activity.ts";
import { FUND_WRAPPER_ISSUERS, staleFundWrapperEntries } from "../../src/lib/notable-moves.ts";

const DIST = path.join(process.cwd(), "dist");

test("T4.3 (R28): no reviewed fund-wrapper entry is stale on the built closed quarter", (t) => {
  const page = path.join(DIST, "institutional", "index.html");
  const db = resolveServingDbPath();
  if (!existsSync(page) || !db || !existsSync(db)) {
    t.skip("no data build: dist/ has no /institutional/ page or the serving artifact is absent");
    return;
  }
  const period = /id="inst-notable-moves"[^>]*data-moves-period="([^"]*)"/.exec(readFileSync(page, "utf-8"))?.[1] ?? "";
  assert.notEqual(period, "", "the built page names its closed quarter");
  const conn = new DatabaseSync(db, { readOnly: true });
  try {
    const names = (conn.prepare("SELECT DISTINCT issuer_name AS n FROM serving_filer_rows WHERE period = ?").all(period) as { n: string }[]).map((r) => r.n);
    assert.ok(names.length > 0, `issuers are filed in ${period}`);
    assert.deepEqual(staleFundWrapperEntries(names, FUND_WRAPPER_ISSUERS).map((e) => e.key), [], `entries matching no issuer filed in ${period} — remove them or re-review the list`);
  } finally {
    conn.close();
  }
});
