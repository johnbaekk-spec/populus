## Detected Stack

Python 3.12, `uv`, hatchling, SQLite/JSON1, Click, `httpx`, `lxml`, pytest. Canonical gates: `make check` (frozen install + `uv run pytest -q` + `scripts/dep_guard.py`).

## Requirement and Task Completion

All R1–R13 of the pre-approved plan implemented. Built on RUN M2-2 (merged: `inst_filings`/`inst_holdings`, `v_default_inst_filings`, `v_default_holdings`, `compute_coverage`) and the M1 publish substrate — the snapshot client and manifest were already module-keyed; `build.py` was the piece generalized.

- **R1 — cross-filer aggregates.** `src/populus/inst_agg.py` + `inst_agg.sql` build `inst_agg.db` from `v_default_holdings`/`v_default_inst_filings`, deterministically: filer registry, QoQ deltas per filer×security (new/add/trim/exit, Δvalue, Δshares, as-of joins), top-holders per issuer, concentration. Done.
- **R2 — manifest `inst` module.** `modules.inst` carries `schema_version`, PEP 440 `client_compat`, `deprecation`, `normalization_version`, `digest_projection_version`, `watermarks` (latest `period_of_report`/`filed_date`), `artifacts[]` (sha256/bytes/path/license_ids incl. `sec-edgar`), and the inst logical-digest projection v1. Done.
- **R3 — generalized `build.py`.** Assembles `congress` + `inst` under `builds/<build_id>/` without breaking M1; the recovery journal stays congress-scoped; the inst asset upload preserves the journal-first / publish-release / pointer-last ordering. Done.
- **R4 — `manifest.py` admits modules.** Generic structural validation accepts ≥1 known, well-formed module and rejects unknown ones; the congress-only requirement became a separable standard-build parameter. `verify` recomputes both modules. Done.
- **R5 — two-build reproducibility (P1 gate, §17).** Two independent inst builds of the same inputs yield an identical inst logical digest. Done.
- **R6 — snapshot serve.** `SnapshotClient(module="inst")` reads an aggregate back through the public DB accessor (not private cache layout). Done.
- **R7 — the ≥95% gate, fail-closed, in build/publish.** Consumes `compute_coverage(conn).meets_threshold` (threshold `0.95`), keeps `certifiable` (measurable) distinct, and keys cover-failure on the `cover_failed` flag (`cover_failed_count`) — never on "total IS NULL", which a valid `13F-NT` legitimately has. **Per the owner's decision the threshold is unchanged and fail-closed is accepted: no FTD-interval widening or threshold lowering was introduced.** Done.
- **R8 — CLI wiring.** Aggregate build + gate wired into `populus build`/`publish`, plus a `populus inst-agg` builder. Done.
- **R9 — no regressions / canonical gate.** `make check` green with the prior 1247 tests unchanged; `inst_agg.py` trips no network-primitive or vendor guard (G1). Done.
- **R10 — acceptance (split).** **R10a** FTD-only real Berkshire corpus → `inst` **withheld** (below threshold) while `congress` publishes and verifies, Berkshire 2025-Q4→2026-Q1 QoQ validated pre-publication, a second build bumps `pointer_version`, and an unchanged re-poll is an idempotent accept. **R10b** fully-covered deterministic corpus → **both** modules publish and `verify` recomputes both. Done.
- **R11 — rollback preflight generalized** across every module and artifact (`_publish_rollback`), refusing a rollback whose `inst_agg.db` is missing or corrupt. Done.
- **R12 — multi-module recovery boundary** specified and executable: the inst asset upload's fresh-runner crash boundaries are enumerated; the narrow post-journal/pre-inst-upload window refuses loudly and resolves via the existing rebuild path. Done.
- **R13 — module-aware snapshot DB accessor.** `SnapshotClient.db_path()` resolves the *module's* DB artifact rather than a hardcoded `congress.db`. Done.

