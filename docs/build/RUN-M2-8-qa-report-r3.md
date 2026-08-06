# qa-report-v1: RUN M2-8 — T7–T16, QA ROUND 3 (the decisive round)

**Transport:** `interactive-disk`. **Worktree:** `/Users/johnbaek/projects/Populus-m28`,
branch `feat/run-m2-8-surfaces` off `7ab75ec`. No other worktree was touched.

**Source-read-only, proved rather than asserted.** A source-only fingerprint over every
tracked file plus the 18 untracked paths was taken before and after this pass:
`d41e75d9299d1c8f001aa5cb66655dfe5cd22989acb3c26ddecf2bd5284b6620` both times.
`git status --porcelain -uall` is byte-identical before and after (`md5
7134638714a81b13b72b235e78cf7a6b`), still 21 modified / 18 untracked. Every one of the
**42 mutations** below was reverted in a `finally` with a per-file SHA-256 restore
assertion. The only file this pass authored is `QA-REPORT-R3.md`.

**Scope.** Round 1 (`QA-REPORT.md`) raised 6 Critical + 16 Major. Round 2
(`QA-REPORT-R2.md`) re-verified that remediation, killed 17 of 19 mutations, reproduced
every gate figure, and returned **FAIL on four narrow blockers (N1–N4)** plus N5. A third
agent then fixed N1–N5 and claimed 14/14 mutations killed and every gate green. **None of
that was taken on trust.** Every claim below was re-verified by execution, with an
independently chosen mutation set — including mutations the fixer had no reason to
anticipate.

## Detected Stack

Detected fresh, not cached. **Python 3.12** (`.python-version`, `requires-python >=3.12`)
via `uv` with a frozen lockfile (44 packages audited in this run); `pytest`; `click`;
SQLite + JSON1; `httpx`/`lxml`/`pdfplumber`/`pypdf`/`pyyaml`; HTTP only through
`SecClient`. **Dashboard:** Astro `^7.1.6` (`output: "static"`), **Node v24.16.0** with
native TS stripping, `node:sqlite` `DatabaseSync`, **`node --test`** (not Vitest).
Repository-owned gate entrypoints (`Makefile`): `make check` = `make test`
(`test-python` → `uv sync --frozen` + `uv run pytest -q`; `dashboard-gates` → `npm ci` +
`npm run gates` = `check && test && build && test:post`) + `make security`
(`scripts/dep_guard.py`). Acceptance targets: `accept-m1-b`, `accept-m2-5`, `accept-m2-6`,
`accept-m2-8`. **No lint entrypoint is declared and no lint tool is installed** (`.venv/bin`
carries no ruff/flake8/mypy) — reported `unavailable`, never `pass`.

## Summary

**The remediation holds. I set out to break it with a mutation set I chose myself, and I
could not break it anywhere.** All four round-2 blockers are fixed, and each fix was
verified by making the defect return rather than by reading the diff:

* **N1 (budget arithmetic) — VERIFIED-FIXED, and the arithmetic re-derived independently.**
  I counted the built tree myself: **12,545 files**, of which `congress/` 8,558 +
  `tickers/` 3,884 = **12,442** (`M1_MEASURED_PAGES`) and the remaining **103** decomposes
  exactly as documented (`_astro/` 91 + twelve fixed top-level files). `12,442 + 103 +
  1,500 + 64 + 2,064 = 16,173` against a 15,000 self-cap — **1,173 over**, which is what
  `accept-m2-8` now prints term by term. Largest file `congress/data/feed.v1.json` at
  **11,962,205 B**, matching the recorded figure to the byte. **Nothing shrank:** every cap
  and reservation is at its round-2 value, and mutations that shrink `M3_RESERVED` or raise
  `GLOBAL_FILE_CAP` are both KILLED by an exact-literal assertion.
* **N2 (exit classification) — VERIFIED-FIXED.** The mutation that survived round 2
  (`!= 1` → `< 1`) is **KILLED**, along with two harder variants (`> 1`, and dropping the
  guard entirely).
* **N3 (activity NULL-honesty) — VERIFIED-FIXED, including the fixture's honesty.** The
  round-2 survivor (`curr_shares or 0`) is **KILLED**, as is `or 0` on **all six** nullable
  columns in the projection *and* in the writer's INSERT tuple. I measured the fixture
  directly: it carries a real NULL in **every one of the six** columns at the aggregate
  source and in `serving_activity`. And I proved the non-vacuity guard is not decoration —
  narrowing the fixture so one column loses its NULL makes the test **FAIL by name**
  (`… so \`x or 0\` on the uncovered one(s) would survive: ['prev_value_usd']`).
* **N4 (per-record provenance) — VERIFIED-FIXED, and the fixer's override is correct.**
  ARCHITECTURE §5.1 names the accession number as `source_record_id`, and
  `inst_queries._holding_to_dict` does emit `source_accession`; the docstring the fixer
  overrode was factually wrong and the code change is right. Four mutations on that path —
  restamping, nulling either plane, restoring the `= None` default — are all **KILLED**,
  by tests that run against real SEC corpus bytes (110 base rows + 4 amendment rows,
  asserted per accession).
