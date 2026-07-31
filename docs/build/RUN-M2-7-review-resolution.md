# RUN M2-7 — external review resolution notes

Findings, the change that closed each, the test that fails if the change is
undone, and the mutation result proving that test is load-bearing.

## Round 2 resolution map

Source: `.codex-review-m27/m27code-2.codex.last.txt` — VERDICT
`CHANGES_REQUESTED`, five blockers. All five closed. Gates after: `make test`
→ `1674 passed, 7 skipped in 267.02s` (round-1 baseline `1656 passed, 7
skipped`; +18, zero regressions); `make security` → `dep_guard: OK`.

Mutation hygiene for every entry below: `__pycache__` cleared before and after
each swap, `PYTHONDONTWRITEBYTECODE=1`, every restore verified byte-exact by
sha256. Driver: `scratchpad/mutate_m2_7_r2.py`. **14/14 killed.**

---

### F1 — per-period coverage could print above 100%

*Claim:* `compute_period_coverage` still summed the declared total T, so a
tolerated rounding filing reported a period coverage above 100% beside a corpus
coverage of exactly 100%.

**Changes**
- `src/populus/ingest/inst13f.py` — the denominator contribution is extracted
  into ONE shared SQL fragment, `_DENOMINATOR_TERM`
  (`CASE WHEN total IS NULL THEN 0 ELSE MAX(total, resolved) END`), applied per
  filing. `compute_coverage` and `compute_period_coverage` now interpolate the
  same fragment, so the two cannot drift again — there is only one of them.
- `docs/build/M2-7-cover-tolerance-spec.md` — §I3 amended: it now states
  explicitly that it binds EVERY coverage figure, not only the corpus-wide one,
  and names the per-period tests. §I9's "per-period coverage is untouched" was
  corrected to say what actually changed about it.

**Guarding tests**
- `tests/test_cover_tolerance.py::test_period_coverage_banks_the_larger_number_and_never_reads_over_100pct`
  — direct: a rounding filing alone in Q1, an exact filing in Q2, a conflict in
  Q3. Asserts the Q1 denominator is max(S,T), that no period reads above 1.0,
  that the conflict's period does not appear at all, and that the per-period
  denominators and numerators now sum exactly to the corpus-wide ones.
- `tests/test_publish.py::test_inst_build_period_coverage_never_reads_over_100pct_with_a_rounding_filing`
  — through the BUILD REPORT, which is where the impossible figure would have
  been published: `inst_period_coverage` swept for `<= 1.0`, with the rounding
  period asserted at exactly max(S,T).

**Mutation** — `KILLED`. Reverting the per-period query to
`SUM(table_value_total_usd)` fails both tests (the direct one on the max(S,T)
denominator and the corpus reconciliation, the build one on the `<= 1.0` sweep).

---

### F2 — an all-conflict corpus was reported ABSENT, not withheld

*Claim:* build presence was tested after conflict exclusion, so a corpus
containing only conflicts read as "no institutional data ingested" instead of a
non-measurable corpus with named exclusions.

**Changes**
- `src/populus/publish/build.py` — the presence probe now asks
  `v_inst_reconciled_filings` (restatement survivors + affiliation, BEFORE the
  cover predicate) instead of `v_default_inst_filings`. A corpus with no inst
  rows at all still reads absent, so the M1-only build is unchanged.
- The withheld payload already routed `not_measurable` through
  `certifiable == False`; with presence fixed it is now reachable, and it names
  `cover_conflict_filing_ids`.

**Guarding test** —
`tests/test_publish.py::test_an_all_conflict_corpus_is_withheld_and_names_it_never_reported_absent`.
Asserts the precondition the defect turned on (reconciled population = 2,
default view = 0), then `reason == "not_measurable"`, `certifiable is False`,
`denominator == 0`, `coverage is None`, the two excluded ids named in order, and
that congress still publishes.

**Mutation** — `KILLED`. Pointing the probe back at `v_default_inst_filings`
makes `inst_withheld` None and the gate record read `absent`.

---

