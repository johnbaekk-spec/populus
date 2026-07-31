# RUN M2-5 — the 13(f) list parse substrate: raw, canonical, record

**Status:** DRAFT for review · **Scope:** `src/populus/parse/list13f.py` only
**Why this document exists:** two consecutive adversarial review rounds produced
blockers in this one mechanism, and each fix moved the defect instead of closing
it. Round 1 found the R5 tuple too narrow (F1) and unknown cells coerced to blank
(F9). Round 2 found that widening the tuple was not enough — the *values in it*
are normalized, so an invalid text cell still compares equal to a valid PDF cell
(F1) — and that the A/D conflict decision reads the same lossy value, so damage
before the status column hides a conflict entirely (F5).

Per `specify-before-rewriting`: when consecutive rounds land blockers in one
mechanism, the rules were never written down. This writes them down.

---

## 1. The defect class, stated once

One data structure is serving two incompatible purposes.

`RawRow` is documented as "the cardinality-preserving substrate the R5
cross-format gate compares", but it is built from `_Candidate` fields that have
already been **interpreted**:

```python
status_flag=_TEXT_STATUS.get(status_cell, ""),   # "*X*" -> ""  (same as blank!)
has_listed_option=option_cell == "*",            # anything not "*" -> False
```

R5 needs **source fidelity** — did the PDF parser reproduce what the text file
says? Seeding needs **validated meaning** — is this row safe to write to the
identity registry? These are different questions and they need different values.
Collapsing them means every invalid value is silently mapped onto some *valid*
value, and R5 then compares that valid value on both sides and declares identity.

**The reusable tell** (same shape as the P3 pagination defect): a function
deriving one property from parameters that only describe a *different* property.
Here, R5 identity is derived from seed-eligibility values. The signature is the
bug; patching the body moves it.

---

## 2. Three representations, three jobs

| Layer | Type | Job | Lossy? |
|---|---|---|---|
| **Cells** | `_Cells` | verbatim per-column source tokens | never |
| **Canonical** | `RawRow` | the R5 cross-format comparison substrate | only across *representation*, never across *value* |
| **Record** | `ListRecord` | validated, seed-eligible definitional rows | yes, by design — invalid rows are gone |

Data flows Cells → Canonical → Record. It never flows backwards, and **no layer
may read a value from a layer below it to make a decision that belongs above it.**

### 2.1 Cells — verbatim, never normalized

`_Cells` holds each fixed-position column exactly as it appeared in the source
(post-NFC, minus the line terminator). No trimming beyond what the layout
defines, no domain mapping, no rejection. A wrong-width line still yields cells
(populated best-effort, with a `structural_ok=False` marker) so that a malformed
row still participates in every downstream decision rather than vanishing.

### 2.2 Canonical — the R5 substrate

`RawRow` exists to answer exactly one question: **does the PDF parser reproduce
the text file, row for row?** It must therefore be canonical across the two
*representations* while remaining injective on *values*.

The two formats spell the same fact differently (`*A*` vs the word `ADDED`), so
verbatim comparison is impossible. Canonicalization is required — but it must
obey:

> **INVARIANT C1 (injectivity).** The canonical mapping is injective. Two
> different source cells never map to the same canonical value. In particular an
> **invalid** cell never maps onto a **valid** canonical value.

Concretely:

| source cell (text) | source cell (PDF) | canonical `status` |
|---|---|---|
| `"   "` | absent | `NONE` |
| `"*A*"` | `ADDED` | `ADDED` |
| `"*D*"` | `DELETED` | `DELETED` |
| anything else, e.g. `"*X*"`, `"D* "` | any other word | `INVALID:<verbatim token>` |

and identically for the option column: `"*"` → `TRUE`, `" "` → `FALSE`, anything
else → `INVALID:<verbatim token>`.

The `INVALID:` prefix carries the raw token, so a text `*X*` can never equal a
PDF `ADDED`, a PDF blank, **or a differently-invalid PDF cell**. That single rule
closes round-2 F1.

