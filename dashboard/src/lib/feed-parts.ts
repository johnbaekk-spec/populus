/* R12 / LD7 — the byte-bounded per-year PARTS of the congress feed.

   R19 UPDATE: `feed.v1.json` is RETIRED — it reached 85% of the provider's
   hard 25 MiB per-asset limit and now serves a fail-closed tombstone. These
   parts are the ONLY publication of the corpus: they carry every row a ranking
   page, the `<noscript>` link or a filter needs, and
   `scripts/feed-corpus.ts` reassembles them. The "published dataset" links all
   point at `/congress/data/`, which lists these parts for a human reader.
   The cut itself is unchanged: the merged feed, in its existing deterministic order
   (filed desc, transactions before paper within a date), is cut per calendar
   year of the filed date into parts whose complete serialized response never
   exceeds `SHARD_RESPONSE_CEILING_BYTES` — a part closes as soon as the next
   row would push it over, so a year yields as many parts as it needs.

   This module is PURE (no Node APIs beyond the ambient Buffer): the same
   planner serves the build-time routes, the page's inline index and the unit
   tests, so "which part holds which rows" has exactly one implementation.

   Wire format of one part:
     { dataset_version, build_id, generated_at, part, year, offset, txn_offset,
       txn_cols, paper_cols, rows: [ ["t", ...txn cols] | ["p", ...paper cols] ] }
   `rows` is the merged slice in feed order — the reader never re-merges.

   Wire format of the index (`feed/index.v1.json`, also inlined in /congress/):
     { dataset_version, build_id, generated_at, page_size, txn_total,
       paper_total, item_total, page_count, ceiling_bytes,
       parts: [ { part, year, offset, rows, txn_offset, txn_rows, first_seen,
                  last_seen, first_key, last_key, bytes } ] }
   `first_seen` / `last_seen` are the transaction-count-before-item values of
   the part's first and last rows — the number `pageSlice` pages on — so a page
   can be located without touching any row. */

import {
  DATASET_VERSION,
  PAGE_SIZE,
  TXN_COLS,
  PAPER_COLS,
  pageCountFor,
  txnToArray,
  paperToArray,
  txnFromArray,
  paperFromArray,
  type FeedItem,
} from "./format.ts";
import { paginateByBytes, SHARD_RESPONSE_CEILING_BYTES } from "./shards.ts";

export interface FeedPartMeta {
  /** "{year}-{n}", n from 1 within the year, in feed order */
  part: string;
  year: number;
  /** merged items before this part */
  offset: number;
  /** merged items in this part */
  rows: number;
  /** transactions before this part */
  txn_offset: number;
  /** transactions in this part */
  txn_rows: number;
  /** transactions before the part's first item (== txn_offset) */
  first_seen: number;
  /** transactions before the part's last item */
  last_seen: number;
  /** the first / last row's key (`txnId` or `paper:<doc>`) */
  first_key: string;
  last_key: string;
  /** measured bytes of the complete serialized part response */
  bytes: number;
}

export interface FeedPartsIndex {
  dataset_version: number;
  build_id: string;
  generated_at: string | null;
  page_size: number;
  txn_total: number;
  paper_total: number;
  item_total: number;
  page_count: number;
  ceiling_bytes: number;
  parts: FeedPartMeta[];
}

export interface FeedPartsPlan {
  index: FeedPartsIndex;
  /** part name → the exact serialized response body */
  bodies: Map<string, string>;
}

export interface FeedPartsEnvelope {
  build_id: string;
  generated_at: string | null;
}

export function feedItemKey(item: FeedItem): string {
  return item.kind === "txn" ? item.txnId : `paper:${item.doc}`;
}

/** One merged row on the wire: a kind tag followed by the columnar array. */
export function encodeFeedItem(item: FeedItem): unknown[] {
  return item.kind === "txn" ? ["t", ...txnToArray(item)] : ["p", ...paperToArray(item)];
}

