# Slice 3 record — scripts, operational truth, package/config metadata

Branch `prof/slice-3` (stacked on `prof/slice-2`). Requirements R1, R5, R8,
R9, R10, R11; tasks T3.1–T3.10.

## The Makefile-edit interpretation (recorded per instruction)

The plan says elsewhere that "no Makefile change originates from this program";
T3.1 says "Update Makefile … in one commit". These reconcile as follows: the
Makefile-edit ban is scoped to the **maintenance-gate wiring** (the T0.0/T1.8
gates deliberately run as `bash scripts/maintenance/*.sh`, not as new Make
targets), while D12 requires the stable target *names* to keep working after
script moves — which requires editing the recipe *paths* behind them. The
security run's Makefile work is beneath this branch and RUN I-2 is deferred, so
no live owner of Makefile edits conflicts. This slice edited only recipe paths
and one path inside a comment; every target name in D12 is unchanged.

## What landed

- **T3.1** — 11 history-preserving `git mv`s per Planned Files: six acceptance
  gates → `scripts/acceptance/`, `dependency_guard`/`render_licenses`/
  `verify_manager_registry` → `scripts/maintenance/`, two fixture generators →
  `scripts/fixtures/`. Caller sweep re-run first; `fetch_legislators_cache.py`,
  `inst_snapshot.py`, `measure_inst_derive.py` stay per their plan
  classifications, `build_m2_11_qa_bundle.py` stays (security-run-owned; its
  internal path strings were updated to the new script paths).
  `accept_m2_11.py` moved — its former I-2 hold is released by the deferral.
  `DATA-LICENSE.md`/`NOTICE` were **regenerated** from the renamed generator,
  never hand-edited. No wrapper duplicates.
- **T3.2** — `scripts/phase_a_snapshot.py` retired with its path-loader test.
  Behavior map: manifest validation / pointer identity / locator containment
  are the canonical `populus.publish.manifest` + `populus.ingest` boundaries
  (tested in `tests/test_publish.py` and the ingest suites); asset sha256/byte
  verification is the `populus verify` path (`tests/test_deploy_verify.py`);
  stats counts are the build's (`tests/test_stats.py`). The copy-then-reconcile
  composition was the completed RUN M1-B Phase A operation with no remaining
  caller; no unique behavior required a new test.
- **T3.3/T3.4** — monitor packaged at the D8-locked
  `src/populus/monitoring/monitor.py` with the `populus-monitor` console entry;
  frozen `MonitorCheck`, required `report` callback, injected
  immutable-settings checker seam, fail-closed on a raising checker (exception
  type only in the detail), CLI one-JSON-line-per-check on stdout, alarms on
  stderr/Discord. `tests/test_monitoring.py` pins all states; exit codes and
  tuple persistence unchanged (`tests/test_pointer_state.py` still green).
- **T3.5** — `docs/operations/deploy.md` (Slice 1's home for the D7 facts)
  verified complete: publish path + arming order, PR #53 no-verdict-vs-
  rejection retry rule, R18 attestation gate, rollback-anchor
  newest-vs-serving caveat, 43–100 min cron-drift tolerance. README and
  workflow comments agree; the only reconciliation was naming the R18 gate in
  step 6. `publish.yml`/`record-sign.yml` untouched.
- **T3.6** — `src/populus/operator_identity.py` per D9 (exactly
  `operator_contact`, `filings_user_agent`, `sec_user_agent`); the M1 ingest
  User-Agent is now resolved per request instead of frozen at import, and the
  SEC-side names delegate to the shared module.
- **T3.7** — `parse`/`mcp_server` package docstrings refreshed to current
  cross-domain scope.
- **T3.8** — pyproject `[project]` metadata completed (readme, MIT license +
  license-files, urls, description); no dependency changes (D13),
  `uv sync --frozen` still satisfied.
- **T3.9** — `docs/operations/data-maintenance.md`: the quarterly
  `verify_manager_registry` owner cadence and the `inst_snapshot.py` protocol.
- **T3.10** — runbook line 403 parameterized as `POPULUS_OPS_SNAPSHOT` with a
  `$HOME`-relative owner example; the four content-keyed service-account
  exemptions untouched. `check_abs_paths --worktree` reports only
  `REVIEW.md:4` (K7, owner deletes at review-cycle close).

## Gate evidence

- `uv run pytest -q`: **4066 passed, 146 skipped**, exit 0. Baseline 4072/146;
  −20 retired phase-a tests, +14 new (10 monitoring, 4 operator-identity) —
  no regressions.
- `make security`: exit 0 (dep guard at its new path, pip-audit and npm audit
  clean).
- `make accept-m1-b` / `accept-m2-6` / `accept-m2-8`: **PASSED** at the new
  paths.
- `make accept-m2-5`: **NOT-RUNNABLE** on this host — errors honestly on
  missing owner inputs (`data-cache/13flist/13flist*.pdf` sweep, e.g.
  `13flist2025q4.pdf`, `13flist2026q1.pdf`, absent in this worktree).
- `make accept-m2-11`: **fails identically before and after the move** —
  `StopIteration` at the `staging_dir=` scan (line 475) in the congress-only
  UNSET path; reproduced byte-for-byte with the pre-move
  `prof/slice-2:scripts/accept_m2_11.py` on this host, so it is a pre-existing
  host/baseline condition, not a slice regression.
- `check_links.sh`: 0. `check_abs_paths.sh --worktree`: only `REVIEW.md:4`.
  `tests/test_maintenance_tooling.py`: 397 passed (the ref-mode pinned
  baseline is unaffected by the worktree-side runbook edit).
- Old-path grep (excluding `docs/maintenance/`): the only matches are in
  `docs/build/` — the RUN M2-11 process-history set whose deletion Slice 1
  deferred as owner-gated K2. Excluding that deferred history, the sweep is
  empty.

## Deviations

- `tests/test_dep_guard.py` gained an earned, justified httpx allowlist entry
  for `monitoring/monitor.py`: moving the monitor into `src/` brought its
  Discord alarm transport under the owned-source network-primitive guard.
- Test module names keep their historical spellings (`test_accept_m1_b.py`
  etc.) while loading the renamed scripts — the plan renames scripts, not
  tests.
