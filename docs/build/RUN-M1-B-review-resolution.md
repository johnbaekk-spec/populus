# Codex code-review resolution notes — RUN M1-B

## Code-review round 1 resolution map

Source of findings: `.codex-review-m1bcode/m1bcode-1.codex.last.txt`
(VERDICT: CHANGES_REQUESTED — 4 blockers + 1 nit). All five are addressed in the
uncommitted working tree; nothing was committed, pushed, or branched.

### F1 [BLOCKER] — live House path trusted bytes with no checkpoint — RESOLVED

- Evidence: `src/populus/ingest/house.py:834`
- Remediation applied: the self-heal branch is **removed**. `_obtain_document`
  now reads `verify-or-refetch`: archived bytes are returned with zero transport
  **only** when a committed checkpoint exists and the bytes re-hash to it. An
  absent, unreadable, or hash-less checkpoint is fetch-required — the checkpoint
  is then committed from the actual 200 response (with a genuine `retrieved_at`)
  before the bytes are written, preserving the checkpoint-before-bytes ordering.
  No sidecar is ever manufactured from unverified bytes, no `retrieved_at` is
  ever `None` on the live path, and no unverifiable document returns zero
  transport.
- Files: `src/populus/ingest/house.py` (`_obtain_document` + its docstring).
- New tests (`tests/test_house_ingest.py`):
  - `test_archived_bytes_without_a_checkpoint_are_refetched_never_self_healed` —
    bytes present, sidecar deleted, bytes corrupted to the *same length*: asserts
    exactly one PDF fetch, the archive healed to the source bytes, the sidecar's
    `response_hash` equal to the source hash and `retrieved_at` non-null, and a
    follow-up run at zero transport (no refetch loop).
  - `test_an_unreadable_checkpoint_is_fetch_required_not_trusted` — driven from a
    **fresh** database (so no `filings.response_hash` can settle the filing
    first) over an archive whose sidecar is garbage JSON: asserts one fetch. This
    is the exact inverse of the existing
    `test_fresh_database_over_a_verified_archive_makes_zero_ptr_transport`.
- Mutation check: restoring the `expected is None` self-heal branch turns both
  new tests red (`2 failed`); reverting the mutation returns them green.

### F2 [BLOCKER] — e-file ROW census included unmeasurable filings' rows — RESOLVED

- Evidence: `src/populus/parse_gate.py:234`
- Remediation applied: census 1 (the FILING census) now records each measurable
  filing's `(chamber, year)` era key in a `measurable_era` map, and census 2 (the
  ROW census) attributes rows **only** through that map — membership is tested
  against the filing census's own result rather than re-derived in SQL, so there
  is one measurable predicate, evaluated once. Rows belonging to a `failed`
  filing, or to one whose `row_count` is NULL/0, contribute nothing to the
  printed floor. Era attribution is also taken from the same map, so the two
  censuses cannot disagree about which era a filing belongs to either.
- Consistency assertion: new `parse_gate._assert_census_consistency`, raising the
  new `parse_gate.ParseGateConsistencyError`, runs over every era before any rate
  is derived. Two invariants: an era with zero measurable e-file filings must
  contribute zero floor rows, and clean rows can never exceed total rows.
- Files: `src/populus/parse_gate.py` (module docstring, new exception, new
  `_assert_census_consistency`, both censuses in `compute_parse_gate`).
- New tests (`tests/test_parse_gate.py`):
  - `test_rows_of_a_failed_filing_never_enter_the_floor` — one measurable filing
    (10 clean rows) + one failed filing carrying 40 *defective* rows: the floor
    is 10/10 = 1.0, not 10/50 = 0.2, and the status stays `unmeasurable`.
  - `test_rows_of_a_null_or_zero_row_count_filing_never_enter_the_floor[None|0]`
    — the other two unmeasurable shapes, same exclusion.
  - `test_an_era_with_no_measurable_filing_reports_no_floor_rows_at_all` —
    `efile_rows == 0` and `efile_parse_rate is None`, never a rate over rows
    outside the census.
  - `test_the_census_consistency_invariant_is_asserted_not_assumed` — the guard
    driven directly on both invariants, plus the silent-pass case.
  - `test_a_mixed_corpus_keeps_the_two_censuses_consistent` — end-to-end over
    parsed/failed/zero-count/needs_ocr/kadoa filings.
