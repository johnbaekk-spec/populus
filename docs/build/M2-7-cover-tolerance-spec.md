# Cover reconciliation: tolerance and conflict exclusion — specification

**Status:** normative for `compute_coverage` (`src/populus/ingest/inst13f.py`),
the `v_default_inst_filings` predicate (`src/populus/views.sql`), and every
surface that reports coverage.
**Owner decision (2026-07-31):** "Tolerance + flag". This document states the
decision precisely; the code implements this document.

**Why this exists.** M2-3 made *any* filing whose resolved holdings exceed its
declared cover total non-certifiable (`inflated_filing_count > 0`, zero
tolerance). That invariant is right about the danger — a filing that over-counts
drives corpus coverage above 100% and would sail past the ≥0.95 gate — and wrong
about the remedy: on the first real 1,000-filer corpus it de-certified the whole
module over penny-level arithmetic. Measured, every default filing with S > T:

| filing_id | declared T | resolved S | S − T | (S−T)/T | disposition |
|---|---:|---:|---:|---:|---|
| `inst:0000036966-26-000144` | 1,696,669,754 | 2,598,297,542 | +901,627,788 | 53.14% | **conflict** |
| `inst:0002035324-26-000003` | 366,277,054 | 367,485,301 | +1,208,247 | 0.330% | **conflict** |
| `inst:0001749914-26-000005` | 1,022,654,956 | 1,024,551,358 | +1,896,402 | 0.185% | **conflict** |
| `inst:0001821268-26-000097` | 813,936,938 | 813,936,950 | +12 | 0.0000015% | rounding |
| `inst:0001006407-26-000007` | 1,256,448,428 | 1,256,448,433 | +5 | 0.0000004% | rounding |
| `inst:0000947871-26-000717` | 1,677,629,299 | 1,677,629,300 | +1 | 0.00000006% | rounding |
| `inst:0001193125-26-315040` | 2,420,360,458 | 2,420,360,459 | +1 | 0.00000004% | rounding |

Four are the cover total being printed to a rounded dollar while the info table
sums exact ones. Three are the filer's two numbers genuinely disagreeing — one
by half its own portfolio. **A rule that treats those two situations identically
is the defect**, in either direction: zero tolerance blocks publication forever,
blanket tolerance serves a filing whose own cover says it is 53% smaller.

Under this specification that corpus measures 985 of 988 reconciled filings,
coverage 0.985326, certifiable, above the 0.95 gate — where M2-3's zero
tolerance held it permanently non-certifiable.

## Domain

For one filing in the reconciled population (restatement survivors, affiliation
applied — `v_inst_reconciled_filings`):

- **T** — `table_value_total_usd`, the total **declared on the cover**. `NULL`
  means *unknown* (cover-failed) and is out of scope here: M2-2's fail-closed
  `cover_failed` rule owns it, unchanged.
- **S** — the **resolved** sum: `Σ value_usd` over the filing's holdings with a
  non-null `security_id`. This is exactly the quantity the coverage numerator
  sums, which is why it — and not `sum_value_usd` over all holdings — is the
  quantity reconciled against the cover.
- **δ = S − T**, considered only when positive.

Three dispositions, exhaustive and mutually exclusive:

| Disposition | Condition | In corpus? | In numerator? | In denominator? |
|---|---|---|---|---|
| `cover_exact` | `S ≤ T` | yes | yes (S) | yes (T) |
| `cover_rounding` | `S > T` and `δ ≤ tol(T)` | yes | yes (S) | yes (**max(S, T)**) |
| `cover_conflict` | `S > T` and `δ > tol(T)` | **no** | no | no |

where **`tol(T) = max($1,000, 0.001 · T)`**.

## Invariants

Each holds for every corpus and every build. The guarding test is named.

**I1 — The tolerance is exact integer arithmetic, never floating point, at
every value the column can hold.**
The comparison is `δ ≤ max(1_000, T // 1_000)` — integer *division*, no
multiplication — evaluated identically in Python (`//`) and in SQL
(`MAX(1000, T / 1000)`, which is integer division when both operands are
integers). `0.001 * T` in binary floating point is not the same number in SQLite
and in Python at $10^{12}$ scale, and a disposition that depends on which engine
asked is not a disposition. **Equality is rounding**: `δ = tol(T)` is
`cover_rounding`, so the boundary is closed on the tolerant side.

*Amended 2026-07-31 (external review round 2, F5).* This invariant previously
specified the algebraically equivalent `1000 · δ ≤ max(1_000_000, T)`. That form
is **not integer-only over its declared domain**: `table_value_total_usd` is a
signed 64-bit column, so SQLite promotes `1000 * δ` to REAL once the product
passes int64 — from about `δ = 9.22e15` upward — reintroducing floating point
inside the predicate whose entire purpose is to exclude it
(`SELECT typeof(1000 * 9223372036854776)` → `real`). Division cannot overflow,
so the amended form is integer at every representable value.

