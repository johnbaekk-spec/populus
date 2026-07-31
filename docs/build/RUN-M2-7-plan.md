# RUN M2-7 — Cover-noise tolerance for inst certifiability (plan-v1)

## Goal and Success Criteria

Implement the owner decision of 2026-07-31 ("Tolerance + flag"): rounding-level
filer-side cover discrepancies must not de-certify the inst corpus; genuine
cover conflicts are excluded-and-flagged, never silently served. Success = the
real 1,000-filer 2026-06-30 corpus certifies and meets the 0.95 gate with the
conflicts named, all existing fixtures byte-identical, and every behavioural
change mutation-verified. The normative document is
`docs/build/M2-7-cover-tolerance-spec.md`; this plan wraps it for review.

## Requirements

- **R1** — A filing with declared total T>0 and summed holdings S where S>T and
  1000·(S−T) ≤ max(1_000_000, T) (exact integer arithmetic; $1,000 floor,
  0.1% per-mille term) is `cover_rounding`: stays in corpus and coverage.
- **R2** — Coverage denominator banks max(T, S) per filing — coverage can never
  be overstated by trusting the smaller declared number.
- **R3** — Beyond tolerance the filing is `cover_conflict`: excluded from the
  coverage numerator, denominator, and the default view/aggregates via the view
  predicate (no schema change), as a counted disposition.
- **R4** — Certifiable means zero UNRESOLVED conflicts; the fail-closed
  `inflated_filing_count` backstop remains for any conflict a stale view would
  leave inside the default set.
- **R5** — Stats/report surfaces name `cover_rounding` count + max absolute
  delta and `cover_conflict` filing_ids, on both passing and withheld builds.
- **R6** — Exact-cover fixtures behave byte-identically; the 0.95 threshold and
  uncovered-quarters logic are untouched.
- **R7** — `ensure_views` replaces a view whose stored SQL differs (an existing
  DB must not keep serving conflicts through a stale predicate) while writing
  nothing when definitions match, preserving the clobber-refusal invariant.
- **R8** — Flags (`cover_conflict`/`cover_rounding`) are annotation only; no
  decision path reads them (a persisted-flag gate would silently readmit
  conflicts on corpora that never ran the pass).

## Scope

`src/populus/ingest/inst13f.py` (classifier, coverage, dispositions, summary),
`src/populus/views.sql` (+`v_inst_reconciled_filings`, default-view predicate),
`src/populus/amendments.py` (`ensure_views` staleness replacement),
`src/populus/publish/build.py` (dispositions on report + withheld payload),
`scripts/accept_m2_5.py` (surface), `src/populus/inst_bulk.py` (summary),
tests. Spec at `docs/build/M2-7-cover-tolerance-spec.md`.

## Non-goals

No change to the 0.95 threshold, uncovered-quarters fail-closed logic, M2-5
identity semantics, M2-6 journal semantics, schema DDL, or MCP tools.

## Constraints

- The 0.95 threshold, uncovered-quarters fail-closed logic, M2-5 identity and
  M2-6 journal semantics are untouched.
- No schema DDL; exclusion must be view-level.
- Exact integer arithmetic only — the SQL predicate and the Python classifier
  must be provably the same inequality.
- Tests hermetic (no sockets); mutation-verification under bytecode hygiene.

## Current State

The first real bulk corpus (988 default filings, 602,496 holdings) measured
coverage 0.9856 but `certifiable=False` on `inflated_filing_count=7` — six
rounding-level deltas ($1–$20 or ≤0.33%) and one 1.531× outlier. Zero-tolerance
certifiability cannot survive real EDGAR data at scale.

## Detected Stack

Python 3.12, uv, SQLite/JSON1, pytest; gates `make test` / `make security`;
canonical store one SQLite DB; views in `src/populus/views.sql` applied by
`ensure_views` (`src/populus/amendments.py`).

## Reuse Map

| Need | Reuse |
|---|---|
| Flag stamping | affiliation-flags clear-and-recompute pattern (`inst13f.py`) |
| View-based exclusion | `v_default_inst_filings` staging (views.sql) |
| Disposition surfacing | `BuildReport` / `inst_withheld` payloads (build.py) |
| Acceptance surface | `scripts/accept_m2_5.py` output block |

## Architecture

Classification is a pure function `classify_cover(T, S)` → normal | rounding |
conflict, in exact integer arithmetic; the SQL predicate in the default view is
the same inequality, agreement-tested against the Python classifier. Exclusion
lives in the view; certifiability keys on unresolved conflicts computed from
the view's own contents (fail-closed if a stale view leaks a conflict).

## Locked Decisions

