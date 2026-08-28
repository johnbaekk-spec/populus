# Per-slice changed-file lists (T0.5)

Program scaffolding for REPOSITORY-PROFESSIONALIZATION. Derived from the plan's
Planned Files tables and slice tasks, cross-checked against the T0.4 re-measured
overlap tables (2026-08-27, tool exit 0). Stage only paths on the relevant list;
never use a repository-wide add. This file is deleted with the plan at program end.

Legend: **BLOCKED** entries may not be edited until the named run lands
(security run = PRs #57–#61 merged; I-2 = formally DEFERRED 2026-08-27, its K5
hold is dissolved — see SLICE-0-RECORD.md).

## Slice 1 — Front door and documentation IA (surface: 142 files)

New: `docs/roadmap.md`, `docs/frontend/design-principles.md`,
`docs/architecture/` targets (data-contracts and decisions per the Move table),
`docs/operations/` (six runbooks moved), `docs/frontend/pagination-and-counts.md`,
`docs/frontend/qoq-presentation.md`.

Edit: `README.md`, `dashboard/README.md`, `ARCHITECTURE.md`,
`dashboard/test/sl-docs.test.ts` (same commit as the dashboard-docs move).

Delete/extract: `STATUS.md`, `BACKLOG.md`, `HANDOFF-REVIEW.md`,
`REVIEW-RESPONSE.md`, `DESIGN-BRIEF.md`, `docs/build/P3-DESIGN-BRIEF.md`,
`planned-files-m2-11.json`, `docs/build/RUN-SURFACES-LEGIBILITY.planned-files.json`,
completed `docs/build/` RUN families (RUN-1..6 briefs, RUN-M1-B-*, RUN-M2-1..9,
RUN-M2-11-* per D14/K2, RUN-M2-12-* after owner closes M2-12, RUN-P3-*,
RUN-SURFACES-LEGIBILITY-*), `docs/design/` UX/SURFACES plan files,
`docs/design/handoff/HANDOFF.md`, `support.js`, 13 tracked `.dc.html` files
(after mobile-fold extraction and empty reference scan).

BLOCKED (security run, until PRs merge): `ARCHITECTURE.md`, `Makefile`,
`README.md`, `STATUS.md`, `dashboard/README.md`, `docs/runbooks/deploy.md`.
Formerly I-2-blocked, released by the deferral: `BACKLOG.md`,
`dashboard/docs/qoq-presentation.md`, `docs/build/RUN-M2-6-plan.md`,
`docs/runbooks/rollback.md` (rollback.md and deploy.md remain security-held via
the BOTH set).
Exempt (active work): `REVIEW.md`, `docs/build/RUN-FILER-IDENTITY-notes.md`,
untracked RUN-I-2-* and security-plan files per the plan's Active-work exemption.

## Slice 2 — CI reconciliation (surface: exactly 1 file)

Edit: `README.md` (BLOCKED on security run PR 1, which owns it).
Verify-only, never edited: `.github/workflows/checks.yml`,
`tests/test_workflow_governance.py`.

## Slice 3 — Scripts, operational truth, package/config metadata (surface: 24)

Moves (with `Makefile` target-path updates and inbound-link updates):
`scripts/accept_m1_b.py` → `scripts/acceptance/congress_history.py`,
`scripts/accept_m2_5.py` → `scripts/acceptance/institutional_list.py`,
`scripts/accept_m2_6.py` → `scripts/acceptance/institutional_bulk.py`,
`scripts/accept_m2_8.py` → `scripts/acceptance/holdings_substrate.py`,
`scripts/accept_m2_11.py` → `scripts/acceptance/institutional_serving.py`
(released: its I-2 hold dissolved with the deferral; D12 keeps the
`accept-m2-11` target name),
`scripts/accept_alpha_surfaces_v2.py` → `scripts/acceptance/surfaces.py`,
`scripts/dep_guard.py` → `scripts/maintenance/dependency_guard.py`,
`scripts/render_licenses.py` → `scripts/maintenance/render_licenses.py`,
`scripts/verify_manager_registry.py` → `scripts/maintenance/verify_manager_registry.py`,
`scripts/gen_m2_6_fixtures.py` → `scripts/fixtures/institutional_bulk.py`,
`scripts/regen_filer_payload_parity_fixture.py` → `scripts/fixtures/filer_payload_parity.py`,
`scripts/monitor.py` → `src/populus/monitoring/monitor.py` (+ console entry, D8).

Not moved: `scripts/fetch_legislators_cache.py` (publish.yml caller),
`scripts/inst_snapshot.py` (operational), `scripts/measure_inst_derive.py`
(fixture dependency).

Edit: `Makefile`, `pyproject.toml` (both BLOCKED on security run — BOTH set),
`docs/runbooks/self-hosted-runner.md` (T3.10 parameterizes line 403),
`docs/operations/` docs from Slice 1.
Delete candidates (after coverage proof): `scripts/phase_a_snapshot.py`,
`tests/test_phase_a_snapshot.py`.
`scripts/build_m2_11_qa_bundle.py`: BLOCKED on security run; disposition changed
— the security run KEPT and parameterized it (see SLICE-0-RECORD.md, D14/K2 note).

## Slice 4 — Source provenance cleanup (surface: 132)

4a FREE (87 files): derived mechanically at T4.1 by
`cross_run_overlap.py` — the complement of the blocked union within the sweep of
`src/` + `dashboard/src/`.

4b BLOCKED (45 files = union of 23 security-owned + 35 I-2-owned sharing 13):
security-owned set and I-2-owned set exactly as printed in the T0.4 output in
SLICE-0-RECORD.md. The 13 BOTH files:
`dashboard/src/components/HoldingsTable.astro`, `dashboard/src/lib/inst.ts`,
`dashboard/src/lib/ui.ts`, `dashboard/src/pages/institutional/filers/[cik].astro`,
`dashboard/src/pages/institutional/index.astro`,
`dashboard/src/pages/institutional/tickers/[t]/holders.astro`,
`src/populus/canonical.py`, `src/populus/cli.py`,
`src/populus/deploy/orchestrator.py`, `src/populus/deploy/record.py`,
`src/populus/deploy/upload.py`, `src/populus/net/sec_client.py`,
`src/populus/publish/digests.py`.
With I-2 deferred, the I-2-only members of 4b unblock; the security-owned 23 (and
the 13 BOTH) unblock when the security PRs merge.

## Slice 5 — MCP server domain split (surface: 5, zero overlap)

`src/populus/mcp_server.py` and its split targets plus its tests — no file is
owned by either run (SEC=0, I2=0). Still sequenced after the full security run
per K6 (timing, not conflict).

## Slice 6 — Dashboard render and style split

**BLOCKED — do not start.** RUN FILER-IDENTITY is still active, which blocks
Slice 6 regardless of the I-2 deferral and the security merges. For the record,
its 16-file blocked set (before the deferral): `dashboard/src/layouts/Base.astro`
and `dashboard/src/lib/ui.ts` (security), `dashboard/src/lib/ui.ts` +
`dashboard/src/scripts/entity-client.ts` + 13 dashboard tests (I-2, now
released by the deferral). `ui.ts` remains security-held until the PRs merge.