*The two forms admit exactly the same integers, so the amendment changes no
disposition.* Let `M = max(1000, T/1000)` in exact rationals and
`M' = max(1000, T // 1000)`. Then `M' ≤ M < M' + 1`, so no **integer** lies in
the half-open interval `(M', M]`; since `δ` is an integer, `δ ≤ M ⇔ δ ≤ M'`.
(For `T < 0` — outside the domain of Rule 1 — Python's floor division and
SQLite's truncation disagree, but both results are below the $1,000 floor, which
therefore governs in both engines.)
*Tests: `test_cover_tolerance_boundary_is_exact_integer_arithmetic_and_closed`;
`test_tolerance_predicate_is_integer_typed_past_the_int64_promotion_point`;
`test_sql_and_python_agree_beyond_the_integer_promotion_boundary`*

**I2 — Rounding never de-certifies and never leaves the corpus.**
A `cover_rounding` filing stays in `v_default_inst_filings`, keeps every holding
in `v_default_holdings`, and contributes nothing to `inflated_filing_count`.
A corpus whose only defect is rounding is certifiable.
*Test: `test_one_dollar_rounding_stays_in_the_corpus_and_certifies`*

**I3 — Coverage is never overstated.**
A `cover_rounding` filing's denominator contribution is `max(S, T)`, not `T`:
where the two source numbers disagree we bank the **larger** one, so the filing
can never contribute more numerator than denominator and corpus coverage can
never exceed 1.0. This is the whole reason tolerance is safe — trusting the
smaller declared number is what would inflate the ratio.

This binds **every** coverage figure, not only the corpus-wide one. A per-period
figure is a coverage figure: `compute_period_coverage` applies max(S, T) per
filing *before* grouping, sharing the one SQL denominator term with
`compute_coverage` so the two cannot drift (external review round 2, F1 — the
per-period query summed the declared total alone and printed 100.1%).
*Tests: `test_rounding_denominator_banks_the_larger_number_never_over_100pct`;
`test_period_coverage_banks_the_larger_number_and_never_reads_over_100pct`;
`test_inst_build_period_coverage_never_reads_over_100pct_with_a_rounding_filing`*

