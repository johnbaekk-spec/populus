# `npm run test:post` — the pre-existing failing set, by name

`test:post` does not exit 0 on any tree. It runs against **real dist bytes**, and a
number of its expectations describe a build the local toolchain cannot produce.
Before this file, the only record of which failures were expected was a count —
"14" — written in a run record that is now archived read only. A count is not a
baseline: it cannot say whether a run that fails fourteen times failed the same
fourteen, and the recorded figure matched no tree that anyone could rebuild.

**This file records the set BY NAME.** A run is clean when its failing set is a
subset of the list below. A name that is not on this list is a new failure and
blocks, however many there are in total.

## Measurement

| | |
|---|---|
| Measured | **2026-09-13** |
| Tree | `fix/post-release-followups`, worktree `.claude/worktrees/post-release` |
| Data build | `/Users/johnbaek/populus-build-20260817.1` — `builddir/` + `congress.db` + `inst_serving.db` + `inst_agg.db`, the same real-data baseline the refinement run used |
| Env | `POPULUS_BUILD_DIR` · `POPULUS_DB` · `POPULUS_INST_SERVING_DB` · `POPULUS_INST_DB` all set to that build |
| Build | `npm run build:bounded` rc 0 — 9,660 pages in 10m 41s, **17,255 files** in `dist/` (self-cap 18,000, provider cap 20,000) |
| Result | **85 tests · 69 pass · 16 fail** |

The previously recorded figure was 14. It is 16 here, and the difference is
accounted for rather than absorbed: see "Why the count moved" below.

## The set

### A. The institutional fixture-preview lane — 10 failures, one cause

Every one of these fails at `dashboard/test/post/fixture-preview.test.ts:30` with
`Error: spawnSync npx ETIMEDOUT`. The suite shells out to build an isolated
institutional fixture preview; on a loaded machine that nested build exceeds its
timeout and **all ten assertions in the file fail together**. They are one
environment failure, not ten defects — and they are listed individually anyway,
because "ten failed" and "one lane timed out" look identical in a count.

1. `/institutional landing lists the fixture filers when the module is present`
2. `filer happy path emitted: /institutional/filers/1067983/ renders the aggregate`
3. `holders happy path emitted: /institutional/tickers/AAPL/holders/ via the mapping`
4. `holders pages exist ONLY for mapped, entity-keyed issuers`
5. `production leakage: the NORMAL dist/ carries no fixture-derived paths`
6. `the envelope's manifest declares the inst module per producer policy`
7. `the unified AAPL page's institutional section binds the same data`
8. `POST-BUILD: the §5 data_note renders on every institutional surface, clause by clause`
9. `POST-BUILD: no §1.1 banned wording anywhere in the rendered institutional tree`
10. `POST-BUILD: no unqualified 'all' claim on the rendered holders surface (R12)`

**This lane is timing-dependent, which makes it the weakest entry here.** A
timeout can mask a real defect in any of the ten: they would fail the same way.
Treat a run where this lane PASSES as the stronger evidence, and do not read
these ten as permanently expected.

### B. Data- and environment-bound expectations — 5 failures

11. `R19 GATE (margin): the largest deployed file keeps headroom under the cap`
    — `dashboard/test/post/file-budget.test.ts:203`. `congress/data/feed.v1.json`
    is 22,289,120 B = 85.0% of the 26,214,400 B provider cap, past the 60% margin
    the gate holds. The full feed stays published by decision; the margin is a
    standing warning about congress data volume, not a defect in any change.

12. `real search index: allowlist shape + ≤128 KiB budget (R11)`
    — `dashboard/test/post/http-status.test.ts:84`. 542,106 B against a 131,072 B
    budget: the known search-index overrun, already an open roadmap item. The
    gate is right and the budget is unmet; it is tracked separately.

13. `production dist has NO institutional fixture routes (Locked #19 leakage check)`
    — `dashboard/test/post/http-status.test.ts:200`. The test's own comment states
    its premise: *"The dev build publishes no inst module."* A build wired to real
    institutional data emits `institutional/filers/` and `institutional/tickers/`
    by design, so this expectation is **false by construction** on exactly the
    build the rest of the suite needs. It passes only on a dev build with no inst
    data.

14. `POST-BUILD R20: /institutional/tickers/NVDA/holders/ exists with ≥10 holders …`
    — `dashboard/test/post/refinement-dist.test.ts:195`. Needs a build whose
    reviewed mapping and holders pages are cut for NVDA; the 20260817.1 baseline
    data does not produce them.

15. `POST-BUILD R23: every SRC §5 observed string returns 0 in dist's visible text …`
    — `dashboard/test/post/refinement-dist.test.ts:325`. `"classified by value"`
    on **716** institutional pages, e.g. `institutional/filers/1002672/index.html`.
    This is a REAL copy finding, not an environment difference: the string is the
    label of the `classified_by_value` disclosure flag
    (`dashboard/src/lib/format.ts:483`, shipped in P3-2), and SRC §5 says that
    vocabulary belongs only on `/methodology`. It is baselined here rather than
    fixed because changing a disclosure-flag label is a copy decision with its own
    blast radius, not a trivial repair. **Open item, not an accepted state.**

### C. Fixed rather than baselined — 1

`every built file class is named by some budget term`
(`dashboard/test/post/file-budget.test.ts:430`) failed with
`the built tree holds file classes no budget term names: .well-known=1`.

That was a true omission, not an environment difference:
`dashboard/public/.well-known/security.txt` (RFC 9116) has been built since the
security-headers work and no budget term named it. **Fixed** by naming
`.well-known` in `inst_budget.SITE_CHROME_CLASSES`. It is therefore NOT in the
expected set, and a future `.well-known=…` failure is a new failure.

`SITE_CHROME_FILES` is deliberately left at 107 while the measured chrome count on
this tree is 47. Its drift guard tolerates ±1,000 and passes; re-measuring it
against one local tree is what its own comment warns against
("measuring a proxy instead of the thing"), and is an owner decision rather than a
side effect of this pass.

## Why the count moved: 14 → 16

- **+1** `every built file class …` (`.well-known`) — now fixed, so it leaves the set again.
- The fixture-preview lane contributed ten of the sixteen here. How many it
  contributed to the archived "14" is **not knowable** — that record names no
  test — so the remainder of the difference is not attributed. This is the
  reason the set is recorded by name from now on.
- **−1** `R27: no pipeline vocabulary (SRC §1 rule 3) in any page's visible text`
  **now PASSES.** It was failing on the released site, whose `/signals` page
  rendered "supersession tombstones" in a reader-facing note; that copy was
  rewritten in this branch. Scanned here over **9,660 pages, 0 hits**.
- The R19 `build_id` marker test is **not** in this set. It compares the rendered
  marker against `POPULUS_BUILD_DIR/manifest.json`, so it passes whenever the
  build dir and the site agree — which is every locally reproducible run. A
  recorded figure that included it described a run comparing against a different
  serving artifact, and matched no tree anyone could rebuild.

## Re-measuring

```bash
cd dashboard
export POPULUS_BUILD_DIR=<build>/builddir POPULUS_DB=<build>/congress.db
export POPULUS_INST_SERVING_DB=<build>/inst_serving.db POPULUS_INST_DB=<build>/inst_agg.db
npm run build:bounded && npm run test:post
```

Compare BY NAME, not by count:

```bash
npm run test:post 2>&1 | awk '/^failing tests:/{exit} /^✖/' \
  | sed 's/ ([0-9.]*ms)$//; s/^✖ //' | sort -u
```

Update this file in the same commit as any change that moves the set, and say
which direction each name moved and why.