> **INVARIANT C2 (fidelity).** `RawRow` is emitted once per source data line,
> pre-dedup, in file order, for **every** line including malformed ones. Row
> count, order and multiplicity are preserved absolutely. No filtering, no
> deduplication, no sorting — ever.

> **INVARIANT C3 (comparability).** `RawRow` contains only fields both formats
> can express. Text column 80 is **"Misc: Unused"** per the SEC layout (chars
> 71–79 blank, char 80 unused) — it is not a status column, the PDF has no
> counterpart, and it is therefore excluded from `RawRow`. It is not "validated
> as `E`": the layout does not define it as `E`, and requiring `E` would be an
> invented constraint. Observationally all 25,333 rows of 2026Q2 carry `E`; that
> is recorded as an observation, not enforced as a rule.

### 2.3 Record — validated and seed-eligible

A `ListRecord` is produced only for a row that is structurally sound **and**
every cell is in its documented domain. Anything else is a **counted** reject
under a named disposition. G3: never silently dropped, never coerced.

---

## 3. Disposition rules

> **INVARIANT D1 (file-wide, then per-row).** Every disposition that depends on
> more than one row is decided over the **complete candidate set**, in a
> canonical order, **before** any row is judged seed-eligible. The outcome is
> therefore independent of input order.

> **INVARIANT D2 (fail closed on untrustworthy structure).** If a row's CUSIP is
> recognizable but the row is **not** structurally sound and field-valid, then no
> trustworthy status can be read for that row — and therefore **the entire CUSIP
> is rejected**, not merely that row.
>
> This is the rule round-2 F5 violates. Today a damaged `*D*` companion is
> discarded as `rejected_bad_width` and its valid `*A*` sibling seeds alone. The
> correct reading: we *know* there is another row for this CUSIP and we *cannot
> read its status*, which is precisely the state in which we must not seed.
> Disposition: `rejected_untrustworthy_companion`.

> **INVARIANT D3 (A/D conflict).** A CUSIP carrying both `ADDED` and `DELETED`
> among its candidate rows is `rejected_status_conflict`. **Neither** row seeds.
> Decided over the full candidate set (D1), from canonical values that preserve
> invalidity (C1), and after D2 has already removed CUSIPs whose status cannot be
> trusted.

> **INVARIANT D4 (duplicates).** Two rows collapse into one record only when
> **every** canonical field is identical. Any divergence in issuer, class, option
> or status is `rejected_definition_conflict` and the whole CUSIP seeds nothing.

> **INVARIANT D5 (accounting).** Every input line lands in exactly one
> disposition bucket. `accepted + Σ(rejected_*) == total data lines read`, and
> this identity is asserted, not assumed.

**Ordering is fixed:** cells → canonical → D2 (untrustworthy) → D3 (A/D
conflict) → D4 (definition conflict) → per-row eligibility → records. Each stage
consumes the full set from the stage before it.

---

## 4. What R5 asserts

`assert_cross_format_identity(text, pdf)` compares the **complete** `raw_rows`
sequences on count, order, multiplicity and every canonical field. It runs on the
full 2026Q2 text and PDF — the one quarter SEC publishes in both formats —
and is **mandatory**: a dual-format quarter that has not passed it is not
seedable.

> **INVARIANT R1.** R5 compares canonical rows produced under C1–C3. Because C1
> is injective, R5 passing means the PDF parser reproduced the text file's
> content exactly — including its malformed rows, as malformed.

> **INVARIANT R2.** R5 is independent of validation. A file may pass R5 and still
> seed nothing (every row invalid, identically, in both formats). R5 answers "did
> we read it right?", never "is it good data?".

---

## 5. Test obligations

Each invariant needs a test that **fails when the invariant is removed**. The
mutation is named because a test that cannot fail is a defect (eleven such were
found in M2-4; five more in M2-5 round 1).