- Mutation check: restoring the old `SELECT f.chamber, substr(f.filed_date,1,4)`
  row-census query turns 5 tests red; reverting returns all 25 green (and
  `tests/test_stats.py` stays green, so no published-figure regression).

### F3 [BLOCKER] — every SQLite fault read as "institutional data absent" — RESOLVED

- Evidence: `src/populus/publish/build.py:1683`
- Remediation applied: absence is now decided by **schema**, not by whether a
  query happened to fail. `run_build` probes `sqlite_master` for the
  `inst_filings` *table* first; only its genuine absence yields the
  byte-identical M1 build. When the table is present the view query runs
  **unguarded**, so a malformed view, an incompatible schema, or any other real
  SQLite fault propagates out of `run_build` as a visible publication failure
  (R13/R16/R18) instead of silently publishing a congress-only build and
  dropping a real institutional corpus.
- The `try/except sqlite3.OperationalError` around the probe is gone.
- Files: `src/populus/publish/build.py`.
- New tests (`tests/test_publish.py`):
  - `test_a_broken_institutional_schema_fails_the_build_it_does_not_read_absent`
    — `inst_filings` present but with an incompatible one-column schema:
    `run_build` raises `sqlite3.OperationalError`.
  - `test_a_malformed_institutional_view_fails_the_build` — tables intact,
    `v_default_inst_filings` replaced by a view over a nonexistent table (which
    `CREATE VIEW IF NOT EXISTS` will not repair): `run_build` raises.
  - The pre-existing `test_build_from_an_m1_only_database_yields_an_m1_build`
    still passes, so genuine absence is unaffected.
- Mutation check: restoring the broad `except sqlite3.OperationalError:
  inst_present = False` turns both new tests red while the M1-only test stays
  green — i.e. the mutation is invisible to the old suite, which is exactly why
  the finding was reachable. Reverting returns all 172 publish tests green.

### F4 [BLOCKER] — a missing expected count was skipped, then reported as matching — RESOLVED

- Evidence: `scripts/phase_a_snapshot.py:210`
- Remediation applied, both halves of the finding:
  1. **All three counts are required, with validated integer types.**
     `assert_copy` now rejects any of `filings`, `transactions`,
     `v_default_transactions` that is absent or not a genuine `int`, naming the
     offending fields, before the mismatch comparison runs. The old
     `if value is not None` skip — which then printed
     "(matches the published stats.json)" for the very count it had not checked
     — is gone. `bool` is excluded explicitly: it is an `int` subclass, so
     `True == 1` would otherwise reconcile a one-filing corpus.
  2. **The stats artifact's own manifest hash and size are verified.**
     `resolve_corpus` now checks `congress/stats.json` against its own manifest
     entry (sha256 + bytes) exactly as it already did for `congress.db`, before
     the counts are read. Verifying the corpus byte-for-byte and then
     reconciling it against an unverified counts file left the whole assertion
     resting on a file anything could have rewritten.
- Files: `scripts/phase_a_snapshot.py` (module docstring, `resolve_corpus`,
  `assert_copy`).
- New tests (`tests/test_phase_a_snapshot.py`), plus a new `_rewrite_stats`
  helper that keeps the manifest entry consistent with the artifact so a *build*
  disagreement stays distinguishable from a *tamper*:
  - `test_a_missing_expected_count_is_a_hard_stop_never_a_skipped_check` —
    parametrized over each of the three count fields deleted in turn: rc 1, the
    named cause, and the assertion that "matches the published stats.json" never
    appears in the output.
  - `test_a_non_integer_expected_count_is_a_hard_stop[3|None|True|2.0]` — string,
    null, bool, and float counts each refused.
  - `test_a_tampered_stats_artifact_is_refused_against_its_manifest_entry` — a
    **same-length** edit (so the size check cannot catch it) that leaves every
    count correct: only the sha256 comparison can reject it, and it does, before
    any copy is made.
  - `test_counts_that_disagree_with_the_published_stats_are_a_hard_stop` updated
    to keep the manifest entry in step, so it still exercises the count-mismatch
    path rather than short-circuiting on the new hash check.
