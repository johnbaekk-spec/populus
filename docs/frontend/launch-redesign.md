# Launch redesign — decision record

- Approved mock: https://claude.ai/artifact/9xxeAvHRP53NHgRZ1k4jVU (Design canvas, version 9, approved by the owner on 2026-10-20 "including the mobile scope"). The spec record is untracked in the main checkout at `docs/design/launch-redesign-mock/`.
- Plan: `PLAN.md` at the worktree root (plan-v1, approved 2026-10-21, decisions D1–D7). This file grows with each milestone (LD34). M0 writes only the baseline.
- Run records (untracked, main checkout): `docs/design/launch-redesign-run/M0/`.

## Baseline (M0)

<!-- launch-t0:begin -->
**T0.1.** #163 was merged by rebase at 2026-10-21T04:53:04Z. `origin/main` = 80694e344c1e5e07e137595f2a9a08062053c231.

**T0.2.** `feat/launch-redesign` was rebased onto `origin/main`. 64b19e8 was skipped as already applied: its patch-id equals da51e48's. HEAD = `origin/main` = 80694e3, and `git rev-list --count origin/main..HEAD` = 0. The worktree has its own `uv sync --frozen` and `npm ci` (no symlinked `node_modules`), `npx --no-install astro --version` reads v7.3.4, and the tree is clean.

**T0.3 — contributor tier and TEST_CMD.** These ran in `.claude/worktrees/launch-redesign-base`, a detached worktree at 80694e3 with its own installs, on 2026-10-21 from 04:59:56Z to 05:35:45Z. The tree signature was identical before and after: HEAD 80694e3, with empty status and diff.

| Command | Exit | Pass / Fail / Skip |
|---|---|---|
| `uv run pytest -q` | 1 | 3853 / 2 / 11 |
| `npm run check` | 0 | 0 errors, 0 warnings, 1 hint |
| `npm test` | 0 | 1202 / 0 / 0 |
| `make security` | 2 | pip-audit: 9 known vulnerabilities in 2 packages (below); `npm audit` not reached |
| `make abs-paths` | 0 | clean |
| `git grep -nE 'inst_budget\.py:[0-9]' -- dashboard` | — | no Python line citations |
| TEST_CMD (Rollout step 5, exact) | **0** | pytest 3853 passed, 11 skipped, 2 deselected; check 0 errors; npm test 1202 / 0 |

**T0.3 — owner tier, speed mode.** This deviates from the plan. On the owner's overnight authorization, the coordinator directed on 2026-10-21 at 08:10Z that only the 20261019.2 leg run: production data with the CI env (`CI=true`, `POPULUS_TICKER_MAP`, `POPULUS_PRIOR_SIGNALS`), plus `test:holders-browser`. **The 20260817.1 leg was skipped.**

The script was Rollout step 4 as written, with two changes: holders-browser also runs on 20261019.2, and each step's wall time is recorded. Everything else in step 4 was kept:

- the in-progress check (0 runs in progress at the start);
- the owner-gates lock;
- `rm -rf dist`, and stop on a build failure;
- the HEAD and status check, with a tree signature before and after. Both were frozen at 80694e3.

It ran 08:19–10:05Z. Seven milestone dev agents were running `npm ci` and `npm test` on the same machine (load averages 50–170). No publish ran during it, according to the publish watch log.

| Command (20261019.2) | Exit | Wall time | Result |
|---|---|---|---|
| `npm run build:bounded` | 0 | 1,747 s | 10,269 pages; 17,818 files; `dist/signals/index.html` 1,856,423 B; `dist/institutional/index.html` 4,166,624 B |
| `npm run test:post` | 1 | 3,991 s | 112 tests: 68 pass / 43 fail / 1 skip |
| `npm run test:geometry` | 1 | 439 s | 1,058 pass / 29 fail / 69 skip |
| `npm run test:holders-browser` | 1 | 183 s | no test ran: "Timed out waiting 180000ms from config.webServer" |
| re-run at load ~15: `node --test test/post/entity-orchestration.test.ts` | 0 | 918 s | 28 pass / 0 fail |
| re-run at load ~10, CI env: `npm run test:holders-browser` | 1 | 181 s | no test ran; the same webServer timeout |
| re-run at load ~11, without `CI`, `POPULUS_TICKER_MAP` or `POPULUS_PRIOR_SIGNALS` (the env step 4 gives this lane on 20260817.1) | 0 | 136 s | 33 pass / 0 fail / 0 skip |

