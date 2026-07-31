# RUN M2-7 — Dev Notes (dev-notes-v1)

## Detected Stack

Python 3.12, `uv`/hatchling, SQLite/JSON1, pytest. Gates: `make test`,
`make security`. Views applied by `ensure_views` (`src/populus/amendments.py`);
canonical store = one SQLite DB.

## Requirement and Task Completion

| R-id | Status | Evidence |
|---|---|---|
| R1 tolerance classifier | complete | `classify_cover` / `within_cover_tolerance` / `cover_tolerance_usd` (`inst13f.py:1146-1230`), integer **division** — see the F5 deviation below |
| R2 denominator banks max(T,S) | complete | one shared `_DENOMINATOR_TERM` (`inst13f.py:1297-1311`) used by `compute_coverage` AND `compute_period_coverage` — the two drifted until external review F1 |
| R3 view-predicate exclusion | complete | `views.sql:49-116` (`v_inst_reconciled_filings` + default-view cover stage); holdings/aggregates inherit |
| R4 certifiable = zero unresolved | complete | `inst13f.py:1430-1450`; `inflated_filing_count` retained as fail-closed backstop |
| R5 dispositions named | complete (**claim corrected**) | see the R5 correction below — round 1 declared this complete with FOUR of six surfaces silent |
| R6 fixtures byte-identical | complete | all 26 golden `expected.json` untouched; byte-identity test |
| R7 ensure_views staleness | complete | `amendments.py:22-100` — replaces only differing stored SQL. It is now a WRITER, which is what made the `inst-agg` clobber-refusal ordering a real defect (F4); spec Rule 7 records the consequence |
| R8 annotation-only flags | complete | `mark_cover_dispositions` (`inst13f.py:1265-1290`) wired in `finalize_inst_ingest`; spec §I7 test proves no decision reads flags |

### R5 claim correction (external review round 2, F3)

The table above previously read "R5 dispositions named | complete" and cited
three surfaces. That claim was **wrong when it was made**. `format_summary`,
`accept_m2_5` and the build report/withheld payload carried the dispositions;
`format_bulk_summary`, `accept_m2_6`, the CLI `build` output and the CLI
`publish` absence notice printed coverage numbers with **zero** `cover_conflict`
or `cover_rounding` references. Four of six surfaces were silent — the precise
failure the R5 contract exists to prevent — and the round-1 tests did not catch
it because they asserted key PRESENCE on an EMPTY disposition set.

R5 is now complete against an enumerated, exhaustive surface list (spec §I5
table, six entries), all rendering through the single
`format_cover_dispositions` / `cover_dispositions_from_mapping` pair, each with
a NON-EMPTY conflict assertion and each mutation-verified.

## Changed Files

Reconciled against `git status --short` **after round 2**: 14 modified + 2 new
(round 1 reported 8 + 2; the six additions are marked ★). `ops/` and
`populus.db` are untracked-preexisting and untouched — `populus.db` was not read
or written in round 2 at all.

- `src/populus/ingest/inst13f.py` — classifier, coverage, dispositions, summary;
  round 2: shared `_DENOMINATOR_TERM` (F1), divide-form tolerance (F5)
- `src/populus/views.sql` — `v_inst_reconciled_filings`, default-view predicate;
  round 2: overflow-safe integer predicate (F5)
- `src/populus/amendments.py` — `ensure_views` staleness replacement
- `src/populus/publish/build.py` — dispositions on report + withheld payload;
  round 2: presence probed from the reconciled population (F2)
- `src/populus/inst_bulk.py` — bulk summary surfaces dispositions (F3)
- `src/populus/cli.py` ★ — `build` and `publish` output name the dispositions
  (F3); `inst-agg` preflights the alias refusal before any write (F4)
- `src/populus/inst_agg.py` ★ — `refuse_if_dest_aliases_source` extracted and
  moved ahead of `ensure_views` (F4)
- `scripts/accept_m2_5.py` — acceptance output names dispositions
- `scripts/accept_m2_6.py` ★ — acceptance output names dispositions (F3)
- `tests/test_publish.py` — build/withheld disposition assertions; round 2: the
  F1 period-figure, F2 all-conflict and F3 CLI build/publish regressions, plus
  two shared corpus fixtures (`seed_inst_cover_mix`, `seed_inst_all_conflict`)
