# Feed pagination and counts — specification

**Status:** normative for `src/lib/format.ts` and its callers.
**Why this exists:** three consecutive review rounds found defects in this one
mechanism, and all three were the same error in different functions.

| Round | Defect | Function |
|---|---|---|
| 1 | a paper filing no transaction preceded appeared on **no page**; the empty state was suppressed because it keyed on filter results rather than on what rendered | `pageSlice`, and the client's empty-state guard |
| 2 | `pageCount(txnCount, paperCount)` was one page short when the transaction count was an exact multiple of `PAGE_SIZE` and a paper row trailed — again unreachable, while the count line asserted the filing existed | `pageCount` |
| 3 | a page holding only trailing paper rows rendered `51–50 of 50 transactions` | `feedCountText` |

**The diagnostic signature, stated so it is recognisable next time:** each defect
was a function reasoning about *where items sit on a page* from parameters that
only described *how many items exist in total*. Two of the three were found only
by exhaustive sweeps; hand-picked fixtures passed all of them. `PAGE_SIZE`
multiples are the recurring blind spot, because that is where "page of the last
transaction" and "page after the last transaction" diverge.

## Domain

A **feed** is a reverse-chronological merge of two populations that are not
interchangeable:

- **transactions** — rows from `v_default_transactions`. They carry dates, a
  side, an owner, a statutory amount range and a lag.
- **paper filings** — active filings with `parse_status = 'needs_ocr'`. They
  carry a filer, a filed date and a source document, and **nothing else**: no
  amount, no side, no owner, no trade date. ARCHITECTURE §5.2 requires them to
  be *retained and counted*, so they are records to be shown, not omissions.

Paper filings are therefore never counted inside a transaction total, and never
filtered on a dimension they do not possess.

## Invariants

These hold for every filter state, every viewport and every build. Each is
tested; the test name is given.

**I1 — Every item is reachable on exactly one page.**
For a merged feed `M`, the pages `0 … pageCountFor(M) - 1` partition `M`. No
item may be on two pages; no item may be on none. Violating this makes the site
assert, in a count, the existence of a record it will not show — the failure
that opened rounds 1 and 2.
*Test: "every item appears on exactly one page — every paper position × several counts"*

**I2 — No page inside the reachable range is empty.**
An empty page would be rendered by the client as "no disclosures match", which
is a false statement about the filter, not about the page. This is why page
count may never be padded to a round number.
*Test: "pageCountFor: derived from position, and never pads a blank page"*

**I3 — Pages concatenate to the merged feed, in order.**
`concat(pageSlice(M, 0) … pageSlice(M, n-1)) === M`. Reverse-chronological order
is a promise the page header makes; it must survive pagination.
*Test: "pageSlice: pages concatenate to the merged feed in order"*

**I4 — A transaction page holds at most `PAGE_SIZE` transactions.**
Paper rows ride along and do not consume the transaction budget.
*Test: "pageSlice: transaction pages hold exactly PAGE_SIZE transactions"*

**I5 — Every count fragment is derivable from the contents of the page it
describes, never from totals alone.**
This is the invariant all three defects violated, and the reason a
counts-only signature is prohibited below. A fragment that describes *this
page* (`1–50`, `(2 here)`) must be computed from the page's items. A fragment
that describes the *whole result set* (`of 3,911`, `73 amount not comparable`)
must be labelled as such in the text.
*Test: "feedCountText: no page ever renders an inverted transaction range"*

**I6 — One assembled count string reaches every sink.**
`feedCountText` returns one string. `#filter-count-line`, `#pager-range` and the
`#feed-status` live region all receive that exact string, and the SSR page uses
the same function. A per-sink assembly previously dropped the
indeterminate-amount disclosure at ≤720px — the honesty layer must not vary by
viewport or by sink.
*Test: "feedCountText: the indeterminate-amount disclosure is part of the ONE string"*