**Holders and the CI env.** Under the CI env, the holders lane's dev server never answers, even on a quiet machine. Run it without the three CI variables, as Rollout step 4 does on 20260817.1.

**Failing on clean `main`, data build 20261019.2.** A later run regresses if a test outside these lists fails, or a listed test fails for a different reason. The full names are in `t0-owner-20261019.2/{post,geometry,holders}-fails.txt` in the run records.

- **pytest (2)**, in `tests/test_maintenance_tooling.py`: `test_cross_run_exits_zero_on_the_current_tree` and `test_cross_run_f34_round_two_forms_do_not_move_a_live_span`. Both read untracked owner plan documents in the main checkout.
- **test:post: 15 code or data names, plus 28 from the environment.**
  - 13 are the by-name set of `docs/maintenance/POST-BUILD-BASELINE.md`: the 10 fixture-preview names of set A, and B 12, 13 and 14.
  - 2 are bound to this data build and also failed in the 2026-10-19 production repro: `POST-BUILD R23: every SRC §5 observed string returns 0 in dist's visible text …` and `R16/R17 over the build: every ticker page is two tabs over two visible panels …`.
  - The other 28 are every test in `test/post/entity-orchestration.test.ts`. Its `before` hook failed with "forced-cut build timed out after 1801 s (the cap is 1800 s)", the shared-machine contention failure. All 28 pass on the re-run at lower load (918 s), so they are not part of the T0 set.
  - **The T0 test:post set is therefore those 15 names** (`post-fails.txt`). The raw first run is `post-fails-run1-raw.txt`.
- **test:holders-browser: 0 failing names** (33 / 0 / 0, without the CI env).
- **test:geometry (29)**: all 29 are in main's 34 on the same data (2026-10-19). The five that #160 and #161 fixed now pass: signals-v4 T1.4 at 721, 1081, 1200 and 1440, and T1.2 at 390.
  - `design-reference.spec.ts` (3): the Institutional and Signals canvas comparisons at 1440, and T2.9 (M3) allowances expired.
  - `layout-negative.spec.ts` (1): M2 G12 @390, the filer sticky issuer column.
  - `sl-notes.spec.ts` (2): SL-R24 on `/institutional/`, in chromium and touch.
  - `ledger.spec.ts` (23: 12 chromium, 11 touch):
    - ticker-inst: G6 @1440 and @390;
    - home: G3 @1440, G10 @1440 and @390;
    - e-filer: G6 @1440 and @390;
    - congress: G8 @390;
    - institutional: G12 @390;
    - filer: G12 @390, and @1440 in touch only;
    - holders: controlHeights @1440, chromium only;
    - M2 T2.11 institutional @1440, chromium only.
- **make security.** Repository-wide; the separate fix(deps) PR handles it.
  - pip-audit flags certifi 2026.7.22 (PYSEC-2026-4320) and pillow 12.3.0 (CVE-2026-112395, -112397, -112400, -112404, -112895, -112896, -112897 and -112899).
  - `npm audit`, run separately, flags vite 8.0.0–8.1.5 (GHSA-698v-4r3x-3vcv, GHSA-r825-w8mm-5pxw and GHSA-587h-7wmj-h5pm).

**T0.5 — live baseline.** Run on 2026-10-21 from 15:05 to 15:15Z against live **build 20261020.2, code e51df89**, which predates #163. It used Rollout step 9 as written (`playwright.production.config.ts`, the ledger spec), in both themes:

| Theme | Pass | Fail | Skip |
|---|---|---|---|
| dark | 819 | 23 | 69 |
| light | 819 | 23 | 69 |