- `tests/test_list13f_coverage.py` — F8 test rewritten to new semantics
  (renamed `test_resolved_over_declared_total_never_reads_over_100pct`) — the
  ONE test whose expectations this owner decision changes
- `tests/test_inst_agg.py` ★ — F4 stale-view alias refusals (CLI and builder,
  three spellings each) with byte-hash assertions, plus the positive control
  proving `ensure_views` really would have written
- `tests/test_accept_m2_5.py` ★ / `tests/test_accept_m2_6.py` ★ — F3 non-empty
  conflict assertions on both acceptance surfaces
- `docs/build/M2-7-cover-tolerance-spec.md` — NEW, normative spec; round 2
  amended §I1 (F5), §I3 (F1), §I5 (F3), §I9 and added Rule 7 (F4)
- `tests/test_cover_tolerance.py` — NEW, 22 cases (17 round 1 + 5 round 2)

## Reuse / Duplication Check

Affiliation-flag clear-and-recompute pattern reused for cover flags; view
staging pattern reused for exclusion; `BuildReport`/`inst_withheld` payloads
extended, not forked; no new module, dependency, or parallel mechanism.

## Simplicity Audit

One pure classifier; one additive view; one staleness rule in `ensure_views`;
no DDL, no new column, no new flag semantics beyond annotation.

## Tech Debt Introduced

Round 1 declared "none new". External review round 2 **rejected that
declaration** and was right to: the divergent per-period denominator (F1) and
the incomplete reporting-surface propagation (F3) were undeclared incomplete
boundary work, not absent debt. Both are now closed rather than declared.

With that corrected, none outstanding. Spec Rule 3 records the deliberate
boundary: 0.1% is a rounding tolerance, not a reconciliation budget — the
0.185%/0.330% filings are conflicts; widening requires a spec amendment.
Excluded filings' holdings remain in the DB (auditable) but outside the default
view.

## Memory Touch-Points

`specify-before-rewriting` — the spec was written before the gate mechanism was
edited (gate-semantics change class). Bytecode-hygiene lesson applied to every
mutant swap.

## Failure-Mode Sweep

Stale view leaking a conflict → certifiability fail-closed backstop (tested);
float drift → integer arithmetic (tested); flag pass never run on an old corpus
→ annotation-only flags cannot gate (tested); replay determinism (tested;
first-pass `ORDER BY` mutant survived on fixture-order coincidence — the test
was rewritten to descending insertion order and now kills it); fixture drift →
byte-identity assertions.

## Tests Run

- `make test` → **`1674 passed, 7 skipped in 267.02s`** (round-1 baseline
  `1656 passed, 7 skipped`; +18 round-2 regression tests, zero regressions).
- `make security` → `dep_guard: OK — no denylisted vendor dependencies or
  imports`.
- Round-1 figures, for the record: `1656 passed, 7 skipped in 276.85s` over a
  `1638 passed, 7 skipped` pre-M2-7 baseline.
- **Re-measured after round 2** by the coordinating session on a read-only
  scratch copy with `ensure_views` applied: corpus AND per-period coverage both
  0.985326, certifiable=True, meets=True, rounding=4 (max delta $12),
  conflicts=3 named — identical dispositions to round 1, as the equivalence
  proof predicts. The finisher session itself was scoped not to touch `populus.db`. Those are ROUND-1 figures. Round 2 changed
  two things that could bear on them: the tolerance expression's form (F5), which
  is provably equivalent over integers and so moves no disposition (spec §I1
  proof, plus a SQL/Python agreement sweep to int64), and the PER-PERIOD
  denominator (F1), which the quoted corpus-wide figures do not depend on. The
  per-period figures for that corpus were never separately quoted and have NOT
  been re-measured.
- Real-corpus re-measure (ROUND 1; read-only; `populus.db` sha256 byte-identical before
  and after, `846b8cab…01e602`): filings 988→985 in default view; coverage
  4,012,640,327,546 / 4,072,397,416,797 = **0.985326**; `certifiable=True`;
  `meets_threshold=True`; `cover_rounding=4` (max delta $12);
  `cover_conflict=3` excluded: `inst:0000036966-26-000144` (1.5314×,
  +$901,627,788), `inst:0002035324-26-000003` (+$1,208,247, 0.330%),
  `inst:0001749914-26-000005` (+$1,896,402, 0.185%).

