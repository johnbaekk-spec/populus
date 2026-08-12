# RUN M2-11 — T0 findings (R11 ladder vs snapshot v1)

Measured 2026-08-08 against `Populus-ops/snapshots/inst-source-v1.db`
(23 GB, sealed 0444, `journal_mode=delete`, cut 19:09).

Recorded because the previous T0 run was killed and left **no evidence
artifact**, so every finding below had to be re-derived from scratch.

## Corpus (measured, snapshot v1)

| filers | filings | holdings | periods | reported filers |
|--------|---------|----------|---------|-----------------|
| 9,458  | 46,081  | 16,922,879 | 6     | 9,451           |

## Root cause: `compute_period_coverage` numerator

`compute_period_coverage`'s numerator differs from `compute_coverage`'s by one
clause — `GROUP BY period_of_report`. That clause flips the join order and
turns a 0.25 s query into one that does not complete.

Control, on a 50-filer pilot (239 filings, 549,650 holdings):

| query | outer driver | cascade evaluations | time |
|-------|--------------|---------------------|------|
| numerator, ungrouped (`compute_coverage`) | `SCAN f` (filings) | 239 | **0.25 s** |
| numerator, grouped (`compute_period_coverage`) | `SEARCH h USING INDEX inst_holdings_by_security` | 549,650 | **>240 s, aborted** |

Same data, same view, same `WHERE`. Grouped drives from **holdings**, so the
amendment-reconciliation cascade inside `v_default_inst_filings` — correlated
scalar subqueries 6/7/9/10, including a `json_each` virtual-table scan in
subquery 9 — re-evaluates once per holding row instead of once per filing.
A ~2,300x increase in subquery evaluations at this pilot size; it scales with
holdings-per-filing, so it worsens on the full corpus.

This is why the live T0 run sat 2h+ in the pre-aggregate phase on a 500-filer
pilot without ever reaching `build_inst_agg`.

## Fix: materialize `v_default_inst_filings`

Replacing the view with a table of the same name and contents, plus an index on
`filing_id`:

| | time |
|---|---|
| grouped numerator, view | >240 s (aborted) |
| grouped numerator, materialized | **0.48 s** |

Plan collapses to `SEARCH f USING COVERING INDEX v_default_inst_filings_by_filing
(filing_id=?)` — the cascade disappears. Materializing cost **0.14 s** for 233
default filings; 2.0 s for 2,462 on a 500-filer pilot.

**Exact parity** verified on all seven `compute_coverage` outputs (denominator,
numerator, `cover_failed_count`, `inflated_filing_count`, `coverage`,
`certifiable`, `meets_threshold`) — byte-identical via view and via table.

## Derivation namespace correction: the dependent view must also be TEMP

The initial handover design said that a TEMP table named
`v_default_inst_filings` would automatically accelerate the persistent
`v_default_holdings` view. That is false in SQLite: a persistent-schema view
continues to resolve persistent-schema objects and does not rebind its internal
reference to a same-named TEMP object. A minimal control returned the TEMP row
from a direct `SELECT * FROM v_default_inst_filings` while the persistent
dependent view still returned the main-schema row.

The derive-side design therefore needs both:

1. a TEMP table `v_default_inst_filings`, populated from
   `main.v_default_inst_filings`, with an index on `filing_id`; and
2. a TEMP view `v_default_holdings`, created from the packaged view definition,
   so its join resolves the TEMP filing table. The TEMP pair shadows the
   persistent pair for unqualified production queries without changing the
   snapshot or its stored view definitions.

Measured 2026-08-09 on the recovered 500-filer pilot (2,462 default filings,
3.55M holdings), opened `mode=ro` and bounded by a 180-second SQLite progress
handler:

| probe | result |
|---|---|
| TEMP table + filing index + TEMP holdings view | **4.0 s** |
| grouped numerator plan | `SEARCH h USING INDEX inst_holdings_by_security` + `SEARCH f USING COVERING INDEX v_default_inst_filings_by_filing`; **zero amendment-cascade subqueries** |
| full `compute_period_coverage` | **15.5 s**, 6 rows |

The per-period denominator still contains its one intentional, index-served
correlated holdings sum from `_DENOMINATOR_TERM`; that is not the eliminated
amendment-reconciliation cascade. The grouped numerator is the path that
previously expanded the cascade once per holding row.

## Ruled out, with evidence

- **R13 index remedy on the correlated subqueries** — no-op. Every correlated
  subquery is already index-served (`SEARCH … USING INDEX`); none shows `SCAN`.
- **An index serving the 16.9M-row `ORDER BY`** — no-op *through the view*. An
  index on `inst_holdings (cik, period_of_report, holding_id)` removes the temp
  b-tree on the **base table**, but the aggregation plan is byte-identical with
  and without it, because the view forces filings-outer join order. Tested on a
  500-filer / 3.55M-row pilot.
- **`ANALYZE`** — changed no plan. Snapshot v1 carries no `sqlite_stat%` table.
- **Streaming the holdings pass per filer** — 1.11x (10.2 s vs 11.3 s), exact
  row parity (3,364,062 both ways). The holdings pass was never the problem:
  it does 3.55M rows in 11.3 s.

**No snapshot v2 is required.** Every remedy that helps is derive-side.

## Open

- The fix touches the M2 >=95% coverage gate and the F8 non-inflation invariant.
  It needs exact-parity tests against the current implementation before landing,
  not just the ad-hoc parity check above.
- T0 has not produced the R12 (<=1.5 GiB) branch decision — it never reached
  `build_inst_agg`. That number is still unmeasured.
- T0 was run without `--build-date`, so its serialization figures will be the
  widest valid (conservative), not the real nightly window.

## Binding T0-v2 result (2026-08-09): STOP at materialization bound

The approved delta implementation and its tests passed the targeted adjunct
(`98 passed`) and all six canonical commands before this run:

| command | status |
|---|---:|
| `make check` | 0 (`2458 passed, 8 skipped`; Astro check clean; 264 dashboard unit tests; 8,106-page build; 50 post-build tests; dependency guard OK) |
| `make accept-m1-b` | 0 |
| `make accept-m2-5` | 0 |
| `make accept-m2-6` | 0 |
| `make accept-m2-8` | 0 |
| `make accept-m2-11` | 0 |

The binding command was then run unbuffered with `--measured-files 8106`,
`--pilot-filers 500`, and `--full`, deliberately omitting `--build-date`.
Its retained evidence is:

- path:
  `/Users/johnbaek/projects/Populus-ops/snapshots/evidence/m2-11/T0-v2.log`
- SHA-256:
  `c8361bc50243538f2e014140c5e39c2079a56fdbb0e12043674c12abf77a0334`
- size: 57,002 bytes / 89 lines
- process status: **exit 4**
- serialization statement: `WIDEST valid FilingWindow (--build-date intentionally omitted)`