* **N5 (`DEV-NOTES.md`) — VERIFIED-FIXED, exactly.** 21 modified / 17 created /
  2,071 insertions / 152 deletions / 9,999 lines in the new files all reproduce to the
  number, and **every path `git status --porcelain -uall` reports appears in its
  changed-file list** (checked path by path, not sampled).

**42 of 42 mutations killed. Zero survivors.** Every gate figure reproduces: `make check`
exit 0, pytest **1924 passed / 8 skipped**, dashboard unit **221/221**, `astro check` 0
errors, `astro build` **8,170 pages** (I counted the HTML files myself), post-build
**36/36**, `dep_guard: OK`, and all four acceptance targets exit 0.

**I looked hard for the pattern that caught the last two rounds — a fix that reproduces a
smaller instance of the defect it is fixing — and it did not recur in the code.** An AST
scan for module-level names assigned and never read across every file this pass touched
returns nothing; the N1 constant is in `__all__`, is a parameter of the projection, is
printed term-by-term by the acceptance gate, and is asserted load-bearing by a test that
fails if the term stops moving the total.

Two Major findings remain, neither of them a defect in the N1–N5 remediation and neither a
blocker on the engineering:

1. **P1 — `ARCHITECTURE.md:389` still publishes an unbacked number as a measurement.** The
   pattern recurs here, in prose rather than in code: the disclosure that the figure is
   unverified lives only in `DEV-NOTES.md`, which `.git/info/exclude` keeps permanently
   untracked, while the claim itself is in a tracked file that this increment changed.
2. **N6 — `sortHoldingRows`'s comparator is still inconsistent, and is now undeclared.**
   Reproduced independently; bounded in practice, but it is the one round-2 finding that is
   neither fixed nor written down anywhere durable.

Both are one-line changes. Neither touches the design.

## Requirement Coverage

Round 2's blockers, each traced from the finding through the Dev Notes claim, the changed
paths, the diff and an executed probe.

| ID | Dev Notes claim | Round-3 verdict | Proof (executed, not read) |
|---|---|---|---|
| **N1** budget under-report | fixed; term is a parameter | **VERIFIED-FIXED** | `src/populus/inst_budget.py:260-297` sums `site_chrome_files`; `__all__:95` exports it. Independent count of `dashboard/dist`: **12,545** total, `congress+tickers` **12,442**, remainder **103** (`_astro` 91 + 12 fixed files). `accept-m2-8` prints `12,442 + 103 + 1,500 + 64 + 2,064 = 16,173 vs self-cap 15,000`. Mutations **R3-17/18/39** (drop the term, zero its default, drop the shard term) all **KILLED**. |
| **N2** exit composition | fixed by two new tests | **VERIFIED-FIXED** | `tests/test_inst_serving.py:871,906`. Mutations **R3-01** (`!= 1`→`< 1`), **R3-02** (`> 1`), **R3-03** (guard removed) all **KILLED**; R3-01 fails as *"an exit was published from a composition holding two contradictory full holdings reports"*. Non-vacuity `_surviving_full_reports(conn) == 2` present. |
| **N3** activity NULL-honesty | fixed by a property test over the aggregate | **VERIFIED-FIXED** | `tests/test_inst_serving.py:625`. Measured fixture NULLs (my own run): all six of `prev_value_usd, curr_value_usd, delta_value_usd, prev_shares, curr_shares, delta_shares` carry a real NULL at source **and** in `serving_activity`. Mutations **R3-04…R3-11** (six columns × projection, plus both writer tuples) all **KILLED**. Fixture-narrowing probes **R3-12/R3-13** **KILLED by the non-vacuity guard itself**. |
| **N4** per-record accession | fixed; parameter now required | **VERIFIED-FIXED** | `envelope.py:119-126` (`accession: str | None`, no default); `server.py:641,1041`. Only two production call sites exist (`grep -rn shape_holding src tests scripts dashboard`), both pass it. Mutations **R3-21/22/23/24/41** all **KILLED**. `test_both_planes_shape_a_holding_identically` asserts route provenance on each plane (`published-serving-projection` vs `federated`), key-set equality, truthiness of all four §5.1 fields on **every** row, and `>1 distinct accession` per plane. |
| **N5** Dev Notes accuracy | re-measured after the fixes | **VERIFIED-FIXED** | `git status --porcelain -uall`: 21 modified, 18 untracked (17 + `QA-REPORT-R2.md`). `git diff HEAD --shortstat`: **21 files changed, 2071 insertions(+), 152 deletions(-)**. `wc -l` over the 17 new files: **9999**. Changed-file list checked path-by-path: **zero omissions**. `DEV-NOTES.md` mtime 16:22 is later than every source mtime (last: `inst_budget.py` 15:58). |
| **N6** comparator | *(not claimed fixed)* | **STILL OPEN, and now UNDECLARED** | See Issues Found. |
| **R19** file budget | enforcing gate + reported projection | **MET** | `check_measured_tree` runs in `test:post` over a real tree (post-build 36/36 green); `accept-m2-8` drives it one file past its cap and confirms refusal; the projection is reported, never asserted. |
| **R20** full gate run | all green | **MET** | `make check` 0, four acceptance targets 0 — reproduced in this pass, see Gate Evidence. |
| **M14** flag deferral | declared, not wired | **HONESTLY SURFACED — not a finding** | `grep -rn classify_position src tests scripts dashboard` returns only the definition, `__all__`, and `tests/test_inst_flags.py`. The deferral is stated in `src/populus/inst_flags.py:36-60`, the module a reader reaches first, including that spec §1.2 and mutations 8–9 are vacuous until it is wired, and that wiring is an owner decision. |
| **File-count breach** | owner decision, surfaced | **HONESTLY SURFACED — not a finding** | `accept-m2-8` prints a `RESERVATION BREACH (owner decision required)` note naming the size (1,173), the terms, the inherited cause, and the three remedies, ending *"It must NOT be re-tuned away here."* `test_the_corrected_projection_BREACHES_the_self_cap_and_that_is_recorded` asserts `(16_173, 1_173)` as literals, so a silent re-tune fails a test (proved: **R3-19/R3-20 KILLED**). |