## Changed Files

New: `src/populus/inst_agg.py`, `src/populus/inst_agg.sql`, `tests/test_inst_agg.py`.
Modified: `src/populus/publish/build.py` (multi-module assembly + inst asset ordering), `src/populus/publish/manifest.py` (admit modules, inst module block), `src/populus/publish/digests.py`, `src/populus/client/snapshot.py` (module-aware `db_path()`), `src/populus/cli.py` (`inst-agg` + gate wiring), `tests/test_publish.py`, `tests/test_digests.py`, `tests/test_inst_ingest.py`, `docs/runbooks/disaster-recovery.md` (multi-module recovery boundary).

## Reuse / Duplication Check

Reused the M1 publish substrate rather than forking it: the existing `build`/`manifest`/`pointer`/`digests`/`inventory` seams, the already-module-keyed `SnapshotClient` and `manifest["modules"]` shape, the `v_default_*` view idiom, and RUN M2-2's `compute_coverage` (the gate consumes it rather than re-deriving coverage). No second coverage implementation and no duplicate publish path.

## Simplicity Audit

One coverage authority (`compute_coverage`) consumed by the gate; one generalized build path rather than a parallel inst pipeline; the journal deliberately stays congress-scoped (`inst_agg.db` is regenerable from the ingested inst tables) instead of growing a second recovery protocol. Proportionate to §5.5/§5.6; no speculative abstraction.

## Tech Debt Introduced

The approved plan's declaration, carried verbatim. Owner: John Baek.

- **TD-M2-3-1 (bounded, executable):** the recovery journal stays congress-scoped; `inst_agg.db` is recovered as a present draft asset (same-runner: re-uploaded from staging → auto-completes) or regenerated. **Precise boundary:** a fresh-runner crash after the journal upload but before the inst-asset upload leaves an inst-bearing draft whose aggregate bytes are unrecoverable from the journal → recovery **refuses loudly** (release still a draft, pointer unmoved) → the operator runs the **drafts-only cleanup** (`rollback.md` Appendix A) and rebuilds under a new `build_id` (regenerating `inst_agg.db`). *Impact:* one rare fresh-runner window needs a documented one-command operator step; nothing consumer-visible is ever stranded. *Removal condition:* widen the journal to a multi-DB envelope (accepting DR-5 git-size) or upload the inst asset ahead of the journal for full automation. Documented in `disaster-recovery.md`; tested on a fresh runner (R12).
- **TD-M2-3-2 (bounded):** per-issuer top-holders capped at N=25 (recorded in `agg_build_meta`) — the long tail is not in the aggregate slice (consistent with §5.6). *Removal:* raise/parameterize N.
- Otherwise **None** — no hidden debt; monitor/MCP inst-awareness and dashboard slices are declared **non-goals**.

**Not debt — the accepted gate outcome.** The `inst` module not publishing on the FTD-only corpus is the **owner-accepted, specified behaviour** of the ≥95% value-coverage gate (decision recorded 2026-07-24 in `docs/build/RUN-M2-3-brief.md`), not introduced debt: the threshold is enforced as written and neither lowered nor bypassed by widening FTD intervals. It becomes satisfiable when an identifier-history source is admitted through §15.

**Carried, not introduced:** TD-M2-1-1..9 and TD-M2-2-1..5 (notably TD-M2-1-1, whose interval sparsity is what keeps the gate fail-closed).

## Memory Touch-Points

Consulted the mandatory failure-mode catalog, both Populus project memories (verified-primary-source bar; the M2-1/M2-2 QA-grind lesson and the pragmatic acceptance bar), and global memories on explicit executable contracts, canonical gates, never-drop reconciliation, and as-of identity. They drove the fail-closed gate acceptance test, the two-build determinism assertion, and the module-generic manifest validation.

## Failure-Mode Sweep

