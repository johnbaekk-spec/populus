# RESOLUTION NOTES — B1 / KI-4

## Round 2 → Round 3 (external code review, 4 blockers / 2 nits)

Round 1 of the 3-round cap was consumed by an **operator-side 10-minute shell
timeout**, not by Codex — it was still reading the repository when killed and
never emitted a verdict. No findings came from it. Round 2 is the first
substantive round.

All six findings are addressed in one batched pass, per the batched-remediation
rule. Every fix below was reproduced before and verified after.

---

### F1 [BLOCKER] — persisted records rendered a measured 0%/100% for an unmeasurable population — **FIXED**

**Reproduced:** `_inst_absence_notice` emitted `coverage 0.00% (raw 0/100)` for a
withheld `cover_failed` record, and `coverage 100.00% (raw 10010001/10010001)`
for a withheld `not_measurable` record.

**Root cause:** `render_coverage_ratio` validates the *number*. A pre-fix record
can carry a perfectly in-range number describing a population that was never
measurable, so range-checking alone accepted it. This was the honesty defect
B1 exists to close, surviving at the one boundary the in-process guards cannot
reach — the value came off disk.

**Fix:** new `render_record_coverage(record)` in `src/populus/ingest/inst13f.py`
derives measurability from the record's own fields — `reason` (against
`_NOT_MEASURABLE_REASONS`), `certifiable`, `cover_failed_count`,
`cover_conflict_count`, and the raw sums — before delegating to
`render_coverage_ratio`. Missing fields are tolerated, so it never becomes
stricter than the evidence the record carries. `_inst_absence_notice`
(`src/populus/cli.py`) now calls it.

**Verified:** both reproductions render `unmeasurable`; a certifiable
below-threshold record still renders `98.53%` (no over-Noneing). Pinned by
mutants M18, M20, M21 and four tests.

---

### F2 [BLOCKER] — oversized JSON integer raised OverflowError — **FIXED**

**Reproduced:** `render_coverage_ratio(10**400)` raised
`OverflowError: int too large to convert to float`, turning a successful publish
notice into a traceback.

**Root cause:** `math.isfinite` coerces its argument to float, and it ran
*before* the range rejection. JSON decodes integers of unbounded magnitude.

**Fix:** integers are range-checked without float conversion (exact, never NaN);
`math.isfinite` now applies only to floats. Rendering extracted to
`_format_coverage_ratio` so both paths share one output contract.

**Verified:** `render_coverage_ratio(10**400)` and `-(10**400)` both return
`unmeasurable`. Pinned by mutant M19 and a test.

---

### F3 [BLOCKER] — R7 evidence absent; documentation made a false claim — **FIXED**

Two parts, both resolved:

**(a) The false claim.** `docs/build/M2-KNOWN-ISSUES.md` asserted "all 27
mutations killed" and "implemented and **mutation-verified**". **No mutant had
been run.** Corrected to the measured result, with the first run's failure
recorded rather than smoothed over.

**(b) The evidence now exists.**

*Red-first (T1):* the new tests were run against the pre-fix source (the five
changed source files restored to `HEAD`, tests kept). **24 tests fail**,
including all 6 new external-review regressions. Log:
`docs/build/RUN-B1-evidence/red-first-run.txt`.

*Mutation table (T6):* mutants executed via `docs/build/RUN-B1-evidence/mutation_table.py`.
**First run: 15/21 killed.** Four survivors were genuine test gaps — every
existing case carried more than one disqualifier, so deleting any single one
left another to catch it (the exact failure mode of memory
`mutation-tests-pin-properties`). Four tests were added, each isolating one
disqualifier:

| Survivor | Why it survived | Test added |
|---|---|---|
| M6 (float `raw <= 1.0` for the integer test) | no case had a quotient that rounds to exactly 1.0 | `test_a_marginal_overrun_at_float_scale_is_still_unmeasurable` — at 10^16, an over-run divides to exactly 1.0 |
| M8 (per-period over-run term) | every over-run period was also cover-failed | `test_period_coverage_is_none_for_an_overrun_period_with_no_other_defect` |
| M18 (record `reason` disqualifier) | every legacy record also failed a count/flag | `test_record_reason_alone_makes_it_unmeasurable` |
| M20 (record `certifiable` disqualifier) | same redundancy | `test_record_certifiable_false_alone_makes_it_unmeasurable` |

**Final: 19/21 killed, 2 proved EQUIVALENT.** M13 and M23 delete a
`math.isfinite` test that the `0 <= v <= 1` range check already subsumes —
demonstrated, not asserted: for NaN, +inf and −inf the guarded and unguarded
expressions return identical results, so no input distinguishes them. They are
unkillable by construction, not test gaps.

---

### F4 [BLOCKER] — `make accept-m2-5` neither run nor properly skipped — **FIXED (run, not skipped)**

The gate's own preflight named its missing inputs (seven `data-cache/13flist/`
files). Those exist in the main checkout; `data-cache/` is gitignored, so the
worktree had none. Linked and **the gate now runs: exit 0, ACCEPTANCE PASSED**
on the real Berkshire corpus — corpus-wide 796747370023/797063485143 = **0.9996**,
certifiable yes, inflated 0, meets_threshold yes, inst admitted to the published
manifest **on both rollout orders**.

This is also the strongest available R4 evidence: real periods still render
`0.9988` / `1.0000` / `1.0000` and the gate outcome is unchanged, so the fix
neither moves publishability nor over-`None`s genuine data.

---

### F5 [NIT] — dataclass guards admitted NaN, negatives, bools — **ADOPTED**

Both `__post_init__` guards now call a shared `_reject_non_proportion`, enforcing
the full domain (real, finite, non-bool, in `[0, 1]`). Pinned by M22 and a test.

### F6 [NIT] — overstated docstring — **ADOPTED**

The period docstring claimed corpus and period figures "cannot disagree about
measurability". Reworded to what is true: the two paths apply the same predicates
at their respective aggregation levels, and an over-run confined to one period
can be offset in the corpus sums while that period stays unmeasurable.

---

## Gate status after remediation

Re-run against a frozen tree — source hash `78a8c0bb13a360d6db5de94520de95fe228f20eb`
identical before and after, so these results describe exactly the code submitted.

| Gate | Result |
|---|---|
| `make test` | **1712 passed, 0 skipped** (445s). Was 1692 passed + 10 skipped; +10 new tests, and the 10 formerly-skipped now RUN because the M2-5 corpus is present |
| `make security` | 0 errors |
| `make accept-m2-6` | exit 0 |
| `make accept-m2-5` | **exit 0 — ACCEPTANCE PASSED** (was: not run) |
| red-first (T1) | 24 tests fail on pre-fix source |
| mutation table (T6) | **19/21 killed, 2 proved equivalent** |


---

## Round 3 → Round 4 (re-verification; owner explicitly authorized this round)

Round 3 returned **F1, F2, F4, F5, F6 = VERIFIED-FIXED**, F3 = PARTIALLY-FIXED,
and one **new blocker F7 — a regression introduced by the round-2 remediation
itself.** Both open findings are now closed.

### F7 [BLOCKER] — the F5 nit fix crashed a reachable input — **FIXED**

**The most important finding of the whole review.** The round-2 remediation of a
*NIT* (F5: tighten the construction guard to the full domain) turned a
**reachable** input into a crash: `_to_int` accepts a signed holding value, so a
negative numerator reaches `compute_coverage`. `HEAD` returned
`coverage=-0.1, certifiable=True, meets_threshold=False`; the tightened guard
raised `ValueError: coverage outside [0, 1] is not a proportion: -0.1`.

That is an **R4 violation caused by the lowest-severity finding in the batch** —
a computation that previously produced a record now aborts.