### F3 — four of six coverage-reporting surfaces were silent

*Claim:* `format_bulk_summary`, `accept_m2_6` and the CLI build/publish coverage
output printed coverage numbers with zero `cover_conflict` / `cover_rounding`
references. *Remediation explicitly required non-empty-conflict assertions, not
empty-list key-presence tests.*

**Changes** — all six surfaces render through the single
`format_cover_dispositions` (or its mapping wrapper
`cover_dispositions_from_mapping`), so none can drift from another:

| # | Surface | File | Round-1 state |
|---|---|---|---|
| 1 | ingest summary | `ingest/inst13f.py` | already named |
| 2 | bulk-run summary | `inst_bulk.py` | **silent** |
| 3 | build report + withheld payload | `publish/build.py` | already named |
| 4 | CLI `build` | `cli.py` | **silent** |
| 5 | CLI `publish` absence notice | `cli.py` | **silent** |
| 6 | `accept_m2_5` / `accept_m2_6` | `scripts/` | m2_5 named, **m2_6 silent** |

`docs/build/M2-7-cover-tolerance-spec.md` §I5 now carries that table as an
exhaustive enumeration, and Rule 6 points at it as the checklist to extend.

**Guarding tests** — every one asserts a NON-EMPTY conflict set:
- `tests/test_cover_tolerance.py::test_bulk_summary_names_the_excluded_conflicts` (2)
- `tests/test_publish.py::test_inst_build_names_the_cover_dispositions_behind_its_numbers` (3)
- `tests/test_publish.py::test_cli_build_output_names_the_excluded_conflicts` (4)
- `tests/test_publish.py::test_cli_publish_absence_notice_names_the_excluded_conflicts` (5)
  — drives the real build→publish CLI chain over the all-conflict corpus, so the
  notice renders from a gate record a real build wrote
- `tests/test_accept_m2_5.py::test_accept_m2_5_report_path_names_the_excluded_conflicts` (6)
- `tests/test_accept_m2_6.py::test_acceptance_report_names_a_non_empty_conflict_set` (6)
  — the committed synthetic corpus reconciles exactly, so the real coverage the
  run computes is passed through `dataclasses.replace` on its way out of the
  ingest: a genuinely non-empty conflict set, every measured figure and the gate
  decision unchanged

