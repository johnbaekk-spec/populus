# Slice 0 record — Rebaseline and protect in-flight work

Executed 2026-08-27 in worktree
`/Users/johnbaek/projects/Populus/.claude/worktrees/professionalization`,
branch `prof/slice-0`.

## T0.1 — branch facts

- Branch: `prof/slice-0`, cut at base SHA `35ef466` = tip of the five stacked
  security branches sec/pr1..pr5 (PRs #57–#61, open, awaiting owner merge) —
  content-equivalent to post-merge main.
- `git status --short` before edits: **clean** (empty output).
- `origin/main` = `49bcf9d` "docs(backlog): B36-B38 from RUN ALPHA-SURFACES-V2
  deploy" — the B36–B38 commit (formerly local-only `20e2577`) **is pushed**;
  the plan's precondition 1 holds. Verified: `git branch -r --contains 49bcf9d`
  includes `origin/main`.
- K3: `src/populus/manager_registry.yaml` is tracked and clean against
  `origin/main` in this worktree (no diff, no untracked collision).

## T0.0 — maintenance tooling adopted

Cherry-picked `874f93f` (branch `feat/professionalization-tooling`) as commit
`fa406c6` — one commit, four files, no conflicts:
`scripts/maintenance/check_links.sh`, `scripts/maintenance/check_abs_paths.sh`,
`scripts/maintenance/cross_run_overlap.py`, `tests/test_maintenance_tooling.py`.

Suite verification: `uv run pytest -q tests/test_maintenance_tooling.py` →
**397 passed in 85.90s**, zero failures (including
`test_abs_paths_ground_truth_on_the_pinned_baseline`, which pins the five-file
R3 table against `origin/main` — still valid because the security merges have
not landed on `origin/main`).

## T0.2/T0.3 — manifest and annex re-derivation

Tracked files on `prof/slice-0` (`git ls-files`): 692.

Delta vs `origin/main` (49bcf9d): 70 changed paths across 20 commits (the five
security branches + tooling). Adds and deletes:

- **Deleted:** `.claude/launch.json` — the security run **deleted** it (D5
  satisfied ahead of schedule; the plan's "CEDED, no action" row is confirmed
  discharged once the PRs merge).
- **Added (all classified ACTIVE/durable, owned by the security run, KEEP):**
  `.github/CODEOWNERS`, `.github/dependabot.yml`, `.gitleaks.toml`,
  `.gitleaksignore`, `SECURITY.md`, `docs/runbooks/github-security.md`,
  `src/populus/net/bounded_http.py`, `src/populus/parse/xml.py`,
  `dashboard/src/lib/inline-json.ts`, `dashboard/public/theme-init.js`,
  plus tests `tests/test_bounded_http.py`, `tests/test_untrusted_xml.py`,
  `dashboard/test/inline-json.test.ts`. (`dashboard/public/_headers` was
  already tracked; the security run modified it.)
- **Added and NOW TRACKED:** `docs/build/RUN-PUBLIC-SECURITY-HARDENING-plan.md`
  — previously untracked/owner-local. **Stale plan anchor:** the plan's
  Active-work exemption and the cross_run_overlap "owner-run only" rationale
  describe the security plan as untracked; after the PRs merge it is tracked.
  The i2 plan remains untracked, so the owner-run-only property of
  `cross_run_overlap.py` still holds (one of its two inputs stays owner-local).
- The four T0.0 tooling files (this program's own adds).

Dirty-tree annex, re-derived read-only from the MAIN checkout
(`/Users/johnbaek/projects/Populus`, at `49bcf9d`, `git status --short`):

```
 M .claude/launch.json
 M REVIEW.md
?? docs/build/ALPHA-SURFACES-V2-DEV-HANDOFF.md
?? docs/build/ALPHA-UX-DEV-HANDOFF.md
?? docs/build/BACKLOG-deploy-closeout.md
?? docs/build/RUN-I-2-INSTITUTIONAL-TICKER-ACTIVATION-DEFERRAL.md
?? docs/build/RUN-I-2-INSTITUTIONAL-TICKER-ACTIVATION-plan-review-r1..r7 (8 files)
?? docs/build/RUN-I-2-INSTITUTIONAL-TICKER-ACTIVATION-plan.md
?? docs/build/RUN-P3-3-plan.md
?? docs/build/RUN-PUBLIC-SECURITY-HARDENING-plan.md
?? docs/build/RUN-SURFACES-LEGIBILITY-HANDOFF.md
?? docs/build/UX-OVERHAUL-HANDOFF.r1.md
?? docs/design/ALPHA-SURFACES-V2-PLAN.md
?? docs/design/ALPHA-UX-PLAN.md
?? docs/design/LEGIBILITY-RESPONSE-PLAN.md
?? docs/design/UX-OVERHAUL-PLAN.planned-files.json
?? docs/maintenance/
```

Annex deltas vs the plan's version (recorded at `20e2577`):

- **Gone:** `src/populus/manager_registry.yaml` untracked entry (main synced
  past `b4787ff`; the file is tracked and clean — K3 confirmed executed);
  `.tmp.40825`; `docs/build/RUN-SURFACES-LEGIBILITY-plan.md`, `-REVIEW.md`,
  `.planned-files.json`; `docs/design/SURFACES-LEGIBILITY-PLAN.md`;
  `docs/design/handoff/Surfaces Legibility.dc.html` — the SURFACES leftovers
  the annex marked "owner decides" have been removed by the owner.
- **New:** `docs/build/RUN-I-2-INSTITUTIONAL-TICKER-ACTIVATION-DEFERRAL.md` —
  the formal I-2 deferral record. Classified ACTIVE PLANNING RECORD; satisfies
  K5's deferral arm.
- All remaining entries match the plan's classifications; no reclassification
  needed.

Stale plan anchors found (report only; the plan is owner-owned):

1. Every `20e2577` citation (header preconditions, dirty-tree annex header)
   → the commit is now `49bcf9d` on `origin/main`.
2. The security plan described as untracked (Active-work exemption, Standing
   limitations, T0.6 block) → tracked once PRs merge (see above).
3. Planned Files "Delete" row for `scripts/build_m2_11_qa_bundle.py` /
   `tests/test_m2_11_qa_bundle.py`: "CEDED — removed by security PR 2" → the
   security run's final scope **kept and parameterized** them (see T0.4).
4. R3's five-file table narrative ("three are removed by the security run") →
   only `.claude/launch.json` was removed; the two M2-11 files were cleaned in
   place.
5. K5 language "I-2 landed or formally deferred" → now satisfied via the
   DEFERRAL record; I-2 sequencing constraints dissolve (T0.4).

## T0.4 — overlap re-measurement

Command (owner-run form, exit code **0** = scanned clean):

```
python3 scripts/maintenance/cross_run_overlap.py --ref origin/main \
  --plan sec=/Users/johnbaek/projects/Populus/docs/build/RUN-PUBLIC-SECURITY-HARDENING-plan.md \
  --plan i2=/Users/johnbaek/projects/Populus/docs/build/RUN-I-2-INSTITUTIONAL-TICKER-ACTIVATION-plan.md
```

Full output, verbatim:

```
note: sec: 245 backticked span(s) resolved to nothing and are not path-shaped (--show-dropped to list)
note: i2: 1034 backticked span(s) resolved to nothing and are not path-shaped (--show-dropped to list)
S1 docs       surface=142  SEC= 6  I2= 8  BOTH= 4  BLOCKED(union)=10  FREE=132
    sec: ARCHITECTURE.md, Makefile, README.md, STATUS.md, dashboard/README.md, docs/runbooks/deploy.md
    i2: ARCHITECTURE.md, BACKLOG.md, Makefile, dashboard/README.md, dashboard/docs/qoq-presentation.md, docs/build/RUN-M2-6-plan.md, docs/runbooks/deploy.md, docs/runbooks/rollback.md
    both: ARCHITECTURE.md, Makefile, dashboard/README.md, docs/runbooks/deploy.md
S2 CI         surface=  1  SEC= 1  I2= 0  BOTH= 0  BLOCKED(union)= 1  FREE=  0
    sec: README.md
    verify-only (not edited by this slice): .github/workflows/checks.yml, tests/test_workflow_governance.py
S3 scripts    surface= 24  SEC= 3  I2= 5  BOTH= 2  BLOCKED(union)= 6  FREE= 18
    sec: Makefile, pyproject.toml, scripts/build_m2_11_qa_bundle.py
    i2: Makefile, docs/runbooks/rollback.md, pyproject.toml, scripts/accept_m2_11.py, scripts/inst_snapshot.py
    both: Makefile, pyproject.toml
S4 comments   surface=132  SEC=23  I2=35  BOTH=13  BLOCKED(union)=45  FREE= 87
    sec: dashboard/src/components/HoldingsTable.astro, dashboard/src/layouts/Base.astro, dashboard/src/lib/format.ts, dashboard/src/lib/inst.ts, dashboard/src/lib/ui.ts, dashboard/src/pages/congress/index.astro, dashboard/src/pages/institutional/filers/[cik].astro, dashboard/src/pages/institutional/index.astro, dashboard/src/pages/institutional/tickers/[t]/holders.astro, src/populus/canonical.py, src/populus/cli.py, src/populus/deploy/orchestrator.py, src/populus/deploy/record.py, src/populus/deploy/snapshot.py, src/populus/deploy/upload.py, src/populus/deploy/verify.py, src/populus/ingest/house.py, src/populus/ingest/senate.py, src/populus/members.py, src/populus/net/sec_client.py, src/populus/parse/inst13f.py, src/populus/publish/digests.py, src/populus/publish/inventory.py
    i2: dashboard/src/components/HoldingsTable.astro, dashboard/src/lib/data.ts, dashboard/src/lib/derive.ts, dashboard/src/lib/holdings.ts, dashboard/src/lib/inst.ts, dashboard/src/lib/ui.ts, dashboard/src/pages/congress/data/feed.v1.json.ts, dashboard/src/pages/congress/tickers/[ticker].astro, dashboard/src/pages/institutional/data/adds/[period].[mode].v1.json.ts, dashboard/src/pages/institutional/filers/[cik].astro, dashboard/src/pages/institutional/index.astro, dashboard/src/pages/institutional/tickers/[t]/holders.astro, dashboard/src/pages/search/index.v1.json.ts, dashboard/src/scripts/entity-client.ts, dashboard/src/scripts/feed-client.ts, dashboard/src/scripts/search-client.ts, dashboard/src/scripts/watchlist-client.ts, src/populus/canonical.py, src/populus/cli.py, src/populus/deploy/cloudflare.py, src/populus/deploy/orchestrator.py, src/populus/deploy/record.py, src/populus/deploy/upload.py, src/populus/identity/bootstrap.py, src/populus/inst_agg.py, src/populus/inst_budget.py, src/populus/licenses.json, src/populus/licenses.py, src/populus/net/sec_client.py, src/populus/publish/__init__.py, src/populus/publish/attestation.py, src/populus/publish/build.py, src/populus/publish/digests.py, src/populus/publish/manifest.py, src/populus/securities.yaml
    both: dashboard/src/components/HoldingsTable.astro, dashboard/src/lib/inst.ts, dashboard/src/lib/ui.ts, dashboard/src/pages/institutional/filers/[cik].astro, dashboard/src/pages/institutional/index.astro, dashboard/src/pages/institutional/tickers/[t]/holders.astro, src/populus/canonical.py, src/populus/cli.py, src/populus/deploy/orchestrator.py, src/populus/deploy/record.py, src/populus/deploy/upload.py, src/populus/net/sec_client.py, src/populus/publish/digests.py
    -> 4a free=87   4b blocked=45
S5 mcp        surface=  5  SEC= 0  I2= 0  BOTH= 0  BLOCKED(union)= 0  FREE=  5
S6 ui/css     surface= 70  SEC= 2  I2=15  BOTH= 1  BLOCKED(union)=16  FREE= 54
    sec: dashboard/src/layouts/Base.astro, dashboard/src/lib/ui.ts
    i2: dashboard/src/lib/ui.ts, dashboard/src/scripts/entity-client.ts, dashboard/test/client-wiring.test.ts, dashboard/test/derive.test.ts, dashboard/test/fixtures/make-inst-preview.py, dashboard/test/holders-browser/holders.spec.ts, dashboard/test/holdings.test.ts, dashboard/test/inst.test.ts, dashboard/test/pages-render.test.ts, dashboard/test/post/file-budget.test.ts, dashboard/test/post/fixture-preview.test.ts, dashboard/test/post/http-status.test.ts, dashboard/test/r-codex-regressions.test.ts, dashboard/test/search.test.ts, dashboard/test/ui.test.ts
    both: dashboard/src/lib/ui.ts
```

Exit code: **0**. The counts match the plan's published table exactly — no
count moved, so no `--show-dropped` re-run is required by the plan's own rule.

Interpretation — which sequencing constraints dissolve:

- **I-2 is formally DEFERRED**
  (`docs/build/RUN-I-2-INSTITUTIONAL-TICKER-ACTIVATION-DEFERRAL.md`), so every
  I-2-only hold dissolves: S1's `BACKLOG.md`, `qoq-presentation.md`,
  `RUN-M2-6-plan.md`; S3's `accept_m2_11.py` (may move again) and
  `inst_snapshot.py` (stays put for its own reasons anyway); S4's 22 I-2-only
  files; S6's 14 I-2-only files. K5 is satisfied via the deferral arm.
- **The security run is code-complete on open PRs #57–#61.** Its holds remain
  in force until the owner merges; on merge, all SEC-only and BOTH files
  unblock. Residual intersection is therefore **explicitly sequenced, not
  empty**: everything security-owned waits for the merge; nothing waits on I-2
  any longer; Slice 6 additionally waits on FILER-IDENTITY (still active).

### M2-11 tooling disposition (prominent finding)

The plan's D14/K2 branch said: the security run removes
`scripts/build_m2_11_qa_bundle.py` and `tests/test_m2_11_qa_bundle.py`; if it
"drops them from its scope, this program reclaims them under D14". **Neither
branch occurred as written.** The security run's final scope **kept both files
and parameterized them**: the builder now takes required CLI flags instead of
owner-path globals. Verified on `prof/slice-0`:
`git grep -n "/Users/johnbaek" -- scripts/build_m2_11_qa_bundle.py
tests/test_m2_11_qa_bundle.py` → **no matches** (exit 1).

Consequence for R3: its five-file table changes shape. Of the five,
- `.claude/launch.json` — **deleted** by the security run (as planned);
- `scripts/build_m2_11_qa_bundle.py`, `tests/test_m2_11_qa_bundle.py` —
  **CLEAN in place**, not deleted; R3 closure now relies on their
  parameterization, which is done;
- `docs/runbooks/self-hosted-runner.md:403` — still open, T3.10 parameterizes;
- `REVIEW.md:4` — still open, K7: owner deletes at review-cycle close.

D14/K2's documentation arm (delete the `docs/build/RUN-M2-11-*` family) is
unaffected; only the tooling-file deletion row is superseded. No reclaim is
needed — the files are clean and stay.

## T0.6 — gate baselines (untouched tree, gates invoked by path)

1. `bash scripts/maintenance/check_links.sh` → **exit 0**, no output.
   Slice 1 baseline: clean; no pre-existing breakage to exclude.
2. `bash scripts/maintenance/check_abs_paths.sh` (ref mode, `origin/main`) →
   **exit 1**, `22 occurrence(s), 0 anomaly(ies) in 5 file(s)`:
   `.claude/launch.json:6` (1), `REVIEW.md:4` (1),
   `docs/runbooks/self-hosted-runner.md:403` (1),
   `scripts/build_m2_11_qa_bundle.py` (5 occurrences),
   `tests/test_m2_11_qa_bundle.py` (14 occurrences).
   Expected: `origin/main` predates the security merges; this is exactly the
   pinned five-file R3 baseline.
3. `bash scripts/maintenance/check_abs_paths.sh --worktree` (candidate tree,
   incl. untracked) → **exit 1**, `2 occurrence(s), 0 anomaly(ies) in 2
   file(s)`: `REVIEW.md:4` (K7 — owner deletes) and
   `docs/runbooks/self-hosted-runner.md:403` (T3.10). This measures the
   security-run improvement directly: 22 → 2 occurrences; the only survivors
   are the two the plan already assigns owners.
4. `cross_run_overlap.py` (owner-run form above) → **exit 0**. No invocation
   ever returned 2 in this pass; every measurement happened.
5. Tooling suite: 397 passed (T0.0).

## K-gate landing-condition status

- **K3** — executed and confirmed: `manager_registry.yaml` clean vs
  `origin/main`.
- **K5** — SATISFIED via the deferral arm (I-2 DEFERRAL record exists).
- **K6** — code-complete: PRs #57–#61 open with all five branches stacked at
  `35ef466`; **merges pending owner**. Security-owned holds stay until then.
- **K7** — `REVIEW.md` still present and still carries the R3 occurrence at
  line 4; R3 is **not closeable yet**.
- Slice 0 decided nothing; it confirmed the landing conditions above.