## Gate Evidence

Full-tree canonical commands from the repository's own entrypoints, run in this pass.
Environment: local data fallback to `../populus-data` (`builds/20260802.2`), no `CI` set.

| Gate | Command | Source | Scope | Exit | Duration | Required | Status |
|---|---|---|---|---|---|---|---|
| test + security | `make check` | `Makefile:117` | full tree, both toolchains | **0** | **601 s** | required | **pass** |
| — python | `uv sync --frozen` + `uv run pytest -q` | `Makefile:43-44` | full tree | 0 | 268 s | required | **pass** — `1924 passed, 8 skipped` |
| — typecheck | `astro check` (in `npm run gates`) | `package.json:14` | dashboard, 33 files | 0 | — | required | **pass** — 0 errors, 0 warnings, 0 hints |
| — dashboard unit | `npm ci` + `npm test` | `package.json:15` | `test/*.test.ts` | 0 | — | required | **pass** — `tests 221 / pass 221 / fail 0` |
| — dashboard build | `astro build` | `package.json:12` | full site | 0 | 105 s | required | **pass** — **8,170 pages** (independently counted: `find dist -name '*.html' \| wc -l` = 8170) |
| — post-build | `npm run test:post` | `package.json:16` | `test/post/*.test.ts` | 0 | 220 s | required | **pass** — `tests 36 / pass 36 / fail 0` |
| security | `uv run python scripts/dep_guard.py` | `Makefile:59` | pyproject + lockfile + import roots | 0 | — | required | **pass** — `dep_guard: OK — no denylisted vendor dependencies or imports` |
| lint | — | not declared, not installed | — | — | — | optional | **unavailable** (never reported as pass) |
| acceptance | `make accept-m1-b` | `Makefile:114` | hermetic M1 chain | **0** | 1.3 s | required | **pass** |
| acceptance | `make accept-m2-5` | `Makefile:65` | full 13(f) list + Berkshire corpus | **0** | 236 s | required | **pass** |
| acceptance | `make accept-m2-6` | `Makefile:78` | hermetic seam chain | **0** | 0.7 s | required | **pass** |
| acceptance | `make accept-m2-8` | `Makefile:96` | projection → artifact → digest → seam → activity → budget | **0** | 0.7 s | required | **pass** |

**Every figure the fixer claimed reproduces exactly.** pytest 1924/8 ✓; dashboard 221 ✓;
post-build 36 ✓; astro build 8,170 pages ✓; `dep_guard: OK` ✓; four acceptance targets
exit 0 ✓. No discrepancy of any kind was found between the claimed and measured gate
figures.

Independently measured from the built tree (not read from any constant):

```
dist/ total files (no symlinks)   12,545     <- equals M1_MEASURED_PAGES + SITE_CHROME_FILES
  congress/  8,558   tickers/  3,884         =  12,442  (M1_MEASURED_PAGES, exact)
  _astro/ 91  +  12 fixed top-level files    =     103  (SITE_CHROME_FILES, exact)
largest file  congress/data/feed.v1.json  11,962,205 B  (recorded figure, to the byte)
accept-m2-8:  12,442 + 103 + 1,500 + 64 + 2,064 = 16,173 vs self-cap 15,000  (1,173 over)
```

### Independent mutation set — 42 applied, **42 KILLED, 0 SURVIVED**

Chosen by QA, not by the author. Applied one at a time, `__pycache__` cleared,
`PYTHONDONTWRITEBYTECODE=1`, run under `set -o pipefail` so no exit code can be masked by a
pipe, then reverted with a hash-checked restore. This set covers **all 19 of round 2's**
(16 verbatim, 3 by a stronger equivalent) plus 23 new ones.

