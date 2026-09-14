/* R19: the full congress corpus, assembled from the byte-bounded parts.

   `/congress/data/feed.v1.json` — one 22 MB asset, 85% of Cloudflare Pages'
   hard 25 MiB per-asset limit — is RETIRED. The limit is identical on free and
   paid plans, so growing into it was a deploy failure with no plan-upgrade
   escape: at the measured 9,287 disclosures a year and ~310 bytes each, the
   remaining margin was roughly sixteen months.

   Nothing is lost. The per-year parts published under `/congress/data/feed/`
   already carry EVERY row the monolith carried, contiguously and in the same
   feed order (filed desc, transactions before paper within a date), each part
   under `SHARD_RESPONSE_CEILING_BYTES`. The whole corpus is therefore exactly
   the concatenation of the parts the index names — the same rows, in the same
   order, in bounded pieces. What changes is the transport, not the data.

   Two invariants are CHECKED here rather than assumed, because a silently
   short corpus would render as a quietly incomplete filter result — the exact
   failure mode this codebase refuses to ship:

     * the parts reassemble contiguously (`offset` chains with no gap), and
     * the reassembled row count equals the index's declared `item_total`.

   A violation throws, so the caller's existing load-failure path states it on
   the page instead of painting a partial corpus as a complete one.

   This module exports FUNCTIONS and holds no module-level cache, deliberately.
   R17 ("one fetch, one decode owner per page") is preserved by there being
   exactly one caller per page; a cached singleton here would be precisely the
   second owner of the same bytes that R17 exists to forbid. */

import {
  classifyFeedPartsIndex,
  decodeFeedPart,
  feedPartHref,
  FEED_PARTS_INDEX_HREF,
  type FeedPartsIndex,
} from "../lib/feed-parts.ts";
import type { PaperRow, TxnRow } from "../lib/format.ts";

/** The corpus split the way every consumer already wants it: the transaction
    rows in feed order, and the paper filings in feed order. */
export interface FeedCorpus {
  txns: TxnRow[];
  paper: PaperRow[];
}

/** Fetch the part index. `/congress/` inlines it in the page (a few kilobytes)
    and passes it straight to `loadFeedCorpus`; other pages fetch it. */
export async function fetchFeedPartsIndex(): Promise<FeedPartsIndex> {
  const res = await fetch(FEED_PARTS_INDEX_HREF);
  if (!res.ok) throw new Error(`feed part index fetch failed: ${res.status}`);
  const index = classifyFeedPartsIndex(await res.json());
  // A cached index from an older dataset version is REFUSED, never read with
  // this build's column offsets — the same rule `classifyDataset` held for the
  // monolith, kept at the same strength.
  if (index === null) throw new Error("feed part index rejected: not this dataset version");
  return index;
}

/** Download and decode every part, and reassemble the corpus. */
export async function loadFeedCorpus(index: FeedPartsIndex): Promise<FeedCorpus> {
  const decoded = await Promise.all(
    index.parts.map(async (meta) => {
      const res = await fetch(feedPartHref(meta.part));
      if (!res.ok) throw new Error(`feed part fetch failed: ${res.status} (${meta.part})`);
      const part = decodeFeedPart(await res.json());
      if (part === null) throw new Error(`feed part rejected: ${meta.part}`);
      return part;
    }),
  );

  // `offset` is the authority on order, never the order `Promise.all` resolved
  // in and never the index's array order: sorting by the value the part itself
  // declares is what makes the contiguity check below meaningful.
  decoded.sort((a, b) => a.offset - b.offset);

  const txns: TxnRow[] = [];
  const paper: PaperRow[] = [];
  let expected = 0;
  for (const part of decoded) {
    if (part.offset !== expected) {
      throw new Error(
        `feed parts are not contiguous: ${part.part} starts at ${part.offset}, expected ${expected}`,
      );
    }
    expected += part.items.length;
    for (const item of part.items) {
      if (item.kind === "txn") txns.push(item);
      else paper.push(item);
    }
  }
  if (expected !== index.item_total) {
    throw new Error(
      `feed parts carry ${expected} rows, the index declares ${index.item_total}`,
    );
  }
  return { txns, paper };
}

/** The one-call form for a page that has no inlined index. */
export async function fetchFeedCorpus(): Promise<FeedCorpus> {
  return loadFeedCorpus(await fetchFeedPartsIndex());
}
