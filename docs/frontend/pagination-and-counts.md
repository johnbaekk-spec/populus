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

## Rules that follow

1. **Page membership.** An item's page is `floor(t / PAGE_SIZE)`, where `t` is
   the number of transactions **preceding** it in the merged feed. For a
   transaction this is its own zero-based index; for a paper filing it is the
   count of transactions above it. A paper filing trailing every transaction
   therefore has its own page when the transaction count is a multiple of
   `PAGE_SIZE` — that page is real and must be reachable (I1, I2).

2. **Page count is a walk, not a formula.** `pageCountFor(merged)` walks the
   feed. **A signature taking only counts is prohibited**: with 100
   transactions, a paper row before them needs 2 pages and one after them needs
   3, and no function of `(100, 1)` can return both. This rule exists because
   `pageCount(txnCount, paperCount)` shipped and was wrong.

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

## Changing this mechanism

Add or amend an invariant here **before** editing the code, and add its test in
the same change. If a defect is found in this mechanism again, the first
question is which invariant was missing — not which line was wrong.