No live network in any test. The gate fails closed on below-threshold, zero-denominator, and genuinely cover-failed inputs (a valid `13F-NT` is a zero contribution, not a failure). Publication ordering preserved (journal-first, pointer-last); rollback refuses on a missing/corrupt inst artifact; unknown manifest modules rejected; two independent builds produce an identical inst logical digest; `verify` recomputes every artifact hash and both module digests. G1 dep-guard clean.

## Tests Run

`uv run pytest -q` → 1298 passed (1247 prior + 51 M2-3 tests incl. five rounds of post-review regressions), independently verified on the feature branch. `scripts/dep_guard.py` → exit 0. Acceptance flows R10a/R10b executed against `../populus-data` via the local-dir backend.

## Plan Deviations

A QA-only external review surfaced 15 findings (13 blockers + 2 nits); **13 are fixed** on this branch, each behavioural fix mutation-verified, and 2 recovery-test gaps remain (below).

- **QA-F1 (fixed + tests, mutation-verified) — DATA-DESTRUCTIVE.** `populus inst-agg --out <the source db>` unconditionally unlinked the destination, so a plausible invocation **destroyed the ingested database**. The builder now refuses source/destination aliasing before any write, comparing RESOLVED paths against the live connection's `PRAGMA database_list` (catching identical, relative `sub/../x.db` and symlink spellings); the CLI turns the refusal into a clean error, not a traceback. Three parametrized CLI tests; removing the guard fails all three.
- **QA-F2 (fixed + tests).** SH and PRN holdings of one security were merged into a single accumulator, yielding meaningless share counts and Δshares. The reported unit is now part of the position GRAIN (`_unit_key`, `ssh_prnamt_type` NOT NULL and in the `agg_qoq_deltas` primary key), while pass-2 CUSIP reconciliation deliberately omits the unit so a genuine one-to-one SH→PRN transition still reconciles instead of emitting a spurious exit+new.
- **QA-F3 (fixed).** The QoQ timeline came from periods that happened to contain keyable holdings, so a notice-only or all-unkeyable quarter vanished and non-adjacent quarters were compared — fabricating continuity/additions/trims. Timelines now derive from the filing universe (`v_default_inst_filings`); a period with no keyable positions compares as an EMPTY side.
- **QA-F4 (fixed).** Concentration buckets were created only while iterating holdings, so a zero-position filer-period had no row. Every default filer-period is now materialized (total 0, NULL share/HHI, `concentration_unavailable`).
- **QA-F5 (fixed + verified on real data).** `publish` was SILENT when the gate withheld `inst`, hiding the owner-accepted fail-closed outcome at the publication boundary. `build` now records the outcome to `.staging/<build_id>/inst-gate.json` (operational state, never a published artifact — no manifest/digest/inventory impact) and `publish` reads it **before** publishing (a successful publish clears staging) and prints the reason, distinguishing `withheld` from `absent` (no institutional data). Confirmed in the R10a transcript below.
- **QA-F6 (fixed).** Publish preflight validated only journal-carried build files, so a dry-run could claim a build would publish with a missing/corrupt `inst_agg.db`, and a real publish could upload the journal and congress.db before refusing. Preflight now verifies every non-congress module asset — staged with the manifest's exact sha256/size, or already verified on the release — before the first mutation.
- **QA-F8 (fixed).** The real-Berkshire QoQ oracle asserted only that aggregate rows were a SUBSET of the expected keys, so omitted matched/exit rows passed. It now asserts exact row identity, exact count (accounting for CUSIP-reconciled collapses), exact classification and exact deltas — and writing it surfaced that the implementation classifies by Δshares first (more correct than a value-only rule) rather than by Δvalue.
- **QA-F7 (done).** The R10a real-corpus acceptance was executed and its transcript recorded below.
- **QA-F11 (fixed).** The reconstructed Tech Debt section had invented TD identifiers; the approved plan's TD-M2-3-1/TD-M2-3-2 are now carried verbatim, with the FTD withholding correctly identified as the accepted gate outcome rather than debt.
- **QA-F13 (fixed).** The new CLI surface had no direct tests; `populus inst-agg` now has CliRunner coverage for the happy path, the missing-database error and the destructive-alias refusal.
- **QA-F14 / F15 (nits, fixed).** The digests docstring now describes `logical_digest` as per-module and projection-parametric; the PUT/LONG concentration test no longer calls unequal 1000/300 positions "equal-weight" and asserts the EXACT HHI (6449, integer math) instead of mere non-NULL.