The preflight rungs completed and repeated the corpus counts above. Resources
were 153.0 GiB free disk and 34.8 GiB free RAM. The baseline EXPLAIN output in
the log is over the exact four production coverage statements. In particular,
the grouped numerator again drives from
`SEARCH h USING INDEX inst_holdings_by_security` and expands correlated
subqueries 6/7/9/10, including the `json_each` virtual-table scan.

The next rung attempted the full-snapshot TEMP filing materialization. SQLite
interrupted it at the configured **180-second SQLite execution bound**:

```text
STOP: SQLite execution bound (180s) interrupted phase materialization; later phases suppressed
```

This is a new real-path result relative to the recovered 500-filer pilot: the
approved CTAS does not finish inside the locked bound on all 9,458 filers. No
materialized EXPLAIN, pilot, coverage, period coverage, aggregate, serving,
peak-RSS, aggregate-byte, tail-geometry, or R12 record was produced because
the runner correctly suppressed every later phase.

### D1 immutability evidence

The runner emitted both complete D1 JSON states in the retained log (lines 87
and 88). They are identical:

- whole-file SHA-256 (pre and post):
  `977a4d249d92590a4de2961a3e9c7ff8cfa2e4846f0097ec7aa6c07f28124121`
- ordered `main.sqlite_schema`: the same 51 complete rows pre and post
- `-journal`: `false` pre and post
- `-wal`: `false` pre and post
- `-shm`: `false` pre and post
- comparison: `snapshot_immutability: PASS`

Snapshot v1 remains 0444 and sidecar-free. D1 did not override exit 4 because
no immutable state changed.

### Decision

Per D10/D-T11, a SQLite phase timeout is a mandatory stop for a new
owner-reviewed delta. R12 remains **unmeasured**, so the no-compression branch
is not locked and the parent plan's Phase D is not authorized. No alternate
materialization, source index, timeout increase, or other remedy was attempted
during or after this binding run.

## Binding T0-v3 result (2026-08-09): materialization fixed; STOP at serving bound

The approved affiliation-index delta passed its final targeted adjunct and all
six canonical commands before the binding run:

| command | status |
|---|---:|
| targeted six-module pytest adjunct | 0 (`210 passed`) |
| `make check` | 0 (`2472 passed, 8 skipped`; Astro check clean; 264 dashboard unit tests; 8,106-page build; 50 post-build tests; dependency guard OK) |
| `make accept-m1-b` | 0 |
| `make accept-m2-5` | 0 |
| `make accept-m2-6` | 0 |
| `make accept-m2-8` | 0 |
| `make accept-m2-11` | 0 |

`git diff --check` also exited 0. The binding command was then run exactly as
approved: unbuffered, with `--measured-files 8106`, `--pilot-filers 500`, and
`--full`, deliberately omitting `--build-date`. Its retained evidence is:

- path:
  `/Users/johnbaek/projects/Populus-ops/snapshots/evidence/m2-11/T0-v3.log`
- SHA-256:
  `4639c143b8838b87bbd524e3435ee665cd253c1cdd573d5ffdecdc98934a2650`
- size: 58,779 bytes / 127 lines
- process status: **exit 4**
- serialization statement: `WIDEST valid FilingWindow (--build-date intentionally omitted)`

The preflight rungs again reported 9,458 filers, 46,081 filings, 16,922,879
holdings, 6 periods, and 9,451 reported filers. The projected worst-case site
file count was 12,094 from the measured 8,106-file tree. Resources were 152.2
GiB free disk and 28.1 GiB free RAM.

The full-snapshot staged affiliation materialization completed in **3.701 s**.
Its exact-query EXPLAIN confirms that the default holdings, coverage numerator,
and period-coverage numerator use the covering
`v_default_inst_filings_by_filing` index and no longer expand the prior
period-wide affiliation `json_each` cascade. This resolves the T0-v2
materialization stop.

The 500-filer pilot then reached the `serving` phase, where SQLite interrupted
execution at the unchanged **180-second bound**:

```text
STOP: SQLite execution bound (180s) interrupted phase serving; later phases suppressed
```

Because `derive_once` raises before returning its record, the runner correctly
did not emit partial pilot coverage, period-coverage, aggregate, or serving
timings. It likewise emitted no full-corpus timings, peak RSS, aggregate-byte
measurement, serving row count, R12 branch, or tail geometry. Those values are
unavailable, not zero. The diagnostic EXPLAIN shows that the reported-filing
queries used by aggregate/serving still contain their packaged restatement and
cover subqueries; that is a lead for the next delta, not proof of which inner
serving statement consumed the bound.

### D1 immutability evidence

The retained log contains both complete D1 JSON states (lines 125 and 126).
They compare byte-for-byte equal and report:

- whole-file SHA-256 (pre and post):
  `977a4d249d92590a4de2961a3e9c7ff8cfa2e4846f0097ec7aa6c07f28124121`
- ordered `main.sqlite_schema`: the same 51 complete rows pre and post
- `-journal`: `false` pre and post
- `-wal`: `false` pre and post
- `-shm`: `false` pre and post
- comparison: `snapshot_immutability: PASS`

Snapshot v1 remains 23,058,628,608 bytes, 0444, and sidecar-free. D1 did not
override exit 4 because no immutable state changed.

### Decision

Per A12/A-T9, this new later-phase timeout is a mandatory stop for another
owner-reviewed delta. The current delta may not raise the timeout, change
semantics, add a snapshot index, create snapshot v2, optimize serving, or enter
Phase D/QA. R12 remains **unmeasured**, so the no-compression branch is still not
locked. No post-STOP remedy was attempted.

## Binding T0-v4 result (2026-08-10): serving materialization fixed; STOP at full coverage bound

The serving-materialization delta was governed by the independently approved
`RUN-M2-11-T0-serving-materialization-delta-plan.md` (approved-plan SHA-256
`04b385929058efd485f73bfdef19fad02edba00d343d647267b37045b7959979`).
Plan review approved it in round 1 with no findings. The implementation passed
its final targeted adjunct and all six canonical commands before the binding
run:

| command | status |
|---|---:|
| targeted seven-module pytest adjunct | 0 (`248 passed`) |
| `make check` | 0 (`2479 passed, 8 skipped`; Astro check clean; 264 dashboard unit tests; 8,106-page build; 50 post-build tests; dependency guard OK) |
| `make accept-m1-b` | 0 |
| `make accept-m2-5` | 0 |
| `make accept-m2-6` | 0 |
| `make accept-m2-8` | 0 |
| `make accept-m2-11` | 0 |

`git diff --check` also exited 0. The binding command was then run exactly as
approved: unbuffered, with `--measured-files 8106`, `--pilot-filers 500`, and
`--full`, deliberately omitting `--build-date`. Its retained evidence is:

- path:
  `/Users/johnbaek/projects/Populus-ops/snapshots/evidence/m2-11/T0-v4.log`
- SHA-256:
  `d84afcc9c156c50432d6435b8d4aefd1aef5e5d4294037ab3a5dab84df8a5d60`