| # | Mutation | Target | Result |
|---|---|---|---|
| R3-01 | **`!= 1` → `< 1`** — round 2's first survivor | exit composition | **KILLED** (2 fail) |
| R3-02 | `!= 1` → `> 1` (zero full reports becomes authoritative) | exit composition | **KILLED** |
| R3-03 | drop the composition guard entirely | exit composition | **KILLED** |
| R3-04 | **`curr_shares or 0`** — round 2's second survivor | activity NULL-honesty | **KILLED** |
| R3-05…09 | `or 0` on `prev_value_usd`, `curr_value_usd`, `delta_value_usd`, `prev_shares`, `delta_shares` | activity projection | **KILLED** (each) |
| R3-10 | writer INSERT tuple fabricates 0 for all three share columns | serialization | **KILLED** |
| R3-11 | writer INSERT tuple fabricates 0 for all three value columns | serialization | **KILLED** |
| R3-12 | **fixture narrowed: AMAZON's prior side becomes disclosed** | N3 non-vacuity | **KILLED** — guard names `['prev_value_usd']` |
| R3-13 | **fixture narrowed: NVIDIA's current side becomes disclosed** | N3 non-vacuity | **KILLED** — guard names `['curr_value_usd']` |
| R3-14 | exit degradation keyed on `prev_period` instead of `curr_period` | exit | **KILLED** |
| R3-15 | degrade the exit silently (drop `exit_not_assertable`) | exit | **KILLED** |
| R3-16 | a NEW_HOLDINGS amendment counts as a full holdings report | exit | **KILLED** |
| R3-17 | drop `site_chrome_files` from the sum — round 2's N1 | budget | **KILLED** |
| R3-18 | zero the site-chrome **default** instead of dropping the term | budget | **KILLED** |
| R3-19 | **shrink `M3_RESERVED` so the projection lands exactly on the cap** | budget | **KILLED** — `assert 15000 > 15000` |
| R3-20 | **raise `GLOBAL_FILE_CAP` above the projection** | budget | **KILLED** — `assert 16173 > 17000` |
| R3-21 | restamp every live row with the filing-level accession | N4 | **KILLED** — `{…: 114} != {…: 110, …: 4}` |
| R3-22 | `source_accession` stops being emitted at source | N4 | **KILLED** |
| R3-23 | published plane ships `accession: null` | N4 | **KILLED** |
| R3-24 | restore the `= None` default | N4 | **KILLED** |
| R3-25 | `foldPositions` stops passing `rowIndex` | C6 | **KILLED** |
| R3-26 | `None` back into `KNOWN_AMENDMENT_TYPES` | exit types | **KILLED** |
| R3-27 | filer grain `value_usd or 0` | NULL-honesty | **KILLED** |
| R3-28 | `serving_activity` loses its primary key | digest | **KILLED** |
| R3-29 | activity `issuer_key` reverts to the private `cusip:` namespace | C3 | **KILLED** |
| R3-30 | remove the unkeyable branch from `positionIdentity` | C6 | **KILLED** |
| R3-31 | `PAGE_BYTE_LIMIT` raised (the pagination ceiling moves) | M8 | **KILLED** |
| R3-32 | `ACTIVITY_SHARDS_MAX` raised (truncation boundary moves) | R19 | **KILLED** |
| R3-33 | delete the `write_serving_db` call in `run_build` | C2 producer | **KILLED** |
| R3-34 | delete the serving artifact's manifest entry | C2 | **KILLED** |
| R3-35 | delete the R10 compensating control call site | M12 | **KILLED** |
| R3-36 | delete the §5 `data_note` render from `HoldingsTable.astro` | M4 | **KILLED** |
| R3-37 | delete the `bullish` banned-wording pattern | M5 | **KILLED** |
| R3-38 | drop the `parse_status` guard | exit | **KILLED** |
| R3-39 | the projection stops summing the activity-shard term | budget | **KILLED** |
| R3-40 | `serving_filer_rows` loses its primary key | digest | **KILLED** |
| R3-41 | stamp one constant accession on every row, both planes | N4 | **KILLED** |
| R3-42 | remove the activity grain's prior-period issuer fallback | R13 | **KILLED** |

Every kill was inspected for the *reason*, not just the exit code: each failure names the
property it was defending, not an incidental collateral error.

## Issues Found

### Critical

**None.**

### Major

**P1 — `ARCHITECTURE.md:389` still publishes "Measured 2026-08-05: 184 B/row" as a
measurement. The only place it is disclosed as unverified is a file git will never keep.**

The tracked line, introduced by this increment (`git diff HEAD -- ARCHITECTURE.md` shows it
replacing the previous `~90 B/row target`), reads:

> **Measured 2026-08-05: 184 B/row** across all three grains on a 1,202-row projection (the
> earlier "~90 B/row target" was an estimate, never a measurement).

`grep -rn "184 B\|1,202"` over the whole tree returns that line plus the two QA reports and
`DEV-NOTES.md` — **no script, gate, test or acceptance target produces a bytes-per-row
figure or a 1,202-row projection.** `ARCHITECTURE.md` carries no `UNVERIFIED` marker on it.
The number is not reproducible from anything committed: I built a real projection and
measured 1,365 B/row on a 21-row artifact (SQLite page overhead dominates at that scale),
which neither confirms nor refutes 184 — that is the point. Nothing in the repository can.