- Mutation checks (two, one per half):
  - restoring the `value is not None` skip → 7 tests red;
  - neutralizing the stats sha256 comparison (`if False:`) → the tampered-stats
    test red. NOTE: the first version of that test used a length-CHANGING edit
    and passed under the mutant because the size check caught it; the test was
    rewritten to be length-preserving so it pins the hash check specifically.
  - Reverting both returns 16/16 green.
- **Incident:** a stall interrupted the restore after the second mutation, so
  `if False:` was briefly live on disk. Verified from disk and restored before
  continuing; the clean source passes 16/16. The other three source files were
  checked at the same time and were clean.

### F5 [NIT] — stale Phase A artifact inventory — ADOPTED / RESOLVED

- Evidence: reviewer's command result `pdf=728 sidecars=728`; retained Senate
  logs `senate-2015.log` and `senate-2015-attempt3.log`.
- Independently re-measured from the live tree (read-only; nothing under `ops/`
  was modified): `ops/m1-b/raw/house/` holds **728 PDFs and 728 sidecars**, and
  `ops/m1-b/` holds exactly **two** Senate attempt logs.
- Remediation applied to `docs/build/RUN-M1-B-phase-a.md`:
  - §4 resume table is now **two explicitly labelled snapshots** — "A: after the
    first run" (727/727, the figure that was previously printed unlabelled) and
    "B: after the resume run (current tree)" (728/728). The prose explains that
    the resume run's single `200:1` is the previously-403 document, closing the
    gap, and that `settled_verified = 727` is a *resume-run counter* (documents
    already settled when that run started), not an archive size — which is why
    it is correctly one fewer than the 728 the run ended with.
  - §9 artifact row for `raw/house/` now reads 728 + 728 with the first-run
    figure noted in parentheses.
  - §9 Senate log row corrected from "the three 503 attempts" to **2 of 3
    retained**, and — measured from the logs' own elapsed figures rather than
    assumed — identifies them as **attempt 2** (`senate-2015.log`, 21.8 s) and
    **attempt 3** (`senate-2015-attempt3.log`, 21.2 s). **Attempt 1** (22.7 s) is
    the one NOT retained: it wrote to the same path as attempt 2 and was
    overwritten. Note the reviewer did not identify *which* two were retained;
    the naive reading of the filenames ("attempt 1 and attempt 3") would have
    been wrong.
  - §3 gains a log-provenance note beside the attempt table so the figures and
    their evidence are not separated by six sections.
- Documentation only; no runtime behaviour, no test, and no `ops/` artifact
  changed.

---

## Summary

| ID | Severity | Status | Behavioural? | Mutation-verified |
|---|---|---|---|---|
| F1 | BLOCKER | RESOLVED | yes | yes — 2 tests red under the mutant |
| F2 | BLOCKER | RESOLVED | yes | yes — 5 tests red |
| F3 | BLOCKER | RESOLVED | yes | yes — 2 tests red |
| F4 | BLOCKER | RESOLVED | yes | yes — 7 red (counts) + 1 red (stats hash) |
| F5 | NIT | ADOPTED | no (docs) | n/a |

### Gates after remediation (synchronous, this tree)

- `make test` → **`1746 passed in 413.17s`** (baseline 1728, **+18**, zero regressions)
- `make security` → **`dep_guard: OK — no denylisted vendor dependencies or imports`**
- `make accept-m1-b` → **`ACCEPTANCE PASSED`**

The +18 reconciles exactly per file: `test_house_ingest` 98→100 (F1),
`test_publish` 170→172 (F3), `test_parse_gate` 19→25 (F2),
`test_phase_a_snapshot` 8→16 (F4).

### Scope

`git status --porcelain` = **28 entries** (15 modified, 13 untracked) — the same
membership as before the review; every fix landed in a file the run already
touched. Nothing was committed, pushed, branched, or checked out. No `ops/` live
artifact was modified (F5 read the tree to verify, and corrected documentation
only). All test runs were socket-free under the autouse guard;
`PYTHONDONTWRITEBYTECODE=1` and a `__pycache__` purge bracketed every mutation
swap.