- size: 59,136 bytes / 121 lines
- process status: **exit 4**
- serialization statement: `WIDEST valid FilingWindow (--build-date intentionally omitted)`

The preflight rungs again reported 9,458 filers, 46,081 filings, 16,922,879
holdings, 6 periods, and 9,451 reported filers. The projected worst-case site
file count was 12,094 from the measured 8,106-file tree. Resources were 147.3
GiB free disk and 33.8 GiB free RAM.

The full-snapshot serving materialization diagnostic completed in **3.867 s**.
The exact-query EXPLAIN confirms that aggregate and serving now scan the frozen
TEMP reported-filing table instead of executing the packaged correlated
reported-filing chain. This resolves the T0-v3 serving timeout.

The 500-filer pilot completed all measured phases successfully:

- materialization: 8.577 s
- coverage: 14.357 s
- period coverage: 8.217 s (6 rows)
- aggregate: 42.171 s (742,412 filer rows; 456,146,944 bytes)
- serving projection: 17.273 s
- coverage ratio: 0.9983215071852559
- peak RSS: 3,920,052,224 bytes
- threshold and headroom checks: PASS (`meets_threshold: true`; projected
  headroom 6,162 files; all tail payloads absent)

The full-corpus run then reached the `coverage` phase, where SQLite interrupted
execution at the unchanged **180-second bound**:

```text
STOP: SQLite execution bound (180s) interrupted phase coverage; later phases suppressed
```

Because `derive_once` raises before returning its record, the runner correctly
did not emit a partial full-corpus record. Full-corpus materialization,
coverage, period-coverage, aggregate, and serving timings; peak RSS;
aggregate-byte measurement; serving row count; R12 branch; and tail geometry
are therefore unavailable, not zero. The separate full-snapshot diagnostic
materialization time of 3.867 s remains valid evidence, but is not substituted
for the missing `derive_once` value.

### D1 immutability evidence

The retained log contains both complete D1 JSON states (lines 119 and 120).
Their normalized JSON representations compare equal and report:

- whole-file SHA-256 (pre and post):
  `977a4d249d92590a4de2961a3e9c7ff8cfa2e4846f0097ec7aa6c07f28124121`
- ordered `main.sqlite_schema`: the same 51 complete rows pre and post
- `-journal`: `false` pre and post
- `-wal`: `false` pre and post
- `-shm`: `false` pre and post
- comparison: `snapshot_immutability: PASS`

Snapshot v1 remains 23,058,628,608 bytes, 0444, and sidecar-free. D1 did not
override exit 4 because no immutable state changed.

### Decision

Per the approved plan's B12 mandatory-stop rule, this new later-phase timeout
requires another owner-reviewed delta. This delta may not raise the timeout,
change semantics, add a snapshot index, create snapshot v2, optimize full
coverage, or enter QA. R12 remains **unmeasured**, so the no-compression branch
is still not locked. QA review rounds used: **0 of 3**. No post-STOP remedy was
attempted.

## Binding T0-v5 result (2026-08-10): coverage totals fixed; STOP at full aggregate bound

The coverage-totals delta was governed by the independently approved
`RUN-M2-11-T0-coverage-totals-delta-plan.md` (approved-plan SHA-256
`2fbded25f34ef40744d7aeb000d2afc5b02851ef35d91b133665b84b8fc80071`).
Plan review approved it in round 2 after the implementation owner corrected
the round-1 exact-query matrix finding for the intentionally retained
`json_each(flags)` cover-failed statement. The implementation passed its
focused and targeted adjuncts and all six canonical commands before the
binding run:

| command | status |
|---|---:|
| focused three-module pytest adjunct | 0 (`136 passed`) |
| targeted eight-module pytest adjunct | 0 (`478 passed`) |
| `make check` | 0 (`2496 passed, 8 skipped`; Astro check clean; 264 dashboard unit tests; 8,106-page build; 50 post-build tests; dependency guard OK) |
| `make accept-m1-b` | 0 |
| `make accept-m2-5` | 0 |
| `make accept-m2-6` | 0 |
| `make accept-m2-8` | 0 |
| `make accept-m2-11` | 0 |

`git diff --check` also exited 0. The binding command was then run exactly as
approved: unbuffered, with `--measured-files 8106`, `--pilot-filers 500`, and
`--full`, deliberately omitting `--build-date`. Its retained evidence is:

- path:
  `/Users/johnbaek/projects/Populus-ops/snapshots/evidence/m2-11/T0-v5.log`
- SHA-256:
  `b3900103b66ca2b7aa694722050f355f171e3aebc1c56a4be87dbd48e2c18b39`
- size: 61,553 bytes / 167 lines
- process status: **exit 4**
- serialization statement: `WIDEST valid FilingWindow (--build-date intentionally omitted)`

The preflight rungs again reported 9,458 filers, 46,081 filings, 16,922,879
holdings, 6 periods, and 9,451 reported filers. The projected worst-case site
file count was 12,094 from the measured 8,106-file tree. Resources were 147.7
GiB free disk and 22.6 GiB free RAM.

The full-snapshot reconciled-filings and coverage-totals diagnostic
materialization completed in **50.767 s**. The exact-query EXPLAIN confirms
that the corpus-wide denominator and numerator, both per-period coverage
statements, and both disposition scopes use
`_populus_inst_coverage_totals_by_filing`. None of those six plans scans
`inst_holdings`, uses a correlated subquery, or uses `json_each`. The separate
cover-failed statement intentionally retains `json_each(flags)`, as required
by the approved plan. This resolves the T0-v4 full-coverage timeout.

The 500-filer pilot completed all measured phases successfully:

- materialization: 22.950 s
- coverage: 0.010 s
- period coverage: 0.171 s (6 rows)
- aggregate: 53.058 s (742,412 filer rows; 456,146,944 bytes)
- serving projection: 22.995 s
- coverage ratio: 0.9983215071852559
- peak RSS: 3,915,038,720 bytes
- threshold and headroom checks: PASS (`meets_threshold: true`; projected
  headroom 6,162 files; all tail payloads absent)

The full-corpus run advanced through coverage and period coverage, then
reached the `aggregate` phase, where SQLite interrupted execution at the
unchanged **180-second bound**:

```text
STOP: SQLite execution bound (180s) interrupted phase aggregate; later phases suppressed
```

Because `derive_once` raises before returning its record, the runner correctly
did not emit a partial full-corpus record. Full-corpus materialization,
coverage, period-coverage, aggregate, and serving timings; peak RSS;
aggregate-byte measurement; serving row count; R12 branch; and tail geometry
are therefore unavailable, not zero. The separate 50.767-second diagnostic
materialization remains valid evidence, but is not substituted for the missing
`derive_once` value.

### D1 immutability evidence

The retained log contains both complete D1 JSON states (lines 165 and 166).
Their normalized JSON representations compare equal and report:

- whole-file SHA-256 (pre and post):
  `977a4d249d92590a4de2961a3e9c7ff8cfa2e4846f0097ec7aa6c07f28124121`
- ordered `main.sqlite_schema`: the same 51 complete rows pre and post
- `-journal`: `false` pre and post
- `-wal`: `false` pre and post
- `-shm`: `false` pre and post
- comparison: `snapshot_immutability: PASS`

Snapshot v1 remains 23,058,628,608 bytes, 0444, and sidecar-free. D1 did not
override exit 4 because no immutable state changed.

### Decision

Per the approved plan's B12 mandatory-stop rule, this new later-phase timeout
requires another owner-reviewed delta. This delta may not raise the timeout,
change semantics, add a snapshot index, create snapshot v2, optimize full
aggregation, or enter QA. R12 remains **unmeasured**, so the no-compression
branch is still not locked. QA review rounds used: **0 of 3**. No post-STOP
remedy was attempted.

## Binding T0-v6 result (2026-08-10): aggregate path fixed; STOP at repeated full materialization bound

The aggregate-performance delta was governed by the independently approved
`RUN-M2-11-T0-aggregate-performance-delta-plan.md` (approved-plan SHA-256
`2465e7bff8a4f8070c0bd0b60e5bfc15a0f422bf61907bd896b81ca14099f8a3`).
Plan review approved it in the owner-authorized exceptional round 4 after the
implementation owner corrected the earlier Python-callback lifecycle,
signed-integer cancellation, and signed-share eligibility findings. The final
read-only review confirmed the two-field sign gate, guarded seven-limb share
stage, exact carry/range checks, fallback timing, and full requirement
propagation.

Implementation verification completed before the binding run:

| command | status |
|---|---:|
| materializer-focused pytest adjunct | 0 (`47 passed`) |
| initial affected-module pytest adjunct | 0 (`185 passed`) |
| full `tests/test_inst_agg.py` | 0 (`43 passed`) |
| targeted eight-module pytest adjunct | 0 (`458 passed`) |
| `make check` | 0 (Python suite; Astro check; 8,106-page build; 50/50 post-build tests; dependency guard OK) |
| `make accept-m1-b` | 0 |
| `make accept-m2-5` | 0 |
| `make accept-m2-6` | 0 |
| `make accept-m2-8` | 0 |
| `make accept-m2-11` | 0 |

`git diff --check` also exited 0. The binding command was then run exactly as
approved: unbuffered, with `--measured-files 8106`, `--pilot-filers 500`, and
`--full`, deliberately omitting `--build-date`. Its retained evidence is:

- path:
  `/Users/johnbaek/projects/Populus-ops/snapshots/evidence/m2-11/T0-v6.log`
- SHA-256:
  `f0893c15529e273d7edbcb0ef62e1f3babdabe1bdc651a83d11365e26bb15274`
- size: 61,517 bytes / 168 lines
- process status: **exit 4**
- serialization statement: `WIDEST valid FilingWindow (--build-date intentionally omitted)`

The preflight rungs reported 9,458 filers, 46,081 filings, 16,922,879
holdings, 6 periods, and 9,451 reported filers. The projected worst-case site
file count was 12,094 from the measured 8,106-file tree. Resources were 148.9
GiB free disk and 22.6 GiB free RAM.

The separate full-snapshot diagnostic materialization completed in
**139.142 s**, inside the unchanged 180-second bound. Its exact-query EXPLAIN
shows the serving registry using the materialized filer rows; the aggregate
sign preflight scanning `_populus_inst_agg_input`; aggregate positions using
one grouped scan of that input; and coverage/disposition statements using the
indexed coverage-totals cache. The intentionally exact cover-failed statement
continues to use `json_each(flags)`.

The 500-filer pilot completed every measured phase successfully:

- materialization: 90.560 s
- coverage: 0.066 s
- period coverage: 0.315 s (6 rows)
- aggregate: 61.130 s (742,412 filer rows; 459,923,456 bytes)
- serving projection: 33.855 s
- coverage ratio: 0.9983215071852559
- peak RSS: 2,165,686,272 bytes
- threshold and headroom checks: PASS (`meets_threshold: true`; projected
  headroom 6,162 files; all tail payloads absent)

The certifying full-corpus run then reached its first `materialization` phase,
where SQLite interrupted execution at the unchanged **180-second bound**:

```text
STOP: SQLite execution bound (180s) interrupted phase materialization; later phases suppressed
```

This is a new repeatability/stability failure: the same binding process's
diagnostic full-snapshot materialization completed in 139.142 s, while the
subsequent certifying full materialization did not complete within 180 s.
Because `derive_once` raises before returning its record, the runner correctly
did not emit a partial full-corpus record. Full-corpus materialization,
coverage, period-coverage, aggregate, and serving timings; peak RSS;
aggregate-byte measurement; serving row count; R12 branch; and tail geometry
are unavailable, not zero. The diagnostic and pilot measurements remain valid
evidence but are not substituted for the missing full-corpus record.

### D1 immutability evidence

The retained log contains both complete D1 JSON states (lines 166 and 167).
Their normalized JSON representations compare equal and report:

- whole-file SHA-256 (pre and post):
  `977a4d249d92590a4de2961a3e9c7ff8cfa2e4846f0097ec7aa6c07f28124121`
- ordered `main.sqlite_schema`: the same 51 complete rows pre and post
- `-journal`: `false` pre and post
- `-wal`: `false` pre and post
- `-shm`: `false` pre and post
- comparison: `snapshot_immutability: PASS`

Snapshot v1 remains 23,058,628,608 bytes, 0444, and sidecar-free. D1 did not
override exit 4 because no immutable state changed.

### Decision

Per the approved plan's mandatory-stop rule, the exit-4 binding result ends
this delta before QA. No retry, timeout increase, semantic relaxation,
snapshot index, snapshot-v2 change, or post-STOP performance remedy was
attempted. R12 remains **unmeasured**, so the no-compression branch is not
locked. QA review rounds used: **0 of 3**. Any next remedy requires a new
owner-reviewed delta that addresses the repeated full-materialization bound.

## Binding T0-v7 result (2026-08-10): full namespace reused; STOP at full aggregate bound

The repeated-materialization delta was governed by the independently approved
`RUN-M2-11-T0-materialization-reuse-delta-plan.md` (approved-plan SHA-256
`232bdb66d5ef3e21054b252a8d26e3ddf06edfffad044d0c68216090f4dbbcf1`).
Plan review approved the final timeout-nesting revision in round 2. The reviewed
sequence retained one full connection, transaction, and materialized TEMP
namespace from rung (iv) through rung (vi), while keeping the pilot independent.

Implementation verification completed before the binding run:

| command | status |
|---|---:|
| focused `tests/test_inst_snapshot_script.py` | 0 (`49 passed`) |
| targeted eight-module pytest adjunct | 0 (`467 passed`) |
| `git diff --check` | 0 |
| `make check` | 0 (`2515 passed, 8 skipped`; Astro check; 264/264 dashboard tests; 8,106-page build; 50/50 post-build tests; dependency guard OK) |
| `make accept-m1-b` | 0 |
| `make accept-m2-5` | 0 |
| `make accept-m2-6` | 0 |
| `make accept-m2-8` | 0 |
| `make accept-m2-11` | 0 |

The binding command was run exactly once as approved: unbuffered, with
`--measured-files 8106`, `--pilot-filers 500`, and `--full`, deliberately
omitting `--build-date`. Its retained evidence is:

- path:
  `/Users/johnbaek/projects/Populus-ops/snapshots/evidence/m2-11/T0-v7.log`
- SHA-256:
  `4fcc42ac20934b2d4e72d6642e1f1e7ab0ed683942563734420ce3c08969f014`
- size: 61,570 bytes / 169 lines
- process status: **exit 4**
- serialization statement: `WIDEST valid FilingWindow (--build-date intentionally omitted)`

The preflight rungs reported 9,458 filers, 46,081 filings, 16,922,879
holdings, 6 periods, and 9,451 reported filers. The projected worst-case site
file count was 12,094 from the measured 8,106-file tree. Resources were 112.1
GiB free disk and 24.7 GiB free RAM.

The full-snapshot namespace materialized exactly once in **44.422 s** and its
materialized EXPLAIN completed under the same unchanged 180-second guard. Rung
(vi) then emitted the exact reviewed reuse evidence:

```text
(vi) materialization reuse: rung (iv) 44.422s; no rebuild
```

No second full materialization occurred. The 500-filer pilot remained
independent and completed every measured phase successfully:

- materialization: 18.277 s
- coverage: 0.018 s
- period coverage: 0.155 s (6 rows)
- aggregate: 47.568 s (742,412 filer rows; 459,923,456 bytes)
- serving projection: 20.484 s
- coverage ratio: 0.9983215071852559
- peak RSS: 2,175,156,224 bytes
- threshold and headroom checks: PASS (`meets_threshold: true`; projected
  headroom 6,162 files; all tail payloads absent)

The certifying full-corpus derivation reused the retained namespace and advanced
to its `aggregate` phase. That phase did not complete within the unchanged
**180-second bound**:

```text
STOP: SQLite execution bound (180s) interrupted phase aggregate; later phases suppressed
```

Because the shared derivation helper raises before returning its record, the
runner correctly emitted no partial full-corpus JSON. Full coverage and
period-coverage timings, aggregate output/bytes, serving timing/rows, peak RSS,
R12 branch, and tail geometry are unavailable, not zero. Rung-(iv)'s exact
44.422-second materialization and the pilot record remain valid evidence but are
not substituted for the missing full-corpus result.

### D1 immutability evidence

The retained log contains both complete D1 JSON states (lines 167 and 168).
Their normalized JSON representations compare equal and report:

- whole-file SHA-256 (pre and post):
  `977a4d249d92590a4de2961a3e9c7ff8cfa2e4846f0097ec7aa6c07f28124121`
- ordered `main.sqlite_schema`: the same 51 complete rows pre and post
- `-journal`: `false` pre and post
- `-wal`: `false` pre and post
- `-shm`: `false` pre and post
- comparison: `snapshot_immutability: PASS` (line 169)

An independent post-run check reconfirmed that snapshot v1 remains
23,058,628,608 bytes, mode 0444, exact SHA-256, and sidecar-free. D1 did not
override exit 4 because no immutable state changed.

### Decision

Per the approved plan's mandatory-stop rule, this exit-4 binding result ends the
delta before QA. The lifecycle defect is resolved, but the full aggregate itself
now has a measured bound failure. No retry, timeout increase, semantic change,
snapshot/index change, compression step, or post-STOP remedy was attempted. R12
remains **unmeasured**, so the no-compression branch is not locked. QA review
rounds used: **0 of 3**. Any next remedy requires a new owner-reviewed delta that
addresses full-corpus aggregate execution within the existing bound.

## Binding T0-v8 result (2026-08-10): aggregate pilot improved; STOP at full aggregate bound

The aggregate-throughput delta was governed by the independently approved
`RUN-M2-11-T0-aggregate-throughput-delta-plan.md` (approved-plan SHA-256
`2b06c4be04b928ab455698ea2356b0e35728135f5841951a014bfac482268b8c`).
Plan review approved the final command and memory-evidence revisions in round
2. The reviewed implementation introduced SQL-native QoQ classification,
shared raw-period statistics, a direct final-holder issuer stage, combined
concentration reductions, temporary-cache scoping, and fresh-destination page
and cache geometry without changing the 180-second phase bound.

The final implementation inputs to the binding run were:

- `src/populus/inst_agg.py` SHA-256:
  `5870618866ca3682f88dd62e61f8599db47f96c77cff748e3c775e334c323a34`
- `tests/test_inst_agg.py` SHA-256:
  `109250a4846be3ba828e14c76a41d49bc4bd878bf121ca4a8bc4dd50cb24a0ce`

Implementation verification completed before the binding run:

| command | status |
|---|---:|
| focused `tests/test_inst_agg.py` | 0 (`44 passed`) |
| targeted eight-module pytest adjunct | 0 (`468 passed`) |
| `git diff --check` | 0 |
| `make check` | 0 (`2516 passed, 8 skipped`; Astro check; 264/264 dashboard tests; 8,106-page build; 50/50 post-build tests; dependency guard OK) |
| `make accept-m1-b` | 0 |
| `make accept-m2-5` | 0 |
| `make accept-m2-6` | 0 |
| `make accept-m2-8` | 0 |
| `make accept-m2-11` | 0 |

The binding command was run exactly once as approved: unbuffered, with
`--measured-files 8106`, `--pilot-filers 500`, and `--full`, deliberately
omitting `--build-date`:

```text
PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1 .venv/bin/python scripts/measure_inst_derive.py --snapshot /Users/johnbaek/projects/Populus-ops/snapshots/inst-source-v1.db --measured-files 8106 --pilot-filers 500 --full > /Users/johnbaek/projects/Populus-ops/snapshots/evidence/m2-11/T0-v8.log 2>&1
```

Its retained evidence is:

- path:
  `/Users/johnbaek/projects/Populus-ops/snapshots/evidence/m2-11/T0-v8.log`
- SHA-256:
  `2771908b0d7168bbaf18722bc3d2d441748791f64c6a6e3b0e83319fee36282c`
- size: 61,570 bytes / 169 lines
- process status: **exit 4**
- serialization statement: `WIDEST valid FilingWindow (--build-date intentionally omitted)`

The preflight rungs reported 9,458 filers, 46,081 filings, 16,922,879
holdings, 6 periods, and 9,451 reported filers. The projected worst-case site
file count was 11,838 from the measured 8,106-file tree. Resources were 106.0
GiB free disk and 27.5 GiB free RAM.

The retained full-snapshot namespace materialized in **34.663 s**, and rung
(vi) emitted the exact reviewed reuse evidence:

