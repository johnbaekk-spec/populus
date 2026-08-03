# M2-8 — Outsized-position flag: normative specification

**Status:** SPEC — written **before** `src/populus/inst_flags.py` exists, per the
house pattern ([[specify-before-rewriting]]): on this repo, every defect found
*after* a specification existed was in code that never got one.
**Owner-locked parameters (OD-3, 2026-08-02):** `MIN_BASELINE_PERIODS = 4`,
`MULT = 150`, `FLOOR_BPS = 500`.
**Governs:** plan R14, R15; tasks T2, T6, T10.

---

## 1. What this flag claims, in words

> *"This position is a larger share of this filer's reported book than any single
> position it has reported in the last four quarters."*

That is the **entire** claim. It is a comparison of a filer against **its own prior
disclosures**, computed from numbers the filer itself reported. It is **not** a
claim about skill, conviction, intent, quality, or expected return, and it must
never be rendered as one.

### 1.1 Banned wording (testable)

The strings below must not appear on any surface rendering this flag. A grep-based
assertion in the post-build gate enforces it.

`bet` · `conviction` · `high-conviction` · `bullish` · `bearish` · `loading up` ·
`piling in` · `doubling down` · `backs` · `favors` · `likes` · `buying` (present
tense) · `is buying` · `just bought` · `sold` (present tense) · `move` as a verb.

**Why present tense is banned:** a 13F is a **quarter-end snapshot filed up to 45
days late**. At render time the position may not exist. Any present-tense trading
verb asserts something the document cannot support.

### 1.2 Required accompaniment

Every rendering carries: the comparison in words (§1), the period pair
(`period_of_report` and `filed_date` with elapsed lag), and the non-removable §5
`data_note`. None of these may be hidden at any breakpoint (CSS-fold ban).

---

## 2. Definitions

All arithmetic is **exact integer**. No float enters a digest.

```
share_bps(f, p, i)   = value_usd(i) * 10000 / total_value_usd(f, p)     -- integer div
max_share(f, p)      = MAX over i of share_bps(f, p, i)
baseline_max(f, p)   = MAX over q in B(f, p) of max_share(f, q)
outsized(f, p, i)   := eligible(f, p)
                       AND share_bps(f, p, i) * 100 > baseline_max(f, p) * MULT
                       AND share_bps(f, p, i) >= FLOOR_BPS
```

`B(f, p)` is the **baseline window**: the `MIN_BASELINE_PERIODS` periods
*immediately preceding* `p` in the published period sequence.

**Note the multiplication form.** The predicate is written
`share * 100 > baseline * MULT`, **not** `share > baseline * MULT / 100`, so no
integer division truncates the threshold. These are not equivalent; the divided
form silently rounds the bar *down* and admits positions that should fail.

### 2.1 Source of every input — this is where round-3 F5 bit

| Input | Source view | Why |
|---|---|---|
| `value_usd(i)`, `total_value_usd(f,p)`, `max_share(f,p)` | **`v_filer_reported_holdings`** | The filer's **own reported book**. `v_default_holdings` applies cross-filer affiliation suppression (`views.sql:97-103`), so a filer whose position an affiliate also reported would be measured against a book missing its own rows — and every share would be overstated. |
| Cross-entity issuer totals (not used by this flag) | `v_default_holdings` | Deduplicated, so an issuer total counts an affiliate relationship once. |

`agg_filer_concentration` must therefore compute its per-filer inputs from
`v_filer_reported_holdings` (task T6). Its existing `topn_share_bps` is a
**combined top-N** share and is **not** `max_share` — reusing it would compare
against a different statistic entirely (round-2 F11). `max_share` is a **new
column**; `topn_share_bps` is left untouched.

---

## 3. Eligibility — `eligible(f, p)`

A flag is emitted **only** when every condition below holds. Any failure yields
**`awaiting_baseline`** (a NULL flag with an explicit state), never a flag and never
a default.

### 3.1 Denominator completeness (round-4 F8)

- `total_value_usd(f, p) > 0`, and
- **no** retained holding in period `p` has `value_usd IS NULL`, and
- the same holds for **every** period in `B(f, p)`.

**Why a *partial* NULL disqualifies.** If one holding's value is undisclosed, the
denominator is short by that amount, so **every** `share_bps` in the book is
overstated — the flag would fire more readily precisely where the data is worst.
There is no safe partial denominator, so the book is ineligible.

### 3.2 Baseline completeness (round-3 F12)

`B(f, p)` must contain exactly `MIN_BASELINE_PERIODS` periods, each **consecutive**
and each **fully admitted for this filer**:

- the period exists in the published sequence and this filer has a default filing in it;
- ingestion for `(f, q)` did **not** end in `failed:partial_lineage` — this is an
  *accounted, non-failing* outcome in `inst_bulk.py:834`, so counting periods alone
  is not sufficient;