The 23 names are the same in each theme and are exactly the 23 `ledger.spec.ts` names above. **A post-#163 live re-baseline follows today's deploy.** The 2026-10-21 publish, run 39596058654, was created at 11:59:23Z and was still queued at 15:05Z.
<!-- launch-t0:end -->

## T0.4 — production-data measurements

These were taken from the dist the owner tier left at `.claude/worktrees/launch-redesign-base/dashboard/dist` (data build 20261019.2, code 80694e3), served by `astro preview`, between 10:05 and 10:09Z. The scratch scripts and their raw output are in `t04-base-20261019.2/` in the run records.

**First-load DOM elements at 390, JavaScript on**, measured with the mock's audit algorithm (iPhone user agent, touch):

| Route | Elements |
|---|---|
| `/` | 280 |
| `/congress/` | 5,341 |
| P000197 | 3,474 |
| J000289 | 481 |
| G000583 | 13,833 |
| `/tickers/AAPL/` (both tabs) | 6,464 |
| `/signals/` (every tab) | 35,446 |
| `/institutional/` | 1,679 |
| filer 1067983 | 2,768 |
| holders AAPL | 4,851 |
| `/methodology/` | 747 |
| `/congress/data/` | 320 |
| 404 | 57 |

The routes over 3,000 are Congress, P000197, G000583, the ticker, Signals and holders. The same audit at 360, 390 and 430 finds 35, 33 and 30 sideways tables, 3,367, 3,366 and 3,366 sub-44px taps, and at most 46% of a view's text under 11px (Signals Overlap).

**HTML and inline JSON:**

| Route | HTML | Inline JSON |
|---|---|---|
| `/institutional/` | 4,166,624 B | 4,025,382 B (96.6%): `#inst-index-data` 3,503,306 B, `#inst-adds-data` 522,076 B |
| filer 1067983 | 321,838 B | 170,228 B: `#holdings-data` 115,294 B, `#filer-period-data` 54,934 B |
| `/congress/` | 286,757 B | 8,871 B (`#feed-parts-index`) |
| `/signals/` | 1,856,423 B | none |
| G000583 | 662,533 B | none |
| ticker AAPL | 361,933 B | none |
| holders AAPL | 186,333 B | none |

The feed parts are 31 files totalling 23,178,782 B: what a quick filter downloads (TD-L1).

**Files.** The dist holds 17,818 files, equal to `stats.json` `site_file_count`. That leaves **182 files of headroom** under 18,000.

**`/signals/` per tab panel** (JavaScript on, 390). The page is 35,446 elements; its DOM serialises to 1,861,813 B.

| Panel | Elements | Bytes |
|---|---|---|
| Congress | 5,932 | 304,305 |
| Institutional | 21,288 | 1,134,061 |
| Overlap | 7,645 | 384,344 |
| Playbooks | 442 | 29,070 |
| outside the panels | 139 | — |

**Held-row classes**, LD27's starting point:

| Class | Rows | Elements | Bytes | Without JavaScript |
|---|---|---|---|---|
| held move rows (empty `.mv-det`) | 624 | 13,479 | 706,357 | none visible |
| full move rows | 146 | 4,580 | 244,995 | 15 visible |
| Congress-lines bank | 102 lines | 1,805 | 92,104 | behind its `<details>` |
| Overlap names past the first view | 72 | 6,508 | 326,242 | hidden |
| hit lines past the first ten | 30 | 570 | 50,978 | hidden |
| Consensus rows past the first ten | 40 | 640 | 33,880 | hidden |
| triage rows (D6 keeps them) | 51 | 4,886 | 214,657 | 20 visible, 31 behind the Routine `<details>` |

**Visible words at T0** use the audit's rule: its pipeline over the served HTML, plus its two in-row additions. In each pair below, the first number is T0 and the one in parentheses is the audit's `words_visible_before`.

- home 229 (228); Congress 632 (633); one-trade member 324 (324); active member 370 (370).
- Signals tabs: Congress 289 (288), Institutional 210 (210), Overlap 113 (113), Playbooks 948 (946).
- ticker tabs: Congress 374 (374), Institutional 598 (595).
- Institutional 449 (444); Filer 472 (472); **Holders 318 (297)** — the +21 is #163's §13107(c) line.
- Stubs: leaders 131 (131), tickers 179 (177).
- Methodology 5,126 (5,101).