### Not fully closed

Nothing from this round is left open. Two items are carried forward as context
rather than defects:

- The **Senate historical window remains unmeasured** (eFD returned 503 on all
  three attempts). That was the owner's explicitly recorded deferral before this
  review and the reviewer agreed it is not a code blocker; it is unchanged here.
- **Attempt 1's Senate log is genuinely gone** (overwritten by attempt 2). The
  artifact now says so plainly instead of implying three retained logs. This
  cannot be repaired retroactively, only stated.

---

## Code-review round 2 resolution map

Source: `.codex-review-m1bcode/m1bcode-2.codex.last.txt` (VERDICT
CHANGES_REQUESTED — 2 residual blockers + 1 nit). Round-2 audit confirmed
round-1 **F2, F3, F5 genuinely resolved**; round-1 **F1** and **F4** were
incompletely remediated. This round is the final one.

### R2-F1 [BLOCKER] — residual of round-1 F1: the settled pre-pass bypassed the sidecar — RESOLVED

- Evidence: `src/populus/ingest/house.py:753`
- Root cause the reviewer named precisely: **two competing resume boundaries.**
  Round 1 fixed `_obtain_document` to require a verifiable checkpoint, but the
  settled pre-pass in `_ingest_year` runs *before* it and skipped on the
  database hash alone — so it bypassed the very requirement round 1 added.
  Deleting or corrupting a sidecar while leaving matching bytes intact
  permanently destroyed that document's `source_url` and `retrieved_at`: zero
  transport on every later run, and no path that could restore them.
- Remediation applied (the finding's first option — include the sidecar in
  settled eligibility): in **live mode only**, a settled skip now additionally
  requires the checkpoint sidecar to be present, readable, and to agree with the
  stored `response_hash`. `read_checkpoint` answers `(None, None)` for an absent
  or unparseable sidecar, so both fail and fall through to the checkpoint-first
  obtain path — exactly one fetch, full §5.1 provenance rewritten.
  `commit_checkpoint` is the single writer and emits `source_url`,
  `response_hash`, and `retrieved_at` in one atomic payload, so the two fields
  checked prove the third.
- **Cache mode is deliberately exempt** and this is now pinned by a test: cache
  mode writes no sidecar by contract (`test_cache_mode_writes_no_sidecar`) and
  has no transport with which to make one, so requiring one there would render
  every cached corpus permanently unsettleable. This exemption is a deliberate
  scope boundary, not an oversight.
- Files: `src/populus/ingest/house.py` (`_ingest_year` settled pre-pass + its
  rationale comment).
- New tests (`tests/test_house_ingest.py`, 100 → 104):
  - `test_settled_skip_on_the_same_db_requires_the_sidecar_too[absent|unreadable]`
    — **same database**, intact bytes, sidecar deleted / truncated: asserts
    `settled_verified == 0`, `settled_reobtained == 1`, exactly one PDF fetch,
    the sidecar restored with correct `source_url` / `response_hash` /
    non-null `retrieved_at`, and a follow-up run genuinely settled at zero
    transport.
  - `test_a_sidecar_disagreeing_with_the_stored_hash_is_not_settled` — a
    readable sidecar naming a different hash: the two provenance records
    contradict each other, so the document is re-obtained rather than one being
    quietly preferred.
  - `test_cache_mode_settles_without_a_sidecar` — pins the exemption above.
- Mutation check: dropping the `checkpoint_hash != response_hash or
  retrieved_at is None` guard turns 3 tests red while the cache-mode test stays
  green; reverting returns 4/4 green.

### R2-F2 [BLOCKER] — residual of round-1 F4: the manifest boundary was not the canonical one — RESOLVED

- Evidence: `scripts/phase_a_snapshot.py:116`
- Remediation applied exactly as written: `validate_manifest(manifest)` and
  `pointer_manifest_identity_error(manifest, build_id)` are now called **before**
  `find_artifact`, and every validation error is rejected. Both were already the
  shared boundary for the client, monitor, and verifier — the script had been
  maintaining a second, weaker one out of ad-hoc `.get()` reads.