- no filing in `(f, q)` carries `parse_status = 'failed'` or `cover_failed`;
- `(f, q)` was not excluded by the M2-7 `cover_conflict` predicate.

A gap, a missing quarter, or any of the above ⇒ `awaiting_baseline`.

### 3.3 Consequences

- A filer new to the corpus is **not** "normal" — it is **unmeasured**, and the page
  must say so.
- `awaiting_baseline` is a **rendered state**, not an absence. It reads:
  *"not enough complete history for this filer to compare against (needs 4
  consecutive fully-reported quarters)."*

---

## 4. Annotation only

Nothing may read this flag as an input. It must not filter, rank, sort, exclude,
select, or gate anything, in the pipeline or the UI.

**Why (M2-7's lesson, applied):** a persisted flag consumed by a decision path
silently changes behaviour on any corpus that never ran the flag pass — the exact
failure the `cover_conflict` rule was written to prevent. The flag is a label on a
row, and nothing else.

---

## 5. Truth table (executable — every row becomes a test)

`n` = count of consecutive fully-admitted prior periods. `T` = `total_value_usd`.

| # | History | T (current) | NULL values present | max position share | baseline_max | Expected |
|---|---|---|---|---|---|---|
| 1 | n=4 clean | > 0 | none | 900 bps | 500 bps | **outsized** (900·100 > 500·150) |
| 2 | n=4 clean | > 0 | none | 700 bps | 500 bps | not outsized (700·100 = 70,000 < 75,000) |
| 3 | n=4 clean | > 0 | none | 750 bps | 500 bps | **boundary — not outsized** (equal, predicate is strict `>`) |
| 4 | n=4 clean | > 0 | none | 400 bps | 100 bps | not outsized (below `FLOOR_BPS`) |
| 5 | n=4 clean | > 0 | none | 500 bps | 100 bps | **outsized** (exactly at floor, and 50,000 > 15,000) |
| 6 | n=3 | > 0 | none | 900 bps | — | `awaiting_baseline` |
| 7 | n=4 with a **gap** | > 0 | none | 900 bps | — | `awaiting_baseline` |
| 8 | n=4, one had `partial_lineage` | > 0 | none | 900 bps | — | `awaiting_baseline` |
| 9 | n=4, one had a `failed` filing | > 0 | none | 900 bps | — | `awaiting_baseline` |
| 10 | n=4, one excluded by `cover_conflict` | > 0 | none | 900 bps | — | `awaiting_baseline` |
| 11 | n=4 clean | **0** | — | — | — | `awaiting_baseline`; **no division performed** |
| 12 | n=4 clean | NULL | — | — | — | `awaiting_baseline`; no division |
| 13 | n=4 clean | > 0 | **one NULL in current** | — | — | `awaiting_baseline` (§3.1) |
| 14 | n=4 clean | > 0 | **one NULL in a baseline period** | 900 bps | — | `awaiting_baseline` (§3.1) |
| 15 | n=4 clean, book = one 50% position | > 0 | none | 5000 bps | 1000 bps | **outsized** |
| 16 | n=4 clean, book = five 10% positions | > 0 | none | 1000 bps | 1000 bps | not outsized — **and `topn_share_bps` for N=5 would be 5000, proving the two statistics differ** |
| 17 | n=4 clean, affiliate also reported the position | > 0 | none | as reported by **this** filer | — | computed from `v_filer_reported_holdings`; the position is **present**, not suppressed |

Rows 15/16 are the named fixture pair for R14: identical `topn_share_bps` semantics
would misclassify one of them.

---

## 6. Mutation list (each must change behaviour, not just source)

1. Delete the `awaiting_baseline` guard → rows 6–14 must flip to a flag. If they do
   not, the guard was never load-bearing.
2. Count baseline periods without checking admission → rows 8, 9, 10 flip.
3. Allow a partial-NULL denominator → rows 13, 14 flip.
4. Substitute `topn_share_bps` for `max_share` → row 16 flips.
5. Compute inputs from `v_default_holdings` → row 17 loses the position.
6. Rewrite the predicate as `share > baseline * MULT / 100` → row 3 flips (the
   truncating division lowers the bar).
7. Change `>` to `>=` → row 3 flips.
8. Let the flag feed a filter/sort anywhere → an ordering assertion must fail.
9. Emit the flag with a banned word → the wording gate must fail.

A surviving mutation means the test asserted an end state rather than the property
([[mutation-tests-pin-properties]]).

---

## 7. Open question carried to the owner

This flag is the **only new claim** in a product whose credibility rests on never
claiming more than the filing supports. Everything else in RUN M2-8 *reports what
was filed*; this *asserts something about a named institution*. A defensible
alternative is to ship holdings, holders and the activity feed first and give the
flag its own run and its own review. Recorded here rather than resolved, and raised
in every review round as an Open Question.

Related: [[specify-before-rewriting]], [[mutation-tests-pin-properties]],
[[reversing-a-reviewed-decision]].