**Round 2 — all remaining findings addressed, INCLUDING the three recovery/immutability gaps declared open above** (each fix mutation-verified):

- **R2-F1 (fixed + test, mutation-verified) — REACHABLE CRASH.** Splitting the gate-record helper left the no-record fallback referencing an undefined `path`, so a staging-less reconcile or explicit re-publish raised `NameError` **after publication had already succeeded**, turning a successful publish into a traceback and non-zero exit. Fixed to use `_inst_gate_path(...)`; a regression test drives the no-record path directly and reproduces the `NameError` when reverted.
- **R2-F2 (fixed, mutation-verified).** The "all assets uploaded" recovery test published the release BEFORE creating the fresh runner, so draft→published recovery was never exercised. The release now stays a DRAFT and the fresh runner must publish it; disabling `publish_release` fails the test.
- **R2-F3 (fixed).** The drafts-only-cleanup test stopped at deleting the abandoned draft. It now continues end-to-end: rebuild under a FRESH build_id (asserting the interrupted id is burned), publish it, and verify the final pointer and complete asset set.
- **R2-F4 (fixed, mutation-verified).** Added the published-immutability case: an already-published two-module release whose `inst_agg.db` is missing or corrupt must refuse re-publish with no delete, no upload and an unchanged pointer. **The first version of this test was vacuous** — it used a fresh workspace and passed on "nothing staged to publish", never reaching the asset checks; mutation testing caught that, and the rewritten test (staging deliberately intact, release published via the backend) fails when the `draft=False` refusal alone is disabled.
- **R2-F5/F6/F7 (fixed + tests, all mutation-verified).** Behavioural regressions now protect the round-1 aggregate fixes: same-security SH/PRN subpositions produce distinct QoQ rows with their own deltas; LONG/PUT likewise; a keyable → notice-only → keyable timeline yields exit-then-new and never bridges the gap; a zero-position period gets its concentration row (total 0, NULL share/HHI, `concentration_unavailable`). Reverting each corresponding fix fails its test.
- **R2-F8 (fixed).** The independent digest oracle now orders `agg_qoq_deltas` by the COMPLETE primary key including `ssh_prnamt_type`, so multi-unit rows cannot order nondeterministically.
- **R2-F10 (fixed + test).** `COVERAGE_THRESHOLD == 0.95` is now asserted, so the owner-locked fail-closed threshold cannot drift silently.
- **R2-F9 (partially addressed).** The Berkshire oracle asserts exact identity/count/classification/deltas for all non-reconciled rows and derives reconciliation from the implementation's own flag. Independently reconstructing the expected CUSIP-reconciliation pairing remains open; it is the one place the oracle still trusts implementation output.
- **R2-F11 (nit, fixed).** The dev-notes gap count now matches its enumeration.

**Round 3 — all five findings fixed** (every one mutation-verified):