- Knock-on hardening the reviewer specifically called out: because
  `validate_manifest` guarantees a non-negative integer `bytes` on every artifact
  entry, **both** size comparisons (`congress.db` and `congress/stats.json`) are
  now unconditional. The old `if expected_bytes is not None` let an entry with no
  `bytes` field bypass size verification while the script still reported
  published provenance — absent evidence read as "nothing to check", the identical
  fail-open shape as round-1 F4.
- Files: `scripts/phase_a_snapshot.py` (`resolve_corpus`, both size checks).
- **Test-fidelity problem this exposed, stated plainly:** wiring the canonical
  validator in turned **all 16** snapshot tests red. The `data_repo` fixture's
  hand-rolled `manifest.json` **was not a valid manifest** — no `watermarks`, no
  `schema_version`, a non-conforming `publisher`. Those tests had been passing
  against a manifest the real client would reject. The fixture is now produced by
  the real `run_build` → `run_publish` path, so the manifest under test is exactly
  what production emits.
- New tests (`tests/test_phase_a_snapshot.py`, 16 → 20):
  - `test_an_invalid_manifest_is_never_dereferenced` — a deleted `watermarks`
    block: a defect the canonical validator names and the old ad-hoc reads sailed
    past, because nothing the script itself read was missing.
  - `test_an_artifact_entry_without_bytes_is_refused_not_size_skipped` — the
    precise fail-open named in the finding.
  - `test_a_pointer_naming_a_different_build_than_its_manifest_is_refused` — a
    **real second build** is produced and the pointer aimed at it while claiming
    the first build's id. Editing `build_id` in place does NOT test this: the
    validator scopes artifact paths to the manifest's own build, so a one-field
    edit fails validation and never reaches the identity check.
  - `test_the_containment_proof_still_refuses_a_traversal_locator` — the script's
    `_resolve_under` guard driven directly. The validator now rejects traversal
    first, making that guard unreachable via `run_snapshot`; it is kept as defence
    in depth, and tested so it cannot rot unnoticed.
- Two existing tests changed their observable failure **message** (not their
  verdict) because the canonical validator fires earlier than the script's own
  checks — a missing `congress.db` entry and a traversal locator are both invalid
  *manifests*, not merely uninteresting ones. Assertions updated, with the
  layering explained in each docstring.
- Mutation checks: neutralizing `validate_manifest` → 4 red; neutralizing
  `pointer_manifest_identity_error` → 1 red. Both reverted and re-verified green
  **within the same tool call**, after a round-1 stall once left a mutant on disk.

### R2-F3 [NIT] — stale Tech Debt row — ADOPTED / RESOLVED

- Evidence: `DEV-NOTES.md:449`
- The row declared debt that the round-1 F3 remediation had already removed: the
  broad `except sqlite3.OperationalError` no longer exists. Notably the row's own
  suggested "tighter fix" — a `sqlite_master` lookup for `inst_filings` — is
  precisely what shipped, so the row was describing a superseded implementation.
- Remediation: the row is struck through and marked **Retired — no longer debt**,
  naming what actually shipped and the three tests that pin it. The finding also
  asked to refresh the corresponding pre-remediation statements, so the
  Plan-Deviations prose (item 3) was corrected in the same pass. A new, honest
  debt row replaces it: the round-2 F1 sidecar read added to the settled pre-pass.

---

## Round 2 summary

| ID | Severity | Status | Mutation-verified |
|---|---|---|---|
| R2-F1 | BLOCKER | RESOLVED | yes — 3 red (cache-mode exemption stays green) |
| R2-F2 | BLOCKER | RESOLVED | yes — 4 red (validate) + 1 red (identity) |
| R2-F3 | NIT | ADOPTED | n/a (documentation) |

Round-1 F2, F3, F5 were re-confirmed resolved by the round-2 audit and were not
touched again.

### Gates after round-2 remediation (synchronous, this tree)

- `make test` → **`1754 passed in 406.24s`** (round-1 baseline 1746, **+8**, zero regressions)
- `make security` → **`dep_guard: OK — no denylisted vendor dependencies or imports`**
- `make accept-m1-b` → **`ACCEPTANCE PASSED`**

