# M1-C — wrapped sub-lines are sub-line text, not transaction rows

**Status:** proposed (external review pending)
**Date:** 2026-08-01
**Reverses:** the "post-comment text is never absorbed" negative control introduced in
`2195982` (RUN M1 #2, House PTR pipeline), cited there as R7/F4.

## The measurement that forced this

The 13-year historical backfill (RUN M1-B Phase B, corpus `ops/final/corpus.db`)
put 9 of 14 House eras below the §9.6 97% e-file row gate — 2023 at 85.9%, six
more between 93% and 97%. The defect flags across the 2016–2023 miss band:

| flag | rows |
|---|---|
| `side_unparsed` | 1,761 |
| `row_orphan` | 1,761 |
| `row_incomplete` | 1,761 |
| `date_missing` | 1,761 |
| `amount_unparsed` | 1,416 |

Four flags at *exactly* 1,761 is one mechanism, not five. Reading the source
PDFs (`2016/20005456`, `2016/20005013`, `2016/20005685`) identifies it:

```
p1 top=598.06  SUBLINE  'DESCRIPTION: WELLS FARGO & COMPANY JR SUBORDNTD SER K GLB …'
p1 top=610.81  frag     'YIEL'                    ← opened a flagged orphan row
```

A long `DESCRIPTION:`/`COMMENTS:` sub-line **wraps like any other printed
line**. Its tail arrives after `feed_subline` has closed the row block, so the
asset-continuation branch cannot take it, and it fell through to
`_open_orphan()`. Every such tail became a transaction row carrying no side, no
date, and no amount — flagged, but counted in the denominator.

These are not malformed disclosures. `YIEL` is the last three characters of
"…CALLABLE-MAY AFFECT YIELD", printed on its own line. The parser was
manufacturing 1,761 transaction records the documents never disclosed, and
those phantoms are what pushed nine eras under the gate.

## Decision

A fragment line is appended to the **comment** it continues — not routed as a
row — when all three hold:

1. a **comment** sub-line is open (any structural line clears this: a row is
   never a sub-line's tail);
2. the wrap geometry allows it (the existing `_wrap_within_pitch` predicate,
   which already gates asset wrapping);
3. **no cell matches its own column's signature** (`_has_typed_cell`).

Condition 3 reuses the existing R25 recognizer table rather than inventing a
second notion of "row-shaped", so the two decisions cannot drift. Column
*position* alone is not sufficient and was rejected on measurement: wrapped
prose spans the full printed width, so its words land in the side/date/amount
buckets while matching none of those shapes. `_has_typed_cell` also counts
`amount` and `capgains`, which `_is_structural_cells` deliberately omits —
an amount may not *open* a row (R24), but a line bearing one is still
transaction-shaped and must never be folded into a comment.

**Comment sub-lines only.** `FILING STATUS:`/`SUBHOLDING OF:`/`LOCATION:`
values are not captured anywhere in the record, so folding *their* tails in
would delete text outright — the silent loss F4 exists to prevent. Those tails
keep opening flagged orphans. Measured cost of this restriction: 32 of the 673
continuations in the sample below, i.e. it forgoes ~5% of the available
repair to avoid dropping a single printed character.

`PARSER_VERSION` 1.0.0 → **1.1.0**, so `populus reparse` re-derives affected
filings from the raw archive rather than silently forking behaviour (R8).

## What the rule actually absorbs, measured

Instrumented across a 400-PDF random sample of the 2016–2023 miss band (305
parsed; the remainder are paper filings that route to `needs_ocr`): **673
continuations, 641 of them comment tails.** A random draw of what they contain:

```
[comment] 'the S & P 500. I learned of the purchase of stock on Oct. 21, and immediately on the next busin'
[comment] 'unaware of our policy against owning individual stocks. On Sept. 26, the new investment firm pu'
[comment] 'the stocks be divested. The new investment firm sold the stock and instead invested in Exchange'
[comment] 'SPAC transaction, a public acquisition company purchased all equity of Cano Health entities. Th'
```

Not one is a transaction row. Every one is a filer's explanatory sentence
wrapping onto the next printed line, and each was previously emitted as its own
flagged "transaction".

## Why this does not reintroduce the failure R7/F4 guarded

The original control existed so that **a genuine malformed row printed after a
comment stays visible instead of disappearing into it**. Condition 3 preserves
exactly that: any fragment bearing a transaction-shaped cell still surfaces.

Pinned by two tests, both of which fail if the predicate is weakened:

- `test_a_row_shaped_fragment_after_a_comment_still_opens_a_flagged_orphan` —
  an **amount**-bearing fragment after a `DESCRIPTION:`. This is the sharpest
  case available: R24 forbids an amount from opening a row structurally, so
  nothing but `_has_typed_cell` keeps it out of the comment. It lands in a
  flagged orphan.
- `test_a_structural_line_closes_the_subline_wrap_window` — once a structural
  line opens a row, following prose is that row's asset continuation; a
  comment cannot reach backwards past it.

A date-bearing fragment is better off still: `date` is a structural validator,
so it opens a visible (incomplete) row rather than an orphan.

Text is never dropped. A comment tail is rejoined in printed left-to-right
order and appended to the comment — the cells are an artefact of where words
fell relative to the column anchors, not of what the filer wrote.

## Residual risk, stated rather than absorbed

A row that printed an asset name and **nothing else** — no side, no date, no
amount, no owner, no ID — and that follows a *comment* sub-line within the wrap
pitch is now folded into that comment instead of surfacing as a flagged orphan.

Accepted, because such a fragment carries no transaction fact in any column: it
was never a publishable disclosure record under either behaviour, only a
denominator entry. The change moves it from "counted as a defective row" to
"kept as the comment text it was printed as". Fidelity to the printed document
is the tiebreaker (§5.1): the source shows one wrapped comment, and one wrapped
comment is what the record should hold.

## Blast radius

Congressional House parse only. No schema change, no migration. Rollback is
`git revert` + `populus reparse` at the prior `PARSER_VERSION`, which restores
the previous rows byte-for-byte from the raw archive.
