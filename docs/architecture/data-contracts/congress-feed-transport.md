# The congress feed transport: retiring the single-asset dataset — specification

**Status:** normative for `/congress/data/feed.v1.json` (now a tombstone),
`/congress/data/feed/{part}.v1.json`, `/congress/data/feed/index.v1.json`,
`/congress/data/` (the human-readable route), and every consumer of the full
congress corpus — `dashboard/src/scripts/feed-corpus.ts`,
`dashboard/src/scripts/feed-client.ts`, `dashboard/src/scripts/watchlist-client.ts`.

**Owner decision (2026-08-18), recorded as roadmap B27:** *shard by year, client
fetches all shards*, with three silent-failure requirements. This document states
the resulting contract; the code implements this document.

## Why the single asset had to go

`congress/data/feed.v1.json` served the whole corpus as one file.

| Measurement | Value |
|---|---|
| Live size, 2026-09-13 | 22,382,648 B |
| Cloudflare Pages per-asset limit | 26,214,400 B (25 MiB) |
| Fraction of the limit | 85.4% |
| Congress disclosures, trailing twelve months | 9,287 |
| Marginal cost per disclosure in this file | ~310 B |
| Remaining margin | ~12,300 disclosures ≈ **16 months** |

The limit is **identical on the free and paid Cloudflare Pages plans** — only the
per-project *file count* limit differs by plan (20,000 free / 100,000 paid).
There was therefore no plan upgrade out of this, and Cloudflare's own guidance
for assets above the limit is to serve them from R2 rather than Pages.

The failure mode is what forced the schedule: Cloudflare rejects an oversized
asset at **upload**, so the first build to cross 25 MiB fails the whole deploy —
not the congress page, the entire site's next release — with no prior warning
beyond the `R19 GATE (margin)` expectation this repo already carried as a
standing entry in `docs/maintenance/POST-BUILD-BASELINE.md`.

## The contract

### What is published

- **`/congress/data/feed/{year}-{n}.v1.json`** — the corpus cut into per-year
  parts, each part closing as soon as the next row would push its **complete
  serialized response** over `SHARD_RESPONSE_CEILING_BYTES` (1 MiB). A year
  yields as many parts as it needs. `planFeedParts` throws at build time if a
  part exceeds the ceiling, so an oversized asset cannot be published.
- **`/congress/data/feed/index.v1.json`** — every part with its row counts,
  transaction offsets, first/last row key and measured byte size, plus
  `item_total`, `txn_total`, `paper_total` and `page_count`. Also inlined in
  `/congress/` as `<script type="application/json" id="feed-parts-index">`, so
  paging the unfiltered feed costs no extra round trip.
- **`/congress/data/`** — a server-rendered, script-free page listing every part
  with a direct link, its row count and its size. This is the honesty route: the
  destination for the `<noscript>` line on `/congress/`, for the ranking
  sections' "published dataset" link, and for the feed island's load-failure
  state.

### What `feed.v1.json` now serves

A **tombstone**, not a 404. Published artifacts are the API, so the path stays
and states its own retirement:

```json
{"dataset_version":0,"kind":"congress-feed-retired","reason":"…",
 "parts_index":"/congress/data/feed/index.v1.json","human_readable":"/congress/data/"}
```

`dataset_version: 0` can never be a real dataset version, so a **cached client**
running the previous island calls `classifyDataset`, gets `version_mismatch`, and
renders its existing "couldn't load the full dataset" state over the
still-correct server-rendered first page. That is **fail-closed**: a stale client
shows a stated failure, never a partial corpus painted as a whole one. This is
the precedent set by `institutional/data/filers/index.v1|v2|v3.json`.

### Reassembly is exact, and checked

The parts are contiguous and already in the site's feed order (filed descending,
transactions before paper within a date). Concatenating the parts in `offset`
order reproduces **exactly** the rows the monolith served, in exactly its order.

`loadFeedCorpus` (`dashboard/src/scripts/feed-corpus.ts`) enforces the owner's
three requirements:

1. **Order is preserved exactly** — parts are sorted by the `offset` each part
   *declares about itself*, never by `Promise.all` resolution order and never by
   the index's array order.
2. **A partial part set FAILS VISIBLY** — the `offset` chain must be gap-free and
   the reassembled row count must equal the index's `item_total`. Either
   violation throws, and the caller's existing failure path states it on the
   page. A short corpus is never rendered as a complete one.
3. **A stale index is refused** — `classifyFeedPartsIndex` rejects any index
   whose `dataset_version` is not this build's, exactly as `classifyDataset`
   refused a stale monolith body.

### Who loads the corpus

`feed-corpus.ts` exports **functions and holds no module-level cache**,
deliberately. R17 ("one fetch, one decode owner per page") is preserved by there
being exactly one caller per page — `feed-client.ts` on `/congress/`,
`watchlist-client.ts` on `/watchlist/`, never both on one page. A cached
singleton in this module would be precisely the second owner of the same bytes
that R17 exists to forbid.

Paging the *unfiltered* feed still costs only the part or parts holding the page
(`partsForPage`); the full corpus is loaded only when a filter, a sort or a
ranking-window change actually needs every row — unchanged from before.

## What this does and does not buy

It removes the per-asset ceiling as a congress-feed concern **permanently and by
construction**: no congress feed asset can exceed 1 MiB, because the planner
throws rather than emit one. Corpus growth now costs *more parts*, not a bigger
file.

It therefore moves the binding constraint to the **per-project file count**. The
2026-09-13 production deployment record reports 17,749 files against this
project's own 18,000 self-cap (provider limit 20,000 on the free plan). Each
additional year of congress filings adds roughly one to three parts, which is
immaterial against that budget — but the file count, not the asset size, is now
the number to watch, and `R19 GATE: the built tree fits under the 18,000-file
self-cap` is the gate that watches it.

## Not done here: R2

Cloudflare's recommendation for genuinely oversized assets is an R2 bucket on a
custom domain. That remains available and is **an owner decision**: it requires
provisioning a bucket, a custom domain and credentials, and it moves part of the
published API off Pages, where the deploy verifier's inventory sweep currently
proves every published path. Nothing in this change provisions or presumes it.
A single-file full-corpus download is a convenience this page's part list already
substitutes for; if the owner later wants one, R2 is where it should live, not
Pages.