- **R3-F1 (fixed + test).** Reported-CUSIP reconciliation accepted ANY unmatched pair sharing a CUSIP, so two DIFFERENT resolved securities reporting the same CUSIP were collapsed — fabricating continuity and suppressing a real exit/entry. It now requires the resolved↔unresolved boundary it exists to bridge; two resolved securities stay a genuine exit + new. Reverting the guard fails the new negative test.
- **R3-F2 (fixed + tests).** A regression introduced by the round-1 unit-in-grain change: because pass 1 intersected the full unit-bearing key, a same-security SH→PRN transition bypassed security-id matching and was either mislabelled `identity_reconciled_by_cusip` or (if the CUSIP also changed) split into exit+new. A new **pass 2** matches remaining rows on `(position_key, put_call)` ignoring the unit, uniquely on both sides — one continuous position, correctly unflagged, with Δshares still unit-guarded. Tested with the CUSIP both unchanged and changed; removing the pass fails both.
- **R3-F3 / R3-F4 (fixed).** The real-Berkshire oracle is now FULLY INDEPENDENT: it reconstructs the expected pairing (including which rows reconcile) from source holdings alone, consulting no aggregate flag or delta column, and asserts exact keys, count, classification, values AND shares. It carries an explicit precondition assertion so it cannot silently drift if the fixture's identity coverage changes. Mutating the Δshares sign or dropping exit rows both fail it.
**Round 4 — all three findings fixed** (each mutation-verified). All three were introduced by my own earlier fixes:

- **R4-F1 (fixed).** The round-3 "fully independent" oracle still read the implementation's `delta_shares` to derive expected classification — so the independence claim was overstated. It now derives Δshares **entirely from source positions and the units of the grain keys it paired itself**, then classifies from those numbers; it reads no aggregate delta or flag when constructing expectations. Nulling `delta_shares` in the implementation now fails it.
- **R4-F2 (fixed + test).** Re-running `build` for an already-staged build reconstructs no gate metadata, so the record writer overwrote a real `withheld` verdict with `absent` — and the next publish would have falsely reported that no institutional data was ingested, concealing the fail-closed decision. An `absent` verdict can no longer overwrite a recorded `withheld`/`included` one; a genuine positive verdict still can.
- **R4-F3 (fixed + test).** Automatic gate-record selection sorted staging directories LEXICOGRAPHICALLY, so `20260725.9` beat `20260725.10` and an unrelated or invalid staging entry could be chosen — attaching the wrong withholding reason to a publication. Selection now parses `YYYYMMDD.N` and orders numerically, ignoring malformed entries.

**Round 5 — the blocker and both nits fixed** (blocker mutation-verified):

- **R5-F1 (fixed + test).** The round-4 selection fix still accepted ANY numerically-named staging directory, while the publisher only selects a build carrying a valid journal — so a newer PARTIAL directory could supply the verdict printed for a different publication. Selection now shares the publisher's journal predicate; a publishable `.9` is correctly chosen over an unpublishable `.10`. Removing the predicate fails the new test.
- **R5-F2 (nit, fixed).** `_report_from_manifest` counted only congress artifacts, so a preserved two-module build under-reported its display-only artifact count; it now sums every module's artifacts.
- **R5-F3 (nit, fixed).** The dev-notes no longer describe the three recovery/immutability gaps as "still open" ahead of the round-2 section that documents their closure.

**Round 6 — all three blockers and both nits fixed:**

- **R6-F1 (fixed).** The extra-module asset preflight ran only in `_preflight`, but draft RECONCILIATION reaches `_complete_build` without it — so a resumed publish could upload the journal and congress.db before discovering a missing/corrupt staged `inst_agg.db`, partially mutating a build that was never publishable. The check is now a shared `_preflight_module_assets` helper invoked on BOTH paths, before any mutation, carrying the same drafts-only-cleanup guidance the in-flight refusal gives.
- **R6-F2 (test fixed).** The recovery test advanced the clock a day, so its build-id inequality passed trivially and proved nothing about the interrupted identity. It now rebuilds SAME-DAY on the same workspace and backend — and passes, so the interrupted id is genuinely burned rather than reallocated.
- **R6-F3 (fixed).** A ROLLBACK republishes an existing build, but the gate record was captured by staged `build_id`, so an unrelated staged build's `withheld` verdict could be printed for a rollback target that was never gated. Rollback now emits a neutral notice and captures no record.
- **R6-F4 (nit, fixed).** Fresh two-module builds counted only congress artifacts; the display count now sums every module, matching `_report_from_manifest`.
- **R6-F5 (nit).** The CLI selector still duplicates the publisher's journal predicate rather than sharing one routine — left as a small, declared duplication (behaviour is identical and tested on both sides).