### Mutation Verification

**Round 1 — 12/12 killed** under bytecode hygiene (`__pycache__` cleared around
each swap, `PYTHONDONTWRITEBYTECODE=1`, restores hash-verified): `<=`→`<`; drop
$1,000 floor; drop per-mille term; bank smaller denominator; view drops cover
stage; certifiable drops unresolved term; `ensure_views` ignores staleness;
dispositions lose ORDER BY (survived first pass on fixture-order coincidence —
test rewritten, now killed); summary stops naming; flag pass stops clearing;
report drops passing-path dispositions; withheld payload drops filing_ids.

**Round 2 — 14/14 killed**, same hygiene, every restore verified byte-exact by
sha256 (driver: `scratchpad/mutate_m2_7_r2.py`). Eleven new-guard mutants, one
per fix and one per reporting surface: F1 per-period denominator reverts to
`SUM(table_value_total_usd)`; F2 presence probe reverts to the post-exclusion
view; F3 ×5 — bulk summary, CLI `build`, CLI `publish` notice, `accept_m2_5`,
`accept_m2_6` each stop naming; F4 ×2 — the alias preflight moves back below
`ensure_views` in the CLI and in `build_inst_agg`; F5 ×2 — `views.sql` restores
the multiplying predicate, and the Python tolerance uses float division.

Plus THREE round-1 guards **re-proved against the rewritten classifier**, since
F5 replaced the very expression they had been proved against: `<=`→`<` (5 kills),
drop the $1,000 floor (3), drop the 0.1% term (7). None had gone vacuous.

## Plan Deviations

1. The owner-decision narrative described "one outlier"; the normative formula
   yields THREE conflicts (0.185% and 0.330% are past the 0.1% tolerance).
   Implemented the formula, recorded the divergence as spec Rule 3.
2. `ensure_views` semantics change (R7) was not in the original decision text
   but is required for correctness on existing databases; stated, tested.
3. **Spec amendment, round 2 (F5) — a deviation from "the code implements this
   document", declared as one.** §I1 originally specified the tolerance
   comparison as `1000 · δ ≤ max(1_000_000, T)`. That form is not integer-only
   over its own declared domain: `table_value_total_usd` is signed 64-bit, so
   SQLite promotes `1000 * δ` to REAL from about `δ = 9.22e15` upward, putting
   floating point back inside the predicate whose sole purpose is to exclude it.
   §I1 was amended to the overflow-safe `δ ≤ max(1_000, T // 1_000)` and the
   code follows it. Amending the spec, not just the code, is what repo doctrine
   requires for a gate-semantics change; the amendment carries its own
   equivalence proof (no integer lies in `(T//1000, T/1000]`, so no disposition
   moves) and names its three guarding tests. §I3, §I5, §I9 and new Rule 7 were
   amended in the same pass to match the F1/F3/F4 fixes — the invariants were
   silent about per-period figures, enumerated only two of six reporting
   surfaces, and said nothing about `ensure_views` having become a writer.

### External Review

Round 1 (`.codex-review-m27/m27code-1.*`) — resolved.
Round 2 (`.codex-review-m27/m27code-2.codex.last.txt`) — **CHANGES_REQUESTED,
five blockers, all five closed.** Per-finding mapping to changes, guarding tests
and mutation results: `.codex-review-m27/RESOLUTION-NOTES.md`, §Round 2
resolution map.

## Model Provenance

Implemented by a claude-opus-5 subagent under the coordinating session
(owner decision 2026-07-31, "Tolerance + flag"); gates independently re-run by
the coordinating session; external review via the codex bridge.

Round-2 remediation: the F1–F5 source fixes were written by a claude-opus-5
subagent that was interrupted twice before it could write the regression tests.
A second claude-opus-5 subagent verified all five fixes from disk, found the §I1
spec amendment outstanding and completed it, wrote the 18 regression tests, ran
the round-2 mutation set, and re-ran both gates. Nothing in this run was
committed, pushed, or branched.