**Fix:** bound measurability from BELOW in both computations —
`coverage = raw if (certifiable and 0 <= numerator <= denominator) else None`,
and the same `0 <= numerator <= denominator` term per period. The out-of-domain
value therefore never reaches the guard, the guard keeps its full domain, and the
gate flags stay exactly as `HEAD` had them.

**Verified:** an end-to-end test (`test_a_signed_negative_holding_reports_
unmeasurable_instead_of_crashing`) ingests a real negative holding through the
pipeline and asserts `compute_coverage` and `compute_period_coverage` both return
a record with `coverage is None`, `certifiable is True`, `meets_threshold is
False`. Pinned by **two new mutants, M24 (corpus) and M25 (per-period), both
KILLED** — so the lower bound is provably load-bearing.

### F3 [BLOCKER] — evidence artifacts absent from disk — **FIXED**

The reviewer was right: the red-first log and mutation runner lived in an
operator scratchpad **outside the repository**, so they did not exist for anyone
else. They are now committed as re-runnable artifacts:

- `docs/build/RUN-B1-evidence/red-first-run.txt` — 24 tests red on pre-fix source
- `docs/build/RUN-B1-evidence/mutation_table.py` — the runner, repo-relative
- `docs/build/RUN-B1-evidence/mutation-outcomes.txt` — per-mutant outcomes

`DEV-NOTES.md` is reconciled to them: R7 now reads **MET**, Plan Deviations
records the closure (and the F7 regression) rather than claiming nothing went
wrong, and the stale core-rule snippet, test counts and changed-file list were
corrected against `git diff --stat` / `git status`.

**Final mutation result: 23 mutants, 21 KILLED, 2 proved EQUIVALENT** (M13/M23 —
the `0 <= v <= 1` range check subsumes `math.isfinite` for NaN and both
infinities; demonstrated, not asserted).

### Gate status (frozen tree `5729b7056824194e6af8258175d9a0c89463c415`, identical before and after)

| Gate | Result |
|---|---|
| `make test` | **1713 passed, 0 skipped** (419s) |
| `make security` | 0 errors |
| `make accept-m2-6` | exit 0 |
| `make accept-m2-5` | exit 0 — ACCEPTANCE PASSED |
| red-first (T1) | 24 tests fail on pre-fix source |
| mutation table (T6) | **21/23 killed, 2 proved equivalent** |

### Round accounting, stated honestly

The `code-review` phase reached its 3-round cap. This round runs under a **new
phase label (`code-review-b1-final`)** because the owner explicitly authorized
one more review after the fixes. No counter was reset and no prior round was
discarded — the earlier phase's state remains at 3/3.

---

## Final round → verification (F3 completeness + F8)

The prior round returned **F7 = VERIFIED-FIXED** (200-case HEAD/current sweep,
zero gate-flag mismatches) and F1/F2/F5/F6 unregressed. Two findings stayed open.

### F3 [BLOCKER] — the mutation table was not the APPROVED inventory — **FIXED**

The criticism was correct and is worth stating plainly: the runner **invented its
own IDs**, omitted approved rows (M10, M11, M12a–M12h, M14, M18), and reassigned
meanings to IDs `PLAN.md` had already defined. "21/23 killed" therefore did not
measure what the plan asked for.

`docs/build/RUN-B1-evidence/mutation_table.py` is rewritten to implement the
plan's inventory **verbatim** — M1–M18 with **M12a–M12h expanded to the eight
named render surfaces S1–S8** — with plan IDs authoritative and the
review-driven additions moved to a separate `R1–R9` namespace so the two can
never be conflated again. It is path-independent (`parents[3]`), runnable from
anywhere.

**Result: 35 mutants, 34 KILLED, 1 proved EQUIVALENT.**

