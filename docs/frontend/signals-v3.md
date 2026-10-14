# Signals v3 — decision record

- Approved mock: https://claude.ai/artifact/EBjCQcDUuCidmjwieM9Zid (owner "Approve as-is", 2026-10-13).
- Plan: `PLAN.md` at the worktree root (plan-v1; Codex plan review APPROVED in round 2, 2026-10-14).
- Milestones: M1 watchlist removal → M2 Signals page → M3 ticker page. Each ships as its own PR.

## Baseline

This is task T0, run on a clean detached worktree at `origin/main` 631a0aa on 2026-10-14. The tree hash was unchanged before and after the run.

The owner tier ran against data build 20260817.1. That is the build behind `POPULUS_BUILD_DIR`, `POPULUS_DB`, `POPULUS_INST_DB` and `POPULUS_INST_SERVING_DB`, and it is the same build the signals-clarity milestones used.

| Command | Exit | Pass / Fail / Skip |
|---|---|---|
| `uv run pytest -q` | 1 | 3811 / 2 / 11 |
| `npx astro check` | 0 | 0 errors, 0 warnings, 1 hint |
| `npm test` | 0 | 979 / 0 / 0 |
| `make security` | 0 | clean |
| `make abs-paths` | 0 | clean |
| `npm run build:bounded` | 0 | 9661 pages |
| `npm run test:post` | 1 | 79 / 13 / 0 |
| `npm run test:geometry` | 1 | 927 / 17 / 130 |
| `npm run test:holders-browser` | 0 | 33 / 0 / 0 |

**Failing on clean `main`.** A later run regresses only if a test outside this list fails, or a listed test fails for a different reason.

- **pytest (2)**, both in `tests/test_maintenance_tooling.py`:
  - `test_cross_run_exits_zero_on_the_current_tree`
  - `test_cross_run_f34_round_two_forms_do_not_move_a_live_span`

  Both read untracked owner plan documents in the main checkout, which name files that do not exist at 631a0aa.
- **test:post (13).**
  - `fixture-preview.test.ts`: 10 tests at :44, :56, :85, :97, :106, :114, :156, :191, :211 and :240. All fail the same way: the fixture build in the `before()` hook exceeds its 240 s `spawnSync` limit. These are timing noise.
  - `http-status.test.ts:85`: the search index exceeds 128 KiB (542,106 bytes).
  - `http-status.test.ts:257`: the institutional fixture-leak check. This dist legitimately carries 1,500 filer pages.
  - `refinement-dist.test.ts:304`: no NVDA holders page in this data build.
- **test:geometry (17).**
  - `design-reference.spec.ts:96`: the Institutional Filer canvas at 1440 has one period chip.
  - `ledger.spec.ts:427`: "G1, G6, G7, G8 measured nothing on /institutional/". The test fails 16 times: 2 widths × 2 projects, which is 4 runs, × 4 checks.

The machine-specific raw log is kept outside the tree, in the review artifacts directory (`.codex-review/t0-baseline.txt`).
