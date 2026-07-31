# MODULE 2 — known issues carried at merge

**Status:** open, accepted at merge · **Recorded:** 2026-07-31
**Applies to:** `main` from `57a88b5` (Merge RUN M2-5) onward
**Source:** two adversarial code-review rounds of RUN M2-5 (16 findings, then 9).
Ten findings were fixed and independently verified before merge; the four below
were **not** fixed and shipped knowingly.

None of these can fire on any SEC file published to date — see §6, where the
claim is measured rather than asserted. They are latent defects against malformed
input that has not yet occurred. That is why they were accepted at merge; it is
not a reason to leave them open forever.

---

## 1. KI-1 (was M2-5 round-2 F1) — R5 can declare two different files identical

**Where:** [`src/populus/parse/list13f.py:596`](../../src/populus/parse/list13f.py)

```python
status_flag=_TEXT_STATUS.get(status_cell, ""),
```

**What is wrong.** An out-of-domain status cell (e.g. `*X*`) maps to `""` — the
**same** canonical value as a legitimately blank/continuing row. The row is
correctly refused for seeding (`rejected_bad_field`), but `RawRow` has already
destroyed the distinction, so the R5 cross-format gate compares `""` on the text
side against `""` on an unchanged PDF side and reports the two formats identical.
The option column has the same shape: `has_listed_option=option_cell == "*"`
maps every non-`*` value, valid or not, to `False`.

**Reproduction (reviewer, independently verified).** Change one continuing
excerpt row's text status cell from blank to `*X*`, leave the PDF untouched:
`rejected_bad_field=1` **and** `assert_cross_format_identity(...)` still passes.
On the real 25,333-row file a single such row leaves parse coverage at ~0.99996,
above the 0.999 floor, so nothing else catches it either.

**Impact.** R5 is the gate that certifies the PDF parser against the text ground
truth for the one quarter SEC publishes in both formats. This narrows what a
passing R5 actually proves: it proves agreement on *valid* values, not agreement
on file content.

**Root cause.** Validation and R5 identity share one representation.
`field_ok` rejects the cell for seeding while `RawRow` has already normalized it
away. R5 needs source fidelity; seeding needs validated meaning; one structure
cannot serve both.

## 2. KI-2 (was M2-5 round-2 F5) — a shifted row hides an A/D conflict

**Where:** `src/populus/parse/list13f.py` — conflict collection consumes
`candidate.status_flag`, which is read from the fixed slice `[67:70]`.

**What is wrong.** A CUSIP carrying both `*A*` and `*D*` must reject **both**
rows (neither seeds). But the conflict decision reads the same lossy value as
KI-1, from a fixed column slice. Delete one character *before* column 67 in the
`*D*` companion and the slice observes `"D* "` — out of domain, so the row
becomes `rejected_bad_width`/`rejected_bad_field`, the conflict is never seen,
and the valid `*A*` row seeds **alone**.

**Reproduction (reviewer).** In a 1,000-row probe: `accepted=2`,
`rejected_bad_width=1`, `rejected_status_conflict=0`, and Apple seeded.
Validation passed at exactly 0.999 coverage. A three-row fixture hides this;
it was found only because the probe was large enough to clear the coverage floor.

**Impact.** The A/D conflict rule is not defensive theatre — it fires **6–76
times per quarter on production data** (§6). A conflict that goes unseen seeds a
definitional identity that the SEC's own list says is disputed.

**Why KI-1 and KI-2 are one defect.** Both are the shared-representation problem.
They are listed separately because they were found separately, but a fix for one
that does not address the other has not addressed the mechanism — which is
exactly what happened between review rounds 1 and 2: round 1 widened the R5
tuple, and round 2 showed that widening a tuple of already-normalized values
changes nothing.

## 3. KI-3 (was M2-5 round-2 F4) — the SEC row-count trailer is optional

**Where:** [`src/populus/ingest/list13f.py:191`](../../src/populus/ingest/list13f.py)

```python
parsed.document_total_count is not None
```

**What is wrong.** SEC PDFs carry a `Total Count: NNN` trailer — an independent
proof that the parser neither dropped nor invented rows. The check is skipped
entirely whenever extraction returns `None`, and the parser filters a recognized
trailer line even when the regex fails to parse it. So a typography or regex
drift silently removes the only independent row-count proof while parse coverage
stays at 1.0.

**Missed mutation (reviewer).** Make `_TOTAL_COUNT_RE` never match — every
current test still passes. The purported trailer test builds `ParsedList13f`
by hand with `document_total_count=None` and never exercises extraction at all.

## 4. KI-4 (was M2-5 round-2 F8) — coverage is reported above 100%