Notable: all eight surface mutants (M12a–M12h) are killed, so every render
surface is independently pinned — the property the plan wanted and the earlier
table never checked. The plan's real M13 ("remove the range check") **is**
behaviour-changing and is killed; the earlier runner had mutated the other half
of that condition and mislabelled the result as equivalent.

The lone survivor **R7** is proved equivalent: deleting the `math.isfinite` raise
leaves `0 <= value <= 1` to reject NaN and both infinities, so only the exception
*message* changes. Proof recorded in `mutation-outcomes.txt`.

**Dev Notes reconciled.** The reviewer found three internal contradictions —
`1713/0` vs `1692/10`, "both acceptances passed" vs "`accept-m2-5` NOT RUN", and
`32` vs `21` new tests — caused by updating the summary table while leaving the
detail sections stale. Every gate row, hash, count and mutation statement is now
read from git and the actual runs.

### F8 [NIT] — stale 19/21 in `M2-KNOWN-ISSUES.md` — **FIXED**

Updated to 34/35 with the scope stated (approved inventory + review additions)
and a pointer to the artifacts.

### Gate status (frozen tree `5729b7056824194e6af8258175d9a0c89463c415`, identical before and after)

| Gate | Result |
|---|---|
| `make test` | **1713 passed, 0 skipped** |
| `make security` | 0 errors |
| `make accept-m2-6` | exit 0 |
| `make accept-m2-5` | exit 0 — ACCEPTANCE PASSED |
| red-first (T1) | 24 tests fail on pre-fix source |
| mutation table (T6) | **34/35 killed, 1 proved equivalent** |

No source or test file changed in this pass — only the mutation runner, its
outcomes, and the three documents. The tree hash is therefore unchanged from the
round that verified F7.


---

## Verification round 2 → 3 (F3 completeness, final)

F8 verified fixed. F3 was still PARTIALLY-FIXED, correctly: a row-by-row
comparison found **four approved mutants implementing different mutations than
the plan's rows**, and both evidence documents still carried contradictory
statements. All are now closed.

### The four mis-implemented approved meanings — **FIXED**

| ID | Plan's meaning | What the runner did | Now |
|---|---|---|---|
| M3 | reported coverage `= 99.0` (the KI-4 named miss) | used `0.99` — an *in-range* value, a strictly weaker mutation | `99.0`; KILLED |
| M8 | per-period rule → **unconditional** ratio | deleted only the lower bound | fully unconditional; KILLED |
| M10 | zero out `numerator` **and** `denominator` | zeroed only the numerator | both; KILLED |
| M14 | remove the **finite/type** check (NaN, inf, bool, str) | removed only the type/bool half | split into M14 (type, KILLED) and M14b (finite, EQUIVALENT) |

M14 is reported as a split rather than a single result because only its type
half is killable. Reporting the killed half alone would overstate the evidence.

### Final: 36 mutants — 34 KILLED, 2 PROVED EQUIVALENT, 0 unexplained survivors

Both survivors (M14b, R7) are one equivalence class: the `0 <= value <= 1` range
check subsumes `math.isfinite`, since every NaN comparison is False and both
infinities fall outside [0, 1]. Proved across the float domain in
`mutation-outcomes.txt`, not asserted. **Recorded consequence:** those
`math.isfinite` calls are redundant defence-in-depth. They are deliberately kept
— they document intent and survive a future edit that widens the range check —
but the range check is what enforces the domain. The plan's M13 (remove the
*range* check, keep isfinite) is the mirror image, is behaviour-changing, and is
KILLED.

### Evidence documents reconciled — **FIXED**

The reviewer's grep found `R7 is NOT met`, `No mutation coverage`,
`accept-m2-5 unrun` and `mutation table … was never executed` still standing
beside current 36-mutant and four-gate-pass claims. Every one is now either
corrected or explicitly marked closed with its evidence. Statements that are
deliberately preserved as history (the original text of closed findings) are
labelled as such, so no reader can mistake them for current status.

No source or test file changed in this pass — tree hash unchanged.