export function decodeFeedItem(row: unknown): FeedItem | null {
  if (!Array.isArray(row) || row.length < 2) return null;
  const [tag, ...cols] = row;
  if (tag === "t" && cols.length === TXN_COLS.length) return txnFromArray(cols);
  if (tag === "p" && cols.length === PAPER_COLS.length) return paperFromArray(cols);
  return null;
}

export function feedPartHref(part: string): string {
  return `/congress/data/feed/${encodeURIComponent(part)}.v1.json`;
}
export const FEED_PARTS_INDEX_HREF = "/congress/data/feed/index.v1.json";

function envelopePrefix(env: FeedPartsEnvelope, part: string, year: number, offset: number, txnOffset: number): string {
  return (
    JSON.stringify({
      dataset_version: DATASET_VERSION,
      build_id: env.build_id,
      generated_at: env.generated_at,
      part,
      year,
      offset,
      txn_offset: txnOffset,
      txn_cols: TXN_COLS,
      paper_cols: PAPER_COLS,
      rows: [],
    }).slice(0, -2) // drop the closing `]}` of the empty rows array
  );
}
const ENVELOPE_SUFFIX = "]}";

/** Cut the merged feed into byte-bounded per-year parts. `merged` must be in
    feed order (filed desc). The ceiling is measured on the COMPLETE response. */
export function planFeedParts(
  merged: readonly FeedItem[],
  env: FeedPartsEnvelope,
  opts: { ceilingBytes?: number; pageSize?: number } = {},
): FeedPartsPlan {
  const ceilingBytes = opts.ceilingBytes ?? SHARD_RESPONSE_CEILING_BYTES;
  const pageSize = opts.pageSize ?? PAGE_SIZE;
  const parts: FeedPartMeta[] = [];
  const bodies = new Map<string, string>();
  // Worst-case envelope: the widest offsets this feed can print.
  const widest = envelopePrefix(env, "9999-999", 9999, merged.length, merged.length);
  const overheadBytes = Buffer.byteLength(widest) + Buffer.byteLength(ENVELOPE_SUFFIX);

  let offset = 0;
  let txnOffset = 0;
  let i = 0;
  while (i < merged.length) {
    const year = Number(merged[i]!.filed.slice(0, 4));
    let j = i;
    while (j < merged.length && Number(merged[j]!.filed.slice(0, 4)) === year) j++;
    const yearItems = merged.slice(i, j);
    const shardItems = yearItems.map((item) => ({
      key: feedItemKey(item),
      json: JSON.stringify(encodeFeedItem(item)),
    }));
    const plan = paginateByBytes(shardItems, { ceilingBytes, overheadBytes, itemNoun: "feed row" });
    let cursor = 0;
    plan.shards.forEach((shard, n) => {
      const part = `${year}-${n + 1}`;
      const slice = yearItems.slice(cursor, cursor + shard.entries.length);
      const txnRows = slice.filter((it) => it.kind === "txn").length;
      let seen = txnOffset;
      let lastSeen = txnOffset;
      for (const it of slice) {
        lastSeen = seen;
        if (it.kind === "txn") seen++;
      }
      const body =
        envelopePrefix(env, part, year, offset, txnOffset) +
        shard.entries.map((e) => e.json).join(",") +
        ENVELOPE_SUFFIX;
      const bytes = Buffer.byteLength(body);
      if (bytes > ceilingBytes) {
        throw new Error(`feed part ${part} serializes to ${bytes} bytes, over the ${ceilingBytes}-byte ceiling (LD7)`);
      }
      parts.push({
        part,
        year,
        offset,
        rows: slice.length,
        txn_offset: txnOffset,
        txn_rows: txnRows,
        first_seen: txnOffset,
        last_seen: lastSeen,
        first_key: feedItemKey(slice[0]!),
        last_key: feedItemKey(slice[slice.length - 1]!),
        bytes,
      });
      bodies.set(part, body);
      offset += slice.length;
      txnOffset += txnRows;
      cursor += shard.entries.length;
    });
    i = j;
  }
  const txnTotal = merged.filter((it) => it.kind === "txn").length;
  return {
    index: {
      dataset_version: DATASET_VERSION,
      build_id: env.build_id,
      generated_at: env.generated_at,
      page_size: pageSize,
      txn_total: txnTotal,
      paper_total: merged.length - txnTotal,
      item_total: merged.length,
      page_count: pageCountFor(merged, pageSize),
      ceiling_bytes: ceilingBytes,
      parts,
    },
    bodies,
  };
}