**Where:** `src/populus/ingest/inst13f.py` — `compute_coverage` and
`compute_period_coverage` divide unconditionally.

**What is wrong.** RUN M2-5 added a per-filing non-inflation guard, and it works:
an inflated filing sets `inflated_filing_count`, clears `certifiable`, and fails
the gate closed. But the **reported ratio is still `numerator/denominator`**, so
a filing declaring total 100 with 120 of resolved holdings publishes
`coverage = 1.2` — including in acceptance output.

**Missed mutation (reviewer).** Set the reported coverage to `99.0`; the current
test still passes, because it asserts the inflation count, certifiability and
gate failure but never `coverage <= 1`.

**Why this one is different from KI-1..3.** It is a **G5 honesty defect**, not a
latent-input defect. It requires no malformed source file — only an amendment
composition that over-counts, which is a live path. The gate behaves correctly;
the *published number* does not. On a project whose stated purpose is calibrating
trust in numbers, a ratio above 100% is the wrong thing to print even when it is
correctly refused. **Of the four, fix this one first.**

---

## 5. Remediation

`docs/build/RUN-M2-5-parse-substrate.md` (committed alongside this file) is a
written specification that closes KI-1 and KI-2 at the mechanism level: three
layers — verbatim cells → an **injectively** canonical R5 substrate → validated
records — with invariants C1–C3, D1–D5, R1–R2, and a test-obligation table
naming, for each invariant, the mutation that must break its test.

**That spec is a DRAFT and has not been design-reviewed.** A review was launched
and hung without producing output. Review it before implementing.

KI-3 and KI-4 are localized and need no specification: require and parse the
trailer, hard-failing on a recognized-but-unparseable one; and return `coverage
= None` for an inflated population while retaining numerator/denominator for
diagnosis, asserting that neither corpus nor per-period coverage is ever
published above 1.

Three further findings from the same round were also left open and are lower
value: incomplete sidecar value-type schema validation, incomplete
replay/migration state snapshots, and missing negative tests for split
resolution returning `NULL`. They are recorded in the round-2 review output.

## 6. Why these were accepted at merge — the measurement

KI-1 and KI-2 both require a structurally malformed row: wrong width, or a cell
outside its documented domain. Every cached SEC file was parsed to count them:

| source | rows | accepted | bad_width | bad_field | A/D conflicts |
|---|---|---|---|---|---|
| 2026q2-text | 25,333 | 12,601 | 0 | 0 | 46 |
| 2026q2-pdf | 25,333 | 12,601 | 0 | 0 | 46 |
| 2026q1-pdf | 24,641 | 12,118 | 0 | 0 | 76 |
| 2025q4-pdf | 24,246 | 11,837 | 0 | 0 | 22 |
| 2025q3-pdf | 23,764 | 11,495 | 0 | 0 | 8 |
| 2025q2-pdf | 23,239 | 11,216 | 0 | 0 | 12 |
| 2025q1-pdf | 22,860 | 10,994 | 0 | 0 | 6 |

**167,083 rows, zero malformed.** Neither KI-1 nor KI-2 has a trigger in any SEC
list published to date.

Two corollaries worth keeping:
- The 2026Q2 text and PDF agree at the **disposition** level (identical row,
  accepted and conflict counts) — independent corroboration of R5 beyond the
  row-tuple comparison it performs.
- `rejected_status_conflict` fires on real data every quarter, so KI-2 sits on an
  exercised path, not a dormant branch.

**The risk this leaves.** SEC formatting is stable but not contractual. If a
future list introduces a new status code, changes a column position, or ships a
PDF whose extraction is noisier than today's, KI-1 and KI-2 become live
simultaneously — and their failure mode is silent: R5 passes, coverage stays
high, and a disputed identity seeds. There is no alarm. Re-run the §6
measurement against each newly cached quarter; a non-zero `bad_width` or
`bad_field` count is the signal to stop and implement the spec.

## 7. Provenance

Ten of the sixteen round-1 findings were fixed and **independently verified** by
a second review before merge — including the G14 violation where authority
splits failed to repoint `inst_holdings` (a real identity-time-travel breach),
the quarter-level seed ledger, the rebuilt acceptance script that now proves
`inst` reaches the published manifest, and five vacuous tests.

The merge evidence, re-run against a **provably frozen** source tree (identical
hash before and after the run): 1578 passed / 8 skipped, `dep_guard` clean, and
`make accept-m2-5` green at corpus-wide **0.9996** with `certifiable=yes`,
`meets_threshold=yes`, `inst in published manifest=yes`, on both the fresh and
populated rollout orders.