The fixer's handling is recorded at `DEV-NOTES.md:382-393` — *"An unbacked figure was
swapped for an unbacked figure inside a sentence criticising the first for being unbacked.
Left standing rather than silently re-tuned … Recorded here so it is not inherited as
verified."* That reasoning is sound and the honesty is real. **The defect is where it is
recorded.** `.git/info/exclude:10` lists `DEV-NOTES.md`, so that file is permanently
untracked and will never be committed; the claim it qualifies *is* tracked and *will* be.
After the commit, the repository contains the assertion and none of the caveat.

*Failure scenario:* a reader — or a future sizing decision about `inst_serving.db` at full
scale — takes a bolded "Measured 2026-08-05" at face value, exactly as this increment's own
analysis took "~90 B/row" at face value before discovering it was never measured.
[[mockups-are-not-measurements]], third occurrence in this increment.
*Grade:* Major. Not a code defect, not a blocker on the engineering, but it is a false claim
of measurement in a tracked, published document, in a project whose premise is making none.
*Fix direction (one line, before commit):* either produce the measurement in a gate or
script, or replace "Measured 2026-08-05: 184 B/row … on a 1,202-row projection" with an
explicitly unverified estimate. Do not carry the caveat only in `DEV-NOTES.md`.
*This was not introduced by the round-3 pass* — `ARCHITECTURE.md`'s mtime is 14:51, before
round 2's report at 15:39 — so it is a round-1-remediation artifact that has now survived
two rounds of being named.

**N6 — `sortHoldingRows` still uses an inconsistent comparator, and it is now the one
round-2 finding recorded nowhere durable.**

`dashboard/src/lib/holdings.ts:510` calls `positionIdentity(a)` / `positionIdentity(b)`
without the `rowIndex` argument `foldPositions` correctly passes at `:641`. Reproduced
independently, by execution:

```
identity(row0) = unkeyable:2026-03-31:?|LONG|SH
identity(row1) = unkeyable:2026-03-31:?|LONG|SH      (identical)
cmp(a,b) = 1   cmp(b,a) = 1        <- both claim "greater": not a strict weak ordering
sort(rows)     = [2,3,0,1]
sort(reversed) = [3,2,1,0]         <- output depends on input order
same input twice: stable
```

The docstring at `:499-501` promises *"Deterministic display order … Two builds of one
corpus must paginate identically."* That promise **does hold today**, and by luck of a
different mechanism: `HoldingsTable.astro:136` reads `ORDER BY period, rowid`, the artifact
is byte-deterministic (pinned by the logical-digest test), so the comparator always receives
the same input and returns the same output. It breaks the moment that `ORDER BY` changes, an
index changes the scan plan, or the query gains a join.

**What is new in round 3 is the record, not the defect.** `DEV-NOTES.md` names N6 nowhere
(`grep -c` on `sortHoldingRows`, `rowIndex`, `comparator` → 0), and its Tech Debt section
omits it while correctly picking up the other undeclared debt round 2 named. Worse, the
Dev Notes' own C6 row states *"`positionIdentity` gives an unkeyable row a synthetic
per-(period, row) identity **so it can never fold with another**"* — true of `foldPositions`,
false of `sortHoldingRows`, which sees every unkeyable row as one identity. The review
narrative is broader than the code.

The test that should have caught it is new in this increment and asserts an end state rather
than the property: `dashboard/test/holdings.test.ts:1093` sorts three rows with **distinct**
position keys and **distinct** values, then re-sorts the already-sorted output and calls that
"stable". A comparator can be inconsistent and still pass that. [[mutation-tests-pin-properties]]
*Grade:* Major (latent). *Fix direction:* thread the index as `foldPositions` does, or return
`0` on equal identity; and add a tie fixture. If it is deliberately deferred instead, say so
in the Dev Notes — the fix is smaller than the declaration.

### Minor

- **The `ACTIVITY_NULLABLE` column list is now hand-maintained in two places and derived
  from the schema in neither.** `tests/test_inst_serving.py:556` and
  `scripts/accept_m2_8.py:316` each transcribe the same six names. Today they are complete —
  I checked them against `SERVING_SCHEMA`'s `serving_activity` block: those are exactly the
  six nullable numeric columns. But this increment's own M7/M10 principle is *derive, do not
  transcribe* (the TypeScript side regex-extracts `SERVING_SCHEMA` rather than restating it).
  A seventh nullable numeric would be silently uncovered by both. The test docstring is
  honest that coverage depends on the list; the duplication is what is undeclared.