/** The parts that hold page `page` (0-based): those whose transaction-count
    range overlaps [page·size, (page+1)·size). A page may span two parts. */
export function partsForPage(index: Pick<FeedPartsIndex, "parts">, page: number, pageSize = PAGE_SIZE): FeedPartMeta[] {
  const lo = page * pageSize;
  const hi = lo + pageSize; // exclusive
  return index.parts.filter((p) => p.first_seen < hi && p.last_seen >= lo);
}

/** `pageSlice` over a CONTIGUOUS run of merged items that starts `txnOffset`
    transactions into the feed — the same paging rule, offset by where the
    fetched parts begin. */
export function pageSliceFrom(items: readonly FeedItem[], txnOffset: number, page: number, pageSize = PAGE_SIZE): FeedItem[] {
  const out: FeedItem[] = [];
  let seen = txnOffset;
  for (const item of items) {
    const p = Math.floor(seen / pageSize);
    if (p > page) break;
    if (p === page) out.push(item);
    if (item.kind === "txn") seen++;
  }
  return out;
}

/** Rule 2a (pagination-and-counts.md): the page count of the merged feed at
    `pageSize`, from part metadata alone. Pages are monotone along the feed,
    so the last page is the page of the LAST item — whose preceding-transaction
    count the index already records as the last part's `last_seen`. A
    position, never a formula over counts (rule 2): a trailing paper row after
    a multiple of `pageSize` transactions keeps its own page. */
export function feedPageCount(index: Pick<FeedPartsIndex, "parts">, pageSize: number): number {
  const last = index.parts[index.parts.length - 1];
  if (!last || last.rows === 0) return 0;
  return Math.floor(last.last_seen / pageSize) + 1;
}

/* ---------- launch M3a: the "With ticker" view (rule 2b, invariant I7) ---------- */

/** A row the default "With ticker" view shows: a transaction whose ticker is
    set — the same test the ticker ranking applies (`!t.ticker` is a row with
    no ticker there). A paper filing has no ticker, so it is never shown. */
export function feedItemHasTicker(item: FeedItem): boolean {
  return item.kind === "txn" && Boolean(item.ticker);
}

/** One part's place in the ticker view: the ticker rows before it and in it. */
export interface TickerPartOffset {
  part: string;
  ticker_before: number;
  ticker_rows: number;
}

/** The build-time `#feed-ticker-offsets` island (rule 2b). Not a published
    file: it rides inline on /congress/ beside `#feed-parts-index`, derived
    from the SAME `planFeedParts` output, so its part names are the index's
    in order. The three totals are the whole-set figures I7 states. */
export interface FeedTickerOffsets {
  dataset_version: number;
  build_id: string;
  /** transactions whose ticker is set — the default view's total */
  ticker_total: number;
  /** transactions without a ticker — hidden by the default view, in All rows */
  no_ticker_total: number;
  /** paper filings — hidden by the default view, in All rows */
  paper_total: number;
  parts: TickerPartOffset[];
}

/** Build the ticker offsets from the merged feed and ITS part plan. Throws if
    the plan does not cover the feed row for row — a map that disagreed with
    the parts would page the wrong rows. */