| Invariant | Test | Mutation that MUST break it |
|---|---|---|
| C1 | mutate one text status cell to `*X*`, leave PDF unchanged | map unknown status to `""` → R5 must FAIL, and does not today |
| C1 (option) | mutate one text option cell to `#` | map non-`*` to `False` → R5 must FAIL |
| C2 | duplicate one source line in both formats | dedup `raw_rows` before comparison → count must diverge |
| C2 | full-file 2026Q2 | pin 25,333 independently of the parser's own count |
| C3 | — | assert col 80 absent from `RawRow`; assert no `E` requirement exists |
| D1 | same conflict, rows in reversed order | order-dependent decision → outcomes must match |
| D2 | valid `*A*` + same-CUSIP `*D*` damaged by a **deletion before col 67** | today seeds Apple; must seed nothing |
| D3 | plain `*A*` + `*D*` same CUSIP | either row seeding → FAIL |
| D4 | same CUSIP, differing issuer | collapsing to one record → FAIL |
| D5 | any corpus | drop one bucket from the sum → identity must FAIL |

**Every D2/D3/D4 test must run through the real parser and the real seeder**, on
a corpus large enough to clear the parse-coverage floor — round-2 F5 was found
only because the reviewer embedded the case in a 1,000-row probe rather than a
three-row fixture.

---

## 6. Non-goals

Unchanged by this document: the coverage gate threshold and its basis; the
FTD fallback and `resolve_cusip`'s fail-closed rule; the seed ledger; authority
interval splitting; the serving layer. Findings F4/F8/F10/F15/F17/F18/F19 are
localized defects outside this mechanism and are fixed on their own terms, not
by this spec.

---

## 7. Open questions for review

- **OQ-1.** Should `INVALID:<token>` embed the verbatim token, or a hash of it?
  Verbatim is more debuggable and these are public documents with no sensitive
  content; hashing would bound the size of a pathological cell. Proposed:
  verbatim, truncated to 32 chars with an explicit `…` marker.
- **OQ-2.** D2 rejects the whole CUSIP when a companion row is untrustworthy.
  Should a *single* untrustworthy row with no companions also reject its CUSIP?
  Proposed: yes — it is the same argument, and the row was already not seedable.
- **OQ-3 — MEASURED AND CLOSED.** Does D2 risk rejecting legitimate CUSIPs in the
  real historical PDFs? **No.** Measured against all seven cached files
  (2026Q2 text + six quarterly PDFs, 167,083 rows total):

  | source | rows | accepted | bad_width | bad_field | A/D conflicts |
  |---|---|---|---|---|---|
  | 2026q2-text | 25,333 | 12,601 | 0 | 0 | 46 |
  | 2026q2-pdf | 25,333 | 12,601 | 0 | 0 | 46 |
  | 2026q1-pdf | 24,641 | 12,118 | 0 | 0 | 76 |
  | 2025q4-pdf | 24,246 | 11,837 | 0 | 0 | 22 |
  | 2025q3-pdf | 23,764 | 11,495 | 0 | 0 | 8 |
  | 2025q2-pdf | 23,239 | 11,216 | 0 | 0 | 12 |
  | 2025q1-pdf | 22,860 | 10,994 | 0 | 0 | 6 |

  **Zero** structurally-unsound or field-invalid rows in any real file, so D2
  newly rejects **zero** legitimate CUSIPs. Adopt D2 in its strict form: on this
  corpus it is free, and it exists for the malformed input we have not yet seen.

  Two further facts this measurement establishes, both worth keeping:
  - The 2026Q2 text and PDF agree at the **disposition** level too (identical
    rows, accepted and conflict counts), which is independent corroboration of
    R5 beyond the row-tuple comparison.
  - `rejected_status_conflict` fires 6–76 times per quarter on **production**
    data. The A/D conflict rule is an exercised path, not a defensive branch —
    which is exactly why D2's hole (a conflict that goes unseen) is a blocker
    rather than a theoretical concern.