**Round 7 — both blockers fixed. The reviewer was right and my round-6 claim was wrong:**

- **R7-F2 (test fixed).** The round-6 recovery test rebuilt against the UNTOUCHED `runner` while the cleanup had been applied to the copied fresh workspace, so its build-id inequality was a false positive. I verified the real behaviour with a direct probe: after the documented drafts-only cleanup, a same-day rebuild **did reallocate the interrupted id** — the "burned" claim was incorrect.
- **R7-F1 (fixed, mutation-verified).** `next_build_id` drew only on erasable inputs (committed builds, staged dirs, published tags), all of which the drafts-only cleanup removes. It now also consults a **durable per-date allocation high-water mark** (`.build-allocations.json` at the data-repo ROOT — deliberately not in `builds/`, which must not exist before finalize and whose base is symlink-guarded, and not in `.staging/` or the release, both erased by the cleanup). An allocated id is never handed out twice: the probe now yields `.1 → .2`. Removing the mark makes the corrected test fail.
- The corrected test performs cleanup and the same-day rebuild on ONE workspace/backend and asserts the rebuilt id is strictly newer and the interrupted identity never republished. It also documents the one benign case: a fresh runner that carries no durable state at all (nothing published, so `builds/` + `latest.json` never travelled) may reuse the id safely, because no durable object ever bound it to bytes.

- **R3-F5 (fixed + test).** `verify` now has a case that genuinely exercises **inst logical-digest recomputation**: the asset is untouched and hash-consistent, only the manifest's recorded digest is wrong, so the failure can only come from module-specific recomputation (the pre-existing byte-tamper test trips the outer sha256 first). Neutering the recomputed-vs-recorded comparison fails it.

### R10a acceptance transcript (real FTD-only corpus — QA-F7)

```
build:   staged build 20260725.1 (6 artifacts, logical_digest 45dc20aaba7c…)
         inst module WITHHELD (below_threshold): value-coverage 0/797063485143 = 0.00%
         | cover_failed_count 0 — below the M2 ≥95% gate; congress publishes normally
publish: published build 20260725.1 (pointer_version 1)
         inst module: WITHHELD by the M2 ≥95% value-coverage gate (below_threshold;
         coverage 0.00%, cover_failed_count 0) — congress published normally
verify:  verify ok: build 20260725.1, 6 local artifacts recomputed
rebuild: staged build 20260725.2 … logical_digest 45dc20aaba7c…  (IDENTICAL — two-build
         reproducibility on real data)
publish: published build 20260725.2 (pointer_version 2)   ← pointer bump
manifests: 20260725.1 modules=['congress'] · 20260725.2 modules=['congress']
```

The gate withheld `inst` exactly as the owner's decision specifies, `congress` published and verified normally, the withheld reason is visible at BOTH the build and publish boundaries, and two independent builds produced an identical logical digest.

Process notes: (1) the first M2-3 launch FATAL'd because the *revised* plan split R10 into `R10a`/`R10b`, so the bare token `R10` no longer matched orchestrate's whole-word traceability check — the token was restored (content unchanged), the plan re-validated as `plan-v1`, and the run relaunched pre-approved; (2) the DEV phase again ended on a status line rather than the dev-notes document, so this record was reconstructed from the pre-approved plan and the delivered code, and the run was completed via QA-only review (same recovery as M2-1/M2-2).

## Model Provenance

Doer: `claude-opus-4-8` at effort max (orchestrate global override, quality profile). Plan reviewer: `gpt-5.6-sol` xhigh (round-1 findings incorporated into the revision that was pre-approved).