export function planTickerOffsets(merged: readonly FeedItem[], index: FeedPartsIndex): FeedTickerOffsets {
  const parts: TickerPartOffset[] = [];
  let before = 0;
  for (const p of index.parts) {
    const slice = merged.slice(p.offset, p.offset + p.rows);
    if (slice.length !== p.rows || feedItemKey(slice[0]!) !== p.first_key || feedItemKey(slice[slice.length - 1]!) !== p.last_key) {
      throw new Error(`ticker offsets: part ${p.part} does not match the merged feed`);
    }
    const rows = slice.filter(feedItemHasTicker).length;
    parts.push({ part: p.part, ticker_before: before, ticker_rows: rows });
    before += rows;
  }
  const txnTotal = merged.filter((it) => it.kind === "txn").length;
  return {
    dataset_version: index.dataset_version,
    build_id: index.build_id,
    ticker_total: before,
    no_ticker_total: txnTotal - before,
    paper_total: merged.length - txnTotal,
    parts,
  };
}

/** The offsets island, accepted only when it belongs to THIS index: same
    dataset version and build, and the same part names in the same order.
    Anything else is refused (null) and the view uses the full corpus. */
export function classifyTickerOffsets(body: unknown, index: Pick<FeedPartsIndex, "dataset_version" | "build_id" | "parts">): FeedTickerOffsets | null {
  if (typeof body !== "object" || body === null) return null;
  const b = body as Record<string, unknown>;
  if (b.dataset_version !== index.dataset_version || b.build_id !== index.build_id || !Array.isArray(b.parts)) return null;
  const parts = b.parts as TickerPartOffset[];
  if (parts.length !== index.parts.length) return null;
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    if (!p || p.part !== index.parts[i]!.part || !Number.isInteger(p.ticker_before) || !Number.isInteger(p.ticker_rows)) return null;
  }
  for (const k of ["ticker_total", "no_ticker_total", "paper_total"] as const) {
    if (!Number.isInteger(b[k])) return null;
  }
  return b as unknown as FeedTickerOffsets;
}

/** The ticker view's page count: the page of the last ticker row, plus one. */
export function tickerPageCount(offsets: Pick<FeedTickerOffsets, "ticker_total">, pageSize: number): number {
  return offsets.ticker_total === 0 ? 0 : Math.floor((offsets.ticker_total - 1) / pageSize) + 1;
}

/** The parts holding ticker page `page`: those whose ticker range
    `[before, before + rows)` overlaps `[page·size, (page+1)·size)`. */
export function tickerPartsForPage(offsets: Pick<FeedTickerOffsets, "parts">, page: number, pageSize: number): TickerPartOffset[] {
  const lo = page * pageSize;
  const hi = lo + pageSize;
  return offsets.parts.filter((p) => p.ticker_rows > 0 && p.ticker_before < hi && p.ticker_before + p.ticker_rows > lo);
}

/** Ticker page `page` from a CONTIGUOUS run of fetched items that starts
    `tickerBefore` ticker rows into the view — the ticker rows in feed order,
    paged by their position. */
export function tickerPageSliceFrom(items: readonly FeedItem[], tickerBefore: number, page: number, pageSize: number): FeedItem[] {
  const out: FeedItem[] = [];
  let k = tickerBefore;
  for (const item of items) {
    if (!feedItemHasTicker(item)) continue;
    const p = Math.floor(k / pageSize);
    if (p > page) break;
    if (p === page) out.push(item);
    k++;
  }
  return out;
}

/** Decode one part response; null when it is not a part of THIS dataset version. */
export function decodeFeedPart(body: unknown): { part: string; offset: number; txn_offset: number; items: FeedItem[] } | null {
  if (typeof body !== "object" || body === null) return null;
  const b = body as Record<string, unknown>;
  if (b.dataset_version !== DATASET_VERSION || !Array.isArray(b.rows)) return null;
  const items: FeedItem[] = [];
  for (const row of b.rows) {
    const it = decodeFeedItem(row);
    if (it === null) return null;
    items.push(it);
  }
  return { part: String(b.part), offset: Number(b.offset), txn_offset: Number(b.txn_offset), items };
}

export function classifyFeedPartsIndex(body: unknown): FeedPartsIndex | null {
  if (typeof body !== "object" || body === null) return null;
  const b = body as Record<string, unknown>;
  if (b.dataset_version !== DATASET_VERSION || !Array.isArray(b.parts)) return null;
  return b as unknown as FeedPartsIndex;
}