1. Tolerance = 1000·(S−T) ≤ max(1_000_000, T), integers only (R1).
2. Denominator banks max(T,S) (R2).
3. Exclusion by view predicate, not schema or flags (R3, R8).
4. `ensure_views` staleness-replacement semantics (R7).

## Alternatives Considered

- Tolerance as float 0.001·T — rejected: float disagrees between SQLite and
  Python at $10¹² scale (spec §domain).
- Flag-keyed exclusion — rejected: silently readmits conflicts on corpora that
  never ran the flag pass (R8).
- Widening tolerance to admit the 0.185%/0.330% filings — rejected: 0.1% is a
  rounding tolerance, not a reconciliation budget (spec Rule 3); widening is a
  spec amendment, not a tuning.

## Planned Files

As listed in Scope, plus `tests/test_cover_tolerance.py` (new) and updates to
`tests/test_publish.py`, `tests/test_list13f_coverage.py`.

## Implementation Tasks

1. **[R1]** `classify_cover` + tolerance constants, exact integer arithmetic.
2. **[R2]** Denominator banks max(T,S) in `compute_coverage`.
3. **[R3]** `v_inst_reconciled_filings` + default-view conflict predicate.
4. **[R4]** Certifiable = zero unresolved conflicts; retained backstop.
5. **[R5]** Dispositions named in ingest summary, build report, withheld
   payload, accept surface.
6. **[R6]** Fixture byte-identity proven by the untouched golden set.
7. **[R7]** `ensure_views` staleness replacement + clobber-refusal preserved.
8. **[R8]** Annotation-only flags, clear-and-recompute wiring.

## Testing Strategy

`tests/test_cover_tolerance.py` (17 cases): boundary/integer exactness,
view↔Python predicate agreement sweep, $1 rounding certifies, exact boundary
certifies, one-past-boundary excludes + remainder certifies, real-1.531×
reproduction, denominator banking, under-cover unchanged, stats naming,
stale-view fail-closed, `ensure_views` staleness, flags-annotation-only,
clear-and-recompute, replay determinism, M2-6 byte-identity, NULL-total
`cover_failed`. Mutation-verification with bytecode hygiene for every
behavioural change.

## Verification Matrix

| R-id | Verified by |
|---|---|
| R1 | boundary + integer-exactness + agreement tests |
| R2 | denominator-banking test |
| R3 | conflict-exclusion view/holdings/aggregates tests |
| R4 | one-past-boundary + stale-view fail-closed tests |
| R5 | stats naming + publish report/withheld tests |
| R6 | untouched golden fixtures + byte-identity test |
| R7 | `ensure_views` staleness + clobber-refusal tests |
| R8 | flags-annotation-only + clear-and-recompute tests |

## Rollout / Rollback

Ship with the M2-6 corpus already ingested; re-measure read-only, then build →
publish → serve (steps 5–7 of the M2-6 runbook). Rollback = revert the single
commit; `ensure_views` restores the prior predicate on the next run.

## Simplicity Audit

One pure classifier, one additive view, one staleness rule; no new schema, no
new module, no new dependency.

## Tech Debt Introduced

None beyond the recorded spec Rule 3 boundary (0.185%/0.330% filings excluded;
widening is a spec amendment). The three excluded filings' holdings remain in
the DB (auditable) but outside the default view.

## Memory Touch-Points

`specify-before-rewriting` (spec written before the gate mechanism was edited);
`john-baek-profile` (measured figures only); owner decision 2026-07-31 recorded
in the spec header.

## Failure-Mode Sweep

Stale view serving conflicts → fail-closed backstop + `ensure_views`
replacement, both tested. Float drift → integer arithmetic. Flag-pass never run
→ annotation-only flags cannot gate. Replay → determinism test. Fixture drift →
byte-identity assertions.

## Definition of Done

- **R1** — boundary, integer-exactness, and SQL↔Python agreement tests green.
- **R2** — denominator-banking test green; coverage never overstated.
- **R3** — conflict exclusion proven across view, holdings, and aggregates.
- **R4** — certifiable=zero-unresolved + stale-view fail-closed tests green.
- **R5** — dispositions named on passing and withheld surfaces, tested.
- **R6** — 26 golden fixtures untouched; byte-identity test green.
- **R7** — `ensure_views` staleness replacement + clobber-refusal tests green.
- **R8** — flags proven annotation-only; clear-and-recompute tested.
- 12/12 mutants killed; `make test` green (no regressions + new tests);
  `make security` clean; real-corpus re-measure certifiable ≥0.95 with
  dispositions named — measured figures in Dev Notes, never asserted.