The +8 reconciles exactly per file: `test_house_ingest` 100→104 (R2-F1),
`test_phase_a_snapshot` 16→20 (R2-F2). Cumulative across both rounds:
**1728 → 1754 (+26)**.

### Scope

`git status --porcelain` = **28 entries** (15 modified, 13 untracked) — unchanged
membership across both review rounds. Nothing committed, pushed, branched, or
checked out; HEAD remains `ceaecf9`. No `ops/` artifact modified. All runs
socket-free; `PYTHONDONTWRITEBYTECODE=1` + `__pycache__` purge bracketed every
mutation swap, and every round-2 mutation was reverted inside the same tool call
that applied it.

### Not fully closed

Nothing from either round is left open. Carried forward unchanged, as context
rather than defects:

- The **Senate historical window remains unmeasured** (eFD 503 on all three
  attempts) — the owner's recorded deferral, which both review rounds agreed is
  not a code blocker.
- **Attempt 1's Senate log is genuinely gone**, overwritten by attempt 2. The
  artifact now states this rather than implying three retained logs.
- The `_resolve_under` containment guard in the snapshot script is now
  **unreachable through `run_snapshot`** (the canonical validator rejects
  traversal first). Kept deliberately as defence in depth and covered by a direct
  test, but it is dead code on the main path — noted so a future reader does not
  mistake its test for end-to-end coverage.

---

## Code-review round 3 resolution map — SPEC FIRST (owner-authorized)

Source: `.codex-review-m1bcode/m1bcode-3.codex.last.txt` (CHANGES_REQUESTED —
1 residual blocker + 1 nit). Audit confirmed R2-F2 resolved and R2-F3 resolved in
the canonical Dev Notes but **not propagated to QA**; **R2-F1 still incomplete on
the fresh-database obtain boundary**.

### Why this round was different

Three consecutive rounds found a residual in the *same* boundary. The owner
invoked the specify-before-rewriting threshold, so the spec is the deliverable
and the code change implements it.

| Round | Boundary found weak | Weaker rule enforced | What it permitted |
|---|---|---|---|
| 1 | `_obtain_document` | bytes present ⇒ durable | Sidecar minted from unverified bytes, null `retrieved_at` |
| 2 | `_ingest_year` pre-pass | bytes match DB hash ⇒ durable | Deleting a sidecar destroyed provenance permanently |
| 3 | `_obtain_document` again | checkpoint hash matches ⇒ durable | Hash-only checkpoint durable forever; fresh-DB resume never repairs |

**One rule, multiple boundaries, each hand-rolled.** Each round fixed the
boundary the reviewer stood on; the rule itself was in nobody's custody. Round
2's notes even named the shape ("two competing resume boundaries") and still
fixed only one.

### R3-F1 [BLOCKER] — `_obtain_document` accepted a hash-only checkpoint — RESOLVED

- Evidence: `src/populus/ingest/house.py:865`
- **Spec written first:** `docs/build/M1-B-provenance-boundary-spec.md`, in the
  invariant style of `M2-7-cover-tolerance-spec.md`. Domain (archive /
  checkpoint / canonical URL / DB row, with cache mode scoped out); the ONE rule
  stated once; a table of the THREE boundaries (settled pre-pass /
  `_obtain_document` / fresh-DB resume) each mapped to the rule and its guarding
  test; seven invariants; and the three-round history above as the diagnostic.
- **Fix, per the finding's remediation:** `house._checkpoint_is_complete` is now
  the single evaluation of the rule, called by **both** boundaries, validating
  the full §5.1 set — `response_hash` (matching the DB hash when the caller
  supplies one), non-empty `retrieved_at`, and `source_url` **equal to the
  canonical URL**. The finding noted `_obtain_document` "cannot inspect its
  source URL", so the URL is threaded in from the caller, which derives it from
  the same `DocID`/`year` that built the archive path — the sidecar is never the
  authority on its own provenance. `checkpoint.read_provenance` added as the one
  sidecar parser; `read_checkpoint` reimplemented on top of it.
- **Why boundary 3 mattered:** on a fresh database the settled pre-pass has no
  rows and cannot fire, so `_obtain_document` alone stands between an incomplete
  sidecar and a zero-transport reuse. That is why hardening the pre-pass in
  round 2 did not close this.
