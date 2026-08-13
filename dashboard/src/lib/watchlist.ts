/* A-3 (ALPHA-UX): the /watchlist read surface over the watch-v2 store, and
   the per-device last-seen cursor (plan F-10, D-1c grammar).

   The cursor is a device-local filed-date high-water mark. Its honesty rule
   is D-1c's: when the cursor predates the data this build retains, the page
   renders an explicit COVERAGE-GAP state — it never presents a truncated
   "new since you last looked" list as complete. Pure module: DOM-free, so
   the client island and the tests share every decision. */

import type { StorageLike } from "../scripts/entity-client.ts";
import type { TxnRow } from "./format.ts";

export const CURSOR_KEY = "populus:watch:cursor:v1";

export interface SeenCursor {
  v: 1;
  /** filed-date high-water mark: rows filed AFTER this are "new since you last looked" */
  lastSeenFiled: string; // YYYY-MM-DD
  buildId: string; // the build the user last marked seen against
  at: string; // ISO timestamp of the mark, display only
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function readCursor(storage: StorageLike): SeenCursor | null {
  let raw: string | null;
  try {
    raw = storage.getItem(CURSOR_KEY);
  } catch {
    return null;
  }
  if (raw == null) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<SeenCursor>;
    if (
      parsed?.v === 1 &&
      typeof parsed.lastSeenFiled === "string" &&
      DATE_RE.test(parsed.lastSeenFiled) &&
      typeof parsed.buildId === "string" &&
      typeof parsed.at === "string"
    ) {
      return parsed as SeenCursor;
    }
  } catch {
    // corrupt cursor: treated as absent — the page renders first-visit state
  }
  return null;
}

export function writeCursor(storage: StorageLike, cursor: SeenCursor): void {
  try {
    storage.setItem(CURSOR_KEY, JSON.stringify(cursor));
  } catch {
    // storage denied: the cursor is a convenience, never load-bearing
  }
}

export type CursorState =
  | { kind: "none" } // first visit on this device — nothing to diff against
  | { kind: "gap"; cursor: SeenCursor; datasetFrom: string } // cursor predates retained data
  | { kind: "current"; cursor: SeenCursor };

/** D-1c: `datasetFrom` is the earliest FILED date this build retains. A
    cursor before it means filings between the two visits may be missing from
    the dataset — the UI must say so instead of rendering a confident list. */
export function classifyCursor(cursor: SeenCursor | null, datasetFrom: string): CursorState {
  if (cursor === null) return { kind: "none" };
  if (cursor.lastSeenFiled < datasetFrom) return { kind: "gap", cursor, datasetFrom };
  return { kind: "current", cursor };
}

export function isNewSince(row: Pick<TxnRow, "filed">, cursor: SeenCursor): boolean {
  return row.filed > cursor.lastSeenFiled;
}

/** The earliest FILED date this build retains, across BOTH row families
    (review F6): a paper-only corpus, or paper history older than the
    transaction history, must not manufacture a false coverage gap. */
export function earliestRetainedFiled(
  txns: readonly Pick<TxnRow, "filed">[],
  paper: readonly { filed: string }[],
  fallback: string,
): string {
  let min: string | null = null;
  for (const r of [...txns, ...paper]) {
    if (min === null || r.filed < min) min = r.filed;
  }
  return min ?? fallback;
}

/** Rows belonging to the watched sets — member-watched by bioguide, ticker-
    watched by exact ticker. A row can match on either. */
export function watchedRows<T extends Pick<TxnRow, "bioguide" | "ticker">>(
  rows: readonly T[],
  members: ReadonlySet<string>,
  tickers: ReadonlySet<string>,
): T[] {
  return rows.filter(
    (r) =>
      (r.bioguide !== null && members.has(r.bioguide)) ||
      (r.ticker !== null && tickers.has(r.ticker)),
  );
}

/** Latest filed date per watched key, for the entity chips. */
export function latestFiledByKey(
  rows: readonly Pick<TxnRow, "bioguide" | "ticker" | "filed">[],
  members: ReadonlySet<string>,
  tickers: ReadonlySet<string>,
): Map<string, string> {
  const latest = new Map<string, string>();
  const bump = (key: string, filed: string): void => {
    const prior = latest.get(key);
    if (prior === undefined || filed > prior) latest.set(key, filed);
  };
  for (const r of rows) {
    if (r.bioguide !== null && members.has(r.bioguide)) bump(`m:${r.bioguide}`, r.filed);
    if (r.ticker !== null && tickers.has(r.ticker)) bump(`t:${r.ticker}`, r.filed);
  }
  return latest;
}