**Mutation** — `KILLED` ×5, one per surface (each surface's disposition line
replaced with a blank string; surface 3 was covered by round 1's M11/M12).

---

### F4 — a refused clobber could still rewrite its source

*Claim:* `build_inst_agg` called the now-mutating `ensure_views` before checking
whether the destination aliased the source, so on exactly the stale databases
this change targets, a command that was ultimately refused could still replace
source views and alter the database bytes.

**Changes**
- `src/populus/inst_agg.py` — the check is extracted as
  `refuse_if_dest_aliases_source(source_conn, dest_path)` and moved ahead of
  `ensure_views` inside `build_inst_agg`.
- `src/populus/cli.py` — `inst-agg` calls the same preflight FIRST, before
  `ensure_inst_schema` and `ensure_views`.
- `docs/build/M2-7-cover-tolerance-spec.md` — new Rule 7 records the general
  hazard: `ensure_views` is a writer now, so every refusal preflights before it.

**Guarding tests** — against a DELIBERATELY STALE-VIEW database, which is what
the round-1 tests lacked (they ran on a freshly initialised database whose views
already matched, so `ensure_views` wrote nothing and byte-identity held
vacuously):
- `tests/test_inst_agg.py::test_ensure_views_really_rewrites_a_stale_database` —
  the POSITIVE CONTROL. Proves the file hash does change on a stale database
  (and that the replacement is this predicate), and that a second call is a
  no-op. Without it the two tests below would prove nothing.
- `tests/test_inst_agg.py::test_cli_inst_agg_refuses_to_clobber_a_stale_view_source`
  — parametrized identical / relative / symlink; asserts non-zero exit, the
  refusal message, an unchanged sha256, and that the stale view is still stale.
- `tests/test_inst_agg.py::test_build_inst_agg_refuses_before_ensure_views_touches_the_source`
  — same three spellings at the BUILDER seam, since `publish.build.run_build`
  calls it directly.

**Mutation** — `KILLED` ×2 (CLI and builder). Moving the preflight back below
`ensure_views` changes the source hash while the exit code and message still
look correct — which is exactly how this shipped.

---

### F5 — the SQL tolerance predicate was not integer-only

*Claim:* SQLite promotes `1000 * delta` to REAL for valid signed-64-bit filing
values, so the SQL expression is not integer-only over its declared domain, and
the agreement tests never exercised the overflow region.

**Changes**
- `src/populus/views.sql` — the predicate is now
  `(S - T) <= MAX(1000, T / 1000)`: integer DIVISION, no multiplication, cannot
  overflow.
- `src/populus/ingest/inst13f.py` — `cover_tolerance_usd` /
  `within_cover_tolerance` mirror it with `//`; `COVER_TOLERANCE_PER_MILLE` is
  replaced by `COVER_TOLERANCE_DIVISOR`.
- `docs/build/M2-7-cover-tolerance-spec.md` — **§I1 amended** (recorded as Plan
  Deviation 3 in DEV-NOTES). The amendment carries the equivalence proof:
  with `M = max(1000, T/1000)` exact and `M' = max(1000, T // 1000)`, we have
  `M' <= M < M' + 1`, so no INTEGER lies in `(M', M]` and `δ <= M ⇔ δ <= M'` —
  the arithmetic changed and no disposition did.

**Guarding tests**
- `tests/test_cover_tolerance.py::test_tolerance_predicate_is_integer_typed_past_the_int64_promotion_point`
  — three assertions: the defect is real (`typeof(1000 * 9223372036854776)` is
  `real`); the SHIPPED predicate, read back from `sqlite_master` rather than
  retyped in the test, multiplies nothing and divides by 1000; both operands stay
  integer-typed at int64 magnitudes, and the Python tolerance returns an `int`.
- `tests/test_cover_tolerance.py::test_sql_and_python_agree_beyond_the_integer_promotion_boundary`
  — a three-way sweep at 15 scales up to int64 max, each at δ ∈ {0, 1, tol−1,
  tol, tol+1}: SQL verdict == Python verdict == the SUPERSEDED form evaluated in
  exact unbounded Python integers. The third leg is the amendment's own proof
  obligation, discharged executably. Round 1's sweep stopped at $2e9 — six
  orders of magnitude short of the promotion region.
- `tests/test_cover_tolerance.py::test_the_default_view_agrees_with_the_classifier_at_int64_scale`
  — the same boundary through the real view: two filings at ~9.2e15 straddling
  their own tolerance, one kept, one excluded and named.

**Note on what could not be tested behaviourally, recorded so it is not
mistaken for a gap.** Inside the column's domain the two forms never disagree on
a verdict: for `1000·δ` to leave int64 you need `δ > 9.22e15`, and for such a δ
to be WITHIN tolerance you would need `T ≥ 1000·δ > 9.2e18` — larger than the
column can hold. So every promoted comparison is a conflict either way, and no
fixture can catch the promotion by its answer. That is why round 1's behavioural
agreement sweep passed over a broken invariant, and why the guard above asserts
the storage class and the shipped predicate's shape.

**Mutation** — `KILLED` ×2. Restoring the multiplying predicate in `views.sql`
fails the no-multiplication assertion read from `sqlite_master`; switching the
Python tolerance to float division fails the `isinstance(..., int)` assertion.

---

### Round-1 guards re-proved

F5 replaced the very expression three round-1 guards had been proved against, so
those mutants were re-run in the new form: `<=`→`<` (5 kills), drop the $1,000
floor (3 kills), drop the 0.1% term (7 kills). None had gone vacuous.

### Scope note

No commit, push, branch or checkout. `populus.db` and `ops/` untouched — the
round-1 real-corpus figures in DEV-NOTES are labelled as round-1 evidence and
were not re-measured.