- New tests (`tests/test_house_ingest.py`, 104 → 119, **+15**):
  `test_a_hash_only_checkpoint_is_not_durable`;
  `test_a_checkpoint_missing_any_provenance_field_is_fetch_required` (3 fields ×
  2 boundaries = 6); `test_a_blank_retrieved_at_is_absence_wearing_a_key`
  (`None` / `""` / whitespace);
  `test_a_checkpoint_naming_a_different_source_url_is_fetch_required`;
  `test_settled_skip_requires_complete_provenance_not_just_a_hash`;
  `test_a_fresh_database_refetches_an_incomplete_checkpoint`;
  `test_both_resume_boundaries_share_one_completeness_predicate`;
  `test_the_completeness_predicate_rejects_every_incomplete_shape`.
- **Mutation checks, one per field:** drop `retrieved_at` → **6 red**; drop
  `source_url` → **4 red**; drop `response_hash` presence → **initially GREEN**.
  Reported, not hidden: that line is redundant by construction, since a
  checkpoint with no hash is independently rejected downstream
  (`sha256_hex(bytes)` can never equal `None`). It is kept as an explicit
  statement of the "complete set" reading and is now pinned by a direct
  predicate test, which does die under the mutation. All mutations reverted and
  the clean source re-verified (119/119).

### R3-F2 [NIT] — stale QA-REPORT statements — ADOPTED / RESOLVED

- Evidence: `QA-REPORT.md:236`
- The finding asked for the **security, coverage-gap, and tech-debt** statements
  — all three refreshed:
  - Security bullet: the "one item for the reviewer's attention" is marked
    RESOLVED, naming what shipped.
  - Coverage gap 3 ("probe fix tested for the M1-only case only") marked CLOSED
    — note QA's own suggested remedy, a narrower `sqlite_master` probe, is
    exactly what shipped, plus the two tests it said would then be unnecessary.
  - Tech-debt row retired, and a second retired row added for the durability
    rule now that it is specified.
- A supersession header was added: the report predates all three rounds, and its
  gate figures are pre-remediation. Superseded statements are struck through and
  annotated **inline rather than deleted**, so the report still reads as the
  record of what QA actually saw.

---

## Round 3 summary

| ID | Severity | Status | Mutation-verified |
|---|---|---|---|
| R3-F1 | BLOCKER | RESOLVED | yes — 6 red, 4 red, and 1 red after pinning the redundant line |
| R3-F2 | NIT | ADOPTED | n/a (documentation) |

### Gates after round-3 remediation (synchronous, this tree)

- `make test` → **`1769 passed in 433.98s`** (baseline 1754, **+15**, zero regressions)
- `make security` → **`dep_guard: OK — no denylisted vendor dependencies or imports`**
- `make accept-m1-b` → **`ACCEPTANCE PASSED`**

The +15 is entirely `test_house_ingest` 104→119. Cumulative across all three
rounds: **1728 → 1769 (+41)**.

### Scope

`git status --porcelain` = **29 entries** (15 modified, 14 untracked). The count
held at 28 through rounds 1 and 2; round 3 adds exactly one file,
`docs/build/M1-B-provenance-boundary-spec.md`, under the owner's spec-first
authorization. Nothing committed, pushed, branched, or checked out; HEAD remains
`ceaecf9`. No `ops/` artifact modified. All runs socket-free;
`PYTHONDONTWRITEBYTECODE=1` + `__pycache__` purge bracketed every mutation swap,
each applied and reverted within a single tool call.

### Not fully closed

- **Carried forward unchanged:** the Senate historical window remains unmeasured
  (eFD 503 ×3 — the owner's recorded deferral, agreed non-blocking by all three
  rounds); attempt 1's Senate log is genuinely gone.
- **Known-redundant line, deliberately kept:** the `response_hash` presence check
  in `_checkpoint_is_complete` changes no end-to-end behaviour. Kept for the
  explicit "complete set" reading and pinned by a direct predicate test.
- **The `_resolve_under` containment guard** in the snapshot script remains
  unreachable through `run_snapshot` (round 2) — defence in depth, directly
  tested.
