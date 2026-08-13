/* A-3 watchlist: the last-seen cursor contract (read/write/corruption), the
   D-1c coverage-gap classification, watched-row selection, and latest-filed
   chips. All pure — the client island calls exactly these functions. */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  CURSOR_KEY,
  readCursor,
  writeCursor,
  classifyCursor,
  isNewSince,
  watchedRows,
  latestFiledByKey,
  type SeenCursor,
} from "../src/lib/watchlist.ts";

function memStorage(): { getItem(k: string): string | null; setItem(k: string, v: string): void; map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
  };
}

const cursor: SeenCursor = { v: 1, lastSeenFiled: "2026-08-01", buildId: "20260812.1", at: "2026-08-01T00:00:00Z" };

test("cursor round-trips; corrupt or malformed storage reads as absent", () => {
  const s = memStorage();
  assert.equal(readCursor(s), null);
  writeCursor(s, cursor);
  assert.deepEqual(readCursor(s), cursor);
  s.map.set(CURSOR_KEY, "{not json");
  assert.equal(readCursor(s), null);
  s.map.set(CURSOR_KEY, JSON.stringify({ v: 1, lastSeenFiled: "yesterday", buildId: "x", at: "y" }));
  assert.equal(readCursor(s), null, "a non-date marker must not classify anything");
});

test("D-1c: a cursor before the retained window is a coverage GAP, never a confident diff", () => {
  assert.equal(classifyCursor(null, "2026-01-01").kind, "none");
  assert.equal(classifyCursor(cursor, "2026-01-01").kind, "current");
  const gap = classifyCursor(cursor, "2026-08-05");
  assert.equal(gap.kind, "gap");
  // boundary: a cursor exactly at the window start is inside it
  assert.equal(classifyCursor(cursor, "2026-08-01").kind, "current");
});

test("isNewSince: strictly after the marker", () => {
  assert.equal(isNewSince({ filed: "2026-08-02" }, cursor), true);
  assert.equal(isNewSince({ filed: "2026-08-01" }, cursor), false);
});

test("watchedRows: matches on member OR ticker; latestFiledByKey tracks maxima", () => {
  const rows = [
    { bioguide: "A000001", ticker: "AAA", filed: "2026-08-02" },
    { bioguide: "B000002", ticker: "WMB", filed: "2026-08-03" },
    { bioguide: null, ticker: "WMB", filed: "2026-08-09" },
    { bioguide: "C000003", ticker: null, filed: "2026-08-04" },
  ];
  const members = new Set(["A000001"]);
  const tickers = new Set(["WMB"]);
  const hit = watchedRows(rows, members, tickers);
  assert.equal(hit.length, 3);
  const latest = latestFiledByKey(rows, members, tickers);
  assert.equal(latest.get("m:A000001"), "2026-08-02");
  assert.equal(latest.get("t:WMB"), "2026-08-09");
});

test("review r3-F6: earliestRetainedFiled spans BOTH families — reverting to txn-only fails here", async () => {
  const { earliestRetainedFiled } = await import("../src/lib/watchlist.ts");
  const t = (filed: string) => ({ filed });
  // transaction-only
  assert.equal(earliestRetainedFiled([t("2020-05-01"), t("2026-01-01")], [], "fb"), "2020-05-01");
  // paper-only — a txns-only implementation would return the fallback here
  assert.equal(earliestRetainedFiled([], [t("2015-02-03")], "fb"), "2015-02-03");
  // paper OLDER than the transaction history — the F6 case: a txns-only
  // boundary would misclassify a cursor between the two as a coverage gap
  assert.equal(
    earliestRetainedFiled([t("2020-05-01")], [t("2014-01-29")], "fb"),
    "2014-01-29",
  );
  // empty dataset → the declared fallback, never a fabricated date
  assert.equal(earliestRetainedFiled([], [], "2026-08-12"), "2026-08-12");
});

test("review r3-F6: the watchlist PAGE wires the helper with both families", async () => {
  // The page is build-time Astro; pin the wiring structurally so reverting
  // the frontmatter to a txns-only boundary reddens the suite (same class of
  // pin as the stylesheet tests).
  const { readFileSync } = await import("node:fs");
  const path = await import("node:path");
  const src = readFileSync(
    path.join(process.cwd(), "src", "pages", "watchlist", "index.astro"),
    "utf-8",
  );
  assert.match(src, /earliestRetainedFiled\(build\.txns, build\.paper/);
  assert.match(src, /data-filed-from=\{earliestFiled\}/);
});