- **`SITE_CHROME_FILES` is a second measurement-recorded-as-a-constant and is not in the
  declared debt list.** `M1_MEASURED_PAGES` is correctly declared as drifting debt; its
  103-file sibling has the identical exposure and is not. Both drift gates in
  `file-budget.test.ts:142-188` use a ±1,000 tolerance, so a chrome class that grew by, say,
  400 files would leave both green while the projection understated the breach by 400. The
  hard backstop is the exact-equality Python test (`== 12_545`), which is why R3-18 is killed —
  but the drift gate alone would not catch it, and `DEV-NOTES.md:160`'s claim that the
  post-build gate catches a term that "stops being summed" is precise only for *deletion*
  (via `pyInt`'s defined-check), not for *zeroing*.
- **Three self-fulfilling assertions remain, all confirmed PRE-EXISTING at `7ab75ec`** (I
  re-checked each with `git show HEAD:`): `dashboard/test/post/fixture-preview.test.ts:116`
  (`includes("all periods on record")` is permanently false against the page's
  `ALL`, so the assertion rests on `§`, emitted unconditionally),
  `dashboard/test/css-fold.test.ts:444` (the `[data-` disjunct is loop-invariant), and
  `dashboard/test/pages-render.test.ts:132` (the second disjunct is a substring of the
  first, so the `partial` qualifier is unpinned). Inherited, not caused here — but they are
  the failure mode that let N3 and M4 ship, and they are still load-bearing on honesty
  content.
- **Ban-list inflection gaps persist.** `\bbets?\b` does not match "betting"; `\bpiling in\b`
  does not match "piling into". Zero live hits today — a mechanism gap, not a violation.
- **`dashboard/src/lib/ui.ts:1016` still claims "every position this filer reported for the
  selected quarter"** from a block with no knowledge of whether `capRows` truncated the
  embed. `unqualifiedAllClaims` matches `\ball\b` only, so the R12 scanner cannot see it.
  Mitigated: `holdings.ts` does render a truncation note when `total > matched`; the two
  statements simply contradict each other on the same page.
- **`dashboard/src/components/HoldingsTable.astro:93`** opens a `DatabaseSync` with no
  `.close()`; deliberate (memoised on `globalThis` for the build process) and build-time
  only, but asymmetric with `activity.ts:1135-1136`, which closes in a `finally`.
- **`src/populus/publish/build.py:1955-1957` still describes a mechanism that does not
  exist** — it names `run_verify`, `run_rollback` and the client installer as iterating
  `module_db_artifacts`. There is no `run_rollback` (it is `_publish_rollback`, `:2156`).
  Round 2 reported this; it is unfixed and unmentioned. Harmless in effect, wrong in
  description.
- **`check_geometry` still has no production call site** — only tests and `accept-m2-8`. This
  is the residue of C5(c), but it is honestly framed: the module docstring names
  `check_measured_tree` as "the ENFORCING gate … the only thing here that can fail a build",
  and the whole-tree gate genuinely runs post-build. Noted, not charged.

## New vs Pre-existing

**Introduced by the round-3 fix pass:** nothing I could find. The pass touched ten files
(mtimes after `QA-REPORT-R2.md` at 15:39): `inst_budget.py`, `inst_serving.py`, `server.py`,
`envelope.py`, `accept_m2_8.py`, `file-budget.test.ts`, and four test modules. An AST scan
for assigned-and-never-read module-level names across all of them returns nothing — the N1
defect class did not recur. The only signature change (`shape_holding`'s required
`accession`) has exactly two production call sites, both updated and both tested; there are
no dynamic or `**kwargs` callers.

**Introduced earlier in T7–T16, still open:** N6 (`holdings.ts` is new in this increment),
and the weak determinism test at `holdings.test.ts:1093` that lets it stand.

**Introduced by the round-1 remediation, still open:** P1 (`ARCHITECTURE.md:389`) —
confirmed by `git diff HEAD` and by mtime (14:51, before round 2's report).

**Pre-existing at `7ab75ec`, inherited:** all three self-fulfilling assertions (each
verified unchanged with `git show HEAD:`); the M1 `dist/` overrun that `accept-m2-8`
correctly labels INHERITED; and `scripts/accept_m1_b.py:63 FILE_BUDGET = 8500`.

**Resolved since round 2 and recorded so it is not re-litigated:** `SITE_CHROME_FILES` is no
longer dead code; `accession` is no longer a half-built contract; the Dev Notes are no longer
stale. The C4 override remains correct.

## Test Coverage Gaps

- **The activity grain still never flows through a real `run_build`.** Every end-to-end
  fixture (`seed_inst(db, covered=True)`) is single-period, so `agg_qoq_deltas` is empty and
  the published `serving_activity` has zero rows in every test that drives a real build. The
  grain is exercised through `_project_with_aggregate` and through `accept-m2-8`'s own
  two-period fixture (which does ATTACH exactly as `run_build` does). Unchanged from round 2;
  the ATTACH path is now covered by the acceptance gate but not by a build-driven test.
- **Producer → consumer over the producer's own bytes is still closed nowhere in the
  repository.** `tests/test_inst_federated_boundary.py:121-149` hand-writes its serving rows.
  It imports `SERVING_SCHEMA`, so the schema contract is genuinely pinned, and round 2 closed
  the loop by hand and found it sound — but that test still does not exist in the repo.
- **The comparator tie case is untested** (N6): no fixture puts two rows with equal identity
  through `sortHoldingRows`.
- **The restatement-only period is untested** and reads authoritative (measured in round 2,
  unchanged). Defensible, and composed with TD-T7-1's unevaluable `partial_lineage`. Worth an
  owner's eye.
- **`/institutional/index.html` is still absent from `INST_PAGES`**
  (`fixture-preview.test.ts:149-152`), so the post-build `data_note` gate covers two of three
  institutional surfaces despite its name saying "every".
- **No test drives `_qoq_deltas_table` against a database carrying an unexpected attached
  schema** — the one untested boundary on the `# nosec B608` interpolation.

## Security

Applicable surfaces only. `make security` → `scripts/dep_guard.py` → `dep_guard: OK — no
denylisted vendor dependencies or imports` (exit 0). **No new dependency and no new HTTP
client** were introduced by this pass; all network access remains behind `SecClient`, and the
frozen-lockfile install (`uv sync --frozen`, 44 packages; `npm ci`, 277 packages) runs inside
the recorded gate rather than beside it.

The round-3 diff touched no security boundary. The one security-adjacent change in the
increment remains `src/populus/client/snapshot.py` (`serving_db_path`), and it is **stricter**
than its sibling `db_path()`: the artifact is served only when the *verified* manifest
enumerates it, so an unlisted file sitting in the cache directory is not handed back.

`_qoq_deltas_table` (`inst_serving.py:851`) interpolates a schema name into SQL. It is
`# nosec B608`-marked, the value comes from `PRAGMA database_list` rather than user input, and
it is double-quoted. Acceptable; the untested boundary is named above rather than assumed
safe. No secrets appear in any diff, gate output or command recorded here.

## Tech Debt Introduced

Cross-verified against `DEV-NOTES.md:344-368` and `docs/build/RUN-M2-8-plan.md`.

**Correctly declared** — `M1_MEASURED_PAGES` drift (bounded by the post-build drift gate,
confirmed present at `file-budget.test.ts:142-159`); `ServingProjection` holding all rows in
memory (TD-T7-2); `partial_lineage` unevaluable in `authoritative_full_periods` (TD-T7-1);
R10 enforced at the producer rather than the validator; `stats.json` truncation wiring
unbuilt.

**The `accept_m1_b.py` conflict is now declared, and the disclosure is complete.**
`DEV-NOTES.md:361-368` names both sides (`scripts/accept_m1_b.py:63 FILE_BUDGET = 8500`
versus `inst_budget.M1_MEASURED_PAGES = 12_442`), states that this pass established one of
them is wrong and left the other asserting, scopes it out of M2-8 (it is M1's gate) and into
this increment's disclosure duty, and ties it to the same owner decision as the reservation
breach. The conflicting figure is also visible in the gate output itself — `accept-m1-b`
printed `published files 24 / 8500 M1 budget` in this run. Nothing about it is hidden.

**Still undeclared:**

- **`positionIdentity`'s `rowIndex` is optional and one of its two callers omits it** (N6).
  Round 2 named this as undeclared debt; it is still undeclared, and the Dev Notes' C6 row
  states the opposite of what `sortHoldingRows` does.
- **`SITE_CHROME_FILES` as a second drifting measurement-constant** (see Minor).
- **The twice-transcribed `ACTIVITY_NULLABLE` list** (see Minor).

## Memory Touch-Points

- **[[mutation-tests-pin-properties]]** — the pattern finally broke in this increment's
  favour. Four mutations survived across rounds 1 and 2; **zero survived 42 attempts here**,
  including the two round-2 survivors and every variant I could construct around them. The
  reason is visible in the form of the fixes: both are written as properties over the source
  of truth (the aggregate's own NULLs; the count of surviving full reports) with non-vacuity
  assertions attached — and I proved the non-vacuity assertions are load-bearing by narrowing
  the fixture and watching them fail by name. That is the first time in this increment a
  guard has been shown to fail for the right reason on demand. The counter-example is N6,
  whose test asserts an end state (re-sorting a sorted list) and therefore pins nothing.
- **[[measure-the-mechanism]]** — vindicated again, and this time in QA's favour: because the
  budget gate now counts a real tree, N1's remaining question was arithmetic rather than
  opinion. I counted `dist/` myself and got 12,545 / 12,442 / 103 exactly, so the claim could
  be settled in one command instead of argued.
- **[[mockups-are-not-measurements]]** — the one place it still bites (P1). The 13,224 worst
  case is genuinely gone, replaced by a counted tree and a projection whose every term is
  printed. The `184 B/row` line is the residue, and it is instructive that the honest
  disclosure was written into the one file the repository is configured never to keep.
- **[[reversing-a-reviewed-decision]]** — the N4 fix is a clean instance of the good pattern:
  the fixer judged a docstring wrong against §5.1 and `inst_queries.py`, kept the property
  (per-record provenance), replaced the mechanism (required parameter instead of an optional
  one), pinned it with sharper tests on both planes, and wrote the record. I checked the
  override against the source of authority and it is correct.
- **[[review-scope-decides-the-verdict]]** — this report is scoped to the code and the
  measured behaviour of the gates. Harness provenance is out of scope. Every round-2 finding
  is graded explicitly VERIFIED-FIXED / STILL OPEN rather than folded into a summary, and the
  two open owner decisions are named as decisions, not counted as defects.
- **[[measure-closed-quarters-only]]** — still not exercised: `publication_periods` does not
  distinguish an open quarter. Out of scope for T7–T16; noted so it is not assumed handled.

## Failure-Mode Sweep

| Failure mode | Present? | Evidence |
|---|---|---|
| Fixer grading its own work | **Mitigated** | Every claim re-executed with an independently chosen 42-mutation set; gate figures re-measured, not read. |
| Gate that cannot fail | **No** | Both budget gates driven past their limits by `accept-m2-8`; the two "soften the breach" mutations (R3-19, R3-20) are killed by exact-literal assertions. |
| Test that cannot fail (self-fulfilling) | **Yes, 4** | Three pre-existing at `7ab75ec` (unchanged); one new-in-increment at `holdings.test.ts:1093` (the "deterministic" sort test), which is why N6 stands. |
| Fixture that silently narrows | **No — proved** | Narrowing the N3 fixture on either side makes the non-vacuity guard fail and name the uncovered column (R3-12, R3-13). |
| Estimate presented as measurement | **Yes, 1** | `ARCHITECTURE.md:389` (P1). Disclosed only in a permanently untracked file. |
| Assertion of absence from insufficient documents | **No** | Exit cases (a)(b)(c), the NULL-`amendment_type` case, the unclassifiable-amendment case and the two-surviving-bases case all behave per plan; **all 8 exit mutations killed**, including round 2's survivor. |
| NULL rendered as 0 | **No** | Both grains pinned; `or 0` on all six activity columns killed in the projection and in the writer. |
| Silent cap/reservation relaxation | **No** | Every cap at its round-2 value; the breach grew (16,070 → 16,173) rather than shrinking; both relaxation mutations killed. |
| Producer/consumer contract drift | **No** | Schema contract pinned both ways; column contract inverted and real; `accession` now identical across planes and asserted per row on both against real SEC bytes. |
| Dead code presented as wired | **No** | `SITE_CHROME_FILES` is summed, exported and load-bearing (proved by mutation). `classify_position` (M14) is **declared** deferred, which is the correct handling. AST scan for dead module-level names over every touched file: clean. |
| Documentation asserting unimplemented behaviour | **Yes, 3** | `ARCHITECTURE.md:389` (P1); `build.py:1955-1957` (`run_rollback` does not exist); `DEV-NOTES.md`'s C6 row overstating `positionIdentity`'s fold-safety (N6). |
| Dev Notes unusable as QA input | **No — resolved** | Every headline number reproduces exactly; the changed-file list is exhaustive path-by-path; the document was written after the last source edit. |
| Regression from the fix pass | **None found** | Ten files touched; no dead names, no broken callers, no new gate failure, no new surviving mutation. |
| Owner decision disguised as a result | **No** | The 1,173-file breach and M14 are both surfaced loudly, sized, attributed, and asserted as findings by tests that fail if they are tuned away. |

## Verdict

**The remediation holds, and I say that having tried hard to prove otherwise.** I chose 42
mutations myself — including the two that survived round 2, every variant of them I could
construct, two probes designed to catch a fixture that silently narrows, and two designed to
catch a cap or reservation quietly shrunk to soften the breach — and **all 42 were killed,
each for the right reason.** Every gate figure in the Dev Notes reproduces to the number:
`make check` 0, pytest 1924/8, dashboard 221, post-build 36, `astro build` 8,170 pages,
`dep_guard: OK`, four acceptance targets 0. N1's arithmetic re-derives independently from a
tree I counted myself (12,545 = 12,442 + 103; 16,173 vs 15,000; 1,173 over). N3's fixture
genuinely carries a real NULL in all six nullable columns and the non-vacuity guard demonstrably
fails when it does not. N4's override is correct against §5.1 and `inst_queries.py`, and the
cross-plane test exercises both planes against real corpus bytes. `DEV-NOTES.md` is now exact
and exhaustive.

**The defect that caught rounds 1 and 2 — a fix reproducing a smaller instance of itself —
did not recur in the code.** I looked for it specifically: no new dead constant, no new
unreferenced term, no new broken caller, no new surviving mutation.

Two Major findings stand, neither in the N1–N5 remediation and neither introduced by it:
**P1**, a tracked document still asserting an unbacked "Measured 2026-08-05: 184 B/row" whose
only caveat lives in a permanently untracked file; and **N6**, an inconsistent comparator that
is bounded in practice by an `ORDER BY` elsewhere, is unfixed, and is now recorded nowhere
durable while the Dev Notes state the opposite. Both are one-line changes.

**Would I merge this?** Yes — I would merge the increment. The engineering is sound, the
honesty machinery works and has been shown to fail on demand, and both open owner decisions
(the 1,173-file reservation breach and M14's unwired flag) are surfaced exactly as decisions
rather than smuggled through as results. Two things should land in the same commit, because
both are one line and both are about the record rather than the code: strike or substantiate
`ARCHITECTURE.md:389`, and put N6 in the Dev Notes' debt list (or fix it — the fix is smaller
than the declaration).

This report is evidence for an independent `qa-review`. It is not merge approval.

PASS