**I4 — A conflict is excluded by ONE predicate, in the default view.**
`v_default_inst_filings` is the single authoritative default-filing predicate
(views.sql §10.2). The conflict exclusion lives there and nowhere else, so the
numerator, the denominator, `v_default_holdings`, `inst_agg` and every future
consumer are excluded by construction rather than by remembering to filter.
*Tests: `test_cover_conflict_leaves_the_default_view_holdings_and_aggregates`;
`test_inst_build_names_the_cover_dispositions_behind_its_numbers` (the excluded
filing's period never reaches the published `inst_agg.db`)*

**I5 — Excluded is never silent.**
Every `cover_conflict` filing is a **counted disposition named by `filing_id`**
in `InstCoverage` and on every surface that states a coverage number. There are
six, and the enumeration is exhaustive (external review round 2, F3 found four
of them silent):

| # | Surface | Renderer |
|---|---|---|
| 1 | ingest summary | `format_summary` (`inst13f.py`) |
| 2 | bulk-run summary | `format_bulk_summary` (`inst_bulk.py`) |
| 3 | build report + `inst_withheld` payload | `run_build` (`publish/build.py`) |
| 4 | CLI `build` output | `cli.build` |
| 5 | CLI `publish` absence notice | `cli._inst_absence_notice` |
| 6 | acceptance reports | `accept_m2_5`, `accept_m2_6` |

All six render through the ONE function `format_cover_dispositions` (or its
mapping wrapper `cover_dispositions_from_mapping`), so a surface cannot drift
from the others. `cover_rounding` carries a count and the maximum absolute δ.
Repo doctrine: excluded-and-flagged beats silently wrong; wrong-but-flagged
beats silently wrong; silently excluded is neither.
*Tests: `test_conflict_and_rounding_are_named_in_stats_and_withheld_surfaces`
(1); `test_bulk_summary_names_the_excluded_conflicts` (2);
`test_inst_build_names_the_cover_dispositions_behind_its_numbers` and
`test_inst_gate_withholds_below_threshold_congress_publishes` (3);
`test_cli_build_output_names_the_excluded_conflicts` (4);
`test_publish_absence_notice_names_the_excluded_conflicts` (5);
`test_acceptance_report_names_a_non_empty_conflict_set` and
`test_accept_m2_5_report_path_names_the_excluded_conflicts` (6)*

**I6 — `certifiable` fails closed on any conflict still inside the view.**
`certifiable` ⇔ no unknown cover totals **and** a nonzero denominator **and**
zero **unresolved** conflicts, where an unresolved conflict is a filing beyond
tolerance that is *still in `v_default_inst_filings`*. Under I4 that count is
structurally zero; it is retained as an independent check so that a stale view,
a hand-built database or a future consumer that reconstructs the population
cannot publish an over-counting filing. Conflicts excluded per I4 do not block;
rounding does not block.
*Test: `test_a_conflict_left_inside_the_view_still_fails_closed`*

**I7 — The classification is derived; the flags are annotation.**
`cover_conflict` / `cover_rounding` are also written to `inst_filings.flags` by
`mark_cover_dispositions` — cleared and recomputed from scratch on every run,
exactly like the affiliation flags — so a filing carries the reason it left the
corpus. **No decision reads those flags.** A database that has never run the
pass (an already-ingested corpus, a read-only snapshot) still classifies,
excludes and reports identically; a stale flag can neither exclude a good filing
nor readmit a conflicting one.
*Test: `test_dispositions_are_identical_with_and_without_the_flag_pass`*

**I8 — Replay determinism.**
The same database yields the same dispositions, the same counts, and the same
`filing_id` ordering (sorted) on every call, in-process or across processes.
*Test: `test_replay_determinism_same_db_same_classification`*

**I9 — Nothing else moves.**
`COVERAGE_THRESHOLD` stays `0.95`. `cover_failed` (NULL total ⇒ non-certifiable)
is untouched. `meets_threshold = certifiable AND coverage ≥ 0.95` is untouched.
Per-period coverage stays reporting-only and the uncovered-quarters fail-closed
naming is untouched — its *denominator* now banks max(S, T) per §I3, which is
the only change to it and is a no-op on any corpus with no rounding filing.
Exact-cover filings (`S ≤ T`, the overwhelming majority) produce byte-identical
rows, flags, digests and numbers to M2-6.
*Test: `test_exact_cover_corpus_is_byte_identical_to_the_m2_6_behaviour`*

## Rules that follow

1. **Scope of the rule.** It applies to every reconciled filing with a non-NULL
   `T ≥ 0`. `T = 0` with holdings is not exempt: `tol(0) = $1,000`, so a zero
   cover with a $1M info table is a conflict, which is the honest reading. NULL
   `T` is *not* classified here — it is unknown, and unknown is `cover_failed`.

2. **The tolerance is a floor plus a fraction, and both matter.** The $1,000
   floor exists so a small filer's $10 rounding is not a conflict; the 0.1%
   term exists so a $10B filer's $1,000 rounding is not one either. Neither
   alone covers the measured corpus.

3. **0.1% is a rounding tolerance, not a reconciliation budget.** The two
   sub-percent conflicts above (0.185%, 0.330%) are deliberately **outside** it.
   They are 6- and 7-figure dollar disagreements between two numbers the same
   filer printed on the same document; nothing about decimal rounding produces
   $1.9M. The brief that ordered this change described them as rounding-level;
   the arithmetic says otherwise, and the arithmetic is normative. Widening the
   fraction until they fit is a change to this specification, not a tuning.

4. **Excluding is not deleting.** A `cover_conflict` filing keeps its row, its
   holdings, its provenance and its lineage. It is out of the *default* view
   only. Nothing in this mechanism ever drops data.

5. **The denominator adjustment is per filing, before summing.** Denominator =
   `Σ over default filings of (T IS NULL ? 0 : max(T, S))`. Adjusting the corpus
   total afterwards would let one filing's surplus offset another's shortfall.

6. **New reporting surface, new named disposition.** Any surface that states a
   coverage number must be able to state what was excluded to produce it. Adding
   a coverage surface without the conflict `filing_id`s violates I5. The
   enumeration under I5 is the checklist; extend it in the same change.

7. **`ensure_views` now writes, so every refusal preflights before it.** So that
   an existing database picks up this predicate, `ensure_views` REPLACES a view
   whose stored SQL differs — it is no longer `CREATE VIEW IF NOT EXISTS`, and
   is therefore no longer read-only on a stale database. Any command that can
   REFUSE must run its refusal check before `ensure_views` (or any other
   statement that could write to the source), because a refused command must
   leave its source byte-identical. `populus inst-agg`'s
   destination-aliases-source check is the one such refusal today; both the
   builder (`inst_agg.build_inst_agg`) and the CLI caller preflight it
   (external review round 2, F4).
   *Tests: `test_cli_inst_agg_refuses_to_clobber_a_stale_view_source`;
   `test_build_inst_agg_refuses_before_ensure_views_touches_the_source`*

## Changing this mechanism

The tolerance constants, the disposition names and the exclusion point are
defined here. Amend this document **before** the code, in the same change as the
test for the amended invariant. If a filing is ever found to be wrongly
classified, the first question is which invariant was missing — not which
constant should be nudged.