```text
(vi) materialization reuse: rung (iv) 34.663s; no rebuild
```

The independent 500-filer pilot completed every measured phase successfully:

- materialization: 22.732 s
- coverage: 0.051 s
- period coverage: 0.164 s (6 rows)
- aggregate: 43.744 s (742,412 filer rows; 455,802,880 bytes)
- serving projection: 34.561 s
- coverage ratio: 0.9983215071852559
- peak RSS: 1,997,996,032 bytes
- threshold and headroom checks: PASS (`meets_threshold: true`; projected
  headroom 6,162 files; all tail payloads absent)

Against T0-v7's independent pilot, aggregate time improved from 47.568 s to
43.744 s, an approximately **8.0%** reduction. That bounded pilot improvement
did not establish full-corpus completion.

The certifying full-corpus derivation reused the retained namespace but its
`aggregate` phase again did not complete within the unchanged **180-second
bound**:

```text
STOP: SQLite execution bound (180s) interrupted phase aggregate; later phases suppressed
```

The runner correctly emitted no partial full-corpus JSON. Full coverage and
period-coverage timings, aggregate output/bytes, serving timing/rows, peak RSS,
R12 branch, and tail geometry are unavailable, not zero. Rung-(iv)'s exact
34.663-second materialization and the pilot record remain valid evidence but
are not substituted for the missing full-corpus result.

### D1 immutability evidence

The retained log contains both complete D1 JSON states (lines 167 and 168).
Their normalized JSON representations compare equal and report:

- whole-file SHA-256 (pre and post):
  `977a4d249d92590a4de2961a3e9c7ff8cfa2e4846f0097ec7aa6c07f28124121`
- ordered `main.sqlite_schema`: the same 51 complete rows pre and post
- `-journal`: `false` pre and post
- `-wal`: `false` pre and post
- `-shm`: `false` pre and post
- comparison: `snapshot_immutability: PASS` (line 169)

An independent post-run check reconfirmed that snapshot v1 remains
23,058,628,608 bytes, mode 0444, exact SHA-256, and sidecar-free. D1 did not
override exit 4 because no immutable state changed.

### Decision

Per the approved plan's mandatory-stop rule, this exit-4 binding result ends
the delta before QA. No retry, timeout increase, semantic relaxation,
snapshot/index change, compression step, or post-STOP performance remedy was
attempted. R12 remains **unmeasured**, so the no-compression branch is not
locked. QA review rounds used: **0 of 3**. Any next remedy requires a new
owner-reviewed delta targeting full-corpus aggregate execution within the
existing 180-second bound.

## Binding T0-v9 result (2026-08-10): aggregate clears its guard; STOP at full serving bound

The prepared compact-aggregate delta was governed by the independently approved
`RUN-M2-11-T0-prepared-compact-aggregate-delta-plan.md` (approved-plan SHA-256
`676f04217483f88586f17db961c6399a0456d8ee72ffdacaf76930831d467d84`).
Three standard read-only plan-review rounds requested changes; the owner's
explicitly authorized exceptional fourth convergence round approved this exact
artifact. The implementation reused one prepared full-corpus namespace across
coverage, aggregate, and serving; replaced the high-cardinality QoQ physical
table with compact private dictionaries/backing storage plus the exact read-only
public view; preserved logical digest semantics; and bumped the institutional
schema contract to 1.1 with an exact-base-client compatibility proof.

The principal final implementation inputs to the binding run were:

- `src/populus/inst_agg.py` SHA-256:
  `4a771c99e524dfcb47cec372cdc0522e8a0f6d67275224a228224fa2066cc88a`
- `src/populus/inst_agg.sql` SHA-256:
  `a10b69019e71ef750beb5a1b35a751cf33e872570529ac0825838cd5aefbd1ec`
- `src/populus/inst_serving.py` SHA-256:
  `dba5894414ddd26c08b14a80f43a1286a3164dc9fd2ff07158c3bfd910410a50`
- `src/populus/publish/build.py` SHA-256:
  `68e4976a1e9487185f189bd1edf73402740a080cba364efcdfd8eca3b53741ae`
- `src/populus/publish/digests.py` SHA-256:
  `4feb11fa82394c3e12a1547751be51968a2f9d3d2d7060b099f2541963d84711`
- `src/populus/publish/manifest.py` SHA-256:
  `afe6cd35277d10536a7b1178d7d6e93ed27b338169b2853cbba8660bdac5aac6`
- `scripts/measure_inst_derive.py` SHA-256:
  `7156509eec43bff14692eb8d53c4703926fb02c5ac08cbc4754147c8706fbfbf`

Implementation verification completed after the final source edit and before
the binding run:

| command | status |
|---|---:|
| exact focused pytest set | 0 (`181 passed`) |
| expanded focused pytest set | 0 (`307 passed, 1 skipped`) |
| exact previous-client compatibility gate | 0 (`1 passed, 88 deselected`) |
| runner-governance focused gate | 0 (`1 passed, 5 deselected`) |
| dashboard fixture-preview native gate | 0 (`10 passed`) |
| expanded targeted pytest adjunct | 0 (`756 passed, 2 skipped`) |
| `git diff --check` | 0 |
| `make check` | 0 (`2521 passed, 9 skipped`; Astro check; 264/264 dashboard tests; 8,106-page build; 50/50 post-build tests; dependency guard OK) |
| `make accept-m1-b` | 0 |
| `make accept-m2-5` | 0 |
| `make accept-m2-6` | 0 |
| `make accept-m2-8` | 0 |
| `make accept-m2-11` | 0 |

The binding command was run exactly once as approved: unbuffered, with
`--measured-files 8106`, `--pilot-filers 500`, and `--full`, deliberately
omitting `--build-date`:

```text
PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1 .venv/bin/python scripts/measure_inst_derive.py --snapshot /Users/johnbaek/projects/Populus-ops/snapshots/inst-source-v1.db --measured-files 8106 --pilot-filers 500 --full > /Users/johnbaek/projects/Populus-ops/snapshots/evidence/m2-11/T0-v9.log 2>&1
```

Its retained evidence is:

- path:
  `/Users/johnbaek/projects/Populus-ops/snapshots/evidence/m2-11/T0-v9.log`
- SHA-256:
  `0e17959ef5552eb03655948c4111da2f030008f9890b22e1c707dc4f8d2dfec8`
- size: 61,636 bytes / 169 lines
- process status: **exit 4**
- serialization statement: `WIDEST valid FilingWindow (--build-date intentionally omitted)`

The preflight rungs reported 9,458 filers, 46,081 filings, 16,922,879
holdings, 6 periods, and 9,451 reported filers. The conservative worst-case
site file count was 12,094 from the measured 8,106-file tree. Resources were
78.8 GiB free disk and 17.4 GiB free RAM.

The retained full-snapshot namespace materialized in **179.015 s**, below but
only 0.985 s inside the unchanged 180-second guard, and rung (vi) emitted the
exact reviewed reuse evidence:

```text
(vi) materialization reuse: rung (iv) 179.015s; no rebuild
```

The independent 500-filer pilot completed every measured phase successfully:

- materialization: 43.015 s
- coverage: 0.055 s
- period coverage: 0.411 s (6 rows)
- aggregate: 19.451 s (742,412 filer rows; 244,285,440 bytes)
- serving projection: 113.396 s
- coverage ratio: 0.9983215071852559
- prepared bulk eligibility: true, with no fallback reason
- peak RSS: 2,240,937,984 bytes
- threshold and headroom checks: PASS (`meets_threshold: true`; measured
  headroom 6,162 files; all tail payloads absent)

Against T0-v8's independent pilot, aggregate time fell from 43.744 s to
19.451 s (approximately **55.5%**) and aggregate bytes fell from 455,802,880
to 244,285,440 (approximately **46.4%**). Those bounded pilot results do not
substitute for the missing full-corpus record.

The certifying full-corpus derivation reused the retained namespace. Its
`aggregate` phase cleared the unchanged execution guard: the guard did not
interrupt until the subsequent `serving` phase. The full aggregate's exact
elapsed seconds and byte count were not emitted because the runner correctly
suppressed its combined partial result after the later failure. The exact stop
was:

```text
STOP: SQLite execution bound (180s) interrupted phase serving; later phases suppressed
```

No partial full-corpus JSON was emitted. Exact aggregate time/bytes, serving
time/rows, full peak RSS, R12 branch, and tail geometry are unavailable, not
zero. The phase transition proves that the aggregate no longer owns this STOP,
but it does not satisfy R15's complete-record or R12 requirements.

### D1 immutability evidence

The retained log contains both complete D1 JSON states (lines 167 and 168).
After removing only their distinct textual labels, the two JSON byte strings
have the identical SHA-256
`6d199162769f17a19229d13cd7b00128ab455e98d598631540d2bd163762a01b`
and report:

- whole-file SHA-256 (pre and post):
  `977a4d249d92590a4de2961a3e9c7ff8cfa2e4846f0097ec7aa6c07f28124121`
- ordered `main.sqlite_schema`: exact pre/post equality
- `-journal`: `false` pre and post
- `-wal`: `false` pre and post
- `-shm`: `false` pre and post
- comparison: `snapshot_immutability: PASS` (line 169)

An independent post-run check reconfirmed that snapshot v1 remains
23,058,628,608 bytes, mode 0444, exact SHA-256, and sidecar-free. D1 did not
override exit 4 because no immutable state changed.

### Decision

Per the approved plan's mandatory-stop rule, this exit-4 binding result ends
the delta before QA. T0-v9 will not be rerun, renamed, or overwritten. No
timeout increase, semantic relaxation, snapshot/index mutation, compression
step, source repair, QA review, release mutation, or deployment was attempted
after the STOP. R12 remains **unmeasured** and the aggregate artifact branch is
not locked. QA review rounds used: **0 of 3**. Any next remedy requires a new
owner-reviewed delta targeting full-corpus serving execution within the
existing 180-second bound and a newly owner-authorized append-only binding log
name.

## Binding T0-v10 result (2026-08-10): all phase bounds and R12 pass; STOP on tail geometry

The serving-performance delta was governed by the independently approved
`RUN-M2-11-T0-serving-performance-delta-plan.md` (approved-plan SHA-256
`b676de80a83fb53391382a03cb01285166746dcc5182954c1de0b2b437265c92`).
Three read-only plan-review rounds converged on the exact artifact before
implementation. The implementation combined serving derivation into one
ordered holdings pass, consumed compact QoQ storage without reconstructing the
public view, and moved concentration work under the aggregate phase guard.

The exact final implementation inputs to the binding run were:

- findings before T0-v10 SHA-256:
  `28e58fe3047e0faa9105c30e281d58ae4d928e3b1a719f82e9d9464f2fdc2583`
- `src/populus/inst_agg.py` SHA-256:
  `eadbf78144546a5a737638a8225286cdc23fef4276308f64561c868b0ddc88ad`
- `src/populus/inst_serving.py` SHA-256:
  `5bff56bbd130b911de24a34566f6c9eac39c916a149326492178d911742beb8c`
- `tests/test_inst_agg.py` SHA-256:
  `a81d28f12532851c06ba1ceb4c56ed1b41ee1f0cf2024e4b1960522e55c7e4ed`
- `tests/test_inst_serving.py` SHA-256:
  `fa14190f465cff22321db38a74ae83e7bbb60740f28eb6119af7569de2b8ec76`

Implementation verification completed after the final source edit and before
the binding run:

| command | status |
|---|---:|
| focused aggregate/serving pytest set | 0 (`94 passed`) |
| expanded targeted pytest set | 0 (`772 passed, 2 skipped`) |
| exact previous-client compatibility gate | 0 (`1 passed, 88 deselected`) |
| runner-governance gate | 0 (`6 passed`) |
| dashboard fixture-preview native gate | 0 (`10 passed`) |
| `git diff --check` | 0 |
| `make check` | 0 (`2537 passed, 9 skipped`; Astro check; 264/264 dashboard tests; 8,106-page build; 50/50 post-build tests; dependency guard OK) |
| `make accept-m1-b` | 0 |
| `make accept-m2-5` | 0 |
| `make accept-m2-6` | 0 |
| `make accept-m2-8` | 0 |
| `make accept-m2-11` | 0 |

Immediately before execution, the approved `T0-v10.log` path did not exist.
The immutable source snapshot was 23,058,628,608 bytes, mode 0444, SHA-256
`977a4d249d92590a4de2961a3e9c7ff8cfa2e4846f0097ec7aa6c07f28124121`,
with no `-journal`, `-wal`, or `-shm` sidecar. The exact binding command was run
once as approved, unbuffered, with `--measured-files 8106`,
`--pilot-filers 500`, and `--full`, deliberately omitting `--build-date`:

```text
PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1 .venv/bin/python scripts/measure_inst_derive.py --snapshot /Users/johnbaek/projects/Populus-ops/snapshots/inst-source-v1.db --measured-files 8106 --pilot-filers 500 --full > /Users/johnbaek/projects/Populus-ops/snapshots/evidence/m2-11/T0-v10.log 2>&1
```

Its retained append-only evidence is:

- path:
  `/Users/johnbaek/projects/Populus-ops/snapshots/evidence/m2-11/T0-v10.log`
- SHA-256:
  `a86e24a6e4babc2ae70b010f38d3851f83ac1a60906141a1c536617470198cd7`
- size: 75,091 bytes / 173 lines
- direct process status: **exit 3**
- serialization statement: `WIDEST valid FilingWindow (--build-date intentionally omitted)`

The independent 500-filer pilot completed successfully:

- materialization: 21.612 s
- aggregate: 19.350 s (742,412 filer rows; 244,285,440 bytes)
- serving projection: 9.336 s
- coverage: 0.9983215071852559
- peak RSS: 3,002,073,088 bytes
- threshold and headroom: PASS

The certifying full-corpus derivation reused the retained namespace and emitted
a complete result. Every performance phase cleared the unchanged 180-second
guard:

- materialization: **126.365 s**
- aggregate: **116.824 s** (4,242,299 filer rows; 1,040,547,840 bytes)
- serving projection: **83.005 s**
- coverage: 0.9798527965152196
- peak RSS: 11,533,107,200 bytes
- prepared bulk eligibility: true, with no fallback reason

R12 selected and passed the no-compression branch: aggregate bytes were
1,040,547,840 against the unchanged 1,610,612,736-byte limit. The performance
delta therefore resolved the T0-v9 serving timeout without weakening the
execution or artifact-size bounds.

The complete tail measurement exposed a separate release constraint:

- tail filers: 7,951
- total tail bytes: 2,520,035,802
- median / p90 / maximum payload bytes: 155,918 / 700,037 / 10,462,106
- payloads over the 1,048,576-byte client-response ceiling: **439**
- derived shards: **1,866** against the reserved **256**
- maximum shard bytes: 1,048,532
- global file projection: 13,704 of 18,000, leaving 4,296 files
- tail result: `headroom_ok: false`; `stop: true`

The immutable log retains the complete deterministic 439-CIK list. The two
binding stops were:

```text
(vi) full STOP (LD-10): 439 tail payload(s) exceed the 1048576-byte client-response ceiling
(vi) full STOP (R11): derived shard count 1866 exceeds the reserved file headroom of 256 shards (inst_budget.FILER_TAIL_SHARDS_RESERVED)
```

### D1 immutability evidence

The retained log records complete pre/post D1 states and
`snapshot_immutability: PASS`. An independent post-run check reconfirmed the
snapshot at 23,058,628,608 bytes, mode 0444, exact SHA-256, and with no journal,
WAL, or SHM sidecar. The nonzero exit was caused only by the two tail-geometry
stops above.

### Decision

Per the approved mandatory-stop rule, this exit-3 binding result ends the delta
before QA. T0-v10 will not be retried, renamed, truncated, or overwritten. No
timeout increase, payload-ceiling increase, shard-budget increase, source
repair, QA review, documentation mutation, PR action, release mutation, or
deployment was attempted after the STOP. QA review rounds used: **0 of 3**.
Any remedy requires a new owner-reviewed delta addressing the measured tail
payload and shard geometry and a newly owner-authorized append-only binding log
name.

## T0-v11 — tail-payload pagination and shard geometry

The owner authorized one new reviewed delta and one new append-only T0-v11
binding run. Independent plan review approved
`RUN-M2-11-T0-tail-pagination-delta-plan.md` after three read-only rounds at
SHA-256
`068e7fc04edf61e0e3d25e40ff504b003faa0d0ab6d26fa65982a4899e119fad`.
All approved implementation gates completed before the binding run, including
`git diff --check`, the focused Python and dashboard suites, the previous-client
compatibility gate, full `make check`, and every M1-B/M2-5/M2-6/M2-8/M2-11
acceptance target.

Immediately before execution, `T0-v11.log` did not exist. The immutable source
snapshot was 23,058,628,608 bytes, mode 0444, SHA-256
`977a4d249d92590a4de2961a3e9c7ff8cfa2e4846f0097ec7aa6c07f28124121`,
with no `-journal`, `-wal`, or `-shm` sidecar. The exact approved command ran
once, unbuffered, with no `--build-date`:

```text
t0_log=/Users/johnbaek/projects/Populus-ops/snapshots/evidence/m2-11/T0-v11.log
test ! -e "$t0_log" || exit 97
t0_exit=0
PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1 .venv/bin/python scripts/measure_inst_derive.py --snapshot /Users/johnbaek/projects/Populus-ops/snapshots/inst-source-v1.db --measured-files 8106 --pilot-filers 500 --full > "$t0_log" 2>&1 || t0_exit=$?
printf 'T0-v11 direct exit: %s\n' "$t0_exit"
test "$t0_exit" -eq 0
```

Its retained append-only evidence is:

- path:
  `/Users/johnbaek/projects/Populus-ops/snapshots/evidence/m2-11/T0-v11.log`
- SHA-256:
  `7078a42934484c9c5ba7f975654476e0788c385dbaf8108c0d429a58ba91a453`
- size: 63,400 bytes / 171 lines
- direct process status: **exit 0**
- serialization statement: `WIDEST valid FilingWindow (--build-date intentionally omitted)`

The independent 500-filer pilot completed successfully:

- materialization: 73.955 s
- aggregate: 29.459 s (742,412 filer rows; 244,285,440 bytes)
- serving projection: 27.727 s
- coverage: 0.9983215071852559
- peak RSS: 2,765,979,648 bytes
- threshold and headroom: PASS

The certifying full-corpus derivation reused the retained namespace and emitted
a complete result. Every guarded phase cleared the unchanged 180-second bound:

- materialization: **158.950 s**
- aggregate: **156.725 s** (4,242,299 filer rows; 1,040,547,840 bytes)
- serving projection: **123.690 s**
- coverage: 0.9798527965152196
- peak RSS: 12,130,123,776 bytes
- prepared bulk eligibility: true, with no fallback reason

R12 selected and passed the no-compression branch: aggregate bytes were
1,040,547,840 against the unchanged 1,610,612,736-byte limit. The complete v2
tail result passed every geometry and exactness guard:

- tail filers / logical tail bytes: 7,951 / 2,520,035,802
- logical median / p90 / maximum bytes: 155,918 / 700,037 / 10,462,106
- fragments: 54,944; parts median / p90 / maximum: 7 / 9 / 18
- fragment target / part limit: 786,432 bytes / 64
- routing index: 209,223 bytes; one file
- physical shards: 2,714 of 4,096; maximum body 1,048,574 bytes
- v1 transition tombstone: one file
- over-ceiling, route-mismatch, and reassembly-mismatch counts: 0 / 0 / 0
- tail result: `headroom_ok: true`; `stop: false`

The exact measured global projection was 14,553 of 18,000 files: measured tree
8,106 plus committed terms, 2,714 v2 shards, one v2 routing index, and one v1
transition file. This leaves **3,447 files** of measured headroom.

### D1 immutability evidence

The retained log records complete pre/post D1 states and
`snapshot_immutability: PASS`. An independent post-run check reconfirmed the
snapshot at 23,058,628,608 bytes, mode 0444, exact SHA-256, and with no journal,
WAL, or SHM sidecar.

### Decision

T0-v11 satisfies the approved performance, payload, shard, reassembly, global
file-budget, coverage, aggregate-size, and immutability contracts. The result
unblocks fresh Dev Notes, QA evidence, and up to three independent QA-review
rounds. T0-v11 will not be retried, renamed, truncated, or overwritten.