Planted controls pass on this dist as well.

**The ruler's positive control** ran on live 20261020.2, the build the audit measured. The same pipeline reproduces all 16 audited page states exactly (0.0%). The same rule over the browser DOM with JavaScript on does not:

| Page state | Browser count with JS on | Audit | Difference |
|---|---|---|---|
| Signals Congress | 199 | 288 | −31% |
| Signals Institutional | 227 | 210 | +8% |
| Signals Playbooks | 347 | 946 | −63% |
| `/congress/leaders/` stub | 636 | 131 | the browser follows the redirect to `/congress/` |
| `/congress/tickers/` stub | 636 | 177 | the browser follows the redirect to `/congress/` |

So the audit's numbers, and SC5's gates, are counts of the served HTML (no JavaScript). The word predicate must count the served HTML, or run with JavaScript disabled.

## Declared route additions (LD34, R35, T7.7)

`post/signals-v4-dist.test.ts` T1.1 compares the dist's route set (every file outside `_astro/`) with the signals-v4 T0 baseline (`docs/frontend/signals-v4.md`, block `t0-baseline`). The launch redesign adds one file family, declared here. T1.1 takes the files that match a declared pattern out of the route list, checks that each family's count is between 1 and its stated maximum, and compares the remainder with T0 file for file. A route the redesign adds without declaring it here, or a family that grows past its maximum, fails T1.1.

<!-- launch-routes:begin -->
added: ./institutional/data/directory/{n}.v1.json max 8 (M7b, LD28, LD29: the /institutional/ directory shard family; the maximum is `INST_DIRECTORY_SHARDS_MAX` in `src/populus/inst_budget.py`)
<!-- launch-routes:end -->

Each line reads `added: <path pattern> max <n> (<reason>)`. `{n}` stands for a non-negative integer. The redesign adds no page route and removes none.

## D6 — /signals/ first-load DOM (measured exception, not gated)

D6 keeps the triage-row bodies in the page. LD27's step 1 moved the held move rows, the Congress-lines bank, the Overlap names past the first view and the hit lines past the first ten into JSON islands. Whatever the page still carries above the 3,000-element budget is recorded here for the owner. Nothing more is cut without a new owner decision.

The phone harness measures each Signals tab's hash load at 360, 390 and 430 and reports it as a `D6 measured` annotation. It does not gate the count. The map is `dashboard/test/geometry/dom-budget.ts`, pinned by `dashboard/test/launch-dom-budget.test.ts`.

| Measurement | Elements |
|---|---|
| T0, production data 20261019.2, every tab, JavaScript on, 390 | 35,446 (Congress 5,932; Institutional 21,288; Overlap 7,645; Playbooks 442; outside the panels 139) |
| Integrated tree, fixture body, served HTML (the R31 test's element counter) | 5,069, with the Named moves island holding 192 rows (4,024 elements not built until revealed) |
| Review measurement, fixture page, first load | 7,280 |
| Integrated tree, production data | not measured yet: the owner-tier run on the integrated tree records it |

Every other LD31 route gates at 3,000 from this tree on. That includes /congress/, whose board slimming lands separately: until it does, /congress/ fails the gate, which is the honest state (T0: 5,341).

## Speed-mode deviations

The owner authorized autonomous overnight completion on 2026-10-21. The coordinator recorded these departures from the plan's letter. Each one keeps the plan's property.

- **Word gates where a decision keeps words (SC5, LD3).** Where an owner decision or an honesty pin keeps words the copy audit proposed to cut, that page's word gate is the audit's `words_visible_after`, plus the retained words (counted and itemized), plus 10%. This was the coordinator's decision during the M7b integration. It is measured on the served HTML of the real build.
  - **Active member page: gate 233, measured 232.** The retained-words rule applies because D7 keeps the 13F footer sentence verbatim. The gate-fix round brought the page from 260 to 232 words: the sector gap's two causes moved into a tip, and an empty quarter's readout now says "none disclosed" once. No caveat was dropped.