**I7 — A view that hides a population says so, in the one count string.**
A feed VIEW is a standing selection the reader did not type: the /congress/
default "With ticker" view shows only transactions whose ticker is set, so it
hides every transaction without a ticker and every paper filing (a paper
filing has no ticker). Each hidden population's size is stated in the ONE
string of I6 — so it reaches all three sinks and the server's page alike —
computed over the WHOLE result set under the reader's other filters (never
from the page), and labelled as a whole-set figure that names where the rows
are: "1–20 of 59,842 transactions with a ticker · 12,565 without a ticker and
3,061 paper filings are in All rows". A population that is zero under the
current filters is not stated; a filter that would hide paper filings in All
rows too (rule 5's dimensions) hides them from the statement as well, because
All rows would not show them either. A view switch is never a silent filter:
the count line keeps " · filtered on this device" and its reset control in
every view, and reset returns to the default view.
*Test: "I7: the default view states its hidden counts in every sink" (launch-congress.test.ts) and "feedCountText I7: hidden populations are whole-set figures"*

## Rules that follow

1. **Page membership.** An item's page is `floor(t / PAGE_SIZE)`, where `t` is
   the number of transactions **preceding** it in the merged feed. For a
   transaction this is its own zero-based index; for a paper filing it is the
   count of transactions above it. A paper filing trailing every transaction
   therefore has its own page when the transaction count is a multiple of
   `PAGE_SIZE` — that page is real and must be reachable (I1, I2).

   **1a. The design feed pages 20 rows; the published transport stays at 50
   (launch M3a, LD20).** `DESIGN_FEED_PAGE_SIZE` is 20 in both /congress/
   views — the server's first page, the client's pages and every count. The
   published part index (`/congress/data/feed/index.v1.json`, also inlined as
   `#feed-parts-index`) keeps `page_size: 50` and its `page_count` at 50
   byte-for-byte: published artifacts are the API, so no field is added or
   changed. A 20-row page is derived from the parts' own metadata by rule 2a,
   never from the index's 50-row `page_count`.

2. **Page count is a walk, not a formula.** `pageCountFor(merged)` walks the
   feed. **A signature taking only counts is prohibited**: with 100
   transactions, a paper row before them needs 2 pages and one after them needs
   3, and no function of `(100, 1)` can return both. This rule exists because
   `pageCount(txnCount, paperCount)` shipped and was wrong.

   **2a. Page count from part metadata is a position, not a formula over
   counts.** Pages are monotone along the feed, so the last page is the page
   of the LAST item, and the walk of rule 2 reduces to one position: the part
   index records `last_seen` — the transactions preceding each part's last
   item — so `feedPageCount(index, size)` is `floor(lastPart.last_seen / size)
   + 1` (0 for an empty feed). The parts holding page N are those whose
   `[first_seen, last_seen]` overlaps `[N·size, (N+1)·size)` (`partsForPage`,
   unchanged), and `pageSliceFrom` applies rule 1 offset by the first part's
   `txn_offset`. With a trailing paper row after a multiple of `size`
   transactions, `last_seen` equals that multiple and the paper row's page is
   counted — the round-2 defect cannot recur through this path.

   **2b. The "With ticker" view pages by ticker position, located by a
   build-time offsets island.** The ticker view holds transactions only, in
   feed order, so a row's page is `floor(k / size)` where `k` is the number of
   ticker rows preceding it, and its page count is the page of the last ticker
   row plus one. /congress/ inlines `#feed-ticker-offsets` (not a published
   file): for each part of the SAME `planFeedParts` output, in index order, the
   ticker rows before the part and in it, plus the view's whole-set totals
   (ticker rows, transactions without a ticker, paper filings) that I7 states.
   The client finds the part or parts holding ticker page N — those whose
   ticker range `[before, before + rows)` overlaps `[N·size, (N+1)·size)` —
   fetches ONLY those, keeps their ticker rows in order and slices from the
   first part's `before`. An offsets island whose part names do not match the
   index in order is refused, and the view falls back to the full corpus
   rather than paging against a stale map. Quick filters, the text filter and
   every More filter keep the full-corpus path (declared debt TD-L1).

3. **Count inputs must carry page-local facts.** `CountInputs` carries
   `txnOnPage` and `paperOnPage` alongside the totals. Any new fragment about
   the current page requires a new page-local field — do not infer page
   contents from `page × PAGE_SIZE` arithmetic (I5).

4. **Emptiness is decided by what rendered.** The empty state triggers on
   `items.length === 0`, never on a filter-result count. A paper-only result set
   renders rows and must not show an empty state.

5. **Indeterminacy is stated, never resolved.** `amountVerdict` returns
   `in | out | indeterminate`. Open-ended caps ("Over $1,000,000"), unparsed
   amounts, and unknown-floor rows are `indeterminate` against any positive
   threshold: they can be neither ruled in nor out. Indeterminate rows are
   excluded from the matched set, counted separately, and disclosed in the count
   string and the empty-state copy. A threshold filter may never report a
   confident zero while indeterminate rows exist.

6. **One count grammar (DESIGN-POLISH R8, under I5).** Every range count on
   the site is built by ONE primitive, `rangeOfTotal(first, last, total, noun,
   { definite })` in `format.ts`, on the server and the client alike: "1–10 of
   608 tickers", "1–50 of 72,083 transactions". The total is the size of the
   collection the rows come from. Where it is only a bound the page applies (a
   page of a paged list, a size-capped embed, a render limit), the count says
   so with `definite: true` and a noun that names the bound — "1–20 of the 100
   changes on this page", "1–10 of the 50 newest changes by notable managers
   shown here" — so it can never read as the collection's size. Ratios and
   unwindowed counts ("N of M managers" matching a filter) are not ranges and
   keep their words.

7. **Compact tables have one named binder (DESIGN-POLISH R36).** A table whose
   full body is in the DOM may show its first N rows (`tbody[data-collapsed]
   tr[data-compact-extra]`) with the count and a Show-all beside it, and ONLY
   through the one binder, `initDomDisclosures` (`scripts/inst-index-client.ts`),
   called by every page that renders such a table. The binder reads the count's
   total, shown, noun and `definite` off the element on EVERY sync — never once
   at bind time — and re-syncs on `populus:rerender`, which every client
   re-render dispatches (page, sort, range and period changes), so after load
   and after every action the client prints exactly the server's count and the
   toggle reveals exactly the held rows. Every compact table's N is a fixed
   default (member flows 20, filing history 12, a filer's reported positions
   20, the signal hits 12 of their 50-hit page, the Consensus board 10), never
   tuned to its band partner or to one data build, and never estimated from a
   cell's height (DESIGN-POLISH M2, coordinator decisions CD-1 and CD-5). No row
   may be unreachable: a table with no binder is never compacted.

8. **Held rows live in JSON, never in the DOM (launch redesign LD26, R27).**
   A table may go further than rule 7 and keep rows N+1.. out of the DOM
   entirely. It then shows its first N rows, and the held rows reach the client
   ONLY as JSON: an inline island (`<script type="application/json"
   data-held-for="<tbody id>" data-held-render="<renderer name>">`, never
   executable, serialized through `serializeInlineJson`) or a published
   same-origin file the page already has. The binder is still the ONE binder of
   rule 7 — `initDomDisclosures`, extended, never a second mechanism — and its
   disclosure keeps rule 7's count grammar and step: "1–N of M nouns" from
   `rangeOfTotal`, one press reveals every held row. Five things follow.
   - **One row function, registered by name.** The server renders the first N
     rows through a row function; the client renders the held rows through the
     SAME function, registered with the binder under the island's
     `data-held-render` name (`registerHeldRows`). A client that recomputes a
     row from some other payload is prohibited, because it drifts.
   - **The island carries every input the row function reads.** Rows, and any
     table-wide input (a bar scale, a column set), and every per-row input the
     server derived from its neighbours or from build context (an
     overlaps-the-row-above flag, a budget-cut flag that changes a link). The
     test of the rule is byte parity: for the same inputs, the binder's output
     equals the server's row-function output, row for row.
   - **No-JS reachability is preserved, never invented.** Where a reader
     without JavaScript can reach the held rows today, a `<noscript>` element
     AFTER the table holds a SECOND table of exactly those rows, rendered by the
     same row function. A `<noscript>` never sits inside a `tbody` (the parser
     hoists it out). With scripting on its content is inert text, so it costs
     no DOM. Where a no-JS reader cannot see the rows today (a `hidden`
     variant, a table whose Show-all needs a script), only the island ships.
   - **The client never turns DOM text back into HTML.** It reads the island
     with `JSON.parse` and writes rows only from the registered function's
     output; it never reads a `<noscript>`'s text, and never moves
     `textContent` into `innerHTML`.
   - **Sort, filter and print cover every row.** A sort or filter over a held
     table runs over all M rows of the island and shows the first N of the
     result, and `beforeprint` renders and reveals every held row (restored on
     `afterprint`).
   - **One island, one render path, several views (launch integration).** Every
     held list on the site ships its rows in the ONE island
     (`heldIslandHtml`, `lib/held-rows.ts`; body `{ v: 1, offset, shared,
     rows }`: `offset` is the index of the island's first row in the whole
     list, `shared` every list-wide input), and every held row reaches the DOM
     through the binder's ONE render path, `heldRowsHtml`: the registered
     function, then the explicit table roles of the table it lands in
     (`rolesFor`), so a drawn row equals the served page's row. What differs is
     only when rows are drawn: a compact table's disclosure reveals every held
     row in one press (rule 7's step); a stepped list (the holders' "Show all
     N holders") and a pager (the Signals hits, Named moves, Congress-lines
     bank and Overlap names) draw in their own step through the same path and
     state their counts in rule 6's grammar. A deep link or an in-page link to
     an element only a held row carries opens what holds it
     (`revealHeldTarget`) and lands on the row.

## Changing this mechanism

Add or amend an invariant here **before** editing the code, and add its test in
the same change. If a defect is found in this mechanism again, the first
question is which invariant was missing — not which line was wrong.
