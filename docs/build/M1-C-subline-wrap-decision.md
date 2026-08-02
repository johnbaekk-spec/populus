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

## Measured outcome

Reparsed all 8,298 House filings from the raw archive (`parsed 2169 | partial
69 | needs_ocr 2437 | failed 0`), re-joined members, re-measured:

| | before | after |
|---|---|---|
| orphan rows (corpus) | 2,510 | **632** |
| `v_default_transactions` | 60,357 | **58,479** |
| eras passing the 0.97 gate | 5 / 14 | **11 / 14** |

The 1,878-row drop is the repair, not a loss: those rows were wrapped comment
text emitted as transactions, now returned to the comments they printed in.

| era | before | after | |
|---|---|---|---|
| house 2014 | 98.4% | 99.2% | pass |
| house 2015 | 97.9% | 99.9% | pass |
| house 2016 | 96.6% | 98.6% | **pass** |
| house 2017 | 94.2% | 97.3% | **pass** |
| house 2018 | 93.2% | 94.7% | miss |
| house 2019 | 94.5% | 96.0% | miss |
| house 2020 | 95.0% | 95.5% | miss |
| house 2021 | 96.8% | 97.3% | **pass** |
| house 2022 | 96.9% | 99.3% | **pass** |
| house 2023 | 85.9% | 99.3% | **pass** |
| house 2024 | 98.3% | 99.2% | pass |
| house 2025 | 93.3% | 99.6% | **pass** |
| house 2026 | 97.5% | 99.8% | pass |
| senate 2026 | 100.0% | 100.0% | pass |

## The remaining three eras are a DIFFERENT mechanism (follow-up M1-D)

2018/2019/2020 still miss, and the dominant flag there is no longer
`row_orphan` but `amount_unparsed` (117 / 151 / 254). It is a **split amount
cell that never rejoins**, and the counts prove the pairing:

```
'$15,001 -'  32      '$50,000'   32
'$100,001 -'  6      '$250,000'   6
'$50,001 -'   6      '$100,000'   6
```

Each low half appears exactly as often as its high half — two fragments of one
printed amount, landing on separate lines, where `_complete_cell`'s amount
oracle declines to join them (it refuses once `block_open` is False, which a
sub-line sets). A smaller residue is prose landing in the amount column
(`'Company LLC'`, 27).

Deliberately **not** fixed here: it is a distinct mechanism on a different code
path (R24's completion oracle rather than sub-line wrapping), it carries its
own risk of over-joining unrelated fragments, and folding it into an already
large reversal would make both harder to review. Scoped and measured above so
the follow-up starts from evidence.

## Blast radius

Congressional House parse only. No schema change, no migration. Rollback is
`git revert` + `populus reparse` at the prior `PARSER_VERSION`, which restores
the previous rows byte-for-byte from the raw archive.

---

# M1-D — an orphan must not steal an open row's continuation context

**Date:** 2026-08-01 · `PARSER_VERSION` 1.1.0 → **1.2.0**

## Mechanism

The M1-C follow-up predicted "split amount cells never rejoin". That was the
symptom; the cause is different and sits one level up. Traced on
`2018/20009671`, a row that runs off the bottom of a page:

```
STRUCT top=710.7 (page N)   'CNo FINL gRoUP INC B/E' … amount '$15,001 -' capgains 'gfedc'
frag   top=107.2 (page N+1) {'capgains': 'gfedc'}          ← page reprints the glyph
frag   top=116.7            {'asset': '05.250% …', 'amount': '$50,000'}
```

The continued page **reprints the cap-gains glyph**. The row's own
`capgains_cell` is already filled, so the duplicate completes nothing and opens
an orphan — and `_open_orphan()` reassigns `open_candidate`. The row's *real*
continuation line then attached to that orphan. Segmenter trace, before:

```
after 'JT CNo FINL gRoUP INC B/E P 05'  -> candidates=1 open_is_orphan=False
after 'gfedc'                           -> candidates=2 open_is_orphan=True
after '05.250% 053025 [CS] $50,000'     -> candidates=3 open_is_orphan=True
```

One printed row became three records, and the amount stayed `'$15,001 -'`.

## Decision

While a **structural** candidate's block is still open, it remains the
continuation context: an orphan opened by a fragment on that line is still
appended and still flagged (R25/F4 visibility untouched), but `open_candidate`
is restored afterwards. Scoped precisely — once a sub-line closes the block,
the prior behaviour stands, pinned by
`test_a_closed_block_still_hands_context_to_the_orphan`.

## Measured

Reparse of all 8,298 filings, `failed 0`: orphans **632 → 558**,
`amount_unparsed` **711 → 561**, `v_default_transactions` 58,479 → 58,405.
Per-era: 2018 94.7→95.1%, 2019 96.0→**96.8%**, 2020 95.5→95.9%. **1,809 tests.**

Eras passing stays **11/14** — a real data-quality gain that does not move the
three remaining eras across the line.

## What is actually left in 2018/2019/2020 — both are OWNER DECISIONS, not bugs

Measured after M1-D, the residue is two categories and neither is a parser
defect:

1. **Exact dollar amounts** (99 / 105 / 226) — `'$94.91'`, `'$505.24'`,
   `'$20.04'`. The parser reads these perfectly; they are simply not Appendix C
   range buckets, so `normalize_amount` flags `amount_unparsed`, which counts
   as a parse defect. Whether a well-formed exact amount should count against a
   *parse* gate is a measurement-definition question. **Deliberately not
   changed here:** reclassifying it would move rows out of the gate's numerator
   and make the three eras pass without improving a single parsed value. That
   is gate-weakening and it is the owner's call, not the parser's.

2. **Wrapped tails of NON-comment sub-lines** (144 / 67 / 67, still equal
   counts) — e.g. `'THEREFoRE SHoULD NoT BE ADDED To THE oVERALL ToTAL'`
   continuing a `SUBHOLDING OF:`/`LOCATION:` line. M1-C excluded these on
   purpose: those sub-line values are not stored anywhere in the schema, so
   folding a tail in would **delete** text. Giving them a home requires storing
   sub-line values (`filing_status`, `subholding_of`, `location`) — a schema
   addition and a genuine feature, not a defect fix.
